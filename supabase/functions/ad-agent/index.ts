// @ts-nocheck
// Forsa AI media buyer — Supabase Edge Function "ad-agent" (pilot).
// The app calls it with the seller's login token (row-level security applies, no service key).
//   { action: 'create', business_id, product_id, answers, lang }  -> builds a new ad plan
//   { action: 'revise', plan_id, note, lang }                      -> changes a draft plan as the seller asks
// It checks the daily limit (ad_try), computes the money math itself (never trusted to the AI), looks at the product
// photo, reads the Forsa team's lessons (ad_lessons) and the playbook below, asks Google Gemini for a JSON plan and
// saves it in ad_plans. The seller approves the plan in the app.
// Secrets: GEMINI_API_KEY (required), AD_MODEL (optional, default gemini-flash-latest), APP_URL (optional).
// The playbook text between the markers is generated from playbook.md: run `node supabase/functions/ad-agent/make.mjs`.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const DEFAULT_MODEL = 'gemini-flash-latest';
const FALLBACK_MODEL = 'gemini-flash-lite-latest';
const DEFAULT_APP_URL = 'https://ahmeddiabta7-tech.github.io/forsa-app/';
const TIMEOUT_MS = 45000;
const REFUSAL = 0.75; // 20-30% of cash-on-delivery orders are refused in Egypt
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// PLAYBOOK:START
export const PLAYBOOK = `# Forsa AI Media Buyer — Playbook v1 (Nov 2026)

You are Forsa's media buyer. You run Facebook + Instagram ads for Egyptian sellers who have zero experience.
Your only goal: **real profit in the seller's pocket**. Likes, reach and cheap clicks are only tools toward sales.
You think like a senior Egyptian e-commerce media buyer, not a form-filler: you pick a strategy, explain it in one
or two simple sentences, recommend the winning move, and let the seller decide.

## 1. Hard rules (never break)
- The seller approves every ad before it goes live, and every budget increase. You only pause things by yourself.
- Never spend above the budget and end date the seller approved (also set as a hard limit inside Meta).
- **Never offer free delivery.** Never invent discounts, reviews, numbers of customers, "limited stock" or deadlines
  that are not true. Only use offers the seller actually gave.
- Respect Meta's ad rules: no "before/after" body images, no sentences that assume personal traits
  ("Are you overweight?", "Are you depressed?"), no medical or income promises, no fake buttons, no shocking images.
- Text is in **Egyptian Arabic (masri)** unless the seller asks for English or Franco. Simple, warm, short.
- Never write phone numbers, emails or the factory name in the ad. Prices in EGP.

## 2. The money math (do this before anything)
- Profit per piece = selling price − minimum (wholesale) price − Forsa fee (10% of that profit).
  For the seller's own products: price − his cost − 10% fee.
- Egypt is cash on delivery: **20–30% of COD orders are refused or returned.** Real profit per order sent
  ≈ profit per piece × 0.75.
- **Break-even cost per order (BE-CPA)** = profit per piece × 0.75. An ad is profitable only if its cost per
  order is below this. Target cost per order = 60% of BE-CPA.
- If BE-CPA is below about EGP 40, tell the seller honestly that ads will be hard to make profitable at this price,
  and suggest a better price, a bundle (2 pieces), or a different product before spending.
- Reference costs in Egypt (agency benchmarks, change by season and category — use as a sense check, never promise):
  CPM about EGP 20–45 broad, 40–80 with interests, 60–120 in Ramadan/peak; CPC about EGP 1.5–8;
  e-commerce WhatsApp conversation about EGP 5–20.

## 3. Choosing the strategy (not robotic)
Decide from the seller's situation and say why in one sentence:
- **Goal = orders, product has a clear use and a price under ~EGP 600** → Traffic/sales ad to the seller's Forsa
  website. Each order from the ad is counted by Forsa (we track the ad link), so we judge by real orders.
- **Product needs questions or trust (sizes, perfume notes, skincare, price over ~EGP 600)** → Messages ad
  (WhatsApp if his page has WhatsApp Business, otherwise Messenger) with a ready first message, e.g.
  "عايز أعرف تفاصيل [المنتج] وسعره". Remind him: reply within 5 minutes or sales are lost.
- **New page with almost no followers and the product is unknown** → suggest 2–3 days of a small engagement
  ad first (warm audience, social proof) and then switch to sales — only if the budget is at least EGP 150/day;
  under that, go straight to sales.
- Seasons: Ramadan, White Friday (Nov), back to school (Sep), Eid, Valentine's/Mother's Day (21 March) — cost goes up,
  but buying intent too. Suggest gift angles in gift seasons.

## 4. Audience (creative is the real targeting now)
- Default: **broad / Advantage+ audience** inside hard limits: Egypt, the seller's governorates (or all Egypt if
  delivery covers it), age range, gender only if the product is clearly for one gender.
- Add 1–3 interests as *suggestions* only when the product is niche (gym, gaming, babies, cars…).
- Do not stack many interests or narrow age bands; it raises cost. Small budgets: one ad set only.
- Default placements: automatic (Facebook + Instagram, feed, stories, reels).

## 5. The ad itself
- Photo: the product photo from Forsa (or the seller's own photo). No photoshoot needed. If several photos exist,
  test the clearest one first. Square or 4:5.
- Make **3 genuinely different angles** (not 3 rewordings). Each has a different **hook** — the first line that
  stops the scroll. Angle ideas:
  1. **Problem → solution**: "سماعتك بتقع من ودنك في الجيم؟"
  2. **Price / value**: "بـ 350 جنيه بس… بديل الـ 2000 جنيه"
  3. **Gift**: "هدية تفرّح أي حد بتحبه… وتوصل لحد الباب"
  4. **Student / daily life**: "رفيقك في المحاضرات والمواصلات"
  5. **Trust / COD**: "اطلب دلوقتي وادفع لما يوصلك" (true for all Forsa orders)
- Structure of the text: hook (1 line) → 2–3 short benefit lines (emoji bullets allowed, max 3 emojis) →
  price → how to order + "الدفع عند الاستلام" + delivery time. 40–90 words. Headline under 40 characters.
- Always say cash on delivery and the real delivery time. Never say free delivery.
- Call to action button: "Shop now" for website, "Send message" for messages.

## 6. Budget and testing
- Minimum test: at least 3 days AND enough budget to reach about 3× BE-CPA total, otherwise results mean nothing.
  If the seller's budget is smaller, say so and suggest a longer run with the same daily budget.
- Start: one campaign, one ad set, the 3 angles as 3 ads. Let Meta spread the budget.
- Never judge before 48 hours or before the ad spent 2× BE-CPA.

## 7. Daily review (decision rules — explain each change in one simple line)
For each ad, with data since start:
- **Kill an ad** when it spent ≥ 2× BE-CPA with no order, or its cost per order is > 1.5× BE-CPA after 3+ days.
- **Fatigue**: cost per order rising 3 days in a row while click rate falls → recommend a new angle or photo.
- **Funnel check before blaming the ad**: many clicks but no orders → check price, the product page, delivery time
  in the text; many messages but no orders → reply speed or price.
- **Scale (recommend, seller approves)**: cost per order ≤ 70% of BE-CPA for 3 days in a row → raise budget 20%
  (never more than 30% at once, at most every 2 days).
- **Stop all**: budget or end date reached, or the seller taps stop.
- Pausing is automatic; everything that spends more money waits for the seller's tap.

## 8. Memory and learning (getting smarter every week)
- After every ad ends, save a result card: category, product price band, angle, hook type, audience (governorates,
  age, gender), objective, season, spend, clicks, orders, cost per order, refused orders, profit.
- Every week, review all result cards and write short **lessons** ("Home category: gift angle got cost per order
  45% lower than price angle — 12 ads"). Keep lessons with their evidence (number of ads) and drop lessons that new
  data contradicts.
- Before creating a new ad, read the lessons for the same category and price band, and use the winners first while
  still testing one new angle.
- Admin can add winning ad examples (from Meta's public Ad Library or Forsa's own winners) as references.
  Note: Meta's Ad Library API does not return normal commercial ads in Egypt, so outside winners are collected by the
  Forsa team, not by the AI automatically.

## 9. How you talk to the seller
- Short, friendly, encouraging, Egyptian Arabic in Arabic mode. One recommendation at a time, with the reason.
- Be honest: if the product or price is weak for ads, say so and suggest a better move.
- Never promise a number of sales.
`;
// PLAYBOOK:END

export const GOVS = ['Cairo', 'Giza', 'Alexandria', 'Qalyubia', 'Sharqia', 'Dakahlia', 'Gharbia', 'Monufia', 'Beheira', 'Kafr El Sheikh',
  'Damietta', 'Port Said', 'Ismailia', 'Suez', 'Faiyum', 'Beni Suef', 'Minya', 'Asyut', 'Sohag', 'Qena', 'Luxor', 'Aswan',
  'Red Sea', 'Matrouh', 'New Valley', 'North Sinai', 'South Sinai'];
const GOALS = ['auto', 'website', 'messages'];
const AGES = ['18-24', '25-34', '35-44', '45+'];

// Seller answers -> safe, limited values.
export function cleanAnswers(a = {}, hasWebsite = false) {
  const govs = Array.isArray(a.governorates) ? a.governorates.filter((g) => GOVS.includes(g)).slice(0, 27) : [];
  const ages = Array.isArray(a.ages) ? AGES.filter((x) => a.ages.includes(x)) : [];
  let goal = GOALS.includes(a.goal) ? a.goal : 'auto';
  if (goal === 'website' && !hasWebsite) goal = 'auto';
  return {
    price: int(a.price, 1, 1000000, 0),
    goal,
    all_egypt: govs.length === 0 || a.all_egypt === true,
    governorates: govs,
    ages: ages.length ? ages : ['18-24', '25-34'],
    gender: ['all', 'men', 'women'].includes(a.gender) ? a.gender : 'all',
    offer: str(a.offer, 200),
    notes: str(a.notes, 300),
    ad_lang: ['ar', 'en'].includes(a.ad_lang) ? a.ad_lang : 'ar',
    daily: int(a.daily, 50, 100000, 150),
    days: int(a.days, 1, 60, 5),
  };
}

// The money math is computed here, never by the AI.
export function moneyMath(product, price) {
  const wholesale = Number(product.wholesale_price) || 0;
  const feePct = product.owner_id && !product.seller_made ? 0 : 10;
  const profit = Math.max(0, price - wholesale);
  const fee = Math.round(profit * feePct / 100);
  const net = profit - fee;
  const beCpa = Math.round(net * REFUSAL);
  return { price, wholesale, fee_pct: feePct, profit_per_piece: net, break_even_cpa: beCpa, target_cpa: Math.round(beCpa * 0.6),
    weak: beCpa < 40 };
}

export const AGE_RANGE = (ages) => {
  const lo = Math.min(...ages.map((a) => parseInt(a, 10)));
  const hi = ages.includes('45+') ? 65 : Math.max(...ages.map((a) => parseInt(a.split('-')[1], 10)));
  return { age_min: Math.max(18, lo), age_max: hi };
};

const PLAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    objective: { type: 'STRING', enum: ['website_sales', 'messages', 'engagement_then_sales'] },
    why: { type: 'STRING' },
    product_insight: { type: 'STRING' },
    interests: { type: 'ARRAY', items: { type: 'STRING' } },
    ads: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          angle: { type: 'STRING' }, hook: { type: 'STRING' }, primary_text: { type: 'STRING' },
          headline: { type: 'STRING' }, cta: { type: 'STRING', enum: ['SHOP_NOW', 'SEND_MESSAGE', 'LEARN_MORE', 'ORDER_NOW'] },
        },
        required: ['angle', 'hook', 'primary_text', 'headline', 'cta'],
      },
    },
    budget_advice: { type: 'STRING' },
    tips: { type: 'ARRAY', items: { type: 'STRING' } },
    warning: { type: 'STRING' },
  },
  required: ['objective', 'why', 'product_insight', 'interests', 'ads', 'budget_advice', 'tips', 'warning'],
};

export function buildPrompt({ product, business, answers, math, link, lessons, lang, previous, note }) {
  const facts = {
    business_name: business.name,
    product: { name: product.name_ar && answers.ad_lang === 'ar' ? product.name_ar : product.name_en, name_en: product.name_en,
      category: product.category, description: str(product.description_en || product.description_ar, 600), type: product.seller_made ? 'seller own product (stocked at Forsa)' : product.owner_id ? 'seller own brand (made with a Forsa manufacturer)' : 'Forsa ready product (dropshipping)' },
    money: { selling_price_egp: math.price, profit_per_piece_after_forsa_fee_egp: math.profit_per_piece, break_even_cost_per_order_egp: math.break_even_cpa,
      target_cost_per_order_egp: math.target_cpa, note: 'Computed by Forsa. Use these numbers exactly; do not recompute.' },
    seller_choices: { goal: answers.goal, where: answers.all_egypt ? 'All Egypt' : answers.governorates, ages: answers.ages, gender: answers.gender,
      offer: answers.offer || 'none (do not invent one)', extra_notes: answers.notes || '', budget_per_day_egp: answers.daily, days: answers.days,
      total_budget_egp: answers.daily * answers.days, ad_language: answers.ad_lang === 'ar' ? 'Egyptian Arabic' : 'English' },
    order_channels: { forsa_website_link: link || 'none (the seller has no published Forsa website yet, so website_sales is not possible)', messages: 'WhatsApp or Messenger on the seller page' },
    delivery: 'Cash on delivery all over Egypt; the customer pays the shipping fee (never free delivery). Delivery usually 2-5 days.',
    forsa_team_lessons: lessons.length ? lessons.map((l) => `[${l.category}${l.evidence ? `, ${l.evidence} ads` : ''}] ${l.lesson}`) : ['none yet'],
  };
  const task = previous
    ? `The seller wants changes to this draft plan. Seller's request: "${str(note, 300)}". Keep what they did not ask to change, follow the playbook, and return the full updated plan.\nCurrent plan: ${JSON.stringify(previous)}`
    : 'Build the ad plan now.';
  return [
    `FACTS (JSON): ${JSON.stringify(facts)}`,
    '',
    task,
    '',
    'Return JSON only:',
    '- objective: website_sales (only if a Forsa website link exists), messages, or engagement_then_sales. If the seller chose a goal, respect it unless impossible; if "auto", choose with the playbook.',
    '- why: one or two simple sentences for the seller explaining the strategy.',
    '- product_insight: one sentence on who buys this product and why, based on the photo and facts.',
    '- interests: 0 to 3 Meta interest suggestions in English (only if the product is niche), else [].',
    '- ads: exactly 3 ads with 3 genuinely different angles. hook = the first line of primary_text. primary_text 40-90 words, includes the price, "cash on delivery" and delivery time, no free delivery, no invented offers/reviews/stock. headline under 40 characters. Language: ' + (answers.ad_lang === 'ar' ? 'Egyptian Arabic (masri).' : 'simple English.'),
    '- budget_advice: one or two sentences: is this budget/days enough to judge (compare total budget with 3x break-even cost per order)? What to do if not.',
    '- tips: 2 to 4 short practical tips for this seller (reply speed for messages, confirming orders, etc.).',
    '- warning: an honest warning if the price/profit is weak for ads (break-even cost per order under 40 EGP) or the budget is too small, else an empty string.',
    `- Write why, product_insight, budget_advice, tips and warning in ${lang === 'ar' ? 'simple Egyptian Arabic' : 'simple English'}.`,
  ].join('\n');
}

// Keep only allowed fields and lengths from the AI answer.
export function cleanPlan(p, hasWebsite) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.ads) || p.ads.length < 1) return null;
  let objective = ['website_sales', 'messages', 'engagement_then_sales'].includes(p.objective) ? p.objective : 'messages';
  if (objective === 'website_sales' && !hasWebsite) objective = 'messages';
  const ads = p.ads.slice(0, 3).map((a) => ({
    angle: str(a.angle, 60), hook: str(a.hook, 160), primary_text: String(a.primary_text || '').trim().slice(0, 900),
    headline: str(a.headline, 60), cta: ['SHOP_NOW', 'SEND_MESSAGE', 'LEARN_MORE', 'ORDER_NOW'].includes(a.cta) ? a.cta : (objective === 'website_sales' ? 'SHOP_NOW' : 'SEND_MESSAGE'),
  })).filter((a) => a.primary_text);
  if (!ads.length) return null;
  // Never free delivery (Forsa rule), even if the model slips.
  const free = /(free\s+(delivery|shipping))|(توصيل|شحن)\s*(مجاني|مجانى|ببلاش|فري)|(الشحن|التوصيل)\s*علينا/i;
  if (ads.some((a) => free.test(a.primary_text) || free.test(a.headline))) return null;
  return {
    objective, why: str(p.why, 400), product_insight: str(p.product_insight, 300),
    interests: (Array.isArray(p.interests) ? p.interests : []).map((x) => str(x, 40)).filter(Boolean).slice(0, 3),
    ads, budget_advice: str(p.budget_advice, 400),
    tips: (Array.isArray(p.tips) ? p.tips : []).map((x) => str(x, 200)).filter(Boolean).slice(0, 4),
    warning: str(p.warning, 300),
  };
}

export function createHandler({ url, anon, geminiKey, model = DEFAULT_MODEL, appUrl = DEFAULT_APP_URL, fetchFn = fetch }) {
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

  async function photo(imageUrl) {
    if (!imageUrl) return null;
    try {
      const u = /^https:\/\//.test(imageUrl) ? imageUrl : new URL(imageUrl.replace(/^\//, ''), appUrl).toString();
      if (!/^https:\/\//.test(u)) return null;
      const r = await fetchFn(u);
      if (!r.ok) return null;
      const type = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
      if (!/^image\/(jpeg|png|webp)$/.test(type)) return null;
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length > 4 * 1024 * 1024) return null;
      let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { inlineData: { mimeType: type, data: btoa(bin) } };
    } catch (_) { return null; }
  }

  async function gemini(m, system, parts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 4096, responseMimeType: 'application/json', responseSchema: PLAN_SCHEMA } }),
      });
      if (!res.ok) { console.error(`gemini ${m} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`); return null; }
      const data = await res.json();
      const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
      try { return JSON.parse(text); } catch (_) { console.error(`gemini ${m} bad json`); return null; }
    } catch (e) { console.error(`gemini ${m} failed: ${e?.name || 'error'}`); return null; }
    finally { clearTimeout(timer); }
  }

  return async function handle(req) {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json(405, { code: 'method' });
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token || token === anon) return json(401, { code: 'auth' });
    try {
      const ur = await fetchFn(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
      if (!ur.ok) return json(401, { code: 'auth' });
      const user = await ur.json();
      if (!user?.id) return json(401, { code: 'auth' });
      let body = {}; try { body = await req.json(); } catch (_) { return json(400, { code: 'bad_request' }); }
      const lang = body.lang === 'ar' ? 'ar' : 'en';
      const action = body.action === 'revise' ? 'revise' : 'create';
      if (!geminiKey) return json(503, { code: 'ai_unavailable' });

      let previous = null; let planRow = null; let businessId = body.business_id; let productId = body.product_id; let rawAnswers = body.answers;
      if (action === 'revise') {
        if (!str(body.note, 300)) return json(400, { code: 'bad_request' });
        const rows = await rest(token, `ad_plans?id=eq.${encodeURIComponent(body.plan_id)}&owner_id=eq.${user.id}&select=*`);
        planRow = rows?.[0];
        if (!planRow) return json(404, { code: 'not_found' });
        if (planRow.status !== 'draft') return json(409, { code: 'not_draft' });
        businessId = planRow.business_id; productId = planRow.product_id; rawAnswers = planRow.answers;
        const { math: _m, ...rest0 } = planRow.plan || {}; previous = rest0;
      }
      if (!/^[0-9a-f-]{36}$/i.test(String(businessId)) || !/^[0-9a-f-]{36}$/i.test(String(productId))) return json(400, { code: 'bad_request' });
      const [biz] = await rest(token, `businesses?id=eq.${businessId}&owner_id=eq.${user.id}&select=id,name`);
      if (!biz) return json(404, { code: 'not_found' });
      const [link] = await rest(token, `business_products?business_id=eq.${businessId}&product_id=eq.${productId}&select=product_id`);
      if (!link) return json(400, { code: 'product_not_in_business' });
      const [product] = await rest(token, `products?id=eq.${productId}&select=id,name_en,name_ar,description_en,description_ar,category,image_url,wholesale_price,min_price,suggested_price,owner_id,seller_made,review_status`);
      if (!product) return json(404, { code: 'not_found' });
      const sites = await rest(token, `websites?business_id=eq.${businessId}&status=eq.approved&published=eq.true&select=slug`).catch(() => []);
      const site = sites?.[0]?.slug ? `${appUrl.replace(/\/?$/, '/')}#/s/${sites[0].slug}` : '';
      const answers = cleanAnswers(rawAnswers, !!site);
      if (!answers.price) answers.price = Number(product.suggested_price) || 0;
      if (answers.price < (Number(product.min_price) || 0)) return json(400, { code: 'price_below_min', min: Number(product.min_price) });
      const math = moneyMath(product, answers.price);

      try { await rest(token, 'rpc/ad_try', { method: 'POST', body: {} }); } catch (_) { return json(429, { code: 'limit' }); }

      const lessons = await rest(token, `ad_lessons?active=eq.true&or=(category.eq.All,category.eq.${encodeURIComponent(product.category || 'Other')})&select=category,lesson,evidence&order=evidence.desc&limit=12`).catch(() => []);
      const img = await photo(product.image_url);
      const prompt = buildPrompt({ product, business: biz, answers, math, link: site, lessons: lessons || [], lang, previous, note: body.note });
      const parts = img ? [img, { text: prompt }] : [{ text: prompt }];
      let raw = await gemini(model, PLAYBOOK, parts);
      let plan = cleanPlan(raw, !!site);
      if (!plan) { raw = await gemini(FALLBACK_MODEL, PLAYBOOK, parts); plan = cleanPlan(raw, !!site); }
      if (!plan) return json(503, { code: 'ai_unavailable' });
      const { age_min, age_max } = AGE_RANGE(answers.ages);
      const full = { ...plan, math, link: site, audience: { all_egypt: answers.all_egypt, governorates: answers.governorates, age_min, age_max, gender: answers.gender, interests: plan.interests },
        budget: { daily: answers.daily, days: answers.days, total: answers.daily * answers.days }, image_url: product.image_url, product_name: product.name_en, business_name: biz.name, used_photo: !!img };

      let saved;
      if (action === 'revise') {
        [saved] = await rest(token, `ad_plans?id=eq.${planRow.id}`, { method: 'PATCH', prefer: 'return=representation', body: { plan: full, revisions: (planRow.revisions || 0) + 1 } });
      } else {
        [saved] = await rest(token, 'ad_plans', { method: 'POST', prefer: 'return=representation', body: { owner_id: user.id, business_id: businessId, product_id: productId, answers, plan: full } });
      }
      return json(200, { plan: saved });
    } catch (e) {
      console.error(`ad-agent error: ${e?.status || ''} ${String(e?.message || e).slice(0, 160)}`);
      return json(503, { code: 'ai_unavailable' });
    }
  };
}

if (typeof Deno !== 'undefined') {
  Deno.serve(createHandler({
    url: Deno.env.get('SUPABASE_URL'),
    anon: Deno.env.get('SUPABASE_ANON_KEY'),
    geminiKey: Deno.env.get('GEMINI_API_KEY'),
    model: Deno.env.get('AD_MODEL') || DEFAULT_MODEL,
    appUrl: Deno.env.get('APP_URL') || DEFAULT_APP_URL,
  }));
}
