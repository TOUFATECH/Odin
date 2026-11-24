// Sphinx · Appareils (maquette « Réseau » validée, lot R2) : « voir quelle machine récupère l'adresse IP » et
// « pouvoir bloquer les machines ». Ici, la partie pure (aucune prise réseau, aucun fichier) :
//  - `texteSur` : tout texte venu du réseau (nom d'hôte, ce que l'appareil dit de lui) est nettoyé ;
//  - `typeDevine` : le type d'un appareil, deviné (à confirmer par le propriétaire) ;
//  - `vueAppareils` : chaque appareil connu du DHCP d'Odin, avec son bail, son fabricant (table du code, d'après
//    l'adresse MAC), son type, « connecté » ou non, « nouveau » ou non, et ce que « bloquer » ferait vraiment ;
//  - `gardeEtat` : jamais la box, jamais Odin, jamais le serveur DNS de la maison, jamais l'appareil que le propriétaire
//    tient sans qu'il le dise ;
//  - `macPropre` : une adresse MAC écrite autrement (majuscules, tirets, points, sans séparateur) reste la même machine ;
//  - `nomsReseau` : quel appareil porte quel nom dans le DNS (un nom annoncé ne prend jamais un nom qui compte, ni celui d'un autre).
// Le fabricant vient de la table déjà dans le code (Horus, src/hlidskjalf/vendors.ts) : aucun service extérieur.
import { AsyncLocalStorage } from 'node:async_hooks';
import { networkInterfaces } from 'node:os';
import { hostLabel, ipNum, osFromVendorClass, randomMac, type DhcpConfig, type Lease, type MacPolicy } from './dhcp.ts';

/**
 * L'adresse de l'appareil qui fait la demande en cours (posée par la porte web autour de la demande). Tant que
 * rien ne la pose, Odin ne sait pas depuis quel appareil on agit : il le dit, et prévient avant de bloquer.
 */
export const origineDemande = new AsyncLocalStorage<string>();
export const depuisAdresse = (): string => (origineDemande.getStore() ?? '').trim().replace(/^::ffff:/, '');

/** Depuis Odin lui-même (la machine où il tourne) ? */
export const surOdin = (ip: string): boolean => /^127\./.test(ip) || ip === '::1';

/**
 * Une adresse MAC, quelle que soit la façon de l'écrire (« AA-BB-CC-DD-EE-FF », « aabb.ccdd.eeff », « aabbccddeeff »,
 * avec des espaces) → « aa:bb:cc:dd:ee:ff ». Vide si ce n'est pas une adresse MAC. Pur.
 */
export function macPropre(v: unknown): string {
  const h = String(v ?? '').trim().toLowerCase().replace(/[\s:.\-]/g, '');
  return /^[0-9a-f]{12}$/.test(h) ? h.match(/../g)!.join(':') : '';
}

/**
 * Les noms qu'un appareil ne gagne JAMAIS en les annonçant lui-même (option 12 du DHCP) : ce sont ceux qu'un autre
 * appareil irait chercher tout seul (« wpad » : réglage de proxy automatique ; « odin », « box » : la page de connexion).
 * Le propriétaire, lui, peut donner le nom qu'il veut.
 */
const NOMS_RESERVES = new Set(['odin', 'box', 'wpad', 'isatap', 'localhost', 'localdomain', 'broadcasthost', 'passerelle', 'gateway', 'routeur', 'router', 'livebox', 'freebox', 'bbox',
  'dns', 'dhcp', 'ntp', 'time', 'proxy', 'www', 'mail', 'smtp', 'imap', 'ns', 'ns1', 'ns2', 'autodiscover', 'autoconfig', 'maison', 'home', 'local', 'lan', 'internet', 'intranet', 'corp', 'vpn', 'sphinx', 'vortex', 'serveur', 'server']);

/**
 * Quel appareil porte quel nom dans le DNS de la maison : adresse MAC → étiquette (« telephone-d-awa »). Pur.
 *  - un appareil bloqué n'a pas de nom ; un bail fini non plus (sauf adresse fixe) ;
 *  - un nom ANNONCÉ par l'appareil ne prend jamais un nom réservé, ni le nom du domaine ;
 *  - deux appareils veulent le même nom : celui que le propriétaire a nommé passe devant, puis le plus ancien ; l'autre
 *    n'a pas de nom (il ne vole pas celui du premier).
 */
export function nomsReseau(o: { config: DhcpConfig; leases: Lease[]; policy: MacPolicy; now: number }): Map<string, string> {
  const c = o.config, domaine = (c.domain ?? 'maison').toLowerCase(), pris = new Map<string, { mac: string; rang: number; depuis: number }>();
  for (const l of o.leases) {
    const mac = l.mac.toLowerCase();
    if (!l.name || !(l.fixed || l.expires > o.now) || o.policy.etats[mac] === 'bloque') continue;
    const h = hostLabel(texteSur(l.name)); if (!h) continue;
    const choisi = Boolean(l.named) || Boolean(c.fixed.find((f) => f.mac.toLowerCase() === mac)?.name);
    if (!choisi && (NOMS_RESERVES.has(h) || h === domaine || domaine.startsWith(`${h}.`))) continue;
    const moi = { mac, rang: choisi ? 0 : 1, depuis: l.first ?? l.since ?? Number.MAX_SAFE_INTEGER }, lui = pris.get(h);
    if (!lui || moi.rang < lui.rang || (moi.rang === lui.rang && (moi.depuis < lui.depuis || (moi.depuis === lui.depuis && moi.mac < lui.mac)))) pris.set(h, moi);
  }
  return new Map([...pris].map(([h, x]) => [x.mac, h]));
}

/** Les adresses MAC et les adresses IPv4 des cartes de cette machine (Odin lui-même). Remplaçable dans les essais. */
export const LOCAL = {
  macs: (): string[] => Object.values(networkInterfaces()).flatMap((l) => l ?? []).map((i) => i.mac.toLowerCase()).filter((m) => m && m !== '00:00:00:00:00:00'),
  /** Toutes les adresses d'Odin (une par carte) : aucune n'est donnée ni réservée à un appareil, même quand Odin a plusieurs cartes. */
  ips: (): string[] => Object.values(networkInterfaces()).flatMap((l) => l ?? []).filter((i) => i.family === 'IPv4' && !i.internal).map((i) => i.address),
};

/**
 * Un texte venu du réseau, rendu sûr : plus aucun caractère de contrôle ni de sens d'écriture caché, plus aucun
 * caractère qui ouvrirait une balise ou une entité ; les espaces réunies ; coupé court. Pur.
 */
export function texteSur(v: unknown, max = 63): string {
  const t = String(v ?? '').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff9-\ufffb]/g, ' ')
    .replace(/[<>&"`\\]/g, '').replace(/\s+/g, ' ').trim();
  return [...t].slice(0, max).join('').trim();
}

export type TypeAppareil = 'tel' | 'tab' | 'pc' | 'lap' | 'tv' | 'imp' | 'cam' | 'box' | 'srv' | 'jeu' | 'obj' | 'inc';
export const TYPES: Record<TypeAppareil, string> = {
  tel: 'Téléphone', tab: 'Tablette', pc: 'Ordinateur', lap: 'Portable', tv: 'Télévision', imp: 'Imprimante', cam: 'Caméra',
  box: 'Box', srv: 'Serveur', jeu: 'Console', obj: 'Objet connecté', inc: 'Inconnu',
};
const sansAccent = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/** Le type d'un appareil, deviné d'après son nom, ce qu'il dit au DHCP, son fabricant et le registre d'Odin. Pur. */
export function typeDevine(x: { nom?: string; classe?: string; fabricant?: string; registre?: string; garde?: '' | 'box' | 'odin' | 'dns' }): TypeAppareil {
  if (x.garde === 'box') return 'box';
  if (x.garde === 'odin' || x.garde === 'dns') return 'srv';
  const n = sansAccent(`${x.nom ?? ''} ${x.registre ?? ''}`), f = sansAccent(x.fabricant ?? ''), c = x.classe ?? '';
  if (/\b(box|routeur|router|passerelle|gateway)\b/.test(n)) return 'box';
  if (/imprim|print|laserjet|deskjet|officejet/.test(n)) return 'imp';
  if (/camera|\bcam\b|\bipc\b|webcam/.test(n)) return 'cam';
  if (/tablet|\bipad\b|\btab\b/.test(n)) return 'tab';
  if (/telephone|phone|android|smartphone|\bmobile\b/.test(n)) return 'tel';
  if (/\btv\b|tele(vision)?\b|televis|\becran\b/.test(n)) return 'tv';
  if (/console|playstation|\bps[345]\b|xbox|nintendo|switch/.test(n)) return 'jeu';
  if (/\bnas\b|serveur|server|\bsrv\b|stockage/.test(n)) return 'srv';
  if (/laptop|portable|notebook|\bbook\b/.test(n)) return 'lap';
  if (/desktop|\bpc\b|ordinateur|\bposte\b|\bbureau\b/.test(n)) return 'pc';
  if (/^android-dhcp/i.test(c)) return 'tel';
  if (/^MSFT/i.test(c)) return 'pc';
  if (/synology|qnap|proxmox|qemu|vmware|hyper-v|virtualbox|docker/.test(f)) return 'srv';
  if (/espressif|objet|hue|sonos/.test(f) || /udhcp/i.test(c)) return 'obj';
  return 'inc';
}

export type EtatAppareil = 'actif' | 'pause' | 'bloque' | 'attente';
/** Ce qu'un geste fait vraiment (`fait`) et ce qu'Odin ne peut pas faire (`limites`), en phrases simples. */
export interface Effets { fait: string[]; limites: string[] }
export interface Appareil {
  mac: string;
  /** le nom à montrer (nettoyé) ; `nomDonne` : choisi par le propriétaire (le nom annoncé par l'appareil ne l'écrase plus) */
  nom: string; nomDonne: boolean;
  /** son nom sur le réseau (« imprimante.maison ») tant qu'il est servi par le DNS d'Odin, sinon vide */
  nomReseau: string;
  /** l'adresse qu'il tient (bail en cours) ou qui lui est réservée ; vide : aucune */
  ip: string; fixe: boolean;
  /** l'adresse fixe qui lui est réservée (lot R3) ; vide : aucune. Elle peut différer de `ip` tant qu'il tient encore une autre adresse */
  reservee: string;
  /** adresse MAC « privée » (aléatoire) : pas de fabricant, et elle peut changer */
  prive: boolean; fabricant: string; type: TypeAppareil; typeNom: string; systeme: string;
  etat: EtatAppareil;
  /** « vu » : un signe de lui depuis moins de 10 minutes ; « bail » : bail en cours, sans signe récent ; « absent » */
  presence: 'vu' | 'bail' | 'absent'; connecte: boolean;
  /** dernier signe (ms), début de la présence en cours (ms), fin du bail (ms), toute première fois (ms) ; 0 : inconnu */
  vu: number; depuis: number; jusqua: number; premier: number;
  nouveau: boolean;
  /** la box (passerelle), Odin lui-même, ou le serveur DNS donné à toute la maison : jamais bloqué ni mis en pause */
  garde: '' | 'box' | 'odin' | 'dns';
  /** c'est l'appareil depuis lequel la demande est faite */
  ici: boolean;
  /** bloqué ET sans adresse : sorti du réseau ; `coupeDns` : bloqué, tient encore une adresse, Internet coupé par le DNS */
  retire: boolean; coupeDns: boolean;
  effets: { bloque: Effets; pause: Effets };
}
export interface VueAppareils {
  dhcp: { allume: boolean; mode: 'ouvert' | 'liste'; debut: string; fin: string; dns: boolean };
  /** Odin sait-il depuis quel appareil la demande vient ? Vrai seulement s'il le RECONNAÎT : un des appareils de la liste
   *  (« ici »), ou Odin lui-même. Une adresse qu'il ne relie à aucun appareil ne suffit pas : la page prévient encore. */
  origineConnue: boolean;
  chiffres: { connectes: number; connus: number; nouveaux: number; bloques: number };
  appareils: Appareil[];
}
export interface EntreeVue {
  config: DhcpConfig; leases: Lease[]; policy: MacPolicy; now: number;
  /** le DHCP d'Odin distribue-t-il les adresses ? le DNS d'Odin répond-il ? */
  dhcpAllume: boolean; dnsAllume: boolean;
  /** la dernière question posée au DNS d'Odin par cette adresse (ms) */
  dernierDns?: (ip: string) => number | undefined;
  fabricant: (mac: string) => string;
  /** ce que le registre d'Odin (Atlas) sait de cette adresse */
  registre?: (ip: string) => { kind?: string; model?: string } | undefined;
  macsOdin: string[];
  /** l'adresse MAC de la box, quand le registre d'Odin la connaît (elle ne demande pas d'adresse à Odin) */
  macsBox?: string[];
  /** le dernier paquet DHCP reçu de cet appareil (ms), gardé en mémoire par le serveur d'adresses */
  dernierDhcp?: (mac: string) => number | undefined;
  /** l'adresse de l'appareil qui demande (vide : inconnue) */
  ici?: string;
  /** une heure lisible */
  heure: (t: number) => string;
}
export const SIGNE_MS = 10 * 60_000;
export const NOUVEAU_MS = 24 * 3600_000;

/** Ce que « bloquer » et « mettre en pause » font vraiment pour cet appareil, et ce qu'Odin ne peut pas faire. Pur. */
export function effetsDe(d: { ip: string; vivant: boolean; jusqua: number; nomReseau: string; prive: boolean }, o: { dhcpAllume: boolean; dnsAllume: boolean; heure: (t: number) => string }): { bloque: Effets; pause: Effets } {
  const main = 'Un appareil réglé à la main (une adresse tapée dans ses réglages) peut encore parler sur le réseau : seuls la box ou le Wi-Fi peuvent le mettre dehors.';
  const privee = 'Adresse MAC privée : ce téléphone peut revenir avec une autre adresse MAC. Pour le tenir dehors : « Seulement les appareils approuvés » (mode du DHCP).';
  if (!o.dhcpAllume) {
    const box: Effets = {
      fait: ['C\'est noté : dès qu\'Odin distribuera les adresses, il n\'en recevra plus.'],
      limites: [
        'Aujourd\'hui c\'est la box qui distribue les adresses : Odin ne peut ni lui retirer son adresse ni le sortir du réseau.',
        'Odin ne connaît pas son adresse du moment : il ne peut pas non plus lui couper Internet par le DNS.',
        'Pour le retirer vraiment : bloque-le dans la box (Wi-Fi, filtrage par adresse MAC), ou laisse Odin distribuer les adresses.',
      ],
    };
    return { bloque: box, pause: { fait: ['C\'est noté : dès qu\'Odin distribuera les adresses, son bail ne sera plus renouvelé.'], limites: box.limites.slice(0, 1) } };
  }
  const fin = d.vivant && d.jusqua ? o.heure(d.jusqua) : '';
  const bloque: Effets = { fait: ['Le DHCP d\'Odin ne lui répond plus : il n\'obtient plus d\'adresse.'], limites: [] };
  if (d.vivant) {
    bloque.fait.push(`Il tient encore ${d.ip} : à son prochain renouvellement Odin la lui refuse et il sort du réseau, au plus tard à la fin de son bail (${fin}).`);
    if (o.dnsAllume) bloque.fait.push('D\'ici là, Internet lui est coupé par le DNS d\'Odin (s\'il passe par lui).');
    bloque.fait.push(`Son adresse ${d.ip} n'est redonnée à personne avant qu'il l'ait lâchée.`);
    bloque.limites.push('Odin ne peut pas lui reprendre son adresse à la seconde : il faut attendre qu\'il redemande, ou la fin de son bail.');
  }
  if (d.nomReseau) bloque.fait.push(`Son nom ${d.nomReseau} disparaît du DNS.`);
  bloque.limites.push(main); if (d.prive) bloque.limites.push(privee);
  const pause: Effets = {
    fait: [d.vivant ? `Son bail n'est plus renouvelé : il perd le réseau à son prochain renouvellement, au plus tard à ${fin}.` : 'Il ne reçoit plus d\'adresse tant que la pause dure.', 'Il garde son nom et sa place : « Fin de la pause » lui rend tout.'],
    limites: [main, ...(d.prive ? [privee] : [])],
  };
  return { bloque, pause };
}

/** Chaque appareil connu du DHCP d'Odin (baux, adresses fixes, appareils bloqués, en pause ou en attente). Pur. */
export function vueAppareils(o: EntreeVue): VueAppareils {
  const c = o.config, pol = o.policy, now = o.now, ici = (o.ici ?? '').trim();
  const macs = new Set<string>();
  for (const l of o.leases) macs.add(l.mac.toLowerCase());
  for (const f of c.fixed) macs.add(f.mac.toLowerCase());
  for (const m of Object.keys(pol.etats)) if (pol.etats[m] !== 'actif') macs.add(m.toLowerCase());
  for (const m of pol.attente) macs.add(m.toLowerCase());
  const odin = new Set(o.macsOdin.map((m) => m.toLowerCase())), box = new Set((o.macsBox ?? []).map((m) => m.toLowerCase()));
  const noms = nomsReseau({ config: c, leases: o.leases, policy: pol, now }), nomsSans = nomsReseau({ config: c, leases: o.leases, policy: { ...pol, etats: {} }, now }), domaine = c.domain ?? 'maison';
  const appareils: Appareil[] = [];
  for (const mac of macs) {
    if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) continue;
    const lease = o.leases.find((l) => l.mac.toLowerCase() === mac), fixe = c.fixed.find((f) => f.mac.toLowerCase() === mac);
    const vivant = Boolean(lease && lease.expires > now);
    const etat: EtatAppareil = pol.attente.includes(mac) ? 'attente' : pol.etats[mac] ?? 'actif';
    const tenue = vivant ? lease!.ip : '', reservee = fixe?.ip ?? '';
    // Le garde-fou regarde aussi l'adresse d'un bail fini : dans le doute, on ne coupe pas la box.
    const siennes = [tenue, reservee, lease?.ip ?? ''].filter(Boolean);
    const garde: Appareil['garde'] = odin.has(mac) || siennes.includes(c.server) ? 'odin' : box.has(mac) || siennes.includes(c.router) ? 'box' : c.dns.some((d) => siennes.includes(d)) ? 'dns' : '';
    const retire = etat === 'bloque' && !vivant;
    const ip = retire ? '' : tenue || reservee;
    const brut = texteSur(lease?.name ?? fixe?.name ?? '');
    const prive = randomMac(mac), fabricant = prive ? '' : texteSur(o.fabricant(mac), 40);
    const reg = tenue ? o.registre?.(tenue) : undefined;
    const type = typeDevine({ nom: brut, classe: lease?.vendorClass, fabricant, registre: texteSur(`${reg?.kind ?? ''} ${reg?.model ?? ''}`, 80), garde });
    const nom = brut || (garde === 'box' ? 'Box internet' : garde === 'odin' ? 'Odin (ce serveur)' : garde === 'dns' ? 'Serveur DNS de la maison' : 'Appareil sans nom');
    // Son nom dans le DNS : celui que le DNS sert vraiment (un nom réservé ou déjà pris par un autre n'est pas servi).
    const etiquette = noms.get(mac) ?? '';
    const nomReseau = etiquette && etat !== 'bloque' ? `${etiquette}.${domaine}` : '';
    const dns = tenue ? o.dernierDns?.(tenue) ?? 0 : 0;
    const vu = Math.max(lease?.seen ?? 0, dns, o.dernierDhcp?.(mac) ?? 0), connecte = garde === 'odin' || (!retire && vu > 0 && now - vu < SIGNE_MS);
    const premier = lease?.first ?? 0;
    const nouveau = !garde && !fixe && (etat === 'attente' || (etat === 'actif' && pol.etats[mac] === undefined && premier > 0 && now - premier < NOUVEAU_MS));
    appareils.push({
      mac, nom, nomDonne: Boolean(lease?.named) || Boolean(fixe?.name), nomReseau, ip, fixe: Boolean(fixe) || Boolean(lease?.fixed), reservee: texteSur(reservee, 15), prive, fabricant, type, typeNom: TYPES[type],
      systeme: texteSur(osFromVendorClass(lease?.vendorClass) ?? '', 40), etat,
      presence: connecte ? 'vu' : vivant ? 'bail' : 'absent', connecte, vu, depuis: vivant ? lease!.since ?? lease!.first ?? 0 : 0, jusqua: vivant ? lease!.expires : 0, premier,
      nouveau, garde, ici: Boolean(ici) && (ici === tenue || (!tenue && ici === reservee)), retire, coupeDns: etat === 'bloque' && vivant && o.dnsAllume,
      effets: effetsDe({ ip: tenue, vivant, jusqua: lease?.expires ?? 0, nomReseau: nomsSans.get(mac) ? `${nomsSans.get(mac)}.${domaine}` : '', prive }, o),
    });
  }
  const rang = (d: Appareil) => (d.ip ? ipNum(d.ip) : 0xffffffff);
  appareils.sort((a, b) => rang(a) - rang(b) || a.mac.localeCompare(b.mac));
  return { dhcp: { allume: o.dhcpAllume, mode: pol.mode, debut: c.start, fin: c.end, dns: o.dnsAllume }, origineConnue: Boolean(ici) && (surOdin(ici) || ici === c.server || appareils.some((d) => d.ici)), chiffres: chiffresDe(appareils), appareils };
}
export function chiffresDe(l: Appareil[]): VueAppareils['chiffres'] {
  return { connectes: l.filter((d) => d.connecte && d.etat === 'actif').length, connus: l.length, nouveaux: l.filter((d) => d.nouveau).length, bloques: l.filter((d) => d.etat === 'bloque' || d.etat === 'pause').length };
}

/**
 * Le garde-fou de « bloquer » et « mettre en pause ». Débloquer passe toujours. Refusé : la box (la passerelle), Odin
 * lui-même, le serveur DNS donné à toute la maison, et l'appareil depuis lequel on agit tant qu'on ne l'a pas dit en
 * clair (`leMien`). Pur.
 */
export function gardeEtat(d: Pick<Appareil, 'garde' | 'ici' | 'nom'> | undefined, etat: 'actif' | 'pause' | 'bloque', o: { leMien?: boolean } = {}): { refus?: string; code?: 'box' | 'odin' | 'dns' | 'ici' } {
  if (etat === 'actif' || !d) return {};
  const geste = etat === 'bloque' ? 'bloquer' : 'mettre en pause';
  if (d.garde === 'box') return { code: 'box', refus: `Refusé : « ${d.nom} » est la box, la passerelle de toute la maison. La ${geste} couperait Internet à tout le monde.` };
  if (d.garde === 'odin') return { code: 'odin', refus: `Refusé : « ${d.nom} » est Odin lui-même. Le ${geste} couperait les adresses, les noms et cette page.` };
  if (d.garde === 'dns') return { code: 'dns', refus: `Refusé : « ${d.nom} » est le serveur DNS de la maison (celui qu'Odin donne à tous les appareils). Le ${geste} couperait les noms, donc Internet, à tout le monde. Change d'abord le DNS donné aux appareils (réglages du DHCP).` };
  if (d.ici && !o.leMien) return { code: 'ici', refus: `Attention : « ${d.nom} » est l'appareil que tu tiens en ce moment. Le ${geste} te couperait d'Odin, et tu ne pourrais plus revenir en arrière depuis cet appareil. Rien n'est fait. Si tu le veux vraiment, dis-le en clair depuis sa fiche (« C'est mon appareil, ${geste} quand même »).` };
  return {};
}
