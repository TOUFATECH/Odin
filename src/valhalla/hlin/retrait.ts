// Gygès — comment faire retirer ce qui est visible : la marche à suivre selon le genre de site, les lettres RGPD
// (effacement art. 17, opposition art. 21, accès art. 15, relance), les guides de confidentialité par réseau, et
// le calcul des délais.
// Vérifié le 13/11/2026 dans le texte du RGPD (règlement (UE) 2016/679) et sur le site de la CNIL :
//   - art. 12 § 3 : réponse « dans un délai d'un mois à compter de la réception de la demande » ; « au besoin, ce
//     délai peut être prolongé de deux mois », en prévenant dans le premier mois ;
//   - CNIL : sans réponse au bout d'un mois, ou réponse insatisfaisante → plainte.
// Les adresses des formulaires ci-dessous sont celles que donnent la CNIL, Google et les annuaires eux-mêmes.
import { jourFr, type Fiche } from './fiches.ts';
import type { Resultat } from './traces.ts';

export const LIENS = {
  googleOutil: 'https://myactivity.google.com/results-about-you',
  googleAide: 'https://support.google.com/websearch/answer/12719076',
  googleFormulaire: 'https://support.google.com/legal/troubleshooter/1114905',
  googleObsolete: 'https://support.google.com/websearch/answer/6349986',
  bing: 'https://www.bing.com/webmaster/tools/eu-privacy-request',
  qwant: 'https://report.qwant.com/removal/fr',
  cnilDereferencement: 'https://cnil.fr/fr/le-dereferencement-dun-contenu-dans-un-moteur-de-recherche',
  cnilEffacement: 'https://cnil.fr/fr/comprendre-mes-droits/le-droit-leffacement-supprimer-vos-donnees-en-ligne',
  cnilContact: 'https://cnil.fr/fr/retrouver-les-coordonnees-dun-organisme-pour-exercer-vos-droits',
  cnilPlainte: 'https://www.cnil.fr/fr/adresser-une-plainte',
  listeRouge: 'https://www.118712.fr/faq/inscription-liste-rouge',
  annuaires: 'https://www.118712.fr/faq/supprimer-donnees-annuaire',
  truecaller: 'https://www.truecaller.com/unlisting',
  registre: 'https://www.infogreffe.fr/occultation-de-l-adresse-du-dirigeant-au-RCS',
  fuites: 'https://haveibeenpwned.com/',
  signalement: 'https://www.internet-signalement.gouv.fr',
  aide: 'https://www.cybermalveillance.gouv.fr',
} as const;

// ---------------------------------------------------------------- délais (RGPD, art. 12 § 3)
const deux = (n: number) => String(n).padStart(2, '0');
/** Le même jour, `n` mois plus tard (le 31 janvier + 1 mois = le dernier jour de février). Pur. */
export function plusMois(jourIso: string, n: number): string {
  const [y, m, d] = jourIso.slice(0, 10).split('-').map(Number), cible = new Date(Date.UTC(y, m - 1 + n, 1));
  const fin = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  return `${cible.getUTCFullYear()}-${deux(cible.getUTCMonth() + 1)}-${deux(Math.min(d, fin))}`;
}
export const plusJours = (jourIso: string, n: number) => new Date(Date.parse(`${jourIso.slice(0, 10)}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/** La réponse est due un mois après la réception ; trois mois si l'organisme a annoncé une prolongation. Pur. */
export const reponseAvant = (recue: string, prolongee = false) => plusMois(recue, prolongee ? 3 : 1);
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** « 2026-11-13 » → « 13 novembre 2026 ». Pur. */
export const jourEnLettres = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return `${d === 1 ? '1er' : d} ${MOIS[m - 1]} ${y}`; };

// ---------------------------------------------------------------- guides de confidentialité, par réseau
export interface Guide { nom: string; aide: string; etapes: string[] }
/** Un guide court par réseau : ce qu'il faut changer pour ne plus être visible de tous. Les noms des menus peuvent bouger un peu d'une version à l'autre. */
export const GUIDES: Record<string, Guide> = {
  snapchat: { nom: 'Snapchat', aide: 'https://help.snapchat.com/', etapes: [
    'Ouvre ton profil, puis la roue dentée (Paramètres), et descends jusqu\'aux réglages de confidentialité.',
    '« Me contacter » : choisis « Amis » (pas « Tout le monde »).',
    '« Voir ma story » : choisis « Amis ».',
    '« Me voir dans Ajout rapide » : décoche, pour ne plus être proposé à des inconnus.',
    '« Voir ma position » : active le « Mode Fantôme » (tu disparais de la carte Snap Map).',
    '« Numéro de mobile » : décoche « Permettre aux autres de me trouver grâce à mon numéro ».',
  ] },
  instagram: { nom: 'Instagram', aide: 'https://help.instagram.com/', etapes: [
    'Ouvre ton profil, puis le menu (les trois traits en haut à droite) → « Paramètres et activité ».',
    '« Confidentialité du compte » : active « Compte privé ». Seuls les abonnés que tu acceptes voient tes photos.',
    'Au même endroit, décoche « Autoriser les photos et vidéos publiques à apparaître dans les résultats de moteurs de recherche » (comptes professionnels).',
    'Dans ta bio : ni numéro, ni adresse. Avant de publier une photo, retire le lieu.',
    'Limite qui peut t\'identifier, te mentionner et t\'écrire aux personnes que tu suis.',
  ] },
  tiktok: { nom: 'TikTok', aide: 'https://support.tiktok.com/fr/', etapes: [
    'Ouvre ton profil, puis le menu (les trois traits) → « Paramètres et confidentialité » → « Confidentialité ».',
    'Active « Compte privé » : seuls les abonnés que tu acceptes voient tes vidéos.',
    '« Suggérer ton compte à d\'autres » : désactive tout (contacts, amis Facebook, personnes qui ont ton numéro).',
    'Coupe la synchronisation des contacts du téléphone.',
    'Règle qui peut commenter, t\'écrire, te mentionner et télécharger tes vidéos : « Amis » ou « Personne ».',
  ] },
  facebook: { nom: 'Facebook', aide: 'https://www.facebook.com/help/', etapes: [
    'Ouvre le menu → « Paramètres et confidentialité » → « Paramètres » → « Confidentialité ».',
    'Dans « Comment les autres peuvent vous trouver et vous contacter », réponds « Non » à « Voulez-vous que les moteurs de recherche en dehors de Facebook affichent votre profil ? ».',
    'Au même endroit : qui peut te trouver avec ton adresse e-mail et avec ton numéro → « Moi uniquement ».',
    '« Qui peut voir vos futures publications ? » → « Amis ». Puis « Limiter l\'audience des anciennes publications ».',
    'Cache ta liste d\'amis, ta date de naissance, ta ville et ton numéro (page « À propos » de ton profil).',
  ] },
  x: { nom: 'X (Twitter)', aide: 'https://help.x.com/fr', etapes: [
    'Ouvre « Paramètres et confidentialité » → « Confidentialité et sécurité ».',
    '« Audience, médias et identification » : coche « Protéger vos posts » (seuls tes abonnés les lisent) et coupe l\'identification sur les photos.',
    '« Détectabilité et contacts » : décoche « Permettre de me trouver grâce à mon adresse email » et « … grâce à mon numéro de téléphone ».',
    '« Informations de localisation » : désactive l\'ajout du lieu à tes posts, et efface les lieux déjà ajoutés.',
  ] },
};
export const RESEAUX = Object.values(GUIDES).map((g) => g.nom);
/** Le guide d'un réseau, par son nom ou l'adresse d'une de ses pages (« instagram.com/… »). Pur. */
export function guideDe(quoi: string): Guide | undefined {
  const k = quoi.toLowerCase();
  return /snap/.test(k) ? GUIDES.snapchat : /insta/.test(k) ? GUIDES.instagram : /tiktok/.test(k) ? GUIDES.tiktok : /facebook|fb\.com/.test(k) ? GUIDES.facebook : /(^|[^a-z])x(\.com|$| \()|twitter/.test(k) ? GUIDES.x : undefined;
}

// ---------------------------------------------------------------- la marche à suivre pour un résultat
const MOTEURS = `Dans Google : demande le retrait du résultat avec l'outil « Résultats vous concernant » (${LIENS.googleOutil}, s'il t'est proposé), sinon avec le formulaire de suppression (${LIENS.googleFormulaire}). Bing (${LIENS.bing}) et Qwant (${LIENS.qwant}) ont le leur.`;
const SUIVI = `Note ta demande dans l'onglet « Demandes » : le site a un mois pour répondre, et je te préviens si le délai est dépassé. Sans réponse, ou si la réponse ne te convient pas : plainte à la CNIL (${LIENS.cnilPlainte}).`;
const APRES = `Quand la page est retirée ou corrigée mais que Google la montre encore : demande sa mise à jour (« Actualiser un contenu obsolète », ${LIENS.googleObsolete}).`;
/**
 * Comment faire retirer un résultat, pas à pas, selon le genre de site. Toujours dans cet ordre : d'abord à la
 * source (le site), ensuite dans les moteurs de recherche, puis le suivi. Pur.
 */
export function procedure(r: Resultat, f: Fiche): string[] {
  if (r.genre === 'fuite') return [
    'Une fuite ne se retire pas : ces données ont été volées et circulent déjà.',
    r.montre.includes('mot de passe') ? 'Change tout de suite le mot de passe de ce site, et partout où tu avais mis le même (Thésauros sait en créer de solides).' : 'Par prudence, change le mot de passe de ce site.',
    'Active la double authentification sur ce compte.',
    ...(/logiciel espion/.test(r.raison) ? ['Un logiciel espion a pris ces identifiants sur un appareil : analyse-le avec l\'antivirus (Asclépios), puis change tes mots de passe depuis un appareil sain.'] : []),
    'Méfie-toi des messages qui citent ces informations pour te mettre en confiance (hameçonnage).',
    `Source : Have I Been Pwned (${LIENS.fuites}).`,
  ];
  if (r.genre === 'domaine') return [
    'N\'ouvre pas ce site pour y taper quoi que ce soit (identifiant, carte, mot de passe).',
    'Si ce nom est à toi (tu l\'as déposé pour te protéger) : ajoute-le aux domaines de la fiche, il ne sera plus signalé.',
    'Sinon, regarde qui l\'a déposé et chez qui : cherche « whois » suivi du nom (ou « RDAP »).',
    'S\'il imite ton site ou sert à envoyer de faux e-mails : signale-le au bureau d\'enregistrement du nom (son adresse « abuse »).',
    'Pour un nom en .fr, .yt ou .re, l\'AFNIC a une procédure de litige (SYRELI) ; pour un .com, .net ou .org, c\'est la procédure UDRP (OMPI).',
    `Un site d'hameçonnage se signale sur ${LIENS.signalement} ; préviens tes clients si de faux e-mails circulent. De l'aide : ${LIENS.aide}.`,
  ];
  if (f.genre === 'societe') {
    if (r.categorie === 'réseau social' && !r.officiel) return [
      'Vérifie d\'abord si ce compte est à toi (ancien compte, compte ouvert par un salarié). Si oui : ajoute-le aux comptes officiels de la fiche.',
      'Sinon, signale-le au réseau : ouvre le profil, menu « … » → « Signaler » → « Usurpation d\'identité » (ou « Il se fait passer pour une entreprise »).',
      'Garde des captures d\'écran (le profil, ses messages, la date).',
      'Préviens tes clients depuis tes comptes officiels.',
      `S'il y a une arnaque : dépose plainte, et demande de l'aide sur ${LIENS.aide}.`,
    ];
    if (r.categorie === 'avis') return [
      'Lis les avis, et réponds calmement et publiquement : les futurs clients lisent aussi tes réponses.',
      'Un avis faux, injurieux, ou qui vise une autre entreprise : signale-le à la plateforme (bouton « Signaler »), avec ta preuve.',
      'Garde une capture d\'écran de l\'avis avant de le signaler.',
    ];
    return ['Vérifie que le nom, l\'adresse, le numéro et les horaires sont les bons.', 'Pour corriger : cherche sur la page « Modifier », « Revendiquer cette fiche » ou « Vous êtes le dirigeant ? ».', 'Les informations du registre du commerce sont publiques par la loi : elles se corrigent au greffe, pas sur les sites qui les recopient.'];
  }
  const debut = r.incertain ? ['Ouvre d\'abord la page : l\'extrait ne montre aucun de tes identifiants. Si elle ne parle pas de toi : « Pas moi ».'] : [];
  const lettre = 'Demande l\'effacement au site : prépare la lettre (formulaire « Préparer une lettre ») et envoie-la à l\'adresse de contact de sa page « mentions légales » ou « confidentialité »';
  let source: string[];
  if (r.categorie === 'annuaire') source = /truecaller|sync\.me|getcontact|tellows/.test(r.site)
    ? [`Ces applis prennent les numéros dans le carnet d'adresses de leurs utilisateurs. Demande le retrait de ton numéro au site${/truecaller/.test(r.site) ? ` (Truecaller : ${LIENS.truecaller})` : ' (page « retirer mon numéro » ou « unlist »)'}.`, `${lettre}.`]
    : [`Demande la liste rouge à ton opérateur (gratuit, dans ton espace client) : elle retire tes coordonnées de tous les annuaires (${LIENS.listeRouge}).`, `Si la fiche reste : ${lettre.charAt(0).toLowerCase()}${lettre.slice(1)} (${LIENS.annuaires}).`];
  else if (r.categorie === 'revendeur de données') source = ['Cherche sur le site la page « opt out », « suppression » ou « ne pas vendre mes informations », et remplis-la.', `${lettre} : tu peux t'opposer à la revente de tes données sans donner de raison (article 21 du RGPD).`, 'Demande aussi d\'où il tient tes données (lettre « accès ») : tu sauras à qui écrire ensuite.'];
  else if (r.categorie === 'réseau social') { const g = guideDe(r.site); source = [`Si c'est ton compte : passe-le en privé${g ? ` (guide « ${g.nom} »)` : ' (réglages de confidentialité du réseau)'} et retire de ton profil numéro, adresse et lieu.`, 'Si quelqu\'un d\'autre a publié sur toi : demande-lui de retirer ; sinon signale la publication au réseau (« Signaler » → « Atteinte à la vie privée »).', 'Photos : retire le lieu et les identifications.']; }
  else if (r.categorie === 'presse') source = ['Un article de presse est protégé par la liberté d\'information : le journal n\'est pas obligé de l\'effacer.', 'Tu peux lui demander de retirer ton nom ou de mettre l\'article à jour (erreur, affaire close) : écris à la rédaction.', `Demande surtout aux moteurs de recherche de ne plus le montrer quand on tape ton nom (${LIENS.cnilDereferencement}).`];
  else if (r.categorie === 'registre de sociétés') source = ['Ces informations sont publiques par la loi (registre du commerce) : elles ne s\'effacent pas.', `Ton adresse personnelle de dirigeant, elle, peut être masquée : demande son occultation au greffe (${LIENS.registre}).`, 'Les sites qui recopient le registre doivent ensuite retirer ce qui n\'y figure plus : écris-leur si ce n\'est pas fait.'];
  else source = [`${lettre}. Pour trouver le bon contact : ${LIENS.cnilContact}.`];
  return [...debut, ...source, MOTEURS, APRES, SUIVI];
}

// ---------------------------------------------------------------- lettres RGPD
export type TypeLettre = 'effacement' | 'opposition' | 'accès' | 'relance';
export const OBJETS: Record<TypeLettre, string> = {
  effacement: 'demande d\'effacement de mes données personnelles (article 17 du RGPD)',
  opposition: 'opposition au traitement de mes données personnelles (article 21 du RGPD)',
  'accès': 'demande d\'accès à mes données personnelles (article 15 du RGPD)',
  relance: 'relance de ma demande restée sans réponse (RGPD)',
};
const DONNEE: Record<string, string> = { nom: 'mon nom', adresse: 'mon adresse postale', 'téléphone': 'mon numéro de téléphone', 'e-mail': 'mon adresse e-mail', pseudo: 'mon pseudonyme', ville: 'ma ville', 'photos possibles': 'des photos de moi', 'un autre numéro': 'un numéro de téléphone', 'une autre adresse postale': 'une adresse postale', 'une autre adresse e-mail': 'une adresse e-mail' };
export interface PourLettre { fiche: Fiche; type: TypeLettre; site: string; url?: string; montre?: string[]; /** le jour de la lettre (« 2026-11-13 ») */ jour: string; contact?: 'e-mail' | 'courrier'; /** pour une relance : la première demande */ premiere?: { type: TypeLettre; envoyee: string } }
/**
 * Une lettre RGPD remplie avec l'identité de la fiche, prête à signer. Elle ne donne au site que ce qu'il faut : le
 * nom, l'adresse de la page, et de quoi répondre (une adresse e-mail, ou l'adresse postale si tu veux une réponse
 * par courrier). Les données elles-mêmes ne sont pas recopiées : le site les a déjà, à l'adresse indiquée.
 * Texte en Markdown simple (le même sert au fichier texte, au Word et au PDF). Pur.
 */
export function lettre(o: PourLettre): { objet: string; texte: string } {
  const f = o.fiche; if (f.genre === 'societe') throw new Error('le RGPD protège les personnes, pas les sociétés : pour une société, signale le faux compte ou l\'avis à la plateforme (bouton « Comment le retirer »)');
  const objet = OBJETS[o.type], courrier = o.contact === 'courrier';
  if (courrier && !f.adresses[0]) throw new Error('pour une réponse par courrier, il faut une adresse postale dans la fiche');
  if (!courrier && !f.emails[0] && !f.adresses[0]) throw new Error('il faut une adresse e-mail (ou une adresse postale) dans la fiche pour que le site puisse répondre');
  const coordonnees = courrier || !f.emails[0] ? f.adresses[0] : `E-mail : ${f.emails[0]}`;
  const donnees = [...new Set((o.montre ?? []).map((m) => DONNEE[m]).filter(Boolean))];
  // La phrase se termine par l'adresse de la page, seule sur sa ligne (sans point : elle se copie telle quelle).
  const ici = o.url ? `, à cette adresse :\n${o.url}` : '.';
  const delai = 'Vous devez me répondre dans les meilleurs délais, et au plus tard un mois après avoir reçu cette demande (article 12, paragraphe 3, du RGPD). Sans réponse dans ce délai, ou si votre réponse ne me convient pas, je saisirai la Commission nationale de l\'informatique et des libertés (CNIL).';
  const identite = 'Si vous avez un doute raisonnable sur mon identité, dites-moi quelle information supplémentaire vous est nécessaire (article 12, paragraphe 6, du RGPD) : je ne joins pas de pièce d\'identité à cette demande.';
  let corps: string[];
  if (o.type === 'effacement') corps = [
    `Votre site ${o.site} publie des données personnelles qui me concernent${ici}`,
    ...(donnees.length ? [`Il s'agit de : ${donnees.join(', ')}.`] : []),
    'Je ne souhaite pas que ces données soient publiées. En application de l\'article 17, paragraphe 1, du règlement (UE) 2016/679 (RGPD), je vous demande de les effacer, pour les motifs suivants :',
    '- je m\'oppose à ce traitement pour des raisons tenant à ma situation particulière, la protection de ma vie privée et de ma sécurité (article 21, paragraphe 1), et il n\'existe pas de motif légitime impérieux de le poursuivre (article 17, paragraphe 1, point c) ;\n- si ces données servent à de la prospection, je m\'y oppose sans avoir à me justifier (article 21, paragraphe 2) ;\n- ces données ne sont pas nécessaires au regard des finalités pour lesquelles elles sont traitées (article 17, paragraphe 1, point a).',
    'Je vous demande aussi :',
    '- de retirer ces données de la page indiquée, ainsi que toute copie ;\n- d\'informer de cet effacement les destinataires à qui vous les avez communiquées (article 19) ;\n- puisque ces données ont été rendues publiques, de prévenir les autres responsables de traitement, dont les moteurs de recherche, que je demande l\'effacement de tout lien vers elles et de toute copie (article 17, paragraphe 2) ;\n- de me confirmer par écrit que c\'est fait.',
    delai, identite,
  ];
  else if (o.type === 'opposition') corps = [
    `Vous traitez des données personnelles qui me concernent${o.url ? `, visibles sur votre site ${o.site}${ici}` : ` (${o.site}).`}`,
    ...(donnees.length ? [`Il s'agit de : ${donnees.join(', ')}.`] : []),
    'En application de l\'article 21 du règlement (UE) 2016/679 (RGPD), je m\'oppose à ce traitement :',
    '- si ces données servent à de la prospection (publicité, démarchage, revente de fichiers), je m\'y oppose sans avoir à donner de raison : elles ne doivent plus être traitées à cette fin (article 21, paragraphes 2 et 3) ;\n- dans les autres cas, je m\'y oppose pour des raisons tenant à ma situation particulière : la protection de ma vie privée et de ma sécurité (article 21, paragraphe 1).',
    'Je vous demande donc de cesser ce traitement, de ne plus communiquer ces données à des tiers, et de me confirmer par écrit que c\'est fait.',
    delai, identite,
  ];
  else if (o.type === 'accès') corps = [
    `Je pense que vous traitez des données personnelles qui me concernent${o.url ? `, visibles sur votre site ${o.site}${ici}` : ` (${o.site}).`}`,
    'En application de l\'article 15 du règlement (UE) 2016/679 (RGPD), je vous demande :',
    '- de me confirmer si vous traitez des données personnelles me concernant ;\n- si oui, de m\'en adresser une copie (article 15, paragraphe 3) ;\n- de m\'indiquer les finalités du traitement, les catégories de données concernées, les destinataires à qui elles ont été ou seront communiquées, leur durée de conservation, et leur source, c\'est-à-dire d\'où vous les tenez (article 15, paragraphe 1).',
    'Cette demande est gratuite (article 12, paragraphe 5, du RGPD).',
    delai, identite,
  ];
  else {
    if (!o.premiere) throw new Error('une relance suit une première demande : note d\'abord la date d\'envoi de la demande');
    corps = [
      `Le ${jourEnLettres(o.premiere.envoyee)}, je vous ai adressé une ${OBJETS[o.premiere.type]}${o.url ? `, au sujet de cette adresse :\n${o.url}` : `, au sujet de votre site ${o.site}.`}`,
      'Le délai d\'un mois prévu par l\'article 12, paragraphe 3, du règlement (UE) 2016/679 (RGPD) est dépassé. Je n\'ai reçu ni réponse, ni information sur une prolongation de ce délai.',
      'Je vous demande de donner suite à ma demande sans attendre. Sans réponse de votre part sous quinze jours, je déposerai une réclamation auprès de la Commission nationale de l\'informatique et des libertés (CNIL), en y joignant la copie de mes courriers.',
    ];
  }
  const texte = [
    f.nom, ...(coordonnees ? [coordonnees] : []), '',
    'À l\'attention du délégué à la protection des données', '(ou du service chargé des données personnelles)', o.site, '',
    `${f.villes[0] ? `Fait à ${f.villes[0]}, le` : 'Le'} ${jourEnLettres(o.jour)}`, '',
    `**Objet : ${objet}**`, '',
    'Madame, Monsieur,', '',
    ...corps.flatMap((p) => [p, '']),
    'Je vous prie d\'agréer, Madame, Monsieur, mes salutations distinguées.', '',
    f.nom,
  ].join('\n');
  return { objet, texte };
}
/** Le rappel affiché avec chaque demande : ce que dit la règle, en clair. Pur. */
export const REGLE_DELAI = 'Le site a un mois pour répondre, à partir du jour où il reçoit ta demande (RGPD, article 12). Il peut prendre deux mois de plus si la demande est compliquée, mais il doit te prévenir dans le premier mois. Sans réponse : relance, puis plainte à la CNIL.';
export const dateCourte = jourFr;
