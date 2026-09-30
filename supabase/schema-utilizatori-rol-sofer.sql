-- schema-utilizatori-rol-sofer.sql
--
-- Fix: rolul "sofer" era folosit peste tot în aplicație (admin-create-user
-- îl acceptă explicit, ecranul /utilizatori are opțiunea "Șofer (mobil, foi
-- de parcurs)", /curse are o vedere dedicată "Cursele mele" pentru el, iar
-- masini.sofer_implicit_id / curse.sofer_id sunt gândite să refere un cont
-- cu acest rol) -- dar constrângerea CHECK originală de pe utilizatori.rol
-- (dinainte de modulul Flotă auto) nu-l permitea niciodată.
--
-- Efect: orice încercare de a crea un cont cu rol Șofer eșua (constraint
-- violation în triggerul sync_utilizatori_from_auth, care inserează în
-- public.utilizatori în aceeași tranzacție cu auth.admin.createUser -- deci
-- eșua chiar crearea contului în Auth). Lista de șoferi era mereu goală, iar
-- câmpul "Șofer implicit" de la /flota-auto nu putea fi folosit cu adevărat.
--
-- APLICATĂ deja direct în Supabase (proiect oyxnjyvproazqhyfgyet) prin
-- migrația "utilizatori_permite_rol_sofer" -- acest fișier e doar copia
-- sursă de adevăr, la fel ca celelalte schema-*.sql din acest folder.
--
-- 2026-09-30 (Radu): "la sofer implicit lasa camp editabil".

ALTER TABLE public.utilizatori DROP CONSTRAINT utilizatori_rol_check;
ALTER TABLE public.utilizatori ADD CONSTRAINT utilizatori_rol_check
  CHECK (rol = ANY (ARRAY['admin_central'::text, 'admin_ferma'::text, 'sofer'::text]));
