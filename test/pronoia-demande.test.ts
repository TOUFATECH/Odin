// Prónoia — lot 2 : anticiper la demande et la suite de l'échange, préparer d'avance en lecture seule, mesurer le
// temps gagné. Faux historique (habitudes nettes), fausse horloge, faux Noûs, fausse fonction « préparer ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { banc, a, hasard, attendre, MIN } from './pronoia-outils-essai.ts';
import { MOTS_CERTITUDE } from '../src/valhalla/pronoia/honnete.ts';
import type { Pronoia } from '../src/valhalla/pronoia/moteur.ts';

const METEO = 'quelle météo pour aujourd\'hui à Lyon';
const MAILS = 'résume mes mails non lus';
const AGENDA = 'montre mon agenda du jour';
const MUSIQUE = 'lance la musique du soir dans le salon';

/** 21 jours d'habitudes nettes : météo vers 7h30, puis mails (≈ 70 %) ou agenda ; musique vers 19h. */
function historique(b: { horloge: { t: number }; p: Pronoia }, jours = 21, graine = 7): void {
  const r = hasard(graine);
  for (let j = 0; j < jours; j++) {
    b.horloge.t = a(j, 7, 28 + Math.floor(r() * 5)); b.p.noterDemande(METEO);
    b.horloge.t += 4 * MIN; b.p.noterDemande(r() < 0.7 ? MAILS : AGENDA);
    b.horloge.t = a(j, 19, Math.floor(r() * 10)); b.p.noterDemande(MUSIQUE);
  }
}

test('anticipe la prochaine demande selon l\'heure, prépare la réponse et la sert plus vite (temps gagné mesuré)', async () => {
  const appels: string[] = [];
  const DELAI = 150;
  const b = banc({ preparer: async (d, o) => { appels.push(d); assert.equal(o.lectureSeule, true); await attendre(DELAI); return `réponse préparée pour ${d}`; } });
  try {
    historique(b);
    // Référence : la même réponse calculée à la demande (sans anticipation) prend ce temps-là.
    const t0 = performance.now(); await attendre(DELAI); const sansAnticipation = performance.now() - t0;
    b.horloge.t = a(21, 7, 26);
    const { propositions, preparees } = b.p.anticiper();
    assert.match(propositions[0].prevision.quoi, /météo/);
    assert.ok(propositions[0].prevision.confiance > 0.6, `confiance ${propositions[0].prevision.confiance}`);
    assert.equal(propositions[0].agit, false);
    assert.equal(propositions[0].niveau, 'discret');
    assert.ok(propositions[0].prevision.sources.some((s) => s.type === 'habitude'), 'l\'habitude est citée comme source');
    assert.deepEqual(await preparees, ['prete']);
    assert.deepEqual(appels, [METEO]);
    b.horloge.t = a(21, 7, 30);
    const t1 = performance.now();
    const r = b.p.noterDemande('quelle météo pour aujourd\'hui à Lyon ?');
    const servi = performance.now() - t1;
    assert.ok(r.servie, 'la réponse préparée est servie');
    assert.match(r.servie!.texte, /réponse préparée/);
    assert.ok(r.servie!.gagneMs >= DELAI * 0.8, `gagné ${r.servie!.gagneMs} ms`);
    assert.ok(servi < sansAnticipation / 2, `servi en ${servi.toFixed(1)} ms contre ${sansAnticipation.toFixed(1)} ms sans anticipation`);
    // la prévision « météo » est jugée réalisée, et le bilan montre le temps gagné
    assert.equal(r.jugees[0].etat, 'realisee');
    const bil = b.p.bilan();
    assert.equal(bil.preparation.servies, 1);
    assert.match(bil.texte, /temps de préparation évité \(estimation\)/);
    console.log(`# mesuré : servi en ${servi.toFixed(2)} ms ; sans anticipation ${sansAnticipation.toFixed(1)} ms ; gagné ${r.servie!.gagneMs.toFixed(1)} ms`);
  } finally { b.fermer(); }
});

test('devine les questions qui suivront (enchaînements) avec une confiance proche de la fréquence vraie', () => {
  const b = banc();
  try {
    historique(b, 40);
    b.horloge.t = a(40, 7, 31);
    const { propositions } = b.p.questionsSuivantes(METEO);
    assert.match(propositions[0].prevision.quoi, /mails/);
    const c = propositions[0].prevision.confiance;
    assert.ok(c > 0.5 && c < 0.85, `confiance ${c} (vraie fréquence 0,7)`);
    assert.ok(propositions[0].prevision.sources.some((s) => s.type === 'enchainement'));
    assert.match(propositions[1].prevision.quoi, /agenda/);
    assert.ok(propositions[1].prevision.confiance < 0.5);
  } finally { b.fermer(); }
});

test('calibration mesurée : la confiance annoncée des suites suit la fréquence observée', () => {
  const b = banc();
  try {
    historique(b, 30, 11);
    const r = hasard(99);
    for (let j = 30; j < 230; j++) {
      b.horloge.t = a(j, 7, 30); b.p.noterDemande(METEO);
      b.p.questionsSuivantes(METEO);
      b.horloge.t += 4 * MIN; b.p.noterDemande(r() < 0.7 ? MAILS : AGENDA);
    }
    const bil = b.p.bilan();
    const s = bil.parSorte.suite;
    assert.equal(s.realisees + s.ratees, 200);
    for (const t of bil.tranches.filter((x) => x.jugees >= 30)) assert.ok(Math.abs(t.ecart!) < 0.1, `tranche ${t.de}–${t.a} : annoncé ${t.annoncee.toFixed(2)}, observé ${t.observee!.toFixed(2)}`);
    console.log(`# mesuré : suites jugées 200, taux ${(s.taux! * 100).toFixed(1)} % ; tranches ${bil.tranches.map((t) => `${t.annoncee.toFixed(2)}→${t.observee!.toFixed(2)} (${t.jugees})`).join(', ')}`);
  } finally { b.fermer(); }
});

test('complète pendant la frappe, et la suite de Noûs est un pressentiment faute de confiance mesurée', async () => {
  const b = banc({ suiteNous: async (p) => ({ suite: ' de la semaine prochaine' }) });
  try {
    historique(b);
    b.horloge.t = a(21, 7, 25);
    const l = await b.p.completer('quelle mé');
    assert.equal(l[0].prevision.quoi, `demander « ${METEO} »`);
    assert.ok(l[0].prevision.confiance > 0.5 && l[0].prevision.confiance < 1);
    const n = await b.p.completer('quel est le programme');
    assert.equal(n.length, 1);
    assert.match(n[0].texte, /^Pressentiment \(confiance 0 %, peu sûr\)/);
    assert.match(n[0].texte, /Noûs \(confiance non mesurée\)/);
    // la frappe n'est pas une demande : rien n'est appris
    assert.equal(b.p.magasin.etat.demandes.length, 63);
  } finally { b.fermer(); }
});

test('LIMITE : aucune prévision, même à confiance maximale, ne lance une action ni ne prépare une demande qui agit', async () => {
  const appels: string[] = [];
  const b = banc({ preparer: async (d) => { appels.push(d); return 'x'; }, seuilPreparer: 0 });
  try {
    // une seule demande, tous les jours à 19h : confiance très haute
    for (let j = 0; j < 30; j++) { b.horloge.t = a(j, 19, 0); b.p.noterDemande(MUSIQUE); }
    b.horloge.t = a(30, 18, 58);
    const { propositions, preparees } = b.p.anticiper();
    assert.ok(propositions[0].prevision.confiance > 0.9);
    assert.deepEqual(await preparees, ['refusee']);
    assert.deepEqual(appels, [], 'la fonction préparer n\'a même pas été appelée');
    for (const p of propositions) { assert.equal(p.agit, false); assert.equal(p.niveau, 'discret'); assert.doesNotMatch(p.texte, MOTS_CERTITUDE); }
    assert.equal(b.p.bilan().preparation.refusees, 1);
    // le moteur n'a aucun moyen d'agir : aucune méthode d'exécution, d'envoi ou de notification
    const methodes = Object.getOwnPropertyNames(Object.getPrototypeOf(b.p));
    for (const m of methodes) assert.doesNotMatch(m, /^(agir|executer|envoyer|notifier|acheter|act|run|send|notify)$/i);
  } finally { b.fermer(); }
});

test('mode privé et « ne pas garder » : rien n\'est appris ni gardé', () => {
  let prive = false;
  const b = banc({ prive: () => prive });
  try {
    historique(b, 5);
    const avant = readFileSync(b.p.magasin.fichier, 'utf8');
    const n = b.p.magasin.etat.demandes.length;
    b.horloge.t = a(6, 10, 0);
    assert.deepEqual(b.p.noterDemande('mon rendez-vous médical secret de mardi', { prive: true }), { jugees: [] });
    assert.deepEqual(b.p.noterDemande('autre chose à ne pas garder', { nePasGarder: true }), { jugees: [] });
    prive = true;
    b.p.noterDemande('demande en mode privé global');
    assert.deepEqual(b.p.anticiper().propositions, []);
    assert.equal(b.p.magasin.etat.demandes.length, n);
    assert.equal(readFileSync(b.p.magasin.fichier, 'utf8'), avant, 'le fichier n\'a pas bougé');
    assert.ok(!b.p.magasin.etat.demandes.some((d) => /secret|privé|garder/.test(d.texte)));
    const notesAvant = b.notes.length;
    b.p.noterDemande(METEO);
    assert.equal(b.notes.length, notesAvant, 'rien n\'est transmis à Noûs en privé');
  } finally { b.fermer(); }
});

test('interrupteur coupé : plus aucune anticipation ; rallumé, elle reprend', async () => {
  let appels = 0;
  const b = banc({ preparer: async () => { appels++; return 'x'; } });
  try {
    historique(b, 10);
    b.horloge.t = a(10, 7, 20);
    b.p.anticiper();
    b.p.couper();
    assert.equal(b.p.actif, false);
    assert.ok(b.p.previsions().every((p) => p.etat !== 'en_attente'), 'les prévisions en attente ne sont plus suivies');
    const n = b.p.magasin.etat.demandes.length;
    assert.deepEqual(b.p.anticiper().propositions, []);
    assert.deepEqual(await b.p.completer('quelle mé'), []);
    assert.deepEqual(b.p.questionsSuivantes(METEO).propositions, []);
    b.p.noterDemande(METEO);
    assert.equal(b.p.magasin.etat.demandes.length, n, 'rien n\'est appris quand c\'est coupé');
    const appelsCoupe = appels;
    b.p.allumer();
    assert.ok(b.p.anticiper().propositions.length > 0);
    assert.ok(appels >= appelsCoupe);
  } finally { b.fermer(); }
});

test('Odin doit répondre : l\'anticipation en cours s\'arrête (signal d\'abandon)', async () => {
  let signal: AbortSignal | undefined;
  const b = banc({ preparer: (_d, o) => { signal = o.signal; return new Promise((res) => setTimeout(() => res('trop tard'), 5000).unref()); } });
  try {
    historique(b, 10);
    b.horloge.t = a(10, 7, 20);
    const { preparees } = b.p.anticiper();
    assert.ok(b.p.abandonner() >= 1);
    const issues = await preparees;
    assert.ok(issues.length >= 1 && issues.every((x) => x === 'abandon'), String(issues));
    assert.equal(signal?.aborted, true);
    b.horloge.t = a(10, 7, 30);
    assert.equal(b.p.noterDemande(METEO).servie, undefined);
  } finally { b.fermer(); }
});

test('mémoire et temps bornés : budget de préparation, cache court (TTL)', async () => {
  const b = banc({ preparer: (_d, o) => new Promise((res) => { const t = setTimeout(() => res('lent'), 5000); t.unref(); o.signal.addEventListener('abort', () => clearTimeout(t)); }), preparation: { budgetMs: 50, ttlMs: 60_000 } });
  try {
    historique(b, 10);
    b.horloge.t = a(10, 7, 20);
    const t0 = performance.now();
    const issues = await b.p.anticiper().preparees;
    assert.ok(issues.length >= 1 && issues.every((x) => x === 'abandon'), String(issues));
    assert.ok(performance.now() - t0 < 1000, 'le budget de temps est tenu');
  } finally { b.fermer(); }
  const c = banc({ preparer: async () => 'vite', preparation: { ttlMs: 60_000 } });
  try {
    historique(c, 10);
    c.horloge.t = a(10, 7, 20);
    assert.ok((await c.p.anticiper().preparees).includes('prete'));
    c.horloge.t = a(10, 7, 22) + 60_000; // la réponse préparée a plus d'une minute : périmée, pas servie
    assert.equal(c.p.noterDemande(METEO).servie, undefined);
    assert.ok(c.p.bilan().preparation.perdues >= 1);
  } finally { c.fermer(); }
});

test('l\'écart entre la demande prévue et la vraie nourrit Noûs (erreur de prédiction)', () => {
  const b = banc();
  try {
    historique(b, 10);
    b.notes.length = 0;
    b.horloge.t = a(10, 7, 20);
    b.p.anticiper();
    b.horloge.t = a(10, 7, 25);
    b.p.noterDemande('quel temps fera-t-il ce week-end en montagne');
    const n = b.notes.find((x) => /ratée/.test(x.texte));
    assert.ok(n, JSON.stringify(b.notes));
    assert.match(n!.texte, /prévu : demander « quelle météo/);
    assert.match(n!.texte, /arrivé : quel temps fera-t-il/);
    assert.equal(n!.source, 'pronoia:demande');
  } finally { b.fermer(); }
});
