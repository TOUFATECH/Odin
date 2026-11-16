// Vénus · YouTube sans pub : flux par une FAUSSE instance (Invidious), abonnements, historique privé effaçable,
// SponsorBlock (faux) + secours IA sur transcription, réglages. Aucun service réel, aucune pub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MagasinVenus } from '../src/valhalla/venus/base.ts';
import { abonnements, abonner, accueil, ajouterHistoriqueYt, chaine, desabonner, effacerHistoriqueYt, fusionnerSegments, historiqueYt, recherche, reglagesYt, reglerYt, sautA, secoursIaTranscription, segmentsASauter, sponsorBlock, video, type Http, type ReglagesYt } from '../src/valhalla/venus/youtube.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'venus-yt-'));
const regl: ReglagesYt = { instance: 'https://inv.test', moteur: 'invidious', sponsorblockOn: true, categories: ['sponsor'] };
// Un faux Invidious.
const fauxHttp = (routes: Record<string, unknown>): Http => async (url) => {
  for (const [frag, json] of Object.entries(routes)) if (url.includes(frag)) return { ok: true, statut: 200, json };
  return { ok: false, statut: 404, erreur: 'pas trouvé' };
};

test('accueil, recherche, vidéo (flux + suggestions), chaîne : normalisés depuis Invidious', async () => {
  const http = fauxHttp({
    '/api/v1/trending': [{ videoId: 'aaaaaa', title: 'Tendance', author: 'Chaîne A', lengthSeconds: 100, videoThumbnails: [{ url: 'http://t/a.jpg' }] }],
    '/api/v1/search': [{ videoId: 'bbbbbb', title: 'Résultat', author: 'Chaîne B' }],
    '/api/v1/videos/bbbbbb': { videoId: 'bbbbbb', title: 'La vidéo', author: 'Chaîne B', formatStreams: [{ url: 'http://flux/720', qualityLabel: '720p', type: 'video/mp4' }], adaptiveFormats: [{ url: 'http://flux/audio', type: 'audio/mp4' }], recommendedVideos: [{ videoId: 'cccccc', title: 'Suggérée', author: 'C' }] },
    '/api/v1/channels/UCabcdefghij': { author: 'Chaîne B', latestVideos: [{ videoId: 'dddddd', title: 'Dernière', author: 'Chaîne B' }] },
  });
  assert.equal((await accueil(http, regl))[0].titre, 'Tendance');
  assert.equal((await recherche(http, regl, 'test'))[0].id, 'bbbbbb');
  const v = await video(http, regl, 'bbbbbb');
  assert.ok(v && v.flux.length === 2 && v.flux[0].url === 'http://flux/720' && v.suggestions[0].id === 'cccccc');
  const c = await chaine(http, regl, 'UCabcdefghij');
  assert.ok(c && c.nom === 'Chaîne B' && c.videos[0].id === 'dddddd');
  assert.equal(await video(http, regl, 'id!invalide'), undefined);
});

test('abonnements et historique privé (effaçable)', () => {
  const home = tmp();
  try {
    const m = new MagasinVenus(home, join(home, 'freyja'));
    abonner(m, 'moi', 'UCabc', 'Chaîne A'); abonner(m, 'moi', 'UCdef', 'Chaîne B');
    assert.equal(abonnements(m, 'moi').length, 2);
    assert.ok(desabonner(m, 'moi', 'UCabc')); assert.equal(abonnements(m, 'moi').length, 1);
    ajouterHistoriqueYt(m, 'moi', 'vid111', 'Une vidéo'); ajouterHistoriqueYt(m, 'autre', 'vid222', 'X');
    assert.equal(historiqueYt(m, 'moi').length, 1);
    assert.equal(effacerHistoriqueYt(m, 'moi'), 1); assert.equal(historiqueYt(m, 'moi').length, 0);
    assert.equal(historiqueYt(m, 'autre').length, 1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('historique YouTube : identifiant opaque (ID de vidéo jamais en clair) et une seule ligne par vidéo', () => {
  const home = tmp();
  try {
    const dir = join(home, 'freyja');
    const m = new MagasinVenus(home, dir);
    ajouterHistoriqueYt(m, 'moi', 'dQw4w9WgXcQ', 'Une vidéo');
    ajouterHistoriqueYt(m, 'moi', 'dQw4w9WgXcQ', 'Une vidéo'); // revue : même ligne
    assert.equal(historiqueYt(m, 'moi').length, 1, 'une seule ligne par vidéo (dédup)');
    const brut = readFileSync(join(dir, 'yt_historique.jsonl'), 'utf8');
    assert.doesNotMatch(brut, /dQw4w9WgXcQ/, 'l\'ID de la vidéo n\'est jamais dans la clé en clair');
    assert.doesNotMatch(brut, /Une vidéo/, 'le titre reste chiffré');
    assert.equal(historiqueYt(m, 'moi')[0].videoId, 'dQw4w9WgXcQ', 'relu en clair en mémoire');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('réglages YouTube : défaut puis réglés (instance, moteur, SponsorBlock)', () => {
  const home = tmp();
  try {
    const m = new MagasinVenus(home, join(home, 'freyja'));
    assert.equal(reglagesYt(m, 'moi').sponsorblockOn, true);
    reglerYt(m, 'moi', { instance: 'https://piped.test', moteur: 'piped', sponsorblockOn: false });
    const r = reglagesYt(m, 'moi');
    assert.equal(r.instance, 'https://piped.test'); assert.equal(r.moteur, 'piped'); assert.equal(r.sponsorblockOn, false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('SponsorBlock (faux, par préfixe d\'empreinte) + fusion + saut ; secours IA sur transcription', async () => {
  // La variante par préfixe rend plusieurs vidéos : on garde la nôtre.
  const http = fauxHttp({ '/api/skipSegments/': [{ videoID: 'autre', segments: [{ segment: [0, 999], category: 'sponsor' }] }, { videoID: 'vid111', segments: [{ segment: [10, 20], category: 'sponsor' }, { segment: [20, 25], category: 'sponsor' }] }] });
  const segs = await sponsorBlock(http, 'vid111', ['sponsor'], { base: 'https://sb.test' });
  assert.deepEqual(segs, [{ debut: 10, fin: 25, categorie: 'sponsor' }], 'segments de NOTRE vidéo, fusionnés');
  assert.equal(sautA(segs, 12), 25, 'dans un segment : on saute à la fin');
  assert.equal(sautA(segs, 30), undefined, 'hors segment : rien');
  assert.deepEqual(fusionnerSegments([{ debut: 5, fin: 8, categorie: 's' }, { debut: 0, fin: 3, categorie: 's' }]), [{ debut: 0, fin: 3, categorie: 's' }, { debut: 5, fin: 8, categorie: 's' }]);
  // Secours IA sur la transcription (jamais image par image) : le modèle rend du JSON.
  const vtt = 'WEBVTT\n\n00:00:30.000 --> 00:00:40.000\nAllez voir mon sponsor avec le code PROMO\n';
  const ia = await secoursIaTranscription(vtt, async () => 'Voici : [{"debut":30,"fin":40}]');
  assert.deepEqual(ia, [{ debut: 30, fin: 40, categorie: 'sponsor_ia' }]);
  assert.deepEqual(await secoursIaTranscription(vtt, undefined), [], 'sans IA : vide, jamais de démo');
  // segmentsASauter : SponsorBlock d'abord, secours IA si vide.
  const vide = fauxHttp({ '/api/skipSegments/': [] });
  const r2 = await segmentsASauter(vide, 'vid111', regl, { vtt, ask: async () => '[{"debut":30,"fin":40}]' });
  assert.equal(r2[0].categorie, 'sponsor_ia');
});
