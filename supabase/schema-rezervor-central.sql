-- schema-rezervor-central.sql
-- Rezervor central de motorină per fermă (stoc de combustibil la nivel de fermă,
-- separat de rezervoarele individuale ale utilajelor).
--
-- Model de calcul (simplificare asumată, de validat cu date reale):
--   nivel_curent = nivel_initial
--                + SUMA alimentărilor rezervorului central (de la furnizor) după data_initial
--                - SUMA consumului de motorină al utilajelor fermei (din combustibil_citiri,
--                  toate scăderile de nivel, inclusiv cele marcate "suspecte") după data_initial
--
-- Notă importantă: se scade consumul (arderea de motor), nu evenimentele de realimentare
-- ale utilajelor individuale. Presupunerea e că, pe termen mediu, motorina arsă de utilaje
-- ~= motorina scoasă din rezervorul central (utilajele au rezervoare proprii mici, tampon,
-- deci pe zi cu zi poate exista un decalaj, dar pe total se echilibrează). Dacă în practică
-- valorile nu se potrivesc cu realitatea, de reconsiderat modelul (ex. scădere pe evenimente
-- de realimentare a utilajelor, nu pe consum).
--
-- Doar utilajele CALIBRATE (tanc_capacitate_litri completat) intră în calculul de consum —
-- la fel ca în get-combustibil-report.

ALTER TABLE public.ferme
  ADD COLUMN IF NOT EXISTS rezervor_capacitate_litri numeric,
  ADD COLUMN IF NOT EXISTS rezervor_nivel_initial_litri numeric,
  ADD COLUMN IF NOT EXISTS rezervor_nivel_initial_data timestamptz;

CREATE TABLE IF NOT EXISTS public.rezervor_alimentari (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ferma_id uuid NOT NULL REFERENCES public.ferme(id),
  data_ora timestamptz NOT NULL DEFAULT now(),
  cantitate_litri numeric NOT NULL CHECK (cantitate_litri > 0),
  note text,
  user_id uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rezervor_alimentari_ferma_data_idx
  ON public.rezervor_alimentari (ferma_id, data_ora DESC);

ALTER TABLE public.rezervor_alimentari ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_central vede toate alimentarile" ON public.rezervor_alimentari;
CREATE POLICY "admin_central vede toate alimentarile" ON public.rezervor_alimentari
FOR SELECT USING (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_ferma vede alimentarile fermei sale" ON public.rezervor_alimentari;
CREATE POLICY "admin_ferma vede alimentarile fermei sale" ON public.rezervor_alimentari
FOR SELECT USING (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = public.rezervor_alimentari.ferma_id
  )
);

-- Doar admin central poate înregistra alimentări ale rezervorului central (cf. cerință:
-- "admin-ul general trebuie sa introduca cantitatea de motorina in aplicatie").
DROP POLICY IF EXISTS "admin_central adauga alimentari" ON public.rezervor_alimentari;
CREATE POLICY "admin_central adauga alimentari" ON public.rezervor_alimentari
FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_central sterge alimentari" ON public.rezervor_alimentari;
CREATE POLICY "admin_central sterge alimentari" ON public.rezervor_alimentari
FOR DELETE USING (auth.role() = 'authenticated' AND public.is_admin_central());
