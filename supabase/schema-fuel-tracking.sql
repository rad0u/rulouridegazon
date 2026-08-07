-- schema-fuel-tracking.sql
-- Utilaje (echipamente) + citiri combustibil sincronizate din Traccar.
--
-- Hardware ales:
--   - Tracker GPS: Teltonika FMC125 (LTE, dual SIM, port RS232 pentru senzor combustibil)
--   - Senzor combustibil: Technoton DUT-E 232 (ieșire digitală RS232, LLS, eroare 1%)
--
-- Configurare Traccar (de făcut o dată per utilaj, la montaj):
--   1. Teltonika Configurator -> RS232 -> mod "Digital Fuel Sensor / LLS", Codec 8 Extended activat.
--   2. Calibrare senzor DUT-E (litri reali vs. procent, din tabelul de calibrare al rezervorului).
--   3. Notează IMEI-ul device-ului (= traccar_device_id de mai jos) și adaugă-l în Traccar ca device.
--   4. TODO: după ce vine prima poziție cu date de fuel, verifică în Traccar (Device -> Latest position
--      -> More info) exact numele atributului (ex. "fuel1", "io84") și actualizează Edge Function
--      sync-traccar-fuel cu numele corect înainte de a activa job-ul programat.

CREATE TABLE IF NOT EXISTS public.utilaje (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ferma_id uuid NOT NULL REFERENCES public.ferme(id),
  nume text NOT NULL,
  tip text,
  traccar_device_id text UNIQUE,
  tanc_capacitate_litri numeric,
  activ boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.combustibil_citiri (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  utilaj_id uuid NOT NULL REFERENCES public.utilaje(id),
  data_ora timestamptz NOT NULL,
  nivel_litri numeric NOT NULL,
  latitudine numeric,
  longitudine numeric,
  sursa text NOT NULL DEFAULT 'traccar',
  created_at timestamptz DEFAULT now(),
  UNIQUE (utilaj_id, data_ora)
);

CREATE INDEX IF NOT EXISTS combustibil_citiri_utilaj_data_idx
  ON public.combustibil_citiri (utilaj_id, data_ora DESC);

ALTER TABLE public.utilaje ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combustibil_citiri ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_central vede toate utilajele" ON public.utilaje;
CREATE POLICY "admin_central vede toate utilajele" ON public.utilaje
FOR SELECT USING (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_ferma vede doar utilajele fermei sale" ON public.utilaje;
CREATE POLICY "admin_ferma vede doar utilajele fermei sale" ON public.utilaje
FOR SELECT USING (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = public.utilaje.ferma_id
  )
);

DROP POLICY IF EXISTS "admin_central gestioneaza utilajele" ON public.utilaje;
CREATE POLICY "admin_central gestioneaza utilajele" ON public.utilaje
FOR ALL USING (auth.role() = 'authenticated' AND public.is_admin_central())
WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_central vede toate citirile de combustibil" ON public.combustibil_citiri;
CREATE POLICY "admin_central vede toate citirile de combustibil" ON public.combustibil_citiri
FOR SELECT USING (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_ferma vede citirile utilajelor fermei sale" ON public.combustibil_citiri;
CREATE POLICY "admin_ferma vede citirile utilajelor fermei sale" ON public.combustibil_citiri
FOR SELECT USING (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilaje ut
    join public.utilizatori u on u.ferma_id = ut.ferma_id
    where ut.id = public.combustibil_citiri.utilaj_id
      and u.id = auth.uid()
      and u.rol = 'admin_ferma'
  )
);

-- Inserarea citirilor se face doar prin Edge Function (service role), nu direct de useri.
DROP POLICY IF EXISTS "admin_central poate insera citiri combustibil" ON public.combustibil_citiri;
CREATE POLICY "admin_central poate insera citiri combustibil" ON public.combustibil_citiri
FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());
