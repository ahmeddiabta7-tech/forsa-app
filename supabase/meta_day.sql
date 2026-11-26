-- ============================================================
-- Forsa "Meta day" — run ONCE in the Supabase SQL editor after the meta-ads function has its secrets.
-- Turns on the daily AI review of running ads: every day at 10:00 Cairo time (08:00 UTC) the database calls the
-- meta-ads Edge Function with a secret code that only the database knows (public.app_secrets, created in v1_19.sql).
-- Safe to run more than once (the job is replaced).
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'forsa-ad-review';
select cron.schedule('forsa-ad-review', '0 8 * * *', $job$
  select net.http_post(
    url := 'https://zkmbifplbpvwlvzbpnqc.supabase.co/functions/v1/meta-ads',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select value from public.app_secrets where key = 'cron')),
    body := '{"action":"review_all"}'::jsonb,
    timeout_milliseconds := 120000);
$job$);

-- Check: the job exists (read-only).
select jobname, schedule, active from cron.job where jobname = 'forsa-ad-review';
