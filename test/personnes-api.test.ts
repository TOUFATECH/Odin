// Fenêtre Profil, lot 2 — la route des personnes (src/web/personnes-api.ts) : qui voit quoi (le propriétaire tout, un
// membre la sienne en lecture, un invité rien, sans connexion refus), la ligne de temps paginée, la note du propriétaire,
// l'effacement à la main (aperçu, puis confirmation liée à l'aperçu), le signalement d'une erreur par un membre ; et,
// sur un vrai Odin, la route branchée avant la garde des membres et l'état général sans les fiches. Prénoms inventés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mnemosyne } from '../src/muninn/store.ts';
import { PROPRIETAIRE, historiquePersonne } from '../src/muninn/personnes.ts';
import { CODES_ERREUR, traiterPersonnes, type DepsPersonnes, type Requete } from '../src/web/personnes-api.ts';
import type { Demandeur } from '../src/muninn/personnes.ts';

const PROPRIO: Demandeur = { sorte: 'proprietaire' };
const lien = (mu: Mnemosyne, userId: string, personaId: string, par = 'proprietaire') => mu.table<Record<string, unknown>>('personnes_liens', (r) => String(r.user_id)).put({ user_id: userId, persona_id: personaId, par, t: 1 });

function monde() {
  const mu = new Mnemosyne(':memory:');
  const nour = mu.saveUser({ name: 'Nour', role: 'member', autonomy: 'prudent' });
  const sami = mu.saveUser({ name: 'Sami', role: 'member', autonomy: 'equilibre' });
  mu.linkIdentity('telegram', '2001', nour.id); mu.linkIdentity('signal', '2002', sami.id);
  lien(mu, nour.id, 'p-nour');
  mu.ecrireNotePersonne(sami.id, 'note du propriétaire sur Sami');
  const prevenus: Array<{ nom: string; texte: string }> = [];
  let t = 1_000_000;
  const d: DepsPersonnes = {
    mu, personnesPersona: () => [{ id: 'p-nour', login: 'nour', name: 'Nour' }],
    accesDe: (pid) => (pid === 'p-nour' ? { groupes: ['famille'], applis: [{ id: 'venus', nom: 'Vénus' }] } : undefined),
    prevenir: (s) => { prevenus.push(s); return true; }, maintenant: () => t,
  };
  return { mu, nour, sami, d, prevenus, avancer: (ms: number) => { t += ms; }, heure: () => t };
}
const req = (demandeur: Demandeur, chemin: string, o: { methode?: string; corps?: Record<string, unknown>; query?: string } = {}): Requete => ({ methode: o.methode ?? 'GET', chemin, query: new URLSearchParams(o.query ?? ''), demandeur, ...(o.corps ? { corps: o.corps } : {}) });
const NOUR: Demandeur = { sorte: 'membre', personaId: 'p-nour' };

test('le propriétaire voit la liste entière (nom, rôle, canaux), lui-même sans fiche, et un simple compteur des inconnus', () => {
  const { mu, nour, sami, d } = monde();
  mu.compterInconnu('telegram'); mu.compterInconnu('telegram'); mu.compterInconnu('signal');
  const r = traiterPersonnes(req(PROPRIO, ''), d);
  assert.equal(r.code, 200);
  const l = r.body.personnes as Array<{ id: string; nom: string; role: string; canaux: string[]; synthetique?: boolean }>;
  assert.deepEqual(l.map((x) => x.id), [PROPRIETAIRE, nour.id, sami.id], 'le propriétaire sans fiche a son entrée en tête');
  assert.deepEqual(l[1], { id: nour.id, nom: 'Nour', role: 'member', canaux: ['telegram'] });
  assert.deepEqual(r.body.inconnus, { total: 3, parCanal: { telegram: 2, signal: 1 } });
  assert.equal(r.body.proprietaire, true);
});

test('un membre voit SEULEMENT la sienne, en lecture : refus sur une autre fiche, sur la note, sur l\'effacement', () => {
  const { nour, sami, d } = monde();
  const l = traiterPersonnes(req(NOUR, ''), d);
  assert.equal(l.code, 200);
  assert.deepEqual((l.body.personnes as Array<{ id: string }>).map((x) => x.id), [nour.id], 'sa fiche, rien d\'autre');
  assert.equal(l.body.inconnus, undefined, 'pas le compteur des inconnus');
  const sienne = traiterPersonnes(req(NOUR, `/${nour.id}`), d);
  assert.equal(sienne.code, 200);
  const c = sienne.body.carte as Record<string, unknown>;
  assert.equal(c.nom, 'Nour'); assert.equal('note' in c, false, 'la note du propriétaire ne lui est pas montrée');
  assert.deepEqual(c.acces, { groupes: ['famille'], applis: [{ id: 'venus', nom: 'Vénus' }] }, 'ses accès, en lecture');
  // Une autre fiche : refus, et le même refus pour une fiche qui n'existe pas (rien ne fuit).
  for (const id of [sami.id, PROPRIETAIRE, 'u_inexistant']) {
    const r = traiterPersonnes(req(NOUR, `/${id}`), d);
    assert.equal(r.code, 403, id); assert.equal(r.body.raison, 'autre-personne');
    assert.equal(traiterPersonnes(req(NOUR, `/${id}/historique`), d).code, 403);
  }
  assert.equal(JSON.stringify(traiterPersonnes(req(NOUR, `/${sami.id}`), d).body).includes('Sami'), false);
  // La note : refus, sur la sienne comme sur une autre ; elle ne change pas.
  for (const id of [nour.id, sami.id]) assert.equal(traiterPersonnes(req(NOUR, `/${id}/note`, { methode: 'POST', corps: { texte: 'piratée' } }), d).code, 403);
  assert.equal(d.mu.notePersonne(sami.id), 'note du propriétaire sur Sami');
  assert.equal(d.mu.notePersonne(nour.id), '');
  assert.equal(traiterPersonnes(req(NOUR, `/${nour.id}/effacer/apercu`, { methode: 'POST', corps: {} }), d).body.code, 'reserve');
});

test('lien manquant ou douteux, réglage « propriétaire seul », invité : refus ; un demandeur mal formé aussi', () => {
  const { mu, sami, d } = monde();
  assert.deepEqual(traiterPersonnes(req({ sorte: 'membre', personaId: 'p-inconnu' }, ''), d).body, { ok: false, code: 'refuse', raison: 'lien-absent' });
  lien(mu, sami.id, 'p-nour'); // la même personne de Persona reliée à deux personnes : douteux
  assert.equal(traiterPersonnes(req(NOUR, ''), d).body.raison, 'lien-douteux');
  const { mu: mu2, d: d2, nour: n2 } = monde();
  mu2.setKv('personnes-visibilite', 'proprietaire');
  assert.equal(traiterPersonnes(req(NOUR, `/${n2.id}`), d2).body.raison, 'reglage-proprietaire-seul');
  assert.deepEqual(traiterPersonnes(req({ sorte: 'invite' }, ''), d2).body, { ok: false, code: 'refuse', raison: 'invite' });
  assert.equal(traiterPersonnes(req({ sorte: 'invite' }, `/${n2.id}`), d2).code, 403);
  assert.equal(traiterPersonnes(req({ sorte: 'x' } as never, ''), d2).code, 403);
});

test('la ligne de temps : la plus récente d\'abord, paginée par un curseur, avec ce que la demande disait et ce que ça a donné', () => {
  const { mu, nour, d } = monde();
  for (let i = 0; i < 75; i++) mu.noterHistorique({ t: 1000 + i, qui: nour.id, session: 'telegram:2001', canal: 'telegram', sorte: 'demande', preuve: 'appareil-appaire', partage: false });
  mu.startMission({ id: 'm1', sessionId: 'telegram:2001', goal: 'allume la lumière du salon', origin: 'utilisateur' });
  mu.noterHistorique({ t: 5000, qui: nour.id, session: 'telegram:2001', canal: 'telegram', sorte: 'demande', preuve: 'appareil-appaire', partage: true, mission: 'm1' });
  const p1 = traiterPersonnes(req(PROPRIO, `/${nour.id}/historique`, { query: 'n=30' }), d).body;
  const l1 = p1.lignes as Array<{ t: number; quoi?: string; resultat: string; partage: boolean }>;
  assert.equal(l1.length, 30); assert.equal(p1.total, 76);
  assert.equal(l1[0].t, 5000); assert.equal(l1[0].quoi, 'allume la lumière du salon'); assert.equal(l1[0].resultat, 'en_cours'); assert.equal(l1[0].partage, true);
  assert.equal(l1[1].resultat, 'sans_tour');
  const p2 = traiterPersonnes(req(PROPRIO, `/${nour.id}/historique`, { query: `n=30&avant=${p1.suite}` }), d).body;
  const p3 = traiterPersonnes(req(PROPRIO, `/${nour.id}/historique`, { query: `n=30&avant=${p2.suite}` }), d).body;
  assert.equal((p3.lignes as unknown[]).length, 16); assert.equal(p3.suite, undefined, 'fin de la liste');
  const vus = [...l1, ...(p2.lignes as typeof l1), ...(p3.lignes as typeof l1)].map((x) => x.t);
  assert.equal(new Set(vus).size, 76, 'ni doublon ni trou');
  assert.ok(vus.every((t, i) => i === 0 || t <= vus[i - 1]), 'du plus récent au plus ancien');
  // Le membre lit la sienne de la même façon.
  assert.equal((traiterPersonnes(req(NOUR, `/${nour.id}/historique`, { query: 'n=5' }), d).body.lignes as unknown[]).length, 5);
});

test('la note libre : le propriétaire l\'écrit, la corrige, la vide ; bornée ; pas sur l\'entrée sans fiche', () => {
  const { nour, d } = monde();
  const ecrire = (id: string, texte: unknown) => traiterPersonnes(req(PROPRIO, `/${id}/note`, { methode: 'POST', corps: { texte } }), d);
  assert.deepEqual(ecrire(nour.id, 'préfère les messages courts').body, { ok: true, note: 'préfère les messages courts' });
  assert.equal((traiterPersonnes(req(PROPRIO, `/${nour.id}`), d).body.carte as { note: string }).note, 'préfère les messages courts');
  assert.equal(ecrire(nour.id, '').body.note, '');
  assert.equal(ecrire(nour.id, 'x'.repeat(2001)).code, 400);
  assert.equal(ecrire(nour.id, 42).code, 400);
  assert.equal(ecrire(PROPRIETAIRE, 'x').code, 400);
  assert.equal(traiterPersonnes(req(PROPRIO, `/${nour.id}/note`), d).code, 405, 'GET sur la note : non');
});

test('effacement : l\'aperçu dit ce qui part et ce qui reste ailleurs sans rien effacer ; sans la bonne confirmation, rien ne part', () => {
  const { mu, nour, sami, d, avancer, heure } = monde();
  const noter = (qui: string, t: number) => mu.noterHistorique({ t, qui, session: 'x', canal: 'telegram', sorte: 'demande', preuve: 'appareil-appaire', partage: false });
  for (const t of [100, 200, 300]) noter(nour.id, t);
  noter(sami.id, 200);
  const post = (chemin: string, corps: Record<string, unknown>) => traiterPersonnes(req(PROPRIO, `/${nour.id}${chemin}`, { methode: 'POST', corps }), d);
  const ap = post('/effacer/apercu', { depuis: 150, jusqua: 250 }).body as { bilan: { retire: { historique: number }; reste: Record<string, unknown> }; jeton: string; cible: Record<string, unknown> };
  assert.deepEqual(ap.bilan.retire, { historique: 1 });
  assert.equal(ap.bilan.reste.historique, 2); assert.equal(ap.bilan.reste.audit, 'non-touche'); assert.equal(ap.bilan.reste.sauvegardes, 'non-touchees');
  assert.equal(historiquePersonne(mu, nour.id).length, 3, 'l\'aperçu n\'efface rien');
  // Sans jeton, ou avec un faux : refus, et un nouvel aperçu est rendu.
  assert.equal(post('/effacer', { depuis: 150, jusqua: 250 }).code, 409);
  assert.equal(post('/effacer', { depuis: 150, jusqua: 250, jeton: 'faux' }).body.code, 'change');
  // Le jeton d'une autre période ne vaut pas pour celle-ci.
  assert.equal(post('/effacer', { depuis: 0, jusqua: 250, jeton: ap.jeton }).code, 409);
  assert.equal(historiquePersonne(mu, nour.id).length, 3);
  const fait = post('/effacer', { depuis: 150, jusqua: 250, jeton: ap.jeton });
  assert.equal(fait.code, 200); assert.deepEqual((fait.body.bilan as { retire: unknown }).retire, { historique: 1 });
  assert.deepEqual(historiquePersonne(mu, nour.id).map((l) => l.t), [100, 300]);
  assert.equal(historiquePersonne(mu, sami.id).length, 1, 'l\'autre personne garde le sien');
  // Tout son historique : la fin est l'instant de l'aperçu ; une demande arrivée APRÈS l'aperçu n'est jamais effacée.
  const tout = post('/effacer/apercu', {}).body as { jeton: string; cible: { jusqua: number } };
  assert.equal(tout.cible.jusqua, heure());
  avancer(10); noter(nour.id, heure());
  const fin = post('/effacer', { jusqua: tout.cible.jusqua, jeton: tout.jeton });
  assert.equal(fin.code, 200); assert.deepEqual((fin.body.bilan as { retire: unknown }).retire, { historique: 2 });
  assert.deepEqual(historiquePersonne(mu, nour.id).map((l) => l.t), [heure()]);
  // Une ligne ajoutée DANS la période entre l'aperçu et la confirmation : le jeton ne vaut plus.
  const ap2 = post('/effacer/apercu', { depuis: 0 }).body as { jeton: string; cible: { jusqua: number } };
  noter(nour.id, 50);
  assert.equal(post('/effacer', { depuis: 0, jusqua: ap2.cible.jusqua, jeton: ap2.jeton }).code, 409);
  assert.equal(historiquePersonne(mu, nour.id).length, 2);
  // Période impossible : refus.
  assert.equal(post('/effacer/apercu', { depuis: 500, jusqua: 100 }).code, 400);
  assert.equal(post('/effacer/apercu', { depuis: -1 }).code, 400);
});

test('signaler une erreur : un membre sur SA fiche prévient le propriétaire (borné) ; ni le propriétaire ni un membre sans lien', () => {
  const { d, prevenus, avancer } = monde();
  const sig = (dm: Demandeur, texte: unknown) => traiterPersonnes(req(dm, '/moi/signaler', { methode: 'POST', corps: { texte } }), d);
  assert.deepEqual(sig(NOUR, '  mon  canal Telegram est faux ').body, { ok: true, envoye: true });
  assert.deepEqual(prevenus, [{ nom: 'Nour', texte: 'mon canal Telegram est faux' }]);
  assert.equal(sig(NOUR, '').code, 400); assert.equal(sig(NOUR, 'x'.repeat(501)).code, 400);
  sig(NOUR, 'deux'); sig(NOUR, 'trois');
  assert.equal(sig(NOUR, 'quatre').code, 429, '3 par heure au plus');
  avancer(3_600_001);
  assert.equal(sig(NOUR, 'cinq').code, 200);
  assert.equal(sig(PROPRIO, 'x').code, 400);
  assert.equal(sig({ sorte: 'membre', personaId: 'p-inconnu' }, 'x').code, 403);
  assert.equal(sig({ sorte: 'invite' }, 'x').code, 403);
  assert.equal(prevenus.length, 4);
});

test('les codes d\'erreur sont une liste fermée (la page doit tous les traduire)', () => {
  assert.ok(CODES_ERREUR.includes('refuse') && CODES_ERREUR.includes('reserve') && CODES_ERREUR.includes('connexion'));
});

test('sans connexion : 401, et l\'essai raté compte pour la limite des essais (comme les routes voisines)', async () => {
  const { personnesRoute } = await import('../src/web/personnes-api.ts');
  let rates = 0, code = 0, corps = '';
  const res = { writeHead: (c: number) => { code = c; }, end: (b: string) => { corps = b; } };
  const reqHttp = { method: 'GET', headers: {} };
  const servie = await personnesRoute(reqHttp as never, res as never, new URL('http://x/api/personnes'), { proprietaire: () => false, mu: new Mnemosyne(':memory:'), fail: () => { rates++; } });
  assert.equal(servie, true); assert.equal(code, 401); assert.equal(JSON.parse(corps).code, 'connexion');
  assert.equal(rates, 1, 'un 401 compte comme un essai raté');
  // Le propriétaire n'est jamais compté.
  rates = 0;
  await personnesRoute(reqHttp as never, res as never, new URL('http://x/api/personnes/zzz'), { proprietaire: () => true, mu: new Mnemosyne(':memory:'), fail: () => { rates++; } }, monde().d);
  assert.equal(rates, 0);
});

test('sur un vrai Odin : sans connexion refusé ; un membre ne lit que la sienne ; l\'état général ne porte aucune fiche', { timeout: 240_000 }, async () => {
  const { T } = await import('./banc/lib.ts');
  const { vraiOdin } = await import('./banc/odin-vrai.ts');
  const { allModules, valhallaOf } = await import('../src/valhalla/odin.ts');
  const { persona, personnes } = await import('../src/valhalla/sso/etat.ts');
  const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  try {
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => m.id === 'var') }), va = valhallaOf()!, mu = v.o.muninn;
    const mdp = 'un-galet-gris-sur-la-plage-31';
    assert.equal((await va.act('var', 'ajouter', { login: 'nour', nom: 'Nour', groupes: 'famille', email: 'nour@exemple.yt', mot_de_passe: mdp })).ok, true);
    const pNour = personnes(persona()!).find((p) => p.login === 'nour')!;
    const nour = mu.saveUser({ name: 'Nour', role: 'member' }), sami = mu.saveUser({ name: 'Sami', role: 'member' });
    mu.ecrireNotePersonne(sami.id, 'note-secrete-du-proprietaire');
    mu.noterHistorique({ t: 1000, qui: sami.id, session: 'signal:3003', canal: 'signal', sorte: 'demande', preuve: 'appareil-appaire', partage: false });
    // Sans connexion : refusé (et pas la page de connexion de la garde des membres).
    const sans = await fetch(`${v.url}/api/personnes`);
    assert.equal(sans.status, 401); assert.equal((await sans.json() as { code: string }).code, 'connexion');
    assert.equal((await fetch(`${v.url}/api/personnes/${sami.id}/historique`)).status, 401);
    // Le propriétaire (sa session) voit tout.
    const lp = await v.json('/api/personnes');
    assert.equal(lp.status, 200); assert.deepEqual((lp.body.personnes as Array<{ nom: string }>).map((x) => x.nom).filter(Boolean), ['Nour', 'Sami']);
    // Un membre connecté au web (Persona) : sans lien posé, refusé ; avec un lien sûr, la sienne seulement.
    const login = await fetch(`${v.url}/api/account/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ email: 'nour@exemple.yt', password: mdp }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().find((c) => c.startsWith('odin_session='))!.split(';')[0];
    const m = (path: string, body?: unknown) => v.json(path, body, { cookie });
    assert.deepEqual((await m('/api/personnes')).body, { ok: false, code: 'refuse', raison: 'lien-absent' });
    mu.table<Record<string, unknown>>('personnes_liens', (r) => String(r.user_id)).put({ user_id: nour.id, persona_id: pNour.id, par: 'proprietaire', t: 1 });
    const lm = await m('/api/personnes');
    assert.equal(lm.status, 200); assert.deepEqual((lm.body.personnes as Array<{ id: string }>).map((x) => x.id), [nour.id]);
    const autre = await m(`/api/personnes/${sami.id}`);
    assert.equal(autre.status, 403); assert.equal(autre.body.raison, 'autre-personne');
    assert.equal((await m(`/api/personnes/${sami.id}/historique`)).status, 403);
    const note = await m(`/api/personnes/${nour.id}/note`, { texte: 'je me donne une note' });
    assert.equal(note.status, 403); assert.equal(note.body.code, 'reserve');
    assert.equal(mu.notePersonne(nour.id), '');
    assert.equal((await m(`/api/personnes/${nour.id}`)).status, 200);
    // L'état général : jamais la note ni l'historique (propriétaire) ; aucun nom de personne (membre).
    const st = JSON.stringify((await v.json('/api/state')).body);
    assert.doesNotMatch(st, /note-secrete-du-proprietaire/); assert.doesNotMatch(st, /signal:3003/); assert.doesNotMatch(st, /"lignes"|"carte"/);
    const stm = JSON.stringify((await m('/api/state')).body);
    assert.doesNotMatch(stm, /Sami|note-secrete/);
  } finally { Object.assign(console, orig); await tt.end(); }
});
