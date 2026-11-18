// Talos en marche : rangement des automatisations, déclencheurs (planning, webhook, Thot, flux,
// pages surveillées), journal des exécutions, création à partir d'une phrase, import d'un workflow n8n.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lireRythme, phrase, prochaine, type Rythme } from './rythme.ts';

/** Le rythme d'un nœud Planning : mode « simple » (rythme en clair), « intervalle », sinon cron (compté à l'heure du lieu). */
export function planningDe(p: Record<string, unknown>): { rythme: Rythme; phrase: string; cron?: string } | undefined {
  if (p.mode === 'intervalle') { const r: Rythme = { genre: 'minutes', n: Math.max(1, Math.min(1440, Math.round(Number(p.minutes) || 60))) }; return { rythme: r, phrase: phrase(r) }; }
  if (p.mode === 'simple') { const r = lireRythme(p.rythme); return r ? { rythme: r, phrase: phrase(r) } : undefined; }
  const expr = String(p.cron || '30 7 * * *'), r = lireRythme({ genre: 'cron', cron: expr });
  return r ? { rythme: r, phrase: phrase(r), cron: expr } : undefined;
}
/** Le nom qu'un lien donne à un nœud Planning d'après sa phrase (40 caractères au plus, comme construireLien). */
const nomPlanning = (dit: string) => (dit.length > 40 ? `${dit.slice(0, 39).trimEnd()}…` : dit);
/**
 * Un lien (origin 'lien') dont le rythme a changé : les noms que Talos avait tirés de l'ancienne phrase (nœud Planning,
 * nom de l'automatisation, description) suivent la nouvelle. Un nom changé à la main reste tel quel. Pur.
 */
export function suivreRythme(avant: Workflow | undefined, apres: Partial<Workflow>): Partial<Workflow> {
  if (!avant || apres.origin !== 'lien' || !Array.isArray(apres.nodes)) return apres;
  let name = apres.name, settings = apres.settings, connections = apres.connections;
  const nodes = apres.nodes.map((n) => ({ ...n }));
  for (const n of nodes) {
    if (n.type !== 'déclencheur.planning') continue;
    const a = avant.nodes.find((x) => x.name === n.name && x.type === 'déclencheur.planning');
    const vieux = a ? planningDe(a.params ?? {})?.phrase : undefined, neuf = planningDe(n.params ?? {})?.phrase;
    if (!vieux || !neuf || vieux === neuf) continue;
    if (typeof name === 'string' && name.startsWith(`${vieux} → `)) name = `${neuf}${name.slice(vieux.length)}`;
    const d = settings?.description;
    if (typeof d === 'string' && d.startsWith(`${vieux} → `)) settings = { ...settings, description: `${neuf}${d.slice(vieux.length)}` };
    const ancien = n.name, nouveau = nomPlanning(neuf);
    if (ancien !== nomPlanning(vieux) || nouveau === ancien || nodes.some((x) => x.name === nouveau)) continue;
    n.name = nouveau;
    connections = Object.fromEntries(Object.entries(connections ?? {}).map(([k, sorties]) => [k === ancien ? nouveau : k, sorties.map((l) => (l ?? []).map((x) => (x.node === ancien ? { ...x, node: nouveau } : x)))]));
  }
  return { ...apres, ...(name !== undefined ? { name } : {}), ...(settings !== undefined ? { settings } : {}), ...(connections !== undefined ? { connections } : {}), nodes };
}
import { checkFlow, execute, normalize, rid, type Deps, type Execution, type FlowNode, type Item, type Workflow } from './engine.ts';
import { cleNom, ecrireDossiers, ecrireJson, lireDossiers, lireSupprimes, MAX_DOSSIERS, RE_CLE, RE_DOSSIER, RE_ID, validerNomDossier, type Dossier, type TraceCorbeille } from './dossiers.ts';
import { automatisationsDepart, liensEntreApplis, type Depart } from './depart.ts';
import { runCode } from './code.ts';
import { CATALOG, NODES, fetchFige, parseFeed, versOdin } from './nodes.ts';
import { attendAccord } from '../tools/draupnir.ts';

/** La lecture d'un déclencheur « flux » ou « surveiller une page » : même contrôle que les blocs web (jamais Odin lui-même
 *  ni la machine d'Odin ; chaque redirection contrôlée ; sans fetch injecté, l'adresse contrôlée est celle de la connexion). */
async function lireHorsOdin(fi: typeof fetch | undefined, url: string, init: RequestInit): Promise<Response> {
  const f = fi ?? (fetchFige as unknown as typeof fetch);
  let u = url;
  for (let saut = 0; ; saut++) {
    const refus = await versOdin(u); if (refus) throw new Error(refus);
    const r = await f(u, { ...init, redirect: 'manual' });
    const loc = r.headers.get('location');
    if (![301, 302, 303, 307, 308].includes(r.status) || !loc) return r;
    if (saut >= 10) throw new Error('trop de redirections');
    void r.body?.cancel().catch(() => {});
    u = new URL(loc, u).href;
  }
}

const KEEP_RUNS = 40;

/** La marque d'installation des automatisations de départ (state/depart.json). */
export type EtatDepart = 'installe' | 'propose' | 'refuse';
interface MarqueDepart { version: 1; etat: EtatDepart; le: string; ids: string[] }

export class Talos {
  private timers = new Map<string, Array<ReturnType<typeof setTimeout>>>();
  private hits = new Map<string, number[]>();
  private running = new Set<string>();
  readonly dir: string;
  private deps: Deps;
  private hooks: { onRun?(ex: Execution): void };
  constructor(home: string, deps: Deps, hooks: { onRun?(ex: Execution): void } = {}) {
    this.hooks = hooks;
    // Sous-automatisations et code isolé : branchés ici pour que chaque nœud y ait accès.
    // replanifierFlux : quand Internet revient, un flux mis « en attente d'Internet » est relancé
    // depuis son déclencheur, au lieu d'attendre seulement son prochain créneau planifié.
    this.deps = { code: runCode, replanifierFlux: (id) => { const wf = this.get(id); const start = wf?.nodes.find((n) => CATALOG.get(n.type)?.trigger); if (wf?.active && start) void this.fire(id, start.name, []).catch(() => { /* une relance ratée ne fait pas tomber Odin */ }); }, ...deps, runFlow: (idOrName, items, depth) => this.call(idOrName, items, depth) };
    this.dir = join(home, 'draupnir');
    for (const d of ['flows', 'runs', 'state', 'corbeille', 'versions']) mkdirSync(join(this.dir, d), { recursive: true });
  }

  // ---------------- Rangement
  private file = (id: string) => join(this.dir, 'flows', `${id.replace(/[^\w-]/g, '')}.json`);
  list(): Workflow[] {
    return readdirSync(join(this.dir, 'flows')).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(readFileSync(join(this.dir, 'flows', f), 'utf8')) as Workflow; } catch { return undefined; } }).filter((w): w is Workflow => Boolean(w)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }
  get(id: string): Workflow | undefined { const f = this.file(id); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as Workflow : this.list().find((w) => w.name.toLowerCase() === id.toLowerCase()); }
  /**
   * L'identifiant propre tiré d'un ancien identifiant (d'avant la règle `[\w-]`, que l'IA pouvait inventer) : le nom
   * de son fichier, sans « v- » au début (réservé aux anciennes versions dans la corbeille).
   */
  private idPropre(id: string): string {
    const p = String(id).replace(/[^\w-]/g, '').slice(0, 64);
    return p && !p.startsWith('v-') ? p : rid();
  }
  save(input: Partial<Workflow>): Workflow {
    // L'identifiant devient un nom de fichier et de dossier (versions/<id>) : jamais de chemin.
    let ancienFichier: string | undefined;
    if (input.id && !RE_ID.test(String(input.id))) {
      // Une automatisation d'avant la règle garde sa vie : elle reçoit un identifiant propre (son fichier ne bouge
      // pas si son nom était déjà propre). Un identifiant dangereux pour une automatisation nouvelle est refusé.
      const avant = this.get(String(input.id));
      if (!avant || avant.id !== input.id || !existsSync(this.file(avant.id))) throw new Error('identifiant invalide');
      ancienFichier = this.file(avant.id);
      input = { ...input, id: this.idPropre(avant.id) };
      if (this.file(String(input.id)) !== ancienFichier && existsSync(this.file(String(input.id)))) input = { ...input, id: rid() };
    }
    // « v-… » est réservé aux anciennes versions rangées dans la corbeille : jamais pour une automatisation nouvelle.
    if (input.id && String(input.id).startsWith('v-') && !this.parId(String(input.id))) throw new Error('identifiant invalide');
    const old = ancienFichier ? JSON.parse(readFileSync(ancienFichier, 'utf8')) as Workflow : input.id ? this.get(input.id) : undefined;
    // Dossier : sans la clé, il reste celui d'avant (activer, régler le rythme, l'outil de l'agent ne font pas perdre
    // le rangement) ; '' ou null le retire ; un dossier nouveau doit exister.
    const aCle = Object.prototype.hasOwnProperty.call(input, 'dossier');
    const voulu: unknown = aCle ? (input as { dossier?: unknown }).dossier : old?.dossier;
    let dossier: string | undefined;
    if (voulu === '' || voulu === null || voulu === undefined) dossier = undefined;
    else if (voulu === old?.dossier) dossier = old?.dossier;
    else if (typeof voulu === 'string' && this.dossiers().some((d) => d.id === voulu)) dossier = voulu;
    // Un dossier supprimé entre-temps (éditeur resté ouvert) : l'automatisation s'enregistre « sans dossier ».
    else if (typeof voulu === 'string' && lireSupprimes(this.fichierDossiers).includes(voulu)) dossier = undefined;
    else throw new Error('dossier inconnu');
    const sans = { ...input }; delete sans.dossier;
    const wf = normalize(suivreRythme(old, { ...sans, ...(dossier ? { dossier } : {}), createdAt: old?.createdAt ?? input.createdAt }));
    // Webhook : chaque déclencheur reçoit un chemin secret (l'adresse ne se devine pas).
    for (const n of wf.nodes) if ((n.type === 'déclencheur.webhook' || n.type === 'déclencheur.formulaire') && !String(n.params.chemin ?? '').match(/^[\w-]{12,}$/)) n.params.chemin = randomBytes(12).toString('base64url');
    const err = checkFlow(wf, CATALOG);
    if (err) throw new Error(err);
    // Historique : la version précédente est gardée (20 dernières), restaurable.
    if (old) {
      const vd = join(this.dir, 'versions', wf.id); mkdirSync(vd, { recursive: true });
      writeFileSync(join(vd, `${Date.now()}.json`), JSON.stringify(old));
      const all = readdirSync(vd).sort(); for (const f of all.slice(0, Math.max(0, all.length - 20))) renameSync(join(vd, f), join(this.dir, 'corbeille', `v-${wf.id}-${f}`));
    }
    ecrireJson(this.file(wf.id), wf);
    if (ancienFichier && ancienFichier !== this.file(wf.id)) { this.disarm(String(old?.id)); try { unlinkSync(ancienFichier); } catch { /* déjà parti */ } }
    this.arm(wf);
    return wf;
  }
  /**
   * Corbeille (récupérable), jamais d'effacement direct. Le fichier jeté garde la trace de son dossier et de son état ;
   * Le fichier est d'abord DÉPLACÉ (un seul renommage : jamais à deux endroits à la fois), puis la trace est ajoutée.
   * Son nom vient de l'identifiant nettoyé, jamais du contenu brut du fichier (aucun chemin possible).
   */
  trash(id: string): void {
    const w = this.get(id); if (!w) throw new Error('automatisation introuvable');
    const source = this.file(w.id); if (!existsSync(source)) throw new Error('automatisation introuvable');
    this.disarm(w.id);
    const now = Date.now();
    const base = (String(w.id).replace(/[^\w-]/g, '').slice(0, 64) || 'automatisation').replace(/^v-/, 'v_');
    const dest = join(this.dir, 'corbeille', `${base}-${now}.json`);
    const corbeille: TraceCorbeille = { le: new Date(now).toISOString(), ...(typeof w.dossier === 'string' && RE_DOSSIER.test(w.dossier) ? { dossier: w.dossier } : {}), etaitActive: w.active === true };
    renameSync(source, dest);
    ecrireJson(dest, { ...w, corbeille });
  }
  versions(id: string): Array<{ at: number; name: string; nodes: number }> {
    if (!RE_ID.test(id)) return [];
    const vd = join(this.dir, 'versions', id); if (!existsSync(vd)) return [];
    return readdirSync(vd).sort().reverse().map((f) => { const w = JSON.parse(readFileSync(join(vd, f), 'utf8')) as Workflow; return { at: Number(f.replace('.json', '')), name: w.name, nodes: w.nodes.length }; });
  }
  /** Reprend une version : tout revient, sauf le dossier, qui reste celui d'aujourd'hui. */
  restore(id: string, at: number): Workflow {
    if (!RE_ID.test(id)) throw new Error('identifiant invalide');
    const f = join(this.dir, 'versions', id, `${Number(at)}.json`); if (!existsSync(f)) throw new Error('version introuvable');
    const v = JSON.parse(readFileSync(f, 'utf8')) as Workflow;
    return this.save({ ...v, id, dossier: this.get(id)?.dossier ?? '' });
  }
  setActive(id: string, on: boolean): Workflow { const w = this.get(id); if (!w) throw new Error('automatisation introuvable'); return this.save({ ...w, active: on }); }

  // ---------------- Dossiers du propriétaire et corbeille
  private get fichierDossiers(): string { return join(this.dir, 'dossiers.json'); }
  /** Les dossiers du propriétaire, dans l'ordre de création. */
  dossiers(): Dossier[] { return lireDossiers(this.fichierDossiers); }
  nomDossier(id: string): string | undefined { return this.dossiers().find((d) => d.id === id)?.nom; }
  creerDossier(nom: string): Dossier {
    const tous = this.dossiers(), propre = validerNomDossier(nom, tous);
    if (tous.length >= MAX_DOSSIERS) throw new Error(`${MAX_DOSSIERS} dossiers au plus`);
    let id = ''; do id = `d-${rid().toLowerCase()}`; while (!RE_DOSSIER.test(id) || tous.some((d) => d.id === id));
    const d: Dossier = { id, nom: propre, cree: new Date().toISOString() };
    ecrireDossiers(this.fichierDossiers, [...tous, d]);
    return d;
  }
  renommerDossier(id: string, nom: string): Dossier {
    const tous = this.dossiers(), d = tous.find((x) => x.id === id);
    if (!d) throw new Error('dossier introuvable');
    const propre = validerNomDossier(nom, tous, id);
    if (propre === d.nom) return d;
    const neuf = { ...d, nom: propre };
    ecrireDossiers(this.fichierDossiers, tous.map((x) => (x.id === id ? neuf : x)));
    return neuf;
  }
  /**
   * Supprime un dossier : ses automatisations perdent seulement leur champ `dossier` (ni version, ni réarmement, état
   * inchangé). La corbeille n'est pas touchée. Rend le nombre d'automatisations libérées.
   */
  supprimerDossier(id: string): number {
    const tous = this.dossiers();
    if (!tous.some((x) => x.id === id)) throw new Error('dossier introuvable');
    let n = 0;
    for (const w of this.list()) {
      if (w.dossier !== id || !RE_ID.test(w.id) || !existsSync(this.file(w.id))) continue;
      const reste: Partial<Workflow> = { ...w }; delete reste.dossier;
      ecrireJson(this.file(w.id), reste); n++;
    }
    ecrireDossiers(this.fichierDossiers, tous.filter((x) => x.id !== id), [...lireSupprimes(this.fichierDossiers), id]);
    return n;
  }
  /** Une automatisation par son identifiant exact, jamais par son nom. */
  parId(id: string): Workflow | undefined {
    if (typeof id !== 'string' || !RE_ID.test(id)) return undefined;
    const f = join(this.dir, 'flows', `${id}.json`);
    if (!existsSync(f)) return undefined;
    try { const w = JSON.parse(readFileSync(f, 'utf8')) as Workflow; return w && typeof w === 'object' && w.id === id ? w : undefined; } catch { return undefined; }
  }
  /**
   * Range une automatisation dans un dossier ('' : aucun). Écrit seulement ce champ : aucune version, rien n'est
   * réarmé, `updatedAt` ne bouge pas.
   */
  ranger(id: string, dossier: string | null | undefined): Workflow {
    if (typeof id !== 'string' || !RE_ID.test(id)) throw new Error('identifiant invalide');
    const w = this.parId(id); if (!w) throw new Error('automatisation introuvable');
    const neuf: Workflow = { ...w }; delete neuf.dossier;
    if (dossier !== '' && dossier !== null && dossier !== undefined) {
      if (typeof dossier !== 'string' || !this.dossiers().some((d) => d.id === dossier)) throw new Error('dossier inconnu');
      neuf.dossier = dossier;
    }
    ecrireJson(this.file(id), neuf);
    return neuf;
  }
  /** Ce qui est à la corbeille (sans les anciennes versions « v-… »), le plus récemment jeté d'abord. */
  listeCorbeille(): Array<{ cle: string; id: string; nom: string; jeteeLe: number; dossier?: string; etaitActive?: boolean }> {
    this.reprendreRestaurations();
    const dir = join(this.dir, 'corbeille'), out: ReturnType<Talos['listeCorbeille']> = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json') || f.startsWith('v-')) continue;
      const cle = f.slice(0, -5); if (!RE_CLE.test(cle)) continue;
      let w: (Partial<Workflow> & { corbeille?: Partial<TraceCorbeille> }) | undefined;
      try { w = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
      if (!w || typeof w !== 'object' || Array.isArray(w)) continue;
      const t = w.corbeille && typeof w.corbeille === 'object' ? w.corbeille : undefined;
      const tiret = cle.lastIndexOf('-'), le = typeof t?.le === 'string' ? Date.parse(t.le) : NaN, duNom = tiret >= 0 ? Number(cle.slice(tiret + 1)) : NaN;
      out.push({ cle, id: typeof w.id === 'string' ? w.id : cle.slice(0, Math.max(0, tiret)), nom: String(w.name ?? cle), jeteeLe: Number.isFinite(le) ? le : Number.isFinite(duNom) ? duNom : 0,
        ...(typeof t?.dossier === 'string' && RE_DOSSIER.test(t.dossier) ? { dossier: t.dossier } : {}), ...(typeof t?.etaitActive === 'boolean' ? { etaitActive: t.etaitActive } : {}) });
    }
    return out.sort((a, b) => b.jeteeLe - a.jeteeLe);
  }
  /**
   * Sort une automatisation de la corbeille : elle revient toujours en brouillon, dans son dossier s'il existe encore.
   * Si son identifiant est repris entre-temps, elle en reçoit un nouveau (et ses adresses secrètes changent).
   */
  /**
   * Une restauration coupée au milieu (Odin arrêté) : le fichier jeté porte alors le nom
   * `<clé>.vers-<id>.restauration`. Si l'automatisation est déjà revenue dans flows/, il est effacé ; sinon il retourne
   * à la corbeille. Jamais de doublon, jamais de perte.
   */
  private reprendreRestaurations(): void {
    const dir = join(this.dir, 'corbeille');
    for (const f of readdirSync(dir)) {
      const m = /^([\w-]{1,90})\.vers-([\w-]{1,64})\.restauration$/.exec(f); if (!m) continue;
      try { if (existsSync(this.file(m[2]))) unlinkSync(join(dir, f)); else renameSync(join(dir, f), join(dir, `${m[1]}.json`)); } catch { /* repris au prochain passage */ }
    }
  }
  restaurerCorbeille(cle: string): Workflow {
    if (typeof cle !== 'string' || !RE_CLE.test(cle) || cle.startsWith('v-')) throw new Error('identifiant invalide');
    this.reprendreRestaurations();
    const f = join(this.dir, 'corbeille', `${cle}.json`);
    if (!existsSync(f)) throw new Error('élément introuvable');
    let w: Workflow & { corbeille?: unknown };
    try { w = JSON.parse(readFileSync(f, 'utf8')); } catch { throw new Error('élément introuvable'); }
    if (!w || typeof w !== 'object' || !Array.isArray(w.nodes)) throw new Error('élément introuvable');
    const flow: Partial<Workflow> & { corbeille?: unknown } = { ...w, active: false }; delete flow.corbeille;
    flow.dossier = typeof w.dossier === 'string' && this.dossiers().some((d) => d.id === w.dossier) ? w.dossier : '';
    if (typeof flow.id !== 'string' || !RE_ID.test(flow.id) || flow.id.startsWith('v-') || existsSync(this.file(flow.id))) {
      flow.id = rid();
      flow.nodes = (flow.nodes ?? []).map((n) => (n.type === 'déclencheur.webhook' || n.type === 'déclencheur.formulaire' ? { ...n, params: { ...(n.params ?? {}), chemin: '' } } : n));
    }
    // D'abord le fichier jeté change de nom (il porte l'identifiant visé), puis l'automatisation est enregistrée,
    // enfin il est effacé : une coupure entre deux étapes se reprend sans doublon (reprendreRestaurations).
    const enCours = join(this.dir, 'corbeille', `${cle}.vers-${flow.id}.restauration`);
    renameSync(f, enCours);
    let sauve: Workflow;
    try { sauve = this.save(flow); } catch (e) {
      // Refusée avant d'être écrite : l'élément retourne à la corbeille. Écrite quand même : il n'y retourne pas.
      try { if (existsSync(this.file(String(flow.id)))) unlinkSync(enCours); else renameSync(enCours, f); } catch { /* repris au prochain passage */ }
      throw e;
    }
    try { unlinkSync(enCours); } catch { /* repris au prochain passage */ }
    return sauve;
  }
  /** Efface pour de bon ce que la corbeille montre (les anciennes versions « v-… » restent). Rend le nombre effacé. */
  viderCorbeille(): number {
    let n = 0;
    for (const e of this.listeCorbeille()) { try { unlinkSync(join(this.dir, 'corbeille', `${e.cle}.json`)); n++; } catch { /* déjà parti */ } }
    return n;
  }

  // ---------------- Automatisations de départ (installées une seule fois)
  private get fichierDepart(): string { return join(this.dir, 'state', 'depart.json'); }
  /**
   * La marque d'installation, ou undefined si elle n'existe pas. Une marque présente mais abîmée (elle est écrite d'un
   * coup, donc jamais à moitié par une coupure) dit qu'une décision a déjà été prise : elle se lit « installe », pour
   * que des automatisations jetées ou une proposition refusée ne reviennent jamais.
   */
  marqueDepart(): MarqueDepart | undefined {
    if (!existsSync(this.fichierDepart)) return undefined;
    try {
      const m = JSON.parse(readFileSync(this.fichierDepart, 'utf8')) as MarqueDepart;
      if (m && (m.etat === 'installe' || m.etat === 'propose' || m.etat === 'refuse')) return m;
    } catch { /* abîmée */ }
    return { version: 1, etat: 'installe', le: '', ids: [] };
  }
  private marquer(etat: EtatDepart): void {
    ecrireJson(this.fichierDepart, { version: 1, etat, le: new Date().toISOString(), ids: automatisationsDepart().map((x) => String(x.flow.id)) } satisfies MarqueDepart);
    // La série « Liens entre applis » a sa propre marque : elle garde la décision même si celle-ci s'abîme.
    if (etat !== 'propose') this.marquerLiens(etat, liensEntreApplis());
  }
  /**
   * Installe les automatisations de départ, une seule fois. Appelée au démarrage d'Odin (jamais par le constructeur).
   * - La marque existe : rien (une automatisation de départ jetée, modifiée ou désactivée ne revient jamais).
   * - Odin neuf (aucune automatisation à soi, ni dans flows/ ni à la corbeille) : tout est installé, puis marqué.
   *   Une reprise après coupure saute ce qui existe déjà : aucun doublon.
   * - Odin qui a déjà ses automatisations : rien n'est ajouté ; la page les propose (marque « propose »).
   * `accepter` : le propriétaire a dit « Les ajouter » à la proposition (seulement depuis « propose »).
   */
  installerDepart(o: { accepter?: boolean } = {}): { etat: EtatDepart; installees: number } {
    const marque = this.marqueDepart(), defs = automatisationsDepart(), ids = new Set(defs.map((x) => String(x.flow.id)));
    if (marque && !(o.accepter && marque.etat === 'propose')) {
      if (o.accepter) throw new Error(marque.etat === 'installe' ? 'déjà installées' : 'proposition refusée');
      return { etat: marque.etat, installees: 0 };
    }
    const jetees = this.listeCorbeille();
    if (!o.accepter && (this.list().some((w) => !ids.has(w.id)) || jetees.some((e) => !ids.has(e.id)))) { this.marquer('propose'); return { etat: 'propose', installees: 0 }; }
    const n = this.ajouterDefs(defs, jetees);
    this.marquer('installe');
    return { etat: 'installe', installees: n };
  }
  /** Enregistre des définitions de départ dans leurs dossiers (réutilisés s'il en existe un du même nom), sans
   * reprendre un identifiant présent dans flows/ ou à la corbeille. Rend le nombre ajouté. */
  private ajouterDefs(defs: Depart[], jetees = this.listeCorbeille()): number {
    const dossierDe = new Map<string, string | undefined>();
    for (const nom of new Set(defs.map((x) => x.dossier))) {
      let id = this.dossiers().find((d) => cleNom(d.nom) === cleNom(nom))?.id;
      if (!id) { try { id = this.creerDossier(nom).id; } catch { id = undefined; /* 50 dossiers : rangée sans dossier */ } }
      dossierDe.set(nom, id);
    }
    const pris = new Set([...this.list().map((w) => w.id), ...jetees.map((e) => e.id)]);
    let n = 0;
    for (const x of defs) {
      if (pris.has(String(x.flow.id))) continue;
      try { this.save({ ...x.flow, dossier: dossierDe.get(x.dossier) ?? '' }); n++; } catch { /* une définition refusée n'empêche pas les autres */ }
    }
    return n;
  }
  /** « Non merci » à la proposition : elle ne revient plus. */
  refuserDepart(): void {
    if (this.marqueDepart()?.etat === 'installe') throw new Error('déjà installées');
    this.marquer('refuse');
  }

  // ---------------- La série « Liens entre applis », proposée à un Odin déjà installé
  private get fichierLiens(): string { return join(this.dir, 'state', 'depart-liens.json'); }
  /** La marque de la série : undefined si elle n'existe pas, 'abimee' si elle est illisible. */
  private marqueLiens(): MarqueDepart | 'abimee' | undefined {
    if (!existsSync(this.fichierLiens)) return undefined;
    try {
      const m = JSON.parse(readFileSync(this.fichierLiens, 'utf8')) as MarqueDepart;
      if (m && (m.etat === 'installe' || m.etat === 'refuse') && Array.isArray(m.ids) && m.ids.every((x) => typeof x === 'string')) return m;
    } catch { /* abîmée */ }
    return 'abimee';
  }
  /** Ajoute ces liens aux identifiants déjà décidés (ajoutés ou refusés) : ils ne seront plus jamais proposés. */
  private marquerLiens(etat: 'installe' | 'refuse', defs: Depart[]): void {
    const avant = this.marqueLiens(), ids = new Set([...(avant && avant !== 'abimee' ? avant.ids : []), ...defs.map((x) => String(x.flow.id))]);
    ecrireJson(this.fichierLiens, { version: 1, etat, le: new Date().toISOString(), ids: [...ids] } satisfies MarqueDepart);
  }
  /**
   * Les liens à proposer : ceux de la série qu'aucune décision ne connaît encore (ni la marque de départ, ni celle de
   * la série), absents de flows/ et de la corbeille. Rien tant que les automatisations de départ ne sont pas décidées
   * (Odin neuf : elles s'installent avec le reste ; proposition en attente : elle comprend déjà la série). Une marque
   * de la série abîmée vaut décision : rien n'est proposé. Seuls des identifiants `depart-lien-…` peuvent l'être.
   */
  liensAProposer(): Depart[] {
    const m = this.marqueDepart(), ml = this.marqueLiens();
    if (!m || m.etat === 'propose' || ml === 'abimee') return [];
    const connus = new Set([...(Array.isArray(m.ids) ? m.ids : []), ...(ml?.ids ?? []), ...this.list().map((w) => w.id), ...this.listeCorbeille().map((e) => e.id)]);
    return liensEntreApplis().filter((x) => !connus.has(String(x.flow.id)));
  }
  /** Parmi les liens à proposer, seulement ceux que le propriétaire a vus (`ids` : la liste affichée). */
  private liensVus(ids: readonly string[]): Depart[] {
    const vus = new Set(ids);
    return this.liensAProposer().filter((x) => vus.has(String(x.flow.id)));
  }
  /** « Les ajouter » : les liens proposés ET affichés sont enregistrés (actifs ceux qui lisent, brouillons ceux qui agissent). */
  installerLiens(ids: readonly string[]): number {
    const defs = this.liensVus(ids);
    if (!defs.length) throw new Error('aucun lien à ajouter');
    const n = this.ajouterDefs(defs);
    this.marquerLiens('installe', defs);
    return n;
  }
  /** « Non merci » : les liens affichés ne reviennent plus (un lien ajouté plus tard au code sera proposé, une fois). */
  refuserLiens(ids: readonly string[]): void {
    const defs = this.liensVus(ids);
    if (defs.length) this.marquerLiens('refuse', defs);
  }

  runs(id?: string, n = 20): Execution[] {
    const files = id ? [`${id}.json`] : readdirSync(join(this.dir, 'runs'));
    return files.flatMap((f) => { try { return JSON.parse(readFileSync(join(this.dir, 'runs', f), 'utf8')) as Execution[]; } catch { return []; } }).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, n);
  }
  private record(ex: Execution): void {
    const f = join(this.dir, 'runs', `${ex.workflowId}.json`);
    let all: Execution[] = []; try { all = JSON.parse(readFileSync(f, 'utf8')); } catch { /* premier */ }
    writeFileSync(f, JSON.stringify([ex, ...all].slice(0, KEEP_RUNS)));
    this.hooks.onRun?.(ex);
  }
  private state<T>(key: string, v?: T): T | undefined {
    const f = join(this.dir, 'state', `${createHash('sha1').update(key).digest('hex').slice(0, 16)}.json`);
    if (v !== undefined) { writeFileSync(f, JSON.stringify(v)); return v; }
    try { return JSON.parse(readFileSync(f, 'utf8')) as T; } catch { return undefined; }
  }

  // ---------------- Exécuter
  /** Une exécution de cette automatisation tourne-t-elle (quel que soit son déclencheur) ? */
  enCours(id: string): boolean { for (const k of this.running) if (k.startsWith(`${id}:`)) return true; return false; }
  async run(id: string, items?: Item[], mode: Execution['mode'] = 'manuel', trigger?: string, opts: { depth?: number; stopAfter?: string; pinned?: Record<string, Array<Record<string, unknown>>> } = {}): Promise<Execution> {
    const wf = this.get(id); if (!wf) throw new Error('automatisation introuvable');
    // Une même automatisation ne tourne pas deux fois en même temps (sauf test manuel).
    const key = `${wf.id}:${trigger ?? ''}`;
    if (mode === 'déclencheur' && this.running.has(key)) return { id: '', workflowId: wf.id, name: wf.name, mode, status: 'erreur', startedAt: new Date().toISOString(), ms: 0, nodes: {}, error: 'déjà en cours' };
    this.running.add(key);
    try {
      const ex = await execute(wf, CATALOG, this.deps, { node: trigger, items, mode, ...opts });
      // « Exécuter ce bloc seul » (parti d'un bloc qui n'est pas un déclencheur et arrêté sur lui) : la ligne d'historique
      // le dit (`seul` : le nom du bloc), pour ne pas passer pour une exécution entière. Champ facultatif : une ligne
      // ancienne n'en a pas.
      const debut = trigger === undefined ? undefined : wf.nodes.find((n) => n.name === trigger || n.id === trigger);
      const seul = debut && opts.stopAfter === debut.name && !CATALOG.get(debut.type)?.trigger ? debut.name : undefined;
      this.record(seul ? { ...ex, seul } as Execution : ex);
      if (ex.status === 'erreur' && mode === 'déclencheur') {
        if (wf.settings?.notifyOnError !== false) await this.deps.notify?.(`⚠️ Talos — « ${wf.name} » a échoué${ex.failedNode ? ` à l'étape « ${ex.failedNode} »` : ''} : ${ex.error}`).catch(() => {});
        // Automatisations « Quand une automatisation échoue » (jamais pour elles-mêmes : pas de boucle).
        if (!wf.nodes.some((n) => n.type === 'déclencheur.erreur')) for (const w of this.list().filter((x) => x.active)) for (const n of w.nodes.filter((x) => x.type === 'déclencheur.erreur' && !x.disabled)) {
          if (n.params.surveille && String(n.params.surveille).toLowerCase() !== wf.name.toLowerCase()) continue;
          void this.fire(w.id, n.name, [{ json: { automatisation: wf.name, étape: ex.failedNode ?? '', erreur: ex.error ?? '', exécution: ex.id, date: ex.startedAt } }]);
        }
      }
      return ex;
    } finally { this.running.delete(key); }
  }

  /** Sous-automatisation : démarre par « Appelée par une automatisation » (sinon son premier déclencheur). */
  async call(idOrName: string, items: Item[], depth: number): Promise<Item[]> {
    const wf = this.get(idOrName); if (!wf) throw new Error(`automatisation introuvable : ${idOrName}`);
    // Écrite par Odin, pas encore lancée avec l'accord du propriétaire, et elle agit : elle ne part pas d'ici (sinon
    // une automatisation du propriétaire qui appelle un nom encore libre la lancerait sans lui). Il est prévenu comme
    // pour un échec d'exécution ; celle du propriétaire, déjà validée ou qui n'agit pas part comme avant.
    const attend = attendAccord(this, wf.id);
    if (attend) {
      const err = `« ${wf.name} » attend ton accord : lance-la une fois toi-même avec « Lancer » dans l'appli Talos, ou demande à Odin de la lancer ; « Tester » dans l'éditeur ne la valide pas (Odin l'a écrite et tu ne l'as pas encore validée ; ${attend.agit.join(' ; ')})`;
      await this.deps.notify?.(`⚠️ Talos — ${err}`).catch(() => {});
      throw new Error(err);
    }
    const start = wf.nodes.find((n) => n.type === 'déclencheur.appel') ?? wf.nodes.find((n) => CATALOG.get(n.type)?.trigger);
    const ex = await this.run(wf.id, items, 'déclencheur', start?.name, { depth });
    if (ex.status !== 'succès') throw new Error(`« ${wf.name} » : ${ex.error}`);
    const ends = wf.nodes.filter((n) => !(wf.connections[n.name] ?? []).some((o) => o?.length) && ex.nodes[n.name]);
    return (ends.length ? ends : [wf.nodes.at(-1)!]).flatMap((n) => (ex.nodes[n.name]?.items ?? []).map((j) => ({ json: j })));
  }

  /** Formulaire public : sa définition (titre, champs) pour l'afficher. */
  form(path: string): { title: string; intro: string; thanks: string; fields: Array<{ key: string; label: string; required: boolean; kind: 'text' | 'long' | 'email' | 'choix'; choices: string[] }> } | undefined {
    for (const wf of this.list().filter((w) => w.active)) for (const n of wf.nodes.filter((x) => x.type === 'déclencheur.formulaire' && !x.disabled)) {
      if (String(n.params.chemin) !== path) continue;
      const fields = String(n.params.champs ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const req = /\*/.test(l), kind = /\(long\)/i.test(l) ? 'long' : /\(email\)/i.test(l) ? 'email' : /\(choix:/i.test(l) ? 'choix' : 'text';
        const choices = /\(choix:\s*([^)]*)\)/i.exec(l)?.[1].split('|').map((x) => x.trim()).filter(Boolean) ?? [];
        const label = l.replace(/\(.*?\)/g, '').replace(/\*/g, '').trim();
        return { key: label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'champ', label, required: req, kind: kind as 'text' | 'long' | 'email' | 'choix', choices };
      });
      return { title: String(n.params.titre ?? 'Formulaire'), intro: String(n.params.description ?? ''), thanks: String(n.params.merci ?? 'Merci.'), fields };
    }
    return undefined;
  }
  async submitForm(path: string, data: Record<string, unknown>): Promise<{ ok: boolean; error?: string; thanks?: string }> {
    const def = this.form(path); if (!def) return { ok: false, error: 'formulaire inconnu' };
    const clean: Record<string, string> = {};
    for (const f of def.fields) {
      const v = String(data[f.key] ?? '').trim().slice(0, f.kind === 'long' ? 10_000 : 500);
      if (f.required && !v) return { ok: false, error: `« ${f.label} » est obligatoire` };
      if (v && f.kind === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return { ok: false, error: `« ${f.label} » : adresse invalide` };
      if (v && f.kind === 'choix' && !f.choices.includes(v)) return { ok: false, error: `« ${f.label} » : choix invalide` };
      clean[f.key] = v;
    }
    const now = Date.now(), h = (this.hits.get(`f:${path}`) ?? []).filter((t) => now - t < 60_000);
    if (h.length >= 20) return { ok: false, error: 'trop d\'envois, réessaie dans une minute' };
    h.push(now); this.hits.set(`f:${path}`, h);
    for (const wf of this.list().filter((w) => w.active)) for (const n of wf.nodes.filter((x) => x.type === 'déclencheur.formulaire' && String(x.params.chemin) === path)) void this.fire(wf.id, n.name, [{ json: { ...clean, $formulaire: def.title, $date: new Date(now).toISOString() } }]);
    return { ok: true, thanks: def.thanks };
  }

  // ---------------- Déclencheurs
  start(): void { for (const w of this.list()) this.arm(w); }
  stop(): void { for (const id of [...this.timers.keys()]) this.disarm(id); }
  private disarm(id: string): void { for (const t of this.timers.get(id) ?? []) { clearTimeout(t); clearInterval(t); } this.timers.delete(id); }
  private arm(wf: Workflow): void {
    this.disarm(wf.id);
    if (!wf.active) return;
    const ts: Array<ReturnType<typeof setTimeout>> = [];
    for (const n of wf.nodes) {
      if (n.disabled) continue;
      const p = n.params ?? {};
      if (n.type === 'déclencheur.planning') {
        const pl = planningDe(p);
        if (p.mode === 'intervalle') ts.push(setInterval(() => void this.fire(wf.id, n.name, [{ json: { heure: new Date().toISOString(), rythme: pl?.phrase ?? '' } }]), Math.max(1, Number(p.minutes) || 60) * 60_000));
        else if (pl) {
          // Mode simple (rythme en clair) ou cron : à l'heure du lieu d'Odin. Une minuterie à la fois, replanifiée après
          // chaque passage (et avant l'heure si le délai dépasse la borne des minuteries).
          const une = pl.rythme.genre === 'une_fois' ? `une_fois:${wf.id}:${n.name}:${JSON.stringify(pl.rythme)}` : '';
          if (une && this.state<string>(une)) continue; // déjà partie : rien n'est rejoué
          const slot = ts.length; ts.push(setTimeout(() => {}, 0));
          const plan = () => {
            const at = prochaine(pl.rythme, new Date()); if (!at) return;
            ts[slot] = setTimeout(() => {
              if (Date.now() < at.getTime() - 1000) { plan(); return; }
              if (une) this.state(une, at.toISOString());
              void this.fire(wf.id, n.name, [{ json: { heure: new Date().toISOString(), rythme: pl.phrase } }]);
              if (!une) plan();
            }, Math.max(0, Math.min(at.getTime() - Date.now(), 2 ** 31 - 1)));
          };
          plan();
        }
      } else if (n.type === 'déclencheur.flux' || n.type === 'déclencheur.surveille') {
        const every = Math.max(5, Number(p.minutes) || 30) * 60_000;
        const tick = () => void this.poll(wf.id, n.name).catch(() => {});
        ts.push(setTimeout(tick, 5_000), setInterval(tick, every));
      }
    }
    this.timers.set(wf.id, ts);
  }
  private async fire(id: string, node: string, items: Item[]): Promise<Execution | undefined> {
    const wf = this.get(id); if (!wf?.active) return undefined;
    return this.run(id, items, 'déclencheur', node);
  }
  /** Flux et pages surveillées : la première lecture sert de référence, puis seules les nouveautés déclenchent. */
  async poll(id: string, nodeName: string): Promise<number> {
    const wf = this.get(id), n = wf?.nodes.find((x) => x.name === nodeName); if (!wf || !n) return 0;
    const url = String(n.params.url ?? '');
    if (!/^https?:\/\//.test(url)) return 0;
    const r = await lireHorsOdin(this.deps.fetch, url, { signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'Odin-Draupnir/1.0' } });
    if (!r.ok) return 0;
    const text = await r.text(), key = `${wf.id}:${n.name}:${url}`;
    if (n.type === 'déclencheur.flux') {
      const items = parseFeed(text), seen = new Set(this.state<string[]>(key) ?? []), first = !this.state<string[]>(key);
      const fresh = items.filter((x) => !seen.has(x.id));
      this.state(key, [...new Set([...items.map((x) => x.id), ...seen])].slice(0, 500));
      if (first || !fresh.length) return 0;
      await this.fire(wf.id, n.name, fresh.map((x) => ({ json: { ...x } })));
      return fresh.length;
    }
    const plain = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const want = String(n.params.contient ?? '').trim();
    const hash = createHash('sha1').update(plain).digest('hex'), prev = this.state<{ hash: string; text: string }>(key);
    this.state(key, { hash, text: plain.slice(0, 4000) });
    if (!prev || prev.hash === hash || (want && !plain.toLowerCase().includes(want.toLowerCase()))) return 0;
    await this.fire(wf.id, n.name, [{ json: { url, extrait: plain.slice(0, 1500), avant: prev.text.slice(0, 1500) } }]);
    return 1;
  }
  /** Changement dans Thot → automatisations « Quand Thot change » qui correspondent. */
  async onSaga(e: { kind: string; path: string; title?: string; type?: string }): Promise<void> {
    for (const wf of this.list().filter((w) => w.active)) for (const n of wf.nodes.filter((x) => x.type === 'déclencheur.saga' && !x.disabled)) {
      const p = n.params ?? {}, quand = String(p.quand ?? 'créée');
      if (e.path.startsWith('Talos/')) continue;
      if (quand !== 'tout' && quand !== e.kind) continue;
      if (p.dossier && !e.path.startsWith(`${String(p.dossier).replace(/\/$/, '')}/`)) continue;
      if (p.type && String(p.type) !== e.type) continue;
      await this.fire(wf.id, n.name, [{ json: { événement: e.kind, chemin: e.path, titre: e.title ?? '', type: e.type ?? '' } }]);
    }
  }
  /** Événement ou alerte d'une appli d'Odin → automatisations « Quand une appli signale ». */
  async onModule(e: { module: string; name: string; type: string; level?: string; data: Record<string, unknown> }): Promise<void> {
    const RANK: Record<string, number> = { info: 0, moyenne: 1, haute: 2, critique: 3 };
    const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const wf of this.list().filter((w) => w.active)) for (const n of wf.nodes.filter((x) => x.type === 'déclencheur.module' && !x.disabled)) {
      const p = n.params ?? {}, want = norm(String(p.module ?? ''));
      if (!want || (want !== norm(e.module) && want !== norm(e.name))) continue;
      const ev = norm(String(p.événement ?? ''));
      if (ev && ev !== norm(e.type)) continue;
      if (e.type === 'alerte' && (RANK[e.level ?? 'info'] ?? 0) < (RANK[String(p.niveau ?? 'haute')] ?? 2)) continue;
      await this.fire(wf.id, n.name, [{ json: { appli: e.name, événement: e.type, ...(e.level ? { niveau: e.level } : {}), ...e.data } }]);
    }
  }
  /** Appel d'un webhook : chemin secret, 60 appels par minute au plus. */
  async webhook(path: string, body: unknown, query: Record<string, string>, method: string): Promise<{ status: number; body: unknown }> {
    for (const wf of this.list().filter((w) => w.active)) for (const n of wf.nodes.filter((x) => x.type === 'déclencheur.webhook' && !x.disabled)) {
      if (String(n.params.chemin) !== path) continue;
      const now = Date.now(), h = (this.hits.get(path) ?? []).filter((t) => now - t < 60_000);
      if (h.length >= 60) return { status: 429, body: { error: 'trop d\'appels' } };
      h.push(now); this.hits.set(path, h);
      const items: Item[] = [{ json: { ...(body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : { corps: body }), $requête: { méthode: method, paramètres: query } } }];
      if (n.params.réponse === 'à la fin') { const ex = await this.fire(wf.id, n.name, items); if (ex?.response) return ex.response; const last = ex && Object.values(ex.nodes).at(-1); return { status: ex?.status === 'succès' ? 200 : 500, body: { ok: ex?.status === 'succès', résultat: last?.items ?? [], error: ex?.error } }; }
      void this.fire(wf.id, n.name, items);
      return { status: 200, body: { ok: true } };
    }
    return { status: 404, body: { error: 'webhook inconnu' } };
  }
}

// ---------------------------------------------------------------- Créer à partir d'une phrase

export function catalogText(): string {
  return NODES.map((n) => `- ${n.type}${n.trigger ? ' (DÉCLENCHEUR)' : ''} — ${n.what}${n.outputs ? ` Sorties : ${typeof n.outputs === 'function' ? 'une par cas + autre' : n.outputs.join(', ')}.` : ''}\n  réglages : ${n.params.map((p) => `${p.key}${p.options ? ` (${p.options.join('|')})` : ''}`).join(', ') || 'aucun'}`).join('\n');
}
export function flowPrompt(): string {
  return `Tu écris des automatisations pour Talos, le moteur d'automatisations d'Odin. Réponds UNIQUEMENT par un objet JSON :
{"name":"…","nodes":[{"name":"…","type":"…","params":{…},"position":[x,y]}],"connections":{"NomSource":[[{"node":"NomCible"}],[…sortie 2…]]},"settings":{"description":"…"}}
Règles : exactement un déclencheur au début ; noms de nœuds uniques et courts en français ; positions de gauche à droite (x += 220) ; « Si » a deux sorties (oui, non) ;
les données passent d'un nœud à l'autre en éléments ; dans les réglages, {{ $json.champ }} insère un champ de l'élément courant, {{ $node["Nom"].json.champ }} celui d'un nœud précédent, {{ $today }} la date.
Pour qu'Odin résume, trie ou rédige : odin.demander ; pour prévenir le propriétaire : odin.prévenir ; pour garder dans le Cerveau : saga.écrire.
Planning : cron à 5 champs, heure locale. N'invente aucun type de nœud.
Nœuds disponibles :
${catalogText()}`;
}
export function parseFlowJson(text: string): Partial<Workflow> {
  const m = /\{[\s\S]*\}/.exec(text.replace(/```(?:json)?/g, ''));
  if (!m) throw new Error('pas de JSON dans la réponse');
  return JSON.parse(m[0]) as Partial<Workflow>;
}
export async function flowFromDescription(llm: (system: string, user: string) => Promise<string>, description: string): Promise<Partial<Workflow>> {
  let last = '';
  for (let k = 0; k < 2; k++) {
    try {
      const wf = parseFlowJson(await llm(flowPrompt(), k ? `${description}\n\nTa réponse précédente était refusée : ${last}. Corrige.` : description));
      const err = checkFlow(normalize(wf), CATALOG);
      // Une automatisation écrite par l'IA est toujours neuve : aucun identifiant ni dossier venu de sa réponse.
      if (!err) { const neuve = { ...wf }; delete neuve.id; delete neuve.dossier; return { ...neuve, active: false, origin: 'odin' }; }
      last = err;
    } catch (e) { last = (e as Error).message; }
  }
  throw new Error(`automatisation impossible à écrire : ${last}`);
}

// ---------------------------------------------------------------- Importer un workflow n8n

const N8N_MAP: Record<string, (p: Record<string, unknown>) => { type: string; params: Record<string, unknown> }> = {
  'n8n-nodes-base.manualTrigger': () => ({ type: 'déclencheur.manuel', params: {} }),
  'n8n-nodes-base.scheduleTrigger': (p) => { const r = ((p.rule as { interval?: Array<Record<string, unknown>> })?.interval ?? [])[0] ?? {}; return r.field === 'cronExpression' ? { type: 'déclencheur.planning', params: { mode: 'cron', cron: r.expression } } : r.field === 'minutes' || r.minutesInterval ? { type: 'déclencheur.planning', params: { mode: 'intervalle', minutes: r.minutesInterval ?? 60 } } : { type: 'déclencheur.planning', params: { mode: 'cron', cron: `${r.triggerAtMinute ?? 0} ${r.triggerAtHour ?? 8} * * *` } }; },
  'n8n-nodes-base.cron': () => ({ type: 'déclencheur.planning', params: { mode: 'cron', cron: '0 8 * * *' } }),
  'n8n-nodes-base.webhook': () => ({ type: 'déclencheur.webhook', params: {} }),
  'n8n-nodes-base.rssFeedReadTrigger': (p) => ({ type: 'déclencheur.flux', params: { url: p.feedUrl, minutes: 30 } }),
  'n8n-nodes-base.rssFeedRead': (p) => ({ type: 'web.flux', params: { url: p.url } }),
  'n8n-nodes-base.httpRequest': (p) => ({ type: 'web.requête', params: { méthode: p.method ?? 'GET', url: p.url, corps: p.jsonBody ?? p.body ?? '' } }),
  'n8n-nodes-base.if': () => ({ type: 'logique.si', params: {} }),
  'n8n-nodes-base.filter': () => ({ type: 'logique.filtre', params: {} }),
  'n8n-nodes-base.set': () => ({ type: 'données.définir', params: {} }),
  'n8n-nodes-base.splitOut': (p) => ({ type: 'données.éclater', params: { champ: p.fieldToSplitOut } }),
  'n8n-nodes-base.aggregate': () => ({ type: 'données.regrouper', params: {} }),
  'n8n-nodes-base.limit': (p) => ({ type: 'données.limiter', params: { nombre: p.maxItems ?? 5 } }),
  'n8n-nodes-base.sort': () => ({ type: 'données.trier', params: {} }),
  'n8n-nodes-base.removeDuplicates': () => ({ type: 'données.dédoublonner', params: {} }),
  'n8n-nodes-base.wait': (p) => ({ type: 'logique.attendre', params: { secondes: p.amount ?? 60 } }),
  'n8n-nodes-base.noOp': () => ({ type: 'logique.fin', params: {} }),
};
/** Convertit un workflow n8n (JSON exporté) : les nœuds connus sont traduits, les autres signalés à refaire. */
export function importN8n(src: { name?: string; nodes?: Array<{ name: string; type: string; parameters?: Record<string, unknown>; position?: [number, number] }>; connections?: Record<string, { main?: Array<Array<{ node: string }>> }> }): { flow: Partial<Workflow>; todo: string[] } {
  const todo: string[] = [];
  const nodes: FlowNode[] = (src.nodes ?? []).filter((n) => n.type !== 'n8n-nodes-base.stickyNote').map((n): FlowNode => {
    const m = N8N_MAP[n.type];
    if (!m) { todo.push(`${n.name} (${n.type.replace(/^.*\./, '')})`); return { name: n.name, type: 'logique.fin', params: {}, position: n.position, note: `À refaire : nœud ${n.type} non traduit`, disabled: true }; }
    return { name: n.name, ...m(n.parameters ?? {}), position: n.position };
  });
  const connections = Object.fromEntries(Object.entries(src.connections ?? {}).map(([k, v]) => [k, (v.main ?? []).map((o) => (o ?? []).map((l) => ({ node: l.node })))]));
  if (!nodes.some((n) => CATALOG.get(n.type)?.trigger)) nodes.unshift({ name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [0, 200] });
  return { flow: { name: src.name ?? 'Automatisation importée', nodes, connections, active: false, origin: 'import' }, todo };
}

/** Modèles prêts. */
export function templates(): Array<{ id: string; name: string; what: string; flow: Partial<Workflow> }> {
  const L = (from: string, to: string | string[]) => ({ [from]: [(Array.isArray(to) ? to : [to]).map((node) => ({ node }))] });
  return [
    { id: 'point-matin', name: 'Point du matin', what: 'Chaque jour à 7 h 30 : ce qui demande ton attention, résumé par Odin et envoyé si utile.', flow: { name: 'Point du matin', nodes: [
      { name: 'Chaque matin', type: 'déclencheur.planning', params: { mode: 'cron', cron: '30 7 * * *' }, position: [0, 200] },
      { name: 'Attention', type: 'saga.attention', params: {}, position: [220, 200] },
      { name: 'Regrouper', type: 'données.regrouper', params: { champ: 'points' }, position: [440, 200] },
      { name: 'Rédiger', type: 'odin.demander', params: { consigne: 'Fais-moi un point du matin court à partir de : {{ $json.points }}. Commence par le plus urgent. S\'il n\'y a rien, réponds RIEN.', envoyer: 'si utile' }, position: [660, 200] },
    ] as unknown as Workflow['nodes'], connections: { ...L('Chaque matin', 'Attention'), ...L('Attention', 'Regrouper'), ...L('Regrouper', 'Rédiger') } } },
    { id: 'flux-saga', name: 'Flux vers Thot', what: 'Chaque nouvel article d\'un flux (blog, chaîne YouTube) résumé et rangé dans Captures.', flow: { name: 'Flux vers Thot', nodes: [
      { name: 'Nouvel article', type: 'déclencheur.flux', params: { url: 'https://exemple.com/flux.xml', minutes: 60 }, position: [0, 200] },
      { name: 'Résumer', type: 'odin.demander', params: { consigne: 'Résume en 5 lignes cet article : {{ $json.titre }} — {{ $json.résumé }} ({{ $json.lien }})', pour: 'par élément' }, position: [220, 200] },
      { name: 'Ranger', type: 'saga.écrire', params: { mode: 'créer', titre: '{{ $json.titre }}', type: 'capture', contenu: '{{ $json.réponse }}\n\nSource : {{ $json.lien }}' }, position: [440, 200] },
    ] as unknown as Workflow['nodes'], connections: { ...L('Nouvel article', 'Résumer'), ...L('Résumer', 'Ranger') } } },
    { id: 'formulaire', name: 'Formulaire → Papyrus', what: 'Un webhook reçoit une demande (formulaire de site) et l\'ajoute à la base Clients, puis te prévient.', flow: { name: 'Formulaire vers Papyrus', nodes: [
      { name: 'Formulaire', type: 'déclencheur.webhook', params: { réponse: 'tout de suite' }, position: [0, 200] },
      { name: 'Ajouter le contact', type: 'runes.ajouter', params: { base: 'personne', titre: '{{ $json.nom }}', propriétés: '{ "email": "{{ $json.email }}", "message": "{{ $json.message }}" }' }, position: [220, 200] },
      { name: 'Prévenir', type: 'odin.prévenir', params: { texte: '📩 Nouvelle demande de {{ $json.nom }} : {{ $json.message }}' }, position: [440, 200] },
    ] as unknown as Workflow['nodes'], connections: { ...L('Formulaire', 'Ajouter le contact'), ...L('Ajouter le contact', 'Prévenir') } } },
    { id: 'surveille', name: 'Surveiller une page', what: 'Prévient quand une page change (prix, stock, annonce).', flow: { name: 'Surveiller une page', nodes: [
      { name: 'La page change', type: 'déclencheur.surveille', params: { url: 'https://exemple.com', minutes: 60 }, position: [0, 200] },
      { name: 'Ce qui a changé', type: 'odin.demander', params: { consigne: 'Avant : {{ $json.avant }}\nMaintenant : {{ $json.extrait }}\nDis en une phrase ce qui a changé sur {{ $json.url }}. Si rien d\'important, réponds RIEN.', envoyer: 'si utile' }, position: [220, 200] },
    ] as unknown as Workflow['nodes'], connections: L('La page change', 'Ce qui a changé') } },
    { id: 'nouvelle-tache', name: 'Nouvelle tâche → rappel', what: 'Quand une tâche est créée dans Thot, Odin te la confirme avec son échéance.', flow: { name: 'Nouvelle tâche', nodes: [
      { name: 'Tâche créée', type: 'déclencheur.saga', params: { quand: 'créée', type: 'tâche' }, position: [0, 200] },
      { name: 'Prévenir', type: 'odin.prévenir', params: { texte: '📝 Nouvelle tâche : {{ $json.titre }}' }, position: [220, 200] },
    ] as unknown as Workflow['nodes'], connections: L('Tâche créée', 'Prévenir') } },
  ];
}

