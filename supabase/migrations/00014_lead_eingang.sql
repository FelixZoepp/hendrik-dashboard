-- ============================================================
-- 00014: Lead-Eingang je Kunde (Perspective, Meta, Google Ads, allgemeiner Webhook)
--        + Benachrichtigungen für Handwerksbetriebe
-- Idempotent und additiv. Zugriff auf Eingänge/Protokoll nur Team bzw. Server (service_role),
-- Benachrichtigungen sieht der eigene Betrieb.
-- ============================================================

-- ------------------------------------------------------------
-- 1. enum lead_quelle erweitern (google_ads gibt es schon)
-- ------------------------------------------------------------
alter type public.lead_quelle add value if not exists 'perspective';
alter type public.lead_quelle add value if not exists 'meta';
alter type public.lead_quelle add value if not exists 'webhook';

-- ------------------------------------------------------------
-- 2. lead_quellen: ein Eingang je Firma und Art
--    token = geheimer Teil der Webhook-URL /api/webhooks/leads/<token>
--    config: google { key }, meta { page_id, form_ids[], token_env? }, webhook { mapping { feld: "pfad.zum.wert" } }
--    Meta-Seiten-Tokens liegen NICHT hier, sondern in Env-Variablen (META_LEADS_ACCESS_TOKEN / META_PAGE_TOKEN_*).
-- ------------------------------------------------------------
create table if not exists public.lead_quellen (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  art                text not null check (art in ('perspective', 'meta', 'google', 'webhook')),
  name               text not null default '',
  token              text not null unique check (char_length(token) >= 32),
  aktiv              boolean not null default true,
  config             jsonb not null default '{}'::jsonb,
  letzte_eingang_am  timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists lead_quellen_company_idx on public.lead_quellen(company_id);
create index if not exists lead_quellen_meta_page_idx on public.lead_quellen((config ->> 'page_id')) where art = 'meta';

alter table public.lead_quellen enable row level security;

drop policy if exists "lead_quellen_staff" on public.lead_quellen;
create policy "lead_quellen_staff"
  on public.lead_quellen for all
  using (public.is_staff())
  with check (public.is_staff());
-- Kunden: keine Policy (Token/Schlüssel sind geheim) – Zugriff nur über den Server.

-- ------------------------------------------------------------
-- 3. lead_eingang: Rohprotokoll jedes Webhooks
--    unique(quelle_id, external_id) = Sperre gegen doppelte Zustellung.
--    Duplikate/Fehler werden mit external_id = null protokolliert.
-- ------------------------------------------------------------
create table if not exists public.lead_eingang (
  id           uuid primary key default gen_random_uuid(),
  quelle_id    uuid references public.lead_quellen(id) on delete set null,
  company_id   uuid references public.companies(id) on delete cascade,
  external_id  text,
  payload      jsonb,
  status       text not null check (status in ('ok', 'duplikat', 'fehler', 'abgelehnt')),
  fehler       text,
  lead_id      uuid references public.leads(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (quelle_id, external_id)
);

create index if not exists lead_eingang_quelle_idx on public.lead_eingang(quelle_id, created_at desc);
create index if not exists lead_eingang_company_idx on public.lead_eingang(company_id, created_at desc);

alter table public.lead_eingang enable row level security;

drop policy if exists "lead_eingang_staff" on public.lead_eingang;
create policy "lead_eingang_staff"
  on public.lead_eingang for select
  using (public.is_staff());
-- Schreiben nur service_role (Webhooks).

-- ------------------------------------------------------------
-- 4. Neue Spalten an leads
-- ------------------------------------------------------------
alter table public.leads add column if not exists quelle_id      uuid references public.lead_quellen(id) on delete set null;
alter table public.leads add column if not exists external_id    text;
alter table public.leads add column if not exists antworten      jsonb not null default '[]'::jsonb;
alter table public.leads add column if not exists utm            jsonb not null default '{}'::jsonb;
alter table public.leads add column if not exists anzeigengruppe text;
alter table public.leads add column if not exists formular       text;
alter table public.leads add column if not exists kampagne_id    text;
-- Testleads (Knopf „Testlead senden“, is_test der Lead-Systeme) zählen in keiner Kennzahl
alter table public.leads add column if not exists ist_test       boolean not null default false;

create index if not exists leads_quelle_id_idx on public.leads(quelle_id);

-- Voller Unique-Constraint (kein partieller Index), damit upsert/on conflict (company_id, external_id) geht.
-- NULL-Werte in external_id bleiben erlaubt (manuelle Leads).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'leads_company_external_id_key' and conrelid = 'public.leads'::regclass
  ) then
    alter table public.leads
      add constraint leads_company_external_id_key unique (company_id, external_id);
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 5. Benachrichtigungen für den Betrieb (Glocke im Kundenportal)
--    user_id null = für alle Zugänge der Firma
-- ------------------------------------------------------------
create table if not exists public.benachrichtigungen (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade,
  typ         text not null,
  titel       text not null,
  text        text,
  link        text,
  gelesen_am  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists benachrichtigungen_company_idx on public.benachrichtigungen(company_id, created_at desc);
create index if not exists benachrichtigungen_ungelesen_idx on public.benachrichtigungen(company_id) where gelesen_am is null;

alter table public.benachrichtigungen enable row level security;

drop policy if exists "benachrichtigungen_select_company" on public.benachrichtigungen;
create policy "benachrichtigungen_select_company"
  on public.benachrichtigungen for select
  using (
    company_id = public.eigene_company_id()
    and (user_id is null or user_id = auth.uid())
  );

-- Kein Update für Kunden: „gelesen“ setzt die Server-Aktion (Service-Rolle, ohne Impersonation).
-- Eine Update-Policy erlaubte sonst, titel/text/link per PostgREST zu überschreiben.
drop policy if exists "benachrichtigungen_update_company" on public.benachrichtigungen;

drop policy if exists "benachrichtigungen_staff" on public.benachrichtigungen;
create policy "benachrichtigungen_staff"
  on public.benachrichtigungen for select
  using (public.is_staff());

-- ------------------------------------------------------------
-- 6. E-Mail an den Betrieb bei neuem Lead – Standard AUS
-- ------------------------------------------------------------
alter table public.companies add column if not exists benachrichtigung_email boolean not null default false;
