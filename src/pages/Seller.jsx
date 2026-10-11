import React, { useMemo, useState } from 'react';
import {
  useApp, Button, Field, Header, StatusPill, Spinner, ErrorBox, useLoad, Sheet, Icon, go,
  money, num, date, pname, imgSrc, orderProfit, planState, earningsSummary,
} from '../core.jsx';
import { GOVERNORATES, CATEGORIES } from '../lib/i18n.js';
import { PLAN } from '../config.js';
import * as api from '../lib/api.js';

// ---------- Plan card (used on Home) ----------
function PlanCard({ plan }) {
  const { t, lang } = useApp();
  if (plan.phase === 'active') {
    return (
      <div className="card plan-card">
        <div className="row-between"><span className="eyebrow">{t('planTitle')}</span><span className="pill pill-delivered">{t('pay_approved')}</span></div>
        <p className="plan-big">{t('activeUntil', { d: date(plan.paidUntil, lang) })}</p>
        <Button small variant="ghost" onClick={() => go('/plan')}>{t('managePlan')}</Button>
      </div>
    );
  }
  if (plan.phase === 'expired') {
    return (
      <div className="card plan-card warn">
        <span className="eyebrow">{t('planTitle')}</span>
        <p className="plan-big">{t('expired')}</p>
        <Button block onClick={() => go('/plan')}>{t('renew')}</Button>
      </div>
    );
  }
  const done = plan.goalDone || plan.goalWaived;
  return (
    <div className="card plan-card">
      <div className="row-between"><span className="eyebrow">{t('month1')}</span><span className="muted small">{t('daysLeft', { n: num(plan.daysLeft, lang) })}</span></div>
      <p className="plan-big">{plan.goalWaived ? t('goalSkipped') : done ? t('goalDone') : t('goal')}</p>
      {!plan.goalWaived && (
        <>
          <div className="tracker" aria-label={`${plan.delivered}/${PLAN.goalOrders}`}>
            {Array.from({ length: PLAN.goalOrders }, (_, i) => <span key={i} className={i < plan.delivered ? 'on' : ''} />)}
          </div>
          <p className="muted small">{num(plan.delivered, lang)} / {num(PLAN.goalOrders, lang)}</p>
        </>
      )}
      {!done && <Button small variant="ghost" onClick={() => go('/plan')}>{t('skipGoal')}</Button>}
    </div>
  );
}

// ---------- Home ----------
export function Home({ data }) {
  const { t, lang, profile } = useApp();
  const plan = planState(profile, data.orders);
  const sum = earningsSummary(data.orders, data.payouts);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const thisMonth = data.orders.filter((o) => new Date(o.created_at) >= monthStart && o.status !== 'cancelled').length;
  const firstName = (profile.full_name || '').split(' ')[0];
  return (
    <div className="screen">
      <div className="hello"><div><p className="muted">{t('hello')}{firstName ? `${lang === 'ar' ? '،' : ','} ${firstName}` : ''}</p><h1>{t('welcomeBack')}</h1></div></div>
      <PlanCard plan={plan} />
      <div className="stats">
        <div className="stat"><span>{t('totalEarned')}</span><b>{money(sum.earned, lang)}</b></div>
        <div className="stat"><span>{t('pendingEarn')}</span><b>{money(sum.onTheWay, lang)}</b></div>
        <div className="stat"><span>{t('ordersMonth')}</span><b>{num(thisMonth, lang)}</b></div>
      </div>
      <div className="section-head"><h2>{t('recentOrders')}</h2>{data.orders.length > 0 && <a href="#/orders">{t('seeAll')}</a>}</div>
      {data.orders.length === 0 ? (
        <div className="card empty"><p>{t('noOrders')}</p><Button onClick={() => go('/products')}>{t('browse')}</Button></div>
      ) : (
        <div className="list">{data.orders.slice(0, 3).map((o) => <OrderRow key={o.id} o={o} />)}</div>
      )}
      <button type="button" className="card link-card" onClick={() => go('/idea')}>
        <Icon name="bulb" /><div><b>{t('idea')}</b><p className="muted small">{t('ideaIntro').split('.')[0]}.</p></div><Icon name="chevron" size={16} />
      </button>
      <div className="card link-card soon"><Icon name="sparkle" /><div><b>{t('brandSoon')}</b><p className="muted small">{t('comingSoon')}</p></div></div>
    </div>
  );
}

// ---------- Products ----------
export function Products() {
  const { t, lang } = useApp();
  const { loading, data, error, reload } = useLoad(() => api.listProducts(), []);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const list = useMemo(() => (data || []).filter((p) => (cat === 'All' || p.category === cat)
    && (!q || `${p.name_en} ${p.name_ar}`.toLowerCase().includes(q.toLowerCase()))), [data, q, cat]);
  return (
    <div className="screen">
      <Header title={t('products')} />
      <div className="search"><Icon name="search" size={18} /><input aria-label={t('search')} placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="chips" role="group">
        <button type="button" className="chip" aria-pressed={cat === 'All'} onClick={() => setCat('All')}>{t('all')}</button>
        {CATEGORIES.slice(0, 4).map(([c, k]) => <button type="button" key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{t(k)}</button>)}
      </div>
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
        <div className="grid">
          {list.map((p) => (
            <button type="button" key={p.id} className="product" onClick={() => go(`/product/${p.id}`)}>
              <div className="ph"><img src={imgSrc(p.image_url)} alt="" loading="lazy" /></div>
              <div className="pbody">
                <b className="pname">{pname(p, lang)}</b>
                <span className="muted small">Forsa Factory {p.factory_code}</span>
                <div className="prow"><span className="muted small">{t('wholesale')}</span><span>{money(p.wholesale_price, lang)}</span></div>
                <div className="prow"><span className="muted small">{t('youEarn')}</span><span className="earn">+{money(p.suggested_price - p.wholesale_price, lang)}</span></div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Product detail + create order ----------
export function ProductDetail({ id, data, onOrdered, notify }) {
  const { t, lang, profile } = useApp();
  const { loading, data: products, error, reload } = useLoad(() => api.listProducts(), []);
  const p = (products || []).find((x) => x.id === id);
  const plan = planState(profile, data.orders);
  const [price, setPrice] = useState(null);
  const [qty, setQty] = useState(1);
  const [open, setOpen] = useState(false);
  if (loading) return <div className="screen"><Header title="" back="/products" /><Spinner /></div>;
  if (error || !p) return <div className="screen"><Header title="" back="/products" /><ErrorBox error={error} onRetry={reload} /></div>;
  const sell = price ?? p.suggested_price;
  const max = Math.round(p.wholesale_price * 2.5);
  const profit = (sell - p.wholesale_price) * qty;
  const post = lang === 'ar'
    ? `✨ ${p.name_ar}\n${p.description_ar}\nالسعر: ${num(sell, 'ar')} جنيه\nالدفع عند الاستلام 🚚 ابعتلي رسالة واطلب دلوقتي!`
    : `✨ ${p.name_en}\n${p.description_en}\nPrice: EGP ${sell}\nCash on delivery 🚚 Message me to order now!`;
  async function copy() {
    try { await navigator.clipboard.writeText(post); notify(t('copied')); }
    catch { window.prompt?.('', post); }
  }
  return (
    <div className="screen detail">
      <Header title={pname(p, lang)} back="/products" />
      <div className="hero-img"><img src={imgSrc(p.image_url)} alt={pname(p, lang)} /></div>
      <div className="card">
        <h2 className="dname">{pname(p, lang)}</h2>
        <p className="muted">{lang === 'ar' ? p.description_ar : p.description_en}</p>
        <div className="facts">
          <span><Icon name="shield" size={16} />{t('madeBy')} Forsa Factory {p.factory_code}</span>
          <span>★ {p.quality_score} {t('quality')}</span>
          <span>{t('shipsIn', { n: num(p.ship_days, lang) })}</span>
        </div>
        <div className="price-grid">
          <div><span>{t('wholesale')}</span><b>{money(p.wholesale_price, lang)}</b></div>
          <div><span>{t('minPrice')}</span><b>{money(p.min_price, lang)}</b></div>
          <div><span>{t('suggested')}</span><b>{money(p.suggested_price, lang)}</b></div>
        </div>
      </div>
      <div className="card">
        <h3>{t('profitCalc')}</h3>
        <Field id="pd-price" label={`${t('yourPrice')}: ${money(sell, lang)}`}>
          <input id="pd-price" type="range" min={p.min_price} max={max} step="5" value={sell} onChange={(e) => setPrice(Number(e.target.value))} />
        </Field>
        <Field id="pd-qty" label={t('quantity')}>
          <div className="stepper">
            <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="−">−</button>
            <output id="pd-qty">{num(qty, lang)}</output>
            <button type="button" onClick={() => setQty(Math.min(20, qty + 1))} aria-label="+">+</button>
          </div>
        </Field>
        <div className="profit-box"><span>{t('profit')}</span><b>{money(profit, lang)}</b></div>
      </div>
      <div className="stack">
        {plan.canSell
          ? <Button block onClick={() => setOpen(true)}>{t('createOrder')}</Button>
          : <><p className="form-error">{t('cantSell')}</p><Button block onClick={() => go('/plan')}>{t('renew')}</Button></>}
        <Button block variant="ghost" onClick={copy}><Icon name="copy" size={18} /> {t('copyPost')}</Button>
      </div>
      <OrderSheet open={open} onClose={() => setOpen(false)} product={p} price={sell} qty={qty} onDone={(o) => { setOpen(false); onOrdered(o); }} />
    </div>
  );
}

function OrderSheet({ open, onClose, product, price, qty, onDone }) {
  const { t, lang } = useApp();
  const [f, setF] = useState({ customer_name: '', customer_phone: '', governorate: 'Cairo', address: '', notes: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(ev) {
    ev.preventDefault();
    const e = {};
    if (!f.customer_name.trim()) e.customer_name = t('required');
    if (!/^(\+?20)?0?1[0125]\d{8}$/.test(f.customer_phone.replace(/[\s-]/g, ''))) e.customer_phone = t('invalidPhone');
    if (!f.address.trim()) e.address = t('required');
    if (price < product.min_price) e.price = t('priceTooLow', { p: money(product.min_price, lang) });
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true); setServerError('');
    try {
      const o = await api.createOrder({ ...f, customer_phone: f.customer_phone.replace(/[\s-]/g, ''), product_id: product.id, unit_price: price, quantity: qty });
      setF({ customer_name: '', customer_phone: '', governorate: 'Cairo', address: '', notes: '' });
      onDone(o);
    } catch (err) { setServerError(err.message); }
    finally { setBusy(false); }
  }
  return (
    <Sheet open={open} onClose={onClose} title={t('createOrder')}>
      <div className="order-summary"><span>{pname(product, lang)} × {num(qty, lang)}</span><b>{money(price * qty, lang)}</b></div>
      <form onSubmit={submit} noValidate className="stack">
        <h3>{t('customer')}</h3>
        <Field id="os-name" label={t('customerName')} error={errors.customer_name}><input id="os-name" value={f.customer_name} onChange={set('customer_name')} /></Field>
        <Field id="os-phone" label={t('customerPhone')} error={errors.customer_phone}><input id="os-phone" value={f.customer_phone} onChange={set('customer_phone')} inputMode="tel" dir="ltr" placeholder="01012345678" /></Field>
        <Field id="os-gov" label={t('city')}>
          <select id="os-gov" value={f.governorate} onChange={set('governorate')}>{GOVERNORATES.map(([en, ar]) => <option key={en} value={en}>{lang === 'ar' ? ar : en}</option>)}</select>
        </Field>
        <Field id="os-addr" label={t('address')} error={errors.address}><textarea id="os-addr" rows="2" value={f.address} onChange={set('address')} /></Field>
        <Field id="os-notes" label={t('notes')}><input id="os-notes" value={f.notes} onChange={set('notes')} /></Field>
        {errors.price && <p className="form-error">{errors.price}</p>}
        {serverError && <p className="form-error" role="alert">{serverError}</p>}
        <div className="profit-box"><span>{t('profit')}</span><b>{money((price - product.wholesale_price) * qty, lang)}</b></div>
        <button type="submit" className="btn btn-primary block" disabled={busy}>{busy ? t('loading') : t('placeOrder')}</button>
      </form>
    </Sheet>
  );
}

// ---------- Orders ----------
export function OrderRow({ o, onClick }) {
  const { t, lang } = useApp();
  return (
    <button type="button" className="order-row" onClick={onClick || (() => go(`/orders/${o.id}`))}>
      <img src={imgSrc(o.products?.image_url)} alt="" />
      <div className="or-main">
        <b>{pname(o.products, lang)}</b>
        <span className="muted small">{t('orderNo', { n: o.order_no })} · {date(o.created_at, lang)}</span>
      </div>
      <div className="or-side"><StatusPill status={o.status} /><span className={o.status === 'cancelled' || o.status === 'returned' ? 'muted small' : 'earn small'}>+{money(orderProfit(o), lang)}</span></div>
    </button>
  );
}

const STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'returned', 'cancelled'];

export function Orders({ data, openId, reload, notify }) {
  const { t, lang } = useApp();
  const [filter, setFilter] = useState('all');
  const [confirming, setConfirming] = useState(false);
  const list = data.orders.filter((o) => filter === 'all' || o.status === filter);
  const current = data.orders.find((o) => o.id === openId);
  async function cancel() {
    try { await api.cancelOrder(current.id); setConfirming(false); notify(t('status_cancelled')); reload(); }
    catch (err) { notify(err.message); }
  }
  return (
    <div className="screen">
      <Header title={t('orders')} />
      <div className="chips scroll" role="group">
        <button type="button" className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>{t('all')}</button>
        {STATUSES.map((s) => <button type="button" key={s} className="chip" aria-pressed={filter === s} onClick={() => setFilter(s)}>{t(`status_${s}`)}</button>)}
      </div>
      {list.length === 0 ? <div className="card empty"><p>{t('noOrders')}</p><Button onClick={() => go('/products')}>{t('browse')}</Button></div>
        : <div className="list">{list.map((o) => <OrderRow key={o.id} o={o} />)}</div>}
      <Sheet open={Boolean(current)} onClose={() => { setConfirming(false); go('/orders'); }} title={current ? t('orderNo', { n: current.order_no }) : ''}>
        {current && (
          <div className="stack">
            <div className="row-between"><b>{pname(current.products, lang)} × {num(current.quantity, lang)}</b><StatusPill status={current.status} /></div>
            <dl className="kv">
              <dt>{t('yourPrice')}</dt><dd>{money(current.unit_price, lang)}</dd>
              <dt>{t('profit')}</dt><dd className="earn">{money(orderProfit(current), lang)}</dd>
              <dt>{t('customerName')}</dt><dd>{current.customer_name}</dd>
              <dt>{t('customerPhone')}</dt><dd dir="ltr">{current.customer_phone}</dd>
              <dt>{t('address')}</dt><dd>{current.address}, {lang === 'ar' ? (GOVERNORATES.find((g) => g[0] === current.governorate)?.[1] || current.governorate) : current.governorate}</dd>
              {current.notes ? <><dt>{t('notes')}</dt><dd>{current.notes}</dd></> : null}
            </dl>
            {current.status === 'pending' && (confirming ? (
              <div className="card warn stack"><p>{t('cancelConfirm')}</p><div className="row"><Button variant="danger" small onClick={cancel}>{t('yesCancel')}</Button><Button variant="ghost" small onClick={() => setConfirming(false)}>{t('keep')}</Button></div></div>
            ) : <Button variant="ghost" block onClick={() => setConfirming(true)}>{t('cancelOrder')}</Button>)}
          </div>
        )}
      </Sheet>
    </div>
  );
}

// ---------- Earnings ----------
export function Earnings({ data }) {
  const { t, lang } = useApp();
  const sum = earningsSummary(data.orders, data.payouts);
  return (
    <div className="screen">
      <Header title={t('earnings')} />
      <div className="card balance-card">
        <span className="eyebrow">{t('balance')}</span>
        <b className="balance">{money(sum.balance, lang)}</b>
      </div>
      <div className="stats two">
        <div className="stat"><span>{t('totalEarned')}</span><b>{money(sum.earned, lang)}</b></div>
        <div className="stat"><span>{t('pendingEarn')}</span><b>{money(sum.onTheWay, lang)}</b></div>
      </div>
      <p className="muted small">{t('earnedNote')}</p>
      <div className="section-head"><h2>{t('payouts')}</h2></div>
      {data.payouts.length === 0 ? <div className="card empty"><p>{t('noPayouts')}</p></div> : (
        <div className="list">
          {data.payouts.map((p) => (
            <div key={p.id} className="order-row static">
              <Icon name="wallet" />
              <div className="or-main"><b>{money(p.amount, lang)}</b><span className="muted small">{date(p.paid_at, lang)} · {p.method === 'vodafone_cash' ? 'Vodafone Cash' : 'InstaPay'}</span></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
