// Odin, la mascotte, présent sur toutes les pages (hors Discussion, où il a déjà sa propre vie).
// Il choisit lui-même où se poser : toujours dans une zone libre (jamais sur du texte, un bouton, un
// champ, une image ou la navigation), il se déplace quand le contenu change, quand tu défiles, quand
// tu changes de page ou d'écran, va voir ce qui demande ton attention, se promène quand il s'ennuie
// et s'écarte si ta souris ou ton doigt arrive sur lui. Sa taille suit l'écran (téléphone, tablette,
// ordinateur) et il rapetisse s'il n'y a pas assez de place libre. Tu peux aussi le déplacer toi-même :
// il reste où tu l'as posé un moment, puis reprend sa liberté.
// Ses trajets (15/11) : il marche d'un endroit à l'autre par un chemin qui contourne le contenu (jamais
// en ligne droite à travers du texte ou des boutons, jamais de saut au hasard). Il ne se pose jamais et ne
// passe jamais dans la zone où tu travailles : le champ où tu écris, la carte ou la fenêtre que tu touches
// depuis peu, les onglets, les menus ouverts, les fenêtres. S'il ne trouve pas de chemin libre, il se
// cache un instant et ressort plus loin. Sans place libre, il se range dans un coin et rapetisse.
// Survol (souris) : ses yeux te suivent, il réagit, une petite infobulle dit où tu es et ce qu'il fait ;
// il ne s'écarte que si tu vises ce qui est juste à côté de lui (pas lui).
(() => {
  'use strict';
  if (window.OdinCompanion) return;
  const reduce = matchMedia('(prefers-reduced-motion:reduce)');
  const coarse = matchMedia('(pointer:coarse)');
  const S = () => window.OdinState || {};
  // Odin et ce qui lui appartient (sa pastille, sa petite fenêtre, son aide, son infobulle) : jamais un obstacle pour lui.
  const OWN = '#buddyRoam,#odinBubble,#odinTalk,#guideBox,#odinTip,#odinTaps,#odinEgg';
  let bud = null, pos = null, size = 64, pinnedUntil = 0, userPinnedUntil = 0, lastWander = Date.now(), idleSince = Date.now(), view = '';
  // `retryAt` : sans meilleure place, il ne recherche pas avant ce moment ; `bubbleSeen` : la pastille déjà prise en compte ;
  // `walking` : le trajet en cours ; `lastPtr` : où était ta souris ou ton doigt, et quand.
  let retryAt = 0, bubbleSeen = '', walking = null, hovered = false, lastPtr = null;

  const CSS = `
  .odin.roam.path{transition:width .35s,height .35s,opacity .25s!important}
  .odin.roam.slip{opacity:0!important}
  html.odin-scan #buddyRoam,html.odin-scan #buddyRoam *,html.odin-scan #odinBubble,html.odin-scan #odinBubble *,html.odin-scan #odinTalk,html.odin-scan #odinTalk *,html.odin-scan #guideBox,html.odin-scan #guideBox *,html.odin-scan #odinTip,html.odin-scan #odinTaps,html.odin-scan #odinEgg,html.odin-scan #odinEgg *{pointer-events:none!important}
  #odinTip{position:fixed;z-index:63;left:0;top:0;max-width:min(260px,calc(100vw - 24px));box-sizing:border-box;padding:6px 10px;border-radius:10px;background:var(--panel,#171A20);color:var(--ink,#eef0f6);border:1px solid var(--line,#333);box-shadow:0 6px 18px rgba(0,0,0,.28);font:500 12.5px/1.4 var(--body,system-ui,sans-serif);pointer-events:none;opacity:0;transition:opacity .15s;white-space:pre-line}
  #odinTip.on{opacity:1}
  @media (prefers-reduced-motion:reduce){#odinTip{transition:none}}
  /* Téléphone : la fin de chaque page laisse la place d'Odin au-dessus de la barre du bas, pour que la dernière ligne puisse passer au-dessus de lui. */
  @media (max-width:599px){.view.on>.body::after{content:"";display:block;height:84px;pointer-events:none}}`;

  // ---------- Fabrication : une copie de la mascotte de la discussion, avec ses propres dégradés ----------
  function make() {
    const had = document.getElementById('buddyRoam'); if (had) return had; // une seule mascotte en liberté
    const src = document.getElementById('buddyChat') || document.querySelector('.odin');
    if (!src) return null;
    const b = src.cloneNode(true);
    b.id = 'buddyRoam'; b.className = 'odin roam path'; b.removeAttribute('title'); b.setAttribute('aria-hidden', 'true');
    for (const g of b.querySelectorAll('[id]')) {
      const nid = `${g.id}-roam`;
      for (const r of b.querySelectorAll('*')) for (const a of ['fill', 'stroke', 'filter', 'clip-path', 'mask']) { if (r.getAttribute(a) === `url(#${g.id})`) r.setAttribute(a, `url(#${nid})`); }
      g.id = nid;
    }
    document.body.append(b);
    window.OdinFace?.set(b, S().mood?.() || 'neutre');
    return b;
  }

  // ---------- Ce qui est « occupé » : texte, contrôles, médias, navigation, et la zone où tu travailles ----------
  const BUSY_SEL = 'a,button,input,textarea,select,label,summary,img,video,canvas,svg,iframe,[role=button],[role=tab],[role=switch],[contenteditable=true],nav,.mbar,.bnav,.tip,.palette,dialog,table,code,pre';
  // Toujours « en travail » : fenêtres, menus ouverts, onglets.
  const ZONE_SEL = 'dialog[open],[aria-modal=true],[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=tablist],.tabs,.tabbar,#odinAdvice';
  const FIELD_SEL = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]),textarea,select,[contenteditable=true],[contenteditable=""]';
  // Ce que ta souris ou ton doigt touche depuis peu : la carte, le formulaire, la fenêtre ou la ligne.
  const WORK_SEL = 'dialog,[role=dialog],form,.card,article,fieldset,[role=tabpanel],li,tr,.row';
  const work = []; // { el, until }
  function textAt(el, x, y) {
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      for (const q of r.getClientRects()) if (x >= q.left - 6 && x <= q.right + 6 && y >= q.top - 6 && y <= q.bottom + 6) return true;
    }
    return false;
  }
  /** Les rectangles où il ne va jamais (ni posé, ni en passant) : ta zone de travail, avec une marge. */
  function zonesNow() {
    const out = [], now = Date.now();
    const add = (e, m) => {
      if (!(e instanceof Element) || e.closest(OWN)) return;
      const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
      out.push({ l: r.left - m, t: r.top - m, r: r.right + m, b: r.bottom + m });
    };
    for (const e of document.querySelectorAll(ZONE_SEL)) if (e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden') add(e, 14);
    for (const e of document.querySelectorAll('[popover]')) { try { if (e.matches(':popover-open')) add(e, 14); } catch { /* vieux navigateur */ } }
    const f = document.activeElement;
    if (f instanceof Element && f.matches(FIELD_SEL)) { add(f, 48); const form = f.closest('form'); if (form && !tooBig(form)) add(form, 16); }
    for (let i = work.length - 1; i >= 0; i--) { const w = work[i]; if (now > w.until || !w.el.isConnected) work.splice(i, 1); else add(w.el, 20); }
    return out;
  }
  /** Trop grand pour être « là où tu travailles » (toute la page) ? */
  function tooBig(e) { const A = area(), r = e.getBoundingClientRect(); return !A || r.width * r.height > (A.right - A.left) * (A.bottom - A.top) * 0.45; }
  function workEl(t) {
    if (!(t instanceof Element) || t.closest(OWN)) return null;
    let e = t.closest(WORK_SEL);
    if (!e || tooBig(e)) e = t.closest('a,button,input,textarea,select,label,[role=button],[role=tab],p,h1,h2,h3,h4,td,img') || t;
    if (e === document.body || e === document.documentElement || e.matches('.view,.body,main') || tooBig(e)) return null;
    return e;
  }
  function workOn(e, ms) {
    if (!e) return;
    const old = work.find((w) => w.el === e);
    if (old) old.until = Math.max(old.until, Date.now() + ms); else { work.push({ el: e, until: Date.now() + ms }); if (work.length > 4) work.shift(); }
  }

  // Ce qu'il y a à un point : 0 = rien qui gêne (un fond, une carte) ; 1 = du texte ; 3 = une commande, un champ,
  // un média ou la navigation ; 9 = la zone où tu travailles. Odin et ce qui est à lui ne comptent pas.
  let zones = [], scanDepth = 0;
  function kindHere(x, y) {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return 3;
    for (const z of zones) if (x >= z.l && x <= z.r && y >= z.t && y <= z.b) return 9;
    const top = document.elementFromPoint(x, y);
    if (!top || top === document.documentElement || top === document.body || top.closest(OWN)) return 0;
    if (top.closest(BUSY_SEL)) return 3;
    return textAt(top, x, y) ? 1 : 0;
  }
  /** Le temps d'une mesure, Odin et ce qui est à lui laissent passer la souris : on voit ce qu'il y a dessous. */
  function scanning(fn) {
    const h = document.documentElement;
    if (!scanDepth++) { h.classList.add('odin-scan'); zones = zonesNow(); }
    try { return fn(); } finally { if (!--scanDepth) h.classList.remove('odin-scan'); }
  }
  /** Ce qu'il y a sous un carré (x, y, côté s) : nombre de points de texte, de commande, de zone de travail. */
  function under(x, y, s) {
    return scanning(() => {
      const c = { t: 0, c: 0, z: 0 }, k = 4;
      for (let i = 0; i <= k; i++) for (let j = 0; j <= k; j++) { const v = kindHere(x + (s * i) / k, y + (s * j) / k); if (v === 1) c.t++; else if (v === 3) c.c++; else if (v === 9) c.z++; }
      return c;
    });
  }

  // ---------- Sa pastille (les notifications) : juste au-dessus de lui, elle ne doit rien couvrir non plus ----------
  /** La pastille affichée en ce moment : sa taille, son texte. */
  function bubble() { const e = document.getElementById('odinBubble'); return e && !e.hidden && e.offsetWidth ? { w: e.offsetWidth, h: e.offsetHeight, text: e.textContent } : null; }
  /** Où la pastille se poserait si Odin était en (x, y) : juste au-dessus de lui, côté droit (même calcul que notices.js). */
  function bubbleRect(x, y, s, b) { const m = 12; let by = y - b.h - 2; if (by < m) by = y + s + 2; return { x: Math.min(Math.max(m, x + s + 10 - b.w), innerWidth - b.w - m), y: Math.min(by, innerHeight - b.h - m) }; }
  function bubbleUnder(x, y, s, b) {
    const r = bubbleRect(x, y, s, b);
    return scanning(() => { const c = { t: 0, c: 0, z: 0 }; for (let i = 0; i <= 3; i++) for (let j = 0; j <= 1; j++) { const v = kindHere(r.x + (b.w * i) / 3, r.y + b.h * j); if (v === 1) c.t++; else if (v === 3) c.c++; else if (v === 9) c.z++; } return c; });
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

  // ---------- La carte des places : un quadrillage de la page (un point tous les cinquièmes de sa taille) ----------
  // Chaque point dit ce qu'il y a dessous ; une place pour Odin = un carré de (n+1)×(n+1) points (n = 5 : sa taille
  // normale ; 4 et 3 : plus petit). Des sommes cumulées disent en un coup ce qu'un carré couvre.
  let gridMemo = null;
  function grid() {
    const A = area(); if (!A) return null;
    const step = Math.max(8, Math.round(baseSize() / 5));
    const key = `${A.left}|${A.top}|${A.right}|${A.bottom}|${step}`;
    if (gridMemo && gridMemo.key === key && Date.now() - gridMemo.at < 400) return gridMemo;
    const cols = Math.floor((A.right - A.left) / step) + 1, rows = Math.floor((A.bottom - A.top) / step) + 1;
    if (cols < 2 || rows < 2) return null;
    const kind = new Uint8Array(cols * rows);
    scanning(() => { for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) kind[j * cols + i] = kindHere(A.left + i * step, A.top + j * step); });
    const W = cols + 1, pre = (v) => { const p = new Int32Array(W * (rows + 1)); for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) p[(j + 1) * W + i + 1] = (kind[j * cols + i] === v ? 1 : 0) + p[j * W + i + 1] + p[(j + 1) * W + i] - p[j * W + i]; return p; };
    const P = { t: pre(1), c: pre(3), z: pre(9) };
    const sum = (p, i0, j0, i1, j1) => p[(j1 + 1) * W + i1 + 1] - p[j0 * W + i1 + 1] - p[(j1 + 1) * W + i0] + p[j0 * W + i0];
    /** Ce que couvre la place (i, j) de côté n pas : { t, c, z }. */
    const cover = (i, j, n) => ({ t: sum(P.t, i, j, i + n, j + n), c: sum(P.c, i, j, i + n, j + n), z: sum(P.z, i, j, i + n, j + n) });
    /** Ce que couvre un rectangle en pixels (la pastille) ; ce qui sort de la page compte comme une commande. */
    const rect = (x, y, w, h) => { const i0 = Math.floor((x - A.left) / step), j0 = Math.floor((y - A.top) / step), i1 = Math.ceil((x + w - A.left) / step), j1 = Math.ceil((y + h - A.top) / step); const out = (i0 < 0 || j0 < 0 || i1 >= cols || j1 >= rows) ? 3 : 0; const a = Math.max(0, i0), b = Math.max(0, j0), c = Math.min(cols - 1, i1), d = Math.min(rows - 1, j1); if (a > c || b > d) return { t: 0, c: out, z: 0 }; return { t: sum(P.t, a, b, c, d), c: sum(P.c, a, b, c, d) + out, z: sum(P.z, a, b, c, d) }; };
    gridMemo = { key, at: Date.now(), A, step, cols, rows, kind, cover, rect };
    return gridMemo;
  }
  const penalty = (c) => c.t + c.c * 6 + c.z * 60; // un point de texte gêne un peu, une commande beaucoup, ta zone de travail énormément

  // ---------- Choisir une place : libre, proche de ce qui l'intéresse, pas trop loin d'où il est ----------
  function choose(want) {
    const G = grid(); if (!G) return null;
    const { A, step } = G, b = bubble(), phone = innerWidth < 600, ptr = lastPtr && Date.now() - lastPtr.at < 4000 ? lastPtr : null;
    for (const n of [5, 4, 3]) {
      const s = n * step; let best = null;
      for (let j = 0; j + n < G.rows; j++) for (let i = 0; i + n < G.cols; i++) {
        const c = G.cover(i, j, n); if (c.t || c.c || c.z) continue;
        const x = A.left + i * step, y = A.top + j * step, cx = x + s / 2, cy = y + s / 2;
        let score = want?.random ? Math.random() * 120 : 0;
        if (want && !want.random) score += Math.hypot(cx - want.x, cy - want.y);
        else if (pos) score += Math.hypot(cx - (pos.x + size / 2), cy - (pos.y + size / 2)) * (want?.random ? -0.2 : 0.25);
        // Préférence légère pour les bords (il ne se met pas au milieu de ta lecture) ; sur téléphone, plutôt en bas.
        score += Math.min(cx - A.left, A.right - cx, cy - A.top, A.bottom - cy) * 0.15 + (phone ? (A.bottom - cy) * 0.3 : 0);
        // Pas sous ta souris ou ton doigt.
        if (ptr && Math.hypot(cx - ptr.x, cy - ptr.y) < 140) score += 400;
        // Sa pastille ne couvre rien non plus.
        if (b) { const r = bubbleRect(x, y, s, b), k = G.rect(r.x, r.y, b.w, b.h); score += penalty(k) * 60; }
        if (!best || score < best.score) best = { x, y, s, i, j, n, score };
      }
      if (best) return best;
    }
    // Aucune place libre (graphe plein écran, page très chargée) : petit, dans le coin où il gêne le moins.
    const n = 3, s = n * step, ci = G.cols - 1 - n, cj = G.rows - 1 - n; let best = null;
    if (ci < 0 || cj < 0) return null;
    for (const [i, j] of [[ci, cj], [ci, 0], [0, cj], [0, 0]]) {
      const x = A.left + i * step, y = A.top + j * step;
      let g = penalty(G.cover(i, j, n)); if (b) { const r = bubbleRect(x, y, s, b); g += penalty(G.rect(r.x, r.y, b.w, b.h)); }
      if (!best || g < best.g) best = { x, y, s, i, j, n, g, corner: true };
    }
    return best;
  }

  // ---------- Le chemin : le plus court qui contourne le contenu (et jamais par ta zone de travail) ----------
  function route(G, from, to, n) {
    const { cols, rows } = G, mi = cols - n, mj = rows - n; if (mi <= 0 || mj <= 0) return null;
    const idx = (i, j) => j * mi + i, N = mi * mj, cost = new Float64Array(N), dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    for (let j = 0; j < mj; j++) for (let i = 0; i < mi; i++) cost[idx(i, j)] = 1 + penalty(G.cover(i, j, n)) * 2;
    const clampI = (v) => Math.max(0, Math.min(mi - 1, v)), clampJ = (v) => Math.max(0, Math.min(mj - 1, v));
    const s0 = idx(clampI(from.i), clampJ(from.j)), goal = idx(clampI(to.i), clampJ(to.j));
    // File de priorité (tas binaire).
    const heap = [], push = (d, v) => { heap.push([d, v]); let k = heap.length - 1; while (k) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    dist[s0] = 0; push(0, s0);
    while (heap.length) {
      const [d, v] = pop(); if (d > dist[v]) continue; if (v === goal) break;
      const i = v % mi, j = (v - i) / mi;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue; const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= mi || b >= mj) continue;
        const u = idx(a, b), nd = d + ((cost[v] + cost[u]) / 2) * (di && dj ? 1.414 : 1);
        if (nd < dist[u]) { dist[u] = nd; prev[u] = v; push(nd, u); }
      }
    }
    if (!Number.isFinite(dist[goal])) return null;
    const cells = []; for (let v = goal; v !== -1 && cells.length <= N; v = prev[v]) cells.push([v % mi, Math.floor(v / mi)]); cells.reverse();
    const pen = cells.map(([i, j]) => penalty(G.cover(i, j, n)));
    // `rough` : ce que le chemin traverse une fois sorti de sa place de départ (s'il y était gêné) ; `zone` : ta zone de travail.
    let zone = false, rough = 0, out = false;
    cells.forEach(([i, j], k) => { const c = G.cover(i, j, n); if (c.z && k) zone = true; if (!pen[k]) out = true; else if (out) rough += c.t + c.c; });
    // Points de passage : on garde seulement les virages (une ligne droite n'est gardée que si, tout du long, elle ne gêne pas plus que le chemin au même endroit).
    const sight = (a, b) => { const [i0, j0] = cells[a], [i1, j1] = cells[b], k = Math.max(Math.abs(i1 - i0), Math.abs(j1 - j0)) * 2 || 1; for (let q = 0; q <= k; q++) { const i = Math.round(i0 + ((i1 - i0) * q) / k), j = Math.round(j0 + ((j1 - j0) * q) / k); if (penalty(G.cover(i, j, n)) > Math.max(pen[a + Math.round(((b - a) * q) / k)], pen[Math.min(b, a + Math.round(((b - a) * q) / k) + 1)])) return false; } return true; };
    const keep = [0], last = cells.length - 1; let a = 0;
    while (a < last) { let b = a + 1; while (b < last && sight(a, b + 1)) b++; keep.push(b); a = b; }
    return { pts: keep.map((k) => ({ x: G.A.left + cells[k][0] * G.step, y: G.A.top + cells[k][1] * G.step })), zone, rough };
  }

  // ---------- Bouger : marcher le long du chemin, ou se cacher un instant et ressortir plus loin ----------
  function setSize(s) { size = s; bud.style.setProperty('--rs', `${s}px`); }
  // Ses déplacements sont tous faits ici, image par image (classe `path` : plus de glissement en ligne droite par le CSS).
  function stopWalk() { if (!walking) return; cancelAnimationFrame(walking.raf); clearTimeout(walking.t); walking = null; bud?.classList.remove('walk', 'slip'); }
  function put(x, y) { pos = { x, y }; bud.style.translate = `${Math.round(x)}px ${Math.round(y)}px`; }
  /** Il se cache (fondu), change de place, et ressort : premier placement, ou aucun chemin libre. */
  function slip(p) {
    stopWalk();
    if (!pos) { setSize(p.s); put(p.x, p.y); return; }
    bud.classList.add('slip');
    const w = walking = { raf: 0, t: 0 };
    w.t = setTimeout(() => {
      if (walking !== w) return;
      setSize(p.s); put(p.x, p.y); bud.classList.remove('slip');
      w.t = setTimeout(() => { if (walking !== w) return; walking = null; act('act-joy', 1100); }, 280);
    }, 280);
  }
  function walkAlong(pts, s, then) {
    stopWalk();
    const seg = []; let L = 0; for (let k = 1; k < pts.length; k++) { const d = Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y); seg.push(d); L += d; }
    if (L < 3) { setSize(s); put(pts[pts.length - 1].x, pts[pts.length - 1].y); then?.(); return; }
    if (!reduce.matches) bud.classList.add('walk');
    if (s < size) setSize(s); // il rapetisse avant de passer, grandit en arrivant
    const v = Math.max(reduce.matches ? 160 : 230, L / 3.2), T = (L / v) * 1000, t0 = performance.now();
    const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
    let lastSeg = -1;
    const frame = (now) => {
      if (!walking) return;
      const u = Math.min(1, (now - t0) / T); let d = L * ease(u), k = 0;
      while (k < seg.length - 1 && d > seg[k]) { d -= seg[k]; k++; }
      const a = pts[k], b = pts[k + 1], f = seg[k] ? Math.min(1, d / seg[k]) : 1;
      put(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
      if (k !== lastSeg) { lastSeg = k; lookAt(b.x + size / 2, b.y + size / 2); }
      if (u < 1) walking.raf = requestAnimationFrame(frame);
      else end();
    };
    // Onglet caché (plus d'images) : il arrive quand même, à la fin du temps prévu.
    const end = () => { if (!walking) return; cancelAnimationFrame(walking.raf); clearTimeout(walking.t); walking = null; bud.classList.remove('walk'); const e = pts[pts.length - 1]; put(e.x, e.y); setSize(s); then?.(); };
    walking = { raf: requestAnimationFrame(frame), t: setTimeout(end, T + 1500) };
  }
  /** Aller à la place p : à pied par un chemin libre ; sinon il se cache et ressort (une promenade, elle, est annulée). Rend true s'il y va. */
  function moveTo(p, wander) {
    if (!bud || !p) return false;
    if (!pos || bud.hidden) { slip(p); return true; }
    if (Math.hypot(p.x - pos.x, p.y - pos.y) < 4) { if (p.s !== size) setSize(p.s); return true; }
    const G = grid(); if (!G) { if (wander) return false; slip(p); return true; }
    const n = Math.min(p.n ?? 5, Math.max(3, Math.min(5, Math.round(size / G.step))));
    const at = (x, y) => ({ i: Math.round((x - G.A.left) / G.step), j: Math.round((y - G.A.top) / G.step) });
    const r = route(G, at(pos.x, pos.y), { i: p.i ?? at(p.x, p.y).i, j: p.j ?? at(p.x, p.y).j }, n);
    // Pas de chemin libre, ou il passerait par ta zone de travail : il ne traverse pas, il se faufile (fondu).
    if (!r || r.zone || r.rough) { if (wander) return false; slip(p); return true; }
    r.pts[0] = { x: pos.x, y: pos.y }; r.pts[r.pts.length - 1] = { x: p.x, y: p.y };
    walkAlong(r.pts, p.s);
    return true;
  }
  function go(want) { if (Date.now() < pinnedUntil && !want?.force) return; const p = choose(want); if (p) moveTo(p); return p; }
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
    return true; // promenade coupée (Réglages) : il reste visible, posé, sans se promener
  }
  function sync() {
    if (!bud) bud = make(); if (!bud) return;
    const v = currentView(), show = shouldShow();
    bud.hidden = !show;
    if (!show) { view = v; stopWalk(); untip(); return; }
    if (drag || walking) return;
    if (v !== view) { view = v; pinnedUntil = 0; go(null); window.OdinFace?.flash(bud, ['regarde', 'joie', 'surprise'][Math.floor(Math.random() * 3)], 1600); return; }
    if (!pos) { go(null); return; }
    const A = area(); if (!A) return;
    const now = Date.now(), out = pos.x < A.left - 2 || pos.y < A.top - 2 || pos.x + size > A.right + 2 || pos.y + size > A.bottom + 2;
    const free = now >= pinnedUntil, mine = now < userPinnedUntil;
    const u = under(pos.x, pos.y, size), b = bubble(), bu = b ? bubbleUnder(pos.x, pos.y, size, b) : { t: 0, c: 0, z: 0 };
    const fresh = Boolean(b) && b.text !== bubbleSeen; bubbleSeen = b ? b.text : '';
    // Sur une commande ou dans ta zone de travail (lui ou sa pastille) : il part tout de suite, même retenu par sa petite
    // fenêtre ; seul un déplacement fait par toi (glisser) l'y laisse un moment.
    const urgent = !mine && (u.c || u.z || bu.c || bu.z);
    // Du texte apparu sous lui (ou sous sa pastille) : il s'écarte, sans rechercher à chaque seconde s'il n'y a pas mieux.
    const soft = free && (u.t || bu.t);
    if (out || (urgent && now >= retryAt) || (soft && (fresh || now >= retryAt)) || Math.abs(size - baseSize()) > 30) {
      const before = `${Math.round(pos.x)},${Math.round(pos.y)}`;
      const p = choose(urgent && !free ? { x: pos.x + size / 2, y: pos.y + size / 2 } : null);
      if (p && `${Math.round(p.x)},${Math.round(p.y)}` !== before) moveTo(p);
      retryAt = now + (p && !p.corner ? 1500 : 6000);
    }
  }

  // ---------- Ce qui l'intéresse : alertes, messages d'état, nouveautés ----------
  function attention() {
    const v = document.querySelector('.view.on'); if (!v) return null;
    const cands = [...v.querySelectorAll('.bad,[role=alert],.badge:not([hidden]),.warn')].filter((e) => e.offsetParent && e.textContent.trim());
    for (const e of cands) { const r = e.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) return { x: r.right + 40, y: r.top + r.height / 2, mood: 'inquiet' }; }
    return null;
  }
  const live = new MutationObserver((ms) => {
    if (!bud || bud.hidden || drag || walking || Date.now() < pinnedUntil) return;
    for (const m of ms) {
      const t = m.target.nodeType === 3 ? m.target.parentElement : m.target;
      const zone = t?.closest?.('[aria-live],[role=status]'); if (!zone || !zone.closest('.view.on') || zone.closest(OWN)) continue;
      const txt = zone.textContent.trim(); if (!txt) continue;
      const r = zone.getBoundingClientRect();
      go({ x: r.right + 30, y: r.top + r.height / 2 });
      setTimeout(() => {
        lookAt(r.left + Math.min(r.width, 200) / 2, r.top + r.height / 2);
        if (/✗|erreur|échec|impossible|invalide/i.test(txt)) { window.OdinFace?.flash(bud, 'triste', 2200); act('act-sad', 1500); }
        else if (/✓|enregistr|relié|ajouté|créé|terminé|prêt/i.test(txt)) { window.OdinFace?.flash(bud, 'joie', 2200); act('act-joy', 1100); }
        else { window.OdinFace?.flash(bud, 'regarde', 1600); act('act-tilt', 1600); }
      }, 900);
      return;
    }
  });

  // ---------- Son infobulle (au survol d'Odin, et de sa pastille) ----------
  let tipEl = null, tipT = 0;
  function tip(text, anchor, delay = 0) {
    clearTimeout(tipT);
    tipT = setTimeout(() => {
      if (!anchor?.isConnected) return;
      if (!tipEl) { tipEl = document.createElement('div'); tipEl.id = 'odinTip'; tipEl.setAttribute('role', 'tooltip'); document.body.append(tipEl); }
      tipEl.textContent = text;
      const r = anchor.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight, m = 8;
      // À côté (à gauche, sinon à droite), jamais sur Odin ni sur sa pastille.
      let x = r.left - w - 10, y = r.top + r.height / 2 - h / 2;
      if (x < m) x = r.right + 10;
      if (x + w > innerWidth - m) { x = Math.min(Math.max(m, r.left + r.width / 2 - w / 2), innerWidth - w - m); y = r.top - h - 10 >= m ? r.top - h - 10 : r.bottom + 10; }
      tipEl.style.left = `${Math.round(x)}px`; tipEl.style.top = `${Math.round(Math.min(Math.max(m, y), innerHeight - h - m))}px`;
      tipEl.classList.add('on');
    }, delay);
  }
  function untip() { clearTimeout(tipT); tipEl?.classList.remove('on'); }
  function tipText() {
    const where = window.OdinGuide?.where?.() || '';
    const n = window.OdinNotices?.unread?.() ?? 0;
    return `Odin${where ? ` · ${where}` : ''}\nTouche-moi : je t'explique cette page pas à pas, ou parle-moi.${n ? `\n${n} notification${n > 1 ? 's' : ''} non lue${n > 1 ? 's' : ''} (la pastille).` : ''}`;
  }

  // ---------- Toi : il te regarde, réagit au survol, s'écarte si tu vises à côté, se laisse déplacer ----------
  let drag = null, hov = null, lastHello = 0;
  function onMove(e) {
    const now = Date.now(); idleSince = now; lastPtr = { x: e.clientX, y: e.clientY, at: now };
    if (!bud || bud.hidden || drag) return;
    const r = bud.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, d = Math.hypot(e.clientX - cx, e.clientY - cy);
    const over = e.target instanceof Element && bud.contains(e.target);
    if (d < 240) lookAt(e.clientX, e.clientY);
    if (e.pointerType === 'mouse') {
      if (over && !hovered) {
        hovered = true; tip(tipText(), bud, 300);
        if (now - lastHello > 6000) { lastHello = now; window.OdinFace?.flash(bud, ['joie', 'regarde', 'clin'][Math.floor(Math.random() * 3)], 1400); act('act-tilt', 900); }
      } else if (!over && hovered && d > r.width * 0.6) { hovered = false; untip(); }
      // Il s'écarte seulement si ta souris vise ce qui est juste à côté de lui (pas lui).
      if (!over && !walking && d < r.width * 0.95 && d > r.width * 0.45 && now >= pinnedUntil && e.target instanceof Element && !e.target.closest(OWN) && e.target.closest(BUSY_SEL)) {
        go({ x: cx + (cx - e.clientX) * 4, y: cy + (cy - e.clientY) * 4 });
      }
      // Tu restes sur une carte ou une fenêtre : c'est ta zone de travail un moment (pas quand tu vas vers lui).
      if (!over && d > r.width * 1.6) {
        const el = workEl(e.target);
        if (el && hov?.el === el) { if (now - hov.since > 1200 && !hov.done) { hov.done = true; workOn(el, 8000); } }
        else hov = { el, since: now, done: false };
      }
    }
  }
  function onDown(e) {
    lastPtr = { x: e.clientX, y: e.clientY, at: Date.now() };
    if (!bud || !(e.target instanceof Element)) return;
    if (!bud.contains(e.target)) { workOn(workEl(e.target), 20_000); if (!bud.hidden && !walking && !drag) setTimeout(() => { retryAt = 0; sync(); }, 60); return; }
    untip();
    drag = { x0: e.clientX, y0: e.clientY, px: pos?.x ?? 0, py: pos?.y ?? 0, moved: false, id: e.pointerId };
  }
  function onDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    if (!drag.moved) { drag.moved = true; stopWalk(); bud.classList.add('dragging'); window.OdinFace?.flash(bud, 'excite', 1500); }
    put(Math.max(0, Math.min(innerWidth - size, drag.px + dx)), Math.max(0, Math.min(innerHeight - size, drag.py + dy)));
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.moved) { bud.classList.remove('dragging'); pinnedUntil = userPinnedUntil = Date.now() + 120_000; window.OdinFace?.flash(bud, 'joie', 1500); }
    // Un simple toucher : la petite fenêtre pour lui parler (et ce qu'on peut faire sur la page), sur n'importe quel onglet.
    // Les clics rapides (1 à 20) : 1 = lui parler, les autres font ce qui est réglé (Réglages → Apparence).
    else if (window.OdinMascotte?.tap) { stopWalk(); window.OdinFace?.flash(bud, 'ecoute', 1500); window.OdinMascotte.tap(bud); }
    else if (window.OdinNotices?.talk) { stopWalk(); window.OdinFace?.flash(bud, 'ecoute', 1500); window.OdinNotices.talk(); }
    drag = null;
  }

  // ---------- Sa vie : promenades, petites actions, selon son humeur et la page ----------
  function tick() {
    if (!bud || bud.hidden || drag || walking || hovered || Date.now() < pinnedUntil) return;
    const idle = Date.now() - idleSince, since = Date.now() - lastWander;
    if (S().busy?.()) { if (since > 8000) { lastWander = Date.now(); act('act-advance', 1200); } return; }
    const need = attention();
    if (need && since > 25_000) { lastWander = Date.now(); go(need); setTimeout(() => { window.OdinFace?.flash(bud, need.mood, 2200); act('act-tilt', 1600); }, 1200); return; }
    if (S().roam && !S().roam()) return;
    if (idle > 8000 && since > 12_000 + Math.random() * 20_000) {
      lastWander = Date.now();
      const roll = Math.random();
      // Une promenade : une autre place libre, à pied par un chemin libre (sinon il reste et fait autre chose).
      if (roll < 0.6) { const p = choose({ random: true }); if (p && !p.corner && moveTo(p, true)) { window.OdinFace?.flash(bud, ['regarde', 'malice', 'joie', 'reflexion'][Math.floor(Math.random() * 4)], 2400); return; } }
      if (roll < 0.75) act('act-spin', 950);
      else if (roll < 0.88) act('act-wobble', 1000);
      else act('act-joy', 1100);
    }
  }

  function start() {
    bud = make(); if (!bud) return;
    { const st = document.createElement('style'); st.textContent = CSS; document.head.append(st); }
    bud.classList.add('path');
    view = '';
    sync();
    const views = new MutationObserver(() => { stopWalk(); sync(); });
    for (const v of document.querySelectorAll('.view')) views.observe(v, { attributes: true, attributeFilter: ['class'] });
    live.observe(document.body, { subtree: true, childList: true, characterData: true });
    let rs = 0; addEventListener('resize', () => { clearTimeout(rs); rs = setTimeout(() => { pinnedUntil = 0; stopWalk(); const p = choose(null); if (p) slip(p); }, 200); });
    let sc = 0; document.addEventListener('scroll', () => { clearTimeout(sc); sc = setTimeout(() => sync(), 350); }, { passive: true, capture: true });
    addEventListener('pointermove', onMove, { passive: true });
    addEventListener('pointermove', onDrag, { passive: true });
    addEventListener('pointerdown', onDown, true);
    addEventListener('pointerup', onUp, true);
    addEventListener('pointercancel', onUp, true);
    document.documentElement.addEventListener('mouseleave', () => { if (hovered) { hovered = false; untip(); } });
    // Tu écris dans un champ : ce champ (et son formulaire) est ta zone de travail ; il s'en écarte s'il y est.
    document.addEventListener('focusin', (e) => { if (e.target instanceof Element && e.target.matches(FIELD_SEL)) { retryAt = 0; setTimeout(sync, 60); } }, true);
    for (const ev of ['keydown', 'pointerdown']) addEventListener(ev, () => { idleSince = Date.now(); }, { passive: true });
    setInterval(sync, 1500);
    setInterval(tick, 3000);
  }
  // `pin` : il reste où il est pendant ce temps (quand il parle) ; `pin(0)` lui rend sa liberté.
  // `tip` / `untip` : la petite infobulle (aussi pour sa pastille).
  window.OdinCompanion = { go: (x, y) => go({ x, y, force: true }), act, lookAt, sync, pin: (ms) => { pinnedUntil = ms > 0 ? Date.now() + ms : 0; }, tip, untip };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 300)); else setTimeout(start, 300);
})();
