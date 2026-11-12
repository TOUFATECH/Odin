// Les invites de commande d'Odin : chaque action de chaque appli a sa commande, tirée de l'appli elle-même
// (jamais une liste à tenir à la main) : `odin <appli> <action> --option valeur`. La même liste sert à la page
// « Commandes », à la mémoire d'Odin (fiches du Cerveau) et à la ligne de commande. Pur.
import type { Action, Module, Param } from './types.ts';

export interface Command { app: string; appName: string; action: string; label: string; what: string; line: string; example: string; grave: boolean; read: boolean; params: Param[] }
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const sample = (p: Param): string => {
  if (p.kind === 'select') return p.options?.find((o) => o) ?? 'valeur';
  if (p.kind === 'boolean') return 'oui';
  if (p.kind === 'number') return String(typeof p.default === 'number' && p.default ? p.default : 1);
  if (p.kind === 'password') return '••••';
  if (typeof p.default === 'string' && p.default) return p.default.includes(' ') ? `"${p.default}"` : p.default;
  return /mac/i.test(p.key) ? '52:54:00:12:34:56' : /\bip\b|adresse/i.test(p.key) ? '192.168.1.50' : /chemin|dossier/i.test(p.key) ? '/mnt/nas' : /^(q|texte|question)$/i.test(p.key) ? '"ta recherche"' : 'valeur';
};
/** La commande d'une action. */
export function commandOf(m: Module, a: Action): Command {
  const params = a.params ?? [], req = params.filter((p) => p.required), opt = params.filter((p) => !p.required);
  const line = `odin ${m.id} ${a.id}${req.map((p) => ` --${p.key} <${slug(p.label) || p.key}>`).join('')}${opt.map((p) => ` [--${p.key} …]`).join('')}`;
  const example = `odin ${m.id} ${a.id}${req.map((p) => ` --${p.key} ${sample(p)}`).join('')}`;
  return { app: m.id, appName: m.name, action: a.id, label: a.label, what: a.what, line, example, grave: Boolean(a.grave), read: Boolean(a.read), params };
}
export function commandsOf(mods: Module[]): Command[] { return mods.flatMap((m) => m.actions.map((a) => commandOf(m, a))); }

/** Lit `--cle valeur` / `--cle=valeur` / `--drapeau` en entrée d'action (types d'après les paramètres). Pur. */
export function parseArgs(args: string[], params: Param[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]; if (!a.startsWith('--')) continue;
    let [k, v] = a.slice(2).split(/=(.*)/s) as [string, string | undefined];
    if (v === undefined) { const n = args[i + 1]; if (n !== undefined && !n.startsWith('--')) { v = n; i++; } }
    const p = params.find((x) => x.key === k);
    if (p?.kind === 'boolean') out[k] = v === undefined ? true : /^(oui|o|true|1|yes|vrai)$/i.test(v);
    else if (p?.kind === 'number') out[k] = Number(v);
    else out[k] = v ?? true;
  }
  return out;
}
/** Les commandes qui répondent à une demande (« la commande pour bannir une adresse »). Pur. */
export function findCommands(all: Command[], q: string, n = 6): Command[] {
  const words = slug(q).split('-').filter((w) => w.length >= 3 && !['commande', 'commandes', 'pour', 'donne', 'moi', 'quelle', 'odin', 'avec', 'dans', 'invite'].includes(w));
  if (!words.length) return [];
  const score = (c: Command) => { const hay = slug(`${c.appName} ${c.app} ${c.action} ${c.label} ${c.what}`); return words.reduce((s, w) => s + (hay.includes(w) ? (slug(c.label).includes(w) || c.action.includes(w) ? 3 : 1) : 0), 0); };
  return all.map((c) => ({ c, s: score(c) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.c);
}
