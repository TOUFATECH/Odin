// Écho · mode « Conversation » : le pont vers la mémoire d'Odin (Mnémosyne). La mémoire d'Odin est EN CLAIR sur le
// disque (src/muninn, fichiers JSONL) : on n'y met donc JAMAIS la transcription ni le résumé. Seul un POINTEUR NEUTRE
// y entre — un titre, l'identifiant de la conversation, la date, les langues, le nombre de tours — pour qu'Odin
// retrouve la conversation (« retrouve ma conversation avec le livreur japonais de mardi ») ; le détail reste chiffré
// dans la base de l'appli (ECHO_ODIN).
//
// On réutilise le patron de base/trace.ts : un singleton branché au démarrage (odin.ts) qui appelle muninn.remember /
// muninn.forget. Le module ne connaît pas muninn (pas de couplage, pas de cycle).

/** Ce qui entre en mémoire : un pointeur neutre, jamais de secret. */
export interface PointeurConversation {
  conv: string;
  /** titre court, lisible (les mots du propriétaire, ou un titre neutre calculé) */
  titre: string;
  /** vrai si le titre vient du propriétaire (origine « owner ») plutôt que calculé */
  parProprietaire?: boolean;
  langues: string[];
  nTours: number;
  date: string;
}
export interface HooksMemoire {
  noter(p: PointeurConversation): void;
  oublier(conv: string): void;
}

let hooks: HooksMemoire | undefined;
/** Branche (ou débranche) la mémoire d'Odin. Appelé une fois au démarrage (odin.ts). */
export function brancherMemoireConversation(h: HooksMemoire | undefined): void { hooks = h; }

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const net = (t: string) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);

/** Un titre neutre par défaut : « Conversation traduite du 2026-11-16, français ↔ japonais, 12 tours ». */
export function titreNeutre(p: Pick<PointeurConversation, 'date' | 'langues' | 'nTours'>): string {
  const jour = (p.date || new Date().toISOString()).slice(0, 10);
  const langues = p.langues.length ? p.langues.join(' ↔ ') : 'langues inconnues';
  return `Conversation traduite du ${jour}, ${langues}, ${p.nTours} tour${p.nTours > 1 ? 's' : ''}`;
}

/** Range (ou met à jour) le pointeur neutre d'une conversation dans la mémoire d'Odin. */
export function noterConversation(p: PointeurConversation): void {
  if (!ID.test(p.conv) || !hooks) return;
  hooks.noter({ ...p, titre: net(p.titre) || titreNeutre(p), langues: p.langues.map(net).filter(Boolean).slice(0, 4), nTours: Math.max(0, Math.trunc(p.nTours)) });
}
/** Retire le pointeur d'une conversation (suppression). */
export function oublierConversation(conv: string): void {
  if (!ID.test(conv) || !hooks) return;
  hooks.oublier(conv);
}
