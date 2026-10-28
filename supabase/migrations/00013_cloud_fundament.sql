-- ============================================================
-- 00013: Hoffmann Solutions Cloud — Fundament (Auth, Kundenportal)
-- Idempotent: mehrfach ausführbar. Nur additive Änderungen, außer zwei
-- Policies auf profiles, die ersetzt werden (Rekursion, s. u.).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Neue Spalten
-- ------------------------------------------------------------
alter table public.companies add column if not exists ort    text;
alter table public.companies add column if not exists region text;

-- Login-E-Mail als Kopie für Listen (auth.users ist per API nicht lesbar)
alter table public.profiles add column if not exists email text;
create index if not exists profiles_company_id_idx on public.profiles(company_id);
create index if not exists profiles_email_idx on public.profiles(lower(email));

-- ------------------------------------------------------------
-- 2. Hilfsfunktionen (security definer → keine RLS-Rekursion)
-- ------------------------------------------------------------
create or replace function public.eigene_company_id()
returns uuid
language sql
stable
security definer set search_path = ''
as $$
  select p.company_id from public.profiles p
  where p.id = auth.uid() and p.active = true;
$$;

create or replace function public.ist_admin()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.active = true
  );
$$;

-- Bewusst kein revoke für anon: die Funktionen stecken in Policies und liefern ohne Login null/false.

-- ------------------------------------------------------------
-- 3. profiles-Policies ohne Selbstbezug
--    (00001 fragt in Policies auf profiles wieder profiles ab →
--     "infinite recursion detected in policy for relation profiles")
-- ------------------------------------------------------------
drop policy if exists "profiles_select_company" on public.profiles;
create policy "profiles_select_company"
  on public.profiles for select
  using (company_id is not null and company_id = public.eigene_company_id());

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
  on public.profiles for update
  using (public.ist_admin())
  with check (public.ist_admin());

-- ------------------------------------------------------------
-- 4. Schutz: niemand ändert die eigene Rolle / Firma / Sperre
--    profiles_update_own erlaubt sonst per API: role = 'admin'.
--    Erlaubt bleibt: Service-Rolle (Server, Einladungen) und Admins.
-- ------------------------------------------------------------
create or replace function public.profiles_schutz()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new; -- Service-Rolle / SQL-Konsole
  end if;
  if public.ist_admin() then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.company_id is distinct from old.company_id
     or new.active is distinct from old.active
     or new.id is distinct from old.id then
    raise exception 'Rolle, Firma und Sperre darf nur ein Admin ändern';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_schutz on public.profiles;
create trigger profiles_schutz
  before update on public.profiles
  for each row execute function public.profiles_schutz();

-- ------------------------------------------------------------
-- 5. Neue Nutzer: E-Mail mitschreiben (Rolle bleibt client_member ohne Firma,
--    die Server-Aktion „Zugang anlegen“ setzt Rolle + Firma direkt danach)
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    lower(new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Bestehende Profile: E-Mail nachtragen
update public.profiles p
   set email = lower(u.email)
  from auth.users u
 where u.id = p.id and p.email is null;
