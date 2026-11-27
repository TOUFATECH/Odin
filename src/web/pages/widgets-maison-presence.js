// La famille « Maison » des widgets de l'accueil, la présence (maquette validée « Accueil ») : le petit chiffre « À la
// maison » et la carte « Famille ». Rangées dans ce fichier pour ne pas écrire dans ceux des autres parts de la famille.
// Ce fichier DÉCLARE ses sortes au registre commun (pages/widgets-rendu.js) ; chaque dessin est fait de l'état que le
// serveur a rendu pour le widget (src/valhalla/widgets/maison-presence.ts) et de rien d'autre. Au propriétaire seul,
// jamais sur l'écran de la maison (la même marque que le serveur).
// - Le petit chiffre : combien sont là, sur combien dont Odin sait quelque chose (« 2 / 3 ») ; à la ville près, la
//   réserve est son libellé, et la carte mène au réglage du lieu (« Me localiser »).
// - « Famille » : une pastille par personne (son initiale, une teinte stable tirée de la couleur du thème), un point, et
//   un MOT (là, pas là, incertain, pas de nouvelles) : jamais la couleur seule ; la phrase entière (son nom, l'état, la
//   précision de la règle, l'âge de l'information) pour les lecteurs d'écran et en info-bulle. Une seule rangée : ce qui
//   ne tient pas, « et N de plus ». À la ville près : la réserve est écrite sur la carte, avec « Me localiser ».
// - Rien ne dit où est quelqu'un : ni lieu, ni trajet, ni heure de retour ; aucun lien vers un site de cartes. « Me
//   localiser » ouvre seulement Réglages → Maison, où sont la ville et « Me localiser » d'Odin : ce fichier ne demande
//   jamais la position de l'appareil.
// - Tout texte venu d'une donnée (un prénom) : textContent ; son initiale seule est dessinée. Les nombres et l'âge dans
//   la langue de la page. Aucune langue écrite.
// Rien n'est touché au chargement : seulement window.OdinWidgetsMaisonPresence (textes et calculs, pour les essais) et sa déclaration.
(() => {
  'use strict';
  if (window.OdinWidgetsMaisonPresence) return;

  // ---------------- Dictionnaire (tous les textes de ces deux sortes)
  const TEXTES = {
    presence: { titre: 'À la maison', nom: 'Présence', quoi: 'Combien de personnes sont à la maison : d\'après ta box, ou le téléphone de chacun et le lieu d\'Odin.', ville: 'Là · à la ville près' },
    famille: { titre: 'Famille', quoi: 'Qui est à la maison, une pastille par personne : là, pas là, ou pas de nouvelles. Jamais où.' },
    // Le mot sous chaque pastille, et celui de la phrase entière.
    etats: { la: 'là', pas_la: 'pas là', inconnu: 'incertain', sans_nouvelles: 'pas de nouvelles' },
    etatsDits: { la: 'là', pas_la: 'pas là', inconnu: 'on ne sait pas', sans_nouvelles: 'pas de nouvelles' },
    precisions: { box: 'd\'après la box', maison: 'à la maison près', ville: 'à la ville près' },
    sous: (la, sur) => `${la} à la maison sur ${sur}`, sousVille: (la, sur) => `${la} là sur ${sur}, à la ville près`, sansNouvelles: 'pas de nouvelles',
    // Le compte redit dans le corps à la ville près : court, la réserve est écrite juste à côté.
    compteVille: (la, sur) => `${la} là sur ${sur}`,
    dit: (nom, etat, precision, age) => `${nom} : ${etat}, ${precision}${age ? `, ${age}` : ''}.`,
    plus: (n) => `et ${n} de plus`,
    reserve: 'À la ville près', reserveDit: 'À la ville près : Odin ne connaît que ta ville, pas ta maison. « Me localiser » depuis ton téléphone pour savoir à la maison près.',
    aRegler: 'Lieu à régler', aReglerDit: 'Les positions des membres ne sont pas comptées : Odin ne sait pas où est ta maison. « Me localiser », ou saisis ta ville.',
    localiser: 'Me localiser', ulysse: 'Ouvrir Ulysse',
    vides: {
      personne: 'Personne n\'est suivi : ta box, ou le téléphone d\'un membre qui partage sa position, dit qui est là.',
      lieu_a_regler: 'Odin ne sait pas où est ta maison : « Me localiser » depuis ton téléphone ou ton ordinateur, ou saisis ta ville.',
      sans_nouvelles: 'Pas de nouvelles récentes de personne.',
    },
    // Le petit chiffre : sa phrase courte, et la phrase entière.
    courts: { personne: 'Personne n\'est suivi.', lieu_a_regler: 'Lieu à régler : Me localiser.', sans_nouvelles: 'Pas de nouvelles.' },
    // « Famille » sans personne : la phrase visible (elle tient dans la plus petite carte) ; l'entière en info-bulle et pour les lecteurs d'écran.
    videsCourts: { personne: 'Personne n\'est suivi pour l\'instant.', lieu_a_regler: 'Lieu à régler : ta position ou ta ville.' },
    petitDit: (la, sur, ville) => `${la} sur ${sur} ${ville ? 'là, à la ville près' : 'à la maison'}.`,
  };
  const T = TEXTES;

  // ---------------- Calculs (sans document)
  const langue = () => { try { return (typeof document !== 'undefined' && document && document.documentElement.lang) || undefined; } catch { return undefined; } };
  function nombre(v, lg = langue()) { try { return new Intl.NumberFormat(lg).format(v); } catch { return String(v); } }
  const entier = (v) => (Number.isInteger(v) && v >= 0 ? v : undefined);
  const ETATS = ['la', 'pas_la', 'inconnu', 'sans_nouvelles'], PRECISIONS = ['box', 'maison', 'ville'];
  /** L'initiale d'un prénom (sa première lettre entière, en capitale dans la langue de la page) ; rien de lisible : ''. */
  function initiale(nom) {
    if (typeof nom !== 'string' || !nom.trim()) return '';
    const t = nom.trim();
    let un = Array.from(t)[0];
    try { if (typeof Intl.Segmenter === 'function') un = new Intl.Segmenter(langue(), { granularity: 'grapheme' }).segment(t)[Symbol.iterator]().next().value.segment; } catch { /* la première lettre */ }
    try { return un.toLocaleUpperCase(langue()); } catch { return un.toUpperCase(); }
  }
  /** Une teinte stable pour un prénom (0 à 359), tirée de ses lettres : la même personne garde sa couleur. */
  function teinte(nom) {
    let h = 2166136261;
    for (const c of String(nom ?? '')) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h % 360;
  }
  /** Une personne lue sans confiance : un nom, un état et une précision connus, sinon rien. */
  function personneLue(x) {
    if (!x || typeof x !== 'object' || typeof x.nom !== 'string' || !x.nom.trim() || !ETATS.includes(x.etat)) return null;
    return { nom: x.nom, etat: x.etat, precision: PRECISIONS.includes(x.precision) ? x.precision : '', at: typeof x.at === 'number' && Number.isFinite(x.at) && x.at > 0 ? x.at : 0 };
  }
  /** Le compte lu sans confiance : { la, sur, ville }, ou rien. */
  function compteLu(d) {
    const la = entier(d && d.la), sur = entier(d && d.sur);
    return la === undefined || sur === undefined || la > sur ? null : { la, sur, ville: d.villeSeulement === true };
  }
  /** La fin du sous-titre de « Famille » : le compte vrai ; personne dont on sache quelque chose : « pas de nouvelles ». */
  function sous(e) {
    const d = e && e.etat === 'ok' && e.donnee ? e.donnee : null, c = compteLu(d);
    if (!c) return '';
    if (!c.sur) return entier(d.total) ? T.sansNouvelles : '';
    const lg = langue();
    return (c.ville ? T.sousVille : T.sous)(nombre(c.la, lg), nombre(c.sur, lg));
  }

  // ---------------- Dessin (seulement quand un hôte l'appelle)
  const ICONES = {
    gens: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.2A4.6 4.6 0 0 1 21 18.5"/>',
    lieu: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  };
  const icone = (k) => (Object.prototype.hasOwnProperty.call(ICONES, k) ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[k]}</svg>` : '');
  // Les couleurs : celles du thème d'Odin (--accent, --good, --warn, --ink, --muted, --line). Aucune couleur écrite ici :
  // la teinte d'une pastille est celle de --accent, tournée d'un angle tiré du prénom.
  const CSS = `
/* La hauteur du petit chiffre commun (wr-petit, 44 px) : la carte garde ses 74 px. */
.wpp{position:relative;display:flex;align-items:center;gap:0 12px;min-width:0;height:44px;overflow:hidden;color:inherit;text-decoration:none}
a.wpp:focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:2px}
.fe-edit a.wpp{pointer-events:none}
.wpp-ic{flex:none;width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent,currentColor) 18%,transparent);color:var(--accent,currentColor)}
.wpp-ic svg{width:22px;height:22px}
.wpp[data-ton="muet"] .wpp-ic{background:color-mix(in srgb,var(--muted,currentColor) 18%,transparent);color:var(--muted,currentColor)}
.wpp-t{flex:1 1 0;min-width:0;display:flex;flex-direction:column;justify-content:center}
.wpp-v{display:block;font-size:clamp(15px,17cqi,20px);font-weight:750;letter-spacing:-.02em;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums;color:var(--ink,inherit)}
.wpp-v small{font-size:.58em;font-weight:600;letter-spacing:0;color:var(--muted,inherit)}
.wpp-l{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:10.5px;line-height:1.1;overflow:hidden;overflow-wrap:break-word;color:var(--muted,inherit)}
.wpp[data-ville] .wpp-l{font-weight:650;color:var(--warn,inherit)}
.wpp-phrase{-webkit-line-clamp:3;font-size:11px;line-height:1.2;color:var(--ink,inherit)}
.wpp-go{flex:none;font-size:20px;line-height:1;color:var(--muted,inherit)}
@container (max-width:135px){.wpp{column-gap:8px}.wpp-ic{width:34px;height:34px;border-radius:11px}.wpp-ic svg{width:18px;height:18px}}
@container (max-width:104px){.wpp-ic{display:none}.wpp-l{font-size:11px;overflow-wrap:anywhere}}
:has(>.wpf-corps){display:flex;flex-direction:column}
.wpf-corps{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;gap:6px;color:var(--ink,inherit)}
/* Le contenu est poussé en bas par une marge (pas par justify-content : ce qui déborderait par le haut ne se mesurerait pas). */
.wpf-defile{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column;gap:4px;overflow:hidden}
.wpf-rang{margin-top:auto;display:flex;flex-wrap:wrap;align-items:flex-end;gap:6px 8px;min-width:0}
.wpf-rang>.wpf-btn{margin-left:auto}
.wpf-liste{flex:1 1 58px;list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:4px 6px;min-width:0}
.wpf-pied{margin:0;display:flex;flex-wrap:wrap;gap:0 8px;min-width:0;font-size:11.5px;line-height:1.25}
.wpf-p{flex:none;width:58px;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:0}
.wpf-av{--wpf-c:hsl(from var(--accent,currentColor) calc(h + var(--wpf-h,0)) s l);position:relative;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;font-size:14px;font-weight:700;color:var(--ink,inherit);background:color-mix(in srgb,var(--wpf-c,var(--accent,currentColor)) 30%,transparent);box-shadow:inset 0 0 0 2px var(--wpf-c,var(--accent,currentColor));unicode-bidi:isolate}
.wpf-pt{position:absolute;right:-2px;bottom:-2px;width:12px;height:12px;border-radius:50%;box-sizing:border-box;background:var(--good,currentColor)}
.wpf-p[data-etat="pas_la"] .wpf-pt{background:var(--muted,currentColor)}
.wpf-p[data-etat="inconnu"] .wpf-pt{background:transparent;border:2px solid var(--muted,currentColor)}
.wpf-p[data-etat="sans_nouvelles"] .wpf-pt{background:transparent;border:2px dashed var(--warn,currentColor)}
.wpf-mot{max-width:100%;font-size:11px;line-height:1.15;text-align:center;color:var(--muted,inherit);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:break-word}
.wpf-p[data-etat="la"] .wpf-mot{font-weight:700;color:var(--ink,inherit)}
.wpf-plus,.wpf-calme{margin:0;font-size:11.5px;line-height:1.35;color:var(--muted,inherit)}.wpf-plus:empty,.wpf-pied:empty{display:none}
.wpf-calme{font-size:13px;color:var(--ink,inherit);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:break-word}
.wpf-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.wpf-bas{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px;min-width:0}
.wpf-reserve{min-width:0;font-weight:650;color:var(--warn,inherit);overflow-wrap:anywhere}
/* Le compte, entier, redit sous les pastilles seulement quand le sous-titre de l'en-tête est vraiment coupé (mesuré : ajuster). */
.wpf-compte{font-weight:650;color:var(--ink,inherit);font-variant-numeric:tabular-nums}
.wpf-btn{flex:0 1 auto;max-width:100%;min-height:44px;min-width:44px;padding:4px 12px;border-radius:12px;border:1px solid var(--line,currentColor);background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:650;line-height:1.2;overflow-wrap:anywhere;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.wpf-btn svg{flex:none;width:15px;height:15px}
/* Une carte étroite : « Me localiser » au bout de la rangée des pastilles ne garde que son icône (44 px ; son nom reste en info-bulle et pour les lecteurs d'écran), pour qu'une pastille au moins tienne à côté. */
@container (max-width:250px){.wpf-rang>.wpf-btn{width:44px;padding:0;justify-content:center}.wpf-rang>.wpf-btn>.wpf-btn-t{display:none}}
.wpf-btn:focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:2px}
.wpf-corps [hidden]{display:none!important}`;
  function poserStyle() {
    if (document.getElementById('odinWidgetsMaisonPresence')) return;
    // Hors téléphone, la carte a la hauteur de ses lignes : son corps ne compte pas dans cette hauteur.
    const G = window.OdinGrille, tel = G && G.GRILLE && Number.isInteger(G.GRILLE.telephone) ? G.GRILLE.telephone : 700;
    const s = document.createElement('style'); s.id = 'odinWidgetsMaisonPresence'; s.textContent = `${CSS}\n@media (min-width:${tel + 1}px){.fe-w>.wpf-corps{contain:size}}`; document.head.append(s);
  }
  function el(t, cls, txt) { const n = document.createElement(t); if (cls) n.className = cls; if (txt !== undefined) n.textContent = txt; return n; }
  const decor = (k, cls) => { const s = el('span', cls); s.setAttribute('aria-hidden', 'true'); s.innerHTML = icone(k); return s; };
  const enModifier = (n) => Boolean(n && n.closest && n.closest('.fe-edit'));
  /** Réglages → Maison, où sont la ville et « Me localiser » d'Odin (rien d'autre n'est lancé d'ici). */
  function versLieu() {
    location.hash = '#settings';
    setTimeout(() => { const c = document.querySelector('.schip[data-sec="maison"]'); if (c) c.click(); const l = document.getElementById('lieuCard'); if (l && l.scrollIntoView) l.scrollIntoView({ block: 'start' }); }, 150);
  }
  function bouton(texte, k, aller) {
    const b = el('button', 'wpf-btn'); b.type = 'button'; b.title = texte;
    b.setAttribute('aria-label', texte);
    b.append(decor(k), el('span', 'wpf-btn-t', texte));
    b.addEventListener('click', (ev) => { ev.stopPropagation(); if (enModifier(b)) return; aller(); });
    return b;
  }
  const versUlysse = () => { location.hash = '#app=gna'; };

  /** Le petit chiffre « À la maison ». Sans donnée lisible : rien d'affirmé (null : l'hôte écrit une ligne). */
  function petit(e, o) {
    poserStyle();
    const lien = (o && o.ecran) !== 'maison';
    if (e && e.etat === 'vide') {
      const r = e.raison, phrase = T.courts[r], entiere = T.vides[r];
      if (!phrase) return null;
      const va = lien && r !== 'sans_nouvelles' ? (r === 'lieu_a_regler' ? versLieu : versUlysse) : null;
      return chiffre({ ton: 'muet', phrase, dit: entiere, aller: va });
    }
    const c = compteLu(e && e.donnee);
    if (!c || !c.sur) return null;
    const lg = langue(), quoi = c.ville ? T.presence.ville : (texte(o && o.titre) || T.presence.titre);
    const v = [nombre(c.la, lg), el('small', '', ` / ${nombre(c.sur, lg)}`)];
    return chiffre({ valeur: v, quoi, ville: c.ville, dit: `${T.petitDit(nombre(c.la, lg), nombre(c.sur, lg), c.ville)}${c.ville ? ` ${T.reserveDit}` : ''}`, aller: c.ville && lien ? versLieu : null });
  }
  const texte = (v) => (typeof v === 'string' ? v : '');
  function chiffre(o) {
    const box = el(o.aller ? 'a' : 'div', 'wpp'), t = el('div', 'wpp-t');
    if (o.aller) { box.href = '#settings'; box.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); if (enModifier(box)) return; o.aller(); }); }
    if (o.ton) box.dataset.ton = o.ton;
    if (o.ville) box.dataset.ville = '';
    if (o.valeur) { const v = el('b', 'wpp-v'); v.setAttribute('aria-hidden', 'true'); v.append(...o.valeur); v.title = o.dit; t.append(v); }
    const l = el('span', `wpp-l${o.phrase ? ' wpp-phrase' : ''}`, o.phrase || o.quoi); l.setAttribute('aria-hidden', 'true'); l.title = o.dit;
    t.append(l);
    box.append(decor('gens', 'wpp-ic'), t);
    if (o.aller) { const g = el('span', 'wpp-go', '›'); g.setAttribute('aria-hidden', 'true'); box.append(g); }
    box.append(el('span', 'wpf-sr', o.dit));
    box.title = o.dit;
    return box;
  }

  /** « Famille » : une pastille par personne. Aucune personne lisible : rien d'affirmé (null). */
  function famille(e, o) {
    const lien = (o && o.ecran) !== 'maison';
    if (e && e.etat === 'vide') {
      const phrase = e.raison === 'personne' || e.raison === 'lieu_a_regler' ? T.vides[e.raison] : '';
      if (!phrase) return null;
      poserStyle();
      const c = el('div', 'wpf-corps'), f = el('div', 'wpf-defile');
      const p = el('p', 'wpf-calme'), court = el('span', '', T.videsCourts[e.raison]); court.setAttribute('aria-hidden', 'true');
      p.title = phrase; p.append(court, el('span', 'wpf-sr', phrase)); f.append(p); c.append(f);
      if (lien) { const bas = el('div', 'wpf-bas'); bas.append(e.raison === 'lieu_a_regler' ? bouton(T.localiser, 'lieu', versLieu) : bouton(T.ulysse, 'gens', versUlysse)); c.append(bas); }
      return c;
    }
    const d = e && e.donnee && typeof e.donnee === 'object' ? e.donnee : {}, cpt = compteLu(d);
    const gens = (Array.isArray(d.personnes) ? d.personnes : []).map(personneLue).filter(Boolean);
    if (!cpt || !gens.length) return null;
    poserStyle();
    const lg = langue(), R = window.OdinWidgetsRendu, total = Math.max(entier(d.total) || 0, gens.length);
    const ul = el('ul', 'wpf-liste'), lis = [];
    for (const p of gens) {
      const li = el('li', 'wpf-p'), av = el('span', 'wpf-av', initiale(p.nom)), pt = el('i', 'wpf-pt'), mot = el('span', 'wpf-mot', T.etats[p.etat]);
      li.dataset.etat = p.etat; av.style.setProperty('--wpf-h', String(teinte(p.nom)));
      av.setAttribute('aria-hidden', 'true'); mot.setAttribute('aria-hidden', 'true'); pt.setAttribute('aria-hidden', 'true');
      const age = p.at && R && typeof R.depuis === 'function' ? R.depuis(p.at) : '';
      const dit = T.dit(p.nom, T.etatsDits[p.etat], p.precision ? T.precisions[p.precision] : '', age);
      av.append(pt); li.append(av, mot, el('span', 'wpf-sr', dit)); li.title = dit; mot.title = dit;
      ul.append(li); lis.push(li);
    }
    // La rangée des pastilles ; dessous, « et N de plus » et la réserve. La réserve (à la ville près), ou le lieu à régler
    // pour les membres, est écrite sur la carte, avec « Me localiser » au bout de la rangée.
    const plus = el('span', 'wpf-plus'), pied = el('p', 'wpf-pied'), rang = el('div', 'wpf-rang'), f = el('div', 'wpf-defile'), c = el('div', 'wpf-corps');
    rang.append(ul);
    const compte = cpt.ville && cpt.sur ? T.compteVille(nombre(cpt.la, lg), nombre(cpt.sur, lg)) : sous(e);
    let k = null;
    if (compte) { k = el('span', 'wpf-compte', compte); k.setAttribute('aria-hidden', 'true'); pied.append(k); }
    pied.append(plus);
    if (cpt.ville || d.lieuARegler === true) {
      const r = el('span', 'wpf-reserve', cpt.ville ? T.reserve : T.aRegler);
      r.title = cpt.ville ? T.reserveDit : T.aReglerDit; r.append(el('span', 'wpf-sr', ` : ${r.title}`));
      pied.append(r); if (lien) rang.append(bouton(T.localiser, 'lieu', versLieu));
    }
    f.append(rang, pied); c.append(f);
    const a = { c, f, ul, lis, plus, total, lg, k };
    compter(a);
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => { if (!c.isConnected) { ro.disconnect(); return; } ajuster(a); });
      ro.observe(c);
    }
    return c;
  }
  /** « et N de plus » : les personnes qui ne sont pas montrées. */
  function compter(a) {
    const reste = a.total - a.ul.children.length;
    a.plus.textContent = reste > 0 ? T.plus(nombre(reste, a.lg)) : '';
    a.ul.hidden = !a.ul.children.length;
  }
  /** Une seule rangée, dans la hauteur de la carte : tout remettre, puis retirer la dernière pastille tant qu'elle passe à la ligne ou déborde. */
  function ajuster(a) {
    // Le compte n'est redit que si le sous-titre de l'en-tête est coupé (sans en-tête mesurable : redit).
    if (a.k) { const s = (a.c.closest && a.c.closest('.fe-w') || a.c.parentElement || a.c).querySelector('.wr-s'); a.k.hidden = Boolean(s) && s.scrollWidth <= s.clientWidth + 1; }
    a.ul.replaceChildren(...a.lis); compter(a);
    const trop = () => {
      const k = a.ul.children; if (!k.length) return false;
      return k[k.length - 1].offsetTop > k[0].offsetTop + 2 || a.f.scrollHeight > a.f.clientHeight + 1 || a.c.scrollHeight > a.c.clientHeight + 1;
    };
    while (a.ul.children.length > 1 && trop()) { a.ul.lastElementChild.remove(); compter(a); }
    // Même une pastille ne tient pas (une carte très basse) : le compte de l'en-tête et « et N de plus » restent.
    if (a.ul.children.length === 1 && trop()) { a.ul.replaceChildren(); compter(a); }
  }

  window.OdinWidgetsMaisonPresence = { TEXTES, CSS, initiale, teinte, personneLue, compteLu, sous, dessinerPetit: petit, dessinerFamille: famille };
  // La déclaration (lue par pages/widgets-rendu.js) : la famille « maison », au propriétaire seul, jamais sur l'écran de
  // la maison (la même marque que le serveur), l'appli lue : Ulysse. « Famille » est rangée avec Odin dans le tiroir, comme
  // la maquette la range ; « À la maison » avec la maison (la famille de son appli). Les tailles de la maquette.
  (window.OdinWidgetsFamilles = window.OdinWidgetsFamilles || []).push({ famille: 'maison', sortes: [
    { sorte: 'maison_presence', titre: T.presence.titre, nom: T.presence.nom, quoi: T.presence.quoi, symbole: '👥', appli: 'gna', proprio: true, jamaisALaMaison: true, petit: true, poser: { c: 2, r: 1, pr: 1 }, vides: ['personne', 'lieu_a_regler', 'sans_nouvelles'], dessiner: petit },
    { sorte: 'maison_famille', groupe: 'odin', titre: T.famille.titre, quoi: T.famille.quoi, symbole: '👪', appli: 'gna', proprio: true, jamaisALaMaison: true, poser: { c: 3, r: 2, pc: 4 }, vides: ['personne', 'lieu_a_regler'], sous, dessiner: famille },
  ] });
})();
