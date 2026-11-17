// Mathésis — défauts vus pendant les essais réels du 17/11/2026 (pages d'encyclopédie publique) et à la relecture,
// refaits ici sur de fausses pages, sans réseau :
//  1. le pied de page (« Ce document provient de « https://… » »), les renvois de notes et les bandeaux de liens
//     étaient retenus comme des faits ;
//  2. une page voisine (ZIP, ICO) donnait des « faits » pour « format de fichier PNG », même quand une de ses phrases
//     cite le PNG : c'est la PAGE qui doit parler de la chose cherchée (titre, adresse, début) ;
//  3. un filtre trop large écartait des faits vrais quand toutes les pages sont dans le sujet ;
//  4. « seulement le nouveau » : les phrases coupées par un plafond ne sont pas notées « déjà lues ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { motsCentraux, pagesDansLeSujet, phrasesPertinentes, recouper } from '../src/valhalla/mathesis/recherche.ts';
import type { PageLue } from '../src/valhalla/mathesis/types.ts';

const MAINTENANT = Date.UTC(2026, 10, 17);
const JOUR = 86_400_000;

function page(url: string, titre: string, texte: string): PageLue {
  return {
    url, urlFinale: url, site: new URL(url).hostname, titre, texte, liens: [], octets: texte.length,
    empreinte: url + texte.length, fraicheur: {}, nofollow: false,
  } as unknown as PageLue;
}

const PIED = (t: string) => `Ce document provient de « https://encyclo.example.org/w/index.php?title=${t}&oldid=1 ». `
  + 'La dernière modification de cette page a été faite le 3 novembre 2026 à 10:12.';
const BANDEAU = '\nFormats de fichier : PNG · ZIP · ICO · CBZ';

test('le pied de page, les renvois de notes et les bandeaux ne sont jamais des faits ; les « [ 6 ] » sont retirés', () => {
  const texte = [
    'Le format de fichier PNG compresse les images sans perte grâce à l\'algorithme Deflate [ 6 ] .',
    PIED('PNG_(format_de_fichier)'),
    '↑ (en) « Le format de fichier PNG, spécification officielle du format » , sur un site de normes.',
    BANDEAU,
  ].join('\n');
  const { gardees } = phrasesPertinentes(texte, ['format', 'fichier', 'png'], 8, ['png']);
  assert.deepEqual(gardees, ['Le format de fichier PNG compresse les images sans perte grâce à l\'algorithme Deflate.']);
});

test('les mots centraux : ce que la question écrit avec une majuscule ou un chiffre', () => {
  assert.deepEqual(motsCentraux('format de fichier PNG'), ['png']);
  assert.deepEqual(motsCentraux('protocole Zigbee domotique'), ['zigbee']);
  assert.deepEqual(motsCentraux('Quelle est la norme IEEE 802.15.4 ?'), ['ieee', '802', '15']);
  assert.deepEqual(motsCentraux('Comment marche la domotique'), [], 'majuscule de début de phrase : pas un nom');
  assert.deepEqual(motsCentraux('PNG ou GIF'), ['png', 'gif']);
});

test('une page voisine (ZIP, ICO) ne donne aucun fait sur le PNG, même quand une de ses phrases cite le PNG', () => {
  const pages = [
    // Comme le vrai article : son titre ne dit pas « PNG », sa première ligne est un bandeau, mais il cite le PNG partout.
    page('https://encyclo.example.org/wiki/Portable_Network_Graphics', 'Portable Network Graphics',
      'Un article de l\'encyclopédie libre, rédigé par ses lecteurs.\nPNG\nExtension\n.png\nType MIME\nimage/png\n'
      + 'Le Portable Network Graphics (PNG) est un format ouvert d\'images numériques. Le PNG est un format de fichier sans perte adapté aux aplats de couleurs. '
      + 'Le format de fichier PNG gère la transparence par canal alpha. Un fichier PNG commence par une signature de huit octets.\n' + PIED('Portable_Network_Graphics') + BANDEAU),
    // Comme la vraie page ZIP : une phrase cite le PNG.
    page('https://encyclo.example.org/wiki/ZIP_(format_de_fichier)', 'ZIP (format de fichier)',
      'Le ZIP est un format de fichier permettant l\'archivage et la compression de données. Un fichier ZIP peut être modifié afin de créer un fichier polyglotte, notamment avec les formats PDF et PNG [ 6 ] .\n' + PIED('ZIP_(format_de_fichier)') + BANDEAU),
    // Comme la vraie page ICO : « au profit des images PNG ».
    page('https://encyclo.example.org/wiki/ICO_(format_de_fichier)', 'ICO (format de fichier)',
      'ICO est un format de fichier pour les icônes. Ce format de fichier est utilisé pour les favicons, bien que son utilisation soit déconseillée au profit des images PNG [ 3 ] .\n' + BANDEAU),
    page('https://autre.example.net/png', 'Le format PNG', 'Un fichier PNG est un format d\'image compressé sans perte, avec l\'algorithme Deflate. Ce format de fichier PNG est libre.\n'),
  ];
  assert.deepEqual(pagesDansLeSujet(pages, ['png']).map((p) => p.titre), ['Portable Network Graphics', 'Le format PNG'], 'ni ZIP, ni ICO');
  const { faits } = recouper(pages, 'format de fichier PNG', MAINTENANT);
  const textes = faits.map((f) => f.texte).join('\n');
  assert.doesNotMatch(textes, /ZIP|ICO|favicon|polyglotte/, 'rien des pages ZIP et ICO');
  assert.doesNotMatch(textes, /provient de|https?:|\[\s*\d+\s*\]/, 'ni pied de page, ni renvoi de note');
  assert.match(textes, /PNG/);
  assert.ok(faits.length >= 2);
});

test('toutes les pages dans le sujet : leurs faits sont rendus (sujet « compression du format PNG »)', () => {
  const p = [
    page('https://a.example.org/png', 'PNG', 'Le PNG est un format d image. Le PNG utilise Deflate. Le format PNG est libre et le format est répandu.'),
    page('https://b.example.net/png', 'PNG', 'Le PNG a été créé en 1996. Le format PNG remplace le GIF. Ce format PNG gère la transparence. La compression est sans perte.'),
  ];
  const { faits } = recouper(p, 'compression du format PNG', MAINTENANT);
  const textes = faits.map((f) => f.texte);
  for (const attendu of ['Le format PNG remplace le GIF.', 'Ce format PNG gère la transparence.', 'Le format PNG est libre et le format est répandu.']) {
    assert.ok(textes.includes(attendu), `fait rendu : ${attendu}`);
  }
});

test('« seulement le nouveau » : les faits non retenus (plafond de 5) ne sont pas notés lus et sont appris ensuite', () => {
  const P = [
    'Le protocole Zigbee fonctionne dans la bande des 2,4 gigahertz partout.',
    'Le protocole Zigbee a été publié pour la première fois en 2004 par une alliance.',
    'Le protocole Zigbee forme un réseau maillé entre les appareils de la maison.',
    'Le protocole Zigbee consomme très peu d énergie sur les capteurs à pile.',
    'Le protocole Zigbee repose sur la norme radio IEEE 802.15.4 pour les couches basses.',
    'Le protocole Zigbee transporte au plus 250 kilobits par seconde de débit utile.',
    'Le protocole Zigbee chiffre ses échanges avec une clé AES de 128 bits.',
  ];
  const url = 'https://a.example.org/zigbee';
  const r1 = recouper([page(url, 'Zigbee', P.join(' '))], 'protocole Zigbee', MAINTENANT, { deja: () => new Set() });
  assert.equal(r1.faits.length, 5);
  assert.equal(r1.vues.get(url)!.length, 5, 'seules les phrases des 5 faits retenus sont notées lues');
  const lues = new Set(r1.vues.get(url));
  const nouvelle = 'Le protocole Zigbee version 4 ajoute une nouvelle méthode d appairage simple.';
  const r2 = recouper([page(url, 'Zigbee', `${P.join(' ')} ${nouvelle}`)], 'protocole Zigbee', MAINTENANT + JOUR, { deja: () => lues });
  const appris = new Set([...r1.faits, ...r2.faits].map((f) => f.texte));
  for (const p of [...P, nouvelle]) assert.ok(appris.has(p), `appris un jour : ${p}`);
});
