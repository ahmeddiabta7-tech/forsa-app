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
