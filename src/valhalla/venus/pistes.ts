// Vénus · le lecteur, la suite du lot V2 : les PISTES AUDIO d'un fichier et les QUALITÉS qu'Odin sait vraiment produire.
//
//   - pistesDe      : les pistes audio et de sous-titres du fichier, lues par ffprobe (langue, titre, canaux) ;
//   - qualitesDe    : « Originale », et une qualité réduite seulement si CETTE machine la convertit plus vite que la
//                     lecture (mesurée sur quelques secondes du fichier lui-même, jamais devinée) ;
//   - servirConversion : la conversion à la volée d'une autre piste audio ou d'une qualité réduite.
//
// Sûreté et sobriété. FFmpeg et ffprobe sont lancés avec des arguments FIXES (aucun interprète de commandes), seulement
// sur un fichier que la bibliothèque connaît déjà (videoVerifiee : chemin complet, présent, une vidéo), avec une entrée
// qui n'accepte que le protocole « file ». Les commandes courtes passent par deux files, UNE commande à la fois dans
// chacune : les légères (lire les pistes : quelques dizaines de millisecondes) et les lourdes (mesure, extraction de
// sous-titres), pour qu'ouvrir un film n'attende pas 90 s derrière une extraction. Elles sont coupées au bout de leur
// délai, leur sortie est bornée, et au-delà de quelques commandes en attente les suivantes sont refusées (une rafale de
// demandes ne fait pas tourner FFmpeg pendant des heures). La conversion longue est UNE à
// la fois pour toute la maison, coupée dès que le lecteur s'en va ou que plus personne ne lit, et sort dans un tuyau :
// jamais un fichier temporaire, rien n'est écrit sur le disque. Ce qui est mesuré de la machine reste en mémoire : ni
// dans le dépôt, ni dans un fichier. Aucun chemin de la machine ne part vers la page.
import { spawn } from 'node:child_process';
import type { ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';
import type { MagasinVenus } from './base.ts';
import { fichierDeCible, type Probe } from './bibliotheque.ts';
import { entreeFfmpeg } from '../../files/ffmpeg-entree.ts';
import { instantVignette, videoVerifiee } from './vignettes.ts';

// ---------------------------------------------------------------- les outils (injectables : les essais passent des faux)
/** Le résultat d'une commande courte : réussie ou non, coupée (délai ou sortie trop longue), sa sortie, sa durée. */
export interface Court { ok: boolean; coupe: boolean; sortie: Buffer; ms: number; /** jamais lancée : trop de commandes attendaient déjà */ refuse?: boolean }
/** Une conversion longue : sa sortie (un tuyau), de quoi l'arrêter, et sa fin. */
export interface Flux { sortie: Readable; tuer(): void; fin: Promise<void> }
export interface OutilsPistes {
  court(cmd: 'ffprobe' | 'ffmpeg', args: string[], o: { delaiMs: number; maxOctets: number }): Promise<Court>;
  flux(args: string[]): Flux;
}
const courtReel: OutilsPistes['court'] = (cmd, args, o) => new Promise((rendre) => {
  const t0 = Date.now(), parts: Buffer[] = []; let fini = false, coupe = false, n = 0, t: NodeJS.Timeout | undefined;
  const fin = (ok: boolean) => { if (fini) return; fini = true; clearTimeout(t); rendre({ ok: ok && !coupe, coupe, sortie: Buffer.concat(parts), ms: Date.now() - t0 }); };
  try {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, shell: false });
    const tuer = () => { coupe = true; try { p.kill('SIGKILL'); } catch { /* déjà fini */ } };
    t = setTimeout(tuer, o.delaiMs); t.unref?.();
    p.stdout.on('data', (b: Buffer) => { if (coupe) return; n += b.length; if (n > o.maxOctets) { tuer(); return; } parts.push(b); });
    p.on('error', () => fin(false));
    p.on('close', (code) => fin(code === 0));
  } catch { fin(false); }
});
const fluxReel: OutilsPistes['flux'] = (args) => {
  const p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, shell: false }); let tue = false;
  // FFmpeg qui ne démarre pas : son tuyau est fermé tout de suite, la réponse ne reste pas ouverte pour rien.
  const fin = new Promise<void>((ok) => { p.on('close', () => ok()); p.on('error', () => { try { p.stdout?.destroy(); } catch { /* déjà fermé */ } ok(); }); });
  return { sortie: p.stdout, fin, tuer() { if (tue) return; tue = true; try { p.kill('SIGKILL'); } catch { /* déjà fini */ } } };
};
/** Plus personne ne lit depuis ce temps : la conversion est coupée. Vérifié à ce pas. Jamais plus longue que ce plafond. */
const DELAIS = { sansLecteurMs: 5 * 60_000, pasMs: 15_000, dureeMaxMs: 8 * 3600_000 };
let outils: OutilsPistes = { court: courtReel, flux: fluxReel }, delais = { ...DELAIS };
/** (essais) remplacer FFmpeg et ffprobe, raccourcir les délais ; sans argument, revenir aux vrais. Oublie ce qui était gardé. */
export function reglerOutilsPistes(o: Partial<OutilsPistes> & Partial<typeof DELAIS> = {}): void {
  outils = { court: o.court ?? courtReel, flux: o.flux ?? fluxReel };
  delais = { sansLecteurMs: o.sansLecteurMs ?? DELAIS.sansLecteurMs, pasMs: o.pasMs ?? DELAIS.pasMs, dureeMaxMs: o.dureeMaxMs ?? DELAIS.dureeMaxMs };
  sondes.clear(); sondesEnVol.clear(); mesures.clear(); mesuresEnVol.clear(); reportees.clear(); dispo = undefined; enCours?.arret();
}

// UNE commande courte à la fois par file (la machine a peu de cœurs) : chacune attend la fin de la précédente.
export type Voie = 'leger' | 'lourd';
/** Au plus ce nombre de commandes par file (celle qui tourne comprise) : les suivantes sont refusées, pas empilées. */
export const ATTENTE_MAX = 12;
const files: Record<Voie, { p: Promise<unknown>; n: number }> = { leger: { p: Promise.resolve(), n: 0 }, lourd: { p: Promise.resolve(), n: 0 } };
export function enFile<T>(f: () => Promise<T>, voie: Voie = 'leger'): Promise<T> { const v = files[voie], p = v.p.then(f, f); v.p = p.catch(() => undefined); return p; }
const RATE = (refuse = false): Court => ({ ok: false, coupe: false, sortie: Buffer.alloc(0), ms: 0, ...(refuse ? { refuse: true } : {}) });
/** Une commande courte, dans sa file ; refusée (jamais lancée) si trop de commandes y attendent déjà. */
export function lancerCourt(cmd: 'ffprobe' | 'ffmpeg', args: string[], o: { delaiMs: number; maxOctets: number }, voie: Voie = 'leger'): Promise<Court> {
  const v = files[voie]; if (v.n >= ATTENTE_MAX) return Promise.resolve(RATE(true));
  v.n++;
  return enFile(() => outils.court(cmd, args, o).catch(() => RATE()), voie).finally(() => { v.n--; });
}

/** FFmpeg est-il joignable par cet Odin ? Gardé 30 s, par valeur du PATH (un Odin démarré avant l'installation ne le voit pas). */
let dispo: { ok: boolean; quand: number; chemin: string } | undefined;
export async function ffmpegLa(): Promise<boolean> {
  const chemin = process.env.PATH ?? process.env.Path ?? '';
  if (dispo && dispo.chemin === chemin && Date.now() - dispo.quand < 30_000) return dispo.ok;
  const r = await lancerCourt('ffmpeg', ['-version'], { delaiMs: 15_000, maxOctets: 64 * 1024 });
  if (r.refuse) return dispo?.ok ?? false; // file pleine : ce qu'on savait, sans le retenir
  dispo = { ok: r.ok, quand: Date.now(), chemin }; return r.ok;
}

// ---------------------------------------------------------------- les pistes du fichier
export interface PisteAudio { ordre: number; codec: string; langue: string; titre: string; canaux: number; defaut: boolean }
export interface PisteSousTitres { index: number; codec: string; langue: string; titre: string; force: boolean; /** du texte (lisible), et non des images */ texte: boolean }
export interface Sonde { /** lue par ffprobe à l'instant (sinon : ce que le scan avait noté) */ sure: boolean; audio: PisteAudio[]; sousTitres: PisteSousTitres[] }
/** Un texte venu du fichier (titre d'une piste) : sans caractère de commande ni chevron, court. Pur. */
export const propre = (v: unknown, n = 60): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
/** Un code de langue écrit dans le fichier (« fre », « en », « pt-BR ») ; vide s'il n'en est pas un (« und » compris). Pur. */
export const codeLangue = (v: unknown): string => { const m = /^([a-z]{2,3})(?:[-_][a-z0-9]{2,8})?$/i.exec(propre(v, 16)); return m && m[1].toLowerCase() !== 'und' ? m[1].toLowerCase() : ''; };
// Les codes à trois lettres les plus courants et leur code court : « fre », « fra » et « fr » sont la même langue.
const COURTS: Record<string, string> = { fre: 'fr', fra: 'fr', eng: 'en', ger: 'de', deu: 'de', spa: 'es', ita: 'it', por: 'pt', jpn: 'ja', chi: 'zh', zho: 'zh', ara: 'ar', dut: 'nl', nld: 'nl', rus: 'ru', kor: 'ko', swa: 'sw', mlg: 'mg', cze: 'cs', ces: 'cs', gre: 'el', ell: 'el', tur: 'tr', pol: 'pl', hin: 'hi' };
/** La même langue sous un seul code, pour comparer le choix d'un profil aux pistes d'un autre fichier. Pur. */
export const langueCourte = (v: unknown): string => { const c = codeLangue(v); return COURTS[c] ?? c; };
/** Les sous-titres qui sont du TEXTE (les autres sont des images : impossibles à écrire en texte). */
const CODECS_TEXTE = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text', 'stl', 'microdvd', 'subviewer', 'jacosub', 'sami', 'realtext', 'eia_608', 'ttml']);
/** Les arguments de ffprobe, toujours les mêmes : seul le fichier vérifié change, placé après « -i ». Pur. */
export const argsSonde = (chemin: string): string[] => ['-v', 'error', '-show_entries', 'stream=index,codec_type,codec_name,channels:stream_tags=language,title:stream_disposition=default,forced', '-print_format', 'json', ...entreeFfmpeg('media'), '-i', chemin];
/** Ce que ffprobe a répondu → les pistes. Tout texte venu du fichier est nettoyé. Pur. */
export function lireSonde(json: string): Sonde | undefined {
  let j: unknown; try { j = JSON.parse(json); } catch { return undefined; }
  const streams = (j as { streams?: unknown })?.streams; if (!Array.isArray(streams)) return undefined;
  const audio: PisteAudio[] = [], sousTitres: PisteSousTitres[] = [];
  for (const x of streams.slice(0, 200) as Array<Record<string, unknown>>) {
    if (!x || typeof x !== 'object') continue;
    const tags = (x.tags && typeof x.tags === 'object' ? x.tags : {}) as Record<string, unknown>, disp = (x.disposition && typeof x.disposition === 'object' ? x.disposition : {}) as Record<string, unknown>;
    const codec = propre(x.codec_name, 24).toLowerCase(), langue = codeLangue(tags.language ?? tags.LANGUAGE), titre = propre(tags.title ?? tags.TITLE);
    if (x.codec_type === 'audio') audio.push({ ordre: audio.length, codec, langue, titre, canaux: Math.max(0, Math.min(64, Math.trunc(Number(x.channels) || 0))), defaut: Number(disp.default) === 1 });
    else if (x.codec_type === 'subtitle' && Number.isInteger(Number(x.index)) && Number(x.index) >= 0) sousTitres.push({ index: Number(x.index), codec, langue, titre, force: Number(disp.forced) === 1 || /forc/i.test(titre), texte: CODECS_TEXTE.has(codec) });
  }
  return { sure: true, audio, sousTitres };
}
const cleFichier = (v: { chemin: string; taille: number; mtime: number }) => `${v.chemin}|${v.taille}|${v.mtime}`;
const sondes = new Map<string, { s: Sonde; quand: number }>(), sondesEnVol = new Map<string, Promise<Sonde>>();
const garder = <V>(m: Map<string, V>, k: string, v: V, max: number) => { m.delete(k); m.set(k, v); while (m.size > max) m.delete(m.keys().next().value as string); };
/**
 * Les pistes d'une cible. ffprobe est lancé une fois par fichier (gardé en mémoire tant que le fichier ne change pas) ;
 * s'il manque ou échoue, on rend ce que le scan avait noté (codecs seulement), et on réessaie cinq minutes plus tard.
 */
export async function pistesDe(mag: MagasinVenus, cibleId: string): Promise<Sonde> {
  const c = fichierDeCible(mag, cibleId);
  const repli: Sonde = {
    sure: false,
    audio: (c?.probe?.audio ?? []).map((codec, k) => ({ ordre: k, codec: propre(codec, 24).toLowerCase(), langue: '', titre: '', canaux: 0, defaut: k === 0 })),
    sousTitres: (c?.sousTitres ?? []).filter((x) => !x.fichier && Number.isInteger(x.index)).map((x) => ({ index: Number(x.index), codec: '', langue: codeLangue(x.langue), titre: propre((x as { titre?: unknown }).titre), force: /forc/i.test(propre((x as { titre?: unknown }).titre)), texte: true })),
  };
  const v = videoVerifiee(mag, cibleId); if (!v) return repli;
  const cle = cleFichier(v), g = sondes.get(cle);
  if (g && (g.s.sure || Date.now() - g.quand < 5 * 60_000)) return g.s;
  // Deux demandes en même temps pour le même fichier (le lecteur et sa fenêtre des pistes) : une seule lecture.
  let p = sondesEnVol.get(cle);
  if (!p) {
    p = lancerCourt('ffprobe', argsSonde(v.chemin), { delaiMs: 20_000, maxOctets: 512 * 1024 }).then((r) => {
      const s = (r.ok ? lireSonde(r.sortie.toString('utf8')) : undefined) ?? repli;
      if (!r.refuse) garder(sondes, cle, { s, quand: Date.now() }, 300); // refusée (file pleine) : pas retenu, on relira
      return s;
    }).finally(() => sondesEnVol.delete(cle));
    sondesEnVol.set(cle, p);
  }
  return p;
}

// ---------------------------------------------------------------- les qualités
/** Les qualités réduites de l'appli d'origine (hauteur de l'image). */
export const QUALITES = [1080, 720, 480, 360] as const;
/** Débit maximal et tampon, par hauteur. */
const DEBITS: Record<number, [string, string]> = { 1080: ['5000k', '10000k'], 720: ['2800k', '5600k'], 480: ['1400k', '2800k'], 360: ['800k', '1600k'] };
const videoReduite = (h: number): string[] => ['-vf', `scale=-2:${h}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-maxrate', DEBITS[h][0], '-bufsize', DEBITS[h][1], '-pix_fmt', 'yuv420p'];
/** La mesure : ces secondes du fichier, converties vers rien. La machine « suit » si elle va MARGE fois plus vite que la lecture. */
export const ECHANTILLON_S = 4, MARGE = 1.25;
const DELAI_MESURE_MS = Math.round((ECHANTILLON_S * 1000) / MARGE) + 2500;
/** Les arguments de la mesure : rien n'est écrit (« -f null »). Pur. */
export function argsMesure(chemin: string, hauteur: number, instant: number): string[] {
  const t = Number.isFinite(instant) && instant > 0 ? String(Math.floor(instant)) : '0';
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', t, ...entreeFfmpeg('video'), '-i', chemin, '-t', String(ECHANTILLON_S), '-map', '0:v:0', '-an', '-sn', '-dn', ...videoReduite(hauteur), '-f', 'null', '-'];
}
export interface Qualite { q: string; hauteur: number; possible: boolean; /** pourquoi elle est grisée (court, à côté du nom) */ raison?: string; /** la même chose en une phrase */ detail?: string }
export interface Qualites { /** la taille de l'original (« 1080p », « 4K »…), si elle est connue */ hauteur: number; qualites: Qualite[] }
const R = {
  inconnue: ['taille inconnue', 'La taille de l’image de ce fichier n’est pas connue : relancez un scan.'],
  petite: ['l’original n’est pas plus grand', 'L’original n’est pas plus grand que cette qualité : il n’y a rien à réduire.'],
  ffmpeg: ['FFmpeg introuvable', 'FFmpeg est introuvable pour Odin : il sert à convertir. Installez-le sur la machine d’Odin, puis redémarrez Odin.'],
  lente: ['cette machine ne suit pas', 'Cette machine ne convertit pas assez vite pour cette qualité : l’image attendrait.'],
  occupee: ['mesure plus tard', 'Odin convertit déjà une vidéo : il mesurera ce que la machine peut produire quand elle sera finie.'],
  absent: ['fichier absent', 'Le fichier de ce titre n’est plus à sa place : rebranchez le disque ou relancez un scan.'],
} as const;
// Par fichier : la plus grande qualité réduite que la machine suit (0 : aucune). En mémoire seulement.
const mesures = new Map<string, number>(), mesuresEnVol = new Map<string, Promise<{ max: number; charge: boolean }>>();
// Mesuré pendant qu'une conversion tournait (ou refusé, file pleine) : pas retenu contre la machine, mais pas remesuré
// avant ce délai tant qu'une conversion tourne — rouvrir la fenêtre « Qualité » en boucle ne relance pas FFmpeg à pleine charge à chaque
// fois, au détriment de la vidéo qui est en train d'être convertie.
const reportees = new Map<string, { max: number; quand: number }>(), REMESURE_MS = 2 * 60_000;
/**
 * Les qualités d'une cible. Une qualité n'est « possible » que si elle est plus petite que l'original ET que la machine
 * la convertit assez vite : mesuré de la plus grande à la plus petite, on s'arrête à la première qui passe (les plus
 * petites coûtent moins). Mesuré pendant qu'une conversion tourne, ce qui passe est sûr (il passerait mieux encore au
 * repos) ; ce qui ne passe pas n'est pas retenu contre la machine : « mesure plus tard », et ce sera remesuré.
 */
export async function qualitesDe(mag: MagasinVenus, cibleId: string): Promise<Qualites> {
  const v = videoVerifiee(mag, cibleId), h0 = Math.trunc(Number(fichierDeCible(mag, cibleId)?.probe?.hauteur) || 0);
  const toutes = (r: readonly [string, string], eligibles: number[] = [...QUALITES]): Qualites => ({ hauteur: h0, qualites: QUALITES.map((h) => ({ q: `${h}p`, hauteur: h, possible: false, raison: (eligibles.includes(h) ? r : R.petite)[0], detail: (eligibles.includes(h) ? r : R.petite)[1] })) });
  if (!v) return toutes(R.absent);
  if (!h0) return toutes(R.inconnue);
  const eligibles = QUALITES.filter((h) => h0 > h);
  if (!eligibles.length) return toutes(R.petite, []);
  if (!(await ffmpegLa())) return toutes(R.ffmpeg, eligibles);
  const cle = cleFichier(v), rp = reportees.get(cle); let max = mesures.get(cle), charge = false;
  if (max === undefined && rp && enCours && Date.now() - rp.quand < REMESURE_MS) { max = rp.max; charge = true; }
  if (max === undefined) {
    let p = mesuresEnVol.get(cle);
    if (!p) {
      p = (async () => {
        let occupe = !!enCours, trouve = 0;
        for (const h of eligibles) {
          const r = await lancerCourt('ffmpeg', argsMesure(v.chemin, h, instantVignette(v.duree)), { delaiMs: DELAI_MESURE_MS, maxOctets: 4096 }, 'lourd');
          if (r.refuse) { occupe = true; break; }
          occupe ||= !!enCours;
          if (r.ok && r.ms * MARGE <= ECHANTILLON_S * 1000) { trouve = h; break; }
        }
        return { max: trouve, charge: occupe };
      })().finally(() => mesuresEnVol.delete(cle));
      mesuresEnVol.set(cle, p);
    }
    const r = await p; max = r.max; charge = r.charge;
    if (!charge || max === eligibles[0]) { garder(mesures, cle, max, 300); reportees.delete(cle); }
    else garder(reportees, cle, { max, quand: Date.now() }, 300);
  }
  const m = max, refus = charge ? R.occupee : R.lente;
  return { hauteur: h0, qualites: QUALITES.map((h) => (!eligibles.includes(h) ? { q: `${h}p`, hauteur: h, possible: false, raison: R.petite[0], detail: R.petite[1] } : h <= m ? { q: `${h}p`, hauteur: h, possible: true } : { q: `${h}p`, hauteur: h, possible: false, raison: refus[0], detail: refus[1] })) };
}

// ---------------------------------------------------------------- la conversion à la volée (UNE à la fois)
/**
 * Les arguments de la conversion : la vidéo du fichier, UNE piste audio (son rang), aucune piste de sous-titres (ils
 * sont servis à part, en texte), en MP4 « fragmenté » vers le tuyau. Sans qualité demandée, une vidéo déjà en H.264 est
 * recopiée (presque rien à calculer). Pur.
 */
/** Le plus loin qu'une conversion peut démarrer (100 h) : un nombre démesuré dans l'adresse ne devient pas « 1e+308 » pour FFmpeg. */
export const DEPUIS_MAX_S = 360_000;
export function argsConversion(chemin: string, o: { depuis?: number; audio?: number; hauteur?: number; probe?: Probe } = {}): string[] {
  const t = Number.isFinite(o.depuis) && (o.depuis as number) > 0 ? Math.min(DEPUIS_MAX_S, Math.floor(o.depuis as number)) : 0, a = Number.isInteger(o.audio) && (o.audio as number) > 0 ? (o.audio as number) : 0;
  const video = o.hauteur && DEBITS[o.hauteur] ? videoReduite(o.hauteur) : /^(h264|avc)/i.test(o.probe?.codecs[0] ?? '') ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'];
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', ...(t > 0 ? ['-ss', String(t)] : []), ...entreeFfmpeg('video'), '-i', chemin, '-map', '0:v:0', '-map', `0:a:${a}?`, '-sn', '-dn', ...video, '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-movflags', 'frag_keyframe+empty_moov+faststart', '-f', 'mp4', 'pipe:1'];
}
interface Session { cle: string; arret(): void }
let enCours: Session | null = null;
/** Qui convertit en ce moment (la clé de sa session), ou rien. */
export const conversionEnCours = (): string | undefined => enCours?.cle;
export interface Refus { code: number; error: string }
const OCCUPE: Refus = { code: 409, error: 'Odin convertit déjà une autre vidéo (une seule à la fois sur cette machine). Réessayez quand elle sera finie.' };
const PARTI: Refus = { code: 499, error: 'Le lecteur est parti avant le début de la conversion.' };
/** Le lecteur a-t-il déjà fermé la connexion (pendant qu'Odin vérifiait ou mesurait) ? */
const parti = (res: ServerResponse): boolean => !!(res.destroyed || res.writableEnded || (res.socket && res.socket.destroyed));
/**
 * Lance UNE conversion vers la réponse. Une autre session qui convertit déjà : refusé. La même session (un saut dans le
 * film, un autre choix) : l'ancienne est arrêtée, la nouvelle la remplace. Coupée quand le lecteur ferme la connexion,
 * quand plus rien n'est lu depuis trop longtemps (personne ne regarde), ou au plafond de durée.
 */
export function diffuser(res: ServerResponse, cle: string, args: string[], mime = 'video/mp4'): Refus | undefined {
  if (enCours && enCours.cle !== cle) return OCCUPE;
  // Parti pendant la vérification : « close » ne reviendra plus, FFmpeg tournerait pour personne (et tiendrait la seule
  // place de conversion) jusqu'à la coupure faute de lecteur. Rien n'est lancé.
  if (parti(res)) return PARTI;
  enCours?.arret();
  let f: Flux; try { f = outils.flux(args); } catch { return { code: 503, error: R.ffmpeg[1] }; }
  const debut = Date.now(); let fini = false, dernier = debut, garde: NodeJS.Timeout | undefined;
  const moi: Session = { cle, arret() { if (fini) return; fini = true; clearTimeout(garde); f.tuer(); if (enCours === moi) enCours = null; try { res.destroy(); } catch { /* déjà fermée */ } } };
  enCours = moi;
  res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.flushHeaders(); // le lecteur sait tout de suite que la conversion est partie, avant ses premiers octets
  f.sortie.on('data', () => { dernier = Date.now(); }); res.on('drain', () => { dernier = Date.now(); });
  f.sortie.on('error', () => moi.arret());
  // Le tuyau se ferme sans être arrivé au bout (FFmpeg n'a pas démarré, ou s'est arrêté net) : la réponse est fermée aussi.
  f.sortie.on('close', () => { if (!f.sortie.readableEnded) moi.arret(); });
  f.sortie.pipe(res);
  res.on('close', () => moi.arret());
  void f.fin.then(() => { if (fini) return; fini = true; clearTimeout(garde); if (enCours === moi) enCours = null; });
  // Un minuteur réarmé (jamais un intervalle caché) : il s'arrête avec la conversion.
  const veiller = () => { garde = setTimeout(() => { if (fini) return; const t = Date.now(); if (t - dernier > delais.sansLecteurMs || t - debut > delais.dureeMaxMs) { moi.arret(); return; } veiller(); }, delais.pasMs); garde.unref?.(); };
  veiller();
  return undefined;
}
/** Ce qui est demandé au flux : une piste audio (son rang), une qualité réduite (sa hauteur). Lu de l'adresse. Pur. */
export function choixDeFlux(audio: unknown, q: unknown): { audio: number; hauteur?: number } | undefined {
  const a = audio === null || audio === undefined || audio === '' ? 0 : Number(audio), h = q === null || q === undefined || q === '' ? 0 : Number(String(q).replace(/p$/i, ''));
  if (!Number.isInteger(a) || a < 0 || a > 63 || !Number.isInteger(h) || (h !== 0 && !(QUALITES as readonly number[]).includes(h))) return undefined;
  return { audio: a, ...(h ? { hauteur: h } : {}) };
}
/** Vérifie une demande SANS rien lancer : la piste existe, la qualité est possible ici, la machine est libre. */
export async function verifierConversion(mag: MagasinVenus, cibleId: string, o: { cle: string; audio: number; hauteur?: number }): Promise<{ ok: true; chemin: string; probe?: Probe } | Refus> {
  const v = videoVerifiee(mag, cibleId); if (!v) return { code: 404, error: R.absent[1] };
  if (!(await ffmpegLa())) return { code: 503, error: `${R.ffmpeg[1]} La lecture reste en « Originale ».` };
  const s = await pistesDe(mag, cibleId);
  if (!Number.isInteger(o.audio) || o.audio < 0 || o.audio >= Math.max(1, s.audio.length)) return { code: 400, error: 'Cette piste audio n’existe pas dans ce fichier.' };
  if (o.hauteur !== undefined) {
    const q = (await qualitesDe(mag, cibleId)).qualites.find((x) => x.hauteur === o.hauteur);
    if (!q) return { code: 400, error: 'Cette qualité n’existe pas.' };
    if (!q.possible) return { code: 409, error: `${q.detail ?? ''} La lecture reste en « Originale ».`.trim() };
  }
  if (enCours && enCours.cle !== o.cle) return OCCUPE;
  return { ok: true, chemin: v.chemin, probe: fichierDeCible(mag, cibleId)?.probe };
}
/** Sert le flux converti d'une cible (autre piste audio, qualité réduite), à partir de `depuis` secondes. */
export async function servirConversion(res: ServerResponse, mag: MagasinVenus, cibleId: string, o: { cle: string; depuis: number; audio: number; hauteur?: number }): Promise<boolean> {
  const refuser = (r: Refus) => { res.writeHead(r.code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify({ error: r.error })); return true; };
  const v = await verifierConversion(mag, cibleId, o); if (!('ok' in v)) return refuser(v);
  const r = diffuser(res, o.cle, argsConversion(v.chemin, { depuis: o.depuis, audio: o.audio, hauteur: o.hauteur, probe: v.probe }));
  return r ? refuser(r) : true;
}
