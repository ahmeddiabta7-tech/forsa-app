// @ts-nocheck
// Forsa AI media buyer — Supabase Edge Function "meta-ads" (Facebook / Instagram ads for the seller).
// Settings: "Verify JWT" OFF (Facebook's login redirect has no Forsa login). Every action checks the seller's own login
// token itself, except the Facebook callback (protected by a one-time state) and the daily review (protected by a
// secret that only the database and the scheduled job know).
//
//   GET  .../meta-ads/callback?code&state         Facebook login comes back here → token saved (encrypted) → back to the app
//   POST { action: 'login_url', business_id }     → { url } to open Facebook's own login window
//   POST { action: 'publish', plan_id }           → publish the approved plan on the seller's page from his ad account
//   POST { action: 'review', plan_id }            → read results now and apply the AI's rules (pause weak ads…)
//   POST { action: 'scale', plan_id, pct }        → the seller approved a budget increase (10–50%)
//   POST { action: 'stop', plan_id }              → pause everything
//   POST { action: 'disconnect' }                 → pause running ads, remove Forsa's access on Facebook, delete the token
//   POST { action: 'review_all' } + x-cron-secret → daily review of every running ad (scheduled job) — or by an admin
//
// Secrets: META_APP_ID, META_APP_SECRET (required); META_GRAPH_VERSION (default v24.0); META_LOGIN_CONFIG_ID (optional,
// for "Facebook Login for Business"); APP_URL. The access token is stored ENCRYPTED with a key made from META_APP_SECRET.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const DEFAULT_VERSION = 'v24.0';
const DEFAULT_APP_URL = 'https://ahmeddiabta7-tech.github.io/forsa-app/';
const SCOPES = 'ads_management,ads_read,pages_show_list,pages_read_engagement,pages_manage_ads,business_management';
const DAY = 864e5;
const MSG_TO_ORDER = 0.3; // about 30% of message conversations become orders (Egypt e-commerce, playbook)
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const uuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
const num = (v) => Number(v) || 0;
const r2 = (n) => Math.round(n * 100) / 100;

// ---------- Token encryption (AES-GCM, key from the Meta app secret) ----------
async function keyFrom(secret) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`forsa-meta-token-v1:${secret}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function encryptToken(token, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(secret), new TextEncoder().encode(token)));
  const out = new Uint8Array(iv.length + ct.length); out.set(iv); out.set(ct, iv.length);
  return `v1.${b64(out)}`;
}
export async function decryptToken(enc, secret) {
  if (!String(enc || '').startsWith('v1.')) throw new Error('bad token');
  const all = unb64(enc.slice(3));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, await keyFrom(secret), all.slice(12));
  return new TextDecoder().decode(pt);
}

// ---------- What Forsa sends to Meta for a plan ----------
export const OBJECTIVE_MAP = {
  website_sales: { objective: 'OUTCOME_TRAFFIC', optimization_goal: 'LINK_CLICKS', destination_type: 'WEBSITE' },
  messages: { objective: 'OUTCOME_ENGAGEMENT', optimization_goal: 'CONVERSATIONS', destination_type: 'MESSENGER' },
  engagement_then_sales: { objective: 'OUTCOME_ENGAGEMENT', optimization_goal: 'CONVERSATIONS', destination_type: 'MESSENGER' },
};

// Link on the ad: the seller's Forsa website with the plan id, so every order is credited to this ad.
export function trackedLink(appUrl, slugLink, planId) {
  const m = String(slugLink || '').match(/#\/s\/([a-z0-9-]+)/);
  if (!m) return '';
  return `${appUrl.replace(/\/?$/, '/')}?fad=${planId}#/s/${m[1]}`;
}

export function targetingFor(plan, regionKeys, interestIds) {
  const a = plan.audience || {};
  const geo = regionKeys.length ? { regions: regionKeys.map((key) => ({ key })) } : { countries: ['EG'] };
  const t = { geo_locations: geo, age_min: Math.max(18, num(a.age_min) || 18), age_max: Math.min(65, num(a.age_max) || 65), targeting_automation: { advantage_audience: 0 } };
  if (a.gender === 'men') t.genders = [1];
  if (a.gender === 'women') t.genders = [2];
  if (interestIds.length) t.flexible_spec = [{ interests: interestIds.map((id) => ({ id })) }];
  return t;
}

export function creativeFor(ad, { pageId, imageHash, link, objective, igUserId }) {
  const msg = objective !== 'website_sales';
  const linkData = {
    image_hash: imageHash, message: ad.primary_text, name: ad.headline,
    link: msg ? 'https://fb.com/messenger_doc/' : link,
    call_to_action: msg ? { type: 'MESSAGE_PAGE', value: { app_destination: 'MESSENGER' } } : { type: ad.cta === 'ORDER_NOW' ? 'ORDER_NOW' : 'SHOP_NOW', value: { link } },
  };
  const spec = { page_id: pageId, link_data: linkData };
  if (igUserId) spec.instagram_user_id = igUserId;
  return { object_story_spec: spec };
}

// ---------- The AI's daily rules (playbook section 7), as plain code ----------
// insights: [{ ad_id, spend, impressions, clicks, messages }]; orders: { orders, delivered, returned }
export function decide({ plan, meta, insights, orders, now }) {
  const be = Math.max(1, num(plan.math?.break_even_cpa));
  const msg = plan.objective !== 'website_sales';
  const published = Date.parse(meta.published_at || 0) || now;
  const days = (now - published) / DAY;
  const ended = meta.end_time && now >= Date.parse(meta.end_time);
  const byId = Object.fromEntries((insights || []).map((x) => [x.ad_id, x]));
  const ads = (meta.ads || []).map((a) => ({ ...a, ...(byId[a.id] ? { spend: num(byId[a.id].spend), impressions: num(byId[a.id].impressions), clicks: num(byId[a.id].clicks), messages: num(byId[a.id].messages) } : {}) }));
  const total = ads.reduce((s, a) => ({ spend: s.spend + num(a.spend), impressions: s.impressions + num(a.impressions), clicks: s.clicks + num(a.clicks), messages: s.messages + num(a.messages) }),
    { spend: 0, impressions: 0, clicks: 0, messages: 0 });
  const realOrders = num(orders?.orders);
  // Estimated orders: real Forsa orders from the ad link; for message ads, messages x 30% (until real orders are higher).
  const estOrders = msg ? Math.max(realOrders, total.messages * MSG_TO_ORDER) : realOrders;
  const cpa = estOrders > 0 ? total.spend / estOrders : null;
  const notes = []; const pause = [];
  const active = ads.filter((a) => a.status !== 'PAUSED');
  const eff = (a) => (msg ? (a.messages ? a.spend / (a.messages * MSG_TO_ORDER) : Infinity) : (a.clicks ? a.spend / a.clicks : Infinity));

  if (!ended && days >= 2) {
    for (const a of active) {
      const s = num(a.spend);
      if (s < be) continue; // not enough data on this ad yet
      const noResult = msg ? num(a.messages) === 0 : num(a.clicks) < 3;
      const weakCtr = !msg && num(a.impressions) >= 1500 && num(a.clicks) / num(a.impressions) < 0.004;
      const tooExpensive = msg && days >= 3 && num(a.messages) > 0 && eff(a) > 1.5 * be;
      if ((s >= 2 * be && noResult) || weakCtr || tooExpensive) pause.push(a.id);
    }
    // Always keep the best ad that really ran (ads Meta never showed don't count as "still running").
    const delivered = active.filter((a) => num(a.spend) > 0);
    if (pause.length && pause.length >= delivered.length) {
      const best = [...delivered].sort((x, y) => eff(x) - eff(y))[0];
      const i = pause.indexOf(best.id); if (i >= 0) pause.splice(i, 1);
    }
    for (const id of pause) { const a = ads.find((x) => x.id === id); notes.push({ code: 'paused_weak_ad', angle: a.angle }); }
  }

  let status = 'running'; let recommendation = null;
  if (ended) { status = 'done'; notes.push({ code: 'finished' }); }
  else if (days >= 2 && total.spend >= 3 * be && estOrders === 0) {
    status = 'stopped'; notes.push({ code: 'stopped_no_results' });
    recommendation = { type: 'rethink' };
  } else if (days >= 3 && cpa != null && cpa <= 0.7 * be) {
    recommendation = { type: 'scale', pct: 20 };
  }
  const best = ads.filter((a) => num(a.spend) > 0).sort((x, y) => eff(x) - eff(y));
  const results = {
    spend: Math.round(total.spend), impressions: total.impressions, clicks: total.clicks, messages: total.messages,
    ctr: total.impressions ? r2((total.clicks / total.impressions) * 100) : 0, orders: realOrders, delivered: num(orders?.delivered), returned: num(orders?.returned),
    cpa: cpa != null ? Math.round(cpa) : null, cost_per_message: msg && total.messages ? Math.round(total.spend / total.messages) : null,
    best_angle: best[0]?.angle || null, worst_angle: best.length > 1 ? best[best.length - 1].angle : null, days: Math.max(0, Math.round(days * 10) / 10),
  };
  const lessons = status !== 'running' && best.length && total.spend >= be
    ? [{ category: plan.category || 'All', evidence: 1,
        lesson: `${plan.product_name || 'Product'} (EGP ${plan.math?.price}, ${msg ? 'messages' : 'website'}): best angle "${best[0].angle}"${results.cpa ? `, about EGP ${results.cpa} per order` : ''}${best.length > 1 ? `; weakest "${best[best.length - 1].angle}"` : ''}. Spent EGP ${results.spend}.` }]
    : [];
  const newAds = ads.map((a) => ({ id: a.id, angle: a.angle, creative_id: a.creative_id, status: pause.includes(a.id) || status !== 'running' ? 'PAUSED' : a.status || 'ACTIVE',
    spend: num(a.spend), impressions: num(a.impressions), clicks: num(a.clicks), messages: num(a.messages) }));
  return { status, pause, notes, recommendation, results, lessons, ads: newAds };
}

// ---------- Handler ----------
export function createHandler({ url, anon, appId, appSecret, version = DEFAULT_VERSION, configId = '', appUrl = DEFAULT_APP_URL, fetchFn = fetch, now = () => Date.now() }) {
  const G = `https://graph.facebook.com/${version}`;
  const redirectUri = `${url}/functions/v1/meta-ads/callback`;

  async function rest(token, path, opts = {}) {
    const res = await fetchFn(`${url}/rest/v1/${path}`, {
      method: opts.method || 'GET',
      headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) { const e = new Error(data?.message || `REST ${res.status}`); e.status = res.status; throw e; }
    return data;
  }
  async function graph(path, params = {}, method = 'GET') {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) q.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    const res = method === 'GET'
      ? await fetchFn(`${G}/${path}?${q}`)
      : await fetchFn(`${G}/${path}`, { method, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: q.toString() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) {
      const e = new Error(data?.error?.error_user_msg || data?.error?.message || `Facebook error ${res.status}`);
      e.code = 'meta'; e.meta = { code: data?.error?.code, sub: data?.error?.error_subcode, type: data?.error?.type }; throw e;
    }
    return data;
  }
  const back = (hash) => new Response(null, { status: 302, headers: { Location: `${appUrl.replace(/\/?$/, '/')}#${hash}` } });

  async function sellerToken(token) {
    const rows = await rest(token, 'rpc/meta_token', { method: 'POST', body: {} });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row?.token_enc) { const e = new Error('Connect Facebook first'); e.code = 'not_connected'; throw e; }
    if (row.expires_at && Date.parse(row.expires_at) < now()) { const e = new Error('Your Facebook connection expired. Connect again.'); e.code = 'expired'; throw e; }
    return decryptToken(row.token_enc, appSecret);
  }

  async function imageBytes(imageUrl) {
    const u = /^https:\/\//.test(imageUrl) ? imageUrl : new URL(String(imageUrl || '').replace(/^\//, ''), appUrl).toString();
    const r = await fetchFn(u);
    if (!r.ok) throw new Error('Could not load the product photo');
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) throw new Error('The product photo is too big');
    return b64(buf);
  }

  async function lookupRegions(fb, govs) {
    const keys = [];
    for (const g of govs || []) {
      const r = await graph('search', { type: 'adgeolocation', location_types: ['region'], country_code: 'EG', q: g, limit: 5, access_token: fb }).catch(() => ({ data: [] }));
      const hit = (r.data || []).find((x) => x.country_code === 'EG' && x.type === 'region') || (r.data || [])[0];
      if (hit?.key && !keys.includes(String(hit.key))) keys.push(String(hit.key));
    }
    return keys;
  }
  async function lookupInterests(fb, names) {
    const ids = [];
    for (const n of (names || []).slice(0, 3)) {
      const r = await graph('search', { type: 'adinterest', q: n, limit: 1, access_token: fb }).catch(() => ({ data: [] }));
      if (r.data?.[0]?.id) ids.push(String(r.data[0].id));
    }
    return ids;
  }

  async function publish(token, userId, planId) {
    const [row] = await rest(token, `ad_plans?id=eq.${planId}&owner_id=eq.${userId}&select=*`);
    if (!row) return json(404, { code: 'not_found' });
    if (row.status !== 'approved') return json(409, { code: 'not_approved' });
    if (row.meta?.campaign_id) return json(409, { code: 'already_published' });
    const [link] = await rest(token, `meta_links?business_id=eq.${row.business_id}&select=page_id,ad_account_id,currency`);
    if (!link) return json(400, { code: 'no_page', message: 'Choose your Facebook page and ad account first' });
    const fb = await sellerToken(token);
    const plan = row.plan || {};
    const acct = await graph(link.ad_account_id, { fields: 'currency,account_status,name', access_token: fb });
    if (acct.account_status !== 1) return json(400, { code: 'account_inactive', message: 'Your ad account is not active. Check it on Facebook (payment method or a disabled account).' });
    if (acct.currency !== 'EGP') return json(400, { code: 'currency', message: `Your ad account uses ${acct.currency}. Forsa's AI needs an ad account in Egyptian pounds (EGP).` });
    const map = OBJECTIVE_MAP[plan.objective] || OBJECTIVE_MAP.messages;
    const site = plan.objective === 'website_sales' ? trackedLink(appUrl, plan.link, row.id) : '';
    if (plan.objective === 'website_sales' && !site) return json(400, { code: 'no_site' });
    const days = Math.max(1, num(plan.budget?.days) || 5);
    const total = Math.max(50, num(plan.budget?.total) || num(plan.budget?.daily) * days);
    const start = new Date(now() + 5 * 60e3); const end = new Date(start.getTime() + days * DAY);
    const name = `Forsa AI · ${String(plan.product_name || 'Product').slice(0, 40)} · ${start.toISOString().slice(0, 10)}`;
    const pageInfo = await graph(link.page_id, { fields: 'instagram_business_account', access_token: fb }).catch(() => ({}));
    let campaignId = null;
    try {
      const [regions, interests, bytes] = await Promise.all([
        plan.audience?.all_egypt ? [] : lookupRegions(fb, plan.audience?.governorates), lookupInterests(fb, plan.audience?.interests), imageBytes(plan.image_url)]);
      const img = await graph(`${link.ad_account_id}/adimages`, { bytes, access_token: fb }, 'POST');
      const imageHash = Object.values(img.images || {})[0]?.hash;
      if (!imageHash) throw new Error('Facebook did not accept the product photo');
      const camp = await graph(`${link.ad_account_id}/campaigns`, { name, objective: map.objective, status: 'PAUSED', special_ad_categories: [], is_adset_budget_sharing_enabled: false, access_token: fb }, 'POST');
      campaignId = camp.id;
      const adset = await graph(`${link.ad_account_id}/adsets`, {
        name: `${name} · audience`, campaign_id: campaignId, lifetime_budget: total * 100, start_time: start.toISOString(), end_time: end.toISOString(),
        billing_event: 'IMPRESSIONS', optimization_goal: map.optimization_goal, bid_strategy: 'LOWEST_COST_WITHOUT_CAP', destination_type: map.destination_type,
        promoted_object: map.destination_type === 'WEBSITE' ? undefined : { page_id: link.page_id },
        targeting: targetingFor(plan, regions, interests), status: 'PAUSED', access_token: fb }, 'POST');
      const ads = [];
      for (const [i, ad] of (plan.ads || []).entries()) {
        const cr = await graph(`${link.ad_account_id}/adcreatives`, { name: `${name} · ${i + 1}`, ...creativeFor(ad, { pageId: link.page_id, imageHash, link: site, objective: plan.objective, igUserId: pageInfo?.instagram_business_account?.id }), access_token: fb }, 'POST');
        const a = await graph(`${link.ad_account_id}/ads`, { name: `${name} · ${i + 1} · ${String(ad.angle || '').slice(0, 30)}`, adset_id: adset.id, creative: { creative_id: cr.id }, status: 'PAUSED', access_token: fb }, 'POST');
        ads.push({ id: a.id, creative_id: cr.id, angle: ad.angle, status: 'ACTIVE' });
      }
      // Everything is ready: switch on (ads, then the audience, then the campaign).
      for (const a of ads) await graph(a.id, { status: 'ACTIVE', access_token: fb }, 'POST');
      await graph(adset.id, { status: 'ACTIVE', access_token: fb }, 'POST');
      await graph(campaignId, { status: 'ACTIVE', access_token: fb }, 'POST');
      const meta = { campaign_id: campaignId, adset_id: adset.id, ad_account_id: link.ad_account_id, page_id: link.page_id, ads, image_hash: imageHash,
        published_at: new Date(now()).toISOString(), end_time: end.toISOString(), lifetime_budget: total, link: site, regions, notes: [], recommendation: null };
      const saved = await rest(token, 'rpc/ad_plan_update_live', { method: 'POST', body: { p_plan: row.id, p_status: 'running', p_meta: meta, p_results: { spend: 0 } } });
      return json(200, { plan: saved });
    } catch (e) {
      if (campaignId) await graph(campaignId, { access_token: fb }, 'DELETE').catch(() => {}); // clean up a half-made campaign
      throw e;
    }
  }

  async function readInsights(fb, campaignId) {
    const r = await graph(`${campaignId}/insights`, { level: 'ad', date_preset: 'maximum', fields: 'ad_id,spend,impressions,clicks,actions', limit: 50, access_token: fb });
    return (r.data || []).map((x) => ({ ad_id: x.ad_id, spend: num(x.spend), impressions: num(x.impressions), clicks: num(x.clicks),
      messages: num((x.actions || []).find((a) => a.action_type === 'onsite_conversion.messaging_conversation_started_7d')?.value) }));
  }

  // Review one running plan with a Facebook token; pause weak ads; returns what to save.
  async function reviewPlan(fb, row, orders) {
    const meta = row.meta || {};
    const insights = await readInsights(fb, meta.campaign_id);
    const plan = { ...(row.plan || {}), category: row.plan?.category };
    const d = decide({ plan, meta, insights, orders, now: now() });
    for (const id of d.pause) await graph(id, { status: 'PAUSED', access_token: fb }, 'POST').catch(() => {});
    if (d.status !== 'running') await graph(meta.campaign_id, { status: 'PAUSED', access_token: fb }, 'POST').catch(() => {});
    const newMeta = { ...meta, ads: d.ads, notes: [...(meta.notes || []), ...d.notes.map((n) => ({ ...n, at: new Date(now()).toISOString() }))].slice(-20),
      recommendation: d.recommendation, reviewed_at: new Date(now()).toISOString() };
    return { status: d.status, meta: newMeta, results: d.results, lessons: d.lessons };
  }

  async function ownPlan(token, userId, planId) {
    const [row] = await rest(token, `ad_plans?id=eq.${planId}&owner_id=eq.${userId}&select=*`);
    return row;
  }

  return async function handle(req) {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    const u = new URL(req.url);
    if (!appId || !appSecret) return json(503, { code: 'meta_not_ready' });

    // ---- Facebook login callback (no Forsa login here) ----
    if (req.method === 'GET' && u.pathname.endsWith('/callback')) {
      const state = u.searchParams.get('state') || ''; const code = u.searchParams.get('code') || '';
      if (!/^[0-9a-f]{48}$/.test(state)) return back('/ads/fb-error');
      if (!code) return back('/ads/fb-cancelled');
      try {
        const short = await graph('oauth/access_token', { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code });
        const long = await graph('oauth/access_token', { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: short.access_token }).catch(() => short);
        const fb = long.access_token || short.access_token;
        const me = await graph('me', { fields: 'id,name', access_token: fb });
        const pages = await graph('me/accounts', { fields: 'id,name,instagram_business_account', limit: 100, access_token: fb }).catch(() => ({ data: [] }));
        const accts = await graph('me/adaccounts', { fields: 'id,name,currency,account_status', limit: 100, access_token: fb }).catch(() => ({ data: [] }));
        const expires = long.expires_in ? new Date(now() + num(long.expires_in) * 1000).toISOString() : new Date(now() + 55 * DAY).toISOString();
        const done = await rest(anon, 'rpc/meta_complete', { method: 'POST', body: {
          p_state: state, p_fb_user_id: me.id, p_fb_name: me.name, p_token_enc: await encryptToken(fb, appSecret), p_expires: expires,
          p_pages: (pages.data || []).map((p) => ({ id: String(p.id), name: String(p.name || '').slice(0, 120), ig: p.instagram_business_account?.id || null })),
          p_accounts: (accts.data || []).map((a) => ({ id: String(a.id), name: String(a.name || '').slice(0, 120), currency: a.currency || '', status: a.account_status })) } });
        return back('/ads/fb-connected');
      } catch (e) {
        console.error(`meta callback: ${String(e?.message || e).slice(0, 160)}`);
        return back('/ads/fb-error');
      }
    }
    if (req.method !== 'POST') return json(405, { code: 'method' });
    let body = {}; try { body = await req.json(); } catch (_) { return json(400, { code: 'bad_request' }); }

    try {
      // ---- Daily review: scheduled job (database secret) or an admin ----
      if (body.action === 'review_all') {
        const secret = req.headers.get('x-cron-secret') || '';
        const caller = secret ? anon : (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
        if (!caller) return json(401, { code: 'auth' });
        const queue = await rest(caller, 'rpc/ad_review_queue', { method: 'POST', body: { p_secret: secret } });
        let reviewed = 0; let failed = 0;
        for (const row of queue || []) {
          try {
            const fb = await decryptToken(row.token_enc, appSecret);
            const out = await reviewPlan(fb, row, row.order_counts);
            await rest(caller, 'rpc/ad_review_save', { method: 'POST', body: { p_secret: secret, p_plan: row.plan_id, p_status: out.status, p_meta: out.meta, p_results: out.results, p_lessons: out.lessons } });
            reviewed += 1;
          } catch (e) { failed += 1; console.error(`review ${row.plan_id}: ${String(e?.message || e).slice(0, 120)}`); }
        }
        return json(200, { reviewed, failed });
      }

      // ---- Seller actions: his own login ----
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      if (!token || token === anon) return json(401, { code: 'auth' });
      const ur = await fetchFn(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
      if (!ur.ok) return json(401, { code: 'auth' });
      const user = await ur.json();
      if (!user?.id) return json(401, { code: 'auth' });

      if (body.action === 'login_url') {
        if (body.business_id && !uuid(body.business_id)) return json(400, { code: 'bad_request' });
        const state = await rest(token, 'rpc/meta_start', { method: 'POST', body: { p_business: body.business_id || null } });
        const q = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, state, response_type: 'code' });
        if (configId) q.set('config_id', configId); else q.set('scope', SCOPES);
        return json(200, { url: `https://www.facebook.com/${version}/dialog/oauth?${q}` });
      }
      if (body.action === 'disconnect') {
        const running = await rest(token, `ad_plans?owner_id=eq.${user.id}&status=eq.running&select=meta`).catch(() => []);
        const fb = await sellerToken(token).catch(() => null);
        if (fb) {
          for (const r of running || []) if (r.meta?.campaign_id) await graph(r.meta.campaign_id, { status: 'PAUSED', access_token: fb }, 'POST').catch(() => {});
          await graph('me/permissions', { access_token: fb }, 'DELETE').catch(() => {});
        }
        await rest(token, 'rpc/meta_disconnect', { method: 'POST', body: {} });
        return json(200, { ok: true });
      }
      if (!uuid(body.plan_id)) return json(400, { code: 'bad_request' });
      if (body.action === 'publish') return await publish(token, user.id, body.plan_id);

      const row = await ownPlan(token, user.id, body.plan_id);
      if (!row) return json(404, { code: 'not_found' });
      if (row.status !== 'running' || !row.meta?.campaign_id) return json(409, { code: 'not_running' });
      const fb = await sellerToken(token);
      if (body.action === 'review') {
        const orders = await rest(token, 'rpc/ad_plan_orders', { method: 'POST', body: { p_plan: row.id } }).catch(() => ({}));
        const out = await reviewPlan(fb, row, orders);
        const saved = await rest(token, 'rpc/ad_plan_update_live', { method: 'POST', body: { p_plan: row.id, p_status: out.status, p_meta: out.meta, p_results: out.results } });
        return json(200, { plan: saved });
      }
      if (body.action === 'scale') {
        const pct = Math.min(50, Math.max(10, Math.round(num(body.pct) || 20)));
        const adset = await graph(row.meta.adset_id, { fields: 'lifetime_budget', access_token: fb });
        const add = Math.round(num(row.meta.lifetime_budget) * pct / 100);
        await graph(row.meta.adset_id, { lifetime_budget: num(adset.lifetime_budget) + add * 100, access_token: fb }, 'POST');
        const meta = { ...row.meta, lifetime_budget: num(row.meta.lifetime_budget) + add, recommendation: null,
          notes: [...(row.meta.notes || []), { code: 'scaled', pct, egp: add, at: new Date(now()).toISOString() }].slice(-20) };
        const saved = await rest(token, 'rpc/ad_plan_update_live', { method: 'POST', body: { p_plan: row.id, p_status: 'running', p_meta: meta, p_results: null } });
        return json(200, { plan: saved });
      }
      if (body.action === 'stop') {
        await graph(row.meta.campaign_id, { status: 'PAUSED', access_token: fb }, 'POST');
        const meta = { ...row.meta, notes: [...(row.meta.notes || []), { code: 'stopped_by_you', at: new Date(now()).toISOString() }].slice(-20), recommendation: null };
        const saved = await rest(token, 'rpc/ad_plan_update_live', { method: 'POST', body: { p_plan: row.id, p_status: 'stopped', p_meta: meta, p_results: null } });
        return json(200, { plan: saved });
      }
      return json(400, { code: 'bad_request' });
    } catch (e) {
      console.error(`meta-ads: ${e?.code || ''} ${String(e?.message || e).slice(0, 200)}`);
      if (e?.code === 'meta') return json(400, { code: 'meta', message: String(e.message).slice(0, 300) });
      if (e?.code === 'not_connected' || e?.code === 'expired') return json(400, { code: e.code, message: e.message });
      return json(503, { code: 'unavailable' });
    }
  };
}

if (typeof Deno !== 'undefined') {
  Deno.serve(createHandler({
    url: Deno.env.get('SUPABASE_URL'),
    anon: Deno.env.get('SUPABASE_ANON_KEY'),
    appId: Deno.env.get('META_APP_ID'),
    appSecret: Deno.env.get('META_APP_SECRET'),
    version: Deno.env.get('META_GRAPH_VERSION') || DEFAULT_VERSION,
    configId: Deno.env.get('META_LOGIN_CONFIG_ID') || '',
    appUrl: Deno.env.get('APP_URL') || DEFAULT_APP_URL,
  }));
}
