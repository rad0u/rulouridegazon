-- 2026-10-16 (Radu): „la Substante, pe langa Alimentare gestiune, mai vreau un buton transfer intre gestiuni.
-- Operatoarea are posibilitatea sa transfere de la o gestiune la alta substante, de exemplu din Sabareni la alta ferma."
--
-- APLICAT în producție (instrucțiuni rulate pe rând). Păstrat pentru istoric / refacere.
-- Model: un transfer = ieșire din gestiunea sursă (substante.id al fermei sursă) + intrare în gestiunea
-- destinație (substanța cu același nomenclator_id la ferma destinație; se creează dacă lipsește), la prețul
-- mediu al sursei din momentul transferului. Stocul și prețul mediu se recalculează cu
-- recalculeaza_stoc_substanta (acum include transferurile): stoc = intrări + transferuri primite
-- − consumuri − transferuri trimise.

create table public.substante_transferuri (
  id uuid primary key default gen_random_uuid(),
  substanta_sursa_id uuid not null references public.substante(id),
  substanta_dest_id uuid not null references public.substante(id),
  cantitate numeric not null check (cantitate > 0),
  pret_unitar numeric not null check (pret_unitar >= 0),
  data date not null default current_date,
  nota text,
  introdus_de uuid,
  created_at timestamptz not null default now(),
  check (substanta_sursa_id <> substanta_dest_id)
);

alter table public.substante_transferuri add constraint substante_transferuri_introdus_de_fkey
  foreign key (introdus_de) references public.utilizatori(id);
alter table public.substante_transferuri enable row level security;

create policy "admin_central vede transferurile de substante" on public.substante_transferuri
  for select using (auth.role() = 'authenticated' and is_admin_central());
create policy "admin_ferma vede transferurile fermei sale" on public.substante_transferuri
  for select using (auth.role() = 'authenticated' and exists (
    select 1 from public.utilizatori u join public.substante s on s.ferma_id = u.ferma_id
    where u.id = auth.uid() and u.rol = 'admin_ferma'
      and s.id in (substante_transferuri.substanta_sursa_id, substante_transferuri.substanta_dest_id)));
-- Fără politici INSERT/UPDATE/DELETE: scrierea se face doar prin transfera_substanta (SECURITY DEFINER).

create trigger jurnal_substante_transferuri after insert or update or delete on public.substante_transferuri
  for each row execute function public.inregistreaza_activitate();
create index substante_transferuri_sursa_idx on public.substante_transferuri(substanta_sursa_id);
create index substante_transferuri_dest_idx on public.substante_transferuri(substanta_dest_id);

-- recalculeaza_stoc_substanta: versiunea cu transferuri (vezi definiția live în DB):
--   intrare (ordine 0): substante_intrari + transferuri primite (la pret_unitar al transferului)
--   consum  (ordine 1): operatiuni_substante + transferuri trimise

-- transfera_substanta(p_substanta_sursa_id, p_ferma_dest_id, p_cantitate, p_data, p_nota) -> uuid
--   doar admin_central; verifică cantitate > 0, sursă cu nomenclator, fermă destinație diferită,
--   stoc suficient; creează gestiunea destinație dacă lipsește; inserează transferul; recalculează ambele stocuri.

-- Verificare stoc (include transferurile):
--   select count(*) from substante s where abs(s.stoc_curent
--     - (coalesce((select sum(cantitate) from substante_intrari i where i.substanta_id=s.id),0)
--      + coalesce((select sum(cantitate) from substante_transferuri t where t.substanta_dest_id=s.id),0)
--      - coalesce((select sum(cantitate) from operatiuni_substante o where o.substanta_id=s.id),0)
--      - coalesce((select sum(cantitate) from substante_transferuri t where t.substanta_sursa_id=s.id),0))) > 0.0001;
