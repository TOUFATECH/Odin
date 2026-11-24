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
// « Régler » (lot 25b) : le bouton « ⋯ » ouvre la fenêtre « Régler » de la maquette. Ici : ses mots, sa fenêtre de
// dialogue (fenetreRegler : le clavier y reste, Échap ferme et rend le focus), et ses règles sans document — une
// adresse nettoyée comme le fait le serveur (adresseNette), ce que fait un widget quand on le touche (toucherDe), les
// sortes qui ne se copient pas vers l'autre écran (copieRefusee) et celle qui ne se retire pas (retirable). L'hôte
// (fenetre.js) remplit la fenêtre. L'écran de la maison ne règle rien et ne reçoit jamais « Quand je touche ».
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
        // Lot 26 : « Tu veux sans doute » quand Odin n'a rien à proposer.
        rien_propose: ['Rien à proposer pour l\'instant.', ''],
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
    // La fenêtre « Régler » (lot 25b) : tous ses mots, ici.
    reglage: {
      titre: (t) => `Régler « ${t} »`,
      champTitre: 'Titre affiché', titreSite: 'Un site surveillé porte le nom de sa sonde : il se change dans Pulsar.',
      taille: 'Taille', aideTaille: 'Ou tire le coin du widget, à la case près.',
      style: 'Style', montre: "Ce qu'il montre", chiffres: 'Les chiffres clés',
      toucher: 'Quand je touche le widget',
      choix: { appli: (a) => `Ouvrir ${a}`, action: "Lancer une action de l'appli", ecran: 'Aller à un écran', adresse: 'Ouvrir une adresse web', rien: 'Rien' },
      action: 'Action', aideGrave: 'Cette action peut être grave : Odin te demande alors ton accord à chaque fois, avant de la lancer.', aucuneAction: 'Choisis une action.',
      ecran: 'Écran', ecrans: { accueil: "Accueil d'Odin", maison: 'Écran de la maison' },
      adresse: 'Adresse', adresseAide: "Elle s'ouvre dans un nouvel onglet.",
      adresseRefusee: 'Adresse refusée : elle commence par http ou https, sans identifiant ni mot de passe dedans.',
      tailleRefusee: 'Cette taille est refusée pour ce widget.',
      copier: { maison: "Copier vers l'écran de la maison", accueil: "Copier vers l'accueil" },
      pages: { maison: 'Écran de la maison', accueil: 'Accueil' },
      copie: (p) => `Copié sur la page « ${p} ».`, copieFermee: ' La copie reste fermée aux autres.',
      copieReservee: "Ce widget reste sur ton accueil : il ne se copie pas vers l'autre écran.",
      copiePrivee: "Vie privée : ce widget n'est ouvert à personne, il ne se copie pas vers l'autre écran.",
      copiePleine: "Plus de place sur l'autre écran : retire d'abord un widget ou une page.",
      retirer: 'Retirer', retire: (t) => `« ${t} » est retiré de la page.`, fixe: '« À faire » se déplace mais ne se retire pas.',
      ouvrirA: 'Ouvrir à…', ouvertA: (n) => `Vie privée : ouvert à ${n}.`, ouvertAPersonne: "Vie privée : ouvert à personne d'autre que toi.",
      referme: (n) => `Ce changement referme le widget pour ${n}. Tu pourras le rouvrir avec « Ouvrir à… ».`,
      refermeInconnu: "S'il est ouvert à quelqu'un, ce changement le referme pour cette personne.",
      annuler: 'Annuler', valider: 'Valider', pied: "Rien n'est gardé avant « Terminé ».",
    },
    // Ce que dit le bouton de l'en-tête selon « Quand je touche le widget », et ce qui est annoncé.
    toucher: {
      lancer: 'Lancer ›', lancerNom: (a, t) => `Lancer « ${a} » (${t})`, aller: 'Aller ›', allerNom: (e) => `Aller à : ${e}`,
      site: 'Site ↗', siteNom: (h) => `Ouvrir ${h} dans un nouvel onglet`, annule: 'Annulé.',
    },
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

  // ---------------- « Régler » (lot 25b) : les règles, sans document
  /** Les quatre sortes réservées à l'accueil du propriétaire (comme le serveur, widgets/aujourdhui.ts) : jamais copiées. */
  const RESERVEES = ['a_faire', 'odin_a_fait', 'tu_veux', 'comportement'];
  /** Les sortes qui se déplacent mais ne se retirent pas (comme le serveur : « fixe »). */
  const FIXES = ['a_faire'];
  /** Par sorte : ses styles, quand elle en a plus d'un (comme le serveur). Aucune aujourd'hui : pas de choix de style. */
  const STYLES = {};
  /** Les écrans où un widget peut mener (comme le serveur, ECRANS_TOUCHER). */
  const ECRANS_TOUCHER = ['accueil', 'maison'];
  const ADRESSE_MAX = 500;
  const INTERDITS = /[\u0000-\u0020\u007f-\u009f\\\u2028\u2029]/;
  /**
   * Une adresse web nettoyée, ou rien si elle est refusée : la même règle que le serveur (adresseNette,
   * src/valhalla/widgets/regler.ts ; un essai compare les deux). http ou https seulement, écrite en entier, sans
   * identifiants, sans espace, 500 signes au plus. Sans moyen de la lire (pas de URL) : refusée.
   */
  function adresseNette(v) {
    if (typeof v !== 'string' || typeof URL !== 'function') return undefined;
    const t = v.trim();
    if (!t || t.length > ADRESSE_MAX || INTERDITS.test(t) || !/^https?:\/\/[^/?#]/i.test(t)) return undefined;
    let u; try { u = new URL(t); } catch { return undefined; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    if (u.username || u.password || !u.hostname) return undefined;
    return u.href.length <= ADRESSE_MAX ? u.href : undefined;
  }
  /** Ce widget se retire-t-il de la fenêtre ? « À faire » : non. */
  const retirable = (kind) => !FIXES.includes(kind);
  /**
   * Pourquoi « Copier vers l'autre écran » est refusé, ou '' s'il est permis. `o` : { kind, privee (lit-il une appli
   * de la vie privée ?), ouvert (ouvert à au moins une personne, vérifié) }. Les quatre sortes réservées : jamais. Un
   * widget de la vie privée qui n'est ouvert à personne : non plus. Ce qu'on n'a pas pu vérifier : refusé.
   */
  function copieRefusee(o = {}) {
    if (typeof o.kind !== 'string' || !o.kind || RESERVEES.includes(o.kind)) return 'reservee';
    if (o.privee === false) return '';
    return o.privee === true && o.ouvert === true ? '' : 'vie_privee';
  }
  /**
   * Ce que fait un widget quand on le touche, relu sans confiance : { quoi: 'appli' | 'action' | 'ecran' | 'adresse' |
   * 'rien', … }. Rien d'écrit (ou rien de reconnu) : ouvrir son appli s'il en a une, sinon rien. Une action est
   * toujours celle de l'appli du widget ; une adresse est renettoyée ici avant d'être ouverte.
   */
  function toucherDe(w) {
    const t = w && typeof w.toucher === 'object' && w.toucher ? w.toucher : {}, mod = w && typeof w.module === 'string' ? w.module : '';
    if (t.quoi === 'rien') return { quoi: 'rien' };
    if (t.quoi === 'ecran' && ECRANS_TOUCHER.includes(t.ecran)) return { quoi: 'ecran', ecran: t.ecran };
    if (t.quoi === 'adresse') { const a = adresseNette(t.adresse); if (a) return { quoi: 'adresse', adresse: a }; }
    if (t.quoi === 'action' && mod && w.kind !== 'bouton' && typeof t.action === 'string' && /^[a-z_][a-z0-9_]{0,39}$/i.test(t.action)) return { quoi: 'action', appli: mod, action: t.action, input: t.input && typeof t.input === 'object' ? t.input : {} };
    return mod ? { quoi: 'appli', appli: mod } : { quoi: 'rien' };
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
.wr-corps{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin:10px 0 0}
/* « Régler » (lot 25b) : une fenêtre de 520 px au plus, qui tient à 390 px ; chaque commande fait 44 px. */
dialog.wr-regler{box-sizing:border-box;width:min(520px,calc(100% - 24px));max-width:none;max-height:calc(100% - 24px);padding:0;border-radius:18px;border:1px solid var(--line,#D9DCE2);background:var(--panel,var(--card2,#FFF));color:var(--ink,var(--text,#14171C));font-family:inherit;overflow:hidden}
dialog.wr-regler::backdrop{background:rgba(8,12,18,.55)}
.wr-rg{display:flex;flex-direction:column;max-height:calc(100vh - 26px);max-height:calc(100dvh - 26px)}
.wr-rg-h{display:flex;align-items:center;gap:10px;margin:0;padding:16px 18px 10px;font-size:17px;font-weight:650;line-height:1.3}
.wr-rg-h .wr-ic{width:40px;height:40px}.wr-rg-h>span:last-child{min-width:0;overflow-wrap:anywhere}
.wr-rg-c{display:flex;flex-direction:column;gap:14px;padding:2px 18px 12px;overflow-y:auto;overscroll-behavior:contain}
.wr-fld{display:flex;flex-direction:column;gap:6px;min-width:0;margin:0;padding:0;border:0}
.wr-fld>label,.wr-fld>legend{display:block;margin:0;padding:0;font-size:13px;font-weight:650;color:inherit}
.wr-fld input[type=text],.wr-fld input[type=url],.wr-fld select{box-sizing:border-box;width:100%;min-height:44px;margin:0;padding:0 12px;border-radius:10px;border:1px solid var(--muted,#555B66);background:var(--panel,var(--card2,#FFF));color:inherit;font-family:inherit;font-size:15px}
.wr-fld select option{color:#111;background:#fff}
.wr-fld :disabled{opacity:.6}
.wr-aide{margin:0;font-size:12.5px;line-height:1.4;color:var(--muted,#555B66)}.wr-aide:empty{display:none}
.wr-sous{display:flex;flex-direction:column;gap:6px;min-width:0}.wr-sous:empty{display:none}
.wr-sizes{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:6px}
.wr-sizes label{display:flex;align-items:center;gap:8px;min-height:44px;margin:0;padding:0 10px;border:1px solid var(--line,#D9DCE2);border-radius:12px;font-size:14px;font-weight:600;cursor:pointer}
.wr-sizes input{flex:none;width:18px;height:18px;margin:0;accent-color:var(--accent,#2F5BD3)}
.wr-sizes label:has(input:checked){border-color:var(--accent,#2F5BD3)}
.wr-sizes small{margin-left:auto;font-weight:500;color:var(--muted,#555B66);font-variant-numeric:tabular-nums}
.wr-note{margin:0;padding:9px 12px;border-radius:10px;font-size:13px;line-height:1.4;border:1px solid var(--line,#D9DCE2);overflow-wrap:anywhere}
.wr-note:empty{display:none}
.wr-note.wr-att{background:var(--warn-bg,color-mix(in srgb,var(--warn,#A15C07) 14%,transparent));border-color:var(--warn-l,color-mix(in srgb,var(--warn,#A15C07) 45%,transparent))}
.wr-note.wr-non{border-color:var(--bad,#B3261E)}
.wr-rang{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.wr-rang .wr-aide{flex:1 1 160px}
.wr-rg-p{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 18px 16px;border-top:1px solid var(--line,#D9DCE2)}
.wr-fin{display:flex;gap:8px;margin-left:auto}.wr-rg-p .wr-aide{flex:1 1 100%}
.wr-rb{box-sizing:border-box;min-height:44px;margin:0;padding:0 14px;border-radius:10px;border:1px solid var(--muted,#555B66);background:none;color:inherit;font-family:inherit;font-size:14.5px;font-weight:600;line-height:1.2;cursor:pointer}
.wr-rb.wr-p{background:var(--accent,#2F5BD3);border-color:var(--accent,#2F5BD3);color:var(--on-accent,#FFF)}
.wr-rb.wr-danger{color:var(--bad,#B3261E);border-color:var(--bad,#B3261E)}
.wr-rb:focus-visible,.wr-fld input:focus-visible,.wr-fld select:focus-visible{outline:2px solid var(--accent,#2F5BD3);outline-offset:2px}
@media (max-width:480px){.wr-rg-p .wr-rb{flex:1 1 calc(50% - 4px)}.wr-fin{flex:1 1 100%}}`;
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

  /** Un champ de « Régler » : son nom, lié au contrôle par `pour` ; sans `pour`, un ensemble nommé (des boutons radio). */
  function champ(nom, pour, ...noeuds) {
    const f = el(pour ? 'div' : 'fieldset', 'wr-fld'), n = el(pour ? 'label' : 'legend', '', nom);
    if (pour) n.htmlFor = pour;
    f.append(n, ...noeuds.filter(Boolean));
    return f;
  }
  /** Un bouton de « Régler ». `genre` : 'p' (le principal), 'danger', ou rien. */
  function bouton(texte, faire, genre) {
    const b = el('button', `wr-rb${genre ? ` wr-${genre}` : ''}`, texte); b.type = 'button';
    if (typeof faire === 'function') b.addEventListener('click', faire);
    return b;
  }
  /**
   * La fenêtre « Régler » de la maquette : un titre (la tuile de l'appli, « Régler « … » »), un corps qui défile, un
   * pied de boutons. Une vraie fenêtre de dialogue : le clavier y reste, Échap la ferme, et le focus revient à ce qui
   * l'a ouverte (`rendre` : un nœud, ou une fonction qui le retrouve après un nouveau dessin de la page).
   * `o` : { titre, tuile, lettre, corps: [nœuds], pied: [nœuds], rendre, fermee() }. Rend { d, fermer() }.
   */
  function fenetreRegler(o = {}) {
    poserStyle();
    const d = el('dialog', 'wr-regler'), id = `wrTitre${Date.now().toString(36)}`; d.setAttribute('aria-labelledby', id);
    const ic = el('span', `wr-ic${o.tuile ? ' wr-app' : ''}`); ic.setAttribute('aria-hidden', 'true');
    if (o.tuile) ic.append(o.tuile); else ic.textContent = String(o.lettre || String(o.titre || '?').slice(0, 1));
    const nom = el('span', '', TEXTES.reglage.titre(String(o.titre ?? ''))); nom.id = id;
    const h = el('h2', 'wr-rg-h'); h.append(ic, nom);
    const c = el('div', 'wr-rg-c'); c.append(...(o.corps ?? []).filter(Boolean));
    const p = el('div', 'wr-rg-p'); p.append(...(o.pied ?? []).filter(Boolean));
    const boite = el('div', 'wr-rg'); boite.append(h, c, p); d.append(boite);
    const ouvreur = document.activeElement;
    d.addEventListener('close', () => {
      d.remove();
      if (typeof o.fermee === 'function') o.fermee();
      const n = typeof o.rendre === 'function' ? o.rendre() : o.rendre ?? ouvreur;
      if (n && n.isConnected && typeof n.focus === 'function') n.focus();
    });
    // Un appui sur le fond sombre (hors de la fenêtre) la ferme, comme « Annuler ».
    d.addEventListener('mousedown', (ev) => { if (ev.target !== d) return; const r = boite.getBoundingClientRect(); if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) d.close(); });
    document.body.append(d); d.showModal();
    return { d, fermer: () => { if (d.open) d.close(); } };
  }

  window.OdinWidgetsRendu = { TEXTES, ETATS, VIE_PRIVEE, etatSansProprio, decrire, depuis, porteUneMesure, entete, contenu, corps, poserStyle, CSS,
    RESERVEES, FIXES, STYLES, ECRANS_TOUCHER, ADRESSE_MAX, adresseNette, retirable, copieRefusee, toucherDe, champ, bouton, fenetreRegler };
})();
