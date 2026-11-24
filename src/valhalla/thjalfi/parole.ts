// Genèse · par la parole (maquettes validées « Systèmes » et « Clés USB », lots S11 et C8).
// Une phrase dite va à la bonne action, avec le bon système, la bonne clé, les bons PC :
//   - « boot-moi la clé », « installe-moi un système sur la clé » → `cle_dit` : Odin montre la clé vue et PROPOSE les
//     systèmes prêts (le plus récent d'abord, puis « Je choisis moi-même ») ;
//   - « mets Windows 11 sur la clé » → `cle_mettre_dit` : le système est relu contre la bibliothèque, la clé contre les
//     clés branchées ; Odin PRÉPARE l'étape « Vérifier » de la page ;
//   - « ajoute Ubuntu à ma clé » → `cle_ajouter_dit` : un changement EN ATTENTE sur une clé ODIN connue (le geste de « Mes
//     clés » : rien n'est écrit sur la clé ; « Appliquer » se fait dans la page, sans accord « au prochain branchement ») ;
//   - « installe Ubuntu sur les PC qui viennent de démarrer » → `deployer_dit` : le système relu contre la bibliothèque,
//     les PC contre ceux VUS au menu du démarrage réseau ; Odin PRÉPARE l'étape « Vérifier » de Déployer ;
//   - « où en est l'installation » → `travaux_dit` : une carte de suivi (clé, PC, téléchargements), sans secret.
// SÛRETÉ. La parole n'efface et n'écrit JAMAIS : ni disque de PC, ni clé. Effacer des PC demande la phrase tapée ET
// l'appui long de 3 s, écrire une clé demande sa phrase : ces confirmations restent celles de la page, vérifiées côté
// serveur par `deployer` et `cle_preparer`, que ces actions-ci n'appellent pas. Elles ne donnent pas non plus la phrase.
// Un nom dit est relu contre la liste réelle (`relireDit`) : un seul convient, ou Odin demande lequel et rien ne part.
// Un système est relu contre tout ce qu'Odin sait démarrer, prêt ou non (jamais « celui qui est prêt » en silence) ;
// « la clé » ne désigne d'office que la seule clé USB branchée (un disque externe se nomme) ; « … sauf le mien » ne
// prépare rien ; un PC d'identité douteuse (règle de « Déployer ») n'est jamais préparé pour être effacé.
// LA PRÉPARATION (30 minutes) ne garde que des choix — quel système, quels PC, quelle clé (par une empreinte, jamais son
// numéro de série) — jamais la phrase, l'appui ni un accord. `preparation_dite` la rend à la page seulement si elle
// tient encore contre l'état réel (système prêt, PC vus et non bloqués, la même clé) ; la page la reprend une fois
// (`preparation_oublier`) et ouvre « Vérifier » : la confirmation se donne là, à la main.
// Gestes au propriétaire seul (comme toutes les actions de la clé et du déploiement). Leurs réponses portent des noms
// venus du dehors (nom d'un PC pris sur le réseau, modèle d'une clé) : elles sont marquées « external » (une IA les lit
// comme des données, jamais comme un ordre), et ces noms sont ramenés à une ligne bornée, sans caractère invisible.
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { Action, ActionResult, ModCtx } from '../types.ts';
import { ISO } from '../forge/sources.ts';
import { choisissable, type Disque, type Disques } from './disques.ts';
import { cibleAvecExclusion, couperDemande, ditUtile, macsDites, ouListe, pcsRecents, relireDit, resteApresRecents, rienDeNomme, texteNonRelu, type Nommable, type Relu } from './parole-noms.ts';

/** Une proposition de la carte : ce qu'on peut dire (ou toucher) ensuite. */
export interface PropositionDite { label: string; dire?: string; appli?: string; action?: string; input?: Record<string, unknown>; conseille?: boolean }
/** La carte de la conversation : où en est le travail, ce qu'Odin propose, où se fait la suite. Jamais un secret. */
export interface CarteDite {
  titre: string;
  /** à choisir : il manque un choix ; prepare : prêt à vérifier dans la page ; attente : un changement gardé ; cours : un travail avance ; rien */
  etat: 'a-choisir' | 'prepare' | 'attente' | 'cours' | 'rien';
  lignes: string[]; propositions: PropositionDite[];
  /** où se fait la suite (la page d'Odin) */
  ouvrir?: { appli: string; onglet: string; etape?: string };
  /** la lecture à refaire pour suivre le travail dans le fil */
  suivi?: { appli: string; action: string };
}
/**
 * Ce que la parole a préparé pour la page (rien n'est autorisé ni écrit tant que la page n'a pas sa confirmation).
 * Seulement des CHOIX (quel système, quels PC, quelle clé) : jamais la phrase à taper, jamais l'appui long, jamais un
 * accord. La clé est gardée par son identifiant de disque, sa taille, son modèle et une EMPREINTE de son numéro de série
 * (jamais le numéro lui-même) : au moment où la page la reprend, Odin revérifie que c'est encore la même.
 */
export interface PreparationDite {
  sorte: 'reseau' | 'cle'; at: number; expire: number;
  systemes: Array<{ iso: string; nom: string }>;
  pcs?: Array<{ mac: string; nom?: string }>; facon?: 'auto' | 'menu';
  cle?: { id: string; tailleOctets: number; modele: string; empreinte?: string };
}
/** Une préparation dite vaut 30 minutes : au-delà, la page ne la reprend plus. */
export const VALIDITE_PREPARATION = 30 * 60_000;

/** Un système de la bibliothèque, tel que Genèse le voit. */
export interface SystemeDit extends Nommable { id: string; chemin: string; prete: boolean; demarrable: boolean; auto: boolean; windows: boolean; ajoute?: number }
export interface DepsParole {
  /** les images de la bibliothèque (toutes ; `prete` : vérifiée et démarrable) */
  isos: (ctx: ModCtx) => Promise<Array<{ id: string; nom: string; chemin: string; prete: boolean; auto: boolean; windows: boolean; /** Odin sait la démarrer (prête ou pas encore) */ demarrable?: boolean }>>;
  /** une action de Genèse, par son identifiant (les gestes de la page, tels quels) */
  action: (id: string) => Action | undefined;
  /** parmi ces adresses, celles dont l'identité est douteuse (deux appareils différents vus avec la même adresse ces dernières 24 h) */
  douteux?: (ctx: ModCtx, macs: string[]) => string[];
}

const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));
const o = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {});
const GO = 1024 ** 3;
const go = (n: number) => `${Math.max(1, Math.round((Number(n) || 0) / GO))} Go`;
const chemin = (p: string) => resolve(p).replace(/\\/g, '/').toLowerCase();
/** Un texte venu d'un disque, d'un PC ou d'un fichier : une ligne, sans caractère invisible, borné. */
const propre = (x: unknown, max = 60) => s(x).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]+/gu, ' ').trim().slice(0, max).trim();

/** La carte dite en texte (ce que la conversation montre). Pur. */
export function texteCarte(c: CarteDite): string {
  const props = c.propositions.map((p) => `- ${p.label}${p.dire ? ` : « ${p.dire} »` : ''}${p.conseille ? ' (conseillé)' : ''}`);
  return [c.titre, ...c.lignes, ...(props.length ? ['Tu peux dire :', ...props] : [])].filter(Boolean).join('\n');
}
const rendre = (c: CarteDite, ok = true, plus: Record<string, unknown> = {}): ActionResult => ({ ok, text: texteCarte(c), data: { carte: c, ...plus } });

/** Les textes fixes (un seul endroit : les essais les relisent). */
export const TEXTES_PAROLE = {
  jamais: 'Rien n\'est effacé ni écrit par la parole : la confirmation se donne dans la page.',
  verifierPcs: 'Ouvre Genèse → Déployer → Vérifier : la phrase à taper et l\'appui long de 3 s se donnent là.',
  verifierCle: 'Ouvre Genèse → Clés USB → Déployer → Vérifier : la phrase à taper se donne là.',
  appliquer: 'Pour l\'écrire sur la clé : Genèse → Clés USB → Mes clés → Appliquer (clé branchée). Rien d\'autre n\'est effacé.',
  moiMeme: 'Je choisis moi-même',
  systemesSeulement: 'Genèse met des systèmes (Windows, Linux, outils de démarrage) sur une clé ou sur des PC : pour copier des fichiers ou installer un logiciel, c\'est une autre demande.',
  exclusion: 'La parole ne sait pas retirer un PC d\'un lot : choisis-les dans la page (Genèse → Déployer → Postes), ou dis un PC par son nom.',
  changee: 'Ce que la parole avait préparé ne tient plus',
};

export function paroleGenese(deps: DepsParole): { actions: Action[] } {
  const lancer = async (ctx: ModCtx, id: string, input: Record<string, unknown> = {}): Promise<ActionResult> => {
    const a = deps.action(id); if (!a) return { ok: false, text: `action ${id} absente` };
    try { return await a.run(ctx, input); } catch (e) { return { ok: false, text: (e as Error).message }; }
  };

  /** La bibliothèque réelle, avec le nom que chaque système porte (« Windows 11 », « Ubuntu Server 24.04.3 ») quand Hydre le connaît. */
  async function systemes(ctx: ModCtx): Promise<SystemeDit[]> {
    const l = await deps.isos(ctx).catch(() => []);
    let fiches: Array<Record<string, unknown>> = [];
    try { const r = await ctx.call('ymir', 'bibliotheque_iso', {}, 'relire un système dit', { interne: true }); if (r.ok !== false) fiches = (o(r.data).isos as Array<Record<string, unknown>> | undefined) ?? []; } catch { /* sans Hydre : les noms des fichiers suffisent */ }
    const par = new Map<string, Record<string, unknown>>();
    for (const f of Array.isArray(fiches) ? fiches : []) if (f && typeof f.chemin === 'string') par.set(chemin(f.chemin), f);
    const out: SystemeDit[] = [];
    for (const i of l) {
      const f = par.get(chemin(i.chemin));
      if (f?.ancienne === true) continue;
      const detail = propre(f?.detail, 80), dist = propre(f?.distribution, 60), version = propre(f?.version, 30);
      out.push({ id: i.id, chemin: i.chemin, prete: i.prete, demarrable: i.prete || i.demarrable === true, auto: i.auto, windows: i.windows, nom: detail || propre(i.nom, 80), autres: [i.nom, dist, dist && version ? `${dist} ${version}` : ''].filter(Boolean), ...(version ? { version } : {}), ...(Number(f?.ajoute) ? { ajoute: Number(f!.ajoute) } : {}) });
    }
    return out;
  }
  /** Le catalogue d'Andromède (ce qu'Odin sait télécharger) : pour PROPOSER un téléchargement, jamais pour le lancer. */
  const catalogue = (): Array<Nommable & { id: string }> => ISO.map((x) => ({ id: x.id, nom: x.name, autres: [x.id] }));

  /**
   * Le système dit, relu contre la bibliothèque : prêt, c'est lui ; sinon la carte qui dit pourquoi (plusieurs, pas prêt,
   * absent mais au catalogue : téléchargement proposé), et rien ne part.
   */
  async function systemeRelu(ctx: ModCtx, dit: string, titre: string, redire: (nom: string) => string): Promise<{ x: SystemeDit } | { carte: CarteDite }> {
    const tous = await systemes(ctx), prets = tous.filter((x) => x.prete);
    const carte = (lignes: string[], propositions: PropositionDite[] = []): { carte: CarteDite } => ({ carte: { titre, etat: 'a-choisir', lignes, propositions, ouvrir: { appli: 'thjalfi', onglet: 'systemes' } } });
    const pasPret = (c: SystemeDit) => `« ${c.nom} » est dans ta bibliothèque, mais pas encore prêt (vérification ou antivirus en cours). Rien n'est fait : redis-le quand il est prêt.`;
    // Relu contre tout ce qu'Odin sait démarrer, PRÊT OU NON : « Ubuntu » dit alors qu'un autre Ubuntu vient d'arriver (pas
    // encore vérifié) ne désigne pas « celui qui est prêt » en silence — Odin demande lequel, et dit lequel n'est pas prêt.
    const r = relireDit(dit, tous.filter((x) => x.demarrable));
    if (r.ok) return r.x.prete ? { x: r.x } : carte([pasPret(r.x)]);
    if (r.raison === 'plusieurs') {
      const attente = r.choix.filter((c) => !c.prete).map((c) => `« ${c.nom} »`);
      return carte([`${texteNonRelu(r, 'système', 'dans ta bibliothèque')}${attente.length ? ` (Pas encore prêt : ${attente.join(', ')}.)` : ''}`], r.choix.filter((c) => c.prete).map((c) => ({ label: c.nom, dire: redire(c.nom) })));
    }
    // Dans la bibliothèque, mais Odin ne sait pas (ou pas encore) le démarrer : dit tel quel.
    const pasPrets = relireDit(dit, tous.filter((x) => !x.demarrable));
    if (pasPrets.ok) return carte([pasPret(pasPrets.x)]);
    // Proche d'un système PRÊT (« Windows 10 » quand il y a « Windows 11 ») : dit, sans choisir.
    const rp = r.raison === 'proche' ? relireDit(dit, prets) : r;
    if (!rp.ok && rp.raison === 'proche') return carte([texteNonRelu(rp, 'système', 'dans ta bibliothèque')], rp.choix.map((c) => ({ label: c.nom, dire: redire(c.nom) })));
    // Absent : le catalogue d'Andromède le connaît peut-être. Odin PROPOSE le téléchargement (avec son accord habituel).
    const cat = relireDit(dit, catalogue());
    const dl = (c: Nommable & { id: string }): PropositionDite => ({ label: `Télécharger ${c.nom}`, dire: `télécharge ${c.nom}`, appli: 'eitri', action: 'telecharger', input: { nom: c.id } });
    if (cat.ok) return carte([`« ${r.dit} » n'est pas dans ta bibliothèque. Andromède sait le télécharger : ${cat.x.nom}. Rien n'est fait.`], [dl(cat.x)]);
    if (cat.raison === 'plusieurs' || cat.raison === 'proche') return carte([`« ${r.dit} » n'est pas dans ta bibliothèque. Le catalogue d'Andromède a ${ouListe(cat.choix.map((c) => `« ${c.nom} »`))}. Lequel ? Rien n'est fait.`], cat.choix.map(dl));
    const connus = prets.slice(0, 8).map((c) => c.nom);
    return carte([`${texteNonRelu(r, 'système', 'dans ta bibliothèque')}${connus.length ? ` Prêts : ${connus.join(', ')}.` : ' Aucun système n\'est prêt : télécharge-en un depuis Genèse → Systèmes.'}`, TEXTES_PAROLE.systemesSeulement], prets.slice(0, 6).map((c) => ({ label: c.nom, dire: redire(c.nom) })));
  }

  /** Les clés branchées qui peuvent devenir (ou sont) une clé ODIN : jamais un disque interne. */
  async function clesBranchees(ctx: ModCtx): Promise<{ lu: boolean; cles: Disque[] }> {
    const r = await lancer(ctx, 'cle_disques');
    if (r.ok === false) return { lu: false, cles: [] };
    const d = o(r.data) as unknown as Partial<Disques>;
    return { lu: true, cles: (Array.isArray(d.externes) ? d.externes : []).filter((x) => choisissable(x)) };
  }
  const nomDeCle = (d: Disque) => propre(d.modele, 60) || 'Clé USB';
  /** Ce que c'est vraiment : une clé, une carte mémoire, ou un disque externe (dit tel quel, jamais « la clé » d'office). */
  const estCle = (d: Disque) => d.genre === 'cle';
  const vu = (d: Disque) => (estCle(d) ? 'Clé vue' : d.genre === 'carte' ? 'Carte mémoire vue (ce n\'est pas une clé USB)' : 'Disque externe vu (ce n\'est pas une clé USB)');
  const ligneCle = (d: Disque) => `${vu(d)} : ${nomDeCle(d)} · ${go(d.tailleOctets)}${d.estOdin ? ' · déjà une clé ODIN' : ' · ce qui est dessus sera effacé, seulement après la phrase tapée dans la page'}`;
  /** L'empreinte d'une clé : son numéro de série, sa taille et son modèle, hachés (le numéro ne sort jamais d'ici). */
  const empreinteCle = (d: Pick<Disque, 'serie' | 'tailleOctets' | 'modele'>) => createHash('sha256').update(`odin-cle-dite\n${s(d.serie)}\n${Number(d.tailleOctets) || 0}\n${s(d.modele)}`).digest('hex').slice(0, 32);
  const nommerCles = (l: Disque[]) => l.map((d) => ({ d, nom: `${nomDeCle(d)} ${go(d.tailleOctets)}`, autres: [nomDeCle(d), go(d.tailleOctets), go(d.tailleOctets).replace(' ', '')] }));

  const garder = (ctx: ModCtx, p: Omit<PreparationDite, 'at' | 'expire'>): PreparationDite => {
    const at = ctx.now().getTime(), x: PreparationDite = { ...p, at, expire: at + VALIDITE_PREPARATION };
    ctx.saveSettings({ preparationDite: x });
    return x;
  };
  const preparation = (ctx: ModCtx): PreparationDite | undefined => {
    const p = o(ctx.settings.preparationDite) as unknown as Partial<PreparationDite>;
    const now = ctx.now().getTime();
    // Périmée, ou datée du futur (horloge reculée, fichier retouché) : jamais reprise.
    if ((p.sorte !== 'reseau' && p.sorte !== 'cle') || !Array.isArray(p.systemes) || !(Number(p.expire) > now) || !(Number(p.at) <= now + 60_000) || Number(p.expire) - Number(p.at) > VALIDITE_PREPARATION) return undefined;
    return p as PreparationDite;
  };
  /**
   * La préparation telle que la page peut la reprendre MAINTENANT : relue contre l'état réel (le système est toujours
   * prêt, chaque PC est toujours vu, ni bloqué ni d'identité douteuse, la clé est toujours branchée et c'est la même).
   * Un seul écart : rien n'est rendu, avec la raison — jamais une préparation à moitié, jamais un PC ou une clé que le
   * propriétaire n'a pas vus dans la carte. Ce qui est rendu ne porte ni numéro de série, ni empreinte, ni phrase.
   */
  async function preparationRelue(ctx: ModCtx): Promise<{ p?: PreparationDite; raison?: string }> {
    const p = preparation(ctx); if (!p) return {};
    const non = (raison: string) => ({ raison: `${TEXTES_PAROLE.changee} : ${raison} Redis-le, ou choisis dans la page.` });
    const tous = await systemes(ctx), sys: Array<{ iso: string; nom: string }> = [];
    for (const x of p.systemes.slice(0, 20)) {
      const t = tous.find((y) => y.id === s(o(x).iso));
      if (!t || !t.prete) return non(`« ${propre(o(x).nom, 80) || 'le système'} » n'est plus prêt dans ta bibliothèque.`);
      sys.push({ iso: t.id, nom: t.nom });
    }
    if (!sys.length) return non('aucun système.');
    if (p.sorte === 'cle') {
      const c = o(p.cle), { lu, cles } = await clesBranchees(ctx);
      if (!lu) return non('Odin n\'arrive pas à lire la liste des disques.');
      const d = cles.find((x) => x.id === s(c.id));
      if (!d || typeof c.empreinte !== 'string' || empreinteCle(d) !== c.empreinte) return non('la clé n\'est plus branchée, ou ce n\'est plus la même.');
      return { p: { sorte: 'cle', at: p.at, expire: p.expire, systemes: sys, cle: { id: d.id, tailleOctets: d.tailleOctets, modele: nomDeCle(d) } } };
    }
    const r0 = await lancer(ctx, 'postes_vus');
    if (r0.ok === false) return non('Odin n\'arrive pas à lire les PC vus.');
    const postes = ((o(r0.data).postes as Array<{ mac: string; bloque: boolean }> | undefined) ?? []).filter((x) => x && typeof x.mac === 'string');
    const pcs = (Array.isArray(p.pcs) ? p.pcs : []).slice(0, 50).map((x) => s(o(x).mac)).filter(Boolean);
    if (!pcs.length || pcs.length !== (p.pcs ?? []).length) return non('la liste des PC est illisible.');
    for (const mac of pcs) { const v = postes.find((x) => x.mac === mac); if (!v || v.bloque) return non(`le PC ${mac} ${v ? 'est bloqué' : 'n\'est plus connu du démarrage réseau'}.`); }
    const facon = p.facon === 'menu' ? 'menu' : 'auto';
    if (facon === 'auto') { const d = deps.douteux ? deps.douteux(ctx, pcs) : []; if (d.length) return non(`deux appareils différents ont démarré avec l'adresse ${d[0]} ces dernières 24 h.`); }
    return { p: { sorte: 'reseau', at: p.at, expire: p.expire, systemes: sys, pcs: pcs.map((mac) => ({ mac })), facon } };
  }

  /** « boot-moi la clé » : la clé vue, et ce qu'Odin propose d'y mettre. Rien n'est préparé, rien n'est écrit. */
  async function cleDit(ctx: ModCtx): Promise<ActionResult> {
    const titre = 'Clé USB de démarrage';
    const { lu, cles } = await clesBranchees(ctx);
    if (!lu) return rendre({ titre, etat: 'rien', lignes: ['Odin n\'arrive pas à lire la liste des disques. Rien n\'est fait.'], propositions: [], ouvrir: { appli: 'thjalfi', onglet: 'cle', etape: 'cle' } }, false);
    if (!cles.length) return rendre({ titre, etat: 'a-choisir', lignes: ['Aucune clé USB vue. Branche-la, puis redis-le. (Un disque interne n\'est jamais proposé.)'], propositions: [{ label: 'La clé est branchée', dire: 'boot-moi la clé' }], ouvrir: { appli: 'thjalfi', onglet: 'cle', etape: 'cle' } });
    const prets = (await systemes(ctx)).filter((x) => x.prete).sort((a, b) => (b.ajoute ?? 0) - (a.ajoute ?? 0) || a.nom.localeCompare(b.nom));
    // Une seule vraie clé : « la clé » suffit. Un disque externe ou une carte : son nom est dit (jamais « la clé » d'office).
    const surQuoi = cles.length === 1 ? (estCle(cles[0]) ? 'la clé' : `la clé ${nomDeCle(cles[0])}`) : 'la clé (dis laquelle)';
    const propositions: PropositionDite[] = prets.slice(0, 5).map((x, k) => ({ label: x.nom, dire: `mets ${x.nom} sur ${surQuoi}`, ...(k === 0 ? { conseille: true } : {}) }));
    propositions.push({ label: TEXTES_PAROLE.moiMeme, appli: 'thjalfi', action: 'cle_disques', input: {} });
    const lignes = [...cles.slice(0, 6).map(ligneCle), ...(cles.length > 1 ? ['Plusieurs clés sont branchées : dis laquelle (son nom ou sa taille).'] : []),
      prets.length ? 'Quel système veux-tu y mettre ?' : 'Aucun système n\'est prêt dans ta bibliothèque : télécharge-en un (« télécharge la dernière Debian »), puis redis-le.', TEXTES_PAROLE.jamais];
    return rendre({ titre, etat: 'a-choisir', lignes, propositions, ouvrir: { appli: 'thjalfi', onglet: 'cle', etape: 'cle' } });
  }

  /** « mets Windows 11 sur la clé » : système et clé relus, puis l'étape « Vérifier » de la page est préparée. */
  async function cleMettreDit(ctx: ModCtx, i: Record<string, unknown>): Promise<ActionResult> {
    const titre = 'Clé USB de démarrage', c = couperDemande(i.demande, 'cle');
    if (rienDeNomme(c.systeme)) return cleDit(ctx);
    const { lu, cles } = await clesBranchees(ctx);
    if (!lu) return rendre({ titre, etat: 'rien', lignes: ['Odin n\'arrive pas à lire la liste des disques. Rien n\'est fait.'], propositions: [] }, false);
    const sys = await systemeRelu(ctx, c.systeme, titre, (n) => `mets ${n} sur la clé`);
    if ('carte' in sys) return rendre(sys.carte, false);
    if (!cles.length) return rendre({ titre, etat: 'a-choisir', lignes: [`${sys.x.nom} est prêt. Aucune clé USB vue : branche-la, puis redis-le. Rien n'est fait.`], propositions: [{ label: 'La clé est branchée', dire: `mets ${sys.x.nom} sur la clé` }], ouvrir: { appli: 'thjalfi', onglet: 'cle', etape: 'cle' } }, false);
    let d = cles[0];
    // « la clé » ne désigne d'office que la SEULE clé USB branchée. Plusieurs, ou un disque externe / une carte mémoire
    // (un disque de sauvegarde n'est pas « la clé ») : Odin demande, et rien n'est préparé tant qu'elle n'est pas nommée.
    if (cles.length > 1 || !estCle(d) || ditUtile(c.cible)) {
      const noms = nommerCles(cles), r: Relu<(typeof noms)[number]> = ditUtile(c.cible) ? relireDit(c.cible, noms) : { ok: false, raison: 'plusieurs', choix: noms, dit: 'la clé' };
      if (!r.ok) return rendre({ titre, etat: 'a-choisir', lignes: [...cles.slice(0, 6).map(ligneCle), r.raison === 'plusieurs' && !ditUtile(c.cible) ? (cles.length > 1 ? 'Plusieurs clés sont branchées. Laquelle ? Rien n\'est fait.' : 'Ce n\'est pas une clé USB. Si c\'est bien là que tu veux écrire, dis son nom. Rien n\'est fait.') : texteNonRelu(r, 'clé', 'parmi les clés branchées')], propositions: noms.slice(0, 6).map((n) => ({ label: n.nom, dire: `mets ${sys.x.nom} sur la clé ${n.nom}` })), ouvrir: { appli: 'thjalfi', onglet: 'cle', etape: 'cle' } }, false);
      d = r.x.d;
    }
    const p = garder(ctx, { sorte: 'cle', systemes: [{ iso: sys.x.id, nom: sys.x.nom }], cle: { id: d.id, tailleOctets: d.tailleOctets, modele: nomDeCle(d), empreinte: empreinteCle(d) } });
    const lignes = [`Prêt à vérifier : ${sys.x.nom} sur ${nomDeCle(d)} (${go(d.tailleOctets)}).`, ligneCle(d), ...(d.estOdin ? ['Pour l\'ajouter sans rien effacer : « ajoute ' + sys.x.nom + ' à ma clé ».'] : []), 'Rien n\'est écrit sur la clé.', TEXTES_PAROLE.verifierCle];
    return rendre({ titre, etat: 'prepare', lignes, propositions: [...(d.estOdin ? [{ label: 'L\'ajouter sans effacer', dire: `ajoute ${sys.x.nom} à ma clé` }] : []), { label: TEXTES_PAROLE.moiMeme, appli: 'thjalfi', action: 'cle_disques', input: {} }], ouvrir: { appli: 'thjalfi', onglet: 'cle', etape: 'verifier' }, suivi: { appli: 'thjalfi', action: 'travaux_dit' } }, true, { preparation: { sorte: p.sorte, at: p.at, expire: p.expire, systemes: p.systemes, cle: { id: d.id, tailleOctets: d.tailleOctets, modele: nomDeCle(d) } } });
  }

  /** « ajoute Ubuntu à ma clé » : un changement en attente sur une clé ODIN connue (le geste de « Mes clés »). */
  async function cleAjouterDit(ctx: ModCtx, i: Record<string, unknown>): Promise<ActionResult> {
    const titre = 'Mes clés', c = couperDemande(i.demande, 'cle'), ouvrir = { appli: 'thjalfi', onglet: 'cle', etape: 'mes-cles' };
    const r0 = await lancer(ctx, 'cle_mes_cles');
    if (r0.ok === false) return rendre({ titre, etat: 'rien', lignes: [`Odin n'arrive pas à lire ses clés (${propre(r0.text, 120)}). Rien n'est fait.`], propositions: [] }, false);
    const connues = ((o(r0.data).cles as Array<Record<string, unknown>> | undefined) ?? []).filter((x) => x && x.etat === 'connue' && typeof x.id === 'string');
    if (!connues.length) return rendre({ titre, etat: 'a-choisir', lignes: ['Odin ne connaît encore aucune clé ODIN : il n\'ajoute rien à une clé qu\'il n\'a pas faite. Rien n\'est fait.'], propositions: [{ label: 'Préparer une clé', dire: 'boot-moi la clé' }], ouvrir }, false);
    const noms = connues.map((x) => ({ x, nom: propre(x.nom, 60) || 'Clé ODIN', autres: [propre(x.modele, 60), go(Number(x.tailleOctets)), go(Number(x.tailleOctets)).replace(' ', '')].filter(Boolean) }));
    let cle = noms[0];
    if (noms.length > 1 || ditUtile(c.cible)) {
      const r: Relu<(typeof noms)[number]> = ditUtile(c.cible) ? relireDit(c.cible, noms) : { ok: false, raison: 'plusieurs', choix: noms, dit: 'ma clé' };
      if (!r.ok) return rendre({ titre, etat: 'a-choisir', lignes: [r.raison === 'plusieurs' && !ditUtile(c.cible) ? `Odin connaît ${noms.length} clés : ${ouListe(noms.slice(0, 6).map((n) => `« ${n.nom} »`))}. Laquelle ? Rien n'est fait.` : texteNonRelu(r, 'clé', 'parmi tes clés ODIN')], propositions: noms.slice(0, 6).map((n) => ({ label: n.nom, dire: `ajoute ${rienDeNomme(c.systeme) ? 'un système' : c.systeme} à ma clé ${n.nom}` })), ouvrir }, false);
      cle = r.x;
    }
    if (rienDeNomme(c.systeme)) {
      const prets = (await systemes(ctx)).filter((x) => x.prete);
      return rendre({ titre, etat: 'a-choisir', lignes: [`Quel système ajouter à « ${cle.nom} » ? Rien n'est fait.`], propositions: prets.slice(0, 6).map((x) => ({ label: x.nom, dire: `ajoute ${x.nom} à ma clé` })), ouvrir }, false);
    }
    const sys = await systemeRelu(ctx, c.systeme, titre, (n) => `ajoute ${n} à ma clé`);
    if ('carte' in sys) return rendre(sys.carte, false);
    // Les changements déjà en attente sont gardés ; l'accord « au prochain branchement » n'est jamais donné par la parole.
    const a = o(cle.x.attente);
    const liste = (k: string) => (Array.isArray(a[k]) ? a[k] as Array<Record<string, unknown>> : []);
    const attente = { ...(Array.isArray(a.ordre) ? { ordre: a.ordre } : {}), ...(typeof a.defaut === 'string' ? { defaut: a.defaut } : {}), retirer: Array.isArray(a.retirer) ? a.retirer : [],
      ajouter: [...liste('ajouter').map((x) => ({ iso: x.iso, nom: x.nom })), { iso: sys.x.id, nom: sys.x.nom }], remplacer: liste('remplacer').map((x) => ({ ancien: x.ancien, iso: x.iso, nom: x.nom })), ...(a.menu === true ? { menu: true } : {}) };
    const r = await lancer(ctx, 'cle_changer', { cle: s(cle.x.id), attente, armer: false });
    if (r.ok === false) return rendre({ titre, etat: 'rien', lignes: [propre(r.text, 300)], propositions: [], ouvrir }, false);
    // L'accord « au prochain branchement » donné avant ne vaut plus (les changements ne sont plus les mêmes) : dit en clair.
    const desarme = a.arme === true ? ['L\'accord « au prochain branchement » que tu avais donné est retiré : les changements ne sont plus les mêmes. Tu appuieras sur « Appliquer ».'] : [];
    return rendre({ titre, etat: 'attente', lignes: [`${sys.x.nom} sera ajouté à « ${cle.nom} ».`, propre(r.text, 300), ...desarme, TEXTES_PAROLE.appliquer], propositions: [], ouvrir, suivi: { appli: 'thjalfi', action: 'travaux_dit' } }, true, { cle: s(cle.x.id), changements: o(r.data).changements ?? null });
  }

  /** « installe Ubuntu sur les PC qui viennent de démarrer » : système et PC relus, puis « Vérifier » est préparé. */
  async function deployerDit(ctx: ModCtx, i: Record<string, unknown>): Promise<ActionResult> {
    const titre = 'Déployer par le réseau', c = couperDemande(i.demande, 'pcs'), ouvrir = { appli: 'thjalfi', onglet: 'deployer', etape: 'postes' };
    const redire = (n: string) => `installe ${n} sur les PC qui viennent de démarrer`;
    if (rienDeNomme(c.systeme)) {
      const prets = (await systemes(ctx)).filter((x) => x.prete);
      return rendre({ titre, etat: 'a-choisir', lignes: ['Quel système installer ? Rien n\'est fait.'], propositions: prets.slice(0, 6).map((x) => ({ label: x.nom, dire: redire(x.nom) })), ouvrir: { appli: 'thjalfi', onglet: 'deployer', etape: 'systeme' } }, false);
    }
    const sys = await systemeRelu(ctx, c.systeme, titre, redire);
    if ('carte' in sys) return rendre(sys.carte, false);
    const r0 = await lancer(ctx, 'postes_vus');
    if (r0.ok === false) return rendre({ titre, etat: 'rien', lignes: [`Odin n'arrive pas à lire les PC vus (${propre(r0.text, 120)}). Rien n'est fait.`], propositions: [] }, false);
    type Poste = { mac: string; nom?: string; marque?: string; modele?: string; auMenu: boolean; bloque: boolean };
    const postes = ((o(r0.data).postes as Poste[] | undefined) ?? []).filter((p) => p && typeof p.mac === 'string'), allume = o(r0.data).allume === true;
    const auMenu = postes.filter((p) => p.auMenu && !p.bloque);
    const lignePc = (p: Poste) => `- ${propre(p.nom, 63) || 'PC sans nom'} · ${p.mac}${p.marque || p.modele ? ` · ${[propre(p.marque, 40), propre(p.modele, 40)].filter(Boolean).join(' ')}` : ''}`;
    const attendre = (lignes: string[], propositions: PropositionDite[] = []) => rendre({ titre, etat: 'a-choisir', lignes: [...lignes, 'Rien n\'est autorisé, rien n\'est effacé.'], propositions, ouvrir }, false);
    // « … sauf le mien », « except pc-02 » : la parole ne retire pas un PC d'un lot. Rien n'est préparé (jamais « tous »).
    if (cibleAvecExclusion(c.cible)) return attendre([`Tu en retires un (« ${propre(c.cible, 80)} »). ${TEXTES_PAROLE.exclusion}`]);
    // « installe » veut dire effacer et installer : seulement pour un système qui s'installe tout seul ; sinon il est proposé au menu.
    const facon: 'auto' | 'menu' = sys.x.auto ? 'auto' : 'menu';
    // Quels PC ? Ceux qui viennent de démarrer (au menu en ce moment), une adresse écrite, ou un nom dit — relus contre les PC VUS.
    let choisis: Poste[], ecartes: Poste[] = [];
    const macs = macsDites(c.cible);
    if (macs.length) {
      const inconnus = macs.filter((m) => !postes.some((p) => p.mac === m));
      if (inconnus.length) return attendre([`Odin n'a jamais vu au démarrage réseau : ${inconnus.join(', ')}.`]);
      choisis = postes.filter((p) => macs.includes(p.mac));
      const b = choisis.filter((p) => p.bloque);
      if (b.length) return attendre([`Bloqué dans Genèse : ${b.map((p) => p.mac).join(', ')}. Débloque-le d'abord.`]);
    } else if (!ditUtile(c.cible) || pcsRecents(c.cible)) {
      // « … les PC du salon qui viennent de démarrer » : une précision en plus n'est pas ignorée (jamais « tous » à sa place).
      const enPlus = resteApresRecents(c.cible);
      if (enPlus) return attendre([`Je n'ai pas compris « ${propre(enPlus, 60)} ». La parole prend tous les PC au menu (« les PC qui viennent de démarrer ») ou un PC par son nom ; pour un autre choix : Genèse → Déployer → Postes.`]);
      if (!auMenu.length) return attendre([allume ? 'Aucun PC n\'attend au menu du démarrage réseau en ce moment : démarre-les par le réseau (F12, F11 ou Échap), puis redis-le.' : 'Genèse est éteint : aucun PC ne peut être vu. Allume le démarrage réseau (« allume le pxe »), démarre les PC par le réseau, puis redis-le.'],
        [{ label: 'Les PC ont démarré', dire: redire(sys.x.nom) }]);
      choisis = auMenu;
    } else {
      const noms = postes.filter((p) => !p.bloque && propre(p.nom, 63)).map((p) => ({ p, nom: propre(p.nom, 63), autres: [p.mac] }));
      const r = relireDit(c.cible, noms);
      if (!r.ok) return attendre([texteNonRelu(r, 'PC', 'parmi les PC vus au démarrage réseau'), ...(auMenu.length ? ['Au menu en ce moment :', ...auMenu.slice(0, 8).map(lignePc)] : [])], auMenu.length ? [{ label: `Les ${auMenu.length} PC au menu`, dire: redire(sys.x.nom) }] : []);
      choisis = [r.x.p];
    }
    if (choisis.length > 50) return attendre([`${choisis.length} PC d'un coup : c'est plus que 50. Choisis-les dans la page.`]);
    // Effacer : un PC d'identité douteuse (deux appareils différents vus avec la même adresse ces dernières 24 h — une
    // adresse se recopie) n'est jamais préparé par la parole. Dit par son nom ou son adresse : refusé ; pris dans « ceux
    // qui viennent de démarrer » : laissé de côté, et dit.
    if (facon === 'auto' && deps.douteux) {
      const d = new Set(deps.douteux(ctx, choisis.map((x) => x.mac)));
      if (d.size) {
        const raison = 'deux appareils différents ont démarré avec cette adresse ces dernières 24 h (l\'un recopie peut-être l\'adresse de l\'autre)';
        ecartes = choisis.filter((x) => d.has(x.mac)); choisis = choisis.filter((x) => !d.has(x.mac));
        if (!choisis.length || macs.length || !(!ditUtile(c.cible) || pcsRecents(c.cible))) return attendre([`Identité douteuse pour ${ecartes.map((x) => x.mac).join(', ')} : ${raison}. Vérifie ce PC (son étiquette), puis passe par la page (Genèse → Déployer).`]);
      }
    }
    if (sys.x.windows && facon === 'menu') return attendre([`${sys.x.nom} ne s'installe pas tout seul par le réseau ici (règle d'abord le partage Windows dans Genèse).`]);
    const p = garder(ctx, { sorte: 'reseau', systemes: [{ iso: sys.x.id, nom: sys.x.nom }], pcs: choisis.map((x) => ({ mac: x.mac, ...(propre(x.nom, 63) ? { nom: propre(x.nom, 63) } : {}) })), facon });
    const n = choisis.length;
    const lignes = [`Prêt à vérifier : ${sys.x.nom} sur ${n} PC${facon === 'auto' ? ' (effacer et installer)' : ' (proposé au menu, sans rien effacer : ce système ne s\'installe pas tout seul)'}.`, ...choisis.slice(0, 12).map(lignePc), ...(n > 12 ? [`… et ${n - 12} autre(s)`] : []),
      ...(ecartes.length ? [`Laissé de côté (identité douteuse : deux appareils différents avec la même adresse ces dernières 24 h) : ${ecartes.slice(0, 6).map((x) => x.mac).join(', ')}.`] : []),
      'Rien n\'est autorisé, rien n\'est effacé.', TEXTES_PAROLE.verifierPcs, TEXTES_PAROLE.jamais];
    return rendre({ titre, etat: 'prepare', lignes, propositions: [{ label: TEXTES_PAROLE.moiMeme, appli: 'thjalfi', action: 'postes_vus', input: {} }], ouvrir: { appli: 'thjalfi', onglet: 'deployer', etape: 'verifier' }, suivi: { appli: 'thjalfi', action: 'travaux_dit' } }, true, { preparation: p });
  }

  /** « où en est l'installation » : la carte de suivi (clé en écriture, changements de clé, PC, téléchargements). Sans secret. */
  async function travauxDit(ctx: ModCtx): Promise<ActionResult> {
    const lignes: string[] = []; let cours = false;
    const prep = preparation(ctx);
    if (prep) lignes.push(`Préparé par la parole, à vérifier dans la page : ${prep.systemes.map((x) => propre(x.nom, 80)).join(', ')} ${prep.sorte === 'cle' ? `sur la clé ${propre(prep.cle?.modele, 60)}` : `sur ${prep.pcs?.length ?? 0} PC`} (rien n'est fait tant que tu n'as pas confirmé là-bas).`);
    // La clé en cours d'écriture (lot C4), puis les travaux de « Mes clés » (lot C5).
    const { cles } = await clesBranchees(ctx);
    for (const d of cles.slice(0, 8)) {
      const r = await lancer(ctx, 'cle_progres', { cible: { id: d.id } }), e = o(r.data);
      if (r.ok === false || e.aucune === true) continue;
      if (e.fini !== true) cours = true;
      lignes.push(`Clé ${nomDeCle(d)} : ${e.fini === true ? (e.reussi === true ? 'écriture finie' : `écriture arrêtée (${propre(e.message, 160)})`) : `${Number(e.pct) || 0} % · ${propre(e.etape, 80)}`}`);
    }
    const mc = await lancer(ctx, 'cle_mes_cles');
    for (const k of (mc.ok === false ? [] : (o(mc.data).cles as Array<Record<string, unknown>> | undefined) ?? []).filter((x) => x && x.etat === 'connue').slice(0, 12)) {
      const t = o(k.travail), n = Number(k.changements) || 0;
      if (k.travail && t.fini !== true) { cours = true; lignes.push(`Clé « ${propre(k.nom, 60)} » : ${propre(t.etape, 80) || 'en cours'} (${Number(t.fait) || 0}/${Number(t.total) || 1})`); }
      else if (n) lignes.push(`Clé « ${propre(k.nom, 60)} » : ${n} changement(s) en attente${k.branchee === true ? ' (clé branchée : « Appliquer » dans Mes clés)' : ' (clé pas branchée)'}`);
    }
    // Les PC en déploiement (lot S7).
    const ds = await lancer(ctx, 'deploiement_suivi');
    const lot = ((o(ds.data).lots as Array<Record<string, unknown>> | undefined) ?? [])[0];
    if (ds.ok !== false && lot) { if (lot.fini !== true) cours = true; lignes.push(`PC : ${propre(ds.text, 300)}`); }
    // Les téléchargements d'Andromède (un à la fois, puis la file).
    try {
      const f = await ctx.call('eitri', 'file', {}, 'le suivi dit', { interne: true }), e = o(o(f.data).enCours), file = (o(f.data).file as unknown[] | undefined) ?? [];
      if (f.ok !== false && (e.nom || file.length)) { cours = cours || Boolean(e.nom); lignes.push(`Téléchargements : ${e.nom ? `${propre(e.nom, 80)} ${propre(e.version, 30)}${e.pct !== undefined ? ` (${Number(e.pct) || 0} %)` : ''}` : 'rien en cours'}${file.length ? ` · ${file.length} en attente` : ''}`); }
    } catch { /* sans Andromède : rien à dire */ }
    const c: CarteDite = { titre: 'Où en est le travail', etat: cours ? 'cours' : lignes.length ? 'attente' : 'rien', lignes: lignes.length ? lignes : ['Aucun travail en cours : ni clé, ni PC, ni téléchargement.'], propositions: [], suivi: { appli: 'thjalfi', action: 'travaux_dit' } };
    return rendre(c);
  }

  const DEMANDE = (label: string) => [{ key: 'demande', label, kind: 'text' as const, required: true }];
  const actions: Action[] = [
    { id: 'cle_dit', label: 'Clé USB : préparer une clé (dit)', read: true, quick: false, proprietaireSeul: true, quiet: true, external: true,
      what: 'Montre la clé USB vue et propose les systèmes prêts à y mettre ; rien n\'est écrit, la suite se fait dans la page',
      words: MOTS_PAROLE.cle, run: (ctx) => cleDit(ctx) },
    { id: 'cle_mettre_dit', label: 'Clé USB : mettre sur la clé (dit)', quick: false, proprietaireSeul: true, external: true,
      what: 'Relit le système dit contre la bibliothèque et la clé contre les clés branchées, puis prépare l\'étape « Vérifier » de la page ; la phrase à taper reste dans la page, rien n\'est écrit par la parole',
      params: DEMANDE('Système (son nom)'), words: MOTS_PAROLE.cleMettre, run: (ctx, i) => cleMettreDit(ctx, i) },
    { id: 'cle_ajouter_dit', label: 'Mes clés : ajouter à ma clé (dit)', quick: false, proprietaireSeul: true, external: true,
      what: 'Range un système de la bibliothèque dans les changements en attente d\'une clé ODIN connue (rien n\'est écrit sur la clé ; « Appliquer » se fait dans Mes clés)',
      params: DEMANDE('Système (son nom)'), words: MOTS_PAROLE.cleAjouter, run: (ctx, i) => cleAjouterDit(ctx, i) },
    { id: 'deployer_dit', label: 'Déployer sur des PC du réseau (dit)', quick: false, proprietaireSeul: true, external: true,
      what: 'Relit le système dit contre la bibliothèque et les PC contre ceux vus au démarrage réseau, puis prépare l\'étape « Vérifier » de Déployer ; rien n\'est autorisé ni effacé par la parole (la phrase et l\'appui long restent dans la page)',
      params: DEMANDE('Système (son nom)'), words: MOTS_PAROLE.deployer, run: (ctx, i) => deployerDit(ctx, i) },
    { id: 'travaux_dit', label: 'Où en est le travail', read: true, quiet: true, quick: false, proprietaireSeul: true, external: true,
      what: 'Une carte de suivi : la clé en cours d\'écriture, les changements de clé en attente, les PC en déploiement, les téléchargements ; aucun secret',
      words: MOTS_PAROLE.travaux, run: (ctx) => travauxDit(ctx) },
    { id: 'preparation_dite', label: 'Ce que la parole a préparé', read: true, quiet: true, quick: false, proprietaireSeul: true, external: true,
      what: 'Ce qu\'une phrase dite a préparé pour la page (système, PC ou clé), pendant 30 minutes ; rien n\'est autorisé ni écrit tant que la page n\'a pas sa confirmation',
      run: async (ctx) => {
        const { p, raison } = await preparationRelue(ctx);
        return { ok: true, text: p ? `Préparé : ${p.systemes.map((x) => propre(x.nom, 80)).join(', ')} ${p.sorte === 'cle' ? 'sur une clé' : `sur ${p.pcs?.length ?? 0} PC`}. Rien n'est fait tant que la page n'a pas sa confirmation.` : raison ?? 'Rien de préparé par la parole.', data: { preparation: p ?? null, ...(raison ? { raison } : {}) } };
      } },
    { id: 'preparation_oublier', label: 'Oublier ce que la parole a préparé', quiet: true, quick: false, proprietaireSeul: true,
      what: 'Efface la préparation dite (la page l\'a reprise, ou tu n\'en veux plus) ; rien d\'autre ne change',
      run: (ctx) => { ctx.saveSettings({ preparationDite: null }); return { ok: true, text: 'Préparation oubliée : rien n\'était fait, rien n\'est fait.' }; } },
  ];
  return { actions };
}

/**
 * Les mots de la parole, dans les langues que Logos comprend sans IA (français, anglais, espagnol, allemand). Le
 * japonais s'écrit sans espaces : seules les phrases entières sans nom à relire y sont lues (« boot-moi la clé », le
 * suivi). SEULEMENT des expressions de plusieurs mots, qui disent la cible (« sur la clé », « sur les pc ») : un verbe
 * seul (« ajoute », « mets », « installe ») ou un mot courant seul (« clé », « pc ») ferait prendre à Genèse des phrases
 * qui ne sont pas pour elle, et ôterait à une autre appli le verbe qu'elle est seule à porter. Le verbe est écrit DANS
 * une expression (« ajoute à ma clé ») : Logos le reconnaît alors pour cette action, sans qu'il compte tout seul.
 */
export const MOTS_PAROLE = {
  cle: ['boot la clé', 'boote la clé', 'boot ma clé', 'boot moi la clé', 'rends la clé bootable', 'fais une clé bootable', 'fais une clé de démarrage', 'prépare une clé de démarrage', 'une clé bootable', 'une clé de démarrage', 'installe un système sur la clé', 'installe un système sur ma clé', 'mets un système sur la clé', 'mets un système sur ma clé', 'un système sur la clé', 'un système sur ma clé',
    'make the usb stick bootable', 'make the usb drive bootable', 'make the usb key bootable', 'make a bootable usb stick', 'make a bootable usb drive', 'install a system on the usb stick', 'install a system on the usb drive', 'put a system on the usb stick', 'put a system on the usb drive', 'a system on the usb stick', 'a system on the usb drive',
    'haz la memoria usb arrancable', 'haz el pendrive arrancable', 'instala un sistema en la memoria usb', 'instala un sistema en el pendrive', 'pon un sistema en la memoria usb', 'un sistema en la memoria usb', 'un sistema en el pendrive',
    'mach den usb-stick bootfähig', 'mache den usb-stick bootfähig', 'installiere ein system auf dem usb-stick', 'installiere ein system auf den usb-stick', 'ein system auf dem usb-stick', 'ein system auf den usb-stick',
    'usbメモリを起動用にして', 'usbメモリを起動可能にして', 'usbメモリにシステムを入れて'],
  cleMettre: ['sur la clé', 'sur ma clé', 'sur la clé usb', 'sur ma clé usb', 'mets sur la clé', 'installe sur la clé', 'copie sur la clé',
    'on the usb stick', 'on the usb drive', 'on the usb key', 'on my usb stick', 'on my usb drive', 'onto the usb stick', 'onto the usb drive', 'put on the usb stick', 'install on the usb stick', 'copy onto the usb stick',
    'en la memoria usb', 'en mi memoria usb', 'en el pendrive', 'en mi pendrive', 'pon en la memoria usb', 'instala en la memoria usb', 'copia en la memoria usb',
    'auf den usb-stick', 'auf dem usb-stick', 'auf meinen usb-stick', 'auf meinem usb-stick', 'installiere auf dem usb-stick', 'kopiere auf den usb-stick', 'packe auf den usb-stick'],
  cleAjouter: ['à ma clé', 'à la clé', 'à ma clé usb', 'à la clé usb', 'à ma clé odin', 'ajoute à ma clé', 'rajoute à ma clé',
    'to my usb stick', 'to my usb drive', 'to my usb key', 'to my odin stick', 'add to my usb stick',
    'a mi memoria usb', 'a mi pendrive', 'añade a mi memoria usb', 'agrega a mi memoria usb',
    'zu meinem usb-stick', 'zu meinem odin-stick', 'füge zu meinem usb-stick hinzu'],
  deployer: ['sur les pc', 'sur le pc', 'sur les postes', 'sur le poste', 'sur les ordinateurs', 'sur tous les pc', 'pc qui viennent de démarrer', 'postes qui viennent de démarrer', 'ordinateurs qui viennent de démarrer', 'pc qui viennent de s\'allumer', 'sur l\'ordinateur', 'installe sur les pc', 'déploie sur les pc',
    'on the pcs', 'on the pc', 'on the computers', 'on all the pcs', 'pcs that just booted', 'pcs that just started', 'computers that just booted', 'computers that just started', 'install on the pcs', 'deploy on the pcs',
    'en los pc', 'en el pc', 'en los ordenadores', 'en los equipos', 'pc que acaban de arrancar', 'ordenadores que acaban de arrancar', 'equipos que acaban de arrancar', 'instala en los pc', 'despliega en los pc',
    'auf den pcs', 'auf dem pc', 'auf den rechnern', 'auf den computern', 'auf allen pcs', 'pcs die gerade gestartet sind', 'rechnern die gerade gestartet sind', 'installiere auf den pcs'],
  travaux: ['où en est le travail', 'où en sont les travaux', 'où en est le déploiement', 'où en est le travail de genèse', 'où en est ce que tu prépares',
    'how is the work going', 'where is the work at', 'how is the deployment going', 'deployment progress',
    'cómo va el trabajo', 'cómo va el despliegue', 'progreso del despliegue',
    'wie weit ist die arbeit', 'wie weit ist die bereitstellung', 'stand der bereitstellung',
    'インストールの進み具合', 'インストールの進捗', '展開の進捗'],
};
/** Les mots de Genèse elle-même pour ces phrases : ce qu'on vise (une clé, des PC), jamais un mot courant seul. */
export const MOTS_GENESE_PAROLE = ['sur la clé', 'sur ma clé', 'à ma clé', 'à la clé', 'clé de démarrage', 'boot la clé', 'sur les pc', 'sur le pc', 'sur les postes', 'sur le poste', 'sur les ordinateurs', 'pc qui viennent de démarrer', 'postes qui viennent de démarrer',
  'usb stick', 'usb drive', 'usb key', 'bootable usb', 'on the pcs', 'on the computers', 'pcs that just booted', 'computers that just booted', 'pcs that just started',
  'memoria usb', 'pendrive', 'en los pc', 'en los ordenadores', 'en los equipos', 'acaban de arrancar',
  'usb-stick', 'auf den pcs', 'auf den rechnern', 'auf den computern', 'gerade gestartet',
  'usbメモリ', 'インストールの進'];
