import React, { useState } from 'react';
import { useApp, Button, Field, Header, StatusPill, Spinner, ErrorBox, useLoad, Icon, go, money, num, date, planState, LangSwitch } from '../core.jsx';
import { GOVERNORATES } from '../lib/i18n.js';
import { PAYMENT_INFO, PLAN } from '../config.js';
import * as api from '../lib/api.js';

// ---------- Plan & payments ----------
export function Plan({ data, notify }) {
  const { t, lang, profile } = useApp();
  const plan = planState(profile, data.orders);
  const { loading, data: payments, error, reload } = useLoad(() => api.myPayments(), []);
  const [f, setF] = useState({ method: 'instapay', reference: '', months: 1 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit(ev) {
    ev.preventDefault();
    if (!f.reference.trim()) { setErr(t('required')); return; }
    setBusy(true); setErr('');
    try {
      await api.submitPayment({ method: f.method, reference: f.reference.trim(), months: Number(f.months), amount: PLAN.monthlyFee * Number(f.months) });
      setF({ ...f, reference: '' }); notify(t('paymentSent')); reload();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }
  const amount = PLAN.monthlyFee * Number(f.months);
  return (
    <div className="screen">
      <Header title={t('plan')} back="/more" />
      <div className="card">
        <span className="eyebrow">{t('planTitle')}</span>
        <p className="plan-big">
          {plan.phase === 'active' ? t('activeUntil', { d: date(plan.paidUntil, lang) })
            : plan.phase === 'trial' ? `${t('month1')} · ${t('daysLeft', { n: num(plan.daysLeft, lang) })}` : t('expired')}
        </p>
        <ul className="ticks">
          <li><Icon name="check" size={16} />{t('planM1')}</li>
          <li><Icon name="check" size={16} />{t('planSkip')}</li>
          <li><Icon name="check" size={16} />{t('planM2')}</li>
        </ul>
      </div>
      <div className="card">
        <h3>{t('payHow')}</h3>
        <p>{t('payStep1', { a: num(amount, lang) })}</p>
        <dl className="kv">
          <dt>InstaPay</dt><dd dir="ltr">{PAYMENT_INFO.instapay}</dd>
          <dt>Vodafone Cash</dt><dd dir="ltr">{PAYMENT_INFO.vodafone_cash}</dd>
        </dl>
        <p className="muted small">{t('payStep2')}</p>
        <form onSubmit={submit} noValidate className="stack">
          <Field id="pl-method" label={t('method')}>
            <select id="pl-method" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
              <option value="instapay">InstaPay</option><option value="vodafone_cash">Vodafone Cash</option>
            </select>
          </Field>
          <Field id="pl-months" label={t('months')}>
            <select id="pl-months" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })}>
              {[1, 3, 6].map((m) => <option key={m} value={m}>{num(m, lang)} · {money(PLAN.monthlyFee * m, lang)}</option>)}
            </select>
          </Field>
          <Field id="pl-ref" label={t('reference')} error={err}><input id="pl-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} dir="ltr" /></Field>
          <button type="submit" className="btn btn-primary block" disabled={busy}>{busy ? t('loading') : `${t('submitPayment')} · ${money(amount, lang)}`}</button>
        </form>
      </div>
      <div className="section-head"><h2>{t('paymentHistory')}</h2></div>
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
        <div className="list">
          {(payments || []).map((p) => (
            <div key={p.id} className="order-row static">
              <Icon name="card" />
              <div className="or-main"><b>{money(p.amount, lang)}</b><span className="muted small">{date(p.created_at, lang)} · <span dir="ltr">{p.reference}</span></span></div>
              <StatusPill status={p.status === 'approved' ? 'delivered' : p.status === 'rejected' ? 'cancelled' : 'pending'} kind="status" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- More / profile ----------
export function More({ onLogout, onProfileSaved, notify }) {
  const { t, lang, profile } = useApp();
  const [f, setF] = useState({ full_name: profile.full_name || '', phone: profile.phone || '', city: profile.city || 'Cairo' });
  const [busy, setBusy] = useState(false);
  async function save(ev) {
    ev.preventDefault();
    setBusy(true);
    try { await api.updateProfile(profile.id, f); notify(t('saved')); onProfileSaved(); }
    catch (err) { notify(err.message); }
    finally { setBusy(false); }
  }
  const links = [['/earnings', 'wallet', t('earnings')], ['/plan', 'card', t('plan')]];
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
      <div className="section-head"><h2>{t('profile')}</h2></div>
      <form onSubmit={save} noValidate className="card stack">
        <p className="muted small" dir="ltr">{profile.email}</p>
        <Field id="pr-name" label={t('fullName')}><input id="pr-name" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field id="pr-phone" label={t('phone')}><input id="pr-phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} dir="ltr" /></Field>
        <Field id="pr-city" label={t('city')}>
          <select id="pr-city" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })}>{GOVERNORATES.map(([en, ar]) => <option key={en} value={en}>{lang === 'ar' ? ar : en}</option>)}</select>
        </Field>
        <button type="submit" className="btn btn-primary block" disabled={busy}>{t('save')}</button>
      </form>
      <Button block variant="ghost" onClick={onLogout}><Icon name="logout" size={18} /> {t('logout')}</Button>
    </div>
  );
}
