-- ============================================================
-- Forsa V1.5 database update. Safe to run more than once.
-- 1) New "3 orders" rule (ready products only):
--    A seller starts LOCKED: new ready-product orders are saved as 'on_hold'.
--    When they have 3 orders on hold, all are released (→ 'pending') and the seller
--    is UNLOCKED for 30 days: every order moves right away, even one.
--    After 30 days they are locked again and need 3 new orders (nothing carries over).
--    Paying EGP 100 (approved by admin) releases held orders and unlocks 30 days.
--    A seller's own custom products are never on hold.
-- 2) Custom products: the seller chooses where the batch goes —
--    'forsa' (Forsa keeps it and ships each order) or 'self' (whole batch to the seller).
-- ============================================================

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
