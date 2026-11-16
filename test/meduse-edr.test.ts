// Méduse (anti-malware) côté EDR : elle sait dire son état (pour la console Argos), et elle sait juger si une adresse
// est malveillante (pour les connexions sortantes des postes). Aucun service réel n'est contacté : on écrit une petite
// liste locale dans un dossier temporaire.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { estMalveillante, geri } from '../src/valhalla/modules/geri.ts';

const etat = geri.actions.find((a) => a.id === 'etat')!;

// ---- Défaut 2 : Méduse fournit un jugement d'adresse réutilisable par la console EDR ----
test('défaut 2 — estMalveillante reconnaît une IP des listes et laisse passer une IP saine', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meduse-'));
  try {
    writeFileSync(join(dir, 'listes.txt'), '# listes de test\n198.51.100.0/24\n203.0.113.66/32\n');
    const mauvaise = estMalveillante({ dir } as never);
    assert.equal(mauvaise('198.51.100.9'), true, 'dans un réseau listé');
    assert.equal(mauvaise('203.0.113.66'), true, 'adresse listée exacte');
    assert.equal(mauvaise('8.8.8.8'), false, 'adresse saine');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- Défaut 1 : l'état de Méduse dit « à regarder » (ok=false) quand les listes sont en retard ----
test('défaut 1 — l\'état de Méduse est en échec (ok=false) quand les listes n\'ont jamais été mises à jour', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meduse-'));
  try {
    const r = etat.run({ dir, settings: {}, now: () => new Date() } as never, {}) as { ok?: boolean; text: string };
    assert.equal(r.ok, false, 'ok=false : la console Argos le colorera « à regarder »');
    assert.match(r.text, /jamais|retard/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('défaut 1 — l\'état de Méduse est bon (ok=true) quand les listes sont récentes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meduse-'));
  try {
    const r = etat.run({ dir, settings: { listsAt: new Date().toISOString() }, now: () => new Date() } as never, {}) as { ok?: boolean };
    assert.notEqual(r.ok, false, 'ok n\'est pas false quand c\'est à jour');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
