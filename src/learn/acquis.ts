// Acquis : ce qu'Odin a appris à faire sans IA.
//
// Quand une IA a résolu une demande par UNE seule action (une appli d'Odin, la maison, Venus…), Odin
// retient « cette phrase → cette action ». La fois suivante, la même demande part sans IA ; et si la
// phrase portait une valeur (une adresse, un nom, un nombre), la même phrase avec une autre valeur
// marche aussi (« redémarre le conteneur web » appris → « redémarre le conteneur db » compris).
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
  /** En clair : « Loki · Bannir une adresse ». */
  label: string;
  at: number;
  uses: number;
  fails: number;
  last: number;
}

const KEY = 'acquis';
const MAX = 300;
/** Outils dont une action seule peut être rejouée, et les réglages où une valeur peut changer. */
export const LEARNABLE: Record<string, string[]> = { valhalla: ['entree'], ha_call: ['data'], venus: ['quoi', 'ou'], mode_set: [], net_scan: [] };

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
const DEICTIC = /\b(aujourd'hui|demain|apres-demain|hier|avant-hier|ce (soir|matin|midi|week-end)|cette (nuit|semaine|annee)|cet apres-midi|tout a l'heure|tout de suite|maintenant|dans \d+|a \d{1,2}\s?h|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|prochaine?|derniere?|ca|cela|celui|celle|ceux|celles|le meme|la meme|les memes|pareil|idem|encore|aussi|refais|recommence|comme (d'hab|hier|avant|tout a l'heure)|lui|eux|la-bas|ici)\b/;
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

export interface LearnInput { phrase: string; tool: string; input: Record<string, unknown>; label: string; now?: number; redact?: (t: string) => string }
/** Pourquoi une demande ne s'apprend pas (pour les tests et le journal), ou l'acquis à garder. Pur. */
export function learn(l: LearnInput): Acquis | { skip: string } {
  const slotsFor = LEARNABLE[l.tool];
  if (!slotsFor) return { skip: 'outil non rejouable' };
  const phrase = soft(l.phrase), f = fold(phrase);
  if (phrase.length < 4 || phrase.length > 140 || phrase.split(' ').length > 20) return { skip: 'phrase trop courte ou trop longue' };
  if (/[\n\r]/.test(l.phrase.trim())) return { skip: 'plusieurs lignes' };
  if (DEICTIC.test(f)) return { skip: 'dépend du moment ou de la conversation' };
  const raw = JSON.stringify(l.input);
  if (raw.length > 800) return { skip: 'action trop grosse' };
  if (SECRET.test(raw) || SECRET.test(f)) return { skip: 'peut porter un secret' };
  if (l.redact && (l.redact(phrase) !== phrase || l.redact(raw) !== raw)) return { skip: 'contient un secret connu' };

  const input = JSON.parse(raw) as Record<string, unknown>;
  const { list, close } = leaves(input, slotsFor);
  // Les valeurs les plus longues d'abord (« 192.168.1.20 » avant « 20 »), sans chevauchement ; trois au plus.
  const found: Array<{ a: number; b: number; leaf: Leaf; shape: Shape; number: boolean }> = [];
  const cands = list.map((leaf) => ({ leaf, text: String(leaf.get()).trim() })).filter((c) => c.text.length >= 1 && c.text.length <= 80).sort((x, y) => y.text.length - x.text.length);
  for (const c of cands) {
    if (found.length >= 3) break;
    const v = fold(c.text); if (v.length < 2 && !/^\d$/.test(v)) continue;
    const m = new RegExp(`(?<![\\p{L}\\p{N}])${esc(v)}(?![\\p{L}\\p{N}])`, 'u').exec(f);
    if (!m) continue;
    const a = m.index, b = a + v.length;
    if (found.some((s) => a < s.b && b > s.a)) continue;
    const shape = shapeOf(c.text);
    if (shape === 'texte' && c.text.split(/\s+/).length > 6) continue;
    found.push({ a, b, leaf: c.leaf, shape, number: typeof c.leaf.get() === 'number' });
  }
  // Les repères sont numérotés dans l'ordre où les valeurs apparaissent dans la phrase.
  found.sort((x, y) => x.a - y.a);
  const slots: Acquis['slots'] = found.map((s) => ({ shape: s.shape, ...(s.number ? { number: true } : {}) }));
  found.forEach((s, i) => s.leaf.set(MARK(i)));
  close();
  // La phrase doit garder des mots fixes (au moins un verbe ou un nom) : sinon tout ressemblerait à tout.
  let pattern = '', at = 0; const fixed: string[] = [];
  for (const s of found) { fixed.push(f.slice(at, s.a)); pattern += esc(f.slice(at, s.a)) + CAPTURE[s.shape]; at = s.b; }
  fixed.push(f.slice(at)); pattern += esc(f.slice(at));
  if (fixed.join(' ').replace(/[^\p{L}]/gu, '').length < 4) return { skip: 'pas assez de mots fixes' };
  const now = l.now ?? Date.now();
  return { id: idOf(`${l.tool}|${pattern}`), phrase, pattern: `^${pattern}$`, tool: l.tool, input, slots, label: l.label, at: now, uses: 0, fails: 0, last: now };
}
function idOf(s: string): string { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return `a${(h >>> 0).toString(36).padStart(6, '0')}`; }

/** L'acquis qui reconnaît cette phrase, avec l'entrée à rejouer. Les phrases exactes passent avant les phrases à valeur. Pur. */
export function match(list: Acquis[], text: string): { a: Acquis; input: Record<string, unknown>; values: string[] } | undefined {
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
    const fill = (v: unknown): unknown => {
      if (typeof v === 'string') {
        const whole = /^\u0001(\d+)\u0001$/.exec(v);
        if (whole) { const i = Number(whole[1]); return a.slots[i]?.number ? Number(values[i].replace(',', '.')) : values[i]; }
        return v;
      }
      if (Array.isArray(v)) return v.map(fill);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, fill(x)]));
      return v;
    };
    // Le JSON rangé dans un texte (« entree » des applis) est rouvert, rempli, refermé.
    const input = Object.fromEntries(Object.entries(a.input as Record<string, unknown>).map(([k, v]) => {
      if (typeof v === 'string' && /^\s*[{[]/.test(v)) { try { return [k, JSON.stringify(fill(JSON.parse(v)))]; } catch { /* texte ordinaire */ } }
      return [k, fill(v)];
    }));
    return { a, input, values };
  }
  return undefined;
}

// ---------------- Stockage ----------------

export function loadAcquis(kv: Kv): Acquis[] { try { const l = JSON.parse(kv.getKv(KEY) ?? '[]') as Acquis[]; return Array.isArray(l) ? l : []; } catch { return []; } }
export function saveAcquis(kv: Kv, list: Acquis[]): void { kv.setKv(KEY, JSON.stringify([...list].sort((a, b) => b.last - a.last).slice(0, MAX))); }
/** Garde un nouvel acquis (ou rafraîchit le même). Rend l'acquis gardé. */
export function keep(kv: Kv, a: Acquis): Acquis {
  const list = loadAcquis(kv), old = list.find((x) => x.id === a.id);
  if (old) { old.input = a.input; old.label = a.label; old.fails = 0; old.last = a.last; saveAcquis(kv, list); return old; }
  saveAcquis(kv, [a, ...list]); return a;
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
  if (!list.length) return 'Je n\'ai encore rien appris à faire sans IA. Ça vient tout seul : quand une IA règle une demande par une seule action, je la retiens.';
  const rows = [...list].sort((a, b) => b.uses - a.uses || b.last - a.last).slice(0, 30);
  return `Ce que j'ai appris à faire sans IA (${list.length}) :\n${rows.map((a) => `- [${a.id}] « ${a.phrase} » → ${a.label}${a.slots.length ? ' (la valeur peut changer)' : ''} · utilisé ${a.uses} fois`).join('\n')}\nPour en oublier un : « oublie l'acquis ${rows[0].id} » (ou « oublie tous les acquis »).`;
}
