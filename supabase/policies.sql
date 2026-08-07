-- Politici RLS pentru roluri admin_central și admin_ferma

CREATE OR REPLACE FUNCTION public.is_admin_central()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET row_security = off
AS $$
SELECT EXISTS (
  SELECT 1
  FROM public.utilizatori u
  WHERE u.id = auth.uid()
    AND u.rol = 'admin_central'
);
$$;

-- Tabel utilizatori (păstrează rolul și ferma)
DROP POLICY IF EXISTS "Admin central poate vedea toate utilizatorii" ON public.utilizatori;
CREATE POLICY "Admin central poate vedea toate utilizatorii" ON public.utilizatori
FOR SELECT USING (auth.role() = 'authenticated' AND public.is_admin_central());

-- Ferme
ALTER TABLE public.ferme ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_central vede toate fermele" ON public.ferme;
CREATE POLICY "admin_central vede toate fermele" ON public.ferme
FOR SELECT USING (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_ferma vede doar ferma proprie" ON public.ferme;
CREATE POLICY "admin_ferma vede doar ferma proprie" ON public.ferme
FOR SELECT USING (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = public.ferme.id
  )
);

-- Parce
ALTER TABLE public.parcele ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_central vede toate parcelele" ON public.parcele;
CREATE POLICY "admin_central vede toate parcelele" ON public.parcele
FOR SELECT USING (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_ferma vede doar parcelele fermei sale" ON public.parcele;
CREATE POLICY "admin_ferma vede doar parcelele fermei sale" ON public.parcele
FOR SELECT USING (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = public.parcele.ferma_id
  )
);

DROP POLICY IF EXISTS "admin_central poate insera parcele" ON public.parcele;
CREATE POLICY "admin_central poate insera parcele" ON public.parcele
FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_central poate actualiza parcele" ON public.parcele;
CREATE POLICY "admin_central poate actualiza parcele" ON public.parcele
FOR UPDATE USING (auth.role() = 'authenticated' AND public.is_admin_central())
WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_ferma poate insera doar parcelele fermei sale" ON public.parcele;
CREATE POLICY "admin_ferma poate insera doar parcelele fermei sale" ON public.parcele
FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = public.parcele.ferma_id
  )
);

DROP POLICY IF EXISTS "admin_ferma poate actualiza doar parcelele fermei sale" ON public.parcele;
CREATE POLICY "admin_ferma poate actualiza doar parcelele fermei sale" ON public.parcele
FOR UPDATE USING (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = public.parcele.ferma_id
  )
)
WITH CHECK (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = public.parcele.ferma_id
  )
);

-- Substanțe
ALTER TABLE public.substante ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_central vede toate substanțele" ON public.substante;
CREATE POLICY "admin_central vede toate substanțele" ON public.substante
FOR SELECT USING (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_ferma vede doar substanțele fermei sale" ON public.substante;
CREATE POLICY "admin_ferma vede doar substanțele fermei sale" ON public.substante
FOR SELECT USING (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = public.substante.ferma_id
  )
);

DROP POLICY IF EXISTS "admin_central poate insera substanțe" ON public.substante;
CREATE POLICY "admin_central poate insera substanțe" ON public.substante
FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_central poate actualiza substanțe" ON public.substante;
CREATE POLICY "admin_central poate actualiza substanțe" ON public.substante
FOR UPDATE USING (auth.role() = 'authenticated' AND public.is_admin_central())
WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_ferma poate insera doar substanțele fermei sale" ON public.substante;
CREATE POLICY "admin_ferma poate insera doar substanțele fermei sale" ON public.substante
FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = public.substante.ferma_id
  )
);

DROP POLICY IF EXISTS "admin_ferma poate actualiza doar substanțele fermei sale" ON public.substante;
CREATE POLICY "admin_ferma poate actualiza doar substanțele fermei sale" ON public.substante
FOR UPDATE USING (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = public.substante.ferma_id
  )
)
WITH CHECK (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = public.substante.ferma_id
  )
);

-- Operatiuni
ALTER TABLE public.operatiuni ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_central vede toate operatiunile" ON public.operatiuni;
CREATE POLICY "admin_central vede toate operatiunile" ON public.operatiuni
FOR SELECT USING (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_ferma vede doar operatiunile fermei sale" ON public.operatiuni;
CREATE POLICY "admin_ferma vede doar operatiunile fermei sale" ON public.operatiuni
FOR SELECT USING (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    join public.parcele p on p.id = public.operatiuni.parcela_id
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = p.ferma_id
  )
);

DROP POLICY IF EXISTS "admin_central poate insera operatiuni" ON public.operatiuni;
CREATE POLICY "admin_central poate insera operatiuni" ON public.operatiuni
FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_central poate actualiza operatiuni" ON public.operatiuni;
CREATE POLICY "admin_central poate actualiza operatiuni" ON public.operatiuni
FOR UPDATE USING (auth.role() = 'authenticated' AND public.is_admin_central())
WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_ferma poate insera doar operatiunile fermei sale" ON public.operatiuni;
CREATE POLICY "admin_ferma poate insera doar operatiunile fermei sale" ON public.operatiuni
FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    join public.parcele p on p.id = public.operatiuni.parcela_id
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = p.ferma_id
  )
);

DROP POLICY IF EXISTS "admin_ferma poate actualiza doar operatiunile fermei sale" ON public.operatiuni;
CREATE POLICY "admin_ferma poate actualiza doar operatiunile fermei sale" ON public.operatiuni
FOR UPDATE USING (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    join public.parcele p on p.id = public.operatiuni.parcela_id
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = p.ferma_id
  )
)
WITH CHECK (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    join public.parcele p on p.id = public.operatiuni.parcela_id
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = p.ferma_id
  )
);

-- Operatiuni_substante
ALTER TABLE public.operatiuni_substante ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_central vede toate operatiunile_substante" ON public.operatiuni_substante;
CREATE POLICY "admin_central vede toate operatiunile_substante" ON public.operatiuni_substante
FOR SELECT USING (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_ferma vede doar operatiunile_substante fermei sale" ON public.operatiuni_substante;
CREATE POLICY "admin_ferma vede doar operatiunile_substante fermei sale" ON public.operatiuni_substante
FOR SELECT USING (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    join public.operatiuni o on o.id = public.operatiuni_substante.operatiune_id
    join public.parcele p on p.id = o.parcela_id
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = p.ferma_id
  )
);

DROP POLICY IF EXISTS "admin_central poate insera operatiuni_substante" ON public.operatiuni_substante;
CREATE POLICY "admin_central poate insera operatiuni_substante" ON public.operatiuni_substante
FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_central poate actualiza operatiuni_substante" ON public.operatiuni_substante;
CREATE POLICY "admin_central poate actualiza operatiuni_substante" ON public.operatiuni_substante
FOR UPDATE USING (auth.role() = 'authenticated' AND public.is_admin_central())
WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_ferma poate insera doar operatiunile_substante fermei sale" ON public.operatiuni_substante;
CREATE POLICY "admin_ferma poate insera doar operatiunile_substante fermei sale" ON public.operatiuni_substante
FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    join public.operatiuni o on o.id = public.operatiuni_substante.operatiune_id
    join public.parcele p on p.id = o.parcela_id
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = p.ferma_id
  )
);

DROP POLICY IF EXISTS "admin_ferma poate actualiza doar operatiunile_substante fermei sale" ON public.operatiuni_substante;
CREATE POLICY "admin_ferma poate actualiza doar operatiunile_substante fermei sale" ON public.operatiuni_substante
FOR UPDATE USING (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    join public.operatiuni o on o.id = public.operatiuni_substante.operatiune_id
    join public.parcele p on p.id = o.parcela_id
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = p.ferma_id
  )
)
WITH CHECK (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    join public.operatiuni o on o.id = public.operatiuni_substante.operatiune_id
    join public.parcele p on p.id = o.parcela_id
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = p.ferma_id
  )
);

-- Recoltari
ALTER TABLE public.recoltari ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_central vede toate recoltările" ON public.recoltari;
CREATE POLICY "admin_central vede toate recoltările" ON public.recoltari
FOR SELECT USING (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_ferma vede doar recoltările fermei sale" ON public.recoltari;
CREATE POLICY "admin_ferma vede doar recoltările fermei sale" ON public.recoltari
FOR SELECT USING (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    join public.parcele p on p.id = public.recoltari.parcela_id
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = p.ferma_id
  )
);

DROP POLICY IF EXISTS "admin_central poate insera recoltări" ON public.recoltari;
CREATE POLICY "admin_central poate insera recoltări" ON public.recoltari
FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_central poate actualiza recoltări" ON public.recoltari;
CREATE POLICY "admin_central poate actualiza recoltări" ON public.recoltari
FOR UPDATE USING (auth.role() = 'authenticated' AND public.is_admin_central())
WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_ferma poate insera doar recoltările fermei sale" ON public.recoltari;
CREATE POLICY "admin_ferma poate insera doar recoltările fermei sale" ON public.recoltari
FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    join public.parcele p on p.id = public.recoltari.parcela_id
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = p.ferma_id
  )
);

DROP POLICY IF EXISTS "admin_ferma poate actualiza doar recoltările fermei sale" ON public.recoltari;
CREATE POLICY "admin_ferma poate actualiza doar recoltările fermei sale" ON public.recoltari
FOR UPDATE USING (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    join public.parcele p on p.id = public.recoltari.parcela_id
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = p.ferma_id
  )
)
WITH CHECK (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    join public.parcele p on p.id = public.recoltari.parcela_id
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = p.ferma_id
  )
);

-- Livrari
ALTER TABLE public.livrari ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_central vede toate livrările" ON public.livrari;
CREATE POLICY "admin_central vede toate livrările" ON public.livrari
FOR SELECT USING (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_ferma vede doar livrările fermei sale" ON public.livrari;
CREATE POLICY "admin_ferma vede doar livrările fermei sale" ON public.livrari
FOR SELECT USING (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = public.livrari.ferma_id
  )
);

DROP POLICY IF EXISTS "admin_central poate insera livrări" ON public.livrari;
CREATE POLICY "admin_central poate insera livrări" ON public.livrari
FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_central poate actualiza livrări" ON public.livrari;
CREATE POLICY "admin_central poate actualiza livrări" ON public.livrari
FOR UPDATE USING (auth.role() = 'authenticated' AND public.is_admin_central())
WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_ferma poate insera doar livrările fermei sale" ON public.livrari;
CREATE POLICY "admin_ferma poate insera doar livrările fermei sale" ON public.livrari
FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = public.livrari.ferma_id
  )
);

DROP POLICY IF EXISTS "admin_ferma poate actualiza doar livrările fermei sale" ON public.livrari;
CREATE POLICY "admin_ferma poate actualiza doar livrările fermei sale" ON public.livrari
FOR UPDATE USING (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = public.livrari.ferma_id
  )
)
WITH CHECK (
  auth.role() = 'authenticated'
  AND exists (
    select 1 from public.utilizatori u
    where u.id = auth.uid()
      and u.rol = 'admin_ferma'
      and u.ferma_id = public.livrari.ferma_id
  )
);

-- Cheltuieli indirecte
ALTER TABLE public.cheltuieli_indirecte ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_central vede toate cheltuielile indirecte" ON public.cheltuieli_indirecte;
CREATE POLICY "admin_central vede toate cheltuielile indirecte" ON public.cheltuieli_indirecte
FOR SELECT USING (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_central poate insera cheltuieli indirecte" ON public.cheltuieli_indirecte;
CREATE POLICY "admin_central poate insera cheltuieli indirecte" ON public.cheltuieli_indirecte
FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_central poate actualiza cheltuieli indirecte" ON public.cheltuieli_indirecte;
CREATE POLICY "admin_central poate actualiza cheltuieli indirecte" ON public.cheltuieli_indirecte
FOR UPDATE USING (auth.role() = 'authenticated' AND public.is_admin_central())
WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

-- Utilizatori
ALTER TABLE public.utilizatori ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth poate citi propriul user" ON public.utilizatori;
CREATE POLICY "auth poate citi propriul user" ON public.utilizatori
FOR SELECT USING (auth.role() = 'authenticated' AND id = auth.uid());

DROP POLICY IF EXISTS "admin_central poate citi toți utilizatorii" ON public.utilizatori;
CREATE POLICY "admin_central poate citi toți utilizatorii" ON public.utilizatori
FOR SELECT USING (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_central poate insera utilizatori" ON public.utilizatori;
CREATE POLICY "admin_central poate insera utilizatori" ON public.utilizatori
FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());

DROP POLICY IF EXISTS "admin_central poate actualiza utilizatori" ON public.utilizatori;
CREATE POLICY "admin_central poate actualiza utilizatori" ON public.utilizatori
FOR UPDATE USING (auth.role() = 'authenticated' AND public.is_admin_central())
WITH CHECK (auth.role() = 'authenticated' AND public.is_admin_central());
