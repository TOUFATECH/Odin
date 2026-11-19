// Masquer / réafficher la conversation unique (section 83 : « on peut masquer toute la conversation, ça repart sur une
// page vide complète où on peut réafficher toute l'historique ») : l'écran repart vide, rien n'est effacé ; Odin repart
// à neuf pour la suite (les marques « contenu non fiable » remises à zéro) ; « Réafficher l'historique » remet tout.
// Chacun pour son fil. « /new » et « masque la conversation » font la même chose. Les écrans techniques (maison, voix,
// Vénus, Cerveau, Réglages) sont dans le fil du propriétaire, étiquetés (sa réponse du 19/11 : « Dans le fil,
// étiquetés »). Le séparateur d'une conversation marquée porte ⚠.
// Un vrai Odin d'essai (serveur web + passerelle), dans un dossier temporaire, sur un port libre.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { Mnemosyne } from '../src/muninn/store.ts';
import { masquerFil, masquerSession, reafficherFil, type ElementFil } from '../src/muninn/fil.ts';
import { filAction, filDe } from '../src/web/fil-api.ts';
import { masquerCommand } from '../src/bifrost/gateway.ts';

const UI = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');
const fonction = (nom: string) => { const i = UI.indexOf(`function ${nom}(`); assert.ok(i > 0, `fonction ${nom} trouvée`); return UI.slice(i, UI.indexOf('\n  }\n', i)); };

/** Ajoute un message à une date choisie (la mémoire date chaque message à l'instant de l'écriture). */
function ecrire(mu: Mnemosyne, session: string, role: 'user' | 'assistant' | 'tool', texte: string, date: number, tainted = false): number {
  const vrai = Date.now; Date.now = () => date;
  try { return mu.addMessage(session, { role, content: texte, ...(tainted ? { tainted: true } : {}) }); } finally { Date.now = vrai; }
}
const textes = (l: ElementFil[]) => l.map((e) => (e.type === 'separateur' ? `[${e.marquee ? '⚠ ' : ''}${e.titre}]` : e.texte + (e.origine ? ` (${e.origine})` : '')));
const T0 = 1_800_000_000_000;

// ---------------------------------------------------------------- sans serveur

test('masquer : l\'écran repart vide, rien n\'est effacé, Odin repart à neuf ; réafficher remet tout', () => {
  const mu = new Mnemosyne(':memory:');
  for (const id of ['web:principal', 'web:c-ancienne', 'web:raccourci']) mu.ensureSession(id, 'web', id.slice(4));
  ecrire(mu, 'web:c-ancienne', 'user', 'a1', T0 + 1);
  ecrire(mu, 'web:principal', 'user', 'p1', T0 + 2); ecrire(mu, 'web:principal', 'tool', 'page lue sur le web', T0 + 3, true);
  ecrire(mu, 'web:principal', 'assistant', 'p2', T0 + 4); ecrire(mu, 'web:raccourci', 'user', 't1', T0 + 5);
  const avant = textes(filDe(mu, { proprio: true }, {}).elements), nb = mu.allMessages('web:principal').length;
  assert.equal(mu.getSession('web:principal')!.tainted, 1);
  assert.equal(filDe(mu, { proprio: true }, {}).masque, false);

  assert.equal(masquerFil(mu, { proprio: true }), true);
  const vide = filDe(mu, { proprio: true }, {});
  assert.deepEqual(vide.elements, [], 'page vide'); assert.equal(vide.suite, null); assert.equal(vide.masque, true);
  assert.equal(mu.allMessages('web:principal').length, nb, 'aucun message effacé');
  assert.deepEqual(avant, ['[]', 'a1', '[⚠ ]', 'p1', 'p2', 't1 (telephone)'], 'avant : la conversation est marquée ⚠');
  // Le ⚠ de ce qui a déjà été lu reste : la remise à zéro vaut pour la suite, pas pour l'historique.
  assert.deepEqual(textes(filDe(mu, { proprio: true }, { tout: true }).elements), avant, 'tout reste lisible (Historique : saut à un jour), avec son ⚠');
  // Odin repart à neuf : plus de contexte court d'avant, marque « contenu non fiable » remise à zéro.
  assert.equal(mu.history('web:principal').length, 0, 'contexte d\'avant laissé');
  assert.equal(mu.getSession('web:principal')!.tainted, 0, 'marque « contenu non fiable » remise à zéro');

  // Ce qui arrive après se voit, d'où qu'il vienne.
  ecrire(mu, 'web:principal', 'user', 'p3', T0 + 10); ecrire(mu, 'web:raccourci', 'user', 't2', T0 + 11);
  assert.deepEqual(textes(filDe(mu, { proprio: true }, {}).elements), ['[]', 'p3', 't2 (telephone)']);
  assert.equal(mu.history('web:principal').length, 1, 'Odin ne relit que la suite');

  assert.equal(reafficherFil(mu, { proprio: true }), true);
  const tout = filDe(mu, { proprio: true }, {});
  assert.equal(tout.masque, false);
  assert.deepEqual(textes(tout.elements), [...avant, 'p3', 't2 (telephone)'], 'réafficher : tout revient, ⚠ compris');
});

test('masquer : chacun pour son fil (propriétaire, membre) ; la page ne choisit personne', () => {
  const mu = new Mnemosyne(':memory:');
  for (const id of ['web:principal', 'web:membre-sacha']) mu.ensureSession(id, 'web', id.slice(4));
  ecrire(mu, 'web:principal', 'user', 'du propriétaire', T0 + 1); ecrire(mu, 'web:membre-sacha', 'user', 'de sacha', T0 + 2);
  assert.deepEqual(filAction('fil_masquer', { login: 'sacha' }, mu), { ok: true });
  assert.deepEqual(filDe(mu, { login: 'sacha' }, {}).elements, [], 'le fil du membre est masqué');
  assert.deepEqual(textes(filDe(mu, { proprio: true }, {}).elements), ['[]', 'du propriétaire'], 'celui du propriétaire ne bouge pas');
  assert.equal(filAction('fil_masquer', undefined, mu)!.ok, false, 'sans session de navigateur : refusé');
  assert.equal(filAction('fil_masquer', { login: 'cam.ille' }, mu)!.ok, false, 'un identifiant sans conversation : rien');
  assert.equal(filAction('autre_chose', { proprio: true }, mu), undefined);
  assert.deepEqual(filAction('fil_reafficher', { login: 'sacha' }, mu), { ok: true });
  assert.deepEqual(textes(filDe(mu, { login: 'sacha' }, {}).elements), ['[]', 'de sacha']);
});

test('les écrans techniques sont dans le fil du propriétaire, étiquetés, sans couper la conversation ; jamais chez un membre', () => {
  const mu = new Mnemosyne(':memory:');
  const ecrans = ['maison', 'voix', 'venus', 'cerveau', 'reglages'];
  for (const id of ['web:principal', 'web:membre-sacha', ...ecrans.map((e) => `web:${e}`)]) mu.ensureSession(id, 'web', id.slice(4));
  ecrire(mu, 'web:principal', 'user', 'p1', T0 + 1);
  ecrans.forEach((e, i) => ecrire(mu, `web:${e}`, 'user', `question ${e}`, T0 + 2 + i));
  ecrire(mu, 'web:principal', 'assistant', 'p2', T0 + 20);
  ecrire(mu, 'web:membre-sacha', 'user', 'de sacha', T0 + 21);
  assert.deepEqual(textes(filDe(mu, { proprio: true }, {}).elements),
    ['[]', 'p1', 'question maison (maison)', 'question voix (voix)', 'question venus (venus)', 'question cerveau (cerveau)', 'question reglages (reglages)', 'p2']);
  assert.deepEqual(textes(filDe(mu, { login: 'sacha' }, {}).elements), ['[]', 'de sacha'], 'un membre : jamais les écrans du propriétaire');
  // Ils restent des sessions à part : masquer remet à neuf la conversation, pas l'écran de la maison.
  masquerFil(mu, { proprio: true });
  assert.equal(mu.history('web:maison').length, 1);
});

test('⚠ : le séparateur d\'une conversation marquée (contenu non fiable lu) le porte', () => {
  const mu = new Mnemosyne(':memory:');
  for (const id of ['web:principal', 'web:c-ancienne']) mu.ensureSession(id, 'web', id.slice(4));
  mu.setKv('title:c-ancienne', 'Recherche');
  ecrire(mu, 'web:c-ancienne', 'user', 'a1', T0 + 1); ecrire(mu, 'web:c-ancienne', 'tool', 'page lue', T0 + 2, true);
  ecrire(mu, 'web:principal', 'user', 'p1', T0 + 3);
  assert.deepEqual(textes(filDe(mu, { proprio: true }, {}).elements), ['[⚠ Recherche]', 'a1', '[]', 'p1']);
});

test('« /new » et « masque la conversation » : les phrases reconnues ; ailleurs que dans un fil, Odin repart seulement à neuf', () => {
  for (const t of ['masque la conversation', 'Masque la conversation.', 'Odin, masque toute la conversation', 'cache la discussion', 'masque cette conversation', 'hide the conversation']) assert.ok(masquerCommand(t), t);
  for (const t of ['masque la conversation de demain avec Sacha', 'pourquoi masquer la conversation ?', 'supprime la conversation', 'masque']) assert.ok(!masquerCommand(t), t);
  const mu = new Mnemosyne(':memory:');
  mu.ensureSession('telegram:42', 'telegram', '42');
  ecrire(mu, 'telegram:42', 'user', 'bonjour', T0 + 1);
  masquerSession(mu, 'telegram:42');
  assert.equal(mu.history('telegram:42').length, 0, 'à neuf');
  assert.equal(mu.allMessages('telegram:42').length, 1, 'rien d\'effacé');
  assert.deepEqual(Object.keys(mu.kvPrefix('fil-masque:')), [], 'pas de marque pour une messagerie : elle n\'a pas d\'écran de fil');
});

test('la page : bouton Masquer, page vide avec « Réafficher l\'historique », étiquettes des écrans, ⚠, saut à un jour qui lit tout', () => {
  assert.match(UI, /id="masquerBtn"[^>]*aria-label="Masquer la conversation"/);
  assert.match(UI, /\$\('#masquerBtn'\)\.addEventListener\('click', masquerFil\)/);
  assert.match(UI, /actionFil\('fil_masquer'/); assert.match(UI, /actionFil\('fil_reafficher'/);
  assert.match(fonction('boutonPlusHaut'), /filMasque && !filSaut\) msgs\.prepend\(.*'Réafficher l\\'historique'/);
  assert.match(fonction('loadHistory'), /filMasque = Boolean\(h\.masque\)/);
  assert.match(fonction('loadHistory'), /if \(tour !== filTour\) return;/, 'deux lectures à la fois : seule la dernière dessine');
  assert.match(fonction('lireFil'), /if \(filSaut\) q\.set\('tout', '1'\)/);
  for (const l of ['depuis l\\\'écran de la maison', 'depuis la voix', 'depuis Vénus', 'depuis le Cerveau', 'depuis les Réglages']) assert.ok(UI.includes(l), l);
  assert.match(fonction('filElement'), /Object\.hasOwn\(ORIGINE_FIL, e\.origine\)/);
  assert.match(fonction('filElement'), /e\.marquee \? '⚠ ' : ''/);
  assert.match(UI, /if \(d\.topic === 'fil'\) loadHistory\(\)/, 'masqué ailleurs : la page relit le fil');
  assert.ok(!/Nouvelle conversation/.test(UI));
  // Masquée, la page vide (plus haute que l'écran) se lit d'en haut : « Réafficher l'historique » reste en vue.
  assert.match(fonction('loadHistory'), /const videMasque = filMasque && !filSaut && !h\.erreur && !h\.elements\.length;/);
  assert.match(fonction('loadHistory'), /msgs\.scrollTop = videMasque \? 0 : msgs\.scrollHeight/);
  assert.match(fonction('loadHistory'), /filAuBas = !filSaut && !videMasque/, 'en ouvrant la Discussion, pas de saut en bas de la page vide');
  // Au téléphone, « Réafficher » et « Voir plus haut » font 44 px : la règle doit l'emporter sur .btn.small (34 px).
  assert.match(UI, /@media \(max-width:860px\)\{[^\n]*\.btn\.small\.fil-haut,\.btn\.small\.fil-bas\{min-height:44px\}/);
  // Le bouton « Réafficher » disparaît : le focus revient au bouton Masquer, pas à la page.
  assert.match(UI, /const reafficherFil = async \(\) => \{ await actionFil\('fil_reafficher'[^\n]*\$\('#masquerBtn'\)\.focus\(/);
});

// ---------------------------------------------------------------- dans un vrai Odin d'essai

const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin;
const avis: string[] = [];

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => m.id === 'var') });
  const n = v.web.notify.bind(v.web); v.web.notify = (t: string) => { avis.push(t); n(t); };
  const mu = v.o.muninn;
  for (const [id, peer] of [['web:principal', 'principal'], ['web:maison', 'maison']]) mu.ensureSession(id, 'web', peer);
  ecrire(mu, 'web:principal', 'user', 'bonjour', T0 + 10); ecrire(mu, 'web:principal', 'assistant', 'bonjour à toi', T0 + 20);
  ecrire(mu, 'web:maison', 'user', 'allume la cuisine', T0 + 30);
});
after(async () => { await tt.end(); Object.assign(console, orig); });

const lus = async (q = '') => { const r = await v.json('/api/fil' + q); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body as { elements: ElementFil[]; masque: boolean }; };

test('POST /api/action fil_masquer / fil_reafficher : la session du propriétaire seulement, les pages relisent le fil', async () => {
  assert.deepEqual(textes((await lus()).elements), ['[]', 'bonjour', 'bonjour à toi', 'allume la cuisine (maison)']);
  assert.equal((await v.json('/api/action', { kind: 'fil_masquer' }, { authorization: `Bearer ${v.token}` })).status, 403, 'la clé d\'API ne masque pas');
  assert.equal((await lus()).masque, false);
  avis.length = 0;
  const r = await v.json('/api/action', { kind: 'fil_masquer' }); assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(avis.includes('fil'), 'les pages ouvertes relisent le fil');
  const m = await lus(); assert.equal(m.masque, true); assert.deepEqual(m.elements, []);
  assert.equal((await lus('?tout=1')).elements.length, 4, 'l\'Historique lit tout');
  assert.equal((await v.json('/api/action', { kind: 'fil_reafficher' })).status, 200);
  const t = await lus(); assert.equal(t.masque, false); assert.equal(t.elements.length, 4);
});

test('« masque la conversation » écrit dans la Discussion : masquée, Odin à neuf, rien d\'effacé', async () => {
  const mu = v.o.muninn, nb = mu.allMessages('web:principal').length;
  avis.length = 0;
  assert.equal((await v.json('/api/message', { text: 'masque la conversation' })).status, 202);
  for (let i = 0; i < 100 && !(await lus()).masque; i++) await new Promise((ok) => setTimeout(ok, 50));
  assert.equal((await lus()).masque, true);
  assert.deepEqual((await lus()).elements, []);
  assert.ok(avis.includes('fil'));
  assert.equal(mu.history('web:principal').length, 0);
  assert.equal(mu.allMessages('web:principal').length, nb, 'rien d\'effacé');
  assert.equal((await v.json('/api/action', { kind: 'fil_reafficher' })).status, 200);
});

test('« /new » écrit dans la Discussion, par la passerelle : la conversation est masquée, rien d\'effacé', async () => {
  const mu = v.o.muninn, nb = mu.allMessages('web:principal').length;
  assert.equal((await lus()).masque, false);
  assert.equal((await v.json('/api/message', { text: '/new' })).status, 202);
  for (let i = 0; i < 100 && !(await lus()).masque; i++) await new Promise((ok) => setTimeout(ok, 50));
  assert.equal((await lus()).masque, true);
  assert.deepEqual((await lus()).elements, []);
  assert.equal(mu.history('web:principal').length, 0);
  assert.equal(mu.allMessages('web:principal').length, nb, 'rien d\'effacé');
  assert.equal((await v.json('/api/action', { kind: 'fil_reafficher' })).status, 200);
});
