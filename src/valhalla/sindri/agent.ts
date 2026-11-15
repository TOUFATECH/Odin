// Phénix · l'agent des PC du foyer. Satellites l'installe sur un poste (Linux, macOS par SSH ; Windows par SSH ou
// WinRM) ; toutes les heures le poste pousse lui-même ce qui a changé vers Odin (POST /api/sindri/agent/…, voir
// src/web/phenix-agent-api.ts). Odin range les morceaux dans le dépôt du plan « PC · <poste> » : compressés, chiffrés,
// dédupliqués, copiés vers la destination du plan, avec rotation. La restauration se demande dans le navigateur ;
// l'agent la fait au passage suivant (ou tout de suite si Satellites le lance).
//
// Comme les capsules d'Écho, chaque agent a son jeton : Odin n'en garde que l'empreinte (SHA-256).
// Ce fichier n'importe pas Phénix (../modules/sindri.ts) au chargement : il le charge au moment de s'en servir.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { findMachine, type Machine } from '../../machines/access.ts';
import { PS_PROTEGER, PS_PYTHON, PS_SORTIR, psTexte } from '../../machines/windows.ts';
import { surPoste } from '../rodd/capsule-windows.ts';
import { empreinteOdin, lireEtat } from '../rodd/capsule.ts';
import type { Action, ActionResult, ModCtx } from '../types.ts';
import type { FileEntry, Plan, Repo, Snapshot, TypeSauvegarde } from '../modules/sindri.ts';

export const VERSION_AGENT = '1.0.0';
const MORCEAU = 1024 * 1024;
const phenix = () => import('../modules/sindri.ts');
const s = (v: unknown) => String(v ?? '');

// ---------------- Jetons des agents ----------------
export interface AgentInscrit { poste: string; empreinte: string; at: string; plan: string; version: string }
export const fichierAgents = (home: string) => join(home, 'valhalla', 'sindri', 'agents.json');
const hacher = (jeton: string) => createHash('sha256').update(jeton, 'utf8').digest('hex');
const propre = (poste: string) => poste.trim().replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 60);
export const nomPlanAgent = (poste: string) => `PC · ${propre(poste)}`;

export function agents(home: string): AgentInscrit[] {
  try { return (JSON.parse(readFileSync(fichierAgents(home), 'utf8')) as AgentInscrit[]).filter((x) => x && typeof x.poste === 'string' && /^[a-f0-9]{64}$/.test(x.empreinte)); } catch { return []; }
}
function ecrireAgents(home: string, l: AgentInscrit[]): void {
  const f = fichierAgents(home); mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
  writeFileSync(`${f}.tmp`, JSON.stringify(l, null, 1), { mode: 0o600 }); renameSync(`${f}.tmp`, f);
}
/** Inscrit (ou réinscrit) l'agent d'un poste ; rend son jeton (à remettre au poste seulement). */
export function inscrireAgent(home: string, poste: string, now = new Date()): string {
  const p = propre(poste); if (!p) throw new Error('nom de poste invalide');
  const jeton = randomBytes(32).toString('hex');
  ecrireAgents(home, [...agents(home).filter((x) => x.poste !== p), { poste: p, empreinte: hacher(jeton), at: now.toISOString(), plan: nomPlanAgent(p), version: VERSION_AGENT }]);
  return jeton;
}
export function desinscrireAgent(home: string, poste: string): boolean {
  const l = agents(home), n = l.filter((x) => x.poste !== propre(poste));
  if (n.length === l.length) return false;
  ecrireAgents(home, n); return true;
}
/** L'agent à qui appartient ce jeton (comparaison à temps constant). */
export function agentDuJeton(home: string, jeton: string): AgentInscrit | undefined {
  if (!/^[a-f0-9]{64}$/.test(jeton)) return undefined;
  const h = Buffer.from(hacher(jeton), 'hex'); let trouve: AgentInscrit | undefined;
  for (const x of agents(home)) if (timingSafeEqual(Buffer.from(x.empreinte, 'hex'), h)) trouve = x;
  return trouve;
}

// ---------------- Réception (côté Odin) ----------------

/** Une erreur rendue à l'agent avec son code HTTP. */
export class RefusAgent extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
interface Session { id: string; poste: string; plan: string; sorte: TypeSauvegarde; parent?: string; repo: Repo; recus: Map<string, string>; ajoutes: number; at: number }
const sessions = new Map<string, Session>();
/** sha256 d'un morceau → son identifiant dans le dépôt (par plan), gardé dans un fichier d'Odin (jamais à la destination). */
const index = new Map<string, Map<string, string>>();
const fichierIndex = (ctx: ModCtx, plan: string, slug: (t: string) => string) => join(ctx.dir, 'agents', `${slug(plan)}.index`);
function indexDe(ctx: ModCtx, plan: string, slug: (t: string) => string): Map<string, string> {
  const f = fichierIndex(ctx, plan, slug); let m = index.get(f);
  if (!m) {
    m = new Map();
    try { for (const l of readFileSync(f, 'utf8').split('\n')) { const [a, b] = l.split(' '); if (/^[a-f0-9]{64}$/.test(a ?? '') && b) m.set(a, b); } } catch { /* nouveau */ }
    index.set(f, m);
  }
  return m;
}
function noter(ctx: ModCtx, plan: string, slug: (t: string) => string, sha: string, id: string): void {
  const m = indexDe(ctx, plan, slug); if (m.get(sha) === id) return;
  m.set(sha, id); const f = fichierIndex(ctx, plan, slug); mkdirSync(dirname(f), { recursive: true, mode: 0o700 }); appendFileSync(f, `${sha} ${id}\n`, { mode: 0o600 });
}
const planDuPoste = (l: Plan[], poste: string) => l.find((p) => p.agent === poste);

/** Début d'une sauvegarde poussée : la sorte à faire (complète si l'agent et Odin ne sont pas d'accord sur la dernière), une restauration en attente. */
export async function debut(ctx: ModCtx, a: AgentInscrit, corps: Record<string, unknown>): Promise<Record<string, unknown>> {
  const P = await phenix(), p = planDuPoste(P.plans(ctx), a.poste);
  if (!p) throw new RefusAgent(404, `aucun plan Phénix pour ${a.poste} : réinstalle l'agent depuis Satellites`);
  for (const [k, x] of sessions) if (x.poste === a.poste || Date.now() - x.at > 6 * 3600_000) sessions.delete(k);
  const t = P.distant(p) && p.destination ? (await import('./transport.ts')).transportDe(ctx.home, p.destination) : undefined;
  const repo = await P.ouvrir(ctx, p, t, t ? await t.liste() : undefined);
  const mine = repo.snapshots().filter((x) => x.plan === p.name), dernier = mine[0];
  const sorte: TypeSauvegarde = corps.complete === true || !dernier || dernier.id !== s(corps.dernier) ? 'complète' : P.typeDuJour(p, mine, ctx.now());
  const id = randomBytes(16).toString('hex');
  sessions.set(id, { id, poste: a.poste, plan: p.name, sorte, ...(sorte !== 'complète' && dernier ? { parent: dernier.id } : {}), repo, recus: new Map(), ajoutes: 0, at: Date.now() });
  const tache = taches(ctx).find((x) => x.poste === a.poste);
  return { session: id, sorte, ...(tache ? { restauration: { tache: tache.tache } } : {}) };
}
function session(a: AgentInscrit, id: string): Session {
  const x = sessions.get(id); if (!x || x.poste !== a.poste) throw new RefusAgent(409, 'session inconnue ou expirée : la sauvegarde recommencera à l\'heure suivante');
  x.at = Date.now(); return x;
}
/** Les morceaux qu'Odin n'a pas encore (ou plus : effacés par une purge). */
export async function manque(ctx: ModCtx, a: AgentInscrit, id: string, shas: unknown): Promise<string[]> {
  const x = session(a, id), P = await phenix(), idx = indexDe(ctx, x.plan, P.slug);
  if (!Array.isArray(shas) || shas.length > 20_000) throw new RefusAgent(400, 'liste de morceaux invalide');
  return shas.map(String).filter((h) => /^[a-f0-9]{64}$/.test(h)).filter((h) => { const i = x.recus.get(h) ?? idx.get(h); return !i || !x.repo.has(i); });
}
/** Un morceau reçu : vérifié (empreinte et taille), rangé dans le dépôt (compressé, chiffré). */
export async function morceau(ctx: ModCtx, a: AgentInscrit, id: string, sha: string, data: Buffer): Promise<void> {
  const x = session(a, id), P = await phenix();
  if (data.length > MORCEAU || !/^[a-f0-9]{64}$/.test(sha) || createHash('sha256').update(data).digest('hex') !== sha) throw new RefusAgent(400, 'morceau abîmé en route (empreinte différente)');
  const r = x.repo.put(data); x.recus.set(sha, r.id); if (r.added) x.ajoutes += data.length;
  noter(ctx, x.plan, P.slug, sha, r.id);
}
/** Fin : la liste des fichiers devient une version (complète ou incrémentielle), rotation, envoi à la destination. */
export async function fin(ctx: ModCtx, a: AgentInscrit, id: string, corps: Record<string, unknown>): Promise<Record<string, unknown>> {
  const x = session(a, id), P = await phenix(), p = planDuPoste(P.plans(ctx), a.poste); if (!p) throw new RefusAgent(404, 'plan disparu');
  const idx = indexDe(ctx, x.plan, P.slug), liste = Array.isArray(corps.fichiers) ? corps.fichiers as Array<Record<string, unknown>> : [];
  const present = Array.isArray(corps.present) ? (corps.present as unknown[]).map(String) : [];
  const files: FileEntry[] = []; let bytes = 0, absents = 0;
  for (const f of liste) {
    const shas = Array.isArray(f.sha) ? (f.sha as unknown[]).map(String) : [];
    const chunks = shas.map((h) => x.recus.get(h) ?? idx.get(h) ?? '');
    if (chunks.some((c) => !c || !x.repo.has(c))) { absents++; continue; }
    const size = Number(f.size), mtime = Number(f.mtime);
    if (!s(f.path) || !Number.isFinite(size) || !Number.isFinite(mtime)) continue;
    files.push({ path: s(f.path), size, mtime, mode: Number(f.mode) & 0o777 || 0o644, chunks }); bytes += size;
  }
  if (absents) throw new RefusAgent(409, `${absents} fichier(s) dont des morceaux n'ont pas été reçus : rien n'est enregistré`);
  const now = ctx.now(), racines = Array.isArray(corps.racines) ? (corps.racines as unknown[]).map(String).slice(0, 200) : p.paths;
  const snap: Snapshot = {
    id: `${now.toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`, at: now.toISOString(), plan: p.name, paths: racines, files, bytes, added: x.ajoutes,
    type: x.sorte, ...(x.sorte !== 'complète' && x.parent ? { parent: x.parent, present } : {}),
    poste: { nom: a.poste, vss: corps.vss === true, sautes: Math.max(0, Number(corps.sautes) || 0), ouverts: Array.isArray(corps.ouverts) ? (corps.ouverts as unknown[]).map(String).slice(0, 50) : [] },
  };
  x.repo.saveSnapshot(snap); sessions.delete(id);
  const vieux = P.aOublier(x.repo.snapshots().filter((y) => y.plan === p.name), p.keep); for (const o of vieux) x.repo.forget(o.id);
  let envoi = '', ok = true;
  if (p.destination && P.distant(p)) {
    try { const t = (await import('./transport.ts')).transportDe(ctx.home, p.destination), e = await P.envoyerDepot(x.repo, t, p.garderLocal !== false); envoi = `copiée et vérifiée sur ${t.nom} (${e.envoyes} fichier(s))`; }
    catch (e) { ok = false; envoi = `copie vers la destination en échec : ${(e as Error).message}`; ctx.alert({ level: 'haute', title: `Sauvegarde de ${a.poste} : copie en échec`, detail: (e as Error).message, key: `agent-envoi:${a.poste}` }); }
  }
  const last = (ctx.settings.last as Record<string, unknown>) ?? {}, totale = snap.parent ? P.contenu(x.repo, snap).length : files.length;
  ctx.saveSettings({
    last: { ...last, [p.name]: { at: now.toISOString(), ok, files: totale, bytes, added: x.ajoutes, type: snap.type, ...(ok ? {} : { error: envoi }) } },
    plans: P.plans(ctx).map((y) => (y.name === p.name ? { ...y, paths: racines } : y)),
  });
  ctx.emit('sauvegarde_ok', { plan: p.name, poste: a.poste, fichiers: files.length, octets: bytes, type: snap.type ?? 'complète', vss: snap.poste?.vss ?? false });
  return { instantane: snap.id, sorte: snap.type, lus: files.length, retirees: vieux.length, ...(envoi ? { envoi } : {}) };
}

// ---------------- Restauration sur le PC ----------------
export interface Tache { tache: string; poste: string; instantane: string; filtre: string; vers: string; at: string }
const taches = (ctx: ModCtx): Tache[] => (ctx.settings.restaurationsPc as Tache[] | undefined) ?? [];
const permis = new Map<string, { ids: Set<string>; repo: Repo }>();
/** Prépare une restauration (action grave « Restaurer sur le PC ») ; l'agent la fait à son prochain passage. */
export async function preparerRestauration(ctx: ModCtx, instantane: string, filtre: string, aSaPlace: boolean): Promise<Tache> {
  const P = await phenix(), { p, snap } = P.trouverInstantane(ctx, instantane);
  if (!p.agent) throw new Error('cette version ne vient pas de l\'agent d\'un PC : utilise « Restaurer »');
  const t: Tache = { tache: randomBytes(12).toString('hex'), poste: p.agent, instantane: snap.id, filtre, vers: aSaPlace ? '' : `Restauré par Odin ${ctx.now().toISOString().slice(0, 16).replace('T', ' ').replace(':', 'h')}`, at: ctx.now().toISOString() };
  ctx.saveSettings({ restaurationsPc: [...taches(ctx).filter((x) => x.poste !== p.agent), t] });
  return t;
}
/** Les fichiers d'une restauration (avec l'empreinte de chaque morceau, que l'agent vérifie). */
export async function fichiersRestauration(ctx: ModCtx, a: AgentInscrit, tache: string): Promise<Record<string, unknown>> {
  const t = taches(ctx).find((x) => x.tache === tache && x.poste === a.poste); if (!t) throw new RefusAgent(404, 'restauration inconnue');
  const P = await phenix(), { p, repo, snap } = P.trouverInstantane(ctx, t.instantane);
  const l = P.contenu(repo, snap).filter((f) => !t.filtre || f.path.includes(t.filtre));
  await P.rapatrier(ctx, p, repo, l.flatMap((f) => f.chunks));
  const inverse = new Map([...indexDe(ctx, p.name, P.slug)].map(([h, i]) => [i, h]));
  permis.set(tache, { ids: new Set(l.flatMap((f) => f.chunks)), repo });
  return { vers: t.vers, fichiers: l.map((f) => ({ path: f.path, size: f.size, mtime: f.mtime, mode: f.mode, morceaux: f.chunks.map((c) => ({ id: c, ...(inverse.has(c) ? { sha: inverse.get(c) } : {}) })) })) };
}
/** Un morceau d'une restauration (seulement ceux de cette restauration). */
export function morceauRestauration(tache: string, id: string): Buffer {
  const x = permis.get(tache); if (!x || !x.ids.has(id)) throw new RefusAgent(403, 'morceau hors de cette restauration');
  return x.repo.get(id);
}
export function finRestauration(ctx: ModCtx, a: AgentInscrit, tache: string, corps: Record<string, unknown>): void {
  const t = taches(ctx).find((x) => x.tache === tache && x.poste === a.poste); if (!t) throw new RefusAgent(404, 'restauration inconnue');
  permis.delete(tache);
  const erreurs = Array.isArray(corps.erreurs) ? (corps.erreurs as unknown[]).map(String).slice(0, 50) : [], fait = Math.max(0, Number(corps.fait) || 0);
  const faites = ((ctx.settings.restaurationsFaites as unknown[] | undefined) ?? []).slice(-19);
  ctx.saveSettings({ restaurationsPc: taches(ctx).filter((x) => x.tache !== tache), restaurationsFaites: [...faites, { ...t, fini: ctx.now().toISOString(), fait, erreurs }] });
  ctx.emit('restauration_pc', { poste: a.poste, fichiers: fait, erreurs: erreurs.length });
  if (erreurs.length) ctx.alert({ level: 'moyenne', title: `Restauration sur ${a.poste} : ${erreurs.length} fichier(s) non remis`, detail: erreurs.slice(0, 5).join('\n'), key: `restauration:${a.poste}` });
}

// ---------------- Installation (Satellites) ----------------
export const programmeAgent = (): string => readFileSync(new URL('./agent.py', import.meta.url), 'utf8');
const b64 = (t: string) => Buffer.from(t, 'utf8').toString('base64');
export const TACHE_AGENT = 'Odin - Phenix (sauvegarde)';
const RACCOURCI_AGENT = 'Odin - Phenix (sauvegarde).lnk';
/** La minute de chaque heure où ce poste sauvegarde (étalée d'un poste à l'autre). Pur. */
export const minuteDe = (poste: string) => createHash('sha256').update(poste).digest()[0] % 60;
interface ConfAgent { odin: string; jeton: string; poste: string; empreinte: string; dossiers: string[]; exclure: string[] }
function confAgent(c: ConfAgent): string {
  if (!/^https?:\/\/[^\s'"]+$/.test(c.odin)) throw new Error('adresse d\'Odin invalide (https://adresse:port)');
  for (const e of c.exclure) { try { new RegExp(e); } catch { throw new Error(`motif d'exclusion invalide : ${e}`); } }
  return JSON.stringify({ odin: c.odin.replace(/\/$/, ''), jeton: c.jeton, poste: propre(c.poste), empreinte: c.empreinte, dossiers: c.dossiers, exclure: c.exclure, version: VERSION_AGENT });
}
/** Linux, macOS : ~/.odin-phenix, droits 700 / 600, une ligne crontab toutes les heures, puis l'état en JSON. Pur. */
export function scriptAgentPosix(c: ConfAgent): string {
  const m = minuteDe(c.poste);
  return [
    'command -v python3 >/dev/null 2>&1 || { echo \'{"ok":false,"erreur":"python3 absent sur ce poste"}\'; exit 3; }',
    'umask 077',
    'python3 - <<\'PHENIX_AGENT\'',
    'import base64, os',
    'd = os.path.join(os.environ.get("HOME") or os.path.expanduser("~"), ".odin-phenix")',
    'os.makedirs(d, mode=0o700, exist_ok=True)',
    'os.chmod(d, 0o700)',
    `for nom, contenu, droits in (("agent.py", "${b64(programmeAgent())}", 0o700), ("agent.json", "${b64(confAgent(c))}", 0o600)):`,
    '    f = os.path.join(d, nom)',
    '    with open(f + ".tmp", "wb") as h:',
    '        h.write(base64.b64decode(contenu))',
    '    os.chmod(f + ".tmp", droits)',
    '    os.replace(f + ".tmp", f)',
    'PHENIX_AGENT',
    'python3 "$HOME/.odin-phenix/agent.py" regler --profil "$HOME" >/dev/null',
    'py=$(command -v python3); plan=aucune',
    `if command -v crontab >/dev/null 2>&1; then { crontab -l 2>/dev/null | grep -v '# odin-phenix$'; echo "${m} * * * * '$py' '$HOME/.odin-phenix/agent.py' sauvegarder >/dev/null 2>&1 # odin-phenix"; } | crontab - && plan=crontab; fi`,
    'python3 "$HOME/.odin-phenix/agent.py" etat --planification "$plan"',
  ].join('\n');
}
const PS_DEBUT = [
  '$ErrorActionPreference = \'Stop\'', '$ProgressPreference = \'SilentlyContinue\'', PS_SORTIR, PS_PYTHON, PS_PROTEGER,
  '$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
  `$tache = ${psTexte(TACHE_AGENT)}`,
  `$lnk = Join-Path (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Startup') ${psTexte(RACCOURCI_AGENT)}`,
  '$dossiers = @((Join-Path $env:ProgramData \'Odin\\phenix\'), (Join-Path $env:USERPROFILE \'.odin-phenix\'))',
  '$env:PYTHONIOENCODING = \'utf-8\'', '$env:ODIN_JSON_ASCII = \'1\'',
  String.raw`function Trouver-Agent { foreach ($x in $dossiers) { if (Test-Path -LiteralPath (Join-Path $x 'agent.py')) { return $x } }; return $null }
function Lire-Python($d) { $f = Join-Path $d 'python.txt'; if (Test-Path -LiteralPath $f) { return ([IO.File]::ReadAllText($f)).Trim() } else { return $null } }
function Arreter-Veille($d) {
  Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like ('*' + (Join-Path $d 'agent.py') + '*veiller*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}`,
];
/**
 * Windows : avec les droits administrateur, C:\ProgramData\Odin\phenix et une tâche planifiée du compte système
 * (instantané VSS, tous les profils lisibles) ; sinon le profil de la personne et une tâche à son nom. Toutes les
 * heures ; si la tâche est refusée : un raccourci dans le dossier Démarrage (l'agent veille et sauvegarde chaque heure).
 */
export function scriptAgentWindows(c: ConfAgent): string {
  const m = minuteDe(c.poste);
  return [...PS_DEBUT, String.raw`$py = Trouver-Python
if (-not $py) { Sortir @{ ok = $false; erreur = 'Python 3 absent sur ce poste : installe-le (python.org ou Microsoft Store) puis recommence' }; exit 3 }
$pyw = Python-Silencieux $py
if ($admin) { $d = $dossiers[0] } else { $d = $dossiers[1] }
foreach ($x in $dossiers) { Arreter-Veille $x }
New-Item -ItemType Directory -Force -Path $d | Out-Null
if ($admin) { Proteger $d -Systeme } else { Proteger $d }`,
  `Ecrire-B64 (Join-Path $d 'agent.py') '${b64(programmeAgent())}'`,
  `Ecrire-B64 (Join-Path $d 'agent.json') '${b64(confAgent(c))}'`,
  String.raw`[IO.File]::WriteAllText((Join-Path $d 'python.txt'), $py)
& $py (Join-Path $d 'agent.py') regler --profil $env:USERPROFILE | Out-Null
$nom = $env:USERNAME; if ($env:USERDOMAIN) { $nom = $env:USERDOMAIN + '\' + $env:USERNAME }
$plan = 'aucune'
try {
  $a = New-ScheduledTaskAction -Execute $pyw -Argument ('"' + (Join-Path $d 'agent.py') + '" sauvegarder') -WorkingDirectory $d`,
  `  $t = New-ScheduledTaskTrigger -Once -At ((Get-Date).Date.AddMinutes(${m})) -RepetitionInterval (New-TimeSpan -Hours 1)`,
  String.raw`  if ($admin) { $p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest } else { $p = New-ScheduledTaskPrincipal -UserId $nom -LogonType Interactive -RunLevel Limited }
  $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 12) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $tache -Action $a -Trigger $t -Principal $p -Settings $s -Description 'Odin : sauvegarde Phénix toutes les heures' -Force | Out-Null
  Remove-Item -LiteralPath $lnk -Force -ErrorAction SilentlyContinue
  if ($admin) { $plan = 'tâche planifiée (compte système, VSS)' } else { $plan = 'tâche planifiée' }
} catch {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $lnk) | Out-Null
  $w = New-Object -ComObject WScript.Shell
  $l = $w.CreateShortcut($lnk)
  $l.TargetPath = $pyw; $l.Arguments = ('"' + (Join-Path $d 'agent.py') + '" veiller'); $l.WorkingDirectory = $d; $l.WindowStyle = 7; $l.Description = 'Odin : sauvegarde Phénix'
  $l.Save()
  $plan = 'dossier Démarrage'
}
& $py (Join-Path $d 'agent.py') etat --planification $plan 2>$null | Select-Object -Last 1`].join('\n');
}
/** État, lancement tout de suite, retrait : Linux / macOS (sh) et Windows (PowerShell). Purs. */
export const gestesAgent = {
  installer: (c: ConfAgent) => ({ posix: scriptAgentPosix(c), windows: () => scriptAgentWindows(c) }),
  etat: () => ({ posix: 'if [ -f "$HOME/.odin-phenix/agent.py" ]; then python3 "$HOME/.odin-phenix/agent.py" etat; else echo \'{"ok":false,"erreur":"aucun agent Phénix sur ce poste"}\'; fi', windows: () => [...PS_DEBUT, String.raw`$d = Trouver-Agent
if (-not $d) { Sortir @{ ok = $false; erreur = "pas d'agent Phénix sur ce poste" }; exit 0 }
$py = Lire-Python $d
$e = & $py (Join-Path $d 'agent.py') etat 2>$null | Select-Object -Last 1
try { $o = $e | ConvertFrom-Json } catch { Sortir @{ ok = $false; erreur = "l'agent ne répond pas (Python déplacé ?)" }; exit 0 }
$q = 'aucune'; if (Get-ScheduledTask -TaskName $tache -ErrorAction SilentlyContinue) { $q = 'tâche planifiée' } elseif (Test-Path -LiteralPath $lnk) { $q = 'dossier Démarrage' }
$o | Add-Member -NotePropertyName planification -NotePropertyValue $q -Force
Sortir $o`].join('\n') }),
  lancer: () => ({ posix: 'python3 "$HOME/.odin-phenix/agent.py" sauvegarder', windows: () => [...PS_DEBUT, String.raw`$d = Trouver-Agent
if (-not $d) { Sortir @{ ok = $false; erreur = "pas d'agent Phénix sur ce poste" }; exit 3 }
$py = Lire-Python $d
& $py (Join-Path $d 'agent.py') sauvegarder 2>$null | Select-Object -Last 1`].join('\n') }),
  retirer: () => ({ posix: '{ crontab -l 2>/dev/null | grep -v \'# odin-phenix$\' | crontab - ; } 2>/dev/null; rm -rf "$HOME/.odin-phenix" && echo \'{"ok":true}\'', windows: () => [...PS_DEBUT, String.raw`foreach ($x in $dossiers) { Arreter-Veille $x }
try { Unregister-ScheduledTask -TaskName $tache -Confirm:$false -ErrorAction Stop } catch { }
Remove-Item -LiteralPath $lnk -Force -ErrorAction SilentlyContinue
foreach ($x in $dossiers) { if (Test-Path -LiteralPath $x) { Remove-Item -LiteralPath $x -Recurse -Force -ErrorAction SilentlyContinue } }
$reste = @($dossiers | Where-Object { Test-Path -LiteralPath $_ }); if (Get-ScheduledTask -TaskName $tache -ErrorAction SilentlyContinue) { $reste += $tache }
Sortir @{ ok = ($reste.Count -eq 0); reste = $reste }`].join('\n') }),
};

// ---------------- Actions ----------------
function machine(ctx: ModCtx, nom: string): Machine { const m = findMachine(ctx.home, nom); if (!m) throw new Error(`machine inconnue : ${nom} (ajoute-la dans Réglages → Machines)`); return m; }
const lignes = (v: unknown) => s(v).split('\n').map((x) => x.trim()).filter(Boolean);
const etatAgent = (e: Record<string, unknown> | undefined) => (!e ? 'réponse illisible' : e.ok === false ? s(e.erreur ?? 'erreur') : `version ${s(e.version)} · ${Array.isArray(e.dossiers) ? `${e.dossiers.length} dossier(s)` : '?'} · ${s(e.planification) || 'planification ?'}${e.vss === true ? ' · VSS possible' : ''}${e.derniere ? ` · dernière : ${s(e.derniere).slice(0, 16)}` : ''}`);
const paramsDest = [
  { key: 'destination', label: 'Destination', kind: 'select' as const, options: ['disque', 'sftp', 'partage'], default: 'disque', help: 'où Odin range les sauvegardes de ce PC' },
  { key: 'depot', label: 'Dossier de destination', kind: 'text' as const, default: '', help: 'vide : un dossier « pc » dans les données de Phénix' },
  { key: 'poste_destination', label: 'Serveur ou poste (SFTP, partage)', kind: 'text' as const, default: '' },
  { key: 'partage', label: 'Nom du partage (partage réseau)', kind: 'text' as const, default: '' },
];

/** Les actions de Satellites pour l'agent de Phénix (installer, état, lancer, retirer). */
export const actionsAgentPhenix: Action[] = [
  { id: 'phenix_installer', label: 'Installer la sauvegarde (Phénix)', what: 'Installe l\'agent de Phénix sur un poste du parc (Linux, Mac, Windows) : il sauvegarde ses dossiers toutes les heures vers Odin, en incrémentiel (VSS sous Windows avec les droits administrateur)',
    params: [{ key: 'machine', label: 'Machine', kind: 'text', required: true }, { key: 'acces', label: 'Accès (Windows)', kind: 'select', options: ['ssh', 'winrm'], default: 'ssh' }, { key: 'adresse_odin', label: 'Adresse d\'Odin vue depuis ce poste', kind: 'text', default: '' },
      { key: 'dossiers', label: 'Dossiers à sauvegarder (un par ligne ; vide : Documents, Bureau, Images, Musique, Vidéos)', kind: 'textarea', default: '' }, { key: 'exclure', label: 'Exclure (motifs, un par ligne)', kind: 'textarea', default: '' }, ...paramsDest],
    words: ['installe la sauvegarde sur', 'installe l\'agent phenix', 'installe l\'agent phénix', 'sauvegarde le pc'],
    grave: (i) => `installer l'agent de sauvegarde Phénix sur ${s(i.machine)} (tâche toutes les heures)`,
    run: async (ctx, i): Promise<ActionResult> => {
      const m = machine(ctx, s(i.machine)), odin = (s(i.adresse_odin) || s(ctx.settings.odinUrl)).trim().replace(/\/$/, '');
      if (!/^https?:\/\/[^\s'"]+$/.test(odin)) throw new Error('donne l\'adresse d\'Odin vue depuis ce poste (ex. https://192.168.1.10:8888)');
      const plan = await ctx.call('sindri', 'agent_plan', { poste: m.label, destination: i.destination, depot: i.depot, poste_destination: i.poste_destination, partage: i.partage }, `agent de sauvegarde installé sur ${m.label}`, { interne: true });
      if (plan.ok === false) throw new Error(plan.text);
      const jeton = inscrireAgent(ctx.home, m.label, ctx.now());
      const conf = { odin, jeton, poste: m.label, empreinte: /^https:/.test(odin) ? empreinteOdin(ctx.home) : '', dossiers: lignes(i.dossiers), exclure: lignes(i.exclure) };
      const r = await surPoste(ctx, m, gestesAgent.installer(conf), i, 120_000).catch((e: Error) => ({ code: 1, out: JSON.stringify({ ok: false, erreur: e.message }), systeme: 'posix' as const }));
      const e = lireEtat(r.out);
      if (r.code !== 0 || !e || e.ok === false) { desinscrireAgent(ctx.home, m.label); throw new Error(`agent non installé sur ${m.label} : ${etatAgent(e)}`); }
      ctx.saveSettings({ odinUrl: odin }); ctx.emit('agent_phenix_installe', { poste: m.label });
      return { text: `💾 Agent de Phénix installé sur ${m.label} (${etatAgent(e)}).\nIl sauvegarde toutes les heures (à la minute ${minuteDe(m.label)}) vers le plan « ${nomPlanAgent(m.label)} ».`, data: e };
    } },
  { id: 'phenix_etat', label: 'État de l\'agent de sauvegarde', what: 'Demande son état à l\'agent de Phénix d\'un poste', read: true, params: [{ key: 'machine', label: 'Machine', kind: 'text', required: true }], words: ['etat de l\'agent de sauvegarde', 'état de l\'agent de sauvegarde'],
    run: async (ctx, i) => { const m = machine(ctx, s(i.machine)), r = await surPoste(ctx, m, gestesAgent.etat(), {}, 30_000), e = lireEtat(r.out); return { text: `${m.label} : ${etatAgent(e)}`, data: e }; } },
  { id: 'phenix_lancer', label: 'Sauvegarder ce PC maintenant', what: 'Lance tout de suite la sauvegarde de l\'agent de Phénix d\'un poste (et une restauration en attente)', params: [{ key: 'machine', label: 'Machine', kind: 'text', required: true }], words: ['sauvegarde ce pc', 'lance la sauvegarde du pc'],
    run: async (ctx, i) => {
      const m = machine(ctx, s(i.machine)), r = await surPoste(ctx, m, gestesAgent.lancer(), {}, 6 * 3600_000), e = lireEtat(r.out);
      if (r.code !== 0 || !e || e.ok === false) throw new Error(`${m.label} : ${s(e?.erreur) || r.out.trim().split('\n').at(-1)?.slice(0, 200) || 'pas de réponse'}`);
      const rest = e.restauration as { fichiers?: number; erreurs?: number; vers?: string } | undefined;
      return { text: `💾 ${m.label} : ${s(e.fichiers)} fichiers, ${s(e.lus)} lus, ${s(e.envoyes)} morceau(x) envoyé(s) — sauvegarde ${s(e.sorte)}${e.vss === true ? ' (instantané VSS)' : ''}${Number(e.sautes) ? `, ${s(e.sautes)} fichier(s) ouvert(s) sauté(s)` : ''}.${rest ? ` Restauration : ${s(rest.fichiers)} fichier(s) remis (${s(rest.vers)})${rest.erreurs ? `, ${rest.erreurs} en erreur` : ''}.` : ''}`, data: e };
    } },
  { id: 'phenix_retirer', label: 'Retirer l\'agent de sauvegarde', what: 'Retire l\'agent de Phénix d\'un poste (son jeton ne vaut plus rien ; les sauvegardes déjà faites restent)', params: [{ key: 'machine', label: 'Machine', kind: 'text', required: true }], words: ['retire l\'agent de sauvegarde', 'desinstalle l\'agent phenix', 'désinstalle l\'agent phénix'],
    grave: (i) => `retirer l'agent de sauvegarde Phénix de ${s(i.machine)}`,
    run: async (ctx, i) => {
      const m = machine(ctx, s(i.machine)); desinscrireAgent(ctx.home, m.label);
      const r = await surPoste(ctx, m, gestesAgent.retirer(), {}, 60_000).catch(() => ({ code: 1, out: '' })), e = lireEtat(r.out);
      return { text: r.code === 0 && e?.ok !== false ? `Agent de Phénix retiré de ${m.label} (tâche et dossier effacés ; ses sauvegardes restent dans « ${nomPlanAgent(m.label)} »).` : `Jeton de ${m.label} révoqué ; le poste n'a pas tout effacé (${Array.isArray(e?.reste) ? (e.reste as string[]).join(', ') : 'pas de réponse'}).` };
    } },
];

/** Les actions de Phénix pour les PC du foyer (plan d'un agent, restauration sur le PC). */
export const actionsAgentSindri: Action[] = [
  { id: 'agent_plan', label: 'Plan d\'un PC du foyer', what: 'Crée ou règle le plan qui reçoit les sauvegardes de l\'agent d\'un PC (installé par Satellites)', quick: false,
    params: [{ key: 'poste', label: 'Poste', kind: 'text', required: true }, ...paramsDest, { key: 'derniers', label: 'Garder les N dernières (une par heure)', kind: 'number', default: 24 }, { key: 'jours', label: 'Puis une par jour (jours)', kind: 'number', default: 14 }, { key: 'semaines', label: 'Puis une par semaine', kind: 'number', default: 8 }, { key: 'mois', label: 'Puis une par mois', kind: 'number', default: 12 }],
    run: async (ctx, i) => {
      const P = await phenix(), { lireDestination, transportDe, essayer, decrire } = await import('./transport.ts');
      const poste = propre(s(i.poste)); if (!poste) throw new Error('quel poste ?');
      const n = (v: unknown, d: number) => { const x = v === undefined || v === '' ? d : Math.floor(Number(v)); return Number.isFinite(x) ? Math.min(5000, Math.max(0, x)) : d; };
      const nom = nomPlanAgent(poste), ancien = P.plans(ctx).find((x) => x.name === nom);
      const dest = lireDestination({ genre: i.destination, dossier: s(i.depot) || (s(i.destination) && s(i.destination) !== 'disque' ? '' : join(ctx.dir, 'pc', P.slug(poste))), poste: i.poste_destination, partage: i.partage }) ?? ancien?.destination;
      if (!dest) throw new Error('où ranger les sauvegardes de ce PC ?');
      const p: Plan = { ...(ancien ?? {}), name: nom, paths: ancien?.paths ?? [], repo: dest.genre === 'disque' ? dest.dossier : '', at: '', agent: poste, schema: 'incrémentielle', completeTous: ancien?.completeTous ?? 30, compression: ancien?.compression ?? 'normale', keep: { last: n(i.derniers, 24), daily: n(i.jours, 14), weekly: n(i.semaines, 8), monthly: n(i.mois, 12) }, garderLocal: ancien?.garderLocal ?? true, ...(dest.genre === 'disque' ? {} : { destination: dest }) };
      if (dest.genre === 'disque') delete p.destination;
      let essai = '';
      if (p.destination) { const t = transportDe(ctx.home, p.destination); essai = ` Destination : ${await essayer(t)}.`; await P.ouvrir(ctx, p, t, await t.liste()); } else P.depot(ctx, p);
      ctx.saveSettings({ plans: [...P.plans(ctx).filter((x) => x.name !== nom), p] });
      return { text: `🗓 Plan « ${nom} » : sauvegardes poussées par le PC toutes les heures → ${p.destination ? decrire(p.destination) : p.repo}.${essai}` };
    } },
  { id: 'restaurer_pc', label: 'Restaurer sur le PC', what: 'Remet sur le PC des fichiers d\'une de ses versions (à leur place, ou dans un dossier « Restauré par Odin ») : l\'agent le fait tout de suite ou à son prochain passage',
    params: [{ key: 'instantane', label: 'Instantané', kind: 'text', required: true }, { key: 'filtre', label: 'Seulement les chemins contenant', kind: 'text', default: '' }, { key: 'a_sa_place', label: 'À leur place d\'origine (par-dessus)', kind: 'boolean', default: false }],
    grave: (i) => (i.a_sa_place === true || i.a_sa_place === 'true' ? 'restaurer sur le PC par-dessus ses fichiers actuels' : 'écrire sur le PC les fichiers d\'une sauvegarde (dossier « Restauré par Odin »)'),
    run: async (ctx, i) => {
      const t = await preparerRestauration(ctx, s(i.instantane).trim(), s(i.filtre), i.a_sa_place === true || i.a_sa_place === 'true');
      const r = await ctx.call('hermod', 'phenix_lancer', { machine: t.poste }, 'restauration demandée dans Phénix', { interne: true }).catch((e: Error) => ({ ok: false, text: e.message }));
      return { text: r.ok !== false && !taches(ctx).some((x) => x.tache === t.tache) ? `↩ ${r.text}` : `↩ Restauration prête pour ${t.poste} ${t.vers ? `(dossier « ${t.vers} »)` : '(à leur place)'} : l'agent la fera à son prochain passage (toutes les heures).${r.ok === false ? ` (${r.text.slice(0, 160)})` : ''}` };
    } },
];

/** « Sauvegarder maintenant » sur le plan d'un PC : Satellites lance l'agent du poste. */
export async function lancerAgent(ctx: ModCtx, p: Plan): Promise<string> {
  const r = await ctx.call('hermod', 'phenix_lancer', { machine: p.agent }, `sauvegarde du plan « ${p.name} » demandée`, { interne: true });
  if (r.ok === false) throw new Error(r.text);
  return r.text;
}
