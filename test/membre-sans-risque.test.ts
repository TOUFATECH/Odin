// Un membre de la famille et les choses sans risque (décisions du propriétaire, 17/11) : ce qu'un MEMBRE demande
// lui-même et qu'Odin fait seul, sans la validation du propriétaire — noter, rappeler, mettre de la musique, allumer ou
// éteindre une lumière, convertir un document (un nouveau fichier à côté, l'original intact), faire analyser un fichier
// (une lecture). RIEN D'AUTRE : tout le reste lui reste demandé. Un invité, une tâche automatique, une conversation
// qui a lu un contenu extérieur ne gagnent rien ; le niveau d'autonomie du membre n'élargit pas la liste.
// Sur le produit : un Odin jetable, la vraie boucle, le vrai Heimdall, les vraies applis, un faux modèle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { call, makeOdin, type TestOdin } from './helpers.ts';
import { Heimdall, type ApprovalRequest, type GateInput, type Review } from '../src/heimdall/policy.ts';
import * as politique from '../src/heimdall/policy.ts';
import { deciderPuisLancer, lireEntitesAvec } from '../src/heimdall/executer.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import type { Tool, ToolContext } from '../src/tools/registry.ts';

// Les entités de la maison, sans box : un nom suffit (les ouvertures ont leur propre essai, maison-ouvertures).
lireEntitesAvec(async (_c, e) => ({ nom: e }));

const MEMBRE = { name: 'Sami', role: 'member' as const, autonomy: 'prudent' as const };
const INVITE = { name: 'Noa', role: 'guest' as const };

/** Une fausse box Home Assistant sur la boucle de la machine : elle note chaque service demandé. */
async function fausseBox(): Promise<{ url: string; recus: string[]; fin: () => Promise<void> }> {
  const recus: string[] = [];
  const srv: Server = createServer((req, res) => {
    let corps = ''; req.on('data', (d) => { corps += d; });
    req.on('end', () => {
      if (req.method === 'POST') recus.push(`${req.url} ${corps}`);
      res.setHeader('content-type', 'application/json'); res.end(req.method === 'POST' ? '[]' : JSON.stringify({ entity_id: 'x', state: 'on', attributes: {} }));
    });
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const port = (srv.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, recus, fin: () => new Promise<void>((ok) => srv.close(() => ok())) };
}

/** Un Odin jetable avec ses vraies applis (Apollon, Alchimie, Asclépios…) ; les commandes du système sont notées, pas lancées. */
function odinAvecApplis(script: Parameters<typeof makeOdin>[0], ha = '', messages: string[] = []): { o: TestOdin; v: Valhalla; commandes: string[] } {
  const o = makeOdin(script, { config: (c) => ({ ...c, homeAssistant: { url: ha } }) });
  const commandes: string[] = [];
  const v = new Valhalla(o.paths.home, allModules({ paths: o.paths, cfg: o.cfg } as never), {
    run: async (c, a) => { commandes.push([c, ...a].join(' ')); return { code: 0, out: '', err: '' }; },
    fetch: (async () => new Response('')) as unknown as typeof fetch, notify: async (t) => { messages.push(t); }, autonomy: () => 'equilibre',
  });
  setValhalla(v);
  return { o, v, commandes };
}
const fin = (x: { o: TestOdin }) => { setValhalla(undefined); x.o.cleanup(); };
const journal = (o: TestOdin) => { try { return readFileSync(join(o.paths.logs, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>); } catch { return []; } };
const parler = (o: TestOdin, qui: typeof MEMBRE | typeof INVITE, sessionId: string) =>
  o.agent.run('étape d\'essai numéro un', { sessionId, channel: 'fake', peer: qui.name.toLowerCase(), speaker: qui, trusted: qui.role === 'member' });

test('la liste écrite dans la politique : noter, rappeler, musique, lumière — rien d\'autre (pur)', () => {
  assert.ok(politique.sansRisqueMembre('note_save', 'fiche « courses »'));
  assert.ok(politique.sansRisqueMembre('reminder_set', 'rappel le demain 9h : « dentiste »'));
  assert.ok(politique.sansRisqueMembre('valhalla', 'applis action aegir jouer '));
  assert.ok(politique.sansRisqueMembre('valhalla', 'applis action Apollon Jouer '));
  assert.ok(politique.sansRisqueMembre('ha_call', 'Maison : light.turn_on → light.salon'));
  assert.ok(politique.sansRisqueMembre('ha_call', 'Maison : light.turn_off → light.salon, light.cuisine'));
  assert.ok(politique.sansRisqueMembre('ha_call', 'Maison : light.toggle → light.chambre'));
  assert.ok(politique.sansRisqueMembre('valhalla', 'applis action dvalinn convertir '));
  assert.ok(politique.sansRisqueMembre('valhalla', 'applis action Alchimie Convertir '));
  for (const [outil, resume] of [
    // Réanalyser : réécrit la quarantaine, pas une lecture. L'étape « mettre à l'écart » d'Alchimie : pas une conversion.
    ['valhalla', 'applis action Asclépios reanalyser '], ['valhalla', 'applis action dvalinn isoler_avant_conversion '], ['valhalla', 'applis action dvalinn convertir pdf'],
    ['ha_call', 'Maison : lock.lock → lock.porte'], ['ha_call', 'Maison : switch.turn_off → switch.prise_four'], ['ha_call', 'Maison : light.turn_on → switch.prise'],
    ['ha_call', 'Maison : light.turn_off → all'], ['ha_call', 'Maison : light.turn_off'], ['ha_call', 'Maison : homeassistant.turn_off → light.salon'],
    ['ha_call', 'Maison : climate.set_temperature → climate.salon'], ['ha_call', 'Maison : cover.close_cover → cover.volet'], ['ha_call', 'Maison : light.turn_on → light.salon\nlock.porte'],
    ['valhalla', 'applis action aegir radio '], ['valhalla', 'applis action aegir jouer musique douce'], ['valhalla', 'applis action ullr isoler '], ['valhalla', 'applis action ullr restaurer '],
    ['valhalla', 'applis action ullr analyser '], ['valhalla', 'applis action dvalinn surveiller '], ['valhalla', 'applis manip tout annuler '],
    ['media_convert', 'convertir a.mp4 → a.mp4'], ['fs_write', 'écrire notes.txt'], ['shell', 'rm a.txt'], ['schedule_task', 'tâche'], ['mail_send', 'envoi'],
  ] as const) assert.equal(politique.sansRisqueMembre(outil, resume), undefined, `${outil} ${resume}`);
});

/** Un Heimdall comme celui d'Odin (politique par défaut), dont on voit les demandes au propriétaire (réponse : non). */
function gardien(o: { autonomie?: 'prudent' | 'equilibre' | 'autonome' | 'breaker'; juge?: Review } = {}) {
  const demandes: ApprovalRequest[] = [];
  const h = new Heimdall({ ...DEFAULT_CONFIG.policy, approvalTimeoutSec: 1 }, { approve: async (r) => { demandes.push(r); return false; } });
  if (o.juge) h.setReviewer(async () => o.juge!, o.autonomie ?? 'equilibre');
  else h.setAutonomy(o.autonomie ?? 'equilibre');
  return { h, demandes };
}
const ctxEssai = { workspace: tmpdir(), fullAccess: false, sessionId: 'fake:sami', channel: 'fake', peer: 'sami', isTainted: () => false, homeAssistant: { url: '' } } as unknown as ToolContext;
const outilFaux = (name: string, risk: Tool['risk'], summarize: Tool['summarize']) => ({ name, description: '', risk, schema: { type: 'object', properties: {} }, summarize, async run() { return 'fait'; } }) as unknown as Tool;

test('un membre : chaque chose INTERDITE de la liste est demandée au propriétaire — même par le même outil, même en « autonome »', async () => {
  const o = makeOdin([]);
  try {
    const outil = (n: string) => o.tools.get(n)!;
    const interdits: Array<[string, Record<string, unknown>]> = [
      ['ha_call', { domain: 'lock', service: 'lock', entity_id: 'lock.porte_entree' }],
      ['ha_call', { domain: 'alarm_control_panel', service: 'alarm_arm_away', entity_id: 'alarm_control_panel.maison' }],
      ['ha_call', { domain: 'cover', service: 'close_cover', entity_id: 'cover.portail' }],
      ['ha_call', { domain: 'cover', service: 'open_cover', entity_id: 'cover.volet_salon' }],
      ['ha_call', { domain: 'switch', service: 'turn_off', entity_id: 'switch.prise_four' }],
      ['ha_call', { domain: 'switch', service: 'turn_on', entity_id: 'switch.lave_linge' }],
      ['ha_call', { domain: 'climate', service: 'set_temperature', entity_id: 'climate.salon', data: '{"temperature":25}' }],
      ['ha_call', { domain: 'light', service: 'turn_on', entity_id: 'switch.prise_four' }],
      ['ha_call', { domain: 'light', service: 'turn_off', entity_id: 'all' }],
      ['ha_call', { domain: 'homeassistant', service: 'turn_off', entity_id: 'light.salon' }],
      ['fs_write', { path: 'notes.txt', content: 'écrasé' }],
      ['fs_edit', { path: 'notes.txt', old: 'a', new: 'b' }],
      ['shell', { command: 'rm notes.txt' }],
      ['shell', { command: 'mv notes.txt ailleurs.txt' }],
      ['mail_move', { id: '1', folder: 'Corbeille' }],
      ['media_convert', { input: 'film.mp4', output: 'film.mp4' }],
      ['valhalla', { action: 'action', appli: 'ullr', quoi: 'isoler', entree: '{"fichier":"/tmp/x"}' }],
      ['valhalla', { action: 'action', appli: 'ullr', quoi: 'analyser', entree: '{"dossier":"téléchargements"}' }],
      ['valhalla', { action: 'action', appli: 'ullr', quoi: 'reanalyser', entree: '{"id":"q1"}' }],
      ['valhalla', { action: 'action', appli: 'dvalinn', quoi: 'isoler_avant_conversion', entree: '{"fichier":"/tmp/x"}' }],
      ['valhalla', { action: 'action', appli: 'aegir', quoi: 'radio', entree: '{"nom":"x","adresse":"http://exemple.org"}' }],
      ['valhalla', { action: 'action', appli: 'dvalinn', quoi: 'ajouter_dossier', entree: '{"nom":"x","chemin":"/tmp"}' }],
      ['mail_send', { to: 'quelquun@exemple.org', subject: 's', body: 'b' }],
      ['send_message', { channel: 'telegram', peer: '1', text: 'bonjour' }],
      ['http_request', { url: 'https://exemple.org/payer', method: 'POST' }],
      ['system_update_apply', {}],
      ['net_block', { ip: '192.0.2.4' }],
      ['schedule_task', { cron: '0 7 * * *', prompt: 'x' }],
      ['settings_set', { key: 'agent.fullAccess', value: 'true' }],
      ['undo_apply', { id: '1' }],
    ];
    for (const autonomie of ['equilibre', 'autonome'] as const) {
      // Le juge dit « routine, demandé par toi » : sans la liste, un membre « autonome » passerait. Il ne passe pas.
      const { h, demandes } = gardien({ autonomie: 'breaker', juge: { severity: 'routine', reason: 'anodin', flags: [], requested: 'yes' } });
      for (const [n, entree] of interdits) {
        const t = outil(n); assert.ok(t, n);
        const avant = demandes.length;
        const r = await deciderPuisLancer(h, t, entree, ctxEssai, { sessionId: 'fake:sami', tainted: false, maxAutonomy: autonomie, userRequest: '' });
        assert.equal(r.decision.allowed, false, `${autonomie} · ${n} ${JSON.stringify(entree)} : ${JSON.stringify(r.decision)}`);
        assert.equal(r.lancer, undefined);
        assert.equal(demandes.length, avant + 1, `${autonomie} · ${n} ${JSON.stringify(entree)} : la question est posée au propriétaire (${(r.decision as { reason: string }).reason})`);
      }
    }
  } finally { o.cleanup(); }
});

test('un membre : la liste ne vaut ni dans une conversation marquée, ni en tâche automatique, ni sans surveillance ; un invité ne gagne rien', async () => {
  const lumiere = outilFaux('ha_call', 'external', (i) => `Maison : ${String(i.domain)}.${String(i.service)} → ${String(i.entity_id)}`);
  const entree = { domain: 'light', service: 'turn_on', entity_id: 'light.salon' };
  const cas: Array<[string, Partial<GateInput>]> = [
    ['membre, conversation marquée', { maxAutonomy: 'prudent', tainted: true }],
    ['membre, contenu manipulateur', { maxAutonomy: 'prudent', suspicious: true }],
    ['membre, tâche automatique', { maxAutonomy: 'prudent', automatique: true }],
    ['membre, sans surveillance', { maxAutonomy: 'prudent', unattended: true }],
    ['invité (message non fiable)', { tainted: true }],
  ];
  for (const [nom, e] of cas) {
    const { h } = gardien();
    const r = await deciderPuisLancer(h, lumiere, entree, ctxEssai, { sessionId: 'fake:x', tainted: false, ...e });
    assert.equal(r.decision.allowed, false, `${nom} : ${JSON.stringify(r.decision)}`);
  }
  const { h, demandes } = gardien();
  const ok = await deciderPuisLancer(h, lumiere, entree, ctxEssai, { sessionId: 'fake:sami', tainted: false, maxAutonomy: 'prudent' });
  assert.equal(ok.decision.allowed, true, JSON.stringify(ok.decision)); assert.equal(demandes.length, 0);
  // Le juge voit une gravité « grave » : la liste ne passe pas au-dessus, la question est posée.
  const g = gardien({ juge: { severity: 'grave', reason: 'étrange', flags: ['inhabituel'] } });
  assert.equal((await deciderPuisLancer(g.h, lumiere, entree, ctxEssai, { sessionId: 'fake:sami', tainted: false, maxAutonomy: 'prudent' })).decision.allowed, false);
  assert.equal(g.demandes.length, 1);
});

test('produit — noter et rappeler : un membre le fait faire seul (déjà le cas), noté au journal', async () => {
  const o = makeOdin([call('note_save', { title: 'Courses', content: 'pain, riz' }), call('reminder_set', { at: 'dans 2 heures', text: 'appeler le dentiste' }), { text: 'fait' }]);
  try {
    await parler(o, MEMBRE, 'fake:sami');
    assert.equal(o.approvals.length, 0, 'rien demandé au propriétaire');
    assert.ok(o.muninn.listJobs().some((j) => /dentiste/.test(j.prompt)), 'le rappel est programmé');
    const l = journal(o).filter((x) => x.session === 'fake:sami' && x.allowed === true).map((x) => x.tool);
    assert.ok(l.includes('note_save') && l.includes('reminder_set'), JSON.stringify(l));
  } finally { o.cleanup(); }
});

test('produit — la musique : un membre la fait mettre seul (noté au journal, à son nom) ; un invité, c\'est demandé', async () => {
  const appel = call('valhalla', { action: 'action', appli: 'aegir', quoi: 'jouer', entree: '{"quoi":"Radio du matin"}' });
  const x = odinAvecApplis([appel, { text: 'fait' }]);
  try {
    // Les noms que la liste accepte mènent bien à ces applis-là (et pas à une autre qui porterait le même nom).
    assert.deepEqual(['apollon', 'Alchimie', 'Asclépios'].map((n) => x.v.module(n)?.id), ['aegir', 'dvalinn', 'ullr']);
    assert.equal((await x.v.act('aegir', 'radio', { nom: 'Radio du matin', adresse: 'http://127.0.0.1:9/flux' })).ok, true);
    await parler(x.o, MEMBRE, 'fake:sami');
    assert.equal(x.o.approvals.length, 0, 'rien demandé au propriétaire');
    assert.ok(x.commandes.some((c) => /^mpv .*127\.0\.0\.1:9\/flux/.test(c)), `la radio part : ${x.commandes.join(' | ')}`);
    const ligne = journal(x.o).find((l) => l.tool === 'valhalla' && l.allowed === true);
    assert.ok(ligne, 'notée au journal'); assert.equal(ligne!.session, 'fake:sami');
    assert.match(JSON.stringify(ligne!.notes), /membre de la famille.*mettre de la musique/, JSON.stringify(ligne));
  } finally { fin(x); }
  const y = odinAvecApplis([appel, { text: 'fait' }]);
  try {
    await y.v.act('aegir', 'radio', { nom: 'Radio du matin', adresse: 'http://127.0.0.1:9/flux' });
    await parler(y.o, INVITE, 'fake:noa');
    assert.equal(y.o.approvals.length, 1, 'un invité : demandé au propriétaire');
    assert.ok(!y.commandes.some((c) => c.startsWith('mpv')), 'rien ne joue');
  } finally { fin(y); }
});

test('produit — la lumière passe, la serrure et la prise ne passent pas, par le même outil ; un invité : demandé', async () => {
  const box = await fausseBox(); process.env.HA_TOKEN = 'jeton-essai';
  try {
    const x = odinAvecApplis([
      call('ha_call', { domain: 'light', service: 'turn_on', entity_id: 'light.salon' }),
      call('ha_call', { domain: 'lock', service: 'lock', entity_id: 'lock.porte_entree' }),
      call('ha_call', { domain: 'switch', service: 'turn_off', entity_id: 'switch.prise_four' }),
      call('ha_call', { domain: 'lock', service: 'unlock', entity_id: 'lock.porte_entree' }),
      { text: 'fait' },
    ], box.url);
    try {
      await parler(x.o, MEMBRE, 'fake:sami');
      assert.deepEqual(box.recus.map((r) => r.split(' ')[0]), ['/api/services/light/turn_on'], 'seule la lumière part');
      assert.equal(x.o.approvals.length, 2, 'serrure (verrouiller) et prise : demandées ; déverrouiller : refusé d\'office');
      assert.ok(x.o.approvals.every((a) => a.tool === 'ha_call' && /lock\.lock|switch\.turn_off/.test(a.summary)), JSON.stringify(x.o.approvals.map((a) => a.summary)));
      assert.match(JSON.stringify(journal(x.o).find((l) => l.tool === 'ha_call' && l.allowed === true)?.notes), /membre de la famille.*lumière/);
    } finally { fin(x); }
    box.recus.length = 0;
    const y = odinAvecApplis([call('ha_call', { domain: 'light', service: 'turn_on', entity_id: 'light.salon' }), { text: 'fait' }], box.url);
    try {
      await parler(y.o, INVITE, 'fake:noa');
      assert.equal(box.recus.length, 0); assert.equal(y.o.approvals.length, 1, 'un invité : demandé au propriétaire');
    } finally { fin(y); }
  } finally { delete process.env.HA_TOKEN; await box.fin(); }
});

test('produit — convertir un fichier jugé dangereux, demandé par un membre : l\'original n\'est pas mis à l\'écart sans le propriétaire', async () => {
  // Alchimie fait vérifier le fichier par l'antivirus avant de le convertir ; sur une menace sûre, pour le propriétaire,
  // elle le met en quarantaine. Pour un membre : la conversion part sans validation (la liste), mais Alchimie la
  // refuse — l'original reste à sa place, rien en quarantaine, le propriétaire est prévenu (dvalinn.ts, asclepios).
  const messages: string[] = [];
  const x = odinAvecApplis([
    call('valhalla', { action: 'action', appli: 'dvalinn', quoi: 'convertir', entree: '{"fichier":"inbox/outil.bin","format":"pdf"}' }),
    { text: 'fait' },
  ], '', messages);
  try {
    assert.equal((await x.v.act('ullr', 'regle', { nom: 'Rançongiciel Kobold', chaines: 'KOBOLD-CHIFFRE-TOUT-9731', gravite: 'critique' })).ok, true);
    const d = join(x.o.paths.workspace, 'inbox'); mkdirSync(d, { recursive: true });
    const f = join(d, 'outil.bin'); writeFileSync(f, 'Devis\n....KOBOLD-CHIFFRE-TOUT-9731....\n');
    await parler(x.o, MEMBRE, 'fake:sami');
    assert.ok(existsSync(f), 'l\'original est toujours là');
    assert.deepEqual((x.v.ctx('ullr').settings.quarantine as unknown[] | undefined) ?? [], [], 'rien en quarantaine');
    assert.equal(x.o.approvals.length, 0, 'la conversion n\'est pas demandée (la liste) : c\'est Alchimie qui la refuse');
    assert.ok(messages.some((m) => m.includes('outil.bin') && /quarantaine/.test(m)), `le propriétaire est prévenu : ${JSON.stringify(messages)}`);
    assert.match(JSON.stringify(journal(x.o).find((l) => l.tool === 'valhalla' && l.allowed === true)?.notes), /membre de la famille.*convertir un document/);
  } finally { fin(x); }
});

test('produit — convertir : écraser l\'original (media_convert sur lui-même) : demandé à un membre', async () => {
  const SRT = '1\n00:00:01,000 --> 00:00:02,000\nBonjour\n';
  const x = odinAvecApplis([call('media_convert', { input: 'essai.srt', output: 'essai.srt' }), { text: 'fait' }]);
  try {
    writeFileSync(join(x.o.paths.workspace, 'essai.srt'), SRT);
    await parler(x.o, MEMBRE, 'fake:sami');
    assert.equal(x.o.approvals.length, 1, 'écraser l\'original : demandé');
    assert.equal(x.o.approvals[0].tool, 'media_convert');
    assert.equal(readFileSync(join(x.o.paths.workspace, 'essai.srt'), 'utf8'), SRT);
  } finally { fin(x); }
});

// La conversion seule, pour un membre, est décidée par le propriétaire (17/11) : Alchimie ne met plus l'original à
// l'écart quand la demande ne vient pas du propriétaire (src/valhalla/modules/dvalinn.ts, essai dvalinn-membre).
test('produit — convertir : un membre le fait seul, un nouveau fichier à côté, l\'original et l\'existant intacts', async () => {
  const SRT = '1\n00:00:01,000 --> 00:00:02,000\nBonjour\n';
  const x = odinAvecApplis([
    call('valhalla', { action: 'action', appli: 'dvalinn', quoi: 'convertir', entree: '{"fichier":"atelier:essai.srt","format":"vtt"}' }),
    call('media_convert', { input: 'essai.srt', output: 'essai.srt' }),
    { text: 'fait' },
  ]);
  try {
    const at = join(x.v.ctx('dvalinn').dir, 'atelier'); mkdirSync(at, { recursive: true });
    writeFileSync(join(at, 'essai.srt'), SRT); writeFileSync(join(at, 'essai.vtt'), 'DÉJÀ LÀ');
    writeFileSync(join(x.o.paths.workspace, 'essai.srt'), SRT);
    await parler(x.o, MEMBRE, 'fake:sami');
    assert.equal(readFileSync(join(at, 'essai.srt'), 'utf8'), SRT, 'l\'original n\'est pas touché');
    assert.equal(readFileSync(join(at, 'essai.vtt'), 'utf8'), 'DÉJÀ LÀ', 'un fichier existant n\'est pas écrasé');
    const nouveaux = (await import('node:fs')).readdirSync(at).filter((f) => f.endsWith('.vtt') && f !== 'essai.vtt');
    assert.equal(nouveaux.length, 1, `un nouveau fichier à côté : ${nouveaux.join(', ')}`);
    assert.match(readFileSync(join(at, nouveaux[0]), 'utf8'), /^WEBVTT/);
    assert.equal(x.o.approvals.length, 1, 'écraser l\'original (media_convert sur lui-même) : demandé');
    assert.equal(x.o.approvals[0].tool, 'media_convert');
    assert.equal(readFileSync(join(x.o.paths.workspace, 'essai.srt'), 'utf8'), SRT);
  } finally { fin(x); }
});

test('produit — analyser un fichier : un membre le fait seul (lecture) ; une menace trouvée n\'est mise à l\'écart qu\'avec le propriétaire', async () => {
  // Le scénario du faux modèle, rempli plus bas (une file : chaque réponse est prise une fois, « ok » quand elle est vide).
  const etapes: Array<ReturnType<typeof call> | { text: string }> = [];
  const x = odinAvecApplis(() => etapes.shift() ?? { text: 'ok' });
  try {
    // Le propriétaire a une règle de détection (Grimoire) ; un fichier du dossier de la famille la déclenche.
    assert.equal((await x.v.act('ullr', 'regle', { nom: 'Rançongiciel Kobold', chaines: 'KOBOLD-CHIFFRE-TOUT-9731', gravite: 'critique' })).ok, true);
    const dossier = join(x.o.paths.home, 'famille'); mkdirSync(dossier, { recursive: true });
    const menace = join(dossier, 'outil.bin'); writeFileSync(menace, Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), Buffer.from('....KOBOLD-CHIFFRE-TOUT-9731....')]));
    etapes.push(
      call('valhalla', { action: 'action', appli: 'ullr', quoi: 'fichier', entree: JSON.stringify({ chemin: menace }) }),
      call('valhalla', { action: 'action', appli: 'ullr', quoi: 'analyser', entree: JSON.stringify({ dossier }) }),
      call('valhalla', { action: 'action', appli: 'ullr', quoi: 'isoler', entree: JSON.stringify({ fichier: menace }) }),
      { text: 'fait' },
    );
    await parler(x.o, MEMBRE, 'fake:sami');
    assert.ok(existsSync(menace), 'rien n\'est mis à l\'écart sans le propriétaire');
    assert.deepEqual(x.o.approvals.map((a) => a.summary.trim()), ['applis action ullr analyser', 'applis action ullr isoler'], 'l\'analyse d\'un dossier (qui isole d\'elle-même) et la mise à l\'écart : demandées');
    const lu = journal(x.o).find((l) => l.tool === 'valhalla' && /ullr fichier/.test(String(l.summary)));
    assert.equal(lu?.allowed, true, 'l\'analyse d\'un fichier : une lecture, faite seule');
    assert.equal(lu?.session, 'fake:sami', 'notée au journal, au nom de la conversation du membre');
    // Un élément déjà en quarantaine (mis par le propriétaire) : « réanalyser » réécrit sa fiche et le registre de la
    // quarantaine — ce n'est pas une simple lecture, donc demandé au propriétaire ; l'élément reste en quarantaine.
    const q = await x.v.act('ullr', 'isoler', { fichier: menace }); assert.equal(q.ok, true, q.text);
    const id = (q.data as { id: string }).id;
    etapes.push(call('valhalla', { action: 'action', appli: 'ullr', quoi: 'reanalyser', entree: JSON.stringify({ id }) }), { text: 'fait' });
    const avant = x.o.approvals.length;
    await parler(x.o, MEMBRE, 'fake:sami');
    assert.equal(x.o.approvals.length, avant + 1, 'réanalyser : demandé au propriétaire');
    assert.ok((x.v.ctx('ullr').settings.quarantine as Array<{ id: string }>).some((e) => e.id === id), 'il reste en quarantaine');
  } finally { fin(x); }
});

test('produit — une conversation marquée d\'un membre ne passe pas ; « autonome » n\'élargit pas la liste', async () => {
  const x = odinAvecApplis([call('valhalla', { action: 'action', appli: 'aegir', quoi: 'jouer', entree: '{"quoi":"Radio du matin"}' }), { text: 'fait' }]);
  try {
    await x.v.act('aegir', 'radio', { nom: 'Radio du matin', adresse: 'http://127.0.0.1:9/flux' });
    await x.o.agent.run('étape d\'essai numéro un', { sessionId: 'fake:sami', channel: 'fake', peer: 'sami', speaker: MEMBRE, trusted: true, startTainted: true });
    assert.equal(x.o.approvals.length, 1, 'conversation marquée : demandé');
    assert.ok(!x.commandes.some((c) => c.startsWith('mpv')));
  } finally { fin(x); }
  const y = odinAvecApplis([call('fs_write', { path: 'notes.txt', content: 'écrasé' }), { text: 'fait' }]);
  try {
    writeFileSync(join(y.o.paths.workspace, 'notes.txt'), 'à moi');
    await y.o.agent.run('étape d\'essai numéro un', { sessionId: 'fake:sami', channel: 'fake', peer: 'sami', speaker: { ...MEMBRE, autonomy: 'autonome' }, trusted: true });
    assert.equal(y.o.approvals.length, 1, 'écraser un fichier : demandé, même pour un membre « autonome »');
    assert.equal(readFileSync(join(y.o.paths.workspace, 'notes.txt'), 'utf8'), 'à moi');
  } finally { fin(y); }
});
