// Le tiroir « Ajouter un widget » de l'accueil (maquette validée « Accueil », lot 18). Un tiroir à droite, de 440 px
// (tout l'écran sur un téléphone) : une recherche, des puces de famille, un bouton « Ajouter » par ligne. Le widget
// ajouté se pose à la fin de la page et l'écran défile jusqu'à lui. En mode Modifier, une tuile « Ajouter un widget »
// en fin de grille l'ouvre aussi.
// Il est rempli par le vrai catalogue d'Odin (GET /api/valhalla/catalog, déjà filtré par les droits de qui regarde) :
// aucune liste d'applis n'est écrite ici, une appli ajoutée demain y paraît toute seule, dans sa famille. « Heure et
// lieu », « Météo », « Site surveillé » et « Bouton sur mesure » restent, rangés dans « Infos ».
// Une appli désactivée (Applis → activer) est montrée grisée, avec « désactivée », sans bouton « Ajouter » : son
// widget n'aurait rien à montrer, et l'ajouter ne doit pas la réveiller.
// Calculs seuls : ce fichier est chargé avant les autres scripts de l'interface et ne touche à rien à son chargement.
// Celui qui s'en sert (fenetre.js) dessine le tiroir, l'ouvre, le ferme et pose les widgets.
// API : window.OdinTiroir = { MESURES, TEXTES, TOUT, INFOS, CSS, sansAccents, active, poser, glisse, familles, famille,
//   trouver, boucle }.
(() => {
  'use strict';
  if (window.OdinTiroir) return;

  /** `largeur` : le tiroir de la maquette (C403) ; sur un écran plus étroit (le téléphone), il prend tout l'écran. `cible` : 44 px à toucher. */
  const MESURES = Object.freeze({ largeur: 440, cible: 44 });
  /** Les deux familles qui ne viennent pas du catalogue : « Tout » et « Infos » (heure, météo, site, bouton). */
  const TOUT = 'tout', INFOS = 'infos';

  /** Les textes de l'interface, en un seul endroit. */
  const TEXTES = Object.freeze({
    titre: 'Ajouter un widget',
    tuile: 'Ajouter un widget',
    bouton: '＋ Ajouter',
    fermer: 'Fermer',
    chercher: 'Chercher une appli, une info…',
    chercherNom: 'Chercher un widget',
    familles: 'Familles',
    tout: 'Tout',
    infos: 'Infos',
    groupeInfos: 'Infos et repères',
    aide: 'Ajouter le pose à la fin de la page. ⚙ sur un widget : choisir la partie de l\'appli à montrer. Tu peux aussi le glisser sur la page.',
    ajouter: 'Ajouter',
    ajouterNom: (n) => `Ajouter ${n}`,
    creer: 'Créer',
    creerNom: (n) => `Créer : ${n}`,
    desactivee: 'désactivée',
    desactiveeAide: 'Active-la dans Applis pour l\'ajouter.',
    refusee: (n) => `${n} est désactivée : active-la dans Applis pour l'ajouter.`,
    inconnue: 'Cette appli n\'est pas dans ton catalogue : rien n\'est ajouté.',
    rien: 'Rien trouvé.',
    trouves: (n) => (n === 1 ? '1 widget trouvé.' : `${n} widgets trouvés.`),
    pose: (n) => `${n} est posé à la fin de la page. Glisse-le où tu veux.`,
    heure: 'Heure et lieu', heureQuoi: 'la date et l\'heure là où est Odin',
    meteo: 'Météo', meteoQuoi: 'le temps, heure par heure',
    site: 'Site surveillé', siteQuoi: 'un site suivi par Pulsar : en ligne ou en panne',
    perso: 'Bouton sur mesure', persoQuoi: 'n\'importe quelle action d\'une appli ; les actions graves te demandent ton accord à chaque clic',
  });

  /** Le texte sans accents ni majuscules, pour chercher « meteo » et trouver « Météo ». */
  function sansAccents(t) {
    return String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }
  /** L'appli est-elle active ? Seul un `active: false` explicite du catalogue la grise (une essentielle l'est toujours). */
  function active(m) {
    if (!m || typeof m !== 'object') return true;
    if (m.essentielle === true) return true;
    return m.active !== false;
  }
  /**
   * Peut-on poser un widget de l'appli `id` ? `ok` (pas d'appli : heure, météo ; ou une appli active du catalogue),
   * `desactivee`, ou `inconnue` (absente du catalogue de qui regarde, ou catalogue illisible) : rien n'est posé.
   */
  function poser(modules, id) {
    if (id === undefined || id === null || id === '') return 'ok';
    if (!Array.isArray(modules)) return 'inconnue';
    const m = modules.find((x) => x && x.id === id);
    if (!m) return 'inconnue';
    return active(m) ? 'ok' : 'desactivee';
  }
  /**
   * Ce qu'on lâche sur la grille : seulement une ligne du tiroir (heure, météo, chiffres d'une appli), relue et
   * refaite. Un glisser venu d'ailleurs (une autre page, un texte illisible, un bouton d'action) : null, rien n'est posé.
   */
  function glisse(texte) {
    let o; try { o = JSON.parse(String(texte ?? '')); } catch { return null; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    if (o.kind === 'heure' || o.kind === 'meteo') return { kind: o.kind };
    if (o.kind === 'chiffres' && typeof o.module === 'string' && /^[a-z0-9_-]{1,40}$/.test(o.module)) return { kind: 'chiffres', module: o.module };
    return null;
  }
  /** Les familles du catalogue, dans l'ordre où il les donne, sans double ni vide. */
  function familles(modules) {
    const vues = [];
    for (const m of Array.isArray(modules) ? modules : []) {
      const f = typeof m?.family === 'string' ? m.family.trim() : '';
      if (f && !vues.includes(f)) vues.push(f);
    }
    return vues;
  }
  /** La famille choisie, si elle existe encore ; sinon « Tout » (une famille disparue du catalogue ne vide pas le tiroir). */
  function famille(choisie, connues) {
    if (choisie === TOUT || choisie === INFOS) return choisie;
    return (Array.isArray(connues) ? connues : []).includes(choisie) ? choisie : TOUT;
  }
  /**
   * Les lignes qui répondent à la recherche et à la famille, en groupes (dans l'ordre : les infos, puis les familles
   * du catalogue). Une ligne : `{ nom, quoi, famille, groupe, … }` ; `famille` vaut INFOS ou une famille du catalogue.
   * La recherche porte sur le nom, ce qu'il fait et la famille, sans accents ni majuscules. Rien : une liste vide.
   */
  function trouver(lignes, terme, choisie) {
    const t = sansAccents(terme), mots = t ? t.split(/\s+/) : [];
    const groupes = new Map();
    for (const l of Array.isArray(lignes) ? lignes : []) {
      if (!l || typeof l !== 'object') continue;
      if (choisie && choisie !== TOUT && l.famille !== choisie) continue;
      const texte = sansAccents(`${l.nom ?? ''} ${l.quoi ?? ''} ${l.famille === INFOS ? TEXTES.infos : l.famille ?? ''}`);
      if (!mots.every((m) => texte.includes(m))) continue;
      const g = l.groupe || (l.famille === INFOS ? TEXTES.groupeInfos : String(l.famille ?? ''));
      if (!groupes.has(g)) groupes.set(g, []);
      groupes.get(g).push(l);
    }
    return [...groupes].map(([titre, l]) => ({ titre, lignes: l }));
  }
  /**
   * Le focus gardé dans le tiroir : Tab sur le dernier contrôle revient au premier, Maj + Tab sur le premier va au
   * dernier. Rend l'indice où aller, ou -1 si le navigateur fait déjà bien (au milieu de la liste).
   */
  function boucle(n, i, arriere) {
    if (!(n > 0)) return -1;
    if (i < 0) return arriere ? n - 1 : 0; // le focus est ailleurs : on le ramène dedans
    if (arriere && i === 0) return n - 1;
    if (!arriere && i === n - 1) return 0;
    return -1;
  }

  /**
   * Le style du tiroir et de la tuile, aux couleurs du thème d'Odin (clair ou sombre). Fermé, le tiroir est caché aux
   * lecteurs d'écran et au clavier (`visibility`) ; « moins d'animations » : il apparaît sans glisser.
   */
  const CSS = `
.fe-tiroir{position:fixed;top:0;right:0;bottom:0;width:min(${MESURES.largeur}px,100vw);z-index:95;display:flex;flex-direction:column;background:var(--panel);color:var(--ink);border-left:1px solid var(--line);box-shadow:-30px 0 60px rgba(16,54,58,.22);transform:translateX(105%);visibility:hidden;transition:transform .4s cubic-bezier(.2,.8,.2,1),visibility 0s linear .4s}
.fe-tiroir.open{transform:none;visibility:visible;transition:transform .4s cubic-bezier(.2,.8,.2,1),visibility 0s}
.fe-tiroir header{padding:16px 16px 12px;display:flex;flex-direction:column;gap:10px;border-bottom:1px solid var(--line)}
.fe-tiroir-h{display:flex;align-items:center;gap:8px}.fe-tiroir h2{margin:0;font-size:18px;flex:1}
.fe-tiroir-x{width:${MESURES.cible}px;height:${MESURES.cible}px;border-radius:12px;border:1px solid var(--line);background:var(--panel2,var(--panel));color:var(--ink);cursor:pointer;font-size:16px;flex:none}
.fe-tiroir input[type=search]{width:100%;min-height:${MESURES.cible}px;border-radius:12px;border:1px solid var(--field);background:var(--panel2,var(--panel));color:var(--ink);padding:0 12px;font:inherit}
.fe-chips{display:flex;gap:6px;flex-wrap:wrap}.fe-chips button{min-height:${MESURES.cible}px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--panel2,var(--panel));color:var(--ink);font:600 13px inherit;cursor:pointer}
.fe-chips button[aria-pressed=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.fe-tiroir header small{color:var(--muted);font-size:12.5px}
.fe-tiroir-corps{overflow:auto;padding:4px 16px 30px;flex:1;overscroll-behavior:contain}
.fe-tiroir h3{margin:18px 0 8px;font-size:11.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.fe-it{display:flex;gap:12px;align-items:center;padding:8px 10px;border-radius:14px}.fe-it:hover{background:var(--panel2,transparent)}
.fe-it .fe-ic{width:40px;height:40px}.fe-it-t{flex:1;min-width:0}.fe-it-t b{display:block;font-size:14px;overflow-wrap:anywhere}
.fe-it-t small{color:var(--muted);font-size:12.5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.fe-it .btn{min-height:${MESURES.cible}px;min-width:${MESURES.cible}px;flex:none}
.fe-it.off .fe-ic{opacity:.5;filter:grayscale(1)}.fe-off{flex:none;font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.fe-tiroir-rien{color:var(--muted);margin:18px 0}
.fe-ajout{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:74px;border:2px dashed var(--line);border-radius:18px;background:none;color:var(--muted);font:600 15px inherit;cursor:pointer}
.fe-ajout:hover,.fe-ajout:focus-visible{color:var(--ink);border-color:var(--accent,#0b7f7c)}
@keyframes fe-pop{0%{transform:scale(.9);opacity:.4}60%{transform:scale(1.02);opacity:1}100%{transform:none}}.fe-w.fe-pop{animation:fe-pop .45s ease-out}
@media (prefers-reduced-motion:reduce){.fe-tiroir,.fe-tiroir.open{transition:none}.fe-w.fe-pop{animation:none}}`;

  window.OdinTiroir = Object.freeze({ MESURES, TEXTES, TOUT, INFOS, CSS, sansAccents, active, poser, glisse, familles, famille, trouver, boucle });
})();
