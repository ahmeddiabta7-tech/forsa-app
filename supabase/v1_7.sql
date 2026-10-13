-- ============================================================
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
