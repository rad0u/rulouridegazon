-- schema-materii-prime.sql
--
-- 2026-09-24, migrare "creeaza_materii_prime_si_insamantare" (Radu): "a mai
-- aparut o operatiune de introdus in Activitati Parcele: Insamantare. Mai
-- trebuie o noua baza de date, pe langa cea cu fertilizanti - materii prime
-- in care deocamdata trecem seminte gazon, urmand sa incarc gestiunile
-- fermelor cu cantitatea de seminte de gazon"
--
-- 1) Tip nou de operațiune: 'Insamantare' (etichetă "Însămânțare"), adăugat
--    la operatiuni_tip_check. NU s-a reutilizat 'Suprainsamantare' — acea
--    valoare e deja folosită activ, sub eticheta "Tratamente foliare" (vezi
--    lib/operatiuniTypes.ts), pentru o cu totul altă lucrare.
-- 2) Gestiune "materii prime", structură + RLS + RPC-uri identice ca la
--    `substante`/`substante_intrari`/`substante_nomenclator`/
--    `operatiuni_substante`, dar complet separată — ca gestiunea de
--    fertilizanți și cea de semințe (și orice altă materie primă viitoare)
--    să nu se amestece. Nomenclatorul a fost semănat cu o singură intrare,
--    "Semințe gazon" (kg) — Radu urmează să încarce stocul per fermă din
--    /materii-prime.
--
-- Wired în frontend:
--  - lib/operatiuniTypes.ts: TIPURI_CU_MATERII_PRIME, MateriePrima,
--    MateriePrimaOperatiune.
--  - app/materii-prime/MateriiPrimeScreen.tsx (+ layout/page): oglindă
--    exactă a app/substante/SubstanteScreen.tsx.
--  - app/activitati-parcele/ActivitatiParceleScreen.tsx: selectorul "A fost
--    fertilizare?" a devenit un select unic "Tip lucrare" (Fertilizare
--    solidă / Tratamente foliare / Însămânțare), care arată fie selectorul
--    de substanțe, fie cel de materii prime, după caz.

alter table public.operatiuni drop constraint operatiuni_tip_check;
alter table public.operatiuni add constraint operatiuni_tip_check
  check (tip = any (array['Udat','Tuns','Aspirat','Suprainsamantare','Fertilizare/Tratamente','Recoltare','Altele','Insamantare']));

create table public.materii_prime_nomenclator (
  id uuid primary key default gen_random_uuid(),
  nume text not null unique,
  unitate_masura text not null,
  created_at timestamptz not null default now()
);

create table public.materii_prime (
  id uuid primary key default gen_random_uuid(),
  nume text not null,
  unitate_masura text not null,
  stoc_curent numeric default 0,
  pret_unitar numeric,
  ferma_id uuid references public.ferme(id),
  nomenclator_id uuid references public.materii_prime_nomenclator(id),
  constraint materii_prime_ferma_nomenclator_unique unique (ferma_id, nomenclator_id)
);

create table public.materii_prime_intrari (
  id uuid primary key default gen_random_uuid(),
  materie_prima_id uuid not null references public.materii_prime(id),
  cantitate numeric not null check (cantitate > 0),
  pret_intrare_unitar numeric not null check (pret_intrare_unitar >= 0),
  data date not null default current_date,
  furnizor text,
  nota text,
  introdus_de uuid references public.utilizatori(id),
  created_at timestamptz not null default now()
);

create table public.operatiuni_materii_prime (
  id uuid primary key default gen_random_uuid(),
  operatiune_id uuid not null references public.operatiuni(id),
  materie_prima_id uuid not null references public.materii_prime(id),
  cantitate numeric not null
);

-- Trigger de scădere a stocului (mirrors scade_stoc_substanta)
create or replace function public.scade_stoc_materie_prima()
returns trigger
language plpgsql
security definer
as $$
begin
  update public.materii_prime
  set stoc_curent = stoc_curent - new.cantitate
  where id = new.materie_prima_id;
  return new;
end;
$$;

create trigger scade_stoc_materie_prima_trigger
  after insert on public.operatiuni_materii_prime
  for each row execute function scade_stoc_materie_prima();

-- Jurnal de activitate (materii_prime_intrari nu are jurnal, la fel ca substante_intrari)
create trigger jurnal_materii_prime
  after insert or delete or update on public.materii_prime
  for each row execute function inregistreaza_activitate();

create trigger jurnal_materii_prime_nomenclator
  after insert or delete or update on public.materii_prime_nomenclator
  for each row execute function inregistreaza_activitate();

create trigger jurnal_operatiuni_materii_prime
  after insert or delete or update on public.operatiuni_materii_prime
  for each row execute function inregistreaza_activitate();

-- RLS — vezi migrarea aplicată (mcp__Supabase__apply_migration,
-- "creeaza_materii_prime_si_insamantare") pentru textul complet al
-- politicilor; identice structural cu cele de la substanțe.

-- RPC-uri: alimenteaza_materie_prima, recalculeaza_stoc_materie_prima,
-- editeaza_alimentare_materie_prima — oglindă exactă a
-- alimenteaza_substanta / recalculeaza_stoc_substanta /
-- editeaza_alimentare_substanta (vezi migrarea aplicată pentru codul complet).

insert into public.materii_prime_nomenclator (nume, unitate_masura) values ('Semințe gazon', 'kg');
