-- schema-protectie-poligon.sql
-- Interfața ascunde deja controalele de editare (hartă, contur, nume/tip
-- gazon/suprafață) pentru admin_ferma, dar politica RLS de UPDATE pe parcele
-- (pentru propria fermă) e generală. Acest trigger blochează la nivel de bază
-- de date orice modificare a câmpurilor structurale ale parcelei care nu vine
-- de la admin_central, indiferent de calea folosită (UI sau API direct).

CREATE OR REPLACE FUNCTION public.protejeaza_poligon_harta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF (
    NEW.poligon_harta IS DISTINCT FROM OLD.poligon_harta
    OR NEW.nume IS DISTINCT FROM OLD.nume
    OR NEW.tip_gazon IS DISTINCT FROM OLD.tip_gazon
    OR NEW.suprafata_mp IS DISTINCT FROM OLD.suprafata_mp
  ) AND NOT public.is_admin_central() THEN
    RAISE EXCEPTION 'Doar admin general poate modifica descrierea sau conturul parcelei.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protejeaza_poligon_harta_trigger ON public.parcele;
CREATE TRIGGER protejeaza_poligon_harta_trigger
BEFORE UPDATE ON public.parcele
FOR EACH ROW
EXECUTE FUNCTION public.protejeaza_poligon_harta();
