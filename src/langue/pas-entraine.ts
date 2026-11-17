// « Pas encore » : ce qu'une fonction répond tant que le modèle d'Odin qu'elle attend n'est pas entraîné.
//
// Décision du propriétaire (17/11/2026) : Odin n'utilise aucun modèle qui ne soit pas le sien. Une fonction qui
// passait par un modèle d'autrui (écoute, voix, traduction…) ne fait plus rien et le dit franchement, dans la langue
// de la personne. Les textes sont des données (`modeles` et `textes.modelePasEntraine` de src/langue/langues/*.json) ;
// une langue qui n'a pas encore ce texte reçoit l'anglais, puis le français. Sans langue donnée (ou « auto »), c'est
// la langue par défaut de la configuration, le français, puis l'anglais : l'appelant qui connaît la langue de la
// personne doit la passer.

import { table } from './tables.ts';

export type SorteModele = 'langue' | 'voix' | 'ecoute' | 'image' | 'sons' | 'lecture' | 'meteo';
/** Ce qui attend un modèle d'Odin, et la sorte de ce modèle. */
export const CHOSES = {
  ecouter: 'ecoute',
  parler: 'voix',
  copierVoix: 'voix',
  conversationDirect: 'ecoute',
  annoncer: 'voix',
  traduire: 'langue',
  prevoirMeteo: 'meteo',
  reconnaitreSons: 'sons',
} as const satisfies Record<string, SorteModele>;
export type ChosePasEncore = keyof typeof CHOSES;

/** La phrase « pas encore » d'une chose, dans la langue donnée si elle l'a, sinon en anglais, sinon en français. Pur. */
export function pasEntraine(chose: ChosePasEncore, langue?: string): string {
  const sorte = CHOSES[chose];
  if (langue === 'auto' || langue === '') langue = undefined; // langue à reconnaître : la langue par défaut d'abord
  const essais = [...new Set([langue?.toLowerCase().replace(/[-_].*$/, '').replace(/!$/, ''), ...(langue ? ['en', 'fr'] : ['fr', 'en'])].filter(Boolean) as string[])];
  for (const code of essais) {
    const t = table(code), brut = t?.textes.modelePasEntraine, c = t?.modeles.choses[chose], s = t?.modeles.sortes[sorte];
    if (brut && c && s) return brut.replace(/\{(\w+)\}/g, (_m, k: string) => ({ quoi: c.quoi, proche: c.proche, sorte: s } as Record<string, string>)[k] ?? '');
  }
  return `pas encore : ${chose}`; // aucun fichier de langue lisible (ne devrait pas arriver)
}

/** L'erreur levée par une fonction qui attend un modèle d'Odin : son message est la phrase « pas encore ». */
export class ModelePasEntraine extends Error {
  readonly chose: ChosePasEncore;
  readonly sorte: SorteModele;
  constructor(chose: ChosePasEncore, langue?: string) {
    super(pasEntraine(chose, langue));
    this.name = 'ModelePasEntraine';
    this.chose = chose;
    this.sorte = CHOSES[chose];
  }
}
