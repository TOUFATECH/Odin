// Les règles de comportement au format Sigma : lecture du YAML, compilation, et évaluation d'un événement.
// Tout est pur et hors ligne. Les événements sont inventés et inoffensifs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { analyserCondition, chargerPlusieurs, chargerSigma, compilerRegle, evaluer, evaluerToutes, lireYaml } from '../src/valhalla/geri/sigma.ts';

test('YAML · lecture d\'un sous-ensemble : clés, imbrication, listes', () => {
  const o = lireYaml('title: Essai\nlogsource:\n  product: windows\ndetection:\n  selection:\n    Image: powershell.exe\n  condition: selection\ntags:\n  - attack.execution\n') as Record<string, any>;
  assert.equal(o.title, 'Essai');
  assert.equal(o.logsource.product, 'windows');
  assert.equal(o.detection.selection.Image, 'powershell.exe');
  assert.equal(o.detection.condition, 'selection');
  assert.deepEqual(o.tags, ['attack.execution']);
});

test('Condition · analyse de « selection and not filtre »', () => {
  const n = analyserCondition('selection and not filtre') as any;
  assert.equal(n.type, 'et');
  assert.equal(n.sous[0].nom, 'selection');
  assert.equal(n.sous[1].type, 'not');
});

test('Sigma · un processus suspect correspond, un processus normal non', () => {
  const regle = chargerSigma(`title: PowerShell encodé\nlevel: high\ndetection:\n  selection:\n    Image|endswith: \\\\powershell.exe\n    CommandLine|contains: ' -enc '\n  condition: selection\ntags:\n  - attack.t1059\n`);
  const suspect = evaluer({ Image: 'C:\\\\Windows\\\\System32\\\\powershell.exe', CommandLine: 'powershell -enc ZQBjAGgAbwA=' }, regle);
  assert.equal(suspect.correspond, true);
  assert.equal(suspect.niveau, 'high');
  const normal = evaluer({ Image: 'C:\\\\Windows\\\\explorer.exe', CommandLine: 'explorer' }, regle);
  assert.equal(normal.correspond, false);
});

test('Sigma · « selection and not filtre » : le filtre écarte un cas légitime', () => {
  const regle = chargerSigma(`title: Tâche planifiée créée\ndetection:\n  selection:\n    Image|endswith: \\\\schtasks.exe\n    CommandLine|contains: /create\n  filtre:\n    CommandLine|contains: GoogleUpdate\n  condition: selection and not filtre\n`);
  assert.equal(evaluer({ Image: 'C:\\\\Windows\\\\System32\\\\schtasks.exe', CommandLine: 'schtasks /create /tn maj' }, regle).correspond, true, 'persistance repérée');
  assert.equal(evaluer({ Image: 'C:\\\\Windows\\\\System32\\\\schtasks.exe', CommandLine: 'schtasks /create /tn GoogleUpdateTask' }, regle).correspond, false, 'le filtre évite la fausse alerte');
});

test('Sigma · quantificateur « 1 of selection* »', () => {
  const regle = chargerSigma(`title: Persistance registre\ndetection:\n  selection_run:\n    TargetObject|contains: \\\\CurrentVersion\\\\Run\n  selection_service:\n    TargetObject|contains: \\\\Services\\\\\n  condition: 1 of selection*\n`);
  assert.equal(evaluer({ TargetObject: 'HKLM\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run\\\\x' }, regle).correspond, true);
  assert.equal(evaluer({ TargetObject: 'HKLM\\\\System\\\\CurrentControlSet\\\\Services\\\\x' }, regle).correspond, true);
  assert.equal(evaluer({ TargetObject: 'HKLM\\\\Software\\\\truc' }, regle).correspond, false);
});

test('Sigma · plusieurs règles, les plus graves d\'abord ; une règle cassée est écartée', () => {
  const texte = `title: A\nlevel: medium\ndetection:\n  selection:\n    Image|endswith: evil.exe\n  condition: selection\n---\ntitle: B\nlevel: critical\ndetection:\n  selection:\n    Image|endswith: evil.exe\n  condition: selection\n---\ntitle: Cassée\n`;
  const { regles, ecartees } = chargerPlusieurs(texte);
  assert.equal(regles.length, 2);
  assert.equal(ecartees, 1, 'la règle sans détection est écartée, pas appliquée de travers');
  const hits = evaluerToutes({ Image: 'C:\\\\evil.exe' }, regles);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].niveau, 'critical', 'la plus grave en tête');
});

test('Sigma · compilation refusée si la détection manque', () => {
  assert.throws(() => compilerRegle({ title: 'vide', detection: {} as any }));
});
