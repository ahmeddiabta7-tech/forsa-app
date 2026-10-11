-- ============================================================
-- Forsa V1.2 database update. Safe to run more than once.
-- 1) Monthly rule: every 30-day month (counted from signup), a seller who
--    delivers 3 orders gets the next month free. Fewer than 3 → the account
--    pauses until an EGP 100 payment is approved (unlocks 30 days).
--    The first month is always open.
-- 2) Seller costs (ads, marketing, packaging…) for Analytics, entered by the
--    seller or added by Forsa from a service request.
-- ============================================================

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
