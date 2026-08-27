-- schema-harta-satelit.sql
-- Trecere de la parcele desenate pe imagine statică (coordonate 0-1 pe pixeli)
-- la parcele desenate direct pe hartă satelit reală (coordonate GPS).
--
-- Motiv: pentru a putea în viitor asocia traseul GPS al utilajelor (din
-- combustibil_citiri.latitudine/longitudine) cu parcela pe care se aflau
-- (point-in-polygon), poligoanele parcelelor trebuie să aibă coordonate GPS
-- reale, nu coordonate relative la o imagine încărcată manual.

-- Centrul implicit al hărții per fermă (setat o singură dată de admin
-- central, navigând pe hartă satelit până la fermă și apăsând "Setează ca
-- centru implicit"). Fără el, harta se deschide pe centrul aproximativ al
-- României la zoom mic.
ALTER TABLE public.ferme
  ADD COLUMN IF NOT EXISTS centru_lat numeric,
  ADD COLUMN IF NOT EXISTS centru_lon numeric,
  ADD COLUMN IF NOT EXISTS centru_zoom integer;

-- Poligoanele existente erau desenate ca fracții 0..1 pe imaginea încărcată
-- manual (ferme.harta_url) — nu mai au sens interpretate ca grade GPS.
-- Se golesc; admin central le redesenează direct pe harta satelit.
UPDATE public.parcele SET poligon_harta = NULL;

-- Notă: coloana ferme.harta_url rămâne în schemă (neutilizată de aplicație
-- de acum încolo), nu se șterge — fără risc, doar dead data.
