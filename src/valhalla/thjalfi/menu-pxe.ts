// Genèse · le MENU PXE (maquette validée « Genèse · Systèmes », lot S9) : ce que voit un PC qui démarre par le réseau.
//   - l'ordre des systèmes (choisi par toi ; ceux qui arrivent ensuite se rangent derrière, par famille) ;
//   - les systèmes cachés (ils restent dans ta bibliothèque, le menu ne les propose plus) ;
//   - l'entrée par défaut, qui démarre seule au bout du délai : le disque du PC (conseillé), l'écran d'Odin, ou un
//     système qui ne fait QU'ESSAYER (un système « live », un outil). Une entrée qui installe ou peut effacer ne l'est
//     jamais : un PC branché par erreur ne part jamais sur une installation. Un PC autorisé (lots S6) garde son système à
//     lui, choisi dans « Déployer » ;
//   - les textes envoyés au chargeur (iPXE) sont nettoyés : ni guillemet, ni retour à la ligne, ni « ${…} », ni rien qui
//     casse son script.
// Tout est pur ici : les réglages sont gardés par le module (thjalfi.ts), le menu est écrit par recipes.ts.
import type { Recipe } from './recipes.ts';

/** Les réglages du menu : l'ordre choisi et les systèmes cachés (des identifiants d'ISO). */
export interface MenuPxeCfg { ordre: string[]; caches: string[] }
/** Un identifiant d'ISO tel que Genèse les fabrique (lettres, chiffres, tirets). */
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX = 500;

/** Une liste d'identifiants propre : seulement des identifiants valables, sans doublon, 500 au plus. Pur. */
export function idsPropres(x: unknown): string[] {
  const l = Array.isArray(x) ? x : typeof x === 'string' ? x.split(/[\s,]+/) : [];
  const out: string[] = [];
  for (const v of l) { const s = typeof v === 'string' ? v.trim() : ''; if (ID.test(s) && !out.includes(s)) out.push(s); if (out.length >= MAX) break; }
  return out;
}
/** Les réglages gardés, relus prudemment (un fichier abîmé donne le menu ordinaire). Pur. */
export function menuPxeCfg(x: unknown): MenuPxeCfg {
  const o = x && typeof x === 'object' ? x as Record<string, unknown> : {};
  return { ordre: idsPropres(o.ordre), caches: idsPropres(o.caches) };
}

/**
 * Cette entrée installe un système ou peut effacer le disque ? Un système « live » (essayer sans rien toucher) et les
 * outils reconnus (GParted, Clonezilla…, qui ne font rien tout seuls) : non. Tout ce qui installe (Ubuntu, Debian,
 * Fedora et compatibles, Windows) et toute ISO inconnue (démarrée telle quelle : on ne sait pas ce qu'elle fait) : oui.
 * Pur.
 */
export function installe(r: Recipe | undefined): boolean {
  if (!r || r.auto) return true;
  return !['casper', 'fedora-live', 'debian-live', 'alpine', 'arch'].includes(r.kind);
}

/** La famille d'un système, dans l'ordre où le menu les range quand tu n'as rien choisi. */
export const FAMILLES = ['Windows', 'Linux', 'Serveurs', 'Outils', 'ISO'];

/**
 * Les systèmes dans l'ordre du menu : d'abord ceux que tu as rangés, dans ton ordre ; puis les autres (une ISO arrivée
 * depuis), rangés par famille comme avant. Sans ordre choisi : par famille. Stable. Pur.
 */
export function ordonner<T extends { id: string }>(list: T[], cfg: MenuPxeCfg, famille: (e: T) => string = () => 'ISO'): T[] {
  const rang = (e: T) => { const i = cfg.ordre.indexOf(e.id); return i < 0 ? cfg.ordre.length : i; };
  const fam = (e: T) => { const i = FAMILLES.indexOf(famille(e)); return i < 0 ? FAMILLES.length : i; };
  return list.map((e, i) => ({ e, i })).sort((a, b) => rang(a.e) - rang(b.e) || (rang(a.e) === cfg.ordre.length ? fam(a.e) - fam(b.e) : 0) || a.i - b.i).map((x) => x.e);
}
/** Les systèmes montrés au menu : sans les cachés, sauf ceux à garder (le système d'un PC autorisé). Pur. */
export function visibles<T extends { id: string }>(list: T[], cfg: MenuPxeCfg, garder: Array<string | undefined> = []): T[] {
  return list.filter((e) => !cfg.caches.includes(e.id) || garder.includes(e.id));
}
/** Les familles se suivent-elles d'un seul tenant dans cet ordre (pour garder les intertitres du menu texte) ? Pur. */
export function famillesGroupees<T>(list: T[], famille: (e: T) => string): boolean {
  const vues: string[] = [];
  for (const e of list) { const f = famille(e); if (vues.at(-1) === f) continue; if (vues.includes(f)) return false; vues.push(f); }
  return true;
}

/**
 * L'entrée par défaut pour un PC qui n'a pas son système à lui (PC inconnu ou non autorisé) : « local » (le disque du
 * PC), « ecran » (l'écran d'Odin), ou un système qui n'installe rien. Sinon : le disque, avec la raison. Pur.
 */
export function defautSur(def: string, list: Array<{ id: string; name?: string; recipe?: Recipe }>): { def: string; refus?: string } {
  if (!def || def === 'local' || def === 'disque') return { def: 'local' };
  if (def === 'ecran') return { def: 'ecran' };
  const e = list.find((x) => x.id === def);
  if (!e) return { def: 'local', refus: 'ce système n\'est plus dans la bibliothèque' };
  if (installe(e.recipe)) return { def: 'local', refus: `${e.name ?? e.id} installe un système (ou peut effacer le disque) : il ne démarre jamais tout seul sur un PC qui n'est pas autorisé` };
  return { def: e.id };
}

/**
 * Un texte du menu, prêt pour le chargeur iPXE : accents retirés, seulement lettres, chiffres, espace et . _ ( ) + - ;
 * donc ni guillemet, ni retour à la ligne, ni « $ { } » (aucune variable), ni « || » ni « # ». Il ne commence jamais
 * par un tiret (iPXE le lirait comme une option) et il est coupé à `max` caractères. Pur.
 */
export function texteIpxe(s: unknown, max = 200): string {
  const t = String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ._()+-]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[-\s]+/, '');
  return t.length > max ? `${t.slice(0, Math.max(1, max - 1)).trimEnd()}.` : t;
}

/** Une ligne du menu telle que le PC la voit (pour l'aperçu de la page). */
export interface LigneMenu { id: string; texte: string; gap?: boolean }
/**
 * L'aperçu FIDÈLE : relu dans le script iPXE réellement écrit pour un PC (titre, lignes « item », entrée par défaut et
 * délai de « choose »), pour que la page montre exactement ce que le PC verra. Pur.
 */
export function lireMenu(script: string): { titre: string; lignes: LigneMenu[]; defaut: string; delai: number } {
  const L = script.split('\n');
  const titre = (L.find((l) => l.startsWith('menu ')) ?? '').slice(5).trim();
  const lignes: LigneMenu[] = [];
  for (const l of L) {
    let m = /^item --gap --(?: (.*))?$/.exec(l);
    if (m) { lignes.push({ id: '', texte: (m[1] ?? '').trim(), gap: true }); continue; }
    m = /^item (\S+) (.*)$/.exec(l);
    if (m) lignes.push({ id: m[1].replace(/^e-/, ''), texte: m[2].trim() });
  }
  const c = /^choose --default (\S+) --timeout (\d+)/m.exec(script);
  return { titre, lignes, defaut: c ? c[1].replace(/^e-/, '') : 'local', delai: c ? Math.round(Number(c[2]) / 1000) : 0 };
}
