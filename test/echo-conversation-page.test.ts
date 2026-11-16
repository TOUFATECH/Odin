// Écho · mode « Conversation », la page (src/web/pages/rodd-conversation.js) : sa logique pure est essayée sans navigateur
// (détecteur de parole, fichier WAV, choix de la voix, qui parle ensuite, disposition), puis le fichier est relu :
// pas de fenêtre native, micro ouvert à un seul endroit, rien gardé dans le navigateur, aucune adresse extérieure.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const lire = (f: string) => readFileSync(new URL(`../src/web/pages/${f}`, import.meta.url), 'utf8');
const SOURCE = lire('rodd-conversation.js');

type Ev = { type: string; raison?: string; vide?: boolean } | null;
type Vad = { image: (n: number, o?: { voix?: boolean; attente?: boolean }) => Ev; etat: () => { bruit: number; seuil: number; parole: boolean } };
type Voix = { name: string; lang: string; localService: boolean };
type Conv = {
  dessiner: unknown; occupe: () => boolean; arreter: unknown;
  TEXTES: Record<string, Record<string, string>>;
  logique: {
    vad: (o?: { pause?: number }) => Vad;
    encoderWav: (s: Float32Array, taux?: number) => Uint8Array;
    reechantillonner: (s: Float32Array, de: number, vers: number) => Float32Array;
    choisirVoix: (v: Voix[], l: string, local: boolean) => Voix | null;
    attendu: (actuel: string, tour: Record<string, unknown>) => string;
    disposition: (largeur: number, tactile: boolean, f: string) => { mode: string; rotation: boolean };
  };
};

function charger(): Conv {
  const win: { OdinEchoConversation?: Conv; OdinPages?: unknown } = {};
  // Ni document, ni fetch : un accès à l'un ou à l'autre au chargement ferait échouer cette ligne.
  vm.runInNewContext(SOURCE, { window: win });
  assert.ok(win.OdinEchoConversation, 'window.OdinEchoConversation est posé');
  assert.equal(win.OdinPages, undefined, 'le fichier ne s\'inscrit pas dans OdinPages');
  return win.OdinEchoConversation;
}

/** Fait passer une suite de niveaux (une image toutes les 50 ms) dans le détecteur ; rend les événements. */
function passer(v: Vad, segments: Array<[number, number, { voix?: boolean }?]>): Array<NonNullable<Ev>> {
  const out: Array<NonNullable<Ev>> = [];
  for (const [ms, n, o] of segments) for (let t = 0; t < ms; t += 50) { const e = v.image(n, o); if (e) out.push(e); }
  return out;
}
const CALME: [number, number] = [1000, 0.002];

test('chargement : l\'objet de la page, sa logique, rien contre la page', () => {
  const C = charger();
  for (const k of ['dessiner', 'occupe', 'arreter', 'logique'] as const) assert.ok(C[k], k);
  assert.equal(typeof C.dessiner, 'function'); assert.equal(typeof C.arreter, 'function');
  assert.equal(C.occupe(), false, 'au repos, rien n\'est en cours');
  assert.doesNotMatch(SOURCE, /OdinPages/, 'jamais d\'écriture dans OdinPages');
});

test('détecteur de parole : un bruit court ne lance pas de tour', () => {
  const { vad } = charger().logique;
  const ev = passer(vad({ pause: 1.2 }), [CALME, [100, 0.2], [3000, 0.002]]);
  assert.deepEqual(ev.map((e) => e.type), []);
  // Un peu plus long (200 ms) : la parole commence, mais moins de 300 ms = ignoré, sans fin de tour.
  const ev2 = passer(vad({ pause: 1.2 }), [CALME, [200, 0.2], [3000, 0.002]]);
  assert.ok(!ev2.some((e) => e.type === 'fin'), 'moins de 300 ms de parole : pas de tour');
});

test('détecteur de parole : 2 s de parole puis 1,2 s de silence = une seule fin de tour', () => {
  const { vad } = charger().logique;
  const ev = passer(vad({ pause: 1.2 }), [CALME, [2000, 0.2], [1300, 0.002], [2000, 0.002]]);
  assert.deepEqual(ev.map((e) => e.type), ['debut', 'fin']);
  assert.equal(ev[1].raison, 'pause'); assert.equal(ev[1].vide, false);
  // 1,1 s de silence seulement : pas encore la fin.
  const ev2 = passer(vad({ pause: 1.2 }), [CALME, [2000, 0.2], [1100, 0.002]]);
  assert.deepEqual(ev2.map((e) => e.type), ['debut']);
});

test('détecteur de parole : une pause de 0,6 s au milieu ne coupe pas la phrase', () => {
  const { vad } = charger().logique;
  const ev = passer(vad({ pause: 1.2 }), [CALME, [2000, 0.2], [600, 0.002], [1500, 0.2], [1500, 0.002]]);
  assert.deepEqual(ev.map((e) => e.type), ['debut', 'fin']);
});

test('détecteur de parole : après 8 s, une pause de 0,4 s envoie un morceau ; le tour continue', () => {
  const { vad } = charger().logique;
  const ev = passer(vad({ pause: 1.2 }), [CALME, [8500, 0.2], [450, 0.002], [2000, 0.2], [1500, 0.002]]);
  assert.deepEqual(ev.map((e) => e.type), ['debut', 'morceau', 'fin']);
  assert.equal(ev[1].raison, 'suite'); assert.equal(ev[2].vide, false);
  // Avant 8 s, la même pause ne fait rien.
  const ev2 = passer(vad({ pause: 1.2 }), [CALME, [5000, 0.2], [450, 0.002], [2000, 0.2]]);
  assert.deepEqual(ev2.map((e) => e.type), ['debut']);
  // Morceau puis silence : la fin arrive, sans rien de nouveau à envoyer.
  const ev3 = passer(vad({ pause: 1.2 }), [CALME, [8500, 0.2], [2000, 0.002]]);
  assert.deepEqual(ev3.map((e) => e.type), ['debut', 'morceau', 'fin']); assert.equal(ev3[2].vide, true);
});

test('détecteur de parole : à 30 s sans pause, coupe forcée', () => {
  const { vad } = charger().logique;
  const ev = passer(vad({ pause: 1.2 }), [CALME, [31000, 0.2]]);
  assert.deepEqual(ev.map((e) => e.type), ['debut', 'fin']);
  assert.equal(ev[1].raison, 'coupe');
});

test('détecteur de parole : pendant que la voix d\'Odin parle, aucun tour ne commence', () => {
  const { vad } = charger().logique;
  const v = vad({ pause: 1.2 });
  const ev = passer(v, [CALME, [3000, 0.3, { voix: true }]]);
  assert.deepEqual(ev, []);
  assert.ok(v.etat().bruit < 0.01, 'la voix d\'Odin n\'est pas apprise comme bruit de fond');
});

test('détecteur de parole : le niveau de bruit suit un fond sonore qui monte', () => {
  const { vad } = charger().logique;
  const v = vad({ pause: 1.2 }), ev: Array<NonNullable<Ev>> = [];
  for (let t = 0; t < 20000; t += 50) { const e = v.image(0.005 + 0.035 * (t / 20000)); if (e) ev.push(e); }
  assert.deepEqual(ev, [], 'un fond qui monte doucement ne lance pas de tour');
  assert.ok(v.etat().bruit > 0.02, `bruit suivi : ${v.etat().bruit}`);
  // Une vraie voix par-dessus ce fond est toujours entendue.
  const ev2 = passer(v, [[2000, 0.3], [1500, 0.04]]);
  assert.deepEqual(ev2.map((e) => e.type), ['debut', 'fin']);
});

test('fichier WAV : en-tête RIFF/WAVE, 16 kHz, mono, 16 bits, bonne longueur', () => {
  const { encoderWav } = charger().logique;
  const s = new Float32Array(16000).map((_, i) => Math.sin(i / 10) * 0.5);
  const w = encoderWav(s), d = new DataView(w.buffer, w.byteOffset, w.byteLength);
  const txt = (o: number) => String.fromCharCode(...w.slice(o, o + 4));
  assert.equal(w.length, 44 + 16000 * 2);
  assert.equal(txt(0), 'RIFF'); assert.equal(d.getUint32(4, true), 36 + 32000); assert.equal(txt(8), 'WAVE'); assert.equal(txt(12), 'fmt ');
  assert.equal(d.getUint16(20, true), 1, 'PCM'); assert.equal(d.getUint16(22, true), 1, 'mono');
  assert.equal(d.getUint32(24, true), 16000); assert.equal(d.getUint32(28, true), 32000); assert.equal(d.getUint16(32, true), 2); assert.equal(d.getUint16(34, true), 16);
  assert.equal(txt(36), 'data'); assert.equal(d.getUint32(40, true), 32000);
  assert.equal(encoderWav(new Float32Array([2, -2])).length, 48, 'les valeurs hors bornes sont ramenées');
});

test('rééchantillonnage : 48 kHz → 16 kHz garde la durée', () => {
  const { reechantillonner } = charger().logique;
  const s = new Float32Array(48000).fill(0.25);
  const r = reechantillonner(s, 48000, 16000);
  assert.equal(r.length, 16000); assert.ok(Math.abs(r[100] - 0.25) < 1e-6);
  assert.equal(reechantillonner(new Float32Array(4096), 48000, 16000).length, 1365);
  assert.equal(reechantillonner(new Float32Array(44100), 44100, 16000).length, 16000);
});

test('voix du navigateur : la bonne langue seulement, locale si demandé, sinon rien', () => {
  const { choisirVoix } = charger().logique;
  const V = [
    { name: 'Thomas', lang: 'fr-FR', localService: true }, { name: 'Kyoko (réseau)', lang: 'ja-JP', localService: false },
    { name: 'Haruka', lang: 'ja_JP', localService: true }, { name: 'Samantha', lang: 'en-US', localService: true },
  ];
  const j = choisirVoix(V, 'ja', false); assert.ok(j && /^ja/i.test(j.lang), 'une voix japonaise');
  for (let i = 0; i < 5; i++) assert.notEqual(choisirVoix(V, 'ja', false)?.lang, 'fr-FR');
  assert.equal(choisirVoix(V, 'ja', true)?.name, 'Haruka', 'tout sur la machine : seulement une voix locale');
  assert.equal(choisirVoix([V[1]], 'ja', true), null, 'la seule voix japonaise est en ligne : rien');
  assert.equal(choisirVoix([V[0], V[3]], 'ja', false), null, 'aucune voix japonaise : rien (jamais la voix française)');
  assert.equal(choisirVoix(V, 'fr-FR', false)?.name, 'Thomas');
});

test('qui parle ensuite : l\'autre, sauf si Odin n\'est pas sûr', () => {
  const { attendu } = charger().logique;
  assert.equal(attendu('moi', { ok: true, qui: 'moi' }), 'lui');
  assert.equal(attendu('lui', { ok: true, qui: 'lui' }), 'moi');
  assert.equal(attendu('lui', { ok: true, qui: 'moi', incertain: true }), 'lui', 'incertain : rien ne change');
  assert.equal(attendu('moi', { ok: true, qui: 'lui', incertain: true }), 'moi');
  assert.equal(attendu('moi', { ok: false }), 'moi');
  assert.equal(attendu('lui', { ok: true, qui: 'moi', rien: true }), 'moi', 'pas compris : la même personne répète');
});

test('disposition : face à face sur téléphone (moitié retournée), côte à côte sur ordinateur', () => {
  const { disposition } = charger().logique;
  assert.deepEqual({ ...disposition(390, true, 'auto') }, { mode: 'face', rotation: true });
  assert.deepEqual({ ...disposition(1280, false, 'auto') }, { mode: 'cote', rotation: false });
  assert.equal(disposition(1280, false, 'oui').mode, 'face');
  assert.equal(disposition(390, true, 'non').mode, 'cote');
  assert.equal(disposition(700, false, 'auto').mode, 'face');
});

test('textes des moitiés : mêmes clés en français, anglais et japonais, japonais en kana, aucun vide', () => {
  const { TEXTES } = charger();
  const cles = Object.keys(TEXTES.fr).sort();
  assert.ok(cles.length >= 10);
  for (const l of ['en', 'ja']) assert.deepEqual(Object.keys(TEXTES[l]).sort(), cles, l);
  for (const l of ['fr', 'en', 'ja']) for (const k of cles) assert.ok(TEXTES[l][k].trim(), `${l}.${k}`);
  for (const k of cles) assert.match(TEXTES.ja[k], /[぀-ヿ]/, `ja.${k} contient des kana`);
  assert.equal(TEXTES.fr.ecoute, 'J\'écoute…'); assert.equal(TEXTES.en.aVous, 'Your turn'); assert.equal(TEXTES.ja.traduction, '翻訳しています…');
});

test('lecture du fichier : fenêtres d\'Odin, micro à un seul endroit, rien gardé, rien d\'extérieur', () => {
  const S = SOURCE;
  assert.doesNotMatch(S, /(?<!OdinDialog\.)\b(alert|confirm|prompt)\(/, 'pas de fenêtre native du navigateur');
  assert.equal(S.match(/getUserMedia/g)?.length, 1, 'getUserMedia une seule fois');
  const debut = S.indexOf('async function demarrerMicro('), fin = S.indexOf('\n  }\n', debut);
  assert.ok(debut > 0 && S.indexOf('getUserMedia') > debut && S.indexOf('getUserMedia') < fin, 'et seulement dans demarrerMicro');
  assert.doesNotMatch(S, /localStorage|sessionStorage|indexedDB/i);
  assert.match(S, /rotate\(180deg\)/);
  assert.match(S, /\blang: l\b/); assert.match(S, /\[lang=ja\]/);
  assert.doesNotMatch(S, /#buddy|OdinFace/, 'la mascotte n\'est pas recopiée');
  for (const m of S.matchAll(/https?:\/\/[^\s'"`]*/g)) assert.fail(`adresse extérieure : ${m[0]}`);
  for (const m of S.matchAll(/fetch\(\s*[`'"]([^`'"]*)/g)) assert.match(m[1], /^\/api\//, `appel : ${m[1]}`);
  assert.doesNotMatch(S, /requestAnimationFrame/, 'le détecteur tourne par setInterval');
  assert.match(S, /createScriptProcessor/); assert.doesNotMatch(S, /AudioWorklet|addModule/);
  assert.doesNotMatch(S, /Interprète/i, 'le nom d\'une autre appli n\'apparaît pas');
});

test('rodd.js : se charge avec la conversation, onglet « Conversation » entre « Dictée » et « Mes mots »', () => {
  const R = lire('rodd.js');
  const win: Record<string, unknown> = {};
  const ctx = vm.createContext({ window: win });
  vm.runInContext(R, ctx); vm.runInContext(SOURCE, ctx);
  assert.equal(typeof (win.OdinPages as Record<string, unknown>).rodd, 'function');
  assert.ok(win.OdinEchoConversation);
  assert.match(R, /\['dictee', 'Dictée'\], \['conversation', 'Conversation'\], \['mots', 'Mes mots'\]/);
  assert.match(R, /OdinEchoConversation\?\.occupe\?\.\(\)/);
  assert.match(R, /OdinEchoConversation\?\.arreter\?\.\(\)/);
  assert.match(R, /OdinOpenWant\?\.module === 'rodd'/);
  assert.match(R, /h\.ouvrirConversation/);
});
