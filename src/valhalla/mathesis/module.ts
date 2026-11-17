// Mathésis — le module de l'appli : « Odin apprend tout seul ». Il démarre avec Odin (une première passe 20 à 40 s
// après le lancement, puis toutes les 15 minutes, visible et pausable dans Talos), sous la garde : interrupteur,
// pause, heures permises, budgets du jour, et arrêt immédiat dès qu'Odin doit répondre.
//
// La page « Ce qu'Odin a appris tout seul » montre aujourd'hui et cette semaine ce qu'il a cherché et pourquoi, ce qu'il
// a lu, ce qu'il en a retenu, ses sources et ce qu'il a laissé ; la liste de curiosité ; et les moyens de confier,
// corriger, effacer, interdire, ouvrir un dossier, couper et régler.
//
// Droits : couper, mettre en pause, interdire, fermer un dossier, baisser un budget = un clic (ce sont des protections).
// Tout ce qui AFFAIBLIT une protection est « grave » (accord du propriétaire, jamais lancé par une automatisation) :
// rallumer, reprendre après une pause, monter un budget, élargir les heures, lever un interdit, ouvrir un dossier,
// ne plus appliquer « ne pas garder », autoriser un modèle en ligne ou payant.
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import type { Action, Kpi, ModCtx, Module, Section, TacheAppli } from '../types.ts';
import { tacheEnPause } from '../automatismes.ts';
import { brancherMathesis } from './magasin.ts';
import { creerMathesis, type Mathesis, type OptionsMathesis } from './moteur.ts';
import { elargit, normaliserReglages, PHRASES_ARRET, VITESSES } from './reglages.ts';
import { FILE_MAX, FILE_TOTAL_MAX, PAGES_SITE_MAX } from './absorber.ts';
import { agissant } from '../sso/acces.ts';
import { jourDe } from './budget.ts';
import type { Budgets, EntreeJournal, GenreBudget, Plage, Reglages, Vitesse } from './types.ts';
import { GENRES_TRAITES } from './types.ts';
import { trierAdresses } from './curiosite.ts';
import { OuTrouver as OuTrouverC } from './ou-trouver.ts';

/** Les dépendances du module, données par Odin (ou par les essais). */
export interface OptionsModuleMathesis extends Omit<OptionsMathesis, 'dossier' | 'home'> {
  /** Oublier un souvenir de la mémoire (correction ou effacement depuis la page). */
  oublierSouvenir?: (id: number) => boolean;
}

const s = (v: unknown) => String(v ?? '').trim();
/** Un chemin comparable : résolu, sans barre finale, et sans casse sous Windows (« C:\Docs\ » = « c:\docs »). */
export const memeChemin = (c: string): string => { const r = resolve(c).replace(/[\\/]+$/, '') || sep; return process.platform === 'win32' ? r.toLowerCase() : r; };
const vrai = (v: unknown): boolean => v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
/** Un nom ou une adresse longue raccourcis par le MILIEU (lisible à 390 px). */
export const court = (n: string, max = 56): string => { const t = s(n).replace(/\s+/g, ' '); return t.length > max ? `${t.slice(0, max - 16)}…${t.slice(-15)}` : t; };
const deux = (n: number) => String(n).padStart(2, '0');
/** Une heure locale lisible (« 17/11 14:05 »). */
export const quandLocal = (ms: number): string => { const d = new Date(ms); return `${deux(d.getDate())}/${deux(d.getMonth() + 1)} ${deux(d.getHours())}:${deux(d.getMinutes())}`; };
const heureLocale = (ms: number): string => { const d = new Date(ms); return `${deux(d.getHours())}:${deux(d.getMinutes())}`; };
const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MO = 1024 * 1024;
const taille = (o: number): string => (o >= 1024 * MO ? `${(o / 1024 / MO).toFixed(1).replace('.', ',')} Go` : o >= MO ? `${Math.round(o / MO)} Mo` : o >= 1024 ? `${Math.round(o / 1024)} Ko` : `${o} o`);
/** Les plages d'heures en texte (« 22 h → 7 h », « toute la journée »). */
export const textePlages = (p: Plage[]): string => (!p.length ? 'jamais' : p.map((x) => ((x.de === 0 && (x.a === 24 || x.a === 0)) ? 'toute la journée' : `${x.de} h → ${x.a} h`)).join(', '));
/** Lit « 22-7, 12-14 » ou « 0-24 ». Rend undefined si illisible. */
export function lirePlages(t: string): Plage[] | undefined {
  const txt = s(t); if (!txt) return undefined;
  if (/toute|0\s*-\s*24/i.test(txt) && !txt.includes(',')) return [{ de: 0, a: 24 }];
  const out: Plage[] = [];
  for (const morceau of txt.split(',')) {
    const m = /^\s*(\d{1,2})\s*(?:h\s*)?(?:-|→|à)\s*(\d{1,2})\s*h?\s*$/i.exec(morceau);
    if (!m) return undefined;
    const de = Number(m[1]), a = Number(m[2]);
    if (de > 24 || a > 24 || de === a) return undefined;
    out.push({ de, a });
  }
  return out.length ? out : undefined;
}

const NOMS_BUDGET: Record<GenreBudget, string> = { recherches: 'Recherches', pages: 'Pages lues', octets: 'Taille téléchargée', minutesVideo: 'Minutes de vidéo', appelsPayants: 'Appels à un modèle payant', fichiers: 'Fichiers des dossiers ouverts', octetsFichiers: 'Taille lue dans les dossiers ouverts' };
const valeurBudget = (g: GenreBudget, n: number): string => (g === 'octets' || g === 'octetsFichiers' ? taille(n) : g === 'minutesVideo' ? `${n} min` : String(n));
const HONNETE = 'Codé et essayé contre un faux moteur de recherche, un faux site et de faux dossiers ; pas encore essayé sur le vrai web. Les vidéos, la musique et les images ne sont pas encore regardées (passages suivants).';

/**
 * Le rythme de Mathésis (et ses réglages) : le propriétaire seul. Une personne de Persona connectée à l'interface (un
 * membre, un invité) ne le change pas, même si elle a accès à l'appli. Le reste passe par Heimdall comme avant : une
 * demande d'un membre dans une discussion, d'une tâche automatique ou après un contenu extérieur est validée ou refusée.
 */
export function seulLeProprietaire(): void {
  const qui = agissant();
  if (qui) throw new Error(`seul le propriétaire règle Mathésis (${qui.name || qui.login} n'en a pas le droit)`);
}

/** Les nouveaux réglages qu'un formulaire propose (sans rien enregistrer). Lève une erreur en clair si illisible. */
export function proposition(i: Record<string, unknown>, actuel: Reglages): Reglages {
  const p: Record<string, unknown> = { ...actuel };
  const v = s(i.vitesse) as Vitesse;
  const vitesse: Vitesse = v === 'douce' || v === 'normale' || v === 'soutenue' ? v : actuel.vitesse;
  const base = vitesse !== actuel.vitesse ? { ...VITESSES[vitesse] } : { ...actuel.budgets };
  const nombre = (k: string) => (i[k] === undefined || i[k] === '' ? undefined : Number(i[k]));
  const b: Budgets = { ...base };
  const r = nombre('recherches'), pg = nombre('pages'), mo = nombre('octetsMo'), f = nombre('fichiers'), fmo = nombre('fichiersMo'), ap = nombre('appelsPayants');
  if (r !== undefined) b.recherches = r;
  if (pg !== undefined) b.pages = pg;
  if (mo !== undefined) b.octets = mo * MO;
  if (f !== undefined) b.fichiers = f;
  if (fmo !== undefined) b.octetsFichiers = fmo * MO;
  if (ap !== undefined) b.appelsPayants = ap;
  // Le rythme (décision du propriétaire, 17/11/2026) : pages par jour et par site à absorber, attente entre deux pages.
  const ps = nombre('pagesParSite'), at = nombre('attenteS');
  if ((ps !== undefined && !Number.isFinite(ps)) || (at !== undefined && !Number.isFinite(at))) throw new Error('rythme illisible');
  if (ps !== undefined || at !== undefined) p.robot = { ...actuel.robot, ...(ps !== undefined ? { pagesParSiteAbsorber: ps } : {}), ...(at !== undefined ? { delaiSiteMs: Math.round(at * 1000) } : {}) };
  for (const [k, x] of Object.entries(b)) if (!Number.isFinite(x) || x < 0) throw new Error(`budget illisible : ${k}`);
  p.vitesse = vitesse; p.budgets = b;
  if (s(i.heures)) { const h = lirePlages(s(i.heures)); if (!h) throw new Error('heures illisibles (exemple : « 0-24 » ou « 22-7, 12-14 »)'); p.heures = h; }
  if (s(i.heuresLourd)) { const h = lirePlages(s(i.heuresLourd)); if (!h) throw new Error('heures du travail lourd illisibles (exemple : « 22-7 »)'); p.heuresLourd = h; }
  if (i.nePasGarder !== undefined && i.nePasGarder !== '') p.nePasGarder = vrai(i.nePasGarder);
  if (i.modeleEnLigne !== undefined && i.modeleEnLigne !== '') p.modeleEnLigne = vrai(i.modeleEnLigne);
  return normaliserReglages(p);
}

/** Ce que des réglages proposés AFFAIBLISSENT (vide : rien de grave). */
export function affaiblit(avant: Reglages, apres: Reglages): string[] {
  const r: string[] = [];
  for (const k of Object.keys(apres.budgets) as GenreBudget[]) {
    // Les pages du jour sont le rythme que le propriétaire règle lui-même (17/11/2026) : plus une action grave. Le reste
    // (recherches, taille, fichiers, appels payants) le demeure quand il monte.
    if (k === 'pages') continue;
    if (apres.budgets[k] > avant.budgets[k]) r.push(`monter le budget « ${NOMS_BUDGET[k]} » de ${valeurBudget(k, avant.budgets[k])} à ${valeurBudget(k, apres.budgets[k])} par jour`);
  }
  if (elargit(avant.heures, apres.heures)) r.push(`élargir les heures du travail léger (${textePlages(avant.heures)} → ${textePlages(apres.heures)})`);
  if (elargit(avant.heuresLourd, apres.heuresLourd)) r.push(`élargir les heures du travail lourd (${textePlages(avant.heuresLourd)} → ${textePlages(apres.heuresLourd)})`);
  if (avant.nePasGarder && !apres.nePasGarder) r.push('ne plus appliquer « ne pas garder » : ce qu\'Odin lit sera de nouveau rangé');
  if (!avant.modeleEnLigne && apres.modeleEnLigne) r.push('autoriser un modèle en ligne ou payant (rien ne lui est envoyé sans ce réglage)');
  return r;
}

export function mathesis(o: () => OptionsModuleMathesis = () => ({})): Module {
  const moteurs = new Map<string, Mathesis>();
  const moteur = (ctx: ModCtx): Mathesis => {
    let m = moteurs.get(ctx.dir);
    if (!m) { m = creerMathesis({ ...o(), dossier: ctx.dir, home: ctx.home }); moteurs.set(ctx.dir, m); }
    return m;
  };
  const prive = (): boolean => { try { return o().prive?.() === true; } catch { return true; } };
  const pasEnPrive = (): void => { if (prive()) throw new Error('mode privé : rien n\'est gardé, donc rien n\'est confié ni corrigé'); };

  // ------------------------------------------------------------------ Actions
  const tourA: Action = {
    id: 'tour', label: 'Apprendre maintenant',
    what: 'Une passe de travail bornée : les manques de la liste de curiosité (confiés d\'abord), les pages à revisiter, les dossiers ouverts — sous les budgets du jour et la garde',
    words: ['apprends tout seul', 'mathesis apprends', 'cherche ce que tu ne sais pas'],
    async run(ctx) {
      // « Apprendre maintenant » reste court : 10 pages de sites à absorber au plus (le passage de fond lit au rythme réglé).
      const b = await moteur(ctx).tour({ absorber: 10 });
      ctx.saveSettings({ dernierTour: ctx.now().toISOString(), dernierBilan: b.phrase });
      const lignes = [b.phrase, ...b.manques.map((x) => `· ${x.questions.length} recherche(s), ${x.pagesLues} page(s) lue(s), ${x.faits.length} fait(s) retenu(s)`)];
      return { ok: !b.arret || b.arret === 'budget', text: lignes.join('\n'), data: { arret: b.arret, manques: b.manques.length } };
    },
  };
  const confierA: Action = {
    id: 'confier', label: 'Confier en priorité',
    what: 'Confier un sujet ou des adresses de pages publiques : ils passent en tête de la liste de curiosité (sans lever aucune limite : lecture seule, consignes des robots, budgets)',
    words: ['apprends sur', 'renseigne toi sur', 'lis cette page'],
    params: [{ key: 'quoi', label: 'Un sujet, ou des adresses publiques (https://…) séparées par des espaces', kind: 'text', required: true }],
    run(ctx, i) {
      pasEnPrive();
      const quoi = s(i.quoi).slice(0, 2000);
      const { refusees } = trierAdresses(quoi);
      const dit = refusees.length ? ` Refusée(s) : ${refusees.map((r) => `${court(r.url, 50)} (${r.raison})`).join(' ; ')}.` : '';
      const m = moteur(ctx).curiosite.confier(quoi);
      if (!m) return { ok: false, text: `Rien n'est confié : vide, adresse non publique, ou sujet/site interdit par toi.${dit}`, data: { refusees } };
      const attente = GENRES_TRAITES.includes(m.genre) ? '' : ' (ce genre sera traité à un passage suivant)';
      return { ok: true, text: `Confié en tête de liste : « ${court(m.sujet, 80)} »${attente}.${dit}`, data: { id: m.id, refusees } };
    },
  };
  const retirerA: Action = {
    id: 'retirer', label: 'Retirer de la curiosité', quick: false,
    what: 'Retire un manque de la liste de curiosité',
    params: [{ key: 'id', label: 'Manque', kind: 'text', required: true }],
    run(ctx, i) { const ok = moteur(ctx).curiosite.retirer(s(i.id)); return { ok, text: ok ? 'Retiré de la liste de curiosité.' : 'Manque introuvable.' }; },
  };
  const interdireA: Action = {
    id: 'interdire', label: 'Interdire',
    what: 'Interdire un sujet, un site ou un dossier : Odin ne le cherchera, ne le lira ni ne le parcourra plus',
    words: ['n apprends pas sur', 'interdis le site'],
    params: [{ key: 'genre', label: 'Quoi', kind: 'select', options: ['sujet', 'site', 'dossier'], default: 'sujet', required: true }, { key: 'valeur', label: 'Le sujet, le site ou le chemin du dossier', kind: 'text', required: true }],
    run(ctx, i) {
      const g = s(i.genre) === 'site' ? 'sites' : s(i.genre) === 'dossier' ? 'dossiers' : 'sujets';
      const v = s(i.valeur).slice(0, 1000);
      if (!v) throw new Error('rien à interdire');
      if (g === 'dossiers' && !isAbsolute(v)) throw new Error('un dossier se donne par son chemin complet');
      moteur(ctx).interdits.interdire(g, v);
      return { ok: true, text: `Interdit : ${g === 'sujets' ? 'le sujet' : g === 'sites' ? 'le site' : 'le dossier'} « ${court(v, 80)} ».` };
    },
  };
  const permettreA: Action = {
    id: 'permettre', label: 'Lever un interdit', quick: false,
    what: 'Lever un interdit (sujet, site ou dossier) : demande ton accord',
    params: [{ key: 'genre', label: 'Quoi', kind: 'select', options: ['sujet', 'site', 'dossier'], required: true }, { key: 'valeur', label: 'Valeur', kind: 'text', required: true }],
    grave: (i) => `lever l'interdit sur ${s(i.genre) || 'sujet'} « ${court(s(i.valeur), 60)} » : Odin pourra de nouveau le chercher ou le lire`,
    run(ctx, i) {
      const g = s(i.genre) === 'site' ? 'sites' : s(i.genre) === 'dossier' ? 'dossiers' : 'sujets';
      moteur(ctx).interdits.permettre(g, s(i.valeur));
      return { ok: true, text: `Interdit levé : « ${court(s(i.valeur), 80)} ».` };
    },
  };
  const couperA: Action = {
    id: 'couper', label: 'Couper tout',
    what: 'L\'interrupteur unique : plus aucune recherche, plus aucun robot de lecture, plus aucun dossier lu (le travail en cours s\'arrête aussitôt)',
    words: ['arrete d apprendre tout seul', 'coupe mathesis'],
    run(ctx) { moteur(ctx).eteindre(); return { ok: true, text: 'Coupé : Odin n\'apprend plus tout seul (aucune recherche, aucun robot, aucun dossier lu).' }; },
  };
  const allumerA: Action = {
    id: 'allumer', label: 'Rallumer',
    what: 'Rallume l\'apprentissage autonome (vitesse et heures inchangées)',
    grave: () => 'rallumer l\'apprentissage autonome : Odin recommencera à chercher, à lire des pages publiques et les dossiers ouverts',
    run(ctx) { moteur(ctx).allumer(); return { ok: true, text: 'Rallumé : Odin reprend son apprentissage autonome, sous les budgets et la garde.' }; },
  };
  const pauseA: Action = {
    id: 'pause', label: 'Pause',
    what: 'Pause immédiate (le travail en cours s\'arrête) jusqu\'à la reprise',
    run(ctx) { moteur(ctx).pause(); return { ok: true, text: 'En pause.' }; },
  };
  const reprendreA: Action = {
    id: 'reprendre', label: 'Reprendre',
    what: 'Reprend après une pause',
    grave: () => 'reprendre l\'apprentissage autonome après la pause',
    run(ctx) { moteur(ctx).reprendre(); return { ok: true, text: 'Repris.' }; },
  };
  const reglerA: Action = {
    id: 'regler', label: 'Régler', quick: false, proprietaireSeul: (i, ctx) => { try { const r = moteur(ctx!).reglages().robot; return (i.pagesParSite !== undefined && Number(i.pagesParSite) > r.pagesParSiteAbsorber) || (i.attenteS !== undefined && Number(i.attenteS) * 1000 < r.delaiSiteMs); } catch { return i.pagesParSite !== undefined || i.attenteS !== undefined; } }, // monter le rythme : propriétaire seul
    what: 'La vitesse (budgets par jour), le rythme (pages par jour et par site, attente entre deux pages d\'un même site), les heures du travail léger et du travail lourd, « ne pas garder », le modèle en ligne (non par défaut)',
    params: [
      { key: 'vitesse', label: 'Vitesse', kind: 'select', options: ['douce', 'normale', 'soutenue'] },
      { key: 'recherches', label: 'Recherches par jour', kind: 'number' }, { key: 'pages', label: 'Pages lues par jour', kind: 'number' },
      { key: 'octetsMo', label: 'Taille téléchargée par jour (Mo)', kind: 'number' }, { key: 'fichiers', label: 'Fichiers des dossiers ouverts par jour', kind: 'number' },
      { key: 'fichiersMo', label: 'Taille lue dans les dossiers ouverts par jour (Mo)', kind: 'number' },
      { key: 'heures', label: 'Heures du travail léger (« 0-24 », « 22-7, 12-14 »)', kind: 'text' }, { key: 'heuresLourd', label: 'Heures du travail lourd (« 22-7 »)', kind: 'text' },
      { key: 'nePasGarder', label: 'Ne rien garder de ce qu\'Odin lit', kind: 'boolean' }, { key: 'modeleEnLigne', label: 'Autoriser un modèle en ligne ou payant', kind: 'boolean' },
      { key: 'appelsPayants', label: 'Appels à un modèle payant par jour', kind: 'number' },
      { key: 'pagesParSite', label: 'Pages par jour et par site à absorber', kind: 'number' }, { key: 'attenteS', label: 'Attente entre deux pages d\'un même site (secondes, 2 au moins)', kind: 'number' },
    ],
    grave: (i, ctx) => {
      // Sans contexte (une scène, un lien entre applis) on ne peut pas savoir si ça affaiblit : tenu pour grave.
      if (!ctx) return 'changer les réglages de Mathésis (sans contexte pour vérifier : ton accord est demandé)';
      try { const r = affaiblit(moteur(ctx).reglages(), proposition(i, moteur(ctx).reglages())); return r.length ? r.join(' ; ') : undefined; } catch { return undefined; }
    },
    run(ctx, i) {
      seulLeProprietaire();
      const m = moteur(ctx), avant = m.reglages(), apres = proposition(i, avant);
      const n = m.regler({ vitesse: apres.vitesse, budgets: apres.budgets, heures: apres.heures, heuresLourd: apres.heuresLourd, nePasGarder: apres.nePasGarder, modeleEnLigne: apres.modeleEnLigne, robot: apres.robot });
      return { ok: true, text: `Réglé : vitesse ${n.vitesse}, ${n.budgets.recherches} recherche(s) et ${n.budgets.pages} page(s) par jour, travail léger ${textePlages(n.heures)}, ${n.robot.pagesParSiteAbsorber} page(s) par jour et par site à absorber, ${n.robot.delaiSiteMs / 1000} s entre deux pages d'un même site (plus si le site le demande), travail lourd ${textePlages(n.heuresLourd)}${n.nePasGarder ? ', rien n\'est gardé' : ''}${n.modeleEnLigne ? ', modèle en ligne autorisé' : ', aucun modèle en ligne'}.` };
    },
  };
  const ouvrirA: Action = {
    id: 'ouvrir_dossier', label: 'Ouvrir un dossier à Odin',
    what: 'Laisser Odin LIRE un dossier (et ses sous-dossiers) : documents et livres page par page, en lecture seule ; jamais ailleurs',
    params: [{ key: 'chemin', label: 'Chemin complet du dossier', kind: 'text', required: true }],
    grave: (i) => `laisser Odin lire le dossier « ${court(s(i.chemin), 60)} » et ses sous-dossiers (lecture seule)`,
    run(ctx, i) {
      const c = s(i.chemin);
      if (!isAbsolute(c)) throw new Error('donne le chemin complet du dossier');
      if (!existsSync(c) || !statSync(c).isDirectory()) throw new Error('dossier introuvable');
      const m = moteur(ctx);
      const d = [...m.reglages().dossiers.filter((x) => memeChemin(x) !== memeChemin(c)), c];
      m.regler({ dossiers: d });
      return { ok: true, text: `Dossier ouvert à Odin (lecture seule) : ${court(c, 80)}.` };
    },
  };
  const fermerA: Action = {
    id: 'fermer_dossier', label: 'Fermer un dossier', quick: false,
    what: 'Odin ne lira plus ce dossier',
    params: [{ key: 'chemin', label: 'Chemin du dossier', kind: 'text', required: true }],
    run(ctx, i) {
      const m = moteur(ctx), c = s(i.chemin);
      if (!c) throw new Error('quel dossier ?');
      const avant = m.reglages().dossiers, reste = avant.filter((x) => memeChemin(x) !== memeChemin(c));
      if (reste.length === avant.length) return { ok: false, text: `Ce dossier n'était pas ouvert à Odin : ${court(c, 80)}.` };
      m.regler({ dossiers: reste });
      return { ok: true, text: `Dossier fermé : ${court(c, 80)}.` };
    },
  };
  const entree = (ctx: ModCtx, id: string): EntreeJournal => {
    const e = moteur(ctx).journal.lire({ n: 3000 }).find((x) => x.id === id);
    if (!e) throw new Error('entrée introuvable dans le journal');
    return e;
  };
  const oublier = (e: EntreeJournal): number => { let n = 0; for (const id of e.souvenirs ?? []) { try { if (o().oublierSouvenir?.(id)) n++; } catch { /* la mémoire ne bloque pas */ } } return n; };
  const effacerA: Action = {
    id: 'effacer', label: 'Effacer ce qui a été retenu', quick: false,
    what: 'Efface une entrée du journal et les souvenirs qu\'elle a rangés dans la mémoire',
    params: [{ key: 'id', label: 'Entrée', kind: 'text', required: true }],
    run(ctx, i) {
      const e = entree(ctx, s(i.id)), n = oublier(e);
      const m = moteur(ctx); m.journal.effacer(e.id);
      if (!prive()) m.journal.noter({ genre: 'supprime', quoi: `effacé à ta demande : « ${court(e.quoi, 100)} »`, supprime: [`${n} souvenir(s) oublié(s)`] });
      return { ok: true, text: `Effacé : ${n} souvenir(s) oublié(s)${(e.souvenirs?.length ?? 0) > n ? ` (${(e.souvenirs?.length ?? 0) - n} déjà absent(s) ou mémoire non branchée)` : ''}.` };
    },
  };
  const corrigerA: Action = {
    id: 'corriger', label: 'Corriger ce qui a été retenu', quick: false,
    what: 'Remplace ce qu\'Odin a retenu par ce que tu dis : ta version est rangée comme « donné par toi » et prime sur toute page',
    params: [{ key: 'id', label: 'Entrée', kind: 'text', required: true }, { key: 'texte', label: 'La bonne version', kind: 'textarea', required: true }],
    run(ctx, i) {
      pasEnPrive();
      const texte = s(i.texte).slice(0, 2000); if (!texte) throw new Error('la bonne version est vide');
      const e = entree(ctx, s(i.id)), m = moteur(ctx);
      const sujet = e.manque ? m.curiosite.liste().find((x) => x.id === e.manque)?.sujet : undefined;
      const n = oublier(e);
      const r = m.apprendre({ sorte: 'correction', source: 'proprietaire:mathesis', proprietaire: true, faits: [{ texte, ...(sujet ? { sujet } : {}) }] });
      m.journal.effacer(e.id);
      m.journal.noter({ genre: 'corrige', quoi: `corrigé par toi : « ${court(texte, 120)} »`, retenu: [{ texte: court(texte, 300), niveau: 'donné par toi' }], supprime: [`${n} souvenir(s) remplacé(s)`], ...(r.souvenirs.length ? { souvenirs: r.souvenirs } : {}) });
      return { ok: true, text: `Corrigé : ta version est rangée comme « donné par toi »${r.retenus ? '' : ' (la mémoire n\'est pas branchée : rien n\'a été rangé)'} ; ${n} souvenir(s) remplacé(s).` };
    },
  };

  // ------------------------------------------------------------------ Sites à absorber
  const siteDe = (ctx: ModCtx, adresse: string) => {
    const x = moteur(ctx).absorbeur.trouver(adresse);
    if (!x) throw new Error(`ce site n'est pas dans la liste à absorber : ${court(adresse, 60)}`);
    return x;
  };
  const absorberA: Action = {
    id: 'absorber', label: 'Absorber un site',
    what: 'Ajouter un site à lire EN ENTIER, en priorité (son plan, ses fils d\'actualité, ses pages) ; s\'il est déjà dans la liste, dire où il en est. Sans lever aucune limite : lecture seule, consignes des robots, délai entre deux pages, budgets',
    words: ['absorbe', 'absorbe ce site', 'absorber le site', 'lis tout ce site', 'lis tout le site', 'absorb this site', 'read this whole site', 'read the entire site', 'lee todo este sitio', 'lies die ganze website'],
    params: [{ key: 'adresse', label: 'Adresse du site (https://… ou nom du site)', kind: 'text', required: true }],
    async run(ctx, i) {
      pasEnPrive();
      const m = moteur(ctx);
      const r = m.absorbeur.ajouter(s(i.adresse), s(i.par) === 'page' ? 'page' : 'discussion');
      if (!r.ok) return { ok: false, text: `Je ne l'ajoute pas : ${r.raison}.` };
      if (r.deja) return { ok: true, text: `Déjà dans la liste — ${m.absorbeur.phrase(r.site)}`, data: { id: r.site.id, deja: true } };
      // Un aperçu tout de suite (consignes du site, plan) si la garde le permet ; sinon au prochain passage.
      const a = await m.absorbeur.apercu(r.site.id);
      const x = m.absorbeur.trouver(r.site.id) ?? r.site;
      if (a.refuse) return { ok: false, text: `Je ne peux pas absorber ${x.id} : ${a.refuse}.`, data: { id: x.id } };
      const debut = a.lu ? `Ajouté : ${x.id}. ${x.consignes ? `Ses consignes : ${x.consignes}. ` : ''}${x.file.length ? `${x.file.length} page(s) à lire trouvée(s) dans son plan${x.refusees ? ` (et ${x.refusees} interdite(s) par ses consignes, laissée(s))` : ''} ; à ce rythme (une page toutes les ${m.absorbeur.attente(x) / 1000} s, ${m.absorbeur.plafond(x).toLocaleString('fr-FR')} par jour au plus), il me faudra ${m.absorbeur.estimation(x)?.texte ?? 'peu de temps'}. ` : 'Pas de plan du site lisible : je partirai de sa page d\'accueil et de ses fils d\'actualité. '}`
        : `Ajouté : ${x.id}. `;
      return { ok: true, text: `${debut}Je commence au prochain passage (toutes les 15 minutes), avant la curiosité ordinaire.`, data: { id: x.id, connues: x.connues } };
    },
  };
  const etatSiteA: Action = {
    id: 'etat_site', label: 'Où en est un site', read: true,
    what: 'Dire si un site a déjà été absorbé, ou où en est sa lecture (pages lues, restantes, dernière visite)',
    words: ['as tu absorbe', 'as tu absorbe le site', 'as-tu absorbe le site', 'as-tu absorbe', 'tu as absorbe', 'deja absorbe', 'as-tu deja absorbe', 'ou en es tu du site', 'ou en es-tu du site', 'as tu lu le site', 'as-tu lu le site'],
    params: [{ key: 'adresse', label: 'Adresse du site (https://… ou nom du site)', kind: 'text', required: true }],
    run(ctx, i) {
      const m = moteur(ctx), x = m.absorbeur.trouver(s(i.adresse));
      if (x) return { ok: true, text: `${m.absorbeur.phrase(x)}${x.derniereVisite ? ` Dernière visite : ${quandLocal(x.derniereVisite)}.` : ''}`, data: { id: x.id, etat: x.etat, lues: x.lues, restantes: x.file.length, absorbeLe: x.absorbeLe } };
      return { ok: true, text: `Je n'ai pas ${court(s(i.adresse), 60)} dans ma liste de sites à absorber. Dis « absorbe ce site ${court(s(i.adresse), 40)} » pour l'ajouter.` };
    },
  };
  const pauseSiteA: Action = {
    id: 'pause_site', label: 'Mettre un site en pause', quick: false,
    what: 'Ne plus lire ce site à absorber jusqu\'à la reprise',
    params: [{ key: 'adresse', label: 'Site', kind: 'text', required: true }],
    run(ctx, i) { const x = siteDe(ctx, s(i.adresse)); moteur(ctx).absorbeur.pause(x.id); return { ok: true, text: `En pause : ${x.id}.` }; },
  };
  const reprendreSiteA: Action = {
    id: 'reprendre_site', label: 'Reprendre un site', quick: false,
    what: 'Reprendre la lecture d\'un site à absorber mis en pause',
    params: [{ key: 'adresse', label: 'Site', kind: 'text', required: true }],
    grave: (i) => `reprendre la lecture du site « ${court(s(i.adresse), 60)} »`,
    run(ctx, i) { const x = siteDe(ctx, s(i.adresse)); moteur(ctx).absorbeur.reprendre(x.id); return { ok: true, text: `Repris : ${x.id}.` }; },
  };
  const retirerSiteA: Action = {
    id: 'retirer_site', label: 'Retirer un site', quick: false,
    what: 'Retirer un site de la liste à absorber ; « oublier » efface aussi ce qui en a été appris',
    params: [{ key: 'adresse', label: 'Site', kind: 'text', required: true }, { key: 'oublier', label: 'Oublier aussi ce qui en a été appris', kind: 'boolean' }],
    grave: (i) => (vrai(i.oublier) ? `oublier tout ce qu'Odin a appris du site « ${court(s(i.adresse), 60)} »` : undefined),
    run(ctx, i) {
      const m = moteur(ctx), x = siteDe(ctx, s(i.adresse));
      m.absorbeur.retirer(x.id);
      if (!vrai(i.oublier)) return { ok: true, text: `Retiré de la liste : ${x.id} (ce qui en a été appris reste).` };
      let n = 0;
      for (const e of m.journal.lire({ n: 3000 })) if (e.genre === 'retenu' && (e.source ?? '').split(/[,+ ]+/).some((x2) => x2.replace(/^www\./, '') === x.id)) { n += oublier(e); m.journal.effacer(e.id); }
      const lieux = m.ouTrouver.oublierSite(x.id);
      return { ok: true, text: `Retiré et oublié : ${x.id} (${n} souvenir(s) oublié(s), ${lieux} adresse(s) de pages retirée(s)).` };
    },
  };
  const rythmeSiteA: Action = {
    id: 'rythme_site', label: 'Pages par jour d\'un site', quick: false, proprietaireSeul: (i, ctx) => { try { return Number(i.pagesParJour) > moteur(ctx!).absorbeur.plafond(siteDe(ctx!, s(i.adresse))); } catch { return true; } }, // monter le rythme : propriétaire seul
    what: 'Le nombre de pages lues par jour sur un site à absorber (1 à 10 000 000 ; sans réglage, celui de Mathésis : 1 000 000), toujours avec l\'attente entre deux pages et les consignes du site',
    params: [{ key: 'adresse', label: 'Site', kind: 'text', required: true }, { key: 'pagesParJour', label: 'Pages par jour', kind: 'number', required: true }],
    // Le rythme est réglé par le propriétaire lui-même (17/11/2026) : plus une action grave. Sans contexte (une scène, un
    // lien entre applis, une tâche) on ne sait pas qui le demande : l'accord reste demandé.
    grave: (i, ctx) => (ctx ? undefined : `changer le rythme de lecture du site « ${court(s(i.adresse), 60)} » (sans contexte pour vérifier : ton accord est demandé)`),
    run(ctx, i) {
      seulLeProprietaire();
      const n = Number(i.pagesParJour);
      if (!Number.isFinite(n) || n < 1 || n > PAGES_SITE_MAX) throw new Error(`de 1 à ${PAGES_SITE_MAX.toLocaleString('fr-FR')} pages par jour`);
      const x = siteDe(ctx, s(i.adresse));
      const r = moteur(ctx).absorbeur.regler(x.id, n)!;
      return { ok: true, text: `${r.id} : ${r.pagesParJour} page(s) par jour, toujours avec l'attente entre deux pages (${moteur(ctx).absorbeur.attente(r) / 1000} s au moins) et les consignes du site.` };
    },
  };
  const ouTrouverA: Action = {
    id: 'ou_trouver', label: 'Où trouver', read: true,
    what: 'Dire où une information se trouve : la page précise qu\'Odin a lue (titre, adresse, date de lecture)',
    words: ['ou trouver', 'ou lire', 'ou est explique', 'ou se trouve l information'],
    params: [{ key: 'quoi', label: 'Ce que tu cherches', kind: 'text', required: true }],
    run(ctx, i) {
      const m = moteur(ctx), t = m.ouTrouver.chercher(s(i.quoi));
      return { ok: true, text: OuTrouverC.repondre(t), data: { pages: t.map((e) => ({ url: e.url, titre: e.titre, lu: e.at })) } };
    },
  };

  const tache: TacheAppli = {
    id: 'apprendre', nom: 'Odin apprend tout seul', quoi: 'cherche ce qu\'il ne sait pas, lit des pages publiques et les dossiers ouverts, sous les budgets du jour ; s\'arrête dès qu\'Odin doit répondre',
    rythme: () => ({ genre: 'minutes', n: 15 }),
    lancer: { action: 'tour' },
    dernier: (ctx) => (typeof ctx.settings.dernierTour === 'string' ? { at: ctx.settings.dernierTour, ok: true, texte: s(ctx.settings.dernierBilan) } : undefined),
  };

  // ------------------------------------------------------------------ Page
  function vue(ctx: ModCtx) {
    const m = moteur(ctx), r = m.reglages(), now = ctx.now().getTime();
    const jourJ = jourDe(now), debutSemaine = now - 7 * 86_400_000;
    const journal = m.journal.lire({ depuis: debutSemaine, n: 3000 });
    const aujourdhui = journal.filter((e) => jourDe(e.at) === jourJ);
    const utilise = m.budget.utilise();
    const etat = !r.actif ? 'coupé' : r.pause ? 'en pause' : prive() ? 'mode privé' : 'allumé';
    const manques = m.curiosite.liste();
    const enAttente = manques.filter((x) => x.etat === 'en_attente').length;
    const kpis: Kpi[] = [
      { label: 'État', value: etat, tone: etat === 'allumé' ? 'bon' : 'attention', hint: r.actif ? `vitesse ${r.vitesse} · léger : ${textePlages(r.heures)} · lourd : ${textePlages(r.heuresLourd)}` : PHRASES_ARRET.eteint },
      { label: 'Recherches aujourd\'hui', value: `${utilise.recherches} / ${r.budgets.recherches}` },
      { label: 'Pages lues aujourd\'hui', value: `${utilise.pages} / ${r.budgets.pages}` },
      { label: 'Sujets', value: `${enAttente} en attente`, hint: `${manques.length} manque(s) en tout` },
    ];
    const ligne = (e: EntreeJournal): string[] => [
      `${heureLocale(e.at)} · ${e.quoi}`,
      ...(e.pourquoi ? [`    pourquoi : ${e.pourquoi}`] : []),
      ...(e.source ? [`    source : ${court(e.source, 70)}`] : []),
      ...(e.retenu ?? []).slice(0, 6).map((x) => `    retenu (${x.niveau}) : ${court(x.texte, 140)}`),
      ...(e.supprime ?? []).slice(0, 4).map((x) => `    laissé : ${court(x, 140)}`),
    ];
    const parJour = new Map<string, { recherches: number; lues: number; retenus: number; laisses: number; at: number }>();
    for (const e of journal) {
      const k = jourDe(e.at), x = parJour.get(k) ?? { recherches: 0, lues: 0, retenus: 0, laisses: 0, at: e.at };
      if (e.genre === 'recherche') x.recherches++;
      if (e.genre === 'lecture' || e.genre === 'fichier') x.lues++;
      x.retenus += e.retenu?.length ?? 0;
      if (e.genre === 'refus' || e.genre === 'ecarte') x.laisses++;
      parJour.set(k, x);
    }
    const retenus = journal.filter((e) => (e.genre === 'retenu' || e.genre === 'fichier' || e.genre === 'corrige') && (e.retenu?.length ?? 0) > 0).slice(0, 40);
    const laisses = journal.filter((e) => e.genre === 'refus' || e.genre === 'ecarte' || e.genre === 'arret' || (e.supprime?.length ?? 0) > 0).slice(0, 40);
    const memoire = o().apprentissage ? 'branchée' : 'pas branchée (rien n\'est rangé dans la mémoire)';

    const pj = (x: Parameters<typeof m.absorbeur.plafond>[0]) => m.absorbeur.plafond(x);
    const visites = Object.values(m.robot.etats()).sort((a, b) => b.derniereVisiteMs - a.derniereVisiteMs);
    const appris: Section[] = [
      { kind: 'text', title: 'Ce que c\'est', tone: 'neutre', text: `Odin cherche ce qu'il ne sait pas ou sait mal, lit des pages publiques (lecture seule, consignes des robots respectées) et les dossiers que tu lui ouvres, recoupe ses sources (deux sources indépendantes = « confirmé », une seule = « à vérifier ») et range ce qu'il retient dans sa mémoire (${memoire}). Son journal, sa curiosité et ses réglages sont chiffrés, en fichiers sur ta machine et reportés dans la base MATHESIS_ODIN quand elle est prête. Travail léger : ${textePlages(r.heures)} ; travail lourd : ${textePlages(r.heuresLourd)}. ${HONNETE}` },
      { kind: 'log', title: `Aujourd'hui (${aujourdhui.length})`, lines: aujourdhui.length ? aujourdhui.slice(0, 60).flatMap(ligne) : ['Rien encore aujourd\'hui.'] },
      { kind: 'table', title: 'Cette semaine', columns: ['Jour', 'Recherches', 'Pages et fichiers lus', 'Faits retenus', 'Laissés'], rows: [...parJour.entries()].sort((a, b) => b[1].at - a[1].at).map(([k, x]) => ({ cells: [`${JOURS[new Date(x.at).getDay()]} ${k.slice(8, 10)}/${k.slice(5, 7)}`, String(x.recherches), String(x.lues), String(x.retenus), String(x.laisses)] })), empty: 'Rien cette semaine.' },
      { kind: 'table', title: 'Retenu (corriger ou effacer)', columns: ['Quand', 'Retenu', 'Niveau', 'Source', 'N°'], rows: retenus.map((e) => ({ cells: [quandLocal(e.at), court(e.retenu![0].texte, 90) + (e.retenu!.length > 1 ? ` (+${e.retenu!.length - 1})` : ''), e.retenu![0].niveau, court(e.source ?? '—', 40), e.id], actions: [{ action: 'effacer', label: 'Effacer', input: { id: e.id } }] })), empty: 'Rien de retenu cette semaine.' },
      { kind: 'form', title: 'Corriger ce qui a été retenu', action: 'corriger', submit: 'Corriger', params: [{ key: 'id', label: 'N° de l\'entrée (colonne N°)', kind: 'text', required: true }, { key: 'texte', label: 'La bonne version', kind: 'textarea', required: true }], aide: 'Ta version est rangée comme « donné par toi » : aucune page ne pourra l\'écraser.' },
      { kind: 'log', title: 'Laissé (refus, interdits, écartés, arrêts)', lines: laisses.length ? laisses.flatMap(ligne) : ['Rien de laissé cette semaine.'] },
      // Les sites visités : ce que le propriétaire peut vérifier (dernière visite, prochaine, état, ce qui en a été appris).
      { kind: 'table', title: `Sites visités (${visites.length})`, columns: ['Adresse', 'Vue le', 'Prochaine', 'État'], rows: visites.slice(0, 40).map((e) => {
        const appris = m.traces.apprisDe(e.url)?.appris ?? 0;
        const etatPage = e.statut === 'refus' ? 'refusé' : e.statut === 'erreur' ? 'erreur' : e.statut === 'inchange' ? 'inchangé' : e.changements > 0 ? 'changé' : 'nouveau';
        return { cells: [court(e.url.replace(/^https?:\/\//, ''), 40), quandLocal(e.derniereVisiteMs), e.statut === 'refus' ? '—' : quandLocal(e.prochaineVisite), `${etatPage}${appris ? ` · ${appris} appris` : ''}`], tone: e.statut === 'refus' ? 'attention' as const : undefined };
      }), empty: 'Aucun site visité pour l\'instant.' },
    ];
    // Les sites à absorber (réglage du propriétaire : aucun par défaut).
    const sitesA = m.absorbeur.liste();
    const etatSite = (x: (typeof sitesA)[number]): string => x.etat === 'refuse' ? 'refusé' : x.etat === 'en-pause' ? 'en pause' : x.absorbeLe ? `absorbé le ${quandLocal(x.absorbeLe).slice(0, 5)} · suivi` : x.decouvert || x.file.length ? 'en cours' : 'à explorer';
    const sites: Section[] = [
      { kind: 'form', title: 'Absorber un site', onglet: 'Sites', action: 'absorber', submit: 'Absorber', params: [{ key: 'adresse', label: 'Adresse du site (https://… ou nom du site)', kind: 'text', required: true }], aide: `Odin lit le site EN ENTIER, en priorité : son plan, ses fils d\'actualité, puis ses pages, une toutes les ${r.robot.delaiSiteMs / 1000} s au moins (plus si le site le demande), ${r.robot.pagesParSiteAbsorber.toLocaleString('fr-FR')} par jour et par site au plus (réglable dans Réglages), dans ses consignes des robots et les budgets du jour. Ensuite il suit ses nouveautés. Tu peux aussi le dire : « absorbe ce site … ». Place gardée : au plus ${FILE_MAX.toLocaleString('fr-FR')} adresses en attente par site et ${FILE_TOTAL_MAX.toLocaleString('fr-FR')} en tout (aujourd'hui ${m.absorbeur.enFileTotal().toLocaleString('fr-FR')}) ; au-delà, elles reviennent au plan suivant.` },
      { kind: 'table', title: `Sites à absorber (${sitesA.length})`, onglet: 'Sites', columns: ['Site', 'État', 'Lues', 'Reste', 'Vu le'], rows: sitesA.map((x) => {
        const est = m.absorbeur.estimation(x);
        return {
          cells: [court(x.id, 28), etatSite(x), `${x.lues} / ${x.lues + x.file.length}`, x.file.length ? `${x.file.length} (à ce rythme, ${est?.texte ?? '—'})` : '—', x.derniereVisite ? quandLocal(x.derniereVisite) : '—'],
          tone: x.etat === 'refuse' ? 'attention' as const : x.absorbeLe ? 'bon' as const : undefined,
          actions: [
            x.etat === 'en-pause' ? { action: 'reprendre_site', label: 'Reprendre', input: { adresse: x.id } } : { action: 'pause_site', label: 'Pause', input: { adresse: x.id } },
            { action: 'retirer_site', label: 'Retirer', input: { adresse: x.id } },
          ],
        };
      }), empty: 'Aucun site à absorber : ajoute-en un ci-dessus (ou dis « absorbe ce site … »).' },
      { kind: 'table', title: 'Détail des sites', onglet: 'Sites', columns: ['Site', 'Ce qu\'il en sait'], rows: sitesA.map((x) => ({ cells: [court(x.id, 28), `${x.consignes ?? 'consignes pas encore lues'} · plan : ${x.plans.length ? 'oui' : 'non'} · fil : ${x.fils.length ? 'oui' : 'non'} · ${x.faits} fait(s) appris · ${pj(x)} page(s)/jour${x.refusees ? ` · ${x.refusees} refusée(s) par ses consignes` : ''}${x.raison ? ` · ${x.raison}` : ''}`] })), empty: '—' },
      { kind: 'form', title: 'Où trouver', onglet: 'Sites', action: 'ou_trouver', submit: 'Chercher', params: [{ key: 'quoi', label: 'Ce que tu cherches', kind: 'text', required: true }], aide: 'Odin te donne la page précise où il l\'a lu (titre, adresse, date de lecture).' },
    ];
    const recherches = [...m.traces.recherches()].reverse();
    const curiosite: Section[] = [
      { kind: 'form', title: 'Confier en priorité', onglet: 'Sujets', action: 'confier', submit: 'Confier', params: [{ key: 'quoi', label: 'Un sujet, ou des adresses publiques (https://…)', kind: 'text', required: true }], aide: 'Passe en tête de la liste, sans lever aucune limite : lecture seule, consignes des robots, budgets. Les vidéos, images et sons confiés attendent un passage suivant.' },
      { kind: 'table', title: `Sujets à apprendre (${manques.length})`, onglet: 'Sujets', columns: ['Sujet', 'Pourquoi', 'Priorité', 'État', 'Prochain essai'], rows: manques.slice(0, 60).map((x) => ({ cells: [court(x.sujet, 60), court(x.raison, 60), x.confie ? 'confié (en tête)' : String(x.priorite), x.etat.replace(/_/g, ' '), x.prochainEssai && x.prochainEssai > now ? quandLocal(x.prochainEssai) : 'dès que possible'], tone: x.confie ? 'bon' as const : undefined, actions: [{ action: 'retirer', label: 'Retirer', input: { id: x.id } }] })), empty: 'Rien en attente : Odin n\'a pas encore noté de manque.' },
      // Les recherches faites : la même question n'est pas reposée avant une semaine.
      { kind: 'table', title: `Recherches faites (${recherches.length})`, onglet: 'Sujets', columns: ['Quand', 'Question', 'Trouvé', 'Retenu'], rows: recherches.slice(0, 40).map((t) => ({ cells: [quandLocal(t.at), court(t.q, 60), `${t.resultats} page(s)`, `${t.retenus} fait(s)`] })), empty: 'Aucune recherche pour l\'instant.' },
    ];
    const i = m.interdits.lire();
    const interdits: Section[] = [
      { kind: 'form', title: 'Interdire', onglet: 'Réglages', action: 'interdire', submit: 'Interdire', params: [{ key: 'genre', label: 'Quoi', kind: 'select', options: ['sujet', 'site', 'dossier'], default: 'sujet', required: true }, { key: 'valeur', label: 'Le sujet, le site ou le chemin du dossier', kind: 'text', required: true }] },
      { kind: 'table', title: 'Interdits', onglet: 'Réglages', columns: ['Genre', 'Valeur'], rows: [
        ...i.sujets.map((v) => ({ cells: ['sujet', court(v, 70)], actions: [{ action: 'permettre', label: 'Lever (avec ton accord)', input: { genre: 'sujet', valeur: v } }] })),
        ...i.sites.map((v) => ({ cells: ['site', court(v, 70)], actions: [{ action: 'permettre', label: 'Lever (avec ton accord)', input: { genre: 'site', valeur: v } }] })),
        ...i.dossiers.map((v) => ({ cells: ['dossier', court(v, 70)], actions: [{ action: 'permettre', label: 'Lever (avec ton accord)', input: { genre: 'dossier', valeur: v } }] })),
      ], empty: 'Aucun interdit.' },
      { kind: 'table', title: 'Dossiers ouverts à Odin (lecture seule)', onglet: 'Réglages', columns: ['Dossier', 'État'], rows: m.maison.racines().map((x) => ({ cells: [court(x.dossier, 70), x.reel ? 'lisible' : `refusé : ${x.raison}`], tone: x.reel ? undefined : 'attention' as const, actions: [{ action: 'fermer_dossier', label: 'Fermer', input: { chemin: x.dossier } }] })), empty: 'Aucun dossier ouvert : Odin ne lit aucun de tes fichiers.' },
      { kind: 'form', title: 'Ouvrir un dossier à Odin', onglet: 'Réglages', action: 'ouvrir_dossier', submit: 'Ouvrir (avec ton accord)', params: [{ key: 'chemin', label: 'Chemin complet du dossier', kind: 'text', required: true }], aide: 'Lecture seule : Odin ne crée, ne modifie et ne supprime rien. Un lien ou une jonction qui mène ailleurs est refusé. Les images ne sont lues que si l\'œil d\'Odin est prêt.' },
    ];
    const budgets = (Object.keys(NOMS_BUDGET) as GenreBudget[]).map((g) => ({ cells: [NOMS_BUDGET[g], valeurBudget(g, utilise[g]), valeurBudget(g, r.budgets[g])], tone: utilise[g] >= r.budgets[g] && r.budgets[g] > 0 ? 'attention' as const : undefined }));
    const boutons = r.actif
      ? [{ action: 'couper', label: 'Couper tout', primary: true }, r.pause ? { action: 'reprendre', label: 'Reprendre (avec ton accord)' } : { action: 'pause', label: 'Pause' }, { action: 'tour', label: 'Apprendre maintenant' }]
      : [{ action: 'allumer', label: 'Rallumer (avec ton accord)', primary: true }];
    const reglages: Section[] = [
      { kind: 'actions', title: 'L\'interrupteur', onglet: 'Réglages', boutons, aide: r.actif ? `Allumé${r.pause ? ', en pause' : ''} : couper arrête tout aussitôt (plus aucune recherche, aucun robot, aucun dossier lu).` : 'Coupé : Odin n\'apprend plus tout seul.' },
      { kind: 'table', title: 'Budgets du jour', onglet: 'Réglages', columns: ['Quoi', 'Utilisé', 'Limite'], rows: budgets },
      { kind: 'form', title: 'Régler', onglet: 'Réglages', action: 'regler', submit: 'Enregistrer', params: [
        { key: 'vitesse', label: 'Vitesse', kind: 'select', options: ['douce', 'normale', 'soutenue'], default: r.vitesse },
        { key: 'recherches', label: 'Recherches par jour', kind: 'number', default: r.budgets.recherches },
        { key: 'pages', label: 'Pages lues par jour', kind: 'number', default: r.budgets.pages },
        { key: 'octetsMo', label: 'Taille téléchargée par jour (Mo)', kind: 'number', default: Math.round(r.budgets.octets / MO) },
        { key: 'fichiers', label: 'Fichiers des dossiers ouverts par jour', kind: 'number', default: r.budgets.fichiers },
        { key: 'fichiersMo', label: 'Taille lue dans les dossiers ouverts par jour (Mo)', kind: 'number', default: Math.round(r.budgets.octetsFichiers / MO) },
        { key: 'heures', label: 'Heures du travail léger', kind: 'text', default: r.heures.map((p) => `${p.de}-${p.a}`).join(', ') },
        { key: 'heuresLourd', label: 'Heures du travail lourd', kind: 'text', default: r.heuresLourd.map((p) => `${p.de}-${p.a}`).join(', ') },
        { key: 'nePasGarder', label: 'Ne rien garder de ce qu\'Odin lit', kind: 'boolean', default: r.nePasGarder },
        { key: 'modeleEnLigne', label: 'Autoriser un modèle en ligne ou payant', kind: 'boolean', default: r.modeleEnLigne },
        { key: 'pagesParSite', label: 'Pages par jour et par site à absorber', kind: 'number', default: r.robot.pagesParSiteAbsorber },
        { key: 'attenteS', label: 'Attente entre deux pages d\'un même site (secondes, 2 au moins)', kind: 'number', default: r.robot.delaiSiteMs / 1000 },
      ], aide: 'Le rythme (pages lues par jour, pages par site, attente entre deux pages) se règle d\'un clic : un site qui demande plus d\'attente l\'obtient toujours, et après une erreur ou un « trop de demandes » l\'attente n\'est jamais raccourcie. Baisser un budget ou réduire les heures se fait d\'un clic ; monter un autre budget, élargir les heures, autoriser un modèle en ligne ou ne plus appliquer « ne pas garder » demandent ton accord. Le travail s\'arrête toujours dès qu\'Odin doit répondre.' },
    ];
    return {
      subtitle: `${etat} · vitesse ${r.vitesse} · ${utilise.recherches}/${r.budgets.recherches} recherche(s) et ${utilise.pages}/${r.budgets.pages} page(s) aujourd'hui`,
      kpis, onglets: ['Appris', 'Sites', 'Sujets', 'Réglages'],
      sections: [...appris, ...sites, ...curiosite, ...reglages, ...interdits],
    };
  }

  return {
    id: 'mathesis', name: 'Mathésis', family: 'Données',
    what: 'Odin apprend tout seul : il cherche ce qu\'il ne sait pas, lit des pages publiques et les dossiers que tu lui ouvres, recoupe ses sources et le range dans sa mémoire — borné, visible et coupable d\'un clic.',
    does: [
      'tient une liste de curiosité : questions restées sans réponse sûre, faits à vérifier ou périmés, sujets qui reviennent ; ce que tu confies passe en tête',
      'cherche avec le moteur de recherche d\'Odin, lit les pages et recoupe : deux sources indépendantes = « confirmé », une seule = « à vérifier »',
      'un robot de lecture des pages PUBLIQUES : lecture seule, consignes des robots respectées, délai entre deux demandes au même site, plafonds par jour, ne relit que ce qui a changé',
      'lit les dossiers que tu lui ouvres, page par page, en lecture seule, jamais ailleurs',
      'range ce qu\'il retient dans la mémoire d\'Odin avec la source, la date et le niveau de confiance, et nourrit Noûs ; une page ne devient jamais une consigne et n\'écrase jamais ce que tu as dit',
      'budgets par jour, heures permises, pause, interrupteur unique ; s\'arrête dès qu\'Odin doit répondre ; aucun modèle en ligne ou payant sans ton réglage',
      'la page « Ce qu\'Odin a appris tout seul » : ce qu\'il a cherché, lu, retenu et laissé, avec ses sources ; tu corriges, effaces et interdis',
    ],
    // Les logiciels équivalents ne sont nommés QUE dans « Alternative à » (SIMILAIRES de names.ts), jamais ici.
    from: [], upstream: [],
    words: ['mathesis', 'apprends tout seul', 'ce qu odin a appris', 'qu as tu appris', 'curiosite', 'robot de lecture', 'absorbe ce site', 'sites a absorber', 'ou trouver', 'ou est explique'],
    actions: [tourA, confierA, retirerA, interdireA, permettreA, couperA, allumerA, pauseA, reprendreA, reglerA, ouvrirA, fermerA, effacerA, corrigerA, absorberA, etatSiteA, pauseSiteA, reprendreSiteA, retirerSiteA, rythmeSiteA, ouTrouverA],
    start(ctx) {
      const m = moteur(ctx);
      // Pose la base MATHESIS_ODIN ; dès qu'elle est prête, chaque écriture y est reportée (contenus chiffrés).
      brancherMathesis(ctx.dir, (b) => { const mag = m.magasin as { brancherMiroir?: (x: typeof b) => void }; mag.brancherMiroir?.(b); });
      // Un fichier de protection illisible : Mathésis s'est mise dans l'état le plus prudent ; le propriétaire le sait.
      for (const a of m.alertes()) ctx.alert({ level: 'moyenne', title: 'Mathésis : un fichier de protection était illisible', detail: a, key: `mathesis:illisible:${a.slice(0, 40)}` });
      if (ctx.settings.annonce !== 'v1') {
        ctx.alert({ level: 'info', title: 'Odin apprend maintenant tout seul (Mathésis), en vitesse douce.', detail: 'Il cherche et lit des pages publiques, s\'arrête dès qu\'il doit te répondre ; un seul interrupteur dans la page Mathésis coupe tout.', key: 'mathesis:annonce' });
        ctx.saveSettings({ annonce: 'v1' });
      }
    },
    stop() { for (const m of moteurs.values()) m.abandonner(); },
    // Le premier passage vient 20 à 40 s après le lancement d'Odin, puis toutes les 15 minutes (pausable dans Talos).
    // Le passage ne bloque pas la surveillance : le tour tourne à côté, borné par ses budgets et sa garde.
    watch: {
      every: 900,
      run(ctx) {
        if (tacheEnPause('mathesis', 'apprendre')) return;
        const m = moteur(ctx);
        if (m.enCours() || !m.reglages().actif) return;
        void m.tour().then((b) => ctx.saveSettings({ dernierTour: ctx.now().toISOString(), dernierBilan: b.phrase })).catch(() => { /* jamais bloquant */ });
      },
    },
    taches: () => [tache],
    view: (ctx) => vue(ctx),
  };
}

