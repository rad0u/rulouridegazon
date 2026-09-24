-- schema-alimentari-masini.sql
--
-- 2026-09-24, migrare "creeaza_alimentari_masini" (Radu): "sectiunea
-- Alimentari utilaje o redenumim Alimentari auto din rezervor Ferma. La
-- unele ferme autoturismele se alimenteaza din tancul de motorina. Pe
-- pagina sa apara un dropdown cu masinile inregistrate pe ferma respectiva,
-- cantitatea alimentata si data" — clarificat ulterior: pagina "Alimentări
-- utilaje" NU se repurpose (rămâne folosită de get-combustibil-report),
-- doar se ascunde din meniu (utilajele nu se mai alimentează manual, doar
-- prin citirile senzorilor); alimentările auto sunt o pagină nouă, separată,
-- cu propria tabelă.
--
-- Structură + RLS identice ca la `alimentari_utilaje`, dar legate de
-- `masini` (nu `utilaje`) — ferma se deduce prin join la masini.ferma_id.
--
-- Cantitatea introdusă aici e scăzută ca ieșire suplimentară a rezervorului
-- central în get-rezervor-central-miscari v2 (alături de consumul
-- utilajelor), la fermele unde mașinile de pasageri se alimentează din
-- rezervorul central în loc de la pompă.

create table public.alimentari_masini (
  id uuid primary key default gen_random_uuid(),
  masina_id uuid not null references public.masini(id) on delete cascade,
  data_ora timestamptz not null default now(),
  cantitate_litri numeric not null check (cantitate_litri > 0),
  note text,
  user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index alimentari_masini_masina_id_idx on public.alimentari_masini (masina_id);
create index alimentari_masini_data_ora_idx on public.alimentari_masini (data_ora desc);

alter table public.alimentari_masini enable row level security;

create policy "admin_central gestioneaza alimentarile masinilor"
  on public.alimentari_masini for all
  using (auth.role() = 'authenticated' and is_admin_central())
  with check (auth.role() = 'authenticated' and is_admin_central());

create policy "admin_ferma adauga alimentari pentru masinile fermei sale"
  on public.alimentari_masini for insert
  with check (
    auth.role() = 'authenticated' and exists (
      select 1 from masini m
      join utilizatori u on u.ferma_id = m.ferma_id
      where m.id = alimentari_masini.masina_id and u.id = auth.uid() and u.rol = 'admin_ferma'
    )
  );

create policy "admin_ferma vede alimentarile masinilor fermei sale"
  on public.alimentari_masini for select
  using (
    auth.role() = 'authenticated' and exists (
      select 1 from masini m
      join utilizatori u on u.ferma_id = m.ferma_id
      where m.id = alimentari_masini.masina_id and u.id = auth.uid() and u.rol = 'admin_ferma'
    )
  );
