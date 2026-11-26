-- ============================================================
-- Forsa v1.19 database update (app version 1.19). Safe to run more than once.
-- AI media buyer, part 3: Facebook connection, automatic publishing and the daily AI review.
-- The features stay switched off in the app until Forsa's Meta app exists (META_APP_ID in src/config.js).
-- 1) Facebook login: meta_start() makes a one-time code (state) for the seller; the "meta-ads" Edge Function's
--    callback exchanges Facebook's code for an access token, ENCRYPTS it (key derived from the Meta app secret, only
--    the Edge Function has it) and saves it with meta_complete(state, ...). Nobody can read the token column.
-- 2) meta_links: which Facebook page + ad account each business uses (only ones the seller's Facebook gave access to).
-- 3) ad_plans.meta (Meta ids, AI review notes, recommendations) and ad_plans.results are written only through the
--    functions below, never directly by the seller.
-- 4) Orders that come from an ad (Forsa website link with ?fad=<plan>) are credited to that ad (orders.ad_plan_id).
-- 5) Daily review: ad_review_queue() / ad_review_save() for the scheduled job (secret code kept only in the database)
--    or the admin. Suggested lessons from real results are added switched off, for the admin to check and turn on.
-- ============================================================

-- ---------- Secrets kept only inside the database (no one can read this table) ----------
create table if not exists public.app_secrets (key text primary key, value text not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from public, anon, authenticated;
insert into public.app_secrets (key, value) values ('cron', encode(extensions.gen_random_bytes(24), 'hex')) on conflict (key) do nothing;

create or replace function public.cron_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_secret, '') <> '' and exists (select 1 from public.app_secrets where key = 'cron' and value = p_secret);
$$;
revoke all on function public.cron_ok(text) from public, anon, authenticated;

-- ---------- 1) Facebook login ----------
create table if not exists public.meta_oauth_states (
  nonce       text primary key,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  used        boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.meta_oauth_states enable row level security;
revoke all on public.meta_oauth_states from public, anon, authenticated;

create table if not exists public.meta_connections (
  owner_id     uuid primary key references public.profiles(id) on delete cascade,
  fb_user_id   text not null default '',
  fb_name      text not null default '',
  token_enc    text not null,
  expires_at   timestamptz,
  pages        jsonb not null default '[]'::jsonb,
  ad_accounts  jsonb not null default '[]'::jsonb,
  connected_at timestamptz not null default now()
);
alter table public.meta_connections enable row level security;
drop policy if exists "meta connections read" on public.meta_connections;
create policy "meta connections read" on public.meta_connections for select using (owner_id = auth.uid() or public.is_admin());
revoke all on public.meta_connections from public, anon, authenticated;
-- Every column except the (encrypted) token.
grant select (owner_id, fb_user_id, fb_name, expires_at, pages, ad_accounts, connected_at) on public.meta_connections to authenticated;

create or replace function public.meta_start(p_business uuid) returns text
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_business is not null and not public.owns_business(p_business) then raise exception 'This business is not yours'; end if;
  delete from public.meta_oauth_states where owner_id = auth.uid() or created_at < now() - interval '1 day';
  n := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.meta_oauth_states (nonce, owner_id, business_id) values (n, auth.uid(), p_business);
  return n;
end $$;

-- Called by the Edge Function's Facebook callback (no user session there): the one-time state proves who it is.
create or replace function public.meta_complete(p_state text, p_fb_user_id text, p_fb_name text, p_token_enc text,
  p_expires timestamptz, p_pages jsonb, p_accounts jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.meta_oauth_states;
begin
  select * into s from public.meta_oauth_states where nonce = p_state for update;
  if not found or s.used or s.created_at < now() - interval '30 minutes' then raise exception 'This Facebook connection link expired. Please try again.'; end if;
  if coalesce(p_token_enc, '') = '' or length(p_token_enc) > 4000 then raise exception 'Invalid token'; end if;
  if jsonb_typeof(coalesce(p_pages, '[]')) <> 'array' or jsonb_typeof(coalesce(p_accounts, '[]')) <> 'array'
     or jsonb_array_length(coalesce(p_pages, '[]')) > 100 or jsonb_array_length(coalesce(p_accounts, '[]')) > 100 then raise exception 'Invalid lists'; end if;
  update public.meta_oauth_states set used = true where nonce = p_state;
  insert into public.meta_connections (owner_id, fb_user_id, fb_name, token_enc, expires_at, pages, ad_accounts, connected_at)
  values (s.owner_id, left(coalesce(p_fb_user_id, ''), 40), left(coalesce(p_fb_name, ''), 120), p_token_enc, p_expires,
          coalesce(p_pages, '[]'), coalesce(p_accounts, '[]'), now())
  on conflict (owner_id) do update set fb_user_id = excluded.fb_user_id, fb_name = excluded.fb_name, token_enc = excluded.token_enc,
    expires_at = excluded.expires_at, pages = excluded.pages, ad_accounts = excluded.ad_accounts, connected_at = now();
  return jsonb_build_object('owner_id', s.owner_id, 'business_id', s.business_id);
end $$;

-- The seller's own encrypted token (only the Edge Function can decrypt it).
create or replace function public.meta_token() returns table (token_enc text, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.token_enc, c.expires_at from public.meta_connections c where c.owner_id = auth.uid();
$$;

-- ---------- 2) Page + ad account per business ----------
create table if not exists public.meta_links (
  business_id     uuid primary key references public.businesses(id) on delete cascade,
  owner_id        uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  page_id         text not null,
  page_name       text not null default '',
  ad_account_id   text not null,
  ad_account_name text not null default '',
  currency        text not null default '',
  updated_at      timestamptz not null default now()
);
alter table public.meta_links enable row level security;
drop policy if exists "meta links read" on public.meta_links;
create policy "meta links read" on public.meta_links for select using (owner_id = auth.uid() or public.is_admin());
drop policy if exists "meta links insert" on public.meta_links;
create policy "meta links insert" on public.meta_links for insert with check (owner_id = auth.uid() and public.owns_business(business_id));
drop policy if exists "meta links update" on public.meta_links;
create policy "meta links update" on public.meta_links for update using (owner_id = auth.uid()) with check (owner_id = auth.uid() and public.owns_business(business_id));
drop policy if exists "meta links delete" on public.meta_links;
create policy "meta links delete" on public.meta_links for delete using (owner_id = auth.uid());
revoke all on public.meta_links from anon;
grant select, insert, update, delete on public.meta_links to authenticated;

-- Only a page / ad account the seller's own Facebook connection gave access to; names and currency come from it.
create or replace function public.meta_links_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.meta_connections; pg jsonb; ac jsonb;
begin
  select * into c from public.meta_connections where owner_id = new.owner_id;
  if not found then raise exception 'Connect Facebook first'; end if;
  select x into pg from jsonb_array_elements(c.pages) x where x->>'id' = new.page_id limit 1;
  if pg is null then raise exception 'Choose one of your Facebook pages'; end if;
  select x into ac from jsonb_array_elements(c.ad_accounts) x where x->>'id' = new.ad_account_id limit 1;
  if ac is null then raise exception 'Choose one of your ad accounts'; end if;
  new.page_name := left(coalesce(pg->>'name', ''), 120);
  new.ad_account_name := left(coalesce(ac->>'name', ''), 120);
  new.currency := left(coalesce(ac->>'currency', ''), 8);
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.meta_links_check() from public, anon, authenticated;
drop trigger if exists meta_links_check on public.meta_links;
create trigger meta_links_check before insert or update on public.meta_links for each row execute function public.meta_links_check();

-- ---------- 3) Running ads: Meta ids, AI review, results ----------
alter table public.ad_plans add column if not exists meta jsonb not null default '{}'::jsonb;
alter table public.ad_plans add column if not exists last_review_at timestamptz;

create or replace function public.ad_plans_meta_keep() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.releasing() then new.meta := old.meta; new.last_review_at := old.last_review_at; end if;
  return new;
end $$;
revoke all on function public.ad_plans_meta_keep() from public, anon, authenticated;
drop trigger if exists ad_plans_meta_keep on public.ad_plans;
create trigger ad_plans_meta_keep before update on public.ad_plans for each row execute function public.ad_plans_meta_keep();

-- Seller side (his own login, through the Edge Function): publish / review / scale / stop his own plan.
create or replace function public.ad_plan_update_live(p_plan uuid, p_status text, p_meta jsonb, p_results jsonb) returns public.ad_plans
language plpgsql security definer set search_path = public as $$
declare r public.ad_plans;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into r from public.ad_plans where id = p_plan and owner_id = auth.uid() for update;
  if not found then raise exception 'Not found'; end if;
  if p_status not in ('approved', 'running', 'done', 'stopped') then raise exception 'Bad status'; end if;
  if r.status = 'draft' then raise exception 'Approve the plan first'; end if;
  perform set_config('forsa.release', '1', true);
  update public.ad_plans set status = p_status, meta = coalesce(p_meta, meta), results = coalesce(p_results, results), last_review_at = now()
    where id = p_plan returning * into r;
  perform set_config('forsa.release', '', true);
  return r;
end $$;

-- ---------- 4) Orders from ads ----------
alter table public.orders add column if not exists ad_plan_id uuid references public.ad_plans(id) on delete set null;

create or replace function public.orders_ad_plan() returns trigger
language plpgsql security definer set search_path = public as $$
declare a text;
begin
  if tg_op = 'UPDATE' then new.ad_plan_id := old.ad_plan_id; return new; end if;
  new.ad_plan_id := null;
  a := current_setting('forsa.ad_plan', true);
  if coalesce(a, '') ~ '^[0-9a-f-]{36}$' and exists (select 1 from public.ad_plans p where p.id = a::uuid and p.business_id = new.business_id
       and p.status in ('approved', 'running', 'done')) then
    new.ad_plan_id := a::uuid;
  end if;
  return new;
end $$;
revoke all on function public.orders_ad_plan() from public, anon, authenticated;
drop trigger if exists orders_z_ad_plan on public.orders;
create trigger orders_z_ad_plan before insert or update on public.orders for each row execute function public.orders_ad_plan();

-- Website order that came from an ad link: same checks as place_store_order, credited to the ad.
create or replace function public.place_store_order_ad(
  p_slug text, p_product uuid, p_qty integer, p_name text, p_phone text, p_governorate text,
  p_address text, p_options text default '', p_hp text default '', p_ad uuid default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  perform set_config('forsa.ad_plan', coalesce(p_ad::text, ''), true);
  n := public.place_store_order(p_slug, p_product, p_qty, p_name, p_phone, p_governorate, p_address, p_options, p_hp);
  perform set_config('forsa.ad_plan', '', true);
  return n;
end $$;
grant execute on function public.place_store_order_ad(text, uuid, integer, text, text, text, text, text, text, uuid) to anon, authenticated;

create or replace function public.ad_plan_orders(p_plan uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'orders', count(*) filter (where o.status not in ('cancelled')),
    'delivered', count(*) filter (where o.status = 'delivered'),
    'returned', count(*) filter (where o.status = 'returned'))
  from public.orders o join public.ad_plans p on p.id = o.ad_plan_id
  where o.ad_plan_id = p_plan and (p.owner_id = auth.uid() or public.is_admin());
$$;

-- ---------- 5) Daily review (scheduled job or admin) ----------
create or replace function public.ad_review_queue(p_secret text) returns table (
  plan_id uuid, owner_id uuid, business_id uuid, plan jsonb, answers jsonb, meta jsonb, results jsonb, status text,
  token_enc text, ad_account_id text, last_review_at timestamptz, order_counts jsonb)
language plpgsql security definer set search_path = public as $$
begin
  if not (public.cron_ok(p_secret) or public.is_admin()) then raise exception 'Not allowed'; end if;
  return query
    select p.id, p.owner_id, p.business_id, p.plan, p.answers, p.meta, p.results, p.status, c.token_enc, l.ad_account_id, p.last_review_at,
      (select jsonb_build_object('orders', count(*) filter (where o.status <> 'cancelled'), 'delivered', count(*) filter (where o.status = 'delivered'),
              'returned', count(*) filter (where o.status = 'returned')) from public.orders o where o.ad_plan_id = p.id)
    from public.ad_plans p
    join public.meta_connections c on c.owner_id = p.owner_id
    left join public.meta_links l on l.business_id = p.business_id
    where p.status = 'running' and coalesce(p.meta->>'campaign_id', '') <> ''
    order by p.last_review_at nulls first limit 200;
end $$;

create or replace function public.ad_review_save(p_secret text, p_plan uuid, p_status text, p_meta jsonb, p_results jsonb, p_lessons jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare l jsonb;
begin
  if not (public.cron_ok(p_secret) or public.is_admin()) then raise exception 'Not allowed'; end if;
  if p_status not in ('running', 'done', 'stopped') then raise exception 'Bad status'; end if;
  perform set_config('forsa.release', '1', true);
  update public.ad_plans set status = p_status, meta = coalesce(p_meta, meta), results = coalesce(p_results, results), last_review_at = now()
    where id = p_plan and status = 'running';
  perform set_config('forsa.release', '', true);
  -- Suggested lessons from real results: added switched off; the admin checks them and turns them on.
  for l in select * from jsonb_array_elements(coalesce(p_lessons, '[]'::jsonb)) loop
    if length(coalesce(l->>'lesson', '')) between 5 and 600 then
      insert into public.ad_lessons (category, lesson, evidence, active)
      values (left(coalesce(nullif(l->>'category', ''), 'All'), 40), l->>'lesson', greatest(0, coalesce((l->>'evidence')::int, 1)), false);
    end if;
  end loop;
end $$;

-- ---------- Disconnect Facebook (also stops Forsa's control of running ads) ----------
create or replace function public.meta_disconnect() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform set_config('forsa.release', '1', true);
  update public.ad_plans set status = 'stopped', last_review_at = now() where owner_id = auth.uid() and status = 'running';
  perform set_config('forsa.release', '', true);
  delete from public.meta_links where owner_id = auth.uid();
  delete from public.meta_connections where owner_id = auth.uid();
  delete from public.meta_oauth_states where owner_id = auth.uid();
end $$;

-- ---------- Grants ----------
revoke execute on function public.meta_start(uuid) from public, anon;
revoke execute on function public.meta_token() from public, anon;
revoke execute on function public.ad_plan_update_live(uuid, text, jsonb, jsonb) from public, anon;
revoke execute on function public.ad_plan_orders(uuid) from public, anon;
revoke execute on function public.meta_disconnect() from public, anon;
grant execute on function public.meta_start(uuid) to authenticated;
grant execute on function public.meta_token() to authenticated;
grant execute on function public.ad_plan_update_live(uuid, text, jsonb, jsonb) to authenticated;
grant execute on function public.ad_plan_orders(uuid) to authenticated;
grant execute on function public.meta_disconnect() to authenticated;
-- The callback and the scheduled job have no user login: protected by the one-time state / the database secret.
revoke execute on function public.meta_complete(text, text, text, text, timestamptz, jsonb, jsonb) from public;
grant execute on function public.meta_complete(text, text, text, text, timestamptz, jsonb, jsonb) to anon, authenticated;
revoke execute on function public.ad_review_queue(text) from public;
revoke execute on function public.ad_review_save(text, uuid, text, jsonb, jsonb, jsonb) from public;
grant execute on function public.ad_review_queue(text) to anon, authenticated;
grant execute on function public.ad_review_save(text, uuid, text, jsonb, jsonb, jsonb) to anon, authenticated;
