// Skíðblaðnir — tes fichiers chez toi : espaces partagés par groupe (avec Vár), espace perso de chacun,
// interface web (ordinateur et téléphone) derrière le proxy, liens de partage (expiration, mot de passe,
// nombre de téléchargements), dépôts (on t'envoie des fichiers), envoi de gros fichiers, notes secrètes
// chiffrées qui s'effacent après lecture, versions et corbeille, WebDAV (lecteur réseau), synchronisation
// de dossiers, antivirus sur chaque fichier reçu. Reprend Sync-in, Erugo, Syncthing et PrivateBin.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { GraphDetail, GraphEdge, GraphNode, ModCtx, Module } from '../types.ts';
import { FilesServer, human, type Hub, type Link, type SpaceView, type Who } from '../skidbladnir/server.ts';
import * as S from '../skidbladnir/store.ts';
import { syncPair, type Way } from '../skidbladnir/sync.ts';
import { mascotSvg } from './var.ts';

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
export interface Space { id: string; name: string; path?: string; read: string[]; write: string[]; quotaGb: number; versions: number }
interface AppPw { id: string; login: string; label: string; hash: string; created: number; last?: number }
interface SyncJob { id: string; space: string; sub: string; dir: string; way: Way; every: number; last?: number; result?: string }
interface Held { id: string; space: string; rel: string; file: string; why: string; by: string; at: number }
type Person = { login: string; name: string; groups: string[]; active: boolean };

const spacesOf = (ctx: ModCtx): Space[] => (ctx.settings.spaces as Space[] | undefined) ?? [];
const linksOf = (ctx: ModCtx): Link[] => (ctx.settings.links as Link[] | undefined) ?? [];
const appPws = (ctx: ModCtx): AppPw[] => (ctx.settings.appPw as AppPw[] | undefined) ?? [];
const syncs = (ctx: ModCtx): SyncJob[] => (ctx.settings.syncs as SyncJob[] | undefined) ?? [];
const held = (ctx: ModCtx): Held[] => (ctx.settings.held as Held[] | undefined) ?? [];
const base = (ctx: ModCtx) => s(ctx.settings.base) || join(ctx.home, 'fichiers');
const rootOf = (ctx: ModCtx, sp: Space) => sp.path || join(base(ctx), 'espaces', sp.id);
const persoRoot = (ctx: ModCtx, login: string) => join(base(ctx), 'personnes', login);
const groupsOf = (v: unknown) => [...new Set(s(v).toLowerCase().split(/[\s,;]+/).filter(Boolean))].map((g) => { if (!/^[\w-]{1,30}$/.test(g) && g !== '*') throw new Error(`groupe invalide : ${g}`); return g; });
export const slug = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'espace';
const sha = (x: string) => createHash('sha256').update(x).digest('hex');
const hashPass = (p: string) => { const salt = randomBytes(16); return `s$${salt.toString('hex')}$${scryptSync(p, salt, 32).toString('hex')}`; };
const passOk = (stored: string, p: string) => { const [, salt, h] = stored.split('$'); if (!salt || !h) return false; const x = scryptSync(p, Buffer.from(salt, 'hex'), 32); return timingSafeEqual(x, Buffer.from(h, 'hex')); };

/** Droits d'une personne sur un espace. Pur. Le groupe « admins » voit tout. */
export function rights(sp: Pick<Space, 'read' | 'write'>, groups: string[]): { read: boolean; write: boolean } {
  const has = (l: string[]) => l.includes('*') || l.some((g) => groups.includes(g)) || groups.includes('admins');
  const write = has(sp.write); return { read: write || has(sp.read), write };
}

let srv: FilesServer | undefined, appCtx: ModCtx | undefined, people: Person[] = [];
const usedCache = new Map<string, { at: number; n: number }>();
const tries = new Map<string, number[]>();
export const filesServer = () => srv;

function journal(ctx: ModCtx, e: Record<string, unknown>): void { try { mkdirSync(ctx.dir, { recursive: true }); appendFileSync(join(ctx.dir, 'journal.jsonl'), `${JSON.stringify({ at: Date.now(), ...e })}\n`); } catch { /* disque plein */ } }
function readJournal(ctx: ModCtx, n = 60): Array<Record<string, unknown> & { at: number }> { try { return readFileSync(join(ctx.dir, 'journal.jsonl'), 'utf8').trim().split('\n').slice(-n).map((l) => JSON.parse(l)).reverse(); } catch { return []; } }
async function refreshPeople(ctx: ModCtx): Promise<void> { try { const r = await ctx.call('var', 'personnes', {}, 'connaître les groupes'); people = ((r.data as { people?: Person[] } | undefined)?.people) ?? people; } catch { /* Vár absent */ } }

function view(ctx: ModCtx, sp: Space, groups: string[]): SpaceView | undefined {
  const r = rights(sp, groups); if (!r.read) return undefined;
  return { id: sp.id, name: sp.name, root: rootOf(ctx, sp), write: r.write, quota: sp.quotaGb * 1024 ** 3, versions: sp.versions };
}
function persoView(ctx: ModCtx, login: string): SpaceView { const root = persoRoot(ctx, login); mkdirSync(root, { recursive: true }); return { id: `perso-${login}`, name: 'Mes fichiers', root, write: true, quota: Number(ctx.settings.persoQuotaGb ?? 50) * 1024 ** 3, versions: 10, perso: true }; }

function hub(ctx: ModCtx): Hub {
  return {
    conf: () => ({ privateHost: s(ctx.settings.privateHost), publicHost: s(ctx.settings.publicHost), maxUpload: Number(ctx.settings.maxUploadGb ?? 20) * 1024 ** 3 }),
    spaces: (w: Who) => [persoView(ctx, w.login), ...spacesOf(ctx).map((sp) => view(ctx, sp, w.groups)).filter((x): x is SpaceView => Boolean(x))],
    space: (w: Who, id: string) => (id === `perso-${w.login}` ? persoView(ctx, w.login) : (() => { const sp = spacesOf(ctx).find((x) => x.id === id); return sp ? view(ctx, sp, w.groups) : undefined; })()),
    spaceById: (id: string) => { const m = /^perso-([a-z0-9._-]+)$/.exec(id); if (m) return persoView(ctx, m[1]); const sp = spacesOf(ctx).find((x) => x.id === id); return sp ? { id: sp.id, name: sp.name, root: rootOf(ctx, sp), write: true, quota: sp.quotaGb * 1024 ** 3, versions: sp.versions } : undefined; },
    used: (sp: SpaceView) => { const c = usedCache.get(sp.root); if (c && Date.now() - c.at < 3_000) return c.n; const n = S.usage(sp.root); usedCache.set(sp.root, { at: Date.now(), n }); return n; },
    links: () => linksOf(ctx), saveLinks: (l: Link[]) => ctx.saveSettings({ links: l.slice(-2000) }),
    newLink: (w: Who, x) => {
      const token = randomBytes(24).toString('base64url'), { password, ...rest } = x;
      const link: Link = { ...rest, id: randomBytes(5).toString('hex'), hash: sha(token), by: w.login, created: Date.now(), downloads: 0, ...(password ? { pass: hashPass(password) } : {}) };
      ctx.saveSettings({ links: [...linksOf(ctx), link].slice(-2000) });
      return { link, token };
    },
    passOk: (l: Link, p: string) => Boolean(l.pass) && passOk(l.pass!, p),
    putNote: (ct: string, iv: string, hours: number, by: string) => { const id = randomBytes(12).toString('base64url'), d = join(ctx.dir, 'notes'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, `${id}.json`), JSON.stringify({ ct, iv, exp: Date.now() + hours * 3600_000, by }), { mode: 0o600 }); journal(ctx, { what: 'note secrète créée', who: by }); return id; },
    hasNote: (id: string) => /^[\w-]{8,40}$/.test(id) && existsSync(join(ctx.dir, 'notes', `${id}.json`)),
    takeNote: (id: string) => {
      if (!/^[\w-]{8,40}$/.test(id)) return undefined;
      const f = join(ctx.dir, 'notes', `${id}.json`); if (!existsSync(f)) return undefined;
      // Effacée AVANT d'être rendue : une seule lecture possible, même si deux demandes arrivent ensemble.
      const t = `${f}.lue-${randomBytes(4).toString('hex')}`; try { renameSync(f, t); } catch { return undefined; }
      const x = JSON.parse(readFileSync(t, 'utf8')) as { ct: string; iv: string; exp: number }; rmSync(t, { force: true });
      return x.exp < Date.now() ? 'expirée' : { ct: x.ct, iv: x.iv };
    },
    scan: async (file: string, name: string, by: string, sp: SpaceView, rel: string) => {
      let level: string | undefined, why = '';
      try { const r = await ctx.call('ullr', 'fichier', { chemin: file }, `vérifier ${name} reçu dans ${sp.name}`); const v = r.data as { level?: string; findings?: Array<{ threat?: string }> } | undefined; level = v?.level; why = v?.findings?.map((f) => f.threat).filter(Boolean).slice(0, 2).join(', ') ?? ''; }
      catch { return { ok: true }; }
      // Retenu dès « moyenne » (un faisceau d'indices suffit pour un fichier partagé à d'autres) ; le propriétaire peut le libérer.
      if (level !== 'critique' && level !== 'haute' && level !== 'moyenne') return { ok: true };
      // Mis de côté (pas publié, pas effacé) : le propriétaire décide.
      const id = randomBytes(5).toString('hex'), d = join(sp.root, '.attente'); mkdirSync(d, { recursive: true }); const to = join(d, `${id}-${basename(name)}`); renameSync(file, to);
      ctx.saveSettings({ held: [...held(ctx), { id, space: sp.id, rel, file: to, why: why || `menace ${level}`, by, at: Date.now() }].slice(-200) });
      ctx.alert({ level: level === 'moyenne' ? 'haute' : 'critique', title: `Fichier ${level === 'moyenne' ? 'suspect' : 'dangereux'} reçu dans « ${sp.name} » : ${name}`, detail: `Envoyé par ${by}. L'antivirus a trouvé : ${why || level}. Le fichier est mis de côté (pas visible, pas effacé).`, key: `skid-virus-${id}`, steps: ['Ne l\'ouvre pas et ne le fais pas suivre.', `Demande à ${by} d'où vient ce fichier ; si son appareil est infecté, analyse-le.`, 'Si c\'est une erreur de l\'antivirus, tu peux le publier quand même (bouton).'], fix: { action: 'liberer', input: { id }, label: 'Le publier quand même' } });
      journal(ctx, { what: 'mis de côté (antivirus)', who: by, space: sp.id, path: rel, detail: why });
      return { ok: false, why: why || `menace ${level}`, id };
    },
    appAuth: (login: string, pass: string) => {
      const p = people.find((x) => x.login === login && x.active); if (!p || !pass) return undefined;
      const h = sha(pass), l = appPws(ctx), hit = l.find((x) => x.login === login && x.hash.length === h.length && timingSafeEqual(Buffer.from(x.hash), Buffer.from(h)));
      if (!hit) return undefined;
      if (!hit.last || Date.now() - hit.last > 600_000) ctx.saveSettings({ appPw: l.map((x) => (x === hit ? { ...x, last: Date.now() } : x)) });
      return { login, name: p.name, groups: p.groups };
    },
    log: (e) => journal(ctx, e),
    tooMany: (ip: string) => (tries.get(ip) ?? []).filter((t) => Date.now() - t < 900_000).length >= 5,
    fail: (ip: string, why: string) => {
      const l = [...(tries.get(ip) ?? []).filter((t) => Date.now() - t < 900_000), Date.now()]; tries.set(ip, l);
      journal(ctx, { what: 'refusé', ip, detail: why });
      if (l.length === 5) { ctx.emit('essais_rates', { ip, raison: why }); void ctx.call('garmr', 'bannir', { ip, raison: `Skíðblaðnir : ${why}` }, `${ip} a raté 5 fois : ${why}`).catch(() => {}); }
    },
    mascot: () => mascotSvg(),
  };
}

async function ensureServer(ctx: ModCtx, port?: number): Promise<FilesServer> {
  if (srv) return srv;
  const x = new FilesServer(hub(ctx)); await x.start(port ?? Number(ctx.settings.port ?? 8731)); srv = x;
  ctx.saveSettings({ on: true, ...(port === undefined ? {} : { portUsed: x.port }) });
  return x;
}

/** Les synchros dues, faites tout de suite. */
function runSync(ctx: ModCtx, j: SyncJob): string {
  const sp = spacesOf(ctx).find((x) => x.id === j.space); if (!sp) throw new Error('espace disparu');
  const root = rootOf(ctx, sp), A = S.inside(root, j.sub); mkdirSync(A, { recursive: true });
  const rel = (p: string) => [S.cleanRel(j.sub), p].filter(Boolean).join('/');
  const r = syncPair(A, j.dir, j.way, { trashA: (p) => S.toTrash(root, rel(p), 'synchro'), nameB: basename(j.dir) });
  const t = `${r.copiedAB.length} vers le dossier, ${r.copiedBA.length} vers l'espace, ${r.deletedA.length + r.deletedB.length} à la corbeille, ${r.conflicts.length} conflit(s)${r.errors.length ? `, ${r.errors.length} erreur(s)` : ''}`;
  ctx.saveSettings({ syncs: syncs(ctx).map((x) => (x.id === j.id ? { ...x, last: Date.now(), result: t } : x)) });
  if (r.conflicts.length) ctx.alert({ level: 'moyenne', title: `Synchro « ${sp.name} » : ${r.conflicts.length} conflit(s)`, detail: `Un fichier a changé des deux côtés : les deux versions sont gardées (${r.conflicts.slice(0, 3).join(', ')}).`, key: `skid-conflit-${j.id}`, steps: ['Ouvre les deux versions et garde la bonne.', 'Supprime la copie « conflit » une fois réglé.'] });
  if (r.errors.length) ctx.alert({ level: 'moyenne', title: `Synchro « ${sp.name} » : ${r.errors.length} fichier(s) non copiés`, detail: r.errors.slice(0, 3).join(' · '), key: `skid-err-${j.id}` });
  journal(ctx, { what: 'synchro', space: sp.id, detail: t });
  return t;
}

export function filesGraph(ctx: ModCtx): { nodes: GraphNode[]; edges: GraphEdge[]; details: Record<string, GraphDetail> } {
  const nodes: GraphNode[] = [{ id: 'odin', label: 'Odin · Skíðblaðnir', sub: srv ? `en marche · port ${srv.port}` : 'arrêté', square: true, size: 18, color: srv ? '#4F9DDE' : '#7d8791', hub: true }], edges: GraphEdge[] = [], details: Record<string, GraphDetail> = {};
  const ph = s(ctx.settings.privateHost), pub = s(ctx.settings.publicHost);
  if (ph) { nodes.push({ id: 'h:priv', label: ph, sub: 'connexion Vár', square: true, size: 11, color: '#7FB3E6' }); edges.push({ a: 'h:priv', b: 'odin', w: 2, color: '#7FB3E6' }); }
  if (pub) { nodes.push({ id: 'h:pub', label: pub, sub: 'liens publics', square: true, size: 11, color: '#F6C177' }); edges.push({ a: 'h:pub', b: 'odin', w: 2, color: '#F6C177' }); }
  const groups = new Set<string>();
  for (const sp of spacesOf(ctx)) {
    const id = `e:${sp.id}`, root = rootOf(ctx, sp), used = existsSync(root) ? S.usage(root) : 0, full = sp.quotaGb ? used / (sp.quotaGb * 1024 ** 3) : 0;
    nodes.push({ id, label: sp.name, sub: `${human(used)}${sp.quotaGb ? ` / ${sp.quotaGb} Go` : ''}`, square: true, size: 12, color: full > 0.9 ? '#F0A040' : '#57C98A' }); edges.push({ a: id, b: 'odin', w: 2 });
    details[id] = { kind: 'Espace partagé', title: sp.name, subtitle: root, chips: [{ label: `${S.trash(root).length} à la corbeille` }, ...(full > 0.9 ? [{ label: 'presque plein', tone: 'attention' as const }] : [])], rows: [{ k: 'Lecture', v: sp.read.join(', ') || '—' }, { k: 'Écriture', v: sp.write.join(', ') || '—' }, { k: 'Utilisé', v: `${human(used)}${sp.quotaGb ? ` sur ${sp.quotaGb} Go` : ''}` }, { k: 'Versions gardées', v: String(sp.versions) }], actions: [{ action: 'vider_corbeille', label: 'Vider la corbeille', input: { espace: sp.id } }] };
    for (const g of new Set([...sp.read, ...sp.write])) { groups.add(g); edges.push({ a: `g:${g}`, b: id, dash: !sp.write.includes(g), color: '#B48CF0' }); }
    for (const l of linksOf(ctx).filter((x) => x.space === sp.id && !x.off && x.expires > Date.now()).slice(-8)) { const lid = `l:${l.id}`; nodes.push({ id: lid, label: l.label ?? l.path, sub: `${l.kind} · ${l.downloads}`, size: 5, color: '#F0A040' }); edges.push({ a: id, b: lid, dash: true, color: '#F0A040' }); details[lid] = { kind: l.kind === 'depot' ? 'Dépôt' : 'Lien de partage', title: l.label ?? l.path, rows: [{ k: 'Par', v: l.by }, { k: 'Expire', v: new Date(l.expires).toLocaleString('fr-FR') }, { k: 'Utilisé', v: String(l.downloads) }, { k: 'Mot de passe', v: l.pass ? 'oui' : 'non' }], actions: [{ action: 'couper_lien', label: 'Couper le lien', input: { id: l.id } }] }; }
    for (const j of syncs(ctx).filter((x) => x.space === sp.id)) { const jid = `s:${j.id}`; nodes.push({ id: jid, label: basename(j.dir), sub: `synchro ${j.way === 'deux' ? '⇄' : j.way === 'vers_dossier' ? '→' : '←'}`, square: true, size: 8, color: '#7FB3E6' }); edges.push({ a: id, b: jid, w: 2, color: '#7FB3E6' }); details[jid] = { kind: 'Synchronisation', title: j.dir, subtitle: j.result ?? 'jamais lancée', rows: [{ k: 'Sens', v: j.way }, { k: 'Toutes les', v: `${j.every} min` }], actions: [{ action: 'synchroniser', label: 'Synchroniser maintenant', input: { id: j.id }, primary: true }] }; }
  }
  for (const g of groups) { nodes.push({ id: `g:${g}`, label: g === '*' ? 'tout le monde' : g, sub: 'groupe (Vár)', size: 9, color: '#B48CF0' }); }
  for (const p of people.filter((x) => x.active)) for (const g of p.groups) if (groups.has(g)) { if (!nodes.some((n) => n.id === `p:${p.login}`)) nodes.push({ id: `p:${p.login}`, label: p.name, sub: p.login, size: 6, color: '#E8EAEC' }); edges.push({ a: `p:${p.login}`, b: `g:${g}` }); }
  return { nodes, edges, details };
}

const SPACE_PARAMS = [{ key: 'nom', label: 'Nom de l\'espace (ex. Famille)', kind: 'text' as const, required: true }, { key: 'lecture', label: 'Groupes qui peuvent lire (« * » : tout le monde)', kind: 'text' as const, default: 'famille' }, { key: 'ecriture', label: 'Groupes qui peuvent écrire', kind: 'text' as const, default: 'famille' }, { key: 'quota_go', label: 'Place maximale (Go, 0 : sans limite)', kind: 'number' as const, default: 100 }, { key: 'versions', label: 'Versions gardées par fichier', kind: 'number' as const, default: 10 }, { key: 'dossier', label: 'Dossier sur le disque (vide : dans Odin)', kind: 'text' as const, default: '' }];

export const skidbladnir: Module = {
  id: 'skidbladnir', name: 'Skíðblaðnir', family: 'Données',
  what: 'Tes fichiers chez toi : espaces partagés par groupe, espace perso de chacun, liens de partage, dépôts, notes secrètes, versions, corbeille, lecteur réseau et synchro de dossiers.',
  does: ['espaces partagés par groupe (Vár) : lecture ou écriture, quota', 'espace perso pour chaque personne', 'interface web ordinateur et téléphone (téléverser, glisser-déposer, dossiers, renommer, déplacer, chercher, aperçu photo / vidéo / son)', 'versions gardées à chaque remplacement, restaurables', 'corbeille 30 jours (rien n\'est effacé d\'un coup)', 'liens de partage : expiration, mot de passe, nombre de téléchargements, archive .zip', 'dépôt : quelqu\'un t\'envoie des fichiers par un lien', 'envoi de gros fichiers par lien temporaire', 'notes secrètes chiffrées dans le navigateur, effacées après lecture', 'WebDAV : lecteur réseau sur Windows, Mac, Linux et applis du téléphone (mot de passe d\'appli)', 'synchronisation de dossiers (disque, clé USB, NAS) dans les deux sens, conflits gardés', 'antivirus sur chaque fichier reçu : le dangereux est mis de côté', '5 mots de passe faux sur un lien → adresse bannie', 'graphe : espaces, groupes, personnes, liens, synchros'],
  from: ['Sync-in', 'Erugo', 'Syncthing', 'PrivateBin'], upstream: ['Sync-in/server', 'ErugoOSS/Erugo', 'syncthing/syncthing', 'PrivateBin/PrivateBin'],
  words: ['fichiers partages', 'partage de fichiers', 'espace de fichiers', 'lien de partage', 'envoyer un gros fichier', 'gros fichiers', 'note secrete', 'synchroniser un dossier', 'synchro de dossier', 'webdav', 'lecteur reseau', 'mes fichiers'],
  actions: [
    { id: 'espace', label: 'Créer ou régler un espace', what: 'Un dossier partagé, avec les groupes qui lisent et qui écrivent', params: SPACE_PARAMS, run: (ctx, i) => {
      const name = s(i.nom).slice(0, 60); if (!name) throw new Error('quel nom ?');
      const id = slug(name), dir = s(i.dossier); if (dir && !isAbsolute(dir)) throw new Error('le dossier doit être un chemin complet (ex. /mnt/nas/famille)');
      const sp: Space = { id, name, ...(dir ? { path: resolve(dir) } : {}), read: groupsOf(i.lecture ?? 'famille'), write: groupsOf(i.ecriture ?? 'famille'), quotaGb: Math.max(0, Number(i.quota_go ?? 100) || 0), versions: Math.min(100, Math.max(0, Number(i.versions ?? 10))) };
      const all = spacesOf(ctx), was = all.find((x) => x.id === id); mkdirSync(rootOf(ctx, sp), { recursive: true });
      ctx.saveSettings({ spaces: was ? all.map((x) => (x.id === id ? { ...sp, path: sp.path ?? x.path } : x)) : [...all, sp] });
      return { text: `📁 Espace « ${name} » ${was ? 'réglé' : 'créé'} : lecture ${sp.read.join(', ')}, écriture ${sp.write.join(', ')}${sp.quotaGb ? `, ${sp.quotaGb} Go au plus` : ''}.` };
    }, undo: (i) => ({ action: 'retirer_espace', input: { nom: i.nom }, label: 'Retirer l\'espace' }) },
    { id: 'retirer_espace', label: 'Retirer un espace', what: 'Il n\'apparaît plus ; ses fichiers restent sur le disque', quick: false, params: [{ key: 'nom', label: 'Espace', kind: 'text', required: true }], run: (ctx, i) => {
      const id = slug(s(i.nom)), sp = spacesOf(ctx).find((x) => x.id === id || x.name === s(i.nom)); if (!sp) throw new Error('espace inconnu');
      ctx.saveSettings({ spaces: spacesOf(ctx).filter((x) => x !== sp) }); return { text: `Espace « ${sp.name} » retiré. Ses fichiers restent dans ${rootOf(ctx, sp)}.` };
    } },
    { id: 'demarrer', label: 'Démarrer', what: 'Le serveur des fichiers (derrière le proxy)', quick: false, params: [{ key: 'port', label: 'Port local', kind: 'number', default: 8731 }], run: async (ctx, i) => { const x = await ensureServer(ctx, i.port === undefined ? undefined : Number(i.port)); return { text: `✅ Fichiers en marche sur le port local ${x.port}.` }; } },
    { id: 'arreter', label: 'Arrêter', what: 'Plus d\'accès aux fichiers par le web', quick: false, run: (ctx) => { srv?.stop(); srv = undefined; ctx.saveSettings({ on: false }); return { text: '⏹ Serveur des fichiers arrêté.' }; } },
    { id: 'publier', label: 'Mettre en ligne', what: 'Deux noms : l\'espace (réservé aux personnes connectées) et les liens publics', params: [{ key: 'fichiers', label: 'Nom de l\'espace (ex. fichiers.exemple.fr)', kind: 'text', required: true }, { key: 'partage', label: 'Nom des liens publics (ex. partage.exemple.fr)', kind: 'text', required: true }, { key: 'https', label: 'Certificat', kind: 'select', options: ['letsencrypt', 'auto-signé', 'aucun'], default: 'letsencrypt' }], run: async (ctx, i) => {
      const f = s(i.fichiers).toLowerCase(), p = s(i.partage).toLowerCase(); if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(f) || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(p) || f === p) throw new Error('deux noms différents, ex. fichiers.exemple.fr et partage.exemple.fr');
      const x = await ensureServer(ctx), cible = `http://127.0.0.1:${x.port}`, out: string[] = [];
      for (const d of [f, p]) { const r = await ctx.call('valgrind', 'ajouter', { domaines: d, cible, https: s(i.https) || 'letsencrypt', websocket: false, surveiller: d === f, dns_maison: true }, `servir ${d}`).catch((e) => ({ ok: false, text: (e as Error).message })); out.push(r.ok === false && !/déjà utilisé/.test(r.text) ? `⚠ ${d} : ${r.text}` : `✓ ${d} dans le proxy`); }
      const v = await ctx.call('var', 'proteger_site', { domaine: f, groupes: '*' }, `réserver ${f} aux personnes connectées`).catch((e) => ({ ok: false, text: (e as Error).message }));
      out.push(v.ok === false ? `⚠ connexion Vár : ${v.text} (règle d'abord le portail dans Vár)` : `✓ ${f} demande la connexion d'Odin`);
      ctx.saveSettings({ privateHost: f, publicHost: p });
      return { text: `🌐 Fichiers en ligne :\n${out.join('\n')}\nOuvre https://${f}. Lecteur réseau : https://${p}/dav/ (mot de passe d'appli).` };
    } },
    { id: 'lien', label: 'Créer un lien de partage', what: 'Un fichier ou un dossier par lien (expiration, mot de passe)', params: [{ key: 'espace', label: 'Espace', kind: 'text', required: true }, { key: 'chemin', label: 'Fichier ou dossier dans l\'espace', kind: 'text', default: '' }, { key: 'jours', label: 'Valable (jours)', kind: 'number', default: 7 }, { key: 'mot_de_passe', label: 'Mot de passe (conseillé)', kind: 'password', default: '' }, { key: 'max', label: 'Téléchargements au plus (0 : sans limite)', kind: 'number', default: 0 }], run: (ctx, i) => {
      const sp = spacesOf(ctx).find((x) => x.id === slug(s(i.espace)) || x.name === s(i.espace)); if (!sp) throw new Error('espace inconnu');
      const rel = S.cleanRel(s(i.chemin)); if (!existsSync(S.inside(rootOf(ctx, sp), rel))) throw new Error('introuvable dans l\'espace');
      const { link, token } = hub(ctx).newLink({ login: 'odin', groups: ['admins'] }, { space: sp.id, path: rel, kind: 'partage', expires: Date.now() + Math.min(365, Math.max(1, Number(i.jours) || 7)) * 864e5, password: s(i.mot_de_passe) || undefined, max: Number(i.max) || undefined, label: basename(rel) || sp.name });
      return { text: `🔗 https://${s(ctx.settings.publicHost) || '(nom des liens publics : « Mettre en ligne »)'}/p/${token}\nValable jusqu'au ${new Date(link.expires).toLocaleDateString('fr-FR')}${link.pass ? ', avec mot de passe' : ''}.`, data: { id: link.id } };
    }, undo: (_i, r) => ({ action: 'couper_lien', input: { id: (r.data as { id: string }).id }, label: 'Couper le lien' }) },
    { id: 'couper_lien', label: 'Couper un lien', what: 'Le lien ne marche plus', quick: false, params: [{ key: 'id', label: 'Lien', kind: 'text', required: true }], run: (ctx, i) => { const l = linksOf(ctx); const x = l.find((y) => y.id === s(i.id)); if (!x) throw new Error('lien inconnu'); x.off = true; ctx.saveSettings({ links: l }); return { text: `✂ Lien « ${x.label ?? x.path} » coupé.` }; } },
    { id: 'mot_de_passe_appli', label: 'Mot de passe d\'appli (lecteur réseau)', what: 'Pour monter les fichiers sur un ordinateur ou une appli du téléphone (WebDAV). Affiché une seule fois', quick: false, params: [{ key: 'login', label: 'Identifiant de la personne (Vár)', kind: 'text', required: true }, { key: 'nom', label: 'Pour quel appareil (ex. PC du bureau)', kind: 'text', default: 'appareil' }], run: async (ctx, i) => {
      await refreshPeople(ctx); const login = s(i.login).toLowerCase(); if (!people.some((p) => p.login === login && p.active)) throw new Error(`${login} n'a pas de compte actif dans Vár`);
      const pw = randomBytes(18).toString('base64url'), id = randomBytes(4).toString('hex');
      ctx.saveSettings({ appPw: [...appPws(ctx), { id, login, label: s(i.nom).slice(0, 40) || 'appareil', hash: sha(pw), created: Date.now() }] });
      const pub = s(ctx.settings.publicHost) || 'partage.exemple.fr';
      return { text: `🔑 Mot de passe d'appli pour ${login} (${s(i.nom) || 'appareil'}) : ${pw}\nIl ne sera plus affiché. Adresse : https://${pub}/dav/ · identifiant : ${login}.\nWindows : Explorateur → Ce PC → Connecter un lecteur réseau. Mac : Finder → Aller → Se connecter au serveur. Android / iPhone : une appli de fichiers WebDAV (ex. FolderSync, Documents).`, data: { id } };
    }, undo: (_i, r) => ({ action: 'retirer_mot_de_passe_appli', input: { id: (r.data as { id: string }).id }, label: 'Retirer ce mot de passe' }) },
    { id: 'retirer_mot_de_passe_appli', label: 'Retirer un mot de passe d\'appli', what: 'L\'appareil ne peut plus se connecter', quick: false, params: [{ key: 'id', label: 'Mot de passe', kind: 'text', required: true }], run: (ctx, i) => { const l = appPws(ctx), x = l.find((y) => y.id === s(i.id)); if (!x) throw new Error('inconnu'); ctx.saveSettings({ appPw: l.filter((y) => y !== x) }); return { text: `🔒 Mot de passe « ${x.label} » de ${x.login} retiré.` }; } },
    { id: 'synchro', label: 'Synchroniser un dossier', what: 'Un espace ⇄ un dossier de la machine (disque, clé USB, NAS monté)', params: [{ key: 'espace', label: 'Espace', kind: 'text', required: true }, { key: 'dossier', label: 'Dossier de la machine (chemin complet)', kind: 'text', required: true }, { key: 'sous_dossier', label: 'Sous-dossier de l\'espace (vide : tout)', kind: 'text', default: '' }, { key: 'sens', label: 'Sens', kind: 'select', options: ['deux', 'vers_dossier', 'vers_espace'], default: 'deux' }, { key: 'minutes', label: 'Toutes les (minutes)', kind: 'number', default: 15 }], run: (ctx, i) => {
      const sp = spacesOf(ctx).find((x) => x.id === slug(s(i.espace)) || x.name === s(i.espace)); if (!sp) throw new Error('espace inconnu');
      const dir = resolve(s(i.dossier)); if (!isAbsolute(s(i.dossier))) throw new Error('chemin complet attendu (ex. /mnt/usb/photos)');
      const root = resolve(rootOf(ctx, sp)); if (dir === root || dir.startsWith(`${root}/`) || root.startsWith(`${dir}/`)) throw new Error('le dossier ne doit pas être dans l\'espace (ni l\'inverse)');
      mkdirSync(dir, { recursive: true });
      const way = (['deux', 'vers_dossier', 'vers_espace'].includes(s(i.sens)) ? s(i.sens) : 'deux') as Way, j: SyncJob = { id: randomBytes(4).toString('hex'), space: sp.id, sub: S.cleanRel(s(i.sous_dossier)), dir, way, every: Math.max(1, Number(i.minutes) || 15) };
      ctx.saveSettings({ syncs: [...syncs(ctx), j] });
      return { text: `🔄 Synchro ajoutée : ${sp.name}${j.sub ? `/${j.sub}` : ''} ${way === 'deux' ? '⇄' : way === 'vers_dossier' ? '→' : '←'} ${dir}, toutes les ${j.every} min. Première synchro : ${runSync(ctx, j)}.`, data: { id: j.id } };
    }, undo: (_i, r) => ({ action: 'retirer_synchro', input: { id: (r.data as { id: string }).id }, label: 'Retirer la synchro' }) },
    { id: 'retirer_synchro', label: 'Retirer une synchro', what: 'Les deux dossiers restent tels quels', quick: false, params: [{ key: 'id', label: 'Synchro', kind: 'text', required: true }], run: (ctx, i) => { ctx.saveSettings({ syncs: syncs(ctx).filter((x) => x.id !== s(i.id)) }); return { text: 'Synchro retirée (rien n\'est effacé).' }; } },
    { id: 'synchroniser', label: 'Synchroniser maintenant', what: 'Lance les synchros tout de suite', params: [{ key: 'id', label: 'Synchro (vide : toutes)', kind: 'text', default: '' }], run: (ctx, i) => {
      const l = syncs(ctx).filter((x) => !s(i.id) || x.id === s(i.id)); if (!l.length) return { text: 'Aucune synchro.' };
      return { text: l.map((j) => { try { return `🔄 ${basename(j.dir)} : ${runSync(ctx, j)}`; } catch (e) { return `✗ ${basename(j.dir)} : ${(e as Error).message}`; } }).join('\n') };
    } },
    { id: 'liberer', label: 'Publier un fichier mis de côté', what: 'Un fichier retenu par l\'antivirus est remis à sa place', quick: false, grave: () => 'publier un fichier que l\'antivirus juge dangereux', params: [{ key: 'id', label: 'Fichier', kind: 'text', required: true }], run: (ctx, i) => {
      const h = held(ctx).find((x) => x.id === s(i.id)); if (!h) throw new Error('rien de tel');
      const sp = hub(ctx).spaceById(h.space); if (!sp) throw new Error('espace disparu');
      const dir = dirname(S.inside(sp.root, h.rel)); mkdirSync(dir, { recursive: true }); const name = S.freeName(dir, basename(h.rel)); renameSync(h.file, join(dir, name));
      ctx.saveSettings({ held: held(ctx).filter((x) => x !== h) }); journal(ctx, { what: 'publié malgré l\'antivirus', space: h.space, path: h.rel });
      return { text: `⚠ « ${name} » publié dans ${sp.name} malgré l'antivirus (${h.why}).` };
    } },
    { id: 'vider_corbeille', label: 'Vider la corbeille', what: 'Efface pour de bon ce qui est à la corbeille d\'un espace', quick: false, grave: (i) => `effacer définitivement la corbeille de « ${s(i.espace)} »`, params: [{ key: 'espace', label: 'Espace', kind: 'text', required: true }], run: (ctx, i) => {
      const sp = spacesOf(ctx).find((x) => x.id === slug(s(i.espace)) || x.name === s(i.espace)); if (!sp) throw new Error('espace inconnu');
      return { text: `🗑 ${S.purge(rootOf(ctx, sp), 0)} élément(s) effacé(s) de la corbeille de « ${sp.name} ».` };
    } },
    { id: 'journal', label: 'Journal', what: 'Qui a envoyé, téléchargé, partagé quoi', read: true, run: (ctx) => ({ text: readJournal(ctx, 30).map((e) => `- ${new Date(e.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · ${e.what}${e.who ? ` · ${e.who}` : ''}${e.path ? ` · ${e.path}` : ''}${e.ip ? ` · ${e.ip}` : ''}${e.detail ? ` (${e.detail})` : ''}`).join('\n') || 'Rien pour l\'instant.' }) },
  ],
  view(ctx) {
    appCtx = ctx;
    const sps = spacesOf(ctx), live = linksOf(ctx).filter((l) => !l.off && l.expires > Date.now()), ph = s(ctx.settings.privateHost);
    return {
      subtitle: `${srv ? `En marche${ph ? ` · https://${ph}` : ''}` : 'Arrêté'} · ${sps.length} espace(s) · ${live.length} lien(s) actif(s)`,
      kpis: [{ label: 'Espaces', value: String(sps.length) }, { label: 'Liens actifs', value: String(live.length) }, { label: 'Synchros', value: String(syncs(ctx).length) }, { label: 'Mis de côté', value: String(held(ctx).length), tone: held(ctx).length ? 'mauvais' : undefined }],
      sections: [
        ...(srv && ph && sps.length ? [] : [{ kind: 'steps' as const, title: 'Mettre en route', items: [
          { title: 'Créer un espace', detail: 'Ex. « Famille » : lu et écrit par le groupe famille de Vár (formulaire à droite).', done: sps.length > 0 },
          { title: 'Démarrer le serveur des fichiers', detail: 'Il reste sur la machine ; le proxy Valgrind le sert sous ton nom.', done: Boolean(srv), action: srv ? undefined : 'demarrer', button: 'Démarrer' },
          { title: 'Mettre en ligne', detail: 'Deux noms : fichiers.exemple.fr (connexion Vár) et partage.exemple.fr (liens publics). Publiés aussi par le tunnel Cloudflare s\'il est réglé.', done: Boolean(ph) },
        ] }]),
        { kind: 'graph', title: 'Graphe des fichiers', ...filesGraph(ctx), legend: [['#4F9DDE', 'Odin'], ['#57C98A', 'espace'], ['#B48CF0', 'groupe'], ['#F0A040', 'lien de partage'], ['#7FB3E6', 'synchro / nom']], empty: 'Crée un premier espace à droite.' },
        { kind: 'table', title: 'Espaces', columns: ['Espace', 'Lecture', 'Écriture', 'Utilisé', 'Dossier'], empty: 'Aucun espace.', rows: sps.map((sp) => { const root = rootOf(ctx, sp), used = existsSync(root) ? S.usage(root) : 0; return { cells: [sp.name, sp.read.join(', '), sp.write.join(', '), `${human(used)}${sp.quotaGb ? ` / ${sp.quotaGb} Go` : ''}`, root], tone: sp.quotaGb && used > 0.9 * sp.quotaGb * 1024 ** 3 ? 'attention' as const : undefined, actions: [{ action: 'vider_corbeille', label: 'Vider la corbeille', input: { espace: sp.id } }] }; }) },
        { kind: 'table', title: 'Liens de partage et dépôts', columns: ['Nom', 'Type', 'Par', 'Expire', 'Utilisé', 'Mot de passe'], empty: 'Aucun lien.', rows: linksOf(ctx).slice(-40).reverse().map((l) => ({ cells: [l.label ?? l.path, l.kind, l.by, l.off ? 'coupé' : new Date(l.expires).toLocaleDateString('fr-FR'), String(l.downloads), l.pass ? 'oui' : 'non'], tone: l.off || l.expires < Date.now() ? 'neutre' as const : undefined, actions: l.off ? [] : [{ action: 'couper_lien', label: 'Couper', input: { id: l.id } }] })) },
        { kind: 'table', title: 'Synchros de dossiers', columns: ['Espace', 'Dossier', 'Sens', 'Rythme', 'Dernière fois'], empty: 'Aucune synchro.', rows: syncs(ctx).map((j) => ({ cells: [j.space + (j.sub ? `/${j.sub}` : ''), j.dir, j.way, `${j.every} min`, j.last ? `${new Date(j.last).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · ${j.result}` : 'jamais'], actions: [{ action: 'synchroniser', label: 'Maintenant', input: { id: j.id } }, { action: 'retirer_synchro', label: 'Retirer', input: { id: j.id } }] })) },
        { kind: 'table', title: 'Mots de passe d\'appli (lecteur réseau)', columns: ['Personne', 'Appareil', 'Créé', 'Dernière utilisation'], empty: 'Aucun.', rows: appPws(ctx).map((x) => ({ cells: [x.login, x.label, new Date(x.created).toLocaleDateString('fr-FR'), x.last ? new Date(x.last).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais'], actions: [{ action: 'retirer_mot_de_passe_appli', label: 'Retirer', input: { id: x.id } }] })) },
        ...(held(ctx).length ? [{ kind: 'table' as const, title: 'Fichiers mis de côté par l\'antivirus', columns: ['Fichier', 'Espace', 'Menace', 'Envoyé par', 'Le'], rows: held(ctx).map((h) => ({ cells: [h.rel, h.space, h.why, h.by, new Date(h.at).toLocaleString('fr-FR')], tone: 'mauvais' as const, actions: [{ action: 'liberer', label: 'Publier quand même', input: { id: h.id } }] })) }] : []),
        { kind: 'list', title: 'Liens avec les prochaines applis', items: [{ title: 'Sól (photos)', detail: 'les photos du téléphone rangées dans ton espace, albums partagés par lien' }, { title: 'Snotra (bureau)', detail: 'ouvrir et modifier à plusieurs les documents des espaces' }, { title: 'Fensalir (disques)', detail: 'les espaces sur les disques réunis, avec parité' }] },
        { kind: 'log', title: 'Journal', lines: readJournal(ctx, 20).map((e) => `${new Date(e.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · ${e.what}${e.who ? ` · ${e.who}` : ''}${e.path ? ` · ${e.path}` : ''}${e.detail ? ` (${e.detail})` : ''}`) },
      ],
      side: ['espace', 'publier', 'lien', 'mot_de_passe_appli', 'synchro'].map((id) => { const a = skidbladnir.actions.find((x) => x.id === id)!; return { kind: 'form' as const, title: a.label, action: a.id, submit: 'Valider', params: a.params ?? [] }; }),
    };
  },
  async start(ctx) { appCtx = ctx; await refreshPeople(ctx); if (ctx.settings.on === true) { try { await ensureServer(ctx); } catch (e) { ctx.alert({ level: 'haute', title: 'Les fichiers (Skíðblaðnir) n\'ont pas pu démarrer', detail: (e as Error).message, key: 'skid-demarrage' }); } } },
  stop() { srv?.stop(); srv = undefined; },
  // Chaque minute : personnes de Vár, synchros dues, liens et notes expirés, corbeille de plus de 30 jours, place.
  watch: { every: 60, async run(ctx) {
    await refreshPeople(ctx);
    for (const j of syncs(ctx)) if (!j.last || Date.now() - j.last >= j.every * 60_000) { try { runSync(ctx, j); } catch (e) { ctx.alert({ level: 'moyenne', title: `Synchro de ${basename(j.dir)} impossible`, detail: (e as Error).message, key: `skid-sync-${j.id}` }); } }
    // Envois expirés : leurs fichiers vont à la corbeille (récupérables 30 jours).
    const ls = linksOf(ctx); let changed = false;
    for (const l of ls) if (l.kind === 'envoi' && !l.off && l.expires < Date.now()) { const sp = hub(ctx).spaceById(l.space); try { if (sp && l.path) S.toTrash(sp.root, l.path, 'envoi expiré'); } catch { /* déjà parti */ } l.off = true; changed = true; }
    if (changed) ctx.saveSettings({ links: ls });
    const nd = join(ctx.dir, 'notes'); if (existsSync(nd)) for (const f of readdirSync(nd)) { try { const x = JSON.parse(readFileSync(join(nd, f), 'utf8')) as { exp: number }; if (x.exp < Date.now()) rmSync(join(nd, f), { force: true }); } catch { /* */ } }
    if (Date.now() - Number(ctx.settings.lastPurge ?? 0) > 6 * 3600_000) {
      for (const sp of spacesOf(ctx)) { try { S.purge(rootOf(ctx, sp), 30); } catch { /* */ } }
      const pr = join(base(ctx), 'personnes'); if (existsSync(pr)) for (const l of readdirSync(pr)) { try { S.purge(join(pr, l), 30); } catch { /* */ } }
      ctx.saveSettings({ lastPurge: Date.now() });
    }
    for (const sp of spacesOf(ctx)) { if (!sp.quotaGb) continue; const root = rootOf(ctx, sp); if (!existsSync(root)) continue; const u = S.usage(root), q = sp.quotaGb * 1024 ** 3; if (u > 0.9 * q) ctx.alert({ level: 'moyenne', title: `L'espace « ${sp.name} » est plein à ${Math.round(u / q * 100)} %`, detail: `${human(u)} sur ${sp.quotaGb} Go. Au-delà, plus aucun envoi n'est accepté.`, key: `skid-plein-${sp.id}`, steps: ['Vide la corbeille de l\'espace (bouton).', 'Supprime ou déplace les gros fichiers (vidéos).', 'Ou augmente la place maximale de l\'espace.'], fix: { action: 'vider_corbeille', input: { espace: sp.id }, label: 'Vider la corbeille' } }); }
  } },
};
