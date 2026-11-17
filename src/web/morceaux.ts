// Envoi d'un gros fichier (une ISO…) depuis le navigateur, en morceaux reprenables : chaque morceau s'ajoute au
// fichier entamé de l'appli (« .morceaux/<envoi>.part » dans son dossier d'arrivée). Après une coupure, le
// navigateur demande où en est l'envoi et reprend là. Le fichier fini passe ensuite par l'antivirus (l'appli
// l'importe : voir Hydre, action « importer_iso »).
// Bornes à la réception (choix prudent : un envoi ne doit pas pouvoir remplir le disque d'Odin, même d'un client qui
// saute l'étape « préparer ») : un morceau est refusé s'il ferait tomber la place libre du disque sous 10 % ; s'il
// dépasse la taille annoncée dans la fiche d'envoi (« <envoi>.envoi.json », écrite par l'appli à la préparation) ou
// 64 Go ; si le dossier des morceaux de l'appli dépasserait son plafond (128 Go). Quand la taille du morceau est
// connue (en-tête Content-Length, toujours envoyé par le navigateur), le refus arrive AVANT d'écrire ; sinon, le
// morceau refusé en cours de route est retiré (le fichier revient à ce qu'il était) et la réponse claire parvient
// quand même au navigateur. Les morceaux reçus EN PARALLÈLE comptent les uns pour les autres (place, plafond), et un
// même envoi n'est reçu que par une requête à la fois.
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, statfsSync, truncateSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';

export interface Morceau { ok: boolean; /** octets déjà reçus pour cet envoi */ recu: number; error?: string }
/** Le fichier entamé d'un envoi (ou rien si l'identifiant n'a pas la bonne forme). */
export const fichierEnvoi = (dossier: string, envoi: string): string | undefined => (/^[a-f0-9]{24}$/.test(envoi) ? join(dossier, '.morceaux', `${envoi}.part`) : undefined);

/** Part du disque toujours gardée libre à la réception (choix prudent : 10 %, comme Vénus). */
export const PART_LIBRE_MORCEAUX = 0.10;
/** Plafond de tout ce que contient le dossier des morceaux d'une appli (choix prudent : deux fichiers de 64 Go). */
export const PLAFOND_DOSSIER_MORCEAUX = 128 * 1024 ** 3;
/** Les outils et bornes remplaçables (en essai). */
export interface BornesMorceau {
  /** La place d'un disque (octets) ; rien = inconnue (la borne de place n'est alors pas vérifiée). */
  place?(chemin: string): { libre: number; total: number } | undefined;
  /** Part du disque gardée libre (0 à 1). */
  partLibre?: number;
  /** Plafond du dossier des morceaux (octets). */
  plafondDossier?: number;
}

const placeReelle = (chemin: string): { libre: number; total: number } | undefined => { try { const s = statfsSync(chemin); return { libre: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) }; } catch { return undefined; } };
const go = (n: number) => `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} Go`;
/** Ce qu'occupe le dossier des morceaux (tous ses fichiers : envois en cours, fiches, fichiers en analyse). */
function occupation(d: string): number {
  let t = 0; let noms: string[]; try { noms = readdirSync(d); } catch { return 0; }
  for (const n of noms) { try { const st = statSync(join(d, n)); if (st.isFile()) t += st.size; } catch { /* disparu */ } }
  return t;
}
/** La taille annoncée dans la fiche d'envoi : un nombre, « aucune » s'il n'y a pas de fiche, « illisible » sinon. */
function tailleAnnoncee(d: string, envoi: string): number | 'aucune' | 'illisible' {
  const f = join(d, `${envoi}.envoi.json`);
  if (!existsSync(f)) return 'aucune';
  try { const t = Number((JSON.parse(readFileSync(f, 'utf8')) as { taille?: unknown }).taille); return Number.isSafeInteger(t) && t > 0 ? t : 'illisible'; } catch { return 'illisible'; }
}

/** Une réception en cours : de quoi l'arrêter, la promesse de sa fin (fichier fermé), les octets qu'elle réserve. */
interface Reception { annuler(): void; fini: Promise<void>; reserve(): number }
/**
 * Les réceptions en cours, par dossier des morceaux puis par fichier entamé. Les bornes comptent ce que les AUTRES
 * réceptions en cours vont encore écrire (sinon des morceaux envoyés en parallèle passeraient tous sur la même place).
 */
const enCours = new Map<string, Map<string, Reception>>();

/**
 * Reçoit un morceau. `debut` doit être la taille déjà reçue (sinon rien n'est écrit, et la réponse dit où reprendre).
 * `maxTotal` : taille maximale du fichier entier (64 Go). `bornes` : place, part gardée libre, plafond du dossier.
 * Un seul morceau à la fois par envoi : s'il en arrive un autre pour le même envoi (rejoué en parallèle, ou nouvelle
 * requête après une coupure alors que l'ancienne est restée ouverte), l'ancienne réception est arrêtée — ce qu'elle a
 * déjà écrit reste, c'est un début juste du fichier — puis la nouvelle repart de la taille réelle du fichier.
 */
export async function recevoirMorceau(req: IncomingMessage, dossier: string, envoi: string, debut: number, maxTotal = 64 * 1024 ** 3, bornes: BornesMorceau = {}): Promise<Morceau> {
  const f = fichierEnvoi(dossier, envoi);
  if (!f) { req.resume(); return { ok: false, recu: 0, error: 'envoi inconnu' }; }
  const dm = join(dossier, '.morceaux');
  let table = enCours.get(dm); if (!table) enCours.set(dm, (table = new Map()));
  for (let prec = table.get(f); prec; prec = table.get(f)) { prec.annuler(); await prec.fini; }
  // Plus aucune attente d'ici à l'inscription : deux requêtes ne peuvent pas s'inscrire pour le même envoi.
  let k = 0, cl: number | undefined, arreter: ((raison: string) => void) | undefined, liberer = () => {};
  const moi: Reception = { annuler: () => { arreter?.('morceau remplacé par une requête plus récente du même envoi'); }, fini: new Promise<void>((ok) => { liberer = ok; }), reserve: () => cl ?? k };
  table.set(f, moi);
  try {
    mkdirSync(dm, { recursive: true, mode: 0o700 });
    const recu = existsSync(f) ? statSync(f).size : 0;
    if (!Number.isFinite(debut) || debut !== recu) { req.resume(); return { ok: false, recu, error: `reprise : ${recu} octet(s) déjà reçus, envoie la suite à partir de là` }; }
    // Les bornes. Chacune rend la raison du refus pour un morceau de `n` octets ; les réservations des autres
    // réceptions en cours (taille annoncée du morceau, sinon ce qu'elles ont déjà reçu) sont relues à chaque fois.
    const annonce = tailleAnnoncee(dm, envoi);
    if (annonce === 'illisible') { req.resume(); return { ok: false, recu, error: 'fiche de cet envoi illisible : prépare l\'envoi de nouveau' }; }
    const parAnnonce = typeof annonce === 'number' && annonce < maxTotal, limite = parAnnonce ? annonce : maxTotal;
    const p = (bornes.place ?? placeReelle)(dm), garde = p && p.total > 0 ? Math.ceil(p.total * (bornes.partLibre ?? PART_LIBRE_MORCEAUX)) : undefined;
    const plafond = bornes.plafondDossier ?? PLAFOND_DOSSIER_MORCEAUX, occupe = occupation(dm);
    const autres = (): number => { let t = 0; for (const [g, r] of table) if (g !== f) t += r.reserve(); return t; };
    const refus = (n: number): string | undefined => {
      if (recu + n > limite) return parAnnonce ? `morceau refusé : l'envoi dépasserait la taille annoncée (${limite} octets)` : 'fichier trop lourd (64 Go au plus)';
      const a = autres();
      if (p && garde !== undefined && p.libre - a - n < garde) return `morceau refusé : place insuffisante sur le disque d'Odin, il reste ${go(Math.max(0, p.libre - a - garde))} en gardant ${Math.round((bornes.partLibre ?? PART_LIBRE_MORCEAUX) * 100)} % du disque libres. Libère de la place, puis relance l'envoi.`;
      if (occupe + a + n > plafond) return `morceau refusé : les envois en cours de cette appli occupent déjà ${go(occupe + a)}, plafond ${go(plafond)}. Termine-les ou attends qu'ils soient effacés, puis relance l'envoi.`;
      return undefined;
    };
    // Taille du morceau connue : le refus arrive avant d'écrire le moindre octet, et elle est réservée.
    const tm = Number(req.headers?.['content-length']);
    if (Number.isSafeInteger(tm) && tm >= 0) { const r = refus(tm); if (r) { req.resume(); return { ok: false, recu, error: r }; } cl = tm; }
    let borne = false;
    try {
      const n = await new Promise<number>((ok, ko) => {
        let fin = false; const out = createWriteStream(f, { flags: 'a', mode: 0o600 });
        // Arrêt (borne dépassée, ou remplacée par une requête plus récente) : la suite de la requête est lue et jetée,
        // pour que la réponse claire parvienne au navigateur au lieu d'une connexion coupée.
        arreter = (raison) => { if (fin) return; fin = true; req.resume(); out.destroy(); out.once('close', () => ko(new Error(raison))); };
        out.on('error', (e) => { if (!fin) { fin = true; req.resume(); ko(e); } });
        // Si le disque est plus lent que le réseau, l'envoi attend : rien ne s'entasse en mémoire.
        req.on('data', (c: Buffer) => {
          if (fin) return;
          k += c.byteLength; const r = refus(k);
          if (r) { borne = true; arreter!(r); }
          else if (!out.write(c)) { req.pause(); out.once('drain', () => { if (!fin) req.resume(); }); }
        });
        req.on('end', () => { if (!fin) { fin = true; out.end(() => ok(k)); } });
        req.on('error', (e) => { if (!fin) { fin = true; out.end(() => ko(e)); } });
      });
      return { ok: true, recu: recu + n };
    } catch (e) {
      // Refusé par une borne en cours de route : le morceau est retiré, le fichier revient à ce qu'il était. (Arrêté
      // parce qu'une requête plus récente du même envoi arrive : ce qui est écrit reste, comme après une coupure.)
      if (borne) { try { truncateSync(f, recu); } catch { /* le fichier reste ; la reprise dit où il en est */ } }
      return { ok: false, recu: existsSync(f) ? statSync(f).size : 0, error: (e as Error).message };
    }
  } finally { if (table.get(f) === moi) table.delete(f); liberer(); }
}
