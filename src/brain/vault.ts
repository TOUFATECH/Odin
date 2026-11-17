// Le Cerveau d'Odin : un « deuxième cerveau » en fichiers Markdown simples, ouvrables tels quels
// dans Obsidian (même dossier = même coffre) : propriétés en tête (frontmatter YAML), liens
// [[Note]] et [[Note|texte]], étiquettes #tag, dossiers. Rien de propriétaire : tes notes restent
// des fichiers texte à toi.
//
// Ce module est pur (fichiers + calculs) : lire, écrire, renommer (les liens suivent), corbeille
// (jamais d'effacement définitif), rétroliens, graphe (liens écrits + liens devinés par les mentions
// et les étiquettes partagées), recherche classée, journal du jour, projets (objectifs, décisions,
// contraintes), bases (toutes les notes d'un type, avec leurs propriétés).

import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { IndexNotes } from './index-notes.ts';

export interface NoteMeta { [k: string]: string | number | boolean | string[] | undefined }
export interface Note { path: string; title: string; meta: NoteMeta; body: string; links: string[]; tags: string[]; mtime: number; size: number }
export interface GraphNode { id: string; title: string; type: string; tags: string[]; degree: number; folder: string; source?: string; excerpt?: string; mtime?: number }
export interface GraphEdge { from: string; to: string; kind: 'lien' | 'mention' | 'étiquette' | 'source' }

/** Début du texte d'une note, sans Markdown : affiché sur les cartes du graphe quand on zoome. */
export function excerptOf(body: string, max = 140): string {
  const t = body.replace(/```[\s\S]*?```/g, ' ').replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b) => b || a).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^#+\s*|^[-*>]\s+|^\d+\.\s+|[*_`~]/gm, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Types de notes (bases) proposés par défaut, avec leurs propriétés et leurs statuts. */
export const TYPES: Record<string, { folder: string; label: string; props: string[]; statuses?: string[] }> = {
  projet: { folder: 'Projets', label: 'Projets', props: ['statut', 'échéance', 'priorité'], statuses: ['idée', 'en cours', 'en pause', 'terminé'] },
  tâche: { folder: 'Tâches', label: 'Tâches', props: ['statut', 'échéance', 'projet'], statuses: ['à faire', 'en cours', 'fait'] },
  personne: { folder: 'Personnes', label: 'Personnes', props: ['rôle', 'téléphone', 'email'] },
  idée: { folder: 'Idées', label: 'Idées', props: ['statut'], statuses: ['brute', 'à creuser', 'retenue'] },
  réunion: { folder: 'Réunions', label: 'Réunions', props: ['date', 'projet', 'participants'] },
  ressource: { folder: 'Ressources', label: 'Ressources', props: ['source', 'auteur'] },
  capture: { folder: 'Captures', label: 'Captures', props: ['source', 'lien'] },
  journal: { folder: 'Journal', label: 'Journal', props: ['date'] },
  // Le quotidien : ce qu'Odin a appris à refaire sans IA (une note par mission, tenue par lui : voir learn/quotidien.ts).
  quotidien: { folder: 'Quotidien', label: 'Quotidien', props: ['appli', 'étapes', 'utilisé', 'dernière fois'] },
  fiche: { folder: 'Fiches', label: 'Fiches', props: [] },
  note: { folder: '', label: 'Notes', props: [] },
};

const TRASH = '.corbeille';
/** À partir de combien de notes le dossier est surveillé (en dessous, tout re-vérifier coûte quelques millisecondes). */
const SURVEILLER_DES = 300;
/** Dossier surveillé et rien n'a bougé : relecture complète de sécurité au plus tard au bout de ce temps. */
const RELECTURE_SECURITE_MS = 60_000;
/** Ce qui identifie un dossier (pas seulement son chemin) : déplacé puis remplacé, il change. */
function identiteDossier(root: string): string {
  try { const s = statSync(root); return `${s.dev}:${s.ino}:${s.birthtimeMs}`; } catch { return ''; }
}
const RESEAU = new Map<string, boolean>();
/**
 * Le dossier est-il sur un disque réseau (les changements faits depuis une autre machine n'y sont souvent pas signalés) ?
 * Windows : chemin réseau (\\serveur\…) ou lecteur déclaré « distant » ; Linux : système de fichiers réseau d'après
 * /proc/mounts. Dans le doute (vérification impossible), on répond oui : la relecture toutes les 3 s reste.
 */
export async function disqueReseau(root: string): Promise<boolean> {
  const cle = root.toLowerCase(); const deja = RESEAU.get(cle); if (deja !== undefined) return deja;
  let r = true;
  try {
    if (/^\\\\|^\/\//.test(root)) r = true;
    else if (process.platform === 'win32') {
      const lecteur = /^([a-z]):/i.exec(root)?.[1];
      // Le type du lecteur en nombre (indépendant de la langue de Windows) : 3 = disque local, 4 = lecteur réseau.
      const sortie = lecteur ? await new Promise<string>((ok, ko) => { execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${lecteur.toUpperCase()}:'").DriveType`], { timeout: 8000, windowsHide: true, encoding: 'utf8' }, (e, out) => (e ? ko(e) : ok(String(out)))).unref(); }) : '';
      r = sortie.trim() !== '3';
    } else if (process.platform === 'linux') {
      const montages = readFileSync('/proc/mounts', 'utf8').split('\n').map((l) => l.split(' ')).filter((x) => x.length > 2);
      const m = montages.filter((x) => root === x[1] || root.startsWith(x[1].endsWith('/') ? x[1] : `${x[1]}/`)).sort((a, b) => b[1].length - a[1].length)[0];
      r = !m || /^(nfs|nfs4|cifs|smb|smbfs|smb3|9p|fuse\.sshfs|fuse\.rclone|davfs|afs|ceph|glusterfs)$/.test(m[2]);
    } else r = false; // macOS et autres : disques locaux en général ; la surveillance doit de toute façon faire ses preuves
  } catch { r = true; }
  RESEAU.set(cle, r);
  return r;
}
/** Combien de fois `w` apparaît dans `t` (sans recouvrement), sans créer de tableau. Pur. */
function occurrences(t: string, w: string): number {
  let n = 0; for (let i = t.indexOf(w); i >= 0; i = t.indexOf(w, i + w.length)) n++;
  return n;
}
/** Changements du Cerveau (créée, modifiée, renommée, corbeille) : pour les automatisations. */
export const vaultEvents = new EventEmitter();
vaultEvents.setMaxListeners(20);
const SKIP = new Set(['.obsidian', '.git', TRASH, '.trash', 'node_modules']);

// ---------------- Format (pur) ----------------

/** Lit le frontmatter YAML simple (clé: valeur, listes [a, b] ou « - a »). Pur. */
export function parseNote(text: string): { meta: NoteMeta; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: NoteMeta = {};
  let listKey = '';
  for (const raw of m[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(raw);
    if (item && listKey) { (meta[listKey] as string[]).push(unquote(item[1])); continue; }
    const kv = /^([^:#][^:]*):\s*(.*)$/.exec(raw);
    if (!kv) continue;
    const k = kv[1].trim(), v = kv[2].trim();
    if (!v) { meta[k] = []; listKey = k; continue; }
    listKey = '';
    if (/^\[.*\]$/.test(v)) meta[k] = v.slice(1, -1).split(',').map((x) => unquote(x.trim())).filter(Boolean);
    else if (v === 'true' || v === 'false') meta[k] = v === 'true';
    else if (/^-?\d+(\.\d+)?$/.test(v)) meta[k] = Number(v);
    else meta[k] = unquote(v);
  }
  return { meta, body: text.slice(m[0].length) };
}
const unquote = (v: string) => v.replace(/^["']|["']$/g, '');

/** Note → texte Markdown (frontmatter + corps). Pur. */
export function formatNote(meta: NoteMeta, body: string): string {
  const keys = Object.keys(meta).filter((k) => meta[k] !== undefined && meta[k] !== '');
  if (!keys.length) return body;
  const q = (v: string) => (/^[\w\sàâçéèêëîïôûùüÿœæ.,'/@+()-]*$/i.test(v) && !/^\s|\s$|^(true|false|\d+)$/.test(v) ? v : JSON.stringify(v));
  const lines = keys.map((k) => { const v = meta[k]; return Array.isArray(v) ? `${k}: [${v.map((x) => q(String(x))).join(', ')}]` : `${k}: ${typeof v === 'string' ? q(v) : String(v)}`; });
  return `---\n${lines.join('\n')}\n---\n${body.replace(/^\n+/, '')}`;
}

/** Liens [[Cible]] / [[Cible|texte]] / [[Cible#titre]] et ![[image]] d'un texte → cibles. Pur. */
export function extractLinks(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.replace(/```[\s\S]*?```/g, '').matchAll(/!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g)) out.add(m[1].trim());
  return [...out];
}
/** Étiquettes #tag (pas les titres Markdown ni les couleurs). Pur. */
export function extractTags(body: string, meta: NoteMeta = {}): string[] {
  const out = new Set<string>();
  const fm = meta.tags ?? meta.tag ?? meta['étiquettes'];
  for (const t of Array.isArray(fm) ? fm : typeof fm === 'string' ? fm.split(/[,\s]+/) : []) if (t) out.add(String(t).replace(/^#/, '').toLowerCase());
  for (const m of body.replace(/```[\s\S]*?```/g, '').matchAll(/(^|\s)#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu)) out.add(m[2].toLowerCase());
  return [...out];
}
/** Nom de fichier sûr à partir d'un titre (garde les accents, comme Obsidian). Pur. */
export function safeName(title: string): string {
  return title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Sans titre';
}
const noteKey = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\.md$/, '').trim();
/** Le texte d'une note sans accents ni majuscules, calculé une fois par note lue (la recherche le relit à chaque demande). */
const FOLDED = new WeakMap<Note, { title: string; body: string; props: string; tags: string }>();
function folded(n: Note): { title: string; body: string; props: string; tags: string } {
  let f = FOLDED.get(n);
  if (!f) { f = { title: noteKey(n.title), body: noteKey(n.body), props: noteKey(JSON.stringify(n.meta)), tags: n.tags.join(' ') }; FOLDED.set(n, f); }
  return f;
}

// ---------------- Coffre ----------------

export class Vault {
  private cache?: { at: number; notes: Note[] };
  /** Notes déjà lues (chemin → note) : une note dont la date et la taille n'ont pas bougé n'est pas relue. */
  private known = new Map<string, Note>();
  /** Index des notes (chemin, nom de fichier, titre) : `find` ne parcourt plus tout le Cerveau. */
  private idx?: { notes: Note[]; byPath: Map<string, Note>; byKey: Map<string, Note> };
  /** Index inversé « mot → notes » pour `search` (reconstruit quand la liste des notes change). */
  private rech?: { notes: Note[]; index: IndexNotes };
  readonly root: string;
  /**
   * Surveillance du dossier (gros Cerveau seulement) : tant qu'aucun fichier ne bouge, la liste des notes reste valable
   * sans tout re-vérifier note par note à chaque demande (2 000 notes = 2 000 lectures disque). Jamais moins sûr qu'avant :
   *  - un événement du système (« sale ») fait tout relire à la demande suivante, sans attendre ;
   *  - la relecture espacée (RELECTURE_SECURITE_MS) n'est permise que quand la surveillance a FAIT SES PREUVES (elle a
   *    déjà signalé un changement), que le dossier est bien le même qu'au départ (pas déplacé ni remplacé), et qu'il
   *    n'est pas sur un disque réseau (qui n'envoie souvent pas les changements faits ailleurs) ; sinon : 3 s, comme avant ;
   *  - au départ de la surveillance, une relecture complète suit (une écriture faite pendant son démarrage est vue).
   */
  private veille?: { w: FSWatcher; sale: boolean; prouvee: boolean; identite: string } | null;
  constructor(root: string) { this.root = root; mkdirSync(root, { recursive: true }); }

  /** Pose la surveillance du dossier, une fois (rien sous SURVEILLER_DES notes : la relecture y est déjà rapide). */
  private surveiller(n: number): void {
    if (this.veille !== undefined || n < SURVEILLER_DES || this.verification) return;
    // Le type du disque est vérifié à part (sans bloquer Odin) ; en attendant, la relecture toutes les 3 s reste.
    this.verification = disqueReseau(this.root).then((reseau) => { this.verification = undefined; if (this.veille !== undefined) return; if (reseau) this.veille = null; else this.poserVeille(); }, () => { this.verification = undefined; this.veille = null; });
  }
  private verification?: Promise<void>;
  private poserVeille(): void {
    try {
      const v: { w: FSWatcher; sale: boolean; prouvee: boolean; identite: string } = { w: watch(this.root, { recursive: true }, (_e, nom) => {
        // Ce que le Cerveau ne lit pas (.obsidian, corbeille, fichiers cachés) ne compte pas : sinon Obsidian, qui écrit
        // sans cesse ses réglages, ferait tout relire à chaque demande.
        const n = typeof nom === 'string' ? nom.replace(/\\/g, '/') : '';
        if (n && n.split('/').some((x) => x.startsWith('.') || SKIP.has(x))) return;
        v.sale = true; v.prouvee = true;
        // Le Cerveau lui-même a disparu (dossier effacé) : on arrête de surveiller (sinon le système insiste en boucle).
        if (!existsSync(this.root)) this.arreterVeille();
      }), sale: true, prouvee: false, identite: identiteDossier(this.root) };
      v.w.on('error', () => this.arreterVeille());
      v.w.unref();
      this.veille = v;
    } catch { this.veille = null; } // surveillance impossible ici : la relecture toutes les 3 s reste
  }
  private arreterVeille(): void { try { this.veille?.w.close(); } catch { /* déjà fermée */ } this.veille = null; if (this.cache) this.cache.at = 0; }
  /** Combien de temps la liste des notes peut servir sans tout re-vérifier (0 : relire maintenant). */
  private validite(): number {
    const v = this.veille;
    if (!v) return 3000;
    if (v.sale) return 0;
    if (!v.prouvee) return 3000;
    // Le dossier a été déplacé ou remplacé (même chemin, autre dossier) : la surveillance suit l'ancien ; on la refait.
    if (identiteDossier(this.root) !== v.identite) { try { v.w.close(); } catch { /* */ } this.veille = undefined; return 0; }
    return RELECTURE_SECURITE_MS;
  }

  /** Chemin réel d'une note, toujours DANS le coffre (pas de « ../ »). */
  abs(path: string): string {
    const clean = path.replace(/\\/g, '/').replace(/^\/+/, '');
    const full = join(this.root, clean.endsWith('.md') ? clean : `${clean}.md`);
    const rel = relative(this.root, full);
    if (rel.startsWith('..') || rel.split(sep).some((p) => p === TRASH && !path.startsWith(TRASH))) throw new Error('chemin hors du Cerveau');
    return full;
  }

  /** Toutes les notes (mises en cache 3 s : le graphe et la recherche relisent souvent). */
  all(force = false): Note[] {
    if (!force && this.cache && Date.now() - this.cache.at < this.validite()) return this.cache.notes;
    const v = this.veille;
    if (v) v.sale = false; // posé AVANT la relecture : un changement pendant la relecture la refera la fois suivante
    const notes: Note[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > 8) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (e.isFile() && extname(e.name) === '.md' && notes.length < 20_000) {
          const st = statSync(p), rel = relative(this.root, p).split(sep).join('/');
          // Rien n'a bougé depuis la dernière lecture : la note déjà lue sert (le Cerveau répond vite, même gros).
          const old = this.known.get(rel);
          if (old && old.mtime === st.mtimeMs && old.size === st.size) { notes.push(old); continue; }
          const text = st.size < 2_000_000 ? readFileSync(p, 'utf8') : '';
          const { meta, body } = parseNote(text);
          notes.push({ path: rel, title: String(meta.titre ?? meta.title ?? basename(e.name, '.md')), meta, body, links: extractLinks(body), tags: extractTags(body, meta), mtime: st.mtimeMs, size: st.size });
        }
      }
    };
    walk(this.root, 0);
    this.known = new Map(notes.map((n) => [n.path, n]));
    // Si rien n'a bougé (mêmes objets-notes, même ordre), on RÉUTILISE le tableau précédent : l'index de
    // recherche, construit par identité de ce tableau (voir search()), n'est alors PAS reconstruit à froid
    // entre deux demandes espacées de plus de 3 s. Comparaison par identité, faite au plus une fois par 3 s.
    const prev = this.cache?.notes;
    const inchange = !!prev && prev.length === notes.length && prev.every((n, i) => n === notes[i]);
    this.cache = { at: Date.now(), notes: inchange ? prev! : notes };
    this.surveiller(notes.length);
    return this.cache.notes;
  }
  /**
   * Après une écriture d'Odin : la liste est refaite, et la note écrite est relue pour de bon (réécrite dans la même
   * milliseconde, elle garderait sa date et sa taille). Les autres notes restent connues : elles sont revalidées par leur
   * date et leur taille comme d'habitude, au lieu d'être toutes relues et réanalysées (1,5 s à 2 000 notes).
   * Sans chemin (renommage qui touche d'autres notes, restauration) : tout est oublié, comme avant.
   */
  private invalidate(...chemins: string[]) {
    this.cache = undefined; this.idx = undefined;
    if (!chemins.length) { this.known.clear(); return; }
    for (const c of chemins) this.known.delete(c);
  }

  /** Trouve une note par chemin, nom de fichier ou titre (comme les liens d'Obsidian). */
  find(ref: string): Note | undefined {
    const k = noteKey(ref.split('/').pop() ?? ref), path = ref.replace(/\.md$/, '');
    const notes = this.all();
    if (this.idx?.notes !== notes) {
      // La première note qui porte ce chemin, ce nom de fichier ou ce titre (même ordre qu'avant l'index).
      const byPath = new Map<string, Note>(), byKey = new Map<string, Note>();
      for (const n of notes) {
        const p = n.path.replace(/\.md$/, ''); if (!byPath.has(p)) byPath.set(p, n);
        for (const key of [noteKey(basename(n.path)), noteKey(n.title)]) if (!byKey.has(key)) byKey.set(key, n);
      }
      this.idx = { notes, byPath, byKey };
    }
    return this.idx.byPath.get(path) ?? this.idx.byKey.get(k);
  }

  read(path: string): Note | undefined { return this.find(path); }

  /** Crée ou remplace une note (écriture atomique). Renvoie son chemin. */
  write(path: string, meta: NoteMeta, body: string, o: { quiet?: boolean } = {}): string {
    const full = this.abs(path);
    mkdirSync(dirname(full), { recursive: true });
    const tmp = `${full}.odin-tmp`;
    writeFileSync(tmp, formatNote(meta, body));
    const existed = existsSync(full);
    renameSync(tmp, full);
    const rel = relative(this.root, full).split(sep).join('/');
    this.invalidate(rel);
    // `quiet` : écriture d'entretien (fiches tenues par Odin) qui ne doit pas déclencher les automatisations « note créée ».
    if (!o.quiet) vaultEvents.emit('change', { kind: existed ? 'modifiée' : 'créée', path: rel, title: String(meta.titre ?? meta.title ?? basename(rel, '.md')), type: String(meta.type ?? 'note') });
    return rel;
  }

  /** Nouvelle note d'un type (dans son dossier), titre unique. */
  create(title: string, type = 'note', body = '', extra: NoteMeta = {}): string {
    const t = TYPES[type] ?? TYPES.note;
    let name = safeName(title), k = 2;
    while (existsSync(this.abs(join(t.folder, name)))) name = `${safeName(title)} ${k++}`;
    const meta: NoteMeta = { ...(type !== 'note' ? { type } : {}), créé: today(), ...(t.statuses ? { statut: t.statuses[0] } : {}), ...extra };
    return this.write(t.folder ? `${t.folder}/${name}` : name, meta, body);
  }

  /** Ajoute du texte à la fin d'une note (sous un titre de section si donné, créé au besoin). */
  append(path: string, text: string, section?: string): string {
    const n = this.find(path);
    if (!n) throw new Error(`note introuvable : ${path}`);
    let body = n.body.replace(/\s+$/, '');
    if (section) {
      const re = new RegExp(`^(#{1,6})\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mi');
      const m = re.exec(body);
      if (m) {
        const after = body.slice(m.index + m[0].length);
        const next = new RegExp(`^#{1,${m[1].length}}\\s`, 'm').exec(after);
        const at = m.index + m[0].length + (next ? next.index : after.length);
        body = `${body.slice(0, at).replace(/\s+$/, '')}\n${text}\n${body.slice(at) ? `\n${body.slice(at).replace(/^\n+/, '')}` : ''}`;
      } else body = `${body}\n\n## ${section}\n${text}`;
    } else body = `${body}\n\n${text}`;
    return this.write(n.path, n.meta, `${body.replace(/\s+$/, '')}\n`);
  }

  /** Renomme ou déplace une note ; tous les liens [[ancien]] des autres notes suivent. */
  rename(path: string, newPath: string): string {
    const n = this.find(path);
    if (!n) throw new Error(`note introuvable : ${path}`);
    const from = this.abs(n.path), to = this.abs(newPath);
    if (existsSync(to)) throw new Error('une note porte déjà ce nom');
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
    const oldName = basename(n.path, '.md'), newName = basename(to, '.md');
    this.invalidate();
    vaultEvents.emit('renommée', { ancien: n.path, nouveau: relative(this.root, to).split(sep).join('/') }); // les liens vivants suivent (pas « change »)
    let changed = 0;
    if (oldName !== newName) {
      const re = new RegExp(`(!?\\[\\[)${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}((?:[#^][^\\]|]*)?(?:\\|[^\\]]*)?\\]\\])`, 'gi');
      for (const o of this.all(true)) {
        const text = readFileSync(join(this.root, o.path), 'utf8');
        const next = text.replace(re, `$1${newName}$2`);
        if (next !== text) { writeFileSync(join(this.root, o.path), next); changed++; }
      }
      this.invalidate();
    }
    return `${relative(this.root, to).split(sep).join('/')}${changed ? ` (liens mis à jour dans ${changed} note${changed > 1 ? 's' : ''})` : ''}`;
  }

  /** Corbeille : la note est déplacée dans .corbeille/ (restaurable), jamais effacée. `quiet` : rangement fait par Odin lui-même, sans réveiller les automatisations. */
  trash(path: string, o: { quiet?: boolean } = {}): string {
    const n = this.find(path);
    if (!n) throw new Error(`note introuvable : ${path}`);
    const dest = join(this.root, TRASH, `${Date.now()}-${basename(n.path)}`);
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(join(this.root, n.path), dest);
    this.invalidate(n.path);
    if (!o.quiet) vaultEvents.emit('change', { kind: 'corbeille', path: n.path, title: n.title, type: String(n.meta.type ?? 'note') });
    return relative(this.root, dest);
  }
  trashed(): string[] { const d = join(this.root, TRASH); return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.md')).sort().reverse() : []; }
  restore(file: string): string {
    const src = join(this.root, TRASH, basename(file));
    if (!existsSync(src)) throw new Error('introuvable dans la corbeille');
    let name = basename(file).replace(/^\d+-/, ''), dest = join(this.root, name), k = 2;
    while (existsSync(dest)) { name = `${basename(name, '.md')} ${k++}.md`; dest = join(this.root, name); }
    renameSync(src, dest);
    this.invalidate(relative(this.root, dest).split(sep).join('/'));
    return name;
  }

  /** Notes qui pointent vers celle-ci (liens écrits). */
  backlinks(path: string): Note[] {
    const n = this.find(path);
    if (!n) return [];
    const keys = new Set([noteKey(basename(n.path)), noteKey(n.title)]);
    return this.all().filter((o) => o.path !== n.path && o.links.some((l) => keys.has(noteKey(l.split('/').pop() ?? l))));
  }

  /** Notes qui parlent de celle-ci sans lien (mentions du titre) : liens à ajouter d'un geste. */
  unlinkedMentions(path: string): Note[] {
    const n = this.find(path);
    if (!n || n.title.length < 3) return [];
    const re = new RegExp(`(^|[^\\p{L}\\[])${n.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\]])`, 'iu');
    const linked = new Set(this.backlinks(path).map((o) => o.path));
    return this.all().filter((o) => o.path !== n.path && !linked.has(o.path) && re.test(o.body)).slice(0, 30);
  }

  /** Graphe : liens écrits, mentions devinées, étiquettes partagées, sources (connecteurs). */
  graph(o: { center?: string; depth?: number; guessed?: boolean } = {}): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const notes = this.all();
    const byKey = new Map<string, Note>();
    for (const n of notes) { byKey.set(noteKey(basename(n.path)), n); byKey.set(noteKey(n.title), n); }
    const edges: GraphEdge[] = [], seen = new Set<string>();
    const add = (from: string, to: string, kind: GraphEdge['kind']) => { const k = [from, to].sort().join('→'); if (from === to || seen.has(k)) return; seen.add(k); edges.push({ from, to, kind }); };
    for (const n of notes) for (const l of n.links) { const t = byKey.get(noteKey(l.split('/').pop() ?? l)); if (t) add(n.path, t.path, 'lien'); }
    if (o.guessed !== false) {
      // Mentions d'un titre (≥ 4 lettres) dans une autre note : lien deviné, sans rien écrire.
      const titled = notes.filter((n) => n.title.length >= 4 && n.meta.type !== 'journal').slice(0, 800);
      for (const n of notes) {
        const low = n.body.toLowerCase();
        for (const t of titled) if (t.path !== n.path && low.includes(t.title.toLowerCase())) add(n.path, t.path, 'mention');
      }
      // Même étiquette rare (≤ 6 notes) : proches.
      const byTag = new Map<string, string[]>();
      for (const n of notes) for (const t of n.tags) byTag.set(t, [...(byTag.get(t) ?? []), n.path]);
      for (const list of byTag.values()) if (list.length >= 2 && list.length <= 6) for (let i = 1; i < list.length; i++) add(list[0], list[i], 'étiquette');
    }
    // Connecteurs : chaque capture est reliée à sa source (YouTube, Telegram, Gmail, web…).
    const sources = new Map<string, number>();
    for (const n of notes) { const src = sourceOf(n); if (src) { sources.set(src, (sources.get(src) ?? 0) + 1); add(n.path, `source:${src}`, 'source'); } }
    let nodes: GraphNode[] = notes.map((n) => ({ id: n.path, title: n.title, type: String(n.meta.type ?? (n.path.startsWith('Journal/') ? 'journal' : 'note')), tags: n.tags.slice(0, 8), degree: 0, folder: dirname(n.path) === '.' ? '' : dirname(n.path), source: sourceOf(n), excerpt: excerptOf(n.body), mtime: n.mtime }));
    for (const [s] of sources) nodes.push({ id: `source:${s}`, title: s, type: 'connecteur', tags: [], degree: 0, folder: '' });
    const deg = new Map<string, number>();
    for (const e of edges) { deg.set(e.from, (deg.get(e.from) ?? 0) + 1); deg.set(e.to, (deg.get(e.to) ?? 0) + 1); }
    for (const n of nodes) n.degree = deg.get(n.id) ?? 0;
    if (o.center) {
      const c = this.find(o.center)?.path ?? o.center;
      const keep = new Set([c]);
      for (let d = 0; d < (o.depth ?? 1); d++) for (const e of edges) { if (keep.has(e.from)) keep.add(e.to); else if (keep.has(e.to)) keep.add(e.from); }
      nodes = nodes.filter((n) => keep.has(n.id));
      return { nodes, edges: edges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
    }
    return { nodes, edges };
  }

  /** Recherche classée : titre, étiquettes, propriétés, texte ; extrait autour du mot trouvé. */
  search(q: string, limit = 20): Array<{ note: Note; score: number; snippet: string }> {
    const words = noteKey(q).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
    if (!words.length) return [];
    const notes = this.all();
    // Index inversé « mot → notes » : on ne classe plus que les notes candidates au lieu de balayer TOUT le
    // Cerveau (85-97 ms → quelques ms). Reconstruit seulement quand la liste des notes change (donc jamais
    // entre deux demandes rapprochées). Résultat identique : les notes écartées auraient eu un score nul.
    if (this.rech?.notes !== notes) {
      // Mise à jour de l'index au lieu de tout reconstruire : seules les notes nouvelles, changées (autre objet) ou
      // parties sont touchées (une note écrite = une note réindexée, pas 2 000). Index identique à une reconstruction.
      if (this.rech) {
        const { index } = this.rech, avant = new Map(this.rech.notes.map((n) => [n.path, n])), ici = new Set<string>();
        for (const n of notes) { ici.add(n.path); if (avant.get(n.path) !== n) index.indexer(n); }
        for (const p of avant.keys()) if (!ici.has(p)) index.retirer(p);
        this.rech = { notes, index };
      } else { const index = new IndexNotes(); index.construire(notes); this.rech = { notes, index }; }
    }
    const now = Date.now();
    const out: Array<{ note: Note; score: number; hit: number }> = [];
    for (const n of this.rech.index.candidats(q)) {
      const { title, body, props, tags } = folded(n);
      let score = 0, hit = -1;
      for (const w of words) {
        if (title.includes(w)) score += 10;
        if (tags.includes(w)) score += 5;
        if (props.includes(w)) score += 3;
        const i = body.indexOf(w);
        if (i >= 0) { score += 2 + Math.min(3, occurrences(body, w) - 1); if (hit < 0) hit = i; }
      }
      if (!score) continue;
      if (words.every((w) => title.includes(w) || body.includes(w))) score += 5;
      score += Math.max(0, 3 - (now - n.mtime) / (30 * 86_400_000)); // récentes un peu devant
      out.push({ note: n, score, hit });
    }
    // L'extrait n'est fabriqué que pour les notes rendues (avant : pour chaque candidate, souvent des centaines).
    return out.sort((a, b) => b.score - a.score).slice(0, limit).map(({ note: n, score, hit }) => {
      const raw = n.body.replace(/\s+/g, ' ');
      const at = hit >= 0 ? Math.max(0, hit - 60) : 0;
      return { note: n, score, snippet: `${at > 0 ? '…' : ''}${raw.slice(at, at + 200).trim()}${raw.length > at + 200 ? '…' : ''}` };
    });
  }

  /** Toutes les notes d'un type (une « base ») avec leurs propriétés. */
  database(type: string): Array<{ path: string; title: string; meta: NoteMeta; mtime: number }> {
    return this.all().filter((n) => String(n.meta.type ?? '') === type || (type === 'journal' && n.path.startsWith('Journal/'))).map((n) => ({ path: n.path, title: n.title, meta: n.meta, mtime: n.mtime })).sort((a, b) => b.mtime - a.mtime);
  }

  /** Note du jour (Journal/AAAA-MM-JJ.md), créée au besoin. */
  daily(date = new Date()): string {
    const d = isoDay(date), p = `Journal/${d}`;
    if (!this.find(p)) this.write(p, { type: 'journal', date: d }, `# ${date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}\n\n## Notes\n\n## Fait aujourd'hui\n`);
    return `${p}.md`;
  }

  /** Mémoire d'un projet : objectifs, décisions, contraintes (sections de la note du projet). */
  projectMemory(project: string, kind: 'objectif' | 'décision' | 'contrainte' | 'note', text: string): string {
    let n = this.find(project) ?? this.find(`Projets/${project}`);
    if (!n) { this.create(project, 'projet', '## Objectifs\n\n## Décisions\n\n## Contraintes\n\n## Notes\n'); n = this.find(`Projets/${safeName(project)}`)!; }
    const section = { objectif: 'Objectifs', décision: 'Décisions', contrainte: 'Contraintes', note: 'Notes' }[kind];
    return this.append(n.path, `- ${kind === 'décision' ? `${isoDay(new Date())} · ` : ''}${text}`, section);
  }

  /** Ce qui mérite ton attention (pour la proactivité) : tâches en retard ou proches, projets à l'arrêt. */
  attention(now = Date.now()): Array<{ kind: 'retard' | 'bientôt' | 'à l\'arrêt'; title: string; path: string; when?: string }> {
    const out: Array<{ kind: 'retard' | 'bientôt' | 'à l\'arrêt'; title: string; path: string; when?: string }> = [];
    const done = /^(fait|terminé|terminée|annulé|abandonné)$/i;
    for (const n of this.all()) {
      const st = String(n.meta.statut ?? '');
      const due = Date.parse(String(n.meta.échéance ?? n.meta.echeance ?? n.meta.due ?? ''));
      if (!Number.isNaN(due) && !done.test(st)) {
        if (due < now - 86_400_000 / 2) out.push({ kind: 'retard', title: n.title, path: n.path, when: String(n.meta.échéance ?? n.meta.echeance) });
        else if (due < now + 2 * 86_400_000) out.push({ kind: 'bientôt', title: n.title, path: n.path, when: String(n.meta.échéance ?? n.meta.echeance) });
      }
      if (n.meta.type === 'projet' && /en cours/i.test(st) && now - n.mtime > 14 * 86_400_000) out.push({ kind: 'à l\'arrêt', title: n.title, path: n.path, when: new Date(n.mtime).toISOString().slice(0, 10) });
    }
    const rank = { retard: 0, bientôt: 1, "à l'arrêt": 2 } as Record<string, number>;
    return out.sort((a, b) => rank[a.kind] - rank[b.kind]).slice(0, 20);
  }

  /** Statistiques pour le schéma de fonctionnement (capturer → relier → retrouver → agir). */
  stats(): { notes: number; links: number; guessed: number; tags: number; captures: number; projects: number; sources: string[]; updatedToday: number } {
    const g = this.graph();
    const notes = this.all();
    return {
      notes: notes.length,
      links: g.edges.filter((e) => e.kind === 'lien').length,
      guessed: g.edges.filter((e) => e.kind === 'mention' || e.kind === 'étiquette').length,
      tags: new Set(notes.flatMap((n) => n.tags)).size,
      captures: notes.filter((n) => n.meta.type === 'capture').length,
      projects: notes.filter((n) => n.meta.type === 'projet').length,
      sources: [...new Set(notes.map(sourceOf).filter(Boolean) as string[])],
      updatedToday: notes.filter((n) => n.mtime > Date.now() - 86_400_000).length,
    };
  }
}

/** D'où vient une note (connecteur) : propriété « source », ou deviné du lien. Pur. */
export function sourceOf(n: { meta: NoteMeta }): string | undefined {
  const s = String(n.meta.source ?? n.meta.lien ?? n.meta.url ?? '').toLowerCase();
  if (!s) return undefined;
  if (/youtu\.?be/.test(s)) return 'YouTube';
  if (/tiktok/.test(s)) return 'TikTok';
  if (/instagram/.test(s)) return 'Instagram';
  if (/(^|\.)x\.com|twitter/.test(s)) return 'X';
  if (/facebook|fb\.watch/.test(s)) return 'Facebook';
  if (/github/.test(s)) return 'GitHub';
  if (/notion\.so|notion\.site/.test(s)) return 'Notion';
  if (/automatisation|n8n/.test(s)) return 'Automatisation';
  if (/telegram/.test(s)) return 'Telegram';
  if (/whatsapp/.test(s)) return 'WhatsApp';
  if (/signal/.test(s)) return 'Signal';
  if (/mail|gmail|courriel/.test(s)) return 'Mail';
  if (/agenda|calendar/.test(s)) return 'Agenda';
  if (/vocal|voix/.test(s)) return 'Vocal';
  if (/fichier|pdf|document/.test(s)) return 'Fichiers';
  if (/discussion|odin/.test(s)) return 'Discussion';
  if (/^https?:/.test(s)) return 'Web';
  return s.length <= 20 ? s[0].toUpperCase() + s.slice(1) : undefined;
}

export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => isoDay(new Date());

/** Première installation : coffre d'accueil (explique le fonctionnement) et fiches existantes reprises. */
export function seedVault(v: Vault, oldNotesDir?: string): number {
  let n = 0;
  if (!v.all(true).length) {
    v.write('Bienvenue dans ton Cerveau', { type: 'note', tags: ['cerveau'] }, `# Ton deuxième cerveau

Tout ce que tu confies à Odin arrive ici : idées, projets, personnes, réunions, captures (liens, vidéos, documents, vocaux), et son journal.

## Comment ça marche
1. **Capturer** : envoie un lien, une vidéo, un document, un vocal ou une idée (« garde ça », « note que… »). Odin résume, étiquette et range.
2. **Relier** : les notes se relient toutes seules (mêmes sujets, mêmes personnes, mêmes projets). Écris [[le nom d'une note]] pour un lien direct.
3. **Retrouver** : cherche en langage naturel, même une info ancienne.
4. **Raisonner** : demande au cerveau ; Odin répond à partir de tes notes et montre ses sources dans le graphe.
5. **Agir** : Odin s'en sert pour organiser, rédiger, planifier, rappeler et automatiser.

Ces fichiers sont du Markdown simple : tu peux ouvrir ce dossier avec Obsidian, c'est le même coffre.
`);
    n++;
  }
  if (oldNotesDir && existsSync(oldNotesDir)) {
    for (const f of readdirSync(oldNotesDir).filter((x) => x.endsWith('.md'))) {
      const dest = `Fiches/${basename(f, '.md')}`;
      if (v.find(dest)) continue;
      const { meta, body } = parseNote(readFileSync(join(oldNotesDir, f), 'utf8'));
      v.write(dest, { type: 'fiche', ...meta }, body);
      n++;
    }
  }
  return n;
}
