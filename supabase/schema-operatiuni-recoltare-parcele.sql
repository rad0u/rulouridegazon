-- schema-operatiuni-recoltare-parcele.sql
--
-- 2026-09-24, migrare "utilaje_recoltare_si_operatiuni_mp_recoltat" (Radu):
-- șefii de fermă nu mai aleg tipul de operațiune dintr-o listă lungă la
-- confirmarea sesiunilor din /activitati-parcele — doar dacă a fost
-- fertilizare (solidă sau foliară, cu substanță + cantitate, neschimbat) sau
-- recoltare, pentru utilajele marcate "utilaj de recoltare" (vezi
-- este_utilaj_recoltare în schema-fuel-tracking.sql), unde se introduce doar
-- suprafața (mp) de gazon recoltată. Orice altă sesiune confirmată primește
-- automat tipul generic 'Altele', fără nicio alegere din listă.
--
-- NOTĂ: tabela `public.operatiuni` (creată devreme, înainte de convenția
-- schema-*.sql = sursă de adevăr per migrare) nu are un fișier propriu cu
-- CREATE TABLE — vezi live schema din Supabase pentru definiția completă.
-- Fișierul de față documentează doar migrarea de mai jos.

ALTER TABLE public.operatiuni ADD COLUMN IF NOT EXISTS cantitate_mp_recoltat numeric;
ALTER TABLE public.operatiuni ADD CONSTRAINT cantitate_mp_recoltat_valid CHECK (cantitate_mp_recoltat IS NULL OR cantitate_mp_recoltat >= 0);
COMMENT ON COLUMN public.operatiuni.cantitate_mp_recoltat IS 'Suprafața de gazon recoltată (mp) — completată doar pentru operațiuni tip Recoltare, confirmate cu un utilaj marcat "utilaj de recoltare".';

-- 'Altele' = bucket generic pentru orice sesiune confirmată care nu e
-- fertilizare și nu e recoltare — 'Udat'/'Tuns'/'Aspirat' rămân valori
-- valide (istoric + corectări manuale din ParcelaPanel, admin_central), dar
-- nu mai sunt oferite ca opțiuni în fluxul zilnic de confirmare (vezi
-- lib/operatiuniTypes.ts).
ALTER TABLE public.operatiuni DROP CONSTRAINT IF EXISTS operatiuni_tip_check;
ALTER TABLE public.operatiuni ADD CONSTRAINT operatiuni_tip_check CHECK (
  tip = ANY (ARRAY[
    'Udat'::text,
    'Tuns'::text,
    'Aspirat'::text,
    'Suprainsamantare'::text,
    'Fertilizare/Tratamente'::text,
    'Recoltare'::text,
    'Altele'::text
  ])
);
