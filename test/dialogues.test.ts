import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// L'interface ne doit plus jamais ouvrir les fenêtres du navigateur (confirm, alert, prompt) :
// elle passe par OdinDialog (src/web/dialog.js), au style du thème d'Odin.
const WEB = new URL('../src/web/', import.meta.url);

function fichiers(dossier: URL, rel = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(new URL(rel, dossier), { withFileTypes: true })) {
    const r = rel + e.name;
    if (e.isDirectory()) out.push(...fichiers(dossier, `${r}/`));
    else if (/\.(js|html)$/.test(e.name) && r !== 'dialog.js') out.push(r);
  }
  return out;
}

// Un appel natif : confirm( / alert( / prompt( seul, ou précédé de window. ou globalThis.
// Les appels de méthode d'un autre objet (OdinDialog.confirm(, installEvt.prompt(, ag.alert(…) ne comptent pas.
const NATIF = /(?:^|[^.\w$])(?:(?:window|globalThis|self)\s*\.\s*)?(confirm|alert|prompt)\s*\(/g;

test('aucune fenêtre native du navigateur dans l\'interface web', () => {
  const trouves: string[] = [];
  for (const f of fichiers(WEB)) {
    const lignes = readFileSync(new URL(f, WEB), 'utf8').split('\n');
    lignes.forEach((l, i) => {
      // une définition de fonction (function confirm(…) ou méthode confirm: …) n'est pas un appel
      const propre = l.replace(/\bfunction\s+(confirm|alert|prompt)\s*\(/g, '');
      for (const m of propre.matchAll(NATIF)) trouves.push(`${join('src/web', f)}:${i + 1} → ${m[0].trim()}`);
    });
  }
  assert.deepEqual(trouves, [], `Utilise OdinDialog à la place :\n${trouves.join('\n')}`);
});

test('dialog.js est servi et chargé par l\'interface', () => {
  const dlg = readFileSync(new URL('dialog.js', WEB), 'utf8');
  assert.match(dlg, /window\.OdinDialog\s*=/, 'dialog.js pose window.OdinDialog');
  for (const nom of ['confirm', 'alert', 'prompt']) assert.match(dlg, new RegExp(`\\b${nom}:`), `OdinDialog.${nom} existe`);
  assert.match(readFileSync(new URL('server.ts', WEB), 'utf8'), /'\/dialog\.js'/, 'le serveur sert /dialog.js');
  assert.match(readFileSync(new URL('ui.html', WEB), 'utf8'), /<script[^>]*src="\/dialog\.js"/, 'ui.html charge /dialog.js');
});
