// Forsa AI advisor: a box inside each business (under Order status, before Smart tips)
// and a conversation in Messages. 5 answers a day per seller; friendly message when the AI service is down.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp, Header, Icon, Spinner, go, num } from '../core.jsx';
import * as api from '../lib/api.js';

const LIMIT = api.AI_DAILY_LIMIT;

// Shows the AI's answer: "- " / "* " / "1. " lines become a list, **bold** stays bold. No HTML is injected.
export function AiText({ text }) {
  const blocks = [];
  let list = null;
  String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).forEach((line) => {
    const m = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) { if (!list) { list = []; blocks.push({ list }); } list.push(m[1]); }
    else { list = null; blocks.push({ p: line }); }
  });
  const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (/^\*\*[^*]+\*\*$/.test(part) ? <b key={i}>{part.slice(2, -2)}</b> : part.replace(/\*/g, '')));
  return (
    <div className="ai-text" dir="auto">
      {blocks.map((b, i) => (b.list ? <ul key={i}>{b.list.map((x, j) => <li key={j}>{inline(x)}</li>)}</ul> : <p key={i}>{inline(b.p)}</p>))}
    </div>
  );
}

// Shared state: messages for one business (or general), today's quota, asking, errors.
function useAdvisor(businessId) {
  const { lang } = useApp();
  const [msgs, setMsgs] = useState(null);
  const [left, setLeft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api.advisorMessages(businessId).then(setMsgs).catch(() => setMsgs([]));
    api.advisorQuota().then(setLeft).catch(() => setLeft(null));
  }, [businessId]);
  useEffect(() => { setMsgs(null); setError(''); load(); }, [load]);
  const ask = async (question = '') => {
    if (busy) return false;
    if (left === 0) { setError('limit'); return false; }
    setBusy(true); setError('');
    try {
      const r = await api.askAdvisor({ businessId, question, lang });
      setMsgs((m) => [...(m || []), ...(r.messages || [])]);
      setLeft(typeof r.remaining === 'number' && !Number.isNaN(r.remaining) ? r.remaining : null);
      return true;
    } catch (e) {
      if (e.code === 'limit') { setLeft(0); setError('limit'); } else setError('down');
      return false;
    } finally { setBusy(false); }
  };
  return { msgs, left, busy, error, ask };
}

function AiNotice({ error }) {
  const { t, lang } = useApp();
  if (!error) return null;
  return <p className={`ai-notice${error === 'down' ? ' down' : ''}`} role="alert">{error === 'limit' ? t('aiLimit', { m: num(LIMIT, lang) }) : t('aiDown')}</p>;
}

function Quota({ left }) {
  const { t, lang } = useApp();
  if (left == null) return null;
  return <span className="ai-quota">{t('aiLeft', { n: num(left, lang), m: num(LIMIT, lang) })}</span>;
}

// ---------- Box inside a business (Analytics) ----------
export function AdvisorBox({ businessId }) {
  const { t } = useApp();
  const { msgs, left, busy, error, ask } = useAdvisor(businessId || null);
  const [q, setQ] = useState('');
  const lastAnswer = (msgs || []).filter((m) => m.role === 'assistant').slice(-1)[0];
  const lastQuestion = lastAnswer ? (msgs || []).filter((m) => m.role === 'user' && m.created_at <= lastAnswer.created_at).slice(-1)[0] : null;
  async function submit(ev) {
    ev.preventDefault();
    if (!q.trim()) return;
    if (await ask(q)) setQ('');
  }
  return (
    <section className="card ai-box" aria-labelledby="ai-box-title">
      <div className="ai-head">
        <span className="ai-badge"><Icon name="sparkle" size={18} /></span>
        <div className="or-main"><b id="ai-box-title">{t('aiTitle')}</b><span className="muted small">{t('aiIntro')}</span></div>
      </div>
      <Quota left={left} />
      {msgs === null ? <Spinner /> : busy ? <p className="ai-thinking" role="status"><span className="ai-dots" aria-hidden="true"><i /><i /><i /></span>{t('aiThinking')}</p> : lastAnswer ? (
        <div className="ai-answer">
          {lastQuestion && <p className="ai-q">{lastQuestion.body}</p>}
          <AiText text={lastAnswer.body} />
        </div>
      ) : null}
      <AiNotice error={error} />
      <button type="button" className="btn btn-primary block" onClick={() => ask('')} disabled={busy || left === 0}><Icon name="sparkle" size={18} /> {businessId ? t('aiGetAdvice') : t('aiGetAdviceAll')}</button>
      <form className="ai-ask" onSubmit={submit}>
        <input aria-label={t('aiAsk')} placeholder={t('aiAsk')} value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} disabled={busy || left === 0} />
        <button type="submit" className="btn btn-ghost" disabled={busy || left === 0 || !q.trim()}>{t('aiAskBtn')}</button>
      </form>
      <div className="row-between">
        <span className="muted small">{t('aiPrivacy')}</span>
        <button type="button" className="ink-link dark" onClick={() => go(businessId ? `/advisor/${businessId}` : '/advisor')}>{t('aiOpenChat')}</button>
      </div>
    </section>
  );
}

// ---------- Conversation (Messages → Forsa AI advisor) ----------
export function AdvisorChat({ bizId, data }) {
  const { t, lang } = useApp();
  const businesses = data.businesses || [];
  const businessId = businesses.some((b) => b.id === bizId) ? bizId : null;
  const { msgs, left, busy, error, ask } = useAdvisor(businessId);
  const [q, setQ] = useState('');
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs?.length, busy]);
  async function send(text) {
    const v = (text ?? q).trim();
    if (!v) return;
    if (await ask(v)) setQ('');
  }
  return (
    <div className="screen chat-screen">
      <Header title={t('aiTitle')} back="/inbox" />
      {businesses.length > 0 && (
        <div className="chips scroll" role="group">
          <button type="button" className="chip" aria-pressed={!businessId} onClick={() => go('/advisor')}>{t('all2')}</button>
          {businesses.map((b) => <button type="button" key={b.id} className="chip" aria-pressed={businessId === b.id} onClick={() => go(`/advisor/${b.id}`)}>{b.name}</button>)}
        </div>
      )}
      <div className="row-between"><span className="muted small">{t('aiPrivacy')}</span><Quota left={left} /></div>
      <div className="msgs" aria-live="polite">
        {msgs === null ? <Spinner /> : msgs.length === 0 && !busy ? (
          <div className="ai-empty">
            <span className="ai-badge big"><Icon name="sparkle" size={26} /></span>
            <p>{t('aiEmpty')}</p>
            <div className="ai-quick">
              <button type="button" className="chip" onClick={() => ask('')} disabled={busy || left === 0}>{t('aiGetAdviceAll')}</button>
              {['aiQ1', 'aiQ2', 'aiQ3'].map((k) => <button type="button" key={k} className="chip" onClick={() => send(t(k))} disabled={busy || left === 0}>{t(k)}</button>)}
            </div>
          </div>
        ) : msgs.map((m) => (
          <div key={m.id} className={`msg${m.role === 'user' ? ' mine' : ' ai'}`}>
            {m.role !== 'user' && <span className="msg-who">{t('aiTitle')}</span>}
            {m.role === 'user' ? <p dir="auto">{m.body}</p> : <AiText text={m.body} />}
            <span className="msg-time">{new Date(m.created_at).toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        ))}
        {busy && <div className="msg ai"><p className="ai-thinking" role="status"><span className="ai-dots" aria-hidden="true"><i /><i /><i /></span>{t('aiThinking')}</p></div>}
        <div ref={endRef} />
      </div>
      <AiNotice error={error} />
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea rows="1" dir="auto" aria-label={t('aiAsk')} placeholder={t('aiAsk')} value={q} maxLength={500} disabled={busy || left === 0}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button type="submit" className="btn" aria-label={t('send')} disabled={busy || left === 0 || !q.trim()}><Icon name="send" size={18} /></button>
      </form>
    </div>
  );
}

// ---------- Pinned row at the top of Messages ----------
export function AdvisorThreadRow({ bizId }) {
  const { t, lang } = useApp();
  const [left, setLeft] = useState(null);
  useEffect(() => { api.advisorQuota().then(setLeft).catch(() => setLeft(null)); }, []);
  return (
    <button type="button" className="order-row ai-row" onClick={() => go(bizId ? `/advisor/${bizId}` : '/advisor')}>
      <span className="svc-icon small ai-badge"><Icon name="sparkle" size={18} /></span>
      <div className="or-main"><b>{t('aiTitle')}</b><span className="muted small">{left == null ? t('aiIntro') : t('aiConvSub', { n: num(left, lang) })}</span></div>
      <Icon name="chevron" size={16} />
    </button>
  );
}
