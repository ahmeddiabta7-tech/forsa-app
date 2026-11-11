-- ============================================================
-- Forsa V1.10 database update. Safe to run more than once.
-- Forsa AI advisor: admin accounts (Forsa team) have unlimited AI answers for testing.
-- Sellers keep the daily limit (ai_daily_limit(), 5 a day). Usage is still counted for admins.
-- ============================================================

create or replace function public.ai_unlimited() returns integer
language sql immutable as $$ select 9999 $$;

create or replace function public.ai_quota_left() returns integer
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then public.ai_unlimited()
    else greatest(0, public.ai_daily_limit() - coalesce(
      (select used from public.ai_usage where user_id = auth.uid() and day = public.ai_today()), 0)) end;
$$;

create or replace function public.ai_use_quota() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if public.is_admin() then
    insert into public.ai_usage (user_id, day, used) values (auth.uid(), public.ai_today(), 1)
    on conflict (user_id, day) do update set used = public.ai_usage.used + 1;
    return public.ai_unlimited();
  end if;
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
grant execute on function public.ai_unlimited() to authenticated;
