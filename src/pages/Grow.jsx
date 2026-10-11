// Growth pages: Analytics (charts + smart tips), Ideas tab, Services.
import React, { useEffect, useState } from 'react';
import { useApp, Button, Field, Header, Spinner, ErrorBox, useLoad, Sheet, Icon, money, num, date, pname, planState, weekdayName } from '../core.jsx';
import { SERVICES, COST_CATEGORIES } from '../lib/i18n.js';
import { computeStats, inPeriod, expensesIn, profitSeries, bestSellers, getAdvice } from '../lib/advisor.js';
import * as api from '../lib/api.js';

// Turns a tip { key, vars } into text in the current language.
export function tipText(tip, t, lang) {
  const v = {};
  Object.entries(tip.vars || {}).forEach(([k, val]) => {
    if (k === 'product') v[k] = pname(val, lang) || '—';
    else if (k === 'day') v[k] = weekdayName(val, lang);
    else v[k] = typeof val === 'number' ? num(val, lang) : val;
  });
  return t(tip.key, v);
}

const PERIODS = ['week', 'month', 'all'];

// ---------- Analytics ----------
export function Analytics({ data, reload, notify }) {
  const { t, lang, profile } = useApp();
  const [period, setPeriod] = useState('month');
  const [tips, setTips] = useState(null);
  const products = useLoad(() => api.listProducts(), []);
  const plan = planState(profile, data.orders);
  const orders = inPeriod(data.orders, period);
  const expenses = data.expenses || [];
  const periodExpenses = expensesIn(expenses, period);
  const s = computeStats(orders, periodExpenses);
  const series = profitSeries(data.orders, period, expenses);
  const [editCost, setEditCost] = useState(null);
  const best = bestSellers(orders, 5);
  useEffect(() => {
    getAdvice({ orders: data.orders, plan, products: products.data || [], expenses }).then(setTips).catch(() => setTips([]));
  }, [data.orders, data.expenses, products.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusRows = [
    ['delivered', s.delivered], ['onTheWay', s.onTheWay], ['pending', s.pending], ['returned', s.returned], ['cancelled', s.cancelled],
  ];
  const statusTotal = statusRows.reduce((a, [, n]) => a + n, 0);
  return (
    <div className="screen">
      <Header title={t('analytics')} />
      <div className="seg" role="group">
        {PERIODS.map((p) => <button type="button" key={p} aria-pressed={period === p} onClick={() => setPeriod(p)}>{t(`period_${p}`)}</button>)}
      </div>

      <div className="ink-card">
        <span className="eyebrow">{t('netProfit')}</span>
        <b className="big">{money(s.net, lang)}</b>
        <small>{t('revenue')} {money(s.revenue, lang)} · {t('costs')} {money(s.costs + s.other, lang)}</small>
      </div>

      <div className="stats two">
        <div className="stat"><span>{t('revenue')}</span><b>{money(s.revenue, lang)}</b></div>
        <div className="stat"><span>{t('productCost')}</span><b>{money(s.costs, lang)}</b></div>
        <button type="button" className="stat" onClick={() => setEditCost({})}><span>{t('otherCosts')}</span><b>{money(s.other, lang)}</b><span className="note">+ {t('addCost')}</span></button>
        <div className="stat"><span>{t('unitsSold')}</span><b>{num(s.units, lang)}</b></div>
        <div className="stat"><span>{t('returnRate')}</span><b>{num(Math.round(s.returnRate * 100), lang)}{lang === 'ar' ? '٪' : '%'}</b></div>
        <div className="stat"><span>{t('ordersCount')}</span><b>{num(s.orders, lang)}</b></div>
      </div>

      <div className="card">
        <div className="row-between"><h3>{t('netProfit')}</h3><span className="muted small">{t(`period_${period}`)}</span></div>
        <BarChart series={series} lang={lang} />
      </div>

      <div className="card">
        <h3>{t('revenueVsCost')}</h3>
        <CompareBars rows={[[t('revenue'), s.revenue], [t('productCost'), s.costs, true], [t('otherCosts'), s.other, true], [t('netProfit'), s.net]]} lang={lang} />
      </div>

      <div className="card">
        <div className="row-between"><h3>{t('costsTitle')}</h3><Button small onClick={() => setEditCost({})}>+ {t('addCost')}</Button></div>
        <p className="muted small">{t('costsHint')}</p>
        {periodExpenses.length === 0 ? <p className="small">{t('noCosts')}</p> : (
          <div className="list">
            {periodExpenses.map((x) => (
              <button type="button" key={x.id} className="order-row" onClick={() => (x.created_by_admin ? null : setEditCost(x))} disabled={x.created_by_admin} style={x.created_by_admin ? { cursor: 'default' } : undefined}>
                <div className="or-main"><b>{t(`cat_${x.category}`)}</b><span className="muted small">{date(x.spent_on, lang)}{x.note ? ` · ${x.note}` : ''}{x.created_by_admin ? ` · ${t('addedByForsa')}` : ''}</span></div>
                <b className="small">−{money(x.amount, lang)}</b>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3>{t('bestSellers')}</h3>
        {best.length === 0 ? <p className="muted small">{t('noDataYet')}</p> : (
          <div className="stack">
            {best.map((b) => (
              <div key={b.product_id} className="hbar">
                <b>{pname(b.product, lang)}</b><span className="muted small">{t('units', { n: num(b.units, lang) })}</span>
                <div className="track"><i style={{ width: `${(b.units / best[0].units) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3>{t('orderStatus')}</h3>
        <div className="ring">
          <Ring value={s.returnRate} label={t('returnRate')} lang={lang} />
          <div className="stack" style={{ flex: 1, gap: 6 }}>
            {statusRows.map(([k, n]) => (
              <div key={k} className="row-between small">
                <span className="muted">{k === 'onTheWay' ? t('pendingEarn') : t(`status_${k}`)}</span>
                <b>{num(n, lang)}{statusTotal ? <span className="muted"> · {num(Math.round((n / statusTotal) * 100), lang)}{lang === 'ar' ? '٪' : '%'}</span> : null}</b>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="section-head"><h2>{t('smartTips')}</h2></div>
      <p className="muted small">{t('tipsNote')}</p>
      {!tips ? <Spinner /> : (
        <div className="tips">
          {tips.map((tip) => <div key={tip.key} className="tipcard"><Icon name="bulb" /><p>{tipText(tip, t, lang)}</p></div>)}
        </div>
      )}
      <p className="muted small">{t('analyticsNote')}</p>
      <CostSheet cost={editCost} onClose={() => setEditCost(null)} onDone={(msg) => { setEditCost(null); notify(t(msg)); reload(); }} />
    </div>
  );
}

// Add / edit / delete one of the seller's own costs.
function CostSheet({ cost, onClose, onDone }) {
  const { t } = useApp();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => {
    if (cost) setF({ id: cost.id, amount: cost.amount ?? '', category: cost.category || 'ads', spent_on: cost.spent_on || today, note: cost.note || '' });
    setErr(''); setConfirmDel(false);
  }, [cost]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cost || !f) return null;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(ev) {
    ev.preventDefault();
    const amount = Number(String(f.amount).replace(/[^\d.]/g, ''));
    if (!(amount > 0)) { setErr(t('invalidAmount')); return; }
    setBusy(true); setErr('');
    try { await api.saveExpense({ ...f, amount, spent_on: f.spent_on > today ? today : f.spent_on }); onDone('costSaved'); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api.deleteExpense(f.id); onDone('costDeleted'); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={f.id ? t('editCost') : t('addCost')}>
      <form onSubmit={save} noValidate className="stack">
        <Field id="cs-a" label={t('amount')} error={err}><input id="cs-a" inputMode="numeric" dir="ltr" value={f.amount} onChange={set('amount')} /></Field>
        <Field id="cs-c" label={t('category')}>
          <select id="cs-c" value={f.category} onChange={set('category')}>{COST_CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat_${c}`)}</option>)}</select>
        </Field>
        <Field id="cs-d" label={t('costDate')}><input id="cs-d" type="date" max={today} value={f.spent_on} onChange={set('spent_on')} /></Field>
        <Field id="cs-n" label={t('costNote')}><input id="cs-n" maxLength={200} value={f.note} onChange={set('note')} /></Field>
        <button type="submit" className="btn btn-primary block" disabled={busy}>{busy ? t('loading') : t('save')}</button>
      </form>
      {f.id && (confirmDel ? (
        <div className="card warn stack"><p>{t('confirmDeleteCost')}</p><div className="row"><Button variant="danger" small onClick={remove} disabled={busy}>{t('deleteCost')}</Button><Button variant="ghost" small onClick={() => setConfirmDel(false)}>{t('keep')}</Button></div></div>
      ) : <Button block variant="ghost" onClick={() => setConfirmDel(true)}>{t('deleteCost')}</Button>)}
    </Sheet>
  );
}

function BarChart({ series, lang }) {
  const W = 320; const H = 150; const pad = 18;
  const max = Math.max(1, ...series.map((x) => x.value));
  const bw = (W - 8) / series.length;
  const label = (x) => (x.unit === 'month'
    ? x.date.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { month: 'short' })
    : x.date.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' }));
  const marks = [0, Math.floor((series.length - 1) / 2), series.length - 1];
  const total = series.reduce((a, x) => a + x.value, 0);
  return (
    <div dir="ltr">
      <svg className="chart" viewBox={`0 0 ${W} ${H + pad}`} role="img" aria-label={`Total ${total}`}>
        <line x1="0" x2={W} y1={H} y2={H} stroke="var(--line)" />
        <text x="0" y="10">{money(max, lang)}</text>
        <line x1="0" x2={W} y1="16" y2="16" stroke="var(--line)" strokeDasharray="3 4" />
        {series.map((x, i) => {
          const h = x.value > 0 ? Math.max(3, (x.value / max) * (H - 22)) : 2;
          return <rect key={i} x={4 + i * bw + bw * 0.15} y={H - h} width={bw * 0.7} height={h} rx={Math.min(3, bw * 0.2)} fill={x.value > 0 ? 'var(--ink)' : x.value < 0 ? 'var(--bad)' : 'var(--line)'} />;
        })}
        {marks.map((i) => <text key={i} x={4 + i * bw + bw / 2} y={H + 14} textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}>{label(series[i])}</text>)}
      </svg>
    </div>
  );
}

function CompareBars({ rows, lang }) {
  const max = Math.max(1, ...rows.map(([, v]) => Math.abs(v)));
  return (
    <div className="stack">
      {rows.map(([name, v, light]) => (
        <div key={name} className="hbar">
          <span className="small">{name}</span><b className="small">{money(v, lang)}</b>
          <div className="track"><i style={{ width: `${(Math.max(0, v) / max) * 100}%`, background: light ? 'var(--line-2)' : undefined }} /></div>
        </div>
      ))}
    </div>
  );
}

function Ring({ value, label, lang }) {
  const r = 30; const c = 2 * Math.PI * r;
  const pct = Math.round(value * 100);
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" role="img" aria-label={`${label} ${pct}%`}>
      <circle cx="42" cy="42" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="9" />
      <circle cx="42" cy="42" r={r} fill="none" stroke="var(--ink)" strokeWidth="9" strokeDasharray={`${c * value} ${c}`} transform="rotate(-90 42 42)" strokeLinecap={value > 0 ? 'round' : 'butt'} />
      <text x="42" y="46" textAnchor="middle" fontSize="15" fontWeight="800" fill="var(--text)">{num(pct, lang)}{lang === 'ar' ? '٪' : '%'}</text>
    </svg>
  );
}

// ---------- Ideas tab ----------
export function Ideas({ notify }) {
  const { t, lang } = useApp();
  const { loading, data, error, reload } = useLoad(() => api.myIdeas(), []);
  const empty = { title: '', problem: '', customer: '', revenue_model: '', sector: '', stage: 'idea', needs: '', funding_needed: '' };
  const [f, setF] = useState(empty);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(ev) {
    ev.preventDefault();
    const e = {};
    ['title', 'problem', 'customer', 'sector'].forEach((k) => { if (!f[k].trim()) e[k] = t('required'); });
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try { await api.submitIdea({ ...f, funding_needed: Number(String(f.funding_needed).replace(/[^\d]/g, '')) || 0 }); setF(empty); notify(t('ideaSent')); reload(); }
    catch (err) { notify(err.message); }
    finally { setBusy(false); }
  }
  const guide = [1, 2, 3, 4, 5];
  return (
    <div className="screen">
      <Header title={t('ideas')} />
      <h1 className="page-title">{t('idea')}</h1>
      <p className="lead">{t('ideaLead')}</p>
      <div className="section-head"><h2>{t('ideaGuide')}</h2></div>
      <ol className="guide">
        {guide.map((i) => <li key={i}><span className="n">{num(i, lang)}</span><div><b>{t(`ig${i}t`)}</b><p>{t(`ig${i}d`)}</p></div></li>)}
      </ol>
      <form onSubmit={submit} noValidate className="card stack">
        <Field id="id-title" label={t('ideaTitle')} error={errors.title}><input id="id-title" value={f.title} onChange={set('title')} /></Field>
        <Field id="id-problem" label={t('ideaProblem')} error={errors.problem}><textarea id="id-problem" rows="3" value={f.problem} onChange={set('problem')} /></Field>
        <Field id="id-customer" label={t('ideaCustomer')} error={errors.customer}><input id="id-customer" value={f.customer} onChange={set('customer')} /></Field>
        <Field id="id-money" label={t('ideaMoney')}><input id="id-money" value={f.revenue_model} onChange={set('revenue_model')} /></Field>
        <Field id="id-sector" label={t('sector')} error={errors.sector}><input id="id-sector" value={f.sector} onChange={set('sector')} /></Field>
        <Field id="id-stage" label={t('stage')}>
          <select id="id-stage" value={f.stage} onChange={set('stage')}>
            {['idea', 'prototype', 'selling'].map((s) => <option key={s} value={s}>{t(`stage_${s}`)}</option>)}
          </select>
        </Field>
        <Field id="id-needs" label={t('ideaNeeds')}><textarea id="id-needs" rows="2" value={f.needs} onChange={set('needs')} /></Field>
        <Field id="id-fund" label={t('funding')}><input id="id-fund" inputMode="numeric" value={f.funding_needed} onChange={set('funding_needed')} dir="ltr" /></Field>
        <button type="submit" className="btn btn-primary block" disabled={busy}>{busy ? t('loading') : t('submitIdea')}</button>
      </form>
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : (data || []).length > 0 && (
        <>
          <div className="section-head"><h2>{t('myIdeas')}</h2></div>
          <div className="list">
            {data.map((i) => (
              <div key={i.id} className="order-row static">
                <Icon name="bulb" />
                <div className="or-main"><b>{i.title}</b><span className="muted small">{date(i.created_at, lang)}</span></div>
                <span className={`pill pill-${i.status === 'matched' ? 'delivered' : i.status === 'declined' ? 'cancelled' : 'pending'}`}>{t(`idea_${i.status}`)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Services ----------
const SVC_ICON = { marketing_agency: 'target', media_buying: 'megaphone' };
const BUDGETS = ['low', 'mid', 'high', 'unsure'];

export function Services({ notify }) {
  const { t, lang } = useApp();
  const { loading, data, error, reload } = useLoad(() => api.myRequests(), []);
  const [open, setOpen] = useState(null);
  return (
    <div className="screen">
      <Header title="" />
      <h1 className="page-title">{t('services')}</h1>
      <p className="lead">{t('servicesLead')}</p>
      {SERVICES.map((k) => (
        <div key={k} className="card svc">
          <div className="svc-head">
            <span className="svc-icon"><Icon name={SVC_ICON[k] || 'sparkle'} /></span>
            <div><h3>{t(`svc_${k}`)}</h3><p className="muted small">{t(`svc_${k}_d`)}</p></div>
          </div>
          <Button block onClick={() => setOpen(k)}>{t('request')}</Button>
        </div>
      ))}
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : (data || []).length > 0 && (
        <>
          <div className="section-head"><h2>{t('myRequests')}</h2></div>
          <div className="list">
            {data.map((r) => (
              <div key={r.id} className="order-row static">
                <Icon name={SVC_ICON[r.service] || 'sparkle'} />
                <div className="or-main"><b>{t(`svc_${r.service}`)}</b><span className="muted small">{date(r.created_at, lang)}</span></div>
                <span className={`pill pill-${r.status === 'done' ? 'delivered' : r.status === 'contacted' ? 'confirmed' : 'pending'}`}>{t(`req_${r.status}`)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <RequestSheet service={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); notify(t('requestSent')); reload(); }} />
    </div>
  );
}

function RequestSheet({ service, onClose, onDone }) {
  const { t } = useApp();
  const [details, setDetails] = useState('');
  const [budget, setBudget] = useState('unsure');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDetails(''); setBudget('unsure'); setErr(''); }, [service]);
  if (!service) return null;
  async function submit(ev) {
    ev.preventDefault();
    if (!details.trim()) { setErr(t('required')); return; }
    setBusy(true); setErr('');
    try { await api.submitRequest({ service, details: details.trim().slice(0, 2000), budget }); onDone(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={t('requestService', { s: t(`svc_${service}`) })}>
      <form onSubmit={submit} noValidate className="stack">
        <Field id="rq-d" label={t('whatNeed')} error={err} hint={t('whatNeedHint')}><textarea id="rq-d" rows="4" value={details} onChange={(e) => setDetails(e.target.value)} /></Field>
        <Field id="rq-b" label={t('budget')}>
          <select id="rq-b" value={budget} onChange={(e) => setBudget(e.target.value)}>{BUDGETS.map((b) => <option key={b} value={b}>{t(`budget_${b}`)}</option>)}</select>
        </Field>
        <button type="submit" className="btn btn-primary block" disabled={busy}>{busy ? t('loading') : t('request')}</button>
      </form>
    </Sheet>
  );
}

