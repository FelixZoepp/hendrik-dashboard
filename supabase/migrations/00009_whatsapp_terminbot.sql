-- ============================================================
-- WhatsApp-Terminbot (WhatsApp Cloud API von Meta)
-- Termine aus Calendly und Close-Protokollen → Bestätigung, Erinnerung,
-- „gleich geht's los“, No-Show- und Absage-Nachricht.
--
-- Zugriff ausschließlich serverseitig über den Admin-Client (service_role).
-- RLS ist aktiv und es gibt bewusst KEINE Policies → anon/authenticated sehen nichts.
-- ============================================================

-- ------------------------------------------------------------
-- Einstellungen (Schlüssel/Wert)
-- ------------------------------------------------------------
create table public.wa_einstellungen (
  key         text primary key,
  wert        jsonb,
  updated_at  timestamptz not null default now()
);

insert into public.wa_einstellungen (key, wert) values
  ('bot_aktiv', 'false'::jsonb),
  ('testnummern', '[]'::jsonb),
  ('vorlagen_aktiv', jsonb_build_object(
    'hs_erstgespraech_gebucht', false,
    'hs_erstgespraech_erinnerung', false,
    'hs_erstgespraech_gleich', false,
    'hs_strategie_gebucht', false,
    'hs_strategie_erinnerung', false,
    'hs_strategie_gleich', false,
    'hs_termin_verpasst', false,
    'hs_termin_abgesagt', false
  )),
  ('close_optin_feld', 'null'::jsonb),
  ('videos', jsonb_build_object('erstgespraech', null, 'strategie', null)),
  ('buchungslinks', jsonb_build_object('erstgespraech', null, 'strategie', null))
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- Termine (ein Datensatz je Gespräch, Calendly + Close zusammengeführt)
-- ------------------------------------------------------------
create table public.wa_termine (
  id                    uuid primary key default gen_random_uuid(),
  token                 text not null unique check (char_length(token) >= 10),
  art                   text not null check (art in ('erstgespraech', 'strategie')),
  quelle                text not null check (quelle in ('calendly', 'close')),
  calendly_event_uri    text unique,
  calendly_invitee_uri  text,
  reschedule_url        text,
  cancel_url            text,
  join_url              text,
  ort_text              text,
  close_lead_id         text,
  close_opp_id          text,
  -- Protokoll, das den Termin gelegt hat (je Protokoll höchstens ein Termin)
  close_protokoll_id    text unique,
  -- Protokoll, das das Ergebnis (No-Show/stattgefunden) festgehalten hat
  ergebnis_protokoll_id text unique,
  -- Zuständige Person in Close (gelegtAuf bzw. Calendly-Gastgeber) für Aufgaben
  close_user_id         text,
  gastgeber_name        text,
  vorname               text,
  name                  text,
  firma                 text,
  telefon               text, -- E.164
  email                 text,
  start_at              timestamptz not null,
  ende_at               timestamptz,
  status                text not null default 'geplant'
                        check (status in ('geplant', 'abgesagt', 'stattgefunden', 'verpasst')),
  opt_in                boolean not null default false,
  bestaetigt_am         timestamptz,
  verschieben_am        timestamptz,
  abgesagt_am           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index wa_termine_start_idx on public.wa_termine(start_at);
create index wa_termine_telefon_idx on public.wa_termine(telefon);
create index wa_termine_lead_idx on public.wa_termine(close_lead_id);
create index wa_termine_email_idx on public.wa_termine(lower(email));

create trigger wa_termine_updated_at
  before update on public.wa_termine
  for each row execute function public.update_updated_at();

-- ------------------------------------------------------------
-- Jobs (je Termin und Typ genau einer → voller Unique-Constraint für upsert)
-- ------------------------------------------------------------
create table public.wa_jobs (
  id          uuid primary key default gen_random_uuid(),
  termin_id   uuid not null references public.wa_termine(id) on delete cascade,
  typ         text not null
              check (typ in ('gebucht', 'erinnerung', 'unbestaetigt_check', 'gleich', 'verpasst', 'abgesagt')),
  run_at      timestamptz not null,
  -- Feste Deadline: Überfälligkeit (15 Min.) zählt ab hier; Wiederholungen verschieben sie nicht
  faellig_urspruenglich timestamptz not null,
  status      text not null default 'geplant'
              check (status in ('geplant', 'laeuft', 'erledigt', 'uebersprungen', 'abgebrochen', 'fehler')),
  versuche    integer not null default 0,
  fehler      text,
  ergebnis    text,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now(),
  constraint wa_jobs_termin_typ_key unique (termin_id, typ)
);

create index wa_jobs_faellig_idx on public.wa_jobs(status, run_at);

-- ------------------------------------------------------------
-- Nachrichten (ein- und ausgehend)
-- ------------------------------------------------------------
create table public.wa_nachrichten (
  id              uuid primary key default gen_random_uuid(),
  richtung        text not null check (richtung in ('aus', 'ein')),
  telefon         text not null,
  termin_id       uuid references public.wa_termine(id) on delete set null,
  close_lead_id   text,
  typ             text, -- template, text, video, button, interactive …
  vorlage         text,
  body            text,
  wa_message_id   text unique,
  -- Versand-Reservierung gegen Doppel-Versand (Telefon|Vorlage|Termin); bei eindeutigem Fehler wieder null
  versand_schluessel text unique,
  status          text not null
                  check (status in ('reserviert', 'gesendet', 'zugestellt', 'gelesen', 'fehlgeschlagen', 'empfangen')),
  fehler          text,
  payload         jsonb,
  created_at      timestamptz not null default now()
);

create index wa_nachrichten_created_idx on public.wa_nachrichten(created_at desc);
create index wa_nachrichten_termin_idx on public.wa_nachrichten(termin_id);
create index wa_nachrichten_telefon_idx on public.wa_nachrichten(telefon);

-- ------------------------------------------------------------
-- Eingang: Rohereignisse von Meta (vor der 200-Antwort gespeichert, Cron arbeitet nach)
-- ------------------------------------------------------------
create table public.wa_eingang (
  id             uuid primary key default gen_random_uuid(),
  wa_message_id  text not null unique,
  payload        jsonb not null,
  status         text not null default 'neu' check (status in ('neu', 'verarbeitet', 'fehler')),
  versuche       integer not null default 0,
  fehler         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index wa_eingang_offen_idx on public.wa_eingang(status, created_at);

-- ------------------------------------------------------------
-- Kontakte (Abmeldung + 24-h-Servicefenster)
-- ------------------------------------------------------------
create table public.wa_kontakte (
  telefon        text primary key,
  opt_out        boolean not null default false,
  fenster_bis    timestamptz,
  close_lead_id  text,
  updated_at     timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Vorlagen-Status bei Meta
-- ------------------------------------------------------------
create table public.wa_vorlagen (
  name              text primary key,
  kategorie         text,
  sprache           text,
  status            text, -- Meta: APPROVED, PENDING, REJECTED, PAUSED, DISABLED …
  meta_id           text,
  ablehnungsgrund   text,
  eingereicht_am    timestamptz,
  geprueft_am       timestamptz
);

-- ------------------------------------------------------------
-- RLS: nur service_role (umgeht RLS); keine Policies für anon/authenticated
-- ------------------------------------------------------------
alter table public.wa_einstellungen enable row level security;
alter table public.wa_termine enable row level security;
alter table public.wa_jobs enable row level security;
alter table public.wa_nachrichten enable row level security;
alter table public.wa_kontakte enable row level security;
alter table public.wa_eingang enable row level security;
alter table public.wa_vorlagen enable row level security;

revoke all on public.wa_einstellungen, public.wa_termine, public.wa_jobs,
  public.wa_nachrichten, public.wa_kontakte, public.wa_vorlagen, public.wa_eingang
  from anon, authenticated;

-- ------------------------------------------------------------
-- Fällige Jobs sperren und übernehmen (mehrere Cron-Läufe parallel möglich).
-- Hängende 'laeuft'-Jobs (> 5 Min.) werden NICHT erneut gesendet, sondern als
-- 'fehler' (Ergebnis unklar) markiert — lieber keine als eine doppelte Nachricht.
-- ------------------------------------------------------------
create or replace function public.wa_jobs_claim(p_limit integer default 5)
returns setof public.wa_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.wa_jobs
     set status = 'fehler',
         fehler = 'Ergebnis unklar: Bearbeitung brach nach mehr als 5 Min. ab — bitte prüfen, kein automatischer Neuversand'
   where status = 'laeuft'
     and claimed_at < now() - interval '5 minutes';

  return query
  update public.wa_jobs j
     set status = 'laeuft',
         claimed_at = now(),
         versuche = j.versuche + 1
   where j.id in (
     select x.id
       from public.wa_jobs x
      where x.status = 'geplant' and x.run_at <= now()
      order by x.run_at
      limit p_limit
      for update skip locked
   )
  returning j.*;
end;
$$;

revoke all on function public.wa_jobs_claim(integer) from public, anon, authenticated;
grant execute on function public.wa_jobs_claim(integer) to service_role;
