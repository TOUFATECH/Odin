// Première connexion par le téléphone (comme une télé) : l'écran montre un code et un QR code, le téléphone
// crée le compte avec le code, l'écran entre tout seul ; un mauvais code est refusé ; la mascotte est là.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gateway } from '../src/bifrost/gateway.ts';
import { WebChannel, ensureWebToken } from '../src/web/server.ts';
import { makeOdin } from './helpers.ts';

test('première connexion : code + QR code sur l\'écran, compte créé sur le téléphone, l\'écran s\'ouvre tout seul', async () => {
  const o = makeOdin([]);
  const port = 21000 + Math.floor(Math.random() * 20000), token = ensureWebToken(o.paths);
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  gw.add(new WebChannel(o, { scanNetwork: () => gw.scanNetwork(false) }, { port, host: '127.0.0.1', token, scryptN: 1024 }));
  await gw.start();
  const B = `http://127.0.0.1:${port}`, H = { 'x-odin': '1', 'content-type': 'application/json' };
  try {
    // La page du téléphone : la mascotte, le champ du code, le formulaire.
    const page = await (await fetch(`${B}/activer?c=ABC123`)).text();
    assert.match(page, /viewBox="0 0 120 120"/, 'la mascotte est sur la page du téléphone'); assert.match(page, /id="code"[\s\S]*id="pn"[\s\S]*id="em"[\s\S]*id="pw"/);
    // L'écran (avec le lien de première connexion) demande un code.
    const s = await (await fetch(`${B}/api/setup/start`, { method: 'POST', headers: { ...H, authorization: `Bearer ${token}` } })).json() as { ok: boolean; code: string; secret: string; url: string; svg: string; short: string };
    assert.equal(s.ok, true); assert.match(s.code, /^[A-HJ-NP-Z2-9]{6}$/); assert.match(s.url, new RegExp(`/activer\\?c=${s.code}$`)); assert.match(s.svg, /^<svg/); assert.match(s.short, /\/activer$/);
    assert.equal((await (await fetch(`${B}/api/setup/status`, { method: 'POST', headers: { 'x-odin': '1', 'x-setup': s.secret } })).json() as { state: string }).state, 'attente');
    // Un mauvais code est refusé.
    const bad = await fetch(`${B}/api/account/create`, { method: 'POST', headers: H, body: JSON.stringify({ code: 'ZZZZZZ', prenom: 'Awa', nom: 'Essai', email: 'awa@exemple.fr', password: 'une phrase assez longue 42' }) });
    assert.equal(bad.status, 403); assert.match((await bad.json() as { error: string }).error, /Code inconnu ou expiré/);
    // Le téléphone crée le compte avec le bon code (en minuscules, avec un espace : toléré).
    const ok = await fetch(`${B}/api/account/create`, { method: 'POST', headers: H, body: JSON.stringify({ code: ` ${s.code.toLowerCase()} `, prenom: 'Awa', nom: 'Essai', email: 'awa@exemple.fr', password: 'une phrase assez longue 42' }) });
    assert.equal(ok.status, 200); assert.match(ok.headers.get('set-cookie') ?? '', /odin_session=/, 'le téléphone est connecté aussi');
    // L'écran l'apprend au tour suivant et reçoit sa propre session.
    const st = await fetch(`${B}/api/setup/status`, { method: 'POST', headers: { 'x-odin': '1', 'x-setup': s.secret } });
    assert.equal((await st.json() as { state: string }).state, 'fait'); assert.match(st.headers.get('set-cookie') ?? '', /odin_session=/, 'l\'écran entre tout seul');
    assert.equal((await (await fetch(`${B}/api/setup/status`, { method: 'POST', headers: { 'x-odin': '1', 'x-setup': s.secret } })).json() as { state: string }).state, 'inconnu', 'le code ne sert qu\'une fois');
    // Compte créé : plus de code, la page du téléphone renvoie vers la connexion.
    assert.equal((await fetch(`${B}/api/setup/start`, { method: 'POST', headers: { ...H, authorization: `Bearer ${token}` } })).status, 409);
    assert.equal((await fetch(`${B}/activer`, { redirect: 'manual' })).status, 302);
  } finally { await gw.stop(); }
});
