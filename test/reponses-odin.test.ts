// Les réponses d'Odin, dans la Discussion, sa bulle et ses notifications : une seule mise en forme (pages/rendu.js).
//  1. Markdown sûr : tableaux alignés (défilement de côté), image (taille maîtrisée, zoom), son (lecteur), vidéo
//     (miniature, lecture au clic, Ouvrir / Copier le lien / Partager), logo d'une appli à côté de son nom ;
//     jamais de HTML venu du texte, liens http(s) seulement, images http(s) (passées par Odin) ou data:image.
//  2. Recherche depuis la discussion (Pythie) : la demande comprise, 5 résultats par défaut, nombre réglable et
//     gardé, chaque résultat avec une image, son titre et son texte (cartes, tableau, liste, navigateur).
//  3. « Odin consulte » : le chemin suivi dans le Cerveau (notes, liens, applis, dans l'ordre) part vers la carte.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { consultBrain } from '../src/brain/contexte.ts';
import { Vault } from '../src/brain/vault.ts';
import { brainOf } from '../src/tools/brain.ts';
import { syncSheets } from '../src/valhalla/fiches.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { parseDemande, RESULTATS_DEFAUT, resultatsMarkdown } from '../src/valhalla/volva/demande.ts';
import type { Source } from '../src/valhalla/volva/engine.ts';
import type { AgentEvent } from '../src/types.ts';
import { makeOdin } from './helpers.ts';

// ---------- Un faux document, juste ce que le moteur de rendu utilise ----------
class FNode {
  nodeType: number; tagName = ''; text = ''; attrs = new Map<string, string>(); kids: FNode[] = []; parent: FNode | null = null; on = new Map<string, Array<(e: unknown) => void>>();
  id = ''; textContent?: string;
  constructor(type: number, tag = '', text = '') { this.nodeType = type; this.tagName = tag.toUpperCase(); this.text = text; }
  get lastElementChild(): FNode | null { return [...this.kids].reverse().find((k) => k.nodeType === 1) ?? null; }
  get classList() { const n = this; return { add: (...c: string[]) => n.setAttribute('class', [...new Set([...(n.getAttribute('class') ?? '').split(' ').filter(Boolean), ...c])].join(' ')), remove: () => {} }; }
  append(...xs: Array<FNode | string>) { for (const x of xs) { const k = typeof x === 'string' ? new FNode(3, '', x) : x; k.parent?.kids.splice(k.parent.kids.indexOf(k), 1); k.parent = this; this.kids.push(k); } }
  appendChild(x: FNode) { this.append(x); return x; }
  replaceChildren(...xs: FNode[]) { this.kids = []; this.append(...xs); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  addEventListener(t: string, f: (e: unknown) => void) { this.on.set(t, [...(this.on.get(t) ?? []), f]); }
  fire(t: string) { for (const f of this.on.get(t) ?? []) f({ currentTarget: this, target: this, preventDefault() {} }); }
  all(): FNode[] { return this.kids.flatMap((k) => [k, ...k.all()]); }
  find(pred: (n: FNode) => boolean) { return this.all().find(pred); }
  html(): string {
    if (this.nodeType === 3) return this.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const t = this.tagName.toLowerCase(), a = [...this.attrs].map(([k, v]) => ` ${k}="${v.replace(/"/g, '&quot;')}"`).join('');
    return `<${t}${a}>${this.kids.map((k) => k.html()).join('')}</${t}>`;
  }
  get txt(): string { return this.nodeType === 3 ? this.text : this.kids.map((k) => k.txt).join(''); }
}
function rendu(): { R: { md: (t: string, o?: object) => FNode; setApps: (l: unknown[]) => void; safeHref: (u: string) => string | null; imgSrc: (u: string) => string | null; mediaOf: (u: string) => { kind: string; embed?: string } | null } } {
  const head = new FNode(1, 'head'), body = new FNode(1, 'body');
  const document = { head, body, createElement: (t: string) => new FNode(1, t), createTextNode: (t: string) => new FNode(3, '', t), getElementById: () => null, addEventListener: () => {}, removeEventListener: () => {} };
  const win: Record<string, unknown> = { document, URL, navigator: {}, setTimeout, OdinAppIcons: { svg: (id: string, name: string) => `<svg data-id="${id}">${name}</svg>` } };
  vm.runInNewContext(readFileSync(new URL('../src/web/pages/rendu.js', import.meta.url), 'utf8'), { window: win, URL, setTimeout, console });
  return { R: win.OdinRendu as never };
}

test('Markdown : un tableau devient un vrai tableau aligné, qui défile de côté sur téléphone', () => {
  const { R } = rendu();
  const t = R.md('Voici :\n\n| Appli | Prix | État |\n|:---|---:|:---:|\n| Pythie | 0 € | **prête** |\n| Orphée | 2 \\| 3 € | en cours |');
  const h = t.html();
  assert.match(h, /<div class="tblw" role="region" tabindex="0" aria-label="Tableau \(défile de côté\)"><table>/);
  assert.match(h, /<th scope="col" style="text-align:left">Appli<\/th><th scope="col" style="text-align:right">Prix<\/th><th scope="col" style="text-align:center">État<\/th>/);
  assert.match(h, /<td style="text-align:right">2 \| 3 €<\/td>/, 'barre échappée gardée dans la cellule');
  assert.match(h, /<strong>prête<\/strong>/);
  assert.equal(t.all().filter((n) => n.tagName === 'TR').length, 3);
  // Le style ajouté au document : défilement horizontal et cellules bornées.
  assert.match(readFileSync(new URL('../src/web/pages/rendu.js', import.meta.url), 'utf8'), /\.md \.tblw\{overflow-x:auto;max-width:100%/);
});

test('Markdown : titres, listes, gras, code, citation, et jamais de HTML venu du texte', () => {
  const { R } = rendu();
  const h = R.md('## Titre\n- un **gras**\n- deux `code`\n  - sous-point\n1. premier\n\n> cité\n\n<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n```js\nlet x = "<b>";\n```').html();
  assert.match(h, /<h3>Titre<\/h3>/); assert.match(h, /<ul><li>un <strong>gras<\/strong><\/li><li>deux <code>code<\/code><ul><li>sous-point<\/li><\/ul><\/li><\/ul>/);
  assert.match(h, /<ol><li>premier<\/li><\/ol>/); assert.match(h, /<blockquote>cité<\/blockquote>/);
  assert.doesNotMatch(h, /<script|<img/, 'aucune balise venue du texte');
  assert.ok(!R.md('<b onclick="x()">a</b>').all().some((n) => n.nodeType === 1 && n.tagName !== 'DIV' && n.tagName !== 'P'), 'seulement du texte');
  assert.match(h, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(h, /<pre class="code" data-lang="js"><code>let x = "&lt;b&gt;";<\/code>/);
});

test('Markdown : les liens dangereux sont refusés (javascript:, data:, //, guillemets)', () => {
  const { R } = rendu();
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x', '//evil.example/x', 'https://x.example/"onmouseover=alert(1)', 'file:///etc/passwd']) {
    const t = R.md(`[clique](${bad}) et ![img](${bad})`);
    assert.equal(t.all().filter((n) => n.tagName === 'A').length, 0, `lien refusé : ${bad}`);
    assert.equal(t.all().filter((n) => n.tagName === 'IMG').length, 0, `image refusée : ${bad}`);
    assert.equal(R.safeHref(bad), null, bad);
  }
  const ok = R.md('[Pythie](https://exemple.fr/a?b=1) et https://exemple.fr/page et [la page](/recherche?q=chats)');
  const links = ok.all().filter((n) => n.tagName === 'A');
  assert.deepEqual(links.map((a) => a.getAttribute('href')), ['https://exemple.fr/a?b=1', 'https://exemple.fr/page', '/recherche?q=chats']);
  assert.ok(links.every((a) => a.getAttribute('rel') === 'noopener noreferrer'));
  // Images : http(s) passées par Odin, data:image d'un type sûr ; jamais un SVG en data (il peut porter du script).
  assert.equal(R.imgSrc('https://ex.fr/c.png'), '/api/recherche/vignette?u=https%3A%2F%2Fex.fr%2Fc.png');
  assert.equal(R.imgSrc('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(R.imgSrc('data:image/svg+xml;base64,PHN2Zz4='), null);
});

test('Markdown : image (taille maîtrisée, zoom au clic), son (lecteur), vidéo (miniature, lecture au clic, boutons)', () => {
  const { R } = rendu();
  const img = R.md('![Le chat](https://ex.fr/chat.jpg)');
  const im = img.find((n) => n.tagName === 'IMG')!;
  assert.equal(im.getAttribute('src'), '/api/recherche/vignette?u=https%3A%2F%2Fex.fr%2Fchat.jpg'); assert.equal(im.getAttribute('class'), 'md-img'); assert.equal(im.getAttribute('loading'), 'lazy');
  assert.equal(img.find((n) => n.tagName === 'BUTTON')!.getAttribute('class'), 'md-zoom', 'un clic agrandit');
  assert.match(img.html(), /<figcaption>Le chat<\/figcaption>/);

  const son = R.md('Écoute :\n\nhttps://ex.fr/podcast/episode-1.mp3');
  const au = son.find((n) => n.tagName === 'AUDIO')!;
  assert.equal(au.getAttribute('src'), 'https://ex.fr/podcast/episode-1.mp3'); assert.equal(au.getAttribute('preload'), 'none'); assert.ok(au.attrs.has('controls'));

  const vid = R.md('[La bande-annonce](https://www.youtube.com/watch?v=dQw4w9WgXcQ)');
  assert.equal(vid.all().filter((n) => n.tagName === 'IFRAME').length, 0, 'rien ne se charge avant le clic');
  assert.match(vid.html(), /src="\/api\/recherche\/vignette\?u=https%3A%2F%2Fi\.ytimg\.com%2Fvi%2FdQw4w9WgXcQ%2Fhqdefault\.jpg"/, 'miniature passée par Odin');
  const labels = vid.all().filter((n) => n.tagName === 'BUTTON' || n.tagName === 'A').map((n) => n.txt);
  for (const l of ['Ouvrir dans le navigateur', 'Copier le lien', 'Partager']) assert.ok(labels.includes(l), l);
  vid.find((n) => n.getAttribute('class') === 'md-vplay')!.fire('click');
  const fr = vid.find((n) => n.tagName === 'IFRAME')!;
  assert.equal(fr.getAttribute('src'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0');
  assert.match(fr.getAttribute('sandbox')!, /allow-scripts/);
  // Un fichier vidéo : le lecteur du navigateur, au clic.
  const mp4 = R.md('https://ex.fr/film.mp4'); mp4.find((n) => n.getAttribute('class') === 'md-vplay')!.fire('click');
  assert.equal(mp4.find((n) => n.tagName === 'VIDEO')!.getAttribute('src'), 'https://ex.fr/film.mp4');
  assert.equal(R.mediaOf('https://youtu.be/dQw4w9WgXcQ')?.kind, 'video'); assert.equal(R.mediaOf('https://ex.fr/a.ogg')?.kind, 'audio'); assert.equal(R.mediaOf('https://ex.fr/page.html'), null);
});

test('Markdown : quand Odin parle d\'une appli, son logo s\'affiche à côté de son nom', () => {
  const { R } = rendu();
  R.setApps([{ id: 'volva', name: 'Pythie' }, { id: 'bragi', name: 'Orphée' }]);
  const t = R.md('**Pythie** a cherché, puis Orphée lit la réponse. Orphée encore.');
  const tags = t.all().filter((n) => n.getAttribute('class') === 'md-app');
  assert.deepEqual(tags.map((n) => n.getAttribute('data-appli')), ['volva', 'bragi'], 'une seule fois par appli');
  assert.equal(tags[0].tagName, 'STRONG');
  const ic = tags[0].find((n) => n.tagName === 'IMG')!;
  assert.match(ic.getAttribute('src')!, /^data:image\/svg\+xml;charset=utf-8,/); assert.equal(ic.getAttribute('aria-hidden'), 'true');
  assert.match(t.txt, /Pythie a cherché, puis Orphée lit la réponse\. Orphée encore\./, 'le texte reste lisible');
  // Un mot qui contient le nom n'est pas pris (« Pythies »).
  assert.equal(R.md('Les Pythies grecques').all().filter((n) => n.getAttribute('class') === 'md-app').length, 0);
});

// ---------- Recherche depuis la discussion ----------
test('Recherche : la demande est comprise (question, nombre, sorte, affichage) et reste étroite', () => {
  assert.deepEqual(parseDemande('Odin, fais-moi une recherche sur les panneaux solaires'), { q: 'les panneaux solaires', n: undefined, sorte: 'pages', affichage: undefined });
  assert.deepEqual(parseDemande('montre-moi 10 résultats'), { q: '', n: 10, sorte: 'pages', affichage: undefined });
  assert.deepEqual(parseDemande('donne-moi six résultats sur Mayotte'), { q: 'Mayotte', n: 6, sorte: 'pages', affichage: undefined });
  assert.deepEqual(parseDemande('cherche des vidéos de chats en tableau'), { q: 'chats', n: undefined, sorte: 'videos', affichage: 'tableau' });
  assert.equal(parseDemande('trouve-moi des images de la tour Eiffel')?.sorte, 'images');
  assert.equal(parseDemande('cherche des sons de pluie')?.sorte, 'sons');
  assert.equal(parseDemande('fais une recherche sur le climat dans le navigateur')?.affichage, 'navigateur');
  assert.equal(parseDemande('fais-moi une recherche sur le climat à voix haute')?.affichage, 'audio');
  assert.equal(parseDemande('fais une recherche web sur le prix du cuivre, 8 résultats')?.n, 8);
  assert.equal(parseDemande('fais une recherche web sur le prix du cuivre, 8 résultats')?.q, 'le prix du cuivre');
  assert.equal(parseDemande('Fais-moi une recherche sur Mamoudzou')?.q, 'Mamoudzou', 'la question garde ses majuscules');
  for (const no of ['Cherche un hôtel à Paris pour la semaine prochaine', 'cherche dans mes notes facture orange', 'cherche les partitions perdues', 'Je cherche un cadeau pour mon fils', 'montre-moi mes photos', 'trouve la facture du mois dernier', 'Cherche sur internet le prix d\'un Starlink']) assert.equal(parseDemande(no), undefined, no);
});

const SRC = (n: number): Source[] => Array.from({ length: n }, (_, i) => ({ n: i + 1, title: `Titre ${i + 1} [pub]`, url: `https://site${i + 1}.fr/page`, domain: `site${i + 1}.fr`, snippet: `Texte du résultat ${i + 1}\nsur deux lignes | avec une barre`, engines: ['google'], ...(i % 2 ? { thumb: `https://img.site${i + 1}.fr/v.jpg` } : {}) }));

test('Recherche : chaque résultat a une image, son titre en haut, puis son texte (cartes, tableau, liste)', () => {
  const { R } = rendu();
  const md = resultatsMarkdown(SRC(5), { q: 'chats', sorte: 'pages' });
  assert.match(md, /^\*\*5 résultats\*\* pour « chats » \(Pythie\)/);
  assert.match(md, /```resultats cartes pages\n- \[Titre 1 pub\]\(https:\/\/site1\.fr\/page\) — Texte du résultat 1 sur deux lignes avec une barre\n- \[Titre 2 pub\]\(https:\/\/site2\.fr\/page\) !\[\]\(https:\/\/img\.site2\.fr\/v\.jpg\) — /, 'lisible aussi sans mise en forme');
  const t = R.md(md), cards = t.all().filter((n) => n.getAttribute('class') === 'md-rc');
  assert.equal(cards.length, 5);
  for (const c of cards) {
    const kids = c.kids.map((k) => k.getAttribute('class'));
    assert.deepEqual(kids, ['md-rc-img', 'md-rc-b'], 'l\'image, puis le texte');
    const b = c.kids[1].kids; assert.equal(b[0].getAttribute('class'), 'md-rt', 'le titre en haut'); assert.equal(b[1].tagName, 'P', 'puis le texte'); assert.equal(b[2].tagName, 'SMALL', 'puis le site');
    assert.ok(c.find((n) => n.tagName === 'IMG'), 'une image pour chaque résultat');
  }
  // Sans vignette : l'icône du site (passée par Odin) ; avec : la vignette.
  assert.equal(cards[0].find((n) => n.tagName === 'IMG')!.getAttribute('src'), '/api/recherche/vignette?u=https%3A%2F%2Fsite1.fr%2Ffavicon.ico');
  assert.equal(cards[1].find((n) => n.tagName === 'IMG')!.getAttribute('src'), '/api/recherche/vignette?u=https%3A%2F%2Fimg.site2.fr%2Fv.jpg');
  // En tableau : image, titre, description, site.
  const tab = R.md(resultatsMarkdown(SRC(3), { q: 'chats', affichage: 'tableau' }));
  assert.deepEqual(tab.all().filter((n) => n.tagName === 'TH').map((n) => n.txt), ['Image', 'Titre', 'Description', 'Site']);
  assert.equal(tab.all().filter((n) => n.tagName === 'TR').length, 4);
  // En liste, et en vidéos (lecture au clic + boutons).
  assert.equal(R.md(resultatsMarkdown(SRC(4), { q: 'x', affichage: 'liste' })).all().filter((n) => n.tagName === 'LI').length, 4);
  const v = R.md(resultatsMarkdown([{ n: 1, title: 'Chat qui saute', url: 'https://www.youtube.com/watch?v=abcdefghijk', domain: 'youtube.com', snippet: 'Un chat.', engines: ['youtube'] }], { q: 'chats', sorte: 'videos' }));
  assert.ok(v.find((n) => n.getAttribute('class') === 'md-video')); assert.ok(v.all().some((n) => n.txt === 'Partager'));
  // Images : une grille, zoom au clic.
  assert.ok(R.md(resultatsMarkdown(SRC(2), { q: 'x', sorte: 'images' })).find((n) => n.getAttribute('class') === 'md-rgrid'));
});

test('Recherche : 5 résultats par défaut, « montre-moi 10 résultats » change le nombre et le garde', async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-reponses-'));
  const searx = { results: Array.from({ length: 15 }, (_, i) => ({ title: `Résultat ${i + 1}`, url: `https://domaine${i + 1}.fr/a`, content: `Texte ${i + 1}`, engines: ['google', 'bing'], thumbnail: `https://img${i + 1}.fr/t.jpg` })) };
  const asked: string[] = [];
  const v = new Valhalla(home, allModules({ paths: { home, workspace: join(home, 'w') }, cfg: { venus: {}, voice: {} } } as never), {
    notify: async () => {},
    fetch: (async (u: string) => { asked.push(String(u)); return new Response(JSON.stringify(/\/search\?/.test(String(u)) ? searx : {}), { headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch,
  });
  try {
    v.ctx('volva').saveSettings({ searxng: 'http://127.0.0.1:8888', moteurs: ['searxng'] });
    const r1 = await v.act('volva', 'resultats', { question: 'les chats' });
    assert.ok(r1.ok !== false, r1.text);
    assert.equal((r1.data as { sources: unknown[] }).sources.length, RESULTATS_DEFAUT);
    assert.match(r1.text, /```resultats cartes pages\n/);
    assert.equal((r1.text.match(/^- \[/gm) ?? []).length, 5);
    assert.match(r1.text, /!\[\]\(https:\/\/img1\.fr\/t\.jpg\)/, 'la vignette de SearXNG passe jusqu\'à la carte');
    const r2 = await v.act('volva', 'resultats', { n: 10 });
    assert.equal((r2.data as { sources: unknown[]; question: string }).sources.length, 10);
    assert.equal((r2.data as { question: string }).question, 'les chats', 'sans question : la dernière recherche');
    assert.equal(v.ctx('volva').settings.nbResultats, 10, 'le nombre est gardé comme réglage');
    const r3 = await v.act('volva', 'resultats', { question: 'les chiens', affichage: 'tableau' });
    assert.equal((r3.data as { sources: unknown[] }).sources.length, 10); assert.match(r3.text, /```resultats tableau pages/);
    const r4 = await v.act('volva', 'resultats', { question: 'les chiens', affichage: 'navigateur' });
    assert.match(r4.text, /\[Ouvrir dans le navigateur\]\(\/recherche\?q=les%20chiens\)/);
    assert.ok(asked.some((u) => /categories=general/.test(u)));
    await v.act('volva', 'resultats', { question: 'chats', sorte: 'videos' });
    assert.ok(asked.some((u) => /categories=videos/.test(u)), 'les vidéos sont cherchées dans la catégorie vidéos');
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});

// ---------- « Odin consulte » ----------
test('« Odin consulte » : le chemin suivi dans le Cerveau (applis, notes, liens), dans l\'ordre', async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-consulte-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: join(home, 'w') }, cfg: { venus: {}, voice: {} } } as never), { notify: async () => {} });
  const vault = new Vault(join(home, 'cerveau'));
  try {
    syncSheets(vault, v.modules());
    vault.create('Photos de vacances', 'projet', 'Garder les photos de la Réunion en lieu sûr. Le support : [[Disque USB]].');
    vault.create('Disque USB', 'note', 'Le disque de 2 To branché sur le NAS, réservé aux photos.');
    const c = consultBrain({ vault, apps: v }, 'sauvegarde mes photos');
    assert.ok(c.etapes.length >= 3, JSON.stringify(c.etapes));
    assert.equal(c.etapes[0].de, 'odin', 'Odin part de lui-même');
    assert.ok(c.etapes.some((e) => e.de === 'odin' && ['sindri', 'sol'].includes(e.vers)), 'les applis consultées');
    const note = c.etapes.find((e) => e.versNom === 'Photos de vacances'), lien = c.etapes.find((e) => e.versNom === 'Disque USB');
    assert.ok(note && lien, 'la note et la note reliée');
    assert.equal(lien!.de, note!.vers, 'le lien [[…]] part de la note qui le porte');
    assert.ok(c.etapes.indexOf(note!) < c.etapes.indexOf(lien!), 'dans l\'ordre');
    for (const e of c.etapes) assert.deepEqual(Object.keys(e).sort(), ['de', 'deNom', 'libelle', 'vers', 'versNom'], 'jamais le contenu des notes');
    assert.equal(consultBrain({ vault, apps: v }, 'bonjour').etapes.length, 0);
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});

test('« Odin consulte » : l\'agent envoie l\'événement pendant le tour, la page allume le chemin', async () => {
  const o = makeOdin([{ text: 'Je lance la sauvegarde.' }], { config: (c) => ({ ...c, routing: { ...c.routing, directFirst: false } }) });
  const home = mkdtempSync(join(tmpdir(), 'odin-consulte-agent-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: join(home, 'w') }, cfg: { venus: {}, voice: {} } } as never), { notify: async () => {} });
  try {
    setValhalla(v);
    const vault = brainOf({ home: o.paths.home, careCfg: o.cfg, workspace: o.paths.workspace });
    syncSheets(vault, v.modules());
    vault.create('Photos de vacances', 'projet', 'Garder les photos. Support : [[Disque USB]].');
    vault.create('Disque USB', 'note', 'Le disque de 2 To pour les photos.');
    const events: AgentEvent[] = [];
    await o.agent.run('sauvegarde mes photos', { sessionId: 'web:essai', onEvent: (e) => events.push(e) });
    const ev = events.find((e) => e.type === 'consulte') as Extract<AgentEvent, { type: 'consulte' }> | undefined;
    assert.ok(ev, 'événement « consulte »');
    assert.ok(ev!.etapes.some((e) => e.versNom === 'Disque USB'));
    // La page : l'événement passe par le moteur des échanges de graph.js (pas un deuxième mécanisme).
    const ui = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8'), brain = readFileSync(new URL('../src/web/brain.js', import.meta.url), 'utf8');
    assert.match(ui, /d\.event\.type === 'consulte'\) consulte\(d\.event\.etapes\)/);
    assert.match(ui, /E\.recevoir\(\{ \.\.\.e, action: 'consulter', phase: 'demande'/);
    assert.match(brain, /if \(id === 'odin'\) return \{ id: 'odin', x: 0, y: 0, r: 0 \}/);
    assert.match(brain, /fichesApplis\.get\(nom\) \|\| byId\.get\(id\)/);
  } finally { setValhalla(undefined); v.stop(); rmSync(home, { recursive: true, force: true }); o.cleanup(); }
});

test('Le Cerveau reste rapide : une note inchangée n\'est pas relue, les recherches réutilisent le texte replié', () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-cerveau-vite-'));
  try {
    const vault = new Vault(join(home, 'cerveau'));
    for (let i = 0; i < 300; i++) vault.create(`Note ${i}`, 'note', `Photos et sauvegarde ${i}. ${'Texte. '.repeat(50)}`);
    const a = vault.all(true), b = vault.all(true);
    assert.equal(a.length, 300); assert.equal(a[7], b[7], 'même objet : la note n\'a pas été relue');
    vault.write(vault.find('Note 7')!.path, { type: 'note' }, 'Changée.');
    assert.equal(vault.find('Note 7')?.body.trim(), 'Changée.', 'une note modifiée est relue');
    const t0 = performance.now(); for (let i = 0; i < 20; i++) consultBrain({ vault }, `sauvegarde des photos ${i}`); const ms = (performance.now() - t0) / 20;
    assert.ok(ms < 60, `consultation du Cerveau : ${ms.toFixed(1)} ms`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('L\'infobulle et les notifications d\'Odin utilisent la même mise en forme, se ferment et s\'animent en douceur', () => {
  const n = readFileSync(new URL('../src/web/notices.js', import.meta.url), 'utf8'), ui = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');
  assert.match(n, /window\.OdinRendu\.md\(String\(t \?\? ''\), \{ compact: true \}\)/, 'la bulle passe par le moteur partagé');
  assert.match(n, /out\.replaceChildren\(rich\(/, 'la réponse dans la bulle est mise en forme');
  assert.match(n, /el\('div', \{ class: 'oa-d' \}, rich\(n\.detail\)\)/, 'le détail des notifications aussi');
  assert.match(n, /e\.key === 'Escape' && talk && !talk\.hidden/, 'Échap ferme la bulle');
  assert.match(n, /document\.addEventListener\('pointerdown'/, 'toucher dehors la ferme');
  assert.match(n, /aria-label': 'Fermer'/, 'bouton ×');
  assert.match(n, /max-height:min\(52vh,440px\)/, 'taille bornée, défilement interne');
  assert.match(n, /@media \(prefers-reduced-motion:reduce\)\{#odinTalk\.ot-in,#odinTalk\.ot-ghost\{animation:none\}\}/);
  assert.match(ui, /function md\(text\) \{ return window\.OdinRendu \? window\.OdinRendu\.md\(text\)/, 'la Discussion aussi : un seul moteur');
  assert.doesNotMatch(ui, /function mdInline\(/, 'l\'ancien moteur de la Discussion est retiré');
});
