// Les pages des applis : chaque formulaire doit porter les réglages de SON action, et chaque bouton
// désigner une action qui existe. (Une action ajoutée au milieu d'une appli avait décalé les formulaires
// qui désignaient leur action par son numéro d'ordre : la page de Orphée ne s'ouvrait plus, un formulaire de
// Phénix envoyait le mauvais réglage, et la vérification hebdomadaire des sauvegardes ne se faisait plus.)
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { sindri } from '../src/valhalla/modules/sindri.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';

function world(now?: () => Date) {
  const home = mkdtempSync(join(tmpdir(), 'odin-pages-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: join(home, 'workspace') }, cfg: DEFAULT_CONFIG } as never), { notify: async () => {}, run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('hors ligne'); }) as never, now });
  return { v, end: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}

test('Pages des applis : chaque page s\'ouvre, chaque formulaire a les réglages de son action, chaque bouton une action qui existe', async () => {
  const w = world();
  try {
    const wrong: string[] = []; let forms = 0;
    for (const m of w.v.modules()) {
      let view; try { view = await m.view(w.v.ctx(m.id), new URLSearchParams()); } catch (e) { wrong.push(`${m.name} : la page ne s'ouvre pas (${(e as Error).message})`); continue; }
      const sections = [...view.sections, ...(view.side ?? [])];
      for (const s of sections) {
        if (s.kind === 'form') {
          forms++;
          const a = m.actions.find((x) => x.id === s.action);
          if (!a) { wrong.push(`${m.name} · « ${s.title} » : action inconnue « ${s.action} »`); continue; }
          if (!Array.isArray(s.params)) { wrong.push(`${m.name} · « ${s.title} » : formulaire sans liste de réglages`); continue; }
          // Un formulaire « à cases » (réglages fixes + une case par appli, ex. Persona → Accès) peut envoyer des cases que l'action lit elle-même.
          const fixe = Object.keys((s as { fixe?: Record<string, unknown> }).fixe ?? {}), cases = fixe.length > 0;
          const known = new Set([...(a.params ?? []).map((p) => p.key), ...fixe]), extra = s.params.filter((p) => !(cases && p.kind === 'boolean')).map((p) => p.key).filter((k) => !known.has(k));
          if (extra.length) wrong.push(`${m.name} · « ${s.title} » (${s.action}) : réglages ${extra.join(', ')} inconnus de l'action (elle attend ${[...known].join(', ') || 'rien'})`);
          const missing = (a.params ?? []).filter((p) => p.required && !s.params.some((x) => x.key === p.key) && !fixe.includes(p.key)).map((p) => p.key);
          if (missing.length) wrong.push(`${m.name} · « ${s.title} » (${s.action}) : réglage obligatoire absent du formulaire : ${missing.join(', ')}`);
        }
        if (s.kind === 'table') {
          for (const r of s.rows) { if (r.cells.length !== s.columns.length) wrong.push(`${m.name} · tableau « ${s.title} » : ${r.cells.length} cases pour ${s.columns.length} colonnes`); for (const x of r.actions ?? []) if (!(x.module ? w.v.modules().find((y) => y.id === x.module) : m)?.actions.some((a) => a.id === x.action)) wrong.push(`${m.name} · bouton « ${x.label} » : action inconnue « ${x.action} »`); }
        }
      }
    }
    assert.deepEqual(wrong, []);
    assert.ok(forms >= 25, `${forms} formulaires vérifiés`);
  } finally { w.end(); }
});

test('Applis : aucune action n\'est désignée par son numéro d\'ordre dans le code', () => {
  const dir = new URL('../src/valhalla/modules/', import.meta.url), bad: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) readFileSync(new URL(f, dir), 'utf8').split('\n').forEach((l, i) => { if (/\.actions\[\d+\]/.test(l)) bad.push(`${f}:${i + 1}`); });
  assert.deepEqual(bad, [], 'désigne l\'action par son identifiant : actions.find((a) => a.id === \'…\')');
});

test('Phénix : le dimanche à 4 h 30, c\'est bien la vérification des sauvegardes qui tourne (et rien d\'autre)', async () => {
  const sunday = new Date(2026, 10, 15, 4, 30, 0); assert.equal(sunday.getDay(), 0);
  const w = world(() => sunday), called: string[] = [], saved = sindri.actions.map((a) => a.run);
  try {
    sindri.actions.forEach((a) => { a.run = () => { called.push(a.id); return { text: 'ok' }; }; });
    await sindri.watch!.run(w.v.ctx('sindri'));
    assert.deepEqual(called, ['verifier']);
  } finally { sindri.actions.forEach((a, i) => { a.run = saved[i]; }); w.end(); }
});

test('Guide de la mascotte : chaque page de l\'interface a son explication, et le script est servi avec les autres', () => {
  const guide = readFileSync(new URL('../src/web/guide.js', import.meta.url), 'utf8'), ui = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8'), server = readFileSync(new URL('../src/web/server.ts', import.meta.url), 'utf8');
  const explained = new Set([...guide.slice(guide.indexOf('const VIEWS = {'), guide.indexOf('let box = null')).matchAll(/^\s{4}(\w+): \['/gm)].map((m) => m[1]));
  const views = [...new Set([...ui.matchAll(/data-view="(\w+)"/g)].map((m) => m[1]))];
  assert.ok(views.length >= 12, `${views.length} pages dans le menu`);
  assert.deepEqual(views.filter((v) => !explained.has(v)), [], 'chaque page du menu a son explication dans le guide');
  assert.match(ui, /<script nonce="__NONCE__" src="\/guide\.js"><\/script>/, 'le guide est chargé par la page (avec le jeton de sécurité des scripts)');
  assert.match(server, /url\.pathname === '\/guide\.js'/, 'et servi par Odin');
  // Jamais de HTML brut : le texte d'Odin passe par des nœuds de texte (pas d'injection possible depuis une réponse).
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|eval\(/.test(guide), 'aucune écriture de HTML brut dans le guide');
  // Une action qui demande ton accord n'est jamais validée depuis la bulle : elle renvoie à la Discussion
  assert.match(guide, /J'ai besoin de ton accord/);
  assert.match(guide, /Voir et valider/);
});

test('Page de connexion : aucun script ne la recharge quand le serveur répond « pas connecté » (elle se rechargeait en boucle)', async () => {
  // Le script des applis tourne aussi sur la page de connexion. On l'exécute pour de bon dans une page
  // minimale : appli cachée (pas connecté), puis appli affichée (session expirée en cours d'usage).
  const run = async (appHidden: boolean) => {
    const timers: Array<() => unknown> = [], fetched: string[] = []; let reloads = 0;
    const node = () => ({ append() {}, setAttribute() {}, addEventListener() {}, className: '', hidden: false, textContent: '' });
    const app = { hidden: appHidden };
    const document = { readyState: 'complete', head: node(), body: node(), createElement: node, createTextNode: node, addEventListener() {}, querySelector: (s: string) => (s === '#app' ? app : null), querySelectorAll: () => [] };
    const ctx = { document, window: {} as Record<string, unknown>, location: { reload: () => { reloads++; } }, fetch: async (u: string) => { fetched.push(u); return { status: 401, json: async () => ({}) }; }, setTimeout: (f: () => unknown) => { timers.push(f); return 0; }, setInterval: (f: () => unknown) => { timers.push(f); return 0; }, clearTimeout() {}, console };
    ctx.window = ctx as never;
    vm.runInNewContext(readFileSync(new URL('../src/web/valhalla.js', import.meta.url), 'utf8'), ctx);
    assert.ok(timers.length >= 2, 'le script programme bien son compteur d\'alertes');
    for (const f of timers) await f();
    await new Promise((r) => setTimeout(r, 20));
    return { reloads, fetched };
  };
  const login = await run(true);
  assert.deepEqual(login, { reloads: 0, fetched: [] }, 'pas connecté : le serveur n\'est même pas interrogé, et rien ne recharge la page');
  const expired = await run(false);
  assert.ok(expired.fetched.includes('/api/valhalla/catalog') && expired.reloads >= 1, 'session expirée en cours d\'usage : retour à la page de connexion');
  // Les autres scripts de pages suivent la même règle.
  for (const f of ['brain', 'flows', 'runes', 'valhalla']) { const js = readFileSync(new URL(`../src/web/${f}.js`, import.meta.url), 'utf8'); assert.ok(!/401\) \{ location\.reload\(\)/.test(js) && /if \(appShown\(\)\) location\.reload\(\)/.test(js), `${f}.js ne recharge la page que si l'appli est affichée`); }
  // Et la mascotte réagit au toucher dès la page de connexion : son code est placé avant la sortie « pas connecté ».
  const ui = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');
  assert.ok(ui.indexOf('elle réagit quand on la touche') > 0 && ui.indexOf('elle réagit quand on la touche') < ui.search(/ {2}if \(!AUTHED\) \{\r?\n {4}\$\('#login'\)\.hidden = false;/), 'le toucher de la mascotte est branché avant la sortie « pas connecté »');
  assert.match(ui, /const buddies = \(\) => \[[^\]]*'#login \.odin'\]/, 'et ses humeurs s\'appliquent au visage de la page de connexion');
});
