// La famille « Veille » des widgets de l'accueil (maquette validée « Accueil ») : la liste des alertes pas encore vues
// (« Alertes »), les sites surveillés par Arachné (« Sites web », son style de départ « Aperçus », avec une miniature
// neutre : aucun aperçu en image n'existe) et le petit chiffre « Sites » (combien répondent, sur combien).
// Ce fichier DÉCLARE ses sortes au registre commun (pages/widgets-rendu.js) ; l'accueil les dessine et les propose sans
// rien savoir d'elles. Chaque dessin est fait de l'état que le serveur a rendu (src/valhalla/widgets/veille.ts).
// - Le bord rouge n'est mis que s'il y a une panne (la classe wv-panne sur le corps ; la carte qui le porte se colore).
// - « Vu », « Vérifier », « Essayer », « Relancer » : seulement quand le serveur dit que qui regarde peut agir (le
//   propriétaire) ; ils passent par ce qui existe (POST /api/valhalla/ack, POST /api/valhalla/act avec l'action
//   d'Arachné), et une confirmation demandée par le serveur est montrée avant de renvoyer.
// - Tout texte venu d'une alerte ou d'un site (titre, nom, message) est posé par textContent ; les icônes sont dessinées ici.
// - Les âges sont ceux du dessin commun (« il y a 12 min ») ; les nombres suivent la langue de la page.
// Rien n'est touché au chargement : seulement window.OdinWidgetsVeille (ses textes et calculs, pour les essais) et sa déclaration.
(() => {
  'use strict';
  if (window.OdinWidgetsVeille) return;

  // ---------------- Dictionnaire (tous les textes de la famille)
  const TEXTES = {
    alertes: {
      titre: 'Alertes', nom: 'Alertes et erreurs', quoi: 'tes alertes pas encore vues, les plus récentes d\'abord',
      aVoir: 'à voir', graves: (pl) => (pl ? 'graves' : 'grave'), aSurveiller: 'à surveiller', vu: 'Vu', vuNom: (t) => `Marquer vu : ${t}`, faite: 'Marquée vue.', plus: (n) => `et ${n} de plus`,
      niveaux: { critique: 'critique', haute: 'grave', moyenne: 'à surveiller', info: 'pour info' },
    },
    sites: {
      titre: 'Sites web', quoi: 'Arachné : tes sites, s\'ils répondent, et leur vitesse',
      aucun: 'Aucun site surveillé pour l\'instant.', ajouter: 'Ajouter un site',
      etats: { panne: 'En panne', lent: 'Lent', ok: 'En ligne', inconnu: 'À vérifier' },
      enLigne: (n) => `${n} en ligne`, panne: (n) => `${n} en panne`, lents: (t, pl) => (pl ? `${t} lents` : `${t} lent`),
      depuis: (t) => `en panne · ${t}`, verifie: (t) => `vérifié ${t}`, plus: (n) => `et ${n} de plus`,
      actionsDe: (nom) => `Actions pour ${nom}`,
      actions: { etat: 'Vérifier', tester: 'Essayer', relancer: 'Relancer' }, enCours: 'Arachné s\'en occupe…', annule: 'Annulé : rien n\'a été fait.', echec: 'Pas fait : réessaie.',
    },
    petit: {
      titre: 'Arachné · en ligne', nom: 'Sites en ligne', quoi: 'combien de tes sites répondent', dit: (a, t) => `${a} sites sur ${t} répondent.`,
      aucun: 'Aucun site surveillé.', pasVerifies: 'Pas encore vérifiés : Arachné s\'en occupe.',
    },
  };
  const T = TEXTES;

  // ---------------- Calculs (sans document)
  const ETATS_SITE = ['panne', 'lent', 'ok', 'inconnu'];
  /** Combien de sites montrer selon la hauteur du widget (en lignes) : une ligne compacte jusqu'à 2, puis 2, 4 ou 6 cartes. */
  const combienDeSites = (r) => (r <= 2 ? 1 : r === 3 ? 2 : r <= 5 ? 4 : 6);
  /** Combien d'alertes montrer selon la hauteur (la maquette : une de moins que la hauteur en lignes, une au moins). */
  const combienDAlertes = (r) => Math.max(1, (Number.isInteger(r) ? r : 3) - 1);
  /** La teinte d'une alerte d'après sa gravité ; une gravité inconnue : neutre. */
  const tonAlerte = (n) => (n === 'critique' || n === 'haute' ? 'mal' : n === 'moyenne' ? 'attention' : 'neutre');
  /** Un site lu sans confiance : un nom, un état connu ; sinon rien. */
  function siteLu(x) {
    if (!x || typeof x !== 'object' || typeof x.nom !== 'string' || !x.nom) return null;
    return { nom: x.nom, etat: ETATS_SITE.includes(x.etat) ? x.etat : 'inconnu', ms: Number.isFinite(x.ms) && x.ms >= 0 ? x.ms : undefined,
      verifie: Number.isFinite(x.verifie) ? x.verifie : undefined, depuis: Number.isFinite(x.depuis) ? x.depuis : undefined, relancer: x.relancer === true };
  }
  /** Une alerte lue sans confiance. */
  function alerteLue(x) {
    if (!x || typeof x !== 'object' || typeof x.titre !== 'string') return null;
    return { id: typeof x.id === 'string' && x.id ? x.id : '', nomAppli: typeof x.nomAppli === 'string' ? x.nomAppli : '', titre: x.titre, niveau: typeof x.niveau === 'string' ? x.niveau : '', at: Number.isFinite(x.at) ? x.at : 0 };
  }

  // ---------------- Dessin (seulement quand un hôte l'appelle)
  const ICONES = {
    alerte: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2h.01"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
    calme: '<circle cx="12" cy="12" r="8.5"/><path d="m8 12.5 3 3 5-6"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.4 3.6 5.3 3.6 8.5s-1.1 6.1-3.6 8.5c-2.5-2.4-3.6-5.3-3.6-8.5S9.5 5.9 12 3.5z"/>',
    // La miniature neutre d'un site : une fenêtre de navigateur sans contenu (aucun aperçu en image n'existe).
    page: '<rect x="2.5" y="4" width="19" height="16" rx="2.5"/><path d="M2.5 8.5h19M5.5 6.3h.01M7.8 6.3h.01M6 12h8M6 15h12"/>',
  };
  const icone = (k) => (Object.prototype.hasOwnProperty.call(ICONES, k) ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[k]}</svg>` : '');
  // Les couleurs : celles du thème d'Odin (--good, --warn, --bad, --ink, --muted, --line, --accent). Aucune couleur écrite ici.
  const CSS = `
/* Le corps des grands widgets de la famille remplit la carte, et défile s'il est plus haut qu'elle. */
:has(>.wv-corps){display:flex;flex-direction:column}
.wv-corps{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column;gap:8px;overflow:auto;overscroll-behavior:contain;color:var(--ink,var(--text,inherit))}
/* La partie qui défile (la liste des sites, des alertes) : le résumé et les boutons d'action restent en vue. Le retrait
   garde entier le contour du focus. */
.wv-defile{flex:1 1 auto;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;padding:3px;margin:-3px;display:flex;flex-direction:column;gap:6px}
.wv-defile>*,.wv-corps>:not(.wv-defile){flex:none}
.wv-calme{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;font-size:13.5px;line-height:1.35}
.wv-calme svg{flex:none;width:22px;height:22px;color:var(--good,currentColor)}
.wv-btn{min-height:44px;min-width:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line,currentColor);background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:650;cursor:pointer}
.wv-btn:focus-visible,.wv-site:focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:2px}
.wv-btn[disabled]{opacity:.55;cursor:default}
.wv-dit{font-size:12px;line-height:1.35;color:var(--muted,inherit);overflow-wrap:anywhere}.wv-dit:empty{display:none}
/* Les alertes : l'icône teintée par la gravité, le titre, l'appli et l'âge, « Vu ». */
.wv-compte{font-size:12.5px;color:var(--muted,inherit)}.wv-compte b{color:var(--warn,inherit);font-variant-numeric:tabular-nums}
.wv-liste{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;min-width:0}
.wv-al{display:flex;align-items:center;gap:10px;min-width:0;padding:3px 0;border-bottom:1px solid var(--line,transparent)}.wv-al:last-child{border-bottom:0}
.wv-al-ic{flex:none;width:32px;height:32px;border-radius:10px;display:grid;place-items:center;background:color-mix(in srgb,var(--wv-c) 16%,transparent);color:var(--wv-c)}.wv-al-ic svg{width:18px;height:18px}
.wv-al{--wv-c:var(--muted,currentColor)}.wv-al.wv-mal{--wv-c:var(--bad,currentColor)}.wv-al.wv-attention{--wv-c:var(--warn,currentColor)}
.wv-al-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;font-size:13px;line-height:1.3}
.wv-al-t b{font-weight:600;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.wv-al-t small,.wv-plus{font-size:11.5px;color:var(--muted,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wv-plus:empty{display:none}
/* La barre de gravité de la maquette : grave, à surveiller, le reste ; chaque part à la mesure de son nombre. */
.wv-sev{flex:none;display:flex;gap:3px;height:6px;border-radius:999px;overflow:hidden}.wv-sev>i{min-width:0;border-radius:999px}
.wv-sev>i:nth-child(1){background:var(--bad,currentColor)}.wv-sev>i:nth-child(2){background:var(--warn,currentColor)}.wv-sev>i:nth-child(3){background:color-mix(in srgb,var(--muted,currentColor) 45%,transparent)}
.wv-compte{display:flex;flex-wrap:wrap;gap:2px 12px;margin:0}.wv-compte .wv-g{color:var(--bad,inherit)}
/* Les sites : le résumé, puis une carte par site (la miniature neutre, le point, le nom, l'état). */
.wv-resume{display:flex;flex-wrap:wrap;gap:6px}
.wv-pill{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;font-size:11.5px;font-weight:600;white-space:nowrap;background:color-mix(in srgb,var(--wv-c,var(--muted,currentColor)) 16%,transparent)}
.wv-pill.wv-ok{--wv-c:var(--good,currentColor)}.wv-pill.wv-mal{--wv-c:var(--bad,currentColor)}.wv-pill.wv-lent{--wv-c:var(--warn,currentColor)}
.wv-grille{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,150px),1fr));gap:8px;min-width:0}
.wv-site{--wv-c:var(--muted,currentColor);width:100%;min-height:44px;min-width:0;display:flex;flex-direction:column;gap:4px;padding:6px 6px 8px;border-radius:14px;border:1px solid var(--line,transparent);background:color-mix(in srgb,var(--ink,currentColor) 4%,transparent);color:inherit;font:inherit;text-align:left;cursor:default}
button.wv-site{cursor:pointer}.wv-site[aria-pressed="true"]{border-color:var(--accent,currentColor)}
.wv-site.wv-ok{--wv-c:var(--good,currentColor)}.wv-site.wv-panne{--wv-c:var(--bad,currentColor)}.wv-site.wv-lent{--wv-c:var(--warn,currentColor)}
.wv-mini{display:grid;place-items:center;height:52px;border-radius:9px;background:color-mix(in srgb,var(--wv-c) 10%,transparent);color:color-mix(in srgb,var(--wv-c) 70%,var(--muted,currentColor))}.wv-mini svg{width:30px;height:30px}
.wv-nom{display:flex;align-items:center;gap:6px;min-width:0;font-size:13px}
.wv-nom b{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}
.wv-pt{flex:none;width:8px;height:8px;border-radius:50%;background:var(--wv-c)}
.wv-etat{padding-left:14px;font-size:11.5px;color:var(--muted,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wv-site.wv-panne .wv-etat{color:var(--bad,inherit)}.wv-site.wv-lent .wv-etat{color:var(--warn,inherit)}
.wv-compact .wv-site{flex-direction:row;align-items:center;flex-wrap:wrap;gap:2px 8px}.wv-compact .wv-etat{padding-left:0}
.wv-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.wv-actions[hidden]{display:none}
.wv-cible{flex:1 1 100%;min-width:0;font-size:12px;color:var(--muted,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Le bord rouge : seulement quand un site est en panne (la maquette le met toujours). */
:has(>.wv-sites.wv-panne){border-color:color-mix(in srgb,var(--bad,red) 70%,transparent)!important;box-shadow:0 0 0 1px color-mix(in srgb,var(--bad,red) 60%,transparent),0 12px 36px color-mix(in srgb,var(--bad,red) 22%,transparent)!important}
/* Le petit chiffre « Sites » : une icône teintée, la valeur, son libellé. */
.wv-chiffre{--wv-c:var(--accent,currentColor);display:flex;align-items:center;gap:12px;min-width:0;height:44px;overflow:hidden}
.wv-ic{flex:none;width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:color-mix(in srgb,var(--wv-c) 18%,transparent);color:var(--wv-c)}.wv-ic svg{width:22px;height:22px}
.wv-t{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center}
.wv-v{display:block;font-size:clamp(15px,17cqi,21px);font-weight:750;letter-spacing:-.02em;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.wv-v small{font-size:.58em;font-weight:600;letter-spacing:0;color:var(--muted,inherit)}
.wv-l{display:block;font-size:11.5px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted,inherit)}
.wv-chiffre.wv-calme-c{--wv-c:var(--good,currentColor)}.wv-chiffre.wv-alarme{--wv-c:var(--bad,currentColor)}.wv-chiffre.wv-alarme .wv-v{color:var(--bad,inherit)}
.wv-chiffre.wv-ancien{--wv-c:var(--muted,currentColor)}.wv-age{font-weight:700;color:var(--warn,inherit)}
@container (max-width:135px){.wv-chiffre{gap:8px}.wv-ic{width:34px;height:34px;border-radius:11px}.wv-ic svg{width:18px;height:18px}}
@container (max-width:104px){.wv-ic{display:none}}`;
  function poserStyle() {
    const R = window.OdinWidgetsRendu;
    if (R && typeof R.poserStyle === 'function') R.poserStyle(); // la classe des textes dits aux lecteurs d'écran
    if (document.getElementById('odinWidgetsVeille')) return;
    // Hors téléphone, la carte de la grille a la hauteur de ses lignes : son corps ne compte pas dans cette hauteur (il
    // défile), si bien qu'une longue liste ou les boutons d'un site n'étirent ni la carte, ni sa voisine. Au téléphone, la
    // hauteur suit le contenu (la règle de la grille).
    const G = window.OdinGrille, tel = G && G.GRILLE && Number.isInteger(G.GRILLE.telephone) ? G.GRILLE.telephone : 700;
    const s = document.createElement('style'); s.id = 'odinWidgetsVeille'; s.textContent = `${CSS}\n@media (min-width:${tel + 1}px){.fe-w>.wv-corps{contain:size}}`; document.head.append(s);
  }
  function el(t, cls, texte) { const n = document.createElement(t); if (cls) n.className = cls; if (texte !== undefined) n.textContent = texte; return n; }
  const langue = () => { try { return document.documentElement.lang || undefined; } catch { return undefined; } };
  const nombre = (n) => { try { return new Intl.NumberFormat(langue()).format(n); } catch { return String(n); } };
  /** Le pluriel selon la règle de la langue de la page (pas « plus de 1 ») ; le dictionnaire choisit le mot. */
  const pluriel = (n) => { try { return new Intl.PluralRules(langue()).select(n) !== 'one'; } catch { return n !== 1; } };
  const depuis = (at) => { const R = window.OdinWidgetsRendu; return R && typeof R.depuis === 'function' ? R.depuis(at) : ''; };
  const decor = (k, cls) => { const s = el('span', cls); s.setAttribute('aria-hidden', 'true'); s.innerHTML = icone(k); return s; };
  /** La hauteur du widget, en lignes de la grille. */
  function lignesDe(w, defaut) {
    const G = window.OdinGrille;
    try { if (G && typeof G.taille === 'function') return G.taille(w).r; } catch { /* la valeur écrite */ }
    return w && Number.isInteger(w.r) ? w.r : defaut;
  }
  /** Un appel à ce qui existe sur le serveur (la session de la page) ; rend la réponse lue, ou rien. */
  async function poster(chemin, corps) {
    try {
      const r = await fetch(chemin, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(corps) });
      return await r.json().catch(() => ({ ok: false }));
    } catch { return undefined; }
  }
  /** Un état calme d'un grand widget : son icône, sa phrase, au plus un bouton. */
  function calme(texte, bouton) {
    poserStyle();
    const c = el('div', 'wv-corps'), l = el('p', 'wv-calme');
    l.append(decor('calme'), el('span', '', texte)); c.append(l);
    if (bouton) c.append(bouton);
    return c;
  }

  /** Les alertes pas encore vues : la liste, les plus récentes d'abord ; zéro (l'état « vide » du serveur) : le calme. */
  function alertes(e, o) {
    const R = window.OdinWidgetsRendu;
    if (e.etat === 'vide') return e.raison === 'aucune_alerte' ? calme(R.decrire(e, {}).texte) : null;
    const d = e.donnee || {}, liste = (Array.isArray(d.alertes) ? d.alertes : []).map(alerteLue).filter(Boolean);
    let total = Number.isInteger(d.total) && d.total >= liste.length ? d.total : liste.length;
    if (!liste.length) return null; // une liste illisible : rien d'affirmé
    poserStyle();
    // Les comptes par gravité (la barre de la maquette) : ceux du serveur, sur toutes les alertes à voir ; illisibles : 0.
    const compteDe = (x) => (Number.isInteger(x) && x >= 0 && x <= total ? x : 0);
    let graves = compteDe(d.graves), aSurveiller = Math.min(compteDe(d.aSurveiller), total - graves);
    const estGrave = (n) => n === 'critique' || n === 'haute';
    const agir = d.agir === true && o.ecran !== 'maison', c = el('div', 'wv-corps wv-alertes'), compte = el('p', 'wv-compte'), ul = el('ul', 'wv-liste'), dit = el('p', 'wv-dit');
    const sev = el('div', 'wv-sev'), defile = el('div', 'wv-defile'), plus = el('p', 'wv-plus');
    sev.setAttribute('aria-hidden', 'true'); sev.append(el('i'), el('i'), el('i'));
    dit.setAttribute('role', 'status');
    // Autant de lignes que la hauteur en tient (la maquette) ; les autres attendent, et prennent la place d'une alerte vue.
    const attente = liste.slice(combienDAlertes(lignesDe(o.w, 3)));
    const recompter = () => {
      const parts = [[el('b', '', nombre(total)), ` ${T.alertes.aVoir}`]];
      if (graves) parts.push([el('b', 'wv-g', nombre(graves)), ` ${T.alertes.graves(pluriel(graves))}`]);
      if (aSurveiller) parts.push([el('b', '', nombre(aSurveiller)), ` ${T.alertes.aSurveiller}`]);
      compte.replaceChildren(...parts.map((p) => { const s = el('span'); s.append(...p); return s; }));
      const [g, m, a] = sev.children;
      g.style.flex = String(graves); m.style.flex = String(aSurveiller); a.style.flex = String(Math.max(0, total - graves - aSurveiller));
      const reste = total - ul.children.length; plus.textContent = reste > 0 ? T.alertes.plus(nombre(reste)) : '';
    };
    const ligne = (a) => {
      const li = el('li', `wv-al wv-${tonAlerte(a.niveau)}`), t = el('div', 'wv-al-t'), ic = decor(a.niveau === 'info' ? 'info' : 'alerte', 'wv-al-ic');
      const niveau = T.alertes.niveaux[a.niveau] || '', bas = el('small'), suite = [a.nomAppli, niveau].filter(Boolean).join(' · ');
      // L'âge en premier : c'est lui qui reste quand la ligne est coupée.
      if (a.at) { const h = el('time', '', depuis(a.at)); try { h.dateTime = new Date(a.at).toISOString(); } catch { /* sans attribut */ } bas.append(h); }
      if (suite) bas.append(a.at ? ` · ${suite}` : suite);
      t.append(el('b', '', a.titre), bas);
      li.append(ic, t);
      if (agir && a.id) {
        const b = el('button', 'wv-btn', T.alertes.vu); b.type = 'button'; b.setAttribute('aria-label', T.alertes.vuNom(a.titre));
        b.addEventListener('click', async (ev) => {
          ev.stopPropagation(); b.disabled = true;
          const r = await poster('/api/valhalla/ack', { ids: [a.id] });
          if (!r || r.ok !== true) { b.disabled = false; dit.textContent = T.sites.echec; return; }
          li.remove(); total = Math.max(0, total - 1); dit.textContent = T.alertes.faite;
          if (estGrave(a.niveau)) graves = Math.max(0, graves - 1); else if (a.niveau === 'moyenne') aSurveiller = Math.max(0, aSurveiller - 1);
          if (attente.length) ul.append(ligne(attente.shift()));
          if (!ul.children.length && total === 0) { c.replaceWith(calme(R.decrire({ etat: 'vide', raison: 'aucune_alerte' }, {}).texte)); return; }
          recompter();
        });
        li.append(b);
      }
      return li;
    };
    for (const a of liste.slice(0, liste.length - attente.length)) ul.append(ligne(a));
    recompter();
    defile.append(ul, plus);
    c.append(sev, compte, defile, dit);
    return c;
  }

  /** Une carte de site : la miniature neutre (sauf en ligne compacte), le point de son état, son nom, ce qu'on sait de lui. */
  function carteSite(s, compacte, agir) {
    const b = el(agir ? 'button' : 'div', `wv-site wv-${s.etat}`);
    if (agir) { b.type = 'button'; b.setAttribute('aria-pressed', 'false'); }
    if (!compacte) b.append(decor('page', 'wv-mini'));
    const nom = el('span', 'wv-nom'); nom.append(el('i', 'wv-pt'), el('b', '', s.nom)); nom.title = s.nom;
    const quoi = s.etat === 'panne' ? (s.depuis ? T.sites.depuis(depuis(s.depuis)) : T.sites.etats.panne)
      : s.etat === 'inconnu' ? T.sites.etats.inconnu : [s.etat === 'lent' ? T.sites.etats.lent : '', s.ms !== undefined ? `${nombre(s.ms)} ms` : T.sites.etats.ok].filter(Boolean).join(' · ');
    b.append(nom, el('small', 'wv-etat', quoi));
    return b;
  }
  /** Lance une action d'Arachné pour un site, avec la confirmation que le serveur demanderait. Rend le texte à dire. */
  async function lancer(action, site) {
    const corps = { module: 'idunn', action, input: { site } };
    let r = await poster('/api/valhalla/act', corps);
    if (r && r.confirm) {
      const D = window.OdinDialog, oui = D && typeof D.confirm === 'function' ? await D.confirm(String(r.confirm), { danger: true }) : false;
      if (!oui) return T.sites.annule;
      r = await poster('/api/valhalla/act', { ...corps, confirm: true });
    }
    if (!r) return T.sites.echec;
    const t = typeof r.text === 'string' ? r.text : typeof r.error === 'string' ? r.error : '';
    return (t.split('\n')[0] || (r.ok === false ? T.sites.echec : '')).slice(0, 240);
  }
  /** « Sites web », le style de départ de la maquette (« Aperçus ») : le résumé, puis les sites, les pannes d'abord. */
  function sites(e, o) {
    if (e.etat === 'vide') {
      if (e.raison !== 'aucun_site') return null;
      // Zéro site : le calme, et « Ajouter un site », qui ouvre Arachné (son formulaire « Surveiller un site »).
      const b = el('button', 'wv-btn', T.sites.ajouter); b.type = 'button';
      b.addEventListener('click', (ev) => { ev.stopPropagation(); location.hash = '#app=idunn'; });
      return calme(T.sites.aucun, o.ecran === 'maison' ? null : b);
    }
    const d = e.donnee || {}, liste = (Array.isArray(d.sites) ? d.sites : []).map(siteLu).filter(Boolean);
    if (!liste.length) return null; // illisible : rien d'affirmé
    poserStyle();
    const n = (k) => liste.filter((x) => x.etat === k).length, enPanne = n('panne'), r = lignesDe(o.w, 5), montre = combienDeSites(r), compacte = r <= 2;
    const agir = d.agir === true && o.ecran !== 'maison';
    const c = el('div', `wv-corps wv-sites${enPanne ? ' wv-panne' : ''}${compacte ? ' wv-compact' : ''}`), resume = el('div', 'wv-resume');
    const pill = (texte, ton) => resume.append(el('span', `wv-pill wv-${ton}`, texte));
    pill(T.sites.enLigne(nombre(n('ok') + n('lent'))), 'ok');
    if (enPanne) pill(T.sites.panne(nombre(enPanne)), 'mal');
    if (n('lent')) pill(T.sites.lents(nombre(n('lent')), pluriel(n('lent'))), 'lent');
    const ul = el('ul', 'wv-grille'), dit = el('p', 'wv-dit'); dit.setAttribute('role', 'status');
    const barre = el('div', 'wv-actions'), cible = el('span', 'wv-cible'); barre.hidden = true; barre.setAttribute('role', 'group');
    let choisi = null;
    const montrerActions = (s, carte) => {
      for (const x of ul.querySelectorAll('.wv-site')) x.setAttribute('aria-pressed', String(x === carte && choisi !== s));
      if (choisi === s) { choisi = null; barre.hidden = true; return; }
      choisi = s; cible.textContent = s.nom; barre.setAttribute('aria-label', T.sites.actionsDe(s.nom));
      const boutons = ['etat', 'tester', ...(s.relancer ? ['relancer'] : [])].map((a) => {
        const b = el('button', 'wv-btn', T.sites.actions[a]); b.type = 'button'; b.dataset.action = a;
        b.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          for (const x of barre.querySelectorAll('button')) x.disabled = true;
          dit.textContent = T.sites.enCours;
          try { dit.textContent = await lancer(a, s.nom); } finally { for (const x of barre.querySelectorAll('button')) x.disabled = false; }
        });
        return b;
      });
      barre.replaceChildren(cible, ...boutons); barre.hidden = false;
    };
    for (const s of liste.slice(0, montre)) {
      const li = el('li'), carte = carteSite(s, compacte, agir);
      if (agir) carte.addEventListener('click', (ev) => { ev.stopPropagation(); montrerActions(s, carte); });
      li.append(carte); ul.append(li);
    }
    // Les sites défilent ; le résumé et la barre d'actions restent en vue, dans la hauteur de la carte.
    const defile = el('div', 'wv-defile'); defile.append(ul);
    if (liste.length > montre) defile.append(el('p', 'wv-plus', T.sites.plus(nombre(liste.length - montre))));
    c.append(resume, defile);
    if (agir) c.append(barre);
    c.append(dit);
    return c;
  }
  /** Sous le titre de « Sites web » : depuis quand la dernière vérification (la pastille d'une donnée ancienne est celle de l'en-tête). */
  // Aucun site encore vérifié (verifies 0) : rien n'est affirmé ; `at` n'est alors que l'heure de la lecture.
  const sousSites = (e) => (e.etat === 'ok' && Number.isFinite(e.at) && Number.isInteger(e.donnee?.verifies) && e.donnee.verifies > 0 ? T.sites.verifie(depuis(e.at)) : '');

  /** Le petit chiffre « Sites » : combien répondent, sur combien ; en couleur d'alarme s'il y a une panne. */
  function petitSites(e, o) {
    const R = window.OdinWidgetsRendu, titre = typeof o.titre === 'string' && o.titre ? o.titre : T.petit.titre;
    if (e.etat === 'vide') {
      const phrase = e.raison === 'aucun_site' ? T.petit.aucun : e.raison === 'sites_pas_verifies' ? T.petit.pasVerifies : '';
      return phrase ? R.etatPetit({ ...R.decrire(e, {}), texte: phrase }, { titre }) : null;
    }
    const d = e.donnee || {};
    if (!Number.isInteger(d.enLigne) || !Number.isInteger(d.total) || d.total < 1 || d.enLigne < 0 || d.enLigne > d.total) return null; // jamais un chiffre inventé
    poserStyle();
    const age = typeof o.pastille === 'string' ? o.pastille : '', panne = Number.isInteger(d.panne) && d.panne > 0;
    const box = el('div', `wv-chiffre ${age ? 'wv-ancien' : panne ? 'wv-alarme' : 'wv-calme-c'}`), t = el('div', 'wv-t'), v = el('b', 'wv-v'), l = el('span', 'wv-l');
    const phrase = `${T.petit.dit(nombre(d.enLigne), nombre(d.total))}${age ? ` ${R.TEXTES.depuisNom(age)}.` : ''}`;
    v.append(nombre(d.enLigne), el('small', '', ` / ${nombre(d.total)}`)); v.setAttribute('aria-hidden', 'true'); l.setAttribute('aria-hidden', 'true');
    if (age) l.append(el('span', 'wv-age', age), ` · ${titre}`); else l.textContent = titre;
    t.append(v, l); box.append(decor('globe', 'wv-ic'), t, el('span', 'wr-sr', phrase)); box.title = phrase;
    return box;
  }

  window.OdinWidgetsVeille = { TEXTES, CSS, combienDeSites, combienDAlertes, tonAlerte, siteLu, alerteLue };
  // La déclaration de la famille (lue par pages/widgets-rendu.js, quel que soit l'ordre de chargement). Les tailles sont
  // celles de la maquette : 4 × 3 pour les alertes, 4 × 5 pour les sites, 2 × 1 pour le petit chiffre.
  (window.OdinWidgetsFamilles = window.OdinWidgetsFamilles || []).push({ famille: 'veille', sortes: [
    { sorte: 'alertes_liste', titre: T.alertes.titre, nom: T.alertes.nom, quoi: T.alertes.quoi, symbole: '🔔', appli: 'forseti', poser: { c: 4, r: 3, pc: 4 }, vides: ['aucune_alerte'], dessiner: alertes },
    { sorte: 'sites', titre: T.sites.titre, quoi: T.sites.quoi, symbole: '🌐', appli: 'idunn', poser: { c: 4, r: 5, pc: 4 }, vides: ['aucun_site'], sous: sousSites, dessiner: sites },
    { sorte: 'sites_petit', titre: T.petit.titre, nom: T.petit.nom, quoi: T.petit.quoi, symbole: '🌐', appli: 'idunn', petit: true, poser: { c: 2, r: 1, pr: 1 }, vides: ['aucun_site', 'sites_pas_verifies'], dessiner: petitSites },
  ] });
})();
