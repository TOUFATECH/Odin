// Graphe 3D léger des scripts d'Archytas, HONNÊTE sur la machine : un faux-3D dessiné sur une toile 2D (aucun
// WebGL, aucune bibliothèque, rien d'extérieur). Chaque script est un point placé de façon déterministe :
//   angle = sa mission · hauteur = combien il sert · profondeur (z) = sa fraîcheur (récent = devant).
// On fait tourner la scène à la main (pas de rotation continue, rien quand l'onglet est caché : petit processeur
// ménagé). Un clic ouvre le script ; quand deux points se superposent, c'est celui de devant qui s'ouvre. Une liste
// de boutons (cachée à l'œil) garde le clavier et les lecteurs d'écran.
//   Repli automatique vers la vue 2D riche (OdinArchytasSuivi) si : pas de carte graphique (WebGL absent),
//   « mouvement réduit » demandé, pas de contexte 2D, ou la première image met trop de temps (~12 ms).
// Chargée toute seule ; la page appelle OdinGraphe3D.mount(boîte, { nodes, edges }, { onOpen, onReplier }). Quand le
// graphe 3D commun (graphe-espace.js, OdinGrapheEspace) est chargé, c'est lui qui dessine, avec les places d'ici.
// OdinGraphe3D.logique (sans document) : placer, projeter, choisir, doitReplier — vérifiées par archytas-graphe.test.ts.
(() => {
  'use strict';
  if (window.OdinGraphe3D) return;

  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };

  // ---------------- Logique pure (sans document)

  /** Un nombre stable dans [0, 1[ tiré d'un texte (pour poser l'angle d'une mission toujours au même endroit). */
  function empreinte(texte) {
    let h = 2166136261;
    const s = String(texte || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 100000) / 100000;
  }
  const borne01 = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

  /**
   * La place d'un script dans la scène, déterministe : angle depuis sa mission (sub), hauteur depuis son usage,
   * profondeur depuis sa fraîcheur. Résultat dans un cube [-1, 1].
   */
  function placer(noeud) {
    const a = empreinte(noeud && (noeud.sub || noeud.label || noeud.id)) * Math.PI * 2;
    const usage = borne01(noeud && noeud.usage);
    const frais = borne01(noeud && noeud.frais);
    return { x: Math.cos(a), y: usage * 2 - 1, z: frais * 2 - 1, a };
  }

  /**
   * Projette un point 3D sur l'écran (orthographique + petit effet de profondeur), après une rotation `rot` autour de
   * l'axe vertical. `prof` croît vers l'avant : plus il est grand, plus le point est près (donc dessiné dessus et gros).
   */
  function projeter(p, larg, haut, rot = 0) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const x = p.x * c - p.z * s;      // rotation autour de Y
    const z = p.x * s + p.z * c;
    const k = 0.78 + 0.22 * ((z + 1) / 2); // les points de devant s'écartent et grossissent un peu
    const cx = larg / 2, cy = haut / 2;
    const ech = Math.min(larg, haut) * 0.36;
    return { sx: cx + x * ech * k, sy: cy - p.y * ech, prof: z, taille: 6 + 7 * ((z + 1) / 2) };
  }

  /**
   * Choisit le point sous (x, y) : parmi ceux à portée (`rayon` px), celui de devant (plus grande profondeur).
   * `points` : [{ id, sx, sy, prof, taille }]. Rien dessous → null. C'est ainsi que deux points superposés ne
   * s'ouvrent pas au hasard : c'est toujours celui du dessus qui gagne.
   */
  function choisir(points, x, y, rayon) {
    let gagnant = null, meilleureProf = -Infinity;
    for (const p of points || []) {
      const port = rayon != null ? rayon : (p.taille || 8) + 4;
      const d = Math.hypot((p.sx || 0) - x, (p.sy || 0) - y);
      if (d <= port && p.prof > meilleureProf) { meilleureProf = p.prof; gagnant = p.id; }
    }
    return gagnant;
  }

  /**
   * Faut-il abandonner le faux-3D pour la vue 2D riche ? HONNÊTE : on tourne sur toile 2D, mais l'absence de WebGL
   * trahit une machine sans carte graphique ; on se replie aussi si « mouvement réduit », si aucun contexte 2D,
   * ou si la première image a été trop lente.
   */
  function doitReplier(o = {}) {
    if (o.ctx2d === false) return true;
    if (o.webgl === false) return true;
    if (o.reducedMotion) return true;
    if (typeof o.premiereImageMs === 'number' && o.premiereImageMs > (o.seuilMs || 12)) return true;
    return false;
  }

  // ---------------- Dessin (navigateur)

  const CSS = `
.ar-g{position:relative;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:color-mix(in srgb,var(--panel) 75%,var(--bg,#0b0d12));touch-action:none}
.ar-g canvas{display:block;width:100%;height:360px;cursor:grab}.ar-g canvas.on{cursor:pointer}.ar-g canvas.drag{cursor:grabbing}
.ar-g canvas:focus-visible{outline:2px solid var(--accent,#6b8afd);outline-offset:-3px}
.ar-g-note{position:absolute;left:10px;bottom:8px;right:10px;font-size:11.5px;color:var(--muted);background:color-mix(in srgb,var(--panel) 80%,transparent);padding:4px 8px;border-radius:8px;pointer-events:none}
.ar-g-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.ar-g-sr button{display:block}
`;
  function style() { if (!document.getElementById('ar-g-css')) document.head.append(el('style', { id: 'ar-g-css' }, CSS)); }

  const reducedMotion = () => { try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const webglDispo = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl') || c.getContext('experimental-webgl')); } catch { return false; } };
  const cssVar = (n, d) => { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d; } catch { return d; } };

  /**
   * Monte le graphe dans `boite`. data : { nodes: NoeudScript[], edges: [a,b][] }. opts.onOpen(id) à l'ouverture,
   * opts.onReplier(boite) si on bascule en 2D. Rend un petit pilote { replie, detacher, update }.
   */
  function mount(boite, data, opts = {}) {
    // Le graphe 3D commun (OdinGrapheEspace) quand il est chargé : chaque script garde sa place (placer), dans l'espace.
    const E = window.OdinGrapheEspace;
    if (E && typeof E.mount === 'function') {
      const nds = (data && Array.isArray(data.nodes) ? data.nodes : []).map((n) => { const p = placer(n); return { ...n, groupe: n.sub || '', pos: { x: p.x, y: p.y, z: p.z } }; });
      const c = E.mount(boite, { label: 'Carte des scripts', nodes: nds, edges: (data && data.edges) || [] }, { onOpen: opts.onOpen, onReplier: (b) => { if (typeof opts.onReplier === 'function') opts.onReplier(b); } });
      return { replie: c.replie, detacher: () => c.detacher(), update: (d2) => c.update({ nodes: ((d2 && d2.nodes) || []).map((n) => { const p = placer(n); return { ...n, groupe: n.sub || '', pos: { x: p.x, y: p.y, z: p.z } }; }), edges: (d2 && d2.edges) || [] }) };
    }
    style();
    const nodes = (data && Array.isArray(data.nodes) ? data.nodes : []);
    const edges = (data && Array.isArray(data.edges) ? data.edges : []);
    const onOpen = typeof opts.onOpen === 'function' ? opts.onOpen : () => {};

    const premier = doitReplier({ webgl: webglDispo(), reducedMotion: reducedMotion(), ctx2d: true });
    if (premier) { if (typeof opts.onReplier === 'function') opts.onReplier(boite); return { replie: true, detacher() {}, update() {} }; }

    const wrap = el('div', { class: 'ar-g' });
    const cvs = el('canvas', { tabindex: '0', role: 'img', 'aria-label': 'Graphe 3D des scripts : chaque point est un script, placé selon sa mission, son usage et sa fraîcheur.' });
    const sr = el('div', { class: 'ar-g-sr' });
    const note = el('div', { class: 'ar-g-note' }, 'Vue 3D légère, sans carte graphique (faux-3D sur toile 2D). Repli automatique en 2D si ça rame.');
    wrap.append(cvs, sr, note);
    boite.replaceChildren(wrap);

    const ctx = cvs.getContext && cvs.getContext('2d');
    if (!ctx) { if (typeof opts.onReplier === 'function') opts.onReplier(boite); return { replie: true, detacher() {}, update() {} }; }

    let rot = 0.5, places = [], points = [], dpr = 1, larg = 0, haut = 0;
    let liste = nodes.slice();

    function poser() {
      places = liste.map((nd) => ({ nd, p3: placer(nd) }));
      // Liste cachée pour le clavier et les lecteurs d'écran (accessibilité conservée).
      sr.replaceChildren(...places.map(({ nd }) => el('button', { type: 'button', onclick: () => onOpen(nd.id) }, `${nd.label || nd.id}${nd.sub ? ' — ' + nd.sub : ''}`)));
    }

    function taille() {
      const r = cvs.getBoundingClientRect();
      larg = Math.max(1, Math.round(r.width)); haut = Math.max(1, Math.round(r.height || 360));
      dpr = Math.min(1.5, (window.devicePixelRatio || 1)); // dpr plafonné : on ménage le petit processeur
      cvs.width = Math.round(larg * dpr); cvs.height = Math.round(haut * dpr);
    }

    function dessiner() {
      if (document.hidden) return; // rien quand l'onglet est caché
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, larg, haut);
      const ink = cssVar('--ink', '#e6e8ee'), muted = cssVar('--muted', '#9aa1b2'), accent = cssVar('--accent', '#6b8afd'), line = cssVar('--line', '#2a2e37');
      points = places.map(({ nd, p3 }) => ({ id: nd.id, label: nd.label || nd.id, usage: nd.usage, ...projeter(p3, larg, haut, rot) }));
      const parId = new Map(points.map((p) => [p.id, p]));
      // Liens derrière, points de l'arrière vers l'avant (peintre).
      ctx.strokeStyle = line; ctx.lineWidth = 1;
      for (const e of edges) { const a = parId.get(e[0] ?? e.a), b = parId.get(e[1] ?? e.b); if (!a || !b) continue; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); }
      ctx.globalAlpha = 1;
      const ordre = points.slice().sort((p, q) => p.prof - q.prof);
      for (const p of ordre) {
        const av = (p.prof + 1) / 2; // 0 (fond) .. 1 (devant)
        ctx.globalAlpha = 0.45 + 0.55 * av;
        ctx.fillStyle = accent;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, p.taille, 0, Math.PI * 2); ctx.fill();
        if (av > 0.62) { ctx.globalAlpha = 1; ctx.fillStyle = ink; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(p.label).slice(0, 18), p.sx, p.sy - p.taille - 4); }
      }
      ctx.globalAlpha = 1;
      if (!points.length) { ctx.fillStyle = muted; ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Aucun script à montrer pour l\'instant.', larg / 2, haut / 2); }
    }

    // Première image mesurée : trop lente → repli honnête.
    taille(); poser();
    const t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    dessiner();
    const t1 = (window.performance && performance.now) ? performance.now() : Date.now();
    if (doitReplier({ webgl: true, premiereImageMs: t1 - t0 })) {
      if (typeof opts.onReplier === 'function') opts.onReplier(boite);
      return { replie: true, detacher() {}, update() {} };
    }

    // Faire tourner à la main (glisser). Aucune animation continue.
    let glisse = null;
    const surPoint = (x, y) => choisir(points, x, y);
    cvs.addEventListener('pointerdown', (e) => { glisse = { x: e.clientX, rot }; cvs.classList.add('drag'); try { cvs.setPointerCapture(e.pointerId); } catch { /* rien */ } });
    cvs.addEventListener('pointermove', (e) => {
      if (glisse) { rot = glisse.rot + (e.clientX - glisse.x) / 140; dessiner(); return; }
      const r = cvs.getBoundingClientRect();
      cvs.classList.toggle('on', !!surPoint(e.clientX - r.left, e.clientY - r.top));
    });
    const relache = (e) => {
      if (!glisse) return;
      const bougé = Math.abs(e.clientX - glisse.x) > 4;
      cvs.classList.remove('drag'); glisse = null;
      if (!bougé) { const r = cvs.getBoundingClientRect(); const id = surPoint(e.clientX - r.left, e.clientY - r.top); if (id) onOpen(id); }
    };
    cvs.addEventListener('pointerup', relache);
    cvs.addEventListener('pointercancel', () => { cvs.classList.remove('drag'); glisse = null; });
    cvs.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { rot += e.key === 'ArrowLeft' ? -0.25 : 0.25; dessiner(); e.preventDefault(); } });

    let obs = null;
    try { obs = new ResizeObserver(() => { taille(); dessiner(); }); obs.observe(cvs); } catch { /* sans ResizeObserver : taille figée, acceptable */ }
    const surVisible = () => { if (!document.hidden) dessiner(); };
    document.addEventListener('visibilitychange', surVisible);

    return {
      replie: false,
      update(d2) { liste = (d2 && Array.isArray(d2.nodes)) ? d2.nodes.slice() : liste; taille(); poser(); dessiner(); },
      detacher() { try { obs && obs.disconnect(); } catch { /* rien */ } document.removeEventListener('visibilitychange', surVisible); },
    };
  }

  window.OdinGraphe3D = { mount, logique: { placer, projeter, choisir, doitReplier, empreinte } };
})();
