// Champollion hors des applis : reconnaissance du texte d'un PDF scanné, pour la lecture des documents par Odin
// (outil doc_read, pièces jointes reçues sur Telegram, WhatsApp, la Discussion…). Tesseract et Poppler sur la machine.
import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasCommand } from '../../learn/environment.ts';
import { analyse, report } from './analyse.ts';

const run = (cmd: string, args: string[], timeout: number) => new Promise<{ code: number; out: string }>((ok) => execFile(cmd, args, { timeout, maxBuffer: 1 << 25 }, (e, out) => ok({ code: e ? 1 : 0, out: String(out) })));
/** La reconnaissance est-elle possible sur cette machine ? */
export const ocrReady = () => hasCommand('tesseract') && hasCommand('pdftoppm');
/** Le texte d'un PDF scanné (40 pages au plus), page par page. */
export async function ocrPdf(file: string, langs = 'fra+eng', maxPages = 40): Promise<{ text: string; pages: number }> {
  const dir = mkdtempSync(join(tmpdir(), 'odin-ocr-'));
  try {
    await run('pdftoppm', ['-r', '200', '-png', '-l', String(maxPages), file, join(dir, 'p')], 600_000);
    const imgs = readdirSync(dir).filter((f) => /^p-\d+\.png$/.test(f)).sort();
    const parts: string[] = [];
    for (const im of imgs) parts.push((await run('tesseract', [join(dir, im), 'stdout', '-l', langs], 180_000)).out);
    return { text: parts.join('\n\f'), pages: imgs.length };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
/** Le compte rendu (type, dates, événements, montants, contacts) d'un texte lu, ou rien s'il n'y a rien à dire. */
export function understanding(text: string, source: string, now = new Date()): string {
  const a = analyse(text, now);
  if (!a.dates.length && !a.montants.length && !a.emails.length && !a.telephones.length && a.type === 'document') return '';
  return `\n\n— Ce que Champollion y comprend —\n${report(a, source)}`;
}
