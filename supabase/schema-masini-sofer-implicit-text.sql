-- schema-masini-sofer-implicit-text.sql
--
-- Șoferul implicit al unei mașini NU mai e legat de un cont din
-- `utilizatori` (masini.sofer_implicit_id, uuid REFERENCES utilizatori(id))
-- -- e un nume simplu, introdus direct în formularul de la /flota-auto.
-- sofer_implicit_id rămâne în schemă (nefolosit din UI de-acum, dar
-- neșters -- sync-traccar-masini încă îl citește la deschiderea unei curse
-- noi, deși va fi mereu NULL cât timp nu se creează conturi Șofer).
--
-- APLICATĂ deja direct în Supabase (proiect oyxnjyvproazqhyfgyet) prin
-- migrația "masini_sofer_implicit_nume_text" -- acest fișier e doar copia
-- sursă de adevăr, la fel ca celelalte schema-*.sql din acest folder.
--
-- 2026-09-30 (Radu), corecție la ideea de cont Șofer: "nu mai creem conturi
-- sofer. editam direct in flota auto".

ALTER TABLE public.masini ADD COLUMN IF NOT EXISTS sofer_implicit_nume text;
