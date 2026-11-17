// Le juge de Mímir, et le journal de chaque jugement.
//
// Décision du propriétaire (17/11/2026) : Odin n'utilise aucun modèle qui ne soit pas le sien. Le juge est donc toujours
// le juge local (local.ts), du code sans modèle. Les autres juges sont retirés : Jev (TypeSafe), un grand modèle, la
// cascade (local puis un second juge en cas de doute) et l'avis croisé de plusieurs modèles sur les actions risquées. Un
// réglage `mimir.judge` qui les nomme encore est lu comme « local », avec un avertissement (le champ quitte le type de la
// configuration avec le noyau, plus tard).
//
// Sans eux, le juge local seul est parfois plus souple : les installations qui s'en servaient repassent en autonomie
// « prudent » au démarrage (src/migrations/aucun-modele-externe.ts), avant que ce juge soit construit.
import { appendFileSync } from 'node:fs';
import type { Redactor } from '../heimdall/redact.ts';
import type { Answers, Judge } from './client.ts';
import type { MimirConfig } from './decisions.ts';
import { localJudge } from './local.ts';

export interface JudgeDeps {
  redactor?: Redactor;
  logFile?: string;
}

/** Une adresse qui porte des données : une requête ou un fragment non vides, ou un long bloc de données dans le chemin. */
function adresseAvecDonnees(texte: string): boolean {
  const m = /https?:\/\/\S+/i.exec(texte);
  if (!m) return false;
  try {
    const u = new URL(m[0]);
    return u.search.length > 1 || u.hash.length > 1 || /[A-Za-z0-9+/_=-]{40,}/.test(u.pathname);
  } catch { return true; } // adresse illisible : dans le doute, on la traite comme un envoi
}

/**
 * Outils qui font vraiment sortir du texte de la machine, mais que le juge local ne reconnaît pas comme des envois (il
 * ne lit que les mots de l'action et les commandes). L'ancien juge les voyait ; sans ce plancher, une exfiltration après
 * un contenu non fiable passerait de « bloquée » à « demandée » (decisions.ts, règle « bloqué »). Le juge local les juge
 * donc AUSSI comme un message envoyé dehors, et on garde, question par question, l'avis le plus prudent (comme le
 * faisait l'avis croisé). Chaque outil est décidé dans le carnet de la tranche ; la clé est le nom de l'outil, la valeur
 * dit, d'après la description de l'action, si celle-ci porte des données dehors.
 *  - mail_send, browser_type : toujours (un courriel, du texte tapé dans une page).
 *  - notion : « publier » (une note du Cerveau devient une page Notion) ; chercher, lire, importer ne sortent rien.
 *  - browser_open, web_fetch : quand l'adresse porte des données (requête, fragment, long bloc dans le chemin).
 *  - ha_call : notify.* et rest_command.* (un texte envoyé à un téléphone, un service, une adresse) ; piloter un appareil
 *    de la maison ne sort rien.
 * Laissés hors du plancher : github_app (chercher et analyser ne portent qu'un nom de dépôt, installer est déjà « grave »),
 * net_share_files (lit la liste d'un dossier partagé d'une adresse privée de la maison), calendar_add et venus (les juger
 * comme des messages ferait demander chaque rendez-vous et chaque commande, même demandés).
 */
export const SORTIES: Readonly<Record<string, (description: string) => boolean>> = {
  mail_send: () => true,
  browser_type: () => true,
  notion: (d) => /^Notion publier\b/i.test(d),
  browser_open: adresseAvecDonnees,
  web_fetch: adresseAvecDonnees,
  ha_call: (d) => /^Maison : (notify|rest_command)\./i.test(d),
};
const PLANCHER_SORTIE = 0.8;
const noul = (x: Answers[string] | undefined) => (x?.type === 'noul' ? x.noul : undefined);

/** L'action fait-elle sortir des données (table `SORTIES`) ? Pur. */
export function sortDehors(action: Record<string, unknown> | undefined): boolean {
  const f = typeof action?.tool === 'string' && Object.hasOwn(SORTIES, action.tool) ? SORTIES[action.tool] : undefined;
  return !!f && f(typeof action?.description === 'string' ? action.description : '');
}

/** Le juge, avec un plancher « envoi » pour les outils qui sortent vraiment. Ne fait que durcir. */
export function plancherSorties(judge: Judge): Judge {
  return async (state, questions, signal) => {
    const a = await judge(state, questions, signal);
    const action = (state as { action?: Record<string, unknown> }).action;
    if (!('sends_out' in questions) || !action || !sortDehors(action)) return a;
    const vu = await judge({ ...state, action: { ...action, tool: 'send_message' } }, questions, signal);
    const out: Answers = { ...a };
    const garder = (q: string, f: (...n: number[]) => number, plancher?: number) => {
      const x = noul(a[q]), y = noul(vu[q]);
      if (x === undefined && y === undefined) return;
      const v = f(...[x, y, plancher].filter((n): n is number => n !== undefined));
      out[q] = { type: 'noul', noul: v };
    };
    garder('sends_out', Math.max, PLANCHER_SORTIE);
    garder('private_data', Math.max);
    garder('requested', Math.min); // « demandé » : le doute le plus fort reste
    return out;
  };
}

/** Enregistre l'état, les questions et les réponses de chaque jugement (rejouable, secrets masqués). */
export function withLog(judge: Judge, name: string, file?: string, redactor?: Redactor): Judge {
  if (!file) return judge;
  return async (state, questions, signal) => {
    const t0 = Date.now();
    const answers = await judge(state, questions, signal);
    const line = JSON.stringify({ t: new Date().toISOString(), judge: name, ms: Date.now() - t0, state, questions: Object.keys(questions), answers });
    try { appendFileSync(file, (redactor ? redactor.redact(line) : line) + '\n'); } catch { /* journal facultatif */ }
    return answers;
  };
}

/** Le juge de Mímir : toujours le juge local. Rien ne sort de la machine pour juger. */
export function buildJudge(cfg: MimirConfig, d: JudgeDeps = {}): { judge: Judge; name: string; warning?: string } {
  const mode: string = cfg.judge;
  const warning = mode === 'local' || mode === 'auto' ? undefined : `juge « ${mode} » retiré (Odin n'utilise aucun modèle qui ne soit pas le sien) : juge local seul`;
  return { judge: withLog(plancherSorties(localJudge()), 'local', d.logFile, d.redactor), name: 'local', warning };
}
