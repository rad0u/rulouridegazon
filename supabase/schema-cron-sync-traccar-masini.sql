-- schema-cron-sync-traccar-masini.sql
--
-- Programare pg_cron pentru sync-traccar-masini, la fel ca
-- schema-cron-sync-traccar.sql (varianta pentru utilaje), dar pentru flota
-- de mașini. Rulează la fiecare 5 minute.
--
-- APLICATĂ deja direct în Supabase prin migrația "cron_sync_traccar_masini".

select cron.schedule(
  'sync-traccar-masini-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://oyxnjyvproazqhyfgyet.supabase.co/functions/v1/sync-traccar-masini',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Pentru schimbarea intervalului pe viitor:
--   select cron.unschedule('sync-traccar-masini-5min');
--   select cron.schedule('sync-traccar-masini-Xmin', '*/X * * * *', $$ ... aceeași comandă ... $$);
