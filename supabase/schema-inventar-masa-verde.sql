-- 2026-10-30 (Radu): „Inventar masă verde” — evidența gazonului rămas de recoltat,
-- măsurat cu SW Maps. Un inventar = un import (fermă + dată), istoricul se păstrează.
-- NU modifică tabela `parcele`. Aplicat în Supabase ca migrare `inventar_masa_verde`.

create table public.inventar_masa_verde (
  id uuid primary key default gen_random_uuid(),
  ferma_id uuid not null references public.ferme(id),
  data_inventar date not null,
  nota text,
  nume_fisier text,
  introdus_de uuid references public.utilizatori(id),
  created_at timestamptz not null default now()
);

create table public.inventar_masa_verde_parcele (
  id uuid primary key default gen_random_uuid(),
  inventar_id uuid not null references public.inventar_masa_verde(id) on delete cascade,
  parcela_id uuid references public.parcele(id) on delete set null,
  nume_parcela text not null,
  -- instantaneu al parcelei la data inventarului (raportul rămâne identic dacă parcela se modifică ulterior)
  suprafata_totala_mp numeric,
  poligon_parcela jsonb,
  -- conturul măsurat al gazonului rămas (GeoJSON Polygon, [lon, lat], precizie completă din fișier)
  suprafata_masa_verde_mp numeric not null check (suprafata_masa_verde_mp >= 0),
  poligon_masa_verde jsonb not null,
  created_at timestamptz not null default now()
);

create index inventar_masa_verde_ferma_idx on public.inventar_masa_verde (ferma_id, data_inventar desc);
create index inventar_masa_verde_parcele_inventar_idx on public.inventar_masa_verde_parcele (inventar_id);

alter table public.inventar_masa_verde enable row level security;
alter table public.inventar_masa_verde_parcele enable row level security;

create policy "admin_central gestioneaza inventarul de masa verde" on public.inventar_masa_verde
  for all using (auth.role() = 'authenticated' and is_admin_central())
  with check (auth.role() = 'authenticated' and is_admin_central());

create policy "admin_central gestioneaza parcelele inventarului de masa verde" on public.inventar_masa_verde_parcele
  for all using (auth.role() = 'authenticated' and is_admin_central())
  with check (auth.role() = 'authenticated' and is_admin_central());
