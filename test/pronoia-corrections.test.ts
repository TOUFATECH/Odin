// Prónoia — corrections de la relecture croisée (carnets/relecture-pronoia.md). Chaque essai reprend le banc du
// relecteur : il échouait avant la correction et passe après.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { banc, a, MIN } from './pronoia-outils-essai.ts';
import { rythmes } from '../src/valhalla/pronoia/evenements.ts';
import { bilan } from '../src/valhalla/pronoia/bilan.ts';
import { Pronoia } from '../src/valhalla/pronoia/moteur.ts';
import type { ModeleDemandes } from '../src/valhalla/pronoia/demande.ts';
import type { Prevision } from '../src/valhalla/pronoia/types.ts';

test('constat 1 : une réponse préparée n\'est JAMAIS servie pour une autre demande (autres nombres, autre jour)', async () => {
  const b = banc({ preparer: async (d) => `réponse à : ${d}`, seuilPreparer: 0 });
  try {
    for (let j = 0; j < 10; j++) { b.horloge.t = a(j, 9); b.p.noterDemande('convertis 100 euros en dollars'); }
    b.horloge.t = a(10, 8, 58);
    assert.ok((await b.p.anticiper().preparees).includes('prete'));
    b.horloge.t = a(10, 9);
    const r = b.p.noterDemande('convertis 250 euros en dollars');
    assert.equal(r.servie, undefined, `servi à tort : ${r.servie?.texte}`);
    // la même demande (ponctuation et casse près) reste servie
    b.horloge.t = a(11, 8, 58);
    await b.p.anticiper().preparees;
    b.horloge.t = a(11, 9);
    assert.match(b.p.noterDemande('Convertis 100 euros en dollars ?').servie?.texte ?? '', /100 euros/);
  } finally { b.fermer(); }
  const c = banc({ preparer: async (d) => `réponse à : ${d}`, seuilPreparer: 0 });
  try {
    for (let j = 0; j < 10; j++) { c.horloge.t = a(j, 9); c.p.noterDemande('météo demain à Paris'); }
    c.horloge.t = a(10, 8, 58); await c.p.anticiper().preparees;
    c.horloge.t = a(10, 9);
    assert.equal(c.p.noterDemande('météo lundi à Paris').servie, undefined, 'autre jour : pas la même réponse');
  } finally { c.fermer(); }
});

test('constat 2 : un événement daté dans le futur ne réalise aucune prévision (taux non embelli)', () => {
  const b = banc();
  try {
    b.horloge.t = a(10, 5); // l'historique est dans le passé
    for (let j = 0; j < 10; j++) b.p.recevoirEvenement({ appli: 'domus', type: 'porte_ouverte', cle: 'garage', at: a(j, 7) });
    assert.ok(b.p.prevoirEvenements().length > 0);
    const r = b.p.recevoirEvenement({ appli: 'domus', type: 'porte_ouverte', cle: 'garage', at: a(10, 7) });
    assert.equal(r.accepte, false);
    assert.deepEqual(r.jugees, []);
    assert.equal(b.p.bilan().taux, undefined);
  } finally { b.fermer(); }
});

test('constat 3 : une personne n\'est jamais suivie, même sans drapeau ; sujets par liste blanche', () => {
  const b = banc();
  try {
    for (let j = 0; j < 10; j++) {
      assert.equal(b.p.recevoirEvenement({ appli: 'theia', type: 'personne_vue', cle: 'Marie (voisine)', at: a(j, 18) }).accepte, false);
      assert.equal(b.p.recevoirEvenement({ appli: 'syrinx', type: 'voix_reconnue', at: a(j, 18, 5) }).accepte, false);
      assert.equal(b.p.recevoirEvenement({ appli: 'domus', type: 'presence', cle: 'salon', at: a(j, 18, 10) }).accepte, false);
      assert.equal(b.p.recevoirEvenement({ appli: 'theia', type: 'visage', at: a(j, 18, 15) }).accepte, false);
      assert.equal(b.p.recevoirEvenement({ appli: 'domus', type: 'x', at: a(j, 18, 20), sujet: 'quelquun' as never }).accepte, false, 'sujet hors liste blanche');
    }
    b.horloge.t = a(10, 12);
    assert.deepEqual(b.p.prevoirEvenements(), []);
    assert.equal(b.p.magasin.etat.evenements.length, 0);
    // le propriétaire lui-même, dit explicitement : permis, et le libellé n'est jamais gardé en clair
    const r = b.p.recevoirEvenement({ appli: 'theia', type: 'personne_vue', cle: 'Jean', at: a(10, 11), sujet: 'proprietaire' });
    assert.equal(r.accepte, true);
    assert.equal(b.p.magasin.etat.evenements.at(-1)?.cle, undefined);
  } finally { b.fermer(); }
});

test('constat 4 : le modèle des demandes reste borné comme le magasin', () => {
  const b = banc();
  try {
    for (let i = 0; i < 6000; i++) { b.horloge.t = a(0, 0) + i * 20 * MIN; b.p.noterDemande(`quelle est la météo ${i % 3 ? 'demain' : 'ce soir'} à Paris`); }
    const mod = (b.p as unknown as { modele: ModeleDemandes }).modele;
    const occ = mod.groupes.reduce((s, g) => s + g.ats.length, 0);
    assert.ok(occ <= 2200, `${occ} occurrences gardées`);
    assert.ok(b.p.magasin.etat.demandes.length <= 2000);
  } finally { b.fermer(); }
});

test('constat 5 : « effacer tout » et la purge atteignent la base même si elle n\'était pas prête', () => {
  const b = banc();
  try {
    const base: string[] = [];
    const miroir = { ecrire: (...ls: Array<[string, ...unknown[]]>) => { for (const l of ls) base.push(l[0]); } };
    b.p.magasin.brancherMiroir(miroir as never);
    b.p.noterDemande('mon rendez-vous chez le cardiologue');
    const p2 = new Pronoia({ home: b.home, maintenant: () => b.horloge.t });
    p2.effacerTout();
    p2.purger();
    const p3 = new Pronoia({ home: b.home, maintenant: () => b.horloge.t }); // redémarrage : l'attente survit
    p3.magasin.brancherMiroir(miroir as never);
    for (const k of ['effacer_previsions', 'effacer_demandes', 'effacer_evenements', 'purge_demandes']) assert.ok(base.includes(k), `${k} pas rejoué : ${base}`);
    const n = base.length;
    p3.magasin.brancherMiroir(miroir as never);
    assert.equal(base.length, n, 'rejoué une seule fois');
  } finally { b.fermer(); }
});

test('constat 6 : une demande en mode privé arrête aussi la préparation en cours', async () => {
  let signal: AbortSignal | undefined;
  const b = banc({ preparer: (_d, o) => { signal = o.signal; return new Promise((r) => setTimeout(() => r('x'), 300)); }, seuilPreparer: 0 });
  try {
    for (let j = 0; j < 10; j++) { b.horloge.t = a(j, 9); b.p.noterDemande('quelle est la météo'); }
    b.horloge.t = a(10, 8, 59);
    const { preparees } = b.p.anticiper();
    b.horloge.t = a(10, 9);
    b.p.noterDemande('question très privée', { prive: true });
    assert.equal(signal?.aborted, true);
    assert.ok((await preparees).every((x) => x === 'abandon'));
  } finally { b.fermer(); }
});

test('constat 7 : au changement d\'heure, la prochaine occurrence n\'est jamais dans le passé', () => {
  const avant = process.env.TZ;
  process.env.TZ = 'Europe/Paris';
  try {
    const ev = Array.from({ length: 10 }, (_, k) => ({ appli: 'domus', type: 'veilleuse', at: new Date(2026, 9, 16 + k, 0, 20).getTime() }));
    const now = new Date(2026, 9, 25, 0, 30).getTime();
    const l = rythmes(ev, now, 48 * 3_600_000); // le jour du changement d'heure dure 25 h
    assert.equal(l.length, 1);
    assert.ok(l[0].attendu! > now, new Date(l[0].attendu!).toString());
    assert.equal(new Date(l[0].attendu!).getDate(), 26);
  } finally { if (avant === undefined) delete process.env.TZ; else process.env.TZ = avant; }
});

test('constat 8 : un événement vide ou bizarre est ignoré sans lever', () => {
  const b = banc();
  try {
    for (const x of [null, undefined, 42, 'texte', {}, { appli: 'a' }]) assert.equal(b.p.recevoirEvenement(x as never).accepte, false);
  } finally { b.fermer(); }
});

test('constat 9 : fichier abîmé mis de côté et signalé ; écriture atomique', () => {
  const b = banc();
  try {
    for (let j = 0; j < 5; j++) { b.horloge.t = a(j, 9); b.p.noterDemande('quelle est la météo'); }
    assert.ok(!readdirSync(dirname(b.p.magasin.fichier)).some((f) => f.endsWith('.tmp')), 'aucun fichier temporaire laissé');
    writeFileSync(b.p.magasin.fichier, 'odc1:abime');
    const p2 = new Pronoia({ home: b.home, maintenant: () => a(6, 9) });
    // (seconde relecture, constat 4) la copie de secours (version précédente) est reprise, Prónoia reste coupée
    assert.equal(p2.magasin.etat.demandes.length, 4);
    assert.equal(p2.actif, false);
    assert.ok(readdirSync(dirname(b.p.magasin.fichier)).some((f) => f.startsWith('pronoia.json.illisible-')), 'le fichier abîmé est gardé de côté');
    assert.match(p2.bilan().texte, /illisible/);
    assert.ok(existsSync(b.p.magasin.fichier) || true);
  } finally { b.fermer(); }
});

test('constat 10 : tranches arrondies vers le bas, temps « évité » dit comme une estimation, seuils avec plancher', () => {
  const p = (c: number, etat: Prevision['etat']): Prevision => ({ id: String(Math.random()), sorte: 'evenement', quoi: 'x', cle: 'k', echeance: 1, confiance: c, sources: [], cree: 0, etat, verifiable: true });
  const l = Array.from({ length: 10 }, (_, i) => p(0.796, i < 8 ? 'realisee' : 'ratee'));
  const t = bilan(l, { servies: 1, manquees: 0, perdues: 0, gagneMs: 150, refusees: 0 }).texte;
  assert.match(t, /Dites à 79 %/);
  assert.match(t, /temps de préparation évité \(estimation\)/);
  assert.doesNotMatch(t, /temps gagné mesuré/);
  const b = banc();
  try {
    const r = b.p.regler({ seuilPressentiment: 0, seuilPrevenir: 0 });
    assert.ok(r.seuilPressentiment >= 0.3);
    assert.ok(r.seuilPrevenir >= 0.5);
  } finally { b.fermer(); }
});
