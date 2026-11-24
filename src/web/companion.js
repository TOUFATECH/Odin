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
// Survol (souris) : ses yeux te suivent, il réagit, une petite infobulle dit où tu es, ce qu'il fait et pourquoi ;
// il ne s'écarte que si tu vises ce qui est juste à côté de lui (pas lui).
// Sa vie (15/11) : il ne fait plus rien au hasard. C'est le moteur de vie (vie.js : besoins, caractère du jour,
// émotions) qui décide quoi faire et pourquoi, et lui demande un « plan » de gestes (aller quelque part, regarder,
// un geste, une pose). Ici, on ne choisit que le « où » : toujours une place libre, par un chemin libre, avec les
// mêmes règles qu'avant. On lui note ce qui se passe (changement de page, message apparu, survol, caresse, secousse,
// toucher). Sans le moteur de vie, il reste posé et garde un battement minimal (un geste quand Odin travaille,
// aller voir ce qui demande l'attention), sans promenade.
// Son nid (maquette « Accueil », lot 22b) : quand il ne trouve aucune place libre, il rentre dans son nid au lieu de se
// serrer dans un coin, et il en ressort dès qu'une place se libère. Au téléphone, le nid est le rond au centre de la
// barre du bas (Odin y est montré, ui.html) ; à l'ordinateur et en plein écran, un rond flottant en bas à droite, montré
// seulement quand il y est. Jamais deux Odin à l'écran. Il réagit quand le propriétaire prend, pose ou agrandit un widget
// (fenetre.js) : une émotion demandée au visage (qui seul dessine), un geste et un regard (rien de cela en mouvement réduit).
(() => {
  'use strict';
  if (window.OdinCompanion) return;
  const reduce = matchMedia('(prefers-reduced-motion:reduce)');
  const coarse = matchMedia('(pointer:coarse)');
  const S = () => window.OdinState || {};
  // Odin et ce qui lui appartient (sa pastille, sa petite fenêtre, son aide, son infobulle) : jamais un obstacle pour lui.
  const OWN = '#buddyRoam,#odinNid,#odinBubble,#odinTalk,#guideBox,#odinTip,#odinTaps,#odinEgg';
  let bud = null, pos = null, size = 64, pinnedUntil = 0, userPinnedUntil = 0, lastWander = Date.now(), idleSince = Date.now(), view = '';
  // `retryAt` : sans meilleure place, il ne recherche pas avant ce moment ; `bubbleSeen` : la pastille déjà prise en compte ;
  // `walking` : le trajet en cours ; `lastPtr` : où était ta souris ou ton doigt, et quand.
  let retryAt = 0, bubbleSeen = '', walking = null, hovered = false, lastPtr = null;
  // `lastKey` : ta dernière touche ; `places` : ses 6 dernières places (pour aller voir ailleurs) ; `plan` : le plan en cours ;
  // `pose` : sa pose (assis, dort, boude) ; `lastTap` : ton dernier toucher ; `seulGeste`, `seulVoir` : le battement sans moteur de vie.
  let lastKey = 0, plan = null, pose = '', lastTap = 0, caresseT = 0, seulGeste = 0, seulVoir = 0;
  // `mutAt` : la dernière fois que la page a changé ; `pageT` : il attend que la page soit posée avant de s'y placer ; `chercheLe` : sa dernière recherche de place.
  let mutAt = 0, pageT = 0, chercheLe = 0, zoneN = 0;
  // `nid` : où il est rangé (null : dehors ; 'barre' : le rond de la barre du bas ; 'rond' : le rond flottant) ;
  // `montre` : il a sa place sur cette page (pas dans la Discussion, pas caché par tes 10 clics).
  let nid = null, montre = false;
  const places = [], zonesLive = new WeakMap();
  /** Rien à faire : il est déjà là où l'étape « aller » voulait l'emmener. */
  const ICI = { ici: true };
  /** Le moteur de vie, s'il est là et en marche. */
  const vie = () => (window.OdinVie && window.OdinVie.actif ? window.OdinVie : null);
  /** Une émotion demandée au visage (c'est lui qui arbitre) ; avec un ancien visage : un éclat de l'humeur d'origine la plus proche. */
  function ressent(id, ms, source, repli) { const F = window.OdinFace; if (!F || !bud) return; if (typeof F.ressent === 'function') F.ressent(bud, id, { ms, source }); else if (typeof F.flash === 'function') F.flash(bud, repli, ms); }

  const CSS = `
  .odin.roam.path{transition:width .35s,height .35s,opacity .25s!important}
  .odin.roam.slip{opacity:0!important}
  /* Changement de page : il disparaît d'un coup (la nouvelle page ne s'affiche pas sous lui pendant qu'il s'efface), puis ressort en fondu. */
  .odin.roam.v-vite{transition:none!important}
  /* Sa place entière répond au doigt et à la souris (un disque de toute sa taille, sous son corps) : la cible ne rétrécit pas quand une émotion le rapetisse. */
  #buddyRoam .touche{pointer-events:all;cursor:pointer}
  /* Mouvement réduit : il ne change plus de taille en glissant ; seul le fondu (se cacher, ressortir) reste. */
  @media (prefers-reduced-motion:reduce){.odin.roam.path{transition:opacity .25s!important}}
  /* Ses poses (assis, dort, boude) se voient aussi en mouvement réduit : posées d'un coup, sans glissement. */
  #buddyRoam.v-assis > svg{transform-origin:50% 92%;transform:translateY(5%) scale(1.07,.9)}
  #buddyRoam.v-dort > svg{transform-origin:50% 92%;transform:translateY(7%) rotate(-7deg) scale(.85)}
  #buddyRoam.v-boude > svg{transform-origin:50% 92%;transform:translateY(4%) rotate(13deg) scale(.95)}
  html.odin-scan #buddyRoam,html.odin-scan #buddyRoam *,html.odin-scan #odinBubble,html.odin-scan #odinBubble *,html.odin-scan #odinTalk,html.odin-scan #odinTalk *,html.odin-scan #guideBox,html.odin-scan #guideBox *,html.odin-scan #odinTip,html.odin-scan #odinTaps,html.odin-scan #odinEgg,html.odin-scan #odinEgg *{pointer-events:none!important}
  #odinTip{position:fixed;z-index:63;left:0;top:0;max-width:min(260px,calc(100vw - 24px));box-sizing:border-box;padding:6px 10px;border-radius:10px;background:var(--panel,#171A20);color:var(--ink,#eef0f6);border:1px solid var(--line,#333);box-shadow:0 6px 18px rgba(0,0,0,.28);font:500 12.5px/1.4 var(--body,system-ui,sans-serif);pointer-events:none;opacity:0;transition:opacity .15s;white-space:pre-line}
  #odinTip.on{opacity:1}
  @media (prefers-reduced-motion:reduce){#odinTip{transition:none}}
  /* Ses gestes et ses poses (demandés par le moteur de vie) : seulement sur le dessin entier (svg) ; son corps, ses yeux et sa couleur appartiennent au visage. */
  @media (prefers-reduced-motion:no-preference){
  #buddyRoam > svg{transition:transform .5s cubic-bezier(.3,1.2,.5,1)}
  #buddyRoam.act-baille > svg{transform-origin:50% 92%;animation:v-baille 2.4s ease-in-out}
  #buddyRoam.act-etire > svg{transform-origin:50% 92%;animation:v-etire 1.8s cubic-bezier(.3,1.3,.5,1)}
  #buddyRoam.act-soupir > svg{transform-origin:50% 92%;animation:v-soupir 1.6s ease-in-out}
  #buddyRoam.act-signe > svg{transform-origin:50% 92%;animation:v-signe 1.2s ease-in-out}
  #buddyRoam.act-roule > svg{animation:v-roule 2s cubic-bezier(.45,0,.3,1)}
  #buddyRoam.act-tremble > svg{animation:v-tremble .17s linear 10}
  @keyframes v-baille{0%,100%{transform:none}35%,60%{transform:translateY(-4%) scale(.96,1.1)}80%{transform:translateY(1%) scale(1.03,.97)}}
  @keyframes v-etire{0%,100%{transform:none}30%{transform:scale(1.1,.86)}65%{transform:translateY(-6%) scale(.9,1.18)}}
  @keyframes v-soupir{0%,100%{transform:none}30%{transform:translateY(-2%) scale(.98,1.05)}70%{transform:translateY(3%) scale(1.05,.93)}}
  @keyframes v-signe{0%,100%{transform:none}20%,60%{transform:rotate(-13deg)}40%,80%{transform:rotate(13deg)}}
  @keyframes v-roule{0%,100%{transform:none}50%{transform:translateX(12%) rotate(360deg)}}
  @keyframes v-tremble{0%,100%{transform:none}25%{transform:translateX(-2.5%)}75%{transform:translateX(2.5%)}}
  }
  /* Posé sur son rond flottant au-dessus d'une commande (aucune place sans) : il laisse passer le clic. */
  #buddyRoam.nid-passe,#buddyRoam.nid-passe *{pointer-events:none!important}
  /* Téléphone : la fin de chaque page laisse la place d'Odin au-dessus de la barre du bas, pour que la dernière ligne puisse passer au-dessus de lui. */
  @media (max-width:599px){.view.on>.body::after{content:"";display:block;height:84px;pointer-events:none}}`;
  // Le rond flottant de son nid (ordinateur, plein écran) : 54 px en bas à droite, juste sous lui ; il ne prend ni la
  // souris ni le doigt (c'est Odin, posé dessus, qui les reçoit). Montré seulement quand Odin y est.
  const CSS_NID = `
  #odinNid{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom));z-index:49;width:54px;height:54px;box-sizing:border-box;border-radius:50%;background:var(--panel,#171A20);border:1px solid var(--line,#333);box-shadow:0 6px 18px rgba(0,0,0,.22);pointer-events:none}
  #odinNid[hidden]{display:none}
  @media print{#odinNid{display:none!important}}`;

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
    // Un disque transparent de toute sa place, sous son corps : sur téléphone, la zone à toucher garde sa taille (45 px) quelle que soit sa posture.
    const svg = b.querySelector('svg');
    if (svg && !svg.querySelector('.touche')) {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('class', 'touche'); c.setAttribute('cx', '60'); c.setAttribute('cy', '60'); c.setAttribute('r', '60'); c.setAttribute('fill', 'transparent');
      svg.insertBefore(c, svg.firstChild);
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
  /** Les rectangles du texte posé directement dans un élément (mesurés une fois par élément et par mesure de la page). */
  function textRects(el) {
    const out = [];
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      for (const q of r.getClientRects()) out.push({ l: q.left - 6, r: q.right + 6, t: q.top - 6, b: q.bottom + 6 });
    }
    return out;
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
  // `scanMemo` : le temps d'une mesure, ce qu'on sait déjà de chaque élément rencontré (à lui ? une commande ? où est son
  // texte ?). Des centaines de points tombent sur le même élément : on ne le regarde qu'une fois (même résultat, bien plus vite).
  let zones = [], scanDepth = 0, scanMemo = null;
  function kindHere(x, y) {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return 3;
    for (const z of zones) if (x >= z.l && x <= z.r && y >= z.t && y <= z.b) return 9;
    const top = document.elementFromPoint(x, y);
    if (!top || top === document.documentElement || top === document.body) return 0;
    let m = scanMemo && scanMemo.get(top);
    if (!m) { const sien = Boolean(top.closest(OWN)); m = { sien, cmd: !sien && Boolean(top.closest(BUSY_SEL)), txt: null }; if (scanMemo) scanMemo.set(top, m); }
    if (m.sien) return 0;
    if (m.cmd) return 3;
    if (!m.txt) m.txt = textRects(top);
    for (const q of m.txt) if (x >= q.l && x <= q.r && y >= q.t && y <= q.b) return 1;
    return 0;
  }
  /** Le temps d'une mesure, Odin et ce qui est à lui laissent passer la souris : on voit ce qu'il y a dessous. */
  function scanning(fn) {
    const h = document.documentElement;
    if (!scanDepth++) { h.classList.add('odin-scan'); zones = zonesNow(); scanMemo = new Map(); }
    try { return fn(); } finally { if (!--scanDepth) { h.classList.remove('odin-scan'); scanMemo = null; } }
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
  // `want` : rien (au plus près d'où il est) · { x, y } (au plus près de ce point) · { neuf } (loin de ses 6 dernières
  // places : il va voir ailleurs) · { x, y, anneau: [a, b] } (près du point sans être dessus : entre a et b pixels) ·
  // { x, y, loin } (le plus loin du point, à 200 px au moins). `sauf` (avec le reste) : des places déjà refusées (aucun
  // chemin libre pour y aller) ; on cherche à plus de 160 px d'elles.
  function choose(want) {
    const G = grid(); if (!G) return null;
    const { A, step } = G, b = bubble(), phone = innerWidth < 600, ptr = lastPtr && Date.now() - lastPtr.at < 4000 ? lastPtr : null;
    for (const n of [5, 4, 3]) {
      const s = n * step; let best = null;
      for (let j = 0; j + n < G.rows; j++) for (let i = 0; i + n < G.cols; i++) {
        const c = G.cover(i, j, n); if (c.t || c.c || c.z) continue;
        const x = A.left + i * step, y = A.top + j * step, cx = x + s / 2, cy = y + s / 2;
        if (want?.sauf?.length && want.sauf.some((q) => Math.hypot(x - q.x, y - q.y) < 160)) continue;
        let score = 0;
        const d = want && Number.isFinite(want.x) && Number.isFinite(want.y) ? Math.hypot(cx - want.x, cy - want.y) : 0;
        const ici = pos ? Math.hypot(cx - (pos.x + size / 2), cy - (pos.y + size / 2)) : 0;
        if (want?.neuf) { for (const q of places) score += 300 / (1 + Math.hypot(cx - q.x, cy - q.y) / 80); }
        else if (want?.anneau) { const [a, z] = want.anneau; score += (d < a ? 400 + (a - d) * 4 : d > z ? d - z : 0) + ici * 0.1; }
        else if (want?.loin) score += d < 200 ? 4000 - d : -d;
        else if (want) score += d;
        else score += ici * 0.25;
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
  /** Sa pastille le suit : on la prévient quand il bouge ou change de taille (elle ne se replace plus à chaque image quand il est immobile). */
  const suivi = () => { try { window.OdinNotices?.suivre?.(); } catch { /* la pastille n'est pas prête */ } };
  function setSize(s) { size = s; bud.style.setProperty('--rs', `${s}px`); suivi(); }
  // Ses déplacements sont tous faits ici, image par image (classe `path` : plus de glissement en ligne droite par le CSS).
  function stopWalk() { if (!walking) return; cancelAnimationFrame(walking.raf); clearTimeout(walking.t); walking = null; bud?.classList.remove('walk', 'slip'); }
  function put(x, y) { pos = { x, y }; bud.style.translate = `${Math.round(x)}px ${Math.round(y)}px`; suivi(); }
  /** Il est arrivé quelque part : on retient la place (les 6 dernières), pour qu'une promenade l'emmène ailleurs. */
  function arrive() {
    if (!pos) return;
    const c = { x: pos.x + size / 2, y: pos.y + size / 2 }, d = places[places.length - 1];
    if (d && Math.hypot(d.x - c.x, d.y - c.y) < 8) return;
    places.push(c); if (places.length > 6) places.shift();
  }
  /** Il se cache (fondu), change de place, et ressort : premier placement, aucun chemin libre, ou mouvement réduit. */
  function slip(p, then) {
    stopWalk();
    if (!pos) { setSize(p.s); put(p.x, p.y); arrive(); then?.(); return; }
    bud.classList.add('slip');
    const w = walking = { raf: 0, t: 0 };
    w.t = setTimeout(() => {
      if (walking !== w) return;
      setSize(p.s); put(p.x, p.y); bud.classList.remove('slip');
      w.t = setTimeout(() => { if (walking !== w) return; walking = null; arrive(); act('act-joy', 1100); then?.(); }, 280);
    }, 280);
  }
  function walkAlong(pts, s, then) {
    // Mouvement réduit : pas de marche ; il se cache en fondu et ressort à sa place.
    if (reduce.matches) { const e = pts[pts.length - 1]; slip({ x: e.x, y: e.y, s }, then); return; }
    stopWalk();
    const seg = []; let L = 0; for (let k = 1; k < pts.length; k++) { const d = Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y); seg.push(d); L += d; }
    if (L < 3) { setSize(s); put(pts[pts.length - 1].x, pts[pts.length - 1].y); arrive(); then?.(); return; }
    bud.classList.add('walk');
    if (s < size) setSize(s); // il rapetisse avant de passer, grandit en arrivant
    const v = Math.max(230, L / 3.2), T = (L / v) * 1000, t0 = performance.now();
    const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
    /** Le point du chemin à la distance D de son départ. */
    const at = (D) => { let d = Math.max(0, Math.min(L, D)), k = 0; while (k < seg.length - 1 && d > seg[k]) { d -= seg[k]; k++; } const a = pts[k], b = pts[k + 1], f = seg[k] ? Math.min(1, d / seg[k]) : 1; return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, k }; };
    const gene = (c) => Boolean(c.t || c.c || c.z);
    let lastSeg = -1, vuLe = 0, propre = false;
    const frame = (now) => {
      if (!walking) return;
      const u = Math.min(1, (now - t0) / T), D = L * ease(u), q = at(D);
      put(q.x, q.y);
      if (q.k !== lastSeg) { lastSeg = q.k; const b = pts[q.k + 1]; lookAt(b.x + size / 2, b.y + size / 2); }
      // La page a pu changer pendant qu'il marche (elle finit de se charger, une carte s'ouvre). Cinq fois par seconde, une
      // fois sorti de sa place de départ : si du contenu est apparu devant lui ou à l'arrivée, il ne traverse pas, il finit
      // en fondu (à sa place prévue si elle est encore libre, sinon à une autre).
      if (u < 1 && now - vuLe > 200) {
        vuLe = now;
        if (!propre) propre = !gene(under(q.x, q.y, size));
        if (propre) {
          const e = pts[pts.length - 1], devant = at(D + size);
          const pris = gene(under(e.x, e.y, s));
          if (pris || gene(under(devant.x, devant.y, size))) { const p = pris ? choose(null) : { x: e.x, y: e.y, s }; if (p) { slip(p, then); return; } }
        }
      }
      if (u < 1) walking.raf = requestAnimationFrame(frame);
      else end();
    };
    // Onglet caché (plus d'images) : il arrive quand même, à la fin du temps prévu.
    const end = () => { if (!walking) return; cancelAnimationFrame(walking.raf); clearTimeout(walking.t); walking = null; bud.classList.remove('walk'); const e = pts[pts.length - 1]; put(e.x, e.y); setSize(s); arrive(); then?.(); };
    walking = { raf: requestAnimationFrame(frame), t: setTimeout(end, T + 1500) };
  }
  /**
   * Aller à la place p : à pied par un chemin libre ; sinon il se cache et ressort. Un déplacement qu'il a choisi
   * lui-même (`wander` : une étape « aller » d'un plan) est annulé s'il n'y a pas de chemin libre, ou en mouvement
   * réduit. Rend true s'il y va ; `then` est appelé à l'arrivée.
   */
  function moveTo(p, wander, then) {
    if (!bud || !p) return false;
    // Dans son nid : il en sort en fondu, pour réapparaître à sa place (jamais à pied depuis le nid).
    if (nid) { if (wander && reduce.matches) return false; sortirNid(p, then); return true; }
    if (!pos || bud.hidden) { slip(p, then); return true; }
    if (Math.hypot(p.x - pos.x, p.y - pos.y) < 4) { if (p.s !== size) setSize(p.s); then?.(); return true; }
    if (wander && reduce.matches) return false;
    const G = grid(); if (!G) { if (wander) return false; slip(p, then); return true; }
    const n = Math.min(p.n ?? 5, Math.max(3, Math.min(5, Math.round(size / G.step))));
    const at = (x, y) => ({ i: Math.round((x - G.A.left) / G.step), j: Math.round((y - G.A.top) / G.step) });
    const r = route(G, at(pos.x, pos.y), { i: p.i ?? at(p.x, p.y).i, j: p.j ?? at(p.x, p.y).j }, n);
    // Pas de chemin libre, ou il passerait par ta zone de travail : il ne traverse pas, il se faufile (fondu).
    if (!r || r.zone || r.rough) { if (wander) return false; slip(p, then); return true; }
    // Du contenu est apparu sous lui (la page a fini de se charger, une carte s'est ouverte) : il n'en sort pas à pied par-dessus, il s'efface et ressort.
    const ici = under(pos.x, pos.y, size);
    if (ici.t || ici.c || ici.z) { if (wander) return false; slip(p, then); return true; }
    r.pts[0] = { x: pos.x, y: pos.y }; r.pts[r.pts.length - 1] = { x: p.x, y: p.y };
    walkAlong(r.pts, p.s, then);
    return true;
  }
  function go(want) { if (Date.now() < pinnedUntil && !want?.force) return; const p = choose(want); if (p) { if (p.corner) nicher(); else moveTo(p); } return p; }
  function act(name, ms = 1400) { if (!bud || reduce.matches) return; bud.classList.remove(name); void bud.offsetWidth; bud.classList.add(name); setTimeout(() => bud.classList.remove(name), ms); }
  function lookAt(x, y) {
    if (!bud) return;
    const r = bud.getBoundingClientRect(), dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1;
    bud.classList.add('follow'); bud.style.setProperty('--ex', `${(dx / d * 5).toFixed(1)}px`); bud.style.setProperty('--ey', `${(dy / d * 4).toFixed(1)}px`);
    clearTimeout(lookAt._t); lookAt._t = setTimeout(() => bud.classList.remove('follow'), 2500);
  }

  // ---------- Son nid : le rond de la barre du bas (téléphone), sinon un rond flottant ----------
  /** Le rond flottant (créé une fois, caché tant qu'il n'y est pas). */
  let disque = null;
  function rondFlottant() {
    if (disque) return disque;
    disque = document.createElement('div'); disque.id = 'odinNid'; disque.hidden = true; disque.setAttribute('aria-hidden', 'true');
    document.body.append(disque);
    return disque;
  }
  // La place du rond flottant : en bas à droite (maquette), sauf s'il y couvrirait une commande ou ta zone de travail
  // (Odin, posé dessus, prendrait le clic). Alors la place qui en couvre le moins : les autres coins, puis le milieu des
  // bords. Jamais sur le rond de sortie du plein écran (ni tout près). Une place qui ne gêne pas est gardée (le rond ne
  // saute pas d'un coin à l'autre pour un peu de texte). S'il n'y a nulle part sans commande, Odin posé sur le rond
  // laisse passer la souris et le doigt (`passe`) : la commande dessous reçoit le clic.
  let coinNid = 'bd', passe = false;
  const COINS = ['bd', 'bg', 'hd', 'hg', 'bm', 'md', 'mg', 'hm'];
  /** Odin laisse passer le clic seulement posé sur le rond flottant au-dessus d'une commande. */
  function passer() { bud?.classList.toggle('nid-passe', nid === 'rond' && passe); }
  /** Les boutons « sortir du plein écran » visibles (le ✕ de l'accueil, celui des applis) : le rond ne va jamais dessus. */
  function sorties() { const out = []; for (const e of document.querySelectorAll('#feSortie,.fe-sortie,.va-pe-sortie')) { const r = e.getBoundingClientRect(); if (r.width && r.height && getComputedStyle(e).visibility !== 'hidden') out.push(r); } return out; }
  function placeCoin(k, A) {
    const t = 54, m = 18;
    const x = k[1] === 'd' ? innerWidth - m - t : k[1] === 'g' ? A.left + 12 : (A.left + A.right - t) / 2;
    const y = k[0] === 'b' ? innerHeight - m - t : k[0] === 'h' ? A.top + 12 : (A.top + A.bottom - t) / 2;
    return { x, y };
  }
  function choisirCoin() {
    const A = area(); if (!A) return;
    const S = sorties(), t = 54, m = 12;
    const gene = (k) => {
      const p = placeCoin(k, A);
      if (S.some((r) => p.x < r.right + m && p.x + t > r.left - m && p.y < r.bottom + m && p.y + t > r.top - m)) return { k, g: Infinity };
      const c = under(p.x, p.y, t); return { k, g: c.c * 6 + c.z * 60 };
    };
    let best = gene(coinNid);
    if (best.g) for (const k of COINS) { if (k === coinNid) continue; const o = gene(k); if (o.g < best.g) best = o; }
    passe = best.g > 0;
    if (best.k === coinNid) return;
    coinNid = best.k;
    const d = rondFlottant();
    if (coinNid === 'bd') { d.removeAttribute('style'); return; }
    const p = placeCoin(coinNid, A);
    d.style.cssText = `left:${Math.round(p.x)}px;top:${Math.round(p.y)}px;right:auto;bottom:auto`;
  }
  /**
   * Quel nid sur cet écran : le rond de la barre du bas s'il est affiché (téléphone ; aussi quand le clavier de l'écran
   * la cache un instant), sinon le rond flottant (ordinateur, et en plein écran où les barres sont recouvertes).
   */
  function sorteNid() {
    if (document.querySelector('.pe-plein')) return 'rond';
    const r = document.getElementById('bnavOdin');
    if (r && r.getClientRects().length) return 'barre';
    if (r && document.body.classList.contains('kb') && innerWidth <= 860) return 'barre';
    return 'rond';
  }
  /** Le met à sa place dans son nid : caché au profit du rond de la barre (qui le montre), ou posé sur le rond flottant. */
  function peindreNid() {
    const d = rondFlottant();
    passer();
    if (nid === 'barre') {
      d.hidden = true; bud.hidden = true;
      // Sa place retenue est celle du rond (sa prochaine sortie part de là).
      const r = document.getElementById('bnavOdin')?.getBoundingClientRect(), s = Math.min(size, 46);
      if (r && r.width && (!pos || Math.abs(pos.x - (r.left + (r.width - s) / 2)) > 1 || Math.abs(pos.y - (r.top + (r.height - s) / 2)) > 1)) { if (size !== s) setSize(s); put(r.left + (r.width - s) / 2, r.top + (r.height - s) / 2); }
      else if (!pos) put(innerWidth / 2 - s / 2, innerHeight - s);
      return;
    }
    if (!nid || !montre) { d.hidden = true; return; }
    bud.hidden = false;
    // Sur une page qui a sa propre mascotte et cache celle-ci (la maison, Vénus), le rond vide ne se montre pas non plus.
    d.hidden = getComputedStyle(bud).visibility === 'hidden';
    const s = 40, t = 54, m = 18, r = d.hidden ? null : d.getBoundingClientRect();
    const x = r && r.width ? r.left + (r.width - s) / 2 : innerWidth - m - t + (t - s) / 2, y = r && r.height ? r.top + (r.height - s) / 2 : innerHeight - m - t + (t - s) / 2;
    if (size !== s) setSize(s);
    if (!pos || Math.abs(pos.x - x) > 1 || Math.abs(pos.y - y) > 1) put(x, y);
  }
  /** Le range tout de suite dans son nid (il est déjà effacé, ou il apparaît là). */
  function nicherIci() {
    nid = sorteNid(); poser(null); untip(); hovered = false;
    if (nid === 'barre') { stopWalk(); bud.classList.remove('slip'); }
    else { coinNid = 'bd'; rondFlottant().removeAttribute('style'); choisirCoin(); }
    peindreNid();
  }
  /** Il rentre dans son nid : il s'efface là où il est, et réapparaît dans le nid (le rond de la barre le montre). */
  function nicher() {
    if (!bud || nid) return;
    stopWalk(); arreter();
    if (!pos || bud.hidden) { nicherIci(); return; }
    bud.classList.add('slip');
    const w = walking = { raf: 0, t: 0 };
    w.t = setTimeout(() => { if (walking !== w) return; walking = null; nicherIci(); void bud.offsetWidth; bud.classList.remove('slip'); }, 280);
  }
  /** Il sort de son nid vers la place p : en fondu (du rond flottant), ou il apparaît (le rond de la barre reprend sa rune). */
  function sortirNid(p, then) {
    const k = nid; nid = null; rondFlottant().hidden = true; passer();
    if (k !== 'barre') { slip(p, then); return; }
    stopWalk(); bud.classList.add('slip'); bud.hidden = !montre;
    setSize(p.s); put(p.x, p.y); arrive();
    void bud.offsetWidth; bud.classList.remove('slip');
    then?.();
  }
  /** Dans son nid, à chaque battement : le bon nid pour cet écran, et il sort dès qu'une place libre se montre (toutes les 6 s au plus). */
  function garderNid(now) {
    if (sorteNid() !== nid) { nid = null; nicherIci(); return; }
    peindreNid();
    if (now < retryAt || now < pinnedUntil) return;
    chercheLe = now; retryAt = now + 6000;
    const p = choose(null); if (p && !p.corner) { sortirNid(p); return; }
    if (nid === 'rond') { choisirCoin(); peindreNid(); }
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
    montre = show;
    // Rangé dans le rond de la barre du bas : c'est le rond qui le montre (une seule mascotte à l'écran).
    bud.hidden = !show || nid === 'barre';
    if (!show || nid !== 'rond') rondFlottant().hidden = true;
    if (!show) { if (v && v !== view) window.OdinVie?.noter?.({ k: 'page', id: v }); view = v; clearTimeout(pageT); pageT = 0; stopWalk(); bud.classList.remove('slip', 'v-vite'); arreter(); untip(); return; }
    if (drag || walking) return;
    // Changement de page : le moteur de vie le sait (c'est lui qui décide s'il regarde autour de lui), et il se replace
    // quand la page est posée : en fondu, jamais à pied à travers une page qui se charge.
    if (v !== view) {
      view = v; pinnedUntil = 0; arreter();
      if (window.OdinVie?.noter) window.OdinVie.noter({ k: 'page', id: v }); else window.OdinFace?.flash(bud, 'regarde', 1600);
      attendrePage();
      return;
    }
    if (pageT) return;
    if (!pos) { attendrePage(); return; }
    if (nid) { garderNid(Date.now()); return; }
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
    // Sur une commande faute de mieux : dès que la page a changé depuis sa dernière recherche, il recherche (1,5 s au plus, jamais 6).
    if (urgent && mutAt > chercheLe) retryAt = Math.min(retryAt, chercheLe + 1500);
    if (out || (urgent && now >= retryAt) || (soft && (fresh || now >= retryAt)) || Math.abs(size - baseSize()) > 30) {
      chercheLe = now;
      const before = `${Math.round(pos.x)},${Math.round(pos.y)}`;
      const p = choose(urgent && !free ? { x: pos.x + size / 2, y: pos.y + size / 2 } : null);
      // Aucune place libre (seulement un coin, sur du contenu) : il rentre dans son nid au lieu de s'y serrer.
      if (p && p.corner && !mine) { nicher(); retryAt = now + 6000; return; }
      if (p && `${Math.round(p.x)},${Math.round(p.y)}` !== before) { poser(null); moveTo(p); }
      retryAt = now + (p && !p.corner ? 1500 : 6000);
    }
    if (!vie()) seul(now);
  }
  /**
   * Changement de page, ou premier placement : il s'efface, attend que la page soit posée (plus rien n'y change depuis
   * 300 ms ; 1,5 s au plus), puis ressort à une place libre. Un seul fondu : il ne choisit pas sa place sur une page
   * encore vide (« Chargement… »), et ne traverse pas ce qui s'y affiche ensuite.
   */
  function attendrePage() {
    stopWalk(); clearTimeout(pageT);
    const debut = Date.now();
    bud.classList.add('v-vite', 'slip');
    const essai = () => {
      pageT = 0;
      if (!bud || !montre) { bud?.classList.remove('slip', 'v-vite'); return; }
      const now = Date.now();
      if (now - Math.max(mutAt, debut) < 300 && now - debut < 1500) { pageT = setTimeout(essai, 100); return; }
      const p = choose(null);
      // Pas de place libre sur la page posée : il réapparaît dans son nid ; sinon, il en sort pour cette place.
      if (!p || p.corner) nicherIci();
      else { if (nid) { nid = null; rondFlottant().hidden = true; bud.hidden = false; passer(); } setSize(p.s); put(p.x, p.y); arrive(); }
      bud.classList.remove('v-vite'); void bud.offsetWidth; // le fondu de retour repart d'ici
      bud.classList.remove('slip'); chercheLe = retryAt = Date.now(); retryAt += 1500;
    };
    pageT = setTimeout(essai, 100);
  }
  // ---------- Sans le moteur de vie (vie.js absent ou en pause) : un battement minimal, sans hasard, sans promenade ----------
  // Un geste « avance » toutes les 8 secondes quand Odin travaille ; aller voir ce qui demande l'attention au plus toutes les 25 secondes.
  function seul(now) {
    if (!bud || bud.hidden || drag || walking || hovered || plan || now < pinnedUntil) return;
    if (S().busy?.()) { if (now - seulGeste > 8000) { seulGeste = now; act('act-advance', 1200); } return; }
    if (now - seulVoir <= 25_000) return;
    const need = attention(); if (!need) return;
    seulVoir = now; go(need);
    setTimeout(() => { window.OdinFace?.flash(bud, need.mood, 2200); act('act-tilt', 1600); }, 1200);
  }

  // ---------- Ce qui l'intéresse : alertes, messages d'état, nouveautés ----------
  function attention() {
    const v = document.querySelector('.view.on'); if (!v) return null;
    const cands = [...v.querySelectorAll('.bad,[role=alert],.badge:not([hidden]),.warn')].filter((e) => e.offsetParent && e.textContent.trim());
    for (const e of cands) { const r = e.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) return { x: r.right + 40, y: r.top + r.height / 2, mood: 'inquiet', texte: e.textContent.trim().replace(/\s+/g, ' ').slice(0, 60) }; }
    return null;
  }
  /**
   * Une zone d'état de la page (aria-live, role=status) ne change plus depuis 800 ms : on note au moteur de vie ce
   * qu'elle dit, une fois. C'est le cœur du moteur qui juge (jugerZone) : rien pour une zone qui défile (une dictée,
   * une réponse qui s'écrit mot à mot), rien pour le même texte réaffiché, « réussite » ou « échec » seulement pour un
   * message court. La clé du fait est la zone, pas son texte : un texte qui s'écrit petit à petit ne fait pas 40 faits.
   */
  function zoneCalme(zone, z) {
    z.t = 0;
    const V = vie(), juger = window.OdinVieCoeur?.jugerZone;
    if (!V || typeof juger !== 'function' || !bud || bud.hidden || !zone.isConnected || !zone.closest('.view.on')) return;
    const txt = zone.textContent.trim().replace(/\s+/g, ' '); if (!txt) return;
    const r = zone.getBoundingClientRect(); if (!r.width || !r.height) return;
    const k = juger(z, txt, Date.now()); if (!k) return;
    V.noter({ k, id: z.id, texte: txt.slice(0, 60), x: r.right + 30, y: r.top + r.height / 2 });
  }
  const live = new MutationObserver((ms) => {
    const now = Date.now();
    // La page vient de changer (pas lui, ni une autre mascotte) : il le retient, pour attendre qu'elle soit posée avant de s'y placer.
    for (const m of ms) { const t = m.target.nodeType === 3 ? m.target.parentElement : m.target; if (t && !t.closest?.(`${OWN},.odin`)) { mutAt = now; break; } }
    if (!bud || bud.hidden) return;
    const V = vie();
    if (!V && (drag || walking || now < pinnedUntil)) return;
    for (const m of ms) {
      const t = m.target.nodeType === 3 ? m.target.parentElement : m.target;
      const zone = t?.closest?.('[aria-live],[role=status]'); if (!zone || !zone.closest('.view.on') || zone.closest(OWN)) continue;
      if (V) {
        // Avec le moteur de vie, il ne bouge plus et ne se colore plus tout seul : on attend que la zone se calme, puis on
        // note ce qu'elle dit (réussite, échec ou nouveauté) ; c'est le moteur qui décide s'il va voir, et quand.
        let z = zonesLive.get(zone); if (!z) zonesLive.set(zone, z = { t: 0, id: `z${++zoneN}`, fois: [] });
        if (!z.fois.length || now - z.fois[z.fois.length - 1] > 150) { z.fois.push(now); if (z.fois.length > 8) z.fois.shift(); }
        clearTimeout(z.t); z.t = setTimeout(() => zoneCalme(zone, z), 800);
        continue;
      }
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
  /** Le texte de l'infobulle : où tu es, puis ce qu'il fait et pourquoi (dit par le moteur de vie), puis comment lui parler. */
  function tipText() {
    const where = window.OdinGuide?.where?.() || '';
    const n = window.OdinNotices?.unread?.() ?? 0;
    let pourquoi = ''; try { pourquoi = window.OdinVie?.pourquoi?.()?.phrase || ''; } catch { /* le moteur de vie n'est pas prêt */ }
    return `Odin${where ? ` · ${where}` : ''}${pourquoi ? `\n${pourquoi}` : ''}\nTouche-moi : je t'explique cette page pas à pas, ou parle-moi.${n ? `\n${n} notification${n > 1 ? 's' : ''} non lue${n > 1 ? 's' : ''} (la pastille).` : ''}`;
  }

  // ---------- Toi : il te regarde, réagit au survol, s'écarte si tu vises à côté, se laisse déplacer ----------
  let drag = null, hov = null, lastHello = 0;
  function onMove(e) {
    const now = Date.now(); idleSince = now; lastPtr = { x: e.clientX, y: e.clientY, at: now };
    if (!bud || bud.hidden || drag) return;
    const r = bud.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, d = Math.hypot(e.clientX - cx, e.clientY - cy);
    const over = e.target instanceof Element && bud.contains(e.target);
    // (Mouvement réduit : ses yeux ne sautent pas pour suivre la souris ; il ne regarde que lorsqu'un plan le demande.)
    if (d < 240 && !reduce.matches) lookAt(e.clientX, e.clientY);
    if (e.pointerType === 'mouse') {
      if (over && !hovered) {
        // Début d'un survol : il te regarde (le visage tient ce regard un instant), et le moteur de vie le sait.
        hovered = true; tip(tipText(), bud, 300);
        window.OdinVie?.noter?.({ k: 'survol' });
        const F = window.OdinFace;
        if (typeof F?.tenir === 'function') F.tenir(bud, 'regarde', 'survol', 1400); else F?.flash(bud, 'regarde', 1400);
        if (now - lastHello > 6000) { lastHello = now; act('act-tilt', 900); }
        // Tu restes sur lui plus d'une seconde : une caresse (une fois par survol).
        clearTimeout(caresseT); caresseT = setTimeout(() => { if (hovered && !drag) window.OdinVie?.noter?.({ k: 'caresse' }); }, 1200);
      } else if (!over && hovered && d > r.width * 0.6) { hovered = false; clearTimeout(caresseT); untip(); }
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
    untip(); clearTimeout(caresseT);
    drag = { x0: e.clientX, y0: e.clientY, px: pos?.x ?? 0, py: pos?.y ?? 0, moved: false, id: e.pointerId, trace: [], long: 0, embete: false };
  }
  function onDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    // Tu le soulèves : le plan en cours s'arrête, il s'étonne.
    if (!drag.moved) { drag.moved = true; stopWalk(); arreter(); bud.classList.add('dragging'); ressent('etonnement', 1500, 'glisse', 'surprise'); if (nid) { nid = null; rondFlottant().hidden = true; passer(); } }
    put(Math.max(0, Math.min(innerWidth - size, drag.px + dx)), Math.max(0, Math.min(innerHeight - size, drag.py + dy)));
    // Secoué : plus de 1500 px parcourus en moins de 2 secondes. Le moteur de vie le sait (une fois par glissé).
    const now = Date.now(), T = drag.trace, last = T[T.length - 1], pas = last ? Math.hypot(e.clientX - last.x, e.clientY - last.y) : 0;
    T.push({ t: now, x: e.clientX, y: e.clientY, d: pas }); drag.long += pas;
    while (T.length && now - T[0].t > 2000) drag.long -= T.shift().d;
    if (!drag.embete && drag.long > 1500) { drag.embete = true; window.OdinVie?.noter?.({ k: 'embete' }); }
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.moved) { bud.classList.remove('dragging'); pinnedUntil = userPinnedUntil = Date.now() + 120_000; arrive(); if (!drag.embete) ressent('contentement', 1500, 'glisse', 'joie'); }
    else {
      // Un simple toucher : il répond (« oui ? »), et la petite fenêtre pour lui parler s'ouvre, sur n'importe quel onglet.
      // Les clics rapides (1 à 100) : 1 = lui parler, les autres font ce qui est réglé (Réglages → Apparence) ; seul le
      // premier toucher d'une série est un appel, les suivants sont comptés par mascotte.js.
      stopWalk();
      const now = Date.now(), premier = now - lastTap > 1200; lastTap = now;
      if (premier) { if (typeof window.OdinVie?.appeler === 'function') window.OdinVie.appeler('toucher', { x: e.clientX, y: e.clientY }); else window.OdinFace?.flash(bud, 'ecoute', 1500); }
      if (window.OdinMascotte?.tap) window.OdinMascotte.tap(bud); else window.OdinNotices?.talk?.();
    }
    drag = null;
  }

  // ---------- Les plans : ce que le moteur de vie (vie.js) lui demande de faire, étape par étape ----------
  // Une étape : ['aller', place, { x, y }?] · ['regarder', qui] · ['geste', nom, ms] · ['pose', nom | null] · ['attendre', ms].
  // Il ne décide pas pourquoi (c'est le moteur de vie), seulement où : toujours une place libre, par un chemin libre,
  // jamais dans ta zone de travail. Un déplacement refusé (tu le tiens, il est retenu par sa petite fenêtre, promenade
  // coupée dans les Réglages, mouvement réduit, pas de chemin libre) est sauté : la suite se joue sur place.
  const POSES = ['assis', 'dort', 'boude'];
  const GESTES = ['joy', 'sad', 'tilt', 'spin', 'wobble', 'advance', 'baille', 'etire', 'soupir', 'signe', 'roule', 'tremble'];
  function poser(nom) { if (!bud) return; pose = POSES.includes(nom) ? nom : ''; for (const p of POSES) bud.classList.toggle(`v-${p}`, p === pose); }
  const centre = () => (pos ? { x: pos.x + size / 2, y: pos.y + size / 2 } : null);
  /** Où est la personne : sa souris ou son doigt (depuis moins d'une minute), sinon le bas de la page ; `champ` : d'abord le champ où elle écrit. */
  function personne(champ) {
    const now = Date.now(), f = document.activeElement;
    if (champ && f instanceof Element && f.matches(FIELD_SEL) && now - lastKey < 60_000) { const r = f.getBoundingClientRect(); if (r.width && r.height) return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    if (lastPtr && now - lastPtr.at < 60_000) return { x: lastPtr.x, y: lastPtr.y };
    const A = area(); return A ? { x: (A.left + A.right) / 2, y: A.bottom } : { x: innerWidth / 2, y: innerHeight };
  }
  /** La place libre qui répond à une étape « aller » ; rien s'il n'y en a pas ; ICI s'il y est déjà. `sauf` : les places déjà refusées (aucun chemin libre). */
  function placePour(nom, pt, sauf) {
    const A = area(); if (!A) return null;
    let p = null;
    if (nom === 'libre_neuf') p = choose({ neuf: true, sauf });
    else if (nom === 'personne') { const q = personne(false), c = centre(); if (c && Math.hypot(c.x - q.x, c.y - q.y) <= 320) return ICI; p = choose({ x: q.x, y: q.y, anneau: [120, 260], sauf }); }
    else if (nom === 'cible') p = pt && Number.isFinite(pt.x) && Number.isFinite(pt.y) ? choose({ x: pt.x, y: pt.y, sauf }) : null;
    else if (nom === 'attention') { const a = attention(); p = a ? choose({ x: a.x, y: a.y, sauf }) : null; }
    else if (nom === 'coin') p = choose({ x: A.right, y: A.bottom, sauf });
    else if (nom === 'loin_personne') { const q = personne(false); p = choose({ x: q.x, y: q.y, loin: true, sauf }); }
    return p && !p.corner ? p : null;
  }
  function suite() {
    const P = plan; if (!P) return;
    if (!bud || bud.hidden) { arreter(); return; }
    if (P.i >= P.steps.length) { plan = null; P.fin?.(true, P.info); return; }
    const [quoi, a, b] = P.steps[P.i++];
    const apres = (ms) => { clearTimeout(P.t); P.t = setTimeout(() => { if (plan === P) suite(); }, ms); };
    if (quoi === 'aller') {
      const refus = drag || pageT || Date.now() < pinnedUntil || (S().roam && !S().roam()) || reduce.matches;
      // Si aucun chemin libre ne mène à la meilleure place (du texte, ta zone de travail sur la route), il essaie les
      // suivantes (4 au plus), ailleurs, au lieu de viser toujours la même et de rester sur place.
      // Garde-fou : si le trajet est coupé en route (tu défiles, la page change), le plan reprend quand même.
      let rendu = false, parti = false, deja = false;
      const vues = [];
      for (let k = 0; k < 4 && !refus && !parti; k++) {
        const p = placePour(a, b, vues);
        if (p === ICI) deja = true;
        if (!p || p === ICI) break;
        parti = moveTo(p, true, () => { rendu = true; if (plan === P) { lastWander = Date.now(); apres(120); } });
        if (!parti) vues.push({ x: p.x, y: p.y });
      }
      if (parti) { P.info.bouge = true; poser(null); if (!rendu) apres(9000); return; }
      // Il n'a pas bougé alors qu'il le voulait : on le dira au demandeur (il ne racontera pas une promenade qui n'a pas eu lieu).
      if (!deja) P.info.refus = true;
      apres(0);
    } else if (quoi === 'regarder') {
      const c = centre();
      if (a === 'personne') { const q = personne(true); lookAt(q.x, q.y); apres(0); }
      else if (a === 'ailleurs') { const q = personne(false); if (c) lookAt(2 * c.x - q.x, 2 * c.y - q.y); apres(0); }
      else if (a === 'autour') {
        // Trois regards à 600 ms d'écart : à gauche, à droite, en haut (un seul, sans attendre, en mouvement réduit).
        const A = area();
        if (!A || !c || reduce.matches) { apres(0); return; }
        [{ x: A.left, y: c.y - 40 }, { x: A.right, y: c.y - 40 }, { x: (A.left + A.right) / 2, y: A.top }].forEach((q, k) => { P.rs.push(setTimeout(() => { if (plan === P) lookAt(q.x, q.y); }, k * 600)); });
        apres(1800);
      } else if (a && Number.isFinite(a.x) && Number.isFinite(a.y)) { lookAt(a.x, a.y); apres(0); }
      else apres(0);
    } else if (quoi === 'geste') {
      const ms = Math.max(200, Math.min(6000, Number(b) || 1200));
      if (GESTES.includes(a)) act(`act-${a}`, ms);
      apres(reduce.matches ? 0 : ms);
    } else if (quoi === 'pose') { poser(a); apres(0); }
    else if (quoi === 'attendre') apres(Math.max(0, Math.min(60_000, Number(a) || 0)));
    else apres(0);
  }
  /**
   * Joue un plan (une liste d'étapes), dans l'ordre. Rend true s'il a commencé ; `fin(true | false, info)` est appelé à la
   * fin (false : coupé) ; info = { bouge (il s'est déplacé), refus (une étape « aller » n'a pas pu se faire) }. Un plan
   * déjà en cours n'est pas remplacé : arreter() d'abord (c'est ce que fait un plan urgent).
   */
  function jouer(steps, fin) {
    if (!bud || bud.hidden || drag || plan || !Array.isArray(steps)) return false;
    const liste = steps.filter((s) => Array.isArray(s) && typeof s[0] === 'string').slice(0, 12); if (!liste.length) return false;
    plan = { steps: liste, i: 0, t: 0, rs: [], fin: typeof fin === 'function' ? fin : null, info: { bouge: false, refus: false } };
    suite();
    return true;
  }
  /** Coupe le plan en cours et retire sa pose (un geste déjà lancé finit seul ; un trajet commencé va jusqu'à sa place libre). */
  function arreter() {
    const P = plan; plan = null;
    if (P) { clearTimeout(P.t); for (const t of P.rs) clearTimeout(t); P.fin?.(false, P.info); }
    poser(null);
  }
  /** Où il en est (pour le moteur de vie) : visible, place, taille, en marche, survolé, tenu, retenu, page, tu écris, depuis quand tu ne bouges plus, ta souris, son plan. */
  function etat() {
    const now = Date.now(), f = document.activeElement, vu = Boolean(bud && !bud.hidden), a = vu ? attention() : null;
    return {
      visible: vu, x: pos ? Math.round(pos.x) : 0, y: pos ? Math.round(pos.y) : 0, taille: size, marche: Boolean(walking), survol: hovered, tenu: Boolean(drag && drag.moved), epingle: now < pinnedUntil, vue: view,
      ecrit: f instanceof Element && f.matches(FIELD_SEL) && now - lastKey < 5000, inactifMs: now - idleSince, pointeur: lastPtr ? { x: lastPtr.x, y: lastPtr.y, at: lastPtr.at } : null,
      plan: plan ? { etape: plan.i, sur: plan.steps.length } : null, pose: pose || null, depuisMarche: now - lastWander, attention: a ? { x: a.x, y: a.y, texte: a.texte } : null,
      nid,
    };
  }

  // ---------- Ses réactions quand tu ranges tes widgets (maquette « Accueil », lot 22b) ----------
  // fenetre.js prévient (« odin:widget-geste ») quand un widget est pris, posé à une autre place, son coin tiré, ou sa
  // taille changée. Comme la maquette : il s'enthousiasme quand tu le prends, se concentre quand tu tires le coin, est
  // content quand c'est posé. L'émotion est demandée au visage (c'est lui qui la dessine, avec ses marques autour des
  // yeux) ; le mouvement : un geste et un regard vers le widget, ou un petit saut du rond de la barre quand il y est rangé.
  // Rien pour un membre de la famille (il ne range pas la fenêtre), rien tant qu'on ne sait pas qui regarde, et rien qui
  // bouge quand l'appareil demande moins d'animations.
  const REACTIONS = {
    prise: { emotion: 'excite', ms: 2600, repli: 'excite', geste: 'act-tilt', gms: 900 },
    coin: { emotion: 'concentration', ms: 2600, repli: 'concentration', geste: '', gms: 0 },
    pose: { emotion: 'joie', ms: 1800, repli: 'joie', geste: 'act-joy', gms: 1100 },
    taille: { emotion: 'joie', ms: 1600, repli: 'joie', geste: 'act-joy', gms: 1100 },
  };
  // `proprio` : la session est celle du propriétaire (l'état d'Odin ne porte pas « membre »).
  let proprio = false, etatVu = false, derniere = { quoi: '', le: 0 };
  function surEtat(etat) { etatVu = true; proprio = Boolean(etat && typeof etat === 'object' && !etat.membre); }
  addEventListener('odin:etat', (e) => surEtat(e && e.detail));
  // Le premier état a pu partir avant ce fichier : on demande alors qui regarde (comme pages/menu-ecrans.js).
  const quiRegarde = () => { if (etatVu) return; fetch('/api/account/me', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!etatVu && j && j.ok) surEtat({ membre: j.membre }); }).catch(() => { /* hors ligne : pas de réaction */ }); };
  if (document.readyState === 'complete') setTimeout(quiRegarde, 0); else addEventListener('load', quiRegarde);
  /** Le rond de la barre du bas fait un petit saut (Odin y est rangé) : le rond entier bouge, pas son dessin. */
  function sautille(el) { try { el.animate([{ transform: 'none' }, { transform: 'translateY(-12%) scale(1.06)', offset: 0.4 }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.3,1.4,.5,1)' }); } catch { /* vieux navigateur */ } }
  function reagir(e) {
    const d = e && e.detail, R = d && Object.hasOwn(REACTIONS, d.quoi) ? REACTIONS[d.quoi] : null;
    if (!R || !proprio || !bud || !montre) return;
    const now = Date.now(); if (d.quoi === derniere.quoi && now - derniere.le < 600) return; derniere = { quoi: d.quoi, le: now };
    // Celui qu'on voit : lui, ou sa copie du rond de la barre du bas quand il y est rangé.
    const vu = nid === 'barre' ? document.getElementById('buddyBas') : bud.hidden ? null : bud;
    if (!vu || !vu.getClientRects().length) return;
    const F = window.OdinFace;
    if (typeof F?.ressent === 'function') F.ressent(vu, R.emotion, { ms: R.ms, source: 'widget' }); else F?.flash?.(vu, R.repli, R.ms);
    if (reduce.matches) return;
    if (vu === bud) { if (R.geste) act(R.geste, R.gms); if (Number.isFinite(d.x) && Number.isFinite(d.y)) lookAt(d.x, d.y); }
    else if (R.geste) sautille(document.getElementById('bnavNid') || vu);
  }
  document.addEventListener('odin:widget-geste', reagir);

  function start() {
    bud = make(); if (!bud) return;
    { const st = document.createElement('style'); st.textContent = CSS + CSS_NID; document.head.append(st); }
    bud.classList.add('path');
    view = '';
    sync();
    const views = new MutationObserver(() => { stopWalk(); sync(); });
    for (const v of document.querySelectorAll('.view')) views.observe(v, { attributes: true, attributeFilter: ['class'] });
    live.observe(document.body, { subtree: true, childList: true, characterData: true });
    // Nouvelle taille d'écran : une place libre, sinon son nid (celui de ce nouvel écran).
    let rs = 0; addEventListener('resize', () => { clearTimeout(rs); rs = setTimeout(() => { pinnedUntil = 0; stopWalk(); arreter(); if (!montre) return; const p = choose(null); if (!p || p.corner) { nid = null; nicherIci(); } else if (nid) sortirNid(p); else slip(p); }, 200); });
    let sc = 0; document.addEventListener('scroll', () => { clearTimeout(sc); sc = setTimeout(() => sync(), 350); }, { passive: true, capture: true });
    addEventListener('pointermove', onMove, { passive: true });
    addEventListener('pointermove', onDrag, { passive: true });
    addEventListener('pointerdown', onDown, true);
    addEventListener('pointerup', onUp, true);
    addEventListener('pointercancel', onUp, true);
    document.documentElement.addEventListener('mouseleave', () => { if (hovered) { hovered = false; clearTimeout(caresseT); untip(); } });
    // Tu écris dans un champ : ce champ (et son formulaire) est ta zone de travail ; il s'en écarte s'il y est.
    document.addEventListener('focusin', (e) => { if (e.target instanceof Element && e.target.matches(FIELD_SEL)) { retryAt = 0; setTimeout(sync, 60); } }, true);
    addEventListener('keydown', () => { idleSince = lastKey = Date.now(); }, { passive: true });
    addEventListener('pointerdown', () => { idleSince = Date.now(); }, { passive: true });
    setInterval(sync, 1500);
  }
  // `pin` : il reste où il est pendant ce temps (quand il parle), et son plan en cours s'arrête ; `pin(0)` lui rend sa liberté.
  // `tip` / `untip` : la petite infobulle (aussi pour sa pastille).
  // `jouer` / `arreter` / `etat` : pour le moteur de vie (vie.js), qui décide ce qu'il fait et lui demande un plan.
  window.OdinCompanion = { go: (x, y) => go({ x, y, force: true }), act, lookAt, sync, pin: (ms) => { pinnedUntil = ms > 0 ? Date.now() + ms : 0; if (ms > 0) arreter(); }, tip, untip, jouer, arreter, etat };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 300)); else setTimeout(start, 300);
})();
