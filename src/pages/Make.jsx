// "Make your own product" (partner manufacturers) and the Messages inbox.
import React, { useEffect, useState } from 'react';
import { useApp, Button, Field, Header, Spinner, ErrorBox, useLoad, Icon, go, money, num, date } from '../core.jsx';
import { PAYMENT_INFO } from '../config.js';
import { GOVERNORATES } from '../lib/i18n.js';
import { BizLogo } from './Business.jsx';
import * as api from '../lib/api.js';

const mname = (m, lang) => (m ? (lang === 'ar' ? m.name_ar : m.name_en) : '');
const STEPS = ['requested', 'quoted', 'accepted', 'sample', 'production', 'final_payment', 'live'];
const pillFor = (s) => (s === 'live' ? 'delivered' : s === 'cancelled' ? 'cancelled' : ['quoted', 'accepted', 'final_payment'].includes(s) ? 'pending' : 'confirmed');

// Switch at the top of the Products tab.
export function ProductSwitch({ active }) {
  const { t } = useApp();
  return (
    <div className="switch2" role="tablist">
      <button type="button" role="tab" aria-selected={active === 'ready'} onClick={() => go('/products')}>{t('readyProducts')}</button>
      <button type="button" role="tab" aria-selected={active === 'make'} onClick={() => go('/make')}>{t('makeYourOwn')}</button>
    </div>
  );
}

function MakerIcon({ m, size = 48 }) {
  return m?.image_url ? <img className="biz-logo" src={m.image_url} alt="" style={{ width: size, height: size }} />
    : <span className="biz-logo maker" style={{ width: size, height: size }}><Icon name="factory" size={size * 0.48} /></span>;
}

// Where the finished batch goes: Forsa stores & ships each order, or the whole batch goes to the seller.
function FulfillmentPicker({ value, onChange, error }) {
  const { t, lang } = useApp();
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <fieldset className="choice">
      <legend>{t('fulfillTitle')}</legend>
      {['forsa', 'self'].map((k) => (
        <label key={k} className={`choice-opt${value.fulfillment === k ? ' on' : ''}`}>
          <input type="radio" name="fulfillment" value={k} checked={value.fulfillment === k} onChange={() => onChange({ ...value, fulfillment: k })} />
          <span><b>{t(`fulfill_${k}`)}</b><small>{t(`fulfill_${k}_d`)}</small></span>
        </label>
      ))}
      {value.fulfillment === 'self' && (
        <div className="stack" style={{ gap: 10 }}>
          <Field id="ff-gov" label={t('city')}>
            <select id="ff-gov" value={value.ship_governorate || 'Cairo'} onChange={set('ship_governorate')}>{GOVERNORATES.map(([en, ar]) => <option key={en} value={en}>{lang === 'ar' ? ar : en}</option>)}</select>
          </Field>
          <Field id="ff-addr" label={t('shipAddress')} error={error}><textarea id="ff-addr" rows="2" maxLength={300} value={value.ship_address || ''} onChange={set('ship_address')} /></Field>
        </div>
      )}
    </fieldset>
  );
}
const govName = (g, lang) => (lang === 'ar' ? (GOVERNORATES.find((x) => x[0] === g)?.[1] || g) : g);

// ---------- Make your own: manufacturers + my requests ----------
export function MakeHome() {
  const { t, lang } = useApp();
  const makers = useLoad(() => api.listManufacturers(), []);
  const mine = useLoad(() => api.myCustomRequests(), []);
  return (
    <div className="screen">
      <Header title={t('products')} />
      <ProductSwitch active="make" />
      <p className="lead">{t('makeLead')}</p>
      {(mine.data || []).length > 0 && (
        <>
          <div className="section-head"><h2>{t('myCustom')}</h2></div>
          <div className="list">
            {mine.data.map((c) => (
              <button type="button" key={c.id} className="order-row" onClick={() => go(`/make/r/${c.id}`)}>
                <MakerIcon m={c.manufacturers} size={44} />
                <div className="or-main"><b>{c.product_type}</b><span className="muted small">{t('pieces', { n: num(c.quantity, lang) })} · {c.businesses?.name}</span></div>
                <span className={`pill pill-${pillFor(c.status)}`}>{t(`cstatus_${c.status}`)}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="section-head"><h2>{t('manufacturersTitle')}</h2></div>
      {makers.loading ? <Spinner /> : makers.error ? <ErrorBox error={makers.error} onRetry={makers.reload} /> : (
        <div className="list">
          {makers.data.map((m) => (
            <button type="button" key={m.id} className="card maker-card" onClick={() => go(`/make/m/${m.id}`)}>
              <div className="biz-head">
                <MakerIcon m={m} />
                <div className="or-main"><b>{mname(m, lang)}</b><span className="muted small">Forsa Factory {m.code}</span></div>
                <Icon name="chevron" size={16} />
              </div>
              <p className="small muted">{lang === 'ar' ? m.description_ar : m.description_en}</p>
              <div className="biz-chips"><span>{t('minQty', { n: num(m.min_qty, lang) })}</span><span>{t('priceFrom', { p: money(m.price_from, lang) })}</span><span>{t('leadDays', { n: num(m.lead_days, lang) })}</span></div>
            </button>
          ))}
        </div>
      )}
      <p className="muted small">{t('customNote')}</p>
    </div>
  );
}

// ---------- One manufacturer + start form ----------
export function ManufacturerPage({ id, data, notify }) {
  const { t, lang } = useApp();
  const makers = useLoad(() => api.listManufacturers(), []);
  const businesses = data.businesses || [];
  const m = (makers.data || []).find((x) => x.id === id);
  const [f, setF] = useState({ business_id: '', product_type: '', details: '', quantity: '', fulfillment: 'forsa', ship_governorate: 'Cairo', ship_address: '' });
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (m) setF((x) => ({ ...x, business_id: x.business_id || businesses[0]?.id || '', quantity: x.quantity || String(m.min_qty) })); }, [m?.id, businesses.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (makers.loading) return <div className="screen"><Header title="" back="/make" /><Spinner /></div>;
  if (!m) return <div className="screen"><Header title="" back="/make" /><ErrorBox error={makers.error} onRetry={makers.reload} /></div>;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(ev) {
    ev.preventDefault();
    const e = {};
    if (!f.business_id) e.business = t('businessRequired');
    if (f.product_type.trim().length < 2) e.product_type = t('required');
    const q = Number(f.quantity);
    if (!(q >= m.min_qty)) e.quantity = t('minQtyErr', { n: num(m.min_qty, lang) });
    if (f.fulfillment === 'self' && !f.ship_address.trim()) e.address = t('required');
    setErr(e); if (Object.keys(e).length) return;
    setBusy(true);
    try { const c = await api.startCustomRequest({ ...f, manufacturer: m }); notify(t('customSent')); go(`/make/r/${c.id}`); }
    catch (er) { setErr({ form: er.message }); } finally { setBusy(false); }
  }
  return (
    <div className="screen">
      <Header title="" back="/make" />
      <div className="biz-head"><MakerIcon m={m} size={56} /><div className="or-main"><h1 className="biz-name">{mname(m, lang)}</h1><span className="muted small">Forsa Factory {m.code}</span></div></div>
      <p>{lang === 'ar' ? m.description_ar : m.description_en}</p>
      <div className="price-grid">
        <div><span>{t('quantityPieces')}</span><b>{t('pieces', { n: num(m.min_qty, lang) })}</b></div>
        <div><span>{t('unitPrice')}</span><b>{t('priceFrom', { p: money(m.price_from, lang) })}</b></div>
        <div><span>{t('step_production')}</span><b>{t('leadDays', { n: num(m.lead_days, lang) })}</b></div>
      </div>
      {(m.options_en || m.options_ar) && <div className="card"><h3>{t('youCanChoose')}</h3><p className="small">{lang === 'ar' ? m.options_ar : m.options_en}</p></div>}
      {businesses.length === 0 ? (
        <div className="card"><p>{t('needBusinessFirst')}</p><Button onClick={() => go('/business')}>{t('createBusiness')}</Button></div>
      ) : (
        <form onSubmit={submit} noValidate className="card stack">
          <h3>{t('startProduct')}</h3>
          {businesses.length > 1 && (
            <Field id="mk-biz" label={t('orderFor')} error={err.business}>
              <select id="mk-biz" value={f.business_id} onChange={set('business_id')}>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            </Field>
          )}
          <Field id="mk-type" label={t('productType')} error={err.product_type}><input id="mk-type" maxLength={80} placeholder={t('productTypeHint')} value={f.product_type} onChange={set('product_type')} /></Field>
          <Field id="mk-det" label={t('yourChoices')}><textarea id="mk-det" rows="3" maxLength={2000} value={f.details} onChange={set('details')} /></Field>
          <Field id="mk-q" label={t('quantityPieces')} error={err.quantity}><input id="mk-q" inputMode="numeric" dir="ltr" value={f.quantity} onChange={set('quantity')} /></Field>
          {Number(f.quantity) > 0 && m.price_from > 0 && <p className="muted small">≈ {money(Number(f.quantity) * m.price_from, lang)}+</p>}
          <FulfillmentPicker value={f} onChange={(v) => setF({ ...f, ...v })} error={err.address} />
          {err.form && <p className="form-error" role="alert">{err.form}</p>}
          <button type="submit" className="btn btn-primary block" disabled={busy}>{busy ? t('loading') : t('startProduct')}</button>
        </form>
      )}
    </div>
  );
}

// ---------- Track one custom product request ----------
export function CustomRequestPage({ id, notify, reload: reloadData }) {
  const { t, lang } = useApp();
  const { loading, data: c, error, reload } = useLoad(() => api.getCustomRequest(id), [id]);
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [editShip, setEditShip] = useState(null);
  const [shipErr, setShipErr] = useState('');
  if (loading) return <div className="screen"><Header title="" back="/make" /><Spinner /></div>;
  if (error || !c) return <div className="screen"><Header title="" back="/make" /><ErrorBox error={error} onRetry={reload} /></div>;
  const idx = STEPS.indexOf(c.status);
  const act = async (fn, msg) => { setBusy(true); try { await fn(); if (msg) notify(t(msg)); setRef(''); reload(); reloadData?.(); } catch (e) { notify(e.message); } finally { setBusy(false); } };
  const rest = (c.quote_total || 0) - (c.deposit_amount || 0);
  const payBox = (title, amount, current, submit) => (
    <div className="card stack">
      <h3>{title}</h3>
      <p>{t('payTo', { a: money(amount, lang) })}</p>
      <dl className="kv"><dt>InstaPay</dt><dd dir="ltr">{PAYMENT_INFO.instapay}</dd><dt>Vodafone Cash</dt><dd dir="ltr">{PAYMENT_INFO.vodafone_cash}</dd></dl>
      {current ? <p className="small">{t('waitingConfirm', { r: current })}</p> : null}
      <Field id="cr-ref" label={t('reference')}><input id="cr-ref" dir="ltr" maxLength={80} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      <Button block disabled={busy || !ref.trim()} onClick={() => act(() => submit(c.id, ref), 'refSent')}>{t('submitPayment')}</Button>
    </div>
  );
  return (
    <div className="screen">
      <Header title={t('svc_custom_product')} back="/make" />
      <div className="biz-head"><MakerIcon m={c.manufacturers} size={52} /><div className="or-main"><h1 className="biz-name">{c.product_type}</h1><span className="muted small">{t('pieces', { n: num(c.quantity, lang) })} · {t('madeFor', { b: c.businesses?.name || '' })}</span></div></div>
      {c.details && <p className="small">{c.details}</p>}
      {c.status === 'cancelled' ? <span className="pill pill-cancelled" style={{ width: 'max-content' }}>{t('cstatus_cancelled')}</span> : (
        <ol className="steps" aria-label={t(`cstatus_${c.status}`)}>
          {STEPS.map((s, i) => <li key={s} className={i < idx ? 'done' : i === idx ? 'now' : ''}><i />{t(`step_${s}`)}</li>)}
        </ol>
      )}
      <div className="ink-card"><span className="eyebrow">{t('status')}</span><b className="big" style={{ fontSize: 24 }}>{c.status === 'live' && c.fulfillment === 'self' ? t('liveSelf') : t(`cstatus_${c.status}`)}</b>
        {c.status === 'live' && <small>{c.fulfillment === 'self' ? t('liveNoteSelf', { a: `${c.ship_address}, ${govName(c.ship_governorate, lang)}` }) : t('liveNote', { b: c.businesses?.name || '' })}</small>}
      </div>
      {c.status !== 'cancelled' && (editShip ? (
        <div className="card stack">
          <FulfillmentPicker value={editShip} onChange={setEditShip} error={shipErr} />
          <div className="row">
            <Button small disabled={busy} onClick={() => { if (editShip.fulfillment === 'self' && !editShip.ship_address.trim()) { setShipErr(t('required')); return; } setShipErr(''); act(() => api.updateFulfillment(c.id, editShip), 'saved').then(() => setEditShip(null)); }}>{t('save')}</Button>
            <Button small variant="ghost" onClick={() => setEditShip(null)}>{t('keep')}</Button>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="row-between"><span className="muted small">{t('deliveryLabel')}</span>
            {!['live', 'cancelled'].includes(c.status) && !c.balance_confirmed && <button type="button" className="link-btn" onClick={() => setEditShip({ fulfillment: c.fulfillment, ship_governorate: c.ship_governorate || 'Cairo', ship_address: c.ship_address || '' })}>{t('change')}</button>}
          </div>
          <b>{t(`fulfill_${c.fulfillment || 'forsa'}`)}</b>
          {c.fulfillment === 'self' && <span className="small">{c.ship_address}, {govName(c.ship_governorate, lang)}</span>}
        </div>
      ))}
      {c.quote_total != null && (
        <div className="card">
          <h3>{t('quoteTitle')}</h3>
          <dl className="kv">
            <dt>{t('unitPrice')}</dt><dd>{money(c.quote_unit_price, lang)}</dd>
            <dt>{t('total')}</dt><dd><b>{money(c.quote_total, lang)}</b></dd>
            <dt>{t('deposit')}</dt><dd>{money(c.deposit_amount, lang)}</dd>
            <dt>{t('restOnDelivery')}</dt><dd>{money(rest, lang)}</dd>
          </dl>
          {c.quote_note && <p className="small muted">{c.quote_note}</p>}
          {c.status === 'quoted' && <Button block disabled={busy} onClick={() => act(() => api.acceptQuote(c.id))}>{t('acceptQuote')}</Button>}
        </div>
      )}
      {c.status === 'accepted' && !c.deposit_confirmed && payBox(t('payDepositTitle'), c.deposit_amount, c.deposit_ref, api.submitDepositRef)}
      {c.status === 'final_payment' && !c.balance_confirmed && payBox(t('payRestTitle'), rest, c.balance_ref, api.submitBalanceRef)}
      {c.status === 'live' && c.product_id && <Button block onClick={() => go(`/product/${c.product_id}`)}>{t('viewProduct')}</Button>}
      <Button block variant="ghost" onClick={() => go(`/chat/${c.thread_id}`)}><Icon name="chat" size={18} /> {t('chatWithForsa')}</Button>
      {['requested', 'quoted'].includes(c.status) && (confirmCancel ? (
        <div className="card warn stack"><p>{t('cancelCustomConfirm')}</p><div className="row"><Button variant="danger" small onClick={() => act(() => api.cancelCustom(c.id))}>{t('yesCancel')}</Button><Button variant="ghost" small onClick={() => setConfirmCancel(false)}>{t('keep')}</Button></div></div>
      ) : <button type="button" className="link-btn" onClick={() => setConfirmCancel(true)}>{t('cancelRequest')}</button>)}
    </div>
  );
}

// ---------- Messages inbox (all conversations, per business) ----------
const SVC_ICON = { marketing_agency: 'target', media_buying: 'megaphone', custom_product: 'factory' };

export function ThreadList({ threads, unread = {}, limit }) {
  const { t, lang } = useApp();
  const list = limit ? threads.slice(0, limit) : threads;
  if (list.length === 0) return <div className="card empty"><p className="small">{t('noThreads')}</p></div>;
  return (
    <div className="list">
      {list.map((r) => (
        <button type="button" key={r.id} className="order-row" onClick={() => go(`/chat/${r.id}`)}>
          <span className="svc-icon small"><Icon name={SVC_ICON[r.service] || 'chat'} size={18} /></span>
          <div className="or-main"><b>{t(`svc_${r.service}`)}</b><span className="muted small">{r.details?.slice(0, 60)}{r.businesses?.name ? ` · ${r.businesses.name}` : ''}</span></div>
          <div className="or-side">
            {unread[r.id] ? <span className="unread">{t('unreadN', { n: num(unread[r.id], lang) })}</span> : null}
            <span className="muted small">{date(r.created_at, lang)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

export function Inbox({ bizId, data, unread }) {
  const { t } = useApp();
  const { loading, data: threads, error, reload } = useLoad(() => api.myRequests({ all: true }), []);
  const businesses = data.businesses || [];
  const shown = (threads || []).filter((r) => !bizId || r.business_id === bizId)
    .sort((a, b) => (unread[b.id] || 0) - (unread[a.id] || 0) || b.created_at.localeCompare(a.created_at));
  return (
    <div className="screen">
      <Header title={t('messages')} />
      {businesses.length > 0 && (
        <div className="chips scroll" role="group">
          <button type="button" className="chip" aria-pressed={!bizId} onClick={() => go('/inbox')}>{t('all2')}</button>
          {businesses.map((b) => <button type="button" key={b.id} className="chip" aria-pressed={bizId === b.id} onClick={() => go(`/inbox/${b.id}`)}>{b.name}</button>)}
        </div>
      )}
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : <ThreadList threads={shown} unread={unread} />}
    </div>
  );
}
