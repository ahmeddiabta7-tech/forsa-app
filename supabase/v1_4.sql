-- ============================================================
-- Forsa V1.4 database update. Safe to run more than once.
-- "Make your own product": sellers ask Forsa's partner manufacturers for a
-- custom product. Steps: requested → quoted → accepted (deposit) → sample →
-- production → final_payment → live (a private product in the seller's business).
-- The conversation reuses the service-request chat (service = 'custom_product').
-- Factory identities are never stored here (codes only), like products.
-- ============================================================

-- ---------- Manufacturers ----------
create table if not exists public.manufacturers (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique check (length(code) between 2 and 20),
  name_en        text not null, name_ar text not null,
  description_en text not null default '', description_ar text not null default '',
  options_en     text not null default '', options_ar text not null default '',   -- what can be customized
  image_url      text not null default '',
  min_qty        integer not null default 50 check (min_qty > 0),
  price_from     integer not null default 0 check (price_from >= 0),           -- EGP per piece, starting from
  lead_days      integer not null default 14 check (lead_days > 0),
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

-- ---------- Private products (made for one seller) ----------
alter table public.products add column if not exists owner_id uuid references public.profiles(id) on delete set null;
create index if not exists products_owner_idx on public.products(owner_id);

create or replace function public.product_usable(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.products p where p.id = pid and (p.owner_id is null or p.owner_id = auth.uid() or public.is_admin()));
$$;

drop policy if exists "products read" on public.products;
create policy "products read" on public.products for select to authenticated
  using ((active and (owner_id is null or owner_id = auth.uid())) or public.is_admin());

drop policy if exists "bp add" on public.business_products;
create policy "bp add" on public.business_products for insert
  with check ((public.owns_business(business_id) and public.product_usable(product_id)) or public.is_admin());

create or replace function public.prepare_order() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.products;
begin
  select * into p from public.products where id = new.product_id and active;
  if not found then raise exception 'This product is not available'; end if;
  if new.unit_price < p.min_price then
    raise exception 'Selling price must be at least EGP %', p.min_price;
  end if;
  if not public.is_admin() then
    if p.owner_id is not null and p.owner_id <> new.seller_id then
      raise exception 'This product is not available';
    end if;
    if new.business_id is null
       or not exists (select 1 from public.businesses b where b.id = new.business_id and b.owner_id = new.seller_id)
       or not exists (select 1 from public.business_products bp where bp.business_id = new.business_id and bp.product_id = new.product_id) then
      raise exception 'Add this product to your business first';
    end if;
    new.status := 'pending';
  end if;
  new.wholesale_price := p.wholesale_price;
  new.delivered_at := case when new.status = 'delivered' then now() else null end;
  return new;
end $$;

-- Production cost as a cost category
alter table public.seller_expenses drop constraint if exists seller_expenses_category_check;
alter table public.seller_expenses add constraint seller_expenses_category_check
  check (category in ('ads','marketing','packaging','delivery','production','other'));

-- ---------- Custom product requests ----------
create table if not exists public.custom_requests (
  id                uuid primary key default gen_random_uuid(),
  seller_id         uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  business_id       uuid not null references public.businesses(id) on delete restrict,
  manufacturer_id   uuid not null references public.manufacturers(id) on delete restrict,
  thread_id         uuid not null unique references public.service_requests(id) on delete cascade,
  product_type      text not null check (length(trim(product_type)) between 2 and 80),
  details           text not null default '' check (length(details) <= 2000),
  quantity          integer not null check (quantity between 1 and 100000),
  status            text not null default 'requested'
                    check (status in ('requested','quoted','accepted','sample','production','final_payment','live','cancelled')),
  quote_unit_price  integer check (quote_unit_price >= 0),
  quote_total       integer check (quote_total >= 0),
  deposit_amount    integer check (deposit_amount >= 0),
  quote_note        text not null default '' check (length(quote_note) <= 1000),
  deposit_ref       text not null default '' check (length(deposit_ref) <= 80),
  deposit_confirmed boolean not null default false,
  balance_ref       text not null default '' check (length(balance_ref) <= 80),
  balance_confirmed boolean not null default false,
  product_id        uuid references public.products(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists custom_requests_seller_idx on public.custom_requests(seller_id, created_at desc);

-- Sellers create requests and can only: accept a quote, add payment references, or cancel early.
create or replace function public.guard_custom_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare m public.manufacturers;
begin
  new.updated_at := now();
  if public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    select * into m from public.manufacturers where id = new.manufacturer_id and active;
    if not found then raise exception 'This manufacturer is not available'; end if;
    if new.quantity < m.min_qty then raise exception 'Minimum quantity is %', m.min_qty; end if;
    if not public.owns_business(new.business_id) then raise exception 'Choose one of your businesses'; end if;
    if not exists (select 1 from public.service_requests r where r.id = new.thread_id and r.user_id = auth.uid()) then
      raise exception 'Invalid request';
    end if;
    new.seller_id := auth.uid(); new.status := 'requested';
    new.quote_unit_price := null; new.quote_total := null; new.deposit_amount := null; new.quote_note := '';
    new.deposit_ref := ''; new.balance_ref := ''; new.deposit_confirmed := false; new.balance_confirmed := false;
    new.product_id := null; new.created_at := now();
    return new;
  end if;
  -- UPDATE by the seller
  if new.status <> old.status and not (
       (old.status = 'quoted' and new.status = 'accepted')
    or (old.status in ('requested','quoted') and new.status = 'cancelled')) then
    raise exception 'This step is done by the Forsa team';
  end if;
  if not (old.status = 'accepted' and not old.deposit_confirmed) then new.deposit_ref := old.deposit_ref; end if;
  if not (old.status = 'final_payment' and not old.balance_confirmed) then new.balance_ref := old.balance_ref; end if;
  new.seller_id := old.seller_id; new.business_id := old.business_id; new.manufacturer_id := old.manufacturer_id;
  new.thread_id := old.thread_id; new.product_type := old.product_type; new.details := old.details; new.quantity := old.quantity;
  new.quote_unit_price := old.quote_unit_price; new.quote_total := old.quote_total; new.deposit_amount := old.deposit_amount;
  new.quote_note := old.quote_note; new.deposit_confirmed := old.deposit_confirmed; new.balance_confirmed := old.balance_confirmed;
  new.product_id := old.product_id; new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists custom_requests_guard on public.custom_requests;
create trigger custom_requests_guard before insert or update on public.custom_requests
  for each row execute function public.guard_custom_request();

-- ---------- Row Level Security ----------
alter table public.manufacturers enable row level security;
drop policy if exists "manufacturers read" on public.manufacturers;
create policy "manufacturers read" on public.manufacturers for select to authenticated using (active or public.is_admin());
drop policy if exists "manufacturers admin write" on public.manufacturers;
create policy "manufacturers admin write" on public.manufacturers for all using (public.is_admin()) with check (public.is_admin());

alter table public.custom_requests enable row level security;
drop policy if exists "custom read" on public.custom_requests;
create policy "custom read" on public.custom_requests for select using (seller_id = auth.uid() or public.is_admin());
drop policy if exists "custom create" on public.custom_requests;
create policy "custom create" on public.custom_requests for insert with check (seller_id = auth.uid());
drop policy if exists "custom update" on public.custom_requests;
create policy "custom update" on public.custom_requests for update using (seller_id = auth.uid() or public.is_admin());

grant select, insert, update, delete on public.manufacturers, public.custom_requests to authenticated;
grant execute on all functions in schema public to authenticated;

-- ---------- Example manufacturers (edit or hide them in Admin → Manufacturing) ----------
insert into public.manufacturers (code, name_en, name_ar, description_en, description_ar, options_en, options_ar, min_qty, price_from, lead_days)
select * from (values
  ('FM-201', 'Natural soaps & skincare', 'صابون ومنتجات عناية طبيعية',
   'Handmade soaps, body butters and lip balms from natural oils.', 'صابون يدوي وزبدة جسم ومرطب شفايف من زيوت طبيعية.',
   'Scent, color, shape, packaging, label with your brand', 'الريحة، اللون، الشكل، التغليف، ليبل باسم البراند بتاعك', 50, 35, 14),
  ('FM-202', 'Candles & home scents', 'شموع ومعطرات منزل',
   'Soy candles, reed diffusers and room sprays.', 'شموع صويا وفواحات أعواد وسبراي للغرف.',
   'Scent, jar type, wax color, label with your brand', 'الريحة، نوع البرطمان، لون الشمع، ليبل باسم البراند بتاعك', 40, 60, 12),
  ('FM-203', 'Coffee & spice blends', 'خلطات قهوة وتوابل',
   'Your own coffee blend or spice mix, packed in branded pouches.', 'خلطة قهوة أو توابل خاصة بيك، متعبية في أكياس باسمك.',
   'Blend, roast level, pouch size, label with your brand', 'الخلطة، درجة التحميص، حجم الكيس، ليبل باسم البراند بتاعك', 100, 25, 10)
) as v(code, name_en, name_ar, description_en, description_ar, options_en, options_ar, min_qty, price_from, lead_days)
where not exists (select 1 from public.manufacturers m where m.code = v.code);
