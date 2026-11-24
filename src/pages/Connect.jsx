// Connect an existing website (Shopify): the box in "My website", the step-by-step setup page,
// and "Needs review" for outside orders Forsa couldn't match.
import React, { useMemo, useState } from 'react';
import { useApp, Button, Field, Header, Spinner, ErrorBox, useLoad, Sheet, Icon, go, money, num, pname, imgSrc, latinDigits, date } from '../core.jsx';
import { GOVERNORATES } from '../lib/i18n.js';
import * as api from '../lib/api.js';

async function copyText(text, notify, t) {
  try { await navigator.clipboard.writeText(text); notify(t('copied')); } catch { window.prompt?.('', text); }
}

// ---------- Box inside "My website" ----------
export function ConnectBox({ business, notify }) {
  const { t, lang } = useApp();
  const conns = useLoad(() => api.myConnections(), [business.id]);
  const [open, setOpen] = useState(false);
  const [shop, setShop] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (conns.loading) return <Spinner />;
  const c = (conns.data || []).find((x) => x.business_id === business.id);
  async function request(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await api.requestConnection(business.id, shop); notify(t('conRequested')); setOpen(false); conns.reload(); } catch (er) { setErr(er.message); } finally { setBusy(false); }
  }
  let body;
  if (!c || c.status === 'rejected') {
    body = (
      <>
        {c?.status === 'rejected' && <p className="small web-reason"><b>{t('webRejected')}</b>{c.reason ? ` ${c.reason}` : ''}</p>}
        <p className="small muted">{t('conIntro')}</p>
        <Button block variant="ghost" onClick={() => { setShop(c?.shop || ''); setErr(''); setOpen(true); }}><Icon name="link" size={16} /> {t('conConnect')}</Button>
      </>
    );
  } else if (c.status === 'requested') {
    body = <p className="small"><Icon name="clock" size={14} /> {t('conPending', { s: c.shop })}</p>;
  } else if (c.status === 'paused') {
    body = <p className="small web-reason"><b>{t('conPaused')}</b>{c.reason ? ` ${c.reason}` : ''}</p>;
  } else if (!c.has_secret) {
    body = (
      <>
        <p className="small">{t('conApproved', { s: c.shop })}</p>
        <Button block onClick={() => go(`/connect/${business.id}`)}>{t('conFinish')}</Button>
      </>
    );
  } else {
    body = (
      <>
        <div className="row-between"><span className="pill pill-delivered">{t('conConnected')}</span><code className="small" dir="ltr">{c.shop}</code></div>
        <p className="small muted">{c.last_order_at ? t('conStats', { n: num(c.orders_count, lang), d: date(c.last_order_at, lang) }) : t('conWaitingFirst')}</p>
        <button type="button" className="link-btn small" onClick={() => go(`/connect/${business.id}`)}>{t('conSetupSteps')}</button>
      </>
    );
  }
  return (
    <div className="con-box stack">
      <b>{t('conTitle')}</b>
      {body}
      <Sheet open={open} onClose={() => setOpen(false)} title={t('conConnect')}>
        <form className="stack" onSubmit={request}>
          <span className="label-like">{t('conPlatform')}</span>
          <div className="chips"><button type="button" className="chip" aria-pressed="true">Shopify</button></div>
          <p className="small muted">{t('conMoreSoon')}</p>
          <Field id="cn-shop" label={t('conShop')} hint={t('conShopHint')} error={err}>
            <input id="cn-shop" dir="ltr" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="nour.myshopify.com" value={shop} onChange={(e) => { setShop(e.target.value); setErr(''); }} />
          </Field>
          <p className="small muted">{t('conApprovalNote')}</p>
          <Button type="submit" block disabled={busy || !shop.trim()}>{busy ? t('loading') : t('conSend')}</Button>
        </form>
      </Sheet>
    </div>
  );
}

// ---------- Setup page (#/connect/<business>) ----------
function Step({ n, title, children }) {
  const { lang } = useApp();
  return (
    <section className="card stack con-step">
      <div className="step-head"><span className="step-no">{num(n, lang)}</span><h3>{title}</h3></div>
      {children}
    </section>
  );
}

export function ConnectGuide({ bizId, data, notify }) {
  const { t, lang } = useApp();
  const business = (data.businesses || []).find((b) => b.id === bizId);
  const conns = useLoad(() => api.myConnections(), [bizId]);
  const prods = useLoad(() => api.listProducts(), []);
  const rates = useLoad(() => api.listShippingRates(), []);
  const [secret, setSecret] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const back = `/business/${bizId}`;
  const mine = useMemo(() => (prods.data || []).filter((p) => business?.product_ids.includes(p.id)), [prods.data, business]);
  if (!business) return <div className="screen"><Header title={t('conTitle')} back="/business" /><div className="card empty"><p>{t('notFound')}</p></div></div>;
  if (conns.loading || prods.loading) return <div className="screen"><Header title={t('conTitle')} back={back} /><Spinner /></div>;
  if (conns.error) return <div className="screen"><Header title={t('conTitle')} back={back} /><ErrorBox error={conns.error} onRetry={conns.reload} /></div>;
  const c = (conns.data || []).find((x) => x.business_id === bizId);
  if (!c || c.status !== 'approved') {
    return <div className="screen"><Header title={t('conTitle')} back={back} /><div className="card empty"><p>{t('conNotApproved')}</p><Button onClick={() => go(back)}>{t('back')}</Button></div></div>;
  }
  const url = api.webhookUrl(c);
  const fees = [...new Set((rates.data || []).filter((r) => r.active).map((r) => r.fee))].sort((a, b) => a - b);
  async function saveSecret(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await api.setConnectionSecret(bizId, secret); setSecret(''); notify(t('conKeySaved')); conns.reload(); } catch (er) { setErr(er.message); } finally { setBusy(false); }
  }
  return (
    <div className="screen con-guide">
      <Header title={t('conTitle')} back={back} />
      <div className="card stack">
        <div className="row-between"><b>Shopify</b><code className="small" dir="ltr">{c.shop}</code></div>
        <span className={`pill ${c.has_secret ? 'pill-delivered' : 'pill-pending'}`} style={{ width: 'max-content' }}>{c.has_secret ? t('conConnected') : t('conNotFinished')}</span>
        <p className="small muted">{t('conGuideIntro')}</p>
      </div>

      <Step n={1} title={t('conS1')}>
        <p className="small">{t('conS1Text')}</p>
        {mine.length === 0 ? <p className="small muted">{t('noBizProducts')}</p> : (
          <div className="list">
            {mine.map((p) => (
              <div key={p.id} className="code-row">
                <img src={imgSrc(p.image_url)} alt="" />
                <div className="or-main"><b>{pname(p, lang)}</b><span className="muted small">{t('minIs', { p: money(p.min_price, lang) })}</span></div>
                <button type="button" className="btn btn-ghost small code-btn" dir="ltr" onClick={() => copyText(api.forsaCode(p.id), notify, t)} aria-label={`${t('copy')} ${api.forsaCode(p.id)}`}>{api.forsaCode(p.id)} <Icon name="copy" size={14} /></button>
              </div>
            ))}
          </div>
        )}
        <p className="small muted">{t('conS1Price')}</p>
      </Step>

      <Step n={2} title={t('conS2')}>
        <p className="small">{t('conS2Text')}</p>
        <p className="small">{t('conS2Ship', { a: fees.length ? fees.map((x) => money(x, lang)).join(' / ') : '…' })}</p>
      </Step>

      <Step n={3} title={t('conS3')}>
        <ol className="small con-list">
          <li>{t('conS3a')}</li><li>{t('conS3b')}</li><li>{t('conS3c')}</li><li>{t('conS3d')}</li><li>{t('conS3e')}</li>
        </ol>
        <span className="label-like">{t('conYourLink')}</span>
        <code className="web-link" dir="ltr">{url}</code>
        <Button small onClick={() => copyText(url, notify, t)}><Icon name="copy" size={16} /> {t('copyLink')}</Button>
        <p className="small muted">{t('conLinkPrivate')}</p>
      </Step>

      <Step n={4} title={t('conS4')}>
        <p className="small">{t('conS4Text')}</p>
        <form className="stack" onSubmit={saveSecret}>
          <Field id="cn-key" label={t('conKey')} error={err} hint={c.has_secret ? t('conKeyHas') : undefined}>
            <input id="cn-key" dir="ltr" autoComplete="off" autoCapitalize="none" spellCheck={false} value={secret} onChange={(e) => { setSecret(e.target.value); setErr(''); }} placeholder={c.has_secret ? '••••••••' : ''} />
          </Field>
          <Button type="submit" block disabled={busy || !secret.trim()}>{busy ? t('loading') : t('conKeySave')}</Button>
        </form>
      </Step>

      <Step n={5} title={t('conS5')}>
        <p className="small">{t('conS5Text')}</p>
        <Button block variant="ghost" onClick={() => go('/orders')}>{t('conOpenOrders')}</Button>
      </Step>
    </div>
  );
}

// ---------- Needs review (in Orders) ----------
const PROBLEM_KEY = { unknown_product: 'rvUnknownProduct', price_below_min: 'rvPriceLow', bad_phone: 'rvBadPhone', unknown_governorate: 'rvGov', missing_address: 'rvAddress', paid_online: 'rvPaid' };

export function ReviewBanner({ data, onDone, notify }) {
  const { t, lang } = useApp();
  const list = useLoad(() => api.reviewOrders(), []);
  const [open, setOpen] = useState(false);
  const n = (list.data || []).length;
  if (!n) return null;
  return (
    <>
      <button type="button" className="card review-banner" onClick={() => setOpen(true)}>
        <Icon name="alert" size={18} /><span className="or-main"><b>{t('rvBanner', { n: num(n, lang) })}</b><span className="small muted">{t('rvBannerSub')}</span></span><Icon name="chevron" size={16} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('rvTitle')}>
        <div className="stack">
          {(list.data || []).map((e) => <ReviewItem key={e.id} e={e} data={data} notify={notify} onChanged={() => { list.reload(); onDone?.(); }} />)}
          {n === 0 && <p className="muted">{t('rvNone')}</p>}
        </div>
      </Sheet>
    </>
  );
}

function ReviewItem({ e, data, notify, onChanged }) {
  const { t, lang } = useApp();
  const d = e.data || {};
  const biz = (data.businesses || []).find((b) => b.id === e.business_id);
  const prods = useLoad(() => api.listProducts(), []);
  const mine = (prods.data || []).filter((p) => biz?.product_ids.includes(p.id));
  const [f, setF] = useState({ product_id: d.product_id || '', quantity: d.quantity || 1, price: d.price || '', name: d.name || '', phone: d.phone || '', governorate: d.governorate || '', address: d.address || '', options: d.options || '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (ev) => { setF({ ...f, [k]: k === 'price' || k === 'quantity' || k === 'phone' ? latinDigits(ev.target.value) : ev.target.value }); setErr(''); };
  const paid = e.problem === 'paid_online';
  async function create() {
    setBusy(true); setErr('');
    try { await api.resolveExternalOrder({ id: e.id, ...f }); notify(t('orderPlaced')); onChanged(); } catch (er) { setErr(er.message); } finally { setBusy(false); }
  }
  async function dismiss() {
    setBusy(true);
    try { await api.dismissExternalOrder(e.id); notify(t('rvIgnored')); onChanged(); } catch (er) { setErr(er.message); } finally { setBusy(false); }
  }
  return (
    <div className="card stack review-item">
      <div className="row-between"><b>Shopify {e.external_ref}</b><span className="small muted">{date(e.created_at, lang)}</span></div>
      <p className="small"><b>{d.title}</b>{d.variant ? ` · ${d.variant}` : ''}{d.sku ? <> · <code dir="ltr">{d.sku}</code></> : null}</p>
      <p className="small web-reason">{t(PROBLEM_KEY[e.problem] || 'rvOther')}</p>
      {!paid && (
        <>
          <Field id={`rv-p-${e.id}`} label={t('rvProduct')}>
            <select id={`rv-p-${e.id}`} value={f.product_id} onChange={set('product_id')}>
              <option value="">—</option>
              {mine.map((p) => <option key={p.id} value={p.id}>{pname(p, lang)} ({api.forsaCode(p.id)}) · {t('minIs', { p: money(p.min_price, lang) })}</option>)}
            </select>
          </Field>
          <div className="row two">
            <Field id={`rv-pr-${e.id}`} label={t('pricePerPiece')}><input id={`rv-pr-${e.id}`} type="number" inputMode="numeric" value={f.price} onChange={set('price')} /></Field>
            <Field id={`rv-q-${e.id}`} label={t('quantity')}><input id={`rv-q-${e.id}`} type="number" inputMode="numeric" min="1" max="10" value={f.quantity} onChange={set('quantity')} /></Field>
          </div>
          <Field id={`rv-n-${e.id}`} label={t('customerName')}><input id={`rv-n-${e.id}`} value={f.name} onChange={set('name')} /></Field>
          <Field id={`rv-ph-${e.id}`} label={t('customerPhone')}><input id={`rv-ph-${e.id}`} dir="ltr" inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
          <Field id={`rv-g-${e.id}`} label={t('city')} hint={d.province ? `Shopify: ${d.province}` : undefined}>
            <select id={`rv-g-${e.id}`} value={f.governorate} onChange={set('governorate')}>
              <option value="">—</option>
              {GOVERNORATES.map(([en, ar]) => <option key={en} value={en}>{lang === 'ar' ? ar : en}</option>)}
            </select>
          </Field>
          <Field id={`rv-a-${e.id}`} label={t('address')}><textarea id={`rv-a-${e.id}`} rows="2" value={f.address} onChange={set('address')} /></Field>
        </>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
      <div className="row">
        {!paid && <Button small onClick={create} disabled={busy || !f.product_id}>{t('rvCreate')}</Button>}
        <Button small variant="ghost" onClick={dismiss} disabled={busy}>{t('rvIgnore')}</Button>
      </div>
    </div>
  );
}
