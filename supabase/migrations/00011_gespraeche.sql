-- ============================================================
-- Gesprächsanalyse: Close-Telefonate (Aufnahme) → Fireflies (Transkript) → KI-Analyse
-- Opening (Cold Call der Opener), Setting und Closing (Hendrik): Einwände, Abbrüche, Coaching.
--
-- Zugriff ausschließlich serverseitig über den Admin-Client (service_role).
-- RLS ist aktiv und es gibt bewusst KEINE Policies → anon/authenticated sehen nichts.
-- ============================================================

-- ------------------------------------------------------------
-- Ein Datensatz je Close-Call (angenommen, mit Aufnahme, ≥ 15 s)
-- ------------------------------------------------------------
create table public.gespraeche (
  call_id         text primary key,
  lead_id         text,
  lead_name       text,
  user_id         text,
  user_name       text,
  richtung        text check (richtung in ('outbound', 'inbound')),
  datum           timestamptz not null,
  dauer_sek       integer,
  disposition     text,
  -- Close-Link zur Aufnahme (nur mit API-Key abrufbar; leitet auf signierten Download um)
  aufnahme_url    text,
  -- vorläufig aus Kontext (Opener/Termin/Protokoll), nach der Analyse von der KI
  phase           text not null default 'sonstiges'
                  check (phase in ('opening', 'setting', 'closing', 'sonstiges')),
  phase_grund     text,
  status          text not null default 'neu'
                  check (status in ('neu', 'hochgeladen', 'transkribiert', 'analysiert', 'uebersprungen', 'fehler')),
  -- Titel beim Fireflies-Upload (enthält die call_id → Wiederfinden ohne Webhook)
  fireflies_titel text,
  fireflies_id    text unique,
  hochgeladen_am  timestamptz,
  transkript      jsonb,       -- [{speaker_name, text, start_time}]
  ergebnis        jsonb,       -- KI-Analyse (Schema: src/lib/gespraeche/logik.ts)
  modell          text,
  punkte          integer check (punkte between 0 and 100),
  fehler          text,
  versuche        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index gespraeche_datum_idx on public.gespraeche(datum desc);
create index gespraeche_status_idx on public.gespraeche(status, datum);
create index gespraeche_phase_idx on public.gespraeche(phase, datum desc);
create index gespraeche_lead_idx on public.gespraeche(lead_id);
create index gespraeche_user_idx on public.gespraeche(user_name, datum desc);

-- ------------------------------------------------------------
-- Fireflies-Tagesbudget (zählt ALLE Fireflies-Aufrufe, Berliner Tag)
-- ------------------------------------------------------------
create table public.gespraeche_budget (
  tag           date primary key,
  aufrufe       integer not null default 0,
  -- Fireflies hat mit Rate-Limit geantwortet → heute nichts mehr
  gesperrt      boolean not null default false,
  -- letzte Suche nach Transkripten ohne Webhook (gedrosselt)
  suche_am      timestamptz,
  updated_at    timestamptz not null default now()
);

-- Einen Aufruf atomar aus dem Budget nehmen: true = darf aufrufen
create or replace function public.gespraeche_budget_nehmen(p_tag date, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  insert into public.gespraeche_budget (tag) values (p_tag) on conflict (tag) do nothing;
  update public.gespraeche_budget
     set aufrufe = aufrufe + 1, updated_at = now()
   where tag = p_tag and not gesperrt and aufrufe < p_limit
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

-- Rate-Limit erkannt → Tag sperren
create or replace function public.gespraeche_budget_sperren(p_tag date)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.gespraeche_budget (tag, gesperrt) values (p_tag, true)
  on conflict (tag) do update set gesperrt = true, updated_at = now();
$$;

revoke all on function public.gespraeche_budget_nehmen(date, integer) from public, anon, authenticated;
revoke all on function public.gespraeche_budget_sperren(date) from public, anon, authenticated;
grant execute on function public.gespraeche_budget_nehmen(date, integer) to service_role;
grant execute on function public.gespraeche_budget_sperren(date) to service_role;

-- ------------------------------------------------------------
-- RLS: nur service_role (umgeht RLS); keine Policies für anon/authenticated
-- ------------------------------------------------------------
alter table public.gespraeche enable row level security;
alter table public.gespraeche_budget enable row level security;
