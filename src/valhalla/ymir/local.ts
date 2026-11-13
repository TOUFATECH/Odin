// Hydre · les machines de CE PC (maquettes validées « Machines », « Créer une machine », « Quarantaine ») :
// des conteneurs LXC (légers) et des machines virtuelles QEMU, créés et suivis par Odin, sans Docker ni Podman.
//   - LXC : les outils officiels (lxc-create avec le modèle « download », qui vérifie la signature des images
//     de linuxcontainers.org), dans un dossier à part pour Odin ; limites processeur et mémoire par cgroup v2.
//   - VM : QEMU (KVM si présent), disque qcow2, écran lu par QMP (capture) pour l'aperçu en direct.
//   - Quarantaine : la carte réseau de la machine est débranchée de tout (ni Internet, ni DNS, ni réseau maison) ;
//     au redémarrage elle reste sans réseau. Seul Odin entre (console, disque) pour analyser.
//   - .ody : la machine entière dans un fichier vérifié (empreinte SHA-256), pour l'exporter ou l'importer.
// Rien n'est copié d'un autre projet : Odin appelle les programmes LXC et QEMU installés sur le PC.
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { cpus, freemem, loadavg, totalmem } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import type { ModCtx } from '../types.ts';

export type Genre = 'lxc' | 'vm';
export type Famille = 'Linux' | 'Windows' | 'Mac' | 'Autre';
export interface Journal { at: number; quoi: string; detail?: string; annuler?: { action: string; input: Record<string, unknown>; label: string; module?: string }; fait?: boolean }
export interface Quarantaine { depuis: number; raison: string; journal: Journal[]; analyse?: { at: number; propre: boolean; texte: string }; reseau?: string[] }
export interface Machine {
  id: string; nom: string; genre: Genre; systeme: string; version: string; famille: Famille; categorie?: string;
  cpu: number; ram: number; disque: number; ip: string; mac: string; cree: number;
  /** LXC : distribution et version du modèle ; VM : l'ISO d'installation */
  modele?: { dist: string; release: string }; iso?: string; uefi?: boolean;
  apps: string[]; paquets: string[]; quarantaine?: Quarantaine; arretVoulu?: boolean;
}
export interface Etat { state: 'en marche' | 'éteinte' | 'inconnue'; pid?: number; cpuPct?: number; ramMo?: number; ip?: string }

/** Les modèles LXC proposés (images officielles de linuxcontainers.org, signées). */
export const MODELES: Array<{ dist: string; release: string; titre: string; version: string }> = [
  { dist: 'debian', release: 'trixie', titre: 'Debian', version: '13' }, { dist: 'debian', release: 'bookworm', titre: 'Debian', version: '12' },
  { dist: 'ubuntu', release: 'noble', titre: 'Ubuntu', version: '24.04' }, { dist: 'ubuntu', release: 'jammy', titre: 'Ubuntu', version: '22.04' },
  { dist: 'alpine', release: '3.22', titre: 'Alpine', version: '3.22' }, { dist: 'rockylinux', release: '9', titre: 'Rocky Linux', version: '9' },
  { dist: 'almalinux', release: '9', titre: 'AlmaLinux', version: '9' }, { dist: 'fedora', release: '42', titre: 'Fedora', version: '42' }, { dist: 'archlinux', release: 'current', titre: 'Arch Linux', version: '' },
];
const SAFE_PKG = /^[a-z0-9][a-z0-9+.-]{0,62}$/;
export const slug = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
/** « Debian », « 13.1 », 12/11/2026, « Nextcloud famille » → « debian-13-1-20261112-nextcloud-famille ». Pur. */
export function nomAuto(systeme: string, version: string, when: Date, fin: string): string {
  const d = `${when.getFullYear()}${String(when.getMonth() + 1).padStart(2, '0')}${String(when.getDate()).padStart(2, '0')}`;
  return slug([systeme, version, d, fin].filter(Boolean).join('-')) || `machine-${d}`;
}
export function famille(systeme: string): Famille { return /windows/i.test(systeme) ? 'Windows' : /mac ?os|darwin/i.test(systeme) ? 'Mac' : /debian|ubuntu|alpine|rocky|alma|fedora|arch|linux|mint|kali|centos|opensuse|nixos/i.test(systeme) ? 'Linux' : 'Autre'; }
/** Une adresse MAC locale (préfixe d'Odin 02:0d:1n). */
export const newMac = () => `02:0d:1e:${[...randomBytes(3)].map((b) => b.toString(16).padStart(2, '0')).join(':')}`;
/** Le nom court (≤ 15 caractères) de la carte réseau côté PC : oc-… pour un LXC, ov-… pour une VM. */
export const ifname = (m: Pick<Machine, 'id' | 'genre'>) => `${m.genre === 'lxc' ? 'oc' : 'ov'}-${m.id.slice(0, 8)}`;

// ---------------- Réseau ----------------
export interface Reseau { pont: string; prefixe: string; masque: number; passerelle: string; dns: string; debut: number }
export const RESEAU_DEFAUT: Reseau = { pont: 'lxcbr0', prefixe: '10.0.3', masque: 24, passerelle: '10.0.3.1', dns: '10.0.3.1', debut: 60 };
/** La première adresse libre à partir de « debut » (ni prise par une machine d'Odin, ni dans « occupees »). Pur. */
export function ipLibre(r: Reseau, prises: string[], debut = r.debut): string | undefined {
  for (let n = Math.max(2, debut); n < 255; n++) { const ip = `${r.prefixe}.${n}`; if (!prises.includes(ip) && ip !== r.passerelle && ip !== r.dns) return ip; }
  return undefined;
}

// ---------------- LXC : commandes ----------------
/** Les lignes ajoutées à la configuration du conteneur (limites, réseau, console, démarrage avec le PC). Pur. */
export function lxcConfig(m: Machine, r: Reseau, lxcDir: string): string[] {
  const out = [
    '# Odin · Hydre', `lxc.cgroup2.cpu.max = ${m.cpu * 100000} 100000`, `lxc.cgroup2.memory.max = ${m.ram}M`,
    `lxc.console.logfile = ${join(lxcDir, m.nom, 'console.log')}`, 'lxc.start.auto = 1',
  ];
  if (m.quarantaine) out.push('lxc.net.0.type = empty');
  else out.push('lxc.net.0.type = veth', `lxc.net.0.link = ${r.pont}`, 'lxc.net.0.flags = up', `lxc.net.0.hwaddr = ${m.mac}`, `lxc.net.0.veth.pair = ${ifname(m)}`, `lxc.net.0.ipv4.address = ${m.ip}/${r.masque}`, `lxc.net.0.ipv4.gateway = ${r.passerelle}`);
  return out;
}
/** Remplace, dans une configuration LXC, le réseau et les limites par ceux d'Odin (les autres lignes restent). Pur. */
export function rewriteConfig(text: string, extra: string[]): string {
  const keep = text.split('\n').filter((l) => !/^\s*lxc\.(net\.|cgroup2\.cpu\.max|cgroup2\.memory\.max|console\.logfile|start\.auto)|^# Odin · Hydre/.test(l));
  while (keep.length && !keep.at(-1)!.trim()) keep.pop();
  return `${[...keep, '', ...extra].join('\n')}\n`;
}
/** « lxc-info -H » → état, PID, IP, processeur (ns cumulés), mémoire (octets). Pur. */
export function parseLxcInfo(out: string): { state?: string; pid?: number; ip?: string; cpuNs?: number; mem?: number } {
  const g = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, 'mi').exec(out)?.[1].trim();
  const n = (x?: string) => (x && /^\d+/.test(x) ? Number(/^\d+/.exec(x)![0]) : undefined);
  return { state: g('State'), pid: n(g('PID')), ip: g('IP'), cpuNs: n(g('CPU use')), mem: n(g('Memory use')) };
}

// ---------------- VM : commandes ----------------
/** La ligne de commande QEMU (pure) : KVM si présent, sinon émulation ; écran capturable par QMP ; réseau par une carte TAP. */
export function qemuArgs(m: Machine, dir: string, o: { kvm: boolean; ovmf?: string; installer?: string; qmp?: string }): string[] {
  const a = ['-name', `odin-${m.nom}`, '-machine', `q35,accel=${o.kvm ? 'kvm' : 'tcg'}`, '-cpu', o.kvm ? 'host' : 'max', '-smp', String(m.cpu), '-m', `${m.ram}M`,
    '-drive', `file=${join(dir, 'disque.qcow2')},if=virtio,format=qcow2`, '-display', 'none', '-vga', 'std',
    '-qmp', `unix:${o.qmp ?? join(dir, 'qmp.sock')},server=on,wait=off`, '-pidfile', join(dir, 'pid'), '-daemonize', '-usb', '-device', 'usb-tablet'];
  if (m.uefi && o.ovmf) a.push('-bios', o.ovmf);
  if (o.installer) a.push('-cdrom', o.installer, '-boot', 'once=d');
  if (m.quarantaine) a.push('-nic', 'none');
  else a.push('-netdev', `tap,id=n0,ifname=${ifname(m)},script=no,downscript=no`, '-device', `virtio-net-pci,netdev=n0,mac=${m.mac}`);
  return a;
}
/** Une commande QMP (socket de la VM) : renvoie la réponse « return ». */
export function qmp(sock: string, execute: string, args?: Record<string, unknown>, timeoutMs = 8000): Promise<unknown> {
  return new Promise((ok, ko) => {
    const c = createConnection(sock); let buf = '', stage = 0; const t = setTimeout(() => { c.destroy(); ko(new Error('la VM ne répond pas (QMP)')); }, timeoutMs);
    const done = (e: Error | undefined, v?: unknown) => { clearTimeout(t); c.end(); if (e) ko(e); else ok(v); };
    c.on('error', (e) => done(e));
    c.on('data', (d) => {
      buf += d.toString(); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
        let msg: { QMP?: unknown; return?: unknown; error?: { desc?: string }; event?: string }; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.event) continue;
        if (stage === 0 && msg.QMP) { stage = 1; c.write(`${JSON.stringify({ execute: 'qmp_capabilities' })}\n`); continue; }
        if (stage === 1) { if (msg.error) return done(new Error(msg.error.desc ?? 'QMP')); stage = 2; c.write(`${JSON.stringify({ execute, ...(args ? { arguments: args } : {}) })}\n`); continue; }
        if (stage === 2) return msg.error ? done(new Error(msg.error.desc ?? 'QMP')) : done(undefined, msg.return);
      }
    });
  });
}

// ---------------- Images : capture d'écran (PPM) → PNG réduit ----------------
/** Lit un PPM binaire (P6, 8 bits) : largeur, hauteur, pixels RGB. Pur. */
export function readPpm(b: Buffer): { w: number; h: number; px: Buffer } {
  let p = 0; const tok = (): string => { while (p < b.length) { const c = b[p]; if (c === 0x23) { while (p < b.length && b[p] !== 0x0a) p++; } else if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) p++; else break; } const s0 = p; while (p < b.length && ![0x20, 0x0a, 0x0d, 0x09].includes(b[p])) p++; return b.subarray(s0, p).toString('latin1'); };
  if (tok() !== 'P6') throw new Error('capture illisible (PPM attendu)');
  const w = Number(tok()), h = Number(tok()), max = Number(tok()); p++;
  if (!(w > 0 && h > 0 && max === 255) || b.length - p < w * h * 3) throw new Error('capture incomplète');
  return { w, h, px: b.subarray(p, p + w * h * 3) };
}
/** Encode des pixels RGB en PNG, réduits pour tenir dans « maxW » (moyenne des points). Pur. */
export function pngFromRgb(w: number, h: number, px: Buffer, maxW = 480): Buffer {
  const f = Math.max(1, Math.ceil(w / maxW)), W = Math.floor(w / f), H = Math.floor(h / f), raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
      let s = 0; for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += px[((y * f + dy) * w + (x * f + dx)) * 3 + c];
      raw[y * (W * 3 + 1) + 1 + x * 3 + c] = Math.round(s / (f * f));
    }
  }
  const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type, 'latin1'), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0); return Buffer.concat([len, t, data, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** Les dernières lignes d'une console, sans les codes de couleur. Pur. */
export function consoleTail(text: string, n = 8): string[] {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '').split('\n').map((l) => l.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trimEnd()).filter((l) => l.trim()).slice(-n);
}

// ---------------- .ody ----------------
export interface OdyManifest { format: 'ody'; version: 1; genre: Genre; nom: string; systeme: string; versionSysteme: string; cpu: number; ram: number; disque: number; modele?: Machine['modele']; uefi?: boolean; apps: string[]; paquets: string[]; sha256: string; taille: number; cree: number; exporte: number; par: string }
export async function sha256File(f: string): Promise<string> { const h = createHash('sha256'); await new Promise<void>((ok, ko) => createReadStream(f).on('data', (d) => h.update(d)).on('end', ok).on('error', ko)); return h.digest('hex'); }
/** Les chemins d'une archive : tous sous « racine/ », jamais « .. » ni absolus. Pur. */
export function safeEntries(list: string[], racine: string): boolean {
  return list.length > 0 && list.every((e) => { const x = e.replace(/^\.\//, ''); return !x.startsWith('/') && !x.split('/').includes('..') && (x === racine || x === `${racine}/` || x.startsWith(`${racine}/`)); });
}

// ---------------- Le moteur ----------------
export class Local {
  /** dernière mesure du processeur (par machine), pour calculer un pourcentage entre deux lectures */
  private static last = new Map<string, { at: number; cpuNs: number }>();
  private get last() { return Local.last; }
  private ctx: ModCtx;
  constructor(ctx: ModCtx) { this.ctx = ctx; }
  get dir(): string { return join(this.ctx.dir, 'machines'); }
  get lxcDir(): string { return String(this.ctx.settings.lxcDossier ?? join(this.dir, 'lxc')); }
  vmDir(m: Pick<Machine, 'nom'>): string { return join(this.dir, 'vm', m.nom); }
  /** Le chemin du socket QMP : court (Linux limite ces chemins à 108 caractères), dans un dossier réservé à Odin. */
  qmpSock(m: Pick<Machine, 'id'>): string {
    for (const d of ['/run/odin-vm', join('/tmp', `odin-vm-${process.getuid?.() ?? 0}`)]) { try { mkdirSync(d, { recursive: true, mode: 0o700 }); return join(d, `${m.id}.qmp`); } catch { /* suivant */ } }
    return join(this.vmDir(m as Machine), 'qmp.sock');
  }
  reseau(): Reseau { return { ...RESEAU_DEFAUT, ...(this.ctx.settings.reseauMachines as Partial<Reseau> | undefined) }; }
  list(): Machine[] { try { return JSON.parse(readFileSync(join(this.dir, 'machines.json'), 'utf8')) as Machine[]; } catch { return []; } }
  save(l: Machine[]): void { mkdirSync(this.dir, { recursive: true }); const f = join(this.dir, 'machines.json'); writeFileSync(`${f}.tmp`, JSON.stringify(l, null, 1)); renameSync(`${f}.tmp`, f); }
  find(q: unknown): Machine {
    const t = String(q ?? '').trim().toLowerCase(), l = this.list();
    const m = l.find((x) => x.id === t || x.nom === t || x.ip === t) ?? l.find((x) => x.nom.includes(slug(t)) && t.length >= 3);
    if (!m) throw new Error(`machine introuvable : « ${String(q ?? '')} »`);
    return m;
  }
  update(m: Machine): void { this.save(this.list().map((x) => (x.id === m.id ? m : x))); }
  private run(cmd: string, args: string[], timeoutMs = 120_000, input?: string) { return this.ctx.run(cmd, args, { timeoutMs, sudo: true, ...(input ? { input } : {}) }); }
  private async must(cmd: string, args: string[], what: string, timeoutMs?: number): Promise<string> {
    const r = await this.run(cmd, args, timeoutMs);
    if (r.code !== 0 && /Failed to download|Could not resolve|Temporary failure in name resolution/i.test(r.err + r.out)) throw new Error(`${what} : téléchargement de l'image impossible (pas d'accès à images.linuxcontainers.org depuis ce PC)`);
    if (r.code !== 0) throw new Error(`${what} : ${(r.err || r.out).trim().split('\n').slice(-2).join(' ').slice(0, 300) || `code ${r.code}`}`); return r.out;
  }
  /** Ce qu'il manque sur le PC pour ce genre de machine. */
  async manque(genre: Genre): Promise<string[]> {
    const need = genre === 'lxc' ? ['lxc-create', 'lxc-start', 'lxc-info', 'ip'] : ['qemu-system-x86_64', 'qemu-img', 'ip'];
    const out: string[] = []; for (const c of need) if (!(await this.ctx.has(c))) out.push(c); return out;
  }
  /** Une adresse est libre : à aucune machine d'Odin, et personne ne répond dessus (ping). */
  async ipDispo(ip: string, sauf?: string): Promise<boolean> {
    if (this.list().some((m) => m.ip === ip && m.id !== sauf)) return false;
    const r = await this.ctx.run('ping', ['-c', '1', '-W', '1', ip], { timeoutMs: 4000 }).catch(() => ({ code: 1, out: '', err: '' }));
    return r.code !== 0;
  }
  /** La première adresse libre du réseau des machines (vérifiée). */
  async prochaineIp(): Promise<string | undefined> {
    const r = this.reseau(), prises = this.list().map((m) => m.ip);
    for (let k = r.debut; k < 255; k++) { const c = ipLibre(r, prises, k); if (!c) return undefined; if (await this.ipDispo(c)) return c; k = Number(c.split('.').pop()); }
    return undefined;
  }
  kvm(): boolean { return existsSync('/dev/kvm'); }
  ovmf(): string | undefined { return ['/usr/share/ovmf/OVMF.fd', '/usr/share/OVMF/OVMF_CODE.fd', '/usr/share/edk2/ovmf/OVMF_CODE.fd', '/usr/share/qemu/OVMF.fd'].find((f) => existsSync(f)); }

  // ----- création -----
  async creer(m: Machine, o: { installer?: string } = {}): Promise<string[]> {
    const notes: string[] = [], r = this.reseau();
    if (this.list().some((x) => x.nom === m.nom)) throw new Error(`le nom « ${m.nom} » est déjà pris`);
    if (this.list().some((x) => x.ip === m.ip)) throw new Error(`l'adresse ${m.ip} est déjà à une autre machine`);
    const miss = await this.manque(m.genre); if (miss.length) throw new Error(`il manque sur ce PC : ${miss.join(', ')} (paquets ${m.genre === 'lxc' ? '« lxc »' : '« qemu-system-x86 » et « qemu-utils »'})`);
    if (m.genre === 'lxc') {
      if (!m.modele) throw new Error('choisis un modèle LXC');
      mkdirSync(this.lxcDir, { recursive: true });
      await this.must('lxc-create', ['-P', this.lxcDir, '-n', m.nom, '-t', 'download', ...(m.disque ? ['-B', 'loop', '--fssize', `${m.disque}G`] : []), '--', '-d', m.modele.dist, '-r', m.modele.release, '-a', 'amd64'], 'création du conteneur', 900_000);
      const cf = join(this.lxcDir, m.nom, 'config'); writeFileSync(cf, rewriteConfig(readFileSync(cf, 'utf8'), lxcConfig(m, r, this.lxcDir)));
      this.save([...this.list(), m]);
      await this.demarrer(m);
      if (m.paquets.length) notes.push(await this.paquets(m));
    } else {
      const d = this.vmDir(m); mkdirSync(d, { recursive: true });
      await this.must('qemu-img', ['create', '-f', 'qcow2', join(d, 'disque.qcow2'), `${m.disque}G`], 'disque de la VM');
      writeFileSync(join(d, 'vm.json'), JSON.stringify(m, null, 1));
      this.save([...this.list(), m]);
      if (/windows 11/i.test(m.systeme)) notes.push('Windows 11 demande une puce TPM : sans « swtpm » sur ce PC, son installation refusera de continuer.');
      if (!this.kvm()) notes.push('Ce PC n\'a pas KVM : la VM tourne en émulation, beaucoup plus lentement.');
      await this.demarrer(m, o.installer);
    }
    return notes;
  }
  private async paquets(m: Machine): Promise<string> {
    const p = m.paquets.filter((x) => SAFE_PKG.test(x)); if (!p.length) return '';
    const cmd = m.modele?.dist === 'alpine' ? `apk add --no-cache ${p.join(' ')}` : /rocky|alma|fedora/.test(m.modele?.dist ?? '') ? `dnf -y install ${p.join(' ')}` : m.modele?.dist === 'archlinux' ? `pacman -Sy --noconfirm ${p.join(' ')}` : `export DEBIAN_FRONTEND=noninteractive; apt-get update -q && apt-get install -yq ${p.join(' ')}`;
    for (let k = 0; k < 15; k++) { const e = await this.etat(m); if (e.ip && e.ip !== '-') break; await new Promise((ok) => setTimeout(ok, 1000)); }
    const r = await this.run('lxc-attach', ['-P', this.lxcDir, '-n', m.nom, '--', 'sh', '-c', cmd], 1_200_000);
    return r.code === 0 ? `📦 Installés : ${p.join(', ')}.` : `⚠ Logiciels non installés (${p.join(', ')}) : ${(r.err || r.out).trim().split('\n').at(-1)?.slice(0, 200) ?? `code ${r.code}`}`;
  }

  // ----- marche / arrêt -----
  async demarrer(m: Machine, installer?: string): Promise<void> {
    if (m.genre === 'lxc') { await this.must('lxc-start', ['-P', this.lxcDir, '-n', m.nom, '-d'], 'démarrage'); }
    else {
      const d = this.vmDir(m), tap = ifname(m), r = this.reseau();
      if (!m.quarantaine) {
        await this.run('ip', ['tuntap', 'add', 'dev', tap, 'mode', 'tap'], 10_000); // déjà là : sans gravité
        await this.must('ip', ['link', 'set', tap, 'master', r.pont, 'up'], `branchement de ${tap} sur ${r.pont}`);
      }
      rmSync(this.qmpSock(m), { force: true });
      await this.must('qemu-system-x86_64', qemuArgs(m, d, { kvm: this.kvm(), ovmf: this.ovmf(), installer, qmp: this.qmpSock(m) }), 'démarrage de la VM', 60_000);
    }
    m.arretVoulu = false; this.update(m);
  }
  async arreter(m: Machine, force = false): Promise<void> {
    m.arretVoulu = true; this.update(m);
    if (m.genre === 'lxc') { await this.must('lxc-stop', ['-P', this.lxcDir, '-n', m.nom, ...(force ? ['-k'] : ['-t', '60'])], 'arrêt', 90_000); return; }
    const sock = this.qmpSock(m); if (!existsSync(sock)) return;
    await qmp(sock, force ? 'quit' : 'system_powerdown').catch(() => undefined);
  }
  async etat(m: Machine): Promise<Etat> {
    if (m.genre === 'lxc') {
      const r = await this.run('lxc-info', ['-P', this.lxcDir, '-n', m.nom, '-H'], 10_000); if (r.code !== 0) return { state: 'inconnue' };
      const i = parseLxcInfo(r.out), now = Date.now(); let cpuPct: number | undefined;
      const prev = this.last.get(m.id); if (i.cpuNs !== undefined) { if (prev && now > prev.at) cpuPct = Math.max(0, Math.min(100, ((i.cpuNs - prev.cpuNs) / 1e6 / (now - prev.at)) * 100 / m.cpu)); this.last.set(m.id, { at: now, cpuNs: i.cpuNs }); }
      return { state: i.state === 'RUNNING' ? 'en marche' : 'éteinte', pid: i.pid, ip: i.ip, ...(cpuPct !== undefined ? { cpuPct: Math.round(cpuPct) } : {}), ...(i.mem !== undefined ? { ramMo: Math.round(i.mem / 1048576) } : {}) };
    }
    const pf = join(this.vmDir(m), 'pid'); let pid: number | undefined; try { pid = Number(readFileSync(pf, 'utf8').trim()); } catch { /* jamais démarrée */ }
    if (!pid || !existsSync(`/proc/${pid}`)) return { state: 'éteinte' };
    let cpuPct: number | undefined, ramMo: number | undefined;
    try { const st = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '), ticks = Number(st[11]) + Number(st[12]), ns = ticks * 1e7, now = Date.now(), prev = this.last.get(m.id); if (prev && now > prev.at) cpuPct = Math.round(Math.max(0, Math.min(100, ((ns - prev.cpuNs) / 1e6 / (now - prev.at)) * 100 / m.cpu))); this.last.set(m.id, { at: now, cpuNs: ns }); } catch { /* lu au prochain tour */ }
    try { ramMo = Math.round(Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0) / 1024); } catch { /* idem */ }
    return { state: 'en marche', pid, cpuPct, ramMo, ip: m.ip };
  }
  /** L'aperçu en direct : la capture d'écran (VM) ou les dernières lignes de la console (LXC). */
  async apercu(m: Machine): Promise<{ png?: string; lignes?: string[] }> {
    if (m.genre === 'lxc') { try { return { lignes: consoleTail(readFileSync(join(this.lxcDir, m.nom, 'console.log'), 'utf8').slice(-20000)) }; } catch { return { lignes: [] }; } }
    const d = this.vmDir(m), sock = this.qmpSock(m), f = join(d, 'ecran.ppm');
    if (!existsSync(sock)) return {};
    await qmp(sock, 'screendump', { filename: f });
    const { w, h, px } = readPpm(readFileSync(f)); rmSync(f, { force: true });
    return { png: pngFromRgb(w, h, px).toString('base64') };
  }
  /** Processeur et mémoire : tout de suite pour un LXC (cgroup), au prochain démarrage pour une VM. */
  async ressources(m: Machine, cpu: number, ram: number): Promise<string> {
    m.cpu = cpu; m.ram = ram;
    if (m.genre === 'lxc') {
      const cf = join(this.lxcDir, m.nom, 'config'); writeFileSync(cf, rewriteConfig(readFileSync(cf, 'utf8'), lxcConfig(m, this.reseau(), this.lxcDir)));
      this.update(m);
      if ((await this.etat(m)).state === 'en marche') { await this.must('lxc-cgroup', ['-P', this.lxcDir, '-n', m.nom, 'cpu.max', `${cpu * 100000} 100000`], 'processeur'); await this.must('lxc-cgroup', ['-P', this.lxcDir, '-n', m.nom, 'memory.max', `${ram}M`], 'mémoire'); return 'appliqué tout de suite, sans arrêter la machine'; }
      return 'pris en compte au prochain démarrage';
    }
    writeFileSync(join(this.vmDir(m), 'vm.json'), JSON.stringify(m, null, 1)); this.update(m);
    return 'pour une VM : au prochain démarrage';
  }
  async cloner(src: Machine, nom: string): Promise<Machine> {
    if ((await this.etat(src)).state === 'en marche') throw new Error(`arrête d'abord ${src.nom} (une copie se fait machine éteinte)`);
    const r = this.reseau(), ip = await this.prochaineIp(); if (!ip) throw new Error('plus d\'adresse libre sur le réseau des machines');
    const m: Machine = { ...structuredClone(src), id: randomBytes(6).toString('hex'), nom: slug(nom), ip, mac: newMac(), cree: Date.now(), quarantaine: undefined, arretVoulu: true };
    if (this.list().some((x) => x.nom === m.nom)) throw new Error(`le nom « ${m.nom} » est déjà pris`);
    if (m.genre === 'lxc') {
      await this.must('lxc-copy', ['-P', this.lxcDir, '-n', src.nom, '-N', m.nom], 'copie', 1_800_000);
      const cf = join(this.lxcDir, m.nom, 'config'); writeFileSync(cf, rewriteConfig(readFileSync(cf, 'utf8'), lxcConfig(m, r, this.lxcDir)));
    } else {
      mkdirSync(this.vmDir(m), { recursive: true });
      await this.must('qemu-img', ['convert', '-O', 'qcow2', join(this.vmDir(src), 'disque.qcow2'), join(this.vmDir(m), 'disque.qcow2')], 'copie du disque', 3_600_000);
      writeFileSync(join(this.vmDir(m), 'vm.json'), JSON.stringify(m, null, 1));
    }
    this.save([...this.list(), m]); return m;
  }
  async supprimer(m: Machine): Promise<void> {
    if ((await this.etat(m)).state === 'en marche') await this.arreter(m, true);
    if (m.genre === 'lxc') await this.must('lxc-destroy', ['-P', this.lxcDir, '-n', m.nom], 'suppression');
    else { await this.run('ip', ['link', 'del', ifname(m)], 10_000); rmSync(this.vmDir(m), { recursive: true, force: true }); }
    this.save(this.list().filter((x) => x.id !== m.id));
  }

  // ----- quarantaine -----
  /** Débranche la machine de tout, tout de suite, et pour ses prochains démarrages. */
  async isoler(m: Machine, raison: string): Promise<Journal[]> {
    if (m.quarantaine) return [];
    const now = Date.now(), j: Journal[] = [];
    m.quarantaine = { depuis: now, raison, journal: [] };
    if (m.genre === 'lxc') { const cf = join(this.lxcDir, m.nom, 'config'); if (existsSync(cf)) writeFileSync(cf, rewriteConfig(readFileSync(cf, 'utf8'), lxcConfig(m, this.reseau(), this.lxcDir))); }
    else if (existsSync(this.vmDir(m))) writeFileSync(join(this.vmDir(m), 'vm.json'), JSON.stringify(m, null, 1));
    const cut = await this.run('ip', ['link', 'set', ifname(m), 'nomaster'], 10_000), down = await this.run('ip', ['link', 'set', ifname(m), 'down'], 10_000);
    j.push({ at: Date.now(), quoi: 'Machine isolée : Internet et réseau coupés', detail: cut.code === 0 && down.code === 0 ? 'carte réseau débranchée' : 'éteinte : sans réseau à son prochain démarrage', annuler: { action: 'liberer_machine', input: { machine: m.id }, label: 'Annuler' } });
    m.quarantaine.journal.push(...j); this.update(m); return j;
  }
  async liberer(m: Machine): Promise<void> {
    if (!m.quarantaine) return;
    const q = m.quarantaine; m.quarantaine = undefined;
    if (m.genre === 'lxc') { const cf = join(this.lxcDir, m.nom, 'config'); if (existsSync(cf)) writeFileSync(cf, rewriteConfig(readFileSync(cf, 'utf8'), lxcConfig(m, this.reseau(), this.lxcDir))); }
    else if (existsSync(this.vmDir(m))) writeFileSync(join(this.vmDir(m), 'vm.json'), JSON.stringify(m, null, 1));
    const st = await this.etat(m);
    if (st.state === 'en marche') {
      if (m.genre === 'lxc') { /* l'interface « empty » n'a pas de carte : le réseau revient au redémarrage */ await this.arreter(m); await this.demarrer(m); }
      else { const r = await this.run('ip', ['link', 'set', ifname(m), 'master', this.reseau().pont, 'up'], 10_000); if (r.code !== 0) { m.quarantaine = q; this.update(m); throw new Error('la VM a démarré sans carte réseau : redémarre-la pour retrouver le réseau'); } }
    }
    this.update(m);
  }

  // ----- .ody -----
  async exporter(m: Machine, dest: string): Promise<{ fichier: string; taille: number; sha256: string }> {
    if ((await this.etat(m)).state === 'en marche') throw new Error(`arrête d'abord ${m.nom} (l'export se fait machine éteinte, pour un fichier cohérent)`);
    mkdirSync(dest, { recursive: true });
    const tmp = join(this.dir, `.export-${m.id}`); rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
    try {
      const base = m.genre === 'lxc' ? this.lxcDir : join(this.dir, 'vm'), payload = join(tmp, 'machine.tgz');
      await this.must('tar', ['--numeric-owner', '-C', base, '-czf', payload, m.nom], 'archive de la machine', 3_600_000);
      const sha = await sha256File(payload), taille = statSync(payload).size;
      const man: OdyManifest = { format: 'ody', version: 1, genre: m.genre, nom: m.nom, systeme: m.systeme, versionSysteme: m.version, cpu: m.cpu, ram: m.ram, disque: m.disque, modele: m.modele, uefi: m.uefi, apps: m.apps, paquets: m.paquets, sha256: sha, taille, cree: m.cree, exporte: Date.now(), par: 'Odin · Hydre' };
      writeFileSync(join(tmp, 'manifest.json'), JSON.stringify(man, null, 1));
      const out = join(dest, `${m.nom}.ody`);
      await this.must('tar', ['-C', tmp, '-cf', `${out}.part`, 'manifest.json', 'machine.tgz'], 'fichier .ody');
      renameSync(`${out}.part`, out);
      return { fichier: out, taille: statSync(out).size, sha256: sha };
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
  /** Lit un .ody : contenu attendu, empreinte vérifiée ; renvoie le manifeste et l'archive prête (dossier temporaire). */
  async ouvrirOdy(file: string): Promise<{ man: OdyManifest; payload: string; tmp: string }> {
    const list = (await this.must('tar', ['-tf', file], 'lecture du .ody')).split('\n').map((x) => x.trim()).filter(Boolean);
    if (list.length !== 2 || !list.includes('manifest.json') || !list.includes('machine.tgz')) throw new Error('ce fichier n\'est pas un .ody d\'Odin');
    const tmp = join(this.dir, `.import-${randomBytes(4).toString('hex')}`); mkdirSync(tmp, { recursive: true });
    try {
      await this.must('tar', ['-C', tmp, '-xf', file, 'manifest.json', 'machine.tgz'], 'ouverture du .ody');
      const man = JSON.parse(readFileSync(join(tmp, 'manifest.json'), 'utf8')) as OdyManifest;
      if (man.format !== 'ody' || man.version !== 1 || !['lxc', 'vm'].includes(man.genre) || !/^[a-z0-9-]{1,63}$/.test(man.nom)) throw new Error('manifeste du .ody invalide');
      const payload = join(tmp, 'machine.tgz'), sha = await sha256File(payload);
      if (sha !== man.sha256) throw new Error('empreinte différente : le fichier a été modifié ou abîmé, import refusé');
      const inner = (await this.must('tar', ['-tzf', payload], 'contenu de la machine', 600_000)).split('\n').map((x) => x.trim()).filter(Boolean);
      if (!safeEntries(inner, man.nom)) throw new Error('le .ody contient des chemins dangereux, import refusé');
      return { man, payload, tmp };
    } catch (e) { rmSync(tmp, { recursive: true, force: true }); throw e; }
  }
  async importer(o: { man: OdyManifest; payload: string; tmp: string }, nom?: string): Promise<Machine> {
    const { man, payload, tmp } = o, r = this.reseau();
    try {
      const want = slug(nom || man.nom), ip = await this.prochaineIp(); if (!ip) throw new Error('plus d\'adresse libre sur le réseau des machines');
      if (this.list().some((x) => x.nom === want)) throw new Error(`le nom « ${want} » est déjà pris : donne un autre nom`);
      const m: Machine = { id: randomBytes(6).toString('hex'), nom: want, genre: man.genre, systeme: man.systeme, version: man.versionSysteme, famille: famille(man.systeme), cpu: man.cpu, ram: man.ram, disque: man.disque, ip, mac: newMac(), cree: Date.now(), modele: man.modele, uefi: man.uefi, apps: man.apps ?? [], paquets: man.paquets ?? [], arretVoulu: true };
      const base = m.genre === 'lxc' ? this.lxcDir : join(this.dir, 'vm'), x = join(tmp, 'x'); mkdirSync(x, { recursive: true }); mkdirSync(base, { recursive: true });
      await this.must('tar', ['--numeric-owner', '-C', x, '-xzf', payload], 'extraction', 3_600_000);
      if (existsSync(join(base, m.nom))) throw new Error(`un dossier « ${m.nom} » existe déjà`);
      renameSync(join(x, man.nom), join(base, m.nom));
      if (m.genre === 'lxc') {
        const cf = join(base, m.nom, 'config');
        const txt = readFileSync(cf, 'utf8').split('\n').map((l) => l.replace(/^(\s*lxc\.uts\.name\s*=).*/, `$1 ${m.nom}`).replace(/^(\s*lxc\.rootfs\.path\s*=\s*(?:\w+:)?)(.*)$/, (_a, k: string, p: string) => `${k}${p.replace(new RegExp(`[^:]*/${man.nom}/`), `${join(base, m.nom)}/`)}`)).join('\n');
        writeFileSync(cf, rewriteConfig(txt, lxcConfig(m, r, this.lxcDir)));
      } else writeFileSync(join(base, m.nom, 'vm.json'), JSON.stringify(m, null, 1));
      this.save([...this.list(), m]); return m;
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }

  // ----- le PC hôte -----
  async hote(): Promise<{ coeurs: number; cpuPct: number; ramTotal: number; ramUtilisee: number; disqueTotal?: number; disqueUtilise?: number; kvm: boolean }> {
    const c = cpus().length, used = totalmem() - freemem();
    let dt: number | undefined, du: number | undefined;
    try { const r = await this.ctx.run('df', ['-B1', '--output=size,used', existsSync(this.dir) ? this.dir : this.ctx.dir], { timeoutMs: 5000 }); const l = r.out.trim().split('\n').at(-1)?.trim().split(/\s+/); if (l && l.length >= 2) { dt = Number(l[0]); du = Number(l[1]); } } catch { /* df absent */ }
    return { coeurs: c, cpuPct: Math.round(Math.min(100, (loadavg()[0] / c) * 100)), ramTotal: totalmem(), ramUtilisee: used, disqueTotal: dt, disqueUtilise: du, kvm: this.kvm() };
  }
  /** Les ISO d'Andromède (pour une VM). */
  isos(root: string): Array<{ nom: string; chemin: string; taille: number }> {
    const out: Array<{ nom: string; chemin: string; taille: number }> = [];
    const walk = (d: string, depth: number) => { let n: string[] = []; try { n = readdirSync(d); } catch { return; } for (const x of n.sort()) { if (x.startsWith('.')) continue; const p = join(d, x); let st; try { st = statSync(p); } catch { continue; } if (st.isDirectory()) { if (depth < 2) walk(p, depth + 1); } else if (/\.iso$/i.test(x)) out.push({ nom: x.replace(/\.iso$/i, ''), chemin: p, taille: st.size }); } };
    walk(root, 0); return out;
  }
}
