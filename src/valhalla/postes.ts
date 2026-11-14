// « Sur quel poste ? » : une appli qui lit la machine (disques, pare-feu, journaux…) peut lire à la place un
// autre poste Linux ou Mac enregistré dans le coffre des machines. Mêmes commandes, lancées là-bas par SSH ;
// rien n'est installé sur le poste, et son mot de passe ne quitte jamais le coffre.
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { findMachine, listMachines, saveMachine, streamOnMachine, verifierAcces, type Machine } from '../machines/access.ts';
import { quelAcces, systemeSsh } from '../machines/lecture.ts';
import { essaiSmb, partagesSmb } from '../machines/smb.ts';
import type { ModCtx, View } from './types.ts';

type Run = ModCtx['run'];
export interface Poste {
  /** vide pour la machine d'Odin, sinon l'identifiant du poste dans le coffre */
  id: string; nom: string; local: boolean;
  run: Run; has(cmd: string): Promise<boolean>;
  /** la fin d'un fichier texte (`max` octets au plus) ; vide s'il n'existe pas ou n'est pas lisible */
  lire(fichier: string, max?: number): Promise<string>;
  /** « linux », « mac » ou « autre » (demandé une fois au poste) */
  systeme(): Promise<'linux' | 'mac' | 'autre'>;
}
const q = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`;
/** Une commande et ses arguments écrits pour le shell du poste : chaque argument entre guillemets simples, jamais interprété. Pur. */
export function ligneDeCommande(cmd: string, args: string[]): string {
  if (!/^[A-Za-z0-9_./-]+$/.test(cmd)) throw new Error('commande invalide');
  return [cmd, ...args.map(q)].join(' ');
}
/** Les mots qui désignent la machine d'Odin elle-même. Pur. */
export const estIci = (qui: unknown) => { const k = String(qui ?? '').trim().toLowerCase(); return !k || /^(ici|local|localhost|cette machine|odin|la machine d'odin|ce poste|127\.0\.0\.1)$/.test(k); };

function finLocale(f: string, max: number): string {
  let fd: number | undefined;
  try { const st = statSync(f); if (!st.isFile()) return ''; const n = Math.min(st.size, max), b = Buffer.alloc(n); fd = openSync(f, 'r'); readSync(fd, b, 0, n, st.size - n); return b.toString('utf8'); }
  catch { return ''; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* déjà fermé */ } }
}
/** Lance une commande sur un poste du coffre et rend sa sortie et ses erreurs séparées (comme sur la machine d'Odin). */
export async function lancerSurPoste(home: string, m: Machine, cmd: string, args: string[], o: { timeoutMs?: number; sudo?: boolean; input?: string } = {}): Promise<{ code: number; out: string; err: string }> {
  if (o.input !== undefined) throw new Error('cette action ne se fait pas encore sur un autre poste');
  const ligne = ligneDeCommande(cmd, args), x = streamOnMachine(home, m, o.sudo && m.user !== 'root' ? `sudo ${ligne}` : ligne, { timeoutMs: o.timeoutMs ?? 30_000 });
  const morceaux: Buffer[] = []; let n = 0;
  for await (const d of x.sortie as AsyncIterable<Buffer>) { if (n < 32 * 1024 * 1024) { morceaux.push(d); n += d.length; } }
  const fin = await x.fin;
  return { code: fin.code ?? 1, out: Buffer.concat(morceaux).toString('utf8'), err: fin.err };
}
/**
 * Le poste demandé : la machine d'Odin (rien ou « ici »), ou un poste du coffre des machines (par son nom, son
 * adresse ou son identifiant). Lève une erreur claire si le poste est inconnu ou n'est pas joignable par SSH.
 */
export function posteDe(ctx: ModCtx, qui: unknown): Poste {
  if (estIci(qui)) return { id: '', nom: 'cette machine', local: true, run: ctx.run, has: ctx.has, lire: async (f, max = 2_000_000) => finLocale(f, max), systeme: async () => (process.platform === 'linux' ? 'linux' : process.platform === 'darwin' ? 'mac' : 'autre') };
  const nom = String(qui).trim(), m = findMachine(ctx.home, nom);
  if (!m) { const l = listMachines(ctx.home); throw new Error(`poste « ${nom.slice(0, 60)} » inconnu${l.length ? ` (postes enregistrés : ${l.map((x) => x.label).join(', ')})` : ''} : ajoute-le dans Réglages → Droits et machines (adresse, compte, mot de passe)`); }
  if (m.via === 'smb') throw new Error(`${m.label} est joint par son partage de fichiers (Windows) : cette appli lit les postes Linux et Mac, par SSH. Pour un Windows : l'antivirus (Asclépios) sait l'analyser.`);
  let sys: Promise<'linux' | 'mac' | 'autre'> | undefined;
  const run: Run = (cmd, args, o) => lancerSurPoste(ctx.home, m, cmd, args, o).catch((e) => ({ code: 1, out: '', err: (e as Error).message }));
  const explique = (err: string) => (/Permission denied/i.test(err) ? `${m.label} refuse ce compte (utilisateur ou mot de passe)` : /Connection refused/i.test(err) ? `SSH est fermé sur ${m.label}` : /timed out|No route|unreachable|Could not resolve/i.test(err) ? `${m.label} ne répond pas (éteint, en veille, ou sur un autre réseau)` : /Host key verification failed|IDENTIFICATION HAS CHANGED/i.test(err) ? `l'empreinte SSH de ${m.label} a changé : vérifie que c'est bien lui` : undefined);
  const poste: Poste = {
    id: m.id, nom: m.label, local: false,
    run: async (cmd, args, o) => { const r = await run(cmd, args, o); const why = r.code === 255 ? explique(r.err) : undefined; if (why) throw new Error(why); return r; },
    has: async (cmd) => /^[A-Za-z0-9_.+-]+$/.test(cmd) && (await poste.run('sh', ['-c', `command -v ${cmd} >/dev/null 2>&1`], { timeoutMs: 15_000 })).code === 0,
    lire: async (f, max = 2_000_000) => {
      if (!f.startsWith('/') || /[\0\n\r]/.test(f)) return '';
      const n = String(Math.max(1, Math.min(8_000_000, Math.floor(max)))); let r = await poste.run('tail', ['-c', n, '--', f], { timeoutMs: 20_000 });
      // Réservé à l'administrateur (journaux de connexion…) : on recommence avec ses droits.
      if (r.code !== 0 && /denied|not permitted/i.test(r.err)) r = await poste.run('tail', ['-c', n, '--', f], { timeoutMs: 20_000, sudo: true });
      return r.code === 0 ? r.out : '';
    },
    systeme: () => (sys ??= poste.run('uname', ['-s'], { timeoutMs: 15_000 }).then((r) => (/Linux/i.test(r.out) ? 'linux' as const : /Darwin/i.test(r.out) ? 'mac' as const : 'autre' as const))),
  };
  return poste;
}
/** Les postes proposés par une appli qui lit par SSH : la machine d'Odin d'abord, puis les postes Linux et Mac du coffre. */
export function postesLisibles(ctx: ModCtx): Array<{ id: string; nom: string }> {
  return [{ id: '', nom: 'Cette machine' }, ...listMachines(ctx.home).filter((m) => m.via !== 'smb').map((m) => ({ id: m.id, nom: m.label }))];
}
/** Le réglage « Poste » à ajouter aux actions qui savent lire un autre poste. */
export const PARAM_POSTE = { key: 'poste', label: 'Poste (vide : cette machine)', kind: 'text' as const, help: 'Le nom ou l\'adresse d\'un poste Linux ou Mac enregistré dans Réglages → Droits et machines.' };
/**
 * Le bloc « Sur quel poste ? » d'une page (`View.postes`) : le poste que la page demande (`?poste=` dans `q`) et
 * ceux qu'elle propose. `partages` : l'appli sait aussi lire un poste joint par son partage de fichiers (Windows, NAS).
 * Un poste demandé qui n'existe pas (ou plus) ramène à la machine d'Odin. Pur (lit seulement le coffre).
 */
export function choixDePoste(ctx: ModCtx, q: URLSearchParams | undefined, o: { partages?: boolean } = {}): NonNullable<View['postes']> {
  const tous = listMachines(ctx.home).filter((m) => o.partages || m.via !== 'smb');
  const demande = (q?.get('poste') ?? '').trim(), m = demande && !estIci(demande) ? findMachine(ctx.home, demande) : undefined;
  return { actuel: m && tous.some((x) => x.id === m.id) ? m.id : '', choix: [{ id: '', nom: 'Cette machine' }, ...tous.map((x) => ({ id: x.id, nom: x.label, ...(x.via === 'smb' ? { sys: 'Windows' } : {}) }))], ajouter: true, trouves: postesTrouves(ctx.home, o) };
}

/** Un appareil vu sur le réseau par le registre d'Odin (ce qu'il faut pour proposer un poste à ajouter). */
export interface VuSurLeReseau { ip: string; nom?: string; kind?: string; os?: string; ports?: number[]; enLigne?: boolean }
let reseau: (() => VuSurLeReseau[]) | undefined;
/** Branche le registre réseau d'Odin : sert seulement à proposer les ordinateurs à ajouter (« Trouvés sur ton réseau »). */
export const setReseau = (f: (() => VuSurLeReseau[]) | undefined) => { reseau = f; };
/**
 * Les ordinateurs, serveurs et NAS vus sur le réseau qui ne sont pas encore dans le coffre : ceux qui répondent à SSH
 * (Linux, Mac) et, avec `partages`, au partage de fichiers (Windows, NAS). En ligne d'abord, 12 au plus.
 */
export function postesTrouves(home: string, o: { partages?: boolean } = {}): Array<{ adresse: string; nom: string; sys?: string }> {
  let vus: VuSurLeReseau[] = []; try { vus = reseau?.() ?? []; } catch { /* registre pas prêt */ }
  const deja = new Set(listMachines(home).flatMap((m) => [m.host.toLowerCase(), m.label.toLowerCase()]));
  const sys = (d: VuSurLeReseau) => { const os = d.os ?? '', p = d.ports ?? []; return /windows/i.test(os) ? 'Windows' : /mac ?os|darwin/i.test(os) ? 'Mac' : /linux|ubuntu|debian|fedora/i.test(os) ? 'Linux' : /nas/i.test(d.kind ?? '') ? 'NAS' : p.includes(445) && !p.includes(22) ? 'Windows' : p.includes(22) && !p.includes(445) ? 'Linux ou Mac' : undefined; };
  return vus.filter((d) => d.ip && !deja.has(d.ip.toLowerCase()) && !(d.nom && deja.has(d.nom.toLowerCase())))
    // Une appli qui ne lit que par SSH ne propose que les postes où SSH répond ; avec les partages : aussi Windows et les NAS.
    .filter((d) => { const p = d.ports ?? []; return p.includes(22) || (Boolean(o.partages) && (p.includes(445) || /ordinateur|stockage/i.test(d.kind ?? ''))); })
    .filter((d) => !/routeur|caméra|imprimante|téléphone|multimédia/i.test(d.kind ?? ''))
    .sort((a, b) => Number(Boolean(b.enLigne)) - Number(Boolean(a.enLigne)))
    .slice(0, 12).map((d) => { const y = sys(d); return { adresse: d.ip, nom: d.nom || d.ip, ...(y ? { sys: y } : {}) }; });
}

/** La commande à lancer une fois sur un PC Windows qui refuse à distance son compte administrateur local. */
export const COMMANDE_WINDOWS = 'reg add HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System /v LocalAccountTokenFilterPolicy /t REG_DWORD /d 1 /f';
export interface EssaiPoste { ok: boolean; text: string; /** l'identifiant du poste dans le coffre (rangé seulement si l'essai a réussi) */ poste?: string; nom?: string; sys?: string; /** Windows bloque ce compte à distance : montrer la commande à lancer sur le PC */ aideWindows?: boolean }
/**
 * « Tester la connexion » : essaie un poste avec le compte donné et dit ce qui y est lisible. Le poste et son mot de
 * passe ne sont rangés dans le coffre **que si l'essai réussit** ; un mauvais mot de passe n'écrase donc jamais le bon.
 * Sans compte : le poste doit déjà être dans le coffre (on réessaie avec ce qu'on a). Le mot de passe n'est jamais rendu.
 */
export async function essayerPoste(home: string, i: { adresse?: unknown; utilisateur?: unknown; mot_de_passe?: unknown; /** port SSH s'il n'est pas 22 */ port?: unknown; /** port du partage de fichiers s'il n'est pas 445 */ port_partage?: unknown }): Promise<EssaiPoste> {
  const adresse = String(i.adresse ?? '').trim(), compte = String(i.utilisateur ?? '').trim(), pw = typeof i.mot_de_passe === 'string' ? i.mot_de_passe : '';
  if (!adresse) return { ok: false, text: 'Quel poste ? Choisis-le dans la liste ou tape son adresse (par exemple 192.168.1.20).' };
  const connu = findMachine(home, adresse);
  const bs = compte.indexOf('\\'), domaine = bs > 0 ? compte.slice(0, bs) : '', user = bs > 0 ? compte.slice(bs + 1) : compte;
  if (!user && !connu) return { ok: false, text: 'Donne le compte administrateur de ce poste : son identifiant et son mot de passe.' };
  // Un poste déjà dans le coffre se réessaie avec ce qu'on a (mot de passe rangé, ou clé d'Odin déjà installée dessus).
  if (user && !pw && !(connu && connu.user === user)) return { ok: false, text: 'Il manque le mot de passe de ce compte.' };
  const num = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined; }, portSsh = num(i.port), portSmb = num(i.port_partage);
  // Rien ne part vers SSH ou le partage de fichiers avant ce contrôle (pas d'option glissée dans un nom).
  try { verifierAcces(connu?.host ?? adresse, user || connu!.user, domaine || undefined); } catch (e) { return { ok: false, text: `${(e as Error).message[0].toUpperCase()}${(e as Error).message.slice(1)}.` }; }
  // Le poste tel qu'on l'essaie : rien n'est rangé tant que la connexion n'a pas réussi.
  const m: Machine = { ...(connu ?? { id: '', label: adresse, host: adresse, port: 22, user, addedAt: Date.now() }), ...(user ? { user } : {}), ...(domaine ? { domain: domaine } : {}), ...(pw ? { password: pw } : {}), ...(portSsh ? { port: portSsh } : {}), ...(portSmb ? { smbPort: portSmb } : {}) };
  const via = await quelAcces(home, m).catch(() => undefined);
  if (!via) return { ok: false, text: `${adresse} ne répond ni au partage de fichiers (Windows, NAS) ni à SSH (Linux, Mac) : poste éteint ou en veille, pare-feu fermé, ou autre réseau.` };
  let sys = '', text = '', aideWindows = false;
  try {
    if (via === 'smb') {
      const parts = await partagesSmb(m), disques = parts.filter((p) => p.disque), autres = parts.filter((p) => !p.disque && !/\$$/.test(p.nom));
      const noms = `${autres.slice(0, 4).map((a) => a.nom).join(', ')}${autres.length > 4 ? '…' : ''}`;
      if (!disques.length) { sys = 'NAS'; text = autres.length ? `Connexion réussie : dossiers partagés lisibles (${noms}).` : 'Connexion réussie, mais ce poste ne partage aucun dossier.'; }
      else {
        sys = 'Windows';
        const refus = await essaiSmb(m, disques[0].nom);
        if (!refus) text = `Connexion réussie : ${disques.length > 1 ? `les disques ${disques.map((d) => `${d.disque}:`).join(', ')} sont lisibles` : `le disque ${disques[0].disque}: est lisible`} en entier.`;
        else if (autres.length) { text = `Connexion réussie, mais Windows ne laisse lire à ce compte que les dossiers partagés (${noms}), pas le disque entier.`; aideWindows = true; }
        else return { ok: false, text: 'Le PC répond, mais Windows bloque ce compte à distance : rien n\'est lisible pour l\'instant.', aideWindows: true };
      }
    } else {
      const y = await systemeSsh(home, m); sys = y === 'linux' ? 'Linux' : y === 'mac' ? 'Mac' : y === 'windows' ? 'Windows' : '';
      text = `Connexion réussie${sys ? ` : ${sys}` : ''}, lu par SSH.`;
    }
  } catch (e) { const msg = (e as Error).message; return { ok: false, text: `Connexion refusée : ${msg.slice(0, 400)}`, aideWindows: /administrateur local|accès refusé/i.test(msg) }; }
  const prev = connu ?? listMachines(home).find((z) => z.host === adresse && z.user === m.user);
  const range = saveMachine(home, { id: prev?.id, host: m.host, label: prev?.label, user: m.user, port: m.port, via, ...(pw ? { password: pw } : {}), ...(m.domain ? { domain: m.domain } : {}), ...(m.smbPort ? { smbPort: m.smbPort } : {}) });
  return { ok: true, text, poste: range.id, nom: range.label, ...(sys ? { sys } : {}), ...(aideWindows ? { aideWindows } : {}) };
}
