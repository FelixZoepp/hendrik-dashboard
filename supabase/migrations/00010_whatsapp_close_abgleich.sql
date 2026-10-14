-- ============================================================
-- WhatsApp-Terminbot: Close-Abgleich
-- - wa_termine.close_lead_angelegt: Lead wurde vom Bot aus einer Calendly-Buchung angelegt
--   (wird beim Zusammenführen mit einem Close-Protokoll-Termin auf false gesetzt)
-- - Einstellung close_status_feld: Close-Lead-Feld „WhatsApp-Termin“ (Bestätigungsstatus)
-- ============================================================

alter table public.wa_termine
  add column if not exists close_lead_angelegt boolean not null default false;

insert into public.wa_einstellungen (key, wert) values
  ('close_status_feld', 'null'::jsonb)
on conflict (key) do nothing;
