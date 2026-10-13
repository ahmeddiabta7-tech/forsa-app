-- ============================================================
-- Forsa V1 database schema (Supabase / Postgres)
-- Run once in the Supabase SQL editor.
-- ============================================================

-- ---------- Profiles (one row per user) ----------
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text,
  full_name        text not null default '',
  phone            text,
  city             text,
  user_type        text,            -- student, employee, extra_income, other
  university       text,
  role             text not null default 'seller' check (role in ('seller','admin')),
  trial_started_at timestamptz not null default now(),
  goal_waived      boolean not null default false,   -- paid EGP 100 to skip the 3-order goal
  paid_until       timestamptz,                       -- end of the paid subscription period
  created_at       timestamptz not null default now()
);

-- ---------- Products ----------
create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  name_en         text not null,
  name_ar         text not null,
  description_en  text default '',
  description_ar  text default '',
  category        text not null default 'Other',
  factory_code    text not null,            -- e.g. FT-104 (real factory name is never stored here)
  region          text default '',
  quality_score   numeric(2,1) default 4.5,
  wholesale_price integer not null check (wholesale_price > 0),
  min_price       integer not null,
  suggested_price integer not null,
  ship_days       integer not null default 3,
  image_url       text,
  stock           integer not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  check (min_price >= wholesale_price),
  check (suggested_price >= min_price)
);

-- ---------- Orders ----------
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  order_no        bigint generated always as identity,
  seller_id       uuid not null references public.profiles(id) on delete cascade,
  product_id      uuid not null references public.products(id),
  quantity        integer not null default 1 check (quantity between 1 and 20),
  unit_price      integer not null,        -- seller's selling price per item
  wholesale_price integer not null,        -- copied from the product when the order is created
  customer_name   text not null,
  customer_phone  text not null,
  governorate     text not null,
  address         text not null,
  notes           text default '',
  status          text not null default 'pending'
                  check (status in ('pending','confirmed','shipped','delivered','returned','cancelled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists orders_seller_idx on public.orders(seller_id, created_at desc);

-- ---------- Payouts (weekly payments to sellers) ----------
create table if not exists public.payouts (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references public.profiles(id) on delete cascade,
  amount      integer not null check (amount > 0),
  method      text not null default 'instapay',
  reference   text default '',
  note        text default '',
  paid_at     timestamptz not null default now()
);

-- ---------- Subscription payments ----------
create table if not exists public.subscription_payments (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references public.profiles(id) on delete cascade,
  amount      integer not null default 100,
  months      integer not null default 1 check (months between 1 and 12),
  method      text not null check (method in ('instapay','vodafone_cash')),
  reference   text not null,
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz
);

-- ---------- Submitted ideas ----------
create table if not exists public.ideas (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  title           text not null,
  problem         text not null,
  sector          text not null,
  stage           text not null check (stage in ('idea','prototype','selling')),
  funding_needed  integer default 0,
  status          text not null default 'new' check (status in ('new','reviewing','matched','declined')),
  created_at      timestamptz not null default now()
);

-- ============================================================
-- Helper functions
-- ============================================================
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- A seller may create orders during the free first month, or while their subscription is paid.
create or replace function public.can_sell(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid
      and (now() < p.trial_started_at + interval '30 days'
           or (p.paid_until is not null and now() < p.paid_until))
  );
$$;

-- Create a profile automatically when someone signs up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, phone, city, user_type, university)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'city',
    new.raw_user_meta_data->>'user_type',
    new.raw_user_meta_data->>'university'
  );
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Sellers can edit their name/phone/city but never their role or plan fields.
create or replace function public.protect_profile_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.role := old.role;
    new.trial_started_at := old.trial_started_at;
    new.goal_waived := old.goal_waived;
    new.paid_until := old.paid_until;
    new.email := old.email;
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- On new orders: copy the wholesale price, enforce the minimum price, force status 'pending'.
create or replace function public.prepare_order() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.products;
begin
  select * into p from public.products where id = new.product_id and active;
  if not found then raise exception 'This product is not available'; end if;
  if new.unit_price < p.min_price then
    raise exception 'Selling price must be at least EGP %', p.min_price;
  end if;
  new.wholesale_price := p.wholesale_price;
  if not public.is_admin() then new.status := 'pending'; end if;
  return new;
end $$;
drop trigger if exists orders_prepare on public.orders;
create trigger orders_prepare before insert on public.orders
  for each row execute function public.prepare_order();

-- Sellers may only cancel their own pending orders; only admins change other fields.
create or replace function public.guard_order_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if public.is_admin() then return new; end if;
  if old.status = 'pending' and new.status = 'cancelled' then
    new.unit_price := old.unit_price; new.quantity := old.quantity;
    new.wholesale_price := old.wholesale_price; new.product_id := old.product_id;
    new.seller_id := old.seller_id;
    return new;
  end if;
  raise exception 'Only pending orders can be cancelled';
end $$;
drop trigger if exists orders_guard on public.orders;
create trigger orders_guard before update on public.orders
  for each row execute function public.guard_order_update();

-- When the admin approves a subscription payment, extend the seller's paid period.
create or replace function public.apply_subscription() returns trigger
language plpgsql security definer set search_path = public as $$
declare start_from timestamptz;
begin
  if new.status = 'approved' and old.status <> 'approved' then
    select greatest(coalesce(paid_until, now()), now()) into start_from
      from public.profiles where id = new.seller_id;
    update public.profiles
       set paid_until = start_from + (new.months * interval '30 days'),
           goal_waived = true
     where id = new.seller_id;
    new.reviewed_at := now();
  elsif new.status = 'rejected' and old.status <> 'rejected' then
    new.reviewed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists subs_apply on public.subscription_payments;
create trigger subs_apply before update on public.subscription_payments
  for each row execute function public.apply_subscription();

-- Sellers submit payments as 'pending' only.
create or replace function public.force_pending() returns trigger
language plpgsql as $$
begin
  if not public.is_admin() then new.status := 'pending'; new.reviewed_at := null; end if;
  return new;
end $$;
drop trigger if exists subs_pending on public.subscription_payments;
create trigger subs_pending before insert on public.subscription_payments
  for each row execute function public.force_pending();
drop trigger if exists ideas_pending on public.ideas;
create or replace function public.force_new_idea() returns trigger
language plpgsql as $$
begin
  if not public.is_admin() then new.status := 'new'; end if;
  return new;
end $$;
create trigger ideas_pending before insert on public.ideas
  for each row execute function public.force_new_idea();

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.payouts enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.ideas enable row level security;

-- profiles
drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update using (id = auth.uid() or public.is_admin());

-- products
drop policy if exists "products read" on public.products;
create policy "products read" on public.products for select to authenticated using (active or public.is_admin());
drop policy if exists "products admin write" on public.products;
create policy "products admin write" on public.products for all using (public.is_admin()) with check (public.is_admin());

-- orders
drop policy if exists "orders read" on public.orders;
create policy "orders read" on public.orders for select using (seller_id = auth.uid() or public.is_admin());
drop policy if exists "orders create" on public.orders;
create policy "orders create" on public.orders for insert
  with check ((seller_id = auth.uid() and public.can_sell(auth.uid())) or public.is_admin());
drop policy if exists "orders update" on public.orders;
create policy "orders update" on public.orders for update using (seller_id = auth.uid() or public.is_admin());

-- payouts
drop policy if exists "payouts read" on public.payouts;
create policy "payouts read" on public.payouts for select using (seller_id = auth.uid() or public.is_admin());
drop policy if exists "payouts admin write" on public.payouts;
create policy "payouts admin write" on public.payouts for all using (public.is_admin()) with check (public.is_admin());

-- subscription payments
drop policy if exists "subs read" on public.subscription_payments;
create policy "subs read" on public.subscription_payments for select using (seller_id = auth.uid() or public.is_admin());
drop policy if exists "subs create" on public.subscription_payments;
create policy "subs create" on public.subscription_payments for insert with check (seller_id = auth.uid() or public.is_admin());
drop policy if exists "subs admin update" on public.subscription_payments;
create policy "subs admin update" on public.subscription_payments for update using (public.is_admin());

-- ideas
drop policy if exists "ideas read" on public.ideas;
create policy "ideas read" on public.ideas for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "ideas create" on public.ideas;
create policy "ideas create" on public.ideas for insert with check (user_id = auth.uid());
drop policy if exists "ideas admin update" on public.ideas;
create policy "ideas admin update" on public.ideas for update using (public.is_admin());

-- ============================================================
-- Storage bucket for product photos (public read, admin upload)
-- ============================================================
insert into storage.buckets (id, name, public) values ('product-images', 'product-images', true)
  on conflict (id) do nothing;
drop policy if exists "product images admin upload" on storage.objects;
create policy "product images admin upload" on storage.objects for insert
  with check (bucket_id = 'product-images' and public.is_admin());
drop policy if exists "product images admin update" on storage.objects;
create policy "product images admin update" on storage.objects for update
  using (bucket_id = 'product-images' and public.is_admin());

-- ============================================================
-- Table privileges (new Supabase projects do not grant these automatically).
-- Row Level Security above still decides which rows each user can see.
-- ============================================================
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;

-- ============================================================
-- V1.1 additions (same as supabase/v1_1.sql)
-- ============================================================

-- ---------- Ideas: extra guided fields ----------
alter table public.ideas add column if not exists customer      text default '';
alter table public.ideas add column if not exists revenue_model text default '';
alter table public.ideas add column if not exists needs         text default '';

-- ---------- Service requests (marketing agencies, media buying, ...) ----------
create table if not exists public.service_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  service     text not null check (service ~ '^[a-z_]{2,40}$'),
  details     text not null check (length(details) between 1 and 2000),
  budget      text default '',
  status      text not null default 'new' check (status in ('new','contacted','done')),
  created_at  timestamptz not null default now()
);
create index if not exists service_requests_user_idx on public.service_requests(user_id, created_at desc);

create or replace function public.force_new_request() returns trigger
language plpgsql as $$
begin
  if not public.is_admin() then new.status := 'new'; end if;
  return new;
end $$;
drop trigger if exists service_requests_new on public.service_requests;
create trigger service_requests_new before insert on public.service_requests
  for each row execute function public.force_new_request();

alter table public.service_requests enable row level security;
drop policy if exists "requests read" on public.service_requests;
create policy "requests read" on public.service_requests for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "requests create" on public.service_requests;
create policy "requests create" on public.service_requests for insert with check (user_id = auth.uid());
drop policy if exists "requests admin update" on public.service_requests;
create policy "requests admin update" on public.service_requests for update using (public.is_admin());

grant select, insert, update, delete on public.service_requests to authenticated;
grant execute on function public.force_new_request() to authenticated;

-- ============================================================
-- V1.2 additions (same as supabase/v1_2.sql)
-- ---------- 1) When an order was delivered ----------
alter table public.orders add column if not exists delivered_at timestamptz;
alter table public.orders disable trigger orders_guard;   -- one-time backfill, rule switched back on right after
update public.orders set delivered_at = updated_at where status = 'delivered' and delivered_at is null;
alter table public.orders enable trigger orders_guard;
create index if not exists orders_delivered_idx on public.orders(seller_id, delivered_at) where status = 'delivered';

create or replace function public.prepare_order() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.products;
begin
  select * into p from public.products where id = new.product_id and active;
  if not found then raise exception 'This product is not available'; end if;
  if new.unit_price < p.min_price then
    raise exception 'Selling price must be at least EGP %', p.min_price;
  end if;
  new.wholesale_price := p.wholesale_price;
  if not public.is_admin() then new.status := 'pending'; end if;
  new.delivered_at := case when new.status = 'delivered' then now() else null end;
  return new;
end $$;

create or replace function public.guard_order_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'delivered' and old.status is distinct from 'delivered' then new.delivered_at := now(); end if;
  if public.is_admin() then return new; end if;
  if old.status = 'pending' and new.status = 'cancelled' then
    new.unit_price := old.unit_price; new.quantity := old.quantity;
    new.wholesale_price := old.wholesale_price; new.product_id := old.product_id;
    new.seller_id := old.seller_id; new.delivered_at := old.delivered_at;
    return new;
  end if;
  raise exception 'Only pending orders can be cancelled';
end $$;

-- Who can create orders right now (checked by the database on every new order).
create or replace function public.can_sell(uid uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  p public.profiles;
  k integer;
  month_start timestamptz;
  n integer;
begin
  select * into p from public.profiles where id = uid;
  if not found then return false; end if;
  if p.paid_until is not null and now() < p.paid_until then return true; end if;
  k := floor(extract(epoch from (now() - p.trial_started_at)) / (30 * 86400));
  if k <= 0 then return true; end if;                       -- first month is open
  month_start := p.trial_started_at + k * interval '30 days';
  select count(*) into n from public.orders
   where seller_id = uid and status = 'delivered'
     and delivered_at >= month_start - interval '30 days' and delivered_at < month_start;
  return n >= 3;                                            -- last month earned this month free
end $$;

-- ---------- 2) Seller costs ----------
create table if not exists public.seller_expenses (
  id               uuid primary key default gen_random_uuid(),
  seller_id        uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  amount           integer not null check (amount > 0 and amount <= 10000000),
  category         text not null default 'other' check (category in ('ads','marketing','packaging','delivery','other')),
  note             text default '' check (length(note) <= 200),
  spent_on         date not null default current_date,
  request_id       uuid unique references public.service_requests(id) on delete set null,
  created_by_admin boolean not null default false,
  created_at       timestamptz not null default now()
);
create index if not exists seller_expenses_idx on public.seller_expenses(seller_id, spent_on desc);

alter table public.seller_expenses enable row level security;
drop policy if exists "expenses read" on public.seller_expenses;
create policy "expenses read" on public.seller_expenses for select using (seller_id = auth.uid() or public.is_admin());
drop policy if exists "expenses create" on public.seller_expenses;
create policy "expenses create" on public.seller_expenses for insert
  with check ((seller_id = auth.uid() and request_id is null and not created_by_admin) or public.is_admin());
drop policy if exists "expenses update" on public.seller_expenses;
create policy "expenses update" on public.seller_expenses for update
  using ((seller_id = auth.uid() and not created_by_admin) or public.is_admin())
  with check ((seller_id = auth.uid() and request_id is null and not created_by_admin) or public.is_admin());
drop policy if exists "expenses delete" on public.seller_expenses;
create policy "expenses delete" on public.seller_expenses for delete
  using ((seller_id = auth.uid() and not created_by_admin) or public.is_admin());

grant select, insert, update, delete on public.seller_expenses to authenticated;
grant execute on function public.can_sell(uuid) to authenticated;

-- ============================================================
-- V1.3 additions (same as supabase/v1_3.sql)
-- ---------- Roles ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('seller','admin','agency'));
alter table public.profiles add column if not exists agency_service text;

create or replace function public.is_agency() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'agency');
$$;

create or replace function public.protect_profile_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.role := old.role;
    new.trial_started_at := old.trial_started_at;
    new.goal_waived := old.goal_waived;
    new.paid_until := old.paid_until;
    new.email := old.email;
    new.agency_service := old.agency_service;
  end if;
  return new;
end $$;

-- ---------- 1) Businesses ----------
create table if not exists public.businesses (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name        text not null check (length(trim(name)) between 2 and 60),
  category    text not null default '' check (length(category) <= 40),
  page_url    text not null default '' check (length(page_url) <= 300),
  description text not null default '' check (length(description) <= 500),
  city        text not null default '' check (length(city) <= 40),
  logo_url    text not null default '' check (length(logo_url) <= 500),
  created_at  timestamptz not null default now()
);
create index if not exists businesses_owner_idx on public.businesses(owner_id, created_at);

create or replace function public.guard_business() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.owner_id := auth.uid();
    if (select count(*) from public.businesses where owner_id = auth.uid()) >= 5 then
      raise exception 'You can have up to 5 businesses';
    end if;
  else
    new.owner_id := old.owner_id; new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists businesses_guard on public.businesses;
create trigger businesses_guard before insert or update on public.businesses
  for each row execute function public.guard_business();

create table if not exists public.business_products (
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (business_id, product_id)
);

create or replace function public.owns_business(bid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.businesses where id = bid and owner_id = auth.uid());
$$;

-- Orders belong to a business
alter table public.orders add column if not exists business_id uuid references public.businesses(id) on delete restrict;
create index if not exists orders_business_idx on public.orders(business_id);

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

create or replace function public.guard_order_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'delivered' and old.status is distinct from 'delivered' then new.delivered_at := now(); end if;
  if public.is_admin() then return new; end if;
  if old.status = 'pending' and new.status = 'cancelled' then
    new.unit_price := old.unit_price; new.quantity := old.quantity;
    new.wholesale_price := old.wholesale_price; new.product_id := old.product_id;
    new.seller_id := old.seller_id; new.delivered_at := old.delivered_at; new.business_id := old.business_id;
    return new;
  end if;
  raise exception 'Only pending orders can be cancelled';
end $$;

-- Costs can belong to a business
alter table public.seller_expenses add column if not exists business_id uuid references public.businesses(id) on delete set null;

-- ---------- 2) Agencies on service requests ----------
alter table public.service_requests add column if not exists business_id uuid references public.businesses(id) on delete set null;
alter table public.service_requests add column if not exists agency_id uuid references public.profiles(id) on delete set null;
create index if not exists service_requests_agency_idx on public.service_requests(agency_id, created_at desc);

create or replace function public.force_new_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then new.status := 'new'; new.agency_id := null; end if;
  return new;
end $$;

-- Agencies may only change the status of requests assigned to them.
create or replace function public.guard_request_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return new; end if;
  new.user_id := old.user_id; new.service := old.service; new.details := old.details; new.budget := old.budget;
  new.business_id := old.business_id; new.agency_id := old.agency_id; new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists service_requests_guard on public.service_requests;
create trigger service_requests_guard before update on public.service_requests
  for each row execute function public.guard_request_update();

-- ---------- 3) Chat ----------
create table if not exists public.request_messages (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete cascade,
  sender_id  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body       text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists request_messages_idx on public.request_messages(request_id, created_at);

create table if not exists public.chat_reads (
  request_id uuid not null references public.service_requests(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (request_id, user_id)
);

create or replace function public.can_chat(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.service_requests r where r.id = rid and (r.user_id = auth.uid() or r.agency_id = auth.uid()));
$$;

-- Hide contact details so deals stay inside Forsa (admin messages are not changed).
create or replace function public.prepare_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.sender_id := auth.uid();
  new.created_at := now();
  if not public.is_admin() then
    new.body := regexp_replace(new.body, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[hidden]', 'g');
    new.body := regexp_replace(new.body, '(https?://)?(www\.)?(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|whatsapp\.com|t\.me|telegram\.me)\S*', '[hidden]', 'gi');
    new.body := regexp_replace(new.body, '\+?[0-9٠-٩][0-9٠-٩ .-]{8,}[0-9٠-٩]', '[hidden]', 'g');
  end if;
  return new;
end $$;
drop trigger if exists request_messages_prepare on public.request_messages;
create trigger request_messages_prepare before insert on public.request_messages
  for each row execute function public.prepare_message();

-- Unread messages per request for the current user.
create or replace function public.unread_counts() returns table (request_id uuid, unread bigint)
language sql stable security definer set search_path = public as $$
  select m.request_id, count(*)
    from public.request_messages m
    join public.service_requests r on r.id = m.request_id
    left join public.chat_reads cr on cr.request_id = m.request_id and cr.user_id = auth.uid()
   where m.sender_id <> auth.uid()
     and (r.user_id = auth.uid() or r.agency_id = auth.uid() or public.is_admin())
     and m.created_at > coalesce(cr.read_at, '-infinity'::timestamptz)
   group by m.request_id;
$$;

-- ---------- Row Level Security ----------
alter table public.businesses enable row level security;
drop policy if exists "business read" on public.businesses;
create policy "business read" on public.businesses for select using (
  owner_id = auth.uid() or public.is_admin()
  or exists (select 1 from public.service_requests r where r.business_id = businesses.id and r.agency_id = auth.uid()));
drop policy if exists "business create" on public.businesses;
create policy "business create" on public.businesses for insert with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists "business update" on public.businesses;
create policy "business update" on public.businesses for update using (owner_id = auth.uid() or public.is_admin());
drop policy if exists "business delete" on public.businesses;
create policy "business delete" on public.businesses for delete using (owner_id = auth.uid() or public.is_admin());

alter table public.business_products enable row level security;
drop policy if exists "bp read" on public.business_products;
create policy "bp read" on public.business_products for select using (public.owns_business(business_id) or public.is_admin());
drop policy if exists "bp add" on public.business_products;
create policy "bp add" on public.business_products for insert with check (public.owns_business(business_id) or public.is_admin());
drop policy if exists "bp remove" on public.business_products;
create policy "bp remove" on public.business_products for delete using (public.owns_business(business_id) or public.is_admin());

drop policy if exists "requests read" on public.service_requests;
create policy "requests read" on public.service_requests for select using (user_id = auth.uid() or agency_id = auth.uid() or public.is_admin());
drop policy if exists "requests create" on public.service_requests;
create policy "requests create" on public.service_requests for insert
  with check (user_id = auth.uid() and (business_id is null or public.owns_business(business_id)));
drop policy if exists "requests admin update" on public.service_requests;
drop policy if exists "requests update" on public.service_requests;
create policy "requests update" on public.service_requests for update using (agency_id = auth.uid() or public.is_admin());

drop policy if exists "expenses create" on public.seller_expenses;
create policy "expenses create" on public.seller_expenses for insert
  with check ((seller_id = auth.uid() and request_id is null and not created_by_admin and (business_id is null or public.owns_business(business_id))) or public.is_admin());
drop policy if exists "expenses update" on public.seller_expenses;
create policy "expenses update" on public.seller_expenses for update
  using ((seller_id = auth.uid() and not created_by_admin) or public.is_admin())
  with check ((seller_id = auth.uid() and request_id is null and not created_by_admin and (business_id is null or public.owns_business(business_id))) or public.is_admin());

alter table public.request_messages enable row level security;
drop policy if exists "messages read" on public.request_messages;
create policy "messages read" on public.request_messages for select using (public.can_chat(request_id));
drop policy if exists "messages send" on public.request_messages;
create policy "messages send" on public.request_messages for insert with check (public.can_chat(request_id));

alter table public.chat_reads enable row level security;
drop policy if exists "reads own" on public.chat_reads;
create policy "reads own" on public.chat_reads for all using (user_id = auth.uid()) with check (user_id = auth.uid() and public.can_chat(request_id));

-- ---------- Business logos (each seller uploads into their own folder) ----------
insert into storage.buckets (id, name, public) values ('business-logos', 'business-logos', true) on conflict (id) do nothing;
drop policy if exists "logos own upload" on storage.objects;
create policy "logos own upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'business-logos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "logos own update" on storage.objects;
create policy "logos own update" on storage.objects for update to authenticated
  using (bucket_id = 'business-logos' and (storage.foldername(name))[1] = auth.uid()::text);

grant select, insert, update, delete on public.businesses, public.business_products, public.request_messages, public.chat_reads to authenticated;
grant execute on all functions in schema public to authenticated;

-- ============================================================
-- V1.4 additions (same as supabase/v1_4.sql)

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

-- ============================================================
-- V1.5 additions (same as supabase/v1_5.sql)

-- ---------- 1) Unlock window + on-hold orders ----------
alter table public.profiles add column if not exists unlocked_until timestamptz;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('on_hold','pending','confirmed','shipped','delivered','returned','cancelled'));

-- Set only inside release_held(), so the protective triggers let the release through.
create or replace function public.releasing() returns boolean
language sql stable as $$ select coalesce(current_setting('forsa.release', true), '') = '1'; $$;

create or replace function public.release_held(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('forsa.release', '1', true);
  update public.orders set status = 'pending' where seller_id = uid and status = 'on_hold';
  update public.profiles set unlocked_until = now() + interval '30 days' where id = uid;
  perform set_config('forsa.release', '', true);
end $$;
revoke execute on function public.release_held(uuid) from public, anon, authenticated;

create or replace function public.protect_profile_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and not public.releasing() then
    new.role := old.role;
    new.trial_started_at := old.trial_started_at;
    new.goal_waived := old.goal_waived;
    new.paid_until := old.paid_until;
    new.email := old.email;
    new.agency_service := old.agency_service;
    new.unlocked_until := old.unlocked_until;
  end if;
  return new;
end $$;

create or replace function public.prepare_order() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.products; u timestamptz;
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
    select unlocked_until into u from public.profiles where id = new.seller_id;
    new.status := case when p.owner_id is null and (u is null or u <= now()) then 'on_hold' else 'pending' end;
  end if;
  new.wholesale_price := p.wholesale_price;
  new.delivered_at := case when new.status = 'delivered' then now() else null end;
  return new;
end $$;

-- After a held order is saved: 3 on hold → release all and unlock 30 days.
create or replace function public.check_hold() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'on_hold'
     and (select count(*) from public.orders where seller_id = new.seller_id and status = 'on_hold') >= 3 then
    perform public.release_held(new.seller_id);
  end if;
  return null;
end $$;
drop trigger if exists orders_check_hold on public.orders;
create trigger orders_check_hold after insert on public.orders
  for each row execute function public.check_hold();

create or replace function public.guard_order_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'delivered' and old.status is distinct from 'delivered' then new.delivered_at := now(); end if;
  if public.is_admin() or public.releasing() then return new; end if;
  if old.status in ('on_hold','pending') and new.status = 'cancelled' then
    new.unit_price := old.unit_price; new.quantity := old.quantity;
    new.wholesale_price := old.wholesale_price; new.product_id := old.product_id;
    new.seller_id := old.seller_id; new.delivered_at := old.delivered_at; new.business_id := old.business_id;
    return new;
  end if;
  raise exception 'Only pending orders can be cancelled';
end $$;

-- Orders are never blocked any more (held instead).
drop policy if exists "orders create" on public.orders;
create policy "orders create" on public.orders for insert with check (seller_id = auth.uid() or public.is_admin());

-- Approved EGP 100 payment: unlock 30 days per month paid and release held orders.
create or replace function public.apply_subscription() returns trigger
language plpgsql security definer set search_path = public as $$
declare start_from timestamptz;
begin
  if new.status = 'approved' and old.status <> 'approved' then
    select greatest(coalesce(unlocked_until, now()), now()) into start_from from public.profiles where id = new.seller_id;
    update public.profiles
       set unlocked_until = start_from + (new.months * interval '30 days'),
           paid_until = start_from + (new.months * interval '30 days'),
           goal_waived = true
     where id = new.seller_id;
    update public.orders set status = 'pending' where seller_id = new.seller_id and status = 'on_hold';
    new.reviewed_at := now();
  elsif new.status = 'rejected' and old.status <> 'rejected' then
    new.reviewed_at := now();
  end if;
  return new;
end $$;

-- ---------- 2) Where the custom batch goes ----------
alter table public.custom_requests add column if not exists fulfillment text not null default 'forsa';
alter table public.custom_requests drop constraint if exists custom_requests_fulfillment_check;
alter table public.custom_requests add constraint custom_requests_fulfillment_check check (fulfillment in ('forsa','self'));
alter table public.custom_requests add column if not exists ship_governorate text not null default '';
alter table public.custom_requests add column if not exists ship_address text not null default '';
alter table public.custom_requests drop constraint if exists custom_requests_ship_check;
alter table public.custom_requests add constraint custom_requests_ship_check
  check (length(ship_governorate) <= 40 and length(ship_address) <= 300);

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
    if new.fulfillment = 'self' and (trim(new.ship_governorate) = '' or trim(new.ship_address) = '') then
      raise exception 'Add the delivery address';
    end if;
    new.seller_id := auth.uid(); new.status := 'requested';
    new.quote_unit_price := null; new.quote_total := null; new.deposit_amount := null; new.quote_note := '';
    new.deposit_ref := ''; new.balance_ref := ''; new.deposit_confirmed := false; new.balance_confirmed := false;
    new.product_id := null; new.created_at := now();
    return new;
  end if;
  if new.status <> old.status and not (
       (old.status = 'quoted' and new.status = 'accepted')
    or (old.status in ('requested','quoted') and new.status = 'cancelled')) then
    raise exception 'This step is done by the Forsa team';
  end if;
  if not (old.status = 'accepted' and not old.deposit_confirmed) then new.deposit_ref := old.deposit_ref; end if;
  if not (old.status = 'final_payment' and not old.balance_confirmed) then new.balance_ref := old.balance_ref; end if;
  if old.status in ('live','cancelled') or old.balance_confirmed then
    new.fulfillment := old.fulfillment; new.ship_governorate := old.ship_governorate; new.ship_address := old.ship_address;
  elsif new.fulfillment = 'self' and (trim(new.ship_governorate) = '' or trim(new.ship_address) = '') then
    raise exception 'Add the delivery address';
  end if;
  new.seller_id := old.seller_id; new.business_id := old.business_id; new.manufacturer_id := old.manufacturer_id;
  new.thread_id := old.thread_id; new.product_type := old.product_type; new.details := old.details; new.quantity := old.quantity;
  new.quote_unit_price := old.quote_unit_price; new.quote_total := old.quote_total; new.deposit_amount := old.deposit_amount;
  new.quote_note := old.quote_note; new.deposit_confirmed := old.deposit_confirmed; new.balance_confirmed := old.balance_confirmed;
  new.product_id := old.product_id; new.created_at := old.created_at;
  return new;
end $$;

grant execute on function public.releasing() to authenticated;
grant execute on function public.check_hold() to authenticated;

-- ============================================================
-- V1.6 additions (same as supabase/v1_6.sql)
create or replace function public.check_hold() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'on_hold'
     and (select coalesce(sum(quantity), 0) from public.orders where seller_id = new.seller_id and status = 'on_hold') >= 3 then
    perform public.release_held(new.seller_id);
  end if;
  return null;
end $$;

-- ============================================================
-- V1.7 additions (same as supabase/v1_7.sql)
-- Forsa V1.7 database update. Safe to run more than once.
-- 1) New 3-pieces rule: hold the PROFIT, not the orders.
--    Every order goes to Forsa right away ('pending'). While a seller is locked, the profit of
--    ready-product orders delivered in that time stays LOCKED. When 3 pieces of such orders are
--    delivered (orders to the seller's own phone number don't count), all locked profit is released
--    and the seller is UNLOCKED for 30 days (profit of orders delivered in that time is released
--    right away). After 30 days: locked again, the count starts from 0. Locked profit never expires.
--    Own custom products (Make your own) are never locked.
-- 2) The EGP 100 option is removed (sellers can no longer submit payments; history is kept).
-- 3) R6: Forsa fee = 10% of the seller's profit on ready-product orders (stored on each order).
-- 4) R4: payout details on the seller's profile.
-- 5) R5: market price on products; empty minimum price = 90% of the market price.
-- 6) R7: Forsa % per Make-your-own deal (admin-only table).
-- 7) The seller's phone number can only be changed by the Forsa team (keeps the own-order check honest).
-- ============================================================

-- ---------- Helpers ----------
create or replace function public.forsa_fee_pct() returns numeric
language sql immutable as $$ select 10::numeric $$;

-- Last 10 digits of a phone number (Arabic digits allowed): 01012345678, +201012345678, ٠١٠١٢٣٤٥٦٧٨ → 1012345678
create or replace function public.norm_phone(p text) returns text
language sql immutable as $$
  select right(regexp_replace(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g'), 10);
$$;

-- ---------- Profiles: payout details ----------
alter table public.profiles add column if not exists payout_method text;
alter table public.profiles add column if not exists payout_holder text not null default '';
alter table public.profiles add column if not exists payout_bank text not null default '';
alter table public.profiles add column if not exists payout_account text not null default '';
alter table public.profiles drop constraint if exists profiles_payout_check;
alter table public.profiles add constraint profiles_payout_check check (
  (payout_method is null or payout_method in ('bank','instapay','vodafone_cash'))
  and length(payout_holder) <= 100 and length(payout_bank) <= 100 and length(payout_account) <= 60);

create or replace function public.protect_profile_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and not public.releasing() then
    new.role := old.role;
    new.trial_started_at := old.trial_started_at;
    new.goal_waived := old.goal_waived;
    new.paid_until := old.paid_until;
    new.email := old.email;
    new.agency_service := old.agency_service;
    new.unlocked_until := old.unlocked_until;
    if coalesce(old.phone, '') <> '' then new.phone := old.phone; end if;
  end if;
  return new;
end $$;

-- ---------- Products: market price ----------
alter table public.products add column if not exists market_price integer;
alter table public.products drop constraint if exists products_market_price_check;
alter table public.products add constraint products_market_price_check check (market_price is null or market_price > 0);

create or replace function public.product_prices() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.min_price is null and new.market_price is not null then new.min_price := ceil(new.market_price * 0.9); end if;
  if new.min_price is null then raise exception 'Enter a minimum price or a market price'; end if;
  if new.suggested_price is null then new.suggested_price := greatest(coalesce(new.market_price, new.min_price), new.min_price); end if;
  if new.min_price < new.wholesale_price then
    raise exception 'Minimum price (EGP %) is below the wholesale price (EGP %)', new.min_price, new.wholesale_price;
  end if;
  return new;
end $$;
drop trigger if exists products_prices on public.products;
create trigger products_prices before insert or update on public.products
  for each row execute function public.product_prices();

-- ---------- Orders: fee, own order, locked profit ----------
alter table public.orders add column if not exists fee_pct numeric(5,2) not null default 0;
alter table public.orders add column if not exists own_order boolean not null default false;
alter table public.orders add column if not exists profit_locked boolean not null default false;
alter table public.orders add column if not exists profit_released_at timestamptz;

create or replace function public.prepare_order() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.products; s public.profiles; c text;
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
  select * into s from public.profiles where id = new.seller_id;
  c := public.norm_phone(new.customer_phone);
  new.own_order := length(c) = 10 and (c = public.norm_phone(s.phone)
                   or (s.payout_method in ('vodafone_cash','instapay') and c = public.norm_phone(s.payout_account)));
  new.fee_pct := case when p.owner_id is null then public.forsa_fee_pct() else 0 end;
  new.profit_locked := false;
  new.profit_released_at := null;
  new.wholesale_price := p.wholesale_price;
  new.delivered_at := case when new.status = 'delivered' then now() else null end;
  return new;
end $$;

-- Releases all locked profit of a seller and unlocks 30 days. Internal only.
create or replace function public.release_profit(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('forsa.release', '1', true);
  update public.orders set profit_locked = false, profit_released_at = now() where seller_id = uid and profit_locked;
  update public.profiles set unlocked_until = now() + interval '30 days' where id = uid;
  perform set_config('forsa.release', '', true);
end $$;
revoke execute on function public.release_profit(uuid) from public, anon, authenticated;

create or replace function public.guard_order_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare u timestamptz; owner uuid;
begin
  new.updated_at := now();
  if public.releasing() then return new; end if;
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    new.delivered_at := now();
    select unlocked_until into u from public.profiles where id = new.seller_id;
    select owner_id into owner from public.products where id = new.product_id;
    new.profit_locked := owner is null and (u is null or u <= now());
    new.profit_released_at := case when new.profit_locked then null else now() end;
  end if;
  if public.is_admin() then return new; end if;
  if old.status = 'pending' and new.status = 'cancelled' then
    new.unit_price := old.unit_price; new.quantity := old.quantity;
    new.wholesale_price := old.wholesale_price; new.product_id := old.product_id;
    new.seller_id := old.seller_id; new.delivered_at := old.delivered_at; new.business_id := old.business_id;
    new.fee_pct := old.fee_pct; new.own_order := old.own_order;
    new.profit_locked := old.profit_locked; new.profit_released_at := old.profit_released_at;
    new.customer_phone := old.customer_phone;
    return new;
  end if;
  raise exception 'Only pending orders can be cancelled';
end $$;

-- After a delivery: 3 counted pieces delivered while locked → release everything and unlock 30 days.
create or replace function public.check_unlock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' and new.profit_locked
     and (select coalesce(sum(quantity), 0) from public.orders
           where seller_id = new.seller_id and status = 'delivered' and profit_locked and not own_order) >= 3 then
    perform public.release_profit(new.seller_id);
  end if;
  return null;
end $$;
drop trigger if exists orders_check_unlock on public.orders;
create trigger orders_check_unlock after update on public.orders
  for each row execute function public.check_unlock();

-- The old "on hold" orders rule is gone.
drop trigger if exists orders_check_hold on public.orders;
drop function if exists public.check_hold();
drop function if exists public.release_held(uuid);
do $$
begin
  perform set_config('forsa.release', '1', true);
  update public.orders set status = 'pending' where status = 'on_hold';
  perform set_config('forsa.release', '', true);
end $$;
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending','confirmed','shipped','delivered','returned','cancelled'));

-- ---------- EGP 100 option removed ----------
drop policy if exists "subs create" on public.subscription_payments;
create or replace function public.apply_subscription() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status <> old.status then new.reviewed_at := now(); end if;
  return new;
end $$;

-- ---------- R7: Forsa % per Make-your-own deal (admin only) ----------
create table if not exists public.custom_request_costs (
  request_id         uuid primary key references public.custom_requests(id) on delete cascade,
  factory_unit_price integer not null check (factory_unit_price >= 0),
  forsa_pct          numeric(5,2) not null check (forsa_pct >= 0 and forsa_pct <= 500),
  updated_at         timestamptz not null default now()
);
alter table public.custom_request_costs enable row level security;
drop policy if exists "deal costs admin" on public.custom_request_costs;
create policy "deal costs admin" on public.custom_request_costs for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.custom_request_costs to authenticated;

grant execute on function public.forsa_fee_pct() to authenticated;
grant execute on function public.norm_phone(text) to authenticated;
