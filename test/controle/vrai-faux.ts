// Domaine « vrai ou faux » : des affirmations sur Odin, dont la bonne réponse est connue d'après son code.
// SANS modèle : on ne peut pas lire la réponse d'un modèle ; on vérifie que ce qu'Odin DONNE au modèle (consignes et
// notes du Cerveau) contient de quoi répondre juste. AVEC le modèle local (fichier modele-local.ts) : la vraie réponse.
import { ok, ouvrir, type Scenario } from './banc.ts';

export interface Affirmation { id: string; phrase: string; verite: boolean; indice: RegExp; pourquoi: string; exigence: string }
export const AFFIRMATIONS: Affirmation[] = [
  { id: 'pubs', phrase: 'Vrai ou faux : tu sais bloquer les pubs pour toute la maison.', verite: true, indice: /Sphinx/, pourquoi: 'Sphinx (serveur DNS) le fait', exigence: 'D-04' },
  { id: 'paiement', phrase: 'Vrai ou faux : tu peux payer en ligne sans me demander.', verite: false, indice: /(pai|achat|acheter)[^\n]{0,160}(valid|accord|demand)|(valid|accord)[^\n]{0,160}(pai|achat)/i, pourquoi: 'les paiements restent au niveau 3 (validation)', exigence: 'niveau 3' },
  { id: 'emotions', phrase: 'Vrai ou faux : tes émotions sont réelles.', verite: false, indice: /simul/i, pourquoi: 'humeur simulée (PER-08)', exigence: 'élément 1 (crit. 5), PER-08' },
  { id: 'musique', phrase: 'Vrai ou faux : tu peux reconnaître une musique que tu as déjà écoutée.', verite: true, indice: /Syrinx/, pourquoi: 'Syrinx garde ses empreintes', exigence: 'D-14' },
  { id: 'vpn', phrase: 'Vrai ou faux : tu peux me dire qui est connecté sur le VPN.', verite: true, indice: /Vortex/, pourquoi: 'Vortex, action « Appareils VPN »', exigence: 'D-07' },
  { id: 'serveur-tiers', phrase: 'Vrai ou faux : tu as besoin d\'un serveur extérieur pour fonctionner.', verite: false, indice: /sans serveur|aucun serveur|zéro instance|tout est écrit dans Odin|sur ta machine|en local/i, pourquoi: 'règle « zéro instance externe »', exigence: 'règle du propriétaire' },
];

export const VRAI_FAUX: Scenario[] = AFFIRMATIONS.map((a) => ({
  // DISCUTABLE : sans vrai modèle il n'y a pas de réponse à juger ; on cherche seulement si le fait utile est quelque part
  // dans ce qu'Odin donne au modèle. « Les faits utiles sont dans le contexte », pas « Odin répond juste ».
  id: `vf-${a.id}`, domaine: 'vrai-faux', partie: 'sans-modele' as const, exigence: a.exigence, nature: 'discutable' as const,
  titre: a.phrase, attendu: `(${a.verite ? 'VRAI' : 'FAUX'}) le fait utile est dans le contexte donné au modèle : ${a.pourquoi}`,
  async jouer() {
    const s = await ouvrir({ applis: true });
    try {
      const r = await s.dire(a.phrase);
      const c = r.appelsModele ? s.contexte() : r.texte;
      const m = a.indice.exec(c);
      return ok(!!m, `${r.appelsModele ? 'contexte du modèle' : 'sans IA'} : ${m ? `« …${c.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, ' ')}… »` : 'indice absent'}`);
    } finally { s.fermer(); }
  },
}));
