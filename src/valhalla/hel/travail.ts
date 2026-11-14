// Perséphone · le travail lui-même : chercher les partitions perdues, recopier les fichiers retrouvés sur un AUTRE
// disque, et réparer une table de partitions (avec sa copie de secours, et le retour en arrière).
// La source est ouverte en lecture seule partout, sauf dans `ecrireTable` et `remettreTable`, les deux seules
// fonctions qui écrivent sur un support, et seulement les secteurs de la table.
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, statfsSync, writeFileSync, writeSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { effacesExfat, effacesFat, type Efface } from './fat.ts';
import { propre, taille as tailleLisible } from './octets.ts';
import { debutConforme, familleDuNom, fouiller, verifier, type Famille } from './signatures.ts';
import { ouvrir, parMorceaux, tranche, type Lecteur, type Support } from './support.ts';
import { chercherPartitions, choisir, NOM_GENRE, reconnaitre, type Prevue, type Trouvee } from './systemes.ts';
import { construireGpt, construireMbr, lireGpt, lireTable, reparerGpt, type Ecriture, type Table } from './tables.ts';

export const MO = 1024 * 1024;
const pause = () => new Promise<void>((r) => setImmediate(r));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Où en est un travail en cours (lu par la page toutes les deux secondes). */
export interface Suivi { fait: number; total: number; trouves: number; etape: string }

// ---------------------------------------------------------------- la table actuelle, en clair
export interface TableVue { genre: Table['genre']; secteur: number; partitions: Array<{ numero: number; debut: number; taille: number; type: string; nom?: string; fs?: string; etiquette?: string }>; remarques: string[] }
/** La table de partitions d'un support, avec ce qu'il y a au début de chaque partition. */
export async function lireTableVue(s: Lecteur): Promise<TableVue> {
  const t = await lireTable(s), out: TableVue = { genre: t.genre, secteur: t.secteur, partitions: [], remarques: t.remarques };
  for (const p of t.partitions) {
    const debut = p.debut * t.secteur, f = /^0x0[5f]$|^0x85$/.test(p.code) ? undefined : await reconnaitre(s, debut).catch(() => undefined);
    out.partitions.push({ numero: p.numero, debut, taille: p.secteurs * t.secteur, type: p.genre, ...(p.nom ? { nom: p.nom } : {}), ...(f ? { fs: NOM_GENRE[f.genre] } : {}), ...(f?.etiquette ? { etiquette: f.etiquette } : {}) });
  }
  if (t.genre === 'aucune') { const f = await reconnaitre(s, 0).catch(() => undefined); if (f) out.remarques.unshift(`Pas de table : le support entier est un seul volume ${NOM_GENRE[f.genre]}${f.etiquette ? ` (« ${f.etiquette} »)` : ''}. C'est normal pour beaucoup de clés et de cartes.`); }
  return out;
}

// ---------------------------------------------------------------- partitions perdues
export interface ResultatPartitions {
  source: string; taille: number; secteur: number; quand: string; profondeur: 'rapide' | 'complète'; arretee: boolean; octets: number;
  actuelle: TableVue; trouvees: Trouvee[]; prevues: Prevue[]; ecartees: string[];
  /** des tables GPT entières vues ailleurs qu'à leur place (disque copié dans un autre, par exemple) */
  autresGpt: number;
}
export async function chercher(s: Support, o: { profondeur: 'rapide' | 'complète'; arret: { stop: boolean }; suivi: Suivi; quand: string }): Promise<ResultatPartitions> {
  o.suivi.total = s.taille; o.suivi.etape = 'Lecture de la table actuelle';
  const actuelle = await lireTableVue(s), sec = (await lireTable(s)).secteur;
  o.suivi.etape = o.profondeur === 'rapide' ? 'Recherche rapide (aux endroits habituels)' : 'Recherche complète (chaque secteur)';
  const r = await chercherPartitions(s, { profondeur: o.profondeur, arret: o.arret, surAvance: (n, t) => { o.suivi.fait = n; o.suivi.trouves = t; }, gptEn: (lba) => lireGpt(s, lba, sec) });
  const { prevues, ecartees } = choisir(r.trouvees, sec, Math.floor(s.taille / sec));
  return { source: s.chemin, taille: s.taille, secteur: sec, quand: o.quand, profondeur: o.profondeur, arretee: r.arretee, octets: r.octets, actuelle, trouvees: r.trouvees, prevues, ecartees, autresGpt: r.gpt.length };
}

// ---------------------------------------------------------------- la table proposée
export interface Proposition {
  /** « copie » : une des deux copies GPT est intacte, on refait l'autre ; « neuve » : table refaite d'après les partitions retrouvées */
  mode: 'copie' | 'neuve'; genre: 'gpt' | 'mbr';
  partitions: Array<{ numero: number; debut: number; taille: number; type: string; etiquette?: string }>;
  ecritures: Ecriture[]; explication: string;
}
/**
 * Ce qu'on écrirait pour remettre la table. Rien n'est écrit ici. `refus` : pourquoi on ne propose rien.
 * `genre` : « automatique » (GPT si le support en avait une, ou s'il est neuf ou très grand ; sinon MBR).
 */
export async function proposer(s: Lecteur, r: ResultatPartitions | undefined, genre: 'automatique' | 'gpt' | 'mbr' = 'automatique'): Promise<Proposition | { refus: string }> {
  const t = await lireTable(s), s0 = await s.lire(0, 512), sec = t.secteur;
  const copie = t.genre === 'gpt' ? reparerGpt(t, s0) : undefined;
  if (copie && genre !== 'mbr') {
    return { mode: 'copie', genre: 'gpt', partitions: t.partitions.map((p) => ({ numero: p.numero, debut: p.debut * sec, taille: p.secteurs * sec, type: p.genre, ...(p.nom ? { etiquette: p.nom } : {}) })), ecritures: copie.ecritures,
      explication: `La copie ${copie.depuis === 'principale' ? 'principale (au début)' : 'de secours (à la fin)'} de la table GPT est intacte : je refais l'autre à l'identique (mêmes partitions, mêmes identifiants).` };
  }
  if (!r) return { refus: 'Lance d\'abord « Chercher les partitions perdues » : la table proposée vient de ce qui est retrouvé.' };
  if (r.source !== (s as Support).chemin || r.taille !== s.taille) return { refus: 'La dernière recherche de partitions a été faite sur un autre support : relance-la sur celui-ci.' };
  if (!r.prevues.length) return { refus: `Aucune partition retrouvée qui puisse former une table.${r.ecartees.length ? ` Écartées : ${r.ecartees.join(' ; ')}.` : ''}` };
  if (t.genre !== 'aucune' && t.partitions.length && r.prevues.every((p) => t.partitions.some((q) => q.debut === p.debut))) return { refus: 'La table actuelle est lisible et contient déjà toutes les partitions retrouvées : rien à réparer.' };
  const total = Math.floor(s.taille / sec), traceGpt = t.mbr.protecteur || t.gpt.principal.present || t.gpt.secours.present;
  const g: 'gpt' | 'mbr' = genre !== 'automatique' ? genre : traceGpt || r.prevues.length > 4 || total > 0xffffffff || !t.mbr.signature ? 'gpt' : 'mbr';
  const parts = r.prevues.map((p) => ({ debut: p.debut, secteurs: p.secteurs, type: p.type, code: p.code, ...(p.etiquette ? { nom: p.etiquette } : {}) }));
  let ecritures: Ecriture[];
  try {
    ecritures = g === 'gpt' ? construireGpt({ secteur: sec, secteurs: total, partitions: parts, actuel: s0, ...(t.gpt.principal.guid ?? t.gpt.secours.guid ? { guidDisque: (t.gpt.principal.guid ?? t.gpt.secours.guid)! } : {}) }) : construireMbr(s0, parts, total);
  } catch (e) { return { refus: `Je ne peux pas faire une table ${g.toUpperCase()} avec ces partitions : ${(e as Error).message}.` }; }
  return { mode: 'neuve', genre: g, partitions: r.prevues.map((p, i) => ({ numero: i + 1, debut: p.debut * sec, taille: p.secteurs * sec, type: p.genre, ...(p.etiquette ? { etiquette: p.etiquette } : {}) })), ecritures,
    explication: `Une table ${g === 'gpt' ? 'GPT (au début et sa copie à la fin du support)' : 'MBR (premier secteur)'} avec les ${r.prevues.length} partition(s) retrouvée(s). Le contenu des partitions n'est pas touché : seuls les secteurs de la table sont écrits.` };
}

// ---------------------------------------------------------------- écrire la table, avec sa copie de secours
export interface Manifeste { id: string; source: string; taille: number; quand: string; quoi: string; zones: Array<{ fichier: string; pos: number; len: number; sha256: string }>; ecritures: Array<{ pos: number; len: number; quoi: string }> }
/** Les zones à garder avant d'écrire : le début et la fin du support (1 Mo chacun au moins), qui couvrent toutes les écritures. */
export function zonesDeSecours(taille: number, ecritures: Ecriture[]): Array<[number, number]> {
  const moitie = taille / 2; let tete = Math.min(taille, MO), queue = Math.max(0, taille - MO);
  for (const e of ecritures) { if (e.pos < moitie) tete = Math.max(tete, e.pos + e.data.length); else queue = Math.min(queue, e.pos); }
  return queue <= tete ? [[0, taille]] : [[0, tete], [queue, taille - queue]];
}
/**
 * Écrit une table sur le support, après en avoir gardé les zones (début, fin) dans `dossier/<id>/`. La copie de
 * secours est relue et vérifiée AVANT la première écriture. Rend le manifeste (pour « remettre la table d'avant »).
 */
export async function ecrireTable(chemin: string, ecritures: Ecriture[], dossier: string, o: { quand: string; quoi: string }): Promise<Manifeste> {
  const s = await ouvrir(chemin); let m: Manifeste;
  try {
    const id = `${o.quand.slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-')}-${randomBytes(2).toString('hex')}`, rep = join(dossier, id);
    mkdirSync(rep, { recursive: true });
    m = { id, source: chemin, taille: s.taille, quand: o.quand, quoi: o.quoi, zones: [], ecritures: ecritures.map((e) => ({ pos: e.pos, len: e.data.length, quoi: e.quoi })) };
    for (const [i, [pos, len]] of zonesDeSecours(s.taille, ecritures).entries()) {
      const b = await s.lire(pos, len); if (b.length !== len) throw new Error('le support n\'a pas rendu toute la zone à garder');
      if (s.illisibles) throw new Error('une partie de la zone à garder est illisible : je n\'écris rien sans une copie de secours complète');
      const fichier = i === 0 ? 'debut.bin' : 'fin.bin', f = join(rep, fichier), fd = openSync(f, 'wx');
      try { writeSync(fd, b); fsyncSync(fd); } finally { closeSync(fd); }
      if (sha(readFileSync(f)) !== sha(b)) throw new Error('la copie de secours relue ne correspond pas : rien n\'a été écrit');
      m.zones.push({ fichier, pos, len, sha256: sha(b) });
    }
    writeFileSync(join(rep, 'manifeste.json'), JSON.stringify(m, null, 1));
  } finally { await s.fermer(); }
  await ecrireSur(chemin, ecritures.map((e) => [e.pos, e.data]));
  return m;
}
/** Remet les zones gardées par `ecrireTable` : le support revient octet pour octet à ce qu'il était avant. */
export async function remettreTable(dossier: string, id: string, chemin: string): Promise<Manifeste> {
  const m = lireManifeste(dossier, id); if (!m) throw new Error(`je ne trouve pas la copie de secours « ${id} »`);
  if (m.source !== chemin) throw new Error(`cette copie de secours vient de ${m.source}, pas de ${chemin}`);
  const s = await ouvrir(chemin); try { if (s.taille !== m.taille) throw new Error(`le support n'a plus la même taille (${tailleLisible(s.taille)} au lieu de ${tailleLisible(m.taille)}) : ce n'est sans doute pas le même`); } finally { await s.fermer(); }
  const zones = m.zones.map((z) => { const b = readFileSync(join(dossier, id, z.fichier)); if (b.length !== z.len || sha(b) !== z.sha256) throw new Error(`la copie de secours ${z.fichier} est abîmée : je ne l'écris pas`); return [z.pos, b] as [number, Buffer]; });
  await ecrireSur(chemin, zones);
  const s2 = await ouvrir(chemin);
  try { for (const z of m.zones) if (sha(await s2.lire(z.pos, z.len)) !== z.sha256) throw new Error('relue après écriture, la zone ne correspond pas à la copie de secours'); } finally { await s2.fermer(); }
  return m;
}
async function ecrireSur(chemin: string, zones: Array<[number, Buffer]>): Promise<void> {
  const fh = await open(chemin, 'r+');
  try { for (const [pos, b] of zones) { let n = 0; while (n < b.length) n += (await fh.write(b, n, b.length - n, pos + n)).bytesWritten; } await fh.sync(); } finally { await fh.close(); }
}
export function lireManifeste(dossier: string, id: string): Manifeste | undefined {
  if (!/^[\w-]+$/.test(id)) return undefined;
  try { return JSON.parse(readFileSync(join(dossier, id, 'manifeste.json'), 'utf8')) as Manifeste; } catch { return undefined; }
}
export function listerSecours(dossier: string): Manifeste[] {
  let ids: string[] = []; try { ids = readdirSync(dossier); } catch { return []; }
  return ids.map((id) => lireManifeste(dossier, id)).filter((m): m is Manifeste => Boolean(m)).sort((a, b) => b.quand.localeCompare(a.quand));
}

// ---------------------------------------------------------------- recopier les fichiers retrouvés
export type Etat = 'entier' | 'abîmé' | 'non vérifiable';
export interface Recupere { chemin: string; famille: string; taille: number; etat: Etat; origine: 'nom' | 'signature'; pos: number; note?: string }
export interface Rapport {
  id: string; source: string; dossier: string; debut: string; fin?: string; arretee: boolean; erreur?: string;
  octetsLus: number; total: number; illisibles: number;
  compte: { entiers: number; abimes: number; nonVerifiables: number; tropGros: number; ecrases: number };
  parFamille: Record<string, { n: number; octets: number }>;
  /** les premiers fichiers (la liste complète est dans rapport.txt, à côté des fichiers) */
  fichiers: Recupere[];
  /** fichiers vus dans les dossiers (FAT, exFAT) mais dont la place a été reprise */
  perdus: Array<{ chemin: string; note: string }>;
}
export interface OptionsRecup { familles?: Famille[]; plafond?: number; noms: boolean; arret: { stop: boolean }; suivi: Suivi; quand: string; id: string }
const GARDES = 2000;
/** Un nom de fichier sans danger (pas de dossier caché, pas de remontée, pas de caractère de commande). */
const sur = (t: string) => propre(t, 120).replace(/[/\\:*?"<>|]/g, '_').replace(/^\.+/, '_') || '_';
/** Un nom libre dans ce dossier (« photo.jpg », puis « photo (2).jpg »…). */
function libre(rep: string, nom: string): string {
  if (!existsSync(join(rep, nom))) return join(rep, nom);
  const e = extname(nom), b = nom.slice(0, nom.length - e.length);
  for (let i = 2; ; i++) if (!existsSync(join(rep, `${b} (${i})${e}`))) return join(rep, `${b} (${i})${e}`);
}
/** Recopie `n` octets d'un lecteur dans un nouveau fichier, par morceaux de 1 Mo (mémoire bornée). */
async function recopier(l: Lecteur, pos: number, n: number, cible: string): Promise<void> {
  mkdirSync(dirname(cible), { recursive: true });
  const fd = openSync(cible, 'wx');
  try { for (let o = 0; o < n; o += MO) { const b = await l.lire(pos + o, Math.min(MO, n - o)); writeSync(fd, b); } } finally { closeSync(fd); }
}
/** De la place pour `n` octets de plus, avec une marge (on ne remplit jamais un disque jusqu'au dernier octet). */
function place(rep: string, n: number): boolean { try { const f = statfsSync(rep); return f.bavail * f.bsize > n + 64 * MO; } catch { return true; } }

/**
 * Recopie dans `<dest>/recuperes/<famille>/…` ce qui peut être retrouvé : d'abord les fichiers effacés des volumes
 * FAT et exFAT avec leur nom (si `noms`), puis tout le support par signatures. La destination a déjà été vérifiée
 * (autre disque) par l'appelant. Chaque fichier est relu et vérifié ; les abîmés vont dans `…/abîmés/`.
 */
export async function recuperer(s: Support, dest: string, o: OptionsRecup): Promise<Rapport> {
  const racine = join(dest, 'recuperes'), veut = o.familles?.length ? new Set<string>(o.familles) : undefined;
  const r: Rapport = { id: o.id, source: s.chemin, dossier: racine, debut: o.quand, arretee: false, octetsLus: 0, total: s.taille, illisibles: 0, compte: { entiers: 0, abimes: 0, nonVerifiables: 0, tropGros: 0, ecrases: 0 }, parFamille: {}, fichiers: [], perdus: [] };
  const lignes: string[] = [];
  mkdirSync(racine, { recursive: true });
  const noter = (f: Recupere) => {
    if (f.etat === 'entier') r.compte.entiers++; else if (f.etat === 'abîmé') r.compte.abimes++; else r.compte.nonVerifiables++;
    const x = (r.parFamille[f.famille] ??= { n: 0, octets: 0 }); x.n++; x.octets += f.taille;
    if (r.fichiers.length < GARDES) r.fichiers.push(f);
    lignes.push(`${f.etat}\t${f.taille}\t${f.origine}\t${f.chemin}${f.note ? `\t${f.note}` : ''}`); o.suivi.trouves++;
  };
  const plein = (n: number) => { if (place(racine, n)) return false; r.erreur = `Le disque de destination est presque plein : j'ai arrêté avant de le remplir. Libère de la place (ou choisis un autre dossier) puis relance.`; o.arret.stop = true; return true; };
  o.suivi.total = s.taille;
  // 1. Les fichiers effacés avec leur nom (FAT, exFAT), partition par partition.
  const sauter: Array<[number, number]> = [];
  if (o.noms) {
    o.suivi.etape = 'Lecture des dossiers (fichiers effacés avec leur nom)';
    const t = await lireTable(s), volumes: Array<[number, number]> = t.partitions.length ? t.partitions.map((p) => [p.debut * t.secteur, p.secteurs * t.secteur]) : [[0, s.taille]];
    for (const [debut, longueur] of volumes) {
      if (o.arret.stop) break;
      const v = tranche(s, debut, longueur), fs = await reconnaitre(v, 0).catch(() => undefined); if (!fs || !/^(fat|exfat)/.test(fs.genre)) continue;
      let liste: Efface[] = [];
      try { liste = fs.genre === 'exfat' ? await effacesExfat(v, { arret: o.arret }) : await effacesFat(v, { arret: o.arret, signature: debutConforme }); } catch { continue; }
      for (const e of liste) {
        if (o.arret.stop) break;
        const famille = familleDuNom(e.nom) ?? 'autres', chemin = e.chemin ? `${e.chemin}/${e.nom}` : e.nom;
        if (veut && !veut.has(famille)) continue;
        if (e.etat === 'écrasé' || !e.morceaux.length) { r.compte.ecrases++; if (r.perdus.length < GARDES) r.perdus.push({ chemin, note: e.note ?? 'sa place a été reprise' }); lignes.push(`perdu\t${e.taille}\tnom\t${chemin}\t${e.note ?? ''}`); continue; }
        const l = parMorceaux(v, e.morceaux), lu = l.taille, ver = await verifier(e.nom, l).catch(() => ({ etat: 'abîmé' as const, note: 'sa structure ne se lit pas' }));
        const etat: Etat = ver.etat === 'entier' ? 'entier' : ver.etat === 'abîmé' ? 'abîmé' : e.etat === 'récupérable' ? 'non vérifiable' : 'abîmé';
        if (plein(lu)) break;
        const rep = join(racine, famille, ...(etat === 'abîmé' ? ['abîmés'] : []), ...e.chemin.split('/').filter(Boolean).map(sur)), cible = libre(rep, sur(e.nom));
        await recopier(l, 0, lu, cible);
        const note = etat === 'abîmé' ? ver.note ?? e.note : e.etat === 'incertain' ? e.note : undefined;
        noter({ chemin: cible.slice(racine.length + 1), famille, taille: lu, etat, origine: 'nom', pos: debut + e.morceaux[0][0], ...(note ? { note } : {}) });
        if (etat === 'entier') for (const [p, n] of e.morceaux) sauter.push([debut + p, debut + p + n]);
        await pause();
      }
    }
  }
  // 2. Tout le support, par signatures (ce qui n'a pas déjà été retrouvé avec son nom).
  sauter.sort((a, b) => a[0] - b[0]);
  const fusion: Array<[number, number]> = []; for (const z of sauter) { const d = fusion.at(-1); if (d && z[0] <= d[1]) d[1] = Math.max(d[1], z[1]); else fusion.push([...z]); }
  if (!o.arret.stop) {
    o.suivi.etape = 'Fouille de tout le support, secteur par secteur';
    for await (const f of fouiller(s, { ...(o.familles?.length ? { familles: o.familles } : {}), ...(o.plafond ? { plafond: o.plafond } : {}), sauter: fusion, arret: o.arret, surAvance: (p) => { o.suivi.fait = p; r.octetsLus = p; } })) {
      if (f.tropGros) { r.compte.tropGros++; lignes.push(`trop gros\t${f.taille}\tsignature\t${f.ext} à l'octet ${f.pos}`); continue; }
      if (plein(f.taille)) break;
      const etat: Etat = !f.entier ? 'abîmé' : f.fragile ? 'non vérifiable' : 'entier', base = `f${f.pos}${f.nom ? `-${sur(basename(f.nom))}` : ''}`;
      const nom = base.toLowerCase().endsWith(`.${f.ext}`) ? base : `${base}.${f.ext}`, cible = libre(join(racine, f.famille, ...(etat === 'abîmé' ? ['abîmés'] : [])), nom);
      await recopier(s, f.pos, f.taille, cible);
      noter({ chemin: cible.slice(racine.length + 1), famille: f.famille, taille: f.taille, etat, origine: 'signature', pos: f.pos, ...(f.note ? { note: f.note } : etat === 'non vérifiable' ? { note: 'format sans contrôle interne : la taille vient de son en-tête, le contenu n\'a pas pu être vérifié' } : {}) });
    }
  }
  r.arretee = o.arret.stop && !r.erreur; r.illisibles = s.illisibles; r.octetsLus = Math.max(r.octetsLus, o.suivi.fait);
  writeFileSync(libre(racine, `rapport-${o.id}.txt`), `Perséphone · récupération depuis ${s.chemin} (${o.quand})\nétat\ttaille\tretrouvé par\tfichier\tremarque\n${lignes.join('\n')}\n`);
  return r;
}
