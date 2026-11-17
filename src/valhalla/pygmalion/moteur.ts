// Pygmalion — le moteur : produire à son tour, sous les limites. Pour chaque demande : les limites d'abord (anti-trucage,
// œuvres protégées, tailles), puis la fabrication par un générateur écrit dans Odin (temps MESURÉ), l'écriture dans le
// dossier de sortie sûr (jamais ailleurs, jamais en écrasant), et le registre (chiffré) qui dit quoi, à partir de quoi,
// par quel moyen, quand, où — et que c'est une création d'Odin.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fabriquer } from './documents.ts';
import { creerTarGz, creerZip, extraire, ouvrirArchive } from './archives.ts';
import { refus, refusContenu, texteMarque, PALIERS } from './limites.ts';
import { MODELES } from './modeles.ts';
import { Registre } from './magasin.ts';
import { ecrireSur, nomSur } from './sortie.ts';
import { BORNES, type Creation, type DemandeDocument, type FichierArchive, type Format, type Palier, type Source } from './types.ts';

/** Le titre et le début du contenu d'un document (texte, diapositives, feuilles) : ce qui dit ce qu'il prétend être. */
export function enteteDe(d: DemandeDocument): string {
  const morceaux: string[] = [String(d.titre ?? ''), String(d.texte ?? '').slice(0, 400)];
  for (const s of (d.diapositives ?? []).slice(0, 5)) morceaux.push(String(s?.titre ?? '').slice(0, 200));
  for (const f of (d.feuilles ?? []).slice(0, 10)) {
    morceaux.push(String(f?.nom ?? '').slice(0, 100));
    for (const l of (f?.lignes ?? []).slice(0, 2)) for (const c of (l ?? []).slice(0, 10)) if (typeof c === 'string') morceaux.push(c.slice(0, 100));
  }
  return morceaux.join('\n');
}

export interface OptionsPygmalion {
  /** dossier d'Odin (clé de la machine) */
  home: string;
  /** dossier de données de l'appli (registre) */
  dir: string;
  /** dossier de sortie : là où les créations sont rangées (chemin complet) */
  sortie: string;
  maintenant?: () => number;
}

export class Pygmalion {
  readonly registre: Registre;
  private readonly o: OptionsPygmalion;
  private readonly now: () => number;
  constructor(o: OptionsPygmalion) { this.o = o; this.now = o.maintenant ?? Date.now; this.registre = new Registre(o.home, o.dir); }

  paliers(): Palier[] { return PALIERS.map((p) => ({ ...p })); }

  private ranger(format: Format, titre: string, octets: Buffer, moyen: string, marque: Creation['marque'], sources: Source[], dureeMs: number, o: { nom?: string; remplacer?: boolean }): Creation {
    if (octets.length > BORNES.fichier) throw new Error(`fichier trop gros (${octets.length} octets > ${BORNES.fichier})`);
    const ext = format === 'tar.gz' ? 'tar.gz' : format;
    const nom = nomSur(o.nom || titre || 'creation', ext);
    // remplacer : seulement une création d'Odin dont le contenu n'a pas changé depuis (empreinte comparée au registre)
    const empreinteDe = (chemin: string) => { try { return createHash('sha256').update(readFileSync(chemin)).digest('hex'); } catch { return ''; } };
    // la taille d'abord : un fichier d'une autre taille n'est pas relu en entier (seconde relecture, constat 9)
    const tailleDe = (chemin: string) => { try { return statSync(chemin).size; } catch { return -1; } };
    const e = ecrireSur(this.o.sortie, nom, octets, { remplacer: o.remplacer, estCreation: (r, chemin) => this.registre.estCreation(r, () => empreinteDe(chemin), tailleDe(chemin)) });
    const c: Creation = {
      id: randomBytes(8).toString('hex'), format, titre: titre.slice(0, 300), sources: sources.slice(0, 50), moyen,
      quand: new Date(this.now()).toISOString(), chemin: e.relatif, octets: octets.length,
      empreinte: createHash('sha256').update(octets).digest('hex'), marquee: true, marque, dureeMs: Math.round(dureeMs * 10) / 10,
    };
    this.registre.ajouter(c);
    return c;
  }

  /** Produit un document. `demandeTexte` : la demande telle que dite (passée aux limites). */
  produire(d: DemandeDocument, o: { nom?: string; remplacer?: boolean; demandeTexte?: string } = {}): Creation {
    // la demande (et le titre) ; sans la demande dite, le titre seul (une langue incertaine n'y est vérifiée qu'à partir
    // de 4 mots) ; puis le DÉBUT DU CONTENU, pour les faux documents : un faux bulletin titré « Document » ne passe pas
    const r = refus(`${o.demandeTexte ?? ''} ${d.titre ?? ''}`, { titre: !o.demandeTexte?.trim() }) ?? refusContenu(enteteDe(d));
    if (r) throw new Error(r);
    const t0 = performance.now();
    const f = fabriquer(d, texteMarque(new Date(this.now())));
    const duree = performance.now() - t0;
    if (duree > BORNES.dureeMs) throw new Error(`fabrication trop longue (${Math.round(duree)} ms) : rien n'est rangé`);
    const sources: Source[] = d.sources?.length ? d.sources : [{ genre: 'demande', detail: 'ta demande' }];
    return this.ranger(d.format, d.titre, f.octets, f.moyen, f.marque, sources, duree, o);
  }

  /** Produit un document à partir d'un modèle réutilisable. */
  depuisModele(id: string, valeurs: Record<string, string>, format: DemandeDocument['format'], o: { nom?: string } = {}): Creation {
    const m = MODELES.find((x) => x.id === id); if (!m) throw new Error(`modèle inconnu : ${id}`);
    if (!m.formats.includes(format)) throw new Error(`le modèle « ${m.nom} » ne se fait pas en ${format}`);
    return this.produire(m.fabriquer(valeurs, format), o);
  }

  /** Archive des fichiers (.zip ou .tar.gz). La marque est au registre (une archive n'a pas de place pour elle). */
  archiver(fichiers: FichierArchive[], genre: 'zip' | 'tar.gz', titre: string, o: { nom?: string } = {}): Creation {
    const t0 = performance.now();
    const octets = genre === 'zip' ? creerZip(fichiers) : creerTarGz(fichiers, this.now());
    return this.ranger(genre, titre, octets, genre === 'zip' ? 'archiveur zip d\'Odin (node:zlib)' : 'archiveur tar.gz d\'Odin (node:zlib)', 'au registre', [{ genre: 'fichier', detail: `${fichiers.length} fichier(s)` }], performance.now() - t0, o);
  }

  /** Ouvre une archive (vérifiée) dans un dossier NEUF sous le dossier de sortie. Rend les noms extraits. */
  ouvrir(octets: Buffer, genre: 'zip' | 'tar.gz', nomDossier: string): { dossier: string; fichiers: string[] } {
    const dossier = join(this.o.sortie, nomSur(nomDossier, 'contenu').replace(/\.contenu$/, ''));
    return { dossier, fichiers: extraire(octets, genre, dossier) };
  }

  /** Relit les fichiers d'une archive sans rien écrire (vérifiée). */
  lireArchive(octets: Buffer, genre: 'zip' | 'tar.gz'): FichierArchive[] { return ouvrirArchive(octets, genre); }

  /** Les octets d'une création rangée (pour la relire). */
  octetsDe(c: Creation): Buffer { return readFileSync(join(this.o.sortie, c.chemin)); }
}
