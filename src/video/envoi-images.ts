// Images (photo, capture, image de vidéo) vers un agent connecté : SEULEMENT avec le « oui » du propriétaire, pour
// CETTE image (son empreinte), une seule fois, et vers l'agent nommé dans la question. Non, pas de réponse, ou personne
// pour répondre (tâche sans surveillance) : l'image ne part pas, et Odin dit ce qu'il sait sans elle (le texte qu'il lit
// lui-même, les métadonnées sans la position), secrets masqués. Jamais de « toujours ».
// Ce qui part n'a JAMAIS sa position : les métadonnées (EXIF, XMP, IPTC : position, heure, appareil) sont retirées
// avant l'envoi ; un format dont Odin ne sait pas les retirer ne part pas (aucune question pour rien).
// Une vidéo : une seule question pour toute la vidéo, qui dit combien d'images partiraient (et leur nombre maximal).
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { enOctets } from '../medias/octets.ts';
import { retirerMetadonnees } from '../medias/sans-metadonnees.ts';
import { NON_ENVOYEE, ocr } from './video.ts';
import { Router, tierOf, type CompleteOptions, type Route } from '../providers/router.ts';
import { providerLabel } from '../providers/journal.ts';
import { estUnModele } from '../brain/porte-modele.ts';

export interface ImageAEnvoyer { mime: string; data: string }
export type Vision = (question: string, images: ImageAEnvoyer[]) => Promise<string>;
/** L'agent connecté qui regarderait : un seul, nommé dans la question ; aucun autre ne reçoit l'image. */
export interface AgentQuiVoit {
  nom: string;
  envoyer: Vision;
  /** Modèle servi à cette adresse même (localhost) : l'image ne quitte pas la machine (la question est posée quand même). */
  surLaMachine?: boolean;
}

export interface DepsEnvoi {
  /** L'agent qui regarderait maintenant (aucun : rien ne part). */
  agent(): AgentQuiVoit | undefined;
  /** La question au propriétaire : vrai seulement pour un « oui » (non, pas de réponse : faux). */
  demander(question: string, raison: string): Promise<boolean>;
  /** Personne pour répondre (tâche automatique ou sans surveillance) : rien ne part, aucune question. */
  sansSurveillance: boolean;
  /** Ce qu'Odin sait sans l'image (texte lu par lui, métadonnées sans la position), secrets masqués. */
  sansElle?(images: ImageAEnvoyer[]): Promise<string>;
}

export interface Porte {
  /** À donner aux outils (ctx.vision) : chaque image part seulement avec un oui pour elle. */
  vision: Vision;
  /**
   * Une seule question pour un lot (une vidéo). Oui : chacune de ces images peut partir UNE fois, vers cet agent, et
   * seulement jusqu'à fin() (à appeler quand l'analyse s'arrête, finie ou non : les oui restants ne valent plus).
   */
  demanderLot(o: { quoi: string; images: ImageAEnvoyer[]; max: number }): Promise<{ oui: boolean; raison: string; fin(): void }>;
}

/** L'empreinte d'une image (type + octets) : un oui vaut pour cette image-là, pas pour une autre. Pur. */
export const empreinteImage = (i: ImageAEnvoyer): string => createHash('sha256').update(`${i.mime}\0${i.data}`).digest('hex');
/** Le poids réel d'une image donnée en base64. Pur. */
export const octetsDe = (i: ImageAEnvoyer): number => { const d = i.data.replace(/\s+/g, ''); return Math.max(0, Math.floor((d.length * 3) / 4) - (d.endsWith('==') ? 2 : d.endsWith('=') ? 1 : 0)); };

// Le nom de l'image à montrer dans la question : celui de l'appel d'outil en cours (posé par l'agent).
const appel = new AsyncLocalStorage<{ outil: string; entree: Record<string, unknown> }>();
/** Lance un appel d'outil en retenant son nom et son entrée (pour nommer une image dans la question). */
export const dansLAppel = <T>(outil: string, entree: Record<string, unknown>, f: () => T): T => appel.run({ outil, entree }, f);
/** Le nom court de l'image de l'appel en cours (jamais un chemin entier). Pur, sauf l'appel en cours. */
export function nomEnCours(): string {
  const a = appel.getStore();
  if (!a) return 'une image';
  if (a.outil === 'browser_look') return 'capture de la page ouverte dans le navigateur';
  const p = String(a.entree.path ?? a.entree.source ?? '').trim();
  if (!p) return `une image (${a.outil})`;
  let nom = p;
  try { if (/^https?:\/\//i.test(p)) nom = decodeURIComponent(new URL(p).pathname.split('/').filter(Boolean).at(-1) ?? new URL(p).hostname); } catch { /* lien illisible : le texte brut */ }
  return basename(nom.replace(/\\/g, '/')).replace(/[\r\n]+/g, ' ').slice(0, 80) || 'une image';
}

const RAISON = 'une image ne part vers un agent connecté qu\'avec ton oui, pour cette image et une seule fois, sans sa position ; sans oui, je dis ce que je sais sans elle';
const raisonPour = (a: AgentQuiVoit): string => `${a.surLaMachine ? 'elle reste sur cette machine (modèle servi ici)' : 'elle quitte la machine'} ; ${RAISON}`;
const court = (h: string): string => h.slice(0, 12);
const SANS_POSITION = 'sans sa position, son heure ni son appareil (retirés avant l\'envoi)';

/**
 * La copie qui partirait : la même image SANS ses métadonnées (position, heure, appareil, commentaires). JPEG, PNG et
 * WebP (reconnus à leurs octets, pas au type annoncé) ; un autre format, ou un fichier malformé : undefined (ne part pas).
 */
export function sansPosition(i: ImageAEnvoyer): ImageAEnvoyer | undefined {
  const propre = retirerMetadonnees(Buffer.from(i.data, 'base64'));
  if (!propre) return undefined;
  const mime = propre[0] === 0xff ? 'image/jpeg' : propre[0] === 0x89 ? 'image/png' : 'image/webp';
  return { mime, data: propre.toString('base64') };
}

export function creerPorte(d: DepsEnvoi): Porte {
  // Oui donnés pour un lot, lot par lot (valables jusqu'à sa fin) : empreinte → agent nommé et nombre d'envois permis
  // (une image identique deux fois : deux).
  const lots = new Map<number, Map<string, { agent: string; reste: number }>>();
  let prochainLot = 0;
  /** Un oui de lot pour cette empreinte : pris (pour cet agent), donné pour un autre agent, ou aucun. */
  const prendre = (h: string, agent: string): 'pris' | 'autre' | undefined => {
    let autre = false;
    for (const accords of lots.values()) {
      const a = accords.get(h);
      if (!a || a.reste <= 0) continue;
      if (a.agent !== agent) { autre = true; continue; }
      a.reste--; if (a.reste <= 0) accords.delete(h);
      return 'pris';
    }
    return autre ? 'autre' : undefined;
  };
  const refus = async (images: ImageAEnvoyer[], pourquoi: string): Promise<string> => {
    let sait = '';
    try { sait = (await d.sansElle?.(images)) ?? ''; } catch { /* facultatif */ }
    return `${NON_ENVOYEE} : ${images.length > 1 ? `${images.length} images non envoyées` : 'image non envoyée'} à un agent connecté (${pourquoi}).${sait ? `\nCe que je sais sans elle :\n${sait}` : ''}`;
  };
  const vision: Vision = async (question, images) => {
    if (!images.length) throw new Error('aucune image à regarder');
    if (d.sansSurveillance) return refus(images, 'personne n\'est là pour dire oui');
    const agent = d.agent();
    if (!agent) throw new Error('aucun agent connecté qui voit les images n\'est disponible');
    const partent: ImageAEnvoyer[] = [], restent: ImageAEnvoyer[] = [];
    let horsAccord = 0, illisibles = 0;
    for (const img of images) {
      // Ce qui partirait : la copie sans position. Un format dont la position ne peut pas être retirée ne part pas,
      // et on ne pose pas de question pour rien.
      const propre = sansPosition(img);
      if (!propre) { illisibles++; restent.push(img); continue; }
      const h = empreinteImage(img), pris = prendre(h, agent.nom);
      if (pris === 'pris') { partent.push(propre); continue; }
      // Oui donné pour un autre agent : rien ne part, et on ne redemande pas au milieu d'une vidéo.
      if (pris === 'autre') { horsAccord++; restent.push(img); continue; }
      const nom = images.length > 1 ? `${nomEnCours()} (image ${images.indexOf(img) + 1} sur ${images.length})` : nomEnCours();
      const oui = await d.demander(`Envoyer cette image à ${agent.nom} pour la regarder ? ${nom} · ${enOctets(octetsDe(propre))} · ${SANS_POSITION} · empreinte ${court(h)}`, raisonPour(agent));
      if (oui) partent.push(propre); else restent.push(img);
    }
    if (!partent.length) {
      const pourquoi = horsAccord ? `ton oui était pour un autre agent que ${agent.nom}`
        : illisibles === restent.length ? 'je ne sais pas retirer la position de ce format d\'image ; en JPEG ou en PNG, je pourrai te demander'
        : 'tu n\'as pas dit oui';
      const t = await refus(restent, pourquoi);
      // Une image d'un lot (vidéo) : l'appelant la laisse non décrite, le texte lu par Odin prend le relais.
      if (horsAccord) throw new Error(t);
      return t;
    }
    const vu = await agent.envoyer(question, partent);
    return restent.length ? `${vu}\n\n(${restent.length} image(s) non envoyée(s) : pas de oui pour elles, ou position impossible à retirer.)` : vu;
  };
  return {
    vision,
    async demanderLot({ quoi, images, max }) {
      const rien = (): void => {};
      if (!images.length) return { oui: false, raison: 'aucune image', fin: rien };
      if (d.sansSurveillance) return { oui: false, raison: 'personne n\'est là pour dire oui', fin: rien };
      const agent = d.agent();
      if (!agent) return { oui: false, raison: 'aucun agent connecté qui voit les images', fin: rien };
      // Seules les images dont la position peut être retirée sont comptées (les autres ne partiront pas).
      const propres = images.flatMap((i) => { const p = sansPosition(i); return p ? [{ i, p }] : []; });
      if (!propres.length) return { oui: false, raison: 'je ne sais pas retirer la position de ces images', fin: rien };
      const n = propres.length, poids = propres.reduce((s, x) => s + octetsDe(x.p), 0);
      const oui = await d.demander(`Envoyer ${n} image${n > 1 ? 's' : ''} de la vidéo « ${String(quoi).replace(/[\r\n]+/g, ' ').slice(0, 80)} » à ${agent.nom} pour les regarder ? ${n} image${n > 1 ? 's' : ''} partirai${n > 1 ? 'ent' : 't'} (${Math.max(max, n)} au plus), ${enOctets(poids)} en tout, sans leur position ni leurs métadonnées (retirées avant l'envoi)`, raisonPour(agent));
      if (!oui) return { oui: false, raison: 'tu n\'as pas dit oui', fin: rien };
      const id = prochainLot++, accords = new Map<string, { agent: string; reste: number }>();
      for (const { i } of propres) { const h = empreinteImage(i); accords.set(h, { agent: agent.nom, reste: (accords.get(h)?.reste ?? 0) + 1 }); }
      lots.set(id, accords);
      return { oui: true, raison: '', fin: () => { lots.delete(id); } };
    },
  };
}

// Les portes données aux outils : un outil (la vidéo) retrouve celle de sa fonction vision, pour UNE question par vidéo.
const portes = new WeakMap<Vision, Porte>();
export function enregistrerPorte(p: Porte): Porte { portes.set(p.vision, p); return p; }
/** La porte d'une fonction vision (aucune : la vision ne vient pas d'un agent connecté, ex. l'œil local). */
export const porteDe = (v: Vision | undefined): Porte | undefined => (v ? portes.get(v) : undefined);

/**
 * L'agent connecté qui regarderait : le premier que le routeur prendrait (modèle qui voit, pas en pause, budget
 * respecté), et lui seul : l'envoi passe par un routeur à une seule route, sans réessai ni bascule vers un autre agent
 * (un oui = un envoi, vers l'agent nommé).
 */
export function agentQuiVoit(router: Router, o: CompleteOptions & { system: string; maxTokens: number; signal?: AbortSignal; depense?: (usd: number) => void }): AgentQuiVoit | undefined {
  const opts: CompleteOptions = { ...o, purpose: 'vision', vision: true, need: 'vision' };
  const enPause = new Set(router.pausedNow().map((p) => p.name));
  let routes: Route[] = router.order(opts).filter((r) => estUnModele(r.provider) && !enPause.has(r.provider.name));
  if (router.overBudget?.()) routes = routes.filter((r) => tierOf(r.cfg) === 'local');
  const route = routes[0];
  if (!route) return undefined;
  return {
    nom: providerLabel(route.provider.name),
    // Seulement un modèle servi à cette adresse même (le niveau « local » d'une config ne suffit pas à le dire).
    surLaMachine: /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(route.cfg.baseUrl ?? ''),
    envoyer: async (question, images) => {
      const seul = new Router([route], 0, undefined, { pauseMs: router.pauseMs, classement: router.classement, delais: router.delais });
      seul.onUsage = router.onUsage; seul.onRoute = router.onRoute; seul.overBudget = router.overBudget;
      const r = await seul.complete({ system: o.system, messages: [{ role: 'user', content: question, images }], tools: [], maxTokens: o.maxTokens, signal: o.signal }, opts);
      o.depense?.(r.costUsd ?? 0);
      return r.text;
    },
  };
}

/** Ce qu'Odin sait d'une image sans l'envoyer : ses métadonnées (position masquée) et le texte qu'il y lit, masqués. */
export async function ceQueJeSaisSansElle(images: ImageAEnvoyer[], masquer: (t: string) => string): Promise<string> {
  const { lireMetadonnees, ficheEnTexte } = await import('../medias/metadonnees.ts');
  const out: string[] = [];
  for (const [k, img] of images.slice(0, 6).entries()) {
    const octets = Buffer.from(img.data, 'base64');
    let meta = '';
    try { meta = ficheEnTexte(lireMetadonnees({ octets, nom: nomEnCours() }), { sensibles: 'masquer' }); } catch { meta = `${img.mime}, ${enOctets(octets.length)}`; }
    let texte = '';
    const dir = mkdtempSync(join(tmpdir(), 'odin-vue-'));
    try { const f = join(dir, 'image'); writeFileSync(f, octets); texte = await ocr(f); } catch { /* lecteur absent */ } finally { rmSync(dir, { recursive: true, force: true }); }
    out.push(`${images.length > 1 ? `Image ${k + 1} : ` : ''}${meta.slice(0, 1500)}\nTexte lu par Odin : ${texte ? texte.slice(0, 2000) : '(aucun : rien de lisible, ou lecteur de texte pas installé)'}`);
  }
  return masquer(out.join('\n\n'));
}
