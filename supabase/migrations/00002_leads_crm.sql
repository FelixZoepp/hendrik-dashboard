-- ============================================================
-- Phase 1: Kunden-CRM — leads, lead_activities, lead_sla
-- ============================================================

-- Lead-Status Enum
create type public.lead_status as enum (
  'neu',
  'kontaktiert',
  'termin_vereinbart',
  'vor_ort_termin',
  'angebot_raus',
  'gewonnen',
  'verloren',
  'kein_interesse',
  'nicht_erreicht'
);

-- Lead-Quelle Enum
create type public.lead_quelle as enum (
  'google_ads',
  'onepage',
  'manuell',
  'empfehlung'
);

-- Lead-Aktivitätstyp Enum
create type public.lead_activity_typ as enum (
  'anruf',
  'notiz',
  'status_wechsel',
  'email',
  'whatsapp'
);

-- Verlustgrund Enum
create type public.verlust_grund as enum (
  'zu_teuer',
  'kein_bedarf_mehr',
  'anderer_anbieter',
  'nicht_erreicht',
  'unpassende_anfrage'
);

-- ============================================================
-- leads
-- ============================================================
create table public.leads (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  vorname           text not null default '',
  nachname          text not null default '',
  telefon           text,
  email             text,
  plz               text,
  ort               text,
  anliegen          text,
  quelle            public.lead_quelle not null default 'manuell',
  campaign          text,
  form_payload      jsonb,
  created_at        timestamptz not null default now(),
  first_contact_at  timestamptz,
  status            public.lead_status not null default 'neu',
  assigned_to       uuid references public.profiles(id),
  angebotswert      numeric(12,2),
  auftragswert      numeric(12,2),
  verlust_grund     public.verlust_grund,
  naechste_aktion_am timestamptz,
  updated_at        timestamptz not null default now()
);

-- Indizes für häufige Queries
create index leads_company_id_idx on public.leads(company_id);
create index leads_status_idx on public.leads(status);
create index leads_created_at_idx on public.leads(created_at desc);
create index leads_company_status_idx on public.leads(company_id, status);

-- updated_at Trigger
create trigger leads_updated_at
  before update on public.leads
  for each row execute function public.update_updated_at();

-- ============================================================
-- lead_activities (append-only Aktivitätsverlauf)
-- ============================================================
create table public.lead_activities (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  user_id     uuid references public.profiles(id),
  typ         public.lead_activity_typ not null,
  inhalt      text,
  alt_status  public.lead_status,
  neu_status  public.lead_status,
  created_at  timestamptz not null default now()
);

create index lead_activities_lead_id_idx on public.lead_activities(lead_id);
create index lead_activities_created_at_idx on public.lead_activities(created_at desc);

-- ============================================================
-- Trigger: Automatischer Aktivitätseintrag bei Statuswechsel
-- ============================================================
create or replace function public.log_lead_status_change()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if old.status is distinct from new.status then
    insert into public.lead_activities (lead_id, user_id, typ, alt_status, neu_status, inhalt)
    values (
      new.id,
      auth.uid(),
      'status_wechsel',
      old.status,
      new.status,
      'Status geändert: ' || old.status || ' → ' || new.status
    );
  end if;
  return new;
end;
$$;

create trigger lead_status_change_log
  after update of status on public.leads
  for each row execute function public.log_lead_status_change();

-- ============================================================
-- Trigger: first_contact_at einmalig setzen
-- ============================================================
create or replace function public.set_first_contact()
returns trigger
language plpgsql
as $$
begin
  if old.first_contact_at is null
    and new.status != 'neu'
    and new.first_contact_at is null then
    new.first_contact_at = now();
  end if;
  -- Einmal gesetzt, nie überschreiben
  if old.first_contact_at is not null then
    new.first_contact_at = old.first_contact_at;
  end if;
  return new;
end;
$$;

create trigger lead_first_contact
  before update on public.leads
  for each row execute function public.set_first_contact();

-- ============================================================
-- Trigger: Pflichtfelder bei gewonnen/verloren
-- ============================================================
create or replace function public.validate_lead_close()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'gewonnen' and new.auftragswert is null then
    raise exception 'Auftragswert ist Pflicht bei Status "gewonnen"';
  end if;
  if new.status = 'verloren' and new.verlust_grund is null then
    raise exception 'Verlustgrund ist Pflicht bei Status "verloren"';
  end if;
  return new;
end;
$$;

create trigger lead_close_validation
  before update of status on public.leads
  for each row execute function public.validate_lead_close();

-- ============================================================
-- View: lead_sla (Reaktionszeit-Ampel)
-- ============================================================
create or replace view public.lead_sla as
select
  l.id,
  l.company_id,
  l.vorname,
  l.nachname,
  l.status,
  l.created_at,
  l.first_contact_at,
  case
    when l.first_contact_at is not null then
      extract(epoch from (l.first_contact_at - l.created_at)) / 60.0
    else
      extract(epoch from (now() - l.created_at)) / 60.0
  end as reaktionszeit_minuten,
  case
    when l.first_contact_at is not null then
      case
        when extract(epoch from (l.first_contact_at - l.created_at)) / 60.0 < 15 then 'gruen'
        when extract(epoch from (l.first_contact_at - l.created_at)) / 60.0 < 60 then 'gelb'
        else 'rot'
      end
    else
      case
        when extract(epoch from (now() - l.created_at)) / 60.0 < 15 then 'gruen'
        when extract(epoch from (now() - l.created_at)) / 60.0 < 60 then 'gelb'
        else 'rot'
      end
  end as ampel
from public.leads l;

-- ============================================================
-- Webhook-Fehlerlog
-- ============================================================
create table public.webhook_errors (
  id          uuid primary key default gen_random_uuid(),
  endpoint    text not null,
  payload     jsonb,
  error       text,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- Company-Formular-Mapping (OnePage → company_id)
-- ============================================================
create table public.company_form_mappings (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  form_id     text not null,
  campaign    text,
  created_at  timestamptz not null default now(),
  unique(form_id)
);

-- ============================================================
-- RLS für leads
-- ============================================================
alter table public.leads enable row level security;

-- Staff sieht alle Leads
create policy "leads_select_staff"
  on public.leads for select
  using (public.is_staff());

-- Client sieht nur Leads seiner Company
create policy "leads_select_company"
  on public.leads for select
  using (
    company_id = (
      select p.company_id from public.profiles p where p.id = auth.uid()
    )
  );

-- Staff kann Leads anlegen
create policy "leads_insert_staff"
  on public.leads for insert
  with check (public.is_staff());

-- Client kann Leads anlegen (für manuelle Eingabe)
create policy "leads_insert_company"
  on public.leads for insert
  with check (
    company_id = (
      select p.company_id from public.profiles p where p.id = auth.uid()
    )
  );

-- Client kann eigene Company-Leads updaten
create policy "leads_update_company"
  on public.leads for update
  using (
    company_id = (
      select p.company_id from public.profiles p where p.id = auth.uid()
    )
  );

-- Staff kann alle Leads updaten
create policy "leads_update_staff"
  on public.leads for update
  using (public.is_staff());

-- Kein DELETE — Leads werden nie gelöscht

-- ============================================================
-- RLS für lead_activities (append-only für Clients)
-- ============================================================
alter table public.lead_activities enable row level security;

-- Staff sieht alle
create policy "activities_select_staff"
  on public.lead_activities for select
  using (public.is_staff());

-- Client sieht Aktivitäten seiner Leads
create policy "activities_select_company"
  on public.lead_activities for select
  using (
    lead_id in (
      select l.id from public.leads l
      where l.company_id = (
        select p.company_id from public.profiles p where p.id = auth.uid()
      )
    )
  );

-- Client kann Aktivitäten einfügen (Notizen, Anrufe)
create policy "activities_insert_company"
  on public.lead_activities for insert
  with check (
    lead_id in (
      select l.id from public.leads l
      where l.company_id = (
        select p.company_id from public.profiles p where p.id = auth.uid()
      )
    )
  );

-- Staff kann Aktivitäten einfügen
create policy "activities_insert_staff"
  on public.lead_activities for insert
  with check (public.is_staff());

-- KEIN UPDATE/DELETE für Clients — append-only
-- Staff darf auch nicht löschen — Audit-Trail

-- ============================================================
-- RLS für webhook_errors (nur Staff)
-- ============================================================
alter table public.webhook_errors enable row level security;

create policy "webhook_errors_staff"
  on public.webhook_errors for select
  using (public.is_staff());

-- ============================================================
-- RLS für company_form_mappings (nur Staff)
-- ============================================================
alter table public.company_form_mappings enable row level security;

create policy "form_mappings_staff"
  on public.company_form_mappings for all
  using (public.is_staff());
