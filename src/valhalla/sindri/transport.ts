// Phénix et Amphore · les destinations des sauvegardes : un disque (ou un partage déjà monté, un disque USB), un
// serveur SFTP / SSH, ou un partage réseau Windows ou NAS (SMB). Les comptes restent dans le coffre des machines :
// jamais dans un plan, jamais dans un journal (le mot de passe passe par l'environnement de ssh ou de smbclient).
// Un fichier est toujours écrit sous un nom provisoire puis renommé : un envoi coupé ne passe jamais pour complet.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { askpassScript, findMachine, sshArgs, verifierAcces, type Machine } from '../../machines/access.ts';
import { cheminSmb, commandesSmb, listerSmb } from '../../machines/smb.ts';

export type Genre = 'disque' | 'sftp' | 'partage';
export interface Destination {
  genre: Genre;
  /** disque : le dossier ; sftp : le dossier sur le serveur (chemin absolu) ; partage : le dossier dans le partage */
  dossier: string;
  /** sftp et partage : le poste du coffre des machines (nom, adresse ou identifiant), ou « sftp://compte@hôte:port » (clé SSH d'Odin) */
  poste?: string;
  /** partage : le nom du partage (« Sauvegardes ») */
  partage?: string;
}
export interface Transport {
  /** en clair pour les journaux (jamais de mot de passe) */
  nom: string;
  /** les fichiers présents (chemin relatif « a/b/c » → octets) */
  liste(): Promise<Map<string, number>>;
  envoyer(fichiers: Array<{ local: string; rel: string }>): Promise<void>;
  recuperer(fichiers: Array<{ rel: string; local: string }>): Promise<void>;
  effacer(rels: string[]): Promise<void>;
  /** l'empreinte SHA-256 d'un fichier de la destination */
  empreinte(rel: string): Promise<string>;
}

/** Un chemin relatif sûr (pas de « .. », pas de caractère de commande). Pur. */
export function relOk(rel: string): boolean {
  return /^[\w.@+-]+(\/[\w.@+-]+)*$/.test(rel) && !rel.split('/').some((p) => p === '..' || p === '.');
}
const verifierRel = (rels: string[]) => { for (const r of rels) if (!relOk(r)) throw new Error(`nom de fichier refusé : ${r.slice(0, 80)}`); };
/** Une destination lisible par une personne (sans secret). Pur. */
export function decrire(d: Destination): string {
  return d.genre === 'disque' ? d.dossier : d.genre === 'sftp' ? `SFTP ${d.poste ?? '?'}:${d.dossier}` : `partage \\\\${d.poste ?? '?'}\\${d.partage ?? '?'}${d.dossier ? `\\${cheminSmb(d.dossier)}` : ''}`;
}
/** Lit et contrôle une destination donnée dans un formulaire. Pur (sauf la recherche du poste dans le coffre, faite plus tard). */
export function lireDestination(i: Record<string, unknown>, prefixe = ''): Destination | undefined {
  const g = (k: string) => String(i[`${prefixe}${k}`] ?? '').trim();
  const genre = (g('genre') || 'disque').toLowerCase(), dossier = g('dossier'), poste = g('poste'), partage = g('partage');
  if (!dossier && !poste) return undefined;
  if (/^(sftp|ssh)/.test(genre)) {
    if (!poste) throw new Error('SFTP : quel serveur ? (un poste du coffre des machines, ou sftp://compte@adresse)');
    if (!/^\/[^\0\n\r'"`$\\]*$/.test(dossier) || dossier.split('/').includes('..')) throw new Error('SFTP : le dossier sur le serveur doit être un chemin absolu (ex. /srv/sauvegardes)');
    return { genre: 'sftp', poste, dossier: dossier.replace(/\/+$/, '') || '/' };
  }
  if (/^(partage|smb|réseau|reseau)/.test(genre)) {
    if (!poste || !partage) throw new Error('partage réseau : le poste (coffre des machines) et le nom du partage');
    if (/["\r\n\0]/.test(partage + dossier) || dossier.split(/[\\/]/).includes('..')) throw new Error('nom de partage ou de dossier invalide');
    return { genre: 'partage', poste, partage, dossier: cheminSmb(dossier).replace(/\\/g, '/') };
  }
  if (!dossier || (!dossier.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(dossier) && !dossier.startsWith('\\\\'))) throw new Error('disque : un chemin absolu (ex. /media/usb/sauvegardes, D:\\Sauvegardes, \\\\nas\\partage)');
  return { genre: 'disque', dossier };
}

// ---------------- Disque ----------------
function parcourir(root: string, base = ''): Array<[string, number]> {
  const out: Array<[string, number]> = []; let noms: string[] = [];
  try { noms = readdirSync(join(root, base)); } catch { return out; }
  for (const n of noms) {
    if (n.endsWith('.part')) continue;
    const rel = base ? `${base}/${n}` : n; let st; try { st = statSync(join(root, rel)); } catch { continue; }
    if (st.isDirectory()) out.push(...parcourir(root, rel)); else if (st.isFile()) out.push([rel, st.size]);
  }
  return out;
}
export async function sha256Fichier(f: string): Promise<string> { const h = createHash('sha256'); await new Promise<void>((ok, ko) => createReadStream(f).on('data', (d) => h.update(d)).on('end', ok).on('error', ko)); return h.digest('hex'); }
function disque(root: string): Transport {
  return {
    nom: root,
    liste: async () => new Map(parcourir(root)),
    envoyer: async (l) => { verifierRel(l.map((x) => x.rel)); for (const f of l) { const to = join(root, f.rel); mkdirSync(dirname(to), { recursive: true }); copyFileSync(f.local, `${to}.part`); renameSync(`${to}.part`, to); } },
    recuperer: async (l) => { verifierRel(l.map((x) => x.rel)); for (const f of l) { mkdirSync(dirname(f.local), { recursive: true }); copyFileSync(join(root, f.rel), `${f.local}.part`); renameSync(`${f.local}.part`, f.local); } },
    effacer: async (l) => { verifierRel(l); for (const r of l) rmSync(join(root, r), { force: true }); },
    empreinte: async (rel) => { verifierRel([rel]); return sha256Fichier(join(root, rel)); },
  };
}

// ---------------- SFTP / SSH ----------------
const q = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`;
/** Une archive tar (ustar) écrite au fil de l'eau : en-tête, contenu, bourrage ; deux blocs vides à la fin. Pur (lit les fichiers). */
export function* enTeteTar(nom: string, taille: number, mtime = Math.floor(Date.now() / 1000)): Generator<Buffer> {
  const h = Buffer.alloc(512), b = Buffer.from(nom, 'utf8');
  let name = b, prefix = Buffer.alloc(0);
  if (b.length > 100) { const k = nom.lastIndexOf('/', 154); if (k <= 0 || Buffer.byteLength(nom.slice(k + 1)) > 100) throw new Error(`nom trop long pour l'archive : ${nom.slice(0, 60)}…`); prefix = Buffer.from(nom.slice(0, k)); name = Buffer.from(nom.slice(k + 1)); }
  name.copy(h, 0); h.write('0000644\0', 100, 'latin1'); h.write('0000000\0', 108, 'latin1'); h.write('0000000\0', 116, 'latin1');
  h.write(`${taille.toString(8).padStart(11, '0')}\0`, 124, 'latin1'); h.write(`${mtime.toString(8).padStart(11, '0')}\0`, 136, 'latin1');
  h.write('        ', 148, 'latin1'); h.write('0', 156, 'latin1'); h.write('ustar\0', 257, 'latin1'); h.write('00', 263, 'latin1'); prefix.copy(h, 345);
  let somme = 0; for (const x of h) somme += x; h.write(`${somme.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
  yield h;
}
export async function* tarDe(fichiers: Array<{ local: string; rel: string }>): AsyncGenerator<Buffer> {
  for (const f of fichiers) {
    const st = statSync(f.local); yield* enTeteTar(f.rel, st.size, Math.floor(st.mtimeMs / 1000));
    const fd = openSync(f.local, 'r'), buf = Buffer.alloc(1 << 20); let lu = 0;
    try { for (;;) { const n = readSync(fd, buf, 0, buf.length, null); if (n <= 0) break; lu += n; yield Buffer.from(buf.subarray(0, n)); } } finally { closeSync(fd); }
    if (lu !== st.size) throw new Error(`${f.rel} a changé pendant l'envoi`);
    if (st.size % 512) yield Buffer.alloc(512 - (st.size % 512));
  }
  yield Buffer.alloc(1024);
}
/** Lance une commande sur le serveur par SSH, en flux : l'entrée vient de `entree`, la sortie part dans `sortie`. */
function ssh(home: string, m: Machine, command: string, o: { entree?: AsyncIterable<Buffer>; sortie?: (d: Buffer) => void; timeoutMs?: number } = {}): Promise<{ code: number | null; out: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (m.password) Object.assign(env, { SSH_ASKPASS: askpassScript(home), SSH_ASKPASS_REQUIRE: 'force', DISPLAY: env.DISPLAY || ':0', ODIN_ASKPASS_SECRET: m.password });
  return new Promise((resolve) => {
    const child = spawn('ssh', sshArgs(home, m, ['-T']).concat(command), { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; const add = (d: Buffer) => { if (out.length < 60_000) out += d.toString(); };
    child.stdout.on('data', o.sortie ?? add); child.stderr.on('data', add);
    child.stdin.on('error', () => undefined);
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 3_600_000);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: null, out: `${e.message}${/ENOENT/.test(e.message) ? ' (client ssh introuvable : installe openssh-client)' : ''}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
    if (o.entree) void (async () => { try { for await (const b of o.entree!) { if (!child.stdin.write(b)) await new Promise((r) => child.stdin.once('drain', r)); } } catch (e) { out += (e as Error).message; child.kill('SIGKILL'); } child.stdin.end(); })();
    else child.stdin.end();
  });
}
const pourquoiSsh = (out: string) => (/Permission denied/i.test(out) ? 'compte refusé par le serveur' : /Connection refused/i.test(out) ? 'SSH fermé sur le serveur' : /timed out|No route|unreachable|Could not resolve/i.test(out) ? 'serveur injoignable' : /Host key verification failed|IDENTIFICATION HAS CHANGED/i.test(out) ? 'l\'empreinte SSH du serveur a changé : vérifie que c\'est bien lui' : out.trim().split('\n').at(-1)?.slice(0, 200) || 'refusé');
/** Le poste SSH d'une destination : un poste du coffre, ou « sftp://compte@hôte:port » (connexion par la clé d'Odin). */
export function posteSsh(home: string, qui: string): Machine {
  const u = /^(?:sftp|ssh):\/\/([^@/\s]+)@([^:/\s]+)(?::(\d{1,5}))?\/?$/.exec(qui.trim());
  if (u) { verifierAcces(u[2], u[1]); return { id: '', label: u[2], host: u[2], user: u[1], port: Number(u[3] ?? 22), addedAt: 0 }; }
  const m = findMachine(home, qui); if (!m) throw new Error(`poste « ${qui.slice(0, 60)} » inconnu : ajoute-le dans Réglages → Droits et machines, ou écris sftp://compte@adresse`);
  if (m.via === 'smb') throw new Error(`${m.label} est joint par son partage de fichiers : choisis « partage réseau »`);
  return m;
}
function sftp(home: string, m: Machine, root: string): Transport {
  const R = q(root), run = async (cmd: string, o: Parameters<typeof ssh>[3] = {}) => { const r = await ssh(home, m, cmd, o); if (r.code !== 0) throw new Error(`${m.label} : ${pourquoiSsh(r.out)}`); return r; };
  return {
    nom: `${m.user}@${m.label}:${root}`,
    async liste() {
      let txt = ''; await run(`mkdir -p ${R} && cd ${R} && find . -type f ! -name '*.part' -exec wc -c {} +`, { sortie: (d) => { txt += d.toString(); } });
      const out = new Map<string, number>();
      for (const l of txt.split('\n')) { const x = /^\s*(\d+)\s+\.\/(.+)$/.exec(l); if (x) out.set(x[2], Number(x[1])); }
      return out;
    },
    async envoyer(l) {
      if (!l.length) return; verifierRel(l.map((x) => x.rel));
      // L'archive arrive dans un dossier provisoire, puis chaque fichier rejoint sa place (renommage, jamais à moitié).
      const tmp = `.envoi-${randomBytes(4).toString('hex')}`;
      for (let k = 0; k < l.length; k += 2000) {
        const lot = l.slice(k, k + 2000);
        await run(`mkdir -p ${R}/${tmp} && cd ${R}/${tmp} && tar -xf - && find . -type f | while IFS= read -r f; do mkdir -p "../$(dirname "$f")" && mv -f "$f" "../$f"; done; cd .. && rm -rf ${tmp}`, { entree: tarDe(lot) });
      }
    },
    async recuperer(l) {
      verifierRel(l.map((x) => x.rel));
      for (const f of l) {
        mkdirSync(dirname(f.local), { recursive: true }); const w = createWriteStream(`${f.local}.part`);
        const r = await ssh(home, m, `cat -- ${q(`${root}/${f.rel}`)}`, { sortie: (d) => { w.write(d); } });
        await new Promise<void>((ok) => w.end(ok));
        if (r.code !== 0) { rmSync(`${f.local}.part`, { force: true }); throw new Error(`${m.label} : ${pourquoiSsh(r.out)}`); }
        renameSync(`${f.local}.part`, f.local);
      }
    },
    async effacer(l) { verifierRel(l); for (let k = 0; k < l.length; k += 500) if (l.length) await run(`cd ${R} && rm -f -- ${l.slice(k, k + 500).map(q).join(' ')}`); },
    async empreinte(rel) {
      verifierRel([rel]); const r = await run(`cd ${R} && { sha256sum -- ${q(rel)} 2>/dev/null || shasum -a 256 -- ${q(rel)}; }`);
      const h = /^([0-9a-f]{64})/m.exec(r.out)?.[1]; if (!h) throw new Error(`${m.label} : empreinte illisible`); return h;
    },
  };
}

// ---------------- Partage réseau (SMB) ----------------
/** Les lignes smbclient qui créent un dossier et tous ses parents. Pur. */
export function lignesDossiers(rels: string[], root: string): string[] {
  const dirs = new Set<string>();
  for (const r of rels) { const p = `${root ? `${root}/` : ''}${r}`.split('/').slice(0, -1); for (let k = 1; k <= p.length; k++) dirs.add(p.slice(0, k).join('/')); }
  return [...dirs].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)).map((d) => `mkdir "${cheminSmb(d)}"`);
}
function partage(m: Machine, nomPartage: string, root: string): Transport {
  const R = (rel: string) => cheminSmb(`${root ? `${root}/` : ''}${rel}`);
  const erreurs = (out: string, quoi: RegExp) => out.split('\n').filter((l) => /NT_STATUS_/.test(l) && quoi.test(l));
  const t: Transport = {
    nom: `\\\\${m.label}\\${nomPartage}${root ? `\\${cheminSmb(root)}` : ''}`,
    async liste() {
      const out = new Map<string, number>(), pre = root ? `${root}/` : '';
      try { for await (const f of listerSmb(m, nomPartage, root)) { const rel = f.chemin.startsWith(pre) ? f.chemin.slice(pre.length) : f.chemin; if (!rel.endsWith('.part')) out.set(rel, f.octets); } }
      catch (e) { if (/introuvable/.test((e as Error).message)) return out; throw e; }
      return out;
    },
    async envoyer(l) {
      if (!l.length) return; verifierRel(l.map((x) => x.rel));
      for (let k = 0; k < l.length; k += 300) {
        const lot = l.slice(k, k + 300);
        for (const f of lot) if (/["\r\n\0]/.test(f.local)) throw new Error('chemin local impossible à envoyer');
        const out = await commandesSmb(m, nomPartage, [...lignesDossiers(lot.map((f) => f.rel), root), ...lot.flatMap((f) => [`put "${f.local}" "${R(f.rel)}.part"`, `del "${R(f.rel)}"`, `rename "${R(f.rel)}.part" "${R(f.rel)}"`])]);
        const e = erreurs(out, /putting|opening remote|renaming|NT_STATUS_(ACCESS_DENIED|DISK_FULL|MEDIA_WRITE_PROTECTED)/);
        if (e.length) throw new Error(`le partage refuse l'écriture : ${e[0].trim().slice(0, 200)}`);
      }
    },
    async recuperer(l) {
      verifierRel(l.map((x) => x.rel));
      for (let k = 0; k < l.length; k += 300) {
        const lot = l.slice(k, k + 300); for (const f of lot) { if (/["\r\n\0]/.test(f.local)) throw new Error('chemin local invalide'); mkdirSync(dirname(f.local), { recursive: true }); }
        const out = await commandesSmb(m, nomPartage, lot.map((f) => `get "${R(f.rel)}" "${f.local}"`));
        const e = erreurs(out, /opening remote|getting|NT_STATUS_(OBJECT_NAME_NOT_FOUND|ACCESS_DENIED)/); if (e.length) throw new Error(`lecture refusée sur le partage : ${e[0].trim().slice(0, 200)}`);
      }
    },
    async effacer(l) { verifierRel(l); for (let k = 0; k < l.length; k += 300) if (l.length) await commandesSmb(m, nomPartage, l.slice(k, k + 300).map((r) => `del "${R(r)}"`)); },
    async empreinte(rel) {
      const d = mkdtempSync(join(tmpdir(), 'odin-verif-')), f = join(d, 'f');
      try { await t.recuperer([{ rel, local: f }]); if (!existsSync(f)) throw new Error('fichier absent du partage'); return await sha256Fichier(f); } finally { rmSync(d, { recursive: true, force: true }); }
    },
  };
  return t;
}

/** Le transport d'une destination (le poste est cherché dans le coffre des machines). */
export function transportDe(home: string, d: Destination): Transport {
  if (d.genre === 'disque') return disque(d.dossier);
  if (d.genre === 'sftp') return sftp(home, posteSsh(home, d.poste ?? ''), d.dossier);
  const m = findMachine(home, d.poste ?? ''); if (!m) throw new Error(`poste « ${(d.poste ?? '').slice(0, 60)} » inconnu : ajoute-le dans Réglages → Droits et machines`);
  return partage(m, d.partage ?? '', d.dossier);
}
/** Essai d'une destination : écrire un petit fichier, le relire (empreinte), l'effacer. Rend une phrase. */
export async function essayer(t: Transport): Promise<string> {
  const d = mkdtempSync(join(tmpdir(), 'odin-essai-')), f = join(d, 'essai'), rel = `.odin-essai-${randomBytes(3).toString('hex')}`;
  try {
    const contenu = randomBytes(256); writeFileSync(f, contenu);
    await t.envoyer([{ local: f, rel }]);
    const h = await t.empreinte(rel); await t.effacer([rel]);
    if (h !== createHash('sha256').update(contenu).digest('hex')) throw new Error('le fichier relu est différent de celui envoyé');
    return `écriture et relecture vérifiées sur ${t.nom}`;
  } finally { rmSync(d, { recursive: true, force: true }); }
}
