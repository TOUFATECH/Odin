// Persona : une invitation acceptée entre au journal des droits (Profil), comme une personne ajoutée à la main :
// le compte, ses groupes, avant → après, rangé au nom du propriétaire (qui a validé l'invitation au départ). La
// personne invitée ne voit rien de ce qui est écrit. Si son groupe demande un code, la ligne n'arrive qu'une fois le
// code confirmé. Jamais un mot de passe au journal.
// Un vrai Odin (serveur web + applis), dossiers jetables, identifiants neutres.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { persona, personnes } from '../src/valhalla/sso/etat.ts';
import { totp } from '../src/valhalla/modules/brisingamen.ts';

const IDS = ['var', 'brisingamen', 'garmr', 'valgrind', 'hlid'];
const MDP = { main: 'lanterne-grise-sur-le-quai-31', invite: 'colline-ocre-et-vent-du-nord-58', code: 'riviere-calme-sous-les-pins-26' };
interface LigneDroit { sorte: string; qui: string; canal: string; droit?: { registre: string; pour: string; quoi: string; avant: string; apres: string; sens: string } }

test('une invitation acceptée écrit au journal des droits le compte créé et ses groupes, comme un ajout à la main', { timeout: 180_000 }, async () => {
  const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  try {
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) }), va = valhallaOf()!, mu = v.o.muninn;
    const droits = () => mu.lignesHistorique((l) => (l.sorte as string) === 'droit') as unknown as LigneDroit[];
    const de = (login: string) => droits().filter((l) => l.droit?.pour === `@${login}`);
    const lien = async (nom: string, groupes: string) => { const r = await va.act('var', 'inviter', { nom, groupes }); assert.equal(r.ok, true, r.text); return new URL(/https?:\/\/\S+\/sso\/invitation\?j=[A-Za-z0-9_-]{43}/.exec(r.text)![0]).searchParams.get('j')!; };
    const form = (j: string, b: Record<string, string>) => fetch(`${v.url}/sso/invitation`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ j, ...b }) });

    // Une personne ajoutée à la main : la ligne de référence.
    assert.equal((await va.act('var', 'ajouter', { login: 'personne-a', nom: 'Personne A', groupes: 'famille', mot_de_passe: MDP.main })).ok, true);
    const main = de('personne-a').at(-1);
    assert.ok(main?.droit, 'l\'ajout à la main est au journal');

    // Une invitation acceptée.
    const j = await lien('Personne B', 'famille');
    assert.equal(de('personne-b').length, 0, 'rien au journal tant que l\'invitation n\'est pas acceptée');
    const r = await form(j, { login: 'personne-b', motdepasse: MDP.invite, motdepasse2: MDP.invite });
    assert.equal(r.status, 200); const page = await r.text(); assert.match(page, /Personne B/);
    const l = de('personne-b');
    assert.equal(l.length, 1, 'une ligne au journal des droits');
    assert.deepEqual(l[0].droit, { registre: 'persona', pour: '@personne-b', quoi: 'groupes', avant: '', apres: 'famille', sens: 'donne' });
    assert.deepEqual(Object.keys(l[0].droit!).sort(), Object.keys(main!.droit!).sort(), 'même forme qu\'un ajout à la main');
    assert.equal(l[0].canal, 'invitation', 'par où : l\'invitation');
    assert.equal(l[0].qui, main!.qui, 'rangée au nom du propriétaire, comme un ajout à la main');
    assert.ok(!JSON.stringify(l).includes(MDP.invite), 'jamais un mot de passe au journal');
    assert.ok(!JSON.stringify(l).includes(j), 'jamais le jeton de l\'invitation au journal');
    assert.doesNotMatch(page, /journal/i, 'la personne invitée n\'est pas prévenue de ce qui est écrit');
    assert.deepEqual(personnes(persona()!).find((p) => p.login === 'personne-b')?.groups, ['famille']);

    // Un groupe qui demande un code : la ligne n'arrive qu'une fois le code confirmé.
    assert.equal((await va.act('var', 'creer_groupe', { nom: 'atelier', double_auth: true })).ok, true);
    const j2 = await lien('Personne C', 'atelier');
    assert.match(await (await form(j2, { login: 'personne-c', motdepasse: MDP.code, motdepasse2: MDP.code })).text(), /Double authentification/);
    assert.equal(de('personne-c').length, 0, 'pas avant le code');
    const sec = personnes(persona()!).find((p) => p.login === 'personne-c')!.totpPending!;
    assert.equal((await form(j2, { code: totp(sec).code })).status, 200);
    assert.deepEqual(de('personne-c').map((x) => x.droit), [{ registre: 'persona', pour: '@personne-c', quoi: 'groupes', avant: '', apres: 'atelier', sens: 'donne' }]);
  } finally { for (const k of ['log', 'error', 'warn'] as const) console[k] = orig[k]; await tt.end(); }
});
