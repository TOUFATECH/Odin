// Héraclès — le nettoyage du système (comme Kudu, BleachBit, Stacer) : Odin mesure ce qui encombre la machine
// (fichiers temporaires anciens, caches de paquets et de développement, corbeille, vieux journaux, journal du
// système trop gros) et le libère avec ton accord. Il ne touche qu'à ces catégories connues, jamais à tes
// documents ; les gros fichiers de ton dossier sont seulement montrés. Tout effacement passe par Heimdall.
import { lstatSync, readdirSync, rmSync, statfsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import type { ModCtx, Module } from '../types.ts';

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
function place(ctx: ModCtx): { libre: number; total: number } | undefined { try { const st = statfsSync(home(ctx)); const total = Number(st.blocks) * Number(st.bsize); return total > 0 ? { libre: Number(st.bavail) * Number(st.bsize), total } : undefined; } catch { return undefined; } }

export const gefjon: Module = {
  id: 'gefjon', name: 'Héraclès', family: 'Machines',
  what: 'Le nettoyage du système (comme Kudu) : Odin mesure ce qui encombre la machine (temporaires, caches, corbeille, vieux journaux, paquets déjà installés) et le libère avec ton accord, sans jamais toucher à tes documents.',
  does: ['mesure de chaque catégorie : fichiers temporaires anciens, corbeille, caches des applications, caches de développement (npm, pip…), paquets apt déjà installés, vieux journaux tournés', 'journal du système trop gros : réduit à 2 semaines (journald)', 'nettoyage d\'une catégorie ou de tout, avec ton accord (Heimdall)', 'les gros fichiers de ton dossier, montrés pour que tu décides', 'rappel quand il y a plus de 2 Go à libérer'],
  from: ['Kudu', 'BleachBit', 'Stacer'], upstream: ['bleachbit/bleachbit', 'oguzhaninan/Stacer'],
  words: ['nettoyage', 'nettoyage du disque', 'libérer de la place', 'libere de la place', 'faire de la place', 'fichiers temporaires', 'vider la corbeille', 'vider le cache', 'héraclès', 'heracles', 'gefjon', 'bleachbit'],
  actions: [
    { id: 'analyser', label: 'Mesurer', what: 'Ce qui peut être libéré, catégorie par catégorie', read: true, words: ['mesure le nettoyage', 'combien de place à libérer', 'que peut-on nettoyer'], run: async (ctx) => {
      const b = await bilan(ctx, 'frais'), t = total(b);
      return { text: `${b.partiel ? 'Au moins ' : ''}${taille(t)} à libérer :\n${b.lignes.map((x) => `- ${x.c.label} : ${x.total ? taille(x.total) : 'rien'} (${x.c.quoi})`).join('\n')}`, data: b.lignes.map((x) => ({ id: x.c.id, label: x.c.label, octets: x.total, elements: x.items.length })) };
    } },
    { id: 'nettoyer', label: 'Nettoyer', what: 'Libère une catégorie (ou « tout ») ; rien d\'autre n\'est touché', params: [{ key: 'categorie', label: 'Catégorie', kind: 'select', options: ['tout', 'temporaires', 'corbeille', 'caches', 'developpement', 'paquets', 'vieux_journaux'], required: true }],
      grave: (i) => `effacer définitivement « ${s(i.categorie)} » (fichiers temporaires, caches ou corbeille : tes documents ne sont pas touchés)`,
      words: ['fais le nettoyage', 'nettoie le pc', 'vide la corbeille', 'vide le cache'], run: async (ctx, i) => {
        const k = s(i.categorie), list = cats(ctx).filter((c) => k === 'tout' || c.id === k); if (!list.length) throw new Error('catégorie inconnue');
        let libre = 0, refuse = 0, n = 0; const now = ctx.now().getTime();
        for (const c of list) for (const t of await mesurerDoux(c, now)) {
          if (!dedans(t.chemin, c)) { refuse++; continue; }
          try { rmSync(t.chemin, { recursive: true, force: true }); libre += t.octets; n++; } catch { refuse++; }
        }
        if ((k === 'tout' || k === 'paquets') && process.platform === 'linux' && await ctx.has('apt-get')) await ctx.run('apt-get', ['clean'], { sudo: true, timeoutMs: 60_000 });
        memo.clear();
        return { text: `🧹 ${taille(libre)} libérés (${n} élément(s))${refuse ? ` · ${refuse} élément(s) laissé(s) (droits ou en cours d'utilisation)` : ''}.`, data: { octets: libre, elements: n } };
      } },
    { id: 'journal_systeme', label: 'Réduire le journal du système', what: 'Garde 2 semaines du journal (journald)', words: ['réduis le journal du système'], grave: () => 'effacer le journal du système de plus de 2 semaines', run: async (ctx) => {
      if (process.platform !== 'linux' || !await ctx.has('journalctl')) return { text: 'Pas de journal journald sur cette machine.', ok: false };
      const r = await ctx.run('journalctl', ['--vacuum-time=2weeks'], { sudo: true, timeoutMs: 60_000 }); if (r.code) throw new Error(r.err.trim() || 'refusé');
      return { text: `🧹 ${(/freed ([\d.]+\w)/i.exec(r.err + r.out)?.[1] ?? 'de la place')} libéré dans le journal du système.` };
    } },
    { id: 'gros_fichiers', label: 'Fichiers les plus lourds', what: 'Les fichiers de plus de 1 Go de ton dossier (montrés seulement)', words: ['fichiers les plus lourds', 'qu\'est-ce qui prend de la place'], read: true, run: (ctx) => {
      const g = gros(ctx, true); return { text: g.length ? g.map((x) => `- ${taille(x.octets)} · ${x.chemin}`).join('\n') : 'Aucun fichier de plus de 1 Go.', data: g };
    } },
  ],
  async view(ctx) {
    const b = await bilan(ctx, 'page'), t = total(b), disque = place(ctx), min = Math.max(0, Math.round((ctx.now().getTime() - b.quand) / 60_000));
    return {
      subtitle: `${b.partiel ? 'Au moins ' : ''}${taille(t)} à libérer · mesuré ${min < 2 ? 'à l\'instant' : min < 90 ? `il y a ${min} min` : `il y a ${Math.round(min / 60)} h`}${b.partiel ? ' (mesure rapide : « Mesurer » pour le détail)' : ''}`,
      kpis: [{ label: 'À libérer', value: `${b.partiel ? '≥ ' : ''}${taille(t)}`, tone: t > 2 * 1024 ** 3 ? 'attention' : 'bon' }, ...(disque ? [{ label: 'Libre sur le disque', value: taille(disque.libre), pct: Math.round((1 - disque.libre / disque.total) * 100), tone: (disque.libre / disque.total < 0.1 ? 'mauvais' : 'bon') as 'mauvais' | 'bon' }] : [])],
      sections: [
        { kind: 'cards', title: 'Ce qui peut partir', items: b.lignes.map((x) => ({ title: x.c.label, sub: x.c.quoi, badge: x.total ? taille(x.total) : 'propre', tone: x.total > 1024 ** 3 ? 'attention' as const : 'bon' as const, meta: `${x.items.length} élément(s)`, actions: x.total ? [{ action: 'nettoyer', label: 'Nettoyer', input: { categorie: x.c.id } }] : [] })) },
        { kind: 'table', title: 'Gros fichiers de ton dossier (tu décides)', columns: ['Taille', 'Fichier'], empty: 'Aucun fichier de plus de 1 Go.', rows: gros(ctx).map((x) => ({ cells: [taille(x.octets), x.chemin] })) },
      ],
      side: [{ kind: 'text', title: 'Ce qu\'Héraclès ne touche jamais', text: 'Tes documents, photos, téléchargements et réglages. Seuls les dossiers temporaires et de cache connus, la corbeille et les vieux journaux sont vidés, et toujours avec ton accord.' }],
    };
  },
  // Une seule alerte utile : le disque est presque plein ET Héraclès peut y faire de la place (pas d'annonce sinon).
  watch: { every: 6 * 3600, async run(ctx) {
    const d = place(ctx); if (!d || d.libre / d.total >= 0.1) return;
    const t = total(await bilan(ctx, 'frais'));
    if (t > 1024 ** 3) ctx.alert({ level: 'moyenne', title: `Disque presque plein : Héraclès peut libérer ${taille(t)}`, detail: `Il reste ${taille(d.libre)} de libre. Fichiers temporaires, caches et corbeille peuvent partir ; rien ne part sans ton accord.`, key: 'heracles:plein' });
  } },
};
