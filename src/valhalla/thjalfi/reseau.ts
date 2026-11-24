// Genèse · le serveur de démarrage, côté réseau (maquette validée « Genèse · Systèmes », lot S8) :
//   - les cartes réseau de ce PC (câble conseillé, Wi-Fi déconseillé, réseau à part) ;
//   - les quatre façons de donner « où démarrer » aux PC :
//       « proxy »   : à côté de la box. La box garde les adresses ; Odin répond seulement aux PC qui démarrent par le
//                     réseau (ports 67 et 4011), sans jamais donner d'adresse. Rien à régler sur la box (conseillé) ;
//       « complet » : Odin distribue les adresses, SEULEMENT sur un réseau à part (câble direct, carte virtuelle) ;
//       « odin »    : le serveur d'adresses d'Odin (Sphinx) donne déjà les adresses de la maison et ajoute le démarrage ;
//       « aucun »   : la box s'en charge : Odin montre les lignes exactes à recopier (selon le micrologiciel du PC) ;
//   - LE GARDE-FOU : avant de distribuer des adresses, Odin demande sur la carte choisie si un autre serveur d'adresses
//     répond ; s'il y en a un (la box), c'est refusé. Il revérifie chaque minute et s'arrête aussitôt s'il en apparaît
//     un, ou s'il voit un PC parler à un autre serveur, ou un PC d'un autre réseau.
// Le mode complet n'écoute que l'adresse de la carte choisie (jamais toutes les cartes) : une demande venue du réseau de
// la box n'y arrive pas. Aucun paquet n'est envoyé ici sans qu'on le demande ; les essais remplacent les prises réseau.
import dgram from 'node:dgram';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { buildPacket, DhcpServer, ipNum, MSG, numIp, parsePacket, pxeHook, type DhcpDeps, type Packet } from '../vidarr/dhcp.ts';

export type ModeAdresses = 'proxy' | 'complet' | 'odin' | 'aucun';
export const MODES_ADRESSES: ModeAdresses[] = ['proxy', 'complet', 'odin', 'aucun'];
export const modeAdresses = (x: unknown): ModeAdresses => (MODES_ADRESSES.includes(x as ModeAdresses) ? x as ModeAdresses : 'proxy');

export type GenreCarte = 'cable' | 'wifi' | 'virtuelle';
export interface CarteReseau { nom: string; ip: string; masque: string; prefixe: number; mac?: string; genre: GenreCarte }

/** Un tunnel (VPN) d'après le nom de la carte. Exporté pour le serveur d'adresses de la maison (Sphinx, lot R4). */
export const VPN = /^(tun|tap|utun|wg|ppp|zt)\d*$|vpn|wireguard|tailscale|zerotier|tap-windows|wintun|anyconnect|fortinet|globalprotect|nordlynx/i;
const WIFI = /wi-?fi|wlan|wlp|wlx|wireless|sans fil|802\.11|airport/i;
const VIRTUELLE = /^(odin0|od[0-9a-f]{10}[hc]|docker\d*|br-[0-9a-f]+|veth|virbr|vnet|tap|tun|vboxnet|vmnet|vEthernet|VirtualBox|VMware|Hyper-V|lxcbr|lxdbr|podman|cni|flannel|zt|tailscale|wg)/i;
/** Le genre d'une carte d'après son nom (le système ne dit rien d'autre). Pur. */
export function genreCarte(nom: string): GenreCarte { return WIFI.test(nom) ? 'wifi' : VIRTUELLE.test(nom) ? 'virtuelle' : 'cable'; }

const prefixeDe = (masque: string) => { const n = ipNum(masque); let p = 0; for (let b = 31; b >= 0 && (n >>> b) & 1; b--) p++; return p; };
const masqueDe = (p: number) => numIp(p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0);
export const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
/** Une adresse des réseaux privés (10/8, 172.16/12, 192.168/16) ? Pur. */
export function privee(ip: string): boolean { if (!IPV4.test(ip)) return false; const [a, b] = ip.split('.').map(Number); return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168); }

/** Les cartes réseau de ce PC, en IPv4 (sans la boucle locale). Pur (on lui donne la liste du système). */
export function cartesReseau(ifs: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): CarteReseau[] {
  const out: CarteReseau[] = [];
  for (const [nom, l] of Object.entries(ifs)) for (const a of l ?? []) {
    if (!a || a.family !== 'IPv4' || a.internal || !IPV4.test(a.address) || a.address.startsWith('169.254.')) continue;
    const p = Number.isInteger(Number(String(a.cidr ?? '').split('/')[1])) ? Number(String(a.cidr).split('/')[1]) : prefixeDe(a.netmask);
    out.push({ nom, ip: a.address, masque: masqueDe(p), prefixe: p, ...(a.mac && a.mac !== '00:00:00:00:00:00' ? { mac: a.mac.toLowerCase() } : {}), genre: genreCarte(nom) });
  }
  // Le câble d'abord (conseillé), puis le réseau à part, puis le Wi-Fi.
  const rang: Record<GenreCarte, number> = { cable: 0, virtuelle: 1, wifi: 2 };
  return out.sort((x, y) => rang[x.genre] - rang[y.genre] || x.nom.localeCompare(y.nom));
}
/** Réseau et diffusion de la carte. Pur. */
export function sousReseau(c: Pick<CarteReseau, 'ip' | 'prefixe'>): { reseau: number; diffusion: number } {
  const m = c.prefixe === 0 ? 0 : (0xffffffff << (32 - c.prefixe)) >>> 0, r = (ipNum(c.ip) & m) >>> 0;
  return { reseau: r, diffusion: (r | (~m >>> 0)) >>> 0 };
}
export const dansSousReseau = (c: Pick<CarteReseau, 'ip' | 'prefixe'>, ip: string) => { if (!IPV4.test(ip)) return false; const { reseau, diffusion } = sousReseau(c), n = ipNum(ip); return n > reseau && n < diffusion; };

export interface PlageComplet { debut: string; fin: string; masque: string; passerelle: string; dns: string[]; bail: number }
/** Une plage proposée sur la carte : .100 à .199 d'un /24, sinon les 100 adresses après celle de la carte. Pur. */
export function plageParDefaut(c: CarteReseau): PlageComplet {
  const { reseau, diffusion } = sousReseau(c), n = ipNum(c.ip);
  let d = reseau + 100, f = reseau + 199;
  if (f >= diffusion || (n >= d && n <= f)) { d = n + 1; f = Math.min(diffusion - 1, n + 100); }
  return { debut: numIp(d), fin: numIp(f), masque: c.masque, passerelle: c.ip, dns: [c.ip], bail: 2 * 3600 };
}
/** Au plus 1 000 adresses, un bail de 5 min à 1 jour. */
export const PLAGE_MAX = 1000, BAIL_MIN = 300, BAIL_MAX = 86_400;
/**
 * La plage demandée, revue pour cette carte : dans son sous-réseau, sans son adresse, première avant dernière, 1 000
 * adresses au plus, passerelle et DNS dans le réseau à part. Le refus en mots simples, ou la plage propre. Pur.
 */
export function verifierPlage(c: CarteReseau, i: { debut?: unknown; fin?: unknown; passerelle?: unknown; bail?: unknown }): PlageComplet | { refus: string } {
  const base = plageParDefaut(c), t = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
  const debut = t(i.debut) || base.debut, fin = t(i.fin) || base.fin, passerelle = t(i.passerelle) || c.ip;
  for (const [nom, v] of [['La première adresse', debut], ['La dernière adresse', fin], ['La passerelle', passerelle]] as const) {
    if (!IPV4.test(v)) return { refus: `${nom} n'est pas une adresse (ex. ${base.debut}).` };
    if (!dansSousReseau(c, v)) return { refus: `${nom} (${v}) n'est pas sur le réseau de la carte ${c.nom} (${numIp(sousReseau(c).reseau)}/${c.prefixe}).` };
  }
  const a = ipNum(debut), b = ipNum(fin), me = ipNum(c.ip);
  if (a > b) return { refus: 'La première adresse doit venir avant la dernière.' };
  if (b - a + 1 > PLAGE_MAX) return { refus: `${PLAGE_MAX} adresses au plus.` };
  if (me >= a && me <= b) return { refus: `La plage contient l'adresse d'Odin sur cette carte (${c.ip}) : choisis-la à côté.` };
  const bail = Math.round(Number(i.bail ?? base.bail));
  if (!Number.isFinite(bail) || bail < BAIL_MIN || bail > BAIL_MAX) return { refus: 'Le bail dure de 5 minutes à 1 jour.' };
  return { debut, fin, masque: c.masque, passerelle, dns: [c.ip], bail };
}
/**
 * Peut-on distribuer des adresses sur cette carte ? Jamais sur le Wi-Fi (c'est celui de la box, et un PC ne démarre
 * pas par le Wi-Fi), jamais hors d'un réseau privé, et pour l'instant seulement sous Windows : ailleurs, Odin ne sait
 * pas encore écouter UNE seule carte, et il refuse plutôt que d'écouter toutes les cartes. Le refus, ou rien. Pur.
 */
export function refusCarte(c: CarteReseau | undefined, plateforme: string, toutes: CarteReseau[] = []): string | undefined {
  if (!c) return 'Choisis d\'abord la carte réseau du réseau à part.';
  if (c.genre === 'wifi') return `${c.nom} est une carte Wi-Fi : c'est le réseau de la box, et un PC ne démarre pas par le Wi-Fi. Prends un câble direct ou une carte virtuelle.`;
  if (VPN.test(c.nom)) return `${c.nom} est un tunnel (VPN) : il mène à un autre réseau. Odin n'y distribue rien.`;
  if (!privee(c.ip)) return `${c.nom} (${c.ip}) n'est pas sur un réseau privé : Odin n'y distribue rien.`;
  const meme = refusPartage(c, toutes); if (meme) return meme;
  if (plateforme !== 'win32') return 'Sur ce système, Odin ne sait pas encore écouter une seule carte : il ne distribue pas d\'adresses (il écouterait aussi le réseau de la box). Garde « À côté de la box ».';
  return undefined;
}

/**
 * Une carte à deux adresses, ou deux cartes sur le même réseau : les réponses d'Odin pourraient partir par la mauvaise
 * carte (celle de la box). Refusé plutôt que deviné. Le refus, ou rien. Pur.
 */
export function refusPartage(c: CarteReseau, toutes: CarteReseau[]): string | undefined {
  if (toutes.some((x) => x.nom === c.nom && x.ip !== c.ip)) return `${c.nom} a plusieurs adresses : Odin ne sait pas laquelle est le réseau à part. Garde-lui une seule adresse.`;
  const { reseau: r1, diffusion: d1 } = sousReseau(c);
  const meme = toutes.find((x) => { if (x.nom === c.nom) return false; const { reseau: r2, diffusion: d2 } = sousReseau(x); return r1 <= d2 && r2 <= d1; });
  if (meme) return `${c.nom} et ${meme.nom} sont sur le même réseau (${numIp(r1)}/${c.prefixe}) : Odin pourrait répondre par la mauvaise carte. Un réseau à part a sa carte à lui.`;
  return undefined;
}

/** Le texte du garde-fou de la box (maquette, écran 13b). Pur. */
export function texteRefusBox(autres: string[]): string {
  const qui = autres.length ? autres.slice(0, 4).join(', ') : 'un autre serveur';
  return `Refusé : ça casserait le réseau de la maison. ${autres.length > 1 ? `Des serveurs d'adresses (${qui}) répondent` : `Un serveur d'adresses (${qui}, souvent la box) répond`} déjà sur cette carte. Deux serveurs à la fois : les téléphones, la télé et les PC n'auraient plus Internet. Garde « À côté de la box », ou choisis un réseau à part.`;
}

// ---------------- Chercher un autre serveur d'adresses sur UNE carte ----------------
/** Ce dont la recherche a besoin d'une prise réseau (une vraie, ou une simulée dans les essais). */
export interface PriseUdp {
  on(e: 'message', f: (m: Buffer, r: { address: string; port: number }) => void): unknown;
  on(e: 'error', f: (e: Error) => void): unknown;
  bind(port: number, host: string, f: () => void): unknown;
  setBroadcast(v: boolean): void;
  send(b: Buffer, port: number, to: string, f?: (e: Error | null) => void): void;
  close(): void;
}
export interface Recherche { serveurs: string[]; erreur?: string }
/**
 * Pose la question « qui donne les adresses ? » sur la carte, comme un PC, et écoute. Sous Windows, la prise est
 * attachée à l'adresse de la carte : la question part par elle et seules ses réponses arrivent. Ailleurs, la question
 * part vers la diffusion de son sous-réseau et TOUTE réponse compte (plus prudent). Une prise qui ne s'ouvre pas, ou un
 * envoi refusé : « erreur », jamais « personne ». Toute réponse d'un autre que la carte elle-même compte.
 */
export function chercherServeurs(c: CarteReseau, o: { portServeur?: number; portClient?: number; attente?: number; plateforme?: string; prise?: () => PriseUdp } = {}): Promise<Recherche> {
  return new Promise((ok) => {
    const s = o.prise ? o.prise() : dgram.createSocket({ type: 'udp4', reuseAddr: true }) as unknown as PriseUdp;
    const win = (o.plateforme ?? process.platform) === 'win32', vus = new Set<string>(), xid = Math.floor(Math.random() * 0xffffffff);
    const mac = `02:${[...Array(5)].map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(':')}`;
    let fini = false, minuteur: ReturnType<typeof setTimeout> | undefined;
    const fin = (erreur?: string) => { if (fini) return; fini = true; if (minuteur) clearTimeout(minuteur); try { s.close(); } catch { /* déjà fermée */ } ok({ serveurs: [...vus], ...(erreur ? { erreur } : {}) }); };
    s.on('error', (e) => fin(`la recherche n'a pas pu se faire (${e.message})`));
    s.on('message', (m, r) => {
      let p: Packet; try { p = parsePacket(m); } catch { return; }
      // Notre réponse, ou celle d'un serveur à un autre PC pendant l'écoute : dans les deux cas, un serveur d'adresses est là.
      const t = p.options.get(53)?.[0];
      if (p.op !== 2 || (p.xid !== xid && t !== MSG.OFFER && t !== MSG.ACK && t !== MSG.NAK)) return;
      const id = p.options.get(54), qui = id?.length === 4 ? `${id[0]}.${id[1]}.${id[2]}.${id[3]}` : p.siaddr !== '0.0.0.0' ? p.siaddr : r.address;
      if (qui !== c.ip) vus.add(qui);
    });
    s.bind(o.portClient ?? 68, win ? c.ip : '0.0.0.0', () => {
      try { s.setBroadcast(true); } catch (e) { fin(`la recherche n'a pas pu se faire (${(e as Error).message})`); return; }
      const q = buildPacket({ op: 1, xid, mac, flags: 0x8000, options: [[53, Buffer.from([MSG.DISCOVER])], [55, Buffer.from([1, 3, 6, 15, 66, 67])], [60, Buffer.from('PXEClient:Arch:00000:UNDI:002001')]] });
      const vers = win ? ['255.255.255.255'] : [numIp(sousReseau(c).diffusion)];
      for (const v of vers) s.send(q, o.portServeur ?? 67, v, (e) => { if (e) fin(`la question n'a pas pu partir (${e.message})`); });
      minuteur = setTimeout(() => fin(), o.attente ?? 3000);
    });
  });
}

// ---------------- Le garde-fou ----------------
export type EtatGarde = 'non_verifie' | 'libre' | 'occupe' | 'coupe';
export interface Garde { etat: EtatGarde; carte?: string; autres: string[]; verifie?: number; raison?: string }
/** Ce que le garde-fou conclut d'une recherche : libre, occupé (un autre serveur), ou « pas vérifié » (erreur = refus). Pur. */
export function conclure(r: Recherche, carte: string, now: number, enMarche: boolean): Garde {
  if (r.serveurs.length) return { etat: enMarche ? 'coupe' : 'occupe', carte, autres: r.serveurs.slice(0, 8), verifie: now, raison: texteRefusBox(r.serveurs) };
  if (r.erreur) return { etat: enMarche ? 'coupe' : 'non_verifie', carte, autres: [], verifie: now, raison: `Odin n'a pas pu vérifier qu'aucun autre serveur d'adresses ne répond sur ${carte} : ${r.erreur}. Par prudence, il ne distribue rien.` };
  return { etat: 'libre', carte, autres: [], verifie: now };
}

// ---------------- Le serveur d'adresses d'un réseau à part ----------------
export interface DepsAPart extends DhcpDeps {
  /** l'adresse d'Odin sur la carte du réseau à part, et son sous-réseau */
  carte: () => CarteReseau;
  /** ce qu'il faut ajouter pour qu'un PC démarre (chargeur, menu) ; rien pour un appareil ordinaire */
  demarrage: (p: Packet) => ReturnType<NonNullable<typeof pxeHook.get>>;
  /** un signe qu'un autre serveur d'adresses, ou un autre réseau, est sur cette carte : Odin doit s'arrêter */
  alerte: (raison: string, autre?: string) => void;
}
/**
 * Le serveur d'adresses du mode « complet » : celui d'Odin (mêmes baux, mêmes règles par adresse MAC), plus trois
 * prudences. Il ne répond pas à une demande relayée d'un autre réseau ; il s'arrête s'il voit un PC parler à un autre
 * serveur (sa demande en nomme un autre) ou un PC qui a déjà une adresse d'un autre réseau ; et le démarrage qu'il
 * ajoute n'est que le sien, jamais celui du serveur d'adresses de la maison.
 */
export class DhcpAPart extends DhcpServer {
  private a: DepsAPart; arrete = false;
  constructor(d: DepsAPart) { super(d); this.a = d; }
  /** N'écoute QUE l'adresse d'une carte (jamais 0.0.0.0) ; une panne de la prise (carte coupée, adresse partie) arrête tout et prévient, sans faire tomber Odin. */
  override async start(port = 67, clientPort = 68, host = ''): Promise<void> {
    if (!IPV4.test(host) || host === '0.0.0.0') throw new Error('le réseau à part écoute une seule carte, jamais toutes');
    await super.start(port, clientPort, host);
    this.sock?.on('error', (e) => { if (this.arrete) return; this.arrete = true; this.a.alerte(`la prise réseau de la carte ne répond plus (${e.message})`); });
  }
  override onMessage(m: Buffer, r?: dgram.RemoteInfo): void {
    if (this.arrete) return;
    let p: Packet; try { p = parsePacket(m); } catch { return; }
    if (p.op !== 1) return;
    const c = this.a.carte(), type = p.options.get(53)?.[0];
    if (p.giaddr !== '0.0.0.0') return; // relayé d'ailleurs : jamais
    const sid = p.options.get(54), autre = sid?.length === 4 ? `${sid[0]}.${sid[1]}.${sid[2]}.${sid[3]}` : undefined;
    if (type === MSG.REQUEST && autre && autre !== c.ip) { this.arrete = true; this.a.alerte(`un PC (${p.mac}) demande son adresse à un autre serveur (${autre}) sur cette carte`, autre); return; }
    // Quel que soit le message : une réponse à cette adresse partirait vers un autre réseau (par la box).
    if (p.ciaddr !== '0.0.0.0' && !dansSousReseau(c, p.ciaddr)) { this.arrete = true; this.a.alerte(`un PC (${p.mac}) a déjà une adresse d'un autre réseau (${p.ciaddr}) sur cette carte`); return; }
    // Le démarrage ajouté est celui de Genèse pour ce réseau ; le crochet de la maison est remis tel quel juste après.
    const avant = pxeHook.get;
    pxeHook.get = (q) => this.a.demarrage(q);
    try { super.onMessage(m, r); } finally { pxeHook.get = avant; }
  }
}

// ---------------- « Ma box s'en charge » : les lignes à recopier ----------------
/**
 * Les réglages exacts à mettre dans la box ou le serveur d'adresses existant : l'adresse d'Odin (option 66), le fichier
 * selon le micrologiciel du PC (option 93 : BIOS, UEFI 64 bits, UEFI 32 bits, ARM 64 bits), puis le menu d'Odin en HTTP
 * une fois le chargeur lancé. Un PC en UEFI qui reçoit le fichier du BIOS ne démarre pas : d'où la règle par option 93. Pur.
 */
export function lignesBox(ip: string, port: number): { simple: string[]; dhcpd: string; dnsmasq: string; http: string } {
  const menu = `http://${ip}:${port}/boot.ipxe`;
  return {
    simple: [`Option 66 (serveur de démarrage) : ${ip}`, 'Option 67 (fichier) : ipxe.efi pour les PC en UEFI, undionly.kpxe pour les PC en BIOS', 'Si la box ne sait donner qu\'un seul fichier : ipxe.efi (les PC récents sont en UEFI)'],
    dhcpd: ['option arch code 93 = unsigned integer 16;', `next-server ${ip};`, 'if exists user-class and option user-class = "iPXE" {', `  filename "${menu}";`, '} elsif option arch = 7 or option arch = 9 {', '  filename "ipxe.efi";', '} elsif option arch = 6 {', '  filename "ipxe-i386.efi";', '} elsif option arch = 11 {', '  filename "ipxe-arm64.efi";', '} else {', '  filename "undionly.kpxe";', '}'].join('\n'),
    dnsmasq: ['dhcp-match=set:ipxe,175', 'dhcp-match=set:efi64,option:client-arch,7', 'dhcp-match=set:efi64,option:client-arch,9', 'dhcp-match=set:efi32,option:client-arch,6', 'dhcp-match=set:arm64,option:client-arch,11', `dhcp-boot=tag:ipxe,${menu}`, `dhcp-boot=tag:!ipxe,tag:efi64,ipxe.efi,,${ip}`, `dhcp-boot=tag:!ipxe,tag:efi32,ipxe-i386.efi,,${ip}`, `dhcp-boot=tag:!ipxe,tag:arm64,ipxe-arm64.efi,,${ip}`, `dhcp-boot=tag:!ipxe,tag:!efi64,tag:!efi32,tag:!arm64,undionly.kpxe,,${ip}`].join('\n'),
    http: menu,
  };
}

/**
 * Ce que Genèse demande au système (cartes, recherche, écoute) : les vrais appels par défaut. Les essais les remplacent
 * pour ne jamais toucher un vrai réseau ni ouvrir un vrai port de serveur d'adresses.
 */
export const RESEAU: {
  cartes: () => CarteReseau[];
  chercher: (c: CarteReseau, ports: { serveur: number; client: number }) => Promise<Recherche>;
  ecouter: (srv: DhcpAPart, port: number, client: number, host: string) => Promise<void>;
  plateforme: () => string;
} = {
  cartes: () => cartesReseau(),
  chercher: (c, p) => chercherServeurs(c, { portServeur: p.serveur, portClient: p.client }),
  ecouter: (srv, port, client, host) => srv.start(port, client, host),
  plateforme: () => process.platform,
};
