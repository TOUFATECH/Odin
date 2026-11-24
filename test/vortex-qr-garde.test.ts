// Vortex · le QR code et le fichier de configuration d'un appareil du VPN, décisions du propriétaire (26/11) :
//  1. une tablette de l'écran de la maison, même « complet », ne les demande plus (« qr », « telecharger », et
//     « ajouter » quand il montrerait le QR code) ; elle garde le reste (ajouter sans montrer, changer le réseau) ;
//  2. les remontrer demande la validation d'Odin CÔTÉ SERVEUR (elle nomme l'appareil) : une demande faite hors de la
//     page ne passe pas sans elle ; la page pose sa question et passe l'accord (une seule question).
// Un vrai Odin d'essai (serveur web + applis), par les mêmes chemins que l'interface. Le tunnel reste éteint (carte
// factice) : aucune commande réseau. Adresses d'exemple seulement.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { setTunFactory } from '../src/valhalla/modules/gjoll.ts';
import { valhallaTool } from '../src/tools/valhalla.ts';

setTunFactory(async () => ({ write: () => {}, onPacket: () => {}, close: () => {} }));
const SECRET = /PrivateKey|PresharedKey|\[Interface\]|<svg/, SEUL = /seul le propriétaire/;
const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, complet: Record<string, string>;
const noms = () => ((valhallaOf()!.ctx('gjoll').settings.peers ?? []) as Array<{ name: string }>).map((p) => p.name);
const bouton = (id: string, confirm: boolean, qui?: Record<string, string>) => v.json('/api/maison/fenetre', { id, confirm }, qui);
const acte = (action: string, input: Record<string, unknown>, confirm?: boolean) => v.json('/api/valhalla/act', { module: 'gjoll', action, input, ...(confirm === undefined ? {} : { confirm }) });

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['var', 'gladsheim', 'gjoll', 'vidarr'].includes(m.id)) });
  const va = valhallaOf()!;
  va.ctx('gjoll').saveSettings({ server: { ...(va.ctx('gjoll').settings.server as object ?? {}), endpoint: '198.51.100.20', iface: 'wg-essai' } });
  assert.equal((await va.act('gjoll', 'ajouter', { nom: 'Téléphone 1', dns_odin: false, montrer: false })).ok, true);
  const b = (n: number, action: string, input: Record<string, unknown>) => ({ id: `b000000${n}`, kind: 'bouton', w: 1, module: 'gjoll', action, label: `B${n}`, input });
  const f = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify({ pages: [{ id: 'a1b2c3d4', name: 'Maison', maison: true, widgets: [
    b(1, 'qr', { nom: 'Téléphone 1' }), b(2, 'telecharger', { nom: 'Téléphone 1' }),
    b(3, 'ajouter', { nom: 'Tablette 3', dns_odin: false, montrer: true }), b(4, 'ajouter', { nom: 'Tablette 4', dns_odin: false }),
    b(5, 'ajouter', { nom: 'Tablette 5', dns_odin: false, montrer: false }),
  ] }] }) });
  assert.equal(f.ok, true, f.text);
  complet = { cookie: '', 'x-odin-maison': ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette salon', droits: 'complet' })).data as { key: string }).key };
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('décision 1 · une tablette « complet » : ni QR code, ni fichier, ni ajout qui montre le QR code ; rien n\'est créé, aucun secret, aucune validation proposée', async () => {
  const avant = noms();
  for (const id of ['b0000001', 'b0000002', 'b0000003', 'b0000004']) for (const confirm of [false, true]) {
    const r = await bouton(id, confirm, complet);
    assert.notEqual(r.body.ok, true, `${id} (confirm ${confirm}) : ${JSON.stringify(r.body)}`);
    assert.match(String(r.body.text), SEUL, `${id} : refus clair`); assert.match(String(r.body.text), /tablette « Tablette salon »/, 'le refus dit d\'où vient la demande');
    assert.equal(r.body.confirm, undefined, `${id} : pas de validation proposée à la tablette (elle ne mènerait qu'au refus)`);
    assert.doesNotMatch(JSON.stringify(r.body), SECRET);
  }
  assert.deepEqual(noms(), avant, 'aucun appareil créé');
  // Le refus est noté « qui a fait quoi » : le propriétaire voit d'où venait la demande.
  const j = await acte('qui_a_fait', {});
  assert.match(String(j.body.text), /QR code.*pas fait.*Refusé depuis tablette « Tablette salon »/); assert.doesNotMatch(JSON.stringify(j.body), SECRET);
});

test('décision 1 · la tablette « complet » garde le reste : ajouter un appareil sans montrer son QR code (avec la validation), aucune clé rendue', async () => {
  const q = await bouton('b0000005', false, complet);
  assert.notEqual(q.body.ok, true, JSON.stringify(q.body)); assert.match(String(q.body.confirm), /ouvrir l'accès VPN à « Tablette 5 »/, JSON.stringify(q.body)); assert.ok(!noms().includes('Tablette 5'));
  const r = await bouton('b0000005', true, complet);
  assert.equal(r.body.ok, true, JSON.stringify(r.body)); assert.ok(noms().includes('Tablette 5')); assert.doesNotMatch(JSON.stringify(r.body), SECRET);
});

test('décision 1 · quel que soit le chemin pris depuis une tablette (bouton, outil de l\'IA) : Vortex refuse avant de lire quoi que ce soit', async () => {
  const va = valhallaOf()!, { parTablette } = await import('../src/valhalla/gjoll/session.ts');
  for (const [a, i] of [['qr', { nom: 'Téléphone 1' }], ['telecharger', { nom: 'Téléphone 1' }], ['ajouter', { nom: 'Tablette 6', dns_odin: false, montrer: true }]] as const) {
    const r = await parTablette.run('tablette « Entrée »', () => va.act('gjoll', a, { ...i }, { by: 'toi' }));
    assert.equal(r.ok, false, a); assert.match(r.text, SEUL); assert.doesNotMatch(JSON.stringify(r), SECRET);
    assert.equal(parTablette.run('tablette « Entrée »', () => va.action('gjoll', a)!.a.grave?.({ ...i }, va.ctx('gjoll'))), undefined, `${a} : pas de validation depuis une tablette`);
    const t = String(await parTablette.run('tablette « Entrée »', () => valhallaTool.run({ action: 'action', appli: 'gjoll', quoi: a, entree: { ...i } }, { auteur: { role: 'owner' }, isTainted: () => false, sessionId: 'web:maison' } as never)));
    assert.match(t, SEUL, `outil de l'IA · ${a}`); assert.doesNotMatch(t, SECRET);
  }
  assert.ok(!noms().includes('Tablette 6'));
  // Hors d'une tablette, rien ne change pour le propriétaire : la même demande passe.
  assert.equal((await va.act('gjoll', 'telecharger', { nom: 'Téléphone 1' }, { by: 'toi' })).ok, true);
});

test('décision 2 · le propriétaire, sa session : « qr » et « telecharger » ne partent pas sans la validation d\'Odin, qui nomme l\'appareil ; avec elle, il reçoit sa configuration', async () => {
  for (const [a, phrase] of [['qr', /^Confirmer : remontrer le QR code de « Téléphone 1 » \(.*clé secrète.*\) \?$/], ['telecharger', /^Confirmer : remettre le fichier de configuration de « Téléphone 1 » \(.*clé secrète.*\) \?$/]] as const) {
    for (const sans of [undefined, false, 'true', 1] as const) {
      const r = await v.json('/api/valhalla/act', { module: 'gjoll', action: a, input: { nom: 'Téléphone 1' }, ...(sans === undefined ? {} : { confirm: sans }) });
      assert.notEqual(r.body.ok, true, `${a} sans accord (${String(sans)}) : ${JSON.stringify(r.body).slice(0, 200)}`);
      assert.match(String(r.body.confirm), phrase); assert.doesNotMatch(JSON.stringify(r.body), SECRET, 'rien avant son accord');
    }
    const r = await acte(a, { nom: 'Téléphone 1' }, true);
    assert.equal(r.body.ok, true, JSON.stringify(r.body).slice(0, 200)); assert.match(JSON.stringify(r.body), /PrivateKey/);
    if (a === 'qr') assert.equal((r.body.data as { secret?: boolean }).secret, true, 'la réponse est marquée secrète (la page générique la voile)');
    else assert.match(String((r.body.data as { conf?: string }).conf), /^PrivateKey = /m, 'le fichier : reconnu secret à sa clé privée par la page générique');
  }
  // Une demande sans accord ne lit rien et ne laisse pas de ligne « fait » dans le journal.
  const lignes = (t: string) => t.split('\n').filter((l) => /QR code \(nom : Téléphone 1\) · fait/.test(l)).length, avant = lignes(String((await acte('qui_a_fait', {})).body.text));
  assert.ok(avant >= 1, 'la demande validée est notée');
  await acte('qr', { nom: 'Téléphone 1' });
  assert.equal(lignes(String((await acte('qui_a_fait', {})).body.text)), avant);
});

test('décision 2 · par une phrase, par un bouton de l\'écran de la maison, par l\'outil de l\'IA : la même validation, jamais contournée', async () => {
  const p = await v.json('/api/valhalla/order', { text: 'qr code vpn de Téléphone 1' });
  if (p.body.kind === 'action') { assert.notEqual(p.body.ok, true, JSON.stringify(p.body)); assert.match(String(p.body.confirm), /Téléphone 1/); }
  assert.doesNotMatch(JSON.stringify(p.body), SECRET);
  // Le propriétaire, sa session, sur l'écran de la maison : la validation d'abord ; ensuite le texte seul (jamais la clé).
  const b0 = await bouton('b0000001', false);
  assert.notEqual(b0.body.ok, true); assert.match(String(b0.body.confirm), /remontrer le QR code de « Téléphone 1 »/);
  const b1 = await bouton('b0000001', true);
  assert.equal(b1.body.ok, true, JSON.stringify(b1.body)); assert.doesNotMatch(JSON.stringify(b1.body), SECRET);
  // L'outil de l'IA : l'action est « grave » pour lui aussi (l'accord du propriétaire est demandé).
  assert.match(String(valhallaTool.grave?.({ action: 'action', appli: 'gjoll', quoi: 'qr', entree: { nom: 'Téléphone 1' } })), /remontrer le QR code de « Téléphone 1 »/);
});

test('décision 2 · « ajouter » garde sa validation (elle existait) ; la page de Vortex passe l\'accord avec chaque demande de QR code ou de fichier', async () => {
  const r = await acte('ajouter', { nom: 'Portable 8', dns_odin: false, montrer: true });
  assert.notEqual(r.body.ok, true); assert.match(String(r.body.confirm), /ouvrir l'accès VPN à « Portable 8 »/); assert.ok(!noms().includes('Portable 8'));
  const page = readFileSync(new URL('../src/web/pages/vortex-ajouter.js', import.meta.url), 'utf8');
  assert.match(page, /demander\('qr', \{ nom \}, true\)/); assert.match(page, /demander\('telecharger', \{ nom \}, true\)/);
  assert.doesNotMatch(page, /demander\('(qr|telecharger)', \{ nom \}(, false)?\)/, 'aucune demande sans l\'accord : une seule question pour le propriétaire');
});
