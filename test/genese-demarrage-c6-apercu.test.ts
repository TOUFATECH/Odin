// Genèse · lot C6 : l'APERÇU de l'écran de démarrage dans la page (onglet Démarrage des clés, et Systèmes pour le
// réseau). Il doit montrer EXACTEMENT ce qui est servi : mêmes fonctions, même style, même squelette que la page
// /ecran et que la copie de la clé. Fichier de navigateur servi tel quel : on le charge dans un bac à sable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { ecranPage } from '../src/valhalla/thjalfi/ecran-page.ts';

const url = new URL('../src/web/pages/thjalfi-cle-menu.js', import.meta.url);
type Ecran = { page(): string; css(): string; corps(): string; demarrer: { toString(): string }; logique: Record<string, { toString(): string }>; etatApercu(e: unknown[], o: Record<string, unknown>): Record<string, unknown> };
const charger = () => { const window: { OdinGeneseCleMenu?: { monterApercu: unknown; ouvrir: unknown; ecran: Ecran } } = {}; runInNewContext(readFileSync(url, 'utf8'), { window }); return window.OdinGeneseCleMenu!; };
const ici = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

test('aperçu : le fichier passe node --check et expose monterApercu et l\'écran partagé', () => {
  execFileSync(process.execPath, ['--check', fileURLToPath(url)]);
  const M = charger();
  assert.equal(typeof M.monterApercu, 'function');
  assert.equal(typeof M.ouvrir, 'function');
  assert.equal(typeof M.ecran.page, 'function');
});

test('aperçu = page servie : le même code (demarrer, logique), le même style, le même squelette', () => {
  const E = charger().ecran, p = ecranPage();
  assert.ok(p.includes(E.demarrer.toString()), 'la page servie contient la fonction même de l\'aperçu');
  for (const [k, f] of Object.entries(E.logique)) assert.ok(p.includes(`${k}:${f.toString()}`), `logique ${k}`);
  assert.ok(p.includes(E.css()), 'le même style');
  assert.ok(p.includes(E.corps()), 'le même squelette');
});

test('aperçu : exemples sans donnée personnelle ; la clé démarre son 1er système, le réseau le disque du PC', () => {
  const E = charger().ecran;
  const cle = ici(E.etatApercu([], { source: 'cle' }));
  assert.equal(cle.exemple, true);
  assert.equal(cle.defaut, 'w11');
  assert.ok(!(cle.systemes as Array<{ modes: string[] }>).some((s) => s.modes.includes('auto')), 'pas d\'« Installer pour moi » sur la clé');
  const res = ici(E.etatApercu([], { source: 'reseau' }));
  assert.equal(res.defaut, 'disque');
  assert.ok((res.systemes as Array<{ modes: string[] }>).some((s) => s.modes.includes('auto')), '« Installer pour moi » par le réseau');
  // Les vraies entrées de la clé, dans leur ordre, avec le défaut choisi et le thème des clés.
  const vrai = ici(E.etatApercu([{ nom: 'Debian 12 (installé)', genre: 'installe', famille: 'linux' }, { nom: 'Windows 11 (ISO)', genre: 'iso', famille: 'windows', defaut: true }, { nom: 'notes.txt', demarrable: false }], { source: 'cle', theme: 'lune', delai: 5 }));
  assert.deepEqual((vrai.systemes as Array<{ title: string }>).map((s) => s.title), ['Debian 12', 'Windows 11']);
  assert.equal(vrai.defaut, 'e1');
  assert.equal(vrai.theme, 'lune');
  assert.equal(vrai.delai, 5);
  assert.doesNotMatch(JSON.stringify(cle) + JSON.stringify(res), /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|[0-9a-f]{2}(:[0-9a-f]{2}){5}/i, 'ni adresse, ni machine');
});
