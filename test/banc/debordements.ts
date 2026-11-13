// Détecteur de débordements et d'éléments mal placés, dans un vrai navigateur (Chromium piloté par Playwright).
// On lui donne une page Playwright déjà ouverte, il rend la liste des défauts :
//
//   import { detecter, capturer } from './banc/debordements.ts';
//   const defauts = await detecter(page);                       // tout ce qui dépasse, se chevauche, se lit mal…
//   await capturer(page, defauts[0], '/tmp/defaut.png');        // capture recadrée, l'élément fautif entouré
//
// Le code qui tourne dans la page est dans `debordements-page.js` (lu comme du texte : pas besoin des types du
// navigateur). Le parcours complet d'Odin est dans `qualite.ts` ; la fluidité dans `fluidite.ts`.

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Gravite = 'grave' | 'moyen' | 'mineur' | 'info';
export interface Defaut {
  /** defilement-horizontal, hors-ecran, coupe, hors-boite, texte-tronque, recouvert, sous-fixe, sur-decor, chevauchement, onglets-lignes, onglets-coupes, bouton-3-lignes, cible-tactile, image-deformee, contraste, focus-invisible, zone-defile, hors-planche */
  type: string;
  gravite: Gravite;
  /** Sélecteur CSS de l'élément fautif (unique dans la page quand c'est possible). */
  selecteur: string;
  /** Début du texte de l'élément. */
  texte: string;
  /** La mesure, en clair (« texte coupé à droite par sa boîte : 38 px invisibles… »). */
  mesure: string;
  /** Les chiffres bruts de la mesure. */
  valeurs: Record<string, unknown>;
  /** Place de l'élément dans la fenêtre au moment de la mesure. */
  rect: { x: number; y: number; w: number; h: number };
  /** Repère posé sur l'élément (`data-q`), pour la capture. */
  q: number;
  /** Clé de regroupement : le même défaut répété sur la page n'est rendu qu'une fois, avec `n` et `autres`. */
  groupe: string;
  n?: number;
  autres?: string[];
  /** Second élément en cause (le texte sous la notification, l'autre bouton…). */
  dessous?: string;
  /** Position de défilement à remettre avant la capture (défaut visible seulement en bas de page). */
  vue?: { sel: string; fin: number } | null;
  // Ajoutés par le parcours :
  page?: string; largeur?: number; apparence?: string; capture?: string;
}
export interface Mesures { largeur: number; hauteur: number; elements: number; textes: number; cliquables: number; zonesDefilantes: number; pageLarge: number; pageHaute: number; decor: boolean; passes: number; ms: number }
export interface OptionsDetection {
  /** Ne regarder que sous cet élément (sélecteur). Par défaut : toute la page. */
  racine?: string;
  /** Sélecteurs à laisser de côté (eux et ce qu'ils contiennent). */
  ignorer?: string[];
  /** Panneaux flottants ouverts exprès (menu, petite fenêtre) : ils ont le droit de couvrir la page. */
  dessus?: string[];
  /** Vérifier les cibles tactiles. Par défaut : seulement si la fenêtre fait 480 px de large ou moins. */
  tactile?: boolean;
  /** Taille minimale d'une cible tactile (40 px). */
  cibleMin?: number;
  /** Contraste du texte (WCAG). */
  contraste?: boolean;
  /** Focus au clavier visible. */
  focus?: boolean;
  /** Faire défiler la page pour tester aussi ce qui est sous le pli (texte recouvert, barre du bas). */
  defiler?: boolean;
  /** Texte posé sur le décor du thème. */
  decor?: boolean;
  /** Sélecteurs de rangées d'onglets en plus de celles trouvées seules (`[role=tablist]`, `.tabs`, `.seg`…). */
  onglets?: string;
  /** Planche de maquette : rien ne doit dépasser de ce cadre (largeur, et hauteur si elle est fixe). */
  cadre?: { w?: number; h?: number } | null;
  /** Regrouper les défauts identiques répétés (vrai par défaut). */
  regrouper?: boolean;
  maxFocus?: number;
}
/** Ce qu'il faut d'une page Playwright (pas de dépendance aux types de Playwright). */
export interface PageQ {
  evaluate<R = unknown>(js: string): Promise<R>;
  screenshot(o: { path?: string; fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  keyboard?: { press(key: string): Promise<void> };
}

/** Le code du détecteur, à évaluer dans la page : `(DETECTEUR_JS)(options)`. */
export const DETECTEUR_JS: string = readFileSync(new URL('./debordements-page.js', import.meta.url), 'utf8').trim().replace(/;$/, '');

/** Le nom de chaque défaut, en clair. */
export const TYPES: Record<string, string> = {
  'defilement-horizontal': 'La page défile de côté',
  'hors-ecran': 'Élément qui sort de l\'écran',
  'hors-planche': 'Contenu qui dépasse de la planche',
  coupe: 'Élément ou texte coupé par sa boîte',
  'hors-boite': 'Élément ou texte qui sort de sa boîte',
  recouvert: 'Texte recouvert par un autre élément',
  'sous-fixe': 'Texte sous un élément fixe (notification, mascotte, barre)',
  'sur-decor': 'Texte posé sur le décor du thème',
  chevauchement: 'Éléments cliquables qui se chevauchent',
  'onglets-lignes': 'Rangée d\'onglets sur plusieurs lignes',
  'onglets-coupes': 'Onglets qui ne tiennent pas dans la largeur',
  'bouton-3-lignes': 'Libellé de bouton sur 3 lignes ou plus',
  'cible-tactile': 'Cible tactile trop petite',
  'image-deformee': 'Image déformée',
  contraste: 'Contraste du texte insuffisant',
  'focus-invisible': 'Focus au clavier invisible',
  'texte-tronque': 'Texte tronqué par « … »',
  'zone-defile': 'Zone à faire défiler de côté',
};
export const ORDRE: Record<Gravite, number> = { grave: 0, moyen: 1, mineur: 2, info: 3 };

/** Passe le détecteur sur la page : les défauts (les plus graves d'abord) et quelques mesures. */
export async function analyser(page: PageQ, o: OptionsDetection = {}): Promise<{ defauts: Defaut[]; mesures: Mesures }> {
  // Une touche du clavier d'abord : le navigateur montre alors le focus « clavier » (:focus-visible) aux éléments testés.
  if (o.focus !== false) { try { await page.keyboard?.press('Shift'); } catch { /* pas de clavier : le test du focus reste indicatif */ } }
  return page.evaluate<{ defauts: Defaut[]; mesures: Mesures }>(`(${DETECTEUR_JS})(${JSON.stringify(o)})`);
}
/** La liste des défauts de la page (les plus graves d'abord). */
export async function detecter(page: PageQ, o: OptionsDetection = {}): Promise<Defaut[]> { return (await analyser(page, o)).defauts; }

/** Seulement ce qui compte comme un débordement ou un mauvais placement grave (pour un essai automatique). */
export const DEBORDEMENTS = ['defilement-horizontal', 'hors-ecran', 'hors-planche', 'coupe', 'hors-boite', 'recouvert', 'chevauchement', 'onglets-lignes', 'onglets-coupes'];
export const debordementsGraves = (d: Defaut[]): Defaut[] => d.filter((x) => x.gravite === 'grave' && DEBORDEMENTS.includes(x.type));

/** Une ligne lisible par défaut. */
export const ligne = (d: Defaut): string => `[${d.gravite}] ${TYPES[d.type] ?? d.type} — ${d.mesure} — ${d.selecteur}${d.n && d.n > 1 ? ` (×${d.n})` : ''}`;
export function resume(defauts: Defaut[]): string {
  const n = (g: Gravite) => defauts.filter((d) => d.gravite === g).length;
  return `${n('grave')} grave(s), ${n('moyen')} moyen(s), ${n('mineur')} mineur(s), ${n('info')} signalement(s)`;
}

/**
 * Capture recadrée d'un défaut : l'élément fautif est amené à l'écran et entouré de rouge (le second élément en cause,
 * s'il y en a un, de pointillés orange). Rend false si l'élément n'est plus dans la page.
 */
export async function capturer(page: PageQ, d: Defaut, fichier: string, o: { marge?: number } = {}): Promise<boolean> {
  const marge = o.marge ?? 56;
  const js = `(() => {
    const d = ${JSON.stringify({ q: d.q, sel: d.selecteur, dessous: d.dessous ?? '', vue: d.vue ?? null, type: d.type })};
    const find = (s) => { try { return s ? document.querySelector(s) : null; } catch { return null; } };
    const e = document.querySelector('[data-q="' + d.q + '"]') || find(d.sel); if (!e) return null;
    // Les positions de défilement sont remises après la capture (la page reste comme on l'a trouvée).
    const avant = [document.scrollingElement, ...(function up(n, l) { for (n = n.parentElement; n; n = n.parentElement) if (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1) l.push(n); return l; })(e, [])].filter(Boolean).map((s) => [s, s.scrollTop, s.scrollLeft]);
    if (d.vue) { const s = d.vue.sel ? find(d.vue.sel) : document.scrollingElement; if (s) { if (!avant.some((a) => a[0] === s)) avant.push([s, s.scrollTop, s.scrollLeft]); s.scrollTop = d.vue.fin; } }
    else if (getComputedStyle(e).position !== 'fixed') e.scrollIntoView({ block: 'center', inline: 'nearest' });
    const boite = (el, style) => { const r = el.getBoundingClientRect(), m = document.createElement('div'); m.setAttribute('data-q-outil', ''); m.className = '__q_marque'; m.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;border-radius:3px;' + style + ';left:' + (r.left - 3) + 'px;top:' + (r.top - 3) + 'px;width:' + (r.width + 6) + 'px;height:' + (r.height + 6) + 'px'; document.documentElement.append(m); return r; };
    const r = boite(e, 'border:2px solid #ff2d55;box-shadow:0 0 0 1px #fff');
    let u = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    const x = find(d.dessous); if (x && x !== e) { const r2 = boite(x, 'border:2px dashed #ff9500'); if (r2.bottom > 0 && r2.top < innerHeight) u = { l: Math.min(u.l, r2.left), t: Math.min(u.t, r2.top), r: Math.max(u.r, r2.right), b: Math.max(u.b, r2.bottom) }; }
    window.__qAvant = avant;
    return { l: u.l, t: u.t, r: u.r, b: u.b, W: innerWidth, H: innerHeight };
  })()`;
  const b = await page.evaluate<{ l: number; t: number; r: number; b: number; W: number; H: number } | null>(js);
  if (!b) return false;
  try {
    // Cadre : l'élément et un peu de contexte autour, jamais plus grand que la fenêtre.
    let x = b.l - marge, y = b.t - marge, w = b.r - b.l + 2 * marge, h = b.b - b.t + 2 * marge;
    const minW = Math.min(b.W, 420), minH = Math.min(b.H, 260);
    if (w < minW) { x -= (minW - w) / 2; w = minW; } if (h < minH) { y -= (minH - h) / 2; h = minH; }
    w = Math.min(w, b.W); h = Math.min(h, b.H);
    x = Math.max(0, Math.min(x, b.W - w)); y = Math.max(0, Math.min(y, b.H - h));
    mkdirSync(dirname(fichier), { recursive: true });
    await page.screenshot({ path: fichier, clip: { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) } });
    return true;
  } finally {
    await page.evaluate(`(() => { for (const m of document.querySelectorAll('.__q_marque')) m.remove(); for (const [s, top, left] of window.__qAvant || []) { s.scrollTop = top; s.scrollLeft = left; } window.__qAvant = undefined; })()`).catch(() => undefined);
  }
}

/** Retire les repères `data-q` posés par le détecteur (à faire avant de repasser sur une page qui a changé). */
export async function nettoyer(page: PageQ): Promise<void> {
  await page.evaluate(`(() => { for (const e of document.querySelectorAll('[data-q]')) e.removeAttribute('data-q'); document.documentElement.removeAttribute('data-qn'); })()`).catch(() => undefined);
}
