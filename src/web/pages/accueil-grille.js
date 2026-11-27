// La grille de l'accueil (maquette validée « Accueil et Home Assistant ») : 12 colonnes, 4 au téléphone (700 px et
// moins). Lignes de 74 px et écart de 14 px ; au téléphone, lignes de 84 px et écart de 12 px. Le navigateur comble
// les trous (grid-auto-flow: row dense) : un module n'a pas de position, seulement un rang dans la liste de sa page,
// une largeur `c` sur 12 et une hauteur `r` en lignes ; au téléphone, à part, `pc` colonnes sur 4 et `pr` lignes.
// Sans `pc`, un module de 1 ou 2 colonnes prend la moitié du téléphone, les autres toute la largeur ; sans `pr`, il
// prend la hauteur de son contenu (150 px au moins).
// Calculs seuls : ce fichier est chargé avant les autres scripts de l'interface et ne touche à rien à son chargement.
// Celui qui s'en sert (fenetre.js) pose le style rendu par `css()` et la taille rendue par `style()` sur chaque carte.
// Règle tenue avec Hestia (gladsheim.ts, cleanLayout) : quand la largeur `c` change, l'ancienne largeur `w` (1, 2, 3)
// change avec elle (1 à 4 → 1, 5 à 8 → 2, 9 à 12 → 3), sinon Hestia remettrait `c` d'après `w`.
// API : window.OdinGrille = { GRILLE, MINI, HAUTEUR, appareil, taille, largeurTel, hauteurTel, hauteurPx, colonne, cases,
// apres, rang, largeurAncienne, changer, agrandir, nouvelId, style, css, TAILLES, bornes, permise, taillesPossibles,
// tailleChoisie, depart, tirer, pas, poser, choisir, etiquette, memo, remettre, geste }.
(() => {
  'use strict';
  if (window.OdinGrille) return;

  /** Les mesures de la maquette. `telephone` : 700 px et moins ; `ordinateur` : 1100 px et plus (entre les deux : tablette). */
  const GRILLE = Object.freeze({ colonnes: 12, colonnesTel: 4, lignesMax: 7, ligne: 74, ecart: 14, ligneTel: 84, ecartTel: 12, minTel: 150, telephone: 700, ordinateur: 1100 });
  /** Par sorte de module : sa plus petite taille [colonnes, lignes] (la même table que TAILLE_SORTE chez Hestia). */
  const MINI = Object.freeze({ chiffres: [2, 1], section: [3, 2], meteo: [3, 2], bouton: [2, 1], heure: [2, 1], site: [2, 1], a_faire: [3, 2], odin_a_fait: [3, 2], tu_veux: [3, 2], comportement: [3, 2], chiffres_cles: [3, 2], surveillance: [3, 2], sauvegarde: [3, 2], resume_matin: [3, 2], application: [3, 2], heure_petite: [2, 1], meteo_petite: [2, 1], alertes: [2, 1], alertes_liste: [3, 2], sites: [3, 2], sites_petit: [2, 1], agenda: [3, 2], recherches: [3, 2], sauvegardes: [3, 2], pubs_bloquees: [3, 2], appli: [3, 2], raccourcis: [3, 2], automatisations: [4, 2], taches_planifiees: [3, 2], sante_machine: [3, 2], sante_disques: [3, 2], stockage: [3, 2], reseau: [3, 2], maison_allumes: [2, 1], maison_lumieres: [2, 1], maison_serrures: [2, 1], maison_temperature: [2, 1], maison_humidite: [2, 1], maison_watts: [2, 1], maison_appareil: [3, 2], maison_lumiere: [3, 2], maison_capteur: [3, 2], maison_pieces: [3, 3], maison_scenes: [3, 2], maison_bandeau: [4, 1], ma_maison: [4, 3], maison_securite: [3, 3], maison_camera: [3, 2], parole: [3, 2], lecteur: [3, 2], messages: [3, 2] });
  /** Par sorte de module : sa hauteur de départ, en lignes (la même que chez Hestia). */
  const HAUTEUR = Object.freeze({ chiffres: 2, section: 3, meteo: 3, bouton: 2, heure: 2, site: 2, a_faire: 4, odin_a_fait: 4, tu_veux: 2, comportement: 2, chiffres_cles: 2, surveillance: 2, sauvegarde: 2, resume_matin: 2, application: 2, heure_petite: 1, meteo_petite: 1, alertes: 1, alertes_liste: 3, sites: 5, sites_petit: 1, agenda: 3, recherches: 3, sauvegardes: 2, pubs_bloquees: 2, appli: 2, raccourcis: 2, automatisations: 3, taches_planifiees: 3, sante_machine: 2, sante_disques: 4, stockage: 4, reseau: 4, maison_allumes: 1, maison_lumieres: 1, maison_serrures: 1, maison_temperature: 1, maison_humidite: 1, maison_watts: 1, maison_appareil: 2, maison_lumiere: 2, maison_capteur: 2, maison_pieces: 4, maison_scenes: 3, maison_bandeau: 1, ma_maison: 4, maison_securite: 3, maison_camera: 3, parole: 2, lecteur: 2, messages: 2 });
  /** Le cycle du bouton « Taille » : les anciennes largeurs 1, 2, 3 colonnes, soit 4, 8, 12 sur 12. */
  const CYCLE = [4, 8, 12];

  const entier = (v) => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);
  const borne = (v, a, b) => Math.min(b, Math.max(a, v));
  const mini = (kind) => MINI[kind] ?? [2, 1];

  /** L'appareil d'après la largeur de l'écran, en px : 'telephone', 'tablette' ou 'ordinateur'. */
  function appareil(largeur) {
    const l = Number(largeur);
    if (!(l > 0)) return 'ordinateur';
    return l <= GRILLE.telephone ? 'telephone' : l < GRILLE.ordinateur ? 'tablette' : 'ordinateur';
  }
  /** L'ancienne largeur (1, 2 ou 3 colonnes) d'une largeur sur 12 : même proportion (comme chez Hestia). */
  const largeurAncienne = (c) => (c <= 4 ? 1 : c <= 8 ? 2 : 3);

  /**
   * La taille d'un module, bornée : `c` de la mini de sa sorte à 12 (sans `c`, l'ancienne largeur `w` × 4),
   * `r` de la mini à 7 (sans `r`, la hauteur de départ de la sorte), `pc` de 2 à 4 et `pr` de la mini à 7, s'ils sont là.
   */
  function taille(w) {
    const o = w ?? {}, m = mini(o.kind), ancien = [1, 2, 3].includes(Number(o.w)) ? Number(o.w) : undefined;
    let c = entier(o.c); if (c !== undefined) c = borne(c, m[0], GRILLE.colonnes);
    // Comme Hestia : une largeur sur 12 qui ne va pas avec l'ancienne largeur `w` est périmée, elle suit `w`
    // (sinon l'écran montrerait une taille et « Terminé » en garderait une autre).
    if (c === undefined || (ancien !== undefined && largeurAncienne(c) !== ancien)) c = (ancien ?? 1) * 4;
    const r0 = entier(o.r), pc = entier(o.pc), pr = entier(o.pr);
    return { c, r: r0 === undefined ? (HAUTEUR[o.kind] ?? 2) : borne(r0, m[1], GRILLE.lignesMax),
      ...(pc === undefined ? {} : { pc: borne(pc, 2, GRILLE.colonnesTel) }), ...(pr === undefined ? {} : { pr: borne(pr, m[1], GRILLE.lignesMax) }) };
  }
  /** Colonnes prises au téléphone (sur 4) : `pc` s'il est réglé, sinon la moitié (2) pour 1 ou 2 colonnes, sinon 4. */
  function largeurTel(w) { const t = taille(w); return t.pc ?? (t.c <= 2 ? 2 : GRILLE.colonnesTel); }
  /** Lignes prises au téléphone : `pr` s'il est réglé, sinon `null` (la hauteur du contenu). */
  function hauteurTel(w) { const t = taille(w); return t.pr ?? null; }
  /** La hauteur en px de `r` lignes : r × ligne + (r − 1) × écart. */
  function hauteurPx(r, tel = false) { const n = Math.max(1, entier(r) ?? 1); return n * (tel ? GRILLE.ligneTel : GRILLE.ligne) + (n - 1) * (tel ? GRILLE.ecartTel : GRILLE.ecart); }
  /** La largeur d'une colonne, en px, pour une grille large de `largeur` px. */
  function colonne(largeur, tel = false) { const n = tel ? GRILLE.colonnesTel : GRILLE.colonnes, e = tel ? GRILLE.ecartTel : GRILLE.ecart; return Math.max(0, (Number(largeur) - e * (n - 1)) / n); }
  /** Le pas d'une case : de combien de cases un geste de `delta` px fait bouger, pour une case de `pas` px plus l'écart. */
  function cases(delta, pas, ecart) { const p = Number(pas) + Number(ecart); if (!(p > 0) || !Number.isFinite(Number(delta))) return 0; return Math.round(Number(delta) / p) || 0; }
  /** Le pointeur est-il « après » la carte visée : sur sa moitié droite, ou tout en bas (10 px) d'une carte. */
  function apres(x, y, rect) { if (!rect || !(rect.width > 0)) return false; return (x - rect.left) / rect.width > 0.5 || (rect.height > 0 && y > rect.bottom - 10); }
  /**
   * Le rang d'insertion : le module au rang `a` est lâché sur celui au rang `b`, avant lui ou `apresB`.
   * Rend le nouveau rang de `a` dans la liste (sans lui, puis remis) ; `a` si rien ne bouge.
   */
  function rang(a, b, apresB) {
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a === b) return a;
    let to = b + (apresB ? 1 : 0); if (a < to) to--;
    return to;
  }
  /**
   * Change la taille d'un module (sur place) et rend ce qui a changé. `c` et `w` restent d'accord : la largeur
   * ancienne suit la largeur sur 12. Les valeurs sont bornées comme chez Hestia.
   */
  function changer(w, nouv) {
    // Une nouvelle largeur sur 12 l'emporte sur l'ancienne `w` (qui la suivra) ; sans elle, rien ne change de largeur.
    const n = nouv ?? {}, t = taille({ ...w, ...n, ...(entier(n.c) === undefined ? {} : { w: undefined }) }), patch = { c: t.c, r: t.r, w: largeurAncienne(t.c) };
    if ('pc' in n) patch.pc = t.pc; if ('pr' in n) patch.pr = t.pr;
    for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete w[k]; else w[k] = v; }
    return patch;
  }
  /** Le bouton « Taille » : 4, 8, 12 colonnes sur 12, puis 4 (la largeur qui suit celle d'aujourd'hui). Rend la nouvelle `w`. */
  function agrandir(w) {
    const c = taille(w).c, suite = CYCLE.find((x) => x > c) ?? CYCLE[0];
    return changer(w, { c: Math.max(suite, mini(w.kind)[0]) }).w;
  }
  /**
   * Un identifiant neuf pour un module ajouté (8 chiffres hexadécimaux, la forme qu'Hestia garde), pris nulle part
   * dans `pris`. Sans lui, deux modules ajoutés auraient le même identifiant vide : « Retirer » les ôterait tous,
   * les flèches et le glisser les confondraient.
   */
  function nouvelId(pris) {
    const deja = new Set(Array.isArray(pris) ? pris : []), c = window.crypto;
    for (;;) {
      const n = c && typeof c.getRandomValues === 'function' ? c.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 0x100000000);
      const id = n.toString(16).padStart(8, '0');
      if (!deja.has(id)) return id;
    }
  }
  // ---------------------------------------------------------------- lot 15 : tirer le coin, les sept tailles
  /**
   * Les sept tailles toutes faites de la maquette (colonnes sur 12 × lignes), par leur code : le texte affiché
   * vient du dictionnaire de celui qui s'en sert. Petit 2×1, Moyen 3×2, Large 4×2, Haut 3×4, Grand 4×4,
   * Très grand 6×4, Bandeau 12×2.
   */
  const TAILLES = Object.freeze([['petit', 2, 1], ['moyen', 3, 2], ['large', 4, 2], ['haut', 3, 4], ['grand', 4, 4], ['tresGrand', 6, 4], ['bandeau', 12, 2]]
    .map(([nom, c, r]) => Object.freeze({ nom, c, r })));
  /** Les bornes d'un module : au téléphone de 2 à 4 colonnes, sinon de la mini de sa sorte à 12 ; de la mini à 7 lignes. */
  function bornes(kind, tel = false) { const m = mini(kind); return { c: [tel ? 2 : m[0], tel ? GRILLE.colonnesTel : GRILLE.colonnes], r: [m[1], GRILLE.lignesMax] }; }
  /** La taille `n` ({ c, r }, des entiers) tient-elle dans les bornes du module ? Sinon elle est refusée. */
  function permise(kind, n, tel = false) {
    const b = bornes(kind, tel), c = entier(n?.c), r = entier(n?.r);
    return c !== undefined && r !== undefined && c >= b.c[0] && c <= b.c[1] && r >= b.r[0] && r <= b.r[1];
  }
  /** Les tailles toutes faites qu'une sorte de module accepte (celles plus petites que sa mini sont retirées). */
  const taillesPossibles = (kind) => TAILLES.filter((t) => permise(kind, t));
  /** Le code de la taille toute faite que le module a en ce moment (ordinateur), ou `null`. */
  function tailleChoisie(w) { const t = taille(w); return TAILLES.find((x) => x.c === t.c && x.r === t.r)?.nom ?? null; }
  /**
   * La taille de départ d'un geste : à l'ordinateur `c` × `r` ; au téléphone `pc` × `pr`, et sans `pr` la hauteur
   * vue à l'écran (`hauteur` px) comptée en lignes du téléphone.
   */
  function depart(w, tel = false, hauteur = 0) {
    const t = taille(w);
    if (!tel) return { c: t.c, r: t.r };
    const b = bornes(w?.kind, true), vu = cases(Number(hauteur) + GRILLE.ecartTel, GRILLE.ligneTel, GRILLE.ecartTel);
    return { c: largeurTel(w), r: t.pr ?? borne(vu || b.r[0], b.r[0], b.r[1]) };
  }
  /**
   * Tirer le coin : de `dx`, `dy` px depuis la taille `dep`, dans une grille dont une colonne fait `colonnePx`.
   * La taille saute de case en case, et reste dans les bornes (jamais plus petite que la mini de la sorte).
   */
  function tirer(w, dep, dx, dy, colonnePx, tel = false) {
    const b = bornes(w?.kind, tel), e = tel ? GRILLE.ecartTel : GRILLE.ecart;
    return { c: borne(dep.c + cases(dx, colonnePx, e), b.c[0], b.c[1]), r: borne(dep.r + cases(dy, tel ? GRILLE.ligneTel : GRILLE.ligne, e), b.r[0], b.r[1]) };
  }
  /**
   * Maj + flèche sur la poignée : → une colonne de plus, ← une de moins, ↓ une ligne de plus, ↑ une de moins.
   * Rend la nouvelle taille, ou `null` si la touche n'en est pas une, ou si la taille sortirait des bornes (refusée).
   */
  function pas(w, touche, tel = false, hauteur = 0) {
    const d = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[touche];
    if (!d) return null;
    const dep = depart(w, tel, hauteur), n = { c: dep.c + d[0], r: dep.r + d[1] };
    return permise(w?.kind, n, tel) ? n : null;
  }
  /**
   * Pose la taille `n` ({ c, r }) sur le module (sur place) : à l'ordinateur `c` et `r` (et `w` qui suit `c`),
   * au téléphone `pc` et `pr`. Une taille hors des bornes est refusée : rien ne change, rend `null` ; sinon ce qui a changé.
   */
  function poser(w, n, tel = false) {
    if (!w || !permise(w.kind, n, tel)) return null;
    return changer(w, tel ? { pc: n.c, pr: n.r } : { c: n.c, r: n.r });
  }
  /** Choisir une des sept tailles par son code (à l'ordinateur). Une taille plus petite que la mini est refusée : `null`. */
  function choisir(w, nom) { const t = taillesPossibles(w?.kind).find((x) => x.nom === nom); return t ? poser(w, t) : null; }
  /** L'étiquette d'une taille : « c × r ». */
  const etiquette = (n) => `${n.c} × ${n.r}`;
  /** Ce qu'un module garde de sa taille (w, c, r, pc, pr, absents compris), pour la remettre telle quelle. */
  const CLES_TAILLE = ['w', 'c', 'r', 'pc', 'pr'];
  const memo = (w) => Object.fromEntries(CLES_TAILLE.map((k) => [k, w?.[k]]));
  /** Remet sur place la taille gardée par `memo` (une clé absente au départ est retirée). Rend le module. */
  function remettre(w, m) { for (const k of CLES_TAILLE) { if (m?.[k] === undefined) delete w[k]; else w[k] = m[k]; } return w; }
  /**
   * Pendant qu'on tire le coin avec le pointeur `id` : que faire de l'événement `ev` ?
   * 'suivre' (il bouge), 'finir' (relâché : la taille vue reste, jusqu'à « Terminé »), 'annuler' (Échap, ou la
   * fenêtre perd le focus : la taille d'avant revient) ou 'ignorer' (un autre doigt, une autre touche).
   * Une souris qui bouge sans bouton enfoncé a été relâchée ailleurs (hors de la fenêtre) : le geste finit.
   */
  function geste(id, ev) {
    const t = ev?.type;
    if (t === 'keydown') return ev.key === 'Escape' ? 'annuler' : 'ignorer';
    if (t === 'blur') return 'annuler';
    if (ev?.pointerId !== id) return 'ignorer';
    if (t === 'pointermove') return ev.pointerType === 'mouse' && ev.buttons === 0 ? 'finir' : 'suivre';
    return t === 'pointerup' || t === 'pointercancel' || t === 'lostpointercapture' ? 'finir' : 'ignorer';
  }

  /** Le style d'une carte : ses tailles en variables (l'écran choisit ordinateur ou téléphone par la règle de `css`). */
  function style(w) {
    const t = taille(w), pr = hauteurTel(w);
    return `--c:${t.c};--r:${t.r};--pc:${largeurTel(w)};--pr:${pr === null ? 'auto' : `span ${pr}`};--pmin:${pr === null ? GRILLE.minTel : 0}px`;
  }
  /** Le style de la grille `grille` et de ses cartes `carte` (sélecteurs CSS). */
  function css(grille, carte) {
    const g = GRILLE;
    return `${grille}{display:grid;grid-template-columns:repeat(${g.colonnes},minmax(0,1fr));grid-auto-rows:minmax(${g.ligne}px,auto);grid-auto-flow:row dense;gap:${g.ecart}px}`
      + `${carte}{grid-column:span var(--c,4);grid-row:span var(--r,2);min-height:0}`
      + `@media (max-width:${g.telephone}px){${grille}{grid-template-columns:repeat(${g.colonnesTel},minmax(0,1fr));grid-auto-rows:minmax(${g.ligneTel}px,auto);gap:${g.ecartTel}px}`
      + `${carte}{grid-column:span var(--pc,4);grid-row:var(--pr,auto);min-height:var(--pmin,${g.minTel}px)}}`;
  }

  window.OdinGrille = Object.freeze({ GRILLE, MINI, HAUTEUR, appareil, taille, largeurTel, hauteurTel, hauteurPx, colonne, cases, apres, rang, largeurAncienne, changer, agrandir, nouvelId, style, css,
    TAILLES, bornes, permise, taillesPossibles, tailleChoisie, depart, tirer, pas, poser, choisir, etiquette, memo, remettre, geste });
})();
