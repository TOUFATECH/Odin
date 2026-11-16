// Genèse · clé USB : ce qui décrit le chargeur Ventoy officiel et construit son fichier de réglages (ventoy.json).
// Décision (contrat) : on installe le binaire OFFICIEL de Ventoy (vérifié, licence GPLv3), jamais modifié, et on le
// personnalise par ventoy.json ; on n'écrit AUCUN code C. Ventoy résout déjà, de façon éprouvée, le démarrage
// multi-ISO (il liste tout seul chaque fichier de la 1re partition), BIOS et UEFI, le démarrage de Windows, de
// Linux, des outils, des disques virtuels (VHD/VHDX Windows ; vDisk Linux préparé par odin-boot), le démarrage
// sécurisé (sa clé inscrite au 1er démarrage) et l'injection de fichiers de réponses et de scripts.
// Fonctions PURES : rien n'est téléchargé ni écrit ici ; le lot A télécharge Ventoy (après l'antivirus) et écrit
// ventoy.json sur la clé.
import { THEMES } from './ecran.ts';
import type { PreparationCle, Schema } from './cle-types.ts';
import { DISPOSITION_CLE, FICHIERS_ODIN } from './cle-types.ts';
import { entreesPersistance, entreesVdiskAuto } from './cle-install.ts';

/** La version de Ventoy qu'Odin installe, et où la prendre (dépôt officiel). Mise à jour en changeant ces valeurs. */
export const VENTOY_VERSION = '1.1.18';

/** Ce qu'Odin télécharge : la release Linux officielle de Ventoy, son empreinte SHA-256, sa signature et sa licence. */
export interface DescripteurVentoy {
  version: string;
  /** l'archive officielle (dépôt github ventoy/Ventoy), jamais un miroir */
  fichier: string;
  url: string;
  /** l'empreinte SHA-256 publiée (sha256.txt de la release), à vérifier après le téléchargement */
  sha256: string;
  /** le fichier d'empreintes publié, pour revérifier */
  sha256Url: string;
  /** la signature GPG publiée par l'auteur (clé publique sur le site de Ventoy) */
  gpg: string;
  licence: 'GPLv3';
}

/**
 * Le descripteur du Ventoy officiel qu'Odin installe. Le lot A télécharge `url`, vérifie que l'empreinte vaut
 * `sha256` (et, si possible, la signature `gpg`), passe l'archive par l'antivirus (Asclépios), puis l'installe
 * SANS la modifier. Pur.
 */
export function descripteurVentoy(version = VENTOY_VERSION): DescripteurVentoy {
  const base = `https://github.com/ventoy/Ventoy/releases/download/v${version}`;
  const fichier = `ventoy-${version}-linux.tar.gz`;
  // L'empreinte publiée par la release v1.1.18 (sha256.txt du dépôt officiel). À changer avec la version.
  const sha256 = version === '1.1.18' ? 'd86ff9de63d94c8b8f1f6b14d23c55af4b88e8207bf2893890892a6a97b1ad54' : '';
  return {
    version, fichier,
    url: `${base}/${fichier}`,
    sha256,
    sha256Url: `${base}/sha256.txt`,
    gpg: `${base}/sha256.txt.gpg`,
    licence: 'GPLv3',
  };
}

/**
 * Les arguments de l'installeur officiel de Ventoy (Ventoy2Disk.sh) pour cette préparation. Fixés à l'installation,
 * ignorés en mise à jour (on garde alors les fichiers de la 1re partition, comme « Ventoy -u »). Pur.
 *  -s : support du démarrage sécurisé (shim signé + clé de Ventoy)   -g : table GPT (défaut UEFI)
 *  -r : réserve d'espace (0 ici)   -L : étiquette de la 1re partition (toujours ODIN).
 * Le schéma MBR est le défaut de Ventoy pour un vieux BIOS (+ UEFI-CSM) ; on ne passe -g que pour GPT.
 */
export function installArgs(prep: { schema: Schema; secureBoot: boolean; label?: string }): string[] {
  const a: string[] = ['-i']; // -i : installer sur une clé neuve (le lot A met -u pour mettre à jour sans effacer)
  if (prep.schema === 'gpt') a.push('-g');
  if (prep.secureBoot) a.push('-s');
  a.push('-L', prep.label ?? 'ODIN');
  return a;
}

/** Les options de mise à jour non destructive (clé déjà « ODIN ») : on garde les fichiers, on ne touche qu'au chargeur. */
export function updateArgs(prep: { secureBoot: boolean }): string[] {
  const a = ['-u'];
  if (prep.secureBoot) a.push('-s');
  return a;
}

// ---------- ventoy.json ----------

const jsonEcran = (p: string) => p.replace(/\\/g, '/');
/** La couleur d'accent du thème graphique choisi, pour habiller le menu GRUB (le thème texte complet est dans cle-grub.ts). */
function accentDuTheme(theme: keyof typeof THEMES): string {
  const accents: Record<keyof typeof THEMES, string> = {
    bleu: '#ffffff', matrix: '#3dff7a', ocean: '#ffd166', lune: '#f4f1e8', ciel: '#0b2a4a',
    galaxie: '#c9a2ff', mayotte: '#ffd166', couchant: '#ffd36b', clair: '#2457c5',
  };
  return accents[theme];
}

/** La classe d'icône Ventoy (menu_class) d'un fichier, d'après son nom (Ventoy a ses icônes par système). Pur. */
export function classeIcone(fichier: string): string {
  const n = fichier.toLowerCase();
  if (/windows|win1[01]|win2\d|\.wim$/.test(n)) return 'windows';
  if (/ubuntu/.test(n)) return 'ubuntu';
  if (/debian/.test(n)) return 'debian';
  if (/fedora/.test(n)) return 'fedora';
  if (/mint/.test(n)) return 'linuxmint';
  if (/\b(rocky|alma|rhel|centos)\b/.test(n)) return 'redhat';
  if (/arch/.test(n)) return 'archlinux';
  if (/alpine/.test(n)) return 'alpine';
  if (/proxmox/.test(n)) return 'proxmox';
  if (/\.(vhd|vhdx|vtoy|raw|img|vdi|vmdk|qcow2)$/.test(n)) return 'vdisk';
  return 'linux';
}

/** Le chemin d'un système sur la clé (dans /ISO), avec des barres obliques (format attendu par Ventoy). */
const cheminIso = (fichier: string) => jsonEcran(`${DISPOSITION_CLE.iso}/${fichier}`);
const cheminVdisk = (fichier: string) => jsonEcran(`${DISPOSITION_CLE.vdisk}/${fichier}`);
const cheminOdin = (f: string) => jsonEcran(`${DISPOSITION_CLE.odin}/${f}`);

/**
 * Le ventoy.json complet pour une préparation. Pur : renvoie le texte JSON à écrire dans /ventoy/ventoy.json.
 *  - control : système par défaut (VTOY_DEFAULT_IMAGE) + délai du menu (VTOY_MENU_TIMEOUT) + le menu en liste
 *    (VTOY_DEFAULT_MENU_MODE 0) ; et, pour Windows, retrait des exigences de Microsoft façon Rufus
 *    (VTOY_WIN11_BYPASS_CHECK : TPM 2.0, démarrage sécurisé et mémoire ; VTOY_WIN11_BYPASS_NRO : pas de compte
 *    Microsoft obligatoire, pas de question de vie privée au tout premier écran).
 *  - theme : le thème GRUB aux couleurs du thème choisi (fichier construit par cle-grub.ts).
 *  - menu_alias : le nom lisible de chaque fichier dans le menu.
 *  - menu_class : l'icône de système de chaque fichier.
 *  - auto_install : pour chaque image, le fichier de réponses à injecter (autounattend Windows, user-data Ubuntu,
 *    preseed Debian, kickstart RHEL) — Ventoy l'injecte sans jamais modifier l'ISO officielle.
 *  - injection : pour chaque image, l'archive de scripts d'Odin posée dans le système au démarrage.
 *  - password : le mot de passe d'installation éventuel, demandé avant de lancer un système.
 *
 * Note honnête : le démarrage des disques virtuels (VHD/VHDX Windows ; vDisk Linux .vtoy/.img/.vhd/.raw) est géré
 * NATIVEMENT par Ventoy d'après le fichier posé dans /vdisk — pas par un greffon de ce fichier. Le vDisk Linux doit
 * d'abord être préparé par odin-boot (voir cle-grub.ts / le script généré). On ne fabrique donc aucune fausse clé
 * JSON « vhdboot »/« vtoy » : on range ces fichiers, on leur donne leur nom et leur icône, et Ventoy les démarre.
 */
export function buildVentoyJson(prep: PreparationCle): string {
  const control: Array<Record<string, string>> = [];
  if (prep.defaut) control.push({ VTOY_DEFAULT_IMAGE: prep.defaut.startsWith('/') ? jsonEcran(prep.defaut) : cheminIso(prep.defaut) });
  control.push({ VTOY_MENU_TIMEOUT: String(Math.max(0, Math.round(prep.delai))) });
  control.push({ VTOY_DEFAULT_MENU_MODE: '0' });
  const aUnWindows = prep.systemes.some((s) => s.famille === 'Windows' || /windows|win1[01]/i.test(s.fichier));
  if (aUnWindows) { control.push({ VTOY_WIN11_BYPASS_CHECK: '1' }, { VTOY_WIN11_BYPASS_NRO: '1' }); }

  const theme = {
    file: jsonEcran(`${DISPOSITION_CLE.ventoyTheme}/theme.txt`),
    gfxmode: '1920x1080,1280x1024,auto',
    display_mode: 'GUI',
    // La couleur d'accent sert aussi au menu (le reste des couleurs est dans theme.txt).
    ventoy_color: accentDuTheme(prep.theme).replace('#', ''),
  };

  const menu_alias = prep.systemes.map((s) => ({ image: cheminIso(s.fichier), alias: s.nom }))
    .concat(prep.vdisks.map((v) => ({ image: cheminVdisk(v.fichier), alias: v.fichier.replace(/\.[^.]+$/, '') })));

  const menu_class = prep.systemes.map((s) => ({ key: s.fichier, class: classeIcone(s.fichier) }))
    .concat(prep.vdisks.map((v) => ({ key: v.fichier, class: classeIcone(v.fichier) })));

  // Le fichier de réponses à injecter par système, selon sa famille (recipe.kind décide du bon fichier).
  const gabarit = (s: PreparationCle['systemes'][number]): string | null => {
    const k = s.recipe.kind;
    if (k === 'windows') return cheminOdin(FICHIERS_ODIN.autounattend);
    if (k === 'ubuntu' || k === 'casper') return cheminOdin(FICHIERS_ODIN.userData);
    if (k === 'debian') return cheminOdin(FICHIERS_ODIN.preseed);
    if (k === 'rhel' || k === 'fedora-live') return cheminOdin(FICHIERS_ODIN.kickstart);
    return null;
  };
  const auto_install = prep.systemes
    .filter((s) => s.mode === 'installer' && gabarit(s))
    .map((s) => ({ image: cheminIso(s.fichier), template: gabarit(s)! }));

  // L'archive de scripts d'Odin injectée dans chaque système installé (logiciels, fin d'installation, odin-boot).
  const injection = prep.systemes
    .filter((s) => s.mode === 'installer')
    .map((s) => ({ image: cheminIso(s.fichier), archive: cheminOdin(`inject-${s.fichier.replace(/\.[^.]+$/, '')}.tar.gz`) }));

  // Lot A : les systèmes installés / copiés (Windows To Go, VM) posés dans /vdisk reçoivent leur icône au menu, et
  // les systèmes « persistance » émettent le tableau `persistence` de Ventoy (fichier de persistance à côté de l'ISO).
  const autoClasse = entreesVdiskAuto(prep.systemes);
  const persistence = entreesPersistance(prep.systemes);

  const doc: Record<string, unknown> = { control, theme, menu_alias, menu_class: autoClasse.length ? menu_class.concat(autoClasse) : menu_class };
  if (persistence.length) doc.persistence = persistence;
  if (auto_install.length) doc.auto_install = auto_install;
  if (injection.length) doc.injection = injection;
  if (prep.motDePasse) {
    // Le mot de passe d'installation : demandé avant de lancer un système (greffon password de Ventoy, par empreinte).
    doc.password = { bootpwd: `SHA256:${prep.motDePasse.hash}` };
  }
  return JSON.stringify(doc, null, 2) + '\n';
}
