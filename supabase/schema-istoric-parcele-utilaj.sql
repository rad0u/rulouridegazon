-- schema-istoric-parcele-utilaj.sql
-- Extinde combustibil_citiri ca să stocheze poziția + starea de contact
-- (ignition) pentru ORICE utilaj cu tracker funcțional, nu doar pentru cele
-- cu senzor de combustibil calibrat/conectat. Necesar pentru istoricul
-- "ore lucrate pe parcelă" (point-in-polygon din traseul GPS).

ALTER TABLE public.combustibil_citiri
  ALTER COLUMN nivel_litri DROP NOT NULL;

ALTER TABLE public.combustibil_citiri
  ADD COLUMN IF NOT EXISTS contact boolean;

COMMENT ON COLUMN public.combustibil_citiri.contact IS
  'Starea contactului (ignition) la momentul citirii — din atributul Traccar "ignition".';
