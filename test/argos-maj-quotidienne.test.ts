// La tâche quotidienne d'Argos (pilotée par Talos) : chaque jour, elle vérifie que l'antivirus (Asclépios), l'anti-
// malware (Méduse) et leurs sources sont à jour, et lance les retards en appelant leurs propres actions de mise à
// jour. Réglable : l'heure creuse, et le mode « prévenir seulement » au lieu d'« automatique ».
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActionResult, ModCtx } from '../src/valhalla/types.ts';
import { argos, majSources } from '../src/valhalla/modules/argos.ts';

interface Faux { ctx: ModCtx; calls: Array<[string, string]>; alerts: unknown[]; settings: Record<string, unknown> }
function fauxCtx(settings: Record<string, unknown> = {}, o: { echoue?: string } = {}): Faux {
  const calls: Array<[string, string]> = [], alerts: unknown[] = [];
  const ctx = {
    home: '/tmp/x', dir: '/tmp/x', settings,
    saveSettings(p: Record<string, unknown>) { Object.assign(settings, p); },
    now: () => new Date('2026-11-16T04:00:00Z'),
    alert: (a: unknown) => { alerts.push(a); },
    async call(mod: string, act: string): Promise<ActionResult> { calls.push([mod, act]); if (o.echoue === mod) throw new Error('injoignable'); return { text: `${mod} à jour`, ok: true }; },
  } as unknown as ModCtx;
  return { ctx, calls, alerts, settings };
}

test('mode automatique : la tâche lance la mise à jour de l\'antivirus et de l\'anti-malware, et note son passage', async () => {
  const f = fauxCtx();
  const r = await majSources(f.ctx);
  assert.deepEqual(f.calls.sort(), [['geri', 'listes'], ['ullr', 'mettre_a_jour']]);
  const d = f.settings.majDernier as { ok: boolean; at: string };
  assert.equal(d.ok, true); assert.ok(d.at);
  assert.equal(f.alerts.length, 0, 'tout à jour : aucune alerte');
  assert.match(r.text, /Asclépios/);
});

test('mode « prévenir seulement » : rien n\'est mis à jour tout seul, mais le passage est noté', async () => {
  const f = fauxCtx({ majParc: { mode: 'prevenir', heure: 2 } });
  await majSources(f.ctx);
  assert.equal(f.calls.length, 0, 'aucune mise à jour lancée');
  assert.equal((f.settings.majDernier as { ok: boolean }).ok, true);
  // « Lancer maintenant » (forcer) passe outre le mode prévenir.
  const f2 = fauxCtx({ majParc: { mode: 'prevenir', heure: 2 } });
  await majSources(f2.ctx, { forcer: true });
  assert.equal(f2.calls.length, 2, 'forcé : les deux mises à jour sont lancées');
});

test('une source injoignable : le passage est en échec et une alerte claire part', async () => {
  const f = fauxCtx({}, { echoue: 'geri' });
  await majSources(f.ctx);
  assert.equal((f.settings.majDernier as { ok: boolean }).ok, false);
  assert.equal(f.alerts.length, 1);
});

test('réglage de l\'heure creuse : la tâche range son heure et la relit', () => {
  const settings: Record<string, unknown> = {};
  const ctx = { settings, saveSettings(p: Record<string, unknown>) { Object.assign(settings, p); }, now: () => new Date() } as unknown as ModCtx;
  const t = argos.taches!(ctx).find((x) => x.id === 'maj_quotidienne')!;
  assert.equal(t.securite, true);
  const r = t.rythme(ctx); assert.equal(r.genre === 'jour' ? r.heure : '', '03:00', 'heure creuse par défaut 3 h');
  t.regler!(ctx, { genre: 'jour', heure: '05:00' });
  assert.equal((settings.majParc as { heure: number }).heure, 5);
  const r2 = t.rythme(ctx); assert.equal(r2.genre === 'jour' ? r2.heure : '', '05:00');
  assert.throws(() => t.regler!(ctx, { genre: 'semaine', jours: [1], heure: '05:00' }), /une fois par jour/);
});
