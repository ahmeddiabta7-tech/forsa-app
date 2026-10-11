// Admin panel (English only, for the Forsa team).
import React, { useMemo, useState } from 'react';
import { useApp, Button, Field, Header, Spinner, ErrorBox, useLoad, Sheet, money, date, orderProfit, imgSrc } from '../core.jsx';
import { CATEGORIES } from '../lib/i18n.js';
import * as api from '../lib/api.js';

const TABS = ['Orders', 'Products', 'Payments', 'Sellers', 'Ideas'];
const STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'returned', 'cancelled'];

export function Admin({ notify }) {
  const [tab, setTab] = useState('Orders');
  return (
    <div className="screen admin" dir="ltr" lang="en">
      <Header title="Admin panel" back="/more" />
      <div className="chips scroll" role="tablist">
        {TABS.map((x) => <button type="button" key={x} role="tab" className="chip" aria-pressed={tab === x} aria-selected={tab === x} onClick={() => setTab(x)}>{x}</button>)}
      </div>
      {tab === 'Orders' && <AdminOrders notify={notify} />}
      {tab === 'Products' && <AdminProducts notify={notify} />}
      {tab === 'Payments' && <AdminPayments notify={notify} />}
      {tab === 'Sellers' && <AdminSellers notify={notify} />}
      {tab === 'Ideas' && <AdminIdeas notify={notify} />}
    </div>
  );
}

function AdminOrders({ notify }) {
  const { loading, data, error, reload } = useLoad(() => api.adminOrders(), []);
  const [filter, setFilter] = useState('pending');
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const counts = Object.fromEntries(STATUSES.map((s) => [s, data.filter((o) => o.status === s).length]));
  const list = data.filter((o) => filter === 'all' || o.status === filter);
  async function change(o, status) {
    try { await api.setOrderStatus(o.id, status); notify(`Order #${o.order_no} → ${status}`); reload(); }
    catch (e) { notify(e.message); }
  }
  return (
    <>
      <div className="chips scroll">
        {['all', ...STATUSES].map((s) => <button type="button" key={s} className="chip" aria-pressed={filter === s} onClick={() => setFilter(s)}>{s}{s !== 'all' ? ` (${counts[s]})` : ''}</button>)}
      </div>
      {list.length === 0 ? <div className="card empty"><p>No orders here.</p></div> : (
        <div className="list">
          {list.map((o) => (
            <div key={o.id} className="card admin-order">
              <div className="row-between"><b>#{o.order_no} · {o.products?.name_en} × {o.quantity}</b><span className={`pill pill-${o.status}`}>{o.status}</span></div>
              <p className="small">Customer: <b>{o.customer_name}</b> · <span dir="ltr">{o.customer_phone}</span><br />{o.address}, {o.governorate}{o.notes ? ` · Note: ${o.notes}` : ''}</p>
              <p className="small muted">Seller: {o.profiles?.full_name} · {o.profiles?.phone} · Factory {o.products?.factory_code} · {date(o.created_at, 'en')}</p>
              <p className="small">Sell {money(o.unit_price, 'en')} · Wholesale {money(o.wholesale_price, 'en')} · Seller profit <b>{money(orderProfit(o), 'en')}</b> · Collect <b>{money(o.unit_price * o.quantity, 'en')}</b></p>
              <label className="small" htmlFor={`st-${o.id}`}>Status</label>
              <select id={`st-${o.id}`} value={o.status} onChange={(e) => change(o, e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const EMPTY_PRODUCT = { name_en: '', name_ar: '', description_en: '', description_ar: '', category: 'Clothing', factory_code: '', region: '', quality_score: 4.5, wholesale_price: '', min_price: '', suggested_price: '', ship_days: 3, image_url: '', stock: 0, active: true };

function AdminProducts({ notify }) {
  const { loading, data, error, reload } = useLoad(() => api.listProducts({ all: true }), []);
  const [edit, setEdit] = useState(null);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <>
      <Button block onClick={() => setEdit({ ...EMPTY_PRODUCT })}>+ Add product</Button>
      <div className="list">
        {data.map((p) => (
          <button type="button" key={p.id} className="order-row" onClick={() => setEdit({ ...p })}>
            <img src={imgSrc(p.image_url)} alt="" />
            <div className="or-main"><b>{p.name_en}</b><span className="muted small">{p.factory_code} · W {p.wholesale_price} · Min {p.min_price} · Stock {p.stock}</span></div>
            <span className={`pill pill-${p.active ? 'delivered' : 'cancelled'}`}>{p.active ? 'Active' : 'Hidden'}</span>
          </button>
        ))}
      </div>
      <ProductForm product={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); notify('Product saved'); reload(); }} />
    </>
  );
}

function ProductForm({ product, onClose, onSaved }) {
  const [f, setF] = useState(product);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  React.useEffect(() => { setF(product); setErr(''); }, [product]);
  if (!product || !f) return null;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function upload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr('');
    try { const url = await api.uploadProductImage(file); setF((x) => ({ ...x, image_url: url })); }
    catch (er) { setErr(er.message); }
    finally { setBusy(false); }
  }
  async function save(ev) {
    ev.preventDefault();
    const w = Number(f.wholesale_price); const m = Number(f.min_price); const s = Number(f.suggested_price);
    if (!f.name_en || !f.name_ar || !f.factory_code) { setErr('English name, Arabic name and factory code are required.'); return; }
    if (!(w > 0) || m < w || s < m) { setErr('Prices must be: wholesale > 0, minimum ≥ wholesale, suggested ≥ minimum.'); return; }
    setBusy(true); setErr('');
    try { await api.saveProduct(f); onSaved(); } catch (er) { setErr(er.message); } finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={f.id ? 'Edit product' : 'Add product'}>
      <form onSubmit={save} noValidate className="stack">
        {f.image_url && <img className="form-img" src={imgSrc(f.image_url)} alt="" />}
        <Field id="ap-img" label="Photo"><input id="ap-img" type="file" accept="image/*" onChange={upload} /></Field>
        <Field id="ap-en" label="Name (English)"><input id="ap-en" value={f.name_en} onChange={set('name_en')} /></Field>
        <Field id="ap-ar" label="Name (Arabic)"><input id="ap-ar" dir="rtl" value={f.name_ar} onChange={set('name_ar')} /></Field>
        <Field id="ap-de" label="Description (English)"><textarea id="ap-de" rows="2" value={f.description_en} onChange={set('description_en')} /></Field>
        <Field id="ap-da" label="Description (Arabic)"><textarea id="ap-da" dir="rtl" rows="2" value={f.description_ar} onChange={set('description_ar')} /></Field>
        <div className="two-col">
          <Field id="ap-cat" label="Category"><select id="ap-cat" value={f.category} onChange={set('category')}>{CATEGORIES.map(([c]) => <option key={c}>{c}</option>)}</select></Field>
          <Field id="ap-fc" label="Factory code"><input id="ap-fc" value={f.factory_code} onChange={set('factory_code')} placeholder="FT-104" /></Field>
          <Field id="ap-rg" label="Region"><input id="ap-rg" value={f.region} onChange={set('region')} /></Field>
          <Field id="ap-q" label="Quality (1–5)"><input id="ap-q" type="number" step="0.1" min="1" max="5" value={f.quality_score} onChange={set('quality_score')} /></Field>
          <Field id="ap-w" label="Wholesale (EGP)"><input id="ap-w" type="number" value={f.wholesale_price} onChange={set('wholesale_price')} /></Field>
          <Field id="ap-m" label="Minimum price"><input id="ap-m" type="number" value={f.min_price} onChange={set('min_price')} /></Field>
          <Field id="ap-s" label="Suggested price"><input id="ap-s" type="number" value={f.suggested_price} onChange={set('suggested_price')} /></Field>
          <Field id="ap-d" label="Ships in (days)"><input id="ap-d" type="number" value={f.ship_days} onChange={set('ship_days')} /></Field>
          <Field id="ap-st" label="Stock"><input id="ap-st" type="number" value={f.stock} onChange={set('stock')} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> Visible to sellers</label>
        {err && <p className="form-error" role="alert">{err}</p>}
        <button type="submit" className="btn btn-primary block" disabled={busy}>{busy ? 'Saving…' : 'Save product'}</button>
      </form>
    </Sheet>
  );
}

function AdminPayments({ notify }) {
  const { loading, data, error, reload } = useLoad(() => api.adminPayments(), []);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  async function review(p, status) {
    try { await api.reviewPayment(p.id, status); notify(`Payment ${status}`); reload(); } catch (e) { notify(e.message); }
  }
  if (!data.length) return <div className="card empty"><p>No subscription payments yet.</p></div>;
  return (
    <div className="list">
      {data.map((p) => (
        <div key={p.id} className="card">
          <div className="row-between"><b>{money(p.amount, 'en')} · {p.months} month{p.months > 1 ? 's' : ''}</b><span className={`pill pill-${p.status === 'approved' ? 'delivered' : p.status === 'rejected' ? 'cancelled' : 'pending'}`}>{p.status}</span></div>
          <p className="small">{p.profiles?.full_name} · {p.profiles?.phone} · {p.profiles?.email}</p>
          <p className="small muted">{p.method === 'vodafone_cash' ? 'Vodafone Cash' : 'InstaPay'} · Ref <span dir="ltr">{p.reference}</span> · {date(p.created_at, 'en')}</p>
          {p.status === 'pending' && <div className="row"><Button small onClick={() => review(p, 'approved')}>Approve</Button><Button small variant="ghost" onClick={() => review(p, 'rejected')}>Reject</Button></div>}
        </div>
      ))}
    </div>
  );
}

function AdminSellers({ notify }) {
  const { loading, data, error, reload } = useLoad(() => api.adminSellers(), []);
  const [payFor, setPayFor] = useState(null);
  const rows = useMemo(() => {
    if (!data) return [];
    return data.profiles.map((p) => {
      const mine = data.orders.filter((o) => o.seller_id === p.id);
      const earned = mine.filter((o) => o.status === 'delivered').reduce((s, o) => s + orderProfit(o), 0);
      const paid = data.payouts.filter((x) => x.seller_id === p.id).reduce((s, x) => s + x.amount, 0);
      return { ...p, orders: mine.length, delivered: mine.filter((o) => o.status === 'delivered').length, earned, paid, balance: earned - paid };
    }).sort((a, b) => b.balance - a.balance);
  }, [data]);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const totalDue = rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
  return (
    <>
      <div className="stats two"><div className="stat"><span>Sellers</span><b>{rows.length}</b></div><div className="stat"><span>Total balance due</span><b>{money(totalDue, 'en')}</b></div></div>
      <div className="list">
        {rows.map((r) => (
          <div key={r.id} className="card">
            <div className="row-between"><b>{r.full_name || r.email}</b><span className="muted small">{r.role}</span></div>
            <p className="small muted">{r.phone} · {r.email} · {r.city}{r.university ? ` · ${r.university}` : ''}</p>
            <p className="small">Orders {r.orders} · Delivered {r.delivered} · Earned {money(r.earned, 'en')} · Paid {money(r.paid, 'en')} · <b>Due {money(r.balance, 'en')}</b></p>
            {r.balance > 0 && <Button small onClick={() => setPayFor(r)}>Record payout</Button>}
          </div>
        ))}
      </div>
      <PayoutForm seller={payFor} onClose={() => setPayFor(null)} onSaved={() => { setPayFor(null); notify('Payout recorded'); reload(); }} />
    </>
  );
}

function PayoutForm({ seller, onClose, onSaved }) {
  const [f, setF] = useState({ amount: '', method: 'instapay', reference: '' });
  const [err, setErr] = useState('');
  React.useEffect(() => { if (seller) setF({ amount: seller.balance, method: 'instapay', reference: '' }); }, [seller]);
  if (!seller) return null;
  async function save(ev) {
    ev.preventDefault();
    if (!(Number(f.amount) > 0)) { setErr('Enter an amount.'); return; }
    try { await api.recordPayout({ seller_id: seller.id, ...f }); onSaved(); } catch (e) { setErr(e.message); }
  }
  return (
    <Sheet open onClose={onClose} title={`Payout to ${seller.full_name}`}>
      <form onSubmit={save} noValidate className="stack">
        <p className="small muted">Balance due: {money(seller.balance, 'en')}</p>
        <Field id="po-a" label="Amount (EGP)"><input id="po-a" type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field id="po-m" label="Method"><select id="po-m" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="instapay">InstaPay</option><option value="vodafone_cash">Vodafone Cash</option></select></Field>
        <Field id="po-r" label="Reference"><input id="po-r" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        {err && <p className="form-error">{err}</p>}
        <button type="submit" className="btn btn-primary block">Save payout</button>
      </form>
    </Sheet>
  );
}

function AdminIdeas({ notify }) {
  const { loading, data, error, reload } = useLoad(() => api.adminIdeas(), []);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data.length) return <div className="card empty"><p>No ideas submitted yet.</p></div>;
  async function change(i, status) { try { await api.setIdeaStatus(i.id, status); notify('Idea updated'); reload(); } catch (e) { notify(e.message); } }
  return (
    <div className="list">
      {data.map((i) => (
        <div key={i.id} className="card">
          <div className="row-between"><b>{i.title}</b><span className="muted small">{date(i.created_at, 'en')}</span></div>
          <p className="small">{i.problem}</p>
          <p className="small muted">{i.sector} · {i.stage} · Funding {money(i.funding_needed, 'en')} · {i.profiles?.full_name} · {i.profiles?.phone}</p>
          <select aria-label="Idea status" value={i.status} onChange={(e) => change(i, e.target.value)}>
            {['new', 'reviewing', 'matched', 'declined'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}
