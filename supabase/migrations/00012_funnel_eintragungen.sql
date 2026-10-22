-- ============================================================
-- Funnel-Eintragungen (Perspective & Co.) → Close-Lead, PDF-Report per WhatsApp,
-- 10-Min.-Prüfung „Termin gebucht?“, sonst Close-Aufgabe + Slack + WhatsApp-Erinnerung (werktags 8–20 Uhr).
-- Jede Stufe hat einen eigenen Status; der minütliche WhatsApp-Cron arbeitet fällige Stufen ab.
-- Zugriff nur serverseitig (service_role), RLS ohne Policies.
-- ============================================================

create table public.funnel_eintragungen (
  id                   uuid primary key default gen_random_uuid(),
  -- Perspective-Eintrags-ID (gegen doppelte Webhooks), sonst null
  external_id          text unique,
  -- Kurzname des Funnels (URL-Parameter funnel=…), Einstellungen in wa_einstellungen.funnels
  funnel               text not null,
  funnel_name          text,
  -- Token für den Buchungs-Knopf /b/<token>
  token                text not null unique check (char_length(token) >= 10),
  name                 text,
  vorname              text,
  firma                text,
  email                text,
  telefon              text, -- E.164
  telefon_roh          text,
  opt_in               boolean not null default false,
  antworten            jsonb not null default '[]'::jsonb,
  utm                  jsonb not null default '{}'::jsonb,
  payload              jsonb,
  eingetragen_am       timestamptz not null default now(),

  -- Close: Lead anlegen bzw. vorhandenen ergänzen
  close_status         text not null default 'offen'
                       check (close_status in ('offen', 'laeuft', 'erledigt', 'fehler')),
  close_versuche       integer not null default 0,
  close_lead_id        text,
  close_neu            boolean,

  -- PDF-Report per WhatsApp (nur Funnels mit Report)
  report_status        text not null default 'keiner'
                       check (report_status in ('keiner', 'offen', 'laeuft', 'gesendet', 'uebersprungen', 'fehler')),

  -- 10-Min.-Prüfung: Termin gebucht?
  pruefen_am           timestamptz not null,
  pruef_status         text not null default 'offen'
                       check (pruef_status in ('offen', 'laeuft', 'erledigt', 'fehler')),
  ergebnis             text check (ergebnis in ('direkt_gebucht', 'nicht_gebucht', 'spaeter_gebucht')),
  gebucht_am           timestamptz,
  aufgabe_id           text,

  -- WhatsApp-Erinnerung „Termin buchen“ (werktags 8–20 Uhr)
  erinnerung_am        timestamptz,
  erinnerung_status    text not null default 'keine'
                       check (erinnerung_status in ('keine', 'offen', 'laeuft', 'gesendet', 'uebersprungen', 'fehler')),
  geklickt_am          timestamptz,

  claimed_at           timestamptz,
  fehler               text,
  verlauf              jsonb not null default '[]'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index funnel_eintragungen_eingetragen_idx on public.funnel_eintragungen(eingetragen_am desc);
create index funnel_eintragungen_close_idx on public.funnel_eintragungen(close_status);
create index funnel_eintragungen_pruef_idx on public.funnel_eintragungen(pruef_status, pruefen_am);
create index funnel_eintragungen_erinnerung_idx on public.funnel_eintragungen(erinnerung_status, erinnerung_am);
create index funnel_eintragungen_telefon_idx on public.funnel_eintragungen(telefon);
create index funnel_eintragungen_email_idx on public.funnel_eintragungen(lower(email));

create trigger funnel_eintragungen_updated_at
  before update on public.funnel_eintragungen
  for each row execute function public.update_updated_at();

alter table public.funnel_eintragungen enable row level security;
revoke all on public.funnel_eintragungen from anon, authenticated;

-- Schalter (alle aus) und Funnel-Einstellungen
insert into public.wa_einstellungen (key, wert) values
  ('funnel_close_aktiv', 'false'::jsonb),
  ('funnel_whatsapp_aktiv', 'false'::jsonb),
  ('funnels', '{}'::jsonb)
on conflict (key) do nothing;
