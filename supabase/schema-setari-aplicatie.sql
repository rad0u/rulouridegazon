-- schema-setari-aplicatie.sql
--
-- Setări globale ale aplicației, cheie -> valoare JSON. Prima folosire:
-- cheia 'harta_utilaje_vizualizare' = {"lat": ..., "lon": ..., "zoom": ...},
-- centrul și zoom-ul implicit al hărții de la /utilaje (buton „Salvează
-- vizualizarea curentă ca implicită”). Fără rând salvat, harta se centrează
-- ca înainte, pe primul utilaj cu poziție cunoscută.
--
-- APLICATĂ deja direct în Supabase (proiect oyxnjyvproazqhyfgyet), pe rând
-- prin execute_sql (apply_migration dădea timeout) -- acest fișier e doar
-- copia sursă de adevăr, ca celelalte schema-*.sql din acest folder.
--
-- 2026-10-07 (Radu): "pot seta unde sa se centreze si nivelul de zoom?"

CREATE TABLE IF NOT EXISTS public.setari_aplicatie (
  cheie text PRIMARY KEY,
  valoare jsonb NOT NULL,
  actualizat_la timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.setari_aplicatie ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_central citeste setari" ON public.setari_aplicatie
FOR SELECT USING (auth.role() = 'authenticated' AND public.is_admin_central());

CREATE POLICY "admin_central insereaza setari" ON public.setari_aplicatie
FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

CREATE POLICY "admin_central actualizeaza setari" ON public.setari_aplicatie
FOR UPDATE USING (auth.role() = 'authenticated' AND public.is_admin_central())
WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());
