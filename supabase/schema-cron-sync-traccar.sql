-- schema-cron-sync-traccar.sql
--
-- Programare pg_cron pentru sync-traccar-fuel. Ținută separat (nu în
-- schema-fuel-tracking.sql) pentru că a fost creată/modificată direct prin
-- SQL Editor / execute_sql, nu ca parte a schemei inițiale.
--
-- 2026-08-27: interval redus de la 15 la 5 minute (cerere Radu: eșantionare
-- sub 10 minute, pentru precizie mai bună la istoricul ore/parcelă din
-- get-utilaj-istoric-parcele). Job-ul vechi ("sync-traccar-fuel-15min") a
-- fost dezactivat cu cron.unschedule() înainte de a crea acesta.
--
-- Notă importantă despre limita reală de precizie: acest job ia mereu
-- "poziția curentă" din Traccar (GET /api/positions), nu istoricul complet
-- dintre două rulări. Deci rezoluția reală a datelor e limitată la MIN(acest
-- interval, frecvența cu care FMC125 însuși raportează în Traccar) — dacă
-- device-ul raportează mai rar decât 5 minute (frecvent când stă pe loc,
-- pentru economie de date), coborârea intervalului de mai jos sub frecvența
-- reală a device-ului nu aduce niciun beneficiu suplimentar.

select cron.schedule(
  'sync-traccar-fuel-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://oyxnjyvproazqhyfgyet.supabase.co/functions/v1/sync-traccar-fuel',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Pentru schimbarea intervalului pe viitor:
--   select cron.unschedule('sync-traccar-fuel-5min');
--   select cron.schedule('sync-traccar-fuel-Xmin', '*/X * * * *', $$ ... aceeași comandă ... $$);
