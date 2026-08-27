-- schema-tipuri-gazon.sql
-- Listă editabilă de tipuri de gazon (înainte hardcodate în cod: rustic/sport/
-- în pregătire). Admin central poate adăuga/șterge tipuri direct din interfață,
-- fără intervenție în cod.
--
-- Notă: parcele.tip_gazon rămâne coloană de tip text liber (nu foreign key) —
-- lista de mai jos alimentează doar dropdown-urile din interfață, nu impune o
-- constrângere strictă. Ștergerea unui tip din listă nu modifică parcelele care
-- îl folosesc deja (rămân cu eticheta text, doar nu mai apare ca opțiune nouă).

CREATE TABLE IF NOT EXISTS public.tipuri_gazon (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nume text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

INSERT INTO public.tipuri_gazon (nume) VALUES ('rustic'), ('sport'), ('în pregătire')
ON CONFLICT (nume) DO NOTHING;

ALTER TABLE public.tipuri_gazon ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oricine autentificat vede tipurile de gazon" ON public.tipuri_gazon;
CREATE POLICY "oricine autentificat vede tipurile de gazon" ON public.tipuri_gazon
FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "admin_central adauga tipuri de gazon" ON public.tipuri_gazon;
CREATE POLICY "admin_central adauga tipuri de gazon" ON public.tipuri_gazon
FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_central actualizeaza tipuri de gazon" ON public.tipuri_gazon;
CREATE POLICY "admin_central actualizeaza tipuri de gazon" ON public.tipuri_gazon
FOR UPDATE USING (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_central sterge tipuri de gazon" ON public.tipuri_gazon;
CREATE POLICY "admin_central sterge tipuri de gazon" ON public.tipuri_gazon
FOR DELETE USING (auth.role() = 'authenticated' AND public.is_admin_central());
