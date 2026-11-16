// Plein écran d'Odin : une partie de la page (la carte des applis, la grille, le graphe du Cerveau) prend tout l'écran.
// La partie reçoit la classe `pe-plein` (posée par-dessus la page, couche 40) et le navigateur passe en plein écran sur
// toute la page (jamais sur la partie seule) : la mascotte, les notices, les fenêtres d'Odin et les boîtes de dialogue
// restent ainsi au-dessus. On sort par Échap (sauf si une boîte de dialogue est ouverte), par la sortie du plein écran
// du navigateur, en changeant d'écran (événement odin:vue) ou en rappuyant sur le bouton.
// Et le déplacement au clavier dans une carte : flèches, + et −, 0 pour tout voir, Entrée pour ouvrir.
// Ce fichier est chargé avant les autres scripts de l'interface : rien ne touche au document à son chargement.
// API : OdinPleinEcran.basculer(cible) / entrer / sortir / actif / bouton(cible) / clavier(surface, actions) / logique.
(() => {
  'use strict';
  if (window.OdinPleinEcran) return;

  // ---------------- Logique pure (sans document)
  const PAS = 60, PAS_MAJ = 180;
  /** La touche pressée → ce qu'elle fait dans la carte, ou null. Maj : pas trois fois plus grand. */
  function touche(key, maj) {
    const p = maj ? PAS_MAJ : PAS;
    switch (key) {
      case 'ArrowLeft': return { type: 'deplacer', dx: p, dy: 0 };
      case 'ArrowRight': return { type: 'deplacer', dx: -p, dy: 0 };
      case 'ArrowUp': return { type: 'deplacer', dx: 0, dy: p };
      case 'ArrowDown': return { type: 'deplacer', dx: 0, dy: -p };
      case '+': case '=': return { type: 'zoom', f: 1.25 };
      case '-': return { type: 'zoom', f: 0.8 };
      case '0': return { type: 'recadrer' };
      case 'Enter': case ' ': return { type: 'ouvrir' };
      default: return null;
    }
  }
  /** Le zoom gardé entre deux bornes. */
  function borner(k, min = 0.2, max = 4) { const v = Number(k); if (!Number.isFinite(v)) return min; return Math.min(max, Math.max(min, v)); }
  /** Le point le plus proche de (cx, cy), par son identifiant, ou null s'il n'y a aucun point. */
  function plusProche(points, cx, cy) {
    let best = null, bd = Infinity;
    for (const p of points || []) { const d = Math.hypot(p.x - cx, p.y - cy); if (d < bd) { bd = d; best = p.id; } }
    return best;
  }
  const logique = { touche, borner, plusProche, PAS, PAS_MAJ };

  // ---------------- Dessin
  const AIDE = 'Flèches : se déplacer · + et − : zoomer · 0 : tout voir · Entrée : ouvrir';
  const css = `
.pe-plein{position:fixed!important;inset:0!important;z-index:40!important;background:var(--bg)!important;margin:0!important;border:0!important;border-radius:0!important;width:auto!important;height:auto!important;max-width:none!important;max-height:none!important;min-height:0!important}
html[data-plein-ecran="1"] body{overflow:hidden}
html[data-plein-ecran="1"] main{z-index:auto!important}
.pe-btn{cursor:pointer}.pe-btn svg{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.pe-btn[aria-pressed=true]{color:var(--accent);border-color:var(--accent)}
.pe-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (pointer:coarse){.pe-btn{min-width:44px;min-height:44px}}
.pe-aide{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
@media (prefers-reduced-motion:reduce){.pe-plein,.pe-btn{transition:none!important;animation:none!important}}`;
  const ICONE = { entrer: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>', sortir: '<path d="M9 4v5H4M15 4v5h5M15 20v-5h5M9 20v-5H4"/>' };
  let actuel = null, demande = false, pret = false, nAide = 0;
  const boutons = new Set();
  function styler() { if (!document.getElementById('peCss')) { const s = document.createElement('style'); s.id = 'peCss'; s.textContent = css; document.head.append(s); } }
  function installer() {
    if (pret) return; pret = true; styler();
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !actuel || document.querySelector('dialog[open]')) return;
      e.preventDefault(); e.stopPropagation(); sortir();
    }, true);
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && actuel && demande) { demande = false; sortir(); } });
    document.addEventListener('odin:vue', () => { if (actuel) sortir(); });
  }
  function peindreBoutons() {
    for (const b of [...boutons]) {
      if (!b.isConnected && b._peVu) { boutons.delete(b); continue; }
      const on = Boolean(actuel) && actuel === b._peCible, lib = on ? 'Quitter le plein écran (Échap)' : b._peLib;
      b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', lib); b.title = lib;
      const t = b.querySelector('.hl'); if (t) t.textContent = lib;
      const s = b.querySelector('svg'); if (s) s.innerHTML = on ? ICONE.sortir : ICONE.entrer;
      if (b.isConnected) b._peVu = true;
    }
  }
  function annoncer() { document.dispatchEvent(new CustomEvent('odin:plein-ecran', { detail: { actif: Boolean(actuel), cible: actuel } })); }
  function entrer(cible) {
    if (!cible) return;
    installer();
    if (actuel && actuel !== cible) { remplacer(cible); return; }
    actuel = cible; cible.classList.add('pe-plein');
    document.documentElement.setAttribute('data-plein-ecran', '1');
    try {
      const de = document.documentElement;
      if (!document.fullscreenElement && de.requestFullscreen) { demande = true; const p = de.requestFullscreen(); if (p && p.catch) p.catch(() => { demande = false; }); }
    } catch { demande = false; }
    peindreBoutons(); annoncer();
  }
  function sortir() {
    if (!actuel) return;
    const c = actuel; actuel = null; c.classList.remove('pe-plein');
    document.documentElement.removeAttribute('data-plein-ecran');
    if (demande && document.fullscreenElement && document.exitFullscreen) { demande = false; try { const p = document.exitFullscreen(); if (p && p.catch) p.catch(() => {}); } catch { /* déjà sorti */ } }
    demande = false;
    peindreBoutons();
    document.dispatchEvent(new CustomEvent('odin:plein-ecran', { detail: { actif: false, cible: c } }));
  }
  /** Une nouvelle partie prend la place de l'actuelle (un graphe redessiné) : le navigateur reste en plein écran. */
  function remplacer(cible) {
    if (!cible) return;
    if (!actuel) { entrer(cible); return; }
    if (actuel === cible) return;
    actuel.classList.remove('pe-plein');
    actuel = cible; cible.classList.add('pe-plein');
    peindreBoutons(); annoncer();
  }
  /** Entre ou sort ; rend vrai si on vient d'entrer. */
  function basculer(cible) { if (actuel && actuel === cible) { sortir(); return false; } entrer(cible); return true; }
  /** Le bouton « Plein écran » d'une partie de la page (icône des quatre coins, libellé qui change quand c'est actif). */
  function bouton(cible, o = {}) {
    installer();
    const libelle = o.libelle || 'Plein écran';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'hbtn pe-btn';
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONE.entrer}</svg><span class="hl"></span>`;
    b._peCible = cible; b._peLib = libelle;
    b.addEventListener('click', (e) => { e.stopPropagation(); basculer(cible); });
    boutons.add(b); peindreBoutons();
    return b;
  }
  const champ = (n) => Boolean(n && (/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName) || n.isContentEditable));
  /** Le déplacement au clavier sur une surface (la carte) ; rend la fonction qui le détache. */
  function clavier(surface, f = {}) {
    installer();
    if (!surface.hasAttribute('tabindex')) surface.setAttribute('tabindex', '0');
    const aide = document.createElement('span'); aide.className = 'pe-aide'; aide.id = `peAide${++nAide}`; aide.textContent = AIDE;
    (surface.parentElement || document.body).append(aide);
    const avant = surface.getAttribute('aria-describedby');
    surface.setAttribute('aria-describedby', avant ? `${avant} ${aide.id}` : aide.id);
    const surTouche = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (champ(e.target) || champ(document.activeElement)) return;
      const a = touche(e.key, e.shiftKey); if (!a) return;
      if (a.type === 'ouvrir' && !f.ouvrir) return;
      e.preventDefault();
      if (a.type === 'deplacer') f.deplacer?.(a.dx, a.dy);
      else if (a.type === 'zoom') f.zoomer?.(a.f);
      else if (a.type === 'recadrer') f.recadrer?.();
      else f.ouvrir?.();
    };
    surface.addEventListener('keydown', surTouche);
    return () => { surface.removeEventListener('keydown', surTouche); aide.remove(); if (avant) surface.setAttribute('aria-describedby', avant); else surface.removeAttribute('aria-describedby'); };
  }

  window.OdinPleinEcran = { basculer, entrer, remplacer, sortir, actif: () => actuel, bouton, clavier, logique, AIDE };
})();
