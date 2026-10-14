-- 2026-10-14 (Radu): „sa resetezi toate confirmarile de lucrari de fertilizare solida sau lichida,
-- de la toate fermele, incepand cu 01.10.2026 pana la zi. Voi opera din nou confirmarile."
--
-- SE RULEAZĂ MANUAL în Supabase -> SQL Editor (rol postgres). Aplicația nu are politică DELETE pe operatiuni.
-- Ce face (într-o singură tranzacție):
--   1) salvează copii în tabele backup_reset_* (RLS activat, fără acces din API);
--   2) șterge liniile de consum (operatiuni_substante / operatiuni_materii_prime) și operațiunile:
--      'Fertilizare/Tratamente' (Fertilizare solidă) și 'Suprainsamantare' (Tratamente foliare / lichidă),
--      cu data >= 2026-10-01, de la toate fermele (inclusiv rândurile-soră ale aceleiași sesiuni, fără consum);
--   3) recalculează stocul și prețul mediu pentru substanțele afectate (stoc = intrări − consumuri rămase);
--   4) afișează verificările. NU atinge: Recoltare, Altele (celelalte lucrări), Însămânțare, intrările de stoc.
-- După rulare, sesiunile GPS respective apar din nou ca neconfirmate în /activitati-parcele.

begin;

create table backup_reset_operatiuni_20261014 as
  select * from operatiuni
  where data >= date '2026-10-01' and tip in ('Fertilizare/Tratamente', 'Suprainsamantare');

create table backup_reset_operatiuni_substante_20261014 as
  select * from operatiuni_substante
  where operatiune_id in (select id from backup_reset_operatiuni_20261014);

create table backup_reset_operatiuni_materii_prime_20261014 as
  select * from operatiuni_materii_prime
  where operatiune_id in (select id from backup_reset_operatiuni_20261014);

alter table backup_reset_operatiuni_20261014 enable row level security;
alter table backup_reset_operatiuni_substante_20261014 enable row level security;
alter table backup_reset_operatiuni_materii_prime_20261014 enable row level security;

-- Așteptat (la 14.10.2026): 21 operațiuni, 14 linii substanțe, 0 linii materii prime.
select (select count(*) from backup_reset_operatiuni_20261014) as operatiuni,
       (select count(*) from backup_reset_operatiuni_substante_20261014) as linii_substante,
       (select count(*) from backup_reset_operatiuni_materii_prime_20261014) as linii_materii_prime;

create temp table subst_afectate on commit drop as
  select distinct substanta_id from backup_reset_operatiuni_substante_20261014;

delete from operatiuni_substante where id in (select id from backup_reset_operatiuni_substante_20261014);
delete from operatiuni_materii_prime where id in (select id from backup_reset_operatiuni_materii_prime_20261014);
delete from operatiuni where id in (select id from backup_reset_operatiuni_20261014);

select recalculeaza_stoc_substanta(substanta_id) from subst_afectate;

-- Verificări: 0 operațiuni rămase de tipul resetat; 0 diferențe între stoc și intrări − consumuri.
select count(*) as ramase_fertilizare_de_la_1_oct
from operatiuni where data >= date '2026-10-01' and tip in ('Fertilizare/Tratamente', 'Suprainsamantare');

select count(*) as substante_cu_stoc_gresit
from substante s
where abs(s.stoc_curent
  - (coalesce((select sum(cantitate) from substante_intrari i where i.substanta_id = s.id), 0)
   - coalesce((select sum(cantitate) from operatiuni_substante o where o.substanta_id = s.id), 0))) > 0.0001;

commit;

-- Refacere (doar dacă e nevoie): reinserează din backup, apoi stocul se scade automat prin triggere:
--   insert into operatiuni select * from backup_reset_operatiuni_20261014;
--   insert into operatiuni_substante select * from backup_reset_operatiuni_substante_20261014;
