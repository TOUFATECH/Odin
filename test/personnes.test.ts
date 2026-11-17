// Profil, lot 1 — la personne (carte calculée), qui voit quoi, les comptes, l'effacement. Logique pure, sur une
// mémoire en RAM ; noms inventés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mnemosyne } from '../src/muninn/store.ts';
import {
  PROPRIETAIRE, apercuEffacement, carte, cartes, comptes, contexteVisibilite, effacerHistoriquePersonne, historiquePersonne,
  noterDemande, peutVoir, preuveDe, type LienPersona,
} from '../src/muninn/personnes.ts';

const attendre = () => new Promise<void>((r) => setImmediate(r));

test('preuve d\'identité : session du propriétaire, appareil appairé, code prouvé, ou non prouvé', () => {
  assert.equal(preuveDe({ canal: 'web', proprietaire: true, connu: false }), 'session-proprietaire');
  assert.equal(preuveDe({ canal: 'keryx', proprietaire: true, connu: true }), 'code-prouve');
  assert.equal(preuveDe({ canal: 'telegram', proprietaire: true, connu: true }), 'appareil-appaire');
  assert.equal(preuveDe({ canal: 'telegram', proprietaire: false, connu: true }), 'appareil-appaire');
  // « * » : tout le monde est propriétaire sur ce canal, rien n'est prouvé.
  assert.equal(preuveDe({ canal: 'signal', proprietaire: true, connu: false }), 'non-prouve');
  // Une personne non appairée qui passe par le web n'est pas « propriétaire » : non prouvé.
  assert.equal(preuveDe({ canal: 'web', proprietaire: false, connu: false }), 'non-prouve');
});

test('carte : la personne de la mémoire d\'Odin, ses identités, le lien Persona posé à la main, la note du propriétaire', () => {
  const mu = new Mnemosyne(':memory:');
  const u = mu.saveUser({ name: 'Personne A', role: 'member', autonomy: 'prudent' });
  mu.linkIdentity('telegram', '1001', u.id);
  mu.table<Record<string, unknown>>('personnes_partages', (r) => `${r.channel}\u0000${r.peer}`).put({ channel: 'telegram', peer: '1001', t: 1 });
  let c = carte(mu, u.id)!;
  assert.equal(c.nom, 'Personne A'); assert.equal(c.role, 'member'); assert.equal(c.autonomie, 'prudent');
  assert.deepEqual(c.identites, [{ canal: 'telegram', pair: '1001', partage: true }]);
  assert.equal(c.persona, null, 'aucun lien posé : rien n\'est deviné par le nom');
  assert.equal(c.note, '');
  assert.equal(c.portrait, null, 'emplacement prévu, vide jusqu\'au portrait rédigé par le modèle d\'Odin');
  mu.ecrireNotePersonne(u.id, 'aime les rappels tôt');
  mu.table<Record<string, unknown>>('personnes_liens', (r) => String(r.user_id)).put({ user_id: u.id, persona_id: 'p-7', par: 'proprietaire', t: 2 });
  c = carte(mu, u.id, [{ id: 'p-7', login: 'pa', name: 'Personne A' }])!;
  assert.equal(c.note, 'aime les rappels tôt');
  assert.deepEqual(c.persona, { id: 'p-7', login: 'pa', nom: 'Personne A' });
  assert.equal(carte(mu, 'u_inexistant'), undefined);
  assert.deepEqual(cartes(mu).map((x) => x.id), [u.id]);
});

test('qui voit quoi : le propriétaire tout ; un membre seulement la sienne si le lien est sûr ; un invité rien', () => {
  const personnes = [{ id: 'u_a', role: 'member' as const }, { id: 'u_b', role: 'member' as const }, { id: 'u_o', role: 'owner' as const }];
  const liens: LienPersona[] = [{ user_id: 'u_a', persona_id: 'pa', par: 'proprietaire', t: 1 }, { user_id: 'u_b', persona_id: 'pb', par: 'proprietaire', t: 1 }];
  const ctx = { reglage: 'chacun_la_sienne' as const, liens, personnes };
  assert.deepEqual(peutVoir({ sorte: 'proprietaire' }, 'u_b', ctx), { ok: true, raison: 'proprietaire' });
  assert.deepEqual(peutVoir({ sorte: 'proprietaire' }, PROPRIETAIRE, ctx), { ok: true, raison: 'proprietaire' });
  assert.deepEqual(peutVoir({ sorte: 'membre', personaId: 'pa' }, 'u_a', ctx), { ok: true, raison: 'la-sienne' });
  // Jamais celle d'un autre, ni celle du propriétaire.
  assert.equal(peutVoir({ sorte: 'membre', personaId: 'pa' }, 'u_b', ctx).ok, false);
  assert.equal(peutVoir({ sorte: 'membre', personaId: 'pa' }, 'u_o', ctx).ok, false);
  assert.equal(peutVoir({ sorte: 'membre', personaId: 'pa' }, PROPRIETAIRE, ctx).ok, false);
  // Lien absent : refus.
  assert.deepEqual(peutVoir({ sorte: 'membre', personaId: 'pz' }, 'u_a', ctx), { ok: false, raison: 'lien-absent' });
  // Lien douteux : la même personne Persona reliée à deux personnes, un lien qui ne vient pas du propriétaire,
  // un lien vers le propriétaire ou vers une personne disparue.
  const double = { ...ctx, liens: [...liens, { user_id: 'u_b', persona_id: 'pa', par: 'proprietaire', t: 2 }] };
  assert.deepEqual(peutVoir({ sorte: 'membre', personaId: 'pa' }, 'u_a', double), { ok: false, raison: 'lien-douteux' });
  const pasProprio = { ...ctx, liens: [{ user_id: 'u_a', persona_id: 'pa', par: 'u_a', t: 1 }] };
  assert.deepEqual(peutVoir({ sorte: 'membre', personaId: 'pa' }, 'u_a', pasProprio), { ok: false, raison: 'lien-douteux' });
  const versProprio = { ...ctx, liens: [{ user_id: 'u_o', persona_id: 'pa', par: 'proprietaire', t: 1 }] };
  assert.deepEqual(peutVoir({ sorte: 'membre', personaId: 'pa' }, 'u_o', versProprio), { ok: false, raison: 'lien-douteux' });
  const disparue = { ...ctx, liens: [{ user_id: 'u_x', persona_id: 'pa', par: 'proprietaire', t: 1 }] };
  assert.deepEqual(peutVoir({ sorte: 'membre', personaId: 'pa' }, 'u_x', disparue), { ok: false, raison: 'lien-douteux' });
  assert.equal(peutVoir({ sorte: 'membre', personaId: '' }, 'u_a', ctx).ok, false);
  // Réglage « propriétaire seul » : même la sienne est refusée.
  assert.deepEqual(peutVoir({ sorte: 'membre', personaId: 'pa' }, 'u_a', { ...ctx, reglage: 'proprietaire' }), { ok: false, raison: 'reglage-proprietaire-seul' });
  // Un invité ne voit rien, quel que soit le réglage.
  assert.deepEqual(peutVoir({ sorte: 'invite' }, 'u_a', ctx), { ok: false, raison: 'invite' });
  // Un demandeur mal formé : refus.
  assert.equal(peutVoir({ sorte: 'autre' } as never, 'u_a', ctx).ok, false);
});

test('réglage de visibilité : « chacun la sienne » à l\'installation ; une valeur inconnue retombe sur le plus prudent', () => {
  const mu = new Mnemosyne(':memory:');
  assert.equal(contexteVisibilite(mu).reglage, 'chacun_la_sienne');
  mu.setKv('personnes-visibilite', 'proprietaire');
  assert.equal(contexteVisibilite(mu).reglage, 'proprietaire');
  mu.setKv('personnes-visibilite', 'tout-le-monde');
  assert.equal(contexteVisibilite(mu).reglage, 'proprietaire');
});

test('comptes (§ 46) : tâches confiées, succès, refus, décisions, validations, activités — nombres exacts, par personne et par période', () => {
  const L = (qui: string | null, t: number, sorte: string, resultat?: string) => ({ id: t, t, qui, session: 's', canal: 'c', sorte, preuve: 'non-prouve', partage: false, resultat }) as never;
  const lignes = [
    L('u_a', 10, 'demande', 'reussi'), L('u_a', 20, 'demande', 'echoue'), L('u_a', 30, 'demande', 'en_attente'), L('u_a', 40, 'refus'),
    L('u_a', 50, 'decision'), L('u_a', 60, 'validation'), L('u_a', 65, 'action'), L('u_a', 66, 'connexion'), L('u_b', 70, 'demande', 'reussi'), L(null, 80, 'demande', 'sans_tour'),
    L('u_a', 500, 'demande', 'reussi'),
  ];
  const c = comptes(lignes, { depuis: 0, jusqua: 100 });
  assert.deepEqual(c.u_a, { taches: 3, succes: 1, echecs: 1, enAttente: 1, arretees: 0, sansTour: 0, refus: 1, decisions: 1, validations: 1, actions: 1, connexions: 1, activites: 8 });
  assert.deepEqual(c.u_b, { taches: 1, succes: 1, echecs: 0, enAttente: 0, arretees: 0, sansTour: 0, refus: 0, decisions: 0, validations: 0, actions: 0, connexions: 0, activites: 1 });
  assert.equal(c[''].sansTour, 1, 'une demande non attribuée reste comptée à part');
  assert.equal(c[''].taches, 0, 'une demande sans tour (commande) n\'est pas une tâche confiée');
  assert.equal(comptes(lignes, {}).u_a.taches, 4, 'sans période : tout');
});

test('mode privé : rien n\'est noté ; un inconnu non appairé n\'a pas de carte, seulement un compteur sans texte', async () => {
  const mu = new Mnemosyne(':memory:');
  noterDemande(mu, { canal: 'telegram', pair: '555', proprietaire: false });
  noterDemande(mu, { canal: 'telegram', pair: '556', proprietaire: false });
  await attendre();
  assert.equal(historiquePersonne(mu, null).length, 0);
  assert.deepEqual(Object.keys(mu.inconnus()), ['telegram']);
  assert.equal(mu.inconnus().telegram.n, 2);
  assert.doesNotMatch(JSON.stringify(mu.inconnus()), /555|556/, 'ni le pair ni un texte');
  mu.privateMode = true;
  noterDemande(mu, { canal: 'web', pair: 'owner', proprietaire: true });
  await attendre();
  assert.equal(historiquePersonne(mu, PROPRIETAIRE).length, 0);
});

test('effacement par personne ou par période : dit exactement ce qui est retiré et ce qui reste ailleurs', async () => {
  const mu = new Mnemosyne(':memory:');
  const a = mu.saveUser({ name: 'Personne A', role: 'member' }), b = mu.saveUser({ name: 'Personne B', role: 'member' });
  mu.linkIdentity('telegram', '1', a.id); mu.linkIdentity('telegram', '2', b.id);
  for (const [pair, t] of [['1', 1000], ['1', 2000], ['1', 3000], ['2', 2500]] as const) noterDemande(mu, { canal: 'telegram', pair, proprietaire: false, t });
  await attendre();
  mu.addMessage('telegram:1', { role: 'user', content: 'bonjour' });
  mu.remember('Personne A aime le thé', 'agent', 'fact', '', { subject: 'personne:personne a', topic: 'boisson' });
  assert.throws(() => apercuEffacement(mu, {}), /personne ou une période/);
  const ap = apercuEffacement(mu, { qui: a.id, depuis: 1500, jusqua: 2500 });
  assert.deepEqual(ap.retire, { historique: 1 });
  assert.equal(ap.reste.historique, 2, 'ce qui reste de son historique');
  assert.equal(ap.reste.messages, 0, 'aucun message de la personne dans cette période');
  assert.equal(ap.reste.souvenirs, 1);
  assert.equal(apercuEffacement(mu, { qui: a.id }).reste.messages, 1, 'ses messages restent : l\'effacement ne les touche pas');
  assert.equal(ap.reste.audit, 'non-touche'); assert.equal(ap.reste.sauvegardes, 'non-touchees');
  assert.equal(historiquePersonne(mu, a.id).length, 3, 'l\'aperçu n\'efface rien');
  const fait = effacerHistoriquePersonne(mu, { qui: a.id, depuis: 1500, jusqua: 2500 });
  assert.deepEqual(fait.retire, { historique: 1 });
  assert.deepEqual(historiquePersonne(mu, a.id).map((l) => l.t), [1000, 3000]);
  assert.equal(historiquePersonne(mu, b.id).length, 1, 'l\'autre personne garde le sien');
  // Par période seule (toutes les personnes).
  effacerHistoriquePersonne(mu, { depuis: 0, jusqua: 2600 });
  assert.deepEqual(historiquePersonne(mu, a.id).map((l) => l.t), [3000]);
  assert.equal(historiquePersonne(mu, b.id).length, 0);
  // Par personne (tout son historique) : les messages et les souvenirs restent, l'aperçu le disait.
  const tout = effacerHistoriquePersonne(mu, { qui: a.id });
  assert.deepEqual(tout.retire, { historique: 1 });
  assert.equal(historiquePersonne(mu, a.id).length, 0);
  assert.equal(mu.allMessages('telegram:1').length, 1);
});

test('effacement : le bilan nomme aussi le journal d\'aiguillage, la note, le lien Persona et le compteur des inconnus, qui restent', async () => {
  const mu = new Mnemosyne(':memory:');
  const a = mu.saveUser({ name: 'Personne A', role: 'member' });
  mu.linkIdentity('telegram', '1', a.id);
  noterDemande(mu, { canal: 'telegram', pair: '1', proprietaire: false, t: 1000 });
  await attendre();
  const route = { turnId: 't1', sessionId: 'telegram:1', channel: 'telegram', request: '***', purpose: 'reponse', provider: 'local', label: 'local', tier: 'bas', minTier: 'bas', need: '', reason: '', attempts: [], ok: true, ms: 1, tokensIn: 0, tokensOut: 0, costUsd: 0 };
  mu.recordRoute({ ...route, at: 1000 }); mu.recordRoute({ ...route, at: 9000 });
  let ap = apercuEffacement(mu, { qui: a.id });
  assert.equal(ap.reste.aiguillage, 2); assert.equal(ap.reste.note, false); assert.equal(ap.reste.lienPersona, false);
  assert.equal(ap.reste.compteurInconnus, 'non-touche');
  assert.equal(apercuEffacement(mu, { qui: a.id, depuis: 0, jusqua: 5000 }).reste.aiguillage, 1, 'sur la période');
  mu.ecrireNotePersonne(a.id, 'note');
  mu.table<Record<string, unknown>>('personnes_liens', (r) => String(r.user_id)).put({ user_id: a.id, persona_id: 'p-1', par: 'proprietaire', t: 2 });
  ap = apercuEffacement(mu, { qui: a.id });
  assert.equal(ap.reste.note, true); assert.equal(ap.reste.lienPersona, true);
  effacerHistoriquePersonne(mu, { qui: a.id });
  assert.equal(mu.notePersonne(a.id), 'note', 'la note reste, le bilan le disait');
  assert.equal(mu.routes({ sessionId: 'telegram:1' }).length, 2, 'le journal d\'aiguillage reste, le bilan le disait');
});

test('le propriétaire qui obtient une fiche garde un seul historique (avant : « proprietaire », après : son id)', async () => {
  const mu = new Mnemosyne(':memory:');
  noterDemande(mu, { canal: 'web', pair: 'local', proprietaire: true, t: 1000 });
  await attendre();
  const o = mu.saveUser({ name: 'Personne P', role: 'owner' });
  noterDemande(mu, { canal: 'web', pair: 'local', proprietaire: true, t: 2000 });
  await attendre();
  assert.deepEqual(mu.lignesHistorique(() => true).map((l) => l.qui), [PROPRIETAIRE, o.id], 'écrit tel quel');
  assert.deepEqual(historiquePersonne(mu, o.id).map((l) => l.t), [1000, 2000]);
  assert.deepEqual(historiquePersonne(mu, PROPRIETAIRE).map((l) => l.t), [1000, 2000]);
  assert.deepEqual(effacerHistoriquePersonne(mu, { qui: o.id }).retire, { historique: 2 });
  // Deux fiches de propriétaire : rien n'est fusionné (on ne devine pas laquelle).
  const mu2 = new Mnemosyne(':memory:');
  const p1 = mu2.saveUser({ name: 'Personne P', role: 'owner' }); mu2.saveUser({ name: 'Personne Q', role: 'owner' });
  noterDemande(mu2, { canal: 'web', pair: 'local', proprietaire: true, t: 1000 });
  await attendre();
  assert.equal(historiquePersonne(mu2, p1.id).length, 0);
  assert.equal(historiquePersonne(mu2, PROPRIETAIRE).length, 1);
});
