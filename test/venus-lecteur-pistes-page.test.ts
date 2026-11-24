// Vénus, la suite du lecteur (lot V2) à l'écran : le vrai lecteur (lecteur.js) et la vraie fiche (app.js) dans un faux
// navigateur, reliés à un VRAI Odin. AUCUN vrai FFmpeg ni ffprobe : lanceurs simulés, « films » de quelques octets.
//   - « Audio et sous-titres » liste les pistes du fichier (« Français · 5.1 ») ; en choisir une autre reprend la
//     lecture AU MÊME INSTANT, et le choix est gardé pour ce profil (retrouvé à la réouverture) ;
//   - « Qualité » : Auto, Originale, et les qualités réduites ; celles que la machine ne produit pas sont grisées, disent
//     pourquoi, et la lecture reste comme elle est ;
//   - une conversion qui s'arrête ramène à la piste et à la qualité d'origine, au même instant ;
//   - les sous-titres (dans la vidéo, à côté) s'affichent comme du TEXTE ; ceux en images sont grisés ;
//   - « Chercher des sous-titres » trouve un fichier posé à côté et dit « aucun service réglé » pour la recherche en ligne ;
//   - la fiche a son bouton « Bande-annonce » : actif avec un fichier à côté du film, sinon grisé avec sa raison ;
//   - Échap ferme une fenêtre du lecteur sans fermer le lecteur (clavier).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { dirVenus, magasinVenus } from '../src/valhalla/venus/base.ts';
import { ajouterDossier, scanner, type Probe } from '../src/valhalla/venus/bibliotheque.ts';
import { preferences } from '../src/valhalla/venus/app/appli.ts';
import { reglerOutilsPistes, type Court, type Flux } from '../src/valhalla/venus/pistes.ts';
import { oublierSousTitres } from '../src/valhalla/venus/sous-titres.ts';
import { attendre, fenetre, FEl, FVideo, type Fenetre } from './venus-v2-dom.ts';

const APP = new URL('../src/valhalla/venus/app/', import.meta.url);
const lire = (f: string) => readFileSync(new URL(f, APP), 'utf8');
const SCRIPTS = () => [lire('planetes.js'), lire('lecteur.js'), lire('app.js')];
const lecteur = (F: Fenetre) => F.doc.body.querySelector('.player');
const video = (F: Fenetre) => F.doc.body.querySelector('.player video') as unknown as FVideo;
const bouton = (F: Fenetre, label: string) => F.doc.body.querySelector(`[aria-label="${label}"]`) as FEl;
const lignes = (F: Fenetre) => F.doc.body.querySelectorAll('.sheet .opt');
const ligne = (F: Fenetre, texte: string | RegExp) => lignes(F).find((b) => (typeof texte === 'string' ? b.textContent.includes(texte) : texte.test(b.textContent)));
const attendreQue = async (ok: () => boolean, ms = 4000) => { for (let k = 0; k < ms / 40; k++) { if (ok()) return true; await attendre(40); } return ok(); };
const message = (F: Fenetre) => F.doc.body.querySelector('.toast')?.innerHTML ?? '';
/** Un appui sur un bouton de la page d'app.js (ses boutons sont écrits en texte : le clic est celui d'un bouton pareil). */
const agir = (F: Fenetre, act: string, v: string) => { const b = new FEl(F.doc, 'button'); b.setAttribute('data-act', act); b.dataset.act = act; b.dataset.v = v; F.doc.body.append(b); b.click(); b.remove(); };

const SONDES: Record<string, unknown> = {
  'Deux Voix (2021).mp4': { streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264' },
    { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 6, tags: { language: 'fre' }, disposition: { default: 1 } },
    { index: 2, codec_type: 'audio', codec_name: 'aac', channels: 2, tags: { language: 'eng', title: 'Version originale' } },
    { index: 3, codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle', tags: { language: 'eng' } },
  ] },
};
const court = async (cmd: 'ffprobe' | 'ffmpeg', args: string[], o: { delaiMs: number }): Promise<Court> => {
  const rep = (sortie: string, ms = 5): Court => ({ ok: true, coupe: false, sortie: Buffer.from(sortie), ms });
  if (args[0] === '-version') return rep('ffmpeg version essai');
  if (cmd === 'ffprobe') { const s = Object.entries(SONDES).find(([n]) => args.at(-1)!.endsWith(n)); return s ? rep(JSON.stringify(s[1])) : { ok: false, coupe: false, sortie: Buffer.alloc(0), ms: 1 }; }
  const h = Number(/^scale=-2:(\d+)$/.exec(args[args.indexOf('-vf') + 1] ?? '')?.[1] ?? 0);
  // La machine simulée suit en 480p et en 360p, pas en 720p.
  if (h && args.at(-2) === 'null') return h >= 720 ? { ok: false, coupe: true, sortie: Buffer.alloc(0), ms: o.delaiMs } : rep('', 900);
  return { ok: false, coupe: false, sortie: Buffer.alloc(0), ms: 1 };
};
const flux = (): Flux => { const sortie = new PassThrough(); let finir!: () => void; const fin = new Promise<void>((ok) => { finir = ok; }); return { sortie, fin, tuer() { sortie.destroy(); finir(); } }; };

test('le lecteur de Venus : pistes audio, qualités, sous-titres, recherche, bande-annonce, clavier', { timeout: 180_000 }, async () => {
  const fenetres: Fenetre[] = [], tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn }, medias = mkdtempSync(join(tmpdir(), 'venus-pistes-page-'));
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  try {
    const films = join(medias, 'Films'), voix = join(films, 'Deux Voix (2021)'), autres = join(films, 'Autres'); mkdirSync(voix, { recursive: true }); mkdirSync(autres);
    writeFileSync(join(voix, 'Deux Voix (2021).mp4'), Buffer.alloc(4096, 3));
    writeFileSync(join(voix, 'Deux Voix (2021)-trailer.mp4'), Buffer.from('....ftypisom-bande-annonce'));
    writeFileSync(join(voix, 'Deux Voix (2021).fr.srt'), '1\n00:00:00,500 --> 00:01:29,000\n<img src=x onerror="window.__xss=1">Bonjour &lt;script&gt;window.__xss=2&lt;/script&gt;\n<i>deux</i> 1 < 2\n');
    writeFileSync(join(autres, 'Sans Rien (2019).mp4'), Buffer.alloc(2048, 4)); writeFileSync(join(autres, 'Autre Film (2018).mp4'), Buffer.alloc(2048, 5));
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['var', 'freyja'].includes(m.id)) });
    const home = v.o.paths.home, mag = magasinVenus(home, dirVenus(home));
    ajouterDossier(mag, films, 'films');
    await scanner(mag, { ffprobe: async (chemin): Promise<Probe | null> => (/trailer/.test(chemin) ? null : /Deux Voix/.test(chemin)
      ? { duree: 6000, largeur: 1920, hauteur: 1080, codecs: ['h264'], audio: ['aac', 'aac'], sousTitres: [{ langue: 'eng', index: 3 }] }
      : { duree: 600, largeur: 640, hauteur: 360, codecs: ['h264'], audio: ['aac'], sousTitres: [] }) });
    reglerOutilsPistes({ court, flux }); oublierSousTitres();
    const VOIX = 'film:deux-voix-2021', SANS = 'film:sans-rien-2019', moi = `${v.session}; venus_profil=moi`, enc = encodeURIComponent;

    // ---- La fiche : « Bande-annonce » actif avec le fichier à côté ; sinon grisé, avec sa raison ; jamais un chemin.
    const F = await fenetre(v.url, moi, SCRIPTS()); fenetres.push(F);
    // (le faux navigateur ne lit pas le contenu écrit d'une fenêtre d'app.js : le focus qu'elle pose n'y trouve rien)
    F.win.requestAnimationFrame = (f: () => void) => setTimeout(() => { try { f(); } catch { /* rien à viser dans le faux navigateur */ } }, 0);
    await F.aller(`#/titre/${enc(VOIX)}`); await attendre(300);
    assert.match(F.app.innerHTML, new RegExp(`<button class="btn btn-ghost f" data-act="trailer" data-v="${VOIX}">[\\s\\S]{0,400}Bande-annonce</button>`));
    assert.ok(!F.app.innerHTML.includes('trailer.mp4') && !F.app.innerHTML.includes(`${medias}\\Films\\Deux Voix (2021)\\Deux Voix (2021)-trailer`), 'aucun chemin de la bande-annonce');
    agir(F, 'trailer', VOIX);
    const fen = F.doc.body.querySelector('.sheet-wrap'); assert.ok(fen, 'la fenêtre « Bande-annonce » s’ouvre');
    assert.match(fen!.innerHTML, new RegExp(`aria-label="Bande-annonce"[\\s\\S]*<video class="trailer-video" controls autoplay playsinline src="/venus/bande-annonce/${enc(VOIX)}"`));
    const ba = await fetch(`${v.url}/venus/bande-annonce/${enc(VOIX)}`, { headers: { cookie: moi, range: 'bytes=4-7' } });
    assert.equal(ba.status, 206); assert.equal(await ba.text(), 'ftyp', 'servie par Odin, depuis le fichier à côté du film');
    agir(F, 'closesheet', ''); assert.equal(F.doc.body.querySelector('.sheet-wrap'), null);
    await F.aller(`#/titre/${enc(SANS)}`); await attendre(300);
    const grise = /<button class="btn btn-ghost f" aria-disabled="true" title="([^"]+)" data-act="notrailer"[^>]*>[\s\S]{0,400}Bande-annonce<\/button>/.exec(F.app.innerHTML);
    assert.ok(grise, 'sans fichier : le bouton reste, grisé'); assert.match(grise![1], /posez-en une à côté du film[\s\S]*aucune sur Internet/);
    agir(F, 'notrailer', grise![1]); assert.match(message(F), /Pas de bande-annonce : posez-en une à côté du film/, 'l’appui dit pourquoi');
    assert.equal((await fetch(`${v.url}/venus/bande-annonce/${enc(SANS)}`, { headers: { cookie: moi } })).status, 404);

    // ---- Le lecteur : les pistes audio du fichier.
    await F.aller(`#/lecture/${enc(VOIX)}`);
    assert.ok(await attendreQue(() => !!video(F)?.src), 'le lecteur s’ouvre');
    const P = lecteur(F)!, vid = video(F);
    assert.equal(vid.src, `/venus/flux/${enc(VOIX)}`, 'lu tel quel, piste d’origine'); assert.match(P.querySelector('.p-mode')!.className, /\bok\b/);
    vid.duration = 6000; vid.emettre('loadedmetadata'); await vid.play(); vid.currentTime = 42; vid.emettre('timeupdate');
    bouton(F, 'Audio et sous-titres').click(); await attendre(50);
    assert.match(ligne(F, 'Français · 5.1')!.className, /\bon\b/, 'la piste lue est cochée'); assert.match(ligne(F, 'Anglais · Stéréo')!.textContent, /Version originale · AAC/);
    assert.equal(lignes(F).some((b) => /bientôt/.test(b.textContent)), false, 'plus aucun « bientôt » dans cette fenêtre');
    // Clavier : Échap ferme la fenêtre, pas le lecteur.
    F.doc.touche('Escape'); assert.equal(F.doc.body.querySelector('.sheet'), null); assert.ok(lecteur(F), 'le lecteur reste ouvert');
    bouton(F, 'Audio et sous-titres').click(); await attendre(50);
    ligne(F, 'Anglais · Stéréo')!.click();
    assert.ok(await attendreQue(() => video(F).src === `/venus/flux/${enc(VOIX)}?depuis=42&audio=1`), `autre piste : reprise au même instant (${video(F).src})`);
    assert.match(P.querySelector('.p-mode')!.className, /\bconv\b/, 'la pastille dit « conversion »'); assert.match(message(F), /Audio : Anglais · Stéréo/);
    assert.equal(P.querySelector('.p-timeline')!.children[0].textContent, '0:42', 'la barre reste à 0:42');
    assert.ok(await attendreQue(() => preferences(mag, 'moi').audio === 'eng'), 'le choix est gardé pour ce profil'); assert.equal(preferences(mag, 'p:lina').audio, undefined);

    // ---- Qualité : Auto, Originale, et seulement ce que la machine produit.
    vid.currentTime = 10; vid.emettre('timeupdate'); // 52 s du film (le flux converti est reparti de 42 s)
    P.querySelector('.p-mode')!.click();
    assert.ok(await attendreQue(() => !!ligne(F, /^360p/)), 'les qualités mesurées arrivent');
    assert.deepEqual(lignes(F).map((b) => [b.textContent.replace(/(Auto|Originale|\d+p)/, '$1|').split('|')[0], b.getAttribute('aria-disabled') === 'true']), [['Auto', false], ['Originale', false], ['1080p', true], ['720p', true], ['480p', false], ['360p', false]]);
    assert.match(ligne(F, /^1080p/)!.textContent, /l’original n’est pas plus grand/); assert.match(ligne(F, /^720p/)!.textContent, /cette machine ne suit pas/);
    assert.match(ligne(F, /^Auto/)!.className, /\bon\b/);
    ligne(F, /^720p/)!.click(); await attendre(80);
    assert.match(message(F), /Qualité 720p : Cette machine ne convertit pas assez vite/, 'grisée : elle dit pourquoi');
    assert.equal(video(F).src, `/venus/flux/${enc(VOIX)}?depuis=42&audio=1`, 'la lecture reste comme elle est'); assert.ok(F.doc.body.querySelector('.sheet'), 'la fenêtre reste ouverte');
    ligne(F, /^480p/)!.click();
    assert.ok(await attendreQue(() => video(F).src === `/venus/flux/${enc(VOIX)}?depuis=52&audio=1&q=480`), `qualité réduite : reprise au même instant, même piste (${video(F).src})`);
    assert.equal(P.querySelector('.p-mode-q')!.textContent, '480p');
    // Une demande que la machine refuse à Odin directement : rien ne part, la raison est donnée.
    const refus = await v.json(`/venus/api/conversion/${enc(VOIX)}?audio=1&q=720`, undefined, { cookie: moi });
    assert.equal(refus.status, 409); assert.match(String(refus.body.error), /« Originale »/);
    // Une conversion qui s'arrête : retour à l'original, au même instant.
    video(F).currentTime = 8; video(F).emettre('timeupdate'); video(F).emettre('error');
    assert.ok(await attendreQue(() => video(F).src === `/venus/flux/${enc(VOIX)}`), 'retour à la piste et à la qualité d’origine');
    assert.match(message(F), /La conversion s’est arrêtée/); assert.equal(P.querySelector('.p-mode-q')!.textContent, '1080p');
    video(F).emettre('loadedmetadata'); assert.equal(video(F).currentTime, 60, 'au même instant (52 s + 8 s)');
    assert.equal(lecteur(F)!.querySelector('.p-error')!.hidden, true, 'pas d’écran d’erreur');

    // ---- Sous-titres : dans la vidéo (images : grisés), à côté (texte sûr).
    bouton(F, 'Audio et sous-titres').click(); await attendre(50);
    const images = lignes(F).find((b) => /en images/.test(b.textContent))!;
    assert.equal(images.getAttribute('aria-disabled'), 'true'); images.click(); assert.match(message(F), /des images, pas du texte/);
    const fr = lignes(F).find((b) => /^Français/.test(b.textContent) && /SRT/.test(b.textContent)); assert.ok(fr, 'le fichier posé à côté est proposé'); fr!.click();
    video(F).currentTime = 2;
    const couche = lecteur(F)!.querySelector('.p-subs')!;
    assert.ok(await attendreQue(() => couche.textContent.length > 0), 'la réplique est affichée');
    assert.equal(couche.textContent, 'Bonjour <script>window.__xss=2</script>deux 1 < 2');
    assert.equal(couche.querySelectorAll('img').length + couche.querySelectorAll('script').length + couche.querySelectorAll('i').length, 0, 'aucun élément venu du fichier');
    assert.equal(F.win.__xss, undefined);

    // ---- Chercher des sous-titres : à côté (sans scan) ; en ligne : aucun service réglé.
    writeFileSync(join(voix, 'Deux Voix (2021).es.vtt'), 'WEBVTT\n\n00:00:01.000 --> 00:00:09.000\nHola\n');
    bouton(F, 'Audio et sous-titres').click(); await attendre(50);
    ligne(F, 'Chercher des sous-titres')!.click();
    assert.ok(await attendreQue(() => !!ligne(F, 'Espagnol')), 'le fichier posé à l’instant est trouvé');
    const feuille = F.doc.body.querySelector('.sheet')!;
    assert.equal(feuille.getAttribute('aria-label'), 'Chercher des sous-titres'); assert.match(ligne(F, 'Espagnol')!.textContent, /Trouvé à l’instant/);
    assert.match(feuille.textContent, /En ligne[\s\S]*Aucun service de sous-titres n’est réglé dans Odin : rien n’est cherché sur Internet\./);
    assert.equal(lignes(F).some((b) => /en images/.test(b.textContent)), false, 'seuls les sous-titres lisibles sont proposés ici');
    ligne(F, 'Espagnol')!.click(); video(F).currentTime = 3;
    assert.ok(await attendreQue(() => couche.textContent === 'Hola'), 'le sous-titre trouvé s’affiche');

    // ---- Réouverture : la piste choisie par ce profil est reprise d'entrée.
    F.doc.touche('Escape'); await attendre(300); assert.equal(lecteur(F), null, 'Échap ferme le lecteur');
    await F.aller(`#/lecture/${enc(VOIX)}`);
    assert.ok(await attendreQue(() => !!video(F)?.src));
    assert.match(video(F).src, new RegExp(`^/venus/flux/${enc(VOIX).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?(?:depuis=\\d+&)?audio=1$`), `la piste anglaise d’entrée (${video(F).src})`);
    F.doc.touche('Escape'); await attendre(200);
  } finally {
    for (const x of fenetres) (x.win.VenusLecteur as { fermer(): void } | undefined)?.fermer();
    reglerOutilsPistes(); oublierSousTitres();
    await tt.end(); Object.assign(console, orig); rmSync(medias, { recursive: true, force: true });
  }
});
