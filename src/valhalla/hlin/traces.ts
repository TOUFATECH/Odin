// Gygès — « où j'apparais » : les recherches préparées pour une fiche (nom entre guillemets et ville, numéro,
// e-mail, pseudo, rue), le classement de chaque résultat (annuaire, revendeur de données, réseau social, presse,
// registre de sociétés, avis, autre), ce qu'il montre (adresse, numéro, e-mail…), son niveau de risque avec la
// raison, et la comparaison d'un mois sur l'autre (nouveau, toujours là, retiré).
// Les listes de sites sont écrites pour Odin (aucune liste reprise d'un autre projet). Tout est pur : les
// recherches elles-mêmes passent par Pythie, dans le module.
import { createHash } from 'node:crypto';
import { formesTel, plat, rueDe, telephone, type Fiche } from './fiches.ts';

export type Categorie = 'annuaire' | 'revendeur de données' | 'réseau social' | 'presse' | 'registre de sociétés' | 'avis' | 'fuite connue' | 'domaine qui imite' | 'autre';
export type Niveau = 'faible' | 'moyen' | 'élevé';
export type Motif = 'nom' | 'téléphone' | 'e-mail' | 'pseudo' | 'adresse' | 'société' | 'avis' | 'domaine';
export interface Requete { cle: string; q: string; motif: Motif; valeur: string }
export interface Resultat {
  id: string; fiche: string; genre: 'web' | 'profil' | 'fuite' | 'domaine';
  url: string; site: string;
  /** titre et extrait : toujours rangés masqués (numéros, e-mails et rues n'y figurent jamais en entier) */
  titre: string; extrait: string;
  categorie: Categorie; montre: string[];
  /** les valeurs de la fiche que la page montre, déjà masquées (« 06 •• •• •• 12 ») : pour savoir lequel de tes numéros est visible */
  details?: string[];
  /** les recherches qui l'ont trouvé (empreintes) : sert à savoir s'il a vraiment disparu */
  par: string[];
  risque: Niveau; raison: string;
  /** « à vérifier » : le site ne répond pas clairement sans connexion, le lien est à ouvrir soi-même */
  etat: 'présent' | 'retiré' | 'ignoré' | 'à vérifier';
  pourquoi?: string; vu: string; revu: string; retire?: string; nouveau?: boolean; incertain?: boolean; officiel?: boolean;
}

export const empreinte = (t: string) => createHash('sha1').update(t).digest('hex').slice(0, 10);
const RANG: Record<Niveau, number> = { faible: 0, moyen: 1, élevé: 2 };
export const plusGrave = (a: Niveau, b: Niveau): Niveau => (RANG[a] >= RANG[b] ? a : b);

// ---------------------------------------------------------------- recherches préparées
/** La ville d'une adresse (après le code postal, sinon après la dernière virgule). Pur. */
export const villeDe = (a: string) => (/\b\d{5}\b\s*([^,]+)/.exec(a)?.[1] ?? (a.includes(',') ? a.split(',').pop()! : '')).trim().slice(0, 60);
/**
 * Les recherches à lancer pour une fiche, 20 au plus : chaque identifiant entre guillemets (recherche exacte).
 * Elles ne sortent que d'une fiche : il n'existe pas de recherche « libre » sur un nom. Pur.
 */
export function requetes(f: Fiche): Requete[] {
  const out: Requete[] = [], add = (motif: Motif, q: string, valeur: string) => { if (!out.some((r) => r.q === q)) out.push({ cle: empreinte(q), q, motif, valeur }); };
  if (f.genre === 'societe') {
    for (const n of [f.nom, ...f.noms].slice(0, 2)) { add('société', `"${n}"${f.villes[0] ? ` ${f.villes[0]}` : ''}`, n); add('avis', `"${n}" avis`, n); }
    for (const d of f.domaines.slice(0, 3)) add('domaine', `"${d}" -site:${d}`, d);
  } else {
    for (const [k, n] of [f.nom, ...f.noms].slice(0, 3).entries()) {
      const villes = f.villes.slice(0, 2);
      if (villes.length) for (const v of villes) add('nom', `"${n}" ${v}`, n); else add('nom', `"${n}"`, n);
      // Les annuaires écrivent souvent « NOM Prénom ».
      if (k === 0 && f.prenom && f.famille) add('nom', `"${f.famille} ${f.prenom}"${villes[0] ? ` ${villes[0]}` : ''}`, n);
    }
    for (const t of f.telephones) { const [a, b] = formesTel(t); if (a) add('téléphone', b && b !== a ? `"${a}" OR "${b}"` : `"${a}"`, t); }
    for (const e of f.emails) add('e-mail', `"${e}"`, e);
    for (const a of f.adresses) { const r = rueDe(a), v = villeDe(a); if (r.length >= 5) add('adresse', `"${r}"${v ? ` ${v}` : ''}`, a); }
  }
  for (const p of f.pseudos) add('pseudo', `"${p}"`, p);
  return out.slice(0, 20);
}

// ---------------------------------------------------------------- classement
const CONNUS: Array<[Categorie, string]> = [
  ['annuaire', 'pagesjaunes.fr pagesblanches.fr 118712.fr 118000.fr 118218.fr infobel.com annu.com tellows.fr truecaller.com sync.me getcontact.com copainsdavant.linternaute.com trombi.com justacote.com'],
  ['revendeur de données', 'spokeo.com whitepages.com beenverified.com intelius.com peoplefinders.com radaris.com mylife.com truepeoplesearch.com fastpeoplesearch.com pipl.com peekyou.com webmii.com yasni.fr yasni.com lusha.com rocketreach.co zoominfo.com apollo.io contactout.com signalhire.com kaspr.io nuwber.com clustrmaps.com thatsthem.com idcrawl.com'],
  ['réseau social', 'facebook.com instagram.com tiktok.com snapchat.com x.com twitter.com threads.net threads.com linkedin.com youtube.com pinterest.com pinterest.fr reddit.com twitch.tv t.me telegram.me vk.com tumblr.com mastodon.social bsky.app github.com gitlab.com dailymotion.com vimeo.com soundcloud.com flickr.com medium.com strava.com linktr.ee gravatar.com'],
  ['registre de sociétés', 'societe.com pappers.fr infogreffe.fr verif.com annuaire-entreprises.data.gouv.fr bodacc.fr manageo.fr kompass.com infonet.fr rubypayeur.com northdata.fr opencorporates.com entreprises.lefigaro.fr score3.fr'],
  ['avis', 'trustpilot.com avis-verifies.com custplace.com tripadvisor.fr tripadvisor.com yelp.fr yelp.com glassdoor.fr glassdoor.com indeed.com petitfute.com g.page'],
  ['presse', 'lemonde.fr lefigaro.fr liberation.fr leparisien.fr ouest-france.fr 20minutes.fr francetvinfo.fr franceinfo.fr bfmtv.com lexpress.fr lepoint.fr mediapart.fr lequipe.fr sudouest.fr ladepeche.fr lavoixdunord.fr france24.com rfi.fr linfo.re clicanoo.re zinfos974.com imazpress.com mayottehebdo.com lejournaldemayotte.yt kwezi.fr'],
];
const PAR_SITE = new Map<string, Categorie>(CONNUS.flatMap(([c, l]) => l.split(' ').map((d) => [d, c] as [string, Categorie])));
export const siteDe = (url: string) => { try { return new URL(url).hostname.toLowerCase().replace(/^(www|m|mobile)\./, ''); } catch { return ''; } };
/** La catégorie d'un résultat d'après son adresse : site connu d'abord, sinon ce que dit le nom du site. Pur. */
export function classer(url: string): { categorie: Categorie; site: string } {
  const site = siteDe(url), parts = site.split('.');
  for (let k = 0; k < parts.length - 1; k++) { const c = PAR_SITE.get(parts.slice(k).join('.')); if (c) return { categorie: c, site }; }
  let chemin = ''; try { chemin = new URL(url).pathname; } catch { /* adresse illisible */ }
  if (/^(maps\.)?google\.[a-z.]+$/.test(site) && (site.startsWith('maps.') || chemin.startsWith('/maps'))) return { categorie: 'avis', site };
  if (/annuaire|pages-?blanches|118\d{3}|whitepages|qui-?appelle|numero/.test(site)) return { categorie: 'annuaire', site };
  if (/\bavis\b|review|trust/.test(site.replace(/[.-]/g, ' '))) return { categorie: 'avis', site };
  if (/journal|(^| )infos?( |$)|news|hebdo|(^| )actu|presse|gazette|tribune|quotidien|radio|(^| )tv( |$)|media/.test(site.replace(/[.-]/g, ' '))) return { categorie: 'presse', site };
  return { categorie: 'autre', site };
}

// ---------------------------------------------------------------- ce qu'un résultat montre
export interface Vu { nom: boolean; ville: boolean; telephones: string[]; emails: string[]; pseudos: string[]; adresses: string[]; domaines: string[]; autres: string[] }
const mots = (t: string) => ` ${plat(t).replace(/[^a-z0-9@]+/g, ' ').trim()} `;
const TEL = /(?<![\w@./:-])(?:(?:\+|00)\d(?:[\s.\-]?\d){7,13}|0[1-9](?:[\s.\-]?\d{2}){4})(?![\w@/:-])/g;
const MAIL = /[^\s@<>"',;()]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,24}/gi;
const RUE = /\b\d{1,4}\s*(?:bis|ter|quater)?\s*,?\s*(?:rue|avenue|boulevard|chemin|impasse|all[ée]e|route|place|quai|lotissement|r[ée]sidence)\s+[^,;:\n()«»"]{2,40}/giu;
/**
 * Ce qu'un texte (titre, extrait, adresse de la page) contient de la fiche : son nom, sa ville, ses numéros (quelle
 * que soit l'écriture), ses e-mails, ses pseudos, ses rues ; et les coordonnées qui n'y sont pas (« autres »). Pur.
 */
export function voir(f: Fiche, texte: string, url = ''): Vu {
  const t = mots(`${texte} ${url}`), brut = `${texte} ${url}`.toLowerCase();
  const chiffres = texte.replace(/(?<=\d)[\s.\-()]+(?=\(?\d)/g, '').replace(/[()]/g, '');
  const noms = [f.nom, ...f.noms, ...(f.prenom && f.famille ? [`${f.famille} ${f.prenom}`] : [])];
  const tels = f.telephones.filter((n) => { const x = telephone(n); return x ? chiffres.includes(x.national) || chiffres.includes(x.inter.replace('+', '')) : false; });
  const emails = f.emails.filter((e) => brut.includes(e));
  const adresses = f.adresses.filter((a) => { const r = mots(rueDe(a)); return r.trim().length >= 5 && t.includes(r); });
  const nom = noms.some((n) => t.includes(mots(n))), autres: string[] = [];
  // Des coordonnées à côté du nom, qui ne sont pas dans la fiche : peut-être un ancien numéro, une ancienne adresse.
  if (nom && f.genre !== 'societe') {
    if ([...texte.matchAll(TEL)].some((m) => !f.telephones.includes(telephone(m[0])?.national ?? ''))) autres.push('un autre numéro');
    if ([...texte.matchAll(MAIL)].some((m) => !f.emails.includes(m[0].toLowerCase()))) autres.push('une autre adresse e-mail');
    if (!adresses.length && [...texte.matchAll(RUE)].length) autres.push('une autre adresse postale');
  }
  return {
    nom, ville: f.villes.some((v) => t.includes(mots(v))), telephones: tels, emails,
    pseudos: f.pseudos.filter((p) => new RegExp(`(^|[^a-z0-9_-])${plat(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9_-])`).test(plat(`${texte} ${url}`))),
    adresses, domaines: f.domaines.filter((d) => brut.includes(d)), autres,
  };
}
/** La liste « ce que ça montre », dans l'ordre du plus sensible au moins sensible. Pur. */
export function montreDe(v: Vu, c: Categorie): string[] {
  return [...(v.adresses.length ? ['adresse'] : []), ...(v.telephones.length ? ['téléphone'] : []), ...(v.emails.length ? ['e-mail'] : []), ...(v.nom ? ['nom'] : []), ...(v.pseudos.length ? ['pseudo'] : []), ...(v.ville ? ['ville'] : []), ...v.autres, ...(c === 'réseau social' ? ['photos possibles'] : [])];
}

// ---------------------------------------------------------------- niveau de risque
const LOUCHE = /officiel|official|\bsav\b|support|service.?client|recrut|promo|concours|gagn|giveaway|cadeau|rembours/;
/**
 * Le niveau de risque d'un résultat, avec la raison en clair. Trois niveaux seulement : faible (ton nom apparaît),
 * moyen (un e-mail, un profil public, une fiche d'annuaire), élevé (adresse postale, numéro avec ton nom). Pur.
 */
export function risque(c: Categorie, montre: string[], o: { incertain?: boolean; societe?: boolean; officiel?: boolean; imite?: boolean; texte?: string } = {}): { niveau: Niveau; raison: string } {
  const a = (x: string) => montre.includes(x), et = (l: string[]) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} et ${l.at(-1)}` : l[0] ?? '');
  if (o.societe) {
    if (c === 'réseau social') {
      if (o.officiel) return { niveau: 'faible', raison: 'c\'est un de tes comptes officiels' };
      if (o.imite) return LOUCHE.test(plat(o.texte ?? '')) ? { niveau: 'élevé', raison: 'un compte porte le nom de ta société, se présente comme officiel (ou parle de service client, de promo, de recrutement) et n\'est pas dans tes comptes officiels : sans doute un faux compte' } : { niveau: 'moyen', raison: 'un compte porte le nom de ta société et n\'est pas dans tes comptes officiels : si ce n\'est pas toi, c\'est peut-être un faux compte' };
      return { niveau: 'faible', raison: 'ta société est citée sur ce réseau' };
    }
    if (c === 'avis') return { niveau: 'faible', raison: 'des avis de clients : à lire, et à surveiller' };
    if (c === 'registre de sociétés') return { niveau: 'faible', raison: 'la fiche légale de ta société (publique, c\'est la loi)' };
    if (c === 'annuaire') return { niveau: 'faible', raison: 'une fiche d\'annuaire de ta société : vérifie que l\'adresse et le numéro sont les bons' };
    return { niveau: 'faible', raison: 'ta société est citée sur cette page' };
  }
  if (o.incertain) return { niveau: 'faible', raison: 'à vérifier : l\'extrait ne montre aucun de tes identifiants, ouvre la page pour voir ce qu\'elle dit de toi' };
  if (a('adresse')) { const avec = et([...(a('nom') ? ['ton nom'] : []), ...(a('téléphone') ? ['ton numéro'] : [])]); return { niveau: 'élevé', raison: `ton adresse postale est visible par tous${avec ? `, avec ${avec}` : ''} : on peut venir chez toi` }; }
  if (a('téléphone')) return a('nom') || c === 'annuaire' || c === 'revendeur de données' ? { niveau: 'élevé', raison: 'ton numéro est visible par tous avec ton nom : démarchage, arnaques et harcèlement possibles' } : { niveau: 'moyen', raison: 'ton numéro apparaît sur cette page' };
  if (c === 'revendeur de données') return { niveau: 'moyen', raison: 'un revendeur de données a une fiche sur toi : il la montre ou la vend à qui veut' };
  if (a('e-mail')) return { niveau: 'moyen', raison: 'ton adresse e-mail est visible : spam et hameçonnage ciblé possibles' };
  if (c === 'annuaire') return { niveau: 'moyen', raison: 'un annuaire a une fiche à ton nom : elle montre souvent l\'adresse et le numéro (ouvre-la pour vérifier)' };
  const enPlus = montre.filter((x) => /^une? autre (numéro|adresse postale)/.test(x));
  if (enPlus.length) return { niveau: 'moyen', raison: `cette page montre ${et(enPlus)} qui ${enPlus.length > 1 ? 'ne sont' : 'n\'est'} pas dans ta fiche : si c'est à toi (ancien numéro, ancienne adresse), ajoute-le à ta fiche` };
  if (c === 'réseau social') return a('nom') ? { niveau: 'moyen', raison: 'un profil ou une publication publique à ton nom : photos, proches et habitudes visibles si le compte n\'est pas privé' } : { niveau: 'faible', raison: 'un profil public à ton pseudo' };
  if (c === 'registre de sociétés') return { niveau: 'faible', raison: 'des informations légales sur une société où tu apparais (publiques, c\'est la loi)' };
  if (c === 'presse') return { niveau: 'faible', raison: 'ton nom est cité dans un article' };
  return { niveau: 'faible', raison: a('nom') ? 'ton nom apparaît sur cette page (peut-être un homonyme)' : 'un de tes identifiants apparaît sur cette page' };
}

/**
 * Lit un résultat brut de Pythie pour une fiche : gardé seulement s'il parle bien d'elle (un de ses identifiants
 * dans le titre, l'extrait ou l'adresse), ou s'il vient d'un annuaire, d'un revendeur de données ou d'un réseau
 * social (alors noté « à vérifier »). Rend la catégorie, ce qu'il montre et le risque ; rien s'il est hors sujet. Pur.
 */
export function analyser(f: Fiche, b: { url: string; titre: string; extrait: string }): Pick<Resultat, 'categorie' | 'site' | 'montre' | 'risque' | 'raison' | 'incertain' | 'officiel'> | undefined {
  const { categorie, site } = classer(b.url), v = voir(f, `${b.titre} ${b.extrait}`, b.url);
  const touche = v.nom || v.telephones.length > 0 || v.emails.length > 0 || v.pseudos.length > 0 || v.adresses.length > 0 || v.domaines.length > 0;
  if (!site) return undefined;
  // Les pages du propre site d'une société ne sont pas « une trace » : c'est chez elle.
  if (f.genre === 'societe' && f.domaines.some((d) => site === d || site.endsWith(`.${d}`))) return undefined;
  if (!touche && !['annuaire', 'revendeur de données', 'réseau social'].includes(categorie)) return undefined;
  const montre = montreDe(v, categorie);
  if (f.genre === 'societe') {
    const chemin = plat(b.url.replace(/^https?:\/\/[^/]+/, '')).replace(/[^a-z0-9]/g, ''), marque = plat(f.nom).replace(/[^a-z0-9]/g, '');
    const officiel = f.comptes.some((c) => plat(b.url).replace(/^https?:\/\/(www\.|m\.)?/, '').startsWith(plat(c)));
    const imite = categorie === 'réseau social' && !officiel && marque.length >= 3 && chemin.includes(marque);
    if (!touche && !imite) return undefined;
    const r = risque(categorie, montre, { societe: true, officiel, imite, texte: `${b.titre} ${b.url}` });
    return { categorie, site, montre: montre.filter((x) => x !== 'photos possibles'), risque: r.niveau, raison: r.raison, ...(officiel ? { officiel } : {}) };
  }
  const r = risque(categorie, montre, { incertain: !touche });
  return { categorie, site, montre, risque: r.niveau, raison: r.raison, ...(touche ? {} : { incertain: true }) };
}

// ---------------------------------------------------------------- d'un mois sur l'autre
export interface Bilan { liste: Resultat[]; nouveaux: Resultat[]; retires: Resultat[] }
/**
 * Compare ce qu'on vient de trouver avec ce qu'on savait d'une fiche. Nouveau : jamais vu, ou revenu après avoir
 * été retiré. Retiré : n'apparaît plus, ALORS QUE la recherche qui l'avait trouvé a bien répondu cette fois
 * (`sures`) : un moteur en panne ne fait jamais croire qu'une page a disparu. Ce que tu as écarté (« pas moi »)
 * reste écarté. Pur.
 */
export function fusion(avant: Resultat[], trouves: Resultat[], o: { fiche: string; quand: string; sures: Set<string>; actuelles: Set<string> }): Bilan {
  const moi = avant.filter((r) => r.fiche === o.fiche), autres = avant.filter((r) => r.fiche !== o.fiche);
  const vus = new Map(trouves.map((r) => [r.id, r])), liste: Resultat[] = [], nouveaux: Resultat[] = [], retires: Resultat[] = [];
  for (const old of moi) {
    const t = vus.get(old.id);
    if (t) {
      vus.delete(old.id);
      if (old.etat === 'ignoré') { liste.push({ ...old, revu: o.quand, nouveau: false }); continue; }
      // Un lien « à vérifier toi-même » que tu as déjà confirmé reste confirmé.
      if (t.etat === 'à vérifier' && old.etat !== 'à vérifier') { liste.push({ ...old, nouveau: false }); continue; }
      const revenu = old.etat === 'retiré' && t.etat === 'présent', confirme = old.etat === 'à vérifier' && t.etat === 'présent';
      const r: Resultat = { ...t, vu: old.vu, revu: o.quand, par: [...new Set([...old.par.filter((k) => o.actuelles.has(k)), ...t.par])], nouveau: revenu || confirme };
      liste.push(r); if (revenu || confirme) nouveaux.push(r);
      continue;
    }
    if (old.etat !== 'présent') {
      // Un lien « à vérifier toi-même » part quand la question a reçu une réponse claire (ou n'a plus lieu d'être) ; sinon il reste.
      if (old.etat === 'à vérifier' && (old.par.some((k) => o.sures.has(k)) || !old.par.some((k) => o.actuelles.has(k)))) continue;
      liste.push({ ...old, nouveau: false }); continue;
    }
    // Trouvé par des recherches qui n'existent plus (identifiant retiré de la fiche) : on ne le suit plus.
    const encore = old.par.filter((k) => o.actuelles.has(k));
    if (!encore.length) continue;
    if (encore.every((k) => o.sures.has(k))) { const r: Resultat = { ...old, etat: 'retiré', retire: o.quand, nouveau: false }; liste.push(r); retires.push(r); }
    else liste.push({ ...old, nouveau: false });
  }
  for (const t of vus.values()) { const r: Resultat = { ...t, vu: o.quand, revu: o.quand, nouveau: t.etat === 'présent' }; liste.push(r); if (r.etat === 'présent') nouveaux.push(r); }
  return { liste: [...autres, ...liste], nouveaux, retires };
}
