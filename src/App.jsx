import React, { useCallback, useEffect, useState } from 'react';
import { AppCtx, useLangState, useRoute, go, Icon, Spinner, Toast, ErrorBox } from './core.jsx';
import { Intro, Welcome, Signup, Login, Forgot, ResetPassword, CheckEmail } from './pages/Auth.jsx';
import { Home, Products, ProductDetail, Orders, Earnings } from './pages/Seller.jsx';
import { Plan, More } from './pages/Account.jsx';
import { Analytics, Ideas, Services } from './pages/Grow.jsx';
import { MyBusiness } from './pages/Business.jsx';
import { ChatPage, AgencyHome } from './pages/Chat.jsx';
import { MakeHome, ManufacturerPage, CustomRequestPage, Inbox } from './pages/Make.jsx';
import { Admin } from './pages/Admin.jsx';
import { AdvisorChat } from './pages/Advisor.jsx';
import * as api from './lib/api.js';
import { auth } from './lib/supa.js';

const PUBLIC = ['/', '/signup', '/login', '/forgot', '/check-email'];

export default function App() {
  const L = useLangState();
  const route = useRoute();
  const [profile, setProfile] = useState(null);
  const [booting, setBooting] = useState(true);
  const [recovery, setRecovery] = useState(false);
  const EMPTY = { orders: [], payouts: [], expenses: [], businesses: [] };
  const [data, setData] = useState(EMPTY);
  const [unread, setUnread] = useState({});
  const [toast, setToast] = useState('');
  const [loadError, setLoadError] = useState(null);
  const [introSeen, setIntroSeen] = useState(() => { try { return localStorage.getItem('forsa-intro') === '1'; } catch { return true; } });
  const finishIntro = useCallback((to) => { try { localStorage.setItem('forsa-intro', '1'); } catch { /* ignore */ } setIntroSeen(true); go(to); }, []);

  const notify = useCallback((m) => { setToast(m); clearTimeout(window.__ft); window.__ft = setTimeout(() => setToast(''), 2800); }, []);

  const loadData = useCallback(async () => {
    const [orders, payouts, expenses, businesses, fresh] = await Promise.all([
      api.myOrders(), api.myPayouts(), api.myExpenses().catch(() => []), api.myBusinesses().catch(() => []), api.getProfile().catch(() => null)]);
    setData({ orders, payouts, expenses, businesses });
    if (fresh) setProfile((cur) => (cur && JSON.stringify(cur) === JSON.stringify(fresh) ? cur : fresh)); // plan / unlock may have changed
    return { orders, fresh };
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
    } finally { setBooting(false); window.__forsaReady?.(); }
  }, [loadData]);

  useEffect(() => {
    const type = api.isLive ? auth.consumeUrlSession() : null;
    if (type === 'recovery') setRecovery(true);
    boot();
  }, [boot]);

  const onAuthed = useCallback(async () => { setBooting(true); await boot(); go('/home'); }, [boot]);
  const logout = useCallback(async () => { await api.signOut(); setProfile(null); setData(EMPTY); setUnread({}); go('/'); }, []);

  // Route guards
  useEffect(() => {
    if (booting) return;
    if (!profile && !PUBLIC.includes(route)) go('/');
    if (profile && PUBLIC.includes(route)) go('/home');
    if (profile && route.startsWith('/admin') && profile.role !== 'admin') go('/home');
  }, [booting, profile, route]);

  // Refresh orders/payouts whenever the seller opens a screen that shows them (admin may have updated statuses).
  const [, sectionNow] = route.split('/');
  useEffect(() => {
    if (booting || !profile) return;
    if (['home', 'orders', 'analytics', 'earnings', 'plan', 'business', 'products', 'services', 'make', 'inbox', 'advisor', ''].includes(sectionNow || '')) loadData().catch(() => {});
  }, [sectionNow, booting, profile?.id, loadData]); // eslint-disable-line react-hooks/exhaustive-deps

  // New chat messages: check every 30 seconds (and when the screen changes).
  const loadUnread = useCallback(() => { api.unreadCounts().then(setUnread).catch(() => {}); }, []);
  useEffect(() => {
    if (booting || !profile) return undefined;
    loadUnread();
    const timer = setInterval(() => { if (!document.hidden) loadUnread(); }, 30000);
    return () => clearInterval(timer);
  }, [booting, profile?.id, sectionNow, loadUnread]); // eslint-disable-line react-hooks/exhaustive-deps

  const unreadSum = Object.values(unread).reduce((x, n) => x + n, 0);
  const ctx = { ...L, profile, unreadTotal: unreadSum };
  let screen;
  if (booting) screen = <Spinner />;
  else if (loadError) screen = <div className="screen"><ErrorBox error={loadError} onRetry={boot} /></div>;
  else if (recovery) screen = <ResetPassword onDone={(m) => { setRecovery(false); notify(m); go('/home'); }} />;
  else if (!profile) {
    screen = route === '/signup' ? <Signup onAuthed={onAuthed} />
      : route === '/login' ? <Login onAuthed={onAuthed} />
        : route === '/forgot' ? <Forgot />
          : route === '/check-email' ? <CheckEmail /> : introSeen ? <Welcome /> : <Intro onDone={finishIntro} />;
  } else {
    const [, a, b] = route.split('/');
    const reload = () => loadData().catch((e) => notify(e.message));
    if (profile.role === 'agency') {
      // Partner agencies only see their assigned requests, the chat, and their account.
      screen = a === 'chat' ? <ChatPage id={b} onRead={loadUnread} />
        : a === 'more' ? <More onLogout={logout} notify={notify} onProfileSaved={() => api.getProfile().then(setProfile)} />
          : <AgencyHome unread={unread} notify={notify} />;
    } else switch (a) {
      case 'products': screen = <Products data={data} />; break;
      case 'product': screen = <ProductDetail id={b} data={data} reload={reload} notify={notify} onOrdered={async (o) => {
        await loadData().catch(() => null);
        notify(L.t('orderPlaced')); go(o?.id ? `/orders/${o.id}` : '/orders');
      }} />; break;
      case 'orders': screen = <Orders data={data} openId={b} reload={reload} notify={notify} />; break;
      case 'earnings': screen = <Earnings data={data} />; break;
      case 'more': screen = <More onLogout={logout} notify={notify} onProfileSaved={() => api.getProfile().then(setProfile)} />; break;
      case 'plan': screen = <Plan data={data} />; break;
      case 'idea': case 'ideas': screen = <Ideas notify={notify} />; break;
      case 'analytics': screen = <Analytics data={data} reload={reload} notify={notify} />; break;
      case 'business': screen = <MyBusiness id={b} data={data} reload={reload} notify={notify} unread={unread} />; break;
      case 'make': {
        const [, , kind, mid] = route.split('/');
        screen = kind === 'm' ? <ManufacturerPage id={mid} data={data} notify={notify} />
          : kind === 'r' ? <CustomRequestPage id={mid} notify={notify} reload={reload} /> : <MakeHome />;
        break;
      }
      case 'inbox': screen = <Inbox bizId={b} data={data} unread={unread} />; break;
      case 'advisor': screen = <AdvisorChat bizId={b} data={data} />; break;
      case 'services': screen = <Services notify={notify} data={data} unread={unread} />; break;
      case 'chat': screen = <ChatPage id={b} onRead={loadUnread} />; break;
      case 'admin': screen = profile.role === 'admin' ? <Admin notify={notify} /> : null; break;
      default: screen = <Home data={data} />;
    }
  }

  const [, section] = route.split('/');
  const showNav = profile && profile.role !== 'agency' && !booting && !recovery && section !== 'admin';
  const tabs = [['home', 'home', 'home'], ['products', 'grid', 'products'], ['orders', 'box', 'orders'], ['business', 'store', 'bizTab'], ['services', 'megaphone', 'services'], ['ideas', 'bulb', 'ideas']];
  const active = ['product', 'make'].includes(section) ? 'products' : ['inbox', 'advisor'].includes(section) ? 'business' : section === 'idea' ? 'ideas' : section === 'chat' ? 'services'
    : section === 'analytics' ? 'business' : section === 'earnings' ? 'home' : section || 'home';

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        {!api.isLive && <div className="demo-banner">{L.t('demoBanner')}</div>}
        <main className={showNav ? 'with-nav' : ''}>{screen}</main>
        {showNav && (
          <nav className="tabbar" aria-label="Main">
            {tabs.map(([k, icon, label]) => (
              <a key={k} href={`#/${k}`} className={active === k ? 'on' : ''} aria-current={active === k ? 'page' : undefined}>
                <span className="ti"><Icon name={icon} size={20} /></span><span>{L.t(label)}</span>
              </a>
            ))}
          </nav>
        )}
        <Toast msg={toast} />
      </div>
    </AppCtx.Provider>
  );
}
