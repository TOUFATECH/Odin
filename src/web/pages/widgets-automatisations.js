// La famille « Automatisations » des widgets de l'accueil (maquette validée « Accueil ») : « Automatisations » (ses
// automatisations de Talos, chacune avec son interrupteur, et « Nouvelle automatisation ») et « Tâches planifiées » (ce
// qui part encore aujourd'hui, à son heure), pour le propriétaire seul.
// Ce fichier DÉCLARE ses sortes au registre commun (pages/widgets-rendu.js) ; l'accueil les dessine et les propose sans
// rien savoir d'elles. Chaque dessin est fait de l'état que le serveur a rendu (src/valhalla/widgets/automatisations.ts).
// - L'interrupteur passe par la route de Talos qui existe (POST /api/draupnir/toggle), comme l'interrupteur de la page de
//   Talos : activer demande d'abord la même confirmation (« Elle agira seule ensuite ») ; sans accord, rien ne part ;
//   passer en brouillon part sans question, comme dans Talos. L'état montré ensuite est celui que Talos a rendu ; un échec
//   revient à l'état vrai et dit pourquoi. Le widget ne crée, ne renomme ni ne supprime rien.
// - Redessinée avec un état lu AVANT un geste réussi, la carte garde l'état que Talos a rendu ; le focus revient sur
//   l'interrupteur qui l'avait. « Avant » et « après » se comparent à l'heure du SERVEUR (celle où Talos a enregistré le
//   geste), jamais à l'horloge de l'appareil, qui peut avancer ou retarder.
// - « Nouvelle automatisation » ouvre l'éditeur de Talos (sa réponse du 25/11) : la page de Talos, puis son propre bouton
//   « Partir de zéro », une fois sa liste là ; rien n'est enregistré tant qu'il n'a rien enregistré. « Ouvrir Talos »
//   ouvre Talos ; dans une carte étroite, il n'en montre que l'icône (son nom reste lu et en info-bulle). En mode
//   « Modifier », rien ne part.
// - L'heure d'une tâche est écrite dans le fuseau d'Odin (donné par le serveur), dans la langue de la page, sur 12 ou
//   24 h comme Odin est réglé ; jamais dans le fuseau de l'appareil : sans fuseau lisible, rien.
// - Le nom d'une automatisation est une donnée (il peut venir d'un import) : posé par textContent, isolé dans son sens
//   d'écriture, coupé à l'écran avec son nom entier en info-bulle ; jamais du code, jamais une consigne.
// - La liste tient dans sa carte : autant de lignes que sa hauteur en tient, puis « et N de plus » ; elle défile au besoin,
//   et le bas de la carte (« Nouvelle automatisation ») reste fixe, hors de ce qui défile : jamais coupé. Comme la
//   maquette, « N actives sur M » est dans le sous-titre de l'en-tête, et suit le geste.
// Rien n'est touché au chargement : seulement window.OdinWidgetsAutomatisations (ses textes et calculs, pour les essais) et
// sa déclaration.
(() => {
  'use strict';
  if (window.OdinWidgetsAutomatisations) return;

  // ---------------- Dictionnaire (tous les textes de la famille)
  const TEXTES = {
    autos: {
      titre: 'Automatisations', quoi: 'Talos : tes automatisations, avec leur interrupteur',
      aucune: 'Aucune automatisation pour l\'instant.', nouvelle: 'Nouvelle automatisation', ouvrir: 'Ouvrir Talos',
      plus: (n) => `et ${n} de plus`, actives: (a, t) => `${a} active${a === '1' || a === '0' ? '' : 's'} sur ${t}`,
      // La phrase de la page de Talos (pages/talos-dossiers.js), mot pour mot.
      activer: (nom) => `Activer « ${nom} » ? Elle agira seule ensuite.`,
      enCours: 'Un instant…', annule: 'Annulé : rien n\'a changé.', echec: 'Talos ne répond pas : rien n\'a changé.',
      allumee: (nom) => `« ${nom} » activée.`, eteinte: (nom) => `« ${nom} » passée en brouillon.`,
    },
    taches: {
      titre: 'Tâches planifiées', quoi: 'Talos : ce qu\'Odin fera tout seul aujourd\'hui, et quand',
      rien: 'Rien de prévu pour le reste de la journée.', ouvrir: 'Ouvrir Talos', plus: (n) => `et ${n} de plus`,
      aujourdhui: (n) => `${n} aujourd'hui`,
    },
  };
  const T = TEXTES;

  // ---------------- Calculs (sans document)
  /** Un identifiant que la route de Talos accepte (src/draupnir/dossiers.ts, RE_ID). */
  const ID_FLOW = /^[\w-]{1,64}$/;
  /** Combien de lignes montrer selon la hauteur du widget (en lignes de la grille), comme la maquette. */
  const combienAutos = (r) => Math.max(1, (Number.isInteger(r) ? r : 3) - 1);
  const combienTaches = (r) => Math.max(1, Number.isInteger(r) ? r : 3);
  /**
   * L'heure d'un instant dans le fuseau d'Odin et la langue donnée. `r` : { fuseau, heure12 } (rendus par le serveur).
   * Sans fuseau, ou avec un fuseau que le navigateur ne connaît pas : '' (jamais le fuseau de l'appareil).
   */
  function heure(at, r, langue) {
    const fuseau = r && typeof r.fuseau === 'string' ? r.fuseau : '';
    if (!fuseau || !Number.isFinite(at)) return '';
    try {
      const h12 = r.heure12 === true;
      return new Intl.DateTimeFormat(langue, { timeZone: fuseau, hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', ...(h12 ? { hour12: true } : { hourCycle: 'h23' }) }).format(new Date(at));
    } catch { return ''; }
  }
  /** Une automatisation lue sans confiance : un nom ; son identifiant seulement s'il a la forme que Talos accepte. */
  function autoLue(x) {
    if (!x || typeof x !== 'object' || typeof x.nom !== 'string') return null;
    const t = (v) => (typeof v === 'string' ? v : '');
    return { id: typeof x.id === 'string' && ID_FLOW.test(x.id) ? x.id : '', nom: x.nom, quand: t(x.quand), quoi: t(x.quoi), actif: x.actif === true };
  }
  /** Une tâche du jour lue sans confiance : un nom et un instant. */
  function tacheLue(x) {
    if (!x || typeof x !== 'object' || typeof x.nom !== 'string' || !Number.isFinite(x.at)) return null;
    return { nom: x.nom, at: x.at };
  }
  /**
   * Les états que Talos a rendus après un geste réussi ici : identifiant → { actif, t }. `t` est une heure du SERVEUR :
   * celle où Talos a enregistré le geste (`updatedAt` de sa réponse), sinon l'heure de la lecture d'où la carte a été
   * dessinée. Une carte redessinée avec un état lu avant `t` garde l'état rendu par Talos ; un état lu après reprend la main.
   */
  const confirmes = new Map();
  /** L'heure du serveur à retenir pour un geste : celle de Talos, sinon celle de la lecture dessinée ; rien de l'appareil. */
  const heureGeste = (flow, lu) => { const t = flow && typeof flow.updatedAt === 'string' ? Date.parse(flow.updatedAt) : NaN; return Number.isFinite(t) ? t : Number.isFinite(lu) ? lu : NaN; };
  const etatVrai = (id, actif, lu) => { const c = id ? confirmes.get(id) : undefined; return c && !(Number.isFinite(lu) && Number.isFinite(c.t) && lu > c.t) ? c.actif : actif; };
  /**
   * « N actives sur M » d'une donnée servie : le compte du serveur, corrigé des gestes confirmés ici sur les lignes servies.
   * '' quand le serveur n'a pas donné de compte lisible.
   */
  function compteActives(d, lu) {
    const servies = (Array.isArray(d && d.liste) ? d.liste : []).map(autoLue).filter(Boolean);
    const total = Number.isInteger(d && d.total) && d.total >= servies.length ? d.total : servies.length;
    const a0 = Number.isInteger(d && d.actives) && d.actives >= 0 && d.actives <= total ? d.actives : null;
    if (a0 === null || !total) return '';
    const ecart = servies.reduce((n, x) => { const v = etatVrai(x.id, x.actif, lu); return n + (v === x.actif ? 0 : v ? 1 : -1); }, 0);
    return T.autos.actives(nombre(Math.min(total, Math.max(0, a0 + ecart))), nombre(total));
  }

  // ---------------- Dessin (seulement quand un hôte l'appelle)
  const ICONES = {
    eclair: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
    calme: '<circle cx="12" cy="12" r="8.5"/><path d="m8 12.5 3 3 5-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    sortie: '<path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4"/>',
  };
  const icone = (k) => (Object.prototype.hasOwnProperty.call(ICONES, k) ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[k]}</svg>` : '');
  // Les couleurs : celles du thème d'Odin (--ink, --muted, --line, --accent, --panel). Aucune couleur écrite ici.
  const CSS = `
:has(>.wt-corps){display:flex;flex-direction:column}
.wt-corps{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column;gap:6px;color:var(--ink,var(--text,inherit))}
/* Seule la liste défile ; le bas de la carte reste fixe, jamais coupé par son bord. */
.wt-defile{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column;gap:6px;overflow:auto;overscroll-behavior:contain;padding:3px;margin:-3px}
.wt-defile>*{flex:none;min-width:0}
.wt-liste{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px;min-width:0}
.wt-auto,.wt-tache{display:flex;align-items:center;gap:10px;min-width:0;min-height:44px}
.wt-tache{min-height:32px;padding:2px 0;border-bottom:1px solid var(--line,transparent)}.wt-tache:last-child{border-bottom:0}
.wt-ic{flex:none;width:30px;height:30px;border-radius:10px;display:grid;place-items:center;background:color-mix(in srgb,var(--muted,currentColor) 14%,transparent);color:var(--muted,currentColor)}.wt-ic svg{width:17px;height:17px}
.wt-auto.wt-on .wt-ic{background:color-mix(in srgb,var(--accent,currentColor) 16%,transparent);color:var(--accent,currentColor)}
.wt-x{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:1px;line-height:1.3}
.wt-n{display:block;font-size:13px;font-weight:600;color:var(--ink,inherit);unicode-bidi:isolate;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wt-q{display:block;font-size:11.5px;color:var(--muted,inherit);unicode-bidi:isolate;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wt-h{flex:none;min-width:46px;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--ink,inherit)}
.wt-tache .wt-n{flex:1 1 auto;min-width:0;font-weight:500}
/* L'interrupteur : une cible de 44 px ; son état se lit aussi sans la couleur (le rond change de côté). */
.wt-sw{flex:none;width:52px;height:44px;margin:0;padding:0;border:0;border-radius:12px;background:none;color:inherit;display:grid;place-items:center;cursor:pointer}
.wt-sw>i{position:relative;width:38px;height:22px;border-radius:999px;background:color-mix(in srgb,var(--ink,currentColor) 24%,transparent);transition:background-color .15s}
.wt-sw>i::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--panel,Canvas);transition:transform .15s}
.wt-sw[aria-checked="true"]>i{background:var(--accent,currentColor)}.wt-sw[aria-checked="true"]>i::after{transform:translateX(16px)}
.wt-sw[aria-busy="true"]{opacity:.6;cursor:progress}
.wt-sw:focus-visible,.wt-btn:focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:2px}
.wt-bas{flex:none;display:flex;flex-wrap:nowrap;gap:6px;min-width:0}
.wt-bas>.wt-btn{flex:0 1 auto;min-width:44px}
.wt-btn .wt-bi{display:none}
/* Carte étroite : « Ouvrir Talos » ne montre que son icône (son nom reste lu, et en info-bulle) ; le bas tient sur une ligne. */
@container (max-width:340px){.wt-bas>.wt-o{flex:none;width:44px;padding:0;justify-content:center}.wt-bas>.wt-o .wt-bi{display:block}.wt-bas>.wt-o>.wt-bt{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}}
.wt-btn{flex:none;max-width:100%;min-height:44px;min-width:44px;padding:4px 14px;border-radius:12px;border:1px solid var(--line,currentColor);background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:650;line-height:1.25;overflow-wrap:anywhere;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.wt-btn svg{flex:none;width:15px;height:15px}
.wt-btn.wt-p{border-color:var(--accent,currentColor);background:var(--accent,transparent);color:var(--on-accent,var(--panel,inherit))}
.wt-plus,.wt-dit{margin:0;font-size:11.5px;line-height:1.35;color:var(--muted,inherit);overflow-wrap:anywhere}.wt-plus:empty,.wt-dit:empty{display:none}
.wt-calme{display:flex;align-items:center;gap:8px 12px;margin:0;font-size:13.5px;line-height:1.35}
.wt-calme>:first-child{flex:none;display:flex}.wt-calme svg{width:22px;height:22px;color:var(--muted,currentColor)}.wt-ct{flex:1 1 auto;min-width:0}
@media (prefers-reduced-motion:reduce){.wt-sw>i,.wt-sw>i::after{transition:none}}`;
  function poserStyle() {
    const R = window.OdinWidgetsRendu;
    if (R && typeof R.poserStyle === 'function') R.poserStyle();
    if (document.getElementById('odinWidgetsAutomatisations')) return;
    // Hors téléphone, la carte a la hauteur de ses lignes : son corps ne compte pas dans cette hauteur (il défile), si
    // bien qu'une longue liste n'étire ni la carte, ni sa voisine. Au téléphone, la hauteur suit le contenu.
    const G = window.OdinGrille, tel = G && G.GRILLE && Number.isInteger(G.GRILLE.telephone) ? G.GRILLE.telephone : 700;
    const s = document.createElement('style'); s.id = 'odinWidgetsAutomatisations'; s.textContent = `${CSS}\n@media (min-width:${tel + 1}px){.fe-w>.wt-corps{contain:size}}`; document.head.append(s);
  }
  function el(t, cls, texte) { const n = document.createElement(t); if (cls) n.className = cls; if (texte !== undefined) n.textContent = texte; return n; }
  /** Un texte venu de dehors : du texte, isolé dans son sens d'écriture, en entier dans l'info-bulle. */
  function dehors(t, cls, texte) { const n = el(t, cls, texte); n.dir = 'auto'; n.title = texte; return n; }
  const langue = () => { try { return document.documentElement.lang || undefined; } catch { return undefined; } };
  const nombre = (n) => { try { return new Intl.NumberFormat(langue()).format(n); } catch { return String(n); } };
  const decor = (k, cls) => { const s = el('span', cls); s.setAttribute('aria-hidden', 'true'); s.innerHTML = icone(k); return s; };
  /** La hauteur du widget, en lignes de la grille. */
  function lignesDe(w, defaut) {
    const G = window.OdinGrille;
    try { if (G && typeof G.taille === 'function') return G.taille(w).r; } catch { /* la valeur écrite */ }
    return w && Number.isInteger(w.r) ? w.r : defaut;
  }
  /** Un appel à la route de Talos (la session de la page) ; rend la réponse lue, ou rien (Talos injoignable). */
  async function poster(chemin, corps) {
    try {
      const r = await fetch(chemin, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(corps) });
      return await r.json().catch(() => ({ ok: false }));
    } catch { return undefined; }
  }
  /** Ouvre Talos. `o.fenetre` : la fenêtre d'Odin où l'ouvrir (l'écran de la maison dans Odin : celle du dessus) ; sinon celle-ci. */
  function ouvrirTalos(o) { const fen = (o && o.fenetre) || window; if (typeof fen.OdinShow === 'function') fen.OdinShow('flows'); else fen.location.hash = '#flows'; }
  /**
   * Ouvre Talos, puis son éditeur, par son propre bouton « Partir de zéro » (le dernier bouton de sa barre), seulement sur
   * une liste dessinée APRÈS l'appel (jamais sur une liste d'avant qui va être remplacée). Talos déjà sur une
   * automatisation ouverte : elle reste telle quelle, rien n'est perdu. `o.fenetre` : la fenêtre d'Odin où l'ouvrir, quand
   * ce n'est pas celle-ci (l'écran de la maison affiché dans Odin : celle du dessus) — voir editeurAilleurs.
   */
  const BOUTON_ZERO = '#v-flows form.dr-top > button[type="button"]:last-of-type';
  function ouvrirEditeur(o) {
    if (o && o.fenetre && o.fenetre !== window) { editeurAilleurs(o.fenetre); return; }
    const avant = document.querySelector(BOUTON_ZERO);
    if (typeof window.OdinShow === 'function') window.OdinShow('flows'); else location.hash = '#flows';
    const debut = Date.now();
    const essayer = () => {
      const b = document.querySelector(BOUTON_ZERO);
      if (b && b !== avant) { b.click(); return; }
      if (Date.now() - debut < 10_000) setTimeout(essayer, 100);
    };
    essayer();
  }
  /**
   * L'éditeur de Talos ouvert depuis un cadre qu'Odin retire dès qu'il montre Talos (l'écran de la maison dans sa vue
   * « Home Assistant ») : plus rien ne tourne ici ensuite. La liste de Talos est donc dessinée d'abord (sa propre
   * fonction), son propre « Partir de zéro » appuyé, puis Talos montré. Une automatisation déjà ouverte dans Talos reste
   * telle quelle (Talos est seulement montré) ; rien n'est enregistré tant qu'il n'a rien enregistré.
   */
  async function editeurAilleurs(fen) {
    try {
      const F = fen.OdinFlows;
      if (!fen.document.querySelector('#drCanvas') && F && typeof F.liste === 'function') { await F.liste(); fen.document.querySelector(BOUTON_ZERO)?.click(); }
    } catch { /* Talos tel qu'il est */ }
    ouvrirTalos({ fenetre: fen });
  }
  function bouton(texte, principal, faire) {
    const b = el('button', `wt-btn${principal ? ' wt-p' : ' wt-o'}`); b.type = 'button';
    if (principal) b.append(decor('plus')); else { b.title = texte; b.append(decor('sortie', 'wt-bi')); }
    b.append(el('span', 'wt-bt', texte));
    b.addEventListener('click', (ev) => { ev.stopPropagation(); if (b.closest('.fe-edit')) return; faire(); });
    return b;
  }
  /** Le corps d'une carte : ce qui défile, puis le bas fixe (s'il a un bouton). */
  function corps(contenu, boutons) {
    const c = el('div', 'wt-corps'), f = el('div', 'wt-defile');
    f.append(...contenu); c.append(f);
    if (boutons.length) { const bas = el('div', 'wt-bas'); bas.append(...boutons); c.append(bas); }
    return c;
  }
  /** Un état calme : son icône, sa phrase, au plus un bouton. */
  function calme(texte, b) {
    poserStyle();
    const l = el('p', 'wt-calme');
    l.append(decor('calme'), el('span', 'wt-ct', texte));
    return corps([l], b ? [b] : []);
  }

  /** Le focus d'un interrupteur, gardé quand la carte est redessinée (« widget/automatisation »). */
  let focusVoulu = '';
  /** L'interrupteur d'une automatisation : la route de Talos, avec sa confirmation pour activer. */
  function interrupteur(x, cle, dit, recompter, lu, confirmer) {
    const b = el('button', 'wt-sw'), piste = el('i');
    piste.setAttribute('aria-hidden', 'true');
    b.type = 'button'; b.dataset.id = x.id; b.setAttribute('role', 'switch'); b.setAttribute('aria-label', x.nom); b.title = x.nom; b.append(piste);
    const poser = (on) => { b.setAttribute('aria-checked', String(on)); b.closest('.wt-auto')?.classList.toggle('wt-on', on); };
    b.setAttribute('aria-checked', String(x.actif));
    b.addEventListener('focus', () => { focusVoulu = cle; });
    b.addEventListener('blur', () => { setTimeout(() => { if (b.isConnected && focusVoulu === cle && document.activeElement !== b) focusVoulu = ''; }, 0); });
    let occupe = false;
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (occupe || b.closest('.fe-edit')) return; // en mode « Modifier » : rien ne part
      const avant = b.getAttribute('aria-checked') === 'true', on = !avant, court = x.nom.slice(0, 120);
      occupe = true;
      try {
        if (on) {
          // Comme la page de Talos : activer demande ton accord, à chaque fois ; sans réponse lisible, rien ne part.
          // (`confirmer` : la boîte de confirmation de la page hôte, quand elle n'a pas celle d'Odin : l'écran de la maison)
          const D = window.OdinDialog, demander = typeof confirmer === 'function' ? confirmer : D && typeof D.confirm === 'function' ? (t) => D.confirm(t) : null;
          let oui = false;
          try { oui = demander ? (await demander(T.autos.activer(court))) === true : false; } catch { oui = false; }
          if (!oui) { dit.textContent = T.autos.annule; if (b.isConnected) b.focus({ preventScroll: true }); return; }
        }
        b.setAttribute('aria-busy', 'true'); dit.textContent = T.autos.enCours;
        const r = await poster('/api/draupnir/toggle', { id: x.id, on });
        const vrai = r && r.ok === true && r.flow && typeof r.flow === 'object' && typeof r.flow.active === 'boolean' ? r.flow.active : undefined;
        if (vrai === undefined) {
          poser(avant);
          dit.textContent = (r && typeof r.error === 'string' && r.error ? r.error : T.autos.echec).slice(0, 240);
        } else {
          poser(vrai); confirmes.set(x.id, { actif: vrai, t: heureGeste(r.flow, lu) }); x.actif = vrai; recompter();
          dit.textContent = vrai ? T.autos.allumee(court) : T.autos.eteinte(court);
        }
      } finally { occupe = false; b.removeAttribute('aria-busy'); }
    });
    if (focusVoulu === cle) setTimeout(() => { const a = document.activeElement; if (b.isConnected && (!a || a === document.body)) b.focus({ preventScroll: true }); }, 0);
    return b;
  }

  /**
   * « Automatisations » : ses automatisations, chacune avec son interrupteur ; aucune (« vide ») : « Nouvelle automatisation ».
   * Une page entière qui le réutilise (l'écran de la maison) passe `o.tout` (toutes les lignes, pas la hauteur d'une
   * carte), `o.confirmer` (sa boîte de confirmation), `o.nouvelle` et `o.ouvrir` (ouvrir l'éditeur, ouvrir Talos).
   */
  function automatisations(e, o) {
    const maison = o && o.ecran === 'maison';
    const nouvelle = o && typeof o.nouvelle === 'function' ? o.nouvelle : ouvrirEditeur, ouvrir = o && typeof o.ouvrir === 'function' ? o.ouvrir : ouvrirTalos;
    if (e.etat === 'vide') {
      if (e.raison !== 'aucune_automatisation') return null;
      return calme(T.autos.aucune, maison ? null : bouton(T.autos.nouvelle, true, nouvelle));
    }
    const d = e.donnee || {};
    const lues = (Array.isArray(d.liste) ? d.liste : []).map(autoLue).filter(Boolean);
    if (!lues.length) return null; // illisible : rien d'affirmé
    poserStyle();
    for (const x of lues) x.actif = etatVrai(x.id, x.actif, e.at);
    const total = Number.isInteger(d.total) && d.total >= lues.length ? d.total : lues.length;
    const montres = o && o.tout === true ? lues : lues.slice(0, combienAutos(lignesDe(o && o.w, 3)));
    const ul = el('ul', 'wt-liste'), dit = el('p', 'wt-dit'), plus = el('p', 'wt-plus');
    dit.setAttribute('role', 'status');
    if (total > montres.length) plus.textContent = T.autos.plus(nombre(total - montres.length));
    // « N actives sur M » est dans le sous-titre de l'en-tête (posé par l'hôte d'après `sous`) ; un geste fait ici le
    // remet à jour à sa fin, seulement s'il y est encore tel qu'on l'a écrit.
    let compte = compteActives(d, e.at);
    const recompter = () => {
      const neuf = compteActives(d, e.at), s = c.parentElement && c.parentElement.querySelector('.wr-s');
      if (s && compte && neuf && s.textContent.endsWith(compte)) { s.textContent = s.textContent.slice(0, -compte.length) + neuf; compte = neuf; }
    };
    const wid = o && o.w && typeof o.w.id === 'string' ? o.w.id : '';
    for (const x of montres) {
      const li = el('li', `wt-auto${x.actif ? ' wt-on' : ''}`), t = el('div', 'wt-x');
      t.append(dehors('b', 'wt-n', x.nom));
      const q = [x.quand, x.quoi].filter(Boolean).join(' → ');
      if (q) t.append(dehors('small', 'wt-q', q));
      li.append(decor('eclair', 'wt-ic'), t);
      if (x.id && !maison) li.append(interrupteur(x, `${wid}/${x.id}`, dit, recompter, e.at, o && o.confirmer));
      ul.append(li);
    }
    const c = corps([ul, plus, dit], maison ? [] : [bouton(T.autos.nouvelle, true, nouvelle), bouton(T.autos.ouvrir, false, ouvrir)]);
    return c;
  }
  /** La fin du sous-titre de « Automatisations » : « N actives sur M » (comme la maquette). */
  function sousAutos(e) {
    const d = e && e.etat === 'ok' && e.donnee ? e.donnee : null;
    return d ? compteActives(d, e.at) : '';
  }

  /** « Tâches planifiées » : ce qui part encore aujourd'hui, à son heure dans le fuseau d'Odin ; rien : « Ouvrir Talos ». */
  function taches(e, o) {
    const maison = o && o.ecran === 'maison';
    if (e.etat === 'vide') {
      if (e.raison !== 'rien_aujourdhui') return null;
      return calme(T.taches.rien, maison ? null : bouton(T.taches.ouvrir, false, ouvrirTalos));
    }
    const d = e.donnee || {}, reglage = { fuseau: d.fuseau, heure12: d.heure12 === true }, lg = langue();
    const liste = (Array.isArray(d.liste) ? d.liste : []).map(tacheLue).filter(Boolean).map((x) => ({ x, h: heure(x.at, reglage, lg) })).filter((y) => y.h);
    if (!liste.length) return null; // illisible, ou sans fuseau lisible : rien d'affirmé
    poserStyle();
    const total = Number.isInteger(d.total) && d.total >= liste.length ? d.total : liste.length, montres = liste.slice(0, combienTaches(lignesDe(o && o.w, 3)));
    const ul = el('ul', 'wt-liste');
    for (const { x, h } of montres) {
      const li = el('li', 'wt-tache'), quand = el('time', 'wt-h', h);
      try { quand.dateTime = new Date(x.at).toISOString(); } catch { /* sans attribut */ }
      li.append(quand, dehors('span', 'wt-n', x.nom)); ul.append(li);
    }
    return corps(total > montres.length ? [ul, el('p', 'wt-plus', T.taches.plus(nombre(total - montres.length)))] : [ul], []);
  }
  /** La fin du sous-titre de « Tâches planifiées » : combien partent encore aujourd'hui. */
  function sousTaches(e) {
    const d = e && e.etat === 'ok' && e.donnee ? e.donnee : null;
    return d && Number.isInteger(d.total) && d.total > 0 ? T.taches.aujourdhui(nombre(d.total)) : '';
  }

  // (dessinerAutos, ouvrirEditeur, ouvrirTalos : réutilisés par la page « Automatisations » de l'écran de la maison, maison.js)
  window.OdinWidgetsAutomatisations = { TEXTES, CSS, combienAutos, combienTaches, heure, autoLue, tacheLue, etatVrai, compteActives, dessinerAutos: automatisations, ouvrirEditeur, ouvrirTalos };
  // La déclaration de la famille (lue par pages/widgets-rendu.js, quel que soit l'ordre de chargement). Les tailles sont
  // celles de la maquette : 6 × 3 et 4 × 3. Au propriétaire seul (le serveur refuse tout autre que lui).
  (window.OdinWidgetsFamilles = window.OdinWidgetsFamilles || []).push({ famille: 'automatisations', sortes: [
    // Rangées dans « Odin » du tiroir, comme la maquette.
    { sorte: 'automatisations', groupe: 'odin', titre: T.autos.titre, quoi: T.autos.quoi, symbole: '⚡', appli: 'draupnir', proprio: true, poser: { c: 6, r: 3, pc: 4 }, vides: ['aucune_automatisation'], sous: sousAutos, dessiner: automatisations },
    { sorte: 'taches_planifiees', titre: T.taches.titre, quoi: T.taches.quoi, symbole: '⏱', appli: 'draupnir', proprio: true, poser: { c: 4, r: 3, pc: 4 }, vides: ['rien_aujourdhui'], sous: sousTaches, dessiner: taches },
  ] });
})();
