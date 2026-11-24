-- ============================================================
-- Forsa V1.13 database update (app version 1.13). Safe to run more than once.
-- 1) Website design freedom: 6 templates + a `style` (font, background, buttons, header, layout, cover,
--    sections) and ANY colour (#rrggbb) so sellers' websites don't all look the same.
-- 2) Connect an existing Shopify store: the seller asks, Forsa approves, the seller adds a webhook in
--    Shopify. New Shopify orders arrive through the Edge Function "store-webhook", which only passes the
--    raw request to ingest_shopify_order(); the signature (HMAC-SHA256) is checked HERE with the seller's
--    Shopify signing key. Orders Forsa can't match (product code, price, phone, governorate, prepaid)
--    wait in "Needs review" until the seller fixes them.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- 1) Website design ----------
alter table public.websites add column if not exists style jsonb not null default '{}'::jsonb;
alter table public.websites drop constraint if exists websites_color_check;
alter table public.websites add constraint websites_color_check
  check (color in ('black','green','blue','red','purple','orange','pink','brown') or color ~ '^#[0-9a-f]{6}$');
alter table public.websites drop constraint if exists websites_template_check;
alter table public.websites add constraint websites_template_check
  check (template in ('classic','bold','minimal','elegant','playful','dark'));

-- Only known keys and values are kept.
create or replace function public.clean_website_style(p jsonb) returns jsonb
language plpgsql immutable as $$
declare r jsonb := '{}'::jsonb; k text; allowed jsonb := '{
  "font": ["modern","elegant","rounded","strong"],
  "bg": ["white","cream","tint","dark"],
  "buttons": ["rounded","pill","square"],
  "header": ["left","center","banner"],
  "layout": ["grid2","grid3","list","large"],
  "cover": ["wide","overlay","none"]
}'::jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return r; end if;
  for k in select jsonb_object_keys(allowed) loop
    if allowed->k ? (p->>k) then r := r || jsonb_build_object(k, p->>k); end if;
  end loop;
  foreach k in array array['show_about','show_social','show_featured'] loop
    if jsonb_typeof(p->k) = 'boolean' then r := r || jsonb_build_object(k, p->k); end if;
  end loop;
  return r;
end $$;

-- save_website: same as v1.11 plus style + any colour + new templates.
create or replace function public.save_website(p_business uuid, p jsonb) returns public.websites
language plpgsql security definer set search_path = public as $$
declare w public.websites; it jsonb; clean jsonb := '[]'::jsonb; seen uuid[] := '{}'; pid uuid; pr integer; prod public.products;
        featured integer := 0; s text; col text; tpl text;
        reserved text[] := array['admin','forsa','api','app','www','store','shop','help','support','login','signup','home','orders','products','business','s'];
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

  col := lower(coalesce(nullif(p->>'color', ''), w.color));
  if not (col in ('black','green','blue','red','purple','orange','pink','brown') or col ~ '^#[0-9a-f]{6}$') then raise exception 'Invalid colour'; end if;
  tpl := coalesce(nullif(p->>'template', ''), w.template);
  if tpl not in ('classic','bold','minimal','elegant','playful','dark') then raise exception 'Invalid template'; end if;

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
    slug = s, template = tpl, color = col, style = public.clean_website_style(p->'style'),
    brand_name = left(trim(coalesce(p->>'brand_name', '')), 60),
    about = left(trim(coalesce(p->>'about', '')), 400),
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

-- public_store: same as v1.11 plus style.
create or replace function public.public_store(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare w public.websites;
begin
  select * into w from public.websites where slug = lower(trim(p_slug)) and status = 'approved' and published;
  if not found then return null; end if;
  return jsonb_build_object(
    'slug', w.slug, 'template', w.template, 'style', w.style, 'brand_name', w.brand_name, 'about', w.about, 'color', w.color,
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

-- ---------- 2) Connect Shopify ----------
-- Orders can now also come from Shopify.
alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check check (source in ('app','website','shopify'));
create or replace function public.order_source_insert() returns trigger
language plpgsql as $$
declare v text := coalesce(current_setting('forsa.site_order', true), '');
begin
  new.source := case when v = '1' then 'website' when v = 'shopify' then 'shopify' else 'app' end;
  return new;
end $$;

-- Short product code sellers put as the SKU in Shopify, e.g. FS-3F9A1C.
create or replace function public.forsa_code(p uuid) returns text
language sql immutable as $$ select 'FS-' || upper(substr(replace(p::text, '-', ''), 1, 6)) $$;
grant execute on function public.forsa_code(uuid) to anon, authenticated;

create table if not exists public.store_connections (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null unique references public.businesses(id) on delete cascade,
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  platform      text not null default 'shopify' check (platform in ('shopify')),
  shop          text not null check (length(shop) between 3 and 200),
  status        text not null default 'requested' check (status in ('requested','approved','rejected','paused')),
  reason        text not null default '' check (length(reason) <= 300),
  token         text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  has_secret    boolean not null default false,
  orders_count  integer not null default 0,
  last_order_at timestamptz,
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz
);
alter table public.store_connections enable row level security;
drop policy if exists "connections read own" on public.store_connections;
create policy "connections read own" on public.store_connections for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());
revoke all on public.store_connections from anon;
grant select on public.store_connections to authenticated;

-- The Shopify signing key: nobody can read it back (not even the seller); only the database uses it.
create table if not exists public.store_connection_secrets (
  connection_id uuid primary key references public.store_connections(id) on delete cascade,
  secret        text not null check (length(secret) between 10 and 300),
  updated_at    timestamptz not null default now()
);
alter table public.store_connection_secrets enable row level security;
revoke all on public.store_connection_secrets from anon, authenticated;

-- Orders from Shopify: everything that arrives is logged here; good ones become Forsa orders right away,
-- the rest wait for the seller ("review").
create table if not exists public.external_orders (
  id            uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.store_connections(id) on delete cascade,
  business_id   uuid not null references public.businesses(id) on delete cascade,
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  external_id   text not null,
  external_ref  text not null default '',
  status        text not null default 'review' check (status in ('review','created','dismissed')),
  problem       text not null default '',
  data          jsonb not null default '{}'::jsonb,
  order_id      uuid references public.orders(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (connection_id, external_id)
);
create index if not exists external_orders_owner_idx on public.external_orders(owner_id, status);
alter table public.external_orders enable row level security;
drop policy if exists "external orders read own" on public.external_orders;
create policy "external orders read own" on public.external_orders for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());
revoke all on public.external_orders from anon;
grant select on public.external_orders to authenticated;

-- Seller: ask to connect a Shopify store to one business.
create or replace function public.request_connection(p_business uuid, p_shop text) returns public.store_connections
language plpgsql security definer set search_path = public as $$
declare c public.store_connections; sh text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.businesses where id = p_business and owner_id = auth.uid()) then raise exception 'This business is not yours'; end if;
  sh := lower(trim(coalesce(p_shop, '')));
  sh := regexp_replace(sh, '^https?://', '');
  sh := regexp_replace(sh, '/.*$', '');
  if sh !~ '^[a-z0-9][a-z0-9.-]{1,198}[a-z0-9]$' or sh !~ '\.' then raise exception 'Write your Shopify store address, e.g. nour.myshopify.com'; end if;
  select * into c from public.store_connections where business_id = p_business;
  if found then
    if c.status = 'rejected' then
      update public.store_connections set shop = sh, status = 'requested', reason = '', requested_at = now(), decided_at = null
        where id = c.id returning * into c;
      return c;
    end if;
    raise exception 'You already asked to connect a store to this business';
  end if;
  insert into public.store_connections (business_id, owner_id, shop) values (p_business, auth.uid(), sh) returning * into c;
  return c;
end $$;

-- Seller: save the Shopify signing key (after Forsa approved the connection).
create or replace function public.set_connection_secret(p_business uuid, p_secret text) returns public.store_connections
language plpgsql security definer set search_path = public as $$
declare c public.store_connections; s text := trim(coalesce(p_secret, ''));
begin
  select * into c from public.store_connections where business_id = p_business and owner_id = auth.uid();
  if not found then raise exception 'Connection not found'; end if;
  if c.status <> 'approved' then raise exception 'Your connection is not approved yet'; end if;
  if length(s) < 10 or length(s) > 300 or s ~ '\s' then raise exception 'Paste the full signing key from Shopify'; end if;
  insert into public.store_connection_secrets (connection_id, secret) values (c.id, s)
    on conflict (connection_id) do update set secret = excluded.secret, updated_at = now();
  update public.store_connections set has_secret = true where id = c.id returning * into c;
  return c;
end $$;

-- Admin: list + decide.
create or replace function public.admin_connections() returns table (
  id uuid, business_id uuid, business_name text, owner_name text, platform text, shop text, status text, reason text,
  has_secret boolean, orders_count integer, last_order_at timestamptz, requested_at timestamptz, delivered integer, review integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query
  select c.id, c.business_id, b.name, pr.full_name, c.platform, c.shop, c.status, c.reason, c.has_secret, c.orders_count, c.last_order_at, c.requested_at,
    (select count(*)::int from public.orders o where o.seller_id = c.owner_id and o.status = 'delivered' and not o.own_order),
    (select count(*)::int from public.external_orders e where e.connection_id = c.id and e.status = 'review')
  from public.store_connections c join public.businesses b on b.id = c.business_id join public.profiles pr on pr.id = c.owner_id
  order by (c.status = 'requested') desc, c.requested_at desc;
end $$;

create or replace function public.admin_decide_connection(p_id uuid, p_status text, p_reason text default '') returns public.store_connections
language plpgsql security definer set search_path = public as $$
declare c public.store_connections;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('approved','rejected','paused') then raise exception 'Invalid status'; end if;
  update public.store_connections set status = p_status, reason = left(trim(coalesce(p_reason, '')), 300), decided_at = now()
    where id = p_id returning * into c;
  if not found then raise exception 'Connection not found'; end if;
  return c;
end $$;

-- Match a Shopify province / city to a Forsa governorate (active shipping rate).
create or replace function public.match_governorate(p text) returns text
language plpgsql stable security definer set search_path = public as $$
declare n text; g text;
begin
  n := lower(coalesce(p, ''));
  n := regexp_replace(n, '(governorate|محافظة|province)', '', 'g');
  n := regexp_replace(n, '^\s*(al|el|ad|ash|as|an|at|ar)[\s-]+', '');
  n := regexp_replace(n, '[^a-z0-9؀-ۿ]', '', 'g');
  if n = '' then return null; end if;
  if n in ('6thofoctober','sixthofoctober','october','6october') then n := 'giza'; end if;
  if n in ('helwan','newcairo','nasrcity','qahirah','alqahirah','qahira') then n := 'cairo'; end if;
  if n in ('jizah','gizeh','giza','jiza') then n := 'giza'; end if;
  if n in ('ismailiya','ismailia') then n := 'ismailia'; end if;
  if n in ('portsaid','bursaid') then n := 'portsaid'; end if;
  if n in ('dumyat','damietta') then n := 'damietta'; end if;
  if n in ('daqahliya','daqahliyah','dakahlia','daqahlia','dakahleya') then n := 'dakahlia'; end if;
  if n in ('gharbiya','gharbiyah','gharbia') then n := 'gharbia'; end if;
  if n in ('suhag','sohag') then n := 'sohag'; end if;
  if n in ('banisuwayf','benisuef','benisweif') then n := 'benisuef'; end if;
  if n in ('minya','menya','minia') then n := 'minya'; end if;
  if n in ('qina','qena','kena') then n := 'qena'; end if;
  if n in ('uqsur','luxor') then n := 'luxor'; end if;
  if n in ('aswan','aswaan') then n := 'aswan'; end if;
  if n in ('bahrahmar','redsea') then n := 'redsea'; end if;
  if n in ('qaliubiya','qalyoubia','kalyubia','qaliubia','qalyubiyah','qalyubiya') then n := 'qalyubia'; end if;
  if n in ('sharkia','sharkiya','sharqiyah','sharqiya') then n := 'sharqia'; end if;
  if n in ('fayoum','fayum') then n := 'faiyum'; end if;
  if n in ('menofia','minufiya','minufiyah','menoufia') then n := 'monufia'; end if;
  if n in ('behira','buhayrah','beheirah','bahira') then n := 'beheira'; end if;
  if n in ('assiut','assyut') then n := 'asyut'; end if;
  if n in ('marsamatruh','matruh') then n := 'matrouh'; end if;
  if n in ('kafrelsheikh','kafrashsheikh','kafralsheikh') then n := 'kafrelsheikh'; end if;
  if n in ('alexandria','alex','iskandariya','iskandariyah','الاسكندرية','الإسكندرية') then n := 'alexandria'; end if;
  if n in ('القاهرة','القاهره') then n := 'cairo'; end if;
  if n in ('الجيزة','الجيزه') then n := 'giza'; end if;
  select r.governorate into g from public.shipping_rates r
    where r.active and regexp_replace(lower(r.governorate), '[^a-z0-9]', '', 'g') = n limit 1;
  return g;
end $$;

-- Turns one checked line into a Forsa order (as the seller, marked "shopify").
create or replace function public.create_external_forsa_order(e public.external_orders, p_product uuid, p_qty integer, p_price integer,
  p_name text, p_phone text, p_governorate text, p_address text, p_options text) returns uuid
language plpgsql security definer set search_path = public as $$
declare oid uuid;
begin
  perform set_config('forsa.site_order', 'shopify', true);
  insert into public.orders (seller_id, business_id, product_id, quantity, unit_price, customer_name, customer_phone, governorate, address, product_options, notes)
  values (e.owner_id, e.business_id, p_product, p_qty, p_price, left(p_name, 80), p_phone, p_governorate, left(p_address, 300), left(coalesce(p_options, ''), 200),
          left('Shopify ' || coalesce(e.external_ref, ''), 200))
  returning id into oid;
  perform set_config('forsa.site_order', '0', true);
  return oid;
end $$;

-- Called by the Edge Function "store-webhook" for each Shopify "Order creation" webhook.
-- Returns: 'ok' | 'review' | 'duplicate' | 'ignored' | error (unauthorized / bad signature / not active).
create or replace function public.ingest_shopify_order(p_conn uuid, p_token text, p_body text, p_hmac text) returns text
language plpgsql security definer set search_path = public as $$
declare c public.store_connections; sec text; calc text; o jsonb; li jsonb; addr jsonb; e public.external_orders;
        sku text; prod public.products; qty integer; price integer; phone text; gov text; name text; address text; opts text;
        problem text; result text := 'duplicate'; oid uuid; ext text;
begin
  select * into c from public.store_connections where id = p_conn;
  if not found or c.token <> coalesce(p_token, '') then raise exception 'unauthorized'; end if;
  if c.status <> 'approved' then raise exception 'connection not active'; end if;
  select secret into sec from public.store_connection_secrets where connection_id = c.id;
  if sec is null then raise exception 'signing key missing'; end if;
  calc := encode(extensions.hmac(convert_to(coalesce(p_body, ''), 'UTF8'), convert_to(sec, 'UTF8'), 'sha256'), 'base64');
  if calc <> coalesce(p_hmac, '') then raise exception 'bad signature'; end if;
  if (select count(*) from public.external_orders x where x.connection_id = c.id and x.created_at > now() - interval '1 hour') >= 300 then
    raise exception 'too many orders';
  end if;
  begin o := p_body::jsonb; exception when others then raise exception 'bad body'; end;
  if jsonb_typeof(o->'line_items') <> 'array' then return 'ignored'; end if;

  addr := coalesce(o->'shipping_address', o->'billing_address', '{}'::jsonb);
  name := trim(concat_ws(' ', addr->>'first_name', addr->>'last_name'));
  if name = '' then name := trim(concat_ws(' ', o#>>'{customer,first_name}', o#>>'{customer,last_name}')); end if;
  phone := public.norm_phone(coalesce(nullif(addr->>'phone', ''), nullif(o->>'phone', ''), nullif(o#>>'{customer,phone}', ''), ''));
  gov := coalesce(public.match_governorate(addr->>'province'), public.match_governorate(addr->>'city'));
  address := trim(concat_ws(', ', nullif(addr->>'address1', ''), nullif(addr->>'address2', ''), nullif(addr->>'city', ''), nullif(addr->>'province', '')));

  for li in select * from jsonb_array_elements(o->'line_items') loop
    ext := coalesce(o->>'id', '') || ':' || coalesce(li->>'id', '');
    if exists (select 1 from public.external_orders x where x.connection_id = c.id and x.external_id = ext) then continue; end if;
    sku := upper(trim(coalesce(li->>'sku', '')));
    qty := greatest(1, least(10, coalesce((li->>'quantity')::int, 1)));
    begin price := round((li->>'price')::numeric); exception when others then price := null; end;
    opts := left(trim(concat_ws(' · ', nullif(li->>'variant_title', ''), nullif(o->>'note', ''))), 200);
    select p.* into prod from public.products p
      where p.active and public.forsa_code(p.id) = sku
        and exists (select 1 from public.business_products bp where bp.business_id = c.business_id and bp.product_id = p.id)
        and (p.owner_id is null or p.owner_id = c.owner_id)
      limit 1;
    problem := case
      when coalesce(o->>'financial_status', '') in ('paid', 'partially_paid') then 'paid_online'
      when prod.id is null then 'unknown_product'
      when price is null or price < prod.min_price then 'price_below_min'
      when phone !~ '^1[0125][0-9]{8}$' then 'bad_phone'
      when gov is null then 'unknown_governorate'
      when length(name) < 2 or length(address) < 5 then 'missing_address'
      else '' end;
    insert into public.external_orders (connection_id, business_id, owner_id, external_id, external_ref, status, problem, data)
    values (c.id, c.business_id, c.owner_id, ext, left(coalesce(o->>'name', ''), 40), case when problem = '' then 'created' else 'review' end, problem,
      jsonb_build_object('title', left(coalesce(li->>'title', ''), 120), 'variant', left(coalesce(li->>'variant_title', ''), 120), 'sku', sku,
        'quantity', qty, 'price', price, 'product_id', prod.id, 'name', left(name, 80), 'phone', case when phone = '' then '' else '0' || phone end,
        'province', left(coalesce(addr->>'province', addr->>'city', ''), 80), 'governorate', gov, 'address', left(address, 300), 'options', opts,
        'financial_status', coalesce(o->>'financial_status', '')))
    returning * into e;
    if problem = '' then
      oid := public.create_external_forsa_order(e, prod.id, qty, price, name, '0' || phone, gov, address, opts);
      update public.external_orders set order_id = oid where id = e.id;
      if result <> 'review' then result := 'ok'; end if;
    else
      result := 'review';
    end if;
  end loop;
  update public.store_connections set orders_count = orders_count + 1, last_order_at = now() where id = c.id;
  return result;
end $$;

-- Seller: fix an order that needs review and turn it into a Forsa order.
create or replace function public.resolve_external_order(p_id uuid, p_product uuid, p_qty integer, p_price integer, p_name text, p_phone text,
  p_governorate text, p_address text, p_options text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.external_orders; prod public.products; c text; oid uuid;
begin
  select * into e from public.external_orders where id = p_id and owner_id = auth.uid() and status = 'review';
  if not found then raise exception 'Order not found'; end if;
  select * into prod from public.products p where p.id = p_product and p.active
    and exists (select 1 from public.business_products bp where bp.business_id = e.business_id and bp.product_id = p.id)
    and (p.owner_id is null or p.owner_id = auth.uid());
  if not found then raise exception 'Choose one of the products in this business'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 10 then raise exception 'Quantity must be 1 to 10'; end if;
  if p_price is null or p_price < prod.min_price then raise exception 'Price must be at least EGP %', prod.min_price; end if;
  c := public.norm_phone(p_phone);
  if c !~ '^1[0125][0-9]{8}$' then raise exception 'Enter a valid Egyptian mobile number'; end if;
  if not exists (select 1 from public.shipping_rates r where r.governorate = p_governorate and r.active) then raise exception 'We don''t deliver to % yet', p_governorate; end if;
  if length(trim(coalesce(p_name, ''))) < 2 or length(trim(coalesce(p_address, ''))) < 5 then raise exception 'Write the customer name and full address'; end if;
  oid := public.create_external_forsa_order(e, p_product, p_qty, p_price, trim(p_name), '0' || c, p_governorate, trim(p_address), p_options);
  update public.external_orders set status = 'created', order_id = oid where id = e.id;
  return oid;
end $$;

create or replace function public.dismiss_external_order(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.external_orders set status = 'dismissed' where id = p_id and owner_id = auth.uid() and status = 'review';
  if not found then raise exception 'Order not found'; end if;
end $$;

-- ---------- Grants ----------
revoke execute on function public.clean_website_style(jsonb) from public, anon, authenticated;
revoke execute on function public.match_governorate(text) from public, anon, authenticated;
revoke execute on function public.create_external_forsa_order(public.external_orders, uuid, integer, integer, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.request_connection(uuid, text) from public, anon;
revoke execute on function public.set_connection_secret(uuid, text) from public, anon;
revoke execute on function public.admin_connections() from public, anon;
revoke execute on function public.admin_decide_connection(uuid, text, text) from public, anon;
revoke execute on function public.resolve_external_order(uuid, uuid, integer, integer, text, text, text, text, text) from public, anon;
revoke execute on function public.dismiss_external_order(uuid) from public, anon;
revoke execute on function public.save_website(uuid, jsonb) from public, anon;
grant execute on function public.request_connection(uuid, text) to authenticated;
grant execute on function public.set_connection_secret(uuid, text) to authenticated;
grant execute on function public.admin_connections() to authenticated;
grant execute on function public.admin_decide_connection(uuid, text, text) to authenticated;
grant execute on function public.resolve_external_order(uuid, uuid, integer, integer, text, text, text, text, text) to authenticated;
grant execute on function public.dismiss_external_order(uuid) to authenticated;
grant execute on function public.save_website(uuid, jsonb) to authenticated;
grant execute on function public.public_store(text) to anon, authenticated;
-- The webhook relay calls this with the public key; the token + Shopify signature protect it.
revoke execute on function public.ingest_shopify_order(uuid, text, text, text) from public;
grant execute on function public.ingest_shopify_order(uuid, text, text, text) to anon, authenticated;
