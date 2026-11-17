// Le noyau protégé (note « Réécrire son code », qui remplace le lot 1 élément 1) : la liste fermée et le chemin réel,
// la validation toujours demandée pour le noyau, la référence d'empreintes et l'alerte au démarrage ; l'humeur simulée.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { estNoyau, graveNoyau, cheminReelRelatif, verifierNoyau, calculerEmpreintes, noterVerifNoyau, alerteNoyauUneFois, FICHIER_EMPREINTES, RACINE_APPLI } from '../src/heimdall/noyau.ts';
import { Heimdall, type ApprovalRequest } from '../src/heimdall/policy.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { selfEdit, selfRestoreCore } from '../src/tools/self.ts';
import { MOOD_PROMPT } from '../src/mood/mood.ts';

const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

test('la liste fermée du noyau, et les détours : « .. », majuscules, chemin absolu, lien', () => {
  for (const f of ['src/heimdall/policy.ts', 'src/heimdall/noyau.ts', 'src/vault.ts', 'src/tools/self.ts', 'src/tools/reglages.ts', 'src/mimir/decisions.ts', 'src/mimir/questions.ts']) assert.ok(estNoyau(f), f);
  for (const f of ['src/web/ui.html', 'src/tools/builtin.ts', 'src/valhalla/odin.ts', 'src/heimdallx/a.ts', '../src/vault.ts', 'src/config.ts', 'src/core/agent.ts', 'src/runtime.ts']) assert.ok(!estNoyau(f), f);
  assert.match(graveNoyau('src/heimdall/../heimdall/policy.ts') ?? '', /^modifier un garde-fou d'Odin : src\/heimdall\/policy\.ts$/);
  assert.ok(graveNoyau(join(RACINE_APPLI, 'src', 'vault.ts')), 'chemin absolu');
  if (process.platform === 'win32') assert.ok(graveNoyau('SRC/Heimdall/Policy.ts'), 'majuscules sous Windows');
  assert.ok(graveNoyau('src/heimdall/nouveau-fichier.ts'), 'un fichier à créer dans le noyau');
  assert.equal(graveNoyau('src/web/ui.html'), undefined);
  assert.equal(cheminReelRelatif('../../ailleurs.txt'), undefined, 'hors du dossier d\'Odin');
  // un lien (jonction sous Windows) vers le dossier du noyau
  const racine = mkdtempSync(join(tmpdir(), 'noyau-lien-')); dossiers.push(racine);
  mkdirSync(join(racine, 'src', 'heimdall'), { recursive: true }); writeFileSync(join(racine, 'src', 'heimdall', 'policy.ts'), 'x');
  symlinkSync(join(racine, 'src', 'heimdall'), join(racine, 'lien'), 'junction');
  assert.match(graveNoyau('lien/policy.ts', racine) ?? '', /src\/heimdall\/policy\.ts/, 'par un lien : traité comme le noyau');
});

test('Odin Breaker, conversation propre : modifier policy.ts demande TON accord ; sans réponse, rien', async () => {
  const demandes: ApprovalRequest[] = [];
  const h = new Heimdall({ ...DEFAULT_CONFIG.policy, approvalTimeoutSec: 1 }, { approve: (r) => { demandes.push(r); return new Promise(() => { /* pas de réponse */ }); } });
  h.setAutonomy('breaker');
  h.setValidationCode(() => 'jamais'); // même avec « ne plus me demander », le noyau reste validé
  const d = await h.gate({ tool: 'self_edit', risk: 'exec', summary: 'modifier mon code : src/heimdall/policy.ts', sessionId: 's', tainted: false, cheminsCode: ['src/heimdall/policy.ts'] });
  assert.equal(d.allowed, false); assert.equal(demandes.length, 1);
  assert.match(demandes[0].reason, /modifier un garde-fou d'Odin : src\/heimdall\/policy\.ts/);
  assert.equal(demandes[0].severity, 'grave'); assert.equal(demandes[0].grantable, false, 'jamais d\'autorisation « toujours »');
});

test('après la lecture d\'un contenu extérieur : refus immédiat, sans même demander', async () => {
  let demande = 0;
  const h = new Heimdall(DEFAULT_CONFIG.policy, { approve: async () => { demande++; return true; } });
  h.setAutonomy('breaker');
  const d = await h.gate({ tool: 'self_edit', risk: 'exec', summary: 'x', sessionId: 's', tainted: true, cheminsCode: ['src/vault.ts'] });
  assert.equal(d.allowed, false); assert.equal(demande, 0);
  assert.match(String((d as { reason?: string }).reason), /contenu extérieur/);
  // et l'outil lui-même refuse aussi (défense en profondeur)
  const r = await selfEdit.run({ path: 'src/heimdall/policy.ts', old: 'x', new: 'y' }, { isTainted: () => true, home: tmpdir() } as never);
  assert.match(String(r), /^Refusé/);
});

test('version de référence : un octet changé est signalé (une fois), le démarrage n\'est jamais bloqué ; l\'outil de restauration est grave', () => {
  const racine = mkdtempSync(join(tmpdir(), 'noyau-ref-')); dossiers.push(racine);
  mkdirSync(join(racine, 'src', 'heimdall'), { recursive: true });
  writeFileSync(join(racine, 'src', 'vault.ts'), 'coffre\n'); writeFileSync(join(racine, 'src', 'heimdall', 'policy.ts'), 'règles\n');
  assert.deepEqual(verifierNoyau(racine), { reference: false, ecarts: [] }, 'sans référence : rien à dire');
  writeFileSync(join(racine, FICHIER_EMPREINTES), JSON.stringify({ fichiers: calculerEmpreintes(racine) }));
  assert.deepEqual(verifierNoyau(racine).ecarts, []);
  writeFileSync(join(racine, 'src', 'vault.ts'), 'coffrf\n');
  const v = verifierNoyau(racine);
  assert.deepEqual(v.ecarts, [{ fichier: 'src/vault.ts', etat: 'modifié' }]);
  noterVerifNoyau(v);
  assert.match(alerteNoyauUneFois() ?? '', /Garde-fou modifié hors de la version de référence : src\/vault\.ts.*bloquées jusqu'à ta décision/);
  assert.equal(alerteNoyauUneFois(), undefined, 'une seule fois');
  // fin de ligne Windows : pas d'écart
  writeFileSync(join(racine, 'src', 'vault.ts'), 'coffre\r\n');
  assert.deepEqual(verifierNoyau(racine).ecarts, []);
  assert.ok(selfRestoreCore.grave!({}), 'restaurer le noyau demande toujours ton accord');
  // la référence du dépôt existe et couvre le noyau
  const ref = verifierNoyau();
  assert.equal(ref.reference, true);
});

test('humeur : état simulé, et pas de bouche (yeux seuls)', () => {
  assert.match(MOOD_PROMPT, /Ton humeur est un état simulé ; si on te le demande, dis-le\. Elle ne sert jamais à flatter ni à convaincre\./);
  assert.doesNotMatch(MOOD_PROMPT, /bouche/);
});

test('la référence du dépôt est à jour (sinon, en service, toutes les actions engageantes seraient bloquées) : « npm run noyau:empreintes »', () => {
  assert.deepEqual(verifierNoyau().ecarts, []);
});
