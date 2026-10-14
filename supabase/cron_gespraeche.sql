-- ============================================================
-- Gesprächsanalyse: Aufruf alle 5 Minuten per pg_cron + pg_net
--
-- NICHT Teil der Migrationen — wird manuell im Supabase-SQL-Editor
-- ausgeführt (nach Migration 00011). Vorher Platzhalter ersetzen:
--   <BASIS_URL>    z. B. https://cloud.hoffmannsolutions.de
--   <CRON_SECRET>  Wert der Vercel-Umgebungsvariable CRON_SECRET
-- Voraussetzung: Extensions pg_cron und pg_net sind aktiviert.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Vorhandenen Job gleichen Namens ersetzen (idempotent)
select cron.unschedule(jobid) from cron.job where jobname = 'gespraechsanalyse';

select cron.schedule(
  'gespraechsanalyse',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := '<BASIS_URL>/api/cron/gespraeche',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
    timeout_milliseconds := 300000
  );
  $$
);

-- Kontrolle:
--   select * from cron.job where jobname = 'gespraechsanalyse';
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select status, count(*) from public.gespraeche group by status;
--   select * from public.gespraeche_budget order by tag desc limit 7;
-- Abschalten:
--   select cron.unschedule('gespraechsanalyse');
