// Vénus, la suite du lecteur (lot V2) côté Odin : pistes audio, qualités, sous-titres, bande-annonce.
// AUCUN vrai FFmpeg ni ffprobe : les commandes sont des lanceurs simulés, les « films » sont de petits fichiers d'octets.
//   - pistes audio : lues par UNE commande à la fois, aux arguments fixes ; un titre de piste piégé reste du texte court ;
//   - le choix de la piste est gardé PAR PROFIL (par sa langue) et retrouvé sur un autre fichier ;
//   - qualités : une qualité réduite n'est proposée que si la machine la produit (mesurée), sinon grisée avec sa raison ;
//   - conversion : dans un tuyau (jamais un fichier), UNE à la fois, coupée quand le lecteur s'en va ou que personne ne lit ;
//   - sous-titres : dans la vidéo et à côté (srt, vtt, ass), toujours réécrits en texte sûr ; images : dites illisibles ;
//   - la recherche en ligne : aucun service réglé, c'est dit, et rien ne part ;
//   - bande-annonce : seulement un fichier à côté du film ; sinon la raison ;
//   - aucun chemin de la machine dans ce qui part vers la page ; un non-propriétaire n'a rien.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { dirVenus, magasinVenus, oublierMagasins, type MagasinVenus } from '../src/valhalla/venus/base.ts';
import { ajouterDossier, estBandeAnnonce, scanner, type Probe } from '../src/valhalla/venus/bibliotheque.ts';
import { venusRoute } from '../src/valhalla/venus/routes.ts';
import { lectureComplete, reglerPreferences } from '../src/valhalla/venus/app/appli.ts';
import { argsConversion, argsMesure, argsSonde, choixDeFlux, conversionEnCours, diffuser, lireSonde, reglerOutilsPistes, verifierConversion, type Court, type Flux } from '../src/valhalla/venus/pistes.ts';
import { AUCUN_SERVICE, ecrireVtt, lireSousTitres, oublierSousTitres, sousTitresACote, texteSur, versVttSur, TAILLE_MAX } from '../src/valhalla/venus/sous-titres.ts';
import { bandeAnnonceLocale, nomDeBandeAnnonce } from '../src/valhalla/venus/bande-annonce.ts';

const racine = mkdtempSync(join(tmpdir(), 'venus-pistes-'));
const home = join(racine, 'home'), films = join(racine, 'Films'), phare = join(films, 'Le Phare (2020)'), seuls = join(films, 'Divers');
const car = (n: number) => String.fromCharCode(n);
const mag = (): MagasinVenus => magasinVenus(home, dirVenus(home));
const PHARE = 'film:le-phare-2020', MAREE = 'film:la-maree-2019', PETIT = 'film:petit-film-2018';

// ---------------------------------------------------------------- les faux FFmpeg et ffprobe
interface Appel { cmd: string; args: string[]; delaiMs: number; maxOctets: number }
const appels: Appel[] = []; let enVol = 0, maxEnVol = 0;
const lances: Array<{ args: string[]; sortie: PassThrough; tue: boolean; finir(): void }> = [];
/** Ce que « ffprobe » répond, par nom de fichier. Un titre de piste piégé pour Le Phare. */
const SONDES: Record<string, unknown> = {
  'Le Phare (2020).mkv': { streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264' },
    { index: 1, codec_type: 'audio', codec_name: 'ac3', channels: 6, tags: { language: 'fre', title: `VF <img src=x onerror=alert(1)>${car(0x2028)}5.1` }, disposition: { default: 1 } },
    { index: 2, codec_type: 'audio', codec_name: 'aac', channels: 2, tags: { language: 'eng', title: 'Original' }, disposition: { default: 0 } },
    { index: 3, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'fre', title: 'Forcés' }, disposition: { forced: 1 } },
    { index: 4, codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle', tags: { language: 'eng' } },
  ] },
  'La Maree (2019).mkv': { streams: [
    { index: 0, codec_type: 'video', codec_name: 'hevc' },
    { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2, tags: { language: 'en' } },
    { index: 2, codec_type: 'audio', codec_name: 'aac', channels: 2, tags: { language: 'fra' } },
  ] },
};
/** Les durées que « FFmpeg » met à convertir l'échantillon, par hauteur demandée (ms) ; « coupe » : jamais fini. */
let mesure: Record<number, number | 'coupe'> = { 720: 5000, 480: 1000, 360: 500 };
let ffmpegPresent = true;
const VTT_PIEGE = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Awa><script>alert(1)</script>Dans la vidéo &lt;b&gt;\n';
const court = async (cmd: 'ffprobe' | 'ffmpeg', args: string[], o: { delaiMs: number; maxOctets: number }): Promise<Court> => {
  appels.push({ cmd, args, ...o }); enVol++; maxEnVol = Math.max(maxEnVol, enVol);
  await new Promise((r) => setTimeout(r, 15));
  enVol--;
  const rep = (sortie: string, ms = 10): Court => ({ ok: true, coupe: false, sortie: Buffer.from(sortie), ms });
  if (args[0] === '-version') return ffmpegPresent ? rep('ffmpeg version essai') : { ok: false, coupe: false, sortie: Buffer.alloc(0), ms: 1 };
  if (cmd === 'ffprobe') { const s = Object.entries(SONDES).find(([n]) => args.at(-1)!.endsWith(n)); return s ? rep(JSON.stringify(s[1])) : { ok: false, coupe: false, sortie: Buffer.alloc(0), ms: 1 }; }
  const scale = /^scale=-2:(\d+)$/.exec(args[args.indexOf('-vf') + 1] ?? '');
  if (scale && args.at(-2) === 'null') { const m = mesure[Number(scale[1])]; return m === 'coupe' || m === undefined ? { ok: false, coupe: true, sortie: Buffer.alloc(0), ms: o.delaiMs } : rep('', m); }
  if (args.includes('webvtt')) return rep(VTT_PIEGE);
  return { ok: false, coupe: false, sortie: Buffer.alloc(0), ms: 1 };
};
const flux = (args: string[]): Flux => {
  const sortie = new PassThrough(); let finir!: () => void; const fin = new Promise<void>((ok) => { finir = ok; });
  const l = { args, sortie, tue: false, finir: () => { sortie.end(); finir(); } };
  lances.push(l);
  return { sortie, fin, tuer() { if (l.tue) return; l.tue = true; sortie.destroy(); finir(); } };
};
const brancher = (o: { sansLecteurMs?: number; pasMs?: number } = {}) => reglerOutilsPistes({ court, flux, ...o });

// ---------------------------------------------------------------- Odin (les vraies routes de Vénus)
let odin: Server, url = '', proprio = true;
const api = async (chemin: string, o: RequestInit = {}) => { const r = await fetch(`${url}${chemin}`, o); return { status: r.status, type: r.headers.get('content-type') ?? '', entetes: r.headers, texte: await r.text() }; };
const apiJson = async (chemin: string, o: RequestInit = {}) => { const r = await api(chemin, o); return { ...r, json: JSON.parse(r.texte) as Record<string, any> }; }; // eslint-disable-line @typescript-eslint/no-explicit-any
const attendreQue = async (ok: () => boolean, ms = 3000) => { for (let k = 0; k < ms / 20; k++) { if (ok()) return true; await new Promise((r) => setTimeout(r, 20)); } return ok(); };

before(async () => {
  mkdirSync(home, { recursive: true }); mkdirSync(phare, { recursive: true }); mkdirSync(seuls, { recursive: true });
  const octets = (f: string, n = 2048) => writeFileSync(f, Buffer.alloc(n, 7));
  octets(join(phare, 'Le Phare (2020).mkv'));
  writeFileSync(join(phare, 'Le Phare (2020)-trailer.mp4'), Buffer.from('....ftypisom-bande-annonce-du-phare'));
  writeFileSync(join(phare, 'Le Phare (2020).fr.srt'), `1\n00:00:01,000 --> 00:00:04,000\n<img src=x onerror="alert(1)">Bonjour &lt;script&gt;alert(2)&lt;/script&gt;\n<i>deux</i> 1 < 2 & 3\n`);
  writeFileSync(join(phare, 'Le Phare (2020).en.ass'), '[Script Info]\nTitle: x\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:05.50,0:00:07.00,Default,,0,0,0,,{\\an8\\b1}Hello, <script>x</script>world\\Nsecond line\nDialogue: 0,0:00:08.00,0:00:09.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0{\\p0}\n');
  writeFileSync(join(phare, 'Le Phare (2020) 2.srt'), '1\n00:00:01,000 --> 00:00:02,000\nUn autre film\n'); // « Le Phare (2020) 2 » : ce n'est pas un suffixe de langue, mais un nom voisin accepté
  writeFileSync(join(phare, 'Le Phare (2020)x.srt'), '1\n00:00:01,000 --> 00:00:02,000\nPas à lui\n');
  octets(join(seuls, 'La Maree (2019).mkv')); octets(join(seuls, 'Petit Film (2018).mp4'));
  ajouterDossier(mag(), films, 'films');
  const sondeScan = async (chemin: string): Promise<Probe | null> => (/trailer/.test(chemin) ? { duree: 90, largeur: 640, hauteur: 360, codecs: ['h264'], audio: ['aac'], sousTitres: [] }
    : /Phare/.test(chemin) ? { duree: 6000, largeur: 1920, hauteur: 1080, codecs: ['h264'], audio: ['ac3', 'aac'], sousTitres: [{ langue: 'fre', titre: 'Forcés', index: 3 }, { langue: 'eng', index: 4 }] }
      : /Maree/.test(chemin) ? { duree: 5400, largeur: 3840, hauteur: 2160, codecs: ['hevc'], audio: ['aac', 'aac'], sousTitres: [] }
        : { duree: 600, largeur: 640, hauteur: 360, codecs: ['h264'], audio: ['aac'], sousTitres: [] });
  await scanner(mag(), { ffprobe: sondeScan });
  brancher();
  odin = createServer((req, res) => { void venusRoute(req, res, new URL(req.url!, 'http://odin'), { home, proprietaire: () => proprio, fail: () => undefined, origin: 'http://odin', ip: '127.0.0.1', profil: 'moi' }).then((ok) => { if (!ok) { res.writeHead(404); res.end(); } }); });
  odin.listen(0, '127.0.0.1'); await once(odin, 'listening'); url = `http://127.0.0.1:${(odin.address() as AddressInfo).port}`;
});
after(() => { reglerOutilsPistes(); oublierSousTitres(); odin?.close(); oublierMagasins(); rmSync(racine, { recursive: true, force: true }); });

// ---------------------------------------------------------------- logique pure
test('arguments fixes : le fichier est UN argument après « -i », la sortie est un tuyau ou rien, jamais un fichier', () => {
  const piege = join(racine, 'Piege $(echo pwned) & ; -y.mkv');
  for (const a of [argsSonde(piege), argsConversion(piege, { depuis: 42, audio: 1, hauteur: 480 }), argsMesure(piege, 720, 12)]) {
    assert.equal(a[a.indexOf('-i') + 1], piege); assert.equal(a.filter((x) => x.includes('pwned')).length, 1);
    assert.equal(a[a.indexOf('-protocol_whitelist') + 1], 'file', 'seul le protocole « file » est lu');
  }
  const c = argsConversion(piege, { depuis: 42.9, audio: 1, hauteur: 480 });
  assert.equal(c.at(-1), 'pipe:1'); assert.deepEqual(c.slice(c.indexOf('-ss'), c.indexOf('-ss') + 2), ['-ss', '42']);
  assert.ok(c.includes('0:a:1?') && c.includes('scale=-2:480') && c.includes('-sn') && c.includes('-nostdin'));
  assert.ok(!c.includes('-y'), 'aucun « écraser un fichier » : rien n’est écrit sur le disque');
  // Sans qualité demandée : une vidéo déjà en H.264 est recopiée ; sinon elle est convertie à sa taille.
  assert.deepEqual(((a) => a.slice(a.indexOf('-c:v'), a.indexOf('-c:v') + 2))(argsConversion(piege, { audio: 2, probe: { duree: 1, codecs: ['h264'], audio: [], sousTitres: [] } })), ['-c:v', 'copy']);
  assert.ok(argsConversion(piege, { audio: 2, probe: { duree: 1, codecs: ['hevc'], audio: [], sousTitres: [] } }).includes('libx264'));
  // Une valeur piégée ne devient jamais une option : rang et départ sont des entiers bornés.
  assert.ok(argsConversion(piege, { audio: -3 as number, depuis: Number.NaN }).includes('0:a:0?'));
  const m = argsMesure(piege, 720, 12); assert.deepEqual(m.slice(-3), ['-f', 'null', '-'], 'la mesure n’écrit rien');
  assert.equal(choixDeFlux('1', '480p')!.hauteur, 480); assert.deepEqual(choixDeFlux(null, null), { audio: 0 });
  for (const [a, q] of [['-1', ''], ['1.5', ''], ['x', ''], ['0', '999'], ['0', '-vf'], ['64', '']]) assert.equal(choixDeFlux(a, q), undefined, `${a} / ${q}`);
});

test('ce que ffprobe répond : pistes audio et sous-titres ; un titre piégé reste un texte court sans balise', () => {
  const s = lireSonde(JSON.stringify(SONDES['Le Phare (2020).mkv']))!;
  assert.deepEqual(s.audio.map((a) => [a.ordre, a.codec, a.langue, a.canaux, a.defaut]), [[0, 'ac3', 'fre', 6, true], [1, 'aac', 'eng', 2, false]]);
  assert.ok(!/[<>]/.test(s.audio[0].titre) && !s.audio[0].titre.includes(car(0x2028)), s.audio[0].titre);
  assert.deepEqual(s.sousTitres.map((x) => [x.index, x.langue, x.force, x.texte]), [[3, 'fre', true, true], [4, 'eng', false, false]], 'les sous-titres en images ne sont pas du texte');
  assert.equal(lireSonde('pas du json'), undefined); assert.equal(lireSonde('{"streams":"x"}'), undefined);
  assert.equal(lireSonde(JSON.stringify({ streams: [{ codec_type: 'audio', codec_name: 'aac', tags: { language: '../../etc' } }] }))!.audio[0].langue, '', 'une langue qui n’est pas un code est ignorée');
});

test('sous-titres : srt, vtt et ass deviennent du TEXTE sûr (balises retirées, chevrons en entités), bornés', () => {
  const srt = versVttSur(Buffer.from(`1\n00:00:01,000 --> 00:00:04,000\n<img src=x onerror="alert(1)">Bonjour &lt;script&gt;alert(2)&lt;/script&gt;\n<i>deux</i> 1 < 2 & 3\n\n2\n00:00:05,000 --> 00:00:06,000\nA${car(0x2028)}B --> C\n`), '.srt');
  assert.match(srt, /^WEBVTT\n\n00:00:01\.000 --> 00:00:04\.000\nBonjour &lt;script&gt;alert\(2\)&lt;\/script&gt;\ndeux 1 &lt; 2 &amp; 3\n/);
  assert.ok(!/<|onerror/.test(srt.replace(/-->/g, '')), 'aucun chevron ouvrant ne reste');
  assert.match(srt, /00:00:05\.000 --> 00:00:06\.000\nA\nB --&gt; C\n/, 'un séparateur de ligne caché devient un retour simple ; « --> » dans le texte n’est plus une ligne de temps');
  const ass = lireSousTitres('[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:05.50,0:00:07.00,Default,,0,0,0,,{\\an8}Hello, <b>world</b>\\Nsecond\nDialogue: 0,0:00:08.00,0:00:09.00,D,,0,0,0,,{\\p1}m 0 0 l 1 0{\\p0}\n', '.ass');
  assert.deepEqual(ass, [{ debut: 5.5, fin: 7, texte: 'Hello, world\nsecond' }], 'les blocs de style partent, la virgule du texte reste, un dessin n’est pas une réplique');
  assert.deepEqual(lireSousTitres('WEBVTT\n\nNOTE x\n\n1\n00:01.000 --> 00:02.500 line:10%\n<v Awa>Salut</v>\n', '.vtt'), [{ debut: 1, fin: 2.5, texte: 'Salut' }]);
  assert.equal(texteSur('<scr<script>ipt>alert(1)</script>'), 'ipt>alert(1)'); assert.doesNotMatch(ecrireVtt([{ debut: 0, fin: 1, texte: texteSur('<scr<script>ipt>alert(1)</script>') }]), /<|>(?!\s*\d)/);
  // Codages : UTF-16 avec marque, ancien codage d'Europe de l'Ouest.
  assert.match(versVttSur(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nÉté\n', 'utf16le')]), '.srt'), /\nÉté\n/);
  assert.match(versVttSur(Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nd\xe9j\xe0\n', 'latin1'), '.srt'), /\ndéjà\n/);
  // Trop gros, format inconnu : rien (jamais le fichier recopié).
  assert.equal(versVttSur(Buffer.alloc(TAILLE_MAX + 1, 65), '.srt'), 'WEBVTT\n\n'); assert.equal(versVttSur(Buffer.from('{1}{2}texte'), '.sub'), 'WEBVTT\n\n');
  // À côté : même nom puis rien ou un suffixe ; « …x.srt » n'est pas à lui.
  const cote = sousTitresACote(join(phare, 'Le Phare (2020).mkv'));
  assert.deepEqual(cote.map((c) => [c.langue, c.ext]).sort(), [['', '.srt'], ['en', '.ass'], ['fr', '.srt']].sort());
  assert.ok(cote.every((c) => /^c[a-f0-9]{16}$/.test(c.id)));
});

test('bande-annonce : le fichier « -trailer » à côté du film ; « trailer.mp4 » seulement si le film est seul dans son dossier', () => {
  assert.equal(bandeAnnonceLocale(join(phare, 'Le Phare (2020).mkv')), join(phare, 'Le Phare (2020)-trailer.mp4'));
  assert.equal(bandeAnnonceLocale(join(seuls, 'La Maree (2019).mkv')), undefined);
  const d = join(racine, 'ba'); mkdirSync(join(d, 'seul', 'Trailers'), { recursive: true }); mkdirSync(join(d, 'deux'));
  writeFileSync(join(d, 'seul', 'Film.mkv'), 'x'); writeFileSync(join(d, 'seul', 'Trailers', 'a.mp4'), 'x');
  assert.equal(bandeAnnonceLocale(join(d, 'seul', 'Film.mkv')), join(d, 'seul', 'Trailers', 'a.mp4'));
  writeFileSync(join(d, 'seul', 'trailer.mp4'), 'x'); assert.equal(bandeAnnonceLocale(join(d, 'seul', 'Film.mkv')), join(d, 'seul', 'trailer.mp4'));
  for (const f of ['A.mkv', 'B.mkv', 'trailer.mp4', 'Autre-trailer.mp4']) writeFileSync(join(d, 'deux', f), 'x');
  assert.equal(bandeAnnonceLocale(join(d, 'deux', 'A.mkv')), undefined, 'deux films : « trailer.mp4 » n’est à personne');
  writeFileSync(join(d, 'deux', 'A-trailer.mp4'), ''); assert.equal(bandeAnnonceLocale(join(d, 'deux', 'A.mkv')), undefined, 'un fichier vide n’est pas une bande-annonce');
  // Le scan laisse la bande-annonce de côté : rangée comme un film, elle prendrait la place du film de même titre.
  assert.ok(estBandeAnnonce(join(films, 'Film-trailer.mp4')) && estBandeAnnonce(join(films, 'Trailers', 'x.mkv')) && estBandeAnnonce(join(films, 'bande-annonce.mp4')));
  assert.ok(!estBandeAnnonce(join(films, 'Le Parc Trailer.mkv')) && !estBandeAnnonce(join(films, 'Film-trailer.srt')) && !estBandeAnnonce(join(films, 'Film.mkv')));
  assert.equal(String(mag().get('oeuvres', PHARE)!.data.fichier), join(phare, 'Le Phare (2020).mkv'), 'le film garde son fichier');
  assert.deepEqual(mag().liste('oeuvres').map((o) => o.id).sort(), [MAREE, PHARE, PETIT].sort(), 'la bande-annonce n’est pas un titre de plus');
  assert.ok(nomDeBandeAnnonce('Film.Bande-Annonce.MP4') && nomDeBandeAnnonce('trailer.mkv') && !nomDeBandeAnnonce('Le Trailerpark.mkv') && !nomDeBandeAnnonce('Film-trailer.srt'));
});

// ---------------------------------------------------------------- sur les routes d'Odin
test('pistes audio : listées pour le lecteur, une commande à la fois, aucun chemin de la machine', async () => {
  appels.length = 0; maxEnVol = 0;
  const [a, b, c] = await Promise.all([apiJson(`/venus/api/lecture/${encodeURIComponent(PHARE)}`), apiJson(`/venus/api/lecture/${encodeURIComponent(MAREE)}`), apiJson(`/venus/api/pistes/${encodeURIComponent(PHARE)}`)]);
  assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(c.status, 200);
  assert.deepEqual(a.json.audio.map((x: Record<string, unknown>) => [x.order, x.codec, x.lang, x.channels]), [[0, 'ac3', 'fre', 6], [1, 'aac', 'eng', 2]]);
  assert.equal(a.json.audioSel, 0); assert.ok(!/[<>]/.test(a.json.audio[0].title));
  assert.equal(maxEnVol, 1, 'ffprobe : une commande à la fois');
  const sondes = appels.filter((x) => x.cmd === 'ffprobe');
  assert.equal(sondes.length, 2, 'une lecture par fichier, gardée ensuite'); assert.ok(sondes.every((x) => x.delaiMs <= 20_000 && x.maxOctets <= 512 * 1024), 'coupée au bout du délai, sortie bornée');
  for (const r of [a, b, c]) assert.ok(!r.texte.includes(racine) && !r.texte.includes(JSON.stringify(racine).slice(1, -1)) && !/Films|Divers|[A-Za-z]:\\\\|\.mkv|\.srt"|\.ass"|\.vtt"/.test(r.texte.replace(AUCUN_SERVICE, '')), `aucun chemin ni nom de fichier : ${r.texte.slice(0, 600)}`);
  // Un fichier que ffprobe ne lit pas : ce que le scan avait noté (les codecs), sans langue.
  const p = await apiJson(`/venus/api/lecture/${encodeURIComponent(PETIT)}`);
  assert.deepEqual(p.json.audio, [{ order: 0, codec: 'aac', lang: '', title: '', channels: 0, def: true }]);
});

test('le choix de la piste audio est gardé par profil, et retrouvé par sa langue sur un autre fichier', async () => {
  const sans = await apiJson('/venus/api/preferences', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio: 'eng' }) });
  assert.equal(sans.status, 403, 'une écriture sans l’en-tête d’Odin est refusée');
  const r = await apiJson('/venus/api/preferences', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ audio: 'eng' }) });
  assert.equal(r.json.preferences.audio, 'eng');
  assert.equal((await apiJson(`/venus/api/lecture/${encodeURIComponent(PHARE)}`)).json.audioSel, 1, 'la piste anglaise du Phare');
  assert.equal((await apiJson(`/venus/api/lecture/${encodeURIComponent(MAREE)}`)).json.audioSel, 0, '« en » et « eng » sont la même langue : la première piste de La Marée');
  // Un autre profil n'hérite pas de ce choix ; le sien (« fre ») retrouve « fra ».
  assert.equal((await lectureComplete(mag(), 'p:lina', PHARE))!.audioSel, 0);
  reglerPreferences(mag(), 'p:lina', { audio: 'fre' });
  assert.equal((await lectureComplete(mag(), 'p:lina', MAREE))!.audioSel, 1); assert.equal((await lectureComplete(mag(), 'moi', MAREE))!.audioSel, 0);
  // Une langue piégée n'est pas gardée.
  const mauvais = await apiJson('/venus/api/preferences', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ audio: '<script>' }) });
  assert.equal(mauvais.json.preferences.audio, 'eng');
  reglerPreferences(mag(), 'moi', { audio: '' });
  assert.equal((await apiJson(`/venus/api/lecture/${encodeURIComponent(PHARE)}`)).json.audioSel, 0, 'choix effacé : la piste du fichier');
});

test('qualités : réduite seulement si la machine la produit (mesuré une fois), sinon grisée avec sa raison', async () => {
  brancher(); appels.length = 0; mesure = { 720: 5000, 480: 1000, 360: 500 };
  const q = (await apiJson(`/venus/api/qualites/${encodeURIComponent(PHARE)}`)).json;
  assert.deepEqual(q.qualites.map((x: Record<string, unknown>) => [x.q, x.possible, x.raison ?? '']), [['1080p', false, 'l’original n’est pas plus grand'], ['720p', false, 'cette machine ne suit pas'], ['480p', true, ''], ['360p', true, '']]);
  const mesures = appels.filter((x) => x.args.at(-2) === 'null');
  assert.deepEqual(mesures.map((x) => x.args[x.args.indexOf('-vf') + 1]), ['scale=-2:720', 'scale=-2:480'], 'de la plus grande à la plus petite, arrêt à la première qui passe');
  assert.ok(mesures.every((x) => x.delaiMs <= 6000 && x.args.includes('-t') && !x.args.includes('-y')), 'quelques secondes du fichier, coupée vite, rien d’écrit');
  await apiJson(`/venus/api/qualites/${encodeURIComponent(PHARE)}`);
  assert.equal(appels.filter((x) => x.args.at(-2) === 'null').length, 2, 'pas remesuré');
  // Une machine qui ne finit pas la mesure : tout reste en « Originale ».
  brancher(); mesure = { 1080: 'coupe', 720: 'coupe', 480: 'coupe', 360: 'coupe' };
  const lent = (await apiJson(`/venus/api/qualites/${encodeURIComponent(MAREE)}`)).json;
  assert.ok(lent.qualites.every((x: Record<string, unknown>) => x.possible === false && x.raison === 'cette machine ne suit pas'), JSON.stringify(lent));
  const refus = await apiJson(`/venus/api/conversion/${encodeURIComponent(MAREE)}?audio=0&q=720`);
  assert.equal(refus.status, 409); assert.match(refus.json.error, /ne convertit pas assez vite[\s\S]*« Originale »/);
  // Un petit film : rien à réduire. Sans FFmpeg : dit, et rien n'est mesuré.
  assert.ok((await apiJson(`/venus/api/qualites/${encodeURIComponent(PETIT)}`)).json.qualites.every((x: Record<string, unknown>) => !x.possible && x.raison === 'l’original n’est pas plus grand'));
  brancher(); ffmpegPresent = false; appels.length = 0;
  try {
    const sans = (await apiJson(`/venus/api/qualites/${encodeURIComponent(PHARE)}`)).json;
    assert.deepEqual(sans.qualites.map((x: Record<string, unknown>) => x.raison), ['l’original n’est pas plus grand', 'FFmpeg introuvable', 'FFmpeg introuvable', 'FFmpeg introuvable']);
    assert.equal(appels.filter((x) => x.args.at(-2) === 'null').length, 0);
    assert.equal((await apiJson(`/venus/api/conversion/${encodeURIComponent(PHARE)}?audio=1`)).status, 503);
  } finally { ffmpegPresent = true; brancher(); mesure = { 720: 5000, 480: 1000, 360: 500 }; }
  // Ce que la machine sait faire n'est écrit nulle part : ni dans le dossier d'Odin, ni dans celui des films.
  const tout = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tout(join(d, e.name)) : [join(d, e.name)]));
  assert.ok(!tout(home).some((f) => /mesure|qualit|vitesse/i.test(f)), 'aucune mesure gardée dans un fichier');
});

test('conversion à la volée : dans un tuyau, reprise au même instant, UNE à la fois, coupée quand le lecteur s’en va', async () => {
  brancher(); lances.length = 0; const avant = readdirSync(phare).length;
  const ac = new AbortController();
  const r = await fetch(`${url}/venus/flux/${encodeURIComponent(PHARE)}?depuis=42&audio=1&q=480`, { signal: ac.signal });
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type') ?? '', /video\/mp4/);
  assert.equal(lances.length, 1); const l = lances[0];
  assert.equal(l.args.at(-1), 'pipe:1'); assert.equal(l.args[l.args.indexOf('-ss') + 1], '42', 'reprise au même instant');
  assert.ok(l.args.includes('0:a:1?') && l.args.includes('scale=-2:480')); assert.equal(l.args[l.args.indexOf('-i') + 1], join(phare, 'Le Phare (2020).mkv'));
  l.sortie.write(Buffer.from('octets-convertis'));
  const lecteur = r.body!.getReader(); assert.equal(Buffer.from((await lecteur.read()).value!).toString(), 'octets-convertis');
  assert.equal(conversionEnCours(), 'moi');
  // Un autre profil pendant ce temps : refusé, rien n'est lancé. Le même profil (un saut) : l'ancienne est arrêtée.
  const autre = await verifierConversion(mag(), PHARE, { cle: 'p:lina', audio: 1 });
  assert.ok(!('ok' in autre) && autre.code === 409 && /une seule à la fois/.test(autre.error), JSON.stringify(autre));
  assert.ok(diffuser({} as never, 'p:lina', []), 'un second lancement est refusé avant tout'); assert.equal(lances.length, 1);
  const r2 = await fetch(`${url}/venus/flux/${encodeURIComponent(PHARE)}?depuis=600&audio=1`);
  assert.equal(r2.status, 200); assert.equal(lances.length, 2); assert.equal(l.tue, true, 'la conversion d’avant est arrêtée');
  assert.equal(lances[1].args[lances[1].args.indexOf('-ss') + 1], '600'); assert.deepEqual(((a) => a.slice(a.indexOf('-c:v'), a.indexOf('-c:v') + 2))(lances[1].args), ['-c:v', 'copy'], 'autre piste audio seule : la vidéo H.264 est recopiée');
  // Mesurer pendant qu'une conversion tourne : ce qui passe est sûr ; ce qui ne passe pas n'est pas retenu (« mesure plus tard »).
  const charge = (await apiJson(`/venus/api/qualites/${encodeURIComponent(MAREE)}`)).json.qualites.map((x: Record<string, unknown>) => [x.q, x.possible, x.raison ?? '']);
  assert.deepEqual(charge, [['1080p', false, 'mesure plus tard'], ['720p', false, 'mesure plus tard'], ['480p', true, ''], ['360p', true, '']]);
  ac.abort(); await lecteur.cancel().catch(() => undefined);
  // Le lecteur s'en va : FFmpeg est arrêté tout de suite, la machine est libre.
  await r2.body!.cancel();
  assert.ok(await attendreQue(() => lances[1].tue && conversionEnCours() === undefined), 'coupée quand le lecteur ferme');
  const repos = (await apiJson(`/venus/api/qualites/${encodeURIComponent(MAREE)}`)).json.qualites.map((x: Record<string, unknown>) => x.raison ?? '');
  assert.deepEqual(repos, ['cette machine ne suit pas', 'cette machine ne suit pas', '', ''], 'au repos : remesuré, et cette fois retenu');
  assert.equal(readdirSync(phare).length, avant, 'aucun fichier temporaire à côté du film'); assert.ok(!existsSync(join(dirVenus(home), 'tmp')));
  // Demandes refusées : rien n'est lancé.
  for (const [q, code] of [['audio=7', 400], ['audio=0&q=720', 409], ['q=999', 400], ['audio=x', 400]] as const) assert.equal((await api(`/venus/flux/${encodeURIComponent(PHARE)}?${q}`)).status, code, q);
  assert.equal((await api(`/venus/flux/${encodeURIComponent('../../etc/passwd')}?audio=1`)).status, 404);
  assert.equal(lances.length, 2);
});

test('conversion coupée si plus personne ne lit, et à la fin normale la machine est libérée', async () => {
  brancher({ sansLecteurMs: 120, pasMs: 30 }); lances.length = 0;
  const r = await fetch(`${url}/venus/flux/${encodeURIComponent(PHARE)}?audio=1`);
  assert.equal(r.status, 200); assert.equal(conversionEnCours(), 'moi');
  assert.ok(await attendreQue(() => lances[0].tue), 'plus rien n’est lu : coupée'); assert.equal(conversionEnCours(), undefined);
  await r.body!.cancel().catch(() => undefined);
  brancher(); lances.length = 0; await new Promise((x) => setTimeout(x, 60));
  const r2 = await fetch(`${url}/venus/flux/${encodeURIComponent(PHARE)}?audio=1`);
  lances[0].sortie.write('fin'); lances[0].finir();
  assert.equal(await r2.text(), 'fin'); assert.ok(await attendreQue(() => conversionEnCours() === undefined)); assert.equal(lances[0].tue, false);
});

test('sous-titres : dans la vidéo et à côté, servis en texte sûr ; en images : illisibles ; rien d’autre n’est servi', async () => {
  brancher(); oublierSousTitres(); appels.length = 0;
  const l = (await apiJson(`/venus/api/lecture/${encodeURIComponent(PHARE)}`)).json;
  const subs = l.subs as Array<{ id: string; lang: string; title: string; forced: boolean; lisible: boolean; source: string }>;
  assert.deepEqual(subs.map((x) => [x.source, x.lang, x.forced, x.lisible]), [['fichier', 'fre', true, true], ['fichier', 'eng', false, false], ['cote', '', false, true], ['cote', 'en', false, true], ['cote', 'fr', false, true]]);
  const id = (source: string, lang: string) => subs.find((x) => x.source === source && x.lang === lang)!.id;
  const fr = await api(`/venus/sous-titres/${encodeURIComponent(PHARE)}?piste=${id('cote', 'fr')}`);
  assert.equal(fr.status, 200); assert.match(fr.type, /text\/vtt/); assert.equal(fr.entetes.get('x-content-type-options'), 'nosniff');
  assert.equal(fr.texte, 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nBonjour &lt;script&gt;alert(2)&lt;/script&gt;\ndeux 1 &lt; 2 &amp; 3\n');
  const en = await api(`/venus/sous-titres/${encodeURIComponent(PHARE)}?piste=${id('cote', 'en')}`);
  assert.equal(en.texte, 'WEBVTT\n\n00:00:05.500 --> 00:00:07.000\nHello, xworld\nsecond line\n', 'le fichier .ass est lu en texte : la balise part, ce qu’elle entourait reste du texte');
  // Une piste de la vidéo : extraite par la commande bornée, puis réécrite comme les autres.
  const dedans = await api(`/venus/sous-titres/${encodeURIComponent(PHARE)}?piste=i3`);
  assert.equal(dedans.texte, 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nalert(1)Dans la vidéo &lt;b&gt;\n', 'les balises partent ; ce qui reste est du texte, chevrons en entités');
  const ex = appels.filter((x) => x.args.includes('webvtt'));
  assert.equal(ex.length, 1); assert.ok(ex[0].args.includes('0:3') && ex[0].args.at(-1) === 'pipe:1' && ex[0].delaiMs <= 90_000 && ex[0].maxOctets <= TAILLE_MAX);
  await api(`/venus/sous-titres/${encodeURIComponent(PHARE)}?piste=i3`); assert.equal(appels.filter((x) => x.args.includes('webvtt')).length, 1, 'gardée : pas extraite deux fois');
  // Images, piste inconnue, identifiant piégé : rien.
  for (const p of ['i4', 'i9', 'c0000000000000000', '../../etc/passwd', 'i3;rm', `c${'a'.repeat(400)}`]) assert.equal((await api(`/venus/sous-titres/${encodeURIComponent(PHARE)}?piste=${encodeURIComponent(p)}`)).status, 404, p);
  // L'ancienne adresse (par langue) répond encore, avec la même réécriture.
  assert.match((await api(`/venus/sous-titres/${encodeURIComponent(PHARE)}?lang=fr`)).texte, /Dans la vidéo &lt;b&gt;/, 'la piste française de la vidéo');
  assert.match((await api(`/venus/sous-titres/${encodeURIComponent(PHARE)}?lang=en`)).texte, /Hello, xworld/, 'en anglais, la piste de la vidéo est en images : le fichier à côté est servi');
  assert.equal((await api(`/venus/sous-titres/${encodeURIComponent(PETIT)}`)).texte, 'WEBVTT\n\n');
});

test('chercher des sous-titres : un fichier posé à côté est trouvé sans scan ; en ligne : aucun service réglé, rien ne part', async () => {
  const vraiFetch = globalThis.fetch; const sorties: string[] = [];
  globalThis.fetch = ((u: string | URL | Request, i?: RequestInit) => { if (!String(u).startsWith(url)) sorties.push(String(u)); return vraiFetch(u, i); }) as typeof fetch;
  try {
    const avant = (await apiJson(`/venus/api/pistes/${encodeURIComponent(PHARE)}`)).json;
    assert.equal(avant.subs.length, 5); assert.equal(avant.enLigne.regle, false); assert.equal(avant.enLigne.texte, AUCUN_SERVICE); assert.match(AUCUN_SERVICE, /Aucun service de sous-titres n’est réglé/);
    writeFileSync(join(phare, 'Le Phare (2020).es.vtt'), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHola\n');
    const apres = (await apiJson(`/venus/api/pistes/${encodeURIComponent(PHARE)}`)).json;
    const nouveau = apres.subs.find((x: { lang: string }) => x.lang === 'es'); assert.ok(nouveau, 'trouvé à l’instant, sans nouveau scan');
    assert.match((await api(`/venus/sous-titres/${encodeURIComponent(PHARE)}?piste=${nouveau.id}`)).texte, /\nHola\n/);
    assert.deepEqual(sorties, [], 'rien n’est demandé à Internet');
  } finally { globalThis.fetch = vraiFetch; rmSync(join(phare, 'Le Phare (2020).es.vtt'), { force: true }); }
});

test('bande-annonce : le fichier à côté est servi par Odin ; sans fichier, la fiche dit pourquoi', async () => {
  const f = (await apiJson(`/venus/api/titre/${encodeURIComponent(PHARE)}`)).json;
  assert.deepEqual(f.bandeAnnonce, { local: true });
  const r = await fetch(`${url}/venus/bande-annonce/${encodeURIComponent(PHARE)}`, { headers: { range: 'bytes=4-7' } });
  assert.equal(r.status, 206); assert.match(r.headers.get('content-type') ?? '', /video\/mp4/); assert.equal(await r.text(), 'ftyp');
  const sans = (await apiJson(`/venus/api/titre/${encodeURIComponent(MAREE)}`)).json;
  assert.equal(sans.bandeAnnonce.local, false); assert.match(sans.bandeAnnonce.raison, /posez-en une à côté du film[\s\S]*aucune sur Internet/);
  assert.ok(!JSON.stringify(sans.bandeAnnonce).includes(racine) && !JSON.stringify(f.bandeAnnonce).includes('trailer.mp4'));
  for (const id of [MAREE, 'film:inconnu', '../../etc/passwd', `${PHARE}/../x`]) assert.equal((await api(`/venus/bande-annonce/${encodeURIComponent(id)}`)).status, 404, id);
});

test('réservé au propriétaire : un autre visiteur n’a ni pistes, ni qualités, ni conversion, ni bande-annonce', async () => {
  proprio = false; lances.length = 0;
  try {
    for (const c of [`/venus/api/pistes/${encodeURIComponent(PHARE)}`, `/venus/api/qualites/${encodeURIComponent(PHARE)}`, `/venus/api/conversion/${encodeURIComponent(PHARE)}?audio=1`, `/venus/flux/${encodeURIComponent(PHARE)}?audio=1`, `/venus/flux/${encodeURIComponent(PHARE)}?audio=1&cle=faux`, `/venus/sous-titres/${encodeURIComponent(PHARE)}?piste=i3`, `/venus/bande-annonce/${encodeURIComponent(PHARE)}`]) {
      assert.equal((await api(c)).status, 401, c);
    }
    assert.equal(lances.length, 0, 'aucune conversion lancée');
  } finally { proprio = true; }
});
