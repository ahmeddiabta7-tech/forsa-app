-- ============================================================
-- Forsa V1.3 database update. Safe to run more than once.
-- 1) Businesses: a seller creates one or more businesses (max 5), adds products
--    to them, and can only order products that are in one of their businesses.
-- 2) Agencies: partner accounts (role 'agency') that the admin assigns to
--    service requests. They see the business, never the seller's phone/email.
-- 3) Chat on each service request (seller ↔ agency ↔ Forsa admin).
--    Phone numbers, emails and WhatsApp/Telegram links are hidden automatically.
-- ============================================================

-- ---------- Roles ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('seller','admin','agency'));
alter table public.profiles add column if not exists agency_service text;

create or replace function public.is_agency() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'agency');
$$;

create or replace function public.protect_profile_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.role := old.role;
    new.trial_started_at := old.trial_started_at;
    new.goal_waived := old.goal_waived;
    new.paid_until := old.paid_until;
    new.email := old.email;
    new.agency_service := old.agency_service;
  end if;
  return new;
end $$;

-- ---------- 1) Businesses ----------
create table if not exists public.businesses (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name        text not null check (length(trim(name)) between 2 and 60),
  category    text not null default '' check (length(category) <= 40),
  page_url    text not null default '' check (length(page_url) <= 300),
  description text not null default '' check (length(description) <= 500),
  city        text not null default '' check (length(city) <= 40),
  logo_url    text not null default '' check (length(logo_url) <= 500),
  created_at  timestamptz not null default now()
);
create index if not exists businesses_owner_idx on public.businesses(owner_id, created_at);

create or replace function public.guard_business() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.owner_id := auth.uid();
    if (select count(*) from public.businesses where owner_id = auth.uid()) >= 5 then
      raise exception 'You can have up to 5 businesses';
    end if;
  else
    new.owner_id := old.owner_id; new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists businesses_guard on public.businesses;
create trigger businesses_guard before insert or update on public.businesses
  for each row execute function public.guard_business();

create table if not exists public.business_products (
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (business_id, product_id)
);

create or replace function public.owns_business(bid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.businesses where id = bid and owner_id = auth.uid());
$$;

-- Orders belong to a business
alter table public.orders add column if not exists business_id uuid references public.businesses(id) on delete restrict;
create index if not exists orders_business_idx on public.orders(business_id);

create or replace function public.prepare_order() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.products;
begin
  select * into p from public.products where id = new.product_id and active;
  if not found then raise exception 'This product is not available'; end if;
  if new.unit_price < p.min_price then
    raise exception 'Selling price must be at least EGP %', p.min_price;
  end if;
  if not public.is_admin() then
    if new.business_id is null
       or not exists (select 1 from public.businesses b where b.id = new.business_id and b.owner_id = new.seller_id)
       or not exists (select 1 from public.business_products bp where bp.business_id = new.business_id and bp.product_id = new.product_id) then
      raise exception 'Add this product to your business first';
    end if;
    new.status := 'pending';
  end if;
  new.wholesale_price := p.wholesale_price;
  new.delivered_at := case when new.status = 'delivered' then now() else null end;
  return new;
end $$;

create or replace function public.guard_order_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'delivered' and old.status is distinct from 'delivered' then new.delivered_at := now(); end if;
  if public.is_admin() then return new; end if;
  if old.status = 'pending' and new.status = 'cancelled' then
    new.unit_price := old.unit_price; new.quantity := old.quantity;
    new.wholesale_price := old.wholesale_price; new.product_id := old.product_id;
    new.seller_id := old.seller_id; new.delivered_at := old.delivered_at; new.business_id := old.business_id;
    return new;
  end if;
  raise exception 'Only pending orders can be cancelled';
end $$;

-- Costs can belong to a business
alter table public.seller_expenses add column if not exists business_id uuid references public.businesses(id) on delete set null;

-- ---------- 2) Agencies on service requests ----------
alter table public.service_requests add column if not exists business_id uuid references public.businesses(id) on delete set null;
alter table public.service_requests add column if not exists agency_id uuid references public.profiles(id) on delete set null;
create index if not exists service_requests_agency_idx on public.service_requests(agency_id, created_at desc);

create or replace function public.force_new_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then new.status := 'new'; new.agency_id := null; end if;
  return new;
end $$;

-- Agencies may only change the status of requests assigned to them.
create or replace function public.guard_request_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return new; end if;
  new.user_id := old.user_id; new.service := old.service; new.details := old.details; new.budget := old.budget;
  new.business_id := old.business_id; new.agency_id := old.agency_id; new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists service_requests_guard on public.service_requests;
create trigger service_requests_guard before update on public.service_requests
  for each row execute function public.guard_request_update();

-- ---------- 3) Chat ----------
create table if not exists public.request_messages (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete cascade,
  sender_id  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body       text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists request_messages_idx on public.request_messages(request_id, created_at);

create table if not exists public.chat_reads (
  request_id uuid not null references public.service_requests(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (request_id, user_id)
);

create or replace function public.can_chat(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.service_requests r where r.id = rid and (r.user_id = auth.uid() or r.agency_id = auth.uid()));
$$;

-- Hide contact details so deals stay inside Forsa (admin messages are not changed).
create or replace function public.prepare_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.sender_id := auth.uid();
  new.created_at := now();
  if not public.is_admin() then
    new.body := regexp_replace(new.body, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[hidden]', 'g');
    new.body := regexp_replace(new.body, '(https?://)?(www\.)?(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|whatsapp\.com|t\.me|telegram\.me)\S*', '[hidden]', 'gi');
    new.body := regexp_replace(new.body, '\+?[0-9٠-٩][0-9٠-٩ .-]{8,}[0-9٠-٩]', '[hidden]', 'g');
  end if;
  return new;
end $$;
drop trigger if exists request_messages_prepare on public.request_messages;
create trigger request_messages_prepare before insert on public.request_messages
  for each row execute function public.prepare_message();

-- Unread messages per request for the current user.
create or replace function public.unread_counts() returns table (request_id uuid, unread bigint)
language sql stable security definer set search_path = public as $$
  select m.request_id, count(*)
    from public.request_messages m
    join public.service_requests r on r.id = m.request_id
    left join public.chat_reads cr on cr.request_id = m.request_id and cr.user_id = auth.uid()
   where m.sender_id <> auth.uid()
     and (r.user_id = auth.uid() or r.agency_id = auth.uid() or public.is_admin())
     and m.created_at > coalesce(cr.read_at, '-infinity'::timestamptz)
   group by m.request_id;
$$;

-- ---------- Row Level Security ----------
alter table public.businesses enable row level security;
drop policy if exists "business read" on public.businesses;
create policy "business read" on public.businesses for select using (
  owner_id = auth.uid() or public.is_admin()
  or exists (select 1 from public.service_requests r where r.business_id = businesses.id and r.agency_id = auth.uid()));
drop policy if exists "business create" on public.businesses;
create policy "business create" on public.businesses for insert with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists "business update" on public.businesses;
create policy "business update" on public.businesses for update using (owner_id = auth.uid() or public.is_admin());
drop policy if exists "business delete" on public.businesses;
create policy "business delete" on public.businesses for delete using (owner_id = auth.uid() or public.is_admin());

alter table public.business_products enable row level security;
drop policy if exists "bp read" on public.business_products;
create policy "bp read" on public.business_products for select using (public.owns_business(business_id) or public.is_admin());
drop policy if exists "bp add" on public.business_products;
create policy "bp add" on public.business_products for insert with check (public.owns_business(business_id) or public.is_admin());
drop policy if exists "bp remove" on public.business_products;
create policy "bp remove" on public.business_products for delete using (public.owns_business(business_id) or public.is_admin());

drop policy if exists "requests read" on public.service_requests;
create policy "requests read" on public.service_requests for select using (user_id = auth.uid() or agency_id = auth.uid() or public.is_admin());
drop policy if exists "requests create" on public.service_requests;
create policy "requests create" on public.service_requests for insert
  with check (user_id = auth.uid() and (business_id is null or public.owns_business(business_id)));
drop policy if exists "requests admin update" on public.service_requests;
drop policy if exists "requests update" on public.service_requests;
create policy "requests update" on public.service_requests for update using (agency_id = auth.uid() or public.is_admin());

drop policy if exists "expenses create" on public.seller_expenses;
create policy "expenses create" on public.seller_expenses for insert
  with check ((seller_id = auth.uid() and request_id is null and not created_by_admin and (business_id is null or public.owns_business(business_id))) or public.is_admin());
drop policy if exists "expenses update" on public.seller_expenses;
create policy "expenses update" on public.seller_expenses for update
  using ((seller_id = auth.uid() and not created_by_admin) or public.is_admin())
  with check ((seller_id = auth.uid() and request_id is null and not created_by_admin and (business_id is null or public.owns_business(business_id))) or public.is_admin());

alter table public.request_messages enable row level security;
drop policy if exists "messages read" on public.request_messages;
create policy "messages read" on public.request_messages for select using (public.can_chat(request_id));
drop policy if exists "messages send" on public.request_messages;
create policy "messages send" on public.request_messages for insert with check (public.can_chat(request_id));

alter table public.chat_reads enable row level security;
drop policy if exists "reads own" on public.chat_reads;
create policy "reads own" on public.chat_reads for all using (user_id = auth.uid()) with check (user_id = auth.uid() and public.can_chat(request_id));

-- ---------- Business logos (each seller uploads into their own folder) ----------
insert into storage.buckets (id, name, public) values ('business-logos', 'business-logos', true) on conflict (id) do nothing;
drop policy if exists "logos own upload" on storage.objects;
create policy "logos own upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'business-logos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "logos own update" on storage.objects;
create policy "logos own update" on storage.objects for update to authenticated
  using (bucket_id = 'business-logos' and (storage.foldername(name))[1] = auth.uid()::text);

grant select, insert, update, delete on public.businesses, public.business_products, public.request_messages, public.chat_reads to authenticated;
grant execute on all functions in schema public to authenticated;
