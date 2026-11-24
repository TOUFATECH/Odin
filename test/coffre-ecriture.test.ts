// Le coffre (Thésauros) ne perd rien quand on y écrit pendant qu'une autre action attend, ni quand l'écriture est coupée.
// Défaut validé par le propriétaire (26/11, « Oui, corrige vite ») : « Vérifier les fuites » lisait le coffre, attendait
// le réseau, puis réécrivait ce qu'elle avait lu : tout ce qui avait été rangé entre-temps était perdu.
//
// Aucun réseau réel : le « service » est une fonction de l'essai, qui répond quand l'essai le décide (aucune minuterie).
// Toutes les valeurs sont tirées au hasard : aucune n'est un vrai secret.

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import fs, { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { brisingamen, load, rangerSecrets, store, type Item } from '../src/valhalla/modules/brisingamen.ts';
import type { ModCtx } from '../src/valhalla/types.ts';

const CLE_ESSAI = randomBytes(32).toString('hex');
const valeur = (prefixe: string) => `${prefixe}-${randomBytes(9).toString('base64url')}`;
const sha1 = (v: string) => createHash('sha1').update(v).digest('hex').toUpperCase();
const action = (id: string) => brisingamen.actions.find((a) => a.id === id)!;

interface Appel { url: string; repondre: (corps: string) => void; echouer: () => void }
/** Un coffre neuf dans un dossier d'essai, et un « réseau » qui ne répond que quand l'essai le dit. */
function nouveau(): { ctx: ModCtx; dir: string; appels: Appel[]; alertes: unknown[]; prochain: () => Promise<Appel> } {
  const home = mkdtempSync(join(tmpdir(), 'odin-coffre-ecriture-')), dir = join(home, 'valhalla', 'brisingamen');
  mkdirSync(dir, { recursive: true });
  process.env.BRISINGAMEN_KEY = CLE_ESSAI;
  const appels: Appel[] = [], alertes: unknown[] = [];
  let attente: ((a: Appel) => void) | undefined, pris = 0;
  const faux = (url: string): Promise<unknown> => new Promise((ok, non) => {
    const a: Appel = { url: String(url), repondre: (corps) => ok({ ok: true, text: async () => corps }), echouer: () => non(new Error('réseau coupé (essai)')) };
    appels.push(a);
    if (attente) { const f = attente; attente = undefined; pris++; f(a); }
  });
  /** Le prochain appel au réseau : celui déjà parti et pas encore pris, ou celui qui va partir. */
  const prochain = (): Promise<Appel> => (pris < appels.length ? Promise.resolve(appels[pris++]) : new Promise<Appel>((ok) => { attente = ok; }));
  const ctx = { home, dir, settings: {}, saveSettings: () => undefined, now: () => new Date('2026-11-26T08:00:00Z'), fetch: faux, alert: (a: unknown) => { alertes.push(a); } } as unknown as ModCtx;
  return { ctx, dir, appels, alertes, prochain };
}
const fichiers = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? fichiers(p) : [p]; });
const restes = (dir: string) => fichiers(dir).map((f) => f.slice(dir.length + 1));
const noms = (ctx: ModCtx) => load(ctx).map((i) => i.name).sort();

test('Vérifier les fuites : ce qui est rangé au coffre pendant qu\'elle attend le réseau n\'est pas perdu', async () => {
  const { ctx, prochain } = nouveau();
  await action('ajouter').run(ctx, { nom: 'Banque', identifiant: 'awa', mot_de_passe: valeur('banque') });
  const enCours = Promise.resolve(action('fuites').run(ctx, {}));
  const appel = await prochain(); // la vérification attend le réseau
  // Pendant ce temps : un mot de passe ajouté à la main, et un secret reçu dans la conversation.
  await action('ajouter').run(ctx, { nom: 'Ajouté pendant la vérification', mot_de_passe: valeur('ajout') });
  const rang = rangerSecrets(ctx, { role: 'owner', id: 'p', nom: 'Awa' }, [{ nom: 'Reçu pendant la vérification', champ: 'mot de passe', valeur: valeur('recu') }]);
  assert.equal(rang.ok, true);
  appel.repondre('');
  await enCours;
  assert.deepEqual(noms(ctx), ['Ajouté pendant la vérification', 'Banque', 'Reçu pendant la vérification']);
});

test('Vérifier les fuites : réseau en échec, rien n\'est écrit dans le coffre', async () => {
  const { ctx, dir, prochain } = nouveau();
  await action('ajouter').run(ctx, { nom: 'Banque', mot_de_passe: valeur('banque') });
  const enCours = Promise.resolve(action('fuites').run(ctx, {}));
  const appel = await prochain();
  await action('ajouter').run(ctx, { nom: 'Ajouté pendant la panne', mot_de_passe: valeur('ajout') });
  const avant = readFileSync(join(dir, 'coffre.bin'));
  appel.echouer();
  const r = await enCours;
  assert.match(r.text, /Impossible de vérifier/);
  assert.ok(readFileSync(join(dir, 'coffre.bin')).equals(avant), 'le fichier du coffre n\'a pas été touché');
  assert.deepEqual(noms(ctx), ['Ajouté pendant la panne', 'Banque']);
});

test('Vérifier les fuites : réseau en échec après une fuite trouvée, c\'est dit et rien n\'est écrit', async () => {
  const { ctx, dir, alertes, prochain } = nouveau();
  const v = valeur('banque');
  await action('ajouter').run(ctx, { nom: 'Banque', mot_de_passe: v });
  await action('ajouter').run(ctx, { nom: 'Boutique', mot_de_passe: valeur('boutique') });
  const avant = readFileSync(join(dir, 'coffre.bin'));
  const enCours = Promise.resolve(action('fuites').run(ctx, {}));
  (await prochain()).repondre(`${sha1(v).slice(5)}:7`);
  (await prochain()).echouer();
  const r = await enCours;
  assert.match(r.text, /1 mot\(s\) de passe trouvé/);
  assert.match(r.text, /pas (pu )?finir|interrompue/i);
  assert.equal(alertes.length, 1);
  assert.ok(readFileSync(join(dir, 'coffre.bin')).equals(avant), 'le fichier du coffre n\'a pas été touché');
});

test('Vérifier les fuites : seul le résultat « fuite » est reporté, sur les éléments encore là et inchangés', async () => {
  const { ctx, appels, alertes, prochain } = nouveau();
  const mdp = { fuite: valeur('fuite'), sain: valeur('sain'), retire: valeur('retire'), change: valeur('change') };
  for (const [nom, v] of Object.entries(mdp)) await action('ajouter').run(ctx, { nom, mot_de_passe: v });
  const enCours = Promise.resolve(action('fuites').run(ctx, {}));
  const premier = await prochain();
  // Pendant l'attente : un élément est retiré, un autre change de mot de passe, un autre reçoit un identifiant.
  const nouveauMdp = valeur('neuf');
  store(ctx, load(ctx).filter((i) => i.name !== 'retire').map((i): Item => (i.name === 'change' ? { ...i, password: nouveauMdp } : i.name === 'fuite' ? { ...i, user: 'modifié pendant' } : i)));
  // Le service répond « trouvé » pour « fuite », « retire » et « change », et « pas trouvé » pour « sain ».
  const tout = (a: Appel) => a.repondre([mdp.fuite, mdp.retire, mdp.change].map((v) => `${sha1(v).slice(5)}:12`).join('\n'));
  tout(premier);
  for (let i = 1; i < 4; i++) tout(await prochain());
  const r = await enCours;
  assert.equal(appels.length, 4);
  const apres = load(ctx), de = (nom: string) => apres.find((i) => i.name === nom);
  assert.equal(de('retire'), undefined, 'un élément retiré pendant la vérification ne revient pas');
  assert.equal(de('fuite')?.breached, true);
  assert.equal(de('fuite')?.user, 'modifié pendant', 'le reste de l\'élément vient du coffre relu, pas de la lecture du début');
  assert.notEqual(de('sain')?.breached, true);
  assert.equal(de('change')?.password, nouveauMdp, 'le mot de passe changé pendant la vérification est gardé');
  assert.notEqual(de('change')?.breached, true, 'le résultat de l\'ancien mot de passe n\'est pas collé sur le nouveau');
  assert.match(r.text, /1 mot\(s\) de passe trouvé/, 'seul ce qui est encore dans le coffre est compté');
  assert.equal(alertes.length, 1);
});

test('Vérifier les fuites : une fuite d\'avant, plus trouvée aujourd\'hui, est levée', async () => {
  const { ctx, prochain } = nouveau();
  const v = valeur('banque');
  await action('ajouter').run(ctx, { nom: 'Banque', mot_de_passe: v });
  store(ctx, load(ctx).map((i) => ({ ...i, breached: true })));
  const enCours = Promise.resolve(action('fuites').run(ctx, {}));
  (await prochain()).repondre('');
  assert.match((await enCours).text, /Aucun/);
  assert.notEqual(load(ctx)[0].breached, true);
});

test('Vérifier les fuites : ce qui part sur le réseau n\'a pas changé (5 caractères d\'empreinte, rien d\'autre)', async () => {
  const { ctx, appels, prochain } = nouveau();
  const v = valeur('banque');
  await action('ajouter').run(ctx, { nom: 'Banque', identifiant: 'awa@exemple.yt', mot_de_passe: v, site: 'https://banque.exemple' });
  const enCours = Promise.resolve(action('fuites').run(ctx, {}));
  (await prochain()).repondre(`${sha1(v).slice(5)}:0`);
  const r = await enCours;
  assert.deepEqual(appels.map((a) => a.url), [`https://api.pwnedpasswords.com/range/${sha1(v).slice(0, 5)}`]);
  assert.match(r.text, /Aucun/);
  assert.notEqual(load(ctx)[0].breached, true, 'une ligne de remplissage (« :0 ») n\'est pas une fuite');
});

test('Écriture du coffre : une coupure pendant l\'écriture laisse l\'ancien coffre entier et lisible', async () => {
  const { ctx, dir } = nouveau();
  await action('ajouter').run(ctx, { nom: 'Banque', mot_de_passe: valeur('banque') });
  const avant = readFileSync(join(dir, 'coffre.bin'));
  // La coupure : l'écriture d'un fichier s'arrête à la moitié des octets, puis échoue.
  const vraie = fs.writeFileSync;
  fs.writeFileSync = ((chemin: fs.PathOrFileDescriptor, donnees: Uint8Array, o?: fs.WriteFileOptions) => { vraie(chemin, Buffer.from(donnees).subarray(0, Math.floor(donnees.length / 2)), o); throw new Error('coupure (essai)'); }) as typeof fs.writeFileSync;
  syncBuiltinESMExports();
  try {
    assert.throws(() => action('ajouter').run(ctx, { nom: 'Pendant la coupure', mot_de_passe: valeur('coupure') }), /coupure/);
    assert.throws(() => store(ctx, []), /coupure/);
  } finally { fs.writeFileSync = vraie; syncBuiltinESMExports(); }
  assert.ok(readFileSync(join(dir, 'coffre.bin')).equals(avant), 'l\'ancien coffre est resté tel quel');
  assert.deepEqual(noms(ctx), ['Banque']);
  assert.deepEqual(restes(dir), ['coffre.bin'], 'aucun fichier à moitié écrit ne reste à côté');
});

test('Écriture du coffre : la mise en place échoue, l\'ancien coffre reste et rien ne traîne à côté', async () => {
  const { ctx, dir } = nouveau();
  await action('ajouter').run(ctx, { nom: 'Banque', mot_de_passe: valeur('banque') });
  const avant = readFileSync(join(dir, 'coffre.bin'));
  const vraie = fs.renameSync;
  fs.renameSync = (() => { throw new Error('mise en place refusée (essai)'); }) as typeof fs.renameSync;
  syncBuiltinESMExports();
  try { assert.throws(() => action('ajouter').run(ctx, { nom: 'Refusé', mot_de_passe: valeur('refus') }), /mise en place refusée/); }
  finally { fs.renameSync = vraie; syncBuiltinESMExports(); }
  assert.ok(readFileSync(join(dir, 'coffre.bin')).equals(avant));
  assert.deepEqual(restes(dir), ['coffre.bin']);
  // Et l'écriture suivante passe : rien n'est resté bloqué.
  await action('ajouter').run(ctx, { nom: 'Ensuite', mot_de_passe: valeur('ensuite') });
  assert.deepEqual(noms(ctx), ['Banque', 'Ensuite']);
});

test('Écriture du coffre : ce qui est écrit à côté est chiffré, et il n\'en reste rien', async () => {
  const { ctx, dir } = nouveau();
  const v = valeur('banque');
  const vus: Array<{ chemin: string; octets: Buffer }> = [];
  const vraie = fs.writeFileSync;
  fs.writeFileSync = ((chemin: fs.PathOrFileDescriptor, donnees: Uint8Array, o?: fs.WriteFileOptions) => { vus.push({ chemin: String(chemin), octets: Buffer.from(donnees) }); vraie(chemin, donnees, o); }) as typeof fs.writeFileSync;
  syncBuiltinESMExports();
  try { await action('ajouter').run(ctx, { nom: 'Banque', mot_de_passe: v }); }
  finally { fs.writeFileSync = vraie; syncBuiltinESMExports(); }
  assert.equal(vus.length, 1);
  assert.notEqual(vus[0].chemin, join(dir, 'coffre.bin'), 'le coffre n\'est jamais écrit sur place');
  assert.ok(vus[0].chemin.startsWith(dir), 'le fichier d\'à côté est dans le dossier du coffre (même disque, mise en place d\'un geste)');
  assert.equal(vus[0].octets.includes(Buffer.from(v, 'utf8')) || vus[0].octets.includes(Buffer.from('Banque', 'utf8')), false, 'rien n\'est écrit en clair, même un instant');
  assert.deepEqual(restes(dir), ['coffre.bin']);
  assert.ok(existsSync(join(dir, 'coffre.bin')));
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'coffre.bin')).mode & 0o777, 0o600);
  assert.equal(load(ctx)[0].password, v);
});

test('Deux vérifications des fuites en même temps, et des ajouts entre les deux : rien ne se perd', async () => {
  const { ctx, prochain } = nouveau();
  const v = valeur('banque');
  await action('ajouter').run(ctx, { nom: 'Banque', mot_de_passe: v });
  const une = Promise.resolve(action('fuites').run(ctx, {}));
  const a1 = await prochain();
  await action('ajouter').run(ctx, { nom: 'Entre les deux', mot_de_passe: valeur('entre') });
  const deux = Promise.resolve(action('fuites').run(ctx, {}));
  const a2 = await prochain();
  await action('ajouter').run(ctx, { nom: 'Après les deux', mot_de_passe: valeur('apres') });
  a1.repondre(`${sha1(v).slice(5)}:3`);
  await une;
  a2.repondre(`${sha1(v).slice(5)}:3`);
  (await prochain()).repondre(''); // la seconde vérification connaît aussi « Entre les deux »
  await deux;
  assert.deepEqual(noms(ctx), ['Après les deux', 'Banque', 'Entre les deux']);
  assert.equal(load(ctx).find((i) => i.name === 'Banque')?.breached, true);
});
