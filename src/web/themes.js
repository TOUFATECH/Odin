// Les thèmes d'Odin (maquettes validées ; 7 thèmes et 6 de température ajoutés le 15/11/2026) : décor, couleurs de toute l'interface, couleur d'Odin au repos.
// Choix : Réglages → Apparence, « Odin, change ton thème », ou Automatique (heure + météo, calculé par Odin
// pour que tous tes écrans et Telegram soient d'accord). « Valhalla » = le thème d'origine (clair / sombre / épuré).
// Les humeurs d'Odin gardent leurs couleurs : le thème ne change que sa couleur de repos et son halo.
(() => {
  // Les textes de Réglages → Apparence (en tête du fichier, pour les traduire d'un seul endroit).
  const TEXTES = {
    familles: { enavant: 'Mis en avant', odin: 'Les thèmes d\'Odin', hestia: 'Thèmes de Hestia', evenements: 'Événements de l\'année' },
    // Un thème de Hestia nommé avec sa famille (six noms existent dans deux familles).
    nomEtFamille: '{nom} · {famille}',
    // Les cartes des thèmes.
    clair: 'clair', sombre: 'sombre', lesDeux: 'clair ou sombre',
    automatique: 'Automatique',
    autoAide: 'selon l\'heure (veille 3 h – 6 h, jour, après-midi, soir, nuit) et la météo',
    // La place qui attend le choix de l'animation quand on déplace ou agrandit un widget (vide pour l'instant).
    animations: 'Animations quand je déplace ou agrandis un widget',
    sousTitre: 'Le thème change tout Odin (couleurs, décor, couleur d\'Odin au repos). Il est le même sur tous tes écrans. « Valhalla » garde les réglages d\'origine ci-dessous.',
    // La raison du thème affiché ({...} : remplis par Odin).
    evenement: 'Aujourd\'hui : thème {nom} (événement). ',
    raisonAuto: 'Automatique : {nom}{why}{odin}.',
    // Ce qu'ajoute Odin à la raison (la couleur selon la météo), et la raison de la règle, entre parenthèses.
    raisonOdin: ' · Odin {why}', raisonPourquoi: ' ({why})',
    choisi: 'Choisi : {nom}.',
    // L'interrupteur de la maquette, branché sur la règle d'Odin (le thème automatique).
    humeur: 'Odin change de thème selon son humeur',
    humeurAide: 'En automatique seulement, au plus une fois par heure.',
  };
  const remplir = (modele, v) => modele.replace(/\{(\w+)\}/g, (x, k) => (k in v ? String(v[k]) : x));
  // Les thèmes d'Odin et ceux des événements de l'année (ils s'activent tout seuls le jour de l'événement, sauf si tu
  // les coupes) : leurs données sont dans le catalogue (src/web/pages/themes-catalogue.js, chargé juste avant ce
  // fichier), que lit aussi l'écran de la maison. Sans lui, Valhalla seul (le thème d'origine de la page, toujours
  // lisible). Des copies de ses listes : ce que ce fichier y ajoute ne change pas le catalogue.
  const catalogue = window.OdinCatalogueThemes;
  const THEMES = { ...(catalogue?.ODIN || { valhalla: { name: 'Valhalla (classique)' } }) };
  const ORDER = Object.keys(THEMES);
  const EVENT_THEMES = { ...(catalogue?.EVENEMENTS || {}) };
  Object.assign(THEMES, EVENT_THEMES);

  // Les thèmes « Mis en avant » de la maquette validée (src/web/pages/themes-catalogue.js, chargé juste avant ce
  // fichier ; sans lui, rien ne change). Pour l'instant à plat : la règle de couleurs d'Odin (palette) est nourrie par
  // le fond (la première et la dernière couleur de la dernière couche du fond de la maquette, deux fois la même pour
  // une couleur unie), la carte pleine, le texte, l'accent, la couleur d'Odin et le ton. Un thème qui existait déjà
  // (glace) garde son identifiant et son décor. Les thèmes de Hestia (h-…) suivent la même règle et gardent le décor
  // dessiné de l'écran de la maison (dans son cadre à lui, `vue`).
  const EN_AVANT = [], HESTIA = [];
  const derniereCouche = (bg) => { let prof = 0, debut = 0; for (let i = 0; i < bg.length; i++) { const c = bg[i]; if (c === '(') prof++; else if (c === ')') prof--; else if (c === ',' && prof === 0) debut = i + 1; } return bg.slice(debut); };
  if (catalogue && catalogue.THEMES) {
    for (const [id, v] of Object.entries(catalogue.THEMES)) {
      const fond = typeof v.bg === 'string' ? derniereCouche(v.bg).match(/#[0-9a-fA-F]{6}\b/g) : null;
      if (!fond || !v.solid || !v.ink || !v.accent || !v.mascot) continue;
      const hestia = id.startsWith('h-'), dessin = hestia ? catalogue.DECORS?.[catalogue.HESTIA?.[id.slice(2)]?.decor] : THEMES[id]?.decor;
      const texte = catalogue.ACCENT_TEXTE?.[id];
      THEMES[id] = { name: catalogue.NOMS?.[id] || id, dark: v.dark === true, sky: [fond[0], fond[fond.length - 1]], panel: v.solid, ink: v.ink, accent: v.accent, ...(typeof texte === 'string' ? { accentTexte: texte } : {}), mascot: v.mascot, ...(dessin ? { decor: dessin } : {}), ...(dessin && hestia ? { vue: '0 -30 960 150' } : {}) };
      (hestia ? HESTIA : EN_AVANT).push(id);
    }
  }

  // Les familles de thèmes, dans l'ordre de Réglages → Apparence : les « Mis en avant » (s'il y en a), les thèmes
  // d'Odin (ORDER, sans ceux déjà mis en avant), les thèmes de Hestia (s'il y en a), puis les 16 des événements de
  // l'année. Pur : rend une copie neuve à chaque appel (ORDER ne bouge pas).
  const familles = () => [
    ...(EN_AVANT.length ? [{ id: 'enavant', titre: TEXTES.familles.enavant, ids: [...EN_AVANT] }] : []),
    { id: 'odin', titre: TEXTES.familles.odin, ids: ORDER.filter((id) => !EN_AVANT.includes(id)) },
    ...(HESTIA.length ? [{ id: 'hestia', titre: TEXTES.familles.hestia, ids: [...HESTIA] }] : []),
    { id: 'evenements', titre: TEXTES.familles.evenements, ids: Object.keys(EVENT_THEMES) },
  ];
  window.OdinThemes = { THEMES, ORDER, EVENT_THEMES, familles };
  // Le nom d'un thème dans la ligne d'état : un thème de Hestia dit aussi sa famille.
  const nomAffiche = (id) => (!THEMES[id] ? id : HESTIA.includes(id) ? TEXTES.nomEtFamille.replace('{nom}', THEMES[id].name).replace('{famille}', TEXTES.familles.hestia) : THEMES[id].name);
  const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const toHex = (c) => `#${c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')}`;
  const mix = (a, b, k) => { const x = hex(a), y = hex(b); return toHex(x.map((v, i) => v * (1 - k) + y[i] * k)); };
  const lum = (h) => { const [r, g, b] = hex(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  /** Toutes les couleurs de l'interface d'un thème, tirées de 4 couleurs (fond, panneau, texte, accent). */
  function palette(t) {
    const bg = mix(t.sky[0], t.sky[1], 0.5), p = t.panel, ink = t.ink, a = t.accent;
    const onAccent = contrast('#ffffff', a) >= contrast('#111111', a) ? '#ffffff' : '#111111';
    return {
      '--bg': bg, '--panel': p, '--panel2': mix(p, bg, t.dark ? 0.35 : 0.45), '--line': mix(p, ink, 0.14), '--ink': ink,
      '--muted': mix(ink, p, 0.28), '--dim': mix(ink, p, 0.36), '--accent': a,
      // Le texte en accent (liens, anneau du thème choisi) : une teinte plus foncée si le thème en a une, sinon l'accent.
      '--accent-texte': t.accentTexte || a, '--accent-2': t.dark ? mix(a, '#ffffff', 0.18) : mix(a, '#000000', 0.15),
      '--on-accent': onAccent, '--field': mix(p, ink, 0.24), '--field-h': mix(p, ink, 0.34), '--hover': mix(p, ink, 0.06), '--sel': mix(p, a, 0.16),
      '--user': mix(p, a, 0.12), '--user-l': mix(p, a, 0.35), '--off': mix(ink, p, 0.55),
      // Couleurs d'état (vert, ambre, rouge) : celles d'Odin en sombre ou en clair, posées sur le panneau du thème.
      ...(t.dark
        ? { '--good': '#6CCFB8', '--warn': '#F0B860', '--bad': '#EE8A70', '--good-l': mix(p, '#6CCFB8', 0.35), '--warn-l': mix(p, '#F0B860', 0.35), '--warn-bg': mix(p, '#F0B860', 0.08), '--bad-l': mix(p, '#EE8A70', 0.35), '--bad-bg': mix(p, '#EE8A70', 0.08), '--bad-l2': mix(p, '#EE8A70', 0.25) }
        : { '--good': '#1D7F68', '--warn': '#8F6200', '--bad': '#B23F2A', '--good-l': mix(p, '#1D7F68', 0.35), '--warn-l': mix(p, '#C98A14', 0.45), '--warn-bg': mix(p, '#F0B860', 0.12), '--bad-l': mix(p, '#B23F2A', 0.35), '--bad-bg': mix(p, '#EE8A70', 0.1), '--bad-l2': mix(p, '#B23F2A', 0.35) }),
    };
  }
  window.OdinThemes.palette = palette; window.OdinThemes.contrast = contrast;
  const decorUri = (t) => (t.decor ? `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='${t.vue || '0 0 256 170'}' preserveAspectRatio='xMidYMax slice'>${t.decor}</svg>`)}")` : 'none');
  // Le verre des cartes de l'accueil (maquette validée ; choix du propriétaire du 23/11 : le verre sur l'accueil et
  // l'écran de la maison seulement, fond uni ailleurs ; sa décision du 25/11 : « Décor derrière, verre plus opaque », le
  // décor du thème derrière l'accueil et des cartes assez opaques pour que chaque texte reste lisible). Un thème du
  // catalogue garde ses champs de verre ; un thème d'Odin suit la règle de la maquette : sombre, verre 22 sur son
  // panneau ; clair, 40 sur du blanc. La carte elle-même vient de la règle de la maquette (surfaceOf, dans le
  // catalogue) ; sans elle, rien. Des variables à nom neuf (--v-…), pour ne heurter aucune couleur de l'interface.
  const rgbaDe = (h, a) => `rgba(${hex(h).join(',')},${a})`;
  function varsVerre(id, t, pal) {
    if (typeof catalogue?.surfaceOf !== 'function') return null;
    const c = catalogue.THEMES?.[id];
    const v = c && c.sc ? c : {
      dark: t.dark === true, sc: t.dark ? t.panel : '#ffffff', gt: t.dark ? 22 : 40, blur0: 20, sheen: t.dark ? 0.1 : 0.45, sat: 1.4,
      solid: t.dark ? t.panel : mix('#ffffff', t.sky[0], 0.12), border: t.dark ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.85)',
      shadow: t.dark ? '0 14px 34px rgba(0,0,0,.3)' : `0 10px 28px ${rgbaDe(t.ink, 0.1)},inset 0 1px 0 rgba(255,255,255,.9)`,
    };
    // Un fond ou un décor trop clair (ou trop sombre) sous un verre trop transparent : la carte devient plus opaque, juste
    // assez pour que chaque texte du thème s'y lise (4,5:1) au pire point du décor (deux formes translucides l'une sur
    // l'autre comprises) : une couche de sa couleur pleine passe sous le verre, de 5 % en 5 %, jusqu'à la carte pleine
    // s'il le faut (un verre blanc sous un texte clair va ainsi vers sa couleur pleine, sombre, et non vers le blanc). Le
    // flou et le reflet restent ceux de son départ ; les thèmes déjà lisibles gardent leur départ. Le texte du thème est
    // tel quel ; les autres tons comptent tels que tonsVerre les éloigne déjà sans le décor (verre de départ sur le
    // dégradé, carte pleine, couleur pleine) : c'est le décor que l'opacité compense, pas un ton de plus.
    // Le reflet compte tel que la page le pose (arrondi), pour que l'opacité et les tons (tonsVerre) lisent le même.
    const sat = v.sat ?? 1.4, dessous = derriere(t, sat), plein = hex6(v.solid) || t.panel;
    const depart = catalogue.surfaceOf(v, Math.max(0, Math.min(100, Number(v.gt) || 0))), reflet = +(depart.sheen ?? 0.3).toFixed(3);
    const sansDecor = trier(fondsVerre(derriere({ ...t, decor: '' }, sat), depart.surface, reflet), fondsVerre(dessous, surCouche(depart.surface, plein, 1), reflet), [lumVue(plein)]);
    const textes = [t.ink, ...TEXTES_VERRE.map((n) => pal[n]).filter((c) => /^#[0-9a-f]{6}$/i.test(c || '')).map((c) => eloigner(c, sansDecor, versTon(t)))];
    const lisible = (surface) => { const f = trier(fondsVerre(dessous, surface, reflet)); return textes.every((c) => pireContraste(c, f) >= 4.6); };
    let surface = depart.surface;
    for (let p = 5; p <= 100 && !lisible(surface); p += 5) surface = surCouche(depart.surface, plein, p / 100);
    const s = { ...depart, surface };
    return {
      '--v-carte': s.surface, '--v-plein': s.solid, '--v-bord': s.border, '--v-flou': `${s.blur}px`, '--v-sat': sat,
      '--v-reflet': reflet, '--v-ombre': v.shadow && v.shadow !== 'none' ? v.shadow : '0 0 0 transparent',
    };
  }
  // Le verre posé sur une couche de la couleur pleine d'opacité p (0 à 1) : chaque bout du dégradé devient ce que l'on
  // voit à travers les deux, en une seule couleur plus opaque. À 1, c'est le verre sur la couleur pleine.
  const surCouche = (surface, plein, p) => String(surface).replace(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/g, (m, r, v, b, a) => {
    const x = +a, tot = x + (1 - x) * p, f = hex(plein);
    return `rgba(${[+r, +v, +b].map((c, i) => Math.round((x * c + (1 - x) * p * f[i]) / (tot || 1))).join(',')},${+tot.toFixed(3)})`;
  });
  // Le fond de l'accueil est celui de la page : le dégradé du thème, le dessin du décor, et le même voile que derrière la
  // barre de côté. Ces calculs se font en nombres (de 0 à 255, arrondis comme la page les peint) : le pire point se
  // cherche parmi des centaines de couleurs, à chaque pas d'opacité.
  const NOIR = [0, 0, 0], BLANC = [255, 255, 255];
  const canal = (v) => Math.round(v < 0 ? 0 : v > 255 ? 255 : v);
  const melange = (x, y, k) => [canal(x[0] * (1 - k) + y[0] * k), canal(x[1] * (1 - k) + y[1] * k), canal(x[2] * (1 - k) + y[2] * k)];
  const voiler = (t, c) => (t.dark ? melange(c, NOIR, 0.18) : melange(c, BLANC, 0.22));
  // Les couleurs que le dessin du décor peut peindre, avec leur opacité (celle de la forme et de ses groupes) : le
  // remplissage et le trait de chaque forme. Un tracé sans remplissage dit, dans ces décors, est un trait sans surface.
  const hex6 = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : /^#[0-9a-f]{3}$/i.test(c || '') ? `#${[...c.slice(1)].map((x) => x + x).join('')}`.toLowerCase() : null);
  function couleursDecor(decor) {
    const out = [], pile = [{ op: 1 }];
    for (const [, fin, balise, attrs, seule] of String(decor || '').matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>/g)) {
      if (fin) { if (pile.length > 1) pile.pop(); continue; }
      const a = {}; for (const [, k, x] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) a[k] = x;
      const p = pile[pile.length - 1], e = { fill: a.fill ?? p.fill, stroke: a.stroke ?? p.stroke, op: p.op * (a.opacity === undefined ? 1 : Number(a.opacity)) };
      if (balise !== 'g') for (const [c, o] of [[e.fill, a['fill-opacity']], [e.stroke, a['stroke-opacity']]]) { const h = hex6(c); if (h) out.push([h, e.op * (o === undefined ? 1 : Number(o))]); }
      if (!seule) pile.push(e);
    }
    return out;
  }
  // saturate() des filtres CSS (la matrice de la norme), comme le verre le fait sur ce qu'il laisse voir.
  const saturer = ([r, g, b], s) => [(0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b, (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b, (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b].map((x) => Math.round(Math.max(0, Math.min(255, x))));
  // Tout ce qui peut se trouver derrière une carte de l'accueil, point par point : le dégradé à ses deux bouts, chaque
  // couleur du décor posée sur le dégradé ou sur une couleur pleine du décor, et deux formes translucides l'une sur
  // l'autre (deux bandes d'aurore qui se croisent : dans un ordre comme dans l'autre) ; le tout sous le voile, saturé par
  // le verre. Gardé par thème : le calcul de l'opacité et celui des tons lisent le même.
  const DERRIERE = new WeakMap();
  function derriere(t, sat) {
    const s = Number(sat) || 1, deja = DERRIERE.get(t)?.get(s); if (deja) return deja;
    const dessin = [...new Map(couleursDecor(t.decor).map(([c, a]) => [`${c}/${a}`, [hex(c), Math.max(0, Math.min(1, a))]])).values()];
    const translucides = dessin.filter(([, a]) => a < 0.99), vus = new Map();
    const voir = (c) => { const x = saturer(voiler(t, c), s); vus.set((x[0] << 16) | (x[1] << 8) | x[2], x); };
    const bases = new Map([...t.sky.map(hex), ...dessin.filter(([, a]) => a >= 0.99).map(([c]) => c)].map((c) => [c.join(), c]));
    t.sky.forEach((c) => voir(hex(c)));
    for (const u of bases.values()) for (const forme of dessin) {
      const x = melange(u, forme[0], forme[1]); voir(x);
      if (forme[1] < 0.99) for (const autre of translucides) if (autre !== forme) voir(melange(x, autre[0], autre[1]));
    }
    const out = [...vus.values()];
    if (!DERRIERE.has(t)) DERRIERE.set(t, new Map());
    DERRIERE.get(t).set(s, out);
    return out;
  }
  // Ce qui se voit à travers une carte en verre : chaque point possible du fond, vu par la carte à ses deux bouts, et le
  // reflet en haut ; gardé en luminances (le contraste ne dépend que d'elles).
  const LIN = Array.from({ length: 256 }, (_, v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const lumRGB = (c) => 0.2126 * LIN[c[0]] + 0.7152 * LIN[c[1]] + 0.0722 * LIN[c[2]];
  function fondsVerre(dessous, surface, reflet) {
    const bouts = [...String(surface).matchAll(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/g)].map((m) => [[+m[1], +m[2], +m[3]], +m[4]]), k = Math.min(1, Number(reflet) || 0), fonds = [];
    for (const f0 of dessous) bouts.forEach(([c, a], i) => { const f = melange(f0, c, a); fonds.push(lumRGB(f)); if (i === 0) fonds.push(lumRGB(melange(f, BLANC, k))); });
    return fonds;
  }
  // Le pire contraste d'une couleur sur des fonds : leurs luminances, triées une fois ; le pire est l'une des deux
  // voisines de la sienne (la plus proche au-dessous, la plus proche au-dessus). Celle de la couleur n'est calculée
  // qu'une fois.
  const trier = (...listes) => Float64Array.from(listes.flat()).sort();
  const LUM = new Map(), lumVue = (h) => { let x = LUM.get(h); if (x === undefined) { x = lum(h); LUM.set(h, x); } return x; };
  const pireContraste = (c, fonds) => {
    const a = lumVue(c); let bas = 0, haut = fonds.length, pire = 21;
    while (bas < haut) { const m = (bas + haut) >> 1; if (fonds[m] < a) bas = m + 1; else haut = m; }
    for (const b of [fonds[bas - 1], fonds[bas]]) if (b !== undefined) { const r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); if (r < pire) pire = r; }
    return pire;
  };
  // Les autres textes posés dans le verre restent lisibles (4,5:1) : une couleur trop proche de ce qui se voit à
  // travers (ou de la couleur pleine, quand le navigateur ne sait pas flouter) s'en éloigne par petits pas (vers le
  // blanc si le texte du thème est clair, vers le noir sinon).
  const TEXTES_VERRE = ['--muted', '--dim', '--accent-texte', '--good', '--warn', '--bad'];
  const versTon = (t) => (lum(t.ink) > 0.4 ? '#ffffff' : '#000000');
  const eloigner = (c, fonds, vers) => { for (let i = 0; i < 30 && pireContraste(c, fonds) < 4.6; i++) c = mix(c, vers, 0.12); return c; };
  function tonsVerre(t, pal, verre) {
    const fonds = trier(fondsVerre(derriere(t, verre['--v-sat']), verre['--v-carte'], verre['--v-reflet']), [lumVue(hex6(verre['--v-plein']) || t.panel)]), vers = versTon(t), tons = {};
    for (const nom of TEXTES_VERRE) {
      const c = pal[nom]; if (!/^#[0-9a-f]{6}$/i.test(c || '')) continue;
      const loin = eloigner(c, fonds, vers);
      if (loin !== c) tons[nom] = loin;
    }
    return tons;
  }
  // Les cartes de l'accueil, sans une carte posée dans une autre ni la place laissée par une carte qu'on déplace.
  const CARTES_ACCUEIL = ':root[data-odin-theme] #v-home :is(.fe-w,.hpanel,.hcard,.card):not(:is(.fe-w,.hpanel,.hcard,.card) *):not(.dragging)';
  // Les textes posés sans carte sur le fond de l'accueil reçoivent une plaque du même verre (plan de la maquette : « un
  // titre qui se retrouve sur le fond reçoit une plaque ») : le résumé « État détaillé » ; les titres « Tu veux sans
  // doute » et « Comment Odin se comporte » de l'ancienne colonne (l'accueil d'un membre de la famille, ou celui du
  // propriétaire tant que sa fenêtre n'est pas lue, ou quand elle est en panne) ; le message de la fenêtre elle-même
  // (chargement, panne).
  const PLAQUE_ACCUEIL = ['details.hmore>summary', '#todayBox .sect-t', '#fenetre>.fe-err'].map((s) => `:root[data-odin-theme] #v-home ${s}`).join(',');
  // Les cadres en pointillé posés sur le fond (« Page vide » dans la fenêtre ; « Ajouter un widget » en mode Modifier) :
  // le même verre, dans leur cadre à eux, qui garde son pointillé et sa couleur.
  const CADRES_ACCUEIL = ['#feGrid>.fe-drop', '#fenetre .fe-ajout'].map((s) => `:root[data-odin-theme] #v-home ${s}`).join(',');
  // Le verre : le reflet en haut, puis la carte ; ce qui passe derrière est flouté et saturé.
  const VERRE = 'background:linear-gradient(135deg,rgba(255,255,255,var(--v-reflet)) 0%,rgba(255,255,255,calc(var(--v-reflet) * .25)) 28%,transparent 55%),var(--v-carte)';
  const FLOU = '-webkit-backdrop-filter:blur(var(--v-flou)) saturate(var(--v-sat));backdrop-filter:blur(var(--v-flou)) saturate(var(--v-sat))';
  let style;
  let current = 'valhalla', classic;
  function apply(id) {
    const t = THEMES[id] ? THEMES[id] : THEMES.valhalla; current = THEMES[id] ? id : 'valhalla';
    const root = document.documentElement;
    if (!style) { style = document.createElement('style'); style.id = 'odinThemeStyle'; document.head.append(style); }
    if (!t.sky) {
      if (root.dataset.odinTheme) { if (classic === undefined) delete root.dataset.theme; else root.dataset.theme = classic; }
      delete root.dataset.odinTheme; style.textContent = '';
      window.OdinFace?.tintBase?.(null);
      root.dispatchEvent(new CustomEvent('odin-theme', { detail: { id: current } }));
      return;
    }
    if (!root.dataset.odinTheme) classic = root.dataset.theme;
    root.dataset.odinTheme = current; root.dataset.theme = t.dark ? 'dark' : 'light';
    const pal = palette(t), verre = varsVerre(current, t, pal), voile = t.dark ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.22)';
    const tons = verre ? Object.entries(tonsVerre(t, pal, verre)).map(([k, v]) => `;${k}:${v}`).join('') : '';
    const vars = Object.entries({ ...pal, ...verre }).map(([k, v]) => `${k}:${v}`).join(';');
    style.textContent = `:root[data-odin-theme]{color-scheme:${t.dark ? 'dark' : 'light'};${vars}}
:root[data-odin-theme] body{background:${decorUri(t)} center bottom/100% 40vh no-repeat fixed,linear-gradient(180deg,${t.sky[0]},${t.sky[1]}) fixed}
:root[data-odin-theme] body::before{content:'';position:fixed;inset:0;pointer-events:none;background:${voile};z-index:0}
:root[data-odin-theme] nav.side{background:color-mix(in srgb,var(--panel2) 86%,transparent);backdrop-filter:blur(10px)}
:root[data-odin-theme] .card,:root[data-odin-theme] .hpanel,:root[data-odin-theme] .hcard{background:color-mix(in srgb,var(--panel) 94%,transparent)}
:root[data-odin-theme] main{position:relative;z-index:1;background:var(--bg)}${verre ? `
:root[data-odin-theme] main:has(>#v-home.on){background:transparent}
${PLAQUE_ACCUEIL},${CARTES_ACCUEIL}{${VERRE};border-color:var(--v-bord);box-shadow:inset 0 1px 0 rgba(255,255,255,calc(var(--v-reflet) * 1.6)),inset 1px 0 0 rgba(255,255,255,calc(var(--v-reflet) * .8)),var(--v-ombre);${FLOU}${tons}}
${PLAQUE_ACCUEIL}{width:fit-content;max-width:100%;box-sizing:border-box;padding:6px 14px;border:1px solid var(--v-bord);border-radius:12px}
:root[data-odin-theme] #v-home details.hmore>summary{margin:12px 0}
${CADRES_ACCUEIL}{${VERRE};${FLOU}${tons}}
:root[data-odin-theme] #v-home .hcard.sugg{border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){${PLAQUE_ACCUEIL},${CADRES_ACCUEIL},${CARTES_ACCUEIL}{background:var(--v-plein)}}` : ''}`;
    // (Zone de travail sur fond uni, choix du propriétaire du 17/11 : le décor ne passe jamais derrière un texte ; il ne se
    //  voit plus que derrière la barre de côté. Seule exception, ses choix du 23/11 et du 25/11 : sur l'accueil, la zone
    //  de travail laisse voir le fond de la page, comme la maquette (le dessin du décor, le dégradé et le même voile que
    //  derrière la barre de côté) ; ses cartes sont du verre assez opaque pour que chaque texte s'y lise au pire point du
    //  décor, et tout texte posé sans carte a une plaque du même verre (dans un cadre en pointillé, le même verre). Le
    //  bandeau du haut garde son fond uni.)
    // La mascotte en liberté et sa copie dans la discussion prennent la couleur du thème au repos.
    window.OdinFace?.tintBase?.(t.mascot);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', t.sky[0]);
    root.dispatchEvent(new CustomEvent('odin-theme', { detail: { id: current } }));
  }
  window.OdinThemes.apply = apply;
  window.OdinThemes.current = () => current;

  // ---------------- Ce que dit Odin (le même pour tous tes écrans) ----------------
  const api = async (action, input = {}) => { const r = await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'apparence', action, input }) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
  let state = { mode: 'auto', theme: 'valhalla' };
  try { const c = JSON.parse(localStorage.getItem('odin.apparence') || 'null'); if (c && THEMES[c.theme]) state = c; } catch { /* rien */ }
  // Le thème affiché : celui de l'événement du jour (s'il n'est pas coupé), sinon le choisi ou l'automatique.
  const shown = () => (state.eventTheme && THEMES[state.eventTheme] ? state.eventTheme : state.theme);
  // La couleur d'Odin au repos : l'événement, sinon la météo (thème automatique), sinon celle du thème.
  function tint() {
    const c = state.event?.color || state.odin?.color;
    if (c) window.OdinFace?.tintBase?.(c);
  }
  apply(shown()); tint();
  // `sur` : le dernier état connu d'Odin (relu, ou gardé dans le navigateur) ; `tour` : le numéro du dernier choix ;
  // `file` : les choix partent vers Odin l'un après l'autre, dans l'ordre des clics.
  let sur = state, tour = 0, file = Promise.resolve();
  /** Relit Odin ; rend vrai s'il a répondu. Une relecture partie avant un choix plus récent ne touche à rien. */
  async function sync() {
    const n = tour;
    try {
      const r = await api('mascotte'); const d = r && r.data; if (!d || !THEMES[d.theme]) return false;
      if (n !== tour) return true;
      const ev = d.event, evOn = ev && d.evenements?.themes !== false && THEMES[`ev-${ev.id === 'famille' ? 'anniversaire' : ev.id}`];
      state = { mode: d.mode, theme: d.theme, why: d.why, odin: d.odin, event: ev, eventTheme: evOn ? `ev-${ev.id === 'famille' ? 'anniversaire' : ev.id}` : undefined, humeurTheme: d.humeurTheme !== false };
      sur = state;
      try { localStorage.setItem('odin.apparence', JSON.stringify(state)); } catch { /* */ }
      if (shown() !== current) apply(shown());
      tint();
      document.documentElement.dispatchEvent(new CustomEvent('odin-mascotte', { detail: d }));
      paint();
      return true;
    } catch { return false; /* pas connecté ou hors ligne : on garde le dernier thème */ }
  }
  function choose(id) {
    const n = ++tour;
    // Le choix se voit tout de suite (thème et cartes) ; Odin le confirme ou le corrige juste après. « Au hasard » :
    // rien ne change avant la réponse d'Odin.
    if (id === 'automatique') { apply(state.theme); state = { ...state, mode: 'auto' }; } else if (THEMES[id]) { apply(id); state = { ...state, mode: 'fixe', theme: id }; }
    paint();
    const fait = file.then(async () => {
      let parti = true;
      try { await api('theme', { theme: id }); } catch { parti = false; }
      if (n !== tour) return; // un choix plus récent suit : c'est lui qui relira Odin
      const lu = await sync();
      // Odin injoignable (le choix n'est pas parti, et rien n'a pu être relu) : on remet ce qu'Odin a vraiment.
      if (!parti && !lu && n === tour) { state = sur; apply(shown()); paint(); }
    });
    file = fait.catch(() => undefined);
    return fait;
  }
  // « Odin change de thème selon son humeur » : mis, l'humeur joue sur le thème automatique (au plus une fois par
  // heure) ; coupé, elle ne joue plus. Gardé par Odin ; même file que les choix de thème, même retour en cas de panne.
  function humeur(oui) {
    const n = ++tour;
    state = { ...state, humeurTheme: oui === true }; paint();
    const fait = file.then(async () => {
      let parti = true;
      try { await api('regler_mascotte', { reglages: JSON.stringify({ humeurTheme: oui === true }) }); } catch { parti = false; }
      if (n !== tour) return;
      const lu = await sync();
      // (un choix de thème parti juste avant, en panne lui aussi, ne s'est pas remis : on remet aussi le thème affiché)
      if (!parti && !lu && n === tour) { state = sur; apply(shown()); paint(); }
    });
    file = fait.catch(() => undefined);
    return fait;
  }
  window.OdinThemes.sync = sync; window.OdinThemes.choose = choose; window.OdinThemes.humeur = humeur;

  // ---------------- Réglages → Apparence : une carte par thème (maquette validée), « Automatique » et sa raison ----------------
  // Valhalla n'a pas de couleurs à lui : son aperçu prend celles de la maquette (fond, panneau, bord, côté, Odin).
  const VALHALLA = { sky: ['#101A24', '#172533'], panel: '#16212c', line: '#2a3846', side: '#13161B', mascot: '#3F82F0' };
  const COULEUR = /^#[0-9a-f]{6}$/i;
  // Les yeux du petit Odin des cartes : ceux que dessine face.js (repos, petite taille, figés), une seule fois.
  let yeuxOdin;
  function yeux() {
    if (yeuxOdin !== undefined) return yeuxOdin;
    yeuxOdin = '';
    try {
      const d = window.OdinFace?.dessin?.('neutre', { taille: 'mini', fige: true });
      if (d && Array.isArray(d.yeux) && d.yeux.length === 2) {
        // À petite taille, face.js agrandit les yeux (d.mesure) : la même mesure, autour du centre du regard.
        const h = Number(/height="([\d.]+)"/.exec(d.yeux[0])?.[1]), m = Number(d.mesure?.[0]?.[1]);
        const k = h > 0 && m > 0 ? +(m / h).toFixed(3) : 1;
        yeuxOdin = `<g transform="translate(60 56) scale(${k}) translate(-60 -56)">${d.yeux.join('')}</g>`;
      }
    } catch { /* pas de visage sur cette page : pas de petit Odin */ }
    return yeuxOdin;
  }
  // Le petit Odin d'une carte, à la couleur du thème au repos (les quatre teintes que face.js tire d'une couleur,
  // comme tintBase). Pas de classe « odin » : face.js ne le repeint pas avec le thème affiché.
  function mascotte(id, couleur) {
    const e = yeux(); if (!e) return '';
    const h = COULEUR.test(couleur || '') ? couleur : VALHALLA.mascot, c = [mix(h, '#000000', 0.14), h, mix(h, '#ffffff', 0.32), mix(h, '#ffffff', 0.62)], n = `tm-${id}`;
    return `<svg viewBox="0 0 120 120" focusable="false" aria-hidden="true"><defs><radialGradient id="${n}-c" cx="50%" cy="46%" r="54%"><stop offset="0" stop-color="${c[0]}"/><stop offset=".5" stop-color="${c[1]}"/><stop offset=".82" stop-color="${c[2]}"/><stop offset="1" stop-color="${c[3]}"/></radialGradient><radialGradient id="${n}-h" cx="50%" cy="50%" r="50%"><stop offset=".8" stop-color="${c[3]}" stop-opacity=".65"/><stop offset="1" stop-color="${c[3]}" stop-opacity="0"/></radialGradient></defs><circle cx="63" cy="64" r="49" fill="url(#${n}-h)"/><circle cx="60" cy="60" r="44" fill="url(#${n}-c)"/>${e}</svg>`;
  }
  // L'aperçu de 120 px : le fond du thème (décor compris), une barre de côté, trois cartes et un bloc « allumé ».
  function apercu(t) {
    const p = t.sky ? palette(t) : null;
    const fond = t.sky ? `${decorUri(t)} center bottom/100% auto no-repeat,linear-gradient(180deg,${t.sky[0]},${t.sky[1]})` : `linear-gradient(180deg,${VALHALLA.sky[0]},${VALHALLA.sky[1]})`;
    // Écrites dans la page : seulement des couleurs « #rrggbb » (sinon celles de Valhalla).
    const sure = (x, d) => (COULEUR.test(x || '') ? x : d);
    t = { ...t, accent: sure(t.accent, '') };
    const c = `<i style="background:${sure(p?.['--panel'], VALHALLA.panel)};border:1px solid ${sure(p?.['--line'], VALHALLA.line)}"></i>`;
    return { fond, html: `<i style="background:${sure(p?.['--panel2'], VALHALLA.side)}"></i>${c}<i style="background:${t.accent || '#E3AC3F'}"></i>${c}${c}` };
  }
  const CSS_CARTES = '#themeGrid .tfam{margin:4px 0 14px}#themeGrid .tfh{display:flex;align-items:center;gap:8px;min-height:44px}#themeGrid h3{margin:0;font-size:14px;font-weight:600;display:flex;gap:8px;align-items:baseline;flex:1;min-width:0}#themeGrid h3 small{color:var(--muted);font-weight:600}'
    + '#themeGrid .tfold{display:none;flex:none;width:44px;height:44px;align-items:center;justify-content:center;padding:0;border:1px solid var(--line);border-radius:12px;background:none;color:var(--ink);font-size:16px;cursor:pointer}#themeGrid .tfold span{display:inline-block;transition:transform .2s}#themeGrid .ferme .tfold span{transform:rotate(-90deg)}'
    + '#themeGrid .tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px;margin-top:6px}'
    + '#themeGrid button.thc{display:flex;flex-direction:column;align-items:stretch;min-width:0;padding:0;border:0;border-radius:18px;overflow:hidden;text-align:left;background:var(--panel);color:var(--ink);box-shadow:0 0 0 1px var(--line);cursor:pointer;font:inherit;transition:transform .2s}#themeGrid button.thc:hover{transform:translateY(-3px)}'
    + '#themeGrid .thc .pv{height:120px;position:relative;display:grid;grid-template-columns:18% 1fr 1fr;grid-template-rows:1fr 1fr;gap:7px;padding:10px;box-sizing:border-box}#themeGrid .thc .pv i{display:block;min-width:0;border-radius:8px}#themeGrid .thc .pv i:first-child{grid-row:span 2}'
    + '#themeGrid .thc .nm{display:grid;grid-template-columns:22px minmax(0,1fr) auto;align-items:center;column-gap:8px;min-height:44px;padding:10px 12px;box-sizing:border-box;font-weight:600;font-size:13px;line-height:1.25}#themeGrid .tmasc{display:block;width:22px;height:22px}#themeGrid .tmasc svg{display:block;width:100%;height:100%}#themeGrid .tnom{overflow-wrap:anywhere}#themeGrid .nm small{color:var(--muted);font-weight:500;font-size:12px}'
    + '#themeGrid button[aria-pressed=true]{outline:3px solid var(--accent-texte,var(--accent));outline-offset:2px}'
    + '#themeGrid .thc[aria-pressed=true] .pv::after{content:"✓";position:absolute;right:8px;top:8px;width:24px;height:24px;border-radius:50%;background:var(--accent);color:var(--on-accent);display:grid;place-items:center;font-size:14px;font-weight:700}'
    + '#themeGrid button.thc:focus-visible,#themeGrid .tfold:focus-visible{outline:3px solid var(--ink);outline-offset:2px}'
    + '.tauto{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px}#themeAuto{min-height:44px}'
    // L'interrupteur « selon son humeur » : toute la ligne (44 px) se touche ; Espace le bascule au clavier.
    + '.thum{display:flex;align-items:center;gap:12px;min-height:44px;margin:6px 0 0;cursor:pointer;font-weight:600}'
    + '#themeHumeur{appearance:none;-webkit-appearance:none;flex:none;position:relative;box-sizing:border-box;width:44px;min-width:44px;height:26px;min-height:0;padding:0;margin:0;border-radius:13px;border:0;background:var(--muted);cursor:pointer;transition:background .2s}'
    + '#themeHumeur::before{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.35);transition:transform .2s}'
    + '#themeHumeur:checked{background:var(--accent)}#themeHumeur:checked::before{transform:translateX(18px)}#themeHumeur:focus-visible{outline:3px solid var(--ink);outline-offset:3px}'
    + '@media (max-width:600px){#themeGrid .tgrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}#themeGrid .tfold{display:inline-flex}#themeGrid .tfam.ferme .tgrid{display:none}#themeGrid .tfam.ferme{margin-bottom:4px}#themeGrid .thc .nm{grid-template-columns:22px minmax(0,1fr);padding:8px 10px}#themeGrid .thc .nm small{grid-column:2}}'
    + '@media (prefers-reduced-motion:reduce){#themeGrid button.thc,#themeGrid .tfold span,#themeHumeur,#themeHumeur::before{transition:none}#themeGrid button.thc:hover{transform:none}}';
  // Une carte : un bouton (Tab, puis Entrée ou Espace, le choisit), l'aperçu, puis la bande (petit Odin, nom, clair ou sombre).
  function carteTheme(id) {
    const t = THEMES[id], b = document.createElement('button'); b.type = 'button'; b.className = 'thc'; b.dataset.theme = id; b.title = t.name;
    const a = apercu(t), pv = document.createElement('span'); pv.className = 'pv'; pv.setAttribute('aria-hidden', 'true'); pv.style.background = a.fond; pv.innerHTML = a.html;
    const nm = document.createElement('span'); nm.className = 'nm';
    const m = document.createElement('span'); m.className = 'tmasc'; m.setAttribute('aria-hidden', 'true'); m.innerHTML = mascotte(id, t.mascot);
    const nom = document.createElement('span'); nom.className = 'tnom'; nom.textContent = t.name;
    const ton = document.createElement('small'); ton.textContent = !t.sky ? TEXTES.lesDeux : t.dark ? TEXTES.sombre : TEXTES.clair;
    nm.append(m, nom, ton); b.append(pv, nm);
    b.addEventListener('click', () => choose(id));
    return b;
  }
  const plis = []; let plieALaMain = false;
  function paint() {
    const card = document.querySelector('article.card[data-sec="apparence"]'); if (!card) return;
    let box = card.querySelector('#themeGrid');
    if (!box) {
      const wrap = document.createElement('div'); wrap.className = 'field';
      // En tête, la place (vide, cachée) du choix de l'animation de déplacement ; puis « Automatique » et sa raison ;
      // puis l'interrupteur « selon son humeur » (une vraie case, rôle d'interrupteur) ; puis les familles.
      wrap.innerHTML = '<section id="themeAnims" class="tanims" data-place="animations" hidden></section><div class="tauto"><button type="button" class="btn" id="themeAuto" aria-pressed="false"></button><span class="hint" id="themeAutoAide"></span></div><span class="hint" id="themeWhy"></span>'
        + '<label class="thum" for="themeHumeur"><input type="checkbox" role="switch" id="themeHumeur" aria-describedby="themeHumeurAide"><span id="themeHumeurNom"></span></label><span class="hint" id="themeHumeurAide"></span><div id="themeGrid"></div>';
      card.querySelector('h2').after(wrap);
      card.querySelector('#themeAnims')?.setAttribute('aria-label', TEXTES.animations);
      const hum = card.querySelector('#themeHumeur');
      if (hum) {
        card.querySelector('#themeHumeurNom').textContent = TEXTES.humeur;
        card.querySelector('#themeHumeurAide').textContent = TEXTES.humeurAide;
        hum.addEventListener('change', () => humeur(hum.checked === true));
      }
      const css = document.createElement('style'); css.textContent = CSS_CARTES;
      document.head.append(css);
      box = card.querySelector('#themeGrid');
      const fs = familles();
      // Pas de nom pour la grille entière : chaque famille est un groupe nommé par son titre.
      for (const f of fs) {
        const sec = document.createElement('section'); sec.className = 'tfam';
        const tete = document.createElement('div'); tete.className = 'tfh';
        const h = document.createElement('h3'); h.id = `themeFam-${f.id}`; h.textContent = f.titre;
        const n = document.createElement('small'); n.textContent = String(f.ids.length); h.append(' ', n);
        const grid = document.createElement('div'); grid.className = 'tgrid'; grid.id = `themeFamG-${f.id}`; grid.setAttribute('role', 'group'); grid.setAttribute('aria-labelledby', h.id);
        const plier = document.createElement('button'); plier.type = 'button'; plier.className = 'tfold'; plier.innerHTML = '<span aria-hidden="true">▾</span>';
        plier.setAttribute('aria-labelledby', h.id); plier.setAttribute('aria-controls', grid.id);
        const ouvrir = (oui) => { sec.classList.toggle('ferme', !oui); plier.setAttribute('aria-expanded', String(oui)); };
        plis.push({ id: f.id, ids: f.ids, ouvrir });
        plier.addEventListener('click', () => { plieALaMain = true; ouvrir(sec.classList.contains('ferme')); });
        tete.append(h, plier); sec.append(tete, grid); box.append(sec);
        for (const id of f.ids) grid.append(carteTheme(id));
      }
      const auto = card.querySelector('#themeAuto');
      auto.textContent = TEXTES.automatique;
      auto.addEventListener('click', () => choose(state.mode === 'auto' ? state.theme : 'automatique'));
      const aide = card.querySelector('#themeAutoAide'); if (aide) aide.textContent = TEXTES.autoAide;
      const sub = card.querySelector('p.sub'); if (sub) sub.textContent = TEXTES.sousTitre;
    }
    // À l'écran étroit, les familles se replient : tant qu'on n'en a replié ou déplié aucune, seule celle du thème
    // choisi est ouverte (la première en automatique) ; ensuite, c'est la main qui décide.
    if (!plieALaMain) { const o = plis.find((f) => state.mode !== 'auto' && f.ids.includes(state.theme)) || plis[0]; for (const f of plis) f.ouvrir(f === o); }
    // Un seul thème marqué choisi (aucun en automatique : c'est alors « Automatique » qui l'est).
    const choisi = state.mode === 'auto' ? null : state.theme;
    for (const b of box.querySelectorAll('button.thc')) b.setAttribute('aria-pressed', String(b.dataset.theme === choisi));
    const auto = card.querySelector('#themeAuto'); if (auto) { auto.setAttribute('aria-pressed', String(state.mode === 'auto')); auto.classList.toggle('primary', state.mode === 'auto'); }
    const hum = card.querySelector('#themeHumeur'); if (hum) hum.checked = state.humeurTheme !== false;
    const why = card.querySelector('#themeWhy');
    if (why) why.textContent = (state.eventTheme ? remplir(TEXTES.evenement, { nom: THEMES[state.eventTheme].name }) : '') + (state.mode === 'auto' ? remplir(TEXTES.raisonAuto, { nom: THEMES[state.theme]?.name ?? state.theme, why: state.why ? remplir(TEXTES.raisonPourquoi, { why: state.why }) : '', odin: state.odin ? remplir(TEXTES.raisonOdin, { why: state.odin.why }) : '' }) : remplir(TEXTES.choisi, { nom: nomAffiche(state.theme) }));
    // Les réglages d'origine (Odin / Clair épuré, clair / sombre) ne valent que pour Valhalla.
    for (const el of card.querySelectorAll('.skins, #modeSeg')) el.style.opacity = current === 'valhalla' ? '' : '.45';
  }
  const start = () => { paint(); void sync(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  setInterval(() => { if (!document.hidden) void sync(); }, 5 * 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void sync(); });
})();
