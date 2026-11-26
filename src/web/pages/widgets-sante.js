// La famille « Santé » des widgets de l'accueil (maquette validée « Accueil ») : « Santé de la machine » (Hygie : le
// processeur, la mémoire et le disque le plus plein de la machine d'Odin, chacun avec son niveau, et la température en
// tête quand elle est lue) et « Santé des disques » (Tirésias : chaque disque et son état vrai, celui qui va mal d'abord).
// Ce fichier DÉCLARE ses sortes au registre commun (pages/widgets-rendu.js) ; l'accueil les dessine et les propose sans
// rien savoir d'elles. Chaque dessin est fait de l'état que le serveur a rendu (src/valhalla/widgets/sante.ts).
// - Jamais un zéro à la place d'une absence : une mesure que le serveur n'a pas rendue n'a pas d'anneau ; un disque non
//   lu est dit « Non lu », jamais « Bon » ; une valeur illisible n'est pas dessinée. Une machine qu'Odin ne sait pas
//   lire (Windows aujourd'hui) : le serveur rend « source_absente » et l'hôte écrit sa phrase, sans un chiffre.
// - Les niveaux sont ceux de Hygie et les états ceux de Tirésias (rendus par le serveur) : ici, seulement leurs mots et
//   leurs couleurs (celles du thème : --accent, --warn, --bad, --good). Le niveau est aussi écrit, pas seulement coloré.
// - Les nombres, les pourcentages, les tailles et les degrés : dans la langue de la page.
// - Aucune action : « Ouvrir » l'appli lue seulement (son nom tiré du catalogue), quand rien n'est encore mesuré.
// - La carte ne s'étire pas : les anneaux se resserrent par étapes (le niveau écrit n'est jamais retiré) ; la liste des
//   disques montre autant de disques que sa hauteur en tient, puis « et N de plus ». Un nom trop long est coupé à l'écran, entier en
//   info-bulle et pour les lecteurs d'écran.
// Rien n'est touché au chargement : seulement window.OdinWidgetsSante (ses textes et calculs, pour les essais) et sa déclaration.
(() => {
  'use strict';
  if (window.OdinWidgetsSante) return;

  // ---------------- Dictionnaire (tous les textes de la famille)
  const TEXTES = {
    machine: {
      titre: 'Santé de la machine', quoi: 'Le processeur, la mémoire et le disque de la machine d\'Odin',
      noms: { cpu: 'Processeur', mem: 'Mémoire', disque: 'Disque' },
      niveaux: { ok: 'bon', suivre: 'à suivre', attention: 'attention', grave: 'grave' },
      dit: (nom, valeur, niveau) => `${nom} : ${valeur}, ${niveau}`,
      temperature: (t) => `Température ${t}`,
      // `n` : le nom de l'appli tel que le catalogue le donne ('' s'il manque).
      pasEncore: (n) => (n ? `${n} n'a encore rien mesuré : ses mesures arrivent chaque minute.` : 'Rien n\'a encore été mesuré : les mesures arrivent chaque minute.'),
      pasEncoreBref: 'Rien de mesuré pour l\'instant.', ouvrir: (n) => (n ? `Ouvrir ${n}` : 'Ouvrir l\'appli'),
    },
    disques: {
      titre: 'Santé des disques', quoi: 'L\'état de chaque disque de la machine d\'Odin, en clair',
      etats: { mauvais: 'Mauvais', attention: 'À surveiller', inconnu: 'Non lu', bon: 'Bon' },
      genres: { 'disque dur': 'Disque dur', SSD: 'SSD', NVMe: 'NVMe', inconnu: '' },
      veille: 'en veille', plus: (n) => `et ${n} de plus`,
      // La fin du sous-titre : les comptes, ce qui va mal d'abord (`n` : le nombre déjà écrit dans la langue de la page).
      comptes: { mauvais: (k, n) => `${n} mauvais`, attention: (k, n) => `${n} à surveiller`, inconnu: (k, n) => (k === 1 ? `${n} non lu` : `${n} non lus`), bon: (k, n) => (k === 1 ? `${n} bon` : `${n} bons`) },
      pasEncore: (n) => (n ? `${n} n'a pas encore lu les disques.` : 'Les disques n\'ont pas encore été lus.'), pasEncoreBref: 'Disques pas encore lus.',
      aucun: 'Aucun disque trouvé sur la machine d\'Odin.', aucunBref: 'Aucun disque trouvé.', ouvrir: (n) => (n ? `Ouvrir ${n}` : 'Ouvrir l\'appli'),
    },
  };
  const T = TEXTES;

  // ---------------- Calculs (sans document)
  const NIVEAUX = ['ok', 'suivre', 'attention', 'grave'];
  const ETATS = ['mauvais', 'attention', 'inconnu', 'bon'];
  const MESURES = ['cpu', 'mem', 'disque'];
  /** Une mesure en pourcentage lue sans confiance : un nombre de 0 à 100 et un niveau de Hygie ; sinon rien. */
  function mesureLue(x) {
    if (!x || typeof x !== 'object' || !Number.isFinite(x.pct) || x.pct < 0 || x.pct > 100 || !NIVEAUX.includes(x.niveau)) return null;
    return { pct: Math.round(x.pct), niveau: x.niveau };
  }
  /** La température lue sans confiance (comme Hygie garde un capteur : au-dessus de zéro, 200 °C au plus). */
  function temperatureLue(x) {
    if (!x || typeof x !== 'object' || !Number.isFinite(x.c) || x.c <= 0 || x.c > 200 || !NIVEAUX.includes(x.niveau)) return null;
    return { c: Math.round(x.c), niveau: x.niveau };
  }
  /**
   * Un disque lu sans confiance : un nom ; un état connu (sinon « inconnu ») ; non relu, jamais « bon » (mais ce que
   * Tirésias juge mal sans le relire garde son état) ; le reste s'il est lisible.
   */
  function disqueLu(x) {
    if (!x || typeof x !== 'object' || typeof x.nom !== 'string' || !x.nom.trim()) return null;
    const lu = x.lu === true;
    return {
      nom: x.nom.trim(), modele: typeof x.modele === 'string' ? x.modele.trim() : '',
      genre: Object.prototype.hasOwnProperty.call(T.disques.genres, x.genre) ? x.genre : 'inconnu',
      taille: Number.isFinite(x.taille) && x.taille > 0 ? x.taille : 0,
      etat: !ETATS.includes(x.etat) || (!lu && x.etat === 'bon') ? 'inconnu' : x.etat, lu,
      temperature: lu && Number.isFinite(x.temperature) && x.temperature > 0 && x.temperature <= 200 ? Math.round(x.temperature) : null,
      veille: x.veille === true,
    };
  }
  /** Combien de disques montrer au téléphone (et au départ) selon la hauteur du widget en lignes de la grille : une de moins, une au moins. */
  const combien = (r) => Math.max(1, (Number.isInteger(r) ? r : 4) - 1);
  /** La couleur d'un niveau de Hygie : bon et à suivre, la couleur du thème ; attention et grave, les leurs. */
  const COULEUR_NIVEAU = { ok: 'var(--accent,currentColor)', suivre: 'var(--accent,currentColor)', attention: 'var(--warn,currentColor)', grave: 'var(--bad,currentColor)' };
  const COULEUR_ETAT = { bon: 'var(--good,currentColor)', attention: 'var(--warn,currentColor)', mauvais: 'var(--bad,currentColor)', inconnu: 'var(--muted,currentColor)' };

  // ---------------- Dessin (seulement quand un hôte l'appelle)
  const CSS = `
:has(>.ws-corps){display:flex;flex-direction:column}
.ws-corps{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column;gap:6px;color:var(--ink,var(--text,inherit));container-type:inline-size}
.ws-corps.ws-tient{overflow:hidden}.ws-corps.ws-tient.ws-defilant{overflow:auto}
.ws-defilant:focus-visible,.ws-btn:focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:2px}
.ws-calme{display:flex;align-items:center;gap:8px 12px;margin:0;font-size:13.5px;line-height:1.35}
.ws-calme svg{flex:none;width:22px;height:22px;color:var(--muted,currentColor)}.ws-ct{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
/* Un état calme trop serré : sans l'icône, puis la phrase brève (l'entière en info-bulle et pour les lecteurs d'écran),
   puis un corps plus petit, puis le bouton à côté, réduit à son icône (son nom reste lu). */
.ws-bref,.ws-bt-i{display:none}.ws-cm.ws-s1 .ws-calme>:first-child{display:none}.ws-cm.ws-s2 .ws-bref{display:inline}.ws-cm.ws-s3 .ws-calme{font-size:12.5px}
.ws-cm.ws-s4{flex-direction:row;align-items:center;gap:8px}.ws-cm.ws-s4 .ws-calme{flex:1 1 auto;min-width:0}.ws-cm.ws-s4 .ws-btn{align-self:center;width:44px;padding:0;display:grid;place-items:center}
.ws-cm.ws-s4 .ws-bt-i{display:flex}.ws-bt-i svg{width:19px;height:19px}
.ws-cm.ws-s4 .ws-bt-t,.ws-cm.ws-s2 .ws-long{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.ws-btn{flex:none;align-self:flex-start;min-height:44px;min-width:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line,currentColor);background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:650;cursor:pointer}
/* Les anneaux (maquette : trois, côte à côte, en bas de la carte). */
.ws-anneaux{margin-top:auto;display:flex;justify-content:space-around;align-items:flex-start;gap:6px;min-width:0;--ws-r:56px}
.ws-m{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;gap:2px;text-align:center}
.ws-rond{position:relative;width:min(var(--ws-r),28cqi);aspect-ratio:1;flex:none}
.ws-rond svg{display:block;width:100%;height:100%}.ws-rond circle{fill:none;stroke-width:4}
.ws-fond{stroke:var(--line,currentColor)}.ws-part{stroke:var(--ws-c,var(--accent,currentColor))}
.ws-v{position:absolute;inset:0;display:grid;place-items:center;font-size:min(13px,6cqi);font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--ink,inherit)}
.ws-nom{max-width:100%;font-size:12px;color:var(--muted,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ws-niv{max-width:100%;font-size:11.5px;font-weight:650;line-height:1.2;color:var(--ws-c,inherit);overflow-wrap:anywhere}
/* Les étapes du resserrement : des anneaux plus petits, puis la valeur seule (sans anneau), son nom et son niveau écrit. */
.ws-s1 .ws-anneaux{--ws-r:46px}.ws-s2 .ws-anneaux{--ws-r:38px}.ws-s2 .ws-v{font-size:min(12px,6cqi)}
.ws-s3 .ws-m{gap:0;line-height:1.15}.ws-s3 .ws-rond{width:auto;aspect-ratio:auto}.ws-s3 .ws-rond svg{display:none}.ws-s3 .ws-v{position:static;display:block;font-size:14px;color:var(--ws-c,inherit)}
.ws-s4 .ws-v{font-size:12.5px}.ws-s4 .ws-nom,.ws-s4 .ws-niv{font-size:11px;line-height:1.15}
/* La liste des disques. */
.ws-liste{flex:none;list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px;min-width:0}
.ws-d{display:flex;align-items:center;gap:8px;min-width:0;min-height:40px;padding:2px 0;border-top:1px solid var(--line,transparent)}.ws-d:first-child{border-top:0}
.ws-d[hidden],.ws-plus[hidden]{display:none}
.ws-pt{flex:none;width:10px;height:10px;border-radius:50%;background:var(--ws-c,currentColor)}
.ws-x{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px;line-height:1.3}
.ws-t{display:block;font-size:13px;font-weight:600;unicode-bidi:isolate;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-dt{display:block;font-size:11.5px;color:var(--muted,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-e{font-weight:650;color:var(--ws-c,inherit)}
.ws-pill{flex:none;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:650;white-space:nowrap;color:var(--ws-c,inherit);background:color-mix(in srgb,var(--ws-c,currentColor) 16%,transparent)}
/* Une carte étroite : l'état passe en tête de la ligne du détail (jamais retiré), la pastille s'efface. */
.ws-dt .ws-e{display:none}
@container (max-width:240px){.ws-pill{display:none}.ws-dt .ws-e{display:inline}}
.ws-plus{flex:none;margin:0;font-size:11.5px;color:var(--muted,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`;
  function poserStyle() {
    const R = window.OdinWidgetsRendu;
    if (R && typeof R.poserStyle === 'function') R.poserStyle();
    if (document.getElementById('odinWidgetsSante')) return;
    // Hors téléphone, la carte de la grille a la hauteur de ses lignes : son corps ne compte pas dans cette hauteur, si
    // bien qu'une longue liste n'étire ni la carte, ni sa voisine. Au téléphone, la hauteur suit le contenu.
    const G = window.OdinGrille, tel = G && G.GRILLE && Number.isInteger(G.GRILLE.telephone) ? G.GRILLE.telephone : 700;
    const s = document.createElement('style'); s.id = 'odinWidgetsSante'; s.textContent = `${CSS}\n@media (min-width:${tel + 1}px){.fe-w>.ws-corps{contain:size}}`; document.head.append(s);
  }
  function el(t, cls, texte) { const n = document.createElement(t); if (cls) n.className = cls; if (texte !== undefined) n.textContent = texte; return n; }
  const langue = () => { try { return document.documentElement.lang || undefined; } catch { return undefined; } };
  const nombre = (n) => { try { return new Intl.NumberFormat(langue()).format(n); } catch { return String(n); } };
  const pourcent = (p) => { try { return new Intl.NumberFormat(langue(), { style: 'percent', maximumFractionDigits: 0 }).format(p / 100); } catch { return `${p} %`; } };
  const degres = (c) => { try { return new Intl.NumberFormat(langue(), { style: 'unit', unit: 'celsius', maximumFractionDigits: 0 }).format(c); } catch { return `${c} °C`; } };
  /** Une taille de disque comme Tirésias l'écrit (en multiples de 1000 : « 4 To ») ; illisible : ''. */
  function taille(o, lg = langue()) {
    if (!Number.isFinite(o) || o <= 0) return '';
    const u = [[1e12, 'terabyte'], [1e9, 'gigabyte'], [1e6, 'megabyte'], [1e3, 'kilobyte']];
    for (const [k, unite] of u) if (o >= k) { const v = o / k; try { return new Intl.NumberFormat(lg, { style: 'unit', unit: unite, unitDisplay: 'short', maximumFractionDigits: v < 10 ? 1 : 0 }).format(v); } catch { return ''; } }
    return '';
  }
  /** La hauteur du widget, en lignes de la grille. */
  function lignesDe(w, defaut) {
    const G = window.OdinGrille;
    try { if (G && typeof G.taille === 'function') return G.taille(w).r; } catch { /* la valeur écrite */ }
    return w && Number.isInteger(w.r) ? w.r : defaut;
  }
  const INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/></svg>';
  const OUVRIR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M9 7h8v8"/></svg>';
  /**
   * Un état calme : l'icône, la phrase (et sa forme brève pour une carte trop petite), au plus un bouton qui ouvre l'appli
   * (jamais sur l'écran de la maison). `nom` : le nom de la zone si elle doit défiler.
   */
  function calme(texte, bref, ouvrir, appli, o, nom) {
    poserStyle();
    const c = el('div', 'ws-corps ws-cm'), l = el('p', 'ws-calme'), ic = el('span'), ct = el('span', 'ws-ct'); ic.setAttribute('aria-hidden', 'true'); ic.innerHTML = INFO;
    // La phrase entière est toujours lue (cachée à l'œil seulement quand la brève la remplace) ; la brève n'est pas lue en double.
    const long = el('span', 'ws-long', texte), court = el('span', 'ws-bref', bref); court.setAttribute('aria-hidden', 'true'); ct.title = texte;
    ct.append(long, court); l.append(ic, ct); c.append(l);
    if (ouvrir && !(o && o.ecran === 'maison')) {
      const b = el('button', 'ws-btn'); b.type = 'button'; b.title = ouvrir;
      const i = el('span', 'ws-bt-i'); i.setAttribute('aria-hidden', 'true'); i.innerHTML = OUVRIR;
      b.append(el('span', 'ws-bt-t', ouvrir), i);
      b.addEventListener('click', (ev) => { ev.stopPropagation(); location.hash = `#app=${appli}`; });
      c.append(b);
    }
    return tenir(c, nom);
  }
  /**
   * Tenir dans la carte : si son contenu dépasse, la zone se resserre d'une étape, puis d'une autre ; si rien ne suffit,
   * elle défile, et devient une région nommée (un arrêt du clavier qui dit ce qu'il est). Refait à chaque changement de taille.
   */
  const SERRE = ['ws-s1', 'ws-s2', 'ws-s3', 'ws-s4'];
  const deborde = (c) => c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1;
  function ajuster(c) {
    if (!c.isConnected) return;
    c.classList.remove(...SERRE, 'ws-defilant'); c.removeAttribute('role'); c.removeAttribute('aria-label'); c.removeAttribute('tabindex');
    if (c.classList.contains('ws-disques')) caser(c);
    for (const k of SERRE) { if (!deborde(c)) return; c.classList.add(k); }
    if (!deborde(c)) return;
    c.classList.add('ws-defilant'); c.setAttribute('role', 'region'); c.setAttribute('aria-label', c.dataset.nom || ''); c.tabIndex = 0;
  }
  /**
   * La liste des disques : hors téléphone, la carte a la hauteur de ses lignes de grille (contain:size) ; elle montre
   * autant de disques que cette hauteur en tient (un au moins), puis « et N de plus ». Au téléphone, la hauteur suit le
   * contenu : une ligne de moins que ses lignes de grille (combien). Les disques en trop sont cachés, pas perdus.
   */
  function montrer(c, n) {
    const l = [...c.querySelectorAll('.ws-liste > .ws-d')], total = Number(c.dataset.total) || l.length, p = c.querySelector('.ws-plus');
    l.forEach((x, i) => { x.hidden = i >= n; });
    const reste = total - Math.min(n, l.length);
    if (p) { p.hidden = reste <= 0; p.textContent = reste > 0 ? T.disques.plus(nombre(reste)) : ''; }
  }
  function caser(c) {
    const l = c.querySelectorAll('.ws-liste > .ws-d').length, depart = Math.min(l, Number(c.dataset.montre) || l);
    let tenue = false; try { tenue = /size/.test(getComputedStyle(c).contain || ''); } catch { /* la hauteur suit le contenu */ }
    if (!tenue) { montrer(c, depart); return; }
    let n = l; montrer(c, n);
    while (n > 1 && deborde(c)) montrer(c, --n);
  }
  let veilleur = null;
  function tenir(c, nom) {
    c.classList.add('ws-tient'); c.dataset.nom = nom;
    if (typeof ResizeObserver !== 'function') return c;
    if (!veilleur) veilleur = new ResizeObserver((l) => { for (const x of l) { if (x.target.isConnected) ajuster(x.target); else veilleur.unobserve(x.target); } });
    veilleur.observe(c);
    return c;
  }
  /** Un anneau : la part mesurée (dessiné ici, sans innerHTML), la valeur au milieu. */
  function anneau(part, texte) {
    const ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg'), r = el('span', 'ws-rond');
    s.setAttribute('viewBox', '0 0 36 36'); s.setAttribute('aria-hidden', 'true');
    for (const [cls, p] of [['ws-fond', 100], ['ws-part', part]]) {
      const k = document.createElementNS(ns, 'circle');
      k.setAttribute('class', cls); k.setAttribute('cx', '18'); k.setAttribute('cy', '18'); k.setAttribute('r', '15'); k.setAttribute('pathLength', '100');
      if (cls === 'ws-part') { k.setAttribute('stroke-dasharray', `${p} ${100 - p}`); k.setAttribute('transform', 'rotate(-90 18 18)'); k.setAttribute('stroke-linecap', p > 0 ? 'round' : 'butt'); }
      s.append(k);
    }
    const v = el('span', 'ws-v', texte); v.setAttribute('aria-hidden', 'true');
    r.append(s, v);
    return r;
  }
  /** La fin du sous-titre de « Santé de la machine » : la température, seulement si elle est lue. */
  function sousMachine(e) {
    const d = e && (e.etat === 'ok' || e.etat === 'ancien') && e.donnee ? e.donnee : null, t = d ? temperatureLue(d.temp) : null;
    return t ? degres(t.c) : '';
  }
  /**
   * « Santé de la machine » : un anneau par mesure rendue (le processeur, la mémoire, le disque le plus plein), sa valeur
   * et son nom ; le niveau, en couleur, et écrit quand il demande l'attention. Aucune mesure : rien n'est affirmé.
   */
  function machine(e, o) {
    const nom = o && typeof o.nomAppli === 'string' ? o.nomAppli : '';
    if (e.etat === 'vide') return e.raison === 'pas_encore_mesure' ? calme(T.machine.pasEncore(nom), T.machine.pasEncoreBref, T.machine.ouvrir(nom), 'eir', o, T.machine.titre) : null;
    const d = e.donnee || {}, lues = MESURES.map((k) => [k, mesureLue(d[k])]).filter(([, m]) => m);
    if (!lues.length) return null;
    poserStyle();
    const c = el('div', 'ws-corps ws-machine'), rang = el('div', 'ws-anneaux');
    for (const [k, m] of lues) {
      const nom = T.machine.noms[k], niveau = T.machine.niveaux[m.niveau], valeur = pourcent(m.pct), b = el('div', 'ws-m');
      b.dataset.mesure = k; b.dataset.niveau = m.niveau; b.style.setProperty('--ws-c', COULEUR_NIVEAU[m.niveau]);
      b.setAttribute('role', 'img'); b.setAttribute('aria-label', T.machine.dit(nom, valeur, niveau)); b.title = T.machine.dit(nom, valeur, niveau);
      const n = el('span', 'ws-nom', nom); n.setAttribute('aria-hidden', 'true');
      b.append(anneau(m.pct, valeur), n);
      if (m.niveau === 'attention' || m.niveau === 'grave') { const w = el('span', 'ws-niv', niveau); w.setAttribute('aria-hidden', 'true'); b.append(w); }
      rang.append(b);
    }
    // La température se lit dans le sous-titre (sousMachine), seulement si elle est lue.
    c.append(rang);
    return tenir(c, T.machine.titre);
  }
  /**
   * La fin du sous-titre de « Santé des disques » : ce qui va mal, le pire d'abord ; tout va bien : le compte des bons.
   * Court, car l'en-tête le coupe sans info-bulle ; chaque disque montré dit son état dans la liste.
   */
  function sousDisques(e) {
    const d = e && (e.etat === 'ok' || e.etat === 'ancien') && e.donnee ? e.donnee : null, k = d && d.compte && typeof d.compte === 'object' ? d.compte : null;
    if (!k) return '';
    const vus = ETATS.filter((x) => Number.isInteger(k[x]) && k[x] > 0), mal = vus.filter((x) => x !== 'bon');
    return (mal.length ? mal : vus).map((x) => T.disques.comptes[x](k[x], nombre(k[x]))).join(' · ');
  }
  /** Une ligne de disque : la pastille, son nom (le modèle, sinon son nom court), le détail, et son état écrit. */
  function ligneDisque(x) {
    const li = el('li', 'ws-d'), mot = T.disques.etats[x.etat], titre = x.modele || x.nom;
    li.style.setProperty('--ws-c', COULEUR_ETAT[x.etat]); li.dataset.etat = x.etat;
    const pt = el('span', 'ws-pt'); pt.setAttribute('aria-hidden', 'true');
    const tx = el('div', 'ws-x'), t = el('b', 'ws-t', titre); t.dir = 'auto'; t.title = x.modele ? `${x.modele} (${x.nom})` : x.nom;
    const detail = [T.disques.genres[x.genre], taille(x.taille), x.temperature !== null ? degres(x.temperature) : '', x.veille ? T.disques.veille : ''].filter(Boolean);
    // L'état en tête du détail (montré seulement quand la pastille s'efface), puis le genre, la taille, la température.
    const dt = el('small', 'ws-dt'), e = el('span', 'ws-e', detail.length ? `${mot} · ` : mot);
    dt.append(e, detail.join(' · '));
    dt.title = [mot, ...detail].join(' · ');
    tx.append(t, dt);
    const p = el('span', 'ws-pill', mot); p.setAttribute('aria-hidden', 'true');
    li.append(pt, tx, p);
    return li;
  }
  /**
   * « Santé des disques » : les disques rendus par le serveur, dans son ordre (celui qui va mal d'abord), autant que la
   * hauteur en tient, puis « et N de plus ». Pas encore lus : « Ouvrir » l'appli ; aucun disque : une phrase.
   */
  function disques(e, o) {
    const nom = o && typeof o.nomAppli === 'string' ? o.nomAppli : '';
    if (e.etat === 'vide') {
      if (e.raison === 'disques_pas_encore_lus') return calme(T.disques.pasEncore(nom), T.disques.pasEncoreBref, T.disques.ouvrir(nom), 'durinn', o, T.disques.titre);
      return e.raison === 'aucun_disque' ? calme(T.disques.aucun, T.disques.aucunBref, '', 'durinn', o, T.disques.titre) : null;
    }
    const d = e.donnee || {}, liste = (Array.isArray(d.disques) ? d.disques : []).map(disqueLu).filter(Boolean);
    if (!liste.length) return null;
    poserStyle();
    const total = Number.isInteger(d.total) && d.total >= liste.length ? d.total : liste.length, montre = combien(lignesDe(o && o.w, 4));
    const c = el('div', 'ws-corps ws-disques'), ul = el('ul', 'ws-liste');
    // Tous les disques servis sont posés ; ceux que la carte ne tient pas sont cachés (caser, à chaque changement de taille).
    ul.append(...liste.map(ligneDisque)); c.append(ul, el('p', 'ws-plus'));
    c.dataset.total = String(total); c.dataset.montre = String(montre);
    montrer(c, montre);
    return tenir(c, T.disques.titre);
  }

  window.OdinWidgetsSante = { TEXTES, CSS, mesureLue, temperatureLue, disqueLu, combien, taille };
  // La déclaration de la famille (lue par pages/widgets-rendu.js, quel que soit l'ordre de chargement). Les tailles sont
  // celles de la maquette : 4 × 2 et 3 × 4. Proposées à qui a le droit sur l'appli lue (le serveur refuse tout autre).
  (window.OdinWidgetsFamilles = window.OdinWidgetsFamilles || []).push({ famille: 'sante', sortes: [
    { sorte: 'sante_machine', titre: T.machine.titre, quoi: T.machine.quoi, symbole: '🩺', appli: 'eir', poser: { c: 4, r: 2, pc: 4 }, vides: ['pas_encore_mesure'], sous: sousMachine, dessiner: machine },
    { sorte: 'sante_disques', titre: T.disques.titre, quoi: T.disques.quoi, symbole: '💽', appli: 'durinn', poser: { c: 3, r: 4, pc: 4 }, vides: ['disques_pas_encore_lus', 'aucun_disque'], sous: sousDisques, dessiner: disques },
  ] });
})();
