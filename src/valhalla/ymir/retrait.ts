// Hydre, lot M3 (maquette « Conteneurs et machines » validée le 23/11) : supprimer une machine de ce PC, avec son
// garde-fou.
//   - au propriétaire seul, noté dans « qui a fait quoi » ;
//   - refusé tant qu'elle tourne (allumée, en pause, ou état illisible) ou qu'un dépendant vivant existe (registre,
//     Genèse, Arche : voir dependances.ts) ;
//   - son nom écrit en entier ; pour une VM, le choix dit de son disque : le GARDER (son dossier rangé à part, dans
//     « machines/gardes ») ou l'EFFACER ;
//   - jamais un disque hors du dossier des VM : le chemin réel est revérifié, aucun raccourci n'est suivi (un dossier de
//     VM qui est un raccourci est refusé ; un raccourci DANS le dossier est retiré seul, sans toucher à ce qu'il vise) ;
//   - le dossier est d'abord mis de côté d'un seul geste (renommé), la machine et ses dépendants relus, et seulement
//     alors effacé ; si Odin s'arrête en plein retrait, le dossier mis de côté d'une machine encore listée est remis à
//     sa place (jamais effacé tout seul).
// Comme le retrait d'un volume d'Arche (K2) et celui d'un système de Genèse (S3).
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { Action, ActionResult, ModCtx } from '../types.ts';
import { avecJournal } from '../vidarr/qui-a-fait.ts';
import { allumee, ifname, Local, systemeVm, type Machine } from './local.ts';
import { bilans, oublierMachine, trouverExact } from './dependances.ts';

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const memeChemin = (a: string, b: string) => { const x = resolve(a), y = resolve(b); return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y; };
/** Un nom de machine d'Hydre : celui qui fait le nom de son dossier (jamais « .. », ni un séparateur). */
const NOM_SUR = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** Un dossier de VM mis de côté par un retrait : « .retrait-<12 hex>-<nom> ». */
const MIS_DE_COTE = /^\.retrait-([0-9a-f]{12})-([a-z0-9][a-z0-9-]{0,62})$/;
/** Les suppressions en cours dans ce processus (une seule à la fois par machine). */
const EN_COURS = new Set<string>();

/** Le nom écrit est-il celui de la machine ? (sans espaces autour, majuscules ou non). Pur. */
export const nomEcritJuste = (ecrit: unknown, nom: string) => nom !== '' && s(ecrit).trim().toLowerCase() === nom.toLowerCase();

/** Un raccourci (lien symbolique, ou jonction sous Windows) : retiré seul, ce qu'il vise n'est pas touché. */
function retirerRaccourci(p: string): void {
  try { unlinkSync(p); } catch (e) { if (lstatSync(p).isSymbolicLink()) rmdirSync(p); else throw e; }
}
/**
 * Efface un dossier et ce qu'il contient, sans jamais suivre un raccourci : chaque étage est relu (lstat), un raccourci
 * est retiré seul, un sous-dossier doit avoir pour chemin réel lui-même. Rend le nombre de fichiers effacés.
 */
export function effacerArbre(d: string): number {
  let n = 0;
  for (const x of readdirSync(d)) {
    const p = join(d, x), st = lstatSync(p);
    if (st.isSymbolicLink()) { retirerRaccourci(p); continue; }
    if (st.isDirectory()) {
      if (!memeChemin(realpathSync.native(p), p)) throw new Error('un dossier a changé pendant l\'effacement : arrêté, rien d\'autre n\'est touché');
      n += effacerArbre(p); rmdirSync(p); continue;
    }
    unlinkSync(p); n++;
  }
  return n;
}

/** Le dossier `base` ou son parent (le dossier des machines d'Hydre) est-il un raccourci ? (absent : non) */
function raccourciAuDessus(base: string): boolean {
  for (const p of [base, dirname(base)]) { try { if (lstatSync(p).isSymbolicLink()) return true; } catch { /* absent */ } }
  return false;
}

/**
 * Le dossier d'une VM, vérifié : sous le dossier réel des VM, un vrai dossier (pas un raccourci), son chemin réel
 * est lui-même. `undefined` : il n'existe pas (le disque a déjà disparu).
 */
export function dossierVmVerifie(base: string, nom: string): { base: string; dossier: string } | undefined {
  const hors = () => new Error('ce dossier n\'est pas rangé dans le dossier des machines virtuelles : rien n\'est effacé');
  if (!NOM_SUR.test(nom)) throw hors();
  // Le dossier des VM (ou celui des machines, au-dessus) remplacé par un raccourci : ce qui serait « dedans » est
  // ailleurs (le dossier personnel…). Refusé, rien n'est touché.
  if (raccourciAuDessus(base)) throw new Error('le dossier des machines virtuelles est un raccourci vers un autre endroit : Odin ne suit aucun raccourci, rien n\'est effacé');
  let reelle: string; try { reelle = realpathSync.native(base); } catch { return undefined; }
  const p = join(reelle, nom);
  let st; try { st = lstatSync(p); } catch { return undefined; }
  if (st.isSymbolicLink()) throw new Error('le dossier de cette machine est un raccourci vers un autre endroit : Odin ne suit aucun raccourci, rien n\'est effacé');
  if (!st.isDirectory()) throw hors();
  let r: string; try { r = realpathSync.native(p); } catch { throw hors(); }
  if (!memeChemin(r, p)) throw hors();
  return { base: reelle, dossier: p };
}

/**
 * Met le dossier d'une VM de côté d'un seul geste (renommé : rien n'est copié, même un gros disque), relit avec `garde`,
 * puis le garde à part (`vers` : dossier « gardes ») ou l'efface. Une raison rendue par `garde` : le dossier revient à
 * sa place, rien n'est touché. Rend où le disque est gardé, ou rien s'il a été effacé.
 */
export async function retirerDossierVm(base: string, nom: string, o: { vers?: string; garde?: (cote?: string) => Promise<string | undefined>; quand?: Date }): Promise<{ garde?: string; absent?: boolean }> {
  const v = dossierVmVerifie(base, nom);
  if (!v) { const r = await o.garde?.(); if (r) throw new Error(r); return { absent: true }; }
  let cote: string;
  if (o.vers !== undefined) {
    mkdirSync(o.vers, { recursive: true });
    const st = lstatSync(o.vers); if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('le dossier « gardes » est un raccourci : Odin ne suit aucun raccourci, rien n\'est déplacé');
    const g = realpathSync.native(o.vers), d = o.quand ?? new Date(), date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    cote = join(g, `${nom}-${date}`); for (let k = 2; existsSync(cote); k++) cote = join(g, `${nom}-${date}-${k}`);
  } else cote = join(v.base, `.retrait-${randomBytes(6).toString('hex')}-${nom}`);
  try { renameSync(v.dossier, cote); } catch (e) {
    const c = (e as NodeJS.ErrnoException).code;
    throw new Error(c === 'EXDEV' ? 'le dossier « gardes » n\'est pas sur le même disque que la machine : rien n\'est déplacé' : c === 'EBUSY' || c === 'EPERM' || c === 'EACCES' ? 'son disque est ouvert par un autre programme : ferme-le, puis recommence (rien n\'est effacé)' : 'le système refuse de déplacer son dossier : rien n\'est effacé');
  }
  const remettre = () => { try { if (!existsSync(v.dossier)) renameSync(cote, v.dossier); } catch { /* laissé de côté, intact */ } };
  // Relu après le geste : toujours un vrai dossier, à sa place réelle, et le dossier des VM n'a pas changé.
  const ici = () => { try { const st = lstatSync(cote); return !raccourciAuDessus(base) && !st.isSymbolicLink() && st.isDirectory() && memeChemin(realpathSync.native(cote), cote) && memeChemin(realpathSync.native(base), v.base); } catch { return false; } };
  if (!ici()) { remettre(); throw new Error('le dossier de cette machine a changé pendant le retrait : il est remis à sa place, rien n\'est effacé'); }
  if (o.garde) {
    let r: string | undefined; try { r = await o.garde(cote); } catch (e) { r = (e as Error).message || 'vérification impossible'; }
    if (r) { remettre(); throw new Error(r); }
    if (!ici()) { remettre(); throw new Error('le dossier de cette machine a changé pendant le retrait : il est remis à sa place, rien n\'est effacé'); }
  }
  if (o.vers !== undefined) return { garde: cote };
  try { effacerArbre(cote); rmdirSync(cote); } catch (e) {
    remettre();
    throw new Error(`effacement interrompu (${(e as Error).message}) : ce qui reste de son dossier est remis à sa place`);
  }
  return {};
}

/** Après un arrêt brutal d'Odin en plein retrait : le dossier mis de côté d'une VM encore listée revient à sa place. */
export function reprendreRetraits(L: Local): number {
  const base = join(L.dir, 'vm'); let n = 0, l: string[] = [];
  if (raccourciAuDessus(base)) return 0; // jamais à travers un raccourci
  try { l = readdirSync(base); } catch { return 0; }
  // Une machine en train d'être supprimée par ce processus : son dossier mis de côté n'est pas repris sous ses pieds.
  const noms = new Map(L.list().filter((m) => m.genre === 'vm').map((m) => [m.nom, m.id]));
  for (const x of l) {
    const m = MIS_DE_COTE.exec(x); if (!m || !noms.has(m[2]) || EN_COURS.has(noms.get(m[2])!)) continue;
    const p = join(base, x), dest = join(base, m[2]);
    try { const st = lstatSync(p); if (st.isSymbolicLink() || !st.isDirectory() || existsSync(dest)) continue; renameSync(p, dest); n++; } catch { /* réessayé au passage suivant */ }
  }
  return n;
}

/**
 * Le disque d'un LXC d'après sa configuration (« lxc.rootfs.path », la dernière ligne compte) : une raison s'il n'est pas
 * dans le dossier du conteneur (chemin réel, aucun raccourci), ou d'un genre qu'Hydre ne vérifie pas (overlay, LVM, ZFS…).
 * `undefined` : dedans, ou pas de configuration (l'outil LXC ne trouve alors rien à effacer).
 */
export function disqueLxcHors(lxcDir: string, nom: string): string | undefined {
  const dossier = join(lxcDir, nom); let txt: string;
  try { txt = readFileSync(join(dossier, 'config'), 'utf8'); } catch { return undefined; }
  const l = [...txt.matchAll(/^[ \t]*lxc\.rootfs\.path[ \t]*=[ \t]*(.*?)[ \t]*$/gm)].at(-1)?.[1]; if (l === undefined || l === '') return undefined;
  const hors = `sa configuration met son disque hors de son dossier (${l.slice(0, 160)}) : l'outil LXC l'effacerait là-bas`;
  const c = /^(?:dir|loop):(.*)$/.exec(l)?.[1] ?? l;
  if (!isAbsolute(c)) return `sa configuration donne un disque qu'Hydre ne sait pas vérifier (${l.slice(0, 160)})`;
  let reel: string, chez: string;
  try { chez = realpathSync.native(dossier); } catch { return hors; }
  try { reel = realpathSync.native(c); } catch { reel = resolve(c); /* pas (encore) là : rien à effacer là-bas */ }
  const r = process.platform === 'win32' ? reel.toLowerCase() : reel, d = process.platform === 'win32' ? chez.toLowerCase() : chez;
  return r.startsWith(d + sep) ? undefined : hors;
}

/** Ce qui reste après la suppression (dit au propriétaire). */
function cequiReste(m: Machine): string[] {
  const l: string[] = [];
  if (m.apps.includes('vidarr')) l.push(`Le nom ${m.nom}.maison reste dans Sphinx : retire-le si tu n'en veux plus.`);
  if (m.apps.includes('vordr')) l.push(`La surveillance de ${m.nom} reste dans Pulsar : retire-la si tu n'en veux plus.`);
  return l;
}

/** La suppression avec son garde-fou (voir l'en-tête). */
export async function supprimerMachine(ctx: ModCtx, i: Record<string, unknown>): Promise<ActionResult> {
  const L = new Local(ctx), m = trouverExact(L, i.machine), d = s(i.disque).trim().toLowerCase();
  // Toute machine : son nom écrit en entier, d'où que vienne la demande (page, conversation, programme). Une VM : en plus,
  // le choix dit de son disque. Un LXC : son disque part avec lui.
  if (!nomEcritJuste(i.nom, m.nom)) return { ok: false, text: `Refusé, rien n'est effacé : écris exactement « ${m.nom} » pour confirmer.`, data: { aEcrire: m.nom } };
  if (m.genre === 'vm' && d !== 'garder' && d !== 'effacer') return { ok: false, text: `Refusé, rien n'est effacé : dis ce que devient son disque (${m.disque} Go) : le garder à part, ou l'effacer.` };
  if (m.genre === 'lxc' && d === 'garder') return { ok: false, text: `Refusé : pour un conteneur LXC, Hydre ne sait pas encore garder son disque à part. Exporte-le d'abord en .ody (« Exporter en .ody »), puis supprime-le en effaçant son disque.` };
  if (EN_COURS.has(m.id)) return { ok: false, text: `${m.nom} est déjà en train d'être supprimée.` };
  // Un retrait coupé net (Odin arrêté) a pu laisser son dossier de côté : remis à sa place d'abord, sinon son disque
  // passerait pour « disparu » et resterait de côté, ni gardé ni effacé.
  if (m.genre === 'vm') reprendreRetraits(L);
  EN_COURS.add(m.id);
  try {
    // Ce qui l'empêche (relu juste avant, puis une seconde fois le dossier mis de côté).
    const obstacle = async (cote?: string): Promise<string | undefined> => {
      const x = L.list().find((y) => y.id === m.id); if (!x) return `${m.nom} n'existe plus dans Hydre`;
      const e = await L.etat(x).catch(() => ({ state: 'inconnue' as const }));
      if (allumee(e)) return `Refusé, rien n'est effacé : ${m.nom} est ${e.state === 'en pause' ? 'en pause' : 'allumée'} : arrête-la d'abord.`;
      if (e.state === 'inconnue') return `Refusé, rien n'est effacé : Odin ne sait pas si ${m.nom} tourne (son état ne se lit pas).`;
      // Une VM sans numéro de processus lisible qui répond encore sur son canal de contrôle : elle tourne.
      if (x.genre === 'vm') { const r = await systemeVm.qmp(L.qmpSock(x), 'query-status').then(() => true, () => false); if (r) return `Refusé, rien n'est effacé : ${m.nom} répond encore sur son canal de contrôle (elle tourne) : arrête-la d'abord.`; }
      const b = (await bilans(ctx, x)).machines[m.id];
      if (b?.bloquants.length) return `Refusé, rien n'est effacé : ${b.bloquants.join(' ; ')}.`;
      // En dernier, juste avant d'effacer : une VM démarrée pendant le retrait a laissé son numéro de processus dans le dossier mis de côté.
      if (cote) { let pid = 0; try { pid = Number(readFileSync(join(cote, 'pid'), 'utf8').trim()); } catch { /* jamais démarrée */ } if (pid > 0 && systemeVm.enVie(pid)) return `Refusé, rien n'est effacé : ${m.nom} vient de démarrer : arrête-la d'abord.`; }
      return undefined;
    };
    const avant = await obstacle(); if (avant) return { ok: false, text: avant };
    const restes = (await bilans(ctx, m)).machines[m.id]?.dependants.filter((x) => !x.vivant).map((x) => x.texte) ?? [];
    let ou: string | undefined, absent = false;
    if (m.genre === 'vm') {
      const r = await retirerDossierVm(join(L.dir, 'vm'), m.nom, { ...(d === 'garder' ? { vers: join(L.dir, 'gardes') } : {}), garde: obstacle, quand: ctx.now() })
        .catch((e: Error) => ({ erreur: e.message }));
      if ('erreur' in r) return { ok: false, text: /^Refusé/.test(r.erreur) ? r.erreur : `Refusé : ${r.erreur}.` };
      ou = r.garde; absent = Boolean(r.absent);
      await ctx.run('ip', ['link', 'del', ifname(m)], { timeoutMs: 10_000, sudo: true }).catch(() => undefined); // sa carte réseau côté PC, s'il en reste une
    } else {
      // Un LXC : son dossier ne doit pas être un raccourci (l'outil LXC tourne avec les droits d'administrateur).
      try { if (lstatSync(join(L.lxcDir, m.nom)).isSymbolicLink()) return { ok: false, text: 'Refusé, rien n\'est effacé : le dossier de ce conteneur est un raccourci vers un autre endroit (Odin ne suit aucun raccourci).' }; } catch { /* déjà parti */ }
      // L'outil LXC efface le disque que nomme sa configuration, où qu'il soit : il doit être dans le dossier du conteneur.
      const hors = disqueLxcHors(L.lxcDir, m.nom); if (hors) return { ok: false, text: `Refusé, rien n'est effacé : ${hors}.` };
      const r = await ctx.run('lxc-destroy', ['-P', L.lxcDir, '-n', m.nom], { timeoutMs: 120_000, sudo: true });
      if (r.code !== 0 && existsSync(join(L.lxcDir, m.nom))) return { ok: false, text: `Refusé : la suppression du conteneur a échoué (${(r.err || r.out).trim().split('\n').at(-1)?.slice(0, 200) || `code ${r.code}`}).` };
    }
    L.save(L.list().filter((x) => x.id !== m.id));
    oublierMachine(ctx, m.id);
    ctx.emit('machine_supprimee', { nom: m.nom, genre: m.genre, disque: ou ? 'gardé' : 'effacé' });
    const disque = m.genre === 'lxc' ? 'son disque est effacé' : ou ? `son disque (${m.disque} Go) est gardé à part dans ${ou}` : absent ? 'son disque avait déjà disparu' : `son disque (${m.disque} Go) est effacé`;
    return { text: [`🗑 ${m.nom} supprimée : ${disque}.`, ...restes, ...cequiReste(m)].join('\n'), data: { supprimee: m.nom, ...(ou ? { garde: ou } : {}) } };
  } finally { EN_COURS.delete(m.id); }
}

/** L'action (remplace l'ancienne « Supprimer » des machines de ce PC, même identifiant). */
export function retraitActions(): Action[] {
  return avecJournal('ymir_actes', [{
    id: 'supprimer_machine', label: 'Supprimer', proprietaireSeul: true,
    what: 'Supprime une machine éteinte de ce PC, son nom écrit en entier ; pour une VM, son disque est gardé à part ou effacé, au choix. Refusé tant qu\'elle tourne ou que quelque chose qui en dépend tourne',
    params: [{ key: 'machine', label: 'Machine (nom exact)', kind: 'text', required: true }, { key: 'nom', label: 'Son nom, écrit en entier', kind: 'text', default: '' }, { key: 'disque', label: 'Son disque', kind: 'select', options: ['', 'garder', 'effacer'], default: '' }],
    grave: (i) => `supprimer la machine ${s(i.machine)}${s(i.disque) === 'garder' ? ' (son disque est gardé à part)' : s(i.disque) === 'effacer' ? ' et EFFACER son disque' : ' et tout son disque'}`,
    run: supprimerMachine,
  }]);
}
