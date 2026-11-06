// Extensions Python : un fichier .py dans ~/.odin/plugins devient un outil d'Odin. Tu peux en écrire,
// en déposer, ou laisser Odin en écrire lui-même (plugin_save) quand une tâche revient souvent.
//
//   """odin-tool
//   name: meteo_locale
//   description: Météo de demain pour une ville
//   risk: network            (read | write | network | exec | external)
//   params:
//     ville: nom de la ville
//   """
//   def run(args):           # args = dictionnaire des paramètres
//       return "…"           # texte (ou dict / liste, converti en JSON)
//
// Chaque appel lance Python à part (2 minutes au plus), sans accès aux secrets d'Odin.
// Une extension écrite par Odin est toujours traitée comme une commande (« exec ») par Heimdall.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JsonSchema, Risk } from '../types.ts';
import { obj, str, type Tool, type ToolRegistry } from './registry.ts';

export interface PluginMeta { name: string; description: string; risk: Risk; params: Array<{ name: string; description: string }>; by: 'toi' | 'odin'; file: string }
const RISKS: Risk[] = ['read', 'write', 'network', 'exec', 'external'];

/** Lit l'en-tête « odin-tool » d'une extension (pur). */
export function parsePlugin(code: string, file = ''): PluginMeta | undefined {
  const m = /^\s*(?:#[^\n]*\n\s*)*(?:"""|''')odin-tool\s*\n([\s\S]*?)(?:"""|''')/.exec(code);
  if (!m || !/^def run\(/m.test(code)) return undefined;
  const head = m[1], get = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(head)?.[1]?.trim() ?? '';
  const name = get('name');
  if (!/^[a-z][a-z0-9_]{2,40}$/.test(name)) return undefined;
  const params: PluginMeta['params'] = [];
  const pb = /^params:\s*\n((?:[ \t]+\S.*\n?)*)/m.exec(head)?.[1] ?? '';
  for (const l of pb.split('\n')) { const x = /^\s+([a-z_][a-z0-9_]*):\s*(.*)$/i.exec(l); if (x) params.push({ name: x[1], description: x[2].trim() }); }
  const risk = get('risk') as Risk;
  return { name: `py_${name}`, description: get('description').slice(0, 400) || name, risk: RISKS.includes(risk) ? risk : 'exec', params, by: /^by:\s*odin/m.test(head) ? 'odin' : 'toi', file };
}

const RUNNER = `import sys, json, importlib.util
spec = importlib.util.spec_from_file_location("odin_plugin", sys.argv[1])
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
args = json.loads(sys.stdin.read() or "{}")
out = mod.run(args)
sys.stdout.write(out if isinstance(out, str) else json.dumps(out, ensure_ascii=False, default=str))`;

/** Un outil Odin pour une extension. */
export function pluginTool(meta: PluginMeta, workspace: string): Tool {
  const props: Record<string, JsonSchema> = Object.fromEntries(meta.params.map((p) => [p.name, { type: 'string', description: p.description } as JsonSchema]));
  return {
    name: meta.name,
    description: `[extension Python${meta.by === 'odin' ? ' écrite par Odin' : ''}] ${meta.description}`,
    // Une extension écrite par Odin peut tout faire en Python : Heimdall la juge comme une commande.
    risk: meta.by === 'odin' ? 'exec' : meta.risk,
    schema: obj(props),
    summarize: (i) => `extension ${meta.name.slice(3)} ${JSON.stringify(i).slice(0, 120)}`,
    async run(i, ctx) {
      const py = process.platform === 'win32' ? 'python' : 'python3';
      // Environnement minimal : aucune clé, aucun jeton d'Odin.
      const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8', PYTHONIOENCODING: 'utf-8' };
      return await new Promise<string>((resolve) => {
        const p = spawn(py, ['-I', '-c', RUNNER, meta.file], { cwd: workspace, env, signal: ctx.signal });
        let out = '', err = '';
        const t = setTimeout(() => p.kill('SIGKILL'), 120_000);
        p.stdout.on('data', (b) => { out += b; if (out.length > 200_000) p.kill(); });
        p.stderr.on('data', (b) => { err += b; if (err.length > 20_000) err = err.slice(-10_000); });
        p.on('error', (e) => { clearTimeout(t); resolve(`ÉCHEC : ${e.message}`); });
        p.on('close', (code) => { clearTimeout(t); resolve(code === 0 ? (out.trim() || '(aucun résultat)').slice(0, 30_000) : `ÉCHEC (code ${code}) : ${err.trim().split('\n').slice(-8).join('\n')}`); });
        p.stdin.end(JSON.stringify(i));
      });
    },
  };
}

export const pluginDir = (home: string) => join(home, 'plugins');

/** Charge toutes les extensions de ~/.odin/plugins dans le registre. Renvoie leurs noms. */
export function loadPlugins(home: string, workspace: string, registry: ToolRegistry): string[] {
  const dir = pluginDir(home);
  if (!existsSync(dir)) return [];
  const names: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.py'))) {
    const file = join(dir, f), meta = parsePlugin(readFileSync(file, 'utf8'), file);
    if (!meta) { console.error(`[extensions] ${f} ignoré : en-tête « odin-tool » ou fonction run(args) manquant`); continue; }
    if (registry.get(meta.name) && !registry.get(meta.name)!.description.startsWith('[extension')) continue; // jamais à la place d'un outil d'Odin
    registry.upsert(pluginTool(meta, workspace)); names.push(meta.name);
  }
  return names;
}

/** Odin écrit (ou améliore) une extension Python ; vérifiée par Python avant d'être activée. */
export function pluginSaveTool(registry: () => ToolRegistry | undefined): Tool {
  return {
    name: 'plugin_save',
    description: 'Écris ou améliore une extension Python (nouvel outil réutilisable, nommé py_<nom>) : quand une tâche revient et qu\'un petit programme Python la ferait mieux (calcul, format de fichier, API locale). Le code DOIT commencer par l\'en-tête """odin-tool ... """ (name, description, risk, params) et définir run(args). Vérifiée puis active tout de suite.',
    risk: 'exec',
    schema: obj({ code: str('code Python complet, en-tête odin-tool compris') }, ['code']),
    summarize: (i) => `extension Python ${parsePlugin(String(i.code ?? ''))?.name ?? '(invalide)'}`,
    async run(i, ctx) {
      if (ctx.isTainted()) return 'Refusé : pas de nouvelle extension après lecture d\'un contenu non fiable.';
      let code = String(i.code ?? '');
      if (!/^by:\s*odin/m.test(code)) code = code.replace(/(odin-tool\s*\n)/, '$1by: odin\n');
      const meta = parsePlugin(code);
      if (!meta) return 'Invalide : il faut l\'en-tête """odin-tool\\nname: …\\ndescription: …\\n""" puis def run(args).';
      const reg = registry();
      const existing = reg?.get(meta.name);
      if (existing && !existing.description.startsWith('[extension')) return `Refusé : ${meta.name} est déjà un outil d'Odin.`;
      const dir = pluginDir(ctx.home ?? ''); mkdirSync(dir, { recursive: true });
      const file = join(dir, `${meta.name.slice(3)}.py`);
      const check = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: code, encoding: 'utf8' });
      if (check.status !== 0) return `Erreur de syntaxe Python :\n${(check.stderr || '').split('\n').slice(-6).join('\n')}`;
      writeFileSync(file, code);
      reg?.upsert(pluginTool({ ...meta, file }, ctx.workspace));
      return `Extension ${meta.name} ${existing ? 'améliorée' : 'créée'} (${file}) : utilisable tout de suite.`;
    },
  };
}
