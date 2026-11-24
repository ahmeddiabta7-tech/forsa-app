// "My own products" inside a business: products the seller made himself (his photo, his name, his price).
// Forsa approves them, stores the seller's pieces and ships each order. Forsa keeps 10% of the profit.
import React, { useState } from 'react';
import { useApp, Button, Field, Sheet, Spinner, Icon, money, num, imgSrc, latinDigits, useLoad } from '../core.jsx';
import { CATEGORIES } from '../lib/i18n.js';
import { PLAN } from '../config.js';
import * as api from '../lib/api.js';

const STATUS_PILL = { pending: 'pill-pending', approved: 'pill-delivered', rejected: 'pill-cancelled' };

export function OwnProducts({ business, notify, onChanged }) {
  const { t, lang } = useApp();
  const list = useLoad(() => api.mySellerProducts(), [business.id]);
  const [edit, setEdit] = useState(null);
  const mine = (list.data || []).filter((p) => business.product_ids.includes(p.id));
  return (
    <>
      <div className="section-head"><h2>{t('ownProducts')}</h2><button type="button" className="link-btn" onClick={() => setEdit({})}>+ {t('addOwnProduct')}</button></div>
      {list.loading ? <Spinner /> : mine.length === 0 ? (
        <div className="card own-empty stack">
          <p className="small">{t('ownEmpty')}</p>
          <Button variant="ghost" onClick={() => setEdit({})}><Icon name="plus" size={16} /> {t('addOwnProduct')}</Button>
        </div>
      ) : (
        <div className="list">
          {mine.map((p) => (
            <button type="button" key={p.id} className="order-row own-row" onClick={() => setEdit(p)}>
              <img src={imgSrc(p.image_url)} alt="" />
              <span className="or-main">
                <b>{p.name_en}</b>
                <span className="small muted">{money(p.suggested_price, lang)}{p.review_status === 'approved' ? ` · ${t('ownStock', { n: num(p.stock || 0, lang) })}` : ''}</span>
                {p.review_status === 'rejected' && p.review_reason && <span className="small web-reason">{p.review_reason}</span>}
              </span>
              <span className={`pill ${STATUS_PILL[p.review_status] || 'pill-pending'}`}>{t(`own_${p.review_status}`)}</span>
            </button>
          ))}
        </div>
      )}
      <OwnProductSheet product={edit} business={business} onClose={() => setEdit(null)}
        onSaved={(created) => { setEdit(null); notify(t(created ? 'ownSent' : 'saved')); list.reload(); onChanged?.(); }} />
    </>
  );
}

function OwnProductSheet({ product, business, onClose, onSaved }) {
  const { t, lang } = useApp();
  const isNew = product && !product.id;
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (product && (!f || f._for !== (product.id || 'new'))) {
    setF({ _for: product.id || 'new', name: product.name_en || '', description: product.description_en || '', category: product.category || 'Other',
      cost: product.wholesale_price ?? '', price: product.suggested_price ?? '', image_url: product.image_url || '' });
    setErr('');
  }
  if (!product || !f) return null;
  const set = (k) => (e) => { setF({ ...f, [k]: k === 'cost' || k === 'price' ? latinDigits(e.target.value) : e.target.value }); setErr(''); };
  const cost = Number(f.cost) || 0; const price = Number(f.price) || 0;
  const profit = Math.max(0, price - cost); const fee = Math.round(profit * PLAN.feePct / 100);
  async function upload(e) {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setErr(t('max3mb')); return; }
    setBusy(true);
    try { const url = await api.uploadLogo(file); setF((x) => ({ ...x, image_url: url })); } catch (er) { setErr(er.message); } finally { setBusy(false); }
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      if (isNew) await api.createSellerProduct(business.id, f); else await api.updateSellerProduct(product.id, f);
      onSaved(isNew);
    } catch (er) { setErr(er.message); } finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={isNew ? t('addOwnProduct') : t('editOwnProduct')}>
      <form className="stack" onSubmit={save}>
        {isNew && <p className="small muted">{t('ownIntro')}</p>}
        {!isNew && product.review_status === 'approved' && <p className="small">{t('ownStockLine', { n: num(product.stock || 0, lang) })}</p>}
        <div className="own-photo">
          <span className="own-photo-img">{f.image_url ? <img src={imgSrc(f.image_url)} alt="" /> : <Icon name="image" size={28} />}</span>
          <Field id="op-photo" label={t('ownPhoto')}><input id="op-photo" type="file" accept="image/*" onChange={upload} /></Field>
        </div>
        <Field id="op-name" label={t('ownName')}><input id="op-name" maxLength={80} value={f.name} onChange={set('name')} /></Field>
        <Field id="op-desc" label={t('ownDescription')}><textarea id="op-desc" rows="3" maxLength={600} value={f.description} onChange={set('description')} placeholder={t('ownDescriptionHint')} /></Field>
        <Field id="op-cat" label={t('category')}>
          <select id="op-cat" value={f.category} onChange={set('category')}>{CATEGORIES.map(([v, k]) => <option key={v} value={v}>{t(k)}</option>)}</select>
        </Field>
        <div className="row two">
          <Field id="op-cost" label={t('ownCost')} hint={t('ownCostHint')}><input id="op-cost" type="number" inputMode="numeric" min="1" value={f.cost} onChange={set('cost')} /></Field>
          <Field id="op-price" label={t('ownPrice')}><input id="op-price" type="number" inputMode="numeric" min="1" value={f.price} onChange={set('price')} /></Field>
        </div>
        {price > 0 && (
          <dl className="kv sum-kv">
            <dt>{t('ownProfit')}</dt><dd>{money(profit, lang)}</dd>
            <dt>{t('forsaFee')} ({num(PLAN.feePct, lang)}%)</dt><dd>−{money(fee, lang)}</dd>
            <dt>{t('costBack')}</dt><dd>+{money(cost, lang)}</dd>
            <dt className="strong">{t('ownYouGet')}</dt><dd className="strong earn">{money(price - fee, lang)}</dd>
          </dl>
        )}
        <ol className="small own-steps"><li>{t('ownStep1')}</li><li>{t('ownStep2')}</li><li>{t('ownStep3')}</li></ol>
        {!isNew && <p className="small muted">{t('ownEditNote')}</p>}
        {err && <p className="form-error" role="alert">{err}</p>}
        <Button type="submit" block disabled={busy}>{busy ? t('loading') : isNew ? t('ownSend') : t('save')}</Button>
      </form>
    </Sheet>
  );
}
