# Forsa app (Version 1)

Mobile-first web app for Forsa: sellers pick products from verified Egyptian factories, set their price, and earn on every delivered order. English and Arabic.

- **Live app:** https://ahmeddiabta7-tech.github.io/forsa-app/
- **Backend:** Supabase (database, login, product photos). Setup script: `supabase/schema.sql` and example products in `supabase/seed.sql`.
- **Code:** React, bundled with esbuild. `src/pages` holds the screens, `src/lib/api.js` all data access.

## Build
```
node build.mjs     # outputs to docs/, which GitHub Pages publishes
```

## Make someone an admin
In the Supabase SQL editor:
The profile protection rule blocks role changes, so pause it for this one update:
```sql
begin;
alter table public.profiles disable trigger profiles_protect;
update public.profiles set role = 'admin' where email = 'their@email.com';
alter table public.profiles enable trigger profiles_protect;
commit;
```
