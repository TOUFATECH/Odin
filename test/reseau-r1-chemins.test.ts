// Réseau, lot R1 : les AUTRES CHEMINS vers Vortex (VPN) et Sphinx (DNS, DHCP) passent par la même garde « propriétaire
// seul ». Un vrai Odin d'essai (serveur web + applis), par le même chemin que l'interface : un membre de la famille
// connecté par Persona (même avec le droit sur ces applis), une tablette « maison », la clé d'API (Authorization: Bearer),
// un appel sans session, l'outil de l'IA (un membre qui écrit sur Telegram), Talos (automatisation), un autre assistant
// (MCP) et un lien entre applis lancé sans le propriétaire. Le propriétaire, depuis sa session, réussit. « Qui est
// connecté sur le VPN » : un membre ne voit que ses appareils (« avec mes droits »). Aucun secret (clé privée,
// configuration, QR code) ne part vers quelqu'un d'autre que le propriétaire.
// Aucun vrai changement réseau : le tunnel reste éteint (carte factice), aucun serveur DNS ni DHCP n'est allumé.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, moduleDep, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { setTunFactory } from '../src/valhalla/modules/gjoll.ts';
import { serverHandle } from '../src/valhalla/mcp.ts';
import { valhallaTool } from '../src/tools/valhalla.ts';
import { entree, REFUS, SPHINX, VORTEX } from './reseau-r1-commun.ts';

setTunFactory(async () => ({ write: () => {}, onPacket: () => {}, close: () => {} }));
const MDP = 'un-sentier-de-sable-sous-les-pins-31';
const IDS = ['var', 'gladsheim', 'gjoll', 'vidarr'];
/** Celles qui allumeraient un serveur ou parleraient à la box : jamais lancées ici, même par le propriétaire. */
const JAMAIS = new Set(['ouvrir_port', 'fermer_port', 'detecter', 'allumer', 'eteindre', 'serveur', 'demarrer', 'arreter', 'ajouter_liste', 'activer_liste', 'retirer_liste', 'mettre_a_jour', 'dhcp_demarrer', 'dhcp_arreter', 'dns_chiffre', 'reglages', 'pubs_reseaux', 'horaires', 'dhcp_mode', 'dhcp_reglages']);
const SECRET = /PrivateKey|PresharedKey|\[Interface\]/;

const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, membre = '', cleMaison = '';
const etatReseau = () => JSON.stringify([valhallaOf()!.ctx('gjoll').settings.peers ?? [], valhallaOf()!.ctx('vidarr').settings]);

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) });
  const va = valhallaOf()!;
  // Un membre de la famille qui a le droit sur Odin, Vortex et Sphinx (le cas le plus large).
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-a', nom: 'Membre A', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gjoll', 'vidarr']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-a' })).ok, true);
  lierProprietaire(persona()!);
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' });
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: 'membre-a', motdepasse: MDP }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' });
  membre = r.headers.getSetCookie().find((c) => c.startsWith('odin_session='))?.split(';')[0] ?? '';
  // Un appareil VPN du propriétaire (le tunnel reste éteint) et une tablette « maison » avec deux boutons réseau sur sa page.
  va.ctx('gjoll').saveSettings({ server: { ...(va.ctx('gjoll').settings.server as object ?? {}), endpoint: '198.51.100.20', iface: 'wg-essai' } });
  assert.equal((await va.act('gjoll', 'ajouter', { nom: 'Téléphone 1', dns_odin: false })).ok, true);
  const f = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify({ pages: [{ id: 'a1b2c3d4', name: 'Maison', maison: true, widgets: [
    { id: 'b0000001', kind: 'bouton', w: 1, module: 'vidarr', action: 'bloquer', label: 'Bloquer', input: { domaine: 'tablette.example.com' } },
    { id: 'b0000002', kind: 'bouton', w: 1, module: 'gjoll', action: 'qr', label: 'QR', input: { nom: 'Téléphone 1' } },
    { id: 'b0000003', kind: 'bouton', w: 1, module: 'vidarr', action: 'nom_local', label: 'Nom', input: { nom: 'banque.example.com', valeur: '203.0.113.66' } },
  ] }] }) });
  assert.equal(f.ok, true, f.text);
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette entrée', droits: 'maison' })).data as { key: string }).key;
  assert.ok(membre && cleMaison);
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('un membre de la famille (même avec le droit sur Vortex et Sphinx) : chaque action qui change le réseau est refusée, aucun secret', async () => {
  const avant = etatReseau(), passe: string[] = [];
  for (const [m, ids] of [['gjoll', VORTEX], ['vidarr', SPHINX]] as const) for (const id of ids) {
    if (JAMAIS.has(id)) continue; // jamais lancée ici, même si la garde avait un trou (sa garde est vérifiée dans reseau-r1-garde)
    for (const confirm of [false, true]) {
      const r = await v.json('/api/valhalla/act', { module: m, action: id, input: entree(id), confirm }, { cookie: membre });
      if (r.status !== 403 && r.body.ok !== false) passe.push(`${m}.${id} (confirm ${confirm}) → ${r.status}`);
      if (SECRET.test(JSON.stringify(r.body))) passe.push(`${m}.${id} : secret rendu`);
    }
  }
  assert.deepEqual(passe, [], 'tout est refusé au membre');
  assert.equal(etatReseau(), avant, 'rien n\'a changé dans le VPN ni dans le DNS/DHCP');
});

test('« qui est connecté sur le VPN » : le propriétaire voit tout, un membre seulement ses appareils', async () => {
  const p = await v.json('/api/valhalla/order', { text: 'qui est connecté sur le vpn' });
  assert.match(String(p.body.text), /Téléphone 1/, `le propriétaire voit son appareil : ${JSON.stringify(p.body)}`);
  const m = await v.json('/api/valhalla/order', { text: 'qui est connecté sur le vpn' }, { cookie: membre });
  assert.doesNotMatch(JSON.stringify(m.body), /Téléphone 1|10\.8\.0\./, 'le membre ne voit pas les appareils des autres');
  const a = await v.json('/api/valhalla/act', { module: 'gjoll', action: 'appareils', input: {} }, { cookie: membre });
  assert.doesNotMatch(JSON.stringify(a.body), /Téléphone 1|10\.8\.0\./);
  assert.match(String(a.body.text), /aucun appareil/i, 'il lit bien la liste, vide pour lui');
});

test('une tablette « maison » : un bouton réseau de sa page est refusé (bloquer un nom, montrer un QR code, détourner un nom)', async () => {
  const avant = etatReseau();
  for (const id of ['b0000001', 'b0000002', 'b0000003']) {
    for (const confirm of [false, true]) {
      const r = await v.json('/api/maison/fenetre', { id, confirm }, { cookie: '', 'x-odin-maison': cleMaison });
      assert.notEqual(r.body.ok, true, `${id} : ${JSON.stringify(r.body)}`);
      assert.doesNotMatch(JSON.stringify(r.body), SECRET);
    }
  }
  assert.equal(etatReseau(), avant);
});

test('la clé d\'API (Authorization: Bearer) : refusée pour les actions qui changent le réseau, par le bouton comme par une phrase ; aucun secret', async () => {
  const avant = etatReseau(), cle = { authorization: `Bearer ${v.token}` }, passe: string[] = [];
  for (const [m, ids] of [['gjoll', VORTEX], ['vidarr', SPHINX]] as const) for (const id of ids) {
    if (JAMAIS.has(id)) continue; // jamais lancée ici, même si la garde avait un trou
    const r = await v.json('/api/valhalla/act', { module: m, action: id, input: entree(id), confirm: true }, cle);
    if (r.body.ok !== false) passe.push(`${m}.${id} → ${r.status} ${String(r.body.text ?? '').slice(0, 80)}`);
    if (SECRET.test(JSON.stringify(r.body))) passe.push(`${m}.${id} : secret rendu`);
  }
  assert.deepEqual(passe, [], 'tout est refusé à la clé');
  const o = await v.json('/api/valhalla/order', { text: 'bloque le site cle.example.com', confirm: true }, cle);
  assert.notEqual(o.body.ok, true, JSON.stringify(o.body));
  assert.equal(etatReseau(), avant, 'rien n\'a changé');
  // La même phrase depuis la session du propriétaire passe (elle est bien comprise).
  const p = await v.json('/api/valhalla/order', { text: 'bloque le site cle.example.com', confirm: true });
  assert.equal(p.body.ok, true, JSON.stringify(p.body));
  assert.match(etatReseau(), /cle\.example\.com/);
  assert.equal((await v.json('/api/valhalla/act', { module: 'vidarr', action: 'autoriser', input: { domaine: 'cle.example.com' } })).body.ok, true);
});

test('sans session : refusé', async () => {
  const avant = etatReseau();
  for (const [m, id] of [['vidarr', 'bloquer'], ['gjoll', 'qr'], ['gjoll', 'revoquer']]) {
    const r = await v.json('/api/valhalla/act', { module: m, action: id, input: entree(id), confirm: true }, { cookie: '' });
    assert.ok(r.status === 401 || r.status === 403, `${m}.${id} → ${r.status}`); assert.doesNotMatch(JSON.stringify(r.body), SECRET);
  }
  assert.equal(etatReseau(), avant);
});

test('l\'outil de l\'IA (un membre sur Telegram, une conversation marquée), Talos, un autre assistant (MCP) et un lien entre applis : refusés', async () => {
  const va = valhallaOf()!, avant = etatReseau(), passe: string[] = [];
  const outil = (role: 'member' | 'owner', marque: boolean, appli: string, quoi: string) => valhallaTool.run({ action: 'action', appli, quoi, entree: entree(quoi) }, { auteur: { role }, isTainted: () => marque, sessionId: 'telegram:essai' } as never);
  for (const [m, ids] of [['gjoll', VORTEX], ['vidarr', SPHINX]] as const) for (const id of ids) {
    if (JAMAIS.has(id)) continue;
    for (const [qui, role, marque] of [['membre (Telegram)', 'member', false], ['conversation marquée', 'owner', true]] as const) { const t = String(await outil(role, marque, m, id)); if (!REFUS.test(t)) passe.push(`outil de l'IA, ${qui} · ${m}.${id} : ${t.slice(0, 80)}`); }
    const d = await moduleDep(m, id, entree(id)); if (!REFUS.test(d.text)) passe.push(`Talos · ${m}.${id} : ${d.text.slice(0, 80)}`);
    const mcp = await serverHandle(va, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: `odin_${m}`, arguments: { action: id, entree: entree(id) } } } as never, () => '') as { result?: { content: Array<{ text: string }> } };
    const mt = mcp.result?.content[0]?.text ?? ''; if (!REFUS.test(mt)) passe.push(`MCP · ${m}.${id} : ${mt.slice(0, 80)}`);
    const l = await va.ctx(m === 'gjoll' ? 'vidarr' : 'gjoll').call(m, id, entree(id), 'lien d\'essai'); if (!REFUS.test(l.text)) passe.push(`lien entre applis · ${m}.${id} : ${l.text.slice(0, 80)}`);
  }
  assert.deepEqual(passe, [], 'tout passe par la garde');
  assert.equal(etatReseau(), avant, 'rien n\'a changé');
});

test('le propriétaire, depuis sa session : il change le réseau, reçoit son QR code, et lit le journal « qui a fait quoi »', async () => {
  const b = await v.json('/api/valhalla/act', { module: 'vidarr', action: 'bloquer', input: { domaine: 'proprio.example.com' } });
  assert.equal(b.body.ok, true, JSON.stringify(b.body));
  // Décision du 26/11 : remontrer un QR code demande la validation d'Odin côté serveur (elle nomme l'appareil).
  const q0 = await v.json('/api/valhalla/act', { module: 'gjoll', action: 'qr', input: { nom: 'Téléphone 1' } });
  assert.notEqual(q0.body.ok, true); assert.match(String(q0.body.confirm), /QR code de « Téléphone 1 »/); assert.doesNotMatch(JSON.stringify(q0.body), SECRET, 'rien avant son accord');
  const q = await v.json('/api/valhalla/act', { module: 'gjoll', action: 'qr', input: { nom: 'Téléphone 1' }, confirm: true });
  assert.equal(q.body.ok, true); assert.match(JSON.stringify(q.body), /PrivateKey/, 'le propriétaire reçoit sa configuration');
  const j = await v.json('/api/valhalla/act', { module: 'vidarr', action: 'qui_a_fait', input: {} });
  assert.match(String(j.body.text), /Bloquer un domaine/); assert.match(String(j.body.text), /propriétaire/);
  const jv = await v.json('/api/valhalla/act', { module: 'gjoll', action: 'qui_a_fait', input: {} });
  assert.match(String(jv.body.text), /QR code/); assert.doesNotMatch(JSON.stringify(jv.body), SECRET);
  // Le journal reste au propriétaire.
  assert.notEqual((await v.json('/api/valhalla/act', { module: 'gjoll', action: 'qui_a_fait', input: {} }, { cookie: membre })).body.ok, true);
});

// Relecture du lot R1 (réponses du 23/11).
const coupee = (ip: string) => (((valhallaOf()!.ctx('vidarr').settings.dns as { clients?: unknown } | undefined)?.clients as Array<{ ids: string[]; cut?: boolean }> | undefined) ?? []).some((c) => c.ids.includes(ip) && c.cut === true);

test('une tablette « complet » garde le droit de changer le réseau, mais ne demande plus un QR code VPN (décision du 26/11)', async () => {
  const va = valhallaOf()!, cleComplet = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette salon', droits: 'complet' })).data as { key: string }).key;
  for (const confirm of [false, true]) {
    const r = await v.json('/api/maison/fenetre', { id: 'b0000002', confirm }, { cookie: '', 'x-odin-maison': cleComplet });
    assert.notEqual(r.body.ok, true, `QR code (confirm ${confirm}) : ${JSON.stringify(r.body)}`);
    assert.match(String(r.body.text), REFUS); assert.doesNotMatch(JSON.stringify(r.body), SECRET);
  }
  const r = await v.json('/api/maison/fenetre', { id: 'b0000001', confirm: true }, { cookie: '', 'x-odin-maison': cleComplet });
  assert.equal(r.body.ok, true, `bloquer un nom : ${JSON.stringify(r.body)}`);
  assert.match(etatReseau(), /tablette\.example\.com/);
  assert.equal((await va.act('vidarr', 'autoriser', { domaine: 'tablette.example.com' })).ok, true);
});

test('la quarantaine automatique (réflexe de sécurité de Hydre) coupe une machine d\'Internet toute seule ; rien d\'autre ne passe par cette porte', async () => {
  const va = valhallaOf()!, ip = '10.0.0.178', reflexe = { by: 'réflexe' as const, why: 'quarantaine de essai', de: 'ymir' };
  // Jamais rouvrir, jamais par une autre appli, jamais par une automatisation, un membre ou une conversation marquée.
  for (const [qui, a, o] of [
    ['rouvrir', 'retablir_machine', reflexe], ['une autre appli', 'couper_machine', { ...reflexe, de: 'gladsheim' }], ['une automatisation', 'couper_machine', { ...reflexe, auto: true }],
    ['un membre', 'couper_machine', { ...reflexe, qui: 'member' as const }], ['une conversation marquée', 'couper_machine', { ...reflexe, marque: true }], ['une étape interne', 'couper_machine', { by: 'toi' as const, de: 'ymir' }],
  ] as const) assert.match((await va.act('vidarr', a, { ip }, o)).text, REFUS, qui);
  assert.equal(coupee(ip), false);
  const r = await va.act('vidarr', 'couper_machine', { ip, nom: 'Machine essai' }, reflexe);
  assert.equal(r.ok, true, r.text); assert.equal(coupee(ip), true, 'coupée d\'Internet');
  const m = va.manips({ limit: 20 }).find((x) => x.module === 'vidarr' && x.state === 'à décider' && x.undo?.action === 'retablir_machine');
  assert.ok(m, 'notée comme une manip : le propriétaire peut annuler');
  // La clé d'API (bouton et phrase) et une phrase venue d'une appli (la voix) ne la rouvrent pas.
  const cle = { authorization: `Bearer ${v.token}` };
  assert.notEqual((await v.json('/api/valhalla/manip', { id: m.id, keep: false, confirm: true }, cle)).body.ok, true);
  assert.notEqual((await v.json('/api/valhalla/order', { text: `annule ${m.id}`, confirm: true }, cle)).body.ok, true);
  await va.ctx('gladsheim').order(`annule ${m.id}`);
  assert.equal(coupee(ip), true, 'toujours coupée');
  // Le propriétaire, depuis sa session, la rouvre.
  const p = await v.json('/api/valhalla/manip', { id: m.id, keep: false, confirm: true });
  assert.equal(p.body.ok, true, JSON.stringify(p.body)); assert.equal(coupee(ip), false);
});
