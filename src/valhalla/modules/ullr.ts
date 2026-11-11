// Ullr — l'antivirus d'Odin, fait maison. Un seul moteur pour les fichiers, les archives, les
// téléchargements à l'arrivée, les supports amovibles, les sites web, les adresses et les messages.
//   - Connaître : base signée et versionnée (empreintes, indicateurs, règles, failles), nourrie par des
//     sources publiques ; chaque mise à jour est testée avant d'être activée, et annulable.
//   - Détecter : empreintes, règles (Galdr + YARA), heuristiques au score explicable, réputation en ligne
//     d'une empreinte (jamais d'envoi de fichier).
//   - Relier : les signaux de toutes les applis d'Odin deviennent des incidents (Skögul, Geri, Loki,
//     Garmr, Forseti, Eir…).
//   - Répondre : quarantaine réversible quand c'est sûr ; « à vérifier » quand ce n'est qu'un soupçon ;
//     jamais de suppression sans ton accord.
// Aucun antivirus ne détecte tout : Ullr le dit, et montre toujours pourquoi il alerte.

import { createHash, randomBytes } from 'node:crypto';
import { closeSync, createReadStream, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { cpus, homedir, loadavg } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { BASE_RULES, compileGaldr, flat, hay, importYara, phishing, readable, RuleSet, scanBuffer, sureOf, urlRisk, combine, type CRule, type Finding, type Knowledge, type Rule, type Verdict } from '../ullr/engine.ts';
import { Correlator, SENSORS, story, toSignal, type Incident } from '../ullr/incidents.ts';
import { Intel, parseClamHsb, parseHashList, reputation, reputationText, SOURCES, type FetchCtx, type Patch, type Reputation } from '../ullr/intel.ts';
import type { ModCtx, Module } from '../types.ts';

export { BASE_RULES };
export type { Rule };
/** Compatibilité : règles Galdr qui correspondent à un texte. */
export function matchRules(file: string, text: string, rules: Rule[]): Array<{ rule: Rule }> {
  const set = new RuleSet(rules.map(compileGaldr)), names = new Set(set.match(hay(Buffer.from(text, 'latin1'), basename(file))).map((r) => r.name));
  return rules.filter((r) => names.has(r.name)).map((rule) => ({ rule }));
}

const s = (v: unknown) => String(v ?? '');
/** Où ranger une clé de source (le coffre des secrets d'Odin). Branché au démarrage ; absent dans un essai isolé. */
let saveKey: ((name: 'ABUSE_CH_KEY' | 'VT_API_KEY', value: string) => void) | undefined;
export function ullrKeys(fn: typeof saveKey): void { saveKey = fn; }
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
interface Detection { id: string; at: string; file: string; sha256: string; threat: string; klass: string; level: 'critique' | 'haute' | 'moyenne'; score: number; by: string; why: string[]; action: string; attack?: string }
interface Q { id: string; file: string; sha256: string; threat: string; level: string; at: string; size: number }
interface Plan { name: string; target: string; every: 'heure' | 'jour' | 'semaine'; at: string; exclude: string[]; last?: string; /** prochain passage prévu */ next?: string }
/** Le prochain passage d'un plan après `from` : dans une heure, ou à l'heure dite le jour (ou la semaine) qui vient. */
export function nextRun(p: Pick<Plan, 'every' | 'at'>, from: Date, ranAt?: Date): Date {
  if (p.every === 'heure') return new Date(from.getTime() + 3600_000);
  const [h, m] = p.at.split(':').map(Number), d = new Date(from); d.setHours(h, m, 0, 0);
  if (ranAt) { d.setTime(ranAt.getTime()); d.setHours(h, m, 0, 0); d.setDate(d.getDate() + (p.every === 'semaine' ? 7 : 1)); while (d <= from) d.setDate(d.getDate() + (p.every === 'semaine' ? 7 : 1)); return d; }
  if (d <= from) d.setDate(d.getDate() + 1);
  return d;
}
interface Report { id: string; at: string; target: string; plan?: string; files: number; bytes: number; ms: number; state: 'terminé' | 'arrêté'; version: number; detections: Detection[]; errors: string[] }
interface Exceptions { paths: string[]; hashes: string[]; rules: string[] }
interface Running { id: string; target: string; files: number; hits: number; started: number; cancel: boolean }
interface State { intel: Intel; set?: RuleSet; setKey?: string; corr: Correlator; watchers: FSWatcher[]; running?: Running; pending: Map<string, ReturnType<typeof setTimeout>>; bursts: Map<string, number[]>; burstAt: number; mounts?: Set<string>; busy: boolean; /** dernier signal reçu de chaque appli */ seen: Map<string, number> }
const states = new Map<string, State>();
function st(ctx: ModCtx): State {
  let x = states.get(ctx.dir);
  if (!x) { x = { intel: new Intel(ctx.dir), corr: new Correlator((ctx.settings.incidents as Incident[] | undefined) ?? []), watchers: [], pending: new Map(), bursts: new Map(), burstAt: 0, busy: false, seen: new Map() }; x.intel.load(); states.set(ctx.dir, x); }
  return x;
}
const exc = (ctx: ModCtx): Exceptions => ({ paths: [], hashes: [], rules: [], ...((ctx.settings.exceptions as Partial<Exceptions> | undefined) ?? {}) });
const userRules = (ctx: ModCtx): Rule[] => (ctx.settings.rules as Rule[] | undefined) ?? [];
const disabled = (ctx: ModCtx): string[] => (ctx.settings.disabledRules as string[] | undefined) ?? [];
const dets = (ctx: ModCtx): Detection[] => (ctx.settings.hits as Detection[] | undefined) ?? [];
const qlist = (ctx: ModCtx): Q[] => (ctx.settings.quarantine as Q[] | undefined) ?? [];
const plans = (ctx: ModCtx): Plan[] => (ctx.settings.plans as Plan[] | undefined) ?? [];
const reports = (ctx: ModCtx): Array<Omit<Report, 'detections' | 'errors'> & { hits: number }> => (ctx.settings.reports as never[] | undefined) ?? [];
const qdir = (ctx: ModCtx) => { const d = join(ctx.dir, 'quarantaine'); mkdirSync(d, { recursive: true, mode: 0o700 }); return d; };
const fctx = (ctx: ModCtx): FetchCtx => ({ fetch: ctx.fetch, key: (n) => process.env[n] || undefined, url: (id, fb) => s((ctx.settings.urls as Record<string, string> | undefined)?.[id]) || fb, now: () => ctx.now() });
const srcOn = (ctx: ModCtx, id: string) => { const o = (ctx.settings.sources as Record<string, boolean> | undefined)?.[id]; return o ?? Boolean(SOURCES.find((x) => x.id === id)?.on); };

/** Toutes les règles en service : de base, les tiennes (Galdr), et celles importées (YARA), moins celles mises de côté. */
export function ruleSet(ctx: ModCtx, intel = st(ctx).intel): RuleSet {
  const x = st(ctx), off = new Set(disabled(ctx)), key = `${intel.current()}:${JSON.stringify(userRules(ctx)).length}:${off.size}:${intel === x.intel}`;
  if (intel === x.intel && x.set && x.setKey === key) return x.set;
  const all: CRule[] = [...BASE_RULES, ...userRules(ctx)].map(compileGaldr);
  for (const y of intel.yara()) all.push(...importYara(y.text, y.source).rules);
  const set = new RuleSet(all.filter((r) => !off.has(r.name)));
  if (intel === x.intel) { x.set = set; x.setKey = key; }
  return set;
}
/**
 * Les fichiers du moteur lui-même contiennent le texte de ses règles : sans précaution, un antivirus se
 * reconnaît dans son propre code. Leurs empreintes sont relevées au démarrage ; un fichier du moteur
 * modifié ensuite n'est plus couvert et sera analysé comme les autres.
 */
let own: Set<string> | undefined;
function ownFiles(): Set<string> {
  if (own) return own;
  own = new Set();
  const here = dirname(new URL(import.meta.url).pathname);
  for (const d of [here, join(here, '..', 'ullr')]) { try { for (const f of readdirSync(d)) { try { const p = join(d, f); if (statSync(p).isFile()) own.add(createHash('sha256').update(readFileSync(p)).digest('hex')); } catch { /* fichier illisible */ } } } catch { /* dossier absent */ } }
  return own;
}
function knowledge(ctx: ModCtx, intel = st(ctx).intel): Knowledge {
  const e = exc(ctx), hs = new Set(e.hashes), rs = new Set(e.rules), mine = ownFiles();
  return { hash: (h) => intel.hash(h), rules: ruleSet(ctx, intel), allowHash: (h) => hs.has(h) || mine.has(h), allowRule: (n) => rs.has(n) };
}

const SYSTEM = /^\/(usr|bin|sbin|lib|lib32|lib64|libx32|opt|snap|boot|etc|var\/lib)\//;
/** Logiciels courants dont le paquet ne porte pas le même nom que dans le catalogue des failles : [nom dans le catalogue, paquet installé]. */
const KEV_PKG: Array<[RegExp, RegExp]> = [
  [/^linux kernel/, /^linux-kernel$/], [/apache http server/, /^(apache2|httpd)$/], [/openssh/, /^openssh-(server|client)$/], [/openssl/, /^(openssl|libssl[\d.]*)/], [/\bphp\b/, /^php[\d.]*(-|$)/],
  [/gnu c library|glibc/, /^libc6$/], [/\bbash\b/, /^bash$/], [/\bsudo\b/, /^sudo$/], [/polkit|policykit/, /^(polkit|policykit)/], [/\bexim\b/, /^exim4/], [/roundcube/, /^roundcube/], [/\bsamba\b/, /^samba$/],
  [/\bredis\b/, /^redis/], [/postgresql/, /^postgresql/], [/mysql|mariadb/, /^(mysql|mariadb)-server/], [/\bdocker\b/, /^docker(\.io|-ce)?$/], [/node\.?js/, /^nodejs$/], [/chromium|\bchrome\b/, /^(chromium|google-chrome)/],
  [/firefox/, /^firefox/], [/\bgit\b/, /^git$/], [/\bcurl\b/, /^(curl|libcurl)/], [/imagemagick/, /^imagemagick/], [/ghostscript/, /^ghostscript/], [/tomcat/, /^tomcat/], [/jenkins/, /^jenkins$/], [/grafana/, /^grafana/],
  [/gitlab/, /^gitlab/], [/nextcloud/, /^nextcloud/], [/\bplex\b/, /^plexmediaserver/], [/home assistant/, /^homeassistant/], [/proxmox/, /^(pve-manager|proxmox-ve)/], [/webmin/, /^webmin/], [/wordpress/, /^wordpress/],
  [/7-zip/, /^(p7zip|7zip)/], [/openvpn/, /^openvpn/], [/\bsystemd\b/, /^systemd$/], [/\bcups\b/, /^cups/], [/\bvim\b/, /^vim/], [/\bpython\b/, /^python3?(\.\d+)?$/], [/\bnginx\b/, /^nginx/],
];
const TESTS = /\/(tests?|__tests__|spec|specs|fixtures?|testdata|samples?|examples?|exemples?)\//i;
const SKIP = /^\/(proc|sys|dev|run|snap)(\/|$)|\/node_modules\/|\/\.git\/|\/valhalla\/ullr\/(quarantaine|signatures)\//;
/** Parcourt un dossier. Les liens symboliques ne sont pas suivis (pas de boucle, pas de double analyse). */
export function* walk(root: string, exclude: string[] = [], max = 400_000): Generator<string> {
  let first = root; try { first = realpathSync(root); } catch { return; }
  const stack = [first]; let n = 0;
  while (stack.length && n < max) {
    const d = stack.pop()!;
    if (exclude.some((x) => x && (d === x || d.startsWith(x.endsWith('/') ? x : `${x}/`)))) continue;
    let stt; try { stt = lstatSync(d); } catch { continue; }
    if (stt.isFile()) { n++; yield d; continue; }
    if (!stt.isDirectory() || SKIP.test(`${d}/`)) continue;
    let es: string[] = []; try { es = readdirSync(d); } catch { continue; }
    for (const e of es) stack.push(join(d, e));
  }
}
const hashStream = (f: string) => new Promise<string>((res, rej) => { const h = createHash('sha256'); createReadStream(f).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
/** Analyse un fichier du disque. Jusqu'à 48 Mo il est lu en entier ; au-delà, empreinte complète + analyse du début. */
export async function scanPath(ctx: ModCtx, f: string, k = knowledge(ctx)): Promise<Verdict | undefined> {
  let stt; try { stt = statSync(f); } catch { return undefined; }
  if (!stt.isFile() || stt.size === 0 || exc(ctx).paths.some((p) => f === p || f.startsWith(p.endsWith('/') ? p : `${p}/`))) return undefined;
  if (stt.size <= 48 * 1024 * 1024) return { ...scanBuffer(f, readFileSync(f), k, { where: dirname(f) }), file: f };
  const fd = openSync(f, 'r'); let head: Buffer; try { const b = Buffer.alloc(8 * 1024 * 1024); head = b.subarray(0, readSync(fd, b, 0, b.length, 0)); } finally { closeSync(fd); }
  const v = scanBuffer(f, head, k, { where: dirname(f), depth: 3 }), full = await hashStream(f), known = k.hash?.(full);
  if (known) v.findings.unshift({ threat: known.family ? `Malware connu : ${known.family}` : 'Malware connu', by: 'empreinte', level: 'critique', klass: 'malware', score: 100, why: `son empreinte est dans la base de ${known.source}`, source: known.source, family: known.family, sure: true });
  const c = combine(flat(v));
  return { ...v, sha256: full, size: stt.size, score: c.score, level: c.level, note: 'fichier de plus de 48 Mo : empreinte complète, contenu analysé sur les 8 premiers Mo' };
}

// ---------------------------------------------------------------- Quarantaine (réversible)
/** Le fichier est déplacé et rendu inoffensif (octets brouillés) : il ne peut plus être lancé, mais il peut être remis en place. */
function isolate(ctx: ModCtx, file: string, v: { sha256: string; threat: string; level: string }): Q {
  const id = randomBytes(6).toString('hex'), b = readFileSync(file);
  for (let i = 0; i < b.length; i++) b[i] ^= 0xa5;
  writeFileSync(join(qdir(ctx), id), b, { mode: 0o600 }); rmSync(file, { force: true });
  const q: Q = { id, file, sha256: v.sha256, threat: v.threat, level: v.level, at: ctx.now().toISOString(), size: b.length };
  ctx.saveSettings({ quarantine: [...qlist(ctx), q] });
  return q;
}
function release(ctx: ModCtx, id: string): Q {
  const q = qlist(ctx).find((x) => x.id === id || x.file === id); if (!q) throw new Error('introuvable dans la quarantaine');
  const b = readFileSync(join(qdir(ctx), q.id)); for (let i = 0; i < b.length; i++) b[i] ^= 0xa5;
  mkdirSync(dirname(q.file), { recursive: true }); writeFileSync(q.file, b); rmSync(join(qdir(ctx), q.id), { force: true });
  // Un fichier que tu as fait remettre en place n'est pas remis en quarantaine dans ton dos (il reste listé).
  ctx.saveSettings({ quarantine: qlist(ctx).filter((x) => x.id !== q.id), released: [...new Set([q.sha256, ...((ctx.settings.released as string[] | undefined) ?? [])])].filter(Boolean).slice(0, 300) });
  return q;
}

// ---------------------------------------------------------------- Une détection : noter, alerter, répondre
async function handle(ctx: ModCtx, v: Verdict, o: { auto?: boolean; quiet?: boolean } = {}): Promise<Detection | undefined> {
  const all = flat(v); if (!all.length || !v.level) return undefined;
  // Un simple indice faible sur un programme installé par le système (un outil qui télécharge, par exemple) n'est pas une alerte.
  if (!sureOf(v) && v.score < 60 && SYSTEM.test(v.file)) return undefined;
  const top = [...all].sort((a, b) => b.score - a.score)[0];
  let sure = sureOf(v), action = 'à vérifier', level = v.level, extra = '';
  // Soupçon sans preuve : on demande l'avis des bases de réputation (empreinte seulement), si une clé est là.
  if (!sure && v.score >= 60 && ctx.settings.reputation !== false && (process.env.VT_API_KEY || process.env.ABUSE_CH_KEY)) {
    const r = await rep(ctx, v.sha256).catch(() => undefined), t = r ? reputationText(r) : undefined;
    if (t?.malicious) { sure = true; level = 'critique'; extra = t.text; } else if (t?.trusted) { level = 'moyenne'; extra = `${t.text} : probablement une fausse alerte`; }
  }
  const onlyTest = all.every((f) => f.klass === 'test');
  // Dans un dossier de tests ou d'exemples (un projet de développement), une règle peut reconnaître un échantillon voulu : c'est toi qui décides.
  const fixture = TESTS.test(v.file) && !all.some((f) => f.by === 'empreinte');
  if (sure && fixture) extra = extra || 'trouvé dans un dossier de tests ou d\'exemples : je n\'y touche pas sans toi';
  const kept = ((ctx.settings.released as string[] | undefined) ?? []).includes(v.sha256);
  if (kept) { action = 'laissé en place à ta demande (sorti de quarantaine)'; o = { ...o, quiet: true }; }
  else if (sure && !onlyTest && !fixture && (o.auto ?? ctx.settings.auto !== false) && existsSync(v.file) && !v.file.includes('!')) {
    // Par l'action « isoler » : la mise en quarantaine est notée comme une manip (tu peux la garder ou l'annuler).
    const r = await ctx.call('ullr', 'isoler', { fichier: v.file, menace: top.threat }, `${top.threat} (${top.why})`).catch(() => undefined);
    action = r && r.ok !== false ? 'en quarantaine' : 'à isoler (droits insuffisants)';
  } else if (onlyTest) action = 'fichier de test, laissé en place';
  const d: Detection = { id: randomBytes(4).toString('hex'), at: ctx.now().toISOString(), file: v.file, sha256: v.sha256, threat: top.threat, klass: top.klass, level, score: v.score, by: [...new Set(all.map((f) => f.by))].join(' + '), why: [...all.slice(0, 6).map((f) => `${f.threat} : ${f.why}${f.file !== v.file ? ` (dans ${f.file.split('!').slice(1).join(' › ')})` : ''}`), ...(extra ? [extra] : [])], action, attack: top.attack };
  ctx.saveSettings({ hits: [d, ...dets(ctx).filter((x) => !(x.file === d.file && x.threat === d.threat))].slice(0, 300) });
  if (!o.quiet) {
    ctx.alert({ level, title: `Ullr : ${top.threat}`, detail: `${v.file} — ${action}. Score ${v.score}/100. ${d.why.slice(0, 3).join(' ; ')}${action === 'à vérifier' ? ` Dis « isole ${v.file} » pour le mettre à l'écart, ou « faux positif ${d.id} ».` : ''}`, key: `hit:${v.sha256}:${top.threat}`, data: { empreinte: v.sha256, score: v.score } });
    ctx.emit('menace', { fichier: v.file, menace: top.threat, gravité: level, action, score: v.score, empreinte: v.sha256, genre: top.klass });
  }
  return d;
}
async function rep(ctx: ModCtx, sha: string): Promise<Reputation> {
  const cache = (ctx.settings.rep as Record<string, Reputation> | undefined) ?? {};
  if (cache[sha] && ctx.now().getTime() - Date.parse(cache[sha].at) < 7 * 86_400_000) return cache[sha];
  // VirusTotal gratuit : 4 demandes par minute, 500 par jour. On reste en dessous.
  const day = ctx.now().toISOString().slice(0, 10), used = (ctx.settings.vtDay as { day: string; n: number } | undefined)?.day === day ? (ctx.settings.vtDay as { n: number }).n : 0, last = Number(ctx.settings.vtAt ?? 0);
  const vt = used < 450 && ctx.now().getTime() - last > 16_000;
  const r = await reputation(sha, fctx(ctx), { vt, mb: true, circl: true });
  ctx.saveSettings({ rep: Object.fromEntries([[sha, r], ...Object.entries(cache)].slice(0, 300)), ...(vt && process.env.VT_API_KEY ? { vtDay: { day, n: used + 1 }, vtAt: ctx.now().getTime() } : {}) });
  return r;
}

// ---------------------------------------------------------------- Analyses (à la demande, planifiées)
const PROFILES = (ctx: ModCtx): Record<string, string[]> => ({ 'téléchargements': [join(homedir(), 'Téléchargements'), join(homedir(), 'Downloads'), join(ctx.home, 'workspace', 'inbox')], 'sites web': ['/var/www', '/srv/www', '/srv/http'], 'maison': [homedir()], 'temporaire': ['/tmp', '/var/tmp', '/dev/shm'], 'tout': ['/'] });
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function runScan(ctx: ModCtx, target: string, o: { plan?: string; exclude?: string[]; max?: number } = {}): Promise<Report> {
  const x = st(ctx); if (x.running) throw new Error(`une analyse est déjà en cours (${x.running.target}, ${x.running.files} fichiers) : dis « arrête l'analyse » pour la couper`);
  const roots = (PROFILES(ctx)[target] ?? [target]).filter((p) => existsSync(p));
  if (!roots.length) throw new Error(`rien à analyser : ${target}`);
  const run: Running = { id: randomBytes(4).toString('hex'), target, files: 0, hits: 0, started: Date.now(), cancel: false }; x.running = run;
  const k = knowledge(ctx), found: Detection[] = [], errors: string[] = []; let bytes = 0;
  const maxLoad = Number(ctx.settings.maxLoad ?? 0.9) * cpus().length;
  try {
    for (const root of roots) for (const f of walk(root, o.exclude ?? [], o.max)) {
      if (run.cancel) break;
      run.files++;
      try { const v = await scanPath(ctx, f, k); if (v) { bytes += v.size; if (v.level) { const d = await handle(ctx, v); if (d) { found.push(d); run.hits++; } } } }
      catch (e) { if (errors.length < 40) errors.push(`${f} : ${(e as Error).message.slice(0, 100)}`); }
      // On rend la main régulièrement, et on ralentit si la machine est déjà chargée (seuil réglable).
      if (run.files % 25 === 0) { await pause(0); if (run.files % 500 === 0) while (!run.cancel && loadavg()[0] > maxLoad) await pause(1500); }
    }
  } finally { x.running = undefined; }
  const r: Report = { id: run.id, at: ctx.now().toISOString(), target, plan: o.plan, files: run.files, bytes, ms: Date.now() - run.started, state: run.cancel ? 'arrêté' : 'terminé', version: x.intel.current(), detections: found, errors };
  mkdirSync(join(ctx.dir, 'rapports'), { recursive: true }); writeFileSync(join(ctx.dir, 'rapports', `${r.id}.json`), JSON.stringify(r, null, 1));
  const idx = [{ id: r.id, at: r.at, target, plan: o.plan, files: r.files, bytes, ms: r.ms, state: r.state, version: r.version, hits: found.length }, ...reports(ctx)];
  for (const old of idx.slice(60)) rmSync(join(ctx.dir, 'rapports', `${old.id}.json`), { force: true });
  ctx.saveSettings({ reports: idx.slice(0, 60), lastScan: idx[0] });
  return r;
}
const human = (b: number) => { const u = ['o', 'Ko', 'Mo', 'Go', 'To']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return `${Math.round(b * 10) / 10} ${u[i]}`; };
function reportText(r: Report): string {
  return [`Rapport ${r.id} · ${new Date(r.at).toLocaleString('fr-FR')} · cible : ${r.target}${r.plan ? ` (plan « ${r.plan} »)` : ''} · ${r.state}`, `${r.files} fichiers (${human(r.bytes)}) en ${Math.round(r.ms / 1000)} s · base de signatures version ${r.version}`,
    r.detections.length ? `${r.detections.length} détection(s) :` : 'Aucune menace trouvée.',
    ...r.detections.map((d) => `- [${d.level} · ${d.score}/100] ${d.threat} — ${d.file}\n  empreinte ${d.sha256} · trouvé par ${d.by} · action : ${d.action}${d.attack ? ` · ${d.attack}` : ''}\n  ${d.why.slice(0, 3).join('\n  ')}`),
    ...(r.errors.length ? [`${r.errors.length} fichier(s) non lus :`, ...r.errors.slice(0, 10).map((e) => `- ${e}`)] : [])].join('\n');
}

// ---------------------------------------------------------------- Mises à jour (paquet testé, signé, annulable)
/** Avant d'activer une version : le fichier de test EICAR doit être détecté, et rien de sain ne doit l'être. */
function validate(ctx: ModCtx, cand: Intel): string | undefined {
  const k = knowledge(ctx, cand);
  if (!flat(scanBuffer('eicar.com', Buffer.from(EICAR), k)).some((f) => f.klass === 'test')) return 'le fichier de test EICAR n\'est plus détecté';
  // Corpus sain : les fichiers d'Odin, puis des programmes et réglages du système. Une empreinte qui y correspond = base polluée.
  const corpus: string[] = []; const off = new Set(disabled(ctx)); const fp = new Map<string, number>(), seenFile = new Set<string>();
  const here = dirname(new URL(import.meta.url).pathname);
  for (const [d, max] of [[join(here, '..', '..'), 90], ['/usr/bin', 90], [dirname(process.execPath), 30], ['/etc', 50]] as Array<[string, number]>) { let n = 0; try { for (const f of walk(d, [], 600)) { if (n >= max) break; if (seenFile.has(f)) continue; seenFile.add(f); corpus.push(f); n++; } } catch { /* dossier absent */ } }
  for (const f of corpus) {
    let b: Buffer; try { const z = statSync(f); if (!z.isFile() || z.size > 3 * 1024 * 1024 || z.size === 0) continue; b = readFileSync(f); } catch { continue; }
    const v = scanBuffer(f, b, k);
    if (v.findings.some((x) => x.by === 'empreinte')) return `un fichier sain du système (${f}) figure dans les empreintes de malwares`;
    for (const x of v.findings) if (x.by === 'règle' && x.source !== 'Galdr') fp.set(x.threat, (fp.get(x.threat) ?? 0) + 1);
  }
  const total = k.rules.rules.length;
  if (fp.size > Math.max(25, total * 0.05)) return `${fp.size} règles sur ${total} se déclenchent sur des fichiers sains`;
  // Les règles qui se trompent sur des fichiers sains sont mises de côté (et listées), le reste est gardé.
  if (fp.size) ctx.saveSettings({ disabledRules: [...new Set([...off, ...fp.keys()])] });
  return undefined;
}
async function update(ctx: ModCtx, only?: string[], force = false): Promise<{ lines: string[]; version?: number }> {
  const x = st(ctx); if (x.busy) return { lines: ['Une mise à jour est déjà en cours.'] };
  x.busy = true;
  try {
    const due = (ctx.settings.due as Record<string, string> | undefined) ?? {}, patches: Patch[] = [], lines: string[] = [], seen: Record<string, string> = {};
    for (const src of SOURCES.filter((q) => q.fetch && (only ? only.includes(q.id) : srcOn(ctx, q.id)))) {
      if (!force && !only && due[src.id] && ctx.now().getTime() - Date.parse(due[src.id]) < (src.everyHours ?? 24) * 3600_000) continue;
      if (src.needs && !process.env[src.needs]) { lines.push(`○ ${src.name} : clé absente (${src.needs}), source en attente`); continue; }
      try {
        const r = await src.fetch!(fctx(ctx));
        patches.push({ hashes: r.hashes, iocs: r.iocs, yara: r.yara, kev: r.kev, stamp: { id: src.id, at: ctx.now().toISOString(), count: r.count, licence: src.licence, note: r.note } });
        seen[src.id] = ctx.now().toISOString(); lines.push(`✓ ${src.name} : ${r.count} ${src.gives}${r.note ? ` (${r.note})` : ''}`);
      } catch (e) { lines.push(`✗ ${src.name} : ${(e as Error).message.slice(0, 140)}`); }
    }
    ctx.saveSettings({ due: { ...due, ...seen }, checkedAt: ctx.now().toISOString() });
    if (!patches.length) return { lines: lines.length ? lines : ['Tout est déjà à jour.'] };
    try {
      const m = x.intel.build(patches, (cand) => validate(ctx, cand), ctx.now()); x.set = undefined;
      ctx.saveSettings({ sigAt: m.at });
      const off = disabled(ctx).length;
      lines.push(`🛡 Base version ${m.version} activée (signée, testée) : ${m.hashes} empreintes, ${m.iocs} indicateurs, ${ruleSet(ctx).rules.length} règles en service${off ? `, ${off} mises de côté (fausses alertes sur des fichiers sains)` : ''}.`);
      return { lines, version: m.version };
    } catch (e) { ctx.alert({ level: 'haute', title: 'Ullr : mise à jour des signatures refusée', detail: (e as Error).message, key: 'maj-refusee' }); lines.push(`✗ ${(e as Error).message}`); return { lines }; }
  } finally { x.busy = false; }
}

// ---------------------------------------------------------------- Protection en continu
const CANARY = ['!000-ne-pas-toucher.docx', 'zzz-ne-pas-toucher.xlsx'];
interface Canary { file: string; sha: string }
const canaries = (ctx: ModCtx): Canary[] => (ctx.settings.canaries as Canary[] | undefined) ?? [];
function checkCanaries(ctx: ModCtx): void {
  const gone: Canary[] = [];
  for (const c of canaries(ctx)) { let now = ''; try { now = createHash('sha256').update(readFileSync(c.file)).digest('hex'); } catch { now = ''; } if (now !== c.sha) { gone.push(c); ctx.emit('sentinelle', { fichier: c.file, action: now ? 'modifié' : 'supprimé ou renommé', dossier: dirname(c.file) }); } }
  if (gone.length) ctx.saveSettings({ canaries: canaries(ctx).filter((c) => !gone.includes(c)) });
}
function startWatch(ctx: ModCtx): void {
  const x = st(ctx); for (const w of x.watchers) w.close(); x.watchers = [];
  if (ctx.settings.onArrival === false) return;
  const dirs = [...new Set([...PROFILES(ctx)['téléchargements'], ...((ctx.settings.watch as string[] | undefined) ?? []), ...canaries(ctx).map((c) => dirname(c.file))])].filter((d) => existsSync(d));
  for (const d of dirs) {
    const on = (_e: string, name: string | Buffer | null) => {
      if (!name) return; const f = join(d, String(name));
      // Rafale : beaucoup de fichiers réécrits ou renommés en quelques secondes = comportement de rançongiciel.
      const t = Date.now(), l = [...(x.bursts.get(d) ?? []).filter((q) => t - q < 10_000), t]; x.bursts.set(d, l);
      if (l.length >= Number(ctx.settings.burst ?? 80) && t - x.burstAt > 600_000) { x.burstAt = t; ctx.emit('rafale', { dossier: d, nombre: l.length, secondes: 10 }); }
      if (canaries(ctx).some((c) => c.file === f)) { setTimeout(() => checkCanaries(ctx), 300); return; }
      if (x.pending.has(f) || x.pending.size > 2000) return;
      x.pending.set(f, setTimeout(() => { x.pending.delete(f); void scanPath(ctx, f).then((v) => (v?.level ? handle(ctx, v) : undefined)).catch(() => undefined); }, 1500));
    };
    try { x.watchers.push(watch(d, { recursive: true }, on)); } catch { try { x.watchers.push(watch(d, on)); } catch { /* dossier non surveillable */ } }
  }
}
/** Supports amovibles montés (clé USB, disque, téléphone) : chaque nouveau support est analysé. */
function removable(): string[] { try { return readFileSync('/proc/mounts', 'utf8').split('\n').map((l) => l.split(' ')).filter((c) => c.length > 2 && /^\/(media|run\/media|mnt)\//.test(c[1]) && /^(vfat|exfat|ntfs|ntfs3|fuseblk|iso9660|udf|hfsplus|ext[234]|f2fs)$/.test(c[2])).map((c) => c[1].replace(/\\040/g, ' ')); } catch { return []; } }

/** Ce que voient les autres applis (événements, alertes) arrive ici : Ullr en fait des incidents. */
export function observe(ctx: ModCtx, e: { module: string; type: string; data: Record<string, unknown> }): Incident | undefined {
  const x = st(ctx), sig = toSignal(e, ctx.now().getTime()); if (!sig) return undefined;
  x.seen.set(sig.app, sig.at);
  const name = (id: string) => ctx.modules().find((m) => m.id === id)?.name ?? (id === 'odin' ? 'Odin' : id);
  const r = x.corr.add(sig, name);
  if (!r.incident) return undefined;
  if (ctx.settings.respond !== false) for (const a of r.responses) if (a.kind === 'bannir') void ctx.call('garmr', 'bannir', { ip: a.ip, raison: a.why, source: 'Ullr', minutes: 1440 }, a.why).catch(() => undefined);
  ctx.saveSettings({ incidents: x.corr.incidents.slice(0, 60) });
  if (r.announce) {
    const i = r.incident;
    ctx.alert({ level: i.level, title: `Incident : ${i.title}`, detail: story(i), key: `incident:${i.id}:${i.level}`, data: { incident: i.id } });
    ctx.emit('incident', { id: i.id, titre: i.title, genre: i.kind, score: i.score, gravité: i.level });
    // Lien avec le Cerveau : un incident sérieux laisse une note (chronologie, score, ce qui a été fait), complétée s'il s'aggrave.
    if (i.level !== 'moyenne') void brainNote(ctx, i, `#sécurité #incident\n\n${story(i)}\n\nVoir aussi : ${['Ullr', ...i.apps.filter((a) => a !== 'Ullr')].map((a) => `[[${a}]]`).join(', ')}`);
  }
  return r.incident;
}

/** La note de l'incident dans le Cerveau : créée une fois, puis complétée. */
async function brainNote(ctx: ModCtx, i: Incident, text: string): Promise<void> {
  const x = st(ctx);
  try {
    if (i.note) { await ctx.call('saga', 'completer', { note: i.note, texte: `\n### ${ctx.now().toLocaleString('fr-FR')}\n${text}` }, 'suite d\'un incident de sécurité'); return; }
    const r = await ctx.call('saga', 'noter', { titre: `Incident ${i.at.slice(0, 10)} · ${i.title}`.slice(0, 110), texte: text }, 'incident de sécurité');
    const path = (r.data as { chemin?: string } | undefined)?.chemin; if (r.ok === false || !path) return;
    i.note = path; ctx.saveSettings({ incidents: x.corr.incidents.slice(0, 60) });
  } catch { /* le Cerveau n'est pas indispensable à la protection */ }
}

const verdictText = (v: Verdict): string => {
  const all = flat(v); if (!all.length) return `✓ Rien de dangereux trouvé (${v.type}, empreinte ${v.sha256.slice(0, 16)}…).${v.note ? ` ${v.note}.` : ''}`;
  const top = [...all].sort((a, b) => b.score - a.score)[0];
  return [`⚠ ${top.threat} (${top.by}) — score ${v.score}/100${v.level ? `, risque ${v.level}` : ', sous le seuil d\'alerte'}${sureOf(v) ? '' : ' · à vérifier : ce n\'est qu\'un faisceau d\'indices'}`, ...all.map((f: Finding & { file: string }) => `- ${f.threat} : ${f.why}${f.file !== v.file ? ` (dans ${f.file.split('!').slice(1).join(' › ')})` : ''}${f.attack ? ` [${f.attack}]` : ''}`), `Type réel : ${v.type} · empreinte SHA-256 : ${v.sha256}`].join('\n');
};

export const ullr: Module = {
  id: 'ullr', name: 'Ullr', family: 'Sécurité',
  what: 'L\'antivirus d\'Odin, fait maison : fichiers, archives, téléchargements, clés USB, sites web, liens et messages, relié à toutes les autres applis.',
  does: ['empreintes de malwares connus et familles (MalwareBazaar, ThreatFox), mises à jour toutes les 6 heures', 'règles : les tiennes (Galdr) et des règles YARA publiques importées, testées contre les fausses alertes', 'heuristiques au score explicable : programme déguisé, macros, PDF piégé, raccourci, script dissimulé, vol d\'identifiants, espion', 'archives ouvertes (zip, gzip, tar, documents Office, APK), bombes de décompression repérées', 'hameçonnage : pages, messages et adresses web (OpenPhish, URLhaus, imitation de marque, lien menteur)', 'logiciels espions : applis de surveillance pour téléphone (Stalkerware Indicators)', 'réputation d\'une empreinte (VirusTotal, MalwareBazaar, CIRCL) sans jamais envoyer le fichier', 'protection en continu : téléchargements, supports amovibles, fichiers sentinelles contre les rançongiciels', 'analyses planifiées avec exclusions, ralenties si la machine est chargée, annulables', 'incidents : relie les signaux de Skögul, Geri, Loki, Garmr, Forseti, Eir… et répond', 'base de signatures signée, versionnée, testée avant activation, annulable', 'quarantaine réversible, exceptions, fausses alertes, rapports horodatés', 'failles réellement exploitées (CISA KEV) comparées aux logiciels installés'],
  from: ['ClamAV', 'ClamWin', 'ClamUI', 'YARA', 'Linux Malware Detect', 'MalwareBazaar', 'VirusTotal'], upstream: ['Cisco-Talos/clamav', 'VirusTotal/yara', 'rfxn/linux-malware-detect', 'Neo23x0/signature-base', 'YARAHQ/yara-forge', 'AssoEchap/stalkerware-indicators'],
  modes: ['Váli · console', 'Galdr · règles sur mesure', 'Níðhögg · sites web', 'Quarantaine'],
  words: ['antivirus', 'virus', 'malware', 'malveillant', 'analyse', 'scanner', 'scan', 'quarantaine', 'webshell', 'regle yara', 'règle', 'infecte', 'infecté', 'rancongiciel', 'rançongiciel', 'ransomware', 'hameconnage', 'hameçonnage', 'phishing', 'arnaque', 'espion', 'logiciel espion', 'signatures', 'empreintes', 'incident', 'incidents', 'cheval de troie', 'piratage', 'piraté', 'exception', 'exceptions', 'sentinelle', 'sentinelles', 'failles', 'bizarre', 'anormal', 'anormale', 'louche', 'dangereux', 'dangereuse', 'verifie le lien', 'verifie ce lien', 'verifie le site', 'verifie ce site', 'verifie cette adresse', 'verifie ce message', 'verifie ce mail'],
  actions: [
    { id: 'etat', label: 'État de la protection', what: 'En une phrase : es-tu protégé, y a-t-il quelque chose à regarder ?', read: true, words: ['etat', 'protection', 'protege', 'protégé', 'y a-t-il un virus', 'suis-je protege', 'tout va bien'], run: (ctx) => {
      const x = st(ctx), m = x.intel.manifest(), open = x.corr.incidents.filter((i) => i.state === 'ouvert'), todo = dets(ctx).filter((d) => d.action === 'à vérifier'), last = reports(ctx)[0], age = m ? Math.round((ctx.now().getTime() - Date.parse(m.at)) / 3600_000) : undefined;
      const worry = open.length || todo.length;
      return { text: [worry ? `⚠ ${[open.length ? `${open.length} incident(s) ouvert(s)` : '', todo.length ? `${todo.length} fichier(s) à vérifier` : ''].filter(Boolean).join(', ')}.` : '✓ Rien à signaler : aucun incident ouvert, aucun fichier à vérifier.',
        ...open.slice(0, 3).map((i) => `- Incident : ${i.title} (${i.score}/100)`), ...todo.slice(0, 5).map((d) => `- À vérifier : ${d.threat} — ${d.file}`),
        `Protection en continu : ${ctx.settings.onArrival === false ? 'coupée' : `active (${x.watchers.length} dossier(s) surveillé(s))`} · quarantaine : ${qlist(ctx).length} fichier(s).`,
        `Signatures : ${m ? `version ${m.version}, ${age! < 48 ? `il y a ${age} h` : `il y a ${Math.round(age! / 24)} jours`}` : 'règles de base seulement (dis « mets à jour les signatures »)'} · ${x.intel.hashCount()} empreintes · ${ruleSet(ctx).rules.length} règles.`,
        `Dernière analyse : ${last ? `${last.target}, ${last.files} fichiers, ${last.hits} détection(s), le ${new Date(last.at).toLocaleString('fr-FR')}` : 'aucune pour l\'instant'}.`,
        'Aucun antivirus ne détecte tout : reste prudent avec ce que tu ouvres.'].join('\n'), data: { incidents: open.length, a_verifier: todo.length } };
    } },
    { id: 'analyser', label: 'Analyser', what: 'Analyse un dossier, un fichier ou un profil (téléchargements, sites web, maison, temporaire, tout)', params: [{ key: 'dossier', label: 'Dossier ou profil', kind: 'text', default: 'téléchargements' }, { key: 'exclusions', label: 'Dossiers à ne pas analyser (un par ligne)', kind: 'textarea', default: '' }], words: ['analyse', 'scanne'], run: async (ctx, i) => {
      const r = await runScan(ctx, s(i.dossier) || 'téléchargements', { exclude: s(i.exclusions).split('\n').map((q) => q.trim()).filter(Boolean) });
      return { text: `🔎 ${r.files} fichiers analysés (${r.target}) en ${Math.round(r.ms / 1000)} s${r.state === 'arrêté' ? ' — analyse arrêtée' : ''} : ${r.detections.length ? `${r.detections.length} détection(s)\n${r.detections.map((d) => `- [${d.level}] ${d.threat} — ${d.file} (${d.action})`).join('\n')}` : 'rien de dangereux.'}\nRapport ${r.id} (dis « rapport antivirus »).`, data: { rapport: r.id, fichiers: r.files, detections: r.detections.length } };
    } },
    { id: 'fichier', label: 'Analyser un fichier', what: 'Un seul fichier, avec l\'explication du verdict', read: true, params: [{ key: 'chemin', label: 'Fichier', kind: 'text', required: true }], words: ['fichier'], run: async (ctx, i) => {
      // Un nom seul (« rapport.pdf ») est cherché là où les fichiers arrivent.
      let f = s(i.chemin).trim(); if (f && !/^(\/|~|[A-Za-z]:\\)/.test(f) && !existsSync(f)) f = PROFILES(ctx)['téléchargements'].map((d) => join(d, f)).find((x) => existsSync(x)) ?? f;
      if (f.startsWith('~/')) f = join(homedir(), f.slice(2));
      const v = await scanPath(ctx, f); if (!v) return { ok: false, text: `Fichier introuvable, vide, ou dans tes exceptions : ${f}` }; return { text: verdictText(v), data: v };
    } },
    { id: 'adresse', label: 'Vérifier une adresse web', what: 'Un lien ou un nom de site est-il dangereux (malware, hameçonnage, espion) ?', read: true, params: [{ key: 'lien', label: 'Adresse', kind: 'text', required: true }], words: ['adresse web', 'verifie le lien', 'verifie ce lien', 'verifie le site', 'verifie ce site', 'verifie cette adresse', 'lien dangereux', 'site dangereux', 'lien suspect'], run: (ctx, i) => {
      const u = s(i.lien).trim(), known = st(ctx).intel.site(u), f = urlRisk(u), c = combine(known ? [{ threat: '', by: 'indicateur', level: 'critique', klass: 'hameçonnage', score: 100, why: '' }, ...f] : f);
      return { text: known ? `⚠ Adresse connue comme dangereuse (${known.what}, source ${known.source}) : n'ouvre pas ce lien.${f.length ? `\n${f.map((q) => `- ${q.why}`).join('\n')}` : ''}` : f.length ? `${c.level ? '⚠' : 'ℹ'} Score de risque ${c.score}/100${c.level ? ` (${c.level})` : ''} — pas dans les listes, mais :\n${f.map((q) => `- ${q.threat} : ${q.why}`).join('\n')}` : '✓ Rien de suspect : pas dans les listes de sites dangereux, et l\'adresse a une forme normale. (Aucune liste n\'est complète : reste prudent.)', data: { connu: known, score: c.score } };
    } },
    { id: 'message', label: 'Vérifier un message', what: 'Un e-mail (fichier .eml) ou un texte reçu : est-ce un hameçonnage ?', read: true, params: [{ key: 'texte', label: 'Texte du message, ou chemin d\'un fichier .eml', kind: 'textarea', required: true }], words: ['verifie ce message', 'verifie le message', 'verifie ce mail', 'verifie cet e-mail', 'verifie ce sms', 'est-ce une arnaque', 'arnaque'], run: (ctx, i) => {
      const t = s(i.texte), text = t.length < 400 && !t.includes('\n') && existsSync(t) ? readable(readFileSync(t).subarray(0, 2_000_000)) : t, x = st(ctx);
      const f = phishing(text, /^[\w-]+:\s/m.test(text.slice(0, 300)) ? 'eml' : 'texte');
      for (const m of [...text.matchAll(/https?:\/\/[^\s"'<>)]+/gi)].slice(0, 60)) { const k = x.intel.site(m[0]); if (k) f.unshift({ threat: 'Lien connu comme dangereux', by: 'indicateur', level: 'critique', klass: k.what === 'malware' ? 'malware' : 'hameçonnage', score: 100, why: `${m[0].slice(0, 80)} est dans la liste ${k.source} (${k.what})`, sure: true }); }
      const c = combine(f);
      return { text: f.length ? `${c.level ? '⚠' : 'ℹ'} Score d'hameçonnage ${c.score}/100${c.level ? ` (risque ${c.level})` : ''} :\n${f.map((q) => `- ${q.threat} : ${q.why}`).join('\n')}${c.level ? '\nNe clique sur aucun lien et ne réponds pas.' : ''}` : '✓ Aucun signe d\'hameçonnage trouvé (liens, expéditeur, pièces jointes, ton du message).', data: { score: c.score, indices: f.length } };
    } },
    { id: 'isoler', undo: (_i, r) => { const id = (r.data as { id?: string } | undefined)?.id; return id ? { action: 'restaurer', input: { id }, label: 'fichier remis à sa place' } : undefined; }, label: 'Mettre en quarantaine', what: 'Met un fichier à l\'écart (réversible)', params: [{ key: 'fichier', label: 'Fichier', kind: 'text', required: true }, { key: 'menace', label: 'Raison', kind: 'text', default: 'à ta demande' }], words: ['isole', 'quarantaine', 'mets a l ecart'], run: async (ctx, i) => {
      const f = s(i.fichier); if (!existsSync(f) || !statSync(f).isFile()) throw new Error('fichier introuvable');
      if (/^\/(bin|sbin|usr|lib|lib64|boot|etc)\//.test(f) && !/\/(tmp|local)\//.test(f)) throw new Error('fichier du système : je ne le déplace pas tout seul (il pourrait empêcher la machine de démarrer). Regarde-le avec « analyse le fichier … »');
      const v = await scanPath(ctx, f), q = isolate(ctx, f, { sha256: v?.sha256 ?? '', threat: s(i.menace) || 'à ta demande', level: v?.level ?? 'moyenne' });
      ctx.saveSettings({ hits: dets(ctx).map((d) => (d.file === f ? { ...d, action: 'en quarantaine' } : d)) });
      return { text: `🧊 ${f} est en quarantaine (${q.id}) : il ne peut plus être lancé, et tu peux le remettre en place.`, data: { id: q.id } };
    } },
    { id: 'restaurer', label: 'Sortir de quarantaine', what: 'Remet le fichier à sa place', params: [{ key: 'id', label: 'Identifiant', kind: 'text', required: true }], grave: (i) => `remettre en place le fichier en quarantaine ${s(i.id)}`, run: (ctx, i) => { const q = release(ctx, s(i.id)); return { text: `↩ ${q.file} restauré.` }; } },
    { id: 'supprimer', label: 'Supprimer de la quarantaine', what: 'Efface définitivement un fichier isolé', params: [{ key: 'id', label: 'Identifiant', kind: 'text', required: true }], grave: (i) => `supprimer définitivement le fichier en quarantaine ${s(i.id)}`, run: (ctx, i) => { const q = qlist(ctx).find((x) => x.id === s(i.id)); if (!q) throw new Error('introuvable'); rmSync(join(qdir(ctx), q.id), { force: true }); ctx.saveSettings({ quarantine: qlist(ctx).filter((x) => x.id !== q.id) }); return { text: `🗑 ${q.file} supprimé définitivement.` }; } },
    { id: 'quarantaine', quick: false, label: 'Quarantaine', what: 'Fichiers isolés', read: true, run: (ctx) => ({ text: qlist(ctx).map((q) => `- ${q.id} · ${q.threat} · ${q.file} · ${q.at.slice(0, 10)}`).join('\n') || 'Quarantaine vide.' }) },
    { id: 'mettre_a_jour', label: 'Mettre à jour les signatures', what: 'Interroge les sources, teste le résultat, puis active une nouvelle version signée', params: [{ key: 'source', label: 'Une seule source (vide = toutes)', kind: 'text', default: '' }], words: ['mets a jour', 'mise a jour', 'signatures', 'empreintes'], run: async (ctx, i) => { const r = await update(ctx, s(i.source) ? [s(i.source)] : undefined, true); return { text: r.lines.join('\n'), data: { version: r.version } }; } },
    { id: 'sources', label: 'Sources', what: 'D\'où viennent les signatures : état, licence, dernière mise à jour', read: true, words: ['sources'], run: (ctx) => { const m = st(ctx).intel.manifest(); return { text: SOURCES.map((q) => { const z = m?.sources.find((x) => x.id === q.id); return `- ${q.name} (${q.gives}) : ${q.mode === 'référence' ? 'référence, non branchée' : q.mode === 'à la demande' ? (q.needs && !process.env[q.needs] ? `à la demande · clé absente (${q.needs})` : 'à la demande · prête') : !q.fetch ? 'tenue à jour par l\'appli Geri' : !srcOn(ctx, q.id) ? 'désactivée' : q.needs && !process.env[q.needs] ? `en attente de la clé ${q.needs}` : z ? `${z.count} le ${z.at.slice(0, 16).replace('T', ' ')}` : 'jamais mise à jour'} — ${q.licence}`; }).join('\n') }; } },
    { id: 'cles', quick: false, label: 'Clés des sources', what: 'Range la clé gratuite d\'abuse.ch (MalwareBazaar, ThreatFox, URLhaus) ou de VirusTotal avec les secrets d\'Odin',
      // Changer une clé ne se fait qu'avec toi : jamais par une automatisation ni par un autre assistant.
      grave: (i) => (['abuse_ch', 'virustotal'].some((k) => String(i[k] ?? '').trim()) ? 'changer une clé d\'accès aux sources de l\'antivirus' : undefined), params: [{ key: 'abuse_ch', label: 'Clé abuse.ch (gratuite : auth.abuse.ch)', kind: 'password', default: '' }, { key: 'virustotal', label: 'Clé VirusTotal (gratuite, usage non commercial)', kind: 'password', default: '' }], run: async (ctx, i) => {
      if (!saveKey) throw new Error('le coffre des secrets n\'est pas disponible ici');
      const done: string[] = [];
      for (const [k, name, label] of [['abuse_ch', 'ABUSE_CH_KEY', 'abuse.ch'], ['virustotal', 'VT_API_KEY', 'VirusTotal']] as const) { const v = s(i[k]).trim(); if (!v) continue; if (!/^[A-Za-z0-9_-]{16,128}$/.test(v)) throw new Error(`la clé ${label} n'a pas la bonne forme (lettres et chiffres, sans espace)`); saveKey(name, v); done.push(label); }
      if (!done.length) return { text: `Clé abuse.ch : ${process.env.ABUSE_CH_KEY ? 'présente' : 'absente'} · clé VirusTotal : ${process.env.VT_API_KEY ? 'présente' : 'absente'}. Les clés ne sont jamais affichées.` };
      // La clé abuse.ch débloque trois sources : on les met à jour tout de suite.
      const up = done.includes('abuse.ch') ? await update(ctx, ['malwarebazaar', 'threatfox', 'urlhaus'], true) : undefined;
      return { text: [`🔑 Clé ${done.join(' et ')} rangée avec les secrets d'Odin (elle n'est jamais affichée).`, ...(up?.lines ?? [])].join('\n') };
    } },
    { id: 'source', label: 'Activer une source', what: 'Active ou désactive une source de signatures', params: [{ key: 'source', label: 'Source', kind: 'select', options: SOURCES.filter((q) => q.fetch).map((q) => q.id), required: true }, { key: 'actif', label: 'Active', kind: 'boolean', default: true }], run: (ctx, i) => { if (!SOURCES.some((q) => q.id === s(i.source) && q.fetch)) throw new Error('source inconnue'); ctx.saveSettings({ sources: { ...((ctx.settings.sources as Record<string, boolean>) ?? {}), [s(i.source)]: i.actif !== false } }); return { text: `Source ${s(i.source)} ${i.actif !== false ? 'activée' : 'désactivée'}.` }; } },
    { id: 'versions', quick: false, label: 'Versions des signatures', what: 'Historique des paquets (pour revenir en arrière)', read: true, run: (ctx) => { const x = st(ctx).intel; return { text: x.versions().map((m) => `- version ${m.version}${m.version === x.current() ? ' (en service)' : ''} · ${m.at.slice(0, 16).replace('T', ' ')} · ${m.hashes} empreintes, ${m.iocs} indicateurs · ${x.check(m.version) ? '✗ abîmée' : '✓ signature valide'}`).join('\n') || 'Aucune mise à jour pour l\'instant : les règles de base sont en service.' }; } },
    { id: 'revenir', label: 'Revenir à la version précédente', what: 'Annule la dernière mise à jour des signatures', quick: false, grave: () => 'revenir à la version précédente des signatures (la dernière mise à jour est annulée)', run: (ctx) => { const x = st(ctx), m = x.intel.rollback(); x.set = undefined; return { text: `↩ Retour à la version ${m.version} des signatures (${m.hashes} empreintes).` }; } },
    { id: 'regle', label: 'Ajouter une règle (Galdr)', what: 'Nouvelle règle de détection', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'chaines', label: 'Chaînes (une par ligne ; /regex/ possible)', kind: 'textarea', required: true }, { key: 'il_faut', label: 'Il faut', kind: 'select', options: ['un', 'tous'], default: 'un' }, { key: 'gravite', label: 'Gravité', kind: 'select', options: ['moyenne', 'haute', 'critique'], default: 'haute' }], words: ['regle', 'règle', 'galdr', 'signature'], run: (ctx, i) => {
      const r: Rule = { name: s(i.nom), strings: s(i.chaines).split('\n').map((q) => q.trim()).filter(Boolean), need: s(i.il_faut) === 'tous' ? 'tous' : 'un', level: (s(i.gravite) || 'haute') as Rule['level'] };
      compileGaldr(r); // vérifie les expressions
      ctx.saveSettings({ rules: [...userRules(ctx).filter((q) => q.name !== r.name), r] }); st(ctx).set = undefined;
      return { text: `📜 Règle « ${r.name} » ajoutée (${r.strings.length} chaîne(s)).` };
    } },
    { id: 'importer', label: 'Importer des signatures', what: 'Fichier de règles YARA (.yar), d\'empreintes (une par ligne) ou de signatures ClamAV (.hsb)', params: [{ key: 'chemin', label: 'Fichier', kind: 'text', required: true }], words: ['importe'], run: (ctx, i) => {
      const f = s(i.chemin); if (!existsSync(f)) throw new Error('fichier introuvable'); const t = readFileSync(f, 'utf8'), x = st(ctx), name = basename(f).replace(/\.[^.]+$/, '').replace(/[^\w.-]/g, '_');
      const isYara = /\brule\s+\w+[\s\S]*\bcondition\s*:/.test(t), hashes = isYara ? [] : /\.hsb$/i.test(f) ? parseClamHsb(t) : parseHashList(t);
      if (!isYara && !hashes.length) throw new Error('ni règles YARA, ni empreintes SHA-256 dans ce fichier');
      const y = isYara ? importYara(t, `import.${name}`) : undefined; if (y && !y.rules.length) throw new Error(`aucune des ${y.total} règles n'est dans le sous-ensemble compris par Ullr`);
      const m = x.intel.build([{ hashes, yara: isYara ? { [`import.${name}`]: t } : undefined, stamp: { id: `import.${name}`, at: ctx.now().toISOString(), count: y ? y.rules.length : hashes.length, licence: 'importé par toi' } }], (cand) => validate(ctx, cand), ctx.now()); x.set = undefined;
      return { text: y ? `📜 ${y.rules.length} règle(s) importée(s) sur ${y.total} (${y.skipped} écartées : hors du sous-ensemble compris). Base version ${m.version}.` : `🛡 ${hashes.length} empreinte(s) importée(s). Base version ${m.version}.` };
    } },
    { id: 'plan', label: 'Planifier une analyse', what: 'Analyse récurrente d\'un dossier ou d\'un profil', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'dossier', label: 'Dossier ou profil', kind: 'text', required: true }, { key: 'quand', label: 'Fréquence', kind: 'select', options: ['jour', 'semaine', 'heure'], default: 'jour' }, { key: 'heure', label: 'Heure (HH:MM)', kind: 'text', default: '03:00' }, { key: 'exclusions', label: 'Dossiers exclus (un par ligne)', kind: 'textarea', default: '' }], words: ['planifie', 'programme'], run: (ctx, i) => {
      const p: Plan = { name: s(i.nom).trim(), target: s(i.dossier).trim(), every: (['heure', 'jour', 'semaine'].includes(s(i.quand)) ? s(i.quand) : 'jour') as Plan['every'], at: /^\d\d:\d\d$/.test(s(i.heure)) ? s(i.heure) : '03:00', exclude: s(i.exclusions).split('\n').map((q) => q.trim()).filter(Boolean) };
      if (!PROFILES(ctx)[p.target] && !existsSync(p.target)) throw new Error(`cible introuvable : ${p.target}`);
      p.next = nextRun(p, ctx.now()).toISOString();
      ctx.saveSettings({ plans: [...plans(ctx).filter((q) => q.name !== p.name), p] });
      return { text: `🗓 Analyse « ${p.name} » : ${p.target}, chaque ${p.every}${p.every === 'heure' ? '' : ` à ${p.at}`}${p.exclude.length ? `, ${p.exclude.length} dossier(s) exclu(s)` : ''}. Première analyse : ${new Date(p.next).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.` };
    } },
    { id: 'plans', quick: false, label: 'Analyses planifiées', what: 'Ce qui est analysé tout seul, et quand', read: true, words: ['analyses planifiees', 'analyses programmees', 'plans', 'planning'], run: (ctx) => ({ text: plans(ctx).map((p) => `- ${p.name} : ${p.target} · chaque ${p.every}${p.every === 'heure' ? '' : ` à ${p.at}`} · dernière : ${p.last ? p.last.slice(0, 16).replace('T', ' ') : 'jamais'}${p.next ? ` · prochaine : ${new Date(p.next).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}`).join('\n') || 'Aucune analyse planifiée (les téléchargements sont analysés à l\'arrivée, les sites web chaque nuit).' }) },
    { id: 'retirer_plan', label: 'Retirer une analyse planifiée', what: 'Supprime un plan', params: [{ key: 'nom', label: 'Plan', kind: 'text', required: true }], run: (ctx, i) => { ctx.saveSettings({ plans: plans(ctx).filter((p) => p.name !== s(i.nom)) }); return { text: `Plan « ${s(i.nom)} » retiré.` }; } },
    { id: 'arreter', label: 'Arrêter l\'analyse', what: 'Coupe l\'analyse en cours (le rapport partiel est gardé)', words: ['arrete l analyse', 'stoppe l analyse'], run: (ctx) => { const r = st(ctx).running; if (!r) return { text: 'Aucune analyse en cours.' }; r.cancel = true; return { text: `⏹ Analyse de ${r.target} arrêtée après ${r.files} fichiers.` }; } },
    { id: 'rapport', quick: false, label: 'Rapport d\'analyse', what: 'Le dernier rapport (ou celui dont tu donnes l\'identifiant)', read: true, params: [{ key: 'rapport', label: 'Rapport (vide = le dernier)', kind: 'text', default: '' }], words: ['rapport', 'rapports'], run: (ctx, i) => { const id = s(i.rapport) || reports(ctx)[0]?.id; if (!id) return { text: 'Aucune analyse n\'a encore été faite.' }; const f = join(ctx.dir, 'rapports', `${id.replace(/[^a-f0-9]/g, '')}.json`); if (!existsSync(f)) throw new Error('rapport introuvable'); const r = JSON.parse(readFileSync(f, 'utf8')) as Report; return { text: reportText(r), data: r }; } },
    { id: 'rapports', quick: false, label: 'Analyses faites', what: 'Les dernières analyses : quand, quoi, combien de fichiers, combien de détections', read: true, words: ['analyses', 'rapports', 'historique des analyses'], run: (ctx) => ({ text: reports(ctx).slice(0, 15).map((r) => `- ${r.at.slice(0, 16).replace('T', ' ')} · ${r.target}${r.plan ? ` (plan « ${r.plan} »)` : ''} · ${r.files} fichiers · ${r.hits} détection(s) · rapport ${r.id}`).join('\n') || 'Aucune analyse n\'a encore été faite. Dis « analyse mes téléchargements ».' }) },
    { id: 'exception', label: 'Ajouter une exception', what: 'Un dossier, une empreinte ou une règle à ne plus signaler', params: [{ key: 'quoi', label: 'Dossier, empreinte SHA-256 ou nom de règle', kind: 'text', required: true }], words: ['ajoute une exception', 'exception pour', 'ignore'], run: (ctx, i) => { const raw = s(i.quoi).trim(), q = /(?:^|\s)(\/[^\s"'«»]+)/.exec(raw)?.[1]?.replace(/[.,;:!?]+$/, '') ?? raw.replace(/^(pour|sur|le dossier|la r[eè]gle|l'empreinte)\s+/i, ''), e = exc(ctx); if (/^[a-f0-9]{64}$/i.test(q)) e.hashes = [...new Set([...e.hashes, q.toLowerCase()])]; else if (q.startsWith('/') || /^[A-Za-z]:\\/.test(q)) { if (q === '/' || q.length < 4) throw new Error('exception trop large'); e.paths = [...new Set([...e.paths, q.replace(/\/+$/, '')])]; } else e.rules = [...new Set([...e.rules, q])]; ctx.saveSettings({ exceptions: e }); st(ctx).set = undefined; return { text: `Exception ajoutée : ${q}. (${e.paths.length} dossier(s), ${e.hashes.length} empreinte(s), ${e.rules.length} règle(s).)` }; } },
    { id: 'exceptions', quick: false, label: 'Exceptions', what: 'Ce qu\'Ullr ne signale plus', read: true, words: ['exceptions'], run: (ctx) => { const e = exc(ctx); return { text: [...e.paths.map((p) => `- dossier ${p}`), ...e.hashes.map((h) => `- empreinte ${h}`), ...e.rules.map((r) => `- règle ${r}`), ...disabled(ctx).map((r) => `- règle mise de côté (fausse alerte sur des fichiers sains) : ${r}`)].join('\n') || 'Aucune exception.' }; } },
    { id: 'retirer_exception', label: 'Retirer une exception', what: 'Ullr signale de nouveau ce dossier, cette empreinte ou cette règle', params: [{ key: 'quoi', label: 'Exception', kind: 'text', required: true }], run: (ctx, i) => { const q = s(i.quoi).trim(), e = exc(ctx); ctx.saveSettings({ exceptions: { paths: e.paths.filter((x) => x !== q), hashes: e.hashes.filter((x) => x !== q.toLowerCase()), rules: e.rules.filter((x) => x !== q) }, disabledRules: disabled(ctx).filter((x) => x !== q) }); st(ctx).set = undefined; return { text: `Exception retirée : ${q}.` }; } },
    { id: 'faux_positif', label: 'Signaler une fausse alerte', what: 'Le fichier est sain : il sort de quarantaine et son empreinte devient une exception', params: [{ key: 'detection', label: 'Détection (son code, ou le chemin du fichier)', kind: 'text', required: true }], grave: (i) => `déclarer sain le fichier de la détection ${s(i.detection)} et le remettre en place`, words: ['faux positif', 'fausse alerte'], run: (ctx, i) => {
      const d = dets(ctx).find((x) => x.id === s(i.detection) || x.file === s(i.detection)); if (!d) throw new Error('détection introuvable');
      const e = exc(ctx); ctx.saveSettings({ exceptions: { ...e, hashes: [...new Set([...e.hashes, d.sha256])] }, hits: dets(ctx).map((x) => (x.id === d.id ? { ...x, action: 'fausse alerte (exception)' } : x)), fp: [{ at: ctx.now().toISOString(), file: d.file, sha256: d.sha256, threat: d.threat, by: d.by }, ...((ctx.settings.fp as unknown[]) ?? [])].slice(0, 100) });
      const q = qlist(ctx).find((x) => x.sha256 === d.sha256 || x.file === d.file); if (q) release(ctx, q.id); st(ctx).set = undefined;
      return { text: `✓ ${d.file} déclaré sain${q ? ', remis à sa place' : ''}. Son empreinte ne sera plus signalée (« ${d.threat} » avait été trouvé par ${d.by}).` };
    } },
    { id: 'incidents', label: 'Incidents', what: 'Les attaques reconstituées à partir des signaux de toutes les applis', read: true, words: ['incidents', 'incident', 'incidents de securite', 'activite bizarre', 'activite anormale', 'activite suspecte', 'quelque chose de bizarre', 'quelque chose d\'anormal'], run: (ctx) => { const l = st(ctx).corr.incidents.slice(0, 12); return { text: l.length ? l.map((i) => `▸ [${i.id}] ${i.at.slice(0, 16).replace('T', ' ')} · ${i.title} · ${i.state}\n${story(i)}`).join('\n\n') : '✓ Aucun incident : rien d\'anormal n\'a été relié entre les applis.' }; } },
    { id: 'incident', label: 'Classer un incident', what: 'Marque un incident comme traité ou ignoré', params: [{ key: 'incident', label: 'Incident', kind: 'text', required: true }, { key: 'etat', label: 'État', kind: 'select', options: ['traité', 'ignoré', 'ouvert'], default: 'traité' }], run: (ctx, i) => { const x = st(ctx), r = x.corr.set(s(i.incident), (['traité', 'ignoré', 'ouvert'].includes(s(i.etat)) ? s(i.etat) : 'traité') as Incident['state']); if (!r) throw new Error('incident introuvable'); ctx.saveSettings({ incidents: x.corr.incidents.slice(0, 60) }); if (r.note) void brainNote(ctx, r, `Incident classé : ${r.state}.`); return { text: `Incident « ${r.title} » : ${r.state}.` }; } },
    { id: 'reputation', label: 'Réputation d\'une empreinte', what: 'Avis de VirusTotal, MalwareBazaar et CIRCL sur une empreinte (aucun fichier n\'est envoyé)', read: true, params: [{ key: 'empreinte', label: 'Empreinte SHA-256 (ou chemin d\'un fichier)', kind: 'text', required: true }], words: ['reputation', 'réputation', 'virustotal'], run: async (ctx, i) => { let h = s(i.empreinte).trim(); if (!/^[a-f0-9]{64}$/i.test(h) && existsSync(h)) h = await hashStream(h); const local = st(ctx).intel.hash(h), r = await rep(ctx, h); return { text: `${local ? `⚠ Dans la base d'Ullr : malware connu${local.family ? ` (${local.family})` : ''}, source ${local.source}.\n` : ''}${reputationText(r).text}`, data: r }; } },
    { id: 'failles', label: 'Failles exploitées', what: 'Les failles réellement utilisées par des attaquants, comparées aux logiciels installés ici', read: true, words: ['failles', 'vulnerabilites', 'vulnérabilités', 'cve'], run: async (ctx) => {
      const kev = st(ctx).intel.kev(); if (!kev.length) return { text: 'Le catalogue des failles exploitées n\'est pas encore chargé : dis « mets à jour les signatures ».' };
      // Logiciels installés (paquets du système). Le noyau Linux tourne toujours sur une machine Linux.
      const pk = await ctx.run('dpkg-query', ['-W', '-f', '${Package}\\n'], { timeoutMs: 15_000 }).then((r) => (r.code ? '' : r.out), () => '');
      const pkgs = [...pk.split('\n').map((q) => q.trim().toLowerCase()).filter(Boolean), ...(process.platform === 'linux' ? ['linux-kernel'] : [])], flatNames = new Set(pkgs.map((n) => n.replace(/[^a-z]/g, '')).filter((n) => n.length > 3));
      const recent = kev.filter((k) => ctx.now().getTime() - Date.parse(k.added) < 120 * 86_400_000).sort((a, b) => b.added.localeCompare(a.added));
      // Rapprochement : le nom exact (éditeur, produit, ou les deux accolés) ou la table des logiciels courants. Une piste à vérifier, pas une certitude.
      const flatOf = (x: string) => x.toLowerCase().replace(/[^a-z]/g, '');
      const mine = recent.filter((k) => { const vp = `${k.vendor} ${k.product}`.toLowerCase(); return [flatOf(k.vendor), flatOf(k.product), flatOf(vp)].some((w) => w.length > 3 && flatNames.has(w)) || KEV_PKG.some(([soft, pkg]) => soft.test(vp) && pkgs.some((n) => pkg.test(n))); });
      return { text: [`${kev.length} failles exploitées connues, dont ${recent.length} ajoutées ces 4 derniers mois.`, mine.length ? `⚠ ${mine.length} concernent un logiciel installé ici (rapprochement par le nom : vérifie ta version, et mets à jour) :\n${mine.slice(0, 15).map((k) => `- ${k.cve} · ${k.vendor} ${k.product} · ${k.name}${k.ransomware ? ' · utilisée par des rançongiciels' : ''} (${k.added})`).join('\n')}` : pk ? '✓ Aucune ne correspond à un logiciel installé ici.' : 'Liste des logiciels installés indisponible sur ce système (les failles récentes sont listées ci-dessous).', `Les plus récentes :\n${recent.slice(0, 8).map((k) => `- ${k.cve} · ${k.vendor} ${k.product} (${k.added})`).join('\n')}`].join('\n'), data: { total: kev.length, ici: mine.length } };
    } },
    { id: 'sentinelles', label: 'Poser des fichiers sentinelles', what: 'Deux faux documents dans un dossier : si quelque chose les chiffre ou les renomme, c\'est un rançongiciel, et Odin alerte aussitôt', params: [{ key: 'dossier', label: 'Dossier à protéger', kind: 'text', required: true }], words: ['sentinelle', 'sentinelles'], run: (ctx, i) => {
      const d = s(i.dossier).replace(/\/+$/, ''); if (!existsSync(d) || !statSync(d).isDirectory()) throw new Error('dossier introuvable');
      const made: Canary[] = CANARY.map((n) => { const f = join(d, n), b = Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), randomBytes(2048)]); writeFileSync(f, b); return { file: f, sha: createHash('sha256').update(b).digest('hex') }; });
      ctx.saveSettings({ canaries: [...canaries(ctx).filter((c) => dirname(c.file) !== d), ...made] }); startWatch(ctx);
      return { text: `🛎 Sentinelles posées dans ${d} (${CANARY.join(', ')}). Ne les ouvre pas et ne les supprime pas : si elles changent, je te préviens tout de suite.` };
    } },
    { id: 'protection', quick: false, label: 'Protection en continu', what: 'Analyse à l\'arrivée (téléchargements, supports amovibles) et réponse automatique', params: [{ key: 'actif', label: 'Analyser à l\'arrivée', kind: 'boolean', default: true }, { key: 'quarantaine', label: 'Quarantaine automatique quand c\'est sûr', kind: 'boolean', default: true }, { key: 'dossiers', label: 'Autres dossiers à surveiller (un par ligne)', kind: 'textarea', default: '' }], run: (ctx, i) => { ctx.saveSettings({ onArrival: i.actif !== false, auto: i.quarantaine !== false, watch: s(i.dossiers).split('\n').map((q) => q.trim()).filter((q) => q && existsSync(q)) }); startWatch(ctx); return { text: `Protection en continu ${i.actif !== false ? 'active' : 'coupée'} · quarantaine automatique ${i.quarantaine !== false ? 'active (seulement quand une empreinte ou une règle sûre correspond)' : 'coupée'} · ${st(ctx).watchers.length} dossier(s) surveillé(s).` }; } },
  ],
  start(ctx) { const x = st(ctx), l = x.intel.load(); for (const r of l.refused) ctx.alert({ level: 'haute', title: 'Ullr : paquet de signatures refusé', detail: `Version ${r.version} : ${r.why}. ${l.version ? `Retour à la version ${l.version}.` : 'Les règles de base restent en service.'}`, key: `sig:${r.version}` }); x.set = undefined; startWatch(ctx); },
  stop() { for (const x of states.values()) { for (const w of x.watchers) w.close(); x.watchers = []; for (const t of x.pending.values()) clearTimeout(t); x.pending.clear(); if (x.running) x.running.cancel = true; } states.clear(); },
  view(ctx) {
    const x = st(ctx), m = x.intel.manifest(), last = reports(ctx)[0], hits = dets(ctx).slice(0, 40), open = x.corr.incidents.filter((i) => i.state === 'ouvert'), name = (id: string) => ctx.modules().find((q) => q.id === id)?.name ?? id;
    const age = m ? Math.round((ctx.now().getTime() - Date.parse(m.at)) / 3600_000) : undefined;
    return {
      subtitle: x.running ? `Analyse en cours : ${x.running.target} · ${x.running.files} fichiers · ${x.running.hits} détection(s)` : `Base version ${m?.version ?? 0}${age !== undefined ? ` (il y a ${age < 48 ? `${age} h` : `${Math.round(age / 24)} j`})` : ' (règles de base)'} · ${x.intel.hashCount() ? `${x.intel.hashCount()} empreintes` : 'pas d\'empreintes (clé abuse.ch absente)'} · ${ruleSet(ctx).rules.length} règles · ${x.watchers.length} dossier${x.watchers.length > 1 ? 's' : ''} surveillé${x.watchers.length > 1 ? 's' : ''}`,
      tabs: ['Váli · console', 'Galdr · règles', 'Níðhögg · sites web', 'Quarantaine'],
      kpis: [{ label: 'Incidents ouverts', value: String(open.length), tone: open.some((i) => i.level === 'critique') ? 'mauvais' : open.length ? 'attention' : 'bon' }, { label: 'Détections', value: String(dets(ctx).filter((d) => d.action === 'à vérifier').length), hint: 'à vérifier', tone: dets(ctx).some((d) => d.action === 'à vérifier') ? 'attention' : 'bon' }, { label: 'Quarantaine', value: String(qlist(ctx).length) }, { label: 'Dernière analyse', value: last ? `${last.files} fichier${last.files > 1 ? 's' : ''}` : '—', hint: last ? `${last.target} · ${new Date(last.at).toLocaleString('fr-FR')}` : undefined }, { label: 'Signatures', value: m ? `v${m.version}` : 'de base', hint: `${x.intel.hashCount()} empreintes · ${x.intel.iocCount()} indicateurs${x.intel.hashCount() ? '' : ' · sans clé abuse.ch, pas d\'empreintes de malwares (encadré « Clés des sources »)'}`, tone: age === undefined || age > 72 ? 'attention' : 'bon' }],
      sections: [
        { kind: 'table', title: 'Incidents (signaux reliés entre les applis)', columns: ['Quand', 'Incident', 'Risque', 'Vu par', 'État'], empty: '✓ Aucun incident.', rows: x.corr.incidents.slice(0, 15).map((i) => ({ cells: [i.at.slice(5, 16).replace('T', ' '), i.title, `${i.score}/100`, i.apps.join(', '), i.state], tone: i.state !== 'ouvert' ? 'neutre' as const : i.level === 'critique' ? 'mauvais' as const : 'attention' as const, actions: i.state === 'ouvert' ? [{ action: 'incident', label: 'Traité', input: { incident: i.id, etat: 'traité' } }, { action: 'incident', label: 'Ignorer', input: { incident: i.id, etat: 'ignoré' } }] : [] })) },
        { kind: 'table', title: 'Détections', columns: ['Quand', 'Menace', 'Fichier', 'Score', 'Trouvée par', 'Action'], empty: '✓ Rien trouvé.', rows: hits.map((h) => ({ cells: [h.at.slice(5, 16).replace('T', ' '), h.threat, h.file, `${h.score}/100`, h.by, h.action], tone: h.action.startsWith('fausse') ? 'neutre' as const : h.level === 'critique' ? 'mauvais' as const : 'attention' as const, actions: h.action === 'à vérifier' ? [{ action: 'isoler', label: 'Isoler', input: { fichier: h.file, menace: h.threat } }, { action: 'faux_positif', label: 'Fausse alerte', input: { detection: h.id } }] : h.action === 'en quarantaine' ? [{ action: 'faux_positif', label: 'Fausse alerte', input: { detection: h.id } }] : [] })) },
        { kind: 'table', title: 'Quarantaine', columns: ['Menace', 'Fichier d\'origine', 'Depuis'], empty: 'Vide.', rows: qlist(ctx).map((q) => ({ cells: [q.threat, q.file, q.at.slice(0, 16).replace('T', ' ')], actions: [{ action: 'restaurer', label: 'Restaurer', input: { id: q.id } }, { action: 'supprimer', label: 'Supprimer', input: { id: q.id } }] })) },
        { kind: 'table', title: 'Analyser en un clic', columns: ['Profil', 'Ce qui est analysé'], rows: Object.entries(PROFILES(ctx)).map(([k, dirs]) => ({ cells: [k, dirs.filter((d) => existsSync(d)).join(', ') || 'aucun de ces dossiers n\'existe ici'], tone: 'neutre' as const, actions: [{ action: 'analyser', label: 'Analyser', input: { dossier: k } }] })) },
        { kind: 'table', title: 'Analyses planifiées', columns: ['Plan', 'Cible', 'Quand', 'Dernière', 'Prochaine'], empty: 'Aucune : les téléchargements sont analysés à l\'arrivée, les sites web chaque nuit.', rows: plans(ctx).map((p) => ({ cells: [p.name, p.target, `chaque ${p.every}${p.every === 'heure' ? '' : ` à ${p.at}`}`, p.last ? p.last.slice(0, 16).replace('T', ' ') : 'jamais', p.next ? new Date(p.next).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'], actions: [{ action: 'analyser', label: 'Lancer', input: { dossier: p.target, exclusions: p.exclude.join('\n') } }, { action: 'retirer_plan', label: 'Retirer', input: { nom: p.name } }] })) },
        { kind: 'table', title: 'Rapports', columns: ['Quand', 'Cible', 'Fichiers', 'Détections', 'Durée'], empty: 'Aucune analyse faite.', rows: reports(ctx).slice(0, 12).map((r) => ({ cells: [r.at.slice(0, 16).replace('T', ' '), r.target, String(r.files), String(r.hits), `${Math.round(r.ms / 1000)} s`], tone: r.hits ? 'attention' as const : 'bon' as const, actions: [{ action: 'rapport', label: 'Lire', input: { rapport: r.id } }] })) },
        { kind: 'table', title: 'Sources des signatures', columns: ['Source', 'Apporte', 'État', 'Licence et conditions'], rows: SOURCES.map((q) => { const z = m?.sources.find((y) => y.id === q.id), miss = Boolean(q.needs && !process.env[q.needs]); return { cells: [q.name, q.gives, q.mode === 'référence' ? 'référence (non branchée)' : q.mode === 'à la demande' ? (miss ? `clé absente (${q.needs})` : 'à la demande') : !q.fetch ? 'gérée par Geri' : !srcOn(ctx, q.id) ? 'désactivée' : miss ? `clé absente (${q.needs})` : z ? `${z.count} · ${z.at.slice(0, 10)}` : 'pas encore mise à jour', q.licence], tone: q.mode === 'référence' ? 'neutre' as const : miss || (q.fetch && !srcOn(ctx, q.id)) ? 'attention' as const : 'bon' as const, actions: q.fetch ? [{ action: 'source', label: srcOn(ctx, q.id) ? 'Désactiver' : 'Activer', input: { source: q.id, actif: !srcOn(ctx, q.id) } }] : [] }; }) },
        { kind: 'table', title: 'Capteurs : les applis qui renseignent l\'antivirus', columns: ['Appli', 'Ce qu\'elle signale', 'Dernier signal'], rows: SENSORS.filter((q) => ctx.modules().some((y) => y.id === q.app)).map((q) => { const lastSig = x.seen.get(q.app); return { cells: [name(q.app), q.what, lastSig ? new Date(lastSig).toLocaleString('fr-FR') : 'rien à signaler'], tone: 'neutre' as const }; }) },
        { kind: 'text', title: 'Ce qu\'il faut savoir', text: 'Aucun antivirus ne détecte 100 % des menaces, celui-ci non plus. Une empreinte connue ou une règle sûre déclenche la quarantaine (réversible). Un simple faisceau d\'indices est marqué « à vérifier » : c\'est toi qui décides. Rien n\'est jamais supprimé sans ton accord, et aucun fichier n\'est envoyé sur Internet (seulement des empreintes).' },
      ],
      side: [{ kind: 'form', title: 'Analyser', action: 'analyser', submit: 'Analyser', params: [{ key: 'dossier', label: 'Dossier ou profil', kind: 'text', default: 'téléchargements', help: `Profils : ${Object.keys(PROFILES(ctx)).join(', ')}` }] }, { kind: 'form', title: 'Vérifier une adresse web', action: 'adresse', submit: 'Vérifier', params: ullr.actions.find((a) => a.id === 'adresse')!.params! }, { kind: 'form', title: 'Planifier une analyse', action: 'plan', submit: 'Planifier', params: ullr.actions.find((a) => a.id === 'plan')!.params! }, { kind: 'form', title: 'Galdr · nouvelle règle', action: 'regle', submit: 'Ajouter', params: ullr.actions.find((a) => a.id === 'regle')!.params! }, { kind: 'form', title: `Clés des sources (abuse.ch : ${process.env.ABUSE_CH_KEY ? 'présente' : 'absente'} · VirusTotal : ${process.env.VT_API_KEY ? 'présente' : 'absente'})`, action: 'cles', submit: 'Ranger', params: ullr.actions.find((a) => a.id === 'cles')!.params! }],
    };
  },
  watch: { every: 60, async run(ctx) {
    const x = st(ctx), now = ctx.now();
    checkCanaries(ctx);
    // Supports amovibles : un nouveau support monté est analysé (les 20 000 premiers fichiers).
    const mounts = new Set(removable()); if (x.mounts && ctx.settings.usb !== false) for (const mnt of mounts) if (!x.mounts.has(mnt) && !x.running) { ctx.emit('support_branche', { dossier: mnt }); void runScan(ctx, mnt, { max: 20_000 }).then((r) => { if (r.detections.length) ctx.alert({ level: 'haute', title: `Ullr : ${r.detections.length} menace(s) sur le support ${basename(mnt)}`, detail: reportText(r).slice(0, 700), key: `usb:${mnt}:${r.id}` }); }).catch(() => undefined); }
    x.mounts = mounts;
    // Sources dues (chacune à son rythme), hors de toute analyse en cours.
    if (!x.running && !x.busy && now.getTime() - Date.parse(s(ctx.settings.checkedAt) || '2000-01-01') > 3600_000) void update(ctx).catch(() => undefined);
    // Analyses planifiées : chacune à son prochain passage (un passage manqué pendant un arrêt est rattrapé une fois).
    const night: Plan = { name: 'Sites web (chaque nuit)', target: 'sites web', every: 'jour', at: '03:10', exclude: [], last: s(ctx.settings.siteAt) || undefined, next: s(ctx.settings.siteNext) || undefined };
    const all: Plan[] = [...plans(ctx), ...(ctx.settings.nightSites === false || !PROFILES(ctx)['sites web'].some((p) => existsSync(p)) ? [] : [night])];
    for (const p of all) {
      const builtin = p === night;
      if (!p.next) { const n = nextRun(p, now).toISOString(); if (builtin) ctx.saveSettings({ siteNext: n }); else ctx.saveSettings({ plans: plans(ctx).map((q) => (q.name === p.name ? { ...q, next: n } : q)) }); continue; }
      if (now.getTime() < Date.parse(p.next) || x.running) continue;
      const n = nextRun(p, now, now).toISOString();
      if (builtin) ctx.saveSettings({ siteAt: now.toISOString(), siteNext: n }); else ctx.saveSettings({ plans: plans(ctx).map((q) => (q.name === p.name ? { ...q, last: now.toISOString(), next: n } : q)) });
      void runScan(ctx, p.target, { plan: p.name, exclude: p.exclude }).catch((e) => ctx.alert({ level: 'moyenne', title: `Ullr : l'analyse « ${p.name} » n'a pas pu se faire`, detail: (e as Error).message, key: `plan:${p.name}` }));
      break;
    }
  } },
};
