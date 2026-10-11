import React, { useState } from 'react';
import { useApp, Button, Field, go, LangSwitch, Icon } from '../core.jsx';
import { GOVERNORATES } from '../lib/i18n.js';
import * as api from '../lib/api.js';

const appUrl = () => window.location.origin + window.location.pathname;
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RX = /^(\+?20)?0?1[0125]\d{8}$/;

// ---------- Intro slides (first launch only) ----------
export function Intro({ onDone }) {
  const { t, lang } = useApp();
  const [i, setI] = React.useState(0);
  const track = React.useRef(null);
  const slides = [
    ['intro1t', 'intro1d', <div className="art-photos" key="a"><img src="products/p1.jpg" alt="" /><img src="products/p2.jpg" alt="" /><img src="products/p3.jpg" alt="" /></div>],
    ['intro2t', 'intro2d', (
      <div className="art-earn" key="b">
        <div className="row-between"><span className="muted">{t('yourPrice')}</span><b>{lang === 'ar' ? '٥٢٠ ج.م' : 'EGP 520'}</b></div>
        <div className="row-between"><span className="muted">{t('wholesale')}</span><b>{lang === 'ar' ? '٣٢٠ ج.م' : 'EGP 320'}</b></div>
        <div className="profit-box"><span>{t('earnPerSale')}</span><b>{lang === 'ar' ? '٢٠٠ ج.م' : 'EGP 200'}</b></div>
      </div>
    )],
    ['intro3t', 'intro3d', (
      <div className="ink-card art-goal" key="c">
        <span className="eyebrow">{t('month1')}</span>
        <b className="big">{lang === 'ar' ? '٠ ج.م' : 'EGP 0'}</b>
        <div className="tracker"><span className="on" /><span className="on" /><span /></div>
        <small>{t('goal')}</small>
      </div>
    )],
  ];
  const onScroll = () => {
    const el = track.current; if (!el) return;
    setI(Math.round(Math.abs(el.scrollLeft) / el.clientWidth));
  };
  const goTo = (n) => {
    const el = track.current; if (!el) return;
    el.scrollTo({ left: (lang === 'ar' ? -1 : 1) * n * el.clientWidth, behavior: 'smooth' });
  };
  const last = i >= slides.length - 1;
  return (
    <div className="intro">
      <div className="intro-top">
        <span className="wordmark" style={{ fontSize: 22 }}>Forsa</span>
        <div className="row" style={{ alignItems: 'center', gap: 14 }}>
          <LangSwitch />
          {!last && <button type="button" className="link-btn" onClick={() => onDone('/')}>{t('skip')}</button>}
        </div>
      </div>
      <div className="intro-track" ref={track} onScroll={onScroll}>
        {slides.map(([title, desc, art]) => (
          <section key={title} className="slide" aria-label={t(title)}>
            <div className="slide-art">{art}</div>
            <div className="stack" style={{ gap: 12 }}><h2>{t(title)}</h2><p>{t(desc)}</p></div>
          </section>
        ))}
      </div>
      <div className="dots" aria-hidden="true">{slides.map((_, n) => <i key={n} className={n === i ? 'on' : ''} />)}</div>
      {last ? (
        <div className="stack">
          <Button block onClick={() => onDone('/signup')}>{t('start')}</Button>
          <Button block variant="ghost" onClick={() => onDone('/login')}>{t('haveAccount')}</Button>
        </div>
      ) : <Button block onClick={() => goTo(i + 1)}>{t('next')} <Icon name="arrow" size={18} /></Button>}
    </div>
  );
}

export function Welcome() {
  const { t } = useApp();
  const steps = [['how1t', 'how1d', 'grid'], ['how2t', 'how2d', 'sparkle'], ['how3t', 'how3d', 'wallet']];
  return (
    <div className="screen welcome">
      <div className="welcome-top"><span /><LangSwitch /></div>
      <div className="brand-block">
        <div className="wordmark">Forsa</div>
        <div className="wordmark-ar" lang="ar">فرصة</div>
        <p className="tagline">{t('tagline')}</p>
      </div>
      <ol className="how">
        {steps.map(([title, desc, icon], i) => (
          <li key={title} className="how-item">
            <span className="how-num">{i + 1}</span>
            <div><h3>{t(title)}</h3><p>{t(desc)}</p></div>
            <Icon name={icon} />
          </li>
        ))}
      </ol>
      <div className="card plan-mini">
        <h3>{t('planTitle')}</h3>
        <ul>
          <li><Icon name="check" size={16} />{t('planM1')}</li>
          <li><Icon name="check" size={16} />{t('planSkip')}</li>
          <li><Icon name="check" size={16} />{t('planM2')}</li>
          <li><Icon name="check" size={16} />{t('planNoStock')}</li>
        </ul>
      </div>
      <div className="stack">
        <Button block onClick={() => go('/signup')}>{t('getStarted')}</Button>
        <Button block variant="ghost" onClick={() => go('/login')}>{t('haveAccount')}</Button>
      </div>
    </div>
  );
}

export function Signup({ onAuthed }) {
  const { t, lang } = useApp();
  const [f, setF] = useState({ full_name: '', phone: '', email: '', city: 'Cairo', user_type: 'student', university: '', password: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function validate() {
    const e = {};
    if (!f.full_name.trim()) e.full_name = t('required');
    if (!PHONE_RX.test(f.phone.replace(/[\s-]/g, ''))) e.phone = t('invalidPhone');
    if (!EMAIL_RX.test(f.email.trim())) e.email = t('invalidEmail');
    if (f.user_type === 'student' && !f.university.trim()) e.university = t('required');
    if (f.password.length < 8) e.password = t('shortPassword');
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev) {
    ev.preventDefault();
    setServerError('');
    if (!validate()) return;
    setBusy(true);
    try {
      const res = await api.signUp({ ...f, email: f.email.trim().toLowerCase(), phone: f.phone.replace(/[\s-]/g, '') }, appUrl());
      if (res.session) onAuthed(); else go('/check-email');
    } catch (err) {
      setServerError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="screen auth">
      <div className="welcome-top"><button type="button" className="icon-btn" onClick={() => go('/')} aria-label={t('back')}><Icon name="back" /></button><LangSwitch /></div>
      <h1 className="auth-title">{t('signup')}</h1>
      <form onSubmit={submit} noValidate className="stack">
        <Field id="su-name" label={t('fullName')} error={errors.full_name}><input id="su-name" value={f.full_name} onChange={set('full_name')} autoComplete="name" /></Field>
        <Field id="su-phone" label={t('phone')} error={errors.phone}><input id="su-phone" value={f.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" placeholder="01012345678" dir="ltr" /></Field>
        <Field id="su-email" label={t('email')} error={errors.email}><input id="su-email" type="email" value={f.email} onChange={set('email')} autoComplete="email" dir="ltr" /></Field>
        <Field id="su-city" label={t('city')}>
          <select id="su-city" value={f.city} onChange={set('city')}>
            {GOVERNORATES.map(([en, ar]) => <option key={en} value={en}>{lang === 'ar' ? ar : en}</option>)}
          </select>
        </Field>
        <Field id="su-type" label={t('iAm')}>
          <select id="su-type" value={f.user_type} onChange={set('user_type')}>
            <option value="student">{t('student')}</option><option value="employee">{t('employee')}</option>
            <option value="extra_income">{t('extra')}</option><option value="other">{t('other')}</option>
          </select>
        </Field>
        {f.user_type === 'student' && (
          <Field id="su-uni" label={t('university')} error={errors.university}><input id="su-uni" value={f.university} onChange={set('university')} /></Field>
        )}
        <Field id="su-pw" label={t('password')} error={errors.password} hint={t('shortPassword')}><input id="su-pw" type="password" value={f.password} onChange={set('password')} autoComplete="new-password" dir="ltr" /></Field>
        {serverError && <p className="form-error" role="alert">{serverError}</p>}
        <button type="submit" className="btn btn-primary block" disabled={busy}>{busy ? t('loading') : t('signup')}</button>
        <p className="muted center">{t('already')} <a href="#/login">{t('login')}</a></p>
      </form>
    </div>
  );
}

export function Login({ onAuthed }) {
  const { t } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(ev) {
    ev.preventDefault();
    setError('');
    if (!EMAIL_RX.test(email.trim()) || !password) { setError(t('invalidEmail')); return; }
    setBusy(true);
    try { await api.signIn(email.trim().toLowerCase(), password); onAuthed(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="screen auth">
      <div className="welcome-top"><button type="button" className="icon-btn" onClick={() => go('/')} aria-label={t('back')}><Icon name="back" /></button><LangSwitch /></div>
      <h1 className="auth-title">{t('login')}</h1>
      <form onSubmit={submit} noValidate className="stack">
        <Field id="li-email" label={t('email')}><input id="li-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" dir="ltr" /></Field>
        <Field id="li-pw" label={t('password')}><input id="li-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" dir="ltr" /></Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary block" disabled={busy}>{busy ? t('loading') : t('login')}</button>
        <p className="center"><a href="#/forgot">{t('forgot')}</a></p>
        <p className="muted center">{t('noAccount')} <a href="#/signup">{t('signup')}</a></p>
      </form>
    </div>
  );
}

export function Forgot() {
  const { t } = useApp();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(ev) {
    ev.preventDefault();
    if (!EMAIL_RX.test(email.trim())) { setError(t('invalidEmail')); return; }
    setBusy(true); setError('');
    try { await api.sendReset(email.trim().toLowerCase(), appUrl()); setSent(true); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="screen auth">
      <div className="welcome-top"><button type="button" className="icon-btn" onClick={() => go('/login')} aria-label={t('back')}><Icon name="back" /></button><LangSwitch /></div>
      <h1 className="auth-title">{t('forgot')}</h1>
      {sent ? <p className="card">{t('resetSent')}</p> : (
        <form onSubmit={submit} noValidate className="stack">
          <Field id="fg-email" label={t('email')} error={error}><input id="fg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" /></Field>
          <button type="submit" className="btn btn-primary block" disabled={busy}>{t('sendReset')}</button>
        </form>
      )}
    </div>
  );
}

export function ResetPassword({ onDone }) {
  const { t } = useApp();
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(ev) {
    ev.preventDefault();
    if (pw.length < 8) { setError(t('shortPassword')); return; }
    setBusy(true);
    try { await api.setPassword(pw); onDone(t('passwordSaved')); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="screen auth">
      <h1 className="auth-title">{t('newPassword')}</h1>
      <form onSubmit={submit} noValidate className="stack">
        <Field id="rp-pw" label={t('newPassword')} error={error}><input id="rp-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" dir="ltr" /></Field>
        <button type="submit" className="btn btn-primary block" disabled={busy}>{t('savePassword')}</button>
      </form>
    </div>
  );
}

export function CheckEmail() {
  const { t } = useApp();
  return (
    <div className="screen auth">
      <div className="welcome-top"><span /><LangSwitch /></div>
      <h1 className="auth-title">{t('checkEmail')}</h1>
      <p className="card">{t('checkEmailBody')}</p>
      <Button block onClick={() => go('/login')}>{t('login')}</Button>
    </div>
  );
}
