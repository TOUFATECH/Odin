// Persona : les informations d'une personne (année de naissance, langue), demandées à l'ajout, à la modification, sur la
// page d'invitation et dans « Mon compte ». Seule l'année de naissance est gardée (l'âge à un an près) ; l'âge n'est
// jamais rangé, il est recalculé à chaque lecture. Ces informations sont chiffrées sur le disque, un membre ne voit et
// ne corrige que les siennes, quelqu'un sans compte rien, et un logiciel relié n'en reçoit aucune.
// Un vrai Odin (serveur web + applis), dossiers jetables, identifiants neutres.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { client, persona, personnes } from '../src/valhalla/sso/etat.ts';
import { emettre } from '../src/valhalla/sso/oidc.ts';
import { auNomDe } from '../src/valhalla/sso/acces.ts';
import { varModule } from '../src/valhalla/modules/var.ts';
import { ageDe, lireAnnee, lireLangue, CHAMPS_INFOS } from '../src/valhalla/sso/infos.ts';
import type { GraphDetail } from '../src/valhalla/types.ts';

const IDS = ['var', 'brisingamen', 'garmr', 'valgrind', 'hlid'];
const MDP = { a: 'lanterne-grise-sur-le-quai-31', b: 'colline-ocre-et-vent-du-nord-58', c: 'riviere-calme-sous-les-pins-26' };
const jour = (a: number, m: number, j: number) => new Date(a, m - 1, j, 12);

test('l\'âge vient de l\'année de naissance, à un an près, et une année impossible est refusée', () => {
  // Seule l'année est connue : l'âge change le 1er janvier (la veille, il n'a pas encore changé).
  assert.equal(ageDe(1990, jour(2026, 12, 31)), 36);
  assert.equal(ageDe(1990, jour(2027, 1, 1)), 37);
  // Le 29 février (année bissextile) ne change rien : ni la veille, ni le jour, ni le lendemain.
  assert.equal(ageDe(2000, jour(2028, 2, 28)), 28);
  assert.equal(ageDe(2000, jour(2028, 2, 29)), 28);
  assert.equal(ageDe(2000, jour(2028, 3, 1)), 28);
  assert.equal(ageDe(2026, jour(2026, 6, 1)), 0);
  const now = jour(2026, 11, 18);
  assert.equal(lireAnnee('', now), undefined, 'vide : rien (facultatif)');
  assert.equal(lireAnnee(' 1990 ', now), 1990);
  assert.equal(lireAnnee(1990, now), 1990);
  assert.equal(lireAnnee('2026', now), 2026);
  for (const x of ['2027', '2999', '1899', '0990', 'abc', '19 90', '1990.5', '1990-05-12', '12/05/1990', '-1990'])
    assert.throws(() => lireAnnee(x, now), /année de naissance/, `« ${x} » refusé`);
  assert.equal(lireLangue(''), undefined);
  assert.equal(lireLangue(' Kiswahili '), 'Kiswahili');
  assert.equal(lireLangue('Shimaoré'), 'Shimaoré');
  for (const x of ['<b>', 'a'.repeat(41), '12']) assert.throws(() => lireLangue(x), /langue/, `« ${x} » refusé`);
  assert.deepEqual([...CHAMPS_INFOS].sort(), ['langue', 'naissance'], 'deux champs, rien d\'autre');
});

test('Persona : année de naissance et langue, chiffrées sur le disque, vues par la personne et le propriétaire seulement', { timeout: 180_000 }, async () => {
  const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  try {
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) }), va = valhallaOf()!, ctx = va.ctx('var');
    const an = new Date().getFullYear(), de = (login: string) => personnes(persona()!).find((p) => p.login === login);
    const disque = () => readFileSync(join(ctx.dir, 'réglages.json'), 'utf8');
    const surDisque = (login: string) => (JSON.parse(disque()) as { people: Array<Record<string, unknown>> }).people.find((p) => p.login === login)!;

    // Les formulaires « Ajouter » et « Modifier » demandent les deux champs, facultatifs.
    for (const id of ['ajouter', 'modifier']) {
      const ps = varModule.actions.find((a) => a.id === id)!.params!;
      for (const k of ['naissance', 'langue']) { const x = ps.find((p) => p.key === k); assert.ok(x, `${id} : champ ${k}`); assert.ok(!x.required, `${id} : ${k} facultatif`); assert.equal(x.prive, true, `${id} : ${k} jamais recopié au journal des manips`); }
    }

    // Une année impossible : refusée avec un message clair, aucun compte créé.
    for (const x of ['2999', '1850', 'abc']) {
      const r = await va.act('var', 'ajouter', { login: 'personne-x', nom: 'Personne X', groupes: 'famille', mot_de_passe: MDP.a, naissance: x });
      assert.equal(r.ok, false, `« ${x} » refusé`); assert.match(r.text, /année de naissance/);
    }
    assert.equal(de('personne-x'), undefined);
    // Une année ou une langue impossible est refusée AVANT la demande de confirmation (sinon : « Confirmer », puis le
    // refus, et tout ce qui a été saisi est perdu). Une saisie juste garde sa confirmation, comme avant.
    const graveDe = (id: string, i: Record<string, unknown>) => varModule.actions.find((a) => a.id === id)!.grave!(i, ctx);
    for (const x of [{ naissance: '2999' }, { naissance: 'abc' }, { langue: '<b>' }])
      assert.equal(graveDe('ajouter', { login: 'personne-x', nom: 'Personne X', groupes: 'famille', ...x }), undefined, `ajouter ${JSON.stringify(x)} : refus d'abord, pas de confirmation`);
    assert.match(String(graveDe('ajouter', { login: 'personne-x', nom: 'Personne X', groupes: 'famille', naissance: '1990' })), /créer le compte/, 'saisie juste : la confirmation reste');
    // Jamais plus large que l'action : le 31 décembre à 23 h 59, l'année qui commence dans une minute demande encore la
    // confirmation (rien ne part sans elle si l'action est lancée juste après minuit).
    const veille = { ...ctx, now: () => new Date(2026, 11, 31, 23, 59) };
    assert.match(String(varModule.actions.find((a) => a.id === 'ajouter')!.grave!({ login: 'personne-x', nom: 'Personne X', groupes: 'famille', naissance: '2027' }, veille)), /créer le compte/);

    // Ajouter : l'année et la langue sont gardées, chiffrées sur le disque ; l'âge n'est pas rangé.
    let r = await va.act('var', 'ajouter', { login: 'personne-a', nom: 'Personne A', groupes: 'famille', mot_de_passe: MDP.a, naissance: '1990', langue: 'Kiswahili' });
    assert.equal(r.ok, true, r.text);
    assert.equal(de('personne-a')?.naissance, 1990); assert.equal(de('personne-a')?.langue, 'Kiswahili');
    const brut = surDisque('personne-a');
    assert.match(String(brut.naissance), /^odc1:/, 'année chiffrée'); assert.match(String(brut.langue), /^odc1:/, 'langue chiffrée');
    assert.doesNotMatch(disque(), /"naissance":\s*1990/); assert.ok(!disque().includes('Kiswahili'), 'la langue n\'est pas en clair');
    assert.ok(!('age' in brut) && !('âge' in brut), 'l\'âge n\'est jamais rangé');
    assert.ok(!JSON.stringify(r).includes('Kiswahili'), 'le compte rendu ne recopie pas les informations');

    // Modifier : une autre année ; vide = inchangée ; une année impossible est refusée.
    assert.equal((await va.act('var', 'modifier', { login: 'personne-a', naissance: '1991' })).ok, true);
    assert.equal(de('personne-a')?.naissance, 1991);
    assert.equal((await va.act('var', 'modifier', { login: 'personne-a', nom: 'Personne A' })).ok, true);
    assert.equal(de('personne-a')?.naissance, 1991, 'vide : inchangée');
    r = await va.act('var', 'modifier', { login: 'personne-a', naissance: String(an + 1) }); assert.equal(r.ok, false); assert.match(r.text, /année de naissance/);
    assert.equal(de('personne-a')?.naissance, 1991);
    assert.doesNotMatch(disque(), /"naissance":\s*1991/);
    // « Modifier » avec des groupes en plus (validation) et une année impossible : le refus d'abord, la confirmation ensuite.
    assert.equal(graveDe('modifier', { login: 'personne-a', groupes: 'famille, admins', naissance: String(an + 2) }), undefined);
    assert.match(String(graveDe('modifier', { login: 'personne-a', groupes: 'famille, admins', naissance: '1991' })), /groupes/, 'saisie juste : la confirmation reste');

    // Une deuxième personne, sans informations.
    assert.equal((await va.act('var', 'ajouter', { login: 'personne-b', nom: 'Personne B', groupes: 'famille', mot_de_passe: MDP.b })).ok, true);
    assert.equal(de('personne-b')?.naissance, undefined);

    // La fiche : le propriétaire voit l'année et l'âge (recalculé à la lecture) ; un membre ne voit que les siennes.
    const fiche = async (login: string, qui?: string) => {
      const q = new URLSearchParams(), f = () => varModule.view(ctx, q);
      const vu = await (qui ? auNomDe({ login: qui, name: qui, groups: ['famille'] }, f) : f()) as { sections: Array<{ kind: string; details?: Record<string, GraphDetail> }> };
      return { d: vu.sections.find((x) => x.kind === 'graph')!.details![`p:${login}`]!, tout: JSON.stringify(vu) };
    };
    const ligne = (d: GraphDetail, k: string) => d.rows?.find((x) => x.k === k)?.v;
    let f = await fiche('personne-a');
    assert.equal(ligne(f.d, 'Année de naissance'), '1991'); assert.match(String(ligne(f.d, 'Âge')), new RegExp(`^${an - 1991} ans`)); assert.equal(ligne(f.d, 'Langue'), 'Kiswahili');
    f = await fiche('personne-a', 'personne-a');
    assert.equal(ligne(f.d, 'Année de naissance'), '1991', 'la personne voit les siennes');
    f = await fiche('personne-a', 'personne-b');
    assert.equal(ligne(f.d, 'Année de naissance'), undefined, 'un autre membre ne voit pas l\'année');
    assert.equal(ligne(f.d, 'Âge'), undefined); assert.ok(!f.tout.includes('Kiswahili'), 'ni la langue, nulle part dans la page');
    f = await fiche('personne-a', 'quelquun');
    assert.equal(ligne(f.d, 'Âge'), undefined, 'quelqu\'un d\'autre : rien');

    // La page d'invitation demande les deux champs, refuse une année impossible, garde les informations chiffrées.
    r = await va.act('var', 'inviter', { nom: 'Personne C', groupes: 'famille' }); assert.equal(r.ok, true, r.text);
    const j = new URL(/https?:\/\/\S+\/sso\/invitation\?j=[A-Za-z0-9_-]{43}/.exec(r.text)![0]).searchParams.get('j')!;
    const page = await (await fetch(`${v.url}/sso/invitation?j=${j}`)).text();
    assert.match(page, /name="naissance"/); assert.match(page, /name="langue"/); assert.match(page, /Année de naissance \(facultatif/);
    const form = (b: Record<string, string>, h: Record<string, string> = {}, chemin = '/sso/invitation') => fetch(`${v.url}${chemin}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...h }, body: new URLSearchParams(b) });
    let rr = await form({ j, login: 'personne-c', motdepasse: MDP.c, motdepasse2: MDP.c, naissance: String(an + 3) });
    const refus = await rr.text();
    assert.equal(rr.status, 400); assert.match(refus, /année de naissance/i); assert.equal(de('personne-c'), undefined);
    // Le message est sous le champ de l'année (avant les mots de passe), relié à lui, et le champ est marqué et prend le focus.
    assert.match(refus, /<input id="ia"[^>]*aria-invalid="true"[^>]*aria-describedby="ia-err"[^>]*autofocus/, 'champ marqué, relié au message, focus');
    assert.match(refus, /id="ia-err"[^>]*>Année de naissance/);
    assert.ok(refus.indexOf('id="ia-err"') < refus.indexOf('for="p"'), 'le message est sous l\'année, pas en bas du formulaire');
    assert.match(refus, new RegExp(`name="naissance"[^>]*value="${an + 3}"`), 'l\'année saisie est gardée');
    rr = await form({ j, login: 'personne-c', motdepasse: MDP.c, motdepasse2: MDP.c, naissance: '2001', langue: 'Shimaoré' });
    assert.equal(rr.status, 200, await rr.clone().text());
    assert.equal(de('personne-c')?.naissance, 2001); assert.equal(de('personne-c')?.langue, 'Shimaoré');
    assert.match(String(surDisque('personne-c').naissance), /^odc1:/); assert.ok(!disque().includes('Shimaoré'));

    // « Mon compte » : la personne voit et corrige les siennes, jamais celles d'un autre.
    rr = await form({ identifiant: 'personne-c', motdepasse: MDP.c }, {}, '/sso/compte'); assert.equal(rr.status, 303);
    const nav = rr.headers.getSetCookie().find((c) => c.startsWith('odin_var='))!.split(';')[0];
    const compte = await (await fetch(`${v.url}/sso/compte`, { headers: { cookie: nav } })).text();
    assert.match(compte, /name="naissance"[^>]*value="2001"/); assert.match(compte, /Shimaoré/);
    // L'âge est sous l'année (et relié à elle), pas sous la langue.
    const age = compte.indexOf(`${an - 2001} ans cette année`);
    assert.ok(age > compte.indexOf('id="ia"') && age < compte.indexOf('for="il"'), 'l\'âge est sous le champ de l\'année');
    assert.match(compte, /<input id="ia"[^>]*aria-describedby="ia-age"/);
    assert.ok(!compte.includes('Kiswahili') && !compte.includes('1991'), 'rien d\'une autre personne');
    rr = await form({ naissance: '1850' }, { cookie: nav }, '/sso/compte/infos'); assert.equal(rr.status, 400); assert.match(await rr.text(), /année de naissance/i);
    assert.equal(de('personne-c')?.naissance, 2001);
    rr = await form({ naissance: '2002', langue: '', login: 'personne-a' }, { cookie: nav }, '/sso/compte/infos'); assert.equal(rr.status, 303);
    assert.equal(de('personne-c')?.naissance, 2002); assert.equal(de('personne-c')?.langue, undefined, 'vidée par la personne');
    assert.equal(de('personne-a')?.naissance, 1991, 'jamais celles d\'un autre'); assert.equal(de('personne-a')?.langue, 'Kiswahili');
    // Sans compte : rien.
    rr = await form({ naissance: '1999' }, {}, '/sso/compte/infos'); assert.equal(rr.status, 303); assert.equal(rr.headers.get('location'), '/sso/compte');
    assert.equal(de('personne-c')?.naissance, 2002);
    assert.doesNotMatch(await (await fetch(`${v.url}/sso/compte`)).text(), /2002/);

    // Un logiciel relié ne reçoit rien de nouveau.
    const p = de('personne-a')!, c = client(ctx, 'odin')!;
    const jet = emettre(ctx, p, c, { iss: v.url, appareil: { id: 'essai', nom: 'essai', plateforme: 'essai' }, via: 'essai' });
    for (const t of [jet.id_token, jet.access_token]) {
      const charge = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
      for (const k of ['naissance', 'langue', 'age', 'birthdate', 'locale']) assert.ok(!(k in charge), `pas de « ${k} » dans le jeton`);
      assert.ok(!JSON.stringify(charge).includes('1991') && !JSON.stringify(charge).includes('Kiswahili'));
    }
  } finally { for (const k of ['log', 'error', 'warn'] as const) console[k] = orig[k]; await tt.end(); }
});
