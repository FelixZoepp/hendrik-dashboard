-- ============================================================
-- Phase 0: Basis-Tabellen — profiles + companies
-- ============================================================

-- Enums
create type public.user_role as enum (
  'admin',
  'sales',
  'fulfillment',
  'client_owner',
  'client_member'
);

create type public.company_status as enum (
  'onboarding',
  'aktiv',
  'pausiert',
  'gekuendigt'
);

-- ============================================================
-- companies
-- ============================================================
create table public.companies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  branche       text,
  ansprechpartner text,
  email         text,
  telefon       text,
  adresse       text,
  status        public.company_status not null default 'onboarding',
  start_datum   date,
  ende_datum    date,
  monatliches_retainer numeric(10,2),
  close_lead_id text,
  owner_id      uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ============================================================
-- profiles
-- ============================================================
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  role        public.user_role not null default 'client_member',
  company_id  uuid references public.companies(id) on delete set null,
  avatar_url  text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Auto-update updated_at
create or replace function public.update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.update_updated_at();

create trigger companies_updated_at
  before update on public.companies
  for each row execute function public.update_updated_at();

-- ============================================================
-- Helper: is_staff()
-- ============================================================
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin', 'sales', 'fulfillment')
      and active = true
  );
$$;

-- ============================================================
-- RLS
-- ============================================================

-- profiles
alter table public.profiles enable row level security;

-- Jeder kann sein eigenes Profil lesen
create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

-- Staff kann alle Profile sehen
create policy "profiles_select_staff"
  on public.profiles for select
  using (public.is_staff());

-- Clients sehen andere Mitglieder ihrer Company
create policy "profiles_select_company"
  on public.profiles for select
  using (
    company_id is not null
    and company_id = (
      select p.company_id from public.profiles p where p.id = auth.uid()
    )
  );

-- Eigenes Profil updaten (aber nicht Rolle)
create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Admin kann alle Profile updaten
create policy "profiles_update_admin"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- companies
alter table public.companies enable row level security;

-- Staff sieht alle Companies
create policy "companies_select_staff"
  on public.companies for select
  using (public.is_staff());

-- Client sieht nur eigene Company
create policy "companies_select_own"
  on public.companies for select
  using (
    id = (
      select p.company_id from public.profiles p where p.id = auth.uid()
    )
  );

-- Nur Admin darf Companies anlegen/updaten
create policy "companies_insert_admin"
  on public.companies for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "companies_update_admin"
  on public.companies for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Kein DELETE für Companies — nur Statuswechsel auf 'gekuendigt'
