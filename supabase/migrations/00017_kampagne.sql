-- ============================================================
-- 00017: Kampagne & Berichte je Kunde (Handwerksbetrieb)
-- Idempotent und rein additiv: neue Tabellen, Indizes, Policies.
-- Bestehende Tabellen (meta_ad_insights, google_ads_insights) bleiben unverändert.
--
-- Zuordnung: Anzeigen laufen über das zentrale Meta-Werbekonto (META_AD_ACCOUNT_ID),
-- die Firma wird über die Kampagnen-ID zugeordnet. Optional hat eine Firma ein eigenes
-- Werbekonto (act_…) → dann zählen alle Kampagnen dieses Kontos.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Kampagne → Firma
-- ------------------------------------------------------------
create table if not exists public.kampagnen_zuordnung (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  plattform      text not null check (plattform in ('meta', 'google')),
  kampagne_id    text not null,
  kampagne_name  text,
  -- null = zentrales Werbekonto, sonst act_… des eigenen Kontos der Firma
  werbekonto_id  text,
  aktiv          boolean not null default true,
  created_at     timestamptz not null default now(),
  -- eine Kampagne gehört genau einer Firma (voller Unique-Index, kein partieller)
  constraint kampagnen_zuordnung_plattform_kampagne_key unique (plattform, kampagne_id)
);

create index if not exists kampagnen_zuordnung_company_idx on public.kampagnen_zuordnung(company_id);

-- ------------------------------------------------------------
-- 2. Eigenes Werbekonto je Firma (optional)
-- ------------------------------------------------------------
create table if not exists public.kampagnen_werbekonto (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  plattform      text not null default 'meta' check (plattform in ('meta', 'google')),
  werbekonto_id  text not null,
  aktiv          boolean not null default true,
  created_at     timestamptz not null default now(),
  constraint kampagnen_werbekonto_plattform_konto_key unique (plattform, werbekonto_id)
);

create index if not exists kampagnen_werbekonto_company_idx on public.kampagnen_werbekonto(company_id);

-- ------------------------------------------------------------
-- 3. Tageswerte je Kampagne (aus dem Sync)
-- ------------------------------------------------------------
create table if not exists public.kampagnen_kosten_tag (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  plattform        text not null check (plattform in ('meta', 'google')),
  kampagne_id      text not null,
  datum            date not null,
  ausgaben         numeric(12,2) not null default 0,
  impressionen     integer not null default 0,
  klicks           integer not null default 0,
  leads_plattform  integer not null default 0,
  aktualisiert_am  timestamptz not null default now(),
  constraint kampagnen_kosten_tag_plattform_kampagne_datum_key unique (plattform, kampagne_id, datum)
);

create index if not exists kampagnen_kosten_tag_company_datum_idx
  on public.kampagnen_kosten_tag(company_id, datum desc);

-- ------------------------------------------------------------
-- 4. Manuelle Kosten je Monat (z. B. Google ohne Datenquelle)
-- ------------------------------------------------------------
create table if not exists public.manuelle_kosten (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  -- erster Tag des Monats
  monat       date not null check (extract(day from monat) = 1),
  betrag      numeric(12,2) not null check (betrag >= 0),
  notiz       text,
  created_at  timestamptz not null default now()
);

create index if not exists manuelle_kosten_company_monat_idx on public.manuelle_kosten(company_id, monat);

-- ------------------------------------------------------------
-- 5. RLS: Team alles, Kunde liest die eigene Firma
--    (Die App liest über die Service-Rolle mit .eq("company_id", …); RLS ist die zweite Sicherung.)
-- ------------------------------------------------------------
alter table public.kampagnen_zuordnung  enable row level security;
alter table public.kampagnen_werbekonto enable row level security;
alter table public.kampagnen_kosten_tag enable row level security;
alter table public.manuelle_kosten      enable row level security;

drop policy if exists "kampagnen_zuordnung_staff" on public.kampagnen_zuordnung;
create policy "kampagnen_zuordnung_staff" on public.kampagnen_zuordnung
  for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists "kampagnen_zuordnung_kunde" on public.kampagnen_zuordnung;
create policy "kampagnen_zuordnung_kunde" on public.kampagnen_zuordnung
  for select using (company_id = public.eigene_company_id());

drop policy if exists "kampagnen_werbekonto_staff" on public.kampagnen_werbekonto;
create policy "kampagnen_werbekonto_staff" on public.kampagnen_werbekonto
  for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists "kampagnen_werbekonto_kunde" on public.kampagnen_werbekonto;
create policy "kampagnen_werbekonto_kunde" on public.kampagnen_werbekonto
  for select using (company_id = public.eigene_company_id());

drop policy if exists "kampagnen_kosten_tag_staff" on public.kampagnen_kosten_tag;
create policy "kampagnen_kosten_tag_staff" on public.kampagnen_kosten_tag
  for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists "kampagnen_kosten_tag_kunde" on public.kampagnen_kosten_tag;
create policy "kampagnen_kosten_tag_kunde" on public.kampagnen_kosten_tag
  for select using (company_id = public.eigene_company_id());

drop policy if exists "manuelle_kosten_staff" on public.manuelle_kosten;
create policy "manuelle_kosten_staff" on public.manuelle_kosten
  for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists "manuelle_kosten_kunde" on public.manuelle_kosten;
create policy "manuelle_kosten_kunde" on public.manuelle_kosten
  for select using (company_id = public.eigene_company_id());
