// Petits utilitaires d'affichage terminal (couleurs ANSI, désactivables avec NO_COLOR).
import type { AgentEvent } from '../types.ts';

const on = !process.env.NO_COLOR && process.stdout.isTTY;
const wrap = (code: number) => (s: string) => (on ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = { bold: wrap(1), dim: wrap(2), red: wrap(31), green: wrap(32), yellow: wrap(33), blue: wrap(34), magenta: wrap(35), cyan: wrap(36) };

export const BANNER = `${c.cyan('ᛟ  O D I N')}  ${c.dim('— agent personnel, sûr par défaut')}`;

export function printEvent(e: AgentEvent): void {
  switch (e.type) {
    case 'text': console.log(`\n${e.text}\n`); break;
    case 'tool_start': console.log(c.dim(`  ⚙ ${e.name} ${JSON.stringify(e.input).slice(0, 120)}`)); break;
    case 'tool_end': console.log(e.ok ? c.dim(`  ✓ ${e.preview.replace(/\s+/g, ' ').slice(0, 100)}`) : c.red(`  ✗ ${e.preview.slice(0, 160)}`)); break;
    case 'blocked': console.log(c.yellow(`  ⛔ ${e.name} bloqué : ${e.reason}`)); break;
    case 'compacted': console.log(c.dim(`  ♻ contexte compacté (${e.removed} messages résumés)`)); break;
    case 'decision':
      if (e.allowed && (e.via === 'mimir' || e.via === 'grant')) console.log(c.cyan(`  🛡 décidé seul (${e.via === 'grant' ? 'autorisation permanente' : e.severity}) : ${e.summary} — ${e.why}`));
      break;
    case 'skill_proposed': console.log(c.magenta(`  💡 compétence proposée : ${e.name} → odin skills approve ${e.name}`)); break;
    default: break;
  }
}

export function table(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return c.dim('(vide)');
  const keys = Object.keys(rows[0]);
  const w = keys.map((k) => Math.min(60, Math.max(k.length, ...rows.map((r) => String(r[k] ?? '').length))));
  const line = (vals: string[]) => vals.map((v, i) => v.slice(0, w[i]).padEnd(w[i])).join('  ');
  return [c.bold(line(keys)), ...rows.map((r) => line(keys.map((k) => String(r[k] ?? ''))))].join('\n');
}
