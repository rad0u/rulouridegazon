-- 2026-10-21: coordonatele de sosire pe curse (adresa de sosire poate fi completata oricand).
-- Aplicat live in Supabase. Vezi NOTES.md (2026-10-21, adrese pe foaia de parcurs).
alter table public.curse
  add column if not exists latitudine_stop numeric,
  add column if not exists longitudine_stop numeric;

-- Backfill (rulat o singura data): pozitia de la momentul opririi.
update public.curse c
set latitudine_stop = p.latitudine, longitudine_stop = p.longitudine
from public.masini_pozitii p
where p.masina_id = c.masina_id
  and p.data_ora = c.data_ora_stop
  and c.data_ora_stop is not null
  and c.latitudine_stop is null;
