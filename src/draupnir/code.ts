// Nœud « Code » de Talos : le code tourne dans un processus Node à part, avec le modèle de
// permissions de Node (aucun fichier, aucune commande, aucun sous-processus), 128 Mo, 10 s max.
// Il reçoit les éléments et renvoie une liste (ou un objet) qui devient la sortie du nœud.

import { spawn } from 'node:child_process';
import type { Item } from './engine.ts';

const RUNNER = `
let src = ''; process.stdin.on('data', (c) => { src += c; }); process.stdin.on('end', async () => {
  const { code, items } = JSON.parse(src);
  const all = items.map((i) => i.json);
  const $input = { all: () => all.map((j) => ({ ...j })), first: () => ({ ...(all[0] ?? {}) }), last: () => ({ ...(all.at(-1) ?? {}) }) };
  const $json = all[0] ?? {};
  try {
    const fn = new (Object.getPrototypeOf(async function () {}).constructor)('$input', '$json', 'items', code);
    const out = await fn($input, $json, all);
    process.stdout.write(JSON.stringify({ ok: true, out: out === undefined ? all : out }));
  } catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message || e) })); }
});`;

export function runCode(code: string, items: Item[], timeoutMs = 10_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--permission', '--max-old-space-size=128', '--disable-warning=ExperimentalWarning', '-e', RUNNER], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '' } });
    let out = '', err = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`code trop long (plus de ${timeoutMs / 1000} s)`)); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; if (out.length > 5_000_000) p.kill('SIGKILL'); });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', () => {
      clearTimeout(t);
      try { const r = JSON.parse(out) as { ok: boolean; out?: unknown; error?: string }; if (r.ok) resolve(r.out); else reject(new Error(`code : ${r.error}`)); }
      catch { reject(new Error(`code : ${(err || 'pas de résultat').split('\n').find((l) => /Error/.test(l)) ?? err.slice(0, 200)}`)); }
    });
    p.stdin.end(JSON.stringify({ code, items }));
  });
}
