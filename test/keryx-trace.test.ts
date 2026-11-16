// Kéryx — la chronologie : écriture chiffrée au repos, relecture en clair, repli fichier (sans PostgreSQL), bornes de
// lecture, et effacement RÉEL. UN FICHIER À LA FOIS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configurerTrace, effacer, lire, majAction, tracer } from '../src/valhalla/keryx/trace.ts';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'keryx-trace-'));

test('écriture chiffrée + relecture + effacement réel (repli fichier, sans base)', async () => {
  const home = tmp(); configurerTrace(home);
  try {
    const id1 = await tracer({ quand: '2026-11-16T10:00:00.000Z', canal: 'keryx', pair: '+33612345678', sens: 'entrant', texte: 'Bonjour Odin' });
    const id2 = await tracer({ quand: '2026-11-16T11:00:00.000Z', canal: 'keryx', pair: '+33612345678', sens: 'action', texte: '', action: { outil: 'mail_send', resume: 'écrire à Paul', confirmee: false, gravite: 'important' }, resultat: 'en_attente' });
    const l = await lire({});
    assert.equal(l.length, 2);
    assert.equal(l[0].quand, '2026-11-16T11:00:00.000Z', 'le plus récent d\'abord');
    assert.equal(l[1].texte, 'Bonjour Odin', 'texte déchiffré');
    assert.equal(l[0].action?.resume, 'écrire à Paul', 'résumé d\'action déchiffré');

    // Sur le disque, rien n'est en clair (champs sensibles chiffrés odc1:…).
    const brut = readFileSync(join(home, 'valhalla', 'keryx', 'journal.jsonl'), 'utf8');
    assert.doesNotMatch(brut, /Bonjour Odin|\+33612345678|écrire à Paul/, 'aucune donnée privée en clair');
    assert.match(brut, /odc1:/, 'champs chiffrés');

    // Bornes : avant / n.
    assert.equal((await lire({ avant: '2026-11-16T11:00:00.000Z' })).length, 1);
    assert.equal((await lire({ n: 1 })).length, 1);

    // Effacement réel, ciblé puis total.
    assert.equal(await effacer({ id: id1 }), 1);
    const l2 = await lire({});
    assert.equal(l2.length, 1); assert.equal(l2[0].id, id2);
    assert.equal(await effacer({ tout: true }), 1);
    assert.equal((await lire({})).length, 0);
    assert.equal(await effacer({ tout: true }), 0, 'plus rien à effacer');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('état d\'une action : passe de « en attente » à « faite » (puis « refusée »), ne reste pas figé', async () => {
  // Régression du défaut : la trace d'une action restait toujours confirmee:false / en_attente. majAction la met à jour.
  const home = tmp(); configurerTrace(home);
  try {
    const id = await tracer({ quand: '2026-11-16T12:00:00.000Z', canal: 'keryx', pair: '42', sens: 'action', texte: '', action: { outil: 'mail_send', resume: 'écrire à Paul', confirmee: false, gravite: 'important' }, resultat: 'en_attente' });
    assert.equal((await lire({}))[0].resultat, 'en_attente');
    // Succès → faite + confirmée.
    assert.equal(await majAction(id, { confirmee: true, resultat: 'faite' }), true);
    let l = (await lire({}))[0];
    assert.equal(l.resultat, 'faite'); assert.equal(l.action?.confirmee, true);
    assert.equal(l.action?.resume, 'écrire à Paul', 'le champ chiffré reste lisible après mise à jour');
    // Un autre scénario : refus.
    assert.equal(await majAction(id, { confirmee: false, resultat: 'refusee' }), true);
    l = (await lire({}))[0];
    assert.equal(l.resultat, 'refusee'); assert.equal(l.action?.confirmee, false);
    // Un id inconnu ne casse rien.
    assert.equal(await majAction('inconnu', { resultat: 'faite' }), false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
