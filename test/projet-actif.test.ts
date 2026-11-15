// Mnémosyne · Projet actif (index des fichiers d'un projet, réponses sourcées sans IA) et le réglage « Garder
// l'audio brut » (jamais gardé sans lui, jamais en mode privé, effacé à échéance, fermé aux outils de fichiers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSecretFile } from '../src/heimdall/policy.ts';
import { dossierProjets, indexerProjet, passages, projetActif, repondreProjet } from '../src/muninn/projet.ts';
import { audiosGardes, dossierAudio, garderAudio, purgerAudio } from '../src/voice/audio-brut.ts';

function projet(): string {
  const d = mkdtempSync(join(tmpdir(), 'projet-'));
  writeFileSync(join(d, 'README.md'), '# Relais domotique\n\nCe projet relie les capteurs Zigbee au serveur MQTT de la maison.\n\n## Installation\n\nLance `npm install` puis copie config.exemple.json en config.json.\n\n## Sauvegarde\n\nLes réglages sont sauvegardés chaque nuit à 3 h dans le dossier /srv/relais/sauvegardes.\n');
  mkdirSync(join(d, 'src'));
  writeFileSync(join(d, 'src', 'relais.ts'), ['// Relais MQTT', 'export const PORT_MQTT = 1883;', 'export function brancher(hote: string) {', '  // la reconnexion se fait toutes les 5 secondes', '  return `mqtt://${hote}:${PORT_MQTT}`;', '}', 'const token = "abc123secret";'].join('\n'));
  writeFileSync(join(d, '.env'), 'MQTT_PASSWORD=ne-jamais-lire');
  mkdirSync(join(d, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(d, 'node_modules', 'x', 'index.js'), 'sauvegarde nuit dans node_modules');
  writeFileSync(join(d, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
  return d;
}

test('passages : sections Markdown, blocs de lignes, secrets masqués', () => {
  const p = passages('a.md', '# Titre\nun\n## Deux\ndeux\npassword: hunter2\n');
  assert.equal(p.liste.length, 2); assert.equal(p.liste[1].titre, 'Deux'); assert.equal(p.liste[1].l, 3);
  assert.equal(p.masques, 1); assert.doesNotMatch(JSON.stringify(p.liste), /hunter2/);
});

test('projet actif : index en fichiers, sans les secrets ni node_modules ; réponses sourcées sans IA', () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-')), d = projet();
  try {
    assert.match(repondreProjet('sauvegarde', { home }).texte, /Aucun projet actif/);
    const f = indexerProjet(d, { home, nom: 'Relais' });
    assert.equal(f.nom, 'Relais'); assert.equal(f.fichiers, 2, 'README.md et src/relais.ts seulement');
    assert.ok(f.ignores >= 2, '.env et l\'image ignorés'); assert.equal(f.masques, 1, 'la ligne du jeton masquée');
    assert.equal(projetActif(home)?.id, f.id);
    const brut = readFileSync(join(dossierProjets(home), f.id, 'passages.jsonl'), 'utf8');
    assert.doesNotMatch(brut, /ne-jamais-lire|abc123secret|node_modules/);
    let r = repondreProjet('Quand se fait la sauvegarde des réglages ?', { home });
    assert.ok(r.trouve, r.texte);
    assert.equal(r.sources[0].fichier, 'README.md'); assert.match(r.sources[0].extrait, /chaque nuit à 3 h/);
    assert.match(r.texte, /README\.md, lignes? \d+/);
    r = repondreProjet('quel est le port MQTT', { home });
    assert.ok(r.trouve); assert.ok(r.sources.some((x) => x.fichier === 'src/relais.ts'), JSON.stringify(r.sources));
    r = repondreProjet('recette de la tarte aux pommes', { home });
    assert.equal(r.trouve, false); assert.match(r.texte, /Je n'ai rien trouvé dans le projet « Relais »/);
  } finally { rmSync(home, { recursive: true, force: true }); rmSync(d, { recursive: true, force: true }); }
});

test('audio brut : rien sans le réglage, rien en mode privé ; gardé (600) puis effacé à échéance', () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-')), son = new Uint8Array([1, 2, 3, 4]);
  try {
    assert.equal(garderAudio({ keepAudio: false }, son, 'audio/webm', { texte: 'bonjour' }, home), undefined);
    assert.equal(garderAudio(undefined, son, 'audio/webm', {}, home), undefined);
    assert.equal(garderAudio({ keepAudio: true, privateMode: true }, son, 'audio/webm', {}, home), undefined);
    assert.ok(!existsSync(dossierAudio(home)), 'aucun dossier créé tant que rien n\'est gardé');
    const vieux = new Date(Date.now() - 10 * 86_400_000);
    const f1 = garderAudio({ keepAudio: true, keepAudioDays: 7 }, son, 'audio/webm', { texte: 'ancien' }, home, vieux)!;
    const f2 = garderAudio({ keepAudio: true, keepAudioDays: 7 }, son, 'audio/wav', { texte: 'récent', source: 'micro' }, home)!;
    assert.ok(f2.endsWith('.wav'));
    assert.ok(!existsSync(f1), 'l\'ancien (10 jours > 7) est effacé au passage');
    const l = audiosGardes(home);
    assert.equal(l.length, 1); assert.equal(l[0].texte, 'récent'); assert.equal(l[0].source, 'micro');
    assert.ok(isSecretFile(f2), 'fermé aux outils de fichiers d\'Odin');
    // Réglage décoché : la surveillance d'Orphée efface tout.
    assert.equal(purgerAudio(home, 0), 1);
    assert.deepEqual(readdirSync(dossierAudio(home)), []);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
