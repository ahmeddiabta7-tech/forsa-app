// Minimal Supabase client: authentication, database (REST) and storage, using fetch only.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

const KEY = 'forsa-session';
let session = null;
const listeners = new Set();

function load() {
  try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { session = null; }
}
function save(s) {
  session = s;
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  listeners.forEach((fn) => fn(session));
}
load();

export const isConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const getSession = () => session;
export const onAuthChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

function withExpiry(data) {
  return { ...data, expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600) };
}

async function authFetch(path, body, method = 'POST', token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg = data.msg || data.error_description || data.message || data.error || 'Request failed';
    const err = new Error(msg); err.status = res.status; err.code = data.error_code || data.code; throw err;
  }
  return data;
}

let refreshing = null;
async function refresh() {
  if (!session?.refresh_token) return null;
  if (!refreshing) {
    refreshing = authFetch('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
      .then((d) => { save(withExpiry(d)); return session; })
      .catch(() => { save(null); return null; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function token() {
  if (!session) return null;
  if (session.expires_at - 60 < Date.now() / 1000) await refresh();
  return session?.access_token || null;
}

export const auth = {
  async signUp({ email, password, meta, redirectTo }) {
    const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
    const d = await authFetch(`signup${q}`, { email, password, data: meta });
    if (d.access_token) { save(withExpiry(d)); return { session: true }; }
    return { session: false }; // email confirmation required
  },
  async signIn({ email, password }) {
    const d = await authFetch('token?grant_type=password', { email, password });
    save(withExpiry(d));
  },
  async signOut() {
    const t = session?.access_token;
    save(null);
    if (t) { try { await authFetch('logout', null, 'POST', t); } catch { /* already signed out */ } }
  },
  async sendReset(email, redirectTo) {
    await authFetch(`recover?redirect_to=${encodeURIComponent(redirectTo)}`, { email });
  },
  async setPassword(password) {
    await authFetch('user', { password }, 'PUT', await token());
  },
  // Handles links from Supabase emails (#access_token=...&type=recovery|signup)
  consumeUrlSession() {
    const h = window.location.hash;
    if (!h.includes('access_token=')) return null;
    const p = new URLSearchParams(h.replace(/^#\/?/, ''));
    const s = { access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: Number(p.get('expires_in') || 3600), user: null };
    if (!s.access_token) return null;
    save(withExpiry(s));
    history.replaceState(null, '', window.location.pathname);
    return p.get('type');
  },
  async user() {
    const d = await authFetch('user', null, 'GET', await token());
    if (session) save({ ...session, user: d });
    return d;
  },
};

// ---------- Database ----------
async function rest(path, { method = 'GET', body, prefer } = {}, retried = false) {
  const t = await token();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${t || SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !retried && session) { await refresh(); return rest(path, { method, body, prefer }, true); }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.message || 'Request failed'); err.status = res.status; err.code = data?.code; throw err;
  }
  return data;
}

export const db = {
  select: (table, query = 'select=*') => rest(`${table}?${query}`),
  insert: (table, row) => rest(table, { method: 'POST', body: row, prefer: 'return=representation' }).then((r) => r?.[0]),
  update: (table, match, patch) => rest(`${table}?${match}`, { method: 'PATCH', body: patch, prefer: 'return=representation' }).then((r) => r?.[0]),
  remove: (table, match) => rest(`${table}?${match}`, { method: 'DELETE', prefer: 'return=representation' }),
};

// ---------- Storage ----------
export const storage = {
  async upload(bucket, path, file) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${await token()}`, 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'true' },
      body: file,
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || 'Upload failed'); }
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
  },
};
