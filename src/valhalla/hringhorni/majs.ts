// Hringhorni — les mises à jour (lot K5 de la maquette « Conteneurs et machines » validée le 23/11).
// Ses choix : « mises à jour jamais seules » (Odin propose, le propriétaire décide : RIEN ici ne se lance tout seul,
// aucun minuteur) et « Ses dossiers seulement ». Une mise à jour, d'un conteneur ou de plusieurs (une pile) :
//   1. la version voulue est PRÉCISE : une étiquette (« 1.27.4 ») ou une empreinte, jamais « latest » ni rien ;
//   2. la place est vérifiée AVANT (dans le dossier du moteur : de quoi copier les volumes deux fois, plus une marge),
//      sinon refus et rien ne change ;
//   3. la nouvelle image est récupérée (et passée à l'antivirus par le moteur) pendant que l'ancienne version tourne ;
//   4. les conteneurs sont arrêtés, leurs VOLUMES COPIÉS (dans le dossier du moteur, sans suivre aucun lien, droits
//      gardés), les anciens conteneurs mis de côté (arrêtés, intacts), les nouveaux créés avec les mêmes réglages ;
//   5. ils démarrent et doivent tenir debout pendant SANTE.secondes ; s'ils ne démarrent pas ou tombent : RETOUR TOUT
//      SEUL — nouveaux retirés, volumes remis depuis la copie, anciens conteneurs remis, et c'est dit ;
//   6. la copie est GARDÉE jusqu'à ce que le propriétaire la retire (aucune rotation : rien n'est effacé sans lui) ;
//   7. coupée par un arrêt d'Odin, elle est reprise par la surveillance : le retour promis, jamais une mise à jour.
// Les dossiers de la machine qu'un conteneur modifie ne sont pas copiés : la confirmation le dit.
import { randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lchownSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Engine, RunOpts } from './engine.ts';
import { tailleDossier } from './engine.ts';
import { parseRef } from './registry.ts';
import type { Spec, Store } from './store.ts';
import { lireYamlStrict, NOM_PILE, type Obj, type Pile } from './composition.ts';
import { decouperImage, servicesDe, type EntreeCatalogue } from './catalogue.ts';

/** Combien de temps une nouvelle version doit tenir debout, et tous les combien on regarde (remplaçable dans les essais). */
export const SANTE = { secondes: 30, pasMs: 500 };
/** La place gardée en plus des deux copies : 512 Mo. */
export const MARGE = { octets: 512 * 1024 ** 2 };
/** Le comptage d'un volume avant la copie : au plus tant de fichiers et de temps ; au-delà, refus (taille inconnue). */
export const COMPTE_MAJ = { entrees: 2_000_000, ms: 20_000 };

export type MoteurMaj = Pick<Engine, 'ps' | 'find' | 'findImage' | 'pull' | 'create' | 'start' | 'stop' | 'rm' | 'utilisateursVolume' | 'dossierVerifieVolume'> & { store: Store };

export const TEXTES_K5 = {
  sansEtiquette: 'donne une version précise : « {image}:1.2.3 » (une étiquette), jamais rien ni « latest »',
  latest: '« latest » n\'est pas une version : donne l\'étiquette précise voulue (par exemple 1.27.4)',
  illisible: 'nom d\'image illisible : {image}',
  meme: '{nom} est déjà sur {image} : rien à faire',
  autreAppli: '{image} n\'est pas la même appli que {avant} : pour changer d\'appli, crée un autre conteneur',
  partage: 'le volume {volume} sert aussi à {qui} : mets à jour ensemble tout ce qui s\'en sert (sa pile), rien n\'a été changé',
  tropDeFichiers: 'le volume {volume} a trop de fichiers pour être compté avant la copie : rien n\'a été changé',
  place: 'pas assez de place dans le dossier du moteur : il faut {besoin} (deux copies de ses volumes, plus une marge), il reste {libre}. Rien n\'a été changé',
  placeInconnue: 'la place libre du dossier du moteur ne se lit pas : rien n\'a été changé',
  dejaLa: '{nom} : l\'image récupérée est celle qu\'il a déjà (rien n\'a été changé)',
  tombe: '{nom} est tombé {quand} ({etat})',
  relance: '{nom} s\'est relancé tout seul {n} fois',
  pasDemarre: '{nom} n\'a pas démarré : {raison}',
};
const remplir = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_m, k: string) => String(v[k] ?? ''));
const octetsTexte = (o: number) => (o >= 1024 ** 3 ? `${(o / 1024 ** 3).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go` : o >= 1024 ** 2 ? `${Math.round(o / 1024 ** 2)} Mo` : `${Math.max(0, Math.round(o / 1024))} Ko`);
export { octetsTexte };

// ================================================================================================================
// 1. La version voulue
// ================================================================================================================
/** Une image avec une version précise (étiquette autre que « latest », ou empreinte). Rend la référence propre ; sinon
 *  une erreur qui dit quoi écrire. Pur. */
export function verifierVersion(image: string): string {
  const x = String(image ?? '').trim();
  if (!/^[a-z0-9][a-z0-9._/:@-]{0,250}$/i.test(x)) throw new Error(remplir(TEXTES_K5.illisible, { image: x.slice(0, 80) }));
  let ref; try { ref = parseRef(x); } catch { throw new Error(remplir(TEXTES_K5.illisible, { image: x.slice(0, 80) })); }
  if (ref.digest) return x;
  const { nom, etiquette } = decouperImage(x.split('@')[0]);
  if (!etiquette) throw new Error(remplir(TEXTES_K5.sansEtiquette, { image: nom.slice(0, 80) }));
  if (etiquette.toLowerCase() === 'latest') throw new Error(TEXTES_K5.latest);
  return x;
}
/** Le nom d'appli d'une image, sans registre par défaut ni version : « nginx », « docker.io/library/nginx:1 » → même. */
export function appliDe(image: string): string {
  try { return parseRef(image).name.replace(/:[^/:@]+$/, '').replace(/@.*$/, ''); } catch { return decouperImage(image.split('@')[0]).nom; }
}

// ================================================================================================================
// 2. Copier un dossier sans jamais suivre un lien (droits, dates et propriétaires gardés)
// ================================================================================================================
const estRoot = () => typeof process.getuid === 'function' && process.getuid() === 0;
/** Copie `src` dans `dst` (qui ne doit pas exister). Les liens sont recopiés comme liens, jamais suivis ; les fichiers
 *  spéciaux (tubes, périphériques) sont sautés et comptés. Les propriétaires sont remis quand Odin le peut. */
export function copierArbre(src: string, dst: string): { fichiers: number; octets: number; sautes: number } {
  if (existsSync(dst)) throw new Error('la copie existe déjà : rien n\'a été écrasé');
  const r = { fichiers: 0, octets: 0, sautes: 0 }, root = estRoot();
  const dossiers: Array<[string, import('node:fs').Stats]> = [];
  const un = (s: string, d: string) => {
    const st = lstatSync(s);
    if (st.isSymbolicLink()) {
      // (sous Windows, un lien vers un dossier se recopie en jonction : un lien ordinaire y demande des droits)
      const versDossier = process.platform === 'win32' && (() => { try { return statSync(s).isDirectory(); } catch { return false; } })();
      symlinkSync(readlinkSync(s), d, versDossier ? 'junction' : undefined); if (root) { try { lchownSync(d, st.uid, st.gid); } catch { /* gardé tel quel */ } } return; }
    if (st.isDirectory()) {
      mkdirSync(d, { mode: 0o700 });
      for (const n of readdirSync(s)) un(join(s, n), join(d, n));
      dossiers.push([d, st]); return;
    }
    if (!st.isFile()) { r.sautes++; return; }
    copyFileSync(s, d); r.fichiers++; r.octets += st.size;
    // (le propriétaire d'abord : le changer efface les bits setuid / setgid, remis juste après avec les droits)
    if (root) { try { lchownSync(d, st.uid, st.gid); } catch { /* gardé */ } }
    try { chmodSync(d, st.mode & 0o7777); } catch { /* système sans droits Unix */ }
    try { utimesSync(d, st.atime, st.mtime); } catch { /* gardé */ }
  };
  un(src, dst);
  // Les droits des dossiers à la fin (un dossier en lecture seule n'empêche pas d'y copier ses fichiers).
  for (const [d, st] of dossiers.reverse()) {
    if (root) { try { lchownSync(d, st.uid, st.gid); } catch { /* gardé */ } }
    try { chmodSync(d, st.mode & 0o7777); } catch { /* gardé */ }
    try { utimesSync(d, st.atime, st.mtime); } catch { /* gardé */ }
  }
  return r;
}

// ================================================================================================================
// 3. Les copies gardées
// ================================================================================================================
export type ResultatMaj = 'en cours' | 'réussie' | 'revenue' | 'pas faite' | 'retour incomplet';
export interface ConteneurMaj { nom: string; avant: string; apres: string; service?: string; ancien?: string; enMarche?: boolean }
export interface CopieMaj {
  id: string; quand: string; fin?: string; pile?: string; conteneurs: ConteneurMaj[];
  volumes: Array<{ nom: string; octets: number; fichiers: number }>; octets: number; copiee: boolean;
  resultat: ResultatMaj; raison?: string; dossiersNonCopies: string[];
  /** Le processus d'Odin qui la fait, et où elle en est (pour reprendre une mise à jour coupée par un arrêt d'Odin). */
  pid?: number; etape?: 'images' | 'copie' | 'bascule' | 'fin';
}
/** Le nom de l'ancien conteneur mis de côté pendant une mise à jour. Pur. */
export const nomAncien = (nom: string, id: string) => `${nom.slice(0, 40)}.avant-maj-${id.slice(0, 6)}`;
export const dossierCopies = (e: { store: { dir: string } }) => join(e.store.dir, 'copies-maj');
const ID_COPIE = /^[a-f0-9]{12}$/;
const ficheCopie = (e: { store: { dir: string } }, id: string) => { if (!ID_COPIE.test(id)) throw new Error('copie inconnue'); return join(dossierCopies(e), id, 'fiche.json'); };
function ecrire(f: string, v: unknown) { mkdirSync(dirname(f), { recursive: true, mode: 0o700 }); const t = `${f}.${process.pid}.tmp`; writeFileSync(t, JSON.stringify(v, null, 1), { mode: 0o600 }); renameSync(t, f); }
/** Le processus d'une autre instance d'Odin vit-il encore ? (le nôtre : ce sont les copies suivies ici qui le disent) */
const vivant = (pid?: number) => { if (!pid || pid === process.pid) return false; try { process.kill(pid, 0); return true; } catch (er) { return (er as NodeJS.ErrnoException).code === 'EPERM'; } };
/** Les mises à jour et leurs copies, la plus récente d'abord. */
export function copiesMaj(e: { store: { dir: string } }): CopieMaj[] {
  let l: string[] = []; try { l = readdirSync(dossierCopies(e)); } catch { return []; }
  const out: CopieMaj[] = [];
  for (const id of l.filter((x) => ID_COPIE.test(x))) { try { const c = JSON.parse(readFileSync(ficheCopie(e, id), 'utf8')) as CopieMaj; if (c.id === id) out.push(c); } catch { /* fiche en cours d'écriture */ } }
  return out.sort((a, b) => b.quand.localeCompare(a.quand));
}
/** Retire une copie (geste du propriétaire). Jamais celle d'une mise à jour en cours ; le dossier est vérifié : rangé
 *  chez le moteur, sans lien sur le chemin ; il est d'abord mis de côté d'un seul geste, puis effacé. */
export function retirerCopie(e: { store: { dir: string } }, id: string, enCours: (id: string) => boolean = () => false): CopieMaj {
  const c = copiesMaj(e).find((x) => x.id === id); if (!c) throw new Error('copie inconnue');
  if (c.resultat === 'en cours' && (enCours(id) || vivant(c.pid))) throw new Error('cette mise à jour est en cours : sa copie ne se retire pas maintenant');
  const base = dossierCopies(e), dir = join(base, id);
  for (const p of [base, dir]) if (lstatSync(p).isSymbolicLink()) throw new Error('la copie passe par un lien : rien n\'est effacé');
  if (resolve(realpathSync.native(dir)) !== resolve(realpathSync.native(base), id)) throw new Error('la copie n\'est pas rangée chez le moteur : rien n\'est effacé');
  const cote = join(base, `.retire-${randomBytes(6).toString('hex')}`);
  renameSync(dir, cote);
  if (lstatSync(cote).isSymbolicLink()) { rmSync(cote, { force: true }); throw new Error('la copie a été remplacée par un lien : seul le lien est retiré'); }
  rmSync(cote, { recursive: true, force: true });
  return c;
}

// ================================================================================================================
// 4. Préparer : ce qui part, ce qui est copié, la place
// ================================================================================================================
export interface Cible { conteneur: string; image: string }
export interface PlanMaj {
  pile?: string; conteneurs: Array<ConteneurMaj & { id: string; enMarche: boolean }>;
  volumes: Array<{ nom: string; octets: number; fichiers: number }>; octets: number;
  besoin: number; libre?: number; dossiersNonCopies: string[];
}
/**
 * Vérifie tout avant de toucher à quoi que ce soit : chaque conteneur existe, chaque version est précise et est la même
 * appli, rien n'est « déjà là », aucun volume n'est partagé avec un conteneur hors de la mise à jour, la taille de chaque
 * volume est connue, et la place suffit. Rend le plan (lu par la confirmation) ; sinon une erreur, rien n'a changé.
 */
export function planifier(e: MoteurMaj, cibles: Cible[], o: { pile?: string; libre?: (dir: string) => number | undefined; memeEtiquette?: boolean } = {}): PlanMaj {
  if (!cibles.length) throw new Error('rien à mettre à jour');
  const tous = e.ps(true), noms = new Set<string>();
  const conteneurs = cibles.map((x) => {
    const c = e.find(x.conteneur); if (noms.has(c.spec.name)) throw new Error(`${c.spec.name} est donné deux fois`); noms.add(c.spec.name);
    const apres = verifierVersion(x.image);
    if (appliDe(apres) !== appliDe(c.spec.image)) throw new Error(remplir(TEXTES_K5.autreAppli, { image: apres, avant: c.spec.image }));
    if (apres === c.spec.image && !o.memeEtiquette) throw new Error(remplir(TEXTES_K5.meme, { nom: c.spec.name, image: apres }));
    return { id: c.id, nom: c.spec.name, avant: c.spec.image, apres, service: c.spec.labels['odin.pile.service'] || undefined, enMarche: c.state.status === 'en marche' || c.state.status === 'redémarre' };
  });
  const ids = new Set(conteneurs.map((c) => c.id));
  const vols = [...new Set(conteneurs.flatMap((c) => e.find(c.id).spec.mounts.filter((m) => m.volume).map((m) => m.volume!)))].sort();
  for (const v of vols) {
    // (par son nom, ou par le chemin de son dossier : les deux s'en servent)
    const autres = [...new Set([...tous.filter((c) => !ids.has(c.id) && c.spec.mounts.some((m) => m.volume === v)).map((c) => c.spec.name), ...e.utilisateursVolume(v).filter((n) => !noms.has(n))])];
    if (autres.length) throw new Error(remplir(TEXTES_K5.partage, { volume: v, qui: autres.join(', ') }));
  }
  const finA = Date.now() + COMPTE_MAJ.ms;
  const volumes = vols.map((nom) => {
    e.dossierVerifieVolume(nom);
    const t = tailleDossier(e.store.volumeData(nom), COMPTE_MAJ.entrees, finA);
    if (t.coupe) throw new Error(remplir(TEXTES_K5.tropDeFichiers, { volume: nom }));
    return { nom, octets: t.octets, fichiers: t.fichiers };
  });
  const octets = volumes.reduce((a, v) => a + v.octets, 0);
  const dossiersNonCopies = [...new Set(conteneurs.flatMap((c) => e.find(c.id).spec.mounts.filter((m) => !m.volume && !m.ro).map((m) => m.host)))];
  const libre = o.libre?.(e.store.dir);
  const besoin = 2 * octets + MARGE.octets;
  if (vols.length) {
    if (libre === undefined) throw new Error(TEXTES_K5.placeInconnue);
    if (libre < besoin) throw new Error(remplir(TEXTES_K5.place, { besoin: octetsTexte(besoin), libre: octetsTexte(libre) }));
  }
  return { pile: o.pile, conteneurs, volumes, octets, besoin, libre, dossiersNonCopies };
}
/** Le texte de la confirmation : exactement ce qui va se passer. Pur. */
export function confirmationMaj(p: PlanMaj, secondes = SANTE.secondes): string {
  const quoi = p.pile ? `la pile « ${p.pile} »` : p.conteneurs[0].nom;
  const changes = p.conteneurs.map((c) => `${p.pile ? `${c.nom} : ` : ''}${c.avant} → ${c.apres}`).join(' ; ');
  return `mettre à jour ${quoi} (${changes}) : `
    + (p.volumes.length ? `d'abord une copie de ses volumes (${p.volumes.map((v) => v.nom).join(', ')}, ${octetsTexte(p.octets)}) dans le dossier du moteur, gardée jusqu'à ce que tu la retires ; ` : 'aucun volume à copier ; ')
    + `${p.conteneurs.length > 1 ? 'ses conteneurs sont arrêtés' : 'il est arrêté'} le temps de la mise à jour, puis ${p.conteneurs.length > 1 ? 'doivent' : 'doit'} tenir debout ${secondes.toLocaleString('fr-FR')} secondes : sinon, retour tout seul à l'ancienne version et aux volumes copiés`
    + (p.dossiersNonCopies.length ? ` ; attention, ces dossiers de ta machine ne sont pas copiés (la nouvelle version peut les changer sans retour) : ${p.dossiersNonCopies.join(', ')}` : '');
}

// ================================================================================================================
// 5. Mettre à jour, vérifier, revenir tout seul
// ================================================================================================================
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Les réglages d'un conteneur, pour le recréer sur une autre image : ce qui venait de l'ancienne image (ses
 *  variables, sa commande, son dossier, son compte) n'est pas imposé à la nouvelle. */
export function reglagesPour(sp: Spec, ancienne: { Env?: string[]; Entrypoint?: string[]; Cmd?: string[]; WorkingDir?: string; User?: string } | undefined, image: string): RunOpts {
  const cfg = ancienne ?? {}, envImage: Record<string, string> = {};
  for (const x of cfg.Env ?? []) { const i = x.indexOf('='); if (i > 0) envImage[x.slice(0, i)] = x.slice(i + 1); }
  const env = Object.fromEntries(Object.entries(sp.env).filter(([k, v]) => envImage[k] !== v && !(k === 'PATH' && !('PATH' in envImage) && v === '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin')));
  const defaut = [...(cfg.Entrypoint ?? []), ...(cfg.Cmd ?? [])];
  const cmdPropre = JSON.stringify(sp.cmd) !== JSON.stringify(defaut);
  const labels = { ...sp.labels }; delete labels['odin.moteur']; delete labels['odin.maj.ancien'];
  return {
    image, name: sp.name, env, ports: sp.ports, mounts: sp.mounts, restart: sp.restart, memory: sp.memory, cpus: sp.cpus,
    ...(cmdPropre ? { entrypoint: sp.cmd, cmd: [] } : {}),
    ...(sp.workdir !== (cfg.WorkingDir || '/') ? { workdir: sp.workdir } : {}), ...(sp.user !== (cfg.User ?? '') ? { user: sp.user } : {}),
    hostname: sp.hostname, network: sp.network, reseau: sp.reseau, labels,
  };
}
function renommer(e: MoteurMaj, id: string, nom: string, ancien?: string) {
  const sp = e.store.spec(id); if (!sp) throw new Error('conteneur disparu pendant la mise à jour');
  const labels = { ...sp.labels }; if (ancien) labels['odin.maj.ancien'] = ancien; else delete labels['odin.maj.ancien'];
  e.store.saveSpec({ ...sp, name: nom, labels });
}
/** Remet un volume depuis la copie : l'actuel est mis de côté d'un geste, la copie est recopiée, puis l'actuel est effacé. */
function remettreVolume(e: MoteurMaj, nom: string, copie: string) {
  e.dossierVerifieVolume(nom);
  const d = e.store.volumeData(nom), cote = join(dirname(d), `.avant-retour-${randomBytes(6).toString('hex')}`);
  if (existsSync(d)) { if (lstatSync(d).isSymbolicLink()) throw new Error(`le volume ${nom} passe par un lien : il n'est pas remis`); renameSync(d, cote); }
  try { copierArbre(copie, d); } catch (er) { rmSync(d, { recursive: true, force: true }); if (existsSync(cote)) renameSync(cote, d); throw er; }
  rmSync(cote, { recursive: true, force: true });
}
/** Regarde pendant `secondes` que chaque conteneur tient debout. Rend la raison d'un échec, ou rien. */
export async function surveiller(e: MoteurMaj, noms: string[], secondes = SANTE.secondes, pasMs = SANTE.pasMs): Promise<string | undefined> {
  const depart = new Map(noms.map((n) => [n, e.find(n).state.restarts ?? 0])), t0 = Date.now(), fin = t0 + secondes * 1000;
  for (;;) {
    for (const n of noms) {
      const st = e.find(n).state;
      if (st.status !== 'en marche' && st.status !== 'redémarre') return remplir(TEXTES_K5.tombe, { nom: n, quand: `au bout de ${Math.round((Date.now() - t0) / 1000)} s`, etat: `${st.status}${st.exitCode !== undefined ? `, code ${st.exitCode}` : ''}${st.error ? ` : ${String(st.error).slice(0, 160)}` : ''}` });
      if ((st.restarts ?? 0) > (depart.get(n) ?? 0)) return remplir(TEXTES_K5.relance, { nom: n, n: (st.restarts ?? 0) - (depart.get(n) ?? 0) });
    }
    if (Date.now() >= fin) break;
    await attendre(Math.max(1, Math.min(pasMs, fin - Date.now())));
  }
  for (const n of noms) { const st = e.find(n).state; if (st.status !== 'en marche') return remplir(TEXTES_K5.tombe, { nom: n, quand: 'à la fin de la vérification', etat: st.status }); }
  return undefined;
}
export type Etape = (texte: string, fait: number, total: number) => void;
export interface FinMaj { resultat: ResultatMaj; copie: string; raison?: string; texte: string }
/**
 * Fait la mise à jour d'un plan. Ne rend la main qu'à la fin ; rien d'automatique ici : c'est le propriétaire qui l'a
 * demandée. En cas d'échec après l'arrêt : retour tout seul, et c'est écrit dans la fiche de la copie.
 */
export async function mettreAJour(e: MoteurMaj, plan: PlanMaj, o: { etape?: Etape; libre?: (dir: string) => number | undefined; apresReussite?: (p: PlanMaj) => void; idCopie?: string } = {}): Promise<FinMaj> {
  const etape = o.etape ?? (() => {}), id = o.idCopie ?? randomBytes(6).toString('hex');
  if (!ID_COPIE.test(id)) throw new Error('copie inconnue');
  const dir = dossierCopieNeuf(e, id);
  const total = plan.conteneurs.length * 3 + plan.volumes.length + 2; let fait = 0;
  const fiche: CopieMaj = { id, quand: new Date().toISOString(), pid: process.pid, etape: 'images', pile: plan.pile, conteneurs: plan.conteneurs.map(({ nom, avant, apres, service, enMarche }) => ({ nom, avant, apres, service, ancien: nomAncien(nom, id), enMarche })), volumes: plan.volumes, octets: plan.octets, copiee: false, resultat: 'en cours', dossiersNonCopies: plan.dossiersNonCopies };
  const noter = (p: Partial<CopieMaj>) => { Object.assign(fiche, p); ecrire(join(dir, 'fiche.json'), fiche); };
  noter({});
  const pasFaite = (raison: string): FinMaj => { noter({ resultat: 'pas faite', raison, fin: new Date().toISOString() }); return { resultat: 'pas faite', copie: id, raison, texte: `Rien n'a été changé : ${raison}` }; };
  // --- 1. les nouvelles images, pendant que l'ancienne version tourne encore
  const anciennes = new Map(plan.conteneurs.map((c) => [c.id, e.find(c.id).spec.imageId]));
  // (la configuration de l'ancienne image est lue AVANT : récupérer la même étiquette lui retire son nom)
  const configs = new Map(plan.conteneurs.map((c) => [c.id, e.findImage(anciennes.get(c.id)!)?.config.config]));
  for (const c of plan.conteneurs) {
    etape(`récupérer ${c.apres}`, fait, total);
    try { const img = e.findImage(c.apres) && c.apres !== c.avant ? e.findImage(c.apres)! : await e.pull(c.apres); if (img.id === anciennes.get(c.id)) return pasFaite(remplir(TEXTES_K5.dejaLa, { nom: c.nom })); }
    catch (er) { return pasFaite(`la nouvelle image ${c.apres} n'a pas pu être récupérée : ${(er as Error).message.slice(0, 200)}`); }
    etape(`${c.apres} prête`, ++fait, total);
  }
  // --- 2. la place, revue après le téléchargement
  if (plan.volumes.length) {
    const libre = o.libre?.(e.store.dir);
    if (libre === undefined) return pasFaite(TEXTES_K5.placeInconnue);
    if (libre < plan.besoin) return pasFaite(remplir(TEXTES_K5.place, { besoin: octetsTexte(plan.besoin), libre: octetsTexte(libre) }));
  }
  // --- 3. arrêter (dans l'ordre inverse), copier les volumes
  const garde = plan.conteneurs.map((c) => ({ ...c, spec: e.find(c.id).spec, ancien: nomAncien(c.nom, id) }));
  const nouveaux: string[] = [], gares: typeof garde = [];
  const revenir = async (raison: string): Promise<FinMaj> => {
    etape('retour à l\'ancienne version', fait, total);
    const manques = await retour(e, { dir, copiee: Boolean(fiche.copiee), volumes: plan.volumes, nouveaux: [...nouveaux].reverse(), gares: gares.map((c) => ({ id: c.id, nom: c.nom })), relancer: garde.filter((x) => x.enMarche).map((c) => c.nom) });
    const resultat: ResultatMaj = manques.length ? 'retour incomplet' : 'revenue';
    noter({ resultat, raison: manques.length ? `${raison} — retour incomplet : ${manques.join(' ; ')}` : raison, fin: new Date().toISOString() });
    return { resultat, copie: id, raison, texte: manques.length
      ? `La nouvelle version n'a pas tenu (${raison}) et le retour n'est pas complet : ${manques.join(' ; ')}. La copie des volumes est gardée (${id}).`
      : `La nouvelle version n'a pas tenu (${raison}) : retour tout seul à l'ancienne version${plan.volumes.length ? ' et aux volumes copiés' : ''}. La copie est gardée.` };
  };
  try {
    noter({ etape: 'copie' });
    for (const c of [...garde].reverse()) if (c.enMarche) { etape(`arrêter ${c.nom}`, fait, total); await e.stop(c.id); }
    mkdirSync(join(dir, 'volumes'), { mode: 0o700 });
    for (const v of plan.volumes) {
      etape(`copier le volume ${v.nom}`, fait, total);
      e.dossierVerifieVolume(v.nom);
      copierArbre(e.store.volumeData(v.nom), join(dir, 'volumes', v.nom));
      etape(`volume ${v.nom} copié`, ++fait, total);
    }
    noter({ copiee: true });
  } catch (er) {
    // (rien n'est encore recréé ni changé : les anciens conteneurs sont relancés tels quels ; la copie partielle est
    //  effacée — elle ne sert à rien et garderait le disque plein)
    effacerCopiePartielle(dir);
    return revenir(`la copie des volumes a échoué : ${(er as Error).message.slice(0, 200)}`);
  }
  try {
    // --- 4. les anciens conteneurs mis de côté (arrêtés, intacts), les nouveaux créés avec les mêmes réglages
    noter({ etape: 'bascule' });
    for (const c of garde) { renommer(e, c.id, c.ancien, c.nom); gares.push(c); }
    for (const c of garde) {
      etape(`créer ${c.nom} sur ${c.apres}`, fait, total);
      await e.create(reglagesPour(c.spec, configs.get(c.id), c.apres)); nouveaux.push(c.nom);
      etape(`${c.nom} créé`, ++fait, total);
    }
    // --- 5. démarrer dans l'ordre, puis tenir debout
    for (const c of garde) {
      etape(`démarrer ${c.nom}`, fait, total);
      try { await e.start(c.nom); } catch (er) { return revenir(remplir(TEXTES_K5.pasDemarre, { nom: c.nom, raison: (er as Error).message.slice(0, 200) })); }
      etape(`${c.nom} démarré`, ++fait, total);
    }
    etape(`vérifier qu'${plan.conteneurs.length > 1 ? 'ils tiennent' : 'il tient'} debout (${SANTE.secondes.toLocaleString('fr-FR')} s)`, fait, total);
    const ko = await surveiller(e, garde.map((c) => c.nom));
    if (ko) return revenir(ko);
  } catch (er) { return revenir((er as Error).message.slice(0, 200)); }
  // --- 6. réussi : les anciens conteneurs partent (leurs images restent), la copie reste
  noter({ etape: 'fin' });
  for (const c of gares) { try { await e.rm(c.id, true); } catch { /* gardé de côté, sans gêner */ } }
  try { o.apresReussite?.(plan); } catch { /* la pile se relira au prochain coup */ }
  noter({ resultat: 'réussie', fin: new Date().toISOString() });
  etape('fini', total, total);
  return { resultat: 'réussie', copie: id, texte: `${plan.pile ? `Pile « ${plan.pile} »` : plan.conteneurs[0].nom} à jour (${plan.conteneurs.map((c) => c.apres).join(', ')}), et ${plan.conteneurs.length > 1 ? 'ses conteneurs tiennent' : 'il tient'} debout. La copie de ses volumes est gardée jusqu'à ce que tu la retires.` };
}

/** Le dossier d'une nouvelle copie : rangé chez le moteur (« copies-maj », sans lien sur le chemin), et neuf. */
function dossierCopieNeuf(e: { store: { dir: string } }, id: string): string {
  const base = dossierCopies(e);
  mkdirSync(base, { recursive: true, mode: 0o700 });
  if (lstatSync(base).isSymbolicLink() || resolve(realpathSync.native(base)) !== resolve(realpathSync.native(e.store.dir), 'copies-maj')) throw new Error('le dossier des copies n\'est pas rangé chez le moteur : rien n\'a été changé');
  const dir = join(base, id);
  mkdirSync(dir, { mode: 0o700 }); // (jamais par-dessus une copie qui existe)
  return dir;
}
/** Efface la copie partielle d'une copie qui a échoué (seulement son dossier « volumes », jamais à travers un lien). */
function effacerCopiePartielle(dir: string): void {
  const v = join(dir, 'volumes');
  try { if (lstatSync(v).isSymbolicLink()) rmSync(v, { force: true }); else rmSync(v, { recursive: true, force: true }); } catch { /* rien à effacer */ }
}
/**
 * Le retour à l'ancienne version : les nouveaux conteneurs retirés, les volumes remis depuis la copie, les anciens
 * reprennent leur nom et redémarrent. Si un nouveau conteneur ne se retire pas, RIEN de plus : ses volumes ne sont pas
 * remis sous lui (il pourrait encore y écrire) et l'ancien garde son nom de côté (jamais deux conteneurs du même nom).
 * Rend ce qui n'a pas pu être fait.
 */
async function retour(e: MoteurMaj, r: { dir: string; copiee: boolean; volumes: Array<{ nom: string }>; nouveaux: string[]; gares: Array<{ id: string; nom: string }>; relancer: string[] }): Promise<string[]> {
  const manques: string[] = [];
  for (const n of r.nouveaux) { try { await e.rm(n, true); } catch (er) { manques.push(`${n} (nouvelle version) ne se retire pas : ${(er as Error).message.slice(0, 120)}`); } }
  if (manques.length) return [...manques, 'ses volumes ne sont pas remis et l\'ancien conteneur reste de côté tant que la nouvelle version est là'];
  if (r.copiee) for (const v of r.volumes) { try { remettreVolume(e, v.nom, join(r.dir, 'volumes', v.nom)); } catch (er) { manques.push(`volume ${v.nom} : ${(er as Error).message.slice(0, 120)}`); } }
  for (const c of r.gares) { try { renommer(e, c.id, c.nom); } catch (er) { manques.push(`${c.nom} : ${(er as Error).message.slice(0, 120)}`); } }
  for (const n of r.relancer) { try { await e.start(n); } catch (er) { manques.push(`${n} ne redémarre pas : ${(er as Error).message.slice(0, 120)}`); } }
  return manques;
}
/**
 * Les mises à jour coupées par un arrêt d'Odin (fiche « en cours », plus suivie ici, et son processus n'est plus là) :
 * - avant la bascule (récupérer, arrêter, copier) : rien n'avait changé ; la copie partielle est effacée et ce qui
 *   tournait est relancé (« pas faite ») ;
 * - pendant la bascule ou la vérification : RETOUR comme si elle n'avait pas tenu (nouveaux retirés, volumes remis,
 *   anciens conteneurs remis) ;
 * - déjà vérifiée : notée réussie (l'ancien mis de côté est retiré, comme à la fin normale).
 * Ce n'est jamais une mise à jour : seulement le retour promis. Rend les fiches reprises.
 */
export async function reprendreInterrompues(e: MoteurMaj, suivie: (id: string) => boolean, enVie: (pid?: number) => boolean = vivant): Promise<CopieMaj[]> {
  const out: CopieMaj[] = [];
  for (const c of copiesMaj(e).filter((x) => x.resultat === 'en cours' && !suivie(x.id) && !enVie(x.pid))) {
    const dir = join(dossierCopies(e), c.id), coupe = 'interrompue par un arrêt d\'Odin';
    const noter = (p: Partial<CopieMaj>) => { const n = { ...c, ...p, fin: new Date().toISOString() }; ecrire(join(dir, 'fiche.json'), n); out.push(n); };
    const trouve = (n?: string) => { if (!n) return undefined; try { return e.find(n); } catch { return undefined; } };
    if (c.etape === 'fin') {
      for (const x of c.conteneurs) { const a = trouve(x.ancien); if (a?.spec.labels['odin.maj.ancien'] === x.nom) { try { await e.rm(a.id, true); } catch { /* gardé de côté */ } } }
      noter({ resultat: 'réussie', raison: `${coupe} juste après la vérification` });
      continue;
    }
    if (c.etape !== 'bascule') {
      if (!c.copiee) effacerCopiePartielle(dir);
      const manques: string[] = [];
      for (const x of c.conteneurs.filter((y) => y.enMarche)) { const k = trouve(x.nom); if (k && k.state.status !== 'en marche') { try { await e.start(k.id); } catch (er) { manques.push(`${x.nom} ne redémarre pas : ${(er as Error).message.slice(0, 120)}`); } } }
      noter({ resultat: 'pas faite', raison: `${coupe} avant de changer quoi que ce soit : remis comme avant${manques.length ? ` (sauf : ${manques.join(' ; ')})` : ''}` });
      continue;
    }
    // la bascule : les anciens mis de côté (marqués) reprennent leur place
    const gares: Array<{ id: string; nom: string }> = [], nouveaux: string[] = [];
    for (const x of c.conteneurs) {
      const a = trouve(x.ancien); if (!a || a.spec.labels['odin.maj.ancien'] !== x.nom) continue;
      gares.push({ id: a.id, nom: x.nom });
      const n = trouve(x.nom); if (n && n.id !== a.id) nouveaux.push(n.id);
    }
    const manques = await retour(e, { dir, copiee: c.copiee, volumes: c.volumes, nouveaux: nouveaux.reverse(), gares, relancer: c.conteneurs.filter((x) => x.enMarche).map((x) => x.nom) });
    noter({ resultat: manques.length ? 'retour incomplet' : 'revenue', raison: `${coupe} pendant la mise à jour : retour à l'ancienne version${c.copiee && c.volumes.length ? ' et aux volumes copiés' : ''}${manques.length ? ` — retour incomplet : ${manques.join(' ; ')}` : ''}` });
  }
  return out;
}

// ================================================================================================================
// 6. Les piles : la nouvelle version écrite dans la pile ; les versions du catalogue
// ================================================================================================================
/** La pile, après une mise à jour réussie : ses images (et les lignes « image: » de son fichier) suivent. */
export function noterPile(e: { store: { dir: string } }, p: Pile, changes: Array<{ nom: string; avant: string; apres: string }>): Pile {
  if (!NOM_PILE.test(p.nom)) throw new Error('nom de pile invalide');
  let fichier = p.fichier;
  for (const c of changes) {
    const echappe = c.avant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    fichier = fichier.replace(new RegExp(`^(\\s*image:\\s*["']?)${echappe}(["']?\\s*)$`, 'gm'), `$1${c.apres}$2`);
  }
  const n: Pile = { ...p, fichier, services: p.services.map((s) => { const c = changes.find((x) => x.nom === s.conteneur); return c ? { ...s, image: c.apres } : s; }) };
  ecrire(join(e.store.dir, 'piles', `${p.nom}.json`), n);
  return n;
}
/** Les images de chaque service d'une appli du catalogue. Pur. */
export function imagesParService(x: EntreeCatalogue): Record<string, string> {
  const d = lireYamlStrict(x.composition) as Obj, sv = d.services as Obj, out: Record<string, string> = {};
  for (const s of servicesDe(x)) { const v = (sv[s] as Obj | undefined)?.image; if (typeof v === 'string') out[s] = v; }
  return out;
}
export interface PropositionCatalogue { pile: string; app: string; appNom: string; changes: Array<{ service: string; conteneur: string; avant: string; apres: string }> }
/** Les piles venues du catalogue dont le catalogue d'Odin (son code, aucun site consulté) a une autre version. Pur. */
export function propositionsCatalogue(l: Pile[], catalogue: readonly EntreeCatalogue[]): PropositionCatalogue[] {
  const out: PropositionCatalogue[] = [];
  for (const p of l) {
    const x = catalogue.find((c) => new RegExp(`^${c.id}(-\\d{1,2})?$`).test(p.nom)); if (!x) continue;
    const imgs = imagesParService(x), svc = Object.keys(imgs);
    // la même appli : les mêmes services, et chacun la même image (au nom près, sans la version)
    if (svc.length !== p.services.length || !p.services.every((s) => imgs[s.service] && appliDe(imgs[s.service]) === appliDe(s.image))) continue;
    const changes = p.services.filter((s) => imgs[s.service] !== s.image).map((s) => ({ service: s.service, conteneur: s.conteneur, avant: s.image, apres: imgs[s.service] }));
    if (changes.length) out.push({ pile: p.nom, app: x.id, appNom: x.nom, changes });
  }
  return out;
}

// ================================================================================================================
// 7. « Grandit » : un volume qui grossit vite (d'après des mesures relevées par Arche, jamais par un service tiers)
// ================================================================================================================
export interface Mesure { at: number; o: number }
export const GRANDIT = { fenetreH: 24, minH: 1, parHeure: 100 * 1024 ** 2, parJour: 1024 ** 3, garder: 200 };
/** D'après les mesures d'un volume : grossit-il vite ? Sur les dernières 24 h (au moins 1 h de recul) : 100 Mo par heure
 *  ou plus, ou 1 Go de plus sur la fenêtre. Avec la place libre : dans combien de jours le disque serait plein. Pur. */
export function grandit(m: Mesure[], maintenant: number, libre?: number): { grandit: boolean; parJour?: number; joursAvantPlein?: number; recul: number } {
  const l = m.filter((x) => x.at >= maintenant - GRANDIT.fenetreH * 3600_000 && x.at <= maintenant).sort((a, b) => a.at - b.at);
  if (l.length < 2) return { grandit: false, recul: 0 };
  const h = (l.at(-1)!.at - l[0].at) / 3600_000; if (h < GRANDIT.minH) return { grandit: false, recul: h };
  const plus = l.at(-1)!.o - l[0].o, parJour = (plus / h) * 24;
  const vite = plus > 0 && (plus / h >= GRANDIT.parHeure || plus >= GRANDIT.parJour);
  return { grandit: vite, parJour: Math.round(parJour), recul: h, ...(vite && libre !== undefined && parJour > 0 ? { joursAvantPlein: Math.max(0, Math.round((libre / parJour) * 10) / 10) } : {}) };
}
/** Ajoute une mesure (les plus vieilles que la fenêtre partent, au plus GRANDIT.garder par volume). Pur. */
export function ajouterMesure(l: Mesure[] | undefined, at: number, o: number): Mesure[] {
  return [...(l ?? []), { at, o }].filter((x) => x.at >= at - GRANDIT.fenetreH * 3600_000 * 2).slice(-GRANDIT.garder);
}
