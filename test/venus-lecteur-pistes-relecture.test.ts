// Vénus, la suite du lecteur (pistes, qualités, sous-titres, bande-annonce) : relecture.
// AUCUN vrai FFmpeg ni ffprobe (lanceurs simulés), aucun vrai film (de petits fichiers d'octets).
//   - un sous-titre piégé (« <a<a<a… », « <!--<!--… », « {{{{… ») est lu en un passage : il ne fige pas Odin ;
//   - le WebVTT écrit reste borné, même si chaque caractère du fichier grossit en entité ;
//   - un sous-titre ou une bande-annonce « à côté » qui est un LIEN vers un autre endroit de la machine n'est pas servi ;
//   - une rafale de demandes ne fait pas la queue derrière FFmpeg pendant des heures : au-delà de quelques commandes en
//     attente, les suivantes sont refusées ; ouvrir un film n'attend pas derrière une extraction de sous-titres ;
//   - la même piste de sous-titres demandée dix fois en même temps : UNE extraction ; ratée : pas relancée à chaque fois ;
//   - pendant une conversion, rouvrir « Qualité » ne relance pas la mesure à chaque fois ;
//   - un lecteur parti avant le début ne laisse pas FFmpeg tourner pour personne ; un tuyau fermé net ferme la réponse ;
//   - un vrai film dont le nom finit par « trailer », sans film à côté, reste un film du scan ;
//   - la touche C ouvre « Audio et sous-titres » (comme dans la maquette validée).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import vm from 'node:vm';
import { dirVenus, magasinVenus, oublierMagasins, type MagasinVenus } from '../src/valhalla/venus/base.ts';
import { ajouterDossier, bibliotheque, scanner, type Probe } from '../src/valhalla/venus/bibliotheque.ts';
import { venusRoute } from '../src/valhalla/venus/routes.ts';
import { argsConversion, conversionEnCours, diffuser, lancerCourt, reglerOutilsPistes, type Court, type Flux } from '../src/valhalla/venus/pistes.ts';
import { lireSousTitres, oublierSousTitres, sousTitresACote, versVttSur, TAILLE_MAX } from '../src/valhalla/venus/sous-titres.ts';
import { bandeAnnonceLocale } from '../src/valhalla/venus/bande-annonce.ts';

const racine = mkdtempSync(join(tmpdir(), 'venus-pistes-relu-'));
const home = join(racine, 'home'), films = join(racine, 'Films'), phare = join(films, 'Le Phare (2020)'), maree = join(films, 'La Maree (2019)'), secret = join(racine, 'Ailleurs');
const mag = (): MagasinVenus => magasinVenus(home, dirVenus(home));
const PHARE = 'film:le-phare-2020', MAREE = 'film:la-maree-2019';
const enc = encodeURIComponent;

// ---------------------------------------------------------------- les faux FFmpeg et ffprobe
const appels: Array<{ cmd: string; args: string[] }> = [];
const lances: Array<{ args: string[]; sortie: PassThrough; tue: boolean; finir(): void }> = [];
let vttRate = false, mesure: Record<number, number | 'coupe'> = {};
const rien = (): Court => ({ ok: false, coupe: false, sortie: Buffer.alloc(0), ms: 1 });
const court = async (cmd: 'ffprobe' | 'ffmpeg', args: string[], o: { delaiMs: number; maxOctets: number }): Promise<Court> => {
  appels.push({ cmd, args });
  await new Promise((r) => setTimeout(r, args.includes('LENT') ? 500 : 15));
  const rep = (sortie: string, ms = 10): Court => ({ ok: true, coupe: false, sortie: Buffer.from(sortie), ms });
  if (args[0] === '-version') return rep('ffmpeg version essai');
  if (cmd === 'ffprobe') return rep(JSON.stringify({ streams: [{ index: 0, codec_type: 'video', codec_name: 'h264' }, { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2, tags: { language: 'fre' } }, { index: 2, codec_type: 'audio', codec_name: 'aac', channels: 2, tags: { language: 'eng' } }, { index: 3, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'fre' } }] }));
  const scale = /^scale=-2:(\d+)$/.exec(args[args.indexOf('-vf') + 1] ?? '');
  if (scale && args.at(-2) === 'null') { const m = mesure[Number(scale[1])]; return m === 'coupe' || m === undefined ? { ok: false, coupe: true, sortie: Buffer.alloc(0), ms: o.delaiMs } : rep('', m); }
  if (args.includes('webvtt')) return vttRate ? rien() : rep('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nDans la vidéo\n');
  return rien();
};
const flux = (args: string[]): Flux => {
  const sortie = new PassThrough(); let finir!: () => void; const fin = new Promise<void>((ok) => { finir = ok; });
  const l = { args, sortie, tue: false, finir: () => { sortie.end(); finir(); } };
  lances.push(l);
  return { sortie, fin, tuer() { if (l.tue) return; l.tue = true; sortie.destroy(); finir(); } };
};
const brancher = () => reglerOutilsPistes({ court, flux });

let odin: Server, url = '';
const api = async (chemin: string, o: RequestInit = {}) => { const r = await fetch(`${url}${chemin}`, o); return { status: r.status, entetes: r.headers, texte: await r.text() }; };
const attendreQue = async (ok: () => boolean, ms = 3000) => { for (let k = 0; k < ms / 20; k++) { if (ok()) return true; await new Promise((r) => setTimeout(r, 20)); } return ok(); };
const sondeScan = async (chemin: string): Promise<Probe | null> => (/Maree/.test(chemin) ? { duree: 5400, largeur: 3840, hauteur: 2160, codecs: ['hevc'], audio: ['aac', 'aac'], sousTitres: [] }
  : { duree: 6000, largeur: 1920, hauteur: 1080, codecs: ['h264'], audio: ['aac', 'aac'], sousTitres: [{ langue: 'fre', index: 3 }] });
const octets = (f: string, n = 2048) => writeFileSync(f, Buffer.alloc(n, 7));
/** Un lien (fichier) ou une jonction (dossier) ; false si cette machine ne permet pas d'en créer (l'essai le dit). */
const lier = (cible: string, lien: string, dossier = false): boolean => { try { symlinkSync(cible, lien, dossier ? 'junction' : 'file'); return true; } catch { return false; } };

before(async () => {
  for (const d of [home, phare, maree, secret]) mkdirSync(d, { recursive: true });
  octets(join(phare, 'Le Phare (2020).mkv')); octets(join(maree, 'La Maree (2019).mkv'));
  ajouterDossier(mag(), films, 'films');
  await scanner(mag(), { ffprobe: sondeScan });
  brancher();
  odin = createServer((req, res) => { void venusRoute(req, res, new URL(req.url!, 'http://odin'), { home, proprietaire: () => true, fail: () => undefined, origin: 'http://odin', ip: '127.0.0.1', profil: 'moi' }).then((ok) => { if (!ok) { res.writeHead(404); res.end(); } }); });
  odin.listen(0, '127.0.0.1'); await once(odin, 'listening'); url = `http://127.0.0.1:${(odin.address() as AddressInfo).port}`;
});
after(() => { reglerOutilsPistes(); oublierSousTitres(); odin?.close(); oublierMagasins(); rmSync(racine, { recursive: true, force: true }); });

// ---------------------------------------------------------------- sous-titres piégés
test('un sous-titre piégé est lu en un passage : il ne fige pas Odin, et reste du texte', () => {
  const n = 150_000, tete = '1\n00:00:01,000 --> 00:00:02,000\n';
  for (const [nom, texte, ext] of [
    ['balises jamais fermées', `${tete}${'<a'.repeat(n)}\n`, '.srt'],
    ['commentaires jamais fermés', `${tete}${'<!--'.repeat(n)}\n`, '.srt'],
    ['styles jamais fermés', `${tete}${'{\\'.repeat(n)}\n`, '.vtt'],
    ['accolades ASS jamais fermées', `[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,D,,0,0,0,,${'{'.repeat(n)}\n`, '.ass'],
    ['dessin ASS jamais fermé', `[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,D,,0,0,0,,${'{x'.repeat(n)}\\p0\n`, '.ass'],
  ] as const) {
    const t0 = Date.now(), r = lireSousTitres(texte, ext), ms = Date.now() - t0;
    assert.ok(ms < 1500, `${nom} : ${ms} ms (avant la correction : des dizaines de secondes, des minutes à 2 Mo)`);
    assert.ok(r.length <= 1 && r.every((c) => c.texte.length <= 600), nom);
  }
  // Ce qui était retiré l'est toujours, ce qui n'est pas une balise reste du texte, en entités.
  const vtt = versVttSur(Buffer.from(`${tete}<i>un</i> {\\an8}deux <!-- caché --> 1 < 2 <b sans fin & A&nbsp;B\n\n2\n00:00:03,000 --> 00:00:04,000 position:10% region:r\n<script>alert(1)</script>trois\n`), '.srt');
  assert.equal(vtt, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nun deux 1 &lt; 2 &lt;b sans fin &amp; A B\n\n00:00:03.000 --> 00:00:04.000\nalert(1)trois\n');
  const assTexte = lireSousTitres('[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:05.50,0:00:07.00,D,,0,0,0,,{\\an8\\b1}Bonjour, {pas fermé\nDialogue: 0,0:00:08.00,0:00:09.00,D,,0,0,0,,{\\p1}m 0 0 l 100 0{\\p0}\n', '.ass');
  assert.deepEqual(assTexte, [{ debut: 5.5, fin: 7, texte: 'Bonjour, {pas fermé' }]);
});

test('le WebVTT écrit est borné : 2 Mo de « & » n’en font pas 10', () => {
  const src = Buffer.from(Array.from({ length: 3300 }, () => `00:00:01,000 --> 00:00:02,000\n${'&'.repeat(600)}\n`).join('\n'));
  assert.ok(src.length <= TAILLE_MAX);
  const vtt = versVttSur(src, '.srt');
  assert.ok(vtt.length <= TAILLE_MAX + 16, `écrit : ${vtt.length} octets`); assert.match(vtt, /^WEBVTT\n\n00:00:01\.000 --> 00:00:02\.000\n(&amp;){600}\n/);
});

// ---------------------------------------------------------------- liens vers ailleurs
test('à côté du film : un lien vers un autre endroit de la machine n’est ni listé, ni servi (sous-titre, bande-annonce)', async (t) => {
  writeFileSync(join(secret, 'notes.srt'), '1\n00:00:01,000 --> 00:00:02,000\nSECRET-D-AILLEURS\n');
  writeFileSync(join(secret, 'prive.mp4'), Buffer.from('....ftyp-SECRET-D-AILLEURS'));
  const film = join(phare, 'Le Phare (2020).mkv');
  // Un vrai fichier à côté reste servi.
  writeFileSync(join(phare, 'Le Phare (2020).fr.srt'), '1\n00:00:01,000 --> 00:00:02,000\nBonjour\n');
  assert.deepEqual(sousTitresACote(film).map((x) => x.langue), ['fr']);
  // Une jonction « Trailers » vers un autre dossier (possible sans droit particulier) : rien n'en sort.
  const jonction = lier(secret, join(phare, 'Trailers'), true);
  if (jonction) {
    assert.equal(bandeAnnonceLocale(film), undefined, 'dossier « Trailers » qui est un lien : ignoré');
    const r = await api(`/venus/bande-annonce/${enc(PHARE)}`); assert.equal(r.status, 404); assert.ok(!r.texte.includes('SECRET'));
    try { unlinkSync(join(phare, 'Trailers')); } catch { rmdirSync(join(phare, 'Trailers')); }
  }
  // Des liens de fichiers (il faut parfois un droit pour en créer : sinon cette partie est sautée, et c'est dit).
  const lienSrt = lier(join(secret, 'notes.srt'), join(phare, 'Le Phare (2020).en.srt')), lienBa = lier(join(secret, 'prive.mp4'), join(phare, 'Le Phare (2020)-trailer.mp4'));
  if (lienSrt) {
    assert.deepEqual(sousTitresACote(film).map((x) => x.langue), ['fr'], 'le sous-titre lié n’est pas listé');
    const liste = JSON.parse((await api(`/venus/api/pistes/${enc(PHARE)}`)).texte) as { subs: Array<{ id: string; source: string }> };
    for (const s of liste.subs.filter((x) => x.source === 'cote')) assert.ok(!(await api(`/venus/sous-titres/${enc(PHARE)}?piste=${s.id}`)).texte.includes('SECRET'));
  }
  if (lienBa) {
    assert.equal(bandeAnnonceLocale(film), undefined, 'bande-annonce liée : ignorée');
    const r = await api(`/venus/bande-annonce/${enc(PHARE)}`); assert.equal(r.status, 404); assert.ok(!r.texte.includes('SECRET'));
  }
  for (const f of ['Le Phare (2020).en.srt', 'Le Phare (2020)-trailer.mp4', 'Le Phare (2020).fr.srt']) rmSync(join(phare, f), { force: true });
  if (!jonction && !lienSrt && !lienBa) t.skip('cette machine ne permet de créer ni lien ni jonction');
  else if (!lienSrt || !lienBa) t.diagnostic('liens de fichiers impossibles ici : seule la jonction de dossier a été essayée');
});

// ---------------------------------------------------------------- files d'attente
test('une rafale ne s’empile pas derrière FFmpeg, et ouvrir un film n’attend pas une extraction', async () => {
  brancher(); appels.length = 0;
  const o = { delaiMs: 1000, maxOctets: 10 };
  const lourd = (lancerCourt as (...a: unknown[]) => Promise<Court & { refuse?: boolean }>);
  const rs = await Promise.all(Array.from({ length: 40 }, () => lourd('ffmpeg', ['rafale'], o, 'lourd')));
  const lancees = appels.filter((x) => x.args[0] === 'rafale').length;
  assert.ok(lancees <= 12, `${lancees} commandes lancées pour 40 demandes`);
  assert.equal(rs.filter((r) => r.refuse).length, 40 - lancees, 'les autres sont refusées, jamais lancées');
  // Une commande lourde tourne (500 ms) : lire les pistes d'un film n'attend pas sa fin.
  const lente = lourd('ffmpeg', ['LENT'], o, 'lourd'), t0 = Date.now();
  const l = await api(`/venus/api/lecture/${enc(PHARE)}`), ms = Date.now() - t0;
  assert.equal(l.status, 200); assert.ok(ms < 350, `le film s’ouvre en ${ms} ms pendant une commande lourde de 500 ms`);
  assert.deepEqual((JSON.parse(l.texte) as { audio: Array<{ lang: string }> }).audio.map((a) => a.lang), ['fre', 'eng']);
  await lente;
});

test('la même piste de sous-titres demandée en rafale : UNE extraction ; ratée : pas relancée à chaque demande', async () => {
  brancher(); oublierSousTitres(); appels.length = 0; vttRate = false;
  const rs = await Promise.all(Array.from({ length: 10 }, () => api(`/venus/sous-titres/${enc(PHARE)}?piste=i3`)));
  assert.ok(rs.every((r) => r.status === 200 && /Dans la vidéo/.test(r.texte)));
  assert.equal(appels.filter((x) => x.args.includes('webvtt')).length, 1, 'dix demandes en même temps : une extraction');
  oublierSousTitres(); appels.length = 0; vttRate = true;
  try {
    for (let k = 0; k < 4; k++) assert.equal((await api(`/venus/sous-titres/${enc(PHARE)}?piste=i3`)).texte, 'WEBVTT\n\n');
    assert.equal(appels.filter((x) => x.args.includes('webvtt')).length, 1, 'une extraction ratée n’est pas relancée à chaque demande');
  } finally { vttRate = false; oublierSousTitres(); }
});

test('pendant une conversion, rouvrir « Qualité » ne relance pas la mesure à chaque fois', async () => {
  brancher(); lances.length = 0; appels.length = 0; mesure = { 1080: 'coupe', 720: 5000, 480: 1000, 360: 500 };
  const r = await fetch(`${url}/venus/flux/${enc(PHARE)}?audio=1`); assert.equal(r.status, 200); assert.equal(conversionEnCours(), 'moi');
  const mesures = () => appels.filter((x) => x.args.at(-2) === 'null').length;
  const q1 = JSON.parse((await api(`/venus/api/qualites/${enc(MAREE)}`)).texte) as { qualites: Array<{ q: string; possible: boolean; raison?: string }> };
  assert.deepEqual(q1.qualites.map((x) => [x.q, x.possible, x.raison ?? '']), [['1080p', false, 'mesure plus tard'], ['720p', false, 'mesure plus tard'], ['480p', true, ''], ['360p', true, '']]);
  const n = mesures(); assert.equal(n, 3);
  for (let k = 0; k < 3; k++) assert.deepEqual(JSON.parse((await api(`/venus/api/qualites/${enc(MAREE)}`)).texte), q1);
  assert.equal(mesures(), n, 'pas remesuré tant que la conversion tourne');
  // La conversion finie : remesuré au repos, et retenu.
  await r.body!.cancel(); assert.ok(await attendreQue(() => conversionEnCours() === undefined));
  const q2 = JSON.parse((await api(`/venus/api/qualites/${enc(MAREE)}`)).texte) as typeof q1;
  assert.deepEqual(q2.qualites.map((x) => x.raison ?? ''), ['cette machine ne suit pas', 'cette machine ne suit pas', '', '']); assert.equal(mesures(), n + 3);
});

// ---------------------------------------------------------------- conversions sans lecteur
test('un lecteur parti avant le début : FFmpeg n’est pas lancé ; un tuyau fermé net ferme la réponse et libère la machine', async () => {
  brancher(); lances.length = 0;
  const partie = new PassThrough(); partie.on('error', () => undefined);
  Object.assign(partie, { writeHead() { return partie; }, flushHeaders() { /* rien */ }, socket: null });
  partie.destroy();
  const refus = diffuser(partie as never, 'moi', argsConversion(join(phare, 'Le Phare (2020).mkv'), { audio: 1 }));
  assert.ok(refus, 'refusé'); assert.equal(lances.length, 0, 'rien n’est lancé pour un lecteur déjà parti'); assert.equal(conversionEnCours(), undefined);
  // FFmpeg qui s'arrête net (son tuyau se ferme sans fin) : la réponse est fermée, la place est rendue.
  const r = await fetch(`${url}/venus/flux/${enc(PHARE)}?audio=1`); assert.equal(r.status, 200); assert.equal(lances.length, 1);
  lances[0].sortie.destroy();
  assert.ok(await attendreQue(() => conversionEnCours() === undefined, 1500), 'la place de conversion est rendue');
  await assert.rejects(r.text(), 'la réponse est fermée (le lecteur revient à l’original)');
  // Un point de départ démesuré dans l'adresse ne devient pas « 1e+308 » pour FFmpeg.
  const a = argsConversion(join(phare, 'Le Phare (2020).mkv'), { depuis: 1e308, audio: 1 });
  assert.match(a[a.indexOf('-ss') + 1], /^\d{1,6}$/);
});

// ---------------------------------------------------------------- le scan et les bandes-annonces
test('scan : une bande-annonce accompagne son film ; un vrai film dont le nom finit par « trailer » reste un film', async () => {
  writeFileSync(join(phare, 'Le Phare (2020)-trailer.mp4'), Buffer.from('....ftyp-bande-annonce'));
  const voyage = join(films, 'Voyage'), seul = join(films, 'Trailer (2015)');
  mkdirSync(voyage, { recursive: true }); mkdirSync(seul, { recursive: true });
  octets(join(voyage, 'Nuit.Blanche.Trailer.mkv')); octets(join(seul, 'trailer.mkv'));
  await scanner(mag(), { ffprobe: sondeScan });
  const titres = bibliotheque(mag(), { type: 'film' }).map((c) => c.titre.toLowerCase()).sort();
  assert.ok(titres.some((x) => /nuit/.test(x)), `un film sans film à côté n’est pas une bande-annonce : ${titres.join(' | ')}`);
  assert.equal(titres.length, 4, `« trailer.mkv » seul dans son dossier est un film aussi : ${titres.join(' | ')}`);
  assert.equal(titres.filter((x) => /phare/.test(x)).length, 1, 'la bande-annonce du Phare n’est pas un second film');
  assert.equal(mag().get('oeuvres', PHARE)?.data.fichier, join(phare, 'Le Phare (2020).mkv'), 'le film garde son fichier');
  assert.equal(bandeAnnonceLocale(join(phare, 'Le Phare (2020).mkv')), join(phare, 'Le Phare (2020)-trailer.mp4'));
});

// ---------------------------------------------------------------- le clavier
test('la touche C ouvre « Audio et sous-titres » ; les autres touches ne changent pas', () => {
  const APP = new URL('../src/valhalla/venus/app/', import.meta.url);
  const ctx = vm.createContext({ window: {}, URLSearchParams, Intl });
  for (const f of ['planetes.js', 'lecteur.js']) vm.runInContext(readFileSync(new URL(f, APP), 'utf8'), ctx);
  const touche = (ctx.window as { VenusLecteur: { logique: { touche(e: Record<string, unknown>, s: Record<string, unknown>): { a: string } | null } } }).VenusLecteur.logique.touche;
  assert.equal(touche({ key: 'c' }, { uiOn: true })?.a, 'tracks'); assert.equal(touche({ key: 'c' }, {})?.a, 'tracks');
  assert.notEqual(touche({ key: 'c', ctrlKey: true }, { uiOn: true })?.a, 'tracks', 'Ctrl+C reste « copier »');
  assert.equal(touche({ key: 'm' }, {})?.a, 'mute'); assert.equal(touche({ key: 'Escape' }, {})?.a, 'back'); assert.equal(touche({ key: 'f' }, {})?.a, 'fs');
  assert.match(readFileSync(new URL('lecteur.js', APP), 'utf8'), /case 'tracks': if \(info\) openTracks\(\); break;/);
});
