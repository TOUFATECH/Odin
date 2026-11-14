// Perséphone · le support qu'on fouille (disque, partition, clé USB, carte SD ou fichier image).
// Il est TOUJOURS ouvert en lecture seule : aucune fonction d'ici n'écrit dessus. Un secteur illisible (disque
// abîmé) est rendu à zéro et compté, la lecture continue. On sait aussi dire sur quel disque physique se trouve un
// dossier, pour refuser de ranger les fichiers retrouvés sur le support qu'on est en train de fouiller.
import { constants, existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { propre } from './octets.ts';

/** Ce que tout le reste lit : des octets à une position, jamais d'écriture. */
export interface Lecteur {
  /** taille en octets */
  taille: number;
  /** taille d'un secteur (512 le plus souvent, 4096 sur certains disques) */
  secteur: number;
  /** lit `n` octets à `pos` (moins à la fin du support). Une zone illisible revient remplie de zéros. */
  lire(pos: number, n: number): Promise<Buffer>;
  /** octets que le support a refusé de rendre (secteurs abîmés) */
  illisibles: number;
}
export interface Support extends Lecteur { chemin: string; bloc: boolean; fermer(): Promise<void> }

/** Numéro « majeur:mineur » d'un périphérique, d'après le nombre que rend `stat` (codage de Linux). */
export function majMin(dev: bigint | number): string {
  const d = BigInt(dev);
  return `${Number(((d >> 32n) & 0xfffff000n) | ((d >> 8n) & 0xfffn))}:${Number(((d >> 12n) & 0xffffff00n) | (d & 0xffn))}`;
}
const lireTexte = (f: string): string => { try { return readFileSync(f, 'utf8').trim(); } catch { return ''; } };

/** Pourquoi un support ne s'ouvre pas, dit simplement, avec quoi faire. */
export function expliquer(e: unknown, chemin: string): string {
  const code = (e as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') return `je ne trouve pas « ${chemin} » : vérifie que le support est branché (ou le chemin du fichier image)`;
  if (code === 'EACCES' || code === 'EPERM') return `Odin n'a pas le droit de lire « ${chemin} ». Donne-lui ce droit en lecture seule, dans un terminal : sudo setfacl -m u:$(whoami):r ${chemin} — ou fais-en une image avec « sudo dd if=${chemin} of=/un/autre/disque/image.img » et donne-moi l'image`;
  if (code === 'ENOMEDIUM') return `il n'y a pas de carte ou de disque dans « ${chemin} »`;
  if (code === 'EBUSY') return `« ${chemin} » est occupé par un autre programme`;
  return `« ${chemin} » ne s'ouvre pas (${(e as Error)?.message ?? 'raison inconnue'})`;
}

/**
 * Ouvre un support en lecture seule. `sys` : la racine de /sys (changée dans les essais).
 * Lève une erreur claire si ce n'est ni un disque ni un fichier, ou s'il est vide.
 */
export async function ouvrir(chemin: string, sys = '/sys'): Promise<Support> {
  let fh: FileHandle;
  try { fh = await open(chemin, constants.O_RDONLY); } catch (e) { throw new Error(expliquer(e, chemin)); }
  try {
    const st = await fh.stat({ bigint: true });
    let taille = 0, secteur = 512; const bloc = st.isBlockDevice();
    if (bloc) {
      const d = join(sys, 'dev', 'block', majMin(st.rdev));
      taille = Number(lireTexte(join(d, 'size')) || 0) * 512;
      // La taille d'un secteur est celle du disque entier (une partition n'a pas son propre réglage).
      const q = [join(d, 'queue', 'logical_block_size'), join(d, '..', 'queue', 'logical_block_size')].map(lireTexte).find(Boolean);
      if (q && [512, 1024, 2048, 4096].includes(Number(q))) secteur = Number(q);
    } else if (st.isFile()) taille = Number(st.size);
    else throw new Error(`« ${chemin} » n'est ni un disque, ni une partition, ni un fichier image`);
    if (!(taille > 0)) throw new Error(`« ${chemin} » est vide (taille nulle) : rien à lire dessus`);
    const s: Support = {
      chemin, bloc, taille, secteur, illisibles: 0,
      async lire(pos, n) {
        n = Math.max(0, Math.min(n, taille - pos)); const b = Buffer.allocUnsafe(n); let lu = 0;
        try { while (lu < n) { const r = await fh.read(b, lu, n - lu, pos + lu); if (r.bytesRead <= 0) break; lu += r.bytesRead; } }
        catch {
          // Zone abîmée : on reprend par petits morceaux ; ce qui ne se lit vraiment pas revient à zéro.
          for (let o = lu; o < n; o += 4096) {
            const k = Math.min(4096, n - o);
            try { let m = 0; while (m < k) { const r = await fh.read(b, o + m, k - m, pos + o + m); if (r.bytesRead <= 0) throw new Error('fin'); m += r.bytesRead; } }
            catch { b.fill(0, o, o + k); s.illisibles += k; }
          }
          lu = n;
        }
        if (lu < n) b.fill(0, lu);
        return b;
      },
      fermer: () => fh.close(),
    };
    return s;
  } catch (e) { await fh.close().catch(() => undefined); throw e; }
}
/** Une partie d'un support, vue comme un support à part (une partition dans un disque). */
export function tranche(l: Lecteur, debut: number, taille: number): Lecteur {
  const t = Math.max(0, Math.min(taille, l.taille - debut));
  return { taille: t, secteur: l.secteur, get illisibles() { return l.illisibles; }, set illisibles(_v: number) { /* compté par le support entier */ }, lire: (pos, n) => l.lire(debut + pos, Math.max(0, Math.min(n, t - pos))) };
}
/** Un fichier fait de plusieurs morceaux du support ([position, longueur]), vu comme un tout. */
export function parMorceaux(l: Lecteur, morceaux: Array<[number, number]>): Lecteur {
  const debuts: number[] = []; let total = 0; for (const [, n] of morceaux) { debuts.push(total); total += n; }
  return {
    taille: total, secteur: l.secteur, illisibles: 0,
    async lire(pos, n) {
      n = Math.max(0, Math.min(n, total - pos)); if (n === 0) return Buffer.alloc(0);
      let i = 0; while (i < morceaux.length - 1 && debuts[i + 1] <= pos) i++;
      if (pos + n <= debuts[i] + morceaux[i][1]) return l.lire(morceaux[i][0] + pos - debuts[i], n);
      const out = Buffer.alloc(n);
      for (let fait = 0; fait < n && i < morceaux.length; i++) { const d = pos + fait - debuts[i], k = Math.min(n - fait, morceaux[i][1] - d); (await l.lire(morceaux[i][0] + d, k)).copy(out, fait); fait += k; }
      return out;
    },
  };
}
/** Un support fait d'un tampon en mémoire (essais, petits morceaux déjà lus). */
export function enMemoire(b: Buffer, secteur = 512): Lecteur {
  return { taille: b.length, secteur, illisibles: 0, lire: async (pos, n) => Buffer.from(b.subarray(pos, Math.min(b.length, pos + Math.max(0, n)))) };
}

// ---------------------------------------------------------------- les supports de la machine (lsblk)
export interface Peripherique {
  chemin: string; nom: string; taille: number; genre: 'disque' | 'partition';
  /** le disque qui porte cette partition */
  parent?: string;
  modele?: string; serie?: string; transport?: string; amovible: boolean; lectureSeule: boolean;
  fs?: string; etiquette?: string; table?: string;
  /** où il est monté (vide : pas monté) */
  montes: string[];
}
/** « lsblk -J -b -o NAME,PATH,SIZE,TYPE,MOUNTPOINTS,FSTYPE,MODEL,SERIAL,TRAN,RM,RO,LABEL,PTTYPE » → disques et partitions. Pur. */
export function lireLsblk(json: string): Peripherique[] {
  type B = { name?: string; path?: string | null; size?: number | string | null; type?: string; mountpoint?: string | null; mountpoints?: Array<string | null> | null; fstype?: string | null; model?: string | null; serial?: string | null; tran?: string | null; rm?: boolean | string | number; ro?: boolean | string | number; label?: string | null; pttype?: string | null; children?: B[] };
  let o: { blockdevices?: B[] }; try { o = JSON.parse(json) as { blockdevices?: B[] }; } catch { return []; }
  const vrai = (x: unknown) => x === true || x === '1' || x === 1, out: Peripherique[] = [];
  const un = (b: B, parent?: Peripherique): void => {
    const nom = String(b.name ?? ''), taille = Number(b.size) || 0, disque = b.type === 'disk' || b.type === 'loop';
    if (!nom || /^(zram|ram|sr|fd)\d/.test(nom) || b.type === 'rom') return;
    const montes = [...(b.mountpoints ?? []), b.mountpoint].filter((m): m is string => typeof m === 'string' && m.length > 0);
    const p: Peripherique = {
      chemin: String(b.path ?? `/dev/${nom}`), nom, taille, genre: !parent && disque ? 'disque' : 'partition', ...(parent ? { parent: parent.chemin } : {}),
      ...(b.model ? { modele: propre(b.model, 60) } : parent?.modele ? { modele: parent.modele } : {}), ...(b.serial ? { serie: propre(b.serial, 60) } : parent?.serie ? { serie: parent.serie } : {}),
      ...(b.tran ? { transport: propre(b.tran, 20) } : parent?.transport ? { transport: parent.transport } : {}),
      amovible: vrai(b.rm) || b.tran === 'usb' || b.tran === 'mmc' || Boolean(parent?.amovible), lectureSeule: vrai(b.ro),
      ...(b.fstype ? { fs: propre(b.fstype, 20) } : {}), ...(b.label ? { etiquette: propre(b.label, 40) } : {}), ...(b.pttype ? { table: propre(b.pttype, 10) } : {}), montes: [...new Set(montes)],
    };
    // Un périphérique de taille nulle (lecteur de cartes vide, boucle libre) n'a rien à fouiller.
    if (taille > 0 && (parent || disque)) out.push(p);
    for (const c of b.children ?? []) un(c, parent ?? p);
  };
  for (const b of o.blockdevices ?? []) un(b);
  return out;
}
/** Le disque entier qui porte ce périphérique (lui-même si c'en est un). Pur. */
export const disqueDe = (p: Peripherique, tous: Peripherique[]): Peripherique => tous.find((x) => x.chemin === p.parent) ?? p;
/** Tout ce qui est monté sur ce disque (lui ou ses partitions). Pur. */
export const montesSur = (d: Peripherique, tous: Peripherique[]): string[] => [...new Set(tous.filter((x) => x.chemin === d.chemin || x.parent === d.chemin).flatMap((x) => x.montes))];
/** Ce support porte-t-il le système en marche ? Pur. */
export const estSysteme = (d: Peripherique, tous: Peripherique[]): boolean => montesSur(disqueDe(d, tous), tous).some((m) => m === '/' || /^\/(boot|usr|var|home|etc)(\/|$)/.test(m) || m === '[SWAP]');

// ---------------------------------------------------------------- sur quel disque physique est… ?
/** Les disques physiques derrière un périphérique « majeur:mineur », et les fichiers image qui le portent (boucles). */
export interface Assise { disques: Set<string>; images: Set<string>; /** on n'a pas su remonter jusqu'à un disque */ inconnu: boolean }
function assiseDe(mm: string, sys: string, vu: Set<string>, a: Assise, niveau = 0, sousBoucle = true): void {
  if (vu.has(mm) || niveau > 8) return; vu.add(mm);
  let d: string; try { d = realpathSync(join(sys, 'dev', 'block', mm)); } catch { a.inconnu = true; return; }
  const nom = basename(d);
  // Une partition : son disque est le dossier au-dessus.
  if (existsSync(join(d, 'partition'))) { const parent = lireTexte(join(dirname(d), 'dev')); if (parent) assiseDe(parent, sys, vu, a, niveau + 1, sousBoucle); else a.disques.add(basename(dirname(d))); return; }
  // Un volume assemblé (LVM, chiffré, RAID) : ses disques sont ceux de ses morceaux.
  let morceaux: string[] = []; try { morceaux = readdirSync(join(d, 'slaves')); } catch { /* aucun */ }
  if (morceaux.length) { for (const m of morceaux) { const x = lireTexte(join(d, 'slaves', m, 'dev')); if (x) assiseDe(x, sys, vu, a, niveau + 1, sousBoucle); else a.inconnu = true; } return; }
  a.disques.add(nom);
  // Une boucle repose sur un fichier image. Pour un dossier où l'on veut écrire, le disque de ce fichier compte
  // aussi (écrire dans la boucle, c'est écrire sur ce disque) ; pour le support qu'on lit, seule la boucle compte.
  const image = lireTexte(join(d, 'loop', 'backing_file'));
  if (image) {
    a.images.add(identite(image) ?? image);
    if (sousBoucle) { try { const st = statSync(image, { bigint: true }); if (majeur(st.dev) === 0) a.inconnu = true; else assiseDe(majMin(st.dev), sys, vu, a, niveau + 1, true); } catch { a.inconnu = true; } }
  }
}
const majeur = (dev: bigint) => Number(majMin(dev).split(':')[0]);
/** Ce qui désigne un fichier sans se tromper (périphérique et numéro), pour comparer deux chemins vers le même fichier. */
export function identite(chemin: string): string | undefined { try { const st = statSync(chemin, { bigint: true }); return `${st.dev}:${st.ino}`; } catch { return undefined; } }

/** Sur quoi repose le support qu'on lit (son « majeur:mineur ») : ses disques, et son fichier image si c'est une boucle. */
export function assiseDuPeripherique(mm: string, sys = '/sys'): Assise { const a: Assise = { disques: new Set(), images: new Set(), inconnu: false }; assiseDe(mm, sys, new Set(), a, 0, false); return a; }
/**
 * Sur quoi repose un dossier : le disque du système de fichiers où il se trouve.
 * `source` : ce que dit « findmnt » pour ce dossier quand le système de fichiers n'a pas de vrai numéro de
 * périphérique (Btrfs, partage réseau, mémoire) ; un partage réseau ou la mémoire ne sont sur aucun disque d'ici.
 */
export function assiseDuDossier(dossier: string, sys = '/sys', source?: string): Assise & { reseau?: boolean } {
  const a: Assise & { reseau?: boolean } = { disques: new Set(), images: new Set(), inconnu: false };
  let st; try { st = statSync(dossier, { bigint: true }); } catch { a.inconnu = true; return a; }
  if (majeur(st.dev) !== 0) { assiseDe(majMin(st.dev), sys, new Set(), a); return a; }
  const src = (source ?? '').replace(/\[.*\]$/, '').trim();
  if (/^\/dev\//.test(src)) { try { const d = statSync(src, { bigint: true }); if (d.isBlockDevice()) { assiseDe(majMin(d.rdev), sys, new Set(), a); return a; } } catch { /* plus là */ } }
  // « serveur:/dossier » (NFS) ou « //serveur/partage » (Windows) : un autre appareil. « tmpfs » : la mémoire.
  if (/^[^/\s][^\s]*:\/|^\/\/[^/]/.test(src) || /^(tmpfs|ramfs|devtmpfs)$/.test(src)) { a.reseau = true; return a; }
  a.inconnu = true; return a;
}

export interface Verdict { ok: boolean; raison?: string }
/**
 * Peut-on ranger des fichiers dans `dossier` pendant qu'on fouille `source` ? Jamais sur le même disque physique
 * (même une autre partition), jamais dans l'image elle-même, jamais dans un dossier monté à partir d'elle.
 * `sousDossier` : là où on va vraiment écrire, sous `dossier`.
 */
export function peutRanger(source: { chemin: string; bloc: boolean }, dossier: string, o: { sys?: string; findmnt?: string; sousDossier?: string } = {}): Verdict {
  const sys = o.sys ?? '/sys', cible = resolve(dossier), ecrit = resolve(cible, o.sousDossier ?? '.');
  let st; try { st = statSync(cible); } catch { return { ok: false, raison: `le dossier « ${cible} » n'existe pas : crée-le d'abord, sur un autre disque que le support` }; }
  if (!st.isDirectory()) return { ok: false, raison: `« ${cible} » n'est pas un dossier${identite(cible) === identite(source.chemin) ? ' : c\'est le support lui-même' : ''}. Choisis un dossier, sur un autre disque` };
  const dest = assiseDuDossier(cible, sys, o.findmnt);
  if (source.bloc) {
    let rdev; try { rdev = statSync(source.chemin, { bigint: true }).rdev; } catch { return { ok: false, raison: `je ne retrouve plus le support ${source.chemin}` }; }
    const src = assiseDuPeripherique(majMin(rdev), sys);
    if (dest.reseau) return { ok: true };
    if (dest.inconnu || src.inconnu) return { ok: false, raison: `je n'arrive pas à savoir sur quel disque se trouve « ${cible} ». Dans le doute je refuse : choisis un dossier sur un disque que je reconnais (un autre disque interne, un disque USB)` };
    const meme = [...dest.disques].filter((d) => src.disques.has(d));
    if (meme.length) return { ok: false, raison: `« ${cible} » est sur le même disque que le support (${meme.join(', ')}). Écrire dessus pourrait effacer pour de bon ce qu'on cherche à retrouver : choisis un dossier sur un AUTRE disque` };
    return { ok: true };
  }
  // Source « fichier image » : on n'écrit ni dans l'image, ni par-dessus, ni dans un dossier monté depuis elle.
  const image = identite(source.chemin), vraie = (() => { try { return realpathSync(source.chemin); } catch { return resolve(source.chemin); } })();
  const racine = (() => { try { return realpathSync(ecrit); } catch { try { return resolve(realpathSync(cible), o.sousDossier ?? '.'); } catch { return ecrit; } } })();
  if (vraie === racine || vraie.startsWith(racine.endsWith(sep) ? racine : racine + sep)) return { ok: false, raison: `l'image « ${vraie} » est rangée dans le dossier où j'écrirais (${racine}) : choisis un autre dossier, ou déplace l'image` };
  if (image && dest.images.has(image)) return { ok: false, raison: `« ${cible} » est un dossier monté à partir de l'image elle-même : y écrire modifierait l'image. Choisis un dossier ailleurs` };
  return { ok: true };
}
