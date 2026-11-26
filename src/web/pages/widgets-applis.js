// La famille « Applis » des widgets de l'accueil (maquette validée « Accueil », le widget « générique ») : le widget de
// n'importe quelle appli d'Odin. Rien n'y est écrit par appli : il dessine ce que le serveur a rendu pour CE widget
// (src/valhalla/widgets/applis.ts) — la famille de l'appli, sa phrase, sa pastille, ses chiffres clés, ses actions
// rapides. Le nom et la tuile de l'appli, « Ouvrir › » et « ⋯ » sont ceux de l'en-tête commun (pages/widgets-rendu.js).
// Ce fichier DÉCLARE sa sorte au registre commun ; il n'a pas de ligne à lui dans le tiroir « Ajouter un widget » (le
// tiroir a déjà une ligne par appli du catalogue, et c'est elle qui pose ce widget, pour cette appli : fenetre.js).
// - La pastille est calculée de la donnée : une alerte grave pas encore vue, puis des alertes à voir, puis une appli qui
//   ne répond pas, sinon « Prête ». Des alertes que le serveur n'a pas pu lire : aucune pastille (jamais un vert fixe).
// - Comme la maquette : la pastille ; la phrase sur deux lignes (trois à partir de trois lignes de grille) ; les actions
//   rapides à partir de trois lignes ou de quatre colonnes (deux, trois à partir de quatre colonnes). Les chiffres clés
//   (à partir de trois lignes) ne sont PAS dans la maquette : c'est un ajout de la consigne de ce chantier. Les actions ne
//   viennent que pour le propriétaire (le serveur ne les rend qu'à lui, sur l'accueil) ; jamais sur l'écran de la maison ;
//   en mode « Modifier », rien ne part.
// - La carte ne montre que ce qui y tient en entier (ajuster) : d'abord moins de chiffres, puis la phrase sur une ligne,
//   puis sans les actions, et la phrase en dernier ; jamais un texte ni un bouton coupé à mi-hauteur.
// - Une action passe par ce qui existe (POST /api/valhalla/act, l'action de l'appli) ; une confirmation demandée par le
//   serveur (action grave) est montrée À CHAQUE FOIS avant de renvoyer ; sans accord, rien ne part.
// - Tout texte venu d'une appli (sa phrase, un libellé ou une valeur de chiffre clé, la réponse d'une action) est posé par
//   textContent, isolé dans son sens d'écriture, et coupé à l'écran ; la carte ne s'étire pas (son corps défile).
// Seconde sorte, « raccourcis » (le « launcher » de la maquette) : une tuile par appli épinglée (l'icône de la page Applis
// et le nom, posé par textContent), qui ouvre l'appli au toucher, au clic ou au clavier ; ce qui ne tient pas : « et N de
// plus » ; aucune : une phrase et « Épingler des applis » (la page Applis). Aucune liste d'applis écrite ici.
// Rien n'est touché au chargement : seulement window.OdinWidgetsApplis (ses textes et calculs, pour les essais) et sa déclaration.
(() => {
  'use strict';
  if (window.OdinWidgetsApplis) return;

  // ---------------- Dictionnaire (tous les textes de la famille)
  const TEXTES = {
    titre: 'Appli', quoi: 'Une appli d\'Odin : sa phrase, son état, ses chiffres et ses actions rapides',
    retiree: 'Cette appli n\'est plus dans Odin.',
    pastille: {
      prete: 'Prête', muette: 'Ne répond pas',
      grave: (n, plusieurs) => (plusieurs ? `${n} alertes graves` : `${n} alerte grave`),
      attention: (n) => `${n} à voir`,
    },
    chiffres: 'Chiffres clés', actions: 'Actions rapides', grave: 'Action grave : ton accord est demandé à chaque fois.',
    enCours: 'Un instant…', annule: 'Annulé : rien n\'est parti.', echec: 'Odin ne répond pas.',
    // « Raccourcis d'applis » (la maquette : « launcher ») : ses applis épinglées.
    raccourcis: {
      titre: 'Raccourcis d\'applis', quoi: 'Tes applis épinglées, à portée de doigt : touche pour ouvrir.', sous: 'Touche pour ouvrir',
      aucune: 'Aucune appli épinglée pour l\'instant.', aller: 'Épingler des applis', plus: (n) => `et ${n} de plus`,
    },
  };
  const T = TEXTES;

  // ---------------- Calculs (sans document)
  const entierPositif = (n) => Number.isInteger(n) && n >= 0;
  /**
   * La pastille d'une appli, calculée de la donnée rendue par le serveur : { ton, n } ou rien. Une alerte grave pas
   * encore vue, puis des alertes à voir, puis une appli qui ne répond pas, sinon « Prête ». Des alertes illisibles (ou
   * absentes : le serveur n'a pas pu les lire) : rien, sauf une appli qui ne répond pas (c'est une mesure).
   */
  function pastilleDe(d) {
    if (!d || typeof d !== 'object') return null;
    const a = d.alertes && typeof d.alertes === 'object' ? d.alertes : null;
    const lues = a && entierPositif(a.aVoir) && entierPositif(a.graves) && a.graves <= a.aVoir;
    if (lues && a.graves) return { ton: 'grave', n: a.graves };
    if (lues && a.aVoir) return { ton: 'attention', n: a.aVoir };
    if (d.muette === true) return { ton: 'muette', n: 0 };
    return lues ? { ton: 'prete', n: 0 } : null;
  }
  /** Combien de chiffres clés et d'actions montrer selon la taille de la carte (colonnes sur 12, lignes), comme la maquette. */
  const combienDeChiffres = (c, r) => (r >= 3 ? (c >= 4 ? 3 : 2) : 0);
  const combienDActions = (c, r) => (r >= 3 || c >= 4 ? (c >= 4 ? 3 : 2) : 0);

  // ---------------- Dessin (seulement quand un hôte l'appelle)
  // Les couleurs : celles du thème d'Odin (--good, --warn, --bad, --ink, --muted, --line, --accent). Aucune couleur écrite ici.
  const CSS = `
:has(>.wa-corps){display:flex;flex-direction:column}
.wa-corps{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column;gap:6px;overflow:auto;overscroll-behavior:contain;padding:3px;margin:-3px;color:var(--ink,var(--text,inherit))}
.wa-corps>*{flex:none;min-width:0}
.wa-corps [hidden]{display:none!important}
.wa-corps.wa-serre{gap:4px}
.wa-haut{display:flex;flex-wrap:wrap;gap:6px}
.wa-pill{--wa-c:var(--muted,currentColor);display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:600;line-height:1.3;background:color-mix(in srgb,var(--wa-c) 16%,transparent);color:inherit}
.wa-pill>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wa-pt{flex:none;width:8px;height:8px;border-radius:50%;background:var(--wa-c)}
.wa-pill.wa-prete{--wa-c:var(--good,currentColor)}.wa-pill.wa-grave{--wa-c:var(--bad,currentColor)}.wa-pill.wa-attention,.wa-pill.wa-muette{--wa-c:var(--warn,currentColor)}
.wa-quoi{margin:0;font-size:12.5px;line-height:1.4;color:var(--muted,inherit);overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.wa-quoi.wa-3{-webkit-line-clamp:3}
.wa-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,64px),1fr));gap:6px}
.wa-kpi{min-width:0;display:flex;flex-direction:column;gap:1px;padding:5px 8px;border-radius:10px;background:color-mix(in srgb,var(--ink,currentColor) 5%,transparent)}
.wa-kpi small{font-size:11px;color:var(--muted,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wa-kpi b{font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wa-kpi.wa-bon b{color:var(--good,inherit)}.wa-kpi.wa-attention b{color:var(--warn,inherit)}.wa-kpi.wa-mauvais b{color:var(--bad,inherit)}
.wa-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:auto}
.wa-act{min-height:44px;min-width:44px;max-width:100%;padding:4px 12px;border-radius:12px;border:1px solid var(--line,currentColor);background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:650;line-height:1.25;overflow-wrap:anywhere;cursor:pointer}
.wa-act:focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:2px}
.wa-act[disabled]{opacity:.55;cursor:default}
.wa-act .wa-g{color:var(--warn,inherit)}
.wa-dit{margin:0;font-size:12px;line-height:1.35;color:var(--muted,inherit);overflow-wrap:anywhere}.wa-dit:empty{display:none}
.wa-calme{margin:0;font-size:13.5px;line-height:1.35;color:var(--muted,inherit)}
:has(>.wk-corps){display:flex;flex-direction:column}
.wk-corps{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column;gap:6px;overflow:hidden;padding:3px;margin:-3px;color:var(--ink,var(--text,inherit))}
.wk-corps>*{flex:none;min-width:0}
.wk-corps [hidden]{display:none!important}
.wk-grille{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:6px;align-content:start}
.wk-tuile{min-width:44px;min-height:44px;display:flex;flex-direction:column;align-items:center;gap:4px;padding:2px;border:0;border-radius:14px;background:transparent;color:inherit;font:inherit;font-size:11.5px;font-weight:500;line-height:1.25;text-align:center;cursor:pointer}
.wk-tuile:focus-visible,.wk-aller:focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:2px}
.wk-ic{display:inline-grid;place-items:center;flex:none;width:40px;height:40px;border-radius:9px;font-weight:700;background:color-mix(in srgb,var(--ink,currentColor) 10%,transparent)}
.wk-n{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (prefers-reduced-motion:no-preference){.wk-tuile{transition:transform .15s}.wk-tuile:hover{transform:translateY(-2px)}}
.wk-plus,.wk-dit{margin:0;font-size:12px;line-height:1.35;color:var(--muted,inherit);overflow-wrap:anywhere}
.wk-plus{align-self:center;justify-self:center;min-width:0;max-width:100%;text-align:center}
.wk-dit.wk-1{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wk-tuile{position:relative}
.wk-serre .wk-grille{grid-template-columns:repeat(auto-fill,minmax(44px,1fr))}
.wk-serre .wk-tuile{gap:0;padding:0;justify-content:center}
.wk-serre .wk-n{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.wk-aller{align-self:flex-start;min-height:44px;min-width:44px;max-width:100%;padding:4px 12px;border-radius:12px;border:1px solid var(--line,currentColor);background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:650;line-height:1.25;overflow-wrap:anywhere;cursor:pointer}`;
  function poserStyle() {
    const R = window.OdinWidgetsRendu;
    if (R && typeof R.poserStyle === 'function') R.poserStyle();
    if (document.getElementById('odinWidgetsApplis')) return;
    // Hors téléphone, la carte a la hauteur de ses lignes : son corps ne compte pas dans cette hauteur (il défile), si bien
    // que des chiffres ou des actions n'étirent ni la carte, ni sa voisine. Au téléphone, la hauteur suit le contenu.
    const G = window.OdinGrille, tel = G && G.GRILLE && Number.isInteger(G.GRILLE.telephone) ? G.GRILLE.telephone : 700;
    const s = document.createElement('style'); s.id = 'odinWidgetsApplis'; s.textContent = `${CSS}\n@media (min-width:${tel + 1}px){.fe-w>.wa-corps,.fe-w>.wk-corps{contain:size}}`; document.head.append(s);
  }
  function el(t, cls, texte) { const n = document.createElement(t); if (cls) n.className = cls; if (texte !== undefined) n.textContent = texte; return n; }
  const langue = () => { try { return document.documentElement.lang || undefined; } catch { return undefined; } };
  const nombre = (n) => { try { return new Intl.NumberFormat(langue()).format(n); } catch { return String(n); } };
  const pluriel = (n) => { try { return new Intl.PluralRules(langue()).select(n) !== 'one'; } catch { return n !== 1; } };
  /** La taille du widget (colonnes sur 12, lignes de grille). */
  function tailleDe(w) {
    const G = window.OdinGrille;
    try { if (G && typeof G.taille === 'function') { const t = G.taille(w); return { c: t.c, r: t.r }; } } catch { /* la valeur écrite */ }
    return { c: w && Number.isInteger(w.c) ? w.c : 3, r: w && Number.isInteger(w.r) ? w.r : 2 };
  }
  /** Un appel à ce qui existe sur le serveur (la session de la page) ; rend la réponse lue, ou rien. */
  async function poster(chemin, corps) {
    try {
      const r = await fetch(chemin, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(corps) });
      return await r.json().catch(() => ({ ok: false }));
    } catch { return undefined; }
  }
  /** Lance l'action d'une appli, avec la confirmation que le serveur demande (à chaque fois). Rend le texte à dire. */
  async function lancer(module, action) {
    const corps = { module, action, input: {} };
    let r = await poster('/api/valhalla/act', corps);
    if (r && r.confirm) {
      const D = window.OdinDialog;
      let oui = false;
      try { oui = D && typeof D.confirm === 'function' ? (await D.confirm(String(r.confirm), { danger: true })) === true : false; } catch { oui = false; }
      if (!oui) return T.annule;
      r = await poster('/api/valhalla/act', { ...corps, confirm: true });
    }
    if (!r) return T.echec;
    const t = typeof r.text === 'string' ? r.text : typeof r.error === 'string' ? r.error : '';
    return (t.split('\n')[0] || (r.ok === false ? T.echec : '')).slice(0, 240);
  }
  /** Le sous-titre de l'en-tête : la famille de l'appli (le nom de l'appli est déjà devant). */
  const sous = (e) => (e && (e.etat === 'ok' || e.etat === 'ancien') && e.donnee && typeof e.donnee.famille === 'string' ? e.donnee.famille : '');

  /** Le corps du widget d'une appli, fait de l'état rendu par le serveur et de rien d'autre. */
  function appli(e, o) {
    if (e.etat === 'vide') { if (e.raison !== 'appli_retiree') return null; poserStyle(); const c = el('div', 'wa-corps'); c.append(el('p', 'wa-calme', T.retiree)); return c; }
    const d = e.donnee || {};
    if (typeof d.appli !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(d.appli) || typeof d.phrase !== 'string') return null; // illisible : rien d'affirmé
    poserStyle();
    const { c: col, r } = tailleDe(o && o.w), c = el('div', 'wa-corps');
    const p = pastilleDe(d);
    if (p) {
      const haut = el('div', 'wa-haut'), pill = el('span', `wa-pill wa-${p.ton}`), pt = el('i', 'wa-pt');
      pt.setAttribute('aria-hidden', 'true');
      const texte = p.ton === 'grave' ? T.pastille.grave(nombre(p.n), pluriel(p.n)) : p.ton === 'attention' ? T.pastille.attention(nombre(p.n)) : T.pastille[p.ton];
      pill.append(pt, el('span', '', texte)); haut.append(pill); c.append(haut);
    }
    const q = el('p', `wa-quoi${r >= 3 ? ' wa-3' : ''}`, d.phrase); q.dir = 'auto'; q.title = d.phrase; c.append(q);
    const kpis = (Array.isArray(d.kpis) ? d.kpis : []).filter((k) => k && typeof k === 'object' && typeof k.label === 'string' && typeof k.value === 'string').slice(0, combienDeChiffres(col, r));
    if (kpis.length) {
      const g = el('div', 'wa-kpis'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', T.chiffres);
      for (const k of kpis) {
        const b = el('div', `wa-kpi${['bon', 'attention', 'mauvais'].includes(k.tone) ? ` wa-${k.tone}` : ''}`), l = el('small', '', k.label), v = el('b', '', k.value);
        l.dir = 'auto'; v.dir = 'auto'; b.title = `${k.label} : ${k.value}`; b.append(l, ' ', v); g.append(b);
      }
      c.append(g);
    }
    const actions = o && o.ecran === 'maison' ? [] : (Array.isArray(d.actions) ? d.actions : [])
      .filter((a) => a && typeof a === 'object' && typeof a.id === 'string' && /^[a-z_][a-z0-9_]{0,39}$/i.test(a.id) && typeof a.label === 'string' && a.label).slice(0, combienDActions(col, r));
    if (actions.length) {
      const barre = el('div', 'wa-actions'), dit = el('p', 'wa-dit');
      barre.setAttribute('role', 'group'); barre.setAttribute('aria-label', T.actions); dit.setAttribute('role', 'status');
      const boutons = actions.map((a) => {
        const b = el('button', 'wa-act', a.label); b.type = 'button'; b.dataset.action = a.id; b.dir = 'auto';
        if (a.grave === true) { const g = el('span', 'wa-g', ' ⚠'); g.setAttribute('aria-hidden', 'true'); b.append(g); b.title = T.grave; b.setAttribute('aria-description', T.grave); }
        b.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          if (b.closest('.fe-edit')) return; // en mode « Modifier » : rien ne part
          for (const x of boutons) x.disabled = true;
          dit.textContent = T.enCours;
          try { dit.textContent = await lancer(d.appli, a.id); } finally { for (const x of boutons) x.disabled = false; }
        });
        return b;
      });
      barre.append(...boutons); c.append(barre, dit);
    }
    suivre(c);
    return c;
  }
  /**
   * Ne garder dans le corps que ce qui y tient en entier : d'abord les écarts resserrés, puis les chiffres clés retirés
   * un à un (le dernier d'abord), la phrase sur une ligne, les actions rapides, et la phrase en dernier. La pastille reste.
   * Tout est remis avant chaque mesure : agrandie, la carte retrouve ce qu'elle cachait. Le message d'une action ne
   * déclenche rien (le corps garde sa taille ; il défile au besoin).
   */
  function ajuster(c) {
    if (!c.isConnected) return;
    const kpis = [...c.querySelectorAll('.wa-kpi')], g = c.querySelector('.wa-kpis'), q = c.querySelector('.wa-quoi'), barre = c.querySelector('.wa-actions');
    c.classList.remove('wa-serre');
    for (const n of [...kpis, g, barre, q]) if (n) n.hidden = false;
    if (q) q.style.removeProperty('-webkit-line-clamp');
    if (!c.clientHeight) return;
    const deborde = () => c.scrollHeight > c.clientHeight + 1;
    if (deborde()) c.classList.add('wa-serre');
    for (let i = kpis.length - 1; i >= 0 && deborde(); i--) kpis[i].hidden = true;
    if (g && kpis.length && kpis.every((n) => n.hidden)) g.hidden = true;
    if (q && deborde()) q.style.setProperty('-webkit-line-clamp', '1');
    if (barre && deborde()) barre.hidden = true;
    if (q && deborde()) q.hidden = true;
  }
  /** Rejoue ajuster à chaque changement de taille du corps (posé, agrandi, réduit, page redessinée). */
  function suivre(c) {
    if (typeof ResizeObserver !== 'function') return;
    try { new ResizeObserver(() => ajuster(c)).observe(c); } catch { /* sans observateur : le corps défile */ }
  }

  // ---------------- « Raccourcis d'applis »
  const RT = T.raccourcis;
  /** Un identifiant d'appli que l'adresse d'une appli ouvre (la règle de la page : ui.html, hashView). */
  const ID_OUVRABLE = /^[a-z0-9_-]{2,40}$/;
  /** Le corps « vide » : aucune appli épinglée. Une phrase et, hors de l'écran de la maison, le bouton vers la page Applis. */
  function aucuneEpingle(o) {
    poserStyle();
    const c = el('div', 'wk-corps'), p = el('p', 'wk-dit', RT.aucune); p.title = RT.aucune; c.append(p);
    if (!(o && o.ecran === 'maison')) {
      const b = el('button', 'wk-aller', RT.aller); b.type = 'button';
      b.addEventListener('click', (ev) => { ev.stopPropagation(); if (b.closest('.fe-edit')) return; location.hash = '#apps'; });
      c.append(b);
    }
    suivreRaccourcis(c);
    return c;
  }
  /** La tuile d'une appli : son icône (celle de la page Applis) et son nom (une donnée : textContent). */
  function tuile(a) {
    const b = el('button', 'wk-tuile'); b.type = 'button'; b.dataset.appli = a.appli; b.title = a.nom;
    const ic = el('span', 'wk-ic'); ic.setAttribute('aria-hidden', 'true');
    const I = window.OdinAppIcons;
    let pose = false;
    // L'icône vient de l'outil de la page Applis (app-icons.js : son dessin à lui, le nom n'y sert qu'échappé).
    try { if (I && typeof I.tile === 'function') { ic.innerHTML = I.tile(a.appli, a.nom, 40); pose = Boolean(ic.firstElementChild); } } catch { pose = false; }
    if (!pose) ic.textContent = a.nom.slice(0, 1).toUpperCase();
    const n = el('span', 'wk-n', a.nom); n.dir = 'auto';
    b.append(ic, n);
    b.addEventListener('click', (ev) => { ev.stopPropagation(); if (b.closest('.fe-edit')) return; location.hash = `#app=${a.appli}`; });
    return b;
  }
  /**
   * Le corps des raccourcis, fait de l'état rendu par le serveur et de rien d'autre : une tuile par appli épinglée, puis
   * « et N de plus » (à la place d'une tuile) pour celles qui ne tiennent pas. Aucune appli écrite ici.
   */
  function raccourcis(e, o) {
    if (e.etat === 'vide') return e.raison === 'aucune_epingle' ? aucuneEpingle(o) : null;
    const d = e.donnee || {};
    const applis = (Array.isArray(d.applis) ? d.applis : []).filter((a) => a && typeof a === 'object' && typeof a.appli === 'string' && ID_OUVRABLE.test(a.appli) && typeof a.nom === 'string' && a.nom);
    if (!applis.length) return null; // illisible : rien d'affirmé
    poserStyle();
    const c = el('div', 'wk-corps'), g = el('div', 'wk-grille'), plus = el('p', 'wk-plus');
    plus.hidden = true; plus.setAttribute('role', 'status');
    g.append(...applis.map(tuile), plus); c.append(g);
    c.wkLignes = Math.max(1, tailleDe(o && o.w).r);
    suivreRaccourcis(c);
    return c;
  }
  /** Le téléphone (la hauteur d'une carte y suit son contenu) ? */
  function auTelephone() {
    const G = window.OdinGrille, tel = G && G.GRILLE && Number.isInteger(G.GRILLE.telephone) ? G.GRILLE.telephone : 700;
    try { return window.matchMedia(`(max-width:${tel}px)`).matches; } catch { return false; }
  }
  /**
   * Ne montrer que ce qui tient en entier. Les tuiles : hors téléphone, la carte a la hauteur de ses lignes, et on retire
   * des tuiles (la dernière d'abord) tant que le corps déborde ; au téléphone, autant de rangées de tuiles que la carte a
   * de lignes (trente applis n'allongent pas la carte). Ce qui est retiré est compté : « et N de plus ». L'état vide : la
   * phrase sur une ligne, puis le bouton seul. Tout est remis avant chaque mesure : agrandie, la carte retrouve tout.
   */
  function ajusterRaccourcis(c) {
    if (!c.isConnected || !c.clientWidth) return;
    const deborde = () => c.scrollHeight > c.clientHeight + 1;
    const g = c.querySelector('.wk-grille');
    if (!g) {
      const p = c.querySelector('.wk-dit'); if (!p) return;
      p.hidden = false; p.classList.remove('wk-1');
      if (deborde()) p.classList.add('wk-1');
      if (deborde() && c.querySelector('.wk-aller')) p.hidden = true;
      return;
    }
    const tuiles = [...g.querySelectorAll('.wk-tuile')], plus = g.querySelector('.wk-plus'), n = tuiles.length;
    if (!plus) return;
    let montre = n;
    const montrer = (k) => {
      montre = k;
      tuiles.forEach((t, i) => { t.hidden = i >= k; });
      plus.hidden = k >= n; plus.textContent = k >= n ? '' : RT.plus(nombre(n - k));
    };
    const essayer = () => {
      montrer(n);
      const colonnes = Math.max(1, String(getComputedStyle(g).gridTemplateColumns || '').split(' ').filter(Boolean).length);
      // « et N de plus » prend la place d'une tuile (sur deux lignes au besoin).
      if (auTelephone()) { const cases = colonnes * c.wkLignes; if (n > cases) montrer(Math.max(0, cases - 1)); }
      while (montre > 0 && deborde()) montrer(montre - 1);
    };
    c.classList.remove('wk-serre');
    essayer();
    // Pas même une tuile avec son nom : les tuiles sans le nom écrit dessous (il reste leur nom pour les lecteurs d'écran
    // et en info-bulle), plutôt qu'une carte sans aucune appli.
    if (!montre && n) { c.classList.add('wk-serre'); essayer(); }
  }
  /** Rejoue l'ajustement à chaque changement de taille du corps (posé, agrandi, réduit, page redessinée). */
  function suivreRaccourcis(c) {
    if (typeof ResizeObserver !== 'function') return;
    try { new ResizeObserver(() => ajusterRaccourcis(c)).observe(c); } catch { /* sans observateur : le corps coupe au bord */ }
  }
  const sousRaccourcis = (e) => (e && e.etat === 'ok' ? RT.sous : '');

  window.OdinWidgetsApplis = { TEXTES, CSS, pastilleDe, combienDeChiffres, combienDActions };
  // La déclaration de la famille (lue par pages/widgets-rendu.js, quel que soit l'ordre de chargement). La taille de la
  // maquette : 3 × 2. Pas de ligne à elle dans le tiroir : il en a déjà une par appli du catalogue, qui la pose
  // à cette taille, pour cette appli (fenetre.js) ; son titre est alors le nom de l'appli, et « Appli » seulement quand
  // l'appli est retirée ou fermée à qui regarde.
  (window.OdinWidgetsFamilles = window.OdinWidgetsFamilles || []).push({ famille: 'applis', sortes: [
    { sorte: 'appli', titre: T.titre, quoi: T.quoi, symbole: '▦', tiroir: false, poser: { c: 3, r: 2, pc: 4 }, vides: ['appli_retiree'], sous, dessiner: appli },
    // « Raccourcis d'applis » : au tiroir (pour chacun : ce sont ses épingles), à la taille de départ de la maquette (5 × 2).
    // Rangés dans « Odin » du tiroir, comme la maquette ; jamais sur l'écran de la maison (la même marque que sa sorte, applis.ts).
    { sorte: 'raccourcis', groupe: 'odin', jamaisALaMaison: true, titre: RT.titre, quoi: RT.quoi, symbole: '⊞', poser: { c: 5, r: 2, pc: 4 }, vides: ['aucune_epingle'], sous: sousRaccourcis, dessiner: raccourcis },
  ] });
})();
