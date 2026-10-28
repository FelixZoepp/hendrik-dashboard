-- ============================================================
-- 00015: CRM für den Handwerker (Kundenportal /leads, /dashboard)
-- Idempotent und additiv. Nicht automatisch einspielen.
--
-- 1. Enum-Werte: Verlustgrund „sonstiges“, Aktivitäten „nicht_erreicht“ + „rueckruf“
-- 2. Spalten: kontakt_versuche, verlust_notiz, geaendert_von
-- 3. Status-Protokoll: EINE Quelle = Trigger log_lead_status_change
--
-- Warum der Trigger die einzige Quelle ist (statt der Server-Action):
--   Bisher schrieben Trigger UND Action je einen Eintrag → doppelte Status-Zeilen im Verlauf.
--   Der Trigger erfasst jeden Weg (Portal, Team, SQL-Konsole, künftige Webhooks) — die Action
--   nur ihren eigenen. Problem bisher: Die Portal-Actions laufen über den Service-Client,
--   dort ist auth.uid() null → „wer“ fehlte. Lösung: Die Action setzt im selben UPDATE
--   leads.geaendert_von = <Profil-ID>; der Trigger liest coalesce(auth.uid(), geaendert_von)
--   und leert die Spalte danach wieder (BEFORE-Trigger), damit sie nie veraltet an einer
--   späteren Änderung (z. B. SQL-Konsole) hängt. Die Action schreibt selbst KEINEN
--   status_wechsel-Eintrag mehr.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Enum-Werte (ADD VALUE IF NOT EXISTS ist idempotent; die neuen Werte
--    werden in dieser Datei nicht benutzt → auch in einer Transaktion zulässig)
-- ------------------------------------------------------------
alter type public.verlust_grund add value if not exists 'sonstiges';
alter type public.lead_activity_typ add value if not exists 'nicht_erreicht';
alter type public.lead_activity_typ add value if not exists 'rueckruf';

-- ------------------------------------------------------------
-- 2. Spalten
-- ------------------------------------------------------------
-- Zähler für „Nicht erreicht“ (Kontaktversuche ohne Erfolg)
alter table public.leads add column if not exists kontakt_versuche integer not null default 0;
-- Freitext zum Verlustgrund (v. a. bei „sonstiges“)
alter table public.leads add column if not exists verlust_notiz text;
-- Transportspalte: wer ändert gerade den Status (nur für den Trigger, wird sofort geleert)
alter table public.leads add column if not exists geaendert_von uuid references public.profiles(id) on delete set null;

-- Fällige Rückrufe je Firma („Heute anrufen“)
create index if not exists leads_company_naechste_aktion_idx
  on public.leads(company_id, naechste_aktion_am)
  where naechste_aktion_am is not null;

-- ------------------------------------------------------------
-- 3. Status-Protokoll (ersetzt die Fassung aus 00002)
-- ------------------------------------------------------------
create or replace function public.log_lead_status_change()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  info text := null;
  grund text;
begin
  if old.status is distinct from new.status then
    if new.status = 'gewonnen' and new.auftragswert is not null then
      info := 'Auftragswert: ' || replace(to_char(new.auftragswert, 'FM999,999,990'), ',', '.') || ' €';
    elsif new.status = 'angebot_raus' and new.angebotswert is not null then
      info := 'Angebotswert: ' || replace(to_char(new.angebotswert, 'FM999,999,990'), ',', '.') || ' €';
    elsif new.status = 'verloren' and new.verlust_grund is not null then
      grund := case new.verlust_grund::text
        when 'zu_teuer' then 'Zu teuer'
        when 'kein_bedarf_mehr' then 'Kein Bedarf mehr'
        when 'anderer_anbieter' then 'Anderer Anbieter'
        when 'nicht_erreicht' then 'Nicht erreicht'
        when 'unpassende_anfrage' then 'Unpassende Anfrage'
        when 'sonstiges' then 'Sonstiges'
        else new.verlust_grund::text
      end;
      info := 'Grund: ' || grund || coalesce(' – ' || nullif(btrim(new.verlust_notiz), ''), '');
    end if;

    insert into public.lead_activities (lead_id, user_id, typ, alt_status, neu_status, inhalt)
    values (
      new.id,
      coalesce(auth.uid(), new.geaendert_von),
      'status_wechsel',
      old.status,
      new.status,
      coalesce(info, 'Status geändert: ' || old.status || ' → ' || new.status)
    );
  end if;

  -- Transportspalte immer leeren (auch ohne Statuswechsel)
  new.geaendert_von := null;
  return new;
end;
$$;

-- AFTER → BEFORE, damit der Trigger geaendert_von leeren kann.
-- Läuft für jedes UPDATE (nicht nur „of status“), damit geaendert_von nie stehen bleibt.
-- Reihenfolge der BEFORE-Trigger ist alphabetisch: lead_close_validation, lead_first_contact,
-- lead_status_change_log, leads_updated_at — Pflichtfeld-Prüfung kommt also zuerst.
drop trigger if exists lead_status_change_log on public.leads;
create trigger lead_status_change_log
  before update on public.leads
  for each row execute function public.log_lead_status_change();
