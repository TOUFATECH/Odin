// Sonde de fluidité : la partie qui tourne DANS la page. Lue comme du texte par test/banc/fluidite.ts.
// Elle note les décalages de mise en page, les tâches longues, les requêtes en cours et les changements de la page,
// pour mesurer le temps d'ouverture d'un écran ; elle sait aussi regarder une page qui se redessine toute seule
// et lister les animations qui tournent.
(function () {
  'use strict';
  if (window.__fluide) return window.__fluide;
  const now = () => performance.now();
  const F = { cls: [], longs: [], net: 0, dernierReseau: now(), derniereMut: now(), depart: now(), racine: null, ignorer: '.odin,#odinBubble,#odinTalk,#odinAdvice,[data-q-outil],.__q_marque,.typing' };
  /** Un nom court pour un élément (étiquette, identifiant ou classes). */
  F.nom = (e) => { if (!e || e.nodeType !== 1) return ''; const parts = []; for (let n = e, i = 0; n && n.nodeType === 1 && i < 4 && n !== document.body; n = n.parentElement, i++) { if (n.id) { parts.unshift('#' + n.id); break; } const cl = typeof n.className === 'string' ? n.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : []; parts.unshift(n.localName + (cl.length ? '.' + cl.join('.') : '')); } return parts.join(' > '); };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) F.cls.push({ t: e.startTime, v: e.value, src: (e.sources || []).slice(0, 3).map((s) => F.nom(s.node)).filter(Boolean) }); }).observe({ type: 'layout-shift', buffered: true }); } catch { /* navigateur sans cette mesure */ }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) F.longs.push({ t: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch { /* idem */ }
  // Requêtes en cours (fetch et XMLHttpRequest), sauf les flux qui restent ouverts.
  const flux = (u) => /\/api\/stream|\/api\/ran\/live/.test(String(u));
  const f0 = window.fetch;
  if (f0) window.fetch = function (...a) {
    const suivi = !flux(a[0] && a[0].url ? a[0].url : a[0]);
    if (suivi) F.net++;
    const fin = () => { if (suivi) { F.net--; F.dernierReseau = now(); } };
    return f0.apply(this, a).then((r) => { fin(); return r; }, (e) => { fin(); throw e; });
  };
  const X = window.XMLHttpRequest;
  if (X) { const open = X.prototype.open, send = X.prototype.send; X.prototype.open = function (m, u, ...r) { this.__flux = flux(u); return open.call(this, m, u, ...r); }; X.prototype.send = function (...a) { if (!this.__flux) { F.net++; this.addEventListener('loadend', () => { F.net--; F.dernierReseau = now(); }, { once: true }); } return send.apply(this, a); }; }
  new MutationObserver((recs) => {
    for (const r of recs) { const t = r.target.nodeType === 1 ? r.target : r.target.parentElement; if (!t || (t.closest && t.closest(F.ignorer))) continue; if (F.racine && !F.racine.contains(t)) continue; F.derniereMut = now(); return; }
  }).observe(document, { subtree: true, childList: true, characterData: true });
  /** Point de départ d'une mesure (juste avant d'ouvrir un écran). */
  F.marquer = (racine) => { F.depart = now(); F.racine = racine ? document.querySelector(racine) : null; return { t: F.depart, cls: F.cls.length, longs: F.longs.length }; };
  /** Attend que la page ne bouge plus (plus de requête, plus de changement pendant `calme` ms). Rend le temps d'ouverture. */
  F.stable = (calme, max) => new Promise((ok) => {
    const t0 = now();
    const tick = () => {
      const t = now(), dernier = Math.max(F.derniereMut, F.dernierReseau, F.depart);
      if (F.net <= 0 && t - dernier >= calme) return ok({ ms: Math.max(0, Math.round(dernier - F.depart)), expire: false });
      if (t - t0 > max) return ok({ ms: Math.round(t - F.depart), expire: true });
      setTimeout(tick, 40);
    };
    tick();
  });
  /** Décalages de mise en page et tâches longues depuis un point de départ. */
  F.depuis = (m) => {
    const cls = F.cls.slice(m.cls), longs = F.longs.slice(m.longs), src = {};
    for (const c of cls) for (const s of c.src) src[s] = (src[s] || 0) + c.v;
    return { decalage: Math.round(cls.reduce((a, c) => a + c.v, 0) * 1000) / 1000, decalages: cls.length, sources: Object.entries(src).sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => x[0]), longues: longs.length, longueMax: Math.round(longs.reduce((a, l) => Math.max(a, l.d), 0)), longuesTotal: Math.round(longs.reduce((a, l) => a + l.d, 0)) };
  };
  /** Les animations en cours (CSS et Web Animations) : nom, cible, durée, sans fin ou non, ce qu'elles font bouger. */
  F.animations = () => document.getAnimations().filter((a) => a.playState === 'running').map((a) => {
    const e = a.effect, t = e && e.getComputedTiming ? e.getComputedTiming() : {}, cible = e && e.target;
    const props = e && e.getKeyframes ? [...new Set(e.getKeyframes().flatMap((k) => Object.keys(k)).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)))] : [];
    const vu = Boolean(cible && cible.checkVisibility && cible.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })), r = cible ? cible.getBoundingClientRect() : { width: 0, height: 0, bottom: 0, top: 0, right: 0, left: 0 };
    return { nom: a.animationName || (a.transitionProperty ? 'transition ' + a.transitionProperty : 'script'), sel: cible ? F.nom(cible) : '', infinie: t.iterations === Infinity, duree: Math.round(Number(t.duration) || 0), props, visible: vu && r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth, bouge: props.some((p) => /transform|translate|rotate|scale|left|top|right|bottom|margin|width|height|offset/i.test(p)) };
  });
  /** Ce qui change de place tout seul pendant `ms` millisecondes (éléments placés ou transformés). */
  F.bougent = (ms) => new Promise((ok) => {
    const c = [...document.querySelectorAll('body *')].filter((e) => { if (!e.checkVisibility || !e.checkVisibility()) return false; const s = getComputedStyle(e); return s.position === 'fixed' || s.position === 'absolute' || s.transform !== 'none' || s.translate !== 'none'; }).slice(0, 500);
    const a = c.map((e) => e.getBoundingClientRect());
    setTimeout(() => { const moved = []; c.forEach((e, i) => { const b = e.getBoundingClientRect(), d = Math.hypot(b.left - a[i].left, b.top - a[i].top); if (d > 3 && b.width > 4 && b.height > 4) moved.push({ el: e, px: Math.round(d) }); }); ok(moved.filter((m) => !moved.some((x) => x !== m && x.el.contains(m.el))).map((m) => ({ sel: F.nom(m.el), px: m.px }))); }, ms);
  });
  /**
   * Regarde une zone qui se redessine toute seule pendant `ms` millisecondes : combien de fois, combien d'éléments
   * recréés, et ce que l'utilisateur y perd (défilement, champ rempli, volet ouvert, focus). Des témoins sont posés avant.
   */
  F.redessin = (racineSel, ms) => new Promise((ok) => {
    const r = document.querySelector(racineSel); if (!r) return ok(null);
    const vis = (e) => Boolean(e.checkVisibility && e.checkVisibility());
    const base = { h: r.scrollHeight, n: r.querySelectorAll('*').length }, T = {};
    const champs = () => [...r.querySelectorAll('input:not([type]),input[type=text],input[type=number],textarea')], volets = () => [...r.querySelectorAll('details')], defileurs = () => [...r.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 60 && /auto|scroll/.test(getComputedStyle(e).overflowY));
    const ic = champs().findIndex((i) => !i.value && !i.disabled && !i.readOnly && vis(i)); if (ic >= 0) { const c = champs()[ic]; c.value = c.type === 'number' ? '42' : 'essai qualité'; T.champ = { i: ic, v: c.value }; }
    const iv = volets().findIndex((d) => !d.open && vis(d)); if (iv >= 0) { volets()[iv].open = true; T.volet = iv; }
    if (r.scrollHeight > r.clientHeight + 260) { r.scrollTop = 200; T.defile = r.scrollTop; }
    const id = defileurs().findIndex(vis); if (id >= 0) { defileurs()[id].scrollTop = 48; T.interne = { i: id, top: defileurs()[id].scrollTop }; }
    const bouton = [...r.querySelectorAll('button')].find((b) => vis(b) && !b.disabled); if (bouton) { bouton.focus({ preventScroll: true }); T.focus = true; }
    let redessins = 0, retires = 0, ajoutes = 0, vides = 0, sauts = 0, minH = base.h, dernierH = base.h, images = 0;
    const mo = new MutationObserver((recs) => { let gros = false; for (const x of recs) { retires += x.removedNodes.length; ajoutes += x.addedNodes.length; for (const n of x.addedNodes) if (n.nodeType === 1) images += n.localName === 'img' ? 1 : n.querySelectorAll ? n.querySelectorAll('img').length : 0; if (x.removedNodes.length && x.addedNodes.length && (x.target === r || x.target.parentElement === r)) gros = true; } if (gros) redessins++; });
    mo.observe(r, { childList: true, subtree: true });
    const t0 = now();
    const fin = () => {
      mo.disconnect();
      const c = T.champ ? champs()[T.champ.i] : null, v = T.volet !== undefined ? volets()[T.volet] : null, d = T.interne ? defileurs()[T.interne.i] : null;
      ok({ redessins, retires, ajoutes, images, vides, sauts, hauteur: base.h, hauteurMin: minH, elements: base.n,
        champPerdu: T.champ ? !c || c.value !== T.champ.v : null, voletReferme: T.volet !== undefined ? !v || !v.open : null,
        defilementPerdu: T.defile ? Math.abs(r.scrollTop - T.defile) > 40 : null, interneRemis: T.interne && T.interne.top > 20 ? !d || d.scrollTop < 20 : null,
        focusPerdu: T.focus ? !(document.activeElement && r.contains(document.activeElement)) : null });
    };
    const image = () => { const h = r.scrollHeight; if (!r.childElementCount || h < base.h * 0.3) vides++; if (h < dernierH * 0.7) sauts++; minH = Math.min(minH, h); dernierH = h; if (now() - t0 < ms) requestAnimationFrame(image); else fin(); };
    requestAnimationFrame(image);
  });
  window.__fluide = F; return F;
})()
