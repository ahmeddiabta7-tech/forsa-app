// @ts-nocheck
// Forsa AI advisor — Supabase Edge Function "advisor".
// The app calls it with the seller's login token. It reads ONLY that seller's own data (row-level security
// applies, no service key), turns it into anonymous numbers (no names, phones or addresses), asks Google
// Gemini (free tier) for short advice, saves the conversation and uses 1 of the seller's 5 daily answers
// (admin accounts are unlimited for testing; see v1_10.sql).
// Secrets (Supabase → Edge Functions → Secrets): GEMINI_API_KEY (required), GEMINI_MODEL (optional).
// SUPABASE_URL and SUPABASE_ANON_KEY are provided by Supabase automatically.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const DEFAULT_MODEL = 'gemini-flash-lite-latest';
const GEMINI_TIMEOUT_MS = 20000;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const round = (n) => Math.round(Number(n) || 0);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const qty = (o) => Number(o.quantity) || 1;
const gross = (o) => (o.unit_price - o.wholesale_price) * qty(o);
const fee = (o) => Math.round(Math.max(0, gross(o)) * (Number(o.fee_pct) || 0) / 100);

// ---------- Anonymous summary of the seller's numbers ----------
function stats(orders, expenses) {
  const by = (s) => orders.filter((o) => o.status === s);
  const delivered = by('delivered');
  const returned = by('returned');
  const revenue = delivered.reduce((s, o) => s + o.unit_price * qty(o), 0);
  const cost = delivered.reduce((s, o) => s + o.wholesale_price * qty(o), 0);
  const fees = delivered.reduce((s, o) => s + fee(o), 0);
  const other = expenses.reduce((s, x) => s + Number(x.amount || 0), 0);
  const units = delivered.reduce((s, o) => s + qty(o), 0);
  return {
    orders: orders.filter((o) => o.status !== 'cancelled').length,
    delivered: delivered.length, returned: returned.length, cancelled: by('cancelled').length,
    waiting: orders.filter((o) => ['pending', 'confirmed', 'shipped'].includes(o.status)).length,
    pieces_delivered: units,
    sales_egp: round(revenue), product_cost_egp: round(cost), forsa_fee_egp: round(fees),
    profit_egp: round(revenue - cost - fees), other_costs_egp: round(other), net_profit_egp: round(revenue - cost - fees - other),
    return_rate_pct: pct(returned.length, delivered.length + returned.length),
    avg_selling_price_egp: units ? round(revenue / units) : 0,
    avg_profit_per_piece_egp: units ? round((revenue - cost - fees) / units) : 0,
  };
}

export function buildSummary({ orders, expenses, businesses, profile, payouts = [], businessId, now = Date.now() }) {
  const DAY = 864e5;
  const since = now - 30 * DAY;
  const recent = orders.filter((o) => new Date(o.created_at).getTime() >= since);
  const recentExp = expenses.filter((x) => new Date(`${x.spent_on}T12:00:00Z`).getTime() >= since);
  const products = new Map();
  orders.filter((o) => o.status !== 'cancelled').forEach((o) => {
    const name = o.products?.name_en || 'Product';
    const p = products.get(name) || { product: name, category: o.products?.category || '', own_brand: Boolean(o.products?.owner_id), pieces: 0, returns: 0, profit_egp: 0, min_price_sold_egp: null };
    p.pieces += qty(o);
    if (o.status === 'returned') p.returns += 1;
    if (o.status === 'delivered') p.profit_egp += gross(o) - fee(o);
    p.min_price_sold_egp = p.min_price_sold_egp == null ? o.unit_price : Math.min(p.min_price_sold_egp, o.unit_price);
    products.set(name, p);
  });
  const costs = {};
  recentExp.forEach((x) => { costs[x.category] = (costs[x.category] || 0) + Number(x.amount || 0); });
  const last = orders.reduce((m, o) => Math.max(m, new Date(o.created_at).getTime()), 0);
  const until = profile?.unlocked_until ? new Date(profile.unlocked_until).getTime() : 0;
  const counted = orders.filter((o) => o.status === 'delivered' && o.profit_locked && !o.own_order).reduce((s, o) => s + qty(o), 0);
  const biz = businessId ? businesses.find((b) => b.id === businessId) : null;
  const check = accountCheck({ orders, businesses, profile, payouts, businessId, now, unlocked: until > now, counted, products: [...products.values()] });
  return {
    scope: biz ? 'one business' : 'all businesses',
    business_category: biz?.category || undefined,
    businesses_count: businesses.length,
    last_30_days: stats(recent, recentExp),
    all_time: stats(orders, expenses),
    top_products: [...products.values()].sort((a, b) => b.pieces - a.pieces).slice(0, 5).map((p) => ({ ...p, profit_egp: round(p.profit_egp) })),
    costs_last_30_days_egp: Object.fromEntries(Object.entries(costs).map(([k, v]) => [k, round(v)])),
    days_since_last_order: last ? Math.floor((now - last) / DAY) : null,
    profit_rule: until > now
      ? { status: 'unlocked', days_left: Math.ceil((until - now) / DAY) }
      : { status: 'locked', pieces_delivered_toward_3: Math.min(3, counted), pieces_still_needed: Math.max(0, 3 - counted) },
    locked_profit_egp: check.locked_profit_egp,
    account_age_days: check.account_age_days,
    paid_to_seller_egp: check.paid_egp,
    days_since_last_payout: check.days_since_last_payout,
    problems: check.problems,
    wins: check.wins,
  };
}

// ---------- Account check: problems to fix and wins to celebrate (codes + numbers only) ----------
export function accountCheck({ orders, businesses, profile, payouts = [], businessId, now, unlocked, counted, products }) {
  const DAY = 864e5;
  const age = (o) => (now - new Date(o.updated_at || o.created_at).getTime()) / DAY;
  const problems = [];
  const wins = [];
  const add = (code, info = {}) => problems.push({ code, ...info });

  const stuckPending = orders.filter((o) => o.status === 'pending' && age(o) > 2).length;
  const stuckConfirmed = orders.filter((o) => o.status === 'confirmed' && age(o) > 3).length;
  const stuckShipped = orders.filter((o) => o.status === 'shipped' && age(o) > 7).length;
  if (stuckPending) add('orders_waiting_confirmation_over_2_days', { orders: stuckPending });
  if (stuckConfirmed) add('orders_confirmed_not_shipped_over_3_days', { orders: stuckConfirmed });
  if (stuckShipped) add('orders_shipped_not_delivered_over_7_days', { orders: stuckShipped });

  const recent = orders.filter((o) => now - new Date(o.created_at).getTime() <= 30 * DAY);
  const done = recent.filter((o) => o.status === 'delivered' || o.status === 'returned');
  const returned = done.filter((o) => o.status === 'returned').length;
  if (done.length >= 4 && returned / done.length >= 0.25) add('high_return_rate_last_30_days', { pct: Math.round((returned / done.length) * 100) });
  const cancelled = recent.filter((o) => o.status === 'cancelled').length;
  if (recent.length >= 4 && cancelled / recent.length >= 0.3) add('many_cancelled_orders_last_30_days', { pct: Math.round((cancelled / recent.length) * 100) });
  products.filter((p) => p.returns >= 2).slice(0, 3).forEach((p) => add('product_with_many_returns', { product: p.product, returns: p.returns }));

  const lockedProfit = orders.filter((o) => o.status === 'delivered' && o.profit_locked && !o.profit_released_at)
    .reduce((sum, o) => sum + gross(o) - fee(o), 0);
  if (!unlocked && lockedProfit > 0) add('profit_locked_until_3_pieces', { locked_profit_egp: round(lockedProfit), pieces_still_needed: Math.max(0, 3 - counted) });
  const until = profile?.unlocked_until ? new Date(profile.unlocked_until).getTime() : 0;
  if (unlocked && until - now <= 5 * DAY) add('unlock_period_ends_soon', { days_left: Math.max(0, Math.ceil((until - now) / DAY)) });

  const delivered = orders.filter((o) => o.status === 'delivered');
  if (!profile?.payout_method && delivered.length) add('payout_details_missing');

  const last = orders.reduce((m, o) => Math.max(m, new Date(o.created_at).getTime()), 0);
  const ageDays = profile?.created_at ? Math.floor((now - new Date(profile.created_at).getTime()) / DAY) : null;
  if (!orders.length && !businesses.length) add('no_business_yet');
  else if (!orders.length && (ageDays == null || ageDays >= 3)) add('no_orders_yet', { account_age_days: ageDays });
  else if (last && now - last >= 7 * DAY) add('no_new_orders_for_days', { days: Math.floor((now - last) / DAY) });
  if (!businessId && businesses.length > 1) {
    const quiet = businesses.filter((b) => !recent.some((o) => o.business_id === b.id)).length;
    if (quiet) add('businesses_without_orders_last_30_days', { businesses: quiet });
  }

  const thisMonth = delivered.filter((o) => now - new Date(o.delivered_at || o.updated_at || o.created_at).getTime() <= 30 * DAY);
  if (thisMonth.length) wins.push({ code: 'orders_delivered_last_30_days', orders: thisMonth.length });
  if (unlocked) wins.push({ code: 'account_unlocked' });
  else if (counted > 0) wins.push({ code: 'progress_toward_3_pieces', pieces: Math.min(3, counted) });
  const best = [...products].sort((a, b) => b.profit_egp - a.profit_egp)[0];
  if (best && best.profit_egp > 0) wins.push({ code: 'best_product', product: best.product, profit_egp: round(best.profit_egp) });
  const paid = payouts.reduce((s, x) => s + Number(x.amount || 0), 0);
  if (paid > 0) wins.push({ code: 'money_received_from_forsa', egp: round(paid) });
  const lastPay = payouts.reduce((m, x) => Math.max(m, new Date(x.paid_at).getTime()), 0);
  return {
    problems, wins, locked_profit_egp: round(lockedProfit), account_age_days: ageDays, paid_egp: round(paid),
    days_since_last_payout: lastPay ? Math.floor((now - lastPay) / DAY) : null,
  };
}

export function systemPrompt(lang) {
  return [
    'You are "Forsa AI advisor", the seller\'s personal business coach inside the Forsa app in Egypt. You are warm, positive and motivating, like an older brother or sister who believes in them, but always honest and practical.',
    '',
    'ABOUT FORSA (فرصة = "opportunity"):',
    '- Mission: help Egyptian youth and university students start their own business with or without capital, and learn real business by doing it. Anyone who wants to start can join; students are the main focus.',
    '- Way 1, ready products: the seller adds products from verified Egyptian suppliers to their business (factory names are hidden behind codes), sets their own selling price (not below the minimum price), and shares on Instagram, Facebook, TikTok and WhatsApp. When a customer orders, the seller places the order in the app. Forsa ships, collects cash on delivery and pays the seller (InstaPay / Vodafone Cash). The seller keeps no stock and pays nothing up front.',
    '- Profit per piece = selling price - wholesale price. Forsa keeps 10% of that profit on ready products. Shipping is charged per governorate.',
    '- Way 2, make your own product (own brand): through Forsa partner manufacturers (shown by code). Request, quote, deposit, sample, production, then it goes live. Forsa takes no 10% on the seller\'s own products.',
    '- Around the seller: My Business (up to 5 businesses, each with products, analytics and costs), Services (marketing and media-buying partners), Messages, Ideas (submit ideas for incubation), and you, the AI advisor.',
    '- Order steps: pending (Forsa confirms with the customer) -> confirmed -> shipped -> delivered (or returned / cancelled). Returns and cancelled orders usually come from customers who did not really want the product or got a wrong address or price.',
    '- The 3-pieces rule (also called the 3 orders rule): the seller can sell and place orders normally from day one; only the PROFIT is locked (held safely, not lost). When 3 pieces are delivered to real customers, the locked profit is released and the account is unlocked for 30 days: during those 30 days the seller can take the profit of every delivered order, even a single order. After the 30 days, the seller repeats the step (3 delivered pieces) to unlock the next 30 days. Orders to the seller\'s own phone number do not count toward the 3 pieces. The rule protects real sales and stops people from only buying for themselves.',
    '- When the seller asks about the 3 orders / 3 pieces rule, the profit lock or withdrawing money: the FIRST bullet must say clearly that the profit is locked until 3 pieces are delivered, and that after that it opens for 30 days. Then explain the rest simply.',
    '',
    'THE SELLER\'S ACCOUNT: with every message you get an anonymous JSON of this seller\'s own account (orders, profit, costs, the 3-pieces progress, locked profit, payouts). "problems" lists issues found in the account and "wins" lists good news. Use them:',
    '- If there are problems and the seller asks for general advice, start with the most important problem in plain words and exactly how to fix it (for example: orders waiting for confirmation -> make sure the customer phone is right and tell the customer Forsa will call; many returns -> confirm size, price and address on WhatsApp before ordering; payout details missing -> add them in Account -> "How you get paid" so Forsa can send your money; profit locked -> how many pieces are still needed to unlock it).',
    '- If the seller asks something specific, answer it first; mention a serious problem in one short line at the end.',
    '- Celebrate real wins with the real numbers. Never invent numbers, wins or problems. If there is little or no data, treat them as a new seller and give clear first steps.',
    '- You can only read the account; you cannot change orders or payments. For a problem only the Forsa team can fix (a stuck shipment, a missing payment), tell the seller to contact the Forsa team.',
    '',
    'STYLE: answer in at most 150 words: 3 to 5 short bullet points with concrete actions (what to post and when, which product to push, price, how to reduce returns or cancelled orders, costs), then one final line starting with "Next step:" (or "الخطوة الجاية:" in Arabic). Add one short encouraging sentence when it fits, never empty hype. Use **bold** only for the key number or action.',
    'PLANS: if the seller asks for a business plan or a marketing / content plan, ignore the 150-word limit and write a simple plan of up to 380 words. Use short section titles in **bold** on their own line (no # headings), each followed by short bullet points. Base it on their real numbers and products when they have them.',
    '- Simple business plan sections: **Your business** (what you sell and to whom), **Your customer** (age, where they are online, what they care about), **Price and profit** (selling price, profit per piece after the 10% Forsa fee, using their numbers or the product prices they mention), **How you will sell** (organic channels), **Monthly goal** (pieces and profit, realistic for a beginner), **First 30 days** (week-by-week steps).',
    '- Marketing / content plan sections, ORGANIC ONLY (never paid ads, boosting or paying influencers): **Content ideas** (3 to 4 content pillars, e.g. product in use, before/after, customer reviews, behind the scenes, tips), **Weekly posting plan** (day by day for one week: Reel/TikTok, post, story, WhatsApp status, with the best time to post in Egypt, usually 7-11 PM), **Hooks and captions** (3 ready hooks and 1 sample caption with a clear call to action and "cash on delivery"), **Free growth tips** (replying fast to comments and DMs, stories with polls and questions, university and family WhatsApp groups, asking happy customers for a photo review, collaborating with friends\' pages), **What to measure** (views, messages, orders each week).',
    '- End every plan with the "Next step:" line.',
    'Money is in EGP. Do not ask for or mention personal data. Do not suggest leaving Forsa or contacting factories directly. If the question is not about selling or the business, answer in one sentence and bring it back to the business.',
    lang === 'ar' ? 'Reply in simple Egyptian Arabic.' : 'Reply in simple, clear English.',
  ].join('\n');
}

export const DEFAULT_QUESTION = { en: 'Give me advice for my business', ar: 'اديني نصيحة لمشروعي' };

// ---------- Handler (dependencies passed in, so it can be tested) ----------
export function createHandler({ url, anon, geminiKey, model = DEFAULT_MODEL, fetchFn = fetch, now = () => Date.now() }) {
  async function rest(token, path, opts = {}) {
    const res = await fetchFn(`${url}/rest/v1/${path}`, {
      method: opts.method || 'GET',
      headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.prefer ? { Prefer: opts.prefer } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) { const e = new Error(data?.message || `REST ${res.status}`); e.status = res.status; throw e; }
    return data;
  }

  async function askGemini(system, contents) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);
      try {
        const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.6, maxOutputTokens: 1600 } }),
        });
        if ((res.status === 429 || res.status >= 500) && attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        if (!res.ok) return null;
        const data = await res.json();
        const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
        return text || null;
      } catch (_) {
        if (attempt === 0) continue;
        return null;
      } finally { clearTimeout(timer); }
    }
    return null;
  }

  return async function handle(req) {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json(405, { code: 'method' });
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token || token === anon) return json(401, { code: 'auth' });

    let user;
    try {
      const r = await fetchFn(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
      if (!r.ok) return json(401, { code: 'auth' });
      user = await r.json();
    } catch (_) { return json(503, { code: 'ai_unavailable' }); }
    if (!user?.id) return json(401, { code: 'auth' });

    let body = {};
    try { body = await req.json(); } catch (_) { body = {}; }
    const lang = body.lang === 'ar' ? 'ar' : 'en';
    const question = String(body.question || '').trim().slice(0, 500);
    const businessId = typeof body.business_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.business_id) ? body.business_id : null;

    if (!geminiKey) return json(503, { code: 'ai_unavailable' });

    try {
      const left = await rest(token, 'rpc/ai_quota_left', { method: 'POST', body: {} });
      if (!(Number(left) > 0)) return json(429, { code: 'limit', remaining: 0 });

      const bizFilter = businessId ? `&business_id=eq.${businessId}` : '';
      const [orders, expenses, businesses, profiles, history, payouts] = await Promise.all([
        rest(token, `orders?select=status,quantity,unit_price,wholesale_price,fee_pct,own_order,profit_locked,profit_released_at,business_id,created_at,updated_at,delivered_at,products(name_en,category,owner_id)&seller_id=eq.${user.id}${bizFilter}&order=created_at.desc&limit=500`),
        rest(token, `seller_expenses?select=amount,category,spent_on&seller_id=eq.${user.id}${bizFilter}&limit=500`),
        rest(token, `businesses?select=id,category&owner_id=eq.${user.id}`),
        rest(token, `profiles?select=unlocked_until,payout_method,created_at&id=eq.${user.id}`),
        rest(token, `ai_messages?select=role,body&user_id=eq.${user.id}${businessId ? `&business_id=eq.${businessId}` : '&business_id=is.null'}&order=created_at.desc&limit=6`),
        rest(token, `payouts?select=amount,paid_at&seller_id=eq.${user.id}&order=paid_at.desc&limit=100`).catch(() => []),
      ]);
      if (businessId && !businesses.some((b) => b.id === businessId)) return json(400, { code: 'business' });

      const summary = buildSummary({ orders, expenses, businesses, profile: profiles[0], payouts, businessId, now: now() });
      const asked = question || DEFAULT_QUESTION[lang];
      const contents = [...history].reverse().map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.body }] }));
      contents.push({ role: 'user', parts: [{ text: `Seller numbers (JSON, anonymous):\n${JSON.stringify(summary)}\n\nSeller's message: ${asked}` }] });

      const answer = await askGemini(systemPrompt(lang), contents);
      if (!answer) return json(503, { code: 'ai_unavailable' });

      let remaining;
      try { remaining = await rest(token, 'rpc/ai_use_quota', { method: 'POST', body: {} }); }
      catch (_) { return json(429, { code: 'limit', remaining: 0 }); }

      const saved = await rest(token, 'ai_messages?select=id,role,body,business_id,created_at', {
        method: 'POST', prefer: 'return=representation',
        body: [
          { user_id: user.id, business_id: businessId, role: 'user', body: asked, created_at: new Date(now()).toISOString() },
          { user_id: user.id, business_id: businessId, role: 'assistant', body: answer.slice(0, 4000), created_at: new Date(now() + 1).toISOString() },
        ],
      });
      return json(200, { answer, remaining: Number(remaining), messages: saved });
    } catch (_) {
      return json(503, { code: 'ai_unavailable' });
    }
  };
}

if (typeof Deno !== 'undefined') {
  Deno.serve(createHandler({
    url: Deno.env.get('SUPABASE_URL'),
    anon: Deno.env.get('SUPABASE_ANON_KEY'),
    geminiKey: Deno.env.get('GEMINI_API_KEY'),
    model: Deno.env.get('GEMINI_MODEL') || DEFAULT_MODEL,
  }));
}
