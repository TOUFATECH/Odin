// Les pages des applis : chaque formulaire doit porter les réglages de SON action, et chaque bouton
// désigner une action qui existe. (Une action ajoutée au milieu d'une appli avait décalé les formulaires
// qui désignaient leur action par son numéro d'ordre : la page de Bragi ne s'ouvrait plus, un formulaire de
// Sindri envoyait le mauvais réglage, et la vérification hebdomadaire des sauvegardes ne se faisait plus.)
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
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
          const known = new Set((a.params ?? []).map((p) => p.key)), extra = s.params.map((p) => p.key).filter((k) => !known.has(k));
          if (extra.length) wrong.push(`${m.name} · « ${s.title} » (${s.action}) : réglages ${extra.join(', ')} inconnus de l'action (elle attend ${[...known].join(', ') || 'rien'})`);
          const missing = (a.params ?? []).filter((p) => p.required && !s.params.some((x) => x.key === p.key)).map((p) => p.key);
          if (missing.length) wrong.push(`${m.name} · « ${s.title} » (${s.action}) : réglage obligatoire absent du formulaire : ${missing.join(', ')}`);
        }
        if (s.kind === 'table') {
          for (const r of s.rows) { if (r.cells.length !== s.columns.length) wrong.push(`${m.name} · tableau « ${s.title} » : ${r.cells.length} cases pour ${s.columns.length} colonnes`); for (const x of r.actions ?? []) if (!m.actions.some((a) => a.id === x.action)) wrong.push(`${m.name} · bouton « ${x.label} » : action inconnue « ${x.action} »`); }
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

test('Sindri : le dimanche à 4 h 30, c\'est bien la vérification des sauvegardes qui tourne (et rien d\'autre)', async () => {
  const sunday = new Date(2026, 10, 15, 4, 30, 0); assert.equal(sunday.getDay(), 0);
  const w = world(() => sunday), called: string[] = [], saved = sindri.actions.map((a) => a.run);
  try {
    sindri.actions.forEach((a) => { a.run = () => { called.push(a.id); return { text: 'ok' }; }; });
    await sindri.watch!.run(w.v.ctx('sindri'));
    assert.deepEqual(called, ['verifier']);
  } finally { sindri.actions.forEach((a, i) => { a.run = saved[i]; }); w.end(); }
});
