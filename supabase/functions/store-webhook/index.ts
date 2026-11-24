// @ts-nocheck
// Forsa — Supabase Edge Function "store-webhook" (deploy with "Verify JWT" OFF: Shopify can't send a login token).
// Shopify calls  .../functions/v1/store-webhook?c=<connection id>&t=<connection token>  on every new order.
// This relay only passes the raw order + Shopify's signature to the database function ingest_shopify_order(),
// which checks the token and the HMAC-SHA256 signature (with the seller's Shopify signing key) before anything is saved.
// It uses the public anon key only (no service key).

const MAX_BODY = 300000;

export function createHandler({ url, anon, fetchFn = fetch }) {
  return async function handle(req) {
    if (req.method !== 'POST') return new Response('Forsa store webhook', { status: 200 });
    const u = new URL(req.url);
    const conn = u.searchParams.get('c') || '';
    const token = u.searchParams.get('t') || '';
    if (!/^[0-9a-f-]{36}$/i.test(conn) || !/^[0-9a-f]{20,100}$/i.test(token)) return new Response('unauthorized', { status: 401 });
    const topic = req.headers.get('x-shopify-topic') || '';
    if (topic && topic !== 'orders/create') return new Response('ignored', { status: 200 });
    const body = await req.text();
    if (body.length > MAX_BODY) return new Response('too large', { status: 413 });
    const hmac = req.headers.get('x-shopify-hmac-sha256') || '';
    let r;
    try {
      r = await fetchFn(`${url}/rest/v1/rpc/ingest_shopify_order`, {
        method: 'POST',
        headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_conn: conn, p_token: token, p_body: body, p_hmac: hmac }),
      });
    } catch (e) {
      console.error(`ingest request failed: ${e?.name || 'error'}`);
      return new Response('try again', { status: 503 });
    }
    const txt = await r.text();
    if (r.ok) return new Response('ok', { status: 200 });
    const msg = (() => { try { return JSON.parse(txt).message || ''; } catch { return txt; } })();
    console.error(`ingest rejected ${r.status}: ${String(msg).slice(0, 120)}`);
    if (/unauthorized|bad signature|signing key missing/.test(msg)) return new Response('unauthorized', { status: 401 });
    // Paused connection or a temporary problem: Shopify retries later, so no order is lost.
    return new Response('try again', { status: 503 });
  };
}

if (typeof Deno !== 'undefined') {
  Deno.serve(createHandler({ url: Deno.env.get('SUPABASE_URL'), anon: Deno.env.get('SUPABASE_ANON_KEY') }));
}
