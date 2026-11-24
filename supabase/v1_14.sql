-- ============================================================
-- Forsa V1.14 database update (app version 1.14). Safe to run more than once.
-- 1) Seller's OWN products ("Add my own product"): the seller adds a product he made himself (photo, name,
--    description, his cost, his selling price). Forsa approves it, the seller sends his pieces to Forsa,
--    Forsa stores them and ships each order. Forsa keeps 10% of the profit; the seller gets the rest of the
--    profit + his cost back. These products are private to the seller and never under the 3-pieces lock.
-- 2) Stock at Forsa: an order of an own product needs enough pieces at Forsa; the pieces are reserved when the
--    order is placed and come back if it is cancelled or returned.
-- 3) Website: every product on a seller's website can have the seller's own name and photo (his brand look);
--    orders still point to the real product.
-- ============================================================

-- ---------- 1) Own products ----------
alter table public.products add column if not exists seller_made boolean not null default false;
alter table public.products add column if not exists review_status text not null default 'approved';
alter table public.products add column if not exists review_reason text not null default '';
do $$ begin
  alter table public.products add constraint products_review_status_check check (review_status in ('pending','approved','rejected'));
exception when duplicate_object then null; end $$;

-- The seller sees his own products in every state (pending / rejected too); others only see active ones.
drop policy if exists "products read" on public.products;
create policy "products read" on public.products for select to authenticated
  using ((active and (owner_id is null or owner_id = auth.uid())) or owner_id = auth.uid() or public.is_admin());

create or replace function public.create_seller_product(p_business uuid, p jsonb) returns public.products
language plpgsql security definer set search_path = public as $$
declare r public.products; nm text; cost integer; price integer; img text; cat text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.businesses where id = p_business and owner_id = auth.uid()) then raise exception 'This business is not yours'; end if;
  if (select count(*) from public.products where owner_id = auth.uid() and seller_made) >= 50 then raise exception 'You can add up to 50 of your own products'; end if;
  nm := left(trim(coalesce(p->>'name', '')), 80);
  img := trim(coalesce(p->>'image_url', ''));
  cat := coalesce(nullif(p->>'category', ''), 'Other');
  begin cost := round((p->>'cost')::numeric); price := round((p->>'price')::numeric); exception when others then raise exception 'Enter your cost and selling price as numbers'; end;
  if length(nm) < 2 then raise exception 'Write the product name'; end if;
  if img !~ '^https://' or length(img) > 500 then raise exception 'Add a photo of the product'; end if;
  if cost is null or cost < 1 then raise exception 'Enter your cost for one piece'; end if;
  if price is null or price < cost then raise exception 'Selling price must be at least your cost'; end if;
  if price > 1000000 then raise exception 'Price is too high'; end if;
  insert into public.products (name_en, name_ar, description_en, description_ar, category, factory_code, region, wholesale_price, min_price, suggested_price,
                               image_url, stock, active, owner_id, seller_made, review_status)
  values (nm, nm, left(trim(coalesce(p->>'description', '')), 600), left(trim(coalesce(p->>'description', '')), 600), cat, 'SELLER', '', cost, cost, price,
          img, 0, false, auth.uid(), true, 'pending')
  returning * into r;
  insert into public.business_products (business_id, product_id) values (p_business, r.id) on conflict do nothing;
  return r;
end $$;

-- Seller edits: name / photo / description / cost go back to Forsa for review; the selling price can change any time.
create or replace function public.update_seller_product(p_id uuid, p jsonb) returns public.products
language plpgsql security definer set search_path = public as $$
declare r public.products; nm text; cost integer; price integer; img text; changed boolean;
begin
  select * into r from public.products where id = p_id and owner_id = auth.uid() and seller_made;
  if not found then raise exception 'Product not found'; end if;
  nm := left(trim(coalesce(p->>'name', r.name_en)), 80);
  img := trim(coalesce(p->>'image_url', r.image_url));
  begin cost := round(coalesce((p->>'cost')::numeric, r.wholesale_price)); price := round(coalesce((p->>'price')::numeric, r.suggested_price));
  exception when others then raise exception 'Enter your cost and selling price as numbers'; end;
  if length(nm) < 2 then raise exception 'Write the product name'; end if;
  if img !~ '^https://' or length(img) > 500 then raise exception 'Add a photo of the product'; end if;
  if cost < 1 then raise exception 'Enter your cost for one piece'; end if;
  if price < cost then raise exception 'Selling price must be at least your cost'; end if;
  changed := nm <> r.name_en or img <> coalesce(r.image_url, '') or cost <> r.wholesale_price
             or left(trim(coalesce(p->>'description', r.description_en)), 600) <> coalesce(r.description_en, '');
  update public.products set name_en = nm, name_ar = nm, image_url = img,
    description_en = left(trim(coalesce(p->>'description', r.description_en)), 600), description_ar = left(trim(coalesce(p->>'description', r.description_en)), 600),
    category = coalesce(nullif(p->>'category', ''), r.category),
    wholesale_price = cost, min_price = cost, suggested_price = price,
    review_status = case when changed then 'pending' else review_status end,
    review_reason = case when changed then '' else review_reason end,
    active = case when changed then false else active end
  where id = r.id returning * into r;
  return r;
end $$;

-- Admin: approve / reject (with reason) and set how many pieces Forsa holds.
create or replace function public.admin_review_product(p_id uuid, p_status text, p_reason text default '') returns public.products
language plpgsql security definer set search_path = public as $$
declare r public.products;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('approved','rejected') then raise exception 'Invalid status'; end if;
  update public.products set review_status = p_status, review_reason = left(trim(coalesce(p_reason, '')), 300), active = (p_status = 'approved')
    where id = p_id and seller_made returning * into r;
  if not found then raise exception 'Product not found'; end if;
  return r;
end $$;

create or replace function public.admin_set_stock(p_id uuid, p_stock integer) returns public.products
language plpgsql security definer set search_path = public as $$
declare r public.products;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_stock is null or p_stock < 0 or p_stock > 100000 then raise exception 'Invalid number of pieces'; end if;
  update public.products set stock = p_stock where id = p_id returning * into r;
  if not found then raise exception 'Product not found'; end if;
  return r;
end $$;

-- ---------- 2) Orders of own products: 10% fee, cost back, stock at Forsa ----------
alter table public.orders add column if not exists seller_stock boolean not null default false;

-- Runs after orders_prepare (triggers run in name order): marks own-product orders and reserves the pieces.
create or replace function public.order_seller_made() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.products;
begin
  new.seller_stock := false;
  select * into p from public.products where id = new.product_id;
  if p.seller_made then
    if p.review_status <> 'approved' then raise exception 'This product is waiting for Forsa approval'; end if;
    new.seller_stock := true;
    new.fee_pct := public.forsa_fee_pct();
    update public.products set stock = stock - new.quantity where id = p.id and stock >= new.quantity;
    if not found then raise exception 'Not enough pieces at Forsa for this order (% left). Send more pieces to Forsa.', p.stock; end if;
  end if;
  return new;
end $$;
drop trigger if exists orders_seller_made on public.orders;
create trigger orders_seller_made before insert on public.orders
  for each row execute function public.order_seller_made();

-- Keeps the flag, and puts the pieces back when an own-product order is cancelled or returned.
create or replace function public.order_seller_stock_keep() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.seller_stock := old.seller_stock;
  if old.seller_stock and new.status in ('cancelled','returned') and old.status not in ('cancelled','returned') then
    update public.products set stock = stock + old.quantity where id = old.product_id;
  elsif old.seller_stock and old.status in ('cancelled','returned') and new.status not in ('cancelled','returned') then
    update public.products set stock = stock - old.quantity where id = old.product_id;
  end if;
  return new;
end $$;
drop trigger if exists orders_seller_stock_keep on public.orders;
create trigger orders_seller_stock_keep before update on public.orders
  for each row execute function public.order_seller_stock_keep();

-- ---------- 3) Website: own name + photo per product ----------
create or replace function public.clean_website_items(p_business uuid, p_owner uuid, p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare it jsonb; clean jsonb := '[]'::jsonb; seen uuid[] := '{}'; pid uuid; pr integer; prod public.products; featured integer := 0; nm text; img text;
begin
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    begin pid := (it->>'product_id')::uuid; exception when others then raise exception 'Invalid product'; end;
    if pid = any(seen) then continue; end if;
    select * into prod from public.products where id = pid and active;
    if not found or (prod.owner_id is not null and prod.owner_id <> p_owner)
       or not exists (select 1 from public.business_products where business_id = p_business and product_id = pid) then
      raise exception 'Add this product to your business first';
    end if;
    begin pr := round((it->>'price')::numeric); exception when others then raise exception 'Invalid price'; end;
    if pr is null or pr < prod.min_price then raise exception 'Price for % must be at least EGP %', prod.name_en, prod.min_price; end if;
    if pr > 1000000 then raise exception 'Price is too high'; end if;
    if coalesce((it->>'featured')::boolean, false) then featured := featured + 1; end if;
    if featured > 3 then raise exception 'You can feature up to 3 products'; end if;
    nm := left(trim(coalesce(it->>'name', '')), 80);
    img := trim(coalesce(it->>'image_url', ''));
    if img <> '' and (img !~ '^https://' or length(img) > 500) then raise exception 'Invalid product photo'; end if;
    clean := clean || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('product_id', pid, 'price', pr, 'featured', coalesce((it->>'featured')::boolean, false),
      'name', nullif(nm, ''), 'image_url', nullif(img, ''))));
    seen := seen || pid;
  end loop;
  if jsonb_array_length(clean) > 60 then raise exception 'Up to 60 products'; end if;
  return clean;
end $$;

create or replace function public.save_website(p_business uuid, p jsonb) returns public.websites
language plpgsql security definer set search_path = public as $$
declare w public.websites; clean jsonb; s text; col text; tpl text;
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
  clean := public.clean_website_items(p_business, auth.uid(), p->'items');
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
        'id', p.id,
        'name_en', coalesce(nullif(x.it->>'name', ''), p.name_en), 'name_ar', coalesce(nullif(x.it->>'name', ''), p.name_ar),
        'description_en', p.description_en, 'description_ar', p.description_ar,
        'image_url', coalesce(nullif(x.it->>'image_url', ''), p.image_url), 'category', p.category,
        'price', greatest((x.it->>'price')::int, p.min_price), 'featured', coalesce((x.it->>'featured')::boolean, false),
        'sold_out', p.seller_made and p.stock < 1
      ) order by x.n)
      from jsonb_array_elements(w.items) with ordinality as x(it, n)
      join public.products p on p.id = (x.it->>'product_id')::uuid and p.active
      where exists (select 1 from public.business_products bp where bp.business_id = w.business_id and bp.product_id = p.id)
    ), '[]'::jsonb),
    'shipping', coalesce((select jsonb_agg(jsonb_build_object('governorate', r.governorate, 'fee', r.fee) order by r.governorate)
                          from public.shipping_rates r where r.active), '[]'::jsonb)
  );
end $$;

-- ---------- Grants ----------
revoke execute on function public.create_seller_product(uuid, jsonb) from public, anon;
revoke execute on function public.update_seller_product(uuid, jsonb) from public, anon;
revoke execute on function public.admin_review_product(uuid, text, text) from public, anon;
revoke execute on function public.admin_set_stock(uuid, integer) from public, anon;
revoke execute on function public.clean_website_items(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.save_website(uuid, jsonb) from public, anon;
grant execute on function public.create_seller_product(uuid, jsonb) to authenticated;
grant execute on function public.update_seller_product(uuid, jsonb) to authenticated;
grant execute on function public.admin_review_product(uuid, text, text) to authenticated;
grant execute on function public.admin_set_stock(uuid, integer) to authenticated;
grant execute on function public.save_website(uuid, jsonb) to authenticated;
grant execute on function public.public_store(text) to anon, authenticated;
