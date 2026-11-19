// Images vers un agent connecté : seulement avec le « oui » du propriétaire, image par image.
// Le faux agent connecté (fournisseur simulé) compte les images qu'il reçoit vraiment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call, makeOdin, type TestOdin } from './helpers.ts';
import { creerPorte, empreinteImage } from '../src/video/envoi-images.ts';
import { lookFrames } from '../src/video/video.ts';

// Une image PNG d'un pixel.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const imagesRecues = (o: TestOdin): number => o.provider.calls.reduce((n, c) => n + c.messages.reduce((k, m) => k + (m.images?.length ?? 0), 0), 0);
const sortieOutil = (o: TestOdin, nom: string): string => o.provider.calls.flatMap((c) => c.messages).filter((m) => m.role === 'tool' && m.toolName === nom).map((m) => m.content).at(-1) ?? '';

test('image_view, il dit non : l\'image ne part pas ; une seule question (agent, nom, poids), sans « toujours »', async () => {
  const o = makeOdin([call('image_view', { path: 'photo.png', question: 'Que vois-tu ?' }), { text: 'Je ne l\'ai pas vue.' }, { text: 'fin' }], { approve: false });
  try {
    writeFileSync(join(o.paths.workspace, 'photo.png'), PNG);
    await o.agent.run('regarde photo.png', { sessionId: 's' });
    assert.equal(imagesRecues(o), 0, 'aucune image reçue par l\'agent connecté');
    const q = o.approvals.filter((a) => /pour la regarder/.test(a.summary));
    assert.equal(q.length, 1, 'une question pour cette image');
    assert.match(q[0].summary, /^Envoyer cette image à .+ pour la regarder \?/);
    assert.match(q[0].summary, /photo\.png/);
    assert.match(q[0].summary, /\d+ octets|\d+ Ko|Mo/);
    assert.equal(q[0].grantable, false, 'jamais de « toujours »');
    const sortie = sortieOutil(o, 'image_view');
    assert.match(sortie, /non envoyée/i);
    assert.match(sortie, /PNG/, 'ce qu\'Odin sait sans elle : ses métadonnées');
  } finally { o.cleanup(); }
});

test('image_view, il dit oui : l\'image part une seule fois ; la même image redemandée → nouvelle question', async () => {
  const o = makeOdin([
    call('image_view', { path: 'photo.png' }), { text: 'Un pixel.' },
    call('image_view', { path: 'photo.png' }), { text: 'Toujours un pixel.' },
    { text: 'fin' },
  ], { approve: true });
  try {
    writeFileSync(join(o.paths.workspace, 'photo.png'), PNG);
    await o.agent.run('regarde photo.png deux fois', { sessionId: 's' });
    const q = o.approvals.filter((a) => /pour la regarder/.test(a.summary));
    assert.equal(q.length, 2, 'un oui par envoi');
    assert.equal(imagesRecues(o), 2, 'deux oui → deux envois, pas plus');
  } finally { o.cleanup(); }
});

test('sans surveillance : aucune question, aucune image ne part', async () => {
  const o = makeOdin([call('image_view', { path: 'photo.png' }), { text: 'Je ne l\'ai pas vue.' }, { text: 'fin' }], { approve: true });
  try {
    writeFileSync(join(o.paths.workspace, 'photo.png'), PNG);
    await o.agent.run('regarde photo.png', { sessionId: 'cron:essai', unattended: true });
    assert.equal(o.approvals.filter((a) => /regarder/.test(a.summary)).length, 0);
    assert.equal(imagesRecues(o), 0);
    assert.match(sortieOutil(o, 'image_view'), /non envoyée/i);
  } finally { o.cleanup(); }
});

test('porte : une question pour un lot (combien, au plus combien) ; chaque oui ne sert qu\'une fois, pour l\'agent nommé', async () => {
  const recues: number[] = [], questions: string[] = [];
  let oui = true;
  const agentA = { nom: 'Agent A', envoyer: async (_q: string, imgs: Array<{ mime: string; data: string }>) => { recues.push(imgs.length); return imgs.map((_, i) => `[0:0${i}] vu`).join('\n'); } };
  let agent: typeof agentA | undefined = agentA;
  const porte = creerPorte({ agent: () => agent, demander: async (q) => { questions.push(q); return oui; }, sansSurveillance: false });
  // Trois images JPEG différentes (un commentaire différent dans chacune).
  const imgs = [0, 1, 2].map((k) => ({ mime: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 0xfe, 0x00, 0x03, 0x30 + k, 0xff, 0xd9]).toString('base64') }));
  const lot = await porte.demanderLot({ quoi: 'demo.mp4', images: imgs, max: 14 });
  assert.equal(lot.oui, true);
  assert.equal(questions.length, 1);
  assert.match(questions[0], /^Envoyer 3 images de la vidéo « demo\.mp4 » à Agent A pour les regarder \?/);
  assert.match(questions[0], /14 au plus/);
  assert.equal(await porte.vision('Instants : 0:00, 0:01, 0:02', imgs), '[0:00] vu\n[0:01] vu\n[0:02] vu');
  assert.deepEqual(recues, [3]);
  assert.equal(questions.length, 1, 'le lot accepté ne redemande pas');
  // Le même lot renvoyé : chaque oui a servi → une question par image.
  oui = false;
  const r = await porte.vision('encore', imgs);
  assert.equal(questions.length, 4);
  assert.deepEqual(recues, [3], 'rien de plus n\'est parti');
  assert.match(r, /non envoyée/i);
  // Oui donné pour l'agent A, mais c'est un autre agent qui regarderait : rien ne part, sans question.
  oui = true;
  await porte.demanderLot({ quoi: 'demo.mp4', images: imgs.slice(0, 1), max: 14 });
  agent = { nom: 'Agent B', envoyer: agentA.envoyer };
  await assert.rejects(porte.vision('x', imgs.slice(0, 1)), /non envoyée/i);
  assert.deepEqual(recues, [3]);
  // L'empreinte dépend de l'image.
  assert.notEqual(empreinteImage(imgs[0]), empreinteImage(imgs[1]));
  // lookFrames ne reçoit jamais un refus comme description.
  agent = agentA; oui = false;
  const dir = mkdtempSync(join(tmpdir(), 'odin-porte-'));
  try {
    writeFileSync(join(dir, 'f.jpg'), 'x');
    const frames = await lookFrames([{ t: 0, file: join(dir, 'f.jpg') }], porte.vision);
    assert.deepEqual(recues, [3]);
    assert.equal(frames[0].seen ?? '', '', 'une image non envoyée reste non décrite (le texte lu par Odin prend le relais)');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
// Un nom de fichier qui contient une fausse clé : le texte qui part vers l'agent la masque.
const NOM = 'demo-sk-ant-api03-ESSAIessaiESSAIessai0123.mp4';
const fabriquerVideo = (o: TestOdin): void => {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=160x120:d=5', '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:d=5', '-f', 'lavfi', '-i', 'color=c=green:s=160x120:d=5', '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(o.paths.workspace, NOM)]);
};
const scriptVideo = () => {
  let outil = false;
  return (req: import('../src/types.ts').CompletionRequest) => {
    if (req.messages.some((m) => m.images?.length)) { const inst = req.messages.at(-1)!.content.match(/Instants : (.*)$/m)?.[1].split(', ') ?? []; return { text: inst.map((t) => `[${t}] Écran uni.`).join('\n') }; }
    if (/Tu analyses une vidéo/.test(req.system)) return { text: 'Résumé de la vidéo.' };
    if (req.tools.length && !outil) { outil = true; return call('video_analyze', { source: NOM, mode: 'résumé' }); }
    return { text: 'Fini.' };
  };
};

for (const reponse of [false, true]) {
  test(`vidéo, il dit ${reponse ? 'oui' : 'non'} : une seule question pour toute la vidéo ; ${reponse ? 'ses images partent' : 'aucune image ne part'} ; le texte part masqué`, { skip: !hasFfmpeg && 'FFmpeg n\'est pas installé sur cette machine', timeout: 240_000 }, async () => {
    const o = makeOdin(scriptVideo(), { approve: reponse });
    try {
      fabriquerVideo(o);
      await o.agent.run('analyse la vidéo que je viens de déposer', { sessionId: 's' });
      const q = o.approvals.filter((a) => /regarder/.test(a.summary));
      assert.equal(q.length, 1, `une seule question (${q.map((a) => a.summary).join(' | ')})`);
      const n = Number(q[0].summary.match(/^Envoyer (\d+) images? de la vidéo/)?.[1]);
      assert.ok(n >= 3, q[0].summary);
      assert.match(q[0].summary, /14 au plus/);
      assert.equal(imagesRecues(o), reponse ? n : 0);
      const texte = o.provider.calls.filter((c) => /Tu analyses une vidéo/.test(c.system)).map((c) => c.messages.at(-1)!.content).join('\n');
      assert.ok(texte, 'le texte lu par Odin part sans question');
      assert.ok(!texte.includes('sk-ant-api03-ESSAI'), 'la clé est masquée');
      assert.match(texte, /\[SECRET\]/);
    } finally { o.cleanup(); }
  });
}

// Une photo JPEG qui porte une position GPS (EXIF), l'heure de prise de vue et l'appareil.
const photoAvecPosition = (): Buffer => {
  const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const entree = (tag: number, type: number, count: number, val: Buffer) => Buffer.concat([u16(tag), u16(type), u32(count), val]);
  const rat = (a: number, b: number) => Buffer.concat([u32(a), u32(b)]);
  // TIFF : en-tête (8) + IFD0 à 8 (2 + 12 + 4 = 18) → IFD GPS à 26 (2 + 4 × 12 + 4 = 54) → valeurs à 80.
  const ifd0 = Buffer.concat([u16(1), entree(0x8825, 4, 1, u32(26)), u32(0)]);
  const gps = Buffer.concat([u16(4), entree(1, 2, 2, Buffer.from('N\0\0\0', 'latin1')), entree(2, 5, 3, u32(80)), entree(3, 2, 2, Buffer.from('E\0\0\0', 'latin1')), entree(4, 5, 3, u32(104)), u32(0)]);
  const tiff = Buffer.concat([Buffer.from('II*\0', 'latin1'), u32(8), ifd0, gps, rat(43, 1), rat(12, 1), rat(30, 1), rat(5, 1), rat(22, 1), rat(10, 1)]);
  const corps = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const xmp = Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><exif:GPSLatitude>43,12.5N</exif:GPSLatitude></x:xmpmeta>', 'latin1');
  const seg = (m: number, d: Buffer) => { const h = Buffer.alloc(4); h.writeUInt16BE(0xff00 | m, 0); h.writeUInt16BE(d.length + 2, 2); return Buffer.concat([h, d]); };
  return Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe1, corps), seg(0xe1, xmp), Buffer.from([0xff, 0xd9])]);
};

test('photo avec position, il dit oui : la photo part SANS sa position (EXIF et XMP retirés), et la question le dit', async () => {
  const { lireMetadonnees } = await import('../src/medias/metadonnees.ts');
  const photo = photoAvecPosition();
  assert.ok(lireMetadonnees({ octets: photo, nom: 'vacances.jpg' }).position, 'la photo d\'essai porte bien une position');
  const o = makeOdin([call('image_view', { path: 'vacances.jpg' }), { text: 'Une photo.' }, { text: 'fin' }], { approve: true });
  try {
    writeFileSync(join(o.paths.workspace, 'vacances.jpg'), photo);
    await o.agent.run('regarde vacances.jpg', { sessionId: 's' });
    const recues = o.provider.calls.flatMap((c) => c.messages).flatMap((m) => m.images ?? []);
    assert.equal(recues.length, 1, 'le oui laisse partir la photo, une fois');
    const octets = Buffer.from(recues[0].data, 'base64');
    assert.ok(!octets.equals(photo), 'ce ne sont pas les octets d\'origine');
    assert.equal(lireMetadonnees({ octets, nom: 'recue.jpg' }).position, undefined, 'aucune position dans ce que reçoit l\'agent');
    assert.ok(!octets.includes(Buffer.from('Exif\0\0', 'latin1')) && !octets.includes(Buffer.from('GPSLatitude', 'latin1')), 'ni EXIF ni XMP');
    const q = o.approvals.filter((a) => /pour la regarder/.test(a.summary));
    assert.equal(q.length, 1);
    assert.match(q[0].summary, /sans sa position/);
  } finally { o.cleanup(); }
});

test('porte : un format dont Odin ne sait pas retirer la position ne part pas, sans question', async () => {
  const recues: number[] = [], questions: string[] = [];
  const porte = creerPorte({ agent: () => ({ nom: 'Agent A', envoyer: async (_q, imgs) => { recues.push(imgs.length); return 'vu'; } }), demander: async (q) => { questions.push(q); return true; }, sansSurveillance: false });
  const gif = { mime: 'image/gif', data: Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1').toString('base64') };
  const r = await porte.vision('Que vois-tu ?', [gif]);
  assert.deepEqual(recues, [], 'rien ne part');
  assert.deepEqual(questions, [], 'aucune question pour rien');
  assert.match(r, /non envoyée/i);
});

test('porte : à la fin d\'une vidéo, les oui qui n\'ont pas servi ne valent plus', async () => {
  let recues = 0;
  const questions: string[] = [];
  const porte = creerPorte({ agent: () => ({ nom: 'Agent A', envoyer: async (_q, imgs) => { recues += imgs.length; return 'vu'; } }), demander: async (q) => { questions.push(q); return questions.length === 1; }, sansSurveillance: false });
  // Deux images JPEG différentes (la seconde porte un commentaire).
  const deux = [Buffer.from([0xff, 0xd8, 0xff, 0xd9]), Buffer.from([0xff, 0xd8, 0xff, 0xfe, 0x00, 0x04, 0x61, 0x62, 0xff, 0xd9])].map((b) => ({ mime: 'image/jpeg', data: b.toString('base64') }));
  const lot = await porte.demanderLot({ quoi: 'v.mp4', images: deux, max: 14 }) as { oui: boolean; fin?: () => void };
  assert.equal(lot.oui, true);
  await porte.vision('q', [deux[0]]);            // la vidéo s'arrête après la première image
  assert.equal(recues, 1);
  lot.fin?.();                                     // fin de l'analyse de la vidéo
  const r = await porte.vision('q', [deux[1]]);    // plus tard, la même image relue : nouvelle question (ici non)
  assert.equal(recues, 1, 'le oui restant ne sert plus');
  assert.equal(questions.length, 2, 'une nouvelle question');
  assert.match(r, /non envoyée/i);
  assert.equal(typeof lot.fin, 'function');
});

test('porte : la raison dit vrai — l\'image quitte la machine, ou reste sur elle (modèle servi ici) ; la question est posée dans les deux cas', async () => {
  const raisons: string[] = [];
  for (const surLaMachine of [false, true]) {
    const porte = creerPorte({ agent: () => ({ nom: 'Agent A', surLaMachine, envoyer: async () => 'vu' }), demander: async (_q, r) => { raisons.push(r); return false; }, sansSurveillance: false });
    await porte.vision('q', [{ mime: 'image/png', data: PNG.toString('base64') }]);
  }
  assert.equal(raisons.length, 2, 'une question dans les deux cas');
  assert.match(raisons[0], /quitte la machine/);
  assert.match(raisons[1], /reste sur cette machine/);
  assert.doesNotMatch(raisons[1], /quitte la machine/);
});
