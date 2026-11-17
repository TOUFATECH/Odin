// Personne ne s'élève lui-même : seul le propriétaire change les droits des personnes. Donner un droit passe par sa
// validation (elle montre pour qui, quoi, avant → après) ; limiter s'applique tout de suite quand c'est lui qui le
// demande. Un membre de Persona (même avec l'accès à l'appli Persona), une automatisation, un réflexe, Odin seul ou une
// conversation marquée ne changent aucun droit. Un vrai Odin (serveur web + applis), par le MÊME chemin que l'interface.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { T } from './banc/lib.ts';
import { vraiOdin, COMPTE, type VraiOdin } from './banc/odin-vrai.ts';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { clients, groupesDe, lierProprietaire, persona, personnes } from '../src/valhalla/sso/etat.ts';
import type { Module } from '../src/valhalla/types.ts';
import { valhallaTool } from '../src/tools/valhalla.ts';

const MDP = 'cerf-volant-bleu-sur-la-colline-31';
const IDS = ['var', 'brisingamen', 'freyja', 'garmr', 'valgrind', 'hlid', 'agora'];
/**
 * Une appli d'essai qui en appelle une autre « en interne » (comme Agora appelle Persona) : `relayer` n'a pas de
 * validation à elle, `relayer_valide` en a une (elle couvre l'appel qu'elle fait).
 */
const relais: Module = {
  id: 'relais', name: 'Relais', family: 'Accès', what: 'essai', does: [], from: [], upstream: [], words: [], view: () => ({ sections: [] }),
  actions: [
    { id: 'relayer', label: 'Relayer', what: 'essai', run: async (ctx, i) => ctx.call('var', 'modifier', i, 'essai', { interne: true }) },
    { id: 'relayer_valide', label: 'Relayer (validé)', what: 'essai', grave: (i) => `groupes de ${String(i.login)} : ${String(i.groupes)}`, run: async (ctx, i) => ctx.call('var', 'modifier', i, 'essai', { interne: true }) },
    // Montre une validation anodine, puis, plus tard (minuteur, l'action est finie), demande autre chose.
    { id: 'anodin', label: 'Anodin', what: 'essai', grave: () => 'renommer un réglage', run: async (ctx, i) => { plusTard = new Promise((ok) => { setTimeout(() => { ctx.call('var', 'modifier', i, 'plus tard', { interne: true }).then(ok, ok); }, 30); }); return { text: 'ok' }; } },
  ],
};
let plusTard: Promise<unknown> | undefined;
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';

/** La connexion d'une personne de Persona à l'interface d'Odin, comme un navigateur : rend le cookie de sa session. */
async function entrer(v: VraiOdin, ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const html = await r.text(), demande = /name="demande" value="([^"]+)"/.exec(html)![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}

test('droits : personne ne s\'élève lui-même ; donner passe par la validation du propriétaire ; limiter est immédiat pour lui', { timeout: 180_000 }, async (t) => {
  const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  try {
    const v = await vraiOdin(tt, { compte: true, modules: (o) => [...allModules(o).filter((m) => IDS.includes(m.id)), relais] }), va = valhallaOf()!;
    // Mise en place par le propriétaire (appel interne, comme après sa validation) : une personne du groupe « invite »
    // qui a l'accès à l'interface d'Odin et à l'appli Persona, rien d'autre.
    assert.equal((await va.act('var', 'ajouter', { login: 'personne-a', nom: 'Personne A', groupes: 'invite', mot_de_passe: MDP })).ok, true);
    assert.equal((await va.act('var', 'donner_acces', { appli: 'odin', qui: '@personne-a' })).ok, true);
    assert.equal((await va.act('var', 'donner_acces', { appli: 'var', qui: '@personne-a' })).ok, true);
    const ctx = persona()!; lierProprietaire(ctx);
    const moi = () => personnes(ctx).find((p) => p.login === 'personne-a')!, proprio = () => personnes(ctx).find((p) => p.proprio)!;
    const cerbere = () => groupesDe(ctx, 'garmr');
    const avant = { cerbere: cerbere(), groupes: moi().groups, hashProprio: proprio().hash, nb: personnes(ctx).length };
    assert.ok(!avant.cerbere.includes('@personne-a'));

    const m = await entrer(v, 'personne-a', MDP);
    const membre = (body: unknown) => v.json('/api/valhalla/act', body, { cookie: m });
    const proprioWeb = (body: unknown) => v.json('/api/valhalla/act', body);

    await t.test('un membre qui a l\'appli Persona ne se donne rien (même chemin que l\'interface, confirmation comprise)', async () => {
      const essais: Array<[string, Record<string, unknown>]> = [
        ['donner_acces', { appli: 'garmr', qui: '@personne-a' }],
        ['acces_cases', { qui: '@personne-a', garmr: true }],
        ['mettre_dans_groupe', { login: 'personne-a', groupe: 'admin' }],
        ['modifier', { login: 'personne-a', groupes: 'invite, admin' }],
        ['ajouter', { login: 'personne-b', nom: 'Personne B', groupes: 'admin', mot_de_passe: 'une-phrase-assez-longue-77' }],
        ['mot_de_passe', { login: proprio().login, mot_de_passe: 'une-phrase-assez-longue-77' }],
      ];
      const passes: string[] = [];
      for (const [action, input] of essais) {
        const r = await membre({ module: 'var', action, input, confirm: true });
        if (!(r.status === 403 || r.body.ok === false)) passes.push(`${action} → ${r.status} ${String(r.body.text ?? '').slice(0, 140)}`);
      }
      assert.deepEqual(passes, [], 'chaque essai est refusé au membre');
      // Par une phrase (Logos), confirmation comprise : rien non plus.
      const phrase = await v.json('/api/valhalla/order', { text: 'donne l accès à Cerbère au groupe invite', confirm: true }, { cookie: m });
      assert.equal(phrase.body.ok, false, JSON.stringify(phrase.body));
      assert.deepEqual(cerbere(), avant.cerbere, 'les droits de Cerbère n\'ont pas bougé');
      assert.deepEqual(moi().groups, avant.groupes, 'ses groupes n\'ont pas bougé');
      assert.equal(proprio().hash, avant.hashProprio, 'la fiche du propriétaire n\'a pas reçu de mot de passe');
      assert.equal(personnes(ctx).length, avant.nb, 'aucun compte créé');
      // Toujours pas Cerbère dans son catalogue.
      const cat = (await v.json('/api/valhalla/catalog', undefined, { cookie: m })).body as { modules: Array<{ id: string }> };
      assert.ok(!cat.modules.some((x) => x.id === 'garmr'));
    });

    await t.test('un membre ne retire rien non plus', async () => {
      const r = await membre({ module: 'var', action: 'retirer_acces', input: { appli: 'odin', qui: '@personne-a' }, confirm: true });
      assert.ok(r.status === 403 || r.body.ok === false, JSON.stringify(r.body));
      assert.ok(groupesDe(ctx, 'odin').includes('@personne-a'));
    });

    await t.test('le propriétaire : donner demande sa validation (pour qui, quoi, avant → après), puis le droit est donné', async () => {
      const d = await proprioWeb({ module: 'var', action: 'donner_acces', input: { appli: 'garmr', qui: '@personne-a' } });
      assert.equal(d.body.ok, false); assert.equal(typeof d.body.confirm, 'string', JSON.stringify(d.body));
      const c = String(d.body.confirm);
      assert.match(c, /personne-a/); assert.match(c, /Cerbère/); assert.match(c, /admin → admin, @personne-a/);
      assert.deepEqual(cerbere(), avant.cerbere, 'rien ne change avant la validation');
      const ok = await proprioWeb({ module: 'var', action: 'donner_acces', input: { appli: 'garmr', qui: '@personne-a' }, confirm: true });
      assert.equal(ok.body.ok, true, JSON.stringify(ok.body)); assert.ok(cerbere().includes('@personne-a'));
      // Les cases : décocher est immédiat, cocher demande la validation.
      const dec = await proprioWeb({ module: 'var', action: 'acces_cases', input: { qui: '@personne-a', garmr: false } });
      assert.equal(dec.body.ok, true, JSON.stringify(dec.body)); assert.ok(!cerbere().includes('@personne-a'));
      const coche = await proprioWeb({ module: 'var', action: 'acces_cases', input: { qui: '@personne-a', garmr: true } });
      assert.equal(coche.body.ok, false); assert.match(String(coche.body.confirm), /Cerbère/); assert.ok(!cerbere().includes('@personne-a'));
      assert.equal((await proprioWeb({ module: 'var', action: 'acces_cases', input: { qui: '@personne-a', garmr: true }, confirm: true })).body.ok, true);
      assert.ok(cerbere().includes('@personne-a'));
      // Entrer dans un groupe : validation qui montre les groupes avant → après.
      const g = await proprioWeb({ module: 'var', action: 'mettre_dans_groupe', input: { login: 'personne-a', groupe: 'famille' } });
      assert.match(String(g.body.confirm), /invite → invite, famille/); assert.deepEqual(moi().groups, ['invite']);
      const mo = await proprioWeb({ module: 'var', action: 'modifier', input: { login: 'personne-a', groupes: 'invite, admin' } });
      assert.match(String(mo.body.confirm), /Personne A \(« personne-a »\) — groupes : invite → invite, admin/); assert.deepEqual(moi().groups, ['invite']);
      const aj = await proprioWeb({ module: 'var', action: 'ajouter', input: { login: 'personne-c', nom: 'Personne C', groupes: 'famille', mot_de_passe: 'une-phrase-assez-longue-78' } });
      assert.match(String(aj.body.confirm), /Personne C .* groupes : aucun → famille/); assert.ok(!personnes(ctx).some((p) => p.login === 'personne-c'));
    });

    await t.test('retirer est immédiat pour le propriétaire', async () => {
      const r = await proprioWeb({ module: 'var', action: 'retirer_acces', input: { appli: 'garmr', qui: '@personne-a' } });
      assert.equal(r.body.ok, true, JSON.stringify(r.body)); assert.equal(r.body.confirm, undefined); assert.ok(!cerbere().includes('@personne-a'));
    });

    await t.test('ni une automatisation, ni un réflexe, ni Odin seul, ni une conversation marquée, ni un membre qui parle à Odin', async () => {
      const donner = { appli: 'garmr', qui: '@personne-a' };
      for (const o of [{ auto: true, by: 'automatisation' as const }, { by: 'réflexe' as const }, { by: 'odin' as const }, { qui: 'owner' as const, marque: true }, { qui: 'member' as const }, { qui: 'guest' as const }]) {
        const r = await va.act('var', 'donner_acces', donner, o); assert.equal(r.ok, false, `${JSON.stringify(o)} : ${r.text}`);
        const x = await va.act('var', 'mettre_dans_groupe', { login: 'personne-a', groupe: 'admin' }, o); assert.equal(x.ok, false, `${JSON.stringify(o)} : ${x.text}`);
      }
      assert.ok(!cerbere().includes('@personne-a')); assert.deepEqual(moi().groups, ['invite']);
    });

    // Les appelants qui ne sont pas le propriétaire en personne.
    const pasLui = [{ auto: true, by: 'automatisation' as const }, { auto: true, by: 'assistant' as const }, { by: 'réflexe' as const }, { by: 'odin' as const }, { qui: 'owner' as const, marque: true }, { qui: 'member' as const }];

    await t.test('par une autre appli non plus : Agora « mettre dans un groupe » ne donne rien sans le propriétaire, et lui demande sa validation', async () => {
      const entree = { login: 'personne-a', groupe: 'admin' };
      for (const o of pasLui) { const r = await va.act('agora', 'ajouter_personne', entree, o); assert.equal(r.ok, false, `${JSON.stringify(o)} : ${r.text}`); }
      assert.deepEqual(moi().groups, ['invite'], 'ses groupes n\'ont pas bougé');
      const d = await proprioWeb({ module: 'agora', action: 'ajouter_personne', input: entree });
      assert.equal(d.body.ok, false, JSON.stringify(d.body)); assert.match(String(d.body.confirm), /personne-a.*invite → invite, admin/);
      assert.deepEqual(moi().groups, ['invite'], 'rien ne change avant la validation');
      const ok = await proprioWeb({ module: 'agora', action: 'ajouter_personne', input: entree, confirm: true });
      assert.equal(ok.body.ok, true, JSON.stringify(ok.body)); assert.deepEqual(moi().groups, ['invite', 'admin']);
      // L'enlever : tout de suite.
      const en = await proprioWeb({ module: 'agora', action: 'enlever_personne', input: entree });
      assert.equal(en.body.ok, true, JSON.stringify(en.body)); assert.equal(en.body.confirm, undefined); assert.deepEqual(moi().groups, ['invite']);
      // Donner une appli du store à un groupe : validation aussi (un élément, ou le formulaire du groupe).
      assert.equal((await va.act('agora', 'ajouter', { appli_odin: 'Cerbère' })).ok, true);
      const m = await proprioWeb({ module: 'agora', action: 'definir_mode', input: { element: 'cerbere', groupe: '@personne-a', mode: 'Proposée' } });
      assert.match(String(m.body.confirm), /personne-a.*Cerbère/, JSON.stringify(m.body));
      const mg = await proprioWeb({ module: 'agora', action: 'modes_groupe', input: { groupe: '@personne-a', cerbere: 'Proposée' } });
      assert.match(String(mg.body.confirm), /personne-a.*Cerbère/, JSON.stringify(mg.body));
      for (const o of pasLui) assert.equal((await va.act('agora', 'definir_mode', { element: 'cerbere', groupe: '@personne-a', mode: 'Proposée' }, o)).ok, false, JSON.stringify(o));
      assert.ok(!cerbere().includes('@personne-a'));
    });

    await t.test('à la racine : un appel entre applis garde qui a lancé l\'action, et ne donne rien que la validation de départ n\'a pas couvert', async () => {
      const entree = { login: 'personne-a', groupes: 'invite, admin' };
      for (const o of pasLui) { const r = await va.act('relais', 'relayer_valide', entree, o); assert.equal(r.ok, false, `${JSON.stringify(o)} : ${r.text}`); }
      // Le propriétaire, par une action qui ne montre rien à valider : refusé (rien n'a été validé).
      const r = await va.act('relais', 'relayer', entree); assert.equal(r.ok, false, r.text);
      assert.deepEqual(moi().groups, ['invite']);
      // Limiter par le même chemin reste permis (rien n'est donné).
      assert.equal((await va.act('relais', 'relayer', { login: 'personne-a', groupes: 'invite' })).ok, true);
      // Le propriétaire, par une action validée : le changement passe.
      const v2 = await va.act('relais', 'relayer_valide', entree); assert.equal(v2.ok, true, v2.text); assert.deepEqual(moi().groups, ['invite', 'admin']);
      assert.equal((await va.act('var', 'modifier', { login: 'personne-a', groupes: 'invite' })).ok, true); assert.deepEqual(moi().groups, ['invite']);
    });

    await t.test('annuler une manip par une phrase demande la validation si l\'annulation redonne un droit', async () => {
      const manip = { id: 'zqxw', at: new Date().toISOString(), module: 'var', action: 'retirer_acces', label: 'Persona · Retirer l\'accès à une appli', input: { appli: 'garmr', qui: '@personne-a' }, text: 'retiré', by: 'réflexe', undo: { action: 'donner_acces', input: { appli: 'garmr', qui: '@personne-a' }, label: 'Redonner l\'accès' }, state: 'à décider' };
      writeFileSync(join(va.dir, 'manips.json'), JSON.stringify([manip]));
      const r = await va.order('annule zqxw');
      assert.equal(r.ok, false, r.text); assert.match(String(r.confirm), /Cerbère/); assert.ok(!cerbere().includes('@personne-a'), 'rien de redonné avant la validation');
      const w = await v.json('/api/valhalla/order', { text: 'annule zqxw' });
      assert.match(String(w.body.confirm), /Cerbère/, JSON.stringify(w.body)); assert.ok(!cerbere().includes('@personne-a'));
      const ok = await va.order('annule zqxw', 'principal', { confirm: true });
      assert.equal(ok.ok, true, ok.text); assert.ok(cerbere().includes('@personne-a'));
      assert.equal((await va.act('var', 'retirer_acces', { appli: 'garmr', qui: '@personne-a' })).ok, true);
    });

    await t.test('les textes de validation : « tout le monde » en clair, adresses de retour, réserver un site au seul groupe admin', async () => {
      const tous = await proprioWeb({ module: 'var', action: 'donner_acces', input: { appli: 'garmr', qui: '*' } });
      assert.match(String(tous.body.confirm), /toute personne connectée/); assert.doesNotMatch(String(tous.body.confirm), /, \*/);
      // Une adresse de retour de plus : elle peut recevoir les codes de connexion → validation (avant → après).
      const avantRetours = clients(ctx).find((c) => c.id === 'venus')!.retours;
      const ret = await proprioWeb({ module: 'var', action: 'ajouter_retour', input: { appli: 'venus', adresse: 'http://192.0.2.10:8096/auth/odin/retour' } });
      assert.match(String(ret.body.confirm), /adresses de retour : .* → .*192\.0\.2\.10/, JSON.stringify(ret.body));
      assert.deepEqual(clients(ctx).find((c) => c.id === 'venus')!.retours, avantRetours);
      // Réserver un site au seul groupe admin, c'est réduire : pas de validation.
      const pctx = va.ctx('var'); pctx.saveSettings({ rules: [{ domain: 'site.exemple', groups: ['famille'] }] });
      const f = va.action('var', 'proteger_site')!;
      assert.equal(f.a.grave!({ domaine: 'site.exemple', groupes: 'admin' }, pctx), undefined);
      assert.match(String(f.a.grave!({ domaine: 'site.exemple', groupes: 'famille, invite' }, pctx)), /famille → famille, invite/);
      pctx.saveSettings({ rules: [] });
    });

    await t.test('Personnes (conversations) : monter un rôle ou une autonomie, ou lier une identité à quelqu\'un qui a plus de droits, demande la validation', async () => {
      const act = (body: Record<string, unknown>) => v.json('/api/action', body);
      const users = () => v.o.muninn.listUsers();
      // Un membre prudent, créé sans identité : rien n'est encore donné.
      const c = await act({ kind: 'user_save', name: 'Personne D', role: 'member', autonomy: 'prudent' });
      assert.equal(c.body.ok, true, JSON.stringify(c.body)); const id = String(c.body.id);
      // Créer directement un propriétaire : validation.
      const o = await act({ kind: 'user_save', name: 'Personne E', role: 'owner' });
      assert.equal(o.body.ok, false); assert.match(String(o.body.confirm), /Personne E.*rôle : aucun → owner/, JSON.stringify(o.body)); assert.ok(!users().some((u) => u.name === 'Personne E'));
      // Monter l'autonomie, puis le rôle : validation, rien ne change avant.
      const au = await act({ kind: 'user_save', id, name: 'Personne D', role: 'member', autonomy: 'autonome' });
      assert.match(String(au.body.confirm), /Personne D.*autonomie : prudent → autonome/, JSON.stringify(au.body)); assert.equal(users().find((u) => u.id === id)!.autonomy, 'prudent');
      const ro = await act({ kind: 'user_save', id, name: 'Personne D', role: 'owner', autonomy: 'prudent' });
      assert.match(String(ro.body.confirm), /Personne D.*rôle : member → owner/, JSON.stringify(ro.body)); assert.equal(users().find((u) => u.id === id)!.role, 'member');
      // Lier une identité : elle reçoit les droits de la personne → validation (pour qui, avant → après).
      const li = await act({ kind: 'user_link', id, channel: 'telegram', peer: '555000111' });
      assert.match(String(li.body.confirm), /telegram:555000111.*Personne D/, JSON.stringify(li.body)); assert.equal(v.o.muninn.userFor('telegram', '555000111'), undefined);
      assert.equal((await act({ kind: 'user_link', id, channel: 'telegram', peer: '555000111', confirm: true })).body.ok, true);
      assert.equal(v.o.muninn.userFor('telegram', '555000111')?.id, id);
      // Avec sa validation : le rôle monte.
      assert.equal((await act({ kind: 'user_save', id, name: 'Personne D', role: 'owner', autonomy: 'prudent', confirm: true })).body.ok, true);
      assert.equal(users().find((u) => u.id === id)!.role, 'owner');
      // Descendre : tout de suite.
      const bas = await act({ kind: 'user_save', id, name: 'Personne D', role: 'guest' });
      assert.equal(bas.body.ok, true, JSON.stringify(bas.body)); assert.equal(users().find((u) => u.id === id)!.role, 'guest');
    });

    const grp = (l: string) => personnes(ctx).find((p) => p.login === l)!.groups;
    await t.test('Agora : le propriétaire enlève quelqu\'un de son dernier groupe (validation : il passe dans « invite »)', async () => {
      // Le propriétaire enlève quelqu'un de son seul groupe par Agora : il passe dans « invite », ce que la validation montre.
      assert.equal((await va.act('var', 'ajouter', { login: 'personne-f', nom: 'Personne F', groupes: 'famille', mot_de_passe: MDP })).ok, true);
      const en = await proprioWeb({ module: 'agora', action: 'enlever_personne', input: { login: 'personne-f', groupe: 'famille' } });
      assert.match(String(en.body.confirm), /personne-f.*famille → invite/, JSON.stringify(en.body)); assert.deepEqual(grp('personne-f'), ['famille']);
      const enOk = await proprioWeb({ module: 'agora', action: 'enlever_personne', input: { login: 'personne-f', groupe: 'famille' }, confirm: true });
      assert.equal(enOk.body.ok, true, JSON.stringify(enOk.body)); assert.deepEqual(grp('personne-f'), ['invite']);
      // Annuler un ajout (manip d'Agora) qui la laisse sans groupe : la validation montre « famille → invite », puis ça passe.
      assert.equal((await va.act('var', 'ajouter', { login: 'personne-g', nom: 'Personne G', groupes: 'famille', mot_de_passe: MDP })).ok, true);
      const aj = { login: 'personne-g', groupe: 'famille' };
      writeFileSync(join(va.dir, 'manips.json'), JSON.stringify([{ id: 'cccc', at: new Date().toISOString(), module: 'agora', action: 'ajouter_personne', label: 'Agora · Mettre dans un groupe', input: aj, text: 'ajouté', by: 'réflexe', state: 'à décider', undo: { action: 'enlever_personne', input: aj, label: 'L\'enlever du groupe' } }]));
      const an = await va.order('annule cccc');
      assert.match(String(an.confirm), /personne-g.*famille → invite/, an.text); assert.deepEqual(grp('personne-g'), ['famille']);
      const anOk = await va.order('annule cccc', 'principal', { confirm: true });
      assert.equal(anOk.ok, true, anOk.text); assert.deepEqual(grp('personne-g'), ['invite']);
      writeFileSync(join(va.dir, 'manips.json'), '[]');
    });

    await t.test('un appel entre applis hors de toute action, ou dans un minuteur après une action validée, n\'est pas le propriétaire', async () => {
      // Un appel entre applis fait hors de toute action (veille, démarrage, route d'une appli) : pas le propriétaire.
      const b = await va.ctx('relais').call('var', 'donner_acces', { appli: 'garmr', qui: '@personne-a' }, 'veille', { interne: true });
      assert.equal(b.ok, false, b.text); assert.ok(!cerbere().includes('@personne-a'));
      // Une validation ne vaut que pendant l'action : un minuteur armé pendant une action validée n'en hérite pas.
      assert.equal((await va.act('relais', 'anodin', { login: 'personne-a', groupes: 'invite, admin' })).ok, true); await plusTard;
      assert.deepEqual(moi().groups, ['invite']);
    });

    const manip = (id: string) => ({ id, at: new Date().toISOString(), module: 'var', action: 'retirer_acces', label: 'Persona · Retirer', input: { appli: 'garmr', qui: '@personne-a' }, text: 'retiré', by: 'réflexe', state: 'à décider', undo: { action: 'donner_acces', input: { appli: 'garmr', qui: '@personne-a' }, label: 'Redonner' } });
    await t.test('outil de l\'agent : « annule tout / dernière » montre ce que l\'annulation redonne, et garde qui parle', async () => {
      // L'outil de l'agent : « annule tout » montre ce que l'annulation redonne, et garde qui parle (membre, conversation marquée).
      writeFileSync(join(va.dir, 'manips.json'), JSON.stringify([manip('aaaa')]));
      for (const appli of ['tout', 'dernière', 'aaaa']) assert.match(String(valhallaTool.grave!({ action: 'manip', appli, quoi: 'annuler' })), /Cerbère/, appli);
      const outil = await valhallaTool.run({ action: 'manip', appli: 'tout', quoi: 'annuler' }, { auteur: { role: 'member' }, isTainted: () => true, sessionId: 'essai' } as never);
      assert.doesNotMatch(String(outil), /↩ Annulé/); assert.ok(!cerbere().includes('@personne-a'), 'rien de redonné');
      writeFileSync(join(va.dir, 'manips.json'), '[]');
    });

    await t.test('un membre qui dit « annule … » est refusé, sans rien lire de ce que l\'annulation donnerait', async () => {
      // Un membre qui dit « annule … » : refusé, sans rien lire de ce que l'annulation donnerait.
      writeFileSync(join(va.dir, 'manips.json'), JSON.stringify([manip('bbbb')]));
      for (const confirm of [false, true]) {
        const o = await v.json('/api/valhalla/order', { text: 'annule bbbb', confirm }, { cookie: m });
        assert.notEqual(o.body.ok, true, JSON.stringify(o.body)); assert.doesNotMatch(JSON.stringify(o.body), /Cerbère|admin/);
      }
      assert.ok(!cerbere().includes('@personne-a'));
      writeFileSync(join(va.dir, 'manips.json'), '[]');
    });

    await t.test('le propriétaire entre toujours (rien de cassé pour lui)', async () => {
      assert.equal((await v.json('/api/account/me')).status, 200); assert.equal(COMPTE.email.length > 0, true);
    });
  } finally { for (const k of ['log', 'error', 'warn'] as const) console[k] = orig[k]; await tt.end(); }
});
