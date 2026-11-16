// Lyncée, le moteur de Pythie : chaque adaptateur, sur un échantillon réduit et neutre (aucun service réel).
// La requête ne porte que la question (encodée) vers un hôte de moteur écrit en dur ; la lecture donne des liens
// directs, retire les publicités et reconnaît les contrôles anti-robot, les refus et les limites de débit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADAPTATEURS, HOTES_MOTEURS, adaptateur } from '../src/valhalla/volva/lyncee/adaptateurs.ts';
import { entetes, UA_API } from '../src/valhalla/volva/lyncee/types.ts';
import { lienDirect, texteSur } from '../src/valhalla/volva/lyncee/lecteurs.ts';
import type { Lecture, ResultatMoteur } from '../src/valhalla/volva/lyncee/types.ts';

const E = (f: string) => readFileSync(join(import.meta.dirname, 'echantillons-lyncee', f), 'utf8');
const lu = (id: string, f: string, statut = 200): ResultatMoteur[] => {
  const l = adaptateur(id)!.lire(E(f), statut, 'https://exemple.test/');
  assert.ok('resultats' in l, `${id} : ${JSON.stringify(l)}`); return l.resultats;
};
const bloque = (l: Lecture) => ('bloque' in l ? l.genre : 'non');

test('requêtes : une adresse de moteur écrite en dur, seule la question y change (encodée)', () => {
  const ids = new Set<string>();
  for (const a of ADAPTATEURS) {
    assert.ok(!ids.has(a.id), `id unique : ${a.id}`); ids.add(a.id);
    for (const c of a.categories) for (const p of [1, 2]) {
      const r1 = a.requete('tour eiffel & co', c, p), r2 = a.requete('autre?#x', c, p);
      const u = new URL(r1.url);
      assert.equal(u.protocol, 'https:', a.id); assert.ok(HOTES_MOTEURS.has(u.hostname), `${a.id} : ${u.hostname}`);
      const plat = (r: { url: string; body?: string }) => `${r.url} ${r.body ?? ''}`;
      const q1 = /tour(%20|\+)eiffel(%20|\+)%26(%20|\+)co/i, q2 = /autre%3F%23x/i;
      assert.match(plat(r1), q1, `${a.id} : la question encodée`); assert.match(plat(r2), q2, a.id);
      assert.equal(plat(r1).replace(q1, 'Q'), plat(r2).replace(q2, 'Q'), `${a.id} : rien d'autre ne change`);
      assert.ok(!/[?&](vqd|sst|IG|CID|_ylt|cookie)=/i.test(plat(r1)), `${a.id} : aucun jeton`);
    }
    if (a.pagine !== false) assert.notEqual(a.requete('x', a.categories[0], 1).url + (a.requete('x', a.categories[0], 1).body ?? ''), a.requete('x', a.categories[0], 2).url + (a.requete('x', a.categories[0], 2).body ?? ''), `${a.id} : la page change la requête`);
  }
  const dd = adaptateur('duckduckgo')!.requete('q', 'web', 3);
  assert.equal(dd.method, 'POST'); assert.equal(dd.body, 'q=q&kl=fr-fr&s=20');
  assert.equal(adaptateur('duckduckgo_lite')!.famille, 'duckduckgo'); assert.equal(adaptateur('duckduckgo_lite')!.etiquette, 'DuckDuckGo');
  assert.equal(entetes('api')['user-agent'], UA_API); assert.equal(entetes('page')['accept-language'], 'fr-FR,fr;q=0.9');
  for (const g of ['api', 'page'] as const) assert.ok(!Object.keys(entetes(g)).some((k) => /cookie|referer/i.test(k)), 'jamais de cookie ni de référent');
});

test('lectures : pages web (DuckDuckGo, Yahoo, Bing, Brave), liens directs, publicités retirées', () => {
  const dd = lu('duckduckgo', 'ddg.html');
  assert.deepEqual(dd.map((r) => r.url), ['https://fr.wikipedia.org/wiki/Tour_Eiffel', 'https://www.toureiffel.paris/fr/le-monument/chiffres-cle'], 'pub retirée, uddg= décodé');
  assert.match(dd[0].snippet, /s'inscrit dans un carré/);
  assert.equal((adaptateur('duckduckgo')!.lire(E('ddg.html'), 200, '') as { suivante?: boolean }).suivante, true);
  assert.deepEqual(lu('duckduckgo_lite', 'ddg-lite.html').map((r) => [r.title, r.url]), [['Tour Eiffel — Wikipédia', 'https://fr.wikipedia.org/wiki/Tour_Eiffel'], ['Hauteur, poids, construction', 'https://www.toureiffel.paris/fr/le-monument/chiffres-cle']]);
  const y = lu('yahoo', 'yahoo.html');
  assert.deepEqual(y.map((r) => r.url), ['https://www.toureiffel.paris/fr/le-monument/chiffres-cle', 'https://fr.wikipedia.org/wiki/Tour_Eiffel'], 'RU= décodé sans appel, sponsorisé retiré');
  assert.equal(y[1].title, 'Tour Eiffel — Wikipédia'); assert.match(y[0].snippet, /indifférent/);
  const b = lu('bing', 'bing.html');
  assert.deepEqual(b.map((r) => r.url), ['https://www.toureiffel.paris/fr/le-monument', 'https://fr.wikipedia.org/wiki/Tour_Eiffel'], 'u=a1 décodé, b_ad retiré');
  const br = lu('brave', 'brave.html');
  assert.deepEqual(br.map((r) => r.title), ['Hauteur, poids, construction - La Tour Eiffel', 'Tour Eiffel — Wikipédia']);
  assert.match(br[0].snippet, /Exposition universelle de 1889/);
});

test('lectures : actualités, images, vidéos, savoir (vignettes et dates)', () => {
  const g = lu('google_actus', 'gnews.rss');
  assert.deepEqual(g[0], { title: 'La tour Eiffel change de taille avec le thermomètre', url: 'https://news.google.com/rss/articles/ARTICLE-OPAQUE-1?oc=5', snippet: 'Journal Exemple · 16/06/2026 · lien via Google Actualités', published: '2026-06-16', site: 'journal.exemple' }, 'lien opaque gardé tel quel, site tiré de <source>');
  const ba = lu('bing_actus', 'bing-actus.rss');
  assert.equal(ba[0].url, 'https://www.journal.exemple/tour-eiffel-ete.html', 'url= décodé'); assert.equal(ba[0].title, 'La tour Eiffel grandit jusqu’à 15 cm en été');
  assert.equal(ba[0].thumb, 'https://www.bing.com/th?id=ONUT.exemple&pid=News'); assert.equal(ba[0].published, '2026-11-13');
  const na = lu('brave_actus', 'brave-actus.html');
  assert.deepEqual([na[0].url, na[0].thumb], ['https://actu.exemple.fr/tour-eiffel-hauteur', 'https://imgs.search.brave.com/vignette-actu-1']);
  const bi = lu('bing_images', 'bing-images.html');
  assert.deepEqual([bi[0].title, bi[0].url, bi[0].thumb], ['Tour Eiffel : l\'histoire de l\'icône', 'https://www.exemple.fr/tour-eiffel/histoire', 'https://ts4.mm.bing.net/th?id=OIP.exemple1&pid=15.1'], 'purl = la page, turl = la vignette');
  const im = lu('brave_images', 'brave-images.html');
  assert.deepEqual(im.map((r) => [r.title, r.url, r.thumb]), [['La tour Eiffel au coucher du soleil', 'https://photos.exemple.fr/tour-eiffel', 'https://imgs.search.brave.com/vignette-image-1'], ['Tour "Eiffel" de nuit', 'https://images.exemple.org/nuit', 'https://imgs.search.brave.com/vignette-image-2']]);
  const co = lu('commons', 'commons.json');
  assert.deepEqual(co.map((r) => r.title), ['Tour Eiffel vue du Trocadéro', 'Tour Eiffel de nuit'], 'dans l\'ordre de la recherche');
  assert.equal(co[1].thumb, 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b7/Tour_Eiffel_de_nuit.jpg/300px-Tour_Eiffel_de_nuit.jpg', 'utm_ retirés');
  const ov = lu('openverse', 'openverse.json');
  assert.deepEqual([ov[0].url, ov[0].snippet], ['https://www.photos.exemple/tour-1', 'Auteur Exemple · licence BY-SA 2.0']); assert.match(ov[0].thumb!, /^https:\/\/api\.openverse\.org\//);
  const bv = lu('bing_videos', 'bing-videos.html');
  assert.deepEqual(bv[0], { title: 'La tour Eiffel, visite complète', url: 'https://video.exemple.org/watch/visite', snippet: 'Durée 1:23:29', thumb: 'https://tse1.mm.bing.net/th/id/OVP.exemple1?w=320&h=180&c=7' });
  const bvv = lu('brave_videos', 'brave-videos.html');
  assert.deepEqual([bvv[0].url, bvv[0].snippet, bvv[0].thumb], ['https://video.exemple.org/watch/tour-eiffel', '09:26 · Visite guidée du monument.', 'https://imgs.search.brave.com/vignette-video-1']);
  const se = lu('sepia', 'sepia.json');
  assert.deepEqual([se[0].snippet, se[0].published, se[1].snippet], ['Durée 1:03 · Chaîne Exemple', '2026-09-07', 'Durée 12:55 · Compte Exemple']);
  const wp = lu('wikipedia', 'wikipedia.json');
  assert.deepEqual(wp[0], { title: 'Tour Eiffel', url: 'https://fr.wikipedia.org/wiki/Tour_Eiffel', snippet: 'La tour Eiffel est une tour de fer puddlé de 330 m de hauteur' }, 'balises searchmatch retirées');
  assert.equal(wp[1].snippet, 'l\'autorisation de Gustave Eiffel');
  assert.deepEqual(lu('wikidata', 'wikidata.json')[0], { title: 'tour Eiffel', url: 'https://www.wikidata.org/wiki/Q243', snippet: 'tour située sur le Champ-de-Mars à Paris' });
});

test('blocages : contrôle anti-robot, refus, limite de débit, consentement (jamais contournés)', () => {
  const bing = adaptateur('bing')!, dd = adaptateur('duckduckgo')!, brave = adaptateur('brave')!, yahoo = adaptateur('yahoo')!;
  const b = bing.lire(E('bing-bloque.html'), 200, 'https://www.bing.com/search');
  assert.deepEqual(b, { bloque: 'contrôle anti-robot', genre: 'blocage' }, 'b_no + PoWChallenge');
  assert.deepEqual(bing.lire('<html><body><ol id="b_results"></ol></body></html>', 200, ''), { resultats: [], suivante: false }, 'une page vide sans signe de blocage : 0 résultat');
  assert.equal(bloque(dd.lire(E('ddg-anomalie.html'), 200, '')), 'blocage');
  assert.equal(bloque(dd.lire('', 202, '')), 'limite', '202 de DuckDuckGo');
  assert.equal(bloque(brave.lire('', 429, '')), 'limite');
  assert.equal(bloque(brave.lire('', 403, '')), 'blocage');
  assert.equal(bloque(brave.lire(E('brave-captcha.html'), 200, '')), 'blocage');
  assert.equal(bloque(brave.lire(E('brave.html'), 200, '')), 'non', 'le mot captcha dans un libellé n\'est pas un blocage');
  assert.equal(bloque(adaptateur('openverse')!.lire('', 302, '', 'https://api.openverse.org/showcaptcha?x=1')), 'blocage', '3xx vers showcaptcha');
  const c = yahoo.lire('', 302, 'https://search.yahoo.com/search', 'https://consent.yahoo.com/v2/collectConsent?sessionId=x');
  assert.ok('bloque' in c && /consentement/.test(c.bloque) && c.genre === 'blocage', 'consentement Yahoo : jamais accepté');
});

test('texte sûr et liens directs (purs)', () => {
  assert.equal(texteSur('<b>A</b> &amp; <script>alert(1)</script>&eacute;t&#233; &#x2014; <i>x</i>'), 'A & été — x');
  assert.equal(lienDirect('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexemple.fr%2Fa&amp;rut=1'), 'https://exemple.fr/a');
  assert.equal(lienDirect('https://r.search.yahoo.com/RV=2/RE=0/RO=10/RU=https%3a%2f%2fexemple.fr%2fb/RK=2/RS=0-'), 'https://exemple.fr/b');
  assert.equal(lienDirect('http://www.bing.com/news/apiclick.aspx?ref=FexRss&url=https%3a%2f%2fexemple.fr%2fc&c=1'), 'https://exemple.fr/c');
  assert.equal(lienDirect(`https://www.bing.com/ck/a?!&p=0&u=a1${Buffer.from('https://exemple.fr/d').toString('base64url')}&ntb=1`), 'https://exemple.fr/d');
});
