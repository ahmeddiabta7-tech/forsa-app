-- ============================================================
-- Forsa v1.16 database update (audit fix). Safe to run more than once.
-- AI advisor: besides the daily answers limit (charged only after a good answer), count ATTEMPTS before
-- Google is asked, capped at 2x the daily limit. Many requests sent at the same moment can no longer
-- use up Forsa's shared free Google allowance. The admin stays unlimited.
-- ============================================================

alter table public.ai_usage add column if not exists tries integer not null default 0 check (tries >= 0);

create or replace function public.ai_try() returns void
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if public.is_admin() then return; end if;
  insert into public.ai_usage (user_id, day, used, tries) values (auth.uid(), public.ai_today(), 0, 1)
  on conflict (user_id, day) do update set tries = public.ai_usage.tries + 1
    where public.ai_usage.tries < public.ai_daily_limit() * 2
  returning tries into n;
  if n is null then raise exception 'AI daily limit reached'; end if;
end $$;
revoke execute on function public.ai_try() from public, anon;
grant execute on function public.ai_try() to authenticated;
