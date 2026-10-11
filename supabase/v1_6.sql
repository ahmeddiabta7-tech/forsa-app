-- ============================================================
-- Forsa V1.6 database update. Safe to run more than once.
-- The "3" in the unlock rule counts PIECES (order quantity), not orders:
-- one customer ordering 3 pieces releases everything at once.
-- ============================================================
create or replace function public.check_hold() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'on_hold'
     and (select coalesce(sum(quantity), 0) from public.orders where seller_id = new.seller_id and status = 'on_hold') >= 3 then
    perform public.release_held(new.seller_id);
  end if;
  return null;
end $$;
