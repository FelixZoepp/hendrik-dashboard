-- ============================================================
-- Phase 2: Sales-Sync — Close + Calendly Spiegel-Tabellen
-- ============================================================

-- ============================================================
-- close_users
-- ============================================================
create table public.close_users (
  id            uuid primary key default gen_random_uuid(),
  close_id      text unique not null,
  name          text not null,
  email         text,
  rolle         text not null default 'opener' check (rolle in ('opener', 'setter', 'closer')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger close_users_updated_at
  before update on public.close_users
  for each row execute function public.update_updated_at();

-- ============================================================
-- close_leads
-- ============================================================
create table public.close_leads (
  id              uuid primary key default gen_random_uuid(),
  close_id        text unique not null,
  name            text,
  status_label    text,
  status_type     text,
  date_created    timestamptz,
  date_updated    timestamptz,
  lead_source     text,
  assigned_user   text, -- close user id
  custom_fields   jsonb default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index close_leads_close_id_idx on public.close_leads(close_id);
create index close_leads_date_created_idx on public.close_leads(date_created desc);

create trigger close_leads_updated_at
  before update on public.close_leads
  for each row execute function public.update_updated_at();

-- ============================================================
-- close_opportunities
-- ============================================================
create table public.close_opportunities (
  id              uuid primary key default gen_random_uuid(),
  close_id        text unique not null,
  lead_id         text, -- close lead id (FK zu close_leads.close_id)
  value           numeric(12,2),
  value_period    text,
  status_label    text,
  status_type     text, -- active, won, lost
  confidence      integer,
  date_won        timestamptz,
  user_id         text, -- close user id
  date_created    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index close_opps_lead_id_idx on public.close_opportunities(lead_id);
create index close_opps_status_type_idx on public.close_opportunities(status_type);

create trigger close_opps_updated_at
  before update on public.close_opportunities
  for each row execute function public.update_updated_at();

-- ============================================================
-- close_activities
-- ============================================================
create table public.close_activities (
  id              uuid primary key default gen_random_uuid(),
  close_id        text unique not null,
  lead_id         text,
  type            text not null, -- call, email, sms, note, meeting
  direction       text, -- inbound, outbound
  duration        integer, -- sekunden
  user_id         text, -- close user id
  date_created    timestamptz,
  disposition     text,
  created_at      timestamptz not null default now()
);

create index close_activities_lead_id_idx on public.close_activities(lead_id);
create index close_activities_user_id_idx on public.close_activities(user_id);
create index close_activities_date_idx on public.close_activities(date_created desc);
create index close_activities_type_idx on public.close_activities(type);

-- ============================================================
-- calendly_events
-- ============================================================
create table public.calendly_events (
  id              uuid primary key default gen_random_uuid(),
  calendly_uri    text unique not null,
  event_type_name text,
  invitee_name    text,
  invitee_email   text,
  scheduled_at    timestamptz,
  created_at      timestamptz not null default now(),
  status          text not null default 'active' check (status in ('active', 'canceled')),
  canceled_by     text, -- invitee, host
  cancel_reason   text,
  no_show         boolean not null default false,
  host_email      text,
  utm             jsonb default '{}'::jsonb
);

create index calendly_events_scheduled_idx on public.calendly_events(scheduled_at desc);
create index calendly_events_status_idx on public.calendly_events(status);
create index calendly_events_host_idx on public.calendly_events(host_email);

-- ============================================================
-- sync_log (für Delta-Sync Tracking)
-- ============================================================
create table public.sync_log (
  id          uuid primary key default gen_random_uuid(),
  source      text not null, -- 'close', 'calendly', 'meta'
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  records     integer default 0,
  status      text not null default 'running' check (status in ('running', 'success', 'error')),
  error       text
);

-- ============================================================
-- RLS — nur Staff darf Sync-Daten sehen
-- ============================================================
alter table public.close_users enable row level security;
alter table public.close_leads enable row level security;
alter table public.close_opportunities enable row level security;
alter table public.close_activities enable row level security;
alter table public.calendly_events enable row level security;
alter table public.sync_log enable row level security;

create policy "close_users_staff" on public.close_users for all using (public.is_staff());
create policy "close_leads_staff" on public.close_leads for all using (public.is_staff());
create policy "close_opps_staff" on public.close_opportunities for all using (public.is_staff());
create policy "close_activities_staff" on public.close_activities for all using (public.is_staff());
create policy "calendly_events_staff" on public.calendly_events for all using (public.is_staff());
create policy "sync_log_staff" on public.sync_log for all using (public.is_staff());
