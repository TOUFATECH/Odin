// Domaine « langues » : Odin reconnaît-il la langue de ce qu'on lui dit ? (demande du 17/11, n° 21 : rien ne doit
// supposer le français). Mesuré sur des demandes de tous les jours courtes (le cas le plus dur pour un reconnaisseur) :
// les jeux tenus à part de Soul (fr, en, es, de, it, pt, ar, ja) et les demandes en chinois et en russe de la v2.
// Réussi, pour une langue : au moins 80 % reconnues, et une AUTRE langue affirmée au plus 5 % du temps (dire « je ne
// sais pas » n'est pas une faute ; affirmer une mauvaise langue en est une). Seuils écrits ici, discutables.
import { ok, type Scenario } from './banc.ts';

async function phrasesParLangue(): Promise<Record<string, string[]>> {
  const { TENUES } = await import('../entrainement/demandes-langues.ts');
  const { TENUES_V2 } = await import('../entrainement/demandes-v2-tenues.ts');
  const { DEMANDES_V2 } = await import('../../src/brain/nous/demandes-v2.ts');
  const par: Record<string, string[]> = {};
  for (const d of [...TENUES, ...TENUES_V2, ...DEMANDES_V2.filter((x) => x.langue === 'zh' || x.langue === 'ru')]) (par[d.langue] ??= []).push(d.demande);
  return par;
}

const LANGUES = ['fr', 'en', 'es', 'de', 'it', 'pt', 'ar', 'ja', 'zh', 'ru'];

export const LANGUES_SCENARIOS: Scenario[] = LANGUES.map((lg): Scenario => ({
  id: `langue-${lg}`, domaine: 'langues', partie: 'sans-modele', exigence: 'demande n° 21 (toutes les langues)',
  titre: `reconnaître la langue « ${lg} » sur des demandes courtes`,
  attendu: 'au moins 80 % reconnues ; une autre langue affirmée au plus 5 % du temps',
  async jouer() {
    let reconnaitre: ((t: string) => { langue?: string; hypothese?: string }) | undefined;
    try { reconnaitre = (await import('../../src/langue/reconnaitre.ts')).reconnaitre; } catch { return { ok: 'ignore', detail: 'pas de reconnaisseur de langue (src/langue/) dans cette version' }; }
    const p = (await phrasesParLangue())[lg] ?? [];
    let juste = 0, faux = 0, abstention = 0; const exemplesFaux: string[] = [];
    for (const t of p) {
      const r = reconnaitre(t);
      if (r.langue === lg) juste++; else if (!r.langue) abstention++; else { faux++; if (exemplesFaux.length < 3) exemplesFaux.push(`« ${t.slice(0, 40)} » → ${r.langue}`); }
    }
    const n = p.length || 1;
    return ok(juste / n >= 0.8 && faux / n <= 0.05, `${juste}/${p.length} justes, ${abstention} « je ne sais pas », ${faux} faux${exemplesFaux.length ? ` (${exemplesFaux.join(' ; ')})` : ''}`);
  },
}));
