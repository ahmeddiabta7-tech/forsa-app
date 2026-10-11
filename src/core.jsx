// Shared app state, routing, formatting and UI building blocks.
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { STRINGS } from './lib/i18n.js';
import { PLAN } from './config.js';

// ---------- App context ----------
export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function useLangState() {
  const [lang, setLang] = useState(() => { try { return localStorage.getItem('forsa-lang') || 'en'; } catch { return 'en'; } });
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    try { localStorage.setItem('forsa-lang', lang); } catch { /* ignore */ }
  }, [lang]);
  const t = useCallback((key, vars) => {
    let s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
    if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replace(`{${k}}`, v); });
    return s;
  }, [lang]);
  return { lang, setLang, t };
}

// ---------- Hash router ----------
export function useRoute() {
  const get = () => (window.location.hash.replace(/^#/, '') || '/');
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => { setRoute(get()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
export const go = (path) => { if (window.location.hash !== `#${path}`) window.location.hash = path; };

// ---------- Formatting ----------
export function money(n, lang) {
  const v = Math.round(Number(n) || 0);
  return lang === 'ar' ? `${v.toLocaleString('ar-EG')} ج.م` : `EGP ${v.toLocaleString('en-US')}`;
}
export function num(n, lang) { return lang === 'ar' ? Number(n).toLocaleString('ar-EG') : Number(n).toLocaleString('en-US'); }
export function date(d, lang) {
  return new Date(d).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
export const pname = (p, lang) => (p ? (lang === 'ar' ? p.name_ar || p.name_en : p.name_en) : '');
export function imgSrc(url) { return url || ''; }
export const orderProfit = (o) => (o.unit_price - o.wholesale_price) * o.quantity;

// ---------- Plan logic ----------
// Monthly rule (same as the database's can_sell):
// months are 30-day blocks from signup. The first month is open. In every later month the seller can
// sell if they delivered 3+ orders in the previous month, or if a paid period (EGP 100 = 30 days) is active.
export const deliveredAt = (o) => new Date(o.delivered_at || o.updated_at || o.created_at).getTime();

export function planState(profile, orders) {
  const MONTH = PLAN.trialDays * 864e5;
  const start = new Date(profile.trial_started_at).getTime();
  const nowMs = Date.now();
  const k = Math.max(0, Math.floor((nowMs - start) / MONTH));
  const monthStart = start + k * MONTH;
  const monthEnd = monthStart + MONTH;
  const delivered = orders.filter((o) => o.status === 'delivered');
  const countIn = (a, b) => delivered.filter((o) => { const t = deliveredAt(o); return t >= a && t < b; }).length;
  const thisMonth = countIn(monthStart, monthEnd);
  const lastMonth = k > 0 ? countIn(monthStart - MONTH, monthStart) : 0;
  const paid = Boolean(profile.paid_until && nowMs < new Date(profile.paid_until).getTime());
  const earnedFree = k > 0 && lastMonth >= PLAN.goalOrders;
  const canSell = k === 0 || earnedFree || paid;
  return {
    canSell,
    phase: !canSell ? 'frozen' : paid ? 'paid' : k === 0 ? 'first' : 'free',
    monthIndex: k,
    delivered: Math.min(thisMonth, PLAN.goalOrders),
    goalDone: thisMonth >= PLAN.goalOrders,
    lastMonth,
    daysLeft: Math.max(0, Math.ceil((monthEnd - nowMs) / 864e5)),
    paidUntil: profile.paid_until,
  };
}

export function earningsSummary(orders, payouts) {
  const earned = orders.filter((o) => o.status === 'delivered').reduce((s, o) => s + orderProfit(o), 0);
  const onTheWay = orders.filter((o) => ['confirmed', 'shipped'].includes(o.status)).reduce((s, o) => s + orderProfit(o), 0);
  const paidOut = payouts.reduce((s, p) => s + p.amount, 0);
  return { earned, onTheWay, paidOut, balance: Math.max(0, earned - paidOut) };
}

// ---------- UI components ----------
export function Button({ children, variant = 'primary', block, small, ...rest }) {
  return <button type="button" className={`btn btn-${variant}${block ? ' block' : ''}${small ? ' small' : ''}`} {...rest}>{children}</button>;
}

export function Field({ label, error, hint, children, id }) {
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      {label && <label htmlFor={id}>{label}</label>}
      {children}
      {error ? <p className="field-error" role="alert">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

export function Header({ title, back, right, noLang }) {
  const { t } = useApp();
  if (!right && !noLang) right = <LangSwitch />;
  return (
    <header className="topbar">
      {back ? <button type="button" className="icon-btn" onClick={() => (typeof back === 'string' ? go(back) : history.back())} aria-label={t('back')}><Icon name="back" /></button> : noLang ? <span className="topbar-spacer" /> : <AccountButton />}
      <h1>{title}</h1>
      {right || <span className="topbar-spacer" />}
    </header>
  );
}

export function StatusPill({ status, kind = 'status' }) {
  const { t } = useApp();
  return <span className={`pill pill-${status}`}>{t(`${kind}_${status}`)}</span>;
}

export function Spinner() { const { t } = useApp(); return <div className="spinner-wrap" role="status"><div className="spinner" /><span className="sr">{t('loading')}</span></div>; }

export function ErrorBox({ error, onRetry }) {
  const { t } = useApp();
  return (
    <div className="card error-box" role="alert">
      <p>{error?.message || t('error')}</p>
      {onRetry && <Button variant="ghost" small onClick={onRetry}>{t('retry')}</Button>}
    </div>
  );
}

export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => setState({ loading: false, data, error: null })).catch((error) => setState({ loading: false, data: null, error }));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

export function Sheet({ open, onClose, title, children }) {
  const { t } = useApp();
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h2>{title}</h2><button type="button" className="icon-btn" onClick={onClose} aria-label={t('close')}><Icon name="close" /></button></div>
        {children}
      </div>
    </div>
  );
}

const PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  box: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14.5h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  back: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  copy: 'M8 8h11v11H8zM5 16V5h11',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  card: 'M3 6h18v12H3zM3 10h18',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.7 3.5 5.7 3.5 9s-1 6.3-3.5 9c-2.5-2.7-3.5-5.7-3.5-9s1-6.3 3.5-9z',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  plus: 'M12 5v14M5 12h14',
  chevron: 'M9 5l7 7-7 7',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  megaphone: 'M3 10v4a1 1 0 0 0 1 1h3l6 4V5L7 9H4a1 1 0 0 0-1 1zM17 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5',
  eyeoff: 'M3 3l18 18M10.6 6.1A9.7 9.7 0 0 1 12 6c5 0 9 6 9 6a15 15 0 0 1-2.7 3.2M6.6 6.6C4.3 8.1 3 12 3 12s4 6 9 6a8.7 8.7 0 0 0 4.4-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2',
  arrow: 'M5 12h14M13 6l6 6-6 6',
};
export function Icon({ name, size = 20 }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

// Opens the account page (profile, plan, earnings, language, logout).
export function AccountButton() {
  const { t } = useApp();
  return <button type="button" className="icon-btn" onClick={() => go('/more')} aria-label={t('account')}><Icon name="user" /></button>;
}

// Two clear options, always visible: EN | ع
export function LangSwitch() {
  const { lang, setLang } = useApp();
  return (
    <div className="lang-switch" role="group" aria-label="Language / اللغة" dir="ltr">
      <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')} lang="en">EN</button>
      <button type="button" className="ar" aria-pressed={lang === 'ar'} onClick={() => setLang('ar')} lang="ar" aria-label="العربية">ع</button>
    </div>
  );
}

export function greeting(t) {
  const h = new Date().getHours();
  return h < 12 ? t('goodMorning') : h < 17 ? t('goodAfternoon') : t('goodEvening');
}

export function weekdayName(i, lang) {
  const d = new Date(2024, 0, 7 + i); // 7 Jan 2024 was a Sunday
  return d.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'long' });
}

// Small bar chart (no labels) used in cards.
export function MiniBars({ values, label }) {
  const max = Math.max(1, ...values);
  return (
    <div className="bars" role="img" aria-label={label} dir="ltr">
      {values.map((v, i) => <i key={i} className={v <= 0 ? 'zero' : ''} style={{ height: `${Math.max(6, (v / max) * 100)}%` }} />)}
    </div>
  );
}

export function Toast({ msg }) {
  if (!msg) return null;
  return <div className="toast" role="status">{msg}</div>;
}
