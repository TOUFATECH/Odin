// La famille « Maison » des widgets de l'accueil, ses courbes (maquette validée « Accueil ») : « Consommation du jour »,
// « Énergie de la semaine », et la courbe du widget « Capteur » (dessinée ici, posée par pages/widgets-maison-appareils.js).
// Rangées dans ce fichier pour ne pas écrire dans ceux des autres parts de la famille ; la famille déclarée est la même.
// Ce fichier DÉCLARE ses deux sortes au registre commun (pages/widgets-rendu.js) ; chaque dessin est fait de l'état que le
// serveur a rendu pour le widget (src/valhalla/widgets/maison-courbes.ts) et de rien d'autre. Au propriétaire seul,
// jamais sur l'écran de la maison (la même marque que le serveur).
// - Une absence reste une absence : une valeur que le serveur n'a pas rendue n'a ni point, ni barre, ni zéro ; un trou de
//   la courbe reste un trou ; rien n'est lissé ni prolongé au-delà des points rendus.
// - Ni part « par usage », ni comparaison avec la veille : Odin ne les connaît pas.
// - Chaque courbe et chaque barre est une image pour un lecteur d'écran : son texte dit le minimum, le maximum et la
//   dernière valeur (une barre : son jour et sa valeur, ou « sans relevé »). Aucune animation.
// - Les nombres, les unités et les jours dans la langue de la page. Aucune couleur écrite : celles du thème.
// Rien n'est touché au chargement : seulement window.OdinWidgetsMaisonCourbes (textes et calculs, pour les essais) et sa déclaration.
(() => {
  'use strict';
  if (window.OdinWidgetsMaisonCourbes) return;

  // ---------------- Dictionnaire (tous les textes de cette part de la famille)
  const pluriel = (n, un, plusieurs) => (n === 1 ? un : plusieurs);
  const TEXTES = {
    jour: {
      titre: 'Consommation du jour', quoi: 'Le total d\'aujourd\'hui et la courbe de la journée, d\'après ce que mesurent tes prises.',
      sous: (n) => `Aujourd'hui · ${nombre(n)} ${pluriel(n, 'prise', 'prises')}`, aujourdhui: 'Aujourd\'hui',
      sansTotal: 'Total du jour pas encore relevé', incomplet: 'journée incomplète',
      courbe: (min, max, der) => `Puissance de tes prises aujourd'hui, par demi-heure : minimum ${min}, maximum ${max}, dernière valeur ${der}`,
      courbePrises: (n) => `${nombre(n)} ${pluriel(n, 'prise', 'prises')}`,
    },
    semaine: {
      titre: 'Énergie de la semaine', quoi: 'Ta consommation jour par jour sur 7 jours, d\'après ce que mesurent tes prises.',
      sous: (n) => `7 jours · ${nombre(n)} ${pluriel(n, 'prise', 'prises')}`,
      pasEncore: 'Pas encore 7 jours de relevés', sans: (n) => `${nombre(n)} ${pluriel(n, 'jour', 'jours')} sans relevé`,
      barre: (j, v) => `${j} : ${v}`, sansReleve: (j) => `${j} : sans relevé`, enCours: 'en cours',
      incomplet: 'journée incomplète', incomplets: (n) => `${nombre(n)} ${pluriel(n, 'jour incomplet', 'jours incomplets')}`,
      ensemble: (min, max, der) => `Consommation par jour : minimum ${min}, maximum ${max}, dernière valeur ${der}`,
    },
    capteur: { courbe: (min, max, der, age) => `Courbe des dernières 24 h : minimum ${min}, maximum ${max}, dernière valeur ${der}${age ? `, ${age}` : ''}` },
    vides: { aucune_prise: 'Aucune prise qui mesure sa consommation.', pas_encore_de_releve: 'Pas encore de relevé gardé.' },
  };
  const T = TEXTES;

  // ---------------- Calculs (sans document)
  const langue = () => { try { return (typeof document !== 'undefined' && document && document.documentElement.lang) || undefined; } catch { return undefined; } };
  const fini = (v) => typeof v === 'number' && Number.isFinite(v);
  function nombre(v, chiffres = 1) {
    if (!fini(v)) return '';
    // Arrondi d'abord : une valeur qui s'arrondit à zéro s'écrit « 0 », jamais « -0 ».
    const c = Math.max(0, Math.min(6, Math.trunc(chiffres))), r = Math.round(v * 10 ** c) / 10 ** c, x = r === 0 ? 0 : r;
    try { return new Intl.NumberFormat(langue(), { maximumFractionDigits: c }).format(x); } catch { return String(x); }
  }
  /** Le nombre de décimales qui distingue les valeurs d'une courbe (de 1 à 4) : d'après son écart, sinon sa grandeur. */
  function chiffres(min, max) {
    const ref = fini(min) && fini(max) ? (max - min > 0 ? max - min : Math.abs(max)) : 0;
    return ref > 0 ? Math.max(1, Math.min(4, Math.ceil(-Math.log10(ref)))) : 1;
  }
  /**
   * Un repère d'heure de la journée (« 00:00 »), dans la langue de la page : seulement l'heure écrite (un 1er janvier,
   * à l'heure de la page, jour sans changement d'heure), jamais un instant converti.
   */
  function heure(h, m) {
    try { return new Intl.DateTimeFormat(langue(), { hour: '2-digit', minute: '2-digit' }).format(new Date(2000, 0, 1, h, m)); } catch { return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
  }
  const avecUnite = (v, u, chiffres) => (fini(v) ? `${nombre(v, chiffres)}${u ? `\u00a0${u}` : ''}` : '');
  const texte = (v) => (typeof v === 'string' ? v : '');
  /**
   * Le jour de la semaine d'un « AAAA-MM-JJ » (un jour du calendrier d'Odin, rendu par le serveur), court, dans la langue de
   * la page : ce jour à midi, heure de la page (le même jour de la semaine, quel que soit son fuseau).
   */
  function nomDuJour(j, forme = 'short') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texte(j)); if (!m) return '';
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12); if (!Number.isFinite(d.getTime())) return '';
    try { return new Intl.DateTimeFormat(langue(), { weekday: forme }).format(d); } catch { return texte(j); }
  }
  /**
   * Les morceaux d'une courbe, relus sans confiance : chaque point [x, y] fini ; un morceau vide n'en est pas un.
   * `bornes` : { x0, x1 } (l'axe du temps), le min et le max des valeurs. Moins de deux points en tout : rien.
   */
  function morceauxLus(morceaux, x0, x1) {
    const m = (Array.isArray(morceaux) ? morceaux : []).map((mo) => (Array.isArray(mo) ? mo : []).filter((p) => Array.isArray(p) && fini(p[0]) && fini(p[1]) && p[0] >= x0 && p[0] <= x1)).filter((mo) => mo.length);
    const tous = m.flat(); if (tous.length < 2 || !(x1 > x0)) return null;
    const ys = tous.map((p) => p[1]);
    return { morceaux: m, x0, x1, min: Math.min(...ys), max: Math.max(...ys) };
  }
  /** Les valeurs par demi-heure (null : un trou) en morceaux [indice, valeur], sur l'axe 0..n. */
  function morceauxDeValeurs(valeurs) {
    const out = []; let cur = null;
    (Array.isArray(valeurs) ? valeurs : []).forEach((v, i) => { if (fini(v)) { if (!cur) { cur = []; out.push(cur); } cur.push([i + 0.5, v]); } else cur = null; });
    return out;
  }
  /**
   * Le tracé SVG (viewBox 0 0 100 40) : une ligne par morceau, jamais reliée par-dessus un trou ; un morceau d'un seul
   * point : un point (un trait de longueur nulle, bouts ronds). L'aire sous chaque morceau de trois points au moins,
   * jamais au-delà de lui (sous un morceau plus court, elle se lirait comme une barre).
   */
  const LARGE = 100, HAUT = 40;
  function trace(b) {
    const pad = (b.max - b.min) * 0.12 || Math.abs(b.max) * 0.1 || 1, lo = b.min - pad, hi = b.max + pad;
    const X = (x) => Math.round(((x - b.x0) / (b.x1 - b.x0)) * LARGE * 100) / 100, Y = (y) => Math.round((HAUT - ((y - lo) / (hi - lo)) * HAUT) * 100) / 100;
    return b.morceaux.map((mo) => {
      const pts = mo.map((p) => `${X(p[0])} ${Y(p[1])}`), ligne = mo.length === 1 ? `M${pts[0]}h0` : `M${pts.join('L')}`;
      const aire = mo.length < 3 ? '' : `M${X(mo[0][0])} ${HAUT}L${pts.join('L')}L${X(mo[mo.length - 1][0])} ${HAUT}Z`;
      return { ligne, aire };
    });
  }
  /**
   * Les barres de la semaine : un jour par entrée rendue (à partir du premier jour connu), sa hauteur (en % du plus
   * grand jour) seulement s'il a une valeur ; un jour sans relevé : aucune hauteur (ni zéro). `pasEncore` : moins de
   * 7 jours rendus ; `sans` : les jours rendus sans relevé ; `incomplet` (et leur nombre, `incomplets`) : un jour dont
   * la valeur ne couvre pas tout le jour (le serveur le dit).
   */
  function barres(d) {
    const jours = (Array.isArray(d && d.jours) ? d.jours : []).filter((x) => x && typeof x.jour === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.jour)).slice(-7);
    const vals = jours.map((x) => (fini(x.kwh) && x.kwh >= 0 ? x.kwh : undefined)), max = Math.max(0, ...vals.filter(fini));
    return {
      jours: jours.map((x, i) => ({ jour: x.jour, nom: nomDuJour(x.jour), nomCourt: nomDuJour(x.jour, 'narrow'), ...(vals[i] !== undefined ? { kwh: vals[i], h: max > 0 ? Math.max(2, Math.round((vals[i] / max) * 100)) : 2, ...(x.incomplet === true ? { incomplet: true } : {}) } : {}), enCours: i === jours.length - 1 })),
      pasEncore: jours.length < 7, sans: vals.filter((v) => v === undefined).length, incomplets: jours.filter((x, i) => vals[i] !== undefined && x.incomplet === true).length,
    };
  }

  // ---------------- Dessin (seulement quand un hôte l'appelle)
  const CSS = `
.wmc{display:flex;flex-direction:column;gap:6px;min-width:0;min-height:0;flex:1;overflow:hidden;color:inherit}
/* La carte qui porte une courbe ou des barres se range en colonne : son corps prend la hauteur que l'en-tête laisse (en
   bloc, la hauteur en % des barres tombait à 0). Les boutons du cadre sont posés en absolu : ils ne bougent pas. */
.fe-w:has(>.wmc),.fe-w:has(>.wma>.wmc-l){display:flex;flex-direction:column}
.fe-w:has(>.wmc)>:not(.wmc),.fe-w:has(>.wma>.wmc-l)>:not(.wma){flex:none}
.wmc-l{display:flex;align-items:flex-end;gap:12px;min-width:0;min-height:0;flex:1}
.wmc-v{flex:none;font-size:clamp(20px,9cqi,30px);font-weight:750;letter-spacing:-.02em;line-height:1.1;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--ink,var(--text,inherit))}
.wmc-v small{font-size:.55em;font-weight:600;color:var(--muted,inherit)}
.wmc-s{font-size:12px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted,inherit)}
.wmc-g{position:relative;flex:1 1 60px;min-width:0;min-height:36px;align-self:stretch;color:var(--accent,currentColor)}
.wmc-g svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;display:block}
.wmc-g .ln{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.wmc-g .ar{fill:color-mix(in srgb,currentColor 16%,transparent);stroke:none}
/* « Consommation du jour » : la courbe sous le total, sur toute la largeur, avec ses repères d'heure. */
.wmc-jour .wmc-l{flex-direction:column;align-items:stretch;gap:4px}
.wmc-jour .wmc-g{flex:1 1 30px;min-height:30px}
/* Au téléphone (700 px et moins, la grille d'accueil-grille.js), la carte suit son contenu : la courbe a sa hauteur à elle. */
@media (max-width:700px){.wmc-jour .wmc-g{min-height:80px}}
.wmc-x{display:flex;justify-content:space-between;gap:4px;font-size:11px;line-height:13px;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--muted,inherit)}
.wmc-b{flex:1 1 80px;min-height:80px;display:flex;align-items:stretch;gap:6px;padding-top:4px}
.wmc-b>div{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;gap:4px}
.wmc-b .wmc-p{flex:1;min-height:0;width:100%;display:flex;align-items:flex-end;justify-content:center}
.wmc-b i{display:block;width:100%;max-width:30px;border-radius:8px 8px 4px 4px;background:var(--accent,currentColor)}
.wmc-b small{font-size:11px;line-height:1;color:var(--muted,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
/* Un jour sans relevé : son nom seul, estompé (aucun trait à la place de sa barre : il se lirait comme un zéro). */
.wmc-b [data-sans] small{opacity:.6}
/* Une carte étroite : la lettre du jour, entière, à la place de son nom court coupé. */
.wmc-b .nn{display:none}
@container (max-width:300px){.wmc-b .nl{display:none}.wmc-b .nn{display:inline}}
.wmc-b [data-encours] small{font-weight:700;color:var(--ink,var(--text,inherit))}
.wmc-vide{margin:0;font-size:13px;color:var(--muted,inherit)}
@media (prefers-reduced-motion:reduce){.wmc *{animation:none!important;transition:none!important}}`;
  function poserStyle() {
    const R = window.OdinWidgetsRendu;
    if (R && typeof R.poserStyle === 'function') R.poserStyle();
    if (document.getElementById('odinWidgetsMaisonCourbes')) return;
    const s = document.createElement('style'); s.id = 'odinWidgetsMaisonCourbes'; s.textContent = CSS; document.head.append(s);
  }
  function el(t, cls, txt) { const n = document.createElement(t); if (cls) n.className = cls; if (txt !== undefined) n.textContent = txt; return n; }
  const NS = 'http://www.w3.org/2000/svg';
  /** Le dessin d'une courbe (bornes lues par morceauxLus), avec son texte pour un lecteur d'écran. */
  function graphe(b, etiquette) {
    const g = el('div', 'wmc-g'), s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', `0 0 ${LARGE} ${HAUT}`); s.setAttribute('preserveAspectRatio', 'none'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
    for (const t of trace(b)) {
      if (t.aire) { const a = document.createElementNS(NS, 'path'); a.setAttribute('class', 'ar'); a.setAttribute('d', t.aire); s.append(a); }
      const l = document.createElementNS(NS, 'path'); l.setAttribute('class', 'ln'); l.setAttribute('d', t.ligne); s.append(l);
    }
    g.setAttribute('role', 'img'); g.setAttribute('aria-label', etiquette); g.title = etiquette; g.append(s);
    return g;
  }
  /** La courbe du widget « Capteur » (la donnée `courbe` rendue au propriétaire seul), ou rien. */
  function courbeCapteur(c, unite) {
    if (!c || typeof c !== 'object') return null;
    const b = morceauxLus(c.morceaux, Number(c.de), Number(c.a)); if (!b) return null;
    const R = window.OdinWidgetsRendu, der = Array.isArray(c.derniere) ? c.derniere : [], u = texte(unite);
    const age = fini(der[0]) && R && typeof R.depuis === 'function' ? R.depuis(der[0]) : '';
    const lo = fini(c.min) ? c.min : b.min, hi = fini(c.max) ? c.max : b.max, ch = chiffres(lo, hi);
    return graphe(b, T.capteur.courbe(avecUnite(lo, u, ch), avecUnite(hi, u, ch), avecUnite(fini(der[1]) ? der[1] : NaN, u, ch) || '', age));
  }
  const videDe = (e) => [el('p', 'wmc-vide', T.vides[e && e.raison] || T.vides.pas_encore_de_releve)];

  /** « Consommation du jour » : le total (kWh), puis la courbe de la journée (W, par demi-heure). */
  function dessinerJour(e) {
    poserStyle();
    const box = el('div', 'wmc wmc-jour'), d = (e && e.donnee) || {};
    if (!e || (e.etat !== 'ok' && e.etat !== 'ancien')) { box.append(...videDe(e)); return box; }
    const l = el('div', 'wmc-l'), tot = d.total && fini(d.total.kwh) ? d.total.kwh : undefined;
    if (tot !== undefined) { const v = el('div', 'wmc-v'); v.append(nombre(tot, 2), el('small', '', '\u00a0kWh')); v.title = v.textContent; l.append(v); }
    const c = d.courbe && typeof d.courbe === 'object' ? d.courbe : null, mo = c ? morceauxDeValeurs(c.valeurs) : [];
    const n = c && Array.isArray(c.valeurs) ? c.valeurs.length : 0, b = n ? morceauxLus(mo, 0, n) : null;
    if (b) {
      const der = mo[mo.length - 1][mo[mo.length - 1].length - 1][1];
      l.append(graphe(b, `${T.jour.courbe(avecUnite(b.min, 'W', 0), avecUnite(b.max, 'W', 0), avecUnite(der, 'W', 0))} (${T.jour.courbePrises(Number(c.prises) || 0)})`));
      // Les repères de l'axe : le début, le milieu et la fin de la journée (l'axe couvre tout le jour d'Odin).
      const x = el('div', 'wmc-x'); x.setAttribute('aria-hidden', 'true');
      x.append(el('span', '', heure(0, 0)), el('span', '', heure(12, 0)), el('span', '', heure(23, 59))); l.append(x);
    }
    box.append(l);
    if (tot === undefined) box.append(el('span', 'wmc-s', T.jour.sansTotal));
    return box;
  }
  /** « Énergie de la semaine » : une barre par jour connu ; un jour sans relevé n'a pas de barre ; moins de 7 jours : dit. */
  function dessinerSemaine(e) {
    poserStyle();
    const box = el('div', 'wmc wmc-sem'), d = (e && e.donnee) || {};
    if (!e || (e.etat !== 'ok' && e.etat !== 'ancien')) { box.append(...videDe(e)); return box; }
    const m = barres(d), zone = el('div', 'wmc-b'), connus = m.jours.filter((x) => fini(x.kwh));
    zone.setAttribute('role', 'list');
    for (const x of m.jours) {
      const col = el('div'), p = el('span', 'wmc-p'), long = nomDuJour(x.jour, 'long') || x.jour;
      col.setAttribute('role', 'listitem');
      const dit = fini(x.kwh) ? T.semaine.barre(long, avecUnite(x.kwh, 'kWh', 2)) : T.semaine.sansReleve(long);
      const notes = [x.incomplet ? T.semaine.incomplet : '', x.enCours ? T.semaine.enCours : ''].filter(Boolean).join(', ');
      col.setAttribute('aria-label', notes ? `${dit} (${notes})` : dit); col.title = col.getAttribute('aria-label');
      if (fini(x.kwh)) { const i = el('i'); i.style.height = `${x.h}%`; i.setAttribute('aria-hidden', 'true'); p.append(i); } else col.dataset.sans = '1';
      if (x.enCours) col.dataset.encours = '1';
      const lab = el('small'); lab.append(el('span', 'nl', x.nom), el('span', 'nn', x.nomCourt || x.nom)); lab.setAttribute('aria-hidden', 'true');
      col.append(p, lab); zone.append(col);
    }
    if (connus.length) {
      const ys = connus.map((x) => x.kwh);
      zone.setAttribute('aria-label', T.semaine.ensemble(avecUnite(Math.min(...ys), 'kWh', 2), avecUnite(Math.max(...ys), 'kWh', 2), avecUnite(connus[connus.length - 1].kwh, 'kWh', 2)));
    }
    box.append(zone);
    const note = [m.pasEncore ? T.semaine.pasEncore : '', m.sans ? T.semaine.sans(m.sans) : '', m.incomplets ? T.semaine.incomplets(m.incomplets) : ''].filter(Boolean).join(' · ');
    if (note) { const s = el('span', 'wmc-s', note); s.title = note; box.append(s); }
    return box;
  }
  // « journée incomplète » dans le sous-titre (une ligne de plus dans le corps ferait grandir une carte de 2 lignes).
  const sousJour = (e) => { const d = e && e.donnee; const n = d && d.total && Number.isInteger(d.total.prises) ? d.total.prises : d && d.courbe && Number.isInteger(d.courbe.prises) ? d.courbe.prises : 0; const base = n ? T.jour.sous(n) : T.jour.aujourdhui; return d && d.total && d.total.incomplet === true ? `${base} · ${T.jour.incomplet}` : base; };
  const sousSemaine = (e) => { const n = e && e.donnee && Number.isInteger(e.donnee.prises) ? e.donnee.prises : 0; return n ? T.semaine.sous(n) : ''; };

  // `courbeCapteur` : la courbe du widget « Capteur » (pages/widgets-maison-appareils.js).
  window.OdinWidgetsMaisonCourbes = { TEXTES, CSS, nombre, chiffres, heure, nomDuJour, morceauxLus, morceauxDeValeurs, trace, barres, courbeCapteur, poserStyle };
  // La déclaration (lue par pages/widgets-rendu.js). L'appli lue : Midgard (celle de la maison), dont la famille range ces
  // widgets dans le tiroir (la maquette : « Maison »). Au propriétaire seul ; jamais sur l'écran de la maison.
  const VIDES = ['aucune_prise', 'pas_encore_de_releve'];
  (window.OdinWidgetsFamilles = window.OdinWidgetsFamilles || []).push({ famille: 'maison', sortes: [
    { sorte: 'maison_conso_jour', titre: T.jour.titre, quoi: T.jour.quoi, symbole: '⚡', appli: 'midgard', proprio: true, jamaisALaMaison: true, poser: { c: 4, r: 3, pc: 4 }, vides: VIDES, sous: sousJour, dessiner: dessinerJour },
    { sorte: 'maison_energie_semaine', titre: T.semaine.titre, quoi: T.semaine.quoi, symbole: '⚡', appli: 'midgard', proprio: true, jamaisALaMaison: true, poser: { c: 5, r: 3, pc: 4 }, vides: VIDES, sous: sousSemaine, dessiner: dessinerSemaine },
  ] });
})();
