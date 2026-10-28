-- ============================================================
-- 00019: Kalender verbinden (ICS-Abo je Firma) + Onboarding-Stand
-- Idempotent und rein additiv. NICHT automatisch einspielen. Reihenfolge: nach 00013–00018.
--
-- 1. kalender_abos – eine Zeile je Firma:
--      token            geheimer Teil der Abo-URL /api/kalender/<token>.ics (null = noch kein Link)
--      letzter_abruf_am wann ein Kalender (Google/Apple/Outlook) den Feed zuletzt geholt hat
--      buchungslink     eigener Termin-Buchungslink (Calendly, Google-Terminbuchung …), nur https
-- 2. RLS: Staff alles. Kunden KEINE Policy (Token ist geheim) – Zugriff nur über den Server
--    (requireKunde() + Service-Client, gefiltert auf company_id), wie bei lead_quellen (00014).
--
-- Der Onboarding-Stand braucht keine eigene Tabelle: er wird aus vorhandenen Daten berechnet
-- (form_submissions, kalender_abos, leads, lesson_progress).
-- ============================================================

create table if not exists public.kalender_abos (
  company_id        uuid primary key references public.companies(id) on delete cascade,
  token             text,
  token_erzeugt_am  timestamptz,
  token_erzeugt_von uuid references public.profiles(id) on delete set null,
  letzter_abruf_am  timestamptz,
  abrufe            integer not null default 0,
  buchungslink      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.kalender_abos add column if not exists token_erzeugt_am  timestamptz;
alter table public.kalender_abos add column if not exists token_erzeugt_von uuid references public.profiles(id) on delete set null;
alter table public.kalender_abos add column if not exists letzter_abruf_am  timestamptz;
alter table public.kalender_abos add column if not exists abrufe            integer not null default 0;
alter table public.kalender_abos add column if not exists buchungslink      text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kalender_abos_token_laenge_check') then
    alter table public.kalender_abos
      add constraint kalender_abos_token_laenge_check check (token is null or length(token) >= 32);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'kalender_abos_buchungslink_check') then
    alter table public.kalender_abos
      add constraint kalender_abos_buchungslink_check check (
        buchungslink is null or (buchungslink like 'https://%' and length(buchungslink) <= 500)
      );
  end if;
end $$;

create unique index if not exists kalender_abos_token_key on public.kalender_abos(token) where token is not null;

drop trigger if exists kalender_abos_updated_at on public.kalender_abos;
create trigger kalender_abos_updated_at
  before update on public.kalender_abos
  for each row execute function public.update_updated_at();

alter table public.kalender_abos enable row level security;

drop policy if exists "kalender_abos_staff" on public.kalender_abos;
create policy "kalender_abos_staff"
  on public.kalender_abos for all
  using (public.is_staff())
  with check (public.is_staff());

-- Kunden: keine Policy (Token ist geheim) – Zugriff nur über den Server.

-- Schnelle Abfrage „Formular schon ausgefüllt?“ je Firma
create index if not exists form_submissions_company_typ_idx on public.form_submissions(company_id, typ);
