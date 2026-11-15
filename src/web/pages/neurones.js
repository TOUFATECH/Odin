// Les liens du Cerveau comme des synapses, côté carte (page Cerveau, brain.js).
// Chaque lien a une force (0 à 1) donnée par le serveur (/api/brain/graph?forces=1) : plus il est fort, plus il est
// épais et clair. Les liens appris par Odin sont en pointillé violet, les freins (une note en remplace ou en contredit
// une autre) en rouge barré. Quand Odin réfléchit, l'influx court le long des liens (le moteur « échanges » de
// graph.js, pas un second moteur) ; un point consulté s'allume (halo), puis se repose (anneau gris).
// Sans les forces du serveur, rien ne change : une arête sans `f` est dessinée comme avant.
// Rien au hasard : les égalités sont départagées par identifiant. Aucun texte de note ici, seulement titres et ids.
//   window.OdinNeurones = { BASE, APPRIS_VISIBLE, REPOS_MS, style, texteLien, pickLien, moteurNeurones, influx, liens,
//                           etatPoint, dessinerLiens, dessinerPoints, brancher, reglages }
(() => {
  'use strict';
  if (window.OdinNeurones) return;
  // Constantes du contrat (recopiées du serveur).
  const BASE = { ecrit: 0.30, usage: 0.35, appris: 0 };
  const APPRIS_VISIBLE = 0.15, REPOS_MS = 60000;
  const HALO_MS = 1200, HALO_REDUIT_MS = 3500, INFLUX_MAX = 40, DELAI_MAX = 3000, GROUPE_MS = 1500;
  const VIOLET = '#A78BFA', ROUGE = '#C0504D', ACCENT = '#4CC38A';
  // Chaque groupe de force est tracé d'un seul trait, avec la force du milieu du groupe (0,30 : la base écrite).
  const MILIEU = [0.10, 0.30, 0.55, 0.85];
  const cache = (id) => typeof id !== 'string' || id.startsWith('m:') || id.startsWith('s:'); // jamais vers la carte

  /** f arrondi à 0,05 (pas de scintillement quand la force bouge un peu). */
  const arrondi = (f) => Math.round(Math.max(0, Math.min(1, Number(f) || 0)) * 20) / 20;
  /** Épaisseur (× épaisseur réglée) et éclat d'un lien de force f. */
  function style(f, o) {
    const g = arrondi(f);
    return { largeur: 0.4 + 2 * g, alpha: Math.min(1, 0.35 + 1.5 * g), groupe: g < 0.2 ? 0 : g < 0.4 ? 1 : g < 0.7 ? 2 : 3, tiret: o === 'appris' };
  }

  // ---------- Le texte au survol d'un lien ----------
  const virgule = (x) => (Number(x) || 0).toFixed(2).replace('.', ',');
  const HEURE = 3600e3, JOUR = 24 * HEURE;
  function duree(ms) { return ms < HEURE ? 'moins d\'une heure' : ms < JOUR ? `${Math.floor(ms / HEURE)} h` : `${Math.floor(ms / JOUR)} j`; }
  /** « Lien écrit par toi dans [[Projet]] · force 0,30 (de base) · jamais servi ». `noms` : Map, objet ou fonction id → titre. */
  function texteLien(e, noms, now = Date.now()) {
    const nom = (id) => (typeof noms === 'function' ? noms(id) : noms && typeof noms.get === 'function' ? noms.get(id) : noms?.[id]) || id;
    const o = e.o, base = BASE[o] ?? 0, f = typeof e.f === 'number' ? e.f : null, n = Number(e.n) || 0;
    let t;
    if (e.fr === 'remplace' || e.fr === 'contredit') t = `Freine : [[${nom(e.from)}]] ${e.fr} [[${nom(e.to)}]]`;
    else if (o === 'appris') t = `Lien appris par Odin : utilisés ensemble dans ${n} réponse${n > 1 ? 's' : ''}`;
    else if (o === 'usage') t = 'Lien entre applis, déclaré dans Odin';
    else t = `Lien écrit par toi dans [[${nom(e.from)}]]`;
    if (f === null) return t; // un frein seul : pas de force
    t += ` · force ${virgule(f)}${o !== 'appris' && f <= base + 0.005 ? ' (de base)' : ''}`;
    if (!n) return `${t} · jamais servi`;
    t += ` · servi ${n} fois`;
    const vu = Number(e.vu) || 0;
    if (vu > 0) {
      const age = Math.max(0, now - vu);
      t += `, dernière il y a ${duree(age)}`;
      if (age < 7 * JOUR) t += ', se renforce';
      else if (f > base + 0.02) t += ', s\'efface';
    }
    return t;
  }

  /** Le lien (avec une force ou un frein) le plus proche de `p`, à moins de 5/k ; sinon null. */
  function pickLien(edges, p, k = 1) {
    let best = null, bd = 5 / k;
    for (const e of edges || []) {
      if (typeof e.f !== 'number' && !e.fr) continue;
      const A = e.a, B = e.b; if (!A || !B) continue;
      const dx = B.x - A.x, dy = B.y - A.y, L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p.x - A.x) * dx + (p.y - A.y) * dy) / L));
      const d = Math.hypot(p.x - (A.x + t * dx), p.y - (A.y + t * dy));
      if (d < bd || (d === bd && best && `${e.from}>${e.to}` < `${best.from}>${best.to}`)) { bd = d; best = e; }
    }
    return best;
  }

  // ---------- Le dessin des liens ----------
  /**
   * Dessine les liens d'un coup : un seul trait par groupe de force et par style. `o` : { k, lw, alpha, hover, light,
   * link, linkHi, rayon(n) }. Une arête sans `f` (mention, étiquette, source, dossier…) est tracée comme avant.
   */
  function dessinerLiens(ctx, edges, o = {}) {
    const k = o.k || 1, lw = o.lw ?? 0.7 / k, alpha = o.alpha ?? 1, hover = o.hover || null;
    const plain = [], freins = [], ecrits = [[], [], [], []], appris = [[], [], [], []], chauds = [];
    for (const e of edges) {
      if (!e.a || !e.b) continue;
      if (hover && (e.a === hover || e.b === hover)) { chauds.push(e); continue; }
      if (e.fr === 'remplace' || e.fr === 'contredit') freins.push(e);
      else if (typeof e.f !== 'number') plain.push(e);
      else (e.o === 'appris' || e.kind === 'appris' ? appris : ecrits)[style(e.f, e.o).groupe].push(e);
    }
    const trace = (list) => { ctx.beginPath(); for (const e of list) { ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); } ctx.stroke(); };
    if (plain.length) { ctx.lineWidth = lw; ctx.strokeStyle = o.link; ctx.globalAlpha = alpha; trace(plain); }
    ecrits.forEach((list, g) => {
      if (!list.length) return;
      const s = style(MILIEU[g]);
      ctx.lineWidth = lw * s.largeur; ctx.globalAlpha = alpha * s.alpha;
      ctx.strokeStyle = g === 3 ? (o.light ? 'rgba(40,44,52,.55)' : 'rgba(220,224,232,.55)') : o.link;
      trace(list);
    });
    let tirets = false;
    appris.forEach((list, g) => {
      if (!list.length) return;
      const s = style(MILIEU[g], 'appris');
      if (!tirets) { ctx.setLineDash([3 / k, 3 / k]); tirets = true; }
      ctx.lineWidth = lw * Math.max(1, s.largeur); ctx.globalAlpha = alpha * Math.max(0.75, s.alpha); ctx.strokeStyle = VIOLET; // pointillé : jamais plus fin que la base
      trace(list);
    });
    if (tirets) ctx.setLineDash([]);
    if (freins.length) {
      // Trait fin rouge sourd, et une petite barre en travers près du bout `to` (celle qui est remplacée ou contredite).
      ctx.lineWidth = lw; ctx.globalAlpha = alpha; ctx.strokeStyle = ROUGE; ctx.beginPath();
      for (const e of freins) {
        const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
        const r = Math.min((o.rayon ? o.rayon(e.b) : 0) + 4 / k, d * 0.4), x = e.b.x - ux * r, y = e.b.y - uy * r, h = 4 / k;
        ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.moveTo(x - uy * h, y + ux * h); ctx.lineTo(x + uy * h, y - ux * h);
      }
      ctx.stroke();
    }
    // Le survol d'un point garde sa mise en avant.
    if (chauds.length) { ctx.globalAlpha = 1; ctx.strokeStyle = o.linkHi; ctx.lineWidth = lw * 2; trace(chauds); }
    ctx.globalAlpha = 1;
  }

  // ---------- Influx, neurones allumés et au repos ----------
  /**
   * Un moteur : `now()` l'heure, `plusTard(fn, ms)` un minuteur, `echanges` (ou une fonction qui le rend) : le moteur
   * des échanges de graph.js, `reduit` (booléen ou fonction) : mouvement réduit.
   */
  function moteurNeurones(opts = {}) {
    const now = opts.now || (() => Date.now());
    const plusTard = opts.plusTard || ((fn, ms) => setTimeout(fn, ms));
    const ech = () => (typeof opts.echanges === 'function' ? opts.echanges() : opts.echanges);
    const reduitDe = () => {
      if (typeof opts.reduit === 'function') return Boolean(opts.reduit());
      if (typeof opts.reduit === 'boolean') return opts.reduit;
      try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
    };
    const allumes = new Map(), branches = new Set();
    // Un seul minuteur à la fois : `jeton` désigne le seul réveil valable (un réveil plus ancien ne fait plus rien).
    let prevu = Infinity, jeton = 0, dernier = -Infinity;

    function allumer(id, nom, a) {
      const t = now(), x = allumes.get(id);
      if (x && t - x.t < HALO_MS) { x.a = Math.max(x.a, a); x.nom = x.nom || nom; }
      else allumes.set(id, { a, t, nom: nom || '' });
      reveil(0);
    }
    /** Les entrées d'influx du tour : rejoue celles qui ne sont pas déjà des étapes, et allume les points. */
    function influx(list, etapes) {
      if (!Array.isArray(list) || !list.length) return 0;
      const deja = new Set((Array.isArray(etapes) ? etapes : []).filter((e) => e && typeof e.de === 'string').map((e) => `${e.de}>${e.vers}`));
      const bons = list.filter((e) => e && !cache(e.de) && !cache(e.vers) && e.de !== e.vers && typeof e.a === 'number')
        .map((e) => ({ ...e, saut: Math.max(0, Math.min(2, Number(e.saut) || 0)), a: Math.max(0, Math.min(1, e.a)) }))
        .sort((x, y) => x.saut - y.saut || y.a - x.a || (x.vers < y.vers ? -1 : x.vers > y.vers ? 1 : 0))
        .slice(0, INFLUX_MAX);
      const rangs = [0, 0, 0];
      let rejoues = 0;
      for (const e of bons) {
        const rang = rangs[e.saut]++, delai = Math.min(DELAI_MAX, 600 + e.saut * 450 + rang * 120), rejoue = !deja.has(`${e.de}>${e.vers}`);
        if (rejoue) rejoues++;
        plusTard(() => {
          if (rejoue) ech()?.recevoir({ de: e.de, vers: e.vers, deNom: e.deNom || '', versNom: e.versNom || '', libelle: 'influx', action: 'propager', phase: 'demande', ok: true, at: new Date(now()).toISOString(), a: e.a });
          // « Odin » n'est pas un point du Cerveau (0,0 tombe sur une note quelconque) : il ne s'allume pas.
          if (e.vers !== 'odin') allumer(e.vers, e.versNom, e.a);
        }, delai);
      }
      return rejoues;
    }
    /** Halo (0 à 1) et repos d'un point à l'instant t. */
    function etatPoint(id, t = now()) {
      const x = allumes.get(id);
      if (!x) return { halo: 0, repos: false };
      const dt = t - x.t;
      if (dt < 0) return { halo: 0, repos: false };
      const halo = reduitDe() ? (dt < HALO_REDUIT_MS ? x.a : 0) : Math.max(0, x.a * (1 - dt / HALO_MS));
      return { halo, repos: dt < REPOS_MS };
    }
    /** Dessine halos puis anneaux de repos, avant les points. `o` : { k, reduit, noeud(id, nom) → { x, y, r }, t }. */
    function dessinerPoints(ctx, o = {}) {
      const k = o.k || 1, t = o.t ?? now();
      for (const [id, x] of allumes) {
        if (t - x.t >= REPOS_MS) { allumes.delete(id); continue; }
        if (id === 'odin') continue;
        const n = o.noeud ? o.noeud(id, x.nom) : null; if (!n) continue;
        const { halo, repos } = etatPoint(id, t), r = n.r || 0;
        if (halo > 0.01) { ctx.globalAlpha = halo * 0.45; ctx.fillStyle = ACCENT; ctx.beginPath(); ctx.arc(n.x, n.y, r + 7 / k, 0, Math.PI * 2); ctx.fill(); }
        else if (repos) { ctx.globalAlpha = 0.6; ctx.strokeStyle = '#8A8F98'; ctx.lineWidth = 1 / k; ctx.beginPath(); ctx.arc(n.x, n.y, r + 3 / k, 0, Math.PI * 2); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
    }
    /** Les liens qui ont changé pendant le tour : force, usages et date mis à jour sur les cartes ouvertes. */
    function liens(changes) {
      if (!Array.isArray(changes)) return 0;
      let fait = 0;
      for (const b of [...branches]) {
        if (!b.vivant()) { branches.delete(b); continue; }
        const c = b.carte; if (!c || !Array.isArray(c.edges) || (c.actif && !c.actif())) continue;
        let bouge = false;
        for (const x of changes.slice(0, 30)) {
          if (!x || cache(x.de) || cache(x.vers) || typeof x.f !== 'number') continue;
          const A = c.noeud(x.de, x.deNom), B = c.noeud(x.vers, x.versNom);
          if (!A || !B || A === B) continue;
          const e = c.edges.find((y) => (y.kind === 'lien' || y.kind === 'appris') && ((y.a === A && y.b === B) || (y.a === B && y.b === A)));
          if (e) { e.f = x.f; e.n = Number(x.n) || 0; e.vu = Number(x.vu) || 0; if (!e.o && x.o) e.o = x.o; bouge = true; fait++; }
          else if (x.f >= APPRIS_VISIBLE) { c.edges.push({ from: A.id, to: B.id, kind: 'appris', f: x.f, o: 'appris', n: Number(x.n) || 0, vu: Number(x.vu) || 0, a: A, b: B }); bouge = true; fait++; }
        }
        if (bouge) try { b.redessiner(); } catch { /* carte fermée entre-temps */ }
      }
      return fait;
    }
    /**
     * Une carte se branche : redessinée tant qu'un halo vit (30 fois par seconde au plus), puis une fois à la fin de
     * chaque repos. `carte` (facultatif) : { edges, noeud(id, nom), actif() } pour les mises à jour de liens().
     */
    function brancher(redessiner, vivant = () => true, carte = null) {
      const b = { redessiner, vivant, carte }; branches.add(b);
      if (allumes.size) reveil(0);
      return () => branches.delete(b);
    }
    function reveil(ms) {
      const t = now(), quand = Math.max(t + ms, dernier + 33); // 30 images par seconde au plus, même quand un point s'allume
      if (!branches.size || quand >= prevu) return;
      prevu = quand; const j = ++jeton;
      plusTard(() => { if (j === jeton) boucle(); }, quand - t);
    }
    function boucle() {
      prevu = Infinity;
      const t = now(), reduit = reduitDe();
      dernier = t;
      for (const b of [...branches]) { if (!b.vivant()) { branches.delete(b); continue; } try { b.redessiner(); } catch { /* carte fermée */ } }
      // Les fins (halo fixe en mouvement réduit, repos) d'un même tour sont regroupées : un seul dessin efface toutes
      // celles qui tombent dans la même fenêtre (GROUPE_MS), au lieu d'un dessin par point.
      const fins = [];
      let vit = false;
      for (const [id, x] of allumes) {
        const fin = x.t + (reduit ? HALO_REDUIT_MS : HALO_MS), repos = x.t + REPOS_MS;
        if (t >= repos) { allumes.delete(id); continue; }
        if (t < fin) vit = true;
        fins.push(t < fin ? fin : repos);
      }
      if (vit && !reduit) { reveil(33); return; }
      if (!fins.length) return;
      fins.sort((a, b) => a - b);
      let quand = fins[0];
      for (const f of fins) if (f - fins[0] <= GROUPE_MS) quand = f;
      reveil(Math.max(0, quand - t + 5));
    }
    return { influx, etatPoint, dessinerPoints, dessinerLiens, liens, brancher, allumes };
  }

  // ---------- Réglages « Liens vivants » (propriétaire seulement : le serveur répond 403 à un membre) ----------
  function injecterCss() {
    if (typeof document === 'undefined' || document.getElementById('neurones-css')) return;
    const s = document.createElement('style'); s.id = 'neurones-css';
    s.textContent = '.nr-liens{display:flex;flex-direction:column;gap:6px;padding:4px 0}.nr-leg{margin:0;color:var(--muted,#9AA0A8);font-size:12px;line-height:1.45}'
      + '.nr-etat{color:var(--muted,#9AA0A8);font-size:12.5px}.nr-btns{display:flex;gap:6px;flex-wrap:wrap}.nr-msg{font-size:12.5px;min-height:1em}'
      // Le panneau du graphe garde son fond sombre même quand l'appli est en thème clair : ses couleurs, pas celles de l'appli.
      + '.g-panel .nr-leg,.g-panel .nr-etat{color:#9AA0A8}.g-light .g-panel .nr-leg,.g-light .g-panel .nr-etat{color:var(--muted,#5A6470)}';
    (document.head || document.documentElement).append(s);
  }
  async function appel(path, body) {
    try {
      const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) } : { headers: { 'x-odin': '1' } });
      if (!r.ok) return null;
      return await r.json().catch(() => null);
    } catch { return null; }
  }
  /** Remplit `hote` : légende, interrupteur, bilan de la nuit, boutons d'oubli. `apres()` : après un oubli (redessiner). */
  async function reglages(hote, apres) {
    if (!hote) return;
    injecterCss();
    const el = (t, a = {}, ...kids) => { const n = document.createElement(t); for (const [k, v] of Object.entries(a)) { if (v === undefined || v === null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v); } for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); return n; };
    const leg = el('p', { class: 'nr-leg' }, 'Trait épais et clair : lien fort. Pointillé violet : appris par Odin. Rouge barré : une note en remplace ou en contredit une autre. Halo : consulté à l\'instant ; anneau gris : au repos.');
    hote.classList?.add('nr-liens');
    hote.replaceChildren(leg, el('span', { class: 'nr-etat' }, 'Chargement…'));
    const r = await appel('/api/brain/liens');
    if (!r || r.ok !== true) { hote.replaceChildren(leg, el('span', { class: 'nr-etat' }, 'Liens vivants : indisponible')); return; }
    const msg = el('span', { class: 'nr-msg', role: 'status' });
    const bilan = r.nuit ? `Cette nuit : ${r.nuit.renforces} lien${r.nuit.renforces > 1 ? 's' : ''} renforcé${r.nuit.renforces > 1 ? 's' : ''}, ${r.nuit.effaces} effacé${r.nuit.effaces > 1 ? 's' : ''}` : 'Pas encore de nuit de consolidation.';
    const sw = el('input', { type: 'checkbox', class: 'g-sw', checked: r.actif ? true : undefined, onchange: async (e) => {
      const voulu = e.target.checked, x = await appel('/api/brain/liens/reglage', { actif: voulu });
      if (!x || x.ok !== true) { e.target.checked = !voulu; msg.textContent = '✗ Réglage refusé.'; return; }
      e.target.checked = Boolean(x.actif); msg.textContent = x.actif ? 'Odin apprend des liens.' : 'Odin n\'apprend plus de liens (ceux déjà appris sont gardés).';
    } });
    const oublier = (quoi, question) => async () => {
      if (!window.OdinDialog || !(await window.OdinDialog.confirm(question, { danger: true }))) return;
      const x = await appel('/api/brain/liens/oublier', { quoi });
      msg.textContent = x && x.ok ? `${x.effaces} lien${x.effaces > 1 ? 's' : ''} oublié${x.effaces > 1 ? 's' : ''}.` : `✗ ${(x && x.error) || 'Refusé.'}`;
      if (x && x.ok && typeof apres === 'function') apres();
    };
    hote.replaceChildren(leg,
      el('label', { class: 'g-row' }, el('span', {}, 'Odin apprend des liens'), sw),
      el('span', { class: 'nr-etat' }, `${r.appris} lien${r.appris > 1 ? 's' : ''} appris · ${r.candidats} en formation`),
      el('span', { class: 'nr-etat' }, bilan),
      el('div', { class: 'nr-btns' },
        el('button', { type: 'button', class: 'br-mini', onclick: oublier('appris', 'Oublier tous les liens appris par Odin ? Les liens que tu as écrits restent. Une copie est gardée.') }, 'Oublier les liens appris'),
        el('button', { type: 'button', class: 'br-mini', onclick: oublier('tout', 'Tout remettre à zéro ? Tous les liens repartent de leur force de base. Une copie est gardée.') }, 'Tout remettre à zéro')),
      msg);
  }

  // L'instance commune, liée au moteur des échanges de graph.js (cherché à l'usage : rien n'est lu au chargement).
  const commun = moteurNeurones({ echanges: () => window.OdinGraph?.echanges });
  window.OdinNeurones = {
    BASE, APPRIS_VISIBLE, REPOS_MS, style, texteLien, pickLien, moteurNeurones, dessinerLiens, reglages,
    influx: commun.influx, liens: commun.liens, etatPoint: commun.etatPoint, dessinerPoints: commun.dessinerPoints, brancher: commun.brancher,
  };
})();
