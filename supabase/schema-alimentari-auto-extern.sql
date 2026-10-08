-- schema-alimentari-auto-extern.sql
--
-- Alimentări din rezervorul central ale unor autovehicule care NU sunt în
-- baza de date (ex. camioane care nu aparțin fermei, alimentate din rezervorul
-- central Săbăreni) -- Radu, 2026-10-08: "vreau sa avem posibilitatea de
-- alimentare auto din rezervor ferma, fara ca auto sa fie in baza noastra de
-- date".
--
-- `alimentari_masini.masina_id` devine opțional; un rând extern are
-- `masina_id` NULL și `ferma_id` (ferma al cărei rezervor a fost folosit) +
-- `auto_extern_numar` (obligatoriu) / `auto_extern_beneficiar` / `auto_extern_sofer`
-- (text liber). `ferma_id` e completat și pentru rândurile cu mașină
-- (backfill + trigger), ca get-rezervor-central-miscari (v3) să filtreze
-- direct după fermă.
--
-- APLICATĂ deja direct în Supabase (proiect oyxnjyvproazqhyfgyet), instrucțiune
-- cu instrucțiune prin execute_sql (apply_migration dădea timeout) -- acest
-- fișier e doar copia sursă de adevăr.

ALTER TABLE public.alimentari_masini ALTER COLUMN masina_id DROP NOT NULL;

ALTER TABLE public.alimentari_masini
  ADD COLUMN IF NOT EXISTS ferma_id uuid REFERENCES public.ferme(id),
  ADD COLUMN IF NOT EXISTS auto_extern_numar text,
  ADD COLUMN IF NOT EXISTS auto_extern_beneficiar text,
  ADD COLUMN IF NOT EXISTS auto_extern_sofer text;

UPDATE public.alimentari_masini a
SET ferma_id = m.ferma_id
FROM public.masini m
WHERE a.masina_id = m.id AND a.ferma_id IS NULL;

ALTER TABLE public.alimentari_masini
  ADD CONSTRAINT alimentari_masini_masina_sau_extern
  CHECK (masina_id IS NOT NULL OR (ferma_id IS NOT NULL AND auto_extern_numar IS NOT NULL AND btrim(auto_extern_numar) <> ''));

-- admin_central: politica existentă (FOR ALL) acoperă și rândurile externe.
-- admin_ferma: poate adăuga/vedea alimentările externe ale fermei sale.
CREATE POLICY "admin_ferma adauga alimentari auto externe" ON public.alimentari_masini
FOR INSERT WITH CHECK (
  auth.role() = 'authenticated' AND masina_id IS NULL AND EXISTS (
    SELECT 1 FROM public.utilizatori u
    WHERE u.id = auth.uid() AND u.rol = 'admin_ferma' AND u.ferma_id = alimentari_masini.ferma_id
  )
);

CREATE POLICY "admin_ferma vede alimentarile auto externe ale fermei sale" ON public.alimentari_masini
FOR SELECT USING (
  auth.role() = 'authenticated' AND masina_id IS NULL AND EXISTS (
    SELECT 1 FROM public.utilizatori u
    WHERE u.id = auth.uid() AND u.rol = 'admin_ferma' AND u.ferma_id = alimentari_masini.ferma_id
  )
);

-- Pentru rândurile cu mașină, ferma se completează automat din masini.ferma_id.
CREATE OR REPLACE FUNCTION public.alimentari_masini_seteaza_ferma() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ferma_id IS NULL AND NEW.masina_id IS NOT NULL THEN
    SELECT ferma_id INTO NEW.ferma_id FROM public.masini WHERE id = NEW.masina_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER alimentari_masini_seteaza_ferma_trigger
BEFORE INSERT ON public.alimentari_masini
FOR EACH ROW EXECUTE FUNCTION public.alimentari_masini_seteaza_ferma();
