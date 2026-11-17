// Mathésis — « jamais deux fois la même chose » et « seulement le nouveau » (demande du propriétaire, 17/11/2026) :
//  - une recherche déjà faite n'est pas reposée avant 7 jours (sa trace : question, date, moteur, résultats, retenu) ;
//  - quand une page change, seul le fait NOUVEAU est appris, avec la date du jour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monter, html } from './mathesis-outils-essai.ts';
import type { EntreeJournal } from '../src/valhalla/mathesis/types.ts';

const JOUR = 86_400_000;
const ROBOTS = { corps: 'User-agent: *\nDisallow:\n', type: 'text/plain' };
const F1 = 'Le format de fichier PNG compresse les images sans aucune perte grâce à l\'algorithme Deflate.';
const F2 = 'Le format de fichier PNG gère aussi la transparence par un canal alpha sur chaque pixel de l\'image.';

test('une page qui change : seul le paragraphe NOUVEAU est appris, avec la date du jour', async () => {
  const pages: Record<string, { corps?: string; etag?: string; type?: string }> = {
    'https://png.example.org/robots.txt': ROBOTS,
    'https://png.example.org/format': { etag: '"v1"', corps: html('Le format PNG', [F1]) },
  };
  const { m, horloge, muninn, magasin } = monter({ pages, reglages: { heures: [{ de: 0, a: 24 }] } });
  m.curiosite.confier('https://png.example.org/format');
  const b1 = await m.tour({ manques: 1, revisites: 0 });
  assert.deepEqual(b1.manques[0].faits.map((f) => f.texte), [F1]);
  // Dix jours plus tard, la page a un paragraphe de plus.
  horloge.avancer(10 * JOUR);
  pages['https://png.example.org/format'] = { etag: '"v2"', corps: html('Le format PNG', [F1, F2]) };
  const b2 = await m.tour({ manques: 0, revisites: 5 });
  assert.equal(b2.changees, 1, 'la page changée est relue');
  const journal = magasin.lire<EntreeJournal[]>('journal', []);
  const dernier = [...journal].reverse().find((e) => e.genre === 'retenu')!;
  assert.deepEqual(dernier.retenu?.map((r) => r.texte), [F2], 'seul le fait nouveau est appris');
  assert.match(dernier.quoi, /1 fait\(s\) nouveau\(x\)/);
  // Les faits du web sont rangés « à vérifier », en quarantaine : on les cherche donc quarantaine comprise.
  const souvenirs = muninn.recall('PNG transparence canal alpha', 10, true).concat(muninn.recall('PNG compresse Deflate', 10, true));
  const idsF1 = new Set(souvenirs.filter((s) => s.content === F1).map((s) => s.id));
  assert.equal(idsF1.size, 1, 'F1 est en mémoire, une seule fois');
  assert.equal(souvenirs.some((s) => s.content === F2), true, 'F2 est en mémoire');
  // La page inchangée ensuite : rien n'est appris.
  horloge.avancer(10 * JOUR);
  const b3 = await m.tour({ manques: 0, revisites: 5 });
  assert.equal(b3.changees, 0);
});

test('une recherche déjà faite n\'est pas reposée avant sa date ; sa trace est gardée', async () => {
  const pages = {
    'https://a.example.org/robots.txt': ROBOTS,
    'https://a.example.org/png': { corps: html('PNG', [F1]) },
  };
  const { m, moteurRecherche, horloge } = monter({ pages, resultats: () => ['https://a.example.org/png'], reglages: { heures: [{ de: 0, a: 24 }] } });
  const x = m.curiosite.signaler({ sujet: 'format de fichier PNG', origine: 'question_sans_reponse' })!;
  await m.tour({ manques: 1, revisites: 0 });
  const n = moteurRecherche.questions.length;
  assert.ok(n >= 1);
  const traces = m.traces.recherches();
  assert.equal(traces.length, n);
  assert.equal(traces[0].moteur, 'moteur d\'Odin');
  assert.equal(traces[0].resultats, 1);
  assert.deepEqual(traces[0].urls, ['https://a.example.org/png']);
  assert.equal(traces.reduce((s, t) => s + t.retenus, 0) >= 1, true, 'ce qui a été retenu est noté');
  // La même question revient (nouveau manque) le lendemain : pas reposée au moteur.
  m.curiosite.retirer(x.id);
  horloge.avancer(JOUR);
  m.curiosite.signaler({ sujet: 'format de fichier PNG', origine: 'sujet_recurrent' });
  await m.tour({ manques: 1, revisites: 0 });
  assert.equal(moteurRecherche.questions.length, n, 'aucune question reposée');
  assert.ok(m.journal.lire().some((e) => /déjà cherché le .* : pas reposé avant le/.test(e.quoi)));
  // Huit jours après : reposée.
  m.curiosite.retirer(m.curiosite.liste()[0].id);
  horloge.avancer(8 * JOUR);
  m.curiosite.signaler({ sujet: 'format de fichier PNG', origine: 'sujet_recurrent' });
  await m.tour({ manques: 1, revisites: 0 });
  assert.ok(moteurRecherche.questions.length > n, 'reposée après sa date');
});

test('un moteur injoignable : la question n\'est pas notée « cherchée » ; sans résultat, reposée dès le lendemain', async () => {
  let panne = true, vide = false;
  const { m, moteurRecherche, horloge } = monter({
    pages: { 'https://a.example.org/robots.txt': ROBOTS, 'https://a.example.org/png': { corps: html('PNG', [F1]) } },
    resultats: () => { if (panne) throw new Error('moteur injoignable'); return vide ? [] : ['https://a.example.org/png']; },
    reglages: { heures: [{ de: 0, a: 24 }] },
  });
  const x = m.curiosite.signaler({ sujet: 'format de fichier PNG', origine: 'question_sans_reponse' })!;
  await m.tour({ manques: 1, revisites: 0 });
  assert.ok(moteurRecherche.questions.length >= 1, 'la recherche a été tentée');
  assert.equal(m.traces.recherches().length, 0, 'pas de trace « cherchée » pour une panne');
  assert.ok(m.journal.lire().some((e) => /moteur injoignable/.test(e.quoi)));
  // Le moteur revient, mais ne trouve rien : la question est notée, reposable le lendemain (pas 7 jours).
  panne = false; vide = true;
  m.curiosite.retirer(x.id);
  m.curiosite.signaler({ sujet: 'format de fichier PNG', origine: 'sujet_recurrent' });
  const avant = moteurRecherche.questions.length;
  await m.tour({ manques: 1, revisites: 0 });
  assert.ok(moteurRecherche.questions.length > avant, 'reposée tout de suite après la panne');
  assert.equal(m.traces.recherches().every((t) => t.resultats === 0), true);
  const n = moteurRecherche.questions.length;
  m.curiosite.retirer(m.curiosite.liste()[0].id);
  horloge.avancer(25 * 3_600_000);
  vide = false;
  m.curiosite.signaler({ sujet: 'format de fichier PNG', origine: 'sujet_recurrent' });
  await m.tour({ manques: 1, revisites: 0 });
  assert.ok(moteurRecherche.questions.length > n, 'une recherche vide est reposée le lendemain');
});
