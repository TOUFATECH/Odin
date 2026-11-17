// Pygmalion — les limites, posées dans le code. Elles s'appliquent à TOUTE demande, avant de produire quoi que ce soit :
//   - anti-trucage : toute demande de voix, de visage, d'audio ou de vidéo qui NOMME une personne (n'importe où dans la
//     demande) ou la désigne (« ma sœur », « le président », « l'acteur ») est refusée, quelle que soit la tournure ; seul
//     un personnage DIT inventé passe. Un animal, un dragon, une ville, « mon personnage » ne sont pas des personnes ;
//   - les faux documents, par CATÉGORIE : ceux qu'un organisme seul délivre (paie, relevé bancaire, RIB, impôt,
//     identité, justificatif de domicile, certificat de scolarité, diplôme, ordonnance, état civil…) toujours, sauf quand
//     la demande en PARLE (un résumé, un tableau de suivi, une présentation sur…) ; une facture, une attestation, un
//     certificat… quand ils sont dits faux, officiels, à l'en-tête ou au tampon d'un autre, ou au nom d'un organisme ;
//   - une œuvre demandée en entier (chanson, livre, chapitre d'un livre, paroles…) et le logo d'une marque : s'inspirer,
//     résumer, écrire une œuvre originale, mon logo, mon en-tête : oui ;
//   - rien qui se fasse passer pour une vraie photo ou un vrai enregistrement.
// C'est un FILTRE DE MOTS, prudent mais pas infaillible, et il le dit à l'écran. Il lit le français, l'anglais et
// l'espagnol (LANGUES_FILTRE) ; une demande dans une autre langue ne passe pas en silence : elle est refusée en le disant
// (le plus prudent), puisque le filtre ne peut pas la vérifier — même courte, quand la langue est incertaine et que la
// demande n'est pas faite surtout de mots qu'il connaît. La langue est reconnue par le reconnaisseur commun d'Odin
// (src/langue/reconnaitre.ts). Une demande refusée dit pourquoi, en clair.
import { reconnaitre } from '../../langue/reconnaitre.ts';
import { langues } from '../../langue/tables.ts';
import type { Palier } from './types.ts';

/** Les langues que le filtre lit aujourd'hui (codes du reconnaisseur de langue d'Odin). */
export const LANGUES_FILTRE: ReadonlySet<string> = new Set(['fr', 'en', 'es']);
const NOMS_LANGUES = 'français, anglais et espagnol';
const NOTE = ` (Ce refus vient d'un filtre de mots, prudent mais pas infaillible ; il lit aujourd'hui ces langues : ${NOMS_LANGUES}.)`;

/** Minuscules, sans accents, œ → oe, ponctuation et apostrophes en espaces, entouré d'espaces. */
const plat = (t: string) => ` ${String(t ?? '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

const ens = (s: string) => new Set(s.split(/\s+/).filter(Boolean));
/** Déterminants (et contractions « du », « au », « del »…) : ce qui suit est un nom commun, pas un nom de personne. */
const DET = ens('le la les l un une des du au aux mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs ce cet cette ces the a an my your his her its our their this that these those some el los las una unos unas mi mis tu tus su sus nuestro nuestra nuestros nuestras vuestro vuestra este esta estos estas ese esa esos esas aquel aquella del al lo');
const A_MOI = ens('mon ma mes notre nos my our mi mis nuestro nuestra nuestros nuestras');
const INDEFINI = ens('un une des a an some una unos unas');
/** Pronoms : « comme je veux », « like you said » ne désignent personne. */
const PRONOMS = ens('je j tu il elle on nous vous ils elles moi toi lui eux ca cela ceci i you he she we they it me him them yo ella nosotros vosotros ellos ellas usted ustedes esto eso');
/** Noms communs qui désignent une personne réelle : après un déterminant (« ma sœur », « au président », « l'acteur »), refusés. */
const PERSONNES = ens([
  'soeur frere mere pere maman papa femme mari epouse epoux fils fille enfant enfants bebe cousin cousine oncle tante neveu niece mamie papi voisin voisine patron patronne chef collegue ami amie copain copine prof professeur professeure maitre maitresse president presidente ministre maire roi reine prince princesse pape depute deputee senateur senatrice directeur directrice medecin docteur avocat avocate juge policier gendarme employeur proprietaire banquier conseiller conseillere',
  'acteur actrice chanteur chanteuse comedien comedienne journaliste presentateur presentatrice animateur animatrice vedette celebrite influenceur influenceuse youtubeur youtubeuse sportif sportive joueur joueuse footballeur rappeur rappeuse politicien politicienne humoriste',
  'sister brother mother father mom mum dad wife husband son daughter child kid baby cousin uncle aunt nephew niece grandma grandpa grandmother grandfather neighbor neighbour boss colleague coworker friend teacher president minister mayor king queen prince princess pope senator governor director manager doctor lawyer judge officer landlord employer',
  'actor actress singer comedian journalist presenter anchor celebrity influencer youtuber athlete footballer rapper politician',
  'hermana hermano madre padre mama papa esposa esposo marido hijo hija nino nina primo prima tio tia sobrino sobrina abuela abuelo vecino vecina jefe jefa colega amigo amiga profesor profesora presidenta ministro ministra alcalde alcaldesa rey reina principe princesa senador directora medico medica doctora abogado abogada juez policia',
  'actriz cantante comediante periodista presentador presentadora famoso famosa celebridad deportista jugador jugadora futbolista rapero rapera politico politica',
].join(' '));
/** Noms communs qui suivent « voix de », « visage de » sans être une personne (« une voix de robot ») ; « quelqu'un ». */
const GENERIQUES = ens([
  'robot robots synthese enfant enfants homme femme bebe garcon fille fillette vieillard ange monstre dragon animal chat chien oiseau perroquet fantome sorciere sorcier pirate extraterrestre narrateur narratrice conteur conteuse personnage heros heroine geant geante lutin fee elfe nain chevalier off mort foule machine ordinateur quelqu chacun personne celui celle ceux moi',
  'child man woman boy girl angel monster cat dog bird parrot ghost witch wizard alien narrator storyteller character hero giant elf dwarf knight reason someone somebody anyone everyone people computer',
  'hombre mujer chico chica anciano anciana angel monstruo gato perro pajaro loro fantasma bruja brujo pirata extraterrestre narrador narradora personaje heroe heroina gigante alguien',
].join(' '));
const PREP = ens('de d du des of from del a au aux pour for para en in sur on avec with dans con por que qui that which');
/** Après ces mots, un nom est un lieu ou un destinataire (« à Paris », « pour Lina »), pas la personne qu'on fait parler. */
const LIEU_OU_DESTINATAIRE = ens('a au aux en in at to pour for para chez vers');
/** Les verbes de parole : « Lina annonce… » (un nom en tête de phrase, suivi d'un de ces verbes, est une personne). */
const PAROLE = ens('dit disent annonce annoncent declare parle chante avoue lit explique affirme raconte insulte confesse appelle crie says said announces announced admits sings reads speaks declares confesses tells calls yells dice anuncia canta habla admite declara confiesa lee llama grita');

const mots = (s: string) => s.trim().split(' ').filter(Boolean);
/** Ce que désignent les mots qui suivent : un nom propre, une personne désignée, ou autre chose. `det` : un déterminant est sous-entendu (« du », « au »). */
function designe(suite: string[], det = false): 'nom' | 'designee' | 'chose' {
  let i = 0;
  if (!det) {
    const w = suite[0];
    if (!w) return 'chose';
    if (GENERIQUES.has(w) || PRONOMS.has(w) || /^\d/.test(w)) return 'chose';
    if (!DET.has(w)) return PREP.has(w) ? 'chose' : 'nom'; // un nom propre, en majuscules ou non : « lina varek », « Paulo »
    i = 1;
  }
  for (let k = i; k < Math.min(suite.length, i + 3); k++) {
    if (PREP.has(suite[k])) break;
    if (PERSONNES.has(suite[k])) return 'designee';
  }
  return 'chose';
}
const personne = (s: string[], det = false) => designe(s, det) !== 'chose';
/** Le sujet d'un verbe (« où Lina Varek annonce », « make my neighbor say ») : nommé, désigné, ou non. */
const sujet = (s: string) => personne(mots(s));

/** Les mots de la demande telle qu'écrite (pour les majuscules) : forme plate, majuscule initiale, sigle, début de phrase. */
interface Jeton { w: string; p: string; maj: boolean; sigle: boolean; debut: boolean }
function jetons(brut: string): Jeton[] {
  const out: Jeton[] = [];
  let debut = true;
  for (const m of String(brut ?? '').matchAll(/[\p{L}\p{N}]+|[.!?…\n\r«»“”"„]/gu)) {
    const w = m[0];
    if (!/[\p{L}\p{N}]/u.test(w)) { debut = true; continue; }
    out.push({ w, p: plat(w).trim(), maj: /^\p{Lu}/u.test(w) && /\p{Ll}/u.test(w), sigle: w.length >= 2 && /\p{Lu}/u.test(w) && !/\p{Ll}/u.test(w), debut });
    debut = false;
  }
  return out;
}
/** Un mot courant, même écrit avec une majuscule (« Vidéo », « Chat », « Mon ») : pas un nom de personne. */
const courant = (p: string) => DET.has(p) || PREP.has(p) || PRONOMS.has(p) || GENERIQUES.has(p) || PERSONNES.has(p) || lexique().has(p) || MEDIA.test(` ${p} `) || PHOTO.test(` ${p} `);
/** Ce mot est-il un nom propre de personne (« Paulo », « Varek ») ? Une majuscule hors début de phrase, ou en début de phrase suivie d'un autre nom ou d'un verbe de parole. */
function nomPropre(js: Jeton[], i: number): boolean {
  const j = js[i];
  if (!j.maj || courant(j.p)) return false;
  if (i > 0 && LIEU_OU_DESTINATAIRE.has(js[i - 1].p)) return false;
  if (!j.debut) return true;
  const s = js[i + 1];
  return Boolean(s && !s.debut && ((s.maj && !courant(s.p)) || PAROLE.has(s.p)));
}

const W = '[\\p{L}\\p{N}]+';
const SUITE = `((?: ${W}){1,5})`;
const re = (s: string) => new RegExp(s, 'gu');

// « voix de X », « visage du X », « voice of X », « voz de X »…
const FENTES_DE = re(`\\b(?:voix|visage|tete|figure|portrait|timbre|imitation(?: vocale)?|sosie|clone|clonage|voice|face|head|likeness|impression|impersonation|lookalike|voz|cara|rostro|cabeza|imitacion|retrato|clon)(?: (?:vocale|exacte|parfaite))? (de|d|du|des|of|del)${SUITE}`);
// « fais parler X », « fais chanter X »
const FAIS_PARLER = re(`\\b(?:fais|fait|faire|faites|fasse) (?:parler|chanter)${SUITE}`);
// « fais dire … à X »
const FAIS_DIRE = re(`\\b(?:fais|fait|faire|faites|fasse) (?:dire|annoncer|lire|avouer|declarer|crier|repeter)\\b(?: ${W}){0,12}? (a|au|aux)${SUITE}`);
// « make X say », « haz que X diga »
const FAIRE_DIRE_SUJET = [
  re(`\\b(?:make|let|have|get) ((?:${W} ){1,3})(?:say|says|sing|speak|announce|read|admit|tell|confess)\\b`),
  re(`\\bhaz(?:me)? que ((?:${W} ){1,3})(?:diga|cante|hable|anuncie|lea|confiese|admita)\\b`),
];
// « où X dit », « where X says », « donde X dice » (dans une demande d'audio, de vidéo, de voix…)
const OU_DIT = [
  re(`\\b(?:ou|dans lequel|dans laquelle|dans lesquels) ((?:${W} ){1,3})(?:dit|disent|annonce|annoncent|declare|parle|chante|avoue|lit|explique|affirme|raconte|insulte|confesse|appelle|crie)\\b`),
  re(`\\b(?:where|in which) ((?:${W} ){1,3})(?:says|said|announces|announced|admits|sings|reads|speaks|declares|confesses|tells|calls|yells)\\b`),
  re(`\\b(?:donde|en el que|en la que) ((?:${W} ){1,3})(?:dice|anuncia|canta|habla|admite|declara|confiesa|lee|llama|grita)\\b`),
];
// « imite X », « imitate X », « imita X »
const IMITE = re(`\\b(?:imite|imiter|imitez|imitation de|clone|cloner|clonez|imitate|impersonate|mimic|imita|imitar|clona|clonar)${SUITE}`);
// « mets ma tête à la place de celle de X », « échange les visages avec celui de X »
const CELUI_DE = re(`\\b(?:celui|celle|ceux|celles|that) (de|d|du|des|of)${SUITE}`);
// « Orsa Kandel's face » (l'apostrophe est devenue une espace)
const POSSESSIF_EN = re(`((?: ${W}){1,3}) s (?:voice|face|head|likeness)\\b`);
// « un audio de lina varek qui annonce… », « a video of x saying… » (un nom en minuscules, suivi d'une parole)
const MEDIA_DE_PAROLE = re(`\\b(?:audio|audios|video|videos|enregistrement|podcast|clip|film|voix|recording|voice|grabacion|voz) (?:de|d|du|of|del|con|with|avec|by|par)((?: ${W}){1,4}?) (?:qui|que|who|en train|announcing|saying|telling|admitting|diciendo|anunciando|admitiendo|disant|annoncant|avouant|parlant|chantant|singing|speaking|hablando|cantando)\\b`);
// « chante comme X », « sound like X », « canta como X »
const COMME = re(`\\b(?:comme|like|como)${SUITE}`);
/** Une demande de voix, d'audio, de vidéo, de visage, de chant. */
const MEDIA = /\b(voix|vocal|vocale|vocaux|audio|audios|sonore|enregistrement|enregistre|podcast|video|videos|film|clip|visage|visages|tete|tetes|appel|chante|chanter|chantant|deepfake|voice|voices|recording|record|face|faces|head|call|voicemail|sing|sings|singing|sound|sounds|voz|voces|grabacion|graba|pelicula|cara|caras|rostro|rostros|llamada|canta|cantar|cantando)\b/;
/** Une image : une personne nommée juste après (« une photo de Lina Varek ») est refusée. */
const PHOTO = /\b(photo|photos|photographie|image|images|picture|pictures|foto|fotos|imagen|imagenes)\b/;
const VISAGE_OU_VOIX = /\b(visage|visages|tete|tetes|voix|face|faces|head|heads|voice|cara|caras|rostro|rostros|cabeza|voz)\b/;
const TRUCAGE = /\b(deep ?fakes?|trucages?|face ?swap|faceswap|clonage vocal|clone vocal|voice clon\w*|clonacion de voz)\b/;
const INVENTE = /\b(invente|inventee|inventes|inventees|imaginaire|imaginaires|fictif|fictive|fictifs|fictives|invented|imaginary|fictional|made up|inventado|inventada|imaginario|imaginaria|ficticio|ficticia)\b/;

/** Une personne désignée par un nom commun (« ma sœur », « l'acteur », « the president ») — pas un destinataire (« pour mon patron »). */
function designee(t: string): boolean {
  const m = mots(t);
  for (let i = 0; i < m.length; i++) {
    if (!PERSONNES.has(m[i])) continue;
    for (const d of [i - 1, i - 2]) {
      if (d < 0 || !DET.has(m[d]) || INDEFINI.has(m[d])) continue;
      if (['au', 'aux'].includes(m[d]) || LIEU_OU_DESTINATAIRE.has(m[d - 1] ?? '')) break;
      return true;
    }
  }
  return false;
}

function trucage(t: string, brut: string): boolean {
  if (TRUCAGE.test(t)) return true;
  if (INVENTE.test(t)) return false;
  const media = MEDIA.test(t);
  const js = jetons(brut);
  // un nom propre N'IMPORTE OÙ dans une demande de voix, d'audio, de vidéo, de visage ou de chant ; une personne désignée
  if (media && js.some((_, i) => nomPropre(js, i))) return true;
  if ((media || PHOTO.test(t)) && designee(t)) return true;
  // une image d'une personne nommée : « une photo de Lina Varek »
  for (let i = 0; i + 2 < js.length; i++) {
    if (!PHOTO.test(` ${js[i].p} `) || !['de', 'd', 'of', 'del', 'avec', 'with', 'con'].includes(js[i + 1].p)) continue;
    if (nomPropre(js, i + 2)) return true;
  }
  // les tournures, qui attrapent aussi un nom écrit en minuscules
  for (const m of t.matchAll(FENTES_DE)) if (personne(mots(m[2]), ['du', 'des', 'del'].includes(m[1]))) return true;
  for (const m of t.matchAll(FAIS_PARLER)) if (personne(mots(m[1]))) return true;
  // « fais dire … à X » : une personne désignée (« au président »), ou un nom dans une demande d'audio ou de vidéo ;
  // « dans mon histoire, fais dire à Zélie… » (un texte) passe
  for (const m of t.matchAll(FAIS_DIRE)) {
    const d = designe(mots(m[2]), m[1] !== 'a');
    if (d === 'designee' || (d === 'nom' && media)) return true;
  }
  for (const r of FAIRE_DIRE_SUJET) for (const m of t.matchAll(r)) if (sujet(m[1])) return true;
  if (media) for (const r of OU_DIT) for (const m of t.matchAll(r)) if (sujet(m[1])) return true;
  if (media) for (const m of t.matchAll(MEDIA_DE_PAROLE)) if (personne(mots(m[1]))) return true;
  if (media) for (const m of t.matchAll(COMME)) if (personne(mots(m[1]))) return true;
  for (const m of t.matchAll(IMITE)) if (personne(mots(m[1]))) return true;
  if (VISAGE_OU_VOIX.test(t)) for (const m of t.matchAll(CELUI_DE)) if (personne(mots(m[2]), ['du', 'des'].includes(m[1]))) return true;
  for (const m of t.matchAll(POSSESSIF_EN)) {
    const avant = mots(m[1]);
    const d = avant.findLastIndex((w) => DET.has(w));
    if (d < 0 ? !GENERIQUES.has(avant[avant.length - 1]) : avant.slice(d + 1).some((w) => PERSONNES.has(w))) return true;
  }
  return false;
}

// ------------------------------------------------------------------ faux documents
/** Ce qu'un organisme seul délivre : jamais fabriqué par Odin, même sans le mot « faux ». */
const DELIVRES = new RegExp('\\b(' + [
  'fiches? de (paie|paye|salaire)', 'bulletins? de (paie|paye|salaire|notes)', 'releves? (bancaires?|de comptes?|de banque|d identite bancaire|de notes)', 'rib', 'avis d (impot|imposition)s?',
  '(carte|piece)s? d identite', 'cartes? vitale', 'carte grise', 'passeports?', 'permis de (conduire|sejour)', 'titres? de sejour', 'diplomes?', 'ordonnances?( medicales?)?',
  'certificats? medicaux?', 'certificat medical', 'arrets? (de travail|maladie)', 'actes? de (naissance|mariage|deces)', 'casier judiciaire', 'extrait kbis', 'kbis', 'feuilles? de soins',
  'justificatifs? de (domicile|revenus?|ressources|residence)', 'certificats? de (scolarite|residence|travail|domicile)', 'attestations? (employeur|de travail|d emploi|de salaire|de securite sociale|d assurance maladie|pole emploi|france travail|caf)',
  'factures? (d electricite|d eau|de gaz|de telephone|d energie)',
  'pay ?slips?', 'pay ?stubs?', 'bank statements?', 'account statements?', 'tax (notice|assessment|bill)s?', 'id cards?', 'identity (card|document)s?', 'passports?', 'driv(er|ers|ing) licen[cs]es?',
  'residence permits?', 'work permits?', 'diplomas?', 'degree certificates?', 'academic transcripts?', 'prescriptions?', 'medical certificates?', 'sick notes?', 'doctor s notes?',
  '(birth|marriage|death) certificates?', 'criminal records?', 'social security cards?', 'utility bills?', '(electricity|water|gas|phone|energy) bills?', 'proofs? of (address|residence|income|employment|identity)',
  '(employment|income|salary|enrollment|enrolment) verification( letters?)?', 'letters? of employment', 'certificates? of (enrollment|enrolment|residence|employment)',
  'nominas?', 'recibos? de (sueldo|nomina|salario)', 'extractos? (bancarios?|de cuenta|del banco)', 'estados? de cuenta', '(documento|carnet|tarjeta)s? de identidad', 'dni', 'pasaportes?',
  '(carnet|licencia|permiso)s? de conducir', 'permisos? de residencia', 'titulos? universitarios?', 'recetas? medicas?', 'certificados? medicos?', 'bajas? medicas?',
  '(partida|acta|certificado)s? de (nacimiento|matrimonio|defuncion)', 'antecedentes penales', 'facturas? de (la )?(luz|agua|gas|electricidad|telefono)',
  'certificados? de (empadronamiento|escolaridad|estudios|residencia|trabajo|empresa)', 'empadronamiento', 'justificantes? de (domicilio|ingresos)', 'vida laboral',
].join('|') + ')\\b', 'g');
/** Une demande qui PARLE de ces pièces (« un résumé de mes relevés », « une présentation sur les permis ») ne les fabrique pas. */
const TOPIQUE = ens('resume resumer summary summarize summarise resumen resumir tableau suivi table tracker tabla seguimiento analyse analyser analysis analyze analisis analizar liste list lista checklist inventaire inventory inventario essai essay article expose presentation presentacion cours lesson leccion lecon affiche poster cartel guide guia explication explanation explicacion remise ceremonie ceremony graduation classement rangement');
/** « bulletin de notes pour ma classe » : l'enseignant, pour ses élèves. */
const CLASSE = ens('classe eleves class students pupils clase alumnos');
/** Le mot qui dit « faux » : avec lui, aucune exemption. */
const FAUX_MOTS = ens('faux fausse fausses falsifie falsifiee falsifies falsifiees falsifier contrefait contrefaits contrefaite contrefaites contrefacon fake fakes forged forgery counterfeit falsified falso falsa falsos falsas falsificado falsificada falsificados falsificadas falsificar');
/** Ce qui fait « officiel » : refusé, sauf quand c'est le mien (« le tampon de mon entreprise », « mon en-tête »). */
const MARQUE_MOTS = ens('officiel officiels officielle officielles entete tampon tampons cachet cachets sceau sceaux official letterhead stamp stamps seal seals oficial oficiales membrete sello sellos');
/** Documents ordinaires… sauf dits faux, officiels, à l'en-tête / au tampon d'un autre. */
const PIECE_MOTS = ens('facture factures devis quittance quittances attestation attestations certificat certificats contrat contrats recu recus justificatif justificatifs document documents lettre lettres courrier courriers papier papiers invoice invoices receipt receipts quote quotes certificate certificates contract contracts letter letters factura facturas recibo recibos presupuesto presupuestos certificado certificados constancia constancias justificante justificantes contrato contratos carta cartas documento documentos');
/** Les pièces qu'un organisme émet : « une attestation de la CAF », « une facture ZORBEX à mon nom » sont refusées. */
const PIECE_ORG = ens('facture factures attestation attestations certificat certificats justificatif justificatifs quittance quittances recu recus releve releves invoice invoices bill bills receipt receipts certificate certificates statement statements factura facturas recibo recibos certificado certificados constancia constancias justificante justificantes');

function delivre(t: string): boolean {
  const faux = mots(t).some((w) => FAUX_MOTS.has(w));
  for (const m of t.matchAll(DELIVRES)) {
    if (faux) return true;
    const avant = mots(t.slice(0, m.index)).slice(-5);
    const apres = mots(t.slice((m.index ?? 0) + m[0].length)).slice(0, 4);
    if (avant.some((w) => TOPIQUE.has(w))) continue;
    if (avant.length >= 2 && ['avec', 'with', 'con'].includes(avant[avant.length - 2]) && A_MOI.has(avant[avant.length - 1])) continue; // « mon CV avec mes diplômes »
    if (['drug', 'drugs', 'price', 'prices', 'prix', 'precio', 'precios', 'photo', 'photos'].includes(apres[0] ?? '')) continue; // « prescription drug », « passport photo »
    if (/^(bulletins? de notes|releves? de notes)$/.test(m[1]) && apres.some((w) => CLASSE.has(w))) continue;
    return true;
  }
  return false;
}

function faussePiece(t: string): boolean {
  const m = mots(t.replace(/ en tete /g, ' entete ').replace(/ (copie conforme|a l identique) /g, ' faux '));
  for (let i = 0; i < m.length; i++) {
    if (!PIECE_MOTS.has(m[i])) continue;
    for (let j = Math.max(0, i - 6); j < Math.min(m.length, i + 7); j++) {
      if (j === i) continue;
      if (FAUX_MOTS.has(m[j])) return true;
      if (MARQUE_MOTS.has(m[j]) && !A_MOI.has(m[j - 1] ?? '') && !m.slice(j + 1, j + 4).some((w) => A_MOI.has(w))) return true;
    }
  }
  return false;
}

/** La pièce d'un organisme : « une attestation de la CAF », « une facture ZORBEX », « … à mon nom ». */
function pieceDunAutre(t: string, brut: string): boolean {
  const js = jetons(brut);
  const org = (j: Jeton | undefined) => Boolean(j && !j.debut && (j.sigle || (j.maj && !courant(j.p))));
  let piece = false;
  for (let i = 0; i < js.length; i++) {
    if (!PIECE_ORG.has(js[i].p)) continue;
    piece = true;
    if (org(js[i + 1])) return true;
    if (['de', 'd', 'from', 'del', 'of'].includes(js[i + 1]?.p ?? '')) {
      let k = i + 2;
      if (['la', 'le', 'l', 'les', 'the', 'el'].includes(js[k]?.p ?? '')) k++;
      if (org(js[k])) return true;
    }
  }
  return piece && /\b(a mon nom|in my name|a mi nombre)\b/.test(t);
}

// ------------------------------------------------------------------ œuvres et marques
const OEUVRES = /^(chansons?|livres?|romans?|chapitres?|paroles|poemes?|scenarios?|films?|bd|mangas?|articles?|albums?|partitions?|episodes?|songs?|lyrics|books?|novels?|chapters?|poems?|scripts?|screenplays?|movies?|comics?|canciones|cancion|letras?|libros?|novelas?|capitulos?|poemas?|guion|guiones|peliculas?|articulos?|episodios?)$/;
const EN_ENTIER = /\b(en entier|entier|entiere|entierement|integral|integrale|integralement|integralite|complet|complete|completes|completement|mot a mot|mot pour mot|a l identique|tel quel|recopie|recopier|reproduis|reproduire|retranscris|retranscrire|in full|full|whole|entire|entirely|complete|word for word|verbatim|copy|reproduce|transcribe|entero|entera|completo|completa|integro|integra|palabra por palabra|al pie de la letra|copia|reproduce|transcribe)\b/;
const RESUME = /\b(resum\w*|summar\w*|analys\w*|analiz\w*)\b/;
const PAROLES = /\b(paroles|lyrics|letra)\b/;
const LOGO_DE = re(`\\blogos? (?:de|d|du|des|of|from|del)${SUITE}`);
const LE_LOGO = re(`\\b(?:le|la|les|the|el) logos? (${W})`);
/** Après l'œuvre, ces mots disent qu'on en écrit une originale : « des paroles sur la mer », « lyrics about my dog ». */
const SUJET_DE = ens('sur about on sobre pour for para');

/** L'œuvre est-elle à quelqu'un d'autre ? « une chanson », « mon roman », « les paroles d'une chanson sur la mer » : non. */
function aUnAutre(m: string[], i: number): boolean {
  const avant = m.slice(Math.max(0, i - 2), i);
  if (avant.some((w) => INDEFINI.has(w) || A_MOI.has(w))) return false;
  const apres = m.slice(i + 1, i + 4);
  if (SUJET_DE.has(apres[0] ?? '')) return false;
  const p = apres.findIndex((w) => PREP.has(w));
  if (p >= 0 && (A_MOI.has(apres[p + 1] ?? '') || INDEFINI.has(apres[p + 1] ?? ''))) return false;
  return true;
}

/** « le chapitre 1 de Les Lanternes… », « chapter 1 of The… », « le chapitre 3 du livre… » : le chapitre d'une œuvre. « le chapitre 3 du rapport annuel » : non. */
function chapitreDuneOeuvre(brut: string): boolean {
  const js = jetons(brut);
  for (let i = 0; i < js.length; i++) {
    if (!/^(chapitres?|chapters?|capitulos?)$/.test(js[i].p)) continue;
    for (let k = i + 1; k < Math.min(js.length, i + 7); k++) {
      if (A_MOI.has(js[k].p)) break;
      if (OEUVRES.test(js[k].p) || (js[k].maj && !js[k].debut)) return true;
    }
  }
  return false;
}

function oeuvre(t: string, brut: string): boolean {
  if (INVENTE.test(t)) return false;
  const m = mots(t);
  if (EN_ENTIER.test(t) && m.some((w, i) => OEUVRES.test(w) && aUnAutre(m, i))) return true;
  if (!RESUME.test(t)) {
    if (chapitreDuneOeuvre(brut)) return true;
    const i = m.findIndex((w) => PAROLES.test(w));
    if (i >= 0 && aUnAutre(m, i)) return true;
  }
  for (const x of t.matchAll(LOGO_DE)) if (!A_MOI.has(mots(x[1])[0] ?? '')) return true;
  for (const x of t.matchAll(LE_LOGO)) {
    if (PREP.has(x[1]) || A_MOI.has(x[1])) continue;
    // « le logo et le tampon de mon entreprise » : le mien
    const suite = mots(t.slice((x.index ?? 0) + x[0].length - x[1].length - 1)).slice(0, 7);
    if (suite.some((w, k) => PREP.has(w) && A_MOI.has(suite[k + 1] ?? ''))) continue;
    return true;
  }
  // « le texte complet de L'Étranger », « toute la pièce Le Cid » : le texte entier d'une œuvre au titre écrit en majuscules
  if (EN_ENTIER.test(t) || /\b(tout|toute|all|toda|todo)\b/.test(t)) {
    const js = jetons(brut);
    for (let i = 0; i < js.length; i++) {
      if (!/^(texte|textes|texto|textos|text|piece|pieces|play|obra|obras)$/.test(js[i].p)) continue;
      if (js.slice(i + 1, i + 5).some((j) => j.maj && !j.debut && !courant(j.p))) return true;
    }
  }
  if (/\b(?:the|a|an) \p{Lu}[\p{L}\p{N}-]* logos?\b/u.test(brut)) return true; // « the Zorbex logo »
  return false;
}

// ------------------------------------------------------------------ langue
/** Mots courants des langues lues : petits mots d'Odin, mots du filtre, mots des documents. Une demande d'une langue incertaine doit en être faite surtout. */
const DOCS = [
  'document fichier fiche liste note notes memo rapport compte rendu bilan budget devis facture lettre courrier tableau planning agenda menu recette programme projet plan resume carte invitation affiche annonce contrat cv presentation diaporama inventaire suivi journal calendrier horaire courses annuel annuelle mensuel hebdomadaire secret secrete nouveau nouvelle brouillon titre texte page semaine mois jour annee anniversaire fete reunion mariage voyage vacances ecole travail maison famille ecris fais cree redige prepare genere ajoute mets merci',
  'document file list note notes memo report summary budget quote invoice letter table schedule plan agenda menu recipe program project card invitation poster contract resume presentation slides inventory tracker journal calendar timetable shopping annual monthly weekly secret new draft title text page week month day year birthday party meeting wedding trip holidays school work home family write make create prepare generate add thanks',
  'documento archivo lista nota notas informe resumen presupuesto factura carta tabla horario plan agenda menu receta programa proyecto tarjeta invitacion cartel contrato curriculum presentacion inventario seguimiento diario calendario compras anual mensual semanal secreto nuevo nueva borrador titulo texto pagina semana mes dia ano cumpleanos fiesta reunion boda viaje vacaciones escuela trabajo casa familia escribe haz crea prepara genera gracias',
].join(' ');
let lex: Set<string> | undefined;
function lexique(): Set<string> {
  if (lex) return lex;
  lex = new Set<string>();
  for (const s of [DET, A_MOI, PRONOMS, PERSONNES, GENERIQUES, PREP, PAROLE, TOPIQUE, PIECE_MOTS, FAUX_MOTS, ens(DOCS)]) for (const w of s) lex.add(w);
  for (const code of LANGUES_FILTRE) {
    const t = langues().get(code);
    for (const w of [...(t?.petitsMots ?? []), ...(t?.indices ?? [])]) for (const x of mots(plat(w))) lex.add(x);
  }
  return lex;
}
const surtoutConnus = (ws: string[]) => ws.filter((w) => lexique().has(w)).length * 2 > ws.length;
/**
 * La langue de la demande, quand le filtre ne la lit pas. Langue sûre hors de ses langues : refusée. Langue incertaine
 * (demande courte) : acceptée seulement si elle est faite surtout de mots qu'il connaît — ou, sans les noms propres
 * (« liste des invités : Paulo, Zélie… »), si le reste est à la fois connu et reconnu comme une de ses langues.
 * `titre` : un titre choisi pour un fichier (« Compost ») — une langue incertaine n'y est vérifiée qu'à partir de 4 mots.
 */
function langueNonLue(brut: string, titre: boolean): string | undefined {
  const js = jetons(brut);
  const compte = (l: Jeton[]) => l.map((j) => j.p).filter((p) => p.length >= 2 && !/^\d+$/.test(p));
  const tous = compte(js);
  const sansNoms = js.filter((j) => !(j.maj && !j.debut) && !j.sigle);
  const texteSansNoms = sansNoms.map((j) => j.w).join(' ');
  const l = reconnaitre(brut);
  if (l.langue) {
    if (LANGUES_FILTRE.has(l.langue)) return undefined;
    const l2 = reconnaitre(texteSansNoms);
    return l2.langue && LANGUES_FILTRE.has(l2.langue) ? undefined : (l.nom ?? l.langue);
  }
  if (!tous.length || (titre && tous.length < 4)) return undefined;
  if (surtoutConnus(tous)) return undefined;
  const reste = compte(sansNoms);
  const h = reconnaitre(texteSansNoms).hypothese;
  // un seul mot connu suffit quand chaque nom écarté suit une préposition (« Lettre à Zélie ») ; sinon, deux au moins
  // (« Une Gehaltsabrechnung » n'est pas « une » suivi d'un nom)
  const nomsApresPrep = js.every((j, i) => !(j.maj && !j.debut) || j.sigle || (i > 0 && (PREP.has(js[i - 1].p) || LIEU_OU_DESTINATAIRE.has(js[i - 1].p))));
  if ((reste.length >= 2 || (reste.length === 1 && nomsApresPrep)) && surtoutConnus(reste) && h && LANGUES_FILTRE.has(h)) return undefined;
  return (l.hypothese && LANGUES_FILTRE.has(l.hypothese)) ? 'une langue que je ne reconnais pas sûrement' : (l.nom ?? 'une langue que je ne reconnais pas');
}

/** Les mêmes règles de faux documents, pour le CONTENU d'un document (son titre et son début) : un faux bulletin titré « Document » ne passe pas. */
export function refusContenu(entete: string): string | undefined {
  const t = plat(entete);
  if (delivre(t) || faussePiece(t) || pieceDunAutre(t, entete)) return REFUS_FAUX;
  return undefined;
}
const REFUS_FAUX = `refusé : Odin ne fabrique pas de faux document, ni rien qui imite un document officiel ou la pièce d'un autre (paie, relevé bancaire, RIB, impôt, identité, justificatif de domicile, certificat, diplôme, ordonnance, état civil ; facture, attestation ou certificat dits faux, officiels, à l'en-tête ou au tampon d'un autre, ou au nom d'un organisme).${NOTE}`;

/**
 * Une raison de refus, ou undefined si la demande peut être produite. `o.titre` : le texte est un titre choisi pour un
 * fichier, pas la demande de quelqu'un (une langue incertaine n'y est vérifiée qu'à partir de 4 mots).
 */
export function refus(demande: string, o: { titre?: boolean } = {}): string | undefined {
  const brut = String(demande ?? '');
  const t = plat(brut);
  if (trucage(t, brut)) return `refusé : Odin ne fabrique ni la voix, ni le visage, ni un audio ou une vidéo d'une personne réelle, nommée ou désignée (anti-trucage). Il peut produire une voix ou un visage inventés, présentés comme tels : si c'est un personnage inventé, dis-le (« personnage inventé »).${NOTE}`;
  if (delivre(t) || faussePiece(t) || pieceDunAutre(t, brut)) return REFUS_FAUX;
  if (oeuvre(t, brut)) return `refusé : Odin ne reproduit pas une œuvre protégée (en entier, un chapitre, des paroles) ni la marque ou le logo de quelqu'un d'autre. Il peut écrire une œuvre originale, s'en inspirer librement, ou en faire un court résumé.${NOTE}`;
  if (/\b(comme|presente[rz]? comme|fais passer pour) (une )?(vraie|veritable) (photo|photographie|video|enregistrement)\b/.test(t)) {
    return 'refusé : une création d\'Odin est toujours marquée comme telle, jamais présentée comme une vraie photo, une vraie vidéo ou un vrai enregistrement.';
  }
  // Une langue que le filtre ne lit pas : il ne peut rien vérifier, donc rien ne passe en silence.
  const nom = langueNonLue(brut, Boolean(o.titre));
  if (nom) {
    return `refusé : cette demande semble écrite en ${nom} ; le filtre de Pygmalion (anti-trucage, œuvres protégées, faux documents) ne lit pas encore cette langue — il lit aujourd'hui ces langues : ${NOMS_LANGUES}. Plutôt que de produire sans avoir pu vérifier, Odin ne produit rien : redis la demande dans une de ces langues.`;
  }
  return undefined;
}

/** La marque d'une création, en clair. */
export const MARQUE = 'création d\'Odin';
export const texteMarque = (quand: Date): string => `${MARQUE[0].toUpperCase()}${MARQUE.slice(1)}, fabriquée le ${quand.toLocaleDateString('fr-FR')} — pas une œuvre d'une autre origine.`;

/**
 * Les paliers, du plus faisable au moins faisable, dits honnêtement. La machine de la maison (petit processeur, pas de
 * carte graphique) fait très peu et très lentement de génération par réseau de neurones : on ne promet jamais un studio.
 */
export const PALIERS: Palier[] = [
  { id: 'documents', nom: 'Fichiers et documents', etat: 'fait', texte: `Word, Excel, PowerPoint, OpenDocument, PDF, HTML, XML, RTF, Markdown, CSV, JSON, archives zip et tar.gz : écrits dans Odin, relus par ses propres lecteurs. Pas encore ouverts dans un vrai logiciel de bureautique. Chaque demande passe d'abord par un filtre de mots (anti-trucage, œuvres protégées, faux documents), prudent mais pas infaillible ; il lit aujourd'hui ces langues : ${NOMS_LANGUES}, et une demande dans une autre langue n'est pas produite.` },
  { id: 'texte', nom: 'Texte et code', etat: 'prevu', texte: 'Rédiger à partir de ce qu\'Odin a appris lui-même (Noûs), sources citées ; le code n\'est essayé que dans le bac à sable.' },
  { id: 'graphes', nom: 'Graphes et schémas', etat: 'prevu', texte: 'Courbes, barres, schémas en SVG écrits dans Odin : faisable et rapide ici.' },
  { id: 'images', nom: 'Images', etat: 'lent', texte: 'Retouche et montage simples : faisables. Générer une image par un réseau de neurones : TRÈS lent sur ce processeur (petites images, la nuit, temps mesuré et affiché).' },
  { id: 'son', nom: 'Son et audio', etat: 'prevu', texte: 'Montage et encodage (MP3, WAV, FLAC, AAC, OGG, Opus) par l\'outil média local : faisables. Générer une musique : limité et lent.' },
  { id: 'film', nom: 'Film image par image', etat: 'prevu', texte: 'Assembler des images d\'Odin, du son et des sous-titres en MP4 : faisable (un assemblage, pas une scène filmée).' },
  { id: 'video-generee', nom: 'Vidéo générée par un réseau', etat: 'hors_de_portee', texte: 'Inventer une scène filmée demande une grosse carte graphique : pas réaliste sur cette machine. Une place est prévue si, un jour, elle en a une.' },
];
