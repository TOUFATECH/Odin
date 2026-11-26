// La famille « Stockage » des widgets de l'accueil (maquette validée « Accueil », la carte de Pyramide) : son style de
// départ, « Lignes ». Le remplissage de la machine d'Odin en anneau, la place libre, les partages, puis chaque volume
// (le plus rempli d'abord, sa barre, sa part utilisée, sa place libre), ses disques et ses partages par leur nom.
// Ce fichier DÉCLARE sa sorte au registre commun (pages/widgets-rendu.js) ; l'accueil la dessine et la propose sans rien
// savoir d'elle. Chaque dessin est fait de l'état que le serveur a rendu (src/valhalla/widgets/stockage.ts).
// - Rien d'inventé : une donnée sans volume lisible n'est pas dessinée (l'hôte dit qu'Odin ne sait pas) ; jamais un
//   « 0 % » à la place d'une absence. Aucun partage : « Aucun partage. », dit simplement.
// - Une taille s'écrit avec son unité, dans la langue de la page (Intl), en puissances de 1024 comme Pyramide l'écrit.
// - Un nom (point de montage, disque, partage) est une donnée : posé par textContent, isolé dans son sens d'écriture,
//   coupé à l'écran avec son nom entier en info-bulle ; jamais du code.
// - La carte ne s'étire pas : autant de volumes que sa hauteur RÉELLE en tient (mesurée une fois posée, et quand elle
//   change), puis « et N de plus » ; rien n'est coupé au bord, le bas (« Ouvrir Pyramide ») reste fixe.
// - Un volume presque plein le dit sur sa ligne (un repère et ses mots), pas seulement par sa couleur. Aucune action depuis le widget : seulement « Ouvrir Pyramide » (pas sur l'écran de
//   la maison, rien en mode « Modifier »).
// Rien n'est touché au chargement : seulement window.OdinWidgetsStockage (ses textes et calculs, pour les essais) et sa
// déclaration.
(() => {
  'use strict';
  if (window.OdinWidgetsStockage) return;

  // ---------------- Dictionnaire (tous les textes de la famille)
  const TEXTES = {
    titre: 'Stockage', quoi: 'Pyramide : le remplissage, la place libre, les partages et les disques de la machine d\'Odin',
    libres: 'libres', libre: (t) => `${t} libres`, sur: (u, t) => `${u} / ${t}`,
    partages: 'partages', aucunPartage: 'Aucun partage.', listePartages: (l) => `Partages : ${l}`, listeDisques: (l) => `Disques : ${l}`,
    disques: (n, k) => `${k} disque${n > 1 ? 's' : ''}`, volumes: (n, k) => `${k} volume${n > 1 ? 's' : ''}`,
    ssd: 'SSD', dur: 'disque dur', amovible: 'amovible', plein: 'presque plein', utilise: 'utilisés',
    plus: (n) => `et ${n} de plus`, ouvrir: 'Ouvrir Pyramide',
    detail: (nom, p, u, t, l) => `${nom} : ${p} (${u} sur ${t}), ${l}`,
  };
  const T = TEXTES;

  // ---------------- Calculs (sans document)
  /** Les seuils de Pyramide (src/valhalla/modules/fensalir.ts, tone) : plein au-delà de 90 %, à surveiller au-delà de 75 %. */
  const ton = (r) => (r > 0.9 ? 'plein' : r > 0.75 ? 'attention' : 'bon');
  /** Un nombre d'octets lisible : fini, positif ou nul. */
  const octets = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  /** Une taille, avec son unité, dans la langue donnée ; sans valeur lisible : ''. */
  function taille(o, langue) {
    if (!octets(o)) return '';
    const [unite, base, chiffres] = o >= 1024 ** 4 ? ['terabyte', 1024 ** 4, 1] : o >= 1024 ** 3 ? ['gigabyte', 1024 ** 3, 1] : o >= 1024 ** 2 ? ['megabyte', 1024 ** 2, 0] : ['kilobyte', 1024, 0];
    try { return new Intl.NumberFormat(langue, { style: 'unit', unit: unite, unitDisplay: 'short', maximumFractionDigits: chiffres }).format(o / base); } catch { return ''; }
  }
  /**
   * Une part (0 à 1) en pour cent, dans la langue donnée ; sans valeur lisible : ''. Jamais « 100 % » pour ce qui n'est pas
   * plein, ni « 0 % » pour ce qui n'est pas vide : une décimale, tronquée vers le vrai (99,6 %, 0,3 %).
   */
  function part(r, langue) {
    if (typeof r !== 'number' || !Number.isFinite(r) || r < 0) return '';
    const v = Math.min(r, 1), bord = v > 0 && v < 1 && (Math.round(v * 100) === 100 || Math.round(v * 100) === 0);
    const x = bord ? Math.min(Math.max(Math.floor(v * 1000) / 1000, 0.001), 0.999) : v;
    try { return new Intl.NumberFormat(langue, { style: 'percent', maximumFractionDigits: bord ? 1 : 0 }).format(x); } catch { return ''; }
  }
  /** Un volume lu sans confiance : un nom, une taille plus grande que zéro ; jamais plus que plein. Sinon : null. */
  function volumeLu(x) {
    if (!x || typeof x !== 'object' || typeof x.nom !== 'string' || !x.nom || !octets(x.taille) || !(x.taille > 0) || !octets(x.utilise) || !octets(x.libre)) return null;
    return { nom: x.nom, taille: x.taille, utilise: Math.min(x.utilise, x.taille), libre: Math.min(x.libre, x.taille) };
  }
  const nomLu = (x) => (x && typeof x === 'object' && typeof x.nom === 'string' && x.nom ? x : null);
  const entier = (n, min) => (Number.isInteger(n) && n >= min ? n : min);
  /**
   * Combien de volumes montrer selon la hauteur du widget (en lignes de la grille) : aucun sous 3 lignes (l'anneau et la
   * place libre seuls), un à 3 lignes, trois à 4, puis trois de plus par ligne (une ligne de grille tient trois volumes).
   */
  const combien = (r) => { const h = Number.isInteger(r) ? r : 4; return h < 3 ? 0 : h === 3 ? 1 : 3 * (h - 3); };

  // ---------------- Dessin (seulement quand un hôte l'appelle)
  const ICONES = {
    disque: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 14h17"/><circle cx="16.5" cy="16.5" r=".6"/>',
    sortie: '<path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4"/>',
    alerte: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  };
  const icone = (k) => (Object.prototype.hasOwnProperty.call(ICONES, k) ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[k]}</svg>` : '');
  // Les couleurs : celles du thème d'Odin (--ink, --muted, --line, --accent, --warn, --bad). Aucune couleur écrite ici.
  const CSS = `
:has(>.ws-corps){display:flex;flex-direction:column}
.ws-corps{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column;gap:6px;color:var(--ink,var(--text,inherit))}
/* Seul le contenu défile ; le bas de la carte reste fixe, jamais coupé par son bord. */
.ws-defile{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column;gap:8px;overflow:auto;overscroll-behavior:contain;padding:3px;margin:-3px}
.ws-defile>*{flex:none;min-width:0}
.ws-haut{display:flex;align-items:center;gap:14px;min-width:0}
.ws-anneau{position:relative;flex:none;width:58px;height:58px;display:grid;place-items:center}
.ws-anneau svg{position:absolute;inset:0;width:100%;height:100%}.ws-anneau circle{fill:none;stroke-width:4}
.ws-anneau .ws-fond{stroke:var(--line,currentColor)}.ws-anneau .ws-part{stroke:var(--accent,currentColor)}
.ws-haut.ws-attention .ws-part{stroke:var(--warn,currentColor)}.ws-haut.ws-plein .ws-part{stroke:var(--bad,currentColor)}
.ws-pc{position:relative;font-size:13px;font-weight:750;font-variant-numeric:tabular-nums;white-space:nowrap}
.ws-stats{flex:1 1 auto;min-width:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(86px,1fr));gap:4px 12px}
.ws-stats>div{min-width:0;display:flex;flex-direction:column;line-height:1.25}
.ws-stats b{font-size:15px;font-weight:750;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ws-stats small,.ws-l,.ws-meta,.ws-plus{font-size:11.5px;line-height:1.35;color:var(--muted,inherit)}
.ws-liste{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;min-width:0}
.ws-vol{display:grid;grid-template-columns:minmax(0,1fr) minmax(48px,28%) auto auto;align-items:center;gap:2px 10px;min-width:0;min-height:22px}
.ws-n{display:block;min-width:0;font-size:13px;font-weight:600;color:var(--ink,inherit);unicode-bidi:isolate;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-p{font-size:12.5px;font-weight:650;font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
.ws-plein .ws-p{font-weight:800;display:inline-flex;align-items:center;justify-content:flex-end;gap:3px}
.ws-alerte{display:inline-flex;flex:none}.ws-alerte svg{width:13px;height:13px}
.ws-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.ws-corps [hidden]{display:none!important}
.ws-barre{display:block;height:7px;border-radius:999px;background:color-mix(in srgb,var(--ink,currentColor) 14%,transparent);overflow:hidden;min-width:0}
.ws-barre>i{display:block;height:100%;border-radius:inherit;background:var(--accent,currentColor)}
.ws-attention .ws-barre>i{background:var(--warn,currentColor)}.ws-plein .ws-barre>i{background:var(--bad,currentColor)}
.ws-p{min-width:40px}.ws-l{min-width:92px;white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}
.ws-meta{display:block;margin:0;min-width:0;unicode-bidi:isolate;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-plus{margin:0}.ws-plus:empty{display:none}
.ws-bas{flex:none;display:flex;gap:6px;min-width:0}
.ws-btn{flex:0 1 auto;max-width:100%;min-height:44px;min-width:44px;padding:4px 14px;border-radius:12px;border:1px solid var(--line,currentColor);background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:650;line-height:1.25;overflow-wrap:anywhere;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.ws-btn svg{flex:none;width:15px;height:15px}
.ws-btn:focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:2px}
/* La plus petite carte : l'anneau, la place libre et « Ouvrir » sur une ligne (son nom reste lu, et en info-bulle). */
.ws-court .ws-anneau{width:46px;height:46px}.ws-court .ws-pc{font-size:11.5px}.ws-court .ws-stats{grid-template-columns:minmax(0,1fr)}
.ws-court{gap:8px}.ws-court .ws-btn{flex:none;width:44px;padding:0;justify-content:center}.ws-court .ws-btn>span:last-child{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
/* La plus petite carte, étroite (à 768 px, l'en-tête passe sur deux lignes) : l'anneau et la place libre, entiers ; « Ouvrir » s'efface. */
@container (max-width:200px){.ws-haut{gap:8px}.ws-anneau{width:46px;height:46px}.ws-stats{grid-template-columns:minmax(0,1fr)}.ws-court .ws-btn{display:none}.ws-court .ws-anneau{width:40px;height:40px}}
/* Une carte étroite : le total utilisé s'efface ; chaque volume sur deux lignes (son nom et sa part, puis sa barre et sa place libre). */
@container (max-width:420px){.ws-stats>.ws-tot{display:none}.ws-vol{grid-template-columns:minmax(0,1fr) auto}.ws-vol>.ws-n{order:1}.ws-vol>.ws-p{order:2}.ws-vol>.ws-barre{order:3}.ws-vol>.ws-l{order:4;min-width:0}}`;
  function poserStyle() {
    const R = window.OdinWidgetsRendu;
    if (R && typeof R.poserStyle === 'function') R.poserStyle();
    if (document.getElementById('odinWidgetsStockage')) return;
    // Hors téléphone, la carte a la hauteur de ses lignes : son corps ne compte pas dans cette hauteur (il défile), si
    // bien qu'une longue liste n'étire ni la carte, ni sa voisine. Au téléphone, la hauteur suit le contenu.
    const G = window.OdinGrille, tel = G && G.GRILLE && Number.isInteger(G.GRILLE.telephone) ? G.GRILLE.telephone : 700;
    const s = document.createElement('style'); s.id = 'odinWidgetsStockage'; s.textContent = `${CSS}\n@media (min-width:${tel + 1}px){.fe-w>.ws-corps{contain:size}}`; document.head.append(s);
  }
  function el(t, cls, texte) { const n = document.createElement(t); if (cls) n.className = cls; if (texte !== undefined) n.textContent = texte; return n; }
  /** Un texte venu de dehors : du texte, isolé dans son sens d'écriture, en entier dans l'info-bulle. */
  function dehors(t, cls, texte) { const n = el(t, cls, texte); n.dir = 'auto'; n.title = texte; return n; }
  const langue = () => { try { return document.documentElement.lang || undefined; } catch { return undefined; } };
  const nombre = (n, lg) => { try { return new Intl.NumberFormat(lg).format(n); } catch { return String(n); } };
  const decor = (k, cls) => { const s = el('span', cls); s.setAttribute('aria-hidden', 'true'); s.innerHTML = icone(k); return s; };
  /** La hauteur du widget, en lignes de la grille. */
  function lignesDe(w, defaut) {
    const G = window.OdinGrille;
    try { if (G && typeof G.taille === 'function') return G.taille(w).r; } catch { /* la valeur écrite */ }
    return w && Number.isInteger(w.r) ? w.r : defaut;
  }
  /** L'anneau de la maquette : la part utilisée en tout (dessiné ici, sans innerHTML pour la donnée). */
  function anneau(r, texte) {
    const box = el('span', 'ws-anneau'), ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 36 36'); s.setAttribute('aria-hidden', 'true');
    for (const [cls, p] of [['ws-fond', 100], ['ws-part', Math.round(Math.min(1, r) * 1000) / 10]]) {
      const k = document.createElementNS(ns, 'circle');
      k.setAttribute('class', cls); k.setAttribute('cx', '18'); k.setAttribute('cy', '18'); k.setAttribute('r', '15'); k.setAttribute('pathLength', '100');
      if (cls === 'ws-part') { k.setAttribute('stroke-dasharray', `${p} ${100 - p}`); k.setAttribute('transform', 'rotate(-90 18 18)'); }
      s.append(k);
    }
    box.append(s, el('b', 'ws-pc', texte));
    return box;
  }
  /** « Ouvrir Pyramide » : sa page ; jamais sur l'écran de la maison, rien en mode « Modifier ». */
  function ouvrir(o) {
    if (o && o.ecran === 'maison') return null;
    const b = el('button', 'ws-btn'); b.type = 'button'; b.title = T.ouvrir;
    b.append(decor('sortie'), el('span', '', T.ouvrir));
    b.addEventListener('click', (ev) => { ev.stopPropagation(); if (b.closest('.fe-edit')) return; location.hash = '#app=fensalir'; });
    return b;
  }

  /**
   * « Stockage », style « Lignes » : l'anneau (la part utilisée en tout), la place libre et les partages ; puis chaque
   * volume, le plus rempli d'abord ; puis les disques et les partages par leur nom. Sans volume lisible : rien (null).
   */
  function dessiner(e, o) {
    const d = e && e.donnee && typeof e.donnee === 'object' ? e.donnee : {};
    const vols = (Array.isArray(d.volumes) ? d.volumes : []).map(volumeLu).filter(Boolean);
    if (!vols.length || !octets(d.taille) || !(d.taille > 0) || !octets(d.utilise) || !octets(d.libre)) return null; // illisible : rien d'affirmé
    poserStyle();
    const lg = langue(), tout = Math.min(d.utilise / d.taille, 1);
    const disques = (Array.isArray(d.disques) ? d.disques : []).map(nomLu).filter(Boolean);
    const partages = (Array.isArray(d.partages) ? d.partages : []).map(nomLu).filter(Boolean);
    const nVol = entier(d.volumesTotal, vols.length), nPart = entier(d.partagesTotal, partages.length), nDisq = entier(d.disquesTotal, disques.length);
    // En haut : l'anneau, la place libre, les partages (comme la maquette).
    const r = lignesDe(o && o.w, 4), court = r < 3;
    const haut = el('div', `ws-haut ws-${ton(tout)}${court ? ' ws-court' : ''}`), stats = el('div', 'ws-stats');
    haut.title = T.sur(taille(d.utilise, lg), taille(d.taille, lg));
    const libre = el('div'), tLibre = el('b', '', taille(d.libre, lg)); tLibre.title = tLibre.textContent; libre.append(tLibre, el('small', '', T.libres));
    const parts = el('div', 'ws-nb-partages');
    if (nPart) parts.append(el('b', '', nombre(nPart, lg)), el('small', '', T.partages)); else parts.append(el('b', '', T.aucunPartage));
    stats.append(libre);
    if (!court) { const tot = el('div', 'ws-tot'); tot.append(el('b', '', T.sur(taille(d.utilise, lg), taille(d.taille, lg))), el('small', '', T.utilise)); stats.append(parts, tot); }
    haut.append(anneau(tout, part(tout, lg)), stats);
    const b = ouvrir(o);
    if (court && b) haut.append(b);
    const contenu = [haut];
    // Les volumes, le plus rempli d'abord (rangés par le serveur), autant que la hauteur en tient.
    const montres = vols.slice(0, combien(r)), lis = [];
    let ul = null;
    if (montres.length) {
      ul = el('ul', 'ws-liste');
      for (const v of montres) {
        const x = v.utilise / v.taille, li = el('li', `ws-vol ws-${ton(x)}`), barre = el('span', 'ws-barre'), plein = el('i');
        plein.style.width = `${Math.round(x * 1000) / 10}%`; barre.append(plein); barre.setAttribute('aria-hidden', 'true');
        const p = el('b', 'ws-p', part(x, lg));
        if (ton(x) === 'plein') { p.title = T.plein; p.prepend(decor('alerte', 'ws-alerte'), el('span', 'ws-sr', `${T.plein} `)); }
        li.title = T.detail(v.nom, part(x, lg), taille(v.utilise, lg), taille(v.taille, lg), T.libre(taille(v.libre, lg)));
        li.append(dehors('span', 'ws-n', v.nom), barre, p, el('small', 'ws-l', T.libre(taille(v.libre, lg))));
        ul.append(li); lis.push(li);
      }
      contenu.push(ul);
    }
    const plus = el('p', 'ws-plus');
    contenu.push(plus);
    const metas = [];
    if (r >= 4) {
      if (disques.length) metas.push(dehors('p', 'ws-meta ws-disques', T.listeDisques(disques.map((x) => [x.nom, taille(x.taille, lg), x.ssd === true ? T.ssd : T.dur, x.amovible === true ? T.amovible : ''].filter(Boolean).join(' · ')).join(', ') + (nDisq > disques.length ? `, ${T.plus(nombre(nDisq - disques.length, lg))}` : ''))));
      metas.push(partages.length ? dehors('p', 'ws-meta ws-partages', T.listePartages(partages.map((x) => x.nom).join(', ') + (nPart > partages.length ? `, ${T.plus(nombre(nPart - partages.length, lg))}` : ''))) : el('p', 'ws-meta ws-partages', T.aucunPartage));
    }
    contenu.push(...metas);
    const c = el('div', 'ws-corps'), f = el('div', 'ws-defile');
    f.append(...contenu); c.append(f);
    if (b && !court) { const bas = el('div', 'ws-bas'); bas.append(b); c.append(bas); }
    const ajuste = { f, ul, lis, plus, metas, nVol, lg, bouton: court ? b : null, rogne: false };
    compter(ajuste);
    // Une fois posée (et quand sa taille change) : autant de volumes que la hauteur réelle en tient.
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => { if (!c.isConnected) { ro.disconnect(); return; } ajuster(ajuste); });
      ro.observe(c);
    }
    return c;
  }
  /** « et N de plus » : ce qui n'est pas montré ; rien quand aucun volume ne l'est (le haut dit déjà le total). */
  function compter(a) {
    const n = a.ul ? a.ul.children.length : 0, reste = a.nVol - n;
    a.plus.textContent = n && reste > 0 ? T.plus(nombre(reste, a.lg)) : '';
    if (a.ul) a.ul.hidden = !n;
  }
  /**
   * La hauteur réelle : tout remettre, puis, tant que la zone qui défile déborde, retirer le dernier volume (jusqu'à un),
   * puis les lignes du bas (partages, disques), puis ce dernier volume, puis (la plus petite carte) « Ouvrir ». Une carte
   * qui suit son contenu (au téléphone) ne déborde jamais : rien n'y est retiré.
   */
  function ajuster(a) {
    const deborde = () => a.f.scrollHeight > a.f.clientHeight + 1;
    if (!a.rogne && !deborde()) return;
    if (a.ul) a.ul.replaceChildren(...a.lis);
    for (const m of a.metas) m.hidden = false;
    if (a.bouton) a.bouton.hidden = false;
    compter(a); a.rogne = false;
    if (!deborde()) return;
    a.rogne = true;
    while (a.ul && a.ul.children.length > 1 && deborde()) { a.ul.lastElementChild.remove(); compter(a); }
    for (const m of [...a.metas].reverse()) { if (!deborde()) break; m.hidden = true; }
    if (a.ul && a.ul.children.length && deborde()) { a.ul.lastElementChild.remove(); compter(a); }
    if (a.bouton && deborde()) a.bouton.hidden = true;
  }
  /** La fin du sous-titre : « N disques » (ou « N volumes » quand Pyramide ne lit pas les disques, sur un Mac). */
  function sous(e) {
    const d = e && e.etat === 'ok' && e.donnee ? e.donnee : null;
    if (!d) return '';
    const lg = langue();
    if (Number.isInteger(d.disquesTotal) && d.disquesTotal > 0) return T.disques(d.disquesTotal, nombre(d.disquesTotal, lg));
    return Number.isInteger(d.volumesTotal) && d.volumesTotal > 0 ? T.volumes(d.volumesTotal, nombre(d.volumesTotal, lg)) : '';
  }

  window.OdinWidgetsStockage = { TEXTES, CSS, ton, taille, part, volumeLu, combien, dessiner, sous };
  // La déclaration de la famille (lue par pages/widgets-rendu.js, quel que soit l'ordre de chargement). La taille est celle
  // de la maquette : 5 × 4. Pas au propriétaire seul : un membre qui a le droit sur Pyramide la voit (le serveur décide).
  (window.OdinWidgetsFamilles = window.OdinWidgetsFamilles || []).push({ famille: 'stockage', sortes: [
    // Jamais sur l'écran de la maison : un écran au mur y montrerait ses disques et ses partages (la même marque que sa sorte, stockage.ts).
    { sorte: 'stockage', jamaisALaMaison: true, titre: T.titre, quoi: T.quoi, symbole: '🖴', appli: 'fensalir', poser: { c: 5, r: 4, pc: 4 }, sous, dessiner },
  ] });
})();
