import React, { useCallback, useEffect, useState } from 'react';
import { AppCtx, useLangState, useRoute, go, Icon, Spinner, Toast, ErrorBox } from './core.jsx';
import { Welcome, Signup, Login, Forgot, ResetPassword, CheckEmail } from './pages/Auth.jsx';
import { Home, Products, ProductDetail, Orders, Earnings } from './pages/Seller.jsx';
import { Plan, Idea, More } from './pages/Account.jsx';
import { Admin } from './pages/Admin.jsx';
import * as api from './lib/api.js';
import { auth } from './lib/supa.js';

const PUBLIC = ['/', '/signup', '/login', '/forgot', '/check-email'];

export default function App() {
  const L = useLangState();
  const route = useRoute();
  const [profile, setProfile] = useState(null);
  const [booting, setBooting] = useState(true);
  const [recovery, setRecovery] = useState(false);
  const [data, setData] = useState({ orders: [], payouts: [] });
  const [toast, setToast] = useState('');
  const [loadError, setLoadError] = useState(null);

  const notify = useCallback((m) => { setToast(m); clearTimeout(window.__ft); window.__ft = setTimeout(() => setToast(''), 2800); }, []);

  const loadData = useCallback(async () => {
    const [orders, payouts] = await Promise.all([api.myOrders(), api.myPayouts()]);
    setData({ orders, payouts });
  }, []);

  const boot = useCallback(async () => {
    setLoadError(null);
    try {
      if (!api.hasSession()) { setProfile(null); return; }
      const p = await api.getProfile();
      if (!p) { await api.signOut(); setProfile(null); return; }
      setProfile(p);
      await loadData();
    } catch (e) {
      if (e.status === 401 || e.status === 403) { await api.signOut(); setProfile(null); }
      else setLoadError(e);
    } finally { setBooting(false); }
  }, [loadData]);

  useEffect(() => {
    const type = api.isLive ? auth.consumeUrlSession() : null;
    if (type === 'recovery') setRecovery(true);
    boot();
  }, [boot]);

  const onAuthed = useCallback(async () => { setBooting(true); await boot(); go('/home'); }, [boot]);
  const logout = useCallback(async () => { await api.signOut(); setProfile(null); setData({ orders: [], payouts: [] }); go('/'); }, []);

  // Route guards
  useEffect(() => {
    if (booting) return;
    if (!profile && !PUBLIC.includes(route)) go('/');
    if (profile && PUBLIC.includes(route)) go('/home');
    if (profile && route.startsWith('/admin') && profile.role !== 'admin') go('/home');
  }, [booting, profile, route]);

  const ctx = { ...L, profile };
  let screen;
  if (booting) screen = <Spinner />;
  else if (loadError) screen = <div className="screen"><ErrorBox error={loadError} onRetry={boot} /></div>;
  else if (recovery) screen = <ResetPassword onDone={(m) => { setRecovery(false); notify(m); go('/home'); }} />;
  else if (!profile) {
    screen = route === '/signup' ? <Signup onAuthed={onAuthed} />
      : route === '/login' ? <Login onAuthed={onAuthed} />
        : route === '/forgot' ? <Forgot />
          : route === '/check-email' ? <CheckEmail /> : <Welcome />;
  } else {
    const [, a, b] = route.split('/');
    const reload = () => loadData().catch((e) => notify(e.message));
    switch (a) {
      case 'products': screen = <Products />; break;
      case 'product': screen = <ProductDetail id={b} data={data} notify={notify} onOrdered={() => { notify(L.t('orderPlaced')); reload(); go('/orders'); }} />; break;
      case 'orders': screen = <Orders data={data} openId={b} reload={reload} notify={notify} />; break;
      case 'earnings': screen = <Earnings data={data} />; break;
      case 'more': screen = <More onLogout={logout} notify={notify} onProfileSaved={() => api.getProfile().then(setProfile)} />; break;
      case 'plan': screen = <Plan data={data} notify={notify} />; break;
      case 'idea': screen = <Idea notify={notify} />; break;
      case 'admin': screen = profile.role === 'admin' ? <Admin notify={notify} /> : null; break;
      default: screen = <Home data={data} />;
    }
  }

  const [, section] = route.split('/');
  const showNav = profile && !booting && !recovery && section !== 'admin';
  const tabs = [['home', 'home'], ['products', 'grid'], ['orders', 'box'], ['earnings', 'wallet'], ['more', 'more']];
  const active = section === 'product' ? 'products' : ['plan', 'idea'].includes(section) ? 'more' : section || 'home';

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        {!api.isLive && <div className="demo-banner">{L.t('demoBanner')}</div>}
        <main className={showNav ? 'with-nav' : ''}>{screen}</main>
        {showNav && (
          <nav className="tabbar" aria-label="Main">
            {tabs.map(([k, icon]) => (
              <a key={k} href={`#/${k}`} className={active === k ? 'on' : ''} aria-current={active === k ? 'page' : undefined}>
                <Icon name={icon} size={22} /><span>{L.t(k)}</span>
              </a>
            ))}
          </nav>
        )}
        <Toast msg={toast} />
      </div>
    </AppCtx.Provider>
  );
}
