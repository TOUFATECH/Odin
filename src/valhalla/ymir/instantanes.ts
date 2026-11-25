// Hydre · les instantanés d'une VM de CE PC (maquette « Conteneurs et machines » validée, écran 14 ; lot M6) : une photo
// de la machine à un moment, pour pouvoir y revenir.
//   - Le disque de la VM est un fichier qcow2 : ses instantanés vivent DANS ce fichier (rien n'est copié ailleurs).
//     Éteinte : « qemu-img snapshot » (-c prendre, -a revenir, -d retirer). Allumée ou en pause : le canal de contrôle
//     QMP qu'Hydre a déjà avec la VM (« savevm », « loadvm », « delvm ») : l'instantané garde aussi sa mémoire, et la
//     machine repart là où elle en était. La liste se lit par « qemu-img info -U » (lecture seule, même allumée).
//   - Revenir : la confirmation dit ce qui est perdu ; Odin prend d'abord un instantané de maintenant (pour pouvoir
//     revenir encore) ; une VM allumée est mise en pause le temps du retour. Un instantané pris machine éteinte ne garde
//     pas la mémoire : pour y revenir, la machine doit être éteinte (c'est dit).
//   - Retirer : avec confirmation. Les instantanés pris à la main ne sont JAMAIS retirés seuls, ni celui qu'Odin prend
//     juste avant un retour (c'est lui qui permet d'annuler le retour).
//   - Automatiques : avant une mise à jour faite par Odin dans la machine, et avant une sauvegarde de Phénix qui lit le
//     dossier de la machine. Ils sont gardés 7 jours (la maquette : « un instantané tout seul, gardé 7 jours ») : un
//     automatique de plus de 7 jours est retiré quand Odin en prend un nouveau pour la même machine, et seulement là ;
//     un automatique de moins de 7 jours n'est jamais retiré seul, quel que soit leur nombre (la place, elle, reste
//     bornée par le budget). Il n'y a pas de réglage « combien en garder ».
//     « Avant une sauvegarde » n'est pas une action : Phénix l'appelle dans sa sauvegarde, rien d'autre ne l'atteint.
//   - La place : celle du fichier du disque (disque et instantanés) est montrée ; un instantané n'est pris que s'il tient
//     dans le budget d'Hydre (la place libre moins ce qui est gardé pour Odin et tes fichiers), sinon refusé, chiffres à
//     l'appui.
//   - Au propriétaire seul, noté dans « qui a fait quoi » ; les automatiques (pris, puis retirés après 7 jours) y sont
//     notés « Odin seul ».
//   - Sous Windows (moteur Windows d'Hydre à venir), un LXC ou un modèle : un état clair, rien n'est tenté.
// Rien d'autre que les outils de QEMU, déjà ceux des VM de ce PC.
import { randomBytes } from 'node:crypto';
import { lstatSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Action, ActionResult, ModCtx, Param } from '../types.ts';
import { journalDe } from '../base/journal.ts';
import { agissant } from '../sso/acces.ts';
import { avecJournal, type Acte } from '../vidarr/qui-a-fait.ts';
import { allumee, Local, systemeVm, type Machine } from './local.ts';
import { budgetIci } from './creation.ts';
import { enRetrait, raccourciAuDessus } from './retrait.ts';

/** Les bornes des instantanés (les essais les lisent). */
export const INSTANTANES = {
  /** un instantané pris tout seul est gardé 7 jours (maquette validée) */
  garderAutoJours: 7,
  /** place gardée en plus de la mémoire de la VM pour un instantané (tables du qcow2, écritures pendant la prise) */
  margeGo: 1,
  /** prendre ou revenir avec la mémoire d'une grosse VM peut être long */
  delaiMs: 600_000,
  /** un nom donné à un instantané */
  nomMax: 60,
};
/** Ce qu'Hydre demande au système pour les instantanés (les essais le remplacent : aucun vrai qemu-img n'est lancé). */
export const systemeInstantanes = {
  qemuImg: (ctx: ModCtx, args: string[], timeoutMs: number) => ctx.run('qemu-img', args, { timeoutMs, sudo: true }),
};

/** Sorte d'instantané automatique. */
export type Auto = 'maj' | 'sauvegarde' | 'retour';
/** Ce qu'Odin garde de chaque instantané qu'il a pris (le reste est lu dans le disque). */
interface Fiche { tag: string; nom?: string; auto?: Auto; detail?: string; at: number }
/** Un instantané tel que la page le montre. */
export interface Instantane { tag: string; nom: string; at: number; memoire: number; auto?: Auto; detail?: string }
export interface Reglages { avantMaj: boolean; avantSauvegarde: boolean }

/** Sous Windows : la phrase des instantanés (la page dit la même). */
export const INSTANTANES_WINDOWS = 'Sous Windows, les VM de ce PC ne tournent pas encore dans Hydre : leurs instantanés non plus. Ils viendront avec le moteur Windows d\'Hydre ; sous Linux, Hydre les prend dans le disque de la VM.';
/**
 * Un nom d'instantané qu'Odin sait passer sans risque à QEMU (le canal de contrôle lit une ligne de commande ; un nom qui
 * commence par « - » serait lu par qemu-img comme une option).
 */
const TAG_SUR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const GO = 1024 ** 3, JOUR = 86_400_000;
const go = (n: number) => `${(n / GO).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`;
const propre = (t: string) => [...t.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, INSTANTANES.nomMax).join('');

/**
 * Les réglages (valeurs sûres, même si le fichier de réglages a été abîmé). Un ancien « garderAuto » encore rangé (combien
 * d'automatiques garder) est ignoré : ils sont gardés 7 jours.
 */
export function reglagesInstantanes(ctx: ModCtx): Reglages {
  const r = (ctx.settings.instantanes ?? {}) as Partial<Reglages>;
  return { avantMaj: r.avantMaj !== false, avantSauvegarde: r.avantSauvegarde !== false };
}

/** Lit la sortie de « qemu-img info --output=json » : format, instantanés, place du fichier. Pur. */
export function lireInfo(out: string): { format: string; place: number; instantanes: Array<{ tag: string; at: number; memoire: number }> } {
  let j: { format?: unknown; 'actual-size'?: unknown; snapshots?: unknown };
  try { j = JSON.parse(out); } catch { throw new Error('réponse de qemu-img illisible'); }
  const l = Array.isArray(j.snapshots) ? j.snapshots as Array<Record<string, unknown>> : [];
  return {
    format: s(j.format), place: Number(j['actual-size']) || 0,
    instantanes: l.filter((x) => typeof x?.name === 'string').map((x) => ({ tag: String(x.name), at: (Number(x['date-sec']) || 0) * 1000, memoire: Number(x['vm-state-size']) || 0 })),
  };
}

/** Les instantanés en cours dans ce processus (un seul geste à la fois par machine). */
const EN_COURS = new Set<string>();

const fichesDe = (L: Local, m: Machine) => join(L.vmDir(m), 'instantanes.json');
function lireFiches(L: Local, m: Machine): Fiche[] { try { const l = JSON.parse(readFileSync(fichesDe(L, m), 'utf8')); return Array.isArray(l) ? l.filter((x) => x && typeof x.tag === 'string') : []; } catch { return []; } }
function ecrireFiches(L: Local, m: Machine, l: Fiche[]): void { const f = fichesDe(L, m); writeFileSync(`${f}.tmp`, JSON.stringify(l, null, 1)); renameSync(`${f}.tmp`, f); }

/** Ce qui empêche d'avoir des instantanés (Windows, LXC, modèle, retrait en cours) ; sinon rien. */
function horsInstantanes(m: Machine): { etat: string; texte: string } | undefined {
  if (systemeVm.plateforme() === 'win32') return { etat: 'moteur', texte: INSTANTANES_WINDOWS };
  if (m.genre !== 'vm') return { etat: 'lxc', texte: `${m.nom} est un LXC : ses instantanés ne sont pas encore là (seulement pour les VM).` };
  if (m.estModele) return { etat: 'modele', texte: `${m.nom} est un modèle : il ne démarre pas et ne change pas, il n'a pas d'instantané.` };
  if (enRetrait(m.id)) return { etat: 'retrait', texte: `${m.nom} est en train d'être supprimée.` };
  return undefined;
}
/** Le disque de la VM : un vrai fichier dans son dossier (aucun raccourci suivi : qemu-img écrirait ailleurs). */
function disqueDe(L: Local, m: Machine): string {
  const d = L.vmDir(m), f = join(d, 'disque.qcow2');
  if (raccourciAuDessus(join(L.dir, 'vm'))) throw new Error('le dossier des machines virtuelles est un raccourci vers un autre endroit : Odin ne suit aucun raccourci');
  for (const [p, dossier] of [[d, true], [f, false]] as const) {
    let st; try { st = lstatSync(p); } catch { throw new Error(`le disque de ${m.nom} est introuvable`); }
    if (st.isSymbolicLink() || (dossier ? !st.isDirectory() : !st.isFile())) throw new Error(`le disque de ${m.nom} n'est pas un vrai fichier de son dossier (raccourci ?) : Odin n'y touche pas`);
  }
  return f;
}
async function qemuImg(ctx: ModCtx, args: string[], quoi: string): Promise<string> {
  let r: { code: number; out: string; err: string };
  try { r = await systemeInstantanes.qemuImg(ctx, args, INSTANTANES.delaiMs); } catch (e) { throw new Error(`${quoi} : ${(e as Error).message.slice(0, 200)}`); }
  if (r.code !== 0) {
    const t = (r.err || r.out).trim();
    if (/ENOENT|not found|introuvable|command not found/i.test(t) && !/snapshot/i.test(t)) throw new Error(`${quoi} : qemu-img manque sur ce PC (paquet « qemu-utils »)`);
    throw new Error(`${quoi} : ${t.split('\n').slice(-2).join(' ').slice(0, 240) || `code ${r.code}`}`);
  }
  return r.out;
}
/** Une commande au moniteur de la VM (QMP « human-monitor-command ») : il répond par du texte, vide si tout va bien. */
async function moniteur(L: Local, m: Machine, ligne: string, quoi: string): Promise<void> {
  const r = await systemeVm.qmp(L.qmpSock(m), 'human-monitor-command', { 'command-line': ligne }, INSTANTANES.delaiMs);
  const t = s(r).trim();
  if (t) throw new Error(`${quoi} : ${t.split('\n').slice(-2).join(' ').slice(0, 240)}`);
}

/** L'état de la VM pour les instantanés : allumée (en marche ou en pause) ou éteinte ; illisible : refusé. */
async function etatVm(L: Local, m: Machine): Promise<'en marche' | 'en pause' | 'éteinte'> {
  const e = await L.etat(m);
  if (e.state === 'inconnue') throw new Error(`l'état de ${m.nom} ne se lit pas : rien n'est fait`);
  return allumee(e) ? (e.state as 'en marche' | 'en pause') : 'éteinte';
}

/** Les instantanés de la VM (dans le disque), avec ce qu'Odin en sait ; et la place du fichier. */
export async function listeInstantanes(ctx: ModCtx, L: Local, m: Machine): Promise<{ instantanes: Instantane[]; place: number }> {
  const f = disqueDe(L, m), i = lireInfo(await qemuImg(ctx, ['info', '--output=json', '-U', f], `lire le disque de ${m.nom}`));
  if (i.format && i.format !== 'qcow2') throw new Error(`le disque de ${m.nom} n'est pas un qcow2 : pas d'instantané`);
  const fiches = lireFiches(L, m), l = i.instantanes.map((x): Instantane => { const fi = fiches.find((y) => y.tag === x.tag); return { tag: x.tag, nom: fi ? fi.nom ?? '' : x.tag, at: fi?.at ?? x.at, memoire: x.memoire, ...(fi?.auto ? { auto: fi.auto } : {}), ...(fi?.detail ? { detail: fi.detail } : {}) }; });
  // Ce qui n'est plus dans le disque n'est plus gardé (retiré ailleurs, disque remplacé).
  const garde = fiches.filter((y) => i.instantanes.some((x) => x.tag === y.tag)); if (garde.length !== fiches.length) ecrireFiches(L, m, garde);
  return { instantanes: l.sort((a, b) => a.at - b.at), place: i.place };
}

/** Assez de place dans le budget d'Hydre pour un instantané (sa mémoire si elle est allumée, plus une marge) ? */
function verifierPlace(ctx: ModCtx, L: Local, m: Machine, avecMemoire: boolean): void {
  const b = budgetIci(ctx, L);
  if (b.disqueMaxGo === undefined) throw new Error('Odin ne sait pas lire la place libre du disque des machines : aucun instantané n\'est pris');
  const memGo = avecMemoire ? Math.ceil((Number(m.ram) || 0) / 1024) : 0, besoin = memGo + INSTANTANES.margeGo;
  if (besoin > b.disqueMaxGo) throw new Error(`pas assez de place pour un instantané de ${m.nom} : il faut environ ${besoin} Go (${avecMemoire ? `sa mémoire, ${memGo} Go, plus ` : ''}${INSTANTANES.margeGo} Go de marge) et le budget d'Hydre en laisse ${b.disqueMaxGo} Go (${b.disqueLibreGo} Go libres, ${b.reserveDisqueGo} Go gardés pour Odin et tes fichiers). Retire un ancien instantané, ou fais de la place`);
}

/** Un nom d'instantané neuf, sûr pour QEMU : « odin-AAAAMMJJ-HHMMSS-xxxx ». */
const nouveauTag = (now: Date) => `odin-${now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}-${randomBytes(2).toString('hex')}`;

/** Prend un instantané (éteinte : qemu-img ; allumée ou en pause : QMP « savevm », mémoire comprise). */
async function prendre(ctx: ModCtx, L: Local, m: Machine, fiche: Omit<Fiche, 'tag' | 'at'>): Promise<Instantane> {
  const etat = await etatVm(L, m), f = disqueDe(L, m);
  verifierPlace(ctx, L, m, etat !== 'éteinte');
  const tag = nouveauTag(ctx.now());
  if (etat === 'éteinte') await qemuImg(ctx, ['snapshot', '-c', tag, f], `instantané de ${m.nom}`);
  else await moniteur(L, m, `savevm ${tag}`, `instantané de ${m.nom}`);
  const l = await listeInstantanes(ctx, L, m), x = l.instantanes.find((y) => y.tag === tag);
  if (!x) throw new Error(`instantané de ${m.nom} : QEMU ne le montre pas dans le disque`);
  ecrireFiches(L, m, [...lireFiches(L, m).filter((y) => y.tag !== tag), { tag, ...fiche, at: ctx.now().getTime() }]);
  return { ...x, nom: fiche.nom ?? '', at: ctx.now().getTime(), ...(fiche.auto ? { auto: fiche.auto } : {}), ...(fiche.detail ? { detail: fiche.detail } : {}) };
}
/** Retire un instantané (éteinte : qemu-img ; allumée : QMP « delvm »). */
async function retirer(ctx: ModCtx, L: Local, m: Machine, tag: string): Promise<void> {
  if (!TAG_SUR.test(tag)) throw new Error('cet instantané n\'a pas été pris par Odin et son nom a des caractères qu\'il ne passe pas à QEMU : retire-le à la main');
  const etat = await etatVm(L, m), f = disqueDe(L, m);
  if (etat === 'éteinte') await qemuImg(ctx, ['snapshot', '-d', tag, f], `retirer l'instantané de ${m.nom}`);
  else await moniteur(L, m, `delvm ${tag}`, `retirer l'instantané de ${m.nom}`);
  ecrireFiches(L, m, lireFiches(L, m).filter((y) => y.tag !== tag));
}
/**
 * Les automatiques de plus de 7 jours sont retirés : appelé quand Odin vient d'en prendre un nouveau pour cette machine,
 * et seulement là. Jamais un instantané pris à la main, ni celui pris avant un retour (« pour annuler, reviens à… » doit
 * rester vrai), ni un automatique de moins de 7 jours, quel que soit leur nombre ; une date illisible : gardé. Le temps
 * est celui d'Odin (ctx.now), comme la date notée à chaque instantané. Chaque retrait est noté « Odin seul » dans « qui a
 * fait quoi » ; un retrait raté aussi (« pas fait », avec la raison) : il est repris au prochain automatique, et ne fait
 * pas échouer l'instantané qui vient d'être pris.
 */
async function retirerPerimes(ctx: ModCtx, L: Local, m: Machine): Promise<void> {
  const jours = INSTANTANES.garderAutoJours, limite = ctx.now().getTime() - jours * JOUR, action = `Retirer un instantané de plus de ${jours} jours`;
  let l: Instantane[];
  try { l = (await listeInstantanes(ctx, L, m)).instantanes; } catch { return; /* disque illisible à cet instant : relu au prochain automatique */ }
  for (const x of l.filter((y) => (y.auto === 'maj' || y.auto === 'sauvegarde') && Number.isFinite(y.at) && y.at > 0 && y.at < limite)) {
    const du = `instantané du ${quand(x.at)}`;
    try { await retirer(ctx, L, m, x.tag); noterSeul(ctx, action, m.nom, true, `🗑 ${m.nom} : ${du} retiré (pris tout seul, gardé ${jours} jours) : « ${titreInstantane(x)} »`); }
    catch (e) { noterSeul(ctx, action, m.nom, false, `${(e as Error).message} (${du})`); }
  }
}

/** Le titre lisible d'un instantané (la page compose le même). */
export function titreInstantane(x: Pick<Instantane, 'nom' | 'auto' | 'detail' | 'tag'> & { at?: number }): string {
  if (x.nom) return x.nom;
  if (x.auto === 'maj') return 'Avant la mise à jour';
  if (x.auto === 'sauvegarde') return `Avant la sauvegarde${x.detail ? ` « ${x.detail} »` : ''}`;
  if (x.auto === 'retour') return `Avant de revenir à « ${x.detail ?? ''} »`;
  return x.at ? `Instantané du ${quand(x.at)}` : x.tag;
}
/** L'instantané demandé (son nom dans le disque, ou le nom qu'on lui a donné, exact). */
function trouver(l: Instantane[], q: unknown, m: Machine): Instantane {
  const t = s(q).trim(), parNom = t ? l.filter((y) => y.nom === t) : [], x = l.find((y) => y.tag === t) ?? (parNom.length === 1 ? parNom[0] : undefined);
  if (!x) throw new Error(parNom.length > 1 ? `plusieurs instantanés de ${m.nom} s'appellent « ${t.slice(0, 64)} » : choisis-le dans la liste` : `instantané introuvable pour ${m.nom} : « ${t.slice(0, 64)} »`);
  return x;
}
const quand = (t: number) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

/** Une ligne « Odin seul » dans « qui a fait quoi » (les automatiques). */
function noterSeul(ctx: ModCtx, action: string, machine: string, ok: boolean, resultat: string): void {
  try { journalDe<Acte>(ctx, 'ymir_actes', 'qui-a-fait.jsonl', { garder: 5000, quand: (e) => e.t }).ajouter({ t: ctx.now().getTime(), qui: 'Odin seul', action, quoi: `machine : ${machine}`.slice(0, 80), ok, resultat: resultat.slice(0, 160) }); } catch { /* le journal ne bloque jamais */ }
}

/** Un geste à la fois par machine. */
async function seul<T>(m: Machine, f: () => Promise<T>): Promise<T> {
  if (EN_COURS.has(m.id)) throw new Error(`un instantané de ${m.nom} est déjà en cours : attends la fin`);
  EN_COURS.add(m.id);
  try { return await f(); } finally { EN_COURS.delete(m.id); }
}
/** La VM, prête pour les instantanés (sinon l'erreur claire). */
function machineVm(ctx: ModCtx, q: unknown): { L: Local; m: Machine } {
  const L = new Local(ctx), m = L.find(q), h = horsInstantanes(m); if (h) throw new Error(h.texte);
  return { L, m };
}

/**
 * Un instantané automatique, avant une mise à jour faite par Odin dans la machine ou avant une sauvegarde de Phénix :
 * seulement si le réglage le veut (sinon « sauté ») ; noté « Odin seul » ; une fois pris, les automatiques de plus de
 * 7 jours de cette machine sont retirés.
 */
export async function instantaneAuto(ctx: ModCtx, m: Machine, auto: 'maj' | 'sauvegarde', detail?: string): Promise<{ ok: boolean; saute?: boolean; texte: string; raison?: string }> {
  const r = reglagesInstantanes(ctx);
  if (auto === 'maj' ? !r.avantMaj : !r.avantSauvegarde) return { ok: true, saute: true, texte: `${m.nom} : pas d'instantané automatique (réglage d'Hydre)` };
  if (horsInstantanes(m)) return { ok: true, saute: true, texte: `${m.nom} : pas d'instantané (${horsInstantanes(m)!.texte})` };
  const L = new Local(ctx), action = auto === 'maj' ? 'Instantané avant la mise à jour' : 'Instantané avant la sauvegarde';
  try {
    const x = await seul(m, async () => { const x = await prendre(ctx, L, m, { auto, ...(detail ? { detail: propre(detail) } : {}) }); await retirerPerimes(ctx, L, m); return x; });
    const texte = `📷 ${m.nom} : instantané pris (${titreInstantane(x).toLowerCase()})`;
    noterSeul(ctx, action, m.nom, true, texte); return { ok: true, texte };
  } catch (e) { const raison = (e as Error).message, texte = `${m.nom} : instantané automatique impossible (${raison})`; noterSeul(ctx, action, m.nom, false, texte); return { ok: false, texte, raison }; }
}
/** Avant une mise à jour faite par Odin dans une VM de ce PC. */
export const avantMiseAJour = (ctx: ModCtx, m: Machine, detail?: string) => instantaneAuto(ctx, m, 'maj', detail);

/** Un dossier lu par un plan de sauvegarde touche-t-il celui de la VM (l'un dans l'autre) ? */
function touche(plan: string, vm: string): boolean {
  const dedans = (a: string, b: string) => { const r = relative(resolve(a), resolve(b)); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
  return dedans(plan, vm) || dedans(vm, plan);
}

/** Odin et ses applis, lus à l'appel seulement (odin.ts charge toutes les applis, dont celle-ci). */
const odin = () => import('../odin.ts');

/**
 * Avant une sauvegarde de Phénix : un instantané automatique de chaque VM de ce PC dont le plan lit le dossier (si le
 * réglage le veut). Ce n'est pas une action : Phénix l'appelle dans sa sauvegarde (celle de la nuit part sans le
 * propriétaire), et rien d'autre ; ni la clé d'API, ni une automatisation, ni une conversation n'y arrivent sans une
 * vraie sauvegarde d'un plan. Jamais pour un membre ; rien si Hydre est désactivée ou si ce Phénix n'est pas du même Odin.
 */
export async function instantanesAvantSauvegarde(phenix: ModCtx, dossiers: string[], plan: string): Promise<Array<{ nom: string; ok: boolean; saute?: boolean; texte: string }>> {
  if (agissant()) return [];
  const v = (await odin()).valhallaOf();
  if (!v || !v.modules().some((x) => x.id === 'ymir') || !v.estActive('ymir')) return [];
  const ctx = v.ctx('ymir'); if (ctx.home !== phenix.home) return [];
  const ds = dossiers.map((x) => x.trim()).filter((x) => x && isAbsolute(x)).slice(0, 200), L = new Local(ctx), out: Array<{ nom: string; ok: boolean; saute?: boolean; texte: string }> = [];
  for (const m of L.list().filter((x) => x.genre === 'vm' && !x.estModele && ds.some((d) => touche(d, L.vmDir(x))))) out.push({ nom: m.nom, ...(await instantaneAuto(ctx, m, 'sauvegarde', plan)) });
  return out;
}

const machine: Param = { key: 'machine', label: 'Machine (nom ou adresse)', kind: 'text', required: true };
const instantane: Param = { key: 'instantane', label: 'Instantané (son nom)', kind: 'text', required: true };
const commun = { proprietaireSeul: true, quick: false } as const;

/** Les actions des instantanés d'une VM de ce PC. */
export function instantanesActions(): Action[] {
  const notees: Action[] = [
    { id: 'prendre_instantane', label: 'Prendre un instantané', what: 'Une photo d\'une VM de ce PC, à garder pour y revenir (allumée : sa mémoire comprise)', ...commun,
      params: [machine, { key: 'nom', label: 'Nom (vide : la date)', kind: 'text', default: '' }], run: async (ctx, i) => {
        const { L, m } = machineVm(ctx, i.machine), nom = propre(s(i.nom));
        const x = await seul(m, () => prendre(ctx, L, m, nom ? { nom } : {}));
        return { text: `📷 ${m.nom} : instantané pris${nom ? ` (« ${nom} »)` : ''}${x.memoire ? ', mémoire comprise' : ''}.`, data: { instantane: x } };
      } },
    { id: 'revenir_instantane', label: 'Revenir à cet instantané', what: 'Remet une VM de ce PC dans l\'état d\'un de ses instantanés (un instantané de maintenant est pris d\'abord)', ...commun,
      params: [machine, instantane],
      grave: (i, ctx) => `remettre la machine ${nomLisible(ctx, i.machine)} à l'instantané « ${s(i.instantane).slice(0, 64)} » : tout ce qui a changé dedans depuis (fichiers, réglages) est perdu ; Odin prend d'abord un instantané de maintenant, pour pouvoir revenir encore`,
      run: async (ctx, i) => {
        const { L, m } = machineVm(ctx, i.machine);
        return seul(m, async () => {
          const l = (await listeInstantanes(ctx, L, m)).instantanes, x = trouver(l, i.instantane, m), etat = await etatVm(L, m);
          if (!TAG_SUR.test(x.tag)) throw new Error('cet instantané n\'a pas été pris par Odin et son nom a des caractères qu\'il ne passe pas à QEMU');
          if (etat !== 'éteinte' && !x.memoire) throw new Error(`« ${titreInstantane(x)} » a été pris machine éteinte : il ne garde pas la mémoire. Éteins d'abord ${m.nom}, puis reviens-y`);
          // D'abord un instantané de maintenant : on peut revenir encore (refusé s'il ne se prend pas).
          const avant = await prendre(ctx, L, m, { auto: 'retour', detail: propre(titreInstantane(x)) });
          noterSeul(ctx, 'Instantané avant de revenir', m.nom, true, `📷 ${m.nom} : instantané de maintenant pris avant de revenir à « ${titreInstantane(x)} »`);
          const f = disqueDe(L, m);
          if (etat === 'éteinte') await qemuImg(ctx, ['snapshot', '-a', x.tag, f], `revenir à l'instantané de ${m.nom}`);
          else {
            // Mise en pause le temps du retour, puis elle repart (si elle tournait).
            const sock = L.qmpSock(m);
            if (etat === 'en marche') await systemeVm.qmp(sock, 'stop');
            try { await moniteur(L, m, `loadvm ${x.tag}`, `revenir à l'instantané de ${m.nom}`); }
            finally { if (etat === 'en marche') await systemeVm.qmp(sock, 'cont').catch(() => undefined); }
          }
          // Rien n'est retiré ici : l'instantané de maintenant reste, jusqu'à ce que le propriétaire le retire.
          return { text: `↩ ${m.nom} est revenue à « ${titreInstantane(x)} » (${quand(x.at)}).${etat === 'éteinte' && x.memoire ? ' Elle était allumée à ce moment-là : seul son disque revient, elle redémarrera comme après une coupure de courant.' : ''} Pour annuler, reviens à « ${titreInstantane(avant)} ».`, data: { instantane: x, avant } };
        });
      } },
    { id: 'retirer_instantane', label: 'Retirer l\'instantané', what: 'Retire un instantané d\'une VM de ce PC (on ne pourra plus y revenir)', ...commun,
      params: [machine, instantane],
      grave: (i, ctx) => `retirer l'instantané « ${s(i.instantane).slice(0, 64)} » de la machine ${nomLisible(ctx, i.machine)} : on ne pourra plus y revenir`,
      run: async (ctx, i) => {
        const { L, m } = machineVm(ctx, i.machine);
        return seul(m, async () => {
          const x = trouver((await listeInstantanes(ctx, L, m)).instantanes, i.instantane, m);
          await retirer(ctx, L, m, x.tag);
          return { text: `🗑 ${m.nom} : instantané « ${titreInstantane(x)} » retiré.`, data: { instantane: x } };
        });
      } },
    { id: 'reglages_instantanes', label: 'Réglages des instantanés', what: 'Instantanés automatiques des VM de ce PC (gardés 7 jours) : avant une mise à jour, avant une sauvegarde', ...commun,
      params: [{ key: 'avant_maj', label: 'Avant chaque mise à jour', kind: 'boolean', default: true }, { key: 'avant_sauvegarde', label: 'Avant chaque sauvegarde de Phénix', kind: 'boolean', default: true }],
      run: (ctx, i) => {
        const oui = (v: unknown, d: boolean) => (v === undefined || v === '' ? d : v === true || v === 'true'), avant = reglagesInstantanes(ctx);
        const r: Reglages = { avantMaj: oui(i.avant_maj, avant.avantMaj), avantSauvegarde: oui(i.avant_sauvegarde, avant.avantSauvegarde) };
        ctx.saveSettings({ instantanes: r });
        return { text: `📷 Instantanés automatiques : ${r.avantMaj ? 'avant chaque mise à jour' : 'pas avant les mises à jour'}, ${r.avantSauvegarde ? 'avant chaque sauvegarde' : 'pas avant les sauvegardes'} ; gardés ${INSTANTANES.garderAutoJours} jours (ceux pris à la main et ceux d'avant un retour ne sont jamais retirés seuls).`, data: r };
      } },
  ];
  const libres: Action[] = [
    { id: 'instantanes_machine', label: 'Instantanés d\'une machine', what: 'Les instantanés d\'une VM de ce PC (nom, date, taille, automatique ou non), la place prise et le budget', ...commun, quiet: true,
      params: [machine], run: async (ctx, i) => {
        const L = new Local(ctx), m = L.find(i.machine), reglages = reglagesInstantanes(ctx), h = horsInstantanes(m);
        if (h) return { ok: false, text: h.texte, data: { etat: h.etat, reglages } };
        const etat = await etatVm(L, m), { instantanes: l, place } = await listeInstantanes(ctx, L, m);
        let budget: { disqueMaxGo?: number; disqueLibreGo?: number; reserveDisqueGo?: number } = {};
        try { const b = budgetIci(ctx, L); budget = { disqueMaxGo: b.disqueMaxGo, disqueLibreGo: b.disqueLibreGo, reserveDisqueGo: b.reserveDisqueGo }; } catch { /* place libre illisible */ }
        return { text: `${m.nom} : ${l.length} instantané${l.length > 1 ? 's' : ''} (${l.filter((x) => x.auto).length} automatique${l.filter((x) => x.auto).length > 1 ? 's' : ''}), disque et instantanés : ${go(place)}.${l.map((x) => `\n- ${titreInstantane(x)} · ${quand(x.at)} · ${x.auto ? 'tout seul' : 'à la main'}${x.memoire ? ` · mémoire ${go(x.memoire)}` : ''}`).join('')}`,
          data: { etat: 'ok', machine: { id: m.id, nom: m.nom, etat, ram: m.ram, disque: m.disque }, instantanes: l, place, budget, besoinGo: (etat !== 'éteinte' ? Math.ceil((Number(m.ram) || 0) / 1024) : 0) + INSTANTANES.margeGo, reglages } };
      } },
  ];
  return [...avecJournal('ymir_actes', notees), ...libres];
}

/** Le nom d'une VM de ce PC pour la confirmation (son identifiant ne parle à personne) ; sinon ce qui a été dit. */
function nomLisible(ctx: ModCtx | undefined, q: unknown): string {
  if (ctx) try { return new Local(ctx).find(q).nom; } catch { /* introuvable */ }
  return s(q).slice(0, 64);
}
