// Cerbère · Ouvrir un port : ouvrir le pare-feu de la machine (et la box vers Internet) change le système et ouvre vers
// l'extérieur. Comme Thermopyles (hlid.ouvrir_port), l'action montre ce qui change et attend la validation du propriétaire ;
// une automatisation ne l'ouvre pas. Fermer un port reste comme avant. Rien n'est lancé sur la machine : commandes notées.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { type Answers, type Judge } from '../src/mimir/client.ts';
import { call, makeOdin } from './helpers.ts';

/** Les applis d'Odin avec un pare-feu ufw allumé, imité : chaque commande est notée, aucune n'est lancée. */
function monde() {
  const home = mkdtempSync(join(tmpdir(), 'odin-garmr-port-')), ran: string[] = [];
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: { venus: {}, voice: {} } } as never), {
    run: async (cmd, args) => { ran.push(`${cmd} ${args.join(' ')}`); return { code: 0, out: /command -v/.test(args.join(' ')) ? '/usr/bin/x' : cmd === 'ufw' && args[0] === 'status' ? 'Status: active' : '', err: '' }; },
    fetch: (async () => { throw new Error('réseau coupé'); }) as unknown as typeof fetch,
    notify: async () => {}, autonomy: () => 'equilibre',
  });
  setValhalla(v);
  return { v, ran, ouvert: () => ran.some((c) => /^ufw allow 41817\/udp/.test(c)), fin: () => { setValhalla(undefined); v.stop(); rmSync(home, { recursive: true, force: true }); } };
}
/** Un juge qui dit : demandé clairement par le propriétaire, rien de risqué (ce que Mímir a répondu sur le banc). */
const juge = (p: Record<string, number>): Judge => async (_s, questions) => {
  const a: Answers = {};
  for (const [name, q] of Object.entries(questions)) {
    if (q.type === 'noul') a[name] = { type: 'noul', noul: p[name] ?? 0.05 };
    else if (q.type === 'choice') { const top = Object.keys(q.criteria)[0]; a[name] = { type: 'choice', choice: top, probabilities: { [top]: 0.9 } }; }
  }
  return a;
};
const S = { sessionId: 'web:principal', channel: 'web' as const };
const PORT = { port: 41817, proto: 'udp', pour: 'la console de Maëlys' };
const demande = () => call('valhalla', { action: 'action', appli: 'garmr', quoi: 'ouvrir_port', entree: JSON.stringify(PORT) });

test('Cerbère · Ouvrir un port, demandé au chat : Odin demande la validation du propriétaire et montre ce qui change', async () => {
  const w = monde();
  const o = makeOdin([demande(), { text: 'Voilà.' }], { judge: juge({ requested: 0.97 }) });
  try {
    await o.agent.run('Ouvre le port 41817 en UDP sur Cerbère pour la console de Maëlys', S);
    assert.equal(o.approvals.length, 1, `la validation du propriétaire est demandée (approbations : ${o.approvals.length}, commandes : ${w.ran.filter((c) => c.startsWith('ufw allow')).join(' | ') || 'aucune'})`);
    assert.equal(o.approvals[0].severity, 'grave');
    assert.match(o.approvals[0].reason, /41817\/udp/);
    assert.ok(!w.ouvert(), 'sans réponse du propriétaire, le port reste fermé');
  } finally { o.cleanup(); w.fin(); }
});

test('Cerbère · Ouvrir un port : confirmé par le propriétaire, le port s\'ouvre', async () => {
  const w = monde();
  const o = makeOdin([demande(), { text: 'Voilà.' }], { judge: juge({ requested: 0.97 }), approve: true });
  try {
    await o.agent.run('Ouvre le port 41817 en UDP sur Cerbère pour la console de Maëlys', S);
    assert.equal(o.approvals.length, 1);
    assert.ok(w.ouvert(), 'validé : le pare-feu reçoit l\'ordre');
    assert.match((await w.v.act('garmr', 'ports_ouverts')).text, /41817\/udp · la console de Maëlys/);
  } finally { o.cleanup(); w.fin(); }
});

test('Cerbère · Ouvrir un port : la validation dit le port, le protocole, pour qui, et machine seule ou box vers Internet', () => {
  const w = monde();
  try {
    const g = w.v.action('garmr', 'ouvrir_port')!.a.grave!, ctx = w.v.ctx('garmr');
    const machine = g(PORT, ctx) ?? '', box = g({ ...PORT, box: true }, ctx) ?? '', nu = g({ port: 8443 }, ctx) ?? '';
    assert.match(machine, /41817\/udp/); assert.match(machine, /la console de Maëlys/); assert.match(machine, /machine d'Odin seulement/); assert.doesNotMatch(machine, /Internet/);
    assert.match(box, /box/); assert.match(box, /Internet/);
    assert.match(nu, /8443\/tcp/);
    // Fermer un port : inchangé.
    assert.equal(w.v.action('garmr', 'fermer_port')!.a.grave!({ port: 8443 }, ctx), 'fermer le port 8443 (le service ne sera plus joignable de l\'extérieur de la machine)');
  } finally { w.fin(); }
});

test('Cerbère · Ouvrir un port : une automatisation ne l\'ouvre pas', async () => {
  const w = monde();
  try {
    const r = await w.v.act('garmr', 'ouvrir_port', PORT, { auto: true });
    assert.equal(r.ok, false); assert.match(r.text, /action grave/);
    assert.ok(!w.ouvert(), 'rien n\'est envoyé au pare-feu');
  } finally { w.fin(); }
});

// Le trou d'avant est fermé (service.ts) : un appel entre applis (réflexe) sans action de départ validée n'atteint plus
// l'ouverture ; il est refusé et le propriétaire est prévenu. Le chemin voulu reste : il valide l'action de départ
// (ex. gjoll.allumer, dont la validation dit le port), puis le réflexe ouvre le port du VPN (test/ouvertures-validation).
test('Cerbère · Ouvrir un port : un réflexe sans action de départ validée est refusé, rien ne s\'ouvre', async () => {
  const w = monde();
  try {
    const r = await w.v.ctx('gjoll').call('garmr', 'ouvrir_port', { port: 41817, proto: 'udp', pour: 'VPN Vortex', par: 'VPN Vortex' }, 'ouvrir le port 41817/udp pour VPN Vortex');
    assert.equal(r.ok, false, r.text);
    assert.match(r.text, /validation/);
    assert.ok(!w.ouvert(), 'rien n\'est envoyé au pare-feu');
    assert.equal(w.v.manips({ module: 'garmr' }).length, 0, 'rien de fait, donc aucune manip');
  } finally { w.fin(); }
});
