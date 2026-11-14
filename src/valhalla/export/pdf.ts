// Export des pages d'applis · PDF.
// Un PDF A4 écrit sans dépendance, comme `src/files/pdf.ts` (polices standard Helvetica et Courier, accents français),
// avec en plus ce qu'il faut à une page d'appli : chiffres clés en tuiles, vrais tableaux (en-tête répété à chaque
// page), barres et courbes dessinées, journaux à largeur fixe, numéro de page.
// Limite connue des polices standard : seuls les caractères latins sont écrits. Les signes courants des pages (flèches,
// coches, croix, ronds de couleur) sont dessinés ; les autres émojis sont retirés, les autres écritures remplacées par « ? ».

import { deflateSync } from 'node:zlib';
import type { Tone } from '../types.ts';
import { colonnesCourbe, fiche, nombreFr, voisins } from './markdown.ts';
import { groupes, manques, provenance, vide, type PageExport, type SectionExport } from './page.ts';

const PW = 595.28, PH = 841.89, MG = 48, HAUT = 50, BAS = 58, LW = PW - 2 * MG;
type Police = 'F1' | 'F2' | 'F3' | 'F4';   // normal, gras, italique, largeur fixe
type Rvb = [number, number, number];
const ENCRE: Rvb = [0.08, 0.09, 0.11], GRIS: Rvb = [0.36, 0.39, 0.44], TRAIT: Rvb = [0.8, 0.82, 0.86], FOND: Rvb = [0.955, 0.963, 0.975], TETE: Rvb = [0.925, 0.94, 0.958];
const BLEU: Rvb = [0.22, 0.45, 0.82], TON: Record<string, Rvb> = { bon: [0.1, 0.48, 0.24], attention: [0.72, 0.4, 0], mauvais: [0.72, 0.14, 0.1] };
const PALETTE: Rvb[] = [BLEU, [0.05, 0.55, 0.55], [0.5, 0.33, 0.75], [0.4, 0.43, 0.48]];
const encre = (t: Tone | undefined): Rvb => (t && TON[t]) || ENCRE;

// Largeurs des caractères (millièmes du corps), d'après les fiches publiques des polices Helvetica et Helvetica-Bold.
const AFM = (s: string) => s.split(' ').map(Number);
const L_NORMAL = AFM('278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584');
const L_GRAS = AFM('278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584');
const L_AUTRES: Record<string, [number, number]> = { '…': [1000, 1000], '—': [1000, 1000], '–': [556, 556], '•': [350, 350], '€': [556, 556], '’': [222, 278], '‘': [222, 278], '“': [333, 500], '”': [333, 500], '«': [556, 556], '»': [556, 556], 'œ': [944, 944], 'Œ': [1000, 1000], '°': [400, 400], '·': [278, 278], '\u00A0': [278, 278], '™': [1000, 1000], '‰': [1000, 1000] };
/** Largeur d'un texte (déjà passé par `latin`) dans une police, en points. */
export function largeur(t: string, taille: number, police: Police = 'F1'): number {
  if (police === 'F4') return t.length * 0.6 * taille;
  const g = police === 'F2' ? 1 : 0, table = g ? L_GRAS : L_NORMAL;
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i], sp = L_AUTRES[ch];
    if (sp) { n += sp[g]; continue; }
    const sg = SIGNES[ch]; if (sg) { n += sg.l; continue; }
    let c = t.charCodeAt(i); if (c > 126) c = ch.normalize('NFD').charCodeAt(0);
    n += c >= 32 && c <= 126 ? table[c - 32] : 556;
  }
  return (n * taille) / 1000;
}

// L'encodage des polices de texte (WinAnsi, c'est-à-dire Windows-1252).
const CP1252: Record<string, number> = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };
// Quelques signes absents des polices de texte (flèches, coches, croix, ronds, carrés) : ils sont dessinés au trait,
// pour rendre pareil dans tous les lecteurs de PDF. Les ronds et coches de couleur des pages (🟢, 🔴, ✅, ❌…) gardent
// leur couleur. Mesures en parts du corps du texte, à partir de la ligne de base.
type Pt = [number, number];
interface Signe { /** avance, en millièmes du corps */ l: number; traits?: Pt[][]; ep?: number; pleins?: Pt[][]; rond?: { r: number; plein: boolean }; couleur?: Rvb }
const ROND = (couleur?: Rvb): Signe => ({ l: 760, rond: { r: 0.29, plein: true }, couleur });
const COCHE = (couleur?: Rvb): Signe => ({ l: 820, traits: [[[0.12, 0.36], [0.34, 0.12], [0.72, 0.66]]], ep: 0.11, couleur });
const CROIX = (couleur?: Rvb): Signe => ({ l: 760, traits: [[[0.14, 0.08], [0.62, 0.62]], [[0.14, 0.62], [0.62, 0.08]]], ep: 0.11, couleur });
const DROITE: Signe = { l: 900, traits: [[[0.08, 0.34], [0.82, 0.34]], [[0.6, 0.54], [0.82, 0.34], [0.6, 0.14]]], ep: 0.085 };
// Marques internes (zone à usage privé) posées par `latin` à la place des signes de couleur.
const M = { vert: '\u{E001}', rouge: '\u{E002}', orange: '\u{E003}', jaune: '\u{E004}', bleu: '\u{E005}', blanc: '\u{E006}', noir: '\u{E007}', oui: '\u{E008}', non: '\u{E009}' };
const SIGNES: Record<string, Signe> = {
  '→': DROITE, '⇒': DROITE,
  '←': { l: 900, traits: [[[0.82, 0.34], [0.08, 0.34]], [[0.3, 0.54], [0.08, 0.34], [0.3, 0.14]]], ep: 0.085 },
  '↑': { l: 600, traits: [[[0.3, 0.02], [0.3, 0.68]], [[0.1, 0.46], [0.3, 0.68], [0.5, 0.46]]], ep: 0.085 },
  '↓': { l: 600, traits: [[[0.3, 0.68], [0.3, 0.02]], [[0.1, 0.24], [0.3, 0.02], [0.5, 0.24]]], ep: 0.085 },
  '↔': { l: 1000, traits: [[[0.1, 0.34], [0.9, 0.34]], [[0.3, 0.52], [0.1, 0.34], [0.3, 0.16]], [[0.7, 0.52], [0.9, 0.34], [0.7, 0.16]]], ep: 0.085 },
  '✓': COCHE(), '✔': COCHE(), '✗': CROIX(), '✘': CROIX(), '✕': CROIX(), '✖': CROIX(),
  '●': ROND(), '○': { l: 760, rond: { r: 0.26, plein: false } },
  '■': { l: 760, pleins: [[[0.09, 0.06], [0.67, 0.06], [0.67, 0.64], [0.09, 0.64]]] }, '□': { l: 760, traits: [[[0.1, 0.07], [0.66, 0.07], [0.66, 0.63], [0.1, 0.63], [0.1, 0.07]]], ep: 0.07 },
  '▲': { l: 800, pleins: [[[0.08, 0.06], [0.72, 0.06], [0.4, 0.66]]] }, '▼': { l: 800, pleins: [[[0.08, 0.64], [0.72, 0.64], [0.4, 0.04]]] }, '◆': { l: 760, pleins: [[[0.38, 0.02], [0.7, 0.35], [0.38, 0.68], [0.06, 0.35]]] },
  [M.vert]: ROND(TON.bon), [M.rouge]: ROND(TON.mauvais), [M.orange]: ROND([0.9, 0.5, 0.1]), [M.jaune]: ROND([0.85, 0.68, 0.1]), [M.bleu]: ROND(BLEU), [M.blanc]: ROND([0.76, 0.78, 0.81]), [M.noir]: ROND(ENCRE),
  [M.oui]: COCHE(TON.bon), [M.non]: CROIX(TON.mauvais),
};
const ecrit = (ch: string) => { const c = ch.charCodeAt(0); return ch.length === 1 && (CP1252[ch] !== undefined || (c >= 32 && c <= 126) || (c >= 160 && c <= 255)); };
/** Ce qui se dit autrement dans toutes les polices : espaces fines, traits d'union, traits de cadre, tabulations. */
const PARTOUT: Array<[RegExp, string]> = [
  [/[\u{202F}\u{2009}\u{200A}\u{2007}\u{2008}\u{205F}\u{3000}]/gu, ' '], [/[\u{2212}\u{2010}\u{2011}]/gu, '-'], [/′/g, '\''], [/″/g, '"'], [/№/g, 'N°'], [/[\u{2500}-\u{257F}]/gu, '-'], [/\t/g, '    '],
];
/** Les signes de couleur et leurs variantes, ramenés à ceux que le PDF sait dessiner. */
const VERS_SIGNES: Array<[RegExp, string]> = [
  [/[✅☑]\u{FE0F}?/gu, M.oui], [/[❌⛔]\u{FE0F}?/gu, M.non], [/⚠\u{FE0F}?/gu, '(!)'], [/[➜➔➡⮕]\u{FE0F}?/gu, '→'], [/↔\u{FE0F}/gu, '↔'],
  [/🟢/gu, M.vert], [/🔴/gu, M.rouge], [/🟠/gu, M.orange], [/🟡/gu, M.jaune], [/🔵/gu, M.bleu], [/⚪/gu, M.blanc], [/⚫/gu, M.noir],
  [/[◉⬤]/g, '●'], [/◦/g, '○'], [/[▪◼]/g, '■'], [/[▫◻]/g, '□'], [/[‣⁃]/g, '•'], [/≥/g, '>='], [/≤/g, '<='], [/≠/g, '!='], [/≈/g, '~'], [/★/g, '*'],
];
/** Dans un journal (largeur fixe), les mêmes signes s'écrivent en lettres : chaque caractère garde la même largeur. */
const EN_LETTRES: Array<[RegExp, string]> = [
  [/[→➜➔➡⮕]\u{FE0F}?/gu, '->'], [/←/g, '<-'], [/↔\u{FE0F}?/gu, '<->'], [/⇒/g, '=>'], [/↑/g, '^'], [/↓/g, 'v'], [/[✓✔✅☑]\u{FE0F}?/gu, '[ok]'], [/[✗✘✖✕❌⛔]\u{FE0F}?/gu, '[x]'], [/⚠\u{FE0F}?/gu, '(!)'],
  [/🟢/gu, '(vert)'], [/🔴/gu, '(rouge)'], [/🟠/gu, '(orange)'], [/🟡/gu, '(jaune)'], [/🔵/gu, '(bleu)'], [/⚪/gu, '(blanc)'], [/⚫/gu, '(noir)'],
  [/[●○◉◦■□▪▫‣⁃◆★▲▼]/g, '*'], [/≥/g, '>='], [/≤/g, '<='], [/≠/g, '!='], [/≈/g, '~'],
];
/** Ramène un texte aux caractères que le PDF sait écrire (`fixe` : pour un journal à largeur fixe). Pur. */
export function latin(t: string, fixe = false): string {
  if (!/[^\n\u{20}-\u{7E}\u{A0}-\u{FF}]/u.test(t)) return t;
  let s = t;
  for (const [re, par] of PARTOUT) s = s.replace(re, par);
  for (const [re, par] of fixe ? EN_LETTRES : VERS_SIGNES) s = s.replace(re, par);
  // les autres pictogrammes : retirés (avec leurs signes de liaison et l'espace qui les suit)
  s = s.replace(/(?:[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}])+ ?/gu, (m) => ([...m].every((ch) => ecrit(ch) || ch === ' ' || (!fixe && SIGNES[ch] !== undefined)) ? m : ''));
  return [...s].map((ch) => (ch === '\n' || ecrit(ch) || (!fixe && SIGNES[ch] !== undefined) ? ch : '?')).join('');
}
/** Le texte d'une chaîne PDF (parenthèses et barre oblique inverse protégées). */
function chaine(t: string): string {
  let out = '';
  for (let i = 0; i < t.length; i++) { const ch = t[i], b = CP1252[ch] ?? t.charCodeAt(i), s = String.fromCharCode(b < 256 ? b : 63); out += s === '(' || s === ')' || s === '\\' ? `\\${s}` : s; }
  return out;
}
const f = (n: number) => { const s = n.toFixed(2); return s.endsWith('.00') ? s.slice(0, -3) : s; };
const rvb = (c: Rvb) => `${f(c[0])} ${f(c[1])} ${f(c[2])}`;

/** Coupe un texte en lignes qui tiennent dans `max` points ; un mot trop long est coupé au caractère. Pur. */
export function couper(t: string, max: number, taille: number, police: Police = 'F1'): string[] {
  const out: string[] = [];
  for (const brut of t.split('\n')) {
    let cur = '';
    for (const mot of brut.split(/ +/)) {
      if (!mot) continue;
      const essai = cur ? `${cur} ${mot}` : mot;
      if (largeur(essai, taille, police) <= max) { cur = essai; continue; }
      if (cur) { out.push(cur); cur = ''; }
      let reste = mot;
      while (largeur(reste, taille, police) > max && reste.length > 1) {
        let k = 1; while (k < reste.length && largeur(reste.slice(0, k + 1), taille, police) <= max) k++;
        out.push(reste.slice(0, k)); reste = reste.slice(k);
      }
      cur = reste;
    }
    out.push(cur);
  }
  return out;
}
/** Raccourcit un texte d'une ligne pour qu'il tienne (avec « … »). Pur. */
function tenir(t: string, max: number, taille: number, police: Police = 'F1'): string {
  const un = t.replace(/\s*\n\s*/g, ' ');
  if (largeur(un, taille, police) <= max + 0.01) return un;
  let k = un.length; while (k > 0 && largeur(`${un.slice(0, k)}…`, taille, police) > max) k--;
  return `${un.slice(0, k).trimEnd()}…`;
}

/** Les ordres PDF qui dessinent un signe (trait, forme pleine ou rond) à partir de la ligne de base. */
function dessiner(sg: Signe, x: number, y: number, em: number, couleur: Rvb): string {
  const c = rvb(sg.couleur ?? couleur), P = (p: Pt) => `${f(x + p[0] * em)} ${f(y + p[1] * em)}`, out: string[] = [];
  for (const poly of sg.pleins ?? []) out.push(`${c} rg ${poly.map((p, i) => `${P(p)} ${i ? 'l' : 'm'}`).join(' ')} h f`);
  for (const t of sg.traits ?? []) out.push(`${f((sg.ep ?? 0.1) * em)} w 1 J 1 j ${c} RG ${t.map((p, i) => `${P(p)} ${i ? 'l' : 'm'}`).join(' ')} S`);
  if (sg.rond) {
    const r = sg.rond.r * em, k = r * 0.5523, cx = x + (sg.l / 2000) * em, cy = y + 0.35 * em;
    const cercle = `${f(cx + r)} ${f(cy)} m ${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} c ${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} c ${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)} c ${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} c h`;
    out.push(sg.rond.plein ? `${c} rg ${cercle} f` : `${f(0.08 * em)} w ${c} RG ${cercle} S`);
  }
  return out.join(' ');
}
/** Les ordres PDF qui écrivent un texte à un endroit ; les signes sont dessinés à leur place dans la ligne. */
function ecrire(x: number, y: number, t: string, police: Police, taille: number, couleur: Rvb): string {
  const out: string[] = [];
  let suite = '', debut = x, pos = x;
  const pose = () => { if (suite) { out.push(`BT /${police} ${f(taille)} Tf ${rvb(couleur)} rg ${f(debut)} ${f(y)} Td (${chaine(suite)}) Tj ET`); suite = ''; } };
  for (const ch of t) {
    const sg = police === 'F4' ? undefined : SIGNES[ch];
    if (!sg) { if (!suite) debut = pos; suite += ch; pos += largeur(ch, taille, police); continue; }
    pose(); out.push(dessiner(sg, pos, y, taille, couleur)); pos += (sg.l * taille) / 1000;
  }
  pose();
  return out.join('\n');
}

interface Bout { t: string; police: Police; couleur: Rvb }
/** Les pages en cours d'écriture : un curseur qui descend, et un saut de page quand la place manque. */
class Feuille {
  pages: string[][] = [[]];
  y = PH - HAUT;
  private get ops(): string[] { return this.pages[this.pages.length - 1]; }
  saut(): void { this.pages.push([]); this.y = PH - HAUT; }
  /** Garde `h` points d'un seul tenant (sinon passe à la page suivante). */
  place(h: number): void { if (this.y - h < BAS) this.saut(); }
  get haut(): boolean { return this.y >= PH - HAUT - 0.5; }
  mot(x: number, y: number, t: string, police: Police, taille: number, couleur: Rvb = ENCRE): void { if (t) this.ops.push(ecrire(x, y, t, police, taille, couleur)); }
  rect(x: number, y: number, w: number, h: number, fond: Rvb): void { if (w > 0 && h > 0) this.ops.push(`${rvb(fond)} rg ${f(x)} ${f(y)} ${f(w)} ${f(h)} re f`); }
  trait(pts: Array<[number, number]>, couleur: Rvb, ep = 0.5): void { if (pts.length > 1) this.ops.push(`${f(ep)} w 1 J 1 j ${rvb(couleur)} RG ${pts.map(([a, b], i) => `${f(a)} ${f(b)} ${i ? 'l' : 'm'}`).join(' ')} S`); }
  /** Un paragraphe simple, coupé en lignes ; passe à la page suivante ligne par ligne. */
  texte(t: string, o: { police?: Police; taille?: number; couleur?: Rvb; retrait?: number; apres?: number } = {}): void {
    const police = o.police ?? 'F1', taille = o.taille ?? 10, il = taille * 1.32, x = MG + (o.retrait ?? 0);
    for (const l of couper(latin(t, police === 'F4'), LW - (o.retrait ?? 0), taille, police)) { this.place(il); this.mot(x, this.y - taille * 0.95, l, police, taille, o.couleur ?? ENCRE); this.y -= il; }
    this.y -= o.apres ?? 0;
  }
  /** Un paragraphe où le style change en cours de ligne (titre en gras, détail, note grise), avec une puce ou un numéro. */
  riche(bouts: Bout[], o: { taille?: number; retrait?: number; puce?: string; apres?: number } = {}): void {
    const taille = o.taille ?? 10, il = taille * 1.32, retrait = o.retrait ?? 0, max = LW - retrait;
    const lignes: Array<Array<Bout & { x: number }>> = [[]];
    let x = 0, espace = false;
    const nouvelle = () => { lignes.push([]); x = 0; espace = false; };
    for (const b of bouts) {
      for (const mot of latin(b.t).split(/(\s+)/)) {
        if (!mot) continue;
        if (/^\s+$/.test(mot)) { if (mot.includes('\n')) nouvelle(); else espace = x > 0; continue; }
        let reste = mot;
        while (reste) {
          const ligne = lignes[lignes.length - 1], blanc = espace && x > 0 ? largeur(' ', taille, b.police) : 0, lw = largeur(reste, taille, b.police);
          if (x + blanc + lw <= max) {
            const dernier = ligne[ligne.length - 1];
            if (dernier && dernier.police === b.police && dernier.couleur === b.couleur) dernier.t += (blanc ? ' ' : '') + reste; else ligne.push({ t: reste, police: b.police, couleur: b.couleur, x: x + blanc });
            x += blanc + lw; reste = ''; espace = false;
          } else if (x > 0) nouvelle();
          else { let k = 1; while (k < reste.length && largeur(reste.slice(0, k + 1), taille, b.police) <= max) k++; ligne.push({ t: reste.slice(0, k), police: b.police, couleur: b.couleur, x: 0 }); reste = reste.slice(k); nouvelle(); }
        }
      }
    }
    lignes.filter((l, i) => l.length || i === 0).forEach((l, i) => {
      this.place(il);
      if (i === 0 && o.puce) this.mot(MG + retrait - largeur(o.puce, taille, 'F1') - 5, this.y - taille * 0.95, o.puce, 'F1', taille, GRIS);
      for (const b of l) this.mot(MG + retrait + b.x, this.y - taille * 0.95, b.t, b.police, taille, b.couleur);
      this.y -= il;
    });
    this.y -= o.apres ?? 0;
  }
}

/** Le plus long mot d'un texte, en points. */
const plusLongMot = (t: string, taille: number, police: Police) => Math.max(0, ...t.split(/\s+/).map((m) => largeur(m, taille, police)));
/** Largeurs des colonnes d'un tableau : chacune a au moins la place de son plus long mot (jusqu'à une limite), le reste est partagé selon le contenu. */
export function colonnes(tetes: string[], lignes: string[][], taille: number, total = LW, pad = 3): number[] {
  const n = Math.max(1, tetes.length), ech = lignes.length > 300 ? lignes.slice(0, 300) : lignes;
  const nat = Array.from({ length: n }, (_v, j) => Math.max(largeur(tetes[j] ?? '', taille, 'F2'), ...ech.map((l) => Math.min(280, Math.max(...(l[j] ?? '').split('\n').map((x) => largeur(x, taille, 'F1')))))) + 2 * pad + 1);
  const min = Array.from({ length: n }, (_v, j) => Math.min(nat[j], Math.max(24, Math.min(88, Math.max(plusLongMot(tetes[j] ?? '', taille, 'F2'), ...ech.map((l) => plusLongMot(l[j] ?? '', taille, 'F1')))) + 2 * pad + 1)));
  const sn = nat.reduce((a, b) => a + b, 0), sm = min.reduce((a, b) => a + b, 0);
  if (sn <= total) return nat.map((v) => (v / sn) * total);
  if (sm >= total) return min.map((v) => (v / sm) * total);
  return min.map((v, j) => v + ((nat[j] - v) / (sn - sm)) * (total - sm));
}

function tableau(fe: Feuille, tetes: string[], lignes: Array<{ cells: string[]; tone?: Tone }>): void {
  const n = tetes.length, taille = n >= 10 ? 6.5 : n >= 7 ? 7.5 : 8.5, pad = 3, il = taille * 1.25;
  const T = tetes.map((t) => latin(t)), L = lignes.map((r) => ({ tone: r.tone, cells: T.map((_t, j) => latin(r.cells[j] ?? '')) }));
  const w = colonnes(T, L.map((r) => r.cells), taille), x0 = [MG]; for (let j = 0; j < n - 1; j++) x0.push(x0[j] + w[j]);
  const tete = () => {
    const c = T.map((t, j) => couper(t, w[j] - 2 * pad, taille, 'F2')), h = Math.max(...c.map((l) => l.length)) * il + 2 * pad;
    fe.rect(MG, fe.y - h, LW, h, TETE);
    c.forEach((l, j) => l.forEach((t, i) => fe.mot(x0[j] + pad, fe.y - pad - taille * 0.8 - i * il, t, 'F2', taille)));
    fe.y -= h; fe.trait([[MG, fe.y], [MG + LW, fe.y]], TRAIT, 0.6);
  };
  fe.place(il * 3 + 4 * pad); tete();
  for (const r of L) {
    const c = r.cells.map((t, j) => { const l = couper(t, w[j] - 2 * pad, taille, 'F1'); return l.length > 40 ? [...l.slice(0, 39), '…'] : l; }), h = Math.max(1, ...c.map((l) => l.length)) * il + 2 * pad;
    if (fe.y - h < BAS) { fe.saut(); tete(); }
    const couleur = encre(r.tone);
    c.forEach((l, j) => l.forEach((t, i) => fe.mot(x0[j] + pad, fe.y - pad - taille * 0.8 - i * il, t, 'F1', taille, couleur)));
    fe.y -= h; fe.trait([[MG, fe.y], [MG + LW, fe.y]], TRAIT, 0.4);
  }
  fe.y -= 6;
}

function tuiles(fe: Feuille, p: PageExport): void {
  const par = Math.min(4, p.kpis.length), ecart = 8, lw = (LW - (par - 1) * ecart) / par, h = 42;
  for (let i = 0; i < p.kpis.length; i += par) {
    fe.place(h + ecart);
    p.kpis.slice(i, i + par).forEach((k, j) => {
      const x = MG + j * (lw + ecart), valeur = latin(k.value);
      fe.rect(x, fe.y - h, lw, h, FOND);
      fe.mot(x + 8, fe.y - 14, tenir(latin(k.label), lw - 16, 8), 'F1', 8, GRIS);
      let t = 13; while (t > 8 && largeur(valeur.replace(/\n/g, ' '), t, 'F2') > lw - 16) t -= 0.5;
      fe.mot(x + 8, fe.y - 31, tenir(valeur, lw - 16, t, 'F2'), 'F2', t, encre(k.tone));
      if (k.pct !== undefined) { fe.rect(x + 8, fe.y - h + 4, lw - 16, 2, TRAIT); fe.rect(x + 8, fe.y - h + 4, ((lw - 16) * k.pct) / 100, 2, k.tone ? encre(k.tone) : BLEU); }
    });
    fe.y -= h + ecart;
  }
  fe.y -= 2;
}

function barres(fe: Feuille, s: Extract<SectionExport, { kind: 'bars' }>): void {
  const taille = 8.5, il = 14, max = Math.max(1, ...s.items.map((i) => i.value));
  const noms = s.items.map((i) => latin(i.label)), vals = s.items.map((i) => latin(i.display ?? nombreFr(i.value)));
  const wNom = Math.min(LW * 0.42, Math.max(40, ...noms.map((t) => largeur(t, taille)))) + 8, wVal = Math.min(LW * 0.3, Math.max(20, ...vals.map((t) => largeur(t, taille, 'F2')))) + 8, wBarre = LW - wNom - wVal;
  s.items.forEach((it, i) => {
    fe.place(il);
    fe.mot(MG, fe.y - 10, tenir(noms[i], wNom - 8, taille), 'F1', taille);
    fe.rect(MG + wNom, fe.y - 11, wBarre, 7, FOND); fe.rect(MG + wNom, fe.y - 11, Math.max(0, (wBarre * it.value) / max), 7, BLEU);
    const v = tenir(vals[i], wVal - 8, taille, 'F2'); fe.mot(MG + LW - largeur(v, taille, 'F2'), fe.y - 10, v, 'F2', taille);
    fe.y -= il;
  });
  fe.y -= 6;
}

function courbe(fe: Feuille, s: Extract<SectionExport, { kind: 'courbe' }>): void {
  const H = 132, gauche = 40, bas = 16, n = Math.max(2, s.labels.length), max = Math.max(1, ...s.series.flatMap((x) => x.points));
  fe.place(H + 30);
  const x0 = MG + gauche, y0 = fe.y - H + bas, w = LW - gauche - 4, h = H - bas - 8;
  const X = (i: number) => x0 + (i * w) / (n - 1), Y = (v: number) => y0 + (Math.max(0, v) / max) * h;
  const dit = (v: number) => latin(s.unit ? `${v >= 100 ? Math.round(v) : nombreFr(Math.round(v * 10) / 10)} ${s.unit}` : nombreFr(Math.round(v * 10) / 10));
  for (const k of [0, 0.5, 1]) { fe.trait([[x0, Y(max * k)], [x0 + w, Y(max * k)]], TRAIT, k ? 0.3 : 0.6); const t = tenir(dit(max * k), gauche - 4, 7); fe.mot(x0 - 4 - largeur(t, 7), Y(max * k) - 2.5, t, 'F1', 7, GRIS); }
  const pas = Math.max(1, Math.ceil(s.labels.length / 6));
  s.labels.forEach((l, i) => { if (i % pas === 0) { const t = tenir(latin(l), w / 6, 7); fe.mot(Math.max(MG, Math.min(X(i) - largeur(t, 7) / 2, MG + LW - largeur(t, 7))), y0 - 10, t, 'F1', 7, GRIS); } });
  const couleur = (i: number): Rvb => { const t = s.series[i].tone; return (t && TON[t]) || PALETTE[i % PALETTE.length]; };
  s.series.forEach((x, i) => fe.trait(x.points.slice(0, n).map((v, k) => [X(k), Y(v)] as [number, number]), couleur(i), 1.3));
  fe.y -= H + 2;
  // la légende : un carré de couleur, le nom, la dernière valeur
  let x = MG; fe.place(12);
  s.series.forEach((se, i) => {
    const t = latin(`${se.name} : ${dit(se.points.at(-1) ?? 0)}`), lw = largeur(t, 8) + 22;
    if (x + lw > MG + LW && x > MG) { x = MG; fe.y -= 12; fe.place(12); }
    fe.rect(x, fe.y - 9, 7, 7, couleur(i)); fe.mot(x + 11, fe.y - 9, t, 'F1', 8); x += lw;
  });
  fe.y -= 18;
}

function section(fe: Feuille, s: SectionExport, taille: number): void {
  if (!fe.haut) fe.y -= 10;
  fe.place(taille * 1.4 + 34);
  fe.texte(s.title || 'Sans titre', { police: 'F2', taille, apres: 4 });
  const rien = vide(s);
  if (rien) { fe.texte(rien, { police: 'F3', taille: 9.5, couleur: GRIS, apres: 4 }); return; }
  switch (s.kind) {
    case 'table': tableau(fe, s.columns, s.rows); break;
    case 'list': for (const i of s.items) fe.riche([{ t: i.title, police: 'F2', couleur: encre(i.tone) }, ...(i.detail ? [{ t: ` — ${i.detail}`, police: 'F1' as Police, couleur: encre(i.tone) }] : []), ...(i.meta ? [{ t: ` (${i.meta})`, police: 'F1' as Police, couleur: GRIS }] : [])], { taille: 9.5, retrait: 14, puce: '•', apres: 2 }); fe.y -= 4; break;
    case 'cards': for (const c of s.items) fe.riche([{ t: c.title, police: 'F2', couleur: encre(c.tone) }, ...[c.sub, c.badge, c.meta].filter(Boolean).map((t) => ({ t: ` — ${t}`, police: 'F1' as Police, couleur: encre(c.tone) })), ...(c.progress !== undefined ? [{ t: ` — ${Math.round(c.progress * 100)} %`, police: 'F1' as Police, couleur: GRIS }] : [])], { taille: 9.5, retrait: 14, puce: '•', apres: 2 }); fe.y -= 4; break;
    case 'log': {
      const taille2 = 7.2, il = taille2 * 1.3, parLigne = Math.floor((LW - 12) / (0.6 * taille2));
      for (const brut of s.lines) {
        const l = latin(brut, true);
        for (let k = 0; k === 0 || k < l.length; k += parLigne) { fe.place(il); fe.rect(MG, fe.y - il, LW, il, FOND); fe.mot(MG + 6, fe.y - taille2 * 0.98, l.slice(k, k + parLigne), 'F4', taille2); fe.y -= il; }
      }
      fe.y -= 6; break;
    }
    case 'text': fe.texte(s.text, { taille: 10, couleur: encre(s.tone), apres: 4 }); break;
    case 'bars': barres(fe, s); break;
    case 'courbe': courbe(fe, s); break;
    case 'steps': s.items.forEach((i, n) => fe.riche([{ t: i.title, police: 'F2', couleur: ENCRE }, ...(i.detail ? [{ t: ` — ${i.detail}`, police: 'F1' as Police, couleur: ENCRE }] : []), { t: i.done ? '  (fait)' : '  (à faire)', police: 'F1', couleur: i.done ? TON.bon : GRIS }], { taille: 9.5, retrait: 18, puce: `${n + 1}.`, apres: 2 })); fe.y -= 4; break;
    case 'graph':
      fe.texte(`${s.nodes.length} point${s.nodes.length > 1 ? 's' : ''}, ${s.edges.length} lien${s.edges.length > 1 ? 's' : ''}${s.period ? ` · ${s.period}` : ''}`, { police: 'F3', taille: 9, couleur: GRIS, apres: 3 });
      tableau(fe, ['Point', 'Détail', 'Fiche', 'Relié à'], s.nodes.map((n) => ({ cells: [n.label, n.sub ?? '', fiche(s, n.id), voisins(s, n.id)] })));
      break;
  }
}

/** Un texte d'information du PDF (titre…) : en UTF-16, pour garder tous les caractères. */
const info = (t: string) => `<FEFF${[...t].flatMap((ch) => { const c = ch.codePointAt(0)!; if (c < 0x10000) return [c]; const v = c - 0x10000; return [0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)]; }).map((u) => u.toString(16).toUpperCase().padStart(4, '0')).join('')}>`;

/** La page en PDF (A4). Pur. */
export function enPdf(p: PageExport): Buffer {
  const fe = new Feuille();
  fe.texte(p.app.name, { police: 'F2', taille: 22, apres: 4 });
  fe.texte(p.app.what, { police: 'F3', taille: 10, couleur: GRIS, apres: 3 });
  fe.texte(provenance(p), { taille: 8.5, couleur: GRIS, apres: 6 });
  if (p.subtitle) fe.texte(p.subtitle, { police: 'F2', taille: 10.5, apres: 6 });
  if (p.kpis.length) { fe.y -= 6; fe.place(80); fe.texte('Chiffres clés', { police: 'F2', taille: 13.5, apres: 5 }); tuiles(fe, p); }
  for (const g of groupes(p)) {
    if (g.onglet) { if (!fe.haut) fe.y -= 12; fe.place(70); fe.texte(g.onglet, { police: 'F2', taille: 15, apres: 2 }); fe.trait([[MG, fe.y], [MG + LW, fe.y]], TRAIT, 0.8); fe.y -= 2; }
    for (const s of g.sections) section(fe, s, g.onglet ? 11.5 : 13.5);
  }
  if (!p.kpis.length && !p.sections.length) fe.texte('Cette page n\'a rien à montrer pour l\'instant.', { police: 'F3', couleur: GRIS });
  const notes = manques(p);
  if (notes.length) { fe.y -= 10; for (const n of notes) fe.texte(n, { police: 'F3', taille: 8.5, couleur: GRIS, apres: 2 }); }

  // Pied de page : d'où vient la copie, et le numéro de page.
  const total = fe.pages.length, pied = tenir(latin(provenance(p)), LW - 60, 7.5);
  const contenus = fe.pages.map((ops, i) => { const num = `${i + 1} / ${total}`; return [...ops, ecrire(MG, 32, pied, 'F1', 7.5, GRIS), ecrire(MG + LW - largeur(num, 7.5), 32, num, 'F1', 7.5, GRIS)].join('\n'); });

  const objs: Buffer[] = [];   // objs[i] : le corps de l'objet numéro i + 1
  const police = (nom: string) => Buffer.from(`<< /Type /Font /Subtype /Type1 /BaseFont /${nom} /Encoding /WinAnsiEncoding >>`, 'latin1');
  const premier = 7;   // 1 catalogue, 2 pages, 3 à 6 polices, puis deux objets par page
  objs[0] = Buffer.from('<< /Type /Catalog /Pages 2 0 R /Lang (fr-FR) /ViewerPreferences << /DisplayDocTitle true >> >>', 'latin1');
  objs[1] = Buffer.from(`<< /Type /Pages /Kids [${contenus.map((_c, i) => `${premier + i * 2} 0 R`).join(' ')}] /Count ${total} >>`, 'latin1');
  objs[2] = police('Helvetica'); objs[3] = police('Helvetica-Bold'); objs[4] = police('Helvetica-Oblique'); objs[5] = police('Courier');
  contenus.forEach((c, i) => {
    const flux = deflateSync(Buffer.from(c, 'latin1'));
    objs[premier - 1 + i * 2] = Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ${premier + 1 + i * 2} 0 R >>`, 'latin1');
    objs[premier + i * 2] = Buffer.concat([Buffer.from(`<< /Length ${flux.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), flux, Buffer.from('\nendstream', 'latin1')]);
  });
  const quand = new Date(p.at).toISOString().replace(/[-:T]/g, '').slice(0, 14);
  objs.push(Buffer.from(`<< /Title ${info(`${p.app.name}${p.onglet ? ` · ${p.onglet}` : ''}`)} /Creator (Odin) /Producer (Odin) /CreationDate (D:${quand}Z) >>`, 'latin1'));
  const morceaux: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')], places: number[] = [];
  let pos = morceaux[0].length;
  objs.forEach((o, i) => { const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), o, Buffer.from('\nendobj\n', 'latin1')]); places.push(pos); pos += b.length; morceaux.push(b); });
  morceaux.push(Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${places.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${pos}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(morceaux);
}
