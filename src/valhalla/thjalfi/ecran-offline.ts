// Genèse · clé USB : la copie HORS LIGNE de l'écran graphique d'Odin (le dossier /ecran-odin de la clé). Au
// démarrage en mode graphique, la clé lance un petit système Alpine en kiosque (comme le mode graphique du réseau,
// ecran-pc.ts) qui ouvre la page /ecran d'Odin — mais SANS serveur Odin : la page lit un systemes.json FIGÉ au
// moment où la clé a été préparée, et quand on choisit un système, la clé règle le défaut de Ventoy puis redémarre
// pour le lancer. On RÉUTILISE ecran-page.ts (la page) et ecran-pc.ts (tar.gz, paquets, kiosque) sans les recopier.
// Fonction PURE (sauf le tar, déjà pur dans ecran-pc.ts) : rien n'est écrit sur un disque ; le lot A pose ces
// fichiers sur la 1re partition de la clé.
import { ecranPage } from './ecran-page.ts';
import { KIOSK_PACKAGES, tarGz } from './ecran-pc.ts';
import { DISPOSITION_CLE } from './cle-types.ts';
import { brand, themeOf } from './ecran.ts';
import { ecranDemarrage, modesPour } from './ecrans-communs.ts';

/** L'état figé que lit la page hors ligne : exactement la forme que /ecran/etat renvoie sur le réseau. */
export interface EtatFige {
  systemes: Array<Record<string, unknown>> | unknown[];
  disposition: string;
  theme: string;
  dit: Record<string, string>;
  [k: string]: unknown;
}

/** Ce que renvoie la construction : les fichiers à poser dans /ecran-odin, et le calque Alpine (apkovl) du kiosque. */
export interface BundleOffline {
  /** chemin (sous /ecran-odin) → contenu texte */
  fichiers: Record<string, string>;
  /** le calque du petit système Alpine (tar.gz) : paquets, kiosque hors ligne, choix → défaut Ventoy → redémarrage */
  overlay: Buffer;
}

/**
 * Construit le dossier /ecran-odin. `etat` est l'état figé (systèmes, thème, disposition, phrases d'Odin), pris au
 * moment de la préparation : la page le lira en local au lieu d'interroger Odin. Pur (le tar est déterministe).
 *
 *  - index.html : la page /ecran d'Odin, telle quelle (réutilisée d'ecran-page.ts).
 *  - ecran/etat : le systemes.json figé, servi là où la page va le chercher (fetch('/ecran/etat')).
 *  - systemes.json : la même donnée, lisible à part.
 *  - cgi-bin/choisir : le petit script (CGI) qui reçoit le choix, écrit le système retenu comme défaut de Ventoy
 *    (grubenv : odin_next), et demande le redémarrage ; la page l'appelle via fetch('/ecran/choisir').
 *  - odin.cfg : le bout de configuration GRUB qui, au redémarrage, lit odin_next et démarre ce système.
 *  - overlay : le calque Alpine qui, en kiosque, sert ce dossier en local (busybox httpd sur 127.0.0.1) et ouvre
 *    Chromium dessus — sans aucun serveur Odin, sans Internet.
 */
/** Un identifiant de système sûr pour la clé : un nom de fichier simple (jamais un chemin), sinon rien. Pur. */
const idSur = (x: unknown): string => {
  const brut = String(x ?? '');
  if (brut.split(/[\\/]/).includes('..')) return ''; // un chemin piégé : refusé, pas raccourci
  const v = brut.split(/[\\/]/).pop() ?? '';
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v) && !v.includes('..') ? v : '';
};
const texteCourt = (x: unknown, n = 80): string => String(x ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

/**
 * L'état FIGÉ tel qu'il est posé sur la clé : seulement ce que l'écran affiche, rien d'autre. Aucune adresse, aucun
 * nom de machine, aucun chemin (un nom de fichier seulement), aucun secret ; « Installer pour moi » n'existe pas sur
 * la clé (personne ne peut y donner son accord) ; « démarrer » (clé) devient « essayer » à l'écran. Pur.
 */
export function etatPourCle(etat: EtatFige): EtatFige {
  const systemes = (Array.isArray(etat.systemes) ? etat.systemes : []).flatMap((s0) => {
    if (!s0 || typeof s0 !== 'object') return [];
    const s = s0 as Record<string, unknown>;
    const id = idSur(s.id);
    if (!id) return [];
    const title = texteCourt(s.title ?? s.nom ?? s.name) || id;
    const modes = modesPour('cle', s.modes);
    const out: Record<string, unknown> = { id, title, version: texteCourt(s.version, 40), category: ecranDemarrage().logique.categorie(s.category ?? s.famille), modes, color: /^#[0-9a-fA-F]{6}$/.test(String(s.color)) && s.color !== '#5b8def' ? s.color : brand(title).color };
    if (s.name != null) out.name = idSur(s.name) || id;
    if (typeof s.size === 'number' && Number.isFinite(s.size) && s.size >= 0) out.size = s.size;
    if (['iso', 'installe', 'persistance', 'vm', 'racine'].includes(String(s.genre))) out.genre = s.genre;
    return [out];
  });
  const ids = systemes.map((x) => String(x.id));
  const dit: Record<string, string> = {};
  for (const [k, v] of Object.entries(etat.dit && typeof etat.dit === 'object' ? etat.dit : {})) if (k === '_' || ids.includes(k)) dit[k] = texteCourt(v, 300);
  const sortie: EtatFige = { systemes, disposition: ['eventail', 'affiches', 'liste'].includes(String(etat.disposition)) ? String(etat.disposition) : 'affiches', theme: themeOf(etat.theme), dit, source: 'cle' };
  if (etat.defaut != null && ids.includes(idSur(etat.defaut))) sortie.defaut = idSur(etat.defaut);
  if (etat.delai != null && Number.isFinite(Number(etat.delai))) sortie.delai = Math.max(0, Math.min(600, Math.round(Number(etat.delai))));
  if (etat.mascotte === false) sortie.mascotte = false;
  if (typeof etat.langue === 'string' && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(etat.langue)) sortie.langue = etat.langue;
  return sortie;
}

/**
 * Construit le dossier /ecran-odin. `etat` est l'état figé (systèmes, thème, disposition, phrases d'Odin), pris au
 * moment de la préparation : la page le lira en local au lieu d'interroger Odin. Pur (le tar est déterministe).
 *
 *  - index.html : la page /ecran d'Odin, telle quelle (réutilisée d'ecran-page.ts) : le MÊME écran que le réseau.
 *  - ecran/etat : le systemes.json figé (nettoyé, etatPourCle), servi là où la page va le chercher.
 *  - systemes.json : la même donnée, lisible à part.
 *  - cgi-bin/choisir : le petit script (CGI) qui reçoit le choix. Il n'accepte QUE les systèmes de cette clé (liste
 *    écrite dedans) et les façons permises (essayer, installer, mode texte) ; il écrit le système retenu comme
 *    prochain démarrage (grubenv : odin_next) ou le mode texte (odin_mode=texte), puis redémarre.
 *  - odin.cfg : le bout de configuration du chargeur qui, au redémarrage, lit odin_next et démarre ce système.
 *  - overlay : le calque Alpine qui, en kiosque, sert ce dossier en local (busybox httpd sur 127.0.0.1) et ouvre
 *    Chromium dessus — sans aucun serveur Odin, sans Internet.
 */
export function buildEcranOffline(etat: EtatFige): BundleOffline {
  const propre = etatPourCle(etat);
  const systemesJson = JSON.stringify(propre, null, 2) + '\n';
  const page = ecranPage();
  const permis = propre.systemes.map((x) => `'${String((x as { id: string }).id)}'`).join('|');

  // Le CGI du choix : n'accepte que les systèmes de la clé (identifiants sûrs, sans chemin) et les façons permises.
  const choisir = `#!/bin/sh
# Odin · Genèse (clé USB) : on a choisi un système ; on le règle comme prochain démarrage puis on redémarre.
# Rien d'autre n'est accepté : seulement les systèmes de cette clé, et essayer, installer ou le mode texte.
echo "Content-Type: application/json"
echo ""
lire() { echo "$QUERY_STRING" | tr '&' '\\n' | sed -n "s/^$1=//p" | head -n 1; }
ISO=$(lire iso)
MODE=$(lire mode)
case "$MODE" in essai|installer|texte) ;; *) echo '{"ok":false,"texte":"Cette façon de démarrer n’est pas proposée sur la clé."}'; exit 0 ;; esac
PART=/mnt/odin
mkdir -p "$PART" 2>/dev/null
# La 1re partition de la clé (étiquette ODIN) : on y écrit le choix pour le prochain démarrage.
mount -L ODIN "$PART" 2>/dev/null
if [ "$MODE" = "texte" ]; then
  grub-editenv "$PART/ventoy/grubenv" set "odin_mode=texte" 2>/dev/null || printf 'odin_mode=texte\\n' > "$PART/ecran-odin/choix.env"
  echo '{"ok":true,"texte":"Passage en mode texte : la machine redémarre."}'
  sync
  ( sleep 2; reboot ) &
  exit 0
fi
OK=
case "$ISO" in ${permis || "''"}) [ -n "$ISO" ] && OK=1 ;; esac
if [ -n "$OK" ]; then
  # grubenv : odin_next = chemin du système ; le bout odin.cfg le lira au redémarrage.
  grub-editenv "$PART/ventoy/grubenv" set "odin_next=/ISO/$ISO" 2>/dev/null || \\
    printf 'odin_next=/ISO/%s\\n' "$ISO" > "$PART/ecran-odin/choix.env"
  printf '{"iso":"%s","mode":"%s"}\\n' "$ISO" "$MODE" > "$PART/ecran-odin/choix.json"
  echo '{"ok":true,"texte":"C’est parti : la machine redémarre sur le système choisi."}'
  sync
  ( sleep 2; reboot ) &
else
  echo '{"ok":false,"texte":"Ce système n’est pas sur la clé."}'
fi
`;

  // Le bout de configuration GRUB lu par Ventoy au redémarrage : s'il y a un odin_next, on le démarre une fois.
  const odinCfg = `# Odin · Genèse (clé USB) : démarre le système choisi dans l'écran graphique, une seule fois.
load_env --file \${prefix}/grubenv
if [ -n "\${odin_next}" ]; then
  set next="\${odin_next}"
  save_env --file \${prefix}/grubenv odin_next
  set odin_next=
  echo "Odin : démarrage de \${next}..."
fi
`;

  const fichiers: Record<string, string> = {
    'index.html': page,
    'systemes.json': systemesJson,
    // La page va chercher fetch('/ecran/etat') : le httpd local sert ce fichier à ce chemin.
    'ecran/etat': systemesJson,
    'cgi-bin/choisir': choisir,
    'odin.cfg': odinCfg,
    'LISEZMOI.txt': lisezmoi(),
  };

  return { fichiers, overlay: overlayKiosque() };
}

function lisezmoi(): string {
  return [
    'Écran Odin hors ligne (mode graphique de la clé ODIN).',
    '',
    'Au démarrage en mode graphique, la clé lance un petit Alpine Linux en kiosque qui ouvre cette page,',
    'SANS serveur Odin et sans Internet : elle lit systemes.json (figé à la préparation de la clé).',
    'Quand tu choisis un système, la clé le règle comme prochain démarrage de Ventoy (ventoy/grubenv : odin_next)',
    'et redémarre pour le lancer. Le bout odin.cfg (chargé par Ventoy) lit odin_next au redémarrage.',
    '',
    'Odin n\'a QUE ses deux yeux blancs et sa couleur : ni bouche, ni sourcils, ni joues. Dessin officiel figé.',
    '',
  ].join('\n');
}

/**
 * Le calque Alpine du kiosque hors ligne, adapté de ecran-pc.ts (mêmes paquets, même idée) mais : il sert le
 * dossier /ecran-odin en LOCAL (busybox httpd sur 127.0.0.1:80, avec CGI pour le choix) et ouvre Chromium dessus.
 * Aucun serveur Odin, aucun réseau requis. On réutilise tarGz et KIOSK_PACKAGES d'ecran-pc.ts. Pur (tar déterministe).
 */
export function overlayKiosque(): Buffer {
  // Les paquets : ceux du kiosque du réseau (ecran-pc.ts) + busybox (httpd) + grub (grub-editenv) pour le choix.
  const paquets = [...KIOSK_PACKAGES, 'busybox', 'grub'];
  const start = `#!/bin/sh
# Odin · Genèse (clé USB) : l'écran graphique hors ligne (aucun serveur Odin, aucun réseau).
exec >/var/log/odin-ecran-cle.log 2>&1
id odin >/dev/null 2>&1 || adduser -D -G video odin
addgroup odin input 2>/dev/null; addgroup odin seat 2>/dev/null
mkdir -p /run/odin && chown odin /run/odin && chmod 700 /run/odin
rc-service seatd start 2>/dev/null
# La 1re partition de la clé (étiquette ODIN) porte le dossier /ecran-odin : on sert ce dossier en local.
mkdir -p /mnt/odin
mount -L ODIN /mnt/odin 2>/dev/null
DOSSIER=/mnt/odin/ecran-odin
# busybox httpd : sert le dossier sur 127.0.0.1:80 ; /cgi-bin/choisir gère le choix (il règle le défaut Ventoy).
( busybox httpd -f -p 127.0.0.1:80 -h "$DOSSIER" -c /etc/httpd.conf ) &
B=$(command -v chromium-browser || command -v chromium)
while true; do
  su odin -s /bin/sh -c "XDG_RUNTIME_DIR=/run/odin WLR_LIBINPUT_NO_DEVICES=1 cage -s -- $B --kiosk --no-first-run --noerrdialogs --disable-translate --ozone-platform=wayland --lang=fr --check-for-update-interval=31536000 'http://127.0.0.1/index.html?mac=cle&cle=1'"
  sleep 2
done
`;
  const httpdConf = 'A:127.0.0.1\n/cgi-bin:*\n'; // n'autorise que la boucle locale ; /cgi-bin exécutable
  return tarGz([
    { name: 'etc', dir: true }, { name: 'etc/apk', dir: true }, { name: 'etc/local.d', dir: true },
    { name: 'etc/runlevels', dir: true }, { name: 'etc/runlevels/default', dir: true }, { name: 'etc/runlevels/boot', dir: true }, { name: 'etc/runlevels/sysinit', dir: true },
    { name: 'etc/fstab', data: '' },
    { name: 'etc/hostname', data: 'odin-ecran-cle\n' },
    { name: 'etc/apk/world', data: `${paquets.join('\n')}\n` },
    { name: 'etc/httpd.conf', data: httpdConf },
    { name: 'etc/conf.d', dir: true }, { name: 'etc/conf.d/keymaps', data: 'keymap="fr"\n' },
    { name: 'etc/local.d/odin-ecran-cle.start', data: start, mode: 0o755 },
    { name: 'etc/runlevels/sysinit/udev', link: '/etc/init.d/udev' }, { name: 'etc/runlevels/sysinit/udev-trigger', link: '/etc/init.d/udev-trigger' },
    { name: 'etc/runlevels/boot/modloop', link: '/etc/init.d/modloop' },
    { name: 'etc/runlevels/default/seatd', link: '/etc/init.d/seatd' }, { name: 'etc/runlevels/default/local', link: '/etc/init.d/local' },
  ]);
}

/** Le chemin du dossier hors ligne sur la clé (contrat), pour le lot A qui écrit les fichiers. */
export const DOSSIER_OFFLINE = DISPOSITION_CLE.ecranOffline;
