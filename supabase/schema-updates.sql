-- schema-updates.sql
-- Actualizări schema Supabase pentru modulul de cost de producție

-- Coloane noi în tabele existente
ALTER TABLE public.substante
  ADD COLUMN IF NOT EXISTS pret_unitar numeric,
  ADD COLUMN IF NOT EXISTS ferma_id uuid REFERENCES public.ferme(id);

ALTER TABLE public.ferme
  ADD COLUMN IF NOT EXISTS cost_ora_lucru numeric;

-- Tabel nou pentru cheltuieli indirecte
CREATE TABLE IF NOT EXISTS public.cheltuieli_indirecte (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ferma_id uuid NOT NULL REFERENCES public.ferme(id),
  data date NOT NULL,
  descriere text NOT NULL,
  valoare numeric NOT NULL,
  created_at timestamptz DEFAULT now()
);
