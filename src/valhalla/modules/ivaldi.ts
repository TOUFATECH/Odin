// Dédale — le code et les dépôts (comme Gitea, côté « mes projets ») : Odin trouve tes dépôts git, dit où en
// est chacun (branche, travail non enregistré, commits à envoyer ou à récupérer, dernier commit), récupère les
// nouveautés, met à jour sans risque (seulement en avance rapide, dossier propre), clone un dépôt, et crée des
// dépôts « de la maison » où pousser ton code depuis tes autres machines (par SSH). Les jetons contenus dans les
// adresses des dépôts ne sont jamais affichés. Odin n'exécute jamais le code des dépôts.
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { devNull, homedir, hostname, userInfo } from 'node:os';
import { basename, join } from 'node:path';
import type { Kpi, ModCtx, Module, Tone } from '../types.ts';
import { actionsDedale, reglages, sectionsDedale } from '../ivaldi/projets.ts';
import { menage, toutFermer } from '../ivaldi/terminaux.ts';

export interface Statut { branche: string; amont?: string; avance: number; retard: number; modifies: number; nonSuivis: number; conflits: number }
export interface Commit { id: string; auteur: string; at: number; sujet: string }
export interface Depot { chemin: string; nom: string; nu: boolean; statut?: Statut; dernier?: Commit; distant?: string; erreur?: string }
const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));

/** « git status --porcelain=v2 --branch » → branche, avance / retard, fichiers modifiés. Pur. */
export function lireStatut(out: string): Statut {
  const st: Statut = { branche: '(détachée)', avance: 0, retard: 0, modifies: 0, nonSuivis: 0, conflits: 0 };
  for (const l of out.split('\n')) {
    if (l.startsWith('# branch.head ')) st.branche = l.slice(14).trim() === '(detached)' ? '(détachée)' : l.slice(14).trim();
    else if (l.startsWith('# branch.upstream ')) st.amont = l.slice(18).trim();
    else if (l.startsWith('# branch.ab ')) { const m = /\+(\d+) -(\d+)/.exec(l); if (m) { st.avance = Number(m[1]); st.retard = Number(m[2]); } }
    else if (l.startsWith('1 ') || l.startsWith('2 ')) st.modifies++;
    else if (l.startsWith('u ')) st.conflits++;
    else if (l.startsWith('? ')) st.nonSuivis++;
  }
  return st;
}
/** « git log --format=%H%x1f%an%x1f%at%x1f%s » → les commits. Pur. */
export function lireJournal(out: string): Commit[] {
  return out.split('\n').map((l) => l.split('\x1f')).filter((c) => c.length >= 4 && /^[0-9a-f]{7,}$/.test(c[0])).map((c) => ({ id: c[0], auteur: c[1], at: Number(c[2]) * 1000, sujet: c.slice(3).join(' ').slice(0, 200) }));
}
/** Une adresse de dépôt sans son mot de passe ni son jeton (« https://moi:ghp_xxx@github.com/… » → « https://github.com/… »). Pur. */
export function masquer(url: string): string {
  return url.trim().replace(/^(\w+:\/\/)[^/@\s]+@/, '$1').replace(/([?&](?:token|access_token|private_token|key)=)[^&\s]+/gi, '$1•••');
}
/** Une adresse qu'on peut cloner : https, ssh ou « git@hôte:chemin » ; jamais de transport qui lance un programme. Pur. */
export function adresseOk(url: string): boolean {
  const u = url.trim();
  if (/[\s'"`$;|&<>\\]/.test(u) || u.startsWith('-') || /^(ext|fd|file)::?/i.test(u) || u.includes('::')) return false;
  return /^https:\/\/[\w.-]+(:\d+)?\/[\w.~/+@-]+$/.test(u) || /^ssh:\/\/[\w.@-]+(:\d+)?\/[\w.~/+-]+$/.test(u) || /^[\w.-]+@[\w.-]+:[\w.~/+-]+$/.test(u);
}
/** Les réglages propres à un dépôt (« git config --local --list ») qui feraient lancer un programme pendant une
 *  récupération ou une mise à jour : Odin refuse alors d'y toucher (un dépôt copié d'ailleurs peut être piégé). Pur. */
export function reglagesRisques(liste: string): string[] {
  const out: string[] = [];
  for (const l of liste.split('\n')) {
    const k = l.indexOf('='), cle = (k < 0 ? l : l.slice(0, k)).trim().toLowerCase(), val = k < 0 ? '' : l.slice(k + 1).trim(); if (!cle) continue;
    if (/^core\.(sshcommand|hookspath|gitproxy|askpass)$/.test(cle) || /^remote\..+\.(uploadpack|receivepack|vcs)$/.test(cle) || /^filter\..+\.(smudge|clean|process)$/.test(cle) || /^merge\..+\.driver$/.test(cle)
      || /^(diff\.external|include\.path|includeif\..+\.path|gpg\.program|gpg\.(ssh|x509)\.program)$/.test(cle) || (cle === 'core.fsmonitor' && !/^(true|false|0|1|yes|no|on|off)?$/i.test(val))
      || (/^credential\.(.+\.)?helper$/.test(cle) && /^[!/.~]/.test(val)) || (/^submodule\..+\.update$/.test(cle) && val.startsWith('!'))) out.push(cle);
  }
  return [...new Set(out)];
}
/** Le nom de dossier d'un dépôt cloné (« …/mon-site.git » → « mon-site »). Pur. */
export function nomDe(url: string): string {
  return (url.trim().replace(/\/+$/, '').split(/[/:]/).pop() ?? '').replace(/\.git$/i, '').replace(/[^\w.-]/g, '-').replace(/^[.-]+/, '').slice(0, 60);
}
/** L'état d'un dépôt en une phrase. Pur. */
export function resume(st?: Statut): { texte: string; tone: Tone } {
  if (!st) return { texte: 'illisible', tone: 'mauvais' };
  const p: string[] = [];
  if (st.conflits) p.push(`${st.conflits} conflit(s)`);
  if (st.modifies) p.push(`${st.modifies} fichier(s) modifié(s)`);
  if (st.nonSuivis) p.push(`${st.nonSuivis} nouveau(x)`);
  if (st.avance) p.push(`${st.avance} commit(s) à envoyer`);
  if (st.retard) p.push(`${st.retard} à récupérer`);
  if (!st.amont && !p.length) p.push('pas de dépôt distant suivi');
  return { texte: p.join(' · ') || 'à jour', tone: st.conflits ? 'mauvais' : p.length ? 'attention' : 'bon' };
}
/** Les dépôts sous ces dossiers (dossier « .git », ou dépôt nu), sans descendre dans les dépôts ni dans node_modules. */
export function trouver(racines: string[], profondeur = 4): Array<{ chemin: string; nu: boolean }> {
  const out: Array<{ chemin: string; nu: boolean }> = [], vu = new Set<string>();
  const walk = (d: string, n: number) => {
    if (vu.has(d)) return; vu.add(d);
    let names: string[] = []; try { names = readdirSync(d); } catch { return; }
    if (names.includes('.git')) { out.push({ chemin: d, nu: false }); return; }
    if (names.includes('HEAD') && names.includes('objects') && names.includes('refs')) { out.push({ chemin: d, nu: true }); return; }
    if (n >= profondeur) return;
    for (const e of names) { if (e.startsWith('.') || e === 'node_modules' || e === 'vendor' || e === 'target' || e === 'dist') continue; const p = join(d, e); try { if (statSync(p).isDirectory()) walk(p, n + 1); } catch { /* lien cassé */ } }
  };
  for (const r of racines) walk(r, 0);
  return out;
}
const dossiers = (ctx: ModCtx): string[] => { const l = (ctx.settings.dossiers as string[] | undefined) ?? []; return l.length ? l : ['code', 'Code', 'projets', 'Projets', 'dev', 'src', 'git', 'workspace', 'Developer'].map((d) => join(homedir(), d)).filter((d) => existsSync(d)); };
const maison = (ctx: ModCtx) => join(ctx.dir, 'depots');
// Les commandes git d'Odin ne lancent jamais un programme du dépôt : pas de transport « ext », pas de surveillance de
// fichiers branchée, pas de scripts de dépôt (hooks).
const git = (ctx: ModCtx, dir: string, args: string[], ms = 20_000) => ctx.run('git', ['-C', dir, '-c', 'protocol.ext.allow=never', '-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${devNull}`, ...args], { timeoutMs: ms });
/** Refuse de toucher au réseau ou aux fichiers d'un dépôt dont les réglages lanceraient un programme. */
async function sansPiege(ctx: ModCtx, d: Depot): Promise<void> {
  const c = await git(ctx, d.chemin, ['config', '--local', '--list']), r = c.code ? [] : reglagesRisques(c.out);
  if (r.length) throw new Error(`${d.nom} contient un réglage qui lance un programme (${r.slice(0, 3).join(', ')}) : je n'y touche pas. Regarde son fichier .git/config.`);
}
async function lire(ctx: ModCtx, d: { chemin: string; nu: boolean }): Promise<Depot> {
  const out: Depot = { chemin: d.chemin, nom: basename(d.chemin).replace(/\.git$/, ''), nu: d.nu };
  if (!d.nu) { const st = await git(ctx, d.chemin, ['status', '--porcelain=v2', '--branch']); if (st.code) out.erreur = st.err.trim().split('\n')[0]; else out.statut = lireStatut(st.out); }
  const lg = await git(ctx, d.chemin, ['log', '-1', '--format=%H%x1f%an%x1f%at%x1f%s']); if (!lg.code) out.dernier = lireJournal(lg.out)[0];
  const rm = await git(ctx, d.chemin, ['remote', 'get-url', 'origin']); if (!rm.code && rm.out.trim()) out.distant = masquer(rm.out);
  return out;
}
async function tous(ctx: ModCtx): Promise<Depot[]> {
  if (!await ctx.has('git')) return [];
  const l = trouver([...dossiers(ctx), maison(ctx)]), out: Depot[] = [];
  for (const d of l.slice(0, 200)) out.push(await lire(ctx, d));
  return out.sort((a, b) => (b.dernier?.at ?? 0) - (a.dernier?.at ?? 0));
}
async function unDepot(ctx: ModCtx, qui: unknown): Promise<Depot> {
  const k = s(qui).trim().toLowerCase(); if (!k) throw new Error('quel dépôt ?');
  const l = await tous(ctx), d = l.find((x) => x.chemin.toLowerCase() === k) ?? l.find((x) => x.nom.toLowerCase() === k) ?? l.find((x) => x.nom.toLowerCase().includes(k));
  if (!d) throw new Error(`dépôt « ${s(qui)} » introuvable`); return d;
}
const quand = (t?: number) => (t ? new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
const depotParam = { key: 'depot', label: 'Dépôt (nom ou chemin)', kind: 'text' as const, required: true };

/** Le dernier passage de la vérification des dépôts (toutes les 12 heures), par dossier de données. */
const derniereVerif = new Map<string, number>();
export const ivaldi: Module & { similaires: string[] } = {
  id: 'ivaldi', name: 'Dédale', family: 'Données',
  what: 'Le code et les dépôts : Odin trouve tes dépôts git, dit où en est chacun (travail non enregistré, commits à envoyer ou à récupérer), les met à jour sans risque, en clone de nouveaux et héberge des dépôts de la maison pour tes autres machines.',
  does: ['tous tes dépôts git trouvés dans tes dossiers de code', 'pour chacun : branche, fichiers modifiés, commits à envoyer et à récupérer, dernier commit', 'récupérer les nouveautés (fetch) sans rien changer à ton travail', 'mettre à jour seulement quand c\'est sans risque (avance rapide, dossier propre)', 'cloner un dépôt (https ou SSH)', 'dépôts de la maison : un endroit chez toi où pousser ton code depuis tes autres machines', 'les jetons des adresses ne sont jamais affichés ; le code des dépôts n\'est jamais exécuté', 'rappel : du travail pas envoyé depuis plus d\'une semaine'],
  from: ['Gitea', 'Forgejo', 'GitHub Desktop'], upstream: ['go-gitea/gitea', 'forgejo/forgejo'],
  similaires: ['Gitea', 'Forgejo', 'SourceHut', 'GitHub Desktop', 'tmux', 'Replit', 'code-server'],
  words: ['dépôts git', 'dépôt git', 'depots git', 'depot git', 'mes dépôts', 'mes depots', 'git', 'gitea', 'forgejo', 'dédale', 'dedale', 'ivaldi', 'terminal', 'terminaux', 'tmux', 'replit', 'éditeur de code', 'mes projets de code'],
  actions: [
    { id: 'depots', label: 'Dépôts', what: 'Tous tes dépôts et où en est chacun', read: true, external: true, words: ['mes dépôts', 'état de mes dépôts', 'qu\'est-ce qui n\'est pas poussé'], run: async (ctx) => {
      if (!await ctx.has('git')) return { text: 'git n\'est pas installé sur cette machine.', ok: false };
      const l = await tous(ctx);
      return { text: l.length ? l.map((d) => `- ${d.nom}${d.nu ? ' (dépôt de la maison)' : ` [${d.statut?.branche ?? '?'}]`} : ${d.nu ? 'prêt à recevoir' : resume(d.statut).texte}${d.dernier ? ` · dernier commit ${quand(d.dernier.at)} « ${d.dernier.sujet.slice(0, 60)} »` : ''}`).join('\n') : `Aucun dépôt dans ${dossiers(ctx).join(', ') || 'tes dossiers de code (ajoute le tien)'}.`, data: l };
    } },
    { id: 'journal', label: 'Derniers commits', what: 'Les 20 derniers commits d\'un dépôt', words: ['derniers commits du dépôt'], read: true, external: true, params: [depotParam], run: async (ctx, i) => {
      const d = await unDepot(ctx, i.depot), r = await git(ctx, d.chemin, ['log', '-20', '--format=%H%x1f%an%x1f%at%x1f%s']); if (r.code) throw new Error(r.err.trim().split('\n')[0] || 'journal illisible');
      const l = lireJournal(r.out); return { text: l.map((c) => `- ${c.id.slice(0, 7)} · ${quand(c.at)} · ${c.auteur} · ${c.sujet}`).join('\n') || 'Aucun commit.', data: l };
    } },
    { id: 'recuperer', label: 'Récupérer les nouveautés', what: 'Regarde ce qu\'il y a de nouveau sur le dépôt distant, sans toucher à ton travail', params: [{ ...depotParam, required: false, label: 'Dépôt (vide : tous)' }], words: ['récupère les nouveautés du dépôt', 'git fetch'], run: async (ctx, i) => {
      const l = s(i.depot).trim() ? [await unDepot(ctx, i.depot)] : (await tous(ctx)).filter((d) => d.distant && !d.nu), out: string[] = [];
      for (const d of l) { try { await sansPiege(ctx, d); } catch (e) { out.push(`- ${d.nom} : laissé (${(e as Error).message.slice(0, 160)})`); continue; }
        const r = await git(ctx, d.chemin, ['fetch', '--all', '--prune', '--quiet'], 90_000); const st = r.code ? undefined : lireStatut((await git(ctx, d.chemin, ['status', '--porcelain=v2', '--branch'])).out); out.push(`- ${d.nom} : ${r.code ? `échec (${r.err.trim().split('\n')[0].slice(0, 120)})` : st?.retard ? `${st.retard} commit(s) à récupérer` : 'rien de nouveau'}`); }
      return { text: out.join('\n') || 'Aucun dépôt avec un distant.' };
    } },
    { id: 'mettre_a_jour', label: 'Mettre à jour', what: 'Prend les nouveaux commits, seulement si c\'est sans risque (dossier propre, avance rapide)', params: [depotParam], words: ['mets à jour le dépôt', 'git pull'], run: async (ctx, i) => {
      const d = await unDepot(ctx, i.depot); if (d.nu) throw new Error('un dépôt de la maison ne se met pas à jour : on y pousse');
      if (!d.statut) throw new Error(d.erreur ?? 'dépôt illisible');
      if (d.statut.modifies || d.statut.conflits) throw new Error(`${d.nom} a du travail en cours (${resume(d.statut).texte}) : enregistre-le d'abord, je ne mélange rien`);
      await sansPiege(ctx, d);
      const r = await git(ctx, d.chemin, ['pull', '--ff-only', '--no-recurse-submodules', '--quiet'], 120_000);
      if (r.code) throw new Error(/not possible to fast-forward|diverg/i.test(r.err) ? `${d.nom} et le distant ont divergé : la mise à jour demande une fusion, à faire à la main` : r.err.trim().split('\n')[0] || 'mise à jour refusée');
      const st = lireStatut((await git(ctx, d.chemin, ['status', '--porcelain=v2', '--branch'])).out);
      return { text: `⬇ ${d.nom} est à jour (${st.branche}).` };
    } },
    { id: 'cloner', label: 'Cloner un dépôt', what: 'Copie un dépôt (https ou SSH) dans ton dossier de code', words: ['clone le dépôt', 'git clone'], params: [{ key: 'adresse', label: 'Adresse du dépôt', kind: 'text', required: true, help: 'https://github.com/moi/projet.git ou git@github.com:moi/projet.git' }, { key: 'dossier', label: 'Dans le dossier (vide : le premier dossier de code)', kind: 'text', default: '' }], run: async (ctx, i) => {
      const url = s(i.adresse).trim(); if (!adresseOk(url)) throw new Error('adresse refusée : https://…, ssh://… ou git@hôte:chemin');
      if (!await ctx.has('git')) throw new Error('git n\'est pas installé');
      const dans = s(i.dossier).trim() || dossiers(ctx)[0] || join(homedir(), 'code'), nom = nomDe(url); if (!nom) throw new Error('nom du dépôt illisible');
      if (!dans.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(dans)) throw new Error('dossier : chemin absolu attendu');
      const cible = join(dans, nom); if (existsSync(cible)) throw new Error(`${cible} existe déjà`);
      mkdirSync(dans, { recursive: true });
      const r = await ctx.run('git', ['-c', 'protocol.ext.allow=never', '-c', `core.hooksPath=${devNull}`, 'clone', '--quiet', '--no-recurse-submodules', '--', url, cible], { timeoutMs: 600_000 }); if (r.code) throw new Error(masquer(r.err.trim().split('\n').at(-1) ?? 'clonage refusé'));
      if (!((ctx.settings.dossiers as string[] | undefined) ?? []).length && !dossiers(ctx).includes(dans)) ctx.saveSettings({ dossiers: [dans] });
      return { text: `📦 ${nom} cloné dans ${cible}.` };
    } },
    { id: 'creer_depot', label: 'Créer un dépôt de la maison', what: 'Un dépôt chez toi, où pousser ton code depuis tes autres machines (par SSH)', words: ['crée un dépôt de la maison'], params: [{ key: 'nom', label: 'Nom du dépôt', kind: 'text', required: true }], run: async (ctx, i) => {
      const nom = s(i.nom).trim().replace(/\.git$/i, ''); if (!/^[\w][\w.-]{0,59}$/.test(nom)) throw new Error('nom : lettres, chiffres, - . _ (60 au plus)');
      if (!await ctx.has('git')) throw new Error('git n\'est pas installé');
      const cible = join(maison(ctx), `${nom}.git`); if (existsSync(cible)) throw new Error('ce dépôt existe déjà');
      mkdirSync(maison(ctx), { recursive: true });
      const r = await ctx.run('git', ['init', '--bare', '--quiet', '--initial-branch=main', cible], { timeoutMs: 20_000 }); if (r.code) throw new Error(r.err.trim().split('\n')[0] || 'création refusée');
      const adresse = `${userInfo().username}@${hostname()}:${cible}`;
      return { text: `🏠 Dépôt « ${nom} » créé. Depuis une autre machine :\n  git remote add maison ${adresse}\n  git push maison main`, data: { adresse } };
    } },
    ...actionsDedale((ctx) => dossiers(ctx)),
    { id: 'dossier', label: 'Ajouter un dossier de code', what: 'Un dossier où chercher tes dépôts', words: ['ajoute un dossier de dépôts git'], params: [{ key: 'chemin', label: 'Chemin du dossier', kind: 'text', required: true }], run: (ctx, i) => {
      const d = s(i.chemin).trim(); if (!d || !existsSync(d) || !statSync(d).isDirectory()) throw new Error('dossier introuvable');
      ctx.saveSettings({ dossiers: [...new Set([...dossiers(ctx), d])] }); return { text: `📁 ${d} ajouté.` };
    } },
  ],
  async view(ctx) {
    const ok = await ctx.has('git'), l = ok ? await tous(ctx) : [], w = l.filter((d) => !d.nu);
    const kpis: Kpi[] = [{ label: 'Dépôts', value: String(w.length) }, { label: 'Travail en cours', value: String(w.filter((d) => d.statut && (d.statut.modifies || d.statut.nonSuivis)).length), tone: w.some((d) => d.statut?.modifies) ? 'attention' : 'bon' }, { label: 'À envoyer', value: String(w.filter((d) => d.statut?.avance).length), tone: w.some((d) => d.statut?.avance) ? 'attention' : 'bon' }, { label: 'À récupérer', value: String(w.filter((d) => d.statut?.retard).length) }, { label: 'De la maison', value: String(l.length - w.length) }];
    return {
      subtitle: ok ? `${w.length} dépôt(s) dans ${dossiers(ctx).length} dossier(s)` : 'git n\'est pas installé sur cette machine.', kpis,
      // Onglets : Terminaux · Projets (la page dessinée y met le terminal et l'éditeur) · Dépôts (ce que Dédale faisait déjà) · Réglages.
      onglets: ['Terminaux', 'Projets', 'Dépôts', 'Réglages'],
      sections: [
        ...sectionsDedale(ctx, dossiers(ctx)),
        ...(!ok || !dossiers(ctx).length ? [{ onglet: 'Dépôts', kind: 'steps' as const, title: 'Mise en route', items: [{ title: 'git installé', done: ok, detail: ok ? undefined : 'installe le paquet « git »' }, { title: 'Un dossier de code', detail: 'ajoute le dossier où sont tes projets', done: dossiers(ctx).length > 0 }] }] : []),
        { onglet: 'Dépôts', kind: 'table', title: 'Tes dépôts', columns: ['Dépôt', 'Branche', 'État', 'Dernier commit', 'Distant'], empty: 'Aucun dépôt trouvé : ajoute ton dossier de code, ou clone un dépôt.', rows: w.map((d) => ({ cells: [d.nom, d.statut?.branche ?? '—', d.erreur ?? resume(d.statut).texte, d.dernier ? `${quand(d.dernier.at)} · ${d.dernier.sujet.slice(0, 70)}` : '—', d.distant ?? '—'], tone: d.erreur ? 'mauvais' as const : resume(d.statut).tone, actions: [...(d.distant ? [{ action: 'recuperer', label: 'Récupérer', input: { depot: d.chemin } }] : []), ...(d.statut?.retard && !d.statut.modifies ? [{ action: 'mettre_a_jour', label: 'Mettre à jour', input: { depot: d.chemin } }] : [])] })) },
        { onglet: 'Dépôts', kind: 'table', title: 'Dépôts de la maison', columns: ['Dépôt', 'Dernier commit', 'Adresse pour pousser'], empty: 'Aucun : crée-en un pour pousser ton code chez toi.', rows: l.filter((d) => d.nu).map((d) => ({ cells: [d.nom, d.dernier ? `${quand(d.dernier.at)} · ${d.dernier.sujet.slice(0, 70)}` : 'vide', `${userInfo().username}@${hostname()}:${d.chemin}`] })) },
      ],
      side: [
        { onglet: 'Dépôts', kind: 'form', title: 'Cloner un dépôt', action: 'cloner', submit: 'Cloner', params: [{ key: 'adresse', label: 'Adresse du dépôt', kind: 'text', required: true }] },
        { onglet: 'Dépôts', kind: 'form', title: 'Créer un dépôt de la maison', action: 'creer_depot', submit: 'Créer', params: [{ key: 'nom', label: 'Nom du dépôt', kind: 'text', required: true }] },
        { onglet: 'Dépôts', kind: 'list', title: 'Dossiers de code', empty: 'Aucun dossier.', items: dossiers(ctx).map((d) => ({ title: d })) },
      ],
    };
  },
  // Chaque minute : les terminaux inactifs se ferment ; toutes les 12 heures : le travail pas envoyé des dépôts.
  watch: { every: 60, async run(ctx) {
    const ferme = menage(reglages(ctx).inactif, ctx.now().getTime());
    if (ferme.length) ctx.emit('terminaux_fermes', { noms: ferme.join(', ') });
    const now = ctx.now().getTime(); if (now - (derniereVerif.get(ctx.dir) ?? 0) < 12 * 3600_000) return; derniereVerif.set(ctx.dir, now);
    if (!await ctx.has('git')) return;
    const vieux = (await tous(ctx)).filter((d) => !d.nu && d.statut && (d.statut.avance || d.statut.modifies) && d.dernier && now - d.dernier.at > 7 * 864e5);
    if (vieux.length) ctx.alert({ level: 'info', title: `Dédale : ${vieux.length} dépôt(s) avec du travail pas envoyé depuis plus d'une semaine`, detail: vieux.slice(0, 8).map((d) => `${d.nom} (${resume(d.statut).texte})`).join(' ; '), key: `dedale:attente:${vieux.map((d) => d.nom).sort().join(',').slice(0, 80)}` });
  } },
  stop() { toutFermer(); },
};
