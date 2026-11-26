// AI media buyer (pilot): Services → "Make my ad with AI".
// #/ads (my ad plans) · #/ads/new (step-by-step questions) · #/ads/<id> (the plan: strategy, 3 ads, approve).
// The AI only writes the plan; the seller approves. Auto-publishing to Facebook/Instagram comes with the Meta connection.
import React, { useMemo, useState } from 'react';
import { useApp, go, Header, Button, Field, Spinner, ErrorBox, Icon, money, num, date, pname, imgSrc, latinDigits, useLoad } from '../core.jsx';
import { GOVERNORATES } from '../lib/i18n.js';
import { AD_AGES, AD_DAILY, AD_DAYS, AD_MIN_DAILY, AD_TONES, adMath } from '../lib/ads.js';
import * as api from '../lib/api.js';

const STATUS_PILL = { draft: 'pill-pending', approved: 'pill-delivered', running: 'pill-confirmed', done: 'pill-delivered', stopped: 'pill-cancelled' };
const errText = (t, e) => (e?.code === 'limit' ? t('adLimit') : e?.code === 'ai_unavailable' ? t('adUnavailable')
  : e?.code === 'price_below_min' || e?.message === 'price_below_min' ? t('adPriceLow') : e?.message || t('adUnavailable'));

export function AdsPage({ sub, data, notify }) {
  if (sub === 'new') return <AdWizard data={data} notify={notify} />;
  if (sub) return <AdPlanView id={sub} data={data} notify={notify} />;
  return <AdsHome data={data} notify={notify} />;
}

function AdsHome({ data, notify }) {
  const { t, lang } = useApp();
  const plans = useLoad(() => api.myAdPlans(), []);
  const quota = useLoad(() => api.adQuota(), []);
  const biz = (id) => (data.businesses || []).find((b) => b.id === id)?.name || '';
  return (
    <div className="screen">
      <Header title="" back="/services" />
      <div className="row-between"><h1 className="page-title">{t('aiAds')}</h1><span className="pill pill-confirmed">{t('pilot')}</span></div>
      <p className="lead">{t('aiAdsLead')}</p>
      <div className="card ai-ads-how stack">
        <ol className="small own-steps"><li>{t('aiAdsStep1')}</li><li>{t('aiAdsStep2')}</li><li>{t('aiAdsStep3')}</li></ol>
        <Button block onClick={() => go('/ads/new')}><Icon name="sparkle" size={18} /> {t('aiAdsNew')}</Button>
        {quota.data != null && quota.data < 9999 && <p className="small muted">{t('adLeftToday', { n: num(quota.data, lang) })}</p>}
      </div>
      {(data.businesses || []).length > 0 && <BrandMemory businesses={data.businesses} notify={notify} />}
      {plans.loading ? <Spinner /> : plans.error ? <ErrorBox error={plans.error} onRetry={plans.reload} /> : (plans.data || []).length > 0 && (
        <>
          <div className="section-head"><h2>{t('myAdPlans')}</h2></div>
          <div className="list">
            {plans.data.map((p) => (
              <button type="button" key={p.id} className="order-row" onClick={() => go(`/ads/${p.id}`)}>
                {p.plan?.image_url ? <img src={imgSrc(p.plan.image_url)} alt="" /> : <Icon name="megaphone" />}
                <span className="or-main"><b>{p.plan?.product_name || t('aiAds')}</b>
                  <span className="small muted">{biz(p.business_id)} · {date(p.created_at, lang)} · {money(p.plan?.budget?.total || 0, lang)}</span></span>
                <span className={`pill ${STATUS_PILL[p.status] || 'pill-pending'}`}>{t(`adSt_${p.status}`)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Brand memory: the seller's own notes for the AI + what the AI remembers from his past plans (per business/brand).
function BrandMemory({ businesses, notify }) {
  const { t, lang } = useApp();
  const [bizId, setBizId] = useState(businesses[0].id);
  const mem = useLoad(() => api.brandMemory(bizId), [bizId]);
  const [notes, setNotes] = useState(null);
  const [busy, setBusy] = useState(false);
  const value = notes ?? mem.data?.notes ?? '';
  async function save() {
    setBusy(true);
    try { await api.saveBrandNotes(bizId, value); notify(t('memorySaved')); setNotes(null); mem.reload(); } catch (e) { notify(e.message); } finally { setBusy(false); }
  }
  const plans = mem.data?.plans || [];
  return (
    <>
      <div className="section-head"><h2>{t('brandMemory')}</h2></div>
      <div className="card stack brand-memory">
        <p className="small muted">{t('brandMemoryLead')}</p>
        {businesses.length > 1 && (
          <div className="chips opt-chips" role="radiogroup" aria-label={t('business')}>
            {businesses.map((b) => <button type="button" key={b.id} role="radio" aria-checked={bizId === b.id} className="chip" onClick={() => { setBizId(b.id); setNotes(null); }}>{b.name}</button>)}
          </div>
        )}
        <Field id="bm-notes" label={t('brandNotes')} hint={t('brandNotesHint')}>
          <textarea id="bm-notes" rows="3" maxLength={600} value={value} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Button small variant="ghost" disabled={busy || notes == null} onClick={save}>{busy ? t('loading') : t('save')}</Button>
        <h3 className="small">{t('aiRemembers')}</h3>
        {mem.loading ? <Spinner /> : plans.length === 0 ? <p className="small muted">{t('aiRemembersNone')}</p> : (
          <ul className="memory-list small">
            {plans.map((p) => {
              const r = p.results || {};
              return (
                <li key={p.id}>
                  <b>{date(p.created_at, lang)} · {p.plan?.product_name}</b> — {p.answers?.strategy?.title || t(`adObj_${p.plan?.objective}`)}{p.answers?.touch ? `, ${t(`tone_${p.answers.touch.tone}`)}` : ''}
                  {(p.change_notes || []).length > 0 && <span className="muted"> · {t('youAsked')}: “{p.change_notes.slice(-2).join('”, “')}”</span>}
                  {p.feedback === 1 && <span> · 👍</span>}{p.feedback === -1 && <span> · 👎{p.feedback_note ? ` “${p.feedback_note}”` : ''}</span>}
                  {r.spend != null && <span> · {t('memResults', { s: money(r.spend, lang), o: num(r.orders || 0, lang) })}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

const STEPS = ['adStepProduct', 'adStepGoal', 'adStepWhere', 'adStepWho', 'adStepOffer', 'adStepBudget', 'adStepStrategy'];

function AdWizard({ data }) {
  const { t, lang } = useApp();
  const businesses = data.businesses || [];
  const prods = useLoad(() => api.listProducts(), []);
  const sites = useLoad(() => api.myWebsites(), []);
  const quota = useLoad(() => api.adQuota(), []);
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ bizId: businesses[0]?.id || '', productId: '', price: '', goal: 'auto', governorates: [], ages: ['18-24', '25-34'], gender: 'all',
    offer: '', notes: '', ad_lang: 'ar', daily: 150, days: 5 });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [opts, setOpts] = useState(null); // the AI's 3 strategies, angles and tone
  const [choice, setChoice] = useState(null); // { strategy index, tone, angles, emojis, price_first }
  const biz = businesses.find((b) => b.id === f.bizId);
  const mine = useMemo(() => (prods.data || []).filter((p) => biz?.product_ids.includes(p.id)), [prods.data, biz]);
  const product = mine.find((p) => p.id === f.productId);
  const hasSite = (sites.data || []).some((w) => w.business_id === f.bizId && w.status === 'approved' && w.published && w.slug);
  const price = Number(f.price) || 0;
  const math = product && price ? adMath(product, price) : null;
  const set = (patch) => { setF((x) => ({ ...x, ...patch })); setErr(''); };
  const toggle = (k, v) => { setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] })); setErr(''); };

  if (businesses.length === 0) {
    return <div className="screen"><Header title={t('aiAds')} back="/ads" /><div className="card empty"><p>{t('needBusinessFirst')}</p><Button onClick={() => go('/business')}>{t('createBusiness')}</Button></div></div>;
  }
  if (prods.loading || sites.loading) return <div className="screen"><Header title={t('aiAds')} back="/ads" /><Spinner /></div>;
  if (busy) {
    return (
      <div className="screen"><Header title={t('aiAds')} />
        <div className="card ai-building stack" role="status" aria-live="polite">
          <Spinner />
          <b>{busy === 'strategies' ? t('adThinking') : t('adBuilding')}</b>
          {busy === 'strategies'
            ? <ul className="small muted own-steps"><li>{t('adBuilding1')}</li><li>{t('adThinking2')}</li><li>{t('adThinking3')}</li></ul>
            : <ul className="small muted own-steps"><li>{t('adBuilding2')}</li><li>{t('adBuilding3')}</li></ul>}
        </div>
      </div>
    );
  }

  function check() {
    if (step === 0) {
      if (!product) return t('adPickProduct');
      if (!price) return t('adPriceNeeded');
      if (price < (Number(product.min_price) || 0)) return t('adPriceLow') + ` (${money(product.min_price, lang)})`;
    }
    if (step === 3 && f.ages.length === 0) return t('adPickAge');
    if (step === 5 && (Number(f.daily) || 0) < AD_MIN_DAILY) return t('adDailyMin', { n: num(AD_MIN_DAILY, lang) });
    if (step === 6 && !choice) return t('adPickStrategy');
    return '';
  }
  const answers = () => ({ price, goal: f.goal, governorates: f.governorates, ages: f.ages, gender: f.gender, offer: f.offer, notes: f.notes, ad_lang: f.ad_lang, daily: Number(f.daily), days: Number(f.days) });
  async function next() {
    const e = check(); if (e) { setErr(e); return; }
    if (step < 5) { setStep(step + 1); window.scrollTo(0, 0); return; }
    if (step === 5) {
      setBusy('strategies');
      try {
        const o = await api.adStrategies({ businessId: f.bizId, productId: f.productId, answers: answers(), lang });
        setOpts(o);
        setChoice({ s: Math.max(0, o.strategies.findIndex((x) => x.recommended)), tone: o.recommended_tone || 'friendly', angles: (o.angles || []).slice(0, 3), emojis: true, price_first: false });
        setStep(6); window.scrollTo(0, 0);
      } catch (er) { setErr(errText(t, er)); } finally { setBusy(''); }
      return;
    }
    setBusy('plan');
    try {
      const st = opts.strategies[choice.s];
      const plan = await api.createAdPlan({ businessId: f.bizId, productId: f.productId, lang, answers: answers(),
        choice: { strategy: { title: st.title, objective: st.objective, summary: st.summary }, touch: { tone: choice.tone, angles: choice.angles, emojis: choice.emojis, price_first: choice.price_first } } });
      go(`/ads/${plan.id}`);
    } catch (er) { setBusy(''); setErr(errText(t, er)); }
  }
  const setC = (patch) => { setChoice((c) => ({ ...c, ...patch })); setErr(''); };
  const toggleAngle = (a) => setChoice((c) => ({ ...c, angles: c.angles.includes(a) ? c.angles.filter((x) => x !== a) : c.angles.length >= 3 ? c.angles : [...c.angles, a] }));
  const chip = (on, label, onClick, key) => <button type="button" key={key || label} role="checkbox" aria-checked={on} className="chip" onClick={onClick}>{label}</button>;
  const radio = (on, label, onClick, key) => <button type="button" key={key || label} role="radio" aria-checked={on} className="chip" onClick={onClick}>{label}</button>;

  return (
    <div className="screen">
      <Header title={t('aiAds')} back={step === 0 ? '/ads' : undefined} />
      <div className="wiz-progress" aria-label={t('adStepOf', { a: num(step + 1, lang), b: num(STEPS.length, lang) })}>
        {STEPS.map((s, i) => <span key={s} className={i <= step ? 'on' : ''} />)}
      </div>
      <p className="small muted">{t('adStepOf', { a: num(step + 1, lang), b: num(STEPS.length, lang) })}</p>
      <h2 className="wiz-title">{t(STEPS[step])}</h2>

      {step === 0 && (
        <div className="stack">
          {businesses.length > 1 && (
            <Field id="ad-biz" label={t('business')}>
              <select id="ad-biz" value={f.bizId} onChange={(e) => set({ bizId: e.target.value, productId: '', price: '' })}>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            </Field>
          )}
          {mine.length === 0 ? <div className="card empty"><p>{t('addProductFirst')}</p><Button onClick={() => go('/products')}>{t('addProducts')}</Button></div> : (
            <div className="list" role="radiogroup" aria-label={t('adStepProduct')}>
              {mine.map((p) => (
                <button type="button" key={p.id} role="radio" aria-checked={f.productId === p.id} className="order-row pick-ad" onClick={() => set({ productId: p.id, price: f.productId === p.id ? f.price : String(p.suggested_price || p.min_price || '') })}>
                  <img src={imgSrc(p.image_url)} alt="" />
                  <span className="or-main"><b>{pname(p, lang)}</b><span className="small muted">{t('minPrice')}: {money(p.min_price, lang)}</span></span>
                  {f.productId === p.id && <Icon name="check" />}
                </button>
              ))}
            </div>
          )}
          {product && (
            <>
              <Field id="ad-price" label={t('adSellPrice')} hint={t('adSellPriceHint')}>
                <input id="ad-price" type="number" inputMode="numeric" min={product.min_price} value={f.price} onChange={(e) => set({ price: latinDigits(e.target.value) })} />
              </Field>
              {math && (
                <div className="ink-card">
                  <span className="eyebrow">{t('adYouGetPiece')}</span>
                  <span className="big">{money(math.profit_per_piece, lang)}</span>
                  <small>{t('adBreakEven', { n: money(math.break_even_cpa, lang) })}</small>
                </div>
              )}
              {math?.weak && <p className="form-error small" role="note">{t('adWeak')}</p>}
            </>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="list" role="radiogroup" aria-label={t('adStepGoal')}>
          {['auto', 'website', 'messages'].map((g) => {
            const off = g === 'website' && !hasSite;
            return (
              <button type="button" key={g} role="radio" aria-checked={f.goal === g} disabled={off} className="card opt-card" onClick={() => set({ goal: g })}>
                <b>{t(`adGoal_${g}`)}{g === 'auto' ? ` · ${t('recommended')}` : ''}</b>
                <span className="small muted">{off ? t('adGoalNoSite') : t(`adGoal_${g}_d`)}</span>
              </button>
            );
          })}
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          <div className="chips">{radio(f.governorates.length === 0, t('allEgypt'), () => set({ governorates: [] }), 'all')}</div>
          <p className="small muted">{t('adWhereHint')}</p>
          <div className="chips wrap opt-chips" role="group" aria-label={t('adStepWhere')}>
            {GOVERNORATES.map(([g, ar]) => chip(f.governorates.includes(g), lang === 'ar' ? ar : g, () => toggle('governorates', g), g))}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="stack">
          <h3 className="small">{t('adAge')}</h3>
          <div className="chips opt-chips" role="group" aria-label={t('adAge')}>{AD_AGES.map((a) => chip(f.ages.includes(a), num(a.split('-')[0], lang) + (a.includes('+') ? '+' : `–${num(a.split('-')[1], lang)}`), () => toggle('ages', a), a))}</div>
          <h3 className="small">{t('adGender')}</h3>
          <div className="chips opt-chips" role="radiogroup" aria-label={t('adGender')}>{['all', 'men', 'women'].map((g) => radio(f.gender === g, t(`adGender_${g}`), () => set({ gender: g }), g))}</div>
        </div>
      )}

      {step === 4 && (
        <div className="stack">
          <Field id="ad-offer" label={t('adOffer')} hint={t('adOfferHint')}><input id="ad-offer" maxLength={200} value={f.offer} onChange={(e) => set({ offer: e.target.value })} /></Field>
          <Field id="ad-notes" label={t('adNotes')} hint={t('adNotesHint')}><textarea id="ad-notes" rows="3" maxLength={300} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
          <h3 className="small">{t('adLang')}</h3>
          <div className="chips opt-chips" role="radiogroup" aria-label={t('adLang')}>{['ar', 'en'].map((l) => radio(f.ad_lang === l, t(`adLang_${l}`), () => set({ ad_lang: l }), l))}</div>
        </div>
      )}

      {step === 5 && (
        <div className="stack">
          <h3 className="small">{t('adDaily')}</h3>
          <div className="chips opt-chips" role="radiogroup" aria-label={t('adDaily')}>{AD_DAILY.map((d) => radio(Number(f.daily) === d, money(d, lang), () => set({ daily: d }), String(d)))}</div>
          <Field id="ad-daily" label={t('adDailyOther')}><input id="ad-daily" type="number" inputMode="numeric" min={AD_MIN_DAILY} value={f.daily} onChange={(e) => set({ daily: latinDigits(e.target.value) })} /></Field>
          <h3 className="small">{t('adDays')}</h3>
          <div className="chips opt-chips" role="radiogroup" aria-label={t('adDays')}>{AD_DAYS.map((d) => radio(Number(f.days) === d, t('nDays', { n: num(d, lang) }), () => set({ days: d }), String(d)))}</div>
          <div className="ink-card">
            <span className="eyebrow">{t('adTotal')}</span>
            <span className="big">{money((Number(f.daily) || 0) * (Number(f.days) || 0), lang)}</span>
            <small>{t('adPaidByYou')}</small>
          </div>
          {quota.data != null && quota.data < 9999 && <p className="small muted">{t('adLeftToday', { n: num(quota.data, lang) })}</p>}
        </div>
      )}

      {step === 6 && opts && choice && (
        <div className="stack">
          {opts.from_history && <div className="card memory-line"><Icon name="bulb" /> <span className="small">{opts.from_history}</span></div>}
          <div className="list" role="radiogroup" aria-label={t('adStepStrategy')}>
            {opts.strategies.map((st, i) => (
              <button type="button" key={i} role="radio" aria-checked={choice.s === i} className="card opt-card strat-card" onClick={() => setC({ s: i })}>
                <span className="row-between"><b>{st.title}</b>{st.recommended && <span className="pill pill-delivered">{t('recommendedForYou')}</span>}</span>
                <span className="small">{st.summary}</span>
                <span className="small muted">{st.why_for_you}</span>
                <span className="small muted">{t('adStrategy')}: {t(`adObj_${st.objective}`)}</span>
              </button>
            ))}
          </div>
          <h3 className="wiz-sub">{t('yourTouch')}</h3>
          <h4 className="small">{t('adTone')}</h4>
          <div className="chips opt-chips" role="radiogroup" aria-label={t('adTone')}>{AD_TONES.map((x) => radio(choice.tone === x, t(`tone_${x}`) + (x === opts.recommended_tone ? ' ★' : ''), () => setC({ tone: x }), x))}</div>
          <h4 className="small">{t('adAngles')}</h4>
          <div className="chips wrap opt-chips" role="group" aria-label={t('adAngles')}>{(opts.angles || []).map((a) => chip(choice.angles.includes(a), a, () => toggleAngle(a), a))}</div>
          <p className="small muted">{t('adAnglesHint')}</p>
          <h4 className="small">{t('adEmojis')}</h4>
          <div className="chips opt-chips" role="radiogroup" aria-label={t('adEmojis')}>{[true, false].map((v) => radio(choice.emojis === v, t(v ? 'yes' : 'no'), () => setC({ emojis: v }), String(v)))}</div>
          <h4 className="small">{t('adPriceFirst')}</h4>
          <div className="chips opt-chips" role="radiogroup" aria-label={t('adPriceFirst')}>{[true, false].map((v) => radio(choice.price_first === v, t(v ? 'yes' : 'no'), () => setC({ price_first: v }), String(v)))}</div>
        </div>
      )}

      {err && <p className="form-error" role="alert">{err}</p>}
      <div className="wiz-nav">
        {step > 0 && <Button variant="ghost" onClick={() => { setStep(step - 1); setErr(''); }}>{t('back')}</Button>}
        <Button onClick={next} disabled={step === 0 && mine.length === 0}>{step === 5 ? <><Icon name="sparkle" size={18} /> {t('adSeeStrategies')}</> : step === STEPS.length - 1 ? <><Icon name="sparkle" size={18} /> {t('adMake')}</> : t('next')}</Button>
      </div>
    </div>
  );
}

function AdPreview({ ad, plan }) {
  const { t } = useApp();
  const [more, setMore] = useState(false);
  const long = ad.primary_text.length > 160;
  return (
    <div className="fb-ad" dir="auto">
      <div className="fb-head"><span className="fb-avatar" aria-hidden="true">{(plan.business_name || 'F').slice(0, 1)}</span>
        <span><b>{plan.business_name}</b><span className="small muted">{t('sponsored')}</span></span></div>
      <p className="fb-text">{long && !more ? `${ad.primary_text.slice(0, 160)}… ` : ad.primary_text}
        {long && <button type="button" className="link-btn" onClick={() => setMore(!more)}>{more ? t('seeLess') : t('seeMore')}</button>}</p>
      {plan.image_url && <img className="fb-img" src={imgSrc(plan.image_url)} alt={plan.product_name} />}
      <div className="fb-foot"><b>{ad.headline}</b><span className="fb-cta">{t(`cta_${ad.cta}`)}</span></div>
    </div>
  );
}

function copy(text, notify, t) {
  try { navigator.clipboard.writeText(text).then(() => notify(t('copied')), () => notify(t('copyFailed'))); } catch { notify(t('copyFailed')); }
}

function AdPlanView({ id, notify }) {
  const { t, lang, profile } = useApp();
  const row = useLoad(() => api.adPlan(id), [id]);
  const [tab, setTab] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [fb, setFb] = useState({ score: null, note: '', sent: false });
  if (row.loading) return <div className="screen"><Header title={t('aiAds')} back="/ads" /><Spinner /></div>;
  if (row.error) return <div className="screen"><Header title={t('aiAds')} back="/ads" /><ErrorBox error={row.error} onRetry={row.reload} /></div>;
  const r = row.data;
  if (!r) return <div className="screen"><Header title={t('aiAds')} back="/ads" /><div className="card empty"><p>{t('notFound')}</p></div></div>;
  const p = r.plan || {}; const m = p.math || {}; const a = p.audience || {}; const ads = p.ads || []; const ad = ads[Math.min(tab, ads.length - 1)];
  const mine = r.owner_id === profile?.id;
  const where = a.all_egypt || !(a.governorates || []).length ? t('allEgypt') : a.governorates.map((g) => (lang === 'ar' ? GOVERNORATES.find(([x]) => x === g)?.[1] || g : g)).join('، ');

  async function revise() {
    if (!note.trim()) { setErr(t('adChangeWhat')); return; }
    setBusy('revise'); setErr('');
    try { await api.reviseAdPlan(r.id, note, lang); setNote(''); setTab(0); notify(t('adUpdated')); row.reload(); } catch (e) { setErr(errText(t, e)); } finally { setBusy(''); }
  }
  async function approve() {
    setBusy('approve'); setErr('');
    try { await api.approveAdPlan(r.id); notify(t('adApproved')); row.reload(); window.scrollTo(0, 0); } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }
  async function sendFeedback(score) {
    const s = score ?? fb.score; if (!s) return;
    try { await api.adFeedback(r.id, s, fb.note); setFb({ ...fb, score: s, sent: true }); notify(t('thanksFeedback')); } catch (e) { notify(e.message); }
  }

  return (
    <div className="screen ad-plan">
      <Header title="" back="/ads" />
      <div className="row-between"><h1 className="page-title">{p.product_name}</h1><span className={`pill ${STATUS_PILL[r.status]}`}>{t(`adSt_${r.status}`)}</span></div>
      <p className="small muted">{p.business_name} · {date(r.created_at, lang)}{r.revisions ? ` · ${t('adRevisions', { n: num(r.revisions, lang) })}` : ''}</p>

      {r.status === 'approved' && mine && <PublishSteps />}

      <div className="ink-card">
        <span className="eyebrow">{t('adYouGetPiece')}</span>
        <span className="big">{money(m.profit_per_piece || 0, lang)}</span>
        <small>{t('adBreakEven', { n: money(m.break_even_cpa || 0, lang) })} · {t('adTarget', { n: money(m.target_cpa || 0, lang) })}</small>
      </div>
      {p.warning && <div className="card warn-card"><Icon name="alert" /> <span>{p.warning}</span></div>}

      {p.from_history && <div className="card memory-line"><Icon name="bulb" /> <span className="small"><b>{t('fromMemory')}:</b> {p.from_history}</span></div>}
      <div className="card stack">
        <h3>{t('adStrategy')}: {p.strategy?.title || t(`adObj_${p.objective}`)}</h3>
        {p.strategy?.title && <p className="small muted">{t(`adObj_${p.objective}`)}</p>}
        <p>{p.why}</p>
        {p.touch && <p className="small">{t('yourTouch')}: {t(`tone_${p.touch.tone}`)}{(p.touch.angles || []).length ? ` · ${p.touch.angles.join('، ')}` : ''} · {p.touch.emojis ? t('withEmojis') : t('noEmojis')}{p.touch.price_first ? ` · ${t('priceFirst')}` : ''}</p>}
        {p.product_insight && <p className="small muted">{p.product_insight}</p>}
        <dl className="kv">
          <dt>{t('adWhere')}</dt><dd>{where}</dd>
          <dt>{t('adAge')}</dt><dd>{num(a.age_min || 18, lang)}–{num(a.age_max || 65, lang)}</dd>
          <dt>{t('adGender')}</dt><dd>{t(`adGender_${a.gender || 'all'}`)}</dd>
          {(a.interests || []).length > 0 && <><dt>{t('adInterests')}</dt><dd>{a.interests.join(', ')}</dd></>}
          <dt>{t('adBudget')}</dt><dd>{money(p.budget?.daily || 0, lang)} × {t('nDays', { n: num(p.budget?.days || 0, lang) })} = <b>{money(p.budget?.total || 0, lang)}</b></dd>
          {p.link && <><dt>{t('adLink')}</dt><dd><code className="web-link">{p.link}</code></dd></>}
        </dl>
        {p.budget_advice && <p className="small">{p.budget_advice}</p>}
      </div>

      <div className="section-head"><h2>{t('adYourAds')}</h2></div>
      <div className="chips scroll" role="tablist">
        {ads.map((x, i) => <button type="button" key={i} role="tab" aria-selected={tab === i} aria-pressed={tab === i} className="chip" onClick={() => setTab(i)}>{num(i + 1, lang)}. {x.angle}</button>)}
      </div>
      {ad && <AdPreview ad={ad} plan={p} />}
      {ad && <Button variant="ghost" small onClick={() => copy(`${ad.primary_text}\n\n${ad.headline}`, notify, t)}><Icon name="copy" size={16} /> {t('adCopyText')}</Button>}

      {(p.tips || []).length > 0 && (
        <div className="card stack"><h3>{t('adTips')}</h3><ul className="ticks">{p.tips.map((x, i) => <li key={i}><Icon name="check" size={16} />{x}</li>)}</ul></div>
      )}

      {r.status === 'draft' && mine && (
        <div className="card stack">
          <Field id="ad-change" label={t('adChange')} hint={t('adChangeHint')}><textarea id="ad-change" rows="2" maxLength={300} value={note} onChange={(e) => { setNote(e.target.value); setErr(''); }} /></Field>
          <Button variant="ghost" block disabled={!!busy} onClick={revise}>{busy === 'revise' ? t('adBuilding') : t('adChangeBtn')}</Button>
          {err && <p className="form-error" role="alert">{err}</p>}
          <Button block disabled={!!busy} onClick={approve}>{busy === 'approve' ? t('loading') : t('adApprove')}</Button>
          <p className="small muted">{t('adApproveNote')}</p>
        </div>
      )}

      {mine && (
        <div className="card stack ad-feedback">
          <h3>{t('adHelpful')}</h3>
          {fb.sent || r.feedback ? <p className="small">{t('thanksFeedback')}</p> : (
            <>
              <div className="chips">
                <button type="button" className="chip" aria-pressed={fb.score === 1} onClick={() => setFb({ ...fb, score: 1 })}>👍 {t('yes')}</button>
                <button type="button" className="chip" aria-pressed={fb.score === -1} onClick={() => setFb({ ...fb, score: -1 })}>👎 {t('no')}</button>
              </div>
              {fb.score && <>
                <Field id="ad-fb" label={t('adFeedbackNote')}><textarea id="ad-fb" rows="2" maxLength={500} value={fb.note} onChange={(e) => setFb({ ...fb, note: e.target.value })} /></Field>
                <Button small onClick={() => sendFeedback()}>{t('send')}</Button>
              </>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// After approval Forsa publishes the ad for the seller. One-tap Facebook connection + automatic publishing come with
// Forsa's Meta app (pilot step 2); until then the approved plan waits here, ready.
function PublishSteps() {
  const { t } = useApp();
  return (
    <div className="card stack publish-card">
      <h3><Icon name="check" /> {t('adApprovedTitle')}</h3>
      <p className="small">{t('adAutoSoon')}</p>
      <ol className="small own-steps"><li>{t('adNext1')}</li><li>{t('adNext2')}</li><li>{t('adNext3')}</li></ol>
    </div>
  );
}
