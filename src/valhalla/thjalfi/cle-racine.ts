// Genèse · clé USB — « TOUT CE QUI EST POSÉ À LA RACINE est reconnu tout seul au démarrage ». La personne peut
// simplement DÉPOSER des fichiers sur la partition ODIN (par Odin, ou en glissant des fichiers comme sur une clé
// normale), SANS passer par la page de configuration ; au démarrage, la clé les RANGE toute seule au menu, chacun
// avec son genre deviné d'après son extension et son contenu.
//
// C'est le fonctionnement de Ventoy (il liste tout seul les ISO et disques virtuels de la 1re partition) ÉTENDU
// aux disques de VM et aux images disque. Un indexeur classe chaque fichier :
//   - ISO                         → entrée « démarrer / installer » ;
//   - disque de VM / image disque → entrée « démarrer la VM » (préparée par odin-boot si besoin, ou « à préparer »
//     si elle ne peut pas démarrer telle quelle) ;
//   - fichier non reconnu         → listé à part « fichier non démarrable », JAMAIS exécuté.
//
// Tout est PUR ici : on classe des noms (et, quand on les a, les premiers octets). Le script odin-scan est une
// chaîne posée sur la clé, lancée au démarrage ; il n'est pas exécuté ici.

import { analyserVdisk } from './vdisk.ts';
import { classeIcone } from './cle-boot.ts';
import { DISPOSITION_CLE, FICHIERS_ODIN } from './cle-types.ts';

/** Le genre deviné d'un fichier déposé à la racine. */
export type GenreRacine = 'iso' | 'vm' | 'non-demarrable';
/** L'état de démarrage d'une entrée : démarre telle quelle, à préparer d'abord, ou non démarrable. */
export type EtatRacine = 'demarre' | 'a-preparer' | 'non-demarrable';

export interface EntreeRacine {
  fichier: string;
  /** le nom lisible au menu (sans l'extension) */
  nom: string;
  genre: GenreRacine;
  etat: EtatRacine;
  /** la classe d'icône Ventoy (pour l'icône au menu) */
  classe: string;
  /** ce qu'Odin dit de cette entrée (ce qui marche, ce qu'il faut faire) */
  message: string;
}

/** Les extensions des disques de VM et des images disque (étendues par l'indexeur, au-delà des ISO de Ventoy). */
const EXT_VM = new Set(['img', 'raw', 'vhd', 'vhdx', 'vtoy', 'vmdk', 'qcow2', 'qcow', 'vdi']);

const extDe = (nom: string): string => (/\.([a-z0-9]+)$/i.exec(nom.toLowerCase())?.[1]) ?? '';
const nomLisible = (nom: string): string => nom.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');

/**
 * Classe chaque fichier déposé à la racine et rend son entrée de menu. Pur.
 * @param fichiers les noms des fichiers trouvés à la racine de la partition ODIN
 * @param entetes facultatif : les premiers octets de certains fichiers (pour confirmer le format d'un disque de VM)
 */
export function classerRacine(fichiers: string[], entetes: Record<string, Buffer> = {}): EntreeRacine[] {
  const out: EntreeRacine[] = [];
  for (const f of fichiers) {
    const ext = extDe(f), nom = nomLisible(f);
    if (ext === 'iso') {
      out.push({ fichier: f, nom, genre: 'iso', etat: 'demarre', classe: classeIcone(f), message: 'ISO : entrée « démarrer / installer » (Ventoy la démarre telle quelle).' });
      continue;
    }
    if (EXT_VM.has(ext)) {
      const a = analyserVdisk(f, entetes[f]);
      if (a.famille === 'macos') {
        out.push({ fichier: f, nom, genre: 'non-demarrable', etat: 'non-demarrable', classe: 'vdisk', message: a.message });
        continue;
      }
      if (a.demarreTelQuel) {
        out.push({ fichier: f, nom, genre: 'vm', etat: 'demarre', classe: classeIcone(f), message: a.message });
      } else {
        // Disque de VM qui ne démarre pas tel quel : à préparer (odin-boot) ou à convertir (qemu-img) d'abord.
        out.push({ fichier: f, nom, genre: 'vm', etat: 'a-preparer', classe: classeIcone(f), message: `À préparer avant de démarrer. ${a.message}` });
      }
      continue;
    }
    // Rien de reconnu : listé à part, jamais exécuté.
    out.push({ fichier: f, nom, genre: 'non-demarrable', etat: 'non-demarrable', classe: 'unknown', message: 'Fichier non démarrable : Odin le liste à part et ne l\'exécute jamais.' });
  }
  return out;
}

/** Les entrées effectivement proposables au menu (ISO + disques de VM démarrables ou préparables). Pur. */
export function entreesDemarrables(entrees: EntreeRacine[]): EntreeRacine[] {
  return entrees.filter((e) => e.genre !== 'non-demarrable');
}

/**
 * Le script « odin-scan » posé sur la clé (dans /odin), lancé AU DÉMARRAGE : il relit la racine de la partition
 * ODIN et régénère les entrées de menu d'après ce qui est présent, en étendant Ventoy aux disques de VM et aux
 * images disque. Un fichier non reconnu est listé à part, jamais exécuté. Pur : rend la chaîne du script.
 */
export function buildScriptScan(): string {
  const exts = [...EXT_VM].map((e) => `*.${e}`).join(' ');
  return `#!/bin/sh
# Généré par Odin (odin-scan) — range au menu tout fichier posé à la racine de la clé ODIN.
# Ventoy liste déjà seul les ISO et disques virtuels ; ce script ÉTEND l'indexation aux disques de VM et images,
# et liste à part (sans jamais l'exécuter) un fichier non démarrable.
set -e
racine="\${1:-/mnt/ODIN}"
sortie="\${2:-$racine${DISPOSITION_CLE.vdisk}}"
mkdir -p "$sortie"
echo "odin-scan : lecture de la racine $racine..."
# Les disques de VM / images (au-delà des ISO déjà gérées par Ventoy) : .img .raw .vhd .vhdx .vmdk .qcow2 .vdi
for motif in ${exts}; do
  for f in "$racine"/$motif; do
    [ -e "$f" ] || continue
    nom=$(basename "$f")
    case "$nom" in
      *.vhd|*.vhdx|*.img|*.raw) echo "  démarrable : $nom (posé au menu)";;
      *.vmdk|*.qcow2|*.qcow|*.vdi) echo "  à préparer : $nom (conversion / odin-boot avant démarrage)";;
      *) echo "  non démarrable : $nom (listé à part, jamais exécuté)";;
    esac
  done
done
echo "odin-scan : terminé. Le menu reflète ce qui est présent à la racine."
# Le fichier de réponses et le menu (${FICHIERS_ODIN.odinScan}) sont régénérés par Odin au prochain démarrage.
`;
}
