// Secrets reçus dans la conversation, rangés dans Thésauros (le coffre de mots de passe) sous un nom.
// Demande du propriétaire (19/11) : « quand on lui envoie, il met dans son coffre […] il les supprime les conserves
// nulle part et le mettre directement dans le coffre » ; le secret d'un membre → « Son propre coffre » ; « Réécris la
// ligne qui contient le secret et l'identifiant » (l'identifiant va au coffre avec le mot de passe, dans le même élément).
//
// Toutes les valeurs sont tirées au hasard à chaque essai : aucune n'est un vrai secret. Chaque essai cherche la valeur,
// octet par octet, dans tout le dossier d'essai (dossier d'Odin et dossier des clés), hors du coffre chiffré.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { trierSecrets } from '../src/heimdall/secrets-entrants.ts';
import { brisingamen, load, rangerSecrets, type Item } from '../src/valhalla/modules/brisingamen.ts';
import type { ModCtx } from '../src/valhalla/types.ts';
import { vaultEnable, vaultLock } from '../src/vault.ts';

const CLE_ESSAI = randomBytes(32).toString('hex');
const valeur = (prefixe: string) => `${prefixe}-${randomBytes(9).toString('base64url')}`;

function nouveau(o: { cle?: boolean } = {}): { ctx: ModCtx; home: string } {
  const home = mkdtempSync(join(tmpdir(), 'odin-ranger-')), dir = join(home, 'valhalla', 'brisingamen');
  mkdirSync(dir, { recursive: true });
  if (o.cle === false) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = CLE_ESSAI;
  const ctx = { home, dir, settings: {}, saveSettings: () => undefined, now: () => new Date('2026-11-19T17:40:00Z') } as unknown as ModCtx;
  return { ctx, home };
}

/** Tous les fichiers sous `d` (récursif). */
function fichiers(d: string): string[] {
  if (!d || !existsSync(d)) return [];
  const out: string[] = [];
  for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) out.push(...fichiers(p)); else out.push(p); }
  return out;
}
/** Les fichiers (hors coffre chiffré de Thésauros si `horsCoffre`) qui contiennent une des valeurs, en UTF-8 ou UTF-16. */
function traces(home: string, valeurs: string[], horsCoffre = true): string[] {
  const dossiers = [home, process.env.ODIN_CLE_DIR ?? ''];
  const out: string[] = [];
  for (const f of dossiers.flatMap(fichiers)) {
    if (horsCoffre && f.endsWith('coffre.bin')) continue;
    const b = readFileSync(f);
    for (const v of valeurs) if (b.includes(Buffer.from(v, 'utf8')) || b.includes(Buffer.from(v, 'utf16le'))) out.push(`${f} ⊃ valeur`);
  }
  return out;
}
const sansValeur = (resultat: unknown, valeurs: string[]) => { const j = JSON.stringify(resultat); for (const v of valeurs) assert.ok(!j.includes(v), 'une valeur est dans le résultat'); };

const PROPRIO = { role: 'owner' as const, id: 'u-proprio', nom: 'propriétaire' };
const SAMI = { role: 'member' as const, id: 'u-sami', nom: 'Sami' };

test('« Box » : identifiant et mot de passe dans UN élément ; le résultat ne porte aucune valeur', () => {
  const { ctx, home } = nouveau(), id = valeur('admin'), mdp = valeur('Mdp');
  const r = rangerSecrets(ctx, PROPRIO, [{ nom: 'Box', champ: 'identifiant', valeur: id, sur: true }, { nom: 'Box', champ: 'mot de passe', valeur: mdp, sur: true }]);
  assert.equal(r.ok, true);
  sansValeur(r, [id, mdp]);
  assert.deepEqual(r.ok && r.ranges.map((x) => ({ nom: x.nom, champs: x.champs, nouveau: x.nouveau })), [{ nom: 'Box', champs: ['identifiant', 'mot de passe'], nouveau: true }]);
  const items = load(ctx);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Box'); assert.equal(items[0].user, id); assert.equal(items[0].password, mdp);
  assert.equal(items[0].membre, undefined); assert.equal(items[0].folder, 'Personnel');
  assert.deepEqual(traces(home, [id, mdp]), []);
  // Le coffre lui-même est chiffré : la valeur n'y est pas en clair non plus.
  assert.deepEqual(traces(home, [mdp], false), []);
});

test('remplacement : un seul élément par compte, l\'ancienne valeur passe dans l\'historique', () => {
  const { ctx, home } = nouveau(), id = valeur('admin'), ancien = valeur('Ancien'), neuf = valeur('Neuf'), id2 = valeur('root');
  rangerSecrets(ctx, PROPRIO, [{ nom: 'Box', champ: 'identifiant', valeur: id, sur: true }, { nom: 'Box', champ: 'mot de passe', valeur: ancien, sur: true }]);
  const r = rangerSecrets(ctx, PROPRIO, [{ nom: 'box', champ: 'mot de passe', valeur: neuf, sur: true }, { nom: 'BOX', champ: 'identifiant', valeur: id2, sur: true }]);
  assert.equal(r.ok, true); sansValeur(r, [id, ancien, neuf, id2]);
  assert.deepEqual(r.ok && r.ranges.map((x) => ({ nom: x.nom, nouveau: x.nouveau, remplaces: x.remplaces })), [{ nom: 'Box', nouveau: false, remplaces: ['mot de passe', 'identifiant'] }]);
  const items = load(ctx);
  assert.equal(items.length, 1, 'un seul élément « Box »');
  assert.equal(items[0].password, neuf); assert.equal(items[0].user, id2);
  assert.deepEqual(items[0].history?.map((h) => [h.champ ?? 'mot de passe', h.password]), [['mot de passe', ancien], ['identifiant', id]]);
  // La même valeur renvoyée ne crée pas d'historique.
  const r2 = rangerSecrets(ctx, PROPRIO, [{ nom: 'Box', champ: 'mot de passe', valeur: neuf, sur: true }]);
  assert.deepEqual(r2.ok && r2.ranges[0].remplaces, []); assert.equal(load(ctx)[0].history?.length, 2);
  assert.deepEqual(traces(home, [id, ancien, neuf, id2]), []);
});

test('les autres sortes de secrets : un élément par nom, sous le nom du champ, jamais dans le mot de passe', () => {
  const { ctx } = nouveau(), cle = valeur('sk-proj'), wifi = valeur('wifi');
  const r = rangerSecrets(ctx, PROPRIO, [{ nom: 'OpenAI', champ: 'clé d\'API', valeur: cle, sur: true }, { nom: 'Wi-Fi Maison', champ: 'clé Wi-Fi', valeur: wifi, sur: true }]);
  assert.equal(r.ok, true); sansValeur(r, [cle, wifi]);
  const items = load(ctx);
  assert.deepEqual(items.map((i) => i.name), ['OpenAI', 'Wi-Fi Maison']);
  assert.equal(items[0].champs?.['clé d\'API'], cle); assert.equal(items[0].password, undefined);
  assert.equal(items[1].champs?.['clé Wi-Fi'], wifi);
});

test('coffre fermé (mot de passe maître verrouillé) : rien gardé nulle part, la fonction rend « coffre fermé »', () => {
  const { ctx, home } = nouveau(), id = valeur('admin'), mdp = valeur('Ferme');
  vaultEnable(home, 'mot-de-passe-du-coffre-essai'); vaultLock(home);
  const r = rangerSecrets(ctx, PROPRIO, [{ nom: 'Box', champ: 'identifiant', valeur: id, sur: true }, { nom: 'Box', champ: 'mot de passe', valeur: mdp, sur: true }]);
  assert.deepEqual(r, { ok: false, raison: 'coffre fermé' });
  assert.equal(existsSync(join(ctx.dir, 'coffre.bin')), false, 'aucun coffre écrit');
  assert.deepEqual(traces(home, [id, mdp], false), []);
});

test('coffre fermé (clé de Thésauros absente) : rien gardé nulle part, « coffre fermé »', () => {
  const { ctx, home } = nouveau({ cle: false }), mdp = valeur('SansCle');
  try {
    const r = rangerSecrets(ctx, PROPRIO, [{ nom: 'Box', champ: 'mot de passe', valeur: mdp, sur: true }]);
    assert.deepEqual(r, { ok: false, raison: 'coffre fermé' });
    assert.deepEqual(traces(home, [mdp], false), []);
  } finally { process.env.BRISINGAMEN_KEY = CLE_ESSAI; }
});

test('coffre illisible : rien n\'est réécrit par-dessus, rien gardé', () => {
  const { ctx, home } = nouveau(), mdp = valeur('Illisible');
  rangerSecrets(ctx, PROPRIO, [{ nom: 'Box', champ: 'mot de passe', valeur: valeur('Premier'), sur: true }]);
  const avant = readFileSync(join(ctx.dir, 'coffre.bin'));
  process.env.BRISINGAMEN_KEY = randomBytes(32).toString('hex');
  try {
    const r = rangerSecrets(ctx, PROPRIO, [{ nom: 'Box', champ: 'mot de passe', valeur: mdp, sur: true }]);
    assert.deepEqual(r, { ok: false, raison: 'coffre illisible' });
    assert.ok(readFileSync(join(ctx.dir, 'coffre.bin')).equals(avant), 'le coffre n\'est pas écrasé');
    assert.deepEqual(traces(home, [mdp], false), []);
  } finally { process.env.BRISINGAMEN_KEY = CLE_ESSAI; }
});

test('un membre range dans SON coffre (dossier à son nom) ; le propriétaire ne lit ni la valeur ni l\'identifiant', async () => {
  const { ctx, home } = nouveau(), idP = valeur('proprio'), mdpP = valeur('MdpP'), idS = valeur('sami'), mdpS = valeur('MdpS');
  rangerSecrets(ctx, PROPRIO, [{ nom: 'Box', champ: 'identifiant', valeur: idP, sur: true }, { nom: 'Box', champ: 'mot de passe', valeur: mdpP, sur: true }]);
  const r = rangerSecrets(ctx, SAMI, [{ nom: 'Box', champ: 'identifiant', valeur: idS, sur: true }, { nom: 'Box', champ: 'mot de passe', valeur: mdpS, sur: true }]);
  assert.equal(r.ok, true); sansValeur(r, [idS, mdpS]);
  assert.deepEqual(r.ok && r.ranges.map((x) => ({ dossier: x.dossier, nouveau: x.nouveau })), [{ dossier: 'Coffre de Sami', nouveau: true }]);
  const items = load(ctx);
  assert.equal(items.length, 2, 'la Box du membre ne remplace pas celle du propriétaire');
  const s = items.find((i) => i.membre === 'u-sami') as Item, p = items.find((i) => !i.membre) as Item;
  assert.equal(s.user, idS); assert.equal(s.password, mdpS); assert.equal(s.folder, 'Coffre de Sami');
  assert.equal(p.user, idP); assert.equal(p.password, mdpP);
  // Ce que le propriétaire voit de Thésauros (page, recherche, bilan) ne montre rien du coffre du membre.
  const vue = JSON.stringify(await brisingamen.view(ctx, new URLSearchParams()));
  assert.ok(!vue.includes(idS) && !vue.includes(mdpS), 'la page ne montre pas l\'identifiant du membre');
  assert.ok(vue.includes('Coffre de Sami'), 'la page dit que ce coffre existe');
  const cherche = await brisingamen.actions.find((a) => a.id === 'chercher')!.run(ctx, { q: 'box' });
  assert.ok(!JSON.stringify(cherche).includes(idS), 'la recherche ne montre pas l\'identifiant du membre');
  const bilan = await brisingamen.actions.find((a) => a.id === 'bilan')!.run(ctx, {});
  assert.ok(!JSON.stringify(bilan).includes('Sami'));
  // Un autre membre a son propre élément, même sous le même prénom affiché.
  rangerSecrets(ctx, { role: 'member', id: 'u-sami-2', nom: 'Sami' }, [{ nom: 'Box', champ: 'mot de passe', valeur: valeur('Autre'), sur: true }]);
  assert.equal(load(ctx).length, 3);
  assert.deepEqual(traces(home, [idP, mdpP, idS, mdpS]), []);
});

test('un invité, ou un membre sans identifiant : rien rangé, rien gardé', () => {
  const { ctx, home } = nouveau(), mdp = valeur('Invite');
  assert.deepEqual(rangerSecrets(ctx, { role: 'guest', id: '', nom: 'inconnu' }, [{ nom: 'Box', champ: 'mot de passe', valeur: mdp, sur: true }]), { ok: false, raison: 'non permis' });
  assert.deepEqual(rangerSecrets(ctx, { role: 'member', id: '', nom: 'Sami' }, [{ nom: 'Box', champ: 'mot de passe', valeur: mdp, sur: true }]), { ok: false, raison: 'non permis' });
  assert.equal(existsSync(join(ctx.dir, 'coffre.bin')), false);
  assert.deepEqual(traces(home, [mdp], false), []);
});

test('un secret « probable » est rangé avec la marque « probable » ; une valeur sûre l\'enlève', () => {
  const { ctx } = nouveau(), mdp = valeur('Probable'), sur = valeur('Sur');
  const r = rangerSecrets(ctx, PROPRIO, [{ nom: 'Box', champ: 'mot de passe', valeur: mdp, sur: false }]);
  assert.deepEqual(r.ok && r.ranges.map((x) => x.probables), [['mot de passe']]);
  assert.deepEqual(load(ctx)[0].probables, ['mot de passe']);
  rangerSecrets(ctx, PROPRIO, [{ nom: 'Box', champ: 'mot de passe', valeur: sur, sur: true }]);
  assert.equal(load(ctx)[0].probables, undefined);
});

test('de bout en bout avec le tri : « box login/pass : a/b » → l\'élément « Box »', () => {
  const { ctx, home } = nouveau(), id = `admin${randomBytes(3).toString('hex')}`, mdp = valeur('Qz8');
  const tri = trierSecrets(`box login/pass : ${id}/${mdp}`);
  assert.ok(!tri.texte.includes(mdp) && !tri.texte.includes(id));
  const r = rangerSecrets(ctx, PROPRIO, tri.secrets);
  assert.equal(r.ok, true); sansValeur(r, [id, mdp]);
  const items = load(ctx);
  assert.equal(items.length, 1); assert.equal(items[0].name, 'Box'); assert.equal(items[0].user, id); assert.equal(items[0].password, mdp);
  assert.deepEqual(traces(home, [id, mdp]), []);
});

test('toutes les langues : deux noms qui ne diffèrent que par une marque (バンク / ハンク, Pär / Par) restent deux éléments', () => {
  const { ctx } = nouveau(), a = valeur('Ba'), b = valeur('Ha'), c = valeur('Pa'), d = valeur('Pb');
  rangerSecrets(ctx, PROPRIO, [{ nom: 'バンク', champ: 'mot de passe', valeur: a, sur: true }]);
  const r = rangerSecrets(ctx, PROPRIO, [{ nom: 'ハンク', champ: 'mot de passe', valeur: b, sur: true }]);
  assert.deepEqual(r.ok && r.ranges.map((x) => ({ nom: x.nom, nouveau: x.nouveau, remplaces: x.remplaces })), [{ nom: 'ハンク', nouveau: true, remplaces: [] }]);
  rangerSecrets(ctx, PROPRIO, [{ nom: 'Pär', champ: 'mot de passe', valeur: c, sur: true }, { nom: 'Par', champ: 'mot de passe', valeur: d, sur: true }]);
  const items = load(ctx);
  assert.deepEqual(items.map((i) => [i.name, i.password, i.history?.length ?? 0]), [['バンク', a, 0], ['ハンク', b, 0], ['Pär', c, 0], ['Par', d, 0]]);
  // La casse, les espaces et la forme de composition (é en un ou deux points de code) ne séparent pas un même nom.
  rangerSecrets(ctx, PROPRIO, [{ nom: '  pÄr ', champ: 'identifiant', valeur: valeur('id'), sur: true }, { nom: 'Pär', champ: 'clé', valeur: valeur('k'), sur: true }]);
  assert.equal(load(ctx).length, 4);
});

test('un champ au nom d\'une propriété héritée (« toString ») n\'invente ni remplacement ni historique', () => {
  const { ctx } = nouveau(), j = valeur('jeton'), t = valeur('ts');
  rangerSecrets(ctx, PROPRIO, [{ nom: 'X', champ: 'jeton', valeur: j, sur: true }]);
  const r = rangerSecrets(ctx, PROPRIO, [{ nom: 'X', champ: 'toString', valeur: t, sur: true }, { nom: 'X', champ: 'hasOwnProperty', valeur: t, sur: true }]);
  assert.deepEqual(r.ok && r.ranges[0].remplaces, []);
  const it = load(ctx)[0];
  assert.equal(it.history, undefined);
  assert.equal(it.champs?.toString, t); assert.equal(it.champs?.jeton, j);
});

test('entrées étranges : rien de vide n\'est rangé, aucune exception qui porte une valeur', () => {
  const { ctx } = nouveau(), mdp = valeur('Etrange');
  const r = rangerSecrets(ctx, PROPRIO, [{ nom: '', champ: 'mot de passe', valeur: mdp, sur: true }, { nom: 'Box', champ: 'mot de passe', valeur: '', sur: true }, null as never]);
  assert.equal(r.ok, true); sansValeur(r, [mdp]);
  assert.deepEqual(r.ok && r.ranges.map((x) => x.nom), ['Reçu']);
  assert.equal(load(ctx).length, 1);
});
