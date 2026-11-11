// Le guide d'Odin (une seule page, avec la mascotte) : les fiches des applis, leurs liens et les chiffres
// viennent du code, rien n'est recopié à la main. Lancer : npm run guide [nombre de tests au vert].
// Sortie : tools/guide/odin-guide.html (non suivie par git).
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { examples } from '../../src/valhalla/huginn.ts';
import { LINKS, USAGES } from '../../src/valhalla/links.ts';
import { allModules } from '../../src/valhalla/odin.ts';
const D = dirname(fileURLToPath(import.meta.url)), ROOT = join(D, '..', '..'), home = mkdtempSync(join(tmpdir(), 'odin-doc-'));
const mods = allModules({ paths: { home, workspace: home }, cfg: { venus: { url: '' }, voice: {} } } as never);
const name = (id: string) => mods.find((m) => m.id === id)?.name ?? id;
const apps = mods.map((m) => ({ id: m.id, n: m.name, f: m.family, w: m.what, d: m.does, m: m.modes ?? [], o: m.from, x: examples(m).slice(0, 6),
  a: m.actions.map((a) => ({ l: a.label, w: a.what, k: a.read ? 'l' : a.grave ? 'g' : a.undo ? 'u' : 'a' })),
  li: LINKS.filter((l) => l.to === m.id && l.from !== m.id).map((l) => ({ n: name(l.from), t: `quand ${l.when}, ${l.does}` })),
  lo: LINKS.filter((l) => l.from === m.id).map((l) => ({ n: l.to === m.id ? '' : name(l.to), t: `quand ${l.when}, ${l.does}` })) }));
const data = { apps, links: LINKS.map((l) => ({ a: name(l.from), b: name(l.to), k: l.kind, t: `quand ${l.when}, ${l.does}` })), usages: USAGES.map((u) => ({ n: u.need, c: u.chain.map(name), w: u.why })),
  n: { apps: apps.length, links: LINKS.length, actions: apps.reduce((s, a) => s + a.a.length, 0), tests: Number(process.argv[2] ?? 0), files: readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.test.ts')).length } };
const mascot = readFileSync(join(ROOT, 'tools', 'site', 'parts', 'mascot.svg'), 'utf8').trim();
let html = readFileSync(`${D}/template.html`, 'utf8');
// Le visage d'Odin est celui de l'appli : son code (humeurs, couleurs, sons) et ses règles d'affichage sont repris tels quels.
const ui = readFileSync(join(ROOT, 'src', 'web', 'ui.html'), 'utf8').split('\n');
const from = ui.findIndex((l) => l.startsWith('.odin{display:inline-block')), to = ui.findIndex((l) => l.startsWith('@media (prefers-reduced-motion:reduce){.odin .talk'));
if (from < 0 || to < from) throw new Error('règles de la mascotte introuvables dans src/web/ui.html');
const faceCss = ui.slice(from, to + 1).join('\n'), faceJs = readFileSync(join(ROOT, 'src', 'web', 'face.js'), 'utf8');
if (/<\/script/i.test(faceJs) || /<\/style/i.test(faceCss)) throw new Error('le code de la mascotte ne peut pas être inséré tel quel');
for (const mark of ['<!--MASCOT-->', '/*FACE-CSS*/', '/*FACE-JS*/', '/*DATA*/null']) if (!html.includes(mark)) throw new Error(`repère absent du gabarit : ${mark}`);
html = html.replaceAll('<!--MASCOT-->', () => mascot).replace('/*FACE-CSS*/', () => faceCss).replace('/*FACE-JS*/', () => faceJs).replace('/*DATA*/null', () => JSON.stringify(data).replace(/</g, '\\u003c'));
for (const [k, v] of Object.entries(data.n)) html = html.replaceAll(`{{${k}}}`, String(v));
// Pas de retour à la ligne entre un guillemet français et son mot.
html = html.replace(/« /g, '«\u00a0').replace(/ »/g, '\u00a0»');
writeFileSync(`${D}/odin-guide.html`, html);
rmSync(home, { recursive: true, force: true });
console.log(`${apps.length} applis, ${LINKS.length} liens, ${data.n.actions} actions, ${(html.length / 1024).toFixed(0)} Ko`, apps.map((a) => a.f).filter((f, i, l) => l.indexOf(f) === i).join(', '));
