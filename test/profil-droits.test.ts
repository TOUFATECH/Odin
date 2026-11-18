// Profil, lot 5 (première partie) : les droits d'une personne. Donner un droit passe par la validation du propriétaire,
// qui montre pour qui, quel registre (rôle et autonomie dans la mémoire d'Odin, ou accès aux applis dans Persona) et
// avant → après ; limiter reste immédiat pour lui ; lier une identité à une personne est un geste du propriétaire seul,
// avec sa validation ; chaque changement de droit est écrit au journal des personnes ; la personne limitée n'est pas
// prévenue. Un vrai Odin (serveur web + applis), dossiers jetables, prénoms inventés.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { groupesDe, lierProprietaire, nomAppli, persona, personnes } from '../src/valhalla/sso/etat.ts';
import { valhallaTool } from '../src/tools/valhalla.ts';
import * as P from '../src/muninn/personnes.ts';

const MDP = 'cerf-volant-vert-sur-la-dune-47';
const IDS = ['var', 'brisingamen', 'garmr', 'valgrind', 'hlid'];
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';

async function entrer(v: VraiOdin, ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const html = await r.text(), demande = /name="demande" value="([^"]+)"/.exec(html)![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}

interface LigneDroit { t: number; qui: string | null; sorte: string; droit?: { registre: string; pour: string; quoi: string; avant: string; apres: string; sens: string } }

test('profil, droits : donner = validation avant → après ; limiter = immédiat ; lier = propriétaire seul ; tout est journalisé', { timeout: 180_000 }, async (t) => {
  const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  try {
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) }), va = valhallaOf()!, mu = v.o.muninn;
    // Le journal des changements de Persona, branché comme Odin le branche au démarrage (s'il existe).
    const J = await import('../src/valhalla/sso/droits-journal.ts').catch(() => undefined) as undefined | { brancherJournalDroits(f: ((c: never) => void) | undefined): void };
    const noterDroit = (P as Record<string, unknown>).noterDroit as undefined | ((m: typeof mu, c: unknown) => void);
    if (J && noterDroit) { J.brancherJournalDroits((c) => noterDroit(mu, c)); tt.onEnd(() => J.brancherJournalDroits(undefined)); }
    const droits = () => mu.lignesHistorique((l) => (l.sorte as string) === 'droit') as unknown as LigneDroit[];

    // Mise en place (appel interne, comme après la validation) : un membre « invite » qui a l'interface et l'appli Persona.
    assert.equal((await va.act('var', 'ajouter', { login: 'personne-a', nom: 'Personne A', groupes: 'invite', mot_de_passe: MDP })).ok, true);
    assert.equal((await va.act('var', 'donner_acces', { appli: 'odin', qui: '@personne-a' })).ok, true);
    assert.equal((await va.act('var', 'donner_acces', { appli: 'var', qui: '@personne-a' })).ok, true);
    const ctx = persona()!; lierProprietaire(ctx);
    const moi = () => personnes(ctx).find((p) => p.login === 'personne-a')!;
    const venus = () => groupesDe(ctx, 'venus');
    const m = await entrer(v, 'personne-a', MDP);
    const proprioWeb = (body: unknown) => v.json('/api/valhalla/act', body);
    const act = (body: Record<string, unknown>) => v.json('/api/action', body);
    const avantVenus = venus();

    await t.test('un membre qui a l\'appli Persona se donne un accès → refusé, et noté au journal des connexions', async () => {
      for (const [action, input] of [['donner_acces', { appli: 'venus', qui: '@personne-a' }], ['acces_cases', { qui: '@personne-a', venus: true }], ['modifier', { login: 'personne-a', groupes: 'invite, admin' }]] as const) {
        const r = await v.json('/api/valhalla/act', { module: 'var', action, input, confirm: true }, { cookie: m });
        assert.ok(r.status === 403 || r.body.ok === false, `${action} : ${JSON.stringify(r.body)}`);
      }
      assert.deepEqual(venus(), avantVenus); assert.deepEqual(moi().groups, ['invite']);
      const j = await va.act('var', 'journal', {});
      assert.match(String(j.text), /personne-a .*réservé au propriétaire/);
    });

    await t.test('un membre demande « donne-moi admin » → refusé (barre des applis, conversation)', async () => {
      const o = await v.json('/api/valhalla/order', { text: 'donne-moi admin', confirm: true }, { cookie: m });
      assert.notEqual(o.body.ok, true, JSON.stringify(o.body));
      const c = await v.json('/api/message', { text: 'donne-moi admin' }, { cookie: m }); assert.equal(c.status, 403);
      const outil = await valhallaTool.run({ action: 'action', appli: 'var', quoi: 'modifier', entree: JSON.stringify({ login: 'personne-a', groupes: 'invite, admin' }) }, { auteur: { role: 'member' }, isTainted: () => false, sessionId: 'essai' } as never);
      assert.match(String(outil), /seul le propriétaire/); assert.deepEqual(moi().groups, ['invite']);
    });

    await t.test('un texte lu sur le web qui dit « donne l\'accès à … » : rien ne part', async () => {
      const outil = await valhallaTool.run({ action: 'action', appli: 'var', quoi: 'donner_acces', entree: JSON.stringify({ appli: 'venus', qui: '@personne-a' }) }, { auteur: { role: 'owner' }, isTainted: () => true, sessionId: 'essai' } as never);
      assert.match(String(outil), /seul le propriétaire/); assert.deepEqual(venus(), avantVenus);
    });

    await t.test('une automatisation ne donne rien', async () => {
      for (const o of [{ auto: true, by: 'automatisation' as const }, { by: 'réflexe' as const }, { by: 'odin' as const }]) {
        assert.equal((await va.act('var', 'donner_acces', { appli: 'venus', qui: '@personne-a' }, o)).ok, false, JSON.stringify(o));
        assert.equal((await va.act('var', 'modifier', { login: 'personne-a', groupes: 'invite, famille' }, o)).ok, false, JSON.stringify(o));
      }
      assert.deepEqual(venus(), avantVenus); assert.deepEqual(moi().groups, ['invite']);
    });

    await t.test('l\'aperçu avant → après est exact dans les deux registres', async () => {
      // Persona (accès aux applis) : calculé sur les droits réels de Vénus.
      const d = await proprioWeb({ module: 'var', action: 'donner_acces', input: { appli: 'venus', qui: '@personne-a' } });
      const attendu = `${avantVenus.join(', ')} → ${[...avantVenus, '@personne-a'].join(', ')}`;
      assert.equal(String(d.body.confirm).includes(`l'accès à ${nomAppli(ctx, 'venus')} — autorisés : ${attendu}`), true, JSON.stringify(d.body));
      assert.deepEqual(venus(), avantVenus, 'rien ne change avant la validation');
      // Mémoire d'Odin (rôle et autonomie).
      const u = await act({ kind: 'user_save', name: 'Personne B', role: 'member', autonomy: 'prudent' }); const id = String(u.body.id);
      const au = await act({ kind: 'user_save', id, name: 'Personne B', role: 'member', autonomy: 'equilibre' });
      assert.match(String(au.body.confirm), /Personne B — autonomie : prudent → equilibre/, JSON.stringify(au.body));
      assert.equal(mu.listUsers().find((x) => x.id === id)!.autonomy, 'prudent');
      assert.equal((await act({ kind: 'user_save', id, name: 'Personne B', role: 'member', autonomy: 'equilibre', confirm: true })).body.ok, true);
    });

    await t.test('lier une identité : la validation du propriétaire, qui montre les droits que l\'identité obtient ; délier est immédiat', async () => {
      const g = await act({ kind: 'user_save', name: 'Personne C', role: 'guest' }); const idc = String(g.body.id);
      // Même vers une personne qui n'a pas plus qu'un inconnu : lier reste un geste validé, qui dit ce qu'elle obtient.
      const l1 = await act({ kind: 'user_link', id: idc, channel: 'telegram', peer: '555000222' });
      assert.equal(l1.body.ok, false, JSON.stringify(l1.body)); assert.match(String(l1.body.confirm), /telegram:555000222 devient Personne C — rôle : guest → guest/);
      assert.equal(mu.userFor('telegram', '555000222'), undefined);
      assert.equal((await act({ kind: 'user_link', id: idc, channel: 'telegram', peer: '555000222', confirm: true })).body.ok, true);
      // D'une personne à une autre qui a autant de droits : validation aussi.
      const b = mu.listUsers().find((x) => x.name === 'Personne B')!;
      const e = await act({ kind: 'user_save', name: 'Personne E', role: 'member', autonomy: 'equilibre' }); const ide = String(e.body.id);
      assert.equal((await act({ kind: 'user_link', id: b.id, channel: 'telegram', peer: '555000333', confirm: true })).body.ok, true);
      const re = await act({ kind: 'user_link', id: ide, channel: 'telegram', peer: '555000333' });
      assert.match(String(re.body.confirm), /telegram:555000333 devient Personne E — rôle : member → member ; autonomie : equilibre → equilibre/, JSON.stringify(re.body));
      assert.equal(mu.userFor('telegram', '555000333')?.id, b.id);
      // Délier : tout de suite.
      const dl = await act({ kind: 'user_unlink', channel: 'telegram', peer: '555000333' });
      assert.equal(dl.body.ok, true, JSON.stringify(dl.body)); assert.equal(dl.body.confirm, undefined); assert.equal(mu.userFor('telegram', '555000333'), undefined);
    });

    await t.test('limiter passe sans validation pour le propriétaire ; donner sans validation est refusé', async () => {
      assert.equal((await proprioWeb({ module: 'var', action: 'donner_acces', input: { appli: 'venus', qui: '@personne-a' }, confirm: true })).body.ok, true);
      // Donner sans validation : refusé (une demande de validation revient, rien ne change).
      for (const body of [{ module: 'var', action: 'acces_cases', input: { qui: '@personne-a', garmr: true } }, { module: 'var', action: 'modifier', input: { login: 'personne-a', groupes: 'invite, famille' } }]) {
        const r = await proprioWeb(body); assert.equal(r.body.ok, false); assert.equal(typeof r.body.confirm, 'string', JSON.stringify(r.body));
      }
      assert.deepEqual(moi().groups, ['invite']); assert.ok(!groupesDe(ctx, 'garmr').includes('@personne-a'));
      // À la fois retirer ici et ajouter là : c'est donner.
      const mix = await proprioWeb({ module: 'var', action: 'acces_cases', input: { qui: '@personne-a', venus: false, garmr: true } });
      assert.equal(typeof mix.body.confirm, 'string', JSON.stringify(mix.body)); assert.ok(venus().includes('@personne-a'));
      // Limiter : un geste.
      const n0 = v.notified.length;
      for (const body of [{ module: 'var', action: 'retirer_acces', input: { appli: 'venus', qui: '@personne-a' } }, { module: 'var', action: 'modifier', input: { login: 'personne-a', actif: 'coupé' } }]) {
        const r = await proprioWeb(body); assert.equal(r.body.ok, true, JSON.stringify(r.body)); assert.equal(r.body.confirm, undefined);
      }
      assert.ok(!venus().includes('@personne-a')); assert.equal(moi().active, false);
      const b = mu.listUsers().find((x) => x.name === 'Personne B')!;
      const bas = await act({ kind: 'user_save', id: b.id, name: b.name, role: 'member', autonomy: 'prudent' });
      assert.equal(bas.body.ok, true, JSON.stringify(bas.body)); assert.equal(mu.listUsers().find((x) => x.id === b.id)!.autonomy, 'prudent');
      // Réactiver un compte coupé : c'est donner.
      const re = await proprioWeb({ module: 'var', action: 'modifier', input: { login: 'personne-a', actif: 'actif' } });
      assert.match(String(re.body.confirm), /compte : coupé → actif/); assert.equal(moi().active, false);
      // La personne limitée n'est pas prévenue : rien n'est envoyé.
      assert.deepEqual(v.notified.slice(n0).filter((x) => /personne-a|Personne A|Personne B/.test(x)), []);
    });

    await t.test('chaque changement de droit est écrit au journal des personnes (qui, quoi, pour qui, avant → après, quand), sans secret', async () => {
      const l = droits();
      const de = (registre: string, f: (d: NonNullable<LigneDroit['droit']>) => boolean) => l.filter((x) => x.droit?.registre === registre && f(x.droit));
      // Rangé en codes (registre, quoi, rôles, groupes, identifiants), traduit à l'affichage : aucune phrase d'une langue.
      assert.ok(de('persona', (d) => d.pour === '@personne-a' && d.quoi === 'acces:venus' && d.sens === 'donne' && d.apres.split(',').includes('@personne-a')).length >= 1, JSON.stringify(l));
      assert.ok(de('persona', (d) => d.pour === '@personne-a' && d.quoi === 'acces:venus' && d.sens === 'limite' && !d.apres.split(',').includes('@personne-a')).length >= 1, JSON.stringify(l));
      assert.ok(de('persona', (d) => d.pour === '@personne-a' && d.quoi === 'compte' && d.sens === 'limite' && d.avant === 'actif' && d.apres === 'coupe').length >= 1, JSON.stringify(l));
      assert.ok(de('odin', (d) => d.quoi === 'autonomie' && d.sens === 'donne' && d.avant === 'prudent' && d.apres === 'equilibre').length >= 1, JSON.stringify(l));
      assert.ok(de('odin', (d) => d.quoi === 'autonomie' && d.sens === 'limite' && d.avant === 'equilibre' && d.apres === 'prudent').length >= 1, JSON.stringify(l));
      assert.ok(de('odin', (d) => d.quoi === 'identite' && d.apres.startsWith('telegram:555000222;')).length >= 1, JSON.stringify(l));
      assert.ok(de('odin', (d) => d.quoi === 'identite' && d.avant.startsWith('telegram:555000333;') && d.apres === 'telegram:555000333' && d.sens === 'limite').length >= 1, JSON.stringify(l));
      for (const x of l) for (const k of ['quoi', 'avant', 'apres', 'pour'] as const) assert.doesNotMatch(String(x.droit?.[k]), /\s:\s|→|accès|aucun|supprim|reliée|coupé|groupe\s/u, `pas de libellé dans une langue : ${JSON.stringify(x.droit)}`);
      // Une identité qui passe d'un membre à un invité perd des droits : le journal dit « limite », pas « donne ».
      const bb = mu.listUsers().find((x) => x.name === 'Personne B')!, cc = mu.listUsers().find((x) => x.name === 'Personne C')!;
      assert.equal((await act({ kind: 'user_link', id: bb.id, channel: 'telegram', peer: '555000444', confirm: true })).body.ok, true);
      assert.equal((await act({ kind: 'user_link', id: cc.id, channel: 'telegram', peer: '555000444', confirm: true })).body.ok, true);
      const vers = droits().filter((x) => x.droit?.quoi === 'identite' && x.droit.pour === cc.id && x.droit.apres.startsWith('telegram:555000444;'));
      assert.equal(vers.length, 1, JSON.stringify(droits())); assert.equal(vers[0].droit!.sens, 'limite', JSON.stringify(vers[0]));
      assert.equal(droits().filter((x) => x.droit?.quoi === 'identite' && x.droit.pour === bb.id && x.droit.apres.startsWith('telegram:555000444;'))[0]?.droit?.sens, 'donne');
      for (const x of l) { assert.equal(typeof x.t, 'number'); assert.doesNotMatch(JSON.stringify(x), new RegExp(MDP)); }
      // Le journal est rangé au nom de qui a fait le changement (le propriétaire) : la fiche de la personne limitée ne le montre pas.
      const b = mu.listUsers().find((x) => x.name === 'Personne B')!;
      assert.deepEqual(P.historiquePersonne(mu, b.id).filter((x) => (x.sorte as string) === 'droit'), []);
      // Supprimer une personne : écrit aussi.
      const z = await act({ kind: 'user_save', name: 'Personne Z', role: 'member' });
      assert.equal((await act({ kind: 'user_delete', id: String(z.body.id) })).body.ok, true);
      assert.ok(droits().some((x) => x.droit?.registre === 'odin' && x.droit.pour === String(z.body.id) && x.droit.sens === 'limite'), JSON.stringify(droits()));
    });

    await t.test('usage normal : le propriétaire crée une personne, lui donne un accès en validant, le lui retire', async () => {
      const aj = await proprioWeb({ module: 'var', action: 'ajouter', input: { login: 'personne-f', nom: 'Personne F', groupes: 'famille', mot_de_passe: MDP } });
      assert.match(String(aj.body.confirm), /groupes : aucun → famille/);
      assert.equal((await proprioWeb({ module: 'var', action: 'ajouter', input: { login: 'personne-f', nom: 'Personne F', groupes: 'famille', mot_de_passe: MDP }, confirm: true })).body.ok, true);
      const d = await proprioWeb({ module: 'var', action: 'donner_acces', input: { appli: 'garmr', qui: '@personne-f' } }); assert.equal(typeof d.body.confirm, 'string');
      assert.equal((await proprioWeb({ module: 'var', action: 'donner_acces', input: { appli: 'garmr', qui: '@personne-f' }, confirm: true })).body.ok, true);
      assert.ok(groupesDe(ctx, 'garmr').includes('@personne-f'));
      assert.equal((await proprioWeb({ module: 'var', action: 'retirer_acces', input: { appli: 'garmr', qui: '@personne-f' } })).body.ok, true);
      assert.ok(!groupesDe(ctx, 'garmr').includes('@personne-f'));
    });

    await t.test('la clé d\'accès (état des lieux, sans rien changer)', async () => {
      const cle = { authorization: `Bearer ${v.token}` };
      const a = await v.json('/api/action', { kind: 'user_save', name: 'Personne K', role: 'owner' }, cle);
      const b = await v.json('/api/valhalla/act', { module: 'var', action: 'donner_acces', input: { appli: 'garmr', qui: '@personne-f' } }, cle);
      t.diagnostic(`clé d'accès : user_save owner → ${a.status} ${JSON.stringify(a.body).slice(0, 160)} ; donner_acces → ${b.status} ${JSON.stringify(b.body).slice(0, 160)}`);
    });
  } finally { for (const k of ['log', 'error', 'warn'] as const) console[k] = orig[k]; await tt.end(); }
});
