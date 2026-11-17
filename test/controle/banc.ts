// L'entraînement de contrôle : ce dont les scénarios ont besoin pour parler à un Odin JETABLE (dossier temporaire,
// fournisseur de modèle simulé, aucune vraie messagerie, aucun réseau).
//
// Un scénario est une petite fonction qui ouvre un Odin, lui dit des phrases comme le propriétaire, et regarde ce qui
// s'est VRAIMENT passé : appels au modèle (0 = « fait sans IA »), outils lancés, validations demandées, fichiers
// écrits, et ce que le Cerveau a donné au modèle (les notes et les applis placées dans son contexte).

process.env.ODIN_ESSAI = '1';
process.env.ODIN_NO_VOICE_INSTALL = '1';

import type { Script } from '../../src/providers/mock.ts';
import type { OdinConfig } from '../../src/config.ts';
import type { TestOdin } from '../helpers.ts';

export type Partie = 'sans-modele' | 'modele-local';
export interface Verdict { ok: boolean | 'ignore'; detail: string; /** Pour CE tour : le scénario n'a pu mesurer que le contexte (Odin a passé la main au modèle simulé). */ nature?: 'discutable' }
export interface Scenario {
  id: string;
  domaine: string;
  titre: string;
  partie: Partie;
  /** L'exigence du cahier ou l'élément du lot 1 que ce scénario vérifie. */
  exigence: string;
  /** Une partie est simulée (réseau, fichier, appareil) : la note le dit. */
  simule?: boolean;
  /** Ce qui est attendu, en une phrase. */
  attendu: string;
  /** « pas-code » : la fonction attendue n'est pas encore écrite (prévue au lot 1) — un échec n'est pas un défaut.
   *  « discutable » : le scénario mesure autre chose que ce qu'il annonce (ex. le contexte donné à un modèle simulé). */
  nature?: 'pas-code' | 'discutable';
  jouer(): Promise<Verdict>;
}

// ------------------------------------------------------------------------------------------------ réseau coupé
/** Le réseau est coupé pour tout le contrôle : chaque tentative est comptée. Un scénario peut poser sa propre réponse. */
export const reseau = { tentatives: 0, adresses: [] as string[], repondre: undefined as undefined | ((url: string) => Response | undefined) };
const fetchOrigine = globalThis.fetch;
globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
  const url = typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url;
  // Les appels à l'Odin jetable lui-même (127.0.0.1) restent permis.
  if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return fetchOrigine(entree as never, init);
  reseau.tentatives++; reseau.adresses.push(url);
  const r = reseau.repondre?.(url);
  if (r) return r;
  throw new Error('réseau coupé par l\'entraînement de contrôle');
}) as typeof fetch;

// ------------------------------------------------------------------------------------------------ un Odin jetable
export interface Session {
  o: TestOdin;
  envoyes: Array<{ peer: string; text: string }>;
  /** Les demandes de validation envoyées au propriétaire (la passerelle les pose sur le canal : « /yes <id> »). */
  validations: Array<{ id: string; peer: string; texte: string; toujoursPossible: boolean }>;
  /** Dit une phrase comme le propriétaire (ou `peer`), rend ce qu'Odin a envoyé pendant ce tour. */
  dire(texte: string, peer?: string, voix?: boolean): Promise<{ texte: string; appelsModele: number; ms: number }>;
  /** Le contexte (système + messages) du dernier appel au modèle. */
  contexte(): string;
  /** Les applis citées en tête des « Notes du Cerveau » du dernier appel au modèle (dans l'ordre). */
  notesCerveau(): string[];
  /** Le dernier résultat d'un outil vu par le modèle. */
  resultatOutil(nom: string): string | undefined;
  fermer(): void;
}

export async function ouvrir(o: { script?: Script; applis?: boolean; config?: (c: OdinConfig) => OdinConfig; approuver?: boolean | 'always'; proprietaires?: string[] } = {}): Promise<Session> {
  const { makeOdin } = await import('../helpers.ts');
  const { Gateway } = await import('../../src/bifrost/gateway.ts');
  const script: Script = o.script ?? Array.from({ length: 30 }, () => ({ text: 'RÉPONSE DU MODÈLE SIMULÉ' }));
  const odin = makeOdin(script, { approve: o.approuver ?? false, config: o.config });
  const envoyes: Array<{ peer: string; text: string }> = [];
  const validations: Session['validations'] = [];
  // Le propriétaire simulé répond aux demandes de validation selon `approuver` (non par défaut).
  const reponse = o.approuver === 'always' ? 'always' : o.approuver ? 'yes' : 'no';
  // eslint-disable-next-line prefer-const
  let gw: InstanceType<typeof Gateway>;
  const canal = { name: 'controle', interactive: true, async start() {}, async stop() {},
    async send(peer: string, text: string, opts?: { approval?: { id: string; grantable?: boolean } }) {
      envoyes.push({ peer, text });
      if (opts?.approval) { validations.push({ id: opts.approval.id, peer, texte: text, toujoursPossible: !!opts.approval.grantable }); const id = opts.approval.id; setImmediate(() => { void gw.handle({ channel: 'controle', peer, name: peer, text: `/${reponse} ${id}` }); }); }
    } };
  gw = new Gateway(odin, { owners: { controle: o.proprietaires ?? ['moi'] } }).add(canal as never);
  let arreterApplis: (() => void) | undefined;
  if (o.applis) {
    const { allModules, startValhalla } = await import('../../src/valhalla/odin.ts');
    arreterApplis = startValhalla(odin, async () => {}, { modules: allModules(odin) });
  }
  const dernier = () => odin.provider.calls.at(-1);
  return {
    o: odin, envoyes, validations,
    async dire(texte, peer = 'moi', voix = false) {
      const n0 = envoyes.length, a0 = odin.provider.calls.length, t0 = performance.now();
      await gw.handle({ channel: 'controle', peer, name: peer, text: texte, ...(voix ? { voice: true } : {}) });
      return { texte: envoyes.slice(n0).map((e) => e.text).join('\n'), appelsModele: odin.provider.calls.length - a0, ms: Math.round(performance.now() - t0) };
    },
    contexte() { const c = dernier(); return c ? `${c.system ?? ''}\n${c.messages.map((m) => m.content).join('\n')}` : ''; },
    notesCerveau() {
      const c = dernier(); const s = c?.system ?? '';
      const i = s.indexOf('Notes du Cerveau'); if (i < 0) return [];
      return [...s.slice(i, i + 4000).matchAll(/^- \[\[([^\]]+)\]\]/gm)].map((m) => m[1]);
    },
    resultatOutil(nom) {
      for (let k = odin.provider.calls.length - 1; k >= 0; k--) {
        const m = [...odin.provider.calls[k].messages].reverse().find((x) => x.role === 'tool' && (x as { toolName?: string }).toolName === nom);
        if (m) return m.content;
      }
      return undefined;
    },
    fermer() { try { arreterApplis?.(); } catch { /* déjà arrêté */ } try { void gw.stop(); } catch { /* rien */ } try { odin.cleanup(); } catch { /* Windows : un fichier encore ouvert dans le dossier jetable */ } },
  };
}

/** Un appel d'outil scripté pour le modèle simulé. */
export const appel = (name: string, input: Record<string, unknown>) => ({ toolCalls: [{ id: `c_${Math.random().toString(36).slice(2, 8)}`, name, input }] });
export const sans = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const ok = (cond: boolean, detail: string): Verdict => ({ ok: cond, detail });
