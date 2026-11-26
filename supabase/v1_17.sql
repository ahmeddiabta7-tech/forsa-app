-- ============================================================
-- Forsa v1.17 database update (app version 1.17). Safe to run more than once.
-- AI media buyer (pilot): the seller answers a few questions, the "ad-agent" Edge Function (Gemini) builds an ad
-- plan (strategy, audience, 3 Arabic ads, budget, honest money math), the seller asks for changes or approves it.
-- 1) ad_plans: one row per ad plan, private to the seller (admin sees all for the pilot).
-- 2) ad_lessons: the AI's growing memory / R&D notes. Admin adds and edits them; the AI reads them before writing.
-- 3) ai_usage.ads + ad_try(): AI ad plans per day (new plans + changes), admin unlimited.
-- ============================================================

-- ---------- 1) Ad plans ----------
create table if not exists public.ad_plans (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  product_id   uuid references public.products(id) on delete set null,
  status       text not null default 'draft' check (status in ('draft', 'approved', 'running', 'done', 'stopped')),
  answers      jsonb not null default '{}'::jsonb,
  plan         jsonb not null default '{}'::jsonb,
  revisions    integer not null default 0 check (revisions between 0 and 100),
  feedback     smallint check (feedback in (-1, 1)),
  feedback_note text check (feedback_note is null or length(feedback_note) <= 500),
  results      jsonb not null default '{}'::jsonb,
  approved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists ad_plans_owner_idx on public.ad_plans (owner_id, created_at desc);
alter table public.ad_plans enable row level security;

drop policy if exists "ad plans read" on public.ad_plans;
create policy "ad plans read" on public.ad_plans for select
  using (owner_id = auth.uid() or public.is_admin());
drop policy if exists "ad plans insert own" on public.ad_plans;
create policy "ad plans insert own" on public.ad_plans for insert
  with check (owner_id = auth.uid() and public.owns_business(business_id));
drop policy if exists "ad plans update own" on public.ad_plans;
create policy "ad plans update own" on public.ad_plans for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.ad_plans from anon;
grant select, insert, update on public.ad_plans to authenticated;

-- Owner, business and creation time never change; status only moves forward; approval time set by the database.
create or replace function public.ad_plans_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'draft'; new.approved_at := null; new.revisions := 0; new.created_at := now();
    new.results := '{}'::jsonb; new.feedback := null; new.feedback_note := null;
  else
    new.owner_id := old.owner_id; new.business_id := old.business_id; new.created_at := old.created_at;
    if new.status <> old.status and not (
         (old.status = 'draft' and new.status in ('approved', 'stopped'))
      or (old.status = 'approved' and new.status in ('running', 'done', 'stopped'))
      or (old.status = 'running' and new.status in ('done', 'stopped'))) then
      raise exception 'This ad plan can''t change from % to %', old.status, new.status;
    end if;
    if old.status <> 'draft' then new.plan := old.plan; new.answers := old.answers; new.revisions := old.revisions; end if;
    if new.status = 'approved' and old.status = 'draft' then new.approved_at := now(); else new.approved_at := old.approved_at; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.ad_plans_guard() from public, anon, authenticated;
drop trigger if exists ad_plans_guard on public.ad_plans;
create trigger ad_plans_guard before insert or update on public.ad_plans
  for each row execute function public.ad_plans_guard();

-- ---------- 2) Lessons (the AI's memory, edited by the Forsa team) ----------
create table if not exists public.ad_lessons (
  id         uuid primary key default gen_random_uuid(),
  category   text not null default 'All' check (length(category) between 1 and 40),
  lesson     text not null check (length(lesson) between 5 and 600),
  evidence   integer not null default 0 check (evidence between 0 and 100000),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.ad_lessons enable row level security;
drop policy if exists "ad lessons read" on public.ad_lessons;
create policy "ad lessons read" on public.ad_lessons for select to authenticated using (active or public.is_admin());
drop policy if exists "ad lessons admin" on public.ad_lessons;
create policy "ad lessons admin" on public.ad_lessons for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.ad_lessons from anon;
grant select, insert, update, delete on public.ad_lessons to authenticated;

-- ---------- 3) Daily limit for AI ad plans ----------
alter table public.ai_usage add column if not exists ads integer not null default 0 check (ads >= 0);

create or replace function public.ad_daily_limit() returns integer
language sql immutable as $$ select 5 $$;

create or replace function public.ad_try() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if public.is_admin() then return public.ai_unlimited(); end if;
  insert into public.ai_usage (user_id, day, used, ads) values (auth.uid(), public.ai_today(), 0, 1)
  on conflict (user_id, day) do update set ads = public.ai_usage.ads + 1
    where public.ai_usage.ads < public.ad_daily_limit()
  returning ads into n;
  if n is null then raise exception 'AI daily limit reached'; end if;
  return public.ad_daily_limit() - n;
end $$;

create or replace function public.ad_quota_left() returns integer
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then public.ai_unlimited()
    else greatest(0, public.ad_daily_limit() - coalesce(
      (select ads from public.ai_usage where user_id = auth.uid() and day = public.ai_today()), 0)) end;
$$;
revoke execute on function public.ad_try() from public, anon;
revoke execute on function public.ad_quota_left() from public, anon;
grant execute on function public.ad_try() to authenticated;
grant execute on function public.ad_quota_left() to authenticated;
