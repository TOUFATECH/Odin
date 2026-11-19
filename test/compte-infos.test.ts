// Le compte du propriétaire d'Odin : les mêmes informations que celles d'une personne de Persona (année de naissance,
// langue), facultatives, chiffrées dans compte.json ; sa fiche Persona (tirée de son compte) les reprend et montre son
// âge ; un logiciel relié n'en reçoit aucune. Dossiers jetables, identifiants neutres.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { T } from './banc/lib.ts';
import { vraiOdin, COMPTE } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, personnes } from '../src/valhalla/sso/etat.ts';
import { auNomDe } from '../src/valhalla/sso/acces.ts';
import { varModule } from '../src/valhalla/modules/var.ts';
import { Accounts } from '../src/web/account.ts';
import type { GraphDetail } from '../src/valhalla/types.ts';

const IDS = ['var', 'brisingamen', 'garmr', 'valgrind', 'hlid'];
const BASE = { prenom: 'Personne', nom: 'Essai', email: 'personne@example.org', password: 'lanterne-grise-sur-le-quai-31' };

test('compte du propriétaire : année de naissance et langue facultatives, chiffrées dans compte.json', async () => {
  const tt = new T();
  try {
    const dir = tt.tmp('compte-infos-'), a = new Accounts(dir, { scryptN: 1024 }), brut = () => readFileSync(join(dir, 'compte.json'), 'utf8');
    // Une année ou une langue impossible : refusée avec un message clair, aucun compte créé.
    for (const x of ['2999', '1850', '1990-05-12', 'abc']) { await assert.rejects(a.create({ ...BASE, naissance: x }), /^Error: Année de naissance/, `« ${x} » refusé`); assert.equal(a.exists(), false); }
    await assert.rejects(a.create({ ...BASE, langue: '<b>' }), /^Error: Langue/); assert.equal(a.exists(), false);

    const p = await a.create({ ...BASE, naissance: ' 1990 ', langue: 'Kiswahili' });
    assert.deepEqual(a.infos(), { naissance: 1990, langue: 'Kiswahili' });
    const disque = JSON.parse(brut()) as { infos: Record<string, unknown> };
    assert.match(String(disque.infos.naissance), /^odc1:/, 'année chiffrée'); assert.match(String(disque.infos.langue), /^odc1:/, 'langue chiffrée');
    assert.ok(!brut().includes('Kiswahili'), 'la langue n\'est pas en clair'); assert.doesNotMatch(brut(), /:\s*"?1990"?[,}\s]/, 'l\'année n\'est pas en clair');
    assert.ok(!/"(age|âge)"/.test(brut()), 'l\'âge n\'est jamais rangé');
    // Le profil (ce qui part déjà vers la page, l'état et la connexion unique) ne change pas.
    assert.deepEqual(Object.keys(p).sort(), ['changed', 'created', 'email', 'nom', 'prenom']);
    assert.deepEqual(Object.keys(a.profile()!).sort(), ['changed', 'created', 'email', 'nom', 'prenom']);

    // Mon compte : vide = inchangée ; une autre année ; une année impossible refusée ; vidée exprès.
    await a.update({ prenom: 'Personne B' }); assert.deepEqual(a.infos(), { naissance: 1990, langue: 'Kiswahili' }, 'sans les champs : inchangées');
    await a.update({ naissance: '1991' }); assert.deepEqual(a.infos(), { naissance: 1991, langue: 'Kiswahili' });
    await assert.rejects(a.update({ naissance: String(new Date().getFullYear() + 1) }), /^Error: Année de naissance/); assert.deepEqual(a.infos(), { naissance: 1991, langue: 'Kiswahili' });
    await a.update({ langue: '' }); assert.deepEqual(a.infos(), { naissance: 1991 }, 'vidée par le propriétaire');
    assert.deepEqual(a.infosNotees(), { naissance: 1991, langue: null }, 'vidée : notée, pour être retirée de sa fiche');
    assert.ok(!brut().includes('Kiswahili'));
    // Le mot de passe et la connexion ne bougent pas.
    assert.equal((await a.login(BASE.email, BASE.password)).ok, true);

    // Rien d'obligatoire en plus : un compte sans informations n'en garde aucune.
    const dir2 = tt.tmp('compte-infos-vide-'), b = new Accounts(dir2, { scryptN: 1024 });
    await b.create({ ...BASE, naissance: '', langue: '' });
    assert.equal(b.infos(), undefined); assert.ok(!('infos' in JSON.parse(readFileSync(join(dir2, 'compte.json'), 'utf8'))));
  } finally { await tt.end(); }
});

test('la fiche Persona du propriétaire reprend ses informations et son âge ; un logiciel relié n\'en reçoit aucune', { timeout: 180_000 }, async () => {
  const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  try {
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) }), va = valhallaOf()!, ctx = va.ctx('var');
    const an = new Date().getFullYear(), proprio = () => personnes(ctx).find((p) => p.proprio);
    assert.ok(existsSync(join(ctx.home, 'compte.json')), 'le compte du propriétaire est celui de cet Odin');
    const acc = new Accounts(ctx.home);
    assert.equal(acc.infos(), undefined);
    const avant = lierProprietaire(ctx)!; assert.equal(avant.naissance, undefined);

    // Son année mise dans Persona → Modifier : son compte n'en a jamais donné, sa fiche la garde.
    assert.equal((await va.act('var', 'modifier', { login: avant.login, naissance: '1980' })).ok, true);
    lierProprietaire(ctx); assert.equal(proprio()?.naissance, 1980, 'le compte n\'en a jamais donné : la fiche garde la sienne');
    // Puis il ne donne que sa langue dans son compte : sa fiche la reprend et garde son année.
    await acc.update({ langue: 'Kiswahili' });
    lierProprietaire(ctx); assert.equal(proprio()?.langue, 'Kiswahili'); assert.equal(proprio()?.naissance, 1980, 'une année jamais donnée au compte n\'est pas effacée de la fiche');

    // Le propriétaire donne son année et sa langue dans son compte : sa fiche les reprend (chiffrées dans Persona).
    await acc.update({ naissance: '1985', langue: 'Shimaoré' });
    const pr = lierProprietaire(ctx)!;
    assert.equal(pr.id, avant.id, 'la même fiche'); assert.equal(proprio()?.naissance, 1985); assert.equal(proprio()?.langue, 'Shimaoré');
    const disque = readFileSync(join(ctx.dir, 'réglages.json'), 'utf8'), ligne = (JSON.parse(disque) as { people: Array<Record<string, unknown>> }).people.find((p) => p.proprio)!;
    assert.match(String(ligne.naissance), /^odc1:/); assert.match(String(ligne.langue), /^odc1:/); assert.ok(!disque.includes('Shimaoré'));

    // Sa fiche montre son âge (recalculé à la lecture) ; un membre ne la voit pas.
    assert.equal((await va.act('var', 'ajouter', { login: 'personne-a', nom: 'Personne A', groupes: 'famille', mot_de_passe: 'colline-ocre-et-vent-du-nord-58' })).ok, true);
    const fiche = async (qui?: string) => {
      const f = () => varModule.view(ctx, new URLSearchParams());
      const vu = await (qui ? auNomDe({ login: qui, name: qui, groups: ['famille'] }, f) : f()) as { sections: Array<{ kind: string; details?: Record<string, GraphDetail> }> };
      return { d: vu.sections.find((x) => x.kind === 'graph')!.details![`p:${pr.login}`]!, tout: JSON.stringify(vu) };
    };
    const val = (d: GraphDetail, k: string) => d.rows?.find((x) => x.k === k)?.v;
    let f = await fiche();
    assert.equal(val(f.d, 'Année de naissance'), '1985'); assert.equal(val(f.d, 'Âge'), `${an - 1985} ans cette année`); assert.equal(val(f.d, 'Langue'), 'Shimaoré');
    f = await fiche('personne-a');
    assert.equal(val(f.d, 'Âge'), undefined, 'un membre ne voit pas l\'âge du propriétaire'); assert.ok(!f.tout.includes('Shimaoré'));

    // La connexion unique d'un logiciel relié, rejouée avec le compte du propriétaire : rien de nouveau ne part.
    const r = await v.json('/sso/connexion', { identifiant: COMPTE.email, motdepasse: COMPTE.password, appli: 'pegase', appareil: { id: 'appareil-essai-infos', nom: 'PC', plateforme: 'windows' } });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.ok, true);
    const rien = (o: Record<string, unknown>, ou: string) => {
      for (const k of ['naissance', 'langue', 'age', 'âge', 'birthdate', 'locale']) assert.ok(!(k in o), `pas de « ${k} » (${ou})`);
      assert.ok(!Object.values(o).some((x) => x === 1985 || x === '1985'), `pas d'année (${ou})`); assert.ok(!JSON.stringify(o).includes('Shimaoré'), `pas de langue (${ou})`);
    };
    rien(r.body, 'réponse'); rien(r.body.personne as Record<string, unknown>, 'personne');
    for (const t of [String(r.body.id_token), String(r.body.access_token)]) rien(JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>, 'jeton');
    const infos = await v.json('/sso/infos', undefined, { authorization: `Bearer ${String(r.body.access_token)}` });
    assert.equal(infos.status, 200); rien(infos.body, '/sso/infos');
    // Ni l'état de l'interface ni « Mon compte » (déjà reçus par la page du propriétaire) n'en reçoivent par le profil.
    const moi = await v.json('/api/account/me'); assert.equal(moi.status, 200); rien(moi.body.profile as Record<string, unknown>, '/api/account/me');

    // Vidée dans son compte : vidée sur sa fiche.
    await acc.update({ langue: '' });
    lierProprietaire(ctx); assert.equal(proprio()?.langue, undefined); assert.equal(proprio()?.naissance, 1985);
    // Un compte restauré ailleurs (clé différente) : ses informations illisibles n'effacent rien de la fiche.
    const fic = join(ctx.home, 'compte.json'), c = JSON.parse(readFileSync(fic, 'utf8')) as { infos: Record<string, unknown> };
    c.infos.naissance = 'odc1:illisible'; writeFileSync(fic, JSON.stringify(c));
    lierProprietaire(ctx); assert.equal(proprio()?.naissance, 1985, 'illisible : la fiche garde la sienne');
  } finally { for (const k of ['log', 'error', 'warn'] as const) console[k] = orig[k]; await tt.end(); }
});
