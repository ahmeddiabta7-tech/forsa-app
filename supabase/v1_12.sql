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
