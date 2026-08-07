-- seed.sql
-- Seed inițial pentru cele 5 ferme și parcelele lor.
-- Acest fișier include și sincronizarea automată a tabelului public.utilizatori cu auth.users.

-- Inserare ferme de bază
INSERT INTO public.ferme (nume, locatie, harta_url)
SELECT 'Săbăreni', 'Săbăreni', NULL WHERE NOT EXISTS (SELECT 1 FROM public.ferme WHERE nume = 'Săbăreni');

INSERT INTO public.ferme (nume, locatie, harta_url)
SELECT 'Medgidia', 'Medgidia', NULL WHERE NOT EXISTS (SELECT 1 FROM public.ferme WHERE nume = 'Medgidia');

INSERT INTO public.ferme (nume, locatie, harta_url)
SELECT 'Holboca (Iași)', 'Holboca, Iași', NULL WHERE NOT EXISTS (SELECT 1 FROM public.ferme WHERE nume = 'Holboca (Iași)');

INSERT INTO public.ferme (nume, locatie, harta_url)
SELECT 'Bobicești (Craiova)', 'Bobicești, Craiova', NULL WHERE NOT EXISTS (SELECT 1 FROM public.ferme WHERE nume = 'Bobicești (Craiova)');

INSERT INTO public.ferme (nume, locatie, harta_url)
SELECT 'Timișoara', 'Timișoara', NULL WHERE NOT EXISTS (SELECT 1 FROM public.ferme WHERE nume = 'Timișoara');

-- Inserare parcele inițiale (poligon_harta rămâne NULL — se desenează din aplicație,
-- pe pagina fermei, după ce se încarcă imaginea hărții)
INSERT INTO public.parcele (ferma_id, nume, tip_gazon, stadiu, suprafata_mp, poligon_harta)
SELECT (SELECT id FROM public.ferme WHERE nume = 'Săbăreni' LIMIT 1), 'Parcelă A1', 'rustic', NULL, 1200, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.parcele p
  WHERE p.nume = 'Parcelă A1'
    AND p.ferma_id = (SELECT id FROM public.ferme WHERE nume = 'Săbăreni' LIMIT 1)
);

INSERT INTO public.parcele (ferma_id, nume, tip_gazon, stadiu, suprafata_mp, poligon_harta)
SELECT (SELECT id FROM public.ferme WHERE nume = 'Săbăreni' LIMIT 1), 'Parcelă A2', 'sport', NULL, 1500, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.parcele p
  WHERE p.nume = 'Parcelă A2'
    AND p.ferma_id = (SELECT id FROM public.ferme WHERE nume = 'Săbăreni' LIMIT 1)
);

INSERT INTO public.parcele (ferma_id, nume, tip_gazon, stadiu, suprafata_mp, poligon_harta)
SELECT (SELECT id FROM public.ferme WHERE nume = 'Săbăreni' LIMIT 1), 'Parcelă A3', 'în pregătire', 'semanare', 900, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.parcele p
  WHERE p.nume = 'Parcelă A3'
    AND p.ferma_id = (SELECT id FROM public.ferme WHERE nume = 'Săbăreni' LIMIT 1)
);

INSERT INTO public.parcele (ferma_id, nume, tip_gazon, stadiu, suprafata_mp, poligon_harta)
SELECT (SELECT id FROM public.ferme WHERE nume = 'Medgidia' LIMIT 1), 'Parcelă M1', 'rustic', NULL, 1300, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.parcele p
  WHERE p.nume = 'Parcelă M1'
    AND p.ferma_id = (SELECT id FROM public.ferme WHERE nume = 'Medgidia' LIMIT 1)
);

INSERT INTO public.parcele (ferma_id, nume, tip_gazon, stadiu, suprafata_mp, poligon_harta)
SELECT (SELECT id FROM public.ferme WHERE nume = 'Medgidia' LIMIT 1), 'Parcelă M2', 'sport', NULL, 1400, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.parcele p
  WHERE p.nume = 'Parcelă M2'
    AND p.ferma_id = (SELECT id FROM public.ferme WHERE nume = 'Medgidia' LIMIT 1)
);

INSERT INTO public.parcele (ferma_id, nume, tip_gazon, stadiu, suprafata_mp, poligon_harta)
SELECT (SELECT id FROM public.ferme WHERE nume = 'Medgidia' LIMIT 1), 'Parcelă M3', 'în pregătire', 'fertilizare', 1000, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.parcele p
  WHERE p.nume = 'Parcelă M3'
    AND p.ferma_id = (SELECT id FROM public.ferme WHERE nume = 'Medgidia' LIMIT 1)
);

INSERT INTO public.parcele (ferma_id, nume, tip_gazon, stadiu, suprafata_mp, poligon_harta)
SELECT (SELECT id FROM public.ferme WHERE nume = 'Holboca (Iași)' LIMIT 1), 'Parcelă H1', 'rustic', NULL, 1100, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.parcele p
  WHERE p.nume = 'Parcelă H1'
    AND p.ferma_id = (SELECT id FROM public.ferme WHERE nume = 'Holboca (Iași)' LIMIT 1)
);

INSERT INTO public.parcele (ferma_id, nume, tip_gazon, stadiu, suprafata_mp, poligon_harta)
SELECT (SELECT id FROM public.ferme WHERE nume = 'Holboca (Iași)' LIMIT 1), 'Parcelă H2', 'sport', NULL, 1600, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.parcele p
  WHERE p.nume = 'Parcelă H2'
    AND p.ferma_id = (SELECT id FROM public.ferme WHERE nume = 'Holboca (Iași)' LIMIT 1)
);

INSERT INTO public.parcele (ferma_id, nume, tip_gazon, stadiu, suprafata_mp, poligon_harta)
SELECT (SELECT id FROM public.ferme WHERE nume = 'Holboca (Iași)' LIMIT 1), 'Parcelă H3', 'în pregătire', 'semanare', 950, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.parcele p
  WHERE p.nume = 'Parcelă H3'
    AND p.ferma_id = (SELECT id FROM public.ferme WHERE nume = 'Holboca (Iași)' LIMIT 1)
);

INSERT INTO public.parcele (ferma_id, nume, tip_gazon, stadiu, suprafata_mp, poligon_harta)
SELECT (SELECT id FROM public.ferme WHERE nume = 'Bobicești (Craiova)' LIMIT 1), 'Parcelă B1', 'rustic', NULL, 1250, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.parcele p
  WHERE p.nume = 'Parcelă B1'
    AND p.ferma_id = (SELECT id FROM public.ferme WHERE nume = 'Bobicești (Craiova)' LIMIT 1)
);

INSERT INTO public.parcele (ferma_id, nume, tip_gazon, stadiu, suprafata_mp, poligon_harta)
SELECT (SELECT id FROM public.ferme WHERE nume = 'Bobicești (Craiova)' LIMIT 1), 'Parcelă B2', 'sport', NULL, 1450, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.parcele p
  WHERE p.nume = 'Parcelă B2'
    AND p.ferma_id = (SELECT id FROM public.ferme WHERE nume = 'Bobicești (Craiova)' LIMIT 1)
);

INSERT INTO public.parcele (ferma_id, nume, tip_gazon, stadiu, suprafata_mp, poligon_harta)
SELECT (SELECT id FROM public.ferme WHERE nume = 'Bobicești (Craiova)' LIMIT 1), 'Parcelă B3', 'în pregătire', 'semanare', 800, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.parcele p
  WHERE p.nume = 'Parcelă B3'
    AND p.ferma_id = (SELECT id FROM public.ferme WHERE nume = 'Bobicești (Craiova)' LIMIT 1)
);

INSERT INTO public.parcele (ferma_id, nume, tip_gazon, stadiu, suprafata_mp, poligon_harta)
SELECT (SELECT id FROM public.ferme WHERE nume = 'Timișoara' LIMIT 1), 'Parcelă T1', 'rustic', NULL, 1350, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.parcele p
  WHERE p.nume = 'Parcelă T1'
    AND p.ferma_id = (SELECT id FROM public.ferme WHERE nume = 'Timișoara' LIMIT 1)
);

INSERT INTO public.parcele (ferma_id, nume, tip_gazon, stadiu, suprafata_mp, poligon_harta)
SELECT (SELECT id FROM public.ferme WHERE nume = 'Timișoara' LIMIT 1), 'Parcelă T2', 'sport', NULL, 1550, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.parcele p
  WHERE p.nume = 'Parcelă T2'
    AND p.ferma_id = (SELECT id FROM public.ferme WHERE nume = 'Timișoara' LIMIT 1)
);

-- Funcție + trigger pentru sincronizarea utilizatorilor cu auth.users
--
-- Rolul și ferma se citesc din User Metadata setat la crearea contului
-- (Supabase Dashboard -> Authentication -> Add user -> User Metadata, format JSON):
--   Admin central:  {"rol": "admin_central"}
--   Admin de fermă: {"rol": "admin_ferma", "ferma_id": "<uuid-ul fermei>"}
-- Dacă nu se trimite "rol", implicit devine "admin_ferma" cu ferma_id NULL.

CREATE OR REPLACE FUNCTION public.sync_utilizatori_from_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rol text;
  v_ferma_id uuid;
BEGIN
  v_rol := COALESCE(NEW.raw_user_meta_data->>'rol', 'admin_ferma');

  IF v_rol = 'admin_central' THEN
    v_ferma_id := NULL;
  ELSE
    v_ferma_id := NULLIF(NEW.raw_user_meta_data->>'ferma_id', '')::uuid;
  END IF;

  INSERT INTO public.utilizatori (id, nume, email, rol, ferma_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    v_rol,
    v_ferma_id
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_utilizatori_from_auth_trigger ON auth.users;
CREATE TRIGGER sync_utilizatori_from_auth_trigger
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_utilizatori_from_auth();
