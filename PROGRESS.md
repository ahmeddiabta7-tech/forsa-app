# Progress

## Version 1.2 — built (Oct 2026)
- Monthly rule: months are 30-day blocks from signup. Deliver 3 orders in a month → next month free.
  Fewer than 3 → account pauses until an EGP 100 payment is approved (unlocks 30 days). First month is open.
  Enforced in the database (`can_sell`) and mirrored in the app (`planState` in `src/core.jsx`). Only delivered orders count (`orders.delivered_at`).
- "How it works" explanation on Home, Plan page, Welcome and intro.
- Seller costs in Analytics (ads, marketing, packaging, delivery, other): add / edit / delete; net profit everywhere.
  Admin → Services can add what a seller paid for a service as a cost (shows "Added by Forsa", seller can't edit it).
- Bottom bar: Home · Products · Orders · Analytics · Services · Ideas. Account (profile, plan, earnings, admin) is the person icon at the top.
- Database update: `supabase/v1_2.sql`.

## Version 1.1 — built (Oct 2026)
- Design: "Ivory Editorial" — warm white pages, black type (Inter / IBM Plex Sans Arabic), black cards for key numbers.
- Opening animation on every launch ("Forsa" + فرصة, ~1.5s, fades into the app).
- 3 intro slides for first-time visitors (Skip / Next, shown once).
- New Home: greeting, balance card with Month 1 tracker, This week / Month / All time, profit mini-chart, orders card with a smart tip.
- Clear EN | ع switch at the top of every main screen.
- Ideas is its own tab, with an explanation, 5 tips, and guided fields (customer, money, needs).
- Analytics: profit chart, revenue vs costs, units sold, best sellers, return rate, order status, free smart tips.
  Tips come from rules in `src/lib/advisor.js`; `getAdvice()` is the single place to plug in an AI advisor later
  (it would receive only `buildSummary()` — anonymous numbers).
- Services: marketing agency and media buying, with Request form; requests appear in Admin → Services (new / contacted / done).
  Add a service: add its key to `SERVICES` in `src/lib/i18n.js` plus `svc_<key>` and `svc_<key>_d` text.
- Admin: delete products (with confirmation). Products with orders can only be hidden.
- Database update: `supabase/v1_1.sql` (also appended to `schema.sql`).

## Version 1 — built
- Welcome, sign up, log in, forgot password (English / Arabic, right-to-left).
- Seller: product catalog with photos and profit calculator, copy-ready social post, create order (cash on delivery), my orders with status and cancel, earnings and payouts, plan & subscription payments (InstaPay / Vodafone Cash reference), profile.
- Admin: orders (change status), products (add/edit, photo upload, hide), subscription payments (approve/reject), sellers (balances, record payouts), ideas.
- Database security: sellers only see their own data; prices below the minimum are rejected; sellers cannot change their own plan or role.

## Next
- Real InstaPay / Vodafone Cash receiving details in `src/config.js`.
- Proper email service before inviting many sellers (free tier sends ~2–3 emails/hour).
- New-order notifications; courier integration.
- AI advisor (Gemini free tier through a Supabase Edge Function, daily limit per seller).
- App Store / Google Play wrapping.
