// Constat de la relecture « Noûs dans Odin » : un membre de la maison pouvait changer les réglages de Soul et écrire
// dans Brain par /api/brain/*. Comme Archytas, Kéryx et Métis : propriétaire SEUL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RACINE_APPLI } from '../src/heimdall/noyau.ts';

test('/api/brain/* (lecture et écriture, Soul compris) : un membre est refusé AVANT toute route Brain', () => {
  const s = readFileSync(join(RACINE_APPLI, 'src', 'web', 'server.ts'), 'utf8');
  const garde = s.search(/if \(url\.pathname\.startsWith\('\/api\/brain\/'\) && estMembre\(req\)\) return json\(res, 403/);
  assert.ok(garde > 0, 'la garde des membres existe');
  const routes = [...s.matchAll(/url\.pathname\.startsWith\('\/api\/brain\/'\)\) \{/g)].map((m) => m.index!);
  assert.ok(routes.length >= 2, 'routes GET et POST de Brain');
  for (const r of routes) assert.ok(garde < r, 'la garde passe avant chaque route Brain');
});
