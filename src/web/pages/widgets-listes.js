// La famille « Listes d'Odin » des widgets de l'accueil (maquette validée « Accueil ») : « Agenda » (les prochains
// rendez-vous de Chronos), « Recherche » (les dernières recherches de Pythie), « Sauvegardes » (l'état des sauvegardes
// de Phénix) et « Pubs bloquées » (ce que Sphinx a bloqué aujourd'hui), pour le propriétaire seul.
// Ce fichier DÉCLARE ses sortes au registre commun (pages/widgets-rendu.js) ; l'accueil les dessine et les propose sans
// rien savoir d'elles. Chaque dessin est fait de l'état que le serveur a rendu (src/valhalla/widgets/listes.ts).
// - Le jour et l'heure d'un rendez-vous sont écrits dans le fuseau d'Odin (donné par le serveur), dans la langue de la
//   page, sur 12 ou 24 h comme Odin est réglé ; jamais dans le fuseau de l'appareil : sans fuseau lisible, rien.
// - Toucher une recherche ouvre Pythie sur elle (sa page rouvre une recherche gardée : /recherche#r=…).
// - Le widget « Recherche » porte d'abord le champ « Pose ta question… » (la liste vient dessous, à partir de trois
//   lignes de grille). La question est une donnée privée : elle est confiée à la page de Pythie par le stockage de
//   session de l'onglet (lue puis effacée aussitôt par Pythie), jamais dans une adresse ni dans l'historique ; l'accueil
//   ne l'envoie nulle part. Stockage fermé : Pythie s'ouvre sans question. En mode « Modifier », rien ne part.
// - Tout texte venu d'un rendez-vous ou d'une recherche (un titre peut venir d'une invitation extérieure, une question
//   est un texte libre) est posé par textContent, isolé dans son sens d'écriture, et coupé à l'écran ; les icônes sont
//   dessinées ici.
// - La liste tient dans sa carte : autant de lignes que sa hauteur en tient, puis « et N de plus » ; elle défile au besoin.
// - « Sauvegardes » : la coche verte seulement avec une sauvegarde réussie mesurée, sans échec, ni retard, ni plan jamais
//   fait ; un échec est écrit dans la couleur « grave » du thème. « Pubs bloquées » : des comptes (aucun domaine, aucun
//   appareil) ; Sphinx arrêté ou sans question : une phrase, jamais un zéro. Les heures, dans le fuseau d'Odin ; les
//   nombres et les volumes, dans la langue de la page.
// - Ces deux cartes ne défilent pas : trop basses ou trop étroites (deux lignes de grille, 768 px), elles se resserrent
//   par étapes, du moins utile au plus utile (le détail, puis ce qui ne va pas dit en bref, puis l'icône, puis un corps plus
//   petit) ; un échec n'est jamais retiré. Si rien ne suffit, la zone défile, avec un nom pour le clavier.
// Rien n'est touché au chargement : seulement window.OdinWidgetsListes (ses textes et calculs, pour les essais) et sa déclaration.
(() => {
  'use strict';
  if (window.OdinWidgetsListes) return;

  // ---------------- Dictionnaire (tous les textes de la famille)
  const TEXTES = {
    agenda: {
      titre: 'Agenda', quoi: 'Chronos : tes prochains rendez-vous',
      aucun: 'Aucun rendez-vous à venir.', ouvrir: 'Ouvrir Chronos', attente: 'à confirmer', plus: (n) => `et ${n} de plus`,
    },
    recherches: {
      titre: 'Recherche', quoi: 'Pythie : tes dernières recherches',
      question: 'Question', invite: 'Pose ta question…', chercher: 'Chercher',
      aucune: 'Aucune recherche pour l\'instant.', ouvrir: (q) => `Ouvrir dans Pythie : ${q}`, ouvrirPythie: (q) => `Ouvrir Pythie (cette recherche n'y est plus) : ${q}`, plus: (n) => `et ${n} de plus`,
    },
    sauvegardes: {
      titre: 'Sauvegardes', quoi: 'Phénix : la dernière sauvegarde et la prochaine',
      aucune: 'Aucune sauvegarde réglée.', ouvrir: 'Ouvrir Phénix', sansReussite: 'Aucune sauvegarde réussie pour l\'instant',
      prochaine: (h) => `Prochaine : ${h}`,
      sortes: { 'complète': 'Complète', 'incrémentielle': 'Incrémentielle', 'différentielle': 'Différentielle' },
      echec: (n, quand) => (n === 1 ? `Une sauvegarde a échoué${quand ? ` (${quand})` : ''}` : `${n} sauvegardes ont échoué${quand ? `, la dernière ${quand}` : ''}`),
      retard: (n) => (n === 1 ? 'Une sauvegarde est en retard' : `${n} sauvegardes sont en retard`),
      jamais: (n) => (n === 1 ? 'Une sauvegarde n\'a jamais été faite' : `${n} sauvegardes n'ont jamais été faites`),
      // En bref, quand la carte est trop petite pour les phrases entières (`n` : le nombre déjà écrit dans la langue de la page).
      echecBref: (k, n) => (k === 1 ? `${n} échec` : `${n} échecs`), retardBref: (k, n) => `${n} en retard`, jamaisBref: (k, n) => (k === 1 ? `${n} jamais faite` : `${n} jamais faites`),
    },
    pubs: {
      titre: 'Pubs bloquées', quoi: 'Sphinx : pubs et pisteurs bloqués pour toute la maison',
      arrete: 'Sphinx est arrêté : rien n\'est compté.', aucune: 'Aucune question au DNS aujourd\'hui.', ouvrir: 'Ouvrir Sphinx',
      arreteBref: 'Sphinx est arrêté.', aucuneBref: 'Aucune question aujourd\'hui.',
      aujourdhui: 'Aujourd\'hui', depuis: (h) => `Depuis ${h}`, sur: (n) => `bloquées sur ${n}`,
    },
  };
  const T = TEXTES;

  // ---------------- Calculs (sans document)
  const JOUR = 86_400_000;
  /** Combien de lignes montrer selon la hauteur du widget (en lignes de la grille) : une de moins, une au moins. */
  const combien = (r) => Math.max(1, (Number.isInteger(r) ? r : 3) - 1);
  /** L'agenda, comme la maquette : à partir de quatre lignes de grille, une ligne de plus. */
  const combienAgenda = (r) => combien(r) + (Number.isInteger(r) && r >= 4 ? 1 : 0);
  /**
   * Le jour et l'heure d'un rendez-vous, dans le fuseau d'Odin et la langue donnée. `r` : { fuseau, heure12 } (rendus
   * par le serveur). Rend { jour (court), num (le jour du mois), mois ('' si le rendez-vous est dans les six jours),
   * heures (« 09:30 – 10:30 », ou « 09:30 → mer. 4 09:30 » sur plusieurs jours), complet (la date entière) } ; sans
   * fuseau, ou avec un fuseau que le navigateur ne connaît pas : rien (null), jamais le fuseau de l'appareil.
   */
  function quand(debut, fin, r, langue, maintenant = Date.now()) {
    const fuseau = r && typeof r.fuseau === 'string' ? r.fuseau : '';
    if (!fuseau || !Number.isFinite(debut)) return null;
    try {
      const h12 = r.heure12 === true, f = (o) => new Intl.DateTimeFormat(langue, { timeZone: fuseau, ...o });
      const fh = f({ hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', ...(h12 ? { hour12: true } : { hourCycle: 'h23' }) });
      const jourDe = (t) => { const n = {}; for (const p of new Intl.DateTimeFormat('en', { timeZone: fuseau, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(t))) n[p.type] = p.value; return `${n.year}-${n.month}-${n.day}`; };
      const d = new Date(debut), fini = Number.isFinite(fin) && fin > debut ? fin : debut;
      let heures = fh.format(d);
      if (fini > debut) heures += jourDe(fini) === jourDe(debut) ? ` – ${fh.format(new Date(fini))}` : ` → ${f({ weekday: 'short', day: 'numeric' }).format(new Date(fini))} ${fh.format(new Date(fini))}`;
      return {
        jour: f({ weekday: 'short' }).format(d), num: f({ day: 'numeric' }).format(d),
        mois: debut - Number(maintenant) > 6 * JOUR ? f({ month: 'short' }).format(d) : '', heures,
        complet: f({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d),
      };
    } catch { return null; }
  }
  /** Un rendez-vous lu sans confiance : un titre, deux heures ; sinon rien. */
  function rdvLu(x) {
    if (!x || typeof x !== 'object' || typeof x.titre !== 'string' || !Number.isFinite(x.debut)) return null;
    return { titre: x.titre, debut: x.debut, fin: Number.isFinite(x.fin) ? x.fin : x.debut, attente: x.attente === true };
  }
  /** Une recherche lue sans confiance : une question ; son identifiant seulement s'il a la forme de ceux de Pythie. */
  function rechercheLue(x) {
    if (!x || typeof x !== 'object' || typeof x.q !== 'string' || !x.q.trim()) return null;
    return { id: typeof x.id === 'string' && /^[a-f0-9]{6,20}$/.test(x.id) ? x.id : '', q: x.q, at: Number.isFinite(x.at) ? x.at : 0 };
  }
  /** La recherche : à partir de trois lignes de grille, sous le champ, une ligne de moins que la hauteur ; avant : aucune. */
  const combienRecherche = (r) => { const n = Number.isInteger(r) ? r : 3; return n >= 3 ? n - 1 : 0; };
  /** La clé du stockage de session par laquelle l'accueil confie une question à la page de Pythie (qui l'efface en la lisant). */
  const CLE_QUESTION = 'odin.pythie.question';
  /** Une question confiée à Pythie vaut 15 secondes : passé ce délai (une navigation qui n'a pas eu lieu), Pythie l'ignore. */
  const DUREE_QUESTION = 15_000;
  // Ce qui n'est pas du texte dans une question : les caractères de contrôle, U+007F, les marques de sens d'écriture et les
  // séparateurs de ligne. Fabriqués ici par leur code (jamais écrits tels quels dans ce fichier).
  const HORS_TEXTE = new RegExp(`[${[...Array(32).keys(), 0x7f, 0x61c, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069].map((c) => String.fromCharCode(c)).join('')}]+`, 'g');
  /**
   * Une question tapée, bornée comme Pythie la borne : ce qui n'est pas du texte devient une espace, 1000 au plus, coupée
   * par caractères entiers (jamais une moitié d'émoji en fin de texte).
   */
  function questionNette(q) {
    if (typeof q !== 'string') return '';
    let x = q.replace(HORS_TEXTE, ' ').trim().slice(0, 1000);
    const c = x.charCodeAt(x.length - 1);
    if (c >= 0xd800 && c <= 0xdbff) x = x.slice(0, -1);
    return x.trim();
  }
  /** Retire une question confiée qui n'a pas été lue (Pythie ne s'est pas ouverte) : aucune ne traîne dans l'onglet. */
  function effacerQuestion() { try { sessionStorage.removeItem(CLE_QUESTION); } catch { /* stockage fermé : rien à retirer */ } }
  /** Où mène une recherche : Pythie rouverte sur elle, ou Pythie seule. */
  const lienRecherche = (s) => (s.id ? `/recherche#r=${s.id}` : '/recherche');

  // ---------------- Dessin (seulement quand un hôte l'appelle)
  const ICONES = {
    calme: '<circle cx="12" cy="12" r="8.5"/><path d="m8 12.5 3 3 5-6"/>',
    loupe: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
    alerte: '<path d="M12 4 3 19.5h18z"/><path d="M12 10v4.5M12 17h.01"/>',
    ouvrir: '<path d="M7 17 17 7"/><path d="M9 7h8v8"/>',
  };
  const icone = (k) => (Object.prototype.hasOwnProperty.call(ICONES, k) ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[k]}</svg>` : '');
  // Les couleurs : celles du thème d'Odin (--ink, --muted, --line, --accent, --warn, --good). Aucune couleur écrite ici.
  const CSS = `
:has(>.wl-corps){display:flex;flex-direction:column}
.wl-corps{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column;gap:6px;overflow:auto;overscroll-behavior:contain;color:var(--ink,var(--text,inherit))}
/* La partie qui défile : le retrait garde entier le contour du focus. */
.wl-defile{flex:1 1 auto;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;padding:3px;margin:-3px;display:flex;flex-direction:column;gap:4px}
.wl-defile>*{flex:none}
/* La zone qui porte la liste ne défile jamais elle-même (sinon, un arrêt du clavier sans nom) : seule la liste défile. */
.wl-corps.wl-porte{overflow:visible}
.wl-liste{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px;min-width:0}
.wl-calme{display:flex;flex-wrap:nowrap;align-items:center;gap:8px 12px;margin:0;font-size:13.5px;line-height:1.35}
.wl-calme>:first-child{flex:none;display:flex}.wl-ct{flex:1 1 auto;min-width:0}
.wl-calme svg{flex:none;width:22px;height:22px;color:var(--good,currentColor)}
.wl-btn{flex:none;align-self:flex-start;min-height:44px;min-width:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line,currentColor);background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:650;cursor:pointer}
.wl-btn:focus-visible,.wl-rech:focus-visible,.wl-q:focus-visible,.wl-go:focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:2px}
/* Le champ de la recherche (maquette : « Pose ta question… » et son bouton) : 44 px, les couleurs du thème. */
.wl-srch{flex:none;display:flex;gap:8px;min-width:0;margin:0}
.wl-q{flex:1 1 auto;min-width:0;width:0;box-sizing:border-box;min-height:44px;margin:0;padding:0 12px;border-radius:12px;border:1px solid var(--line,currentColor);background:color-mix(in srgb,var(--ink,currentColor) 5%,transparent);color:var(--ink,inherit);font:inherit;font-size:14px}
.wl-q::placeholder{color:var(--muted,inherit);opacity:1}
.wl-go{flex:none;width:44px;height:44px;margin:0;padding:0;border-radius:12px;border:0;display:grid;place-items:center;background:color-mix(in srgb,var(--accent,currentColor) 16%,transparent);color:var(--accent,currentColor);cursor:pointer}.wl-go svg{width:19px;height:19px}
.wl-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
/* Un rendez-vous : le jour (court, son numéro), le trait, le titre et les heures. */
.wl-rdv{display:flex;align-items:stretch;gap:10px;min-width:0;min-height:44px;padding:3px 0;border-bottom:1px solid var(--line,transparent)}.wl-rdv:last-child{border-bottom:0}
.wl-d{flex:none;width:40px;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.1;text-align:center;min-width:0}
.wl-j,.wl-m{font-size:11px;color:var(--muted,inherit);text-transform:uppercase;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.wl-n{font-size:17px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.wl-barre{flex:none;width:3px;border-radius:3px;background:var(--accent,currentColor)}.wl-rdv.wl-attente .wl-barre{background:var(--warn,currentColor)}
.wl-x{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:1px;font-size:13px;line-height:1.3}
.wl-t{display:block;font-weight:600;color:var(--ink,inherit);unicode-bidi:isolate;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wl-h{display:block;font-size:11.5px;color:var(--muted,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}
/* Les heures d'un rendez-vous et « à confirmer » : les heures se coupent d'abord, le statut reste entier. */
.wl-hl{display:flex;gap:.3em;min-width:0}.wl-hh{min-width:0;overflow:hidden;text-overflow:ellipsis}
.wl-at{flex:none;color:var(--warn,inherit);font-weight:650}
/* Une recherche : un lien vers Pythie, toute la ligne (44 px au moins). */
.wl-rech{display:flex;align-items:center;gap:10px;min-width:0;min-height:44px;padding:2px 6px;border-radius:12px;color:inherit;text-decoration:none}
.wl-rech:hover{background:color-mix(in srgb,var(--ink,currentColor) 6%,transparent)}
.wl-ic{flex:none;width:30px;height:30px;border-radius:10px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent,currentColor) 14%,transparent);color:var(--accent,currentColor)}.wl-ic svg{width:17px;height:17px}
/* « Sauvegardes » et « Pubs bloquées » (maquette : une pastille ou un anneau, la valeur, une ligne d'explication, en bas). */
.wl-neutre svg{color:var(--muted,currentColor)}
.wl-sv>:first-child,.wl-pb>:first-child{margin-top:auto}
.wl-l{display:flex;align-items:center;gap:12px;min-width:0}
.wl-etat{flex:none;width:46px;height:46px;border-radius:14px;display:grid;place-items:center}.wl-etat svg{width:24px;height:24px}
.wl-bon{background:color-mix(in srgb,var(--good,currentColor) 18%,transparent);color:var(--good,currentColor)}
.wl-attention{background:color-mix(in srgb,var(--warn,currentColor) 18%,transparent);color:var(--warn,currentColor)}
.wl-lx{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;line-height:1.3}
.wl-quand{font-size:16px;font-weight:700;color:var(--ink,inherit);overflow-wrap:anywhere}
.wl-detail,.wl-sur{font-size:12.5px;color:var(--muted,inherit);overflow-wrap:anywhere}
.wl-echec,.wl-retard,.wl-jamais,.wl-bref{margin:0;font-size:12.5px;font-weight:650;line-height:1.3;overflow-wrap:anywhere}
.wl-echec{color:var(--bad,currentColor)}.wl-retard,.wl-jamais{color:var(--warn,currentColor)}
/* Ces cartes ne défilent pas : elles se resserrent (étapes wl-s1 à wl-s4, ajoutées l'une après l'autre) ; en dernier recours
   seulement, la zone défile, avec un nom (wl-defilant). */
.wl-corps.wl-tient{overflow:hidden}.wl-corps.wl-tient.wl-defilant{overflow:auto}.wl-defilant:focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:-2px}
.wl-bref{display:none}
.wl-sv.wl-s1 .wl-detail{display:none}.wl-sv.wl-s2 .wl-long{display:none}.wl-sv.wl-s2 .wl-bref{display:block}.wl-sv.wl-s3 .wl-etat{display:none}.wl-sv.wl-s4 .wl-quand{font-size:13.5px}
.wl-pb.wl-s1 .wl-anneau{width:40px;height:40px}.wl-pb.wl-s2 .wl-anneau{display:none}.wl-pb.wl-s3 .wl-val{font-size:19px}.wl-pb.wl-s4 .wl-val{white-space:normal;font-size:17px}.wl-pb.wl-s4 .wl-sur{font-size:11.5px;line-height:1.2}
.wl-cm.wl-s1 .wl-calme>:first-child{display:none}.wl-cm.wl-s2 .wl-long{display:none}.wl-cm.wl-s2 .wl-bref{display:inline}.wl-cm.wl-s3 .wl-calme{font-size:12.5px}
/* La dernière étape d'un état calme : la phrase et le bouton côte à côte, le bouton réduit à son icône (son nom reste lu). */
.wl-bt-i{display:none}.wl-cm.wl-s4{flex-direction:row;align-items:center;gap:8px}.wl-cm.wl-s4 .wl-calme{flex:1 1 auto;min-width:0}
.wl-cm.wl-s4 .wl-btn{align-self:center;width:44px;padding:0;display:grid;place-items:center}.wl-cm.wl-s4 .wl-bt-i{display:flex}.wl-bt-i svg{width:19px;height:19px}
.wl-cm.wl-s4 .wl-bt-t{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.wl-anneau{flex:none;width:58px;height:58px}.wl-anneau circle{fill:none;stroke-width:4}
.wl-anneau .wl-fond{stroke:var(--line,currentColor)}.wl-anneau .wl-part{stroke:var(--accent,currentColor)}
.wl-val{font-size:26px;font-weight:750;line-height:1.1;color:var(--ink,inherit);font-variant-numeric:tabular-nums;white-space:nowrap;overflow-wrap:anywhere}
.wl-plus{margin:0;font-size:11.5px;color:var(--muted,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wl-plus:empty{display:none}`;
  function poserStyle() {
    const R = window.OdinWidgetsRendu;
    if (R && typeof R.poserStyle === 'function') R.poserStyle();
    if (document.getElementById('odinWidgetsListes')) return;
    // Hors téléphone, la carte de la grille a la hauteur de ses lignes : son corps ne compte pas dans cette hauteur (il
    // défile), si bien qu'une longue liste n'étire ni la carte, ni sa voisine. Au téléphone, la hauteur suit le contenu.
    const G = window.OdinGrille, tel = G && G.GRILLE && Number.isInteger(G.GRILLE.telephone) ? G.GRILLE.telephone : 700;
    const s = document.createElement('style'); s.id = 'odinWidgetsListes'; s.textContent = `${CSS}\n@media (min-width:${tel + 1}px){.fe-w>.wl-corps{contain:size}}`; document.head.append(s);
  }
  function el(t, cls, texte) { const n = document.createElement(t); if (cls) n.className = cls; if (texte !== undefined) n.textContent = texte; return n; }
  /** Un texte venu de dehors : du texte, isolé dans son sens d'écriture, en entier dans l'info-bulle. */
  function dehors(t, cls, texte) { const n = el(t, cls, texte); n.dir = 'auto'; n.title = texte; return n; }
  const langue = () => { try { return document.documentElement.lang || undefined; } catch { return undefined; } };
  const nombre = (n) => { try { return new Intl.NumberFormat(langue()).format(n); } catch { return String(n); } };
  const depuis = (at) => { const R = window.OdinWidgetsRendu; return R && typeof R.depuis === 'function' ? R.depuis(at) : ''; };
  const decor = (k, cls) => { const s = el('span', cls); s.setAttribute('aria-hidden', 'true'); s.innerHTML = icone(k); return s; };
  /** La hauteur du widget, en lignes de la grille. */
  function lignesDe(w, defaut) {
    const G = window.OdinGrille;
    try { if (G && typeof G.taille === 'function') return G.taille(w).r; } catch { /* la valeur écrite */ }
    return w && Number.isInteger(w.r) ? w.r : defaut;
  }
  /** Un état calme : son icône, sa phrase, au plus un bouton. `neutre` : une icône sans la couleur « tout va bien ». */
  function calme(texte, bouton, neutre = false) {
    poserStyle();
    const c = el('div', 'wl-corps'), l = el('p', `wl-calme${neutre ? ' wl-neutre' : ''}`);
    l.append(decor(neutre ? 'info' : 'calme'), el('span', 'wl-ct', texte)); c.append(l);
    if (bouton) c.append(bouton);
    return c;
  }
  /** La liste qui défile, et « et N de plus ». */
  function enListe(lignes, reste, plus) {
    const c = el('div', 'wl-corps wl-porte'), defile = el('div', 'wl-defile'), ul = el('ul', 'wl-liste');
    ul.append(...lignes); defile.append(ul);
    if (reste > 0) defile.append(el('p', 'wl-plus', plus(nombre(reste))));
    c.append(defile);
    return c;
  }

  /** « Agenda » : les prochains rendez-vous, le plus proche d'abord ; zéro (l'état « vide » du serveur) : « Ouvrir Chronos ». */
  function agenda(e, o) {
    if (e.etat === 'vide') {
      if (e.raison !== 'aucun_rendez_vous') return null;
      const b = el('button', 'wl-btn', T.agenda.ouvrir); b.type = 'button';
      b.addEventListener('click', (ev) => { ev.stopPropagation(); location.hash = '#app=frigg'; });
      return calme(T.agenda.aucun, o.ecran === 'maison' ? null : b);
    }
    const d = e.donnee || {}, reglage = { fuseau: d.fuseau, heure12: d.heure12 === true }, lg = langue();
    const liste = (Array.isArray(d.rendezVous) ? d.rendezVous : []).map(rdvLu).filter(Boolean).map((x) => ({ x, q: quand(x.debut, x.fin, reglage, lg) })).filter((y) => y.q);
    if (!liste.length) return null; // illisible, ou sans fuseau lisible : rien d'affirmé
    poserStyle();
    const total = Number.isInteger(d.total) && d.total >= liste.length ? d.total : liste.length, montres = liste.slice(0, combienAgenda(lignesDe(o.w, 3)));
    const lignes = montres.map(({ x, q }) => {
      const li = el('li', `wl-rdv${x.attente ? ' wl-attente' : ''}`), jour = el('time', 'wl-d'), t = el('div', 'wl-x'), h = el('span', 'wl-h wl-hl');
      h.append(el('span', 'wl-hh', q.heures));
      try { jour.dateTime = new Date(x.debut).toISOString(); } catch { /* sans attribut */ }
      jour.title = q.complet; jour.append(el('small', 'wl-j', q.jour), el('b', 'wl-n', q.num));
      if (q.mois) jour.append(el('small', 'wl-m', q.mois));
      if (x.attente) h.append(el('span', 'wl-at', ` · ${T.agenda.attente}`));
      const barre = el('i', 'wl-barre'); barre.setAttribute('aria-hidden', 'true');
      t.append(dehors('b', 'wl-t', x.titre), h);
      li.append(jour, barre, t);
      return li;
    });
    return enListe(lignes, total - montres.length, T.agenda.plus);
  }

  let numero = 0, nettoye = false;
  /**
   * Le champ « Pose ta question… » : un vrai formulaire (son étiquette pour les lecteurs d'écran, Entrée ou le bouton).
   * Valider confie la question nettoyée à Pythie (stockage de session de l'onglet) puis ouvre sa page ; le champ se vide.
   * Vide ou de blancs : rien. En mode « Modifier » : rien ne quitte l'accueil. Stockage fermé : Pythie s'ouvre sans question.
   * La question est datée (Pythie la refuse après 15 secondes) ; au premier dessin de l'accueil et à son retour depuis
   * l'historique, une question restée (la navigation n'a pas eu lieu) est effacée. Entrée pendant la composition d'un
   * caractère (clavier japonais, accent mort) n'envoie pas.
   */
  function champ() {
    if (!nettoye) { nettoye = true; effacerQuestion(); addEventListener('pageshow', (ev) => { if (ev.persisted) effacerQuestion(); }); }
    const f = el('form', 'wl-srch'), id = `wl-q-${++numero}`, lab = el('label', 'wl-sr', T.recherches.question), q = el('input', 'wl-q'), b = el('button', 'wl-go');
    f.setAttribute('role', 'search'); f.noValidate = true;
    lab.htmlFor = id; q.id = id; q.type = 'text'; q.placeholder = T.recherches.invite; q.autocomplete = 'off'; q.dir = 'auto'; q.enterKeyHint = 'search'; q.maxLength = 1000;
    q.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.isComposing || ev.keyCode === 229)) ev.preventDefault(); });
    b.type = 'submit'; b.setAttribute('aria-label', T.recherches.chercher); b.title = T.recherches.chercher; b.append(decor('loupe'));
    f.append(lab, q, b);
    // Un geste dans le champ reste au champ : la carte ne l'ouvre pas en plus.
    f.addEventListener('click', (ev) => ev.stopPropagation());
    f.addEventListener('submit', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (f.closest('.fe-edit')) return;
      const question = questionNette(q.value);
      if (!question) return;
      q.value = '';
      try { sessionStorage.setItem(CLE_QUESTION, JSON.stringify({ q: question, t: Date.now() })); } catch { /* stockage fermé : Pythie s'ouvre sans question */ }
      location.assign('/recherche');
    });
    return f;
  }

  /** « Recherche » : le champ, puis (à partir de trois lignes) les dernières recherches ; chacune ouvre Pythie sur elle. */
  function recherches(e, o) {
    const vide = e.etat === 'vide';
    if (vide ? e.raison !== 'aucune_recherche' : e.etat !== 'ok') return null;
    const d = e.donnee || {}, liste = vide ? [] : (Array.isArray(d.recherches) ? d.recherches : []).map(rechercheLue).filter(Boolean);
    if (!vide && !liste.length) return null;
    poserStyle();
    const n = combienRecherche(lignesDe(o.w, 3)), c = el('div', 'wl-corps wl-porte');
    c.append(champ());
    if (!n) return c;
    if (vide) { const l = el('p', 'wl-calme'); l.append(decor('calme'), el('span', 'wl-ct', T.recherches.aucune)); c.append(l); return c; }
    const total = Number.isInteger(d.total) && d.total >= liste.length ? d.total : liste.length, montres = liste.slice(0, n);
    const lignes = montres.map((s) => {
      const li = el('li'), a = el('a', 'wl-rech'), t = el('span', 'wl-x'), court = s.q.slice(0, 120);
      a.href = lienRecherche(s);
      a.setAttribute('aria-label', s.id ? T.recherches.ouvrir(court) : T.recherches.ouvrirPythie(court));
      // En mode Modifier, toucher une ligne ne quitte pas l'accueil ; sinon, la carte ne fait rien de plus que le lien.
      a.addEventListener('click', (ev) => { ev.stopPropagation(); if (ev.target?.closest?.('.fe-edit')) ev.preventDefault(); });
      t.append(dehors('span', 'wl-t', s.q));
      if (s.at) { const h = el('time', 'wl-h', depuis(s.at)); try { h.dateTime = new Date(s.at).toISOString(); } catch { /* sans attribut */ } t.append(h); }
      a.append(decor('loupe', 'wl-ic'), t); li.append(a);
      return li;
    });
    // La liste (et « et N de plus ») sous le champ, dans la même zone : seule la liste défile.
    c.append(...enListe(lignes, total - montres.length, T.recherches.plus).childNodes);
    return c;
  }

  // ---------------- « Sauvegardes » et « Pubs bloquées » (la seconde part de la famille)
  const entierPositif = (n) => Number.isInteger(n) && n >= 0;
  /**
   * Une heure dans le fuseau d'Odin (`d.fuseau`, donné par le serveur), sur 12 ou 24 h comme Odin est réglé ; `jour` :
   * avec le jour de la semaine. Sans fuseau lisible : '' (jamais le fuseau de l'appareil).
   */
  function heureOdin(t, d, langue, jour = false) {
    const fuseau = d && typeof d.fuseau === 'string' ? d.fuseau : '';
    if (!fuseau || !Number.isFinite(t)) return '';
    try {
      const h12 = d.heure12 === true;
      return new Intl.DateTimeFormat(langue, { timeZone: fuseau, ...(jour ? { weekday: 'short' } : {}), hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', ...(h12 ? { hour12: true } : { hourCycle: 'h23' }) }).format(new Date(t));
    } catch { return ''; }
  }
  /** Un volume (octets) dans la langue donnée, en multiples de 1024 comme Phénix (« 4,6 Mo ») ; illisible : ''. */
  function volume(o, langue) {
    if (!Number.isFinite(o) || o < 0) return '';
    const u = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte']; let i = 0, x = o;
    while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
    try { return new Intl.NumberFormat(langue, { style: 'unit', unit: u[i], unitDisplay: 'short', maximumFractionDigits: 1 }).format(x); } catch { return ''; }
  }
  /**
   * Tenir dans la carte : la zone ne défile pas ; si son contenu dépasse (en bas, ou un chiffre trop large), elle se
   * resserre d'une étape, puis d'une autre (le style dit ce que fait chaque étape pour chaque sorte). Si rien ne suffit,
   * elle défile, et devient une région nommée (un arrêt du clavier qui dit ce qu'il est). Refait à chaque changement de
   * taille de la zone (la grille, l'écran) ; une zone retirée de la page n'est plus suivie.
   */
  const SERRE = ['wl-s1', 'wl-s2', 'wl-s3', 'wl-s4'];
  const deborde = (c) => c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1
    || [...c.querySelectorAll('.wl-val')].some((n) => n.getClientRects().length > 0 && n.scrollWidth > n.clientWidth + 1);
  function ajuster(c) {
    if (!c.isConnected) return;
    c.classList.remove(...SERRE, 'wl-defilant'); c.removeAttribute('role'); c.removeAttribute('aria-label'); c.removeAttribute('tabindex');
    for (const k of SERRE) { if (!deborde(c)) return; c.classList.add(k); }
    if (!deborde(c)) return;
    c.classList.add('wl-defilant'); c.setAttribute('role', 'region'); c.setAttribute('aria-label', c.dataset.nom || ''); c.tabIndex = 0;
  }
  let veilleur = null;
  function tenir(c, nom) {
    c.classList.add('wl-tient'); c.dataset.nom = nom;
    if (typeof ResizeObserver !== 'function') return c;
    if (!veilleur) veilleur = new ResizeObserver((l) => { for (const x of l) { if (x.target.isConnected) ajuster(x.target); else veilleur.unobserve(x.target); } });
    veilleur.observe(c);
    return c;
  }
  /** Un état calme de ces deux cartes : la phrase entière, et sa forme brève pour une carte trop petite. */
  function calmeTenu(texte, bref, bouton, nom) {
    const c = calme(texte, bouton, true), ct = c.querySelector('.wl-ct');
    if (bref && ct) { ct.textContent = ''; ct.append(el('span', 'wl-long', texte), el('span', 'wl-bref', bref)); }
    if (bouton) { const nomBouton = bouton.textContent; bouton.textContent = ''; bouton.title = nomBouton; bouton.append(el('span', 'wl-bt-t', nomBouton), decor('ouvrir', 'wl-bt-i')); }
    c.classList.add('wl-cm');
    return tenir(c, nom);
  }
  /** Le bouton qui ouvre une appli (l'état « vide » du propriétaire), sauf sur l'écran de la maison. */
  function ouvrirAppli(texte, appli, o) {
    if (o && o.ecran === 'maison') return null;
    const b = el('button', 'wl-btn', texte); b.type = 'button';
    b.addEventListener('click', (ev) => { ev.stopPropagation(); location.hash = `#app=${appli}`; });
    return b;
  }
  /** La fin du sous-titre de « Sauvegardes » : la prochaine, si Phénix la connaît. */
  function sousSauvegardes(e) {
    const d = e && e.etat === 'ok' && e.donnee ? e.donnee : null, h = d ? heureOdin(d.prochaine, d, langue()) : '';
    return h ? T.sauvegardes.prochaine(h) : '';
  }
  /**
   * « Sauvegardes » : la dernière réussie (quand, sa sorte, son volume, depuis quand), puis ce qui a échoué, ce qui est
   * en retard et ce qui n'a jamais été fait. La coche verte : une réussite mesurée, sans échec, ni retard, ni plan jamais
   * fait (un compte illisible ne la donne pas) ; sinon le signe « attention ». Aucun plan : « Aucune sauvegarde réglée. »
   * et « Ouvrir Phénix ».
   */
  function sauvegardes(e, o) {
    if (e.etat === 'vide') return e.raison === 'aucune_sauvegarde' ? calmeTenu(T.sauvegardes.aucune, '', ouvrirAppli(T.sauvegardes.ouvrir, 'sindri', o), T.sauvegardes.titre) : null;
    const d = e.donnee || {};
    if (!entierPositif(d.plans) || d.plans < 1) return null;
    poserStyle();
    const lg = langue(), x = d.derniere && typeof d.derniere === 'object' && Number.isFinite(d.derniere.at) ? d.derniere : null;
    const echecs = entierPositif(d.echecs) ? d.echecs : 0, retard = entierPositif(d.enRetard) ? d.enRetard : 0, jamais = entierPositif(d.sansMesure) ? d.sansMesure : 0;
    const bon = Boolean(x) && !echecs && !retard && d.sansMesure === 0;
    const c = el('div', 'wl-corps wl-sv'), l = el('div', 'wl-l'), ic = el('span', `wl-etat ${bon ? 'wl-bon' : 'wl-attention'}`), t = el('div', 'wl-lx');
    ic.setAttribute('aria-hidden', 'true'); ic.append(decor(bon ? 'calme' : 'alerte'));
    if (x) {
      const q = el('b', 'wl-quand', heureOdin(x.at, d, lg, true) || depuis(x.at));
      const sorte = Object.prototype.hasOwnProperty.call(T.sauvegardes.sortes, x.type) ? T.sauvegardes.sortes[x.type] : '';
      t.append(q, el('small', 'wl-detail', [sorte, volume(x.octets, lg), depuis(x.at)].filter(Boolean).join(' · ')));
    } else t.append(el('b', 'wl-quand', T.sauvegardes.sansReussite));
    l.append(ic, t); c.append(l);
    // Ce qui ne va pas : en phrases entières, et en une ligne brève pour une carte trop petite (jamais retiré).
    if (echecs) c.append(el('p', 'wl-echec wl-long', T.sauvegardes.echec(echecs, Number.isFinite(d.echecA) ? depuis(d.echecA) : '')));
    if (retard) c.append(el('p', 'wl-retard wl-long', T.sauvegardes.retard(retard)));
    if (jamais) c.append(el('p', 'wl-jamais wl-long', T.sauvegardes.jamais(jamais)));
    const brefs = [[echecs, 'wl-echec', T.sauvegardes.echecBref], [retard, 'wl-retard', T.sauvegardes.retardBref], [jamais, 'wl-jamais', T.sauvegardes.jamaisBref]].filter(([k]) => k);
    if (brefs.length) {
      const b = el('p', 'wl-bref');
      brefs.forEach(([k, cls, f], i) => { if (i) b.append(' · '); b.append(el('span', cls, f(k, nombre(k)))); });
      c.append(b);
    }
    return tenir(c, T.sauvegardes.titre);
  }
  /** La fin du sous-titre de « Pubs bloquées » : « Aujourd'hui », ou « Depuis 09:12 » quand la journée n'est pas entière. */
  function sousPubs(e) {
    const d = e && e.etat === 'ok' && e.donnee ? e.donnee : null;
    if (!d) return '';
    if (d.complet === true) return T.pubs.aujourdhui;
    const h = heureOdin(d.depuis, d, langue());
    return h ? T.pubs.depuis(h) : '';
  }
  /** L'anneau de la maquette : la part des questions bloquées (dessiné ici, sans innerHTML). */
  function anneau(part) {
    const ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 36 36'); s.setAttribute('class', 'wl-anneau'); s.setAttribute('aria-hidden', 'true');
    for (const [cls, p] of [['wl-fond', 100], ['wl-part', part]]) {
      const k = document.createElementNS(ns, 'circle');
      k.setAttribute('class', cls); k.setAttribute('cx', '18'); k.setAttribute('cy', '18'); k.setAttribute('r', '15'); k.setAttribute('pathLength', '100');
      if (cls === 'wl-part') { k.setAttribute('stroke-dasharray', `${p} ${100 - p}`); k.setAttribute('transform', 'rotate(-90 18 18)'); }
      s.append(k);
    }
    return s;
  }
  /**
   * « Pubs bloquées » : combien de questions Sphinx a bloquées, sur combien, et leur part en anneau. Sphinx arrêté, ou
   * aucune question : une phrase et « Ouvrir Sphinx », jamais un zéro.
   */
  function pubs(e, o) {
    if (e.etat === 'vide') {
      if (e.raison !== 'sphinx_arrete' && e.raison !== 'aucune_question') return null;
      const arrete = e.raison === 'sphinx_arrete';
      return calmeTenu(arrete ? T.pubs.arrete : T.pubs.aucune, arrete ? T.pubs.arreteBref : T.pubs.aucuneBref, ouvrirAppli(T.pubs.ouvrir, 'vidarr', o), T.pubs.titre);
    }
    const d = e.donnee || {};
    if (!entierPositif(d.questions) || d.questions < 1 || !entierPositif(d.bloquees) || d.bloquees > d.questions) return null;
    poserStyle();
    const c = el('div', 'wl-corps wl-pb'), l = el('div', 'wl-l'), t = el('div', 'wl-lx');
    t.append(el('b', 'wl-val', nombre(d.bloquees)), el('small', 'wl-sur', T.pubs.sur(nombre(d.questions))));
    l.append(anneau(Math.round((d.bloquees / d.questions) * 1000) / 10), t); c.append(l);
    return tenir(c, T.pubs.titre);
  }

  window.OdinWidgetsListes = { TEXTES, CSS, combien, combienAgenda, combienRecherche, CLE_QUESTION, DUREE_QUESTION, questionNette, quand, rdvLu, rechercheLue, lienRecherche, heureOdin, volume };
  // La déclaration de la famille (lue par pages/widgets-rendu.js, quel que soit l'ordre de chargement). Les tailles sont
  // celles de la maquette : 3 × 3. Au propriétaire seul (le serveur refuse tout autre que lui).
  (window.OdinWidgetsFamilles = window.OdinWidgetsFamilles || []).push({ famille: 'listes', sortes: [
    { sorte: 'agenda', titre: T.agenda.titre, quoi: T.agenda.quoi, symbole: '📅', appli: 'frigg', proprio: true, poser: { c: 3, r: 3, pc: 4 }, vides: ['aucun_rendez_vous'], dessiner: agenda },
    { sorte: 'recherches', titre: T.recherches.titre, quoi: T.recherches.quoi, symbole: '🔎', appli: 'volva', proprio: true, poser: { c: 3, r: 3, pc: 4 }, vides: ['aucune_recherche'], dessiner: recherches },
    // La seconde part : les tailles de la maquette (4 × 2 et 3 × 2), au propriétaire seul.
    { sorte: 'sauvegardes', titre: T.sauvegardes.titre, quoi: T.sauvegardes.quoi, symbole: '💾', appli: 'sindri', proprio: true, poser: { c: 4, r: 2, pc: 4 }, vides: ['aucune_sauvegarde'], sous: sousSauvegardes, dessiner: sauvegardes },
    { sorte: 'pubs_bloquees', titre: T.pubs.titre, quoi: T.pubs.quoi, symbole: '🛡', appli: 'vidarr', proprio: true, poser: { c: 3, r: 2, pc: 4 }, vides: ['sphinx_arrete', 'aucune_question'], sous: sousPubs, dessiner: pubs },
  ] });
})();
