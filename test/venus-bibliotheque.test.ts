// Vénus · Odéon natif : lecture des noms de fichiers, scan avec un FAUX ffprobe (aucun service réel), rangement en
// œuvres/épisodes/pistes, recherche, ma liste, reprise, historique et demandes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MagasinVenus } from '../src/valhalla/venus/base.ts';
import { ajouterDossier, ajouterHistorique, ajouterMaListe, analyserNom, bibliotheque, demander, demandes, effacerHistorique, episodes, fichierDeCible, historique, maListe, noterReprise, reprise, scanner, sousTitresVoisins, trouverOeuvre, type FichierVu, type Outils, type Probe } from '../src/valhalla/venus/bibliotheque.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'venus-bib-'));
const probe = (hauteur: number, duree = 3600, codecs = ['h264'], sous: Probe['sousTitres'] = []): Probe => ({ duree, hauteur, largeur: hauteur * 16 / 9, codecs, audio: ['aac'], sousTitres: sous });

test('analyserNom : film (année), série SxxExx et 1x02', () => {
  assert.deepEqual(analyserNom('Inception.2010.1080p.BluRay.x264.mkv'), { titre: 'Inception', annee: 2010 });
  assert.deepEqual(analyserNom('One Piece S01E1071 VOSTFR.mkv'), { titre: 'One Piece', saison: 1, episode: 1071 });
  assert.deepEqual(analyserNom('Dark 2x05.mp4'), { titre: 'Dark', saison: 2, episode: 5 });
  assert.equal(analyserNom('Un.Film.Sans.Annee.mp4').titre, 'Un Film Sans Annee');
});

test('sousTitresVoisins : .srt à côté du fichier, langue déduite', () => {
  const tous: FichierVu[] = [{ chemin: '/m/Film.mkv', taille: 1, mtime: 1 }, { chemin: '/m/Film.fr.srt', taille: 1, mtime: 1 }, { chemin: '/m/Autre.srt', taille: 1, mtime: 1 }];
  assert.deepEqual(sousTitresVoisins('/m/Film.mkv', tous), [{ langue: 'fr', fichier: '/m/Film.fr.srt' }]);
});

test('scan natif (faux ffprobe) : films, séries (épisodes), musique rangés ; recherche ; fichier d\'une cible', async () => {
  const home = tmp();
  try {
    const m = new MagasinVenus(home, join(home, 'freyja'));
    ajouterDossier(m, '/films', 'films'); ajouterDossier(m, '/series', 'series'); ajouterDossier(m, '/musique', 'musique');
    const faux: Record<string, FichierVu[]> = {
      '/films': [{ chemin: '/films/Inception 2010.mkv', taille: 9e9, mtime: 1 }, { chemin: '/films/affiche.txt', taille: 10, mtime: 1 }],
      '/series': [{ chemin: '/series/One Piece/One Piece S01E1071.mkv', taille: 5e8, mtime: 1 }, { chemin: '/series/One Piece/One Piece S01E1072.mp4', taille: 5e8, mtime: 1 }, { chemin: '/series/One Piece/One Piece S01E1071.fr.srt', taille: 1, mtime: 1 }],
      '/musique': [{ chemin: '/musique/Daft Punk - Discovery/01 One More Time.flac', taille: 4e7, mtime: 1 }],
    };
    const outils: Outils = { parcourir: (d) => faux[d] ?? [], ffprobe: async (c) => (c.endsWith('.flac') ? probe(0, 320, []) : probe(1080)) };
    const bilan = await scanner(m, outils);
    assert.equal(bilan.oeuvres, 3, 'un film, une série, un album'); assert.equal(bilan.episodes, 2); assert.equal(bilan.pistes, 1);
    // Bibliothèque et recherche.
    assert.equal(bibliotheque(m, { type: 'film' }).length, 1);
    assert.equal(bibliotheque(m, { q: 'one piece' }).length, 1);
    const serie = trouverOeuvre(m, 'One Piece'); assert.ok(serie && serie.data.type === 'serie');
    assert.equal(episodes(m, serie!.id).length, 2);
    // Le fichier d'une cible (épisode) + ses sous-titres voisins.
    const eid = episodes(m, serie!.id)[0].id, fc = fichierDeCible(m, eid);
    assert.ok(fc && fc.type === 'video' && fc.fichier.endsWith('S01E1071.mkv'));
    assert.ok((fc!.sousTitres ?? []).some((s) => s.fichier?.endsWith('.fr.srt')));
    // Un film lisible directement.
    const film = trouverOeuvre(m, 'Inception'); assert.ok(film && fichierDeCible(m, film!.id)?.fichier.endsWith('Inception 2010.mkv'));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('ma liste, reprise, historique (privé effaçable) et demandes', () => {
  const home = tmp();
  try {
    const m = new MagasinVenus(home, join(home, 'freyja'));
    m.poser('oeuvres', 'film:x', { type: 'film', titre: 'X', annee: 2020 });
    ajouterMaListe(m, 'moi', 'film:x'); assert.equal(maListe(m, 'moi').length, 1);
    noterReprise(m, 'moi', 'film:x', 125.6, 3600); assert.deepEqual(reprise(m, 'moi', 'film:x'), { position_s: 126, duree_s: 3600 });
    ajouterHistorique(m, 'moi', 'film:x', 'video', 'X'); ajouterHistorique(m, 'autre', 'film:x', 'video', 'X');
    assert.equal(historique(m, 'moi').length, 1);
    assert.equal(effacerHistorique(m, 'moi'), 1); assert.equal(historique(m, 'moi').length, 0);
    assert.equal(historique(m, 'autre').length, 1, 'l\'historique d\'un autre profil n\'est pas touché');
    demander(m, 'moi', 'Un titre absent', 'film'); assert.equal(demandes(m, 'moi')[0].etat, 'en attente');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('vie privée : la clé en clair des collections privées ne révèle ni le titre ni la cible ; dédup historique/demandes', () => {
  const home = tmp();
  try {
    const dir = join(home, 'freyja');
    const m = new MagasinVenus(home, dir);
    ajouterHistorique(m, 'moi', 'film:breaking-bad-2008', 'video', 'Breaking Bad');
    ajouterHistorique(m, 'moi', 'film:breaking-bad-2008', 'video', 'Breaking Bad'); // revu : une seule ligne
    demander(m, 'moi', 'Le Parrain', 'film');
    demander(m, 'moi', 'Le Parrain', 'film'); // redemandé : une seule ligne
    assert.equal(historique(m, 'moi').length, 1, 'une ligne par cible (dédup)');
    assert.equal(demandes(m, 'moi').length, 1, 'une ligne par titre (dédup)');
    const hb = readFileSync(join(dir, 'historique.jsonl'), 'utf8');
    assert.doesNotMatch(hb, /film:breaking-bad-2008/, 'la cible n\'est pas dans la clé en clair');
    assert.doesNotMatch(hb, /breaking/i, 'ni le slug ni le titre ne sont en clair');
    const db = readFileSync(join(dir, 'demandes.jsonl'), 'utf8');
    assert.doesNotMatch(db, /parrain/i, 'le titre demandé n\'est pas en clair');
    // Relu en mémoire : les contenus reviennent en clair.
    assert.equal(historique(m, 'moi')[0].cible_id, 'film:breaking-bad-2008');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
