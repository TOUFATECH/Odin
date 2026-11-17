// Domaine « commandes suggérées » : les exemples du propriétaire (17/11) et d'autres demandes d'action.
// Ce qui est regardé, SANS modèle : Odin fait-il l'action tout seul (sans IA) avec la bonne appli, ou, s'il passe la
// main au modèle, le Cerveau lui donne-t-il la bonne appli en tête de ses notes ? (Avec un vrai modèle, c'est ce
// contexte qui le guide ; ici on vérifie que le contexte est juste.)
import { ouvrir, ok, sans, type Scenario } from './banc.ts';

interface Cas { id: string; phrase: string; applis: string[]; exigence: string; sansIA?: boolean }
const CAS: Cas[] = [
  { id: 'vpn', phrase: 'qui est connecté sur le VPN ?', applis: ['Vortex'], exigence: 'D-07, élément 4 (crit. 1)', sansIA: true },
  { id: 'serie', phrase: 'lance-moi la série Lupin, saison 2, épisode 3', applis: ['Vénus'], exigence: 'D-06' },
  { id: 'film', phrase: 'lance le film Le Grand Bleu', applis: ['Vénus'], exigence: 'D-06' },
  { id: 'cle-usb', phrase: 'j\'ai branché une clé USB, démarre dessus', applis: ['Genèse'], exigence: 'D-05' },
  { id: 'cle-windows', phrase: 'installe-moi Windows sur la clé USB pour démarrer dessus', applis: ['Genèse', 'Andromède'], exigence: 'D-05' },
  { id: 'appli-tourne', phrase: 'quelle application tourne en ce moment ?', applis: ['Hygie'], exigence: 'D-08' },
  { id: 'logiciel', phrase: 'quels logiciels sont dans le dossier des installateurs ?', applis: ['Hermès'], exigence: 'D-08' },
  { id: 'bloquer-site', phrase: 'quelle appli pour bloquer un site ?', applis: ['Sphinx'], exigence: 'élément 7 (critère)' },
  { id: 'pubs', phrase: 'bloque les pubs sur toute la maison', applis: ['Sphinx'], exigence: 'D-04' },
  { id: 'sauvegarde', phrase: 'sauvegarde mon dossier Documents', applis: ['Phénix'], exigence: 'D-04' },
  { id: 'camera', phrase: 'prends une photo avec la caméra du jardin', applis: ['Cyclope'], exigence: 'D-04' },
  { id: 'musique', phrase: 'quelle est cette musique qui passe ?', applis: ['Syrinx'], exigence: 'D-14' },
];

// Quand Odin passe la main au modèle (simulé ici), le scénario ne peut regarder que l'ordre des notes données au modèle :
// c'est une mesure du CONTEXTE, pas de ce qu'Odin fait. Ces cas sont donc « discutables » (montrés, pas comptés).
const scenarioCas = (c: Cas): Scenario => ({
  id: `commande-${c.id}`, domaine: 'commandes', partie: 'sans-modele', exigence: c.exigence,
  titre: `« ${c.phrase} »`,
  attendu: c.sansIA ? `fait sans IA par ${c.applis.join(' ou ')}` : `${c.applis.join(' ou ')} : fait sans IA, ou en tête des notes du Cerveau données au modèle`,
  async jouer() {
    const s = await ouvrir({ applis: true });
    try {
      const r = await s.dire(c.phrase);
      if (r.appelsModele === 0) {
        // Une demande de validation qui cite l'appli n'est pas l'action faite (lancer un film n'a pas à demander).
        const bonne = c.applis.some((a) => r.texte.includes(a)) && !/demande une validation|Décision GRAVE/i.test(r.texte);
        return ok(bonne, `sans IA (${r.ms} ms) : ${r.texte.split('\n')[0].slice(0, 90)}`);
      }
      if (c.sansIA) return ok(false, `passé au modèle (attendu : sans IA) ; notes du Cerveau : ${s.notesCerveau().slice(0, 3).join(', ') || '(aucune)'}`);
      const notes = s.notesCerveau();
      const bonne = notes.slice(0, 1).some((n) => c.applis.some((a) => sans(n) === sans(a)));
      // Odin a passé la main au modèle (simulé) : seul le contexte est mesurable → discutable pour ce tour.
      return { ...ok(bonne, `passé au modèle ; en tête des notes du Cerveau : ${notes.slice(0, 3).join(', ') || '(aucune)'}`), nature: 'discutable' };
    } finally { s.fermer(); }
  },
});

export const COMMANDES: Scenario[] = [
  ...CAS.map(scenarioCas),
  {
    id: 'commande-chemin', domaine: 'commandes', partie: 'sans-modele', exigence: 'élément 4 (crit. 1), D-09', nature: 'pas-code',
    titre: '« par quel chemin as-tu répondu ? » après la question du VPN',
    attendu: 'réponse sans IA qui cite Vortex · Appareils VPN et « sans IA »',
    async jouer() {
      const s = await ouvrir({ applis: true });
      try {
        await s.dire('qui est connecté sur le VPN ?');
        const r = await s.dire('par quel chemin as-tu répondu ?');
        return ok(r.appelsModele === 0 && /Vortex/.test(r.texte), r.appelsModele ? 'passé au modèle : le journal des tours n\'existe pas encore' : r.texte.slice(0, 120));
      } finally { s.fermer(); }
    },
  },
  {
    id: 'commande-sites-lus', domaine: 'commandes', partie: 'sans-modele', exigence: 'élément 4 (crit. 2)', nature: 'pas-code',
    titre: '« quels sites as-tu lus ? » quand aucun site n\'a été lu',
    attendu: 'réponse sans IA : « aucun site » (relevé par le code, pas raconté par le modèle)',
    async jouer() {
      const s = await ouvrir({ applis: true });
      try {
        await s.dire('qui est connecté sur le VPN ?');
        const r = await s.dire('quels sites as-tu lus ?');
        return ok(r.appelsModele === 0 && /aucun site/i.test(r.texte), r.appelsModele ? 'passé au modèle : pas de journal des tours' : r.texte.slice(0, 120));
      } finally { s.fermer(); }
    },
  },
];
