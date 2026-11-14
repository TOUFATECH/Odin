// Pyramide — les disques et les partages (comme Unraid, la partie stockage) : chaque disque de la machine avec
// sa taille, son type (SSD, disque dur, USB), son remplissage et sa santé (SMART), et les dossiers partagés sur
// le réseau (Samba pour Windows / Mac, NFS pour Linux). Ajouter ou retirer un partage Samba passe par ton
// accord ; Odin n'efface et ne formate jamais un disque.
import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { choixDePoste, PARAM_POSTE, posteDe, type Poste } from '../postes.ts';
import type { Kpi, ModCtx, Module, Tone } from '../types.ts';

export interface Disque { nom: string; taille: number; modele?: string; serie?: string; ssd: boolean; transport?: string; amovible: boolean; parts: Array<{ nom: string; taille: number; fs?: string; monte?: string; etiquette?: string }> }
export interface Volume { fs: string; taille: number; utilise: number; libre: number; monte: string }
export interface Partage { nom: string; chemin: string; lecture: boolean; invites: boolean; utilisateurs?: string; type: 'samba' | 'nfs'; clients?: string }
const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));

/** « lsblk -J -b -o NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL,SERIAL,ROTA,TRAN,RM,LABEL » → les disques. Pur. */
export function lireLsblk(json: string): Disque[] {
  type B = { name: string; size: number | string; type: string; mountpoint?: string | null; mountpoints?: Array<string | null>; fstype?: string | null; model?: string | null; serial?: string | null; rota?: boolean | string; tran?: string | null; rm?: boolean | string; label?: string | null; children?: B[] };
  let o: { blockdevices?: B[] }; try { o = JSON.parse(json) as { blockdevices?: B[] }; } catch { return []; }
  const vrai = (x: unknown) => x === true || x === '1' || x === 1;
  const parts = (b: B): Disque['parts'] => (b.children ?? []).flatMap((c) => [{ nom: c.name, taille: Number(c.size) || 0, ...(c.fstype ? { fs: c.fstype } : {}), ...((c.mountpoint ?? c.mountpoints?.find(Boolean)) ? { monte: (c.mountpoint ?? c.mountpoints?.find(Boolean))! } : {}), ...(c.label ? { etiquette: c.label } : {}) }, ...parts(c)]);
  return (o.blockdevices ?? []).filter((b) => b.type === 'disk' && !/^(loop|zram|ram)/.test(b.name)).map((b) => ({ nom: b.name, taille: Number(b.size) || 0, ...(b.model ? { modele: b.model.trim() } : {}), ...(b.serial ? { serie: b.serial.trim() } : {}), ssd: !vrai(b.rota), ...(b.tran ? { transport: b.tran } : {}), amovible: vrai(b.rm) || b.tran === 'usb', parts: parts(b) }));
}
const VIRTUEL = /^(tmpfs|devtmpfs|squashfs|efivarfs|proc|sysfs|udev|none|ramfs|shm|iso9660|udf|autofs|nsfs|cgroup2?|fuse\.(snapfuse|portal|gvfsd-fuse|lxcfs))$/;
/** « df -B1 -P -T » → les volumes montés, sans les systèmes de fichiers virtuels, les images toujours pleines (snap,
 *  CD) ni les montages techniques d'un conteneur ; un même disque monté à plusieurs endroits ne compte qu'une fois. Pur. */
export function lireDf(out: string): Volume[] {
  const vus = new Map<string, Volume>();
  for (const c of out.trim().split('\n').slice(1).map((l) => l.trim().split(/\s+/))) {
    if (c.length < 7 || VIRTUEL.test(c[1])) continue;
    const monte = c.slice(6).join(' ');
    if (c[1] === 'overlay' && monte !== '/') continue;   // couches des conteneurs : seul « / » compte (Odin lui-même dans un conteneur)
    if (/^\/(etc\/(hosts|hostname|resolv\.conf)$|proc\/|sys\/|dev\/|run\/(?!media\/)|snap\/|var\/lib\/(docker|containers|kubelet)\/)/.test(monte)) continue;
    const v = { fs: c[1], taille: Number(c[2]), utilise: Number(c[3]), libre: Number(c[4]), monte };
    if (!(v.taille > 0)) continue;
    const old = vus.get(c[0]); if (!old || monte.length < old.monte.length) vus.set(c[0], v);
  }
  return [...vus.values()];
}
/** Les partages d'un smb.conf (sections autres que [global], [printers], [print$]). Pur. */
export function lireSmb(conf: string): Partage[] {
  const out: Partage[] = []; let cur: Partage | undefined;
  for (const raw of conf.split('\n')) {
    const l = raw.replace(/[;#].*$/, '').trim(); if (!l) continue;
    const sec = /^\[(.+)\]$/.exec(l); if (sec) { cur = /^(global|printers|print\$|homes)$/i.test(sec[1]) ? undefined : { nom: sec[1], chemin: '', lecture: true, invites: false, type: 'samba' }; if (cur) out.push(cur); continue; }
    const kv = /^([^=]+?)\s*=\s*(.*)$/.exec(l); if (!kv || !cur) continue;
    const k = kv[1].toLowerCase().replace(/\s+/g, ' '), v = kv[2].trim(), oui = /^(yes|true|1)$/i.test(v);
    if (k === 'path') cur.chemin = v; else if (k === 'read only') cur.lecture = oui; else if (k === 'writable' || k === 'writeable' || k === 'write ok') cur.lecture = !oui; else if (k === 'guest ok' || k === 'public') cur.invites = oui; else if (k === 'valid users') cur.utilisateurs = v;
  }
  return out.filter((p) => p.chemin);
}
/** Les partages NFS (/etc/exports). Pur. */
export function lireExports(t: string): Partage[] {
  return t.split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean).map((l) => { const [chemin, ...rest] = l.split(/\s+/); return { nom: chemin.split('/').pop() || chemin, chemin, lecture: !/\brw\b/.test(rest.join(' ')), invites: false, type: 'nfs' as const, clients: rest.join(' ') }; });
}
/** Ajoute un partage à la fin d'un smb.conf (texte d'origine gardé). Pur. */
export function ajouterSmb(conf: string, p: { nom: string; chemin: string; lecture: boolean; utilisateurs?: string }): string {
  if (!/^[\w .-]{1,40}$/.test(p.nom) || /^(global|printers|homes)$/i.test(p.nom)) throw new Error('nom de partage invalide (lettres, chiffres, espaces, - . _)');
  if (!p.chemin.startsWith('/') || /[\n\r\0]/.test(p.chemin)) throw new Error('chemin absolu attendu');
  if (p.utilisateurs && !/^[\w@ ,+-]{1,200}$/.test(p.utilisateurs)) throw new Error('utilisateurs invalides');
  if (lireSmb(conf).some((x) => x.nom.toLowerCase() === p.nom.toLowerCase())) throw new Error(`le partage « ${p.nom} » existe déjà`);
  return `${conf.replace(/\s*$/, '')}\n\n# Ajouté par Odin (Pyramide)\n[${p.nom}]\n   path = ${p.chemin}\n   read only = ${p.lecture ? 'yes' : 'no'}\n   browseable = yes\n   guest ok = no\n${p.utilisateurs ? `   valid users = ${p.utilisateurs}\n` : ''}`;
}
/** Retire un partage d'un smb.conf (sa section entière). Pur. */
export function retirerSmb(conf: string, nom: string): string {
  const out: string[] = []; let skip = false, found = false;
  for (const l of conf.split('\n')) { const sec = /^\s*\[(.+)\]\s*$/.exec(l); if (sec) { skip = sec[1].toLowerCase() === nom.toLowerCase(); if (skip) { found = true; if (out.at(-1) === '# Ajouté par Odin (Pyramide)') out.pop(); } } if (!skip) out.push(l); }
  if (!found) throw new Error(`partage « ${nom} » introuvable`);
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
export const taille = (o: number) => (o >= 1024 ** 4 ? `${(o / 1024 ** 4).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} To` : o >= 1024 ** 3 ? `${(o / 1024 ** 3).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go` : `${Math.round(o / 1024 ** 2)} Mo`);
const SMB = '/etc/samba/smb.conf';
const lire = (f: string) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };

/** L'état des disques et des partages de la machine d'Odin, ou d'un autre poste Linux ou Mac (mêmes commandes, par SSH). */
async function etat(ctx: ModCtx, qui?: unknown): Promise<{ poste: Poste; disques: Disque[]; volumes: Volume[]; partages: Partage[]; sante: Record<string, string> }> {
  const p = posteDe(ctx, qui), sys = await p.systeme();
  let disques: Disque[] = [], volumes: Volume[] = [];
  if (sys === 'linux') { const r = await p.run('lsblk', ['-J', '-b', '-o', 'NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL,SERIAL,ROTA,TRAN,RM,LABEL'], { timeoutMs: 10_000 }); if (!r.code) disques = lireLsblk(r.out); }
  const d = await p.run('df', sys === 'linux' ? ['-B1', '-P', '-T'] : ['-k', '-P'], { timeoutMs: 10_000 });
  if (!d.code) volumes = sys === 'linux' ? lireDf(d.out) : d.out.trim().split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 6 && c[0].startsWith('/dev/')).map((c) => ({ fs: '', taille: Number(c[1]) * 1024, utilise: Number(c[2]) * 1024, libre: Number(c[3]) * 1024, monte: c.slice(5).join(' ') }));
  const sante: Record<string, string> = {};
  if (await p.has('smartctl')) for (const x of disques.filter((y) => !y.amovible)) { const r = await p.run('smartctl', ['-H', `/dev/${x.nom}`], { sudo: true, timeoutMs: 15_000 }); const m = /(PASSED|FAILED|OK)\b/.exec(r.out); if (m) sante[x.nom] = m[1] === 'FAILED' ? 'en panne' : 'bonne'; }
  return { poste: p, disques, volumes, partages: [...lireSmb(await p.lire(SMB)), ...lireExports(await p.lire('/etc/exports'))], sante };
}
export const fensalir: Module = {
  id: 'fensalir', name: 'Pyramide', family: 'Machines',
  what: 'Les disques et les partages (comme Unraid) : chaque disque avec sa taille, son type, son remplissage et sa santé, et les dossiers partagés sur le réseau (Samba, NFS), avec ajout ou retrait d\'un partage sur ton accord.',
  does: ['tous les disques : taille, SSD ou disque dur, USB, modèle, numéro de série, partitions et systèmes de fichiers', 'remplissage de chaque volume monté, alerte au-delà de 90 %', 'santé SMART de chaque disque (smartctl)', 'les partages Samba (Windows, Mac) et NFS (Linux) de la machine', 'ajouter ou retirer un partage Samba, avec ton accord (la configuration est vérifiée avant)', 'jamais de formatage ni d\'effacement de disque'],
  from: ['Unraid', 'OpenMediaVault', 'TrueNAS'], upstream: ['openmediavault/openmediavault', 'truenas/middleware'],
  words: ['disques durs', 'mes disques', 'état des disques', 'santé des disques', 'partages réseau', 'partage réseau', 'partage samba', 'samba', 'nfs', 'stockage', 'pyramide', 'fensalir', 'unraid', 'openmediavault', 'truenas'],
  actions: [
    { id: 'disques', label: 'Disques', what: 'Les disques, leurs partitions et leur santé (de cette machine, ou d\'un autre poste Linux ou Mac)', read: true, external: true, params: [PARAM_POSTE], words: ['mes disques', 'état des disques', 'santé des disques'], run: async (ctx, i) => {
      const e = await etat(ctx, i.poste), ou = e.poste.local ? '' : `Sur ${e.poste.nom} :\n`;
      return { text: ou + (e.disques.length ? e.disques.map((x) => `- ${x.nom} · ${taille(x.taille)} · ${x.ssd ? 'SSD' : 'disque dur'}${x.amovible ? ' (amovible)' : ''}${x.modele ? ` · ${x.modele}` : ''}${e.sante[x.nom] ? ` · santé ${e.sante[x.nom]}` : ''}\n${x.parts.map((p) => `    ${p.nom} ${taille(p.taille)} ${p.fs ?? ''} ${p.monte ?? ''}`).join('\n')}`).join('\n') : e.volumes.map((v) => `- ${v.monte} : ${taille(v.utilise)} / ${taille(v.taille)}`).join('\n') || 'Aucun disque lu.'), data: { poste: e.poste.nom, disques: e.disques, volumes: e.volumes, sante: e.sante } };
    } },
    { id: 'partages', label: 'Partages', what: 'Les dossiers partagés sur le réseau (par cette machine, ou par un autre poste Linux ou Mac)', words: ['partages réseau', 'dossiers partagés sur le réseau'], read: true, params: [PARAM_POSTE], run: async (ctx, i) => { const e = await etat(ctx, i.poste), p = e.partages; return { text: (e.poste.local ? '' : `Sur ${e.poste.nom} :\n`) + (p.length ? p.map((x) => `- ${x.nom} (${x.type}) : ${x.chemin}${x.lecture ? ' · lecture seule' : ' · lecture et écriture'}${x.utilisateurs ? ` · pour ${x.utilisateurs}` : ''}`).join('\n') : 'Aucun partage.'), data: p }; } },
    { id: 'ajouter_partage', label: 'Partager un dossier', what: 'Ajoute un partage Samba (Windows, Mac, téléphones)', words: ['partage le dossier sur le réseau', 'ajoute un partage samba'], params: [{ key: 'nom', label: 'Nom du partage', kind: 'text', required: true }, { key: 'chemin', label: 'Dossier', kind: 'text', required: true }, { key: 'ecriture', label: 'Autoriser l\'écriture', kind: 'boolean', default: false }, { key: 'utilisateurs', label: 'Seulement pour (comptes Samba, vide : tous les comptes)', kind: 'text', default: '' }],
      grave: (i) => `partager le dossier ${s(i.chemin)} sur le réseau sous le nom « ${s(i.nom)} »${i.ecriture === true ? ' en écriture' : ''}`, run: async (ctx, i) => {
        const chemin = s(i.chemin).trim(); if (!existsSync(chemin)) throw new Error('dossier introuvable');
        const conf = ajouterSmb(lire(SMB), { nom: s(i.nom).trim(), chemin, lecture: i.ecriture !== true, utilisateurs: s(i.utilisateurs).trim() || undefined });
        await ecrireSmb(ctx, conf); return { text: `📂 « ${s(i.nom).trim()} » partagé (${i.ecriture === true ? 'lecture et écriture' : 'lecture seule'}). Sur Windows : \\\\${hostname()}\\${s(i.nom).trim()}` };
      } },
    { id: 'retirer_partage', label: 'Retirer un partage', what: 'Le dossier n\'est plus partagé (rien n\'est effacé)', words: ['retire le partage réseau', 'retire le partage samba'], params: [{ key: 'nom', label: 'Nom du partage', kind: 'text', required: true }],
      grave: (i) => `retirer le partage « ${s(i.nom)} » (le dossier et son contenu restent)`, run: async (ctx, i) => { await ecrireSmb(ctx, retirerSmb(lire(SMB), s(i.nom).trim())); return { text: `Partage « ${s(i.nom).trim()} » retiré ; le dossier n'est pas touché.` }; } },
  ],
  async view(ctx, q) {
    const P = choixDePoste(ctx, q), e = await etat(ctx, P.actuel), plein = e.volumes.filter((v) => v.utilise / v.taille > 0.9), tot = e.disques.reduce((a, d) => a + d.taille, 0);
    const kpis: Kpi[] = [{ label: 'Disques', value: String(e.disques.length || e.volumes.length) }, ...(tot ? [{ label: 'Capacité', value: taille(tot) }] : []), { label: 'Presque pleins', value: String(plein.length), tone: plein.length ? 'mauvais' : 'bon' }, { label: 'Partages', value: String(e.partages.length) }];
    const tone = (v: Volume): Tone => (v.utilise / v.taille > 0.9 ? 'mauvais' : v.utilise / v.taille > 0.75 ? 'attention' : 'bon');
    return {
      postes: P,
      subtitle: `${e.poste.local ? '' : `${e.poste.nom} · `}${e.disques.length} disque(s) · ${e.partages.length} partage(s)`, kpis,
      sections: [
        { kind: 'cards', title: 'Volumes', items: e.volumes.map((v) => ({ title: v.monte, sub: `${taille(v.utilise)} sur ${taille(v.taille)} · ${taille(v.libre)} libres${v.fs ? ` · ${v.fs}` : ''}`, progress: Math.round((v.utilise / v.taille) * 100), tone: tone(v) })) },
        { kind: 'table', title: 'Disques', columns: ['Disque', 'Taille', 'Type', 'Modèle', 'Santé', 'Partitions'], empty: 'Disques non lus (lsblk absent).', rows: e.disques.map((d) => ({ cells: [d.nom, taille(d.taille), `${d.ssd ? 'SSD' : 'disque dur'}${d.transport ? ` · ${d.transport}` : ''}${d.amovible ? ' · amovible' : ''}`, d.modele ?? '', e.sante[d.nom] ?? '—', d.parts.map((p) => `${p.nom}${p.fs ? ` ${p.fs}` : ''}${p.monte ? ` → ${p.monte}` : ''}`).join(' · ')], tone: e.sante[d.nom] === 'en panne' ? 'mauvais' as const : undefined })) },
        { kind: 'table', title: 'Partages sur le réseau', columns: ['Nom', 'Type', 'Dossier', 'Accès', 'Pour'], empty: 'Aucun partage. « Partager un dossier » en ajoute un.', rows: e.partages.map((p) => ({ cells: [p.nom, p.type === 'samba' ? 'Samba (Windows, Mac)' : 'NFS (Linux)', p.chemin, p.lecture ? 'lecture seule' : 'lecture et écriture', p.utilisateurs ?? p.clients ?? 'tous les comptes'], actions: p.type === 'samba' ? [{ action: 'retirer_partage', label: 'Retirer', input: { nom: p.nom } }] : [] })) },
      ],
      // Partager un dossier, monter un disque… : ces formulaires agissent sur la machine d'Odin, ils ne se montrent que pour elle.
      side: e.poste.local ? [{ kind: 'form', title: 'Partager un dossier', action: 'ajouter_partage', submit: 'Partager', params: [{ key: 'nom', label: 'Nom du partage', kind: 'text', required: true }, { key: 'chemin', label: 'Dossier', kind: 'text', required: true }, { key: 'ecriture', label: 'Autoriser l\'écriture', kind: 'boolean', default: false }] }] : [],
    };
  },
  watch: { every: 1800, async run(ctx) {
    const e = await etat(ctx);
    for (const v of e.volumes) if (v.utilise / v.taille > 0.9) ctx.alert({ level: v.utilise / v.taille > 0.97 ? 'haute' : 'moyenne', title: `Pyramide : ${v.monte} plein à ${Math.round((v.utilise / v.taille) * 100)} %`, detail: `${taille(v.libre)} libres. Héraclès peut libérer de la place.`, key: `pyramide:plein:${v.monte}` });
    for (const [d, h] of Object.entries(e.sante)) if (h === 'en panne') ctx.alert({ level: 'critique', title: `Pyramide : le disque ${d} annonce une panne (SMART)`, detail: 'Sauvegarde ce qu\'il contient tout de suite (Phénix) et prévois de le remplacer.', key: `pyramide:smart:${d}` });
  } },
};
/** Écrit smb.conf (copie de sécurité d'abord), vérifie avec testparm, recharge Samba ; remet l'ancien si la vérification échoue. */
async function ecrireSmb(ctx: ModCtx, conf: string): Promise<void> {
  if (process.platform !== 'linux' || !existsSync(SMB)) throw new Error('Samba n\'est pas installé sur cette machine (paquet « samba »)');
  const cp = await ctx.run('cp', ['-p', SMB, `${SMB}.odin-avant`], { sudo: true }); if (cp.code) throw new Error(cp.err.trim() || 'copie de sécurité impossible');
  const w = await ctx.run('tee', [SMB], { sudo: true, input: conf }); if (w.code) throw new Error(w.err.trim() || 'écriture refusée');
  const t = await ctx.run('testparm', ['-s', SMB], { timeoutMs: 15_000 });
  if (t.code) { await ctx.run('cp', ['-p', `${SMB}.odin-avant`, SMB], { sudo: true }); throw new Error(`configuration refusée par Samba, l'ancienne est remise : ${t.err.trim().split('\n').at(-1) ?? ''}`); }
  await ctx.run('smbcontrol', ['all', 'reload-config'], { sudo: true });
}
