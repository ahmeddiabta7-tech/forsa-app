// Admin panel (English only, for the Forsa team).
import React, { useMemo, useState } from 'react';
import { useApp, Button, Field, Header, Spinner, ErrorBox, useLoad, Sheet, money, date, orderProfit, imgSrc, planState, go } from '../core.jsx';
import { CATEGORIES } from '../lib/i18n.js';
import * as api from '../lib/api.js';

const TABS = ['Orders', 'Products', 'Manufacturing', 'Payments', 'Sellers', 'Ideas', 'Services', 'Partners'];
const STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'returned', 'cancelled'];

export function Admin({ notify }) {
  const [tab, setTab] = useState('Orders');
  return (
    <div className="screen admin" dir="ltr" lang="en">
      <Header title="Admin panel" back="/more" noLang />
      <div className="chips scroll" role="tablist">
        {TABS.map((x) => <button type="button" key={x} role="tab" className="chip" aria-pressed={tab === x} aria-selected={tab === x} onClick={() => setTab(x)}>{x}</button>)}
      </div>
      {tab === 'Orders' && <AdminOrders notify={notify} />}
      {tab === 'Products' && <AdminProducts notify={notify} />}
      {tab === 'Payments' && <AdminPayments notify={notify} />}
      {tab === 'Sellers' && <AdminSellers notify={notify} />}
      {tab === 'Ideas' && <AdminIdeas notify={notify} />}
      {tab === 'Services' && <AdminServices notify={notify} />}
      {tab === 'Partners' && <AdminPartners notify={notify} />}
      {tab === 'Manufacturing' && <AdminManufacturing notify={notify} />}
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
            <div className="or-main"><b>{p.name_en}</b><span className="muted small">{p.owner_id ? 'Private (custom) · ' : ''}{p.factory_code} · W {p.wholesale_price} · Min {p.min_price} · Stock {p.stock}</span></div>
            <span className={`pill pill-${p.active ? 'delivered' : 'cancelled'}`}>{p.active ? 'Active' : 'Hidden'}</span>
          </button>
        ))}
      </div>
      <ProductForm product={edit} onClose={() => setEdit(null)} onSaved={(msg) => { setEdit(null); notify(msg || 'Product saved'); reload(); }} />
    </>
  );
}

function ProductForm({ product, onClose, onSaved }) {
  const [f, setF] = useState(product);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [orderCount, setOrderCount] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  React.useEffect(() => {
    setF(product); setErr(''); setConfirmDel(false); setOrderCount(null);
    if (product?.id) api.productOrderCount(product.id).then(setOrderCount).catch(() => setOrderCount(null));
  }, [product]);
  if (!product || !f) return null;
  async function hide() {
    setBusy(true); setErr('');
    try { await api.saveProduct({ ...product, active: false }); onSaved('Product hidden from sellers'); } catch (er) { setErr(er.message); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setErr('');
    try { await api.deleteProduct(product.id); onSaved('Product deleted'); }
    catch (er) { if (er.code === 'HAS_ORDERS') setOrderCount((c) => c || 1); setErr(er.message); setConfirmDel(false); }
    finally { setBusy(false); }
  }
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
      {f.id && (
        <div className="danger-zone">
          {orderCount === null ? <p className="small muted">Checking orders…</p> : orderCount > 0 ? (
            <>
              <p className="small">This product has <b>{orderCount}</b> order{orderCount > 1 ? 's' : ''}, so it can't be deleted (order history must stay). You can hide it instead.</p>
              {product.active ? <Button block variant="ghost" onClick={hide} disabled={busy}>Hide product</Button> : <p className="small muted">It is already hidden from sellers.</p>}
            </>
          ) : confirmDel ? (
            <div className="card warn stack">
              <p><b>Delete “{product.name_en}” permanently?</b><br /><span className="small">This can't be undone.</span></p>
              <div className="row"><Button variant="danger" small onClick={remove} disabled={busy}>Yes, delete</Button><Button variant="ghost" small onClick={() => setConfirmDel(false)}>Keep it</Button></div>
            </div>
          ) : <Button block variant="ghost" onClick={() => setConfirmDel(true)}>Delete product</Button>}
        </div>
      )}
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
      return { ...p, plan: planState(p, mine), orders: mine.length, delivered: mine.filter((o) => o.status === 'delivered').length, earned, paid, balance: earned - paid };
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
            <div className="row-between"><b>{r.full_name || r.email}</b><span className={`pill pill-${r.plan.phase === 'frozen' ? 'cancelled' : 'delivered'}`}>{{ frozen: 'Paused', paid: 'Paid', free: 'Free (earned)', first: 'Month 1' }[r.plan.phase]}</span></div>
            <p className="small muted">This month: {r.plan.delivered}/3 delivered · {r.plan.daysLeft} days left{r.plan.paidUntil ? ` · Paid until ${date(r.plan.paidUntil, 'en')}` : ''}</p>
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
          {(i.customer || i.revenue_model || i.needs) && <p className="small">{i.customer ? <>Customer: {i.customer}<br /></> : null}{i.revenue_model ? <>Money: {i.revenue_model}<br /></> : null}{i.needs ? <>Needs: {i.needs}</> : null}</p>}
          <p className="small muted">{i.sector} · {i.stage} · Funding {money(i.funding_needed, 'en')} · {i.profiles?.full_name} · {i.profiles?.phone}</p>
          <select aria-label="Idea status" value={i.status} onChange={(e) => change(i, e.target.value)}>
            {['new', 'reviewing', 'matched', 'declined'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}

const SERVICE_NAMES = { marketing_agency: 'Marketing agency', media_buying: 'Media buying' };
const BUDGET_NAMES = { low: 'Under EGP 1,000', mid: 'EGP 1,000–5,000', high: 'Over EGP 5,000', unsure: 'Not sure' };

function AdminServices({ notify }) {
  const { loading, data, error, reload } = useLoad(() => api.adminRequests(), []);
  const agencies = useLoad(() => api.adminAgencies(), []);
  const [unread, setUnread] = useState({});
  React.useEffect(() => { api.unreadCounts().then(setUnread).catch(() => {}); }, [data]);
  async function assign(r, agencyId) { try { await api.assignAgency(r.id, agencyId); notify(agencyId ? 'Agency assigned' : 'Agency removed'); reload(); } catch (e) { notify(e.message); } }
  const [filter, setFilter] = useState('new');
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  async function change(r, status) { try { await api.setRequestStatus(r.id, status); notify('Request updated'); reload(); } catch (e) { notify(e.message); } }
  const counts = { new: 0, contacted: 0, done: 0 };
  data.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
  const list = data.filter((r) => filter === 'all' || r.status === filter);
  return (
    <>
      <div className="chips scroll">
        {['new', 'contacted', 'done', 'all'].map((s) => <button type="button" key={s} className="chip" aria-pressed={filter === s} onClick={() => setFilter(s)}>{s}{s !== 'all' ? ` (${counts[s]})` : ''}</button>)}
      </div>
      {list.length === 0 ? <div className="card empty"><p>No service requests here.</p></div> : (
        <div className="list">
          {list.map((r) => (
            <div key={r.id} className="card">
              <div className="row-between"><b>{SERVICE_NAMES[r.service] || r.service}{r.businesses?.name ? ` · ${r.businesses.name}` : ''}</b><span className="muted small">{date(r.created_at, 'en')}</span></div>
              <p className="small">{r.details}</p>
              <p className="small muted">Budget: {BUDGET_NAMES[r.budget] || r.budget || '—'} · {r.seller?.full_name} · <span dir="ltr">{r.seller?.phone}</span> · {r.seller?.email}{r.seller?.city ? ` · ${r.seller.city}` : ''}</p>
              <label className="small" htmlFor={`ag-${r.id}`}>Assigned agency</label>
              <select id={`ag-${r.id}`} value={r.agency_id || ''} onChange={(e) => assign(r, e.target.value)}>
                <option value="">— Not assigned (Forsa team replies) —</option>
                {(agencies.data || []).map((a) => <option key={a.id} value={a.id}>{a.full_name || a.email}{a.agency_service ? ` · ${SERVICE_NAMES[a.agency_service] || a.agency_service}` : ''}</option>)}
              </select>
              <Button small variant="ghost" onClick={() => go(`/chat/${r.id}`)}>Open chat{unread[r.id] ? ` · ${unread[r.id]} new` : ''}</Button>
              <select aria-label="Request status" value={r.status} onChange={(e) => change(r, e.target.value)}>
                {['new', 'contacted', 'done'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <RequestCost r={r} onAdded={() => { notify('Cost added to seller analytics'); reload(); }} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// What the seller paid Forsa for this service → added once as a cost in their Analytics.
function RequestCost({ r, onAdded }) {
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const existing = (r.seller_expenses || [])[0];
  if (existing) return <p className="small"><b>Cost in seller analytics:</b> {money(existing.amount, 'en')}</p>;
  async function add() {
    if (!(Number(amount) > 0)) { setErr('Enter the amount the seller paid.'); return; }
    setBusy(true); setErr('');
    try { await api.addRequestCost(r, amount); onAdded(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <label className="small" htmlFor={`rc-${r.id}`}>Seller paid (EGP) → add to their costs</label>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input id={`rc-${r.id}`} type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 1500" />
        <Button small onClick={add} disabled={busy}>Add</Button>
      </div>
      {err && <p className="form-error">{err}</p>}
    </div>
  );
}

// Partner agencies: an agency signs up normally, then the admin turns that account into a partner here.
function AdminPartners({ notify }) {
  const { loading, data, error, reload } = useLoad(() => api.adminAgencies(), []);
  const [email, setEmail] = useState('');
  const [service, setService] = useState('marketing_agency');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function add(ev) {
    ev.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErr('Enter the agency\'s account email.'); return; }
    setBusy(true); setErr('');
    try { await api.makeAgency(email, service); setEmail(''); notify('Partner added'); reload(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function remove(a) { try { await api.removeAgency(a.id); notify('Partner removed'); reload(); } catch (e) { notify(e.message); } }
  return (
    <>
      <form onSubmit={add} noValidate className="card stack">
        <h3>Add a partner agency</h3>
        <p className="small muted">The agency first signs up in the app with its own email. Then enter that email here. It will only see requests you assign to it, and never the seller's phone or email.</p>
        <Field id="pa-e" label="Agency account email" error={err}><input id="pa-e" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field id="pa-s" label="Service"><select id="pa-s" value={service} onChange={(e) => setService(e.target.value)}>{Object.entries(SERVICE_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <button type="submit" className="btn btn-primary block" disabled={busy}>Make partner</button>
      </form>
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : data.length === 0 ? <div className="card empty"><p>No partner agencies yet.</p></div> : (
        <div className="list">
          {data.map((a) => (
            <div key={a.id} className="card">
              <div className="row-between"><b>{a.full_name || a.email}</b><span className="pill pill-confirmed">{SERVICE_NAMES[a.agency_service] || 'Partner'}</span></div>
              <p className="small muted">{a.email} · <span dir="ltr">{a.phone}</span></p>
              <Button small variant="ghost" onClick={() => remove(a)}>Remove partner</Button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------- Manufacturing: partner manufacturers + custom product requests ----------
const C_STEPS = ['requested', 'quoted', 'accepted', 'sample', 'production', 'final_payment', 'live', 'cancelled'];
const C_LABEL = { requested: 'New request', quoted: 'Quote sent', accepted: 'Waiting for deposit', sample: 'Sample', production: 'Production', final_payment: 'Waiting for final payment', live: 'Live', cancelled: 'Cancelled' };

function AdminManufacturing({ notify }) {
  const [view, setView] = useState('Requests');
  return (
    <>
      <div className="switch2">{['Requests', 'Manufacturers'].map((v) => <button type="button" key={v} aria-selected={view === v} onClick={() => setView(v)}>{v}</button>)}</div>
      {view === 'Requests' ? <AdminCustomRequests notify={notify} /> : <AdminManufacturers notify={notify} />}
    </>
  );
}

function AdminCustomRequests({ notify }) {
  const { loading, data, error, reload } = useLoad(() => api.adminCustomRequests(), []);
  const [filter, setFilter] = useState('open');
  const [live, setLive] = useState(null);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const list = data.filter((c) => (filter === 'open' ? !['live', 'cancelled'].includes(c.status) : filter === 'all' ? true : c.status === filter));
  const upd = async (c, patch, msg) => { try { await api.adminUpdateCustom(c.id, patch); notify(msg); reload(); } catch (e) { notify(e.message); } };
  return (
    <>
      <div className="chips scroll">{['open', 'live', 'cancelled', 'all'].map((s) => <button type="button" key={s} className="chip" aria-pressed={filter === s} onClick={() => setFilter(s)}>{s}</button>)}</div>
      {list.length === 0 ? <div className="card empty"><p>No custom product requests here.</p></div> : (
        <div className="list">
          {list.map((c) => (
            <div key={c.id} className="card">
              <div className="row-between"><b>{c.product_type} × {c.quantity}</b><span className={`pill pill-${c.status === 'live' ? 'delivered' : c.status === 'cancelled' ? 'cancelled' : 'pending'}`}>{C_LABEL[c.status]}</span></div>
              <p className="small">{c.details || '—'}</p>
              <p className="small muted">{c.manufacturers?.code} · {c.manufacturers?.name_en} · Business: {c.businesses?.name} · {c.seller?.full_name} · <span dir="ltr">{c.seller?.phone}</span> · {date(c.created_at, 'en')}</p>
              {c.quote_total != null && <p className="small">Quote: {money(c.quote_unit_price, 'en')}/pc · Total <b>{money(c.quote_total, 'en')}</b> · Deposit {money(c.deposit_amount, 'en')}</p>}
              {c.status === 'requested' || c.status === 'quoted' ? <QuoteForm c={c} onSaved={() => { notify('Quote sent to seller'); reload(); }} /> : null}
              {c.status === 'accepted' && (
                <div className="stack" style={{ gap: 6 }}>
                  <p className="small">Deposit reference: <b dir="ltr">{c.deposit_ref || 'not sent yet'}</b></p>
                  <Button small disabled={!c.deposit_ref} onClick={() => upd(c, { deposit_confirmed: true, status: 'sample' }, 'Deposit confirmed → Sample')}>Confirm deposit → Sample</Button>
                </div>
              )}
              {c.status === 'sample' && <Button small onClick={() => upd(c, { status: 'production' }, 'Moved to production')}>Sample approved → Production</Button>}
              {c.status === 'production' && <Button small onClick={() => upd(c, { status: 'final_payment' }, 'Asked seller for final payment')}>Production done → Ask for final payment</Button>}
              {c.status === 'final_payment' && (
                <div className="stack" style={{ gap: 6 }}>
                  <p className="small">Final payment reference: <b dir="ltr">{c.balance_ref || 'not sent yet'}</b></p>
                  <Button small disabled={!c.balance_ref} onClick={() => setLive(c)}>Confirm payment → Go live</Button>
                </div>
              )}
              <div className="row">
                <Button small variant="ghost" onClick={() => go(`/chat/${c.thread_id}`)}>Open chat</Button>
                {!['live', 'cancelled'].includes(c.status) && <Button small variant="ghost" onClick={() => upd(c, { status: 'cancelled' }, 'Request cancelled')}>Cancel</Button>}
              </div>
            </div>
          ))}
        </div>
      )}
      <GoLiveForm c={live} onClose={() => setLive(null)} onDone={() => { setLive(null); notify('Product is live in the seller\'s business'); reload(); }} />
    </>
  );
}

function QuoteForm({ c, onSaved }) {
  const [unit, setUnit] = useState(c.quote_unit_price ?? '');
  const [dep, setDep] = useState(50);
  const [note, setNote] = useState(c.quote_note || '');
  const [err, setErr] = useState('');
  const total = Math.round(Number(unit) * c.quantity) || 0;
  async function send() {
    if (!(Number(unit) > 0)) { setErr('Enter the price per piece.'); return; }
    try { await api.adminUpdateCustom(c.id, { quote_unit_price: Math.round(Number(unit)), quote_total: total, deposit_amount: Math.round(total * Number(dep) / 100), quote_note: note.slice(0, 1000), status: 'quoted' }); onSaved(); }
    catch (e) { setErr(e.message); }
  }
  return (
    <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <b className="small">{c.status === 'quoted' ? 'Update quote' : 'Send quote'}</b>
      <div className="two-col">
        <Field id={`q-u-${c.id}`} label="Price per piece (EGP)"><input id={`q-u-${c.id}`} type="number" value={unit} onChange={(e) => setUnit(e.target.value)} /></Field>
        <Field id={`q-d-${c.id}`} label="Deposit %"><input id={`q-d-${c.id}`} type="number" min="0" max="100" value={dep} onChange={(e) => setDep(e.target.value)} /></Field>
      </div>
      <p className="small">Total {money(total, 'en')} · Deposit {money(Math.round(total * Number(dep) / 100), 'en')}</p>
      <Field id={`q-n-${c.id}`} label="Note to seller (optional)"><input id={`q-n-${c.id}`} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {err && <p className="form-error">{err}</p>}
      <Button small onClick={send}>Send quote</Button>
    </div>
  );
}

function GoLiveForm({ c, onClose, onDone }) {
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  React.useEffect(() => {
    if (c) setF({ name_en: c.product_type, name_ar: c.product_type, description_en: c.details || '', description_ar: c.details || '', category: 'Other', factory_code: c.manufacturers?.code || '', region: '', quality_score: 4.8, wholesale_price: 20, min_price: '', suggested_price: '', ship_days: 2, image_url: '' });
    setErr('');
  }, [c]);
  if (!c || !f) return null;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function upload(e) {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true); try { const url = await api.uploadProductImage(file); setF((x) => ({ ...x, image_url: url })); } catch (er) { setErr(er.message); } finally { setBusy(false); }
  }
  async function save(ev) {
    ev.preventDefault();
    const w = Number(f.wholesale_price); const m = Number(f.min_price); const s = Number(f.suggested_price);
    if (!f.name_en || !f.name_ar) { setErr('Names are required.'); return; }
    if (!(w > 0) || m < w || s < m) { setErr('Prices must be: fee > 0, minimum ≥ fee, suggested ≥ minimum.'); return; }
    setBusy(true); setErr('');
    try { await api.goLive(c, f); onDone(); } catch (er) { setErr(er.message); } finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title="Go live: seller's product">
      <form onSubmit={save} noValidate className="stack">
        <p className="small muted">This creates a private product only {c.seller?.full_name} can see and sell, adds it to “{c.businesses?.name}”, sets stock to {c.quantity}, and records {money(c.quote_total, 'en')} as a production cost in their analytics.</p>
        {f.image_url && <img className="form-img" src={f.image_url} alt="" />}
        <Field id="gl-img" label="Photo"><input id="gl-img" type="file" accept="image/*" onChange={upload} /></Field>
        <Field id="gl-en" label="Name (English)"><input id="gl-en" value={f.name_en} onChange={set('name_en')} /></Field>
        <Field id="gl-ar" label="Name (Arabic)"><input id="gl-ar" dir="rtl" value={f.name_ar} onChange={set('name_ar')} /></Field>
        <Field id="gl-de" label="Description (English)"><textarea id="gl-de" rows="2" value={f.description_en} onChange={set('description_en')} /></Field>
        <Field id="gl-da" label="Description (Arabic)"><textarea id="gl-da" dir="rtl" rows="2" value={f.description_ar} onChange={set('description_ar')} /></Field>
        <div className="two-col">
          <Field id="gl-w" label="Forsa fee per order (EGP)" hint="Handling & shipping cost per piece"><input id="gl-w" type="number" value={f.wholesale_price} onChange={set('wholesale_price')} /></Field>
          <Field id="gl-d" label="Ships in (days)"><input id="gl-d" type="number" value={f.ship_days} onChange={set('ship_days')} /></Field>
          <Field id="gl-m" label="Minimum price"><input id="gl-m" type="number" value={f.min_price} onChange={set('min_price')} /></Field>
          <Field id="gl-s" label="Suggested price"><input id="gl-s" type="number" value={f.suggested_price} onChange={set('suggested_price')} /></Field>
        </div>
        {err && <p className="form-error" role="alert">{err}</p>}
        <button type="submit" className="btn btn-primary block" disabled={busy}>{busy ? 'Working…' : 'Confirm payment & go live'}</button>
      </form>
    </Sheet>
  );
}

const EMPTY_MAKER = { code: '', name_en: '', name_ar: '', description_en: '', description_ar: '', options_en: '', options_ar: '', image_url: '', min_qty: 50, price_from: 0, lead_days: 14, active: true };

function AdminManufacturers({ notify }) {
  const { loading, data, error, reload } = useLoad(() => api.listManufacturers({ all: true }), []);
  const [edit, setEdit] = useState(null);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <>
      <Button block onClick={() => setEdit({ ...EMPTY_MAKER })}>+ Add manufacturer</Button>
      <p className="small muted">Sellers see only the code and the description, never the factory's real name.</p>
      <div className="list">
        {data.map((m) => (
          <button type="button" key={m.id} className="order-row" onClick={() => setEdit({ ...m })}>
            <div className="or-main"><b>{m.code} · {m.name_en}</b><span className="muted small">Min {m.min_qty} pcs · from {money(m.price_from, 'en')}/pc · {m.lead_days} days</span></div>
            <span className={`pill pill-${m.active ? 'delivered' : 'cancelled'}`}>{m.active ? 'Active' : 'Hidden'}</span>
          </button>
        ))}
      </div>
      <MakerForm maker={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); notify('Manufacturer saved'); reload(); }} />
    </>
  );
}

function MakerForm({ maker, onClose, onSaved }) {
  const [f, setF] = useState(maker);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  React.useEffect(() => { setF(maker); setErr(''); }, [maker]);
  if (!maker || !f) return null;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function upload(e) {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true); try { const url = await api.uploadProductImage(file); setF((x) => ({ ...x, image_url: url })); } catch (er) { setErr(er.message); } finally { setBusy(false); }
  }
  async function save(ev) {
    ev.preventDefault();
    if (!f.code || !f.name_en || !f.name_ar) { setErr('Code, English name and Arabic name are required.'); return; }
    if (!(Number(f.min_qty) > 0) || !(Number(f.lead_days) > 0)) { setErr('Minimum quantity and days must be above 0.'); return; }
    setBusy(true); setErr('');
    try { await api.saveManufacturer(f); onSaved(); } catch (er) { setErr(er.message); } finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={f.id ? 'Edit manufacturer' : 'Add manufacturer'}>
      <form onSubmit={save} noValidate className="stack">
        {f.image_url && <img className="form-img" src={f.image_url} alt="" />}
        <Field id="mf-img" label="Photo (optional)"><input id="mf-img" type="file" accept="image/*" onChange={upload} /></Field>
        <div className="two-col">
          <Field id="mf-code" label="Code"><input id="mf-code" placeholder="FM-204" value={f.code} onChange={set('code')} /></Field>
          <Field id="mf-q" label="Min quantity"><input id="mf-q" type="number" value={f.min_qty} onChange={set('min_qty')} /></Field>
          <Field id="mf-p" label="Price from (EGP/pc)"><input id="mf-p" type="number" value={f.price_from} onChange={set('price_from')} /></Field>
          <Field id="mf-d" label="Days to make"><input id="mf-d" type="number" value={f.lead_days} onChange={set('lead_days')} /></Field>
        </div>
        <Field id="mf-en" label="What they make (English)"><input id="mf-en" value={f.name_en} onChange={set('name_en')} placeholder="Natural soaps & skincare" /></Field>
        <Field id="mf-ar" label="What they make (Arabic)"><input id="mf-ar" dir="rtl" value={f.name_ar} onChange={set('name_ar')} /></Field>
        <Field id="mf-de" label="Description (English)"><textarea id="mf-de" rows="2" value={f.description_en} onChange={set('description_en')} /></Field>
        <Field id="mf-da" label="Description (Arabic)"><textarea id="mf-da" dir="rtl" rows="2" value={f.description_ar} onChange={set('description_ar')} /></Field>
        <Field id="mf-oe" label="What sellers can choose (English)"><input id="mf-oe" value={f.options_en} onChange={set('options_en')} /></Field>
        <Field id="mf-oa" label="What sellers can choose (Arabic)"><input id="mf-oa" dir="rtl" value={f.options_ar} onChange={set('options_ar')} /></Field>
        <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> Visible to sellers</label>
        {err && <p className="form-error" role="alert">{err}</p>}
        <button type="submit" className="btn btn-primary block" disabled={busy}>Save manufacturer</button>
      </form>
    </Sheet>
  );
}
