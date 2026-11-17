// Fabrique les PROFILS DE LANGUE d'Odin (des données : `src/langue/profils.json`) à partir d'un fichier de phrases
// étiquetées par langue, et MESURE la justesse sur des phrases mises de côté (jamais vues à la fabrication).
//
//   node --disable-warning=ExperimentalWarning src/langue/fabriquer-profils.ts <sentences.csv> [--sortie src/langue/profils.json]
//        [--mesure <rapport.json>] [--min 300] [--max 3000] [--essai 200] [--k 300] [--sauf code,code,…]
// Fabrication du 17/11/2026 : --k 600 --min 100 --max 4000 --sauf <langues construites et anciennes : voir `exclues` dans profils.json>
//
// Le fichier attendu : une phrase par ligne, « identifiant <TAB> code de langue ISO 639-3 <TAB> phrase » (le format de
// l'export « sentences.csv » de Tatoeba, https://tatoeba.org, publié sous licence CC BY 2.0 FR : les profils, qui sont des
// fréquences tirées de ces phrases, citent leur source). Aucune bibliothèque ni donnée d'un autre détecteur n'est reprise :
// méthode publique des trigrammes de caractères (fréquences, puis vraisemblance), écrite ici.
// Une langue entre dans les profils si elle a au moins `--min` phrases. Ajouter une langue = rejouer ce script sur un
// fichier qui en contient (par exemple les phrases que le propriétaire fournit en shimaoré), jamais du code.

import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { trigrammes } from './trigrammes.ts';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };

export interface Profils {
  source: string;
  licence: string;
  date: string;
  /** Nombre de trigrammes gardés par langue. */
  k: number;
  /** Vraisemblance (log, ×100, arrondie) d'un trigramme absent du profil. */
  plancher: number;
  /**
   * Les langues si proches qu'on les confond souvent sur une phrase (croate, bosnien et serbe ; malais et indonésien ;
   * variétés de chinois, d'arabe, de swahili…), MESURÉES à la fabrication (au moins 15 % de confusion). La confiance se
   * calcule contre la meilleure langue d'un AUTRE groupe : « c'est de l'arabe », même si le dialecte est incertain.
   */
  groupes?: string[][];
  /** Les langues laissées de côté à la fabrication (`--sauf`), pour mémoire. */
  exclues?: string[];
  /** Par langue (code ISO 639-3) : phrases utilisées, et vraisemblance de chacun de ses trigrammes les plus fréquents. */
  langues: Record<string, { phrases: number; tri: Record<string, number> }>;
}

export function fabriquer(parLangue: Map<string, string[]>, k: number, source: string, licence: string): Profils {
  const langues: Profils['langues'] = {};
  let plancher = 0;
  for (const [code, phrases] of parLangue) {
    const compte = new Map<string, number>(); let total = 0;
    for (const p of phrases) for (const t of trigrammes(p)) { compte.set(t, (compte.get(t) ?? 0) + 1); total++; }
    const tri: Record<string, number> = {};
    for (const [t, n] of [...compte.entries()].sort((a, b) => b[1] - a[1]).slice(0, k)) tri[t] = Math.round(Math.log(n / total) * 100);
    const minimum = Math.min(...Object.values(tri));
    plancher = Math.min(plancher, minimum);
    langues[code] = { phrases: phrases.length, tri };
  }
  return { source, licence, date: new Date().toISOString().slice(0, 10), k, plancher: plancher - 150, langues };
}

/** La langue la plus vraisemblable d'un texte d'après les profils, avec l'écart au second (par trigramme). */
export function classer(p: Profils, texte: string): Array<{ code: string; score: number }> {
  const ts = trigrammes(texte);
  if (!ts.length) return [];
  const out: Array<{ code: string; score: number }> = [];
  for (const [code, l] of Object.entries(p.langues)) {
    let s = 0; for (const t of ts) s += l.tri[t] ?? p.plancher;
    out.push({ code, score: s / ts.length });
  }
  return out.sort((a, b) => b.score - a.score);
}

async function main(): Promise<void> {
  const fichier = process.argv[2];
  if (!fichier) { console.error('donne le fichier de phrases (voir l\'en-tête)'); process.exit(2); }
  const min = Number(arg('min', '300')), max = Number(arg('max', '3000')), essai = Number(arg('essai', '200')), k = Number(arg('k', '300'));
  // Langues laissées de côté (codes séparés par des virgules), par exemple les langues construites ou anciennes qu'on ne
  // parle pas à Odin au quotidien : les reconnaître ferait prendre une phrase française courte pour de l'interlingue.
  // La liste est donnée à la fabrication et notée dans le fichier des profils (`exclues`), jamais écrite dans le code.
  const sauf = new Set((arg('sauf', '') ?? '').split(',').map((x) => x.trim()).filter(Boolean));
  const tout = new Map<string, string[]>();
  const rl = createInterface({ input: createReadStream(fichier, 'utf8'), crlfDelay: Infinity });
  for await (const ligne of rl) {
    const [, code, texte] = ligne.split('\t'); if (!code || !texte || code === '\\N') continue;
    const l = tout.get(code) ?? []; if (l.length < max + essai) { l.push(texte); tout.set(code, l); }
  }
  const apprendre = new Map<string, string[]>(), essais = new Map<string, string[]>();
  for (const [code, l] of tout) if (l.length >= min && !sauf.has(code)) {
    // Les phrases d'essai sont prises une sur dix, jamais apprises.
    const e = l.filter((_x, i) => i % 10 === 9).slice(0, essai), a = l.filter((_x, i) => i % 10 !== 9);
    apprendre.set(code, a); essais.set(code, e);
  }
  const profils = fabriquer(apprendre, k, 'Tatoeba (https://tatoeba.org), export « sentences »', 'CC BY 2.0 FR — profils dérivés (fréquences de trigrammes), source citée');
  // Mesure : chaque phrase d'essai, et la même coupée à 20 caractères (une demande courte).
  const par: Record<string, { n: number; juste: number; justeCourt: number; confondue: Record<string, number> }> = {};
  for (const [code, l] of essais) {
    const r = par[code] = { n: 0, juste: 0, justeCourt: 0, confondue: {} as Record<string, number> };
    for (const ph of l) {
      r.n++;
      const a = classer(profils, ph)[0]?.code; if (a === code) r.juste++; else if (a) r.confondue[a] = (r.confondue[a] ?? 0) + 1;
      if (classer(profils, ph.slice(0, 20))[0]?.code === code) r.justeCourt++;
    }
  }
  const n = Object.values(par).reduce((s, x) => s + x.n, 0), j = Object.values(par).reduce((s, x) => s + x.juste, 0), jc = Object.values(par).reduce((s, x) => s + x.justeCourt, 0);
  // Les groupes de langues proches : celles qui se confondent à 15 % au moins (dans un sens ou dans l'autre).
  const parent = new Map<string, string>(), racine = (x: string): string => { const p = parent.get(x) ?? x; return p === x ? x : racine(p); };
  for (const [code, r] of Object.entries(par)) for (const [autre, n] of Object.entries(r.confondue)) if (n / r.n >= 0.15) { const a = racine(code), c = racine(autre); if (a !== c) parent.set(a, c); }
  const groupes = new Map<string, string[]>(); for (const code of Object.keys(profils.langues)) { const r = racine(code); if (r !== code || parent.has(code) || [...parent.values()].includes(code)) groupes.set(r, [...(groupes.get(r) ?? []), code]); }
  profils.groupes = [...groupes.values()].filter((g) => g.length > 1).map((g) => g.sort());
  profils.exclues = [...sauf].sort();
  writeFileSync(arg('sortie', 'src/langue/profils.json')!, JSON.stringify(profils));
  const rapport = { groupes: profils.groupes, langues: Object.keys(profils.langues).length, phrasesEssai: n, justesse: Math.round(j / n * 1000) / 10, justesseCourt: Math.round(jc / n * 1000) / 10, parLangue: par };
  if (arg('mesure')) writeFileSync(arg('mesure')!, JSON.stringify(rapport, null, 1));
  console.log(`${rapport.langues} langues · ${n} phrases d'essai · justesse ${rapport.justesse} % (phrase entière), ${rapport.justesseCourt} % (20 caractères)`);
}

if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/').split('/').pop() ?? '§')) await main();
