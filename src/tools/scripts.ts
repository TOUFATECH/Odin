// Bibliothèque de scripts d'Odin : pour une mission, il écrit un script (Python, Bash, Node), le
// teste, le lance, le corrige s'il échoue, et le GARDE pour la prochaine fois.
//
// Tout est automatique, pour aller vite et sans friction :
// - Fiche par script : à quoi il sert, version, réussites, échecs, dernière erreur, durée moyenne,
//   historique des changements ; anciennes versions gardées (retour arrière possible).
// - Mode essai : variable ODIN_DRY_RUN=1 → le script montre ce qu'il ferait sans rien changer.
// - Test automatique : un test fourni avec le script est relancé à chaque nouvelle version ; une
//   version qui casse le test n'est PAS gardée (l'ancienne reste).
// - Module commun (scripts/lib : odin_lib.py, odin_lib.sh, odin_lib.mjs) : connexions, journal,
//   mode essai… importables par tous les scripts.
// - Où le lancer : machine d'Odin, machine du réseau (SSH), conteneur Proxmox (pct:7800), plusieurs
//   à la fois (« pct:7800,pct:7700,venus » ou « pct:all »), ou bac à sable jetable (Docker, sans réseau).
// - Sécurité : analyse avant enregistrement (secrets, commandes destructrices, envoi de données),
//   signature : un script modifié en dehors d'Odin est refusé.

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { findMachine, runOnMachine } from '../machines/access.ts';
import { scanCode, sign, verify } from '../scripts/guard.ts';
import { safeEnv } from './builtin.ts';
import { bool, num, obj, str, type Tool, type ToolContext } from './registry.ts';

const s = (v: unknown) => String(v ?? '');
export type Lang = 'python' | 'bash' | 'node';
const EXT: Record<Lang, string> = { python: 'py', bash: 'sh', node: 'mjs' };
const BIN: Record<Lang, string[]> = { python: ['python3', '-'], bash: ['bash', '-s', '--'], node: ['node', '--input-type=module', '-'] };
export interface ScriptMeta {
  name: string; lang: Lang; description: string; version: number; runs: number; ok: number; fails: number;
  lastError?: string; lastRun?: number; created: number; updated: number; changes: string[];
  sig?: string; warnings?: string[]; hasTest?: boolean; avgMs?: number; skill?: string;
  /** Durée moyenne par version (pour comparer). */
  perf?: Record<string, { runs: number; avgMs: number; ok: number }>;
}

export const scriptsDir = (ws: string) => join(ws, 'scripts');
export const libDir = (ws: string) => join(scriptsDir(ws), 'lib');
const NAME = /^[a-z0-9][a-z0-9_-]{1,47}$/;

// ---------------- Module commun ----------------

const LIB: Record<string, string> = {
  'odin_lib.py': `"""Module commun des scripts d'Odin : import odin_lib as odin"""
import os, subprocess, sys, json
DRY = os.environ.get("ODIN_DRY_RUN") == "1"
def log(*a): print("•", *a, flush=True)
def fail(msg, code=1): print("ÉCHEC :", msg, file=sys.stderr); sys.exit(code)
def run(cmd, check=True, change=True):
    """Lance une commande. En mode essai, une commande qui CHANGE quelque chose est seulement affichée."""
    if DRY and change: log("[essai] je lancerais :", cmd if isinstance(cmd, str) else " ".join(cmd)); return ""
    r = subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True)
    if check and r.returncode != 0: fail(f"{cmd} → {r.stderr.strip() or r.stdout.strip()}", r.returncode)
    return r.stdout
def pct(ctid, cmd, **kw): return run(["pct", "exec", str(ctid), "--", "bash", "-lc", cmd], **kw)
def pct_list():
    out = run(["pct", "list"], change=False).splitlines()[1:]
    return [{"id": l.split()[0], "status": l.split()[1], "name": l.split()[-1]} for l in out if l.strip()]
def result(**data): print("RÉSULTAT " + json.dumps(data, ensure_ascii=False))
`,
  'odin_lib.sh': `# Module commun des scripts d'Odin : source "$ODIN_LIB/odin_lib.sh"
set -o pipefail
log() { echo "• $*"; }
fail() { echo "ÉCHEC : $*" >&2; exit 1; }
# run CMD… : en mode essai (ODIN_DRY_RUN=1), affiche seulement la commande.
run() { if [ "\${ODIN_DRY_RUN:-0}" = 1 ]; then echo "• [essai] je lancerais : $*"; else "$@" || fail "$* (code $?)"; fi; }
pct_run() { local id="$1"; shift; run pct exec "$id" -- bash -lc "$*"; }
`,
  'odin_lib.mjs': `// Module commun des scripts d'Odin : import * as odin from \`\${process.env.ODIN_LIB}/odin_lib.mjs\`
import { execSync } from 'node:child_process';
export const DRY = process.env.ODIN_DRY_RUN === '1';
export const log = (...a) => console.log('•', ...a);
export const fail = (m) => { console.error('ÉCHEC :', m); process.exit(1); };
export const run = (cmd, { change = true } = {}) => { if (DRY && change) { log('[essai] je lancerais :', cmd); return ''; } return execSync(cmd, { encoding: 'utf8' }); };
`,
};
/** Crée le module commun s'il n'existe pas (Odin peut ensuite l'enrichir). */
export function ensureLib(ws: string): string {
  const d = libDir(ws); mkdirSync(d, { recursive: true });
  for (const [f, c] of Object.entries(LIB)) if (!existsSync(join(d, f))) writeFileSync(join(d, f), c);
  return d;
}

// ---------------- Fiches ----------------

export function listScripts(ws: string): ScriptMeta[] {
  const d = scriptsDir(ws);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(readFileSync(join(d, f), 'utf8')) as ScriptMeta; } catch { return undefined; } }).filter((x): x is ScriptMeta => Boolean(x)).sort((a, b) => (b.lastRun ?? b.updated) - (a.lastRun ?? a.updated));
}
export function readScript(ws: string, name: string): { meta: ScriptMeta; code: string; test?: string } | undefined {
  const d = scriptsDir(ws), m = join(d, `${name}.json`);
  if (!NAME.test(name) || !existsSync(m)) return undefined;
  const meta = JSON.parse(readFileSync(m, 'utf8')) as ScriptMeta;
  const t = join(d, `${name}.test.${EXT[meta.lang]}`);
  return { meta, code: readFileSync(join(d, `${name}.${EXT[meta.lang]}`), 'utf8'), test: existsSync(t) ? readFileSync(t, 'utf8') : undefined };
}
const writeMeta = (ws: string, m: ScriptMeta) => writeFileSync(join(scriptsDir(ws), `${m.name}.json`), JSON.stringify(m, null, 2));

/** Enregistre (ou améliore) un script ; l'ancienne version est gardée dans .versions/. */
export function saveScript(ws: string, o: { name: string; lang: Lang; description: string; code: string; change?: string; test?: string; home?: string; skill?: string }, now = Date.now()): ScriptMeta {
  if (!NAME.test(o.name)) throw new Error('nom de script : minuscules, chiffres, tirets (ex. sauvegarde-nas)');
  if (!EXT[o.lang]) throw new Error('langage : python, bash ou node');
  if (!o.code.trim()) throw new Error('script vide');
  const scan = scanCode(`${o.code}\n${o.test ?? ''}`);
  if (scan.refuse) throw new Error(`refusé : ${scan.refuse}`);
  const d = scriptsDir(ws); mkdirSync(join(d, '.versions'), { recursive: true }); ensureLib(ws);
  const prev = readScript(ws, o.name);
  const code = o.code.endsWith('\n') ? o.code : `${o.code}\n`;
  if (prev) {
    copyFileSync(join(d, `${o.name}.${EXT[prev.meta.lang]}`), join(d, '.versions', `${o.name}.v${prev.meta.version}.${EXT[prev.meta.lang]}`));
    writeFileSync(join(d, '.versions', `${o.name}.v${prev.meta.version}.json`), JSON.stringify(prev.meta));
  }
  const meta: ScriptMeta = prev
    ? { ...prev.meta, lang: o.lang, description: o.description || prev.meta.description, version: prev.meta.version + 1, updated: now, changes: [...prev.meta.changes, `v${prev.meta.version + 1} : ${o.change || 'amélioration'}`].slice(-20), lastError: undefined }
    : { name: o.name, lang: o.lang, description: o.description, version: 1, runs: 0, ok: 0, fails: 0, created: now, updated: now, changes: ['v1 : création'] };
  meta.warnings = scan.warnings.length ? scan.warnings : undefined;
  if (o.skill) meta.skill = o.skill;
  writeFileSync(join(d, `${o.name}.${EXT[o.lang]}`), code, { mode: 0o700 });
  if (o.test !== undefined) { if (o.test.trim()) writeFileSync(join(d, `${o.name}.test.${EXT[o.lang]}`), o.test); }
  meta.hasTest = existsSync(join(d, `${o.name}.test.${EXT[o.lang]}`));
  if (o.home) meta.sig = sign(o.home, code);
  writeMeta(ws, meta);
  return meta;
}
/** Revient à une version précédente (la version actuelle est gardée aussi). */
export function revertScript(ws: string, name: string, version: number, home?: string): ScriptMeta {
  const cur = readScript(ws, name); if (!cur) throw new Error(`script inconnu : ${name}`);
  const f = join(scriptsDir(ws), '.versions', `${name}.v${version}.${EXT[cur.meta.lang]}`);
  if (!existsSync(f)) throw new Error(`version ${version} introuvable (disponibles : ${readdirSync(join(scriptsDir(ws), '.versions')).filter((x) => x.startsWith(`${name}.v`) && !x.endsWith('.json')).map((x) => x.split('.v')[1].split('.')[0]).join(', ') || 'aucune'})`);
  return saveScript(ws, { name, lang: cur.meta.lang, description: cur.meta.description, code: readFileSync(f, 'utf8'), change: `retour à la v${version}`, home });
}
function record(ws: string, name: string, ok: boolean, ms: number, err?: string): void {
  const r = readScript(ws, name); if (!r) return;
  const v = `v${r.meta.version}`, p = r.meta.perf?.[v] ?? { runs: 0, avgMs: 0, ok: 0 };
  const perf = { ...(r.meta.perf ?? {}), [v]: { runs: p.runs + 1, ok: p.ok + (ok ? 1 : 0), avgMs: Math.round((p.avgMs * p.runs + ms) / (p.runs + 1)) } };
  writeMeta(ws, { ...r.meta, runs: r.meta.runs + 1, ok: r.meta.ok + (ok ? 1 : 0), fails: r.meta.fails + (ok ? 0 : 1), lastRun: Date.now(), lastError: ok ? undefined : err?.slice(-500), avgMs: Math.round(((r.meta.avgMs ?? 0) * r.meta.runs + ms) / (r.meta.runs + 1)), perf });
}

/** Liste lisible pour le modèle (pur). */
export const scriptsIndex = (list: ScriptMeta[]) => list.slice(0, 30).map((m) => `- ${m.name} (${m.lang}, v${m.version}, ${m.ok}/${m.runs} réussi(s)${m.hasTest ? ', testé' : ''}${m.fails && m.lastError ? ', dernier échec à corriger' : ''}) : ${m.description}`).join('\n');

// ---------------- Exécution ----------------

const quote = (a: string) => `'${a.replace(/'/g, `'\\''`)}'`;
export interface RunResult { code: number | null; out: string; ms: number }

function runLocal(lang: Lang, code: string, args: string[], ctx: ToolContext, timeoutMs: number, env: Record<string, string> = {}): Promise<RunResult> {
  const t0 = Date.now();
  return new Promise((res) => {
    const [bin, ...pre] = BIN[lang];
    const child = spawn(bin, [...pre, ...args], { cwd: ctx.workspace, env: { ...safeEnv(), ODIN_WORKSPACE: ctx.workspace, ODIN_LIB: libDir(ctx.workspace), PYTHONPATH: libDir(ctx.workspace), ...env }, signal: ctx.signal, windowsHide: true });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (d) => { out += d; if (out.length > 400_000) out = out.slice(-200_000); });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (e) => { clearTimeout(timer); res({ code: 127, out: `${out}\n${e.message}`, ms: Date.now() - t0 }); });
    child.on('close', (c) => { clearTimeout(timer); res({ code: c, out, ms: Date.now() - t0 }); });
    child.stdin.end(code);
  });
}

/** Le module commun, inclus devant le script quand il part ailleurs (machine, conteneur, bac à sable). */
function bundle(ws: string, lang: Lang, code: string): string {
  const lib = (f: string) => { try { return readFileSync(join(libDir(ws), f), 'utf8'); } catch { return LIB[f]; } };
  if (lang === 'python' && /\bodin_lib\b/.test(code)) return `import sys, types\n_m = types.ModuleType("odin_lib"); exec(${JSON.stringify(lib('odin_lib.py'))}, _m.__dict__); sys.modules["odin_lib"] = _m\n${code}`;
  if (lang === 'bash' && /odin_lib\.sh/.test(code)) return `${lib('odin_lib.sh')}\n${code.replace(/^\s*(source|\.)\s+["']?\$\{?ODIN_LIB\}?\/odin_lib\.sh["']?\s*$/m, '')}`;
  return code;
}

/** Cibles : local, machine, pct:ID, liste séparée par des virgules, pct:all, sandbox. */
export async function targets(where: string, ctx: ToolContext): Promise<string[]> {
  const list = where.split(',').map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const w of list.length ? list : ['local']) {
    if (w === 'pct:all') {
      const r = await runLocal('bash', 'pct list 2>/dev/null | awk \'NR>1 && $2=="running" {print $1}\'', [], ctx, 20_000);
      out.push(...r.out.split('\n').filter((x) => /^\d+$/.test(x.trim())).map((x) => `pct:${x.trim()}`));
    } else out.push(w);
  }
  return [...new Set(out)];
}

export async function runOn(where: string, sc: { meta: ScriptMeta; code: string }, args: string[], ctx: ToolContext, timeoutMs: number, dry: boolean): Promise<RunResult> {
  const env: Record<string, string> = dry ? { ODIN_DRY_RUN: '1' } : {};
  const [bin, ...pre] = BIN[sc.meta.lang];
  const envPrefix = dry ? 'ODIN_DRY_RUN=1 ' : '';
  if (where === 'local') return runLocal(sc.meta.lang, sc.code, args, ctx, timeoutMs, env);
  const code = bundle(ctx.workspace, sc.meta.lang, sc.code);
  if (where === 'sandbox') {
    // Bac à sable jetable : conteneur Docker sans réseau, supprimé à la fin.
    const image = { python: 'python:3.12-slim', bash: 'debian:bookworm-slim', node: 'node:22-slim' }[sc.meta.lang];
    return runLocal('bash', `docker run --rm -i --network none --memory 512m --cpus 1 ${dry ? '-e ODIN_DRY_RUN=1 ' : ''}${image} ${[bin, ...pre, ...args].map(quote).join(' ')} <<'ODIN_SCRIPT_EOF'\n${code}\nODIN_SCRIPT_EOF\n`, [], ctx, timeoutMs);
  }
  if (/^pct:\d+$/.test(where)) return runLocal('bash', `pct exec ${where.slice(4)} -- env ${envPrefix}${[bin, ...pre, ...args].map(quote).join(' ')} <<'ODIN_SCRIPT_EOF'\n${code}\nODIN_SCRIPT_EOF\n`, [], ctx, timeoutMs);
  if (!ctx.home) return { code: 1, out: 'Machines du réseau indisponibles ici.', ms: 0 };
  const m = findMachine(ctx.home, where);
  if (!m) return { code: 1, out: `Machine inconnue : ${where} (Réglages → Droits et machines).`, ms: 0 };
  const t0 = Date.now();
  const x = await runOnMachine(ctx.home, m, `${envPrefix}${[bin, ...pre, ...args].map(quote).join(' ')}`, { timeoutMs, signal: ctx.signal, stdin: code });
  return { code: x.code, out: x.out, ms: Date.now() - t0 };
}

/** Lance le test d'un script (le test reçoit le chemin du script dans ODIN_SCRIPT). */
async function runTest(ctx: ToolContext, name: string): Promise<{ ok: boolean; out: string } | undefined> {
  const r = readScript(ctx.workspace, name); if (!r?.test) return undefined;
  const x = await runLocal(r.meta.lang, r.test, [], ctx, 120_000, { ODIN_SCRIPT: join(scriptsDir(ctx.workspace), `${name}.${EXT[r.meta.lang]}`), ODIN_DRY_RUN: '1' });
  return { ok: x.code === 0, out: x.out.trim().slice(-1500) };
}

// ---------------- Outils ----------------

export const scriptSave: Tool = {
  name: 'script_save',
  description: 'Enregistre un script réutilisable (python, bash ou node) ou améliore un existant (même nom = nouvelle version, l\'ancienne est gardée). Bon script : arguments en ligne de commande, messages clairs, code de sortie ≠ 0 en cas d\'échec, aucun secret en dur, et il respecte ODIN_DRY_RUN=1 (mode essai : il montre ce qu\'il ferait sans rien changer). Module commun disponible : Python « import odin_lib as odin » (odin.run, odin.pct, odin.pct_list, odin.log, odin.fail, odin.DRY), Bash « source \"$ODIN_LIB/odin_lib.sh\" » (run, pct_run, log, fail). Ajoute un « test » (même langage, lancé en mode essai, chemin du script dans ODIN_SCRIPT, code 0 = réussi) : une nouvelle version qui casse le test n\'est pas gardée.',
  risk: 'write',
  schema: obj({ name: str('nom court (ex. maj-conteneurs) ; « lib » pour enrichir le module commun'), lang: { type: 'string', enum: ['python', 'bash', 'node'] }, description: str('à quoi il sert, arguments attendus'), code: str('le code complet'), change: str('ce qui change (si amélioration)'), test: str('code du test (facultatif mais conseillé)') }, ['name', 'lang', 'code']),
  summarize: (i) => `script ${s(i.name)} (${s(i.lang)}) : enregistrer${s(i.change) ? ` — ${s(i.change)}` : ''}`,
  async run(i, ctx) {
    const lang = s(i.lang) as Lang;
    if (s(i.name) === 'lib') {
      const scan = scanCode(s(i.code)); if (scan.refuse) return `Refusé : ${scan.refuse}.`;
      ensureLib(ctx.workspace); writeFileSync(join(libDir(ctx.workspace), `odin_lib.${EXT[lang]}`), s(i.code));
      return `Module commun ${lang} mis à jour (scripts/lib/odin_lib.${EXT[lang]}).`;
    }
    const before = readScript(ctx.workspace, s(i.name));
    let m: ScriptMeta;
    try { m = saveScript(ctx.workspace, { name: s(i.name), lang, description: s(i.description), code: ctx.redactor.redact(s(i.code)), change: s(i.change), test: i.test === undefined ? undefined : s(i.test), home: ctx.home }); }
    catch (e) { return `Refusé : ${(e as Error).message}`; }
    const t = await runTest(ctx, m.name);
    if (t && !t.ok) {
      // La nouvelle version casse le test : on remet l'ancienne.
      if (before) saveScript(ctx.workspace, { name: m.name, lang: before.meta.lang, description: before.meta.description, code: before.code, change: `v${m.version} rejetée (test échoué)`, home: ctx.home });
      return `Test ÉCHOUÉ : la v${m.version} n'est pas gardée${before ? ` (la v${before.meta.version} reste en place)` : ''}.\n${t.out}`;
    }
    return `Script « ${m.name} » enregistré (v${m.version})${t ? ', test réussi' : ''}${m.warnings ? ` — ⚠ ${m.warnings.join(' ; ')}` : ''}. Lance-le avec script_run (dry_run pour un essai).`;
  },
};

export const scriptRun: Tool = {
  name: 'script_run',
  description: 'Lance un script de ta bibliothèque. where : « local » (défaut), nom d\'une machine du réseau, « pct:7800 » (conteneur Proxmox), plusieurs séparés par des virgules ou « pct:all » (tous les conteneurs en marche, résumé à la fin), ou « sandbox » (conteneur jetable sans réseau, pour essayer un nouveau script). dry_run : mode essai (rien n\'est changé) — fais-le d\'abord pour une action qui modifie des machines. En cas d\'échec : corrige avec script_save (même nom) et relance.',
  risk: 'exec',
  schema: obj({ name: str('nom du script'), args: str('arguments (guillemets pour un argument avec espaces)'), where: str('local, machine, pct:N, liste, pct:all ou sandbox'), dry_run: bool('mode essai'), timeout: num('durée maximale par cible en secondes (300 par défaut, 3600 max)') }, ['name']),
  summarize: (i) => `script ${s(i.name)} ${s(i.args)}${s(i.where) && s(i.where) !== 'local' ? ` sur ${s(i.where)}` : ''}${i.dry_run ? ' (essai)' : ''}`,
  command: (i) => `script:${s(i.name)} ${s(i.args)}${s(i.where) ? ` @${s(i.where)}` : ''}`,
  async run(i, ctx) {
    const sc = readScript(ctx.workspace, s(i.name));
    if (!sc) return `Script inconnu : ${s(i.name)}. Scripts disponibles :\n${scriptsIndex(listScripts(ctx.workspace)) || '(aucun : crée-le avec script_save)'}`;
    if (ctx.home && sc.meta.sig && !verify(ctx.home, sc.code, sc.meta.sig)) return `Refusé : le script « ${sc.meta.name} » a été modifié en dehors d'Odin (signature invalide). Relis-le (script_list) et réenregistre-le avec script_save s'il est correct.`;
    const scan = scanCode(`${sc.code}\n${s(i.args)}`);
    if (scan.refuse) return `Refusé : ${scan.refuse}.`;
    const args = (s(i.args).match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((a) => a.replace(/^["']|["']$/g, ''));
    const timeoutMs = Math.min(3600, Math.max(5, Number(i.timeout) || 300)) * 1000, dry = Boolean(i.dry_run);
    const list = await targets(s(i.where).trim() || 'local', ctx);
    if (!list.length) return 'Aucune cible (pas de conteneur en marche ?).';
    const results: Array<{ where: string; r: RunResult }> = [];
    // Plusieurs cibles : trois à la fois.
    for (let k = 0; k < list.length; k += 3) results.push(...await Promise.all(list.slice(k, k + 3).map(async (w) => ({ where: w, r: await runOn(w, sc, args, ctx, timeoutMs, dry) }))));
    if (!dry) for (const { r } of results) record(ctx.workspace, sc.meta.name, r.code === 0, r.ms, r.out);
    const clip = (o: string) => ctx.redactor.redact(o.length > 30_000 / results.length ? `${o.slice(0, 4000)}\n…\n${o.slice(-Math.max(2000, 20_000 / results.length))}` : o).trimEnd();
    const tag = `${sc.meta.name} v${sc.meta.version}${dry ? ' — ESSAI, rien n\'a été changé' : ''}`;
    if (results.length === 1) { const { r } = results[0]; return `${clip(r.out)}\n[script ${tag} — code de sortie ${r.code} — ${(r.ms / 1000).toFixed(1)} s${r.code === 0 ? '' : ' : ÉCHEC — corrige le script (script_save, même nom) puis relance'}]`; }
    const ok = results.filter((x) => x.r.code === 0);
    return `${results.map((x) => `── ${x.where} : ${x.r.code === 0 ? '✓' : `✗ (code ${x.r.code})`}\n${clip(x.r.out)}`).join('\n')}\n[script ${tag} — ${ok.length}/${results.length} réussi(s)${ok.length < results.length ? ` ; échecs : ${results.filter((x) => x.r.code !== 0).map((x) => x.where).join(', ')}` : ''}]`;
  },
};

export const scriptList: Tool = {
  name: 'script_list',
  description: 'Ta bibliothèque de scripts (à quoi chacun sert, version, réussites, test, dernière erreur). Avec « name » : code, test, historique et durée par version. Regarde-la AVANT d\'écrire un nouveau script.',
  risk: 'read',
  schema: obj({ name: str('nom d\'un script pour voir son code (facultatif)') }),
  async run(i, ctx) {
    if (s(i.name)) {
      const r = readScript(ctx.workspace, s(i.name));
      if (!r) return `Script inconnu : ${s(i.name)}`;
      const perf = Object.entries(r.meta.perf ?? {}).map(([v, p]) => `${v} : ${p.ok}/${p.runs} réussi(s), ${(p.avgMs / 1000).toFixed(1)} s en moyenne`).join(' ; ');
      return `${r.meta.name} (${r.meta.lang}, v${r.meta.version}) : ${r.meta.description}\nRéussites ${r.meta.ok}/${r.meta.runs}${perf ? `\nPar version : ${perf}` : ''}${r.meta.lastError ? `\nDernière erreur : ${r.meta.lastError}` : ''}${r.meta.warnings ? `\n⚠ ${r.meta.warnings.join(' ; ')}` : ''}\nChangements : ${r.meta.changes.join(' ; ')}\n\n${r.code}${r.test ? `\n--- test ---\n${r.test}` : ''}`;
    }
    return scriptsIndex(listScripts(ctx.workspace)) || 'Aucun script pour l\'instant.';
  },
};

export const scriptRevert: Tool = {
  name: 'script_revert',
  description: 'Revient à une version précédente d\'un script (par exemple si la nouvelle est plus lente ou moins fiable : compare avec script_list).',
  risk: 'write',
  schema: obj({ name: str('nom du script'), version: num('numéro de version à remettre') }, ['name', 'version']),
  async run(i, ctx) { const m = revertScript(ctx.workspace, s(i.name), Number(i.version), ctx.home); return `« ${m.name} » remis à la v${Number(i.version)} (devient la v${m.version}).`; },
};

export const scriptSchedule: Tool = {
  name: 'script_schedule',
  description: 'Programme un script directement (cron à 5 champs) : il tourne tout seul, sans passer par le modèle (rapide et gratuit). Tu reçois le résultat seulement s\'il échoue, sauf « always_report ».',
  risk: 'exec',
  schema: obj({ name: str('nom du script'), cron: str('ex. « 0 4 * * 1 » = lundi 4 h'), args: str('arguments'), where: str('cible (comme script_run)'), always_report: bool('envoyer le résultat même quand tout va bien') }, ['name', 'cron']),
  summarize: (i) => `programmer le script ${s(i.name)} (${s(i.cron)})${s(i.where) ? ` sur ${s(i.where)}` : ''}`,
  command: (i) => `script:${s(i.name)} ${s(i.args)}${s(i.where) ? ` @${s(i.where)}` : ''}`,
  async run(i, ctx) {
    if (!readScript(ctx.workspace, s(i.name))) return `Script inconnu : ${s(i.name)}`;
    const { nextRun } = await import('../cron/cron.ts');
    const next = nextRun(s(i.cron), new Date());
    const id = `job_${Date.now().toString(36)}`;
    ctx.muninn.addJob({ id, cron: s(i.cron), prompt: scriptJob({ name: s(i.name), args: s(i.args), where: s(i.where) || 'local', report: Boolean(i.always_report) }), channel: ctx.channel, peer: ctx.peer, next_run: next.getTime(), tainted: ctx.isTainted() ? 1 : 0 });
    return `Script « ${s(i.name)} » programmé (${id}). Prochaine exécution : ${next.toLocaleString('fr-FR')}.`;
  },
};

/** Tâche « script direct » enregistrée dans la table des tâches (pur). */
export const scriptJob = (j: { name: string; args: string; where: string; report: boolean }) => `!script ${JSON.stringify(j)}`;
export function parseScriptJob(prompt: string): { name: string; args: string; where: string; report: boolean } | undefined {
  if (!prompt.startsWith('!script ')) return undefined;
  try { return JSON.parse(prompt.slice(8)) as { name: string; args: string; where: string; report: boolean }; } catch { return undefined; }
}

export const SCRIPT_TOOLS: Tool[] = [scriptSave, scriptRun, scriptList, scriptRevert, scriptSchedule];

// ---------------- Qui suis-je ? (nom d'hôte, adresses) ----------------

/** Nom d'hôte et adresses IP de la machine d'Odin. */
export function selfIdentity(ifaces = networkInterfaces(), host = hostname()): { hostname: string; ips: Array<{ iface: string; ip: string; v6: boolean }>; container?: string } {
  const ips = Object.entries(ifaces).flatMap(([iface, list]) => (list ?? []).filter((a) => !a.internal && !/^fe80/i.test(a.address)).map((a) => ({ iface, ip: a.address, v6: a.family === 'IPv6' || (a.family as unknown) === 6 })));
  let container: string | undefined;
  try { const env = readFileSync('/proc/1/environ', 'utf8'); if (/container=lxc/.test(env)) container = 'conteneur LXC'; } catch { /* pas Linux ou pas les droits */ }
  try { if (!container && /docker|containerd/.test(readFileSync('/proc/1/cgroup', 'utf8'))) container = 'conteneur Docker'; } catch { /* rien */ }
  return { hostname: host, ips: ips.sort((a, b) => Number(a.v6) - Number(b.v6)), container };
}
export const identityLine = (id = selfIdentity()) => `Ta machine : nom d'hôte « ${id.hostname} »${id.container ? ` (${id.container})` : ''}, adresse(s) IP : ${id.ips.filter((x) => !x.v6).map((x) => `${x.ip} (${x.iface})`).join(', ') || 'aucune IPv4'}${id.ips.some((x) => x.v6) ? ` ; IPv6 : ${id.ips.filter((x) => x.v6).slice(0, 2).map((x) => x.ip).join(', ')}` : ''}. Quand on parle de « toi », « Odin » ou « ta machine », c'est elle.`;
