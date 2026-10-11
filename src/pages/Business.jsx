// My Business: a seller's businesses, their products and their analytics.
import React, { useEffect, useState } from 'react';
import { useApp, Button, Field, Header, Spinner, useLoad, Sheet, Icon, go, money, pname, imgSrc } from '../core.jsx';
import { GOVERNORATES } from '../lib/i18n.js';
import { Analytics } from './Grow.jsx';
import * as api from '../lib/api.js';

export const bizInitial = (b) => (b?.name || '?').trim().charAt(0).toUpperCase();

export function BizLogo({ b, size = 52 }) {
  return b?.logo_url
    ? <img className="biz-logo" src={b.logo_url} alt="" style={{ width: size, height: size }} />
    : <span className="biz-logo" style={{ width: size, height: size, fontSize: size * 0.42 }}>{bizInitial(b)}</span>;
}

const safeUrl = (u) => {
  const v = (u || '').trim();
  if (!v) return '';
  const full = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try { const x = new URL(full); return ['http:', 'https:'].includes(x.protocol) ? x.href : ''; } catch { return ''; }
};

// ---------- My Business page ----------
export function MyBusiness({ id, data, reload, notify }) {
  const { t, lang } = useApp();
  const businesses = data.businesses || [];
  const [form, setForm] = useState(null);
  const current = businesses.find((b) => b.id === id) || businesses[0];
  const { data: products } = useLoad(() => api.listProducts({ all: false }), []);

  if (businesses.length === 0) {
    return (
      <div className="screen">
        <Header title={t('myBusiness')} />
        <div className="biz-empty">
          <span className="svc-icon" style={{ width: 56, height: 56 }}><Icon name="store" size={26} /></span>
          <h1 className="page-title">{t('bizIntroTitle')}</h1>
          <p className="lead">{t('bizIntro')}</p>
          <Button block onClick={() => setForm({})}>{t('createBusiness')}</Button>
        </div>
        <BusinessForm business={form} onClose={() => setForm(null)} onSaved={(b) => { setForm(null); notify(t('bizCreated')); reload(); go(`/business/${b.id}`); }} />
      </div>
    );
  }

  const mine = (products || []).filter((p) => current.product_ids.includes(p.id));
  async function remove(p) {
    try { await api.removeFromBusiness(current.id, p.id); notify(t('removedToast')); reload(); } catch (e) { notify(e.message); }
  }
  const page = safeUrl(current.page_url);
  return (
    <div className="screen">
      <Header title={t('myBusiness')} />
      {(
        <div className="chips scroll" role="group">
          {businesses.map((b) => <button type="button" key={b.id} className="chip" aria-pressed={b.id === current.id} onClick={() => go(`/business/${b.id}`)}>{b.name}</button>)}
          {businesses.length < 5 && <button type="button" className="chip" onClick={() => setForm({})}>+ {t('newBusiness')}</button>}
        </div>
      )}
      <div className="card biz-card">
        <div className="biz-head">
          <BizLogo b={current} />
          <div className="or-main">
            <h2 className="biz-name">{current.name}</h2>
            <span className="muted small">{[current.category, current.city && (lang === 'ar' ? (GOVERNORATES.find((g) => g[0] === current.city)?.[1] || current.city) : current.city)].filter(Boolean).join(' · ')}</span>
          </div>
          <button type="button" className="icon-btn" onClick={() => setForm(current)} aria-label={t('editBusiness')}><Icon name="edit" size={18} /></button>
        </div>
        {current.description && <p className="small">{current.description}</p>}
        {page && <a className="biz-link" href={page} target="_blank" rel="noopener noreferrer"><Icon name="globe" size={16} />{t('visitPage')}</a>}
      </div>

      <div className="section-head"><h2>{t('myProducts')}</h2><button type="button" className="link-btn" onClick={() => go('/products')}>+ {t('addProducts')}</button></div>
      {!products ? <Spinner /> : mine.length === 0 ? (
        <div className="card empty"><p>{t('noBizProducts')}</p><Button onClick={() => go('/products')}>{t('addProducts')}</Button></div>
      ) : (
        <div className="list">
          {mine.map((p) => (
            <div key={p.id} className="order-row static">
              <img src={imgSrc(p.image_url)} alt="" />
              <button type="button" className="or-main link-reset" onClick={() => go(`/product/${p.id}`)}>
                <b>{pname(p, lang)}</b><span className="earn small">+{money(p.suggested_price - p.wholesale_price, lang)}</span>
              </button>
              <button type="button" className="btn btn-ghost small" onClick={() => remove(p)}>{t('removeProduct')}</button>
            </div>
          ))}
        </div>
      )}

      <div className="section-head"><h2>{t('analytics')}</h2></div>
      <Analytics data={data} reload={reload} notify={notify} embedded businessId={current.id} />

      <BusinessForm business={form} onClose={() => setForm(null)}
        onSaved={(b, created) => { setForm(null); notify(t(created ? 'bizCreated' : 'bizSaved')); reload(); if (created) go(`/business/${b.id}`); }}
        onDeleted={() => { setForm(null); reload(); go('/business'); }} notify={notify} />
    </div>
  );
}

// ---------- Create / edit a business ----------
export function BusinessForm({ business, onClose, onSaved, onDeleted, notify }) {
  const { t, lang, profile } = useApp();
  const [f, setF] = useState(null);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => {
    if (business) setF({ id: business.id, name: business.name || '', category: business.category || '', page_url: business.page_url || '', description: business.description || '', city: business.city || profile?.city || 'Cairo', logo_url: business.logo_url || '' });
    setErr({}); setConfirmDel(false);
  }, [business]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!business || !f) return null;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function upload(e) {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setErr({ logo: 'Max 3 MB' }); return; }
    setBusy(true);
    try { const url = await api.uploadLogo(file); setF((x) => ({ ...x, logo_url: url })); } catch (er) { setErr({ logo: er.message }); } finally { setBusy(false); }
  }
  async function save(ev) {
    ev.preventDefault();
    const e = {};
    if (f.name.trim().length < 2) e.name = t('required');
    if (!f.category.trim()) e.category = t('required');
    setErr(e); if (Object.keys(e).length) return;
    setBusy(true);
    try { const b = await api.saveBusiness(f); onSaved(b || f, !f.id); }
    catch (er) { setErr({ form: /5 businesses/.test(er.message) ? t('maxBiz') : er.message }); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api.deleteBusiness(f.id); onDeleted?.(); }
    catch (er) { setErr({ form: er.code === 'HAS_ORDERS' ? t('bizHasOrders') : er.message }); setConfirmDel(false); }
    finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={f.id ? t('editBusiness') : t('createBusiness')}>
      <form onSubmit={save} noValidate className="stack">
        <div className="row" style={{ alignItems: 'center', gap: 12, flexWrap: 'nowrap' }}>
          <BizLogo b={{ name: f.name || '?', logo_url: f.logo_url }} size={56} />
          <Field id="bz-logo" label={t('bizLogo')} error={err.logo}><input id="bz-logo" type="file" accept="image/*" onChange={upload} /></Field>
        </div>
        <Field id="bz-name" label={t('bizName')} error={err.name}><input id="bz-name" maxLength={60} placeholder={t('bizNameHint')} value={f.name} onChange={set('name')} /></Field>
        <Field id="bz-cat" label={t('bizCategory')} error={err.category}><input id="bz-cat" maxLength={40} placeholder={t('bizCategoryHint')} value={f.category} onChange={set('category')} /></Field>
        <Field id="bz-page" label={t('bizPage')}><input id="bz-page" maxLength={300} dir="ltr" inputMode="url" placeholder="instagram.com/yourpage" value={f.page_url} onChange={set('page_url')} /></Field>
        <Field id="bz-city" label={t('city')}>
          <select id="bz-city" value={f.city} onChange={set('city')}>{GOVERNORATES.map(([en, ar]) => <option key={en} value={en}>{lang === 'ar' ? ar : en}</option>)}</select>
        </Field>
        <Field id="bz-desc" label={t('bizDesc')}><textarea id="bz-desc" rows="2" maxLength={500} value={f.description} onChange={set('description')} /></Field>
        {err.form && <p className="form-error" role="alert">{err.form}</p>}
        <button type="submit" className="btn btn-primary block" disabled={busy}>{busy ? t('loading') : t('saveBusiness')}</button>
      </form>
      {f.id && onDeleted && (confirmDel ? (
        <div className="card warn stack"><p>{t('deleteBizConfirm')}</p><div className="row"><Button variant="danger" small onClick={remove} disabled={busy}>{t('deleteBusiness')}</Button><Button variant="ghost" small onClick={() => setConfirmDel(false)}>{t('keep')}</Button></div></div>
      ) : <Button block variant="ghost" onClick={() => setConfirmDel(true)}>{t('deleteBusiness')}</Button>)}
    </Sheet>
  );
}

// ---------- "Add to my business" (used on the product page) ----------
export function AddToBusiness({ open, product, businesses, onClose, onDone, notify }) {
  const { t } = useApp();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setCreating(businesses.length === 0); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  async function add(b) {
    setBusy(true);
    try { await api.addToBusiness(b.id, product.id); notify(t('addedToast', { b: b.name })); onDone(); }
    catch (e) { notify(e.message); } finally { setBusy(false); }
  }
  if (creating) {
    return <BusinessForm business={{}} onClose={onClose} onSaved={(b) => add(b)} notify={notify} />;
  }
  return (
    <Sheet open onClose={onClose} title={t('chooseBusiness')}>
      <div className="list">
        {businesses.map((b) => {
          const has = b.product_ids.includes(product.id);
          return (
            <button type="button" key={b.id} className="order-row" disabled={has || busy} onClick={() => add(b)}>
              <BizLogo b={b} size={40} />
              <div className="or-main"><b>{b.name}</b><span className="muted small">{b.category}</span></div>
              {has ? <span className="pill pill-delivered">{t('added')}</span> : <Icon name="plus" size={18} />}
            </button>
          );
        })}
      </div>
      {businesses.length < 5 && <Button block variant="ghost" onClick={() => setCreating(true)}>+ {t('newBusiness')}</Button>}
    </Sheet>
  );
}

