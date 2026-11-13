// Acquis : ce qu'Odin a appris à faire sans IA (le « Cerveau direct »).
//
// Quand une IA a résolu une demande par une action, ou par quelques actions à la suite (une « mission » :
// une appli d'Odin, la maison, Venus…), Odin retient « cette phrase → ces actions ». La fois suivante, la
// même demande part sans IA ; et si la phrase portait une valeur (une adresse, un nom, un nombre), la même
// phrase avec une autre valeur marche aussi (« redémarre le conteneur web » appris → « … db » compris).
// Sans IA sous la main, Odin fait aussi le lien avec ce qui ressemble à une demande déjà apprise, et le
// propose (jamais sans ton oui). Chaque acquis a sa note dans le Cerveau, rubrique « Quotidien ».
//
// Garde-fous :
//  - l'action rejouée passe par Heimdall comme n'importe quelle autre (mêmes règles, mêmes accords) ;
//  - rien n'est appris d'une phrase qui dépend du moment ou de la conversation (« demain », « ça »,
//    « le même »), d'une phrase longue, ni d'une action qui porte un secret ;
//  - seule la VALEUR change d'une fois sur l'autre, jamais l'appli ni l'action ;
//  - un acquis qui échoue deux fois est oublié, et « non, pas ça » juste après l'oublie aussi ;
//  - tout est listé (« ce que tu as appris ») et s'oublie d'un mot.
//
// Ce module est pur (aucun accès au disque) : le stockage lui est passé.

export interface Kv { getKv(k: string): string | undefined | null; setKv(k: string, v: string): void }

export type Shape = 'ip' | 'nombre' | 'url' | 'domaine' | 'mot' | 'texte';
/** Une action d'une mission : l'outil, son entrée (valeurs variables remplacées par un repère), et son nom en clair. */
export interface Step { tool: string; input: unknown; label: string }
export interface Acquis {
  id: string;
  /** La phrase d'origine (pour la montrer). */
  phrase: string;
  /** Expression qui reconnaît la phrase (texte replié : minuscules, sans accents). */
  pattern: string;
  tool: string;
  /** Entrée de l'outil ; les valeurs variables y sont remplacées par un repère. */
  input: unknown;
  slots: Array<{ shape: Shape; number?: boolean }>;
  /** En clair : « Sirènes · Bannir une adresse ». */
  label: string;
  at: number;
  uses: number;
  fails: number;
  last: number;
  /** Une mission en plusieurs actions, dans l'ordre (absent pour une seule action : `tool` et `input` suffisent). */
  steps?: Step[];
  /** D'où il vient : une IA l'avait réglé ('ia'), ou tu as confirmé un rapprochement avec un autre acquis ('lien'). */
  origin?: 'ia' | 'lien';
}

const KEY = 'acquis';
const MAX = 300;
/** Une mission retenue compte au plus quatre actions : au-delà, c'est un travail à comprendre, pas un geste à refaire. */
export const MAX_STEPS = 4;
/** Outils dont une action seule peut être rejouée, et les réglages où une valeur peut changer. */
export const LEARNABLE: Record<string, string[]> = { valhalla: ['entree'], ha_call: ['data'], venus: ['quoi', 'ou'], mode_set: [], net_scan: [] };
const SINGLE = new Set(['mode_set', 'net_scan']);

/** Repli caractère par caractère (même longueur que l'original) : minuscules, sans accents. */
export function fold(s: string): string {
  let out = '';
  for (const ch of s) { const f = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); out += f.length === ch.length ? f : ch.length === 1 ? (f[0] ?? ch) : ch; }
  return out.replace(/[’`]/g, "'");
}
/** Phrase nettoyée : espaces simples, sans politesse ni ponctuation de fin. */
export function soft(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
    .replace(/^(?:odin|dis[- ]moi|stp|svp|s'il te pla[iî]t|peux[- ]tu|tu peux|est-ce que tu peux)[\s,:]+/i, '')
    .replace(/[\s,]*(?:stp|svp|s'il te pla[iî]t|merci)?[\s.!?…]*$/i, '').trim();
}

/** Mots qui font dépendre la demande du moment ou de ce qui a été dit avant : rien à apprendre. */
const DEICTIC = /\b(aujourd'hui|demain|apres-demain|hier|avant-hier|ce (soir|matin|midi|week-end)|cette (nuit|semaine|annee)|cet apres-midi|tout a l'heure|tout de suite|maintenant|dans \d+|a \d{1,2}\s?h|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|prochaine?|derniere?|ca|cela|celui|celle|ceux|celles|le meme|la meme|les memes|pareil|idem|encore|aussi|refais|recommence|comme (d'hab|hier|avant|tout a l'heure)|lui|eux|la-bas|ici|premiere?|deuxieme|seconde?|troisieme|suivante?s?|precedente?s?|l'autre|les autres)\b|[a-z]-(?:le|la|les|leur)\b/;
const SECRET = /pass|secret|token|jeton|cle\b|clef|key|pin\b|mdp|credential|authorization/i;

export function shapeOf(v: string): Shape {
  if (/^\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?$/.test(v)) return 'ip';
  if (/^-?\d+(?:[.,]\d+)?$/.test(v)) return 'nombre';
  if (/^https?:\/\/\S+$/i.test(v)) return 'url';
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(v)) return 'domaine';
  if (/^[\p{L}\p{N}_-]+$/u.test(v)) return 'mot';
  return 'texte';
}
const CAPTURE: Record<Shape, string> = {
  ip: '(\\d{1,3}(?:\\.\\d{1,3}){3}(?:/\\d{1,2})?)', nombre: '(-?\\d+(?:[.,]\\d+)?)', url: '(https?://[^\\s"\'<>]+)',
  domaine: '([a-z0-9-]+(?:\\.[a-z0-9-]+)+)', mot: '([\\p{L}\\p{N}_-]+)', texte: '([^\\s].{0,58}?[^\\s]|[^\\s])',
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MARK = (i: number) => `\u0001${i}\u0001`;

type Leaf = { get: () => unknown; set: (v: unknown) => void };
/** Feuilles (texte, nombre) d'une entrée ; un texte qui contient du JSON est ouvert puis refermé. */
function leaves(root: Record<string, unknown>, only: string[]): { list: Leaf[]; close: () => void } {
  const list: Leaf[] = [], closers: Array<() => void> = [];
  const walk = (obj: Record<string, unknown> | unknown[]) => {
    for (const k of Object.keys(obj)) {
      const v = (obj as Record<string, unknown>)[k];
      if (typeof v === 'string' && /^\s*[{[]/.test(v)) {
        try { const inner = JSON.parse(v) as Record<string, unknown>; if (inner && typeof inner === 'object') { closers.push(() => { (obj as Record<string, unknown>)[k] = JSON.stringify(inner); }); walk(inner); continue; } } catch { /* pas du JSON : un texte ordinaire */ }
      }
      if (v && typeof v === 'object') walk(v as Record<string, unknown>);
      else if (typeof v === 'string' || typeof v === 'number') list.push({ get: () => (obj as Record<string, unknown>)[k], set: (x) => { (obj as Record<string, unknown>)[k] = x; } });
    }
  };
  for (const k of only) { const v = root[k]; if (v === undefined) continue; const box: Record<string, unknown> = { [k]: v }; walk(box); closers.push(() => { root[k] = box[k]; }); }
  return { list, close: () => { for (const c of closers) c(); } };
}

export interface LearnInput {
  phrase: string; label: string;
  /** Une seule action… */
  tool?: string; input?: Record<string, unknown>;
  /** … ou une mission : plusieurs actions à la suite (quatre au plus). `out` : ce que l'action a répondu. */
  steps?: Array<{ tool: string; input: Record<string, unknown>; label: string; out?: string }>;
  /** Ce qui s'est dit juste avant dans la discussion : une valeur qui en vient n'est pas apprise. */
  context?: string;
  now?: number; redact?: (t: string) => string;
}
/** Pourquoi une demande ne s'apprend pas (pour les tests et le journal), ou l'acquis à garder. Pur. */
export function learn(l: LearnInput): Acquis | { skip: string } {
  const steps = l.steps?.length ? l.steps : [{ tool: l.tool ?? '', input: l.input ?? {}, label: l.label }];
  if (steps.length > MAX_STEPS) return { skip: 'trop d\'étapes' };
  if (steps.some((s) => !LEARNABLE[s.tool])) return { skip: 'outil non rejouable' };
  if (steps.length > 1) {
    // Deux fois la même action, ou deux réglages d'un état unique (le mode du moment) : l'IA s'est reprise, ce n'est pas une mission.
    if (new Set(steps.map((s) => `${s.tool}|${JSON.stringify(s.input)}`)).size < steps.length) return { skip: 'deux fois la même action' };
    if (steps.filter((s) => SINGLE.has(s.tool)).length > 1) return { skip: 'action corrigée en cours de route' };
  }
  const phrase = soft(l.phrase), f = fold(phrase);
  if (phrase.length < 4 || phrase.length > 140 || phrase.split(' ').length > 20) return { skip: 'phrase trop courte ou trop longue' };
  if (/[\n\r]/.test(l.phrase.trim())) return { skip: 'plusieurs lignes' };
  if (DEICTIC.test(f)) return { skip: 'dépend du moment ou de la conversation' };
  const raws = steps.map((s) => JSON.stringify(s.input)), raw = raws.join('\n');
  if (raws.some((r) => r.length > 800)) return { skip: 'action trop grosse' };
  if (SECRET.test(raw) || SECRET.test(f)) return { skip: 'peut porter un secret' };
  if (l.redact && (l.redact(phrase) !== phrase || l.redact(raw) !== raw)) return { skip: 'contient un secret connu' };

  const inputs = raws.map((r) => JSON.parse(r) as Record<string, unknown>);
  const opened = inputs.map((input, k) => leaves(input, LEARNABLE[steps[k].tool]));
  const list = opened.flatMap((o) => o.list);
  // Une valeur que tu n'as pas dite, mais qui vient du résultat d'une action d'avant ou de la discussion, dépend
  // du moment (« bannis l'adresse qui attaque », « arrête le conteneur » juste après en avoir parlé) : rien à retenir.
  const said = (v: string, where: string) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(v)}(?![\\p{L}\\p{N}])`, 'u').test(where);
  const ctx = fold(l.context ?? '');
  for (let k = 0; k < opened.length; k++) {
    const before = fold(steps.slice(0, k).map((s) => s.out ?? '').join('\n'));
    for (const leaf of opened[k].list) {
      const v = fold(String(leaf.get()).trim()); if (v.length < 3 || said(v, f)) continue;
      if (before && said(v, before)) return { skip: 'dépend du résultat d\'une action précédente' };
      if (ctx && said(v, ctx)) return { skip: 'valeur reprise de la discussion' };
    }
  }
  // Les valeurs les plus longues d'abord (« 192.168.1.20 » avant « 20 »), sans chevauchement ; trois au plus.
  // La même valeur dans deux actions (le même nom, la même adresse) partage le même repère : elle changera partout à la fois.
  const found: Array<{ a: number; b: number; leaves: Leaf[]; shape: Shape; number: boolean }> = [];
  const cands = list.map((leaf) => ({ leaf, text: String(leaf.get()).trim() })).filter((c) => c.text.length >= 1 && c.text.length <= 80).sort((x, y) => y.text.length - x.text.length);
  for (const c of cands) {
    const v = fold(c.text); if (v.length < 2 && !/^\d$/.test(v)) continue;
    const m = new RegExp(`(?<![\\p{L}\\p{N}])${esc(v)}(?![\\p{L}\\p{N}])`, 'u').exec(f);
    if (!m) continue;
    const a = m.index, b = a + v.length, twin = found.find((s) => s.a === a && s.b === b);
    if (twin) { twin.leaves.push(c.leaf); continue; }
    if (found.length >= 3 || found.some((s) => a < s.b && b > s.a)) continue;
    const shape = shapeOf(c.text);
    if (shape === 'texte' && c.text.split(/\s+/).length > 6) continue;
    found.push({ a, b, leaves: [c.leaf], shape, number: typeof c.leaf.get() === 'number' });
  }
  // Les repères sont numérotés dans l'ordre où les valeurs apparaissent dans la phrase.
  found.sort((x, y) => x.a - y.a);
  const slots: Acquis['slots'] = found.map((s) => ({ shape: s.shape, ...(s.number ? { number: true } : {}) }));
  found.forEach((s, k) => { for (const leaf of s.leaves) leaf.set(MARK(k)); });
  for (const o of opened) o.close();
  // La phrase doit garder des mots fixes (au moins un verbe ou un nom) : sinon tout ressemblerait à tout.
  let pattern = '', at = 0; const fixed: string[] = [];
  for (const s of found) { fixed.push(f.slice(at, s.a)); pattern += esc(f.slice(at, s.a)) + CAPTURE[s.shape]; at = s.b; }
  fixed.push(f.slice(at)); pattern += esc(f.slice(at));
  if (fixed.join(' ').replace(/[^\p{L}]/gu, '').length < 4) return { skip: 'pas assez de mots fixes' };
  const now = l.now ?? Date.now(), many = steps.length > 1;
  return {
    id: idOf(`${steps.map((s) => s.tool).join('+')}|${pattern}`), phrase, pattern: `^${pattern}$`, tool: steps[0].tool, input: inputs[0], slots,
    label: many ? steps.map((s) => s.label).join(' → ') : steps[0].label || l.label, at: now, uses: 0, fails: 0, last: now, origin: 'ia',
    ...(many ? { steps: steps.map((s, k) => ({ tool: s.tool, input: inputs[k], label: s.label })) } : {}),
  };
}
function idOf(s: string): string { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return `a${(h >>> 0).toString(36).padStart(6, '0')}`; }

/** Les actions d'un acquis, dans l'ordre (une seule le plus souvent). */
export const stepsOf = (a: Acquis): Step[] => (a.steps?.length ? a.steps : [{ tool: a.tool, input: a.input, label: a.label }]);

/** Remet les valeurs à la place des repères. Le JSON rangé dans un texte (« entree » des applis) est rouvert, rempli, refermé. */
function fillInput(template: unknown, slots: Acquis['slots'], values: string[]): Record<string, unknown> {
  const fill = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const whole = /^\u0001(\d+)\u0001$/.exec(v);
      if (whole) { const k = Number(whole[1]); return slots[k]?.number ? Number(values[k].replace(',', '.')) : values[k]; }
      return v;
    }
    if (Array.isArray(v)) return v.map(fill);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, fill(x)]));
    return v;
  };
  return Object.fromEntries(Object.entries((template ?? {}) as Record<string, unknown>).map(([k, v]) => {
    if (typeof v === 'string' && /^\s*[{[]/.test(v)) { try { return [k, JSON.stringify(fill(JSON.parse(v)))]; } catch { /* texte ordinaire */ } }
    return [k, fill(v)];
  }));
}

/** L'acquis qui reconnaît cette phrase, avec les actions à rejouer. Les phrases exactes passent avant les phrases à valeur. Pur. */
export function match(list: Acquis[], text: string): { a: Acquis; input: Record<string, unknown>; values: string[]; steps: Array<{ tool: string; input: Record<string, unknown>; label: string }> } | undefined {
  const phrase = soft(text); if (!phrase || phrase.length > 160) return undefined;
  const f = fold(phrase);
  const sorted = [...list].sort((x, y) => x.slots.length - y.slots.length || y.pattern.length - x.pattern.length);
  for (const a of sorted) {
    let m: RegExpExecArray | null; try { m = new RegExp(a.pattern, 'ud').exec(f); } catch { continue; }
    if (!m) continue;
    // Les valeurs sont reprises dans la phrase d'origine (majuscules et accents gardés).
    const values = a.slots.map((_s, i) => { const span = m!.indices?.[i + 1]; return span ? phrase.slice(span[0], span[1]) : (m![i + 1] ?? ''); });
    if (values.some((v, i) => !v || shapeOf(v) !== a.slots[i].shape && !(a.slots[i].shape === 'texte') || DEICTIC.test(fold(v)) || /^(le|la|les|un|une|des|du|de|tout|tous|toutes|rien)$/.test(fold(v)))) continue;
    if (a.slots.some((s, i) => s.shape === 'ip' && values[i].split('/')[0].split('.').some((o) => Number(o) > 255))) continue;
    const steps = stepsOf(a).map((s) => ({ tool: s.tool, label: s.label, input: fillInput(s.input, a.slots, values) }));
    return { a, input: steps[0].input, values, steps };
  }
  return undefined;
}

// ---------------- Faire le lien : ce qui ressemble à une demande déjà apprise ----------------

/** La mission d'un acquis : deux façons de le dire qui mènent aux mêmes actions ont la même. */
export const missionOf = (a: Acquis): string => `m${idOf(JSON.stringify(stepsOf(a).map((s) => [s.tool, s.input]))).slice(1)}`;

// Petits mots sans poids (articles, politesse, « fais », « je voudrais », « maintenant »). N'y figurent ni « pas », « plus »,
// « sans », « sauf » (ils retournent le sens), ni « ou », « tout », ni les vrais verbes d'action (« lance », « montre », « mets »).
const SMALL = new Set('le la les l un une des du de d au aux a et en dans sur pour par avec ce cet cette ces mon ma mes ton ta tes son sa ses moi me toi te je j tu il elle on nous vous que qu qui stp svp merci odin peux veux voudrais aimerais faut vais vas va est es suis bien fais faire fait faites bonjour salut coucou alors donc juste maintenant'.split(' '));
const root = (w: string) => (w.length > 4 ? w.replace(/(?:es|er|ez|e|s|x)$/, '') : w);
/** Les mots qui portent le sens d'une phrase : racine → mot tel qu'il est écrit (sans les petits mots). Pur. */
export function meaningWords(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const w of soft(text).split(/[^\p{L}\p{N}]+/u)) { const f = fold(w); if ((f.length > 1 || /\d/.test(f)) && !SMALL.has(f) && !out.has(root(f))) out.set(root(f), w.toLowerCase()); }
  return out;
}
export const meaning = (text: string): Set<string> => new Set(meaningWords(text).keys());
/** Les mots de sens d'un acquis, sans ses valeurs variables. Pur. */
export function wordsOf(a: Acquis): Map<string, string> {
  let p = soft(a.phrase);
  if (a.slots.length) {
    try { const m = new RegExp(a.pattern, 'ud').exec(fold(p)); for (let i = a.slots.length; m?.indices && i >= 1; i--) { const s = m.indices[i]; if (s) p = `${p.slice(0, s[0])} ${p.slice(s[1])}`; } } catch { /* expression illisible : la phrase entière */ }
  }
  return meaningWords(p);
}

/** Deux mots qu'Odin a reliés : deux façons de dire la même mission ne différaient que par eux. */
export interface WordLink { a: string; b: string; said: [string, string]; n: number; at: number }
const LINKS = 'acquis-liens';
export function loadLinks(kv: Kv): WordLink[] { try { const l = JSON.parse(kv.getKv(LINKS) ?? '[]') as WordLink[]; return Array.isArray(l) ? l : []; } catch { return []; } }
/** Le mot qui change entre deux façons de dire la même chose, quand il n'y en a qu'UN de chaque côté (sinon, rien de sûr). Pur. */
export function swapOf(x: Map<string, string>, y: Map<string, string>): { a: string; b: string; said: [string, string] } | undefined {
  const dx = [...x.keys()].filter((w) => !y.has(w)), dy = [...y.keys()].filter((w) => !x.has(w));
  if (dx.length !== 1 || dy.length !== 1 || /\d/.test(dx[0] + dy[0])) return undefined;
  const [a, b] = [dx[0], dy[0]].sort(), sa = x.get(a) ?? y.get(a) ?? a, sb = x.get(b) ?? y.get(b) ?? b;
  return { a, b, said: [sa, sb] };
}
/** Retient le lien entre deux façons de dire la même mission, s'il est net. Rend le lien (pour le dire). */
export function linkWords(kv: Kv, x: Acquis, y: Acquis, now = Date.now()): WordLink | undefined {
  if (missionOf(x) !== missionOf(y)) return undefined;
  const s = swapOf(wordsOf(x), wordsOf(y)); if (!s) return undefined;
  const list = loadLinks(kv), old = list.find((l) => l.a === s.a && l.b === s.b);
  if (old) { old.n++; old.at = now; kv.setKv(LINKS, JSON.stringify(list)); return old; }
  const link: WordLink = { ...s, n: 1, at: now };
  kv.setKv(LINKS, JSON.stringify([link, ...list].slice(0, 200)));
  return link;
}

export interface Near {
  a: Acquis; score: number;
  /** Mots que tu as dits autrement, et que j'ai reliés : « lampe » → « lumière ». */
  via: Array<{ said: string; known: string }>;
  /** Mots de la demande apprise que tu n'as pas dits. */
  unsaid: string[];
}
/**
 * « Réfléchir par les liens » : la demande apprise la plus proche d'une phrase qu'aucun acquis ne reconnaît mot pour mot.
 * Règles (aucune n'est devinée) :
 *  - CHAQUE mot de sens de ta phrase doit être expliqué : par le même mot dans la demande apprise, ou par un mot
 *    qu'Odin a déjà relié à lui (deux façons de dire la même mission). Un mot inconnu (« cuisine » au lieu de
 *    « salon », « éteins » au lieu d'« allume ») et il n'y a pas de rapprochement ;
 *  - au moins deux mots en commun, et six dixièmes de la demande apprise retrouvés ;
 *  - une seule mission possible : deux candidates aussi proches, et rien n'est proposé ;
 *  - seulement parmi les demandes sans valeur variable (une valeur ne se devine pas).
 * C'est une PROPOSITION : rien ne part sans ton oui. Pur.
 */
export function nearest(list: Acquis[], text: string, links: WordLink[] = []): Near | undefined {
  const said = meaningWords(text), B = [...said.keys()]; if (B.length < 2) return undefined;
  const linked = (x: string, y: string) => links.some((l) => (l.a === x && l.b === y) || (l.a === y && l.b === x));
  const scored: Array<Near & { key: string }> = [];
  for (const a of list) {
    if (a.slots.length) continue;
    const known = wordsOf(a), hit = new Set<string>(), via: Near['via'] = []; let sum = 0, ok = true;
    for (const b of B) {
      if (known.has(b)) { sum += 1; hit.add(b); continue; }
      const k = [...known.keys()].find((x) => !hit.has(x) && !said.has(x) && linked(b, x));
      if (!k) { ok = false; break; }
      sum += 0.8; hit.add(k); via.push({ said: said.get(b) ?? b, known: known.get(k) ?? k });
    }
    if (!ok || hit.size < 2) continue;
    const score = sum / Math.max(known.size, 1);
    if (score >= 0.6) scored.push({ a, score, via, unsaid: [...known.keys()].filter((x) => !hit.has(x)).map((x) => known.get(x) ?? x), key: missionOf(a) });
  }
  scored.sort((p, q) => q.score - p.score || q.a.uses - p.a.uses || p.a.at - q.a.at);
  if (!scored.length) return undefined;
  const rival = scored.find((s) => s.key !== scored[0].key);
  if (rival && scored[0].score - rival.score < 0.15) return undefined;
  const { key: _k, ...best } = scored[0];
  return best;
}
/** Une autre façon de dire un acquis (confirmée par toi) : la nouvelle phrase mène aux mêmes actions. Pur. */
export function alias(a: Acquis, phrase: string, now = Date.now()): Acquis | undefined {
  const p = soft(phrase), f = fold(p);
  if (p.length < 4 || p.length > 140 || /[\n\r]/.test(phrase.trim()) || a.slots.length || DEICTIC.test(f) || SECRET.test(f)) return undefined;
  if (f === fold(soft(a.phrase))) return undefined;
  return { ...a, id: idOf(`${stepsOf(a).map((s) => s.tool).join('+')}|${esc(f)}`), phrase: p, pattern: `^${esc(f)}$`, at: now, uses: 0, fails: 0, last: now, origin: 'lien' };
}

// ---------------- Stockage ----------------

export function loadAcquis(kv: Kv): Acquis[] { try { const l = JSON.parse(kv.getKv(KEY) ?? '[]') as Acquis[]; return Array.isArray(l) ? l : []; } catch { return []; } }
export function saveAcquis(kv: Kv, list: Acquis[]): void { kv.setKv(KEY, JSON.stringify([...list].sort((a, b) => b.last - a.last).slice(0, MAX))); }
/** Garde un nouvel acquis (ou rafraîchit le même). Rend l'acquis gardé. */
export function keep(kv: Kv, a: Acquis): Acquis {
  const list = loadAcquis(kv), old = list.find((x) => x.id === a.id);
  if (old) { old.input = a.input; old.label = a.label; old.fails = 0; old.last = a.last; if (a.steps) old.steps = a.steps; else delete old.steps; saveAcquis(kv, list); return old; }
  // Une phrase ne mène qu'à une mission : si la même était déjà apprise avec d'autres actions (elle ne marchait plus, l'IA a fait autrement), la nouvelle la remplace.
  saveAcquis(kv, [a, ...list.filter((x) => x.pattern !== a.pattern)]); return a;
}
/** Note une utilisation réussie ou ratée ; deux échecs de suite = oublié. Rend true si l'acquis a été oublié. */
export function used(kv: Kv, id: string, ok: boolean, now = Date.now()): boolean {
  const list = loadAcquis(kv), a = list.find((x) => x.id === id); if (!a) return false;
  if (ok) { a.uses++; a.fails = 0; a.last = now; saveAcquis(kv, list); return false; }
  a.fails++;
  if (a.fails >= 2) { saveAcquis(kv, list.filter((x) => x.id !== id)); return true; }
  saveAcquis(kv, list); return false;
}
/** Oublie un acquis (par son identifiant), ou tous (« tout »). Rend le nombre oublié. */
export function forget(kv: Kv, idOrAll: string): number {
  const list = loadAcquis(kv);
  if (idOrAll === 'tout') { saveAcquis(kv, []); return list.length; }
  const rest = list.filter((x) => x.id !== idOrAll);
  if (rest.length !== list.length) saveAcquis(kv, rest);
  return list.length - rest.length;
}
/** Liste lisible : « ce que tu as appris ». */
export function describeAcquis(list: Acquis[]): string {
  if (!list.length) return 'Je n\'ai encore rien appris à faire sans IA. Ça vient tout seul : quand une IA règle une demande par une action (ou quelques-unes à la suite), je la retiens.';
  const rows = [...list].sort((a, b) => b.uses - a.uses || b.last - a.last).slice(0, 30);
  return `Ce que j'ai appris à faire sans IA (${list.length}) :\n${rows.map((a) => `- [${a.id}] « ${a.phrase} » → ${a.label}${a.slots.length ? ' (la valeur peut changer)' : ''}${a.origin === 'lien' ? ' (autre façon de le dire)' : ''} · utilisé ${a.uses} fois`).join('\n')}\nPour en oublier un : « oublie l'acquis ${rows[0].id} » (ou « oublie tous les acquis »). Chacun a sa note dans le Cerveau, rubrique Quotidien.`;
}
