// La lecture des pages (src/research/fetch.ts : extractArticle, naivePdfText) — une page est une donnée HOSTILE.
//  1. NON-RÉGRESSION : sur des pages normales, le résultat est EXACTEMENT celui de la version d'origine (attendus
//     relevés avec l'ancien code avant la réécriture linéaire ; 3 000 pages aléatoires comparées aussi, 0 différence).
//  2. Pages hostiles (balises jamais fermées, 2 Mo) : lues en temps borné (avant : jusqu'à 46 s, Odin figé).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractArticle, naivePdfText } from '../src/research/fetch.ts';

const BASE = 'https://exemple.fr/blog/2026/03/14/jardin';
const PAGES: Record<string, string> = {
 "article": "<!doctype html><html><head><title>Le jardin créole — Mon site</title><meta property=\"og:title\" content=\"Le jardin créole\"><meta name=\"author\" content=\"Awa Saïd\"><meta property=\"article:published_time\" content=\"2026-03-14T08:00:00Z\"><meta property=\"og:site_name\" content=\"Jardins de l'océan\"></head><body><header><nav><a href=\"/\">Accueil</a> <a href=\"/blog\">Blog</a></nav></header><article><h1>Le jardin créole</h1><p>Le jardin créole mélange légumes, fleurs et arbres fruitiers sur une même parcelle, à l'ombre des grands arbres.</p><h2>Les plantes</h2><p>On y trouve des brèdes, des piments, des citronniers et du manioc, plantés serrés pour garder l'humidité du sol.</p><ul><li>Brèdes mafane et morelle</li><li>Piments oiseau et cabri</li></ul><p>L'arrosage se fait le soir, quand la chaleur tombe, avec l'eau de pluie gardée dans des fûts.</p><blockquote>Un jardin bien serré se défend tout seul contre les mauvaises herbes.</blockquote></article><aside><p>Publicité : abonnez-vous à notre lettre pour recevoir nos conseils chaque semaine.</p></aside><footer><p>© 2026 Jardins de l'océan — mentions légales et politique de confidentialité.</p></footer><a href=\"https://exemple.fr/source\">Source</a> <a href=\"#haut\">Haut</a></body></html>",
 "menus": "<html><head><title>Horaires de la mairie</title></head><body><div class=\"menu\"><ul><li>Accueil de la mairie</li><li>Démarches en ligne</li><li>Contact et accès</li></ul></div><main><h1>Horaires d'ouverture</h1><p>La mairie est ouverte du lundi au vendredi de 7 h 30 à 15 h 30, sans interruption à midi.</p><p>Le samedi matin, une permanence de l'état civil est assurée de 8 h à 11 h, sauf pendant les vacances scolaires.</p><table><tr><td>Lundi au vendredi : 7 h 30 – 15 h 30, guichet unique</td></tr></table></main><div id=\"footer-share\" class=\"share\"><a href=\"/fb\">Partager sur un réseau social</a></div><footer>Mairie — 2026</footer></body></html>",
 "scripts": "<html><head><title>Recette du rougail</title><style>body{font:14px sans-serif} p{margin:0}</style><script>var a = \"<p>pas du texte</p>\"; function f(){ return 1 < 2; }</script><script type=\"application/ld+json\">{\"@type\":\"Article\",\"datePublished\":\"2025-12-01\",\"author\":{\"name\":\"Chef Ali\"}}</script></head><body><noscript>Activez JavaScript pour voir la vidéo de la recette.</noscript><div class=\"content\"><h2>Rougail saucisse</h2><p>Faire revenir les saucisses coupées en rondelles, puis ajouter les oignons, l'ail, le gingembre et le curcuma.</p><p>Ajouter les tomates et laisser mijoter à feu doux pendant quarante minutes en remuant de temps en temps.</p><p>Servir avec du riz blanc, des grains et un rougail de tomates bien relevé au piment.</p></div><script>console.log(\"fin\")</script><form><input name=\"q\"><button>Chercher</button></form></body></html>",
 "courte": "<html><head><title>Note</title></head><body><p>Fermé lundi.</p></body></html>",
 "sansArticle": "<html><head><title>Liste des pharmacies de garde</title><meta name=\"description\" content=\"pharmacies\"></head><body><div><span>Pharmacie du port, ouverte la nuit du samedi au dimanche.</span><br>Pharmacie centrale, ouverte le dimanche matin jusqu'à midi.<br/>Pharmacie des Hauts, de garde les jours fériés.</div><time datetime=\"2026-11-15\">15 novembre</time><a href=\"/plan\">Plan</a><a href='https://autre.exemple.org/x?a=1&amp;b=2'>Autre</a></body></html>",
 "entites": "<html><head><title>Prix &amp; tarifs &#8211; 2026</title></head><body><article><p>Le ticket coûte 1,50&nbsp;€ &mdash; le carnet de dix tickets coûte 12&nbsp;€ &lt;tarif réduit&gt; pour les étudiants et les plus de 65 ans.</p><p>Les abonnements mensuels sont à 30 € et donnent accès à toutes les lignes du réseau, y compris la navette du port.</p><p>Les enfants de moins de quatre ans voyagent gratuitement avec un adulte, sur présentation d'un justificatif.</p></article></body></html>"
};
const ATTENDU: Record<string, unknown> = {
 "article": {
  "title": "Le jardin créole",
  "text": "## Le jardin créole\nLe jardin créole mélange légumes, fleurs et arbres fruitiers sur une même parcelle, à l'ombre des grands arbres.\n\n## Les plantes\nOn y trouve des brèdes, des piments, des citronniers et du manioc, plantés serrés pour garder l'humidité du sol.\n- Brèdes mafane et morelle\n- Piments oiseau et cabri\nL'arrosage se fait le soir, quand la chaleur tombe, avec l'eau de pluie gardée dans des fûts.\nUn jardin bien serré se défend tout seul contre les mauvaises herbes.",
  "author": "Awa Saïd",
  "published": "2026-03-14",
  "siteName": "Jardins de l",
  "links": [
   "https://exemple.fr/",
   "https://exemple.fr/blog",
   "https://exemple.fr/source"
  ]
 },
 "menus": {
  "title": "Horaires de la mairie",
  "text": "## Horaires d'ouverture\nLa mairie est ouverte du lundi au vendredi de 7 h 30 à 15 h 30, sans interruption à midi.\nLe samedi matin, une permanence de l'état civil est assurée de 8 h à 11 h, sauf pendant les vacances scolaires.\nLundi au vendredi : 7 h 30 – 15 h 30, guichet unique",
  "published": "2026-03-14",
  "links": [
   "https://exemple.fr/fb"
  ]
 },
 "scripts": {
  "title": "Recette du rougail",
  "text": "## Rougail saucisse\nFaire revenir les saucisses coupées en rondelles, puis ajouter les oignons, l'ail, le gingembre et le curcuma.\nAjouter les tomates et laisser mijoter à feu doux pendant quarante minutes en remuant de temps en temps.\nServir avec du riz blanc, des grains et un rougail de tomates bien relevé au piment.",
  "author": "Chef Ali",
  "published": "2025-12-01",
  "links": []
 },
 "courte": {
  "title": "Note",
  "text": "Note Fermé lundi.",
  "published": "2026-03-14",
  "links": []
 },
 "sansArticle": {
  "title": "Liste des pharmacies de garde",
  "text": "Liste des pharmacies de garde Pharmacie du port, ouverte la nuit du samedi au dimanche.\nPharmacie centrale, ouverte le dimanche matin jusqu'à midi.\nPharmacie des Hauts, de garde les jours fériés. 15 novembre Plan Autre",
  "published": "2026-11-15",
  "links": [
   "https://exemple.fr/plan",
   "https://autre.exemple.org/x?a=1&b=2"
  ]
 },
 "entites": {
  "title": "Prix & tarifs – 2026",
  "text": "Le ticket coûte 1,50 € &mdash; le carnet de dix tickets coûte 12 € <tarif réduit> pour les étudiants et les plus de 65 ans.\nLes abonnements mensuels sont à 30 € et donnent accès à toutes les lignes du réseau, y compris la navette du port.\nLes enfants de moins de quatre ans voyagent gratuitement avec un adulte, sur présentation d'un justificatif.",
  "published": "2026-03-14",
  "links": []
 }
};

for (const nom of Object.keys(PAGES)) {
  test(`page normale « ${nom} » : même résultat qu'avant la réécriture`, () => {
    assert.deepEqual(JSON.parse(JSON.stringify(extractArticle(PAGES[nom], BASE))), ATTENDU[nom]);
  });
}

const M = 2 * 1024 * 1024;
const HOSTILES: Record<string, string> = {
  'paragraphes jamais fermés': '<p>'.repeat(M / 3),
  'menus jamais fermés': '<ul class="menu">'.repeat(M / 17),
  'scripts jamais fermés': `<html><body>${'<script><div class="content"><a href="/x">'.repeat(45_000)}</body></html>`,
  'liens sans fin de balise': '<a '.repeat(M / 3),
  'une balise meta géante': '<meta name="author" '.repeat(M / 20) + '>',
  'titres jamais fermés': '<title>'.repeat(M / 7),
  'chevrons seuls': '<'.repeat(M),
  'blocs mêlés': '<p><li><h2><td><pre>'.repeat(M / 20),
};
for (const [nom, h] of Object.entries(HOSTILES)) {
  test(`page hostile « ${nom} » (2 Mo) : lue en moins de 3 s`, () => {
    const t0 = performance.now();
    extractArticle(h, 'https://e.fr/');
    assert.ok(performance.now() - t0 < 3000, `${Math.round(performance.now() - t0)} ms`);
  });
}

test('une entité numérique impossible ne fait plus échouer la lecture de la page', () => {
  assert.equal(extractArticle('<p>' + '&#99999999;'.repeat(3) + '</p>', 'https://e.fr/').text, '���');
});

test('PDF : un « stream » jamais fermé ne fait plus tout reparcourir, et un flux normal est lu comme avant', () => {
  const t0 = performance.now();
  naivePdfText(Buffer.from('stream\n'.repeat(Math.floor(256 * 1024 / 7)), 'latin1'));
  assert.ok(performance.now() - t0 < 500, `${Math.round(performance.now() - t0)} ms`);
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << >>\nstream\r\nBT (Bonjour) Tj [(Bon) 120 (soir)] TJ (a\\)b) Tj ET\r\nendstream\nendobj\nstream\nsans fin', 'latin1');
  assert.equal(naivePdfText(pdf), 'Bonjour Bonsoir a)b\n');
});


// ---------------- Seconde relecture (carnets/relecture-extraction.md)
// Les attendus ci-dessous sont ceux de l'ANCIEN code (version d'origine) : la réécriture linéaire ne coupe plus aucune
// balise (une balise de plus de 1 000 caractères changeait le résultat sur des pages ordinaires).
test('une balise longue (attributs « data- » de plus de 1 000 caractères) donne le même résultat qu\'avant', () => {
  const y = 'y'.repeat(1200);
  assert.deepEqual(extractArticle(`<a data-x="${y}" href="https://exemple.fr/loin">x</a>`, 'https://e.fr/').links, ['https://exemple.fr/loin']);
  assert.equal(extractArticle(`<meta property="og:title" content="${'T'.repeat(1200)}"><title>court</title>`, 'https://e.fr/').title, 'T'.repeat(300));
  assert.equal(extractArticle(`<div data-x="${y}" class="menu"><p>${'menu '.repeat(20)}</p></div><p>${'vrai texte '.repeat(10)}</p>`, 'https://e.fr/').text, 'vrai texte '.repeat(10).trim());
});

test('une balise meta géante (noms et contenus répétés) est lue en temps linéaire, avec le même choix qu\'avant', () => {
  const t0 = performance.now();
  const r = extractArticle(`<meta ${'name="author" content="un" '.repeat(80_000)}content="dernier">`, 'https://e.fr/');
  assert.ok(performance.now() - t0 < 3000, `${Math.round(performance.now() - t0)} ms`);
  assert.equal(r.author, 'dernier', 'comme l\'expression d\'origine : le dernier « content » après un nom');
});

test('entités : « &#0; » et les demi-caractères restent comme avant ; seul un numéro impossible devient « � »', () => {
  assert.equal(extractArticle('<p>a&#0;b</p>', 'https://e.fr/').text, 'a\u0000b');
  assert.equal(extractArticle('<p>a&#55296;b</p>', 'https://e.fr/').text, 'a\ud800b');
});

test('PDF : 256 Ko de « ( » ou de « [( » dans un flux sont lus en moins d\'une seconde (lecture en une passe)', () => {
  for (const motif of ['(', '[(']) {
    const t0 = performance.now();
    naivePdfText(Buffer.from(`%PDF\nstream\n${motif.repeat(256 * 1024 / motif.length)}\nendstream\n`, 'latin1'));
    assert.ok(performance.now() - t0 < 1000, `« ${motif} » : ${Math.round(performance.now() - t0)} ms`);
  }
});

test('PDF : une bombe de décompression (300 Mo dans 300 Ko) ne remplit pas la mémoire', async () => {
  const { deflateSync } = await import('node:zlib');
  const bombe = deflateSync(Buffer.alloc(300 * 1024 * 1024, 0x20));
  const pdf = Buffer.concat([Buffer.from('%PDF\nstream\n', 'latin1'), bombe, Buffer.from('\nendstream\n', 'latin1')]);
  const avant = process.memoryUsage().rss;
  naivePdfText(pdf);
  assert.ok(process.memoryUsage().rss - avant < 100 * 1024 * 1024, `+${Math.round((process.memoryUsage().rss - avant) / 1048576)} Mo`);
});

test('PDF : chaînes à parenthèses équilibrées (norme PDF) — le seul cas où le texte change par rapport à avant', () => {
  // Avant : la chaîne s'arrêtait à la première « ) » et « (a(b)c) Tj » était perdu ; un flux sans parenthèses imbriquées
  // se lit exactement comme avant (500 PDF fabriqués comparés : 0 différence).
  assert.equal(naivePdfText(Buffer.from('%PDF\nstream\nBT (a(b)c) Tj ET\nendstream\n', 'latin1')), 'a(b)c\n');
  assert.equal(naivePdfText(Buffer.from('%PDF\nstream\nBT [(x]y) -120 (z)] TJ (\\101\\(\\)) Tj ET\nendstream\n', 'latin1')), 'x]yz A()\n');
});
