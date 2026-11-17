// github_app, avant la vraie cage : un dépôt venu d'un lien ne se lance pas sur la machine d'Odin sans que tu voies ce
// que son fichier Compose monte et ouvre ; jamais le dossier d'Odin, son code, le coffre, la racine ou Docker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { analyserCompose, resumeMontages, githubApp } from '../src/tools/apps.ts';
import { RACINE_APPLI } from '../src/heimdall/noyau.ts';

const HOME = join('/home/proprio', '.odin');
const o = { dossierDepot: '/home/proprio/.odin/apps/depot', interditsHote: [HOME, RACINE_APPLI] };

test('un Compose qui monte le dossier d\'Odin, la racine ou la commande de Docker est repéré (refusé au lancement)', () => {
  assert.deepEqual(analyserCompose('services:\n  app:\n    volumes:\n      - /home/proprio/.odin:/data\n', o).interdits, ['/home/proprio/.odin']);
  assert.deepEqual(analyserCompose('services:\n  app:\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n', o).interdits, ['/var/run/docker.sock']);
  assert.deepEqual(analyserCompose('services:\n  app:\n    volumes:\n      - /:/host\n', o).interdits, ['/']);
  assert.deepEqual(analyserCompose(`services:\n  app:\n    volumes:\n      - ${RACINE_APPLI}/src:/code\n`, o).interdits.length, 1);
  assert.deepEqual(analyserCompose('services:\n  app:\n    volumes:\n      - ../..:/tout\n', o).interdits, ['../..'], 'remonter jusqu\'au dossier d\'Odin');
});

test('ce que tu vois : dossiers, ports, réseau de la machine, privilèges', () => {
  const m = analyserCompose('services:\n  web:\n    image: x\n    network_mode: host\n    privileged: true\n    ports:\n      - "8080:80"\n    volumes:\n      - ./data:/data\n      - nommé:/var/lib\n    cap_add:\n      - NET_ADMIN\n', o);
  assert.deepEqual(m.interdits, []);
  const r = resumeMontages(m);
  assert.match(r, /dossiers de la machine montés : \.\/data/); assert.match(r, /ports ouverts : 8080:80/);
  assert.match(r, /tout le réseau de la maison/); assert.match(r, /privileged.*cap_add NET_ADMIN/);
});

test('installer un dépôt venu d\'un lien est toujours « grave » (ton accord, même en Breaker) ; chercher et analyser ne le sont pas', () => {
  assert.match(githubApp.grave!({ action: 'installer', cible: 'quelquun/appli' }) ?? '', /lancer sur la machine d'Odin, sans cage, un dépôt venu d'un lien/);
  assert.equal(githubApp.grave!({ action: 'analyser', cible: 'quelquun/appli' }), undefined);
  assert.equal(githubApp.grave!({ action: 'chercher', cible: 'notion' }), undefined);
});
