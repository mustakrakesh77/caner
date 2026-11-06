-- Supabase > SQL Editor'e yapıştırıp Run'a bas.

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_url text,
  akakce_url text,
  category text default 'Genel',
  target_price numeric,
  current_price numeric,
  prev_price numeric,
  best_store text,
  best_url text,
  offers jsonb default '[]'::jsonb,
  match_confirmed boolean default false,
  purchased boolean default false,
  purchased_at timestamptz,
  added_by text,
  last_checked timestamptz,
  last_error text,
  created_at timestamptz default now()
);

create table if not exists price_history (
  id bigserial primary key,
  item_id uuid references items(id) on delete cascade,
  price numeric,
  store text,
  checked_at timestamptz default now()
);

-- Sonradan eklenen sütun (görsel). Eski kurulumda sadece bu satırı çalıştırman yeterli.
alter table items add column if not exists image_url text;

alter table items enable row level security;
alter table price_history enable row level security;

-- Uygulama anon anahtarla çalışır: listeyi okuyup yazabilir.
create policy "items_all" on items for all to anon using (true) with check (true);
create policy "history_read" on price_history for select to anon using (true);

-- Canlı güncelleme için
alter publication supabase_realtime add table items;
