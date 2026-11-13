// Genèse · l'écran de démarrage (maquettes validées « Démarrage réseau ») : ce que voit un PC qui démarre par le
// réseau — les systèmes en éventail, en affiches ou en liste, le détail (Essayer · Installer · Installer pour moi),
// le chargement avec ses étapes, et la fin. Fonctions pures : classement, couleurs, modes possibles, état envoyé à
// l'écran. L'écran ne fait que demander : « Installer pour moi » (qui efface le disque) attend toujours ton accord.
import type { Recipe } from './recipes.ts';

export type Category = 'Linux' | 'Windows' | 'Serveurs' | 'Outils';
export type Mode = 'essai' | 'installer' | 'auto';
export const DISPOSITIONS = ['eventail', 'affiches', 'liste'] as const;
export type Disposition = typeof DISPOSITIONS[number];
/** Les 9 thèmes de l'écran graphique gardés sur la maquette « Thèmes du démarrage réseau » (13/11/2026). */
export const THEMES = { bleu: 'Bleu verre', matrix: 'Matrix', ocean: 'Voyage océan', lune: 'Lune', ciel: 'Ciel', galaxie: 'Galaxie', mayotte: 'Mayotte', couchant: 'Coucher de soleil', clair: 'Clair minimal' } as const;
export type Theme = keyof typeof THEMES;
/** Un ancien thème (avant la maquette) devient le plus proche des nouveaux. Pur. */
export function themeOf(x: unknown): Theme {
  const v = typeof x === 'string' ? x : '';
  if (v in THEMES) return v as Theme;
  return ({ nuit: 'bleu', espace: 'galaxie', odin: 'bleu' } as Record<string, Theme>)[v] ?? 'bleu';
}
/** Les 4 thèmes de l'écran texte (iPXE) gardés sur la maquette, plus « classique » (les couleurs d'iPXE). */
export const TEXT_THEMES = {
  matrix: { label: 'Matrix', fg: '#7dff9b', title: '#c8ffd4', gap: '#2fbf5a', selBg: '#3dff7a', selFg: '#001a07' },
  lune: { label: 'Lune', fg: '#e9e6dc', title: '#fff7d6', gap: '#b3ad98', selBg: '#f4f1e8', selFg: '#1a1c26' },
  aurore: { label: 'Aurore boréale', fg: '#dffff4', title: '#7dffcf', gap: '#a98bff', selBg: '#7dffcf', selFg: '#06101e' },
  neon: { label: 'Néon', fg: '#f0e6ff', title: '#ff4fd8', gap: '#3af0ff', selBg: '#ff4fd8', selFg: '#12002a' },
} as const;
export type TextTheme = keyof typeof TEXT_THEMES | 'classique';
export const TEXT_THEME_IDS = [...Object.keys(TEXT_THEMES), 'classique'] as TextTheme[];
export const textThemeOf = (x: unknown): TextTheme => (TEXT_THEME_IDS as string[]).includes(String(x)) ? x as TextTheme : 'matrix';
const rgb = (h: string) => `0x${h.slice(1)}`;
/**
 * Les lignes iPXE qui habillent l'écran texte : image de fond (« console --picture ») et couleurs (« colour »,
 * « cpair »). Chaque ligne finit par « || » : un iPXE qui ne sait pas le faire (chargeur BIOS officiel) garde
 * simplement ses couleurs, le menu marche quand même. La couleur 4 reste « transparente » (on voit l'image). Pur.
 */
export function textLook(theme: TextTheme, picture?: string): string[] {
  if (theme === 'classique' && !picture) return [];
  const L: string[] = [];
  if (picture) L.push(`console --picture ${picture} --left 40 --right 40 --top 36 --bottom 36 ||`);
  if (theme !== 'classique') {
    const t = TEXT_THEMES[theme];
    L.push(`colour --rgb ${rgb(t.fg)} 7 ||`, `colour --rgb ${rgb(t.selBg)} 1 ||`, `colour --rgb ${rgb(t.gap)} 6 ||`, `colour --rgb ${rgb(t.selFg)} 0 ||`, `colour --rgb ${rgb(t.title)} 3 ||`,
      'cpair --foreground 7 --background 4 0 ||', 'cpair --foreground 7 --background 4 1 ||', 'cpair --foreground 0 --background 1 2 ||', 'cpair --foreground 6 --background 4 3 ||', 'cpair --foreground 3 --background 4 6 ||');
  }
  return L;
}

/** La famille d'un système, pour les onglets de l'écran. */
export function category(r: Recipe | undefined, name: string): Category {
  const n = name.toLowerCase();
  if (r?.os === 'windows' || /windows|win1[01]|win2\d/.test(n)) return /server/.test(n) ? 'Serveurs' : 'Windows';
  if (r?.os === 'outil' || /clonezilla|gparted|memtest|rescue|hiren|systemrescue|shredos/.test(n)) return 'Outils';
  if (/server|proxmox|truenas|rocky|alma|rhel|centos|opnsense|pfsense/.test(n) || r?.kind === 'rhel') return 'Serveurs';
  return 'Linux';
}
/** Ce que le PC peut faire de ce système : l'essayer sans rien toucher, l'installer pas à pas, ou tout automatique. */
export function modes(r: Recipe | undefined): Mode[] {
  if (!r) return [];
  const out: Mode[] = [];
  if (['casper', 'fedora-live', 'debian-live', 'alpine', 'arch'].includes(r.kind) || r.os === 'outil') out.push('essai');
  if (['casper', 'ubuntu', 'debian', 'rhel', 'fedora-live', 'arch'].includes(r.kind)) out.push('installer');
  if (r.auto) out.push('auto');
  return out;
}
const BRANDS: Array<[RegExp, string, string]> = [
  [/ubuntu.*server/, '#E95420', 'Ubuntu pour les serveurs : léger, sans bureau.'], [/ubuntu/, '#E95420', 'Le Linux le plus simple pour un ordinateur de bureau.'], [/windows/, '#0A6CD6', 'Pour les logiciels et les jeux Windows.'], [/debian/, '#C70036', 'Solide et stable, idéal pour un serveur.'],
  [/fedora/, '#3C6EB4', 'Les logiciels les plus récents, très propre.'], [/mint/, '#69B53F', 'Proche de Windows, très facile à prendre en main.'], [/proxmox/, '#E57000', 'Virtualisation : des machines et des conteneurs sur un serveur.'],
  [/rocky/, '#10B981', 'Serveur d\'entreprise, compatible Red Hat.'], [/alma/, '#0F4266', 'Serveur d\'entreprise, compatible Red Hat.'], [/truenas/, '#0095D5', 'Un stockage réseau (NAS) solide.'],
  [/arch/, '#1793D1', 'Pour qui aime tout régler soi-même.'], [/alpine/, '#0D597F', 'Minuscule et sûr, pour les petits serveurs.'], [/memtest/, '#7C3AED', 'Teste la mémoire du PC.'],
  [/clonezilla/, '#D4A017', 'Copie ou sauvegarde un disque entier.'], [/gparted/, '#4CAF50', 'Partitionne et répare les disques.'], [/kali/, '#367BF0', 'Outils de test de sécurité.'],
];
export function brand(name: string): { color: string; blurb: string } {
  const n = name.toLowerCase(), b = BRANDS.find(([re]) => re.test(n));
  return b ? { color: b[1], blurb: b[2] } : { color: '#5B6CD6', blurb: 'Système prêt à démarrer par le réseau.' };
}
/** Une version lisible tirée du nom de l'ISO (« ubuntu-24.04.3-desktop-amd64 » → « Ubuntu Desktop », « 24.04.3 »). */
export function pretty(name: string): { title: string; version: string } {
  const w = /win(?:dows)?[-_ ]?(1[01]|7|8)(?![\d.])/i.exec(name), ws = /windows[-_ ]?server[-_ ]?(20\d\d)/i.exec(name);
  if (ws) return { title: `Windows Server ${ws[1]}`, version: /(\d\d[hH]\d)/.exec(name)?.[1].toUpperCase() ?? '' };
  if (w) return { title: `Windows ${w[1]}`, version: /(\d\d[hH]\d)/.exec(name)?.[1].toUpperCase() ?? '' };
  const n = name.replace(/[_]+/g, '-'), v = /(\d+(?:\.\d+){0,2})/.exec(n)?.[1] ?? '';
  const words = n.replace(/\.iso$/i, '').replace(/\b(amd64|x86[-_]64|x64|arm64|aarch64|i386|i686|live|dvd|netinst|english|french|fr|en-us|fr-fr|multi)\b/gi, ' ').replace(/(\d+(?:\.\d+){0,2})/g, ' ').split(/[-\s]+/).filter(Boolean);
  const title = words.slice(0, 3).map((w) => (/^(lts|le|de|la)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ').replace(/\bLTS\b/i, '').trim();
  return { title: title || name, version: v };
}
export interface EcranSystem { id: string; name: string; title: string; version: string; category: Category; size: number; modes: Mode[]; label: string; needs?: string; color: string; blurb: string; deployed: number }
export function systems(list: Array<{ id: string; name: string; size: number; recipe?: Recipe }>, stats: Record<string, { lances: number; finis: number }> = {}): EcranSystem[] {
  return list.filter((i) => i.recipe).map((i) => { const p = pretty(i.name), b = brand(i.name); return { id: i.id, name: i.name, title: p.title, version: p.version, category: category(i.recipe, i.name), size: i.size, modes: modes(i.recipe), label: i.recipe!.label, ...(i.recipe!.needs ? { needs: i.recipe!.needs } : {}), color: b.color, blurb: b.blurb, deployed: stats[i.id]?.finis ?? 0 }; });
}
/** Ce qu'Odin dit en bas de l'écran, selon le système choisi et le PC. */
export function odinSays(sys: EcranSystem | undefined, fw: string): string {
  if (!sys) return 'Choisis un système avec les flèches, puis Entrée pour l\'essayer.';
  const uefi = /efi/i.test(fw) ? 'ce PC démarre en UEFI' : fw ? 'ce PC démarre en BIOS' : '';
  if (sys.modes.includes('auto')) return `${sys.title} : je peux tout faire pour toi (compte, logiciels, mises à jour)${uefi ? ` — ${uefi}` : ''}. « Installer pour moi » efface le disque : je te demande ton accord avant.`;
  if (sys.modes.includes('essai')) return `${sys.title} : essaie-le d'abord, rien n'est écrit sur ton disque.`;
  return `${sys.title} : ${sys.blurb}`;
}
