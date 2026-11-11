// Les scénarios simulés du banc d'essai (Proxmox, module Tasmota, Telegram) rejoués à chaque
// `npm test` : ils n'ont besoin que de Node. Les scénarios contre de vrais services (Docker,
// pare-feu, WireGuard, caméras, Venus, Home Assistant, GitHub, serveurs MCP) se lancent avec
// `npm run banc`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIMULES } from './banc/banc.ts';
import { runScenario } from './banc/lib.ts';
import { parseMultipart } from './banc/sim/telegram.ts';

for (const s of SIMULES) {
  test(`banc d'essai (simulé) : ${s.title}`, async () => {
    const r = await runScenario(s);
    const failed = r.checks.filter((c) => !c.ok).map((c) => `${c.name} → ${c.detail ?? ''}`);
    assert.notEqual(r.status, 'échoué', `${r.why ?? ''}\n${failed.join('\n')}`);
    if (r.status === 'réussi') assert.ok(r.checks.length >= 15, 'le scénario fait de vraies vérifications');
  });
}

test('simulateur Telegram : lecture d\'un envoi de fichier (multipart)', () => {
  const b = 'frontiere123', body = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n42\r\n--${b}\r\nContent-Disposition: form-data; name="photo"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), Buffer.from([0xff, 0xd8, 0x0d, 0x0a, 0x2d, 0x2d, 0xff, 0xd9]), Buffer.from(`\r\n--${b}--\r\n`)]);
  const p = parseMultipart(body, `multipart/form-data; boundary=${b}`);
  assert.equal(p.chat_id, '42');
  const f = p.photo as { name: string; type: string; data: Buffer };
  assert.equal(f.name, 'a.jpg'); assert.equal(f.type, 'image/jpeg');
  assert.deepEqual([...f.data], [0xff, 0xd8, 0x0d, 0x0a, 0x2d, 0x2d, 0xff, 0xd9], 'les octets du fichier sont intacts, même avec des retours à la ligne dedans');
});
