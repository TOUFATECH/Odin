// La famille « Maison » des widgets de l'accueil, sa sécurité (maquette validée « Accueil ») : « Sécurité » et « Caméra ».
// Rangées dans ce fichier pour ne pas écrire dans ceux des autres parts de la famille ; la famille déclarée est la même.
// Ce fichier DÉCLARE ses sortes au registre commun (pages/widgets-rendu.js) ; chaque dessin est fait de l'état que le
// serveur a rendu pour le widget (src/valhalla/widgets/maison-securite.ts) et de rien d'autre. Au propriétaire seul,
// jamais sur l'écran de la maison (la même marque que le serveur).
// - « Sécurité » MONTRE : ses serrures et leur état lu, ses portes qui ouvrent la maison, combien de caméras Odin connaît.
//   Rien ne s'y commande : ouvrir une serrure reste le geste de sa carte (glisser, puis l'accord) ; chaque ligne est un
//   bouton qui mène à l'appli où est cette carte (rien en mode « Modifier »). Ni alarme, ni bouclier, ni « protégé » ;
//   « Tout est fermé » seulement quand le serveur l'a établi, dit en tête du corps (pas seulement dans un sous-titre qu'une
//   petite carte coupe). La plus grave d'abord ; ce qui ne tient pas, ou que le serveur n'a pas servi : « et N de plus ».
// - « Caméra » : la VRAIE image, demandée à la route qui existe (GET /api/maison/camera?nom=…, le nom encodé), jamais un
//   dessin, jamais présentée comme un direct (c'est une image prise à la demande) ; redemandée toutes les PERIODE, et seulement quand
//   la carte est à l'écran, la page visible, hors du mode « Modifier », sur l'accueil ; une seule demande par caméra et
//   par période, montrée par toutes ses cartes. L'image n'est gardée que le temps
//   d'être montrée (une adresse « blob: » libérée dès qu'elle est remplacée ou que la carte s'en va), jamais en cache.
//   Une caméra qui ne répond pas : c'est dit, et l'image d'avant n'est plus montrée.
// - Tout texte venu d'une donnée (un nom de serrure, de porte, de pièce, de caméra) : textContent, coupé avec son entier
//   en info-bulle. Les nombres dans la langue de la page. Aucune langue écrite.
// Rien n'est touché au chargement : seulement window.OdinWidgetsMaisonSecurite (textes et calculs, pour les essais) et sa déclaration.
(() => {
  'use strict';
  if (window.OdinWidgetsMaisonSecurite) return;

  // ---------------- Dictionnaire (tous les textes de ces deux sortes)
  const pluriel = (n, un, plusieurs) => (n === 1 ? un : plusieurs);
  const N = (n) => nombre(n);
  /** Une nouvelle image toutes les 30 s : un rythme lent (la route prend une photo à chaque demande). */
  const PERIODE = 30_000;
  const TEXTES = {
    securite: {
      titre: 'Sécurité', quoi: 'Tes serrures, tes portes qui ouvrent la maison et tes caméras, d\'un coup d\'œil : seulement ce qu\'Odin lit vraiment.',
      toutFerme: 'Tout est fermé',
      ouvertes: (n) => `${N(n)} ${pluriel(n, 'ouverte', 'ouvertes')}`, nonLues: (n) => `${N(n)} ${pluriel(n, 'non lue', 'non lues')}`,
      inconnues: (n) => `${N(n)} ${pluriel(n, 'état inconnu', 'états inconnus')}`,
      sansNom: { serrure: 'Serrure', porte: 'Porte' },
      cameras: 'Caméras', camerasN: (n) => `${N(n)} ${pluriel(n, 'connue', 'connues')} par Odin`,
      vide: 'Aucune serrure, aucune porte, aucune caméra.', relier: 'Relier une serrure', ajouterCamera: 'Ajouter une caméra',
    },
    etats: {
      fermee: { serrure: 'Fermée à clé', porte: 'Fermée' }, ouverte: { serrure: 'Ouverte', porte: 'Ouverte' },
      non_lu: { serrure: 'État non lu', porte: 'État non lu' }, inconnu: { serrure: 'État inconnu', porte: 'État inconnu' },
    },
    camera: {
      titre: 'Caméra', quoi: 'L\'image d\'une de tes caméras, prise à la demande.',
      // L'heure où l'image est arrivée (la route peut rendre une prise de quelques secondes : jamais « prise à »).
      recue: (h) => `Reçue à ${h}`, rythme: (p) => `une image toutes les ${N(Math.round(p / 1000))} s`,
      attente: 'Image demandée…', panne: 'La caméra ne répond pas : aucune image récente.', alt: (nom) => `Image de la caméra ${nom}`,
      vides: { camera_non_choisie: 'Aucune caméra choisie.', aucune_camera: 'Aucune caméra dans Odin.', camera_absente: 'Cette caméra n\'existe plus.' },
      // Le bouton d'une carte sans caméra (il ouvre « Régler » sur le choix) ; aucune caméra : il mène à Cyclope.
      choisirQuoi: 'Choisir une caméra', ajouter: 'Ajouter une caméra',
    },
    // « Régler » : le choix de la caméra montrée (ses noms, tels qu'il les a nommées ; jamais « camera:… »).
    regler: { libelle: 'La caméra montrée', choisir: 'Choisir…', retire: 'Caméra retirée', aRanger: 'Appuie sur « Terminé », puis rouvre « Régler » pour choisir.' },
    // La pose depuis le tiroir (fenetre.js) : ce que la ligne du tiroir dit quand rien n'est posé.
    aucun: { camera: 'Aucune caméra dans Odin.' },
    poseIllisible: 'Odin ne lit pas tes caméras en ce moment : rien n\'est posé.',
    plus: (n) => `et ${N(n)} de plus`,
  };
  const T = TEXTES;

  // ---------------- Calculs (sans document)
  const langue = () => { try { return (typeof document !== 'undefined' && document && document.documentElement.lang) || undefined; } catch { return undefined; } };
  function nombre(v, lg = langue()) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '';
    try { return new Intl.NumberFormat(lg, { maximumFractionDigits: 1 }).format(v); } catch { return String(v); }
  }
  const texte = (v) => (typeof v === 'string' ? v : '');
  const entier = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  const ETATS = ['fermee', 'ouverte', 'non_lu', 'inconnu'];
  /** La gravité d'un état, pour ranger (la plus grave d'abord ; la même règle que le serveur). */
  const GRAVITE = { ouverte: 0, non_lu: 1, inconnu: 2, fermee: 3 };
  /** Les lignes que le serveur a comptées mais pas servies (au-delà de sa borne) ; sans compte : 0, rien d'inventé. */
  function nonServies(d) {
    if (!d || typeof d !== 'object' || !d.comptes || typeof d.comptes !== 'object') return 0;
    const c = d.comptes, total = entier(c.fermees) + entier(c.ouvertes) + entier(c.nonLues) + entier(c.inconnues);
    const servies = (Array.isArray(d.serrures) ? d.serrures.length : 0) + (Array.isArray(d.ouvertures) ? d.ouvertures.length : 0);
    return Math.max(0, total - servies);
  }
  /** L'en-tête de « Sécurité » : « Tout est fermé » seulement si le serveur l'a établi ; sinon ce qui est ouvert, non lu, inconnu. */
  function entete(d) {
    if (!d || typeof d !== 'object') return '';
    if (d.toutFerme === true) return T.securite.toutFerme;
    const c = d.comptes && typeof d.comptes === 'object' ? d.comptes : {};
    return [entier(c.ouvertes) ? T.securite.ouvertes(c.ouvertes) : '', entier(c.nonLues) ? T.securite.nonLues(c.nonLues) : '', entier(c.inconnues) ? T.securite.inconnues(c.inconnues) : ''].filter(Boolean).join(' · ');
  }
  /** L'adresse de l'image : la route qui existe, le nom encodé (il ne peut rien y ajouter). Un nom illisible : ''. */
  const adresseImage = (nom) => (typeof nom === 'string' && nom.trim() ? `/api/maison/camera?nom=${encodeURIComponent(nom)}` : '');
  /** Faut-il demander une image maintenant ? À l'écran, page visible, hors « Modifier », sur l'accueil, et pas avant PERIODE. */
  const aDemander = (o) => Boolean(o) && o.aLEcran === true && o.pageVisible === true && o.modifier !== true && o.ecran === 'accueil' && (o.force === true || !(Number(o.maintenant) - Number(o.dernier || 0) < PERIODE));
  /** L'heure d'une image dans la langue de la page (le fuseau de l'appareil qui regarde). */
  function heure(at) { try { return new Intl.DateTimeFormat(langue(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(at)); } catch { return ''; } }

  // ---------------- Le choix de la caméra (la pose depuis le tiroir et « Régler », par fenetre.js)
  /** Un nom de caméra choisissable : la règle du serveur (cameraDe) — tel quel sans espace autour, 80 signes au plus, jamais un nom réservé. */
  const NOM_MAX = 80, RESERVES = ['__proto__', 'constructor', 'prototype'];
  const nomChoisissable = (x) => typeof x === 'string' && x.trim() === x && x.length > 0 && x.length <= NOM_MAX && !RESERVES.includes(x);
  const CIBLE = /^camera:(.+)$/s;
  /** Le genre à choisir à la pose : « camera » pour « Caméra » ; une autre sorte : '' (pas concernée). */
  const genrePose = (kind) => (kind === 'maison_camera' ? 'camera' : '');
  /** La raison de la carte posée sans choix (le serveur rend la même tant qu'elle n'est pas choisie). */
  const raisonNonChoisie = 'camera_non_choisie';
  /**
   * Les choix d'une pose, tirés de ce que l'écran de la maison reçoit déjà (etat.cameras de /api/maison/etat, lu avec
   * sa session) : ses caméras, sous la forme des choix du serveur ({ cible, nom }), 300 au plus. Rien de lisible : null.
   */
  function choixDePose(kind, _rooms, etat) {
    if (!genrePose(kind) || !etat || typeof etat !== 'object' || !Array.isArray(etat.cameras)) return null;
    return etat.cameras.filter(nomChoisissable).slice(0, 300).map((nom) => ({ cible: `camera:${nom}`, nom }));
  }
  /**
   * Le champ du choix de « Régler » pour « Caméra », ou rien (une autre sorte). `e` : l'état que le serveur a rendu pour
   * CE widget (sa liste n'y est que pour le propriétaire, sur l'accueil), ou la liste lue à la pose. Les mêmes clés que
   * celui des appareils : { libelle, options: [{ v, texte }], depart, sansListe, aide, titre(v) } ; jamais « camera:… »
   * dans un texte. Le choix d'avant reste dans la liste ; retiré de Cyclope, il y est sous un mot neutre.
   */
  function champChoix(w, e) {
    if (!w || !genrePose(w.kind)) return null;
    const m = typeof w.cible === 'string' ? CIBLE.exec(w.cible) : null, depart = m && nomChoisissable(m[1]) ? w.cible : '';
    const lus = e && Array.isArray(e.choix) ? e.choix : null;
    const liste = (lus ?? []).filter((c) => c && typeof c.cible === 'string' && CIBLE.test(c.cible) && nomChoisissable(c.cible.slice(7)));
    const options = [];
    if (!depart) options.push({ v: '', texte: T.regler.choisir });
    else if (!liste.some((c) => c.cible === depart)) options.push({ v: depart, texte: T.regler.retire });
    for (const c of liste) options.push({ v: c.cible, texte: c.cible.slice(7) });
    const titre = (v) => {
      const c = liste.find((x) => x.cible === v); if (!c) return '';
      // Une aide (le titre du champ, l'en-tête de la fenêtre), jamais rangée : un nom long finit par « … ».
      const t = c.cible.slice(7);
      return t.length > 40 ? `${t.slice(0, 39).trimEnd()}…` : t;
    };
    return { libelle: T.regler.libelle, options, depart, sansListe: lus === null, aide: lus === null ? T.regler.aRanger : !liste.length ? T.aucun.camera : '', titre };
  }

  // ---------------- Dessin (seulement quand un hôte l'appelle)
  const SVG = {
    cadenas: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    ouvert: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
    porte: '<path d="M6 21V4h12v17M4 21h16"/><path d="M14.5 12.5v.5"/>',
    camera: '<rect x="3" y="7" width="13" height="11" rx="2"/><path d="M16 11l5-3v9l-5-3"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[k] ?? ''}</svg>`;
  // Les couleurs : celles du thème d'Odin (--accent, --good, --warn, --ink, --muted, --line, --field). Aucune couleur écrite.
  const CSS = `
:has(>.wsc){display:flex;flex-direction:column}
.wsc{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column;gap:6px;margin-top:8px;color:var(--ink,var(--text,inherit))}
.wsc [hidden]{display:none!important}
/* La liste suit ses lignes (« et N de plus » vient juste dessous) et rétrécit quand elles ne tiennent pas. */
.wsc-li{margin:0;padding:0;flex:0 1 auto;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:2px}
.wsc-l{flex:none;display:flex;align-items:center;gap:8px;min-height:44px;min-width:0;width:100%;margin:0;padding:0 4px;border:0;border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:start}
button.wsc-l{cursor:pointer}button.wsc-l:focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:-2px}
.fe-edit button.wsc-l{pointer-events:none}
.wsc-etat{flex:none;margin:0;font-size:13px;font-weight:650;line-height:1.3;color:var(--ink,inherit);overflow-wrap:anywhere}
.wsc-etat[data-ton="alarme"]{color:var(--warn,inherit)}
.wsc-ic{flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;color:var(--wsc-c,var(--muted,currentColor));background:color-mix(in srgb,var(--wsc-c,var(--muted,currentColor)) 16%,transparent)}
.wsc-ic svg{width:17px;height:17px}
.wsc-t{flex:1;min-width:0;display:flex;flex-direction:column}
.wsc-nom{display:block;min-width:0;font-size:13px;font-weight:650;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;unicode-bidi:isolate}
.wsc-s{display:block;min-width:0;font-size:11.5px;line-height:1.25;color:var(--muted,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wsc-l[data-ton="alarme"]{--wsc-c:var(--warn,currentColor)}.wsc-l[data-ton="alarme"] .wsc-s{color:var(--warn,inherit);font-weight:650}
.wsc-l[data-ton="calme"]{--wsc-c:var(--good,currentColor)}
.wsc-plus{flex:none;min-height:1.3em;font-size:11.5px;line-height:1.3;color:var(--muted,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wsc-calme{margin:0;font-size:13px;line-height:1.35;color:var(--muted,inherit);overflow-wrap:anywhere}
.wsc-btns{display:flex;flex-wrap:wrap;gap:6px;min-width:0}
/* Un libellé trop long pour une petite carte passe à la ligne (jamais coupé). */
.wsc-btn{flex:0 1 auto;max-width:100%;min-height:44px;min-width:44px;padding:4px 12px;border-radius:12px;border:1px solid var(--line,currentColor);background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:650;line-height:1.2;cursor:pointer;white-space:normal;overflow-wrap:anywhere;text-align:center}
.wsc-btn:focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:2px}
.fe-edit .wsc-btn{pointer-events:none}
/* « Choisir une caméra » ouvre « Régler », en mode « Modifier » aussi (il ne commande rien). */
.fe-edit .wsc-btn[data-action=choisir]{pointer-events:auto}
/* La caméra : l'image garde ses proportions (ni étirée, ni déformée), dans le cadre de la carte. */
.wsc-cam{gap:4px}
.wsc-cadre{flex:1 1 auto;min-height:0;min-width:0;display:grid;place-items:center;border-radius:12px;overflow:hidden;background:color-mix(in srgb,var(--field,var(--card2,currentColor)) 70%,transparent)}
.wsc-img{display:block;width:100%;height:100%;min-height:0;object-fit:contain}
.wsc-dit{flex:none;margin:0;min-height:1.3em;font-size:11.5px;line-height:1.3;color:var(--muted,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wsc-cam[data-panne] .wsc-dit{color:var(--warn,inherit);font-weight:650}
/* Une carte basse (3 × 2) : l'image prend toute la hauteur, la phrase (l'heure de la prise) reste dite, posée dessus. */
.wsc-cam{position:relative}
@container (max-height:140px){.wsc-cam:not([data-panne]) .wsc-dit{position:absolute;left:6px;bottom:6px;max-width:calc(100% - 12px);padding:2px 8px;border-radius:8px;background:color-mix(in srgb,var(--card,var(--bg,Canvas)) 85%,transparent);color:var(--ink,var(--text,inherit))}}`;
  function poserStyle() {
    const R = window.OdinWidgetsRendu;
    if (R && typeof R.poserStyle === 'function') R.poserStyle();
    if (document.getElementById('odinWidgetsMaisonSecurite')) return;
    // La carte garde sa taille sur la grille (une longue liste ne l'étire pas) ; au téléphone, la hauteur suit le contenu,
    // et l'image d'une caméra (en portrait aussi) est bornée à un peu plus de la moitié de l'écran.
    const G = window.OdinGrille, tel = G && G.GRILLE && Number.isInteger(G.GRILLE.telephone) ? G.GRILLE.telephone : 700;
    const s = document.createElement('style'); s.id = 'odinWidgetsMaisonSecurite'; s.textContent = `${CSS}\n@media (min-width:${tel + 1}px){.fe-w>.wsc{contain:size}.fe-w>.wsc-cam{container-type:size}}\n@media (max-width:${tel}px){.wsc-img{max-height:56vh}}`; document.head.append(s);
  }
  function el(t, cls, txt) { const n = document.createElement(t); if (cls) n.className = cls; if (txt !== undefined) n.textContent = txt; return n; }
  const icone = (k) => { const s = el('span', 'wsc-ic'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = svg(k); return s; };

  /** Ce qui tient : chaque ligne qui sort de la liste est cachée, avec celles d'après, et « et N de plus » le dit (une au moins reste). */
  function caser(liste) {
    const items = [...liste.querySelectorAll('[data-item]')], plus = liste.wscPlus, extra = entier(liste.wscExtra);
    const montrer = (n) => { items.forEach((x, i) => { x.hidden = i >= n; }); if (plus) plus.textContent = items.length - n + extra > 0 ? T.plus(items.length - n + extra) : ''; };
    montrer(items.length);
    const b = liste.getBoundingClientRect(); if (!b.width) return;
    let k = items.findIndex((x) => x.getBoundingClientRect().bottom > b.bottom + 0.5); if (k < 0) k = items.length;
    montrer(Math.max(1, k));
  }
  let veilleur = null;
  function tenir(liste) {
    if (typeof ResizeObserver !== 'function') { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => caser(liste)); return; }
    // La boîte est suivie (pas la liste, qui suit ses lignes) : une carte agrandie montre à nouveau ce qui tient.
    const boite = liste.parentElement || liste; boite.wscListe = liste;
    if (!veilleur) veilleur = new ResizeObserver((l) => { for (const x of l) { if (x.target.isConnected) caser(x.target.wscListe || x.target); else veilleur.unobserve(x.target); } });
    veilleur.observe(boite);
  }
  /** Un bouton qui mène à une appli (rien en mode « Modifier »). */
  function versAppli(libelle, appli) {
    const b = el('button', 'wsc-btn', libelle); b.type = 'button'; b.title = libelle;
    b.addEventListener('click', (ev) => { ev.stopPropagation(); if (b.closest('.fe-edit')) return; location.hash = `#app=${appli}`; });
    return b;
  }

  /** « Sécurité » : une ligne par serrure, par porte, puis les caméras ; chaque état est celui que le serveur a lu. */
  function securite(e, o) {
    poserStyle();
    const box = el('div', 'wsc wsc-sec');
    if (!e || e.etat === 'vide') {
      const btns = el('div', 'wsc-btns');
      if (!(o && o.ecran === 'maison')) btns.append(versAppli(T.securite.relier, 'midgard'), versAppli(T.securite.ajouterCamera, 'himinbjorg'));
      box.append(el('p', 'wsc-calme', T.securite.vide), btns);
      return box;
    }
    const d = (e && e.donnee) || {}, liste = el('div', 'wsc-li'), plus = el('span', 'wsc-plus'), maison = Boolean(o && o.ecran === 'maison');
    liste.setAttribute('role', 'list');
    /** Une ligne : un bouton qui mène à l'appli (jamais sur l'écran de la maison, où elle n'est qu'un texte). */
    const rangee = (appli, etiquette) => {
      const r = el(maison ? 'div' : 'button', 'wsc-l'); r.setAttribute('role', 'listitem'); r.dataset.item = '';
      if (!maison) {
        r.type = 'button'; r.setAttribute('aria-label', etiquette); r.title = etiquette;
        r.addEventListener('click', (ev) => { ev.stopPropagation(); if (r.closest('.fe-edit')) return; location.hash = `#app=${appli}`; });
      }
      return r;
    };
    const ligne = (x, genre) => {
      if (!x || typeof x !== 'object') return null;
      const etat = ETATS.includes(x.etat) ? x.etat : 'inconnu', t = el('span', 'wsc-t');
      const nom = el('b', 'wsc-nom', texte(x.nom) || T.securite.sansNom[genre]), s = el('span', 'wsc-s', [T.etats[etat][genre], texte(x.piece)].filter(Boolean).join(' · '));
      const li = rangee('midgard', `${nom.textContent} · ${s.textContent}`);
      nom.title = nom.textContent; s.title = s.textContent; li.dataset.etat = etat;
      if (etat === 'ouverte') li.dataset.ton = 'alarme'; else if (etat === 'fermee') li.dataset.ton = 'calme';
      t.append(nom, s); li.append(icone(genre === 'porte' ? 'porte' : etat === 'ouverte' ? 'ouvert' : 'cadenas'), t);
      return li;
    };
    // Serrures et portes ensemble, la plus grave d'abord (à gravité égale : serrures, puis portes, dans l'ordre servi).
    const lignes = [...(Array.isArray(d.serrures) ? d.serrures : []).map((x) => ligne(x, 'serrure')), ...(Array.isArray(d.ouvertures) ? d.ouvertures : []).map((x) => ligne(x, 'porte'))]
      .filter(Boolean).map((x, i) => [x, i]).sort((a, b) => GRAVITE[a[0].dataset.etat] - GRAVITE[b[0].dataset.etat] || a[1] - b[1]).map((x) => x[0]);
    const cams = d.cameras && typeof d.cameras === 'object' && entier(d.cameras.n) > 0 ? d.cameras : null;
    if (cams) {
      const t = el('span', 'wsc-t'), nom = el('b', 'wsc-nom', T.securite.cameras), s = el('span', 'wsc-s', T.securite.camerasN(cams.n));
      const noms = (Array.isArray(cams.noms) ? cams.noms : []).filter((x) => typeof x === 'string');
      const li = rangee('himinbjorg', `${T.securite.cameras} · ${s.textContent}`);
      nom.title = T.securite.cameras; s.title = noms.length ? noms.join(', ') : s.textContent;
      t.append(nom, s); li.append(icone('camera'), t); lignes.push(li);
    }
    liste.append(...lignes); liste.wscPlus = plus; liste.wscExtra = nonServies(d);
    // L'état en tête du corps, en entier (un sous-titre d'en-tête est coupé dans une petite carte).
    const dit = entete(d);
    if (dit) { const p = el('p', 'wsc-etat', dit); p.title = dit; if (entier(d.comptes && d.comptes.ouvertes)) p.dataset.ton = 'alarme'; box.append(p); }
    box.append(liste, plus);
    tenir(liste);
    return box;
  }
  // L'état est dit dans le corps (plus haut) : le sous-titre de l'en-tête ne le répète pas.
  const sousSecurite = () => '';

  // ---------------- « Caméra » : l'image, demandée lentement, seulement quand elle se voit
  /** Les cartes « Caméra » dessinées, par widget : sa boîte, son image, le nom de sa caméra. */
  const SUIVIS = new Map();
  /**
   * Les prises, par caméra (son nom) : l'adresse « blob: » montrée, l'heure d'arrivée, celle de la dernière demande, la
   * panne. Partagées par toutes les cartes de la même caméra : dix cartes ne font qu'une demande par période.
   */
  const PRISES = new Map();
  const priseDe = (nom) => { let p = PRISES.get(nom); if (!p) { p = { url: '', at: 0, dernier: 0, panne: false, enCours: false }; PRISES.set(nom, p); } return p; };
  let tic = null;
  const libere = (s) => { if (s && s.url) { try { URL.revokeObjectURL(s.url); } catch { /* rien */ } s.url = ''; } };
  const modifier = (box) => Boolean(box.closest && box.closest('.fe-edit'));
  const visible = () => { try { return document.visibilityState === 'visible'; } catch { return false; } };
  function aLEcran(box) {
    if (!box.isConnected || !box.getClientRects().length) return false;
    const r = box.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < (window.innerHeight || 0) && r.left < (window.innerWidth || 0);
  }
  /** Une carte montre la prise de sa caméra : l'image si elle est là, sinon rien ; et la phrase. */
  function montrer(s) {
    const p = priseDe(s.nom);
    if (p.url && !p.panne) { if (s.img.getAttribute('src') !== p.url) s.img.src = p.url; s.img.hidden = false; }
    else { s.img.removeAttribute('src'); s.img.hidden = true; }
    const t = p.panne ? T.camera.panne : p.at ? `${T.camera.recue(heure(p.at))} · ${T.camera.rythme(PERIODE)}` : T.camera.attente;
    s.dit.textContent = t; s.dit.title = t;
    // En panne : ni image, ni cadre vide au-dessus du message.
    if (p.panne) s.box.dataset.panne = ''; else s.box.removeAttribute('data-panne');
    if (s.cadre) s.cadre.hidden = p.panne;
  }
  /** Les cartes encore à l'écran de cette caméra. */
  const cartesDe = (nom) => [...SUIVIS.values()].filter((s) => s.nom === nom && s.box.isConnected);
  /** Une caméra que plus aucune carte ne montre : son image est libérée, sa prise oubliée. */
  const oublier = (nom) => { if (!cartesDe(nom).length) { libere(PRISES.get(nom)); PRISES.delete(nom); } };
  /** UNE demande pour une caméra, montrée par toutes ses cartes. */
  async function demander(nom) {
    const p = priseDe(nom);
    if (p.enCours) return;
    p.enCours = true; p.dernier = Date.now();
    const vieille = p.url;
    try {
      const r = await fetch(adresseImage(nom), { credentials: 'same-origin', cache: 'no-store', headers: { 'x-odin': '1' } });
      const type = String(r.headers.get('content-type') || '');
      if (!r.ok || !type.startsWith('image/')) throw new Error('pas une image');
      p.url = URL.createObjectURL(await r.blob()); p.at = Date.now(); p.panne = false;
    } catch {
      // Pas d'image figée présentée comme actuelle : celle d'avant est retirée.
      p.url = ''; p.panne = true; p.at = 0;
    } finally {
      p.enCours = false;
      for (const s of cartesDe(nom)) montrer(s);
      // L'image d'avant n'est libérée qu'une fois remplacée partout.
      if (vieille && vieille !== p.url) { try { URL.revokeObjectURL(vieille); } catch { /* rien */ } }
      if (PRISES.get(nom) === p) oublier(nom); else libere(p);
    }
  }
  /**
   * Un tour : les cartes parties sont oubliées (l'image d'une caméra que plus rien ne montre est libérée) ; une caméra
   * dont au moins une carte est à l'écran, page visible, hors « Modifier », est demandée si c'est le moment — une fois.
   */
  function demanderTout(force) {
    const noms = new Set();
    for (const [wid, s] of SUIVIS) {
      if (!s.box.isConnected) { SUIVIS.delete(wid); continue; }
      if (aDemander({ aLEcran: aLEcran(s.box), pageVisible: visible(), modifier: modifier(s.box), ecran: s.ecran, dernier: priseDe(s.nom).dernier, maintenant: Date.now(), force: force === true })) noms.add(s.nom);
    }
    for (const nom of [...PRISES.keys()]) if (!PRISES.get(nom).enCours) oublier(nom);
    for (const nom of noms) demander(nom);
    if (!SUIVIS.size && tic) { clearInterval(tic); tic = null; }
  }
  let ecoute = false;
  function suivre(s) {
    // Redessinée (une nouvelle lecture de la page), ou une autre carte de la même caméra : elle montre la prise qui
    // existe déjà, sans redemander.
    SUIVIS.set(s.wid, s); montrer(s);
    if (!tic) tic = setInterval(demanderTout, 2000);
    if (!ecoute) { ecoute = true; document.addEventListener('visibilitychange', () => { if (visible()) demanderTout(); }); }
    setTimeout(demanderTout, 0);
  }
  function camera(e, o) {
    poserStyle();
    const box = el('div', 'wsc wsc-cam'), w = (o && o.w) || {};
    if (!e || e.etat !== 'ok') {
      const raison = e && typeof e.raison === 'string' ? e.raison : '';
      box.append(el('p', 'wsc-calme', T.camera.vides[raison] || T.camera.vides.camera_absente));
      // Le seul geste qui y remédie, pour lui sur son accueil (le serveur ne sert la liste des choix qu'à lui) : « Choisir »
      // ouvre « Régler » sur le choix (le bouton « ⋯ » de la carte, celui de tous les widgets, en mode « Modifier » aussi) ;
      // aucune caméra dans Odin : « Ajouter une caméra » mène à Cyclope.
      if (e && Array.isArray(e.choix) && !(o && o.ecran === 'maison')) {
        const btns = el('div', 'wsc-btns'), aucune = raison === 'aucune_camera' || (raison === 'camera_absente' && !e.choix.length);
        if (aucune) btns.append(versAppli(T.camera.ajouter, 'himinbjorg'));
        else if (raison === 'camera_non_choisie' || raison === 'camera_absente') {
          const b = el('button', 'wsc-btn', T.camera.choisirQuoi); b.type = 'button'; b.dataset.action = 'choisir';
          b.addEventListener('click', (ev) => { ev.stopPropagation(); const r = b.closest && b.closest('.fe-w'), plus = r && r.querySelector('.wr-plus'); if (plus) plus.click(); });
          btns.append(b);
        }
        if (btns.childElementCount) box.append(btns);
      }
      return box;
    }
    const nom = texte(e.donnee && e.donnee.nom), cadre = el('div', 'wsc-cadre'), img = el('img', 'wsc-img'), dit = el('p', 'wsc-dit');
    img.alt = T.camera.alt(nom); img.decoding = 'async'; img.hidden = true; img.draggable = false;
    dit.setAttribute('role', 'status'); cadre.append(img); box.append(cadre, dit);
    const s = { wid: texte(w.id) || nom, nom, box, cadre, img, dit, ecran: o && o.ecran === 'maison' ? 'maison' : 'accueil' };
    // Jamais sur l'écran de la maison : rien n'y est demandé (le serveur ne l'y sert pas de toute façon).
    if (s.ecran === 'maison' || !adresseImage(nom)) { dit.textContent = T.camera.attente; dit.title = T.camera.attente; return box; }
    suivre(s);
    return box;
  }
  const sousCamera = (e) => (e && e.etat === 'ok' ? texte(e.donnee && e.donnee.nom) : '');

  // `genrePose`, `choixDePose`, `champChoix`, `raisonNonChoisie` et les textes `aucun`, `poseIllisible` : le point
  // d'accroche de la pose depuis le tiroir et de « Régler » (fenetre.js), le même que celui des appareils de la maison.
  window.OdinWidgetsMaisonSecurite = { TEXTES, CSS, PERIODE, nombre, entete, nonServies, adresseImage, aDemander, demanderTout, genrePose, choixDePose, champChoix, raisonNonChoisie };
  // La déclaration (lue par pages/widgets-rendu.js) : la famille « maison », au propriétaire seul, jamais sur l'écran de
  // la maison (la même marque que le serveur). L'appli lue range la ligne du tiroir avec la maison (la maquette : « Maison »).
  // « Caméra » : à la pose, l'unique caméra est prise d'office ; plusieurs : « Régler » s'ouvre sur le choix ; aucune :
  // rien n'est posé (sa réponse du 25/11 : rien n'est montré tant qu'Odin n'a pas la vraie donnée).
  (window.OdinWidgetsFamilles = window.OdinWidgetsFamilles || []).push({ famille: 'maison', sortes: [
    { sorte: 'maison_securite', titre: T.securite.titre, quoi: T.securite.quoi, symbole: '🔒', appli: 'midgard', proprio: true, jamaisALaMaison: true, poser: { c: 4, r: 3, pc: 4 }, vides: ['rien_a_surveiller'], sous: sousSecurite, dessiner: securite },
    { sorte: 'maison_camera', titre: T.camera.titre, quoi: T.camera.quoi, symbole: '📷', appli: 'himinbjorg', proprio: true, jamaisALaMaison: true, poser: { c: 4, r: 3, pc: 4 }, vides: ['camera_non_choisie', 'aucune_camera', 'camera_absente'], sous: sousCamera, dessiner: camera },
  ] });
})();
