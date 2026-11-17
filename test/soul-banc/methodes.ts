// Banc de Soul : les MÉTHODES mesurées. Une méthode reçoit une phrase (et, pour une relance, le tour précédent et
// l'appli active) et rend ses choix triés, sa décision et sa confiance :
//   { choix: [{ appli, action, score }], decision: 'seul' | 'trois' | 'main', confiance (entre 0 et 1) }
//   - seul  : elle agirait seule (premier choix) ;
//   - trois : elle proposerait ses trois premiers choix ;
//   - main  : « je ne suis pas sûr » : elle passe la main (au grand modèle ou au propriétaire).
// Une liste vide ou un premier choix sans appli (appli: null) veut dire « pas encore » (hors du champ d'Odin).
//
// Méthodes déjà présentes, SANS modèle (le produit n'est pas modifié, seulement appelé) :
//   - « mots »  : la recherche par mots d'aujourd'hui (appsFor de src/valhalla/besoin.ts : les mots des applis, les
//                 tournures des langues et les usages connus). Elle ne voit pas le contexte d'une relance.
//   - « logos » : la compréhension sans IA du produit (understand de src/valhalla/huginn.ts), puis les choix de
//                 « mots » pour compléter les rangs 2 et 3. Une relance est jouée dans la même session (le tour
//                 précédent d'abord), comme dans le produit.
//   - « aiguilleur » : emplacement réservé. Si src/brain/nous/aiguilleur.ts existe, il est chargé (voir chargerAiguilleur) ;
//                 sinon la méthode est simplement absente, sans erreur.
// Les confiances de « mots » et « logos » sont des NIVEAUX fixés ici (ces méthodes n'en donnent pas) : la calibration
// mesurée dit ce qu'ils valent.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Catalogue } from './catalogue.ts';
import type { Choix, Contexte, Decision, Reponse } from './mesure.ts';

export interface Methode {
  nom: string;
  description: string;
  repondre(phrase: string, contexte?: Contexte): Reponse | Promise<Reponse>;
  fin?(): void;
}

type Valhalla = import('../../src/valhalla/service.ts').Valhalla;
export interface Monde { v: Valhalla; catalogue: Catalogue; home: string; fin(): void }

/** Un monde d'essai : toutes les applis du produit, rien de lancé sur la machine (commandes notées, réseau coupé). */
export async function monde(home: string, catalogue: Catalogue): Promise<Monde> {
  const { allModules } = await import('../../src/valhalla/odin.ts');
  const { Valhalla } = await import('../../src/valhalla/service.ts');
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: { venus: {}, voice: {} } } as never), {
    run: async () => ({ code: 1, out: '', err: 'banc : rien n\'est lancé' }),
    fetch: (async () => { throw new Error('banc : réseau coupé'); }) as unknown as typeof fetch,
    notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date('2026-11-17T10:00:00'),
  });
  return { v, catalogue, home, fin: () => { try { v.stop(); } catch { /* rien de lancé */ } } };
}

const borne = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** « mots » : appsFor (les trois meilleures applis et, quand elle en voit une, leur action). */
export async function methodeMots(m: Monde): Promise<Methode> {
  const { appsFor } = await import('../../src/valhalla/besoin.ts');
  return {
    nom: 'mots', description: 'recherche par mots d\'aujourd\'hui (appsFor, src/valhalla/besoin.ts)',
    repondre(phrase: string): Reponse {
      const r = appsFor(m.v, phrase, 3);
      const choix: Choix[] = r.map((x) => ({ appli: x.m.id, action: x.action?.id ?? null, score: x.score }));
      if (!choix.length) return { choix: [], decision: 'main', confiance: 0 };
      const s1 = choix[0].score, s2 = choix[1]?.score ?? 0;
      // Niveau : l'avance du premier sur le second, ramenée entre 0 et 1.
      const confiance = borne(s1 / (s1 + s2 + 1));
      const decision: Decision = confiance >= 0.75 ? 'seul' : 'trois';
      return { choix, decision, confiance };
    },
  };
}

/** « logos » : understand (la décision du produit sans IA), complété par « mots » pour les rangs 2 et 3. */
export async function methodeLogos(m: Monde): Promise<Methode> {
  const { understand, forgetPending } = await import('../../src/valhalla/huginn.ts');
  const mots = await methodeMots(m);
  let tour = 0;
  return {
    nom: 'logos', description: 'compréhension sans IA du produit (understand, src/valhalla/huginn.ts) + appsFor aux rangs 2 et 3',
    async repondre(phrase: string, contexte?: Contexte): Promise<Reponse> {
      const session = `banc-${++tour}`;
      try {
        const precedent = typeof contexte?.precedent === 'string' ? contexte.precedent : undefined;
        if (precedent) await understand(m.v, precedent, session);
        const u = await understand(m.v, phrase, session);
        const autres = (mots.repondre(phrase) as Reponse).choix;
        const completer = (premier: Choix) => [premier, ...autres.filter((c) => !(c.appli === premier.appli && c.action === premier.action))].slice(0, 3);
        if (u?.kind === 'action') {
          const doute = Boolean(u.doubt);
          return { choix: completer({ appli: u.module, action: u.action, score: 1 }), decision: doute ? 'trois' : 'seul', confiance: doute ? (u.near ? 0.6 : 0.4) : 0.9 };
        }
        if (u?.kind === 'ask') return { choix: completer({ appli: u.module, action: u.action, score: 1 }), decision: 'seul', confiance: 0.8 };
        // « dit » (pas compris, pas encore, hésitation) ou manip : le produit ne choisit aucune action.
        return { choix: [], decision: 'main', confiance: u?.kind === 'say' && u.unsure ? 0.3 : 0.1 };
      } finally { forgetPending(session); }
    },
  };
}

/** Chemin attendu de l'aiguilleur sans réseau (écrit par un autre chantier). */
export const CHEMIN_AIGUILLEUR = fileURLToPath(new URL('../../src/brain/nous/aiguilleur.ts', import.meta.url));

/**
 * Charge l'aiguilleur s'il existe. Formes acceptées de src/brain/nous/aiguilleur.ts (la première trouvée) :
 *   - export async function methodeBanc(o: { catalogue, home }): Promise<{ repondre(phrase, contexte?) }>
 *   - export async function creerAiguilleur(o: { catalogue, home }): Promise<{ aiguiller(phrase, contexte?) }>
 *   - export function aiguiller(phrase, contexte?)
 * La réponse peut nommer l'appli `appli` ou `module` ; elle est remise au format du banc.
 * Absent ou illisible : rend undefined et la raison (jamais d'exception).
 */
export async function chargerAiguilleur(m: Monde): Promise<{ methode?: Methode; raison?: string }> {
  if (!existsSync(CHEMIN_AIGUILLEUR)) return { raison: 'src/brain/nous/aiguilleur.ts n\'existe pas encore' };
  try {
    const mod = await import('../../src/brain/nous/aiguilleur.ts' as string) as Record<string, unknown>;
    let f: ((p: string, c?: Contexte) => unknown) | undefined;
    if (typeof mod.methodeBanc === 'function') { const o = await (mod.methodeBanc as (x: unknown) => Promise<{ repondre: typeof f }>)({ catalogue: m.catalogue, home: m.home }); f = o.repondre?.bind(o); }
    else if (typeof mod.creerAiguilleur === 'function') { const o = await (mod.creerAiguilleur as (x: unknown) => Promise<{ aiguiller: typeof f }>)({ catalogue: m.catalogue, home: m.home }); f = o.aiguiller?.bind(o); }
    else if (typeof mod.aiguiller === 'function') f = mod.aiguiller as typeof f;
    if (!f) return { raison: 'aiguilleur.ts n\'exporte ni methodeBanc, ni creerAiguilleur, ni aiguiller' };
    const g = f;
    return { methode: { nom: 'aiguilleur', description: 'aiguilleur sans réseau (src/brain/nous/aiguilleur.ts)', repondre: async (p, c) => remettreEnForme(await g(p, c)) } };
  } catch (e) { return { raison: `aiguilleur.ts illisible : ${String((e as Error)?.message ?? e).slice(0, 200)}` }; }
}

/** Remet une réponse d'une autre forme au format du banc (choix triés par score décroissant). */
export function remettreEnForme(x: unknown): Reponse {
  const o = (x ?? {}) as { choix?: unknown[]; decision?: unknown; confiance?: unknown };
  const choix: Choix[] = (Array.isArray(o.choix) ? o.choix : []).map((c) => {
    const y = (c ?? {}) as Record<string, unknown>;
    const appli = (y.appli ?? y.module ?? null) as string | null, action = (y.action ?? null) as string | null;
    return { appli: appli === 'aucune' ? null : appli, action, score: Number(y.score ?? 0) };
  }).sort((a, b) => b.score - a.score);
  const decision: Decision = o.decision === 'seul' || o.decision === 'trois' || o.decision === 'main' ? o.decision : 'main';
  return { choix, decision, confiance: borne(Number(o.confiance ?? 0)) };
}

/** Les méthodes demandées par leur nom ; celles qui manquent sont dites, sans erreur. */
export async function methodes(noms: string[], m: Monde): Promise<{ pretes: Methode[]; absentes: Array<{ nom: string; raison: string }> }> {
  const pretes: Methode[] = [], absentes: Array<{ nom: string; raison: string }> = [];
  for (const n of noms) {
    if (n === 'mots') pretes.push(await methodeMots(m));
    else if (n === 'logos') pretes.push(await methodeLogos(m));
    else if (n === 'aiguilleur') { const a = await chargerAiguilleur(m); if (a.methode) pretes.push(a.methode); else absentes.push({ nom: n, raison: a.raison ?? '?' }); }
    else absentes.push({ nom: n, raison: 'méthode inconnue (connues : mots, logos, aiguilleur)' });
  }
  return { pretes, absentes };
}
