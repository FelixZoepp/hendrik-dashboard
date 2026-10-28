-- ============================================================
-- 00018: Sales-Auswertung für den Handwerker (Kundenportal /auswertung, Team /kunden/auswertung)
-- Idempotent und rein additiv. NICHT automatisch einspielen. Reihenfolge: nach 00013–00017.
--
-- 1. lead_anrufe   – jeder Kontaktversuch (Anruf / WhatsApp) mit Zeitpunkt + Ergebnis
-- 2. lead_termine  – Termine (vor Ort / Telefon / Video) mit Ergebnis und Neuvereinbarung
--                    (ersetzt_termin_id → No-Show-Recovery / Verschiebung)
-- 3. RLS wie leads (Staff alles, Kunde nur eigene Firma; geschrieben wird über den Service-Client)
-- 4. Altdaten: bisherige Anruf-Aktivitäten (lead_activities) einmalig nach lead_anrufe übernehmen
--
-- Zeitstempel je Stufe werden NICHT als Spalten gespeichert, sondern aus den
-- status_wechsel-Aktivitäten (Trigger log_lead_status_change) abgeleitet.
--
-- Bewusst text + CHECK statt neuer Enums: keine „alter type … add value“-Falle
-- (neue Enum-Werte dürfen in derselben Transaktion nicht benutzt werden).
-- Enum-Vergleiche auf lead_activities.typ laufen über ::text, damit diese Datei
-- auch dann gültig ist, wenn 00015 in derselben Transaktion eingespielt wird.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Kontaktversuche
-- ------------------------------------------------------------
create table if not exists public.lead_anrufe (
  id                    uuid primary key default gen_random_uuid(),
  lead_id               uuid not null references public.leads(id) on delete cascade,
  company_id            uuid not null references public.companies(id) on delete cascade,
  user_id               uuid references public.profiles(id) on delete set null,
  am                    timestamptz not null default now(),
  kanal                 text not null default 'anruf',
  -- null = Ergebnis (noch) nicht eingetragen (z. B. WhatsApp geöffnet, Anruf ohne Rückmeldung)
  ergebnis              text,
  dauer_s               integer,
  notiz                 text,
  -- Herkunft bei übernommenen Altdaten (macht die Übernahme wiederholbar)
  quelle_aktivitaet_id  uuid,
  created_at            timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lead_anrufe_kanal_check') then
    alter table public.lead_anrufe
      add constraint lead_anrufe_kanal_check check (kanal in ('anruf', 'whatsapp'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lead_anrufe_ergebnis_check') then
    alter table public.lead_anrufe
      add constraint lead_anrufe_ergebnis_check check (
        ergebnis is null
        or ergebnis in ('erreicht', 'nicht_erreicht', 'mailbox', 'falsche_nummer', 'rueckruf_gewuenscht')
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lead_anrufe_dauer_check') then
    alter table public.lead_anrufe
      add constraint lead_anrufe_dauer_check check (dauer_s is null or dauer_s >= 0);
  end if;
end $$;

create index if not exists lead_anrufe_company_am_idx on public.lead_anrufe(company_id, am desc);
create index if not exists lead_anrufe_lead_am_idx on public.lead_anrufe(lead_id, am);
create unique index if not exists lead_anrufe_quelle_aktivitaet_key
  on public.lead_anrufe(quelle_aktivitaet_id) where quelle_aktivitaet_id is not null;

-- ------------------------------------------------------------
-- 2. Termine
-- ------------------------------------------------------------
create table if not exists public.lead_termine (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            uuid not null references public.leads(id) on delete cascade,
  company_id         uuid not null references public.companies(id) on delete cascade,
  art                text not null default 'vor_ort',
  beginn             timestamptz not null,
  status             text not null default 'geplant',
  -- Neuvereinbarung nach No-Show/Verschiebung: zeigt auf den alten Termin
  ersetzt_termin_id  uuid references public.lead_termine(id) on delete set null,
  notiz              text,
  -- wann das Ergebnis (stattgefunden / nicht erschienen …) eingetragen wurde
  ergebnis_am        timestamptz,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.profiles(id) on delete set null,
  updated_at         timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lead_termine_art_check') then
    alter table public.lead_termine
      add constraint lead_termine_art_check check (art in ('vor_ort', 'telefon', 'video'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lead_termine_status_check') then
    alter table public.lead_termine
      add constraint lead_termine_status_check check (
        status in ('geplant', 'stattgefunden', 'nicht_erschienen', 'abgesagt', 'verschoben')
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lead_termine_nicht_selbst_check') then
    alter table public.lead_termine
      add constraint lead_termine_nicht_selbst_check check (ersetzt_termin_id is null or ersetzt_termin_id <> id);
  end if;
end $$;

create index if not exists lead_termine_company_beginn_idx on public.lead_termine(company_id, beginn desc);
create index if not exists lead_termine_lead_idx on public.lead_termine(lead_id, beginn);
create index if not exists lead_termine_ersetzt_idx on public.lead_termine(ersetzt_termin_id) where ersetzt_termin_id is not null;
-- „Wie war der Termin?“: offene Termine je Firma
create index if not exists lead_termine_offen_idx on public.lead_termine(company_id, beginn) where status = 'geplant';

drop trigger if exists lead_termine_updated_at on public.lead_termine;
create trigger lead_termine_updated_at
  before update on public.lead_termine
  for each row execute function public.update_updated_at();

-- ------------------------------------------------------------
-- 3. RLS (Portal schreibt über den Service-Client; Policies für direkte Lesezugriffe)
-- ------------------------------------------------------------
alter table public.lead_anrufe enable row level security;
alter table public.lead_termine enable row level security;

drop policy if exists "lead_anrufe_staff" on public.lead_anrufe;
create policy "lead_anrufe_staff"
  on public.lead_anrufe for all
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "lead_anrufe_select_company" on public.lead_anrufe;
create policy "lead_anrufe_select_company"
  on public.lead_anrufe for select
  using (company_id = (select p.company_id from public.profiles p where p.id = auth.uid()));

drop policy if exists "lead_termine_staff" on public.lead_termine;
create policy "lead_termine_staff"
  on public.lead_termine for all
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "lead_termine_select_company" on public.lead_termine;
create policy "lead_termine_select_company"
  on public.lead_termine for select
  using (company_id = (select p.company_id from public.profiles p where p.id = auth.uid()));

-- ------------------------------------------------------------
-- 4. Altdaten übernehmen (wiederholbar über quelle_aktivitaet_id)
--    Bisheriger Ablauf: „Anrufen“ → Aktivität anruf „Angerufen“,
--    danach „Erreicht“ (anruf) bzw. nicht_erreicht „Nicht erreicht (n. Versuch)…“.
--    Der neue Code schreibt andere Texte („Anruf gestartet“, „Anruf: …“, „WhatsApp gestartet“)
--    und trägt lead_anrufe selbst ein → diese Zeilen werden hier nie doppelt übernommen.
-- ------------------------------------------------------------

-- 4a. Ergebnisse: Zeitpunkt = letzter „Angerufen“-Tipp bis 3 Std. davor, sonst Zeitpunkt des Ergebnisses
insert into public.lead_anrufe (lead_id, company_id, user_id, am, kanal, ergebnis, quelle_aktivitaet_id)
select
  a.lead_id,
  l.company_id,
  a.user_id,
  coalesce(
    (select max(b.created_at)
       from public.lead_activities b
      where b.lead_id = a.lead_id
        and b.typ::text = 'anruf'
        and b.inhalt = 'Angerufen'
        and b.created_at <= a.created_at
        and b.created_at >= a.created_at - interval '3 hours'),
    a.created_at
  ),
  'anruf',
  case when a.typ::text = 'anruf' then 'erreicht' else 'nicht_erreicht' end,
  a.id
from public.lead_activities a
join public.leads l on l.id = a.lead_id
where (a.typ::text = 'anruf' and a.inhalt = 'Erreicht')
   or (a.typ::text = 'nicht_erreicht' and a.inhalt like 'Nicht erreicht%')
on conflict do nothing;

-- 4b. „Angerufen“ ohne eingetragenes Ergebnis in den 3 Std. danach → Versuch ohne Ergebnis
insert into public.lead_anrufe (lead_id, company_id, user_id, am, kanal, ergebnis, quelle_aktivitaet_id)
select a.lead_id, l.company_id, a.user_id, a.created_at, 'anruf', null, a.id
from public.lead_activities a
join public.leads l on l.id = a.lead_id
where a.typ::text = 'anruf'
  and a.inhalt = 'Angerufen'
  and not exists (
    select 1 from public.lead_activities r
     where r.lead_id = a.lead_id
       and ((r.typ::text = 'anruf' and r.inhalt = 'Erreicht')
            or (r.typ::text = 'nicht_erreicht' and r.inhalt like 'Nicht erreicht%'))
       and r.created_at >= a.created_at
       and r.created_at <= a.created_at + interval '3 hours'
  )
on conflict do nothing;

-- 4c. WhatsApp geöffnet → Kontaktversuch per WhatsApp
insert into public.lead_anrufe (lead_id, company_id, user_id, am, kanal, ergebnis, quelle_aktivitaet_id)
select a.lead_id, l.company_id, a.user_id, a.created_at, 'whatsapp', null, a.id
from public.lead_activities a
join public.leads l on l.id = a.lead_id
where a.typ::text = 'whatsapp'
  and a.inhalt = 'WhatsApp geöffnet'
on conflict do nothing;
