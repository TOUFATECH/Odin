// Alchimie · les conversions faites maison, sans aucun outil à installer (idées de Filee, réécrites pour Odin) :
//   - sous-titres : SRT, WebVTT, ASS / SSA, LRC, SAMI, TTML → SRT, WebVTT, ASS, LRC, texte ;
//   - données : JSON, JSON Lines, CSV, TSV, XML, YAML, TOML, Excel (.xlsx) entre eux ;
//   - contacts et agenda : vCard (.vcf) et iCalendar (.ics) ↔ CSV ;
//   - cartes : GeoJSON, KML, GPX entre eux, et vers CSV ;
//   - archives : ZIP, TAR, TAR.GZ entre elles.
// Tout est pur (un contenu entre, un contenu sort) : rien n'est lancé, rien ne sort de la machine.
import { gunzipSync, gzipSync } from 'node:zlib';
import { unzip, zip } from '../../files/zip.ts';
import { lignesCsv, lignesXlsx, xlsx } from '../modules/snotra.ts';

export type FamilleMaison = 'sous-titres' | 'données' | 'contacts' | 'agenda' | 'carte' | 'archive';
const FAM: Record<string, FamilleMaison> = {
  srt: 'sous-titres', vtt: 'sous-titres', ass: 'sous-titres', ssa: 'sous-titres', lrc: 'sous-titres', smi: 'sous-titres', sami: 'sous-titres', ttml: 'sous-titres', dfxp: 'sous-titres',
  json: 'données', jsonl: 'données', ndjson: 'données', csv: 'données', tsv: 'données', xml: 'données', yaml: 'données', yml: 'données', toml: 'données', xlsx: 'données',
  vcf: 'contacts', ics: 'agenda', geojson: 'carte', kml: 'carte', gpx: 'carte', zip: 'archive', tar: 'archive', tgz: 'archive', 'tar.gz': 'archive',
};
/** Ce que chaque famille sait écrire. */
export const CIBLES_MAISON: Record<FamilleMaison, string[]> = {
  'sous-titres': ['srt', 'vtt', 'ass', 'lrc', 'txt'], 'données': ['json', 'jsonl', 'csv', 'tsv', 'xml', 'yaml', 'toml', 'xlsx'],
  contacts: ['csv', 'json', 'vcf'], agenda: ['csv', 'json', 'ics'], carte: ['geojson', 'kml', 'gpx', 'csv'], archive: ['zip', 'tar', 'tar.gz'],
};
/** L'extension qui compte (« sauvegarde.tar.gz » → « tar.gz »). Pur. */
export const extMaison = (nom: string) => { const n = nom.toLowerCase(); return n.endsWith('.tar.gz') ? 'tar.gz' : (/\.([a-z0-9]+)$/.exec(n)?.[1] ?? ''); };
const alias = (e: string) => ({ yml: 'yaml', ndjson: 'jsonl', tgz: 'tar.gz', sami: 'smi', dfxp: 'ttml', ssa: 'ass' } as Record<string, string>)[e] ?? e;
/** La famille d'un fichier qu'Alchimie sait lire elle-même (« sous-titres », « données »…), sinon rien. Pur. */
export const familleMaison = (nom: string): FamilleMaison | undefined => FAM[alias(extMaison(nom))] ?? FAM[extMaison(nom)];
/** Tout ce qu'un fichier de cette famille peut devenir (sans son propre format). Pur. */
export const ciblesMaison = (nom: string): string[] => { const f = familleMaison(nom), de = alias(extMaison(nom)); return f ? [...CIBLES_MAISON[f], ...(f === 'données' ? ['vcf', 'ics', 'geojson', 'kml', 'gpx'] : [])].filter((x) => x !== de) : []; };
/** `JSON.parse`, avec une erreur en français (ligne et colonne quand le moteur les donne). Pur. */
export function lireJson(t: string, quoi = 'JSON'): unknown {
  try { return JSON.parse(t); } catch (e) { const m = /line (\d+) column (\d+)/.exec((e as Error).message); throw new Error(`${quoi} illisible${m ? ` (ligne ${m[1]}, colonne ${m[2]})` : ''} : vérifie les guillemets, les virgules et les accolades`); }
}
/** Alchimie sait-elle faire cette conversion elle-même ? (un CSV vers contacts ou agenda compte aussi). Pur. */
export function peutMaison(nom: string, vers: string): boolean {
  const de = alias(extMaison(nom)), a = alias(vers.toLowerCase().replace(/^\./, '')), f = FAM[de];
  if (!f || de === a) return false;
  // Un tableau (CSV, Excel, JSON…) peut aussi devenir des contacts, un agenda ou une carte.
  if (f === 'données' && (a === 'vcf' || a === 'ics' || a === 'geojson' || a === 'kml' || a === 'gpx')) return true;
  return CIBLES_MAISON[f].includes(a);
}

// ---------------- Sous-titres ----------------
export interface Replique { debut: number; fin: number; texte: string }
/** « 00:01:02,345 », « 1:02.34 », « 12.5s » → millisecondes. Pur. */
export function tempsMs(t: string): number {
  const x = t.trim().replace(',', '.'); if (/^[\d.]+s$/.test(x)) return Math.round(parseFloat(x) * 1000); if (/^[\d.]+ms$/.test(x)) return Math.round(parseFloat(x));
  const p = x.split(':').map(Number); if (p.some((n) => Number.isNaN(n))) return NaN;
  return Math.round((p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0]) * 1000);
}
const deux = (n: number) => String(n).padStart(2, '0');
const hms = (ms: number, sep: string, milli = 3) => { const m = Math.max(0, Math.round(ms)); const h = Math.floor(m / 3600000), mn = Math.floor((m % 3600000) / 60000), s = Math.floor((m % 60000) / 1000), r = m % 1000; return `${deux(h)}:${deux(mn)}:${deux(s)}${sep}${milli === 3 ? String(r).padStart(3, '0') : deux(Math.floor(r / 10))}`; };
const sansBalises = (t: string) => t.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'');
/** Les répliques d'un fichier de sous-titres. Pur. */
export function lireSousTitres(ext: string, brut: string): Replique[] {
  const e = alias(ext.toLowerCase()), t = brut.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n'), out: Replique[] = [];
  if (e === 'srt' || e === 'vtt') {
    for (const bloc of t.split(/\n{2,}/)) {
      const l = bloc.split('\n'), k = l.findIndex((x) => x.includes('-->')); if (k < 0 || /^(NOTE|STYLE|REGION)\b/.test(l[0])) continue;
      const m = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/.exec(l[k]); if (!m) continue;
      const texte = sansBalises(l.slice(k + 1).join('\n')).trim(), debut = tempsMs(m[1]), fin = tempsMs(m[2]);
      if (texte && !Number.isNaN(debut) && !Number.isNaN(fin)) out.push({ debut, fin, texte });
    }
  } else if (e === 'ass') {
    let champs: string[] = [];
    for (const l of t.split('\n')) {
      if (/^Format:/i.test(l) && champs.length === 0 && /Text/i.test(l)) champs = l.slice(7).split(',').map((x) => x.trim().toLowerCase());
      const d = /^Dialogue:\s*(.*)$/i.exec(l); if (!d) continue;
      const f = champs.length ? champs : ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'], p = d[1].split(',');
      const debut = tempsMs(p[f.indexOf('start')] ?? ''), fin = tempsMs(p[f.indexOf('end')] ?? ''), texte = p.slice(f.indexOf('text')).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N|\\n/g, '\n').replace(/\\h/g, ' ').trim();
      if (texte && !Number.isNaN(debut) && !Number.isNaN(fin)) out.push({ debut, fin, texte });
    }
  } else if (e === 'lrc') {
    const l: Array<{ t: number; x: string }> = [];
    for (const ligne of t.split('\n')) { const tags = [...ligne.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)], x = ligne.replace(/\[[^\]]*\]/g, '').trim(); for (const m of tags) l.push({ t: Number(m[1]) * 60000 + Math.round(parseFloat(m[2].replace(':', '.')) * 1000), x }); }
    l.sort((a, b) => a.t - b.t);
    l.forEach((c, k) => { if (c.x) out.push({ debut: c.t, fin: l[k + 1] ? l[k + 1].t : c.t + 4000, texte: c.x }); });
  } else if (e === 'smi') {
    const l = [...t.matchAll(/<SYNC\s+Start\s*=\s*"?(\d+)"?[^>]*>([\s\S]*?)(?=<SYNC\b|<\/BODY>|$)/gi)].map((m) => ({ t: Number(m[1]), x: sansBalises(m[2]).trim() }));
    l.forEach((c, k) => { if (c.x) out.push({ debut: c.t, fin: l[k + 1] ? l[k + 1].t : c.t + 4000, texte: c.x }); });
  } else if (e === 'ttml') {
    for (const m of t.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)) {
      const a = (k: string) => new RegExp(`\\b${k}\\s*=\\s*"([^"]*)"`, 'i').exec(m[1])?.[1], debut = tempsMs(a('begin') ?? ''), dur = a('dur'), fin = a('end') ? tempsMs(a('end')!) : dur ? debut + tempsMs(dur) : debut + 4000, texte = sansBalises(m[2]).replace(/[ \t]*\n[ \t]*/g, '\n').trim();
      if (texte && !Number.isNaN(debut) && !Number.isNaN(fin)) out.push({ debut, fin, texte });
    }
  } else throw new Error(`sous-titres « .${ext} » : format que je ne sais pas lire`);
  return out.sort((a, b) => a.debut - b.debut);
}
/** Écrit des répliques dans le format demandé. Pur. */
export function ecrireSousTitres(vers: string, l: Replique[]): string {
  const v = alias(vers.toLowerCase());
  if (v === 'srt') return `${l.map((c, k) => `${k + 1}\n${hms(c.debut, ',')} --> ${hms(c.fin, ',')}\n${c.texte}`).join('\n\n')}\n`;
  if (v === 'vtt') return `WEBVTT\n\n${l.map((c) => `${hms(c.debut, '.')} --> ${hms(c.fin, '.')}\n${c.texte.replace(/-->/g, '->')}`).join('\n\n')}\n`;
  if (v === 'ass') { const t = (ms: number) => hms(ms, '.', 2).replace(/^0(\d):/, '$1:'); return `[Script Info]\nScriptType: v4.00+\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${l.map((c) => `Dialogue: 0,${t(c.debut)},${t(c.fin)},Default,,0,0,0,,${c.texte.replace(/\n/g, '\\N')}`).join('\n')}\n`; }
  if (v === 'lrc') return `${l.map((c) => `[${deux(Math.floor(c.debut / 60000))}:${deux(Math.floor((c.debut % 60000) / 1000))}.${deux(Math.floor((c.debut % 1000) / 10))}]${c.texte.replace(/\n/g, ' ')}`).join('\n')}\n`;
  if (v === 'txt') return `${l.map((c) => c.texte).join('\n')}\n`;
  throw new Error(`sous-titres : je ne sais pas écrire en « ${vers} »`);
}

// ---------------- Données : YAML, TOML, XML faits maison ----------------
type Val = string | number | boolean | null | Val[] | { [k: string]: Val };
const estObjet = (v: unknown): v is Record<string, Val> => typeof v === 'object' && v !== null && !Array.isArray(v);
function scalaire(s: string): Val {
  const t = s.trim();
  if (t === '' || t === '~' || /^null$/i.test(t)) return null; if (/^(true|yes|on)$/i.test(t)) return true; if (/^(false|no|off)$/i.test(t)) return false;
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return Number(t);
  if (/^"(?:[^"\\]|\\.)*"$/.test(t)) { try { return JSON.parse(t) as string; } catch { return t.slice(1, -1); } }
  if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, '\'');
  return t;
}
/** Coupe « a, "b, c", [d, e] » aux virgules de premier niveau. Pur. */
function couper(s: string, sep = ','): string[] {
  const out: string[] = []; let cur = '', n = 0, q = '';
  for (let k = 0; k < s.length; k++) { const c = s[k];
    if (q) { cur += c; if (c === '\\' && q === '"') { cur += s[++k] ?? ''; } else if (c === q) q = ''; continue; }
    if (c === '"' || c === '\'') { q = c; cur += c; } else if (c === '[' || c === '{') { n++; cur += c; } else if (c === ']' || c === '}') { n--; cur += c; } else if (c === sep && n === 0) { out.push(cur); cur = ''; } else cur += c; }
  if (cur.trim() || out.length) out.push(cur); return out;
}
function flux(s: string): Val {
  const t = s.trim();
  if (t.startsWith('[') && t.endsWith(']')) return couper(t.slice(1, -1)).filter((x) => x.trim() !== '').map(flux);
  if (t.startsWith('{') && t.endsWith('}')) { const o: Record<string, Val> = {}; for (const p of couper(t.slice(1, -1))) { const k = p.indexOf(':'); if (k > 0) o[String(scalaire(p.slice(0, k)))] = flux(p.slice(k + 1)); } return o; }
  return scalaire(t);
}
/** Retire le commentaire d'une ligne. En YAML (`debutSeul`), un guillemet n'ouvre un texte qu'au début d'une valeur : « MOT='a # b' » contient bien un commentaire. */
const sansCommentaire = (l: string, debutSeul = false) => {
  let q = '', avant = '';
  for (let k = 0; k < l.length; k++) { const c = l[k];
    if (q) { if (c === '\\' && q === '"') k++; else if (c === q) q = ''; }
    else if ((c === '"' || c === '\'') && (!debutSeul || avant === '' || /[:\-[{,]/.test(avant))) q = c;
    else if (c === '#' && (k === 0 || /\s/.test(l[k - 1]))) return l.slice(0, k);
    if (!/\s/.test(c)) avant = c; }
  return l;
};
/** Lit du YAML courant : listes, dictionnaires par retrait, textes sur plusieurs lignes (| et >), listes et dictionnaires en ligne. Pur. */
export function lireYaml(texte: string): Val {
  const lignes = texte.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').split('\n').map((brut) => ({ brut, retrait: brut.length - brut.trimStart().length, t: sansCommentaire(brut, true).trim() })).filter((l) => l.t !== '---' && l.t !== '...');
  let i = 0;
  const vide = (k: number) => lignes[k].t === '';
  const bloc = (retrait: number, plie: boolean): string => {
    const part: string[] = []; let base = -1;
    while (i < lignes.length && (lignes[i].brut.trim() === '' || lignes[i].retrait > retrait)) { const l = lignes[i]; if (base < 0 && l.brut.trim() !== '') base = l.retrait; part.push(l.brut.trim() === '' ? '' : l.brut.slice(Math.max(0, base))); i++; }
    while (part.length && part.at(-1) === '') part.pop();
    return plie ? `${part.join('\n').replace(/([^\n])\n(?!\n)/g, '$1 ')}\n` : `${part.join('\n')}\n`;
  };
  const valeur = (reste: string, retrait: number): Val => {
    if (reste === '|' || reste === '>' || /^[|>][+-]?$/.test(reste)) { const x = bloc(retrait, reste[0] === '>'); return reste.endsWith('-') ? x.replace(/\n$/, '') : x; }
    if (reste !== '') return flux(reste);
    while (i < lignes.length && vide(i)) i++;
    if (i < lignes.length && (lignes[i].retrait > retrait || (lignes[i].retrait === retrait && lignes[i].t.startsWith('- ')))) return noeud(lignes[i].retrait);
    return null;
  };
  const noeud = (retrait: number): Val => {
    while (i < lignes.length && vide(i)) i++;
    if (i >= lignes.length) return null;
    if (lignes[i].t.startsWith('- ') || lignes[i].t === '-') {
      const l: Val[] = [];
      while (i < lignes.length) { if (vide(i)) { i++; continue; } const x = lignes[i]; if (x.retrait !== retrait || !(x.t.startsWith('- ') || x.t === '-')) break;
        const reste = x.t.slice(1).trim(), cle = /^("[^"]*"|'[^']*'|[^\s:#][^:]*?):(\s+(.*))?$/.exec(reste);
        if (cle && !/^[[{"']/.test(reste.replace(/^("[^"]*"|'[^']*')/, ''))) {   // « - nom: x » : un dictionnaire commence sur la ligne du tiret
          const dec = retrait + 2; lignes[i] = { brut: `${' '.repeat(dec)}${reste}`, retrait: dec, t: reste }; l.push(noeud(dec));
        } else { i++; l.push(valeur(reste, retrait)); }
      }
      return l;
    }
    const o: Record<string, Val> = {};
    while (i < lignes.length) { if (vide(i)) { i++; continue; } const x = lignes[i]; if (x.retrait !== retrait) break;
      const m = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^:]+?):(?:\s+(.*))?$/.exec(x.t); if (!m) throw new Error(`YAML : ligne ${lignes.indexOf(x) + 1} illisible (« ${x.t.slice(0, 40)} »)`);
      i++; o[String(scalaire(m[1]))] = valeur((m[2] ?? '').trim(), retrait);
    }
    return o;
  };
  while (i < lignes.length && vide(i)) i++;
  if (i >= lignes.length) return null;
  if (!/^- |^-$|^("[^"]*"|'[^']*'|[^:]+?):(\s|$)/.test(lignes[i].t)) return flux(lignes[i].t);
  return noeud(lignes[i].retrait);
}
const simple = (s: string) => /^[A-Za-zÀ-ÿ0-9_./@ -]+$/.test(s) && !/^[\s-]|\s$|^(true|false|yes|no|on|off|null|~)$/i.test(s) && !/^-?\d/.test(s) && !/: |#/.test(s);
/** Écrit une valeur en YAML. Pur. */
export function ecrireYaml(v: Val, retrait = 0): string {
  const pad = ' '.repeat(retrait), sc = (x: Val): string => (x === null ? 'null' : typeof x === 'string' ? (simple(x) ? x : JSON.stringify(x)) : String(x));
  if (Array.isArray(v)) return v.length ? v.map((x) => (estObjet(x) && Object.keys(x).length ? `${pad}- ${ecrireYaml(x, retrait + 2).trimStart()}` : Array.isArray(x) && x.length ? `${pad}-\n${ecrireYaml(x, retrait + 2)}` : `${pad}- ${Array.isArray(x) ? '[]' : estObjet(x) ? '{}' : sc(x)}\n`)).join('') : `${pad}[]\n`;
  if (estObjet(v)) return Object.keys(v).length ? Object.entries(v).map(([k, x]) => { const cle = simple(k) ? k : JSON.stringify(k); return (estObjet(x) && Object.keys(x).length) || (Array.isArray(x) && x.length) ? `${pad}${cle}:\n${ecrireYaml(x, retrait + 2)}` : typeof x === 'string' && x.includes('\n') ? `${pad}${cle}: |${x.endsWith('\n') ? '' : '-'}\n${x.replace(/\n$/, '').split('\n').map((l) => `${pad}  ${l}`).join('\n')}\n` : `${pad}${cle}: ${Array.isArray(x) ? '[]' : estObjet(x) ? '{}' : sc(x)}\n`; }).join('') : `${pad}{}\n`;
  return `${pad}${sc(v)}\n`;
}
/** Lit du TOML courant : clés, [tables], [[listes de tables]], textes, nombres, listes, tables en ligne. Pur. */
export function lireToml(texte: string): Record<string, Val> {
  const racine: Record<string, Val> = {}; let ici: Record<string, Val> = racine;
  const chemin = (s: string) => couper(s, '.').map((p) => String(scalaire(p.trim())));
  const aller = (base: Record<string, Val>, cles: string[], liste = false): Record<string, Val> => {
    let o = base;
    cles.forEach((k, n) => { const dernier = n === cles.length - 1;
      if (liste && dernier) { if (!Array.isArray(o[k])) o[k] = []; const x: Record<string, Val> = {}; (o[k] as Val[]).push(x); o = x; return; }
      const cur = o[k]; if (Array.isArray(cur)) { o = cur.at(-1) as Record<string, Val>; return; } if (!estObjet(cur)) o[k] = {}; o = o[k] as Record<string, Val>; });
    return o;
  };
  const val = (s: string): Val => {
    const t = s.trim();
    if (/^"""/.test(t)) return t.replace(/^"""\n?/, '').replace(/"""$/, '').replace(/\\\n\s*/g, ''); if (/^'''/.test(t)) return t.replace(/^'''\n?/, '').replace(/'''$/, '');
    if (t.startsWith('[')) return couper(t.slice(1, t.lastIndexOf(']'))).filter((x) => x.trim() !== '').map(val);
    if (t.startsWith('{')) { const o: Record<string, Val> = {}; for (const p of couper(t.slice(1, t.lastIndexOf('}')))) { const k = p.indexOf('='); if (k > 0) aller(o, chemin(p.slice(0, k).trim()).slice(0, -1))[chemin(p.slice(0, k).trim()).at(-1)!] = val(p.slice(k + 1)); } return o; }
    if (/^'.*'$/.test(t)) return t.slice(1, -1);
    if (/^[+-]?\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?$/.test(t)) return Number(t.replace(/_/g, ''));
    if (/^(true|false)$/.test(t)) return t === 'true';
    return scalaire(t);
  };
  const lignes = texte.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lignes.length; i++) {
    let l = sansCommentaire(lignes[i]).trim(); if (!l) continue;
    const tt = /^\[\[(.+)\]\]$/.exec(l), tb = /^\[(.+)\]$/.exec(l);
    if (tt) { ici = aller(racine, chemin(tt[1]), true); continue; } if (tb) { ici = aller(racine, chemin(tb[1])); continue; }
    const eq = (() => { let q = ''; for (let k = 0; k < l.length; k++) { const c = l[k]; if (q) { if (c === q) q = ''; } else if (c === '"' || c === '\'') q = c; else if (c === '=') return k; } return -1; })();
    if (eq < 0) throw new Error(`TOML : ligne ${i + 1} illisible (« ${l.slice(0, 40)} »)`);
    let v = l.slice(eq + 1).trim();
    // Texte ou liste sur plusieurs lignes : on rassemble jusqu'à la fermeture.
    const ouvre = /^("""|''')/.exec(v)?.[1];
    if (ouvre && !(v.length >= 6 && v.endsWith(ouvre))) { v = lignes[i].slice(lignes[i].indexOf('=') + 1).trim(); while (i + 1 < lignes.length && !lignes[i + 1].includes(ouvre)) v += `\n${lignes[++i]}`; if (i + 1 < lignes.length) v += `\n${lignes[++i]}`; }
    else if (v.startsWith('[')) { const ouvert = (x: string) => { let n = 0, q = ''; for (const c of x) { if (q) { if (c === q) q = ''; } else if (c === '"' || c === '\'') q = c; else if (c === '[') n++; else if (c === ']') n--; } return n > 0; }; while (ouvert(v) && i + 1 < lignes.length) v += ` ${sansCommentaire(lignes[++i]).trim()}`; }
    const cles = chemin(l.slice(0, eq).trim()); aller(ici, cles.slice(0, -1))[cles.at(-1)!] = val(v);
  }
  return racine;
}
/** Écrit un dictionnaire en TOML. Pur. */
export function ecrireToml(o: Record<string, Val>, prefixe = ''): string {
  const cle = (k: string) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k));
  const val = (v: Val): string => (v === null ? '""' : typeof v === 'string' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(val).join(', ')}]` : estObjet(v) ? `{ ${Object.entries(v).map(([k, x]) => `${cle(k)} = ${val(x)}`).join(', ')} }` : String(v));
  const tablesListe = (v: Val): v is Record<string, Val>[] => Array.isArray(v) && v.length > 0 && v.every(estObjet);
  let out = '';
  for (const [k, v] of Object.entries(o)) if (!estObjet(v) && !tablesListe(v)) out += `${cle(k)} = ${val(v)}\n`;
  for (const [k, v] of Object.entries(o)) {
    const nom = `${prefixe}${cle(k)}`;
    if (estObjet(v)) { const corps = ecrireToml(v, `${nom}.`); out += `${out ? '\n' : ''}[${nom}]\n${corps}`; }
    else if (tablesListe(v)) for (const x of v) out += `${out ? '\n' : ''}[[${nom}]]\n${ecrireToml(x, `${nom}.`)}`;
  }
  return out;
}
const echXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const desXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
/** Lit du XML : chaque élément devient un dictionnaire (« @attribut », « #text » pour le texte, les éléments répétés en liste). Pur. */
export function lireXml(texte: string): Record<string, Val> {
  const t = texte.replace(/^\ufeff/, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
  let i = 0;
  const element = (): [string, Val] => {
    const m = /^<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/.exec(t.slice(i)); if (!m) throw new Error('XML illisible');
    i += m[0].length; const o: Record<string, Val> = {};
    for (const a of m[2].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) o[`@${a[1]}`] = desXml(a[2] ?? a[3] ?? '');
    if (m[3]) return [m[1], Object.keys(o).length ? o : null];
    let txt = '';
    for (;;) {
      if (i >= t.length) throw new Error(`XML : balise <${m[1]}> jamais fermée`);
      if (t.startsWith('<![CDATA[', i)) { const f = t.indexOf(']]>', i); txt += t.slice(i + 9, f < 0 ? t.length : f); i = f < 0 ? t.length : f + 3; continue; }
      if (t.startsWith('</', i)) { i = t.indexOf('>', i) + 1; break; }
      if (t[i] === '<') { const [k, v] = element(); const cur = o[k]; if (cur === undefined) o[k] = v; else if (Array.isArray(cur)) cur.push(v); else o[k] = [cur, v]; continue; }
      const f = t.indexOf('<', i); txt += desXml(t.slice(i, f < 0 ? t.length : f)); i = f < 0 ? t.length : f;
    }
    const propre = txt.trim();
    if (!Object.keys(o).length) return [m[1], propre === '' ? null : scalaireXml(propre)];
    if (propre) o['#text'] = propre;
    return [m[1], o];
  };
  const scalaireXml = (s: string): Val => (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(s) && s.length < 16 ? Number(s) : s === 'true' ? true : s === 'false' ? false : s);
  i = t.search(/<[A-Za-z_]/); if (i < 0) throw new Error('XML : aucun élément trouvé');
  const [k, v] = element(); return { [k]: v };
}
/** Écrit une valeur en XML (une liste répète la balise ; « @x » devient un attribut). Pur. */
export function ecrireXml(v: Val, racine = 'donnees'): string {
  const nom = (k: string) => (/^[A-Za-z_][\w.-]*$/.test(k) ? k : `e_${k.replace(/[^\w.-]/g, '_')}`.slice(0, 60));
  const el = (k: string, x: Val, pad: string): string => {
    if (Array.isArray(x)) return x.map((y) => el(k, y, pad)).join('');
    if (estObjet(x)) { const attrs = Object.entries(x).filter(([a]) => a.startsWith('@')).map(([a, y]) => ` ${nom(a.slice(1))}="${echXml(String(y ?? ''))}"`).join(''), enfants = Object.entries(x).filter(([a]) => !a.startsWith('@') && a !== '#text'), txt = x['#text'];
      if (!enfants.length) return `${pad}<${nom(k)}${attrs}${txt === undefined || txt === null ? '/>' : `>${echXml(String(txt))}</${nom(k)}>`}\n`;
      return `${pad}<${nom(k)}${attrs}>\n${txt !== undefined && txt !== null ? `${pad}  ${echXml(String(txt))}\n` : ''}${enfants.map(([a, y]) => el(a, y, `${pad}  `)).join('')}${pad}</${nom(k)}>\n`; }
    return x === null ? `${pad}<${nom(k)}/>\n` : `${pad}<${nom(k)}>${echXml(String(x))}</${nom(k)}>\n`;
  };
  const cles = estObjet(v) ? Object.keys(v) : [];
  const corps = estObjet(v) && cles.length === 1 && !Array.isArray(v[cles[0]]) ? el(cles[0], v[cles[0]], '') : Array.isArray(v) ? `<${racine}>\n${v.map((x) => el('element', x, '  ')).join('')}</${racine}>\n` : el(racine, v, '');
  return `<?xml version="1.0" encoding="UTF-8"?>\n${corps}`;
}

// ---------------- Données : du tableau à l'objet et retour ----------------
/** Lignes (première = titres) → liste de dictionnaires. Pur. */
export function versObjets(lignes: string[][]): Record<string, Val>[] {
  const [tete, ...reste] = lignes; if (!tete) return [];
  const titres = tete.map((h, k) => h.trim() || `colonne_${k + 1}`);
  return reste.map((r) => Object.fromEntries(titres.map((h, k) => [h, scalaireCsv(r[k] ?? '')])));
}
const scalaireCsv = (s: string): Val => (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(s) && s.length < 16 ? Number(s) : s);
/**
 * Une valeur quelconque → lignes de tableau (titres en premier ; un dictionnaire imbriqué devient « a.b »).
 * `excel` : les textes qui ressemblent à des nombres (« 0976 », « 12 ») sont précédés d'une apostrophe, la façon
 * dont un tableur garde un texte tel quel ; un nombre à virgule (« 5,5 ») reste un nombre. Pur.
 */
export function versLignes(v: Val, excel = false): string[][] {
  const cellule = (x: Val): string => { if (x === null) return ''; if (typeof x !== 'string') return String(x); return excel && /^-?\d+([.,]\d+)?$/.test(x) && !/^-?\d+,\d+$/.test(x) ? `'${x}` : excel && x.startsWith('\'') ? `'${x}` : x; };
  const aplatir = (o: Val, pre = '', out: Record<string, string> = {}): Record<string, string> => {
    if (estObjet(o)) for (const [k, x] of Object.entries(o)) aplatir(x, pre ? `${pre}.${k}` : k, out);
    else out[pre || 'valeur'] = Array.isArray(o) ? (o.every((x) => !estObjet(x) && !Array.isArray(x)) ? o.map((x) => (x === null ? '' : String(x))).join(' | ') : JSON.stringify(o)) : cellule(o);
    return out;
  };
  // Un dictionnaire qui ne contient qu'une liste (« { clients: [...] } », ou « { racine: { ligne: [...] } } ») : c'est la liste qu'on veut en tableau.
  const seule = (o: Val): Val[] | undefined => { if (!estObjet(o)) return undefined; const x = Object.values(o); return x.length === 1 ? (Array.isArray(x[0]) ? x[0] : seule(x[0])) : undefined; };
  const liste: Val[] = Array.isArray(v) ? v : seule(v) ?? [v];
  const plats = liste.map((x) => aplatir(x)), titres = [...new Set(plats.flatMap((p) => Object.keys(p)))];
  return [titres, ...plats.map((p) => titres.map((h) => p[h] ?? ''))];
}
const champCsv = (s: string, sep: string) => (s.includes(sep) || /["\n\r]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
export const ecrireCsv = (l: string[][], sep = ';') => `${l.map((r) => r.map((c) => champCsv(c, sep)).join(sep)).join('\n')}\n`;
function lireDonnees(ext: string, b: Buffer): Val {
  const e = alias(ext), t = () => b.toString('utf8').replace(/^\ufeff/, '');
  if (e === 'json') return lireJson(t()) as Val;
  if (e === 'jsonl') return t().split('\n').filter((l) => l.trim()).map((l, k) => { try { return JSON.parse(l) as Val; } catch { throw new Error(`JSON Lines : ligne ${k + 1} illisible`); } });
  if (e === 'csv' || e === 'tsv') return versObjets(lignesCsv(t()));
  if (e === 'xlsx') return versObjets(lignesXlsx(b));
  if (e === 'yaml') return lireYaml(t()); if (e === 'toml') return lireToml(t()); if (e === 'xml') return lireXml(t());
  throw new Error(`données « .${ext} » : format que je ne sais pas lire`);
}
function ecrireDonnees(vers: string, v: Val): Buffer {
  const a = alias(vers), txt = (s: string) => Buffer.from(s, 'utf8');
  if (a === 'json') return txt(`${JSON.stringify(v, null, 2)}\n`);
  if (a === 'jsonl') return txt(`${(Array.isArray(v) ? v : [v]).map((x) => JSON.stringify(x)).join('\n')}\n`);
  if (a === 'csv') return txt(`\ufeff${ecrireCsv(versLignes(v), ';')}`); if (a === 'tsv') return txt(ecrireCsv(versLignes(v), '\t'));
  if (a === 'xlsx') return xlsx(versLignes(v, true));
  if (a === 'yaml') return txt(ecrireYaml(v)); if (a === 'xml') return txt(ecrireXml(v));
  if (a === 'toml') { if (!estObjet(v)) return txt(ecrireToml({ element: v })); return txt(ecrireToml(v)); }
  throw new Error(`données : je ne sais pas écrire en « ${vers} »`);
}

// ---------------- Contacts (vCard) et agenda (iCalendar) ----------------
const deplier = (t: string) => t.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
const desCal = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const echCal = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
/** Les contacts d'un fichier vCard. Pur. */
export function lireVcard(t: string): Record<string, string>[] {
  return deplier(t).split(/BEGIN:VCARD/i).slice(1).map((bloc) => {
    const o: Record<string, string> = {}, plus = (k: string, v: string) => { if (v) o[k] = o[k] ? `${o[k]} | ${v}` : v; };
    for (const l of bloc.split('\n')) { const m = /^([A-Za-z0-9.-]+)((?:;[^:]*)?):(.*)$/.exec(l); if (!m) continue; const k = m[1].toUpperCase().replace(/^ITEM\d+\./, ''), v = desCal(m[3].trim());
      if (k === 'FN') o.nom = v; else if (k === 'N') { const [nom, prenom] = m[3].split(';').map(desCal); if (!o.nom) o.nom = [prenom, nom].filter(Boolean).join(' '); o.nom_de_famille = nom ?? ''; o.prenom = prenom ?? ''; }
      else if (k === 'TEL') plus('telephone', v); else if (k === 'EMAIL') plus('email', v); else if (k === 'ORG') plus('societe', v.replace(/;+$/, '').replace(/;/g, ' · ')); else if (k === 'TITLE') plus('fonction', v);
      else if (k === 'ADR') plus('adresse', m[3].split(';').map(desCal).filter(Boolean).join(', ')); else if (k === 'BDAY') o.anniversaire = v; else if (k === 'URL') plus('site', v); else if (k === 'NOTE') plus('note', v); }
    return o;
  }).filter((o) => Object.keys(o).length);
}
/** Des lignes de contacts (nom, téléphone, email, société…) → vCard 3.0. Pur. */
export function ecrireVcard(l: Record<string, Val>[]): string {
  const g = (o: Record<string, Val>, ...k: string[]) => { for (const x of Object.keys(o)) if (k.includes(x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, ''))) { const v = o[x]; if (v !== null && v !== '') return String(v); } return ''; };
  return l.map((o) => { const nom = g(o, 'nom', 'name', 'fn', 'nomcomplet') || [g(o, 'prenom', 'firstname'), g(o, 'nomdefamille', 'lastname')].filter(Boolean).join(' '); if (!nom) return '';
    return ['BEGIN:VCARD', 'VERSION:3.0', `FN:${echCal(nom)}`, `N:${echCal(g(o, 'nomdefamille', 'lastname') || nom)};${echCal(g(o, 'prenom', 'firstname'))};;;`,
      ...g(o, 'telephone', 'tel', 'phone', 'mobile', 'portable').split('|').map((x) => x.trim()).filter(Boolean).map((x) => `TEL;TYPE=CELL:${x}`), ...g(o, 'email', 'mail', 'courriel').split('|').map((x) => x.trim()).filter(Boolean).map((x) => `EMAIL:${x}`),
      ...(g(o, 'societe', 'entreprise', 'org', 'company') ? [`ORG:${echCal(g(o, 'societe', 'entreprise', 'org', 'company'))}`] : []), ...(g(o, 'fonction', 'title', 'poste') ? [`TITLE:${echCal(g(o, 'fonction', 'title', 'poste'))}`] : []),
      ...(g(o, 'adresse', 'address') ? [`ADR:;;${echCal(g(o, 'adresse', 'address'))};;;;`] : []), ...(g(o, 'site', 'url', 'web') ? [`URL:${g(o, 'site', 'url', 'web')}`] : []), ...(g(o, 'note', 'notes') ? [`NOTE:${echCal(g(o, 'note', 'notes'))}`] : []), 'END:VCARD'].join('\r\n'); }).filter(Boolean).join('\r\n') + '\r\n';
}
const dateCal = (v: string) => { const m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?$/.exec(v.trim()); return m ? (m[4] ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}${m[7] ? ' UTC' : ''}` : `${m[1]}-${m[2]}-${m[3]}`) : v; };
/** Les rendez-vous d'un fichier iCalendar. Pur. */
export function lireIcs(t: string): Record<string, string>[] {
  return deplier(t).split(/BEGIN:VEVENT/i).slice(1).map((bloc) => {
    const o: Record<string, string> = {};
    for (const l of bloc.split(/END:VEVENT/i)[0].split('\n')) { const m = /^([A-Za-z-]+)((?:;[^:]*)?):(.*)$/.exec(l); if (!m) continue; const k = m[1].toUpperCase(), v = desCal(m[3].trim());
      if (k === 'SUMMARY') o.titre = v; else if (k === 'DTSTART') o.debut = dateCal(v); else if (k === 'DTEND') o.fin = dateCal(v); else if (k === 'LOCATION') o.lieu = v; else if (k === 'DESCRIPTION') o.description = v; else if (k === 'RRULE') o.repetition = v; else if (k === 'ORGANIZER') o.organisateur = v.replace(/^mailto:/i, ''); }
    return o;
  }).filter((o) => o.titre || o.debut);
}
/** Des lignes de rendez-vous (titre, début, fin, lieu, description) → iCalendar. Pur. */
export function ecrireIcs(l: Record<string, Val>[], maintenant = new Date()): string {
  const g = (o: Record<string, Val>, ...k: string[]) => { for (const x of Object.keys(o)) if (k.includes(x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, ''))) { const v = o[x]; if (v !== null && v !== '') return String(v); } return ''; };
  const dt = (s: string): { v: string; jour: boolean } | undefined => { const m = /^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d))?/.exec(s.trim()) ?? (() => { const f = /^(\d\d)\/(\d\d)\/(\d{4})(?:[ T](\d\d):(\d\d))?/.exec(s.trim()); return f ? [f[0], f[3], f[2], f[1], f[4], f[5]] as unknown as RegExpExecArray : null; })(); return m ? { v: m[4] ? `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}00` : `${m[1]}${m[2]}${m[3]}`, jour: !m[4] } : undefined; };
  const tampon = maintenant.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ev = l.map((o, k) => { const d = dt(g(o, 'debut', 'start', 'date', 'dtstart')); if (!d) return ''; const f = dt(g(o, 'fin', 'end', 'dtend')), titre = g(o, 'titre', 'summary', 'objet', 'nom', 'sujet') || 'Rendez-vous';
    return ['BEGIN:VEVENT', `UID:odin-${tampon}-${k}@alchimie`, `DTSTAMP:${tampon}`, `DTSTART${d.jour ? ';VALUE=DATE' : ''}:${d.v}`, ...(f ? [`DTEND${f.jour ? ';VALUE=DATE' : ''}:${f.v}`] : []), `SUMMARY:${echCal(titre)}`, ...(g(o, 'lieu', 'location') ? [`LOCATION:${echCal(g(o, 'lieu', 'location'))}`] : []), ...(g(o, 'description', 'note', 'notes') ? [`DESCRIPTION:${echCal(g(o, 'description', 'note', 'notes'))}`] : []), 'END:VEVENT'].join('\r\n'); }).filter(Boolean);
  return `${['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Odin//Alchimie//FR', ...ev, 'END:VCALENDAR'].join('\r\n')}\r\n`;
}

// ---------------- Cartes : GeoJSON, KML, GPX ----------------
export interface Lieu { nom?: string; description?: string; type: 'point' | 'ligne' | 'surface'; points: Array<[number, number, number?]> }   // longitude, latitude, altitude
const attr = (s: string, k: string) => new RegExp(`\\b${k}\\s*=\\s*"([^"]*)"`, 'i').exec(s)?.[1];
const balise = (s: string, k: string) => { const m = new RegExp(`<${k}\\b[^>]*>([\\s\\S]*?)</${k}>`, 'i').exec(s); return m ? desXml(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim() : undefined; };
/** Les lieux d'une carte (points, tracés, surfaces). Pur. */
export function lireCarte(ext: string, t: string): Lieu[] {
  const e = ext.toLowerCase(), out: Lieu[] = [];
  if (e === 'geojson' || e === 'json') {
    const g = lireJson(t.replace(/^\ufeff/, ''), 'carte GeoJSON') as { type: string; features?: unknown[]; geometry?: unknown; properties?: Record<string, unknown>; coordinates?: unknown; geometries?: unknown[] };
    const geo = (x: { type?: string; coordinates?: unknown; geometries?: unknown[] } | null | undefined, p: Record<string, unknown> = {}) => {
      if (!x) return; const nom = p.name ?? p.nom ?? p.title, desc = p.description ?? p.desc, base = { ...(nom !== undefined ? { nom: String(nom) } : {}), ...(desc !== undefined ? { description: String(desc) } : {}) }, c = x.coordinates as never;
      if (x.type === 'Point') out.push({ ...base, type: 'point', points: [c] }); else if (x.type === 'MultiPoint') for (const q of c as Array<[number, number]>) out.push({ ...base, type: 'point', points: [q] });
      else if (x.type === 'LineString') out.push({ ...base, type: 'ligne', points: c }); else if (x.type === 'MultiLineString') for (const q of c as Array<Array<[number, number]>>) out.push({ ...base, type: 'ligne', points: q });
      else if (x.type === 'Polygon') out.push({ ...base, type: 'surface', points: (c as Array<Array<[number, number]>>)[0] ?? [] }); else if (x.type === 'MultiPolygon') for (const q of c as Array<Array<Array<[number, number]>>>) out.push({ ...base, type: 'surface', points: q[0] ?? [] });
      else if (x.type === 'GeometryCollection') for (const q of x.geometries ?? []) geo(q as never, p);
    };
    if (g.type === 'FeatureCollection') for (const f of g.features ?? []) geo((f as { geometry?: never }).geometry, (f as { properties?: Record<string, unknown> }).properties ?? {});
    else if (g.type === 'Feature') geo(g.geometry as never, g.properties ?? {}); else geo(g as never);
  } else if (e === 'kml') {
    for (const m of t.matchAll(/<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi)) {
      const p = m[1], base = { ...(balise(p, 'name') ? { nom: balise(p, 'name')! } : {}), ...(balise(p, 'description') ? { description: balise(p, 'description')! } : {}) };
      const pts = (s: string) => s.trim().split(/\s+/).map((x) => x.split(',').map(Number)).filter((x) => x.length >= 2 && x.every((n) => Number.isFinite(n))).map((x) => (x.length > 2 && x[2] ? [x[0], x[1], x[2]] : [x[0], x[1]]) as [number, number, number?]);
      for (const g of p.matchAll(/<(Point|LineString|LinearRing)\b[^>]*>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/\1>/gi)) { const c = pts(g[2]); if (c.length) out.push({ ...base, type: g[1] === 'Point' ? 'point' : g[1] === 'LinearRing' ? 'surface' : 'ligne', points: c }); }
    }
  } else if (e === 'gpx') {
    const pt = (s: string): [number, number, number?] | undefined => { const la = Number(attr(s, 'lat')), lo = Number(attr(s, 'lon')), el = Number(balise(s, 'ele')); return Number.isFinite(la) && Number.isFinite(lo) ? (Number.isFinite(el) && balise(s, 'ele') !== undefined ? [lo, la, el] : [lo, la]) : undefined; };
    for (const m of t.matchAll(/<wpt\b([^>]*)>([\s\S]*?)<\/wpt>|<wpt\b([^>]*)\/>/gi)) { const p = pt(`${m[1] ?? m[3]}>${m[2] ?? ''}`.replace(/^/, '<x ')); if (p) out.push({ ...(balise(m[2] ?? '', 'name') ? { nom: balise(m[2]!, 'name')! } : {}), ...(balise(m[2] ?? '', 'desc') ? { description: balise(m[2]!, 'desc')! } : {}), type: 'point', points: [p] }); }
    for (const m of t.matchAll(/<(trk|rte)\b[^>]*>([\s\S]*?)<\/\1>/gi)) { const c = [...m[2].matchAll(/<(?:trkpt|rtept)\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:trkpt|rtept)>)/gi)].map((x) => pt(`<x ${x[1]}>${x[2] ?? ''}`)).filter((x): x is [number, number, number?] => Boolean(x)); if (c.length) out.push({ ...(balise(m[2].split(/<trkseg|<rtept|<trkpt/)[0], 'name') ? { nom: balise(m[2].split(/<trkseg|<rtept|<trkpt/)[0], 'name')! } : {}), type: 'ligne', points: c }); }
  } else throw new Error(`carte « .${ext} » : format que je ne sais pas lire`);
  return out.filter((l) => l.points.length && l.points.every((p) => Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90));
}
/** Écrit des lieux dans le format demandé. Pur. */
export function ecrireCarte(vers: string, l: Lieu[]): string {
  const v = vers.toLowerCase(), c = (p: [number, number, number?]) => (p[2] !== undefined ? [p[0], p[1], p[2]] : [p[0], p[1]]);
  if (v === 'geojson') return `${JSON.stringify({ type: 'FeatureCollection', features: l.map((x) => ({ type: 'Feature', properties: { ...(x.nom ? { name: x.nom } : {}), ...(x.description ? { description: x.description } : {}) }, geometry: x.type === 'point' ? { type: 'Point', coordinates: c(x.points[0]) } : x.type === 'ligne' ? { type: 'LineString', coordinates: x.points.map(c) } : { type: 'Polygon', coordinates: [x.points.map(c)] } })) }, null, 2)}\n`;
  if (v === 'kml') { const co = (x: Lieu) => x.points.map((p) => `${p[0]},${p[1]}${p[2] !== undefined ? `,${p[2]}` : ''}`).join(' '); return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n${l.map((x) => `  <Placemark>${x.nom ? `<name>${echXml(x.nom)}</name>` : ''}${x.description ? `<description>${echXml(x.description)}</description>` : ''}${x.type === 'point' ? `<Point><coordinates>${co(x)}</coordinates></Point>` : x.type === 'ligne' ? `<LineString><coordinates>${co(x)}</coordinates></LineString>` : `<Polygon><outerBoundaryIs><LinearRing><coordinates>${co(x)}</coordinates></LinearRing></outerBoundaryIs></Polygon>`}</Placemark>`).join('\n')}\n</Document>\n</kml>\n`; }
  if (v === 'gpx') { const pt = (b: string, p: [number, number, number?], x?: Lieu) => `<${b} lat="${p[1]}" lon="${p[0]}">${p[2] !== undefined ? `<ele>${p[2]}</ele>` : ''}${x?.nom ? `<name>${echXml(x.nom)}</name>` : ''}${x?.description ? `<desc>${echXml(x.description)}</desc>` : ''}</${b}>`; return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Odin Alchimie" xmlns="http://www.topografix.com/GPX/1/1">\n${l.filter((x) => x.type === 'point').map((x) => `  ${pt('wpt', x.points[0], x)}`).join('\n')}${l.some((x) => x.type === 'point') ? '\n' : ''}${l.filter((x) => x.type !== 'point').map((x) => `  <trk>${x.nom ? `<name>${echXml(x.nom)}</name>` : ''}<trkseg>${x.points.map((p) => pt('trkpt', p)).join('')}</trkseg></trk>`).join('\n')}\n</gpx>\n`; }
  if (v === 'csv') return `\ufeff${ecrireCsv([['nom', 'type', 'latitude', 'longitude', 'altitude', 'description'], ...l.flatMap((x) => x.points.map((p) => [x.nom ?? '', x.type, String(p[1]), String(p[0]), p[2] !== undefined ? String(p[2]) : '', x.description ?? '']))])}`;
  throw new Error(`carte : je ne sais pas écrire en « ${vers} »`);
}
/** Des lignes de tableau (latitude, longitude, nom…) → des points. Pur. */
export function lieuxDeLignes(l: Record<string, Val>[]): Lieu[] {
  const g = (o: Record<string, Val>, ...k: string[]) => { for (const x of Object.keys(o)) if (k.includes(x.toLowerCase().replace(/[^a-z]/g, ''))) return o[x]; return undefined; };
  return l.map((o): Lieu | undefined => { const la = Number(String(g(o, 'latitude', 'lat') ?? '').replace(',', '.')), lo = Number(String(g(o, 'longitude', 'lon', 'lng', 'long') ?? '').replace(',', '.')), al = g(o, 'altitude', 'ele', 'alt'), nom = g(o, 'nom', 'name', 'titre'), d = g(o, 'description', 'desc', 'note');
    return Number.isFinite(la) && Number.isFinite(lo) && String(g(o, 'latitude', 'lat') ?? '') !== '' ? { ...(nom ? { nom: String(nom) } : {}), ...(d ? { description: String(d) } : {}), type: 'point', points: [al !== undefined && al !== '' && Number.isFinite(Number(al)) ? [lo, la, Number(al)] : [lo, la]] } : undefined; }).filter((x): x is Lieu => Boolean(x));
}

// ---------------- Archives ----------------
export interface Entree { nom: string; data: Buffer }
/** Écrit une archive tar (format ustar ; noms longs par en-tête PAX). Pur. */
export function ecrireTar(l: Entree[]): Buffer {
  const out: Buffer[] = [];
  const entete = (nom: string, taille: number, type: string) => { const h = Buffer.alloc(512); h.write(nom.slice(0, 100), 0, 'utf8'); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116); h.write(`${taille.toString(8).padStart(11, '0')}\0`, 124); h.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136); h.write('        ', 148); h.write(type, 156); h.write('ustar\0', 257); h.write('00', 263); let s = 0; for (const x of h) s += x; h.write(`${s.toString(8).padStart(6, '0')}\0 `, 148); return h; };
  const bloc = (d: Buffer) => [d, Buffer.alloc((512 - (d.length % 512)) % 512)];
  for (const e of l) {
    const nom = e.nom.replace(/\\/g, '/').replace(/^\/+/, '');
    if (Buffer.byteLength(nom) > 100) { const corps = ` path=${nom}\n`; let n = Buffer.byteLength(corps) + 1; while (String(n).length + Buffer.byteLength(corps) !== n) n++; const d = Buffer.from(`${n}${corps}`); out.push(entete('PaxHeader', d.length, 'x'), ...bloc(d)); }
    out.push(entete(nom, e.data.length, '0'), ...bloc(e.data));
  }
  out.push(Buffer.alloc(1024)); return Buffer.concat(out);
}
/** Lit une archive tar en mémoire (fichiers seulement ; noms longs GNU et PAX compris). Pur. */
export function lireTarMemoire(b: Buffer): Entree[] {
  const out: Entree[] = []; let long: string | undefined;
  for (let p = 0; p + 512 <= b.length;) {
    const h = b.subarray(p, p + 512); if (h.every((x) => x === 0)) break;
    const z = h.indexOf(0), nom0 = h.toString('utf8', 0, z >= 0 && z < 100 ? z : 100), taille = parseInt(h.toString('latin1', 124, 136).replace(/[^0-7]/g, '') || '0', 8), type = String.fromCharCode(h[156] || 48), pre = h.toString('latin1', 257, 262) === 'ustar' ? h.toString('utf8', 345, 500).replace(/\0.*$/, '') : '';
    const d = b.subarray(p + 512, p + 512 + taille); p += 512 + Math.ceil(taille / 512) * 512;
    if (type === 'L') { long = d.toString('utf8').replace(/\0.*$/, ''); continue; }
    if (type === 'x') { long = /\d+ path=([^\n]*)\n/.exec(d.toString('utf8'))?.[1] ?? long; continue; }
    if (type === 'g') continue;
    const nom = (long ?? `${pre ? `${pre}/` : ''}${nom0}`).replace(/^(\.\/)+/, ''); long = undefined;
    if (type === '0' || type === '\0') out.push({ nom, data: Buffer.from(d) });
  }
  return out;
}
/** Un nom d'archive sûr : jamais de chemin qui remonte ou qui part de la racine. Pur. */
export const nomSur = (n: string) => n.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..').join('/');
function lireArchive(ext: string, b: Buffer): Entree[] {
  const e = alias(ext);
  const l = e === 'zip' ? [...unzip(b).entries()].map(([nom, data]) => ({ nom, data })) : e === 'tar' ? lireTarMemoire(b) : e === 'tar.gz' ? lireTarMemoire(gunzipSync(b, { maxOutputLength: 2 * 1024 ** 3 })) : undefined;
  if (!l) throw new Error(`archive « .${ext} » : format que je ne sais pas lire`);
  return l.map((x) => ({ nom: nomSur(x.nom), data: x.data })).filter((x) => x.nom && !x.nom.endsWith('/'));
}
function ecrireArchive(vers: string, l: Entree[]): Buffer {
  const a = alias(vers); if (a === 'zip') return zip(l.map((x) => ({ name: x.nom, data: x.data }))); if (a === 'tar') return ecrireTar(l); if (a === 'tar.gz') return gzipSync(ecrireTar(l));
  throw new Error(`archive : je ne sais pas écrire en « ${vers} »`);
}

// ---------------- Le tout ----------------
/**
 * Convertit un contenu vers un autre format, sans aucun outil extérieur. Rend le nom et le contenu du résultat.
 * Lève une erreur claire si le contenu est illisible ou si la conversion n'a pas de sens.
 */
export function convertirMaison(nom: string, contenu: Buffer, vers: string): { nom: string; data: Buffer } {
  const de = alias(extMaison(nom)), a = alias(vers.toLowerCase().replace(/^\./, '')), f = FAM[de];
  if (!f || !peutMaison(nom, vers)) throw new Error(`je ne sais pas convertir « .${de || '?'} » en « .${a} » moi-même`);
  const base = nom.replace(/\.tar\.gz$/i, '').replace(/\.[^.]+$/, ''), txt = () => contenu.toString('utf8'), out = (d: Buffer | string) => ({ nom: `${base}.${a}`, data: typeof d === 'string' ? Buffer.from(d, 'utf8') : d });
  if (f === 'sous-titres') { const l = lireSousTitres(de, txt()); if (!l.length) throw new Error('aucune réplique trouvée dans ce fichier de sous-titres'); return out(ecrireSousTitres(a, l)); }
  if (f === 'archive') { const l = lireArchive(de, contenu); if (!l.length) throw new Error('archive vide ou illisible'); return out(ecrireArchive(a, l)); }
  if (f === 'contacts') { const l = lireVcard(txt()); if (!l.length) throw new Error('aucun contact trouvé dans ce fichier'); return out(a === 'json' ? `${JSON.stringify(l, null, 2)}\n` : ecrireDonnees(a, l)); }
  if (f === 'agenda') { const l = lireIcs(txt()); if (!l.length) throw new Error('aucun rendez-vous trouvé dans ce fichier'); return out(a === 'json' ? `${JSON.stringify(l, null, 2)}\n` : ecrireDonnees(a, l)); }
  if (f === 'carte') { const l = lireCarte(de, txt()); if (!l.length) throw new Error('aucun lieu trouvé dans cette carte'); return out(ecrireCarte(a, l)); }
  // Données. Un tableau peut aussi devenir des contacts, un agenda ou une carte.
  const v = lireDonnees(de, contenu);
  if (a === 'vcf' || a === 'ics' || a === 'geojson' || a === 'kml' || a === 'gpx') {
    const lignes = (Array.isArray(v) ? v : [v]).filter(estObjet);
    if (a === 'vcf') { const r = ecrireVcard(lignes); if (!/BEGIN:VCARD/.test(r)) throw new Error('aucune colonne « nom » trouvée : il faut au moins nom, et si possible téléphone, email, société'); return out(r); }
    if (a === 'ics') { const r = ecrireIcs(lignes); if (!/BEGIN:VEVENT/.test(r)) throw new Error('aucune colonne « début » lisible : il faut titre et début (2026-11-20 14:00), et si possible fin, lieu, description'); return out(r); }
    const lieux = lieuxDeLignes(lignes); if (!lieux.length) throw new Error('aucune colonne « latitude » et « longitude » trouvée'); return out(ecrireCarte(a, lieux));
  }
  return out(ecrireDonnees(a, v));
}
