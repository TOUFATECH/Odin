// Fabrique les pages du site (site/*.html) à partir des fragments de tools/site/*.html et du gabarit commun
// _layout.html ; écrit sitemap.xml et robots.txt ; copie le visage d'Odin (src/web/face.js). Aucune dépendance.
// Le guide (site/guide.html) n'est PAS fait ici : il est fabriqué depuis le code par tools/guide/build.ts.
//   npm run site   (cette page-ci, puis le guide)
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'tools', 'site'), OUT = join(ROOT, 'site');
const BASE = 'https://toufatech.github.io/Odin';
interface Meta { nav: string; title: string; description: string; priority?: string; noindex?: boolean; jsonld?: unknown[]; genere?: string }
const PAGES = JSON.parse(readFileSync(join(SRC, 'pages.json'), 'utf8')) as Record<string, Meta>;
const TPL = readFileSync(join(SRC, '_layout.html'), 'utf8');
const MASCOT = readFileSync(join(SRC, 'parts', 'mascot.svg'), 'utf8').trim();
const NAV: Array<[string, string]> = [['index', 'Accueil'], ['fonctionnalites', 'Fonctionnalités'], ['autonomie', 'Autonomie'], ['securite', 'Sécurité'], ['installation', 'Installation'], ['guide', 'Guide'], ['faq', 'FAQ']];
const aujourdhui = new Date().toISOString().slice(0, 10);
const href = (slug: string) => (slug === 'index' ? './' : `./${slug}.html`);
const nav = (courant: string) => NAV.map(([s, t]) => `<li><a href="${href(s)}"${s === courant ? ' aria-current="page"' : ''}>${t}</a></li>`).join('\n');
const fil = (slug: string, titre: string) => (slug === 'index' ? '' : JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Accueil', item: `${BASE}/` }, { '@type': 'ListItem', position: 2, name: titre, item: `${BASE}/${slug}.html` }] }));

const faites: string[] = [];
for (const [slug, meta] of Object.entries(PAGES)) {
  if (meta.genere) continue; // fabriquée ailleurs (le guide)
  const fragment = join(SRC, `${slug}.html`);
  if (!existsSync(fragment)) throw new Error(`fragment absent : tools/site/${slug}.html`);
  let body = readFileSync(fragment, 'utf8').replaceAll('{{MASCOT}}', MASCOT);
  let ld = (meta.jsonld ?? []).map((x) => `<script type="application/ld+json">${JSON.stringify(x)}</script>`).join('');
  const bc = fil(slug, meta.nav); if (bc) ld += `<script type="application/ld+json">${bc}</script>`;
  const url = BASE + (slug === 'index' ? '/' : `/${slug}.html`);
  let html = TPL;
  const valeurs: Record<string, string> = { TITLE: meta.title, DESC: meta.description, URL: url, SLUG: slug, NAV: nav(slug), BODY: body, JSONLD: ld, ROBOTS: meta.noindex ? 'noindex, follow' : 'index, follow', YEAR: String(new Date().getFullYear()), BASE, MASCOT };
  for (const [k, v] of Object.entries(valeurs)) html = html.replaceAll(`{{${k}}}`, () => v);
  body = '';
  writeFileSync(join(OUT, `${slug}.html`), html);
  faites.push(slug);
}
const urls = Object.entries(PAGES).filter(([, m]) => !m.noindex).map(([s, m]) => [BASE + (s === 'index' ? '/' : `/${s}.html`), m.priority ?? '0.6']);
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, p]) => `  <url><loc>${u}</loc><lastmod>${aujourdhui}</lastmod><priority>${p}</priority></url>\n`).join('')}</urlset>\n`);
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${BASE}/sitemap.xml\n`);
copyFileSync(join(ROOT, 'src', 'web', 'face.js'), join(OUT, 'assets', 'face.js')); // même visage que l'interface d'Odin
console.log(`site : ${faites.join(', ')} (le guide : tools/guide/build.ts)`);
