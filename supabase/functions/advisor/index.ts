// @ts-nocheck
// Forsa AI advisor — Supabase Edge Function "advisor".
// The app calls it with the seller's login token. It reads ONLY that seller's own data (row-level security
// applies, no service key), turns it into anonymous numbers (no names, phones or addresses), asks Google
// Gemini (free tier) for short advice, saves the conversation and uses 1 of the seller's 5 daily answers.
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

export function buildSummary({ orders, expenses, businesses, profile, businessId, now = Date.now() }) {
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
      : { status: 'locked', pieces_delivered_toward_3: Math.min(3, counted) },
  };
}

export function systemPrompt(lang) {
  return [
    'You are "Forsa AI advisor", a friendly, practical business coach inside the Forsa app in Egypt.',
    'Forsa sellers are mostly university students and young people who sell products on social media (Instagram, Facebook, TikTok, WhatsApp) with cash on delivery. Forsa stores, ships, collects the cash and pays them every week.',
    'Forsa rules: the seller\'s profit is held until 3 pieces are delivered, then the account is unlocked for 30 days. Forsa keeps 10% of the seller\'s profit on ready products. Sellers can also make their own brand with Forsa partner factories.',
    'Use ONLY the seller numbers you are given. Never invent numbers. If there is little or no data, give practical first steps for a new seller.',
    'Answer in at most 120 words: 3 to 5 short bullet points with concrete actions (what to post and when, which product to push, price, how to reduce returns or cancelled orders, costs), then one final line starting with "Next step:" (or "الخطوة الجاية:" in Arabic).',
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
          body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.6, maxOutputTokens: 700 } }),
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
      const [orders, expenses, businesses, profiles, history] = await Promise.all([
        rest(token, `orders?select=status,quantity,unit_price,wholesale_price,fee_pct,own_order,profit_locked,created_at,products(name_en,category,owner_id)&seller_id=eq.${user.id}${bizFilter}&order=created_at.desc&limit=500`),
        rest(token, `seller_expenses?select=amount,category,spent_on&seller_id=eq.${user.id}${bizFilter}&limit=500`),
        rest(token, `businesses?select=id,category&owner_id=eq.${user.id}`),
        rest(token, `profiles?select=unlocked_until&id=eq.${user.id}`),
        rest(token, `ai_messages?select=role,body&user_id=eq.${user.id}${businessId ? `&business_id=eq.${businessId}` : '&business_id=is.null'}&order=created_at.desc&limit=6`),
      ]);
      if (businessId && !businesses.some((b) => b.id === businessId)) return json(400, { code: 'business' });

      const summary = buildSummary({ orders, expenses, businesses, profile: profiles[0], businessId, now: now() });
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
