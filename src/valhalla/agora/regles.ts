// Agora : qui reçoit quoi. Le droit vient de la connexion unique (Persona, `ssoDroits` : aDroit, changerDroit) — rien
// n'est dupliqué ici ; Agora ajoute le MODE de chaque groupe (proposée, installée d'office, retirée) et en tire, pour
// chaque appareil, son store et les ordres imposés (installer, désinstaller, mettre à jour), envoyés par le flux.

import type { ModCtx } from '../types.ts';
import { valhallaOf } from '../odin.ts';
import { persona } from '../sso/registre.ts';
import { aDroit, changerDroit, groupesDe, personnes, prenomProprio, type Personne } from '../sso/etat.ts';
import { agissant } from '../sso/acces.ts';
import { compareVersions, depotDe, nouvelId, OUVERT, paquetPour, MODES, type Action, type Appareil, type Depot, type Element, type Mode, type Ordre, type Paquet } from './store.ts';

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();

/** Le dépôt d'Agora de ce contexte. */
export const depot = (ctx: ModCtx): Depot => depotDe(ctx.dir);
/** Le contexte de Persona (les personnes et les droits), qu'Odin tourne en entier ou non. */
export function personaDe(ctx: ModCtx): ModCtx | undefined {
  const p = persona(); if (p) return p;
  try { return valhallaOf()?.ctx('var'); } catch { return undefined; }
}
/** Réveille Persona si son contexte n'est pas encore connu (Odin vient de démarrer). */
export async function reveillerPersona(ctx: ModCtx): Promise<ModCtx | undefined> {
  if (!personaDe(ctx) && ctx.modules().some((m) => m.id === 'var')) await ctx.call('var', 'personnes', {}, 'Agora lit les groupes de Persona', { interne: true }).catch(() => undefined);
  return personaDe(ctx);
}
/** La personne en cours est-elle un admin (le propriétaire, ou une personne du groupe admin) ? Les réflexes et l'API locale le sont. */
export function estAdmin(): boolean { const q = agissant(); return !q || q.groups.includes('admin'); }
/** Le nom de qui agit (pour « Imposée par Awa »). */
export function quiAgit(ctx: ModCtx): string { const q = agissant(); if (q) return q.name; const p = personaDe(ctx); return p ? prenomProprio(p) : 'l\'administrateur'; }
export const estAdminP = (p: Personne) => Boolean(p.proprio || p.groups.includes('admin'));

/** Le mode d'un élément pour une personne : son droit (connexion unique), puis le mode le plus fort de ses groupes. */
export function modePour(pctx: ModCtx, e: Element, p: Personne): { mode: Mode; par: string } | undefined {
  const qui = [...p.groups, `@${p.login}`, '*'];
  if (aDroit(pctx, p, e.droit)) {
    let best: { mode: Mode; par: string } | undefined;
    for (const g of qui) { const m = e.modes[g]; if (m && m.mode !== 'retiree' && (!best || (m.mode === 'office' && best.mode !== 'office'))) best = { mode: m.mode, par: m.par }; }
    return best ?? { mode: 'proposee', par: '' };
  }
  const r = qui.map((g) => e.modes[g]).find((m) => m?.mode === 'retiree');
  return r ? { mode: 'retiree', par: r.par } : undefined;
}

/** Une ligne du store d'un appareil (ou de l'espace Odin d'une personne). */
export interface Article {
  id: string; nom: string; desc: string; mode: Mode; par: string;
  /** l'appli d'Odin (web) à ouvrir */ web?: string;
  /** l'installateur pour cet appareil (sans lui : rien à installer ici) */
  paquet?: { format: string; version: string; sha256: string; taille: number; nomFichier: string; ident?: string; telecharger: string };
  /** forcé par l'admin sur cet appareil */ force?: 'installee' | 'absente';
  etat?: string; version?: string; progression?: number; erreur?: string;
  majDispo?: boolean;
}
const telechargerDe = (e: Element, p: Paquet) => p.lien ?? `/api/agora/telecharger?element=${encodeURIComponent(e.id)}&plateforme=${p.plateforme}&version=${encodeURIComponent(p.version)}`;
/** Le store d'une personne sur un appareil (plateforme « web » : son espace Odin seulement). */
export function storeDe(ctx: ModCtx, p: Personne, a?: Pick<Appareil, 'plateforme' | 'applis' | 'forces'>): Article[] {
  const pctx = personaDe(ctx); if (!pctx) return [];
  const d = depot(ctx), pf = a?.plateforme ?? 'web', out: Article[] = [];
  for (const e of d.elements) {
    const m = modePour(pctx, e, p), f = a?.forces[e.id], pk = pf === 'web' || pf === 'ios' ? undefined : paquetPour(e, pf), cur = a?.applis[e.id];
    if (!m && f !== 'installee' && !(cur && cur.etat !== 'absente')) continue; // ni droit, ni forcée, ni installée : rien à montrer
    if (!pk && !e.web) continue; // rien pour cet appareil
    out.push({ id: e.id, nom: e.nom, desc: e.desc, mode: f === 'installee' ? 'office' : f === 'absente' ? 'retiree' : m?.mode ?? 'retiree', par: m?.par ?? '',
      ...(e.web ? { web: e.web } : {}),
      ...(pk ? { paquet: { format: pk.format, version: pk.version, sha256: pk.sha256, taille: pk.taille, nomFichier: pk.nomFichier, ...(pk.ident ? { ident: pk.ident } : {}), telecharger: telechargerDe(e, pk) } } : {}),
      ...(f ? { force: f } : {}),
      ...(cur ? { etat: cur.etat, ...(cur.version ? { version: cur.version } : {}), ...(cur.progression !== undefined ? { progression: cur.progression } : {}), ...(cur.erreur ? { erreur: cur.erreur } : {}) } : {}),
      ...(pk && cur?.etat === 'installee' && cur.version && compareVersions(pk.version, cur.version) > 0 ? { majDispo: true } : {}) });
  }
  return out.sort((x, y) => (x.mode === 'office' ? -1 : 0) - (y.mode === 'office' ? -1 : 0) || x.nom.localeCompare(y.nom, 'fr'));
}

/** Ce que l'appareil DOIT faire pour cet élément (undefined : rien). */
export function voulu(pctx: ModCtx, e: Element, a: Appareil, p: Personne | undefined): { action: Action; version?: string; par: 'mode' | 'force'; qui: string } | undefined {
  const f = a.forces[e.id], m = p ? modePour(pctx, e, p) : undefined, cur = a.applis[e.id], pk = paquetPour(e, a.plateforme);
  const installee = cur && ['installee', 'installation', 'erreur'].includes(cur.etat) && !(cur.etat === 'erreur' && !cur.version);
  const veutInstaller = f === 'installee' || (!f && m?.mode === 'office');
  const veutRetirer = f === 'absente' || (!f && (!m || m.mode === 'retiree'));
  const par: 'mode' | 'force' = f ? 'force' : 'mode', qui = f ? '' : m?.par ?? '';
  if (veutInstaller && pk) {
    if (cur?.etat === 'installee' && cur.version && compareVersions(cur.version, pk.version) >= 0) return undefined;
    return { action: cur?.etat === 'installee' ? 'mettre_a_jour' : 'installer', version: pk.version, par, qui };
  }
  // Désinstaller seulement ce qu'Agora connaît sur l'appareil (jamais une appli que le store n'a pas vue).
  if (veutRetirer && installee) return { action: 'desinstaller', par, qui };
  return undefined;
}

/**
 * Met les ordres d'accord avec les droits et les modes : crée ceux qui manquent (et les envoie), annule ceux qui ne
 * servent plus, clôt ceux qui sont faits. Rend le nombre d'ordres créés. Appelée à chaque changement (mode, groupe,
 * appareil) et chaque seconde par l'appli (changements de groupes faits dans Persona).
 */
export function reconcilier(ctx: ModCtx): number {
  const pctx = personaDe(ctx); if (!pctx) return 0;
  const d = depot(ctx), now = ctx.now().getTime(), ps = personnes(pctx); let crees = 0, change = false;
  for (const a of d.appareils) {
    if (a.retire) continue;
    const p = ps.find((x) => x.id === a.sub && x.active);
    for (const e of d.elements) {
      const v = voulu(pctx, e, a, p), o = d.ouvert(a.id, e.id);
      if (o && (!v || v.action !== o.action || (v.version && o.version && v.version !== o.version))) {
        o.etat = 'annule'; o.maj = now; change = true; d.bus.emit('annule', a.id, o.id);
      } else if (o) continue;
      if (!v) continue;
      // Un ordre qui vient d'échouer n'est pas renvoyé en boucle : 3 essais, puis 30 minutes de pause.
      const rates = d.ordres.filter((x) => x.appareil === a.id && x.element === e.id && x.action === v.action && x.etat === 'echec' && now - x.maj < 30 * 60_000);
      if (rates.length >= 3) continue;
      const n: Ordre = { id: nouvelId(6), appareil: a.id, element: e.id, action: v.action, ...(v.version ? { version: v.version } : {}), par: v.par, qui: v.qui, cree: now, etat: 'attente', maj: now, tentative: rates.length + 1 };
      d.ordres.push(n); crees++; change = true;
      d.noter(now, v.qui || 'Agora', `${ACTIONS[v.action]} ${e.nom} sur ${a.nom} (${a.nomPersonne}) : ordre envoyé${v.par === 'force' ? ' (forcé par l\'admin)' : ''}`);
      d.bus.emit('ordre', a.id, n);
    }
  }
  if (change) d.sauverOrdres();
  // Le store de chaque appareil a-t-il changé ? (nouvel élément proposé, retiré…) : le flux le dit à l'appareil.
  for (const a of d.appareils) {
    if (a.retire) continue;
    const p = ps.find((x) => x.id === a.sub), sig = p ? JSON.stringify(storeDe(ctx, p, a).map((x) => [x.id, x.mode, x.paquet?.version, x.force])) : '';
    if (signatures.get(`${d.dir}|${a.id}`) !== sig) { const avant = signatures.has(`${d.dir}|${a.id}`); signatures.set(`${d.dir}|${a.id}`, sig); if (avant) d.bus.emit('store', a.id); }
  }
  return crees;
}
const signatures = new Map<string, string>();
export const ACTIONS: Record<Action, string> = { installer: 'Installer', desinstaller: 'Désinstaller', mettre_a_jour: 'Mettre à jour' };

/** Change le mode d'un groupe pour un élément : le droit de la connexion unique suit (donné, ou retiré). */
export function changerMode(ctx: ModCtx, e: Element, groupe: string, mode: Mode | 'aucun', qui: string): void {
  const pctx = personaDe(ctx); if (!pctx) throw new Error('Persona ne tourne pas : les groupes et les droits sont chez lui');
  const d = depot(ctx), now = ctx.now().getTime();
  if (groupe !== 'admin') changerDroit(pctx, e.droit, groupe, mode === 'proposee' || mode === 'office');
  if (mode === 'aucun') delete e.modes[groupe]; else e.modes[groupe] = { mode, par: qui, at: now };
  d.sauverCatalogue();
  d.noter(now, qui, `${e.nom} · ${groupe.startsWith('@') ? groupe.slice(1) : `groupe ${groupe}`} : ${mode === 'aucun' ? 'pas pour ce groupe' : MODES[mode].toLowerCase()}`);
  reconcilier(ctx);
}
/** Les groupes qui ont un droit ou un mode sur cet élément. */
export function groupesElement(pctx: ModCtx | undefined, e: Element): string[] {
  const g = new Set<string>(Object.keys(e.modes).filter((x) => e.modes[x].mode !== 'retiree'));
  if (pctx) for (const x of groupesDe(pctx, e.droit)) g.add(x);
  return [...g].sort((a, b) => (a === 'admin' ? -1 : b === 'admin' ? 1 : a.localeCompare(b)));
}
export { OUVERT, s as texte };
