// All data access for the app. Uses Supabase when configured, otherwise a local demo store.
import { isConfigured, db, storage, auth, getSession } from './supa.js';
import { DEMO_PRODUCTS, DEMO_MANUFACTURERS } from './demo.js';
import { PLAN } from '../config.js';
import { GOVERNORATES } from './i18n.js';

const live = isConfigured();

// ---------- Demo store (only used when Supabase is not configured) ----------
const DKEY = 'forsa-demo-db';
function demoLoad() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DKEY) || 'null'); } catch { d = null; }
  if (!d) {
    d = {
      user: null,
      profiles: [],
      products: DEMO_PRODUCTS.map((p, i) => ({ ...p, id: `p${i + 1}`, active: true, created_at: new Date().toISOString() })),
      orders: [], payouts: [], subscription_payments: [], ideas: [], seq: 1000,
    };
  }
  if (!d.service_requests) d.service_requests = [];
  if (!d.expenses) d.expenses = [];
  ['businesses', 'business_products', 'messages', 'chat_reads', 'custom_requests', 'custom_request_costs'].forEach((k) => { if (!d[k]) d[k] = []; });
  d.orders.forEach((o) => { if (o.status === 'on_hold') o.status = 'pending'; }); // old demo data
  if (!d.shipping_rates) d.shipping_rates = GOVERNORATES.map(([g]) => ({ governorate: g, fee: 70, active: true }));
  if (!d.manufacturers) d.manufacturers = DEMO_MANUFACTURERS.map((m, i) => ({ ...m, id: `m${i + 1}`, active: true, created_at: new Date().toISOString() }));
  return d;
}
let demo = live ? null : demoLoad();
function demoSave() { try { localStorage.setItem(DKEY, JSON.stringify(demo)); } catch { /* ignore */ } }
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const now = () => new Date().toISOString();
const meId = () => demo.user;
const meProfile = () => demo.profiles.find((p) => p.id === demo.user);

// ---------- Auth ----------
export const isLive = live;

export async function signUp(form, redirectTo) {
  const meta = { full_name: form.full_name, phone: form.phone, city: form.city, user_type: form.user_type, university: form.university || null };
  if (live) return auth.signUp({ email: form.email, password: form.password, meta, redirectTo });
  if (demo.profiles.some((p) => p.email === form.email)) throw new Error('User already registered');
  const id = uid();
  demo.profiles.push({ id, email: form.email, password: form.password, ...meta, role: demo.profiles.length === 0 ? 'admin' : 'seller',
    trial_started_at: now(), goal_waived: false, paid_until: null, created_at: now() });
  demo.user = id; demoSave();
  return { session: true };
}

export async function signIn(email, password) {
  if (live) return auth.signIn({ email, password });
  const p = demo.profiles.find((x) => x.email === email && x.password === password);
  if (!p) throw new Error('Invalid login credentials');
  demo.user = p.id; demoSave();
}

export async function signOut() {
  if (live) return auth.signOut();
  demo.user = null; demoSave();
}

export const sendReset = (email, redirectTo) => (live ? auth.sendReset(email, redirectTo) : Promise.resolve());
export const setPassword = (pw) => (live ? auth.setPassword(pw) : Promise.resolve());

export function hasSession() {
  return live ? Boolean(getSession()) : Boolean(demo.user);
}

// ---------- Profile ----------
export async function getProfile() {
  if (live) {
    const s = getSession();
    let id = s?.user?.id;
    if (!id) id = (await auth.user()).id;
    const rows = await db.select('profiles', `select=*&id=eq.${id}`);
    return rows[0] || null;
  }
  const p = meProfile();
  if (!p) return null;
  const { password, ...rest } = p;
  return rest;
}

export async function updateProfile(id, patch) {
  if (live) return db.update('profiles', `id=eq.${id}`, patch);
  const me = meProfile();
  const p = { ...patch };
  if (me.role !== 'admin' && me.phone) delete p.phone; // like the database: only the Forsa team changes a saved phone
  Object.assign(me, p); demoSave(); return getProfile();
}

// Payout details (R4): how the seller receives money. Only the seller and the Forsa team can see them.
export async function savePayoutDetails(id, f) {
  const row = { payout_method: f.payout_method || null, payout_holder: (f.payout_holder || '').trim().slice(0, 100),
    payout_bank: f.payout_method === 'bank' ? (f.payout_bank || '').trim().slice(0, 100) : '', payout_account: (f.payout_account || '').trim().slice(0, 60) };
  return updateProfile(id, row);
}

// Last 10 digits of a phone (Arabic digits allowed), same as public.norm_phone in the database.
export function normPhone(p) {
  return String(p || '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\D/g, '').slice(-10);
}

// ---------- Products ----------
export async function listProducts({ all = false } = {}) {
  if (live) return db.select('products', `select=*${all ? '' : '&active=eq.true'}&order=created_at.desc`);
  return demo.products.filter((p) => all || (p.active && (!p.owner_id || p.owner_id === meId())));
}

// R5: the admin sets the minimum price; if it's empty, it is 90% of the market price (same rule in the database).
export function priceDefaults(p) {
  const market = p.market_price === '' || p.market_price == null ? null : Math.round(Number(p.market_price));
  let min = p.min_price === '' || p.min_price == null ? null : Math.round(Number(p.min_price));
  if (min == null && market) min = Math.ceil(market * PLAN.marketMinPct / 100);
  let sug = p.suggested_price === '' || p.suggested_price == null ? null : Math.round(Number(p.suggested_price));
  if (sug == null && min != null) sug = Math.max(market || min, min);
  return { market_price: market, min_price: min, suggested_price: sug };
}

export async function saveProduct(p) {
  const row = { ...p, ...priceDefaults(p) };
  ['wholesale_price', 'ship_days', 'stock'].forEach((k) => { row[k] = Number(row[k]); });
  row.quality_score = Number(row.quality_score);
  if (live) {
    const { id, created_at, ...data } = row;
    return id ? db.update('products', `id=eq.${id}`, data) : db.insert('products', data);
  }
  if (row.min_price == null) throw new Error('Enter a minimum price or a market price');
  if (row.min_price < row.wholesale_price) throw new Error(`Minimum price (EGP ${row.min_price}) is below the wholesale price (EGP ${row.wholesale_price})`);
  if (row.id) { Object.assign(demo.products.find((x) => x.id === row.id), row); demoSave(); return row; }
  const x = { ...row, id: uid(), created_at: now() }; demo.products.unshift(x); demoSave(); return x;
}

export async function uploadProductImage(file) {
  if (live) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    return storage.upload('product-images', `${uid()}.${ext}`, file);
  }
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
}

// Products that already have orders can't be deleted (only hidden), so orders keep their history.
export async function productOrderCount(id) {
  if (live) return (await db.select('orders', `select=id&product_id=eq.${id}&limit=1000`)).length;
  return demo.orders.filter((o) => o.product_id === id).length;
}

export async function deleteProduct(id) {
  if ((await productOrderCount(id)) > 0) { const e = new Error('This product has orders, so it can only be hidden.'); e.code = 'HAS_ORDERS'; throw e; }
  if (live) {
    try {
      const rows = await db.remove('products', `id=eq.${id}`);
      if (!rows || rows.length === 0) throw new Error('Product was not deleted.');
      return true;
    } catch (e) {
      if (e.code === '23503') { const er = new Error('This product has orders, so it can only be hidden.'); er.code = 'HAS_ORDERS'; throw er; }
      throw e;
    }
  }
  demo.products = demo.products.filter((p) => p.id !== id); demoSave(); return true;
}

// ---------- Orders ----------
const ORDER_SELECT = 'select=*,products(name_en,name_ar,image_url,factory_code,owner_id)';

export async function myOrders() {
  if (live) {
    const id = getSession()?.user?.id;
    return db.select('orders', `${ORDER_SELECT}&seller_id=eq.${id}&order=created_at.desc`);
  }
  return demo.orders.filter((o) => o.seller_id === meId()).map(withProduct).sort(byNewest);
}

export async function createOrder(o) {
  if (live) {
    const id = getSession()?.user?.id;
    return db.insert('orders', { ...o, seller_id: id });
  }
  const p = demo.products.find((x) => x.id === o.product_id);
  if (o.unit_price < p.min_price) throw new Error(`Selling price must be at least EGP ${p.min_price}`);
  const biz = demo.businesses.find((b) => b.id === o.business_id && b.owner_id === meId());
  if (!biz || !demo.business_products.some((bp) => bp.business_id === biz.id && bp.product_id === o.product_id)) throw new Error('Add this product to your business first');
  const rate = demo.shipping_rates.find((r) => r.governorate === o.governorate && r.active);
  if (!rate) throw new Error(`We don't deliver to ${o.governorate} yet`);
  const me = meProfile();
  const c = normPhone(o.customer_phone);
  const own = c.length === 10 && (c === normPhone(me.phone) || (['vodafone_cash', 'instapay'].includes(me.payout_method) && c === normPhone(me.payout_account)));
  const row = { ...o, product_options: String(o.product_options || '').trim().slice(0, 200), shipping_fee: rate.fee, id: uid(), order_no: ++demo.seq, seller_id: meId(), wholesale_price: p.wholesale_price, status: 'pending',
    fee_pct: p.owner_id ? 0 : PLAN.feePct, own_order: own, profit_locked: false, profit_released_at: null, created_at: now(), updated_at: now() };
  demo.orders.push(row);
  demoSave(); return { ...row };
}

// ---------- Shipping prices per governorate ----------
export async function listShippingRates() {
  if (live) return db.select('shipping_rates', 'select=*&order=governorate.asc');
  return demo.shipping_rates;
}

export async function saveShippingRate(governorate, fee, active) {
  const row = { governorate, fee: Math.round(Number(fee)), active: Boolean(active), updated_at: new Date().toISOString() };
  if (live) return db.upsert('shipping_rates', row, 'governorate');
  Object.assign(demo.shipping_rates.find((r) => r.governorate === governorate), row); demoSave(); return row;
}

export async function cancelOrder(id) {
  if (live) return db.update('orders', `id=eq.${id}`, { status: 'cancelled' });
  const o = demo.orders.find((x) => x.id === id);
  if (o.status !== 'pending') throw new Error('Only pending orders can be cancelled');
  o.status = 'cancelled'; o.updated_at = now(); demoSave(); return o;
}

// ---------- Payouts ----------
export async function myPayouts() {
  if (live) return db.select('payouts', `select=*&seller_id=eq.${getSession()?.user?.id}&order=paid_at.desc`);
  return demo.payouts.filter((p) => p.seller_id === meId()).sort((a, b) => b.paid_at.localeCompare(a.paid_at));
}

// ---------- Ideas ----------
export async function myIdeas() {
  if (live) return db.select('ideas', `select=*&user_id=eq.${getSession()?.user?.id}&order=created_at.desc`);
  return demo.ideas.filter((i) => i.user_id === meId()).sort(byNewest);
}

export async function submitIdea(i) {
  if (live) return db.insert('ideas', { ...i, user_id: getSession()?.user?.id });
  const row = { ...i, id: uid(), user_id: meId(), status: 'new', created_at: now() };
  demo.ideas.push(row); demoSave(); return row;
}

// ---------- Service requests ----------
export async function myRequests({ all = false } = {}) {
  if (live) return db.select('service_requests', `select=*,businesses(name)&user_id=eq.${getSession()?.user?.id}${all ? '' : '&service=neq.custom_product'}&order=created_at.desc`);
  return demo.service_requests.filter((r) => r.user_id === meId() && (all || r.service !== 'custom_product')).map((r) => ({ ...r, businesses: demoBiz(r.business_id) })).sort(byNewest);
}

export async function submitRequest(r) {
  if (live) return db.insert('service_requests', { ...r, user_id: getSession()?.user?.id });
  const row = { ...r, id: uid(), user_id: meId(), status: 'new', created_at: now() };
  demo.service_requests.push(row); demoSave(); return row;
}

// ---------- Seller costs (ads, marketing, packaging…) ----------
export async function myExpenses() {
  if (live) return db.select('seller_expenses', `select=*&seller_id=eq.${getSession()?.user?.id}&order=spent_on.desc,created_at.desc&limit=1000`);
  return demo.expenses.filter((x) => x.seller_id === meId()).sort((a, b) => b.spent_on.localeCompare(a.spent_on) || byNewest(a, b));
}

export async function saveExpense(x) {
  const row = { amount: Math.round(Number(x.amount)), category: x.category, note: (x.note || '').slice(0, 200), spent_on: x.spent_on };
  if (live) return x.id ? db.update('seller_expenses', `id=eq.${x.id}`, row) : db.insert('seller_expenses', { ...row, seller_id: getSession()?.user?.id });
  if (x.id) { const e = demo.expenses.find((r) => r.id === x.id); if (e.created_by_admin) throw new Error('Added by Forsa'); Object.assign(e, row); demoSave(); return e; }
  const e = { ...row, id: uid(), seller_id: meId(), request_id: null, created_by_admin: false, created_at: now() };
  demo.expenses.push(e); demoSave(); return e;
}

export async function deleteExpense(id) {
  if (live) {
    const rows = await db.remove('seller_expenses', `id=eq.${id}`);
    if (!rows || rows.length === 0) throw new Error('Not deleted');
    return true;
  }
  const e = demo.expenses.find((r) => r.id === id);
  if (!e || e.created_by_admin) throw new Error('Not deleted');
  demo.expenses = demo.expenses.filter((r) => r.id !== id); demoSave(); return true;
}

// ---------- Admin ----------
export async function adminOrders() {
  if (live) return db.select('orders', `${ORDER_SELECT},profiles(full_name,phone,email)&order=created_at.desc&limit=500`);
  return demo.orders.map(withProduct).map((o) => ({ ...o, profiles: pick(demo.profiles.find((p) => p.id === o.seller_id)) })).sort(byNewest);
}

export async function setOrderStatus(id, status) {
  if (live) return db.update('orders', `id=eq.${id}`, { status });
  const o = demo.orders.find((x) => x.id === id);
  const wasDelivered = o.status === 'delivered';
  if (status === 'delivered' && !wasDelivered) {
    // Same as the database: profit of a ready product delivered while the seller is locked stays locked.
    const seller = demo.profiles.find((x) => x.id === o.seller_id);
    const product = demo.products.find((x) => x.id === o.product_id) || {};
    const unlocked = seller?.unlocked_until && Date.parse(seller.unlocked_until) > Date.now();
    o.delivered_at = now();
    o.profit_locked = !product.owner_id && !unlocked;
    o.profit_released_at = o.profit_locked ? null : now();
  }
  o.status = status; o.updated_at = now();
  if (status === 'delivered' && !wasDelivered && o.profit_locked) {
    const counted = demo.orders.filter((x) => x.seller_id === o.seller_id && x.status === 'delivered' && x.profit_locked && !x.own_order).reduce((s, x) => s + (Number(x.quantity) || 1), 0);
    if (counted >= PLAN.goalOrders) demoRelease(demo.profiles.find((x) => x.id === o.seller_id));
  }
  demoSave(); return o;
}

export async function adminSellers() {
  if (live) {
    const [profiles, orders, payouts] = await Promise.all([
      db.select('profiles', 'select=*&order=created_at.desc&limit=1000'),
      db.select('orders', 'select=seller_id,status,unit_price,wholesale_price,quantity,fee_pct,own_order,profit_locked,delivered_at,updated_at,created_at,products(owner_id)&limit=5000'),
      db.select('payouts', 'select=seller_id,amount&limit=5000'),
    ]);
    return { profiles, orders, payouts };
  }
  return { profiles: demo.profiles.map(pick), orders: demo.orders.map(withProduct), payouts: demo.payouts };
}

export async function recordPayout(row) {
  const data = { ...row, amount: Number(row.amount) };
  if (live) return db.insert('payouts', data);
  const r = { ...data, id: uid(), paid_at: now() }; demo.payouts.push(r); demoSave(); return r;
}

export async function adminIdeas() {
  if (live) return db.select('ideas', 'select=*,profiles(full_name,phone,email)&order=created_at.desc&limit=300');
  return demo.ideas.map((i) => ({ ...i, profiles: pick(demo.profiles.find((p) => p.id === i.user_id)) })).sort(byNewest);
}

export async function setIdeaStatus(id, status) {
  if (live) return db.update('ideas', `id=eq.${id}`, { status });
  const i = demo.ideas.find((x) => x.id === id); i.status = status; demoSave(); return i;
}

export async function adminRequests() {
  if (live) return db.select('service_requests', 'select=*,seller:profiles!service_requests_user_id_fkey(full_name,phone,email,city),businesses(name,page_url),seller_expenses(id,amount)&service=neq.custom_product&order=created_at.desc&limit=300');
  return demo.service_requests.filter((r) => r.service !== 'custom_product').map((r) => ({ ...r, seller: pick(demo.profiles.find((p) => p.id === r.user_id)), businesses: demoBiz(r.business_id), seller_expenses: demo.expenses.filter((e) => e.request_id === r.id) })).sort(byNewest);
}

export async function setRequestStatus(id, status) {
  if (live) return db.update('service_requests', `id=eq.${id}`, { status });
  const r = demo.service_requests.find((x) => x.id === id); r.status = status; demoSave(); return r;
}

// Adds what the seller paid Forsa for a service as a cost in their Analytics (once per request).
export async function addRequestCost(r, amount) {
  const row = { seller_id: r.user_id, amount: Math.round(Number(amount)), category: r.service === 'media_buying' ? 'ads' : 'marketing',
    note: r.service === 'media_buying' ? 'Media buying (Forsa)' : 'Marketing agency (Forsa)', spent_on: new Date().toISOString().slice(0, 10), request_id: r.id, created_by_admin: true };
  if (live) return db.insert('seller_expenses', row);
  if (demo.expenses.some((e) => e.request_id === r.id)) throw new Error('Cost already added');
  const e = { ...row, id: uid(), created_at: now() }; demo.expenses.push(e); demoSave(); return e;
}

// ---------- Businesses ----------
export async function myBusinesses() {
  if (live) {
    const rows = await db.select('businesses', `select=*,business_products(product_id)&owner_id=eq.${getSession()?.user?.id}&order=created_at.asc`);
    return rows.map((b) => ({ ...b, product_ids: (b.business_products || []).map((x) => x.product_id) }));
  }
  return demo.businesses.filter((b) => b.owner_id === meId())
    .map((b) => ({ ...b, product_ids: demo.business_products.filter((x) => x.business_id === b.id).map((x) => x.product_id) }));
}

const BIZ_FIELDS = ['name', 'category', 'page_url', 'description', 'city', 'logo_url'];
export async function saveBusiness(b) {
  const row = Object.fromEntries(BIZ_FIELDS.map((k) => [k, String(b[k] || '').trim()]));
  if (live) return b.id ? db.update('businesses', `id=eq.${b.id}`, row) : db.insert('businesses', { ...row, owner_id: getSession()?.user?.id });
  if (b.id) { const x = demo.businesses.find((r) => r.id === b.id); Object.assign(x, row); demoSave(); return x; }
  if (demo.businesses.filter((r) => r.owner_id === meId()).length >= 5) throw new Error('You can have up to 5 businesses');
  const x = { ...row, id: uid(), owner_id: meId(), created_at: now() }; demo.businesses.push(x); demoSave(); return x;
}

export async function deleteBusiness(id) {
  if (live) {
    try { const r = await db.remove('businesses', `id=eq.${id}`); if (!r || !r.length) throw new Error('Not deleted'); return true; }
    catch (e) { if (e.code === '23503') { const er = new Error('HAS_ORDERS'); er.code = 'HAS_ORDERS'; throw er; } throw e; }
  }
  if (demo.orders.some((o) => o.business_id === id)) { const er = new Error('HAS_ORDERS'); er.code = 'HAS_ORDERS'; throw er; }
  demo.businesses = demo.businesses.filter((b) => b.id !== id);
  demo.business_products = demo.business_products.filter((x) => x.business_id !== id); demoSave(); return true;
}

export async function addToBusiness(businessId, productId) {
  if (live) return db.upsert('business_products', { business_id: businessId, product_id: productId }, 'business_id,product_id');
  if (!demo.business_products.some((x) => x.business_id === businessId && x.product_id === productId)) demo.business_products.push({ business_id: businessId, product_id: productId, created_at: now() });
  demoSave(); return true;
}

export async function removeFromBusiness(businessId, productId) {
  if (live) return db.remove('business_products', `business_id=eq.${businessId}&product_id=eq.${productId}`);
  demo.business_products = demo.business_products.filter((x) => !(x.business_id === businessId && x.product_id === productId)); demoSave(); return true;
}

export async function uploadLogo(file) {
  if (live) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    return storage.upload('business-logos', `${getSession()?.user?.id}/${uid()}.${ext}`, file);
  }
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
}

// ---------- Chat on service requests ----------
// Same rule as the database: hide phone numbers, emails and WhatsApp/Telegram links (demo mode only; live is done by the server).
export function maskContacts(text) {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[hidden]')
    .replace(/(https?:\/\/)?(www\.)?(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|whatsapp\.com|t\.me|telegram\.me)\S*/gi, '[hidden]')
    .replace(/\+?[0-9٠-٩][0-9٠-٩ .-]{8,}[0-9٠-٩]/g, '[hidden]');
}

export async function getRequest(id) {
  if (live) {
    const rows = await db.select('service_requests', `select=*,businesses(name,page_url,category,city,description,logo_url)&id=eq.${id}`);
    return rows[0] || null;
  }
  const r = demo.service_requests.find((x) => x.id === id);
  return r ? { ...r, businesses: demoBiz(r.business_id) } : null;
}

export async function listMessages(requestId) {
  if (live) return db.select('request_messages', `select=id,body,sender_id,created_at&request_id=eq.${requestId}&order=created_at.asc&limit=500`);
  return demo.messages.filter((m) => m.request_id === requestId).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function sendMessage(requestId, body) {
  const text = body.trim().slice(0, 2000);
  if (live) return db.insert('request_messages', { request_id: requestId, body: text });
  const me = meProfile();
  const m = { id: uid(), request_id: requestId, sender_id: me.id, body: me.role === 'admin' ? text : maskContacts(text), created_at: now() };
  demo.messages.push(m); demoSave(); return m;
}

export async function markRead(requestId) {
  if (live) return db.upsert('chat_reads', { request_id: requestId, user_id: getSession()?.user?.id, read_at: new Date().toISOString() }, 'request_id,user_id');
  const r = demo.chat_reads.find((x) => x.request_id === requestId && x.user_id === meId());
  if (r) r.read_at = now(); else demo.chat_reads.push({ request_id: requestId, user_id: meId(), read_at: now() });
  demoSave(); return true;
}

export async function unreadCounts() {
  if (live) {
    const rows = await db.rpc('unread_counts');
    return Object.fromEntries((rows || []).map((r) => [r.request_id, Number(r.unread)]));
  }
  const me = meProfile(); if (!me) return {};
  const mine = demo.service_requests.filter((r) => me.role === 'admin' || r.user_id === me.id || r.agency_id === me.id).map((r) => r.id);
  const out = {};
  demo.messages.filter((m) => mine.includes(m.request_id) && m.sender_id !== me.id).forEach((m) => {
    const read = demo.chat_reads.find((x) => x.request_id === m.request_id && x.user_id === me.id);
    if (!read || m.created_at > read.read_at) out[m.request_id] = (out[m.request_id] || 0) + 1;
  });
  return out;
}

// ---------- Agencies (partners) ----------
export async function agencyRequests() {
  if (live) return db.select('service_requests', `select=*,businesses(name,page_url,category,city,logo_url)&agency_id=eq.${getSession()?.user?.id}&order=created_at.desc`);
  return demo.service_requests.filter((r) => r.agency_id === meId()).map((r) => ({ ...r, businesses: demoBiz(r.business_id) })).sort(byNewest);
}

export async function adminAgencies() {
  if (live) return db.select('profiles', 'select=id,full_name,email,phone,agency_service&role=eq.agency&order=full_name.asc');
  return demo.profiles.filter((p) => p.role === 'agency').map(pick);
}

export async function makeAgency(email, service) {
  const e = email.trim().toLowerCase();
  if (live) {
    const rows = await db.select('profiles', `select=id,role&email=eq.${encodeURIComponent(e)}`);
    if (!rows.length) throw new Error('No account with this email. Ask the agency to sign up first.');
    if (rows[0].role === 'admin') throw new Error('This account is an admin.');
    return db.update('profiles', `id=eq.${rows[0].id}`, { role: 'agency', agency_service: service });
  }
  const p = demo.profiles.find((x) => x.email === e);
  if (!p) throw new Error('No account with this email. Ask the agency to sign up first.');
  if (p.role === 'admin') throw new Error('This account is an admin.');
  p.role = 'agency'; p.agency_service = service; demoSave(); return pick(p);
}

export async function removeAgency(id) {
  if (live) return db.update('profiles', `id=eq.${id}`, { role: 'seller', agency_service: null });
  const p = demo.profiles.find((x) => x.id === id); p.role = 'seller'; p.agency_service = null; demoSave(); return pick(p);
}

export async function assignAgency(requestId, agencyId) {
  if (live) return db.update('service_requests', `id=eq.${requestId}`, { agency_id: agencyId || null });
  const r = demo.service_requests.find((x) => x.id === requestId); r.agency_id = agencyId || null; demoSave(); return r;
}

// ---------- Make your own product (manufacturers) ----------
export async function listManufacturers({ all = false } = {}) {
  if (live) return db.select('manufacturers', `select=*${all ? '' : '&active=eq.true'}&order=created_at.asc`);
  return demo.manufacturers.filter((m) => all || m.active);
}

export async function saveManufacturer(m) {
  const row = { ...m };
  ['min_qty', 'price_from', 'lead_days'].forEach((k) => { row[k] = Number(row[k]) || 0; });
  if (live) { const { id, created_at, ...data } = row; return id ? db.update('manufacturers', `id=eq.${id}`, data) : db.insert('manufacturers', data); }
  if (row.id) Object.assign(demo.manufacturers.find((x) => x.id === row.id), row);
  else demo.manufacturers.push({ ...row, id: uid(), created_at: now() });
  demoSave(); return row;
}

const CR_SELECT = 'select=*,manufacturers(code,name_en,name_ar,min_qty,lead_days),businesses(name)';
const demoCR = (c) => ({ ...c, manufacturers: demo.manufacturers.find((m) => m.id === c.manufacturer_id), businesses: demoBiz(c.business_id) });

export async function myCustomRequests() {
  if (live) return db.select('custom_requests', `${CR_SELECT}&seller_id=eq.${getSession()?.user?.id}&order=created_at.desc`);
  return demo.custom_requests.filter((c) => c.seller_id === meId()).map(demoCR).sort(byNewest);
}

export async function getCustomRequest(id) {
  if (live) { const r = await db.select('custom_requests', `${CR_SELECT}&id=eq.${id}`); return r[0] || null; }
  const c = demo.custom_requests.find((x) => x.id === id); return c ? demoCR(c) : null;
}

// Creates the chat thread first, then the request linked to it.
export async function startCustomRequest({ business_id, manufacturer, product_type, details, quantity, fulfillment = 'forsa', ship_governorate = '', ship_address = '' }) {
  const q = Math.round(Number(quantity));
  const summary = `${product_type.trim()} · ${q} pcs`;
  const thread = await submitRequest({ service: 'custom_product', business_id, details: summary, budget: '' });
  const row = { business_id, manufacturer_id: manufacturer.id, thread_id: thread.id, product_type: product_type.trim(), details: details.trim(), quantity: q,
    fulfillment, ship_governorate: fulfillment === 'self' ? ship_governorate : '', ship_address: fulfillment === 'self' ? ship_address.trim().slice(0, 300) : '' };
  if (live) return db.insert('custom_requests', { ...row, seller_id: getSession()?.user?.id });
  if (q < manufacturer.min_qty) throw new Error(`Minimum quantity is ${manufacturer.min_qty}`);
  const c = { ...row, id: uid(), seller_id: meId(), status: 'requested', quote_unit_price: null, quote_total: null, deposit_amount: null, quote_note: '',
    deposit_ref: '', deposit_confirmed: false, balance_ref: '', balance_confirmed: false, product_id: null, created_at: now(), updated_at: now() };
  demo.custom_requests.push(c); demoSave(); return c;
}

async function patchCustom(id, patch) {
  if (live) return db.update('custom_requests', `id=eq.${id}`, patch);
  const c = demo.custom_requests.find((x) => x.id === id); Object.assign(c, patch, { updated_at: now() }); demoSave(); return c;
}
export const acceptQuote = (id) => patchCustom(id, { status: 'accepted' });
export const updateFulfillment = (id, f) => patchCustom(id, { fulfillment: f.fulfillment, ship_governorate: f.fulfillment === 'self' ? f.ship_governorate : '', ship_address: f.fulfillment === 'self' ? f.ship_address.trim().slice(0, 300) : '' });
export const cancelCustom = (id) => patchCustom(id, { status: 'cancelled' });
export const submitDepositRef = (id, ref) => patchCustom(id, { deposit_ref: ref.trim().slice(0, 80) });
export const submitBalanceRef = (id, ref) => patchCustom(id, { balance_ref: ref.trim().slice(0, 80) });

export async function adminCustomRequests() {
  if (live) return db.select('custom_requests', `${CR_SELECT},seller:profiles!custom_requests_seller_id_fkey(full_name,phone,email),custom_request_costs(factory_unit_price,forsa_pct)&order=created_at.desc&limit=300`);
  return demo.custom_requests.map((c) => ({ ...demoCR(c), seller: pick(demo.profiles.find((p) => p.id === c.seller_id)),
    custom_request_costs: demo.custom_request_costs.find((x) => x.request_id === c.id) || null })).sort(byNewest);
}

// R7: the factory price and Forsa's % for one deal (admin only; the seller sees just the total price).
export async function saveDealCost(requestId, factoryUnitPrice, forsaPct) {
  const row = { request_id: requestId, factory_unit_price: Math.round(Number(factoryUnitPrice)), forsa_pct: Number(forsaPct), updated_at: new Date().toISOString() };
  if (live) return db.upsert('custom_request_costs', row, 'request_id');
  demo.custom_request_costs = demo.custom_request_costs.filter((x) => x.request_id !== requestId).concat(row); demoSave(); return row;
}
export const adminUpdateCustom = (id, patch) => patchCustom(id, patch);

// Production cost is recorded once (on go live / sent to seller).
async function recordProductionCost(c) {
  const cost = { seller_id: c.seller_id, business_id: c.business_id, amount: Number(c.quote_total) || 0, category: 'production',
    note: `${c.product_type} × ${c.quantity}`, spent_on: new Date().toISOString().slice(0, 10), request_id: c.thread_id, created_by_admin: true };
  if (cost.amount <= 0) return;
  if (live) { try { await db.insert('seller_expenses', cost); } catch (e) { if (e.code !== '23505') throw e; } return; }
  if (!demo.expenses.some((e) => e.request_id === c.thread_id)) { demo.expenses.push({ ...cost, id: uid(), created_at: now() }); demoSave(); }
}

// Batch delivered to the seller's own place: no product in the app, just close the request.
export async function markSentToSeller(c) {
  await recordProductionCost(c);
  return patchCustom(c.id, { status: 'live', balance_confirmed: true });
}

// Final step: the private product is created, added to the seller's business,
// and the batch price is recorded once as a production cost.
export async function goLive(c, product) {
  const created = await saveProduct({ ...product, owner_id: c.seller_id, stock: c.quantity, active: true });
  const productId = created?.id;
  if (!productId) throw new Error('Product was not created');
  await addToBusiness(c.business_id, productId);
  await recordProductionCost(c);
  return patchCustom(c.id, { status: 'live', balance_confirmed: true, product_id: productId });
}

// ---------- helpers ----------
function demoBiz(id) { const b = demo.businesses.find((x) => x.id === id); return b ? { name: b.name, page_url: b.page_url, category: b.category, city: b.city, description: b.description, logo_url: b.logo_url } : null; }
function withProduct(o) {
  const p = demo.products.find((x) => x.id === o.product_id) || {};
  return { ...o, products: { name_en: p.name_en, name_ar: p.name_ar, image_url: p.image_url, factory_code: p.factory_code, owner_id: p.owner_id || null } };
}
function demoRelease(seller) {
  demo.orders.filter((x) => x.seller_id === seller.id && x.profit_locked).forEach((x) => { x.profit_locked = false; x.profit_released_at = now(); });
  seller.unlocked_until = new Date(Date.now() + PLAN.unlockDays * 864e5).toISOString();
}
function pick(p) { if (!p) return null; const { password, ...r } = p; return r; }
function byNewest(a, b) { return (b.created_at || '').localeCompare(a.created_at || ''); }
