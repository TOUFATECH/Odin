// Détecteur de débordements et d'éléments mal placés : la partie qui tourne DANS la page (navigateur).
// Ce fichier est lu comme du texte par test/banc/debordements.ts (et par outils/verifier-planches.cjs), puis
// évalué dans la page : il rend une fonction `detecter(options)` → { defauts, mesures }.
// Aucune dépendance, rien n'est changé dans la page (seul un repère `data-q` est posé sur les éléments fautifs,
// pour que la capture d'écran les retrouve).
//
// Ce qu'il cherche : défilement horizontal de la page, élément hors de l'écran ou coupé par sa boîte, texte qui
// sort de sa boîte, texte coupé ou tronqué, texte recouvert (par un autre élément, une notification, la mascotte,
// une barre fixe), texte posé sur le décor du thème, boutons qui se chevauchent, onglets sur plusieurs lignes,
// libellé de bouton sur 3 lignes, cible tactile trop petite, image déformée, contraste (WCAG), focus invisible.
(function () {
  'use strict';
  return async function detecter(o) {
    o = Object.assign({ racine: '', ignorer: [], dessus: [], tactile: null, cibleMin: 40, contraste: true, focus: true, defiler: true, decor: true, onglets: '', cadre: null, regrouper: true, maxFocus: 80 }, o || {});
    const t0 = performance.now();
    const D = document, DE = D.documentElement, B = D.body, W = innerWidth, H = innerHeight, EPS = 1.5;
    const SVGNS = 'http://www.w3.org/2000/svg';
    const tactile = o.tactile === null || o.tactile === undefined ? W <= 480 : Boolean(o.tactile);
    const out = [];
    let qn = Number(DE.getAttribute('data-qn') || 0);

    // ------------------------------------------------------------------ Outils
    const csC = new WeakMap();
    const cs = (e) => { let s = csC.get(e); if (!s) { s = getComputedStyle(e); csC.set(e, s); } return s; };
    const rect = (e) => e.getBoundingClientRect();
    const R = (e) => { const r = rect(e); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const ign = (o.ignorer || []).filter(Boolean).join(','), dessus = (o.dessus || []).filter(Boolean).join(',');
    const ignore = (e) => Boolean(ign && e.closest && e.closest(ign));
    const esc = (s) => CSS.escape(s);
    const VOLATILE = /^(on|open|active|cur|pop|in|out|walk|hopto|follow|bounce|thinking|talking|dragging)$|^(m-|e-|act-|is-|has-)/;
    /** Un sélecteur CSS court et lisible, unique dans la page quand c'est possible. */
    function sel(e) {
      if (!e || e.nodeType !== 1) return '';
      if (e === B) return 'body'; if (e === DE) return 'html';
      const parts = [];
      for (let n = e, depth = 0; n && n.nodeType === 1 && n !== B && n !== DE && depth < 7; n = n.parentElement, depth++) {
        if (n.id && !/\d{5,}/.test(n.id)) { let u = false; try { u = D.querySelectorAll('#' + esc(n.id)).length === 1; } catch { u = false; } if (u) { parts.unshift('#' + esc(n.id)); break; } }
        let p = n.localName;
        const cl = [...n.classList].filter((c) => !VOLATILE.test(c) && c.length < 28).slice(0, 2);
        if (cl.length) p += '.' + cl.map(esc).join('.');
        const par = n.parentElement;
        if (par) { const same = [...par.children].filter((c) => c.localName === n.localName); const alike = cl.length ? same.filter((c) => cl.every((k) => c.classList.contains(k))) : same; if (alike.length > 1) p += `:nth-of-type(${same.indexOf(n) + 1})`; }
        parts.unshift(p);
        try { const s = parts.join(' > '), m = D.querySelectorAll(s); if (m.length === 1 && m[0] === e) return s; } catch { /* sélecteur refusé : on continue à remonter */ }
      }
      return parts.join(' > ');
    }
    const sig = (e) => e.localName + [...e.classList].filter((c) => !VOLATILE.test(c)).slice(0, 3).map((c) => '.' + c).join('');
    const txt = (e, n = 80) => String((e.innerText ?? e.textContent ?? '') || e.value || e.getAttribute?.('aria-label') || e.getAttribute?.('alt') || e.getAttribute?.('title') || '').replace(/\s+/g, ' ').trim().slice(0, n);
    const rnd = (x) => Math.round(x * 10) / 10;
    function add(type, gravite, e, mesure, valeurs, extra) {
      if (!e || e.nodeType !== 1 || ignore(e)) return null;
      let q = e.getAttribute('data-q'); if (!q) { q = String(++qn); e.setAttribute('data-q', q); }
      const r = rect(e);
      const d = Object.assign({ type, gravite, selecteur: sel(e), texte: txt(e), mesure, valeurs: valeurs || {}, rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, q: Number(q), groupe: type + '|' + sig(e) }, extra || {});
      out.push(d); return d;
    }

    // Couleurs : n'importe quelle écriture CSS (rgb, color(srgb …), color-mix déjà calculé…) → [r, v, b, alpha]
    const cv = D.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
    const colC = new Map();
    function col(str) {
      let c = colC.get(str); if (c) return c;
      const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(str || '');
      if (m) c = [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4])];
      else if (!str || str === 'transparent' || str === 'none') c = [0, 0, 0, 0];
      else { cx.clearRect(0, 0, 1, 1); cx.fillStyle = 'rgba(0,0,0,0)'; cx.fillStyle = str; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; c = [d[0], d[1], d[2], d[3] / 255]; }
      colC.set(str, c); return c;
    }
    const alpha = (str) => col(str)[3];
    const over = (c, b) => { const a = c[3] === undefined ? 1 : c[3]; return [c[0] * a + b[0] * (1 - a), c[1] * a + b[1] * (1 - a), c[2] * a + b[2] * (1 - a)]; };
    const mixc = (a, b, k) => [a[0] * k + b[0] * (1 - k), a[1] * k + b[1] * (1 - k), a[2] * k + b[2] * (1 - k)];
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const hex = (c) => '#' + [0, 1, 2].map((i) => Math.round(Math.max(0, Math.min(255, c[i]))).toString(16).padStart(2, '0')).join('');

    // ------------------------------------------------------------------ Les éléments affichés
    const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'META', 'LINK', 'TITLE', 'BR', 'WBR', 'OPTION', 'OPTGROUP', 'SOURCE', 'TRACK', 'DATALIST']);
    const FEUILLE = new Set(['svg', 'select', 'textarea', 'canvas', 'video', 'iframe', 'math', 'img', 'input', 'progress', 'meter', 'audio', 'object', 'embed']);
    const ATOME = new Set(['img', 'svg', 'canvas', 'video', 'iframe', 'input', 'select', 'textarea', 'button', 'progress', 'meter']);
    const root = (o.racine && D.querySelector(o.racine)) || B;
    const els = [], meta = new WeakMap();
    /** Caché exprès pour les lecteurs d'écran (1 px, clip) : on ne le mesure pas. */
    const estSr = (e, s) => { if (s.clip && s.clip !== 'auto') return true; if (/inset\(50%\)/.test(s.clipPath || '')) return true; if (s.position === 'absolute' && s.overflowX !== 'visible') { const r = rect(e); if (r.width <= 2 && r.height <= 2) return true; } return false; };
    (function rec(n, ctx) {
      for (const c of n.children) {
        if (SKIP.has(c.tagName)) continue;
        if (c.id === '__q_cadre' || c.hasAttribute('data-q-outil')) continue;
        if (c.checkVisibility && !c.checkVisibility()) continue;                      // display:none
        const s = cs(c);
        if (Number(s.opacity) < 0.05) continue;                                       // invisible, enfants compris
        const pos = s.position;
        const m = { fix: pos === 'fixed' ? c : ctx.fix, colle: pos === 'sticky' ? c : ctx.colle, sr: ctx.sr || estSr(c, s), abs: pos === 'absolute' || pos === 'fixed' ? c : null, op: ctx.op * Number(s.opacity), ptr: s.pointerEvents !== 'none' };
        meta.set(c, m);
        if (s.visibility === 'visible' && !m.sr) els.push(c);
        if (FEUILLE.has(c.localName)) continue;
        rec(c, m);
      }
    })(root, { fix: null, colle: null, sr: false, op: 1 });
    const M = (e) => meta.get(e) || { fix: null, colle: null, sr: false, abs: null, op: 1, ptr: true };

    // ------------------------------------------------------------------ Lignes de texte
    /** Les lignes (boîtes) d'un nœud de texte, à l'écran. */
    function lignes(node) {
      const rg = D.createRange(); rg.selectNodeContents(node); const ls = [];
      for (const r of rg.getClientRects()) {
        if (r.width < 0.5 || r.height < 0.5) continue;
        const last = ls[ls.length - 1];
        if (last && Math.abs(last.t - r.top) < Math.max(2, r.height / 2)) { last.l = Math.min(last.l, r.left); last.r = Math.max(last.r, r.right); last.b = Math.max(last.b, r.bottom); last.t = Math.min(last.t, r.top); }
        else ls.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
      }
      return ls;
    }
    const groupes = [];   // un nœud de texte : { el, node, ls: [lignes], fs }
    for (const el of els) {
      if (FEUILLE.has(el.localName)) continue;
      const fs = parseFloat(cs(el).fontSize) || 0;
      if (fs < 1) continue;
      for (const n of el.childNodes) if (n.nodeType === 3 && /\S/.test(n.data)) { const ls = lignes(n); if (ls.length) groupes.push({ el, node: n, ls, fs }); }
    }

    // ------------------------------------------------------------------ Boîtes qui coupent ou qui défilent
    const chC = new WeakMap();
    /** Les ancêtres dont le débordement n'est pas « visible » (ils coupent ou font défiler), du plus proche au plus lointain. */
    function chaine(el) {
      let c = chC.get(el); if (c) return c; c = [];
      let n = el, pos = cs(el).position;
      for (;;) {
        // Un élément « absolute » n'est coupé que par sa boîte de référence (et au-dessus) ; un « fixed » par personne.
        const p = pos === 'fixed' || pos === 'absolute' ? n.offsetParent : n.parentElement;
        if (!p || p === B || p === DE) break;
        const s = cs(p);
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible') c.push({ el: p, ox: s.overflowX, oy: s.overflowY });
        n = p; pos = s.position;
      }
      chC.set(el, c); return c;
    }
    const pbox = (p) => { const r = rect(p), l = r.left + p.clientLeft, t = r.top + p.clientTop; return { l, t, r: l + p.clientWidth, b: t + p.clientHeight }; };
    const defile = (v) => v === 'auto' || v === 'scroll';
    /**
     * Passe la boîte `r0` d'un élément au travers de ses ancêtres : ce qui en reste visible (`r`, null si rien),
     * les coupes franches (`coupes` : par qui, sur quel axe, de combien), et si une partie s'atteint en faisant défiler.
     * `soi` : pour un texte, l'élément lui-même peut le couper.
     */
    function couper(el, r0, soi) {
      const r = { l: r0.l, t: r0.t, r: r0.r, b: r0.b }, coupes = []; let defX = null, defY = null, cache = null;
      let liste = chaine(el);
      if (soi) { const s = cs(el); if (s.overflowX !== 'visible' || s.overflowY !== 'visible') liste = [{ el, ox: s.overflowX, oy: s.overflowY }].concat(liste); }
      for (const c of liste) {
        const b = pbox(c.el);
        if (c.ox !== 'visible') {
          const dl = b.l - r.l, dr = r.r - b.r;
          if (dl > EPS || dr > EPS) {
            if (defile(c.ox)) defX = defX || c.el;
            else if (r.r <= b.l + 0.5 || r.l >= b.r - 0.5) cache = cache || c.el;
            else coupes.push({ par: c.el, axe: 'x', px: Math.max(dl, dr), cote: dr >= dl ? 'à droite' : 'à gauche' });
          }
          r.l = Math.max(r.l, b.l); r.r = Math.min(r.r, b.r);
        }
        if (c.oy !== 'visible') {
          const dt = b.t - r.t, db = r.b - b.b;
          if (dt > EPS || db > EPS) {
            if (defile(c.oy)) defY = defY || c.el;
            else if (r.b <= b.t + 0.5 || r.t >= b.b - 0.5) cache = cache || c.el;
            else coupes.push({ par: c.el, axe: 'y', px: Math.max(dt, db), cote: db >= dt ? 'en bas' : 'en haut' });
          }
          r.t = Math.max(r.t, b.t); r.b = Math.min(r.b, b.b);
        }
        if (r.r - r.l <= 0.5 || r.b - r.t <= 0.5) return { r: null, coupes, defX, defY, cache: cache || c.el };
      }
      return { r, coupes, defX, defY, cache };
    }
    /** A-t-il un contour ou un fond visible (carte, bouton, champ…) ? */
    const boiteC = new WeakMap();
    function estBoite(e) {
      let v = boiteC.get(e); if (v !== undefined) return v;
      const s = cs(e); v = false;
      if (s.display !== 'inline' && s.display !== 'contents') {
        if (alpha(s.backgroundColor) > 0.05 || s.backgroundImage !== 'none' || s.boxShadow !== 'none') v = true;
        else for (const k of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(s['border' + k + 'Width']) > 0 && s['border' + k + 'Style'] !== 'none' && alpha(s['border' + k + 'Color']) > 0.05) { v = true; break; }
      }
      boiteC.set(e, v); return v;
    }

    // La page elle-même défile-t-elle ? (html/body : le débordement du body vaut pour la fenêtre)
    const sDE = cs(DE), sB = cs(B);
    const pageOx = sDE.overflowX !== 'visible' ? sDE.overflowX : sB.overflowX, pageOy = sDE.overflowY !== 'visible' ? sDE.overflowY : sB.overflowY;
    const pageLarge = Math.max(DE.scrollWidth, B.scrollWidth), pageHaute = Math.max(DE.scrollHeight, B.scrollHeight);
    const limiteX = Math.min(W, DE.clientWidth || W);
    const pageDefileX = pageLarge > limiteX + 1 && pageOx !== 'hidden' && pageOx !== 'clip';
    const pageDefileY = pageHaute > DE.clientHeight + 1 && pageOy !== 'hidden' && pageOy !== 'clip';

    // ------------------------------------------------------------------ 1 à 3. Hors de l'écran, coupé par sa boîte, hors de sa boîte
    const dejaCoupe = [], dejaHors = [], dejaBoite = [];
    const contient = (liste, el, par, axe) => liste.some((f) => f.par === par && f.axe === axe && (f.el === el || f.el.contains(el)));
    const tronqueX = (p) => cs(p).textOverflow === 'ellipsis';
    const tronqueY = (p) => { const s = cs(p), a = s.webkitLineClamp, b = s.lineClamp; return Boolean((a && a !== 'none') || (b && b !== 'none')); };
    function signalerCoupe(el, c, quoi, fs, r0) {
      if (contient(dejaCoupe, el, c.par, c.axe)) return;
      const px = Math.round(c.px), par = sel(c.par);
      if ((c.axe === 'x' && tronqueX(c.par)) || (c.axe === 'y' && tronqueY(c.par))) {
        // Troncature voulue (« … ») : un simple signalement, sauf si presque tout le texte est caché.
        dejaCoupe.push({ el, par: c.par, axe: c.axe });
        const tot = c.axe === 'x' ? r0.r - r0.l : r0.b - r0.t;
        add('texte-tronque', px > tot * 0.5 ? 'mineur' : 'info', el, `texte tronqué par « … » : ${px} px cachés sur ${Math.round(tot)}`, { cache: px, total: Math.round(tot), par });
        return;
      }
      if (c.axe === 'y' && !fs) return;    // une image ou une carte rognée en hauteur est le plus souvent voulue
      // Pour un texte, la boîte de ligne est plus haute que les lettres : on tolère la marge au-dessus et au-dessous.
      if (c.px <= (fs && c.axe === 'y' ? Math.max(3, fs * 0.22) : 2)) return;
      dejaCoupe.push({ el, par: c.par, axe: c.axe });
      const grave = c.axe === 'x' ? c.px >= 12 : c.px >= (r0.b - r0.t) * 0.45;
      add('coupe', grave ? 'grave' : c.px >= 5 ? 'moyen' : 'mineur', el, `${quoi} coupé ${c.cote} par sa boîte : ${px} px invisibles (boîte ${par})`, { px, axe: c.axe, par }, { groupe: `coupe|${c.axe}|${sig(el)}|${sig(c.par)}` });
    }
    function horsEcran(el, v, quoi, fixe) {
      // v : la partie visible après les boîtes ; reste la fenêtre.
      const dx = Math.max(v.r - limiteX, -v.l), dy = Math.max(v.b - H, -v.t);
      if (dx > EPS) {
        if (v.l >= limiteX - 0.5 || v.r <= 0.5) return;                  // entièrement dehors : tiroir rangé, élément en attente
        if (contient(dejaHors, el, null, 'x')) return;
        dejaHors.push({ el, par: null, axe: 'x' });
        const px = Math.round(dx), cote = v.r - limiteX >= -v.l ? 'à droite' : 'à gauche';
        if (pageDefileX && !fixe && cote === 'à droite') add('defilement-horizontal', 'grave', el, `${quoi} dépasse de l'écran de ${px} px ${cote} : la page défile de côté`, { px, page: pageLarge, ecran: limiteX });
        else add('hors-ecran', px >= 8 ? 'grave' : 'moyen', el, `${quoi} sort de l'écran de ${px} px ${cote} (impossible à atteindre)`, { px, axe: 'x' });
        return;
      }
      if (dy > EPS && (fixe || !pageDefileY)) {
        if (v.t >= H - 0.5 || v.b <= 0.5) return;
        if (contient(dejaHors, el, null, 'y')) return;
        dejaHors.push({ el, par: null, axe: 'y' });
        const px = Math.round(dy), cote = v.b - H >= -v.t ? 'en bas' : 'en haut';
        add('hors-ecran', px >= 8 ? 'grave' : 'moyen', el, `${quoi} sort de l'écran de ${px} px ${cote}${fixe ? ' (élément fixe : on ne peut pas le faire défiler)' : ' (la page ne défile pas)'}`, { px, axe: 'y' });
      }
    }
    /** La première boîte visible (carte, bouton…) en remontant, sauf si on croise un élément placé exprès (absolute, transformé) ou qui coupe. */
    function boiteDepuis(n) {
      for (; n && n !== B && n !== DE; n = n.parentElement) {
        if (estBoite(n)) return n;
        const s = cs(n);
        if (s.position === 'absolute' || s.position === 'fixed' || s.transform !== 'none') return null;
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible') return null;
      }
      return null;
    }
    /** Un texte ou un élément (bouton, image, champ) qui dépasse de la boîte qui le contient, sans être coupé. */
    function horsBoite(el, v, quoi, fs) {
      const s = cs(el); let bx;
      if (fs && estBoite(el)) bx = el;                                    // un texte dans sa propre boîte (bouton, pastille…)
      else { if (M(el).abs || s.transform !== 'none' || s.float !== 'none') return; bx = boiteDepuis(fs ? el : el.parentElement); }
      if (!bx) return;
      const b = R(bx), meme = bx === el;
      const ml = !meme && parseFloat(s.marginLeft) < 0, mr = !meme && parseFloat(s.marginRight) < 0, mt = !meme && parseFloat(s.marginTop) < 0, mb = !meme && parseFloat(s.marginBottom) < 0;
      const dx = Math.max(mr ? 0 : v.r - b.r, ml ? 0 : b.l - v.l), dy = Math.max(mb ? 0 : v.b - b.b, mt ? 0 : b.t - v.t);
      const k = dx > 2 ? 'x' : dy > (fs ? Math.max(3, fs * 0.25) : 3) ? 'y' : '';
      if (!k) return;
      if (dejaBoite.some((x) => x === el || x.contains(el))) return;
      dejaBoite.push(el);
      const px = Math.round(k === 'x' ? dx : dy), cote = k === 'x' ? (v.r - b.r >= b.l - v.l ? 'à droite' : 'à gauche') : (v.b - b.b >= b.t - v.t ? 'en bas' : 'en haut');
      add('hors-boite', px >= 10 ? 'grave' : px >= 4 ? 'moyen' : 'mineur', el, `${quoi} sort de sa boîte de ${px} px ${cote} (boîte ${sel(bx)})`, { px, axe: k, boite: sel(bx) }, { groupe: `hors-boite|${k}|${sig(el)}|${sig(bx)}` });
    }
    for (const el of els) {
      if (ignore(el)) continue;
      const m = M(el), tag = el.localName, atome = ATOME.has(tag);
      if (!atome && !estBoite(el)) continue;
      const r0 = R(el);
      if (r0.r - r0.l < 0.5 || r0.b - r0.t < 0.5) continue;
      const quoi = tag === 'img' ? 'image' : tag === 'svg' ? 'dessin' : tag === 'button' ? 'bouton' : tag === 'input' || tag === 'select' || tag === 'textarea' ? 'champ' : tag === 'table' ? 'tableau' : 'bloc';
      const c = couper(el, r0, false);
      for (const k of c.coupes) signalerCoupe(el, k, quoi, 0, r0);
      if (c.r && !c.defX) horsEcran(el, c.r, quoi, Boolean(m.fix));
      if (c.r && atome && !c.coupes.length) horsBoite(el, c.r, quoi, 0);
    }
    for (const g of groupes) {
      const el = g.el; if (ignore(el)) continue;
      const m = M(el);
      let cachees = 0, vues = 0, parY = null;
      for (const L of g.ls) {
        const c = couper(el, L, true);
        for (const k of c.coupes) signalerCoupe(el, k, 'texte', g.fs, L);
        if (!c.r) { if (c.cache && !c.defY && !c.defX) { cachees++; parY = c.cache; } continue; }
        vues++;
        if (!c.defX) horsEcran(el, c.r, 'texte', Boolean(m.fix));
        if (!c.coupes.length) horsBoite(el, c.r, 'texte', g.fs);
      }
      // Des lignes du même texte visibles et d'autres cachées sans « … » : le texte est coupé en hauteur.
      if (cachees && vues && parY && !tronqueY(parY) && !contient(dejaCoupe, el, parY, 'y')) { dejaCoupe.push({ el, par: parY, axe: 'y' }); add('coupe', 'moyen', el, `texte coupé en hauteur : ${cachees} ligne(s) cachée(s) sur ${cachees + vues} (boîte ${sel(parY)})`, { lignesCachees: cachees, lignes: cachees + vues, par: sel(parY) }, { groupe: `coupe|y|${sig(el)}|${sig(parY)}` }); }
    }

    // Le plus grand défileur vertical visible (ou la page) : c'est « la page » pour l'utilisateur ; on le parcourra
    // aussi pour tester ce qui est sous le pli.
    let scroller = null, aire = 0;
    for (const el of els) { const s = cs(el); if (!defile(s.overflowY) || el.scrollHeight <= el.clientHeight + 8) continue; const a = el.clientWidth * el.clientHeight; if (a > aire) { aire = a; scroller = el; } }
    if (pageDefileY && W * H > aire * 1.5) scroller = D.scrollingElement || DE;
    const scrollerPage = scroller && (scroller === DE || scroller === D.scrollingElement || scroller === B);

    // ------------------------------------------------------------------ Défilement horizontal (page et zones)
    if (pageDefileX && !out.some((d) => d.type === 'defilement-horizontal')) add('defilement-horizontal', 'grave', B, `la page défile de côté : ${pageLarge} px de contenu pour ${limiteX} px d'écran`, { px: pageLarge - limiteX, page: pageLarge, ecran: limiteX });
    let zones = 0;
    for (const el of els) {
      const s = cs(el);
      if (!defile(s.overflowX) || el.scrollWidth <= el.clientWidth + 1) continue;
      if (ignore(el)) continue;
      zones++;
      const px = el.scrollWidth - el.clientWidth, principal = el === scroller || (defile(s.overflowY) && el.scrollHeight > el.clientHeight + 8 && el.clientHeight >= H * 0.5 && el.clientWidth >= W * 0.6);
      if (principal) {
        // La zone principale de la page défile de côté : on cherche qui la pousse.
        const b = pbox(el); let qui = null, max = 0;
        for (const c of el.querySelectorAll('*')) { if (!meta.has(c) || M(c).abs) continue; const r = rect(c); if (r.width < 1 || r.right - b.r <= max) continue; const cc = couper(c, R(c), false); if (cc.defX === el && !cc.coupes.length) { max = r.right - b.r; qui = c; } }
        add('defilement-horizontal', 'grave', qui || el, `la page défile de côté : ${el.scrollWidth} px de contenu pour ${el.clientWidth} px visibles${qui ? ' (poussée par cet élément)' : ''}`, { px, zone: sel(el) });
      } else add('zone-defile', tactile && el.localName !== 'pre' ? 'mineur' : 'info', el, `à faire défiler de côté : ${el.scrollWidth} px de contenu pour ${el.clientWidth} px visibles`, { px, contenu: el.scrollWidth, visible: el.clientWidth });
    }
    // Planche de maquette : rien ne doit dépasser du cadre annoncé.
    if (o.cadre) {
      const cw = o.cadre.w || W, chh = o.cadre.h || 0;
      if (pageLarge > cw + 1 && !out.some((d) => d.type === 'defilement-horizontal')) add('hors-planche', 'grave', B, `le contenu dépasse la planche en largeur : ${pageLarge} px pour ${cw}`, { px: pageLarge - cw });
      if (chh && pageHaute > chh + 1) {
        let qui = null, max = chh;
        for (const el of els) { const r = rect(el), y = r.bottom + scrollY; if (y > max + 1 && r.height < chh) { const c = couper(el, R(el), false); if (c.r) { max = y; qui = el; } } }
        add('hors-planche', 'grave', qui || B, `le contenu dépasse la planche en hauteur : ${pageHaute} px pour ${chh}`, { px: pageHaute - chh });
      }
    }

    // ------------------------------------------------------------------ 4. Texte recouvert (autre élément, élément fixe)
    const opC = new WeakMap();
    const opEff = (e) => { let v = opC.get(e); if (v === undefined) { if (meta.has(e)) v = M(e).op; else { v = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) v *= Number(cs(n).opacity); } opC.set(e, v); } return v; };
    /** Cet élément peint-il quelque chose à ce point (fond, image, texte) ? */
    function peint(S, x, y) {
      if (opEff(S) < 0.4) return false;
      if (S.namespaceURI === SVGNS) return S.localName !== 'svg';
      const tag = S.localName;
      if (tag === 'img' || tag === 'video' || tag === 'canvas' || tag === 'iframe') return true;
      const s = cs(S);
      if (alpha(s.backgroundColor) >= 0.5 || s.backgroundImage !== 'none') return true;
      for (const n of S.childNodes) if (n.nodeType === 3 && /\S/.test(n.data)) for (const L of lignes(n)) if (x >= L.l && x <= L.r && y >= L.t && y <= L.b) return true;
      return false;
    }
    function auDessus(el, x, y) {
      for (const S of D.elementsFromPoint(x, y)) {
        if (S === el || el.contains(S) || S.contains(el)) return null;
        if (S.id === '__q_cadre') continue;
        if (!peint(S, x, y)) continue;
        return S;
      }
      return null;
    }
    function racineFixe(S) { for (let n = S; n && n.nodeType === 1; n = n.parentElement) { const p = cs(n).position; if (p === 'fixed') return { el: n, colle: false }; if (p === 'sticky') return { el: n, colle: true }; } return null; }
    const estModale = (e) => { if (e.closest('dialog[open],[aria-modal=true],[role=dialog]')) return true; const r = rect(e); return r.width * r.height >= W * H * 0.5; };
    const typeFixe = (f) => { const r = rect(f.el); if (f.colle) return 'barre'; if (r.width >= W * 0.8 && (r.top <= 2 || r.bottom >= H - 2)) return r.top <= 2 && r.bottom < H / 2 ? 'barre-haut' : 'barre-bas'; return 'flottant'; };
    const etat = new Map();   // « groupe:ligne » → { clair, couv: Map(élément au-dessus → { n, passes }) , el }
    function passe(k, mesurer) {
      groupes.forEach((g, gi) => {
        if (ignore(g.el) || !M(g.el).ptr) return;
        const ls = mesurer && (scrollerPage || scroller.contains(g.el)) ? lignes(g.node) : g.ls;
        ls.forEach((L, li) => {
          const c = couper(g.el, L, true); if (!c.r) return;
          const v = { l: Math.max(c.r.l, 0), t: Math.max(c.r.t, 0), r: Math.min(c.r.r, W), b: Math.min(c.r.b, H) };
          if (v.r - v.l < 4 || v.b - v.t < 4) return;
          const y = (v.t + v.b) / 2; let n = 0, qui = null;
          for (const f of [0.2, 0.5, 0.8]) { const S = auDessus(g.el, v.l + (v.r - v.l) * f, y); if (S) { n++; qui = qui || S; } }
          const key = gi + ':' + li; let e = etat.get(key); if (!e) { e = { clair: false, couv: new Map(), el: g.el }; etat.set(key, e); }
          if (!n) { e.clair = true; return; }
          let cc = e.couv.get(qui); if (!cc) { cc = { n: 0, passes: new Set() }; e.couv.set(qui, cc); }
          cc.n = Math.max(cc.n, n); cc.passes.add(k);
        });
      });
    }
    let passes = 1, derniere = 0, vueFin = null, vueDebut = null;
    passe(0, false);
    if (scroller && o.defiler) {
      const top0 = scroller.scrollTop, max = scroller.scrollHeight - scroller.clientHeight, pas = Math.max(120, scroller.clientHeight * 0.7);
      const pos = []; for (let p = top0 + pas; p < max && pos.length < 12; p += pas) pos.push(p); if (max > top0 + 1) pos.push(max);
      for (const p of pos) { scroller.scrollTop = p; passe(passes, true); derniere = passes; passes++; }
      const ss = scrollerPage ? '' : sel(scroller);
      vueFin = { sel: ss, fin: max }; vueDebut = { sel: ss, fin: top0 };
      scroller.scrollTop = top0;
    }
    const couvreurs = new Map();   // élément qui couvre → { fixe, type, textes: [{el, n, fin}] }
    for (const e of etat.values()) for (const [S, cc] of e.couv) {
      const f = racineFixe(S), me = M(e.el), memeFixe = f && (f.el === me.fix || f.el === me.colle);
      if (f && !memeFixe) {
        if (estModale(f.el)) continue;
        if (dessus && f.el.matches(dessus)) continue;     // un panneau ouvert exprès (menu, petite fenêtre) a le droit de couvrir la page
        const type = typeFixe(f);
        // Sous une barre, le contenu qui défile passe normalement : seul compte ce qui ne peut jamais en sortir.
        if (type === 'barre-bas' && (e.clair || !cc.passes.has(derniere))) continue;
        if ((type === 'barre-haut' || type === 'barre') && (e.clair || !cc.passes.has(0))) continue;
        if (type === 'flottant' && !cc.passes.has(0)) continue;
        let c = couvreurs.get(f.el); if (!c) { c = { fixe: true, type, textes: [] }; couvreurs.set(f.el, c); }
        c.textes.push({ el: e.el, n: cc.n, fin: cc.passes.has(derniere) && !cc.passes.has(0) });
      } else {
        // Recouvert par un élément ordinaire : on remonte à l'élément le plus haut qui n'est pas un ancêtre du texte.
        let top = S; while (top.parentElement && !top.parentElement.contains(e.el)) top = top.parentElement;
        let c = couvreurs.get(top); if (!c) { c = { fixe: false, type: 'contenu', textes: [] }; couvreurs.set(top, c); }
        c.textes.push({ el: e.el, n: cc.n, fin: !cc.passes.has(0) });
      }
    }
    const INTERACTIF = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=link],[role=checkbox],[role=switch],[role=menuitem],[tabindex]:not([tabindex="-1"])';
    for (const [C, c] of couvreurs) {
      const uniq = [...new Map(c.textes.map((t) => [t.el, t])).values()];
      const premier = uniq[0].el, important = uniq.some((t) => t.el.closest(INTERACTIF + ',h1,h2,h3'));
      const ex = uniq.slice(0, 3).map((t) => `« ${txt(t.el, 40)} »`).join(', ');
      if (c.fixe) {
        const nom = c.type === 'flottant' ? 'un élément flottant' : c.type === 'barre-bas' ? 'la barre du bas' : 'une barre fixe';
        const quand = c.type === 'flottant' ? 'à l\'ouverture de la page' : c.type === 'barre-bas' ? 'même tout en bas de la page' : 'même tout en haut de la page';
        add('sous-fixe', c.type !== 'flottant' || important ? 'grave' : 'moyen', C, `${uniq.length} texte(s) sous ${nom} ${quand} : ${ex}`, { textes: uniq.length, dessous: sel(premier), sorte: c.type }, { dessous: sel(premier), vue: uniq[0].fin ? vueFin : vueDebut, groupe: 'sous-fixe|' + sig(C) });
      } else add('recouvert', important || uniq.length > 2 ? 'grave' : 'moyen', premier, `texte recouvert par un autre élément (${sel(C)}) : ${ex}`, { textes: uniq.length, par: sel(C) }, { dessous: sel(C), groupe: 'recouvert|' + sig(C) });
    }

    // ------------------------------------------------------------------ 5. Éléments cliquables qui se chevauchent
    const inter = [];
    for (const el of els) {
      if (!el.matches(INTERACTIF) || ignore(el) || !M(el).ptr || el.disabled) continue;
      const c = couper(el, R(el), false); if (!c.r) continue;
      if (c.r.r <= 0 || c.r.l >= W) continue;
      if (M(el).fix && (c.r.b <= 0 || c.r.t >= H)) continue;       // tiroir fixe rangé hors de l'écran
      inter.push({ el, r: c.r, fix: M(el).fix });
    }
    const lie = (a, b) => a.contains(b) || b.contains(a) || (a.localName === 'label' && a.control === b) || (b.localName === 'label' && b.control === a) || Boolean(a.labels && [...a.labels].includes(b)) || Boolean(b.labels && [...b.labels].includes(a));
    const vusCh = new Set();
    for (let i = 0; i < inter.length; i++) for (let j = i + 1; j < inter.length; j++) {
      const a = inter[i], b = inter[j];
      if (a.fix !== b.fix) continue;
      const w = Math.min(a.r.r, b.r.r) - Math.max(a.r.l, b.r.l), h = Math.min(a.r.b, b.r.b) - Math.max(a.r.t, b.r.t);
      if (w < 4 || h < 4) continue;
      if (lie(a.el, b.el)) continue;
      const pa = (a.r.r - a.r.l) * (a.r.b - a.r.t), pb = (b.r.r - b.r.l) * (b.r.b - b.r.t), petit = pa <= pb ? a : b, grand = pa <= pb ? b : a, part = (w * h) / Math.max(1, Math.min(pa, pb));
      if (part < 0.15 && (w < 8 || h < 8)) continue;
      // Les deux sont-ils vraiment là, l'un sur l'autre ? (pas dans deux panneaux dont un seul est affiché)
      const x = (petit.r.l + petit.r.r) / 2, y = (petit.r.t + petit.r.b) / 2, dansVue = x >= 0 && x <= W && y >= 0 && y <= H;
      let dessus = null;
      if (dansVue) { const st = D.elementsFromPoint(x, y), ip = st.findIndex((s) => s === petit.el || petit.el.contains(s)), ig = st.findIndex((s) => s === grand.el || grand.el.contains(s)); if (ip < 0 && ig < 0) continue; dessus = ip >= 0 && (ig < 0 || ip < ig) ? petit : grand; }
      // Un petit bouton posé exprès dans une grande zone cliquable (fermer une carte) : il reste atteignable, ce n'est pas un défaut.
      if (part > 0.9 && (!dansVue || dessus === petit)) continue;
      if (vusCh.has(a.el) && vusCh.has(b.el)) continue; vusCh.add(a.el); vusCh.add(b.el);
      add('chevauchement', part >= 0.3 ? 'grave' : 'moyen', petit.el, `deux éléments cliquables se chevauchent sur ${Math.round(w)} × ${Math.round(h)} px (${Math.round(part * 100)} % du plus petit) : « ${txt(petit.el, 30)} » et « ${txt(grand.el, 30)} »`, { largeur: Math.round(w), hauteur: Math.round(h), part: rnd(part), avec: sel(grand.el) }, { dessous: sel(grand.el) });
    }

    // ------------------------------------------------------------------ 6. Rangées d'onglets
    const ONGLET = '[role=tab],[aria-selected],button[aria-pressed],a[aria-current],button[aria-current]';
    const rangs = new Set(D.querySelectorAll('[role=tablist]' + (o.onglets ? ',' + o.onglets : '')));
    for (const el of els) {
      const c = typeof el.className === 'string' ? el.className : '';
      if (/(^|[\s_-])(tabs|onglets|seg|bnav|snav|ntabs)($|[\s_-])/i.test(c)) rangs.add(el);
      // Des boutons « onglet » sans rôle déclaré : leur parent est la rangée.
      if (/(^|[\s_-])(tab|onglet)($|\s)/i.test(c) && el.matches('[aria-pressed],[aria-selected],[role=tab]') && el.parentElement) rangs.add(el.parentElement);
    }
    for (const tl of rangs) {
      if (!meta.has(tl) || ignore(tl)) continue;
      let tabs = [...tl.querySelectorAll(ONGLET)].filter((t) => meta.has(t) && rect(t).width > 0);
      if (tabs.length < 2) tabs = [...tl.children].filter((t) => meta.has(t) && t.matches('button,a,[role=tab],label') && rect(t).width > 0);
      if (tabs.length < 2) continue;
      const s = cs(tl), enColonne = /column/.test(s.flexDirection) && /flex/.test(s.display);
      const rs = tabs.map((t) => rect(t)), lg = [];
      for (const r of rs) { const m = (r.top + r.bottom) / 2; if (!lg.some((y) => Math.abs(y - m) < r.height * 0.5)) lg.push(m); }
      const role = tl.getAttribute('role') === 'tablist' || /tab|onglet/i.test(String(tl.className)) || tabs.some((t) => /tab|onglet/i.test(String(t.className)));
      const nom = role ? 'rangée d\'onglets' : 'rangée de choix', liste = tabs.map((t) => txt(t, 18)).join(' · ');
      if (!enColonne && lg.length > 1 && lg.length < tabs.length) add('onglets-lignes', role ? 'grave' : 'moyen', tl, `${nom} sur ${lg.length} lignes (${tabs.length} onglets : ${liste})`, { lignes: lg.length, onglets: tabs.length, largeur: Math.round(rect(tl).width) });
      else if (!enColonne && lg.length > 1 && tabs.length <= 6 && /flex|grid/.test(s.display) && rs[0].width < rect(tl).width * 0.9) add('onglets-lignes', role ? 'grave' : 'moyen', tl, `${nom} empilée : un onglet par ligne (${tabs.length} onglets : ${liste})`, { lignes: lg.length, onglets: tabs.length, largeur: Math.round(rect(tl).width) });
      if (tl.scrollWidth > tl.clientWidth + 1 && s.overflowX !== 'visible') {
        const px = tl.scrollWidth - tl.clientWidth, q = Number(tl.getAttribute('data-q'));
        // Remplace le simple signalement « à faire défiler » : pour des onglets, c'est un défaut.
        for (let i = out.length - 1; i >= 0; i--) if (out[i].type === 'zone-defile' && out[i].q === q) out.splice(i, 1);
        add('onglets-coupes', !defile(s.overflowX) ? 'grave' : tabs.length > 6 ? 'mineur' : 'moyen', tl, `les onglets ne tiennent pas dans la largeur : ${px} px ${defile(s.overflowX) ? 'à faire défiler' : 'invisibles'} (${liste})`, { px, onglets: tabs.length, largeur: tl.clientWidth });
      }
    }

    // ------------------------------------------------------------------ 7. Libellé de bouton sur 3 lignes ou plus
    for (const el of els) {
      if (!el.matches('button,a.btn,.btn,[role=button],[role=tab],input[type=submit],input[type=button]') || ignore(el)) continue;
      // Une tuile cliquable (titre + description) n'est pas un bouton à libellé : on ne compte que le texte d'un seul tenant.
      let max = 0, nb = 0; const tailles = new Set(), w = D.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) { if (!/\S/.test(n.data) || !n.parentElement || (n.parentElement !== el && !meta.has(n.parentElement))) continue; nb++; tailles.add(cs(n.parentElement).fontSize); max = Math.max(max, lignes(n).length); }
      if (max >= 3 && tailles.size === 1 && nb <= 2) add('bouton-3-lignes', 'moyen', el, `libellé de bouton sur ${max} lignes : « ${txt(el, 60)} »`, { lignes: max, largeur: Math.round(rect(el).width) });
    }

    // ------------------------------------------------------------------ 8. Cibles tactiles (téléphone)
    if (tactile) for (const it of inter) {
      const el = it.el, s = cs(el);
      if (el.localName === 'a' && s.display === 'inline' && [...el.parentElement.childNodes].some((n) => n.nodeType === 3 && /\S/.test(n.data))) continue;   // lien dans une phrase
      if (el.localName === 'label' && el.control) continue;
      let r = R(el);
      // Une case à cocher vaut par son libellé : c'est lui qu'on touche.
      const lab = (el.labels && el.labels[0]) || el.closest('label');
      if (lab && (el.type === 'checkbox' || el.type === 'radio' || el.type === 'file')) { const lr = R(lab); r = { l: Math.min(r.l, lr.l), t: Math.min(r.t, lr.t), r: Math.max(r.r, lr.r), b: Math.max(r.b, lr.b) }; }
      const w = r.r - r.l, h = r.b - r.t, m = Math.min(w, h);
      if (m >= o.cibleMin - 0.5 || w < 1 || h < 1) continue;
      add('cible-tactile', m < 24 ? 'moyen' : 'mineur', el, `cible tactile de ${Math.round(w)} × ${Math.round(h)} px (moins de ${o.cibleMin} px) : « ${txt(el, 40)} »`, { largeur: Math.round(w), hauteur: Math.round(h) });
    }

    // ------------------------------------------------------------------ 9. Images déformées
    for (const el of els) {
      const tag = el.localName; if (tag !== 'img' && tag !== 'canvas' && tag !== 'video') continue;
      if (ignore(el)) continue;
      const s = cs(el), bw = el.clientWidth, bh = el.clientHeight; if (bw < 8 || bh < 8) continue;
      let nw = 0, nh = 0;
      if (tag === 'img') { if (!el.complete || !el.naturalWidth) continue; if (/\.svg(\?|#|$)|^data:image\/svg/i.test(el.currentSrc || el.src || '')) continue; nw = el.naturalWidth; nh = el.naturalHeight; }
      else if (tag === 'canvas') { nw = el.width; nh = el.height; }
      else { nw = el.videoWidth; nh = el.videoHeight; }
      if (!nw || !nh) continue;
      if (tag !== 'canvas' && s.objectFit !== 'fill') continue;
      const pl = parseFloat(s.paddingLeft) + parseFloat(s.paddingRight), pt = parseFloat(s.paddingTop) + parseFloat(s.paddingBottom);
      const a = (bw - pl) / Math.max(1, bh - pt), n = nw / nh, ecart = Math.abs(a / n - 1);
      if (ecart > 0.04 && Math.abs((bw - pl) - (bh - pt) * n) > 2) add('image-deformee', ecart > 0.15 ? 'grave' : 'moyen', el, `${tag === 'canvas' ? 'dessin' : 'image'} déformé(e) de ${Math.round(ecart * 100)} % : affiché(e) en ${Math.round(bw - pl)} × ${Math.round(bh - pt)} px pour une forme d'origine ${nw} × ${nh}`, { ecart: rnd(ecart), affiche: `${Math.round(bw - pl)}x${Math.round(bh - pt)}`, origine: `${nw}x${nh}` });
    }

    // ------------------------------------------------------------------ Le décor du thème (image de fond de la page), redessiné pour le mesurer
    let decor = null;
    if (o.decor || o.contraste) try {
      const bi = sB.backgroundImage || '', m = /url\("?(data:image\/svg\+xml[^")]*)"?\)/.exec(bi);
      if (m) {
        const img = new Image(); img.src = m[1].replace(/\\"/g, '"'); await img.decode();
        const taille = (sB.backgroundSize.split(',')[0] || '').trim().split(/\s+/), hd = taille[1] && /px$/.test(taille[1]) ? parseFloat(taille[1]) : H * 0.4;
        const mk = () => { const c = D.createElement('canvas'); c.width = W; c.height = H; return c; };
        const g1 = mk().getContext('2d', { willReadFrequently: true }), g2 = mk().getContext('2d', { willReadFrequently: true });
        const stops = (bi.slice(Math.max(0, bi.indexOf('linear-gradient'))).match(/rgba?\([^)]*\)|color\([^)]*\)/gi) || []).map(col);
        for (const g of [g1, g2]) {
          if (stops.length >= 2) { const gr = g.createLinearGradient(0, 0, 0, H); stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), `rgba(${c[0]},${c[1]},${c[2]},${c[3]})`)); g.fillStyle = gr; } else g.fillStyle = stops.length ? `rgb(${stops[0][0]},${stops[0][1]},${stops[0][2]})` : sB.backgroundColor;
          g.fillRect(0, 0, W, H);
        }
        g2.drawImage(img, 0, H - hd, W, hd);
        const voile = getComputedStyle(B, '::before'); if (voile && voile.position === 'fixed' && alpha(voile.backgroundColor) > 0) for (const g of [g1, g2]) { g.fillStyle = voile.backgroundColor; g.fillRect(0, 0, W, H); }
        decor = { haut: H - hd, nu: g1.getImageData(0, 0, W, H).data, plein: g2.getImageData(0, 0, W, H).data };
      }
    } catch { decor = null; }
    /** Les couleurs du fond de page dans un rectangle : la plus sombre, la plus claire, la part couverte par le décor. */
    function fondPage(v, sansDecor) {
      if (!decor) return null;
      const x0 = Math.max(0, Math.floor(v.l)), x1 = Math.min(W - 1, Math.ceil(v.r)), y0 = Math.max(0, Math.floor(v.t)), y1 = Math.min(H - 1, Math.ceil(v.b));
      if (x1 <= x0 || y1 <= y0) return null;
      let sombre = null, clair = null, ls = 2, lc = -1, n = 0, sur = 0; const px = sansDecor ? decor.nu : decor.plein, nu = decor.nu, plein = decor.plein, pasX = Math.max(1, Math.floor((x1 - x0) / 60)), pasY = Math.max(1, Math.floor((y1 - y0) / 40));
      for (let y = y0; y <= y1; y += pasY) for (let x = x0; x <= x1; x += pasX) {
        const i = (y * W + x) * 4, c = [px[i], px[i + 1], px[i + 2]], l = lum(c); n++;
        if (Math.abs(plein[i] - nu[i]) + Math.abs(plein[i + 1] - nu[i + 1]) + Math.abs(plein[i + 2] - nu[i + 2]) > 24) sur++;
        if (l < ls) { ls = l; sombre = c; } if (l > lc) { lc = l; clair = c; }
      }
      return { sombre, clair, part: n ? sur / n : 0 };
    }

    // ------------------------------------------------------------------ 10. Contraste du texte (WCAG) et texte posé sur le décor
    const fondC = new WeakMap(), BLANC = { cols: [[255, 255, 255]], page: false, inconnu: false, couches: [] };
    /**
     * Ce qui est peint derrière le contenu d'un élément (son propre fond compris) : `cols` = couleurs possibles ;
     * `page` = c'est le fond de la page avec son décor (à lire au point voulu), sous les `couches` translucides ;
     * `inconnu` = une image dont on ne connaît pas les couleurs.
     */
    function fond(n) {
      if (!n || n.nodeType !== 1) return BLANC;
      let f = fondC.get(n); if (f) return f;
      const s = cs(n), c = col(s.backgroundColor), bi = s.backgroundImage;
      if (c[3] >= 0.995) f = { cols: [[c[0], c[1], c[2]]], page: false, inconnu: false, couches: [] };
      else { const d = n === DE ? BLANC : fond(n.parentElement); f = { cols: d.cols ? d.cols.map((b) => (c[3] > 0 ? over(c, b) : b)) : null, page: d.page, inconnu: d.inconnu, couches: c[3] > 0 && d.page ? d.couches.concat([c]) : d.couches }; }
      if (bi !== 'none') {
        if (/url\(/.test(bi)) f = n === B && decor ? { cols: null, page: true, inconnu: false, couches: [] } : { cols: null, page: false, inconnu: true, couches: [] };
        else {
          const st = (bi.match(/rgba?\([^)]*\)|color\([^)]*\)/g) || []).map(col).filter((x) => x[3] > 0);
          if (st.length && f.cols) { const base = f.cols, cols = []; for (const x of st.slice(0, 4)) for (const b of base.slice(0, 2)) cols.push(over(x, b)); f = { cols, page: false, inconnu: false, couches: [] }; }
          else if (st.length && st.every((x) => x[3] >= 0.9)) f = { cols: st.slice(0, 4).map((x) => [x[0], x[1], x[2]]), page: false, inconnu: false, couches: [] };
          else if (st.length && f.page) f = { cols: null, page: true, inconnu: false, couches: f.couches.concat([st[0]]) };
        }
      }
      fondC.set(n, f); return f;
    }
    /** Où ce texte peut-il se trouver à l'écran ? Sa place, ou toute la hauteur visible de la zone qui le fait défiler. */
    function atteignable(el, L) {
      let x0 = L.l, x1 = L.r, y0 = L.t, y1 = L.b, libre = false;
      for (const c of chaine(el)) {
        const b = pbox(c.el);
        if (c.ox !== 'visible') { x0 = Math.max(x0, b.l); x1 = Math.min(x1, b.r); }
        if (defile(c.oy) && c.el.scrollHeight > c.el.clientHeight + 4) { y0 = b.t; y1 = b.b; libre = true; }
        else if (c.oy !== 'visible') { y0 = Math.max(y0, b.t); y1 = Math.min(y1, b.b); }
      }
      if (!libre && pageDefileY && !M(el).fix) { y0 = 0; y1 = H; }
      return { l: Math.max(0, x0), r: Math.min(W, x1), t: Math.max(0, y0), b: Math.min(H, y1) };
    }
    if (o.contraste || o.decor) {
      const vusDecor = new Set();
      for (const g of groupes) {
        const el = g.el; if (ignore(el)) continue;
        const s = cs(el);
        if (el.closest('[disabled],[aria-disabled=true]')) continue;
        if (/text/.test(s.webkitBackgroundClip || s.backgroundClip || '')) continue;
        const z = atteignable(el, g.ls[0]); if (z.r - z.l < 1 || z.b - z.t < 1) continue;
        const f = fond(el), tc = col(s.webkitTextFillColor && s.webkitTextFillColor !== s.color ? s.webkitTextFillColor : s.color);
        if (tc[3] < 0.05 || f.inconnu) continue;
        const fsz = g.fs, gras = Number(s.fontWeight) >= 700, grand = fsz >= 24 || (fsz >= 18.66 && gras), seuil = grand ? 3 : 4.5, op = opEff(el);
        let fonds = f.cols, surDecor = null;
        if (f.page) {
          // Fond de la page : on lit les vraies couleurs là où le texte peut se trouver ; le dégradé seul pour le contraste,
          // et le décor à part (c'est un autre défaut : le texte n'a pas de fond à lui).
          const ciel = fondPage(z, true); if (!ciel) continue;
          const pose = (b) => f.couches.reduce((acc, cc) => over(cc, acc), b), voile = 1 - f.couches.reduce((acc, cc) => acc * (1 - cc[3]), 1);
          fonds = [pose(ciel.sombre), pose(ciel.clair)];
          if (o.decor && voile < 0.85) { const bande = fondPage({ l: z.l, r: z.r, t: Math.max(z.t, decor.haut), b: z.b }, false); if (bande && bande.part > 0.02) surDecor = { sombre: pose(bande.sombre), clair: pose(bande.clair), part: bande.part }; }
        }
        if (!fonds || !fonds.length) continue;
        const mesure = (b) => { const base = over(tc, b), vu = op < 0.999 ? mixc(base, b, op) : base; return { r: ratio(vu, b), fg: vu, bg: b }; };
        if (o.contraste) {
          let pire = null; for (const b of fonds) { const x = mesure(b); if (!pire || x.r < pire.r) pire = x; }
          if (pire && pire.r < seuil - 0.05) add('contraste', pire.r < (grand ? 2 : 3) ? 'grave' : 'moyen', el, `contraste ${rnd(pire.r)}:1 (il faut ${seuil}:1) : texte ${hex(pire.fg)} sur ${hex(pire.bg)}, ${Math.round(fsz)} px${gras ? ' gras' : ''}`, { ratio: rnd(pire.r), seuil, texte: hex(pire.fg), fond: hex(pire.bg), taille: Math.round(fsz) }, { groupe: `contraste|${hex(pire.fg)}|${hex(pire.bg)}|${grand ? 'grand' : 'normal'}` });
        }
        if (surDecor && !vusDecor.has(el)) {
          vusDecor.add(el);
          const a = mesure(surDecor.sombre), b = mesure(surDecor.clair), pire = a.r < b.r ? a : b;
          add('sur-decor', pire.r < 3 ? 'grave' : pire.r < 4.5 ? 'moyen' : 'mineur', el, `texte sans fond posé sur le décor du thème : au pire ${rnd(pire.r)}:1 (texte ${hex(pire.fg)} sur ${hex(pire.bg)})`, { ratio: rnd(pire.r), texte: hex(pire.fg), fond: hex(pire.bg), partDecor: rnd(surDecor.part) });
        }
      }
    }

    // ------------------------------------------------------------------ 11. Focus invisible (au clavier)
    if (o.focus) {
      const st = D.createElement('style'); st.setAttribute('data-q-outil', ''); st.textContent = '*,*::before,*::after{transition:none!important}'; D.head.append(st);
      const avant = D.activeElement, vusF = new Map();
      const photo = (e) => { const s = getComputedStyle(e), c = s.outlineStyle === 'none' || !(parseFloat(s.outlineWidth) > 0) ? 'none' : [s.outlineStyle, s.outlineWidth, s.outlineColor, s.outlineOffset].join(' '); return [c, s.boxShadow, s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor, s.borderTopWidth, s.backgroundColor, s.backgroundImage, s.color, s.textDecorationLine, s.filter, s.transform]; };
      let nF = 0;
      for (const it of inter) {
        const el = it.el; if (el.tabIndex < 0 || el.localName === 'label') continue;
        // Deux éléments par sorte suffisent (même classe, même style : même focus).
        const k = sig(el) + '|' + (el.getAttribute('style') || ''), deja = vusF.get(k) || 0; if (deja >= 2) continue; vusF.set(k, deja + 1);
        if (++nF > o.maxFocus) break;
        const autour = [el, el.parentElement, el.parentElement && el.parentElement.parentElement].filter(Boolean);
        const a = autour.map(photo);
        try { el.focus({ preventScroll: true }); } catch { continue; }
        if (D.activeElement !== el) continue;
        const b = autour.map(photo), s = getComputedStyle(el);
        const contour = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 && alpha(s.outlineColor) > 0.2;
        const change = a.some((x, i) => x.some((v, j) => v !== b[i][j]));
        if (!contour && !change) add('focus-invisible', 'moyen', el, `rien ne montre que cet élément a le focus au clavier : « ${txt(el, 40)} »`, {});
        else if (!contour) {
          // Seul un changement de couleur : est-il assez marqué ? (bordure, fond ou texte, avant / après)
          const diff = [2, 7, 9].map((j) => (a[0][j] !== b[0][j] ? ratio(over(col(a[0][j]), [128, 128, 128]), over(col(b[0][j]), [128, 128, 128])) : 0)), max = Math.max(...diff);
          const autre = a.some((x, i) => x.some((v, j) => v !== b[i][j] && (i > 0 || ![2, 3, 4, 5, 7, 9].includes(j))));
          if (!autre && max > 0 && max < 1.5) add('focus-invisible', 'mineur', el, `le focus au clavier se voit à peine (simple changement de couleur, ${rnd(max)}:1) : « ${txt(el, 40)} »`, { ratio: rnd(max) });
        }
        try { el.blur(); } catch { /* rien */ }
      }
      try { if (avant && avant !== B && avant.focus) avant.focus({ preventScroll: true }); } catch { /* rien */ }
      st.remove();
    }

    DE.setAttribute('data-qn', String(qn));
    // ------------------------------------------------------------------ Regroupement (même défaut répété) et tri
    const ORDRE = { grave: 0, moyen: 1, mineur: 2, info: 3 };
    let defauts = out;
    if (o.regrouper) {
      const par = new Map();
      for (const d of out) {
        const g = par.get(d.groupe);
        if (!g) { par.set(d.groupe, Object.assign(d, { n: 1, autres: [] })); continue; }
        g.n++;
        if (ORDRE[d.gravite] < ORDRE[g.gravite]) { const garde = { n: g.n, autres: [g.selecteur].concat(g.autres).filter((x) => x !== d.selecteur).slice(0, 4) }; Object.assign(g, d, garde); }
        else if (g.autres.length < 4 && d.selecteur !== g.selecteur && !g.autres.includes(d.selecteur)) g.autres.push(d.selecteur);
      }
      defauts = [...par.values()];
    }
    defauts.sort((a, b) => ORDRE[a.gravite] - ORDRE[b.gravite] || a.type.localeCompare(b.type));
    return { defauts, mesures: { largeur: W, hauteur: H, elements: els.length, textes: groupes.length, cliquables: inter.length, zonesDefilantes: zones, pageLarge, pageHaute, decor: Boolean(decor), passes, ms: Math.round(performance.now() - t0) } };
  };
})()
