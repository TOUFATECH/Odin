// La mascotte pendant une recherche, SANS navigateur (tourne partout) : la logique de src/web/ui.html qui tient le
// regard « attentif » est extraite telle quelle et jouée avec des doublures du visage.
// 1. Tenu tant que la recherche donne signe de vie (étapes), lâché après un silence (un tour qui finit sans message).
// 2. Lâché à la fin de l'outil.
// 3. Le flux de la page lâche aussi le regard quand la réponse commence, à l'humeur de fin de tour, au message, quand le
//    flux est coupé, et au bouton « Arrêter ».
// RAPIDITE_SRC : dossier d'une autre copie de src (pour rejouer l'essai sur l'ancienne version).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ui = readFileSync(process.env.RAPIDITE_SRC ? join(process.env.RAPIDITE_SRC, 'web', 'ui.html') : fileURLToPath(new URL('../src/web/ui.html', import.meta.url)), 'utf8');
const dormir = (ms: number) => new Promise((x) => setTimeout(x, ms));

/** Le bloc « il cherche » de la page, avec un silence raccourci, et des doublures du visage. */
function bloc(silenceMs: number) {
  const debut = ui.indexOf('const CHERCHE'), fin = ui.indexOf("document.addEventListener('DOMContentLoaded', () => moodBase('neutre'));");
  assert.ok(debut > 0 && fin > debut, 'bloc « il cherche » introuvable dans ui.html');
  const code = ui.slice(debut, fin).replace(/CHERCHE_SILENCE_MS = \d+/, `CHERCHE_SILENCE_MS = ${silenceMs}`).replace(/setTimeout\(chercheFin, 180000\)/g, `setTimeout(chercheFin, ${silenceMs * 1000})`);
  const etat = { tenu: 0, flashs: 0 };
  const ctx = vm.createContext({ setTimeout: (f: () => void, ms: number) => { const t = setTimeout(f, ms); t.unref(); return t; }, clearTimeout, moodHold: () => { etat.tenu++; }, moodRelease: () => { etat.tenu--; }, moodFlash: () => { etat.flashs++; } });
  vm.runInContext(`${code}\nthis.moodFromEvent = moodFromEvent; this.chercheFin = chercheFin;`, ctx);
  return { etat, evt: (e: object) => (ctx as unknown as { moodFromEvent(e: object): void }).moodFromEvent(e) };
}

test('le regard reste tenu tant que la recherche vit, et se lâche après un silence (tour fini sans message)', async () => {
  const b = bloc(150);
  b.evt({ type: 'tool_start', name: 'web_research', input: {} });
  assert.equal(b.etat.tenu, 1);
  for (let i = 0; i < 6; i++) { await dormir(60); b.evt({ type: 'etape', texte: `étape ${i}` }); }
  assert.equal(b.etat.tenu, 1, 'des étapes arrivent : toujours tenu');
  await dormir(400);
  assert.equal(b.etat.tenu, 0, 'plus rien du tour : le regard est lâché');
});

test('le regard est lâché à la fin de l\'outil', () => {
  const b = bloc(10_000);
  b.evt({ type: 'tool_start', name: 'web_search', input: {} });
  b.evt({ type: 'tool_end', name: 'web_search', ok: true, preview: '' });
  assert.equal(b.etat.tenu, 0);
});

test('le flux de la page lâche le regard : réponse qui commence, humeur de fin, message, flux coupé, « Arrêter »', () => {
  assert.match(ui, /d\.peer === peer && \(d\.type === 'message' \|\| \(d\.type === 'event' && \(d\.event\.type === 'mood' \|\| d\.event\.type === 'delta'\)\)\)\) chercheFin\(\)/, 'réponse, humeur ou message → lâché');
  assert.match(ui, /es\.onerror = async \(\) => \{\s*es\.close\(\); chercheFin\(\);/, 'flux coupé → lâché');
  assert.match(ui, /\$\('#stopBtn'\)\.addEventListener\('click', \(\) => \{ chercheFin\(\);/, '« Arrêter » → lâché');
});
