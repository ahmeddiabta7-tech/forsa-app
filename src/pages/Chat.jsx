// Chat on a service request (seller ↔ agency ↔ Forsa team) and the agency dashboard.
import React, { useEffect, useRef, useState } from 'react';
import { useApp, Header, Spinner, ErrorBox, useLoad, Icon, go, num, date } from '../core.jsx';
import { BizLogo } from './Business.jsx';
import * as api from '../lib/api.js';

const POLL_MS = 5000;

const safeUrl = (u) => {
  const v = (u || '').trim(); if (!v) return '';
  try { const x = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`); return ['http:', 'https:'].includes(x.protocol) ? x.href : ''; } catch { return ''; }
};

export function ChatPage({ id, onRead }) {
  const { t, lang, profile } = useApp();
  const req = useLoad(() => api.getRequest(id), [id]);
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const endRef = useRef(null);
  const lastCount = useRef(0);

  useEffect(() => {
    let alive = true;
    const load = () => api.listMessages(id).then((m) => {
      if (!alive) return;
      setMsgs(m);
      if (m.length !== lastCount.current) { lastCount.current = m.length; api.markRead(id).then(() => onRead?.()).catch(() => {}); }
    }).catch((e) => alive && setErr(e.message));
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs?.length]);

  async function send(ev) {
    ev.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true); setErr('');
    try { const m = await api.sendMessage(id, text); setText(''); setMsgs((x) => [...(x || []), m]); lastCount.current += 1; }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (req.loading) return <div className="screen"><Header title={t('chat')} back /><Spinner /></div>;
  if (req.error || !req.data) return <div className="screen"><Header title={t('chat')} back /><ErrorBox error={req.error} onRetry={req.reload} /></div>;
  const r = req.data;
  const biz = r.businesses;
  const isAgency = profile.role === 'agency';
  const who = (m) => (m.sender_id === profile.id ? t('you') : m.sender_id === r.user_id ? (biz?.name || t('sellerLabel')) : m.sender_id === r.agency_id ? t('agencyLabel') : t('forsaTeam'));
  const back = profile.role === 'admin' ? '/admin' : isAgency ? '/' : '/services';
  const page = safeUrl(biz?.page_url);
  return (
    <div className="screen chat-screen">
      <Header title={t(`svc_${r.service}`)} back={back} />
      <div className="card chat-info">
        {biz && (
          <div className="biz-head">
            <BizLogo b={biz} size={40} />
            <div className="or-main"><b>{biz.name}</b><span className="muted small">{[biz.category, biz.city].filter(Boolean).join(' · ')}</span></div>
            {page && <a className="biz-link" href={page} target="_blank" rel="noopener noreferrer"><Icon name="globe" size={16} />{t('visitPage')}</a>}
          </div>
        )}
        <p className="small">{r.details}</p>
        <p className="muted small">{date(r.created_at, lang)} · {t(`budget_${r.budget}`) !== `budget_${r.budget}` ? t(`budget_${r.budget}`) : ''} · <span className={`pill pill-${r.status === 'done' ? 'delivered' : r.status === 'contacted' ? 'confirmed' : 'pending'}`}>{t(`req_${r.status}`)}</span></p>
        {!r.agency_id && !isAgency && <p className="muted small">{t('waitingAgency')}</p>}
      </div>
      <p className="chat-safety"><Icon name="shield" size={14} /> {t('chatSafety')}</p>
      <div className="msgs" aria-live="polite">
        {msgs === null ? <Spinner /> : msgs.length === 0 ? <p className="muted small center">{t('noMessages')}</p> : msgs.map((m) => {
          const mine = m.sender_id === profile.id;
          return (
            <div key={m.id} className={`msg${mine ? ' mine' : ''}`}>
              {!mine && <span className="msg-who">{who(m)}</span>}
              <p dir="auto">{m.body}</p>
              <span className="msg-time">{new Date(m.created_at).toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      {err && <p className="form-error" role="alert">{err}</p>}
      <form className="composer" onSubmit={send}>
        <textarea rows="1" dir="auto" maxLength={2000} placeholder={t('typeMessage')} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); } }} aria-label={t('typeMessage')} />
        <button type="submit" className="btn" disabled={busy || !text.trim()} aria-label={t('send')}><Icon name="send" size={18} /></button>
      </form>
    </div>
  );
}

// ---------- Agency (partner) dashboard ----------
export function AgencyHome({ unread = {}, notify }) {
  const { t, lang } = useApp();
  const { loading, data, error, reload } = useLoad(() => api.agencyRequests(), []);
  async function setStatus(r, status) {
    try { await api.setRequestStatus(r.id, status); notify(t('saved')); reload(); } catch (e) { notify(e.message); }
  }
  return (
    <div className="screen">
      <Header title="" />
      <h1 className="page-title">{t('partnerDashboard')}</h1>
      <p className="lead">{t('partnerIntro')}</p>
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : data.length === 0 ? <div className="card empty"><p>{t('noAssigned')}</p></div> : (
        <div className="list">
          {data.map((r) => (
            <div key={r.id} className="card">
              <div className="biz-head">
                <BizLogo b={r.businesses || { name: '?' }} size={40} />
                <div className="or-main"><b>{r.businesses?.name || '—'}</b><span className="muted small">{t(`svc_${r.service}`)} · {date(r.created_at, lang)}</span></div>
                {unread[r.id] ? <span className="unread">{t('unreadN', { n: num(unread[r.id], lang) })}</span> : null}
              </div>
              <p className="small">{r.details}</p>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <select aria-label={t('status')} value={r.status} onChange={(e) => setStatus(r, e.target.value)}>
                  {['new', 'contacted', 'done'].map((s) => <option key={s} value={s}>{t(`req_${s}`)}</option>)}
                </select>
                <button type="button" className="btn small" onClick={() => go(`/chat/${r.id}`)}><Icon name="chat" size={16} /> {t('openChat')}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
