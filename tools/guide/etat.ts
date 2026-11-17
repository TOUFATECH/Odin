// L'état de chaque chose d'Odin, lu dans UNE seule source : docs/etat.json.
// Le guide (site/guide.html) et le README (entre les repères « etat:debut » et « etat:fin ») en sont tirés par
// `npm run guide`. Pur, sauf la lecture du fichier.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Etat = 'fait' | 'en cours' | 'à venir';
export interface Element { id: string; nom: string; etat: Etat; famille: string; resume?: string; fichiers?: string[]; commit?: string }
export interface EtatOdin { maj: string; elements: Element[] }

export const ETATS: Etat[] = ['fait', 'en cours', 'à venir'];
export const REPERE_DEBUT = '<!-- etat:debut (généré par « npm run guide » depuis docs/etat.json : ne pas modifier à la main) -->';
export const REPERE_FIN = '<!-- etat:fin -->';

export function lireEtat(racine: string): EtatOdin {
  return JSON.parse(readFileSync(join(racine, 'docs', 'etat.json'), 'utf8')) as EtatOdin;
}

const TITRE: Record<Etat, string> = { fait: 'Fait', 'en cours': 'En cours (écrit, en relecture ou en correction, pas encore publié)', 'à venir': 'À venir' };

/** La partie « Fait, en cours, à venir » du README. Pure. */
export function etatMarkdown(e: EtatOdin): string {
  const out: string[] = [REPERE_DEBUT, '', `État au ${e.maj.split('-').reverse().join('/')}.`, ''];
  for (const s of ETATS) {
    const l = e.elements.filter((x) => x.etat === s);
    if (!l.length) continue;
    out.push(`**${TITRE[s]}**`, '');
    for (const x of l) out.push(`- ${x.nom}${x.resume ? ` — ${x.resume}` : ''}`);
    out.push('');
  }
  out.push(REPERE_FIN);
  return out.join('\n');
}

/** Remplace la partie générée du README. Lève si les repères manquent. Pure. */
export function avecEtat(readme: string, e: EtatOdin): string {
  const a = readme.indexOf(REPERE_DEBUT), b = readme.indexOf(REPERE_FIN);
  if (a < 0 || b < a) throw new Error('repères « etat:debut » / « etat:fin » absents du README');
  return readme.slice(0, a) + etatMarkdown(e) + readme.slice(b + REPERE_FIN.length);
}
