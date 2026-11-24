// Hydre, lot M1 (maquette « Arche et Hydre » validée le 23/11) : mettre en pause et reprendre une machine virtuelle.
//   - VM de CE PC : QMP « stop » puis « cont » (le canal de contrôle qu'Hydre utilise déjà pour l'écran et le clavier) ;
//     la machine garde sa mémoire et repart où elle en était. Sous Windows : refusé, avec la raison (voir VM_WINDOWS).
//   - VM d'un serveur de virtualisation relié : « suspend » puis « resume » par son interface (la même que démarrer).
// L'état « en pause » est gardé (machines.json pour ce PC, réglages d'Hydre pour les serveurs reliés) et se voit partout.
// Les deux actions sont au propriétaire seul (ni un membre, ni une tablette, ni la clé d'API, ni une automatisation)
// et chacune laisse une ligne dans « qui a fait quoi » (qui, quoi, quand, résultat). La parole « mets en pause la VM … »
// arrive sur la même action.
import type { Action, ModCtx } from '../types.ts';
import { avecJournal, actionJournal } from '../vidarr/qui-a-fait.ts';
import { Local, type Machine } from './local.ts';
import { quiEnDepend } from './dependances.ts';

/** Une VM d'un serveur relié, telle que la liste de ses ressources la donne. */
export interface VmDistante { vmid: number; name?: string; type: string; status?: string; server: string; node: string }
/** Ce qu'Hydre sait faire avec ses serveurs reliés (fourni par le module : liste des ressources, action sur une machine). */
export interface Distant {
  liste: (ctx: ModCtx) => Promise<VmDistante[]>;
  /** agit sur CETTE machine (son serveur et son nœud), jamais « la première qui porte ce numéro » */
  agir: (ctx: ModCtx, g: VmDistante, quoi: 'suspend' | 'resume') => Promise<string>;
  /** l'état réel de la VM vu par son serveur (« running », « paused »…) ; undefined si le serveur ne répond pas */
  statut: (ctx: ModCtx, g: VmDistante) => Promise<string | undefined>;
}
/** Une VM d'un serveur relié gardée « en pause » (l'interface la dit encore « en marche » : elle tourne, figée). */
export interface PauseDistante { server: string; vmid: number; depuis: number }

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
export const pausesDistantes = (ctx: ModCtx): PauseDistante[] => (ctx.settings.pauses as PauseDistante[] | undefined) ?? [];
export const enPauseDistante = (ctx: ModCtx, server: string, vmid: number): boolean => pausesDistantes(ctx).some((p) => p.server === server && p.vmid === vmid);

/** La machine visée : une VM de ce PC (nom, adresse), sinon une VM d'un serveur relié (numéro ou nom). */
async function cible(ctx: ModCtx, q: unknown, d: Distant): Promise<{ locale: Machine } | { distante: VmDistante }> {
  const L = new Local(ctx);
  try { return { locale: L.find(q) }; } catch { /* pas une machine de ce PC */ }
  const t = s(q).trim().toLowerCase(), n = /^\d+$/.test(t) ? Number(t) : undefined;
  const l = (await d.liste(ctx).catch(() => [])).filter((r) => r.vmid);
  const parNum = l.filter((r) => r.vmid === n), trouvees = parNum.length ? parNum : l.filter((r) => (r.name ?? '').toLowerCase() === t);
  if (!trouvees.length) throw new Error(`machine introuvable : « ${s(q)} »`);
  // Deux serveurs reliés peuvent porter le même numéro (ou le même nom) : ne jamais deviner laquelle figer.
  if (trouvees.length > 1) throw new Error(`plusieurs machines s'appellent « ${s(q)} » (${trouvees.map((r) => r.server).join(', ')}) : arrête ou reprends-la depuis la page de son serveur`);
  return { distante: trouvees[0] };
}

/** Une VM d'un serveur relié : seulement une VM (pas un conteneur), allumée. */
function verifierDistante(g: VmDistante): void {
  if (g.type !== 'qemu') throw new Error(`${g.name ?? g.vmid} est un conteneur : la pause n'est là que pour les VM`);
  if (g.status !== 'running') throw new Error(`${g.name ?? g.vmid} est éteinte : rien à mettre en pause`);
}

/** Les deux actions (et « qui a fait quoi » d'Hydre). */
export function pauseActions(d: Distant): Action[] {
  const p = { key: 'machine', label: 'Machine (nom, adresse ou numéro)', kind: 'text' as const, required: true };
  const l: Action[] = [
    {
      id: 'pause_machine', label: 'Mettre en pause', what: 'Fige une machine virtuelle allumée : elle garde sa mémoire et repart où elle en était (VM de ce PC ou d\'un serveur relié)',
      params: [p], proprietaireSeul: true,
      grave: (i, ctx) => `mettre en pause la machine ${nomLisible(ctx, i.machine)} (ses services ne répondent plus jusqu'à la reprise)${quiEnDepend(ctx, i.machine)}`,
      // Des mots qui nomment la VM : « mettre en pause » seul est aussi la lecture, un film, un abonnement (autres applis).
      words: ['mets en pause la vm', 'mets la vm en pause', 'mets en pause la machine virtuelle', 'mets la machine virtuelle en pause', 'pause la vm', 'suspends la vm', 'suspends la machine virtuelle', 'mettre en pause la vm'],
      undo: (i) => ({ action: 'reprendre_machine', input: { machine: i.machine }, label: 'Reprendre' }),
      run: async (ctx, i) => {
        const c = await cible(ctx, i.machine, d);
        if ('locale' in c) { await new Local(ctx).pause(c.locale); return { text: `⏸ ${c.locale.nom} en pause (sa mémoire est gardée ; « reprends la vm ${c.locale.nom} » pour la relancer).`, data: { machine: c.locale.nom, etat: 'en pause' } }; }
        const g = c.distante; verifierDistante(g);
        // L'état réel d'abord (le serveur), la marque gardée seulement s'il ne répond pas : une marque fausse après une
        // coupure (ou une reprise faite ailleurs) ne bloque jamais la VM.
        const reel = await d.statut(ctx, g).catch(() => undefined);
        if (reel ? reel !== 'running' : enPauseDistante(ctx, g.server, g.vmid)) { marquer(ctx, g, true); throw new Error(`${g.name ?? g.vmid} est déjà en pause`); }
        const t = await d.agir(ctx, g, 'suspend');
        marquer(ctx, g, true);
        return { text: `⏸ ${t}`, data: { machine: g.name ?? String(g.vmid), etat: 'en pause' } };
      },
    },
    {
      id: 'reprendre_machine', label: 'Reprendre', what: 'Relance une machine virtuelle en pause, là où elle en était (VM de ce PC ou d\'un serveur relié)',
      params: [p], proprietaireSeul: true,
      // « reprends » seul est le verbe de tête (il pèse dans le choix) ; la phrase doit encore nommer une VM : « reprends la
      // lecture », « reprends le film » vont à leurs applis (essai dans les quatre langues).
      words: ['reprends', 'reprends la vm', 'reprends la machine virtuelle', 'relance la vm en pause', 'sors la vm de pause'],
      undo: (i) => ({ action: 'pause_machine', input: { machine: i.machine }, label: 'Remettre en pause' }),
      run: async (ctx, i) => {
        const c = await cible(ctx, i.machine, d);
        if ('locale' in c) { await new Local(ctx).reprendre(c.locale); return { text: `▶ ${c.locale.nom} reprend où elle en était.`, data: { machine: c.locale.nom, etat: 'en marche' } }; }
        const g = c.distante;
        if (g.type !== 'qemu') throw new Error(`${g.name ?? g.vmid} est un conteneur : la pause n'est là que pour les VM`);
        if (g.status !== 'running') { marquer(ctx, g, false); throw new Error(`${g.name ?? g.vmid} est éteinte : démarre-la plutôt`); }
        // Figée sur son serveur sans marque chez Odin (coupure, réglages perdus, pause faite ailleurs) : la reprise passe quand même.
        const reel = await d.statut(ctx, g).catch(() => undefined);
        if (reel ? reel === 'running' : !enPauseDistante(ctx, g.server, g.vmid)) { marquer(ctx, g, false); throw new Error(`${g.name ?? g.vmid} n'est pas en pause`); }
        const t = await d.agir(ctx, g, 'resume');
        marquer(ctx, g, false);
        return { text: `▶ ${t}`, data: { machine: g.name ?? String(g.vmid), etat: 'en marche' } };
      },
    },
  ];
  return [...avecJournal('ymir_actes', l), actionJournal('ymir_actes', 'Hydre')];
}

/** Garde (ou retire) la marque « en pause » d'une VM d'un serveur relié. */
function marquer(ctx: ModCtx, g: VmDistante, pause: boolean): void {
  const autres = pausesDistantes(ctx).filter((x) => !(x.server === g.server && x.vmid === g.vmid));
  if (pause ? autres.length < pausesDistantes(ctx).length : autres.length === pausesDistantes(ctx).length) return; // rien à changer
  ctx.saveSettings({ pauses: pause ? [...autres, { server: g.server, vmid: g.vmid, depuis: ctx.now().getTime() }] : autres });
}
/** Le nom d'une VM de ce PC pour la confirmation (son identifiant ne parle à personne) ; sinon ce qui a été dit. */
function nomLisible(ctx: ModCtx | undefined, q: unknown): string {
  if (ctx) try { return new Local(ctx).find(q).nom; } catch { /* VM d'un serveur relié, ou introuvable */ }
  return s(q);
}

/** Une VM d'un serveur relié éteinte n'est plus en pause : la marque est retirée (surveillance). */
export function nettoyerPauses(ctx: ModCtx, res: VmDistante[]): void {
  const l = pausesDistantes(ctx); if (!l.length) return;
  const garde = l.filter((p) => res.some((r) => r.server === p.server && r.vmid === p.vmid && r.status === 'running'));
  if (garde.length !== l.length) ctx.saveSettings({ pauses: garde });
}
