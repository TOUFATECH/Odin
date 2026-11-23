// Glisser un module de l'accueil (maquette validée « Accueil », lot 16). À la souris, on attrape la
// carte ; au doigt, un appui long de 480 ms. Une copie suit le pointeur, un cadre en pointillé reste à la place
// d'origine, le module prend la place d'un autre selon la moitié survolée, et près du haut ou du bas la page défile
// toute seule.
// Ses règles (question 10) : en mode « Modifier », rien n'est gardé avant « Terminé », « Annuler » remet tout ; hors de
// ce mode, le déplacement est gardé au lâcher, avec un « Annuler » offert quelques secondes. Hors du mode Modifier, le
// glisser part de l'en-tête ou du vide de la carte, jamais de son texte : on peut toujours sélectionner un texte.
// Calculs seuls : ce fichier est chargé avant les autres scripts de l'interface et ne touche à rien à son chargement.
// Celui qui s'en sert (fenetre.js) lit le document et pose les gestes.
// API : window.OdinGestes = { MESURES, CONTROLES, aDuTexte, zone, depart, suite, appui, seule, apres, defilement,
//   mouvement, auLacher, offre, peutAnnuler }.
(() => {
  'use strict';
  if (window.OdinGestes) return;

  /**
   * Les mesures du geste. `appuiLong` : le doigt reste posé 480 ms (la maquette) ; `bougeAppui` : s'il bouge de plus de
   * 8 px avant, c'est qu'il fait défiler la page, l'appui est oublié. `seuil` : à la souris, le glisser commence après
   * 6 px (un simple clic ne déplace rien). `bord` : à 70 px du haut ou du bas, la page défile de `pasDefil` px par
   * image. `echange` : au plus un changement de place toutes les 120 ms (sinon deux cartes s'échangent sans fin).
   * `annuler` : hors du mode Modifier, « Annuler » reste offert 6 secondes.
   */
  const MESURES = Object.freeze({ appuiLong: 480, bougeAppui: 8, seuil: 6, bord: 70, pasDefil: 14, echange: 120, annuler: 6000, seul: 0.9 });
  /** Ce qui, dans une carte, est un contrôle : on s'en sert, on ne l'attrape pas. */
  const CONTROLES = 'button,a,input,select,textarea,label,summary,details,dialog,[role=button],[role=switch],[role=slider],[role=link],[contenteditable],[tabindex],.fe-rz,.fe-chrome';

  /** Le nœud montre-t-il du texte lui-même (un de ses enfants directs est un texte non vide) ? */
  function aDuTexte(n) {
    const kids = n && n.childNodes ? Array.from(n.childNodes) : [];
    return kids.some((k) => k && k.nodeType === 3 && String(k.textContent ?? '').trim() !== '');
  }
  /**
   * La zone touchée, d'après ce que la page en sait : `controle`, `coin` (le coin qui change la taille), `poignee`,
   * `entete` (l'en-tête de la carte), `texte` (un texte du contenu) ou `vide` (le fond de la carte, entre ses blocs).
   */
  function zone(o) {
    const z = o ?? {};
    if (z.coin) return 'coin';
    if (z.poignee) return 'poignee';
    if (z.controle) return 'controle';
    if (z.entete) return 'entete';
    return z.texte ? 'texte' : 'vide';
  }
  /**
   * Que fait un appui ? `pointeur` : 'mouse', 'touch' ou 'pen' ; `modifier` : le mode Modifier est ouvert ;
   * `zone` : rendue par `zone` ; `bouton` : le bouton de la souris (0 = gauche) ; `principal` : faux pour un second doigt.
   * Rend 'rien', 'glisser' (le glisser commence quand le pointeur a bougé de `seuil` px) ou 'appuiLong'
   * (le glisser commence si le doigt reste posé `appuiLong` ms ; hors du mode Modifier, ce mode s'ouvre).
   */
  function depart(o) {
    const { pointeur, modifier, zone: z, bouton = 0, principal = true } = o ?? {};
    if (!principal || bouton > 0) return 'rien';
    if (z === 'controle' || z === 'coin') return 'rien';
    const souris = pointeur === 'mouse';
    if (z === 'poignee') return 'glisser';
    if (!modifier && z === 'texte') return 'rien'; // le texte se sélectionne (constat P17)
    if (souris) return 'glisser';
    return 'appuiLong'; // au doigt, la page défile encore : seul un appui qui dure attrape la carte
  }
  /**
   * À la souris, avant que le glisser ne commence : `dx`, `dy` depuis l'appui, `selection` : un texte est en train
   * d'être sélectionné. Rend 'attendre', 'commencer' ou 'abandonner' (la sélection gagne, rien ne bouge).
   */
  function suite(o) {
    const { dx = 0, dy = 0, selection = false } = o ?? {};
    if (selection) return 'abandonner';
    return Math.hypot(Number(dx) || 0, Number(dy) || 0) >= MESURES.seuil ? 'commencer' : 'attendre';
  }
  /**
   * Au doigt, pendant l'appui : `dx`, `dy` depuis l'appui, `ecoule` ms depuis l'appui. Rend 'annuler' (le doigt fait
   * défiler la page), 'tenir' (480 ms passées : la carte est en main) ou 'attendre'.
   */
  function appui(o) {
    const { dx = 0, dy = 0, ecoule = 0 } = o ?? {};
    if (Math.hypot(Number(dx) || 0, Number(dy) || 0) > MESURES.bougeAppui) return 'annuler';
    return Number(ecoule) >= MESURES.appuiLong ? 'tenir' : 'attendre';
  }
  /** La carte est-elle seule sur sa rangée (presque toute la largeur de la grille, comme au téléphone) ? */
  function seule(rect, largeurGrille) {
    return Boolean(rect) && rect.width > 0 && Number(largeurGrille) > 0 && rect.width >= MESURES.seul * Number(largeurGrille);
  }
  /**
   * Le pointeur est-il « après » la carte visée ? Une carte seule sur sa rangée : sa moitié du bas (au téléphone,
   * gauche et droite ne veulent rien dire). Sinon : sa moitié droite (la maquette). Le rang qui en sort est
   * calculé par OdinGrille.rang (pages/accueil-grille.js).
   */
  function apres(x, y, rect, largeurGrille) {
    if (!rect || !(rect.width > 0)) return false;
    if (seule(rect, largeurGrille)) return rect.height > 0 && (y - rect.top) / rect.height > 0.5;
    return (x - rect.left) / rect.width > 0.5;
  }
  /** Le défilement tout seul : `y` le pointeur, `haut` et `bas` les bords de la zone qui défile. −pas, 0 ou +pas. */
  function defilement(y, haut, bas) {
    const v = Number(y), h = Number(haut), b = Number(bas);
    if (!Number.isFinite(v) || !Number.isFinite(h) || !Number.isFinite(b) || b <= h) return 0;
    if (v < h + MESURES.bord) return -MESURES.pasDefil;
    if (v > b - MESURES.bord) return MESURES.pasDefil;
    return 0;
  }
  /**
   * Comment bouge la copie : `incline` (degrés au plus), `leve` (agrandie de), `prise` et `pose` (durées en ms).
   * Avec « moins d'animations » (`reduit`), rien ne bouge tout seul : ni pente, ni loupe, ni durée.
   */
  function mouvement(reduit) {
    return reduit ? Object.freeze({ incline: 0, leve: 1, prise: 0, pose: 0 }) : Object.freeze({ incline: 3, leve: 1.03, prise: 140, pose: 180 });
  }
  /**
   * Au lâcher : `modifier` (le mode est ouvert), `change` (l'ordre a changé), `annule` (Échap, ou la fenêtre a perdu
   * le focus). Rend 'remettre' (l'ordre d'avant revient), 'rien', 'attendre' (gardé seulement à « Terminé ») ou
   * 'ranger' (hors du mode Modifier : gardé tout de suite, avec « Annuler » offert).
   */
  function auLacher(o) {
    const { modifier, change, annule } = o ?? {};
    if (annule) return 'remettre';
    if (!change) return 'rien';
    return modifier ? 'attendre' : 'ranger';
  }
  /** L'offre d'« Annuler » après un déplacement gardé : la fenêtre `avant` (à remettre), celle gardée `apres`, jusqu'à quand. */
  function offre(avant, apres, maintenant) {
    return Object.freeze({ avant: String(avant ?? ''), apres: String(apres ?? ''), jusqua: Number(maintenant) + MESURES.annuler });
  }
  /**
   * « Annuler » marche-t-il encore ? Seulement pendant ses secondes, et si la fenêtre gardée est encore celle du
   * déplacement (un autre changement gardé depuis ne serait pas défait sans le dire), et hors du mode Modifier.
   */
  function peutAnnuler(o, maintenant, gardee, modifier = false) {
    if (!o || modifier) return false;
    return Number(maintenant) <= o.jusqua && String(gardee) === o.apres && o.avant !== o.apres;
  }

  window.OdinGestes = Object.freeze({ MESURES, CONTROLES, aDuTexte, zone, depart, suite, appui, seule, apres, defilement, mouvement, auLacher, offre, peutAnnuler });
})();
