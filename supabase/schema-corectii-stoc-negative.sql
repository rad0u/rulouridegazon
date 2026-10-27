-- 2026-10-27 (Radu): "la alimentare gestiune ferma vreau sa accepte si cantitati
-- cu minus. Stocul faptic nu corespunde cu scriptic si vreau sa pot face
-- corectii de stoc ca sa aliniez cu contabilitatea."
--
-- O alimentare cu cantitate NEGATIVĂ = corecție de stoc (scădere). Reguli:
--  * cantitatea poate fi orice număr diferit de 0 (înainte: > 0);
--  * la cantitate negativă prețul introdus se ignoră: intrarea se salvează la
--    prețul mediu CURENT al gestiunii, deci prețul mediu nu se modifică (formula
--    din recalculeaza_stoc_substanta rămâne consistentă la reeditări);
--  * recalculeaza_stoc_substanta nu necesită modificări.

alter table public.substante_intrari drop constraint if exists substante_intrari_cantitate_check;
alter table public.substante_intrari add constraint substante_intrari_cantitate_check check (cantitate <> 0);

create or replace function public.alimenteaza_substanta(
  p_ferma_id uuid,
  p_nomenclator_id uuid,
  p_cantitate numeric,
  p_pret_intrare_unitar numeric,
  p_data date default current_date,
  p_furnizor text default null,
  p_nota text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_substanta_id uuid;
  v_stoc_vechi numeric;
  v_pret_vechi numeric;
  v_pret_aplicat numeric;
  v_nume text;
  v_unitate text;
begin
  if not is_admin_central() then
    raise exception 'Doar admin general poate alimenta gestiunile fermelor.';
  end if;

  if p_cantitate is null or p_cantitate = 0 then
    raise exception 'Cantitatea nu poate fi 0 (folosește o valoare negativă pentru o corecție de stoc).';
  end if;
  if p_cantitate > 0 and (p_pret_intrare_unitar is null or p_pret_intrare_unitar < 0) then
    raise exception 'Prețul de intrare nu poate fi negativ.';
  end if;

  select nume, unitate_masura into v_nume, v_unitate
  from substante_nomenclator where id = p_nomenclator_id;

  if v_nume is null then
    raise exception 'Substanța din nomenclator nu a fost găsită.';
  end if;

  select id, stoc_curent, pret_unitar into v_substanta_id, v_stoc_vechi, v_pret_vechi
  from substante
  where ferma_id = p_ferma_id and nomenclator_id = p_nomenclator_id
  for update;

  -- Corecție negativă: la prețul mediu curent (prețul mediu rămâne neschimbat).
  if p_cantitate < 0 then
    v_pret_aplicat := coalesce(v_pret_vechi, p_pret_intrare_unitar, 0);
  else
    v_pret_aplicat := p_pret_intrare_unitar;
  end if;

  if v_substanta_id is null then
    insert into substante (nume, unitate_masura, ferma_id, nomenclator_id, stoc_curent, pret_unitar)
    values (v_nume, v_unitate, p_ferma_id, p_nomenclator_id, p_cantitate, v_pret_aplicat)
    returning id into v_substanta_id;
  else
    update substante
    set stoc_curent = coalesce(v_stoc_vechi, 0) + p_cantitate,
        pret_unitar = case
          when coalesce(v_stoc_vechi, 0) + p_cantitate = 0 then v_pret_aplicat
          else ((coalesce(v_stoc_vechi, 0) * coalesce(v_pret_vechi, 0)) + (p_cantitate * v_pret_aplicat))
               / (coalesce(v_stoc_vechi, 0) + p_cantitate)
        end
    where id = v_substanta_id;
  end if;

  insert into substante_intrari (substanta_id, cantitate, pret_intrare_unitar, data, furnizor, nota, introdus_de)
  values (v_substanta_id, p_cantitate, v_pret_aplicat, p_data, p_furnizor, p_nota, auth.uid());

  return v_substanta_id;
end;
$function$;

create or replace function public.editeaza_alimentare_substanta(
  p_intrare_id uuid,
  p_ferma_id uuid,
  p_cantitate numeric,
  p_pret_intrare_unitar numeric,
  p_data date,
  p_furnizor text default null,
  p_nota text default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  if p_cantitate is null or p_cantitate = 0 then
    raise exception 'Cantitatea nu poate fi 0.';
  end if;
  if p_pret_intrare_unitar is null or p_pret_intrare_unitar < 0 then
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

-- Materii prime: aceeași schimbare (aplicată ca migrare Supabase
-- `corectii_stoc_negative_alimentare_materii_prime`) — constrângerea
-- materii_prime_intrari_cantitate_check devine `cantitate <> 0`, iar funcțiile
-- alimenteaza_materie_prima / editeaza_alimentare_materie_prima sunt identice
-- cu cele de mai sus, cu tabelele materii_prime / materii_prime_intrari /
-- materii_prime_nomenclator (coloana materie_prima_id) și
-- recalculeaza_stoc_materie_prima. Definițiile complete: vezi migrarea.
