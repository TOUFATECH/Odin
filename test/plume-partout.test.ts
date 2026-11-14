// Plume partout : le correcteur en direct (dictionnaire français, règles sûres, vitesse), les routes /api/plume/* sur un
// vrai Odin (propriétaire, Pégase, sans connexion), Désactiver qui coupe tout (et l'IA ne s'en sert plus), le
// script de Pégase à jour. Contrat : docs/plume-protocole.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { T } from './banc/lib.ts';
import { vraiOdin, COMPTE } from './banc/odin-vrai.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';
import { dicoFrancais, distance1, motJuste, propositions } from '../src/valhalla/snotra/orthographe.ts';
import { appelsDeLIA, fautesFrancais, indiceIA } from '../src/valhalla/snotra/partout.ts';
import { docx } from '../src/valhalla/modules/snotra.ts';

const MDP_AWA = COMPTE.password;

test('orthographe : le dictionnaire français (Hunspell, lu par Odin) reconnaît les formes et propose', () => {
  const d = dicoFrancais();
  for (const w of ['maison', 'maisons', 'mangeait', 'finissons', 'rappelle', 'rendez-vous', 'restaurant', 'prochaine', 'désolé', 'déjà', 'aujourd’hui', 'l’homme', 'qu’il', 'jusqu’au', 'Prends', 'chevaux', 'courriel']) assert.ok(motJuste(d, w), w);
  for (const w of ['prochin', 'matain', 'restorant', 'deja', 'manjer']) assert.ok(!motJuste(d, w), w);
  assert.equal(propositions(d, 'prochin')[0].mot, 'prochain'); assert.equal(propositions(d, 'prochin')[0].genre, 'frappe');
  assert.equal(propositions(d, 'matain')[0].mot, 'matin');
  assert.equal(propositions(d, 'restorant')[0].mot, 'restaurant'); assert.equal(propositions(d, 'restorant')[0].genre, 'orthographe');
  assert.equal(propositions(d, 'deja')[0].mot, 'déjà');
  assert.equal(propositions(d, 'apeller')[0].mot, 'appeler');
  assert.equal(propositions(d, 'Prochin')[0].mot, 'Prochain', 'la majuscule est gardée');
  assert.ok(distance1('matain', 'matin') && distance1('ab', 'ba') && !distance1('restorant', 'restaurant'));
});

test('en direct : les exemples des maquettes, sûr plutôt que bavard, et rapide', () => {
  const f = fautesFrancais('Prends rendez vous avec Sami mardi prochin et rappelle moi la veille');
  assert.deepEqual(f.map((x) => [x.avant, x.genre, x.propositions[0]]), [['rendez vous', 'orthographe', 'rendez-vous'], ['prochin', 'frappe', 'prochain'], ['rappelle moi', 'grammaire', 'rappelle-moi']]);
  for (const x of f) assert.equal('Prends rendez vous avec Sami mardi prochin et rappelle moi la veille'.slice(x.debut, x.fin), x.avant);
  const g = fautesFrancais('Pour samedi matain : je voudrais prendre un rendez-vous, est ce que c\'est possible ?');
  assert.deepEqual(g.map((x) => [x.avant, x.genre]), [['matain', 'frappe'], ['est ce que', 'grammaire']], 'pas d\'espace insécable invisible proposée');
  assert.deepEqual(fautesFrancais('restorant italien mamoudzou', 'recherche').map((x) => x.propositions[0]), ['restaurant'], 'barre de recherche : pas de majuscule exigée, nom de lieu inconnu laissé');
  assert.deepEqual(fautesFrancais('Envoie-le à Mamoudzou, chez Odin et Pégase, sur https://exemple.fr/chemin_x ou awa@exemple.yt. Donne le livre à Paul.'), [], 'noms propres, adresses, e-mails, article après un impératif : rien');
  // Vitesse : un message de chat, dictionnaire déjà chargé.
  const t0 = performance.now(); for (let i = 0; i < 20; i++) fautesFrancais(`Bonjour, je voudrais savoir si tu peux m'aider demain matin pour le rendez-vous ${i} avec le garagiste, merci beaucoup.`); const ms = (performance.now() - t0) / 20;
  assert.ok(ms < 150, `${ms.toFixed(1)} ms par message`);
});

test('Plume partout sur un vrai Odin : routes, réglage par personne, Désactiver coupe tout (IA comprise), Pégase', { timeout: 180_000 }, async () => {
  const tt = new T();
  try {
    const v = await vraiOdin(tt, { compte: true, script: Array.from({ length: 12 }, () => ({ text: 'Odin, avec Plume : voilà.' })) }), va = valhallaOf()!;
    const corr = (texte: string, h: Record<string, string> = {}, ou = 'odin') => v.json('/api/plume/corriger', { texte, ou }, h);

    // Sans connexion : refusé ; sans x-odin (cookie) : refusé.
    assert.equal((await v.json('/api/plume/etat', undefined, { cookie: '' })).status, 401);
    assert.equal((await v.json('/api/plume/corriger', { texte: 'x' }, { cookie: '', 'x-odin': '' })).status, 401);
    assert.equal((await v.json('/api/plume/corriger', { texte: 'x' }, { 'x-odin': '' })).status, 403);
    // Clé d'API : le propriétaire.
    assert.equal((await v.json('/api/plume/etat', undefined, { authorization: `Bearer ${v.token}` })).body.actif, true);

    // État par défaut : tout activé.
    const e0 = (await v.json('/api/plume/etat')).body;
    assert.equal(e0.actif, true); assert.equal(e0.odin, true); assert.equal(e0.pegase, true); assert.equal(e0.ia, true); assert.equal(e0.correcteur, 'maison');
    // Corriger : les fautes, dans le format du contrat, vite.
    const t = 'Prends rendez vous avec Sami mardi prochin et rappelle moi la veille';
    let r = await corr(t); assert.equal(r.status, 200);
    const fautes = r.body.fautes as Array<{ id: string; debut: number; fin: number; genre: string; avant: string; propositions: string[]; raison: string; regle: string }>;
    assert.equal(fautes.length, 3); for (const f of fautes) { assert.equal(t.slice(f.debut, f.fin), f.avant); assert.match(f.id, /^[a-f0-9]{8}$/); assert.ok(f.raison); }
    const t0 = Date.now(); await corr('Un autre message, avec une fote de frappe pour voir.'); assert.ok(Date.now() - t0 < 150, `corriger en ${Date.now() - t0} ms`);
    assert.equal((await corr('x'.repeat(20_001))).status, 413);
    // Sans grammaire : plus de bleu.
    await v.json('/api/plume/reglages', { grammaire: false });
    assert.deepEqual(((await corr(t)).body.fautes as Array<{ genre: string }>).map((f) => f.genre), ['orthographe', 'frappe']);
    await v.json('/api/plume/reglages', { grammaire: true });
    // Ignorer et dictionnaire : retenus.
    await v.json('/api/plume/ignorer', { avant: 'rendez vous', regle: 'MOT_COMPOSE' });
    assert.deepEqual(((await corr(t)).body.fautes as Array<{ avant: string }>).map((f) => f.avant), ['prochin', 'rappelle moi']);
    assert.equal(((await v.json('/api/plume/dictionnaire', { ajouter: 'prochin' })).body.mots as string[]).join(), 'prochin');
    assert.deepEqual(((await corr(t)).body.fautes as Array<{ avant: string }>).map((f) => f.avant), ['rappelle moi']);
    assert.equal((await v.json('/api/plume/dictionnaire', { ajouter: 'deux mots' })).status, 400);
    await v.json('/api/plume/dictionnaire', { retirer: 'prochin' }); await v.json('/api/plume/ignorer', { oublier: true });
    assert.equal(((await corr(t)).body.fautes as unknown[]).length, 3);

    // L'IA s'en sert quand on lui demande de corriger (et le dit) : texte du message, puis document joint.
    const ia0 = appelsDeLIA();
    assert.equal(await indiceIA('quel temps fait-il ?'), '', 'pas une question d\'écriture : Plume n\'est pas appelé');
    assert.equal(appelsDeLIA(), ia0);
    const ind = await indiceIA('Corrige ce texte : « Prends rendez vous mardi prochin »');
    assert.match(ind, /Plume, le correcteur d'Odin, est activé/); assert.match(ind, /« prochin » → « prochain »/); assert.match(ind, /Odin, avec Plume/);
    const ws = v.o.paths.workspace; mkdirSync(join(ws, 'inbox'), { recursive: true }); writeFileSync(join(ws, 'inbox', 'devis-client.docx'), docx('Devis', 'Le devis pour samedi matain est pret, a peu près 300 euros.'));
    const indDoc = await indiceIA('Corrige-moi le fichier devis-client.docx', ws);
    assert.match(indDoc, /le document devis-client\.docx/); assert.match(indDoc, /« matain » → « matin »/);
    // Par le chemin des messages (interface web → passerelle → IA) : la consigne de Plume arrive à l'IA.
    const n0 = v.o.provider.calls.length;
    assert.equal((await v.json('/api/message', { text: 'Corrige ce texte : « il à mangé deja »' })).status, 202);
    for (let i = 0; i < 100 && v.o.provider.calls.length === n0; i++) await new Promise((x) => setTimeout(x, 50));
    const vu = JSON.stringify(v.o.provider.calls.at(-1)?.messages ?? []);
    assert.match(vu, /Plume, le correcteur d'Odin, est activé/, 'l\'IA reçoit ce que Plume a trouvé');

    // DÉSACTIVER : plus rien nulle part, et l'IA ne s'en sert plus.
    const off = (await v.json('/api/plume/reglages', { actif: false })).body;
    assert.equal(off.actif, false); assert.ok(typeof off.depuis === 'number');
    r = await corr(t); assert.deepEqual(r.body, { ok: true, actif: false, maj: off.maj, fautes: [] }, 'aucune correction, rien n\'est calculé');
    const ia1 = appelsDeLIA();
    assert.equal(await indiceIA('Corrige ce texte : « Prends rendez vous mardi prochin »'), '');
    const n1 = v.o.provider.calls.length;
    await v.json('/api/message', { text: 'Corrige ce texte : « il à mangé deja »' });
    for (let i = 0; i < 100 && v.o.provider.calls.length === n1; i++) await new Promise((x) => setTimeout(x, 50));
    const dernier = (v.o.provider.calls.at(-1)?.messages ?? []).filter((m) => m.role === 'user').at(-1);
    assert.match(JSON.stringify(dernier), /il à mangé deja/); assert.doesNotMatch(JSON.stringify(dernier), /Plume, le correcteur d'Odin/, 'Plume coupé : rien pour l\'IA');
    assert.equal(appelsDeLIA(), ia1, 'Plume n\'a pas été appelé pour l\'IA');
    // … ni par l'outil des applis (action « Corriger un texte » de Plume) pendant une réponse de l'IA.
    const { valhallaTool } = await import('../src/tools/valhalla.ts');
    assert.match(String(await valhallaTool.run({ action: 'action', appli: 'snotra', quoi: 'corriger', entree: '{"texte":"les maison"}' }, { sessionId: 'web:principal' } as never)), /Plume est désactivé/);
    // Réglages le rallume.
    await v.json('/api/plume/reglages', { actif: true });
    assert.equal(((await corr(t)).body.fautes as unknown[]).length, 3);
    // « Odin se sert de Plume » coupé seul : l'IA n'y touche pas, les soulignements restent.
    await v.json('/api/plume/reglages', { ia: false });
    assert.equal(await indiceIA('Corrige : « les maison »'), ''); assert.equal(((await corr(t)).body.fautes as unknown[]).length, 3);
    await v.json('/api/plume/reglages', { ia: true });

    // Pégase : jeton d'appareil (pg1), le même réglage que le propriétaire (même personne), « ou: pegase ».
    const own = await v.json('/api/pegase/compte', { email: COMPTE.email, nom: 'Awa', motdepasse: MDP_AWA, appareil: { nom: 'PC du salon', plateforme: 'windows' } });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    const P = { authorization: `Bearer ${String(own.body.jeton)}`, cookie: '' };
    assert.equal((await v.json('/api/plume/etat', undefined, P)).body.maj, (await v.json('/api/plume/etat')).body.maj, 'Pégase voit le réglage du propriétaire');
    assert.equal(((await corr(t, P, 'pegase')).body.fautes as unknown[]).length, 3);
    await v.json('/api/plume/reglages', { pegase: false });
    assert.equal((await corr(t, P, 'pegase')).body.actif, false, '« Dans Pégase » coupé'); assert.equal((await corr(t, {}, 'odin')).body.actif, true);
    await v.json('/api/plume/reglages', { actif: false }, P); // Désactiver depuis Pégase
    assert.equal((await v.json('/api/plume/etat')).body.actif, false, 'coupé partout, aussi dans l\'interface d\'Odin');
    assert.equal((await v.json('/api/plume/etat', undefined, { authorization: 'Bearer pg1.a_000000000000.faux-faux-faux-faux', cookie: '' })).status, 401);

    // La page de l'appli Plume : son réglage (même réglage), et le rallumer de là.
    const page = await va.act('snotra', 'partout'); assert.match(page.text, /désactivé partout/);
    await va.act('snotra', 'regler_partout', { actif: true, pegase: true });
    assert.equal((await v.json('/api/plume/etat')).body.actif, true);
    assert.ok((await va.act('snotra', 'corriger', { texte: 'les maison' })).ok !== false, 'la page de Plume corrige toujours un texte donné');
  } finally { await tt.end(); }
});

test('Pégase : plume-page.js est à jour (fabriqué depuis src/web/plume.js et plume.css)', async () => {
  const { codePage } = await import('../pegase-plume/construire.mjs');
  assert.equal(readFileSync(new URL('../pegase-plume/plume-page.js', import.meta.url), 'utf8'), codePage(), 'lance : node pegase-plume/construire.mjs');
  const { nettoyer } = await import('../pegase-plume/plume-main.cjs');
  assert.deepEqual(nettoyer('corriger', { texte: 'bonjour', ou: 'odin', champ: 'recherche', jeton: 'x' }), { texte: 'bonjour', ou: 'pegase', champ: 'recherche' }, 'la page ne choisit pas « odin » et rien d\'autre ne part');
  assert.equal(nettoyer('reglages', { autre: 1 }), null);
  assert.deepEqual(nettoyer('reglages', { actif: false, langue: 'fr', x: 2 }), { actif: false, langue: 'fr' });
});
