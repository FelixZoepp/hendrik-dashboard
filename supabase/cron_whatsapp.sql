-- ============================================================
-- WhatsApp-Terminbot: minütlicher Aufruf per pg_cron + pg_net
--
-- NICHT Teil der Migrationen — wird erst zum Livegang manuell im
-- Supabase-SQL-Editor ausgeführt. Vorher Platzhalter ersetzen:
--   <BASIS_URL>    z. B. https://cloud.hoffmannsolutions.de
--   <CRON_SECRET>  Wert der Vercel-Umgebungsvariable CRON_SECRET
-- Voraussetzung: Extensions pg_cron und pg_net sind aktiviert
-- (Dashboard → Database → Extensions).
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Vorhandenen Job gleichen Namens ersetzen (idempotent)
select cron.unschedule(jobid) from cron.job where jobname = 'whatsapp-terminbot';

select cron.schedule(
  'whatsapp-terminbot',
  '* * * * *',
  $$
  select net.http_get(
    url := '<BASIS_URL>/api/cron/whatsapp',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
    timeout_milliseconds := 60000
  );
  $$
);

-- Kontrolle:
--   select * from cron.job where jobname = 'whatsapp-terminbot';
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select * from net._http_response order by created desc limit 20;
-- Abschalten:
--   select cron.unschedule('whatsapp-terminbot');
