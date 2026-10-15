import React, { useState } from 'react';
import { useApp, Button, Field, Header, Icon, go, money, num, date, planState, earningsSummary, latinDigits, LangSwitch } from '../core.jsx';
import { GOVERNORATES } from '../lib/i18n.js';
import * as api from '../lib/api.js';
import { PlanRules } from './Seller.jsx';

// ---------- Plan (3-pieces rule, Forsa fee) ----------
export function Plan({ data }) {
  const { t, lang, profile } = useApp();
  const plan = planState(profile, data.orders);
  const sum = earningsSummary(data.orders, data.payouts);
  return (
    <div className="screen">
      <Header title={t('plan')} back="/more" />
      <div className="card">
        <span className="eyebrow">{t('planTitle')}</span>
        <p className="plan-big">{plan.unlocked ? t('planNow_open', { d: date(plan.unlockedUntil, lang) }) : t('planNow_locked', { h: num(plan.held, lang) })}</p>
        {sum.locked > 0 && <p className="small"><Icon name="lock" size={14} /> {t('lockedProfit')}: <b>{money(sum.locked, lang)}</b> · {t('lockedNote')}</p>}
        <PlanRules full />
      </div>
      <Button block variant="ghost" onClick={() => go('/earnings')}><Icon name="wallet" size={18} /> {t('earnings')}</Button>
    </div>
  );
}

// ---------- Payout details (R4) ----------
const METHODS = ['instapay', 'vodafone_cash', 'bank'];
function PayoutDetails({ notify, onSaved }) {
  const { t, profile } = useApp();
  const init = () => ({ payout_method: profile.payout_method || '', payout_holder: profile.payout_holder || profile.full_name || '', payout_bank: profile.payout_bank || '', payout_account: profile.payout_account || '' });
  const [f, setF] = useState(init);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(ev) {
    ev.preventDefault();
    const e = {};
    if (!f.payout_method) e.method = t('chooseMethod');
    if (!f.payout_holder.trim()) e.holder = t('required');
    if (f.payout_method === 'bank' && !f.payout_bank.trim()) e.bank = t('required');
    if (!f.payout_account.trim()) e.account = t('required');
    else if (f.payout_method === 'vodafone_cash' && !/^(\+?20)?0?1[0125]\d{8}$/.test(latinDigits(f.payout_account).replace(/[\s-]/g, ''))) e.account = t('invalidPhone');
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try { await api.savePayoutDetails(profile.id, { ...f, payout_account: f.payout_method === 'vodafone_cash' ? latinDigits(f.payout_account).replace(/[\s-]/g, '') : f.payout_account }); notify(t('payoutSaved')); onSaved(); }
    catch (err) { notify(err.message); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} noValidate className="card stack" id="payout">
      <h3>{t('payoutTitle')}</h3>
      <p className="muted small">{t('payoutIntro')}</p>
      <div className="field">
        <span className="label-like" id="pm-label">{t('payoutMethod')}</span>
        <div className="method-opts" role="group" aria-labelledby="pm-label">
          {METHODS.map((m) => <button type="button" key={m} aria-pressed={f.payout_method === m} onClick={() => setF({ ...f, payout_method: m })}><Icon name={m === 'bank' ? 'bank' : 'wallet'} size={18} />{t(`pm_${m}`)}</button>)}
        </div>
        {errors.method && <p className="field-error" role="alert">{errors.method}</p>}
      </div>
      {f.payout_method && <>
        <Field id="po-holder" label={t('payoutHolder')} error={errors.holder}><input id="po-holder" value={f.payout_holder} onChange={set('payout_holder')} maxLength={100} /></Field>
        {f.payout_method === 'bank' && <Field id="po-bank" label={t('payoutBank')} error={errors.bank}><input id="po-bank" value={f.payout_bank} onChange={set('payout_bank')} maxLength={100} /></Field>}
        <Field id="po-acc" label={t(`payoutAccount_${f.payout_method}`)} error={errors.account}>
          <input id="po-acc" value={f.payout_account} onChange={set('payout_account')} dir="ltr" maxLength={60} inputMode={f.payout_method === 'vodafone_cash' ? 'tel' : 'text'} />
        </Field>
        <button type="submit" className="btn btn-primary block" disabled={busy}>{busy ? t('loading') : t('savePayout')}</button>
      </>}
    </form>
  );
}

// ---------- More / profile ----------
export function More({ onLogout, onProfileSaved, notify }) {
  const { t, lang, profile } = useApp();
  const [f, setF] = useState({ full_name: profile.full_name || '', phone: profile.phone || '', city: profile.city || 'Cairo' });
  const phoneLocked = profile.role !== 'admin' && Boolean(profile.phone); // only the Forsa team changes a saved phone
  const [busy, setBusy] = useState(false);
  async function save(ev) {
    ev.preventDefault();
    setBusy(true);
    const patch = phoneLocked ? { full_name: f.full_name, city: f.city } : f;
    try { await api.updateProfile(profile.id, patch); notify(t('saved')); onProfileSaved(); }
    catch (err) { notify(err.message); }
    finally { setBusy(false); }
  }
  const links = profile.role === 'agency' ? [] : [['/business', 'store', t('myBusiness')], ['/earnings', 'wallet', t('earnings')], ['/plan', 'card', t('plan')]];
  if (profile.role === 'admin') links.push(['/admin', 'shield', t('admin')]);
  return (
    <div className="screen">
      <Header title={t('account')} back="/home" />
      <div className="list">
        {links.map(([to, icon, label]) => (
          <button type="button" key={to} className="order-row" onClick={() => go(to)}><Icon name={icon} /><div className="or-main"><b>{label}</b></div><Icon name="chevron" size={16} /></button>
        ))}
        <div className="order-row static"><Icon name="globe" /><div className="or-main"><b>{t('language')}</b></div><LangSwitch /></div>
      </div>
      {profile.role !== 'agency' && <PayoutDetails notify={notify} onSaved={onProfileSaved} />}
      <div className="section-head"><h2>{t('profile')}</h2></div>
      <form onSubmit={save} noValidate className="card stack">
        <p className="muted small" dir="ltr">{profile.email}</p>
        <Field id="pr-name" label={t('fullName')}><input id="pr-name" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field id="pr-phone" label={t('phone')} hint={phoneLocked ? t('phoneLocked') : undefined}><input id="pr-phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} dir="ltr" readOnly={phoneLocked} /></Field>
        <Field id="pr-city" label={t('city')}>
          <select id="pr-city" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })}>{GOVERNORATES.map(([en, ar]) => <option key={en} value={en}>{lang === 'ar' ? ar : en}</option>)}</select>
        </Field>
        <button type="submit" className="btn btn-primary block" disabled={busy}>{t('save')}</button>
      </form>
      <Button block variant="ghost" onClick={onLogout}><Icon name="logout" size={18} /> {t('logout')}</Button>
    </div>
  );
}
