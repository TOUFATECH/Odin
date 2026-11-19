// La page Discussion n'a plus qu'une conversation (décision du propriétaire du 19/11/2026 : « On doit avoir qu'une seule
// conversation » ; les anciennes : « Les fondre en une » ; les raccourcis du téléphone : « Oui, avec une étiquette »).
// Plus de « Nouvelle conversation » ni de liste ; le fil est lu par pages (GET /api/fil, « Voir plus haut ») ; l'Historique
// cherche dans tout et va à une date ; les messages des raccourcis du téléphone sont dans le fil, marqués « depuis le
// téléphone » ; la Discussion parle toujours dans la conversation du compte, quoi que la page envoie (vieille page en cache).
// Un vrai Odin d'essai (serveur web + applis), dans un dossier temporaire, sur un port libre.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { Mnemosyne } from '../src/muninn/store.ts';
import { sessionsDuFil, type ElementFil } from '../src/muninn/fil.ts';
import { filDe } from '../src/web/fil-api.ts';
import { CLICK_CATALOG } from '../src/valhalla/clics.ts';

const UI = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');
/** Le corps d'une fonction de la page, de sa déclaration à la suivante (assez pour lire ce qu'elle appelle). */
const fonction = (nom: string) => { const i = UI.indexOf(`function ${nom}(`); assert.ok(i > 0, `fonction ${nom} trouvée`); return UI.slice(i, UI.indexOf('\n  }\n', i)); };

/** Ajoute un message à une date choisie (la mémoire date chaque message à l'instant de l'écriture). */
function ecrire(mu: Mnemosyne, session: string, role: 'user' | 'assistant', texte: string, date: number): number {
  const vrai = Date.now; Date.now = () => date;
  try { return mu.addMessage(session, { role, content: texte }); } finally { Date.now = vrai; }
}
const textes = (l: ElementFil[]) => l.map((e) => (e.type === 'separateur' ? `[${e.titre}]` : e.texte + ((e as { origine?: string }).origine ? ` (${(e as { origine?: string }).origine})` : '')));

// ---------------------------------------------------------------- la page, lue sans navigateur

test('la page : plus de « Nouvelle conversation » ni de liste de conversations ; la page ne choisit plus la conversation', () => {
  assert.ok(!/id="newConv"/.test(UI), 'plus de bouton « Nouvelle »');
  assert.ok(!/id="convs"/.test(UI), 'plus de liste de conversations');
  assert.ok(!/renderConvs/.test(UI), 'plus de dessin de la liste');
  assert.ok(!/Nouvelle conversation/.test(UI), 'ni dans la liste, ni dans la palette');
  assert.ok(!/getItem\('odin\.peer'\)/.test(UI), 'la conversation ne vient plus du navigateur');
  assert.ok(!/peer = 'c-'/.test(UI), 'la page ne fabrique plus de conversation');
  // La visite guidée ne parle plus de « Nouvelle ».
  const etape = /\{ v: 'chat', q: '#convsBtn', t: '((?:[^'\\]|\\.)*)' \}/.exec(UI);
  assert.ok(etape, 'l\'étape de l\'Historique dans la visite');
  assert.ok(!/Nouvelle|épingler|renommer/i.test(etape[1]), etape[1]);
  // Les clics sur Odin : plus d'action « nouvelle conversation ».
  assert.ok(!CLICK_CATALOG.some((a) => a.id === 'nouvelle_conversation'));
});

test('la page : le fil vient de /api/fil, par pages (« Voir plus haut »), avec les séparateurs et l\'étiquette du téléphone', () => {
  const charger = fonction('loadHistory');
  assert.match(charger, /lireFil\(/); assert.ok(!/\/api\/history/.test(charger), 'plus l\'historique actif d\'une conversation');
  assert.match(fonction('lireFil'), /'\/api\/fil\?'/);
  assert.match(fonction('voirPlusHaut'), /lireFil\(filSuite\)/, '« Voir plus haut » lit la page plus ancienne');
  assert.match(UI, /'Voir plus haut'/);
  const elt = fonction('filElement');
  assert.match(elt, /e\.type === 'separateur'/); assert.match(elt, /class: 'fil-sep'/);
  assert.match(elt, /e\.origine === 'telephone'/); assert.match(elt, /'depuis le téléphone'/);
  assert.ok(!/innerHTML/.test(elt), 'le texte reste du texte');
  // L'Historique : chercher dans tout, aller à une date.
  const histo = fonction('dessinerHisto');
  assert.match(histo, /type: 'search'/); assert.match(histo, /kind: 'conv_search'/); assert.match(histo, /type: 'date'/);
});

test('l\'Historique s\'ouvre aussi sur téléphone, se ferme (bouton, Échap), se touche au doigt et se lit', () => {
  // Sur téléphone, le volet ouvert l'emporte sur « replié » (un choix d'ordinateur) : sinon le bouton ne fait rien.
  const etroit = [...UI.matchAll(/@media \(max-width:860px\)\{([^@]*?)\}\s*(?=\n)/g)].map((m) => m[1]).join('\n');
  assert.match(etroit, /\.chat\.convs-hidden \.convs\.open\{display:flex\}/, 'le volet s\'ouvre sur téléphone');
  assert.match(etroit, /\.fil-haut,\.fil-bas,\.histo \.conv,\.histo \.csearch,\.histo \.btn\{min-height:44px\}/, 'des cibles de 44 px au doigt');
  const histo = fonction('dessinerHisto');
  assert.match(histo, /'Fermer'/, 'un bouton pour fermer le volet');
  assert.match(UI, /\$\('#histo'\)\.addEventListener\('keydown', \(e\) => \{ if \(e\.key === 'Escape'\) fermerHisto\(\); \}\)/, 'Échap ferme le volet');
  assert.match(UI, /\.histo-l\{[^}]*color:var\(--muted\)/, '« Aller au jour » assez contrasté');
  // L'export de l'Historique : « tout l'historique » choisi d'avance, la conversation principale dite telle qu'elle est.
  assert.match(histo, /openExport\('principal', 'conversation principale seule', 'tout'\)/);
  assert.match(histo, /class: 'btn small histo-ex', onclick: \(\) => openExport/, 'un vrai bouton, pas un champ en pointillés');
});

test('le fil se lit : séparateur lu en entier, titre coupé avec « … », derniers messages à l\'ouverture, panne dite', () => {
  const elt = fonction('filElement');
  assert.ok(!/role: 'separator'/.test(elt), 'un lecteur d\'écran lit le titre du séparateur');
  assert.match(elt, /\.slice\(0, 79\) \+ '…'/, 'un titre trop long finit par « … »');
  assert.match(elt, /e\.origine === 'telephone'\) \{ n\.querySelector\('\.why'\)\?\.remove\(\);/, '« Pourquoi ? » n\'explique pas une réponse du téléphone');
  assert.match(UI, /document\.addEventListener\('odin:vue', \(e\) => \{ if \(e\.detail\.vue === 'chat' && filAuBas\)/, 'en ouvrant la Discussion, les derniers messages');
  const charger = fonction('loadHistory');
  assert.match(charger, /if \(filSaut\) msgs\.querySelectorAll\('\.why'\)\.forEach/, 'après un saut, pas de « Pourquoi ? » sur un vieux message');
  assert.match(charger, /h\.erreur/, 'une panne n\'est pas un fil vide');
  assert.match(fonction('lireFil'), /erreur: true/);
  const haut = fonction('voirPlusHaut');
  assert.match(haut, /if \(h\.erreur\) \{ boutonPlusHaut\(\); return; \}/, 'après une panne, « Voir plus haut » revient');
  assert.match(haut, /activity = act;/, 'l\'activité en cours reste ouverte');
});

// ---------------------------------------------------------------- le fil, sans serveur

test('les raccourcis du téléphone sont dans le fil du propriétaire, marqués, sans couper la conversation', () => {
  const mu = new Mnemosyne(':memory:');
  for (const id of ['web:principal', 'web:raccourci', 'web:membre-camille']) mu.ensureSession(id, 'web', id.slice(4));
  const t0 = 1_800_000_000_000;
  ecrire(mu, 'web:principal', 'user', 'p1', t0 + 1);
  ecrire(mu, 'web:raccourci', 'user', 'allume le salon', t0 + 2); ecrire(mu, 'web:raccourci', 'assistant', 'c\'est allumé', t0 + 3);
  ecrire(mu, 'web:principal', 'assistant', 'p2', t0 + 4);
  ecrire(mu, 'web:membre-camille', 'user', 'texte de camille', t0 + 5);
  assert.deepEqual(textes(filDe(mu, { proprio: true }, {}).elements), ['[]', 'p1', 'allume le salon (telephone)', 'c\'est allumé (telephone)', 'p2'],
    'dans l\'ordre des dates, chaque message du téléphone marqué, aucun séparateur autour');
  assert.deepEqual(textes(filDe(mu, { login: 'camille' }, {}).elements), ['[]', 'texte de camille'], 'un membre : jamais les raccourcis du propriétaire');
  const s = (id: string) => ({ id, channel: 'web', title: '' });
  assert.ok(sessionsDuFil({ proprio: true }, [s('web:principal'), s('web:raccourci')]).includes('web:raccourci'));
  assert.ok(!sessionsDuFil({ login: 'camille' }, [s('web:membre-camille'), s('web:raccourci')]).includes('web:raccourci'));
});

// ---------------------------------------------------------------- dans un vrai Odin d'essai

const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin;
const T0 = 1_800_000_000_000;

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => m.id === 'var') });
  const mu = v.o.muninn;
  for (const [id, peer] of [['web:principal', 'principal'], ['web:c-ancienne1', 'c-ancienne1'], ['web:c-ancienne2', 'c-ancienne2'], ['web:raccourci', 'raccourci']]) mu.ensureSession(id, 'web', peer);
  mu.setKv('title:c-ancienne1', 'Box Internet'); mu.setKv('title:c-ancienne2', 'Réseau du salon');
  ecrire(mu, 'web:c-ancienne1', 'user', 'question box', T0 + 10); ecrire(mu, 'web:c-ancienne1', 'assistant', 'réponse box', T0 + 20);
  ecrire(mu, 'web:c-ancienne2', 'user', 'question salon', T0 + 30);
  ecrire(mu, 'web:raccourci', 'user', 'question du téléphone', T0 + 35); ecrire(mu, 'web:raccourci', 'assistant', 'réponse au téléphone', T0 + 36);
  ecrire(mu, 'web:principal', 'user', 'bonjour', T0 + 40); ecrire(mu, 'web:principal', 'assistant', 'bonjour à toi', T0 + 50);
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('rien n\'est perdu à l\'écran : tous les messages de toutes les anciennes conversations et du téléphone sont dans le fil', async () => {
  const mu = v.o.muninn, attendus = ['web:principal', 'web:c-ancienne1', 'web:c-ancienne2', 'web:raccourci'].flatMap((id) => mu.allMessages(id)).filter((m) => m.role === 'user' || m.role === 'assistant');
  const r = await v.json('/api/fil'); assert.equal(r.status, 200, JSON.stringify(r.body));
  const el = r.body.elements as ElementFil[];
  const lus = el.filter((e) => e.type === 'message').map((e) => (e as { texte: string }).texte);
  assert.equal(lus.length, attendus.length);
  for (const m of attendus) assert.ok(lus.includes(m.content), `visible : ${m.content}`);
  assert.deepEqual(textes(el), ['[Box Internet]', 'question box', 'réponse box', '[Réseau du salon]', 'question salon',
    'question du téléphone (telephone)', 'réponse au téléphone (telephone)', '[]', 'bonjour', 'bonjour à toi'], 'les titres des anciennes conversations en séparateurs');
});

test('la Discussion parle toujours dans la conversation du compte : le peer envoyé par une vieille page ne compte plus', async () => {
  const mu = v.o.muninn;
  for (const [peer, texte] of [['c-vieillepage', 'écrit depuis une vieille page'], ['membre-camille', 'peer d\'un membre envoyé par la page']]) {
    const r = await v.json('/api/message', { peer, text: texte });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    const fin = Date.now() + 20_000;
    while (Date.now() < fin && !mu.allMessages('web:principal').some((m) => m.content.startsWith(texte))) await new Promise((ok) => setTimeout(ok, 50));
    assert.ok(mu.allMessages('web:principal').some((m) => m.role === 'user' && m.content.startsWith(texte)), `dans la conversation du compte : ${texte}`);
    assert.equal(mu.getSession(`web:${peer}`), undefined, `aucune conversation « ${peer} » créée`);
  }
});
