// Odin : homme ou femme. UN seul réglage (« voice.gender » dans la configuration) commande la voix ET le texte :
// les accords des phrases où Odin parle de lui (prêt / prête, sûr / sûre, tout seul / toute seule…).
//
// Ici, rien que du texte, sans rien lire ni écrire sur le disque :
//  - lire le genre dit ou écrit (« femme », « F », « une voix d'homme ») et la demande faite en parlant ;
//  - `accord('prêt', 'prête')` pour les phrases toutes faites ;
//  - `accorder(texte)` : le filet qui rattrape « je suis prêt » dans un texte déjà écrit (réponse d'une appli,
//    oubli du modèle), sans toucher à ce qui est cité entre guillemets ;
//  - la consigne donnée au modèle.
// Le genre en cours est lu à la demande dans la configuration de l'Odin qui tourne (`brancherGenre`).

export type Genre = 'homme' | 'femme';
/** Tant que personne n'a choisi (installation sans question, ancienne configuration). */
export const GENRE_PAR_DEFAUT: Genre = 'homme';

const plat = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, '\'').replace(/\s+/g, ' ').trim();

/** Comprend un choix dit ou écrit : « femme », « F », « 2 », « féminin », « une voix d'homme »… Rien si ce n'est pas clair. Pur. */
export function lireGenre(x: unknown): Genre | undefined {
  const t = plat(String(x ?? '')).replace(/[.!?]+$/, '');
  if (!t) return undefined;
  if (/^(?:f|2|femme|une femme|feminin|feminine|fille|elle|voix (?:de femme|feminine)|une voix (?:de femme|feminine)|woman|female)$/.test(t)) return 'femme';
  if (/^(?:h|m|1|homme|un homme|masculin|masculine|garcon|il|lui|voix (?:d'homme|masculine)|une voix (?:d'homme|masculine)|man|male)$/.test(t)) return 'homme';
  return undefined;
}

let source: (() => unknown) | undefined;
/** Dit où lire le genre en cours (la configuration de l'Odin qui tourne). Sans rien : la valeur par défaut. */
export function brancherGenre(lire?: () => unknown): void { source = lire; }
/** Le genre d'Odin en ce moment. */
export function genreCourant(): Genre { try { return lireGenre(source?.()) ?? GENRE_PAR_DEFAUT; } catch { return GENRE_PAR_DEFAUT; } }
/** Le genre écrit dans une configuration (le seul endroit : voice.gender). */
export function genreOdin(cfg: { voice?: { gender?: unknown } } | undefined): Genre { return lireGenre(cfg?.voice?.gender) ?? GENRE_PAR_DEFAUT; }

/** La bonne forme d'un mot qui parle d'Odin : `accord('prêt', 'prête')`, `accord('tout seul', 'toute seule')`. */
export function accord(masculin: string, feminin: string, g: Genre = genreCourant()): string { return g === 'femme' ? feminin : masculin; }

/**
 * Une demande faite en parlant, phrase seule : « prends une voix de femme », « parle comme un homme », « sois une femme »,
 * « voix masculine », « reprends ta voix d'homme ». Rend le genre voulu, ou rien (« ma femme veut une idée » n'en est pas une). Pur.
 */
export function commandeGenre(text: string): Genre | undefined {
  const t = plat(text).replace(/[.!?\s]+$/, '').replace(/^(?:dis |ok |hey |he )?odin[\s,]+/, '').replace(/^(?:s'il te plait|stp|svp)[\s,]+/, '').replace(/[\s,]+(?:s'il te plait|stp|svp|merci)$/, '');
  if (t.length > 80) return undefined;
  const fin = '(?: desormais| maintenant| a partir de maintenant| des maintenant| pour toujours| tout le temps)?';
  const tu = '(?:tu peux |peux[- ]tu |est-ce que tu peux |j\'aimerais que tu |je veux que tu |je voudrais que tu |je prefere que tu )?';
  const parle = '(?:parle(?:[- ]moi)?|parler|reponds(?:[- ]moi)?|repondre|exprime[- ]toi)';
  const prends = '(?:prends?|prendre|reprends?|reprendre|mets?|mettre|utilise[sr]?|choisi[sr]|garde[sr]?|aies?|avoir|je veux|je voudrais|je prefere|j\'aimerais|passe[sr]? (?:a|sur|en)|change[sr]? pour)';
  const m = new RegExp(`^${tu}(?:${parle} (?:avec|d')|${prends})?\\s*(?:(?:une|ta|la|ton) )?voix (?:d'|de )(homme|femme)${fin}$`).exec(t)
    ?? new RegExp(`^${tu}(?:${parle} avec|${prends})?\\s*(?:(?:une|ta|la) )?voix (masculin|feminin)e?${fin}$`).exec(t)
    ?? new RegExp(`^${tu}(?:${parle}|sois|etre|deviens|devenir|redeviens|redevenir) (?:comme )?une? (homme|femme)${fin}$`).exec(t)
    ?? new RegExp(`^${tu}(?:${parle}|accorde[- ]toi) au (masculin|feminin)${fin}$`).exec(t)
    ?? new RegExp(`^(?:je te (?:veux|prefere|voudrais)|j'aimerais t'avoir|je prefere quand tu es) (?:en |comme )?(?:une? )?(homme|femme)${fin}$`).exec(t);
  return m ? (/^(?:femme|feminin)/.test(m[1]) ? 'femme' : 'homme') : undefined;
}

// ---------------------------------------------------------------- Le filet : « je suis prêt » → « je suis prête »

/** Les mots qui ne font pas leur féminin en ajoutant « e » à un « é ». */
const FEMININS: Record<string, string> = {
  prêt: 'prête', sûr: 'sûre', content: 'contente', ravi: 'ravie', heureux: 'heureuse', certain: 'certaine', seul: 'seule', inquiet: 'inquiète',
  curieux: 'curieuse', fier: 'fière', attentif: 'attentive', présent: 'présente', absent: 'absente', prudent: 'prudente', surpris: 'surprise',
  confus: 'confuse', perdu: 'perdue', revenu: 'revenue', venu: 'venue', devenu: 'devenue', parvenu: 'parvenue', intervenu: 'intervenue',
  parti: 'partie', reparti: 'repartie', sorti: 'sortie', convaincu: 'convaincue', déçu: 'déçue', mis: 'mise', remis: 'remise', pris: 'prise',
  repris: 'reprise', descendu: 'descendue', tenu: 'tenue', retenu: 'retenue', aperçu: 'aperçue', servi: 'servie', endormi: 'endormie',
  ouvert: 'ouverte', satisfait: 'satisfaite', conscient: 'consciente', impatient: 'impatiente', reconnaissant: 'reconnaissante', partant: 'partante',
  interrompu: 'interrompue', rabattu: 'rabattue', souvenu: 'souvenue', averti: 'avertie', muni: 'munie',
  administrateur: 'administratrice', nouveau: 'nouvelle', soucieux: 'soucieuse', sérieux: 'sérieuse',
};
/** Après « je suis », ces mots en « é » ne sont pas des participes : on n'y touche pas. */
const PAS_UN_ACCORD = new Set(['côté', 'privé', 'café', 'marché', 'été']);
/** « je me suis … » : seulement les verbes où le participe s'accorde avec « je » (pas « je me suis permis », « dit », « rendu compte »). */
const PRONOMINAUX = new Set(['arrêté', 'trompé', 'mis', 'remis', 'connecté', 'reconnecté', 'déconnecté', 'installé', 'relancé', 'redémarré', 'occupé', 'chargé', 'perdu',
  'endormi', 'réveillé', 'levé', 'couché', 'assuré', 'appuyé', 'basé', 'inspiré', 'servi', 'aperçu', 'lancé', 'limité', 'concentré', 'débrouillé', 'renseigné', 'adapté',
  'réglé', 'synchronisé', 'branché', 'replié', 'rabattu', 'contenté', 'fié', 'méfié', 'inquiété', 'absenté', 'souvenu', 'borné', 'tenu', 'retenu', 'penché', 'adressé',
  'dépêché', 'planté', 'emmêlé', 'embrouillé', 'égaré', 'préparé', 'organisé', 'corrigé', 'repris', 'arrangé', 'retrouvé', 'retiré', 'coupé', 'bloqué', 'précipité']);

const L = '\\p{L}';
const ADV = '(?:pas|plus|jamais|bien|très|trop|vraiment|déjà|encore|toujours|tout|si|assez|plutôt|un peu|aussi|donc|enfin|maintenant|presque|tellement|peut-être|sans doute|désormais|à nouveau|de nouveau|quand même|pourtant|vite|juste)';
const MOT = `[${L}]+`;
/** « je suis », « je ne suis pas », « je me suis », « je reste », « je me sens », « j'ai été », « je vais être »… */
const VERBE = '(?<etre>suis|serai|serais|étais|sois)|reste|resterai|restais|sens|deviens|redeviens|parais|semble'
  + '|ai(?:\\s+(?:pas|bien|déjà|toujours|jamais))*\\s+été|aurai\\s+été|avais\\s+été'
  + '|(?:vais|viens\\s+d[\'’]|dois|peux|veux|voudrais|préfère|pense|crois|devrais|pourrais|espère|compte|risque\\s+d[\'’])\\s*(?:(?:pas|plus|bien)\\s+)*être';
/** Le verbe, des adverbes, le mot à accorder, et parfois un second après « et ». */
const JE_SUIS = new RegExp(
  `(?<![${L}])(?<debut>(?:je|j['’])\\s*(?:ne\\s+|n['’]\\s*)?(?:(?<me>me|m['’])\\s*)?(?:${VERBE})(?:\\s+${ADV})*\\s+)(?<mot>${MOT})`
  + `(?:(?<lien>(?:\\s*,\\s*(?:(?:et|ou|mais|puis)\\s+)?|\\s+(?:et|ou|mais|puis)\\s+)(?:${ADV}\\s+)*)(?<mot2>${MOT}))?(?![${L}'’-])`, 'giu');
/** Sans « je » : « Désolé, … », « Ravi de … », « Content que … » en tête de phrase ; « …, désolé. » après une virgule. */
const SUITE = `(?=\\s*[,.!…)]|\\s+(?:de|d['’]|que|qu['’]|pour|si|mais)(?![${L}]))`;
const EN_TETE = new RegExp(`(?<=^|[.!?…:]\\s+|\\n\\s*|[\\p{Extended_Pictographic}\\uFE0F]\\s*)(Désolé|Navré|Enchanté|Ravi|Content|Heureux)${SUITE}`, 'gu');
const EXCUSE = new RegExp(`(?<=[,;(]\\s*|[–—]\\s+)(désolé|navré)${SUITE}`, 'gu');

function feminin(mot: string, pronominal = false): string {
  const bas = mot.toLowerCase();
  if (pronominal && !PRONOMINAUX.has(bas)) return mot;
  const f = FEMININS[bas] ?? (bas.endsWith('é') && bas.length > 2 && !PAS_UN_ACCORD.has(bas) ? `${bas}e` : undefined);
  if (!f) return mot;
  return mot === bas ? f : mot === mot.toUpperCase() ? f.toUpperCase() : f.charAt(0).toUpperCase() + f.slice(1);
}

/** Ce qui est cité (« … », "…") ou écrit en code n'est pas la parole d'Odin : on n'y touche pas. */
const HORS_PAROLE = /```[\s\S]*?```|`[^`\n]*`|«[^»\n]*»|"[^"\n]*"|“[^”\n]*”/g;

/**
 * Accorde au genre d'Odin ce qu'il dit de lui dans un texte déjà écrit : « je suis prêt » → « je suis prête »,
 * « je me suis arrêté là » → « arrêtée », « Désolé, … » → « Désolée, … ». Pour un homme, le texte ressort tel quel
 * (les phrases d'Odin sont écrites au masculin). Pur.
 */
export function accorder(texte: string, g: Genre = genreCourant()): string {
  if (g !== 'femme' || !texte) return texte;
  const dehors = (t: string) => t
    .replace(JE_SUIS, (...a: unknown[]) => {
      const p = a.at(-1) as { debut: string; me?: string; etre?: string; mot: string; lien?: string; mot2?: string };
      // « je me suis … » : le participe ne s'accorde que pour certains verbes ; « je me sens prête » s'accorde toujours.
      const un = feminin(p.mot, Boolean(p.me && p.etre));
      if (un === p.mot) return String(a[0]);
      // « tout seul » → « toute seule » (devant une consonne, « tout » s'accorde aussi).
      const debut = /^[bcdfgjklmnpqrstvwxz]/i.test(un) ? p.debut.replace(/(\s)tout(\s+)$/i, '$1toute$2') : p.debut;
      return `${debut}${un}${p.lien && p.mot2 ? `${p.lien}${feminin(p.mot2)}` : ''}`;
    })
    .replace(EN_TETE, (mot: string) => feminin(mot))
    .replace(EXCUSE, (mot: string) => feminin(mot));
  let out = '', i = 0;
  for (const m of texte.matchAll(HORS_PAROLE)) { out += dehors(texte.slice(i, m.index)) + m[0]; i = m.index + m[0].length; }
  return out + dehors(texte.slice(i));
}

// ---------------------------------------------------------------- La consigne donnée au modèle

/** Ce que le modèle doit savoir : qui parle, et comment il s'accorde. Placée juste après la personnalité. */
export function consigneGenre(g: Genre): string {
  return g === 'femme'
    ? `## Qui tu es quand tu parles : une femme
Tu t'appelles Odin et tu es une femme : tu parles de toi au féminin, partout et sans exception. Accorde chaque adjectif et chaque participe qui te concerne : « je suis prête », « contente », « sûre », « désolée », « ravie », « je suis allée voir », « je me suis trompée », « je l'ai fait toute seule ». Jamais « je suis prêt » ni « désolé ». Tu gardes ton nom. Tu n'en parles pas de toi-même : c'est juste ta façon d'être.`
    : `## Qui tu es quand tu parles : un homme
Tu t'appelles Odin et tu es un homme : tu parles de toi au masculin, partout et sans exception. Accorde chaque adjectif et chaque participe qui te concerne : « je suis prêt », « content », « sûr », « désolé », « ravi », « je suis allé voir », « je me suis trompé », « je l'ai fait tout seul ». Tu n'en parles pas de toi-même : c'est juste ta façon d'être.`;
}
