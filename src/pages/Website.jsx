// Seller websites: the card in My Business, the website builder, and the public store page (#/s/<link name>).
import React, { useEffect, useMemo, useState } from 'react';
import { useApp, Button, Field, Header, Spinner, ErrorBox, useLoad, Sheet, Icon, go, LangSwitch, money, num, pname, imgSrc, latinDigits } from '../core.jsx';
import { GOVERNORATES } from '../lib/i18n.js';
import * as api from '../lib/api.js';
import { ConnectBox } from './Connect.jsx';

const COLORS = api.WEBSITE_COLORS;
const delivered = (orders) => (orders || []).filter((o) => o.status === 'delivered' && !o.own_order).length;

// Instagram / TikTok / Facebook: accept a full link or just the page name.
const SOCIAL = { instagram: 'https://instagram.com/', tiktok: 'https://tiktok.com/@', facebook: 'https://facebook.com/' };
export function socialUrl(kind, v) {
  const x = String(v || '').trim();
  if (!x) return '';
  const full = /^https?:\/\//i.test(x) ? x : /\.(com|net)\//i.test(x) ? `https://${x}` : `${SOCIAL[kind]}${x.replace(/^@/, '')}`;
  try { const u = new URL(full); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : ''; } catch { return ''; }
}

function shareText(link, brand, lang) {
  return lang === 'ar' ? `اطلب من ${brand} أونلاين 🛍️ الدفع عند الاستلام في كل مصر: ${link}` : `Shop ${brand} online 🛍️ Cash on delivery all over Egypt: ${link}`;
}

function ShareCard({ slug, brand, notify }) {
  const { t, lang } = useApp();
  const link = api.storeLink(slug);
  async function copy() {
    try { await navigator.clipboard.writeText(link); notify(t('copied')); } catch { window.prompt?.('', link); }
  }
  return (
    <div className="card share-card stack">
      <span className="eyebrow">{t('webLink')}</span>
      <code className="web-link" dir="ltr">{link}</code>
      <div className="row">
        <Button small onClick={copy}><Icon name="copy" size={16} /> {t('copyLink')}</Button>
        <a className="btn btn-ghost small" href={`https://wa.me/?text=${encodeURIComponent(shareText(link, brand, lang))}`} target="_blank" rel="noopener noreferrer">{t('shareWhatsapp')}</a>
        <a className="btn btn-ghost small" href={`#/s/${slug}`} target="_blank" rel="noopener noreferrer">{t('openWebsite')}</a>
      </div>
      <p className="small muted">{t('webShareTip')}</p>
    </div>
  );
}

// ---------- Card inside My Business ----------
export function WebsiteCard({ business, data, notify }) {
  const { t, lang, profile } = useApp();
  const sites = useLoad(() => api.myWebsites(), [business.id]);
  const min = useLoad(() => api.websiteMinOrders(), []);
  const [busy, setBusy] = useState(false);
  if (sites.loading || min.loading) return <div className="card"><Spinner /></div>;
  const w = (sites.data || []).find((x) => x.business_id === business.id);
  const need = min.data ?? 20;
  const have = delivered(data.orders);
  const eligible = have >= need || profile?.role === 'admin'; // Forsa team can test without the condition
  async function request() {
    setBusy(true);
    try { await api.requestWebsite(business.id); notify(t('webRequested')); sites.reload(); } catch (e) { notify(e.message); } finally { setBusy(false); }
  }
  let body;
  if (!w || w.status === 'rejected') {
    body = (
      <>
        {w?.status === 'rejected' && <p className="small web-reason"><b>{t('webRejected')}</b>{w.reason ? ` ${w.reason}` : ''}</p>}
        {eligible ? (
          <>
            <p className="small">{t('webReady')}</p>
            <Button block onClick={request} disabled={busy}>{busy ? t('loading') : w ? t('webRequestAgain') : t('webRequest')}</Button>
          </>
        ) : (
          <>
            <p className="small">{t('webLocked', { n: num(need, lang) })}</p>
            <div className="web-progress" role="progressbar" aria-valuemin={0} aria-valuemax={need} aria-valuenow={Math.min(have, need)} aria-label={t('webProgress')}>
              <span style={{ width: `${need ? Math.min(100, (have / need) * 100) : 100}%` }} />
            </div>
            <span className="small muted">{t('webProgressLine', { h: num(Math.min(have, need), lang), n: num(need, lang) })}</span>
          </>
        )}
      </>
    );
  } else if (w.status === 'requested') {
    body = <p className="small"><Icon name="clock" size={14} /> {t('webPending')}</p>;
  } else if (w.status === 'paused') {
    body = <p className="small web-reason"><b>{t('webPaused')}</b>{w.reason ? ` ${w.reason}` : ''}</p>;
  } else {
    body = (
      <>
        <div className="row-between"><span className={`pill ${w.published ? 'pill-delivered' : 'pill-pending'}`}>{w.published ? t('webLive') : t('webDraft')}</span>{w.slug && <code className="small" dir="ltr">/s/{w.slug}</code>}</div>
        {!w.published && <p className="small muted">{t('webDraftHint')}</p>}
        <Button block onClick={() => go(`/website/${business.id}`)}><Icon name="edit" size={16} /> {t('webEdit')}</Button>
        {w.published && w.slug && <ShareCard slug={w.slug} brand={w.brand_name} notify={notify} />}
      </>
    );
  }
  return (
    <div className="card web-card stack">
      <div className="biz-head">
        <span className="svc-icon"><Icon name="globe" size={20} /></span>
        <div className="or-main"><b>{t('myWebsite')}</b><span className="muted small">{t('webIntro')}</span></div>
      </div>
      {body}
      {business.product_owner && <ConnectBox business={business} notify={notify} />}
    </div>
  );
}

// Seller's own name + photo for a product on his website (his brand look). Orders still use the real product.
function ItemLook({ p, it, onChange, onError }) {
  const { t, lang } = useApp();
  const [open, setOpen] = useState(!!(it.name || it.image_url));
  const [busy, setBusy] = useState(false);
  async function upload(e) {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 3 * 1024 * 1024) { onError(t('max3mb')); return; }
    setBusy(true);
    try { onChange({ image_url: await api.uploadLogo(file) }); } catch (er) { onError(er.message); } finally { setBusy(false); }
  }
  if (!open) return <button type="button" className="link-btn small item-look-open" onClick={() => setOpen(true)}>{t('webItemLook')}</button>;
  return (
    <div className="item-look stack">
      <span className="small muted">{t('webItemLookHint')}</span>
      <Field id={`wb-nm-${p.id}`} label={t('webItemName')}><input id={`wb-nm-${p.id}`} maxLength={80} value={it.name || ''} placeholder={pname(p, lang)} onChange={(e) => onChange({ name: e.target.value })} /></Field>
      <div className="row upload-row">
        <span className="cover-thumb"><img src={imgSrc(it.image_url || p.image_url)} alt="" /></span>
        <Field id={`wb-im-${p.id}`} label={t('webItemPhoto')}><input id={`wb-im-${p.id}`} type="file" accept="image/*" disabled={busy} onChange={upload} /></Field>
      </div>
      {(it.name || it.image_url) && <button type="button" className="link-btn small" onClick={() => onChange({ name: '', image_url: '' })}>{t('webItemReset')}</button>}
    </div>
  );
}

// ---------- Website builder ----------
const blank = (w, business) => ({
  slug: w.slug || '', template: w.template || 'classic', style: api.styleOf(w), brand_name: w.brand_name || business?.name || '', about: w.about || '', color: w.color || 'black',
  logo_url: w.logo_url || '', cover_url: w.cover_url || '', instagram: w.instagram || '', tiktok: w.tiktok || '', facebook: w.facebook || '', items: w.items || [],
});

export function WebsiteBuilder({ bizId, data, notify }) {
  const { t, lang } = useApp();
  const business = (data.businesses || []).find((b) => b.id === bizId);
  const sites = useLoad(() => api.myWebsites(), [bizId]);
  const prods = useLoad(() => api.listProducts(), []);
  const rates = useLoad(() => api.listShippingRates(), []);
  const w = (sites.data || []).find((x) => x.business_id === bizId);
  const [f, setF] = useState(null);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  useEffect(() => { if (w && !f) setF(blank(w, business)); }, [w]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = useMemo(() => (prods.data || []).filter((p) => business?.product_ids.includes(p.id)), [prods.data, business]);

  if (!business) return <div className="screen"><Header title={t('myWebsite')} back="/business" /><div className="card empty"><p>{t('notFound')}</p></div></div>;
  const back = `/business/${bizId}`;
  if (sites.loading || prods.loading) return <div className="screen"><Header title={t('myWebsite')} back={back} /><Spinner /></div>;
  if (sites.error || prods.error) return <div className="screen"><Header title={t('myWebsite')} back={back} /><ErrorBox error={sites.error || prods.error} onRetry={() => { sites.reload(); prods.reload(); }} /></div>;
  if (!w || w.status !== 'approved' || !f) {
    return <div className="screen"><Header title={t('myWebsite')} back={back} /><div className="card empty"><p>{t('webNotApproved')}</p><Button onClick={() => go(back)}>{t('back')}</Button></div></div>;
  }

  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErr({ ...err, [k]: undefined, form: undefined }); };
  const item = (pid) => f.items.find((i) => i.product_id === pid);
  const setItems = (items) => { setF({ ...f, items }); setErr({ ...err, items: undefined, form: undefined }); };
  const toggle = (p) => (item(p.id) ? setItems(f.items.filter((i) => i.product_id !== p.id)) : setItems([...f.items, { product_id: p.id, price: p.suggested_price, featured: false }]));
  const patchItem = (pid, patch) => setItems(f.items.map((i) => (i.product_id === pid ? { ...i, ...patch } : i)));
  const move = (pid, d) => {
    const i = f.items.findIndex((x) => x.product_id === pid); const j = i + d;
    if (j < 0 || j >= f.items.length) return;
    const next = [...f.items]; [next[i], next[j]] = [next[j], next[i]]; setItems(next);
  };
  const featuredCount = f.items.filter((i) => i.featured).length;

  async function upload(kind, e) {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setErr({ ...err, [kind]: t('max3mb') }); return; }
    setBusy(true);
    try { const url = await api.uploadLogo(file); setF((x) => ({ ...x, [kind]: url })); } catch (er) { setErr({ ...err, [kind]: er.message }); } finally { setBusy(false); }
  }
  function check() {
    const e = {};
    if (f.brand_name.trim().length < 2) e.brand_name = t('required');
    const sp = api.slugProblem(f.slug);
    if (sp) e.slug = t(sp === 'reserved' ? 'webSlugReserved' : 'webSlugFormat');
    const low = f.items.map((i) => ({ i, p: mine.find((p) => p.id === i.product_id) })).find(({ i, p }) => p && !(Number(i.price) >= p.min_price));
    if (low) e.items = t('priceTooLowFor', { n: pname(low.p, lang), p: money(low.p.min_price, lang) });
    setErr(e);
    return !Object.keys(e).length;
  }
  async function save(publish) {
    if (!check()) return;
    setBusy(true);
    try {
      const items = f.items.filter((i) => mine.some((p) => p.id === i.product_id));
      await api.saveWebsite(bizId, { ...f, items });
      if (publish !== undefined) await api.publishWebsite(bizId, publish);
      notify(publish === true ? t('webPublished') : publish === false ? t('webUnpublished') : t('saved'));
      sites.reload();
    } catch (er) {
      const m = er.message || '';
      setErr({ form: /taken/i.test(m) ? t('webSlugTaken') : m });
    } finally { setBusy(false); }
  }
  const view = api.storeView({ ...f, slug: api.cleanSlug(f.slug) || 'your-store' }, mine, rates.data || []);

  return (
    <div className="screen web-builder">
      <Header title={t('myWebsite')} back={back} />
      <div className="row-between">
        <span className={`pill ${w.published ? 'pill-delivered' : 'pill-pending'}`}>{w.published ? t('webLive') : t('webDraft')}</span>
        <button type="button" className="btn btn-ghost small" onClick={() => setPreview(true)}><Icon name="eye" size={16} /> {t('webPreview')}</button>
      </div>
      <div className="preview-frame" aria-hidden="true"><div className="preview-inner"><StoreView store={view} preview /></div></div>
      {w.published && w.slug && <ShareCard slug={w.slug} brand={w.brand_name} notify={notify} />}

      <section className="card stack">
        <h3>{t('webTemplate')}</h3>
        <p className="small muted">{t('webTemplateHint')}</p>
        <div className="tpl-pick" role="radiogroup" aria-label={t('webTemplate')}>
          {api.WEBSITE_TEMPLATES.map((k) => {
            const pr = api.TEMPLATE_PRESETS[k];
            return (
              <button type="button" key={k} role="radio" aria-checked={f.template === k} className="tpl-opt" onClick={() => setF({ ...f, template: k, style: { ...f.style, ...pr } })}>
                <span className={`tpl-thumb bg-${pr.bg} hd-${pr.header} lay-${pr.layout}`} style={{ '--brand': api.brandHex(f.color) }}><i /><i /><i /><i /></span><b>{t(`tpl_${k}`)}</b>
              </button>
            );
          })}
        </div>
      </section>

      <section className="card stack">
        <h3>{t('webDesign')}</h3>
        <p className="small muted">{t('webDesignHint')}</p>
        <div>
          <span className="label-like">{t('webColor')}</span>
          <div className="swatches" role="radiogroup" aria-label={t('webColor')}>
            {Object.entries(COLORS).map(([k, hex]) => <button type="button" key={k} role="radio" aria-checked={f.color === k} aria-label={t(`color_${k}`)} className="swatch" style={{ background: hex }} onClick={() => setF({ ...f, color: k })} />)}
            <label className={`swatch swatch-custom${api.isHexColor(f.color) ? ' on' : ''}`} style={api.isHexColor(f.color) ? { background: f.color } : undefined} title={t('webOwnColor')}>
              <span className="sr-only">{t('webOwnColor')}</span>
              <input type="color" aria-label={t('webOwnColor')} value={api.brandHex(f.color)} onChange={(e) => setF({ ...f, color: e.target.value.toLowerCase() })} />
            </label>
          </div>
        </div>
        {Object.entries(api.STYLE_OPTIONS).map(([k, vals]) => (
          <div key={k}>
            <span className="label-like">{t(`st_${k}`)}</span>
            <div className="chips wrap opt-chips" role="radiogroup" aria-label={t(`st_${k}`)}>
              {vals.map((v) => <button type="button" key={v} role="radio" aria-checked={f.style[k] === v} className="chip" onClick={() => setF({ ...f, style: { ...f.style, [k]: v } })}>{t(`st_${k}_${v}`)}</button>)}
            </div>
          </div>
        ))}
        <div>
          <span className="label-like">{t('st_sections')}</span>
          <div className="stack tight">
            {['show_featured', 'show_about', 'show_social'].map((k) => (
              <label key={k} className="check-row"><input type="checkbox" checked={f.style[k] !== false} onChange={(e) => setF({ ...f, style: { ...f.style, [k]: e.target.checked } })} /> {t(`st_${k}`)}</label>
            ))}
          </div>
        </div>
      </section>

      <section className="card stack">
        <h3>{t('webBrand')}</h3>
        <Field id="wb-name" label={t('webBrandName')} error={err.brand_name} hint={t('webBrandHint')}><input id="wb-name" maxLength={60} value={f.brand_name} onChange={set('brand_name')} /></Field>
        <Field id="wb-slug" label={t('webSlug')} error={err.slug} hint={t('webSlugHint')}>
          <div className="slug-input" dir="ltr"><span>/s/</span><input id="wb-slug" maxLength={30} autoCapitalize="none" autoCorrect="off" spellCheck={false} value={f.slug} onChange={(e) => { setF({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') }); setErr({ ...err, slug: undefined, form: undefined }); }} placeholder="nour-store" /></div>
        </Field>
        <div className="row upload-row">
          <span className="biz-logo" style={{ width: 52, height: 52 }}>{f.logo_url ? <img src={f.logo_url} alt="" /> : (f.brand_name || '?').charAt(0).toUpperCase()}</span>
          <Field id="wb-logo" label={t('bizLogo')} error={err.logo_url}><input id="wb-logo" type="file" accept="image/*" onChange={(e) => upload('logo_url', e)} /></Field>
        </div>
        <div className="row upload-row">
          <span className="cover-thumb">{f.cover_url ? <img src={f.cover_url} alt="" /> : null}</span>
          <Field id="wb-cover" label={t('webCover')} error={err.cover_url}><input id="wb-cover" type="file" accept="image/*" onChange={(e) => upload('cover_url', e)} /></Field>
        </div>
        {(f.logo_url || f.cover_url) && (
          <div className="row">
            {f.logo_url && <button type="button" className="link-btn small" onClick={() => setF({ ...f, logo_url: '' })}>{t('webRemoveLogo')}</button>}
            {f.cover_url && <button type="button" className="link-btn small" onClick={() => setF({ ...f, cover_url: '' })}>{t('webRemoveCover')}</button>}
          </div>
        )}
        <Field id="wb-about" label={t('webAbout')}><textarea id="wb-about" rows="3" maxLength={400} value={f.about} onChange={set('about')} placeholder={t('webAboutHint')} /></Field>
      </section>

      <section className="card stack">
        <h3>{t('webSocial')}</h3>
        <Field id="wb-ig" label="Instagram"><input id="wb-ig" dir="ltr" maxLength={200} value={f.instagram} onChange={set('instagram')} placeholder="@yourpage" /></Field>
        <Field id="wb-tt" label="TikTok"><input id="wb-tt" dir="ltr" maxLength={200} value={f.tiktok} onChange={set('tiktok')} placeholder="@yourpage" /></Field>
        <Field id="wb-fb" label="Facebook"><input id="wb-fb" dir="ltr" maxLength={200} value={f.facebook} onChange={set('facebook')} placeholder="yourpage" /></Field>
      </section>

      <section className="card stack">
        <h3>{t('webProducts')}</h3>
        <p className="small muted">{t('webProductsHint')}</p>
        {mine.length === 0 ? <div className="empty"><p>{t('noBizProducts')}</p><Button onClick={() => go('/products')}>{t('addProducts')}</Button></div> : (
          <div className="list">
            {[...f.items.map((i) => mine.find((p) => p.id === i.product_id)).filter(Boolean), ...mine.filter((p) => !item(p.id))].map((p) => {
              const it = item(p.id);
              return (
                <div key={p.id} className={`web-item${it ? ' on' : ''}`}>
                  <label className="web-item-head">
                    <input type="checkbox" checked={!!it} onChange={() => toggle(p)} />
                    <img src={imgSrc(p.image_url)} alt="" />
                    <span className="or-main"><b>{pname(p, lang)}</b><span className="muted small">{t('minIs', { p: money(p.min_price, lang) })}</span></span>
                  </label>
                  {it && (
                    <div className="web-item-tools">
                      <Field id={`wb-pr-${p.id}`} label={t('pricePerPiece')}>
                        <input id={`wb-pr-${p.id}`} type="number" inputMode="numeric" min={p.min_price} value={it.price} onChange={(e) => patchItem(p.id, { price: latinDigits(e.target.value) })} />
                      </Field>
                      <button type="button" className={`chip${it.featured ? ' on' : ''}`} aria-pressed={!!it.featured} disabled={!it.featured && featuredCount >= 3} onClick={() => patchItem(p.id, { featured: !it.featured })}>★ {t('webFeatured')}</button>
                      <button type="button" className="icon-btn small" aria-label={t('moveUp')} onClick={() => move(p.id, -1)}>↑</button>
                      <button type="button" className="icon-btn small" aria-label={t('moveDown')} onClick={() => move(p.id, 1)}>↓</button>
                    </div>
                  )}
                  {it && <ItemLook p={p} it={it} onChange={(patch) => patchItem(p.id, patch)} onError={(m) => setErr({ ...err, items: m })} />}
                </div>
              );
            })}
          </div>
        )}
        {err.items && <p className="form-error" role="alert">{err.items}</p>}
        <p className="small muted">{t('webFeaturedHint')}</p>
      </section>

      {err.form && <p className="form-error" role="alert">{err.form}</p>}
      <div className="web-actions">
        <Button block variant="ghost" onClick={() => save()} disabled={busy}>{t('save')}</Button>
        {w.published
          ? <Button block variant="ghost" onClick={() => save(false)} disabled={busy}>{t('webUnpublish')}</Button>
          : <Button block onClick={() => save(true)} disabled={busy}>{busy ? t('loading') : t('webPublish')}</Button>}
      </div>
      <Sheet open={preview} onClose={() => setPreview(false)} title={t('webPreview')}>
        <div className="preview-full"><StoreView store={view} preview /></div>
      </Sheet>
    </div>
  );
}

// ---------- The store itself (public page + preview) ----------
// CSS variables for a store: brand colour + readable text on it.
export function storeVars(store) {
  const hex = api.brandHex(store.color); const on = api.onBrand(hex);
  // --brand-ink: the brand colour for text on white, or dark text when the brand colour is too light to read.
  return { '--brand': hex, '--on-brand': on, '--brand-ink': on === '#ffffff' ? hex : '#161616' };
}

export function StoreView({ store, preview, onPick }) {
  const { t, lang } = useApp();
  const st = api.styleOf(store);
  const featured = st.show_featured ? store.items.filter((i) => i.featured) : [];
  const socials = st.show_social ? ['instagram', 'tiktok', 'facebook'].map((k) => [k, socialUrl(k, store[k])]).filter(([, u]) => u) : [];
  const label = (k) => (k === 'instagram' ? 'Instagram' : k === 'tiktok' ? 'TikTok' : 'Facebook');
  const card = (p) => (
    <button type="button" key={p.id} className="store-product" onClick={() => onPick?.(p)} disabled={preview} tabIndex={preview ? -1 : undefined}>
      <span className="ph"><img src={imgSrc(p.image_url)} alt="" loading="lazy" /></span>
      <span className="store-pinfo"><b className="pname">{pname(p, lang)}</b><span className="store-price">{money(p.price, lang)}</span>{p.sold_out && <span className="sold-out">{t('soldOut')}</span>}</span>
    </button>
  );
  const cover = st.cover !== 'none' && store.cover_url;
  return (
    <div className={`store font-${st.font} bg-${st.bg} btn-${st.buttons} hd-${st.header} lay-${st.layout} cv-${cover ? st.cover : 'none'}`} style={storeVars(store)}>
      <header className="store-top">
        <span className="store-logo">{store.logo_url ? <img src={store.logo_url} alt="" /> : (store.brand_name || '?').charAt(0).toUpperCase()}</span>
        <b className="store-brand">{store.brand_name}</b>
        {!preview && <LangSwitch />}
      </header>
      <div className="store-hero">
        {cover && <img className="store-cover" src={store.cover_url} alt="" />}
        <div className="store-hero-text">
          <h1>{store.brand_name}</h1>
          {st.show_about && store.about && <p>{store.about}</p>}
        </div>
      </div>
      <p className="store-cod"><Icon name="truck" size={16} /> {t('storeCod')}</p>
      {socials.length > 0 && (
        <div className="store-social">
          {socials.map(([k, u]) => (preview ? <span key={k} className="chip">{label(k)}</span>
            : <a key={k} className="chip" href={u} target="_blank" rel="noopener noreferrer">{label(k)}</a>))}
        </div>
      )}
      {featured.length > 0 && <><h2 className="store-h">{t('storeFeatured')}</h2><div className="store-grid">{featured.map(card)}</div></>}
      <h2 className="store-h">{t('storeAll')}</h2>
      {store.items.length === 0 ? <p className="store-empty">{t('storeEmpty')}</p> : <div className="store-grid">{store.items.map(card)}</div>}
      <footer className="store-foot">{t('poweredBy')}</footer>
    </div>
  );
}

const EMPTY = { name: '', phone: '', governorate: 'Cairo', address: '', options: '', hp: '' };

export function Storefront({ slug }) {
  const { t, lang } = useApp();
  const { loading, data: store, error, reload } = useLoad(() => api.publicStore(slug), [slug]);
  const [pick, setPick] = useState(null);
  const [qty, setQty] = useState(1);
  const [step, setStep] = useState('product');
  const [f, setF] = useState(EMPTY);
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  useEffect(() => { if (store?.brand_name) document.title = store.brand_name; return () => { document.title = 'Forsa'; }; }, [store?.brand_name]);
  if (loading) return <div className="screen"><Spinner /></div>;
  if (error) return <div className="screen"><ErrorBox error={error} onRetry={reload} /></div>;
  if (!store) {
    return (
      <div className="screen store-missing">
        <div className="row-between"><span /><LangSwitch /></div>
        <div className="card empty"><Icon name="store" size={28} /><h1 className="page-title">{t('storeMissing')}</h1><p className="muted">{t('storeMissingHint')}</p></div>
      </div>
    );
  }
  const rates = store.shipping || [];
  const rate = rates.find((r) => r.governorate === f.governorate);
  const govName = (g) => (lang === 'ar' ? (GOVERNORATES.find((x) => x[0] === g)?.[1] || g) : g);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErrs({ ...errs, [k]: undefined, form: undefined }); };
  const open = (p) => { setPick(p); setQty(1); setStep('product'); setErrs({}); };
  const close = () => { setPick(null); };
  async function order(ev) {
    ev.preventDefault();
    const e = {};
    const phone = latinDigits(f.phone).replace(/[\s-]/g, '');
    if (f.name.trim().length < 2) e.name = t('required');
    if (!/^(\+?20)?0?1[0125]\d{8}$/.test(phone)) e.phone = t('invalidPhone');
    if (!rate) e.governorate = t('noDelivery');
    if (f.address.trim().length < 5) e.address = t('storeAddressShort');
    setErrs(e); if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const n = await api.placeStoreOrder({ slug: store.slug, product_id: pick.id, quantity: qty, name: f.name.trim(), phone, governorate: f.governorate, address: f.address.trim(), options: f.options.trim(), hp: f.hp, ad: api.adRef() });
      setDone({ n, product: pick, qty, total: pick.price * qty + (rate?.fee || 0) });
      setPick(null); setF(EMPTY);
    } catch (er) { setErrs({ form: er.message }); } finally { setBusy(false); }
  }
  return (
    <div className={`store-page store-sheets btn-${api.styleOf(store).buttons}`} style={storeVars(store)}>
      <StoreView store={store} onPick={open} />
      <Sheet open={!!pick} onClose={close} title={pick ? pname(pick, lang) : ''}>
        {pick && (step === 'product' ? (
          <div className="stack">
            <div className="store-sheet-img"><img src={imgSrc(pick.image_url)} alt={pname(pick, lang)} /></div>
            <p className="muted">{lang === 'ar' ? pick.description_ar : pick.description_en}</p>
            <div className="row-between"><b className="store-price big">{money(pick.price, lang)}</b>
              {!pick.sold_out && <div className="stepper">
                <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="−">−</button>
                <output aria-label={t('quantity')}>{num(qty, lang)}</output>
                <button type="button" onClick={() => setQty(Math.min(10, qty + 1))} aria-label="+">+</button>
              </div>}
            </div>
            {pick.sold_out ? <p className="sold-out big">{t('soldOutLine')}</p>
              : <button type="button" className="btn btn-primary block store-btn" onClick={() => setStep('form')}>{t('storeOrderNow')}</button>}
            <p className="small muted"><Icon name="truck" size={14} /> {t('storeCod')}</p>
          </div>
        ) : (
          <form className="stack" onSubmit={order} noValidate>
            <div className="order-summary"><span>{pname(pick, lang)} × {num(qty, lang)}</span><b>{money(pick.price * qty, lang)}</b></div>
            <Field id="st-name" label={t('storeYourName')} error={errs.name}><input id="st-name" autoComplete="name" value={f.name} onChange={set('name')} maxLength={80} /></Field>
            <Field id="st-phone" label={t('storeYourPhone')} error={errs.phone}><input id="st-phone" autoComplete="tel" inputMode="tel" dir="ltr" placeholder="01012345678" value={f.phone} onChange={set('phone')} /></Field>
            <Field id="st-gov" label={t('city')} error={errs.governorate} hint={rate ? t('storeShipping', { a: money(rate.fee, lang) }) : undefined}>
              <select id="st-gov" value={f.governorate} onChange={set('governorate')}>
                {GOVERNORATES.filter(([en]) => rates.some((r) => r.governorate === en)).map(([en, ar]) => <option key={en} value={en}>{lang === 'ar' ? ar : en}</option>)}
              </select>
            </Field>
            <Field id="st-addr" label={t('address')} error={errs.address}><textarea id="st-addr" rows="2" maxLength={300} value={f.address} onChange={set('address')} placeholder={t('addressHint')} /></Field>
            <Field id="st-opts" label={t('productOptions')} hint={t('productOptionsHint')}><input id="st-opts" maxLength={200} value={f.options} onChange={set('options')} /></Field>
            <div className="hp-field" aria-hidden="true"><label htmlFor="st-web">Website</label><input id="st-web" tabIndex={-1} autoComplete="off" value={f.hp} onChange={set('hp')} /></div>
            <dl className="kv sum-kv">
              <dt>{t('productsTotal')}</dt><dd>{money(pick.price * qty, lang)}</dd>
              <dt>{t('shippingFee')}{rate ? ` (${govName(f.governorate)})` : ''}</dt><dd>{money(rate?.fee || 0, lang)}</dd>
              <dt className="strong">{t('storePayOnDelivery')}</dt><dd className="strong">{money(pick.price * qty + (rate?.fee || 0), lang)}</dd>
            </dl>
            {errs.form && <p className="form-error" role="alert">{errs.form}</p>}
            <button type="submit" className="btn btn-primary block store-btn" disabled={busy}>{busy ? t('loading') : t('storeConfirm')}</button>
            <button type="button" className="link-btn small" onClick={() => setStep('product')}>{t('back')}</button>
          </form>
        ))}
      </Sheet>
      <Sheet open={!!done} onClose={() => setDone(null)} title={t('storeThanks')}>
        {done && (
          <div className="stack store-thanks">
            <span className="thanks-icon"><Icon name="check" size={28} /></span>
            <p><b>{t('storeOrderNo', { n: num(done.n, lang) })}</b></p>
            <p>{t('storeThanksLine')}</p>
            <p className="small muted">{pname(done.product, lang)} × {num(done.qty, lang)} · {money(done.total, lang)}</p>
            <Button block onClick={() => setDone(null)}>{t('storeContinue')}</Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
