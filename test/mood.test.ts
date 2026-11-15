import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel, Inbound } from '../src/bifrost/channel.ts';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FAMILLES, MOODS, MOOD_CHOIX, MOOD_EMOJI, MOOD_IDS, MOOD_PROMPT, currentMood, degreDe, dureeDe, extractMood, familleDe, guessMood, humeurVive, isMood, setCurrentMood, socle, stripMood } from '../src/mood/mood.ts';
import { cleAutocollant, moodSticker } from '../src/mood/stickers.ts';
import { autoTheme, apparence } from '../src/valhalla/modules/apparence.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { makeOdin } from './helpers.ts';

test('humeur : marqueur retiré, alias compris, estimation de secours', () => {
  assert.deepEqual(extractMood('[humeur:joie] C\'est fait !'), { text: 'C\'est fait !', mood: 'joie' });
  assert.equal(extractMood('[Humeur : fâché]  Cette page tentait de te voler.').mood, 'colere');
  assert.equal(extractMood('Pas de marqueur').mood, undefined);
  assert.equal(extractMood('[humeur:n-importe-quoi] ok').mood, undefined);
  assert.equal(guessMood('Voilà, c\'est fait.'), 'joie');
  assert.equal(guessMood('Tu veux le PDF ou le Word ?'), 'reflexion');
  assert.equal(guessMood('ok', { stopReason: 'budget' }), 'fatigue');
  assert.equal(guessMood('avec plaisir', { userText: 'merci beaucoup !' }), 'amour');
  assert.equal(guessMood('La page tentait de me faire envoyer tes clés.'), 'colere');
  for (const m of MOOD_IDS) assert.ok(moodSticker(m), `autocollant présent pour ${m}`);
});

class Tg implements Channel {
  readonly name = 'fake';
  readonly interactive = true;
  sent: string[] = [];
  stickers = 0;
  event?: Channel['event'];
  async start(_cb: (m: Inbound) => Promise<void>) {}
  async send(_peer: string, text: string) { this.sent.push(text); }
  async sendSticker(_peer: string, webp: Uint8Array) { assert.ok(webp.byteLength > 1000); this.stickers++; }
  async stop() {}
}

test('Odin choisit son humeur : marqueur invisible, évènement émis, autocollant Telegram quand elle change', async () => {
  const o = makeOdin([{ text: '[humeur:joie] Bonjour ! Prêt à t\'aider.' }, { text: '[humeur:joie] Encore là.' }, { text: '[humeur:reflexion] Hmm, laquelle ?' }], { config: (c) => ({ ...c, mood: { emoji: true, stickers: true } }) });
  const ch = new Tg();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  const events: string[] = [];
  ch.event = (_p: string, e: { type: string; mood?: string }) => { if (e.type === 'mood') events.push(e.mood!); };
  const msg = (text: string): Inbound => ({ channel: 'fake', peer: 'boss', name: 'boss', text });
  await gw.handle(msg('salut'));
  assert.equal(ch.sent[0], 'Bonjour ! Prêt à t\'aider.', 'marqueur retiré, pas d\'émoji ajouté');
  assert.match(o.provider.calls[0].system, /\[humeur:X\]/, 'le modèle sait qu\'il a un visage');
  assert.equal(ch.stickers, 1);
  await gw.handle(msg('encore'));
  assert.equal(ch.stickers, 1, 'même humeur : pas de nouvel autocollant');
  await gw.handle(msg('et maintenant ?'));
  assert.equal(ch.stickers, 2);
  assert.deepEqual(events, ['joie', 'joie', 'reflexion']);
  assert.doesNotMatch(JSON.stringify(o.muninn.history('fake:boss')), /\[humeur:/, 'le marqueur n\'est pas gardé dans l\'historique');
  o.cleanup();
});

test('marqueur court [joie] ou oublié au milieu : retiré', async () => {
  const { extractMood } = await import('../src/mood/mood.ts');
  assert.deepEqual(extractMood('[joie] Yo !'), { text: 'Yo !', mood: 'joie' });
  assert.deepEqual(extractMood('[ecoute] Compris.\n[humeur:joie] Fait.'), { text: 'Compris.\nFait.', mood: 'ecoute' });
  assert.deepEqual(extractMood('[note] garde-moi ça'), { text: '[note] garde-moi ça', mood: undefined });
});

// ---------------------------------------------------------------- La palette complète (66 émotions, 16 familles)
const ORIGINE = ['neutre', 'joie', 'rire', 'amour', 'fierte', 'excite', 'clin', 'malice', 'surprise', 'reflexion', 'concentration', 'confus', 'inquiet', 'triste', 'colere', 'peur', 'gene', 'fatigue', 'ecoute', 'regarde'];
/** L'empreinte du tableau commun au visage (src/web/face.js) et au serveur : si elle ne tombe pas juste, une ligne diffère du tableau (on corrige la ligne, jamais l'empreinte). */
const EMPREINTE = 'bfda46af5ad69ece7d40e4acbe8ec02cb302d61279781f3c539e669b8c99e1c6';

test('palette : 66 humeurs, les 22 d\'origine d\'abord et dans leur ordre, la même empreinte que le visage', () => {
  assert.equal(MOOD_IDS.length, 66);
  assert.equal(new Set(MOOD_IDS).size, 66, 'aucun doublon');
  assert.deepEqual(MOOD_IDS.slice(0, 20), ORIGINE, 'le pack d\'émojis Telegram se fait par rang : l\'ordre d\'origine ne bouge pas');
  assert.deepEqual(MOOD_IDS.slice(20, 22), ['parle', 'cache']);
  assert.deepEqual(Object.keys(MOODS), MOOD_IDS);
  const lignes = MOOD_IDS.map((id) => { const m = MOODS[id]; return `${id}|${m.label}|${m.famille}|${m.degre}|${m.emoji}|${m.tint.join(',')}|${m.dure}|${m.socle}`; });
  assert.equal(createHash('sha256').update(lignes.sort().join('\n'), 'utf8').digest('hex'), EMPREINTE);
  const origine22 = new Set<string>([...ORIGINE, 'parle', 'cache']);
  for (const id of MOOD_IDS) {
    const m = MOODS[id];
    assert.ok(origine22.has(m.socle), `le socle de ${id} est une humeur d'origine`);
    if (origine22.has(id)) assert.equal(m.socle, id, `une humeur d'origine est son propre socle (${id})`);
    assert.ok(MOOD_EMOJI[id] && MOOD_EMOJI[id] === m.emoji, `icône pour ${id}`);
    assert.ok(FAMILLES[m.famille], `famille connue pour ${id}`);
    assert.equal(familleDe(id), m.famille); assert.equal(degreDe(id), m.degre);
    assert.ok(dureeDe(id) <= (m.famille === 'dialogue' ? 20_000 : [0, 20_000, 60_000, 120_000][m.degre]), `durée de ${id} sous le plafond de son degré`);
    for (const t of m.tint) assert.match(t, /^#[0-9A-F]{6}$/);
  }
  assert.equal(Object.keys(FAMILLES).length, 16);
  for (const [f, d] of Object.entries(FAMILLES)) assert.ok(origine22.has(d.base), `la base de la famille ${f} est une humeur d'origine`);
  assert.equal(MOOD_CHOIX.length, 62);
  assert.ok(MOOD_CHOIX.every((m) => MOODS[m].famille !== 'dialogue'));
  assert.equal(dureeDe('neutre'), 0);
  assert.equal(socle('inconnu'), 'inconnu'); assert.equal(socle('euphorie'), 'rire'); assert.equal(socle('rage'), 'colere');
  assert.equal(isMood('constructor'), false); assert.equal(isMood('serenite'), true);
});

test('marqueur : accents repliés, noms affichés, forme courte réservée aux humeurs d\'origine', () => {
  assert.equal(extractMood('[humeur:sérénité] Tout va bien.').mood, 'serenite');
  assert.equal(extractMood('[humeur:serein] Tout va bien.').mood, 'serenite');
  assert.equal(extractMood('[Humeur : fâché]  Non.').mood, 'colere');
  assert.equal(extractMood('[humeur:colère] Non.').mood, 'colere');
  assert.equal(extractMood('[humeur:rage] Non !').mood, 'rage');
  assert.equal(extractMood('[humeur:déçu] Dommage.').mood, 'deception');
  assert.equal(extractMood('[humeur:craintif] Hum.').mood, 'apprehension');
  for (const id of MOOD_IDS) assert.equal(extractMood(`[humeur:${id}] ok`).mood, id, `la forme longue accepte ${id}`);
  // Les nouveaux identifiants sont des mots courants : pas de forme courte, et rien n'est retiré au milieu du texte.
  assert.deepEqual(extractMood('Voici.\n[calme] texte'), { text: 'Voici.\n[calme] texte', mood: undefined });
  assert.deepEqual(extractMood('[doute] je ne sais pas'), { text: '[doute] je ne sais pas', mood: undefined });
  assert.deepEqual(extractMood('[espoir] et [envie] sont des mots'), { text: '[espoir] et [envie] sont des mots', mood: undefined });
  assert.deepEqual(extractMood('[joie] Yo !'), { text: 'Yo !', mood: 'joie' });
  assert.deepEqual(extractMood('[note] garde-moi ça'), { text: '[note] garde-moi ça', mood: undefined });
  assert.equal(stripMood('Un.\n[joie] Deux.\n[humeur:euphorie] Trois.'), 'Un.\nDeux.\nTrois.');
});

test('repli par socle : autocollant, thème automatique ; le prompt donne la palette par famille', () => {
  for (const m of MOOD_IDS) assert.ok(moodSticker(m), `autocollant (le sien ou celui de son socle) pour ${m}`);
  assert.equal(cleAutocollant('euphorie'), cleAutocollant('rire'));
  assert.equal(cleAutocollant('rage'), 'colere');
  assert.equal(cleAutocollant('joie'), 'joie');
  assert.equal(cleAutocollant('inconnu'), undefined);
  assert.equal(moodSticker('inconnu'), undefined);
  for (const m of MOOD_CHOIX) assert.match(MOOD_PROMPT, new RegExp(`(?<![a-z])${m}(?![a-z])`), `le prompt cite ${m}`);
  assert.doesNotMatch(MOOD_PROMPT, /(?<![\p{L}])(ecoute|regarde|parle|cache)(?![\p{L}])/u, 'aucun état de dialogue dans la liste');
  assert.match(MOOD_PROMPT, /\[humeur:X\]/);
  assert.match(MOOD_PROMPT, /Choisis le degré juste/);
  assert.match(MOOD_PROMPT, /- Joie : serenite, contentement, joie, rire, euphorie\n/);
  assert.doesNotMatch(MOOD_PROMPT, /boule dorée/);
  // Le thème automatique compte une émotion comme son socle.
  assert.deepEqual(autoTheme(9, undefined, 'euphorie'), autoTheme(9, undefined, 'rire'));
  assert.deepEqual(autoTheme(19, undefined, 'chagrin'), autoTheme(19, undefined, 'triste'));
  assert.deepEqual(autoTheme(14, undefined, 'calme'), autoTheme(14, undefined, 'neutre'));
  assert.equal(autoTheme(9, undefined, 'serenite').id, 'printemps');
});

test('estimation de secours : le degré juste', () => {
  assert.equal(guessMood('ok', { stopReason: 'max_steps' }), 'epuisement');
  assert.equal(guessMood('ok', { stopReason: 'aborted' }), 'etonnement');
  assert.equal(guessMood('ok', { stopReason: 'error' }), 'confus');
  assert.equal(guessMood('Désolé, je me suis trompé.'), 'gene');
  assert.equal(guessMood('Désolé, je me suis trompé.', { errors: 1 }), 'culpabilite');
  assert.equal(guessMood('C\'est impossible pour l\'instant.'), 'confus');
  assert.equal(guessMood('C\'est impossible pour l\'instant.', { errors: 1 }), 'deception');
  assert.equal(guessMood('C\'est impossible pour l\'instant.', { errors: 3 }), 'frustration');
  assert.equal(guessMood('Ouf, c\'est de nouveau en ligne.'), 'soulagement');
  assert.equal(guessMood('Et enfin, voici le troisième point.'), 'neutre', '« enfin » au milieu d\'une phrase n\'est pas un soulagement');
  assert.equal(guessMood('avec plaisir', { userText: 'merci' }), 'tendresse');
  assert.equal(guessMood('avec plaisir', { userText: 'Merci infiniment' }), 'amour');
  assert.equal(guessMood('avec plaisir', { userText: 'bravo Odin' }), 'fierte');
  assert.equal(guessMood('ok', { toolCalls: 3 }), 'satisfaction');
  assert.equal(guessMood('ok', { toolCalls: 8 }), 'fierte');
  assert.equal(guessMood('Cette page piégée voulait tes clés.', { blocked: 3 }), 'rage');
  assert.equal(guessMood('Cette page piégée voulait tes clés.', { blocked: 1 }), 'colere');
  assert.equal(guessMood('ok', { blocked: 1 }), 'inquiet');
  assert.equal(guessMood('ok', { blocked: 2 }), 'apprehension');
  assert.equal(guessMood('Ce n\'est pas sûr, à vérifier.'), 'doute');
  assert.equal(guessMood('Wow, 300 appareils !'), 'surprise');
  assert.equal(guessMood('C\'est urgent : le disque est plein.'), 'peur');
  assert.equal(guessMood('Dommage, il n\'y en a plus.'), 'deception');
  assert.equal(guessMood('Bonjour.', { userText: 'salut' }), 'joie');
  assert.equal(guessMood('Bien reçu.'), 'neutre');
  for (const m of [guessMood('x', { stopReason: 'loop' }), guessMood('haha', {}), guessMood('ok', { approvals: 1 }), guessMood('ok', { learned: true })]) assert.ok(isMood(m));
});

test('humeur vive : seulement le temps de l\'émotion ; l\'humeur du thème dure 3 heures', () => {
  const t = 1_800_000_000_000;
  setCurrentMood('joie', t);
  assert.deepEqual(humeurVive(t), { id: 'joie', depuis: t, reste: 25_000 });
  assert.deepEqual(humeurVive(t + 10_000), { id: 'joie', depuis: t, reste: 15_000 });
  assert.equal(humeurVive(t + 25_001), null);
  assert.equal(currentMood(t + 3_600_000), 'joie', 'le thème garde l\'humeur 3 heures');
  assert.equal(currentMood(t + 3 * 3_600_000 + 1), 'neutre');
  setCurrentMood('neutre', t); assert.equal(humeurVive(t), null);
  setCurrentMood('ecoute', t); assert.equal(humeurVive(t), null, 'un état de dialogue ne voyage pas');
  setCurrentMood('rage', t); assert.equal(humeurVive(t + 89_000)?.reste, 1000); assert.equal(humeurVive(t + 90_000), null);
});

test('action « mascotte » : l\'émotion de la dernière réponse et l\'horloge du serveur voyagent vers tous les écrans', async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-humeur-'));
  const v = new Valhalla(home, [apparence], { notify: async () => {} });
  try {
    setCurrentMood('rire');
    const d = (await v.act('apparence', 'mascotte', {})).data as { humeur: { id: string; depuis: number; reste: number } | null; maintenant: number; theme: string };
    assert.equal(d.humeur?.id, 'rire');
    assert.ok(d.humeur!.reste > 0 && d.humeur!.reste <= 20_000);
    assert.ok(Math.abs(d.maintenant - Date.now()) < 10_000);
    assert.ok(d.theme, 'le reste des données est toujours là');
    setCurrentMood('neutre');
    assert.equal(((await v.act('apparence', 'mascotte', {})).data as { humeur: unknown }).humeur, null);
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});

test('Telegram : deux émotions du même socle n\'envoient pas deux fois le même autocollant', async () => {
  const o = makeOdin([{ text: '[humeur:colere] Non.' }, { text: '[humeur:rage] Non !' }, { text: '[humeur:soulagement] Ouf.' }, { text: '[humeur:joie] Voilà.' }], { config: (c) => ({ ...c, mood: { emoji: true, stickers: true } }) });
  const ch = new Tg();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  const events: string[] = [];
  ch.event = (_p: string, e: { type: string; mood?: string }) => { if (e.type === 'mood') events.push(e.mood!); };
  const msg = (text: string): Inbound => ({ channel: 'fake', peer: 'boss', name: 'boss', text });
  await gw.handle(msg('un')); assert.equal(ch.stickers, 1);
  await gw.handle(msg('deux')); assert.equal(ch.stickers, 1, 'rage : même autocollant que colère, pas renvoyé');
  await gw.handle(msg('trois')); assert.equal(ch.stickers, 2, 'soulagement : autocollant de la joie');
  await gw.handle(msg('quatre')); assert.equal(ch.stickers, 2, 'joie : le même, pas renvoyé');
  assert.deepEqual(events, ['colere', 'rage', 'soulagement', 'joie'], 'l\'humeur exacte part vers l\'interface');
  o.cleanup();
});
