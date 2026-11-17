// Vue « Compétences » : les onglets « Connecteurs MCP » et « Plugins », avec le graphe 3D (ou 2D) des compétences,
// des connecteurs et des plugins, et leurs liens prouvés vers Brain, la Mémoire et Soul.
//   - Les données viennent de /api/plugins/* (propriétaire seul). Tout texte affiché passe par textContent.
//   - Un connecteur ne se branche qu'après la confirmation du propriétaire (OdinDialog.confirm) ; son jeton n'est
//     jamais relu ni affiché : la page sait seulement s'il y en a un.
//   - Le 3D est un faux-3D sur toile 2D (aucune bibliothèque) qui se sert de OdinGraphe3D.logique ; le 2D se sert de
//     OdinGraph.mount. Ni l'un ni l'autre n'est modifié ici.
// window.OdinPlugins.logique (sans document) : placer, rangs, ecarter, camera, placerEtiquettes, couleurDe, formeDe,
// tronquer, etatTexte, accesTexte, modeInitial, listeAccessible, provenanceTexte, horsPlugin — vérifiées par
// test/plugins-page.test.ts.
(() => {
  'use strict';
  if (window.OdinPlugins) return;

  // ---------------- Logique pure (sans document)

  const FIXES = ['brain', 'memoire', 'soul'];
  const estFixe = (sorte) => FIXES.includes(sorte);
  const G3 = () => (window.OdinGraphe3D && window.OdinGraphe3D.logique) || null;

  /** Un nombre stable dans [0, 1[ tiré d'un texte : celui du graphe 3D des scripts quand il est là, sinon le même calcul. */
  function empreinte(texte) {
    const g = G3(); if (g && typeof g.empreinte === 'function') return g.empreinte(texte);
    let h = 2166136261; const s = String(texte || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 100000) / 100000;
  }
  const angleFixe = { brain: 90, memoire: 210, soul: 330 };
  const anglePlugin = (id) => empreinte(id) * Math.PI * 2;

  /**
   * La place d'un point dans le cube [-1, 1], déterministe. `groupes` : les ids des plugins qui le contiennent
   * (par défaut `noeud.plugins`). Une compétence ou un connecteur rangé se pose près de son premier plugin.
   * `rang` ({ i, n }, facultatif) : sa place parmi les points de même sorte et de même groupe, pour les répartir à
   * intervalle régulier (sans rang : angle tiré du nom).
   */
  function placer(noeud, groupes, rang) {
    const sorte = noeud && noeud.sorte;
    const nom = String((noeud && (noeud.nom || noeud.id)) || '');
    const r0 = rang && rang.n > 0 ? rang : null;
    let y, r, a;
    if (estFixe(sorte)) { y = 0.85; r = 0.35; a = angleFixe[sorte] * Math.PI / 180; }
    else if (sorte === 'plugin') { y = 0.35; r = 0.55; a = anglePlugin(String(noeud.id || '').replace(/^plugin:/, '')); }
    else {
      y = sorte === 'mcp' ? -0.7 : -0.15; r = sorte === 'mcp' ? 0.8 : 0.9;
      const gs = (Array.isArray(groupes) ? groupes : (noeud && noeud.plugins) || []).slice().sort();
      if (gs.length) a = anglePlugin(gs[0]) + (r0 ? ((r0.i + 0.5) / r0.n - 0.5) * 0.6 : (empreinte(nom) - 0.5) * 0.6);
      // Seuls : tout le tour, à intervalle régulier ; les connecteurs décalés d'un demi-pas par rapport aux compétences.
      else a = r0 ? ((r0.i + (sorte === 'mcp' ? 0.5 : 0)) / r0.n) * Math.PI * 2 + 0.35 : empreinte(nom) * Math.PI * 2;
    }
    return { x: r * Math.cos(a), y, z: r * Math.sin(a) };
  }

  /** Les rangs { i, n } de chaque point (par sorte et premier plugin, dans l'ordre des noms) : pour placer(). */
  function rangs(noeuds) {
    const paquets = new Map();
    for (const n of noeuds || []) {
      if (!n || estFixe(n.sorte) || n.sorte === 'plugin') continue;
      const g = ((n.plugins || []).slice().sort()[0]) || '';
      const k = `${n.sorte}|${g}`; if (!paquets.has(k)) paquets.set(k, []); paquets.get(k).push(n);
    }
    const out = new Map();
    for (const l of paquets.values()) { l.sort((a, b) => String(a.nom).localeCompare(String(b.nom))); l.forEach((n, i) => out.set(n.id, { i, n: l.length })); }
    return out;
  }

  /**
   * Écarte les points trop proches sur un même anneau (même hauteur) : écart d'angle minimal, réparti des deux côtés.
   * Entrée et sortie : [{ x, y, z }] ; déterministe, les hauteurs ne bougent pas.
   */
  function ecarter(ps, distMin = 0.2) {
    const out = ps.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    const anneaux = new Map();
    out.forEach((p, i) => { const k = p.y.toFixed(3); if (!anneaux.has(k)) anneaux.set(k, []); anneaux.get(k).push(i); });
    for (const ids of anneaux.values()) {
      if (ids.length < 2) continue;
      const r = Math.max(1e-6, Math.hypot(out[ids[0]].x, out[ids[0]].z));
      const pas = Math.min(distMin / r, (Math.PI * 2) / ids.length);
      const ang = ids.map((i) => ({ i, a: Math.atan2(out[i].z, out[i].x) })).sort((p, q) => p.a - q.a || p.i - q.i);
      for (let tour = 0; tour < 40; tour++) {
        let bouge = false;
        for (let k = 0; k < ang.length; k++) {
          const p = ang[k], q = ang[(k + 1) % ang.length];
          let ecart = q.a - p.a; if (k === ang.length - 1) ecart += Math.PI * 2;
          if (ecart < pas - 1e-9) { const d = (pas - ecart) / 2; p.a -= d; q.a += d; bouge = true; }
        }
        if (!bouge) break;
      }
      for (const { i, a } of ang) { const rr = Math.hypot(out[i].x, out[i].z); out[i].x = rr * Math.cos(a); out[i].z = rr * Math.sin(a); }
    }
    return out;
  }

  /**
   * La caméra : rotation autour de l'axe vertical (`rot`), puis inclinaison vers le bas (`incl`, radians). Vu ainsi
   * un peu d'en haut, un anneau n'est plus une seule ligne : les points de devant descendent, ceux du fond montent.
   */
  function camera(p, rot, incl = 0.38) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const x = p.x * c - p.z * s, z = p.x * s + p.z * c;
    const ci = Math.cos(incl), si = Math.sin(incl);
    // Devant (z > 0) : plus bas à l'écran ; au fond : plus haut.
    return { x, y: p.y * ci - z * si, z: z * ci + p.y * si };
  }

  /**
   * La place des noms : pour chaque point (déjà rangés de devant vers le fond), on essaie dessous, au-dessus, à
   * droite puis à gauche, toujours à une ligne au plus du point ; on garde la première place libre (ni sur un nom
   * déjà posé, ni sur un autre point, ni hors de la boîte), sinon la moins encombrée.
   * points : [{ sx, sy, taille }], largeurs : la largeur de chaque nom (px). Rend [{ x, y, align }] (haut du texte).
   */
  function placerEtiquettes(points, largeurs, larg, haut, ligne = 14) {
    const poses = [], out = [];
    const recouvre = (a, b) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
    const disques = points.map((p) => ({ x1: p.sx - p.taille, x2: p.sx + p.taille, y1: p.sy - p.taille, y2: p.sy + p.taille }));
    points.forEach((p, i) => {
      const w = largeurs[i], t = p.taille;
      const essais = [
        { x: p.sx, y: p.sy + t * 1.25 + 3, align: 'center' },
        { x: p.sx, y: p.sy - t * 1.25 - 3 - ligne, align: 'center' },
        { x: p.sx + t * 1.3 + 4, y: p.sy - ligne / 2, align: 'left' },
        { x: p.sx - t * 1.3 - 4, y: p.sy - ligne / 2, align: 'right' },
      ];
      let meilleur = null, score = Infinity;
      for (const e of essais) {
        const x1 = e.align === 'center' ? e.x - w / 2 : e.align === 'left' ? e.x : e.x - w;
        const r = { x1, x2: x1 + w, y1: e.y, y2: e.y + ligne };
        let s = 0;
        for (const q of poses) s += recouvre(r, q);
        disques.forEach((d, j) => { if (j !== i) s += recouvre(r, d); });
        s += (Math.max(0, -r.x1) + Math.max(0, r.x2 - larg) + Math.max(0, -r.y1) + Math.max(0, r.y2 - haut)) * ligne * 4;
        if (s < score - 1e-9) { score = s; meilleur = { e, r }; }
        if (s === 0) break;
      }
      poses.push(meilleur.r); out.push({ x: meilleur.e.x, y: meilleur.e.y, align: meilleur.e.align, libre: score === 0 });
    });
    return out;
  }

  const COULEURS = { brain: '--ink', memoire: '--ink', soul: '--ink', plugin: '--accent', skill: '--good', mcp: '--warn' };
  const FORMES = { brain: 'carre', memoire: 'carre', soul: 'carre', plugin: 'losange', skill: 'rond', mcp: 'triangle' };
  const ECHELLES = { brain: 1.6, memoire: 1.6, soul: 1.6, plugin: 1.3, skill: 1, mcp: 1 };
  /** Le nom de la variable de couleur d'une sorte (jamais une couleur écrite en dur). */
  const couleurDe = (sorte) => COULEURS[sorte] || '--muted';
  const formeDe = (sorte) => FORMES[sorte] || 'rond';

  /** Coupe un texte à `n` caractères au plus, avec « … ». */
  function tronquer(texte, n = 22) {
    const c = Array.from(String(texte == null ? '' : texte));
    return c.length <= n ? c.join('') : c.slice(0, Math.max(1, n - 1)).join('') + '…';
  }
  // L'état vient du DERNIER contact (branchement ou reconnexion) : jamais présenté comme vérifié à l'instant.
  const etatTexte = (etat) => ({ relie: 'relié au dernier contact', 'a-relier': 'à relier', panne: 'en panne au dernier contact' })[etat] || 'à relier';
  /** Ce que le serveur déclare d'un outil : trois états, « non déclaré » étant traité comme pouvant modifier. */
  const accesTexte = (o) => {
    const a = o && (o.acces || (o.peutModifier ? 'non-declare' : 'lecture'));
    return a === 'lecture' ? 'lecture (déclarée par le serveur)' : a === 'modification' ? 'peut modifier (déclaré par le serveur)' : 'non déclaré : traité comme pouvant modifier';
  };

  /** Le mode du graphe au départ : 2D si l'appareil le demande (repli honnête), sinon le choix mémorisé, sinon 3D. */
  function modeInitial(o = {}) {
    const g = G3();
    const replier = g && typeof g.doitReplier === 'function'
      ? g.doitReplier({ webgl: o.webgl, reducedMotion: o.reducedMotion, premiereImageMs: o.premiereImageMs })
      : (o.webgl === false || Boolean(o.reducedMotion) || (typeof o.premiereImageMs === 'number' && o.premiereImageMs > 12));
    if (replier) return '2d';
    return o.choixMemorise === '2d' ? '2d' : '3d';
  }

  const SORTES = { skill: 'compétence', mcp: 'connecteur MCP', plugin: 'plugin', brain: 'point fixe', memoire: 'point fixe', soul: 'point fixe' };
  /** Un bouton par point (points seuls compris), pour le clavier et les lecteurs d'écran. */
  function listeAccessible(etat) {
    return ((etat && etat.noeuds) || []).map((n) => ({ id: n.id, libelle: `${SORTES[n.sorte] || n.sorte} ${n.nom}${n.sous ? ' : ' + n.sous : ''}` }));
  }
  const provenanceTexte = (p, n) => ({ declare: 'relié par toi', cite: 'cité dans la compétence', constate: `vus ensemble dans ${n || 0} tour(s) observé(s)`, memoire: 'mémoire d\'Odin', brain: 'notes du Cerveau' })[p] || String(p);

  /** Les points et les liens à dessiner, avec ou sans Brain, Mémoire et Soul. */
  function filtrer(etat, avecFixes) {
    const noeuds = ((etat && etat.noeuds) || []).filter((n) => avecFixes || !estFixe(n.sorte));
    const ids = new Set(noeuds.map((n) => n.id));
    return { noeuds, liens: ((etat && etat.liens) || []).filter((l) => ids.has(l.a) && ids.has(l.b)) };
  }
  /** Le style de trait d'un lien : plein (déclaré), tirets (cité ou constaté), pointillés fins (Brain ou Mémoire). */
  function trait(l) {
    const p = (l && l.provenances) || [];
    if (p.includes('declare')) return [];
    if (p.includes('cite') || p.includes('constate')) return [6, 4];
    return [2, 4];
  }

  /** Les points montrés dans « Hors plugin » : dans aucun plugin, chacun dit s'il a un lien (seul) ou non. */
  const horsPlugin = (etat) => ((etat && etat.noeuds) || []).filter((n) => (n.sorte === 'skill' || n.sorte === 'mcp') && !(n.plugins && n.plugins.length));

  const logique = { placer, rangs, ecarter, camera, placerEtiquettes, couleurDe, formeDe, tronquer, etatTexte, accesTexte, modeInitial, listeAccessible, provenanceTexte, filtrer, trait, horsPlugin };

  // ---------------- Navigateur

  const aDocument = typeof document !== 'undefined' && document && typeof document.createElement === 'function';
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'class') n.className = v;
      else if (k === 'style') n.style.cssText = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(typeof c === 'object' && c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svgEl = (t, a) => { const n = document.createElementNS(SVGNS, t); for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v)); return n; };
  const cssVar = (n, d) => { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d; } catch { return d; } };
  const lire = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const ecrire = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sans stockage : rien de grave */ } };
  const reducedMotion = () => { try { return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; } };
  const webglDispo = () => { try { const c = document.createElement('canvas'); return Boolean(c.getContext('webgl') || c.getContext('experimental-webgl')); } catch { return false; } };
  const $ = (id) => document.getElementById(id);

  const CSS = `
.sk-tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);margin:0 0 18px;flex-wrap:nowrap;background:color-mix(in srgb,var(--panel) 88%,transparent);border-radius:10px 10px 0 0}
.sk-tabs[hidden]{display:none}
.sk-tabs button{flex:1 1 auto;min-width:0;min-height:40px;padding:0 8px;border:0;border-bottom:2px solid transparent;background:none;color:var(--muted);font-size:14px;white-space:nowrap;cursor:pointer}
.sk-tabs button[aria-selected=true]{border-bottom-color:var(--accent);color:var(--ink);font-weight:600}
.sk-tabs button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
@media (min-width:600px){.sk-tabs button{flex:0 0 auto;padding:0 16px}}
@media (max-width:359px){.sk-tabs{flex-wrap:wrap}.sk-tabs button{white-space:normal}}
@media (pointer:coarse){.sk-tabs button{min-height:44px}}
.pl-fond{background:color-mix(in srgb,var(--panel) 88%,transparent);border-radius:10px;padding:8px 12px}
.pl-intro{margin:0 0 14px;max-width:72ch}
.pl-tbl th{color:var(--muted)}
#skPanMcp .btn.small,#skPanPlug .btn.small,.pl-dlg .btn.small{min-height:40px}
.pl-tbl td{overflow-wrap:anywhere}
.pl-acts{display:flex;gap:6px;flex-wrap:wrap}
.pl-pill-relie{color:var(--ink);border-color:var(--good);background:color-mix(in srgb,var(--good) 20%,transparent)}
.pl-pill-a-relier{color:var(--muted)}
.pl-pill-panne{color:var(--ink);border-color:var(--bad);background:color-mix(in srgb,var(--bad) 22%,transparent)}
#skPanMcp>.wrap{background:color-mix(in srgb,var(--panel) 94%,transparent);border-radius:12px}
.pl-form{display:grid;gap:12px;margin-top:22px;max-width:640px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px}
.pl-form h2,.pl-sec h2{font-size:18px;margin:0}
.pl-form input,.pl-dlg input,.pl-dlg textarea,.pl-dlg select{min-height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--field);background:var(--panel2);color:var(--ink);width:100%;box-sizing:border-box;font:inherit}
.pl-dlg textarea{padding:8px 12px;min-height:72px;resize:vertical}
.pl-aide{font-size:12.5px;color:var(--muted)}
.pl-erreur{color:var(--bad);font-size:13.5px;min-height:0}
.pl-sec{margin-top:28px;display:grid;gap:12px}
.pl-sec-h{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.pl-bar{display:flex;gap:10px 16px;align-items:center;flex-wrap:wrap;margin:6px 0 10px;background:color-mix(in srgb,var(--panel) 88%,transparent);border-radius:12px;padding:8px 12px}
.pl-bar .seg button{min-height:40px}
.pl-leg{display:flex;gap:4px 14px;flex-wrap:wrap;font-size:12.5px;color:var(--muted);align-items:center}
.pl-leg span{display:inline-flex;align-items:center;gap:5px}
.pl-leg svg{width:14px;height:14px;flex:none}
#plGraphe{position:relative;width:100%;height:460px;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:color-mix(in srgb,var(--panel) 75%,var(--bg));touch-action:none}
#plGraphe canvas.pl-3d{display:block;width:100%;height:100%;cursor:grab}
#plGraphe canvas.pl-3d.on{cursor:pointer}#plGraphe canvas.pl-3d.drag{cursor:grabbing}
#plGraphe canvas.pl-3d:focus-visible{outline:2px solid var(--accent);outline-offset:-3px}
#plGraphe .og{height:100%;min-height:0;border:0;border-radius:0}
#plGraphe>.empty{padding:28px 16px}
.pl-tip{position:absolute;z-index:3;pointer-events:none;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:4px 8px;font-size:12.5px;max-width:260px;overflow-wrap:anywhere}
.pl-tip[hidden]{display:none}
.pl-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media (max-width:599px){#plGraphe{height:min(62vh,420px)}}
.pl-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.pl-cards .card{min-width:0}
.pl-cards h3{margin:0;font-size:16px;overflow-wrap:anywhere}
.pl-cards p{margin:0;overflow-wrap:anywhere}
.pl-absent{text-decoration:line-through;color:var(--dim)}
.pl-puces{display:flex;flex-wrap:wrap;gap:8px}
.pl-puce{min-height:40px;padding:0 12px;border-radius:999px;border:1px solid var(--field);background:var(--panel);color:var(--ink);overflow-wrap:anywhere;text-align:left;cursor:pointer}
.pl-puce small{color:var(--muted);margin-left:6px}
.pl-dlg{max-height:calc(100vh - 32px);overflow:auto}
.pl-dlg .pl-lignes{display:grid;gap:8px;margin:10px 0}
.pl-dlg .pl-ligne{overflow-wrap:anywhere}
.pl-dlg .pl-acts select{flex:1 1 180px;width:auto;min-width:0}
.pl-dlg ul{margin:6px 0;padding-left:18px}
.pl-dlg li{margin:0 0 8px;overflow-wrap:anywhere}
.pl-cases{max-height:50vh;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:4px 10px}
.pl-cases .check{min-height:40px;overflow-wrap:anywhere}
.pl-cases .check input{width:auto;min-height:0}
.pl-pied{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px}
.pl-dlg .pl-pied{position:sticky;bottom:-1px;background:var(--panel);padding:10px 0 2px;z-index:1}
.pl-bar .check{min-height:40px;display:inline-flex;align-items:center;gap:8px;cursor:pointer}
.pl-bar .check input{width:20px;height:20px;margin:0}
.pl-puce .pl-lie{color:var(--muted)}
@media (max-width:599px){.pl-intro{padding-right:52px}}
.pl-badge{display:inline-block;font-size:11.5px;padding:1px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted);margin-left:6px}
.pl-badge.mod{color:var(--warn);border-color:var(--warn)}
@media (prefers-reduced-motion:reduce){.sk-tabs button,.pl-puce{transition:none}}
`;
  function style() { if (!$('pl-css')) document.head.append(el('style', { id: 'pl-css' }, CSS)); }

  // ---- L'état de la page
  const ONGLETS = [['comp', 'skTab-comp', 'skPanComp'], ['mcp', 'skTab-mcp', 'skPanMcp'], ['plug', 'skTab-plug', 'skPanPlug']];
  let monte = false, onglet = 'comp', etat = null, erreurEtat = '', avecFixes = true, mode = null, motif = '', graphe = null;

  async function appel(chemin, corps) {
    const r = await fetch(chemin, corps === undefined ? { headers: { 'x-odin': '1' } } : { method: 'POST', headers: { 'x-odin': '1', 'content-type': 'application/json' }, body: JSON.stringify(corps) });
    let b = {}; try { b = await r.json(); } catch { b = {}; }
    return { status: r.status, body: b || {} };
  }
  const erreurDe = (r) => (r && r.body && r.body.error) || `Erreur ${r ? r.status : ''}`.trim();

  async function charger() {
    try {
      const r = await appel('/api/plugins/etat');
      if (r.status === 200) { etat = r.body; erreurEtat = ''; }
      else { etat = null; erreurEtat = erreurDe(r); }
    } catch { etat = null; erreurEtat = 'Odin ne répond pas pour l\'instant.'; }
    peindre();
  }

  function peindre() {
    if (onglet === 'mcp') peindreConnecteurs();
    else if (onglet === 'plug') peindrePlugins();
  }

  // ---- Les onglets
  function choisirOnglet(k, focus) {
    if (!ONGLETS.some((o) => o[0] === k)) k = 'comp';
    onglet = k; ecrire('odin.competences.onglet', k);
    for (const [id, tab, pan] of ONGLETS) {
      const t = $(tab), p = $(pan), on = id === k;
      if (t) { t.setAttribute('aria-selected', on ? 'true' : 'false'); t.setAttribute('tabindex', on ? '0' : '-1'); if (on && focus) t.focus(); }
      if (p) { if (on) p.removeAttribute('hidden'); else p.setAttribute('hidden', ''); }
    }
    if (k !== 'plug') detacherGraphe();
    if (k !== 'comp') { peindre(); charger(); }
  }

  function monter() {
    const barre = $('skTabs');
    if (!barre) return;
    if (!monte) {
      monte = true; style();
      barre.removeAttribute('hidden');
      for (const [id, tab] of ONGLETS) { const t = $(tab); if (t) t.addEventListener('click', () => choisirOnglet(id)); }
      barre.addEventListener('keydown', (e) => {
        const i = ONGLETS.findIndex((o) => o[0] === onglet);
        let j = -1;
        if (e.key === 'ArrowRight') j = (i + 1) % ONGLETS.length;
        else if (e.key === 'ArrowLeft') j = (i - 1 + ONGLETS.length) % ONGLETS.length;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = ONGLETS.length - 1;
        if (j < 0) return;
        e.preventDefault(); choisirOnglet(ONGLETS[j][0], true);
      });
      try { new MutationObserver(() => { if (onglet === 'plug' && etat) peindreGraphe(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-skin', 'class'] }); } catch { /* sans observateur : couleurs relues au prochain dessin */ }
      choisirOnglet(lire('odin.competences.onglet') || 'comp');
    } else if (onglet !== 'comp') charger();
  }

  // ---- Petits morceaux d'interface
  const bouton = (texte, f, o = {}) => el('button', { type: 'button', class: o.class || 'btn small', onclick: f, 'aria-label': o.label || null, title: o.title || null }, texte);
  function pastille(c) {
    return el('span', { class: `pill pl-pill-${c.etat}`, title: c.etat === 'panne' && c.detail ? c.detail : null }, etatTexte(c.etat));
  }
  function dialogue(titre, ...corps) {
    const dlg = el('dialog', { class: 'stdlg pl-dlg', 'aria-label': titre });
    dlg.append(el('h2', {}, titre), ...corps);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); }
    return dlg;
  }
  const fermer = (dlg) => bouton('Fermer', () => dlg.close());
  const pluginsParId = () => new Map(((etat && etat.plugins) || []).map((p) => [p.id, p]));
  const lienEntre = (a, b) => ((etat && etat.liens) || []).find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));

  // ---------------- Onglet « Connecteurs MCP »
  function peindreConnecteurs() {
    const pan = $('skPanMcp'); if (!pan) return;
    const intro = el('p', { class: 'sub pl-intro pl-fond' }, 'Les connecteurs relient Odin à un service extérieur (GitHub ou un autre site) par un lien. Ce qu\'un connecteur renvoie est une donnée, jamais un ordre. Brancher ou débrancher demande ta confirmation. L\'état affiché est celui du dernier contact ; « Reconnecter » le vérifie maintenant.');
    if (!etat) { pan.replaceChildren(intro, el('div', { class: 'empty' }, erreurEtat || 'Chargement…')); return; }
    if (!etat.resume || !etat.resume.mcpDisponible) {
      pan.replaceChildren(intro, el('div', { class: 'empty' }, 'Les applis d\'Odin ne sont pas démarrées : les connecteurs ne sont pas lisibles pour l\'instant.'));
      return;
    }
    const cs = etat.connecteurs || [];
    const lignes = cs.length ? cs.map((c) => el('tr', {},
      el('td', { 'data-label': 'Nom' }, el('b', {}, c.nom)),
      el('td', { 'data-label': 'Adresse', class: 'mono', style: 'overflow-wrap:anywhere' }, c.adresse),
      el('td', { 'data-label': 'État' }, pastille(c), c.etat === 'panne' && c.detail ? el('div', { class: 'sub' }, c.detail) : null),
      el('td', { 'data-label': 'Outils' }, bouton(`${c.outils.length} outil(s)`, () => ficheConnecteur(c.nom), { label: `${c.outils.length} outil(s) de ${c.nom}` })),
      el('td', { 'data-label': 'Jeton' }, c.sorte === 'http' ? (c.jeton ? 'au coffre' : 'aucun') : '—'),
      el('td', { 'data-label': 'Actions' }, el('div', { class: 'pl-acts' },
        bouton('Reconnecter', () => reconnecter(c.nom), { label: `Reconnecter ${c.nom}` }),
        c.sorte === 'http' ? bouton('Jeton…', () => dialogueJeton(c.nom), { label: `Jeton de ${c.nom}` }) : null,
        bouton('Débrancher', () => debrancher(c.nom), { class: 'btn small danger', label: `Débrancher ${c.nom}` })))))
      : [el('tr', {}, el('td', { colspan: '6', class: 'empty' }, 'Aucun connecteur. Branche le premier ci-dessous avec son lien.'))];
    const st = el('div', { class: 'status', role: 'status', id: 'plMcpSt' });
    pan.replaceChildren(intro,
      el('div', { class: 'wrap' }, el('table', { class: 'tbl pl-tbl' },
        el('thead', {}, el('tr', {}, ...['Nom', 'Adresse', 'État', 'Outils', 'Jeton', ''].map((t) => el('th', {}, t)))),
        el('tbody', {}, ...lignes))),
      st, formulaireConnecteur());
  }
  const statut = (t) => { const s = $('plMcpSt'); if (s) s.textContent = t; };

  function formulaireConnecteur() {
    const nom = el('input', { id: 'plcNom', type: 'text', maxlength: '40', required: true, autocomplete: 'off' });
    const src = el('input', { id: 'plcSrc', type: 'text', maxlength: '500', required: true, autocomplete: 'off', spellcheck: 'false' });
    const jeton = el('input', { id: 'plcJeton', type: 'password', autocomplete: 'off' });
    const vars = el('input', { id: 'plcVars', type: 'text', autocomplete: 'off', spellcheck: 'false' });
    const champJeton = el('div', { class: 'field', hidden: true }, el('label', { for: 'plcJeton' }, 'Jeton (facultatif)'), jeton, el('span', { class: 'pl-aide' }, 'Rangé dans le coffre d\'Odin, jamais affiché.'));
    const champVars = el('div', { class: 'field', hidden: true }, el('label', { for: 'plcVars' }, 'Variables du coffre à passer (MCP_…, facultatif)'), vars);
    const st = el('div', { class: 'status', role: 'status' });
    const voir = () => {
      const v = src.value.trim(), http = /^https?:/i.test(v);
      if (http) champJeton.removeAttribute('hidden'); else champJeton.setAttribute('hidden', '');
      if (v && !http) champVars.removeAttribute('hidden'); else champVars.setAttribute('hidden', '');
    };
    src.addEventListener('input', voir);
    const envoyer = async (e) => {
      e.preventDefault();
      const http = /^https?:/i.test(src.value.trim());
      const corps = { nom: nom.value.trim(), source: src.value.trim(), variables: http ? '' : vars.value.trim(), jeton: http ? jeton.value : '' };
      if (!corps.nom || !corps.source) { st.textContent = 'Le nom et le lien sont obligatoires.'; return; }
      st.textContent = 'Branchement…';
      try {
        let r = await appel('/api/plugins/connecteur/ajouter', corps);
        if (r.status === 409 && r.body.confirmer) {
          const oui = await window.OdinDialog.confirm(r.body.confirmer, { danger: true });
          if (!oui) { st.textContent = 'Annulé : rien n\'a été branché.'; return; }
          st.textContent = 'Branchement…';
          r = await appel('/api/plugins/connecteur/ajouter', { ...corps, confirme: true });
        }
        if (r.status === 200) { st.textContent = r.body.texte || 'Connecteur branché.'; nom.value = ''; src.value = ''; vars.value = ''; voir(); await charger(); statut(r.body.texte || 'Connecteur branché.'); }
        else st.textContent = erreurDe(r);
      } catch { st.textContent = 'Odin ne répond pas pour l\'instant.'; }
      finally { jeton.value = ''; corps.jeton = ''; }
    };
    return el('form', { class: 'pl-form', onsubmit: envoyer, 'aria-labelledby': 'plcTitre' },
      el('h2', { id: 'plcTitre' }, 'Brancher un connecteur'),
      el('div', { class: 'field' }, el('label', { for: 'plcNom' }, 'Nom'), nom),
      el('div', { class: 'field' }, el('label', { for: 'plcSrc' }, 'Lien ou commande'), src, el('span', { class: 'pl-aide' }, 'https://… pour un service en ligne, ou une commande pour un programme sur cette machine.')),
      champJeton, champVars,
      el('div', {}, el('button', { type: 'submit', class: 'btn primary' }, 'Brancher')), st);
  }

  async function reconnecter(nom) {
    statut(`Reconnexion de « ${nom} »…`);
    try { const r = await appel('/api/plugins/connecteur/reconnecter', { nom }); await charger(); statut(r.status === 200 ? (r.body.texte || 'Reconnecté.') : erreurDe(r)); }
    catch { statut('Odin ne répond pas pour l\'instant.'); }
  }
  async function debrancher(nom) {
    try {
      let r = await appel('/api/plugins/connecteur/retirer', { nom });
      if (r.status === 409 && r.body.confirmer) {
        if (!(await window.OdinDialog.confirm(r.body.confirmer, { danger: true }))) { statut('Annulé : rien n\'a changé.'); return; }
        r = await appel('/api/plugins/connecteur/retirer', { nom, confirme: true });
      }
      await charger(); statut(r.status === 200 ? (r.body.texte || 'Connecteur débranché.') : erreurDe(r));
    } catch { statut('Odin ne répond pas pour l\'instant.'); }
  }

  function dialogueJeton(nom) {
    const champ = el('input', { type: 'password', autocomplete: 'off', id: 'plJeton', 'aria-label': `Jeton de ${nom}` });
    const st = el('p', { class: 'status', role: 'status' });
    const pied = el('div', { class: 'pl-pied' });
    const dlg = dialogue(`Jeton de « ${nom} »`, el('div', { class: 'field' }, el('label', { for: 'plJeton' }, 'Jeton'), champ, el('span', { class: 'pl-aide' }, 'Rangé dans le coffre d\'Odin, jamais affiché.')), st, pied);
    const envoyer = async (valeur) => {
      try {
        const r = await appel('/api/plugins/connecteur/jeton', { nom, jeton: valeur });
        champ.value = '';
        if (r.status !== 200) { st.textContent = erreurDe(r); return; }
        st.textContent = valeur ? 'Jeton enregistré au coffre.' : 'Jeton effacé du coffre.';
        pied.replaceChildren(bouton('Reconnecter maintenant', async () => { dlg.close(); await reconnecter(nom); }, { class: 'btn small primary' }), fermer(dlg));
        await charger();
      } catch { champ.value = ''; st.textContent = 'Odin ne répond pas pour l\'instant.'; }
    };
    pied.append(bouton('Enregistrer', () => { if (champ.value) envoyer(champ.value); }, { class: 'btn small primary' }), bouton('Effacer', () => envoyer('')), fermer(dlg));
  }

  // ---------------- Onglet « Plugins »
  const SVG_FORMES = {
    carre: () => svgEl('rect', { x: 2, y: 2, width: 10, height: 10, rx: 1.5 }),
    losange: () => svgEl('path', { d: 'M7 1 13 7 7 13 1 7Z' }),
    rond: () => svgEl('circle', { cx: 7, cy: 7, r: 5.5 }),
    triangle: () => svgEl('path', { d: 'M7 1.5 13 12.5H1Z' }),
  };
  function iconeForme(sorte) {
    const s = svgEl('svg', { viewBox: '0 0 14 14', 'aria-hidden': 'true' });
    const f = SVG_FORMES[formeDe(sorte)](); f.setAttribute('fill', `var(${couleurDe(sorte)})`); s.append(f); return s;
  }
  function iconeTrait(dash) {
    const s = svgEl('svg', { viewBox: '0 0 14 14', 'aria-hidden': 'true' });
    s.append(svgEl('line', { x1: 0, y1: 7, x2: 14, y2: 7, stroke: 'var(--muted)', 'stroke-width': 1.6, 'stroke-dasharray': dash || 'none' })); return s;
  }
  /** La légende de la vue choisie : formes et trois traits en 3D ; en 2D, le graphe a sa propre légende des couleurs, et deux traits seulement. */
  function legende(m) {
    if (m === '2d') return el('div', { class: 'pl-leg', id: 'plLeg' }, el('span', {}, iconeTrait(''), 'déclaré'), el('span', {}, iconeTrait('4 3'), 'cité, constaté, Brain ou Mémoire'));
    return el('div', { class: 'pl-leg', id: 'plLeg' },
      el('span', {}, iconeForme('brain'), 'Brain / Mémoire / Soul'), el('span', {}, iconeForme('plugin'), 'plugin'),
      el('span', {}, iconeForme('skill'), 'compétence'), el('span', {}, iconeForme('mcp'), 'connecteur MCP'),
      el('span', {}, iconeTrait(''), 'déclaré'), el('span', {}, iconeTrait('4 3'), 'cité ou constaté'), el('span', {}, iconeTrait('1.5 3'), 'Brain ou Mémoire'));
  }

  function peindrePlugins() {
    const pan = $('skPanPlug'); if (!pan) return;
    detacherGraphe();
    if (!etat) { pan.replaceChildren(el('div', { class: 'empty' }, erreurEtat || 'Chargement…')); return; }
    const r = etat.resume || {};
    const resume = `${r.plugins || 0} plugin(s) · ${r.competences || 0} compétence(s) · ${r.connecteurs || 0} connecteur(s) · ${r.seuls || 0} point(s) sans aucun lien${r.brouillons > 0 ? ` · ${r.brouillons} brouillon(s) non montrés` : ''}`;
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Vue du graphe' },
      el('button', { type: 'button', 'data-mode': '3d', 'aria-pressed': 'false', onclick: () => changerMode('3d') }, '3D'),
      el('button', { type: 'button', 'data-mode': '2d', 'aria-pressed': 'false', onclick: () => changerMode('2d') }, '2D'));
    const caseFixes = el('input', { type: 'checkbox', id: 'plFixes', onchange: (e) => { avecFixes = e.target.checked; peindreGraphe(); } });
    caseFixes.checked = avecFixes;
    const cartes = (etat.plugins || []).map(cartePlugin);
    const hors = horsPlugin(etat);
    pan.replaceChildren(...[
      el('p', { class: 'sub pl-fond', id: 'plResume' }, resume),
      r.abime ? el('p', { class: 'pl-erreur', role: 'alert' }, 'Le fichier des plugins était abîmé (en tout ou en partie) : ce qui était lisible est gardé, l\'original sera mis de côté à la prochaine modification.') : null,
      r.omis ? el('p', { class: 'sub' }, `${r.omis} compétence(s) peu utilisée(s) ne sont pas dessinées.`) : null,
      el('div', { class: 'pl-bar' }, seg, el('label', { class: 'check', for: 'plFixes' }, caseFixes, 'Montrer Brain, Mémoire et Soul'), legende(mode)),
      el('p', { class: 'sub', id: 'plMotif', hidden: true }),
      el('div', { id: 'plGraphe' }),
      el('section', { class: 'pl-sec', 'aria-labelledby': 'plTitrePlugins' },
        el('div', { class: 'pl-sec-h pl-fond' }, el('h2', { id: 'plTitrePlugins' }, 'Plugins'), bouton('Nouveau plugin', () => editerPlugin(null), { class: 'btn small primary' })),
        cartes.length ? el('div', { class: 'pl-cards' }, ...cartes) : el('div', { class: 'empty' }, 'Aucun plugin. Un plugin réunit des compétences et des connecteurs : crée le premier avec « Nouveau plugin ».')),
      el('section', { class: 'pl-sec', 'aria-labelledby': 'plTitreSeuls' },
        el('h2', { id: 'plTitreSeuls', class: 'pl-fond' }, 'Hors plugin'),
        hors.length ? el('div', { class: 'pl-puces' }, ...hors.map((n) => el('button', { type: 'button', class: 'pl-puce', onclick: () => ouvrirFiche(n.id) }, n.nom, el('small', {}, `${SORTES[n.sorte]} · ${n.seul ? 'sans aucun lien' : 'relié hors plugin'}`))))
          : el('div', { class: 'empty' }, 'Tout est rangé dans un plugin.'))].filter(Boolean));
    peindreGraphe();
  }

  function cartePlugin(p) {
    // « absente » pour une compétence, « absent » pour un connecteur ; « aucune » / « aucun » de même.
    const membres = (titre, liste, f) => el('p', {}, `${titre} : `, liste.length ? liste.flatMap((m, i) => [i ? ', ' : '', m.present ? m.nom : el('span', { class: 'pl-absent', title: f ? 'absente' : 'absent' }, m.nom), m.present ? '' : (f ? ' (absente)' : ' (absent)')]) : (f ? 'aucune' : 'aucun'));
    return el('article', { class: 'card' },
      el('h3', {}, p.nom),
      p.description ? el('p', { class: 'sub' }, p.description) : null,
      membres('Compétences', p.skills || [], true), membres('Connecteurs', p.mcp || [], false),
      el('div', { class: 'pl-acts' }, bouton('Modifier', () => editerPlugin(p), { label: `Modifier ${p.nom}` }), bouton('Supprimer', () => supprimerPlugin(p), { class: 'btn small danger', label: `Supprimer ${p.nom}` })));
  }

  async function supprimerPlugin(p, dlg) {
    if (!(await window.OdinDialog.confirm(`Supprimer le plugin « ${p.nom} » ? Ses compétences et ses connecteurs ne sont pas touchés.`, { danger: true }))) return;
    try { const r = await appel('/api/plugins/plugin/supprimer', { id: p.id }); if (r.status !== 200) { await window.OdinDialog.alert(erreurDe(r)); return; } if (dlg) dlg.close(); await charger(); }
    catch { /* Odin ne répond pas : la liste reste telle quelle */ }
  }

  function editerPlugin(p) {
    const nom = el('input', { id: 'plpNom', type: 'text', maxlength: '60', required: true });
    const desc = el('textarea', { id: 'plpDesc', maxlength: '300' });
    nom.value = p ? p.nom : ''; desc.value = p ? (p.description || '') : '';
    const deja = (liste) => new Set((liste || []).map((m) => m.nom));
    const skills = (etat.noeuds || []).filter((n) => n.sorte === 'skill').map((n) => n.nom);
    const mcps = (etat.connecteurs || []).map((c) => c.nom);
    // Une référence déjà dans le plugin mais disparue depuis reste cochée (le propriétaire peut la décocher).
    const cases = (noms, coches, groupe, f) => {
      const tous = [...new Set([...noms, ...coches])].sort((a, b) => a.localeCompare(b));
      return tous.length ? el('div', { class: 'pl-cases', role: 'group', 'aria-label': groupe }, ...tous.map((n) => {
        const c = el('input', { type: 'checkbox', value: n }); c.checked = coches.has(n);
        return el('label', { class: 'check' }, c, n, noms.includes(n) ? '' : el('span', { class: 'pl-absent' }, f ? ' (absente)' : ' (absent)'));
      })) : el('p', { class: 'sub' }, f ? 'Aucune pour l\'instant.' : 'Aucun pour l\'instant.');
    };
    const casesS = cases(skills, deja(p && p.skills), 'Compétences', true), casesM = cases(mcps, deja(p && p.mcp), 'Connecteurs', false);
    const err = el('p', { class: 'pl-erreur', role: 'alert' });
    const coches = (bloc) => (bloc.querySelectorAll ? [...bloc.querySelectorAll('input')] : []).filter((x) => x.checked).map((x) => x.value);
    const dlg = dialogue(p ? `Modifier « ${p.nom} »` : 'Nouveau plugin',
      el('div', { class: 'pl-lignes' },
        el('div', { class: 'field' }, el('label', { for: 'plpNom' }, 'Nom'), nom),
        el('div', { class: 'field' }, el('label', { for: 'plpDesc' }, 'Description'), desc),
        el('div', { class: 'field' }, el('span', {}, 'Compétences'), casesS),
        el('div', { class: 'field' }, el('span', {}, 'Connecteurs'), casesM), err),
      el('div', { class: 'pl-pied' }, bouton('Annuler', () => dlg.close()), bouton('Enregistrer', async () => {
        const corps = { nom: nom.value.trim(), description: desc.value.trim(), skills: coches(casesS), mcp: coches(casesM) };
        if (p) corps.id = p.id;
        if (!corps.nom) { err.textContent = 'Le nom est obligatoire.'; return; }
        try { const r = await appel('/api/plugins/plugin', corps); if (r.status !== 200) { err.textContent = erreurDe(r); return; } dlg.close(); await charger(); }
        catch { err.textContent = 'Odin ne répond pas pour l\'instant.'; }
      }, { class: 'btn small primary' })));
    nom.focus();
  }

  // ---------------- Le graphe
  function changerMode(m) { mode = m; motif = ''; ecrire('odin.plugins.vue', m); peindreGraphe(); }
  function detacherGraphe() { if (graphe && graphe.detacher) graphe.detacher(); graphe = null; }

  function peindreGraphe() {
    const boite = $('plGraphe'); if (!boite || !etat) return;
    detacherGraphe();
    if (!mode) {
      const m = modeInitial({ choixMemorise: lire('odin.plugins.vue'), webgl: webglDispo(), reducedMotion: reducedMotion() });
      if (m === '2d' && (reducedMotion() || !webglDispo())) motif = 'Vue 2D : ton appareil demande peu de mouvement, ou la vue 3D était trop lente.';
      mode = m;
    }
    if (mode === '3d' && !G3()) mode = '2d';
    const pan = $('skPanPlug');
    for (const b of [...(pan ? pan.querySelectorAll('button') : [])].filter((x) => x.getAttribute('data-mode'))) b.setAttribute('aria-pressed', b.getAttribute('data-mode') === mode ? 'true' : 'false');
    const m = $('plMotif'); if (m) { m.textContent = motif; if (motif) m.removeAttribute('hidden'); else m.setAttribute('hidden', ''); }
    const leg = $('plLeg'); if (leg && leg.replaceWith) leg.replaceWith(legende(mode));
    const nonFixes = (etat.noeuds || []).filter((n) => !estFixe(n.sorte));
    if (!nonFixes.length) { boite.replaceChildren(el('div', { class: 'empty' }, 'Rien à montrer : aucune compétence active ni connecteur. Les compétences apparaissent ici dès qu\'Odin en apprend une ou que tu en approuves une.')); return; }
    const vue = filtrer(etat, avecFixes);
    if (mode === '3d') graphe = graphe3D(boite, vue);
    else graphe = graphe2D(boite, vue);
  }

  function graphe2D(boite, vue) {
    if (!window.OdinGraph) { boite.replaceChildren(el('div', { class: 'empty' }, 'Le graphe n\'a pas pu se charger.')); return null; }
    const c = (sorte) => cssVar(couleurDe(sorte), '#888');
    const nodes = vue.noeuds.map((n) => ({ id: n.id, label: n.nom, sub: n.sous, color: c(n.sorte), hub: estFixe(n.sorte), square: estFixe(n.sorte) || n.sorte === 'plugin', ring: n.sorte === 'mcp' && n.etat === 'panne' ? cssVar('--bad', '#c33') : undefined, title: `${n.nom} — ${n.sous}` }));
    const edges = vue.liens.map((l) => ({ a: l.a, b: l.b, title: l.titre, dash: !(l.provenances || []).includes('declare') }));
    const g = window.OdinGraph.mount(boite, {
      nodes, edges, onOpen: (id) => ouvrirFiche(id), liste: 'cachee', label: `Graphe des compétences, connecteurs et plugins : ${nodes.length} points, ${edges.length} liens.`,
      legend: [[c('brain'), 'Brain / Mémoire / Soul'], [c('plugin'), 'plugin'], [c('skill'), 'compétence'], [c('mcp'), 'connecteur MCP']],
      card: (n) => el('div', {}, el('b', {}, n.label), el('div', { class: 'sub' }, n.sub || '')),
    });
    return { detacher() {}, g };
  }

  function graphe3D(boite, vue) {
    const L = G3();
    const n = vue.noeuds.length, nl = vue.liens.length;
    const cvs = el('canvas', { class: 'pl-3d', tabindex: '0', role: 'img', 'aria-label': `Graphe 3D des compétences, connecteurs et plugins : ${n} points, ${nl} liens.` });
    const tip = el('div', { class: 'pl-tip', hidden: true });
    const sr = el('div', { class: 'pl-sr' }, ...listeAccessible({ noeuds: vue.noeuds }).map((x) => el('button', { type: 'button', onclick: () => ouvrirFiche(x.id) }, x.libelle)));
    boite.replaceChildren(cvs, tip, sr);
    const ctx = cvs.getContext && cvs.getContext('2d');
    if (!ctx) { mode = '2d'; motif = 'Vue 2D : ton appareil demande peu de mouvement, ou la vue 3D était trop lente.'; return graphe2D(boite, vue); }
    // Répartis à intervalle régulier, puis écartés s'ils restent trop proches sur leur anneau.
    const rg = rangs(vue.noeuds);
    const p3s = ecarter(vue.noeuds.map((nd) => placer(nd, undefined, rg.get(nd.id))));
    const places = vue.noeuds.map((nd, i) => ({ nd, p3: p3s[i] }));
    let rot = 0, points = [], dpr = 1, larg = 0, haut = 0;
    const taille = () => {
      const r = cvs.getBoundingClientRect();
      larg = Math.max(1, Math.round(r.width)); haut = Math.max(1, Math.round(r.height));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cvs.width = Math.round(larg * dpr); cvs.height = Math.round(haut * dpr);
    };
    const forme = (f, x, y, t) => {
      ctx.beginPath();
      if (f === 'carre') ctx.rect(x - t, y - t, t * 2, t * 2);
      else if (f === 'losange') { ctx.moveTo(x, y - t * 1.2); ctx.lineTo(x + t * 1.2, y); ctx.lineTo(x, y + t * 1.2); ctx.lineTo(x - t * 1.2, y); ctx.closePath(); }
      else if (f === 'triangle') { ctx.moveTo(x, y - t * 1.15); ctx.lineTo(x + t * 1.1, y + t * 0.85); ctx.lineTo(x - t * 1.1, y + t * 0.85); ctx.closePath(); }
      else ctx.arc(x, y, t, 0, Math.PI * 2);
    };
    function dessiner() {
      if (document.hidden || !larg) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, larg, haut);
      const couleur = {}; for (const s of Object.keys(COULEURS)) couleur[s] = cssVar(couleurDe(s), '#888');
      const ink = cssVar('--ink', '#ddd'), muted = cssVar('--muted', '#999'), bad = cssVar('--bad', '#c33');
      // Projection : la scène est ramenée dans la boîte (les points du bas et leurs noms restent visibles).
      // Sur une boîte large, l'anneau s'étire en largeur (après projection) : les noms se chevauchent moins.
      const etire = Math.min(2.2, Math.max(1, larg / haut));
      const etireY = Math.min(1.6, 1.25 * Math.max(1, haut / larg));
      // Caméra un peu au-dessus (camera) : la rotation est faite ici, projeter reçoit donc rot = 0.
      points = places.map(({ nd, p3 }) => { const c = camera(p3, rot); const p = L.projeter({ x: c.x, y: c.y * 0.86 + 0.04, z: c.z }, larg, haut, 0); return { id: nd.id, nd, ...p, sx: larg / 2 + (p.sx - larg / 2) * etire, sy: haut / 2 + (p.sy - haut / 2) * etireY, taille: p.taille * (ECHELLES[nd.sorte] || 1) * 0.85 }; });
      const parId = new Map(points.map((p) => [p.id, p]));
      ctx.lineWidth = 1.2;
      for (const l of vue.liens) {
        const a = parId.get(l.a), b = parId.get(l.b); if (!a || !b) continue;
        const av = ((a.prof + b.prof) / 2 + 1) / 2;
        ctx.globalAlpha = 0.25 + 0.45 * av; ctx.strokeStyle = muted; ctx.setLineDash(trait(l));
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      }
      ctx.setLineDash([]);
      const ordre = points.slice().sort((p, q) => p.prof - q.prof);
      for (const p of ordre) {
        const av = (p.prof + 1) / 2, s = p.nd.sorte, f = formeDe(s);
        ctx.globalAlpha = 0.45 + 0.55 * av;
        forme(f, p.sx, p.sy, p.taille);
        if (s === 'mcp' && p.nd.etat === 'a-relier') { ctx.lineWidth = 2; ctx.strokeStyle = couleur[s]; ctx.stroke(); }
        else { ctx.fillStyle = couleur[s]; ctx.fill(); }
        if (s === 'mcp' && p.nd.etat === 'panne') { ctx.lineWidth = 2.5; ctx.strokeStyle = bad; forme(f, p.sx, p.sy, p.taille + 3); ctx.stroke(); }
      }
      // Les noms, toujours écrits et à pleine opacité (lisibles en clair comme en sombre), sur un liseré de la couleur
      // du fond. Ceux de devant sont placés d'abord : dessous, au-dessus, à droite ou à gauche de leur point.
      ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'top';
      const devant = ordre.slice().reverse(), court = larg < 520 ? 14 : 22;
      const textes = devant.map((p) => tronquer(p.nd.nom, court));
      const places2 = placerEtiquettes(devant, textes.map((t) => ctx.measureText(t).width + 6), larg, haut);
      const fond = cssVar('--panel', '#222');
      ctx.globalAlpha = 1; ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = fond; ctx.fillStyle = ink;
      for (let i = devant.length - 1; i >= 0; i--) {
        const e = places2[i];
        ctx.textAlign = e.align;
        ctx.strokeText(textes[i], e.x, e.y); ctx.fillText(textes[i], e.x, e.y);
      }
      ctx.globalAlpha = 1;
    }
    taille();
    const t0 = performance.now(); dessiner(); const duree = performance.now() - t0;
    if (L.doitReplier({ webgl: true, premiereImageMs: duree }) && lire('odin.plugins.vue') !== '3d') {
      mode = '2d'; motif = 'Vue 2D : ton appareil demande peu de mouvement, ou la vue 3D était trop lente.';
      return graphe2D(boite, vue);
    }
    // Tourner à la main (aucune rotation automatique) ; un appui sans glisser ouvre la fiche du point.
    let glisse = null;
    const local = (e) => { const r = cvs.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cvs.addEventListener('pointerdown', (e) => { glisse = { x: e.clientX, y: e.clientY, rot, bouge: false }; try { cvs.setPointerCapture(e.pointerId); } catch { /* rien */ } });
    cvs.addEventListener('pointermove', (e) => {
      if (glisse) {
        if (!glisse.bouge && Math.hypot(e.clientX - glisse.x, e.clientY - glisse.y) >= 4) { glisse.bouge = true; cvs.classList.add('drag'); tip.setAttribute('hidden', ''); }
        if (glisse.bouge) { rot = glisse.rot + (e.clientX - glisse.x) / 140; dessiner(); }
        return;
      }
      const p = local(e), id = L.choisir(points, p.x, p.y);
      cvs.classList.toggle('on', Boolean(id));
      if (id) {
        const pt = points.find((x) => x.id === id);
        tip.textContent = `${pt.nd.nom} — ${pt.nd.sous}`; tip.removeAttribute('hidden');
        tip.style.left = `${Math.max(4, Math.min(larg - 200, pt.sx + 10))}px`; tip.style.top = `${Math.max(4, pt.sy - 34)}px`;
      } else tip.setAttribute('hidden', '');
    });
    cvs.addEventListener('pointerleave', () => { if (!glisse) tip.setAttribute('hidden', ''); });
    cvs.addEventListener('pointerup', (e) => {
      if (!glisse) return;
      const bouge = glisse.bouge; glisse = null; cvs.classList.remove('drag');
      if (!bouge) { const p = local(e), id = L.choisir(points, p.x, p.y); if (id) ouvrirFiche(id); }
    });
    cvs.addEventListener('pointercancel', () => { glisse = null; cvs.classList.remove('drag'); });
    cvs.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { rot += (e.key === 'ArrowLeft' ? -1 : 1) * Math.PI / 12; dessiner(); e.preventDefault(); } });
    let obs = null;
    try { obs = new ResizeObserver(() => { taille(); dessiner(); }); obs.observe(cvs); } catch { /* taille figée */ }
    const visible = () => dessiner();
    document.addEventListener('visibilitychange', visible);
    return { detacher() { try { if (obs) obs.disconnect(); } catch { /* rien */ } document.removeEventListener('visibilitychange', visible); } };
  }

  // ---------------- Les fiches (un clic sur un point)
  function ouvrirFiche(id) {
    if (!etat) return;
    const n = (etat.noeuds || []).find((x) => x.id === id);
    if (!n) return;
    if (n.sorte === 'skill') return ficheCompetence(n);
    if (n.sorte === 'mcp') return ficheConnecteur(n.nom);
    if (n.sorte === 'plugin') return fichePlugin(n);
    return ficheFixe(n);
  }
  const nomsPlugins = (ids) => { const m = pluginsParId(); return (ids || []).map((i) => (m.get(i) || { nom: i }).nom); };
  const ligne = (...k) => el('div', { class: 'pl-ligne' }, ...k);

  /** Ce qu'on sait VRAIMENT de Soul pour une compétence : un compte global du corpus, jamais un apprentissage affirmé. */
  function soulTexteCompetence() {
    const s = etat && etat.soul;
    if (!s || s.etat !== 'connu') return 'Soul : état inconnu pour l\'instant.';
    if (!(s.extraitsCompetences > 0)) return 'Soul : aucun extrait des compétences dans son corpus pour l\'instant.';
    return `Soul : son corpus contient ${s.extraitsCompetences} extrait(s) venus de l'ensemble des compétences ; le détail par compétence n'est pas enregistré.`;
  }

  function ficheCompetence(n) {
    const id = n.id, nom = n.nom;
    const mem = lienEntre('memoire', id), br = lienEntre('brain', id);
    const relies = (etat.liens || []).filter((l) => l.a === id && l.b.startsWith('mcp:'));
    const declares = new Set((etat.liensDeclares || []).filter((l) => l.skill === nom).map((l) => l.mcp));
    const libres = (etat.connecteurs || []).map((c) => c.nom).filter((m) => !declares.has(m));
    const st = el('p', { class: 'status', role: 'status' });
    const lier = async (mcp, relie) => {
      try { const r = await appel('/api/plugins/lien', { skill: nom, mcp, relie }); if (r.status !== 200) { st.textContent = erreurDe(r); return; } dlg.close(); await charger(); ouvrirFiche(id); }
      catch { st.textContent = 'Odin ne répond pas pour l\'instant.'; }
    };
    const choix = el('select', { 'aria-label': 'Connecteur à relier', id: 'plRelier' }, ...libres.map((m) => el('option', { value: m }, m)));
    const dlg = dialogue(nom,
      el('div', { class: 'pl-lignes' },
        n.sous ? ligne(n.sous) : null,
        ligne(`Plugins : ${nomsPlugins(n.plugins).join(', ') || 'aucun'}`),
        el('div', {}, el('b', {}, 'Connecteurs reliés'), relies.length ? el('ul', {}, ...relies.map((l) => el('li', {}, l.b.slice(4), ' — ', l.provenances.map((p) => provenanceTexte(p, l.n)).join(' · '),
          declares.has(l.b.slice(4)) ? [' ', bouton('Délier', () => lier(l.b.slice(4), false), { label: `Délier ${l.b.slice(4)}` })] : null))) : el('p', { class: 'sub' }, 'Aucun.')),
        ligne(br ? `Brain : citée dans ${br.n || 0} note(s)` : 'Brain : aucune note ne la cite'),
        ligne(mem ? `Mémoire : utilisée ${mem.n || 0} fois` : 'Mémoire : jamais utilisée'),
        ligne(soulTexteCompetence()),
        libres.length ? el('div', { class: 'field' }, el('label', { for: 'plRelier' }, 'Relier à un connecteur'), el('div', { class: 'pl-acts' }, choix, bouton('Relier', () => { if (choix.value) lier(choix.value, true); }))) : null),
      st, el('div', { class: 'pl-pied' }, bouton('Fermer', () => dlg.close())));
  }

  function ficheConnecteur(nom) {
    const c = (etat.connecteurs || []).find((x) => x.nom === nom);
    if (!c) return;
    const id = `mcp:${nom}`, nd = (etat.noeuds || []).find((x) => x.id === id);
    const relies = (etat.liens || []).filter((l) => l.b === id && l.a.startsWith('skill:'));
    const dlg = dialogue(nom,
      el('div', { class: 'pl-lignes' },
        ligne('État : ', pastille(c), c.etat === 'panne' && c.detail ? el('div', { class: 'sub' }, c.detail) : null),
        ligne('Adresse : ', el('span', { class: 'mono' }, c.adresse)),
        el('div', {}, el('b', {}, `Outils (${c.outils.length})`), c.outils.length ? el('ul', {}, ...c.outils.map((o) => el('li', {}, el('span', { class: 'mono' }, o.nom),
          el('span', { class: o.acces === 'lecture' || (!o.acces && !o.peutModifier) ? 'pl-badge' : 'pl-badge mod' }, accesTexte(o)),
          o.description ? el('div', { class: 'sub' }, o.description) : null))) : el('p', { class: 'sub' }, 'Aucun outil annoncé.')),
        c.outils.length ? el('p', { class: 'pl-aide' }, 'Ces descriptions et déclarations viennent du serveur et ne sont pas vérifiées. Un outil qui peut modifier, ou qui ne déclare rien, n\'est jamais traité comme une simple lecture.') : null,
        el('div', {}, el('b', {}, 'Compétences reliées'), relies.length ? el('ul', {}, ...relies.map((l) => el('li', {}, l.a.slice(6), ' — ', l.provenances.map((p) => provenanceTexte(p, l.n)).join(' · ')))) : el('p', { class: 'sub' }, 'Aucune.')),
        ligne(`Plugins : ${nomsPlugins(nd && nd.plugins).join(', ') || 'aucun'}`)),
      el('div', { class: 'pl-pied' }, bouton('Fermer', () => dlg.close())));
  }

  function fichePlugin(n) {
    const p = pluginsParId().get(n.id.slice(7));
    if (!p) return;
    const liste = (titre, ms, f) => el('div', {}, el('b', {}, titre), ms.length ? el('ul', {}, ...ms.map((m) => el('li', {}, m.present ? m.nom : el('span', { class: 'pl-absent' }, m.nom), m.present ? '' : (f ? ' (absente)' : ' (absent)')))) : el('p', { class: 'sub' }, f ? 'Aucune.' : 'Aucun.'));
    const dlg = dialogue(p.nom,
      el('div', { class: 'pl-lignes' }, p.description ? ligne(p.description) : null, liste('Compétences', p.skills || [], true), liste('Connecteurs', p.mcp || [], false)),
      el('div', { class: 'pl-pied' }, bouton('Modifier', () => { dlg.close(); editerPlugin(p); }), bouton('Supprimer', () => supprimerPlugin(p, dlg), { class: 'btn small danger' }), bouton('Fermer', () => dlg.close())));
  }

  function ficheFixe(n) {
    let texte;
    if (n.sorte === 'brain') { const k = Number((/^(\d+)/.exec(n.sous || '') || [0, 0])[1]); texte = `Notes qui citent une compétence, un connecteur ou un plugin : ${k}. Pour relier une note, écris [[skill:nom-de-la-compétence]], [[mcp:Nom]] ou [[plugin:id]] dedans ([[nom]] seul compte aussi, sauf si une note porte déjà ce nom).`; }
    else if (n.sorte === 'memoire') {
      const ls = (etat.liens || []).filter((l) => l.a === 'memoire');
      texte = `Compétences utilisées : ${ls.filter((l) => l.b.startsWith('skill:')).length} · Connecteurs appelés dans les tours observés : ${ls.filter((l) => l.b.startsWith('mcp:')).length}.`;
    } else texte = !(etat.soul && etat.soul.etat === 'connu') ? 'État de Soul inconnu pour l\'instant.'
      : etat.soul.extraitsCompetences > 0 ? `Le corpus de Soul contient ${etat.soul.extraitsCompetences} extrait(s) venus des compétences (ce qu'il lit pour apprendre ; ce n'est pas la preuve qu'il les a appris). Le détail par compétence n'est pas enregistré : Soul n'a donc aucun lien vers une compétence précise.`
        : 'Le corpus de Soul ne contient encore aucun extrait des compétences.';
    const dlg = dialogue(n.nom, el('p', {}, texte), el('div', { class: 'pl-pied' }, bouton('Fermer', () => dlg.close())));
  }

  // ---------------- Démarrage
  function init() {
    monter();
    document.addEventListener('odin:vue', (e) => { if (e.detail && e.detail.vue === 'skills') setTimeout(monter, 0); else detacherGraphe(); });
  }
  if (aDocument && document.addEventListener) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init(); }

  window.OdinPlugins = { logique, ouvrir: (id) => ouvrirFiche(id), recharger: charger };
})();
