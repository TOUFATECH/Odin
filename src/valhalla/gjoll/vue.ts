// Vortex · « Appareils » et « Tunnel » (maquette « Réseau » validée, lot R7). Ici, la partie pure (aucune prise réseau,
// aucun fichier, aucune commande) :
//  - `vueVpn` : chaque appareil du VPN tel que la page le montre (nom nettoyé, adresse dans le VPN, connecté ou non,
//    dernière connexion, depuis où (l'adresse vue par le tunnel, sans aucun service de géolocalisation), trafic), et
//    l'état du tunnel. JAMAIS une clé : ni la clé privée d'un appareil, ni sa clé partagée, ni la clé d'Odin ;
//  - `gardeVpn` : jamais couper ni retirer l'appareil que le propriétaire tient sans qu'il le dise en clair ;
//  - `avisOrigine` : la phrase d'avertissement des confirmations (lue aussi hors de la page : parole, outil) ;
//  - `adresseBoxSure` : ce que la box répond quand on lui demande l'adresse de la maison est un texte venu du réseau.
import { isPrivateV4 } from '../../hlidskjalf/discover.ts';
import { texteSur } from '../vidarr/appareils.ts';

/** Un appareil est « connecté » si le tunnel a eu une poignée de main avec lui depuis moins de 3 minutes. */
export const CONNECTE_MS = 180_000;

/** Ce que la vue lit d'un appareil enregistré. Les clés n'y sont pas : la vue ne peut pas les recopier. */
export interface PairVu { name: string; pub: string; ip: string; created?: string; enabled: boolean; full: boolean; mesh?: boolean; expires?: string; odinDns?: boolean; compte?: string }
/** Ce que le moteur du tunnel sait d'un appareil en ce moment. */
export interface EnDirect { handshake: number; rx: number; tx: number; endpoint: string }
/** Ce qu'Odin a gardé de la dernière connexion d'un appareil (le tunnel éteint ou Odin redémarré, la carte le dit encore). */
export interface Dernier { t: number; de: string }

export interface AppareilVpn {
  /** le nom, nettoyé (jamais du HTML, jamais un caractère de contrôle) */
  nom: string;
  /** son adresse dans le VPN */
  ip: string;
  etat: 'connecte' | 'absent' | 'jamais' | 'coupe' | 'fini';
  connecte: boolean;
  /** dernière connexion (0 : jamais) */
  vu: number;
  /** depuis où : l'adresse vue par le tunnel (sans le port), vide si inconnue */
  depuis: string;
  /** « maison » : une adresse du réseau privé ; « dehors » : une adresse d'Internet */
  ou: 'maison' | 'dehors' | '';
  /** trafic du jour, vu de l'appareil (octets) */
  recu: number; envoye: number;
  acces: 'tout' | 'maison';
  /** fin de l'accès (AAAA-MM-JJ), vide : sans fin */
  fin: string;
  dnsOdin: boolean;
  /** l'appareil depuis lequel la demande est faite */
  ici: boolean;
}
export interface TunnelVpn {
  allume: boolean;
  /** pourquoi le moteur ne peut pas tourner sur cette machine (vide : il le peut) */
  moteur: string;
  port: number;
  /** l'adresse (ou le nom de domaine) par laquelle les appareils joignent la maison ; vide : pas encore connue */
  adresse: string;
  /** comment elle a été trouvée : lue sur la box, écrite à la main, ou on ne sait plus (réglée avant ce lot) */
  trouvee: 'box' | 'main' | '';
  /** la dernière lecture sur la box : quand, réussie ou non, ce qu'Odin en dit, et l'adresse que la box a donnée */
  box: { quand: number; ok: boolean; texte: string; ip: string } | null;
  /** le port sur la box : ouvert par Odin, noté ouvert à la main, pas ouvert, ou ouvert mais sans adresse Internet à elle */
  portBox: 'odin' | 'main' | 'non' | 'partage';
  /** le réseau du VPN, et les réseaux de la maison ouverts aux appareils */
  reseau: string; maison: string[];
  /** le DNS donné aux appareils (vide : chacun garde le sien) */
  dns: string;
}
export interface VueVpn {
  proprietaire: boolean;
  /** Odin sait-il depuis quel appareil la demande est faite ? */
  origineConnue: boolean;
  /** ce qu'un membre de la famille doit savoir sur ce qu'il voit (vide pour le propriétaire) */
  limite: string;
  chiffres: { connectes: number; appareils: number; coupes: number; recu: number; envoye: number };
  appareils: AppareilVpn[];
  /** pour un membre : seulement « allumé ou non » (le reste est `null`) */
  tunnel: TunnelVpn | null;
  allume: boolean;
}

export const LIMITE_MEMBRE_VPN = 'Tu ne vois que les appareils du VPN rattachés à ton compte. La liste de tous les appareils, l\'adresse de la maison, et les gestes (couper, rouvrir, retirer) sont au propriétaire seul.';

/** L'adresse seule d'un « adresse:port » du tunnel (« [::ffff:198.51.100.23]:51820 » → « 198.51.100.23 »). Pur. */
export function hoteDe(endpoint: string): string {
  const t = String(endpoint ?? '').trim(); if (!t) return '';
  const m = /^\[([^\]]+)\](?::\d+)?$/.exec(t) ?? /^([^:]+):\d+$/.exec(t) ?? /^(.+):\d+$/.exec(t);
  const h = (m ? m[1] : t).replace(/^::ffff:/i, '');
  return /^[0-9a-f:.]{2,45}$/i.test(h) ? h.toLowerCase() : '';
}

/** D'où vient la connexion, sans rien demander à personne : une adresse privée est « la maison », le reste « dehors ». Pur. */
export const ouEst = (ip: string): 'maison' | 'dehors' | '' => (!ip ? '' : isPrivateV4(ip) || /^(127\.|169\.254\.|fe80:|f[cd][0-9a-f]{2}:|::1$)/i.test(ip) ? 'maison' : 'dehors');

/** Le nom d'un appareil tel qu'on le montre : toujours nettoyé. */
export const nomVpn = (v: unknown): string => texteSur(v, 40) || 'Appareil sans nom';

/**
 * L'appareil désigné par `nom` : le nom exact d'abord ; sinon le nom tel que la page le montre (nettoyé), s'il ne
 * désigne qu'un seul appareil. Jamais « le premier qui ressemble ». Pur.
 */
export function trouverPair<T extends { name: string }>(l: T[], nom: unknown): T | undefined {
  const n = String(nom ?? ''); if (!n) return undefined;
  const exact = l.find((p) => p.name === n); if (exact) return exact;
  const proches = l.filter((p) => nomVpn(p.name) === nomVpn(n));
  return proches.length === 1 ? proches[0] : undefined;
}

export interface EntreeVpn {
  pairs: PairVu[];
  direct: Map<string, EnDirect>;
  derniers: Record<string, Dernier>;
  /** trafic du jour par nom d'appareil (octets envoyés et reçus par l'appareil) */
  trafic: Map<string, { up: number; down: number }>;
  now: number;
  /** l'adresse d'où vient la demande (vide : inconnue) */
  origine: string;
  /** le compte du membre qui demande (absent : le propriétaire) */
  membre?: string;
  tunnel: TunnelVpn;
}

/** Tout ce que la page montre. Les clés des appareils ne passent pas par ici. Pur. */
export function vueVpn(o: EntreeVpn): VueVpn {
  const jour = new Date(o.now).toISOString().slice(0, 10), origine = o.origine.trim().toLowerCase().replace(/^::ffff:/, '').replace(/%.*$/, '');
  const tous = o.pairs.map((p): AppareilVpn & { compte?: string } => {
    const x = o.direct.get(p.pub), d = o.derniers[p.pub];
    const vu = Math.max(x?.handshake ?? 0, d?.t ?? 0), depuis = hoteDe(x?.endpoint ?? '') || hoteDe(d?.de ?? '');
    const fini = Boolean(p.expires && p.expires < jour), connecte = Boolean(p.enabled && x?.handshake && o.now - x.handshake < CONNECTE_MS);
    const t = o.trafic.get(p.name) ?? { up: 0, down: 0 };
    return {
      nom: nomVpn(p.name), ip: texteSur(p.ip, 45), connecte, vu, depuis, ou: ouEst(depuis), recu: t.down, envoye: t.up,
      etat: fini ? 'fini' : !p.enabled ? 'coupe' : connecte ? 'connecte' : vu ? 'absent' : 'jamais',
      acces: p.full ? 'tout' : 'maison', fin: /^\d{4}-\d{2}-\d{2}$/.test(p.expires ?? '') ? String(p.expires) : '', dnsOdin: Boolean(p.odinDns),
      // « L'appareil que tu tiens » : la demande vient de son adresse dans le VPN, ou de l'adresse d'où il est connecté en ce moment.
      ici: Boolean(origine) && (origine === p.ip || (connecte && Boolean(depuis) && origine === depuis)),
      compte: p.compte,
    };
  });
  const liste = (o.membre === undefined ? tous : tous.filter((d) => d.compte === o.membre)).map(({ compte: _c, ...d }) => d);
  return {
    proprietaire: o.membre === undefined, origineConnue: Boolean(origine), limite: o.membre === undefined ? '' : liste.length ? LIMITE_MEMBRE_VPN : `Aucun appareil du VPN n'est rattaché à ton compte. ${LIMITE_MEMBRE_VPN}`,
    chiffres: { connectes: liste.filter((d) => d.connecte).length, appareils: liste.length, coupes: liste.filter((d) => d.etat === 'coupe' || d.etat === 'fini').length, recu: liste.reduce((n, d) => n + d.recu, 0), envoye: liste.reduce((n, d) => n + d.envoye, 0) },
    appareils: liste, tunnel: o.membre === undefined ? o.tunnel : null, allume: o.tunnel.allume,
  };
}

/**
 * Le garde-fou : couper ou retirer l'appareil que le propriétaire tient le couperait d'Odin (dehors, il ne pourrait plus
 * revenir en arrière depuis cet appareil). Refusé tant qu'il ne l'a pas dit en clair (`leMien`). Pur.
 */
export function gardeVpn(d: Pick<AppareilVpn, 'ici' | 'nom'> | undefined, geste: 'couper' | 'retirer', o: { leMien?: boolean } = {}): { refus?: string; code?: 'ici' } {
  if (!d?.ici || o.leMien) return {};
  return { code: 'ici', refus: `Attention : « ${d.nom} » est l'appareil que tu tiens en ce moment. Le ${geste} te couperait d'Odin${geste === 'retirer' ? ', et sa clé ne vaudrait plus rien' : ', et tu ne pourrais plus le rouvrir depuis cet appareil'}. Rien n'est fait. Si tu le veux vraiment, dis-le en clair sur sa carte (« C'est mon appareil, ${geste} quand même »).` };
}

/** L'avertissement d'une confirmation : c'est l'appareil que tu tiens, ou Odin ne sait pas depuis quel appareil tu agis. Pur. */
export function avisOrigine(d: Pick<AppareilVpn, 'ici'> | undefined, origineConnue: boolean): string {
  if (d?.ici) return ' ⚠ ATTENTION : c\'est l\'appareil que tu tiens en ce moment, tu vas te couper d\'Odin.';
  return origineConnue ? '' : ' ⚠ Odin ne sait pas depuis quel appareil tu agis : si c\'est celui que tu tiens, tu perds Odin avec lui.';
}

/**
 * Une adresse par laquelle on joint vraiment la maison depuis Internet ? Pas une adresse privée, ni partagée par
 * l'opérateur (100.64 à 100.127), ni de la machine elle-même, ni réservée (169.254, 192.0.0, 198.18 et 198.19, 224 et plus). Pur.
 */
export function adressePublique(v: unknown): boolean {
  const ip = adresseBoxSure(v); if (!ip) return false;
  const [a, b, c] = ip.split('.').map(Number);
  return !(a === 10 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19)));
}

/** Celui qui a répondu à la place de la box est-il bien la box ? Oui si c'est la passerelle connue de la machine (ou, dans les essais, la machine elle-même). Pur. */
export const estLaBox = (hote: unknown, passerelle: string): boolean => typeof hote === 'string' && hote !== '' && (hote === passerelle || /^127\.\d+\.\d+\.\d+$/.test(hote));

/**
 * L'adresse que la box donne pour la maison : un texte venu du réseau. Gardée seulement si c'est une adresse IPv4 bien
 * écrite ; sinon vide. Pur.
 */
export function adresseBoxSure(v: unknown): string {
  const t = String(v ?? '').trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(t)) return '';
  const p = t.split('.').map(Number);
  return p.every((n) => n >= 0 && n <= 255) && p[0] !== 0 && p[0] < 224 && p[0] !== 127 ? p.join('.') : '';
}
