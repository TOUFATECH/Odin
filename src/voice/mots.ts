// Tes mots (Rödd) : ce que tu dis → ce qu'Odin doit écrire (« elixir » → LXC, « ring horni » → Hringhorni).
// Les mêmes mots servent à la dictée ET à tout ce que tu dis à Odin (web, téléphone, Telegram, Glaðsheimr) :
// ils sont soufflés à Whisper avant d'écouter, puis corrigés après.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Mot { mot: string; entendus: string[]; genre?: string; appris?: boolean }
export const motsFile = (home = process.env.ODIN_HOME ?? join(homedir(), '.odin')) => join(home, 'valhalla', 'rodd', 'mots.json');
export function mots(home?: string): Mot[] { try { return (JSON.parse(readFileSync(motsFile(home), 'utf8')) as Mot[]).filter((m) => m && typeof m.mot === 'string'); } catch { return []; } }
export function saveMots(l: Mot[], home?: string) { const f = motsFile(home); mkdirSync(dirname(f), { recursive: true, mode: 0o700 }); writeFileSync(`${f}.tmp`, JSON.stringify(l, null, 1), { mode: 0o600 }); renameSync(`${f}.tmp`, f); }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Remplace ce qui a été entendu par le bon mot (mots entiers, sans tenir compte des majuscules ni des accents). */
export function applyMots(text: string, l: Mot[]): string {
  let out = text.normalize('NFC');
  const pairs = l.flatMap((m) => m.entendus.filter(Boolean).map((e) => [e, m.mot] as const)).sort((a, b) => b[0].length - a[0].length);
  for (const [heard, mot] of pairs) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${fold(heard).split(/\s+/).map(esc).join('[\\s-]+')})(?=$|[^\\p{L}\\p{N}])`, 'giu');
    const f = fold(out); let res = '', last = 0;
    for (const m of f.matchAll(re)) { const start = m.index! + m[1].length, end = start + m[2].length; res += out.slice(last, start) + mot; last = end; }
    out = res + out.slice(last);
  }
  return out;
}
/** Le souffle donné à Whisper : la liste des mots à connaître (il les écrit alors correctement plus souvent). */
export const prompt = (l: Mot[]) => (l.length ? l.map((m) => m.mot).join(', ').slice(0, 600) : '');
/** Apprend d'une correction : ce que la dictée avait écrit → ce que tu as corrigé (mots qui diffèrent seulement). */
export function learn(before: string, after: string, l: Mot[]): Mot[] {
  const a = before.split(/\s+/), b = after.split(/\s+/); if (a.length !== b.length) return l;
  const out = [...l];
  for (let i = 0; i < a.length; i++) {
    const x = a[i].replace(/[.,;:!?«»"]/g, ''), y = b[i].replace(/[.,;:!?«»"]/g, '');
    if (!x || !y || fold(x).toLowerCase() === fold(y).toLowerCase()) continue;
    const m = out.find((k) => k.mot === y);
    if (m) { if (!m.entendus.some((e) => fold(e).toLowerCase() === fold(x).toLowerCase())) m.entendus.push(x); }
    else out.push({ mot: y, entendus: [x], appris: true });
  }
  return out;
}
