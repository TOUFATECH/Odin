// La famille « Maison » des widgets de l'accueil (maquette validée « Accueil ») : les petits chiffres de la maison — les
// appareils allumés, les lumières allumées, les serrures verrouillées, la température, l'humidité, et les watts que
// mesurent les prises (jamais toute la maison : le libellé le dit). Le bouton sur mesure de la même famille garde son
// dessin d'aujourd'hui (rien n'est déclaré pour lui ici).
// Ce fichier DÉCLARE ses sortes au registre commun (pages/widgets-rendu.js) ; il ne lit rien : chaque dessin est fait de
// l'état que le serveur a rendu pour le widget ({ n, sur, muets… } ou { valeur, n, ecartes, piece… }).
// - Un petit chiffre : une icône teintée par une couleur du thème, la valeur, son libellé. Il garde sa taille dans
//   chaque état ; sans donnée, son état court est celui du dessin commun (etatPetit), sauf « aucun appareil » et « plus
//   de nouvelles », qu'il dit lui-même en une phrase (sur l'accueil, la carte mène alors à l'appli des appareils).
// - Une moyenne est dite (« Moyenne de 3 capteurs ») ; un seul capteur : sa pièce ; ce qui est écarté (hors ligne, muet)
//   est dit ; l'âge vrai de la mesure est dans la phrase entière (info-bulle, lecteurs d'écran).
// - Les nombres dans la langue de la page ; °C ou °F comme Odin est réglé (le serveur le dit). Aucune langue écrite.
// - Tout texte venu d'une donnée (le nom d'une pièce) est posé par textContent ; seules les icônes dessinées ici ne le sont pas.
// Rien n'est touché au chargement : seulement window.OdinWidgetsMaison (ses textes et calculs, pour les essais) et sa déclaration.
(() => {
  'use strict';
  if (window.OdinWidgetsMaison) return;

  // ---------------- Dictionnaire (tous les textes de la famille)
  const pluriel = (n, un, plusieurs) => (n === 1 ? un : plusieurs);
  const TEXTES = {
    // `vide` : la phrase courte de la carte (elle tient sur trois lignes) ; `videDit` : la phrase entière (info-bulle, lecteurs d'écran).
    allumes: { titre: 'Allumés', nom: 'Appareils allumés', quoi: 'combien de tes appareils sont en marche, sur tous ceux qui s\'allument', vide: 'Aucun appareil.', videDit: 'Aucun appareil relié à Odin.', dit: (n, sur) => `${n} ${pluriel(n, 'appareil allumé', 'appareils allumés')} sur ${sur}.` },
    lumieres: { titre: 'Lumières', nom: 'Lumières allumées', quoi: 'combien de tes lumières sont allumées, sur combien', vide: 'Aucune lumière.', videDit: 'Aucune lumière reliée à Odin.', dit: (n, sur) => `${n} ${pluriel(n, 'lumière allumée', 'lumières allumées')} sur ${sur}.` },
    serrures: {
      titre: 'Verrouillées', nom: 'Serrures', quoi: 'combien de tes serrures sont verrouillées (les capteurs de porte ne sont pas comptés)', vide: 'Aucune serrure.', videDit: 'Aucune serrure reliée à Odin.',
      dit: (n, sur) => `${n} ${pluriel(n, 'serrure verrouillée', 'serrures verrouillées')} sur ${sur}.`, ouvertes: (n) => `${n} ${pluriel(n, 'ouverte', 'ouvertes')}`,
    },
    temperature: { titre: 'Température', nom: 'Température', quoi: 'la température de tes capteurs, ou leur moyenne', vide: 'Aucun capteur de température.', videDit: 'Aucun capteur de température relié à Odin.' },
    humidite: { titre: 'Humidité', nom: 'Humidité', quoi: 'l\'humidité de tes capteurs, ou leur moyenne', vide: 'Aucun capteur d\'humidité.', videDit: 'Aucun capteur d\'humidité relié à Odin.' },
    watts: {
      titre: 'Watts', nom: 'Watts des prises', quoi: 'ce que mesurent tes prises en ce moment (pas toute la maison)', vide: 'Aucune prise qui mesure.', videDit: 'Aucune prise qui mesure reliée à Odin.',
      // Sur la carte : le mot « prises » d'abord, entier ; la phrase entière pour l'info-bulle et les lecteurs d'écran.
      qui: (n) => `${n} ${pluriel(n, 'prise', 'prises')}`,
      quiDit: (n) => `Ce que ${pluriel(n, 'mesure', 'mesurent')} ${n} ${pluriel(n, 'prise', 'prises')}`,
    },
    // Ce qui n'entre pas dans le chiffre, et pourquoi.
    sansNouvelles: (n) => `${n} sans nouvelles`,
    // En ligne, mais d'un état qu'Odin ne lit pas (une serrure bloquée, une clim qui publie un nombre).
    inconnus: (n) => `${n} d'état inconnu`,
    mesure: {
      moyenne: (n) => `Moyenne de ${n} capteurs`,
      ecartes: (n, prises) => (prises ? `${n} ${pluriel(n, 'prise écartée', 'prises écartées')} (hors ligne ou sans nouvelles)` : `${n} ${pluriel(n, 'capteur écarté', 'capteurs écartés')} (hors ligne ou sans nouvelles)`),
      // Sur la carte, après ce qu'est le chiffre (la moyenne, la pièce, les prises : toujours lu en premier).
      ecartesCourt: (n, prises) => `${n} ${prises ? pluriel(n, 'écartée', 'écartées') : pluriel(n, 'écarté', 'écartés')}`,
      lue: (age) => `lue ${age}`,
      muettes: 'Plus de nouvelles.',
      muettesDit: 'Aucune mesure récente : les appareils ne donnent plus de nouvelles.',
    },
    ouvrir: 'Ajouter un appareil',
  };
  const T = TEXTES;

  // ---------------- Calculs (sans document)
  /** Un nombre dans la langue donnée (une décimale au plus) ; illisible : ''. */
  function nombre(v, langue) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '';
    try { return new Intl.NumberFormat(langue, { maximumFractionDigits: 1 }).format(v); } catch { return String(v); }
  }
  /** Un compte lu sans confiance : des entiers de 0 et plus, sinon rien. */
  const entier = (v) => (Number.isInteger(v) && v >= 0 ? v : undefined);
  const texte = (v) => (typeof v === 'string' ? v : '');

  // ---------------- Dessin (seulement quand un hôte l'appelle)
  const ICONES = {
    prise: '<path d="M12 3v5M8.5 5.5a7 7 0 1 0 7 0"/>',
    ampoule: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
    cadenas: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    thermo: '<path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 9v7"/>',
    goutte: '<path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"/>',
    eclair: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
  };
  const icone = (k) => (Object.prototype.hasOwnProperty.call(ICONES, k) ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[k]}</svg>` : '');
  // Les couleurs : celles du thème d'Odin (--accent, --good, --warn, --ink, --muted) ou, sur l'écran de la maison, celles
  // de son thème (--text). Aucune couleur n'est écrite ici. La carte (le conteneur) donne sa largeur aux tailles.
  const CSS = `
.wmc{--wmc-c:var(--accent,currentColor);position:relative;display:flex;flex-flow:row-reverse wrap;align-items:center;align-content:flex-start;gap:0 12px;min-width:0;height:52px;overflow:hidden;color:inherit;text-decoration:none}
/* Sans coins arrondis : un bloc qui cache ce qui dépasse rognerait la première lettre d'une ligne (carte étroite). */
a.wmc:focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:2px}
/* « › » : la carte « vide » mène à l'endroit où l'on ajoute un appareil (le dernier dans la ligne, à droite). */
.wmc-go{flex:none;order:-2;margin-inline-start:-8px;font-size:20px;line-height:1;color:var(--muted,inherit)}
.fe-edit a.wmc{pointer-events:none}
.wmc-ic{flex:none;width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:color-mix(in srgb,var(--wmc-c) 18%,transparent);color:var(--wmc-c)}
.wmc-ic svg{width:22px;height:22px}
.wmc-t{order:-1;flex:1 0 auto;min-width:0;max-width:100%;min-height:52px;display:flex;flex-direction:column;justify-content:center}
.wmc-v{display:block;font-size:clamp(15px,17cqi,21px);font-weight:750;letter-spacing:-.02em;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums;color:var(--ink,var(--text,inherit))}
.wmc-v small{font-size:.58em;font-weight:600;letter-spacing:0;color:var(--muted,inherit)}
/* Le libellé : ce que compte le chiffre d'abord, puis ce qui n'y entre pas ; sur deux lignes au plus (« Moyenne de 3 capteurs » se lit en entier). */
.wmc-l{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;width:0;min-width:100%;font-size:11.5px;line-height:1.2;white-space:normal;overflow:hidden;overflow-wrap:break-word;color:var(--muted,inherit)}
/* Ce qui n'entre pas dans le chiffre (écarté, sans nouvelles, ouverte) : le libellé entier passe en ambre (un seul texte, coupé d'un bloc). */
.wmc[data-marque] .wmc-l{font-weight:650;color:var(--warn,inherit)}
/* Une phrase seule (aucun appareil, plus de nouvelles) : sur trois lignes au plus, dans la même hauteur. */
.wmc:has(.wmc-phrase) .wmc-t{flex:1 1 0}
.wmc-phrase{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;white-space:normal;width:auto;font-size:11.5px;line-height:1.2;overflow-wrap:break-word;color:var(--ink,var(--text,inherit))}
.wmc[data-ton="calme"]{--wmc-c:var(--good,currentColor)}
.wmc[data-ton="alarme"]{--wmc-c:var(--warn,currentColor)}.wmc[data-ton="alarme"] .wmc-v{color:var(--warn,inherit)}
.wmc[data-ton="muet"]{--wmc-c:var(--muted,currentColor)}
@container (max-width:135px){.wmc{column-gap:9px}.wmc-ic{width:36px;height:36px;border-radius:11px}.wmc-ic svg{width:19px;height:19px}}
/* Carte très étroite (deux colonnes à 768 px) : l'icône cède sa place au texte, et le libellé se coupe où il faut. */
@container (max-width:104px){.wmc{column-gap:6px}.wmc-go{margin-inline-start:-3px}.wmc-ic{display:none}.wmc-l.wmc-phrase{-webkit-line-clamp:3;font-size:11px;overflow-wrap:break-word}.wmc-v{font-size:15px}.wmc-l{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal;width:auto;font-size:11px;line-height:1.2;overflow-wrap:anywhere}}`;
  function poserStyle() {
    const R = window.OdinWidgetsRendu;
    if (R && typeof R.poserStyle === 'function') R.poserStyle(); // la classe des textes dits aux lecteurs d'écran
    if (document.getElementById('odinWidgetsMaison')) return;
    const s = document.createElement('style'); s.id = 'odinWidgetsMaison'; s.textContent = CSS; document.head.append(s);
  }
  function el(t, cls, txt) { const n = document.createElement(t); if (cls) n.className = cls; if (txt !== undefined) n.textContent = txt; return n; }
  const langue = () => { try { return document.documentElement.lang || undefined; } catch { return undefined; } };
  /**
   * Le petit chiffre. `o` : { icone, ton ('calme', 'alarme', 'muet' ou rien), valeur (des nœuds ou des textes), quoi (ce
   * que compte le chiffre, toujours écrit en premier) et marques (ce qui n'entre pas dans le chiffre, après : le libellé
   * passe en ambre), ou phrase (une phrase seule), dit (la phrase entière : info-bulle et lecteurs d'écran), lien (sur
   * l'accueil seulement : la carte entière y mène, et « › » le montre) }.
   */
  function chiffre(o) {
    poserStyle();
    const marques = o.marques || [];
    const box = el(o.lien ? 'a' : 'div', 'wmc'), ic = el('span', 'wmc-ic'), t = el('div', 'wmc-t'), l = el('span', `wmc-l${o.phrase ? ' wmc-phrase' : ''}`), dit = el('span', 'wr-sr', o.dit || '');
    if (o.lien) box.href = o.lien;
    if (o.ton) box.dataset.ton = o.ton;
    if (marques.length) box.dataset.marque = '';
    ic.setAttribute('aria-hidden', 'true'); ic.innerHTML = icone(o.icone);
    l.setAttribute('aria-hidden', 'true');
    if (o.phrase) l.append(o.phrase); else l.append(el('span', 'wmc-q', o.quoi || ''), ...(marques.length ? [` · ${marques.join(' · ')}`] : []));
    if (o.valeur) { const v = el('b', 'wmc-v'); v.setAttribute('aria-hidden', 'true'); v.append(...o.valeur); t.append(v); }
    t.append(l); box.append(ic, t);
    if (o.lien) { const g = el('span', 'wmc-go', '›'); g.setAttribute('aria-hidden', 'true'); box.append(g); }
    box.append(dit);
    if (o.dit) { box.title = o.dit; l.title = o.dit; }
    return box;
  }
  /** « 3 / 6 » : le compte, puis « / sur » en petit. */
  const surQ = (n, sur, lg) => [nombre(n, lg), el('small', '', ` / ${nombre(sur, lg)}`)];
  /** L'état « vide » que la famille dit elle-même : une phrase ; sur l'accueil, la carte mène à l'appli des appareils. */
  function videDe(e, o, k, icn) {
    const muettes = e.raison === 'mesures_muettes', phrase = muettes ? T.mesure.muettes : T[k].vide, entiere = muettes ? T.mesure.muettesDit : T[k].videDit;
    const lien = o && o.ecran === 'maison' ? '' : '#app=midgard';
    return chiffre({ icone: icn, ton: 'muet', phrase, lien, dit: lien ? `${entiere} ${T.ouvrir}.` : entiere });
  }
  /** Un compte (allumés, lumières, serrures). Rien de lisible : rien d'affirmé (null : l'hôte écrit une ligne). */
  function compte(k, icn) {
    return (e, o) => {
      if (e.etat === 'vide') return videDe(e, o, k, icn);
      const d = e.donnee || {}, n = entier(d.n), sur = entier(d.sur), muets = entier(d.muets) || 0, ouvertes = entier(d.ouvertes) || 0, inconnus = entier(d.inconnus) || 0, lg = langue();
      if (n === undefined || sur === undefined || n > sur) return null;
      const libelle = texte(o && o.titre) || T[k].titre, marques = [];
      if (ouvertes) marques.push(T.serrures.ouvertes(ouvertes));
      if (inconnus) marques.push(T.inconnus(inconnus));
      if (muets) marques.push(T.sansNouvelles(muets));
      // Une serrure ouverte, ou d'un état inconnu (bloquée ?) : l'alarme ; jamais « calme » sans toutes les savoir.
      const ton = ouvertes || (k === 'serrures' && inconnus) ? 'alarme' : (k === 'lumieres' && n === 0 && !inconnus) || (k === 'serrures' && n === sur) ? 'calme' : '';
      const dit = [T[k].dit(n, sur), ...marques.map((m) => `${m}.`)].join(' ');
      return chiffre({ icone: icn, ton, valeur: surQ(n, sur, lg), quoi: libelle, marques, dit });
    };
  }
  /** Une mesure (température, humidité, watts) : la valeur et son unité ; ce qu'elle est (moyenne, pièce, prises) ; l'écarté. */
  function mesure(k, icn) {
    return (e, o) => {
      if (e.etat === 'vide') return videDe(e, o, k, icn);
      const d = e.donnee || {}, n = entier(d.n), ecartes = entier(d.ecartes) || 0, lg = langue(), R = window.OdinWidgetsRendu;
      if (typeof d.valeur !== 'number' || !Number.isFinite(d.valeur) || !n) return null; // jamais un chiffre inventé
      const unite = k === 'temperature' ? (d.unite === 'F' ? '°F' : d.unite === 'C' ? '°C' : '') : k === 'humidite' ? '%' : 'W';
      if (!unite) return null;
      const quoi = k === 'watts' ? T.watts.qui(n) : n > 1 ? T.mesure.moyenne(n) : texte(d.piece) || texte(o && o.titre) || T[k].titre;
      // Une mesure comptée sans heure connue : aucun âge affirmé.
      const age = d.ageInconnu !== true && R && typeof R.depuis === 'function' ? R.depuis(e.at) : '';
      const quoiDit = k === 'watts' ? T.watts.quiDit(n) : quoi;
      const ecart = ecartes ? T.mesure.ecartes(ecartes, k === 'watts') : '';
      const valeur = `${nombre(d.valeur, lg)}\u00a0${unite}`;
      const dit = [`${texte(o && o.titre) || T[k].titre} : ${valeur}.`, `${quoiDit}.`, ecart ? `${ecart}.` : '', age ? `${T.mesure.lue(age)}.` : ''].filter(Boolean).join(' ');
      return chiffre({ icone: icn, valeur: [nombre(d.valeur, lg), el('small', '', `\u00a0${unite}`)], quoi, marques: ecart ? [T.mesure.ecartesCourt(ecartes, k === 'watts')] : [], dit });
    };
  }

  window.OdinWidgetsMaison = { TEXTES, CSS, nombre };
  // La déclaration de la famille (lue par pages/widgets-rendu.js, quel que soit l'ordre de chargement). La taille de la
  // maquette : 2 × 1 (une ligne au téléphone aussi). L'appli lue : Midgard (celle de la maison).
  const PETIT = { c: 2, r: 1, pr: 1 }, VIDES = ['aucun_appareil', 'mesures_muettes'];
  const sorte = (s, k, symbole, icn, dessiner) => ({ sorte: s, titre: T[k].titre, nom: T[k].nom, quoi: T[k].quoi, symbole, appli: 'midgard', petit: true, poser: PETIT, vides: VIDES, dessiner: dessiner(k, icn) });
  (window.OdinWidgetsFamilles = window.OdinWidgetsFamilles || []).push({ famille: 'maison', sortes: [
    sorte('maison_allumes', 'allumes', '⏻', 'prise', compte),
    sorte('maison_lumieres', 'lumieres', '💡', 'ampoule', compte),
    sorte('maison_serrures', 'serrures', '🔒', 'cadenas', compte),
    sorte('maison_temperature', 'temperature', '🌡', 'thermo', mesure),
    sorte('maison_humidite', 'humidite', '💧', 'goutte', mesure),
    sorte('maison_watts', 'watts', '⚡', 'eclair', mesure),
  ] });
})();
