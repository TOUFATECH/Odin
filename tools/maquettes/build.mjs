// Fabrique les maquettes d'Odin : une page par appli, plus l'interface d'Odin et un sommaire.
//   node tools/maquettes/build.mjs
// Tout est relu dans le dépôt à chaque passage : la liste des applis (src/valhalla), leurs noms (names.ts),
// leurs icônes (app-icons.js) et les thèmes (themes.js). Une nouvelle appli ou un nouveau thème apparaît donc
// tout seul dans les maquettes, sans rien changer ici.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPLIS, reglages } from './applis.mjs';
import { NAV, vues } from './odin.mjs';

const ici = dirname(fileURLToPath(import.meta.url)), racine = join(ici, '..', '..'), sortie = join(racine, 'docs', 'maquettes');
const lire = (p) => readFileSync(join(racine, p), 'utf8');
const txt = (s) => s.replace(/\\'/g, "'");

// ---------------- Thèmes ----------------
const srcT = lire('src/web/themes.js');
const THEMES = JSON.parse(srcT.match(/const THEMES = (\{.*\});\n\s*const ORDER/s)[1]);
const EVENTS = new Function(`return ${srcT.match(/const EVENT_THEMES = (\{[\s\S]*?\n {2}\});/)[1]}`)();
delete THEMES.valhalla;
// « Valhalla » : le thème d'origine, avec ses trois réglages (couleurs de src/web/ui.html).
const CLASSIQUE = {
  valhalla: { name: 'Valhalla sombre', dark: true, sky: ['#101A24', '#101A24'], panel: '#172533', ink: '#E6ECEF', accent: '#E3AC3F', mascot: '#E3AC3F', decor: '', fixe: { '--panel2': '#13202C', '--line': '#263849', '--muted': '#A9B8C4', '--dim': '#8FA0AE', '--accent-2': '#F2C366' } },
  'valhalla-clair': { name: 'Valhalla clair', dark: false, sky: ['#EEF2F1', '#EEF2F1'], panel: '#FFFFFF', ink: '#15212B', accent: '#A9700F', mascot: '#C98A14', decor: '', fixe: { '--panel2': '#F6F8F7', '--line': '#D7E0DF', '--muted': '#4C5B67', '--dim': '#5F6E7A', '--accent-2': '#C98A14' } },
  'valhalla-epure': { name: 'Valhalla épuré', dark: false, sky: ['#FFFFFF', '#FFFFFF'], panel: '#FFFFFF', ink: '#0F1114', accent: '#1F4FD1', mascot: '#1F4FD1', decor: '', fixe: { '--panel2': '#FBFBFC', '--line': '#E6E7EA', '--muted': '#4A505A', '--dim': '#5F6570', '--accent-2': '#163A9C' } },
};
const themes = { ...CLASSIQUE, ...THEMES, ...EVENTS }, ordre = Object.keys(themes);

// ---------------- Applis ----------------
const NAMES = Object.fromEntries([...lire('src/valhalla/names.ts').split('OLD_NAMES')[0].matchAll(/"(\w+)": "([^"]+)"/g)].map((m) => [m[1], m[2]]));
const ICONS = JSON.parse(lire('src/web/app-icons.js').match(/const ICONS = (\{.*?\});\n/s)[1]);
const fiches = {};
const liste = (blk, cle) => [...((blk.match(new RegExp(`${cle}: \\[([^\\]]*)\\]`)) || [])[1] || '').matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => txt(x[1]));
for (const f of [...readdirSync(join(racine, 'src/valhalla/modules')).map((x) => `src/valhalla/modules/${x}`), 'src/valhalla/odin.ts']) {
  const s = lire(f);
  for (const m of s.matchAll(/id: '(\w+)', name: '([^']+)',\s*family: '([^']+)',/g)) {
    const blk = s.slice(m.index, m.index + 6000);
    fiches[m[1]] = { id: m[1], name: NAMES[m[1]] || m[2], family: m[3], what: txt((blk.match(/what: '((?:[^'\\]|\\.)*)'/) || [])[1] || ''), from: liste(blk, 'from'), modes: liste(blk, 'modes'), does: liste(blk, 'does') };
  }
}
// Le cœur d'Odin : des applis sans fiche de module (leur code est dans src/<nom>).
const COEUR = {
  huginn: ['Données', "La pensée : Odin comprend une demande sans modèle d'IA et choisit l'appli et l'action.", []],
  muninn: ['Données', "La mémoire d'Odin : souvenirs, fils de discussion et recherche par le sens.", []],
  yggdrasil: ['Données', "L'arbre des compétences : ce qu'Odin sait faire, au format ouvert des compétences.", ['agentskills.io']],
  hlidskjalf: ['Machines', "L'inventaire du réseau : chaque appareil identifié, avec ses ports et ses partages.", ['Nmap', 'Fing']],
  fjalar: ['Données', "Les logiciels : un dossier d'installateurs gardé à jour depuis les sites officiels, aux jours que tu programmes, analysé par l'antivirus.", ['Ketarin', 'UniGetUI', 'Chocolatey']],
  eitri: ['Données', 'Les ISO (Windows, Linux, serveurs, dépannage) rangées et gardées à jour depuis les sites officiels.', ['ISOMan', 'netboot.xyz', 'Ventoy']],
  bifrost: ['Accès', 'Les canaux d\'Odin : Telegram, WhatsApp, mail, et le briefing du matin.', []],
};
for (const [id, [family, what, from]] of Object.entries(COEUR)) if (!fiches[id]) fiches[id] = { id, name: NAMES[id] || id, family, what, from, modes: [], does: [] };
// Pas de maquette : les blocs de Vénus (montrés dans Vénus) et les écrans qui ont déjà leurs thèmes.
const DANS_VENUS = ['sessrumnir', 'bygul', 'gersemi', 'hildisvini', 'sjofn', 'folkvangr'], DEJA_THEMES = ['gladsheim', 'midgard'];
const ids = [...new Set([...Object.keys(NAMES), ...Object.keys(fiches)])].filter((id) => !DANS_VENUS.includes(id) && !DEJA_THEMES.includes(id) && fiches[id]);
const sansFiche = Object.keys(NAMES).filter((id) => !fiches[id] && !DANS_VENUS.includes(id));

const court = (s) => { const p = s.split(/(?<=\.)\s/)[0]; return (p.length > 30 ? p : s).slice(0, 180).replace(/[\s:,;]+$/, ''); };
/** La maquette d'une appli sans contenu écrit : faite à partir de sa fiche. */
function parDefaut(a) {
  const t = { 'Vue d\'ensemble': [['text:12', a.name, a.what || a.name], ['list:8', 'Ce que fait l\'appli', (a.does.length ? a.does : [a.what]).slice(0, 6).map((d) => [d.slice(0, 90)])], ['actions:4', 'Actions', ['Ouvrir', 'Vérifier', 'Journal']]] };
  for (const m of a.modes.slice(0, 2)) t[m.split(' · ')[0]] = [['text:12', m, `${m} : cette partie de l'appli a sa propre page.`], ['list:12', 'Éléments', [['Premier élément', 'exemple'], ['Deuxième élément', 'exemple']]]];
  return { p: 'Ouvrir', k: [], t };
}
function vueAppli(id) {
  const a = fiches[id], s = APPLIS[id] || parDefaut(a), tabs = { ...s.t };
  if (Object.keys(tabs).length < 4 && !tabs['Réglages']) tabs['Réglages'] = reglages(a);
  return { id, app: true, nav: 'apps', name: a.name, family: a.family, what: court(a.what), from: a.from.slice(0, 6), primary: s.p, kpis: s.k, tabs };
}

// ---------------- Pages ----------------
const css = readFileSync(join(ici, 'socle.css'), 'utf8'), js = readFileSync(join(ici, 'socle.js'), 'utf8');
const liens = existsSync(join(ici, 'liens.json')) ? JSON.parse(readFileSync(join(ici, 'liens.json'), 'utf8')) : {};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function page(titre, data) {
  const json = JSON.stringify({ titre, themes, ordre, nav: NAV, ...data }).replace(/<\//g, '<\\/');
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titre)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
${css}</style>
</head>
<body>
<header class="banc" id="banc"></header>
<div class="rapport" id="rapport" hidden></div>
<main id="scene" class="scene"></main>
<script>window.MAQ = ${json};</script>
<script>
${js}</script>
</body>
</html>
`;
}
mkdirSync(sortie, { recursive: true });
const seule = process.argv[2];
for (const id of ids) {
  if (seule && seule !== id) continue;
  writeFileSync(join(sortie, `${id}.html`), page(`Odin UX · ${fiches[id].name}`, { icons: { [id]: ICONS[id] }, views: [vueAppli(id)] }));
}
// L'interface d'Odin : sa grille « Applis » renvoie vers la maquette de chaque appli (liens.json, rempli après publication).
const grille = ids.map((id) => [id, fiches[id].name, liens[id] || '', fiches[id].family]).sort((a, b) => a[1].localeCompare(b[1], 'fr'));
if (!seule || seule === 'odin') writeFileSync(join(sortie, 'odin.html'), page('Odin UX · Interface d\'Odin', { icons: Object.fromEntries(ids.map((id) => [id, ICONS[id]])), views: vues(grille) }));

// ---------------- Rapport des thèmes (contraste du texte, avant correction) ----------------
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, k) => { const x = hex(a), y = hex(b); return `#${x.map((v, i) => Math.round(v * (1 - k) + y[i] * k).toString(16).padStart(2, '0')).join('')}`; };
const lum = (h) => { const [r, g, b] = hex(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ct = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const lignes = [];
for (const id of ordre) {
  const t = themes[id], bg = mix(t.sky[0], t.sky[1], 0.5), p = t.panel, p2 = (t.fixe && t.fixe['--panel2']) || mix(p, bg, t.dark ? 0.35 : 0.45), f = ct(t.ink, p) < ct(t.ink, p2) ? p : p2;
  const c = { 'texte secondaire': (t.fixe && t.fixe['--muted']) || mix(t.ink, p, 0.28), 'texte discret': (t.fixe && t.fixe['--dim']) || mix(t.ink, p, 0.36), 'accent en texte': t.accent, vert: t.dark ? '#6CCFB8' : '#1D7F68', ambre: t.dark ? '#F0B860' : '#8F6200', rouge: t.dark ? '#EE8A70' : '#B23F2A' };
  const ko = Object.entries(c).filter(([, v]) => ct(v, f) < 4.5).map(([k, v]) => `${k} ${ct(v, f).toFixed(1)}`);
  lignes.push([t.name, ko, ct(mix(p, t.ink, 0.24), p)]);
}
const aRevoir = lignes.filter((l) => l[1].length);
writeFileSync(join(sortie, 'rapport-themes.md'), `# Lisibilité des thèmes d'Odin\n\nContraste du texte sur les panneaux (il faut 4,5 pour du texte, 3 pour un bord de champ).\nLes maquettes corrigent ces couleurs toutes seules ; ce tableau dit ce qu'il faudrait reporter dans \`src/web/themes.js\`.\n\n${ordre.length} thèmes vérifiés, ${aRevoir.length} ont un texte trop pâle. Dans tous les thèmes, le bord des champs est trop discret (il faut 3).\n\n| Thème | Texte trop pâle aujourd'hui | Bord des champs |\n|---|---|---|\n${lignes.map(([n, k, b]) => `| ${n} | ${k.length ? k.join(', ') : 'rien'} | ${b.toFixed(1)} |`).join('\n')}\n`);

// ---------------- Sommaire ----------------
const fam = ['Données', 'Machines', 'Sécurité', 'Accès', 'Maison'];
writeFileSync(join(sortie, 'sommaire.json'), JSON.stringify({ applis: ids.map((id) => ({ id, nom: fiches[id].name, famille: fiches[id].family, ecrit: Boolean(APPLIS[id]) })), themes: ordre.length, aRevoir: aRevoir.map((l) => l[0]) }, null, 1));
console.log(`${ids.length} applis (${ids.filter((id) => !APPLIS[id]).length} faites à partir de leur fiche : ${ids.filter((id) => !APPLIS[id]).join(', ') || 'aucune'}), ${ordre.length} thèmes, ${aRevoir.length} thèmes au texte trop pâle.`);
if (sansFiche.length) console.log(`Noms sans fiche d'appli : ${sansFiche.join(', ')}`);
console.log(fam.map((f) => `${f} ${ids.filter((id) => fiches[id].family === f).length}`).join(' · '));
