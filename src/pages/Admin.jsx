// Admin panel (English only, for the Forsa team).
import React, { useMemo, useState } from 'react';
import { Button, Field, Header, Spinner, ErrorBox, useLoad, Sheet, money, date, orderProfit, orderFee, orderPayout, orderCostBack, imgSrc, planState, earningsSummary, go } from '../core.jsx';
import { CATEGORIES, GOVERNORATES } from '../lib/i18n.js';
import * as api from '../lib/api.js';

const TABS = ['Orders', 'Products', 'Shipping', 'Websites', 'Manufacturing', 'Sellers', 'AI ads', 'Ideas', 'Services', 'Partners'];
const STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'returned', 'cancelled'];
const PAY_METHODS = { instapay: 'InstaPay', vodafone_cash: 'Vodafone Cash', bank: 'Bank account' };

export function Admin({ notify }) {
  const [tab, setTab] = useState('Orders');
  return (
    <div className="screen admin" dir="ltr" lang="en">
      <Header title="Admin panel" back="/more" noLang />
      <div className="chips scroll" role="tablist">
        {TABS.map((x) => <button type="button" key={x} role="tab" className="chip" aria-pressed={tab === x} aria-selected={tab === x} onClick={() => setTab(x)}>{x}</button>)}
      </div>
      {tab === 'Orders' && <AdminOrders notify={notify} />}
      {tab === 'Products' && <><AdminSellerProducts notify={notify} /><AdminProducts notify={notify} /></>}
      {tab === 'Shipping' && <AdminShipping notify={notify} />}
      {tab === 'Websites' && <><AdminWebsites notify={notify} /><AdminConnections notify={notify} /></>}
      {tab === 'Sellers' && <AdminSellers notify={notify} />}
      {tab === 'AI ads' && <><AdminAdPlans /><AdminAdLessons notify={notify} /></>}
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
              <div className="row-between"><b>#{o.order_no} · {o.products?.name_en} × {o.quantity}{o.source === 'website' ? ' · from website' : o.source === 'shopify' ? ' · from Shopify' : ''}</b><span className={`pill pill-${o.status}`}>{o.status}</span></div>
              <p className="small">Customer: <b>{o.customer_name}</b> · <span dir="ltr">{o.customer_phone}</span><br />{o.address}, {o.governorate}{o.notes ? ` · Note: ${o.notes}` : ''}</p>
              {o.product_options && <p className="small"><b>Product details:</b> {o.product_options}</p>}
              <p className="small muted">Seller: {o.profiles?.full_name} · {o.profiles?.phone} · Factory {o.products?.factory_code} · {date(o.created_at, 'en')}</p>
              <p className="small">Sell {money(o.unit_price, 'en')} · Wholesale {money(o.wholesale_price, 'en')} · Forsa fee {money(orderFee(o), 'en')}{Number(o.fee_pct) ? ` (${Number(o.fee_pct)}%)` : ''} · Seller keeps <b>{money(orderPayout(o), 'en')}</b>{orderCostBack(o) ? ` (incl. his cost back ${money(orderCostBack(o), 'en')})` : ''}{o.status === 'delivered' && o.profit_locked ? ' (locked)' : ''} · Shipping {money(o.shipping_fee || 0, 'en')} · Collect <b>{money(o.unit_price * o.quantity + (o.shipping_fee || 0), 'en')}</b></p>
              {o.own_order && <p className="small"><b>Seller's own number</b> — doesn't count toward 3 pieces.</p>}
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

const EMPTY_PRODUCT = { name_en: '', name_ar: '', description_en: '', description_ar: '', category: 'Clothing', factory_code: '', region: '', quality_score: 4.5, wholesale_price: '', market_price: '', min_price: '', suggested_price: '', ship_days: 3, image_url: '', stock: 0, active: true };

// Products sellers made themselves: approve / reject (reason), then record how many pieces Forsa holds.
const OWN_STATUS = { pending: 'Waiting', approved: 'Approved', rejected: 'Rejected' };
function AdminSellerProducts({ notify }) {
  const { loading, data, error, reload } = useLoad(() => api.adminSellerProducts(), []);
  const [reasons, setReasons] = useState({});
  const [stock, setStock] = useState({});
  const [busy, setBusy] = useState('');
  async function decide(p, status) {
    if (status === 'rejected' && !(reasons[p.id] || '').trim()) { notify('Write a short reason first'); return; }
    setBusy(p.id);
    try { await api.adminReviewProduct(p.id, status, reasons[p.id] || ''); notify(`${p.name_en}: ${OWN_STATUS[status]}`); reload(); } catch (e) { notify(e.message); } finally { setBusy(''); }
  }
  async function saveStock(p) {
    setBusy(p.id);
    try { await api.adminSetStock(p.id, stock[p.id]); notify(`${p.name_en}: ${stock[p.id]} pieces at Forsa`); setStock((s) => ({ ...s, [p.id]: undefined })); reload(); } catch (e) { notify(e.message); } finally { setBusy(''); }
  }
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const list = data || [];
  const waiting = list.filter((p) => p.review_status === 'pending').length;
  return (
    <div className="stack" style={{ marginBottom: 18 }}>
      <div className="section-head"><h2>Sellers' own products{waiting ? ` (${waiting} waiting)` : ''}</h2></div>
      <p className="small muted">Products sellers made themselves. Check the photo and name (no fake brands, nothing illegal). After you approve, the seller sends his pieces to Forsa — enter how many you received. Forsa keeps 10% of the profit; the seller gets the rest + his cost back.</p>
      {list.length === 0 ? <div className="card empty"><p>No seller products yet.</p></div> : (
        <div className="list">
          {list.map((p) => (
            <div key={p.id} className="card stack admin-web">
              <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'center' }}>
                <img src={imgSrc(p.image_url)} alt="" style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover', flex: 'none' }} />
                <div className="or-main"><b>{p.name_en}</b><span className="small muted">{p.profiles?.full_name} · {p.category}</span></div>
                <span className={`pill pill-${p.review_status === 'approved' ? 'delivered' : p.review_status === 'pending' ? 'pending' : 'cancelled'}`}>{OWN_STATUS[p.review_status]}</span>
              </div>
              {p.description_en && <p className="small">{p.description_en}</p>}
              <p className="small">Seller cost {money(p.wholesale_price, 'en')} · Sells for {money(p.suggested_price, 'en')} · Pieces at Forsa <b>{p.stock}</b></p>
              {p.review_reason && <p className="small muted">Reason: {p.review_reason}</p>}
              {p.review_status !== 'approved' && (
                <>
                  <Field id={`asp-r-${p.id}`} label="Reason (needed to reject)"><input id={`asp-r-${p.id}`} maxLength={300} value={reasons[p.id] || ''} onChange={(e) => setReasons((r) => ({ ...r, [p.id]: e.target.value }))} /></Field>
                  <div className="row">
                    <Button small onClick={() => decide(p, 'approved')} disabled={busy === p.id}>Approve</Button>
                    {p.review_status === 'pending' && <Button small variant="ghost" onClick={() => decide(p, 'rejected')} disabled={busy === p.id}>Reject</Button>}
                  </div>
                </>
              )}
              {p.review_status === 'approved' && (
                <div className="row" style={{ alignItems: 'flex-end' }}>
                  <Field id={`asp-s-${p.id}`} label="Pieces Forsa holds now"><input id={`asp-s-${p.id}`} type="number" inputMode="numeric" min="0" value={stock[p.id] ?? ''} placeholder={String(p.stock)} onChange={(e) => setStock((s) => ({ ...s, [p.id]: e.target.value }))} /></Field>
                  <Button small onClick={() => saveStock(p)} disabled={busy === p.id || stock[p.id] === undefined || stock[p.id] === ''}>Save</Button>
                  <Button small variant="ghost" onClick={() => decide(p, 'rejected')} disabled={busy === p.id || !(reasons[p.id] || '').trim()}>Stop selling</Button>
                </div>
              )}
              {p.review_status === 'approved' && <Field id={`asp-r2-${p.id}`} label="Reason (needed to stop selling)"><input id={`asp-r2-${p.id}`} maxLength={300} value={reasons[p.id] || ''} onChange={(e) => setReasons((r) => ({ ...r, [p.id]: e.target.value }))} /></Field>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminProducts({ notify }) {
  const { loading, data, error, reload } = useLoad(() => api.listProducts({ all: true }), []);
  const [edit, setEdit] = useState(null);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <>
      <Button block onClick={() => setEdit({ ...EMPTY_PRODUCT })}>+ Add product</Button>
      <div className="list">
        {data.filter((p) => !p.seller_made).map((p) => (
          <button type="button" key={p.id} className="order-row" onClick={() => setEdit({ ...p })}>
            <img src={imgSrc(p.image_url)} alt="" />
            <div className="or-main"><b>{p.name_en}</b><span className="muted small">{p.owner_id ? 'Private (custom) · ' : ''}{p.factory_code} · W {p.wholesale_price}{p.market_price ? ` · Market ${p.market_price}` : ''} · Min {p.min_price} · Stock {p.stock}</span></div>
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
  const auto = api.priceDefaults({ ...f, min_price: '', suggested_price: f.suggested_price });
  const minAuto = auto.min_price;
  const sugAuto = api.priceDefaults(f).suggested_price;
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
    const w = Number(f.wholesale_price); const pr = api.priceDefaults(f);
    if (!f.name_en || !f.name_ar || !f.factory_code) { setErr('English name, Arabic name and factory code are required.'); return; }
    if (!(w > 0)) { setErr('Enter the wholesale price.'); return; }
    if (pr.market_price != null && !(pr.market_price > 0)) { setErr('Market price must be above 0.'); return; }
    if (pr.min_price == null) { setErr('Enter a minimum price, or a market price (minimum = 90% of it).'); return; }
    if (pr.min_price < w) { setErr(`Minimum price (EGP ${pr.min_price}) can't be below wholesale (EGP ${w}).`); return; }
    if (pr.suggested_price < pr.min_price) { setErr('Suggested price must be at least the minimum price.'); return; }
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
          <Field id="ap-mk" label="Market price"><input id="ap-mk" type="number" value={f.market_price ?? ''} onChange={set('market_price')} /></Field>
          <Field id="ap-m" label="Minimum price" hint={f.min_price === '' && minAuto ? `Empty = ${minAuto} (90% of market)` : undefined}><input id="ap-m" type="number" value={f.min_price} onChange={set('min_price')} placeholder={minAuto ? String(minAuto) : ''} /></Field>
          <Field id="ap-s" label="Suggested price" hint={f.suggested_price === '' && sugAuto ? `Empty = ${sugAuto}` : undefined}><input id="ap-s" type="number" value={f.suggested_price} onChange={set('suggested_price')} placeholder={sugAuto ? String(sugAuto) : ''} /></Field>
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

// Seller websites: requests to accept / reject, live websites to pause, and the delivered-orders condition.
const WEB_STATUS = { requested: 'Waiting', approved: 'Accepted', rejected: 'Rejected', paused: 'Paused' };
const CON_STATUS = { requested: 'Waiting', approved: 'Approved', rejected: 'Rejected', paused: 'Paused' };
function AdminConnections({ notify }) {
  const { loading, data, error, reload } = useLoad(() => api.adminConnections(), []);
  const [reasons, setReasons] = useState({});
  const [busy, setBusy] = useState('');
  async function decide(c, status) {
    if ((status === 'rejected' || status === 'paused') && !(reasons[c.id] || '').trim()) { notify('Write a short reason first'); return; }
    setBusy(c.id);
    try { await api.adminDecideConnection(c.id, status, reasons[c.id] || ''); notify(`${c.business_name}: ${CON_STATUS[status]}`); setReasons((r) => ({ ...r, [c.id]: '' })); reload(); }
    catch (e) { notify(e.message); } finally { setBusy(''); }
  }
  return (
    <div className="stack">
      <div className="section-head"><h2>Connected stores (Shopify)</h2></div>
      <p className="small muted">Sellers ask to connect their own Shopify store. After you approve, they add a webhook in Shopify and their orders come into Forsa as pending ("from Shopify").</p>
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : (data || []).length === 0 ? <div className="card empty"><p>No connection requests yet.</p></div> : (
        <div className="list">
          {data.map((c) => (
            <div key={c.id} className="card stack admin-web">
              <div className="row-between"><b>{c.business_name}</b><span className={`pill pill-${c.status === 'approved' ? 'delivered' : c.status === 'requested' ? 'pending' : 'cancelled'}`}>{CON_STATUS[c.status]}{c.status === 'approved' ? (c.has_secret ? ' · set up' : ' · setup not finished') : ''}</span></div>
              <span className="small muted">{c.owner_name} · Shopify: <code dir="ltr">{c.shop}</code> · requested {date(c.requested_at, 'en')}</span>
              <p className="small">Delivered orders {c.delivered} · Shopify webhooks received {c.orders_count}{c.last_order_at ? ` (last ${date(c.last_order_at, 'en')})` : ''} · Waiting for seller review {c.review}</p>
              {c.reason && <p className="small muted">Reason: {c.reason}</p>}
              {c.status !== 'rejected' && (
                <Field id={`ac-r-${c.id}`} label="Reason (needed to reject or pause)"><input id={`ac-r-${c.id}`} maxLength={300} value={reasons[c.id] || ''} onChange={(e) => setReasons((r) => ({ ...r, [c.id]: e.target.value }))} /></Field>
              )}
              <div className="row">
                {c.status !== 'approved' && c.status !== 'rejected' && <Button small onClick={() => decide(c, 'approved')} disabled={busy === c.id}>{c.status === 'paused' ? 'Un-pause' : 'Approve'}</Button>}
                {c.status === 'requested' && <Button small variant="ghost" onClick={() => decide(c, 'rejected')} disabled={busy === c.id}>Reject</Button>}
                {c.status === 'approved' && <Button small variant="danger" onClick={() => decide(c, 'paused')} disabled={busy === c.id}>Pause</Button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminWebsites({ notify }) {
  const { loading, data, error, reload } = useLoad(() => api.adminWebsites(), []);
  const min = useLoad(() => api.websiteMinOrders(), []);
  const [minEdit, setMinEdit] = useState('');
  const [reasons, setReasons] = useState({});
  const [busy, setBusy] = useState('');
  async function decide(w, status) {
    if ((status === 'rejected' || status === 'paused') && !(reasons[w.id] || '').trim()) { notify('Write a short reason first'); return; }
    setBusy(w.id);
    try { await api.adminDecideWebsite(w.id, status, reasons[w.id] || ''); notify(`${w.business_name}: ${WEB_STATUS[status]}`); setReasons((r) => ({ ...r, [w.id]: '' })); reload(); }
    catch (e) { notify(e.message); } finally { setBusy(''); }
  }
  async function saveMin() {
    const n = Number(minEdit);
    if (!Number.isFinite(n) || n < 0) { notify('Enter a number'); return; }
    try { await api.saveWebsiteMinOrders(n); notify('Saved'); setMinEdit(''); min.reload(); } catch (e) { notify(e.message); }
  }
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '0%');
  return (
    <div className="stack">
      <div className="card stack">
        <b>Condition to request a website</b>
        <p className="small muted">A seller can request a website after this many delivered orders (orders to their own number don't count). You still accept each request.</p>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field id="aw-min" label={`Delivered orders (now ${min.data ?? '…'})`}><input id="aw-min" type="number" inputMode="numeric" min="0" value={minEdit} placeholder={String(min.data ?? 20)} onChange={(e) => setMinEdit(e.target.value)} /></Field>
          <Button small onClick={saveMin} disabled={minEdit === ''}>Save</Button>
        </div>
      </div>
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : (data || []).length === 0 ? <div className="card empty"><p>No website requests yet.</p></div> : (
        <div className="list">
          {data.map((w) => (
            <div key={w.id} className="card stack admin-web">
              <div className="row-between"><b>{w.business_name}</b><span className={`pill pill-${w.status === 'approved' ? 'delivered' : w.status === 'requested' ? 'pending' : 'cancelled'}`}>{WEB_STATUS[w.status]}{w.status === 'approved' ? (w.published ? ' · live' : ' · draft') : ''}</span></div>
              <span className="small muted">{w.owner_name} · requested {date(w.requested_at, 'en')}{w.slug ? ` · /s/${w.slug}` : ''}</span>
              <p className="small">Delivered <b>{w.delivered}</b> · Returned {w.returned} ({pct(w.returned, w.total)}) · Cancelled {w.cancelled} ({pct(w.cancelled, w.total)}) · All orders {w.total} · Active {w.days_active} days</p>
              {w.reason && <p className="small muted">Reason: {w.reason}</p>}
              {w.status === 'approved' && w.published && w.slug && <a className="small" href={`#/s/${w.slug}`} target="_blank" rel="noopener noreferrer">Open website</a>}
              {w.status !== 'rejected' && (
                <Field id={`aw-r-${w.id}`} label="Reason (needed to reject or pause)"><input id={`aw-r-${w.id}`} maxLength={300} value={reasons[w.id] || ''} onChange={(e) => setReasons((r) => ({ ...r, [w.id]: e.target.value }))} /></Field>
              )}
              <div className="row">
                {w.status !== 'approved' && w.status !== 'rejected' && <Button small onClick={() => decide(w, 'approved')} disabled={busy === w.id}>{w.status === 'paused' ? 'Un-pause' : 'Accept'}</Button>}
                {w.status === 'requested' && <Button small variant="ghost" onClick={() => decide(w, 'rejected')} disabled={busy === w.id}>Reject</Button>}
                {w.status === 'approved' && <Button small variant="danger" onClick={() => decide(w, 'paused')} disabled={busy === w.id}>Pause</Button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Shipping price per governorate: the customer pays it on top of the product price. Switched off = no orders there.
function AdminShipping({ notify }) {
  const { loading, data, error, reload } = useLoad(() => api.listShippingRates(), []);
  const [edits, setEdits] = useState({});
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const order = GOVERNORATES.map(([g]) => g);
  const rows = [...data].sort((a, b) => order.indexOf(a.governorate) - order.indexOf(b.governorate));
  async function save(r, patch) {
    const next = { ...r, ...patch };
    if (!(Number(next.fee) >= 0) || Number(next.fee) > 2000) { notify('Enter a price between 0 and 2,000'); return; }
    try { await api.saveShippingRate(r.governorate, next.fee, next.active); setEdits((e) => ({ ...e, [r.governorate]: undefined })); notify(`${r.governorate} saved`); reload(); }
    catch (e) { notify(e.message); }
  }
  return (
    <>
      <p className="small muted">Shipping price the customer pays for each governorate (added to the total to collect). Turn a governorate off to stop orders there.</p>
      <div className="card stack">
        {rows.map((r) => {
          const v = edits[r.governorate] ?? r.fee;
          return (
            <div key={r.governorate} className="ship-row">
              <label htmlFor={`sh-${r.governorate}`} className="small"><b>{r.governorate}</b>{!r.active && <span className="muted"> · off</span>}</label>
              <input id={`sh-${r.governorate}`} type="number" min="0" value={v} onChange={(e) => setEdits({ ...edits, [r.governorate]: e.target.value })}
                onBlur={() => { if (String(v) !== String(r.fee)) save(r, { fee: v }); }} aria-label={`${r.governorate} shipping price (EGP)`} />
              <label className="check small"><input type="checkbox" checked={r.active} onChange={(e) => save(r, { fee: v, active: e.target.checked })} /> On</label>
            </div>
          );
        })}
      </div>
    </>
  );
}

function AdminSellers({ notify }) {
  const { loading, data, error, reload } = useLoad(() => api.adminSellers(), []);
  const [payFor, setPayFor] = useState(null);
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    if (!data) return [];
    return data.profiles.map((p) => {
      const mine = data.orders.filter((o) => o.seller_id === p.id);
      const sum = earningsSummary(mine, data.payouts.filter((x) => x.seller_id === p.id));
      return { ...p, plan: planState(p, mine), orders: mine.length, delivered: mine.filter((o) => o.status === 'delivered').length,
        earned: sum.earned, locked: sum.locked, fees: sum.fees, paid: sum.paidOut, balance: sum.earned - sum.paidOut,
        ownerBiz: (data.ownerBiz || []).filter((b) => b.owner_id === p.id).map((b) => b.name) };
    }).sort((a, b) => b.balance - a.balance);
  }, [data]);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const totalDue = rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
  return (
    <>
      <div className="stats two"><div className="stat"><span>Sellers</span><b>{rows.length}</b></div><div className="stat"><span>Total balance due</span><b>{money(totalDue, 'en')}</b></div></div>
      <Field id="sl-q" label="Find a user"><input id="sl-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or email" /></Field>
      <div className="list">
        {rows.filter((r) => !q.trim() || [r.full_name, r.phone, r.email].some((v) => String(v || '').toLowerCase().includes(q.trim().toLowerCase()))).map((r) => (
          <div key={r.id} className="card">
            <div className="row-between"><b>{r.full_name || r.email}</b><span className={`pill pill-${r.plan.unlocked ? 'delivered' : 'pending'}`}>{r.plan.unlocked ? 'Unlocked' : 'Locked'}</span></div>
            <p className="small muted">{r.plan.unlocked ? `Unlocked until ${date(r.plan.unlockedUntil, 'en')} (${r.plan.daysLeft} days left)` : `Locked · ${r.plan.held}/3 pieces delivered`}</p>
            <p className="small muted">{r.phone} · {r.email} · {r.city}{r.university ? ` · ${r.university}` : ''}</p>
            <p className="small">Orders {r.orders} · Delivered {r.delivered} · Earned {money(r.earned, 'en')} · Locked {money(r.locked, 'en')} · Forsa fees {money(r.fees, 'en')} · Paid {money(r.paid, 'en')} · <b>Due {money(r.balance, 'en')}</b></p>
            <p className="small">{r.payout_method ? <>Pays to: <b>{PAY_METHODS[r.payout_method]}</b> · {r.payout_holder}{r.payout_bank ? ` · ${r.payout_bank}` : ''} · <span dir="ltr">{r.payout_account}</span></> : <span className="muted">No payout details yet</span>}</p>
            <OwnerAccess r={r} notify={notify} reload={reload} />
            {r.balance > 0 && <Button small onClick={() => setPayFor(r)}>Record payout</Button>}
          </div>
        ))}
      </div>
      <PayoutForm seller={payFor} onClose={() => setPayFor(null)} onSaved={() => { setPayFor(null); notify('Payout recorded'); reload(); }} />
    </>
  );
}

// Product-owner access (factory-deal customers): one pass = his NEXT new business gets
// "Add my own product" + "Connect existing website". Later businesses are normal unless given again.
function OwnerAccess({ r, notify, reload }) {
  const [busy, setBusy] = useState(false);
  async function set(on) {
    setBusy(true);
    try { await api.adminSetOwnerPass(r.id, on); notify(on ? 'Access given for his next new business' : 'Access cancelled'); reload(); } catch (e) { notify(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="owner-access">
      {r.ownerBiz.length > 0 && <p className="small">Product-owner business: <b>{r.ownerBiz.join(', ')}</b></p>}
      {r.owner_pass ? (
        <div className="row-between"><span className="pill pill-pending">Access ready for his next new business</span>
          <button type="button" className="link-btn" disabled={busy} onClick={() => set(false)}>Cancel</button></div>
      ) : (
        <Button small variant="ghost" disabled={busy} onClick={() => set(true)}>Give product-owner access</Button>
      )}
    </div>
  );
}

function PayoutForm({ seller, onClose, onSaved }) {
  const [f, setF] = useState({ amount: '', method: 'instapay', reference: '' });
  const [err, setErr] = useState('');
  React.useEffect(() => { if (seller) setF({ amount: seller.balance, method: seller.payout_method || 'instapay', reference: '' }); }, [seller]);
  if (!seller) return null;
  async function save(ev) {
    ev.preventDefault();
    if (!(Number(f.amount) > 0)) { setErr('Enter an amount.'); return; }
    try { await api.recordPayout({ seller_id: seller.id, ...f }); onSaved(); } catch (e) { setErr(e.message); }
  }
  return (
    <Sheet open onClose={onClose} title={`Payout to ${seller.full_name}`}>
      <form onSubmit={save} noValidate className="stack">
        <p className="small muted">Balance due: {money(seller.balance, 'en')}{seller.locked > 0 ? ` · ${money(seller.locked, 'en')} locked (not due yet)` : ''}</p>
        {seller.payout_method ? <p className="small">Send to <b>{PAY_METHODS[seller.payout_method]}</b>: {seller.payout_holder}{seller.payout_bank ? ` · ${seller.payout_bank}` : ''} · <b dir="ltr">{seller.payout_account}</b></p> : <p className="small form-error">This seller hasn't added payout details yet.</p>}
        <Field id="po-a" label="Amount (EGP)"><input id="po-a" type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field id="po-m" label="Method"><select id="po-m" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(PAY_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
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
const C_LABEL = { requested: 'New request', quoted: 'Quote sent', accepted: 'Waiting for deposit', sample: 'Sample', production: 'Production', final_payment: 'Waiting for final payment', live: 'Done', cancelled: 'Cancelled' };

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
              <p className="small"><b>Delivery:</b> {c.fulfillment === 'self' ? `Whole batch to seller → ${c.ship_address}, ${c.ship_governorate}` : 'Forsa stores & ships each order'}</p>
              {c.quote_total != null && <p className="small">Quote: {money(c.quote_unit_price, 'en')}/pc · Total <b>{money(c.quote_total, 'en')}</b> · Deposit {money(c.deposit_amount, 'en')}{c.custom_request_costs ? <> · Factory {money(c.custom_request_costs.factory_unit_price, 'en')}/pc · Forsa {Number(c.custom_request_costs.forsa_pct)}% = <b>{money(c.quote_total - c.custom_request_costs.factory_unit_price * c.quantity, 'en')}</b></> : null}</p>}
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
                  {c.fulfillment === 'self'
                    ? <Button small disabled={!c.balance_ref} onClick={async () => { try { await api.markSentToSeller(c); notify('Marked as sent to seller'); reload(); } catch (e) { notify(e.message); } }}>Confirm payment → Batch sent to seller</Button>
                    : <Button small disabled={!c.balance_ref} onClick={() => setLive(c)}>Confirm payment → Go live</Button>}
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

// R7: the admin enters the factory price and Forsa's % for this deal (no default). The seller sees only the final price.
function QuoteForm({ c, onSaved }) {
  const saved = c.custom_request_costs;
  const [factory, setFactory] = useState(saved?.factory_unit_price ?? '');
  const [pct, setPct] = useState(saved?.forsa_pct ?? '');
  const [dep, setDep] = useState(50);
  const [note, setNote] = useState(c.quote_note || '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const fp = Number(factory); const pc = Number(pct);
  const unit = fp > 0 && pct !== '' && pc >= 0 ? Math.round(fp * (1 + pc / 100)) : 0;
  const total = unit * c.quantity;
  const forsaShare = total - Math.round(fp * c.quantity);
  async function send() {
    if (!(fp > 0)) { setErr('Enter the factory price per piece.'); return; }
    if (pct === '' || !(pc >= 0) || pc > 500) { setErr('Enter Forsa % for this deal (0–500).'); return; }
    setBusy(true); setErr('');
    try {
      await api.saveDealCost(c.id, fp, pc);
      await api.adminUpdateCustom(c.id, { quote_unit_price: unit, quote_total: total, deposit_amount: Math.round(total * Number(dep) / 100), quote_note: note.slice(0, 1000), status: 'quoted' });
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <b className="small">{c.status === 'quoted' ? 'Update quote' : 'Send quote'}</b>
      <div className="two-col">
        <Field id={`q-f-${c.id}`} label="Factory price / piece (EGP)"><input id={`q-f-${c.id}`} type="number" min="0" value={factory} onChange={(e) => setFactory(e.target.value)} /></Field>
        <Field id={`q-p-${c.id}`} label="Forsa % (this deal)"><input id={`q-p-${c.id}`} type="number" min="0" max="500" step="0.5" value={pct} onChange={(e) => setPct(e.target.value)} /></Field>
        <Field id={`q-d-${c.id}`} label="Deposit %"><input id={`q-d-${c.id}`} type="number" min="0" max="100" value={dep} onChange={(e) => setDep(e.target.value)} /></Field>
      </div>
      <p className="small">Seller price {money(unit, 'en')}/pc · Total <b>{money(total, 'en')}</b> · Deposit {money(Math.round(total * Number(dep) / 100), 'en')}<br />Factory {money(Math.round(fp * c.quantity) || 0, 'en')} · <b>Forsa share {money(unit ? forsaShare : 0, 'en')}</b> (seller only sees the total)</p>
      <Field id={`q-n-${c.id}`} label="Note to seller (optional)"><input id={`q-n-${c.id}`} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {err && <p className="form-error">{err}</p>}
      <Button small onClick={send} disabled={busy}>Send quote</Button>
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

// ---------- AI media buyer (pilot follow-up) ----------
function AdminAdPlans() {
  const { loading, error, data, reload } = useLoad(() => api.adminAdPlans(), []);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const list = data || [];
  const count = (f) => list.filter(f).length;
  return (
    <>
      <div className="section-head"><h2>AI ad plans ({list.length})</h2></div>
      <p className="small muted">Approved {count((p) => p.status !== 'draft' && p.status !== 'stopped')} · Helpful 👍 {count((p) => p.feedback === 1)} · Not helpful 👎 {count((p) => p.feedback === -1)}.
        Read the 👎 notes and turn what you learn into lessons below.</p>
      {list.length === 0 ? <div className="card empty"><p>No AI ad plans yet.</p></div> : (
        <div className="list">
          {list.map((p) => (
            <button type="button" key={p.id} className="order-row" onClick={() => go(`/ads/${p.id}`)}>
              {p.plan?.image_url ? <img src={imgSrc(p.plan.image_url)} alt="" /> : null}
              <span className="or-main"><b>{p.plan?.product_name || 'Ad plan'} · {p.profiles?.full_name || 'Seller'}</b>
                <span className="small muted">{date(p.created_at, 'en')} · {money(p.plan?.budget?.total || 0, 'en')} · {p.plan?.objective || ''}{p.revisions ? ` · ${p.revisions} changes` : ''}</span>
                {p.feedback_note && <span className="small">“{p.feedback_note}”</span>}</span>
              <span className="or-side"><span className="pill pill-pending">{p.status}</span>{p.feedback === 1 ? <span>👍</span> : p.feedback === -1 ? <span>👎</span> : null}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// The AI's memory: short lessons it reads before writing every plan. This is how R&D upgrades the AI without code.
function AdminAdLessons({ notify }) {
  const { loading, error, data, reload } = useLoad(() => api.adLessons(), []);
  const [f, setF] = useState({ category: 'All', lesson: '', evidence: '' });
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault(); setBusy(true);
    try { await api.saveAdLesson(f); setF({ category: f.category, lesson: '', evidence: '' }); notify('Lesson saved — the AI uses it from the next plan'); reload(); } catch (er) { notify(er.message); } finally { setBusy(false); }
  }
  async function toggle(l) { try { await api.saveAdLesson({ ...l, active: !l.active }); reload(); } catch (er) { notify(er.message); } }
  return (
    <>
      <div className="section-head"><h2>AI lessons (R&amp;D)</h2></div>
      <p className="small muted">Short rules the AI reads before every plan, e.g. what worked for a category. "All" applies to every product. Turn a lesson off when new results disagree.</p>
      <form className="card stack" onSubmit={save}>
        <Field id="al-cat" label="Category">
          <select id="al-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            <option value="All">All products</option>{CATEGORIES.map(([v]) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <Field id="al-text" label="Lesson"><textarea id="al-text" rows="3" maxLength={600} value={f.lesson} onChange={(e) => setF({ ...f, lesson: e.target.value })} placeholder="e.g. For accessories, the gift angle got orders 40% cheaper than the price angle." /></Field>
        <Field id="al-ev" label="Based on how many ads (optional)"><input id="al-ev" type="number" inputMode="numeric" min="0" value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} /></Field>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add lesson'}</Button>
      </form>
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
        <div className="list">
          {(data || []).map((l) => (
            <div key={l.id} className="card admin-web">
              <div className="row-between"><b>{l.category}{l.evidence ? ` · ${l.evidence} ads` : ''}</b><span className={`pill ${l.active ? 'pill-delivered' : 'pill-cancelled'}`}>{l.active ? 'On' : 'Off'}</span></div>
              <p className="small">{l.lesson}</p>
              <button type="button" className="link-btn" onClick={() => toggle(l)}>{l.active ? 'Turn off' : 'Turn on'}</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
