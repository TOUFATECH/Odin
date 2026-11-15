// Orphée temps réel : le vrai service Python (mode simple : énergie + règles, bibliothèque standard seulement),
// lancé et surveillé par Odin ; la coupure mesurée sous 200 ms ; le repli quand le service manque ; la reprise par
// segments ; et le parcours complet à travers le vrai serveur web d'Odin. Silero, Smart Turn et faster-whisper ne sont
// essayés que s'ils sont installés (sinon : sautés, avec la raison).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Orphee, fixerOrphee, trouverPython, SCRIPT_ORPHEE } from '../src/voice/orphee.ts';
import { decouper, estContinue, Fil, resteApres } from '../src/voice/reprise.ts';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';

const py = trouverPython();
const sansPython = py ? false : 'Python 3.9+ n\'est pas installé sur cette machine';
const modules = py ? spawnSync(py.cmd, [...py.args, '-c', 'import numpy, onnxruntime'], { encoding: 'utf8' }).status === 0 : false;
const modeles = process.env.ORPHEE_MODELES ?? '';
const sansSilero = !py ? 'pas de Python' : !modules ? 'numpy et onnxruntime ne sont pas installés ici (pip install numpy onnxruntime)' : !existsSync(join(modeles, 'silero_vad.onnx')) ? 'modèle silero_vad.onnx absent (ORPHEE_MODELES=<dossier>)' : false;
const sansSmartTurn = !py ? 'pas de Python' : !modules ? 'numpy et onnxruntime ne sont pas installés ici' : !existsSync(join(modeles, 'smart-turn-v3.onnx')) ? 'modèle smart-turn-v3.onnx absent (ORPHEE_MODELES=<dossier>)' : false;

/** Son de synthèse : silence, voix (un son à 220 Hz), en PCM 16 bits 16 kHz. */
const ton = (ms: number, amp = 8000) => { const n = Math.round(16 * ms), b = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(amp * Math.sin(2 * Math.PI * 220 * i / 16000)), i * 2); return b; };
const silence = (ms: number) => Buffer.alloc(Math.round(16 * ms) * 2);
const wav = (pcm: Buffer) => { const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40); return Buffer.concat([h, pcm]); };
type Evt = { type: string; t: number; [k: string]: unknown };

async function service(o: ConstructorParameters<typeof Orphee>[0] = {}): Promise<{ s: Orphee; fin: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), 'orphee-'));
  const s = new Orphee({ modeles: dir, whisper: null, relancer: false, ...o });
  assert.ok(await s.demarrer(), `le service doit démarrer : ${s.raison} ${s.dernieresLignes().join(' | ')}`);
  return { s, fin: () => { s.arreter(); rmSync(dir, { recursive: true, force: true }); } };
}
const session = async (s: Orphee, cfg: Record<string, unknown> = {}) => ((await (await s.appeler('/sessions', { method: 'POST', body: JSON.stringify(cfg) })).json()) as { id: string }).id;
const audio = async (s: Orphee, id: string, pcm: Buffer) => ((await (await s.appeler(`/sessions/${id}/audio`, { method: 'POST', body: pcm })).json()) as { evenements: Evt[] }).evenements;
const controle = async (s: Orphee, id: string, c: Record<string, unknown>) => ((await (await s.appeler(`/sessions/${id}/controle`, { method: 'POST', body: JSON.stringify(c) })).json()) as { evenements: Evt[] }).evenements;
/** Envoie le son par morceaux de 64 ms, comme le navigateur. */
async function flux(s: Orphee, id: string, pcm: Buffer, surChaque?: (evts: Evt[], ms: number) => void): Promise<Evt[]> {
  const out: Evt[] = [];
  for (let i = 0; i < pcm.length; i += 2048) { const t0 = performance.now(); const e = await audio(s, id, pcm.subarray(i, i + 2048)); surChaque?.(e, performance.now() - t0); out.push(...e); }
  return out;
}

// ------------------------------------------------------------------ Reprise par segments (pur)
test('reprise : découpe en segments, « continue » reprend au premier mot jamais dit, une question s\'empile', () => {
  const segs = decouper('Premier point : on vérifie le disque. Ensuite on regarde la mémoire du serveur.\n- Puis le réseau.\n- Enfin les sauvegardes, qui sont importantes.');
  assert.ok(segs.length >= 3, segs.join(' | '));
  assert.ok(estContinue('continue') && estContinue('Vas-y, continue') && estContinue('la suite') && estContinue('Odin, reprends'));
  assert.ok(!estContinue('continue à surveiller le disque'));
  assert.equal(resteApres('un deux trois quatre cinq six sept huit', 500, 1000), 'quatre cinq six sept huit');
  const f = new Fil(30), now = Date.now();
  const r1 = f.nouvelle('explique la sauvegarde', 'La première étape consiste à brancher le disque de sauvegarde sur le serveur. La deuxième étape copie les dossiers importants vers les disques durs externes chaque nuit. La troisième étape vérifie que la copie se relit bien.', now);
  assert.equal(r1.segments.length, 3, r1.segments.map((x) => x.texte).join(' | '));
  f.dit(r1.segments[0].id);
  f.coupe(r1.segments[1].id, 1000, 2000, now);
  // Une question intermédiaire : sa réponse s'empile au-dessus.
  const r2 = f.nouvelle('quelle heure est-il', 'Il est midi.', now);
  let suite = f.continuer(now)!;
  assert.equal(suite.reponse.id, r2.id, 'la réponse la plus récente d\'abord');
  f.dit(r2.segments[0].id);
  suite = f.continuer(now)!;
  assert.equal(suite.reponse.id, r1.id, 'puis « continue » revient à la réponse coupée');
  assert.ok(!suite.segments[0].texte.startsWith('La deuxième'), `reprend au mot près : ${suite.segments[0].texte}`);
  assert.match(suite.segments[0].texte, /disques durs externes/);
  assert.equal(suite.segments.length, r1.segments.length - 1);
  // Un sujet coupé depuis plus longtemps que la durée gardée est oublié.
  assert.equal(f.continuer(now + 31 * 60_000), undefined);
});

// ------------------------------------------------------------------ Le vrai service Python
test('le service : jeton exigé, état des moteurs (mode simple sans numpy)', { skip: sansPython }, async () => {
  const { s, fin } = await service();
  try {
    assert.equal(s.etat, 'prêt');
    const sans = await fetch(`http://127.0.0.1:${s.port}/sante`);
    assert.equal(sans.status, 401, 'sans jeton : refusé');
    const r = await (await s.appeler('/sante')).json() as { ok: boolean; vad: string; tour: string; stt: string };
    assert.ok(r.ok);
    if (!modules) { assert.equal(r.vad, 'énergie'); assert.equal(r.tour, 'règles'); }
    assert.equal(r.stt, 'aucune', 'whisper désactivé pour l\'essai');
    assert.ok(!JSON.stringify(s.resume()).includes('jeton'), 'l\'état ne montre jamais le jeton');
  } finally { fin(); }
});

test('le service : parole, fin de parole, fin de tour (sans Odin qui parle)', { skip: sansPython }, async () => {
  const { s, fin } = await service();
  try {
    const id = await session(s, { fin_ms: 1000 });
    const e = await flux(s, id, Buffer.concat([silence(400), ton(900), silence(1500)]));
    const types = e.map((x) => x.type);
    assert.deepEqual(types.filter((x) => /parole|tour/.test(x)), ['parole_debut', 'parole_fin', 'fin_de_tour'], types.join(','));
    const debut = e.find((x) => x.type === 'parole_debut')!, tour = e.find((x) => x.type === 'fin_de_tour')!;
    assert.ok(debut.t >= 400 && debut.t <= 520, `début de parole vu à ${debut.t} ms`);
    assert.ok(tour.t >= 1300 + 900 && tour.t <= 1300 + 1300, `fin de tour à ${tour.t} ms`);
    // Le dernier énoncé se récupère une seule fois (repli : Odin le transcrit lui-même), puis il n'est plus gardé.
    const w1 = await s.appeler(`/sessions/${id}/enonce`), w2 = await s.appeler(`/sessions/${id}/enonce`);
    assert.equal(w1.status, 200); assert.equal(Buffer.from(await w1.arrayBuffer()).subarray(0, 4).toString(), 'RIFF');
    assert.equal(w2.status, 204, 'l\'énoncé n\'est plus gardé après avoir été remis');
  } finally { fin(); }
});

test('coupure : soupçon à 150 ms (volume 30 %), coupure confirmée et rendue en moins de 200 ms', { skip: sansPython }, async () => {
  const { s, fin } = await service();
  try {
    const id = await session(s);
    await flux(s, id, silence(500));
    await controle(s, id, { type: 'odin_parle', segment: 'r1s2', texte: 'Voici la deuxième partie de ma réponse.' });
    let delai = -1;
    const e = await flux(s, id, Buffer.concat([ton(700), silence(300)]), (evts, ms) => { if (evts.some((x) => x.type === 'coupure')) delai = ms; });
    const soupcon = e.find((x) => x.type === 'soupcon')!, coupure = e.find((x) => x.type === 'coupure')!;
    assert.ok(soupcon && coupure, e.map((x) => x.type).join(','));
    assert.equal(soupcon.volume, 0.3);
    // 150 ms de voix, à une trame de 32 ms près (le son commence au milieu d'une trame).
    assert.ok(soupcon.t - 500 >= 150 - 32 && soupcon.t - 500 <= 150 + 64, `soupçon après ${soupcon.t - 500} ms de voix`);
    assert.ok(coupure.t > soupcon.t);
    assert.equal(coupure.segment, 'r1s2'); assert.equal(coupure.raison, 'parole');
    assert.ok(Number(coupure.latence_ms) < 200, `décision en ${coupure.latence_ms} ms`);
    assert.ok(delai >= 0 && delai < 200, `réponse reçue ${delai.toFixed(1)} ms après l'envoi du morceau qui coupe`);
    assert.ok(Number(coupure.decalage_ms) > 0);
  } finally { fin(); }
});

test('« mmh » ou une toux : fausse alerte, Odin continue ; « attends » : coupure immédiate ; sa propre voix : ignorée', { skip: sansPython }, async () => {
  const { s, fin } = await service();
  try {
    let id = await session(s);
    await flux(s, id, silence(400));
    await controle(s, id, { type: 'odin_parle', segment: 's1', texte: 'Il fait beau aujourd\'hui sur Mamoudzou.' });
    let e = await flux(s, id, Buffer.concat([ton(220), silence(500)]));
    assert.ok(e.some((x) => x.type === 'soupcon') && e.some((x) => x.type === 'fausse_alerte'), e.map((x) => x.type).join(','));
    assert.ok(!e.some((x) => x.type === 'coupure'), 'un son court ne coupe pas Odin');
    // Un mot d'arrêt entendu (texte venu de la transcription) : coupure tout de suite.
    e = await controle(s, id, { type: 'texte', texte: 'attends' });
    assert.equal(e.find((x) => x.type === 'coupure')?.raison, 'mot_arret');
    // Le micro capte la voix d'Odin elle-même : écho, pas de coupure.
    id = await session(s);
    await controle(s, id, { type: 'odin_parle', segment: 's9', texte: 'Il fait beau aujourd\'hui sur Mamoudzou.' });
    // Le texte provisoire arrive pendant que le micro entend encore (comme la transcription en direct).
    e = await flux(s, id, ton(200));
    e.push(...await controle(s, id, { type: 'texte', texte: 'il fait beau aujourd\'hui' }));
    e.push(...await flux(s, id, Buffer.concat([ton(500), silence(200)])));
    assert.ok(e.some((x) => x.type === 'echo_ignore'), e.map((x) => x.type).join(','));
    assert.ok(!e.some((x) => x.type === 'coupure'), 'sa propre voix ne coupe jamais Odin');
  } finally { fin(); }
});

test('analyse d\'un enregistrement entier (WAV) avec des contrôles horodatés : décisions reproductibles', { skip: sansPython }, async () => {
  const { s, fin } = await service();
  try {
    const pcm = Buffer.concat([silence(500), ton(250), silence(800), ton(900), silence(400)]);
    const q = new URLSearchParams({ config: '{}', controles: JSON.stringify([{ type: 'odin_parle', segment: 'a', texte: 'bonjour', a_ms: 100 }]) });
    const une = async () => ((await (await s.appeler(`/analyse?${q}`, { method: 'POST', body: wav(pcm) })).json()) as { evenements: Evt[] }).evenements.map((x) => `${x.type}@${x.t}`);
    const a = await une(), b = await une();
    assert.deepEqual(a, b, 'mêmes sons, mêmes décisions');
    assert.ok(a.some((x) => x.startsWith('fausse_alerte')) && a.some((x) => x.startsWith('coupure')), a.join(' '));
  } finally { fin(); }
});

test('surveillance : le service tombe, Odin le dit puis le relance tout seul', { skip: sansPython, timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orphee-'));
  const s = new Orphee({ modeles: dir, whisper: null, surveillerMs: 500 });
  try {
    assert.ok(await s.demarrer());
    const avant = s.port;
    s.tuer();
    for (let i = 0; i < 50 && String(s.etat) === 'prêt'; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(String(s.etat), 'en panne'); assert.match(s.raison, /arrêté|répond/);
    for (let i = 0; i < 100 && String(s.etat) !== 'prêt'; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(String(s.etat), 'prêt', 'relancé'); assert.ok(s.relances >= 1);
    assert.ok((await s.appeler('/sante')).ok, `répond de nouveau (port ${avant} → ${s.port})`);
  } finally { s.arreter(); rmSync(dir, { recursive: true, force: true }); }
});

test('repli : sans Python ou sans le script, le service est « absent » et le dit (la voix habituelle reste)', async () => {
  const a = new Orphee({ python: 'python-qui-n-existe-pas', relancer: false });
  // trouverPython essaie aussi les commandes habituelles : on vise un script absent pour être sûr du repli.
  const b = new Orphee({ script: join(tmpdir(), 'pas-de-script-orphee.py'), relancer: false });
  assert.equal(await b.demarrer(), false); assert.equal(b.etat, 'absent'); assert.match(b.raison, /pas là/);
  await a.demarrer().catch(() => false); a.arreter();
  assert.ok(existsSync(SCRIPT_ORPHEE), 'le script du service est livré avec Odin');
});

test('Silero VAD (modèle ONNX)', { skip: sansSilero }, async () => {
  const { s, fin } = await service({ modeles });
  try { assert.equal(s.moteurs?.vad, 'silero'); const id = await session(s); const e = await flux(s, id, Buffer.concat([silence(500), ton(800), silence(800)])); assert.ok(Array.isArray(e)); } finally { fin(); }
});
test('Smart Turn v3 (modèle ONNX)', { skip: sansSmartTurn }, async () => {
  const { s, fin } = await service({ modeles });
  try { assert.equal(s.moteurs?.tour, 'smart-turn'); } finally { fin(); }
});

// ------------------------------------------------------------------ À travers le vrai serveur d'Odin
test('le navigateur passe par Odin : session, coupure, fin de tour, transcription de repli, « continue »', { skip: sansPython, timeout: 60_000 }, async () => {
  const t = new T();
  const dir = mkdtempSync(join(tmpdir(), 'orphee-'));
  const s = new Orphee({ modeles: dir, whisper: null, relancer: false });
  fixerOrphee(s);
  try {
    const v = await vraiOdin(t, { compte: true });
    v.o.cfg.voice.brain = 'sans-ia';
    // Pas de transcription en direct ici : Odin transcrit l'énoncé lui-même ; on lui donne un faux Whisper local.
    const http = await import('node:http');
    let dits = 0;
    const faux = http.createServer((req, res) => { req.resume(); req.on('end', () => { dits++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ text: dits === 1 ? 'explique-moi la sauvegarde' : 'continue', language: 'fr' })); }); });
    await new Promise<void>((r) => faux.listen(0, '127.0.0.1', () => r()));
    t.onEnd(() => faux.close());
    Object.assign(v.o.cfg.voice, { localOnly: false, enabled: true });
    v.o.cfg.voice.stt.baseUrl = `http://127.0.0.1:${(faux.address() as { port: number }).port}`;
    v.o.cfg.voice.stt.apiKeyEnv = 'ODIN_ESSAI_SANS_CLE';
    const etat = await v.json('/api/voice/orphee/etat');
    assert.equal(etat.status, 200);
    const ouv = await v.json('/api/voice/orphee/session', {});
    assert.ok(ouv.body.ok, JSON.stringify(ouv.body));
    const id = String(ouv.body.id);
    const morceau = async (pcm: Buffer) => (await (await fetch(`${v.url}/api/voice/orphee/audio?id=${id}`, { method: 'POST', headers: { cookie: v.session, 'x-odin': '1', 'content-type': 'application/octet-stream' }, body: pcm })).json()) as { evenements: Evt[] };
    const tout: Evt[] = [];
    const pcm = Buffer.concat([silence(400), ton(900), silence(2000)]);
    for (let i = 0; i < pcm.length; i += 2048) tout.push(...(await morceau(pcm.subarray(i, i + 2048))).evenements);
    assert.ok(tout.some((x) => x.type === 'fin_de_tour'), tout.map((x) => x.type).join(','));
    // Fin de tour sans texte : Odin récupère l'énoncé et le transcrit (faux Whisper), puis répond (sans IA).
    const r1 = await v.json('/api/voice/orphee/tour', { id });
    assert.ok(r1.body.ok, JSON.stringify(r1.body));
    assert.equal(r1.body.entendu, 'explique-moi la sauvegarde');
    const rep = r1.body.reponse as { id: string; segments: Array<{ id: string; texte: string }> };
    assert.ok(rep.segments.length >= 1);
    // Odin parle le premier segment, on le coupe, puis « continue ».
    await v.json('/api/voice/orphee/controle', { id, type: 'odin_parle', segment: rep.segments[0].id, texte: rep.segments[0].texte });
    const coupe: Evt[] = []; const pcm2 = Buffer.concat([ton(700), silence(300)]);
    for (let i = 0; i < pcm2.length; i += 2048) coupe.push(...(await morceau(pcm2.subarray(i, i + 2048))).evenements);
    assert.ok(coupe.some((x) => x.type === 'coupure'), coupe.map((x) => x.type).join(','));
    await v.json('/api/voice/orphee/coupure', { id, segment: rep.segments[0].id, joue_ms: 0, duree_ms: 3000 });
    await v.json('/api/voice/orphee/controle', { id, type: 'odin_fin' });
    const pcm3 = Buffer.concat([ton(600), silence(2000)]);
    for (let i = 0; i < pcm3.length; i += 2048) await morceau(pcm3.subarray(i, i + 2048));
    const r2 = await v.json('/api/voice/orphee/tour', { id });
    assert.equal(r2.body.reprise, true, JSON.stringify(r2.body));
    assert.equal((r2.body.reponse as { segments: Array<{ texte: string }> }).segments[0].texte, rep.segments[0].texte, 'reprend le segment coupé, depuis le début (rien n\'avait été joué)');
    // Sans session : refusé (le service n'est jamais joignable sans passer la porte d'Odin).
    const sans = await fetch(`${v.url}/api/voice/orphee/etat`);
    assert.equal(sans.status, 401);
    assert.ok((await v.json('/api/voice/orphee/fin', { id })).body.ok);
  } finally { fixerOrphee(undefined); await t.end(); rmSync(dir, { recursive: true, force: true }); }
});

test('rien n\'est écrit à côté du service (pas de cache Python dans le dépôt)', { skip: sansPython }, () => {
  assert.ok(!existsSync(join(SCRIPT_ORPHEE, '..', '__pycache__')), 'PYTHONDONTWRITEBYTECODE : pas de __pycache__ dans le dépôt');
});
