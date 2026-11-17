// La page des plugins des compétences (src/web/pages/plugins.js) : sa logique pure, chargée par vm dans un faux
// navigateur, et deux vérifications statiques (le fichier de la page, puis la vue « Compétences » de ui.html).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fauxNavigateur } from './archytas-fixtures.ts';

const src = readFileSync(new URL('../src/web/pages/plugins.js', import.meta.url), 'utf8');
const graphe3d = readFileSync(new URL('../src/web/pages/archytas-graphe.js', import.meta.url), 'utf8');

interface Logique {
  placer(n: unknown, g?: string[]): { x: number; y: number; z: number };
  couleurDe(s: string): string;
  formeDe(s: string): string;
  tronquer(t: string, n?: number): string;
  etatTexte(e: string): string;
  modeInitial(o: Record<string, unknown>): '2d' | '3d';
  listeAccessible(e: unknown): Array<{ id: string; libelle: string }>;
  provenanceTexte(p: string, n?: number): string;
}
/** Charge la page (après le graphe 3D des scripts, comme dans l'interface où les pages arrivent par ordre alphabétique). */
function charger(fois = 1) {
  const nav = fauxNavigateur();
  const ctx = vm.createContext(nav.sandbox);
  vm.runInContext(graphe3d, ctx);
  for (let i = 0; i < fois; i++) vm.runInContext(src, ctx);
  const w = nav.window as unknown as { OdinPlugins?: { logique: Logique }; OdinGraphe3D: { logique: { empreinte(t: string): number } } };
  assert.ok(w.OdinPlugins, 'window.OdinPlugins est posé');
  return { L: w.OdinPlugins.logique, G: w.OdinGraphe3D.logique };
}

const etatExemple = {
  noeuds: [
    { id: 'brain', sorte: 'brain', nom: 'Brain', sous: '0 note(s)', seul: true },
    { id: 'memoire', sorte: 'memoire', nom: 'Mémoire', sous: '1 compétence(s) utilisée(s)', seul: false },
    { id: 'soul', sorte: 'soul', nom: 'Soul', sous: 'état de Soul inconnu', seul: true },
    { id: 'plugin:dev', sorte: 'plugin', nom: 'Développement', sous: 'outils', seul: false },
    { id: 'skill:revue-code', sorte: 'skill', nom: 'revue-code', sous: 'Relire un changement', seul: false, plugins: ['dev'] },
    { id: 'skill:seule', sorte: 'skill', nom: 'seule', sous: 'Rien ne la relie', seul: true, plugins: [] },
    { id: 'mcp:Depot', sorte: 'mcp', nom: 'Depot', sous: 'à relier · 0 outil(s)', seul: true, etat: 'a-relier', plugins: [] },
  ],
  liens: [{ a: 'plugin:dev', b: 'skill:revue-code', provenances: ['declare'], titre: '' }],
};

test('23. la page se charge deux fois sans erreur et expose ses 8 fonctions', () => {
  const { L } = charger(2);
  for (const f of ['placer', 'couleurDe', 'formeDe', 'tronquer', 'etatTexte', 'modeInitial', 'listeAccessible', 'provenanceTexte']) assert.equal(typeof (L as unknown as Record<string, unknown>)[f], 'function', f);
});

test('24. placer est déterministe, les hauteurs sont celles de chaque sorte, une compétence rangée reste près de son plugin', () => {
  const { L, G } = charger();
  const n = { id: 'skill:revue-code', sorte: 'skill', nom: 'revue-code', plugins: ['dev'] };
  assert.deepEqual(L.placer(n), L.placer({ ...n }));
  const h: Record<string, number> = { brain: 0.85, memoire: 0.85, soul: 0.85, plugin: 0.35, skill: -0.15, mcp: -0.7 };
  for (const [sorte, y] of Object.entries(h)) assert.equal(L.placer({ id: `${sorte}:x`, sorte, nom: 'x' }).y, y, sorte);
  // Points fixes : rayon 0.35, angles 90°, 210°, 330°.
  const b = L.placer({ id: 'brain', sorte: 'brain', nom: 'Brain' });
  assert.ok(Math.abs(b.x) < 1e-9 && Math.abs(b.z - 0.35) < 1e-9, 'Brain à 90°');
  // Plugin : r = 0.55, angle = empreinte(id) × 2π.
  const ap = G.empreinte('dev') * Math.PI * 2;
  const p = L.placer({ id: 'plugin:dev', sorte: 'plugin', nom: 'Développement' });
  assert.ok(Math.abs(p.x - 0.55 * Math.cos(ap)) < 1e-9 && Math.abs(p.z - 0.55 * Math.sin(ap)) < 1e-9);
  for (const sorte of ['skill', 'mcp']) {
    for (const nom of ['a', 'revue-code', 'GitHub', 'un-nom-assez-long']) {
      const q = L.placer({ id: `${sorte}:${nom}`, sorte, nom, plugins: ['zz', 'dev'] });
      let d = Math.atan2(q.z, q.x) - ap; d = Math.atan2(Math.sin(d), Math.cos(d));
      assert.ok(Math.abs(d) < 0.31, `${sorte} ${nom} : écart ${d}`);
    }
  }
  // Seule : angle tiré de son nom, rayon 0.9.
  const s = L.placer({ id: 'skill:seule', sorte: 'skill', nom: 'seule' });
  assert.ok(Math.abs(Math.hypot(s.x, s.z) - 0.9) < 1e-9);
});

test('25. couleurs et formes : les 6 sortes, des noms de variables et jamais un code hexadécimal', () => {
  const { L } = charger();
  const formes = new Set<string>();
  for (const s of ['brain', 'memoire', 'soul', 'plugin', 'skill', 'mcp']) {
    const c = L.couleurDe(s);
    assert.match(c, /^--[a-z]+$/, s); assert.doesNotMatch(c, /#/);
    formes.add(L.formeDe(s));
  }
  assert.deepEqual([L.couleurDe('skill'), L.couleurDe('mcp'), L.couleurDe('plugin'), L.couleurDe('brain')], ['--good', '--warn', '--accent', '--ink']);
  assert.deepEqual([...formes].sort(), ['carre', 'losange', 'rond', 'triangle']);
});

test('26. tronquer coupe avec « … »', () => {
  const { L } = charger();
  const t = L.tronquer('a'.repeat(30), 22);
  assert.equal(Array.from(t).length, 22); assert.ok(t.endsWith('…'));
  assert.equal(L.tronquer('court', 22), 'court');
  // L'état est celui du dernier contact, jamais présenté comme vérifié à l'instant.
  assert.equal(L.etatTexte('relie'), 'relié au dernier contact'); assert.equal(L.etatTexte('panne'), 'en panne au dernier contact'); assert.equal(L.etatTexte('a-relier'), 'à relier');
  assert.equal(L.provenanceTexte('declare'), 'relié par toi'); assert.equal(L.provenanceTexte('constate', 3), 'vus ensemble dans 3 tour(s) observé(s)');
});

test('26b. A1 : points répartis et écartés, caméra inclinée, noms qui ne se chevauchent pas ; trois états d\'un outil', () => {
  const { L } = charger() as unknown as { L: Logique & Record<string, (...a: never[]) => unknown> };
  const Lx = L as unknown as {
    rangs(n: unknown[]): Map<string, { i: number; n: number }>;
    placer(n: unknown, g?: string[], r?: { i: number; n: number }): { x: number; y: number; z: number };
    ecarter(p: Array<{ x: number; y: number; z: number }>, d?: number): Array<{ x: number; y: number; z: number }>;
    camera(p: { x: number; y: number; z: number }, rot: number): { x: number; y: number; z: number };
    placerEtiquettes(p: Array<{ sx: number; sy: number; taille: number }>, w: number[], larg: number, haut: number): Array<{ x: number; y: number; align: string }>;
    accesTexte(o: unknown): string;
    horsPlugin(e: unknown): Array<{ id: string }>;
  };
  // Quatre connecteurs seuls : à intervalle régulier (un quart de tour).
  const mcps = ['Agenda', 'Depot', 'Seul', 'Service'].map((nom) => ({ id: `mcp:${nom}`, sorte: 'mcp', nom, plugins: [] }));
  const rg = Lx.rangs(mcps);
  const angles = mcps.map((n) => { const p = Lx.placer(n, undefined, rg.get(n.id)); return Math.atan2(p.z, p.x); }).sort((a, b) => a - b);
  for (let i = 1; i < angles.length; i++) assert.ok(Math.abs(angles[i] - angles[i - 1] - Math.PI / 2) < 1e-9, `écart ${angles[i] - angles[i - 1]}`);
  // Deux points presque confondus sur un anneau : écartés d'au moins 0,2.
  const e = Lx.ecarter([{ x: 0.9, y: -0.15, z: 0 }, { x: 0.9, y: -0.15, z: 0.01 }, { x: 0, y: 0.35, z: 0.55 }]);
  assert.ok(Math.hypot(e[0].x - e[1].x, e[0].z - e[1].z) >= 0.19, 'écartés');
  assert.equal(e[2].z, 0.55, 'un point seul sur son anneau ne bouge pas');
  // Caméra un peu au-dessus : un point de devant est plus bas qu'un point du fond, à même hauteur.
  assert.ok(Lx.camera({ x: 0, y: 0, z: 0.9 }, 0).y < Lx.camera({ x: 0, y: 0, z: -0.9 }, 0).y);
  // Deux points proches : le second nom va ailleurs que dessous (au-dessus ou sur un côté), sans chevaucher le premier.
  const pl = Lx.placerEtiquettes([{ sx: 100, sy: 100, taille: 6 }, { sx: 108, sy: 104, taille: 6 }], [80, 80], 390, 420);
  assert.equal(pl[0].y > 100, true, 'le premier est dessous');
  const rect = (q: { x: number; y: number; align: string }) => { const x1 = q.align === 'center' ? q.x - 40 : q.align === 'left' ? q.x : q.x - 80; return { x1, x2: x1 + 80, y1: q.y, y2: q.y + 14 }; };
  const a = rect(pl[0]), b = rect(pl[1]);
  assert.ok(Math.min(a.x2, b.x2) <= Math.max(a.x1, b.x1) || Math.min(a.y2, b.y2) <= Math.max(a.y1, b.y1), `chevauchement : ${JSON.stringify(pl)}`);
  // M2 : trois états, « non déclaré » traité comme pouvant modifier.
  assert.equal(Lx.accesTexte({ acces: 'lecture' }), 'lecture (déclarée par le serveur)');
  assert.equal(Lx.accesTexte({ acces: 'modification' }), 'peut modifier (déclaré par le serveur)');
  assert.equal(Lx.accesTexte({ acces: 'non-declare' }), 'non déclaré : traité comme pouvant modifier');
  // P3 : « Hors plugin » liste aussi un point relié hors plugin (et la page dit lequel est sans lien).
  const hp = Lx.horsPlugin({ noeuds: [{ id: 'skill:a', sorte: 'skill', seul: false, plugins: [] }, { id: 'skill:b', sorte: 'skill', seul: true }, { id: 'skill:c', sorte: 'skill', seul: false, plugins: ['p'] }] });
  assert.deepEqual(hp.map((n) => n.id), ['skill:a', 'skill:b']);
});

test('27. le mode initial suit le repli honnête, puis le choix mémorisé', () => {
  const { L } = charger();
  assert.equal(L.modeInitial({ reducedMotion: true }), '2d');
  assert.equal(L.modeInitial({ webgl: true, reducedMotion: false }), '3d');
  assert.equal(L.modeInitial({ choixMemorise: '2d', webgl: true }), '2d');
  assert.equal(L.modeInitial({ webgl: false }), '2d');
  assert.equal(L.modeInitial({ webgl: true, premiereImageMs: 50 }), '2d');
});

test('28. la liste accessible a un bouton par point, points seuls compris', () => {
  const { L } = charger();
  const l = L.listeAccessible(etatExemple);
  assert.equal(l.length, etatExemple.noeuds.length);
  assert.deepEqual(l.map((x) => x.id), etatExemple.noeuds.map((n) => n.id));
  assert.ok(l.find((x) => x.id === 'skill:seule')!.libelle.includes('seule'));
  assert.equal(l.find((x) => x.id === 'mcp:Depot')!.libelle, 'connecteur MCP Depot : à relier · 0 outil(s)');
});

test('29. le fichier de la page : ni innerHTML, ni onclick=, ni script chargé d\'ailleurs, ni confirm/prompt du navigateur', () => {
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(src, /onclick=/);
  assert.doesNotMatch(src, /(src|href)\s*[:=]\s*['"`]https?:/i, 'aucune adresse extérieure chargée');
  assert.doesNotMatch(src, /\bimport\s*\(|<script/i);
  assert.doesNotMatch(src, /(^|[^.\w])(confirm|prompt|alert)\s*\(/m, 'seulement OdinDialog');
  assert.match(src, /if \(window\.OdinPlugins\) return;/);
  assert.match(src, /id: 'pl-css'/);
});

test('30. ui.html : la vue « Compétences » est seulement entourée par les onglets, cachés par défaut', () => {
  const ui = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');
  const fois = (id: string) => ui.split(`id="${id}"`).length - 1;
  for (const id of ['drafts', 'skills', 'scripts', 'sk-import', 'sk-all', 'skTabs', 'skPanComp', 'skPanMcp', 'skPanPlug', 'skTab-comp', 'skTab-mcp', 'skTab-plug']) assert.equal(fois(id), 1, id);
  assert.match(ui, /<div class="sk-tabs" id="skTabs" role="tablist"[^>]* hidden>/);
  const vue = ui.slice(ui.indexOf('<section class="view" id="v-skills"'), ui.indexOf('</section>', ui.indexOf('id="v-skills"')));
  for (const id of ['skTabs', 'skPanComp', 'skPanMcp', 'skPanPlug', 'drafts', 'skills', 'scripts']) assert.ok(vue.includes(`id="${id}"`), `${id} est dans la vue`);
  // Le contenu actuel est dans le premier panneau ; les deux autres sont vides et cachés.
  const comp = vue.slice(vue.indexOf('id="skPanComp"'), vue.indexOf('id="skPanMcp"'));
  for (const id of ['drafts', 'skills', 'scripts']) assert.ok(comp.includes(`id="${id}"`), `${id} est dans le panneau Compétences`);
  assert.match(vue, /<div id="skPanMcp" role="tabpanel" aria-labelledby="skTab-mcp" hidden><\/div>/);
  assert.match(vue, /<div id="skPanPlug" role="tabpanel" aria-labelledby="skTab-plug" hidden><\/div>/);
});

// ---------------- La page montée dans le faux navigateur (onglets, tableau, branchement confirmé, plugins)
type El = { attributes: Record<string, string>; childNodes: El[]; textContent: string; localName: string; value: string; checked?: boolean; append(...k: unknown[]): void; getAttribute(k: string): string | null; setAttribute(k: string, v: string): void; click(): void; dispatch(t: string, e?: unknown): void; querySelectorAll(s: string): El[] };
const etatComplet = {
  resume: { competences: 2, brouillons: 1, connecteurs: 1, plugins: 1, seuls: 1, mcpDisponible: true, abime: false },
  noeuds: [...etatExemple.noeuds.slice(0, 6), { id: 'mcp:Depot', sorte: 'mcp', nom: 'Depot', sous: 'relié · 2 outil(s)', seul: false, etat: 'relie', plugins: ['dev'] }],
  liens: [{ a: 'plugin:dev', b: 'skill:revue-code', provenances: ['declare'], titre: '' }, { a: 'plugin:dev', b: 'mcp:Depot', provenances: ['declare'], titre: '' }],
  connecteurs: [{ nom: 'Depot', sorte: 'http', adresse: 'https://depot.example.org/mcp', etat: 'relie', jeton: true, outils: [{ nom: 'lire', outilOdin: 'mcp_depot_lire', description: 'Lit', peutModifier: false }, { nom: 'effacer', outilOdin: 'mcp_depot_effacer', description: 'Efface', peutModifier: true }] }],
  plugins: [{ id: 'dev', nom: 'Développement', description: 'outils', skills: [{ nom: 'revue-code', present: true }, { nom: 'partie', present: false }], mcp: [{ nom: 'Depot', present: true }] }],
  liensDeclares: [],
  soul: { etat: 'inconnu', extraitsCompetences: 0 },
};
async function monterPage(reponses: (chemin: string, corps: Record<string, unknown> | null) => { status: number; body: unknown }) {
  const nav = fauxNavigateur();
  const doc = nav.document as unknown as { body: El; getElementById(id: string): El | null };
  const trouver = (n: El, id: string): El | null => { for (const c of n.childNodes || []) { if (c.attributes && c.attributes.id === id) return c; const r = c.childNodes ? trouver(c, id) : null; if (r) return r; } return null; };
  doc.getElementById = (id) => trouver(doc.body, id);
  // Comme le vrai navigateur, append/replaceChildren écrivent « null » quand on leur passe null (le faux l'ignorait).
  const proto = Object.getPrototypeOf(Object.getPrototypeOf(nav.make('div'))) as { append(...k: unknown[]): void; replaceChildren(...k: unknown[]): void; childNodes?: unknown };
  const ajouter = proto.append;
  proto.append = function (this: unknown, ...k: unknown[]) { ajouter.apply(this, k.map((x) => (x === null ? 'null' : x))); };
  proto.replaceChildren = function (this: { childNodes: unknown[] }, ...k: unknown[]) { this.childNodes = []; proto.append.apply(this, k); };
  const mk = (tag: string, attrs: Record<string, string>) => { const e = nav.make(tag) as unknown as El; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const barre = mk('div', { id: 'skTabs', role: 'tablist', hidden: '' });
  barre.append(mk('button', { id: 'skTab-comp', role: 'tab', 'aria-selected': 'true' }), mk('button', { id: 'skTab-mcp', role: 'tab', 'aria-selected': 'false', tabindex: '-1' }), mk('button', { id: 'skTab-plug', role: 'tab', 'aria-selected': 'false', tabindex: '-1' }));
  doc.body.append(barre, mk('div', { id: 'skPanComp' }), mk('div', { id: 'skPanMcp', hidden: '' }), mk('div', { id: 'skPanPlug', hidden: '' }));
  const envois: Array<{ chemin: string; corps: Record<string, unknown> | null; headers: Record<string, string> }> = [];
  const confirmations: string[] = [];
  nav.brancherServeur(async (u: string, i?: unknown) => {
    const init = (i || {}) as { method?: string; body?: string; headers?: Record<string, string> };
    const corps = init.body ? JSON.parse(init.body) as Record<string, unknown> : null;
    envois.push({ chemin: u, corps, headers: init.headers || {} });
    const r = reponses(u, corps);
    return { status: r.status, async json() { return r.body; } };
  });
  (nav.window as Record<string, unknown>).OdinDialog = { confirm: async (t: string) => { confirmations.push(t); return true; }, alert: async () => undefined };
  const ctx = vm.createContext(nav.sandbox);
  vm.runInContext(graphe3d, ctx); vm.runInContext(src, ctx);
  const attendre = async () => { for (let k = 0; k < 8; k++) await new Promise((r) => setImmediate(r)); };
  return { nav, doc, envois, confirmations, attendre, $: (id: string) => doc.getElementById(id)! };
}

test('31. la barre d\'onglets apparaît, l\'onglet « Connecteurs MCP » charge l\'état et montre le connecteur', async () => {
  const p = await monterPage((c) => (c === '/api/plugins/etat' ? { status: 200, body: etatComplet } : { status: 404, body: {} }));
  assert.equal(p.$('skTabs').getAttribute('hidden'), null, 'la barre est montrée');
  p.$('skTab-mcp').click(); await p.attendre();
  assert.equal(p.$('skTab-mcp').getAttribute('aria-selected'), 'true');
  assert.equal(p.$('skTab-mcp').getAttribute('tabindex'), '0');
  assert.equal(p.$('skTab-comp').getAttribute('tabindex'), '-1');
  assert.equal(p.$('skPanMcp').getAttribute('hidden'), null);
  assert.equal(p.$('skPanComp').getAttribute('hidden'), '');
  const t = p.$('skPanMcp').textContent;
  for (const attendu of ['Depot', 'https://depot.example.org/mcp', 'relié', '2 outil(s)', 'au coffre', 'Brancher un connecteur', 'jamais un ordre']) assert.ok(t.includes(attendu), attendu);
  // Clavier : Fin va au dernier onglet.
  let evite = false;
  p.$('skTabs').dispatch('keydown', { key: 'End', preventDefault() { evite = true; } }); await p.attendre();
  assert.ok(evite); assert.equal(p.$('skTab-plug').getAttribute('aria-selected'), 'true');
});

test('32. brancher un connecteur : 409, confirmation du propriétaire, puis envoi avec confirme:true ; le jeton est vidé', async () => {
  const p = await monterPage((c, b) => {
    if (c === '/api/plugins/etat') return { status: 200, body: etatComplet };
    if (c === '/api/plugins/connecteur/ajouter') return b && b.confirme === true ? { status: 200, body: { ok: true, texte: 'Connecteur branché.' } } : { status: 409, body: { ok: false, confirmer: 'Confirmer : brancher https://autre.example.org ?' } };
    return { status: 404, body: {} };
  });
  p.$('skTab-mcp').click(); await p.attendre();
  p.$('plcNom').value = 'Autre'; p.$('plcSrc').value = 'https://autre.example.org/mcp'; p.$('plcSrc').dispatch('input'); p.$('plcJeton').value = 'jeton-secret-123456';
  const form = p.$('skPanMcp').querySelectorAll('form')[0];
  form.dispatch('submit', { preventDefault() {} }); await p.attendre();
  const ajouts = p.envois.filter((e) => e.chemin === '/api/plugins/connecteur/ajouter');
  assert.equal(ajouts.length, 2);
  assert.equal(ajouts[0].corps!.confirme, undefined); assert.equal(ajouts[1].corps!.confirme, true);
  for (const e of ajouts) { assert.equal(e.headers['x-odin'], '1'); assert.equal(e.corps!.jeton, 'jeton-secret-123456'); }
  assert.deepEqual(p.confirmations, ['Confirmer : brancher https://autre.example.org ?']);
  assert.equal(p.$('plcJeton').value, '', 'le champ du jeton est vidé');
  assert.ok(!p.$('skPanMcp').textContent.includes('jeton-secret-123456'), 'le jeton n\'est jamais affiché');
});

test('33. sans les applis, l\'onglet le dit ; l\'onglet « Plugins » montre le résumé, les cartes et les points seuls', async () => {
  const sans = await monterPage(() => ({ status: 200, body: { ...etatComplet, resume: { ...etatComplet.resume, mcpDisponible: false }, connecteurs: [] } }));
  sans.$('skTab-mcp').click(); await sans.attendre();
  assert.ok(sans.$('skPanMcp').textContent.includes('Les applis d\'Odin ne sont pas démarrées'));
  const p = await monterPage(() => ({ status: 200, body: etatComplet }));
  p.$('skTab-plug').click(); await p.attendre();
  const t = p.$('skPanPlug').textContent;
  assert.ok(t.includes('1 plugin(s) · 2 compétence(s) · 1 connecteur(s) · 1 point(s) sans aucun lien · 1 brouillon(s) non montrés'), t);
  for (const attendu of ['Montrer Brain, Mémoire et Soul', 'Développement', 'Compétences : revue-code', 'partie', '(absente)', 'Hors plugin', 'seule', 'sans aucun lien', 'Nouveau plugin']) assert.ok(t.includes(attendu), attendu);
  assert.ok(p.$('plGraphe'), 'la boîte du graphe est là');
  assert.ok(!t.includes('null') && !p.$('skPanMcp').textContent.includes('null'), 'aucun « null » écrit dans la page');
  assert.equal(p.$('plFixes').checked, true, 'Brain, Mémoire et Soul montrés par défaut');
});

test('34. rien à dessiner : seuls les trois points fixes donnent le message prévu', async () => {
  const vide = { ...etatComplet, resume: { ...etatComplet.resume, competences: 0, connecteurs: 0, plugins: 0, seuls: 0 }, noeuds: etatComplet.noeuds.slice(0, 3), liens: [], connecteurs: [], plugins: [] };
  const p = await monterPage(() => ({ status: 200, body: vide }));
  p.$('skTab-plug').click(); await p.attendre();
  assert.ok(p.$('plGraphe').textContent.startsWith('Rien à montrer : aucune compétence active ni connecteur.'));
  assert.ok(p.$('skPanPlug').textContent.includes('Aucun plugin. Un plugin réunit des compétences et des connecteurs'));
});

test('35. « Graphe | Graphe 3D » à côté du graphe des plugins (2D d\'abord, puis 3D), avec ou sans le graphe 3D commun', async () => {
  const p = await monterPage(() => ({ status: 200, body: etatComplet }));
  p.$('skTab-plug').click(); await p.attendre();
  const seg = p.$('skPanPlug').querySelectorAll('button').filter((b) => b.getAttribute('data-mode'));
  assert.deepEqual(seg.map((b) => `${b.getAttribute('data-mode')}:${b.textContent}`), ['2d:Graphe', '3d:Graphe 3D']);
  // Sans toile dans le faux navigateur : le 2D est montré, et son bouton est enfoncé.
  assert.equal(seg[0].getAttribute('aria-pressed'), 'true');
  const src3d = readFileSync(new URL('../src/web/pages/graphe-espace.js', import.meta.url), 'utf8');
  assert.match(src, /window\.OdinGrapheEspace/, 'le 3D passe par le composant commun');
  assert.match(src3d, /function choix\(/);
});
