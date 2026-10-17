-- ============================================================
-- Forsa V1.9 database update. Safe to run more than once.
-- Forsa AI advisor (free, Gemini through the Supabase Edge Function "advisor"):
-- 1) ai_messages: the seller's conversation with the advisor (only the seller can read it).
-- 2) ai_usage: how many AI answers each seller used today (Cairo time). Limit: 5 a day.
--    The quota is checked and used only through the functions below.
-- ============================================================

create table if not exists public.ai_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  role        text not null check (role in ('user','assistant')),
  body        text not null check (length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists ai_messages_user_idx on public.ai_messages(user_id, created_at desc);
alter table public.ai_messages enable row level security;
drop policy if exists "ai messages read own" on public.ai_messages;
create policy "ai messages read own" on public.ai_messages for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "ai messages add own" on public.ai_messages;
create policy "ai messages add own" on public.ai_messages for insert
  with check (user_id = auth.uid() and (business_id is null or public.owns_business(business_id)));
grant select, insert on public.ai_messages to authenticated;

create table if not exists public.ai_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day     date not null,
  used    integer not null default 0 check (used >= 0),
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
drop policy if exists "ai usage read own" on public.ai_usage;
create policy "ai usage read own" on public.ai_usage for select using (user_id = auth.uid() or public.is_admin());
grant select on public.ai_usage to authenticated;

-- Daily limit per seller (change the number here to change it everywhere).
create or replace function public.ai_daily_limit() returns integer
language sql immutable as $$ select 5 $$;

create or replace function public.ai_today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Cairo')::date $$;

-- How many AI answers the current user has left today.
create or replace function public.ai_quota_left() returns integer
language sql stable security definer set search_path = public as $$
  select greatest(0, public.ai_daily_limit() - coalesce(
    (select used from public.ai_usage where user_id = auth.uid() and day = public.ai_today()), 0));
$$;

-- Uses one answer from today's quota; fails when the limit is reached. Returns what is left.
create or replace function public.ai_use_quota() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into public.ai_usage (user_id, day, used) values (auth.uid(), public.ai_today(), 1)
  on conflict (user_id, day) do update set used = public.ai_usage.used + 1
    where public.ai_usage.used < public.ai_daily_limit()
  returning used into n;
  if n is null then raise exception 'AI daily limit reached'; end if;
  return public.ai_daily_limit() - n;
end $$;

revoke execute on function public.ai_quota_left() from public, anon;
revoke execute on function public.ai_use_quota() from public, anon;
grant execute on function public.ai_quota_left() to authenticated;
grant execute on function public.ai_use_quota() to authenticated;
grant execute on function public.ai_daily_limit() to authenticated;
grant execute on function public.ai_today() to authenticated;
