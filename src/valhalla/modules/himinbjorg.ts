// Cyclope — les caméras : flux RTSP/HTTP lus avec ffmpeg, photo à la demande, détection de
// mouvement maison (comparaison d'images réduites), enregistrement de clips, rétention, zones de nuit
// (alerte seulement aux heures choisies). Chaque mouvement est un événement (Midgard, Talos).

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ModCtx, Module } from '../types.ts';

export interface Cam { name: string; url: string; motion: boolean; record: boolean; hours?: string; sensitivity: number }
const s = (v: unknown) => String(v ?? '');
const cams = (ctx: ModCtx): Cam[] => (ctx.settings.cams as Cam[] | undefined) ?? [];
/** Adresse sans identifiants (pour l'affichage). */
export const masked = (u: string) => u.replace(/\/\/[^@/]+@/, '//•••@');
/** Identifiants rangés dans le coffre : CAMERA_<NOM>=utilisateur:motdepasse. */
function withCreds(c: Cam): string {
  const k = `CAMERA_${c.name.toUpperCase().normalize('NFD').replace(/[^A-Z0-9]/g, '_')}`, cred = process.env[k];
  return cred && !/\/\/[^/]*@/.test(c.url) ? c.url.replace('//', `//${cred.split(':').map(encodeURIComponent).join(':')}@`) : c.url;
}
const slug = (n: string) => n.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'camera';
/** Raison lisible d'un échec de ffmpeg, sans jamais laisser passer l'adresse avec ses identifiants. */
export function why(err: string): string {
  const l = err.split('\n').map((x) => x.trim()).filter(Boolean).pop() ?? '';
  const m = /401|Unauthorized/i.test(err) ? 'identifiants refusés par la caméra' : /Connection refused|No route to host|timed out|Network is unreachable/i.test(err) ? 'caméra injoignable' : /404|Not Found/i.test(err) ? 'flux introuvable à cette adresse' : l.replace(/\b\w+:\/\/\S+/g, '(adresse)').slice(0, 120);
  return m ? ` (${m})` : '';
}
const input = (u: string) => (u.startsWith('rtsp') ? ['-rtsp_transport', 'tcp', '-i', u] : ['-i', u]);

/** Différence moyenne entre deux images en niveaux de gris (0 à 255). */
export function diff(a: Buffer, b: Buffer): number { const n = Math.min(a.length, b.length); if (!n) return 0; let t = 0; for (let i = 0; i < n; i++) t += Math.abs(a[i] - b[i]); return t / n; }
/** Part des pixels qui ont changé de plus de `px` (0 à 1) : plus robuste au bruit qu'une moyenne. */
export function changed(a: Buffer, b: Buffer, px = 25): number { const n = Math.min(a.length, b.length); if (!n) return 0; let c = 0; for (let i = 0; i < n; i++) if (Math.abs(a[i] - b[i]) > px) c++; return c / n; }
/** « 22-6 » → vrai entre 22 h et 6 h. Vide → toujours. */
export function inHours(spec: string | undefined, d: Date): boolean {
  const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(spec ?? ''); if (!m) return true;
  const a = Number(m[1]), b = Number(m[2]), h = d.getHours();
  return a <= b ? h >= a && h < b : h >= a || h < b;
}

/** Lecture rapide : sans ces réglages, ffmpeg analyse le flux 5 secondes avant de rendre la première image. */
const FAST = ['-analyzeduration', '500000', '-probesize', '100000'];
async function frame(ctx: ModCtx, c: Cam): Promise<Buffer> {
  const grab = (fast: boolean) => ctx.run('sh', ['-c', 'ffmpeg -nostdin -loglevel error "$@" -frames:v 1 -vf scale=64:36,format=gray -f rawvideo - | base64 -w0', 'ffmpeg', ...(fast ? FAST : []), ...input(withCreds(c))], { timeoutMs: 15_000 });
  let r = await grab(true);
  // Certaines caméras ne donnent pas assez d'informations en lecture rapide : on réessaie normalement.
  if (r.code !== 0 || r.out.trim().length < 100) r = await grab(false);
  if (r.code !== 0 || !r.out.trim()) throw new Error(`${c.name} : flux illisible${why(r.err)}`);
  return Buffer.from(r.out.trim(), 'base64');
}
async function snapshot(ctx: ModCtx, c: Cam, file?: string): Promise<string> {
  const dir = join(ctx.dir, 'photos'); mkdirSync(dir, { recursive: true });
  const f = file ?? join(dir, `${slug(c.name)}-${ctx.now().toISOString().replace(/[:.]/g, '-')}.jpg`);
  const shot = (fast: boolean) => ctx.run('ffmpeg', ['-nostdin', '-loglevel', 'error', ...(fast ? FAST : []), ...input(withCreds(c)), '-frames:v', '1', '-q:v', '3', '-y', f], { timeoutMs: 20_000 });
  let r = await shot(true);
  if (r.code !== 0 || !existsSync(f)) r = await shot(false);
  if (r.code !== 0) throw new Error(`${c.name} : photo impossible${why(r.err)}`);
  return f;
}
async function clip(ctx: ModCtx, c: Cam, sec: number): Promise<string> {
  const dir = join(ctx.dir, 'clips', slug(c.name)); mkdirSync(dir, { recursive: true });
  const f = join(dir, `${ctx.now().toISOString().replace(/[:.]/g, '-')}.mp4`);
  const r = await ctx.run('ffmpeg', ['-nostdin', '-loglevel', 'error', ...input(withCreds(c)), '-t', String(Math.min(Math.max(sec, 5), 300)), '-c', 'copy', '-movflags', '+faststart', '-y', f], { timeoutMs: (sec + 30) * 1000 });
  if (r.code !== 0) throw new Error(`${c.name} : enregistrement impossible${why(r.err)}`);
  return f;
}
function clips(ctx: ModCtx): Array<{ cam: string; file: string; at: string; size: number }> {
  const root = join(ctx.dir, 'clips'); if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((cam) => readdirSync(join(root, cam)).map((f) => { const st = statSync(join(root, cam, f)); return { cam, file: join(root, cam, f), at: st.mtime.toISOString(), size: st.size }; })).sort((a, b) => b.at.localeCompare(a.at));
}
const last = new Map<string, Buffer>();
const busy = new Set<string>();

export const himinbjorg: Module = {
  id: 'himinbjorg', name: 'Cyclope', family: 'Maison',
  what: 'Tes caméras : voir, photographier, détecter les mouvements et enregistrer.',
  does: ['toutes les caméras réseau (RTSP, HTTP) au même endroit', 'photo à la demande', 'détection de mouvement maison, avec sensibilité et heures de surveillance', 'enregistrement d\'un clip à chaque mouvement, gardé N jours', 'alerte avec photo sur ta messagerie ; chaque mouvement peut lancer une scène Midgard ou une automatisation'],
  from: ['Frigate', 'go2rtc', 'Shinobi', 'motionEye', 'ZoneMinder', 'Viseron'], upstream: ['blakeblackshear/frigate', 'AlexxIT/go2rtc'],
  modes: ['Vigie · mouvements', 'Archives · clips'],
  words: ['camera', 'caméra', 'cameras', 'caméras', 'video surveillance', 'vidéosurveillance', 'mouvement', 'rtsp', 'enregistrement', 'clip', 'photo de la camera'],
  actions: [
    { id: 'cameras', label: 'Caméras', what: 'Liste des caméras', read: true, words: ['liste'], run: (ctx) => ({ text: cams(ctx).map((c) => `- ${c.name} · ${masked(c.url)} · mouvement ${c.motion ? 'oui' : 'non'}${c.hours ? ` (${c.hours} h)` : ''}`).join('\n') || 'Aucune caméra.' }) },
    { id: 'ajouter', undo: (i) => ({ action: 'retirer', input: { camera: i.nom }, label: 'caméra retirée' }), label: 'Ajouter une caméra', what: 'Adresse du flux (identifiants dans le coffre : CAMERA_<NOM>=utilisateur:motdepasse)', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'adresse', label: 'Flux (rtsp://… ou http://…)', kind: 'text', required: true }, { key: 'mouvement', label: 'Détecter les mouvements', kind: 'boolean', default: true }, { key: 'heures', label: 'Heures de surveillance (ex. 22-6, vide = toujours)', kind: 'text', default: '' }], run: (ctx, i) => {
      const url = s(i.adresse).trim(); if (!/^(rtsp|rtsps|http|https):\/\//.test(url)) throw new Error('adresse rtsp:// ou http:// attendue');
      if (/\/\/[^/]*:[^/]*@/.test(url)) throw new Error('ne mets pas le mot de passe dans l\'adresse : range-le dans le coffre (CAMERA_<NOM>)');
      const c: Cam = { name: s(i.nom).trim(), url, motion: i.mouvement !== false, record: true, hours: s(i.heures).trim() || undefined, sensitivity: 2 };
      ctx.saveSettings({ cams: [...cams(ctx).filter((x) => x.name !== c.name), c] }); return { text: `📷 ${c.name} ajoutée.` };
    } },
    { id: 'photo', label: 'Photo', what: 'Prend une photo maintenant', read: true, params: [{ key: 'camera', label: 'Caméra', kind: 'text', required: true }], words: ['photo', 'montre'], run: async (ctx, i) => { const c = cams(ctx).find((x) => x.name.toLowerCase() === s(i.camera).toLowerCase()); if (!c) throw new Error('caméra inconnue'); const f = await snapshot(ctx, c); return { text: `📸 ${c.name}`, data: { file: f } }; } },
    { id: 'enregistrer', label: 'Enregistrer', what: 'Clip de N secondes', params: [{ key: 'camera', label: 'Caméra', kind: 'text', required: true }, { key: 'secondes', label: 'Secondes', kind: 'number', default: 30 }], run: async (ctx, i) => { const c = cams(ctx).find((x) => x.name.toLowerCase() === s(i.camera).toLowerCase()); if (!c) throw new Error('caméra inconnue'); return { text: `🎞 Clip enregistré.`, data: { file: await clip(ctx, c, Number(i.secondes) || 30) } }; } },
    { id: 'retirer', label: 'Retirer une caméra', what: 'La caméra est oubliée (les clips restent)', params: [{ key: 'camera', label: 'Caméra', kind: 'text', required: true }], run: (ctx, i) => { ctx.saveSettings({ cams: cams(ctx).filter((x) => x.name !== s(i.camera)) }); return { text: 'Caméra retirée.' }; } },
    { id: 'reglages', label: 'Réglages', what: 'Sensibilité et rétention', params: [{ key: 'camera', label: 'Caméra', kind: 'text', required: true }, { key: 'sensibilite', label: 'Sensibilité (1 forte à 5 faible)', kind: 'number', default: 2 }, { key: 'jours', label: 'Garder les clips (jours, toutes caméras)', kind: 'number', default: 7 }, { key: 'secondes', label: 'Durée d\'un clip de mouvement (secondes)', kind: 'number', default: 20 }], run: (ctx, i) => { ctx.saveSettings({ cams: cams(ctx).map((x) => (x.name === s(i.camera) ? { ...x, sensitivity: Math.min(5, Math.max(1, Number(i.sensibilite) || 2)) } : x)), keepDays: Number(i.jours) || 7, clipSeconds: Math.min(300, Math.max(5, Number(i.secondes) || 20)) }); return { text: 'Réglages enregistrés.' }; } },
  ],
  view(ctx) {
    const c = cams(ctx), cl = clips(ctx), day = cl.filter((x) => Date.parse(x.at) > ctx.now().getTime() - 86_400_000);
    return {
      subtitle: `${c.length} caméra(s) · ${day.length} clip(s) en 24 h`,
      tabs: ['Vigie · mouvements', 'Archives · clips'],
      kpis: [{ label: 'Caméras', value: String(c.length) }, { label: 'Mouvements 24 h', value: String(day.length), tone: day.length ? 'attention' : 'bon' }, { label: 'Clips gardés', value: String(cl.length) }],
      sections: [
        { kind: 'table', title: 'Caméras', columns: ['Caméra', 'Flux', 'Mouvement', 'Heures', 'Sensibilité'], empty: 'Ajoute une caméra à droite.', rows: c.map((x) => ({ cells: [x.name, masked(x.url), x.motion ? 'oui' : 'non', x.hours ?? 'toujours', String(x.sensitivity)], actions: [{ action: 'photo', label: 'Photo', input: { camera: x.name } }, { action: 'enregistrer', label: 'Clip 30 s', input: { camera: x.name, secondes: 30 } }] })) },
        { kind: 'table', title: 'Derniers clips', columns: ['Quand', 'Caméra', 'Taille'], empty: 'Aucun clip.', rows: cl.slice(0, 30).map((x) => ({ cells: [x.at.slice(0, 16).replace('T', ' '), x.cam, `${(x.size / 1048576).toFixed(1).replace('.', ',')} Mo`] })) },
      ],
      side: [{ kind: 'form', title: 'Ajouter une caméra', action: 'ajouter', submit: 'Ajouter', params: himinbjorg.actions.find((a) => a.id === 'ajouter')?.params ?? [] }],
    };
  },
  watch: { every: 10, async run(ctx) {
    if (!cams(ctx).some((c) => c.motion) || !(await ctx.has('ffmpeg'))) return;
    for (const c of cams(ctx).filter((x) => x.motion && !busy.has(x.name))) {
      busy.add(c.name);
      try {
        const f = await frame(ctx, c), prev = last.get(c.name); last.set(c.name, f);
        if (!prev) continue;
        const part = changed(prev, f), seuil = [0, 0.02, 0.04, 0.07, 0.11, 0.16][c.sensitivity] ?? 0.04;
        if (part < seuil) continue;
        const watched = inHours(c.hours, ctx.now());
        // Aux heures surveillées : une photo part avec l'alerte, puis un clip est gardé.
        const photo = watched ? await snapshot(ctx, c).catch(() => undefined) : undefined;
        ctx.emit('mouvement', { caméra: c.name, part: Math.round(part * 100), surveillé: watched, ...(photo ? { photo } : {}) });
        if (!watched) continue;
        ctx.alert({ level: 'haute', title: `Mouvement : ${c.name}`, detail: `${Math.round(part * 100)} % de l'image a changé`, key: `mvt:${c.name}`, ...(photo ? { photo, data: { photo } } : {}) });
        if (c.record) void clip(ctx, c, Number(ctx.settings.clipSeconds ?? 20)).then((file) => ctx.emit('clip', { caméra: c.name, fichier: file })).catch(() => undefined);
      } catch (e) { ctx.alert({ level: 'moyenne', title: `Caméra ${c.name} injoignable`, detail: (e as Error).message, key: `cam:${c.name}` }); }
      finally { busy.delete(c.name); }
    }
    // Rétention des clips
    const keep = Number(ctx.settings.keepDays ?? 7) * 86_400_000;
    for (const x of clips(ctx)) if (ctx.now().getTime() - Date.parse(x.at) > keep) rmSync(x.file, { force: true });
    const shots = join(ctx.dir, 'photos');
    if (existsSync(shots)) for (const f of readdirSync(shots)) { const p = join(shots, f); if (ctx.now().getTime() - statSync(p).mtimeMs > keep) rmSync(p, { force: true }); }
  } },
};

/** Les caméras (noms seulement, jamais leurs adresses) pour l'écran de la maison. */
export const cameraNames = (ctx: ModCtx) => cams(ctx).map((c) => c.name);
/** Un aperçu d'une caméra (toujours le même fichier, remplacé : rien ne s'accumule), au plus une fois toutes les 4 s. */
const previews = new Map<string, { at: number; p: Promise<string> }>();
export function preview(ctx: ModCtx, name: string): Promise<string> {
  const c = cams(ctx).find((x) => x.name.toLowerCase() === name.toLowerCase()); if (!c) return Promise.reject(new Error('caméra inconnue'));
  const k = slug(c.name), old = previews.get(k); if (old && Date.now() - old.at < 4000) return old.p;
  const dir = join(ctx.dir, 'apercus'); mkdirSync(dir, { recursive: true });
  const p = snapshot(ctx, c, join(dir, `${k}.jpg`)); previews.set(k, { at: Date.now(), p }); p.catch(() => previews.delete(k));
  return p;
}
