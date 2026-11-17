// Écho · mode « Conversation » : les défauts trouvés à la relecture, chacun avec son essai.
// Aucun service réel : faux Whisper, faux modèle (par les Deps), serveur de la page sur 127.0.0.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { consigneTraduction, heureLocale, langueDe, nettoyer, reglagesConversation, validerTraduction } from '../src/valhalla/rodd/conversation.ts';
import { douteux, ecouterTour, voixPour, type Deps } from '../src/valhalla/rodd/conversation-moteur.ts';
import { historiqueDe } from '../src/valhalla/rodd/conversation-historique.ts';
import { conversationRoute } from '../src/web/conversation-api.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { rodd } from '../src/valhalla/modules/rodd.ts';
import type { Heard } from '../src/voice/local.ts';
import type { VoiceConfig } from '../src/voice/voice.ts';

const VOIX: VoiceConfig = { ...DEFAULT_CONFIG.voice, localOnly: false };
const R = reglagesConversation({});
const son = (x: Record<string, unknown>) => new Uint8Array(Buffer.from(JSON.stringify(x)));
/** Faux Whisper : lit le faux son ; une langue imposée donne la variante `force[langue]` ; `confiance` est rendue telle quelle. */
function fauxWhisper(appels: VoiceConfig[] = []): NonNullable<Deps['entendre']> {
  return async (audio, _mime, v) => {
    appels.push(v);
    const x = JSON.parse(Buffer.from(audio).toString('utf8')) as { text: string; language: string; confiance?: number; force?: Record<string, string> };
    const l = v.stt.language.replace(/!$/, '');
    if (l !== 'auto' && x.force?.[l] !== undefined) return { text: x.force[l], language: l, segments: [] } as Heard;
    return { text: x.text, language: l === 'auto' ? x.language : l, segments: [], ...(l === 'auto' && x.confiance !== undefined ? { confiance: x.confiance } : {}) } as Heard;
  };
}

test('nettoyer : les nombres répétés et « so so » restent ; les vrais faux départs partent toujours', () => {
  assert.equal(nettoyer('Mon numéro est le 06 12 12 34 56', 'fr'), 'Mon numéro est le 06 12 12 34 56');
  assert.equal(nettoyer('Call me at 555 12 12', 'en'), 'Call me at 555 12 12');
  assert.equal(nettoyer('Le code est 1 2 3 1 2 3', 'fr'), 'Le code est 1 2 3 1 2 3');
  assert.equal(nettoyer('Chambre 22 22 étage', 'fr'), 'Chambre 22 22 étage');
  assert.equal(nettoyer('It was so so', 'en'), 'It was so so');
  assert.equal(nettoyer('bye bye', 'en'), 'bye bye');
  assert.equal(nettoyer('euh je je voudrais euh un café', 'fr'), 'je voudrais un café');
  assert.equal(nettoyer('on va, on va aller au marché', 'fr'), 'on va aller au marché');
});

test('validerTraduction : réponses courtes identiques et noms japonais gardés acceptés ; vraie non-traduction refusée', () => {
  assert.equal(validerTraduction('OK', 'OK', 'fr').ok, true);
  assert.equal(validerTraduction('Instagram', 'Instagram', 'fr').ok, true);
  assert.equal(validerTraduction('Paris ?', 'Paris ?', 'en').ok, true);
  assert.equal(validerTraduction('OK', 'OK', 'ja').ok, true, 'vers le japonais : un sigle peut rester');
  assert.equal(validerTraduction('田中さんに会いました', 'J\'ai rencontré 田中', 'fr').ok, true);
  assert.equal(validerTraduction('je voudrais une chambre pour ce soir', 'je voudrais une chambre pour ce soir', 'en').ok, false);
  assert.equal(validerTraduction('bonjour', 'bonjour', 'ja').ok, false, 'un mot courant non traduit vers le japonais');
  assert.match(validerTraduction('Where is the station?', '駅はどこですか', 'fr').raison!, /japonais/);
  assert.match(consigneTraduction('ja', 'fr', 'lui'), /rōmaji/);
  assert.doesNotMatch(consigneTraduction('fr', 'ja', 'moi'), /rōmaji/);
  assert.doesNotMatch(consigneTraduction('fr', 'ja', 'moi'), /\n\n/, 'pas de ligne vide dans la consigne');
});

test('langue reconnue : un mot japonais dans une phrase française reste du français ; la confiance de Whisper compte', async () => {
  assert.equal(langueDe('fr', 'J\'adore le 寿司'), 'fr');
  assert.equal(langueDe('en', '駅はどこですか'), 'ja', 'écriture japonaise en majorité');
  assert.equal(langueDe('ja', 'Tanaka 寿司'), 'ja', 'Whisper dit japonais');
  assert.equal(langueDe('zh', '你好'), 'ja', 'chinois : Whisper le confond souvent avec le japonais (seules trois langues)');
  assert.equal(douteux({ text: 'OK', confiance: 0.95 }), true, 'phrase très courte');
  assert.equal(douteux({ text: 'I would like a coffee please', confiance: 0.43 }), true, 'confiance basse');
  assert.equal(douteux({ text: 'I would like a coffee please', confiance: 0.92 }), false);
  assert.equal(douteux({ text: '駅はどこですか' }), false);
  const appels: VoiceConfig[] = [];
  // Paire fr/ja : un « OK » français reconnu en anglais est réécouté en français (incertain), pas « hors paire ».
  let e = await ecouterTour({ audio: son({ text: 'OK', language: 'en', confiance: 0.43, force: { fr: 'OK' } }), mime: 'audio/wav', qui: 'auto', attendu: 'moi', moi: 'fr', lui: 'ja' }, VOIX, R, { entendre: fauxWhisper(appels) });
  assert.equal(e.horsPaire, undefined); assert.equal(e.incertain, true); assert.equal(e.qui, 'moi'); assert.equal(e.de, 'fr');
  assert.equal(appels.at(-1)!.stt.language, 'fr!', 'réécoute en français imposé');
  // Une vraie phrase anglaise, bien reconnue : hors paire, la page propose de changer.
  e = await ecouterTour({ audio: son({ text: 'Where is the train station please', language: 'en', confiance: 0.97 }), mime: 'audio/wav', qui: 'auto', attendu: 'lui', moi: 'fr', lui: 'ja' }, VOIX, R, { entendre: fauxWhisper() });
  assert.equal(e.horsPaire, 'en');
  // Une phrase française avec un mot japonais : c'est bien moi.
  e = await ecouterTour({ audio: son({ text: 'J\'adore manger des sushis, du 寿司 vraiment', language: 'fr', confiance: 0.9 }), mime: 'audio/wav', qui: 'auto', attendu: 'lui', moi: 'fr', lui: 'ja' }, VOIX, R, { entendre: fauxWhisper() });
  assert.equal(e.qui, 'moi'); assert.equal(e.de, 'fr');
});

test('voix du service : plus jamais (ElevenLabs, OpenAI, serveur de la maison) ; le navigateur dit chaque langue', async () => {
  const deps: Deps = { env: { ELEVENLABS_API_KEY: 'essai', OPENAI_API_KEY: 'essai' } };
  const eleven = (model: string) => ({ ...VOIX, enabled: true, tts: { ...VOIX.tts, provider: 'elevenlabs' as const, voiceId: 'abc', model, baseUrl: 'https://api.elevenlabs.io', apiKeyEnv: 'ELEVENLABS_API_KEY' } });
  const maison = { ...VOIX, enabled: true, tts: { ...VOIX.tts, provider: 'openai' as const, voiceId: 'ff_siwis', baseUrl: 'http://127.0.0.1:8880/v1', apiKeyEnv: '' } };
  for (const v of [eleven('eleven_multilingual_v2'), eleven('eleven_turbo_v2'), maison]) for (const l of ['fr', 'en', 'ja'] as const) assert.equal(await voixPour(l, v, R, deps), 'navigateur', `${v.tts.provider} ${l}`);
});

/** Un Odin de page avec faux Whisper et faux modèle. */
async function page(voix: VoiceConfig, rep: (t: string) => string) {
  const home = mkdtempSync(join(tmpdir(), 'odin-conv-')), settings: Record<string, unknown> = { conversation: { moi: 'fr', lui: 'en' } };
  const ctx = { home, dir: join(home, 'rodd'), settings, saveSettings: (p: Record<string, unknown>) => Object.assign(settings, p) };
  const modele = { local: false, nom: 'faux', demander: async (_s: string, u: string) => rep(u.replace(/<\/?parole>/g, '').trim()) };
  const odin = { demo: false, cfg: { providers: [{ model: 'faux' }], voice: voix }, agent: { ask: async () => '' }, paths: {} } as never;
  const srv = createServer((req, res) => { void conversationRoute(req, res, new URL(req.url!, 'http://x'), { odin, voix: () => voix, ctx: () => ctx as never, deps: { entendre: fauxWhisper(), modele } }); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const u = `http://127.0.0.1:${(srv.address() as { port: number }).port}/api/rodd/conversation`;
  const post = async (p: string, body: string | Uint8Array) => (await (await fetch(`${u}/${p}`, { method: 'POST', headers: { 'x-odin': '1' }, body })).json()) as Record<string, unknown>;
  return { post, fin: () => { srv.close(); rmSync(home, { recursive: true, force: true }); } };
}

test('route : un dernier morceau vide (« suite ») garde la traduction du tour', async () => {
  const p = await page(VOIX, (t) => (t === 'je voudrais réserver une chambre pour deux nuits' ? 'I would like to book a room for two nights' : '⟦RIEN⟧'));
  try {
    const a = await p.post('tour?conv=c1&qui=auto&attendu=moi', son({ text: 'je voudrais réserver une chambre pour deux nuits', language: 'fr' }));
    assert.equal(a.traduit, 'I would like to book a room for two nights');
    const b = await p.post(`tour?conv=c1&qui=auto&attendu=lui&suite=${a.id as string}`, son({ text: 'Sous-titres réalisés par la communauté d\'Amara.org', language: 'fr' }));
    assert.equal(b.ok, true); assert.equal(b.id, a.id);
    assert.equal(b.traduit, 'I would like to book a room for two nights', 'la traduction est gardée');
    assert.equal(b.entendu, 'je voudrais réserver une chambre pour deux nuits');
    assert.equal(b.rien, undefined); assert.equal(b.message, undefined); assert.equal(b.inchange, true);
  } finally { p.fin(); }
});

test('route /etat : l\'écoute du navigateur est refusée avec « 100 % local » de la voix', async () => {
  for (const [localOnly, attendu] of [[true, false], [false, true]] as const) {
    const p = await page({ ...VOIX, localOnly }, () => '');
    try { assert.equal((await p.post('etat', '{}')).navigateurEcoute, attendu, `localOnly=${localOnly}`); } finally { p.fin(); }
  }
});

test('module : l\'historique dit l\'heure locale, la même que l\'export', async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-conv-'));
  try {
    const v = new Valhalla(home, [rodd]);
    const at = '2026-11-16T02:31:00.000Z';
    historiqueDe(v.ctx('rodd')).ajouter({ conv: 'c1', qui: 'moi', de: 'fr', vers: 'en', entendu: 'bonjour', traduit: 'hello', at });
    const h = await v.act('rodd', 'conv_historique', {});
    const locale = `${String(new Date(at).getHours()).padStart(2, '0')}:${String(new Date(at).getMinutes()).padStart(2, '0')}`;
    assert.equal(heureLocale(at), locale);
    assert.match(h.text, new RegExp(`^${locale} · moi · bonjour`));
    const ex = await v.act('rodd', 'conv_exporter', { conv: 'c1' });
    assert.match((ex.data as { texte: string }).texte, new RegExp(`\\[${locale}\\]`));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ---------------- La page ----------------
const lire = (f: string) => readFileSync(new URL(`../src/web/pages/${f}`, import.meta.url), 'utf8');
const SOURCE = lire('rodd-conversation.js');
type Logique = {
  peutDireAutre: (t: unknown) => boolean; garderSuite: (p: unknown, r: unknown) => unknown;
  heureLocale: (iso: string) => string; enfants: (...k: unknown[]) => unknown[]; hauteurScene: (haut: number, bas: number) => string;
};
const logique = (): Logique => { const win: { OdinEchoConversation?: { logique: Logique } } = {}; vm.runInNewContext(SOURCE, { window: win }); return win.OdinEchoConversation!.logique; };

test('page : « C\'était l\'autre personne ? » jamais pour une langue hors paire', () => {
  const { peutDireAutre } = logique();
  assert.equal(peutDireAutre({ ok: true, qui: 'lui', incertain: true, horsPaire: 'ja' }), false);
  assert.equal(peutDireAutre({ ok: true, qui: 'lui', incertain: true }), true);
  assert.equal(peutDireAutre({ ok: true, qui: 'lui' }), false);
  // « Oui, changer » retraduit la phrase entendue avec la nouvelle paire (sans renvoyer le son).
  const f = SOURCE.slice(SOURCE.indexOf('async function changerPaire('), SOURCE.indexOf('function envoyerTexte('));
  assert.match(f, /P\.dernierSon = null/); assert.match(f, /envoyerTexte\(ancien\.entendu, 'lui'\)/);
  assert.match(SOURCE, /Non, c'était bien du/);
});

test('page : un dernier morceau vide garde le tour d\'avant', () => {
  const { garderSuite } = logique();
  const prec = { ok: true, id: 'a', traduit: 'Hello' };
  assert.equal(garderSuite(prec, { ok: true, id: 'a', rien: true, traduit: '' }), prec);
  assert.equal(garderSuite(prec, { ok: true, id: 'a', inchange: true, traduit: 'Hello' }), prec);
  const neuf = { ok: true, id: 'a', traduit: 'Hello there' };
  assert.equal(garderSuite(prec, neuf), neuf);
  const seul = { ok: true, id: 'b', rien: true };
  assert.equal(garderSuite(undefined, seul), seul, 'sans tour d\'avant, « pas compris » est montré');
});

test('page : heure locale, pas de « null » dans le tiroir, scène sous la barre du bas', () => {
  const L = logique();
  const at = '2026-11-16T02:31:00.000Z', d = new Date(at);
  assert.equal(L.heureLocale(at), `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
  assert.equal(L.heureLocale('pas une date'), '--:--');
  assert.deepEqual([...L.enfants(null, 'a', false, [undefined, 'b'])], ['a', 'b']);
  assert.match(SOURCE, /corps\.replaceChildren\(\.\.\.enfants\(/);
  assert.doesNotMatch(SOURCE, /slice\(11, 16\)/, 'jamais l\'heure UTC lue dans la chaîne');
  assert.equal(L.hauteurScene(54, 65.4), 'max(320px, calc(100dvh - 54px - 65px - 12px))');
  assert.match(SOURCE, /querySelector\('\.bnav'\)/);
});

test('page : les erreurs restent affichées, le micro ne s\'ouvre pas sans écoute, le navigateur respecte « 100 % local »', () => {
  const S = SOURCE;
  const env = S.slice(S.indexOf('function envoyer(son'), S.indexOf('async function finirTour('));
  assert.ok(env.indexOf('erreurEcoute(') > env.indexOf('finirTour(tour); else etatsRepos()'), 'l\'erreur s\'écrit après le retour au repos');
  const txt = S.slice(S.indexOf('function envoyerTexte('), S.indexOf('function ecouterNavigateur('));
  assert.match(txt, /etatsRepos\(\); rendre\(\); statut\(r\?\.error/);
  assert.match(S, /if \(tour\.erreurTraduction\) statut\(`Traduction impossible/);
  assert.match(S, /v\.erreurEcoute \? chip\(t\.ecouteKo/);
  const dm = S.slice(S.indexOf('async function demarrerMicro('), S.indexOf('function prendre('));
  assert.ok(dm.indexOf('ecoute?.pret') > 0 && dm.indexOf('ecoute?.pret') < dm.indexOf('getUserMedia'), 'pas de micro sans écoute');
  assert.match(S, /if \(P\.micro && !P\.etat\.ecoute\?\.pret\) \{ arreterMicro/);
  assert.match(S, /!P\.etat\?\.navigateurEcoute\) return;/);
});

test('rodd.js : pas de pastille « 100 % local » dans l\'onglet Conversation', () => {
  assert.match(lire('rodd.js'), /S\.tab === 'conversation' \? null : chip\('● 100 % local · Whisper'/);
});
