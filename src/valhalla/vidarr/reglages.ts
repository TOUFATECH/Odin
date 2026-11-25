// Sphinx · Réglages DHCP (maquette « Réseau » validée, lot R4). Ici, la partie pure : aucune prise réseau, aucun fichier.
//  - `verifierReglages` : la plage, la passerelle, le masque, le DNS donné, la durée du bail et le nom de la maison, relus
//    avant d'être écrits ; le refus en mots simples, ou les réglages propres et ce qu'ils changent pour les appareils déjà
//    là (changer la plage ne coupe personne : un bail hors de la plage va au bout, lot R3) ;
//  - `filetOdin` : ce qui se passe pour la maison si Odin distribue les adresses et s'arrête, dit franchement ;
//  - `preApprobation` : passer en « seulement les appareils approuvés » approuve d'abord ceux qui ont un bail en cours
//    (sinon le mode couperait, à la fin de son bail, l'appareil du propriétaire lui-même) ; SAUF les nouveaux (arrivés
//    depuis moins d'un jour, jamais approuvés) : ceux-là attendent l'accord du propriétaire, nom par nom ;
//  - `raisonAutre` : les mots du garde-fou (un autre serveur d'adresses répond).
// La recherche d'un autre serveur d'adresses, elle, est celle de Genèse (src/valhalla/thjalfi/reseau.ts, lot S8).
import { ipNum, ipPropre, macUnie, numIp, reseauDe, type DhcpConfig, type Lease, type MacPolicy } from './dhcp.ts';
import { cleanDomain, isDomain } from './rules.ts';

/** Au plus 1 000 adresses distribuées (comme le réseau à part de Genèse) ; un bail de 6 minutes à 30 jours. */
export const PLAGE_MAISON_MAX = 1000, BAIL_MIN_S = 360, BAIL_MAX_S = 30 * 86_400;
/** Les durées de bail proposées par la page (en heures). */
export const BAUX_PROPOSES = [2, 12, 24, 72];

/** Une durée en mots : « 30 min », « 2 h », « 1 jour », « 3 jours », « 1 jour et 12 h ». Pur. */
export function dureeEnMots(secondes: number): string {
  const sec = Math.max(0, Math.round(secondes));
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} min`;
  const h = Math.round(sec / 360) / 10;
  if (h < 24) return `${String(h).replace('.', ',')} h`;
  const j = Math.floor(h / 24), reste = Math.round(h - j * 24);
  return `${j} jour${j > 1 ? 's' : ''}${reste ? ` et ${reste} h` : ''}`;
}

export type ChampReglage = '' | 'debut' | 'fin' | 'passerelle' | 'masque' | 'dns' | 'heures' | 'domaine';
export interface ReglagesPropres { start: string; end: string; router: string; mask: string; dns: string[]; leaseSeconds: number; domain: string }
export interface VerdictReglages {
  ok: boolean;
  /** le champ en cause quand c'est refusé */
  champ: ChampReglage;
  /** la réponse en une phrase : « Réglages valables. », ou le refus */
  message: string;
  /** ce que ces réglages changent pour les appareils déjà là, et ce qu'il faut savoir */
  avis: string[];
  /** les réglages propres (seulement si c'est accepté) */
  config?: ReglagesPropres;
  /** vrai : rien ne change par rapport aux réglages d'aujourd'hui */
  pareil: boolean;
  /** ce qui demande l'accord du propriétaire (Odin distribue, et la passerelle, le masque ou le DNS changent) ; vide sinon */
  grave: string;
}
export interface EntreeVerifReglages {
  /** ce qui est demandé : debut, fin, passerelle, masque, dns (liste, vide = Odin), secours (la box en DNS de secours), heures, domaine */
  entree: Record<string, unknown>;
  /** les réglages d'aujourd'hui */
  courant: DhcpConfig;
  /** l'adresse d'Odin sur le réseau de la maison */
  odin: string;
  leases: Lease[]; now: number;
  /** le DHCP d'Odin distribue-t-il en ce moment ? */
  allume: boolean;
  /** une heure lisible */
  heure?: (t: number) => string;
}

const txt = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').trim();
/** Une adresse qu'aucun appareil de la maison ne peut porter : 0.x, la boucle locale (127.x), le secours automatique (169.254.x), la multidiffusion et au-delà (224 et plus). Pur. */
const inutilisable = (ip: string): boolean => { const [a, b] = ip.split('.').map(Number); return a === 0 || a === 127 || (a === 169 && b === 254) || a >= 224; };
/** Des noms qui existent sur Internet, ou que les appareils gardent pour eux : jamais le nom de la maison (un appareil nommé « www » y répondrait à la place du vrai site). */
const NOMS_PUBLICS = new Set(['com', 'net', 'org', 'info', 'biz', 'edu', 'gov', 'mil', 'int', 'arpa', 'app', 'dev', 'xyz', 'site', 'online', 'shop', 'store', 'tech', 'cloud', 'blog', 'page', 'live', 'news', 'top', 'club', 'pro', 'name', 'mobi', 'tel', 'asia', 'google', 'local', 'localhost', 'onion', 'invalid', 'example', 'test']);
/** Les fins de nom faites pour un réseau privé : un nom en plusieurs morceaux doit finir par l'une d'elles. */
const FINS_PRIVEES = ['maison', 'lan', 'home', 'internal', 'intranet', 'home.arpa', 'private', 'corp'];
/** Un nom de la maison fait pour un réseau privé (la même règle que pour un nom neuf) : seul celui-là est gardé chez soi par le DNS. Pur. */
export function nomMaisonPrive(d: string): boolean {
  const n = cleanDomain(d), morceaux = n.split('.');
  if (!isDomain(n) || n.length > 63) return false;
  return morceaux.length === 1 ? !NOMS_PUBLICS.has(n) && !/^[a-z]{2}$/.test(n) : FINS_PRIVEES.some((f) => n === f || n.endsWith(`.${f}`));
}
const pluriel = (n: number, un: string, plusieurs: string) => (n > 1 ? `${n} ${plusieurs}` : `1 ${un}`);

/**
 * Les réglages demandés, relus. Refusé : une adresse mal écrite, un masque troué, une plage à l'envers, hors du réseau ou
 * trop grande, une passerelle hors du réseau, un DNS qui n'est pas une adresse, un bail trop court ou trop long, un nom de
 * maison invalide ; et, quand Odin distribue, un réseau où Odin lui-même ne se trouve pas. Rien n'est écrit ici. Pur.
 */
export function verifierReglages(o: EntreeVerifReglages): VerdictReglages {
  const i = o.entree, cur = o.courant, avis: string[] = [];
  const non = (champ: ChampReglage, message: string): VerdictReglages => ({ ok: false, champ, message, avis: [], pareil: false, grave: '' });
  const heure = o.heure ?? ((t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; });
  const NOMS: Record<string, string> = { debut: 'La première adresse', fin: 'La dernière adresse', passerelle: 'La passerelle', masque: 'Le masque' };
  const lu: Record<string, string> = {};
  for (const k of ['debut', 'fin', 'passerelle', 'masque'] as const) {
    const brut = txt(i[k]) || (k === 'masque' ? '255.255.255.0' : '');
    if (!brut) return non(k, `${NOMS[k]} manque.`);
    if (brut.includes(':')) return non(k, `${NOMS[k]} est une adresse IPv6 : le DHCP d'Odin distribue des adresses IPv4 (quatre nombres séparés par des points).`);
    const ip = ipPropre(brut);
    if (!ip) return non(k, `${NOMS[k]} est mal écrit${k === 'masque' ? '' : 'e'} : quatre nombres de 0 à 255 séparés par des points, sans zéro devant.`);
    lu[k] = ip;
  }
  const r = reseauDe({ router: lu.passerelle, mask: lu.masque, server: '' });
  if (!r) return non('masque', `Le masque ${lu.masque} ne décrit pas un réseau de maison (ex. 255.255.255.0).`);
  const de = numIp(r.premiere), a = numIp(r.derniere), dans = (ip: string) => { const n = ipNum(ip); return n >= r.premiere && n <= r.derniere; };
  if (!dans(lu.passerelle)) return non('passerelle', `La passerelle ${lu.passerelle} est l'adresse du réseau lui-même ou sa diffusion : aucune box ne peut la porter.`);
  if (inutilisable(lu.passerelle)) return non('passerelle', `La passerelle ${lu.passerelle} n'est pas une adresse de maison : aucune box ne peut la porter (ex. 192.168.1.1).`);
  // La passerelle mène à Internet : c'est la box. Odin ne fait pas suivre vers Internet : la donner couperait toute la maison.
  if (ipPropre(o.odin) && lu.passerelle === ipPropre(o.odin)) return non('passerelle', `Refusé : ${lu.passerelle} est l'adresse d'Odin lui-même. La passerelle est l'adresse de la box (elle mène à Internet) ; Odin ne fait pas suivre vers Internet, toute la maison serait coupée.`);
  for (const k of ['debut', 'fin'] as const) if (!dans(lu[k])) return non(k, `${NOMS[k]} (${lu[k]}) n'est pas dans le réseau de la maison (${de} à ${a}).`);
  const lo = ipNum(lu.debut), hi = ipNum(lu.fin);
  if (lo > hi) return non('fin', 'La première adresse doit précéder la dernière.');
  if (hi - lo + 1 > PLAGE_MAISON_MAX) return non('fin', `${PLAGE_MAISON_MAX} adresses distribuées au plus (ici ${hi - lo + 1}).`);
  // Le DNS donné aux appareils : vide = Odin ; « secours » ajoute la box derrière.
  const odin = ipPropre(o.odin), dnsBrut = Array.isArray(i.dns) ? i.dns.map(txt) : txt(i.dns).split(/[\s,;]+/);
  const dns: string[] = [];
  for (const x of dnsBrut.filter(Boolean)) {
    const ip = ipPropre(x);
    if (!ip) return non('dns', `DNS mal écrit : « ${x.replace(/[^0-9a-zA-Z.:]/g, '').slice(0, 40)} ». Une adresse IPv4, ou plusieurs séparées par une virgule ; vide = Odin.`);
    const n = ipNum(ip);
    if (n === 0 || n === 0xffffffff || inutilisable(ip) || n === r.net || n === r.diffusion) return non('dns', `${ip} ne peut pas servir de DNS aux appareils de la maison.`);
    if (!dns.includes(ip)) dns.push(ip);
  }
  if (!dns.length) { if (!odin) return non('dns', 'Odin ne connaît pas sa propre adresse sur le réseau : écris le DNS à donner aux appareils.'); dns.push(odin); }
  if (i.secours === true && !dns.includes(lu.passerelle)) dns.push(lu.passerelle);
  if (dns.length > 3) return non('dns', 'Trois DNS au plus.');
  // La durée du bail.
  // Un nombre, ou un nombre écrit en chiffres (« 12 », « 0,5 ») : ni « vrai », ni « 0x10 », ni « 1e3 ».
  const hTexte = typeof i.heures === 'string' ? i.heures.trim().replace(',', '.') : '';
  const hBrut = i.heures === undefined || i.heures === '' || i.heures === null ? cur.leaseSeconds / 3600 || 24 : typeof i.heures === 'number' ? i.heures : /^\d{1,4}(\.\d{1,3})?$/.test(hTexte) ? Number(hTexte) : NaN;
  if (!Number.isFinite(hBrut) || hBrut <= 0) return non('heures', 'La durée du bail est un nombre d\'heures (ex. 12).');
  const leaseSeconds = Math.round(hBrut * 3600);
  if (leaseSeconds < BAIL_MIN_S || leaseSeconds > BAIL_MAX_S) return non('heures', 'Un bail dure de 6 minutes à 30 jours.');
  const domain = cleanDomain(txt(i.domaine).replace(/^\.+/, '') || cur.domain || 'maison');
  if (!isDomain(domain) || domain.length > 63) return non('domaine', 'Nom de la maison invalide : des lettres, des chiffres, des tirets (ex. maison).');
  // Le DNS d'Odin répond « nom-de-l-appareil.nom-de-la-maison » avec l'adresse de l'appareil, et un appareil choisit son nom :
  // avec « com » ou « banque.fr » comme nom de maison, un appareil nommé « www » prendrait la place d'un vrai site pour toute la maison.
  if (domain !== (cur.domain ?? 'maison')) {
    const morceaux = domain.split('.'), dernier = morceaux[morceaux.length - 1];
    if (morceaux.length === 1 ? (NOMS_PUBLICS.has(domain) || /^[a-z]{2}$/.test(domain)) : !FINS_PRIVEES.some((f) => domain === f || domain.endsWith(`.${f}`)))
      return non('domaine', `Refusé : « ${domain} » ${morceaux.length === 1 ? 'existe sur Internet (ou est gardé par les appareils)' : `finit par « .${dernier} », un nom d'Internet`}. Un appareil de la maison pourrait y répondre à la place d'un vrai site. Choisis un nom privé : maison, lan, ou un nom qui finit par .lan ou .home.arpa.`);
  }
  // Odin doit être dans le réseau qu'il distribue.
  if (odin && !dans(odin)) {
    if (o.allume) return non('passerelle', `Refusé : Odin distribue les adresses en ce moment, et son adresse (${odin}) n'est pas dans ce réseau (${de} à ${a}) : il ne pourrait plus répondre aux appareils. Arrête d'abord la distribution (« La box »), ou corrige la passerelle et le masque.`);
    avis.push(`L'adresse d'Odin (${odin}) n'est pas dans ce réseau (${de} à ${a}) : avec ces réglages, Odin refusera de distribuer les adresses.`);
  }
  if (inutilisable(lu.debut) || inutilisable(lu.fin)) return non('debut', `Ce réseau (${de} à ${a}) n'est pas un réseau de maison (ex. 192.168.1.x, 10.0.0.x).`);
  // Les adresses vraiment données : la plage, moins celles qu'Odin ne donne jamais (la sienne, la box, le DNS), moins les adresses fixes (chacune à son appareil).
  const dansPlage = (ip: string) => Boolean(ip) && ipNum(ip) >= lo && ipNum(ip) <= hi;
  const jamais = new Set([odin, lu.passerelle, ...dns].filter(dansPlage)), reservees = new Set((cur.fixed ?? []).map((f) => ipPropre(f.ip)).filter((ip) => dansPlage(ip) && !jamais.has(ip)));
  if (hi - lo + 1 - jamais.size <= 0) return non('fin', 'Refusé : cette plage ne laisse aucune adresse à donner (elle ne contient que l\'adresse d\'Odin, de la box ou du DNS). Élargis-la.');
  const taille = hi - lo + 1 - jamais.size - reservees.size;
  const config: ReglagesPropres = { start: lu.debut, end: lu.fin, router: lu.passerelle, mask: lu.masque, dns, leaseSeconds, domain };
  const change = {
    plage: cur.start !== config.start || cur.end !== config.end, reseau: cur.mask !== config.mask || (reseauDe(cur)?.net ?? -1) !== r.net,
    passerelle: cur.router !== config.router, dns: cur.dns.join(',') !== dns.join(','), bail: cur.leaseSeconds !== leaseSeconds, domaine: (cur.domain ?? 'maison') !== domain,
  };
  const pareil = !Object.values(change).some(Boolean);
  // Ce que cela change pour les appareils déjà là.
  const vivants = o.leases.filter((l) => l.expires > o.now && ipPropre(l.ip)), fixes = new Set((cur.fixed ?? []).map((f) => macUnie(f.mac)));
  const horsReseau = vivants.filter((l) => !dans(l.ip)), horsPlage = vivants.filter((l) => dans(l.ip) && (ipNum(l.ip) < lo || ipNum(l.ip) > hi) && !fixes.has(l.mac.toLowerCase()) && !dns.includes(l.ip));
  const quand = o.allume ? '' : ' (dès qu\'Odin distribuera les adresses)';
  if (odin && lo <= ipNum(odin) && ipNum(odin) <= hi) avis.push(`La plage contient l'adresse d'Odin (${odin}) : elle n'est jamais donnée à un appareil.`);
  if (lo <= ipNum(lu.passerelle) && ipNum(lu.passerelle) <= hi) avis.push(`La plage contient l'adresse de la box (${lu.passerelle}) : elle n'est jamais donnée à un appareil.`);
  if (horsPlage.length) {
    const dernier = Math.max(...horsPlage.map((l) => l.expires)), n = horsPlage.length > 1;
    avis.push(`Personne n'est coupé : ${pluriel(horsPlage.length, 'appareil tient une adresse hors de cette plage. Il la garde', 'appareils tiennent une adresse hors de cette plage. Ils la gardent')} jusqu'à la fin de ${n ? 'leur' : 'son'} bail (au plus tard ${heure(dernier)}), puis ${n ? 'reçoivent' : 'reçoit'} une adresse de la plage${quand}.`);
  } else if (change.plage && vivants.length && !horsReseau.length) avis.push('Personne n\'est coupé : tous les appareils connectés tiennent déjà une adresse de cette plage, ou une adresse fixe.');
  if (horsReseau.length) { const n = horsReseau.length > 1; avis.push(`${pluriel(horsReseau.length, 'appareil tient une adresse hors de ce réseau : à son prochain renouvellement, Odin la lui refuse et lui en donne une nouvelle', 'appareils tiennent une adresse hors de ce réseau : à leur prochain renouvellement, Odin la leur refuse et leur en donne une nouvelle')} (une courte coupure pour ${n ? 'eux' : 'lui'})${quand}.`); }
  const fixesDehors = (cur.fixed ?? []).filter((f) => ipPropre(f.ip) && !dans(f.ip)).length;
  if (fixesDehors) avis.push(`${pluriel(fixesDehors, 'adresse fixe est hors de ce réseau : elle ne sera plus donnée', 'adresses fixes sont hors de ce réseau : elles ne seront plus données')}. Corrige-${fixesDehors > 1 ? 'les' : 'la'} dans « Adresses fixes ».`);
  const mobiles = vivants.filter((l) => !fixes.has(l.mac.toLowerCase())).length;
  if (mobiles > taille) avis.push(`La plage compte ${pluriel(taille, 'adresse à donner', 'adresses à donner')} pour ${pluriel(mobiles, 'appareil connecté', 'appareils connectés')} : les derniers arrivés n'en recevront pas.`);
  if (odin && !dns.includes(odin)) avis.push('Odin n\'est plus le DNS donné aux appareils : les pubs ne sont plus bloquées, les noms de la maison ne répondent plus, et Sphinx ne voit plus qui demande quoi.');
  else if (dns.length > 1) avis.push(`DNS de secours (${dns.slice(1).join(', ')}) : si Odin ne répond plus, les appareils demandent là. Certains s'en servent aussi quand Odin répond : pour eux, les pubs ne sont pas toujours bloquées.`);
  if (change.passerelle && vivants.length) avis.push(`Les appareils reçoivent la nouvelle passerelle à leur prochain renouvellement (au plus tard ${heure(Math.max(...vivants.map((l) => l.expires)))}). Si ${config.router} n'est pas l'adresse de la box, ils perdent Internet.`);
  if (leaseSeconds < 3600) avis.push(`Bail court (${dureeEnMots(leaseSeconds)}) : si Odin s'arrête, les appareils perdent leur adresse en ${dureeEnMots(leaseSeconds)} au plus.`);
  else if (leaseSeconds > 3 * 86_400) avis.push(`Bail long (${dureeEnMots(leaseSeconds)}) : un changement de réglages met jusqu'à ${dureeEnMots(leaseSeconds / 2)} à arriver sur les appareils.`);
  const graves = [change.reseau ? `le réseau (masque ${config.mask})` : '', change.passerelle ? `la passerelle (${config.router})` : '', change.dns ? `le DNS donné (${dns.join(', ')})` : ''].filter(Boolean);
  const grave = o.allume && graves.length ? `changer ${graves.join(', ')} pendant qu'Odin distribue les adresses : tous les appareils de la maison les recevront à leur prochain renouvellement, et une erreur leur coupe Internet` : '';
  return { ok: true, champ: '', message: pareil ? 'Ce sont déjà les réglages d\'aujourd\'hui.' : 'Réglages valables.', avis, config, pareil, grave };
}

export interface Filet { lignes: string[]; conseils: string[] }
/**
 * Le filet : ce qui se passe pour la maison si Odin distribue les adresses et s'arrête (panne, mise à jour, coupure du
 * garde-fou). Dit franchement : jusqu'à quand chacun garde son adresse, ce qui tombe tout de suite, ce qu'Odin éteint ne
 * peut pas faire. `nom` : le nom à montrer pour un appareil (déjà nettoyé). Pur.
 */
export function filetOdin(o: { config: DhcpConfig; leases: Lease[]; now: number; allume: boolean; odin: string; heure?: (t: number) => string; nom?: (mac: string) => string }): Filet {
  const c = o.config, bail = dureeEnMots(c.leaseSeconds), heure = o.heure ?? ((t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; });
  if (!o.allume) return { lignes: ['La box distribue les adresses : si Odin s\'éteint, les appareils de la maison gardent leur adresse et en reçoivent de la box, comme d\'habitude.', 'Si la box donne Odin comme DNS, les noms ne se trouvent plus tant qu\'Odin est éteint (Internet semble coupé) : garde un DNS de secours dans la box.'], conseils: [] };
  const vivants = o.leases.filter((l) => l.expires > o.now).sort((x, y) => x.expires - y.expires), lignes: string[] = [], conseils: string[] = [];
  lignes.push(`Les appareils déjà là gardent leur adresse jusqu'à la fin de leur bail : ${bail} au plus après leur dernier renouvellement. À mi-bail ils redemandent ; sans réponse d'Odin, ils vont jusqu'au bout, puis perdent le réseau.`);
  if (vivants.length) {
    const premier = vivants[0], dernier = vivants[vivants.length - 1], qui = o.nom?.(premier.mac.toLowerCase());
    lignes.push(vivants.length === 1 ? `Si Odin s'arrêtait maintenant : l'appareil connecté${qui ? ` (${qui})` : ''} garderait son adresse jusqu'à ${heure(premier.expires)}.`
      : `Si Odin s'arrêtait maintenant : le premier des ${vivants.length} appareils${qui ? ` (${qui})` : ''} perdrait son adresse à ${heure(premier.expires)}, le dernier à ${heure(dernier.expires)}.`);
  }
  lignes.push('Un appareil qui arrive, ou qui se rallume, pendant qu\'Odin est arrêté ne reçoit aucune adresse : il n\'a pas de réseau.');
  const autres = c.dns.filter((d) => d !== o.odin && d !== c.server);
  if (!autres.length) lignes.push('Le DNS donné aux appareils est Odin seul : sans Odin, plus aucun nom ne se trouve. Internet semble coupé tout de suite, même pour ceux qui ont encore leur adresse.');
  else if (autres.length < c.dns.length) lignes.push(`DNS de secours (${autres.join(', ')}) : sans Odin, Internet continue, mais sans le blocage des pubs ni les noms de la maison.`);
  lignes.push('Odin éteint ne peut prévenir personne. Quand il arrête lui-même de distribuer (garde-fou, ou « La box »), il te le dit et te rappelle de rallumer le serveur d\'adresses de la box.');
  if (c.leaseSeconds < 12 * 3600) conseils.push(`Un bail d'un jour laisse plus de temps pour réagir qu'un bail de ${bail}.`);
  conseils.push(`Si Odin doit rester éteint : rallume le serveur d'adresses (DHCP) de la box, avec la même plage (${c.start} à ${c.end}), pour que personne ne change d'adresse.`);
  if (!autres.length) conseils.push('« DNS de secours : la box » garde Internet aux appareils quand Odin ne répond plus.');
  return { lignes, conseils };
}

export interface PreApprobation {
  /** ceux qui seront approuvés : ils ont un bail en cours, Odin les connaît depuis plus d'un jour (ou c'est l'appareil que le propriétaire tient), et ils n'étaient ni approuvés, ni bloqués, ni en pause */
  aApprouver: Array<{ mac: string; ip: string; nom: string }>;
  /** les nouveaux (arrivés depuis moins d'un jour, jamais approuvés) : PAS approuvés d'avance ; ils attendent l'accord du propriétaire et gardent leur adresse jusqu'à la fin de leur bail */
  aVoir: Array<{ mac: string; ip: string; nom: string; jusqua: number }>;
  /** ceux qui restent comme ils sont : bloqués ou en pause (le mode ne les débloque pas) */
  restent: Array<{ mac: string; nom: string; etat: 'bloque' | 'pause' }>;
  /** ceux qui passent déjà : approuvés, ou une adresse fixe (leur accord tient à la réservation) */
  deja: number;
}
/**
 * Avant de passer en « seulement les appareils approuvés » : qui a un bail en cours ? Ceux-là sont approuvés d'abord
 * (sinon, à la fin de leur bail, ils perdraient le réseau : l'appareil du propriétaire compris). Un appareil bloqué ou en
 * pause le reste ; une adresse fixe passe déjà. Un NOUVEAU (`nouveau` : arrivé depuis moins d'un jour, jamais approuvé)
 * n'est pas approuvé d'avance : un inconnu arrivé il y a une minute ne doit pas entrer dans la liste sans que le
 * propriétaire le voie. Seule exception : l'appareil que le propriétaire tient en ce moment (`tenu`). Pur.
 */
export function preApprobation(o: { config: DhcpConfig; leases: Lease[]; policy: MacPolicy; now: number; nom?: (mac: string) => string; nouveau?: (mac: string) => boolean; tenu?: (mac: string) => boolean }): PreApprobation {
  const fixes = new Set((o.config.fixed ?? []).map((f) => macUnie(f.mac))), out: PreApprobation = { aApprouver: [], aVoir: [], restent: [], deja: 0 }, vus = new Set<string>();
  const rang = (l: Lease) => (ipPropre(l.ip) ? ipNum(l.ip) : 0);
  for (const l of [...o.leases].sort((x, y) => rang(x) - rang(y))) {
    const mac = l.mac.toLowerCase(); if (!(l.expires > o.now) || vus.has(mac)) continue; vus.add(mac);
    const etat = o.policy.etats[mac], nom = o.nom?.(mac) || mac;
    if (etat === 'bloque' || etat === 'pause') out.restent.push({ mac, nom, etat });
    else if (etat === 'actif' || fixes.has(mac)) out.deja++;
    else if (o.nouveau?.(mac) === true && o.tenu?.(mac) !== true) out.aVoir.push({ mac, ip: l.ip, nom, jusqua: l.expires });
    else out.aApprouver.push({ mac, ip: l.ip, nom });
  }
  return out;
}

/** Les mots du garde-fou quand un autre serveur d'adresses répond (maquette, écran 4b). Pur. */
export function raisonAutre(autres: string[], box: string): string {
  const qui = autres.slice(0, 4), laBox = qui.length === 1 && qui[0] === box;
  const sujet = laBox ? `La box (${box}) distribue encore les adresses` : qui.length > 1 ? `D'autres serveurs d'adresses (${qui.join(', ')}) répondent sur la carte d'Odin` : `Un autre serveur d'adresses (${qui[0] ?? 'inconnu'}) répond sur la carte d'Odin`;
  return `Refusé : ça casserait le réseau de la maison. ${sujet}. Deux serveurs à la fois : les téléphones, la télé et les PC n'auraient plus Internet.`;
}
