// Odin naturel, côté navigateur : homme ou femme (le réglage vient du serveur), et la voix du navigateur.
//  - OdinNaturel.genre : 'homme' ou 'femme' (posé par la page à chaque état reçu) ;
//  - OdinNaturel.accord('prêt', 'prête') : la bonne forme pour les phrases toutes faites de l'interface ;
//  - OdinNaturel.choisirVoix(voix, genre) : la meilleure voix FRANÇAISE du bon genre parmi celles de l'appareil
//    (Windows, macOS, iOS, Android, Chrome, Edge). Jamais une voix anglaise pour lire du français : sans voix
//    française, rien n'est choisi et la page le dit.
//  - OdinNaturel.regler(phrase, voix, genre, reglages) : pose la voix, la langue, la vitesse et la hauteur
//    (naturelles : 1, sauf léger décalage quand l'appareil n'a aucune voix du bon genre).
// Tout est pur (aucun accès à la page) : les essais le chargent tel quel.
(() => {
  'use strict';
  const racine = typeof window !== 'undefined' ? window : globalThis;
  if (racine.OdinNaturel) return;

  const plat = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Prénoms des voix françaises connues, par système.
  //  Windows : Hortense, Julie, Paul, Claude, Caroline, Guillaume ; Edge « Online (Natural) » : Denise, Henri, Eloise,
  //            Vivienne, Remy, Sylvie, Antoine, Jean, Thierry, Charline, Gerard, Ariane, Fabrice.
  //  macOS / iOS : Thomas, Daniel, Nicolas, Jacques ; Amélie, Audrey, Aurélie, Marie, Chantal, Aude.
  const HOMMES = new Set(['henri', 'paul', 'claude', 'guillaume', 'remy', 'antoine', 'jean', 'thierry', 'gerard', 'fabrice', 'thomas', 'daniel', 'nicolas', 'jacques',
    'alain', 'yves', 'mathieu', 'olivier', 'jerome', 'denis', 'gilles', 'grandpa', 'eddy', 'reed', 'rocko', 'male', 'homme', 'masculin', 'masculine']);
  const FEMMES = new Set(['hortense', 'julie', 'caroline', 'denise', 'eloise', 'vivienne', 'sylvie', 'charline', 'ariane', 'amelie', 'audrey', 'aurelie', 'marie', 'chantal',
    'aude', 'celine', 'virginie', 'brigitte', 'coralie', 'josephine', 'yvette', 'lea', 'flo', 'grandma', 'sandy', 'shelley', 'female', 'femme', 'feminin', 'feminine']);
  // Android (voix de Google) : le nom ne dit rien, l'identifiant si (fra, frc, vlf : femmes ; frb, frd : hommes).
  const ANDROID_F = /fr[-_]fr[-_]x[-_](?:fra|frc|vlf)|fr[-_]ca[-_]x[-_]ca[ac]/, ANDROID_H = /fr[-_]fr[-_]x[-_](?:frb|frd)|fr[-_]ca[-_]x[-_]ca[bd]/;
  // Les voix les plus humaines (« Natural », « Neural », « Premium », « Enhanced », « Online », Siri).
  const NATURELLE = /natural|neural|premium|enhanced|amelioree|online|siri/;
  // Les voix de synthèse à l'ancienne (Eloquence d'Apple, eSpeak…) : en dernier recours.
  const MACHINE = /\b(?:eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|jacques|espeak|mbrola|pico|festival)\b/;

  /** Une voix est-elle française ? (« fr », « fr-FR », « fr_CA »…) */
  const francaise = (v) => /^fr(?:[-_]|$)/i.test(String((v && v.lang) || ''));
  /** Le genre d'une voix d'après son nom : 'homme', 'femme' ou '' (inconnu). */
  function genreVoix(v) {
    const nom = plat(v && v.name), id = plat(`${(v && v.voiceURI) || ''} ${(v && v.name) || ''}`);
    const mots = nom.split(/[^a-z0-9]+/).filter(Boolean);
    if (mots.some((m) => FEMMES.has(m)) || ANDROID_F.test(id) || /google francais/.test(nom)) return 'femme';
    if (mots.some((m) => HOMMES.has(m)) || ANDROID_H.test(id)) return 'homme';
    return '';
  }
  /** La note d'une voix française pour un genre voulu (plus c'est haut, mieux c'est). */
  function note(v, genre) {
    const nom = plat(`${(v && v.name) || ''} ${(v && v.voiceURI) || ''}`), g = genreVoix(v), lang = String(v.lang || '').replace('_', '-').toLowerCase();
    return (g === genre ? 40 : g ? -40 : 0)
      + (NATURELLE.test(nom) ? 20 : 0) + (/multilingual/.test(nom) ? 3 : 0) - (MACHINE.test(nom) ? 25 : 0) - (/compact/.test(nom) ? 5 : 0) - (/\beloise\b/.test(nom) ? 10 : 0)
      + (lang === 'fr-fr' || lang === 'fr' ? 6 : /^fr-(?:be|ch|lu|mc)$/.test(lang) ? 3 : 1)
      + (v.localService ? 2 : 0) + (v.default ? 1 : 0);
  }

  /**
   * La meilleure voix française du bon genre parmi `voix` (la liste de speechSynthesis.getVoices()).
   * Rend { voix, genre, hauteur, raison } : `voix` vaut null quand la liste n'a AUCUNE voix française
   * (raison : 'aucune-voix-francaise') ou qu'elle est vide (raison : 'liste-vide', le navigateur choisira d'après la langue).
   */
  function choisirVoix(voix, genre) {
    const voulu = genre === 'femme' ? 'femme' : 'homme';
    const liste = Array.from(voix || []);
    if (!liste.length) return { voix: null, genre: '', hauteur: 1, raison: 'liste-vide' };
    const fr = liste.filter(francaise);
    if (!fr.length) return { voix: null, genre: '', hauteur: 1, raison: 'aucune-voix-francaise' };
    const best = fr.map((v, i) => ({ v, i, n: note(v, voulu) })).sort((a, b) => b.n - a.n || a.i - b.i)[0].v;
    const g = genreVoix(best);
    // Hauteur naturelle (1). L'appareil n'a que des voix de l'autre genre : un léger décalage, pas une voix de robot.
    return { voix: best, genre: g, hauteur: g && g !== voulu ? (voulu === 'homme' ? 0.9 : 1.1) : 1, raison: '' };
  }

  /**
   * Règle une phrase à dire (SpeechSynthesisUtterance) : voix française du bon genre, langue, vitesse, hauteur, volume.
   * Rend false quand l'appareil a des voix mais aucune en français : mieux vaut se taire que lire avec un accent anglais.
   */
  function regler(phrase, voix, genre, reglages) {
    const c = choisirVoix(voix, genre), r = reglages || {};
    if (c.raison === 'aucune-voix-francaise') return false;
    phrase.lang = (c.voix && c.voix.lang) || 'fr-FR';
    if (c.voix) phrase.voice = c.voix;
    const vitesse = Number(r.rate), volume = Number(r.volume);
    phrase.rate = Number.isFinite(vitesse) && vitesse >= 0.5 && vitesse <= 2 ? vitesse : 1;
    phrase.pitch = c.hauteur;
    if (Number.isFinite(volume)) phrase.volume = Math.min(1, Math.max(0, volume));
    return true;
  }

  /** Secours quand le serveur ne répond pas : le plus gros des symboles retiré, pour ne pas les entendre. */
  function sansSymboles(texte) {
    return String(texte || '').replace(/```[\s\S]*?```/g, ' ').replace(/\[([^\]\n]+)\]\([^)\n]+\)/g, '$1').replace(/https?:\/\/\S+/g, ' ')
      .replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/^\s*[-*•+]\s+/gm, '').replace(/[*_`#>|~]+/g, ' ').replace(/\s*\n+\s*/g, '. ').replace(/\s+/g, ' ').replace(/\.\s*\./g, '.').trim();
  }

  const api = {
    genre: 'homme',
    /** La bonne forme d'un mot qui parle d'Odin : accord('prêt', 'prête'), accord('tout seul', 'toute seule'). */
    accord(masculin, feminin) { return api.genre === 'femme' ? feminin : masculin; },
    choisirVoix, regler, genreVoix, francaise, sansSymboles,
  };
  racine.OdinNaturel = api;
})();
