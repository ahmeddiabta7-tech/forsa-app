-- ============================================================
-- Forsa V1.11 database update (app version 1.12). Safe to run more than once.
-- Seller websites:
-- 1) app_settings: numbers the admin can change (website_min_orders = 20 delivered orders).
-- 2) websites: one branded website per business, made from a template. A seller requests it after
--    enough delivered orders; the admin accepts / rejects / pauses it. Only accepted + published
--    websites are public.
-- 3) Public store page + orders from it through two functions only (public_store, place_store_order):
--    the price comes from the database, phones are checked, orders are limited, nothing else is exposed.
-- 4) orders.source: 'app' or 'website' (set by the database, can't be changed).
-- ============================================================

-- ---------- 1) Settings ----------
create table if not exists public.app_settings (
  key        text primary key check (key in ('website_min_orders')),
  value      integer not null check (value between 0 and 100000),
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values ('website_min_orders', 20) on conflict (key) do nothing;
alter table public.app_settings enable row level security;
drop policy if exists "settings read" on public.app_settings;
create policy "settings read" on public.app_settings for select to authenticated using (true);
drop policy if exists "settings admin update" on public.app_settings;
create policy "settings admin update" on public.app_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, update on public.app_settings to authenticated;

create or replace function public.setting_int(k text, dflt integer) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.app_settings where key = k), dflt);
$$;

-- ---------- 4) Where an order came from ----------
alter table public.orders add column if not exists source text not null default 'app';
do $$ begin
  alter table public.orders add constraint orders_source_check check (source in ('app','website'));
exception when duplicate_object then null; end $$;

create or replace function public.order_source_insert() returns trigger
language plpgsql as $$
begin
  new.source := case when coalesce(current_setting('forsa.site_order', true), '') = '1' then 'website' else 'app' end;
  return new;
end $$;
drop trigger if exists orders_source_insert on public.orders;
create trigger orders_source_insert before insert on public.orders
  for each row execute function public.order_source_insert();

create or replace function public.order_source_keep() returns trigger
language plpgsql as $$
begin new.source := old.source; return new; end $$;
drop trigger if exists orders_source_keep on public.orders;
create trigger orders_source_keep before update on public.orders
  for each row execute function public.order_source_keep();

-- ---------- 2) Websites ----------
create table if not exists public.websites (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null unique references public.businesses(id) on delete cascade,
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'requested' check (status in ('requested','approved','rejected','paused')),
  reason       text not null default '' check (length(reason) <= 300),
  published    boolean not null default false,
  slug         text unique check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'),
  template     text not null default 'classic' check (template in ('classic','bold','minimal')),
  brand_name   text not null default '' check (length(brand_name) <= 60),
  about        text not null default '' check (length(about) <= 400),
  color        text not null default 'black' check (color in ('black','green','blue','red','purple','orange','pink','brown')),
  logo_url     text not null default '' check (length(logo_url) <= 500),
  cover_url    text not null default '' check (length(cover_url) <= 500),
  instagram    text not null default '' check (length(instagram) <= 200),
  tiktok       text not null default '' check (length(tiktok) <= 200),
  facebook     text not null default '' check (length(facebook) <= 200),
  items        jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 60),
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  updated_at   timestamptz not null default now()
);
create index if not exists websites_owner_idx on public.websites(owner_id);
alter table public.websites enable row level security;
drop policy if exists "websites read own" on public.websites;
create policy "websites read own" on public.websites for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());
-- No direct insert/update/delete: everything goes through the functions below.
revoke all on public.websites from anon;
grant select on public.websites to authenticated;

-- Delivered orders that count toward a website (orders to the seller's own number don't count).
create or replace function public.delivered_count(seller uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.orders where seller_id = seller and status = 'delivered' and not own_order;
$$;

-- Seller: ask for a website for one of their businesses.
create or replace function public.request_website(p_business uuid) returns public.websites
language plpgsql security definer set search_path = public as $$
declare w public.websites; need integer; have integer; b public.businesses;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into b from public.businesses where id = p_business and owner_id = auth.uid();
  if not found then raise exception 'This business is not yours'; end if;
  need := public.setting_int('website_min_orders', 20);
  have := public.delivered_count(auth.uid());
  if have < need then raise exception 'You need % delivered orders to request a website (you have %)', need, have; end if;
  select * into w from public.websites where business_id = p_business;
  if found then
    if w.status = 'rejected' then
      update public.websites set status = 'requested', reason = '', requested_at = now(), decided_at = null, updated_at = now()
        where id = w.id returning * into w;
      return w;
    end if;
    raise exception 'You already have a website request for this business';
  end if;
  insert into public.websites (business_id, owner_id, brand_name, logo_url)
    values (p_business, auth.uid(), left(b.name, 60), b.logo_url) returning * into w;
  return w;
end $$;

-- Seller: save the website (only after the admin accepted it).
create or replace function public.save_website(p_business uuid, p jsonb) returns public.websites
language plpgsql security definer set search_path = public as $$
declare w public.websites; it jsonb; clean jsonb := '[]'::jsonb; seen uuid[] := '{}'; pid uuid; pr integer; prod public.products;
        featured integer := 0; s text; reserved text[] := array['admin','forsa','api','app','www','store','shop','help','support','login','signup','home','orders','products','business','s'];
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into w from public.websites where business_id = p_business and owner_id = auth.uid();
  if not found then raise exception 'Website not found'; end if;
  if w.status <> 'approved' then raise exception 'Your website is not approved yet'; end if;

  s := lower(trim(coalesce(p->>'slug', '')));
  if s = '' then s := null; end if;
  if s is not null and (s !~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$') then raise exception 'Link name: 3-30 small English letters, numbers or dashes'; end if;
  if s = any(reserved) then raise exception 'This link name is not allowed'; end if;
  if s is not null and exists (select 1 from public.websites where slug = s and id <> w.id) then raise exception 'This link name is taken'; end if;

  for it in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
    begin pid := (it->>'product_id')::uuid; exception when others then raise exception 'Invalid product'; end;
    if pid = any(seen) then continue; end if;
    select * into prod from public.products where id = pid and active;
    if not found or (prod.owner_id is not null and prod.owner_id <> auth.uid())
       or not exists (select 1 from public.business_products where business_id = p_business and product_id = pid) then
      raise exception 'Add this product to your business first';
    end if;
    begin pr := round((it->>'price')::numeric); exception when others then raise exception 'Invalid price'; end;
    if pr is null or pr < prod.min_price then raise exception 'Price for % must be at least EGP %', prod.name_en, prod.min_price; end if;
    if pr > 1000000 then raise exception 'Price is too high'; end if;
    if coalesce((it->>'featured')::boolean, false) then featured := featured + 1; end if;
    if featured > 3 then raise exception 'You can feature up to 3 products'; end if;
    clean := clean || jsonb_build_array(jsonb_build_object('product_id', pid, 'price', pr, 'featured', coalesce((it->>'featured')::boolean, false)));
    seen := seen || pid;
  end loop;
  if jsonb_array_length(clean) > 60 then raise exception 'Up to 60 products'; end if;

  update public.websites set
    slug = s,
    template = coalesce(nullif(p->>'template', ''), template),
    brand_name = left(trim(coalesce(p->>'brand_name', '')), 60),
    about = left(trim(coalesce(p->>'about', '')), 400),
    color = coalesce(nullif(p->>'color', ''), color),
    logo_url = left(trim(coalesce(p->>'logo_url', '')), 500),
    cover_url = left(trim(coalesce(p->>'cover_url', '')), 500),
    instagram = left(trim(coalesce(p->>'instagram', '')), 200),
    tiktok = left(trim(coalesce(p->>'tiktok', '')), 200),
    facebook = left(trim(coalesce(p->>'facebook', '')), 200),
    items = clean,
    published = case when s is null or jsonb_array_length(clean) = 0 or length(trim(coalesce(p->>'brand_name', ''))) < 2 then false else published end,
    updated_at = now()
  where id = w.id returning * into w;
  return w;
end $$;

-- Seller: publish / unpublish.
create or replace function public.publish_website(p_business uuid, p_on boolean) returns public.websites
language plpgsql security definer set search_path = public as $$
declare w public.websites;
begin
  select * into w from public.websites where business_id = p_business and owner_id = auth.uid();
  if not found then raise exception 'Website not found'; end if;
  if p_on then
    if w.status <> 'approved' then raise exception 'Your website is not approved yet'; end if;
    if w.slug is null then raise exception 'Choose a link name first'; end if;
    if length(trim(w.brand_name)) < 2 then raise exception 'Add your brand name first'; end if;
    if jsonb_array_length(w.items) = 0 then raise exception 'Add at least one product first'; end if;
  end if;
  update public.websites set published = p_on, updated_at = now() where id = w.id returning * into w;
  return w;
end $$;

-- Admin: accept / reject / pause (with a reason).
create or replace function public.admin_decide_website(p_id uuid, p_status text, p_reason text default '') returns public.websites
language plpgsql security definer set search_path = public as $$
declare w public.websites;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('approved','rejected','paused') then raise exception 'Invalid status'; end if;
  update public.websites set status = p_status, reason = left(trim(coalesce(p_reason, '')), 300),
    decided_at = now(), updated_at = now(),
    published = case when p_status = 'approved' then published else false end
  where id = p_id returning * into w;
  if not found then raise exception 'Website not found'; end if;
  return w;
end $$;

-- Admin: all requests with the numbers needed to decide.
create or replace function public.admin_websites() returns table (
  id uuid, business_id uuid, business_name text, owner_name text, status text, reason text, published boolean,
  slug text, requested_at timestamptz, decided_at timestamptz, delivered integer, returned integer, cancelled integer,
  total integer, days_active integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query
  select w.id, w.business_id, b.name, pr.full_name, w.status, w.reason, w.published, w.slug, w.requested_at, w.decided_at,
    (select count(*)::int from public.orders o where o.seller_id = w.owner_id and o.status = 'delivered' and not o.own_order),
    (select count(*)::int from public.orders o where o.seller_id = w.owner_id and o.status = 'returned'),
    (select count(*)::int from public.orders o where o.seller_id = w.owner_id and o.status = 'cancelled'),
    (select count(*)::int from public.orders o where o.seller_id = w.owner_id),
    greatest(0, extract(day from now() - pr.created_at)::int)
  from public.websites w join public.businesses b on b.id = w.business_id join public.profiles pr on pr.id = w.owner_id
  order by (w.status = 'requested') desc, w.requested_at desc;
end $$;

-- ---------- 3) Public store page ----------
create or replace function public.public_store(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare w public.websites;
begin
  select * into w from public.websites where slug = lower(trim(p_slug)) and status = 'approved' and published;
  if not found then return null; end if;
  return jsonb_build_object(
    'slug', w.slug, 'template', w.template, 'brand_name', w.brand_name, 'about', w.about, 'color', w.color,
    'logo_url', w.logo_url, 'cover_url', w.cover_url, 'instagram', w.instagram, 'tiktok', w.tiktok, 'facebook', w.facebook,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name_en', p.name_en, 'name_ar', p.name_ar, 'description_en', p.description_en, 'description_ar', p.description_ar,
        'image_url', p.image_url, 'category', p.category,
        'price', greatest((x.it->>'price')::int, p.min_price), 'featured', coalesce((x.it->>'featured')::boolean, false)
      ) order by x.n)
      from jsonb_array_elements(w.items) with ordinality as x(it, n)
      join public.products p on p.id = (x.it->>'product_id')::uuid and p.active
      where exists (select 1 from public.business_products bp where bp.business_id = w.business_id and bp.product_id = p.id)
    ), '[]'::jsonb),
    'shipping', coalesce((select jsonb_agg(jsonb_build_object('governorate', r.governorate, 'fee', r.fee) order by r.governorate)
                          from public.shipping_rates r where r.active), '[]'::jsonb)
  );
end $$;

-- A customer orders on the website. Returns the order number only.
create or replace function public.place_store_order(
  p_slug text, p_product uuid, p_qty integer, p_name text, p_phone text, p_governorate text,
  p_address text, p_options text default '', p_hp text default ''
) returns bigint
language plpgsql security definer set search_path = public as $$
declare w public.websites; it jsonb; prod public.products; c text; pr integer; n bigint;
begin
  if coalesce(p_hp, '') <> '' then raise exception 'Invalid request'; end if;
  select * into w from public.websites where slug = lower(trim(p_slug)) and status = 'approved' and published;
  if not found then raise exception 'This store is not available'; end if;
  select x into it from jsonb_array_elements(w.items) x where x->>'product_id' = p_product::text limit 1;
  if it is null then raise exception 'This product is not available'; end if;
  select * into prod from public.products where id = p_product and active;
  if not found then raise exception 'This product is not available'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 10 then raise exception 'Quantity must be 1 to 10'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 or length(p_name) > 80 then raise exception 'Enter your name'; end if;
  if length(trim(coalesce(p_address, ''))) < 5 or length(p_address) > 300 then raise exception 'Enter your full address'; end if;
  c := public.norm_phone(p_phone);
  if c !~ '^1[0125][0-9]{8}$' then raise exception 'Enter a valid Egyptian mobile number'; end if;
  if (select count(*) from public.orders o where o.business_id = w.business_id and o.source = 'website'
        and public.norm_phone(o.customer_phone) = c and o.created_at > now() - interval '1 day') >= 3 then
    raise exception 'Too many orders from this number today. Please try again tomorrow.';
  end if;
  if (select count(*) from public.orders o where o.business_id = w.business_id and o.source = 'website'
        and o.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'This store is busy right now. Please try again later.';
  end if;
  pr := greatest((it->>'price')::int, prod.min_price);
  perform set_config('forsa.site_order', '1', true);
  insert into public.orders (seller_id, business_id, product_id, quantity, unit_price, customer_name, customer_phone,
                             governorate, address, product_options, notes)
  values (w.owner_id, w.business_id, p_product, p_qty, pr, left(trim(p_name), 80), '0' || c,
          p_governorate, left(trim(p_address), 300), left(trim(coalesce(p_options, '')), 200), '')
  returning order_no into n;
  perform set_config('forsa.site_order', '0', true);
  return n;
end $$;

-- ---------- Grants ----------
revoke execute on function public.setting_int(text, integer) from public, anon, authenticated;
revoke execute on function public.delivered_count(uuid) from public, anon, authenticated;
revoke execute on function public.request_website(uuid) from public, anon;
revoke execute on function public.save_website(uuid, jsonb) from public, anon;
revoke execute on function public.publish_website(uuid, boolean) from public, anon;
revoke execute on function public.admin_decide_website(uuid, text, text) from public, anon;
revoke execute on function public.admin_websites() from public, anon;
grant execute on function public.request_website(uuid) to authenticated;
grant execute on function public.save_website(uuid, jsonb) to authenticated;
grant execute on function public.publish_website(uuid, boolean) to authenticated;
grant execute on function public.admin_decide_website(uuid, text, text) to authenticated;
grant execute on function public.admin_websites() to authenticated;
grant execute on function public.public_store(text) to anon, authenticated;
grant execute on function public.place_store_order(text, uuid, integer, text, text, text, text, text, text) to anon, authenticated;
