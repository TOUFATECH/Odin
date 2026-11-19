// Les données par langue pour reconnaître un document déposé : français, anglais, espagnol, allemand, arabe, swahili.
// Une langue de plus = un fichier de plus ici (même forme : forme.ts).
import type { Langue } from '../../../langue/nombres.ts';
import type { DonneesLangue } from './forme.ts';
import { ar } from './ar.ts';
import { de } from './de.ts';
import { en } from './en.ts';
import { es } from './es.ts';
import { fr } from './fr.ts';
import { sw } from './sw.ts';

export const LANGUES_DOCUMENTS: Record<Langue, DonneesLangue> = { fr, en, es, de, ar, sw };
