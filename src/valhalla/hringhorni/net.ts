// Hringhorni — le réseau des conteneurs, sans service qui tourne : un pont « odin0 » (10.89.0.0/24) créé à la
// demande, un espace réseau par conteneur relié au pont, la sortie vers Internet par traduction d'adresses.
// Les ports publiés sont relayés par le gardien du conteneur (pas de règle de pare-feu à nettoyer).
// Lot K2 : d'autres ponts, un par réseau à part (« odin3 », 10.89.3.0/24…), isolés les uns des autres et du réseau de
// tous (leur table nftables porte le nom du pont : la retirer retire toutes leurs règles d'un coup), avec ou sans
// sortie vers Internet ; et le réseau « aucun » : un espace réseau vide, ni Internet ni la maison.
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const BRIDGE = 'odin0', SUBNET = '10.89.0', GW = `${SUBNET}.1`;
export type Runner = (cmd: string, args: string[]) => Promise<{ code: number; out: string; err: string }>;
export const defaultRunner: Runner = async (cmd, args) => {
  try { const r = await exec(cmd, args, { timeout: 20_000 }); return { code: 0, out: r.stdout, err: r.stderr }; }
  catch (e) { const x = e as { code?: number; stdout?: string; stderr?: string; message: string }; return { code: typeof x.code === 'number' ? x.code : 1, out: x.stdout ?? '', err: x.stderr ?? x.message }; }
};
export const nsName = (id: string) => `odin-${id.slice(0, 12)}`;
/** Un pont : son nom d'interface, son sous-réseau (trois premiers nombres), s'il sort vers Internet. */
export interface Pont { pont: string; sousReseau: string; internet: boolean }
/** Le réseau de tous les conteneurs (celui d'avant le lot K2, inchangé). */
export const PONT_DEFAUT: Pont = { pont: BRIDGE, sousReseau: SUBNET, internet: true };
/** Le pont d'un réseau à part : « odin<N> » pour 10.89.N (N de 1 à 239 ; 0 est le réseau de tous). */
export const pontDe = (sousReseau: string): string => `odin${Number(sousReseau.split('.')[2])}`;
/** Le premier sous-réseau libre pour un réseau à part (10.89.1 à 10.89.239). */
export function sousReseauLibre(pris: Iterable<string>): string {
  const p = new Set(pris); for (let n = 1; n < 240; n++) { const x = `10.89.${n}`; if (!p.has(x)) return x; }
  throw new Error('plus de réseau libre (239 au plus)');
}
const SOUS_RESEAU = /^10\.89\.(\d{1,3})$/;
function verifierPont(p: Pont): void {
  const m = SOUS_RESEAU.exec(p.sousReseau); if (!m || Number(m[1]) > 239) throw new Error(`sous-réseau invalide : ${String(p.sousReseau).slice(0, 20)}`);
  if (p.pont !== (Number(m[1]) === 0 ? BRIDGE : pontDe(p.sousReseau))) throw new Error(`pont invalide : ${String(p.pont).slice(0, 20)}`);
}
const veth = (id: string) => [`od${id.slice(0, 10)}h`, `od${id.slice(0, 10)}c`];

/** Le pont et la sortie Internet (idempotent). Sans `p` : le réseau de tous, comme avant. */
export async function ensureBridge(run: Runner, p: Pont = PONT_DEFAUT): Promise<void> {
  if (p.pont !== BRIDGE) return ensurePontAPart(run, p);
  if ((await run('ip', ['link', 'show', BRIDGE])).code !== 0) {
    for (const a of [['link', 'add', BRIDGE, 'type', 'bridge'], ['addr', 'add', `${GW}/24`, 'dev', BRIDGE], ['link', 'set', BRIDGE, 'up']]) {
      const r = await run('ip', a); if (r.code !== 0 && !/exists/i.test(r.err)) throw new Error(`réseau : ${r.err.trim()}`);
    }
  }
  try { writeFileSync('/proc/sys/net/ipv4/ip_forward', '1'); } catch { /* lecture seule : la sortie Internet peut manquer */ }
  // traduction d'adresses pour la sortie : nftables, sinon iptables
  const has = await run('nft', ['list', 'table', 'ip', 'odin']);
  if (has.code !== 0) {
    const a = await run('nft', ['add', 'table', 'ip', 'odin']);
    if (a.code === 0) {
      await run('nft', ['add', 'chain', 'ip', 'odin', 'sortie', '{ type nat hook postrouting priority 100 ; }']);
      await run('nft', ['add', 'rule', 'ip', 'odin', 'sortie', 'ip', 'saddr', `${SUBNET}.0/24`, 'oifname', '!=', BRIDGE, 'masquerade']);
    } else {
      const chk = await run('iptables', ['-t', 'nat', '-C', 'POSTROUTING', '-s', `${SUBNET}.0/24`, '!', '-o', BRIDGE, '-j', 'MASQUERADE']);
      if (chk.code !== 0) await run('iptables', ['-t', 'nat', '-A', 'POSTROUTING', '-s', `${SUBNET}.0/24`, '!', '-o', BRIDGE, '-j', 'MASQUERADE']);
    }
  }
}
/** Un réseau à part : son pont, puis sa table nftables à lui (même nom que le pont) — il ne parle à aucun autre pont
 *  d'Odin (dans les deux sens), et sans Internet il ne sort pas du tout. Sans nftables : les mêmes règles en iptables. */
async function ensurePontAPart(run: Runner, p: Pont): Promise<void> {
  verifierPont(p);
  const br = p.pont, gw = `${p.sousReseau}.1`;
  if ((await run('ip', ['link', 'show', br])).code !== 0) {
    for (const a of [['link', 'add', br, 'type', 'bridge'], ['addr', 'add', `${gw}/24`, 'dev', br], ['link', 'set', br, 'up']]) {
      const r = await run('ip', a); if (r.code !== 0 && !/exists/i.test(r.err)) throw new Error(`réseau ${br} : ${r.err.trim()}`);
    }
  }
  if (p.internet) { try { writeFileSync('/proc/sys/net/ipv4/ip_forward', '1'); } catch { /* lecture seule : la sortie Internet peut manquer */ } }
  // Une table déjà là n'est reprise que si elle dit la même chose (un réseau retiré a pu en laisser une, avec ou sans
  // Internet) : sinon elle est refaite, jamais héritée.
  const deja = await run('nft', ['list', 'table', 'ip', br]);
  if (deja.code === 0) {
    if (/masquerade/.test(deja.out) === p.internet && /hook input/.test(deja.out) === !p.internet) return;
    const d = await run('nft', ['delete', 'table', 'ip', br]); if (d.code !== 0) throw new Error(`réseau ${br} : ses anciennes règles ne partent pas (${d.err.trim().slice(0, 200)})`);
  }
  const t = await run('nft', ['add', 'table', 'ip', br]);
  if (t.code === 0) {
    const regles: string[][] = [
      ['add', 'chain', 'ip', br, 'isoler', '{ type filter hook forward priority -10 ; }'],
      // ni vers un autre pont d'Odin, ni depuis un autre pont d'Odin
      ['add', 'rule', 'ip', br, 'isoler', 'iifname', br, 'oifname', '"odin*"', 'oifname', '!=', br, 'drop'],
      ['add', 'rule', 'ip', br, 'isoler', 'oifname', br, 'iifname', '"odin*"', 'iifname', '!=', br, 'drop'],
      ...(p.internet ? [['add', 'chain', 'ip', br, 'sortie', '{ type nat hook postrouting priority 100 ; }'], ['add', 'rule', 'ip', br, 'sortie', 'ip', 'saddr', `${p.sousReseau}.0/24`, 'oifname', '!=', br, 'masquerade']]
        // sans Internet : rien ne sort du pont, et rien ne joint ce PC (le port d'Odin, ses services) ; seules les réponses
        // à ce que ce PC a demandé passent (les ports publiés sont relayés par le gardien, depuis ce PC)
        : [['add', 'rule', 'ip', br, 'isoler', 'iifname', br, 'oifname', '!=', br, 'drop'],
          ['add', 'chain', 'ip', br, 'entree', '{ type filter hook input priority -10 ; }'], ['add', 'rule', 'ip', br, 'entree', 'iifname', br, 'ct', 'state', 'new,invalid', 'drop']]),
    ];
    for (const a of regles) { const r = await run('nft', a); if (r.code !== 0) { await run('nft', ['delete', 'table', 'ip', br]); throw new Error(`réseau ${br} : règles refusées (${r.err.trim().slice(0, 200)})`); } }
    return;
  }
  for (const a of reglesIptables(p)) {
    const chk = await run('iptables', [...a.table, '-C', ...a.regle]);
    if (chk.code !== 0) { const r = await run('iptables', [...a.table, '-I', ...a.regle]); if (r.code !== 0) throw new Error(`réseau ${br} : règles refusées (${r.err.trim().slice(0, 200)})`); }
  }
}
/** Les règles iptables d'un réseau à part (quand nftables manque) : les mêmes, ajoutées en tête et retirées une à une. */
export function reglesIptables(p: Pont): Array<{ table: string[]; regle: string[] }> {
  const br = p.pont;
  return [
    { table: [], regle: ['FORWARD', '-i', br, '-o', 'odin+', '-j', 'DROP'] },
    { table: [], regle: ['FORWARD', '-i', 'odin+', '-o', br, '-j', 'DROP'] },
    // posée en dernier, donc en tête : le pont parle à lui-même
    { table: [], regle: ['FORWARD', '-i', br, '-o', br, '-j', 'ACCEPT'] },
    ...(p.internet ? [{ table: ['-t', 'nat'], regle: ['POSTROUTING', '-s', `${p.sousReseau}.0/24`, '!', '-o', br, '-j', 'MASQUERADE'] }]
      : [{ table: [], regle: ['FORWARD', '-i', br, '!', '-o', br, '-j', 'DROP'] }, { table: [], regle: ['INPUT', '-i', br, '-m', 'conntrack', '--ctstate', 'NEW,INVALID', '-j', 'DROP'] }]),
  ];
}
/** Retire un réseau à part : son pont et toutes ses règles (jamais le réseau de tous). */
export async function removeBridge(run: Runner, p: Pont): Promise<void> {
  verifierPont(p); if (p.pont === BRIDGE) throw new Error('le réseau de tous les conteneurs ne se retire pas');
  await run('ip', ['link', 'del', p.pont]);
  if ((await run('nft', ['delete', 'table', 'ip', p.pont])).code !== 0) {
    // la table est encore là : le réseau reste noté (un futur réseau sur ce pont hériterait de ses règles)
    if ((await run('nft', ['list', 'table', 'ip', p.pont])).code === 0) throw new Error(`réseau ${p.pont} : ses règles ne partent pas, il reste noté (réessaie)`);
    for (const a of reglesIptables(p)) await run('iptables', [...a.table, '-D', ...a.regle]);
  }
}
/** Les adresses prises, pour toute la machine (plusieurs dossiers de moteur partagent le même pont). */
export const LEASES = process.env.ODIN_HRINGHORNI_BAUX ?? '/run/odin/hringhorni-adresses';
/** Réserve une adresse libre sur le pont (réservation atomique ; une réservation dont l'espace réseau a disparu est reprise). */
export async function lease(run: Runner, id: string, dir = LEASES, want?: string, subnet = SUBNET): Promise<string> {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const live = new Set((await run('ip', ['netns', 'list'])).out.split('\n').map((l) => l.split(' ')[0]).filter(Boolean));
  // une adresse fixe demandée (service de base, comme la base de données d'Odin) d'abord ; les autres évitent 240 à 254
  const wanted = want && new RegExp(`^${subnet.replace(/\./g, '\\.')}\\.(\\d+)$`).test(want) ? [Number(want.split('.')[3])] : [];
  for (const i of [...wanted, ...Array.from({ length: 238 }, (_, k) => k + 2)]) {
    const ip = `${subnet}.${i}`, f = join(dir, ip);
    try { writeFileSync(f, nsName(id), { flag: 'wx', mode: 0o600 }); return ip; } catch { /* prise */ }
    try { const owner = readFileSync(f, 'utf8').trim(); if (owner === nsName(id) || !live.has(owner)) { writeFileSync(f, nsName(id), { mode: 0o600 }); return ip; } } catch { /* concurrence : suivante */ }
  }
  throw new Error('plus d\'adresse libre sur le réseau des conteneurs (253 au plus)');
}
export function release(ip: string | undefined, id: string, dir = LEASES): void {
  if (!ip) return; const f = join(dir, ip);
  try { if (readFileSync(f, 'utf8').trim() === nsName(id)) rmSync(f, { force: true }); } catch { /* déjà libre */ }
}
/** Première adresse libre (2 à 254). */
export function pickIp(used: Iterable<string>): string {
  const u = new Set(used); for (let i = 2; i < 255; i++) { const ip = `${SUBNET}.${i}`; if (!u.has(ip)) return ip; }
  throw new Error('plus d\'adresse libre sur le réseau des conteneurs (253 au plus)');
}
/** Un espace réseau pour le conteneur, relié au pont, avec son adresse. */
export async function attach(run: Runner, id: string, ip: string, p: Pont = PONT_DEFAUT): Promise<void> {
  const ns = nsName(id), [h, c] = veth(id), br = p.pont, gw = `${p.sousReseau}.1`;
  await detach(run, id);
  const steps: string[][] = [['netns', 'add', ns], ['link', 'add', h, 'type', 'veth', 'peer', 'name', c], ['link', 'set', c, 'netns', ns], ['link', 'set', h, 'master', br], ['link', 'set', h, 'up'],
    ['-n', ns, 'link', 'set', c, 'name', 'eth0'], ['-n', ns, 'addr', 'add', `${ip}/24`, 'dev', 'eth0'], ['-n', ns, 'link', 'set', 'eth0', 'up'], ['-n', ns, 'link', 'set', 'lo', 'up'], ['-n', ns, 'route', 'add', 'default', 'via', gw]];
  for (const s of steps) { const r = await run('ip', s); if (r.code !== 0) { await detach(run, id); throw new Error(`réseau du conteneur : ${r.err.trim() || s.join(' ')}`); } }
  // l'adresse a pu servir à un conteneur disparu : la machine oublie son ancienne carte (sinon 30 s sans réponse)
  await run('ip', ['neigh', 'del', ip, 'dev', br]);
}
/** Le réseau « aucun » : un espace réseau à lui, avec seulement sa propre boucle (127.0.0.1) ; ni Internet ni la maison. */
export async function attachNone(run: Runner, id: string): Promise<void> {
  const ns = nsName(id);
  await detach(run, id);
  for (const s of [['netns', 'add', ns], ['-n', ns, 'link', 'set', 'lo', 'up']]) { const r = await run('ip', s); if (r.code !== 0) { await detach(run, id); throw new Error(`réseau du conteneur : ${r.err.trim() || s.join(' ')}`); } }
}
export async function detach(run: Runner, id: string): Promise<void> {
  await run('ip', ['netns', 'del', nsName(id)]);
  await run('ip', ['link', 'del', veth(id)[0]]);
}
/** Les serveurs DNS pour un conteneur : ceux de la machine, sauf une adresse locale (127.x), remplacée par la vraie. */
export function resolvConf(bridged: boolean, read = (f: string) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } }): string {
  let txt = read('/etc/resolv.conf');
  const local = (t: string) => t.split('\n').filter((l) => /^nameserver\s/.test(l)).every((l) => /\s(127\.|::1)/.test(l));
  if (bridged && (!txt.trim() || local(txt))) { const alt = read('/run/systemd/resolve/resolv.conf'); txt = alt && !local(alt) ? alt : 'nameserver 9.9.9.9\nnameserver 149.112.112.112\n'; }
  return txt.split('\n').filter((l) => /^(nameserver|search|options)\s/.test(l)).join('\n') + '\n';
}
