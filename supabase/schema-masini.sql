-- schema-masini.sql
-- Modul Flotă auto (mașini de pasageri) — foi de parcurs.
--
-- Hardware ales (vezi NOTES.md, secțiunea "Flotă auto"): Teltonika FMC130
-- (LTE, dual-SIM), FĂRĂ senzor de combustibil — doar tracking GPS. Se
-- configurează în ACELAȘI Traccar folosit pentru utilaje
-- (http://135.181.45.175/), ca device nou (Identifier = IMEI).
--
-- Diferență cheie față de modulul utilaje/combustibil:
--   - Cursele se detectează automat din segmente ignition on/off (ca orele de
--     funcționare de la utilaje), NU pornite/oprite manual de șofer.
--   - Șoferul completează doar "scopul" cursei, ulterior, din mobil.
--   - Km oficiali pe foaia de parcurs = calculați din traseul GPS (sumă de
--     distanțe haversine între poziții consecutive ale cursei), nu introduși
--     manual.
--   - Mașinile pot fi alocate unei ferme (admin_central decide alocarea) sau
--     rămân în "pool central" (ferma_id = NULL) dacă nu sunt alocate încă.
--     Admin_ferma vede DOAR mașinile alocate fermei lui (fără hartă live, fără
--     editare) și poate introduce bonuri de combustibil pentru ele — vezi
--     migrația "flota_masini_alocare_ferme_si_bonuri_combustibil" mai jos.
--
-- APLICATĂ deja direct în Supabase (proiect oyxnjyvproazqhyfgyet) prin
-- migrația "modul_flota_auto_masini" — acest fișier e doar copia sursă de
-- adevăr, la fel ca celelalte schema-*.sql din acest folder.

CREATE TABLE IF NOT EXISTS public.masini (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nume text NOT NULL,
  numar_inmatriculare text,
  marca_model text,
  traccar_device_id text UNIQUE,
  sofer_implicit_id uuid REFERENCES public.utilizatori(id),
  viteza_limita_kmh numeric,
  activ boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.masini_pozitii (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  masina_id uuid NOT NULL REFERENCES public.masini(id),
  data_ora timestamptz NOT NULL,
  latitudine numeric NOT NULL,
  longitudine numeric NOT NULL,
  viteza_kmh numeric,
  contact boolean,
  sursa text NOT NULL DEFAULT 'traccar',
  created_at timestamptz DEFAULT now(),
  UNIQUE (masina_id, data_ora)
);
CREATE INDEX IF NOT EXISTS masini_pozitii_masina_data_idx
  ON public.masini_pozitii (masina_id, data_ora DESC);

CREATE TABLE IF NOT EXISTS public.curse (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  masina_id uuid NOT NULL REFERENCES public.masini(id),
  sofer_id uuid REFERENCES public.utilizatori(id),
  data_ora_start timestamptz NOT NULL,
  data_ora_stop timestamptz,
  km numeric,
  scop text,
  status text NOT NULL DEFAULT 'detectata',
  note text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (masina_id, data_ora_start)
);
CREATE INDEX IF NOT EXISTS curse_masina_start_idx ON public.curse (masina_id, data_ora_start DESC);
CREATE INDEX IF NOT EXISTS curse_sofer_start_idx ON public.curse (sofer_id, data_ora_start DESC);

CREATE TABLE IF NOT EXISTS public.geofences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nume text NOT NULL,
  poligon jsonb NOT NULL,
  tip_alerta text NOT NULL DEFAULT 'ambele',
  activ boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.alerte (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  masina_id uuid NOT NULL REFERENCES public.masini(id),
  tip text NOT NULL,
  geofence_id uuid REFERENCES public.geofences(id),
  viteza_masurata numeric,
  viteza_limita numeric,
  data_ora timestamptz NOT NULL,
  latitudine numeric,
  longitudine numeric,
  vazuta boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alerte_masina_data_idx ON public.alerte (masina_id, data_ora DESC);
CREATE INDEX IF NOT EXISTS alerte_vazuta_idx ON public.alerte (vazuta) WHERE vazuta = false;

ALTER TABLE public.masini ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.masini_pozitii ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curse ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geofences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerte ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_central gestioneaza masinile" ON public.masini;
CREATE POLICY "admin_central gestioneaza masinile" ON public.masini
FOR ALL USING (auth.role() = 'authenticated' AND public.is_admin_central())
WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "sofer vede masina proprie" ON public.masini;
CREATE POLICY "sofer vede masina proprie" ON public.masini
FOR SELECT USING (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    where u.id = auth.uid()
      and u.rol = 'sofer'
      and public.masini.sofer_implicit_id = u.id
  )
);

DROP POLICY IF EXISTS "admin_central vede pozitiile masinilor" ON public.masini_pozitii;
CREATE POLICY "admin_central vede pozitiile masinilor" ON public.masini_pozitii
FOR SELECT USING (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_central poate insera pozitii masini" ON public.masini_pozitii;
CREATE POLICY "admin_central poate insera pozitii masini" ON public.masini_pozitii
FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_central gestioneaza cursele" ON public.curse;
CREATE POLICY "admin_central gestioneaza cursele" ON public.curse
FOR ALL USING (auth.role() = 'authenticated' AND public.is_admin_central())
WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "sofer vede cursele proprii" ON public.curse;
CREATE POLICY "sofer vede cursele proprii" ON public.curse
FOR SELECT USING (auth.role() = 'authenticated' AND sofer_id = auth.uid());

DROP POLICY IF EXISTS "sofer completeaza cursele proprii" ON public.curse;
CREATE POLICY "sofer completeaza cursele proprii" ON public.curse
FOR UPDATE USING (
  auth.role() = 'authenticated' AND sofer_id = auth.uid() AND status <> 'validata'
)
WITH CHECK (
  auth.role() = 'authenticated' AND sofer_id = auth.uid() AND status IN ('detectata', 'completata')
);

DROP POLICY IF EXISTS "admin_central gestioneaza geofences" ON public.geofences;
CREATE POLICY "admin_central gestioneaza geofences" ON public.geofences
FOR ALL USING (auth.role() = 'authenticated' AND public.is_admin_central())
WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_central vede alertele" ON public.alerte;
CREATE POLICY "admin_central vede alertele" ON public.alerte
FOR SELECT USING (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_central poate insera alerte" ON public.alerte;
CREATE POLICY "admin_central poate insera alerte" ON public.alerte
FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_central poate marca alertele vazute" ON public.alerte;
CREATE POLICY "admin_central poate marca alertele vazute" ON public.alerte
FOR UPDATE USING (auth.role() = 'authenticated' AND public.is_admin_central())
WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

-- ─────────────────────────────────────────────────────────────────────────
-- Alocare mașini pe ferme + bonuri de combustibil (migrația
-- "flota_masini_alocare_ferme_si_bonuri_combustibil", aplicată live).
--
-- Decizie: rolul admin_ferma existent (cel care administrează deja
-- parcele/utilaje/substanțe pe ferma lui) e reutilizat și pentru mașini —
-- nu există un rol separat. admin_ferma poate DOAR vedea mașinile alocate
-- fermei lui și introduce bonuri de combustibil — nu editează mașina, nu are
-- hartă live (acelea rămân exclusiv admin_central, prin get-masini-positions).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.masini ADD COLUMN IF NOT EXISTS ferma_id uuid REFERENCES public.ferme(id);

CREATE TABLE IF NOT EXISTS public.bonuri_combustibil_masini (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  masina_id uuid NOT NULL REFERENCES public.masini(id),
  data date NOT NULL,
  litri numeric,
  pret_litru numeric,
  suma_totala numeric NOT NULL,
  statie text,
  km_bord numeric,
  note text,
  introdus_de uuid REFERENCES public.utilizatori(id),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bonuri_combustibil_masini_masina_data_idx
  ON public.bonuri_combustibil_masini (masina_id, data DESC);

ALTER TABLE public.bonuri_combustibil_masini ENABLE ROW LEVEL SECURITY;

-- masini: admin_ferma vede doar masinile alocate fermei sale (pool central,
-- ferma_id = NULL, rămâne vizibil doar pentru admin_central)
DROP POLICY IF EXISTS "admin_ferma vede masinile alocate fermei sale" ON public.masini;
CREATE POLICY "admin_ferma vede masinile alocate fermei sale" ON public.masini
FOR SELECT USING (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = public.masini.ferma_id
  )
);

DROP POLICY IF EXISTS "admin_central gestioneaza bonurile de combustibil masini" ON public.bonuri_combustibil_masini;
CREATE POLICY "admin_central gestioneaza bonurile de combustibil masini" ON public.bonuri_combustibil_masini
FOR ALL USING (auth.role() = 'authenticated' AND public.is_admin_central())
WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_ferma vede bonurile masinilor fermei sale" ON public.bonuri_combustibil_masini;
CREATE POLICY "admin_ferma vede bonurile masinilor fermei sale" ON public.bonuri_combustibil_masini
FOR SELECT USING (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    join public.masini m on m.id = public.bonuri_combustibil_masini.masina_id
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = m.ferma_id
  )
);

DROP POLICY IF EXISTS "admin_ferma adauga bonuri pentru masinile fermei sale" ON public.bonuri_combustibil_masini;
CREATE POLICY "admin_ferma adauga bonuri pentru masinile fermei sale" ON public.bonuri_combustibil_masini
FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
  AND introdus_de = auth.uid()
  AND exists (
    select 1 from public.utilizatori u
    join public.masini m on m.id = public.bonuri_combustibil_masini.masina_id
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = m.ferma_id
  )
);

DROP POLICY IF EXISTS "admin_ferma editeaza bonurile proprii" ON public.bonuri_combustibil_masini;
CREATE POLICY "admin_ferma editeaza bonurile proprii" ON public.bonuri_combustibil_masini
FOR UPDATE USING (auth.role() = 'authenticated' AND introdus_de = auth.uid())
WITH CHECK (auth.role() = 'authenticated' AND introdus_de = auth.uid());

DROP POLICY IF EXISTS "admin_ferma sterge bonurile proprii" ON public.bonuri_combustibil_masini;
CREATE POLICY "admin_ferma sterge bonurile proprii" ON public.bonuri_combustibil_masini
FOR DELETE USING (auth.role() = 'authenticated' AND introdus_de = auth.uid());

-- 2026-08-31: decizie — nu se creează conturi cu rol Șofer (foaia de parcurs
-- e doar acoperire ANAF pentru cheltuiala cu combustibilul, nu justifică
-- overhead-ul de conturi separate per șofer). În loc de asta, admin_ferma
-- completează el scopul curselor pentru mașinile alocate fermei lui, din
-- aceeași pagină /curse (rol `sofer` rămâne suportat în cod, doar neutilizat
-- practic momentan).

DROP POLICY IF EXISTS "admin_ferma vede cursele masinilor fermei sale" ON public.curse;
CREATE POLICY "admin_ferma vede cursele masinilor fermei sale" ON public.curse
FOR SELECT USING (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    join public.masini m on m.id = public.curse.masina_id
    where u.id = auth.uid() and u.rol = 'admin_ferma' and u.ferma_id = m.ferma_id
  )
);

DROP POLICY IF EXISTS "admin_ferma completeaza cursele masinilor fermei sale" ON public.curse;
CREATE POLICY "admin_ferma completeaza cursele masinilor fermei sale" ON public.curse
FOR UPDATE USING (
  auth.role() = 'authenticated'
  AND status <> 'validata'
  AND exists (
    select 1 from public.utilizatori u
    join public.masini m on m.id = public.curse.masina_id
    where u.id = auth.uid() and u.rol = 'admin_ferma' and u.ferma_id = m.ferma_id
  )
)
WITH CHECK (
  auth.role() = 'authenticated'
  AND status = ANY (ARRAY['detectata'::text, 'completata'::text])
  AND exists (
    select 1 from public.utilizatori u
    join public.masini m on m.id = public.curse.masina_id
    where u.id = auth.uid() and u.rol = 'admin_ferma' and u.ferma_id = m.ferma_id
  )
);
