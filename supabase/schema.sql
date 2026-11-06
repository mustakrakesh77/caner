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

-- ===== v2: adet, öncelik, kişi, not, en düşük/yüksek fiyat, bütçe =====
alter table items add column if not exists quantity int default 1;
alter table items add column if not exists priority text default 'sart';   -- 'sart' | 'iyi'
alter table items add column if not exists assignee text;
alter table items add column if not exists note text;
alter table items add column if not exists lowest_price numeric;
alter table items add column if not exists highest_price numeric;

create table if not exists settings (
  key text primary key,
  value jsonb
);
alter table settings enable row level security;
drop policy if exists "settings_all" on settings;
create policy "settings_all" on settings for all to anon using (true) with check (true);

-- ===== v3: eşleşme doğrulama ve aday seçimi =====
alter table items add column if not exists candidates jsonb default '[]'::jsonb;  -- Akakçe aday listesi
alter table items add column if not exists match_state text;                      -- 'verified' | 'guess' | 'pick' | 'confirmed'
alter table items add column if not exists match_note text;                       -- eşleşmenin nedeni / uyarı
alter table items add column if not exists offers_total int;                         -- Akakçe'deki toplam teklif sayısı

-- ===== v4: ortak onay ve "yeni" rozeti =====
alter table items add column if not exists approvals jsonb default '[]'::jsonb;  -- onaylayanların adları
alter table items add column if not exists updated_at timestamptz;               -- ürünü en son değiştirme zamanı (kullanıcı)
alter table items add column if not exists updated_by text;                      -- değiştiren kişi

-- ===== v5: wishlist (kişisel listeler) =====
alter table items add column if not exists owner text;   -- boş = ortak ihtiyaçlar; 'Sıla' / 'Caner' = o kişinin wishlist'i
