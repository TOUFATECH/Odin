// Vénus — les routes HTTP servies par le serveur web d'Odin (greffe courte dans src/web/server.ts). Flux et transcodage
// à la volée, sous-titres, vignettes, bibliothèque, ma liste, reprise, demandes, écrans + pilotage continu, QR de
// télécommande, et l'onglet YouTube. Plus la route courte restreinte /t/<jeton> : la télécommande d'UN seul écran.
//
// Les outils réels (ffprobe, FFmpeg, fetch résilient, Home Assistant) sont ici ; la logique est dans les autres
// fichiers de venus/ (testés avec des faux).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, resolve } from 'node:path';
import { fetchPropre } from '../../net/fetch-propre.ts';
import { haApi, type HaState } from '../../tools/homeassistant.ts';
import { dirVenus, magasinVenus, type MagasinVenus } from './base.ts';
import { ajouterDossier, nettoyerChemin, raisonDossierRefuse, ajouterHistorique, ajouterMaListe, bibliotheque, demander, demandes, dossiers, episodes, fichierDeCible, maListe, noterReprise, pistes, reprise, retirerDossier, retirerMaListe, scanner, type Categorie, type Outils, type Probe, type TypeOeuvre } from './bibliotheque.ts';
import { argsTranscodage, choisirSousTitres, lireRange, planLecture } from './lecture.ts';
import { choixDeFlux, pistesDe, servirConversion } from './pistes.ts';
import { ecrireVtt, idPourLangue, listeSousTitres, vttDe, vttDuFichierNote } from './sous-titres.ts';
import { servirBandeAnnonce } from './bande-annonce.ts';
import { ACTIONS_ECRAN, decouvrirEcrans, piloterEcran, planEnvoi, type ActionEcran, type HaCaller } from './ecrans.ts';
import { creerTelecommande, empreinteTelephone, jetonDe, nombreTelephones, qrTelecommande, regenerer, revoquer, telecommandes, validerJeton } from './telecommande.ts';
import { abonnements, abonner, accueil, ajouterHistoriqueYt, chaine, desabonner, effacerHistoriqueYt, historiqueYt, recherche, reglagesYt, reglerYt, segmentsASauter, video, type Http } from './youtube.ts';
import { fluxAutorise } from './cast.ts';
import { entreeFfmpeg } from '../../files/ffmpeg-entree.ts';
import { estMembre } from '../sso/garde.ts';
import { profilDemande, profilDuTemoin, routeAppli } from './app/appli.ts';

export interface VenusRouteCtx {
  home: string;
  /** le propriétaire est-il connecté ? */
  proprietaire(): boolean;
  /** un essai raté (anti-abus) */
  fail(): void;
  /** origine publique (pour les liens de QR) */
  origin: string;
  /** Home Assistant, si relié */
  ha?: { url: string; token: string };
  /** l'IP de l'appelant (compteur de téléphones) */
  ip: string;
  /** l'IA d'Odin, si dispo (secours SponsorBlock sur la transcription) */
  ask?: (t: string) => Promise<string>;
  /** le profil courant (ma liste, historique, réglages YouTube) */
  profil?: string;
}

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
function json(res: ServerResponse, code: number, corps: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(corps));
}
async function corps(req: IncomingMessage, max = 64 * 1024): Promise<Record<string, unknown>> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) return {}; parts.push(c as Buffer); }
  try { const j = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') as unknown; return j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, unknown> : {}; } catch { return {}; }
}

// ---------------- Outils réels (ffprobe, FFmpeg, fetch, Home Assistant) ----------------
const execJson = (cmd: string, args: string[], timeout = 60_000): Promise<string> => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] }); const out: Buffer[] = [];
  const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('délai dépassé')); }, timeout); t.unref?.();
  p.stdout.on('data', (b) => out.push(b as Buffer));
  p.on('error', (e) => { clearTimeout(t); reject(e); });
  p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(Buffer.concat(out).toString('utf8')) : reject(new Error(`code ${code}`)); });
});

/** ffprobe réel → forme Probe. */
export async function ffprobeReel(chemin: string): Promise<Probe | null> {
  try {
    const j = JSON.parse(await execJson('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-print_format', 'json', ...entreeFfmpeg('media'), chemin])) as { format?: { duration?: string }; streams?: Array<Record<string, unknown>> };
    const streams = j.streams ?? [];
    const v = streams.find((x) => x.codec_type === 'video');
    return {
      duree: Math.round(Number(j.format?.duration) || 0),
      largeur: v ? Number(v.width) || undefined : undefined,
      hauteur: v ? Number(v.height) || undefined : undefined,
      codecs: streams.filter((x) => x.codec_type === 'video').map((x) => String(x.codec_name ?? '')),
      audio: streams.filter((x) => x.codec_type === 'audio').map((x) => String(x.codec_name ?? '')),
      sousTitres: streams.filter((x) => x.codec_type === 'subtitle').map((x, i) => ({ langue: (x.tags as { language?: string } | undefined)?.language, titre: (x.tags as { title?: string } | undefined)?.title, index: Number(x.index) || i })),
    };
  } catch { return null; }
}
/**
 * FFmpeg et ffprobe sont-ils joignables par CE processus d'Odin ? (Odin démarré avant l'installation de FFmpeg ne les
 * voit pas : son PATH est celui de son démarrage.) Gardé 30 s, par valeur du PATH.
 */
const dispoCache = new Map<string, { ok: boolean; quand: number }>();
export function outilDispo(cmd: 'ffprobe' | 'ffmpeg'): Promise<boolean> {
  const cle = `${cmd}|${process.env.PATH ?? process.env.Path ?? ''}`, c = dispoCache.get(cle);
  if (c && Date.now() - c.quand < 30_000) return Promise.resolve(c.ok);
  return new Promise((resolve) => {
    let fini = false;
    const fin = (ok: boolean) => { if (fini) return; fini = true; dispoCache.set(cle, { ok, quand: Date.now() }); resolve(ok); };
    try {
      const p = spawn(cmd, ['-version'], { stdio: 'ignore' });
      const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* déjà fini */ } fin(false); }, 15_000); t.unref?.();
      p.on('error', () => { clearTimeout(t); fin(false); });
      p.on('close', (code) => { clearTimeout(t); fin(code === 0); });
    } catch { fin(false); }
  });
}
/** Ce que le propriétaire doit faire quand FFmpeg manque (dit à l'écran, au lieu d'un « 0 œuvre » muet). */
export const MESSAGE_FFMPEG_ABSENT = "FFmpeg est introuvable pour Odin (ffprobe sert à lire les médias, ffmpeg à convertir ceux que le navigateur ne lit pas). Installe FFmpeg sur la machine d'Odin (sous Windows : winget install Gyan.FFmpeg), puis redémarre Odin : un Odin démarré avant l'installation ne le voit pas.";
/** Un exemple de chemin qui ressemble à ceux de la machine d'Odin. */
const exempleChemin = () => (process.platform === 'win32' ? 'D:\\Films' : '/mnt/films');

/** Les outils réels pour un scan (ffprobe ; la vignette reste facultative). */
export const outilsReels = (): Outils => ({ ffprobe: ffprobeReel });

/** fetch résilient → forme attendue par youtube.ts. */
export const httpReel: Http = async (url, o) => {
  const r = await fetchPropre(url, { label: o?.label, timeoutMs: 15_000, init: o?.init });
  if (!r.ok || !r.reponse) return { ok: false, statut: r.statut, erreur: r.erreur };
  try { const texte = await r.reponse.text(); try { return { ok: true, statut: r.statut, json: JSON.parse(texte) as unknown, texte }; } catch { return { ok: true, statut: r.statut, texte }; } }
  catch (e) { return { ok: false, erreur: (e as Error).message }; }
};
const haCaller = (ha: { url: string; token: string }): HaCaller => (method, path, body) => haApi(ha.url, ha.token, method, path, body);

// ---------------- Le dispatcher ----------------
/** Les routes /venus/* et /t/<jeton>. Rend true si la requête est servie ici. */
export async function venusRoute(req: IncomingMessage, res: ServerResponse, url: URL, ctx: VenusRouteCtx): Promise<boolean> {
  const p = url.pathname;
  if (!p.startsWith('/venus/') && !p.startsWith('/t/')) return false;
  const mag = magasinVenus(ctx.home, dirVenus(ctx.home));
  const meth = req.method ?? 'GET';
  // Le profil choisi dans « Qui regarde ? » (un compte d'Odin, vérifié) ; sinon celui que donne le serveur.
  const profil = req.headers['x-venus-profil'] || profilDuTemoin(req) ? profilDemande(req, ctx.home) : (ctx.profil || 'moi');
  // Le propriétaire SEUL : la session d'un membre (ou d'un invité) vaut « connecté » pour le serveur, mais Vénus ouvre
  // les dossiers de la machine et lit leurs médias ; un membre n'y entre pas, même s'il a le droit d'ouvrir Vénus.
  const proprietaire = () => ctx.proprietaire() && !estMembre(req);

  try {
    // Télécommande publique d'UN écran (jeton limité/révocable). Portée = ce seul écran, rien d'autre d'Odin.
    if (p.startsWith('/t/')) return await routeTelecommandePublique(req, res, url, ctx, mag, p.slice(3));
    if (p.startsWith('/venus/commande/')) return await routeCommandeJeton(req, res, ctx, mag, p.slice('/venus/commande/'.length));

    // Flux de diffusion : le lecteur de la maison (Chromecast/DLNA) va chercher l'adresse SANS session. Un jeton de
    // diffusion à portée restreinte (cette cible, limité dans le temps) est accepté, vérifié AVANT la garde propriétaire.
    if (meth === 'GET' && p.startsWith('/venus/flux/')) {
      const cibleId = decode(p.slice('/venus/flux/'.length));
      // (suite du lot V2) Une autre piste audio ou une qualité réduite : la conversion bornée d'Odin (une à la fois),
      // pour le propriétaire et ses profils seulement — jamais avec un jeton de diffusion.
      const choix = proprietaire() && (url.searchParams.has('audio') || url.searchParams.has('q')) ? choixDeFlux(url.searchParams.get('audio'), url.searchParams.get('q')) : { audio: 0 };
      if (!choix) { json(res, 400, { error: 'Piste audio ou qualité inconnue.' }); return true; }
      if (choix.audio > 0 || choix.hauteur) {
        if (!lecteurSaitOuvrir(mag, cibleId)) { json(res, 404, { error: 'cible introuvable' }); return true; }
        if (estOuverture(req.headers.range) && !(Number(url.searchParams.get('depuis')) > 0)) noterVu(mag, profil, cibleId);
        return await servirConversion(res, mag, cibleId, { cle: profil, depuis: Number(url.searchParams.get('depuis')) || 0, ...choix });
      }
      if (proprietaire() || fluxAutorise(ctx.home, cibleId, s(url.searchParams.get('cle')))) {
        return await servirFlux(res, mag, cibleId, { range: req.headers.range, depuis: Number(url.searchParams.get('depuis')) || 0, profil });
      }
      ctx.fail(); json(res, 401, { error: 'Connecte-toi à Odin.' }); return true;
    }

    // Tout le reste est réservé au propriétaire connecté.
    if (!proprietaire()) {
      // La page de Vénus elle-même : un refus lisible (et un lien vers Odin), pas une réponse de machine. Ouvrir une
      // page n'est pas un essai de jeton : pas compté (sinon un favori ou un membre redirigé bloque l'adresse 15 min).
      if (meth === 'GET' && (p === '/venus/app' || p === '/venus/app/')) { res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" }); res.end(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Venus</title><body style="font-family:system-ui,sans-serif;background:#120e0d;color:#eceae4;display:grid;place-items:center;min-height:90vh;margin:0;padding:16px"><p>Venus est réservé au propriétaire d'Odin. <a href="/" style="color:#f4cf9c">Revenir à Odin</a></p></body>`); return true; }
      ctx.fail(); json(res, 401, { error: 'Connecte-toi à Odin.' }); return true;
    }
    // L'interface de Vénus (lot V1) : la page plein écran et ce qu'elle lit (catalogue, fiche, profils, préférences).
    if (await routeAppli(req, res, url, ctx.home, mag, profil)) return true;

    if (meth === 'GET' && p === '/venus/bibliotheque') { json(res, 200, { oeuvres: bibliotheque(mag, { type: s(url.searchParams.get('type')) as TypeOeuvre | undefined || undefined, q: s(url.searchParams.get('q')) }) }); return true; }
    if (meth === 'GET' && p.startsWith('/venus/oeuvre/')) return servirOeuvre(res, mag, decode(p.slice('/venus/oeuvre/'.length)), profil);
    // Déclarer un dossier média et lancer le scan (ODÉON se remplit ici ; sans ça la bibliothèque reste vide).
    if (p === '/venus/dossiers') return await routeDossiers(req, res, meth, mag);
    if (meth === 'POST' && p === '/venus/scan') {
      const ffprobe = await outilDispo('ffprobe');
      const bilan = await scanner(mag, outilsReels());
      json(res, 200, { bilan, ...(ffprobe ? {} : { alerte: MESSAGE_FFMPEG_ABSENT }) }); return true;
    }
    // Avant de lire : comment ce titre sera servi, et pourquoi il ne peut pas l'être (le lecteur l'affiche s'il échoue).
    if (meth === 'GET' && p.startsWith('/venus/plan/')) return await servirPlan(res, mag, decode(p.slice('/venus/plan/'.length)));
    if (meth === 'GET' && p.startsWith('/venus/sous-titres/')) return await servirSousTitres(res, mag, decode(p.slice('/venus/sous-titres/'.length)), s(url.searchParams.get('lang')), s(url.searchParams.get('piste')));
    // (suite du lot V2) La bande-annonce : un fichier posé à côté du film, rien d'autre.
    if (meth === 'GET' && p.startsWith('/venus/bande-annonce/')) return await servirBandeAnnonce(res, mag, decode(p.slice('/venus/bande-annonce/'.length)), { range: req.headers.range, cle: profil });
    if (meth === 'GET' && p.startsWith('/venus/vignette/')) return servirVignette(res, mag, decode(p.slice('/venus/vignette/'.length)));

    if (meth === 'POST' && p === '/venus/reprise') { const b = await corps(req); noterReprise(mag, profil, s(b.cible), Number(b.position_s) || 0, Number(b.duree_s) || 0, s(b.type) || 'video'); json(res, 200, { ok: true }); return true; }
    if (p === '/venus/ma-liste') {
      if (meth === 'GET') { json(res, 200, { liste: maListe(mag, profil) }); return true; }
      const b = await corps(req); const oid = s(b.oeuvre_id); if (!oid) { json(res, 400, { error: 'oeuvre_id attendu' }); return true; }
      if (s(b.faire) === 'retirer') retirerMaListe(mag, profil, oid); else ajouterMaListe(mag, profil, oid);
      json(res, 200, { liste: maListe(mag, profil) }); return true;
    }
    if (p === '/venus/demandes') {
      if (meth === 'GET') { json(res, 200, { demandes: demandes(mag, profil) }); return true; }
      const b = await corps(req); const titre = s(b.titre); if (!titre) { json(res, 400, { error: 'titre attendu' }); return true; }
      demander(mag, profil, titre, s(b.type) || 'film'); json(res, 200, { demandes: demandes(mag, profil) }); return true;
    }

    // Écrans + pilotage continu + QR
    if (meth === 'GET' && p === '/venus/ecrans') { if (!ctx.ha) { json(res, 200, { ecrans: [], message: 'Home Assistant n\'est pas relié.' }); return true; } json(res, 200, { ecrans: await decouvrirEcrans(haCaller(ctx.ha), mag) }); return true; }
    const mEcran = /^\/venus\/ecran\/([^/]+)(\/qr(?:\/(revoquer|regenerer))?|\/commande)?$/.exec(p);
    if (mEcran && meth === 'POST') return await routeEcran(req, res, ctx, mag, decode(mEcran[1]), mEcran[2] ?? '', mEcran[3] ?? '');

    // YouTube
    if (p.startsWith('/venus/yt/')) return await routeYoutube(req, res, url, ctx, mag, p.slice('/venus/yt/'.length), profil);

    json(res, 404, { error: 'route Vénus inconnue' }); return true;
  } catch (e) { json(res, 500, { error: (e as Error).message }); return true; }
}

// ---------------- Flux, sous-titres, vignette ----------------
/** Une requête de flux est-elle une OUVERTURE (début), et non un simple seek ? (pour n'écrire l'historique qu'une fois) */
const estOuverture = (range?: string): boolean => !range || /^bytes=0-/.test(range);
/** Écrit l'historique (privé) d'une cible : résout un titre lisible à partir de l'œuvre / épisode / piste. */
function noterVu(mag: MagasinVenus, profil: string, cibleId: string): void {
  const ep = mag.get('episodes', cibleId), pi = mag.get('pistes', cibleId), oe = mag.get('oeuvres', cibleId);
  if (oe) { ajouterHistorique(mag, profil, cibleId, String(oe.data.type ?? 'video'), String(oe.data.titre ?? '')); return; }
  const titreParent = (x?: { data: Record<string, unknown> }) => String(mag.get('oeuvres', String(x?.data.oeuvre_id ?? ''))?.data.titre ?? '');
  if (ep) { ajouterHistorique(mag, profil, cibleId, 'episode', `${titreParent(ep)} S${String(ep.data.saison ?? 0).padStart(2, '0')}E${String(ep.data.episode ?? 0).padStart(2, '0')}`.trim()); return; }
  if (pi) ajouterHistorique(mag, profil, cibleId, 'piste', `${titreParent(pi)} · ${String(pi.data.titre ?? '')}`.trim());
}
async function servirFlux(res: ServerResponse, mag: MagasinVenus, cibleId: string, o: { range?: string; depuis?: number; profil?: string } = {}): Promise<boolean> {
  const c = fichierDeCible(mag, cibleId);
  if (!c) { json(res, 404, { error: 'cible introuvable' }); return true; }
  if (!existsSync(c.fichier)) { json(res, 404, { error: "Le fichier de ce titre n'est plus à sa place (disque débranché, fichier déplacé) : rebranche-le ou relance un scan." }); return true; }
  // Historique (privé) à l'OUVERTURE seulement (pas à chaque seek) : requête sans Range, ou Range depuis 0.
  if (o.profil && estOuverture(o.range)) noterVu(mag, o.profil, cibleId);
  const plan = planLecture({ chemin: c.fichier, probe: c.probe, type: c.type, duree: c.duree });
  if (plan.mode === 'direct') {
    const taille = statSync(c.fichier).size, { debut, fin, partiel } = lireRange(o.range, taille);
    res.writeHead(partiel ? 206 : 200, { 'content-type': plan.mime, 'accept-ranges': 'bytes', 'content-length': String(fin - debut + 1), ...(partiel ? { 'content-range': `bytes ${debut}-${fin}/${taille}` } : {}), 'cache-control': 'no-store' });
    createReadStream(c.fichier, { start: debut, end: fin }).pipe(res);
    return true;
  }
  // Transcodage à la volée : MP4 fragmenté (lisible par <video> en flux), DEPUIS la position demandée (reprise/seek) —
  // le navigateur ne peut pas chercher dans un tuyau, donc le saut se refait côté serveur (relance à `depuis`). Le HLS
  // en segments (scrubbing complet des longs transcodés) reste à faire : voir AVANCEMENT. Jamais de HLS en tuyau nu.
  const mime = c.type === 'audio' ? 'audio/mp4' : 'video/mp4';
  if (!(await outilDispo('ffmpeg'))) { json(res, 503, { error: MESSAGE_FFMPEG_ABSENT }); return true; }
  const ff = spawn('ffmpeg', argsTranscodage(c.fichier, 'mp4', Math.max(0, o.depuis ?? 0), c.type === 'video' ? c.probe : undefined), { stdio: ['ignore', 'pipe', 'ignore'] });
  res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' });
  ff.stdout.pipe(res);
  const stop = () => { try { ff.kill('SIGKILL'); } catch { /* déjà fini */ } };
  res.on('close', stop); ff.on('error', () => { try { res.destroy(); } catch { /* ignore */ } });
  return true;
}
/** Le plan de lecture d'une cible, et ce qui l'empêche (fichier absent, FFmpeg absent pour un format à convertir). */
async function servirPlan(res: ServerResponse, mag: MagasinVenus, cibleId: string): Promise<boolean> {
  const c = fichierDeCible(mag, cibleId);
  if (!c) { json(res, 404, { pret: false, error: "Ce titre n'est pas (ou plus) dans la bibliothèque : relance un scan." }); return true; }
  if (!existsSync(c.fichier)) { json(res, 200, { pret: false, error: "Le fichier de ce titre n'est plus à sa place (disque débranché, fichier déplacé) : rebranche-le ou relance un scan." }); return true; }
  const plan = planLecture({ chemin: c.fichier, probe: c.probe, type: c.type, duree: c.duree });
  if (plan.mode !== 'direct' && !(await outilDispo('ffmpeg'))) { json(res, 200, { pret: false, mode: plan.mode, raison: plan.raison, error: MESSAGE_FFMPEG_ABSENT }); return true; }
  json(res, 200, { pret: true, mode: plan.mode, raison: plan.raison }); return true;
}
/** L'œuvre et, pour une série / un album / un livre audio, ses épisodes ou ses pistes (avec la reprise). */
function servirOeuvre(res: ServerResponse, mag: MagasinVenus, id: string, profil: string): boolean {
  const oe = mag.get('oeuvres', id); if (!oe) { json(res, 404, { error: 'œuvre introuvable' }); return true; }
  const type = String(oe.data.type ?? '');
  const avec = (e: { id: string; data: Record<string, unknown> }) => ({ id: e.id, ...e.data, reprise_s: reprise(mag, profil, e.id)?.position_s ?? 0 });
  const base = { oeuvre: { id: oe.id, ...oe.data }, reprise: reprise(mag, profil, id) ?? null };
  if (type === 'serie') { json(res, 200, { ...base, episodes: episodes(mag, id).map(avec) }); return true; }
  if (type === 'album' || type === 'livre_audio') { json(res, 200, { ...base, pistes: pistes(mag, id).map(avec) }); return true; }
  json(res, 200, base); return true;
}
/** Déclarer / lister / retirer un dossier média (GET liste, POST ajoute ou retire). */
async function routeDossiers(req: IncomingMessage, res: ServerResponse, meth: string, mag: MagasinVenus): Promise<boolean> {
  // La liste dit aussi si FFmpeg est là et donne un exemple de chemin qui ressemble à ceux de cette machine.
  if (meth === 'GET') { json(res, 200, { dossiers: dossiers(mag), exemple: exempleChemin(), outils: { ffprobe: await outilDispo('ffprobe'), ffmpeg: await outilDispo('ffmpeg') } }); return true; }
  const b = await corps(req); const brut = nettoyerChemin(s(b.chemin)), cat = s(b.categorie) as Categorie;
  if (!brut) { json(res, 400, { error: 'chemin attendu' }); return true; }
  // Un chemin complet seulement (« . » ou « Films » seraient lus depuis le dossier où Odin a été lancé), rangé sous une
  // seule forme (« D:\Films\ » et « D:\Films » sont le même dossier).
  const chemin = isAbsolute(brut) ? resolve(brut) : brut;
  if (s(b.faire) === 'retirer') { if (!retirerDossier(mag, brut)) retirerDossier(mag, chemin); json(res, 200, { dossiers: dossiers(mag) }); return true; }
  if (!['films', 'series', 'musique', 'livres_audio'].includes(cat)) { json(res, 400, { error: 'catégorie attendue : films, series, musique, livres_audio' }); return true; }
  if (!isAbsolute(brut)) { json(res, 400, { error: `Donne le chemin complet du dossier, depuis le début (par exemple ${exempleChemin()}), pas « ${brut} ».` }); return true; }
  // Un dossier qui n'existe pas est refusé tout de suite, avec la raison (avant : accepté, puis ignoré sans un mot au scan).
  const refus = raisonDossierRefuse(chemin); if (refus) { json(res, 400, { error: refus }); return true; }
  ajouterDossier(mag, chemin, cat); json(res, 200, { dossiers: dossiers(mag) }); return true;
}
/** Une cible que le lecteur de Vénus ouvre : un film (ou un clip) ou un épisode de la bibliothèque, une vidéo. */
function lecteurSaitOuvrir(mag: MagasinVenus, cibleId: string): boolean {
  const ep = mag.get('episodes', cibleId), oe = ep ? mag.get('oeuvres', String(ep.data.oeuvre_id ?? '')) : mag.get('oeuvres', cibleId);
  return !!oe && (ep ? oe.data.type === 'serie' : oe.data.type === 'film') && fichierDeCible(mag, cibleId)?.type === 'video';
}
/**
 * Les sous-titres d'une cible, toujours en WebVTT RÉÉCRIT par Odin (du texte, jamais le fichier recopié) : « ?piste= »
 * l'identifiant court d'un sous-titre (dans la vidéo ou posé à côté), sinon « ?lang= » comme avant. Une piste de la
 * vidéo est extraite par la commande bornée de sous-titres.ts (une à la fois, coupée au bout du délai).
 */
async function servirSousTitres(res: ServerResponse, mag: MagasinVenus, cibleId: string, lang: string, piste = ''): Promise<boolean> {
  const c = fichierDeCible(mag, cibleId); if (!c) { json(res, 404, { error: 'cible introuvable' }); return true; }
  const vtt = (texte: string, partiel = false) => { res.writeHead(200, { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(partiel ? { 'x-venus-partiel': '1' } : {}) }); res.end(texte); return true; };
  if (piste) { const r = await vttDe(mag, cibleId, piste); if (!r) { json(res, 404, { error: 'sous-titre introuvable' }); return true; } return vtt(r.vtt, r.partiel); }
  // L'ancienne adresse : un fichier noté par le scan pour cette langue, sinon ce que la vidéo et son dossier offrent.
  const note = choisirSousTitres(c.sousTitres, lang);
  if (note?.fichier) { const t = vttDuFichierNote(mag, cibleId, note.fichier); if (t !== undefined) return vtt(t); }
  const id = c.type === 'video' ? idPourLangue(listeSousTitres(mag, cibleId, await pistesDe(mag, cibleId)), lang) : undefined;
  const r = id ? await vttDe(mag, cibleId, id) : undefined;
  return vtt(r?.vtt ?? ecrireVtt([]), r?.partiel);
}
function servirVignette(res: ServerResponse, mag: MagasinVenus, cibleId: string): boolean {
  const ep = mag.get('episodes', cibleId), oe = mag.get('oeuvres', cibleId);
  const v = String((ep?.data.vignette ?? oe?.data.affiche ?? '') || '');
  if (!v || !existsSync(v)) { json(res, 404, { error: 'pas de vignette' }); return true; }
  res.writeHead(200, { 'content-type': extname(v).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg', 'cache-control': 'max-age=86400' });
  createReadStream(v).pipe(res); return true;
}

// ---------------- Écran : commande, QR ----------------
async function routeEcran(req: IncomingMessage, res: ServerResponse, ctx: VenusRouteCtx, mag: MagasinVenus, ecranId: string, voie: string, sous: string): Promise<boolean> {
  if (voie === '/commande') {
    if (!ctx.ha) { json(res, 503, { error: 'Home Assistant n\'est pas relié.' }); return true; }
    const b = await corps(req); const action = s(b.action) as ActionEcran;
    if (!ACTIONS_ECRAN.includes(action)) { json(res, 400, { error: `action inconnue : ${action}` }); return true; }
    await piloterEcran(haCaller(ctx.ha), ecranId, action, b.valeur as string | number | undefined);
    json(res, 200, { ok: true }); return true;
  }
  // QR : créer / révoquer / régénérer
  if (sous === 'revoquer') { const b = await corps(req); json(res, 200, { ok: revoquer(mag, s(b.id)) }); return true; }
  if (sous === 'regenerer') { const b = await corps(req); const r = regenerer(mag, ctx.home, s(b.id), { dureeMs: Number(b.duree_ms) || undefined }); if (!r) { json(res, 404, { error: 'télécommande inconnue' }); return true; } json(res, 200, { jeton: r.jeton, lien: `${ctx.origin}/t/${r.jeton}`, qr: qrTelecommande(ctx.origin, r.jeton), expire: r.expire, telephones: nombreTelephones(mag, r.id) }); return true; }
  // créer
  const b = await corps(req); const r = creerTelecommande(mag, ctx.home, ecranId, { dureeMs: Number(b.duree_ms) || undefined });
  json(res, 200, { jeton: r.jeton, id: r.id, lien: `${ctx.origin}/t/${r.jeton}`, qr: qrTelecommande(ctx.origin, r.jeton), expire: r.expire, actives: telecommandes(mag, ecranId).length }); return true;
}

// ---------------- Télécommande publique /t/<jeton> ----------------
async function routeTelecommandePublique(req: IncomingMessage, res: ServerResponse, _url: URL, ctx: VenusRouteCtx, mag: MagasinVenus, jeton: string): Promise<boolean> {
  const v = validerJeton(mag, jeton, { telephone: empreinteTelephone(ctx.ip, s(req.headers['user-agent'])) });
  if ('refus' in v) { res.writeHead(403, { 'content-type': 'text/html; charset=utf-8' }); res.end(pageRefus(v.refus)); return true; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(pageTelecommande(jeton, v.ecranId)); return true;
}
/** Commande envoyée par la télécommande publique (jeton dans l'URL) : portée = le seul écran de ce jeton. */
async function routeCommandeJeton(req: IncomingMessage, res: ServerResponse, ctx: VenusRouteCtx, mag: MagasinVenus, jeton: string): Promise<boolean> {
  const v = validerJeton(mag, jeton, { telephone: empreinteTelephone(ctx.ip, s(req.headers['user-agent'])) });
  if ('refus' in v) { json(res, 403, { error: v.refus }); return true; }
  if (!ctx.ha) { json(res, 503, { error: 'Home Assistant n\'est pas relié.' }); return true; }
  const b = await corps(req); const action = s(b.action) as ActionEcran;
  if (!ACTIONS_ECRAN.includes(action)) { json(res, 400, { error: `action inconnue : ${action}` }); return true; }
  await piloterEcran(haCaller(ctx.ha), v.ecranId, action, b.valeur as string | number | undefined);
  json(res, 200, { ok: true }); return true;
}

// ---------------- YouTube ----------------
async function routeYoutube(req: IncomingMessage, res: ServerResponse, url: URL, ctx: VenusRouteCtx, mag: MagasinVenus, reste: string, profil: string): Promise<boolean> {
  const r = reglagesYt(mag, profil), http = httpReel, meth = req.method ?? 'GET';
  if (meth === 'GET' && reste === 'accueil') { json(res, 200, { videos: await accueil(http, r) }); return true; }
  if (meth === 'GET' && reste === 'recherche') { json(res, 200, { videos: await recherche(http, r, s(url.searchParams.get('q'))) }); return true; }
  if (meth === 'GET' && reste.startsWith('video/')) { const id = reste.slice(6); const d = await video(http, r, id); if (!d) { json(res, 404, { error: 'vidéo introuvable' }); return true; } ajouterHistoriqueYt(mag, profil, id, d.video.titre); json(res, 200, d); return true; }
  if (meth === 'GET' && reste.startsWith('chaine/')) { const d = await chaine(http, r, reste.slice(7)); if (!d) { json(res, 404, { error: 'chaîne introuvable' }); return true; } json(res, 200, d); return true; }
  if (reste === 'abonnements') {
    if (meth === 'GET') { json(res, 200, { abonnements: abonnements(mag, profil) }); return true; }
    const b = await corps(req); if (s(b.faire) === 'retirer') desabonner(mag, profil, s(b.chaine_id)); else abonner(mag, profil, s(b.chaine_id), s(b.nom)); json(res, 200, { abonnements: abonnements(mag, profil) }); return true;
  }
  if (reste === 'historique') {
    if (meth === 'DELETE') { json(res, 200, { efface: effacerHistoriqueYt(mag, profil) }); return true; }
    json(res, 200, { historique: historiqueYt(mag, profil) }); return true;
  }
  if (meth === 'GET' && reste === 'reglages') { json(res, 200, { reglages: r }); return true; }
  if (meth === 'POST' && reste === 'reglages') { const b = await corps(req); json(res, 200, { reglages: reglerYt(mag, profil, { instance: s(b.instance) || r.instance, moteur: (s(b.moteur) as 'invidious' | 'piped') || r.moteur, sponsorblockOn: b.sponsorblock_on !== false, categories: Array.isArray(b.categories) ? b.categories as string[] : r.categories }) }); return true; }
  if (meth === 'GET' && reste.startsWith('segments/')) { const d = await video(http, r, reste.slice(9)); const vtt = url.searchParams.get('vtt') ?? undefined; json(res, 200, { segments: await segmentsASauter(http, reste.slice(9), r, { vtt: vtt ?? undefined, ask: ctx.ask }) }); void d; return true; }
  json(res, 404, { error: 'route YouTube inconnue' }); return true;
}

const decode = (x: string) => { try { return decodeURIComponent(x); } catch { return x; } };

// ---------------- La page de télécommande d'UN écran (téléphone, 390 px, iPhone et Android) ----------------
// Autonome (aucun autre morceau d'Odin). Suit le thème clair/sombre du téléphone (jamais forcé en sombre). Tous les
// boutons de la demande : reculer / lecture-pause / avancer, précédent / revoir / suivant, chaîne − / épisode / chaîne +,
// volume − / +, couper. Chaîne et épisode arrivent avec la télé en direct : si l'écran ne les gère pas, un message le dit.
const TC_STYLE = `:root{color-scheme:light dark;--bg:#0d0f14;--fg:#eef0f6;--btn:#1c2230;--btn2:#2b3346;--accent:#2563eb;--danger:#7f1d1d;--muted:#9aa1b2;--line:#ffffff1a}
@media (prefers-color-scheme:light){:root{--bg:#eef2f1;--fg:#15212b;--btn:#ffffff;--btn2:#e5eceb;--accent:#2563eb;--danger:#b23f2a;--muted:#4c5b67;--line:#00000016}}
*{box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--fg);margin:0;min-height:100vh;-webkit-user-select:none;user-select:none}
.wrap{max-width:390px;margin:0 auto;padding:16px 16px 40px}h1{font-size:18px;font-weight:600;text-align:center;margin:12px 0 2px}.sub{text-align:center;color:var(--muted);font-size:13px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px}
button{font:inherit;font-size:14px;border:1px solid var(--line);border-radius:16px;background:var(--btn);color:var(--fg);padding:14px 8px;min-height:66px;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
button:active{background:var(--btn2)}.big{grid-column:span 3;min-height:64px}.play{background:var(--accent);border-color:transparent;color:#fff}.stop{background:var(--danger);border-color:transparent;color:#fff}
.vol{display:flex;align-items:center;gap:12px;margin:4px 0 12px}.vol input{flex:1}
.note{color:var(--muted);font-size:12px;text-align:center;margin-top:18px;line-height:1.5}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:340px;background:var(--btn2);color:var(--fg);padding:10px 16px;border-radius:12px;opacity:0;transition:opacity .2s;text-align:center;font-size:13px}
.modal{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(4,8,14,.55);z-index:50}
.modal .box{width:min(340px,100%);background:var(--btn);border:1px solid var(--line);border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:14px}
.modal input{min-height:46px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--fg);padding:0 12px;font:inherit}
.modal .l{display:flex;gap:10px;justify-content:flex-end}.modal .l button{min-height:44px;min-width:104px}
@media (pointer:coarse){button{min-height:72px}}`;
function pageRefus(raison: string): string {
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Télécommande</title><style>${TC_STYLE}</style><body><div class=wrap style="display:grid;place-items:center;min-height:80vh"><p class=note>Télécommande indisponible : ${esc(raison)}.</p></div></body>`;
}
/** La télécommande d'UN écran. Grands boutons au doigt, 390 px, iPhone et Android (interface web). */
export function pageTelecommande(jeton: string, ecranId: string): string {
  const j = esc(jeton), e = esc(ecranId.replace(/^media_player\./, '').replace(/_/g, ' '));
  return `<!doctype html><html lang=fr><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>Télécommande · ${e}</title>
<style>${TC_STYLE}</style></head>
<body><div class=wrap><h1>Télécommande</h1><div class=sub>${e}</div>
<div class=grid>
<button data-a=reculer data-v=10>⏪ 10 s</button><button id=pp data-toggle=1>▶︎ / ⏸</button><button data-a=avancer data-v=10>10 s ⏩</button>
<button data-a=precedent>⏮ Préc.</button><button data-a=reculer data-v=999999>↺ Revoir</button><button data-a=suivant>Suiv. ⏭</button>
<button data-a=chaine data-v="-">Chaîne −</button><button id=ep>Épisode…</button><button data-a=chaine data-v="+">Chaîne +</button>
<button data-a=volume data-v="-">🔉 Volume −</button><button class=big data-a=volume style="grid-column:span 1" data-v="+">Volume + 🔊</button>
</div>
<div class=vol>🔉<input id=vol type=range min=0 max=100 value=50 aria-label=Volume>🔊</div>
<div class=grid><button class="big stop" id=couper>⏹ Couper</button></div>
<p class=note>Cette télécommande ne pilote que cet écran, rien d'autre d'Odin. Elle expire toute seule et peut être coupée ou révoquée depuis Odin.</p></div>
<div class=toast id=t></div>
<script>
var J=${JSON.stringify(j)},enLecture=true;
function toast(m){var t=document.getElementById('t');t.textContent=m;t.style.opacity=1;setTimeout(function(){t.style.opacity=0},1600)}
function cmd(a,v){return fetch('/venus/commande/'+encodeURIComponent(J),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(v===undefined?{action:a}:{action:a,valeur:v})}).then(function(r){if(r.status===403||r.status===410){toast('Télécommande expirée ou révoquée. Demande un nouveau QR.');return;}if(!r.ok)return r.json().catch(function(){return{};}).then(function(j){throw new Error(j.error||('Écran injoignable ('+r.status+')'));});}).catch(function(e){toast(e.message)})}
// Petits panneaux intégrés (jamais de fenêtre native du navigateur).
function modale(contenu){return new Promise(function(res){var fond=document.createElement('div');fond.className='modal';var box=document.createElement('div');box.className='box';fond.appendChild(box);fond.addEventListener('click',function(e){if(e.target===fond){fond.remove();res(null);}});document.body.appendChild(fond);contenu(box,function(v){fond.remove();res(v);});})}
function confirmer(txt){return modale(function(box,fin){var p=document.createElement('p');p.textContent=txt;p.style.margin='0';var l=document.createElement('div');l.className='l';var a=document.createElement('button');a.textContent='Annuler';a.onclick=function(){fin(false)};var o=document.createElement('button');o.className='stop';o.textContent='Couper';o.onclick=function(){fin(true)};l.appendChild(a);l.appendChild(o);box.appendChild(p);box.appendChild(l);})}
function saisir(txt){return modale(function(box,fin){var p=document.createElement('p');p.textContent=txt;p.style.margin='0';var i=document.createElement('input');i.type='tel';i.inputMode='numeric';i.setAttribute('aria-label',txt);var l=document.createElement('div');l.className='l';var a=document.createElement('button');a.textContent='Annuler';a.onclick=function(){fin(null)};var o=document.createElement('button');o.className='play';o.textContent='Aller';o.onclick=function(){fin(i.value)};l.appendChild(a);l.appendChild(o);box.appendChild(p);box.appendChild(i);box.appendChild(l);try{i.focus()}catch(e){}})}
document.querySelectorAll('button[data-a]').forEach(function(b){b.addEventListener('click',function(){cmd(b.dataset.a,b.dataset.v)})});
document.getElementById('pp').addEventListener('click',function(){enLecture=!enLecture;cmd(enLecture?'lecture':'pause')});
document.getElementById('ep').addEventListener('click',function(){saisir('Aller à quel épisode ?').then(function(r){var n=(r||'').replace(/\\D+/g,'');if(n)cmd('episode',n)})});
document.getElementById('couper').addEventListener('click',function(){confirmer('Couper la lecture sur cet écran ?').then(function(ok){if(ok)cmd('couper')})});
var vol=document.getElementById('vol'),vt;vol.addEventListener('input',function(){clearTimeout(vt);vt=setTimeout(function(){cmd('volume',vol.value)},200)});
</script></body></html>`;
}
function esc(t: string): string { return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
