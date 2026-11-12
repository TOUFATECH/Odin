// Odin, la mascotte, présent sur toutes les pages (hors Discussion, où il a déjà sa propre vie).
// Il choisit lui-même où se poser : toujours dans une zone libre (jamais sur du texte, un bouton, un
// champ, une image ou la navigation), il se déplace quand le contenu change, quand tu défiles, quand
// tu changes de page ou d'écran, va voir ce qui demande ton attention, se promène quand il s'ennuie
// et s'écarte si ta souris ou ton doigt arrive sur lui. Sa taille suit l'écran (téléphone, tablette,
// ordinateur) et il rapetisse s'il n'y a pas assez de place libre. Tu peux aussi le déplacer toi-même :
// il reste où tu l'as posé un moment, puis reprend sa liberté.
(() => {
  'use strict';
  if (window.OdinCompanion) return;
  const reduce = matchMedia('(prefers-reduced-motion:reduce)');
  const coarse = matchMedia('(pointer:coarse)');
  const S = () => window.OdinState || {};
  let bud = null, pos = null, size = 64, moving = 0, pinnedUntil = 0, lastWander = Date.now(), idleSince = Date.now(), view = '';

  // ---------- Fabrication : une copie de la mascotte de la discussion, avec ses propres dégradés ----------
  function make() {
    const had = document.getElementById('buddyRoam'); if (had) return had; // une seule mascotte en liberté
    const src = document.getElementById('buddyChat') || document.querySelector('.odin');
    if (!src) return null;
    const b = src.cloneNode(true);
    b.id = 'buddyRoam'; b.className = 'odin roam'; b.removeAttribute('title'); b.setAttribute('aria-hidden', 'true');
    for (const g of b.querySelectorAll('[id]')) {
      const nid = `${g.id}-roam`;
      for (const r of b.querySelectorAll('*')) for (const a of ['fill', 'stroke', 'filter', 'clip-path', 'mask']) { if (r.getAttribute(a) === `url(#${g.id})`) r.setAttribute(a, `url(#${nid})`); }
      g.id = nid;
    }
    document.body.append(b);
    window.OdinFace?.set(b, S().mood?.() || 'neutre');
    return b;
  }

  // ---------- Ce qui est « occupé » : texte, contrôles, médias, navigation ----------
  const BUSY_SEL = 'a,button,input,textarea,select,label,summary,img,video,canvas,svg,iframe,[role=button],[role=tab],[role=switch],[contenteditable=true],nav,.mbar,.bnav,.tip,.palette,dialog,table,code,pre';
  function textAt(el, x, y) {
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      for (const q of r.getClientRects()) if (x >= q.left - 6 && x <= q.right + 6 && y >= q.top - 6 && y <= q.bottom + 6) return true;
    }
    return false;
  }
  function busyAt(x, y) {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return true;
    const hits = document.elementsFromPoint(x, y).filter((e) => e !== bud && !bud?.contains(e));
    const top = hits[0];
    if (!top || top === document.documentElement || top === document.body) return false;
    // Une carte, une section ou un fond ne gênent pas ; un contrôle, un média ou la navigation, si.
    if (top.closest(BUSY_SEL)) return true;
    return textAt(top, x, y);
  }
  // Nombre de points occupés sous un carré de côté s placé en (x, y) (coin haut gauche).
  function cost(x, y, s) {
    let n = 0; const k = 4;
    for (let i = 0; i <= k; i++) for (let j = 0; j <= k; j++) if (busyAt(x + (s * i) / k, y + (s * j) / k)) n++;
    return n;
  }

  // ---------- La zone où il peut aller : la page affichée, sans les barres ----------
  function area() {
    const v = document.querySelector('.view.on'); if (!v) return null;
    const r = v.getBoundingClientRect();
    let top = Math.max(r.top, 0), bottom = Math.min(r.bottom, innerHeight), left = Math.max(r.left, 0), right = Math.min(r.right, innerWidth);
    for (const bar of document.querySelectorAll('.mbar,.bnav,nav.bottom,.tabbar')) {
      const b = bar.getBoundingClientRect(); if (!b.height || getComputedStyle(bar).display === 'none') continue;
      if (b.top <= top + 4 && b.bottom > top) top = b.bottom;
      if (b.bottom >= bottom - 4 && b.top < bottom) bottom = b.top;
    }
    const head = v.querySelector(':scope > header, .vhead'); if (head) { const h = head.getBoundingClientRect(); if (h.bottom > top && h.top <= top + 4) top = Math.max(top, Math.min(h.bottom, top + 40)); }
    return { left: left + 6, top: top + 6, right: right - 6, bottom: bottom - 6 };
  }
  // Taille selon l'écran : téléphone, tablette, ordinateur.
  function baseSize() { const w = innerWidth; return w < 600 ? 46 : w < 1024 ? (coarse.matches ? 56 : 58) : 66; }

  // ---------- Choisir une place : libre, proche de ce qui l'intéresse, pas trop loin d'où il est ----------
  function choose(want) {
    const A = area(); if (!A) return null;
    for (const s of [baseSize(), Math.round(baseSize() * 0.78), Math.round(baseSize() * 0.6)]) {
      const W = A.right - A.left - s, H = A.bottom - A.top - s; if (W < 0 || H < 0) continue;
      const step = Math.max(s * 0.7, 28), cands = [];
      for (let y = A.top; y <= A.top + H; y += step) for (let x = A.left; x <= A.left + W; x += step) cands.push([x, y]);
      cands.push([A.left + W, A.top + H], [A.left + W, A.top], [A.left, A.top + H]);
      let best = null;
      for (const [x, y] of cands) {
        const c = cost(x, y, s); if (c) continue;
        const cx = x + s / 2, cy = y + s / 2;
        let score = Math.random() * 40;
        if (want) score += Math.hypot(cx - want.x, cy - want.y);
        else if (pos) score += Math.hypot(cx - (pos.x + size / 2), cy - (pos.y + size / 2)) * 0.25;
        // Préférence légère pour les bords (il ne se met pas au milieu de ta lecture).
        score += Math.min(cx - A.left, A.right - cx, cy - A.top, A.bottom - cy) * 0.15;
        if (!best || score < best.score) best = { x, y, s, score };
      }
      if (best) return best;
    }
    // Aucune place libre (graphe plein écran, page très chargée) : petit, dans le coin le moins gênant.
    const s = Math.round(baseSize() * 0.6);
    const corners = [[A.right - s, A.bottom - s], [A.right - s, A.top], [A.left, A.bottom - s], [A.left, A.top]];
    corners.sort((a, b) => cost(a[0], a[1], s) - cost(b[0], b[1], s));
    return { x: corners[0][0], y: corners[0][1], s };
  }

  function place(p, how = 'walk') {
    if (!bud || !p) return;
    const far = !pos || Math.hypot(p.x - pos.x, p.y - pos.y) > 4;
    pos = { x: p.x, y: p.y }; size = p.s;
    bud.style.setProperty('--rs', `${size}px`);
    bud.classList.remove('walk', 'hopto');
    if (far && !reduce.matches) { bud.classList.add(how); clearTimeout(moving); moving = setTimeout(() => bud.classList.remove('walk', 'hopto'), how === 'walk' ? 1150 : 800); }
    bud.style.translate = `${Math.round(pos.x)}px ${Math.round(pos.y)}px`;
  }
  function go(want, how) { if (Date.now() < pinnedUntil && !want?.force) return; place(choose(want), how); }
  function act(name, ms = 1400) { if (!bud || reduce.matches) return; bud.classList.remove(name); void bud.offsetWidth; bud.classList.add(name); setTimeout(() => bud.classList.remove(name), ms); }
  function lookAt(x, y) {
    if (!bud) return;
    const r = bud.getBoundingClientRect(), dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1;
    bud.classList.add('follow'); bud.style.setProperty('--ex', `${(dx / d * 5).toFixed(1)}px`); bud.style.setProperty('--ey', `${(dy / d * 4).toFixed(1)}px`);
    clearTimeout(lookAt._t); lookAt._t = setTimeout(() => bud.classList.remove('follow'), 2500);
  }

  // ---------- Visible ou non : partout, sauf dans la Discussion (sa copie là-bas vit déjà) ----------
  function currentView() { return document.querySelector('.view.on')?.id?.replace(/^v-/, '') || ''; }
  function shouldShow() {
    const v = currentView();
    if (!v || v === 'chat') return false;
    // Caché par tes 10 clics (sur tous tes écrans) : il revient par Réglages → Apparence.
    if (window.OdinMascotte?.hidden?.()) return false;
    // Écran d'accès : sa grande mascotte est déjà là.
    const lg = document.getElementById('login'); if (lg && !lg.hidden && lg.getClientRects().length && getComputedStyle(lg).display !== 'none') return false;
    if (S().roam && !S().roam()) return true; // promenade coupée : il reste visible, posé, sans se promener
    return true;
  }
  function sync(how = 'hopto') {
    if (!bud) bud = make(); if (!bud) return;
    const v = currentView(), show = shouldShow();
    bud.hidden = !show;
    if (!show) { view = v; return; }
    if (v !== view) { view = v; pinnedUntil = 0; go(null, how); window.OdinFace?.flash(bud, ['regarde', 'joie', 'surprise'][Math.floor(Math.random() * 3)], 1600); return; }
    // Toujours visible et jamais sur du contenu : s'il est sorti de l'écran ou que quelque chose est apparu sous lui, il bouge.
    if (!pos) return go(null, how);
    const A = area(); if (!A) return;
    const out = pos.x < A.left - 2 || pos.y < A.top - 2 || pos.x + size > A.right + 2 || pos.y + size > A.bottom + 2;
    if (out || (cost(pos.x, pos.y, size) > 2 && Date.now() >= pinnedUntil) || Math.abs(size - baseSize()) > 30) go(null, 'walk');
  }

  // ---------- Ce qui l'intéresse : alertes, messages d'état, nouveautés ----------
  function attention() {
    const v = document.querySelector('.view.on'); if (!v) return null;
    const cands = [...v.querySelectorAll('.bad,[role=alert],.badge:not([hidden]),.warn')].filter((e) => e.offsetParent && e.textContent.trim());
    for (const e of cands) { const r = e.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) return { x: r.right + 40, y: r.top + r.height / 2, mood: 'inquiet' }; }
    return null;
  }
  const live = new MutationObserver((ms) => {
    if (!bud || bud.hidden) return;
    for (const m of ms) {
      const t = m.target.nodeType === 3 ? m.target.parentElement : m.target;
      const zone = t?.closest?.('[aria-live],[role=status]'); if (!zone || !zone.closest('.view.on')) continue;
      const txt = zone.textContent.trim(); if (!txt) continue;
      const r = zone.getBoundingClientRect();
      go({ x: r.right + 30, y: r.top + r.height / 2 }, 'hopto');
      setTimeout(() => {
        lookAt(r.left + Math.min(r.width, 200) / 2, r.top + r.height / 2);
        if (/✗|erreur|échec|impossible|invalide/i.test(txt)) { window.OdinFace?.flash(bud, 'triste', 2200); act('act-sad', 1500); }
        else if (/✓|enregistr|relié|ajouté|créé|terminé|prêt/i.test(txt)) { window.OdinFace?.flash(bud, 'joie', 2200); act('act-joy', 1100); }
        else { window.OdinFace?.flash(bud, 'regarde', 1600); act('act-tilt', 1600); }
      }, 700);
      return;
    }
  });

  // ---------- Toi : il te regarde, s'écarte si tu arrives dessus, se laisse déplacer ----------
  let drag = null;
  function onMove(e) {
    idleSince = Date.now();
    if (!bud || bud.hidden || drag) return;
    const r = bud.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, d = Math.hypot(e.clientX - cx, e.clientY - cy);
    if (d < 220) lookAt(e.clientX, e.clientY);
    // Il s'écarte seulement si ta souris va sur ce qui est juste à côté de lui (pas s'il est la cible).
    if (e.pointerType === 'mouse' && d < r.width * 0.9 && d > r.width * 0.45 && Date.now() >= pinnedUntil && !moving) {
      const below = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x !== bud && !bud.contains(x));
      if (below?.closest(BUSY_SEL)) go({ x: cx + (cx - e.clientX) * 4, y: cy + (cy - e.clientY) * 4 }, 'hopto');
    }
  }
  function onDown(e) {
    if (!bud || !(e.target instanceof Element) || !bud.contains(e.target)) return;
    drag = { x0: e.clientX, y0: e.clientY, px: pos?.x ?? 0, py: pos?.y ?? 0, moved: false, id: e.pointerId };
  }
  function onDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    if (!drag.moved) { drag.moved = true; bud.classList.add('dragging'); window.OdinFace?.flash(bud, 'excite', 1500); }
    pos = { x: Math.max(0, Math.min(innerWidth - size, drag.px + dx)), y: Math.max(0, Math.min(innerHeight - size, drag.py + dy)) };
    bud.style.translate = `${Math.round(pos.x)}px ${Math.round(pos.y)}px`;
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.moved) { bud.classList.remove('dragging'); pinnedUntil = Date.now() + 120_000; window.OdinFace?.flash(bud, 'joie', 1500); }
    // Un simple toucher : la petite fenêtre pour lui parler, sur n'importe quel onglet.
    // Les clics rapides (1 à 20) : 1 = lui parler, les autres font ce qui est réglé (Réglages → Apparence).
    else if (window.OdinMascotte?.tap) { window.OdinFace?.flash(bud, 'ecoute', 1500); window.OdinMascotte.tap(bud); }
    else if (window.OdinNotices?.talk) { window.OdinFace?.flash(bud, 'ecoute', 1500); window.OdinNotices.talk(); }
    drag = null;
  }

  // ---------- Sa vie : promenades, petites actions, selon son humeur et la page ----------
  function tick() {
    if (!bud || bud.hidden || drag || Date.now() < pinnedUntil) return;
    const idle = Date.now() - idleSince, since = Date.now() - lastWander;
    if (S().busy?.()) { if (since > 8000) { lastWander = Date.now(); act('act-advance', 1200); } return; }
    const need = attention();
    if (need && since > 25_000) { lastWander = Date.now(); go(need, 'hopto'); setTimeout(() => { window.OdinFace?.flash(bud, need.mood, 2200); act('act-tilt', 1600); }, 800); return; }
    if (S().roam && !S().roam()) return;
    if (idle > 12_000 && since > 15_000 + Math.random() * 25_000) {
      lastWander = Date.now();
      const roll = Math.random();
      const A = area();
      if (roll < 0.55 && A) { go({ x: A.left + Math.random() * (A.right - A.left), y: A.top + Math.random() * (A.bottom - A.top) }, 'walk'); window.OdinFace?.flash(bud, ['regarde', 'malice', 'joie', 'reflexion'][Math.floor(Math.random() * 4)], 2400); }
      else if (roll < 0.7) act('act-spin', 950);
      else if (roll < 0.85) act('act-wobble', 1000);
      else act('act-joy', 1100);
    }
  }

  function start() {
    bud = make(); if (!bud) return;
    view = '';
    sync('hopto');
    const views = new MutationObserver(() => sync('hopto'));
    for (const v of document.querySelectorAll('.view')) views.observe(v, { attributes: true, attributeFilter: ['class'] });
    live.observe(document.body, { subtree: true, childList: true, characterData: true });
    let rs = 0; addEventListener('resize', () => { clearTimeout(rs); rs = setTimeout(() => { pinnedUntil = 0; go(null, 'hopto'); }, 200); });
    let sc = 0; document.addEventListener('scroll', () => { clearTimeout(sc); sc = setTimeout(() => sync('walk'), 350); }, { passive: true, capture: true });
    addEventListener('pointermove', onMove, { passive: true });
    addEventListener('pointermove', onDrag, { passive: true });
    addEventListener('pointerdown', onDown, true);
    addEventListener('pointerup', onUp, true);
    addEventListener('pointercancel', onUp, true);
    for (const ev of ['keydown', 'pointerdown']) addEventListener(ev, () => { idleSince = Date.now(); }, { passive: true });
    setInterval(() => sync('walk'), 1500);
    setInterval(tick, 3000);
  }
  // `pin` : il reste où il est pendant ce temps (quand il parle) ; `pin(0)` lui rend sa liberté.
  window.OdinCompanion = { go: (x, y) => go({ x, y, force: true }, 'hopto'), act, lookAt, sync, pin: (ms) => { pinnedUntil = ms > 0 ? Date.now() + ms : 0; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 300)); else setTimeout(start, 300);
})();
