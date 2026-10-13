-- ============================================================
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

