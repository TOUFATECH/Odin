// Bibliothèque de scripts d'Odin : pour une mission, il écrit un script (Python, Bash, Node), le
// lance, le corrige s'il échoue, et le GARDE pour la prochaine fois. Chaque script a sa fiche
// (à quoi il sert, version, réussites, échecs, dernière erreur) et ses anciennes versions.
// Un script peut tourner sur la machine d'Odin, sur une machine du réseau (SSH) ou dans un
// conteneur Proxmox (pct exec) — le code est envoyé par l'entrée standard, rien n'est laissé là-bas.

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { findMachine, runOnMachine } from '../machines/access.ts';
import { hardDenied } from '../heimdall/policy.ts';
import { safeEnv } from './builtin.ts';
import { num, obj, str, type Tool, type ToolContext } from './registry.ts';

const s = (v: unknown) => String(v ?? '');
export type Lang = 'python' | 'bash' | 'node';
const EXT: Record<Lang, string> = { python: 'py', bash: 'sh', node: 'mjs' };
const BIN: Record<Lang, string[]> = { python: ['python3', '-'], bash: ['bash', '-s', '--'], node: ['node', '--input-type=module', '-'] };
export interface ScriptMeta { name: string; lang: Lang; description: string; version: number; runs: number; ok: number; fails: number; lastError?: string; lastRun?: number; created: number; updated: number; changes: string[] }

export const scriptsDir = (ws: string) => join(ws, 'scripts');
const NAME = /^[a-z0-9][a-z0-9_-]{1,47}$/;

export function listScripts(ws: string): ScriptMeta[] {
  const d = scriptsDir(ws);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(readFileSync(join(d, f), 'utf8')) as ScriptMeta; } catch { return undefined; } }).filter((x): x is ScriptMeta => Boolean(x)).sort((a, b) => (b.lastRun ?? b.updated) - (a.lastRun ?? a.updated));
}
export function readScript(ws: string, name: string): { meta: ScriptMeta; code: string } | undefined {
  const d = scriptsDir(ws), m = join(d, `${name}.json`);
  if (!NAME.test(name) || !existsSync(m)) return undefined;
  const meta = JSON.parse(readFileSync(m, 'utf8')) as ScriptMeta;
  return { meta, code: readFileSync(join(d, `${name}.${EXT[meta.lang]}`), 'utf8') };
}
/** Enregistre (ou améliore) un script ; l'ancienne version est gardée dans .versions/. */
export function saveScript(ws: string, o: { name: string; lang: Lang; description: string; code: string; change?: string }, now = Date.now()): ScriptMeta {
  if (!NAME.test(o.name)) throw new Error('nom de script : minuscules, chiffres, tirets (ex. sauvegarde-nas)');
  if (!EXT[o.lang]) throw new Error('langage : python, bash ou node');
  if (!o.code.trim()) throw new Error('script vide');
  const d = scriptsDir(ws); mkdirSync(join(d, '.versions'), { recursive: true });
  const prev = readScript(ws, o.name);
  const file = join(d, `${o.name}.${EXT[o.lang]}`);
  if (prev) copyFileSync(join(d, `${o.name}.${EXT[prev.meta.lang]}`), join(d, '.versions', `${o.name}.v${prev.meta.version}.${EXT[prev.meta.lang]}`));
  const meta: ScriptMeta = prev
    ? { ...prev.meta, lang: o.lang, description: o.description || prev.meta.description, version: prev.meta.version + 1, updated: now, changes: [...prev.meta.changes, `v${prev.meta.version + 1} : ${o.change || 'amélioration'}`].slice(-20) }
    : { name: o.name, lang: o.lang, description: o.description, version: 1, runs: 0, ok: 0, fails: 0, created: now, updated: now, changes: ['v1 : création'] };
  writeFileSync(file, o.code.endsWith('\n') ? o.code : `${o.code}\n`, { mode: 0o700 });
  writeFileSync(join(d, `${o.name}.json`), JSON.stringify(meta, null, 2));
  return meta;
}
function record(ws: string, name: string, ok: boolean, err?: string): void {
  const r = readScript(ws, name); if (!r) return;
  const m = { ...r.meta, runs: r.meta.runs + 1, ok: r.meta.ok + (ok ? 1 : 0), fails: r.meta.fails + (ok ? 0 : 1), lastRun: Date.now(), lastError: ok ? undefined : err?.slice(-500) };
  writeFileSync(join(scriptsDir(ws), `${name}.json`), JSON.stringify(m, null, 2));
}

/** Liste lisible pour le modèle (pur). */
export const scriptsIndex = (list: ScriptMeta[]) => list.slice(0, 30).map((m) => `- ${m.name} (${m.lang}, v${m.version}, ${m.ok}/${m.runs} réussi(s)${m.fails && m.lastError ? ', dernier échec à corriger' : ''}) : ${m.description}`).join('\n');

const quote = (a: string) => `'${a.replace(/'/g, `'\\''`)}'`;

async function runLocal(lang: Lang, code: string, args: string[], ctx: ToolContext, timeoutMs: number, cwd: string): Promise<{ code: number | null; out: string }> {
  return new Promise((res) => {
    const [bin, ...pre] = BIN[lang];
    const child = spawn(bin, [...pre, ...args], { cwd, env: { ...safeEnv(), ODIN_WORKSPACE: ctx.workspace }, signal: ctx.signal, windowsHide: true });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (d) => { out += d; if (out.length > 400_000) out = out.slice(-200_000); });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (e) => { clearTimeout(timer); res({ code: 127, out: `${out}\n${e.message}` }); });
    child.on('close', (c) => { clearTimeout(timer); res({ code: c, out }); });
    child.stdin.end(code);
  });
}

export const scriptSave: Tool = {
  name: 'script_save',
  description: 'Enregistre un script réutilisable (python, bash ou node) dans ta bibliothèque, ou en améliore un existant (même nom = nouvelle version, l\'ancienne est gardée). Écris des scripts robustes : arguments en ligne de commande, messages clairs, code de sortie ≠ 0 en cas d\'échec, aucune donnée secrète en dur.',
  risk: 'write',
  schema: obj({ name: str('nom court (ex. maj-conteneurs, rapport-disques)'), lang: { type: 'string', enum: ['python', 'bash', 'node'] }, description: str('à quoi il sert, arguments attendus'), code: str('le code complet'), change: str('ce qui change par rapport à la version précédente (si amélioration)') }, ['name', 'lang', 'code']),
  summarize: (i) => `script ${s(i.name)} (${s(i.lang)}) : enregistrer${s(i.change) ? ` — ${s(i.change)}` : ''}`,
  async run(i, ctx) {
    const bad = hardDenied(s(i.code));
    if (bad) return `Refusé : le script contient une commande destructrice interdite (règle ${bad}).`;
    const m = saveScript(ctx.workspace, { name: s(i.name), lang: s(i.lang) as Lang, description: s(i.description), code: ctx.redactor.redact(s(i.code)), change: s(i.change) });
    return `Script « ${m.name} » enregistré (v${m.version}). Lance-le avec script_run.`;
  },
};

export const scriptRun: Tool = {
  name: 'script_run',
  description: 'Lance un script de ta bibliothèque : sur la machine d\'Odin (par défaut), sur une machine du réseau (where = son nom), ou dans un conteneur/VM Proxmox local (where = "pct:7800"). S\'il échoue, lis l\'erreur, corrige-le avec script_save (nouvelle version) et relance.',
  risk: 'exec',
  schema: obj({ name: str('nom du script'), args: str('arguments (séparés par des espaces ; guillemets pour un argument avec espaces)'), where: str('local (défaut), nom d\'une machine du réseau, ou pct:<n° du conteneur>'), timeout: num('durée maximale en secondes (300 par défaut, 3600 max)') }, ['name']),
  summarize: (i) => `script ${s(i.name)} ${s(i.args)}${s(i.where) && s(i.where) !== 'local' ? ` sur ${s(i.where)}` : ''}`,
  command: (i) => `script:${s(i.name)} ${s(i.args)}${s(i.where) ? ` @${s(i.where)}` : ''}`,
  async run(i, ctx) {
    const sc = readScript(ctx.workspace, s(i.name));
    if (!sc) return `Script inconnu : ${s(i.name)}. Scripts disponibles :\n${scriptsIndex(listScripts(ctx.workspace)) || '(aucun : crée-le avec script_save)'}`;
    const bad = hardDenied(`${sc.code}\n${s(i.args)}`);
    if (bad) return `Refusé : ce script contient une commande destructrice interdite (règle ${bad}).`;
    const args = (s(i.args).match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((a) => a.replace(/^["']|["']$/g, ''));
    const timeoutMs = Math.min(3600, Math.max(5, Number(i.timeout) || 300)) * 1000, where = s(i.where).trim() || 'local';
    let r: { code: number | null; out: string };
    if (where === 'local') r = await runLocal(sc.meta.lang, sc.code, args, ctx, timeoutMs, ctx.workspace);
    else if (/^pct:\d+$/.test(where)) {
      // Conteneur Proxmox sur cette machine : le code passe par l'entrée standard de « pct exec ».
      const [bin, ...pre] = BIN[sc.meta.lang];
      r = await runLocal('bash', `pct exec ${where.slice(4)} -- ${[bin, ...pre, ...args].map(quote).join(' ')} <<'ODIN_SCRIPT_EOF'\n${sc.code}\nODIN_SCRIPT_EOF\n`, [], ctx, timeoutMs, ctx.workspace);
    } else {
      if (!ctx.home) return 'Machines du réseau indisponibles ici.';
      const m = findMachine(ctx.home, where);
      if (!m) return `Machine inconnue : ${where} (Réglages → Droits et machines).`;
      const [bin, ...pre] = BIN[sc.meta.lang];
      const x = await runOnMachine(ctx.home, m, [bin, ...pre, ...args].map(quote).join(' '), { timeoutMs, signal: ctx.signal, stdin: sc.code });
      r = { code: x.code, out: x.out };
    }
    const ok = r.code === 0;
    record(ctx.workspace, sc.meta.name, ok, r.out);
    const out = ctx.redactor.redact(r.out.length > 30_000 ? `${r.out.slice(0, 10_000)}\n…\n${r.out.slice(-18_000)}` : r.out);
    return `${out.trimEnd()}\n[script ${sc.meta.name} v${sc.meta.version} — code de sortie ${r.code}${ok ? '' : ' : ÉCHEC — corrige le script (script_save, même nom) puis relance'}]`;
  },
};

export const scriptList: Tool = {
  name: 'script_list',
  description: 'Ta bibliothèque de scripts (à quoi chacun sert, version, réussites, dernière erreur). Avec « name », affiche le code et l\'historique des changements. Regarde-la AVANT d\'écrire un nouveau script.',
  risk: 'read',
  schema: obj({ name: str('nom d\'un script pour voir son code (facultatif)') }),
  async run(i, ctx) {
    if (s(i.name)) { const r = readScript(ctx.workspace, s(i.name)); return r ? `${r.meta.name} (${r.meta.lang}, v${r.meta.version}) : ${r.meta.description}\nRéussites ${r.meta.ok}/${r.meta.runs}${r.meta.lastError ? `\nDernière erreur : ${r.meta.lastError}` : ''}\nChangements : ${r.meta.changes.join(' ; ')}\n\n${r.code}` : `Script inconnu : ${s(i.name)}`; }
    return scriptsIndex(listScripts(ctx.workspace)) || 'Aucun script pour l\'instant.';
  },
};

export const SCRIPT_TOOLS: Tool[] = [scriptSave, scriptRun, scriptList];

// ---------------- Qui suis-je ? (nom d'hôte, adresses) ----------------

/** Nom d'hôte et adresses IP de la machine d'Odin (pur sauf lecture du système). */
export function selfIdentity(ifaces = networkInterfaces(), host = hostname()): { hostname: string; ips: Array<{ iface: string; ip: string; v6: boolean }>; container?: string } {
  const ips = Object.entries(ifaces).flatMap(([iface, list]) => (list ?? []).filter((a) => !a.internal && !/^fe80/i.test(a.address)).map((a) => ({ iface, ip: a.address, v6: a.family === 'IPv6' || (a.family as unknown) === 6 })));
  let container: string | undefined;
  try { const env = readFileSync('/proc/1/environ', 'utf8'); if (/container=lxc/.test(env)) container = 'conteneur LXC'; } catch { /* pas Linux ou pas les droits */ }
  try { if (!container && /docker|containerd/.test(readFileSync('/proc/1/cgroup', 'utf8'))) container = 'conteneur Docker'; } catch { /* rien */ }
  return { hostname: host, ips: ips.sort((a, b) => Number(a.v6) - Number(b.v6)), container };
}
export const identityLine = (id = selfIdentity()) => `Ta machine : nom d'hôte « ${id.hostname} »${id.container ? ` (${id.container})` : ''}, adresse(s) IP : ${id.ips.filter((x) => !x.v6).map((x) => `${x.ip} (${x.iface})`).join(', ') || 'aucune IPv4'}${id.ips.some((x) => x.v6) ? ` ; IPv6 : ${id.ips.filter((x) => x.v6).slice(0, 2).map((x) => x.ip).join(', ')}` : ''}. Quand on parle de « toi », « Odin » ou « ta machine », c'est elle.`;
