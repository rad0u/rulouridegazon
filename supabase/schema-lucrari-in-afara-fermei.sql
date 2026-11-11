-- 2026-11-11 (Radu): lucrări ale utilajelor ÎN AFARA parcelelor fermei, confirmate din
-- „Activități parcele”. Aplicat în Supabase ca migrare `lucrari_in_afara_fermei`.
-- Un rând = o sesiune GPS; sesiunile confirmate împreună au același grup_id; ore_lucru / locatie /
-- note se completează doar pe primul rând al grupului (ca la `operatiuni`).

create table if not exists public.lucrari_in_afara_fermei (
  id uuid primary key default gen_random_uuid(),
  grup_id uuid not null,
  ferma_id uuid not null references public.ferme(id),
  utilaj_id uuid not null references public.utilaje(id),
  tip text not null default 'Altele'
    check (tip in ('Udat','Tuns','Aspirat','Suprainsamantare','Fertilizare/Tratamente','Recoltare','Altele','Insamantare')),
  data date not null,
  sesiune_inceput timestamptz not null,
  sesiune_sfarsit timestamptz not null,
  ore_detectate numeric,
  litri_combustibil numeric,
  ore_lucru numeric check (ore_lucru is null or (ore_lucru = floor(ore_lucru) and ore_lucru >= 0 and ore_lucru <= 24)),
  locatie text,
  note text,
  user_id uuid references public.utilizatori(id),
  created_at timestamptz not null default now()
);

create index if not exists lucrari_in_afara_fermei_ferma_data_idx on public.lucrari_in_afara_fermei (ferma_id, data desc);
create index if not exists lucrari_in_afara_fermei_utilaj_sfarsit_idx on public.lucrari_in_afara_fermei (utilaj_id, sesiune_sfarsit);

alter table public.lucrari_in_afara_fermei enable row level security;

create policy "admin_central gestioneaza lucrarile in afara fermei"
  on public.lucrari_in_afara_fermei for all
  using (auth.role() = 'authenticated' and is_admin_central())
  with check (auth.role() = 'authenticated' and is_admin_central());

create policy "admin_ferma vede lucrarile in afara fermei ale fermei sale"
  on public.lucrari_in_afara_fermei for select
  using (auth.role() = 'authenticated' and exists (
    select 1 from utilizatori u
    where u.id = auth.uid() and u.rol = 'admin_ferma' and u.ferma_id = lucrari_in_afara_fermei.ferma_id));

create policy "admin_ferma inserează lucrari in afara fermei pentru ferma sa"
  on public.lucrari_in_afara_fermei for insert
  with check (auth.role() = 'authenticated' and exists (
    select 1 from utilizatori u
    where u.id = auth.uid() and u.rol = 'admin_ferma' and u.ferma_id = lucrari_in_afara_fermei.ferma_id));

create trigger jurnal_lucrari_in_afara_fermei
  after insert or update or delete on public.lucrari_in_afara_fermei
  for each row execute function public.inregistreaza_activitate();
