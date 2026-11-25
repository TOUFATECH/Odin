// Espace « Automatisations » : Talos, le moteur d'automatisations d'Odin. Liste, création en une
// phrase, modèles (dont ceux qui relient les applis), éditeur à nœuds (glisser, relier, régler),
// test pas à pas, historique des exécutions et versions.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const NS = 'http://www.w3.org/2000/svg';
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const sv = (t, a = {}) => { const n = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); return n; };
  // ---------------- Dictionnaire : les textes neufs de l'éditeur (les bulles après un test), à traduire ensemble.
  // {b} : le nom du bloc ; {n} : un nombre ; {s} : la marque du pluriel ; {e} : le message d'erreur ; {o} : une sortie ; {d} : le détail.
  const MOTS = {
    'bulle.elements': '{b} : {n} élément{s} au dernier passage',
    'bulle.erreur': '{b} : erreur au dernier passage, {e}',
    'bulle.sortie': '{o} : {n}',
    'bulle.detail': ' ({d})',
    'bulle.pluriel': 's',
    // La bulle des données d'un passage (ouverte en touchant la bulle d'un bloc). {i} : un rang ; {k} : un nombre gardé ;
    // {t} : une durée déjà écrite selon la langue.
    'donnees.dialogue': 'Données du dernier passage de {b}',
    'donnees.fermer': 'Fermer les données de {b}',
    'donnees.vide': 'Ce bloc n\'a pas encore tourné.',
    'donnees.resume': '{n} élément{s} au dernier passage',
    'donnees.duree': 'durée : {t}',
    'donnees.erreur': 'Erreur',
    'donnees.rendu': 'Ce qu\'il a rendu',
    'donnees.rien': 'Il n\'a rien rendu.',
    'donnees.garde': 'Seuls les {k} premiers sont gardés.',
    'donnees.element': 'Élément {i} sur {n}',
    'donnees.element.sortie': 'Élément {i} sur {n} · sortie {o}',
    'donnees.coupe': ' … (coupé : trop long pour être montré ici)',
    'donnees.recu': 'Ce qu\'il a reçu',
    'donnees.recu.element': 'Élément {i}',
    'donnees.recu.vrai': 'Ce que le moteur a gardé de ce qu\'il a reçu à ce passage.',
    'donnees.recu.rien': 'Il n\'a rien reçu.',
    'donnees.recu.deduit': 'Déduit de ce que le bloc d\'avant a rendu : ce passage n\'a pas gardé ce que le bloc a reçu.',
    'donnees.recu.tronque': 'Seuls les premiers éléments du bloc d\'avant sont connus.',
    'donnees.recu.non': 'Ce qu\'il a reçu ne se déduit pas du bloc d\'avant : rien n\'est montré (ce passage ne l\'a pas gardé).',
    'donnees.recu.declencheur': 'Un déclencheur ne reçoit rien d\'un bloc d\'avant : c\'est lui qui fait partir l\'automatisation.',
    // Le rond d'un bloc exécuté seul : un vrai bouton, qui ouvre la même bulle des données.
    'seul.elements': '{b} : exécuté seul, {n} élément{s} rendu{s}',
    'seul.erreur': '{b} : exécuté seul, erreur, {e}',
  };
  const mot = (k, v = {}) => String(MOTS[k] ?? k).replace(/\{(\w+)\}/g, (_m, x) => String(v[x] ?? ''));
  // La langue de la page (son attribut lang ; sinon celle du navigateur) : les nombres et le pluriel la suivent, rien en dur.
  const langue = () => { try { return document.documentElement?.lang || undefined; } catch { return undefined; } };
  const nombre = (n) => { try { return n.toLocaleString(langue()); } catch { return String(n); } };
  const unSeul = (n) => { try { return new Intl.PluralRules(langue()).select(n) === 'one'; } catch { return n <= 1; } };
  /** Une durée en millisecondes, écrite selon la langue de la page (en secondes à partir d'une seconde). */
  const duree = (ms) => {
    const v = Math.max(0, Number(ms) || 0), s = v >= 1000;
    try { return new Intl.NumberFormat(langue(), { style: 'unit', unit: s ? 'second' : 'millisecond', unitDisplay: 'short', maximumFractionDigits: s ? 2 : 0 }).format(s ? v / 1000 : v); } catch { return s ? `${nombre(v / 1000)} s` : `${nombre(v)} ms`; }
  };
  /** Le passage du bloc `nom` dans le passage `l` : le sien seulement (un bloc nommé « constructor » n'hérite de rien). */
  const runDe = (l, nom) => (l?.nodes && Object.prototype.hasOwnProperty.call(l.nodes, nom) ? l.nodes[nom] : undefined);

  // ---------------- Le « + » : où poser un bloc, à quoi le relier (fonctions pures, sans document).
  const NODE_W = 190, PAS_X = 280, PAS_Y = 110;
  const RAISON_GRAVE = 'Action grave : elle demande ton accord et ne part pas d\'une automatisation.';
  /** Les réglages qui ont une valeur par défaut (`sansVide` : sauf la chaîne vide). */
  const parDefaut = (params, sansVide = false) => Object.fromEntries((params ?? []).filter((p) => p.default !== undefined && !(sansVide && p.default === '')).map((p) => [p.key, p.default]));
  /** Un nom pas encore pris : « Nom », sinon « Nom 2 », « Nom 3 »… */
  function nomLibre(nodes, base) { let name = base, k = 2; while (nodes.some((n) => n.name === name)) name = `${base} ${k++}`; return name; }
  /** Une place libre : [x, y], sinon plus bas, jusqu'à ne recouvrir aucun bloc. */
  function placeLibre(nodes, x, y) {
    let yy = Math.round(y);
    for (let i = 0; i < 40 && nodes.some((n) => Math.abs((n.position?.[0] ?? 0) - x) < NODE_W + 20 && Math.abs((n.position?.[1] ?? 0) - yy) < 90); i++) yy += PAS_Y;
    return [Math.round(x), yy];
  }
  /** La sortie d'où part le « + » d'un bloc : la première qui n'a pas encore de lien, sinon la première. */
  function sortieDuPlus(wf, nom, sorties = 1) { const c = wf.connections?.[nom] ?? []; for (let i = 0; i < sorties; i++) if (!(c[i] ?? []).length) return i; return 0; }
  /** Fenêtre vide : le premier bloc dit quand l'automatisation part (un déclencheur) ; sinon, ce qu'elle fait ensuite. */
  const modeChoix = (wf) => (wf.nodes.length ? 'faire' : 'quand');
  /** Le bloc d'une fonction d'appli ; refusé si elle est grave (elle ne part pas d'une automatisation). */
  function blocFonction(appli, f) {
    if (!appli?.id || !f?.id) return { ok: false, error: 'Choisis une appli et une de ses fonctions.' };
    if (f.grave) return { ok: false, error: f.raison || RAISON_GRAVE };
    return { ok: true, bloc: { name: `${appli.nom} · ${f.label}`, type: 'module.action', params: { module: appli.id, action: f.id, entrée: JSON.stringify(parDefaut(f.params, true)) } } };
  }
  /** Le déclencheur « quand une appli signale » : ev '' = tout ce qu'elle signale, 'alerte' = ses alertes. */
  function blocSignal(appli, ev = '') {
    const name = ev === 'alerte' ? `Quand ${appli.nom} lance une alerte` : ev ? `Quand ${appli.nom} signale « ${ev} »` : `Quand ${appli.nom} signale`;
    return { ok: true, bloc: { name, type: 'déclencheur.module', trigger: true, params: { module: appli.id, événement: ev, niveau: 'haute' } } };
  }
  /** Le bloc d'un outil du catalogue de Talos (Si, Attendre, Aiguillage…). */
  const blocOutil = (c) => ({ ok: true, bloc: { name: c.label, type: c.type, trigger: Boolean(c.trigger), params: parDefaut(c.params) } });
  function relier(wf, from, out, to) {
    if (from === to) return false;
    const c = wf.connections[from] ?? (wf.connections[from] = []);
    while (c.length <= out) c.push([]);
    if (!c[out].some((l) => l.node === to)) c[out].push({ node: to });
    return true;
  }
  // ---------------- Les fils (fonctions pures) : insérer un bloc au milieu, retirer, les refus d'un lien, la cible.
  /** Pourquoi le lien de → vers (sortie `out`) est refusé ; '' s'il est permis. Les mêmes refus pour les deux touchers et le fil tiré. */
  function refusLien(wf, de, out, vers, declencheur) {
    if (de === vers) return 'Un bloc ne se relie pas à lui-même.';
    if (declencheur) return 'Un déclencheur ne reçoit pas de lien : c\'est lui qui fait partir l\'automatisation.';
    if ((wf.connections[de]?.[out] ?? []).some((l) => l?.node === vers)) return 'Ces deux blocs sont déjà reliés par cette sortie.';
    return '';
  }
  /** Retire le fil de → vers de la sortie `out` (lui seul). → true s'il existait. */
  function retirerLien(wf, de, out, vers) {
    const t = wf.connections[de]?.[out], i = (t ?? []).findIndex((l) => l?.node === vers);
    if (i < 0) return false;
    t.splice(i, 1); return true;
  }
  /**
   * « Ajouter un bloc ici » sur un fil : le bloc choisi est posé entre les deux (à mi-chemin, plus bas si la place
   * est prise) ; le fil de → vers devient de → bloc (même sortie, même place) et bloc → vers (par sa première sortie,
   * avec l'entrée d'origine). Un déclencheur ne se met pas au milieu. → { ok, name } ou { ok: false, error }.
   */
  function inserer(wf, choix, fil) {
    if (!choix?.ok) return { ok: false, error: choix?.error ?? 'Rien à ajouter.' };
    const b = choix.bloc;
    if (b.trigger) return { ok: false, error: 'Un déclencheur ne se met pas au milieu d\'un fil : c\'est lui qui fait partir l\'automatisation.' };
    const a = wf.nodes.find((n) => n.name === fil?.de), z = wf.nodes.find((n) => n.name === fil?.vers);
    const t = a && z ? wf.connections[a.name]?.[fil.out] : null, j = (t ?? []).findIndex((l) => l?.node === z?.name);
    if (j < 0) return { ok: false, error: 'Ce lien n\'existe plus.' };
    const name = nomLibre(wf.nodes, b.name);
    const pa = a.position ?? [0, 0], pz = z.position ?? [0, 0];
    const position = placeLibre(wf.nodes, ((pa[0] ?? 0) + (pz[0] ?? 0)) / 2, ((pa[1] ?? 0) + (pz[1] ?? 0)) / 2);
    wf.nodes.push({ name, type: b.type, params: b.params, position });
    const ancien = t[j];
    t[j] = { node: name };
    wf.connections[name] = [[{ ...ancien }]]; // (nom neuf : aucun lien n'en partait)
    return { ok: true, name };
  }
  /** La zone de toucher, en pixels du schéma, pour qu'elle fasse `px` pixels à l'écran au zoom `k` (jamais moins que `px`). */
  const zoneToucher = (k, px = 44) => Math.max(px, px / (k > 0 ? k : 1));
  // ---------------- Les blocs en cercles (fonctions pures ; mesures du croquis validé, posées avant d'être dessinées).
  // Tailles en pixels du schéma. La case garde NODE_W de large, le rond est centré dedans, le nom dessous. Ce qui est
  // enregistré ne change pas : le dessin écarte les blocs en hauteur (y dessiné = y enregistré × ECHELLE_Y), aucune
  // automatisation n'est déplacée toute seule. Le rond : ROND de diamètre, un anneau clair de ANNEAU autour, l'icône
  // d'Odin au centre (ICONE_ROND). Sous le rond : le nom (HAUT_NOM), une 2e ligne (HAUT_LIGNE), et après un test la
  // ligne de résultat (une HAUT_LIGNE de plus). Le « + » : à droite du rond, à mi-hauteur (centre PLUS_X), zone fixe de
  // ZONE_PLUS. Les ronds de sortie juste après lui (centre SORTIE_X), empilés de ECART_SORTIES ; le rond d'entrée à gauche
  // (centre ENTREE_X) ; dessinés en PORT_D.
  const ROND = 96, ANNEAU = 6, ICONE_ROND = 44, HAUT_NOM = 18, HAUT_LIGNE = 16, ECHELLE_Y = 2.2;
  const HAUT_BLOC = ROND + ANNEAU + HAUT_NOM + HAUT_LIGNE, HAUT_TESTE = HAUT_BLOC + HAUT_LIGNE, MI_ROND = ROND / 2;
  const PLUS_D = 28, PLUS_X = 151, ZONE_PLUS = 44, SORTIE_X = 195, ENTREE_X = 25, PORT_D = 12, ECART_SORTIES = 22;
  /** Le y dessiné d'un y enregistré ; et l'inverse, arrondi (ce qui s'enregistre reste un nombre entier). En dixièmes : 110 → 242 tout rond. */
  const DIXIEMES_Y = Math.round(ECHELLE_Y * 10);
  const yDessin = (y) => ((Number(y) || 0) * DIXIEMES_Y) / 10;
  const yEnregistre = (yd) => Math.round(((Number(yd) || 0) * 10) / DIXIEMES_Y);
  /** Le décalage du rond de sortie i sur m, depuis le milieu du rond : plusieurs sorties s'empilent, centrées. */
  const decalageSortie = (i, m) => ECART_SORTIES * (i - (Math.max(1, m) - 1) / 2);
  /** Le style du rond de sortie i sur m : centré sur le milieu du rond, décalé selon la sortie ; entre deux sorties voisines, la zone s'arrête à mi-chemin (11 px). */
  const styleSortie = (i, m) => `top:calc(${MI_ROND + decalageSortie(i, m)}px - var(--dh))${i > 0 ? `;--dh:${ECART_SORTIES / 2}px` : ''}${i < m - 1 ? `;--db:${ECART_SORTIES / 2}px` : ''}`;
  /** Le point de départ d'une liaison : la sortie i sur m du bloc posé en `pos` (place enregistrée), dans le schéma dessiné. */
  const departLien = (pos, i = 0, m = 1) => [(pos?.[0] ?? 0) + NODE_W + 10, yDessin(pos?.[1]) + MI_ROND + decalageSortie(i, m)];
  /** Son point d'arrivée : le bord gauche du rond d'entrée du bloc posé en `pos`, à mi-hauteur du rond. */
  const arriveeLien = (pos) => [(pos?.[0] ?? 0) + ENTREE_X - PORT_D / 2, yDessin(pos?.[1]) + MI_ROND];
  /** Le milieu d'une liaison dessinée (la courbe de lines() passe, à mi-chemin, par le milieu de ses deux bouts). */
  const milieuLien = (x1, y1, x2, y2) => [(x1 + x2) / 2, (y1 + y2) / 2];
  // Les blocs dont les liaisons portent le nom de leur sortie, écrit au milieu de chacune (le « Si » : oui, non). Le
  // « Filtrer » : dessiné comme un petit rond posé sur la liaison, le trait passant à travers lui ; il reste un bloc
  // (même menu, mêmes données, même place enregistrée) : seul le dessin change, rien d'enregistré.
  const SORTIES_NOMMEES = ['logique.si'], TYPE_FILTRE = 'logique.filtre';
  /**
   * Les rectangles d'un bloc ({ g, h, d, b } : gauche, haut, droite, bas, depuis le coin haut-gauche de sa case dessinée),
   * au zoom `k`, pour `m` sorties. Les zones des ronds et du « ⋯ » font 44 px à l'écran (zoneToucher) ; celle du « + »
   * garde ZONE_PLUS du schéma, comme aujourd'hui ; une zone de sortie ne passe jamais à gauche du « + » (elle s'arrête à
   * mi-chemin entre eux, comme entre deux sorties voisines) : arrêtée à gauche, elle s'allonge vers la droite pour garder
   * 44 px de large à l'écran.
   */
  function zonesBloc(k = 1, m = 1) {
    const z = zoneToucher(k), cx = NODE_W / 2, cy = MI_ROND, n = Math.max(1, m), r = (g, h, d, b) => ({ g, h, d, b });
    const bordPlus = PLUS_X + ZONE_PLUS / 2;
    return {
      rond: r(cx - ROND / 2, 0, cx + ROND / 2, ROND),
      nom: r(0, ROND + ANNEAU, NODE_W, ROND + ANNEAU + HAUT_NOM),
      ligne: r(0, ROND + ANNEAU + HAUT_NOM, NODE_W, HAUT_BLOC),
      resultat: r(0, HAUT_BLOC, NODE_W, HAUT_TESTE),
      menu: r(cx - z / 2, 10 - z, cx + z / 2, 10),
      plus: r(PLUS_X - ZONE_PLUS / 2, cy - ZONE_PLUS / 2, bordPlus, cy + ZONE_PLUS / 2),
      entree: r(ENTREE_X - z / 2, cy - z / 2, ENTREE_X + z / 2, cy + z / 2),
      sorties: Array.from({ length: n }, (_, i) => {
        const c = cy + decalageSortie(i, n), g = Math.max(bordPlus, SORTIE_X - z / 2);
        return r(g, c - (i > 0 ? ECART_SORTIES / 2 : z / 2), Math.max(g + z, SORTIE_X + z / 2), c + (i < n - 1 ? ECART_SORTIES / 2 : z / 2));
      }),
    };
  }
  // ---------------- Les bulles après un test (fonctions pures ; croquis validé : à droite de la pastille, hors du rond).
  // La zone de la bulle fait 44 px à l'écran (zoneToucher). Son bord gauche : BULLE_G (à droite de la pastille des
  // réglages manquants, 118 + 22 + 2), jamais sur la zone du « ⋯ » ; son bord bas : 10 px (comme le « ⋯ »), jamais sur
  // la zone de la première sortie. Elle ne touche donc ni le « ⋯ », ni le « + », ni les ronds à relier, ni la marque de
  // note (en haut à gauche).
  const BULLE_G = 142, BULLE_B = 10;
  /** Le haut de la zone de la première sortie d'un bloc à m sorties (sans le zoom) : ce qui borne la bulle par le bas. */
  const hautPremiereSortie = (m = 1) => MI_ROND + decalageSortie(0, Math.max(1, m));
  /**
   * Le rectangle de la bulle ({ g, h, d, b }, depuis le coin haut-gauche de la case dessinée), au zoom k, pour m sorties.
   * Sur le petit rond d'un « Filtrer » (`filtre`) : au bord de ce rond, en haut à droite (à droite de son « ⋯ », au-dessus
   * de son « + ») ; sa pastille des réglages manquants passe alors en bas à gauche du rond.
   */
  function zoneBulle(k = 1, m = 1, filtre = false) {
    const z = zoneToucher(k), g = filtre ? NODE_W / 2 + z / 2 : Math.max(BULLE_G, NODE_W / 2 + z / 2), b = Math.min(filtre ? MI_ROND - ZONE_PLUS / 2 : BULLE_B, hautPremiereSortie(m) - z / 2);
    return { g, h: b - z, d: g + z, b };
  }
  /**
   * La bulle d'un bloc d'après son dernier passage (`run`, tel que le moteur le rend : count, error, outputs) ; null s'il
   * n'a pas tourné. → { texte (le nombre, ou « ! »), erreur, nom (nom lisible), sorties ([{ sortie, n }] si le bloc a
   * plusieurs sorties et que le total se retrouve ; sinon rien : plusieurs passages, on ne sait pas) }.
   */
  function bulleDe(nom, run, sorties = []) {
    if (!run) return null;
    if (run.error) return { texte: '!', erreur: true, nom: mot('bulle.erreur', { b: nom, e: String(run.error).slice(0, 160) }), sorties: [] };
    const n = Number(run.count) || 0, o = Array.isArray(run.outputs) ? run.outputs : [];
    const parSortie = sorties.length > 1 && o.length === sorties.length && o.reduce((s, x) => s + (Number(x) || 0), 0) === n ? sorties.map((s, i) => ({ sortie: s, n: Number(o[i]) || 0 })) : [];
    const detail = parSortie.length ? mot('bulle.detail', { d: parSortie.map((p) => mot('bulle.sortie', { o: p.sortie, n: nombre(p.n) })).join(', ') }) : '';
    return { texte: nombre(n), erreur: false, nom: mot('bulle.elements', { b: nom, n: nombre(n), s: unSeul(n) ? '' : mot('bulle.pluriel') }) + detail, sorties: parSortie };
  }
  // ---------------- La bulle des données d'un passage (fonctions pures). Elle montre ce que le moteur garde déjà d'un bloc :
  // ce qu'il a rendu (MAX_PASSAGE éléments au plus, comme le moteur), la durée, ou l'erreur entière. Ce qu'il a reçu : celui
  // que le moteur a gardé (`input`, mêmes bornes) quand le passage le porte ; sinon (passage d'avant) seulement s'il se
  // déduit du bloc d'avant ; c'est dit dans les deux cas. Tout est du texte.
  const MAX_PASSAGE = 20, MAX_TEXTE = 4000;
  /** Le texte d'un élément (JSON lisible) ; coupé au-delà de MAX_TEXTE signes. → { texte, coupe }. */
  function texteElement(x) {
    let t;
    try { t = typeof x === 'string' ? x : JSON.stringify(x, null, 2); } catch { t = String(x); }
    t = String(t ?? '');
    return t.length > MAX_TEXTE ? { texte: t.slice(0, MAX_TEXTE), coupe: true } : { texte: t, coupe: false };
  }
  /** Les éléments à montrer (MAX_PASSAGE au plus), avec leur titre ; la sortie de chacun quand elle se sait (le total se retrouve). */
  function elementsDe(items, total, sorties = [], outputs = null, recu = false) {
    const vus = (Array.isArray(items) ? items : []).slice(0, MAX_PASSAGE), o = Array.isArray(outputs) ? outputs.map((x) => Number(x) || 0) : [];
    const sait = !recu && sorties.length > 1 && o.length === sorties.length && o.reduce((s, x) => s + x, 0) === total;
    const sortieDe = (i) => { let d = 0; for (let j = 0; j < o.length; j++) { d += o[j]; if (i < d) return sorties[j]; } return null; };
    return vus.map((x, i) => {
      const s = sait ? sortieDe(i) : null;
      const titre = recu ? mot('donnees.recu.element', { i: nombre(i + 1) }) : mot(s !== null ? 'donnees.element.sortie' : 'donnees.element', { i: nombre(i + 1), n: nombre(total), o: s ?? '' });
      return { titre, ...texteElement(x) };
    });
  }
  /**
   * Ce que dit la bulle des données d'un bloc, d'après son dernier passage (`run` : count, items, ms, error, outputs ;
   * input et inputCount quand le moteur a gardé ce qu'il a reçu : ils passent avant toute déduction).
   * `entree` : ce que rend entreeSeul quand l'entrée se déduit sûrement (sinon null) ; `declencheur` : le bloc en est un.
   * → { vide, texte } sans passage ; sinon { resume, duree, erreur, elements, garde, rien, entree: { montree, mention, elements } }.
   */
  function passageDe(run, { sorties = [], entree = null, declencheur = false } = {}) {
    if (!run) return { vide: true, texte: mot('donnees.vide') };
    const n = Math.max(0, Number(run.count) || 0), erreur = run.error ? String(run.error) : '';
    const elements = elementsDe(run.items, n, sorties, run.outputs);
    const ms = Number(run.ms);
    let e;
    if (declencheur) e = { montree: false, mention: mot('donnees.recu.declencheur'), elements: [] };
    else if (Array.isArray(run.input)) {
      const recus = elementsDe(run.input, run.input.length, [], null, true), total = Math.max(recus.length, Number(run.inputCount) || 0);
      const plus = !recus.length ? mot('donnees.recu.rien') : recus.length < total ? mot('donnees.garde', { k: nombre(recus.length) }) : '';
      e = { montree: recus.length > 0, mention: mot('donnees.recu.vrai') + (plus ? ` ${plus}` : ''), elements: recus };
    } else if (entree?.ok && Array.isArray(entree.items)) {
      const items = entree.items.map((j) => (j && typeof j === 'object' && 'json' in j ? j.json : j));
      e = { montree: true, mention: mot('donnees.recu.deduit') + (entree.tronque ? ` ${mot('donnees.recu.tronque')}` : ''), elements: elementsDe(items, items.length, [], null, true) };
    } else e = { montree: false, mention: mot('donnees.recu.non'), elements: [] };
    return {
      vide: false,
      resume: mot('donnees.resume', { n: nombre(n), s: unSeul(n) ? '' : mot('bulle.pluriel') }),
      duree: Number.isFinite(ms) && run.ms !== undefined && run.ms !== null ? mot('donnees.duree', { t: duree(ms) }) : '',
      erreur,
      elements,
      garde: elements.length < n && elements.length > 0 ? mot('donnees.garde', { k: nombre(elements.length) }) : '',
      rien: !erreur && !elements.length ? mot('donnees.rien') : '',
      entree: e,
    };
  }
  /**
   * La place de la bulle des données dans la fenêtre du schéma (cw × ch), accrochée au point `a` ({ x, h, b } : le milieu
   * et les bords haut et bas de ce qu'on a touché) : dessous si elle y tient (ou s'il y a plus de place dessous), sinon
   * dessus ; jamais hors de la fenêtre (marge de 8 px). La pointe vise le point touché ; sans place (moins de 120 px),
   * elle prend toute la hauteur, sans pointe. → { left, top, largeur, hmax, sens: 'bas' | 'haut' | 'libre', pointe }.
   */
  function placeDonnees(cw, ch, a, bw, bh, marge = 8, ecart = 10) {
    const largeur = Math.max(0, Math.min(bw, cw - 2 * marge));
    const left = Math.max(marge, Math.min(a.x - largeur / 2, cw - largeur - marge));
    const sous = ch - (a.b + ecart) - marge, dessus = a.h - ecart - marge;
    let r;
    if (bh <= sous || sous >= dessus) r = { top: a.b + ecart, hmax: sous, sens: 'bas' };
    else r = { top: a.h - ecart - Math.min(bh, dessus), hmax: dessus, sens: 'haut' };
    const dedans = a.x >= 0 && a.x <= cw && a.b >= 0 && a.h <= ch; // (ce qu'on a touché se voit encore)
    if (r.hmax < 120 || !dedans) r = { top: marge, hmax: Math.max(0, ch - 2 * marge), sens: 'libre' };
    return { left, top: r.top, largeur, hmax: r.hmax, sens: r.sens, pointe: Math.max(14, Math.min(a.x - left, largeur - 14)) };
  }
  /** Le bloc sous le point (x, y) de l'écran parmi `boites` ({ name, left, top, width, height }) : le dernier dessiné l'emporte. */
  function blocSous(boites, x, y) {
    for (let i = (boites ?? []).length - 1; i >= 0; i--) { const b = boites[i]; if (x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height) return b.name; }
    return null;
  }
  /**
   * Pose un bloc. Depuis le « + » d'un bloc (`de` : { node, out }) : à droite de lui (plus bas si la place est prise)
   * et relié à lui. Depuis le « + » central ou un double-clic (`a` : [x, y]) : posé là, sans lien.
   * → { ok: true, name, lien? } ou { ok: false, error }.
   */
  function poser(wf, choix, { de, a } = {}) {
    if (!choix?.ok) return { ok: false, error: choix?.error ?? 'Rien à ajouter.' };
    const b = choix.bloc, depart = de ? wf.nodes.find((n) => n.name === de.node) : null;
    if (de && !depart) return { ok: false, error: 'Ce bloc n\'existe plus.' };
    const name = nomLibre(wf.nodes, b.name);
    const position = depart ? placeLibre(wf.nodes, (depart.position?.[0] ?? 0) + PAS_X, depart.position?.[1] ?? 0) : placeLibre(wf.nodes, a?.[0] ?? 60, a?.[1] ?? 160);
    wf.nodes.push({ name, type: b.type, params: b.params, position });
    if (depart && !b.trigger) { const out = de.out ?? 0; relier(wf, depart.name, out, name); return { ok: true, name, lien: { de: depart.name, out } }; }
    return { ok: true, name };
  }
  // ---------------- Le bloc d'appli lisible : son appli, sa fonction et ses réglages en vrais champs (fonctions pures).
  // La forme enregistrée ne change pas : module, action, entrée (texte JSON, ou objet s'il était rangé ainsi).
  const vide = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());
  const sansAccents = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  /** L'appli d'un bloc : par son identifiant, sinon par son nom ou son identifiant sans accents ni majuscules. */
  function appliDe(liste, ref) {
    if (!Array.isArray(liste) || typeof ref !== 'string' || !ref.trim()) return null;
    const n = sansAccents(ref);
    return liste.find((a) => a.id === ref) ?? liste.find((a) => sansAccents(a.id) === n || sansAccents(a.nom) === n) ?? null;
  }
  const fonctionDe = (a, id) => (typeof id === 'string' && (a?.actions ?? []).find((f) => f.id === id)) || null;
  /** Ce que dit un bloc d'appli (null : pas un bloc d'appli, ou appli ou fonction introuvable → il garde son dessin d'avant). */
  function infoAppli(n, liste) {
    const a = n && (n.type === 'module.action' || n.type === 'déclencheur.module') ? appliDe(liste, n.params?.module) : null;
    if (!a) return null;
    if (n.type === 'module.action') { const f = fonctionDe(a, n.params?.action); return f ? { a, f, titre: f.label, auto: `${a.nom} · ${f.label}` } : null; }
    const ev = n.params?.['événement'] ?? '';
    if (typeof ev !== 'string') return null;
    return { a, titre: ev === 'alerte' ? 'Quand elle lance une alerte' : ev ? `Quand elle signale « ${ev} »` : 'Quand elle signale quelque chose', auto: blocSignal(a, ev).bloc.name };
  }
  /** Les réglages rangés dans l'entrée d'un bloc : { ok, valeurs } ; ok false quand ce n'est pas un objet (expression, liste, JSON invalide). */
  function lireEntree(raw) {
    if (vide(raw)) return { ok: true, valeurs: {} };
    let v = raw;
    if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { return { ok: false }; } }
    // Un entier trop grand pour être relu exactement serait abîmé en réécrivant l'entrée : il reste au JSON avancé.
    return v && typeof v === 'object' && !Array.isArray(v) && !entierAbime(v) ? { ok: true, valeurs: v } : { ok: false };
  }
  function entierAbime(v, prof = 0) {
    if (typeof v === 'number') return Number.isInteger(v) && !Number.isSafeInteger(v);
    return Boolean(v && typeof v === 'object' && prof < 50 && Object.values(v).some((x) => entierAbime(x, prof + 1)));
  }
  /** Le champ qui montre une valeur : celui de son type, en texte si c'est une expression, « avance » si aucun ne sait la montrer. */
  function sorteDe(p, v) {
    if (p.kind === 'boolean') return v === undefined || typeof v === 'boolean' ? 'ouinon' : typeof v === 'string' ? 'texte' : 'avance';
    if (p.kind === 'number') return v === undefined || typeof v === 'number' || typeof v === 'string' ? 'nombre' : 'avance';
    if (p.kind === 'select') return v === undefined || (typeof v === 'string' && (p.options ?? []).includes(v)) ? 'liste' : typeof v === 'string' ? 'texte' : 'avance';
    if (v !== undefined && typeof v !== 'string') return 'avance';
    return p.kind === 'textarea' ? 'long' : p.kind === 'password' ? 'secret' : 'texte';
  }
  /** Un champ par réglage que la fonction déclare : { p, sorte, valeur, manque } (manque : obligatoire et vide). */
  const champsDe = (f, valeurs = {}) => (f?.params ?? []).filter((p) => p && typeof p.key === 'string').map((p) => {
    const v = Object.prototype.hasOwnProperty.call(valeurs, p.key) ? valeurs[p.key] : undefined;
    return { p, sorte: sorteDe(p, v), valeur: v, manque: Boolean(p.required) && vide(v) };
  });
  /** Le texte d'un champ → la valeur rangée (undefined : le réglage est retiré, la fonction prend le sien). */
  function valeurChamp(sorte, texte) {
    const t = String(texte ?? '');
    if (sorte === 'ouinon') return t === 'oui' ? true : t === 'non' ? false : undefined;
    if (sorte === 'nombre') { const s = t.trim(); if (!s) return undefined; return /^-?\d+(?:[.,]\d+)?$/.test(s) ? Number(s.replace(',', '.')) : t; }
    return t === '' ? undefined : t;
  }
  /** L'entrée après un champ changé : même forme (texte JSON ou objet), clés dans le même ordre ; une entrée qui n'est pas un objet n'est jamais réécrite. */
  function ecrireEntree(raw, key, val) {
    const l = lireEntree(raw); if (!l.ok) return raw;
    const e = Object.entries(l.valeurs), i = e.findIndex(([k]) => k === key);
    if (val === undefined) { if (i >= 0) e.splice(i, 1); } else if (i >= 0) e[i] = [key, val]; else e.push([key, val]);
    const o = Object.fromEntries(e); // (pas d'affectation : une clé « __proto__ » reste une clé)
    return raw && typeof raw === 'object' ? o : JSON.stringify(o);
  }
  /** Les réglages obligatoires vides d'un bloc d'appli (rien quand l'entrée est une expression : on ne peut pas savoir). */
  function manquants(n, f) { const l = lireEntree(n?.params?.['entrée']); return l.ok ? champsDe(f, l.valeurs).filter((c) => c.manque).map((c) => c.p.label) : []; }
  /**
   * « Changer » : l'appli et la fonction (ou l'événement) choisies remplacent celles du bloc, à la même place et avec
   * ses liens. Une autre fonction repart de ses réglages par défaut ; un déclencheur garde son niveau. Le nom donné
   * par Odin (`ancienAuto`) suit le choix ; un nom choisi à la main reste. → { ok, change, nom? } ou { ok: false, error }.
   */
  function remplacer(wf, nom, choix, ancienAuto, liste) {
    const n = wf.nodes.find((x) => x.name === nom);
    if (!n) return { ok: false, error: 'Ce bloc n\'existe plus.' };
    if (!choix?.ok) return { ok: false, error: choix?.error ?? 'Rien à changer.' };
    const b = choix.bloc;
    if (b.type !== n.type) return { ok: false, error: 'Ce choix ne va pas dans ce bloc.' };
    const p = n.params ?? {};
    // La même appli, qu'elle soit écrite par son identifiant ou par son nom (comme appliDe la trouve).
    const memeAppli = p.module === b.params.module || appliDe(liste, p.module)?.id === b.params.module;
    if (b.type === 'module.action') {
      if (memeAppli && p.action === b.params.action) return { ok: true, change: false };
      n.params = { ...p, module: b.params.module, action: b.params.action, entrée: b.params.entrée };
    } else {
      if (memeAppli && (p['événement'] ?? '') === b.params['événement']) return { ok: true, change: false };
      n.params = { ...p, module: b.params.module, événement: b.params['événement'], ...(p.niveau === undefined ? { niveau: b.params.niveau } : {}) };
    }
    const neuf = ancienAuto && n.name === ancienAuto ? nomLibre(wf.nodes.filter((x) => x !== n), b.name) : '';
    return neuf && neuf !== n.name ? { ok: true, change: true, nom: neuf } : { ok: true, change: true };
  }
  /** La flèche du clavier dans une grille de `cols` colonnes : la nouvelle place (la même au bord). */
  function pasFleche(i, total, cols, touche) {
    const c = Math.max(1, Math.floor(cols) || 1);
    const j = touche === 'ArrowRight' ? i + 1 : touche === 'ArrowLeft' ? i - 1 : touche === 'ArrowDown' ? i + c : touche === 'ArrowUp' ? i - c : touche === 'Home' ? 0 : touche === 'End' ? total - 1 : i;
    return j < 0 || j >= total ? i : j;
  }
  /** Deux touchers (ou clics) rapprochés au même endroit : { t, x, y } chacun. */
  const estDoubleTouche = (a, b) => Boolean(a && b && b.t - a.t >= 0 && b.t - a.t < 400 && Math.hypot(b.x - a.x, b.y - a.y) < 24);
  // ---------------- Le menu d'un bloc (fonctions pures) : le nom qu'on lui donne, sa note.
  /** Le nom tapé pour le bloc `ancien` : { ok, nom } (sans les espaces autour) ou { ok: false, error } (vide, déjà pris). */
  function nomValide(wf, ancien, texte) {
    const nom = String(texte ?? '').trim();
    if (!nom) return { ok: false, error: 'Le nom est vide : un bloc a besoin d\'un nom.' };
    if (nom !== ancien && (wf?.nodes ?? []).some((x) => x.name === nom)) return { ok: false, error: `Le nom « ${nom} » est déjà pris par un autre bloc.` };
    return { ok: true, nom };
  }
  /** Pose, change ou retire (texte vide) la note d'un bloc : un texte libre, rangé dans son champ `note`. → true si elle a changé. */
  function poserNote(n, texte) {
    const t = String(texte ?? '').trim();
    if (!t) { if (!Object.prototype.hasOwnProperty.call(n, 'note')) return false; delete n.note; return true; }
    if (n.note === t) return false;
    n.note = t; return true;
  }
  // ---------------- Copier / coller un bloc, le zoom (fonctions pures).
  /**
   * La copie d'un bloc : son nom (base du nom de la copie), son type, ses réglages (copiés à part), sa place, sa note et
   * son état désactivé. Ni son identifiant ni ses fils. Elle reste dans la page : rien ne va au presse-papiers du système
   * (un mot de passe ou une clé écrits dans un réglage n'en sortent pas).
   */
  function copieDe(n) {
    const c = { name: n.name, type: n.type, params: JSON.parse(JSON.stringify(n.params ?? {})), position: [n.position?.[0] ?? 0, n.position?.[1] ?? 0] };
    if (typeof n.note === 'string' && n.note !== '') c.note = n.note;
    if (n.disabled) c.disabled = true;
    return c;
  }
  /**
   * Colle la copie `c` : un nom libre (« Nom 2 »…), à la première place libre sous le bloc copié (elle ne recouvre ni lui,
   * ni son « + », ni un autre bloc ; collée plusieurs fois, chaque copie va à la place libre suivante), SANS fil. L'écart
   * suit le zoom `k` : la zone de toucher du « ⋯ » de la copie (44 px à l'écran, au-dessus d'elle) ne doit pas couvrir le
   * nom du bloc du dessus — dézoomé (téléphone), l'écart grandit. Les données qu'elle prend chez d'autres blocs restent
   * telles quelles. Un déclencheur se colle comme les autres blocs : l'éditeur et le moteur permettent déjà plusieurs
   * déclencheurs. → { ok, name }.
   */
  function collerBloc(wf, c, k = 1) {
    const name = nomLibre(wf.nodes, c.name);
    // (un bloc fait environ 60 px de haut ; sa zone « ⋯ » monte de zoneToucher(k) - 10 px au-dessus de lui)
    const ecart = Math.max(PAS_Y, Math.ceil((60 + zoneToucher(k)) / 10) * 10), x = Math.round(c.position?.[0] ?? 0);
    let y = Math.round(c.position?.[1] ?? 0) + ecart;
    for (let i = 0; i < 40 && wf.nodes.some((m) => Math.abs((m.position?.[0] ?? 0) - x) < NODE_W + 20 && Math.abs((m.position?.[1] ?? 0) - y) < ecart); i++) y += ecart;
    const n = { name, type: c.type, params: JSON.parse(JSON.stringify(c.params ?? {})), position: [x, y] };
    // Le chemin secret d'un Webhook ou d'un Formulaire ne se recopie pas : deux blocs au même chemin partiraient ensemble
    // (ou l'un jamais). Vide, le serveur en tire un neuf à l'enregistrement (même règle que la copie d'une automatisation).
    if (n.type === 'déclencheur.webhook' || n.type === 'déclencheur.formulaire') n.params.chemin = '';
    if (typeof c.note === 'string' && c.note !== '') n.note = c.note;
    if (c.disabled) n.disabled = true;
    wf.nodes.push(n);
    return { ok: true, name };
  }
  /** Le zoom (molette, + et −) : `facteur` autour du point [mx, my] de la fenêtre, borné entre 0,4 et 1,6. */
  function zoomer(v, facteur, mx, my) {
    const k = Math.min(1.6, Math.max(0.4, v.k * facteur));
    return { x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k), k };
  }
  /** Annuler / refaire : les 100 derniers gestes de l'éditeur au plus (dans la page seulement). */
  const MAX_HISTOIRE = 100;
  // ---------------- « Exécuter ce bloc seul » (fonctions pures) : son entrée, ce qu'il fait, ce qui tournerait.
  const hote = (u) => { try { return new URL(String(u ?? '')).host || 'une adresse à calculer'; } catch { return 'une adresse à calculer'; } };
  /**
   * Les blocs qui agissent ou qui sortent sur le réseau, en clair : la MÊME liste que celle écrite pour l'accord d'Odin
   * (src/tools/draupnir.ts, AGIT ; un essai vérifie qu'elles restent pareilles). Les autres lisent ou calculent.
   */
  const AGIT = {
    'web.requête': (p) => `appelle ${hote(p.url)} (${String(p['méthode'] ?? 'GET')})`,
    'web.flux': (p) => `lit un flux sur ${hote(p.url)}`,
    'odin.message': (p) => `envoie un message ${String(p.service ?? '')}`.trim(),
    'odin.mail': (p) => `envoie un mail à ${String(p['à'] ?? '?')}`,
    'odin.prévenir': () => 'te prévient sur ta messagerie',
    'odin.demander': (p) => (String(p.envoyer ?? 'non') === 'non' ? undefined : 'te renvoie la réponse d\'Odin'),
    'odin.agent': () => 'confie une tâche à l\'agent Odin (ses outils)',
    'saga.écrire': (p) => (String(p.mode ?? 'créer') === 'ajouter' ? 'ajoute du texte à une note de Thot' : 'écrit une note dans Thot'),
    'runes.ajouter': (p) => `ajoute une ligne à la base ${String(p.base ?? '')}`.trim(),
    'module.action': (p) => `lance l'action « ${String(p.action ?? '?')} » de l'appli ${String(p.module ?? '?')}`,
    'flux.exécuter': () => 'lance une autre automatisation',
    'données.code': () => 'exécute du code (isolé)',
    'web.répondre': () => 'répond au webhook',
  };
  /** Ce que fait le bloc `n` s'il agit (en clair), sinon undefined. `connu` false : un type que le catalogue ignore compte comme agissant. */
  function ceQuAgit(n, connu = true) {
    if (Object.prototype.hasOwnProperty.call(AGIT, n?.type)) return AGIT[n.type](n.params ?? {});
    return connu ? undefined : `bloc inconnu (${n?.type})`;
  }
  /** Un texte stable (clés rangées) : deux copies d'une même automatisation donnent le même. */
  const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null');
  /** Ce qui tourne (blocs, réglages, fils) est-il le même dans `a` (l'écran) et `b` (l'enregistrée) ? La place des blocs, leurs notes et le nom de l'automatisation n'y changent rien. */
  function pareilQuEnregistre(a, b) {
    if (!a || !b) return false;
    const forme = (w) => stable({ nodes: (w.nodes ?? []).map((n) => ({ name: n.name, type: n.type, params: n.params ?? {}, disabled: Boolean(n.disabled) })), connections: w.connections ?? {} });
    return forme(a) === forme(b);
  }
  /**
   * « Exécuter ce bloc seul » : ce que le bloc `nom` recevrait, d'après le dernier passage (`last`) des blocs d'avant —
   * par la sortie qui mène à lui — et les données de tous les blocs d'avant (lues par {{ $node["X"]… }}, sans qu'ils
   * tournent). → { ok: true, items, pinned, tronque } ou { ok: false, raison, tester? } (`tester` : le bloc d'avant sur
   * lequel proposer « Tester jusqu'ici »). Rien n'est inventé : sans données vues, il ne part pas.
   */
  function entreeSeul(wf, nom, last, cat) {
    const n = (wf?.nodes ?? []).find((x) => x.name === nom);
    if (!n) return { ok: false, raison: 'Ce bloc n\'existe plus.' };
    const c = cat?.(n.type);
    if (c?.trigger) return { ok: false, raison: `« ${nom} » est un déclencheur : seul, il ne fait rien (il transmet ce qui fait partir l'automatisation, et le moteur inventerait un élément vide). Lance « Tester » pour le voir passer.` };
    if (n.disabled) return { ok: false, raison: `« ${nom} » est désactivé : seul, il ne ferait rien (le moteur laisse passer ses données telles quelles). Réactive-le d'abord.` };
    if ((c?.inputs ?? []).length > 1) return { ok: false, raison: `« ${nom} » attend plusieurs branches (${c.inputs.join(', ')}) : seul, on ne saurait pas laquelle est laquelle. Lance « Tester jusqu'ici ».` };
    const parents = [];
    for (const [de, sorties] of Object.entries(wf.connections ?? {})) (sorties ?? []).forEach((t, i) => { if ((t ?? []).some((l) => l?.node === nom) && de !== nom) parents.push({ de, out: i }); });
    if (!parents.length) return { ok: false, raison: `Aucun bloc n'est relié avant « ${nom} » : il n'a pas de données d'entrée. Relie-le à un bloc, puis lance « Tester jusqu'ici ».` };
    const items = []; let tronque = false;
    for (const { de, out } of parents) {
      const r = runDe(last, de);
      if (!r) return { ok: false, tester: parents.length === 1 ? de : undefined, raison: `« ${de} » n'a pas encore de données connues : « ${nom} » n'a rien à recevoir. Lance d'abord « Tester jusqu'ici » sur « ${de} » (ce bloc-ci ne tournera pas).` };
      if (r.error) return { ok: false, raison: `Au dernier passage, « ${de} » a échoué : il n'a rien donné à « ${nom} ». Corrige-le, puis lance « Tester jusqu'ici ».` };
      const vus = Array.isArray(r.items) ? r.items : [], o = Array.isArray(r.outputs) ? r.outputs : [];
      let part;
      if (o.length <= 1) part = vus;
      else if (o.reduce((s, x) => s + x, 0) === r.count) { const d = o.slice(0, out).reduce((s, x) => s + x, 0); part = vus.slice(d, d + (o[out] ?? 0)); }
      else return { ok: false, raison: `On ne sait pas quelles données de « ${de} » sont allées vers « ${nom} » au dernier passage (il a tourné plusieurs fois). Lance « Tester jusqu'ici ».` };
      if ((o.length <= 1 ? r.count : o[out] ?? 0) > part.length) tronque = true;
      items.push(...part);
    }
    if (!items.length) return { ok: false, raison: `Au dernier passage, aucun élément n'est arrivé à « ${nom} » par ses liens : il n'aurait pas tourné.` };
    const pinned = {};
    for (const b of blocsAvant(wf, nom)) { const r = runDe(last, b); if (r && !r.error && Array.isArray(r.items)) pinned[b] = r.items; }
    return { ok: true, items: items.map((j) => ({ json: j && typeof j === 'object' ? j : {} })), pinned, tronque };
  }
  const APPUI_LONG = 500; // ms : au doigt, l'appui long ouvre le menu d'un bloc
  // ---------------- Les données des blocs d'avant (fonctions pures). La pastille n'est qu'une autre façon d'écrire et de
  // montrer l'expression d'aujourd'hui, {{ $node["Bloc"].json.chemin }} : c'est elle, telle quelle, qui est enregistrée.
  // Les règles de lecture sont celles du moteur (src/draupnir/engine.ts : resolve et readPath).
  const RE_EXPR = /\{\{\s*([^{}]+?)\s*\}\}/g;
  const RE_CLE = /^[\p{L}\p{N}_$-]+$/u;
  /** Les morceaux d'un chemin comme le moteur les lit (`$node["X"].json.a[0]` → ['$node', 'X', 'json', 'a', 0]) ; null s'il ne le lit pas. */
  function morceauxChemin(expr) {
    const m = /^\s*(\$[a-z]+)/i.exec(expr); if (!m) return null;
    const out = [m[1]]; let rest = expr.slice(m[0].length).trim();
    while (rest) {
      let mm;
      if ((mm = /^\.\s*([\p{L}\p{N}_$-]+)/u.exec(rest))) out.push(mm[1]);
      else if ((mm = /^\[\s*(["'])(.*?)\1\s*\]/.exec(rest))) out.push(mm[2]);
      else if ((mm = /^\[\s*(\d+)\s*\]/.exec(rest))) out.push(Number(mm[1]));
      else return null;
      rest = rest.slice(mm[0].length).trim();
    }
    return out;
  }
  /** Le texte d'un champ en morceaux : { texte } ou, pour une donnée d'un bloc ({{ $node["X"].json.… }}), { src, bloc, chemin }. */
  function decouper(texte) {
    const t = String(texte ?? ''), out = []; let i = 0;
    for (const m of t.matchAll(RE_EXPR)) {
      const k = morceauxChemin(m[1]);
      if (!k || k[0] !== '$node' || typeof k[1] !== 'string' || k[2] !== 'json' || k.length < 4) continue; // le reste : du texte
      if (m.index > i) out.push({ texte: t.slice(i, m.index) });
      out.push({ src: m[0], bloc: k[1], chemin: k.slice(3) }); i = m.index + m[0].length;
    }
    if (i < t.length) out.push({ texte: t.slice(i) });
    return out;
  }
  const assembler = (ms) => (ms ?? []).map((m) => m.src ?? m.texte ?? '').join('');
  /**
   * L'expression d'une donnée du bloc `bloc` : {{ $node["Bloc"].json.chemin }}. Dans des réglages rangés en texte JSON
   * (`dansJson`), les guillemets doubles seraient échappés et le moteur lirait vide : des guillemets simples.
   * → null quand le moteur ne saurait pas la relire (accolade, les deux guillemets, barre oblique inverse dans du JSON).
   */
  function exprDonnee(bloc, chemin, dansJson = false) {
    const qs = dansJson ? ['\''] : ['"', '\''];
    const entre = (k) => { if (/[{}]/.test(k) || (dansJson && /[\\\u0000-\u001f]/.test(k))) return null; const q = qs.find((x) => !k.includes(x)); return q ? `[${q}${k}${q}]` : null; };
    if (typeof bloc !== 'string' || !Array.isArray(chemin) || !chemin.length) return null;
    let s = entre(bloc); if (!s) return null;
    s = `$node${s}.json`;
    for (const k of chemin) {
      const p = typeof k === 'number' ? (Number.isInteger(k) && k >= 0 ? `[${k}]` : null) : typeof k === 'string' ? (RE_CLE.test(k) ? `.${k}` : entre(k)) : null;
      if (!p) return null; s += p;
    }
    return `{{ ${s} }}`;
  }
  const libelleChemin = (c) => (c ?? []).map((k) => (typeof k === 'number' ? `[${k}]` : k)).join(' › ');
  /** Les blocs situés avant `nom` (ceux d'où un fil mène jusqu'à lui), le plus lointain d'abord ; jamais lui-même. */
  function blocsAvant(wf, nom) {
    const parents = new Map();
    for (const [de, sorties] of Object.entries(wf?.connections ?? {})) for (const t of sorties ?? []) for (const l of t ?? []) if (l?.node) { if (!parents.has(l.node)) parents.set(l.node, []); parents.get(l.node).push(de); }
    const dist = new Map(), file = [[nom, 0]];
    while (file.length) { const [x, d] = file.shift(); for (const p of parents.get(x) ?? []) if (p !== nom && !dist.has(p)) { dist.set(p, d + 1); file.push([p, d + 1]); } }
    const ordre = new Map((wf?.nodes ?? []).map((n, i) => [n.name, i]));
    return [...dist.keys()].filter((x) => ordre.has(x)).sort((a, b) => dist.get(b) - dist.get(a) || ordre.get(a) - ordre.get(b));
  }
  /**
   * Les données vues au dernier passage d'un bloc : { chemin, exemple }, sans doublon, bornées. Seulement celles de son
   * PREMIER élément : c'est le seul que le moteur donne à $node["Bloc"].json (une clé des suivants y serait vide).
   */
  function donneesVues(items, max = 80) {
    const vus = new Map();
    const voir = (v, chemin, prof) => {
      if (vus.size >= max) return;
      if (chemin.length) { const k = JSON.stringify(chemin); if (!vus.has(k)) vus.set(k, { chemin, exemple: v }); }
      if (v && typeof v === 'object' && !Array.isArray(v) && prof < 4) for (const [k, x] of Object.entries(v)) voir(x, [...chemin, k], prof + 1);
    };
    const it = Array.isArray(items) ? items[0] : undefined;
    if (it && typeof it === 'object' && !Array.isArray(it)) voir(it, [], 0);
    return [...vus.values()];
  }
  /** Une donnée posée dans le réglage du bloc `nom` : { ok } ou { ok: false, raison } (bloc renommé, retiré, pas avant). */
  function etatDonnee(d, wf, nom, renommes, retires) {
    const existe = (x) => (wf?.nodes ?? []).some((n) => n.name === x);
    if (!existe(d.bloc)) {
      let v = d.bloc; for (let k = 0; renommes?.has(v) && k < 50; k++) v = renommes.get(v);
      if (v !== d.bloc && existe(v)) return { ok: false, raison: `« ${d.bloc} » a été renommé « ${v} » : cette donnée ne suit pas le nouveau nom.` };
      if (retires?.has(v) || retires?.has(d.bloc)) return { ok: false, raison: `« ${v} » a été retiré : cette donnée sera vide.` };
      return { ok: false, raison: `Le bloc « ${d.bloc} » n'existe pas (renommé ou retiré ?) : cette donnée sera vide.` };
    }
    if (d.bloc === nom) return { ok: false, raison: 'Cette donnée vient de ce bloc lui-même : elle n\'existe pas encore quand il part.' };
    if (!blocsAvant(wf, nom).includes(d.bloc)) return { ok: false, raison: `« ${d.bloc} » n'est pas avant ce bloc : cette donnée sera vide.` };
    return { ok: true };
  }
  // ---------------- Renommer un bloc : les données prises chez lui suivent son nouveau nom (fonctions pures). Seulement
  // dans les {{ … }} que le moteur lit en entier (resolve et readPath), et seulement le morceau qui nomme le bloc :
  // $node["X"], $node['X'], $node.X, $node[12] (un bloc nommé « 12 »). Le reste du texte ne change pas, à l'octet près.
  const NOM_ILLISIBLE = new Set(['__proto__', 'constructor', 'prototype']); // le moteur n'y lit rien (engine.ts, get)
  /** Le bloc que cite une expression (le texte entre {{ et }}) : { nom, debut, fin (du nom), sDebut, sFin (du morceau), forme, q } ou null. */
  function citation(expr) {
    const m = /^\s*(\$[a-z]+)/i.exec(expr); if (!m || m[1] !== '$node') return null;
    const k = morceauxChemin(expr); if (!k || k.length < 2) return null;
    const apres = expr.slice(m[0].length), rest = apres.trimStart(), o = m[0].length + apres.length - rest.length;
    let mm;
    if ((mm = /^\.\s*([\p{L}\p{N}_$-]+)/u.exec(rest))) return { nom: mm[1], debut: o + mm[0].length - mm[1].length, fin: o + mm[0].length, sDebut: o, sFin: o + mm[0].length, forme: '.' };
    if ((mm = /^\[\s*(["'])(.*?)\1\s*\]/.exec(rest))) { const d = o + mm[0].indexOf(mm[1]) + 1; return { nom: mm[2], debut: d, fin: d + mm[2].length, sDebut: o, sFin: o + mm[0].length, forme: '[', q: mm[1] }; }
    if ((mm = /^\[\s*(\d+)\s*\]/.exec(rest))) { const d = o + mm[0].indexOf(mm[1]); return { nom: String(Number(mm[1])), debut: d, fin: d + mm[1].length, sDebut: o, sFin: o + mm[0].length, forme: '0' }; }
    return null;
  }
  /** L'expression `expr` (qui cite `c`) réécrite pour citer `vers`, relue par le moteur à l'identique sauf le nom ; null sinon. */
  function citer(expr, c, vers, dansJson) {
    if (/[{}]/.test(vers) || NOM_ILLISIBLE.has(vers) || (dansJson && /["\\\u0000-\u001f]/.test(vers))) return null;
    const k0 = morceauxChemin(expr), attendu = JSON.stringify(k0.slice(2));
    const bon = (e) => { const k = morceauxChemin(e); return Boolean(k && k[0] === '$node' && String(k[1]) === vers && JSON.stringify(k.slice(2)) === attendu); };
    const essais = c.forme === '[' ? [] : [expr.slice(0, c.debut) + vers + expr.slice(c.fin)]; // la même écriture d'abord
    // Des crochets : le guillemet d'avant s'il ne gêne pas, sinon l'autre (dans du JSON, seulement l'apostrophe).
    const qs = [...new Set([c.q, '"', '\''].filter((q) => q && (!dansJson || q === c.q || q === '\'')))].sort((a, b) => Number(vers.includes(a)) - Number(vers.includes(b)));
    for (const q of qs) essais.push(c.forme === '[' ? expr.slice(0, c.debut - 1) + q + vers + q + expr.slice(c.fin + 1) : `${expr.slice(0, c.sDebut)}[${q}${vers}${q}]${expr.slice(c.sFin)}`);
    return essais.find(bon) ?? null;
  }
  /**
   * Un texte de réglage où le bloc `de` s'appelle maintenant `vers` : chaque {{ … }} qui le cite est réécrit, rien d'autre.
   * → le texte (le même s'il ne le cite pas) ; null si une citation ne saurait pas s'écrire avec ce nom (le texte reste tel quel).
   * `dansJson` : le réglage est un texte JSON (le moteur remplace avant de le lire) : ni guillemet double ni \ dans le nom.
   */
  function renommerDans(texte, de, vers, dansJson = false) {
    const t = String(texte ?? ''); let rate = false;
    const out = t.replace(RE_EXPR, (tout, expr) => {
      const c = citation(expr); if (!c || c.nom !== de) return tout;
      const e = citer(expr, c, vers, dansJson); if (e === null) { rate = true; return tout; }
      return tout.replace(expr, () => e);
    });
    if (rate) return null;
    // Un texte qui était un JSON le reste.
    if (out !== t) { let avant = false; try { JSON.parse(t); avant = true; } catch { /* pas un JSON */ } if (avant) { try { JSON.parse(out); } catch { return null; } } }
    return out;
  }
  const IMPOSSIBLE = Symbol('impossible');
  /** Une valeur de réglage (texte, liste, objet : comme resolve, les valeurs seulement) réécrite ; la même si rien ne change ; IMPOSSIBLE sinon. */
  function suivreValeur(v, de, vers, dansJson) {
    if (typeof v === 'string') { const r = renommerDans(v, de, vers, dansJson); return r === null ? IMPOSSIBLE : r === v ? v : r; }
    if (Array.isArray(v)) { let ch = false; const out = []; for (const x of v) { const r = suivreValeur(x, de, vers, false); if (r === IMPOSSIBLE) return r; ch ||= r !== x; out.push(r); } return ch ? out : v; }
    if (v && typeof v === 'object') { let ch = false; const out = {}; for (const [k, x] of Object.entries(v)) { const r = suivreValeur(x, de, vers, false); if (r === IMPOSSIBLE) return r; ch ||= r !== x; out[k] = r; } return ch ? out : v; }
    return v;
  }
  /** Une valeur de réglage (texte, liste, objet : les valeurs seulement, comme resolve) cite-t-elle le bloc `nom` ? */
  function citeLeBloc(v, nom) {
    if (typeof v === 'string') { for (const m of v.matchAll(RE_EXPR)) if (citation(m[1])?.nom === nom) return true; return false; }
    if (Array.isArray(v)) return v.some((x) => citeLeBloc(x, nom));
    if (v && typeof v === 'object') return Object.values(v).some((x) => citeLeBloc(x, nom));
    return false;
  }
  /**
   * Le bloc `de` renommé `vers` : les réglages de TOUS les blocs qui le citent, réécrits. → { ok, changes: [{ i, cle, valeur }] }
   * (rien n'est écrit ici) ou { ok: false, error } si une donnée ne saurait pas s'écrire avec ce nom, ou vise déjà un bloc
   * de ce nom (qui n'existe pas : nomValide refuse un nom pris). `estJson(bloc, clé)` :
   * ce réglage est-il un texte JSON ? Le code d'un bloc « Code » est lu tel quel par le moteur, jamais résolu : il ne change pas.
   */
  function suivreRenommage(wf, de, vers, estJson = () => false) {
    const changes = [], nodes = wf?.nodes ?? [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      for (const [cle, v] of Object.entries(n.params ?? {})) {
        if (n.type === 'données.code' && cle === 'code') continue;
        // Une donnée qui vise déjà un bloc « vers » (qui n'existe plus) prendrait, sans le dire, celles de « de » ; et
        // revenir à l'ancien nom l'emporterait avec elle : refusé.
        if (citeLeBloc(v, vers)) return { ok: false, error: `Une donnée de « ${n.name} » vise déjà un bloc « ${vers} » qui n'existe pas : avec ce nom, elle prendrait celles de « ${de} ». Choisis un autre nom, ou change d'abord cette donnée.` };
        const r = suivreValeur(v, de, vers, typeof v === 'string' && Boolean(estJson(n, cle)));
        if (r === IMPOSSIBLE) return { ok: false, error: `Le nom « ${vers} » ne peut pas s'écrire dans la donnée que « ${n.name} » prend chez « ${de} » (une accolade, un retour à la ligne, ou, dans des réglages en JSON, un guillemet double ou une barre oblique inverse) : choisis un autre nom.` };
        if (r !== v) changes.push({ i, cle, valeur: r });
      }
    }
    return { ok: true, changes };
  }
  // Session expirée pendant l'usage : on revient à la page de connexion. Sur la page de connexion elle-même,
  // on ne recharge rien (sinon elle se rechargerait en boucle et effacerait ce que tu tapes).
  const appShown = () => { const a = document.querySelector('#app'); return Boolean(a && !a.hidden); };
  async function api(path, body) {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) } : { headers: { 'x-odin': '1' } });
    if (r.status === 401) { if (appShown()) location.reload(); throw new Error('session expirée'); }
    return r.json();
  }
  const css = `
.dr-top{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}.dr-top input{flex:1 1 280px;min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--field);background:var(--panel)}
.dr-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin:0 0 20px}
.dr-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:8px}
.dr-card .dr-h{display:flex;gap:10px;align-items:center;justify-content:space-between}.dr-card b{font-size:16px}
.dr-steps{font-size:13px;color:var(--muted);overflow-wrap:anywhere}.dr-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.dr-tpl{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
.dr-tpl article{border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--panel2);display:flex;flex-direction:column;gap:6px}.dr-tpl p{margin:0;font-size:14px;color:var(--muted)}
.dr-ed{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:12px;align-items:start}@media (max-width:980px){.dr-ed{grid-template-columns:1fr}}
.dr-canvas{position:relative;height:min(64vh,620px);border:1px solid var(--line);border-radius:14px;background:var(--panel2) radial-gradient(circle,var(--line) 1px,transparent 1px) 0 0/22px 22px;overflow:hidden;touch-action:none}
.dr-canvas>svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
.dr-world{position:absolute;left:0;top:0;transform-origin:0 0}
.dr-node{position:absolute;width:190px;box-sizing:border-box;min-height:136px;padding-top:102px;padding-left:4px;padding-right:4px;text-align:center;cursor:grab;user-select:none}
.dr-node.off{opacity:.5}
.dr-rond{position:absolute;left:47px;top:0;width:96px;height:96px;box-sizing:border-box;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,var(--dr-c0,var(--accent)),var(--dr-c1,var(--accent)));box-shadow:0 0 0 6px color-mix(in srgb,var(--dr-c0,var(--accent)) 28%,var(--panel)),var(--shadow)}
.dr-node.sel .dr-rond{box-shadow:0 0 0 6px var(--accent),var(--shadow)}
.dr-node.ok .dr-rond{box-shadow:0 0 0 6px var(--good),var(--shadow)}.dr-node.err .dr-rond{box-shadow:0 0 0 6px var(--bad),var(--shadow)}
.dr-node.sel.ok .dr-rond{box-shadow:0 0 0 4px var(--good),0 0 0 6px var(--panel),0 0 0 10px var(--accent),var(--shadow)}.dr-node.sel.err .dr-rond{box-shadow:0 0 0 4px var(--bad),0 0 0 6px var(--panel),0 0 0 10px var(--accent),var(--shadow)}
.dr-node:focus-visible{outline:none}.dr-node:focus-visible .dr-rond{outline:2px solid var(--accent);outline-offset:9px}
.dr-horloge{position:absolute;left:-8px;top:58px;width:40px;height:40px;box-sizing:border-box;border-radius:50%;background:linear-gradient(145deg,var(--dr-c0,var(--accent)),var(--dr-c1,var(--accent)));box-shadow:0 0 0 2px var(--panel2);pointer-events:none}
.dr-horloge::before{content:'';position:absolute;inset:8px;border:2.5px solid #fff;border-radius:50%}.dr-horloge::after{content:'';position:absolute;left:18px;top:12px;width:6px;height:9px;border-left:2.5px solid #fff;border-bottom:2.5px solid #fff}
.dr-node small{display:block;font-size:11.5px;line-height:16px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dr-node b{display:block;font-size:14px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dr-node .dr-cnt{display:block;font-size:11.5px;line-height:16px;color:color-mix(in srgb,var(--good) 55%,var(--ink));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dr-node.err .dr-cnt{color:color-mix(in srgb,var(--bad) 55%,var(--ink))}
.dr-port{--z:var(--dr-z,44px);--dh:calc(var(--z) / 2);--db:calc(var(--z) / 2);--cx:calc(var(--z) / 2);position:absolute;width:var(--z);height:calc(var(--dh) + var(--db));border:0;border-radius:0;background:none;padding:0;cursor:crosshair;touch-action:none}
.dr-port::before{content:'';position:absolute;left:calc(var(--cx) - 6px);top:calc(var(--dh) - 6px);width:12px;height:12px;box-sizing:border-box;border-radius:50%;border:2px solid var(--accent);background:var(--panel)}
.dr-port.in{left:calc(25px - var(--z) / 2);top:calc(48px - var(--z) / 2)}.dr-port.out{--g:max(173px,calc(195px - var(--z) / 2));--cx:calc(195px - var(--g));left:var(--g);width:max(var(--z),calc(195px + var(--z) / 2 - var(--g)))}.dr-port.armed::before{background:var(--accent)}
.dr-port:focus-visible{outline:none}.dr-port:focus-visible::before{outline:2px solid var(--accent);outline-offset:2px}
.dr-port .dr-pl{position:absolute;left:calc(var(--cx) + 11px);top:calc(var(--dh) - 11px);padding:0 2px;border-radius:4px;background:var(--panel2);font-size:10.5px;color:var(--dim);white-space:nowrap;pointer-events:none}
.dr-link{fill:none;stroke-width:10;stroke-dasharray:0 15;stroke-linecap:round;opacity:.9;pointer-events:none}
.dr-fil-nom{font-size:12px;font-weight:700;fill:var(--ink);stroke:var(--panel2);stroke-width:5px;stroke-linejoin:round;paint-order:stroke;text-anchor:middle;dominant-baseline:central;pointer-events:none}
.dr-node.dr-filtre{padding-top:76px;pointer-events:none}.dr-node.dr-filtre>*{pointer-events:auto}
.dr-node.dr-filtre .dr-rond{left:73px;top:26px;width:44px;height:44px}
.dr-node.dr-filtre .dr-rond::after{content:'';position:absolute;left:50%;top:50%;width:max(100%,var(--dr-z,44px));height:max(100%,var(--dr-z,44px));transform:translate(-50%,-50%);border-radius:50%}
.dr-fil{fill:none;stroke:transparent;stroke-width:var(--dr-zf,22px);pointer-events:stroke;cursor:pointer}.dr-fil:focus{outline:none}
.dr-fil:hover,.dr-fil:focus-visible,.dr-fil.on{stroke:color-mix(in srgb,var(--accent) 22%,transparent)}
.dr-tire{fill:none;stroke:var(--accent);stroke-width:2.2;stroke-dasharray:6 5;pointer-events:none}
.dr-node.dr-cible .dr-rond{box-shadow:0 0 0 6px var(--accent),0 0 0 10px color-mix(in srgb,var(--accent) 30%,transparent)}
.dr-fil-menu{position:absolute;z-index:3;min-width:200px;display:flex;flex-direction:column;gap:2px;padding:6px;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);animation:dr-ch-in .12s ease-out}
.dr-fil-menu button{text-align:left;border:0;background:none;border-radius:8px;padding:0 12px;min-height:44px;color:var(--ink);font:inherit;font-size:14px;cursor:pointer}
.dr-fil-menu button:hover,.dr-fil-menu button:focus-visible{background:var(--panel2);outline:none}.dr-fil-menu button:focus-visible{box-shadow:inset 0 0 0 2px var(--accent)}
.dr-side{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px;max-height:min(64vh,620px);overflow:auto}
.dr-side h2{font-size:16px;margin:0}.dr-side label{font-size:13.5px;font-weight:600;display:block;margin:6px 0 4px}
.dr-side input:not([type=checkbox]),.dr-side textarea,.dr-side select{width:100%;min-height:38px;padding:7px 10px;border-radius:10px;border:1px solid var(--field);background:var(--panel2)}.dr-side textarea{min-height:80px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}
.dr-cat{display:flex;flex-direction:column;gap:4px}.dr-cat h3{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--dim);margin:8px 0 2px}
.dr-cat button{text-align:left;border:1px solid var(--line);background:var(--panel2);border-radius:10px;padding:7px 10px;font-size:13.5px;min-height:36px}.dr-cat button:hover{border-color:var(--accent)}
.dr-out{white-space:pre-wrap;font-size:12.5px;background:var(--panel2);border-radius:10px;padding:8px;max-height:240px;overflow:auto;font-family:ui-monospace,Menlo,Consolas,monospace}
.dr-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 10px}.dr-bar input.dr-name{flex:1 1 220px;min-height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--field);background:var(--panel);font-weight:600}
.dr-runs{font-size:13.5px}.dr-runs li{padding:4px 0}
.dr-plus{position:absolute;left:129px;top:26px;width:44px;height:44px;padding:0;border:0;background:none;display:grid;place-items:center;cursor:pointer;z-index:1}
.dr-plus span{width:28px;height:28px;border-radius:50%;background:var(--accent);color:var(--on-accent,#fff);display:grid;place-items:center;font-size:20px;font-weight:700;line-height:1;box-shadow:var(--shadow);transition:transform .15s}
.dr-plus:hover span,.dr-plus:focus-visible span{transform:scale(1.15)}.dr-plus:focus-visible{outline:2px solid var(--accent);border-radius:50%}
.dr-vide{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;text-align:center;pointer-events:none}
.dr-vide button{pointer-events:auto;width:96px;height:96px;border-radius:50%;border:2px dashed var(--accent);background:var(--panel);color:var(--accent);font-size:52px;line-height:1;cursor:pointer;box-shadow:var(--shadow)}
.dr-vide button:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.dr-vide p{margin:0;color:var(--muted);font-size:14px;max-width:320px}
.dr-choix-fond{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(8,10,14,.55)}
.dr-choix{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);width:min(640px,100%);max-height:min(86vh,720px);display:flex;flex-direction:column;overflow:hidden;animation:dr-ch-in .16s ease-out}
.dr-ch-h{display:flex;align-items:center;gap:10px;padding:10px 10px 10px 16px;border-bottom:1px solid var(--line)}.dr-ch-h h2{flex:1;margin:0;font-size:17px;display:flex;align-items:center;gap:10px;min-width:0;overflow-wrap:anywhere}
.dr-ch-x{flex:none;width:44px;height:44px;border:0;border-radius:10px;background:none;color:var(--ink);font-size:24px;cursor:pointer}.dr-ch-x:hover{background:var(--panel2)}
.dr-ch-c{padding:12px 16px 16px;overflow:auto;display:flex;flex-direction:column;gap:10px;min-height:0}.dr-ch-c .li-g{max-height:none}.dr-ch-c>.btn{align-self:flex-start;min-height:44px}
.dr-ch-c h3{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--dim);margin:6px 0 0}.dr-ch-c h4{font-size:12.5px;color:var(--muted);margin:6px 0 0}
.dr-ch-o{display:flex;flex-direction:column;gap:6px}.dr-ch-o button{text-align:left;border:1px solid var(--line);background:var(--panel2);border-radius:10px;padding:8px 12px;min-height:44px;color:var(--ink);font:inherit;cursor:pointer}
.dr-ch-o button:hover{border-color:var(--accent)}.dr-ch-o button:focus-visible{outline:2px solid var(--accent)}.dr-ch-o b{display:block;font-size:14px}.dr-ch-o small{display:block;color:var(--muted);font-size:12.5px}
.dr-node .dr-manque{position:absolute;left:118px;top:-5px;width:22px;height:22px;box-sizing:border-box;border-radius:50%;border:2px solid var(--panel2);background:var(--bad);color:var(--panel);font-size:12px;font-weight:700;line-height:18px;text-align:center;pointer-events:none}
.dr-node.dr-filtre .dr-manque{left:51px;top:52px}
.dr-app{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--line);border-radius:12px;background:var(--panel2)}.dr-app>div{flex:1;min-width:0}
.dr-app b{display:block;font-size:13px;color:var(--muted);font-weight:600;overflow-wrap:anywhere}.dr-app span.dr-fn{display:block;font-size:15px;font-weight:700;overflow-wrap:anywhere}.dr-app .btn{flex:none;min-height:44px}
#v-flows .dr-side .dr-champs input,#v-flows .dr-side .dr-champs select,#v-flows .dr-side .dr-champs textarea{min-height:44px}.dr-side .dr-champs textarea{font-family:inherit;font-size:14px}
.dr-side .dr-manque{display:block;color:var(--bad);font-size:13px;margin-top:4px}.dr-side .dr-manque[hidden]{display:none}.dr-side .dr-champs small.sub{display:block;margin-top:4px}
.dr-av summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:600}.dr-av textarea{min-height:120px}
@keyframes dr-ch-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
.dr-df-l{display:flex;gap:6px;align-items:flex-start}.dr-df .btn.dr-df-b{flex:none;min-height:44px;min-width:44px}
.dr-saisie{flex:1;min-width:0;min-height:44px;box-sizing:border-box;padding:9px 10px;border-radius:10px;border:1px solid var(--field);background:var(--panel2);color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.75;font-size:14px;cursor:text}
.dr-saisie.multi{min-height:88px}.dr-saisie:focus{outline:2px solid var(--accent);outline-offset:1px}.dr-saisie:empty::before{content:attr(data-placeholder);color:var(--dim)}
.dr-pastille{display:inline-flex;align-items:center;gap:3px;max-width:100%;box-sizing:border-box;margin:0 1px;padding:0 1px 0 8px;border-radius:999px;background:color-mix(in srgb,var(--accent) 16%,var(--panel));border:1px solid color-mix(in srgb,var(--accent) 55%,transparent);color:var(--ink);font-size:13px;line-height:22px;white-space:nowrap;vertical-align:baseline;user-select:none;cursor:default}
.dr-pastille .dr-p-t{overflow:hidden;text-overflow:ellipsis}.dr-pastille.bad{background:color-mix(in srgb,var(--bad) 14%,var(--panel));border-color:var(--bad)}.dr-p-a{font-weight:700;color:var(--bad)}
.dr-p-x{position:relative;flex:none;width:20px;height:20px;padding:0;border:0;border-radius:50%;background:none;color:var(--muted);font-size:15px;line-height:1;cursor:pointer}
.dr-p-x::after{content:'';position:absolute;inset:-12px}.dr-p-x:hover,.dr-p-x:focus-visible{background:color-mix(in srgb,var(--ink) 14%,transparent);color:var(--ink);outline:none}
.dr-donnees{margin-top:6px;border:1px solid var(--line);border-radius:12px;background:var(--panel2);padding:8px 10px 10px;display:flex;flex-direction:column;gap:6px;max-height:360px;overflow:auto}
.dr-dn-h{display:flex;align-items:center;gap:8px}.dr-dn-h h3{flex:1;margin:0;font-size:14px}.dr-donnees .dr-dn-h .btn{min-height:44px}
.dr-donnees h4{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin:6px 0 0;font-size:13.5px;overflow-wrap:anywhere}.dr-donnees h4 small{font-weight:400}
.dr-dn-l{display:flex;flex-direction:column;gap:4px}
.dr-dn-i{display:flex;flex-direction:column;align-items:flex-start;text-align:left;width:100%;min-height:44px;padding:6px 10px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--ink);font:inherit;cursor:pointer}
.dr-dn-i b{font-size:13.5px;overflow-wrap:anywhere}.dr-dn-i small{color:var(--muted);font-size:12px;overflow-wrap:anywhere}.dr-dn-i:hover{border-color:var(--accent)}.dr-dn-i:focus-visible{outline:2px solid var(--accent)}.dr-dn-i[disabled]{opacity:.55;cursor:not-allowed}
.dr-node.dr-source .dr-rond{outline:3px solid var(--accent);outline-offset:3px;box-shadow:0 0 0 6px color-mix(in srgb,var(--accent) 40%,transparent);animation:dr-pulse .9s ease-in-out infinite alternate}
@keyframes dr-pulse{from{box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 30%,transparent)}to{box-shadow:0 0 0 9px color-mix(in srgb,var(--accent) 45%,transparent)}}
.dr-mb{position:absolute;width:var(--dr-z,44px);height:var(--dr-z,44px);left:calc(95px - var(--dr-z,44px) / 2);z-index:1;top:calc(10px - var(--dr-z,44px));padding:0;border:0;background:none;display:grid;place-items:end center;cursor:pointer;touch-action:none}
.dr-node.dr-filtre .dr-mb{top:calc(36px - var(--dr-z,44px))}
.dr-mb span{min-width:28px;height:18px;padding:0 4px;box-sizing:border-box;border-radius:9px;border:1.5px solid var(--line);background:var(--panel);color:var(--muted);font-size:15px;font-weight:700;line-height:13px;text-align:center;transition:border-color .15s,color .15s}
.dr-mb:hover span,.dr-mb:focus-visible span,.dr-mb[aria-expanded=true] span{border-color:var(--accent);color:var(--accent)}.dr-mb:focus-visible{outline:none}.dr-mb:focus-visible span{outline:2px solid var(--accent);outline-offset:1px}
.dr-node{-webkit-touch-callout:none}.dr-node .dr-nom.dr-cache{visibility:hidden}
.dr-note-m{position:absolute;left:52px;top:5px;width:18px;height:18px;box-sizing:border-box;border-radius:5px;border:1.5px solid var(--accent);background:var(--panel);pointer-events:none}
.dr-note-m::before{content:'';position:absolute;left:3px;right:3px;top:4px;height:5px;border-top:1.5px solid var(--accent);border-bottom:1.5px solid var(--accent)}
.dr-note-bulle{position:absolute;z-index:2;max-width:260px;box-sizing:border-box;padding:8px 10px;border-radius:10px;background:var(--panel);color:var(--ink);border:1px solid var(--accent);box-shadow:var(--shadow);font-size:13px;line-height:1.4;white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;overflow:hidden;pointer-events:none}
.dr-renom-z{position:absolute;left:4px;width:182px;z-index:4;transform-origin:0 0;transform:scale(var(--dr-ik,1));display:flex;flex-direction:column;gap:3px}
.dr-renom{box-sizing:border-box;width:100%;min-height:30px;padding:3px 8px;border-radius:8px;border:1.5px solid var(--accent);background:var(--panel);color:var(--ink);font:inherit;font-size:14px;font-weight:600}.dr-renom:focus{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 30%,transparent)}
.dr-renom[aria-invalid=true]{border-color:var(--bad)}.dr-renom-e{display:block;padding:4px 8px;border-radius:8px;background:var(--panel);border:1px solid var(--bad);color:var(--bad);font-size:12px;line-height:1.35;white-space:normal}.dr-renom-e[hidden]{display:none}
.dr-note-ed label{font-size:13.5px;font-weight:600}.dr-note-ed textarea{box-sizing:border-box;width:100%;min-height:130px;padding:10px;border-radius:10px;border:1px solid var(--field);background:var(--panel2);color:var(--ink);font:inherit;font-size:14.5px;resize:vertical}
.dr-note-ed .dr-row .btn{min-height:44px}
.dr-seul{position:absolute;left:32px;top:23px;min-width:22px;height:22px;box-sizing:border-box;padding:0 6px;border-radius:11px;background:var(--good);color:var(--panel);font-size:12px;font-weight:700;line-height:22px;text-align:center;pointer-events:none;box-shadow:0 0 0 2px var(--panel);transform-origin:100% 100%;transform:scale(var(--dr-ik,1))}.dr-seul.bad{background:var(--bad)}
.dr-seul-b{position:absolute;z-index:1;left:calc(54px - var(--dr-z,44px));top:calc(45px - var(--dr-z,44px));width:var(--dr-z,44px);height:var(--dr-z,44px);padding:0;border:0;border-radius:10px;background:none;cursor:pointer}
.dr-seul-b:focus-visible{outline:none}.dr-seul-b:focus-visible+.dr-seul,.dr-seul-b:hover+.dr-seul{outline:2px solid var(--accent);outline-offset:2px}
.dr-bulle{position:absolute;z-index:1;width:var(--dr-z,44px);height:var(--dr-z,44px);left:max(142px,calc(95px + var(--dr-z,44px) / 2));top:calc(min(10px,calc(var(--dr-sh,48px) - var(--dr-z,44px) / 2)) - var(--dr-z,44px));padding:0;border:0;background:none;display:grid;place-items:end start;cursor:pointer}
.dr-bulle span{min-width:26px;height:24px;padding:0 7px;box-sizing:border-box;border-radius:12px;border:1.5px solid var(--line);background:var(--panel);color:var(--ink);font-size:12.5px;font-weight:700;line-height:21px;text-align:center;white-space:nowrap;box-shadow:var(--shadow);transform-origin:0 100%;transform:scale(var(--dr-ik,1))}
.dr-bulle.bad span{background:var(--bad);border-color:var(--bad);color:var(--panel)}
.dr-bulle:hover span{border-color:var(--accent)}.dr-bulle:focus-visible{outline:none}.dr-bulle:focus-visible span{outline:2px solid var(--accent);outline-offset:2px}
.dr-node.dr-filtre .dr-bulle{left:calc(95px + var(--dr-z,44px) / 2);top:calc(min(26px,calc(var(--dr-sh,48px) - var(--dr-z,44px) / 2)) - var(--dr-z,44px))}
.dr-node.ok .dr-nom::before{content:'✓ ';color:var(--good)}
.dr-passage{position:absolute;z-index:3;left:8px;top:8px;width:340px;box-sizing:border-box;display:flex;flex-direction:column;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);animation:dr-ch-in .14s ease-out}
.dr-passage::before{content:'';position:absolute;left:calc(var(--dr-pointe,50%) - 7px);width:12px;height:12px;box-sizing:border-box;background:var(--panel);border:1px solid var(--line);transform:rotate(45deg)}
.dr-passage.bas::before{top:-7px;border-right:0;border-bottom:0}.dr-passage.haut::before{bottom:-7px;border-left:0;border-top:0}.dr-passage.libre::before{display:none}
.dr-ps-h{flex:none;display:flex;align-items:center;gap:8px;padding:4px 4px 4px 14px;border-bottom:1px solid var(--line)}.dr-ps-h h2{flex:1;min-width:0;margin:0;font-size:15px;overflow-wrap:anywhere}
.dr-ps-x{flex:none;width:44px;height:44px;border:0;border-radius:10px;background:none;color:var(--ink);font-size:24px;line-height:1;cursor:pointer}.dr-ps-x:hover{background:var(--panel2)}.dr-ps-x:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.dr-ps-c{min-height:0;overflow:auto;overscroll-behavior:contain;padding:10px 14px 14px;display:flex;flex-direction:column;gap:8px}.dr-ps-c:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:0 0 14px 14px}
.dr-ps-c h3{margin:4px 0 0;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.dr-ps-r{margin:0;font-size:13px;color:var(--muted)}.dr-ps-m{margin:0;font-size:12.5px;line-height:1.4;color:var(--muted);font-style:italic;overflow-wrap:anywhere}
.dr-ps-l{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.dr-ps-l li{border:1px solid var(--line);border-radius:10px;background:var(--panel2);padding:6px 10px}.dr-ps-l b{display:block;font-size:12px;color:var(--muted);font-weight:600}
.dr-ps-l pre,.dr-ps-e{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12.5px;line-height:1.45;color:var(--ink);font-family:ui-monospace,Menlo,Consolas,monospace}
.dr-ps-e{padding:8px 10px;border-radius:10px;border:1px solid var(--bad);background:color-mix(in srgb,var(--bad) 10%,var(--panel))}
.dr-ps-recu>*+*{margin-top:6px}.dr-ps-recu summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:600;font-size:13.5px}.dr-ps-recu summary:focus-visible{outline:2px solid var(--accent);border-radius:8px}
.dr-port .dr-pl .dr-pn{margin-left:4px;padding:0 4px;border-radius:6px;background:var(--panel);border:1px solid var(--line);color:var(--ink);font-weight:700}
#v-flows .dr-bar .btn.dr-hist{min-height:44px;min-width:44px}.dr-bar .btn.dr-hist[disabled]{opacity:.45;cursor:default}
.dr-actions{flex:1 1 100%;display:flex;flex-wrap:wrap;gap:8px;align-items:stretch}.dr-actions #drSt{flex:1 1 220px;min-width:0;align-self:center;overflow-wrap:anywhere}
@media (max-width:600px){.dr-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}.dr-actions .btn{white-space:normal;min-height:44px}.dr-actions #drSt{grid-column:1/-1}}
@media (prefers-reduced-motion:reduce){.dr-node.dr-source .dr-rond,.dr-choix,.dr-fil-menu,.dr-passage{animation:none}.dr-plus span,.dr-mb span{transition:none}}
`;
  let st = null, wf = null, outs = {}, sel = null, armed = null, last = null, view = { x: 40, y: 40, k: 1 }, dirty = false;
  // enregistree : la copie de l'automatisation telle qu'enregistrée (ce que le serveur fait tourner) ; seuls : les blocs
  // exécutés seuls depuis le dernier « Tester » (marqués d'un rond).
  let enregistree = null, seuls = new Set();
  // passeSur : l'automatisation telle qu'elle a tourné au dernier passage (null : on ne sait pas) ; ce qu'un bloc a reçu ne
  // se déduit que si les blocs et les fils n'ont pas changé depuis. passage : la bulle des données ouverte ({ nom, boite, dehors }).
  let passeSur = null, passage = null;
  const copie = (x) => (x ? JSON.parse(JSON.stringify(x)) : null);
  const cat = (t) => st?.catalog.find((c) => c.type === t);
  let elems = new Map();
  // ---------------- Annuler / refaire, copier / coller, + et − : dans la page seulement.
  // hist.avant : l'état d'avant chaque geste (le plus récent à la fin) ; hist.apres : ce qui se refait ; hist.pose : l'état
  // à l'écran après le dernier geste noté ; hist.cle : le champ du dernier geste (taper dans un même champ = un seul geste).
  // Un état : les blocs, les fils et les sorties connues. Ni le nom de l'automatisation, ni son dossier, ni les exécutions :
  // annuler ne touche jamais ce qui a été fait hors de l'éditeur (Tester, Exécuter ce bloc seul, Enregistrer) et n'envoie rien.
  // presse : la copie d'un bloc (copieDe), gardée par la page, jamais dans le presse-papiers du système.
  let hist = { avant: [], apres: [], pose: null, cle: null }, presse = null, appliquerVue = null;
  const etatEditeur = () => JSON.stringify({ nodes: wf.nodes, connections: wf.connections, outs });
  /** Un geste vient de changer le schéma : l'état d'avant rejoint l'historique (borné), « Refaire » se vide. */
  function noter(quoi, cle = null) {
    if (!wf || hist.pose === null) return;
    const e = etatEditeur(); if (e === hist.pose) return;
    if (!(cle && cle === hist.cle && hist.avant.length)) { hist.avant.push({ etat: hist.pose, quoi }); if (hist.avant.length > MAX_HISTOIRE) hist.avant.shift(); }
    hist.pose = e; hist.cle = cle; hist.apres = []; peindreHist();
  }
  /** L'écran a changé sans geste (enregistré, valeur de départ d'un champ) : c'est le nouveau point de départ, sans pas d'historique. */
  function rebaser() { if (wf && hist.pose !== null) { hist.pose = etatEditeur(); hist.cle = null; } }
  function peindreHist() {
    for (const [id, liste, mot, touche] of [['drUndo', hist.avant, 'Annuler', 'Ctrl+Z'], ['drRedo', hist.apres, 'Refaire', 'Ctrl+Y']]) {
      const b = $(`#${id}`); if (!b) continue;
      const d = liste[liste.length - 1];
      if (d) { b.removeAttribute?.('disabled'); b.setAttribute('title', `${mot} : ${d.quoi} (${touche})`); } else { b.setAttribute('disabled', ''); b.setAttribute('title', `${mot} (${touche}) : rien pour l'instant`); }
    }
  }
  /** Annuler (`arriere`) ou refaire le dernier geste : seul l'écran change ; il est de nouveau à enregistrer. → true s'il y en avait un. */
  function revenir(arriere) {
    if (!wf || hist.pose === null) return false;
    noter('un changement'); // (un changement pas encore noté devient un geste)
    const de = arriere ? hist.avant : hist.apres, vers = arriere ? hist.apres : hist.avant, pas = de.pop();
    if (!pas) return false;
    vers.push({ etat: etatEditeur(), quoi: pas.quoi });
    const s = JSON.parse(pas.etat); wf.nodes = s.nodes; wf.connections = s.connections; outs = s.outs ?? {};
    hist.pose = etatEditeur(); hist.cle = null;
    const surBloc = Boolean(document.activeElement?.closest?.('.dr-node'));
    armed = null; if (sel && !wf.nodes.some((n) => n.name === sel)) sel = null;
    dirty = true; draw(); drawSide(); peindreHist();
    dire(`${arriere ? '↶ Annulé' : '↷ Refait'} : ${pas.quoi}. Seul l'écran a changé : à enregistrer.`);
    if (surBloc && sel) elems.get(sel)?.focus?.();
    return true;
  }
  function copierBloc(nom) {
    const n = wf?.nodes.find((x) => x.name === nom); if (!n) return;
    presse = copieDe(n);
    dire(`✓ « ${nom} » copié (dans cette page seulement) : Ctrl+V pour le coller.`);
  }
  function collerCopie() {
    if (!wf || !presse || !$('#drCanvas')) return false;
    const r = collerBloc(wf, presse, view.k);
    sel = r.name; dirty = true; noter(`coller « ${r.name} »`);
    montrer(wf.nodes.find((n) => n.name === r.name)); draw(); drawSide();
    dire(`✓ « ${r.name} » collé, sans ses liens.`);
    elems.get(r.name)?.focus?.();
    // Le « + » dépasse sous le bloc : la page défile au plus près pour le montrer aussi (au téléphone, le bloc seul
    // s'arrêtait au ras de la barre du bas et son « + » restait dessous). montrer() l'a déjà mis dans le schéma.
    elems.get(r.name)?.querySelector?.('.dr-plus')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    return true;
  }
  /** On écrit dans un champ, ou une fenêtre est ouverte : les touches sont à eux (Ctrl+C, Ctrl+V, Ctrl+Z y gardent leur sens). */
  function enSaisie(t) {
    if (!t || t.nodeType !== 1) return false;
    if (t.isContentEditable || t.closest?.('.dr-saisie') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return true;
    for (let x = t; x && x.nodeType === 1; x = x.parentElement ?? x.parent ?? null) {
      const ce = x.getAttribute?.('contenteditable'), r = x.getAttribute?.('role');
      if ((ce !== null && ce !== undefined && ce !== 'false') || r === 'dialog' || r === 'alertdialog' || x.tagName === 'DIALOG') return true;
    }
    return false;
  }
  /** Le bloc visé par Ctrl+C : celui qui a le focus, sinon le bloc choisi. */
  function blocVise(t) {
    const d = t?.closest?.('.dr-node');
    if (d) for (const [nom, x] of elems) if (x === d) return nom;
    return sel && wf?.nodes.some((n) => n.name === sel) ? sel : null;
  }
  const texteChoisi = () => { try { const s = window.getSelection?.(); return Boolean(s && !s.isCollapsed && String(s).trim()); } catch { return false; } };
  /** Les raccourcis de l'éditeur ouvert et visible : Ctrl+Z, Ctrl+Y (ou Ctrl+Maj+Z), Ctrl+C, Ctrl+V, + et −. */
  function raccourci(e) {
    if (!wf || e.defaultPrevented || e.altKey) return;
    if (!$('#drCanvas') || !$('#v-flows')?.classList?.contains('on')) return;
    // (une fenêtre ouverte par-dessus : une confirmation, la palette ; celles qui sont cachées ne comptent pas)
    // (dans la bulle des données : Ctrl+C copie le texte choisi, rien ne change le schéma derrière elle)
    if (e.target?.closest?.('.dr-passage')) return;
    if (choix || enSaisie(e.target) || [...(document.querySelectorAll?.('[aria-modal="true"]') ?? [])].some((x) => !x.hidden && x.getClientRects?.().length)) return;
    const k = String(e.key ?? ''), l = k.toLowerCase(), c = Boolean(e.ctrlKey || e.metaKey);
    let pris = false;
    if (c && l === 'z' && !e.shiftKey) pris = revenir(true);
    else if (c && ((l === 'y' && !e.shiftKey) || (l === 'z' && e.shiftKey))) pris = revenir(false);
    else if (c && l === 'c' && !e.shiftKey) { const nom = texteChoisi() ? null : blocVise(e.target); if (nom) { copierBloc(nom); pris = true; } }
    else if (c && l === 'v' && !e.shiftKey) pris = collerCopie();
    else if (!c && (k === '+' || k === '-')) {
      const r = $('#drCanvas').getBoundingClientRect();
      fermerMenu(); Object.assign(view, zoomer(view, k === '+' ? 1.1 : 0.9, (r.width || 0) / 2, (r.height || 0) / 2)); appliquerVue?.(); pris = true;
    }
    if (pris) e.preventDefault();
  }

  // Un autre écran de Talos (« Faire un lien ») a pris la page : la liste ne revient qu'à la demande.
  let ailleurs = false, jeton = 0;
  async function openList() {
    fermerPassage(); wf = null; ailleurs = false; fermerChoix(); const j = ++jeton;
    const box = $('#v-flows .body'); if (!box) return;
    $('#v-flows .head h1').textContent = 'Automatisations';
    $('#v-flows .head .sub').textContent = 'Talos, le moteur d\'Odin : décris ce que tu veux automatiser, ou pars d\'un modèle. Tout est relié à Thot, Papyrus et tes applis.';
    st = await api('/api/draupnir/state');
    if (j !== jeton) return;
    box.replaceChildren();
    if (!st.ok) { box.append(el('p', { class: 'sub' }, st.error)); return; }
    const msg = el('p', { class: 'sub', role: 'status' });
    box.append(el('form', { class: 'dr-top', onsubmit: async (e) => { e.preventDefault(); const d = $('#drAsk').value.trim(); if (!d) return; msg.textContent = 'Odin écrit l\'automatisation…'; const r = await api('/api/draupnir/create', { description: d }); if (r.ok) ouvrirNeuve(r.flow.id); else msg.textContent = `✗ ${r.error}`; } },
      el('label', { for: 'drAsk', class: 'sr' }, 'Décris ton automatisation'), el('input', { id: 'drAsk', placeholder: 'Ex. chaque matin à 7 h, envoie-moi les tâches en retard', autocomplete: 'off' }), el('button', { class: 'btn primary', type: 'submit' }, 'Créer avec Odin'), lienBtn(), el('button', { class: 'btn', type: 'button', onclick: newFlow }, 'Partir de zéro')), msg);
    // Les dossiers de Talos (onglets Actives, Brouillons, tes dossiers, Corbeille) : pages/talos-dossiers.js ; sans lui, la grille d'avant.
    if (!window.OdinTalosDossiers?.monter(box, st, { ouvrir: openFlow, lancer, recharger: openList })) { if (st.flows.length) box.append(el('div', { class: 'dr-list' }, ...st.flows.map((w) => el('article', { class: 'dr-card' },
      el('div', { class: 'dr-h' }, el('b', {}, w.name), el('input', { type: 'checkbox', class: 'g-sw', 'aria-label': `Activer ${w.name}`, checked: w.active ? true : undefined, onchange: async (e) => { if (e.target.checked && !(await window.OdinDialog.confirm(`Activer « ${w.name} » ? Elle agira seule ensuite.`))) { e.target.checked = false; return; } const r = await api('/api/draupnir/toggle', { id: w.id, on: e.target.checked }); if (!r.ok) { e.target.checked = !e.target.checked; await window.OdinDialog.alert(r.error); } } })),
      el('div', { class: 'dr-steps' }, w.nodes.map((n) => n.label).join(' → ')),
      w.phrase || w.prochaineTexte ? el('div', { class: 'dr-steps' }, [w.phrase, w.active && w.prochaineTexte ? `Prochaine : ${w.prochaineTexte}` : ''].filter(Boolean).join(' · ')) : null,
      el('div', { class: 'dr-row' }, w.last ? el('span', { class: `pill ${w.last.status === 'succès' ? 'good' : w.last.status === 'erreur' ? 'bad' : ''}` }, `${w.last.status} · ${new Date(w.last.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`) : el('span', { class: 'pill' }, 'jamais lancée'), w.failed ? el('span', { class: 'pill bad' }, `${w.failed} échec(s)`) : null),
      el('div', { class: 'dr-row' }, el('button', { class: 'btn small primary', type: 'button', onclick: () => openFlow(w.id) }, 'Ouvrir'), el('button', { class: 'btn small', type: 'button', onclick: (e) => lancer(e.currentTarget, w) }, 'Lancer maintenant')), el('div', { class: 'dr-steps', role: 'status' }))))); else box.append(el('p', { class: 'sub' }, 'Aucune automatisation pour l\'instant.')); }
    // Tout ce qui tourne tout seul dans Odin (applis, tâches planifiées, rappels) : la même liste, sous les automatisations.
    if (window.OdinAutomatismes) { const zone = el('div', {}); box.append(zone); window.OdinAutomatismes.monter(zone); }
    box.append(el('section', { class: 'card', style: 'margin-bottom:16px' }, el('h2', { style: 'font-size:17px;margin:0 0 8px' }, 'Modèles prêts'), el('div', { class: 'dr-tpl' }, ...st.templates.map((t) => el('article', {}, el('b', {}, t.name), el('p', {}, t.what), el('button', { class: 'btn small', type: 'button', onclick: async (e) => { e.target.disabled = true; const r = await api('/api/draupnir/template', { id: t.id }); if (r.ok) ouvrirNeuve(r.flow.id); else { e.target.textContent = `✗ ${r.error}`; } } }, 'Utiliser'))))));
    box.append(el('details', { class: 'card' }, el('summary', { style: 'cursor:pointer;min-height:40px;display:flex;align-items:center;font-weight:600' }, 'Importer une automatisation n8n (JSON)'),
      el('form', { onsubmit: async (e) => { e.preventDefault(); const r = await api('/api/draupnir/import', { json: $('#drImp').value }); if (r.ok) { if (r.todo?.length) await window.OdinDialog.alert(`À revoir :\n${r.todo.join('\n')}`); ouvrirNeuve(r.flow.id); } else await window.OdinDialog.alert(r.error); } }, el('label', { for: 'drImp', class: 'sub' }, 'Colle le JSON exporté'), el('textarea', { id: 'drImp', style: 'width:100%;min-height:120px' }), el('button', { class: 'btn', type: 'submit' }, 'Importer'))));
  }
  /** « Faire un lien » : montré seulement quand Talos sait en faire (sinon la barre reste comme avant). */
  function lienBtn() {
    if (!window.OdinLien) return null;
    const b = el('button', { class: 'btn', type: 'button', hidden: true, onclick: () => window.OdinLien.ouvrir() }, 'Faire un lien');
    window.OdinLien.dispo().then((ok) => { b.hidden = !ok; });
    return b;
  }
  /** « Lancer maintenant » d'une carte : le résultat reste sous la carte (pastille, texte, durée). */
  async function lancer(btn, w) {
    const out = btn.closest('article')?.querySelector('[role=status]'); btn.disabled = true;
    const dit = (ok, texte, ms) => { if (out) out.replaceChildren(el('span', { class: `pill ${ok ? 'good' : 'bad'}` }, ok ? 'Réussi' : 'Échec'), ` ${texte ?? ''}${typeof ms === 'number' ? ` · ${ms} ms` : ''}`); };
    if (out) out.textContent = 'Lancement…';
    let r = await api('/api/draupnir/automatisme/lancer', { id: `flow:${w.id}` }).catch(() => ({}));
    if (r?.ok === undefined) {
      // Talos sans « Lancer maintenant » : on passe par le test d'avant.
      r = await api('/api/draupnir/run', { id: w.id }).catch((e) => ({ ok: false, error: e.message }));
      btn.disabled = false;
      if (r.ok) dit(r.run.status === 'succès', `${r.run.status}${r.run.error ? ` : ${r.run.error}` : ''}`, r.run.ms); else dit(false, r.error);
      return;
    }
    btn.disabled = false;
    if (r.ok) dit(r.resultat?.ok !== false, r.resultat?.texte, r.resultat?.ms); else dit(false, r.error);
  }
  function newFlow() { wf = { id: '', name: 'Nouvelle automatisation', active: false, nodes: [{ name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [60, 160] }], connections: {} }; outs = {}; last = null; passeSur = null; enregistree = null; seuls = new Set(); renommes = new Map(); retires = new Set(); dirty = true; editor(); }
  /**
   * Le dernier passage à la réouverture. L'historique (`runs`, le plus récent d'abord) garde aussi les blocs exécutés
   * seuls (leur exécution part d'un bloc qui n'est pas un déclencheur) : le dernier passage est le dernier lancé depuis
   * un déclencheur, et par-dessus, ce qu'ont rendu les blocs exécutés seuls depuis (marqués d'un rond), comme avant de
   * fermer. → { last, seuls }.
   */
  function dernierPassage(runs, flow, catDe) {
    // La marque `seul` (le nom du bloc) posée par le serveur ; une ligne d'avant, sans marque : partie d'un bloc qui
    // n'est pas un déclencheur.
    const seulDe = (x) => { if (typeof x?.seul === 'string' && x.seul) return x.seul; const n = x?.trigger ? flow?.nodes?.find((m) => m.name === x.trigger) : null; return n && !catDe(n.type)?.trigger ? n.name : null; };
    const liste = Array.isArray(runs) ? runs : [];
    const i = liste.findIndex((x) => !seulDe(x));
    const base = i >= 0 ? liste[i] : null, seuls = new Set(), nodes = { ...(base?.nodes ?? {}) };
    for (const x of (i >= 0 ? liste.slice(0, i) : liste).reverse()) { // du plus ancien au plus récent
      const nom = seulDe(x); if (!flow?.nodes?.some((m) => m.name === nom)) continue; // (bloc renommé ou retiré depuis)
      nodes[nom] = x.nodes?.[nom] ?? { count: 0, items: [], error: x.error || 'il n\'a pas tourné' }; seuls.add(nom);
    }
    // Enregistrée après ce passage (`updatedAt` plus récent que son départ) : les sorties d'un bloc ont pu changer (les cas
    // d'un aiguillage…) ; le nombre par sortie ne se dit plus (le total, lui, reste celui du passage).
    const change = Date.parse(flow?.updatedAt) > Date.parse(base?.startedAt);
    return { last: base || seuls.size ? { ...(base ?? {}), nodes, ...(change ? { sortiesDouteuses: true } : {}) } : null, seuls };
  }
  async function openFlow(id) {
    const r = await api(`/api/draupnir/flow?id=${encodeURIComponent(id)}`); if (!r.ok) { await window.OdinDialog.alert(r.error); return; }
    if (!st) st = await api('/api/draupnir/state');
    wf = r.flow; outs = r.outputs; ({ last, seuls } = dernierPassage(r.runs, wf, cat)); enregistree = copie(r.flow);
    // (pas enregistrée depuis le passage : elle a tourné telle quelle ; une date manquante ou illisible : on ne sait pas)
    passeSur = last && !last.sortiesDouteuses && Date.parse(r.flow?.updatedAt) <= Date.parse(last.startedAt) ? copie(r.flow) : null;
    renommes = new Map(); retires = new Set(); sel = null; dirty = false; editor(r);
  }
  /**
   * Une automatisation que le serveur vient de créer (« Créer avec Odin », un modèle, un import) : elle est déjà enregistrée,
   * en brouillon et sans dossier. On l'ouvre, puis on propose le même choix qu'au premier enregistrement (dossier, état) ;
   * « Annuler » la laisse telle quelle.
   */
  async function ouvrirNeuve(id) {
    await openFlow(id);
    const T = window.OdinTalosDossiers;
    if (!T || wf?.id !== id) return;
    const c = await T.choisir(wf);
    if (!c || wf?.id !== id) return;
    const s = $('#drSt');
    if (c.dossier) { const r = await api('/api/draupnir/ranger', { id, dossier: c.dossier }).catch((e) => ({ ok: false, error: e.message })); if (!r.ok) { if (s) s.textContent = `✗ ${r.error}`; return; } if (wf?.id === id) wf.dossier = c.dossier; }
    if (c.active) { const r = await api('/api/draupnir/toggle', { id, on: true }).catch((e) => ({ ok: false, error: e.message })); if (!r.ok) { if (s) s.textContent = `✗ ${r.error}`; return; } if (wf?.id === id) wf.active = true; }
    if (wf?.id !== id) return;
    $('#v-flows .dr-bar .td-barre')?.replaceWith(T.barre(wf, () => wf));
    if (s) s.textContent = c.active ? '✓ Enregistrée, active.' : '✓ Enregistrée en brouillon.';
  }
  // (les siennes seulement : un bloc nommé « constructor » ou « toString » n'hérite de rien)
  const outputsOf = (n) => (outs && Object.prototype.hasOwnProperty.call(outs, n.name) && Array.isArray(outs[n.name]) ? outs[n.name] : null) ?? cat(n.type)?.outputs ?? ['sortie'];
  function editor(r) {
    fermerPassage(); // (la bulle des données d'une autre automatisation)
    hist = { avant: [], apres: [], pose: etatEditeur(), cle: null }; // (une autre automatisation : historique vide)
    const box = $('#v-flows .body');
    $('#v-flows .head h1').textContent = wf.name; $('#v-flows .head .sub').textContent = 'Glisse les étapes ; relie-les en tirant un fil d\'une sortie (rond à droite) jusqu\'à une étape, ou en touchant la sortie puis l\'entrée (rond à gauche). Touche un fil pour le retirer ou y ajouter un bloc. Clique une étape pour la régler. Le « + » d\'une étape (ou un double-clic sur la fenêtre) ajoute un bloc. Clic droit, appui long ou « ⋯ » sur une étape : l\'exécuter seule, la renommer, la copier, y mettre une note, la retirer (double-clic sur son nom : la renommer). Ctrl+C puis Ctrl+V : copier et coller l\'étape choisie ; Ctrl+Z et Ctrl+Y, ou « Annuler » et « Refaire » : défaire ou refaire un geste ; + et − : zoomer.';
    const canvas = el('div', { class: 'dr-canvas', id: 'drCanvas', role: 'application', 'aria-label': 'Schéma de l\'automatisation' });
    const svg = sv('svg'); const world = el('div', { class: 'dr-world' }); canvas.append(svg, world);
    const side = el('aside', { class: 'dr-side', id: 'drSide', 'aria-label': 'Réglages' });
    const status = el('span', { class: 'sub', role: 'status', id: 'drSt' });
    box.replaceChildren(
      el('div', { class: 'dr-bar' }, el('button', { class: 'btn small', type: 'button', onclick: async () => { if (!dirty || await window.OdinDialog.confirm('Quitter sans enregistrer ?')) openList(); } }, '← Automatisations'), el('label', { for: 'drName', class: 'sr' }, 'Nom'), el('input', { id: 'drName', class: 'dr-name', value: wf.name, oninput: (e) => { wf.name = e.target.value; dirty = true; } }),
        wf.id && window.OdinTalosDossiers ? window.OdinTalosDossiers.barre(wf, () => wf) : null,
        // (les boutons et le message d'état : un groupe sur sa propre ligne ; au téléphone, une grille de trois colonnes)
        el('div', { class: 'dr-actions' },
        el('button', { class: 'btn small primary', type: 'button', onclick: save }, 'Enregistrer'), el('button', { class: 'btn small', type: 'button', onclick: () => test() }, 'Tester'), el('button', { class: 'btn small', type: 'button', onclick: () => { sel = null; drawSide(); } }, '+ Étape'),
        // (au doigt, pas de Ctrl+Z : deux boutons ; grisés quand il n'y a rien)
        el('button', { id: 'drUndo', class: 'btn small dr-hist', type: 'button', disabled: true, 'aria-keyshortcuts': 'Control+Z', title: 'Annuler (Ctrl+Z) : rien pour l\'instant', onclick: () => revenir(true) }, 'Annuler'),
        el('button', { id: 'drRedo', class: 'btn small dr-hist', type: 'button', disabled: true, 'aria-keyshortcuts': 'Control+Y Control+Shift+Z', title: 'Refaire (Ctrl+Y) : rien pour l\'instant', onclick: () => revenir(false) }, 'Refaire'),
        wf.id ? el('button', { class: 'btn small', type: 'button', onclick: async () => { if (!(await window.OdinDialog.confirm('Mettre cette automatisation à la corbeille ?', { danger: true }))) return; await api('/api/draupnir/trash', { id: wf.id }); openList(); } }, 'Corbeille') : null, status)),
      el('div', { class: 'dr-ed' }, canvas, side),
      // (Pas d'exécution ni de version quand on part de zéro : rien, et surtout pas le mot « null ».)
      ...(r ? [el('section', { class: 'card', style: 'margin-top:12px' }, el('h2', { style: 'font-size:16px;margin:0' }, 'Dernières exécutions'), r.runs.length ? el('ul', { class: 'dr-runs' }, ...r.runs.slice(0, 10).map((x) => { const net = /attente.*internet|internet.*attente|en-attente-internet/i.test(`${x.status} ${x.error ?? ''}`); const seul = typeof x.seul === 'string' && x.seul ? x.seul : ''; return el('li', {}, el('span', { class: `pill ${x.status === 'succès' ? 'good' : net ? '' : x.status === 'erreur' ? 'bad' : ''}` }, seul ? `bloc seul : ${seul}` : net ? 'en attente d\'Internet' : x.status), ` ${new Date(x.startedAt).toLocaleString('fr-FR')} · ${x.mode} · ${x.ms} ms${seul && x.status !== 'succès' && !net ? ` · ${x.status}` : ''}${net ?' · en attente du retour d\'Internet' : x.error ? ` · ${x.error}` : ''}`); })) : el('p', { class: 'sub' }, 'Jamais lancée.'),
        r.versions?.length ? el('details', {}, el('summary', { style: 'cursor:pointer;min-height:36px;display:flex;align-items:center' }, `Versions (${r.versions.length})`), el('ul', { class: 'dr-runs' }, ...r.versions.slice(0, 15).map((v) => el('li', {}, `${new Date(v.at).toLocaleString('fr-FR')} · ${v.nodes} étapes `, el('button', { class: 'btn small', type: 'button', onclick: async () => { if (!(await window.OdinDialog.confirm('Revenir à cette version ?'))) return; const x = await api('/api/draupnir/restore', { id: wf.id, at: v.at }); if (x.ok) openFlow(wf.id); } }, 'Restaurer'))))) : null)] : []));
    pan(canvas, world); draw(); drawSide();
    // Les blocs d'appli se dessinent avec l'icône et le nom de leur appli : on lit la liste des applis une fois.
    if (!applisFaite && wf.nodes.some((n) => n.type === 'module.action' || n.type === 'déclencheur.module')) { const w = wf; void chargerApplis().then(() => { if (wf === w) draw(); }); }
  }
  /** Les deux couleurs du rond d'un bloc : celles de son appli, celles de Talos pour ses propres blocs ; null si inconnues (l'accent). */
  function couleursDe(n, ia = infoAppli(n, applisListe)) {
    const c = window.OdinAppIcons?.couleurs?.(ia ? ia.a.id : 'draupnir');
    return Array.isArray(c) && c.length === 2 && c.every((x) => typeof x === 'string' && /^#[0-9a-f]{3,8}$/i.test(x)) ? c : null;
  }
  function nodeEl(n) {
    const c = cat(n.type), run = runDe(last, n.name);
    // Un bloc d'appli : l'icône et le nom de l'appli, puis sa fonction (ou ce qu'elle signale) en clair ; son nom s'il a été changé.
    const ia = infoAppli(n, applisListe), manque = ia?.f ? manquants(n, ia.f) : [];
    // (.dr-nom : là où se lit le nom du bloc ; un double-clic dessus le renomme)
    const nomAPart = ia && n.name !== ia.auto && n.name !== ia.titre;
    // Le bloc est un rond (croquis validé) : la couleur de son appli et son icône au centre, telle quelle ; un bloc de Talos
    // (Planning, Si, Attendre…) : un rond plein aux couleurs de Talos, sans icône (comme aujourd'hui : à lui de dire s'il en
    // veut une) ; l'horloge du déclencheur Planning ; dessous, le nom en gras puis l'appli et la fonction en petit.
    const teinte = couleursDe(n, ia);
    const rond = el('span', { class: 'dr-rond', 'aria-hidden': 'true', style: teinte ? `--dr-c0:${teinte[0]};--dr-c1:${teinte[1]}` : undefined },
      ia && window.OdinLien?.icone ? window.OdinLien.icone(ia.a, ICONE_ROND) : null,
      n.type === 'déclencheur.planning' ? el('span', { class: 'dr-horloge' }) : null);
    const tete = ia ? [el('b', { class: 'dr-nom' }, nomAPart ? n.name : ia.titre), el('small', {}, ia.a.nom, nomAPart ? ` · ${ia.titre}` : '')]
      : [el('b', { class: 'dr-nom' }, n.name), el('small', {}, c?.group ?? '?', ' · ', c?.label ?? n.type)];
    // Les réglages obligatoires vides : leur nombre, dans une pastille en haut à droite du rond (la liste est dans le panneau).
    const pastille = manque.length ? el('span', { class: 'dr-manque dr-rond-manque', 'aria-hidden': 'true' }, String(manque.length)) : null;
    // La note : une petite marque sur le bloc ; son texte décrit le bloc (lecteur d'écran) et se lit dans une bulle (bulle()).
    const aNote = typeof n.note === 'string' && n.note !== '', idNote = aNote ? `drnote-${wf.nodes.indexOf(n)}` : undefined;
    // Exécuté seul : un rond avec le nombre d'éléments rendus (« ! » en cas d'erreur), dit aussi au lecteur d'écran.
    const seul = run && seuls.has(n.name) ? (run.error ? `exécuté seul : erreur, ${run.error}` : `exécuté seul : ${run.count} élément(s)`) : '';
    // Après un test : une bulle avec le nombre d'éléments rendus (« ! » en cas d'erreur), à droite de la pastille, hors du
    // rond ; un vrai bouton (44 px, nommé) qui choisit le bloc et montre « Dernier passage ». Un bloc exécuté seul garde
    // son rond à la place (un seul nombre par bloc).
    const sorties = outputsOf(n), bu = seul ? null : bulleDe(n.name, run, last?.sortiesDouteuses ? [] : sorties);
    // Toucher la bulle ouvre aussi la bulle des données du passage, accrochée au bloc (la toucher de nouveau la referme) ;
    // le focus reste sur la bulle. Tab y entre, Échap la ferme.
    // Le rond d'un bloc exécuté seul fait de même : un vrai bouton (44 px à l'écran) posé sur le rond dessiné.
    const ouverte = passage?.nom === n.name;
    const ouvreur = (classe, nom, plus, ...kids) => el('button', { class: classe, type: 'button', title: nom, 'aria-label': nom, 'aria-haspopup': 'dialog', 'aria-expanded': ouverte ? 'true' : 'false', 'aria-controls': ouverte ? 'drPassage' : undefined, ...plus, onclick: (e) => {
      e.stopPropagation(); const etait = passage?.nom === n.name;
      sel = n.name; draw(); drawSide();
      if (etait) fermerPassage(); else ouvrirPassage(n.name);
      const b = boutonPassage(n.name); // (le bloc est redessiné : le focus va sur le bouton neuf)
      try { b?.focus?.({ preventScroll: true }); } catch { b?.focus?.(); }
    }, onkeydown: (e) => {
      if (passage?.nom !== n.name) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermerPassage(true); }
      else if (e.key === 'Tab' && !e.shiftKey) { const x = passage.boite.querySelector('.dr-ps-x'); if (x) { e.preventDefault(); x.focus?.(); } }
    } }, ...kids);
    const bulleBtn = bu ? ouvreur(`dr-bulle${bu.erreur ? ' bad' : ''}`, bu.nom, { style: `--dr-sh:${hautPremiereSortie(sorties.length)}px` }, el('span', { 'aria-hidden': 'true' }, bu.texte)) : null;
    const seulBtn = seul ? ouvreur('dr-seul-b', run.error ? mot('seul.erreur', { b: n.name, e: String(run.error).slice(0, 160) }) : mot('seul.elements', { b: n.name, n: nombre(Number(run.count) || 0), s: unSeul(Number(run.count) || 0) ? '' : mot('bulle.pluriel') }), {}) : null;
    const d = el('div', { class: `dr-node${c?.trigger ? ' trig' : ''}${n.type === TYPE_FILTRE ? ' dr-filtre' : ''}${n.disabled ? ' off' : ''}${sel === n.name ? ' sel' : ''}${run ? (run.error ? ' err' : ' ok') : ''}`, tabindex: '0', role: 'button', 'aria-label': `${ia ? `${ia.a.nom} : ${ia.titre} (${n.name})` : `${n.name} (${c?.label ?? n.type})`}${seul ? `, ${seul}` : ''}`, 'aria-describedby': idNote, style: `left:${n.position?.[0] ?? 0}px;top:${yDessin(n.position?.[1])}px` },
      rond, ...tete, run ? el('span', { class: 'dr-cnt' }, run.error ? `✗ ${run.error.slice(0, 40)}` : `${run.count} élément(s)`) : null, pastille,
      aNote ? el('span', { class: 'dr-note-m', 'aria-hidden': 'true' }) : null, aNote ? el('span', { class: 'sr', id: idNote }, `Note : ${n.note}`) : null,
      seulBtn, seul ? el('span', { class: `dr-seul${run.error ? ' bad' : ''}`, 'aria-hidden': 'true' }, run.error ? '!' : String(run.count)) : null, bulleBtn);
    // Le bouton « ⋯ » : le menu du bloc. Zone de 44 px à l'écran (comme les ronds), au milieu du bord haut, loin des ronds, et au-dessus du bloc : même dézoomé, le corps du bloc reste à toucher (choisir, glisser).
    // Un toucher dessus ouvre le menu (pointerup plus bas) ; un geste parti de lui fait glisser le bloc, comme partout sur le bloc.
    const mb = el('button', { class: 'dr-mb', type: 'button', title: 'Menu du bloc', 'aria-haspopup': 'menu', 'aria-label': `Menu de ${n.name}`, onclick: (e) => {
      e.stopPropagation(); if (e.detail) return; // (souris, doigt : déjà ouvert au lever ; ici, le clavier)
      ouvrirParBouton();
    } }, el('span', { 'aria-hidden': 'true' }, '⋯'));
    const ouvrirParBouton = () => { const b = mb.getBoundingClientRect?.(), r = $('#drCanvas')?.getBoundingClientRect?.(); menuBloc(n.name, b && r && b.width ? [b.left - r.left, b.top + b.height - r.top] : coinBloc(n)); };
    d.append(mb);
    // Les ronds : la zone touchable fait 44 px à l'écran quel que soit le zoom (--dr-z) ; le rond dessiné fait 12 px
    // (::before), centré en (25, 48) pour l'entrée, en x 195 pour une sortie (à mi-hauteur du rond, décalé par styleSortie). Entrée touchée sans sortie armée : comme toucher le bloc (sa zone mord sur le bloc).
    if (!c?.trigger) d.append(el('button', { class: 'dr-port in', type: 'button', 'aria-label': `Entrée de ${n.name}`, onclick: (e) => { e.stopPropagation(); if (armed) { link(armed.node, armed.out, n.name); armed = null; draw(); } else { sel = n.name; draw(); drawSide(); } } }));
    // Plusieurs sorties : leurs ronds s'empilent, centrés sur le milieu du rond, à droite du « + » ; les zones de deux
    // sorties voisines se partagent l'écart (le rond le plus proche l'emporte).
    // Une sortie : un toucher l'arme (puis un toucher sur une entrée relie), ou on en TIRE un fil jusqu'à un bloc.
    sorties.forEach((o, i, all) => { const b = el('button', { class: `dr-port out${armed && armed.node === n.name && armed.out === i ? ' armed' : ''}`, type: 'button', style: styleSortie(i, all.length), 'aria-label': `Sortie ${o} de ${n.name}`, onclick: (e) => { e.stopPropagation(); if (e.timeStamp - tireFin < 500) return; armed = armed && armed.node === n.name && armed.out === i ? null : { node: n.name, out: i }; draw(); } }, all.length > 1 ? el('span', { class: 'dr-pl' }, o, bu?.sorties[i] ? el('span', { class: 'dr-pn', 'aria-hidden': 'true' }, String(bu.sorties[i].n)) : null) : null); tirable(b, n, i); d.append(b); });
    // Le « + » du côté de la sortie : un bloc de plus, posé à droite et relié à celui-ci.
    d.append(el('button', { class: 'dr-plus', type: 'button', title: 'Ajouter un bloc à la suite', 'aria-label': `Ajouter un bloc après ${n.name}`, onclick: (e) => { e.stopPropagation(); void ouvrirChoix({ de: { node: n.name, out: sortieDuPlus(wf, n.name, sorties.length) } }); } }, el('span', { 'aria-hidden': 'true' }, '+')));
    let start = null, long = 0;
    const finLong = () => { if (long) clearTimeout(long); long = 0; };
    d.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.dr-port') || e.target.closest('.dr-plus') || e.target.closest('.dr-renom-z') || e.target.closest('.dr-bulle') || e.target.closest('.dr-seul-b')) return; // (la bulle, le rond « seul » reçoivent leur clic)
      if (e.button > 0) return; // (le clic droit ne fait pas glisser le bloc : il ouvre son menu)
      e.stopPropagation(); d.setPointerCapture(e.pointerId); start = { x: e.clientX, y: e.clientY, p: [...(n.position ?? [0, 0])], moved: false, nom: Boolean(e.target.closest('.dr-nom')), menu: Boolean(e.target.closest('.dr-mb')) };
      // Au doigt : un appui long (sans bouger) ouvre le menu du bloc, au lieu de le choisir.
      finLong();
      if (e.pointerType === 'touch' || e.pointerType === 'pen') long = setTimeout(() => { long = 0; if (!start || start.moved) return; start = null; const r = $('#drCanvas')?.getBoundingClientRect?.() ?? { left: 0, top: 0 }; menuBloc(n.name, [e.clientX - r.left, e.clientY - r.top], true); }, APPUI_LONG);
    });
    d.addEventListener('pointermove', (e) => { if (!start) return; const dx = (e.clientX - start.x) / view.k, dy = (e.clientY - start.y) / view.k; if (Math.abs(dx) + Math.abs(dy) > 3) { start.moved = true; finLong(); } n.position = [Math.round(start.p[0] + dx), yEnregistre(yDessin(start.p[1]) + dy)]; d.style.left = `${n.position[0]}px`; d.style.top = `${yDessin(n.position[1])}px`; lines(); });
    // Un toucher parti d'un rond ou du « + » n'est pas un clic sur le bloc : on ne redessine pas (le bouton doit recevoir son clic).
    // Deux touchers rapprochés sur le NOM du bloc : on le renomme.
    d.addEventListener('pointerup', (e) => {
      finLong(); if (!start) return;
      if (start.moved) { dirty = true; start = null; noter(`déplacer « ${n.name} »`); return; }
      if (start.menu) { start = null; tapNom = null; ouvrirParBouton(); return; }
      const t = { t: e.timeStamp, x: e.clientX, y: e.clientY, bloc: n.name }, surNom = start.nom; start = null;
      if (surNom && tapNom?.bloc === n.name && estDoubleTouche(tapNom, t)) { tapNom = null; commencerRenommer(n.name); return; }
      tapNom = surNom ? t : null;
      sel = n.name; draw(); drawSide();
    });
    d.addEventListener('pointercancel', () => { finLong(); start = null; });
    // Le clic droit sur le bloc : son menu, à la place de celui du navigateur (le champ du nom garde celui du navigateur).
    d.addEventListener('contextmenu', (e) => {
      if (e.target?.closest?.('.dr-renom-z')) return;
      e.preventDefault(); e.stopPropagation?.();
      if (menuFil?.bloc === n.name) return; // (après un appui long, le navigateur du téléphone l'envoie aussi : un seul menu)
      finLong(); start = null;
      const r = $('#drCanvas')?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      menuBloc(n.name, e.clientX || e.clientY ? [e.clientX - r.left, e.clientY - r.top] : coinBloc(n));
    });
    // La bulle de la note : au survol (souris) et au focus du bloc.
    d.addEventListener('pointerenter', (e) => { if (e.pointerType && e.pointerType !== 'mouse') return; survol = n.name; bulle(); });
    d.addEventListener('pointerleave', () => { if (survol === n.name) { survol = null; bulle(); } });
    d.addEventListener('focusin', (e) => { if (e.target === d) { survol = n.name; bulle(); } });
    d.addEventListener('focusout', (e) => { if (e.target === d && survol === n.name) { survol = null; bulle(); } });
    // Entrée sur un bouton du bloc (rond, « + ») appartient à ce bouton. La touche Menu (ou Maj+F10) ouvre le menu du bloc.
    d.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menuFil?.bloc === n.name) { e.preventDefault(); fermerMenu(true); return; } // (focus resté sur le bloc, après un toucher)
      if (e.target !== d) return;
      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); menuBloc(n.name, coinBloc(n)); return; }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sel = n.name; draw(); drawSide(); } if (e.key === 'Delete') removeNode(n.name);
    });
    return d;
  }
  function link(from, out, to) { if (relier(wf, from, out, to)) { dirty = true; noter(`relier « ${from} » à « ${to} »`); } }
  /** Le point (en coordonnées du schéma) sous le pointeur. */
  const sousPointeur = (e) => { const r = $('#drCanvas')?.getBoundingClientRect?.() ?? { left: 0, top: 0 }; return [(e.clientX - r.left - view.x) / view.k, (e.clientY - r.top - view.y) / view.k]; };
  // Fil tiré : depuis une sortie, le fil suit le pointeur ; lâché sur un bloc, le lien se pose (mêmes refus que les deux
  // touchers) ; lâché ailleurs, rien ne change. Un geste de moins de 6 px reste un toucher (il arme la sortie).
  let tireFin = -Infinity;
  function tirable(b, n, out) {
    let g = null;
    const fin = () => { g = null; $('#drCanvas svg .dr-tire')?.remove(); for (const d of elems.values()) d.classList.remove('dr-cible'); };
    const cible = (e) => {
      // (la cible : le bloc, élargi de son rond d'entrée, dont une moitié dépasse à gauche)
      const nom = blocSous([...elems].map(([name, d]) => {
        const r = d.getBoundingClientRect(), p = d.querySelector('.dr-port.in')?.getBoundingClientRect?.();
        const left = p?.width ? Math.min(r.left, p.left) : r.left, top = p?.height ? Math.min(r.top, p.top) : r.top;
        const right = p?.width ? Math.max(r.left + r.width, p.left + p.width) : r.left + r.width, bottom = p?.height ? Math.max(r.top + r.height, p.top + p.height) : r.top + r.height;
        return { name, left, top, width: right - left, height: bottom - top };
      }), e.clientX, e.clientY);
      const m = nom ? wf.nodes.find((x) => x.name === nom) : null;
      return m ? { nom, refus: refusLien(wf, n.name, out, nom, Boolean(cat(m.type)?.trigger)) } : null;
    };
    b.addEventListener('pointerdown', (e) => { if (e.button > 0) return; e.stopPropagation(); fermerMenu(); g = { x: e.clientX, y: e.clientY, moved: false }; b.setPointerCapture?.(e.pointerId); });
    b.addEventListener('pointermove', (e) => {
      if (!g) return;
      if (!g.moved && Math.abs(e.clientX - g.x) + Math.abs(e.clientY - g.y) < 6) return;
      g.moved = true;
      const svg = $('#drCanvas svg'); if (!svg) return;
      const [x1, y1] = departLien(n.position, out, outputsOf(n).length), [x2, y2] = sousPointeur(e), dx = Math.max(30, Math.abs(x2 - x1) / 2);
      let p = svg.querySelector('.dr-tire');
      if (!p) { p = sv('path', { class: 'dr-tire' }); svg.append(p); }
      p.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
      p.setAttribute('d', `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`);
      const c = cible(e);
      for (const [nom, d] of elems) d.classList.toggle('dr-cible', Boolean(c && !c.refus && c.nom === nom));
    });
    b.addEventListener('pointerup', (e) => {
      if (!g) return;
      const bouge = g.moved; fin();
      if (!bouge) return; // un simple toucher : le clic arme la sortie, comme avant
      tireFin = e.timeStamp;
      const c = cible(e), s = $('#drSt');
      if (!c) return; // lâché ailleurs : rien ne change
      if (c.refus) { if (s) s.textContent = `Pas de lien : ${c.refus}`; return; }
      link(n.name, out, c.nom); armed = null; draw();
      if (s) s.textContent = `✓ « ${n.name} » relié à « ${c.nom} ».`;
    });
    b.addEventListener('pointercancel', fin);
  }
  // ---------------- Le petit menu d'un fil : « Retirer ce lien », « Ajouter un bloc ici ». Échap ou un toucher ailleurs le referme.
  let menuFil = null, glisse = false; // (glisse : un glissement du schéma parti d'un fil vient de finir ; le prochain appui l'efface)
  const cleFil = (f) => JSON.stringify([f.de, f.out, f.vers]);
  function fermerMenu(rendre = false) {
    if (!menuFil) return;
    const { boite, dehors, retour } = menuFil; menuFil = null;
    boite.remove(); document.removeEventListener?.('pointerdown', dehors, true);
    $('#drCanvas svg .dr-fil.on')?.classList.remove('on');
    if (rendre) retour?.()?.focus?.();
  }
  /** Ouvre le menu du fil `fil` ({ de, out, vers }) au point [x, y] de la fenêtre du schéma. */
  function ouvrirMenu(fil, point, zone) {
    menuDe({ label: `Lien ${fil.de} → ${fil.vers}`, point, zone, retour: () => [...($('#drCanvas svg')?.querySelectorAll('.dr-fil') ?? [])].find((x) => x.getAttribute('data-cle') === cleFil(fil)), choix: [
      ['Retirer ce lien', async () => { if (!(await window.OdinDialog.confirm(`Retirer le lien ${fil.de} → ${fil.vers} ?`))) return; if (retirerLien(wf, fil.de, fil.out, fil.vers)) { dirty = true; noter(`détacher « ${fil.de} » de « ${fil.vers} »`); draw(); } }],
      ['Ajouter un bloc ici', () => void ouvrirChoix({ milieu: fil })]] });
  }
  /**
   * Le menu d'un bloc (clic droit, appui long, « ⋯ », touche Menu) : Exécuter ce bloc seul, Renommer, Copier, Ajouter / Modifier la note, Retirer.
   * Même dessin et mêmes gestes que celui d'un fil ; Échap rend le focus au bloc.
   */
  function menuBloc(nom, point, auDoigt = false) {
    const n = wf?.nodes.find((x) => x.name === nom); if (!n) return;
    menuDe({ label: `Bloc ${nom}`, point, bloc: nom, auDoigt, retour: () => elems.get(nom), choix: [
      ['Exécuter ce bloc seul', () => void executerSeul(nom)],
      ['Renommer', () => commencerRenommer(nom)],
      ['Copier', () => copierBloc(nom)],
      [typeof n.note === 'string' && n.note !== '' ? 'Modifier la note' : 'Ajouter une note', () => ouvrirNote(nom)],
      ['Retirer', () => removeNode(nom)]] });
  }
  /** Le point (dans la fenêtre du schéma) sous le « ⋯ » d'un bloc : où s'ouvre son menu au clavier. */
  const coinBloc = (n) => [((n.position?.[0] ?? 0) + NODE_W - 70) * view.k + view.x, (yDessin(n.position?.[1]) + 22) * view.k + view.y];
  function menuDe({ label, point: [x, y], zone, retour, choix: items, bloc, auDoigt = false }) {
    fermerMenu(); fermerPassage();
    const canvas = $('#drCanvas'); if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    // Le bas : celui du schéma, ou plus haut s'il passe sous la barre du bas de l'écran (téléphone) ; rien ne défile
    // (au doigt, faire défiler pendant l'appui long amènerait un choix sous le doigt levé).
    const nav = document.querySelector('.bnav')?.getBoundingClientRect?.(), vue = typeof window.innerHeight === 'number' ? Math.min(window.innerHeight, nav?.height ? nav.top : window.innerHeight) - r.top : Infinity;
    const gauche = r.width ? Math.max(8, Math.min(x, r.width - 216)) : x, haut = r.height ? Math.max(8, Math.min(y, Math.min(r.height, vue) - 20 - 46 * items.length)) : y;
    // Menu ouvert par l'appui long : un clic de pointeur ne compte que s'il a commencé sur le menu ouvert ; le doigt levé
    // après l'appui long ne choisit rien, même s'il tombe sur un choix. Le clavier (detail 0) choisit. Ouvert autrement
    // (souris, clavier, « ⋯ », un fil), tout clic compte : un clic simulé sans appui (aide technique) choisit aussi.
    let appuiDedans = !auDoigt;
    const action = (f) => (e) => { if (e?.detail && !appuiDedans) return; fermerMenu(true); f(); };
    const boite = el('div', { class: 'dr-fil-menu', role: 'menu', 'aria-label': label, style: `left:${Math.round(gauche)}px;top:${Math.round(haut)}px` },
      ...items.map(([t, f]) => el('button', { type: 'button', role: 'menuitem', onclick: action(f) }, t)));
    boite.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermerMenu(true); } });
    boite.addEventListener('pointerdown', () => { appuiDedans = true; });
    // (la touche Menu, ou un clic droit, sur le menu lui-même : pas de menu du navigateur par-dessus)
    boite.addEventListener('contextmenu', (e) => e.preventDefault());
    // Sortir du menu par Tab le referme. (Un focus perdu sans destination — un clic sur un choix, selon le navigateur — ne le ferme pas.)
    // Au doigt, le navigateur donne le focus au bloc touché (ou à son « ⋯ ») APRÈS l'ouverture du menu : ce n'est pas en sortir.
    boite.addEventListener('focusout', (e) => { const vers = e.relatedTarget; if (vers && vers.closest?.('.dr-fil-menu') !== boite && !(bloc && vers.closest?.('.dr-node') === elems.get(bloc)) && menuFil?.boite === boite) fermerMenu(); });
    fleches(boite);
    const dehors = (e) => { if (!e.target?.closest?.('.dr-fil-menu')) fermerMenu(); };
    menuFil = { boite, dehors, retour, bloc };
    zone?.classList.add('on');
    canvas.append(boite);
    document.addEventListener('pointerdown', dehors, true);
    boite.querySelector('button')?.focus?.({ preventScroll: true });
  }
  // ---------------- Renommer sur place, la note d'un bloc et sa bulle.
  let tapNom = null, survol = null; // (le dernier toucher sur le nom d'un bloc ; le bloc survolé ou qui a le focus)
  const dire = (t) => { const s = $('#drSt'); if (s) s.textContent = t; };
  /** Le nom se modifie sur le bloc : Entrée valide, Échap annule, quitter le champ valide (un nom refusé ne change rien). */
  function commencerRenommer(nom) {
    const d = elems.get(nom); if (!d || !wf.nodes.some((x) => x.name === nom)) return;
    fermerMenu();
    const place = d.querySelector('.dr-nom');
    const err = el('small', { class: 'dr-renom-e', id: 'drRenomE', role: 'alert', hidden: true });
    const inp = el('input', { class: 'dr-renom', type: 'text', value: nom, 'aria-label': `Nouveau nom de l'étape « ${nom} »`, 'aria-describedby': 'drRenomE', spellcheck: 'false', autocomplete: 'off', enterkeyhint: 'done' });
    const zone = el('span', { class: 'dr-renom-z' }, inp, err);
    zone.style.top = `${Math.max(0, (place?.offsetTop ?? 22) - 4)}px`;
    place?.classList.add('dr-cache');
    let fini = false;
    const valider = (rester) => {
      if (fini) return;
      const n = wf.nodes.find((x) => x.name === nom), v = n ? nomPossible(n, inp.value) : nomValide(wf, nom, inp.value);
      if (n && !v.ok && rester) { err.textContent = v.error; err.hidden = false; inp.setAttribute('aria-invalid', 'true'); inp.focus?.(); return; }
      fini = true;
      if (!n || !v.ok) { draw(); if (v.error) dire(`Nom inchangé : ${v.error}`); return; }
      if (v.nom === nom) draw(); else { rename(n, v.nom); dire(`✓ « ${nom} » renommé « ${v.nom} ».`); }
      if (sel === v.nom) drawSide();
      if (rester) elems.get(v.nom)?.focus?.();
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation?.();
      if (e.key === 'Enter') { e.preventDefault(); valider(true); }
      else if (e.key === 'Escape') { e.preventDefault(); fini = true; draw(); elems.get(nom)?.focus?.(); }
    });
    inp.addEventListener('focusout', () => valider(false));
    d.append(zone);
    // Le champ garde une taille d'écran lisible (--dr-ik) : s'il dépasse de la fenêtre du schéma, il se décale vers l'intérieur.
    const c = $('#drCanvas')?.getBoundingClientRect?.(), z = zone.getBoundingClientRect?.();
    if (c?.width && z?.width) { const dx = z.right > c.right - 6 ? z.right - c.right + 6 : z.left < c.left + 6 ? z.left - c.left - 6 : 0; if (dx) zone.style.left = `${Math.round(4 - dx / (view.k || 1))}px`; }
    try { inp.focus?.({ preventScroll: true }); } catch { inp.focus?.(); }
    inp.select?.();
  }
  /** La note d'un bloc : une fenêtre avec son texte ; « Enregistrer la note », « Retirer la note », « Annuler » (ou Échap). */
  function ouvrirNote(nom) {
    const n = wf?.nodes.find((x) => x.name === nom); if (!n) return;
    fermerChoix(); fermerMenu();
    const avant = typeof n.note === 'string' ? n.note : '';
    const finir = (texte) => {
      fermerChoix();
      const m = wf.nodes.find((x) => x.name === nom);
      if (texte !== null && m && poserNote(m, texte)) { dirty = true; noter(`note de « ${nom} »`); draw(); dire(m.note ? `✓ Note de « ${nom} » enregistrée.` : `✓ Note de « ${nom} » retirée.`); }
      elems.get(nom)?.focus?.();
    };
    const ta = el('textarea', { id: 'drNoteT', spellcheck: 'true' }, avant);
    const boite = el('div', { class: 'dr-choix dr-note-ed', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'drNoteH' },
      el('div', { class: 'dr-ch-h' }, el('h2', { id: 'drNoteH' }, `Note de « ${nom} »`), el('button', { class: 'dr-ch-x', type: 'button', 'aria-label': 'Fermer', onclick: () => finir(null) }, '×')),
      el('div', { class: 'dr-ch-c' }, el('label', { for: 'drNoteT' }, 'Ta note sur ce bloc (elle ne change rien à ce qu\'il fait)'), ta,
        el('div', { class: 'dr-row' }, el('button', { class: 'btn primary', type: 'button', onclick: () => finir(ta.value) }, 'Enregistrer la note'),
          avant ? el('button', { class: 'btn', type: 'button', onclick: () => finir('') }, 'Retirer la note') : null,
          el('button', { class: 'btn', type: 'button', onclick: () => finir(null) }, 'Annuler'))));
    const fond = el('div', { class: 'dr-choix-fond', onclick: (e) => { if (e.target === fond) finir(null); } }, boite);
    boite.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finir(null); return; }
      if (e.key !== 'Tab') return; // Tab et Maj+Tab tournent dans la fenêtre
      const f = [...boite.querySelectorAll('button, textarea')], premier = f[0], dernier = f[f.length - 1];
      if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); } else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
    });
    choix = { fond, retour: null };
    document.body.append(fond);
    ta.focus?.();
  }
  /** La bulle de la note du bloc survolé (ou qui a le focus, sinon du bloc choisi) : au-dessus de lui, à taille d'écran. */
  function bulle() {
    const canvas = $('#drCanvas'); if (!canvas) return;
    const aNote = (x) => { const t = wf?.nodes.find((m) => m.name === x)?.note; return typeof t === 'string' && t !== ''; };
    const nom = survol && aNote(survol) ? survol : sel, n = nom && wf ? wf.nodes.find((x) => x.name === nom) : null, d = nom ? elems.get(nom) : null;
    let b = canvas.querySelector('.dr-note-bulle');
    if (!n || !d || typeof n.note !== 'string' || !n.note) { b?.remove(); return; }
    if (!b) { b = el('div', { class: 'dr-note-bulle', 'aria-hidden': 'true' }); canvas.append(b); }
    b.textContent = n.note;
    const c = canvas.getBoundingClientRect(), r = d.getBoundingClientRect(), w = Math.min(260, Math.max(120, (c.width || 276) - 16));
    b.style.maxWidth = `${w}px`;
    const h = b.offsetHeight || 0, haut = r.top - c.top - h - 8;
    b.style.left = `${Math.round(Math.max(8, Math.min(r.left - c.left, (c.width || 0) - w - 8)))}px`;
    b.style.top = `${Math.round(haut >= 4 ? haut : r.top - c.top + r.height + 8)}px`;
  }
  // ---------------- La bulle des données d'un passage : accrochée au bloc, dans la fenêtre du schéma. Les données y sont
  // écrites comme du texte (jamais comme du code de page) ; elles restent dans la page (ni presse-papiers, ni journal).
  // Elle se ferme par Échap, par son bouton « × » (le focus revient sur la bulle du bloc) ou en touchant ailleurs.
  /** Ce qu'un bloc a reçu au dernier passage, seulement quand cela se déduit sûrement ; sinon null. */
  function entreeSure(nom) {
    if (!passeSur || !pareilQuEnregistre(wf, passeSur) || seuls.has(nom) || last?.sortiesDouteuses) return null;
    // (un bloc d'avant exécuté seul depuis : ses données ne sont plus celles qu'il a données à ce bloc)
    for (const [de, t] of Object.entries(wf.connections ?? {})) if ((t ?? []).some((l) => (l ?? []).some((x) => x?.node === nom)) && seuls.has(de)) return null;
    const e = entreeSeul(wf, nom, last, cat);
    return e.ok ? e : null;
  }
  /** Le bouton du bloc `nom` qui ouvre la bulle des données : sa bulle chiffrée, ou son rond « exécuté seul ». */
  const boutonPassage = (nom) => elems.get(nom)?.querySelector('.dr-bulle') ?? elems.get(nom)?.querySelector('.dr-seul-b') ?? null;
  function fermerPassage(rendre = false) {
    if (!passage) return;
    const { nom, boite, dehors } = passage; passage = null;
    boite.remove(); document.removeEventListener?.('pointerdown', dehors, true);
    const b = boutonPassage(nom);
    b?.setAttribute('aria-expanded', 'false'); b?.removeAttribute?.('aria-controls');
    if (rendre) (b ?? elems.get(nom))?.focus?.();
  }
  function ouvrirPassage(nom) {
    fermerPassage(); fermerMenu();
    const canvas = $('#drCanvas'); if (!canvas || !wf?.nodes.some((x) => x.name === nom)) return;
    const boite = el('div', { class: 'dr-passage', id: 'drPassage', role: 'dialog', 'aria-modal': 'false' });
    boite.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermerPassage(true); return; }
      // Maj+Tab depuis le premier bouton : retour sur le bouton du bloc (sa bulle ou son rond).
      if (e.key === 'Tab' && e.shiftKey && e.target === boite.querySelector('.dr-ps-x')) { const b = passage ? boutonPassage(passage.nom) : null; if (b) { e.preventDefault(); b.focus?.(); } }
    });
    // (la molette fait défiler la bulle, sans zoomer le schéma)
    boite.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    const dehors = (e) => {
      const t = e.target;
      if (t?.closest?.('.dr-passage')) return;
      // (son propre bouton : son clic la referme)
      const bu = t?.closest?.('.dr-bulle') ?? t?.closest?.('.dr-seul-b'); if (bu && passage && bu.closest?.('.dr-node') === elems.get(passage.nom)) return;
      fermerPassage();
    };
    passage = { nom, boite, dehors, run: undefined };
    canvas.append(boite);
    document.addEventListener('pointerdown', dehors, true);
    peindrePassage();
  }
  /**
   * Le contenu de la bulle d'après le passage d'aujourd'hui (redessinée quand le schéma l'est). Redessinée pour le même
   * passage, elle garde le focus (même bouton, même zone), « Ce qu'il a reçu » ouvert ou non et l'endroit où l'on lisait ;
   * un nouveau passage la remet en haut, « Ce qu'il a reçu » replié (le focus, lui, reste dans la bulle).
   */
  function peindrePassage() {
    if (!passage) return;
    const n = wf?.nodes.find((x) => x.name === passage.nom); if (!n) { fermerPassage(); return; }
    const run = runDe(last, n.name), c = cat(n.type);
    const avant = passage.boite, actif = document.activeElement, memeRun = passage.run === run;
    const focusDedans = Boolean(actif && actif.closest?.('.dr-passage') === avant);
    const ou = !focusDedans ? null : actif.closest?.('.dr-ps-x') ? 'x' : actif.closest?.('summary') ? 'recu' : 'zone';
    const ouvert = memeRun && Boolean(avant.querySelector('.dr-ps-recu')?.open), defile = memeRun ? Number(avant.querySelector('.dr-ps-c')?.scrollTop) || 0 : 0;
    passage.run = run;
    const p = passageDe(run, { sorties: last?.sortiesDouteuses ? [] : outputsOf(n), declencheur: Boolean(c?.trigger), entree: run && !c?.trigger ? entreeSure(n.name) : null });
    const liste = (items, label) => el('ol', { class: 'dr-ps-l', 'aria-label': label }, ...items.map((it) => el('li', {}, el('b', {}, it.titre), el('pre', {}, it.texte, it.coupe ? mot('donnees.coupe') : ''))));
    const corps = p.vide ? [el('p', { class: 'dr-ps-m' }, p.texte)] : [
      el('p', { class: 'dr-ps-r' }, [p.resume, p.duree].filter(Boolean).join(' · ')),
      ...(p.erreur ? [el('h3', {}, mot('donnees.erreur')), el('pre', { class: 'dr-ps-e' }, p.erreur)] : []),
      ...(p.elements.length ? [el('h3', {}, mot('donnees.rendu')), p.garde ? el('p', { class: 'dr-ps-m' }, p.garde) : null, liste(p.elements, mot('donnees.rendu'))] : p.rien ? [el('h3', {}, mot('donnees.rendu')), el('p', { class: 'dr-ps-m' }, p.rien)] : []),
      ...(p.entree.montree ? [el('details', { class: 'dr-ps-recu', open: ouvert, ontoggle: () => placerPassage() }, el('summary', {}, mot('donnees.recu')), el('p', { class: 'dr-ps-m' }, p.entree.mention), liste(p.entree.elements, mot('donnees.recu')))]
        : [el('h3', {}, mot('donnees.recu')), el('p', { class: 'dr-ps-m' }, p.entree.mention)]),
    ];
    const nomDialogue = mot('donnees.dialogue', { b: n.name }), fermer = mot('donnees.fermer', { b: n.name });
    avant.setAttribute('aria-label', nomDialogue);
    const zone = el('div', { class: 'dr-ps-c', tabindex: '0', role: 'group', 'aria-label': nomDialogue }, ...corps);
    avant.replaceChildren(
      el('div', { class: 'dr-ps-h' }, el('h2', { id: 'drPassageT' }, n.name), el('button', { class: 'dr-ps-x', type: 'button', title: fermer, 'aria-label': fermer, onclick: () => fermerPassage(true) }, el('span', { 'aria-hidden': 'true' }, '×'))),
      // (la zone qui défile se choisit au clavier : les flèches la font défiler)
      zone);
    const b = boutonPassage(n.name);
    b?.setAttribute('aria-expanded', 'true'); b?.setAttribute('aria-controls', 'drPassage');
    placerPassage();
    if (defile) zone.scrollTop = defile;
    if (ou) { const f = (ou === 'x' && avant.querySelector('.dr-ps-x')) || (ou === 'recu' && avant.querySelector('.dr-ps-recu summary')) || zone; try { f.focus?.({ preventScroll: true }); } catch { f.focus?.(); } }
  }
  /** Accroche la bulle à la bulle chiffrée du bloc (sinon à son rond « exécuté seul », sinon à son rond) ; elle reste dans la fenêtre du schéma. */
  function placerPassage() {
    if (!passage) return;
    const canvas = $('#drCanvas'), d = elems.get(passage.nom), boite = passage.boite;
    const c = canvas?.getBoundingClientRect?.(), cible = d?.querySelector('.dr-bulle') ?? d?.querySelector('.dr-seul') ?? d?.querySelector('.dr-rond') ?? d, r = cible?.getBoundingClientRect?.();
    if (!c?.width || !r) return; // (pas encore dessinée)
    // La partie de la fenêtre du schéma qui se voit à l'écran : ni sous le bas de l'écran, ni sous la barre du bas du
    // téléphone, ni au-dessus du haut de l'écran (la page a défilé) ; c'est là que la bulle se pose.
    const nav = document.querySelector?.('.bnav')?.getBoundingClientRect?.(), H = typeof window.innerHeight === 'number' && window.innerHeight > 0 ? window.innerHeight : Infinity;
    const y0 = Math.max(0, -c.top), y1 = Math.max(y0, Math.min(c.height, Math.min(H, nav?.height ? nav.top : H) - c.top));
    boite.style.maxHeight = `${Math.max(0, y1 - y0 - 16)}px`;
    const bw = 340, bh = boite.offsetHeight || 0;
    const pl = placeDonnees(c.width, y1 - y0, { x: r.left + r.width / 2 - c.left, h: r.top - c.top - y0, b: r.top + r.height - c.top - y0 }, bw, bh);
    pl.top += y0;
    // (la fenêtre du schéma a pu défiler toute seule, quand le focus va sur un bloc hors de vue : on compte ce décalage)
    const sx = Number(canvas.scrollLeft) || 0, sy = Number(canvas.scrollTop) || 0;
    boite.style.width = `${Math.round(pl.largeur)}px`; boite.style.left = `${Math.round(pl.left + sx)}px`; boite.style.top = `${Math.round(pl.top + sy)}px`;
    boite.style.maxHeight = `${Math.round(pl.hmax)}px`; boite.style.setProperty?.('--dr-pointe', `${Math.round(pl.pointe)}px`);
    for (const s of ['bas', 'haut', 'libre']) boite.classList.toggle(s, s === pl.sens);
  }
  /** Le point de la fenêtre (en coordonnées du schéma) où poser un bloc centré sous [px, py] (pixels dans la fenêtre). */
  const pointSchema = (px, py) => [Math.round((px - view.x) / view.k - NODE_W / 2), yEnregistre((py - view.y) / view.k - MI_ROND)];
  function draw() {
    const world = $('#drCanvas .dr-world'); if (!world) return;
    fermerMenu(); // (le schéma change : le fil du menu peut ne plus exister)
    survol = null; // (les blocs sont refaits : celui qui était survolé ou avait le focus n'existe plus ; la bulle suit le bloc choisi)
    // Un bloc qui n'est plus dans le schéma (retiré, ou défait par « Annuler ») oublie son dernier passage : un bloc posé
    // plus tard sous le même nom n'a pas tourné et n'en hérite pas (ni bulle, ni ligne de résultat, ni « Dernier passage »).
    if (last?.nodes) for (const nom of Object.keys(last.nodes)) if (!wf.nodes.some((x) => x.name === nom)) { delete last.nodes[nom]; seuls.delete(nom); }
    elems = new Map();
    world.replaceChildren(...wf.nodes.map((n) => { const d = nodeEl(n); elems.set(n.name, d); return d; })); lines();
    // La bulle des données suit son bloc (redessinée avec son passage d'aujourd'hui) ; son bloc parti, elle se ferme.
    if (passage) { if (wf.nodes.some((x) => x.name === passage.nom) && passage.boite.isConnected !== false) peindrePassage(); else fermerPassage(); }
    // Fenêtre vide : un grand « + » au centre, pour le premier bloc.
    const canvas = $('#drCanvas'); canvas.querySelector('.dr-vide')?.remove();
    if (!wf.nodes.length) canvas.append(el('div', { class: 'dr-vide' }, el('button', { type: 'button', class: 'dr-vide-plus', 'aria-label': 'Ajouter le premier bloc', onclick: () => { const r = canvas.getBoundingClientRect(); void ouvrirChoix({ a: r.width ? pointSchema(r.width / 2, r.height / 2) : [60, 160] }); } }, '+'), el('p', {}, 'Ajoute le premier bloc : ce qui fait partir l\'automatisation.')));
  }
  function lines() {
    const svg = $('#drCanvas svg'); if (!svg) return; svg.replaceChildren();
    const g = sv('g', { transform: `translate(${view.x} ${view.y}) scale(${view.k})` }); svg.append(g);
    let nGrad = 0;
    const teinte = (n) => couleursDe(n)?.[1] ?? 'var(--accent)', noms = [];
    // Un « Filtrer » : le trait de la liaison passe à travers son petit rond (de son rond d'entrée à son rond de sortie).
    for (const n of wf.nodes) if (n.type === TYPE_FILTRE) {
      const [x1, y1] = arriveeLien(n.position), [x2, y2] = departLien(n.position);
      g.append(sv('path', { class: 'dr-link dr-traverse', d: `M${x1},${y1} L${x2},${y2}`, style: `stroke:${teinte(n)}` }));
    }
    for (const [from, list] of Object.entries(wf.connections)) {
      const a = wf.nodes.find((n) => n.name === from); if (!a) continue;
      list.forEach((targets, i) => (targets ?? []).forEach((l) => {
        const b = wf.nodes.find((n) => n.name === l.node); if (!b) return;
        const [x1, y1] = departLien(a.position, i, outputsOf(a).length), [x2, y2] = arriveeLien(b.position), dx = Math.max(40, Math.abs(x2 - x1) / 2);
        const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
        // La liaison en petits ronds, de la couleur du bloc de départ à celle du bloc d'arrivée (l'accent si elle est inconnue).
        const id = `drg-${nGrad++}`;
        const grad = sv('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1, y1, x2, y2 });
        grad.append(sv('stop', { offset: '0', style: `stop-color:${teinte(a)}` }), sv('stop', { offset: '1', style: `stop-color:${teinte(b)}` }));
        // Le fil dessiné, et par-dessus une zone large et invisible qui se touche (et se choisit au clavier) : elle ouvre le menu du fil.
        const fil = { de: from, out: i, vers: l.node }, so = outputsOf(a).length > 1 ? outputsOf(a)[i] ?? '' : '';
        const z = sv('path', { class: 'dr-fil', d, tabindex: '0', role: 'button', 'aria-haspopup': 'menu', 'data-de': from, 'data-vers': l.node, 'data-cle': cleFil(fil), 'aria-label': `Lien ${from} → ${l.node}${so ? ` (sortie ${so})` : ''}` });
        z.addEventListener('click', (e) => { if (glisse) return; const r = $('#drCanvas').getBoundingClientRect(); ouvrirMenu(fil, [e.clientX - r.left, e.clientY - r.top], z); });
        z.addEventListener('keydown', (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; e.preventDefault(); ouvrirMenu(fil, [(x1 + x2) / 2 * view.k + view.x, (y1 + y2) / 2 * view.k + view.y], z); });
        g.append(grad, sv('path', { class: 'dr-link', d, stroke: `url(#${id})` }), z);
        // Le nom de la sortie, au milieu de la liaison (le lien le dit déjà au lecteur d'écran) ; posé après toutes les liaisons.
        if (so && SORTIES_NOMMEES.includes(a.type)) { const [mx, my] = milieuLien(x1, y1, x2, y2), t = sv('text', { class: 'dr-fil-nom', x: mx, y: my, 'aria-hidden': 'true' }); t.textContent = so; noms.push(t); }
      }));
    }
    g.append(...noms);
    bulle(); // (le schéma a bougé : la bulle d'une note suit son bloc)
    placerPassage(); // (et la bulle des données aussi)
  }
  function pan(canvas, world) {
    // (--dr-z, --dr-zf : les zones de toucher des ronds et des fils gardent 44 et 22 px à l'écran, même dézoomé)
    const apply = () => { world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`; canvas.style.setProperty?.('--dr-z', `${zoneToucher(view.k)}px`); canvas.style.setProperty?.('--dr-zf', `${zoneToucher(view.k, 22)}px`); canvas.style.setProperty?.('--dr-ik', String(Math.max(1, 1 / (view.k || 1)))); lines(); };
    let s = null;
    // Cadrage : tout le schéma visible à l'ouverture.
    requestAnimationFrame(() => {
      const r = canvas.getBoundingClientRect(); if (!wf.nodes.length || !r.width) return;
      // (en places dessinées : l'écart vertical est agrandi à l'écran ; un bloc fait au plus HAUT_TESTE de haut)
      const xs = wf.nodes.map((n) => n.position[0]), ys = wf.nodes.map((n) => yDessin(n.position[1]));
      const x0 = Math.min(...xs) - 30, x1 = Math.max(...xs) + NODE_W + 30, y0 = Math.min(...ys) - 30, y1 = Math.max(...ys) + HAUT_TESTE + 20;
      view.k = Math.min(1.1, Math.max(0.4, Math.min(r.width / (x1 - x0), r.height / (y1 - y0))));
      view.x = (r.width - (x1 - x0) * view.k) / 2 - x0 * view.k; view.y = (r.height - (y1 - y0) * view.k) / 2 - y0 * view.k; apply();
    });
    // Un geste parti d'un fil fait aussi glisser le schéma, mais seulement au-delà de 6 px : en deçà, rien n'est
    // redessiné ni capturé, et le clic qui suit ouvre le menu du fil. Après un glissement, ce clic n'ouvre rien.
    canvas.addEventListener('pointerdown', (e) => {
      if (e.target !== canvas && !e.target.closest('svg')) return;
      const fil = Boolean(e.target.closest('.dr-fil'));
      s = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, fil, id: e.pointerId };
      if (fil) return;
      canvas.setPointerCapture(e.pointerId); if (armed) { armed = null; draw(); }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!s) return;
      if (Math.abs(e.clientX - s.x) + Math.abs(e.clientY - s.y) > 6 && !s.moved) { s.moved = true; if (s.fil) { fermerMenu(); canvas.setPointerCapture?.(s.id); } }
      if (s.fil && !s.moved) return;
      view.x = s.vx + e.clientX - s.x; view.y = s.vy + e.clientY - s.y; apply();
    });
    canvas.addEventListener('pointercancel', () => { s = null; });
    // Double-clic (ou double toucher) sur un endroit vide : la même fenêtre que le « + », le bloc se pose là.
    let tap = null;
    canvas.addEventListener('pointerup', (e) => {
      glisse = Boolean(s?.fil && s.moved);
      const t = s && !s.moved && !s.fil ? { t: e.timeStamp, x: e.clientX, y: e.clientY } : null; s = null;
      if (!t) { tap = null; return; }
      if (!estDoubleTouche(tap, t)) { tap = t; return; }
      tap = null; const r = canvas.getBoundingClientRect(); void ouvrirChoix({ a: pointSchema(t.x - r.left, t.y - r.top) });
    });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); fermerMenu(); const r = canvas.getBoundingClientRect(); Object.assign(view, zoomer(view, e.deltaY < 0 ? 1.1 : 0.9, e.clientX - r.left, e.clientY - r.top)); apply(); }, { passive: false });
    appliquerVue = apply; apply();
  }
  async function removeNode(name) {
    if (!(await window.OdinDialog.confirm(`Retirer l'étape « ${name} » ?`))) return;
    wf.nodes = wf.nodes.filter((n) => n.name !== name); delete wf.connections[name]; retires.add(name);
    for (const list of Object.values(wf.connections)) for (const t of list) for (let i = t.length - 1; i >= 0; i--) if (t[i].node === name) t.splice(i, 1);
    sel = null; dirty = true; noter(`retirer « ${name} »`); draw(); drawSide();
  }
  function drawSide() {
    const side = $('#drSide'); if (!side) return;
    fermerDonnees(); for (const d of elems.values()) d.classList.remove('dr-source'); // (le panneau change : sa liste et ses pastilles partent)
    const n = wf.nodes.find((x) => x.name === sel);
    if (!n) {
      const groups = [...new Set(st.catalog.map((c) => c.group))];
      side.replaceChildren(el('h2', {}, 'Ajouter une étape'), el('p', { class: 'sub', style: 'margin:0' }, 'Clique une étape pour l\'ajouter, puis relie-la.'), el('div', { class: 'dr-cat' }, ...groups.flatMap((g) => [el('h3', {}, g), ...st.catalog.filter((c) => c.group === g).map((c) => el('button', { type: 'button', title: c.what, onclick: () => addNode(c) }, c.label))])));
      return;
    }
    const c = cat(n.type), run = runDe(last, n.name);
    // Bloc d'appli : l'appli et sa fonction en clair (avec « Changer ») et les réglages en champs, au lieu de les taper.
    // Applis pas encore lues : on attend ; appli ou fonction introuvable : les champs d'avant restent.
    const blocAppli = n.type === 'module.action' || n.type === 'déclencheur.module';
    if (blocAppli && !applisFaite && window.OdinLien?.applis) {
      const w = wf; void chargerApplis().then(() => { if (wf === w && sel === n.name) { draw(); drawSide(); } });
      side.replaceChildren(el('h2', {}, c?.label ?? n.type), el('p', { class: 'sub', role: 'status' }, 'Chargement de l\'appli…'));
      return;
    }
    const ia = blocAppli ? infoAppli(n, applisListe) : null;
    const cache = ia ? (n.type === 'module.action' ? ['module', 'action', 'entrée'] : ['module', 'événement']) : [];
    // Planning : seul le champ du mode choisi se montre (un nœud sans mode garde son planning cron, comme avant).
    const planning = c?.type === 'déclencheur.planning' && (c.params ?? []).some((p) => p.key === 'mode'), mode = planning ? n.params.mode ?? 'cron' : undefined;
    const fields = (c?.params ?? []).filter((p) => !cache.includes(p.key)).map((p) => {
      if (planning && ((p.key === 'cron' && mode !== 'cron') || (p.key === 'minutes' && mode !== 'intervalle') || (p.kind === 'rythme' && mode !== 'simple'))) return [];
      const id = `drp-${p.key}`, v = planning && p.key === 'mode' ? mode : n.params[p.key] ?? p.default ?? '';
      const set = (val) => { n.params[p.key] = val; dirty = true; noter(`régler « ${n.name} »`, `${n.name}\u0000${p.key}`); if (planning && p.key === 'mode') drawSide(); };
      if (p.kind === 'rythme') {
        // Le rythme en clair ; l'éditeur donne la valeur de départ tout de suite : ce n'est pas une modification.
        const setR = (val) => { const avant = n.params[p.key] ?? p.default; if (JSON.stringify(val) === JSON.stringify(avant)) { if (n.params[p.key] === undefined) { n.params[p.key] = val; rebaser(); } return; } set(val); };
        const input = window.OdinRythme ? window.OdinRythme.editeur({ valeur: v && typeof v === 'object' ? v : undefined, onChange: setR })
          : el('textarea', { id, spellcheck: 'false', oninput: (e) => { try { setR(JSON.parse(e.target.value)); } catch { /* pas encore un JSON */ } } }, JSON.stringify(v, null, 2));
        return [el('label', { for: id }, p.label, p.required ? ' *' : ''), input, p.help ? el('small', { class: 'sub' }, p.help) : null];
      }
      // Un texte (une ligne ou plusieurs) : un champ à pastilles, où l'on peut poser une donnée d'un bloc d'avant.
      if ((p.kind === undefined || p.kind === 'text' || p.kind === 'textarea') && typeof v === 'string') {
        const s = saisie({ id, valeur: v, multi: p.kind === 'textarea', nom: n.name, label: p.label, donnees: !c?.trigger, attrs: { 'aria-required': p.required ? 'true' : undefined }, onChange: set });
        return [el('label', { for: id, id: `${id}-lab`, onclick: () => document.getElementById(id)?.focus?.() }, p.label, p.required ? ' *' : ''), s.boite, p.help ? el('small', { class: 'sub' }, p.help) : null];
      }
      const input = p.kind === 'select' ? el('select', { id, onchange: (e) => set(e.target.value) }, ...(p.options ?? []).map((o) => el('option', { selected: o === v ? true : undefined }, o)))
        : p.kind === 'boolean' ? el('input', { id, type: 'checkbox', checked: v === true ? true : undefined, onchange: (e) => set(e.target.checked) })
        : p.kind === 'textarea' || p.kind === 'json' ? el('textarea', { id, oninput: (e) => set(e.target.value), spellcheck: 'false' }, typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v))
        : el('input', { id, type: p.kind === 'number' ? 'number' : 'text', value: String(v), oninput: (e) => set(p.kind === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value), spellcheck: 'false', autocomplete: 'off' });
      return [el('label', { for: id }, p.label, p.required ? ' *' : ''), input, p.help ? el('small', { class: 'sub' }, p.help) : null];
    });
    side.replaceChildren(el('h2', {}, c?.label ?? n.type), el('p', { class: 'sub', style: 'margin:0' }, c?.what ?? ''),
      el('label', { for: 'drNn' }, 'Nom de l\'étape'), el('input', { id: 'drNn', value: n.name, onchange: (e) => { const r = rename(n, e.target.value); if (!r.ok) { e.target.value = n.name; void window.OdinDialog.alert(r.error); } } }),
      ...(ia ? panneauAppli(n, ia) : []),
      ...fields.flat().filter(Boolean), // (un réglage sans aide donnait null, écrit « null » à l'écran)
      el('label', { class: 'va-chk', style: 'display:flex;gap:8px;align-items:center;font-weight:500' }, el('input', { type: 'checkbox', checked: n.disabled ? true : undefined, onchange: (e) => { n.disabled = e.target.checked || undefined; dirty = true; noter(e.target.checked ? `désactiver « ${n.name} »` : `réactiver « ${n.name} »`); draw(); } }), 'Désactiver cette étape'),
      el('p', { class: 'sub', style: 'margin:0;font-size:13px' }, '« Données » à côté d\'un champ : y poser une donnée d\'un bloc d\'avant. Expressions : {{ $json.champ }}, {{ $node["Étape"].json.champ }}, {{ $now }}.'),
      el('div', { class: 'dr-row' }, el('button', { class: 'btn small', type: 'button', onclick: () => test(n.name) }, 'Tester jusqu\'ici'), el('button', { class: 'btn small', type: 'button', onclick: () => removeNode(n.name) }, 'Retirer'), el('button', { class: 'btn small', type: 'button', onclick: () => { sel = null; draw(); drawSide(); } }, 'Fermer')),
      ...(run ? [el('h2', { style: 'margin-top:6px' }, 'Dernier passage'), el('pre', { class: 'dr-out' }, run.error ? `✗ ${run.error}` : JSON.stringify(run.items.slice(0, 5), null, 2))] : []));
  }
  // ---------------- Le panneau d'un bloc d'appli : l'appli et sa fonction en clair, puis un champ par réglage déclaré.
  function panneauAppli(n, ia) {
    const L = window.OdinLien;
    const tete = el('div', { class: 'dr-app' }, L?.icone ? L.icone(ia.a, 32) : null, el('div', {}, el('b', {}, ia.a.nom), el('span', { class: 'dr-fn' }, ia.titre)),
      el('button', { class: 'btn small', type: 'button', 'aria-label': `Changer l'appli ou la fonction de ${n.name}`, onclick: () => void ouvrirChoix({ remplace: n.name }) }, 'Changer'));
    if (!ia.f) {
      // Déclencheur d'appli : « Changer » propose ce qu'elle déclare signaler ; tout autre événement (ou une
      // expression) se tape encore à la main, comme avant, derrière « Réglages avancés ».
      const ev = n.params['événement'] ?? '', connu = ev === '' || ev === 'alerte' || (ia.a.evenements ?? []).includes(ev);
      const inp = el('input', { id: 'drp-evenement', value: String(ev), spellcheck: 'false', autocomplete: 'off',
        oninput: (e) => { n.params['événement'] = e.target.value; dirty = true; noter(`régler « ${n.name} »`, `${n.name}\u0000événement`); },
        // (le panneau n'est pas redessiné : le focus reste dans le champ ; seuls le titre et le bloc suivent)
        onchange: () => { const t = infoAppli(n, applisListe)?.titre, s = tete.querySelector('.dr-fn'); if (t && s) s.textContent = t; draw(); } });
      const avE = el('details', { class: 'dr-av', open: connu ? undefined : true }, el('summary', {}, 'Réglages avancés'),
        el('label', { for: 'drp-evenement' }, 'Événement (vide : tout ce qu\'elle signale ; une expression {{ … }} est permise)'), inp);
      return [tete, avE];
    }
    const f = ia.f, zone = el('div', { class: 'dr-champs' });
    const brut = () => { const r = n.params['entrée']; return r && typeof r === 'object' ? JSON.stringify(r, null, 2) : String(r ?? ''); };
    // Le JSON d'avant, derrière « Réglages avancés » : tout ce qu'on pouvait régler reste réglable.
    const ta = el('textarea', { id: 'drp-entree', spellcheck: 'false', oninput: (e) => { n.params['entrée'] = e.target.value; dirty = true; noter(`régler « ${n.name} »`, `${n.name}\u0000entrée`); }, onchange: () => { peindre(); draw(); } });
    const av = el('details', { class: 'dr-av' }, el('summary', {}, 'Réglages avancés'), el('label', { for: 'drp-entree' }, 'Les réglages en JSON (une expression {{ … }} est permise)'), ta);
    let manquait = manquants(n, f).length > 0;
    function peindre() {
      ta.value = brut();
      const l = lireEntree(n.params['entrée']), kids = [];
      if (!l.ok) {
        kids.push(el('p', { class: 'sub', style: 'margin:0' }, 'Ces réglages sont écrits d\'une façon que les champs ne savent pas montrer (une expression, par exemple) : ils se règlent dans « Réglages avancés ».'));
        av.setAttribute('open', '');
      } else if (!(f.params ?? []).length) kids.push(el('p', { class: 'sub', style: 'margin:0' }, 'Cette fonction ne déclare pas de réglage.'));
      else {
        champsDe(f, l.valeurs).forEach((c, i) => kids.push(...champ(c, i).filter(Boolean))); // (une aide absente donnait null, écrit « null »)
        const connus = new Set((f.params ?? []).map((p) => p.key)), plus = Object.keys(l.valeurs).filter((k) => !connus.has(k));
        if (plus.length) kids.push(el('p', { class: 'sub', style: 'margin:6px 0 0' }, `Réglages en plus, dans « Réglages avancés » : ${plus.join(', ')}.`));
      }
      zone.replaceChildren(...kids);
    }
    function champ(c, i) {
      const { p } = c, id = `drf-${i}`, aide = p.help ? `${id}-aide` : undefined;
      const manque = el('small', { class: 'dr-manque', id: `${id}-manque`, hidden: c.manque ? undefined : true }, 'Obligatoire : ce champ est vide.');
      const set = (val) => {
        n.params['entrée'] = ecrireEntree(n.params['entrée'], p.key, val); dirty = true; noter(`régler « ${n.name} »`, `${n.name}\u0000entrée\u0000${p.key}`); ta.value = brut();
        manque.hidden = !(p.required && vide(val));
        const m = manquants(n, f).length > 0; if (m !== manquait) { manquait = m; draw(); }
      };
      const lab = el('label', { for: id, id: `${id}-lab` }, p.label, p.required ? ' *' : '');
      const attrs = { id, 'aria-required': p.required ? 'true' : undefined, 'aria-describedby': [aide, `${id}-manque`].filter(Boolean).join(' ') };
      const defaut = p.default === undefined || p.default === '' ? '' : ` (par défaut : ${typeof p.default === 'boolean' ? (p.default ? 'oui' : 'non') : String(p.default)})`;
      let input;
      if (c.sorte === 'avance') return [lab, el('p', { class: 'sub', style: 'margin:0' }, 'Réglé dans « Réglages avancés ».'), p.help ? el('small', { class: 'sub', id: aide }, p.help) : null];
      if (c.sorte === 'ouinon' || c.sorte === 'liste') {
        const opts = c.sorte === 'ouinon' ? [['oui', 'Oui'], ['non', 'Non']] : (p.options ?? []).map((o) => [o, o]);
        const cur = c.sorte === 'ouinon' ? (c.valeur === true ? 'oui' : c.valeur === false ? 'non' : '') : c.valeur ?? '';
        input = el('select', { ...attrs, onchange: (e) => set(valeurChamp(c.sorte, e.target.value)) }, el('option', { value: '', selected: cur === '' ? true : undefined }, `—${defaut}`), ...opts.map(([v, t]) => el('option', { value: v, selected: v === cur ? true : undefined }, t)));
      } else if (c.sorte === 'texte' || c.sorte === 'nombre' || c.sorte === 'long') {
        // Un champ à pastilles : on y tape, ou on y pose une donnée d'un bloc d'avant (« Données »).
        lab.addEventListener('click', () => document.getElementById(id)?.focus?.());
        const s = saisie({ id, valeur: c.valeur === undefined ? '' : String(c.valeur), multi: c.sorte === 'long', nom: n.name, label: p.label, placeholder: defaut ? defaut.slice(2, -1) : undefined,
          dansJson: !(n.params['entrée'] && typeof n.params['entrée'] === 'object'), attrs: { ...attrs, inputmode: c.sorte === 'nombre' ? 'decimal' : undefined }, onChange: (t) => set(valeurChamp(c.sorte, t)) });
        return [lab, s.boite, p.help ? el('small', { class: 'sub', id: aide }, p.help) : null, manque];
      } else input = el('input', { ...attrs, type: 'password', value: c.valeur === undefined ? '' : String(c.valeur), placeholder: defaut ? defaut.slice(2, -1) : undefined, autocomplete: 'new-password', spellcheck: 'false', oninput: (e) => set(valeurChamp(c.sorte, e.target.value)) }); // (un mot de passe : sans pastille)
      return [lab, input, p.help ? el('small', { class: 'sub', id: aide }, p.help) : null, manque];
    }
    peindre();
    return [tete, zone, av];
  }
  // ---------------- Les champs à pastilles : un réglage où l'on pose une donnée d'un bloc d'avant. Le champ reste un texte
  // qu'on tape ; une donnée y est une pastille (le bloc et la donnée) qui garde, telle quelle, l'expression qu'elle montre.
  // Ce qui est enregistré : le texte et ces expressions, rien d'autre (lireSaisie).
  let renommes = new Map(), retires = new Set(), listeDn = null;
  const pointDe = new WeakMap(); // la dernière place du curseur dans chaque champ
  /** Le bloc d'origine d'une pastille s'illumine sur le schéma (au survol, au focus). */
  function allumer(bloc, on) { elems.get(bloc)?.classList.toggle('dr-source', on); }
  /** Le contenu d'un champ remis en texte : le texte tel quel, chaque pastille par son expression. */
  function lireSaisie(champ, multi) {
    let s = '';
    const kids = [...(champ.childNodes ?? [])];
    kids.forEach((k, i) => {
      if (k.nodeType === 3) s += k.nodeValue ?? '';
      else if (k.nodeType !== 1) return;
      else if (k.classList?.contains('dr-pastille')) s += k.getAttribute('data-src') ?? '';
      else if (k.tagName === 'BR') { if (multi && i < kids.length - 1) s += '\n'; } // (le dernier : celui que le navigateur ajoute)
      else { if (multi && s && !s.endsWith('\n')) s += '\n'; s += lireSaisie(k, multi); }
    });
    return s;
  }
  const apercu = (v) => { const t = v === null || v === undefined ? 'vide' : Array.isArray(v) ? `liste de ${v.length}` : typeof v === 'object' ? JSON.stringify(v) : String(v); return t.length > 60 ? `${t.slice(0, 59)}…` : t; };
  function pastilleEl(d, nom, dansJson, retiree) {
    let e = etatDonnee(d, wf, nom, renommes, retires);
    // Dans des réglages rangés en texte JSON, des guillemets doubles sont échappés : le moteur lirait vide.
    if (e.ok && dansJson && d.src.includes('"')) e = { ok: false, raison: 'Dans ces réglages, les guillemets doubles de cette donnée sont échappés : elle sera vide. Retire-la et pose-la de nouveau avec « Données ».' };
    const nomD = `${d.bloc} · ${libelleChemin(d.chemin)}`;
    const p = el('span', { class: `dr-pastille${e.ok ? '' : ' bad'}`, contenteditable: 'false', 'data-src': d.src, 'data-bloc': d.bloc, 'data-raison': e.ok ? undefined : e.raison, title: e.ok ? `Donnée de « ${d.bloc} » : ${libelleChemin(d.chemin)}` : e.raison },
      e.ok ? null : el('span', { class: 'dr-p-a', 'aria-hidden': 'true' }, '!'), el('span', { class: 'dr-p-t' }, nomD),
      el('button', { type: 'button', class: 'dr-p-x', 'aria-label': `Retirer la donnée ${nomD}${e.ok ? '' : ` (${e.raison})`}`, onmousedown: (ev) => ev.preventDefault(),
        onclick: (ev) => { ev.preventDefault(); ev.stopPropagation(); allumer(d.bloc, false); p.remove(); retiree(); } }, '×'));
    const on = () => allumer(d.bloc, true), off = () => allumer(d.bloc, false);
    p.addEventListener('pointerenter', on); p.addEventListener('pointerleave', off); p.addEventListener('focusin', on); p.addEventListener('focusout', off);
    return p;
  }
  /** Pose un nœud à la place du curseur dans le champ (jamais dans une pastille), sinon à la fin. */
  function poserNoeud(champ, k) {
    const s = window.getSelection?.(), vif = s?.rangeCount ? s.getRangeAt(0) : null, garde = pointDe.get(champ);
    let r = vif && champ.contains(vif.startContainer) ? vif : garde && champ.contains(garde.startContainer) ? garde.cloneRange() : null;
    if (!r) { champ.append(k); return; }
    const dans = (x) => (x?.nodeType === 3 ? x.parentNode : x)?.closest?.('.dr-pastille');
    const p = dans(r.startContainer) || dans(r.endContainer);
    if (p && champ.contains(p)) { r.setStartAfter(p); r.collapse(true); } else r.deleteContents();
    r.insertNode(k); r.setStartAfter(k); r.collapse(true);
    try { champ.focus?.({ preventScroll: true }); s?.removeAllRanges(); s?.addRange(r); } catch { /* rien */ }
    pointDe.set(champ, r.cloneRange());
  }
  /** La pastille juste avant (ou après) le curseur : Retour arrière (ou Suppr) la retire comme un caractère. */
  function pastilleVoisine(champ, avant) {
    const s = window.getSelection?.(); if (!s?.rangeCount || !s.isCollapsed) return null;
    const n = s.anchorNode, o = s.anchorOffset; if (!n || !champ.contains(n)) return null;
    let k;
    if (n.nodeType === 3) { if (avant ? o > 0 : o < (n.nodeValue ?? '').length) return null; k = avant ? n.previousSibling : n.nextSibling; } else k = avant ? n.childNodes[o - 1] : n.childNodes[o];
    return k?.nodeType === 1 && k.classList?.contains('dr-pastille') ? k : null;
  }
  /**
   * Un champ de réglage à pastilles : { boite, champ }. `valeur` : le texte enregistré (montré tel quel, ses données en
   * pastilles) ; `onChange(texte)` seulement quand on y touche. `dansJson` : le réglage est rangé dans un texte JSON
   * (les réglages d'une appli). `donnees` false : pas de bouton « Données » (un déclencheur n'a rien avant lui).
   */
  function saisie({ id, valeur, multi = false, nom, dansJson = false, label, attrs = {}, placeholder, donnees = true, onChange }) {
    const champ = el('div', { ...attrs, id, class: `dr-saisie${multi ? ' multi' : ''}`, role: 'textbox', contenteditable: 'plaintext-only', 'aria-multiline': multi ? 'true' : 'false', spellcheck: 'false', autocapitalize: 'off', 'data-placeholder': placeholder,
      // (un <label for> ne nomme pas un div : le nom vient du libellé par son id ; le texte d'exemple, dit aussi)
      'aria-labelledby': `${id}-lab`, 'aria-placeholder': placeholder,
      'aria-describedby': [attrs['aria-describedby'], `${id}-dn`].filter(Boolean).join(' ') });
    const alerte = el('small', { class: 'dr-manque', id: `${id}-dn`, hidden: true });
    const bouton = donnees ? el('button', { type: 'button', class: 'btn small dr-df-b', 'aria-expanded': 'false', 'aria-controls': `${id}-liste`, title: 'Prendre une donnée d\'un bloc d\'avant', 'aria-label': `Prendre une donnée d'un bloc d'avant pour « ${label} »` }, 'Données') : null;
    const zone = el('div', {});
    const boite = el('div', { class: 'dr-df' }, el('div', { class: 'dr-df-l' }, champ, bouton), alerte, zone);
    const verifier = () => { const r = [...new Set([...champ.querySelectorAll('.dr-pastille.bad')].map((x) => x.getAttribute('data-raison')))]; alerte.textContent = r.join(' '); alerte.hidden = !r.length; };
    const change = () => { onChange(lireSaisie(champ, multi)); verifier(); };
    const ctx = { champ, bouton, zone, nom, dansJson, label, change };
    ctx.pastille = (d) => pastilleEl(d, nom, dansJson, () => { change(); champ.focus?.(); });
    for (const m of decouper(valeur)) champ.append(m.src ? ctx.pastille(m) : m.texte);
    verifier();
    const garder = () => { const s = window.getSelection?.(); if (s?.rangeCount) { const r = s.getRangeAt(0); if (champ.contains(r.startContainer)) pointDe.set(champ, r.cloneRange()); } };
    for (const t of ['keyup', 'pointerup', 'focusout']) champ.addEventListener(t, garder);
    champ.addEventListener('input', () => { garder(); change(); });
    champ.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !multi) { e.preventDefault(); return; }
      if (e.key === 'Escape' && listeDn?.champ === champ) { e.preventDefault(); e.stopPropagation(); fermerDonnees(); return; }
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      const p = pastilleVoisine(champ, e.key === 'Backspace');
      if (p) { e.preventDefault(); allumer(p.getAttribute('data-bloc'), false); p.remove(); change(); }
    });
    // Coller : seulement du texte (et sur une ligne, pour un champ d'une ligne).
    champ.addEventListener('paste', (e) => {
      const t = e.clipboardData?.getData?.('text/plain'); if (typeof t !== 'string') return;
      e.preventDefault(); const u = multi ? t.replace(/\r\n?/g, '\n') : t.replace(/\r?\n/g, ' ');
      if (!document.execCommand?.('insertText', false, u)) { poserNoeud(champ, document.createTextNode(u)); change(); }
    });
    if (bouton) {
      bouton.addEventListener('click', () => { if (listeDn?.champ === champ) fermerDonnees(true); else ouvrirDonnees(ctx, true); });
      // Un clic dans le champ ouvre aussi la liste (sous le champ, sans prendre le focus : on peut continuer à taper).
      champ.addEventListener('click', (e) => { if (e.target?.closest?.('.dr-p-x')) return; if (listeDn?.champ !== champ && blocsAvant(wf, nom).length) ouvrirDonnees(ctx, false); });
    }
    return { boite, champ };
  }
  function fermerDonnees(rendre = false) {
    if (!listeDn) return;
    const { champ, bouton, boite } = listeDn; listeDn = null;
    boite.remove(); bouton?.setAttribute('aria-expanded', 'false');
    if (rendre) champ.focus?.();
  }
  /** La liste des données des blocs d'avant, sous le champ : rangée par bloc ; une donnée touchée s'y pose en pastille. */
  function ouvrirDonnees(ctx, focusListe) {
    fermerDonnees();
    const { champ, bouton, zone, nom, dansJson, label } = ctx, avant = blocsAvant(wf, nom);
    const p = (t) => el('p', { class: 'sub', style: 'margin:0;font-size:13px' }, t);
    const kids = [el('div', { class: 'dr-dn-h' }, el('h3', { id: `${champ.id}-liste-t` }, 'Données des blocs d\'avant'), el('button', { type: 'button', class: 'btn small', onclick: () => fermerDonnees(true) }, 'Fermer'))];
    if (!avant.length) kids.push(p('Aucun bloc n\'est relié avant celui-ci : relie un bloc à son entrée pour prendre ses données.'));
    else kids.push(p(`Touche une donnée pour la poser dans « ${label} ». Ce sont celles vues au dernier passage de chaque bloc : un bloc ne dit pas d'avance ce qu'il rend.`));
    for (const b of avant) {
      const m = wf.nodes.find((x) => x.name === b), ia = infoAppli(m, applisListe), run = runDe(last, b);
      kids.push(el('h4', {}, ia && window.OdinLien?.icone ? window.OdinLien.icone(ia.a, 18) : null, b, el('small', { class: 'sub' }, ` · ${ia ? `${ia.a.nom} : ${ia.titre}` : cat(m.type)?.label ?? m.type}`)));
      if (!run) { kids.push(p('Pas encore de données connues : lance « Tester » (en haut) pour voir ce que ce bloc rend.')); continue; }
      if (run.error) { kids.push(p('Au dernier passage, ce bloc a échoué : aucune donnée.')); continue; }
      const vues = donneesVues(run.items);
      if (!vues.length) { kids.push(p('Au dernier passage, ce bloc n\'a rendu aucune donnée nommée.')); continue; }
      const l = el('div', { class: 'dr-dn-l', role: 'group', 'aria-label': `Données de ${b}` }, ...vues.map((v) => {
        const src = exprDonnee(b, v.chemin, dansJson);
        return el('button', { type: 'button', class: 'dr-dn-i', disabled: src ? undefined : true, onmousedown: (e) => e.preventDefault(),
          onclick: () => { if (!src) return; poserNoeud(champ, ctx.pastille({ src, bloc: b, chemin: v.chemin })); ctx.change(); } },
          el('b', {}, libelleChemin(v.chemin)), el('small', {}, src ? `Exemple : ${apercu(v.exemple)}` : 'Ce nom ne peut pas s\'écrire dans ces réglages.'));
      }));
      fleches(l); kids.push(l);
    }
    const boite = el('div', { class: 'dr-donnees', id: `${champ.id}-liste`, role: 'group', 'aria-labelledby': `${champ.id}-liste-t` }, ...kids);
    boite.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermerDonnees(true); } });
    zone.replaceChildren(boite); bouton?.setAttribute('aria-expanded', 'true');
    listeDn = { champ, bouton, boite };
    if (focusListe) (boite.querySelector('.dr-dn-i:not([disabled])') ?? boite.querySelector('button'))?.focus?.();
  }
  // ---------------- La fenêtre du « + » : la grille des applis (icônes, recherche), puis les fonctions de l'appli
  // choisie (les graves grisées) ; plus bas, les outils de Talos. Fenêtre vide : d'abord QUAND elle part.
  // La grille et la liste des fonctions sont celles de « Faire un lien » (pages/talos-lien.js).
  let choix = null;
  function fermerChoix() { if (!choix) return; const { fond, retour } = choix; choix = null; fond.remove(); if (retour?.isConnected) retour.focus?.(); }
  const sansAccent = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  /** Les flèches déplacent le focus parmi les boutons de `box` (`cols` : le nombre de colonnes, 1 pour une liste). */
  function fleches(box, cols = () => 1) {
    box.addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      const bs = [...box.querySelectorAll('button')].filter((b) => !b.disabled), i = bs.indexOf(document.activeElement); if (i < 0) return;
      const j = pasFleche(i, bs.length, cols(bs), e.key); if (j !== i) { e.preventDefault(); bs[j].focus(); }
    });
  }
  const colonnes = (bs) => { const t = bs[0]?.offsetTop; return Math.max(1, bs.filter((b) => b.offsetTop === t).length); };
  // applisChargees : la liste est lue ; applisFaite : une lecture a été tentée (réussie ou non : on ne la redemande pas en boucle).
  let applisChargees = false, applisFaite = false, applisListe = null;
  function chargerApplis() {
    const L = window.OdinLien;
    if (applisChargees || !L?.applis) { applisFaite = true; return Promise.resolve(applisListe); }
    return L.applis().then((l) => { applisChargees = Boolean(l); applisFaite = true; applisListe = Array.isArray(l) ? l : null; return applisListe; }, () => { applisFaite = true; return null; });
  }
  /** Le bloc posé hors de la fenêtre (téléphone surtout) : on fait glisser le schéma juste assez pour le voir. */
  function montrer(n) {
    const canvas = $('#drCanvas'), world = $('#drCanvas .dr-world'), r = canvas?.getBoundingClientRect?.();
    if (!n || !world || !r?.width) return;
    const x = n.position[0] * view.k + view.x, y = yDessin(n.position[1]) * view.k + view.y, w = NODE_W * view.k, h = HAUT_BLOC * view.k, m = 24;
    if (x + w + m > r.width) view.x -= x + w + m - r.width; else if (x < m) view.x += m - x;
    if (y + h + m > r.height) view.y -= y + h + m - r.height; else if (y < m) view.y += m - y;
    world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`;
  }
  async function ouvrirChoix(ou = {}) {
    fermerChoix();
    // « Changer » d'un bloc d'appli (`remplace` : son nom) : seulement les applis, puis ses fonctions (ou, pour un
    // déclencheur, ce qu'elle signale) ; le choix remplace celui du bloc, à sa place et avec ses liens.
    const cible = ou.remplace ? wf.nodes.find((n) => n.name === ou.remplace) : null;
    const quand = cible ? cible.type === 'déclencheur.module' : modeChoix(wf) === 'quand', L = window.OdinLien;
    const titre = el('h2', { id: 'drChT' }), corps = el('div', { class: 'dr-ch-c' });
    const boite = el('div', { class: 'dr-choix', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'drChT' }, el('div', { class: 'dr-ch-h' }, titre, el('button', { class: 'dr-ch-x', type: 'button', 'aria-label': 'Fermer', onclick: fermerChoix }, '×')), corps);
    const fond = el('div', { class: 'dr-choix-fond', onclick: (e) => { if (e.target === fond) fermerChoix(); } }, boite);
    boite.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermerChoix(); return; }
      if (e.key !== 'Tab') return;
      const f = [...boite.querySelectorAll('button, input')].filter((x) => !x.disabled); // ordre du document = ordre de l'écran
      const premier = boite.querySelector('.dr-ch-x'), dernier = f.filter((x) => x !== premier).pop() ?? premier;
      if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); } else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
    });
    choix = { fond, retour: document.activeElement };
    document.body.append(fond);
    const prendre = (c) => {
      if (cible) {
        const auto = infoAppli(cible, applisListe)?.auto, r = remplacer(wf, cible.name, c, auto, applisListe);
        if (!r.ok) { void window.OdinDialog?.alert(r.error); return; }
        // (une autre fonction : ce bloc n'a pas tourné comme il est ; son dernier passage ne se montre plus)
        fermerChoix(); if (r.change) { dirty = true; if (last?.nodes) { delete last.nodes[cible.name]; seuls.delete(cible.name); } } if (r.nom) rename(cible, r.nom, { donnees: false }); noter(`changer « ${cible.name} »`);
        sel = cible.name; draw(); drawSide();
        const s = $('#drSt'); if (s && r.change) s.textContent = `✓ « ${cible.name} » changé.`;
        $('#drSide .dr-app button')?.focus?.();
        return;
      }
      // « Ajouter un bloc ici » sur un fil (`milieu`) : le bloc va entre les deux ; sinon, le « + ».
      const r = ou.milieu ? inserer(wf, c, ou.milieu) : poser(wf, c, ou);
      if (!r.ok) { void window.OdinDialog?.alert(r.error); return; }
      fermerChoix(); sel = r.name; dirty = true; noter(`ajouter « ${r.name} »`); montrer(wf.nodes.find((n) => n.name === r.name)); draw(); drawSide();
      const s = $('#drSt'); if (s) s.textContent = ou.milieu ? `✓ « ${r.name} » ajouté entre « ${ou.milieu.de} » et « ${ou.milieu.vers} ».` : r.lien ? `✓ « ${r.name} » ajouté après « ${r.lien.de} ».` : `✓ « ${r.name} » ajouté.`;
      elems.get(r.name)?.focus?.();
    };
    const outils = cible ? [] : (st?.catalog ?? []).filter((c) => (quand ? c.trigger && c.type !== 'déclencheur.module' : !c.trigger && c.type !== 'module.action'));
    const zoneOutils = el('div', { class: 'dr-ch-o', 'aria-label': quand ? 'Déclencheurs' : 'Outils de Talos' }); fleches(zoneOutils);
    function etape1() {
      titre.textContent = cible ? 'Changer l\'appli ou la fonction' : quand ? 'Quand l\'automatisation part-elle ?' : ou.milieu ? `Ajouter un bloc entre « ${ou.milieu.de} » et « ${ou.milieu.vers} »` : 'Ajouter un bloc';
      const quoi = cible ? 'Chercher une appli' : 'Chercher une appli ou un outil';
      const cherche = el('input', { class: 'li-cherche', type: 'search', placeholder: quoi, 'aria-label': quoi, autocomplete: 'off' });
      const zoneApplis = el('div', {});
      let grille = null;
      const peindreOutils = (t) => {
        const garde = outils.filter((c) => !t || sansAccent(`${c.label} ${c.group}`).includes(t));
        const groupes = quand ? [''] : [...new Set(garde.map((c) => c.group))];
        zoneOutils.replaceChildren(...(garde.length ? groupes.flatMap((g) => [g ? el('h4', {}, g) : null, ...garde.filter((c) => !g || c.group === g).map((c) => el('button', { type: 'button', title: c.what ?? '', onclick: () => prendre(blocOutil(c)) }, el('b', {}, c.label), c.what ? el('small', {}, c.what) : null))]) : [el('p', { class: 'sub', style: 'margin:0' }, 'Aucun outil de ce nom.')]).filter(Boolean));
      };
      const peindreApplis = () => {
        if (!applisListe || !L?.grilleApplis) { zoneApplis.replaceChildren(el('p', { class: 'sub', style: 'margin:0' }, 'Les applis ne sont pas disponibles ici.')); return; }
        grille = L.grilleApplis(applisListe, etape2); fleches(grille.grille, colonnes); zoneApplis.replaceChildren(grille.grille);
        const t = cherche.value.trim(); if (t) grille.remplir(t.toLowerCase());
      };
      cherche.addEventListener('input', () => { const t = cherche.value.trim(); grille?.remplir(t.toLowerCase()); peindreOutils(sansAccent(t)); });
      cherche.addEventListener('keydown', (e) => { if (e.key !== 'ArrowDown') return; const b = zoneApplis.querySelector('button') ?? zoneOutils.querySelector('button'); if (b) { e.preventDefault(); b.focus(); } });
      corps.replaceChildren(...[quand && !cible ? el('p', { class: 'sub', style: 'margin:0' }, 'Le premier bloc dit quand elle part : quand une appli signale quelque chose, ou un des déclencheurs plus bas.') : null,
        cherche, el('h3', {}, 'Applis'), zoneApplis, ...(cible ? [] : [el('h3', {}, quand ? 'Déclencheurs' : 'Outils de Talos'), zoneOutils])].filter(Boolean));
      peindreOutils('');
      if (applisChargees || !L?.applis) peindreApplis();
      else {
        zoneApplis.replaceChildren(el('p', { class: 'sub', style: 'margin:0' }, 'Chargement des applis…'));
        void chargerApplis().then(() => { if (choix?.fond === fond && zoneApplis.isConnected !== false && corps.contains?.(zoneApplis) !== false) peindreApplis(); });
      }
      cherche.focus?.();
    }
    function etape2(a) {
      titre.replaceChildren(L.icone ? L.icone(a, 28) : '', a.nom);
      const retour = el('button', { class: 'btn small', type: 'button', onclick: etape1 }, '← Applis');
      let liste;
      if (quand) {
        const ev = [...new Set(a.evenements ?? [])].filter((x) => x !== 'alerte');
        const opts = [['', 'Quand elle signale quelque chose', 'Tout ce qu\'elle signale.'], ['alerte', 'Quand elle lance une alerte', 'À partir du niveau « haute », réglable ensuite.'], ...ev.map((x) => [x, `Quand elle signale « ${x} »`, ''])];
        liste = el('div', { class: 'li-fn', role: 'list', 'aria-label': `Ce que ${a.nom} signale` }, ...opts.map(([v, b, s]) => el('button', { type: 'button', role: 'listitem', onclick: () => prendre(blocSignal(a, v)) }, el('b', {}, b), s ? el('small', {}, s) : null)));
      } else if ((a.actions ?? []).length) liste = L.listeFonctions(a, { boutons: true, choisir: (f) => prendre(blocFonction(a, f)) });
      if (liste) fleches(liste);
      corps.replaceChildren(...[retour, el('h3', {}, quand ? 'Quand ?' : 'Ses fonctions'), liste ?? el('p', { class: 'sub', style: 'margin:0' }, 'Cette appli n\'a pas de fonction à lancer.')]);
      ([...(liste?.querySelectorAll('button') ?? [])].find((b) => !b.disabled) ?? retour).focus?.();
    }
    etape1();
  }
  /** Ce réglage du bloc `n` est-il rangé en texte JSON (le moteur y remplace les {{ … }} avant de le lire) ? */
  const estJsonDe = (n, cle) => cat(n.type)?.params?.find((p) => p.key === cle)?.kind === 'json';
  /** Le nom tapé pour le bloc `n`, et les données que les autres blocs prennent chez lui savent-elles s'écrire avec ? */
  function nomPossible(n, texte) {
    const v = nomValide(wf, n.name, texte); if (!v.ok || v.nom === n.name) return v;
    const s = suivreRenommage(wf, n.name, v.nom, estJsonDe);
    return s.ok ? v : { ok: false, error: s.error };
  }
  /**
   * Renomme un bloc : les fils suivent, et les données que les blocs prennent chez lui ({{ $node["X"]… }}) aussi.
   * → { ok, nom } ou { ok: false, error } (nom vide, déjà pris, ou qu'une donnée ne saurait pas écrire : rien ne change).
   * `donnees: false` (le nom donné tout seul quand on change la fonction d'un bloc) : les données ne suivent pas, comme avant.
   */
  function rename(n, texte, { donnees = true } = {}) {
    const v = nomValide(wf, n.name, texte); if (!v.ok || v.nom === n.name) return v;
    const s = donnees ? suivreRenommage(wf, n.name, v.nom, estJsonDe) : { ok: true, changes: [] };
    if (!s.ok) return { ok: false, error: s.error };
    const from = n.name, to = v.nom; n.name = to; renommes.set(from, to); // (une pastille qui nommerait encore l'ancien nom le dira)
    for (const c of s.changes) wf.nodes[c.i].params[c.cle] = c.valeur;
    if (wf.connections[from]) { wf.connections[to] = wf.connections[from]; delete wf.connections[from]; }
    for (const list of Object.values(wf.connections)) for (const t of list) for (const l of t) if (l.node === from) l.node = to;
    if (outs[from]) { outs[to] = outs[from]; delete outs[from]; }
    if (runDe(last, from)) { last.nodes[to] = last.nodes[from]; delete last.nodes[from]; if (seuls.delete(from)) seuls.add(to); } // (c'est le même bloc : son passage le suit)
    if (armed?.node === from) armed = null;
    if (passage?.nom === from) passage.nom = to; // (la bulle des données ouverte suit son bloc)
    if (sel === from) sel = to;
    dirty = true; if (donnees) noter(`renommer « ${from} » en « ${to} »`); draw();
    // Le panneau ouvert montre un champ dont une donnée vient d'être réécrite : il se redessine (sinon le champ, à la
    // prochaine frappe, remettrait l'ancienne expression qu'il garde).
    if (s.changes.some((c) => wf.nodes[c.i].name === sel)) drawSide();
    return v;
  }
  function addNode(c) {
    let name = c.label, k = 2; while (wf.nodes.some((n) => n.name === name)) name = `${c.label} ${k++}`;
    const lastN = wf.nodes[wf.nodes.length - 1], params = Object.fromEntries(c.params.filter((p) => p.default !== undefined).map((p) => [p.key, p.default]));
    const n = { name, type: c.type, params, position: lastN ? [lastN.position[0] + 240, lastN.position[1]] : [60, 160] };
    wf.nodes.push(n); if (lastN && !c.trigger && !(wf.connections[lastN.name] ?? []).some((t) => t.length)) relier(wf, lastN.name, 0, name); // (un seul geste, « ajouter »)
    sel = name; dirty = true; noter(`ajouter « ${name} »`); draw(); drawSide();
  }
  async function save() {
    for (const n of wf.nodes) for (const p of cat(n.type)?.params ?? []) if (p.kind === 'json' && typeof n.params[p.key] === 'string' && n.params[p.key].trim()) { try { JSON.parse(n.params[p.key]); } catch { if (!/\{\{/.test(n.params[p.key])) { await window.OdinDialog.alert(`« ${n.name} » : ${p.label} n'est pas un JSON valide.`); return false; } } }
    // Premier enregistrement : dans quel dossier, brouillon ou active (pages/talos-dossiers.js) ; « Annuler » n'enregistre rien.
    if (!wf.id && window.OdinTalosDossiers) { const c = await window.OdinTalosDossiers.choisir(wf); if (!c) return false; if (c.dossier) wf.dossier = c.dossier; else delete wf.dossier; wf.active = c.active; }
    const neuve = !wf.id;
    const r = await api('/api/draupnir/save', { flow: wf });
    if (!r.ok) { await window.OdinDialog.alert(r.error); return false; }
    // (les blocs dessinés tenaient les objets d'avant : on redessine, sinon un geste après l'enregistrement serait perdu)
    wf = r.flow; dirty = false; enregistree = copie(r.flow); rebaser(); draw(); drawSide();
    // Elle vient d'être créée : le choix « Dossier » rejoint la barre tout de suite (sinon seulement à la réouverture).
    if (neuve && wf.id && window.OdinTalosDossiers && !$('#v-flows .dr-bar .td-barre')) $('#drName')?.insertAdjacentElement('afterend', window.OdinTalosDossiers.barre(wf, () => wf)); const s = $('#drSt'); if (s) s.textContent = '✓ Enregistré.'; return true;
  }
  async function test(stopAfter) {
    if (!(await save())) return;
    const s = $('#drSt'); if (s) s.textContent = 'Test en cours…';
    // Ce qui part : l'automatisation enregistrée à l'instant. Elle peut changer (« Enregistrer ») ou une autre peut s'ouvrir
    // pendant le passage : le passage reste celui de CETTE automatisation, telle qu'elle a tourné.
    const id = wf.id, passe = copie(enregistree);
    const r = await api('/api/draupnir/run', { id, stopAfter });
    if (!wf || wf.id !== id) return; // (une autre automatisation a été ouverte entre-temps : ce passage n'est pas le sien)
    if (!r.ok) { if (s) s.textContent = `✗ ${r.error}`; return; }
    // Les sorties de l'automatisation qui vient de tourner (les cas d'un aiguillage changés avant « Tester ») : le nombre
    // par sortie se met sous le bon nom. Le serveur ne les rend qu'avec l'automatisation ; sans réponse, celles d'avant.
    const w = wf, f = await api(`/api/draupnir/flow?id=${encodeURIComponent(wf.id)}`).catch(() => null);
    if (wf !== w) return; // (une autre automatisation a été ouverte entre-temps)
    if (f?.ok && f.outputs && typeof f.outputs === 'object') outs = f.outputs;
    // (enregistrée de nouveau pendant le passage, avec d'autres blocs ou fils : le nombre par sortie ne se dit plus)
    last = pareilQuEnregistre(passe, enregistree) ? r.run : { ...r.run, sortiesDouteuses: true }; seuls = new Set(); passeSur = passe; if (s) s.textContent = `${r.run.status === 'succès' ? '✓' : '✗'} ${r.run.status} en ${r.run.ms} ms${r.run.error ? ` : ${r.run.error}` : ''}`;
    draw(); drawSide();
  }
  /**
   * « Exécuter ce bloc seul » (menu d'un bloc) : le bloc tourne SEUL, au serveur, avec les données vues au dernier passage
   * des blocs d'avant ; les suivants ne tournent pas ; rien n'est enregistré ni activé. Ce qui tourne est l'automatisation
   * enregistrée : changée depuis (autre chose que la place des blocs ou une note), il ne part pas. Un bloc qui agit
   * demande une confirmation à chaque fois, qui dit ce qu'il va faire. Ses données rejoignent celles du dernier passage
   * (« Données » des blocs suivants) ; une erreur se montre sur lui.
   */
  async function executerSeul(nom) {
    const D = window.OdinDialog, titre = 'Exécuter ce bloc seul';
    if (!wf?.id || !enregistree) { await D.alert('Cette automatisation n\'est pas encore enregistrée : rien ne peut tourner. Enregistre-la d\'abord.', { titre }); return; }
    if (!pareilQuEnregistre(wf, enregistree)) { await D.alert('Ce qui tourne est l\'automatisation enregistrée, et elle a changé depuis : ce bloc ne tournerait pas comme tu le vois. Enregistre d\'abord (« Enregistrer »), puis exécute-le seul.', { titre }); return; }
    const n = wf.nodes.find((x) => x.name === nom); if (!n) return;
    const e = entreeSeul(wf, nom, last, cat);
    if (!e.ok) {
      if (e.tester) { if (await D.confirm(`${e.raison}\n\nLancer « Tester jusqu'ici » sur « ${e.tester} » maintenant ?`, { titre, ok: 'Tester jusqu\'ici' })) await test(e.tester); }
      else await D.alert(e.raison, { titre });
      return;
    }
    const agit = ceQuAgit(n, Boolean(cat(n.type)));
    // Le réglage « relancer en cas d'échec » de l'automatisation enregistrée vaut aussi ici (moteur : 5 fois de plus au plus).
    const relances = Math.max(0, Math.min(5, Math.ceil(Number(enregistree.settings?.retry ?? 0)) || 0));
    if (agit && !(await D.confirm(`« ${nom} » agit : il ${agit}.${relances ? `\n\nS'il échoue, il sera relancé jusqu'à ${relances} fois de plus (réglage de l'automatisation), sans nouvelle question : il peut donc agir plusieurs fois.` : ''}\n\nIl recevra les données vues au dernier passage des blocs d'avant${e.tronque ? ' (les 20 premiers éléments vus)' : ''} ; les blocs suivants ne tourneront pas. L'automatisation n'est ni enregistrée ni activée.`, { titre, ok: 'Exécuter', danger: true }))) { dire(`Rien n'a été exécuté : « ${nom} » n'a pas tourné.`); elems.get(nom)?.focus?.(); return; }
    dire(`« ${nom} » tourne seul…`);
    const w = wf, r = await api('/api/draupnir/run', { id: wf.id, start: nom, stopAfter: nom, items: e.items, pinned: e.pinned }).catch((x) => ({ ok: false, error: x.message }));
    if (wf !== w) return; // (une autre automatisation a été ouverte entre-temps)
    if (!r.ok) { dire(`✗ « ${nom} » n'a pas tourné : ${r.error}`); return; }
    const run = r.run?.nodes?.[nom] ?? { count: 0, items: [], error: r.run?.error || 'il n\'a pas tourné' };
    last = { ...(last ?? {}), nodes: { ...(last?.nodes ?? {}), [nom]: run } }; seuls.add(nom);
    dire(run.error ? `✗ « ${nom} » exécuté seul : erreur : ${run.error}` : `✓ « ${nom} » exécuté seul : ${run.count} élément(s)${e.tronque ? ' (à partir des 20 premiers éléments vus)' : ''}. Ses données sont disponibles pour les blocs suivants ; les blocs suivants n'ont pas tourné ; l'automatisation n'est ni enregistrée ni activée.`);
    draw(); drawSide(); elems.get(nom)?.focus?.();
  }
  function init() { document.head.append(el('style', {}, css)); document.addEventListener('keydown', raccourci); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.OdinFlows = { open: () => { if (!wf && !ailleurs) openList(); }, edit: openFlow, liste: openList, prendre: () => { ailleurs = true; jeton++; fermerPassage(); wf = null; fermerChoix(); },
    logique: { NODE_W, PAS_X, PAS_Y, nomLibre, placeLibre, sortieDuPlus, modeChoix, blocFonction, blocSignal, blocOutil, poser, pasFleche, estDoubleTouche,
      appliDe, fonctionDe, infoAppli, lireEntree, champsDe, valeurChamp, ecrireEntree, manquants, remplacer, inserer, retirerLien, refusLien, blocSous, zoneToucher, styleSortie,
      decouper, assembler, exprDonnee, blocsAvant, donneesVues, etatDonnee, libelleChemin, nomValide, poserNote, renommerDans, suivreRenommage,
      entreeSeul, ceQuAgit, pareilQuEnregistre, MOTS, bulleDe, passageDe, placeDonnees, texteElement, MAX_PASSAGE, zoneBulle, BULLE_G, dernierPassage, AGIT_TYPES: Object.keys(AGIT), copieDe, collerBloc, zoomer, MAX_HISTOIRE,
      milieuLien, SORTIES_NOMMEES, TYPE_FILTRE, ROND, ANNEAU, ICONE_ROND, HAUT_BLOC, HAUT_TESTE, ECHELLE_Y, PLUS_D, PLUS_X, ZONE_PLUS, SORTIE_X, ENTREE_X, PORT_D, ECART_SORTIES, yDessin, yEnregistre, departLien, arriveeLien, zonesBloc } };
})();
