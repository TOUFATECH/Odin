// Migration « une seule conversation » : les anciennes conversations du propriétaire (« web:c-… », ouvertes par
// « Nouvelle » dans la Discussion) sont fondues dans sa conversation unique. Décision du propriétaire du 19/11/2026
// (« Les fondre en une ») : dans l'ordre des dates, le titre de chacune en séparateur, rien n'est perdu.
//
// Fusion LOGIQUE : aucun message n'est déplacé, réécrit ni effacé ; aucune session non plus. Le fil (src/muninn/fil.ts)
// assemble déjà ces conversations par date ; la fusion pose seulement, dans les réglages de la mémoire (kv), une marque
// « fondue:<session> » par ancienne conversation (titre affiché, date du premier message, nombre de messages) et la
// marque « migration-conversation-unique » qui empêche de la refaire.
//
// Dans cet ordre, une seule fois :
//   1. rien à fondre (aucune ancienne conversation) : la marque est posée, rien d'autre (aucune copie) ;
//   2. une copie de sécurité des fichiers de la mémoire (memoire/*.jsonl, tels quels) dans
//      memoire/avant-conversation-unique-AAAA-MM-JJ/, puis RELUE : même taille pour chaque fichier, et pour chaque
//      conversation concernée le même nombre de messages que dans la mémoire. Copie ratée ou différente : la copie
//      incomplète est retirée (seulement les fichiers que cette tentative a écrits), AUCUNE marque n'est posée, et le
//      propriétaire est prévenu UNE fois (file « deferred » : son prochain message d'Odin ou le rapport du matin) ;
//      le démarrage suivant réessaie, sans le redire ;
//   3. les marques « fondue: », puis la marque de la migration (en dernier : une coupure au milieu fait tout refaire,
//      avec une nouvelle copie, les marques déjà posées sont réécrites à l'identique).
//
// Défaire (« odin conversation defondre ») : les marques « fondue: » sont retirées ; la marque de la migration passe à
// « defondue » pour qu'un démarrage suivant ne refonde pas tout seul. La copie n'est jamais touchée.
// Limite connue : lancée pendant qu'Odin tourne, la commande est défaite en silence (l'Odin en marche réécrit ses
// réglages, marques comprises, à sa prochaine compaction) ; elle ne fait qu'avertir de l'arrêter d'abord.
//
// Hors de la fusion : la conversation d'un membre (« web:membre-… »), les messageries, les portes d'autres écrans
// (maison, vénus, voix, cerveau, réglages), les sous-agents, et « web:raccourci » (les raccourcis du téléphone, POST
// /api/ask) : le fil le montre déjà, chaque message marqué « depuis le téléphone » (réponse du propriétaire du 19/11,
// « Oui, avec une étiquette ») ; le fil ne lit pas les marques, donc aucune n'est posée pour lui (`inclureRaccourci`
// reste désactivé, et la fusion déjà faite n'est pas refaite).

import { constants, copyFileSync, mkdirSync, readdirSync, rmdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Mnemosyne } from '../muninn/store.ts';
import { Table } from '../muninn/tables.ts';
import { SESSION_PRINCIPALE, sessionsDuFil } from '../muninn/fil.ts';

export const MARQUE_FUSION = 'migration-conversation-unique';
/** La copie a raté : gardé pour ne prévenir le propriétaire qu'une fois (rien d'autre n'est changé). */
export const MARQUE_ECHEC = 'migration-conversation-unique-echec';
export const PREFIXE_FONDUE = 'fondue:';
export const SESSION_RACCOURCI = 'web:raccourci';
/** Le réglage qui marquerait aussi les raccourcis du téléphone : désactivé (le fil les montre sans marque). */
export const INCLURE_RACCOURCI = false;
export const DOSSIER_COPIE = 'avant-conversation-unique';

export type MemoireFusion = Pick<Mnemosyne, 'dir' | 'listSessions' | 'allMessages' | 'getKv' | 'setKv' | 'kvPrefix'>;

export interface MarqueFusion {
  at: string;
  /** fondue : marques posées ; rien : aucune ancienne conversation ; defondue : marques retirées par la commande. */
  etat: 'fondue' | 'rien' | 'defondue';
  sessions: number;
  messages: number;
  /** Le dossier de la copie, relatif au dossier de la mémoire. */
  copie?: string;
  defondue?: string;
}
export interface MarqueFondue { titre: string; debut: number; messages: number; at: string }

export interface FusionDeps {
  mu: MemoireFusion;
  /** La langue du propriétaire (Réglages → Voix), pour le message d'échec. */
  langue?: string;
  inclureRaccourci?: boolean;
  /** Copie d'un fichier (les essais la remplacent pour simuler un disque plein). */
  copier?(de: string, vers: string): void;
  maintenant?(): number;
}

export interface ResultatFusion { fait: boolean; raison?: 'deja' | 'rien' | 'sans-dossier' | 'copie'; sessions: number; messages: number; copie?: string }

// Le message d'échec, dans la langue du propriétaire ; une langue sans texte reçoit l'anglais, aucune (ou « auto ») le
// français. Japonais : à faire relire.
const ECHEC: Record<string, string> = {
  fr: '🗂️ Je voulais réunir tes anciennes conversations en une seule, mais la copie de sécurité de ma mémoire n\'a pas pu être faite (disque plein ou illisible ?). Je n\'ai rien changé : tes conversations sont intactes. Je réessaierai au prochain démarrage.',
  en: '🗂️ I wanted to gather your old conversations into a single one, but the safety copy of my memory could not be made (disk full or unreadable?). I changed nothing: your conversations are intact. I will try again at the next start.',
  es: '🗂️ Quería reunir tus conversaciones anteriores en una sola, pero no se pudo hacer la copia de seguridad de mi memoria (¿disco lleno o ilegible?). No he cambiado nada: tus conversaciones están intactas. Lo intentaré de nuevo en el próximo arranque.',
  de: '🗂️ Ich wollte deine alten Unterhaltungen zu einer einzigen zusammenführen, aber die Sicherungskopie meines Gedächtnisses konnte nicht erstellt werden (Datenträger voll oder unlesbar?). Ich habe nichts verändert: Deine Unterhaltungen sind unversehrt. Ich versuche es beim nächsten Start erneut.',
  ja: '🗂️ 以前の会話を一つにまとめようとしましたが、記憶の安全コピーを作れませんでした（ディスクがいっぱいか、読み取れない可能性があります）。何も変更していません。会話はそのまま残っています。次回の起動時にもう一度試します。',
};
/** Le message d'échec de la copie, dans la langue donnée (sinon l'anglais, puis le français). Pur. */
export function messageEchec(langue: string | undefined): string {
  const code = (langue ?? '').toLowerCase().replace(/[-_].*$/, '').replace(/^auto$/, '');
  return ECHEC[code] ?? (code ? ECHEC.en : ECHEC.fr);
}

const lire = <T>(brut: string | undefined): T | undefined => { if (!brut) return undefined; try { return JSON.parse(brut) as T; } catch { return undefined; } };

/** Les anciennes conversations du propriétaire à fondre (celles que le fil lui montre, sauf la principale). */
export function anciennesConversations(mu: Pick<Mnemosyne, 'listSessions'>, inclureRaccourci = INCLURE_RACCOURCI): string[] {
  const toutes = mu.listSessions(Number.MAX_SAFE_INTEGER).map((s) => ({ id: s.id, channel: s.channel, title: s.title }));
  const ids = sessionsDuFil({ proprio: true }, toutes).filter((id) => id !== SESSION_PRINCIPALE && id !== SESSION_RACCOURCI && id.startsWith('web:'));
  if (inclureRaccourci && toutes.some((s) => s.id === SESSION_RACCOURCI)) ids.push(SESSION_RACCOURCI);
  return ids.sort();
}

/**
 * Copie les fichiers de la mémoire (memoire/*.jsonl) dans un dossier neuf, puis la relit. Rend le nom du dossier, ou
 * lève (la copie incomplète retirée : seulement les fichiers que cette tentative a écrits, puis le dossier s'il est vide).
 */
function copierEtRelire(dir: string, jour: string, concernees: string[], mu: MemoireFusion, copier: (de: string, vers: string) => void): string {
  let nom = '';
  for (let i = 1; i <= 50 && !nom; i++) {
    const essai = `${DOSSIER_COPIE}-${jour}${i > 1 ? `-${i}` : ''}`;
    try { mkdirSync(join(dir, essai), { mode: 0o700 }); nom = essai; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  }
  if (!nom) throw new Error('aucun nom libre pour la copie');
  const dest = join(dir, nom), ecrits: string[] = [];
  try {
    const fichiers = readdirSync(dir, { withFileTypes: true }).filter((f) => f.isFile() && f.name.endsWith('.jsonl')).map((f) => f.name);
    if (!fichiers.includes('messages.jsonl') || !fichiers.includes('sessions.jsonl')) throw new Error('fichiers des conversations introuvables');
    for (const f of fichiers) {
      const vers = join(dest, f);
      ecrits.push(vers);
      copier(join(dir, f), vers);
      if (statSync(vers).size !== statSync(join(dir, f)).size) throw new Error(`copie différente : ${f}`);
    }
    // Relecture : chaque conversation concernée est dans la copie, avec le même nombre de messages.
    const sessions = new Table<{ id: string } & Record<string, unknown>>(join(dest, 'sessions.jsonl'), (r) => r.id);
    const messages = new Table<{ id: number; session_id: string } & Record<string, unknown>>(join(dest, 'messages.jsonl'), (r) => r.id);
    const compte = new Map<string, number>();
    for (const m of messages.values()) compte.set(m.session_id, (compte.get(m.session_id) ?? 0) + 1);
    for (const id of concernees) {
      if (!sessions.has(id)) throw new Error(`conversation absente de la copie : ${id}`);
      if ((compte.get(id) ?? 0) !== mu.allMessages(id).length) throw new Error(`nombre de messages différent dans la copie : ${id}`);
    }
    return nom;
  } catch (e) {
    for (const f of ecrits) { try { rmSync(f, { force: true }); } catch { /* laissé */ } }
    try { rmdirSync(dest); } catch { /* pas vide (autre chose y a été mis) : laissé */ }
    throw e;
  }
}

/**
 * Au démarrage : fond les anciennes conversations du propriétaire dans sa conversation unique, une seule fois (voir
 * l'en-tête). Ne lève jamais. Ne touche à aucun message ni aucune session : seulement des marques dans les réglages.
 */
export function fondreConversations(d: FusionDeps): ResultatFusion {
  const mu = d.mu, now = d.maintenant?.() ?? Date.now(), at = new Date(now).toISOString();
  if (mu.getKv(MARQUE_FUSION)) return { fait: false, raison: 'deja', sessions: 0, messages: 0 };
  const anciennes = anciennesConversations(mu, d.inclureRaccourci ?? INCLURE_RACCOURCI);
  if (!anciennes.length) {
    mu.setKv(MARQUE_FUSION, JSON.stringify({ at, etat: 'rien', sessions: 0, messages: 0 } satisfies MarqueFusion));
    if (mu.getKv(MARQUE_ECHEC)) mu.setKv(MARQUE_ECHEC, '');
    return { fait: false, raison: 'rien', sessions: 0, messages: 0 };
  }
  // Une mémoire sans dossier (mémoire vive) : pas de copie possible, donc pas de fusion.
  if (!mu.dir) return { fait: false, raison: 'sans-dossier', sessions: 0, messages: 0 };
  const sessions = new Map(mu.listSessions(Number.MAX_SAFE_INTEGER).map((s) => [s.id, s]));
  const concernees = sessions.has(SESSION_PRINCIPALE) ? [...anciennes, SESSION_PRINCIPALE] : anciennes;
  let copie: string;
  try {
    copie = copierEtRelire(mu.dir, at.slice(0, 10), concernees, mu, d.copier ?? ((de, vers) => copyFileSync(de, vers, constants.COPYFILE_EXCL)));
  } catch (e) {
    console.error(`[conversation unique] copie de sécurité ratée, rien n'est changé : ${(e as Error).message}`);
    if (!mu.getKv(MARQUE_ECHEC)) {
      // Prévenu une fois : la file « deferred » (prochain message d'Odin, rapport du matin), puis la marque d'échec.
      try {
        const l = lire<unknown>(mu.getKv('deferred'));
        const file = Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string') : [];
        mu.setKv('deferred', JSON.stringify([...file, messageEchec(d.langue)].slice(-30)));
      } catch { /* file illisible : la marque d'échec suffit au journal */ }
      mu.setKv(MARQUE_ECHEC, JSON.stringify({ at, dit: true }));
    }
    return { fait: false, raison: 'copie', sessions: 0, messages: 0 };
  }
  const titres = mu.kvPrefix('title:');
  let total = 0;
  for (const id of anciennes) {
    const msgs = mu.allMessages(id), s = sessions.get(id);
    total += msgs.length;
    const marque: MarqueFondue = { titre: titres[id.slice(4)] || s?.title || '', debut: msgs[0]?.created_at ?? s?.created_at ?? now, messages: msgs.length, at };
    mu.setKv(`${PREFIXE_FONDUE}${id}`, JSON.stringify(marque));
  }
  mu.setKv(MARQUE_FUSION, JSON.stringify({ at, etat: 'fondue', sessions: anciennes.length, messages: total, copie } satisfies MarqueFusion));
  if (mu.getKv(MARQUE_ECHEC)) mu.setKv(MARQUE_ECHEC, '');
  console.error(`[conversation unique] ${anciennes.length} ancienne(s) conversation(s) fondue(s) (${total} messages, aucun déplacé) ; copie : ${copie}`);
  return { fait: true, sessions: anciennes.length, messages: total, copie };
}

/**
 * Défait la fusion : retire les marques « fondue: », la marque de la migration passe à « defondue » (un démarrage
 * suivant ne refond pas). Aucun message, aucune session, et la copie ne sont touchés.
 */
export function defondre(mu: Pick<Mnemosyne, 'getKv' | 'setKv' | 'kvPrefix'>, now = Date.now()): { fait: boolean; raison?: 'pas-fondue' | 'deja-defondue'; sessions: number; copie?: string } {
  const m = lire<MarqueFusion>(mu.getKv(MARQUE_FUSION));
  const marques = Object.keys(mu.kvPrefix(PREFIXE_FONDUE));
  if ((!m || m.etat === 'rien') && !marques.length) return { fait: false, raison: 'pas-fondue', sessions: 0 };
  if (m?.etat === 'defondue' && !marques.length) return { fait: false, raison: 'deja-defondue', sessions: 0, copie: m.copie };
  for (const k of marques) mu.setKv(`${PREFIXE_FONDUE}${k}`, '');
  const base: MarqueFusion = m ?? { at: new Date(now).toISOString(), etat: 'fondue', sessions: marques.length, messages: 0 };
  mu.setKv(MARQUE_FUSION, JSON.stringify({ ...base, etat: 'defondue', defondue: new Date(now).toISOString() } satisfies MarqueFusion));
  return { fait: true, sessions: marques.length, copie: base.copie };
}
