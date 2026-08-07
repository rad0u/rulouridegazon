-- schema-operatiuni-stoc.sql
-- Scădere automată a stocului de substanțe la înregistrarea unei operațiuni
-- (Fertilizare/Tratamente sau Suprainsămânțare), conform specificației.

CREATE OR REPLACE FUNCTION public.scade_stoc_substanta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.substante
  SET stoc_curent = stoc_curent - NEW.cantitate
  WHERE id = NEW.substanta_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scade_stoc_substanta_trigger ON public.operatiuni_substante;
CREATE TRIGGER scade_stoc_substanta_trigger
AFTER INSERT ON public.operatiuni_substante
FOR EACH ROW
EXECUTE FUNCTION public.scade_stoc_substanta();
