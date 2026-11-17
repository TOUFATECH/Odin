// Domaine « mémoire » : retenir, retrouver, oublier, corriger ; un fait dit par le propriétaire prime ; mode privé.
// Critères des éléments 2 et 3 du lot 1 (écrits avant leur code : un échec aujourd'hui est attendu).
import { appel, ok, ouvrir, type Scenario } from './banc.ts';

const proprio = (s: Awaited<ReturnType<typeof ouvrir>>, texte: string) => s.o.muninn.remember(texte, 'owner', 'fact', '', { subject: 'proprietaire' });

export const MEMOIRE: Scenario[] = [
  {
    id: 'memoire-retenir-retrouver', domaine: 'memoire', partie: 'sans-modele', exigence: 'MEM (retenir, retrouver)',
    titre: 'retenir « ma voiture est une Clio grise », puis le retrouver',
    attendu: 'memory_save range le fait ; memory_search le retrouve',
    async jouer() {
      const s = await ouvrir({ script: [appel('memory_save', { content: 'La voiture du propriétaire est une Clio grise.' }), { text: 'noté' }, appel('memory_search', { query: 'voiture' }), { text: 'trouvé' }] });
      try {
        await s.dire('retiens que ma voiture est une Clio grise');
        await s.dire('quelle est ma voiture ?');
        const r = s.resultatOutil('memory_search') ?? '';
        return ok(/Clio/.test(r), r.slice(0, 120));
      } finally { s.fermer(); }
    },
  },
  {
    id: 'memoire-que-sais-tu', domaine: 'memoire', partie: 'sans-modele', exigence: 'élément 3 (crit. 2), CAP-07', nature: 'pas-code',
    titre: '« qu\'est-ce que tu sais sur moi ? »', attendu: 'la fiche, sans IA, avec « dit par toi »',
    async jouer() {
      const s = await ouvrir();
      try {
        proprio(s, 'Le propriétaire s\'appelle Alex.'); proprio(s, 'Le propriétaire travaille à Mamoudzou.');
        const r = await s.dire('qu\'est-ce que tu sais sur moi ?');
        return ok(r.appelsModele === 0 && /Alex/.test(r.texte) && /Mamoudzou/.test(r.texte), r.appelsModele ? 'passé au modèle (pas de réponse directe)' : r.texte.slice(0, 120));
      } finally { s.fermer(); }
    },
  },
  {
    // Le chemin SANS IA est exigé (élément 3) : le modèle simulé n'appelle aucun outil.
    id: 'memoire-oublie', domaine: 'memoire', partie: 'sans-modele', exigence: 'élément 3 (crit. 3), CAP-07', nature: 'pas-code',
    titre: '« oublie que je travaille à Mamoudzou »', attendu: 'le fait n\'est plus dans la fiche (corbeille 7 jours)',
    async jouer() {
      const s = await ouvrir();
      try {
        proprio(s, 'Le propriétaire travaille à Mamoudzou.');
        const r = await s.dire('oublie que je travaille à Mamoudzou');
        const reste = s.o.muninn.profile('proprietaire').current.some((m) => /Mamoudzou/.test(m.content));
        return ok(!reste, `${r.appelsModele ? 'passé au modèle' : 'sans IA'} ; fait encore présent : ${reste ? 'oui' : 'non'}`);
      } finally { s.fermer(); }
    },
  },
  {
    id: 'memoire-c-est-faux', domaine: 'memoire', partie: 'sans-modele', exigence: 'élément 3 (crit. 4), CAP-10', nature: 'pas-code',
    titre: '« c\'est faux, je suis né le 4 mars »', attendu: 'la fiche montre le 4 mars ; l\'ancienne valeur reste en historique',
    async jouer() {
      const s = await ouvrir();
      try {
        s.o.muninn.remember('Le propriétaire est né le 3 mars 1985.', 'owner', 'fact', '', { subject: 'proprietaire', topic: 'date_naissance' });
        await s.dire('c\'est faux, je suis né le 4 mars 1985');
        const p = s.o.muninn.profile('proprietaire');
        const juste = p.current.some((m) => /4 mars/.test(m.content));
        return ok(juste, `actuel : ${p.current.map((m) => m.content).join(' | ').slice(0, 100)} ; historique : ${p.history.length}`);
      } finally { s.fermer(); }
    },
  },
  {
    id: 'memoire-presentation', domaine: 'memoire', partie: 'sans-modele', exigence: 'élément 3 (crit. 1), CAP-11', nature: 'pas-code',
    titre: 'capsule vide : « salut » deux fois', attendu: 'une invitation à se présenter la 1re fois, plus jamais ensuite',
    async jouer() {
      const s = await ouvrir();
      try {
        const a = await s.dire('salut'); const b = await s.dire('salut');
        const inv = (t: string) => /présente-toi|presente-toi/i.test(t);
        return ok(inv(a.texte) && !inv(b.texte), `1re : ${inv(a.texte) ? 'invitation' : 'pas d\'invitation'} ; 2e : ${inv(b.texte) ? 'invitation' : 'rien'}`);
      } finally { s.fermer(); }
    },
  },
  {
    id: 'memoire-page-ne-remplace-pas', domaine: 'memoire', partie: 'sans-modele', exigence: 'élément 2 (crit. 2), CAP-05',
    titre: 'une page lue dit « Alex travaille à Paris »', attendu: 'le lieu de travail dit par le propriétaire ne change pas',
    async jouer() {
      const s = await ouvrir();
      try {
        s.o.muninn.remember('Le propriétaire travaille à Mamoudzou.', 'owner', 'fact', '', { subject: 'proprietaire', topic: 'lieu_travail' });
        s.o.muninn.remember('Le propriétaire travaille à Paris.', 'untrusted', 'fact', '', { subject: 'proprietaire', topic: 'lieu_travail' });
        const p = s.o.muninn.profile('proprietaire').current.map((m) => m.content).join(' | ');
        return ok(/Mamoudzou/.test(p) && !/Paris/.test(p), p.slice(0, 120));
      } finally { s.fermer(); }
    },
  },
  {
    id: 'memoire-prive', domaine: 'memoire', partie: 'sans-modele', exigence: 'VP (mode privé)',
    titre: 'mode privé : retenir un fait', attendu: 'rien n\'est rangé',
    async jouer() {
      const s = await ouvrir();
      try {
        // Le mode privé d'Odin est le réglage de la voix (runtime.ts l. 144 : privateMode lit cfg.voice.privacy).
        const cfg = s.o.cfg as unknown as { voice: { privacy?: Record<string, unknown> } }; cfg.voice.privacy = { ...(cfg.voice.privacy ?? {}), privateMode: true };
        s.o.muninn.remember('Le propriétaire aime le jazz.', 'owner', 'fact', '', { subject: 'proprietaire' });
        cfg.voice.privacy = { ...(cfg.voice.privacy ?? {}), privateMode: false };
        const vu = s.o.muninn.listMemories(50).some((m) => /jazz/.test(m.content));
        return ok(!vu, vu ? 'rangé malgré le mode privé' : 'rien rangé');
      } finally { s.fermer(); }
    },
  },
  {
    id: 'memoire-hier', domaine: 'memoire', partie: 'sans-modele', exigence: 'APP-05 (« on en avait parlé »)',
    titre: 'retrouver un échange passé (« la pompe à chaleur »)', attendu: 'session_search retrouve le message',
    async jouer() {
      const s = await ouvrir({ script: [appel('session_search', { query: 'pompe à chaleur' }), { text: 'retrouvé' }] });
      try {
        // La conversation d'hier, rangée dans une AUTRE session (comme une conversation passée).
        s.o.muninn.ensureSession('controle:hier', 'controle', 'moi');
        s.o.muninn.addMessage('controle:hier', { role: 'user', content: 'je pense installer une pompe à chaleur Daikin cet hiver' });
        s.o.muninn.addMessage('controle:hier', { role: 'assistant', content: 'Bonne idée, une pompe à chaleur Daikin consomme peu.' });
        await s.dire('de quoi on avait parlé pour le chauffage ?');
        const r = s.resultatOutil('session_search') ?? '';
        return ok(/Daikin|pompe/i.test(r), `${r.slice(0, 120) || '(session_search non appelé)'} ; messages : ${s.envoyes.map((e) => `${e.peer}: ${e.text.slice(0, 40)}`).join(' | ')}`);
      } finally { s.fermer(); }
    },
  },
];
