// Importer les compétences d'Hermes (ou de tout agent au format SKILL.md) : depuis un dossier de
// cette machine, d'une machine du réseau, ou d'un conteneur Proxmox. Chaque compétence est analysée
// (consignes cachées, secrets, commandes destructrices) puis proposée à Odin avec ses scripts.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { findMachine, runOnMachine } from '../machines/access.ts';
import { scanCode } from '../scripts/guard.ts';
import { parseSkill } from '../yggdrasil/skills.ts';
import { obj, str, type Tool, type ToolContext } from './registry.ts';

const s = (v: unknown) => String(v ?? '');
export const HERMES_SKILLS = '/root/.hermes/skills';

/** Source d'import (pur, testable) : dossier local, machine:chemin, pct:N, pct:N@hôte-proxmox. */
export function parseSource(src: string): { kind: 'local' | 'machine' | 'pct'; path: string; machine?: string; ct?: string } {
  const x = src.trim();
  let m = /^pct:(\d+)(?:@([\w.-]+))?(?::(\/.*))?$/.exec(x);
  if (m) return { kind: 'pct', ct: m[1], machine: m[2], path: m[3] ?? HERMES_SKILLS };
  m = /^machine:([\w.-]+)(?::(\/.*))?$/.exec(x);
  if (m) return { kind: 'machine', machine: m[1], path: m[2] ?? HERMES_SKILLS };
  return { kind: 'local', path: x || HERMES_SKILLS };
}

const untar = (data: Buffer, dir: string) => new Promise<void>((res, rej) => {
  const p = spawn('tar', ['xzf', '-', '-C', dir, '--no-same-owner', '--no-same-permissions']);
  p.on('error', rej); p.on('close', (c) => (c === 0 ? res() : rej(new Error(`archive illisible (tar ${c})`))));
  p.stdin.end(data);
});
const capture = (cmd: string, args: string[]) => new Promise<Buffer>((res, rej) => {
  const p = spawn(cmd, args), out: Buffer[] = []; let err = '';
  p.stdout.on('data', (d) => out.push(d)); p.stderr.on('data', (d) => { err += d; });
  p.on('error', rej); p.on('close', (c) => (c === 0 ? res(Buffer.concat(out)) : rej(new Error(err.trim().slice(0, 200) || `code ${c}`))));
});

/** Copie le dossier de compétences de la source dans un dossier temporaire. */
async function fetchSkills(src: ReturnType<typeof parseSource>, ctx: ToolContext): Promise<{ dir: string; cleanup: () => void }> {
  if (src.kind === 'local') { if (!existsSync(src.path)) throw new Error(`dossier introuvable : ${src.path}`); return { dir: src.path, cleanup: () => undefined }; }
  const tmp = mkdtempSync(join(tmpdir(), 'odin-skills-')), cleanup = () => rmSync(tmp, { recursive: true, force: true });
  const tarCmd = `tar czf - -C ${JSON.stringify(src.path)} .`;
  try {
    let data: Buffer;
    if (src.kind === 'pct' && !src.machine) data = await capture('pct', ['exec', src.ct!, '--', 'sh', '-c', tarCmd]);
    else {
      if (!ctx.home) throw new Error('machines indisponibles ici');
      const m = findMachine(ctx.home, src.machine!); if (!m) throw new Error(`machine inconnue : ${src.machine} (Réglages → Droits et machines)`);
      const r = await runOnMachine(ctx.home, m, src.kind === 'pct' ? `pct exec ${src.ct} -- sh -c '${tarCmd}'` : tarCmd, { binary: true, timeoutMs: 120_000, signal: ctx.signal });
      if (r.code !== 0 || !r.data?.length) throw new Error(`copie impossible : ${r.out.slice(0, 200)}`);
      data = r.data;
    }
    await untar(data, tmp);
    return { dir: tmp, cleanup };
  } catch (e) { cleanup(); throw e; }
}

/** Tous les SKILL.md d'un dossier (à toute profondeur, catégories comprises). */
export function findSkillFiles(dir: string, depth = 0): string[] {
  if (depth > 5) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...findSkillFiles(p, depth + 1));
    else if (/^SKILL\.md$/i.test(e.name)) out.push(p);
  }
  return out;
}
export const kebab = (n: string) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** Analyse puis propose chaque compétence trouvée (avec ses scripts). */
export function importFrom(dir: string, ctx: ToolContext, origin: string): { imported: string[]; refused: string[]; same: string[] } {
  const imported: string[] = [], refused: string[] = [], same: string[] = [];
  for (const f of findSkillFiles(dir)) {
    const sk = parseSkill(readFileSync(f, 'utf8'));
    const name = kebab(sk.name || basename(dirname(f)));
    if (name.length < 2) { refused.push(`${relative(dir, f)} : sans nom`); continue; }
    const folder = dirname(f);
    const files = readdirSync(folder, { withFileTypes: true }).flatMap((e) => {
      const sub = join(folder, e.name);
      const pick = (p: string) => (/\.(py|sh|mjs)$/.test(p) && statSync(p).size < 200_000 ? [{ name: basename(p), content: readFileSync(p, 'utf8') }] : []);
      if (e.isFile()) return pick(sub);
      if (e.isDirectory() && /^(scripts?|bin|tools)$/.test(e.name)) return readdirSync(sub).flatMap((x) => pick(join(sub, x)));
      return [];
    }).filter((x) => /^[a-z0-9][a-z0-9_-]{1,47}\.(py|sh|mjs)$/.test(x.name.toLowerCase())).map((x) => ({ ...x, name: x.name.toLowerCase().replace(/_/g, '-') }));
    const scan = scanCode(`${sk.body}\n${files.map((x) => x.content).join('\n')}`);
    if (scan.refuse) { refused.push(`${name} : ${scan.refuse}`); continue; }
    const cur = ctx.skills.get(name);
    if (cur && cur.body.includes(sk.body.trim().slice(0, 200))) { same.push(name); continue; }
    const body = `> Importée de ${origin}. Outils d'Hermes → ceux d'Odin : terminal → shell ou script_run ; recherche → web_search / web_research ; mémoire → memory_search.\n\n${sk.body}`;
    try { ctx.skills.propose({ name, description: sk.description || `compétence importée de ${origin}`, body: ctx.redactor.redact(body), reason: `importée de ${origin}${scan.warnings.length ? ` — ⚠ ${scan.warnings.join(' ; ')}` : ''}`, files, origin: 'hermes' }); imported.push(name); }
    catch (e) { refused.push(`${name} : ${(e as Error).message}`); }
  }
  return { imported, refused, same };
}

export const skillImport: Tool = {
  name: 'skill_import',
  description: `Importe les compétences d'Hermes (ou d'un autre agent au format SKILL.md) avec leurs scripts. Source : dossier de cette machine (défaut ${HERMES_SKILLS}), « machine:<nom>[:/chemin] », « pct:<n°> » (conteneur Proxmox de cette machine) ou « pct:<n°>@<hôte Proxmox> ». Chaque compétence est analysée puis proposée (brouillon à valider, ou active selon le réglage d'apprentissage).`,
  risk: 'network',
  schema: obj({ source: str('où sont les compétences') }, ['source']),
  summarize: (i) => `importer les compétences de ${s(i.source)}`,
  async run(i, ctx) {
    const src = parseSource(s(i.source));
    const { dir, cleanup } = await fetchSkills(src, ctx);
    try {
      const r = importFrom(dir, ctx, `Hermes (${s(i.source)})`);
      // Réglage d'apprentissage : actives tout de suite (toujours, ou en mode Breaker), sinon brouillons.
      const auto = ctx.careCfg?.learning.autoApproveSkills;
      if (auto === 'always' || (auto === 'breaker' && ctx.breaker)) for (const n of r.imported) { try { ctx.skills.approve(n); } catch { /* reste en brouillon */ } }
      return `${r.imported.length} compétence(s) importée(s)${r.imported.length ? ` : ${r.imported.join(', ')}` : ''}.${r.same.length ? `\nDéjà là (identiques) : ${r.same.join(', ')}.` : ''}${r.refused.length ? `\nRefusées par l'analyse : ${r.refused.join(' ; ')}.` : ''}\nElles sont dans Compétences (brouillons à valider en un clic, « Tout approuver »).`;
    } finally { cleanup(); }
  },
};
