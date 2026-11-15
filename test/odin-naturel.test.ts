// Odin naturel : un homme ou une femme, qui parle comme une personne.
//  1. UN réglage (voice.gender) : il se lit, se change (Réglages, « odin genre », en parlant, outil), et se garde.
//  2. Le texte suit : la petite fonction d'accord, le filet « je suis prêt » → « prête », les phrases toutes faites.
//  3. Le modèle reçoit qui il est (un homme, une femme) et la consigne de langue courante ; les tournures d'automate
//     sont rattrapées par le code.
//  4. Le texte préparé pour la voix : aucun symbole, nombres et heures dits comme on les dit, listes dites.
//  5. La voix du navigateur : une voix FRANÇAISE du bon genre, parmi des listes d'appareils réalistes.
//  6. L'installation sans question garde la valeur par défaut (et la question se pose au premier démarrage).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { Gateway, voiceGenderCommand } from '../src/bifrost/gateway.ts';
import { ensureWebToken, WebChannel } from '../src/web/server.ts';
import { DEFAULT_CONFIG, DEFAULT_PERSONA, initHome, loadConfig, odinPaths } from '../src/config.ts';
import { tryDirect, type DirectDeps } from '../src/core/direct.ts';
import { accord, accorder, brancherGenre, commandeGenre, consigneGenre, genreCourant, genreOdin, GENRE_PAR_DEFAUT, lireGenre } from '../src/core/genre.ts';
import { buildSystemPrompt } from '../src/core/prompt.ts';
import { charterIssues, CHARTER, parlerNaturel, polishReply } from '../src/core/style.ts';
import { keep, learn, type Acquis } from '../src/learn/acquis.ts';
import { voiceFor } from '../src/profiles.ts';
import { applySettings, settingsView } from '../src/settings.ts';
import { describeSettings } from '../src/tools/reglages.ts';
import { direListe, direNombre, heureDite, nombreEnLettres, ordinal, pourLaVoix } from '../src/voice/dire.ts';
import { etiquettesVoix, forSpeech, listVoices, voixFrancaise } from '../src/voice/voice.ts';
import { makeOdin } from './helpers.ts';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const lire = (f: string) => readFileSync(join(RACINE, f), 'utf8');
/** Une installation neuve, dans un dossier jetable. */
function maison() {
  const home = mkdtempSync(join(tmpdir(), 'odin-naturel-'));
  const paths = odinPaths(home); initHome(paths);
  return { home, paths, cfg: loadConfig(paths), fin: () => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) };
}
/** Ce qui est écrit dans config.json pour le réglage « homme ou femme ». */
const surDisque = (config: string) => { const v = (JSON.parse(readFileSync(config, 'utf8')) as { voice?: { gender?: string; genderChosen?: boolean } }).voice ?? {}; return { gender: v.gender, genderChosen: v.genderChosen }; };

// ------------------------------------------------------------------ 1. Le réglage

test('homme ou femme : un seul réglage, qui se lit, se change et se garde', () => {
  assert.equal(GENRE_PAR_DEFAUT, 'homme'); assert.equal(genreOdin(DEFAULT_CONFIG), 'homme'); assert.equal(genreOdin(undefined), 'homme');
  for (const [dit, g] of [['femme', 'femme'], ['F', 'femme'], ['2', 'femme'], ['Féminin', 'femme'], ['une voix de femme', 'femme'], ['homme', 'homme'], ['H', 'homme'], ['1', 'homme'], ['masculin', 'homme'], ['voix d\'homme', 'homme']] as const) assert.equal(lireGenre(dit), g, dit);
  for (const dit of ['', 'chat', 'les deux', undefined, 3]) assert.equal(lireGenre(dit), undefined, String(dit));

  const m = maison();
  try {
    // Installation neuve : un homme, et personne n'a encore choisi (l'interface posera la question une fois).
    assert.equal(genreOdin(m.cfg), 'homme'); assert.ok(!m.cfg.voice.genderChosen);
    assert.deepEqual([settingsView(m.cfg, false, {}).voice.gender, settingsView(m.cfg, false, {}).voice.genderChosen], ['homme', false]);
    // Le choix (installation, premier démarrage, en parlant) : écrit sur le disque, pris en compte tout de suite, sans redémarrer.
    assert.equal(applySettings(m.paths, m.cfg, 'genre', { genre: 'femme' }), false, 'rien à redémarrer');
    assert.equal(m.cfg.voice.gender, 'femme'); assert.equal(m.cfg.voice.genderChosen, true);
    assert.deepEqual(surDisque(m.paths.config), { gender: 'femme', genderChosen: true });
    assert.equal(genreOdin(loadConfig(m.paths)), 'femme', 'relu après un redémarrage');
    assert.equal(settingsView(m.cfg, false, {}).voice.genderChosen, true);
    // La voix suit le même réglage : la voix de femme du service, sans rien régler d'autre.
    assert.equal(voiceFor({ ...m.cfg.voice, tts: { ...m.cfg.voice.tts, provider: 'elevenlabs', voiceId: '' } }, m.cfg).tts.voiceId, 'XB0fDUnXU5powFXDhCwa');
    assert.equal(voiceFor(m.cfg.voice, m.cfg).tts.voiceId, 'fr_FR-siwis-medium', 'Piper : la voix de femme');
    // Un choix qui ne veut rien dire est refusé, et rien ne change.
    assert.throws(() => applySettings(m.paths, m.cfg, 'genre', { genre: 'robot' }), /homme ou femme/);
    assert.equal(m.cfg.voice.gender, 'femme');
    // Réglages → Voix : le même réglage (boutons « Un homme » / « Une femme »).
    applySettings(m.paths, m.cfg, 'voice', { gender: 'homme', enabled: true });
    assert.equal(m.cfg.voice.gender, 'homme'); assert.equal(surDisque(m.paths.config).gender, 'homme'); assert.equal(m.cfg.voice.genderChosen, true);
  } finally { m.fin(); }
});

test('homme ou femme : il se change en parlant, sans IA, et une vraie demande n\'est pas prise pour ça', async () => {
  for (const [p, g] of [['prends une voix de femme', 'femme'], ['parle comme un homme', 'homme'], ['Odin, parle avec une voix de femme.', 'femme'], ['reprends ta voix d\'homme', 'homme'], ['sois une femme', 'femme'],
    ['voix féminine s\'il te plaît', 'femme'], ['je veux une voix masculine', 'homme'], ['parle au féminin', 'femme'], ['tu peux prendre une voix de femme ?', 'femme'], ['passe à une voix d’homme maintenant', 'homme']] as const) {
    assert.equal(commandeGenre(p), g, p); assert.equal(voiceGenderCommand(p), g, `messageries : ${p}`);
  }
  for (const p of ['Ma femme veut une idée de sortie ce week-end', 'mets une voix de femme sur la vidéo', 'parle-moi de la voix de femme de Piper', 'quelle voix de femme as-tu ?', 'un homme a sonné', 'je veux un homme', 'parle comme un homme politique', 'parle-moi']) {
    assert.equal(commandeGenre(p), undefined, p); assert.equal(voiceGenderCommand(p), undefined, p);
  }
  // Dans la discussion : aucune IA n'est appelée, le réglage change, Odin répond au féminin, et le choix est noté comme fait.
  const o = makeOdin([]);
  try {
    assert.ok(!o.cfg.voice.genderChosen);
    const r = await o.agent.run('prends une voix de femme', { sessionId: 'web:principal', channel: 'web', peer: 'principal' });
    assert.equal(r.ai?.needed, false, r.ai?.why); assert.equal(o.provider.calls.length, 0, 'aucune IA');
    assert.match(r.text, /voix de femme/); assert.match(r.text, /au féminin/);
    assert.equal(o.cfg.voice.gender, 'femme'); assert.deepEqual(surDisque(o.paths.config), { gender: 'femme', genderChosen: true });
    assert.equal(genreCourant(), 'femme', 'les phrases toutes faites lisent le réglage en cours');
    const h = await o.agent.run('Parle comme un homme', { sessionId: 'web:principal', channel: 'web', peer: 'principal' });
    assert.match(h.text, /voix d'homme/); assert.equal(o.cfg.voice.gender, 'homme'); assert.equal(genreCourant(), 'homme');
  } finally { o.cleanup(); brancherGenre(undefined); }
});

// ------------------------------------------------------------------ 2. Les accords

test('accords : la petite fonction, et le filet qui rattrape « je suis prêt » dans un texte déjà écrit', () => {
  assert.equal(accord('prêt', 'prête', 'homme'), 'prêt'); assert.equal(accord('prêt', 'prête', 'femme'), 'prête');
  try {
    brancherGenre(() => 'femme'); assert.equal(accord('tout seul', 'toute seule'), 'toute seule');
    brancherGenre(() => 'homme'); assert.equal(accord('tout seul', 'toute seule'), 'tout seul');
    brancherGenre(() => 'n\'importe quoi'); assert.equal(accord('sûr', 'sûre'), 'sûr', 'réglage illisible : la valeur par défaut');
  } finally { brancherGenre(undefined); }
  assert.equal(accord('ravi', 'ravie'), 'ravi', 'rien de branché : un homme');

  const F: Array<[string, string]> = [
    ['Je suis prêt.', 'Je suis prête.'], ['je ne suis pas sûr que tu parles d\'une de mes applis', 'je ne suis pas sûre que tu parles d\'une de mes applis'],
    ['Je me suis arrêté là : 2 actions sur 3 faites.', 'Je me suis arrêtée là : 2 actions sur 3 faites.'], ['je suis resté en v1.34.', 'je suis restée en v1.34.'],
    ['je suis revenu à l\'instantané « avant »', 'je suis revenue à l\'instantané « avant »'], ['Je suis déjà administrateur de cette machine', 'Je suis déjà administratrice de cette machine'],
    ['Désolé, je n\'ai pas trouvé.', 'Désolée, je n\'ai pas trouvé.'], ['Je n\'ai rien trouvé, désolé.', 'Je n\'ai rien trouvé, désolée.'], ['Ravi de te revoir !', 'Ravie de te revoir !'], ['Content que ça marche.', 'Contente que ça marche.'],
    ['Je suis tout seul ici.', 'Je suis toute seule ici.'], ['Je suis bien arrivé et prêt à travailler.', 'Je suis bien arrivée et prête à travailler.'], ['Je me sens prêt.', 'Je me sens prête.'],
    ['J\'ai été mis à jour cette nuit.', 'J\'ai été mise à jour cette nuit.'], ['Je vais être absent 2 minutes.', 'Je vais être absente 2 minutes.'], ['Je suis sûr et certain.', 'Je suis sûre et certaine.'],
    ['Je suis allé voir : tout va bien, je suis content.', 'Je suis allée voir : tout va bien, je suis contente.'],
  ];
  for (const [m, f] of F) { assert.equal(accorder(m, 'femme'), f); assert.equal(accorder(m, 'homme'), m, 'un homme : rien ne change'); assert.equal(accorder(f, 'femme'), f, 'déjà accordé : rien ne change'); }
  // Ce qui ne s'accorde pas, ce qui n'est pas Odin qui parle de lui, et ce qui est cité : intact.
  for (const t of ['Je me suis permis de ranger.', 'Je me suis rendu compte que le disque est plein.', 'Réponds-moi « je suis réveillé » sur ton téléphone.', 'Je suis à côté de la plaque.', 'Je suis Odin, ton assistant.',
    'Je suis en train de chercher.', 'Il est désolé, lui.', 'Tu es prêt ?', 'Je suis là.', 'Le service a redémarré tout seul.', 'Tape `je suis prêt` dans le terminal.']) assert.equal(accorder(t, 'femme'), t);
});

test('accords : les phrases toutes faites d\'Odin suivent le réglage (réponse sans IA, aides des réglages, discussion)', async () => {
  const store = new Map<string, string>();
  const kv = { getKv: (k: string) => store.get(k), setKv: (k: string, v: string) => { store.set(k, v); } };
  // Une mission apprise en deux actions ; la deuxième échoue : Odin dit où il s'est arrêté.
  const valhalla = (quoi: string, entree: Record<string, unknown>) => ({ action: 'action', appli: 'garmr', quoi, entree: JSON.stringify(entree) });
  const a = learn({ phrase: 'Bannis 203.0.113.9 et montre les bannis', label: '', now: Date.UTC(2026, 10, 10, 9),
    steps: [{ tool: 'valhalla', input: valhalla('bannir', { ip: '203.0.113.9' }), label: 'Cerbère · Bannir une adresse' }, { tool: 'valhalla', input: valhalla('bannis', {}), label: 'Cerbère · Bannis en ce moment' }] });
  assert.ok(!('skip' in a), 'skip' in a ? a.skip : '');
  keep(kv, a as Acquis);
  let n = 0;
  const d: DirectDeps = { sessionId: 's', has: () => true, kv, now: new Date(2026, 10, 12, 8, 30), run: async () => (++n % 2 === 1 ? { ok: true, content: 'banni' } : { ok: false, content: 'Erreur : pare-feu injoignable' }) };
  try {
    brancherGenre(() => 'femme');
    const r = await tryDirect('bannis 203.0.113.9 et montre les bannis', d);
    assert.ok(r.done); assert.match(r.done ? r.text : '', /Je me suis arrêtée là : 1 action sur 2 faite\./);
    const aide = describeSettings(DEFAULT_CONFIG);
    assert.match(aide, /Jusqu'où j'agis seule/); assert.match(aide, /je l'installe toute seule/); assert.match(aide, /Ce que je sais faire seule/); assert.doesNotMatch(aide, /\bseul\b(?! le)/);
    brancherGenre(() => 'homme'); n = 0;
    const h = await tryDirect('bannis 203.0.113.9 et montre les bannis', d);
    assert.match(h.done ? h.text : '', /Je me suis arrêté là/); assert.match(describeSettings(DEFAULT_CONFIG), /Jusqu'où j'agis seul :/);
  } finally { brancherGenre(undefined); }

  // Dans la discussion : même si le modèle oublie qu'Odin est une femme, sa réponse est accordée avant de partir.
  const o = makeOdin([{ text: 'Je suis prêt, et désolé pour l\'attente. « Je suis prêt », c\'est ce que tu voulais lire ?' }], { config: (c) => ({ ...c, voice: { ...c.voice, gender: 'femme' } }) });
  try {
    const r = await o.agent.run('Raconte-moi où tu en es, en détail, et pourquoi tu as mis du temps', { sessionId: 'web:principal', channel: 'web', peer: 'principal' });
    assert.equal(r.text, 'Je suis prête, et désolée pour l\'attente. « Je suis prêt », c\'est ce que tu voulais lire ?', 'la citation reste telle quelle');
  } finally { o.cleanup(); brancherGenre(undefined); }
});

// ------------------------------------------------------------------ 3. Ce que reçoit le modèle, et la langue courante

test('modèle : il sait s\'il est un homme ou une femme, et il doit parler comme une personne', async () => {
  const base = { persona: '# Odin\nTu es Odin.', name: 'Odin', now: new Date(), channel: 'web', workspace: '/w', summary: '', pinned: [], recalled: [], skillsIndex: '', tainted: false };
  const f = buildSystemPrompt({ ...base, genre: 'femme' }), h = buildSystemPrompt({ ...base, genre: 'homme' });
  assert.match(f, /## Qui tu es quand tu parles : une femme/); assert.match(f, /tu parles de toi au féminin/); assert.match(f, /« je suis prête »/); assert.match(f, /toute seule/);
  assert.match(h, /## Qui tu es quand tu parles : un homme/); assert.match(h, /tu parles de toi au masculin/); assert.match(h, /« je suis prêt »/); assert.doesNotMatch(h, /je suis prête/);
  assert.ok(f.indexOf('# Odin') < f.indexOf('## Qui tu es quand tu parles') && f.indexOf('## Qui tu es quand tu parles') < f.indexOf('## Charte de réponse') && f.indexOf('## Charte de réponse') < f.indexOf('## Contexte'), 'personnalité, puis qui parle, puis la charte');
  assert.equal(consigneGenre('femme').includes('prête'), true);
  // La langue courante : dans la charte (toujours envoyée) et dans la personnalité d'une installation neuve.
  for (const sys of [f, h]) {
    assert.match(sys, /Parle comme une personne, jamais comme une machine/); assert.match(sys, /langue courante/); assert.match(sys, /tutoiement/);
    assert.match(sys, /« je pense que… », « à mon avis… »/); assert.match(sys, /« tu veux que je… \? », « on pourrait… »/);
    assert.match(sys, /jamais « Requête traitée », « Action effectuée avec succès »/); assert.match(sys, /« Erreur : … », « Veuillez… »/); assert.match(sys, /De la chaleur sans bavardage/);
    // Les règles d'avant sont toujours là.
    assert.match(sys, /Court par défaut : 1 à 3 phrases/); assert.match(sys, /Des chiffres plutôt que des adjectifs/); assert.match(sys, /Jamais de « Bien sûr ! »/);
    // Faire tout de suite ce qui est demandé, mais proposer ce qui ne l'est pas.
    assert.match(sys, /Une idée qu'il n'a pas demandée, elle, se propose simplement/);
  }
  assert.ok(CHARTER.split('\n').length >= 13, 'la charte garde ses règles et gagne les trois nouvelles');
  assert.match(DEFAULT_PERSONA, /Parle comme une personne, pas comme une machine/); assert.match(DEFAULT_PERSONA, /« tu veux que je… \? »/);
  // Un sous-agent rend un compte rendu : ni charte ni « qui tu es ».
  assert.doesNotMatch(buildSystemPrompt({ ...base, genre: 'femme', isSubAgent: true }), /Qui tu es quand tu parles/);

  // Pour de vrai : le prompt envoyé au modèle par l'agent porte le genre réglé.
  const o = makeOdin([{ text: 'Voilà.' }], { config: (c) => ({ ...c, voice: { ...c.voice, gender: 'femme' } }) });
  try {
    await o.agent.run('Explique-moi pourquoi le ciel est bleu, avec tes mots', { sessionId: 'web:principal', channel: 'web', peer: 'principal' });
    const sys = o.provider.calls.at(-1)!.system;
    assert.match(sys, /Qui tu es quand tu parles : une femme/); assert.match(sys, /Parle comme une personne, jamais comme une machine/);
  } finally { o.cleanup(); brancherGenre(undefined); }
});

test('langue courante : les tournures d\'automate sont redites comme on parle', () => {
  assert.equal(parlerNaturel('Action effectuée avec succès. Le NAS est en ligne.'), 'C\'est fait. Le NAS est en ligne.');
  assert.equal(parlerNaturel('L\'opération a été réalisée avec succès.'), 'C\'est fait.');
  assert.equal(parlerNaturel('Requête traitée. Opération terminée. Voici le résultat.'), 'C\'est fait. Voici le résultat.');
  assert.equal(parlerNaturel('Erreur : le disque est plein.'), 'Ça n\'a pas marché : le disque est plein.');
  assert.equal(parlerNaturel('Une erreur est survenue pendant la copie.'), 'Ça n\'a pas marché pendant la copie.');
  assert.equal(parlerNaturel('Veuillez patienter…'), 'Un instant…');
  assert.equal(parlerNaturel('Veuillez vérifier le câble, puis veuillez réessayer.'), 'Vérifie le câble, puis réessaye.');
  assert.equal(parlerNaturel('Veuillez vous connecter. Veuillez saisir le code.'), 'Connecte-toi. Saisis le code.');
  assert.equal(parlerNaturel('Votre demande a bien été prise en compte.'), 'C\'est noté.');
  // Ce qui est du code ou une citation n'est pas touché ; une phrase normale non plus.
  for (const t of ['```\nErreur : ENOENT\n```', 'Le journal dit `Erreur : accès refusé`.', 'Il a écrit « Veuillez patienter ».', 'C\'est fait, j\'ai allumé la lampe.', 'Je pense que le disque est plein. Tu veux que je fasse le ménage ?']) assert.equal(parlerNaturel(t), t);
  // La charte appliquée à une réponse finale les rattrape, et le contrôle qualité les signale.
  assert.equal(polishReply('Bien sûr ! Action effectuée avec succès. Le disque est à **92 %**.'), 'C\'est fait. Le disque est à **92 %**.');
  assert.deepEqual(charterIssues('Opération effectuée avec succès. Veuillez patienter.'), ['tournure d\'automate']);
  assert.deepEqual(charterIssues('C\'est fait, le disque est à 92 %.'), []);
});

// ------------------------------------------------------------------ 4. Le texte préparé pour la voix

test('voix : les nombres, les heures et les rangs en toutes lettres', () => {
  const N: Array<[number, string]> = [[0, 'zéro'], [1, 'un'], [16, 'seize'], [21, 'vingt et un'], [70, 'soixante-dix'], [71, 'soixante et onze'], [80, 'quatre-vingts'], [81, 'quatre-vingt-un'], [91, 'quatre-vingt-onze'],
    [99, 'quatre-vingt-dix-neuf'], [100, 'cent'], [101, 'cent un'], [200, 'deux cents'], [280, 'deux cent quatre-vingts'], [1000, 'mille'], [1500, 'mille cinq cents'], [2026, 'deux mille vingt-six'],
    [80000, 'quatre-vingt mille'], [200000, 'deux cent mille'], [1000000, 'un million'], [2500000, 'deux millions cinq cent mille']];
  for (const [n, mots] of N) assert.equal(nombreEnLettres(n), mots, String(n));
  assert.equal(nombreEnLettres(21, true), 'vingt et une'); assert.equal(nombreEnLettres(1, true), 'une'); assert.equal(nombreEnLettres(-3), 'moins trois');
  for (const [e, mots] of [['3,5', 'trois virgule cinq'], ['0.05', 'zéro virgule zéro cinq'], ['1 234', 'mille deux cent trente-quatre'], ['007', 'zéro zéro sept'], ['06', 'zéro six'], ['-3', 'moins trois']] as const) assert.equal(direNombre(e), mots, e);
  assert.deepEqual([1, 2, 5, 9, 21, 80].map((n) => ordinal(n)), ['premier', 'deuxième', 'cinquième', 'neuvième', 'vingt et unième', 'quatre-vingtième']);
  assert.deepEqual([heureDite(14, 30), heureDite(9, 5), heureDite(0, 15), heureDite(12), heureDite(1), heureDite(21)], ['quatorze heures trente', 'neuf heures cinq', 'minuit quinze', 'midi', 'une heure', 'vingt et une heures']);
});

test('voix : le texte préparé ne contient plus de symboles et dit bien nombres, heures, unités, listes et tableaux', () => {
  const D: Array<[string, string]> = [
    ['Il est 14:30, samedi 15 novembre 2026.', 'Il est quatorze heures trente, samedi quinze novembre deux mille vingt-six.'],
    ['Le disque est à **92 %** (12 Go libres sur 500 Go). Il fait 24 °C, vent 18 km/h.', 'Le disque est à quatre-vingt-douze pour cent, douze gigaoctets libres sur cinq cents gigaoctets. Il fait vingt-quatre degrés, vent dix-huit kilomètres-heure.'],
    ['Rappel le 15/11 à 9h : payer 12,50 € (n°42). Voir [la facture](https://exemple.fr/f/1).', 'Rappel le quinze novembre à neuf heures : payer douze euros cinquante, numéro quarante-deux. Voir la facture.'],
    ['### Sécurité\nTout va bien.\n\n- Le NAS est en ligne depuis 3 j\n- Le routeur a redémarré à 9h05\n- Aucune alerte', 'Sécurité. Tout va bien. D\'abord, le NAS est en ligne depuis trois jours. Ensuite, le routeur a redémarré à neuf heures cinq. Enfin, aucune alerte.'],
    ['Pièces :\n- Salon\n- Cuisine\n- Chambre', 'Pièces : Salon, Cuisine et Chambre.'],
    ['| Appareil | État | Depuis |\n|---|---|---|\n| NAS | en ligne | 3 j |\n| Box | hors ligne | 2 h |', 'NAS, État : en ligne, Depuis : trois jours. Box, État : hors ligne, Depuis : deux heures.'],
    ['Une IA a répondu en 350 ms ; le VPN va bien. Version v1.35.0, adresse 192.168.1.20.', 'Une i a a répondu en trois cent cinquante millisecondes ; le VPN va bien. Version un point trente-cinq point zéro, adresse cent quatre-vingt-douze point cent soixante-huit point un point vingt.'],
    ['Ton réglage (autonomie) : prudent → autonome. Va dans Réglages → Voix.', 'Ton réglage, autonomie : prudent, puis autonome. Va dans Réglages, puis Voix.'],
    ['✅ DNS d\'Odin : en marche · 3/5 étapes · 18–27 °C · 1er essai, 2e essai', 'DNS d\'Odin : en marche, trois sur cinq étapes, dix-huit à vingt-sept degrés, premier essai, deuxième essai'],
    ['Appelle le 06 39 12 34 56 avant 18h. Il y a 12 000 fichiers.', 'Appelle le zéro six, trente-neuf, douze, trente-quatre, cinquante-six avant dix-huit heures. Il y a douze mille fichiers.'],
    ['Sources :\n- https://a.fr/x\n- https://b.fr/y', 'Sources : les liens affichés.'],
    ['Le fichier est dans ~/.odin/workspace/rapport.pdf.', 'Le fichier est dans rapport point pdf.'],
    ['Temps de réponse : 1,2 s. Il reste 1 min 30. Odin veille 24h/24.', 'Temps de réponse : un virgule deux seconde. Il reste une minute trente. Odin veille vingt-quatre heures sur vingt-quatre.'],
    // Ce qui était déjà vrai le reste.
    ['Court. **Gras** et `code`.', 'Court. Gras et code.'], ['Bonjour', 'Bonjour'], ['Bonjour, je suis Odin. Voici ma voix, fabriquée sur la machine.', 'Bonjour, je suis Odin. Voici ma voix, fabriquée sur la machine.'],
  ];
  for (const [ecrit, dit] of D) assert.equal(forSpeech(ecrit), dit, ecrit);
  // Aucun symbole, aucun lien, aucun chiffre ne reste à lire, quel que soit le mélange.
  const riche = D.map(([e]) => e).join('\n\n') + '\n\n> Citation **en gras**, _italique_, ~~barré~~ et `code` ; un tableau :\n\na | b\n---|---\n1 | 2\n\n```js\nconst x = 1;\n```\n#42 · 100 % · 5 € · 3 × 2 = 6';
  const dit = pourLaVoix(riche, 'fr');
  assert.doesNotMatch(dit, /[*_#|`~<>[\]{}\\^=→•·%°€$✅✓]|https?:|www\./); assert.doesNotMatch(dit, /\d/, 'plus un chiffre');
  assert.match(dit, /code affiché à l'écran/);
  // Les listes : courtes (« A, B et C »), sinon « d'abord…, ensuite…, enfin… ».
  assert.equal(direListe(['Ouvre les réglages de la voix', 'Choisis une femme', 'Enregistre le tout']), 'D\'abord, Ouvre les réglages de la voix. Ensuite, Choisis une femme. Enfin, Enregistre le tout.');
  assert.equal(direListe(['Le NAS va bien', 'La box aussi, depuis hier']), 'D\'abord, le NAS va bien. Ensuite, la box aussi, depuis hier.');
  // Tes prononciations passent avant l'épellation des sigles.
  assert.equal(forSpeech('Une IA répond.', 'fr', { IA: 'intelligence artificielle' }), 'Une intelligence artificielle répond.');
  // Une autre langue : le ménage est fait, mais rien n'est dit « à la française ».
  assert.equal(pourLaVoix('The disk is at **92 %** (12 GB free). See https://x.io', 'en'), 'The disk is at 92 %, 12 GB free. See the link on screen');
  assert.equal(forSpeech('The disk is full and the backup is late, what can you do about it?'), 'The disk is full and the backup is late, what can you do about it?');
});

// ------------------------------------------------------------------ 5. La voix du navigateur

interface Voix { name: string; lang: string; voiceURI: string; localService: boolean; default: boolean }
interface Naturel {
  genre: string; accord(m: string, f: string): string;
  choisirVoix(v: Voix[], g: string): { voix: Voix | null; genre: string; hauteur: number; raison: string };
  regler(u: Record<string, unknown>, v: Voix[], g: string, r?: { rate?: number; volume?: number }): boolean;
  sansSymboles(t: string): string;
}
function naturel(): Naturel {
  const ctx: { window: { OdinNaturel?: Naturel } } = { window: {} };
  vm.runInNewContext(lire('src/web/naturel.js'), ctx);
  return ctx.window.OdinNaturel!;
}
const v = (name: string, lang: string, o: { uri?: string; local?: boolean; def?: boolean } = {}): Voix => ({ name, lang, voiceURI: o.uri ?? name, localService: o.local ?? true, default: Boolean(o.def) });
/** Des listes telles que les navigateurs les donnent (speechSynthesis.getVoices()). */
const APPAREILS: Record<string, Voix[]> = {
  edge: [v('Microsoft David - English (United States)', 'en-US', { def: true }), v('Microsoft Zira - English (United States)', 'en-US'), v('Microsoft Hortense - French (France)', 'fr-FR'), v('Microsoft Julie - French (France)', 'fr-FR'), v('Microsoft Paul - French (France)', 'fr-FR'),
    v('Microsoft Denise Online (Natural) - French (France)', 'fr-FR', { local: false }), v('Microsoft Henri Online (Natural) - French (France)', 'fr-FR', { local: false }), v('Microsoft Eloise Online (Natural) - French (France)', 'fr-FR', { local: false }),
    v('Microsoft Sylvie Online (Natural) - French (Canada)', 'fr-CA', { local: false }), v('Microsoft Antoine Online (Natural) - French (Canada)', 'fr-CA', { local: false }), v('Microsoft Andrew Multilingual Online (Natural) - English (United States)', 'en-US', { local: false }),
    v('Microsoft Ava Online (Natural) - English (United States)', 'en-US', { local: false })],
  chromeWindows: [v('Microsoft David - English (United States)', 'en-US', { def: true }), v('Microsoft Hortense - French (France)', 'fr-FR'), v('Microsoft Julie - French (France)', 'fr-FR'), v('Microsoft Paul - French (France)', 'fr-FR'), v('Google français', 'fr-FR', { local: false }), v('Google US English', 'en-US', { local: false }), v('Google UK English Male', 'en-GB', { local: false })],
  mac: [v('Samantha', 'en-US', { def: true }), v('Daniel', 'en-GB'), v('Thomas', 'fr-FR'), v('Amélie', 'fr-CA'), v('Audrey (Enhanced)', 'fr-FR'), v('Jacques', 'fr-FR'), v('Eddy (Français (France))', 'fr-FR'), v('Flo (Français (France))', 'fr-FR'), v('Grandma (Français (France))', 'fr-FR')],
  android: [v('anglais États-Unis', 'en_US', { uri: 'en-us-x-sfg-local', def: true }), v('français France', 'fr_FR', { uri: 'fr-fr-x-fra-local' }), v('français France', 'fr_FR', { uri: 'fr-fr-x-frb-local' }), v('français France', 'fr_FR', { uri: 'fr-fr-x-frc-local' }), v('français France', 'fr_FR', { uri: 'fr-fr-x-frd-local' })],
  chromeSeul: [v('Google US English', 'en-US', { def: true }), v('Google UK English Male', 'en-GB'), v('Google français', 'fr-FR', { local: false })],
  anglais: [v('Microsoft David - English (United States)', 'en-US', { def: true }), v('Google US English', 'en-US'), v('Google UK English Male', 'en-GB')],
};

test('voix du navigateur : une voix française du bon genre, la plus naturelle, jamais une voix anglaise', () => {
  const N = naturel();
  const choix = (liste: string, g: string) => { const c = N.choisirVoix(APPAREILS[liste], g); return [c.voix ? (c.voix.voiceURI !== c.voix.name ? c.voix.voiceURI : c.voix.name) : null, c.genre, c.hauteur]; };
  assert.deepEqual(choix('edge', 'homme'), ['Microsoft Henri Online (Natural) - French (France)', 'homme', 1]);
  assert.deepEqual(choix('edge', 'femme'), ['Microsoft Denise Online (Natural) - French (France)', 'femme', 1], 'Denise plutôt qu\'Eloise (voix d\'enfant) ou Sylvie (Canada)');
  assert.deepEqual(choix('chromeWindows', 'homme'), ['Microsoft Paul - French (France)', 'homme', 1]);
  assert.deepEqual(choix('chromeWindows', 'femme'), ['Microsoft Hortense - French (France)', 'femme', 1]);
  assert.deepEqual(choix('mac', 'homme'), ['Thomas', 'homme', 1], 'ni Jacques ni Eddy (voix de synthèse à l\'ancienne), ni Daniel l\'Anglais');
  assert.deepEqual(choix('mac', 'femme'), ['Audrey (Enhanced)', 'femme', 1]);
  assert.deepEqual(choix('android', 'homme'), ['fr-fr-x-frb-local', 'homme', 1]);
  assert.deepEqual(choix('android', 'femme'), ['fr-fr-x-fra-local', 'femme', 1]);
  // L'appareil n'a qu'une voix française, de femme : elle sert pour un homme aussi, à peine plus grave. Jamais « UK English Male ».
  assert.deepEqual(choix('chromeSeul', 'homme'), ['Google français', 'femme', 0.9]);
  assert.deepEqual(choix('chromeSeul', 'femme'), ['Google français', 'femme', 1]);
  // Toujours une voix française, pour chaque appareil et chaque genre.
  for (const [nom, liste] of Object.entries(APPAREILS)) for (const g of ['homme', 'femme']) {
    const c = N.choisirVoix(liste, g);
    if (nom === 'anglais') { assert.equal(c.voix, null); assert.equal(c.raison, 'aucune-voix-francaise'); } else assert.match(c.voix!.lang, /^fr[-_]/i, `${nom} ${g}`);
  }
  assert.deepEqual([N.choisirVoix([], 'femme').voix, N.choisirVoix([], 'femme').raison], [null, 'liste-vide'], 'voix pas encore chargées : le navigateur choisira d\'après la langue');
  // Le réglage d'une phrase : voix, langue, vitesse et hauteur naturelles ; sans voix française, on se tait.
  const u: Record<string, unknown> = {};
  assert.equal(N.regler(u, APPAREILS.edge, 'femme', { rate: 1.1, volume: 0.8 }), true);
  assert.deepEqual([(u.voice as Voix).name, u.lang, u.rate, u.pitch, u.volume], ['Microsoft Denise Online (Natural) - French (France)', 'fr-FR', 1.1, 1, 0.8]);
  const u2: Record<string, unknown> = {}; assert.equal(N.regler(u2, APPAREILS.edge, 'homme'), true); assert.deepEqual([u2.rate, u2.pitch], [1, 1], 'vitesse et hauteur naturelles');
  const u3: Record<string, unknown> = {}; assert.equal(N.regler(u3, [], 'homme'), true); assert.deepEqual([u3.lang, u3.voice], ['fr-FR', undefined]);
  assert.equal(N.regler({}, APPAREILS.anglais, 'homme'), false, 'mieux vaut se taire que lire du français avec une voix anglaise');
  // Les accords côté interface, et le ménage de secours.
  assert.equal(N.accord('prêt', 'prête'), 'prêt'); N.genre = 'femme'; assert.equal(N.accord('tout seul', 'toute seule'), 'toute seule');
  assert.equal(N.sansSymboles('**Gras** et [lien](https://x.fr)\n- un\n- deux ✅'), 'Gras et lien. un. deux');
});

test('voix d\'un service : une voix par genre d\'office, et une voix française du compte est repérée', async () => {
  // Chaque façon de parler a sa voix d'homme et sa voix de femme, sans rien régler.
  const base = { ...DEFAULT_CONFIG.voice, localOnly: false };
  for (const [provider, homme, femme] of [['elevenlabs', 'onwK4e9ZLuTAKqWW03F9', 'XB0fDUnXU5powFXDhCwa'], ['openai', 'onyx', 'nova'], ['piper', 'fr_FR-tom-medium', 'fr_FR-siwis-medium']] as const) {
    const cfg = { ...base, tts: { ...base.tts, provider, voiceId: provider === 'piper' ? 'fr_FR-tom-medium' : '' } };
    assert.equal(voiceFor({ ...cfg, gender: 'homme' }, DEFAULT_CONFIG).tts.voiceId, homme, provider); assert.equal(voiceFor({ ...cfg, gender: 'femme' }, DEFAULT_CONFIG).tts.voiceId, femme, provider);
    // Et elle se change : une voix précise passe devant celle d'office.
    assert.equal(voiceFor({ ...cfg, gender: 'femme', femaleVoiceId: 'MaVoix' }, DEFAULT_CONFIG).tts.voiceId, 'MaVoix'); assert.equal(voiceFor({ ...cfg, gender: 'homme', tts: { ...cfg.tts, voiceId: 'SaVoix' } }, DEFAULT_CONFIG).tts.voiceId, 'SaVoix');
  }
  // Ce que disent les étiquettes d'ElevenLabs, sans rien supposer.
  assert.deepEqual(etiquettesVoix({ labels: { gender: 'female', language: 'fr', accent: 'standard' } }), { genre: 'femme', francaise: true });
  assert.deepEqual(etiquettesVoix({ labels: { gender: 'male', accent: 'british', language: 'en' } }), { genre: 'homme' });
  assert.deepEqual(etiquettesVoix({ labels: { gender: 'male', accent: 'French' } }), { genre: 'homme', francaise: true });
  assert.deepEqual(etiquettesVoix({ labels: null }), {}); assert.deepEqual(etiquettesVoix({}), {});
  // Un faux ElevenLabs : la liste des voix du compte, avec leurs étiquettes.
  const srv = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url?.startsWith('/v2/voices') ? { has_more: false, voices: [
      { voice_id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', category: 'premade', labels: { gender: 'male', accent: 'british', language: 'en' } },
      { voice_id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', category: 'premade', labels: { gender: 'female', accent: 'swedish', language: 'en' } },
      { voice_id: 'voixClonee1', name: 'Ma voix', category: 'cloned', labels: {} },
      { voice_id: 'frHomme1', name: 'Mathieu', category: 'professional', labels: { gender: 'male', language: 'fr', accent: 'standard' } },
      { voice_id: 'frFemme1', name: 'Claire', category: 'professional', labels: { gender: 'female', language: 'fr', accent: 'parisian' } },
    ] } : {}));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const voix = await listVoices({ ...base, tts: { provider: 'elevenlabs', voiceId: '', voiceName: '', model: 'eleven_multilingual_v2', baseUrl: url, apiKeyEnv: 'ELEVENLABS_API_KEY' } }, { ELEVENLABS_API_KEY: 'cle-de-test' });
    assert.equal(voix[0].id, 'voixClonee1', 'tes voix copiées d\'abord');
    assert.deepEqual(voix.find((x) => x.id === 'frFemme1'), { id: 'frFemme1', name: 'Claire', category: 'professional', genre: 'femme', francaise: true });
    assert.equal(voixFrancaise(voix, 'femme')?.name, 'Claire'); assert.equal(voixFrancaise(voix, 'homme')?.name, 'Mathieu');
    assert.equal(voixFrancaise(voix.filter((x) => x.category === 'premade'), 'femme'), undefined, 'aucune voix française sur le compte : la voix d\'office reste');
  } finally { await new Promise((r) => srv.close(r)); }
});

test('interface : la voix du navigateur passe par ce choix, et le réglage se voit au premier démarrage et dans Réglages → Voix', () => {
  const ui = lire('src/web/ui.html'), serveur = lire('src/web/server.ts');
  assert.match(ui, /<script nonce="__NONCE__" src="\/naturel\.js"><\/script>/); assert.match(serveur, /url\.pathname === '\/naturel\.js'/);
  assert.ok(ui.indexOf('src="/naturel.js"') < ui.indexOf('const AUTHED = __AUTHED__'), 'chargé avant le script de la page');
  // Plus de choix de voix écrit dans la page, plus de hauteur forcée : tout passe par OdinNaturel.
  assert.doesNotMatch(ui, /MALE_FR|frenchVoice\(/); assert.doesNotMatch(ui, /u\.pitch = /);
  assert.ok((ui.match(/OdinNaturel\.regler\(/g) ?? []).length >= 3, 'lecture des réponses, visite, bouton Écouter');
  // Le texte lu par la voix du navigateur est préparé par Odin (nombres, heures, listes, sans symboles).
  assert.match(ui, /api\('\/api\/voice\/texte'/); assert.match(serveur, /url\.pathname === '\/api\/voice\/texte'/);
  // Réglages → Voix : un seul choix, et la question au premier démarrage tant que personne n'a choisi.
  assert.match(ui, /<legend[^>]*>Odin : homme ou femme<\/legend>/); assert.match(ui, /name="v-gender" value="homme"> 👨 Un homme/); assert.match(ui, /name="v-gender" value="femme"> 👩 Une femme/);
  assert.match(ui, /function genreOffer\(next\)/); assert.match(ui, /section: 'genre', genre/); assert.match(ui, /genreOffer\(\(\) => window\.OdinTour\?\.offer\(\)\)/);
  assert.match(ui, /V\.genderChosen \|\| V\.gender === 'femme'/, 'choix déjà fait : pas de question');
  assert.match(ui, /tu préfères que je sois un homme ou une femme \?/);
  assert.match(ui, /window\.OdinNaturel\.genre = /);
});

test('vrai Odin : le choix du premier démarrage, le texte préparé pour la voix du navigateur, et le changement en parlant', async () => {
  const o = makeOdin([]);
  const port = 21000 + Math.floor(Math.random() * 20000), token = ensureWebToken(o.paths);
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  gw.add(new WebChannel(o, { scanNetwork: () => gw.scanNetwork(false) }, { port, host: '127.0.0.1', token, scryptN: 1024 }));
  await gw.start();
  const B = `http://127.0.0.1:${port}`, H = { authorization: `Bearer ${token}`, 'x-odin': '1', 'content-type': 'application/json' };
  const post = async (chemin: string, corps: unknown) => (await fetch(`${B}${chemin}`, { method: 'POST', headers: H, body: JSON.stringify(corps) })).json() as Promise<Record<string, unknown>>;
  const etat = async () => ((await (await fetch(`${B}/api/state`, { headers: H })).json()) as { settings: { voice: { gender: string; genderChosen: boolean } } }).settings.voice;
  try {
    // Le script de l'interface est servi, comme les autres.
    const js = await fetch(`${B}/naturel.js`);
    assert.equal(js.status, 200); assert.match(js.headers.get('content-type') ?? '', /javascript/); assert.match(await js.text(), /OdinNaturel = api/);
    // Installation neuve : personne n'a choisi, la page posera la question.
    assert.deepEqual([(await etat()).gender, (await etat()).genderChosen], ['homme', false]);
    // Le bouton « Une femme » du premier démarrage.
    assert.deepEqual(await post('/api/action', { kind: 'settings_save', section: 'genre', genre: 'femme' }), { ok: true, reloading: false, restartNeeded: false });
    assert.deepEqual([(await etat()).gender, (await etat()).genderChosen], ['femme', true]);
    assert.equal((await post('/api/action', { kind: 'settings_save', section: 'genre', genre: 'robot' })).ok, false);
    // Le texte que la voix du navigateur va lire : préparé par Odin.
    assert.deepEqual(await post('/api/voice/texte', { text: 'Il est **14:30** : le disque est à 92 %.\n- un lien : https://exemple.fr' }), { ok: true, text: 'Il est quatorze heures trente : le disque est à quatre-vingt-douze pour cent. un lien : le lien affiché.' });
    // En parlant, dans la discussion (sans IA) : le même réglage, et la page le reçoit.
    await post('/api/message', { peer: 'principal', text: 'Parle comme un homme.' });
    const fin = Date.now() + 5000; while (Date.now() < fin && o.cfg.voice.gender !== 'homme') await new Promise((r) => setTimeout(r, 50));
    assert.equal((await etat()).gender, 'homme'); assert.equal(o.provider.calls.length, 0, 'aucune IA');
  } finally { await gw.stop(); o.cleanup(); brancherGenre(undefined); }
});

// ------------------------------------------------------------------ 6. L'installation

test('installation : la question est posée, et sans question Odin garde sa valeur par défaut', () => {
  const sh = lire('install.sh'), ps = lire('install.ps1');
  for (const [nom, s] of [['install.sh', sh], ['install.ps1', ps]] as const) {
    assert.match(s, /# ---------- Odin : un homme ou une femme \? ----------/, nom); assert.match(s, /1\) un homme/, nom); assert.match(s, /2\) une femme/, nom);
    assert.match(s, /Ton choix \[1\]/, `${nom} : Entrée = un homme`); assert.match(s, /ODIN_GENRE/, nom); assert.match(s, /genre .?\$?\{?G[Ee][Nn][Rr][Ee]/, `${nom} : la commande « odin genre »`);
    assert.match(s, /un homme par défaut/, nom);
  }
  // La commande que l'installation lance, pour de vrai, dans un dossier jetable.
  const home = mkdtempSync(join(tmpdir(), 'odin-install-'));
  const odin = (...a: string[]) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(RACINE, 'src', 'cli', 'main.ts'), ...a], { env: { ...process.env, ODIN_HOME: home }, encoding: 'utf8', timeout: 60_000 });
  try {
    // Sans question (ODIN_YES=1 sans ODIN_GENRE) : la commande n'est pas lancée ; la configuration neuve dit « un homme », pas encore choisi.
    const etat = odin('genre');
    assert.equal(etat.status, 0, etat.stderr); assert.match(etat.stdout, /Odin est un homme \(choix par défaut, jamais changé\)/);
    assert.equal(genreOdin(loadConfig(odinPaths(home))), 'homme'); assert.ok(!loadConfig(odinPaths(home)).voice.genderChosen, 'l\'interface posera la question au premier démarrage');
    // Avec une réponse (ou ODIN_GENRE=femme) : le choix est écrit.
    const f = odin('genre', 'femme');
    assert.equal(f.status, 0, f.stderr); assert.match(f.stdout, /Odin est une femme/);
    assert.deepEqual(surDisque(join(home, 'config.json')), { gender: 'femme', genderChosen: true });
    assert.notEqual(odin('genre', 'robot').status, 0, 'un choix inconnu est refusé'); assert.equal(surDisque(join(home, 'config.json')).gender, 'femme');
  } finally { rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }

  // Le passage « homme ou femme » de l'installateur de ce système, joué avec une fausse commande « odin » qui note ses appels.
  const d = mkdtempSync(join(tmpdir(), 'odin-install-bloc-'));
  const appels = join(d, 'appels.txt');
  const joue = (genre: string): string[] => {
    writeFileSync(appels, '');
    const env = { ...process.env, ODIN_YES: '1', ODIN_GENRE: genre };
    const r = process.platform === 'win32'
      ? spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(d, 'essai.ps1')], { env, encoding: 'utf8', timeout: 60_000 })
      : spawnSync('bash', [join(d, 'essai.sh')], { env, encoding: 'utf8', timeout: 60_000 });
    assert.equal(r.status, 0, `${r.stderr}${r.stdout}`);
    return readFileSync(appels, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  };
  try {
    if (process.platform === 'win32') {
      const bloc = /# ---------- Odin : un homme ou une femme \? ----------[\s\S]*?# ---------- \(fin : homme ou femme\) ----------/.exec(ps)![0];
      // Fichier écrit avec sa marque UTF-8 : PowerShell 5.1 lit sinon les accents de travers.
      writeFileSync(join(d, 'essai.ps1'), `﻿function Ok($t) { }\nfunction Info($t) { }\nfunction FauxOdin { Add-Content -Path '${appels.replace(/'/g, '\'\'')}' -Value ($args -join ' ') }\n$Odin = 'FauxOdin'\n${bloc}\n`);
    } else {
      const bloc = /# ---------- Odin : un homme ou une femme \? ----------[\s\S]*?# ---------- \(fin : homme ou femme\) ----------/.exec(sh)![0];
      writeFileSync(join(d, 'odin'), `#!/bin/sh\necho "$@" >> "${appels}"\n`); chmodSync(join(d, 'odin'), 0o755);
      writeFileSync(join(d, 'essai.sh'), `set -euo pipefail\nok() { :; }\ninfo() { :; }\nBIN_DIR="${d}"\n${bloc}\n`);
    }
    assert.deepEqual(joue(''), [], 'sans question et sans ODIN_GENRE : rien n\'est écrit, la valeur par défaut reste');
    assert.deepEqual(joue('femme'), ['genre femme']);
    assert.deepEqual(joue('H'), ['genre homme']);
    assert.deepEqual(joue('robot'), [], 'une valeur inconnue : la valeur par défaut reste');
  } finally { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  assert.ok(existsSync(join(RACINE, 'src', 'core', 'genre.ts')));
});
