// Le guide d'Odin : UNE seule page, publiée par le site (site/guide.html). Les fiches des applis, leurs actions, leurs
// phrases et leurs liens viennent du code ; l'état de chaque chantier vient de docs/etat.json ; le reste est le texte
// rédigé de tools/guide/template.html. Le même passage met à jour la partie « Fait, en cours, à venir » du README.
//   npm run guide            (guide + README)
//   npm run site             (les autres pages du site, puis le guide)
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { examples } from '../../src/valhalla/huginn.ts';
import { LINKS, USAGES } from '../../src/valhalla/links.ts';
import { allModules } from '../../src/valhalla/odin.ts';
import { avecEtat, lireEtat } from './etat.ts';

const D = dirname(fileURLToPath(import.meta.url)), ROOT = join(D, '..', '..'), home = mkdtempSync(join(tmpdir(), 'odin-doc-'));
const mods = allModules({ paths: { home, workspace: home }, cfg: { venus: { url: '' }, voice: {} } } as never);
const name = (id: string) => mods.find((m) => m.id === id)?.name ?? id;
const apps = mods.map((m) => ({ id: m.id, n: m.name, f: m.family, w: m.what, d: m.does, m: m.modes ?? [], o: m.from, x: examples(m).slice(0, 6),
  a: m.actions.map((a) => ({ l: a.label, w: a.what, k: a.read ? 'l' : a.grave ? 'g' : a.undo ? 'u' : 'a' })),
  li: LINKS.filter((l) => l.to === m.id && l.from !== m.id).map((l) => ({ n: name(l.from), t: `quand ${l.when}, ${l.does}` })),
  lo: LINKS.filter((l) => l.from === m.id).map((l) => ({ n: l.to === m.id ? '' : name(l.to), t: `quand ${l.when}, ${l.does}` })) }));
const etat = lireEtat(ROOT);
const data = {
  apps, links: LINKS.map((l) => ({ a: name(l.from), b: name(l.to), k: l.kind, t: `quand ${l.when}, ${l.does}` })), usages: USAGES.map((u) => ({ n: u.need, c: u.chain.map(name), w: u.why })),
  etat: etat.elements.map((e) => ({ nom: e.nom, etat: e.etat, famille: e.famille, resume: e.resume ?? '' })),
  n: { apps: apps.length, links: LINKS.length, actions: apps.reduce((s, a) => s + a.a.length, 0), fait: etat.elements.filter((e) => e.etat === 'fait').length, encours: etat.elements.filter((e) => e.etat === 'en cours').length, maj: etat.maj.split('-').reverse().join('/') },
};
const mascot = readFileSync(join(ROOT, 'tools', 'site', 'parts', 'mascot.svg'), 'utf8').trim();
let html = readFileSync(`${D}/template.html`, 'utf8');
// Le visage d'Odin est celui de l'appli : son code (humeurs, couleurs, sons) et ses règles d'affichage sont repris tels quels.
const ui = readFileSync(join(ROOT, 'src', 'web', 'ui.html'), 'utf8').split('\n');
const from = ui.findIndex((l) => l.startsWith('.odin{display:inline-block')), to = ui.findIndex((l) => l.startsWith('@media (prefers-reduced-motion:reduce){.odin .talk'));
if (from < 0 || to < from) throw new Error('règles de la mascotte introuvables dans src/web/ui.html');
const faceCss = ui.slice(from, to + 1).join('\n'), faceJs = readFileSync(join(ROOT, 'src', 'web', 'face.js'), 'utf8');
if (/<\/script/i.test(faceJs) || /<\/style/i.test(faceCss)) throw new Error('le code de la mascotte ne peut pas être inséré tel quel');
for (const mark of ['<!--MASCOT-->', '/*FACE-CSS*/', '/*FACE-JS*/', '/*DATA*/null', '</style>']) if (!html.includes(mark)) throw new Error(`repère absent du gabarit : ${mark}`);
html = html.replaceAll('<!--MASCOT-->', () => mascot).replace('/*FACE-CSS*/', () => faceCss).replace('/*FACE-JS*/', () => faceJs).replace('/*DATA*/null', () => JSON.stringify(data).replace(/</g, '\\u003c'));
for (const [k, v] of Object.entries(data.n)) html = html.replaceAll(`{{${k}}}`, String(v));
{ const gabarit = readFileSync(`${D}/template.html`, 'utf8'), reste = [...gabarit.matchAll(/\{\{([a-z]+)\}\}/g)].map((m) => m[1]).filter((k) => !(k in data.n)); if (reste.length) throw new Error(`repère du gabarit sans valeur : ${reste.join(', ')}`); }
// Pas de retour à la ligne entre un guillemet français et son mot.
html = html.replace(/« /g, '« ').replace(/ »/g, ' »');
// Une vraie page du site : en-tête, description, icône ; le gabarit fournit le titre, les styles et le corps.
const coupe = html.indexOf('</style>') + '</style>'.length;
const page = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="Le guide d'Odin : lui parler, ce qu'il fait seul et ce qu'il te demande toujours, ses ${apps.length} applis, la sécurité, et ce qui arrive.">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
${html.slice(0, coupe)}
</head>
<body>
${html.slice(coupe)}
</body>
</html>
`;
writeFileSync(join(ROOT, 'site', 'guide.html'), page);
// Le README : la partie « Fait, en cours, à venir ».
const readme = join(ROOT, 'README.md');
writeFileSync(readme, avecEtat(readFileSync(readme, 'utf8'), etat));
rmSync(home, { recursive: true, force: true });
console.log(`guide : ${apps.length} applis, ${LINKS.length} liens, ${data.n.actions} actions, ${(page.length / 1024).toFixed(0)} Ko → site/guide.html ; README : état (${data.n.fait} faits, ${data.n.encours} en cours)`);
