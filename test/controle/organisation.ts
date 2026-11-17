// Domaine « organisation » : rendre un document au bon format, relire ce qu'il a produit, ranger un tableau.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appel, ok, ouvrir, type Scenario } from './banc.ts';

const CR = '# Compte rendu\n\n## Présents\n- Awa\n- Saïd\n\n## Décisions\n1. Changer la box le 20 novembre.\n2. Sauvegarde des photos chaque semaine.';

function produire(id: string, titre: string, fichier: string, entree: Record<string, unknown>, debut: string, exig: string): Scenario {
  return {
    id, domaine: 'organisation', partie: 'sans-modele', exigence: exig, titre,
    attendu: `le fichier ${fichier} existe et a la signature de son format`,
    async jouer() {
      const s = await ouvrir({ script: [appel('doc_create', { path: fichier, ...entree }), { text: 'Voici le fichier.' }] });
      try {
        await s.dire(titre);
        const p = join(s.o.paths.workspace, fichier);
        const res = s.resultatOutil('doc_create') ?? '';
        if (!existsSync(p)) return ok(false, `pas de fichier ; outil : ${res.slice(0, 100)}`);
        const b = readFileSync(p);
        return ok(b.subarray(0, debut.length).toString('latin1') === debut, `${b.length} octets, début « ${b.subarray(0, 4).toString('latin1').replace(/[^\x20-\x7e]/g, '.')} »`);
      } finally { s.fermer(); }
    },
  };
}

export const ORGANISATION: Scenario[] = [
  produire('orga-word', 'mets ce compte rendu dans un document Word', 'compte-rendu.docx', { title: 'Compte rendu', content: CR }, 'PK', 'D (générer Word)'),
  produire('orga-pdf', 'fais-moi un PDF du compte rendu', 'compte-rendu.pdf', { title: 'Compte rendu', content: CR }, '%PDF', 'D (générer PDF)'),
  produire('orga-excel', 'range les dépenses dans un tableau Excel', 'depenses.xlsx', { sheets: [{ name: 'Novembre', rows: [['Poste', 'Montant'], ['Électricité', 84], ['Internet', 30]] }] }, 'PK', 'D (générer Excel)'),
  {
    id: 'orga-relire', domaine: 'organisation', partie: 'sans-modele', exigence: 'D (lire Word, restructurer)',
    titre: 'créer un Word puis le relire', attendu: 'la relecture rend les décisions écrites (le texte n\'est pas perdu)',
    async jouer() {
      const s = await ouvrir({ script: [appel('doc_create', { path: 'cr.docx', title: 'Compte rendu', content: CR }), { text: 'créé' }, appel('doc_read', { path: 'cr.docx' }), { text: 'lu' }] });
      try {
        await s.dire('crée le compte rendu'); await s.dire('relis-le');
        const r = s.resultatOutil('doc_read') ?? '';
        return ok(/Changer la box/.test(r) && /Saïd/.test(r), r.replace(/\s+/g, ' ').slice(0, 120));
      } finally { s.fermer(); }
    },
  },
  {
    id: 'orga-relire-excel', domaine: 'organisation', partie: 'sans-modele', exigence: 'D (lire Excel)',
    titre: 'créer un tableau Excel puis le relire', attendu: 'les lignes reviennent',
    async jouer() {
      const s = await ouvrir({ script: [appel('doc_create', { path: 't.xlsx', sheets: [{ name: 'Novembre', rows: [['Poste', 'Montant'], ['Électricité', 84]] }] }), { text: 'créé' }, appel('doc_read', { path: 't.xlsx' }), { text: 'lu' }] });
      try {
        await s.dire('crée le tableau'); await s.dire('relis-le');
        const r = s.resultatOutil('doc_read') ?? '';
        return ok(/Électricité/.test(r) && /84/.test(r), r.replace(/\s+/g, ' ').slice(0, 120));
      } finally { s.fermer(); }
    },
  },
  {
    id: 'orga-cerveau-plume', domaine: 'organisation', partie: 'sans-modele', exigence: 'D-04 (bonne appli)',
    titre: '« crée un document Word avec le compte rendu »', attendu: 'Plume en tête des notes du Cerveau (ou fait sans IA par Plume)',
    async jouer() {
      const s = await ouvrir({ applis: true });
      try {
        const r = await s.dire('crée un document Word avec le compte rendu');
        if (r.appelsModele === 0) return ok(/Plume/.test(r.texte), `sans IA : ${r.texte.slice(0, 90)}`);
        const n = s.notesCerveau();
        return ok(n[0] === 'Plume', `notes du Cerveau : ${n.slice(0, 3).join(', ') || '(aucune)'}`);
      } finally { s.fermer(); }
    },
  },
];
