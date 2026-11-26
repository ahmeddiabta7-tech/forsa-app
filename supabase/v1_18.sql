-- ============================================================
-- Forsa v1.18 database update (app version 1.18). Safe to run more than once.
-- AI media buyer, part 2:
-- 1) Strategy options: the AI proposes 3 strategies and the seller picks one + his "touch" (tone, angles…).
--    Every AI step (strategies, plan, change) counts as an attempt: max 20 a day (ad_try_step), plans/changes stay 5.
-- 2) Brand memory: per business, the seller's own brand notes (brand_memory). The AI also reads his past plans,
--    the changes he asked for (ad_plans.change_notes), his feedback and, once ads run, the real results.
-- ============================================================

alter table public.ai_usage add column if not exists ad_tries integer not null default 0 check (ad_tries >= 0);

create or replace function public.ad_try_step() returns void
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if public.is_admin() then return; end if;
  insert into public.ai_usage (user_id, day, used, ad_tries) values (auth.uid(), public.ai_today(), 0, 1)
  on conflict (user_id, day) do update set ad_tries = public.ai_usage.ad_tries + 1
    where public.ai_usage.ad_tries < public.ad_daily_limit() * 4
  returning ad_tries into n;
  if n is null then raise exception 'AI daily limit reached'; end if;
end $$;
revoke execute on function public.ad_try_step() from public, anon;
grant execute on function public.ad_try_step() to authenticated;

-- The changes the seller asked for on a plan (kept as memory). Only while the plan is a draft (guard below).
alter table public.ad_plans add column if not exists change_notes text[] not null default '{}';

create or replace function public.ad_plans_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'draft'; new.approved_at := null; new.revisions := 0; new.created_at := now();
    new.results := '{}'::jsonb; new.feedback := null; new.feedback_note := null; new.change_notes := '{}';
  else
    new.owner_id := old.owner_id; new.business_id := old.business_id; new.created_at := old.created_at;
    if new.status <> old.status and not (
         (old.status = 'draft' and new.status in ('approved', 'stopped'))
      or (old.status = 'approved' and new.status in ('running', 'done', 'stopped'))
      or (old.status = 'running' and new.status in ('done', 'stopped'))) then
      raise exception 'This ad plan can''t change from % to %', old.status, new.status;
    end if;
    if old.status <> 'draft' then
      new.plan := old.plan; new.answers := old.answers; new.revisions := old.revisions; new.change_notes := old.change_notes;
    end if;
    if coalesce(array_length(new.change_notes, 1), 0) > 30 then new.change_notes := new.change_notes[1:30]; end if;
    -- Results come only from Forsa's ad system (running ads), never typed by the seller.
    if not public.releasing() then new.results := old.results; end if;
    if new.status = 'approved' and old.status = 'draft' then new.approved_at := now(); else new.approved_at := old.approved_at; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.ad_plans_guard() from public, anon, authenticated;

-- Brand notes per business ("my brand voice is premium", "never say cheap"…).
create table if not exists public.brand_memory (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  owner_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  notes       text not null default '' check (length(notes) <= 600),
  updated_at  timestamptz not null default now()
);
alter table public.brand_memory enable row level security;
drop policy if exists "brand memory read" on public.brand_memory;
create policy "brand memory read" on public.brand_memory for select using (owner_id = auth.uid() or public.is_admin());
drop policy if exists "brand memory insert" on public.brand_memory;
create policy "brand memory insert" on public.brand_memory for insert
  with check (owner_id = auth.uid() and public.owns_business(business_id));
drop policy if exists "brand memory update" on public.brand_memory;
create policy "brand memory update" on public.brand_memory for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid() and public.owns_business(business_id));
revoke all on public.brand_memory from anon;
grant select, insert, update on public.brand_memory to authenticated;
