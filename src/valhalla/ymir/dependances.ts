// Hydre, lot M3 (maquette « Conteneurs et machines » validée le 23/11) : « qui dépend de qui » (cahier § 3.7).
// Ce qui dépend d'une machine de ce PC :
//   - noté à la main par le propriétaire (le registre) : une autre machine d'Hydre, un conteneur d'Arche, des PC (« les
//     12 PC du domaine dépendent du DC »), autre chose ;
//   - vu par Odin : une installation ou un déploiement de Genèse qui vise cette machine (par son adresse MAC), un plan de
//     Phénix qui la sauvegarde.
// Un dépendant est « vivant » quand il tourne (machine allumée ou en pause, conteneur en marche, installation pas finie) :
// tant qu'il y en a un, la machine ne se supprime pas. Ce qu'Odin ne peut pas vérifier compte comme vivant (une source
// qui ne répond pas, des PC notés à la main) : la suppression dit pourquoi, et comment lever le blocage.
// Les gestes du registre sont au propriétaire seul et notés dans « qui a fait quoi » d'Hydre.
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Action, ModCtx } from '../types.ts';
import { texteDesactivee } from '../activation.ts';
import { avecJournal } from '../vidarr/qui-a-fait.ts';
import { agissant } from '../sso/acces.ts';
import { Local, type Etat, type Machine } from './local.ts';

export type GenreLien = 'machine' | 'arche' | 'pc' | 'autre';
/** Une ligne du registre : `qui` dépend de la machine `de` (identifiant d'Hydre). */
export interface Lien {
  id: string; de: string; genre: GenreLien; qui: string; nombre?: number; note?: string; at: number;
  /** noté par Odin pour une copie liée (lot M7) : elle utilise le disque de `de` ; toujours bloquant, jamais retiré à la main */
  liee?: boolean;
}
export type GenreDependant = GenreLien | 'genese' | 'phenix';
export interface Dependant {
  genre: GenreDependant; nom: string;
  /** il tourne : la machine ne se supprime pas */
  vivant: boolean;
  /** Odin ne peut pas le vérifier : compte comme vivant */
  inconnu?: boolean;
  /** la phrase montrée (page, conversation) */
  texte: string;
  /** la ligne du registre (dépendant noté à la main), pour la retirer */
  lien?: string;
  nombre?: number;
}
export interface Bilan { dependants: Dependant[]; bloquants: string[] }

/** Ce qu'Odin lit pour faire le bilan (une seule lecture pour toutes les machines de la page). */
export interface Sources {
  machines: Array<{ id: string; nom: string; etat?: Etat['state'] }>;
  /** Genèse : `arretee` si elle est absente ou désactivée (rien ne peut s'installer), absent si elle ne répond pas */
  genese?: 'arretee' | { enCours: Array<{ mac?: unknown; host?: unknown; step?: unknown; isoName?: unknown }>; lots: Array<{ isoNom?: unknown; pcs?: Array<{ mac?: unknown; nom?: unknown; etat?: unknown }> }> };
  /** Arche : ses conteneurs (absent : Arche ne répond pas) */
  arche?: Array<{ nom: string; enMarche: boolean }>;
  /** Phénix : les lignes de ses plans (absent : Phénix ne répond pas ; ses plans ne bloquent jamais) */
  phenix?: string[];
}

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
/** Le registre, gardé dans les réglages d'Hydre. */
export const liensDe = (ctx: ModCtx): Lien[] => ((ctx.settings.dependances as Lien[] | undefined) ?? []).filter((l) => l && typeof l.id === 'string' && typeof l.de === 'string');
const mac = (x: unknown) => s(x).trim().toLowerCase().replace(/-/g, ':');
/** Une installation de Genèse qui n'est pas finie (mêmes mots que le retrait d'un système, lot S3). */
const ETAPES_FINALES = new Set(['fini', 'sans nouvelles', 'échec']);
const ETATS_VIVANTS = new Set(['attente', 'en cours', 'lancée']);
const GENRES: GenreLien[] = ['machine', 'arche', 'pc', 'autre'];
const pluriel = (n: number | undefined, un: string, plusieurs: string) => (n && n > 1 ? plusieurs : un);

/**
 * Ce qui dépend de la machine `m`, et ce qui empêche de la supprimer. `dossiers` : les dossiers de la machine (un plan de
 * Phénix qui les sauvegarde la cite). Pur.
 */
export function bilanDependants(m: Pick<Machine, 'id' | 'nom' | 'mac'>, liens: Lien[], src: Sources, dossiers: string[] = []): Bilan {
  const dependants: Dependant[] = [], bloquants: string[] = [];
  for (const l of liens.filter((x) => x.de === m.id)) {
    if (l.genre === 'machine') {
      const x = src.machines.find((y) => y.id === l.qui);
      if (!x) { dependants.push({ genre: 'machine', nom: l.qui, vivant: false, lien: l.id, texte: 'Une machine qui n\'existe plus en dépendait : ce lien peut être retiré.' }); continue; }
      // Une copie liée n'écrit que ses changements sur ce disque : allumée ou non, il ne part pas tant qu'elle existe.
      if (l.liee) {
        dependants.push({ genre: 'machine', nom: x.nom, vivant: true, lien: l.id, texte: `La copie liée ${x.nom} utilise son disque.` });
        bloquants.push(`la copie liée ${x.nom} utilise son disque : supprime d'abord ${x.nom}`);
        continue;
      }
      const e = x.etat ?? 'inconnue', vivant = e === 'en marche' || e === 'en pause', inconnu = e === 'inconnue';
      dependants.push({ genre: 'machine', nom: x.nom, vivant, ...(inconnu ? { inconnu } : {}), lien: l.id, texte: vivant ? `La machine ${x.nom} en dépend, et elle est ${e === 'en pause' ? 'en pause' : 'allumée'}.` : inconnu ? `La machine ${x.nom} en dépend, et Odin ne sait pas si elle tourne.` : `La machine ${x.nom} en dépend (éteinte).` });
      if (vivant) bloquants.push(`la machine ${x.nom} en dépend et elle est ${e === 'en pause' ? 'en pause' : 'allumée'} : arrête-la d'abord, ou retire ce lien`);
      else if (inconnu) bloquants.push(`la machine ${x.nom} en dépend et Odin ne sait pas si elle tourne`);
    } else if (l.genre === 'arche') {
      const c = src.arche?.find((y) => y.nom === l.qui);
      if (!src.arche) { dependants.push({ genre: 'arche', nom: l.qui, vivant: false, inconnu: true, lien: l.id, texte: `Le conteneur ${l.qui} (Arche) en dépend ; Arche ne répond pas.` }); bloquants.push(`le conteneur ${l.qui} en dépend et Arche ne répond pas : Odin ne peut pas vérifier qu'il est arrêté`); continue; }
      if (!c) { dependants.push({ genre: 'arche', nom: l.qui, vivant: false, lien: l.id, texte: `Le conteneur ${l.qui} en dépendait ; il n'existe plus dans Arche.` }); continue; }
      dependants.push({ genre: 'arche', nom: c.nom, vivant: c.enMarche, lien: l.id, texte: c.enMarche ? `Le conteneur ${c.nom} (Arche) en dépend, et il tourne.` : `Le conteneur ${c.nom} (Arche) en dépend (arrêté).` });
      if (c.enMarche) bloquants.push(`le conteneur ${c.nom} en dépend et il tourne : arrête-le dans Arche d'abord, ou retire ce lien`);
    } else {
      // Des PC, autre chose : noté à la main, Odin ne peut pas savoir s'ils s'en servent encore. Compte comme vivant.
      const n = l.nombre && l.nombre > 0 ? l.nombre : undefined, qui = `${n ? `${n} ` : ''}${l.qui}`;
      dependants.push({ genre: l.genre, nom: l.qui, vivant: true, inconnu: true, lien: l.id, ...(n ? { nombre: n } : {}), texte: `${qui} ${pluriel(n, 'en dépend', 'en dépendent')} (noté à la main).` });
      bloquants.push(`${qui} ${pluriel(n, 'en dépend', 'en dépendent')} (noté à la main, Odin ne peut pas le vérifier) : retire ce lien du registre si ce n'est plus vrai`);
    }
  }
  // Genèse : une installation par le réseau, ou un déploiement, qui vise cette machine (sa carte réseau).
  const moi = mac(m.mac);
  if (src.genese === undefined) bloquants.push('Genèse ne répond pas : Odin ne peut pas vérifier qu\'aucune installation par le réseau ne vise cette machine');
  else if (src.genese !== 'arretee' && moi) {
    const vus = new Set<string>();
    for (const x of src.genese.enCours ?? []) {
      if (!x || mac(x.mac) !== moi || ETAPES_FINALES.has(s(x.step))) continue;
      const nom = s(x.isoName) || 'un système'; if (vus.has(nom)) continue; vus.add(nom);
      dependants.push({ genre: 'genese', nom, vivant: true, texte: `Genèse installe ${nom} sur cette machine en ce moment (${s(x.step) || 'en cours'}).` });
      bloquants.push(`Genèse installe ${nom} sur cette machine en ce moment : attends la fin, ou annule dans Genèse → Suivi`);
    }
    for (const lot of src.genese.lots ?? []) {
      const p = (lot?.pcs ?? []).find((y) => y && mac(y.mac) === moi && ETATS_VIVANTS.has(s(y.etat)));
      if (!p) continue;
      const nom = s(lot.isoNom) || 'un système'; if (vus.has(nom)) continue; vus.add(nom);
      dependants.push({ genre: 'genese', nom, vivant: true, texte: `Un déploiement de Genèse (${nom}) vise cette machine et n'est pas fini.` });
      bloquants.push(`un déploiement de Genèse (${nom}) vise cette machine et n'est pas fini : attends la fin, ou annule dans Genèse → Suivi`);
    }
  }
  // Phénix : un plan qui la sauvegarde (créé avec elle, « Machine <nom> », ou qui lit son dossier). Il ne bloque pas :
  // le plan et ses sauvegardes déjà faites restent.
  for (const ligne of src.phenix ?? []) {
    const nom = /^-\s*(.+?) : /.exec(ligne)?.[1]; if (!nom) continue;
    const lit = dossiers.some((d) => d && ligne.split(/ : | → |, /).some((x) => x.trim() === d));
    if (nom !== `Machine ${m.nom}` && !lit) continue;
    dependants.push({ genre: 'phenix', nom, vivant: false, texte: `Phénix la sauvegarde (plan « ${nom} ») : le plan et ses sauvegardes déjà faites restent.` });
  }
  return { dependants, bloquants };
}

/** Lit les sources une fois (Genèse, Arche si le registre en parle, Phénix), en étape interne. */
export async function lireSources(ctx: ModCtx, machines: Sources['machines'], o: { arche?: boolean } = {}): Promise<Sources> {
  const lire = async (module: string, action: string, why: string): Promise<{ data?: unknown; text: string; ok: boolean } | undefined> => {
    try { const r = await ctx.call(module, action, {}, why, { interne: true }); return { data: r.data, text: r.text ?? '', ok: r.ok !== false }; } catch { return undefined; }
  };
  // Genèse absente ou désactivée : ses serveurs sont arrêtés, rien ne s'installe (comme pour le retrait d'un système).
  const g = ctx.modules().find((m) => m.id === 'thjalfi');
  let genese: Sources['genese'];
  if (!g) genese = 'arretee';
  else {
    const [a, b] = await Promise.all([lire('thjalfi', 'machines', 'ce qui dépend de cette machine'), lire('thjalfi', 'deploiement_suivi', 'ce qui dépend de cette machine')]);
    if ([a, b].some((r) => r && !r.ok && r.text === texteDesactivee(g.name))) genese = 'arretee';
    else if (a?.ok && Array.isArray(a.data) && b?.ok) genese = { enCours: a.data as never, lots: Array.isArray((b.data as { lots?: unknown } | undefined)?.lots) ? (b.data as { lots: never }).lots : [] };
  }
  let arche: Sources['arche'];
  if (o.arche) {
    const r = await lire('naglfar', 'lister', 'ce qui dépend de cette machine');
    if (r?.ok && Array.isArray(r.data)) arche = (r.data as Array<{ Names?: unknown; State?: unknown }>).map((x) => ({ nom: s(x.Names), enMarche: s(x.State) === 'running' }));
  }
  const p = await lire('sindri', 'plans', 'ce qui dépend de cette machine');
  const phenix = p?.ok ? p.text.split('\n').filter((l) => l.startsWith('- ')) : undefined;
  return { machines, ...(genese ? { genese } : {}), ...(arche ? { arche } : {}), ...(phenix ? { phenix } : {}) };
}

/** Les dossiers d'une machine (ce qu'un plan de Phénix lirait). */
export const dossiersDe = (L: Local, m: Machine): string[] => (m.genre === 'vm' ? [L.vmDir(m)] : [join(L.lxcDir, m.nom), join(L.lxcDir, m.nom, 'rootfs')]);

/** Le bilan de chaque machine (ou d'une seule). Les états sont relus (une machine qui ne répond pas : « inconnue »). */
export async function bilans(ctx: ModCtx, seule?: Machine): Promise<{ machines: Record<string, Bilan>; liens: Lien[] }> {
  const L = new Local(ctx), l = L.list(), liens = liensDe(ctx);
  const etats = await Promise.all(l.map((m) => L.etat(m).catch(() => ({ state: 'inconnue' as const }))));
  const src = await lireSources(ctx, l.map((m, k) => ({ id: m.id, nom: m.nom, etat: etats[k].state })), { arche: liens.some((x) => x.genre === 'arche') });
  const out: Record<string, Bilan> = {};
  for (const m of seule ? [seule] : l) out[m.id] = bilanDependants(m, liens, src, dossiersDe(L, m));
  return { machines: out, liens };
}

/** Pour une confirmation (arrêter, mettre en pause) : ce qui dépend de la machine d'après le registre, en une phrase. */
export function quiEnDepend(ctx: ModCtx | undefined, q: unknown): string {
  // Le registre nomme des PC et des conteneurs : sa lecture est au propriétaire seul, la confirmation d'un membre n'en dit rien.
  if (!ctx || agissant()) return '';
  try {
    const L = new Local(ctx), m = trouverExact(L, q), l = liensDe(ctx).filter((x) => x.de === m.id); if (!l.length) return '';
    const noms = l.map((x) => (x.genre === 'machine' ? L.list().find((y) => y.id === x.qui)?.nom ?? '' : `${x.nombre && x.nombre > 0 ? `${x.nombre} ` : ''}${x.qui}`)).filter(Boolean);
    return noms.length ? ` — en dépendent : ${noms.join(', ')}` : '';
  } catch { return ''; }
}

/** La machine nommée exactement (identifiant, nom ou adresse) : jamais une machine « qui ressemble » pour un geste grave. */
export function trouverExact(L: Local, q: unknown): Machine {
  const t = s(q).trim().toLowerCase(), m = L.list().find((x) => x.id === t || x.nom === t || x.ip === t);
  if (!m) throw new Error(`machine introuvable : « ${s(q).trim()} » (donne son nom exact)`);
  return m;
}

/** Retire du registre les lignes d'une machine qui n'existe plus (elle-même, ou comme dépendante). */
export function oublierMachine(ctx: ModCtx, id: string): void {
  const l = liensDe(ctx), garde = l.filter((x) => x.de !== id && !(x.genre === 'machine' && x.qui === id));
  if (garde.length !== l.length) ctx.saveSettings({ dependances: garde });
}

/** Les actions du registre : lire (propriétaire seul), ajouter, retirer (propriétaire seul, notés). */
export function dependancesActions(): Action[] {
  const machine = { key: 'machine', label: 'Machine (nom exact)', kind: 'text' as const, required: true };
  // Lecture au propriétaire seul (elle nomme des PC et des conteneurs) ; pas marquée « read » : le banc figé de Soul
  // photographie les lectures du catalogue. Pas notée dans « qui a fait quoi » (la page la relit souvent).
  const lecture: Action = { id: 'dependants_machines', label: 'Ce qui dépend des machines', what: 'Pour chaque machine de ce PC (ou une seule) : ce qui en dépend (registre, Genèse, Phénix, Arche) et ce qui empêche de la supprimer', quick: false, quiet: true, proprietaireSeul: true,
    params: [{ key: 'machine', label: 'Machine (vide : toutes)', kind: 'text', default: '' }],
    run: async (ctx, i) => {
      const L = new Local(ctx), seule = s(i.machine).trim() ? trouverExact(L, i.machine) : undefined, b = await bilans(ctx, seule);
      const lignes = Object.entries(b.machines).map(([id, x]) => { const nom = L.list().find((m) => m.id === id)?.nom ?? id; return `${nom} : ${x.dependants.length ? x.dependants.map((d) => d.texte).join(' ') : 'rien n\'en dépend.'}${x.bloquants.length ? ` Suppression impossible : ${x.bloquants.join(' ; ')}.` : ''}`; });
      return { text: lignes.join('\n') || 'Aucune machine sur ce PC.', data: b };
    } };
  const gestes: Action[] = [
    { id: 'dependance_ajouter', label: 'Noter une dépendance', what: 'Note dans le registre que quelque chose dépend d\'une machine de ce PC (une autre machine, un conteneur d\'Arche, des PC, autre chose) : la machine ne se supprimera pas tant que ça tourne, et l\'arrêter le dira', quick: false, proprietaireSeul: true,
      params: [machine, { key: 'genre', label: 'Ce qui en dépend', kind: 'select', options: GENRES, default: 'machine' }, { key: 'qui', label: 'Qui (nom de la machine, du conteneur, des PC)', kind: 'text', required: true }, { key: 'nombre', label: 'Combien (des PC)', kind: 'number', default: '' }, { key: 'note', label: 'Note', kind: 'text', default: '' }],
      words: ['note que', 'dépend de la machine', 'dependance machine'],
      run: (ctx, i) => {
        const L = new Local(ctx), m = trouverExact(L, i.machine), genre = s(i.genre || 'machine') as GenreLien;
        if (!GENRES.includes(genre)) throw new Error(`genre inconnu : « ${s(i.genre)} » (${GENRES.join(', ')})`);
        let qui = s(i.qui).trim().replace(/[\u0000-\u001f]/g, '').slice(0, 80);
        if (!qui) throw new Error('dis ce qui en dépend');
        if (genre === 'machine') { const x = trouverExact(L, qui); if (x.id === m.id) throw new Error('une machine ne dépend pas d\'elle-même'); qui = x.id; }
        if (genre === 'arche' && !/^[\w][\w.-]{0,79}$/.test(qui)) throw new Error('nom de conteneur invalide');
        const l = liensDe(ctx); if (l.length >= 500) throw new Error('le registre est plein (500 lignes) : retires-en d\'abord');
        if (l.some((x) => x.de === m.id && x.genre === genre && x.qui === qui)) return { text: 'Déjà noté.', ok: false };
        const n = Number(i.nombre), nombre = genre === 'pc' && Number.isInteger(n) && n > 0 && n < 100000 ? n : undefined, note = s(i.note).trim().slice(0, 160);
        const lien: Lien = { id: randomBytes(6).toString('hex'), de: m.id, genre, qui, ...(nombre ? { nombre } : {}), ...(note ? { note } : {}), at: ctx.now().getTime() };
        ctx.saveSettings({ dependances: [...l, lien] });
        const nomQui = genre === 'machine' ? L.list().find((x) => x.id === qui)?.nom ?? qui : `${nombre ? `${nombre} ` : ''}${qui}`;
        return { text: `🔗 Noté : ${nomQui} ${pluriel(nombre, 'dépend', 'dépendent')} de ${m.nom}.`, data: lien };
      } },
    { id: 'dependance_retirer', label: 'Retirer une dépendance', what: 'Retire une ligne du registre « qui dépend de qui »', quick: false, proprietaireSeul: true,
      params: [{ key: 'lien', label: 'Ligne du registre', kind: 'text', required: true }],
      run: (ctx, i) => {
        const l = liensDe(ctx), x = l.find((y) => y.id === s(i.lien).trim()); if (!x) throw new Error('ligne du registre introuvable');
        if (x.liee) throw new Error('ce lien vient d\'une copie liée : il part tout seul quand la copie est supprimée');
        ctx.saveSettings({ dependances: l.filter((y) => y.id !== x.id) });
        const L = new Local(ctx), de = L.list().find((m) => m.id === x.de)?.nom ?? 'une machine', qui = x.genre === 'machine' ? L.list().find((m) => m.id === x.qui)?.nom ?? 'une machine' : x.qui;
        return { text: `Retiré du registre : ${qui} → ${de}.` };
      } },
  ];
  return [lecture, ...avecJournal('ymir_actes', gestes)];
}
