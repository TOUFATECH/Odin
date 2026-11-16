// Méduse — le cerveau de l'anti-malware pour CE QUI N'EST PAS UN FICHIER : une connexion sortante, une
// requête DNS, un comportement de programme. On rend un VERDICT PUR (pas de réseau, pas de disque) : la
// cible est-elle connue dangereuse, et pourquoi.
//
//  - Une connexion : son adresse IP est-elle dans une liste d'adresses malveillantes (FireHOL niveau 1,
//    Feodo Tracker des serveurs de commande de botnets) ? son domaine ou son lien sont-ils des indicateurs
//    connus (ThreatFox, URLhaus) ? le port est-il un port typique de pirate (minage, porte dérobée, IRC) ?
//  - Une requête DNS : le domaine demandé est-il un indicateur connu (hameçonnage, serveur de commande) ?
//  - Un comportement : l'événement du poste correspond-il à une règle Sigma (persistance, tâche planifiée,
//    service, processus anormal, connexion) ?
//
// Les listes et les indicateurs sont INJECTÉS (le répertoire d'Asclépios, les listes IP de Méduse, les
// règles Sigma déjà chargées) : ce fichier ne lit rien lui-même. C'est ce que la console EDR réutilise sans
// doublon pour juger un signal venu d'un autre poste.

import { evaluerToutes, type Evenement, type RegleCompilee } from './sigma.ts';

/** Ce que Méduse sait reconnaître d'un indicateur : les recherches du répertoire d'Asclépios (Intel). Injecté. */
export interface Repertoire {
  ioc(kind: 'domaine' | 'url' | 'page' | 'ip' | 'paquet' | 'hameçonnage' | 'espion', value: string): { source: string } | undefined;
  site(url: string): { what: 'malware' | 'hameçonnage' | 'logiciel espion'; source: string } | undefined;
}
/** Un réseau en notation entière (adresse, masque), comme le produit `parseList` de Méduse. */
export type Reseau = [number, number];
/** Verdict : dangereux ou non, pourquoi (en clair), d'où vient l'indice, et le genre de menace. */
export interface Verdict { malveillant: boolean; niveau: 'critique' | 'haute' | 'moyenne' | 'sûr'; raison: string; source?: string; genre?: string; details: string[] }

const toInt = (ip: string) => ip.split('.').reduce((a, x) => ((a << 8) | Number(x)) >>> 0, 0);
/** L'adresse IPv4 est-elle dans l'un de ces réseaux ? Pur (repris tel quel de Méduse, sans dépendance croisée). */
export function dansReseaux(ip: string, reseaux: Reseau[]): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const n = toInt(ip);
  return reseaux.some(([net, mask]) => ((n & mask) >>> 0) === net);
}
/** Ports typiques d'un usage de pirate (minage, porte dérobée, IRC de botnet). */
export const PORTS_SUSPECTS: Record<number, string> = { 3333: 'pool de minage', 4444: 'porte dérobée courante', 5555: 'pool de minage / ADB', 6667: 'IRC (botnets)', 14444: 'pool de minage', 1337: 'porte dérobée', 31337: 'porte dérobée' };

/** Une cible de connexion : l'adresse IP jointe, et si on les a, le domaine et le lien visés. */
export interface Connexion { ip?: string; port?: number; domaine?: string; url?: string; programme?: string }
/**
 * Verdict d'une connexion sortante. On compare l'IP aux listes injectées (FireHOL, Feodo), puis le domaine
 * et le lien aux indicateurs connus (ThreatFox, URLhaus via le répertoire), puis le port. Pur.
 */
export function verdictConnexion(c: Connexion, reseaux: Reseau[], rep?: Repertoire): Verdict {
  const details: string[] = [];
  if (c.ip && dansReseaux(c.ip, reseaux)) return { malveillant: true, niveau: 'critique', raison: `l'adresse ${c.ip} est dans une liste publique d'adresses malveillantes (botnet, serveur de commande)`, source: 'FireHOL / Feodo Tracker', genre: 'serveur malveillant', details: [`${c.ip} connue dangereuse`] };
  if (c.url && rep) { const s = rep.site(c.url); if (s) return { malveillant: true, niveau: 'critique', raison: `le lien ${c.url} est un indicateur connu (${s.what})`, source: s.source, genre: s.what, details: [`lien dans ${s.source}`] }; }
  if (c.url && rep) { const u = rep.ioc('url', c.url); if (u) return { malveillant: true, niveau: 'critique', raison: `le lien ${c.url} distribue un malware (connu)`, source: u.source, genre: 'malware', details: [`URLhaus/ThreatFox : ${u.source}`] }; }
  if (c.domaine && rep) { const s = rep.site(c.domaine) ?? (rep.ioc('domaine', c.domaine) ? { what: 'malware' as const, source: rep.ioc('domaine', c.domaine)!.source } : undefined); if (s) return { malveillant: true, niveau: 'haute', raison: `le domaine ${c.domaine} est un indicateur connu (${s.what})`, source: s.source, genre: s.what, details: [`domaine dans ${s.source}`] }; }
  if (c.ip && rep) { const i = rep.ioc('ip', c.ip); if (i) return { malveillant: true, niveau: 'haute', raison: `l'adresse ${c.ip} est un indicateur connu`, source: i.source, genre: 'serveur malveillant', details: [`IP dans ${i.source}`] }; }
  if (c.port != null && PORTS_SUSPECTS[c.port]) { details.push(`port ${c.port} : ${PORTS_SUSPECTS[c.port]}`); return { malveillant: false, niveau: 'moyenne', raison: `port ${c.port} typique d'un usage de pirate (${PORTS_SUSPECTS[c.port]})`, genre: 'port suspect', details }; }
  return { malveillant: false, niveau: 'sûr', raison: 'aucune liste ni indicateur connu ne vise cette connexion', details };
}
/** Verdict d'une requête DNS : le domaine demandé est-il un indicateur connu ? Pur. */
export function verdictDns(domaine: string, rep?: Repertoire): Verdict {
  const d = domaine.trim();
  if (rep) { const s = rep.site(d); if (s) return { malveillant: true, niveau: s.what === 'hameçonnage' ? 'haute' : 'critique', raison: `le domaine ${d} est connu (${s.what})`, source: s.source, genre: s.what, details: [`domaine dans ${s.source}`] }; }
  return { malveillant: false, niveau: 'sûr', raison: `${d} n'est dans aucun indicateur connu`, details: [] };
}
/** Verdict d'un comportement : l'événement du poste déclenche-t-il une règle Sigma ? Pur. */
export function verdictComportement(ev: Evenement, regles: RegleCompilee[]): Verdict {
  const hits = evaluerToutes(ev, regles);
  if (!hits.length) return { malveillant: false, niveau: 'sûr', raison: 'aucune règle de comportement ne correspond', details: [] };
  const h = hits[0], niveau = h.niveau === 'critical' ? 'critique' : h.niveau === 'high' ? 'haute' : 'moyenne';
  return { malveillant: niveau !== 'moyenne', niveau, raison: `comportement reconnu : ${h.titre}`, source: 'règles Sigma', genre: h.tags.find((t) => t.startsWith('attack.')) ?? 'comportement', details: hits.slice(0, 5).map((x) => `${x.titre} (${x.niveau})`) };
}
