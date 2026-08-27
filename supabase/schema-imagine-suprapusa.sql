-- schema-imagine-suprapusa.sql
-- Suprapunere imagine (ex. captură Google Earth, mai recentă decât satelitul de bază)
-- peste harta reală, ancorată prin 3 puncte GPS (colț stânga-sus, dreapta-sus,
-- stânga-jos). Folosește L.ImageOverlay poziționat manual printr-o transformare
-- afină (vezi components/RotatedImageOverlay.tsx) — nu există un plugin Leaflet
-- extern, e calculat direct din cele 3 puncte.
--
-- Poligoanele parcelelor rămân desenate în coordonate GPS reale pe harta de bază;
-- imaginea suprapusă e doar un strat vizual de referință, nu afectează stocarea
-- parcelelor.

ALTER TABLE public.ferme
  ADD COLUMN IF NOT EXISTS imagine_colt_ss_lat numeric,
  ADD COLUMN IF NOT EXISTS imagine_colt_ss_lon numeric,
  ADD COLUMN IF NOT EXISTS imagine_colt_ds_lat numeric,
  ADD COLUMN IF NOT EXISTS imagine_colt_ds_lon numeric,
  ADD COLUMN IF NOT EXISTS imagine_colt_sj_lat numeric,
  ADD COLUMN IF NOT EXISTS imagine_colt_sj_lon numeric;

-- Notă: ferme.harta_url (deja existentă în schemă din versiunea veche) e refolosită
-- ca URL al imaginii suprapuse — nu mai e nevoie de o coloană nouă pentru asta.
