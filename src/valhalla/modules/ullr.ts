// Ullr — l'antivirus d'Odin : un seul moteur d'analyse pour tout (fichiers, téléchargements à l'arrivée,
// sites web en mode « Níðhögg »), avec trois défenses : empreintes de malwares connus (mises à jour
// chaque jour), règles sur mesure (mode « Galdr », écrites par toi ou par Odin) et heuristiques.
// Quarantaine réversible ; suppression seulement avec ton accord.

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, closeSync, renameSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import type { ModCtx, Module } from '../types.ts';

export interface Rule { name: string; level: 'critique' | 'haute' | 'moyenne'; strings: string[]; need: 'un' | 'tous' | number; files?: string; note?: string }
export interface Hit { file: string; threat: string; by: 'empreinte' | 'règle' | 'heuristique'; level: 'critique' | 'haute' | 'moyenne' }

/** Règles de base (format Galdr). Les chaînes entre / / sont des expressions régulières. */
export const BASE_RULES: Rule[] = [
  { name: 'Test antivirus EICAR', level: 'moyenne', strings: ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'], need: 'un' },
  { name: 'PHP.Webshell (eval encodé)', level: 'critique', files: '\\.(php\\d?|phtml|inc)$', strings: ['/eval\\s*\\(\\s*(base64_decode|gzinflate|str_rot13|gzuncompress)\\s*\\(/i', '/assert\\s*\\(\\s*\\$_(POST|GET|REQUEST)/i', '/preg_replace\\s*\\(\\s*["\'].*\\/e["\']/i'], need: 'un' },
  { name: 'PHP.Webshell (commande depuis la requête)', level: 'critique', files: '\\.(php\\d?|phtml)$', strings: ['/(system|shell_exec|passthru|exec|popen|proc_open)\\s*\\(\\s*\\$_(GET|POST|REQUEST|COOKIE)/i'], need: 'un' },
  { name: 'Shell inversé', level: 'critique', strings: ['/bash -i >& ?\\/dev\\/tcp\\//', '/nc(at)? -e \\/bin\\/(ba)?sh/', '/socket\\.socket\\(.*subprocess\\.call\\(\\[.\\/bin\\/sh/s'], need: 'un' },
  { name: 'Mineur de cryptomonnaie', level: 'haute', strings: ['stratum+tcp://', '/"donate-level"\\s*:/', 'xmrig'], need: 'un' },
  { name: 'Script de téléchargement-exécution', level: 'haute', strings: ['/(curl|wget)[^\\n|]{0,200}\\|\\s*(ba)?sh/', '/chmod \\+x [^\\n;]+;\\s*\\.\\//'], need: 'un', files: '\\.(sh|txt|py|pl)$|^[^.]+$' },
  { name: 'JavaScript Windows malveillant', level: 'haute', files: '\\.(js|jse|vbs|vbe|wsf|hta)$', strings: ['/WScript\\.Shell/i', '/(MSXML2\\.XMLHTTP|WinHttp\\.WinHttpRequest)/i', '/(\\.Run|ShellExecute)\\s*\\(/i'], need: 2 },
  { name: 'PowerShell encodé', level: 'haute', strings: ['/powershell(\\.exe)?\\s+[^\\n]*-(e|enc|encodedcommand)\\s+[A-Za-z0-9+\\/=]{40,}/i'], need: 'un' },
];
const DOUBLE_EXT = /\.(pdf|docx?|xlsx?|jpe?g|png|txt|zip)\.(exe|scr|js|vbs|bat|cmd|com|pif|hta|lnk|jar)$/i;

export function compile(r: Rule): { test(text: string): number } {
  const ms = r.strings.map((x) => { const m = /^\/(.*)\/([gimsuy]*)$/s.exec(x); return m ? new RegExp(m[1], m[2].replace('g', '')) : x; });
  return { test: (t) => ms.filter((m) => (typeof m === 'string' ? t.includes(m) : m.test(t))).length };
}
export function matchRules(file: string, text: string, rules: Rule[]): Array<{ rule: Rule }> {
  return rules.filter((r) => (!r.files || new RegExp(r.files, 'i').test(basename(file)))).filter((r) => { const n = compile(r).test(text); return r.need === 'un' ? n >= 1 : r.need === 'tous' ? n === r.strings.length : n >= r.need; }).map((rule) => ({ rule }));
}
export function heuristics(file: string, head: Buffer): Hit[] {
  const out: Hit[] = [];
  if (DOUBLE_EXT.test(file)) out.push({ file, threat: 'Double extension trompeuse', by: 'heuristique', level: 'haute' });
  if (/\.(docm|xlsm|pptm|doc|xls)$/i.test(file) && head.includes(Buffer.from('vbaProject.bin'))) out.push({ file, threat: 'Document Office avec macros', by: 'heuristique', level: 'moyenne' });
  if (/\.(pdf|jpe?g|png|docx?)$/i.test(file) && head.subarray(0, 2).toString('latin1') === 'MZ') out.push({ file, threat: 'Programme Windows déguisé en document', by: 'heuristique', level: 'critique' });
  return out;
}
const sha256 = (f: string) => new Promise<string>((res, rej) => { const h = createHash('sha256'); createReadStream(f).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
function head(f: string, n: number): Buffer { const fd = openSync(f, 'r'); try { const b = Buffer.alloc(n); const k = readSync(fd, b, 0, n, 0); return b.subarray(0, k); } finally { closeSync(fd); } }

const SKIP = /^\/(proc|sys|dev|run|snap)(\/|$)|\/node_modules\/|\/\.git\//;
export function* walk(root: string, max = 200_000): Generator<string> {
  const stack = [root]; let n = 0;
  while (stack.length && n < max) {
    const d = stack.pop()!;
    let st; try { st = statSync(d); } catch { continue; }
    if (st.isFile()) { n++; yield d; continue; }
    if (!st.isDirectory() || SKIP.test(`${d}/`)) continue;
    let es: string[] = []; try { es = readdirSync(d); } catch { continue; }
    for (const e of es) stack.push(join(d, e));
  }
}

let hashes: Set<string> | undefined;
function hashSet(ctx: ModCtx): Set<string> { if (!hashes) { const f = join(ctx.dir, 'empreintes.txt'); hashes = new Set(existsSync(f) ? readFileSync(f, 'utf8').split('\n').map((l) => l.trim().toLowerCase()).filter((l) => /^[a-f0-9]{64}$/.test(l)) : []); } return hashes; }
export function rules(ctx: ModCtx): Rule[] { return [...BASE_RULES, ...((ctx.settings.rules as Rule[] | undefined) ?? [])]; }

export async function scanFile(ctx: ModCtx, f: string, rs = rules(ctx)): Promise<Hit[]> {
  let st; try { st = statSync(f); } catch { return []; }
  if (!st.isFile() || st.size === 0 || st.size > 100 * 1024 * 1024) return [];
  const out: Hit[] = [];
  try { if (hashSet(ctx).has(await sha256(f))) out.push({ file: f, threat: 'Malware connu (empreinte)', by: 'empreinte', level: 'critique' }); } catch { return []; }
  const h = head(f, Math.min(st.size, 4 * 1024 * 1024));
  out.push(...heuristics(f, h));
  const text = h.toString('latin1');
  for (const { rule } of matchRules(f, text, rs)) out.push({ file: f, threat: rule.name, by: 'règle', level: rule.level });
  return out;
}
export async function scan(ctx: ModCtx, roots: string[], onProgress?: (n: number) => void): Promise<{ files: number; hits: Hit[] }> {
  const rs = rules(ctx), hits: Hit[] = []; let files = 0;
  for (const r of roots) for (const f of walk(r)) { files++; hits.push(...await scanFile(ctx, f, rs)); if (files % 500 === 0) onProgress?.(files); }
  return { files, hits };
}

interface Q { id: string; file: string; threat: string; at: string }
const qdir = (ctx: ModCtx) => { const d = join(ctx.dir, 'quarantaine'); mkdirSync(d, { recursive: true, mode: 0o700 }); return d; };
const qlist = (ctx: ModCtx): Q[] => (ctx.settings.quarantine as Q[] | undefined) ?? [];
export function quarantine(ctx: ModCtx, h: Hit): Q {
  const id = randomBytes(6).toString('hex');
  renameSync(h.file, join(qdir(ctx), id));
  const q = { id, file: h.file, threat: h.threat, at: ctx.now().toISOString() };
  ctx.saveSettings({ quarantine: [...qlist(ctx), q] });
  return q;
}
const PROFILES: Record<string, string[]> = { 'téléchargements': [join(homedir(), 'Téléchargements'), join(homedir(), 'Downloads'), '/tmp'], 'sites web': ['/var/www', '/srv/www', '/srv/http'], 'maison': [homedir()], 'tout': ['/'] };
const s = (v: unknown) => String(v ?? '');
let watchers: FSWatcher[] = [];

async function report(ctx: ModCtx, hits: Hit[], auto: boolean): Promise<string[]> {
  const lines: string[] = [];
  for (const h of hits) {
    let action = 'à décider';
    if (auto && h.level !== 'moyenne') { try { quarantine(ctx, h); action = 'en quarantaine'; } catch { /* droits */ } }
    ctx.alert({ level: h.level, title: `Ullr : ${h.threat}`, detail: `${h.file} — ${action}`, key: `hit:${h.file}:${h.threat}` });
    ctx.emit('menace', { fichier: h.file, menace: h.threat, gravité: h.level, action });
    lines.push(`- [${h.level}] ${h.threat} — ${h.file} (${action})`);
  }
  ctx.saveSettings({ hits: [...hits.map((h) => ({ ...h, at: ctx.now().toISOString() })), ...((ctx.settings.hits as unknown[]) ?? [])].slice(0, 200) });
  return lines;
}

export const ullr: Module = {
  id: 'ullr', name: 'Ullr', family: 'Sécurité',
  what: 'L\'antivirus d\'Odin : un seul moteur pour les fichiers, les téléchargements et les sites web, avec tes propres règles.',
  does: ['empreintes de malwares connus, mises à jour chaque jour', 'règles sur mesure (mode Galdr) : chaînes ou expressions, écrites par toi ou par Odin', 'heuristiques : double extension, programme déguisé en document, macros', 'analyse à l\'arrivée des téléchargements', 'mode Níðhögg : webshells et portes dérobées des sites web', 'quarantaine réversible ; suppression avec ton accord', 'analyse les fichiers capturés par Loki'],
  from: ['ClamAV', 'ClamWin', 'ClamUI', 'YARA', 'Linux Malware Detect'], upstream: ['Cisco-Talos/clamav', 'VirusTotal/yara', 'rfxn/linux-malware-detect'],
  modes: ['Váli · console', 'Galdr · règles sur mesure', 'Níðhögg · sites web', 'Quarantaine'],
  words: ['antivirus', 'virus', 'malware', 'malveillant', 'analyse', 'scanner', 'scan', 'quarantaine', 'webshell', 'regle yara', 'règle', 'infecte', 'infecté'],
  actions: [
    { id: 'analyser', label: 'Analyser', what: 'Analyse un dossier ou un profil (téléchargements, sites web, maison, tout)', params: [{ key: 'cible', label: 'Dossier ou profil', kind: 'text', default: 'téléchargements' }], words: ['analyse', 'scanne', 'verifie', 'vérifie'], run: async (ctx, i) => {
      const t = s(i.cible) || 'téléchargements', roots = (PROFILES[t] ?? [t]).filter(existsSync);
      if (!roots.length) return { ok: false, text: `Rien à analyser : ${t}` };
      const t0 = Date.now(), r = await scan(ctx, roots);
      const lines = await report(ctx, r.hits, ctx.settings.auto !== false);
      ctx.saveSettings({ lastScan: { at: ctx.now().toISOString(), files: r.files, hits: r.hits.length, target: t, ms: Date.now() - t0 } });
      return { text: `🔎 ${r.files} fichiers analysés (${t}) en ${Math.round((Date.now() - t0) / 1000)} s : ${r.hits.length ? `${r.hits.length} menace(s)\n${lines.join('\n')}` : 'rien de dangereux.'}`, data: r };
    } },
    { id: 'fichier', label: 'Analyser un fichier', what: 'Un seul fichier', read: true, params: [{ key: 'chemin', label: 'Fichier', kind: 'text', required: true }], run: async (ctx, i) => { const h = await scanFile(ctx, s(i.chemin)); return { text: h.length ? h.map((x) => `⚠ ${x.threat} (${x.by})`).join('\n') : '✓ Rien de dangereux trouvé.', data: h }; } },
    { id: 'empreintes', label: 'Mettre à jour les empreintes', what: 'Télécharge les empreintes des malwares récents', run: async (ctx) => {
      const r = await ctx.fetch('https://bazaar.abuse.ch/export/txt/sha256/recent/', { signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(`liste indisponible (${r.status})`);
      const fresh = (await r.text()).split('\n').map((l) => l.trim().toLowerCase()).filter((l) => /^[a-f0-9]{64}$/.test(l));
      const set = hashSet(ctx); for (const x of fresh) set.add(x);
      writeFileSync(join(ctx.dir, 'empreintes.txt'), [...set].slice(-2_000_000).join('\n')); ctx.saveSettings({ sigAt: ctx.now().toISOString() });
      return { text: `🛡 ${set.size} empreintes de malwares connues (+${fresh.length} récentes).` };
    } },
    { id: 'regle', label: 'Ajouter une règle (Galdr)', what: 'Nouvelle règle de détection', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'chaines', label: 'Chaînes (une par ligne ; /regex/ possible)', kind: 'textarea', required: true }, { key: 'il_faut', label: 'Il faut', kind: 'select', options: ['un', 'tous'], default: 'un' }, { key: 'gravite', label: 'Gravité', kind: 'select', options: ['moyenne', 'haute', 'critique'], default: 'haute' }], words: ['regle', 'règle', 'galdr', 'signature'], run: (ctx, i) => {
      const r: Rule = { name: s(i.nom), strings: s(i.chaines).split('\n').map((x) => x.trim()).filter(Boolean), need: s(i.il_faut) === 'tous' ? 'tous' : 'un', level: (s(i.gravite) || 'haute') as Rule['level'] };
      for (const x of r.strings) if (/^\/.*\/[a-z]*$/s.test(x)) new RegExp(x.slice(1, x.lastIndexOf('/'))); // vérifie l'expression
      ctx.saveSettings({ rules: [...((ctx.settings.rules as Rule[]) ?? []).filter((x) => x.name !== r.name), r] });
      return { text: `📜 Règle « ${r.name} » ajoutée (${r.strings.length} chaîne(s)).` };
    } },
    { id: 'restaurer', label: 'Sortir de quarantaine', what: 'Remet le fichier à sa place', params: [{ key: 'id', label: 'Identifiant', kind: 'text', required: true }], grave: (i) => `remettre en place le fichier en quarantaine ${s(i.id)}`, run: (ctx, i) => { const q = qlist(ctx).find((x) => x.id === s(i.id)); if (!q) throw new Error('introuvable'); renameSync(join(qdir(ctx), q.id), q.file); ctx.saveSettings({ quarantine: qlist(ctx).filter((x) => x.id !== q.id) }); return { text: `↩ ${q.file} restauré.` }; } },
    { id: 'quarantaine', label: 'Quarantaine', what: 'Fichiers isolés', read: true, run: (ctx) => ({ text: qlist(ctx).map((q) => `- ${q.id} · ${q.threat} · ${q.file}`).join('\n') || 'Quarantaine vide.' }) },
  ],
  start(ctx) {
    for (const w of watchers) w.close(); watchers = [];
    if (ctx.settings.onArrival === false) return;
    for (const d of PROFILES['téléchargements'].filter((x) => existsSync(x) && x !== '/tmp')) {
      try { watchers.push(watch(d, (_e, name) => { if (!name) return; const f = join(d, String(name)); setTimeout(() => { void scanFile(ctx, f).then((h) => (h.length ? report(ctx, h, ctx.settings.auto !== false) : [])); }, 1500); })); } catch { /* pas de surveillance */ }
    }
  },
  stop() { for (const w of watchers) w.close(); watchers = []; },
  view(ctx) {
    const last = ctx.settings.lastScan as { at: string; files: number; hits: number; target: string } | undefined, hits = ((ctx.settings.hits as Array<Hit & { at: string }>) ?? []).slice(0, 40);
    return {
      subtitle: `Empreintes : ${hashSet(ctx).size} (mises à jour ${ctx.settings.sigAt ? new Date(String(ctx.settings.sigAt)).toLocaleString('fr-FR') : 'jamais'}) · ${rules(ctx).length} règles`,
      tabs: ['Váli · console', 'Galdr · règles', 'Níðhögg · sites web', 'Quarantaine'],
      kpis: [{ label: 'Dernière analyse', value: last ? `${last.files} fichiers` : '—', hint: last ? `${last.target} · ${new Date(last.at).toLocaleString('fr-FR')}` : undefined }, { label: 'Menaces trouvées', value: String(last?.hits ?? 0), tone: last?.hits ? 'mauvais' : 'bon' }, { label: 'En quarantaine', value: String(qlist(ctx).length) }, { label: 'Règles Galdr', value: String(rules(ctx).length) }],
      sections: [
        { kind: 'table', title: 'Menaces trouvées', columns: ['Quand', 'Menace', 'Fichier', 'Trouvée par'], empty: '✓ Rien trouvé.', rows: hits.map((h) => ({ cells: [h.at.slice(5, 16).replace('T', ' '), h.threat, h.file, h.by], tone: h.level === 'critique' ? 'mauvais' : 'attention' })) },
        { kind: 'table', title: 'Quarantaine', columns: ['Menace', 'Fichier d\'origine', 'Depuis'], empty: 'Vide.', rows: qlist(ctx).map((q) => ({ cells: [q.threat, q.file, q.at.slice(0, 16).replace('T', ' ')], actions: [{ action: 'restaurer', label: 'Restaurer', input: { id: q.id } }] })) },
        { kind: 'table', title: 'Galdr · règles', columns: ['Règle', 'Gravité', 'Chaînes'], rows: rules(ctx).map((r) => ({ cells: [r.name, r.level, String(r.strings.length)] })) },
      ],
      side: [{ kind: 'form', title: 'Analyser', action: 'analyser', submit: 'Analyser', params: [{ key: 'cible', label: 'Dossier ou profil', kind: 'select', options: Object.keys(PROFILES), default: 'téléchargements' }] }, { kind: 'form', title: 'Galdr · nouvelle règle', action: 'regle', submit: 'Ajouter', params: ullr.actions[3].params! }],
    };
  },
  watch: { every: 3600, async run(ctx) {
    const sig = ctx.settings.sigAt ? Date.parse(String(ctx.settings.sigAt)) : 0;
    if (ctx.now().getTime() - sig > 86_400_000) await Promise.resolve(ullr.actions[2].run(ctx, {})).catch(() => undefined);
    const h = ctx.now().getHours(), lastSite = Number(ctx.settings.siteAt ?? 0);
    if (h === 3 && ctx.now().getTime() - lastSite > 20 * 3600_000) { ctx.saveSettings({ siteAt: ctx.now().getTime() }); await Promise.resolve(ullr.actions[0].run(ctx, { cible: 'sites web' })).catch(() => undefined); }
  } },
};
