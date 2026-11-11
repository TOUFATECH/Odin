// Formules des bases Runes : un petit langage sûr (aucun code exécuté), proche de celui des bases de notes.
//   prop("Prix") * prop("Quantité")        si(prop("Statut") == "Fait", "✓", "…")
//   concat(prop("Nom"), " — ", prop("Ville"))   jours(prop("Échéance"), maintenant())   arrondi(x, 2)
// Opérateurs : + - * / % == != < <= > >= et ou non ; textes entre guillemets ; nombres ; vrai / faux.

type V = string | number | boolean | null | V[];
type Tok = { t: 'num' | 'str' | 'id' | 'op' | 'par'; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/\d/.test(c)) { const m = /^\d+(?:[.,]\d+)?/.exec(src.slice(i))!; out.push({ t: 'num', v: m[0].replace(',', '.') }); i += m[0].length; continue; }
    if (c === '"' || c === "'" || c === '«') { const end = c === '«' ? '»' : c; const j = src.indexOf(end, i + 1); if (j < 0) throw new Error('guillemet non fermé'); out.push({ t: 'str', v: src.slice(i + 1, j).trim() }); i = j + 1; continue; }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/%<>!'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    if ('(),'.includes(c)) { out.push({ t: 'par', v: c }); i++; continue; }
    const m = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(src.slice(i));
    if (m) { out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
    throw new Error(`caractère inattendu : ${c}`);
  }
  return out;
}

type Node = { k: 'lit'; v: V } | { k: 'call'; f: string; a: Node[] } | { k: 'bin'; op: string; l: Node; r: Node } | { k: 'un'; op: string; e: Node };
const PREC: Record<string, number> = { ou: 1, '||': 1, et: 2, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

export function parseFormula(src: string): Node {
  const toks = lex(src); let p = 0;
  const peek = () => toks[p], eat = (v?: string) => { const t = toks[p++]; if (!t || (v && t.v !== v)) throw new Error(`attendu « ${v ?? 'quelque chose'} »`); return t; };
  const opOf = (t?: Tok) => t && ((t.t === 'op' && PREC[t.v]) || (t.t === 'id' && (t.v === 'et' || t.v === 'ou'))) ? t.v : undefined;
  const primary = (): Node => {
    const t = eat();
    if (t.t === 'num') return { k: 'lit', v: Number(t.v) };
    if (t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'op' && (t.v === '-' || t.v === '!')) return { k: 'un', op: t.v, e: primary() };
    if (t.t === 'par' && t.v === '(') { const e = expr(0); eat(')'); return e; }
    if (t.t === 'id') {
      if (t.v === 'vrai' || t.v === 'true') return { k: 'lit', v: true };
      if (t.v === 'faux' || t.v === 'false') return { k: 'lit', v: false };
      if (t.v === 'non' || t.v === 'not') return { k: 'un', op: '!', e: primary() };
      if (peek()?.v === '(') { eat('('); const a: Node[] = []; if (peek()?.v !== ')') { a.push(expr(0)); while (peek()?.v === ',') { eat(','); a.push(expr(0)); } } eat(')'); return { k: 'call', f: t.v.toLowerCase(), a }; }
      throw new Error(`nom inconnu : ${t.v} (utilise prop("…"))`);
    }
    throw new Error(`inattendu : ${t.v}`);
  };
  const expr = (min: number): Node => {
    let l = primary();
    for (let op = opOf(peek()); op && PREC[op] > min; op = opOf(peek())) { eat(); l = { k: 'bin', op, l, r: expr(PREC[op]) }; }
    return l;
  };
  const e = expr(0);
  if (p < toks.length) throw new Error(`inattendu : ${toks[p].v}`);
  return e;
}

const num = (v: V) => typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : Number(String(v ?? '').replace(',', '.')) || 0;
const str = (v: V): string => v === null ? '' : Array.isArray(v) ? v.map(str).join(', ') : String(v);
const truthy = (v: V) => Array.isArray(v) ? v.length > 0 : Boolean(v) && v !== '0' && v !== 'false';
const date = (v: V) => { const d = new Date(str(v)); return Number.isNaN(d.getTime()) ? undefined : d; };

export function evalFormula(node: Node, prop: (name: string) => V, now = new Date()): V {
  const ev = (n: Node): V => {
    switch (n.k) {
      case 'lit': return n.v;
      case 'un': { const v = ev(n.e); return n.op === '-' ? -num(v) : !truthy(v); }
      case 'bin': {
        if (n.op === 'et' || n.op === '&&') return truthy(ev(n.l)) && truthy(ev(n.r));
        if (n.op === 'ou' || n.op === '||') return truthy(ev(n.l)) || truthy(ev(n.r));
        const a = ev(n.l), b = ev(n.r);
        const bothNum = typeof a === 'number' && typeof b === 'number';
        switch (n.op) {
          case '+': return typeof a === 'string' || typeof b === 'string' ? str(a) + str(b) : num(a) + num(b);
          case '-': return num(a) - num(b);
          case '*': return num(a) * num(b);
          case '/': return num(b) === 0 ? null : num(a) / num(b);
          case '%': return num(b) === 0 ? null : num(a) % num(b);
          case '==': return str(a) === str(b);
          case '!=': return str(a) !== str(b);
          case '<': return bothNum ? a < b : str(a) < str(b);
          case '<=': return bothNum ? a <= b : str(a) <= str(b);
          case '>': return bothNum ? a > b : str(a) > str(b);
          case '>=': return bothNum ? a >= b : str(a) >= str(b);
        }
        return null;
      }
      case 'call': {
        const a = n.a.map(ev), f = n.f;
        switch (f) {
          case 'prop': return prop(str(a[0]));
          case 'si': case 'if': return truthy(a[0]) ? a[1] ?? null : a[2] ?? null;
          case 'concat': return a.map(str).join('');
          case 'longueur': case 'length': return Array.isArray(a[0]) ? a[0].length : str(a[0]).length;
          case 'contient': case 'contains': return str(a[0]).toLowerCase().includes(str(a[1]).toLowerCase());
          case 'vide': case 'empty': return a[0] === null || str(a[0]) === '' || (Array.isArray(a[0]) && !a[0].length);
          case 'majuscules': case 'upper': return str(a[0]).toUpperCase();
          case 'minuscules': case 'lower': return str(a[0]).toLowerCase();
          case 'remplacer': case 'replace': return str(a[0]).split(str(a[1])).join(str(a[2]));
          case 'arrondi': case 'round': { const k = 10 ** num(a[1] ?? 0); return Math.round(num(a[0]) * k) / k; }
          case 'abs': return Math.abs(num(a[0]));
          case 'min': return Math.min(...a.flat().map(num));
          case 'max': return Math.max(...a.flat().map(num));
          case 'somme': case 'sum': return a.flat().map(num).reduce((x, y) => x + y, 0);
          case 'nombre': case 'tonumber': return num(a[0]);
          case 'texte': case 'format': return str(a[0]);
          case 'maintenant': case 'now': return now.toISOString();
          case 'aujourdhui': case 'today': return now.toISOString().slice(0, 10);
          case 'jours': case 'datebetween': { const x = date(a[0]), y = date(a[1] ?? now.toISOString()); return x && y ? Math.round((x.getTime() - y.getTime()) / 86_400_000) : null; }
          case 'ajouterjours': case 'dateadd': { const x = date(a[0]); return x ? new Date(x.getTime() + num(a[1]) * 86_400_000).toISOString().slice(0, 10) : null; }
          case 'formatdate': { const x = date(a[0]); return x ? x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : ''; }
          case 'pourcent': return `${Math.round(num(a[0]) * 100)} %`;
          default: throw new Error(`fonction inconnue : ${f}`);
        }
      }
    }
  };
  return ev(node);
}

export function formula(src: string, prop: (name: string) => V, now?: Date): V {
  try { return evalFormula(parseFormula(src), prop, now); } catch (e) { return `⚠ ${(e as Error).message}`; }
}
export type FormulaValue = V;
