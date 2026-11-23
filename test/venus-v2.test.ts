// Vénus, lot V2 : le lecteur de Venus (public/js/views/player.js du dépôt, réécrit dans src/valhalla/venus/app/lecteur.js)
// dans l'interface de Venus d'Odin, sur un VRAI Odin et des médias fabriqués par ffmpeg (lavfi) :
//   - il s'ouvre depuis la fiche (« Lecture » → #/lecture/<cible>) et lit le flux d'Odin ;
//   - la reprise est gardée PAR PROFIL (un profil ne lit pas celle d'un autre) ;
//   - l'épisode suivant est proposé à la fin et se lance ; la fin d'un épisode le marque « vu » ;
//   - les raccourcis du dépôt (espace, flèches, M, < >, Z, Échap…) ;
//   - un sous-titre piégé (balises, entités) est affiché comme du TEXTE ;
//   - aucune adresse de la machine ne part vers la page du lecteur ; un profil enfant ne voit qu'un nom de fichier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { ficheEnfant } from '../src/valhalla/venus/app/appli.ts';
import { attendre, fenetre, FEl, FVideo, type Fenetre } from './venus-v2-dom.ts';

const APP = new URL('../src/valhalla/venus/app/', import.meta.url);
const lire = (f: string) => readFileSync(new URL(f, APP), 'utf8');
const SCRIPTS = () => [lire('planetes.js'), lire('lecteur.js'), lire('app.js')];
const MDP = 'une-riviere-calme-sous-la-lune-52';
type Fn = (...a: unknown[]) => unknown;
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x)) as X;

/** La logique pure du lecteur, sans navigateur. */
function logique(): Record<string, Fn> & { SPEEDS: number[] } {
  const ctx = vm.createContext({ window: {}, URLSearchParams, Intl });
  vm.runInContext(lire('planetes.js'), ctx); vm.runInContext(lire('lecteur.js'), ctx);
  return (ctx.window as { VenusLecteur: { logique: Record<string, Fn> & { SPEEDS: number[] } } }).VenusLecteur.logique;
}

test('raccourcis du dépôt : chaque touche fait ce que fait player.js', () => {
  const L = logique(), k = (key: string, s: Record<string, boolean> = {}, o: Record<string, unknown> = {}) => ici(L.touche({ key, ...o }, s));
  assert.deepEqual(k(' '), { a: 'toggle' }); assert.deepEqual(k('k'), { a: 'toggle' }); assert.deepEqual(k('MediaPlayPause'), { a: 'toggle' });
  assert.deepEqual(k('ArrowRight'), { a: 'seek', dt: 10, track: true }, 'commandes cachées : → avance de 10 s');
  assert.deepEqual(k('ArrowLeft'), { a: 'seek', dt: -10, track: true });
  assert.deepEqual(k('ArrowRight', { uiOn: true, onTrack: true }), { a: 'seek', dt: 10 }, 'sur la barre : → avance');
  assert.equal(k('ArrowRight', { uiOn: true }), null, 'commandes visibles, ailleurs : la flèche déplace le focus');
  assert.deepEqual(k('MediaFastForward'), { a: 'seek', dt: 30 });
  assert.deepEqual(k('n', { next: true }), { a: 'next' }); assert.equal(k('n'), null, 'pas d’épisode suivant : N ne fait rien');
  assert.deepEqual(k('P', { prev: true }, { shiftKey: true }), { a: 'prev' });
  assert.deepEqual(k('f'), { a: 'fs' }); assert.deepEqual(k('z'), { a: 'fit' }); assert.deepEqual(k('m'), { a: 'mute' });
  assert.deepEqual(k('>'), { a: 'speed', dir: 1 }); assert.deepEqual(k('<'), { a: 'speed', dir: -1 });
  assert.deepEqual(k(']', { chapters: true }), { a: 'chapter', dir: 1 }); assert.equal(k(']'), null, 'sans chapitres connus');
  assert.deepEqual(k('h', { cues: true }), { a: 'subdelay', d: 0.1 }); assert.deepEqual(k('g', { cues: true }), { a: 'subdelay', d: -0.1 });
  assert.deepEqual(k('ArrowUp'), { a: 'volume', d: 0.1 }); assert.deepEqual(k('s', { skip: true }), { a: 'skip' });
  assert.deepEqual(k('Escape'), { a: 'back' }); assert.deepEqual(k('Backspace'), { a: 'back' });
  assert.equal(L.vitesse(1, 1), 1.25); assert.equal(L.vitesse(2, 1), 2); assert.equal(L.vitesse(0.5, -1), 0.5);
  assert.equal(L.formatSuivant('contain'), 'cover'); assert.equal(L.formatSuivant('fill'), 'contain');
  // Reprise : rien sous 5 s, rien à la fin, rien si « depuis le début ».
  assert.equal(L.depart({ position: 12, duration: 30 }, false), 12); assert.equal(L.depart({ position: 12, duration: 30 }, true), 0);
  assert.equal(L.depart({ position: 3, duration: 30 }, false), 0); assert.equal(L.depart({ position: 29, duration: 30 }, false), 0);
  assert.equal(L.finProche(10, 30), true); assert.equal(L.finProche(100, 3600), false);
  assert.equal(L.fluxUrl('serie:a:s1e1', 12.7), '/venus/flux/serie%3Aa%3As1e1?depuis=12');
});

test('un sous-titre piégé reste du texte (parseVtt du dépôt)', () => {
  const L = logique();
  const c = ici(L.parseVtt('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<img src=x onerror="alert(1)">Salut &lt;script&gt;alert(2)&lt;/script&gt;\n<i>deux</i>\n')) as Array<{ start: number; end: number; text: string }>;
  assert.equal(c.length, 1); assert.equal(c[0].start, 1); assert.equal(c[0].end, 4);
  assert.equal(c[0].text, 'Salut <script>alert(2)</script>\ndeux', 'les balises sont retirées, les entités deviennent du texte');
});

test('un profil enfant ne voit qu’un nom de fichier, jamais un chemin de la machine', () => {
  const f = ficheEnfant({ titre: {}, tech: { fichier: join('D:', 'Films', 'Secret', 'Film.mp4'), taille: 3 } }) as { tech: { fichier: string } };
  assert.equal(f.tech.fichier, 'Film.mp4');
});

// --------------------------------------------------------------- sur un vrai Odin
const fabriquer = (f: string, s: number) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=duration=${s}:size=160x90:rate=5`, '-f', 'lavfi', '-i', `sine=duration=${s}`, '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', f]);
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
const lecteur = (F: Fenetre) => F.doc.body.querySelector('.player');
const video = (F: Fenetre) => F.doc.body.querySelector('.player video') as unknown as FVideo;
const bouton = (F: Fenetre, label: string) => F.doc.body.querySelector(`[aria-label="${label}"]`) as FEl;
const attendreQue = async (ok: () => boolean, ms = 4000) => { for (let k = 0; k < ms / 40; k++) { if (ok()) return true; await attendre(40); } return ok(); };

test('le lecteur de Venus dans Odin : depuis la fiche, reprise par profil, épisode suivant, « vu », raccourcis, sous-titre piégé', { timeout: 240_000 }, async () => {
  const fenetres: Fenetre[] = [], tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn }, medias = mkdtempSync(join(tmpdir(), 'venus-v2-'));
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  try {
    const films = join(medias, 'Films'), series = join(medias, 'Series'); mkdirSync(films); mkdirSync(join(series, 'Brume Lente'), { recursive: true });
    fabriquer(join(films, 'Essai Lumiere (2021).mp4'), 30);
    writeFileSync(join(films, 'Essai Lumiere (2021).fr.srt'), '1\n00:00:00,500 --> 00:00:29,000\n<img src=x onerror="window.__xss=1">Bonjour &lt;script&gt;window.__xss=2&lt;/script&gt;\n');
    for (const e of ['S01E01', 'S01E02', 'S01E03']) fabriquer(join(series, 'Brume Lente', `Brume Lente ${e}.mp4`), 30);
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['var', 'freyja'].includes(m.id)) }), va = valhallaOf()!;
    for (const [c, k] of [[films, 'films'], [series, 'series']]) assert.equal((await v.json('/venus/dossiers', { chemin: c, categorie: k })).status, 200);
    assert.equal(((await v.json('/venus/scan', {})).body.bilan as { oeuvres: number }).oeuvres, 2);
    assert.equal((await va.act('var', 'ajouter', { login: 'membre-v2', nom: 'Lina', groupes: 'invite', mot_de_passe: MDP })).ok, true);
    lierProprietaire(persona()!);
    const FILM = 'film:essai-lumiere-2021', E1 = 'serie:brume-lente:s1e1', E2 = 'serie:brume-lente:s1e2', E3 = 'serie:brume-lente:s1e3';
    const moi = { cookie: `${v.session}; venus_profil=moi` }, lina = { cookie: `${v.session}; venus_profil=p%3Amembre-v2` };

    // La page charge le lecteur de Venus (servi par Odin), plus le lecteur simple d'Odin.
    const page = await (await fetch(`${v.url}/venus/app/`, { headers: { cookie: v.session } })).text();
    assert.match(page, /src="\/venus\/app\/lecteur\.js"/); assert.doesNotMatch(page, /\/pages\/venus-lecteur\.js/);
    assert.equal((await fetch(`${v.url}/venus/app/lecteur.js`, { headers: { cookie: v.session } })).status, 200);
    // Ce que reçoit le lecteur : aucun chemin de la machine.
    const info = await v.json(`/venus/api/lecture/${encodeURIComponent(FILM)}`, undefined, moi);
    assert.equal(info.status, 200); assert.equal(info.body.title, 'Essai Lumiere'); assert.equal(info.body.mode, 'direct');
    assert.ok(!JSON.stringify(info.body).includes(medias) && !JSON.stringify(info.body).includes('Films'), 'aucun chemin de fichier');
    assert.equal((info.body.subs as unknown[]).length, 1, 'le sous-titre à côté du film est proposé');
    // Un membre de la famille (session à lui) n'ouvre pas le lecteur de Venus.
    let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' });
    r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
    r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: 'membre-v2', motdepasse: MDP }) });
    const m = cookieDe(await fetch(r.headers.get('location')!, { redirect: 'manual' }), 'odin_session');
    assert.equal((await v.json(`/venus/api/lecture/${encodeURIComponent(FILM)}`, undefined, { cookie: m })).status, 401);

    // ---- Depuis la fiche : « Lecture » mène à #/lecture/<cible>, le lecteur de Venus s'ouvre et lit le flux d'Odin.
    const F = await fenetre(v.url, moi.cookie, SCRIPTS()); fenetres.push(F);
    await F.aller(`#/titre/${encodeURIComponent(FILM)}`); await attendre(300);
    assert.match(F.app.innerHTML, new RegExp(`href="#/lecture/${encodeURIComponent(FILM)}"`), 'la fiche a son bouton « Lecture »');
    await F.aller(`#/lecture/${encodeURIComponent(FILM)}`);
    assert.ok(await attendreQue(() => !!video(F)?.src), 'le lecteur s’ouvre');
    const P = lecteur(F)!;
    assert.match(P.className, /\bplayer\b/); assert.equal(P.querySelector('.p-title')!.textContent, 'Essai Lumiere');
    for (const l of ['Reculer de 10 secondes', 'Lecture / pause', 'Avancer de 10 secondes', 'Audio et sous-titres', 'Vitesse de lecture', 'Mode nuit (son égalisé)', 'Diffuser sur un écran', 'Plein écran', 'Minuterie de sommeil', 'Format de l’image']) assert.ok(bouton(F, l), l);
    assert.equal(video(F).src, `/venus/flux/${encodeURIComponent(FILM)}`);
    assert.equal(F.location.hash, `#/titre/${encodeURIComponent(FILM)}`, 'la page d’où l’on vient reste dessous');
    const flux = await fetch(`${v.url}${video(F).src}`, { headers: { cookie: moi.cookie, range: 'bytes=0-1023' } });
    assert.equal(flux.status, 206); assert.match(flux.headers.get('content-type') ?? '', /video\/mp4/);
    assert.equal(Buffer.from(await flux.arrayBuffer()).subarray(4, 8).toString(), 'ftyp', 'le média fabriqué est lu');

    // ---- Sous-titre piégé : choisi dans « Audio et sous-titres », il s'affiche comme du texte.
    bouton(F, 'Audio et sous-titres').click(); await attendre(50);
    const choix = F.doc.body.querySelectorAll('.sheet .opt').find((b) => b.textContent.includes('Français'));
    assert.ok(choix, 'la langue du sous-titre est proposée'); choix!.click();
    const vid = video(F); vid.currentTime = 2;
    const couche = P.querySelector('.p-subs')!;
    assert.ok(await attendreQue(() => couche.textContent.length > 0), 'la réplique est affichée');
    assert.equal(couche.textContent, 'Bonjour <script>window.__xss=2</script>');
    assert.equal(couche.querySelectorAll('img').length + couche.querySelectorAll('script').length, 0, 'aucun élément venu du fichier');
    assert.match(couche.innerHTML, /&lt;script&gt;/); assert.equal(F.win.__xss, undefined);

    // ---- Raccourcis du dépôt, sur le vrai lecteur.
    vid.duration = 30; vid.emettre('loadedmetadata'); await vid.play();
    P.classList.remove('ui-on'); F.doc.activeElement = F.doc.body;
    F.doc.touche(' '); assert.equal(vid.paused, true, 'espace : pause');
    F.doc.touche('k'); assert.equal(vid.paused, false, 'K : lecture');
    P.classList.remove('ui-on'); vid.currentTime = 4; F.doc.touche('ArrowRight'); assert.equal(vid.currentTime, 14, '→ : +10 s');
    F.doc.touche('ArrowRight'); assert.equal(vid.currentTime, 24, 'sur la barre : encore +10 s');
    F.doc.touche('m'); assert.equal(vid.muted, true, 'M : son coupé'); F.doc.touche('m'); assert.equal(vid.muted, false);
    F.doc.touche('>'); assert.equal(vid.playbackRate, 1.25, '> : plus vite'); F.doc.touche('<'); assert.equal(vid.playbackRate, 1);
    F.doc.touche('z'); assert.equal(vid.style.objectFit, 'cover', 'Z : remplir');
    F.doc.touche('z'); F.doc.touche('z'); F.doc.touche('z'); assert.equal(vid.style.objectFit, 'contain');
    F.doc.touche('h'); assert.equal(P.querySelector('.p-osd')!.textContent, 'Sous-titres +0,1 s', 'H : sous-titres plus tard');

    // ---- Reprise par profil : la position part pour « moi », pas pour Lina.
    vid.currentTime = 12; vid.pause(); await attendre(400);
    assert.equal((await v.json(`/venus/api/lecture/${encodeURIComponent(FILM)}`, undefined, moi)).body.position, 12);
    assert.equal((await v.json(`/venus/api/lecture/${encodeURIComponent(FILM)}`, undefined, lina)).body.position, 0, 'Lina ne voit pas la reprise de l’autre profil');
    F.doc.touche('Escape'); await attendre(300);
    assert.equal(lecteur(F), null, 'Échap ferme le lecteur'); assert.equal(F.location.hash, `#/titre/${encodeURIComponent(FILM)}`);
    // Rouvert par « moi » : il repart à 12 s. Par Lina : du début.
    await F.aller(`#/lecture/${encodeURIComponent(FILM)}`); assert.ok(await attendreQue(() => !!video(F)?.src));
    video(F).emettre('loadedmetadata'); assert.equal(video(F).currentTime, 12, 'reprise là où « moi » en était');
    F.doc.touche('Escape'); await attendre(200);
    const FL = await fenetre(v.url, lina.cookie, SCRIPTS()); fenetres.push(FL);
    await FL.aller(`#/lecture/${encodeURIComponent(FILM)}`); assert.ok(await attendreQue(() => !!video(FL)?.src));
    video(FL).emettre('loadedmetadata'); assert.equal(video(FL).currentTime, 0, 'Lina part du début');
    FL.doc.touche('Escape'); await attendre(200);

    // ---- Épisode suivant, puis « vu » à la fin.
    await F.aller(`#/lecture/${encodeURIComponent(E1)}`); assert.ok(await attendreQue(() => !!video(F)?.src));
    assert.equal(lecteur(F)!.querySelector('.p-sub')!.textContent, 'S1 É1');
    assert.equal(bouton(F, 'Épisode suivant').hidden, false); assert.equal(bouton(F, 'Épisode précédent').hidden, true);
    assert.match(lecteur(F)!.querySelector('.p-below')!.textContent, /Saison 1, épisode 1[\s\S]*Épisode 2/, 'la zone sous la vidéo (téléphone tenu droit)');
    const v1 = video(F); v1.duration = 30; v1.currentTime = 20; v1.emettre('timeupdate');
    const nx = lecteur(F)!.querySelector('.p-next')!;
    assert.equal(nx.hidden, false, 'fin proche : l’épisode suivant est proposé'); assert.match(nx.textContent, /Épisode suivant · S1 É2/);
    nx.querySelector('.btn-play')!.click();
    assert.ok(await attendreQue(() => video(F)?.src === `/venus/flux/${encodeURIComponent(E2)}`), 'l’épisode 2 se lance');
    assert.equal(lecteur(F)!.querySelector('.p-sub')!.textContent, 'S1 É2');
    const v2 = video(F); v2.duration = 30; v2.currentTime = 30; v2.emettre('ended');
    assert.ok(await attendreQue(() => video(F)?.src === `/venus/flux/${encodeURIComponent(E3)}`), 'à la fin, l’épisode 3 enchaîne');
    await attendre(300);
    const fiche = (await v.json(`/venus/api/titre/${encodeURIComponent('serie:brume-lente')}`, undefined, moi)).body as { saisons: Array<{ episodes: Array<{ id: string; watched: boolean }> }> };
    const eps = Object.fromEntries(fiche.saisons[0].episodes.map((e) => [e.id, e.watched]));
    assert.equal(eps[E1], true, 'l’épisode 1, lancé vers le suivant, est vu'); assert.equal(eps[E2], true, 'l’épisode 2, fini, est vu'); assert.equal(eps[E3], false);
    assert.equal((await v.json(`/venus/api/titre/${encodeURIComponent('serie:brume-lente')}`, undefined, lina)).body.saisons && ((await v.json(`/venus/api/titre/${encodeURIComponent('serie:brume-lente')}`, undefined, lina)).body as typeof fiche).saisons[0].episodes.every((e) => !e.watched), true, 'rien de vu pour Lina');
    F.doc.touche('Escape'); await attendre(200);
  } finally {
    for (const x of fenetres) (x.win.VenusLecteur as { fermer(): void } | undefined)?.fermer();
    await tt.end(); Object.assign(console, orig); rmSync(medias, { recursive: true, force: true });
  }
});
