// Ullr — le moteur de détection d'Odin (fait maison, sans moteur tiers).
// Pour chaque fichier : son vrai type (lu dans son contenu, pas dans son nom), son empreinte SHA-256,
// les règles (Galdr + règles YARA importées, sous-ensemble), et des heuristiques qui donnent un score
// de risque EXPLICABLE (chaque point vient avec sa raison). Les archives sont ouvertes (zip, gzip, tar).
// Aucun antivirus ne détecte 100 % des menaces : un score sans empreinte ni règle sûre reste « à vérifier ».

import { createHash } from 'node:crypto';
import { gunzipSync, inflateRawSync } from 'node:zlib';

export type Level = 'critique' | 'haute' | 'moyenne';
export type Klass = 'malware' | 'rançongiciel' | 'cheval de Troie' | 'porte dérobée' | 'logiciel espion' | 'publicitaire' | 'indésirable' | 'script malveillant' | 'document piégé' | 'exploit' | 'webshell' | 'mineur' | 'hameçonnage' | 'vol d\'identifiants' | 'outil de piratage' | 'test' | 'suspect';
export interface Finding { threat: string; by: 'empreinte' | 'règle' | 'heuristique' | 'réputation' | 'indicateur'; level: Level; klass: Klass; score: number; why: string; source?: string; family?: string; /** technique MITRE ATT&CK */ attack?: string; /** assez sûr pour une mise en quarantaine automatique */ sure?: boolean }
export interface Verdict { file: string; sha256: string; size: number; type: string; score: number; level?: Level; findings: Finding[]; /** fichiers contenus (archives) où quelque chose a été trouvé */ inside?: Verdict[]; note?: string }

export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const lat = (b: Buffer) => b.toString('latin1');

// ---------------------------------------------------------------- Vrai type d'un fichier
export function fileType(b: Buffer, name = ''): string {
  const n = name.toLowerCase(), h4 = b.subarray(0, 4).toString('hex'), t = lat(b.subarray(0, 600)).trimStart().toLowerCase();
  if (b.length >= 2 && b[0] === 0x4d && b[1] === 0x5a) return 'pe';
  if (h4 === '7f454c46') return 'elf';
  if (['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe'].includes(h4) || (h4 === 'cafebabe' && b.length > 8 && b.readUInt32BE(4) < 40)) return 'macho';
  if (h4 === 'cafebabe') return 'java';
  if (h4 === '504b0304' || h4 === '504b0506') return /\.apk$/.test(n) ? 'apk' : /\.(docx|docm|dotm)$/.test(n) ? 'word' : /\.(xlsx|xlsm|xlsb)$/.test(n) ? 'excel' : /\.(pptx|pptm)$/.test(n) ? 'powerpoint' : /\.jar$/.test(n) ? 'jar' : 'zip';
  if (h4 === '25504446') return 'pdf';
  if (h4 === 'd0cf11e0') return /\.msi$/.test(n) ? 'msi' : 'ole';
  if (b[0] === 0x1f && b[1] === 0x8b) return 'gzip';
  if (h4 === '52617221') return 'rar';
  if (h4 === '377abcaf') return '7z';
  if (h4 === '4c000000' && b.subarray(4, 8).toString('hex') === '01140200') return 'lnk';
  if (h4.startsWith('89504e47') || h4.startsWith('ffd8ff') || h4.startsWith('47494638')) return 'image';
  if (t.startsWith('{\\rtf')) return 'rtf';
  if (t.startsWith('#!')) return /python/.test(t.split('\n')[0]) ? 'python' : /node/.test(t.split('\n')[0]) ? 'javascript' : 'shell';
  if (t.startsWith('<?php') || /\.(php\d?|phtml)$/.test(n)) return 'php';
  if (/^(<!doctype html|<html|<head|<body)/.test(t) || /\.(html?|xhtml)$/.test(n)) return 'html';
  if (/^(received|return-path|delivered-to|from|mime-version|x-[a-z-]+): /m.test(t) && /^(subject|to|from): /m.test(lat(b.subarray(0, 4000)).toLowerCase()) || /\.eml$/.test(n)) return 'eml';
  if (/\.(ps1|psm1)$/.test(n)) return 'powershell';
  if (/\.(bat|cmd)$/.test(n)) return 'batch';
  if (/\.(vbs|vbe|wsf|hta|jse)$/.test(n)) return 'script windows';
  if (/\.(js|mjs|cjs)$/.test(n)) return /\b(WScript\.|ActiveXObject\s*\(|GetObject\s*\()/.test(lat(b.subarray(0, 200_000))) ? 'script windows' : 'javascript';
  if (/\.(sh|bash|zsh)$/.test(n)) return 'shell';
  if (/\.py$/.test(n)) return 'python';
  if (b.length > 262 && lat(b.subarray(257, 262)) === 'ustar') return 'tar';
  return b.subarray(0, 512).includes(0) ? 'binaire' : 'texte';
}
/** Entropie de Shannon (0 à 8) : au-dessus de 7,2 le contenu est compressé ou chiffré. */
export function entropy(b: Buffer): number {
  if (!b.length) return 0;
  const c = new Uint32Array(256); for (let i = 0; i < b.length; i++) c[b[i]]++;
  let e = 0; for (let i = 0; i < 256; i++) if (c[i]) { const p = c[i] / b.length; e -= p * Math.log2(p); }
  return e;
}

// ---------------------------------------------------------------- Archives (zip, gzip, tar) sans dépendance
export interface Entry { name: string; data?: Buffer; size: number; packed: number; encrypted: boolean }
/** Lit un zip : répertoire central, puis chaque fichier (stocké ou « deflate »). Limites contre les bombes de décompression. */
export function unzip(b: Buffer, o: { maxEntries?: number; maxEach?: number; maxTotal?: number } = {}): { entries: Entry[]; bomb: boolean; truncated: boolean } {
  const maxEntries = o.maxEntries ?? 2000, maxEach = o.maxEach ?? 24 * 1024 * 1024, maxTotal = o.maxTotal ?? 160 * 1024 * 1024;
  let eocd = -1; for (let i = b.length - 22; i >= Math.max(0, b.length - 66_000); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return { entries: [], bomb: false, truncated: true };
  const count = b.readUInt16LE(eocd + 10); let p = b.readUInt32LE(eocd + 16), total = 0, bomb = false, truncated = count > maxEntries;
  const entries: Entry[] = [];
  for (let i = 0; i < Math.min(count, maxEntries) && p + 46 <= b.length; i++) {
    if (b.readUInt32LE(p) !== 0x02014b50) break;
    const flags = b.readUInt16LE(p + 8), method = b.readUInt16LE(p + 10), packed = b.readUInt32LE(p + 20), size = b.readUInt32LE(p + 24), nl = b.readUInt16LE(p + 28), el = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nl).toString('utf8'); p += 46 + nl + el + cl;
    const e: Entry = { name, size, packed, encrypted: Boolean(flags & 1) };
    if (size > 0 && packed > 0 && size / packed > 200 && size > 8 * 1024 * 1024) bomb = true;
    if (!e.encrypted && !name.endsWith('/') && size <= maxEach && total + size <= maxTotal && off + 30 <= b.length && b.readUInt32LE(off) === 0x04034b50) {
      const start = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28), raw = b.subarray(start, start + packed);
      try { e.data = method === 0 ? raw : method === 8 ? inflateRawSync(raw, { maxOutputLength: maxEach }) : undefined; } catch { /* fichier abîmé ou trop gros une fois décompressé */ if (method === 8) bomb = bomb || packed > 0 && size / Math.max(packed, 1) > 200; }
      if (e.data) total += e.data.length;
    } else if (!e.encrypted && !name.endsWith('/')) truncated = true;
    entries.push(e);
  }
  return { entries, bomb, truncated };
}
export function untar(b: Buffer, max = 2000): Entry[] {
  const out: Entry[] = [];
  for (let p = 0; p + 512 <= b.length && out.length < max;) {
    const name = lat(b.subarray(p, p + 100)).replace(/\0.*$/, ''); if (!name) break;
    const size = parseInt(lat(b.subarray(p + 124, p + 136)).replace(/[^0-7]/g, '') || '0', 8), type = String.fromCharCode(b[p + 156] || 48);
    if (type === '0' || type === '\0') out.push({ name, size, packed: size, encrypted: false, data: size <= 24 * 1024 * 1024 ? b.subarray(p + 512, p + 512 + size) : undefined });
    p += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

/**
 * Fichier « passif » : documentation, données, code source. Il ne se lance pas tel quel : s'il contient le
 * texte d'une attaque, c'est le plus souvent une documentation, un test, un journal ou une règle de détection.
 * Une règle qui y correspond devient un simple indice (jamais de quarantaine automatique).
 */
const PASSIVE_EXT = /\.(md|markdown|rst|txt|text|log|json|jsonl|ya?ml|toml|ini|cfg|conf|csv|tsv|xml|svg|css|scss|sass|less|ts|tsx|jsx|vue|svelte|go|rs|c|cc|cpp|h|hpp|java|kt|swift|cs|sql|lock|map|yar|yara|rules|sig|ndb|hsb|ldb|po|pot)$/i;
export const isPassive = (name: string, type: string) => type === 'texte' && PASSIVE_EXT.test(name);

// ---------------------------------------------------------------- Règles : Galdr (maison) et YARA (sous-ensemble)
export interface Rule { name: string; level: Level; strings: string[]; need: 'un' | 'tous' | number; files?: string; note?: string; klass?: Klass; source?: string; attack?: string; /** garde tout son poids même dans un fichier de texte (fichier de test, demande de rançon, configuration de mineur) */ anywhere?: boolean }
/** `atoms` : un morceau fixe par écriture possible de la chaîne (ASCII, UTF-16) ; absent si la chaîne n'en a pas d'indexable. */
interface CStr { id: string; test(h: Hay): boolean; atoms?: string[]; nocase?: boolean }
export interface CRule { name: string; level: Level; klass: Klass; source: string; attack?: string; sure: boolean; anywhere?: boolean; /** la condition peut être vraie sans qu'aucune chaîne soit là (« not $a ») : toujours essayée */ loose?: boolean; strs: CStr[]; cond(h: Hay, has: (id: string) => boolean): boolean; files?: RegExp }
/** Le contenu à analyser, préparé une fois : octets vus comme du texte (1 octet = 1 caractère), et en minuscules. */
export interface Hay { text: string; low: string; size: number; name: string; head: Buffer }
export const hay = (b: Buffer, name = ''): Hay => { const text = lat(b); return { text, low: text.toLowerCase(), size: b.length, name, head: b.subarray(0, 8) }; };

const KLASS: Array<[RegExp, Klass]> = [[/ransom|rançon|crypt(o)?lock|wannacry|lockbit/i, 'rançongiciel'], [/webshell|web_shell|c99|r57|b374k|china_?chopper/i, 'webshell'], [/miner|xmrig|coinhive|stratum/i, 'mineur'], [/phish|hameçon/i, 'hameçonnage'], [/keylog|spy|stalker|rat_|_rat\b|espion|stealer|infostealer/i, 'logiciel espion'], [/mimikatz|credential|password_?dump|lsass|hashdump/i, 'vol d\'identifiants'], [/backdoor|reverse_?shell|bind_?shell|porte/i, 'porte dérobée'], [/trojan|dropper|downloader|loader|cheval/i, 'cheval de Troie'], [/exploit|cve[-_]\d{4}|shellcode|metasploit|meterpreter|cobalt/i, 'exploit'], [/hacktool|hktl|scanner|bruteforce|pwdump|nmap/i, 'outil de piratage'], [/adware|pua|pup_|toolbar/i, 'publicitaire'], [/macro|maldoc|ole_|office/i, 'document piégé'], [/powershell|vbs|jscript|script|obfus/i, 'script malveillant'], [/eicar|test/i, 'test']];
export const klassOf = (name: string, d = ''): Klass => KLASS.find(([re]) => re.test(name) || re.test(d))?.[1] ?? 'malware';
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Morceau de 4 caractères d'une chaîne fixe : sert à écarter très vite les règles qui ne peuvent pas correspondre. */
const atomOf = (lit: string) => (lit.length >= 4 ? [lit.slice(0, 4)] : undefined);
const atomsOf = (forms: string[]) => { const a = forms.map(atomOf); return a.every(Boolean) ? a.flatMap((x) => x!) : undefined; };

/** Le contenu est lu octet par octet : une lettre accentuée d'une règle doit reconnaître ses deux écritures (UTF-8 et Latin-1). */
const asBytes = (x: string) => Buffer.from(x, 'utf8').toString('latin1');
const accents = (src: string) => src.replace(/[\u0080-\uffff]/g, (c) => `(?:${esc(asBytes(c))}${c.charCodeAt(0) <= 0xff ? `|\\x${c.charCodeAt(0).toString(16)}` : ''})`);
/** Règle Galdr → règle compilée. Les chaînes entre / / sont des expressions régulières (pas de lettre accentuée entre crochets : écris « (é|e) »). */
export function compileGaldr(r: Rule): CRule {
  const strs: CStr[] = r.strings.map((x, i) => {
    const m = /^\/(.*)\/([gimsuy]*)$/s.exec(x);
    if (m) { const re = new RegExp(accents(m[1]), m[2].replace(/[gu]/g, '')); return { id: `s${i}`, test: (h) => re.test(h.text) }; }
    const alt = asBytes(x);
    return alt === x ? { id: `s${i}`, test: (h) => h.text.includes(x), atoms: atomOf(x) } : { id: `s${i}`, test: (h) => h.text.includes(alt) || h.text.includes(x) };
  });
  const need = r.need;
  return { name: r.name, level: r.level, klass: r.klass ?? klassOf(r.name), source: r.source ?? 'Galdr', attack: r.attack, sure: r.level !== 'moyenne', anywhere: r.anywhere, strs, files: r.files ? new RegExp(r.files, 'i') : undefined,
    cond: (_h, has) => { const n = strs.filter((s) => has(s.id)).length; return need === 'un' ? n >= 1 : need === 'tous' ? n === strs.length : n >= need; } };
}

/** Chaîne hexadécimale YARA ({ 4D 5A ?? [2-4] (AA|BB) }) → expression régulière sur les octets. */
function hexToRe(hex: string): { re: RegExp; atom?: string } | undefined {
  const body = hex.replace(/\/\/[^\n]*/g, ' ').replace(/[{}]/g, ' ').trim(); let out = '', atom = '', inAtom = true;
  for (const tok of body.match(/\[\s*\d*\s*-?\s*\d*\s*\]|\(|\)|\||[0-9A-Fa-f?]{2}/g) ?? []) {
    if (tok === '(' || tok === ')' || tok === '|') { out += tok === '(' ? '(?:' : tok; inAtom = false; continue; }
    if (tok.startsWith('[')) { const m = /\[\s*(\d*)\s*(-?)\s*(\d*)\s*\]/.exec(tok)!; const a = m[1] || '0', b2 = m[2] ? m[3] : m[1]; if (Number(b2 || 4096) > 4096) return undefined; out += `[\\s\\S]{${a},${b2}}`; inAtom = false; continue; }
    if (tok.includes('?')) { out += tok === '??' ? '[\\s\\S]' : tok[0] === '?' ? `[${[...Array(16)].map((_x, i) => `\\x${i.toString(16)}${tok[1]}`).join('')}]` : `[\\x${tok[0]}0-\\x${tok[0]}f]`; inAtom = false; continue; }
    out += `\\x${tok}`; if (inAtom && atom.length < 4) atom += String.fromCharCode(parseInt(tok, 16));
  }
  if (!out) return undefined;
  try { return { re: new RegExp(out), atom: atom.length === 4 ? atom : undefined }; } catch { return undefined; }
}
type Cond = (h: Hay, has: (id: string) => boolean) => boolean;
/** Condition YARA (sous-ensemble) : and / or / not, parenthèses, $a, « N of them », « any of ($a*) », filesize, uint16(0)/uint32(0). */
function parseCond(src: string, ids: string[]): Cond | undefined {
  const toks = src.replace(/\/\/[^\n]*/g, ' ').match(/\$[A-Za-z0-9_]*\*?|\(|\)|,|==|!=|<=|>=|<|>|0x[0-9A-Fa-f]+|\d+(?:KB|MB)?|uint(?:16|32)(?:be)?\(\s*0\s*\)|[A-Za-z_]+/g) ?? [];
  if (toks.join('').length < src.replace(/\/\/[^\n]*/g, ' ').replace(/\s+/g, '').length) return undefined; // un élément non compris : règle écartée
  let i = 0; const peek = () => toks[i], eat = (t?: string) => { if (t && toks[i] !== t) throw new Error('syntaxe'); return toks[i++]; };
  const num = (t: string) => (/KB$/.test(t) ? parseInt(t, 10) * 1024 : /MB$/.test(t) ? parseInt(t, 10) * 1048576 : Number(t));
  const setOf = (): string[] => {
    if (peek() === 'them') { eat(); return ids; }
    eat('('); const out: string[] = [];
    for (;;) { const t = eat(); if (!t?.startsWith('$')) throw new Error('ensemble'); out.push(...(t.endsWith('*') ? ids.filter((x) => x.startsWith(t.slice(0, -1))) : [t])); if (peek() === ',') { eat(); continue; } break; }
    eat(')'); return out;
  };
  const value = (): ((h: Hay) => number) => {
    const t = eat();
    if (t === 'filesize') return (h) => h.size;
    if (/^uint16\(/.test(t)) return (h) => (h.head.length >= 2 ? h.head.readUInt16LE(0) : -1);
    if (/^uint16be\(/.test(t)) return (h) => (h.head.length >= 2 ? h.head.readUInt16BE(0) : -1);
    if (/^uint32\(/.test(t)) return (h) => (h.head.length >= 4 ? h.head.readUInt32LE(0) : -1);
    if (/^uint32be\(/.test(t)) return (h) => (h.head.length >= 4 ? h.head.readUInt32BE(0) : -1);
    if (/^(0x[0-9A-Fa-f]+|\d+(KB|MB)?)$/.test(t)) { const n = num(t); return () => n; }
    throw new Error(`valeur ${t}`);
  };
  const primary = (): Cond => {
    const t = peek();
    if (t === '(') { eat(); const c = or(); eat(')'); return c; }
    if (t === 'not') { eat(); const c = primary(); return (h, has) => !c(h, has); }
    if (t === 'true' || t === 'false') { eat(); return () => t === 'true'; }
    if (t?.startsWith('$')) { eat(); if (!ids.includes(t)) throw new Error(`chaîne ${t}`); return (_h, has) => has(t); }
    if (t === 'any' || t === 'all' || t === 'none' || (/^\d+$/.test(t ?? '') && toks[i + 1] === 'of')) { eat(); eat('of'); const set = setOf(); const n = t === 'any' ? 1 : t === 'all' ? set.length : t === 'none' ? 0 : Number(t); return t === 'none' ? (_h, has) => !set.some(has) : (_h, has) => { let k = 0; for (const s of set) if (has(s) && ++k >= n) return true; return n === 0; }; }
    const a = value(), op = eat(), b = value();
    if (!['==', '!=', '<', '>', '<=', '>='].includes(op)) throw new Error('opérateur');
    return (h) => { const x = a(h), y = b(h); return op === '==' ? x === y : op === '!=' ? x !== y : op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : x >= y; };
  };
  const and = (): Cond => { let c = primary(); while (peek() === 'and') { eat(); const d = primary(), p = c; c = (h, has) => p(h, has) && d(h, has); } return c; };
  const or = (): Cond => { let c = and(); while (peek() === 'or') { eat(); const d = and(), p = c; c = (h, has) => p(h, has) || d(h, has); } return c; };
  try { const c = or(); return i === toks.length ? c : undefined; } catch { return undefined; }
}
/** Importe un fichier de règles YARA. Sous-ensemble assumé : les règles qui emploient autre chose (modules pe/math, boucles, positions) sont écartées et comptées. */
export function importYara(src: string, source: string): { rules: CRule[]; skipped: number; total: number } {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const rules: CRule[] = []; let total = 0;
  for (const m of clean.matchAll(/(?:^|\n)\s*(?:(private|global)\s+)*rule\s+([A-Za-z0-9_]+)\s*(?::[^{\n]*)?\{([\s\S]*?)\n\}/g)) {
    total++;
    const [, mod, name, body] = m; if (mod) continue;
    const meta = /\bmeta\s*:([\s\S]*?)(?=\n\s*(strings|condition)\s*:)/.exec(body)?.[1] ?? '', strSrc = /\bstrings\s*:([\s\S]*?)\n\s*condition\s*:/.exec(body)?.[1] ?? '', condSrc = /\bcondition\s*:([\s\S]*)$/.exec(body)?.[1]?.trim() ?? '';
    if (!strSrc || !condSrc) continue;
    const strs: CStr[] = []; let ok = true;
    for (const line of strSrc.split('\n')) {
      const s = /^\s*(\$[A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/.exec(line); if (!s) continue;
      const id = s[1], def = s[2];
      const txt = /^"((?:[^"\\]|\\.)*)"\s*(.*)$/.exec(def), hex = /^\{([^}]*)\}/.exec(def), rex = /^\/((?:[^/\\\n]|\\.)+)\/([is]*)\s*(.*)$/.exec(def);
      if (txt) {
        const lit = txt[1].replace(/\\x([0-9A-Fa-f]{2})/g, (_x, h2) => String.fromCharCode(parseInt(h2, 16))).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\(["\\])/g, '$1');
        const mods = txt[2].replace(/\/\/.*$/, ''), nocase = /\bnocase\b/.test(mods), wide = /\bwide\b/.test(mods), ascii = /\bascii\b/.test(mods) || !wide, full = /\bfullword\b/.test(mods);
        if (/\b(xor|base64|base64wide|private)\b/.test(mods) || !lit) { ok = false; break; }
        const forms = [...(ascii ? [lit] : []), ...(wide ? [[...lit].map((c) => `${c}\0`).join('')] : [])].map((f) => (nocase ? f.toLowerCase() : f));
        const res = full ? forms.map((f) => new RegExp(`(?:^|[^A-Za-z0-9_])${esc(f)}(?![A-Za-z0-9_])`)) : undefined;
        strs.push({ id, nocase, atoms: atomsOf(forms), test: (h) => { const t = nocase ? h.low : h.text; return res ? res.some((re) => re.test(t)) : forms.some((f) => t.includes(f)); } });
      } else if (hex) { const r = hexToRe(hex[1]); if (!r) { ok = false; break; } strs.push({ id, atoms: r.atom ? [r.atom] : undefined, test: (h) => r.re.test(h.text) }); }
      else if (rex) { if (/\b(wide|xor|base64)\b/.test(rex[3]) || /\(\?[<!=P]|\\[pPXRG]|\{\d{4,}/.test(rex[1])) { ok = false; break; } try { const re = new RegExp(rex[1], rex[2].includes('i') || /\bnocase\b/.test(rex[3]) ? 'is' : 's'); strs.push({ id, test: (h) => re.test(h.text) }); } catch { ok = false; break; } }
      else { ok = false; break; }
    }
    if (!ok || !strs.length || /\b(for|in|at|pe|math|hash|elf|dotnet|cuckoo|magic|time|console|entrypoint|contains|matches)\b|#|@|!/.test(condSrc.replace(/!=/g, ''))) continue;
    const cond = parseCond(condSrc, strs.map((s) => s.id)); if (!cond) continue;
    const desc = /description\s*=\s*"([^"]*)"/.exec(meta)?.[1] ?? '', score = Number(/\bscore\s*=\s*(\d+)/.exec(meta)?.[1] ?? 70);
    rules.push({ name, level: score >= 80 ? 'critique' : score >= 60 ? 'haute' : 'moyenne', klass: klassOf(name, desc), source, sure: score >= 75, loose: /\b(not|none)\b/.test(condSrc) || !/\$|\bthem\b/.test(condSrc), strs, cond });
  }
  return { rules, skipped: total - rules.length, total };
}

/** Jeu de règles prêt à l'emploi : un index par morceaux de 4 caractères écarte très vite les règles impossibles. */
export class RuleSet {
  private byAtom = new Map<string, number[]>(); private always: number[] = []; private anyNocase = false;
  readonly rules: CRule[];
  constructor(rules: CRule[]) {
    this.rules = rules;
    rules.forEach((r, i) => {
      // Une règle n'est candidate que si au moins une de ses chaînes fixes est là ; sans chaîne fixe indexable, elle est toujours essayée.
      if (r.loose || r.strs.some((s) => !s.atoms?.length)) { this.always.push(i); return; }
      if (r.strs.some((s) => s.nocase)) this.anyNocase = true;
      for (const a of new Set(r.strs.flatMap((s) => s.atoms!.map((x) => (s.nocase ? x.toLowerCase() : x))))) { const l = this.byAtom.get(a); if (l) l.push(i); else this.byAtom.set(a, [i]); }
    });
  }
  match(h: Hay): CRule[] {
    const cand = new Set<number>(this.always);
    if (this.byAtom.size) for (const t of this.anyNocase ? [h.text, h.low] : [h.text]) for (let i = 0, n = t.length - 3; i < n; i++) { const l = this.byAtom.get(t.substr(i, 4)); if (l) for (const k of l) cand.add(k); }
    const out: CRule[] = [];
    for (const k of cand) {
      const r = this.rules[k]; if (r.files && !r.files.test(h.name)) continue;
      const memo = new Map<string, boolean>(), byId = new Map(r.strs.map((s) => [s.id, s]));
      const has = (id: string) => { let v = memo.get(id); if (v === undefined) { try { v = byId.get(id)?.test(h) ?? false; } catch { v = false; } memo.set(id, v); } return v; };
      try { if (r.cond(h, has)) out.push(r); } catch { /* règle défaillante : ignorée */ }
    }
    return out;
  }
}

/** Règles de base (format Galdr). */
export const BASE_RULES: Rule[] = [
  { name: 'Test antivirus EICAR', level: 'moyenne', klass: 'test', anywhere: true, strings: ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'], need: 'un' },
  { name: 'PHP.Webshell (eval encodé)', level: 'critique', klass: 'webshell', attack: 'T1505.003', files: '\\.(php\\d?|phtml|inc)$', strings: ['/eval\\s*\\(\\s*(base64_decode|gzinflate|str_rot13|gzuncompress)\\s*\\(/i', '/assert\\s*\\(\\s*\\$_(POST|GET|REQUEST)/i', '/preg_replace\\s*\\(\\s*["\'].*\\/e["\']/i'], need: 'un' },
  { name: 'PHP.Webshell (commande depuis la requête)', level: 'critique', klass: 'webshell', attack: 'T1505.003', files: '\\.(php\\d?|phtml)$', strings: ['/(system|shell_exec|passthru|exec|popen|proc_open)\\s*\\(\\s*\\$_(GET|POST|REQUEST|COOKIE)/i'], need: 'un' },
  { name: 'Shell inversé', level: 'critique', klass: 'porte dérobée', attack: 'T1059', strings: ['/bash -i >& ?\\/dev\\/tcp\\//', '/nc(at)? -e \\/bin\\/(ba)?sh/', '/socket\\.socket\\(.*subprocess\\.call\\(\\[.\\/bin\\/sh/s', '/php -r [\'"]\\$sock=fsockopen/', '/New-Object System\\.Net\\.Sockets\\.TCPClient\\([^)]*\\);\\s*\\$stream/i'], need: 'un' },
  { name: 'Mineur de cryptomonnaie (adresse de pool)', level: 'haute', klass: 'mineur', attack: 'T1496', strings: ['/stratum\\+(tcp|ssl|tls):\\/\\/[a-z0-9.-]+\\.[a-z]{2,}:\\d{2,5}/i'], need: 'un' },
  { name: 'Mineur de cryptomonnaie (configuration)', level: 'haute', klass: 'mineur', attack: 'T1496', anywhere: true, strings: ['/"donate-level"\\s*:/', '/"pools"\\s*:\\s*\\[/', '/"(algo|coin)"\\s*:\\s*"(rx\\/|cn\\/|randomx|monero|xmr)/i', '/--donate-level[ =]\\d/'], need: 2 },
  { name: 'JavaScript Windows malveillant', level: 'haute', klass: 'script malveillant', attack: 'T1059.007', files: '\\.(js|jse|vbs|vbe|wsf|hta)$', strings: ['/WScript\\.Shell/i', '/(MSXML2\\.XMLHTTP|WinHttp\\.WinHttpRequest)/i', '/(\\.Run|ShellExecute)\\s*\\(/i'], need: 2 },
  { name: 'PowerShell encodé', level: 'haute', klass: 'script malveillant', attack: 'T1027', strings: ['/powershell(\\.exe)?\\s+[^\\n]*-(e|enc|encodedcommand)\\s+[A-Za-z0-9+\\/=]{40,}/i'], need: 'un' },
  { name: 'Vol d\'identifiants (Mimikatz)', level: 'critique', klass: 'vol d\'identifiants', attack: 'T1003', strings: ['sekurlsa::logonpasswords', 'lsadump::sam', '/mimikatz(\\.exe)?\\b/i', 'privilege::debug'], need: 2 },
  { name: 'Effacement des sauvegardes Windows', level: 'critique', klass: 'rançongiciel', attack: 'T1490', strings: ['/vssadmin(\\.exe)?\\s+delete\\s+shadows/i', '/wmic\\s+shadowcopy\\s+delete/i', '/bcdedit[^\\n]*recoveryenabled\\s+no/i', '/wbadmin\\s+delete\\s+catalog/i'], need: 'un' },
  { name: 'Demande de rançon', level: 'haute', klass: 'rançongiciel', attack: 'T1486', anywhere: true, strings: ['/(your|all) (files|documents|data) (have been|are|were) encrypted/i', '/(vos|tes) (fichiers|documents|donn(é|e)es) (ont (é|e)t(é|e)|sont) (chiffr|crypt)(é|e)s/i', '/\\b[a-z2-7]{16,56}\\.onion\\b/', '/(decrypt(ion)?|d(é|e)chiffr\\w+)[^\\n]{0,80}(bitcoin|btc|monero|xmr)/i'], need: 2 },
  { name: 'Désactivation des protections', level: 'haute', klass: 'cheval de Troie', attack: 'T1562', strings: ['/Set-MpPreference\\s+-Disable(Realtime|IOAV|Behavior)/i', '/netsh\\s+advfirewall\\s+set\\s+\\w+\\s+state\\s+off/i', '/systemctl\\s+(stop|disable)\\s+(clamav|ufw|firewalld|auditd|apparmor)/', '/setenforce\\s+0/'], need: 'un' },
  { name: 'Enregistreur de frappes', level: 'haute', klass: 'logiciel espion', attack: 'T1056.001', strings: ['/GetAsyncKeyState|SetWindowsHookExA?\\s*\\(\\s*(13|WH_KEYBOARD_LL)/', '/pynput\\.keyboard[\\s\\S]{0,400}(smtplib|requests\\.post|socket\\.)/', '/\\/dev\\/input\\/event\\d[\\s\\S]{0,300}(curl|nc |socket)/'], need: 'un' },
];

// ---------------------------------------------------------------- Heuristiques explicables
const DOUBLE_EXT = /\.(pdf|docx?|xlsx?|jpe?g|png|txt|zip|mp[34])\.(exe|scr|js|vbs|bat|cmd|com|pif|hta|lnk|jar|ps1|msi)$/i;
const F = (threat: string, klass: Klass, score: number, why: string, attack?: string): Finding => ({ threat, by: 'heuristique', klass, score, why, attack, level: score >= 85 ? 'critique' : score >= 60 ? 'haute' : 'moyenne' });
const DOC_EXT: Record<string, RegExp> = { pe: /\.(pdf|docx?|xlsx?|jpe?g|png|gif|txt|mp[34]|csv|html?)$/i, elf: /\.(pdf|docx?|jpe?g|png|txt|mp[34])$/i };

function peInfo(b: Buffer): { sections: Array<{ name: string; entropy: number; exec: boolean; write: boolean }>; imports: number; overlay: number; signed: boolean } | undefined {
  if (b.length < 0x40) return undefined;
  const pe = b.readUInt32LE(0x3c); if (pe + 24 > b.length || b.readUInt32LE(pe) !== 0x4550) return undefined;
  const n = b.readUInt16LE(pe + 6), optSize = b.readUInt16LE(pe + 20), opt = pe + 24, pe64 = b.readUInt16LE(opt) === 0x20b, dd = opt + (pe64 ? 112 : 96);
  const dir = (k: number) => (dd + k * 8 + 8 <= b.length ? b.readUInt32LE(dd + k * 8 + 4) : 0);
  const sections = []; let end = 0;
  for (let i = 0, p = opt + optSize; i < Math.min(n, 30) && p + 40 <= b.length; i++, p += 40) {
    const rawSize = b.readUInt32LE(p + 16), rawPtr = b.readUInt32LE(p + 20), ch = b.readUInt32LE(p + 36);
    end = Math.max(end, rawPtr + rawSize);
    sections.push({ name: lat(b.subarray(p, p + 8)).replace(/\0.*$/, ''), entropy: entropy(b.subarray(rawPtr, Math.min(rawPtr + rawSize, b.length))), exec: Boolean(ch & 0x20000000), write: Boolean(ch & 0x80000000) });
  }
  return { sections, imports: dir(1), overlay: Math.max(0, b.length - end), signed: dir(4) > 0 };
}

/** Texte lisible d'un contenu : UTF-8, ou Latin-1 si ce n'en est pas. */
export const readable = (b: Buffer) => { const u = b.toString('utf8'); return u.includes('\ufffd') ? lat(b) : u; };
/** Les endroits où les fichiers arrivent de l'extérieur : téléchargements, dossiers temporaires, boîte de réception, supports amovibles, captures des pièges. */
export const isArrival = (where: string) => /(^|\/)(tmp|temp|downloads?|t[ée]l[ée]chargements|inbox|dev\/shm|var\/tmp|appdata\/local\/temp|captures?)(\/|$)|^\/(media|run\/media|mnt)\//i.test(where);
/** Indices trouvés dans le contenu, chacun avec son poids et sa raison. `where` : dossier d'origine (les téléchargements et dossiers temporaires pèsent plus). */
export function heuristics(name: string, b: Buffer, type = fileType(b, name), where = ''): Finding[] {
  const out: Finding[] = [], t = lat(b.subarray(0, Math.min(b.length, 2 * 1024 * 1024))), low = t.toLowerCase();
  const risky = isArrival(where);
  if (DOUBLE_EXT.test(name)) out.push(F('Double extension trompeuse', 'cheval de Troie', 65, `« ${name.split('/').pop()} » se fait passer pour un document mais c'est un programme`, 'T1036.007'));
  if (DOC_EXT[type]?.test(name)) out.push({ ...F('Programme déguisé en document', 'cheval de Troie', 90, `le contenu est un programme (${type === 'pe' ? 'Windows' : 'Linux'}) alors que le nom annonce un document`, 'T1036'), sure: risky });
  if (type === 'pe') {
    const pe = peInfo(b);
    if (pe) {
      const packed = pe.sections.filter((s) => s.exec && s.entropy > 7.2), names = pe.sections.map((s) => s.name).join(' ');
      if (/UPX\d|\.themida|\.vmp\d|\.aspack|\.petite|\.enigma|\.MPRESS/i.test(names)) out.push(F('Programme compressé par un outil de dissimulation', 'suspect', 35, `sections « ${names.trim()} » : le code réel est caché (packer)`, 'T1027.002'));
      else if (packed.length) out.push(F('Code chiffré ou compressé', 'suspect', 30, `section exécutable « ${packed[0].name} » d'entropie ${packed[0].entropy.toFixed(1)}/8 : le code réel est caché`, 'T1027.002'));
      if (pe.sections.some((s) => s.exec && s.write)) out.push(F('Section à la fois modifiable et exécutable', 'suspect', 20, 'le programme peut réécrire son propre code en mémoire', 'T1055'));
      if (pe.imports < 60 && packed.length) out.push(F('Presque aucune fonction importée', 'suspect', 15, 'un programme normal déclare les fonctions du système qu\'il utilise'));
      if (!pe.signed && risky) out.push(F('Programme non signé dans un dossier de téléchargement', 'suspect', 15, `programme sans signature d'éditeur, trouvé dans ${where}`));
    }
  }
  if (type === 'elf') {
    if (t.slice(0, 4096).includes('UPX!')) out.push(F('Programme Linux compressé (UPX)', 'suspect', 35, 'le code réel est caché par un compresseur', 'T1027.002'));
    if (risky || /\/\.[^/]+$/.test(name)) out.push(F('Programme dans un dossier temporaire ou caché', 'suspect', 30, `programme Linux ${/\/\.[^/]+$/.test(name) ? 'caché (nom commençant par un point)' : `posé dans ${where}`}`, 'T1564.001'));
  }
  if (['shell', 'python', 'powershell', 'batch', 'script windows', 'javascript', 'php'].includes(type) || (type === 'texte' && !isPassive(name, type))) {
    // Décrire ce que fait un script ne prouve rien (un installateur honnête télécharge et lance, lui aussi) :
    // ces indices pèsent surtout là où les fichiers arrivent de l'extérieur (téléchargements, dossiers temporaires, clés USB).
    const w = (n: number) => (risky ? n : Math.round(n / 2));
    // Téléchargement et exécution enchaînés dans la même commande (et pas « les deux mots quelque part dans le fichier »).
    const cradle = /(\biex\b|invoke-expression)[^\n]{0,120}(downloadstring|downloadfile|invoke-webrequest|\biwr\b|net\.webclient)|(downloadstring|invoke-webrequest|\biwr\b|\birm\b|invoke-restmethod)[^\n]{0,200}\|\s*(iex|invoke-expression)\b|mshta(\.exe)?\s+["']?https?:\/\/|regsvr32[^\n]{0,80}\/i:https?:\/\/|certutil(\.exe)?\s+[^\n]{0,40}-urlcache[^\n]{0,200}https?:\/\/|bitsadmin[^\n]{0,60}\/transfer[^\n]{0,200}https?:\/\/|exec\s*\(\s*(urllib\.request\.urlopen|requests\.get)\s*\(/i.exec(t);
    const dropRun = /(?:curl|wget)\b[^\n]{0,200}?(?:\s-o\s*|\s-O\s*|>\s*)((?:\/tmp|\/dev\/shm|\/var\/tmp)\/[\w.-]+)[\s\S]{0,300}?(?:chmod\s+(?:\+x|[0-7]{3,4})\s+\1|(?:\bsh|\bbash|\bnohup|&&|;|\n)\s*\1(?=\s|$|;|&))/i.test(t);
    const pipeSh = /(curl|wget)\b[^\n|]{0,300}\|\s*(sudo\s+)?(ba|z|da)?sh\b/i.test(t);
    if (cradle) out.push(F('Télécharge et exécute en une seule commande', 'cheval de Troie', w(55), `« ${cradle[0].replace(/\s+/g, ' ').slice(0, 70)} » : le code vient d'Internet et s'exécute aussitôt, sans être montré`, 'T1059'));
    else if (dropRun) out.push(F('Télécharge un programme dans un dossier temporaire et le lance', 'cheval de Troie', w(45), 'le script va chercher un programme sur Internet, le pose dans un dossier temporaire et le lance', 'T1105'));
    else if (pipeSh) out.push(F('Télécharge un script et l\'exécute aussitôt', 'cheval de Troie', w(25), 'le script va chercher du code sur Internet et le lance sans le montrer (des installateurs honnêtes font pareil)', 'T1105'));
    const fetches = Boolean(cradle) || dropRun || pipeSh;
    // Un bloc encodé décodé ET exécuté dans la même expression (les bibliothèques qui embarquent une image ou une police en base64 ne l'exécutent pas).
    const hidden = /((?<![.\w$])(eval|exec|assert|iex|invoke-expression)\b|os\.system|new\s+Function)\s*\(?\s*[^\n;]{0,60}?\b(atob|base64_decode|b64decode|frombase64string)\s*\(|base64\s+(-d|--decode)[^\n|]{0,40}\|\s*(ba|z|da)?sh\b|frombase64string[^\n]{0,200}\|\s*(iex|invoke-expression)\b/i.exec(t);
    if (hidden) out.push(F('Code caché en base64 puis exécuté', 'script malveillant', 45, `« ${hidden[0].replace(/\s+/g, ' ').slice(0, 60)} » : le vrai code est encodé, puis décodé et exécuté`, 'T1027'));
    if (fetches && /(crontab\s+-|\/etc\/cron\.|systemctl\s+enable|\/etc\/rc\.local|>>\s*~?\/?\S*\.(bashrc|profile|zshrc)|reg\s+add\s+[^\n]*\\run\b|schtasks\s+\/create|launchagents|>>\s*\S*authorized_keys)/i.test(t)) out.push(F('S\'installe pour redémarrer tout seul', 'porte dérobée', w(35), 'le script s\'inscrit au démarrage (tâche planifiée, service ou clé SSH ajoutée)', 'T1053'));
    const sends = /(requests\.post|curl\s+[^\n]*(\s-d\s|\s-F\s|--data|--upload-file|\s-T\s)|smtplib|ftplib|socket\.send|invoke-webrequest[^\n]*-method\s+post|invoke-restmethod[^\n]*-method\s+post|telegram\.org\/bot|discord(app)?\.com\/api\/webhooks)/i.test(t);
    if (sends && /(login data|cookies\.sqlite|logins\.json|wallet\.dat|local state[^\n]{0,80}encrypted_key|keychain-db)/i.test(t)) out.push(F('Lit les mots de passe du navigateur et les envoie ailleurs', 'vol d\'identifiants', 70, 'le script ouvre les fichiers où le navigateur ou un portefeuille range ses secrets, et contient un envoi vers Internet', 'T1555'));
    else if (sends && /(\/etc\/shadow|\.ssh\/id_(rsa|ed25519|ecdsa)|\.aws\/credentials|\.kube\/config|\.docker\/config\.json)/i.test(t)) out.push(F('Lit des clés d\'accès et contient un envoi vers Internet', 'vol d\'identifiants', w(45), 'le script lit des clés (SSH, cloud) ou le fichier des mots de passe du système, et envoie des données vers Internet', 'T1552'));
    if (sends && /(imagegrab\.grab|screencapture\s|import\s+pyscreenshot|copyfromscreen)/i.test(t)) out.push(F('Capture l\'écran et l\'envoie', 'logiciel espion', 55, 'le script prend des captures d\'écran et les envoie sur Internet', 'T1113'));
    if (/(history\s+-c\b|shred\s+[^\n]*(\.bash_history|\/var\/log)|rm\s+(-rf?\s+)?\/var\/log\/|wevtutil\s+cl\b|clear-eventlog)/i.test(t)) out.push(F('Efface ses traces', 'suspect', w(35), 'le script supprime l\'historique ou les journaux du système', 'T1070'));
    const hexish = (t.match(/\\x[0-9a-f]{2}/gi) ?? []).length, chr = (t.match(/chr\(\d+\)|String\.fromCharCode\(\d|\[char\]\d+/gi) ?? []).length;
    if ((hexish > 400 && hexish * 4 > t.length / 3) || chr > 60) out.push(F('Code volontairement illisible', 'script malveillant', 30, `${hexish > 400 ? `${hexish} caractères écrits en hexadécimal` : `${chr} caractères construits un par un`} : le code cherche à cacher ce qu'il fait`, 'T1027'));
  }
  if (['word', 'excel', 'powerpoint', 'ole', 'rtf'].includes(type)) {
    const macro = t.includes('vbaProject.bin') || (type === 'ole' && /_VBA_PROJECT|\x00V\x00B\x00A\x00/.test(t));
    if (macro) out.push(F('Document avec macros', 'document piégé', 25, 'le document contient du code (macros) qui peut s\'exécuter à l\'ouverture', 'T1204.002'));
    if (macro && /(auto_?open|document_open|workbook_open|autoexec)/i.test(t)) out.push(F('Macro lancée dès l\'ouverture', 'document piégé', 30, 'le code du document démarre tout seul quand on l\'ouvre', 'T1204.002'));
    if (macro && /(wscript\.shell|powershell|urldownloadtofile|createobject|shell\s*\(|msxml2\.xmlhttp)/i.test(t)) out.push(F('Macro qui lance des commandes', 'document piégé', 40, 'le code du document peut télécharger ou lancer un programme', 'T1059.005'));
    if (/ddeauto|\\ddeauto|dde\s+"?cmd/i.test(t)) out.push(F('Document qui lance une commande (DDE)', 'document piégé', 60, 'un champ du document lance une commande du système à l\'ouverture', 'T1559.002'));
    if (type === 'rtf' && /(\\objupdate|equation\.3|\\objemb[\s\S]{0,200}d0cf11e0)/i.test(low)) out.push(F('Document RTF avec objet piégé', 'exploit', 60, 'un objet incrusté se met à jour tout seul (technique des failles de l\'éditeur d\'équations)', 'T1203'));
  }
  if (type === 'pdf') {
    const js = /\/(JavaScript|JS)\b/.test(t), open = /\/(OpenAction|AA)\b/.test(t), launch = /\/Launch\b/.test(t), emb = /\/EmbeddedFile\b/.test(t);
    if (launch) out.push(F('PDF qui lance un programme', 'document piégé', 60, 'le PDF contient une action « Launch » : il demande à ouvrir un programme', 'T1204.002'));
    if (js && open) out.push(F('PDF avec script lancé à l\'ouverture', 'document piégé', 45, 'du JavaScript s\'exécute dès l\'ouverture du PDF', 'T1203'));
    else if (js) out.push(F('PDF avec script', 'document piégé', 15, 'le PDF contient du JavaScript'));
    if (emb && /\.(exe|scr|js|vbs|bat|jar|lnk|hta)\b/i.test(t)) out.push(F('PDF avec programme incrusté', 'document piégé', 45, 'un programme est caché dans le PDF', 'T1204.002'));
  }
  if (type === 'lnk') {
    const wide = t.replace(/\0/g, '');
    if (/(powershell|cmd(\.exe)?\s+\/c|mshta|wscript|cscript|rundll32|regsvr32|certutil|bitsadmin)/i.test(wide)) out.push(F('Raccourci qui lance une commande', 'cheval de Troie', /https?:\/\//i.test(wide) ? 75 : 55, 'le raccourci n\'ouvre pas un document : il lance une commande du système', 'T1204.002'));
  }
  if (type === 'html' || type === 'eml') out.push(...phishing(readable(b.subarray(0, Math.min(b.length, 2 * 1024 * 1024))), type));
  return out;
}

const BRANDS = ['paypal', 'microsoft', 'office365', 'outlook', 'apple', 'icloud', 'google', 'amazon', 'netflix', 'facebook', 'instagram', 'whatsapp', 'dhl', 'chronopost', 'colissimo', 'laposte', 'ameli', 'impots', 'caf', 'orange', 'sfr', 'bouygues', 'free', 'credit-agricole', 'creditagricole', 'societegenerale', 'bnp', 'banquepostale', 'lcl', 'boursorama', 'binance', 'coinbase', 'metamask', 'docusign', 'dropbox', 'linkedin', 'steam'];
const BAD_TLD = /\.(zip|mov|top|xyz|tk|gq|cf|ml|ga|click|country|kim|work|rest|cam|icu|cyou|quest|sbs|cfd)$/i;
/** Les vrais sites des marques les plus imitées : jamais signalés. */
const BRAND_SITES = new Set(['paypal.com', 'paypal.me', 'paypalobjects.com', 'microsoft.com', 'microsoftonline.com', 'office.com', 'office365.com', 'live.com', 'outlook.com', 'windows.net', 'apple.com', 'icloud.com', 'google.com', 'google.fr', 'googleapis.com', 'gstatic.com', 'googleusercontent.com', 'google-analytics.com', 'googletagmanager.com', 'googlesyndication.com', 'youtube.com', 'amazon.com', 'amazon.fr', 'amazonaws.com', 'netflix.com', 'facebook.com', 'fb.com', 'instagram.com', 'whatsapp.com', 'whatsapp.net', 'dhl.com', 'dhl.fr', 'chronopost.fr', 'colissimo.fr', 'laposte.fr', 'laposte.net', 'ameli.fr', 'impots.gouv.fr', 'caf.fr', 'orange.fr', 'orange.com', 'sfr.fr', 'bouyguestelecom.fr', 'free.fr', 'credit-agricole.fr', 'societegenerale.fr', 'societegenerale.com', 'bnpparibas.com', 'mabanque.bnpparibas', 'labanquepostale.fr', 'lcl.fr', 'boursorama.com', 'boursobank.com', 'binance.com', 'coinbase.com', 'metamask.io', 'docusign.com', 'docusign.net', 'dropbox.com', 'linkedin.com', 'steampowered.com', 'steamcommunity.com', 'github.com', 'githubusercontent.com']);
/** Marques qui sont aussi des mots courants : signalées seulement à côté d'un mot « rassurant ». */
const COMMON_BRANDS = new Set(['free', 'orange', 'apple', 'steam']);
const TRUST = /^(login|signin|verify|verif|verification|secure|securite|security|account|compte|client|clients|service|support|assistance|facture|livraison|suivi|update|confirm|espace|id|auth|wallet|pay|bank|banque|remboursement|colis)$/;
const SLD2 = /^(gouv|asso|com|co|org|net|ac|edu|gov)\.[a-z]{2}$/;
/** Le nom que le propriétaire a réellement acheté : « secure-login.xyz » dans « paypal.com.secure-login.xyz ». */
export function regDomain(host: string): string { const l = host.toLowerCase().split('.'), two = l.slice(-2).join('.'); return l.length > 2 && SLD2.test(two) ? l.slice(-3).join('.') : two; }
/** Lettres remplacées par des chiffres ou des jumeaux (paypa1, g00gle, arnazon) : les deux lectures possibles. */
const unleet = (x: string): string[] => { const base = x.replace(/0/g, 'o').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/rn/g, 'm').replace(/vv/g, 'w'); return [base.replace(/1/g, 'l'), base.replace(/1/g, 'i')]; };
/** Analyse d'une adresse web : chaque point vient avec sa raison. */
export function urlRisk(url: string): Finding[] {
  let u: URL; try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`); } catch { return [F('Adresse illisible', 'hameçonnage', 30, 'cette adresse n\'a pas une forme normale')]; }
  const out: Finding[] = [], host = u.hostname.toLowerCase(), labels = host.split('.'), reg = regDomain(host), real = BRAND_SITES.has(reg);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) out.push(F('Adresse sans nom de site', 'hameçonnage', 30, `le lien pointe vers un numéro (${host}) au lieu d'un nom de site`, 'T1566.002'));
  if (labels.some((l) => l.startsWith('xn--'))) out.push(F('Nom de site en caractères spéciaux', 'hameçonnage', 35, 'le nom utilise des caractères d\'un autre alphabet qui imitent des lettres normales', 'T1036'));
  if (u.username || /@/.test(url.replace(/^[a-z]+:\/\//i, '').split('/')[0])) out.push(F('Adresse trompeuse avec « @ »', 'hameçonnage', 40, 'ce qui précède « @ » n\'est qu\'un décor : le vrai site est après', 'T1566.002'));
  if (!real && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const own = reg.split('.')[0], sub = labels.slice(0, labels.length - reg.split('.').length), toks = (l: string) => l.split('-').filter(Boolean), subTok = sub.flatMap(toks), ownTok = toks(own);
    const inside = (label: string, tk: string[], b: string) => tk.includes(b) || (b.length >= 7 && label.includes(b));
    // 1. La marque est dans un sous-domaine (« paypal.com.site-inconnu.xyz »), ou collée à d'autres mots (« paypal-secure.com »).
    const brand = BRANDS.find((b) => sub.some((l) => inside(l, toks(l), b)))
      ?? BRANDS.find((b) => own !== b && inside(own, ownTok, b) && (!COMMON_BRANDS.has(b) || [...ownTok, ...subTok].some((w) => TRUST.test(w))));
    if (brand) out.push(F('Imite une marque connue', 'hameçonnage', 50, `« ${brand} » apparaît dans l'adresse mais le site est en réalité « ${reg} »`, 'T1566.002'));
    else {
      // 2. Lettres remplacées : « paypa1 », « g00gle », « arnazon ».
      const fake = [...subTok, ...ownTok].map((w) => ({ w, b: BRANDS.find((x) => x !== w && x.length >= 5 && unleet(w).includes(x)) })).find((x) => x.b);
      if (fake) out.push(F('Imite une marque en changeant des lettres', 'hameçonnage', 55, `« ${fake.w} » ressemble à « ${fake.b} », avec des lettres remplacées`, 'T1566.002'));
    }
  }
  if (BAD_TLD.test(host)) out.push(F('Extension de site souvent utilisée par les arnaques', 'hameçonnage', 15, `les sites en « .${labels.at(-1)} » servent très souvent aux arnaques`));
  if (labels.length > 5) out.push(F('Nom de site à rallonge', 'hameçonnage', 15, `${labels.length} niveaux dans le nom : une technique pour cacher le vrai site`));
  if (!real && /(login|signin|verify|secure|account|update|confirm|connexion|verification|compte|securite)/i.test(host) && (labels.length > 2 || host.includes('-'))) out.push(F('Mots rassurants dans le nom du site', 'hameçonnage', 15, 'des mots comme « secure », « login » ou « compte » dans le nom du site servent à mettre en confiance'));
  if (/\.(exe|scr|msi|apk|bat|ps1|vbs|js|jar|iso|img|lnk)(\?|$)/i.test(u.pathname)) out.push(F('Lien direct vers un programme', 'cheval de Troie', 30, 'le lien télécharge un programme, pas une page', 'T1204.001'));
  return out;
}
const COMMON_TLD = /\.(com|net|org|fr|io|co|uk|de|es|it|eu|info|biz|be|ch|ca|us|app|dev|me|tv|re|yt|bank|online|site|shop|store|gouv\.fr|co\.uk|com\.br)$/;
/** « page.html » ou « rapport.pdf » ne sont pas des noms de sites. */
const NOT_TLD = /\.(html?|php\d?|aspx?|jsp|pdf|txt|md|js|css|json|xml|png|jpe?g|gif|svg|zip|gz|tar|exe|py|sh|log|csv|docx?|xlsx?|pptx?)$/i;
/** Indices d'hameçonnage dans une page web ou un e-mail (texte brut). */
export function phishing(text: string, type: 'html' | 'eml' | 'texte' = 'texte'): Finding[] {
  const out: Finding[] = [];
  const pwd = /<input[^>]+type\s*=\s*["']?password/i.test(text), action = /<form[^>]+action\s*=\s*["']?([^"'\s>]+)/i.exec(text)?.[1] ?? '';
  if (pwd && /^(https?:)?\/\//i.test(action)) out.push(F('Formulaire qui envoie le mot de passe ailleurs', 'hameçonnage', 45, `le mot de passe saisi part vers ${action.replace(/^(https?:)?\/\//, '').split('/')[0]}`, 'T1566'));
  const title = /<title[^>]*>([^<]{0,200})/i.exec(text)?.[1]?.toLowerCase() ?? '', brand = BRANDS.find((b) => new RegExp(`(^|[^a-z])${b}([^a-z]|$)`).test(title));
  if (pwd && brand && type === 'html') out.push(F('Page de connexion au nom d\'une marque', 'hameçonnage', 30, `la page se présente comme « ${brand} » et demande un mot de passe : une vraie page de connexion ne s'ouvre pas depuis un fichier`, 'T1566'));
  if (/document\.write\s*\(\s*(unescape|atob|decodeURIComponent)\s*\(|eval\s*\(\s*(atob|unescape)\s*\(/i.test(text) && /[A-Za-z0-9+/%]{400,}/.test(text)) out.push(F('Page dont le contenu est caché', 'hameçonnage', 40, 'la page se construit à partir d\'un long bloc codé : son vrai contenu n\'est pas lisible', 'T1027'));
  if (type !== 'html') {
    const from = /^from:.*?<?[\w.+-]+@([\w.-]+)>?/im.exec(text)?.[1]?.toLowerCase(), reply = /^reply-to:.*?<?[\w.+-]+@([\w.-]+)>?/im.exec(text)?.[1]?.toLowerCase();
    if (from && reply && regDomain(reply) !== regDomain(from)) out.push(F('La réponse part vers une autre adresse', 'hameçonnage', 25, `écrit depuis ${from}, mais la réponse irait à ${reply}`, 'T1566'));
    if (/authentication-results:[\s\S]{0,400}(spf|dkim|dmarc)=(fail|softfail|none)/i.test(text)) out.push(F('Expéditeur non authentifié', 'hameçonnage', 25, 'le serveur de messagerie n\'a pas pu vérifier que le message vient bien de l\'expéditeur annoncé (SPF/DKIM/DMARC)', 'T1566'));
    if (/(compte (a [ée]t[ée] |sera )?(suspendu|bloqu[ée]|d[ée]sactiv[ée])|v[ée]rifiez? votre (compte|identit[ée])|facture impay[ée]e|colis (en attente|n'a pas pu)|derni(er|[èe]re) (rappel|avertissement)|your account (has been|will be) (suspended|locked)|verify your (account|identity)|unusual (sign-?in|activity)|gagn[ée] un|remboursement (de|d'un montant))/i.test(text)) out.push(F('Message qui met la pression', 'hameçonnage', 20, 'le message invoque une urgence (compte bloqué, facture, colis) pour faire cliquer sans réfléchir', 'T1566'));
    if (/filename\s*=\s*"?[^"\n]*\.(html?|iso|img|lnk|js|vbs|scr|exe|bat|hta|jar)"?/i.test(text)) out.push(F('Pièce jointe à risque', 'cheval de Troie', 35, 'la pièce jointe est un programme, un raccourci ou une page web locale', 'T1566.001'));
  }
  // Un lien dont le texte affiche un site et la cible en est un autre. Le texte affiché doit être clairement un nom de
  // site (« https://… », « www.… », ou un nom en minuscules avec une extension courante) : « LICENSE.TL » n'en est pas un.
  for (const m of text.matchAll(/<a[^>]+href\s*=\s*["']?(https?:\/\/[^"'\s>]+)[^>]*>\s*(?:<[^>]+>\s*)*((?:https?:\/\/)?(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})/g)) {
    const real = (() => { try { return new URL(m[1]).hostname.toLowerCase(); } catch { return ''; } })(), raw = m[2], shown = raw.replace(/^https?:\/\//i, '').toLowerCase();
    const clear = /^(https?:\/\/|www\.)/i.test(raw) || (raw === raw.toLowerCase() && COMMON_TLD.test(shown));
    if (real && clear && !NOT_TLD.test(shown) && regDomain(real) !== regDomain(shown)) { out.push(F('Lien qui ment sur sa destination', 'hameçonnage', 50, `le lien affiche « ${shown} » mais mène à « ${real} »`, 'T1566.002')); break; }
  }
  const worst = [...text.matchAll(/https?:\/\/[^\s"'<>)]+/gi)].slice(0, 40).flatMap((m) => urlRisk(m[0])).sort((a, b) => b.score - a.score)[0];
  if (worst && worst.score >= 30 && (type !== 'html' || pwd)) out.push({ ...worst, why: `lien ${type === 'html' ? 'de la page' : 'du message'} : ${worst.why}` });
  return out;
}

/** Score global : les indices se cumulent (deux indices moyens font un risque élevé), jamais au-delà de 100. */
export function combine(findings: Finding[]): { score: number; level?: Level } {
  const score = Math.round(100 * (1 - findings.reduce((p, f) => p * (1 - Math.min(f.score, 100) / 100), 1)));
  return { score, level: score >= 85 ? 'critique' : score >= 60 ? 'haute' : score >= 35 ? 'moyenne' : undefined };
}

export interface Knowledge {
  /** empreinte connue comme malveillante ? renvoie la famille si elle est connue */
  hash?(sha: string): { family?: string; source: string } | undefined;
  rules: RuleSet;
  /** exceptions : empreintes et règles à ignorer */
  allowHash?(sha: string): boolean; allowRule?(name: string): boolean;
}
/** Analyse un contenu en mémoire (fichier, pièce jointe, membre d'archive). */
export function scanBuffer(name: string, b: Buffer, k: Knowledge, o: { where?: string; depth?: number } = {}): Verdict {
  const sha = sha256(b), type = fileType(b, name), findings: Finding[] = [], inside: Verdict[] = [];
  if (k.allowHash?.(sha)) return { file: name, sha256: sha, size: b.length, type, score: 0, findings: [], note: 'dans tes exceptions' };
  const known = k.hash?.(sha);
  if (known) findings.push({ threat: known.family ? `Malware connu : ${known.family}` : 'Malware connu', by: 'empreinte', level: 'critique', klass: klassOf(known.family ?? ''), score: 100, why: `son empreinte est dans la base de ${known.source}`, source: known.source, family: known.family, sure: true });
  const h = hay(b.length > 8 * 1024 * 1024 ? b.subarray(0, 8 * 1024 * 1024) : b, name.split(/[!/\\]/).pop() ?? name), passive = isPassive(name, type);
  for (const r of k.rules.match(h)) {
    if (k.allowRule?.(r.name)) continue;
    // Dans un fichier de texte ou de code source, le texte d'une attaque est presque toujours une documentation, un test ou une règle : simple indice.
    // Plusieurs règles dans le même fichier passif ne s'additionnent pas (un fichier de règles ou un cours de sécurité les contient toutes).
    const weak = passive && !r.anywhere, first = weak && !findings.some((f) => f.by === 'règle' && f.score <= 30 && f.klass !== 'test');
    findings.push({ threat: r.name, by: 'règle', level: weak ? 'moyenne' : r.level, klass: r.klass, score: weak ? (first ? 30 : 0) : r.level === 'critique' ? 95 : r.level === 'haute' ? 80 : r.klass === 'test' ? 40 : 50, why: weak ? `contient le texte de la règle « ${r.name} » (${r.source}), mais c'est un fichier de texte ou de code source : sans doute une documentation, un test ou une règle de détection` : `correspond à la règle « ${r.name} » (${r.source})`, source: r.source, attack: r.attack, sure: r.sure && !passive });
  }
  findings.push(...heuristics(name, b, type, o.where));
  const depth = o.depth ?? 0;
  if (depth < 3 && ['zip', 'jar', 'apk', 'word', 'excel', 'powerpoint'].includes(type)) {
    const z = unzip(b);
    if (z.bomb) findings.push(F('Bombe de décompression', 'malware', 70, 'l\'archive grossit plus de 200 fois une fois ouverte : elle sert à saturer la machine ou l\'antivirus', 'T1499'));
    const locked = z.entries.filter((e) => e.encrypted);
    if (locked.length && locked.some((e) => /\.(exe|scr|js|vbs|bat|lnk|iso|msi|dll|ps1)$/i.test(e.name))) findings.push(F('Archive à mot de passe contenant un programme', 'cheval de Troie', 45, 'le mot de passe empêche les antivirus de regarder dedans : c\'est une technique courante d\'envoi de malwares', 'T1027'));
    for (const e of z.entries) if (e.data?.length) { const v = scanBuffer(`${name}!${e.name}`, e.data, k, { where: o.where, depth: depth + 1 }); if (v.findings.length || v.inside?.length) inside.push(v); }
    if (type === 'apk') { const man = z.entries.find((e) => e.name === 'AndroidManifest.xml')?.data; if (man) { const mt = lat(man).replace(/\0/g, ''); const perms = ['RECORD_AUDIO', 'READ_SMS', 'ACCESS_FINE_LOCATION', 'READ_CALL_LOG', 'BIND_ACCESSIBILITY_SERVICE', 'RECEIVE_BOOT_COMPLETED', 'READ_CONTACTS', 'CAMERA'].filter((p) => mt.includes(p)); if (perms.length >= 6 && perms.includes('BIND_ACCESSIBILITY_SERVICE')) findings.push(F('Appli Android aux droits d\'espionnage', 'logiciel espion', 55, `elle demande à la fois : ${perms.join(', ').toLowerCase().replace(/_/g, ' ')}`, 'T1418')); } }
  } else if (depth < 3 && type === 'gzip') {
    try { const g = gunzipSync(b, { maxOutputLength: 48 * 1024 * 1024 }); const v = scanBuffer(name.replace(/\.(gz|tgz)$/i, '') || `${name}!contenu`, g, k, { where: o.where, depth: depth + 1 }); if (v.findings.length || v.inside?.length) inside.push(v); } catch { if (b.length > 1024 && b.length < 1024 * 1024) findings.push(F('Bombe de décompression', 'malware', 60, 'l\'archive dépasse 48 Mo une fois ouverte alors qu\'elle pèse moins d\'1 Mo', 'T1499')); }
  } else if (depth < 3 && type === 'tar') {
    for (const e of untar(b)) if (e.data?.length) { const v = scanBuffer(`${name}!${e.name}`, e.data, k, { where: o.where, depth: depth + 1 }); if (v.findings.length || v.inside?.length) inside.push(v); }
  }
  const all = [...findings, ...inside.flatMap((v) => flat(v))], c = combine(all);
  return { file: name, sha256: sha, size: b.length, type, score: c.score, level: c.level, findings, ...(inside.length ? { inside } : {}) };
}
/** Toutes les trouvailles d'un verdict, y compris dans les archives, avec le chemin interne. */
export const flat = (v: Verdict): Array<Finding & { file: string }> => [...v.findings.map((f) => ({ ...f, file: v.file })), ...(v.inside ?? []).flatMap(flat)];
/** Assez sûr pour agir tout seul (quarantaine) : une empreinte connue ou une règle fiable. Les heuristiques seules demandent ton avis. */
export const sureOf = (v: Verdict) => flat(v).some((f) => f.sure && f.klass !== 'test');
