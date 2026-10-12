-- 2026-10-12 (Radu): „unitatea de masura trebuie sa fie: litrul, bucata sau kilogram, cu subunitati".
-- Unități de bază admise: l, kg, buc. Subunitățile (ml, g) există doar la introducerea cantităților
-- în aplicație (lib/unitati.ts) și se convertesc în unitatea de bază înainte de salvare.
--
-- APLICAT deja în producție (rulat ca instrucțiuni separate). Păstrat aici pentru istoric / refacere.

-- 1) Produsele în tone (SULFAT DE AMONIU, TOP DRESSING BIG BAG, LIFE NG+, FERTIL 12,5) -> kg.
--    Cantități ×1000, prețuri ÷1000; valoarea în lei a stocului rămâne neschimbată.
with ids as (select id from substante where unitate_masura='t'),
i as (update substante_intrari set cantitate=cantitate*1000, pret_intrare_unitar=pret_intrare_unitar/1000
      where substanta_id in (select id from ids) returning 1),
o as (update operatiuni_substante set cantitate=cantitate*1000
      where substanta_id in (select id from ids) returning 1),
s as (update substante set unitate_masura='kg', stoc_curent=stoc_curent*1000, pret_unitar=pret_unitar/1000
      where id in (select id from ids) returning 1),
n as (update substante_nomenclator set unitate_masura='kg' where unitate_masura='t' returning 1)
select (select count(*) from i) intrari, (select count(*) from o) consum,
       (select count(*) from s) substante, (select count(*) from n) nomenclator;

-- 2) Restricție: doar l / kg / buc.
alter table public.substante add constraint substante_um_check check (unitate_masura in ('l','kg','buc'));
alter table public.substante_nomenclator add constraint substante_nomenclator_um_check check (unitate_masura in ('l','kg','buc'));
alter table public.materii_prime add constraint materii_prime_um_check check (unitate_masura in ('l','kg','buc'));
alter table public.materii_prime_nomenclator add constraint materii_prime_nomenclator_um_check check (unitate_masura in ('l','kg','buc'));
