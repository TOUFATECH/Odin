// Genèse (thjalfi) : qui peut faire quoi. Tout ce qui écrit, efface, lance, autorise ou touche à un secret est au
// propriétaire seul : un membre de la famille qui a le droit sur Genèse, une tablette « maison » ou la clé d'API ne
// réinstallent pas un PC (son disque est effacé), n'éteignent pas le serveur de démarrage, ne déposent pas de clé, ne
// décident pas d'une demande « Installer pour moi »… et ne peuvent pas non plus en faire une demande au propriétaire.
// Les lectures sans secret restent ouvertes. Une tablette « complet » garde les droits du propriétaire.
// Dossiers temporaires neufs, aucun réseau, aucun serveur de démarrage lancé (jamais « allumer »).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import * as T from '../src/valhalla/modules/thjalfi.ts';
import type { Action, Module } from '../src/valhalla/types.ts';
import type { AgentEvent } from '../src/types.ts';

const X = T as unknown as Record<string, () => Module>;
const dossiers: string[] = [];
const neuf = (n: string) => { const d = mkdtempSync(join(tmpdir(), `odin-thjalfi-droits-${n}-`)); dossiers.push(d); return d; };
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

const MAC = '52:54:00:12:34:56';
const regle = { mac: MAC, auto: true, fait: true, profil: 'standard', ajoute: 1 };
const seul = (a: Action) => a.proprietaireSeul === true || typeof a.proprietaireSeul === 'function';

// Les lectures sans secret, laissées à qui a le droit sur Genèse (aucune n'écrit ni ne lance rien).
const LECTURES_OUVERTES = ['etat', 'isos', 'machines', 'tableau', 'historique', 'suivi', 'poste', 'rapport'];
// Ce que l'essai essaie au nom d'un membre, avec des réglages qui marcheraient pour le propriétaire.
// Au propriétaire seul, quel que soit l'appelant (membre, tablette « maison », clé d'API, automatisation, Odin seul).
const GESTES_PROPRIO: Array<[string, Record<string, unknown>]> = [
  ['decider', { id: 'x', accord: 'oui' }], ['reinstaller', { mac: MAC }], ['eteindre', {}], ['preparer', {}], ['iso_par_defaut', { iso: 'disque' }],
  ['profil', { nom: 'Pirate', utilisateur: 'pirate' }], ['partage_windows', { unc: '\\\\nas\\iso', dossier: '/mnt/x', mot_de_passe: 'secret' }],
  ['preparer_windows', { iso: 'win' }], ['cle_windows', { edition: 'Windows 11 Pro', cle: 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE' }],
  ['retirer_cle_windows', { edition: 'Windows 11 Pro' }], ['ecran', { actif: false }], ['delai_abandon', { minutes: 10 }],
];
// Le suivi : jamais par un membre ; une automatisation peut renforcer (bloquer, suspendre), ce qui affaiblit reste une
// action grave qui demande l'accord du propriétaire (règle déjà essayée dans genese-suivi*.test.ts).
const GESTES_SUIVI: Array<[string, Record<string, unknown>]> = [
  ['bloquer', { mac: MAC }], ['debloquer', { mac: MAC }], ['annuler', { mac: MAC }], ['suspendre', {}], ['reprendre', {}],
  ['mot_de_passe', { mot_de_passe: 'une-phrase-longue-42' }], ['retirer_mot_de_passe', {}],
];
const GESTES = [...GESTES_PROPRIO, ...GESTES_SUIVI];

test('Genèse : chaque action qui écrit, efface, lance, autorise ou touche à un secret est au propriétaire seul', () => {
  const m = X.thjalfi();
  const ouvertes = m.actions.filter((a) => !seul(a)).map((a) => a.id).sort();
  assert.deepEqual(ouvertes, [...LECTURES_OUVERTES].sort(), 'seules des lectures sans secret restent ouvertes');
  for (const id of LECTURES_OUVERTES) assert.equal(m.actions.find((a) => a.id === id)?.read, true, `${id} est une lecture`);
  for (const [id] of GESTES) assert.ok(m.actions.some((a) => a.id === id), `${id} existe`);
});

test('Genèse : un membre, une automatisation, Odin seul ou la clé d\'API ne réinstallent ni n\'éteignent rien', async () => {
  const { Valhalla } = await import('../src/valhalla/service.ts');
  const { setValhalla } = await import('../src/valhalla/odin.ts');
  const { valhallaPost } = await import('../src/web/valhalla-api.ts');
  const home = neuf('va');
  const v = new Valhalla(home, [X.thjalfi()], { fetch: (async () => { throw new Error('aucun réseau'); }) as never, run: async () => ({ code: 1, out: '', err: 'aucune commande' }), notify: async () => {} });
  try {
    await v.activer('thjalfi', true);
    v.ctx('thjalfi').saveSettings({ machines: [{ ...regle }], allume: true, defaut: 'local' });
    const fait = () => (v.ctx('thjalfi').settings.machines as Array<{ fait?: boolean }>)[0].fait;
    for (const qui of [{ qui: 'member' as const }, { qui: 'guest' as const }, { auto: true }, { by: 'odin' as const }]) {
      for (const [id, input] of GESTES_PROPRIO) {
        const r = await v.act('thjalfi', id, input, qui);
        assert.equal(r.ok, false, `${id} refusé (${JSON.stringify(qui)}) : ${r.text}`); assert.match(r.text, /propriétaire/, id);
      }
    }
    assert.equal(fait(), true, 'la machine n\'est pas remise en réinstallation (son disque n\'est pas effacé)');
    assert.equal(v.ctx('thjalfi').settings.allume, true, 'Genèse n\'est pas éteint');
    // La clé d'API (sans la session du propriétaire), même en confirmant l'action grave.
    setValhalla(v);
    const api = await valhallaPost('/api/valhalla/act', { module: 'thjalfi', action: 'reinstaller', input: { mac: MAC }, confirm: true }) as { ok: boolean; code?: string };
    assert.equal(api.ok, false); assert.equal(api.code, 'proprietaire');
    const api2 = await valhallaPost('/api/valhalla/act', { module: 'thjalfi', action: 'eteindre', input: {} }) as { ok: boolean; code?: string };
    assert.equal(api2.ok, false); assert.equal(api2.code, 'proprietaire');
    assert.equal(fait(), true); assert.equal(v.ctx('thjalfi').settings.allume, true);
    // Le propriétaire, lui, réinstalle et éteint.
    const p = await valhallaPost('/api/valhalla/act', { module: 'thjalfi', action: 'reinstaller', input: { mac: MAC }, confirm: true }, { sessionProprio: true }) as { ok: boolean; text: string };
    assert.equal(p.ok, true, p.text); assert.equal(fait(), false);
    const e = await valhallaPost('/api/valhalla/act', { module: 'thjalfi', action: 'eteindre', input: {} }, { sessionProprio: true }) as { ok: boolean; text: string };
    assert.equal(e.ok, true, e.text); assert.equal(v.ctx('thjalfi').settings.allume, false);
    // Les lectures restent à un membre.
    for (const id of ['etat', 'machines', 'historique']) assert.notEqual((await v.act('thjalfi', id, {}, { qui: 'member' })).ok, false, id);
  } finally { v.stop(); }
});

test('Genèse par l\'interface : un membre ne réinstalle ni n\'en fait la demande ; tablette « maison » refusée, « complet » comme le propriétaire', async () => {
  const { T: Banc } = await import('./banc/lib.ts');
  const { vraiOdin } = await import('./banc/odin-vrai.ts');
  const { allModules, valhallaOf } = await import('../src/valhalla/odin.ts');
  const { lierProprietaire, persona } = await import('../src/valhalla/sso/etat.ts');
  const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  try {
    const od = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['var', 'gladsheim', 'thjalfi'].includes(m.id)) });
    const va = valhallaOf()!;
    // Les demandes de validation qui arriveraient au propriétaire (comme ses boutons Autoriser / Refuser).
    od.o.cfg.policy.approvalTimeoutSec = 2;
    const recues: string[] = [];
    const ev = od.web.event.bind(od.web);
    od.web.event = (peer: string, e: AgentEvent) => { if (e.type === 'approval') recues.push(String((e as unknown as { summary: string }).summary)); ev(peer, e); };
    await va.activer('thjalfi', true);
    va.ctx('thjalfi').saveSettings({ machines: [{ ...regle }], allume: true });
    const fait = () => (va.ctx('thjalfi').settings.machines as Array<{ fait?: boolean }>)[0].fait;
    // Un membre de la famille qui a le droit d'entrer dans Odin et sur Genèse.
    const MDP = 'une-barque-lente-au-bord-du-lac-62';
    assert.equal((await va.act('var', 'ajouter', { login: 'membre-g', nom: 'Membre G', groupes: 'invite', mot_de_passe: MDP })).ok, true);
    for (const appli of ['odin', 'thjalfi']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-g' })).ok, true);
    lierProprietaire(persona()!);
    const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
    let r = await fetch(`${od.url}/sso/odin`, { redirect: 'manual' });
    r = await fetch(new URL(r.headers.get('location')!, od.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
    r = await fetch(`${od.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: od.url }, body: new URLSearchParams({ demande, identifiant: 'membre-g', motdepasse: MDP }) });
    r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); const membre = cookieDe(r, 'odin_session'); assert.ok(membre, 'session du membre');
    const commeMembre = (action: string, input: Record<string, unknown> = {}) => od.json('/api/valhalla/act', { module: 'thjalfi', action, input }, { cookie: membre });
    for (const [id, input] of GESTES) {
      const m = await commeMembre(id, input);
      assert.equal(m.status, 403, `${id} : ${JSON.stringify(m.body).slice(0, 200)}`); assert.equal(m.body.code, 'reserve', id);
      assert.notEqual(m.body.demande, true, `${id} : aucune demande au propriétaire (${String(m.body.text).slice(0, 120)})`);
    }
    assert.deepEqual(recues, [], 'aucune demande de validation n\'est partie chez le propriétaire');
    assert.equal(fait(), true, 'le disque n\'est pas remis à effacer'); assert.equal(va.ctx('thjalfi').settings.allume, true, 'Genèse n\'est pas éteint');
    // La lecture reste au membre.
    const etat = await commeMembre('etat'); assert.equal(etat.status, 200, JSON.stringify(etat.body).slice(0, 200));
    // Les tablettes : un bouton « Éteindre Genèse » posé par le propriétaire.
    const tuile = ((await va.act('gladsheim', 'bouton', { appli: 'thjalfi', action: 'eteindre', reglages: '', nom: 'Éteindre Genèse' })).data as { id: string }).id;
    assert.ok(tuile, 'bouton posé');
    const cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
    const cleComplet = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette complet', droits: 'complet' })).data as { key: string }).key;
    const tm = await od.json('/api/maison/bouton', { id: tuile }, { cookie: '', 'x-odin-maison': cleMaison });
    assert.notEqual(tm.body.ok, true, `tablette « maison » refusée : ${JSON.stringify(tm.body).slice(0, 200)}`);
    assert.match(String(tm.body.text), /propriétaire/, String(tm.body.text));
    assert.equal(va.ctx('thjalfi').settings.allume, true, 'la tablette « maison » n\'a pas éteint Genèse');
    const tc = await od.json('/api/maison/bouton', { id: tuile }, { cookie: '', 'x-odin-maison': cleComplet });
    assert.equal(tc.body.ok, true, `tablette « complet » comme le propriétaire : ${JSON.stringify(tc.body).slice(0, 200)}`);
    assert.equal(va.ctx('thjalfi').settings.allume, false);
    // Le propriétaire, depuis sa session : la réinstallation (action grave, confirmée).
    const p = await od.json('/api/valhalla/act', { module: 'thjalfi', action: 'reinstaller', input: { mac: MAC }, confirm: true });
    assert.equal(p.body.ok, true, JSON.stringify(p.body).slice(0, 200)); assert.equal(fait(), false);
  } finally { await tt.end(); Object.assign(console, orig); }
});
