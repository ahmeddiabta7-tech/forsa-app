// Seller analytics + smart tips.
// Today the tips come from simple rules (free, instant, private).
// Later an AI advisor can be plugged in through getAdvice(): it receives only the
// anonymous numbers from buildSummary() (no names, phones or addresses).

const DAY = 864e5;
const qtyOf = (o) => Number(o.quantity) || 1;

export function periodStart(period) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (period === 'week') return new Date(d.getTime() - 6 * DAY);
  if (period === 'month') return new Date(d.getTime() - 29 * DAY);
  return null; // all time
}

export function inPeriod(orders, period) {
  const start = periodStart(period);
  return start ? orders.filter((o) => new Date(o.created_at) >= start) : orders;
}

// Core numbers. Revenue / costs / profit count delivered orders only (money actually made).
export function computeStats(orders) {
  const delivered = orders.filter((o) => o.status === 'delivered');
  const returned = orders.filter((o) => o.status === 'returned');
  const live = orders.filter((o) => o.status !== 'cancelled');
  const revenue = delivered.reduce((s, o) => s + o.unit_price * qtyOf(o), 0);
  const costs = delivered.reduce((s, o) => s + o.wholesale_price * qtyOf(o), 0);
  const units = delivered.reduce((s, o) => s + qtyOf(o), 0);
  const closed = delivered.length + returned.length;
  return {
    orders: live.length,
    delivered: delivered.length,
    returned: returned.length,
    pending: orders.filter((o) => o.status === 'pending').length,
    cancelled: orders.filter((o) => o.status === 'cancelled').length,
    onTheWay: orders.filter((o) => ['confirmed', 'shipped'].includes(o.status)).length,
    revenue, costs, profit: revenue - costs, units,
    returnRate: closed ? returned.length / closed : 0,
    avgProfit: delivered.length ? (revenue - costs) / delivered.length : 0,
  };
}

// Profit per bucket for the bar chart (delivered orders). Week = 7 days, month = 30 days, all = 12 months.
export function profitSeries(orders, period) {
  const delivered = orders.filter((o) => o.status === 'delivered');
  const profit = (o) => (o.unit_price - o.wholesale_price) * qtyOf(o);
  if (period === 'all') {
    const out = [];
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
    for (let i = 11; i >= 0; i -= 1) {
      const a = new Date(d.getFullYear(), d.getMonth() - i, 1);
      const b = new Date(d.getFullYear(), d.getMonth() - i + 1, 1);
      out.push({ date: a, unit: 'month', value: delivered.filter((o) => { const t = new Date(o.updated_at || o.created_at); return t >= a && t < b; }).reduce((s, o) => s + profit(o), 0) });
    }
    return out;
  }
  const days = period === 'week' ? 7 : 30;
  const start = periodStart(period);
  return Array.from({ length: days }, (_, i) => {
    const a = new Date(start.getTime() + i * DAY); const b = new Date(a.getTime() + DAY);
    return { date: a, unit: 'day', value: delivered.filter((o) => { const t = new Date(o.updated_at || o.created_at); return t >= a && t < b; }).reduce((s, o) => s + profit(o), 0) };
  });
}

// Best sellers by units (non-cancelled orders).
export function bestSellers(orders, limit = 5) {
  const map = new Map();
  orders.filter((o) => o.status !== 'cancelled').forEach((o) => {
    const cur = map.get(o.product_id) || { product_id: o.product_id, product: o.products, units: 0, profit: 0, returned: 0 };
    cur.units += qtyOf(o);
    if (o.status === 'delivered') cur.profit += (o.unit_price - o.wholesale_price) * qtyOf(o);
    if (o.status === 'returned') cur.returned += 1;
    map.set(o.product_id, cur);
  });
  return [...map.values()].sort((a, b) => b.units - a.units).slice(0, limit);
}

function bestWeekday(orders) {
  const counts = Array(7).fill(0);
  orders.filter((o) => o.status !== 'cancelled').forEach((o) => { counts[new Date(o.created_at).getDay()] += 1; });
  const max = Math.max(...counts);
  return max > 0 ? counts.indexOf(max) : -1;
}

// Anonymous summary — the only thing a future AI advisor would ever receive.
export function buildSummary(allOrders, plan) {
  const s = computeStats(allOrders);
  const recent = computeStats(inPeriod(allOrders, 'week'));
  const top = bestSellers(allOrders, 3).map((b) => ({ units: b.units, returned: b.returned }));
  const margins = allOrders.filter((o) => o.status !== 'cancelled').map((o) => (o.unit_price - o.wholesale_price) / o.wholesale_price);
  return {
    totals: s, lastWeek: recent, top,
    avgMargin: margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0,
    bestWeekday: bestWeekday(allOrders),
    plan: plan ? { phase: plan.phase, delivered: plan.delivered, goalDone: plan.goalDone || plan.goalWaived, daysLeft: plan.daysLeft } : null,
  };
}

// Rule-based tips. Returns [{ key, vars }] — the text lives in i18n (tip_*).
export function ruleTips(allOrders, plan, products = []) {
  const tips = [];
  const s = computeStats(allOrders);
  const goalOrders = 3;
  if (s.orders === 0) {
    tips.push({ key: 'tip_first' });
    tips.push({ key: 'tip_post3' });
    return tips;
  }
  if (plan && plan.phase === 'trial' && !(plan.goalDone || plan.goalWaived)) {
    const left = Math.max(0, goalOrders - plan.delivered);
    if (left > 0) tips.push({ key: 'tip_goal', vars: { n: left, d: plan.daysLeft } });
  }
  if (s.pending > 0) tips.push({ key: 'tip_pending', vars: { n: s.pending } });
  if (s.delivered + s.returned >= 3 && s.returnRate >= 0.2) tips.push({ key: 'tip_returns', vars: { p: Math.round(s.returnRate * 100) } });
  const top = bestSellers(allOrders, 1)[0];
  if (top && top.units >= 2) tips.push({ key: 'tip_best', vars: { product: top.product, u: top.units } });
  const day = bestWeekday(allOrders);
  if (s.orders >= 5 && day >= 0) tips.push({ key: 'tip_day', vars: { day } });
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const nearMin = allOrders.filter((o) => o.status !== 'cancelled' && byId[o.product_id] && o.unit_price <= byId[o.product_id].min_price).length;
  if (nearMin >= 2) tips.push({ key: 'tip_price_up' });
  const recent = computeStats(inPeriod(allOrders, 'week'));
  if (recent.orders === 0) tips.push({ key: 'tip_quiet' });
  if (s.cancelled >= 2 && s.cancelled / (s.orders + s.cancelled) >= 0.25) tips.push({ key: 'tip_cancel' });
  if (tips.length === 0) tips.push({ key: 'tip_keep' });
  return tips;
}

// The single entry point the app uses. Swap the body for an AI call later
// (e.g. a Supabase Edge Function that receives buildSummary()) without touching the UI.
export const ADVISOR = { provider: 'rules' };
export async function getAdvice({ orders, plan, products }) {
  return ruleTips(orders, plan, products);
}
