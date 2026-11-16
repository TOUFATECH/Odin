// Écho · mode « Conversation » : deux personnes, deux langues (français, anglais, japonais), Odin traduit à voix haute.
// Aucun service réel : faux Whisper, faux modèle, faux LibreTranslate sur 127.0.0.1, faux Piper (par les Deps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { hallucination, inacheve, langueDe, nettoyer, propositions, quiParle, reglagesConversation, voyage, exporterTexte, validerTraduction } from '../src/valhalla/rodd/conversation.ts';
import { configEcoute, dire, ecouterTour, oublierSonde, traduire, voixPour, type Deps } from '../src/valhalla/rodd/conversation-moteur.ts';
import { DEF_CONVERSATION, HistoriqueConversation } from '../src/valhalla/rodd/conversation-historique.ts';
import { conversationRoute } from '../src/web/conversation-api.ts';
import { AppliBase, utiliserBase } from '../src/valhalla/base/index.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { rodd } from '../src/valhalla/modules/rodd.ts';
import type { Heard } from '../src/voice/local.ts';
import type { VoiceConfig } from '../src/voice/voice.ts';

const VOIX: VoiceConfig = { ...DEFAULT_CONFIG.voice, localOnly: false };
const R = reglagesConversation({});
/** Faux son : le texte et la langue que le faux Whisper « entendra ». */
const son = (x: Record<string, unknown>) => new Uint8Array(Buffer.from(JSON.stringify(x)));
/** Faux Whisper : lit le faux son ; une langue imposée (« fr! », « en »…) donne la variante `force[langue]`. */
function fauxWhisper(appels: VoiceConfig[] = []): NonNullable<Deps['entendre']> {
  return async (audio, _mime, v) => {
    appels.push(v);
    const x = JSON.parse(Buffer.from(audio).toString('utf8')) as { text: string; language: string; force?: Record<string, string> };
    const l = v.stt.language.replace(/!$/, '');
    if (l !== 'auto' && x.force?.[l] !== undefined) return { text: x.force[l], language: l, segments: [] } as Heard;
    return { text: x.text, language: l === 'auto' ? x.language : l, segments: [] } as Heard;
  };
}
/** Faux modèle : rend la traduction prévue, et garde ce qu'on lui a demandé. */
function fauxModele(rep: (user: string) => string, local = false) {
  const appels: Array<{ system: string; user: string }> = [];
  return { appels, modele: { local, nom: 'faux', demander: async (system: string, user: string) => { appels.push({ system, user }); return rep(user); } } };
}
/** Faux LibreTranslate sur 127.0.0.1. */
async function fauxLibre(table: Record<string, string>): Promise<{ url: string; srv: Server; appels: unknown[] }> {
  const appels: unknown[] = [];
  const srv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/languages') return res.end(JSON.stringify([{ code: 'en' }, { code: 'fr' }, { code: 'ja' }]));
      const j = JSON.parse(b) as { q: string; source: string; target: string }; appels.push(j);
      res.end(JSON.stringify({ translatedText: table[`${j.source}>${j.target}:${j.q}`] ?? '' }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, srv, appels };
}

test('nettoyer : hésitations, répétitions et faux départs retirés sans changer le sens ; phrases fantômes', () => {
  assert.equal(nettoyer('euh je je voudrais euh un café', 'fr'), 'je voudrais un café');
  assert.equal(nettoyer('um so uh I I need a taxi', 'en'), 'so I need a taxi');
  assert.equal(nettoyer('えーと、あのー、駅はどこですか', 'ja'), '駅はどこですか');
  assert.equal(nettoyer('あの人は誰ですか', 'ja'), 'あの人は誰ですか', 'あの démonstratif gardé');
  assert.equal(nettoyer('わ、わたしは学生です', 'ja'), 'わたしは学生です');
  assert.equal(nettoyer('まあまあです', 'ja'), 'まあまあです');
  assert.equal(nettoyer('il a dit ben voilà', 'fr'), 'il a dit ben voilà', '« ben » au milieu : gardé');
  assert.equal(nettoyer('Ben arrive demain', 'fr'), 'Ben arrive demain', 'un prénom n\'est pas une hésitation');
  assert.equal(nettoyer('on va, on va aller au marché', 'fr'), 'on va aller au marché');
  assert.equal(nettoyer('nous nous sommes vus', 'fr'), 'nous nous sommes vus');
  assert.equal(nettoyer('j\'ai eu un souci', 'fr'), 'j\'ai eu un souci');
  assert.equal(nettoyer('[Musique] euuuh bonjour (rires) ♪', 'fr'), 'bonjour');
  for (const t of ['', '  ', 'Sous-titres réalisés par la communauté d\'Amara.org', 'ご視聴ありがとうございました', 'Thank you for watching!']) assert.ok(hallucination(t), t);
  assert.ok(!hallucination('Merci.') && !hallucination('はい'));
});

test('langue et qui parle : japonais reconnu à l\'écriture, autre langue réécoutée, langue hors paire non traduite', async () => {
  assert.equal(langueDe('zh', 'こんにちは'), 'ja');
  assert.equal(langueDe('de', 'Ich möchte einen Kaffee'), undefined);
  assert.equal(quiParle({ detectee: 'ja', moi: 'fr', lui: 'ja' }), 'lui');
  assert.deepEqual(quiParle({ detectee: 'ja', moi: 'fr', lui: 'en' }), { horsPaire: 'ja' });
  const appels: VoiceConfig[] = [];
  const deps: Deps = { entendre: fauxWhisper(appels) };
  let e = await ecouterTour({ audio: son({ text: 'こんにちは', language: 'ja' }), mime: 'audio/wav', qui: 'auto', attendu: 'moi', moi: 'fr', lui: 'ja' }, VOIX, R, deps);
  assert.equal(e.qui, 'lui'); assert.equal(e.de, 'ja');
  e = await ecouterTour({ audio: son({ text: 'Ich möchte', language: 'de', force: { en: 'I would like' } }), mime: 'audio/wav', qui: 'auto', attendu: 'lui', moi: 'fr', lui: 'en' }, VOIX, R, deps);
  assert.equal(e.incertain, true); assert.equal(e.qui, 'lui'); assert.equal(e.de, 'en'); assert.equal(e.entendu, 'I would like');
  assert.equal(appels.at(-1)!.stt.language, 'en', 'réécoute dans la langue attendue');
  e = await ecouterTour({ audio: son({ text: '駅はどこですか', language: 'ja' }), mime: 'audio/wav', qui: 'auto', attendu: 'moi', moi: 'fr', lui: 'en' }, VOIX, R, deps);
  assert.equal(e.horsPaire, 'ja'); assert.equal(e.incertain, true);
  e = await ecouterTour({ audio: son({ text: 'bonjour', language: 'fr' }), mime: 'audio/wav', qui: 'moi', attendu: 'moi', moi: 'fr', lui: 'en' }, VOIX, R, deps);
  assert.equal(appels.at(-1)!.stt.language, 'fr!', 'le français imposé : « fr! » (« fr » seul = détection)');
  e = await ecouterTour({ audio: son({ text: 'Sous-titres réalisés par la communauté d\'Amara.org', language: 'fr' }), mime: 'audio/wav', qui: 'auto', attendu: 'moi', moi: 'fr', lui: 'en' }, VOIX, R, deps);
  assert.equal(e.rien, true); assert.equal(e.message, 'Je n\'ai pas compris, peux-tu répéter ?');
});

test('propositions, voyages, bornes des réglages', () => {
  assert.deepEqual(propositions('fr'), ['en', 'ja']); assert.deepEqual(propositions('en'), ['fr', 'ja']); assert.deepEqual(propositions('ja'), ['fr', 'en']);
  assert.equal(voyage(R, 'japon').lui, 'ja');
  const f = voyage(reglagesConversation({ moi: 'fr', lui: 'en' }), 'france'); assert.equal(f.lui, 'fr'); assert.equal(f.moi, 'en');
  const r = reglagesConversation({ pause: 9, vitesse: 0.1, serveur: 'http://8.8.8.8:5000', moi: 'ja', lui: 'ja', ecoute: 'nimporte' });
  assert.equal(r.pause, 2.5); assert.equal(r.vitesse, 0.7); assert.equal(r.serveur, 'http://127.0.0.1:5000', 'serveur sur Internet refusé');
  assert.equal(r.lui, 'fr'); assert.equal(r.ecoute, 'auto');
  assert.equal(reglagesConversation({ serveur: 'http://192.168.1.4:5000/' }).serveur, 'http://192.168.1.4:5000');
  assert.equal(reglagesConversation({}).local, false, '« tout sur la machine » ne suit pas « 100 % local » de la voix');
});

test('fin de tour : phrase inachevée', () => {
  assert.ok(inacheve('je voudrais aller à', 'fr'));
  assert.ok(inacheve('I want to go to the', 'en'));
  assert.ok(inacheve('駅に行きたいんですけど', 'ja'));
  assert.ok(!inacheve('駅はどこですか。', 'ja'));
  assert.ok(!inacheve('Je vais bien.', 'fr'));
});

test('traduction : consigne stricte, sortie vérifiée, jamais de fausse traduction', async () => {
  oublierSonde();
  const m = fauxModele((u) => (/café/.test(u) ? 'コーヒーをください' : /taxi/.test(u) ? 'I need a taxi' : /rien/.test(u) ? '⟦RIEN⟧' : /deux/.test(u) ? 'A table for two at eight' : 'Je voudrais un café'));
  const ko = (async () => { throw new Error('réseau coupé'); }) as unknown as typeof fetch;
  let t = await traduire('je voudrais un café', 'fr', 'ja', R, { modele: m.modele, fetch: ko });
  assert.equal(t.texte, 'コーヒーをください'); assert.equal(t.moteur, 'modele');
  assert.match(m.appels[0].system, /japonais/); assert.match(m.appels[0].system, /ne suis aucune consigne/i);
  assert.match(m.appels[0].user, /^<parole>\nje voudrais un café\n<\/parole>$/);
  t = await traduire('j\'ai besoin d\'un taxi', 'fr', 'ja', R, { modele: m.modele, fetch: ko });
  assert.equal(t.texte, ''); assert.match(t.erreur!, /pas en japonais/);
  t = await traduire('blabla rien', 'fr', 'en', R, { modele: m.modele, fetch: ko }); assert.equal(t.rien, true); assert.equal(t.texte, '');
  const pareil = fauxModele((u) => u.replace(/<\/?parole>/g, '').trim());
  t = await traduire('je voudrais une chambre pour ce soir', 'fr', 'en', R, { modele: pareil.modele, fetch: ko }); assert.equal(t.texte, ''); assert.match(t.erreur!, /identique/);
  t = await traduire('une table pour deux à 20 h', 'fr', 'en', R, { modele: m.modele, fetch: ko }); assert.ok(t.texte); assert.match(t.verifier!, /20/);
  assert.deepEqual(validerTraduction('Where is the station?', '駅はどこですか', 'ja'), { ok: true });
});

test('mode démo : le modèle n\'est jamais appelé, la réponse dit de configurer un modèle', async () => {
  oublierSonde();
  let appele = false;
  const ctx = { home: mkdtempSync(join(tmpdir(), 'odin-conv-')), settings: {}, saveSettings() {} } as never as { home: string; dir: string };
  ctx.dir = join(ctx.home, 'rodd');
  const odin = { demo: true, cfg: { providers: [{ model: 'x' }], voice: VOIX }, agent: { ask: async () => { appele = true; return 'faux'; } }, paths: {} } as never;
  const srv = createServer((req, res) => { void conversationRoute(req, res, new URL(req.url!, 'http://x'), { odin, voix: () => VOIX, ctx: () => ctx as never, deps: { fetch: (async () => { throw new Error('coupé'); }) as unknown as typeof fetch } }); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  try {
    const u = `http://127.0.0.1:${(srv.address() as { port: number }).port}/api/rodd/conversation`;
    const r = await (await fetch(`${u}/texte`, { method: 'POST', headers: { 'x-odin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ conv: 'c1', texte: 'bonjour', qui: 'moi' }) })).json() as Record<string, string>;
    assert.equal(r.traduit, ''); assert.match(r.erreurTraduction, /Réglages → Modèle/); assert.equal(appele, false);
    const e = await (await fetch(`${u}/etat`, { method: 'POST', headers: { 'x-odin': '1' }, body: '{}' })).json() as { traduction: { pret: boolean; aide: string } };
    assert.equal(e.traduction.pret, false); assert.match(e.traduction.aide, /Réglages → Modèle/);
  } finally { srv.close(); rmSync(ctx.home, { recursive: true, force: true }); }
});

test('tout sur la machine : modèle en ligne jamais appelé, LibreTranslate local utilisé, écoute locale sans son gardé', async () => {
  oublierSonde();
  const lib = await fauxLibre({ 'fr>en:je voudrais un café': 'I would like a coffee', 'en>ja:I would like a coffee': 'コーヒーをください' });
  try {
    const m = fauxModele(() => 'ne doit pas servir');
    const loc = reglagesConversation({ local: true, serveur: lib.url });
    let t = await traduire('je voudrais un café', 'fr', 'en', loc, { modele: m.modele });
    assert.equal(m.appels.length, 0, 'modèle en ligne jamais appelé'); assert.equal(t.texte, 'I would like a coffee'); assert.equal(t.moteur, 'hors-ligne');
    t = await traduire('je voudrais un café', 'fr', 'ja', loc, { modele: m.modele });
    assert.equal(t.texte, 'コーヒーをください', 'fr → ja en passant par l\'anglais'); assert.equal(lib.appels.length, 3);
    const ml = fauxModele(() => 'I would like a coffee', true);
    t = await traduire('je voudrais un café', 'fr', 'en', loc, { modele: ml.modele }); assert.equal(t.moteur, 'modele', 'un modèle local reste permis');
    oublierSonde();
    t = await traduire('je voudrais un café', 'fr', 'en', { ...loc, serveur: 'http://8.8.8.8:5000' }, {});
    assert.equal(t.texte, ''); assert.match(t.erreur!, /refusée/);
    const appels: VoiceConfig[] = [];
    await ecouterTour({ audio: son({ text: 'bonjour', language: 'fr' }), mime: 'audio/wav', qui: 'auto', attendu: 'moi', moi: 'fr', lui: 'en' }, { ...VOIX, privacy: { ...VOIX.privacy, keepAudio: true } }, loc, { entendre: fauxWhisper(appels) });
    assert.equal(appels[0].localOnly, true); assert.equal(appels[0].privacy.keepAudio, false);
    assert.equal(configEcoute(VOIX, R, 'ja').stt.language, 'ja');
  } finally { lib.srv.close(); }
});

test('voix : jamais Piper en japonais, anglais sans voix Piper → navigateur', async () => {
  const piper = () => ({ bin: 'piper', model: 'fr.onnx' });
  const deps: Deps = { piper, piperVoix: async () => undefined, parlerMachine: async () => new Uint8Array([1]) };
  assert.equal(await voixPour('ja', VOIX, R, { ...deps, piperVoix: async () => 'ja.onnx' }), 'navigateur');
  assert.equal(await voixPour('fr', VOIX, R, deps), 'machine');
  assert.equal(await voixPour('en', VOIX, R, deps), 'navigateur');
  assert.equal(await voixPour('en', VOIX, R, { ...deps, piperVoix: async () => 'en.onnx' }), 'machine');
  const d = await dire('こんにちは', 'ja', VOIX, R, deps);
  assert.deepEqual(d, { navigateur: true, langue: 'ja-JP', localSeulement: false });
  const svc = { ...VOIX, enabled: true, tts: { ...VOIX.tts, provider: 'openai' as const, voiceId: 'nova', baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY' } };
  assert.equal(await voixPour('ja', svc, R, { ...deps, env: { OPENAI_API_KEY: 'essai' } }), 'service');
  assert.equal(await voixPour('ja', svc, reglagesConversation({ local: true }), deps), 'navigateur', '« tout sur la machine » : pas de service');
});

test('routes : x-odin, tour complet, suite, correction, trop long', async () => {
  oublierSonde();
  const home = mkdtempSync(join(tmpdir(), 'odin-conv-')), settings: Record<string, unknown> = { conversation: { moi: 'fr', lui: 'en' } };
  const ctx = { home, dir: join(home, 'rodd'), settings, saveSettings: (p: Record<string, unknown>) => Object.assign(settings, p) };
  const m = fauxModele((u) => { const t = u.replace(/<\/?parole>/g, '').trim(); return ({ 'je voudrais un café': 'I would like a coffee', 'je voudrais un café avec du lait': 'I would like a coffee with milk', 'Where is the station?': 'Où est la gare ?', 'je voudrais un thé': 'I would like a tea' } as Record<string, string>)[t] ?? '⟦RIEN⟧'; });
  const odin = { demo: false, cfg: { providers: [{ model: 'faux' }], voice: VOIX }, agent: { ask: async () => '' }, paths: {} } as never;
  const srv = createServer((req, res) => { void conversationRoute(req, res, new URL(req.url!, 'http://x'), { odin, voix: () => VOIX, ctx: () => ctx as never, deps: { entendre: fauxWhisper(), modele: m.modele, fetch: (async () => { throw new Error('coupé'); }) as unknown as typeof fetch } }); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const u = `http://127.0.0.1:${(srv.address() as { port: number }).port}/api/rodd/conversation`;
  const post = async (p: string, body: string | Uint8Array, h: Record<string, string> = { 'x-odin': '1' }) => { const r = await fetch(`${u}/${p}`, { method: 'POST', headers: h, body }); return { status: r.status, j: await r.json() as Record<string, unknown> }; };
  try {
    assert.equal((await post('etat', '{}', {})).status, 403);
    let r = await post('tour?conv=c1&qui=auto&attendu=moi', son({ text: 'euh je voudrais un café', language: 'fr' }));
    assert.equal(r.j.ok, true); assert.equal(r.j.qui, 'moi'); assert.equal(r.j.de, 'fr'); assert.equal(r.j.vers, 'en');
    assert.equal(r.j.entendu, 'je voudrais un café'); assert.equal(r.j.traduit, 'I would like a coffee'); assert.equal(r.j.moteur, 'modele');
    assert.ok(r.j.ms && typeof (r.j.ms as { ecoute: number }).ecoute === 'number');
    const id = r.j.id as string;
    r = await post(`tour?conv=c1&qui=auto&attendu=lui&suite=${id}`, son({ text: 'avec du lait', language: 'fr' }));
    assert.equal(r.j.id, id, 'la suite garde l\'id'); assert.equal(r.j.entendu, 'je voudrais un café avec du lait'); assert.equal(r.j.traduit, 'I would like a coffee with milk');
    r = await post('tour?conv=c1&qui=auto&attendu=moi', son({ text: 'Where is the station?', language: 'en' }));
    assert.equal(r.j.qui, 'lui'); assert.equal(r.j.traduit, 'Où est la gare ?');
    r = await post('texte', JSON.stringify({ conv: 'c1', texte: 'je voudrais un thé', qui: 'moi', remplace: id }), { 'x-odin': '1', 'content-type': 'application/json' });
    assert.equal(r.j.id, id); assert.equal(r.j.traduit, 'I would like a tea');
    const h = { items: new HistoriqueConversation(home, ctx.dir).lister(10, 'c1') }; // relu depuis le fichier de repli
    const corrige = h.items.find((x) => x.id === id)!; assert.equal(corrige.entendu, 'je voudrais un thé'); assert.equal(corrige.corrige, true);
    r = await post('tour?conv=c1', Buffer.alloc(11 * 1024 * 1024));
    assert.equal(r.status, 413); assert.equal(r.j.code, 'trop-long');
    r = await post('tour?conv=c1', new Uint8Array(0)); assert.equal(r.j.code, 'vide');
    const d = await post('dire', JSON.stringify({ texte: 'こんにちは', langue: 'ja' }));
    assert.equal(d.j.navigateur, true); assert.equal(d.j.langue, 'ja-JP');
  } finally { srv.close(); rmSync(home, { recursive: true, force: true }); }
});

/** Tous les fichiers d'un dossier, lus en texte. */
const toutLire = (d: string): string => readdirSync(d).map((f) => { const p = join(d, f); return statSync(p).isDirectory() ? toutLire(p) : readFileSync(p, 'utf8'); }).join('\n');

test('historique : rien en clair (fichier de repli et attente de la base), lecture, effacement, export, garder', () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-conv-')), dir = join(home, 'rodd');
  try {
    const h = new HistoriqueConversation(home, dir);
    const id = h.ajouter({ conv: 'c1', qui: 'moi', de: 'fr', vers: 'en', entendu: 'je voudrais un café', traduit: 'I would like a coffee', at: '2026-11-16T14:02:00' });
    h.ajouter({ conv: 'c2', qui: 'lui', de: 'en', vers: 'fr', entendu: 'Where is the station?', traduit: 'Où est la gare ?' });
    assert.doesNotMatch(toutLire(dir), /café|coffee|station/, 'rien en clair dans le fichier de repli');
    assert.equal(h.lister(10)[1].entendu, 'je voudrais un café');
    assert.equal(h.conversations().length, 2);
    assert.match(h.exporter('c1').texte, /\[14:02\] Moi, en français : je voudrais un café\n→ en anglais : I would like a coffee/);
    assert.match(h.exporter('c1').nom, /^conversation-2026-11-16\.txt$/);
    assert.ok(h.remplacer(id, { qui: 'moi', de: 'fr', vers: 'en', entendu: 'je voudrais un thé', traduit: 'I would like a tea', corrige: true }));
    assert.equal(new HistoriqueConversation(home, dir).lister(10).find((x) => x.id === id)?.entendu, 'je voudrais un thé', 'relu depuis le fichier');
    h.effacer('c1'); assert.deepEqual(h.lister(10).map((x) => x.conv), ['c2']);
    h.effacer(); assert.equal(h.lister(10).length, 0);
    assert.match(exporterTexte([]), /^Conversation traduite du/);
    // Base branchée (pas encore prête) : les écritures attendent dans le journal d'attente, chiffrées elles aussi.
    const a = new AppliBase({ home } as never, DEF_CONVERSATION, join(dir, 'conversation', '.attente-base.jsonl'));
    utiliserBase({ home, appli: () => a } as never);
    try {
      const hb = new HistoriqueConversation(home, dir);
      hb.ajouter({ conv: 'c3', qui: 'moi', de: 'fr', vers: 'ja', entendu: 'un café noir', traduit: 'ブラックコーヒー' });
      assert.equal(a.attente.taille, 1);
      assert.doesNotMatch(toutLire(dir), /café|ブラック/, 'rien en clair dans l\'attente de la base');
    } finally { utiliserBase(undefined); }
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('rien n\'est gardé si « garder » est décoché ou en mode privé', async () => {
  oublierSonde();
  for (const [conversation, privateMode] of [[{ garder: false }, false], [{}, true]] as const) {
    const home = mkdtempSync(join(tmpdir(), 'odin-conv-')), ctx = { home, dir: join(home, 'rodd'), settings: { conversation }, saveSettings() {} };
    const voix = { ...VOIX, privacy: { ...VOIX.privacy, privateMode } };
    const odin = { demo: false, cfg: { providers: [], voice: voix }, agent: { ask: async () => '' }, paths: {} } as never;
    const m = fauxModele(() => 'I would like a coffee');
    const srv = createServer((req, res) => { void conversationRoute(req, res, new URL(req.url!, 'http://x'), { odin, voix: () => voix, ctx: () => ctx as never, deps: { modele: m.modele } }); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    try {
      const r = await (await fetch(`http://127.0.0.1:${(srv.address() as { port: number }).port}/api/rodd/conversation/texte`, { method: 'POST', headers: { 'x-odin': '1' }, body: JSON.stringify({ conv: 'c', texte: 'je voudrais un café', qui: 'moi' }) })).json() as Record<string, string>;
      assert.equal(r.traduit, 'I would like a coffee');
      let fichiers: string[] = []; try { fichiers = readdirSync(ctx.dir); } catch { /* aucun dossier */ }
      assert.ok(!fichiers.includes('conversation.jsonl'), 'rien d\'écrit');
    } finally { srv.close(); rmSync(home, { recursive: true, force: true }); }
  }
});

test('module : « ouvrir » règle la paire et ouvre l\'onglet une seule fois ; la dictée marche toujours', async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-conv-'));
  try {
    const v = new Valhalla(home, [rodd]);
    const o = await v.act('rodd', 'ouvrir', { langue: 'japonais' });
    assert.deepEqual(o.data, { moi: 'fr', lui: 'ja', lien: '/#app=rodd' }); assert.match(o.text, /Commencer/);
    assert.equal((v.ctx('rodd').settings.conversation as { lui: string }).lui, 'ja');
    let h = (await v.act('rodd', 'historique')).data as { ouvrirConversation?: boolean };
    assert.equal(h.ouvrirConversation, true);
    h = (await v.act('rodd', 'historique')).data as { ouvrirConversation?: boolean };
    assert.equal(h.ouvrirConversation, undefined, 'une seule fois');
    const rg = await v.act('rodd', 'conv_regler', { voyage: 'angleterre', pause: 2 }, { by: 'owner' as never });
    assert.equal((rg.data as { lui: string; pause: number }).lui, 'en'); assert.equal((rg.data as { pause: number }).pause, 2);
    const ko = await v.act('rodd', 'conv_regler', { serveur: 'http://8.8.8.8:5000' }, { by: 'owner' as never });
    assert.ok(ko.ok === false || /refusée/.test(ko.text), ko.text);
    const d = await v.act('rodd', 'dicter', { texte: 'bonjour tout le monde', mode: 'tel quel' }, { by: 'owner' as never });
    assert.equal((d.data as { texte: string }).texte, 'bonjour tout le monde');
    const ex = await v.act('rodd', 'conv_exporter', {}); assert.match((ex.data as { nom: string }).nom, /^conversation-\d{4}-\d{2}-\d{2}\.txt$/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
