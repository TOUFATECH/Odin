// Les réponses d'Argos sur un poste : tuer un processus, mettre un fichier en quarantaine, isoler le poste du réseau
// sauf Odin. Chaque réponse est grave (accord), réversible quand c'est possible, et journalisée. On vérifie ici qu'on
// construit la bonne commande (jamais exécutée dans l'essai : aucun vrai poste n'est touché), que l'isolation garde
// toujours Odin joignable, et que le journal garde la trace.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { commandeDeConsigne, consigneInverse, isolerPosix, isolerWindows, texteConsigne, verifierConsigne, type ConsigneReponse } from '../src/valhalla/compagnon/reponse.ts';
import { construireConsigne, journalReponses, journaliserAnnulation, journaliserReponse, raisonGrave } from '../src/valhalla/argos/reponse.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'argos-rep-'));

test('construire une consigne : refuse ce qui est incomplet, dit en clair ce qu\'elle fait', () => {
  assert.throws(() => construireConsigne('tuer', {}), /numéro/);
  assert.throws(() => construireConsigne('quarantaine', {}), /chemin/);
  assert.throws(() => construireConsigne('isoler', {}), /adresse IP d'Odin/);
  assert.throws(() => construireConsigne('isoler', { odin: 'odin' }), /adresse IP d'Odin/);
  const c = construireConsigne('tuer', { pid: 4321, nom: 'mineur.exe' });
  assert.equal(verifierConsigne(c), undefined);
  assert.match(texteConsigne(c, 'Portable-Pierre'), /arrêter le processus 4321.*Portable-Pierre/);
  assert.match(raisonGrave('isoler', 'NAS', { odin: '192.168.1.20' }), /couper NAS du réseau, sauf Odin/);
});

test('réversibilité : la quarantaine se défait, l\'isolation se défait, tuer ne se défait pas', () => {
  const now = 1_000;
  const q = construireConsigne('quarantaine', { fichier: '/tmp/x' }, now);
  const invQ = consigneInverse(q, 'id2', now)!;
  assert.equal(invQ.genre, 'liberer'); assert.equal(invQ.annuleId, q.id);
  const iso = construireConsigne('isoler', { odin: '10.0.0.1' }, now);
  assert.equal(consigneInverse(iso, 'id3', now)!.genre, 'rendre_reseau');
  assert.equal(consigneInverse(construireConsigne('tuer', { pid: 9 }, now), 'id4', now), undefined);
});

test('les commandes construites (jamais exécutées ici) : par système, et l\'isolation garde Odin joignable', () => {
  const tuer = construireConsigne('tuer', { pid: 4321 });
  assert.match(commandeDeConsigne(tuer, 'windows')!, /Stop-Process -Id 4321/);
  assert.match(commandeDeConsigne(tuer, 'linux')!, /kill -TERM 4321/);
  const quar = construireConsigne('quarantaine', { fichier: '/home/pierre/mechant' });
  assert.match(commandeDeConsigne(quar, 'linux')!, /mkdir -p .*quarantaine.*mv -f/);
  // Isolation : Odin, le DNS et le bouclage restent joignables, tout le reste est coupé.
  const win = isolerWindows('192.168.1.20');
  assert.match(win, /RemoteAddress '192\.168\.1\.20'/); assert.match(win, /RemotePort 53/); assert.match(win, /DefaultOutboundAction Block/);
  const lin = isolerPosix('linux', '192.168.1.20');
  assert.match(lin, /ip daddr 192\.168\.1\.20 accept/); assert.match(lin, /udp dport 53 accept/); assert.match(lin, /oif lo accept/);
  const mac = isolerPosix('macos', '192.168.1.20');
  assert.match(mac, /pass out quick to 192\.168\.1\.20/); assert.match(mac, /block all/);
});

test('le journal des réponses : chaque réponse lancée est tracée, et son annulation aussi', () => {
  const home = tmp();
  try {
    const c = construireConsigne('quarantaine', { fichier: '/tmp/mechant' }, 2_000);
    const { ligne, inverse } = journaliserReponse(home, 'Portable-Pierre', c, 'toi', 2_000);
    assert.equal(ligne.etat, 'lancée'); assert.equal(ligne.poste, 'Portable-Pierre'); assert.ok(inverse);
    const j = journalReponses(home, 'Portable-Pierre');
    assert.equal(j.length, 1); assert.match(j[0].texte, /mettre à l'écart/);
    // On annule : la consigne inverse est journalisée à son tour.
    journaliserAnnulation(home, 'Portable-Pierre', inverse!, 'toi', 3_000);
    assert.equal(journalReponses(home).length, 2);
    assert.equal(journalReponses(home)[0].genre, 'liberer', 'du plus récent au plus ancien');
    // Aucun vrai poste n'a été touché : rien n'exécute une commande ici.
    const c2 = construireConsigne('isoler', { odin: '10.0.0.1' }, 4_000) as ConsigneReponse;
    assert.equal(verifierConsigne(c2), undefined);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
