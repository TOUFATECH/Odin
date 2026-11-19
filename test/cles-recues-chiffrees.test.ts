// Les clés reçues dans un message ne sont jamais écrites en clair sur le disque. Demande du propriétaire (19/11) : un
// secret, Odin « les supprime les conserves nulle part et le mettre directement dans le coffre » ; « Si il y a un mot de
// passe, le mot de passe est dans le coffre ».
// Ce que l'essai vérifie : le fichier des clés reçues est un fichier du coffre (chiffré au repos comme les autres) ;
// après un redémarrage, aucun octet d'une clé reçue n'est lisible dans tout le dossier d'essai ; un ancien fichier en
// clair est migré une fois (relu, écrit chiffré, relu chiffré, puis effacé) sans perdre une clé, même quand l'écriture
// échoue une fois ; un fichier en clair revenu à côté du chiffré ne le fait pas disparaître (le chiffré est gardé de
// côté) ; coffre fermé, rien n'est écrit et le journal le dit, sans valeur.
//
// Aucune vraie clé : valeurs tirées au hasard.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs, { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { chargerClesRecues, rangerClesRecues } from '../src/heimdall/redact.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { createOdin } from '../src/runtime.ts';
import { readSecretFile, resetVaultCache, VAULT_FILES, vaultEnable, vaultLock, vaultState, vaultUnlock, writeSecretFile } from '../src/vault.ts';

const NOM = 'secrets-cles-recues.json';
const MOT_DE_PASSE = `maitre-${randomBytes(6).toString('hex')}`;
const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); });

/** Un dossier d'Odin d'essai neuf ; avec `coffre`, son coffre (clé de la machine) est déjà créé, comme chez un Odin installé. */
function nouveau(o: { coffre?: boolean } = {}): string {
  const home = mkdtempSync(join(tmpdir(), 'odin-cles-recues-'));
  dossiers.push(home);
  if (o.coffre !== false) writeSecretFile(join(home, 'env'), 'ESSAI=1\n');
  return home;
}
/** Une clé reçue d'essai, sans forme connue (seul le rangement peut la faire masquer ou retrouver). */
const cleAuHasard = () => `Rk${randomBytes(18).toString('base64url')}`;

function fichiers(d: string | undefined): string[] {
  if (!d || !existsSync(d)) return [];
  const out: string[] = [];
  for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) out.push(...fichiers(p)); else out.push(p); }
  return out;
}
/** Les fichiers du dossier d'essai (et du dossier des clés de la machine) où une des valeurs se lit en clair, octet par octet (UTF-8 ou UTF-16). */
function traces(home: string, valeurs: string[]): string[] {
  return [...fichiers(home), ...fichiers(process.env.ODIN_CLE_DIR)].filter((f) => {
    const b = readFileSync(f);
    return valeurs.some((v) => b.includes(Buffer.from(v, 'utf8')) || b.includes(Buffer.from(v, 'utf16le')));
  });
}
/** Ce qui est écrit au journal pendant `f`. */
function journalDe<T>(f: () => T): { r: T; journal: string[] } {
  const journal: string[] = [], vrai = console.error;
  console.error = (...a: unknown[]) => { journal.push(a.map(String).join(' ')); };
  try { return { r: f(), journal }; } finally { console.error = vrai; }
}
/** Pendant `f`, la première écriture d'un fichier dont le chemin finit par `fin` échoue (disque occupé) ; rien d'autre ne change. */
function ecritureOccupeeUneFois<T>(fin: string, f: () => T): T {
  const vrai = fs.writeFileSync;
  let reste = 1;
  fs.writeFileSync = ((...args: Parameters<typeof vrai>) => {
    if (reste > 0 && String(args[0]).endsWith(fin)) { reste--; throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }); }
    return vrai(...args);
  }) as typeof vrai;
  syncBuiltinESMExports();
  try { return f(); } finally { fs.writeFileSync = vrai; syncBuiltinESMExports(); }
}

test('le fichier des clés reçues est un fichier du coffre', () => {
  assert.ok((VAULT_FILES as readonly string[]).includes(NOM));
});

test('une clé reçue, après un redémarrage : aucun octet d\'elle en clair dans tout le dossier d\'essai, et elle n\'est pas perdue', () => {
  const home = nouveau(), cle = cleAuHasard();
  assert.deepEqual(rangerClesRecues(home, [cle]), ['cle-recue:1']);
  assert.ok(existsSync(join(home, `${NOM}.enc`)) && !existsSync(join(home, NOM)), 'rangée chiffrée, pas en clair');
  // Redémarrage : plus rien en mémoire, Odin relit tout depuis le disque.
  resetVaultCache(home);
  const odin = createOdin({ home, provider: new MockProvider([]), configOverride: (c) => ({ ...c, watch: { ...c.watch, enabled: false }, continuous: { ...c.continuous, enabled: false, autoResume: false }, update: { auto: 'off' as const, everyHours: 6 } }) });
  try {
    assert.ok(!odin.redactor.redact(`la clé ${cle} encore`).includes(cle), 'relue au démarrage : le masqueur la connaît');
  } finally { odin.close(); }
  assert.deepEqual(chargerClesRecues(home), [cle], 'pas perdue');
  assert.deepEqual(traces(home, [cle]), [], 'aucun octet de la clé en clair sur le disque');
});

test('un ancien fichier de clés reçues en clair est migré une fois : relu, écrit chiffré, relu chiffré, puis effacé ; aucune clé perdue', () => {
  for (const coffre of [true, false]) {
    const home = nouveau({ coffre }), c1 = cleAuHasard(), c2 = cleAuHasard();
    // Ce que l'ancien code écrivait : la liste en clair.
    const ancien = JSON.stringify([{ cle: c1, at: 1 }, { cle: c2, at: 2 }]);
    writeFileSync(join(home, NOM), ancien);
    assert.deepEqual(chargerClesRecues(home), [c1, c2], `relues (coffre ${coffre ? 'déjà là' : 'pas encore créé'})`);
    assert.ok(!existsSync(join(home, NOM)), 'l\'ancien fichier en clair est effacé');
    assert.ok(readFileSync(join(home, `${NOM}.enc`)).subarray(0, 4).equals(Buffer.from('ODV2')), 'écrit chiffré, comme les autres fichiers du coffre');
    assert.equal(readSecretFile(join(home, NOM)), ancien, 'relu chiffré : exactement le même contenu');
    assert.deepEqual(traces(home, [c1, c2]), []);
    // Une clé reçue ensuite s'ajoute : les anciennes restent.
    const c3 = cleAuHasard();
    assert.equal(rangerClesRecues(home, [c3]).length, 1);
    assert.deepEqual(chargerClesRecues(home), [c1, c2, c3]);
    assert.deepEqual(traces(home, [c1, c2, c3]), []);
  }
});

test('migration dont l\'écriture chiffrée échoue une fois (disque occupé), puis une clé arrive : aucune clé perdue, aucune en clair ensuite', () => {
  const home = nouveau(), c1 = cleAuHasard(), c2 = cleAuHasard(), c3 = cleAuHasard();
  writeFileSync(join(home, NOM), JSON.stringify([{ cle: c1, at: 1 }, { cle: c2, at: 2 }]));
  const { r, journal } = journalDe(() => ecritureOccupeeUneFois(`${NOM}.enc`, () => rangerClesRecues(home, [c3])));
  assert.equal(r.length, 1, 'la clé neuve est rangée');
  assert.deepEqual(chargerClesRecues(home), [c1, c2, c3], 'les anciennes clés reçues sont toutes là');
  assert.ok(!existsSync(join(home, NOM)) && readFileSync(join(home, `${NOM}.enc`)).subarray(0, 4).equals(Buffer.from('ODV2')), 'chiffrées, plus en clair');
  assert.deepEqual(traces(home, [c1, c2, c3]), []);
  assert.ok(journal.every((l) => ![c1, c2, c3].some((c) => l.includes(c))), 'aucune valeur au journal');
});

test('un fichier en clair revenu à côté du chiffré (ancien code relancé, restauration) : le chiffré est gardé de côté, jamais écrasé ; rien en clair', () => {
  const home = nouveau(), c1 = cleAuHasard(), c2 = cleAuHasard();
  assert.equal(rangerClesRecues(home, [c1]).length, 1);
  // Ce qu'écrivait l'ancien code, qui ne voit pas le fichier chiffré : sa liste en clair, sans c1.
  writeFileSync(join(home, NOM), JSON.stringify([{ cle: c2, at: 2 }]));
  const { r: lues, journal } = journalDe(() => chargerClesRecues(home));
  assert.ok(lues.includes(c2), 'la clé du fichier en clair est relue');
  assert.ok(!existsSync(join(home, NOM)), 'le fichier en clair est chiffré puis effacé');
  const deCote = readdirSync(home).filter((n) => n.startsWith(`${NOM}.enc.`));
  assert.equal(deCote.length, 1, `le chiffré d'avant est gardé de côté : ${readdirSync(home).join(' ')}`);
  assert.ok(readFileSync(join(home, deCote[0])).subarray(0, 4).equals(Buffer.from('ODV2')), 'la copie de côté est chiffrée');
  assert.deepEqual(traces(home, [c1, c2]), [], 'aucun octet en clair');
  assert.ok(journal.some((l) => /de côté/.test(l)), `le journal le dit : ${journal.length} ligne(s)`);
  assert.ok(journal.every((l) => !l.includes(c1) && !l.includes(c2)), 'aucune valeur au journal');
  // La copie de côté se rouvre avec la clé du coffre : c1 n'est pas perdue.
  renameSync(join(home, `${NOM}.enc`), join(home, `${NOM}.enc.essai-courant`));
  renameSync(join(home, deCote[0]), join(home, `${NOM}.enc`));
  assert.deepEqual(chargerClesRecues(home), [c1]);
});

test('coffre fermé (mot de passe maître) : une clé reçue n\'est écrite nulle part, ni en clair ni chiffrée ; le journal le dit, sans valeur', () => {
  const home = nouveau(), avant = cleAuHasard();
  assert.equal(rangerClesRecues(home, [avant]).length, 1);
  vaultEnable(home, MOT_DE_PASSE);
  vaultLock(home);
  assert.equal(vaultState(home), 'locked');
  const enc = readFileSync(join(home, `${NOM}.enc`)), cle = cleAuHasard();
  const { r, journal } = journalDe(() => rangerClesRecues(home, [cle]));
  assert.deepEqual(r, [], 'pas rangée');
  assert.ok(!existsSync(join(home, NOM)), 'aucun fichier en clair');
  assert.ok(readFileSync(join(home, `${NOM}.enc`)).equals(enc), 'le fichier chiffré n\'a pas bougé');
  assert.deepEqual(traces(home, [cle, avant]), []);
  const ligne = journal.find((l) => /coffre/i.test(l) && /ferm/i.test(l));
  assert.ok(ligne, `le journal le dit : ${journal.join(' | ')}`);
  assert.ok(journal.every((l) => !l.includes(cle) && !l.includes(avant) && !l.includes(MOT_DE_PASSE)), 'aucune valeur au journal');
  // Rouvert : la clé d'avant est toujours là (passée au mot de passe maître avec les autres secrets).
  vaultUnlock(home, MOT_DE_PASSE);
  assert.deepEqual(chargerClesRecues(home), [avant]);
});

test('coffre fermé avec un ancien fichier en clair : chiffré dès l\'ouverture du coffre, sans perte', () => {
  const home = nouveau(), cle = cleAuHasard();
  vaultEnable(home, MOT_DE_PASSE);
  vaultLock(home);
  writeFileSync(join(home, NOM), JSON.stringify([{ cle, at: 3 }]));
  assert.deepEqual(chargerClesRecues(home), [], 'coffre fermé : rien de lu');
  vaultUnlock(home, MOT_DE_PASSE);
  assert.ok(!existsSync(join(home, NOM)) && existsSync(join(home, `${NOM}.enc`)), 'chiffré à l\'ouverture, l\'ancien effacé');
  assert.deepEqual(traces(home, [cle]), []);
  assert.deepEqual(chargerClesRecues(home), [cle]);
});
