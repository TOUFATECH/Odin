// Héraclès — le nettoyage du système (comme Kudu, BleachBit, Stacer) : Odin mesure ce qui encombre la machine
// (fichiers temporaires anciens, caches de paquets et de développement, corbeille, vieux journaux, journal du
// système trop gros) et le libère avec ton accord. Il ne touche qu'à ces catégories connues, jamais à tes
// documents ; les gros fichiers de ton dossier sont seulement montrés. Tout effacement passe par Heimdall.
import { lstatSync, readdirSync, rmSync, statfsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import type { Kpi, ModCtx, Module, RythmeAppli, Section, TacheAppli } from '../types.ts';
import { tacheEnPause } from '../automatismes.ts';
import { fuseauOdin, murale } from '../../draupnir/rythme.ts';
import { basculer, carte, CATEGORIES_DISTANTES, cibleDe, demarrage, desinstaller, nettoyageDistant, programmes, type Carte, type Cible, type Lancement, type Programme } from '../gefjon/poste.ts';
import { choixDePoste, PARAM_POSTE } from '../postes.ts';
import { findMachine } from '../../machines/access.ts';

export interface Categorie { id: string; label: string; quoi: string; racines: string[]; ageJours: number; motif?: RegExp; profondeur?: number; /** jamais touchés (modèles d'IA, navigateurs de test, données d'Odin…) */ sauf?: RegExp }
export interface Trouve { categorie: string; chemin: string; octets: number }
const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));

/** Jamais touchés dans les dossiers temporaires : ce qu'un programme en marche utilise (dossiers cachés et prises
 *  du système, dossiers privés des services, sessions de terminal, agents de clés, données d'Odin). */
export const TMP_SAUF = /^(\.|systemd-private-|snap-private-tmp$|snap\.|tmux-|ssh-|pulse-|dbus-|runtime-|gpg-|kde-|ksocket-|orbit-|hsperfdata_|odin|claude)/i;
/** Les catégories nettoyables (dossiers connus du système et des outils ; jamais tes documents). */
export function categories(home = homedir(), tmp = tmpdir(), plat = process.platform): Categorie[] {
  const L = (p: string) => p.split('/').join(sep);
  const c: Categorie[] = [
    { id: 'temporaires', label: 'Fichiers temporaires anciens', quoi: 'plus de 7 jours sans changement, dans le dossier temporaire (jamais ce qu\'un programme en marche utilise)', racines: [tmp, ...(plat === 'linux' ? ['/var/tmp'] : [])], ageJours: 7, sauf: TMP_SAUF },
    { id: 'corbeille', label: 'Corbeille', quoi: 'ce que tu as déjà jeté', racines: plat === 'darwin' ? [join(home, '.Trash')] : [join(home, L('.local/share/Trash/files')), join(home, L('.local/share/Trash/info'))], ageJours: 0 },
    { id: 'caches', label: 'Caches des applications', quoi: 'vignettes, navigateurs, outils ; ils se recréent tout seuls (sauf modèles d\'IA et données d\'Odin, gardés)', sauf: /^(ms-playwright|huggingface|whisper|torch|odin|ollama|lm-studio|piper|fontconfig|pip|yarn|go-build|node-gyp)$/i, racines: plat === 'win32' ? [join(home, L('AppData/Local/Temp'))] : plat === 'darwin' ? [join(home, 'Library/Caches')] : [join(home, '.cache')], ageJours: 3 },
    { id: 'developpement', label: 'Caches de développement', quoi: 'npm, pip, yarn, Go : retéléchargés si besoin', racines: [join(home, L('.npm/_cacache')), join(home, L('.cache/pip')), join(home, L('.cache/yarn')), join(home, L('.cache/go-build')), join(home, L('.cache/node-gyp'))], ageJours: 0 },
  ];
  if (plat === 'linux') c.push(
    { id: 'paquets', label: 'Paquets téléchargés (apt)', quoi: 'installateurs déjà installés', racines: ['/var/cache/apt/archives'], ageJours: 0, motif: /\.deb$/ },
    { id: 'vieux_journaux', label: 'Vieux journaux tournés', quoi: 'anciens fichiers .gz, .1, .old de /var/log', racines: ['/var/log'], ageJours: 7, motif: /\.(gz|xz|bz2|old|\d+)$/, profondeur: 3 },
  );
  return c;
}
/** Le parcours d'une catégorie, élément de premier niveau par élément (rend la main entre deux : `undefined`). */
function* parcours(c: Categorie, now: number, budget: { n: number }): Generator<Trouve | undefined> {
  const scan = (p: string, n = 0): { octets: number; recent: number } => {
    if (n > 30 || budget.n <= 0) return { octets: 0, recent: now };   // parcours coupé : on considère l'élément comme récent (donc gardé)
    budget.n--;
    try {
      const st = lstatSync(p); if (st.isSymbolicLink()) return { octets: 0, recent: 0 };
      if (!st.isDirectory()) return st.isFile() ? { octets: st.size, recent: st.mtimeMs } : { octets: 0, recent: now };   // une prise dans le dossier : il sert encore
      let octets = 0, recent = st.mtimeMs; for (const e of readdirSync(p)) { const x = scan(join(p, e), n + 1); octets += x.octets; recent = Math.max(recent, x.recent); }
      return { octets, recent };
    } catch { return { octets: 0, recent: now }; }
  };
  function* walk(dir: string, depth: number): Generator<Trouve | undefined> {
    let names: string[] = []; try { names = readdirSync(dir); } catch { return; }
    for (const e of names) {
      if (budget.n <= 0) return;
      const p = join(dir, e); let st; try { st = lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink() || c.sauf?.test(e) || (!st.isFile() && !st.isDirectory())) continue;
      if (c.motif) { if (st.isDirectory()) { if (depth < (c.profondeur ?? 1)) yield* walk(p, depth + 1); continue; } if (!c.motif.test(e)) continue; }
      const x = scan(p);
      yield x.octets > 0 && !(c.ageJours && now - x.recent < c.ageJours * 864e5) ? { categorie: c.id, chemin: p, octets: x.octets } : undefined;
    }
  }
  for (const r of c.racines) yield* walk(r, 1);
}
/** Ce qu'il y a à libérer dans une catégorie : chaque élément de premier niveau assez ancien, avec sa taille.
 *  Un dossier compte comme ancien seulement si RIEN dedans n'a changé depuis le délai. Les prises (sockets), tubes
 *  et périphériques ne sont jamais comptés. Le parcours s'arrête après `budget.n` entrées (machine très chargée). */
export function mesurer(c: Categorie, now = Date.now(), budget: { n: number } = { n: 80_000 }): Trouve[] {
  const out: Trouve[] = []; for (const x of parcours(c, now, budget)) if (x) out.push(x); return out;
}
/** La même mesure, sans figer Odin : elle rend la main entre deux éléments (les autres pages continuent de répondre). */
export async function mesurerDoux(c: Categorie, now = Date.now(), budget: { n: number } = { n: 80_000 }): Promise<Trouve[]> {
  const out: Trouve[] = []; let t = Date.now();
  for (const x of parcours(c, now, budget)) { if (x) out.push(x); if (Date.now() - t > 25) { await new Promise<void>((r) => setImmediate(r)); t = Date.now(); } }
  return out;
}
/** Un chemin est-il bien dans une des racines de sa catégorie (et pas la racine elle-même) ? Pur. */
export function dedans(chemin: string, c: Categorie): boolean {
  return c.racines.some((r) => chemin.startsWith(r.endsWith(sep) ? r : r + sep) && !chemin.slice(r.length).split(sep).includes('..'));
}
/** Les gros fichiers du dossier personnel (montrés seulement). Dossiers cachés et « node_modules » sautés ; le
 *  parcours s'arrête après `budget` entrées pour rester rapide sur un très gros dossier. */
export function grosFichiers(home: string, min = 1024 ** 3, max = 15, budget = 120_000): Array<{ chemin: string; octets: number }> {
  const out: Array<{ chemin: string; octets: number }> = [];
  const walk = (d: string, n: number) => {
    if (n > 6 || budget <= 0) return; let names: string[] = []; try { names = readdirSync(d); } catch { return; }
    for (const e of names) { if (budget-- <= 0) return; if (e.startsWith('.') || e === 'node_modules') continue; const p = join(d, e); let st; try { st = lstatSync(p); } catch { continue; } if (st.isSymbolicLink()) continue; if (st.isDirectory()) walk(p, n + 1); else if (st.isFile() && st.size >= min) out.push({ chemin: p, octets: st.size }); }
  };
  walk(home, 0); return out.sort((a, b) => b.octets - a.octets).slice(0, max);
}
export const taille = (o: number) => (o >= 1024 ** 3 ? `${(o / 1024 ** 3).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go` : o >= 1024 ** 2 ? `${Math.round(o / 1024 ** 2)} Mo` : `${Math.max(1, Math.round(o / 1024))} Ko`);
const home = (ctx: ModCtx) => s(ctx.settings.dossier) || homedir();
const cats = (ctx: ModCtx) => categories(home(ctx));
interface Bilan { quand: number; partiel: boolean; lignes: Array<{ c: Categorie; items: Trouve[]; total: number }> }
// La mesure parcourt des dossiers entiers. La page montre la dernière mesure (gardée 6 h) ; la première fois elle en
// fait une rapide (15 000 entrées par catégorie). « Mesurer » et le nettoyage refont toujours une mesure complète.
const memo = new Map<string, Bilan>(), memoGros = new Map<string, { at: number; g: Array<{ chemin: string; octets: number }> }>();
async function bilan(ctx: ModCtx, mode: 'page' | 'frais'): Promise<Bilan> {
  const now = ctx.now().getTime(), k = home(ctx), old = memo.get(k);
  if (mode === 'page' && old && now - old.quand >= 0 && now - old.quand < 6 * 3600_000) return old;
  const lignes: Bilan['lignes'] = []; let partiel = false;
  for (const c of cats(ctx)) { const budget = { n: mode === 'page' ? 15_000 : 80_000 }, items = await mesurerDoux(c, now, budget); partiel ||= budget.n <= 0; lignes.push({ c, items, total: items.reduce((a, x) => a + x.octets, 0) }); }
  const b = { quand: now, partiel, lignes }; memo.set(k, b); return b;
}
function gros(ctx: ModCtx, frais = false) {
  const now = ctx.now().getTime(), k = home(ctx), old = memoGros.get(k);
  if (!frais && old && now - old.at >= 0 && now - old.at < 6 * 3600_000) return old.g;
  const g = grosFichiers(k, 1024 ** 3, 15, frais ? 120_000 : 30_000); memoGros.set(k, { at: now, g }); return g;
}
const total = (b: Bilan) => b.lignes.reduce((a, x) => a + x.total, 0);
/** Vide une catégorie (ou « tout ») sur la machine d'Odin ; rien d'autre n'est touché. */
async function nettoyerIci(ctx: ModCtx, k: string): Promise<{ libre: number; n: number; refuse: number }> {
  const list = cats(ctx).filter((c) => k === 'tout' || c.id === k); if (!list.length && k !== 'journal') throw new Error('catégorie inconnue');
  let libre = 0, refuse = 0, n = 0; const now = ctx.now().getTime();
  for (const c of list) for (const t of await mesurerDoux(c, now)) {
    if (!dedans(t.chemin, c)) { refuse++; continue; }
    try { rmSync(t.chemin, { recursive: true, force: true }); libre += t.octets; n++; } catch { refuse++; }
  }
  if ((k === 'tout' || k === 'paquets') && process.platform === 'linux' && await ctx.has('apt-get')) await ctx.run('apt-get', ['clean'], { sudo: true, timeoutMs: 60_000 });
  if (k === 'journal' && process.platform === 'linux' && await ctx.has('journalctl')) await ctx.run('journalctl', ['--vacuum-time=2weeks'], { sudo: true, timeoutMs: 60_000 });
  memo.clear();
  return { libre, n, refuse };
}
/** Ce qu'Héraclès a vu sur chaque poste (carte, démarrage, programmes, mesure), pour la page. */
interface Vu { carte?: Carte; demarrage?: { quand: number; l: Lancement[] }; programmes?: { quand: number; l: Programme[]; note?: string }; mesure?: { quand: number; l: Array<{ categorie: string; octets: number; note?: string }> } }
const vus = new Map<string, Vu>();
const vu = (ctx: ModCtx, c: Cible) => { const k = `${ctx.dir}|${c.genre === 'ici' ? '' : c.genre === 'smb' ? c.m.id : c.poste.id}`; let x = vus.get(k); if (!x) { x = {}; vus.set(k, x); } return x; };
const surPoste = (c: Cible) => (c.genre === 'ici' ? '' : ` sur ${c.nom}`);
const posteParam = { ...PARAM_POSTE, help: 'Le nom ou l\'adresse d\'un poste du coffre (Linux ou Mac par SSH, Windows par son partage de fichiers).' };
export interface PlanNettoyage { id: string; poste: string; nomPoste: string; categories: string[]; quand: 'jour' | 'semaine' | 'mois'; heure: number; dernier?: string; resultat?: string }
const plansN = (ctx: ModCtx): PlanNettoyage[] => (ctx.settings.plansNettoyage as PlanNettoyage[] | undefined) ?? [];
/** Le nettoyage planifié est-il dû maintenant ? (une fois dans l'heure choisie, chaque jour, le dimanche ou le 1er du mois) Pur. */
export function nettoyageDu(p: PlanNettoyage, now: Date): boolean {
  // L'heure murale du lieu d'Odin (celle que Talos écrit), pas celle de la machine.
  const w = murale(now.getTime(), fuseauOdin());
  if (w.h !== p.heure) return false;
  const age = p.dernier ? now.getTime() - Date.parse(p.dernier) : Infinity;
  if (p.quand === 'jour') return age > 20 * 3600_000;
  if (p.quand === 'semaine') return w.wd === 0 && age > 6 * 864e5;
  return w.d === 1 && age > 25 * 864e5;
}
/** L'identifiant Talos de la tâche d'un nettoyage planifié (sans « : »). */
export const tacheDuNettoyage = (p: Pick<PlanNettoyage, 'id'>) => `nettoyage-${p.id.replace(/[^\w-]/g, '_').slice(0, 80)}`;
/** Passe un nettoyage planifié (à son heure, ou lancé depuis Talos) et note son résultat. */
async function passerNettoyage(ctx: ModCtx, p: PlanNettoyage, now: Date): Promise<{ ok: boolean; texte: string }> {
  let resultat: string, ok = true;
  try { const c = cibleDe(ctx, p.poste), r = await nettoyerPartout(ctx, c, p.categories); resultat = r.texte; ctx.emit('nettoyage_planifie', { poste: p.nomPoste, octets: r.octets }); }
  catch (e) { ok = false; resultat = `échec : ${(e as Error).message}`; ctx.alert({ level: 'moyenne', title: `Héraclès : le nettoyage planifié de ${p.nomPoste} a échoué`, detail: (e as Error).message, key: `heracles:plan:${p.id}` }); }
  ctx.saveSettings({ plansNettoyage: plansN(ctx).map((x) => (x.id === p.id ? { ...x, dernier: now.toISOString(), resultat: resultat.slice(0, 200) } : x)) });
  return { ok, texte: resultat };
}
const RYTHME_NETTOYAGE = (p: PlanNettoyage): RythmeAppli => {
  const heure = `${String(p.heure).padStart(2, '0')}:00`;
  return p.quand === 'jour' ? { genre: 'jour', heure } : p.quand === 'semaine' ? { genre: 'semaine', jours: [0], heure } : { genre: 'mois', jour: 1, heure };
};
function tachesGefjon(ctx: ModCtx): TacheAppli[] {
  return plansN(ctx).map((p) => ({
    id: tacheDuNettoyage(p), nom: `Nettoyage de ${p.nomPoste}`, quoi: `Libère : ${p.categories.join(', ')}.`,
    rythme: () => RYTHME_NETTOYAGE(p), permis: ['jour', 'semaine', 'mois'],
    regler: (c: ModCtx, r: RythmeAppli) => {
      const h = 'heure' in r ? /^(\d\d):00$/.exec(r.heure)?.[1] : undefined;
      const quand = r.genre === 'jour' ? 'jour' : r.genre === 'semaine' && r.jours.length === 1 && r.jours[0] === 0 ? 'semaine' : r.genre === 'mois' && r.jour === 1 ? 'mois' : undefined;
      if (!h || !quand) throw new Error('Un nettoyage planifié se règle à une heure pile : chaque jour, le dimanche, ou le 1er du mois.');
      c.saveSettings({ plansNettoyage: plansN(c).map((x) => (x.id === p.id ? { ...x, quand, heure: Number(h) } : x)) });
    },
    lancer: { action: 'lancer_nettoyage', input: { id: p.id } },
    dernier: () => (p.dernier ? { at: p.dernier, ok: !/^échec/.test(p.resultat ?? ''), ...(p.resultat ? { texte: p.resultat } : {}) } : undefined),
  }));
}
/** Nettoie des catégories sur un poste (ici ou ailleurs) ; rend une phrase. */
async function nettoyerPartout(ctx: ModCtx, c: Cible, liste: string[]): Promise<{ texte: string; octets: number }> {
  if (c.genre === 'ici') { let o = 0, n = 0, r = 0; for (const k of liste) { const x = await nettoyerIci(ctx, k); o += x.libre; n += x.n; r += x.refuse; } return { texte: `🧹 ${taille(o)} libérés (${n} élément(s))${r ? ` · ${r} élément(s) laissé(s) (droits ou en cours d'utilisation)` : ''}.`, octets: o }; }
  const l = await nettoyageDistant(c, liste, true), o = l.reduce((a, x) => a + x.octets, 0); vu(ctx, c).mesure = undefined;
  return { texte: `🧹 ${c.nom} : ${taille(o)} libérés${l.some((x) => x.note) ? ` · ${l.filter((x) => x.note).map((x) => `${x.categorie} : ${x.note}`).join(' · ')}` : ''}.`, octets: o };
}
function place(ctx: ModCtx): { libre: number; total: number } | undefined { try { const st = statfsSync(home(ctx)); const total = Number(st.blocks) * Number(st.bsize); return total > 0 ? { libre: Number(st.bavail) * Number(st.bsize), total } : undefined; } catch { return undefined; } }

export const gefjon: Module = {
  id: 'gefjon', name: 'Héraclès', family: 'Machines',
  what: 'Le ménage de la machine (comme Kudu, BleachBit, Stacer) : ce qui encombre (temporaires, caches, corbeille, vieux journaux), la carte de l\'espace disque, les programmes au démarrage et les programmes installés, ici ou sur un autre poste ; tout ce qui efface demande ton accord.',
  does: ['mesure de chaque catégorie : fichiers temporaires anciens, corbeille, caches des applications, caches de développement (npm, pip…), paquets apt déjà installés, vieux journaux tournés', 'journal du système trop gros : réduit à 2 semaines (journald)', 'nettoyage d\'une catégorie ou de tout, avec ton accord (Heimdall)', 'les gros fichiers de ton dossier, montrés pour que tu décides', 'carte de l\'espace disque : les dossiers qui prennent le plus de place', 'programmes lancés au démarrage (services, session, dossiers « Démarrage » de Windows) : ne plus les lancer, ou les relancer, avec ton accord', 'programmes installés, désinstallés avec ton accord (jamais un paquet essentiel du système)', 'nettoyage planifié (chaque jour, semaine ou mois), accord donné une fois', 'sur un autre poste : Linux ou Mac par SSH, Windows par son partage de fichiers (espace, démarrage, temporaires)', 'rappel quand il y a plus de 2 Go à libérer'],
  from: ['Kudu', 'BleachBit', 'Stacer'], upstream: ['bleachbit/bleachbit', 'oguzhaninan/Stacer'],
  words: ['programmes au démarrage', 'désinstaller', 'desinstaller', 'carte de l\'espace', 'espace disque', 'nettoyage', 'nettoyage du disque', 'libérer de la place', 'libere de la place', 'faire de la place', 'fichiers temporaires', 'vider la corbeille', 'vider le cache', 'héraclès', 'heracles', 'gefjon', 'bleachbit'],
  actions: [
    { id: 'analyser', label: 'Mesurer', what: 'Ce qui peut être libéré, catégorie par catégorie (ici ou sur un autre poste)', read: true, params: [posteParam], words: ['mesure le nettoyage', 'combien de place à libérer', 'que peut-on nettoyer'], run: async (ctx, i) => {
      const c = cibleDe(ctx, i.poste);
      if (c.genre !== 'ici') {
        const l = await nettoyageDistant(c, [...CATEGORIES_DISTANTES], false); vu(ctx, c).mesure = { quand: ctx.now().getTime(), l };
        return { text: `${c.nom} : ${taille(l.reduce((a, x) => a + x.octets, 0))} à libérer :\n${l.map((x) => `- ${x.categorie} : ${x.note ?? (x.octets ? taille(x.octets) : 'rien')}`).join('\n')}`, data: l };
      }
      const b = await bilan(ctx, 'frais'), t = total(b);
      return { text: `${b.partiel ? 'Au moins ' : ''}${taille(t)} à libérer :\n${b.lignes.map((x) => `- ${x.c.label} : ${x.total ? taille(x.total) : 'rien'} (${x.c.quoi})`).join('\n')}`, data: b.lignes.map((x) => ({ id: x.c.id, label: x.c.label, octets: x.total, elements: x.items.length })) };
    } },
    { id: 'nettoyer', label: 'Nettoyer', what: 'Libère une catégorie (ou « tout ») ; rien d\'autre n\'est touché', params: [{ key: 'categorie', label: 'Catégorie', kind: 'select', options: ['tout', 'temporaires', 'corbeille', 'caches', 'developpement', 'paquets', 'vieux_journaux', 'journal'], required: true }, posteParam],
      grave: (i) => `effacer définitivement « ${s(i.categorie)} »${s(i.poste).trim() ? ` sur ${s(i.poste).trim()}` : ''} (fichiers temporaires, caches ou corbeille : tes documents ne sont pas touchés)`,
      words: ['fais le nettoyage', 'nettoie le pc', 'vide la corbeille', 'vide le cache'], run: async (ctx, i) => {
        const c = cibleDe(ctx, i.poste), k = s(i.categorie);
        if (c.genre === 'ici') { const x = await nettoyerIci(ctx, k); return { text: `🧹 ${taille(x.libre)} libérés (${x.n} élément(s))${x.refuse ? ` · ${x.refuse} élément(s) laissé(s) (droits ou en cours d'utilisation)` : ''}.`, data: { octets: x.libre, elements: x.n } }; }
        const liste = k === 'tout' ? [...CATEGORIES_DISTANTES] : k === 'vieux_journaux' ? ['journal'] : [k];
        if (!liste.every((x) => (CATEGORIES_DISTANTES as readonly string[]).includes(x))) throw new Error(`sur un autre poste : ${CATEGORIES_DISTANTES.join(', ')} ou tout`);
        const r = await nettoyerPartout(ctx, c, liste); return { text: r.texte, data: { octets: r.octets } };
      } },
    { id: 'journal_systeme', label: 'Réduire le journal du système', what: 'Garde 2 semaines du journal (journald)', words: ['réduis le journal du système'], params: [posteParam], grave: (i) => `effacer le journal du système de plus de 2 semaines${s(i.poste).trim() ? ` sur ${s(i.poste).trim()}` : ''}`, run: async (ctx, i) => {
      const c = cibleDe(ctx, i.poste);
      if (c.genre !== 'ici') { if (c.genre === 'smb') return { text: 'Pas de journal journald sur un Windows.', ok: false }; const r = await nettoyerPartout(ctx, c, ['journal']); return { text: r.texte }; }
      if (process.platform !== 'linux' || !await ctx.has('journalctl')) return { text: 'Pas de journal journald sur cette machine.', ok: false };
      const r = await ctx.run('journalctl', ['--vacuum-time=2weeks'], { sudo: true, timeoutMs: 60_000 }); if (r.code) throw new Error(r.err.trim() || 'refusé');
      return { text: `🧹 ${(/freed ([\d.]+\w)/i.exec(r.err + r.out)?.[1] ?? 'de la place')} libéré dans le journal du système.` };
    } },
    { id: 'gros_fichiers', label: 'Fichiers les plus lourds', what: 'Les fichiers de plus de 1 Go de ton dossier (montrés seulement)', words: ['fichiers les plus lourds', 'qu\'est-ce qui prend de la place'], read: true, external: true, params: [posteParam], run: async (ctx, i) => {
      const c = cibleDe(ctx, i.poste);
      if (c.genre === 'smb') return { text: 'Sur un Windows : regarde la « Carte de l\'espace » (les dossiers qui prennent le plus de place).', ok: false };
      if (c.genre === 'ssh') {
        const r = await c.poste.run('sh', ['-c', 'find "$HOME" -xdev -type f -size +1048576k -exec du -k {} + 2>/dev/null | sort -rn | head -15', 'odin'], { timeoutMs: 300_000 });
        const g = r.out.split('\n').map((l) => /^(\d+)\t(.+)$/.exec(l.trim())).filter((m): m is RegExpExecArray => Boolean(m)).map((m) => ({ chemin: m[2], octets: Number(m[1]) * 1024 }));
        return { text: g.length ? `${c.nom} :\n${g.map((x) => `- ${taille(x.octets)} · ${x.chemin}`).join('\n')}` : `Aucun fichier de plus de 1 Go sur ${c.nom}.`, data: g };
      }
      const g = gros(ctx, true); return { text: g.length ? g.map((x) => `- ${taille(x.octets)} · ${x.chemin}`).join('\n') : 'Aucun fichier de plus de 1 Go.', data: g };
    } },
    { id: 'carte', label: 'Carte de l\'espace', what: 'Les dossiers qui prennent le plus de place (dossier personnel, ou celui demandé ; sur un Windows : le disque C:)', read: true, external: true, words: ['carte de l\'espace disque', 'qu\'est-ce qui remplit le disque', 'espace disque'], params: [{ key: 'dossier', label: 'Dossier (vide : dossier personnel ; Windows : C:)', kind: 'text', default: '' }, posteParam], run: async (ctx, i) => {
      const c = cibleDe(ctx, i.poste), k = await carte(c, s(i.dossier).trim()); vu(ctx, c).carte = k;
      return { text: `${c.nom} · ${k.racine} : ${k.partiel ? 'au moins ' : ''}${taille(k.total)}\n${k.items.slice(0, 15).map((x) => `- ${taille(x.octets)} · ${x.chemin}`).join('\n')}`, data: k };
    } },
    { id: 'demarrage', label: 'Programmes au démarrage', what: 'Ce qui se lance tout seul : services, ouverture de session, dossiers « Démarrage » de Windows', read: true, external: true, words: ['programmes au démarrage', 'qu\'est-ce qui se lance au démarrage', 'démarrage lent'], params: [posteParam], run: async (ctx, i) => {
      const c = cibleDe(ctx, i.poste), l = await demarrage(c); vu(ctx, c).demarrage = { quand: ctx.now().getTime(), l };
      return { text: l.length ? `${c.nom} :\n${l.map((x) => `- ${x.actif ? '●' : '○'} ${x.nom} (${x.genre}${x.detail ? ` · ${x.detail}` : ''})`).join('\n')}${c.genre === 'smb' ? '\n(par le partage de fichiers : les dossiers « Démarrage » ; le registre se regarde sur le PC)' : ''}` : `Rien au démarrage sur ${c.nom}.`, data: l };
    } },
    { id: 'desactiver_demarrage', label: 'Ne plus lancer au démarrage', what: 'Empêche un programme de se lancer tout seul (il reste installé ; « Relancer au démarrage » le remet)', quick: false, params: [{ key: 'id', label: 'Programme (identifiant de la liste)', kind: 'text', required: true }, posteParam],
      grave: (i) => `ne plus lancer « ${s(i.id).replace(/^\w+:/, '')} » au démarrage${s(i.poste).trim() ? ` de ${s(i.poste).trim()}` : ''}`,
      undo: (i) => ({ action: 'reactiver_demarrage', input: { id: i.id, poste: i.poste ?? '' }, label: 'Relancer au démarrage' }),
      run: async (ctx, i) => { const c = cibleDe(ctx, i.poste), x = await basculer(c, s(i.id), false); vu(ctx, c).demarrage = undefined; return { text: `⏸ ${x.nom} ne se lance plus au démarrage${surPoste(c)}.` }; } },
    { id: 'reactiver_demarrage', label: 'Relancer au démarrage', what: 'Remet un programme désactivé par Héraclès dans le démarrage', quick: false, params: [{ key: 'id', label: 'Programme (identifiant de la liste)', kind: 'text', required: true }, posteParam],
      grave: (i) => `relancer « ${s(i.id).replace(/^\w+:/, '')} » au démarrage${s(i.poste).trim() ? ` de ${s(i.poste).trim()}` : ''}`,
      run: async (ctx, i) => { const c = cibleDe(ctx, i.poste), x = await basculer(c, s(i.id), true); vu(ctx, c).demarrage = undefined; return { text: `▶ ${x.nom} se lance de nouveau au démarrage${surPoste(c)}.` }; } },
    { id: 'programmes', label: 'Programmes installés', what: 'Les programmes et paquets installés, les plus gros d\'abord', read: true, external: true, words: ['programmes installés', 'logiciels installés', 'désinstaller un programme'], params: [{ key: 'chercher', label: 'Chercher (vide : les plus gros)', kind: 'text', default: '' }, posteParam], run: async (ctx, i) => {
      const c = cibleDe(ctx, i.poste), r = await programmes(c), q = s(i.chercher).trim().toLowerCase(); vu(ctx, c).programmes = { quand: ctx.now().getTime(), l: r.liste, note: r.note };
      const l = r.liste.filter((p) => !q || p.nom.toLowerCase().includes(q)).sort((a, b) => (b.octets ?? 0) - (a.octets ?? 0)).slice(0, 40);
      return { text: `${c.nom} : ${r.liste.length} programme(s)${q ? `, ${l.length} pour « ${q} »` : ''}\n${l.map((p) => `- ${p.nom}${p.version ? ` ${p.version}` : ''} · ${p.octets ? taille(p.octets) : '?'} · ${p.source}${p.desinstallable ? '' : ` (${p.pourquoi ?? 'gardé'})`}`).join('\n')}${r.note ? `\n${r.note}` : ''}`, data: r };
    } },
    { id: 'desinstaller', label: 'Désinstaller', what: 'Enlève un programme (jamais un paquet essentiel du système)', quick: false, params: [{ key: 'id', label: 'Programme (identifiant de la liste)', kind: 'text', required: true }, posteParam],
      grave: (i) => `désinstaller « ${s(i.id).replace(/^\w+:/, '')} »${s(i.poste).trim() ? ` de ${s(i.poste).trim()}` : ''} (ses fichiers de programme sont effacés)`,
      run: async (ctx, i) => { const c = cibleDe(ctx, i.poste), p = await desinstaller(c, s(i.id)); vu(ctx, c).programmes = undefined; ctx.emit('programme_desinstalle', { nom: p.nom, poste: c.nom }); return { text: `🗑 ${p.nom} désinstallé${surPoste(c)}.` }; } },
    { id: 'planifier_nettoyage', label: 'Nettoyage planifié', what: 'Héraclès nettoie tout seul, chaque jour, chaque semaine ou chaque mois, les catégories choisies (ton accord est donné une fois, ici)', quick: false,
      params: [{ key: 'categories', label: 'Catégories (temporaires, corbeille, caches, developpement, paquets, vieux_journaux, journal)', kind: 'text', default: 'temporaires, corbeille, caches' }, { key: 'quand', label: 'Quand', kind: 'select', options: ['semaine', 'jour', 'mois'], default: 'semaine' }, { key: 'heure', label: 'Heure', kind: 'number', default: 4 }, posteParam],
      grave: (i) => `effacer définitivement, ${({ jour: 'chaque jour', semaine: 'chaque dimanche', mois: 'le 1er de chaque mois' } as Record<string, string>)[s(i.quand)] ?? 'régulièrement'}, ${s(i.categories) || 'les temporaires'}${s(i.poste).trim() ? ` sur ${s(i.poste).trim()}` : ''} sans te redemander`,
      run: (ctx, i) => {
        const c = cibleDe(ctx, i.poste), l = s(i.categories).split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean), ok = c.genre === 'ici' ? ['temporaires', 'corbeille', 'caches', 'developpement', 'paquets', 'vieux_journaux', 'journal'] : [...CATEGORIES_DISTANTES];
        const mauvais = l.filter((x) => !ok.includes(x)); if (!l.length || mauvais.length) throw new Error(`catégories possibles${surPoste(c)} : ${ok.join(', ')}`);
        const quand = (['jour', 'semaine', 'mois'].includes(s(i.quand)) ? s(i.quand) : 'semaine') as PlanNettoyage['quand'], heure = Math.min(23, Math.max(0, Math.floor(Number(i.heure ?? 4)) || 0));
        const id = c.genre === 'ici' ? '' : c.genre === 'smb' ? c.m.id : c.poste.id;
        const p: PlanNettoyage = { id: `${id || 'ici'}`, poste: id, nomPoste: c.nom, categories: [...new Set(l)], quand, heure };
        ctx.saveSettings({ plansNettoyage: [...plansN(ctx).filter((x) => x.id !== p.id), p] });
        return { text: `🗓 Nettoyage de ${c.nom} : ${p.categories.join(', ')}, ${({ jour: 'chaque jour', semaine: 'chaque dimanche', mois: 'le 1er du mois' })[quand]} à ${heure} h.` };
      } },
    { id: 'lancer_nettoyage', label: 'Lancer un nettoyage planifié', what: 'Passe maintenant un nettoyage déjà planifié (mêmes catégories, accord déjà donné au planning)', quick: false, params: [{ key: 'id', label: 'Nettoyage planifié (ici, ou le poste)', kind: 'text', required: true }], run: async (ctx, i) => {
      const p = plansN(ctx).find((x) => x.id === s(i.id) || x.nomPoste === s(i.id)); if (!p) throw new Error('Aucun nettoyage planifié sous ce nom.');
      const r = await passerNettoyage(ctx, p, ctx.now());
      return { text: `${p.nomPoste} : ${r.texte}`, ok: r.ok };
    } },
    { id: 'retirer_nettoyage', label: 'Arrêter un nettoyage planifié', what: 'Plus de nettoyage automatique sur ce poste', quick: false, params: [posteParam], run: (ctx, i) => {
      const c = cibleDe(ctx, i.poste), id = c.genre === 'ici' ? 'ici' : c.genre === 'smb' ? c.m.id : c.poste.id, avant = plansN(ctx);
      ctx.saveSettings({ plansNettoyage: avant.filter((x) => x.id !== id) });
      return { text: avant.some((x) => x.id === id) ? `Plus de nettoyage planifié sur ${c.nom}.` : `Aucun nettoyage planifié sur ${c.nom}.`, ok: avant.some((x) => x.id === id) };
    } },
  ],
  async view(ctx, q) {
    const P = choixDePoste(ctx, q, { partages: true }), c: Cible = P.actuel ? cibleDe(ctx, findMachine(ctx.home, P.actuel)?.id ?? '') : cibleDe(ctx, ''), V = vu(ctx, c), input = P.actuel ? { poste: P.actuel } : {};
    const N = 'Nettoyer', E = 'Espace', D = 'Démarrage', Pg = 'Programmes', heure = (t?: number) => (t ? new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
    const sections: Section[] = [], side: Section[] = [], kpis: Kpi[] = [];
    let subtitle: string;
    if (c.genre === 'ici') {
      const b = await bilan(ctx, 'page'), t = total(b), disque = place(ctx), min = Math.max(0, Math.round((ctx.now().getTime() - b.quand) / 60_000));
      subtitle = `${b.partiel ? 'Au moins ' : ''}${taille(t)} à libérer · mesuré ${min < 2 ? 'à l\'instant' : min < 90 ? `il y a ${min} min` : `il y a ${Math.round(min / 60)} h`}${b.partiel ? ' (mesure rapide : « Mesurer » pour le détail)' : ''}`;
      kpis.push({ label: 'À libérer', value: `${b.partiel ? '≥ ' : ''}${taille(t)}`, tone: t > 2 * 1024 ** 3 ? 'attention' : 'bon' }, ...(disque ? [{ label: 'Libre sur le disque', value: taille(disque.libre), pct: Math.round((1 - disque.libre / disque.total) * 100), tone: (disque.libre / disque.total < 0.1 ? 'mauvais' : 'bon') as 'mauvais' | 'bon' }] : []));
      sections.push({ onglet: N, kind: 'cards', title: 'Ce qui peut partir', items: b.lignes.map((x) => ({ title: x.c.label, sub: x.c.quoi, badge: x.total ? taille(x.total) : 'propre', tone: x.total > 1024 ** 3 ? 'attention' as const : 'bon' as const, meta: `${x.items.length} élément(s)`, actions: x.total ? [{ action: 'nettoyer', label: 'Nettoyer', input: { categorie: x.c.id } }] : [] })) },
        { onglet: N, kind: 'table', title: 'Gros fichiers de ton dossier (tu décides)', columns: ['Taille', 'Fichier'], empty: 'Aucun fichier de plus de 1 Go.', rows: gros(ctx).map((x) => ({ cells: [taille(x.octets), x.chemin] })) });
    } else {
      const m = V.mesure;
      subtitle = `${c.nom} · ${c.genre === 'smb' ? 'Windows, par son partage de fichiers' : 'par SSH'}${m ? ` · ${taille(m.l.reduce((a, x) => a + x.octets, 0))} à libérer (mesuré ${heure(m.quand)})` : ''}`;
      kpis.push({ label: 'À libérer', value: m ? taille(m.l.reduce((a, x) => a + x.octets, 0)) : '—' });
      sections.push(m ? { onglet: N, kind: 'cards', title: `Ce qui peut partir sur ${c.nom}`, items: m.l.map((x) => ({ title: x.categorie, sub: x.note ?? '', badge: x.note ? '—' : x.octets ? taille(x.octets) : 'propre', tone: x.octets > 1024 ** 3 ? 'attention' as const : 'bon' as const, actions: x.octets && !x.note ? [{ action: 'nettoyer', label: 'Nettoyer', input: { categorie: x.categorie, ...input } }] : [] })) }
        : { onglet: N, kind: 'actions', title: `Nettoyer ${c.nom}`, boutons: [{ action: 'analyser', label: 'Mesurer', input, primary: true }], aide: c.genre === 'smb' ? 'Sur un Windows, par son partage de fichiers : les fichiers temporaires de plus de 7 jours.' : 'Temporaires, corbeille, caches, paquets téléchargés, journal du système.' });
    }
    const plan = plansN(ctx).find((x) => x.id === (c.genre === 'ici' ? 'ici' : c.genre === 'smb' ? c.m.id : c.poste.id));
    side.push({ onglet: N, kind: 'form', title: plan ? `Nettoyage planifié : ${plan.categories.join(', ')}, ${({ jour: 'chaque jour', semaine: 'chaque dimanche', mois: 'le 1er du mois' })[plan.quand]} à ${plan.heure} h` : 'Nettoyage planifié', action: 'planifier_nettoyage', submit: plan ? 'Changer' : 'Planifier', fixe: input, params: (gefjon.actions.find((a) => a.id === 'planifier_nettoyage')?.params ?? []).filter((p) => p.key !== 'poste'), aide: plan?.dernier ? `Dernier passage : ${heure(Date.parse(plan.dernier))} · ${plan.resultat ?? ''}` : 'Ton accord est demandé une fois, maintenant ; ensuite Héraclès nettoie tout seul.' });
    if (plan) side.push({ onglet: N, kind: 'actions', title: 'Arrêter', boutons: [{ action: 'retirer_nettoyage', label: 'Arrêter le nettoyage planifié', input }] });
    side.push({ onglet: N, kind: 'text', title: 'Ce qu\'Héraclès ne touche jamais', text: 'Tes documents, photos, téléchargements et réglages. Seuls les dossiers temporaires et de cache connus, la corbeille et les vieux journaux sont vidés, et toujours avec ton accord.' });
    // Espace
    const k = V.carte;
    sections.push(k ? { onglet: E, kind: 'bars', title: `${k.racine} · ${k.partiel ? 'au moins ' : ''}${taille(k.total)} (${heure(k.quand)})`, items: k.items.slice(0, 15).map((x) => ({ label: x.chemin.split(/[\\/]/).filter(Boolean).pop() ?? x.chemin, value: x.octets, display: taille(x.octets) })) }
      : { onglet: E, kind: 'actions', title: 'Carte de l\'espace', boutons: [{ action: 'carte', label: 'Dessiner la carte', input, primary: true }], aide: c.genre === 'smb' ? 'Le disque C: par le partage de fichiers (peut prendre quelques minutes).' : 'Ton dossier personnel, dossier par dossier.' });
    if (k) sections.push({ onglet: E, kind: 'table', title: 'Les dossiers les plus lourds', columns: ['Taille', 'Dossier'], rows: k.items.map((x) => ({ cells: [taille(x.octets), x.chemin], ...(c.genre !== 'smb' ? { actions: [{ action: 'carte', label: 'Ouvrir', input: { ...input, dossier: x.chemin } }] } : {}) })) });
    side.push({ onglet: E, kind: 'form', title: 'Carte d\'un dossier', action: 'carte', submit: 'Dessiner', fixe: input, params: [{ key: 'dossier', label: c.genre === 'smb' ? 'Dossier de C: (ex. Users)' : 'Dossier (chemin absolu)', kind: 'text', default: '' }] });
    // Démarrage
    const d = V.demarrage;
    sections.push(d ? { onglet: D, kind: 'table', title: `Au démarrage de ${c.nom} (${heure(d.quand)})`, columns: ['', 'Programme', 'Genre', 'Détail'], empty: 'Rien ne se lance tout seul.', rows: d.l.map((x) => ({ cells: [x.actif ? '●' : '○', x.nom, x.genre, x.detail ?? ''], tone: x.actif ? undefined : 'neutre' as const, ...(x.desactivable ? { actions: [x.actif ? { action: 'desactiver_demarrage', label: 'Ne plus lancer', input: { id: x.id, ...input } } : { action: 'reactiver_demarrage', label: 'Relancer', input: { id: x.id, ...input } }] } : {}) })) }
      : { onglet: D, kind: 'actions', title: 'Programmes au démarrage', boutons: [{ action: 'demarrage', label: 'Regarder', input, primary: true }] });
    // Programmes
    const p = V.programmes;
    sections.push(p ? { onglet: Pg, kind: 'table', title: `${p.l.length} programme(s) sur ${c.nom} (les plus gros)`, columns: ['Programme', 'Version', 'Taille', 'Source'], empty: 'Aucun programme lu.', rows: [...p.l].sort((a, b) => (b.octets ?? 0) - (a.octets ?? 0)).slice(0, 60).map((x) => ({ cells: [x.nom, x.version ?? '', x.octets ? taille(x.octets) : '—', `${x.source}${x.desinstallable ? '' : ` · ${x.pourquoi ?? 'gardé'}`}`], ...(x.desinstallable ? { actions: [{ action: 'desinstaller', label: 'Désinstaller', input: { id: x.id, ...input } }] } : {}) })) }
      : { onglet: Pg, kind: 'actions', title: 'Programmes installés', boutons: [{ action: 'programmes', label: 'Lister', input, primary: true }] });
    if (p?.note) sections.push({ onglet: Pg, kind: 'text', title: 'Désinstaller', text: p.note });
    side.push({ onglet: Pg, kind: 'form', title: 'Chercher un programme', action: 'programmes', submit: 'Chercher', fixe: input, params: [{ key: 'chercher', label: 'Nom', kind: 'text', required: true }] });
    return { subtitle, kpis, onglets: [N, E, D, Pg], sections, side, postes: { ...P, titre: 'Héraclès sur un autre poste', texte: 'Un Linux ou un Mac par SSH ; un Windows par son partage de fichiers (espace, dossiers « Démarrage », temporaires).' } };
  },
  // Toutes les 5 minutes : les nettoyages planifiés ; toutes les 6 heures : une seule alerte utile, le disque presque plein
  // ET Héraclès qui peut y faire de la place (pas d'annonce sinon).
  taches: tachesGefjon,
  watch: { every: 300, async run(ctx) {
    const now = ctx.now();
    for (const p of plansN(ctx)) {
      if (!nettoyageDu(p, now) || tacheEnPause('gefjon', tacheDuNettoyage(p))) continue;
      await passerNettoyage(ctx, p, now);
    }
    if (now.getTime() - (dernierPlein.get(ctx.dir) ?? 0) < 6 * 3600_000) return; dernierPlein.set(ctx.dir, now.getTime());
    const d = place(ctx); if (!d || d.libre / d.total >= 0.1) return;
    const t = total(await bilan(ctx, 'frais'));
    if (t > 1024 ** 3) ctx.alert({ level: 'moyenne', title: `Disque presque plein : Héraclès peut libérer ${taille(t)}`, detail: `Il reste ${taille(d.libre)} de libre. Fichiers temporaires, caches et corbeille peuvent partir ; rien ne part sans ton accord.`, key: 'heracles:plein' });
  } },
};
const dernierPlein = new Map<string, number>();
