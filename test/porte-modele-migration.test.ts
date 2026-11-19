// La porte du modèle et la migration « aucun modèle externe », revues selon la décision du propriétaire du 19/11
// (« Classement réglable », puis « Le réviser ») : aucune clé n'est effacée, aucun agent connecté n'est coupé.
//
// - Sans aucun agent connecté : la porte est vide, `ask` lève `PasDeModele` (« pas encore », dans la langue réglée).
// - Avec un agent connecté configuré (sa clé dans le coffre) : il est construit, il répond, et chaque appel est noté au
//   journal des routages.
// - La migration, sur un coffre JETABLE : les clés des services de modèles restent (le coffre à l'octet près), la
//   connexion par abonnement reste, la liste des fournisseurs reste. Seul le rangement de la file des questions gardées
//   pour un modèle demeure, et seulement quand aucun modèle n'est prêt pour y répondre.
// Aucune adresse extérieure n'est appelée (faux `fetch`), aucun programme de modèle n'est lancé (faux `spawn`).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createOdin } from '../src/runtime.ts';
import { DEFAULT_CONFIG, odinPaths, validateConfig } from '../src/config.ts';
import { PasDeModele } from '../src/brain/porte-modele.ts';
import { ModelePasEntraine } from '../src/langue/pas-entraine.ts';
import { SECRET_NAMES, writeSecret } from '../src/settings.ts';
import { readSecretFile, secretFileExists, vaultEnable, vaultLock, vaultUnlock, writeSecretFile } from '../src/vault.ts';
import { MARQUE_FILE, direPlafondUneFois, messageFile, rangerQuestionsGardees, type MarqueFile } from '../src/migrations/aucun-modele-externe.ts';

// ---------- Aucune sortie : chaque adresse demandée est notée ; seul le faux agent connecté de l'essai répond.
const FAUX_AGENT = 'https://agent.exemple.test/v1';
const vraiFetch = globalThis.fetch;
const sorties: string[] = [];
const appelsAgent: string[] = [];
globalThis.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
  const url = typeof u === 'string' ? u : u instanceof URL ? u.href : u.url;
  if (url === `${FAUX_AGENT}/chat/completions`) {
    appelsAgent.push(String(init?.headers && (init.headers as Record<string, string>).authorization));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'réponse du faux agent' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 4 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  sorties.push(url);
  throw new Error('aucune sortie pendant cet essai');
}) as typeof fetch;
// ---------- Aucun programme de modèle lancé : chaque programme demandé est noté (il est quand même lancé).
const cp = createRequire(import.meta.url)('node:child_process') as Record<string, (...a: unknown[]) => unknown>;
const lances: string[] = [];
const vrais: Record<string, (...a: unknown[]) => unknown> = {};
for (const f of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync']) {
  vrais[f] = cp[f];
  cp[f] = (...a: unknown[]) => { lances.push(basename(String(a[0])).toLowerCase()); return vrais[f](...a); };
}
syncBuiltinESMExports();
const PROGRAMMES_DE_MODELES = /^(codex|whisper|whisper-cli|main|piper|ollama|llama|llama-server)(\.exe|\.cmd)?$/;
const dossiers: string[] = [];
after(() => {
  globalThis.fetch = vraiFetch;
  for (const [f, v] of Object.entries(vrais)) cp[f] = v;
  syncBuiltinESMExports();
  for (const d of dossiers) rmSync(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
});
const neuf = (nom: string) => { const d = mkdtempSync(join(tmpdir(), `odin-porte-${nom}-`)); dossiers.push(d); return d; };

/** Les clés des services de modèles (celles que l'ancienne version de la migration effaçait). */
const CLES_MODELES = ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'STT_API_KEY', 'CUSTOM_API_KEY', 'DEEPSEEK_API_KEY', 'MOONSHOT_API_KEY', 'JEV_API_KEY', 'ELEVENLABS_API_KEY'];
/** Les clés de l'environnement du processus qu'un essai change, remises après. */
const TOUCHEES = [...CLES_MODELES, 'TELEGRAM_BOT_TOKEN', 'BRAVE_API_KEY', 'EXA_API_KEY', 'VT_API_KEY'];
async function avecEnv<T>(f: () => Promise<T> | T): Promise<T> {
  const avant = Object.fromEntries(TOUCHEES.map((k) => [k, process.env[k]]));
  for (const k of TOUCHEES) delete process.env[k];
  try { return await f(); } finally { for (const k of TOUCHEES) { if (avant[k] === undefined) delete process.env[k]; else process.env[k] = avant[k]; } }
}
const marque = (o: { muninn: { getKv(k: string): string | undefined } }) => JSON.parse(o.muninn.getKv(MARQUE_FILE) ?? 'null') as MarqueFile | null;
const differes = (o: { muninn: { getKv(k: string): string | undefined } }) => JSON.parse(o.muninn.getKv('deferred') || '[]') as string[];

// Le coffre « d'avant » : les clés des services de modèles, mêlées à d'autres lignes (autres clés, commentaire,
// « export », guillemets, ligne vide). Tout doit rester tel quel.
const AUTRES_LIGNES = [
  '# mes clés\n',
  'TELEGRAM_BOT_TOKEN=123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi\n',
  'export BRAVE_API_KEY="brave-cle-essai-123456"\n',
  '\n',
  'EXA_API_KEY=exa-cle-essai-123456\n',
  'VT_API_KEY=vt-cle-essai-123456\n',
  'DRAUPNIR_MAISON=jeton-talos-essai\n',
];
const LIGNES_MODELES = [
  'ANTHROPIC_API_KEY=sk-ant-essai-123456789\n',
  'export OPENROUTER_API_KEY=\'sk-or-essai-123456789\'\n',
  'OPENAI_API_KEY=sk-openai-essai-123456789\n',
  'STT_API_KEY=stt-essai-123456789\n',
  'CUSTOM_API_KEY=custom-essai-123456789\n',
  'DEEPSEEK_API_KEY=ds-essai-123456789\n',
  'MOONSHOT_API_KEY=kimi-essai-123456789\n',
  'JEV_API_KEY=jev-essai-123456789\n',
  'ELEVENLABS_API_KEY=el-essai-123456789\n',
];
/** Mêlées : une ligne de modèle, une autre ligne, etc. */
function coffreAvant(): string {
  const out: string[] = [];
  for (let i = 0; i < Math.max(AUTRES_LIGNES.length, LIGNES_MODELES.length); i++) { if (LIGNES_MODELES[i]) out.push(LIGNES_MODELES[i]); if (AUTRES_LIGNES[i]) out.push(AUTRES_LIGNES[i]); }
  return out.join('');
}
const CONFIG_AVANT = {
  providers: [
    { kind: 'anthropic', model: 'claude-sonnet-5-5', apiKeyEnv: 'ANTHROPIC_API_KEY' },
    { kind: 'openai', model: 'essai', baseUrl: FAUX_AGENT, apiKeyEnv: 'CUSTOM_API_KEY' },
    { kind: 'openai-codex', model: 'gpt-6-luna' },
  ],
  cheapProvider: { kind: 'openai', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY' },
  routing: { crossCheckRisky: false },
  mimir: { judge: 'local', autonomy: 'equilibre' },
  voice: { tts: { provider: 'elevenlabs', voiceId: 'abc' }, stt: { provider: 'whisper', model: 'whisper-1', baseUrl: 'https://stt.exemple.test/v1', apiKeyEnv: 'STT_API_KEY', language: 'en' } },
  nous: { arbitreGrand: true },
  memory: { embedUrl: 'http://198.51.100.5:8080/plongements' },
  search: { provider: 'exa', searxngUrl: '' },
  journal: { enabled: true, at: '21:30', morning: '07:30' },
};

test('sans aucun agent connecté (aucune clé) : la porte est vide, ask lève PasDeModele dans la langue réglée, Odin répond quand même ; rien ne sort', async () => {
  await avecEnv(async () => {
    const home = neuf('sans-agent');
    writeFileSync(join(home, 'config.json'), JSON.stringify({ voice: { stt: { language: 'es' } } }, null, 2));
    const n0 = sorties.length;
    const o = createOdin({ home });
    try {
      assert.equal(o.modele.pret(), false, 'porte vide');
      assert.deepEqual(o.agent.deps.router.routes.map((r) => r.provider.name), ['aucun-modele'], 'seule la place vide');
      const e = await o.agent.ask('Tu résumes.', 'Résume ce texte.').then(() => undefined, (x: unknown) => x);
      assert.ok(e instanceof PasDeModele, `PasDeModele attendu, reçu : ${String(e)}`);
      assert.ok(e instanceof ModelePasEntraine, 'c\'est une « pas encore »');
      assert.match((e as Error).message, /Todavía no sé/, 'dans la langue réglée (espagnol)');
      const r = await o.agent.run('écris-moi un poème sur la mer', { sessionId: 'web:essai', channel: 'web' });
      assert.ok(r.text.length > 0);
      assert.deepEqual(sorties.slice(n0), [], 'aucune adresse appelée');
      assert.deepEqual(lances.filter((p) => PROGRAMMES_DE_MODELES.test(p)), [], 'aucun programme de modèle lancé');
    } finally { o.close(); }
  });
});

test('avec un agent connecté configuré (sa clé dans le coffre) : il est construit et répond ; l\'appel est noté au journal des routages', async () => {
  await avecEnv(async () => {
    const home = neuf('avec-agent');
    writeFileSync(join(home, 'config.json'), JSON.stringify({ providers: [{ kind: 'openai', model: 'essai', baseUrl: FAUX_AGENT, apiKeyEnv: 'CUSTOM_API_KEY' }], routing: { crossCheckRisky: false } }, null, 2));
    writeSecretFile(join(home, 'env'), 'CUSTOM_API_KEY=custom-essai-123456789\n');
    const n0 = sorties.length, a0 = appelsAgent.length;
    const o = createOdin({ home });
    try {
      assert.equal(o.modele.pret(), true, 'un agent connecté remplit la porte');
      assert.deepEqual(o.agent.deps.router.routes.map((r) => r.provider.name), ['compatible:essai']);
      assert.equal(await o.agent.ask('Tu résumes.', 'Résume ce texte.'), 'réponse du faux agent');
      assert.equal(appelsAgent.length - a0, 1, 'un appel, un seul');
      assert.equal(appelsAgent.at(-1), 'Bearer custom-essai-123456789', 'avec la clé du coffre');
      const notes = o.muninn.routes({ limit: 10 });
      assert.ok(notes.some((x) => x.provider === 'compatible:essai'), `appel noté au journal (reçu ${JSON.stringify(notes.map((x) => x.provider))})`);
      assert.deepEqual(sorties.slice(n0), [], 'aucune autre adresse appelée');
    } finally { o.close(); }
  });
});

test('migration revue : un coffre plein de clés de services de modèles les garde TOUTES (à l\'octet près) ; la connexion par abonnement et la liste des fournisseurs restent ; rejouée sans dégât', async () => {
  await avecEnv(async () => {
    const home = neuf('cles-gardees');
    const paths = odinPaths(home);
    mkdirSync(home, { recursive: true });
    writeFileSync(paths.config, JSON.stringify(CONFIG_AVANT, null, 2));
    const configAvant = readFileSync(paths.config, 'utf8');
    writeSecretFile(join(home, 'env'), coffreAvant());
    const connexion = JSON.stringify({ access_token: 'jeton-essai' });
    writeSecretFile(join(home, 'codex-auth.json'), connexion);
    const n0 = sorties.length;
    const o = createOdin({ home });
    try {
      assert.equal(readSecretFile(join(home, 'env')), coffreAvant(), 'aucune clé effacée : le coffre à l\'octet près');
      assert.equal(secretFileExists(join(home, 'codex-auth.json')), true, 'la connexion par abonnement est là');
      assert.equal(readSecretFile(join(home, 'codex-auth.json')), connexion, 'et intacte');
      for (const n of CLES_MODELES) assert.ok(process.env[n], `${n} chargée dans l'environnement d'Odin`);
      const ecrite = JSON.parse(readFileSync(paths.config, 'utf8')) as typeof CONFIG_AVANT;
      assert.deepEqual(ecrite.providers, CONFIG_AVANT.providers, 'la liste des fournisseurs reste');
      assert.deepEqual(ecrite.cheapProvider, CONFIG_AVANT.cheapProvider);
      assert.deepEqual(o.cfg.providers.map((p) => p.model), ['claude-sonnet-5-5', 'essai', 'gpt-6-luna']);
      // Les agents connectés : construits, dans l'ordre écrit ; l'agent « moins cher » aussi.
      assert.equal(o.modele.pret(), true);
      assert.deepEqual(o.agent.deps.router.routes.map((r) => r.provider.name), ['anthropic:claude-sonnet-5-5', 'compatible:essai', 'openai-codex:gpt-6-luna']);
      assert.ok(o.agent.deps.cheapRouter, 'l\'agent « moins cher » est gardé');
      assert.equal(o.muninn.getKv(MARQUE_FILE), undefined, 'un modèle est prêt : la file n\'est pas rangée');
      assert.deepEqual(differes(o).filter((x) => x.startsWith('🧹')), [], 'aucun message de retrait');
      assert.deepEqual(sorties.slice(n0), [], 'rien ne sort au démarrage');
    } finally { o.close(); }
    const o2 = createOdin({ home });
    try {
      assert.equal(readSecretFile(join(home, 'env')), coffreAvant(), 'rejouée : toujours aucune clé effacée');
      assert.equal(readSecretFile(join(home, 'codex-auth.json')), connexion);
      assert.deepEqual((JSON.parse(readFileSync(paths.config, 'utf8')) as typeof CONFIG_AVANT).providers, CONFIG_AVANT.providers);
      assert.equal(JSON.parse(readFileSync(paths.config, 'utf8')).journal.morning, JSON.parse(configAvant).journal.morning);
    } finally { o2.close(); }
  });
});

test('migration revue : coffre verrouillé → rien n\'est touché (fichier chiffré identique, connexion par abonnement là) ; déverrouillé → les clés sont toutes là', async () => {
  await avecEnv(async () => {
    const home = neuf('verrou');
    const paths = odinPaths(home);
    mkdirSync(home, { recursive: true });
    writeFileSync(paths.config, JSON.stringify({ mimir: { judge: 'local', autonomy: 'equilibre' }, routing: { crossCheckRisky: false }, voice: { stt: { language: 'de' } } }));
    writeSecretFile(join(home, 'env'), 'JEV_API_KEY=jev-essai-123456789\nTELEGRAM_BOT_TOKEN=123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi\n');
    const mdp = 'mot-de-passe-essai-long';
    vaultEnable(home, mdp);
    writeSecretFile(join(home, 'codex-auth.json'), JSON.stringify({ access_token: 'jeton-essai' }));
    vaultLock(home);
    const chiffreAvant = readFileSync(join(home, 'env.enc'));
    const o = createOdin({ home });
    try {
      assert.ok(readFileSync(join(home, 'env.enc')).equals(chiffreAvant), 'le fichier chiffré des clés n\'a pas changé d\'un octet');
      assert.equal(secretFileExists(join(home, 'codex-auth.json')), true, 'la connexion par abonnement reste');
      assert.deepEqual(differes(o).filter((x) => x.startsWith('🧹')), []);
    } finally { o.close(); }
    vaultUnlock(home, mdp);
    const o2 = createOdin({ home });
    try {
      assert.equal(readSecretFile(join(home, 'env')), 'JEV_API_KEY=jev-essai-123456789\nTELEGRAM_BOT_TOKEN=123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi\n', 'toutes les clés sont là');
      assert.equal(secretFileExists(join(home, 'codex-auth.json')), true);
    } finally { o2.close(); }
  });
});

test('ordre de sûreté : le plafond « prudent » (juge local) se pose comme avant, et les clés restent', async () => {
  await avecEnv(async () => {
    const home = neuf('ordre');
    // Ancienne installation : pas de « providers » écrit (les fournisseurs par défaut), avis croisé par défaut.
    writeFileSync(join(home, 'config.json'), JSON.stringify({ mimir: { judge: 'local', autonomy: 'autonome' } }));
    const coffre = 'ANTHROPIC_API_KEY=sk-ant-essai-123456789\nOPENROUTER_API_KEY=sk-or-essai-123456789\n';
    writeSecretFile(join(home, 'env'), coffre);
    const o = createOdin({ home });
    try {
      assert.equal(o.cfg.mimir.autonomy, 'prudent', 'plafond posé pour ce démarrage');
      assert.equal(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).mimir.autonomy, 'prudent', 'et écrit');
      const juge = JSON.parse(o.muninn.getKv('migration-juge-local') ?? '{}') as { pose?: boolean; raisons?: string[] };
      assert.equal(juge.pose, true);
      assert.ok(juge.raisons?.includes('avis croisé de plusieurs modèles'), `raison attendue : avis croisé (reçu ${JSON.stringify(juge.raisons)})`);
      assert.equal(readSecretFile(join(home, 'env')), coffre, 'les clés restent');
    } finally { o.close(); }
  });
});

test('configuration et Réglages : les fournisseurs par défaut restent, une clé de service de modèle s\'enregistre encore', async () => {
  await avecEnv(() => {
    assert.ok(DEFAULT_CONFIG.providers.length > 0);
    assert.deepEqual(validateConfig(DEFAULT_CONFIG), []);
    for (const n of CLES_MODELES) assert.ok((SECRET_NAMES as readonly string[]).includes(n), `${n} dans les clés permises`);
    const home = neuf('reglages');
    const paths = odinPaths(home);
    writeFileSync(paths.config, JSON.stringify({}));
    const env: NodeJS.ProcessEnv = {};
    writeSecret(paths, 'CUSTOM_API_KEY', 'custom-cle-essai-123456', env);
    assert.match(readSecretFile(join(home, 'env')) ?? '', /^CUSTOM_API_KEY=custom-cle-essai-123456$/m);
  });
});

test('la file des questions gardées pour un modèle : sans modèle prêt, rangée dans une note du Cerveau, vidée, dite une fois dans la langue ; avec un modèle prêt, laissée telle quelle', async () => {
  await avecEnv(async () => {
    const home = neuf('file');
    const o = createOdin({ home, configOverride: (c) => c }); // rangement pas lancé au démarrage : on le lance à la main
    try {
      const file = JSON.stringify([{ text: 'Quel temps fera-t-il demain ?', sessionId: 'web:x', channel: 'web', peer: 'owner', at: Date.UTC(2026, 10, 16, 9, 30), tries: 0 }, { text: 'Écris un poème', sessionId: 'web:x', channel: 'telegram', peer: 'owner', at: Date.UTC(2026, 10, 16, 10, 0), tries: 1 }]);
      o.muninn.setKv('offline-queue', file);
      const notes: Array<[string, string]> = [];
      const ranger = (t: string, c: string) => { notes.push([t, c]); return `notes/${t}.md`; };
      // Un modèle prêt (agent connecté) : rien n'est rangé, rien n'est marqué, la file reste pour lui.
      assert.equal(rangerQuestionsGardees({ paths: o.paths, cfg: o.cfg, kv: o.muninn, pret: true, ranger }), undefined);
      assert.equal(o.muninn.getKv('offline-queue'), file);
      assert.equal(o.muninn.getKv(MARQUE_FILE), undefined);
      // Aucun modèle prêt : rangée, vidée, dite une fois.
      const r = rangerQuestionsGardees({ paths: o.paths, cfg: o.cfg, kv: o.muninn, pret: false, ranger })!;
      assert.equal(r.file, 2);
      assert.equal(notes.length, 1);
      assert.equal(notes[0][0], 'Questions gardées pour un modèle');
      assert.match(notes[0][1], /2026-11-16 09:30 \(web\) : Quel temps fera-t-il demain \?/);
      assert.match(notes[0][1], /\(telegram\) : Écris un poème/);
      assert.equal(o.muninn.getKv('offline-queue'), '[]');
      assert.match(r.message ?? '', /J'avais gardé 2 questions.*Questions gardées pour un modèle/);
      assert.doesNotMatch(r.message ?? '', /effac|n'existe plus/, 'rien n\'est dit effacé ni disparu');
      assert.equal(differes(o).length, 1);
      // Rejoué : rien de plus.
      o.muninn.setKv('offline-queue', file);
      assert.equal(rangerQuestionsGardees({ paths: o.paths, cfg: o.cfg, kv: o.muninn, pret: false, ranger })!.file, 2, 'la marque est rendue telle quelle');
      assert.equal(notes.length, 1, 'pas de seconde note');
      assert.equal(differes(o).length, 1, 'pas de second message');
    } finally { o.close(); }
    // Une installation neuve, sans modèle : vérifiée une fois, rien à dire.
    const home2 = neuf('neuve');
    const o2 = createOdin({ home: home2 });
    try {
      const m = marque(o2)!;
      assert.ok(m, 'vérifiée une fois');
      assert.equal(m.message, undefined);
      assert.deepEqual(differes(o2), []);
    } finally { o2.close(); }
  });
});

test('le message du rangement : une bulle au démarrage de la passerelle, une seule fois ; la langue suit le réglage (sinon l\'anglais, puis le français)', () => {
  const kv = new Map<string, string>();
  const store = { getKv: (k: string) => kv.get(k), setKv: (k: string, v: string) => { kv.set(k, v); } };
  store.setKv(MARQUE_FILE, JSON.stringify({ at: '', file: 1, message: 'MESSAGE-FILE', dit: false }));
  const vues: Array<{ title: string; detail: string }> = [];
  assert.equal(direPlafondUneFois(store, (b) => { vues.push(b); return b; }), true);
  assert.equal(direPlafondUneFois(store, (b) => { vues.push(b); return b; }), false);
  assert.deepEqual(vues.map((v) => v.detail), ['MESSAGE-FILE']);
  assert.equal((JSON.parse(kv.get(MARQUE_FILE)!) as { dit: boolean }).dit, true);
  assert.match(messageFile('fr', 2, 'N'), /^🧹 J'avais gardé 2 questions/);
  assert.match(messageFile('fr', 1, 'N'), /^🧹 J'avais gardé 1 question /);
  assert.match(messageFile('es-MX', 2, 'N'), /^🧹 Había guardado 2 preguntas/);
  assert.match(messageFile('de', 2, 'N'), /^🧹 Ich hatte 2 Fragen/);
  assert.match(messageFile('ja', 2, 'N'), /^🧹 /);
  assert.match(messageFile('sw', 2, 'N'), /^🧹 I had kept 2 questions/, 'langue sans texte : anglais');
  assert.match(messageFile('auto', 2, 'N'), /^🧹 J'avais gardé/, '« auto » : la langue par défaut');
  for (const l of ['fr', 'en', 'es', 'de', 'ja']) assert.match(messageFile(l, 2, 'NOTE-X'), /NOTE-X/);
});

test('coffre verrouillé : la file des questions gardées n\'est ni rangée ni marquée (un agent connecté pourra y répondre une fois le coffre ouvert)', async () => {
  await avecEnv(async () => {
    const home = neuf('file-verrou');
    const paths = odinPaths(home);
    mkdirSync(home, { recursive: true });
    writeFileSync(paths.config, JSON.stringify({ providers: [{ kind: 'openai', model: 'essai', baseUrl: FAUX_AGENT, apiKeyEnv: 'CUSTOM_API_KEY' }] }));
    writeSecretFile(join(home, 'env'), 'CUSTOM_API_KEY=custom-essai-123456789\n');
    const mdp = 'mot-de-passe-essai-long';
    vaultEnable(home, mdp);
    vaultLock(home);
    const kv = new Map<string, string>();
    const store = { getKv: (k: string) => kv.get(k), setKv: (k: string, v: string) => { kv.set(k, v); } };
    const file = JSON.stringify([{ text: 'Quel temps fera-t-il demain ?', sessionId: 'web:x', channel: 'web', peer: 'owner', at: Date.UTC(2026, 10, 16, 9, 30), tries: 0 }]);
    store.setKv('offline-queue', file);
    const notes: string[] = [];
    const r = rangerQuestionsGardees({ paths, cfg: structuredClone(DEFAULT_CONFIG), kv: store, pret: false, ranger: (t) => { notes.push(t); return `notes/${t}.md`; } });
    assert.equal(r, undefined, 'rien de fait');
    assert.equal(store.getKv('offline-queue'), file, 'la file reste telle quelle');
    assert.equal(store.getKv(MARQUE_FILE), undefined, 'pas de marque : le prochain démarrage, coffre ouvert, revoit la file');
    assert.deepEqual(notes, []);
    vaultUnlock(home, mdp);
  });
});

test('la note des questions gardées ne garde aucun secret en clair (clé, mot de passe dit en phrase)', async () => {
  await avecEnv(async () => {
    const home = neuf('file-secret');
    const kv = new Map<string, string>();
    const store = { getKv: (k: string) => kv.get(k), setKv: (k: string, v: string) => { kv.set(k, v); } };
    store.setKv('offline-queue', JSON.stringify([
      { text: 'Range ma clé sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx123456 quelque part', at: Date.UTC(2026, 10, 16, 9, 30) },
      { text: 'Retiens que le mot de passe du wifi est Zebre-Orange-42', at: Date.UTC(2026, 10, 16, 9, 31) },
    ]));
    const notes: string[] = [];
    const r = rangerQuestionsGardees({ paths: odinPaths(home), cfg: structuredClone(DEFAULT_CONFIG), kv: store, pret: false, ranger: (t, c) => { notes.push(c); return `notes/${t}.md`; } });
    assert.equal(r?.file, 2);
    assert.equal(notes.length, 1);
    assert.doesNotMatch(notes[0], /sk-ant-api03|Zebre-Orange-42/, 'les secrets sont masqués');
    assert.match(notes[0], /\[SECRET\]/);
    assert.match(notes[0], /Retiens que le mot de passe du wifi est/, 'le reste de la question est gardé');
  });
});
