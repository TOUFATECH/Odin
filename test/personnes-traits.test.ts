// Profil, lot 3 — ce qu'Odin MESURE de la façon de parler et des habitudes d'une personne : calculé sur son
// historique (lot 1), chaque mesure avec son nombre d'observations (« trop peu » sous 20) ; caché ou corrigé par le
// propriétaire seul ; qui voit, par la fonction unique du lot 1 ; gardé et refait au plus une fois par heure ou quand
// l'historique change ; effacé avec l'historique. Aucune langue supposée, aucune liste de mots. Prénoms inventés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Mnemosyne } from '../src/muninn/store.ts';
import { SEUIL_TROP_PEU, mesurer, rendreMesures, validerCorrection, type Observation } from '../src/muninn/traits.ts';
import { langueDe } from '../src/core/offline.ts';
import { attachmentHint } from '../src/files/attach.ts';
import { PROPRIETAIRE, apercuEffacement, effacerHistoriquePersonne, mesuresPersonne, reglerMesure } from '../src/muninn/personnes.ts';

const H = 3_600_000;
/** Un détecteur fabriqué : le texte commence par son code (« swb| … »), « ?| » = langue pas sûre. */
const detecteur = (s: string) => { const c = s.split('|')[0]; return c === '?' ? undefined : c; };
const obs = (n: number, f: (i: number) => Partial<Observation>): Observation[] => Array.from({ length: n }, (_, i) => ({ t: i * H, resultat: 'reussi', ...f(i) }));

test('mesures pures : langues en parts (dont une rare), sans langue supposée ; longueur médiane ; 24 heures ; part abouties ; applis non mesurées', () => {
  // 24 demandes : 10 en « en », 6 en « es », 5 en « swb » (shimaoré), 3 dont la langue n'est pas sûre.
  const codes = [...Array(10).fill('en'), ...Array(6).fill('es'), ...Array(5).fill('swb'), ...Array(3).fill('?')];
  const o = obs(24, (i) => ({ texte: `${codes[i]}|${'x'.repeat(i)}`, t: Date.UTC(2026, 0, 1, i % 3 === 0 ? 7 : 21), resultat: ['reussi', 'echoue', 'reussi', 'reussi'][i % 4] }));
  // Deux commandes sans tour et une demande en cours : comptées dans les heures, pas dans la part des abouties.
  o.push({ t: Date.UTC(2026, 0, 2, 7), resultat: 'sans_tour' }, { t: Date.UTC(2026, 0, 2, 7), resultat: 'sans_tour' }, { t: Date.UTC(2026, 0, 2, 7), resultat: 'en_cours' });
  const m = Object.fromEntries(mesurer(o, { langueDe: detecteur, heureDe: (t) => new Date(t).getUTCHours() }).map((x) => [x.cle, x]));
  assert.deepEqual(Object.keys(m).sort(), ['abouties', 'applis', 'heures', 'langues', 'longueur']);
  // Langues : sur les 24 demandes dont le texte est retrouvé ; la langue pas sûre reste « non reconnue », jamais devinée.
  assert.equal(m.langues.etat, 'mesure'); assert.equal(m.langues.n, 24); assert.equal(m.langues.tropPeu, false);
  assert.deepEqual(m.langues.valeur, { parts: [{ code: 'en', n: 10, part: 0.417 }, { code: 'es', n: 6, part: 0.25 }, { code: 'swb', n: 5, part: 0.208 }], nonReconnues: { n: 3, part: 0.125 } });
  assert.ok(!JSON.stringify(m.langues.valeur).includes('"fr"'), 'aucune langue supposée');
  // Longueur : en caractères (graphèmes) ; le code de langue fabriqué compte, c'est le texte entier.
  const longueurs = codes.map((c, i) => c.length + 1 + i).sort((a, b) => a - b);
  assert.deepEqual(m.longueur.valeur, { mediane: (longueurs[11] + longueurs[12]) / 2, unite: 'grapheme' });
  // Heures : toutes les demandes (27), commandes comprises.
  const cases = (m.heures.valeur as { cases: number[] }).cases;
  assert.equal(m.heures.n, 27); assert.equal(cases.length, 24);
  assert.equal(cases[7], 8 + 3); assert.equal(cases[21], 16);
  // Abouties : les tours terminés ou arrêtés (ni les commandes, ni le tour en cours) ; 18 réussis sur 24.
  assert.deepEqual(m.abouties.valeur, { part: 0.75, abouties: 18 }); assert.equal(m.abouties.n, 24);
  // Applis : l'historique ne note pas l'appli qui a servi la demande → non mesuré, rien d'inventé.
  assert.equal(m.applis.etat, 'non-mesure'); assert.equal(m.applis.n, 0); assert.equal(m.applis.valeur, null); assert.equal(m.applis.aNoter, 'appli-du-tour');
});

test('« trop peu » sous 20 observations, chaque mesure avec son nombre', () => {
  const opts = { langueDe: detecteur, heureDe: () => 9 };
  const m19 = Object.fromEntries(mesurer(obs(SEUIL_TROP_PEU - 1, () => ({ texte: 'en|a' })), opts).map((x) => [x.cle, x]));
  const m20 = Object.fromEntries(mesurer(obs(SEUIL_TROP_PEU, () => ({ texte: 'en|a' })), opts).map((x) => [x.cle, x]));
  assert.equal(SEUIL_TROP_PEU, 20);
  for (const k of ['langues', 'longueur', 'heures', 'abouties']) {
    assert.equal(m19[k].n, 19); assert.equal(m19[k].tropPeu, true, `${k} : trop peu à 19`);
    assert.equal(m20[k].n, 20); assert.equal(m20[k].tropPeu, false, `${k} : assez à 20`);
  }
  // Aucune demande : des mesures vides, pas de division par zéro.
  const vide = Object.fromEntries(mesurer([], opts).map((x) => [x.cle, x]));
  assert.equal(vide.langues.n, 0); assert.equal(vide.langues.tropPeu, true); assert.equal(vide.longueur.valeur, null); assert.equal(vide.abouties.valeur, null);
});

test('cacher et corriger : rendus avec la marque ; un membre ne voit pas une mesure cachée ; une correction mal formée est refusée', () => {
  const mesures = mesurer(obs(20, () => ({ texte: 'en|a' })), { langueDe: detecteur, heureDe: () => 9 });
  const reglages = { heures: { cache: true, t: 1 }, langues: { valeur: validerCorrection('langues', { parts: [{ code: 'swb', part: 0.6 }, { code: 'en', part: 0.4 }] }), t: 2 } };
  const proprio = Object.fromEntries(rendreMesures(mesures, reglages, true).map((x) => [x.cle, x]));
  assert.equal(proprio.heures.cache, true, 'le propriétaire voit qu\'elle est cachée (pour la remettre)');
  assert.equal(proprio.langues.corrigeParProprietaire, true);
  assert.deepEqual(proprio.langues.valeur, { parts: [{ code: 'swb', part: 0.6 }, { code: 'en', part: 0.4 }] });
  assert.deepEqual(proprio.langues.valeurMesuree, mesures.find((x) => x.cle === 'langues')!.valeur, 'le propriétaire garde la mesure d\'Odin à côté');
  const membre = Object.fromEntries(rendreMesures(mesures, reglages, false).map((x) => [x.cle, x]));
  assert.equal(membre.heures, undefined, 'une mesure cachée n\'est pas rendue au membre');
  assert.equal(membre.langues.corrigeParProprietaire, true); assert.equal(membre.langues.valeurMesuree, undefined);
  assert.equal(membre.longueur.corrigeParProprietaire, false);
  // Corrections mal formées.
  assert.equal(validerCorrection('langues', { parts: [{ code: 'pas un code', part: 0.5 }] }), undefined);
  assert.equal(validerCorrection('langues', { parts: [{ code: 'en', part: 0.8 }, { code: 'es', part: 0.8 }] }), undefined, 'parts > 1');
  assert.equal(validerCorrection('heures', { cases: [1, 2, 3] }), undefined, '24 cases');
  assert.equal(validerCorrection('abouties', { part: 2 }), undefined);
  assert.equal(validerCorrection('inconnue' as never, {}), undefined);
  assert.deepEqual(validerCorrection('longueur', { mediane: 42 }), { mediane: 42, unite: 'grapheme' });
});

/** Une personne et son historique dans la mémoire d'Odin : une demande = un message, un tour, une ligne de renvois. */
function remplir(mu: Mnemosyne, qui: string, session: string, textes: string[], t0 = Date.UTC(2026, 10, 1, 8)): void {
  textes.forEach((texte, i) => {
    const message = mu.addMessage(session, { role: 'user', content: texte });
    const mission = `m-${session}-${i}-${mu.lignesHistorique(() => true).length}`;
    mu.startMission({ id: mission, sessionId: session, goal: texte, origin: 'utilisateur' });
    mu.endMission(mission, i % 5 === 4 ? 'échouée' : 'terminée', '');
    mu.noterHistorique({ t: t0 + i * H, qui, session, canal: session.split(':')[0], sorte: 'demande', preuve: 'appareil-appaire', partage: false, mission, message });
  });
}

// Des demandes fabriquées en anglais, en espagnol, en japonais ; et une langue rare que le reconnaisseur d'Odin n'a pas.
const EN = ['Please remind me to water the plants tomorrow morning', 'What is the weather like in the mountains this weekend', 'Turn off the lights in the kitchen when everyone has left'];
const ES = ['¿Puedes poner música tranquila en el salón, por favor?', 'Recuérdame comprar pan y leche antes de las siete'];
const JA = ['明日の朝、植物に水をやるのを思い出させてください', '今週末の山の天気はどうですか'];
const RARE = 'Ngamba hunu ndrovi tsi tsaha ujua';

function maison() {
  const mu = new Mnemosyne(':memory:');
  const nori = mu.saveUser({ name: 'Nori', role: 'member' }), tavi = mu.saveUser({ name: 'Tavi', role: 'member' });
  mu.linkIdentity('telegram', '11', nori.id); mu.linkIdentity('telegram', '22', tavi.id);
  const lien = (user_id: string, persona_id: string) => mu.table<Record<string, unknown>>('personnes_liens', (r) => String(r.user_id)).put({ user_id, persona_id, par: PROPRIETAIRE, t: 1 });
  lien(nori.id, 'p-nori'); lien(tavi.id, 'p-tavi');
  return { mu, nori, tavi };
}

test('sur l\'historique réel d\'une personne, avec le reconnaisseur de langue d\'Odin : trois langues, la rare jamais devinée en français', () => {
  const { mu, nori } = maison();
  // Une ligne dont le message n'existe plus (conversation effacée) : comptée dans les heures, pas dans les langues.
  const textes = [...EN, ...EN, ...ES, ...ES, ...JA, ...JA, RARE, RARE, RARE, EN[0], ES[0], JA[0], EN[1]];
  remplir(mu, nori.id, 'telegram:11', textes);
  mu.noterHistorique({ t: Date.UTC(2026, 10, 2, 8), qui: nori.id, session: 'telegram:11', canal: 'telegram', sorte: 'demande', preuve: 'appareil-appaire', partage: false, mission: 'disparu', message: 999_999 });
  const r = mesuresPersonne(mu, { sorte: 'proprietaire' }, nori.id);
  assert.ok(r.ok);
  const m = Object.fromEntries(r.mesures.map((x) => [x.cle, x]));
  assert.equal(m.langues.n, textes.length, 'les demandes dont le message est retrouvé');
  assert.equal(m.heures.n, textes.length + 1, 'toutes les demandes');
  const parts = (m.langues.valeur as { parts: Array<{ code: string; n: number }>; nonReconnues: { n: number } });
  const n = (c: string) => parts.parts.find((p) => p.code === c)?.n ?? 0;
  assert.equal(n('en'), 8); assert.equal(n('es'), 5); assert.equal(n('ja'), 5);
  assert.ok(!parts.parts.some((p) => p.code === 'fr'), 'jamais le français par défaut');
  assert.equal(parts.parts.reduce((s, p) => s + p.n, 0) + parts.nonReconnues.n, textes.length, 'chaque demande comptée une fois');
  assert.equal(m.langues.tropPeu, false);
  // Le texte n'est jamais gardé : seulement des codes et des nombres.
  const garde = JSON.stringify(mu.kvPrefix('personnes-traits'));
  for (const s of [...EN, ...ES, ...JA, RARE]) assert.ok(!garde.includes(s.slice(0, 12)), 'aucun texte gardé');
});

test('le message d\'un invité, enveloppé comme contenu non fiable, est mesuré sur son texte seul', () => {
  const { mu, nori } = maison();
  const enveloppe = (s: string) => `<untrusted source="telegram:11">\n${s}\n</untrusted>`;
  remplir(mu, nori.id, 'telegram:11', Array(20).fill(enveloppe(EN[0])));
  const r = mesuresPersonne(mu, { sorte: 'proprietaire' }, nori.id);
  assert.ok(r.ok);
  const m = Object.fromEntries(r.mesures.map((x) => [x.cle, x]));
  assert.deepEqual((m.longueur.valeur as { mediane: number }).mediane, EN[0].length);
  assert.equal((m.langues.valeur as { parts: Array<{ code: string }> }).parts[0].code, 'en');
});

test('les ajouts d\'Odin au message (page ouverte, Plume, précision de langue, fichiers joints) ne sont jamais mesurés comme la parole de la personne', () => {
  const { mu, nori } = maison();
  // Les formes réelles : web/server.ts:1234 et :1239 (fichiers, page), bifrost/gateway.ts:449 et :451 (précision, Plume).
  const page = (s: string) => `${s}\n\n[page : Réglages de la maison et des appareils]`;
  const plume = (s: string) => `${s}\n\n[Plume, le correcteur d'Odin, a relu le texte à corriger : rien à signaler.]`;
  const precision = (s: string) => `${s}\n\n[Précision d'Odin pour lui-même : il t'a parlé en espagnol (es) ; réponds en espagnol.]`;
  const joint = (s: string) => `${s}\n\n${attachmentHint('inbox/photo.jpg', 'image/jpeg', 2048)}`;
  const DE = 'Mach das Licht aus';
  // Une phrase que le reconnaisseur ne reconnaît pas seule : avec la page ajoutée, elle passait pour du français.
  assert.equal(langueDe(DE), undefined); assert.equal(langueDe(page(DE)), 'fr', 'la preuve du défaut (offline.ts)');
  const textes = [
    ...Array(5).fill(page(DE)), ...Array(5).fill(page(RARE)), ...Array(4).fill(plume(EN[0])), ...Array(4).fill(precision(ES[1])), page(plume(EN[0])), joint(EN[0]),
    // Un message fait seulement de fichiers : le texte par défaut d'Odin (server.ts:1234) n'est pas sa parole.
    joint('Regarde ce fichier et dis-moi ce qu\'il contient.'),
  ];
  remplir(mu, nori.id, 'web:principal', textes);
  const r = mesuresPersonne(mu, { sorte: 'proprietaire' }, nori.id);
  assert.ok(r.ok);
  const m = Object.fromEntries(r.mesures.map((x) => [x.cle, x]));
  const v = m.langues.valeur as { parts: Array<{ code: string; n: number }>; nonReconnues: { n: number } };
  assert.ok(!v.parts.some((p) => p.code === 'fr'), `aucun français ajouté par Odin : ${JSON.stringify(v)}`);
  assert.equal(v.nonReconnues.n, 10, 'les phrases non reconnues le restent');
  assert.equal(m.langues.n, textes.length - 2, 'les messages avec fichiers joints ne sont pas mesurés');
  assert.equal(m.heures.n, textes.length, 'mais comptent dans les heures');
  // La longueur : celle de ce que la personne a écrit, sans les ajouts.
  const longueurs = [...Array(5).fill(DE.length), ...Array(5).fill(RARE.length), ...Array(5).fill(EN[0].length), ...Array(4).fill(ES[1].length)].sort((a, b) => a - b);
  assert.equal((m.longueur.valeur as { mediane: number }).mediane, longueurs[9]);
});

test('une conversation mise à la corbeille ou remise : les mesures sont refaites sans attendre l\'heure', () => {
  const { mu, nori } = maison();
  mu.ensureSession('telegram:11', 'telegram', '11'); mu.ensureSession('telegram:33', 'telegram', '33');
  remplir(mu, nori.id, 'telegram:11', Array(5).fill(EN[0])); remplir(mu, nori.id, 'telegram:33', Array(5).fill(ES[0]));
  const t0 = Date.UTC(2026, 10, 3);
  const langues = (maintenant: number) => { const r = mesuresPersonne(mu, { sorte: 'proprietaire' }, nori.id, { maintenant }); assert.ok(r.ok); return r.mesures.find((x) => x.cle === 'langues')!; };
  assert.equal(langues(t0).n, 10);
  assert.ok(mu.trashSession('telegram:33'));
  const apres = langues(t0 + 60_000);
  assert.equal(apres.n, 5, 'les textes partis ne sont plus mesurés');
  assert.ok(!(apres.valeur as { parts: Array<{ code: string }> }).parts.some((p) => p.code === 'es'));
  assert.ok(mu.restoreSession('telegram:33'));
  assert.equal(langues(t0 + 120_000).n, 10, 'remise : de nouveau mesurée');
});

test('qui voit : le propriétaire tout ; un membre les siennes seulement, jamais celles d\'un autre ; un invité rien ; seul le propriétaire cache ou corrige', () => {
  const { mu, nori, tavi } = maison();
  remplir(mu, nori.id, 'telegram:11', Array(20).fill(EN[0])); remplir(mu, tavi.id, 'telegram:22', Array(20).fill(ES[0]));
  const noriD = { sorte: 'membre' as const, personaId: 'p-nori' };
  assert.equal(mesuresPersonne(mu, noriD, nori.id).ok, true, 'les siennes');
  assert.deepEqual(mesuresPersonne(mu, noriD, tavi.id), { ok: false, raison: 'autre-personne' });
  assert.deepEqual(mesuresPersonne(mu, noriD, PROPRIETAIRE), { ok: false, raison: 'autre-personne' });
  assert.deepEqual(mesuresPersonne(mu, { sorte: 'invite' }, nori.id), { ok: false, raison: 'invite' });
  assert.deepEqual(mesuresPersonne(mu, { sorte: 'membre', personaId: 'p-inconnu' }, nori.id), { ok: false, raison: 'lien-absent' });
  mu.setKv('personnes-visibilite', 'proprietaire');
  assert.deepEqual(mesuresPersonne(mu, noriD, nori.id), { ok: false, raison: 'reglage-proprietaire-seul' });
  mu.setKv('personnes-visibilite', 'chacun_la_sienne');
  // Une personne qui n'existe pas (un inconnu non appairé n'a pas de personne) : pas de mesures.
  assert.deepEqual(mesuresPersonne(mu, { sorte: 'proprietaire' }, 'u_inconnu'), { ok: false, raison: 'personne-inconnue' });
  // Cacher et corriger : le propriétaire seul.
  assert.deepEqual(reglerMesure(mu, noriD, nori.id, 'heures', { cacher: true }), { ok: false, raison: 'proprietaire-seul' });
  assert.deepEqual(reglerMesure(mu, { sorte: 'invite' }, nori.id, 'heures', { cacher: true }), { ok: false, raison: 'proprietaire-seul' });
  assert.equal(mu.kvPrefix('personnes-traits-proprietaire:')[nori.id], undefined, 'rien n\'est rangé après un refus');
  assert.deepEqual(reglerMesure(mu, { sorte: 'proprietaire' }, nori.id, 'langues', { corriger: { parts: [{ code: 'xx yy', part: 1 }] } }), { ok: false, raison: 'correction-invalide' });
  assert.deepEqual(reglerMesure(mu, { sorte: 'proprietaire' }, nori.id, 'pas-une-mesure' as never, { cacher: true }), { ok: false, raison: 'mesure-inconnue' });
  assert.deepEqual(reglerMesure(mu, { sorte: 'proprietaire' }, 'u_inconnu', 'heures', { cacher: true }), { ok: false, raison: 'personne-inconnue' });
  assert.deepEqual(reglerMesure(mu, { sorte: 'proprietaire' }, nori.id, 'heures', { cacher: true }), { ok: true });
  assert.deepEqual(reglerMesure(mu, { sorte: 'proprietaire' }, nori.id, 'langues', { corriger: { parts: [{ code: 'swb', part: 1 }] } }), { ok: true });
  const vu = (d: Parameters<typeof mesuresPersonne>[1]) => { const r = mesuresPersonne(mu, d, nori.id); assert.ok(r.ok); return Object.fromEntries(r.mesures.map((x) => [x.cle, x])); };
  let m = vu(noriD);
  assert.equal(m.heures, undefined, 'cachée pour elle');
  assert.deepEqual(m.langues.valeur, { parts: [{ code: 'swb', part: 1 }] }); assert.equal(m.langues.corrigeParProprietaire, true);
  m = vu({ sorte: 'proprietaire' });
  assert.equal(m.heures.cache, true); assert.equal((m.langues.valeurMesuree as { parts: Array<{ code: string }> }).parts[0].code, 'en');
  // Les réglages de Nori ne touchent pas Tavi.
  const t = mesuresPersonne(mu, { sorte: 'proprietaire' }, tavi.id); assert.ok(t.ok);
  assert.ok(t.mesures.every((x) => !x.cache && !x.corrigeParProprietaire));
  // Annuler : la mesure d'Odin revient.
  assert.deepEqual(reglerMesure(mu, { sorte: 'proprietaire' }, nori.id, 'heures', { annuler: true }), { ok: true });
  assert.deepEqual(reglerMesure(mu, { sorte: 'proprietaire' }, nori.id, 'langues', { annuler: true }), { ok: true });
  m = vu(noriD);
  assert.equal(m.heures.n, 20); assert.equal(m.langues.corrigeParProprietaire, false);
});

test('gardé : pas de calcul à chaque affichage ; refait quand l\'historique change, ou au bout d\'une heure', () => {
  const { mu, nori } = maison();
  remplir(mu, nori.id, 'telegram:11', Array(5).fill(EN[0]));
  let appels = 0; const langueDe = (s: string) => { appels++; return detecteur(`en|${s}`); };
  const lire = (maintenant: number) => { const r = mesuresPersonne(mu, { sorte: 'proprietaire' }, nori.id, { maintenant, langueDe }); assert.ok(r.ok); return r; };
  const t0 = Date.UTC(2026, 10, 3);
  assert.equal(lire(t0).calculeLe, t0); assert.equal(appels, 5);
  assert.equal(lire(t0 + 10 * 60_000).calculeLe, t0, 'gardé'); assert.equal(appels, 5, 'aucun nouveau calcul');
  remplir(mu, nori.id, 'telegram:11', [EN[1]]);
  const r = lire(t0 + 20 * 60_000);
  assert.equal(r.calculeLe, t0 + 20 * 60_000, 'l\'historique a changé : refait'); assert.equal(r.mesures.find((x) => x.cle === 'heures')!.n, 6);
  appels = 0;
  lire(t0 + 30 * 60_000); assert.equal(appels, 0);
  assert.equal(lire(t0 + 20 * 60_000 + H).calculeLe, t0 + 20 * 60_000 + H, 'une heure après : refait');
});

test('effacer l\'historique d\'une personne efface aussi ses mesures gardées ; le bilan dit que les réglages du propriétaire restent', () => {
  const { mu, nori, tavi } = maison();
  remplir(mu, nori.id, 'telegram:11', Array(20).fill(EN[0])); remplir(mu, tavi.id, 'telegram:22', Array(20).fill(ES[0]));
  assert.ok(mesuresPersonne(mu, { sorte: 'proprietaire' }, nori.id).ok); assert.ok(mesuresPersonne(mu, { sorte: 'proprietaire' }, tavi.id).ok);
  reglerMesure(mu, { sorte: 'proprietaire' }, nori.id, 'heures', { cacher: true });
  assert.ok(mu.kvPrefix('personnes-traits:')[nori.id], 'gardé');
  assert.equal(apercuEffacement(mu, { qui: nori.id }).reste.mesuresCorrigees, 1);
  effacerHistoriquePersonne(mu, { qui: nori.id });
  assert.equal(mu.kvPrefix('personnes-traits:')[nori.id], undefined, 'ses mesures gardées sont effacées');
  assert.ok(mu.kvPrefix('personnes-traits:')[tavi.id], 'celles de l\'autre restent');
  const r = mesuresPersonne(mu, { sorte: 'proprietaire' }, nori.id); assert.ok(r.ok);
  assert.ok(r.mesures.every((x) => x.n === 0), 'plus rien à mesurer');
  // Par période seule : toutes les mesures gardées sont effacées (elles seront refaites sur ce qui reste).
  effacerHistoriquePersonne(mu, { depuis: 0, jusqua: Date.UTC(2030, 0, 1) });
  assert.deepEqual(Object.keys(mu.kvPrefix('personnes-traits:')), []);
});

test('aucun texte d\'une langue dans traits.ts : seulement des codes', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/muninn/traits.ts', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  const chaines = [...src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((x) => x[1] ?? x[2] ?? x[3]);
  assert.ok(chaines.length > 0);
  for (const s of chaines) assert.match(s, /^[a-z0-9_|-]*$/, `une chaîne qui n'est pas un code : ${JSON.stringify(s)}`);
  assert.doesNotMatch(src, /\/[^/\n]*[a-z]{3,}[^/\n]*\/[giu]*\.test\(/i, 'aucune expression régulière de mots');
});
