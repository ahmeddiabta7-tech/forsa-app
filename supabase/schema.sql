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

-- ============================================================
-- V1.8 additions (same as supabase/v1_8.sql)
-- Forsa V1.8 database update. Safe to run more than once.
-- New order form:
-- 1) Shipping price per governorate (admin sets it; the customer pays it on top of the product price).
--    Every governorate starts at EGP 70 — change the real prices in Admin → Shipping.
--    A governorate switched off can't receive orders.
-- 2) Orders keep the shipping fee and the customer's product choices (size, color…).
--    Total to collect on delivery = price × quantity + shipping fee.
-- ============================================================

create table if not exists public.shipping_rates (
  governorate text primary key check (length(governorate) between 2 and 40),
  fee         integer not null default 70 check (fee >= 0 and fee <= 2000),
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);
alter table public.shipping_rates enable row level security;
drop policy if exists "shipping read" on public.shipping_rates;
create policy "shipping read" on public.shipping_rates for select to authenticated using (true);
drop policy if exists "shipping admin write" on public.shipping_rates;
create policy "shipping admin write" on public.shipping_rates for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.shipping_rates to authenticated;

insert into public.shipping_rates (governorate) values
  ('Cairo'),
  ('Giza'),
  ('Alexandria'),
  ('Qalyubia'),
  ('Sharqia'),
  ('Dakahlia'),
  ('Gharbia'),
  ('Monufia'),
  ('Beheira'),
  ('Kafr El Sheikh'),
  ('Damietta'),
  ('Port Said'),
  ('Ismailia'),
  ('Suez'),
  ('Faiyum'),
  ('Beni Suef'),
  ('Minya'),
  ('Asyut'),
  ('Sohag'),
  ('Qena'),
  ('Luxor'),
  ('Aswan'),
  ('Red Sea'),
  ('New Valley'),
  ('Matrouh'),
  ('North Sinai'),
  ('South Sinai')
on conflict (governorate) do nothing;

alter table public.orders add column if not exists shipping_fee integer not null default 0;
alter table public.orders add column if not exists product_options text not null default '';
alter table public.orders drop constraint if exists orders_options_check;
alter table public.orders add constraint orders_options_check check (length(product_options) <= 200 and shipping_fee >= 0);

create or replace function public.prepare_order() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.products; s public.profiles; c text; r public.shipping_rates;
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
  select * into r from public.shipping_rates where governorate = new.governorate and active;
  if not found then raise exception 'We don''t deliver to % yet', new.governorate; end if;
  new.shipping_fee := r.fee;
  new.product_options := left(trim(coalesce(new.product_options, '')), 200);
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
    new.shipping_fee := old.shipping_fee; new.product_options := old.product_options;
    return new;
  end if;
  raise exception 'Only pending orders can be cancelled';
end $$;


-- ============================================================
-- Forsa V1.9 database update. Safe to run more than once.
-- Forsa AI advisor (free, Gemini through the Supabase Edge Function "advisor"):
-- 1) ai_messages: the seller's conversation with the advisor (only the seller can read it).
-- 2) ai_usage: how many AI answers each seller used today (Cairo time). Limit: 5 a day.
--    The quota is checked and used only through the functions below.
-- ============================================================

create table if not exists public.ai_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  role        text not null check (role in ('user','assistant')),
  body        text not null check (length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists ai_messages_user_idx on public.ai_messages(user_id, created_at desc);
alter table public.ai_messages enable row level security;
drop policy if exists "ai messages read own" on public.ai_messages;
create policy "ai messages read own" on public.ai_messages for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "ai messages add own" on public.ai_messages;
create policy "ai messages add own" on public.ai_messages for insert
  with check (user_id = auth.uid() and (business_id is null or public.owns_business(business_id)));
grant select, insert on public.ai_messages to authenticated;

create table if not exists public.ai_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day     date not null,
  used    integer not null default 0 check (used >= 0),
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
drop policy if exists "ai usage read own" on public.ai_usage;
create policy "ai usage read own" on public.ai_usage for select using (user_id = auth.uid() or public.is_admin());
grant select on public.ai_usage to authenticated;

-- Daily limit per seller (change the number here to change it everywhere).
create or replace function public.ai_daily_limit() returns integer
language sql immutable as $$ select 5 $$;

create or replace function public.ai_today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Cairo')::date $$;

-- How many AI answers the current user has left today.
create or replace function public.ai_quota_left() returns integer
language sql stable security definer set search_path = public as $$
  select greatest(0, public.ai_daily_limit() - coalesce(
    (select used from public.ai_usage where user_id = auth.uid() and day = public.ai_today()), 0));
$$;

-- Uses one answer from today's quota; fails when the limit is reached. Returns what is left.
create or replace function public.ai_use_quota() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into public.ai_usage (user_id, day, used) values (auth.uid(), public.ai_today(), 1)
  on conflict (user_id, day) do update set used = public.ai_usage.used + 1
    where public.ai_usage.used < public.ai_daily_limit()
  returning used into n;
  if n is null then raise exception 'AI daily limit reached'; end if;
  return public.ai_daily_limit() - n;
end $$;

revoke execute on function public.ai_quota_left() from public, anon;
revoke execute on function public.ai_use_quota() from public, anon;
grant execute on function public.ai_quota_left() to authenticated;
grant execute on function public.ai_use_quota() to authenticated;
grant execute on function public.ai_daily_limit() to authenticated;
grant execute on function public.ai_today() to authenticated;

-- ============================================================
-- Forsa V1.10 database update. Safe to run more than once.
-- Forsa AI advisor: admin accounts (Forsa team) have unlimited AI answers for testing.
-- Sellers keep the daily limit (ai_daily_limit(), 5 a day). Usage is still counted for admins.
-- ============================================================

create or replace function public.ai_unlimited() returns integer
language sql immutable as $$ select 9999 $$;

create or replace function public.ai_quota_left() returns integer
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then public.ai_unlimited()
    else greatest(0, public.ai_daily_limit() - coalesce(
      (select used from public.ai_usage where user_id = auth.uid() and day = public.ai_today()), 0)) end;
$$;

create or replace function public.ai_use_quota() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if public.is_admin() then
    insert into public.ai_usage (user_id, day, used) values (auth.uid(), public.ai_today(), 1)
    on conflict (user_id, day) do update set used = public.ai_usage.used + 1;
    return public.ai_unlimited();
  end if;
  insert into public.ai_usage (user_id, day, used) values (auth.uid(), public.ai_today(), 1)
  on conflict (user_id, day) do update set used = public.ai_usage.used + 1
    where public.ai_usage.used < public.ai_daily_limit()
  returning used into n;
  if n is null then raise exception 'AI daily limit reached'; end if;
  return public.ai_daily_limit() - n;
end $$;

revoke execute on function public.ai_quota_left() from public, anon;
revoke execute on function public.ai_use_quota() from public, anon;
grant execute on function public.ai_quota_left() to authenticated;
grant execute on function public.ai_use_quota() to authenticated;
grant execute on function public.ai_unlimited() to authenticated;

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

-- ============================================================
-- Forsa V1.12 database update (app version 1.12.1). Safe to run more than once.
-- Admin accounts (the Forsa team: Ahmed) can request a website without the delivered-orders
-- condition, to test the feature. Every other seller still needs website_min_orders (20).
-- ============================================================

create or replace function public.request_website(p_business uuid) returns public.websites
language plpgsql security definer set search_path = public as $$
declare w public.websites; need integer; have integer; b public.businesses;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into b from public.businesses where id = p_business and owner_id = auth.uid();
  if not found then raise exception 'This business is not yours'; end if;
  need := public.setting_int('website_min_orders', 20);
  have := public.delivered_count(auth.uid());
  if have < need and not public.is_admin() then raise exception 'You need % delivered orders to request a website (you have %)', need, have; end if;
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

revoke execute on function public.request_website(uuid) from public, anon;
grant execute on function public.request_website(uuid) to authenticated;

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

-- ===== v1.14 =====
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

-- ===== v1.15 =====
-- ============================================================
-- Forsa v1.15 database update (app version 1.15). Safe to run more than once.
-- "Product owner" access: only customers Forsa made a factory deal with get "Add my own product" and
-- "Connect existing website". The admin gives a user a one-time pass; the NEXT business that user
-- creates becomes a product-owner business and the pass is used up. Later businesses are normal
-- unless the admin gives a new pass. Nobody (admin included) gets the features without a pass.
-- ============================================================

alter table public.profiles add column if not exists owner_pass boolean not null default false;
alter table public.businesses add column if not exists product_owner boolean not null default false;

-- Businesses that already use these features keep them (nothing that works today breaks).
do $$ begin
  perform set_config('forsa.release', '1', true);
  update public.businesses b set product_owner = true
   where not b.product_owner and (
     exists (select 1 from public.store_connections c where c.business_id = b.id)
     or exists (select 1 from public.business_products bp join public.products p on p.id = bp.product_id where bp.business_id = b.id and p.seller_made));
  perform set_config('forsa.release', '', true);
end $$;

-- Users can't give themselves the pass.
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
    new.owner_pass := old.owner_pass;
    if coalesce(old.phone, '') <> '' then new.phone := old.phone; end if;
  end if;
  return new;
end $$;

-- New business: takes the owner's pass (if any) and uses it up. Nobody can switch the mark by hand.
create or replace function public.business_owner_pass() returns trigger
language plpgsql security definer set search_path = public as $$
declare had boolean;
begin
  if public.releasing() then return new; end if;
  if tg_op = 'INSERT' then
    select owner_pass into had from public.profiles where id = new.owner_id for update;
    new.product_owner := coalesce(had, false);
    if new.product_owner then
      perform set_config('forsa.release', '1', true);
      update public.profiles set owner_pass = false where id = new.owner_id;
      perform set_config('forsa.release', '', true);
    end if;
  else
    new.product_owner := old.product_owner;
  end if;
  return new;
end $$;
revoke all on function public.business_owner_pass() from public, anon, authenticated;
drop trigger if exists businesses_owner_pass on public.businesses;
create trigger businesses_owner_pass before insert or update on public.businesses
  for each row execute function public.business_owner_pass();

-- Only product-owner businesses can hold own products or connect a store (checked in the database).
create or replace function public.need_product_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.releasing() then return new; end if;
  if tg_table_name = 'business_products' then
    if not exists (select 1 from public.products where id = (to_jsonb(new)->>'product_id')::uuid and seller_made) then
      return new;
    end if;
  end if;
  if not exists (select 1 from public.businesses where id = new.business_id and product_owner) then
    raise exception 'This feature is only for Forsa product owners. Contact Forsa to get access.';
  end if;
  return new;
end $$;
revoke all on function public.need_product_owner() from public, anon, authenticated;
drop trigger if exists business_products_owner on public.business_products;
create trigger business_products_owner before insert on public.business_products
  for each row execute function public.need_product_owner();
drop trigger if exists store_connections_owner on public.store_connections;
create trigger store_connections_owner before insert on public.store_connections
  for each row execute function public.need_product_owner();

-- Admin: give or take back a user's pass.
create or replace function public.admin_set_owner_pass(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update public.profiles set owner_pass = coalesce(p_on, false) where id = p_user;
  if not found then raise exception 'User not found'; end if;
end $$;
revoke all on function public.admin_set_owner_pass(uuid, boolean) from public, anon;
grant execute on function public.admin_set_owner_pass(uuid, boolean) to authenticated;
