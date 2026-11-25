-- =====================================================================
-- Modul cost de producție — DOAR costuri directe (2026-11-25)
-- Costurile indirecte și overhead-ul rămân în contabilitate (SmartBill Conta).
-- Aplicația livrează lunar, pe fermă / parcelă / ciclu: cantități + valori
-- de consum (motorină, substanțe, materii prime), costuri directe manuale,
-- ore lucrate, mp recoltați și masa verde rămasă.
-- Migrare strict aditivă: nu modifică / nu șterge date existente.
-- =====================================================================

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Cicluri de producție pe parcelă (obiectul de cost)
--    Interval inclusiv [data_start, data_sfarsit]; ciclul următor începe
--    cel mai devreme a doua zi. data_sfarsit NULL = ciclu deschis.
--    complet = ciclu început după 1 oct 2026 (100% măsurat în aplicație);
--    ciclurile anterioare au partea dinainte de octombrie doar în contabilitate.
-- ---------------------------------------------------------------------
create table public.parcele_cicluri (
  id            uuid primary key default gen_random_uuid(),
  parcela_id    uuid not null references public.parcele(id) on delete restrict,
  tip_gazon     text,
  data_start    date not null,
  data_sfarsit  date,
  stare         text not null default 'in_crestere'
                check (stare in ('in_crestere','in_recoltare','inchis')),
  suprafata_mp  numeric check (suprafata_mp is null or suprafata_mp > 0),
  complet       boolean generated always as (data_start >= date '2026-10-01') stored,
  nota          text,
  creat_de      uuid references public.utilizatori(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  constraint parcele_cicluri_interval_valid
    check (data_sfarsit is null or data_sfarsit >= data_start),
  constraint parcele_cicluri_inchis_are_sfarsit
    check ((stare = 'inchis') = (data_sfarsit is not null)),
  constraint parcele_cicluri_fara_suprapunere
    exclude using gist (parcela_id with =,
                        daterange(data_start, data_sfarsit, '[]') with &&)
);
create index parcele_cicluri_parcela_idx on public.parcele_cicluri(parcela_id, data_start);

alter table public.parcele_cicluri enable row level security;
create policy "admin_central gestioneaza ciclurile" on public.parcele_cicluri
  for all using (auth.role() = 'authenticated' and is_admin_central())
  with check (auth.role() = 'authenticated' and is_admin_central());
create policy "admin_ferma vede ciclurile fermei sale" on public.parcele_cicluri
  for select using (auth.role() = 'authenticated' and exists (
    select 1 from public.utilizatori u join public.parcele p on p.id = parcele_cicluri.parcela_id
    where u.id = auth.uid() and u.rol = 'admin_ferma' and u.ferma_id = p.ferma_id));
create trigger jurnal_parcele_cicluri after insert or update or delete on public.parcele_cicluri
  for each row execute function inregistreaza_activitate();

-- ---------------------------------------------------------------------
-- 2. Prețul de consum fixat la momentul înregistrării (CMP curent al
--    gestiunii fermei), ca valoarea să nu se schimbe la recepțiile ulterioare.
--    Rândurile existente rămân NULL; job-ul de calcul le tratează ca
--    „preț aproximat" (CMP curent) și le marchează în export.
-- ---------------------------------------------------------------------
alter table public.operatiuni_substante     add column pret_unitar_consum numeric;
alter table public.operatiuni_materii_prime add column pret_unitar_consum numeric;

create function public.seteaza_pret_consum_substanta() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.pret_unitar_consum is null then
    select pret_unitar into new.pret_unitar_consum from substante where id = new.substanta_id;
  end if;
  return new;
end $$;

create function public.seteaza_pret_consum_materie_prima() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.pret_unitar_consum is null then
    select pret_unitar into new.pret_unitar_consum from materii_prime where id = new.materie_prima_id;
  end if;
  return new;
end $$;

create trigger aa_pret_consum_substanta before insert on public.operatiuni_substante
  for each row execute function seteaza_pret_consum_substanta();
create trigger aa_pret_consum_materie_prima before insert on public.operatiuni_materii_prime
  for each row execute function seteaza_pret_consum_materie_prima();

-- ---------------------------------------------------------------------
-- 3. Consum fixat pe operațiune (completat de edge function, service role).
--    Motorina se calculează azi la cerere din sondă; aici se îngheață.
--    Se recalculează doar explicit (versiune_algoritm + calculat_la).
-- ---------------------------------------------------------------------
create table public.operatiuni_consum (
  operatiune_id        uuid primary key references public.operatiuni(id) on delete cascade,
  litri_motorina       numeric check (litri_motorina is null or litri_motorina >= 0),
  motorina_masurata    boolean not null default false,  -- false = utilaj fără sondă calibrată
  pret_motorina_litru  numeric,
  valoare_motorina     numeric,
  valoare_materiale    numeric not null default 0,
  preturi_aproximate   boolean not null default false,  -- true = cel puțin un preț luat din CMP curent
  ore_lucru            numeric,
  mp_recoltat          numeric,
  versiune_algoritm    text not null,
  calculat_la          timestamptz not null default now()
);
alter table public.operatiuni_consum enable row level security;
create policy "admin_central vede consumul fixat" on public.operatiuni_consum
  for select using (auth.role() = 'authenticated' and is_admin_central());
-- fără politici de scriere: doar service role (edge function)

-- ---------------------------------------------------------------------
-- 4. Costuri directe introduse manual pe parcelă (servicii terți, ambalare)
-- ---------------------------------------------------------------------
create table public.costuri_directe_manuale (
  id              uuid primary key default gen_random_uuid(),
  parcela_id      uuid not null references public.parcele(id) on delete restrict,
  data            date not null,
  categorie       text not null check (categorie in ('servicii_terti','ambalare','altele')),
  descriere       text not null,
  cantitate       numeric,
  unitate_masura  text,
  suma_fara_tva   numeric not null check (suma_fara_tva >= 0),
  document        text,
  introdus_de     uuid references public.utilizatori(id) default auth.uid(),
  created_at      timestamptz not null default now()
);
create index costuri_directe_manuale_parcela_idx on public.costuri_directe_manuale(parcela_id, data);
alter table public.costuri_directe_manuale enable row level security;
create policy "admin_central gestioneaza costurile directe manuale" on public.costuri_directe_manuale
  for all using (auth.role() = 'authenticated' and is_admin_central())
  with check (auth.role() = 'authenticated' and is_admin_central());
create trigger jurnal_costuri_directe_manuale after insert or update or delete on public.costuri_directe_manuale
  for each row execute function inregistreaza_activitate();

-- ---------------------------------------------------------------------
-- 5. Cod SmartBill pe nomenclatoare (cheia de legătură în export)
-- ---------------------------------------------------------------------
alter table public.substante_nomenclator     add column cod_smartbill text unique;
alter table public.materii_prime_nomenclator add column cod_smartbill text unique;
