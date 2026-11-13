// Athéna — l'arbre des compétences (skills).
// Format SKILL.md compatible avec le standard ouvert agentskills.io : un dossier par
// compétence, frontmatter `name` + `description`, puis le corps.
//
// Principes :
// - Divulgation progressive : seul l'index (nom + description) va dans le prompt ;
//   le corps est chargé à la demande via l'outil skill_read → moins de jetons par tour.
// - Apprentissage SÛR : Odin peut proposer ou améliorer une compétence, mais elle arrive
//   en BROUILLON (_drafts/). Un humain l'approuve (`odin skills approve`) : une injection
//   lue sur le web ne peut pas devenir une compétence permanente.
// - Versionnage avec historique et retour arrière (`odin skills rollback`).

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanForInjection } from '../heimdall/injection.ts';

export interface Skill {
  name: string;
  description: string;
  version: number;
  origin: string;
  status: 'active' | 'draft';
  body: string;
  meta: Record<string, string>;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

export function parseSkill(text: string): Skill {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const meta: Record<string, string> = {};
  const body = m ? m[2] : text;
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
    }
  }
  return {
    name: meta.name ?? '',
    description: meta.description ?? '',
    version: Number(meta.version ?? 1) || 1,
    origin: meta.origin ?? 'human',
    status: meta.status === 'draft' ? 'draft' : 'active',
    body: body.trim(),
    meta,
  };
}

export function renderSkill(s: Skill): string {
  const meta: Record<string, string> = { ...s.meta, name: s.name, description: s.description, version: String(s.version), origin: s.origin, status: s.status };
  const head = Object.entries(meta).map(([k, v]) => `${k}: ${String(v).replace(/\n/g, ' ')}`).join('\n');
  return `---\n${head}\n---\n\n${s.body.trim()}\n`;
}

export class Athena {
  readonly dir: string;
  readonly draftsDir: string;
  /** Signature des compétences validées (un fichier modifié en dehors d'Odin est détecté). */
  signer?: { sign(content: string): string; verify(content: string, sig?: string): boolean };
  constructor(dir: string, draftsDir: string) {
    this.dir = dir; this.draftsDir = draftsDir;
    mkdirSync(dir, { recursive: true });
    mkdirSync(draftsDir, { recursive: true });
  }

  private file(name: string, draft = false): string {
    if (!NAME_RE.test(name)) throw new Error(`Nom de compétence invalide : « ${name} » (minuscules, chiffres, tirets)`);
    return join(draft ? this.draftsDir : this.dir, name, 'SKILL.md');
  }

  private scan(dir: string, status: 'active' | 'draft'): Skill[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && NAME_RE.test(d.name) && !d.name.startsWith('_'))
      .map((d) => join(dir, d.name, 'SKILL.md'))
      .filter((f) => existsSync(f))
      .map((f) => ({ ...parseSkill(readFileSync(f, 'utf8')), status }));
  }

  list(): Skill[] { return this.scan(this.dir, 'active'); }
  drafts(): Skill[] { return this.scan(this.draftsDir, 'draft'); }

  get(name: string): Skill | undefined {
    const f = this.file(name);
    return existsSync(f) ? parseSkill(readFileSync(f, 'utf8')) : undefined;
  }

  getDraft(name: string): Skill | undefined {
    const f = this.file(name, true);
    return existsSync(f) ? { ...parseSkill(readFileSync(f, 'utf8')), status: 'draft' } : undefined;
  }

  /** Index compact injecté dans le prompt système. */
  index(): string {
    const skills = this.list().filter((s) => this.intact(s.name));
    if (!skills.length) return '';
    return skills.map((s) => `- ${s.name} : ${s.description}`).join('\n');
  }

  /** Odin propose une compétence (nouvelle ou amélioration) : toujours un brouillon. */
  propose(p: { name: string; description: string; body: string; reason: string; tainted?: boolean; files?: Array<{ name: string; content: string }>; origin?: string; params?: string }): { path: string; improves: boolean; warnings: string[] } {
    const path = this.file(p.name, true);
    const current = this.get(p.name);
    const warnings = scanForInjection(p.body + '\n' + p.description).matches;
    if (p.tainted) warnings.push('proposée après lecture de contenu non fiable');
    const skill: Skill = {
      name: p.name,
      description: p.description.slice(0, 200),
      version: (current?.version ?? 0) + 1,
      origin: p.origin ?? 'odin',
      status: 'draft',
      body: p.body,
      meta: { reason: p.reason.slice(0, 300), proposed_at: new Date().toISOString(), ...(p.params ? { params: p.params.slice(0, 200) } : current?.meta.params ? { params: current.meta.params } : {}), ...(warnings.length ? { warnings: warnings.join(' | ') } : {}) },
    };
    mkdirSync(join(this.draftsDir, p.name), { recursive: true });
    writeFileSync(path, renderSkill(skill));
    // Scripts fournis avec la compétence (dossier scripts/).
    for (const f of p.files ?? []) {
      if (!/^[\w.-]{1,80}$/.test(f.name)) continue;
      mkdirSync(join(this.draftsDir, p.name, 'scripts'), { recursive: true });
      writeFileSync(join(this.draftsDir, p.name, 'scripts', f.name), f.content);
    }
    return { path, improves: Boolean(current), warnings };
  }

  /** Validation humaine : le brouillon devient actif, l'ancienne version est archivée. */
  approve(name: string): Skill {
    const draft = this.getDraft(name);
    if (!draft) throw new Error(`Aucun brouillon nommé « ${name} »`);
    const target = this.file(name);
    const current = this.get(name);
    mkdirSync(join(this.dir, name, 'history'), { recursive: true });
    if (current) renameSync(target, join(this.dir, name, 'history', `v${current.version}.md`));
    const { reason: _r, proposed_at: _p, warnings: _w, ...meta } = draft.meta;
    const { sig: _s, ...rest } = meta;
    const active: Skill = { ...draft, status: 'active', meta: { ...rest, approved_at: new Date().toISOString(), ...(this.signer ? { sig: this.signer.sign(draft.body) } : {}) } };
    writeFileSync(target, renderSkill(active));
    if (existsSync(join(this.draftsDir, name, 'scripts'))) cpSync(join(this.draftsDir, name, 'scripts'), join(this.dir, name, 'scripts'), { recursive: true });
    rmSync(join(this.draftsDir, name), { recursive: true, force: true });
    return active;
  }

  /** Modifiée à la main par le propriétaire : nouvelle version active tout de suite (l'ancienne est archivée). */
  edit(name: string, o: { body: string; description?: string }): Skill {
    const cur = this.get(name); if (!cur) throw new Error(`Compétence inconnue : ${name}`);
    mkdirSync(join(this.dir, name, 'history'), { recursive: true });
    renameSync(this.file(name), join(this.dir, name, 'history', `v${cur.version}.md`));
    const next: Skill = { ...cur, version: cur.version + 1, description: (o.description ?? cur.description).slice(0, 200), body: o.body, origin: 'human', meta: { ...cur.meta, edited_at: new Date().toISOString(), ...(this.signer ? { sig: this.signer.sign(o.body) } : {}) } };
    writeFileSync(this.file(name), renderSkill(next));
    return next;
  }
  /** Compétence intacte ? (signée par Odin et pas modifiée depuis). Sans signature (ancienne) : signée maintenant. */
  intact(name: string): boolean {
    const s = this.get(name); if (!s || !this.signer) return true;
    if (!s.meta.sig) { writeFileSync(this.file(name), renderSkill({ ...s, meta: { ...s.meta, sig: this.signer.sign(s.body) } })); return true; }
    return this.signer.verify(s.body, s.meta.sig);
  }
  /** Fichiers fournis avec la compétence (scripts/). */
  files(name: string): Array<{ name: string; path: string }> {
    const d = join(this.dir, name, 'scripts');
    return existsSync(d) ? readdirSync(d).filter((f) => !f.startsWith('.')).map((f) => ({ name: f, path: join(d, f) })) : [];
  }
  /** Range une compétence qui ne sert plus (dossier _archive, récupérable). */
  archive(name: string): void {
    this.file(name);
    const src = join(this.dir, name); if (!existsSync(src)) throw new Error(`Compétence inconnue : ${name}`);
    mkdirSync(join(this.dir, '_archive'), { recursive: true });
    rmSync(join(this.dir, '_archive', name), { recursive: true, force: true });
    renameSync(src, join(this.dir, '_archive', name));
  }

  reject(name: string): void {
    this.file(name, true);
    rmSync(join(this.draftsDir, name), { recursive: true, force: true });
  }

  /** Revient à la version archivée la plus récente. */
  rollback(name: string): Skill {
    const hist = join(this.dir, name, 'history');
    if (!existsSync(hist)) throw new Error(`Pas d'historique pour « ${name} »`);
    const versions = readdirSync(hist).map((f) => Number(f.match(/^v(\d+)\.md$/)?.[1])).filter((n) => n > 0).sort((a, b) => b - a);
    if (!versions.length) throw new Error(`Pas d'historique pour « ${name} »`);
    const prev = join(hist, `v${versions[0]}.md`);
    renameSync(prev, this.file(name));
    return this.get(name)!;
  }
}

/** Remplace {{param}} par sa valeur (compétences avec réglages). Pur, testable. */
export function fillParams(body: string, params: Record<string, string>): string {
  return body.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (m, k: string) => (params[k] !== undefined ? params[k] : m));
}

/** Compétences qui semblent s'appliquer à une demande (mots en commun, sans accents). Pur, testable. */
export function relevantSkills(text: string, skills: Array<{ name: string; description: string }>, max = 3): string[] {
  const words = (x: string) => new Set(x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 3).map((w) => w.slice(0, 6)));
  const q = words(text);
  if (!q.size) return [];
  return skills.map((s) => { const w = words(`${s.name.replace(/-/g, ' ')} ${s.description}`); let n = 0; for (const x of q) if (w.has(x)) n++; return { name: s.name, score: n / Math.sqrt(w.size + 1) }; })
    .filter((x) => x.score >= 0.25).sort((a, b) => b.score - a.score).filter((x, _k, all) => x.score >= all[0].score * 0.65).slice(0, max).map((x) => x.name);
}

/** Petit diff ligne à ligne (LCS) pour relire un brouillon avant approbation. */
export function lineDiff(a: string, b: string): string {
  const A = a.split('\n'), B = b.split('\n');
  const n = A.length, m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const out: string[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push('  ' + A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push('- ' + A[i++]);
    else out.push('+ ' + B[j++]);
  }
  while (i < n) out.push('- ' + A[i++]);
  while (j < m) out.push('+ ' + B[j++]);
  return out.join('\n');
}
