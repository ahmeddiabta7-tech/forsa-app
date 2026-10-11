-- ============================================================
-- Forsa V1.1 database update. Safe to run more than once.
-- Adds: service requests, richer idea fields.
-- Product delete needs no change: admins can already delete, and the
-- orders -> products link blocks deleting a product that has orders.
-- ============================================================

-- ---------- Ideas: extra guided fields ----------
alter table public.ideas add column if not exists customer      text default '';
alter table public.ideas add column if not exists revenue_model text default '';
alter table public.ideas add column if not exists needs         text default '';

-- ---------- Service requests (marketing agencies, media buying, ...) ----------
create table if not exists public.service_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  service     text not null check (service ~ '^[a-z_]{2,40}$'),
  details     text not null check (length(details) between 1 and 2000),
  budget      text default '',
  status      text not null default 'new' check (status in ('new','contacted','done')),
  created_at  timestamptz not null default now()
);
create index if not exists service_requests_user_idx on public.service_requests(user_id, created_at desc);

create or replace function public.force_new_request() returns trigger
language plpgsql as $$
begin
  if not public.is_admin() then new.status := 'new'; end if;
  return new;
end $$;
drop trigger if exists service_requests_new on public.service_requests;
create trigger service_requests_new before insert on public.service_requests
  for each row execute function public.force_new_request();

alter table public.service_requests enable row level security;
drop policy if exists "requests read" on public.service_requests;
create policy "requests read" on public.service_requests for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "requests create" on public.service_requests;
create policy "requests create" on public.service_requests for insert with check (user_id = auth.uid());
drop policy if exists "requests admin update" on public.service_requests;
create policy "requests admin update" on public.service_requests for update using (public.is_admin());

grant select, insert, update, delete on public.service_requests to authenticated;
grant execute on function public.force_new_request() to authenticated;
