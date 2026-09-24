-- schema-substante-corectie-ferma.sql
--
-- 2026-09-24, migrare "editeaza_alimentare_substanta_cu_ferma" (Radu): "la
-- gestiunea de substante, campul corecteaza vreau sa poata corecta si campul
-- Ferma" — până acum, corecția unei alimentări din istoric (butonul
-- "Corectează" din /substante, admin general) permitea doar
-- cantitate/preț/dată/furnizor/notă; ferma și substanța erau fixe.
--
-- NOTĂ: tabelele `public.substante`, `public.substante_intrari`,
-- `public.substante_nomenclator` și funcțiile `alimenteaza_substanta` /
-- `recalculeaza_stoc_substanta` (create devreme, înainte de convenția
-- schema-*.sql = sursă de adevăr per migrare) nu au un fișier propriu cu
-- CREATE TABLE / definiția inițială — vezi live schema din Supabase.
-- Fișierul de față documentează doar migrarea de mai jos.
--
-- O `substante_intrari` nu are `ferma_id` direct — e legată de un rând din
-- `substante`, care e per (ferma_id, nomenclator_id). Dacă admin-ul schimbă
-- ferma la corecție, `editeaza_alimentare_substanta` mută rândul de intrare
-- pe rândul `substante` corespunzător fermei noi + aceeași substanță din
-- nomenclator (creat dacă nu există încă acolo, cu stoc 0) și recalculează
-- stocul/prețul mediu pe AMBELE fermă (cea veche, care pierde intrarea, și
-- cea nouă, care o capătă) cu funcția existentă `recalculeaza_stoc_substanta`
-- — corect chiar dacă între timp au mai fost consumuri (operatiuni_substante)
-- legate de acel rând. Dacă substanța nu are `nomenclator_id` (caz vechi,
-- legacy — verificat 2026-09-24: 0 din 38 de rânduri), mutarea pe altă fermă
-- e refuzată explicit, ca să nu creeze un rând `substante` orfan fără
-- legătură la nomenclator.

DROP FUNCTION IF EXISTS public.editeaza_alimentare_substanta(uuid, numeric, numeric, date, text, text);

CREATE OR REPLACE FUNCTION public.editeaza_alimentare_substanta(
  p_intrare_id uuid,
  p_ferma_id uuid,
  p_cantitate numeric,
  p_pret_intrare_unitar numeric,
  p_data date,
  p_furnizor text DEFAULT NULL::text,
  p_nota text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_substanta_id_vechi uuid;
  v_ferma_id_vechi uuid;
  v_nomenclator_id uuid;
  v_nume text;
  v_unitate text;
  v_substanta_id_nou uuid;
begin
  if not is_admin_central() then
    raise exception 'Doar admin general poate corecta alimentările.';
  end if;
  if p_cantitate <= 0 then
    raise exception 'Cantitatea trebuie să fie pozitivă.';
  end if;
  if p_pret_intrare_unitar < 0 then
    raise exception 'Prețul de intrare nu poate fi negativ.';
  end if;
  if p_ferma_id is null then
    raise exception 'Alege ferma.';
  end if;

  select si.substanta_id, s.ferma_id, s.nomenclator_id, s.nume, s.unitate_masura
    into v_substanta_id_vechi, v_ferma_id_vechi, v_nomenclator_id, v_nume, v_unitate
  from substante_intrari si
  join substante s on s.id = si.substanta_id
  where si.id = p_intrare_id;

  if v_substanta_id_vechi is null then
    raise exception 'Alimentarea nu a fost găsită.';
  end if;

  if p_ferma_id = v_ferma_id_vechi then
    v_substanta_id_nou := v_substanta_id_vechi;
  else
    if v_nomenclator_id is null then
      raise exception 'Această substanță nu are un nomenclator asociat — nu se poate muta pe altă fermă automat.';
    end if;

    select id into v_substanta_id_nou
    from substante
    where ferma_id = p_ferma_id and nomenclator_id = v_nomenclator_id
    for update;

    if v_substanta_id_nou is null then
      insert into substante (nume, unitate_masura, ferma_id, nomenclator_id, stoc_curent, pret_unitar)
      values (v_nume, v_unitate, p_ferma_id, v_nomenclator_id, 0, null)
      returning id into v_substanta_id_nou;
    end if;
  end if;

  update substante_intrari
  set substanta_id = v_substanta_id_nou,
      cantitate = p_cantitate,
      pret_intrare_unitar = p_pret_intrare_unitar,
      data = p_data,
      furnizor = p_furnizor,
      nota = p_nota
  where id = p_intrare_id;

  perform recalculeaza_stoc_substanta(v_substanta_id_vechi);
  if v_substanta_id_nou <> v_substanta_id_vechi then
    perform recalculeaza_stoc_substanta(v_substanta_id_nou);
  end if;
end;
$function$;
