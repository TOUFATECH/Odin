// Le dessin commun d'un widget et ses cinq états (maquette validée « Accueil », lot 25a ; croquis des cinq états validé
// le 25/11). Chargé par l'accueil d'Odin (fenetre.js) et par l'écran de la maison (maison.js, /maison et dans Odin).
//
// L'en-tête de la maquette : la tuile de l'appli, le titre, le sous-titre, le bouton « ⋯ » (pour le propriétaire
// seul ; le petit chiffre n'en a pas). Puis l'un des cinq états que le serveur rend (src/valhalla/widgets/sorte.ts) :
//   - prêt (ok) : la donnée, telle quelle ;
//   - vide : une ligne, et au plus un bouton qui y remédie (« Choisir le lieu ») ;
//   - source absente : « Midgard ne répond pas. » + « Réessayer », ou « est désactivée. » + « Activer » ;
//   - refusé : le titre gardé (il vient de la fenêtre, jamais d'une lecture de l'appli), la tuile grisée, puis
//     « Fermé · réservé au propriétaire. » ou « Vie privée : à ouvrir par le propriétaire. » ; jamais la donnée ;
//   - ancien : la donnée NORMALE, avec une pastille ambre « il y a 12 min » dans l'en-tête (sa réponse 1 b).
// Une ligne au plus, un bouton au plus, et le bouton pour le propriétaire seul. Jamais un chiffre inventé.
//
// TOUS les textes des cinq états sont ici, à un seul endroit (TEXTES). Un code serveur inconnu prend le texte commun
// de son état, sans bouton.
// Ce fichier ne touche à rien à son chargement : il pose seulement window.OdinWidgetsRendu. Son style n'est posé que
// lorsque l'hôte (la fenêtre, l'écran de la maison) dessine un premier widget avec lui.
(() => {
  'use strict';
  if (window.OdinWidgetsRendu) return;

  // ---------------- Les textes des cinq états (le seul endroit)
  // Pour chaque état, chaque code du serveur : [texte, bouton] (bouton vide : aucun). Le texte peut dépendre du nom de
  // l'appli (une fonction). « * » : le texte commun de l'état, pour un code qu'on ne connaît pas encore.
  const TEXTES = {
    etats: { ok: 'Prêt', vide: 'Vide', source_absente: 'Source absente', refuse: 'Refusé', ancien: 'Ancien' },
    raisons: {
      vide: {
        lieu_non_choisi: ['Rien à montrer : choisis ton lieu.', 'Choisir le lieu'],
        site_non_choisi: ['Rien à montrer : choisis le site.', 'Choisir le site'],
        action_non_choisie: ['Rien à montrer : choisis l\'action.', 'Choisir'],
        partie_non_choisie: ['Rien à montrer : choisis quoi afficher.', 'Choisir'],
        partie_introuvable: ['Cette partie n\'existe plus.', 'Choisir'],
        site_introuvable: ['Cette partie n\'existe plus.', 'Choisir'],
        // Une liste vide (sa réponse 3 a) : le texte propre à ce qu'elle montre, donné par l'hôte ; sinon celui-ci.
        partie_vide: [(o) => (o.titre ? `Rien dans « ${o.titre} » pour l'instant.` : 'Rien pour l\'instant.'), ''],
        rien_mesure: ['Rien de mesuré pour l\'instant.', ''],
        meteo_pas_lue: ['Pas encore lue, Odin réessaie.', ''],
        '*': ['Rien à montrer : choisis quoi afficher.', ''],
      },
      source_absente: {
        appli_absente: [(o) => `${o.appli} est désactivée.`, 'Activer'],
        appli_muette: [(o) => `${o.appli} ne répond pas.`, 'Réessayer'],
        lecture_echouee: [(o) => `${o.appli} ne répond pas.`, 'Réessayer'],
        action_absente: ['Cette action n\'existe plus.', 'Choisir'],
        pas_encore_lu: ['Odin ne sait pas encore lire cela.', ''],
        '*': ['Odin ne sait pas encore lire cela.', ''],
      },
      // Sa réponse 2 b : le titre et la tuile grisée restent, puis une seule de ces deux lignes. Jamais de bouton.
      refuse: {
        vie_privee: ['Vie privée : à ouvrir par le propriétaire.', ''],
        '*': ['Fermé · réservé au propriétaire.', ''],
      },
    },
    // Le nom d'une appli qu'on ne connaît pas (jamais lu chez l'appli).
    cetteAppli: 'Cette appli',
    // La pastille de l'état ancien : depuis quand la donnée a été lue (sa réponse 1 b).
    depuis: { instant: 'il y a moins d\'1 min', min: (n) => `il y a ${n} min`, h: (n) => `il y a ${n} h`, j: (n) => `il y a ${n} j`, inconnu: 'lecture ancienne' },
    depuisNom: (t) => `Donnée ancienne, lue ${t}`,
    // Dit avant la pastille à qui ne la voit pas (lecteur d'écran) : « Donnée ancienne, lue il y a 12 min ».
    depuisAvant: 'Donnée ancienne, lue ',
    regler: (t) => `Régler « ${t} »`,
  };
  // Les boutons doux (contour) : réessayer ne change rien, il relit.
  const DOUX = new Set(['appli_muette', 'lecture_echouee']);
  // L'icône de la ligne, par état.
  const ICONE_ETAT = { vide: 'vide', source_absente: 'debranche', refuse: 'cadenas', ancien: 'horloge' };

  // ---------------- Logique pure (sans document)
  /** Une valeur porte-t-elle une vraie mesure (un chiffre autre que 0) ? « 0 », « — », « arrêtée » : non (comme le serveur). */
  const porteUneMesure = (v) => /[1-9]/.test(String(v ?? ''));
  /** « il y a 12 min » : depuis `at` (ms), à `maintenant`. Rien d'inventé : sans heure lisible, « lecture ancienne ». */
  function depuis(at, maintenant = Date.now()) {
    const d = Number(maintenant) - Number(at), T = TEXTES.depuis;
    if (!Number.isFinite(d) || !Number.isFinite(Number(at)) || Number(at) <= 0 || d < 0) return T.inconnu;
    const min = Math.floor(d / 60_000);
    if (min < 1) return T.instant;
    if (min < 60) return T.min(min);
    const h = Math.floor(min / 60);
    return h < 24 ? T.h(h) : T.j(Math.floor(h / 24));
  }
  const ETATS = ['ok', 'vide', 'source_absente', 'refuse', 'ancien'];
  /**
   * Les applis de la vie privée (sa question 15, réponse b) : la même liste que le serveur (APPLIS_VIE_PRIVEE,
   * src/valhalla/widgets/index.ts ; un essai compare les deux). Un widget qui en lit une reste fermé à tout autre que
   * le propriétaire, tant qu'il ne l'a pas ouvert pour cette personne, un par un.
   */
  const VIE_PRIVEE = ['gna', 'himinbjorg', 'frigg', 'freyja', 'aegir', 'leikvangr', 'volva', 'pegase', 'vidarr', 'ran', 'atalante', 'bragi', 'rodd',
    'askr', 'svalinn', 'hermod', 'heidrun', 'sol', 'snotra', 'skidbladnir', 'champollion', 'hel', 'urdr', 'brisingamen', 'var', 'agora', 'hlin',
    'forseti', 'argos', 'mimisbrunnr', 'gjoll'];
  /**
   * L'état d'un widget pour qui n'est PAS le propriétaire, quand le serveur ne l'a pas rendu (un membre sur l'accueil) :
   * décidé avant toute lecture, comme le serveur (droitDeVoir). `applis` : les applis que lit le widget ; `aDroit(id)` :
   * cette personne a-t-elle le droit sur l'appli ? Rend l'état « refusé » (l'appli n'est pas à elle, puis la vie privée,
   * que rien n'ouvre encore), ou rien si le widget peut être lu. Sans moyen de vérifier un droit : fermé.
   */
  function etatSansProprio(applis, aDroit) {
    const l = (Array.isArray(applis) ? applis : []).filter((a) => typeof a === 'string' && a);
    if (l.some((a) => typeof aDroit !== 'function' || aDroit(a) !== true)) return { etat: 'refuse', raison: 'appli_fermee' };
    if (l.some((a) => VIE_PRIVEE.includes(a))) return { etat: 'refuse', raison: 'vie_privee' };
    return undefined;
  }
  /**
   * Ce qu'un état veut dire à l'écran. `e` : l'état rendu par le serveur ({ etat, raison, at… }). `o` :
   * - `appli` : le nom de l'appli (sinon « Cette appli ») ; `titre` : le titre du widget (pour une liste vide) ;
   * - `vide` : le texte propre à une liste vide (celui de l'appli), s'il y en a un ;
   * - `proprio` : vrai pour le propriétaire seul (lui seul a un bouton) ;
   * - `peutAgir(raison)` : l'hôte sait-il faire ce que dit le bouton ? Sinon, pas de bouton (jamais un bouton mort) ;
   * - `maintenant` : l'heure, pour la pastille.
   * Rend { etat, donnee (montrer la donnée ?), texte, bouton: { texte, doux, raison } | null, icone, gris, pastille, reglage }.
   * Un état inconnu, ou absent : refusé (prudent).
   */
  function decrire(e, o = {}) {
    const etat = e && ETATS.includes(e.etat) ? e.etat : 'refuse';
    const raison = e && typeof e.raison === 'string' ? e.raison : '';
    const base = { etat, raison, donnee: false, texte: '', bouton: null, icone: ICONE_ETAT[etat] ?? '', gris: false, pastille: '', reglage: Boolean(o.proprio) };
    if (etat === 'ok') return { ...base, donnee: true };
    if (etat === 'ancien') return { ...base, donnee: true, pastille: depuis(e.at, o.maintenant ?? Date.now()) };
    // Un code qu'on ne connaît pas encore : le texte commun de l'état, sans bouton (rien ne dit comment y remédier).
    const table = TEXTES.raisons[etat], connu = raison !== '*' && Object.hasOwn(table, raison), [t, b] = connu ? table[raison] : [table['*'][0], ''];
    const ctx = { appli: String(o.appli || TEXTES.cetteAppli), titre: String(o.titre || '') };
    let texte = typeof t === 'function' ? t(ctx) : t;
    if (etat === 'vide' && raison === 'partie_vide' && o.vide) texte = String(o.vide);
    const bouton = b && o.proprio === true && etat !== 'refuse' && typeof o.peutAgir === 'function' && o.peutAgir(raison) ? { texte: b, doux: DOUX.has(raison), raison } : null;
    // Refusé : la tuile grisée, aucun réglage, jamais de bouton.
    if (etat === 'refuse') return { ...base, texte, gris: true, reglage: false };
    return { ...base, texte, bouton };
  }

  // ---------------- Dessin (seulement quand un hôte l'appelle)
  const SVG = {
    cadenas: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    horloge: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    debranche: '<path d="M3 3l18 18M8.5 8.5A5 5 0 0 0 7 12v2h4M12 5v3M17 12v2h-2M9 18v3M15 18v3"/>',
    vide: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12h7"/>',
  };
  const PLUS = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>';
  const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[k] ?? ''}</svg>`;
  // Les couleurs : celles d'Odin (--ink, --field…) ou, sur l'écran de la maison, celles de son thème (--text, --card2…).
  const CSS = `
/* Carte étroite : le titre garde sa place (84 px au moins) ; la pastille, « Ouvrir › » et « ⋯ » passent dessous. */
.wr-h{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;min-height:34px;min-width:0}
.wr-ic{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;flex:none;overflow:hidden;background:var(--field,var(--card2,#D5D8DE));color:var(--ink,var(--text,#14171C));font-weight:700;font-size:15px}
.wr-ic.wr-app{background:none}.wr-gris .wr-ic{filter:grayscale(1);opacity:.5}
.wr-t{min-width:0;flex:1 1 84px}
.wr-n{display:block;font-weight:650;font-size:14.5px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink,var(--text,inherit))}
.wr-s{display:block;font-size:11.5px;line-height:1.3;color:var(--muted,#555B66);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wr-pastille{flex:none;font-size:11px;font-weight:700;line-height:1.3;padding:3px 8px;border-radius:999px;white-space:nowrap;background:var(--warn-bg,color-mix(in srgb,var(--warn,#A15C07) 16%,transparent));color:var(--warn,#A15C07);border:1px solid var(--warn-l,color-mix(in srgb,var(--warn,#A15C07) 45%,transparent))}
.wr-plus{flex:none;width:44px;height:44px;margin:-5px -12px -5px auto;padding:0;border:0;border-radius:12px;background:none;color:var(--muted,#555B66);display:grid;place-items:center;cursor:pointer}
.wr-plus:hover{background:var(--hover,var(--card2,#EEF0F3))}.wr-plus svg{width:18px;height:18px}
.wr-ligne{display:flex;align-items:flex-start;gap:7px;font-size:13.5px;line-height:1.35;color:var(--muted,#555B66);min-width:0;max-width:100%}
.wr-ligne svg{width:16px;height:16px;flex:none;margin-top:1px}.wr-ligne span{min-width:0;overflow-wrap:anywhere}
.wr-btn{align-self:flex-start;min-height:44px;padding:0 16px;border-radius:8px;border:1px solid transparent;background:var(--accent,#2F5BD3);color:var(--on-accent,#111);font-family:inherit;font-size:14px;font-weight:600;line-height:1;cursor:pointer}
.wr-btn.wr-doux{background:transparent;color:var(--ink,var(--text,inherit));border-color:var(--line,#D9DCE2)}
.wr-btn:focus-visible,.wr-plus:focus-visible{outline:2px solid var(--accent,#2F5BD3);outline-offset:2px}
.wr-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.wr-corps{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin:10px 0 0}`;
  /** Pose le style une fois, dans le document de l'hôte (au premier dessin). */
  function poserStyle(doc = document) {
    if (doc.getElementById('odinWidgetsRendu')) return;
    const s = doc.createElement('style'); s.id = 'odinWidgetsRendu'; s.textContent = CSS; doc.head.append(s);
  }
  function el(t, cls, texte) { const n = document.createElement(t); if (cls) n.className = cls; if (texte !== undefined) n.textContent = texte; return n; }
  /**
   * L'en-tête de la maquette. `o` :
   * - `tuile` : un nœud (la tuile de l'appli) ou rien ; `lettre` : sinon, un symbole ou une lettre ; `appli` : vrai si la tuile est celle d'une appli ;
   * - `titre`, `sous` (sous-titre, facultatif), `pastille` (état ancien), `gris` (refusé) ;
   * - `extra` : des nœuds de l'hôte posés avant « ⋯ » (« Ouvrir › ») ;
   * - `regler` : ce que fait « ⋯ » (le propriétaire seul) ; absent, ou `petit` : pas de « ⋯ » ;
   * - `classe`, `classeTuile` : une classe de plus pour l'en-tête et pour sa tuile (celles de l'hôte).
   */
  function entete(o = {}) {
    poserStyle();
    const h = el('div', `wr-h${o.gris ? ' wr-gris' : ''}${o.classe ? ` ${o.classe}` : ''}`);
    const ic = el('span', `wr-ic${o.tuile ? ' wr-app' : ''}${o.classeTuile ? ` ${o.classeTuile}` : ''}`); ic.setAttribute('aria-hidden', 'true');
    if (o.tuile) ic.append(o.tuile); else ic.textContent = String(o.lettre || String(o.titre || '?').slice(0, 1));
    const t = el('div', 'wr-t'); t.append(el('b', 'wr-n', String(o.titre ?? '')));
    if (o.sous) t.append(el('small', 'wr-s', String(o.sous)));
    h.append(ic, t);
    // La pastille : « il y a 12 min » à l'écran ; un lecteur d'écran lit la phrase entière (« Donnée ancienne, lue… »).
    if (o.pastille) { const p = el('span', 'wr-pastille'); p.append(el('span', 'wr-sr', TEXTES.depuisAvant), String(o.pastille)); p.title = TEXTES.depuisNom(o.pastille); h.append(p); }
    for (const x of o.extra ?? []) if (x) h.append(x);
    if (typeof o.regler === 'function' && !o.petit && !o.gris) {
      const b = el('button', 'wr-plus'); b.type = 'button'; b.setAttribute('aria-label', TEXTES.regler(String(o.titre ?? ''))); b.title = TEXTES.regler(String(o.titre ?? ''));
      b.innerHTML = PLUS; b.addEventListener('click', o.regler); h.append(b);
    }
    return h;
  }
  /**
   * Le contenu d'un état sans donnée : la ligne (icône + texte), puis le bouton s'il y en a un. `d` : ce que rend
   * decrire ; `agir(raison)` : ce que fait le bouton. Rend une liste de nœuds, à poser dans le corps de l'hôte.
   */
  function contenu(d, agir) {
    poserStyle();
    const l = el('span', 'wr-ligne'); l.dataset.etat = d.etat; if (d.raison) l.dataset.raison = d.raison;
    if (d.icone) l.insertAdjacentHTML('afterbegin', svg(d.icone));
    l.append(el('span', '', d.texte));
    if (!d.bouton) return [l];
    const b = el('button', `wr-btn${d.bouton.doux ? ' wr-doux' : ''}`, d.bouton.texte); b.type = 'button';
    b.addEventListener('click', (ev) => { ev.stopPropagation(); if (typeof agir === 'function') agir(d.bouton.raison, ev); });
    return [l, b];
  }
  /** Le corps tout fait d'un état sans donnée (un bloc qui empile la ligne et le bouton). */
  function corps(d, agir) { const c = el('div', 'wr-corps'); c.append(...contenu(d, agir)); return c; }

  window.OdinWidgetsRendu = { TEXTES, ETATS, VIE_PRIVEE, etatSansProprio, decrire, depuis, porteUneMesure, entete, contenu, corps, poserStyle, CSS };
})();
