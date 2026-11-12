// Þjálfi · le déploiement par le réseau (façon iVentoy, netboot.xyz, FOG), réécrit pour Odin.
//   - Les ISO d'Eitri démarrent par le réseau (PXE, BIOS et UEFI) sans clé USB : Odin les lit directement
//     dans les fichiers .iso, sans les extraire.
//   - Une machine que tu autorises s'installe toute seule (Ubuntu, Debian, Fedora / Rocky / Alma, Windows) :
//     compte, langue, clavier, fuseau, paquets ; à la fin, les logiciels de Fjalar (Windows) et les paquets
//     choisis (Linux) s'installent, puis la machine prévient Odin avec le nom qu'elle a pris sur le réseau.
//   - Tu vois les machines en cours, l'ISO de chacune et son étape, celles déjà passées, et combien de fois
//     chaque ISO a été déployée.
// Sécurité : une machine inconnue démarre par défaut sur son propre disque ; l'installation automatique
// (qui efface le disque) ne se fait que pour une machine autorisée par toi, une seule fois.
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { basename, join } from 'node:path';
import type { Action, Kpi, ModCtx, Module, Section } from '../types.ts';
import { Iso } from '../thjalfi/iso.ts';
import { ProxyDhcp, bootFor, type Firmware } from '../thjalfi/pxe.ts';
import { debianPreseed, detect, kickstart, menu, odinCmd, silentArgs, ubuntuMetaData, ubuntuUserData, unattend, windowsAfter, winpeshl, type Answer, type Recipe } from '../thjalfi/recipes.ts';
import { normMac, PxeHttp } from '../thjalfi/server.ts';
import { TftpServer } from '../thjalfi/tftp.ts';
import { pxeHook } from '../vidarr/dhcp.ts';

const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));
type Step = 'démarrage réseau' | 'chargeur' | 'menu' | 'chargement' | 'installation' | 'logiciels' | 'fini' | 'sans nouvelles' | 'échec';
const FINAL: Step[] = ['fini', 'sans nouvelles', 'échec'];
export interface IsoInfo { id: string; name: string; path: string; size: number; mtime: number; recipe?: Recipe; err?: string }
export interface Rule { mac: string; nom?: string; iso?: string; profil?: string; auto: boolean; fait?: boolean; ajoute: number }
export interface Profile { id: string; nom: string; utilisateur: string; paquets: string[]; logiciels: string[]; langue: string; clavier: string; fuseau: string }
export interface Machine { mac: string; ip?: string; fw?: string; iso?: string; isoName?: string; step: Step; steps: Array<{ at: number; step: string; detail?: string }>; started: number; updated: number; host?: string; token?: string; profil?: string; logiciels?: Array<{ nom: string; ok: boolean }> }
interface Session { token: string; mac: string; iso: string; profil: string; host: string; fw: 'uefi' | 'bios'; created: number; files?: Record<string, string> }
export interface Done { at: number; mac: string; host?: string; ip?: string; iso: string; isoName: string; profil?: string; ms: number; result: 'fini' | 'échec' | 'sans nouvelles'; logiciels?: Array<{ nom: string; ok: boolean }> }
interface Ports { http: number; tftp: number; dhcp: number; pxe: number; client: number }

/** Les chargeurs officiels (iPXE, wimboot) : téléchargés depuis leurs sites, jamais modifiés, analysés par Ullr. */
export const LOADERS: Array<{ file: string; url: string; what: string }> = [
  { file: 'undionly.kpxe', url: 'https://boot.ipxe.org/undionly.kpxe', what: 'iPXE pour les PC en BIOS (ancien démarrage)' },
  { file: 'ipxe.efi', url: 'https://boot.ipxe.org/x86_64-efi/ipxe.efi', what: 'iPXE pour les PC en UEFI 64 bits' },
  { file: 'ipxe-arm64.efi', url: 'https://boot.ipxe.org/arm64-efi/ipxe.efi', what: 'iPXE pour les machines ARM 64 bits' },
  { file: 'wimboot', url: 'https://github.com/ipxe/wimboot/releases/latest/download/wimboot', what: 'wimboot (démarrage du programme d\'installation de Windows)' },
];
const slug = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\.iso$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'iso';
const hostOf = (mac: string) => `pc-${mac.replace(/:/g, '').slice(-6)}`;
const hostLabel = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
const ago = (ms: number) => { const m = Math.round(ms / 60000); return ms < 60_000 ? (ms < 5000 ? 'à l\'instant' : `${Math.round(ms / 1000)} s`) : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
const STEP_ICON: Record<Step, string> = { 'démarrage réseau': '🔌', chargeur: '📦', menu: '📋', chargement: '⬇', installation: '🛠', logiciels: '🧩', fini: '✅', 'sans nouvelles': '❔', 'échec': '❌' };

/** Le module : une instance par Odin (état propre). */
export function thjalfi(): Module {
  let C: ModCtx | undefined; let http: PxeHttp | undefined, tftp: TftpServer | undefined, proxy: ProxyDhcp | undefined;
  const isoCache = new Map<string, IsoInfo>(); const open = new Map<string, Iso>();
  const ports = (ctx: ModCtx): Ports => ({ http: 16000, tftp: 69, dhcp: 67, pxe: 4011, client: 68, ...(ctx.settings.ports as Partial<Ports> | undefined) });
  const rules = (ctx: ModCtx): Rule[] => (ctx.settings.machines as Rule[] | undefined) ?? [];
  const profiles = (ctx: ModCtx): Profile[] => { const p = (ctx.settings.profils as Profile[] | undefined) ?? []; return p.length ? p : [{ id: 'standard', nom: 'Standard', utilisateur: 'admin', paquets: [], logiciels: [], langue: 'fr_FR.UTF-8', clavier: 'fr', fuseau: 'Indian/Mayotte' }]; };
  const bootDir = (ctx: ModCtx) => join(ctx.dir, 'boot');
  const live = (ctx: ModCtx): Record<string, Machine> => { try { return JSON.parse(readFileSync(join(ctx.dir, 'machines-en-cours.json'), 'utf8')) as Record<string, Machine>; } catch { return {}; } };
  const saveLive = (ctx: ModCtx, m: Record<string, Machine>) => { mkdirSync(ctx.dir, { recursive: true }); const f = join(ctx.dir, 'machines-en-cours.json'); writeFileSync(`${f}.tmp`, JSON.stringify(m)); renameSync(`${f}.tmp`, f); };
  const sessions = (ctx: ModCtx): Record<string, Session> => { try { return JSON.parse(readFileSync(join(ctx.dir, 'deploiements.json'), 'utf8')) as Record<string, Session>; } catch { return {}; } };
  const saveSessions = (ctx: ModCtx, x: Record<string, Session>) => { mkdirSync(ctx.dir, { recursive: true }); writeFileSync(join(ctx.dir, 'deploiements.json'), JSON.stringify(x), { mode: 0o600 }); };
  const secrets = (ctx: ModCtx): { profils?: Record<string, string>; partage?: string } => { try { return JSON.parse(readFileSync(join(ctx.dir, 'secrets.json'), 'utf8')); } catch { return {}; } };
  const saveSecrets = (ctx: ModCtx, x: ReturnType<typeof secrets>) => { mkdirSync(ctx.dir, { recursive: true }); writeFileSync(join(ctx.dir, 'secrets.json'), JSON.stringify(x), { mode: 0o600 }); };
  const histFile = (ctx: ModCtx) => join(ctx.dir, 'historique.jsonl');
  const history = (ctx: ModCtx, n = 300): Done[] => { try { return readFileSync(histFile(ctx), 'utf8').trim().split('\n').filter(Boolean).slice(-n).map((l) => JSON.parse(l) as Done).reverse(); } catch { return []; } };
  const stats = (ctx: ModCtx): Record<string, { lances: number; finis: number }> => (ctx.settings.stats as Record<string, { lances: number; finis: number }> | undefined) ?? {};
  const bump = (ctx: ModCtx, iso: string, k: 'lances' | 'finis') => { const st = stats(ctx); st[iso] = st[iso] ?? { lances: 0, finis: 0 }; st[iso][k]++; ctx.saveSettings({ stats: st }); };

  /** L'adresse d'Odin sur le réseau local (réglable). */
  const serverIp = (ctx: ModCtx): string => {
    if (s(ctx.settings.ip)) return s(ctx.settings.ip);
    const all = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a!.address);
    return all.find((a) => /^192\.168\./.test(a)) ?? all.find((a) => /^10\./.test(a)) ?? all.find((a) => /^172\.(1[6-9]|2\d|3[01])\./.test(a)) ?? all[0] ?? '127.0.0.1';
  };
  const base = (ctx: ModCtx) => `http://${serverIp(ctx)}:${http?.port ?? ports(ctx).http}`;

  // ---------------- Les ISO (dossier d'Eitri) ----------------
  async function isoRoot(ctx: ModCtx): Promise<string> {
    if (s(ctx.settings.dossier)) return s(ctx.settings.dossier);
    try { const r = await ctx.call('eitri', 'etat', {}, 'lister les ISO à déployer'); const d = (r.data as { dossier?: string } | undefined)?.dossier; if (d) return d; } catch { /* Eitri absent */ }
    return join(ctx.home, 'ISO');
  }
  async function isos(ctx: ModCtx): Promise<IsoInfo[]> {
    const root = await isoRoot(ctx), out: IsoInfo[] = [], ids = new Set<string>();
    const walk = (dir: string, depth: number) => {
      let names: string[] = []; try { names = readdirSync(dir); } catch { return; }
      for (const n of names.sort()) {
        if (n.startsWith('.')) continue; const p = join(dir, n); let st; try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) { if (depth < 2) walk(p, depth + 1); continue; }
        if (!/\.iso$/i.test(n)) continue;
        let id = slug(n); for (let k = 2; ids.has(id); k++) id = `${slug(n).slice(0, 44)}-${k}`; ids.add(id);
        out.push({ id, name: n.replace(/\.iso$/i, ''), path: p, size: st.size, mtime: st.mtimeMs });
      }
    };
    walk(root, 0);
    for (const i of out) {
      const key = `${i.path}|${i.size}|${i.mtime}`, c = isoCache.get(key);
      if (c) { i.recipe = c.recipe; i.err = c.err; continue; }
      try { const iso = await Iso.open(i.path); try { i.recipe = await detect(iso); } finally { await iso.close(); } } catch (e) { i.err = (e as Error).message; }
      isoCache.set(key, { ...i });
    }
    return out;
  }
  async function isoById(ctx: ModCtx, id: string): Promise<{ info: IsoInfo; iso: Iso } | undefined> {
    const info = (await isos(ctx)).find((x) => x.id === id); if (!info) return undefined;
    let iso = open.get(info.path); if (!iso) { iso = await Iso.open(info.path); open.set(info.path, iso); }
    return { info, iso };
  }

  // ---------------- Le suivi des machines ----------------
  function track(ctx: ModCtx, mac: string | undefined, ip: string | undefined, step: Step, o: { iso?: string; isoName?: string; fw?: string; detail?: string; host?: string; token?: string; profil?: string } = {}): Machine | undefined {
    const all = live(ctx), now = ctx.now().getTime();
    let m = mac ? all[mac] : undefined;
    if (!m && !mac && ip) m = Object.values(all).filter((x) => x.ip === ip && !FINAL.includes(x.step)).sort((a, b) => b.updated - a.updated)[0];
    if (!m && !mac) m = Object.values(all).filter((x) => !FINAL.includes(x.step) && now - x.updated < 120_000 && !x.ip).sort((a, b) => b.updated - a.updated)[0];
    if (!m) { if (!mac) return undefined; m = { mac, step, steps: [], started: now, updated: now }; }
    // Une machine finie qui redémarre par le réseau : un nouveau passage commence.
    if (FINAL.includes(m.step) && (step === 'démarrage réseau' || step === 'menu')) m = { mac: m.mac, step, steps: [], started: now, updated: now, host: m.host };
    const order: Step[] = ['démarrage réseau', 'chargeur', 'menu', 'chargement', 'installation', 'logiciels', 'fini'];
    const forward = FINAL.includes(step) || order.indexOf(step) >= order.indexOf(m.step) || FINAL.includes(m.step);
    if (forward && (m.step !== step || o.detail)) m.steps.push({ at: now, step, ...(o.detail ? { detail: o.detail } : {}) });
    if (forward) m.step = step;
    m.updated = now; if (ip) m.ip = ip;
    for (const k of ['iso', 'isoName', 'fw', 'host', 'token', 'profil'] as const) if (o[k]) m[k] = o[k];
    m.steps = m.steps.slice(-30);
    all[m.mac] = m;
    // On garde les 200 plus récentes.
    const keep = Object.values(all).sort((a, b) => b.updated - a.updated).slice(0, 200);
    saveLive(ctx, Object.fromEntries(keep.map((x) => [x.mac, x])));
    ctx.emit('etape', { mac: m.mac, etape: step, ...(m.isoName ? { iso: m.isoName } : {}), ...(m.host ? { nom: m.host } : {}) });
    return m;
  }
  function finish(ctx: ModCtx, m: Machine, result: Done['result']): void {
    const iso = m.iso ?? '?', d: Done = { at: ctx.now().getTime(), mac: m.mac, host: m.host, ip: m.ip, iso, isoName: m.isoName ?? iso, profil: m.profil, ms: ctx.now().getTime() - m.started, result, ...(m.logiciels?.length ? { logiciels: m.logiciels } : {}) };
    try { mkdirSync(ctx.dir, { recursive: true }); appendFileSync(histFile(ctx), `${JSON.stringify(d)}\n`); } catch { /* disque plein */ }
    if (result === 'fini') bump(ctx, iso, 'finis');
  }

  // ---------------- Les sessions (installations automatiques) ----------------
  function session(ctx: ModCtx, mac: string, iso: string, profil: string, host: string, fw: string): Session {
    const all = sessions(ctx), now = ctx.now().getTime();
    for (const [t, x] of Object.entries(all)) if (now - x.created > 2 * 864e5) delete all[t];
    const have = Object.values(all).find((x) => x.mac === mac && x.iso === iso && now - x.created < 864e5);
    if (have) return have;
    const x: Session = { token: randomBytes(18).toString('base64url'), mac, iso, profil, host, fw: /efi/i.test(fw) ? 'uefi' : 'bios', created: now };
    all[x.token] = x; saveSessions(ctx, all); return x;
  }
  const sessionOf = (ctx: ModCtx, token: string): Session | undefined => { const x = sessions(ctx)[token]; return x && ctx.now().getTime() - x.created < 2 * 864e5 ? x : undefined; };
  /** Le mot de passe du compte créé par un profil : généré une fois, rangé dans le coffre (Brísingamen) et ici (fichier protégé). */
  async function profilePassword(ctx: ModCtx, p: Profile): Promise<string> {
    const sec = secrets(ctx); const have = sec.profils?.[p.id]; if (have) return have;
    const pw = randomBytes(12).toString('base64url').replace(/[-_]/g, 'x');
    saveSecrets(ctx, { ...sec, profils: { ...sec.profils, [p.id]: pw } });
    await ctx.call('brisingamen', 'ajouter', { nom: `Déploiement · ${p.nom}`, identifiant: p.utilisateur, mot_de_passe: pw, site: 'Þjálfi (machines installées par le réseau)', coffre: 'TOUFATECH' }, `ranger le mot de passe du profil de déploiement ${p.nom}`).catch(() => undefined);
    return pw;
  }

  // ---------------- Le menu, les fichiers, les réponses ----------------
  function bootScript(ctx: ModCtx): string { return `#!ipxe\n# Odin · Þjálfi\nchain ${base(ctx)}/menu.ipxe?mac=\${netX/mac}&fw=\${platform} || shell\n`; }
  async function menuFor(ctx: ModCtx, mac: string, fw: string, from: string): Promise<string> {
    const list = (await isos(ctx)).filter((i) => i.recipe), r = rules(ctx).find((x) => x.mac === mac);
    track(ctx, mac || undefined, from, 'menu', { fw: fw || undefined });
    let auto: { id: string; token: string; host: string } | undefined, def = s(ctx.settings.defaut) || 'local', timeout = Number(ctx.settings.delai ?? 10);
    if (r?.auto && !r.fait && r.iso) {
      const target = list.find((i) => i.id === r.iso);
      if (target?.recipe?.auto) {
        const p = profiles(ctx).find((x) => x.id === r.profil) ?? profiles(ctx)[0], host = hostLabel(r.nom || hostOf(mac));
        const x = session(ctx, mac, target.id, p.id, host, fw);
        auto = { id: target.id, token: x.token, host }; def = target.id; timeout = 5;
        track(ctx, mac, from, 'menu', { iso: target.id, isoName: target.name, host, token: x.token, profil: p.id, detail: `installation automatique prévue : ${target.name}` });
      }
    } else if (r?.iso && list.some((i) => i.id === r.iso)) def = r.iso;
    if (def !== 'local' && !list.some((i) => i.id === def)) def = 'local';
    const nb = (codename: string) => {
      const d = join(bootDir(ctx), 'debian', codename || 'x');
      return codename && existsSync(join(d, 'linux')) && existsSync(join(d, 'initrd.gz')) ? { kernel: `boot/debian/${codename}/linux`, initrd: `boot/debian/${codename}/initrd.gz` } : undefined;
    };
    return menu({ base: base(ctx), mac, entries: list.map((i) => ({ id: i.id, name: i.name, recipe: i.recipe! })), def, timeout, auto, netboot: nb });
  }
  async function answer(ctx: ModCtx, x: Session): Promise<Answer> {
    const p = profiles(ctx).find((y) => y.id === x.profil) ?? profiles(ctx)[0];
    const sh = ctx.settings.partage as { unc?: string; utilisateur?: string } | undefined;
    return {
      host: x.host, user: p.utilisateur, password: await profilePassword(ctx, p), locale: p.langue, keymap: p.clavier, timezone: p.fuseau, packages: p.paquets,
      report: `${base(ctx)}/etat/${x.token}`, repo: `${base(ctx)}/f/${x.iso}/`, mirror: s(ctx.settings.miroir) || undefined,
      ...(sh?.unc ? { share: { unc: `${sh.unc.replace(/[\\/]+$/, '')}\\.thjalfi\\${x.iso}`, user: sh.utilisateur, password: secrets(ctx).partage } } : {}),
    };
  }
  async function seed(ctx: ModCtx, token: string, name: string, from: string): Promise<string | undefined> {
    const x = sessionOf(ctx, token); if (!x) return undefined;
    const a = await answer(ctx, x), m = live(ctx)[x.mac];
    if (!['meta-data', 'vendor-data'].includes(name)) track(ctx, x.mac, from, 'installation', { detail: `fichier de réponses lu (${name.replace(/^w:/, '')})` });
    void m;
    switch (name) {
      case 'user-data': return ubuntuUserData(a);
      case 'meta-data': return ubuntuMetaData(x.token);
      case 'vendor-data': return '';
      case 'preseed.cfg': return debianPreseed(a);
      case 'ks.cfg': return kickstart(a);
      case 'winpeshl.ini': return winpeshl();
      case 'odin.cmd': return a.share ? odinCmd(a) : undefined;
      case 'unattend.xml': return unattend(a, x.fw);
      case 'w:apres.ps1': {
        const p = profiles(ctx).find((y) => y.id === x.profil) ?? profiles(ctx)[0], files: Record<string, string> = {}, sw: NonNullable<Answer['software']> = [];
        let found: Array<{ source: string; nom: string; version: string; chemin: string }> = [];
        try { found = ((await ctx.call('fjalar', 'etat', {}, 'logiciels à installer sur la machine')).data as { fichiers?: typeof found } | undefined)?.fichiers ?? []; } catch { /* Fjalar absent */ }
        for (const id of p.logiciels) {
          const f = found.filter((y) => y.source === id).sort((u, v) => (u.version < v.version ? 1 : -1))[0]; if (!f) continue;
          const file = basename(f.chemin); files[file] = f.chemin; const sa = silentArgs(id, file);
          sw.push({ name: f.nom, url: `${base(ctx)}/logiciel/${x.token}/${encodeURIComponent(file)}`, args: sa.args, msi: sa.msi });
        }
        const all = sessions(ctx); if (all[x.token]) { all[x.token].files = files; saveSessions(ctx, all); }
        return windowsAfter({ ...a, software: sw });
      }
      default: return undefined;
    }
  }
  function report(ctx: ModCtx, token: string, q: URLSearchParams, from: string): boolean {
    const x = sessionOf(ctx, token); if (!x) return false;
    const e = q.get('e') ?? '', nom = (q.get('nom') ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 63), ip = /^[\d.]{7,15}$/.test(q.get('ip') ?? '') ? q.get('ip')! : from;
    const info = isoName(x.iso);
    if (e === 'installation') track(ctx, x.mac, from, 'installation', { iso: x.iso, isoName: info, detail: 'installation du système' });
    else if (e === 'logiciels') track(ctx, x.mac, from, 'logiciels', { detail: 'paquets et logiciels' });
    else if (e === 'logiciel') { const all = live(ctx), m = all[x.mac]; if (m) { m.logiciels = [...(m.logiciels ?? []), { nom: q.get('nom') ?? '?', ok: q.get('ok') === '1' }].slice(-40); all[x.mac] = m; saveLive(ctx, all); } track(ctx, x.mac, from, 'logiciels', { detail: `${q.get('nom')} ${q.get('ok') === '1' ? 'installé' : 'raté'}` }); }
    else if (e === 'fini') {
      const m = track(ctx, x.mac, ip, 'fini', { host: nom || x.host, detail: `installée : ${nom || x.host} (${ip})` });
      if (m) {
        finish(ctx, m, 'fini');
        const bad = (m.logiciels ?? []).filter((l) => !l.ok);
        ctx.alert({ level: bad.length ? 'moyenne' : 'info', title: `✅ ${m.host ?? x.host} installée (${m.isoName ?? info})`, detail: `Machine ${m.mac} · ${m.ip ?? ''} · en ${ago(m.updated - m.started)}${bad.length ? ` · logiciels ratés : ${bad.map((l) => l.nom).join(', ')}` : ''}.`, key: `thjalfi-fini-${m.mac}-${m.updated}` });
        ctx.emit('deploye', { mac: m.mac, nom: m.host ?? x.host, ip: m.ip ?? '', iso: m.isoName ?? info });
        void inventory(ctx, m);
      }
    } else if (e === 'echec') { const m = track(ctx, x.mac, from, 'échec', { detail: (q.get('raison') ?? 'échec signalé').slice(0, 200) }); if (m) { finish(ctx, m, 'échec'); ctx.alert({ level: 'haute', title: `❌ Installation ratée sur ${m.host ?? m.mac}`, detail: q.get('raison') ?? 'La machine a signalé un échec.', key: `thjalfi-echec-${m.mac}` }); } }
    else return false;
    return true;
  }
  const isoNames = new Map<string, string>();
  const isoName = (id: string) => isoNames.get(id) ?? id;
  /** Askr : la machine installée a sa fiche (nom pris, MAC, adresse, système). */
  async function inventory(ctx: ModCtx, m: Machine): Promise<void> {
    const note = `Installée par Þjálfi : ${m.isoName ?? m.iso} (${new Date(m.updated).toLocaleDateString('fr-FR')})`;
    const r = await ctx.call('askr', 'ajouter', { nom: m.host ?? m.mac, type: 'ordinateur', mac: m.mac, ip: m.ip ?? '', notes: note }, `fiche de la machine ${m.host ?? m.mac} installée par le réseau`).catch((e) => ({ ok: false, text: (e as Error).message }));
    if (r.ok === false && /déjà dans l'inventaire/.test(r.text)) await ctx.call('askr', 'modifier', { appareil: m.mac, nom: m.host ?? '', ip: m.ip ?? '', notes: note }, `mise à jour de la fiche de ${m.host ?? m.mac}`).catch(() => undefined);
  }

  // ---------------- Démarrer / arrêter les serveurs ----------------
  async function startServers(ctx: ModCtx): Promise<string[]> {
    stopServers(); const p = ports(ctx), notes: string[] = [], mode = s(ctx.settings.mode) || 'proxy';
    http = new PxeHttp({
      bootScript: () => bootScript(ctx), menu: (mac, fw, from) => menuFor(ctx, mac, fw, from),
      isoFile: async (id, path) => {
        const x = await isoById(ctx, id).catch(() => undefined); if (!x) return undefined; isoNames.set(id, x.info.name);
        if (path === undefined) return { size: x.info.size, open: (st, en) => import('node:fs').then((fs) => fs.createReadStream(x.info.path, { start: st, end: en })) };
        const stt = await x.iso.stat(path); if (!stt || stt.dir) return undefined;
        return { size: stt.size, open: async (st, en) => (await x.iso.stream(path, st, en + 1)).body };
      },
      bootFile: (path) => { const f = join(bootDir(ctx), path); return path.split('/').includes('..') || !existsSync(f) || statSync(f).isDirectory() ? undefined : f; },
      seed: (t, n, from) => seed(ctx, t, n, from),
      software: (t, file) => { const x = sessionOf(ctx, t); const f = x?.files?.[decodeURIComponent(file)]; return f && existsSync(f) ? f : undefined; },
      report: (t, q, from) => report(ctx, t, q, from),
      fetched: (mac, what, id, path, from) => {
        if (what === 'fichier') return;
        let iso = id, name = isoName(id);
        if (id === 'boot') { const r = rules(ctx).find((x) => x.mac === mac); if (!/^debian\//.test(path) && !/wimboot/.test(path)) return; iso = r?.iso ?? live(ctx)[mac ?? '']?.iso ?? 'debian'; name = isoName(iso); }
        const m = track(ctx, mac, from, 'chargement', { iso, isoName: name, detail: what === 'iso' ? 'copie de l\'ISO en mémoire' : `démarrage de ${name}` });
        if (m && what === 'noyau') {
          bump(ctx, iso, 'lances');
          // Installation automatique : une seule fois (au prochain démarrage par le réseau, la machine reprend son disque).
          const all = rules(ctx), r = all.find((x) => x.mac === m.mac);
          if (r?.auto && !r.fait && r.iso === iso) { r.fait = true; ctx.saveSettings({ machines: all }); }
        }
      },
      log: (t) => ctx.emit('journal', { texte: t }),
    });
    await http.start(p.http);
    try {
      tftp = new TftpServer({ file: (name) => { const n = basename(name); const f = join(bootDir(ctx), n); return /^(undionly\.kpxe|ipxe(-arm64|-i386)?\.efi|snponly\.efi)$/.test(n) && existsSync(f) ? readFileSync(f) : undefined; }, sent: (name, from) => track(ctx, undefined, from, 'chargeur', { detail: name }) });
      await tftp.start(p.tftp);
    } catch (e) { tftp = undefined; notes.push(`TFTP (port ${p.tftp}) : ${(e as Error).message} — Odin doit pouvoir ouvrir ce port (administrateur).`); }
    if (mode === 'proxy') {
      try { proxy = new ProxyDhcp({ server: () => serverIp(ctx), httpPort: () => http?.port ?? p.http, allowed: (mac) => s(ctx.settings.filtre) !== 'liste' || rules(ctx).some((r) => r.mac === mac), seen: (mac, fw, ipxe) => { if (!ipxe) track(ctx, mac, undefined, 'démarrage réseau', { fw }); } }); await proxy.start(p.dhcp, p.pxe, p.client); }
      catch (e) { proxy = undefined; notes.push(`proxy DHCP (ports ${p.dhcp} et ${p.pxe}) : ${(e as Error).message}`); }
    }
    // Avec le DHCP d'Odin (Víðarr) : il ajoute lui-même le démarrage par le réseau.
    if (mode !== 'aucun') pxeHook.get = (pk) => {
      if (s(ctx.settings.filtre) === 'liste' && !rules(ctx).some((r) => r.mac === pk.mac)) return undefined;
      const b = bootFor(pk, serverIp(ctx), http?.port ?? p.http); if (b && !/^http/.test(b.file)) track(ctx, pk.mac, undefined, 'démarrage réseau', { fw: firmware(pk.options.get(93)) }); return b;
    };
    return notes;
  }
  function stopServers(): void { http?.stop(); tftp?.stop(); proxy?.stop(); http = undefined; tftp = undefined; proxy = undefined; pxeHook.get = undefined; for (const i of open.values()) void i.close(); open.clear(); }
  const firmware = (b: Buffer | undefined): Firmware => { const n = b && b.length >= 2 ? b.readUInt16BE(0) : 0; return n === 7 || n === 9 ? 'uefi' : n === 6 ? 'uefi32' : n === 11 ? 'arm64' : 'bios'; };

  /** Télécharge un fichier officiel, empreinte gardée ; un fichier suspect pour l'antivirus est jeté. */
  async function fetchTo(ctx: ModCtx, url: string, file: string, sha?: string): Promise<{ ok: boolean; text: string }> {
    try {
      const r = await ctx.fetch(url, { signal: AbortSignal.timeout(120_000), headers: { 'user-agent': 'Odin-Thjalfi/1' } }); if (!r.ok) return { ok: false, text: `${basename(file)} : HTTP ${r.status}` };
      const b = Buffer.from(await r.arrayBuffer()); const h = createHash('sha256').update(b).digest('hex');
      if (sha && sha !== h) return { ok: false, text: `${basename(file)} : empreinte différente de celle publiée, fichier jeté` };
      mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(`${file}.part`, b);
      const v = await ctx.call('ullr', 'fichier', { chemin: `${file}.part` }, `vérifier ${basename(file)} avant de le servir aux machines`).catch(() => undefined);
      const lvl = (v?.data as { level?: string } | undefined)?.level;
      if (lvl && ['moyenne', 'haute', 'critique'].includes(lvl)) { rmSync(`${file}.part`, { force: true }); ctx.alert({ level: 'haute', title: `Þjálfi : ${basename(file)} refusé par l'antivirus`, detail: `Téléchargé depuis ${url}, jugé ${lvl} par Ullr : il n'est pas servi aux machines.`, key: `thjalfi-ullr-${basename(file)}` }); return { ok: false, text: `🛡 ${basename(file)} mis de côté (antivirus : ${lvl})` }; }
      renameSync(`${file}.part`, file);
      const sums = (ctx.settings.empreintes as Record<string, string> | undefined) ?? {}; sums[basename(file)] = h; ctx.saveSettings({ empreintes: sums });
      return { ok: true, text: `✅ ${basename(file)} (${Math.round(b.length / 1024)} Ko${sha ? ', empreinte vérifiée' : ''})` };
    } catch (e) { return { ok: false, text: `${basename(file)} : ${(e as Error).message}` }; }
  }

  // ---------------- Actions ----------------
  const isoParam = { key: 'iso', label: 'ISO (nom ou début du nom)', kind: 'text' as const, required: true };
  const findIso = async (ctx: ModCtx, q: unknown) => { const t = slug(s(q)), l = await isos(ctx); const x = l.find((i) => i.id === t) ?? l.find((i) => i.id.includes(t) && t.length >= 3) ?? l.find((i) => i.name.toLowerCase().includes(s(q).toLowerCase()) && s(q).length >= 3); if (!x) throw new Error(`ISO introuvable : « ${s(q)} » (voir la liste des ISO)`); return x; };
  const macParam = { key: 'mac', label: 'Adresse MAC de la machine', kind: 'text' as const, required: true };
  const actions: Action[] = [
    { id: 'etat', label: 'État', what: 'Serveur allumé ou non, ISO prêtes, machines en cours', read: true, words: ['état du pxe', 'état du démarrage réseau', 'pxe'], run: async (ctx) => {
      C = ctx; const l = await isos(ctx), m = Object.values(live(ctx)).filter((x) => !FINAL.includes(x.step)), ready = LOADERS.filter((x) => existsSync(join(bootDir(ctx), x.file)));
      return { text: `Þjálfi ${http ? `allumé · http://${serverIp(ctx)}:${http.port}` : 'éteint'} · ${l.filter((i) => i.recipe).length} ISO démarrable(s) (${l.filter((i) => i.recipe?.auto).length} en installation automatique) · chargeurs : ${ready.length}/${LOADERS.length} · ${m.length} machine(s) en cours${m.length ? `\n${m.map((x) => `- ${x.host ?? x.mac} : ${x.step}${x.isoName ? ` (${x.isoName})` : ''}`).join('\n')}` : ''}`, data: { allume: Boolean(http), port: http?.port, ip: serverIp(ctx), isos: l.map((i) => ({ id: i.id, nom: i.name, type: i.recipe?.kind, auto: i.recipe?.auto })), enCours: m } };
    } },
    { id: 'allumer', label: 'Allumer', what: 'Répond aux machines qui démarrent par le réseau (une machine inconnue démarre sur son disque par défaut)', words: ['allume le pxe', 'allume le démarrage réseau', 'démarre le pxe'], run: async (ctx) => {
      C = ctx; const notes = await startServers(ctx); ctx.saveSettings({ allume: true });
      const miss = LOADERS.filter((x) => x.file !== 'wimboot' && x.file !== 'ipxe-arm64.efi' && !existsSync(join(bootDir(ctx), x.file)));
      return { text: `▶ Þjálfi allumé : menu sur ${base(ctx)}/boot.ipxe · mode ${s(ctx.settings.mode) || 'proxy'}${notes.length ? `\n⚠ ${notes.join('\n⚠ ')}` : ''}${miss.length ? `\n⚠ Chargeurs manquants (${miss.map((x) => x.file).join(', ')}) : dis « prépare le pxe ».` : ''}` };
    }, undo: () => ({ action: 'eteindre', input: {}, label: 'Éteindre' }) },
    { id: 'eteindre', label: 'Éteindre', what: 'Ne répond plus aux machines qui démarrent par le réseau', quick: false, run: (ctx) => { stopServers(); ctx.saveSettings({ allume: false }); return { text: '⏹ Þjálfi éteint : les machines démarrent sur leur disque.' }; }, undo: () => ({ action: 'allumer', input: {}, label: 'Rallumer' }) },
    { id: 'preparer', label: 'Préparer (chargeurs officiels)', what: 'Télécharge iPXE et wimboot depuis leurs sites officiels, et le programme d\'installation réseau de Debian pour tes ISO Debian ; tout passe par l\'antivirus', words: ['chargeurs pxe', 'télécharge ipxe', 'prépare le pxe'], external: true, run: async (ctx) => {
      const out: string[] = [];
      for (const l of LOADERS) out.push((await fetchTo(ctx, l.url, join(bootDir(ctx), l.file))).text);
      for (const i of (await isos(ctx)).filter((x) => x.recipe?.kind === 'debian' && x.recipe.codename)) {
        const c = i.recipe!.codename!, root = `https://deb.debian.org/debian/dists/${c}/main/installer-amd64/current/images`;
        let sums = ''; try { const r = await ctx.fetch(`${root}/SHA256SUMS`, { signal: AbortSignal.timeout(30_000) }); if (r.ok) sums = await r.text(); } catch { /* hors ligne */ }
        for (const f of ['linux', 'initrd.gz']) { const sha = new RegExp(`^([0-9a-f]{64})\\s+\\./netboot/debian-installer/amd64/${f.replace('.', '\\.')}$`, 'm').exec(sums)?.[1]; out.push(sha ? `Debian ${c} · ${(await fetchTo(ctx, `${root}/netboot/debian-installer/amd64/${f}`, join(bootDir(ctx), 'debian', c, f), sha)).text}` : `Debian ${c} · ${f} : empreinte officielle introuvable, rien téléchargé`); }
      }
      return { text: `Préparation :\n${out.join('\n')}`, ok: out.some((x) => x.includes('✅')) };
    } },
    { id: 'isos', label: 'ISO', what: 'Les ISO d\'Eitri, ce que Þjálfi en fait, et combien de fois chacune a été déployée', read: true, words: ['iso déployables', 'liste des iso du déploiement'], run: async (ctx) => {
      const l = await isos(ctx), st = stats(ctx), def = s(ctx.settings.defaut) || 'local';
      return { text: l.length ? l.map((i) => `- ${i.id === def ? '★ ' : ''}${i.name} : ${i.recipe?.label ?? `illisible (${i.err})`}${i.recipe?.needs ? ` — il faut ${i.recipe.needs}` : ''} · déployée ${st[i.id]?.lances ?? 0} fois, ${st[i.id]?.finis ?? 0} réussie(s)`).join('\n') : `Aucune ISO dans ${await isoRoot(ctx)} (Eitri).`, data: l };
    } },
    { id: 'iso_par_defaut', label: 'ISO par défaut', what: 'Ce que démarre une machine qui ne choisit rien dans le menu (« disque » = son propre disque)', params: [{ key: 'iso', label: 'ISO, ou « disque »', kind: 'text', required: true }, { key: 'delai', label: 'Délai du menu (secondes)', kind: 'number', default: 10 }], words: ['iso par défaut', 'iso à déployer'], run: async (ctx, i) => {
      const d = Math.max(0, Math.min(300, Number(i.delai ?? 10)));
      if (/^(disque|local|aucune?)$/i.test(s(i.iso).trim())) { ctx.saveSettings({ defaut: 'local', delai: d }); return { text: `Par défaut : les machines démarrent sur leur propre disque (menu ${d} s).` }; }
      const x = await findIso(ctx, i.iso); ctx.saveSettings({ defaut: x.id, delai: d });
      return { text: `★ Par défaut : ${x.name} (${x.recipe?.label ?? '?'}) après ${d} s de menu. Une machine non autorisée lance l'installation normale, avec les questions : rien ne s'efface tout seul.` };
    } },
    { id: 'autoriser', label: 'Autoriser une machine', what: 'Cette machine (par son adresse MAC) démarre l\'ISO choisie ; avec « installation automatique », elle s\'installe toute seule une fois (son disque est effacé)', params: [macParam, { ...isoParam, required: false }, { key: 'nom', label: 'Nom sur le réseau (vide = pc-xxxxxx)', kind: 'text', default: '' }, { key: 'profil', label: 'Profil (compte, paquets, logiciels)', kind: 'text', default: 'standard' }, { key: 'auto', label: 'Installation automatique (efface le disque)', kind: 'boolean', default: false }],
      grave: (i) => (i.auto === true || i.auto === 'true' ? `installer automatiquement ${s(i.iso)} sur la machine ${s(i.mac)} : son disque sera EFFACÉ au prochain démarrage par le réseau` : undefined),
      words: ['autorise la machine', 'installe automatiquement', 'déploie sur la machine'], run: async (ctx, i) => {
        const mac = normMac(s(i.mac)); if (!mac) throw new Error('adresse MAC invalide (ex. 52:54:00:12:34:56)');
        const auto = i.auto === true || i.auto === 'true'; const iso = s(i.iso) ? await findIso(ctx, i.iso) : undefined;
        if (auto && !iso) throw new Error('choisis l\'ISO à installer');
        if (auto && !iso!.recipe?.auto) throw new Error(`${iso!.name} ne sait pas s'installer toute seule (${iso!.recipe?.label ?? 'ISO illisible'})`);
        if (auto && iso!.recipe?.kind === 'windows' && !(ctx.settings.partage as { unc?: string } | undefined)?.unc) throw new Error('Windows : règle d\'abord le partage réseau (« partage Windows »)');
        const p = profiles(ctx).find((x) => x.id === slug(s(i.profil) || 'standard') || x.nom.toLowerCase() === s(i.profil).toLowerCase()) ?? profiles(ctx)[0];
        const all = rules(ctx).filter((r) => r.mac !== mac); all.push({ mac, nom: s(i.nom) ? hostLabel(s(i.nom)) : undefined, iso: iso?.id, profil: p.id, auto, ajoute: ctx.now().getTime() });
        ctx.saveSettings({ machines: all });
        return { text: `${auto ? '🛠' : '✔'} ${mac}${s(i.nom) ? ` (${hostLabel(s(i.nom))})` : ''} : ${iso ? iso.name : 'menu normal'}${auto ? ` en installation automatique, profil ${p.nom}, au prochain démarrage par le réseau (une seule fois)` : ''}.` };
      }, undo: (i) => ({ action: 'retirer_machine', input: { mac: s(i.mac) }, label: 'Retirer' }) },
    { id: 'retirer_machine', label: 'Retirer une machine', what: 'Elle redevient une machine inconnue', quick: false, params: [macParam], run: (ctx, i) => { const mac = normMac(s(i.mac)); const all = rules(ctx); if (!all.some((r) => r.mac === mac)) throw new Error('machine absente de la liste'); ctx.saveSettings({ machines: all.filter((r) => r.mac !== mac) }); return { text: `${mac} retirée.` }; } },
    { id: 'reinstaller', label: 'Réinstaller', what: 'Relance l\'installation automatique d\'une machine déjà installée (son disque sera effacé)', quick: false, params: [macParam], grave: (i) => `réinstaller la machine ${s(i.mac)} : son disque sera EFFACÉ au prochain démarrage par le réseau`, run: (ctx, i) => { const mac = normMac(s(i.mac)); const all = rules(ctx), r = all.find((x) => x.mac === mac); if (!r?.auto) throw new Error('cette machine n\'a pas d\'installation automatique'); r.fait = false; ctx.saveSettings({ machines: all }); return { text: `🛠 ${mac} se réinstallera au prochain démarrage par le réseau.` }; } },
    { id: 'profil', label: 'Profil d\'installation', what: 'Compte créé, langue, clavier, fuseau, paquets Linux et logiciels Windows (Fjalar) ; le mot de passe est généré et rangé dans le coffre', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'utilisateur', label: 'Compte créé', kind: 'text', default: 'admin' }, { key: 'paquets', label: 'Paquets Linux (séparés par des virgules)', kind: 'text', default: '' }, { key: 'logiciels', label: 'Logiciels Windows de Fjalar (ex. firefox, vlc, 7zip)', kind: 'text', default: '' }, { key: 'fuseau', label: 'Fuseau', kind: 'text', default: 'Indian/Mayotte' }, { key: 'clavier', label: 'Clavier', kind: 'text', default: 'fr' }, { key: 'langue', label: 'Langue', kind: 'text', default: 'fr_FR.UTF-8' }], quick: false, run: async (ctx, i) => {
      const nom = s(i.nom).trim(); if (!nom) throw new Error('donne un nom'); const id = slug(nom), list = (ctx.settings.profils as Profile[] | undefined) ?? profiles(ctx);
      const user = s(i.utilisateur || 'admin').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'admin';
      const split = (x: unknown) => s(x).split(/[,\s]+/).map((y) => y.trim()).filter((y) => /^[\w.+-]+$/.test(y));
      const p: Profile = { id, nom, utilisateur: user, paquets: split(i.paquets), logiciels: split(i.logiciels).map((x) => x.toLowerCase()), fuseau: s(i.fuseau) || 'Indian/Mayotte', clavier: s(i.clavier) || 'fr', langue: s(i.langue) || 'fr_FR.UTF-8' };
      ctx.saveSettings({ profils: [...list.filter((x) => x.id !== id), p] }); await profilePassword(ctx, p);
      return { text: `Profil ${nom} : compte « ${user} » (mot de passe dans le coffre, Brísingamen « Déploiement · ${nom} »)${p.paquets.length ? ` · paquets : ${p.paquets.join(', ')}` : ''}${p.logiciels.length ? ` · logiciels : ${p.logiciels.join(', ')}` : ''}.` };
    } },
    { id: 'partage_windows', label: 'Partage Windows', what: 'Le partage réseau (SMB, ton NAS) où Odin dépose les fichiers d\'installation de Windows', params: [{ key: 'unc', label: 'Chemin réseau (ex. \\\\nas\\iso)', kind: 'text', required: true }, { key: 'dossier', label: 'Le même partage monté chez Odin (ex. /mnt/nas/iso)', kind: 'text', required: true }, { key: 'utilisateur', label: 'Utilisateur du partage', kind: 'text', default: '' }, { key: 'mot_de_passe', label: 'Mot de passe du partage', kind: 'password', default: '' }], quick: false, run: (ctx, i) => {
      const unc = s(i.unc).trim(); if (!/^\\\\[\w.-]+\\[^\\]+/.test(unc)) throw new Error('chemin réseau attendu : \\\\nas\\partage');
      ctx.saveSettings({ partage: { unc, local: s(i.dossier).trim(), utilisateur: s(i.utilisateur).trim() || undefined } });
      if (s(i.mot_de_passe)) saveSecrets(ctx, { ...secrets(ctx), partage: s(i.mot_de_passe) });
      return { text: `Partage Windows : ${unc} (monté chez Odin dans ${s(i.dossier)}). Dis « prépare Windows <ISO> » pour y déposer les fichiers d'installation.` };
    } },
    { id: 'preparer_windows', label: 'Préparer Windows', what: 'Copie les fichiers d\'installation d\'une ISO Windows sur le partage (une fois par version)', params: [isoParam], quick: false, run: async (ctx, i) => {
      const x = await findIso(ctx, i.iso); if (x.recipe?.kind !== 'windows') throw new Error(`${x.name} n'est pas une ISO de Windows`);
      const sh = ctx.settings.partage as { local?: string } | undefined; if (!sh?.local) throw new Error('règle d\'abord le partage Windows');
      const dest = join(sh.local, '.thjalfi', x.id), iso = await Iso.open(x.path); let n = 0, bytes = 0;
      try {
        const copy = async (dir: string) => { for (const e of await iso.list(dir)) { const p = dir === '/' ? e.name : `${dir}/${e.name}`; if (e.dir) { mkdirSync(join(dest, p), { recursive: true }); await copy(p); continue; } const { body } = await iso.stream(p); mkdirSync(join(dest, p, '..'), { recursive: true }); const { createWriteStream } = await import('node:fs'); await new Promise<void>((ok, ko) => body.pipe(createWriteStream(join(dest, p))).on('finish', ok).on('error', ko)); n++; bytes += e.size; } };
        mkdirSync(dest, { recursive: true }); await copy('/');
      } finally { await iso.close(); }
      return { text: `✅ ${x.name} : ${n} fichiers (${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} Go) déposés dans ${dest}.` };
    } },
    { id: 'mode', label: 'Mode DHCP', what: '« proxy » : ta box donne les adresses, Odin ajoute le démarrage réseau (rien à régler) ; « aucun » : tu règles toi-même ton DHCP', params: [{ key: 'mode', label: 'Mode', kind: 'select', options: ['proxy', 'odin', 'aucun'], default: 'proxy' }, { key: 'filtre', label: 'Répondre à', kind: 'select', options: ['tous', 'liste'], default: 'tous' }], quick: false, run: async (ctx, i) => {
      ctx.saveSettings({ mode: s(i.mode) || 'proxy', filtre: s(i.filtre) || 'tous' }); if (http) await startServers(ctx);
      return { text: `Mode ${s(i.mode)} · ${s(i.filtre) === 'liste' ? 'seulement les machines autorisées' : 'toutes les machines qui démarrent par le réseau'}.${s(i.mode) === 'aucun' ? `\nDans ton DHCP : option 66 = ${serverIp(ctx)}, option 67 = undionly.kpxe (BIOS) ou ipxe.efi (UEFI).` : ''}` };
    } },
    { id: 'machines', label: 'Machines', what: 'En cours de déploiement, autorisées, et déjà passées', read: true, words: ['machines en cours de déploiement', 'machines déployées'], run: (ctx) => {
      const m = Object.values(live(ctx)).sort((a, b) => b.updated - a.updated), now = ctx.now().getTime();
      return { text: m.length ? m.map((x) => `- ${STEP_ICON[x.step]} ${x.host ?? x.mac} (${x.mac}${x.ip ? `, ${x.ip}` : ''}) : ${x.step}${x.isoName ? ` · ${x.isoName}` : ''} · ${ago(now - x.updated)}`).join('\n') : 'Aucune machine n\'a encore démarré par le réseau.', data: m };
    } },
    { id: 'historique', label: 'Historique', what: 'Les machines déployées : nom pris sur le réseau, ISO, durée, résultat', read: true, words: ['historique des déploiements'], run: (ctx) => { const h = history(ctx, 50); return { text: h.length ? h.map((d) => `- ${new Date(d.at).toLocaleString('fr-FR')} · ${d.host ?? d.mac} (${d.ip ?? '?'}) · ${d.isoName} · ${d.result} en ${ago(d.ms)}`).join('\n') : 'Aucun déploiement pour l\'instant.', data: h }; } },
  ];

  return {
    id: 'thjalfi', name: 'Þjálfi', family: 'Machines',
    what: 'Le déploiement par le réseau : les ISO d\'Eitri démarrent sur n\'importe quelle machine sans clé USB, s\'installent toutes seules sur les machines que tu autorises, avec les logiciels de Fjalar ; tu suis chaque machine.',
    does: ['démarrage par le réseau (PXE) en BIOS et UEFI, sans rien régler sur la box (proxy DHCP) ou avec le DHCP d\'Odin', 'les ISO d\'Eitri lues directement (ISO 9660, Joliet, Rock Ridge, UDF) sans extraction', 'installation automatique : Ubuntu (autoinstall), Debian (preseed), Fedora / Rocky / Alma (Kickstart), Windows (unattend, partage réseau)', 'profils : compte, langue, clavier, fuseau, paquets Linux, logiciels Windows de Fjalar en silencieux', 'outils et systèmes live (Clonezilla, GParted, Arch, Alpine…) démarrés depuis le menu', 'suivi en direct : machine, ISO, étape ; historique avec le nom pris sur le réseau ; nombre de déploiements par ISO', 'sécurité : machine inconnue = son propre disque ; installation automatique seulement si tu l\'autorises, une seule fois'],
    from: ['iVentoy', 'netboot.xyz', 'FOG Project'], upstream: ['ventoy/PXE', 'netbootxyz/netboot.xyz', 'FOGProject/fogproject', 'ipxe/ipxe', 'ipxe/wimboot'],
    words: ['déploiement réseau', 'deploiement reseau', 'pxe', 'ipxe', 'iventoy', 'démarrage réseau', 'demarrage par le reseau', 'installer par le réseau', 'installation réseau', 'netboot', 'thjalfi', 'þjálfi', 'déployer une iso'],
    actions,
    async view(ctx) {
      C = ctx; const l = await isos(ctx), st = stats(ctx), def = s(ctx.settings.defaut) || 'local', now = ctx.now().getTime();
      const m = Object.values(live(ctx)), running = m.filter((x) => !FINAL.includes(x.step)).sort((a, b) => b.updated - a.updated), h = history(ctx, 100), rs = rules(ctx);
      for (const i of l) isoNames.set(i.id, i.name);
      const ready = LOADERS.filter((x) => existsSync(join(bootDir(ctx), x.file)));
      const kpis: Kpi[] = [
        { label: 'Serveur', value: http ? 'Allumé' : 'Éteint', tone: http ? 'bon' : 'neutre', hint: http ? `${serverIp(ctx)}:${http.port}` : undefined },
        { label: 'ISO démarrables', value: String(l.filter((i) => i.recipe).length), hint: `${l.filter((i) => i.recipe?.auto).length} en installation automatique` },
        { label: 'En cours', value: String(running.length), tone: running.length ? 'attention' : 'neutre' },
        { label: 'Déployées', value: String(h.filter((d) => d.result === 'fini').length), tone: 'bon' },
      ];
      const sections: Section[] = [];
      if (!http || ready.length < 2) sections.push({ kind: 'steps', title: 'Mise en route', items: [
        { title: 'Chargeurs officiels (iPXE)', detail: `${ready.length}/${LOADERS.length} prêts`, done: ready.length >= 2, action: 'preparer', button: 'Préparer' },
        { title: 'Des ISO dans Eitri', detail: `${l.length} trouvée(s)`, done: l.length > 0 },
        { title: 'Allumer Þjálfi', detail: 'une machine inconnue démarre sur son propre disque par défaut', done: Boolean(http), action: 'allumer', button: 'Allumer' },
        { title: 'Démarrer une machine par le réseau', detail: 'touche F12, F11 ou Échap au démarrage, choisis « réseau » ou « PXE »', done: m.length > 0 },
      ] });
      sections.push({ kind: 'table', title: 'En cours de déploiement', columns: ['Machine', 'Nom', 'Adresse', 'ISO', 'Étape', 'Depuis'], rows: running.map((x) => ({ cells: [x.mac, x.host ?? '—', x.ip ?? '—', x.isoName ?? '—', `${STEP_ICON[x.step]} ${x.step}${x.steps.at(-1)?.detail ? ` · ${x.steps.at(-1)!.detail}` : ''}`, ago(now - x.started)], tone: 'attention' as const })), empty: 'Aucune machine en cours.' });
      sections.push({ kind: 'cards', title: 'ISO (Eitri)', items: l.map((i) => ({ title: i.name, sub: i.recipe ? i.recipe.label : `Illisible : ${i.err}`, badge: i.id === def ? '★ par défaut' : i.recipe?.auto ? 'auto' : undefined, tone: i.recipe ? (i.recipe.auto ? 'bon' as const : 'neutre' as const) : 'mauvais' as const, meta: `Déployée ${st[i.id]?.lances ?? 0} fois · ${st[i.id]?.finis ?? 0} réussie(s)${i.recipe?.needs ? ` · il faut ${i.recipe.needs}` : ''}`, actions: i.recipe && i.id !== def ? [{ action: 'iso_par_defaut', label: 'Par défaut', input: { iso: i.id } }] : [] })), empty: 'Aucune ISO : ajoute-en dans Eitri.' });
      sections.push({ kind: 'table', title: 'Machines autorisées', columns: ['Machine', 'Nom', 'ISO', 'Profil', 'Installation auto', 'État'], rows: rs.map((r) => ({ cells: [r.mac, r.nom ?? hostOf(r.mac), l.find((i) => i.id === r.iso)?.name ?? (r.iso ?? 'menu'), profiles(ctx).find((p) => p.id === r.profil)?.nom ?? 'Standard', r.auto ? 'oui (efface le disque)' : 'non', r.auto ? (r.fait ? 'faite' : 'au prochain démarrage') : '—'], actions: [{ action: 'retirer_machine', label: 'Retirer', input: { mac: r.mac } }, ...(r.auto && r.fait ? [{ action: 'reinstaller', label: 'Réinstaller', input: { mac: r.mac } }] : [])] })), empty: 'Aucune : une machine inconnue a le menu, et démarre sur son disque si personne ne choisit.' });
      sections.push({ kind: 'table', title: 'Déjà passées', columns: ['Date', 'Nom pris sur le réseau', 'Adresse', 'Machine', 'ISO', 'Durée', 'Résultat'], rows: h.slice(0, 50).map((d) => ({ cells: [new Date(d.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }), d.host ?? '—', d.ip ?? '—', d.mac, d.isoName, ago(d.ms), d.result === 'fini' ? `✅ fini${d.logiciels?.some((x) => !x.ok) ? ' (logiciels ratés)' : ''}` : d.result === 'échec' ? '❌ échec' : '❔ sans nouvelles'], tone: d.result === 'fini' ? 'bon' as const : 'mauvais' as const })), empty: 'Aucun déploiement terminé.' });
      const counts = l.map((i) => ({ label: i.name, value: st[i.id]?.lances ?? 0 })).filter((x) => x.value > 0);
      if (counts.length) sections.push({ kind: 'bars', title: 'Déploiements par ISO', items: counts });
      const side: Section[] = [
        { kind: 'text', title: 'Comment ça marche', text: `1. La machine démarre par le réseau (F12 / F11 / Échap au démarrage).\n2. ${s(ctx.settings.mode) === 'aucun' ? 'Ton DHCP' : 'Odin'} lui donne le chargeur iPXE, puis le menu.\n3. Machine inconnue : menu, puis son propre disque après ${Number(ctx.settings.delai ?? 10)} s (sauf ISO par défaut).\n4. Machine autorisée en automatique : l'ISO s'installe toute seule (une fois), puis les logiciels, et elle prévient Odin avec son nom.` },
        { kind: 'text', title: 'Réglages DHCP', text: s(ctx.settings.mode) === 'aucun' ? `Dans ton DHCP : option 66 = ${serverIp(ctx)}, option 67 = undionly.kpxe (BIOS) ou ipxe.efi (UEFI).` : `Mode ${s(ctx.settings.mode) || 'proxy'} : rien à régler sur la box.` },
      ];
      return { subtitle: http ? `Allumé · ${serverIp(ctx)}` : 'Éteint', kpis, sections, side };
    },
    async start(ctx) { C = ctx; if (ctx.settings.allume === true) await startServers(ctx); },
    stop() { stopServers(); },
    watch: { every: 300, run(ctx) {
      // Une machine sans nouvelles depuis 3 h : on le dit (elle a peut-être démarré sur son disque, ou l'installation a calé).
      const all = live(ctx), now = ctx.now().getTime(); let changed = false;
      for (const m of Object.values(all)) if (!FINAL.includes(m.step) && now - m.updated > 3 * 3600_000) {
        const was = m.step; m.step = 'sans nouvelles'; m.steps.push({ at: now, step: 'sans nouvelles', detail: `dernière étape : ${was}` }); changed = true;
        if (['chargement', 'installation', 'logiciels'].includes(was)) { finish(ctx, m, 'sans nouvelles'); ctx.alert({ level: 'moyenne', title: `❔ ${m.host ?? m.mac} : plus de nouvelles du déploiement`, detail: `Dernière étape : ${was}${m.isoName ? ` (${m.isoName})` : ''}, il y a plus de 3 h.`, steps: ['Regarde l\'écran de la machine', 'Si elle attend une réponse, l\'installation automatique n\'a pas été lue', 'Relance-la par le réseau'], key: `thjalfi-silence-${m.mac}` }); }
      }
      if (changed) saveLive(ctx, all);
      void C;
    } },
  };
}
