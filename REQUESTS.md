# Change requests from Advisor mode

Agreed with Ahmed in Advisor mode on 12 Oct 2026 (full reasoning: "Forsa_Business_Decisions.docx").
**Status (13 Oct 2026):** R4, R5, R6, R7 and a new version of the 3-pieces rule are BUILT in version 1.7 (see PROGRESS.md).
The EGP 100 option was removed. Part 2 (free AI advisor in My Business) is next.

## ⚠️ Open problems to solve (on hold — do not build)
1. **Preventing personal purchases** (sellers buying products for themselves through Forsa, competing with real sellers).
   Partly handled in v1.7 (13 Oct 2026): profit is held until 3 delivered pieces, and orders to the seller's own number
   never count toward 3 (their profit is still paid once unlocked). Still open: a seller can use a friend's number.
   On hold since 12 Oct 2026 until a fuller solution is found. R1, R2 and R3 below are the ideas discussed so far
   (approval gate, hold the money, self-orders at full price, own-number check) — **none are approved for building yet.**
   When Ahmed asks "what problems do we have to solve?", mention this one first.
Everything else in the app stays as it is (no new tabs, Make your own unchanged).

---

## R1. Seller approval gate (ready products only) — ON HOLD (part of open problem 1)
- A new seller signs up, creates a business with its page link (Instagram / Facebook / TikTok / online shop),
  then taps **"Apply to sell"**.
- Until approved: they can browse products but cannot add them or place orders. Make your own needs **no** approval.
- Admin → new "Applications" list: business name, page link (opens), seller info → **Approve** / **Reject** (with a short reason).
- The bar is **seriousness, not followers**: a new page with few followers is fine if it is a real selling page.
- Rejected sellers see the reason plus a short guide ("Create your page in 10 minutes: name, logo, 3 product posts")
  and can apply again.

## R2. Hold the money, not the package (replaces the "on hold" orders rule) — ON HOLD (part of open problem 1)
- Remove "on hold" orders. Every ready-product order goes to Forsa right away (status `pending`).
- A seller's **profit** from ready products is **locked** until, in the current cycle, **3 pieces are delivered**.
  Orders to the seller's **own registered phone number do not count** (checked automatically; formats like 010… / +2010… are matched).
- When reached: all locked profit is released into the normal weekly payout, and the seller is **unlocked for 30 days**
  (profit released normally during that time).
- After 30 days: locked again, count starts from 0, **or** pay EGP 100 (admin approves) to unlock profit for 30 days.
- The seller's own custom products (Make your own) stay outside this rule.
- Enforce in the database; mirror in the app. Migrate existing `on_hold` orders to `pending`.
- Update all texts (How it works, intro slide 3, Home card, Plan page, product notice, Admin → Sellers) in English and Arabic.

## R3. Ordering for yourself is allowed, at the full price — ON HOLD (part of open problem 1)
- No blocking. A seller may order for himself, but the price is never below the minimum price
  (which already includes the profit margin) — the same as any customer pays.
- Orders to his own phone number never count toward the 3 pieces in R2.
- **Self-orders never pay profit, even after unlocking** (a purchase, not a sale) — recommended; confirm with Ahmed when building.

## R4. Payout details in My Account
- Seller adds how to receive money: method (bank account / InstaPay / Vodafone Cash) and the details
  (bank name + account holder + account/IBAN, or InstaPay address, or Vodafone Cash number).
- Only the seller and admin can see them. Admin sees them when recording a payout.
- Suggested (decide when building): Vodafone Cash / InstaPay must be on the seller's registered phone number,
  so sellers register their real number (makes the own-number check in R2 reliable).
- Home: balance card shows how withdrawal works ("Paid every week to your InstaPay ...") and a link
  to add payout details if missing.

## R5. Market price on products
- Admin product form: new "Market price" field.
- Minimum price must be at least 90% of market price (warning if not); suggested price = market price by default.

## R6. Forsa fee shown openly
- Forsa keeps **10% of the seller's profit** on delivered ready-product orders (on top of the Forsa margin
  already built into the product price).
- Show it openly: on the product page profit calculator, on each order, in Earnings and Analytics
  ("Forsa fee: 10% of your profit"). Seller balances and Admin → Sellers use profit after the fee.
- Keep the percentage in one setting (config) so it can change later.

## R7. Forsa percentage on Make-your-own deals
- Admin quote form: add a "Forsa %" field. **No default** — Ahmed sets the percentage manually for each deal.
- The quote shows the factory price and Forsa's share separately in Admin; the seller sees one total price.

---

## Next (Part 2): free AI advisor in My Business — waiting for Ahmed's Gemini API key
- "Get advice" button gives a short report for that business; the seller can also ask a question. Each = 1 Gemini request.
- Daily limit per seller = a setting (start at 5; Ahmed can change it to 3, 10… without an app update).
- Use the lightest model (Gemini Flash-Lite) for the highest free limit. Free limits are per Google project
  (roughly 100–1,000 requests/day and 5–15/minute in 2026; check the real numbers in Google AI Studio).
  With 5 per seller: 100/day ≈ 20 heavy users (50–100 realistic); 1,000/day ≈ 200 heavy users (500–1,000 realistic).
- When the minute or day limit is reached, show "try again later" and the normal smart tips; nothing else breaks.
- Runs in a Supabase Edge Function; the key is a Supabase secret Ahmed saves himself. Send only anonymous numbers
  (free plan data may be used by Google). Move to paid billing when sellers grow.

## Removed after discussion
- Forsa team calling every customer (too costly). Order confirmation will be automatic later (courier or WhatsApp/SMS).
- The "at least 2 different customers" condition (the approval gate makes it unnecessary).

## Later (not now)
- Cheating alerts in Admin: same customer phone used repeatedly by one seller, a customer phone that belongs to
  another seller, or many "different" customers at the same address.
- Automatic order confirmation (courier or WhatsApp/SMS) to reduce refused orders.
- Shipping paid in advance by the customer (for new sellers / risky orders) — after courier contracts are signed.
- Return costs taken only from the seller's existing balance (never negative) — after courier contracts.
- AI analytics and business advisor monthly subscription.
