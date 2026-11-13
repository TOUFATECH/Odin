// Les ports de toutes les applis : bien définis, sans doublon, et jamais donnés à une appli installée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appPort, APP_PORTS, conflicts, describe, ODIN_PORTS, reserved, WEB } from '../src/valhalla/ports.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

test('ports : aucun doublon, chaque appli installée a son port fixe dans sa plage', () => {
  assert.deepEqual(conflicts(), []);
  assert.equal(appPort('n8nio/n8n:1.120')?.host, 20010); assert.equal(appPort('docker.io/library/nginx')?.inner, 80); assert.equal(appPort('busybox'), undefined);
  const r = reserved(); for (const p of [WEB, 53, 67, 69, 80, 443, 1883, 51820, 20010]) assert.ok(r.has(p), `${p} réservé`);
  assert.ok(!r.has(5432), 'la base d\'Odin reste interne (pas publiée)');
  assert.equal(describe('vidarr'), '53, 67 UDP · 53, 853 TCP'); assert.equal(describe('saga'), `${WEB} (interface d'Odin)`);
  assert.equal(new Set(APP_PORTS.map((a) => a.host)).size, APP_PORTS.length);
});
test('ports : le registre dit la même chose que le code des applis', () => {
  assert.equal(DEFAULT_CONFIG.web.port, WEB);
  const th = readFileSync(new URL('../src/valhalla/modules/thjalfi.ts', import.meta.url), 'utf8');
  for (const [k, v] of Object.entries({ http: 16000, tftp: 69, dhcp: 67, pxe: 4011 })) { assert.match(th, new RegExp(`${k}: ${v}\\b`)); assert.ok(ODIN_PORTS.some((p) => p.app === 'thjalfi' && p.port === v)); }
  const lk = readFileSync(new URL('../src/valhalla/modules/loki.ts', import.meta.url), 'utf8');
  for (const m of lk.matchAll(/port: ([1-9]\d*)/g)) assert.ok(ODIN_PORTS.some((p) => p.app === 'loki' && p.port === Number(m[1])), `piège ${m[1]} au registre`);
  assert.ok(/settings\.port \?\? 1883/.test(readFileSync(new URL('../src/valhalla/modules/appareils.ts', import.meta.url), 'utf8')));
});
