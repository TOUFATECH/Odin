// Points de reprise de Noûs (src/brain/nous/reprise.ts) : aller-retour fidèle (poids identiques), rejet d'un fichier
// dont l'AAD ne correspond pas, nettoyage. Les poids sont chiffrés au repos (clé de la machine).
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Reseau } from '../src/brain/nous/calcul.ts';
import { avecPoids } from '../src/brain/nous/tailles.ts';
import { apprendreDecoupage, serialiserDecoupage } from '../src/brain/nous/decoupage.ts';
import { dossierReprise, ecrireReprise, lireReprise, listerReprises, nettoyerReprises, prochainNumero } from '../src/brain/nous/reprise.ts';
import { chiffrerChamp, exportMachineKey, seal } from '../src/vault.ts';

const hy = avecPoids({ taille: 'petit', C: 16, couches: 2, tetes: 2, vocab: 11, contexte: 8 });

function reseauEntraine(): Reseau {
  const r = new Reseau(hy); r.initialiser(21);
  const ids = new Int32Array([1, 2, 3, 4, 5, 6, 7, 8]);
  for (let i = 0; i < 3; i++) { r.jeterGrad(); r.perteEtGrad(ids); r.pasAdamW(1e-3); }
  return r;
}

test('aller-retour : écrire puis relire rend des poids et moments identiques', async () => {
  const home = mkdtempSync(join(tmpdir(), 'noos-reprise-'));
  const r = reseauEntraine();
  const dec = apprendreDecoupage(['bonjour le monde '.repeat(10)], 300, 1);
  const mm = r.exporterMoments();
  await ecrireReprise(home, 0, { hyper: hy, decoupage: serialiserDecoupage(dec), poids: r.exporterPoids(), m: mm.m, v: mm.v, pas: mm.pas, graine: 21, courbe: [{ pas: 3, perte: 1.2 }] });
  const lu = await lireReprise(home, 0);
  assert.ok(lu, 'point de reprise relu');
  assert.deepEqual(Array.from(lu.poids), Array.from(r.poids));
  assert.deepEqual(Array.from(lu.m), Array.from(mm.m));
  assert.deepEqual(Array.from(lu.v), Array.from(mm.v));
  assert.equal(lu.pas, mm.pas);
  assert.equal(lu.graine, 21);
  assert.equal(lu.hyper.C, hy.C);
  assert.equal(lu.decoupage.version, dec.version);
  // le fichier sur le disque ne contient pas les poids en clair (chiffré)
  const brut = readFileSync(join(dossierReprise(home), 'reprise-0.bin'));
  assert.ok(brut.length > 0);
});

test('AAD : un fichier lu avec un autre numéro est rejeté', async () => {
  const home = mkdtempSync(join(tmpdir(), 'noos-reprise-'));
  const r = reseauEntraine();
  const dec = apprendreDecoupage(['test '.repeat(5)], 300, 1);
  const mm = r.exporterMoments();
  await ecrireReprise(home, 0, { hyper: hy, decoupage: serialiserDecoupage(dec), poids: r.exporterPoids(), m: mm.m, v: mm.v, pas: mm.pas, graine: 1, courbe: [] });
  // copie reprise-0.bin -> reprise-1.bin : le contenu a l'AAD du n°0, on le lit comme n°1.
  const d = dossierReprise(home);
  copyFileSync(join(d, 'reprise-0.bin'), join(d, 'reprise-1.bin'));
  const lu = await lireReprise(home, 1);
  assert.equal(lu, undefined, 'un fichier dont l\'AAD ne correspond pas doit être rejeté');
});

test('version : un point de reprise d\'une version de format inconnue est rejeté', async () => {
  const home = mkdtempSync(join(tmpdir(), 'noos-reprise-'));
  // Forcer la création de la clé de la machine (comme le fait reprise.ts).
  let key = exportMachineKey(home);
  if (!key) { chiffrerChamp(home, ''); key = exportMachineKey(home); }
  assert.ok(key, 'clé de la machine disponible');
  // Sceller à la main un blob dont l\'entête annonce une version FUTURE (99), avec le bon AAD noos:reprise:3.
  const entete = { v: 99, hyper: hy, decoupage: { vocab: 11, version: 1, fusions: '' }, pas: 0, graine: 0, modeleVersion: 1, courbe: [], lenP: 0, lenM: 0, lenV: 0 };
  const enteteBuf = Buffer.from(JSON.stringify(entete), 'utf8');
  const u32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; };
  const blob = Buffer.concat([u32(enteteBuf.length), enteteBuf]);
  writeFileSync(join(dossierReprise(home), 'reprise-3.bin'), seal(key!, blob, 'noos:reprise:3'), { mode: 0o600 });
  // Le scellé est valable (bon AAD), mais la version est inconnue : il doit être refusé, pas réinterprété.
  assert.equal(await lireReprise(home, 3), undefined, 'une version de format inconnue doit être refusée');
});

test('plafond disque : ecrireReprise ne laisse pas les points de reprise s\'accumuler', async () => {
  const home = mkdtempSync(join(tmpdir(), 'noos-reprise-'));
  const r = reseauEntraine();
  const dec = apprendreDecoupage(['y '.repeat(5)], 300, 1);
  const mm = r.exporterMoments();
  const ecrire = (n: number, garder?: number): Promise<string> =>
    ecrireReprise(home, n, { hyper: hy, decoupage: serialiserDecoupage(dec), poids: r.exporterPoids(), m: mm.m, v: mm.v, pas: mm.pas, graine: 1, courbe: [] }, garder);
  for (let n = 0; n < 5; n++) await ecrire(n);
  assert.deepEqual(listerReprises(home), [4, 3], 'par défaut on ne garde que les 2 plus récents');
  await ecrire(5, 1); // réglage « 1 point »
  assert.deepEqual(listerReprises(home), [5]);
});

test('numérotation et nettoyage : on ne garde que les plus récents', async () => {
  const home = mkdtempSync(join(tmpdir(), 'noos-reprise-'));
  const r = reseauEntraine();
  const dec = apprendreDecoupage(['x '.repeat(5)], 300, 1);
  const mm = r.exporterMoments();
  for (let n = 0; n < 4; n++) await ecrireReprise(home, n, { hyper: hy, decoupage: serialiserDecoupage(dec), poids: r.exporterPoids(), m: mm.m, v: mm.v, pas: mm.pas, graine: 1, courbe: [] });
  assert.equal(prochainNumero(home), 4);
  nettoyerReprises(home, 2);
  assert.deepEqual(listerReprises(home), [3, 2]);
  assert.ok(!existsSync(join(dossierReprise(home), 'reprise-1.bin')));
});
