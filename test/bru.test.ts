// Brú, le tunnel Cloudflare : face à une fausse API Cloudflare, un faux GitHub et un faux programme
// cloudflared. Création du tunnel, publication (règle + DNS), refus d'écraser un DNS existant, retrait (seulement
// ce qu'Odin a ajouté), Odin publié sous ton domaine, programme téléchargé et vérifié, jamais exécuté sans empreinte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { assetName, bridgeGraph, bru, withRule, withoutRule } from '../src/valhalla/modules/bru.ts';
import { ProxyServer, visitor } from '../src/valhalla/valgrind/proxy.ts';

test('nom du programme et règles du tunnel', () => {
  assert.equal(assetName('linux', 'x64'), 'cloudflared-linux-amd64');
  assert.equal(assetName('linux', 'arm64'), 'cloudflared-linux-arm64');
  assert.equal(assetName('win32', 'x64'), 'cloudflared-windows-amd64.exe');
  assert.throws(() => assetName('darwin', 'arm64'), /brew/);
  let l = withRule([{ service: 'http_status:404' }], 'nas.exemple.fr', 'https://localhost:443');
  l = withRule(l, 'odin.exemple.fr', 'http://localhost:4000', 'localhost');
  l = withRule(l, 'nas.exemple.fr', 'https://localhost:8443');
  assert.deepEqual(l.map((r) => r.hostname ?? r.service), ['odin.exemple.fr', 'nas.exemple.fr', 'http_status:404'], 'remplacé, 404 toujours en dernier');
  assert.deepEqual(l[1].originRequest, { httpHostHeader: 'nas.exemple.fr', noTLSVerify: true, originServerName: 'nas.exemple.fr' });
  assert.deepEqual(l[0].originRequest, { httpHostHeader: 'localhost' });
  assert.deepEqual(withoutRule(l, 'nas.exemple.fr').map((r) => r.hostname ?? r.service), ['odin.exemple.fr', 'http_status:404']);
  const g = bridgeGraph({ id: 'abcdef123456', name: 'odin', account: 'acc' }, [{ hostname: 'nas.exemple.fr', service: 'https://localhost:443', zone: 'exemple.fr', zoneId: 'z1', at: 0 }], true, { status: 'healthy', connections: 4 });
  assert.ok(g.nodes.some((n) => n.id === 'z:exemple.fr') && g.details['h:nas.exemple.fr'] && g.edges.some((e) => e.a === 'cloudflare' && e.b === 'odin' && e.w === 4));
});

test('vraie adresse du visiteur : seulement si la connexion vient de la machine elle-même (le tunnel)', async () => {
  const seen: string[] = [];
  const s = http.createServer((q, r) => { seen.push(visitor(q)); r.end('ok'); });
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', () => ok()));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise<void>((ok) => http.get({ host: '127.0.0.1', port, headers: { 'cf-connecting-ip': '203.0.113.9' } }, (r) => { r.resume(); r.on('end', ok); }));
  s.close();
  assert.equal(seen[0], '203.0.113.9');
  assert.ok(ProxyServer);
});

/** Une fausse API Cloudflare (zones, tunnels, configuration, DNS) + un faux GitHub qui sert le programme. */
function fakeCloud(bin: string, o: { digest?: boolean } = {}) {
  const st = {
    tunnels: [] as Array<{ id: string; name: string }>, ingress: [] as unknown[],
    dns: [{ id: 'r-old', type: 'A', name: 'site.exemple.fr', content: '198.51.100.7' }, { id: 'r-mx', type: 'MX', name: 'exemple.fr', content: 'mail.exemple.fr' }] as Array<{ id: string; type: string; name: string; content: string; proxied?: boolean }>,
    calls: [] as string[], auth: new Set<string>(),
  };
  const sha = createHash('sha256').update(bin).digest('hex');
  const ok = (result: unknown) => new Response(JSON.stringify({ success: true, result, errors: [] }), { headers: { 'content-type': 'application/json' } });
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const u = new URL(String(input)), m = init.method ?? 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (u.host === 'api.github.com') return new Response(JSON.stringify({ tag_name: '2026.10.7', body: '', assets: [{ name: assetName(), browser_download_url: 'https://github.com/dl/cloudflared', ...(o.digest === false ? {} : { digest: `sha256:${sha}` }) }] }));
    if (u.host === 'github.com') return new Response(bin);
    assert.equal(u.host, 'api.cloudflare.com');
    st.auth.add(String((init.headers as Record<string, string>).authorization));
    const p = u.pathname.replace('/client/v4', ''); st.calls.push(`${m} ${p}`);
    if (p === '/user/tokens/verify') return ok({ status: 'active' });
    if (p === '/zones') { const n = u.searchParams.get('name'); return ok([{ id: 'z1', name: 'exemple.fr', account: { id: 'acc' }, status: 'active' }].filter((z) => !n || z.name === n)); }
    if (p === '/accounts/acc/cfd_tunnel' && m === 'GET') return ok(st.tunnels.filter((t) => t.name === u.searchParams.get('name')));
    if (p === '/accounts/acc/cfd_tunnel' && m === 'POST') { assert.equal(body.config_src, 'cloudflare'); const t = { id: 'tun-1234-5678', name: body.name }; st.tunnels.push(t); return ok(t); }
    if (p === '/accounts/acc/cfd_tunnel/tun-1234-5678/token') return ok('JETON-DU-TUNNEL-SECRET');
    if (p === '/accounts/acc/cfd_tunnel/tun-1234-5678/configurations') { if (m === 'PUT') { st.ingress = body.config.ingress; return ok({}); } return ok({ config: { ingress: st.ingress } }); }
    if (p === '/accounts/acc/cfd_tunnel/tun-1234-5678') return ok({ status: 'healthy', connections: [{}, {}, {}, {}] });
    if (p === '/zones/z1/dns_records' && m === 'GET') return ok(st.dns.filter((r) => r.name === u.searchParams.get('name')));
    if (p === '/zones/z1/dns_records' && m === 'POST') { const r = { id: `r-${st.dns.length}`, ...body }; st.dns.push(r); return ok(r); }
    const del = /^\/zones\/z1\/dns_records\/(.+)$/.exec(p);
    if (del && m === 'DELETE') { st.dns = st.dns.filter((r) => r.id !== del[1]); return ok({ id: del[1] }); }
    return new Response(JSON.stringify({ success: false, errors: [{ message: `inconnu ${m} ${p}` }] }), { status: 404 });
  };
  return { st, fetch: fetch as typeof globalThis.fetch };
}

test('tunnel : création, publication (DNS + règle), refus d\'écraser, Odin publié, programme vérifié, retrait', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bru-'));
  const saved = process.env.CLOUDFLARE_API_TOKEN;
  // Un faux cloudflared : vérifie qu'il reçoit le jeton par l'environnement (jamais en argument) puis attend.
  const bin = '#!/bin/sh\n[ -n "$TUNNEL_TOKEN" ] && echo "Registered tunnel connection connIndex=0 args=$*"\nexec sleep 30\n';
  const cloud = fakeCloud(bin);
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 0, out: '', err: '' }), fetch: cloud.fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  const b = (a: string, i: Record<string, unknown> = {}) => v.act('bru', a, i);
  try {
    delete process.env.CLOUDFLARE_API_TOKEN;
    assert.match((await b('creer', { domaine: 'exemple.fr' })).text, /clé Cloudflare absente/);
    process.env.CLOUDFLARE_API_TOKEN = 'cle-de-test-cloudflare-123456';
    assert.match((await b('verifier')).text, /active.*exemple\.fr/);
    assert.match((await b('publier', { domaine: 'nas.exemple.fr' })).text, /crée d'abord le tunnel/);

    // Création (le nom complet suffit : Odin remonte jusqu'au domaine).
    const c = await b('creer', { domaine: 'odin.exemple.fr' });
    assert.ok(c.ok, c.text); assert.match(c.text, /créé/);
    assert.equal(readFileSync(join(v.ctx('bru').dir, 'jeton-tunnel'), 'utf8'), 'JETON-DU-TUNNEL-SECRET');
    assert.equal(statSync(join(v.ctx('bru').dir, 'jeton-tunnel')).mode & 0o777, 0o600, 'jeton lisible par Odin seul');
    assert.deepEqual(cloud.st.ingress, [{ service: 'http_status:404' }]);
    assert.match((await b('creer', { domaine: 'exemple.fr' })).text, /existe déjà/);
    assert.deepEqual([...cloud.st.auth], ['Bearer cle-de-test-cloudflare-123456'], 'clé envoyée seulement à Cloudflare');

    // Publication d'un nom : CNAME proxifié vers le tunnel + règle vers le proxy Valgrind.
    v.ctx('bru').saveSettings({ proxyHttps: 8443 });
    const p = await b('publier', { domaine: 'NAS.exemple.fr' });
    assert.ok(p.ok, p.text);
    const cname = cloud.st.dns.find((r) => r.name === 'nas.exemple.fr')!;
    assert.deepEqual([cname.type, cname.content, cname.proxied], ['CNAME', 'tun-1234-5678.cfargotunnel.com', true]);
    assert.deepEqual(cloud.st.ingress.map((r) => (r as { hostname?: string; service: string }).hostname ?? (r as { service: string }).service), ['nas.exemple.fr', 'http_status:404']);
    assert.equal((cloud.st.ingress[0] as { service: string }).service, 'https://localhost:8443');
    // Republier ne crée pas de doublon.
    await b('publier', { domaine: 'nas.exemple.fr' });
    assert.equal(cloud.st.dns.filter((r) => r.name === 'nas.exemple.fr').length, 1);

    // Un DNS existant n'est jamais écrasé sans accord.
    const r1 = await b('publier', { domaine: 'site.exemple.fr', cible: 'http://192.168.1.20:8080' });
    assert.equal(r1.ok, false); assert.match(r1.text, /A → 198\.51\.100\.7.*Remplacer/);
    assert.ok(cloud.st.dns.some((r) => r.id === 'r-old'));
    assert.ok((await b('publier', { domaine: 'site.exemple.fr', cible: 'http://192.168.1.20:8080', remplacer: true })).ok);
    assert.ok(!cloud.st.dns.some((r) => r.id === 'r-old'), 'remplacé quand c\'est voulu');
    assert.match((await b('publier', { domaine: 'x.exemple.fr', cible: 'file:///etc/passwd' })).text, /cible invalide/);
    assert.match((await b('publier', { domaine: 'pas un nom' })).text, /nom invalide/);

    // Odin lui-même sous ton domaine : vers son interface, nom transmis « localhost ».
    const o = await b('publier_odin', { domaine: 'odin.exemple.fr' });
    assert.ok(o.ok, o.text); assert.match(o.text, /téléphone/);
    const rule = cloud.st.ingress.find((r) => (r as { hostname?: string }).hostname === 'odin.exemple.fr') as { service: string; originRequest: { httpHostHeader: string } };
    assert.equal(rule.service, `${DEFAULT_CONFIG.web.tls.enabled ? 'https' : 'http'}://localhost:${DEFAULT_CONFIG.web.port}`); assert.equal(rule.originRequest.httpHostHeader, 'localhost');

    // Démarrage : programme téléchargé, empreinte vérifiée, jeton par l'environnement.
    v.ctx('bru').saveSettings({ waitMs: 400 });
    const d = await b('demarrer');
    assert.ok(d.ok, d.text); assert.match(d.text, /en bonne santé, 4 connexion/);
    const file = join(v.ctx('bru').home, 'bin', 'cloudflared');
    assert.ok(existsSync(file)); assert.equal(readFileSync(file, 'utf8'), bin);
    const e = await b('etat');
    assert.match(e.text, /programme en marche/); assert.match(e.text, /args=tunnel --no-autoupdate run/); assert.ok(!e.text.includes('JETON-DU-TUNNEL'), 'jeton jamais affiché');
    const view = await bru.view(v.ctx('bru'), new URLSearchParams());
    assert.ok(view.sections.some((x) => x.kind === 'graph'));

    // Retrait : seulement le CNAME d'Odin, l'enregistrement MX du domaine reste.
    assert.ok((await b('depublier', { domaine: 'nas.exemple.fr' })).ok);
    assert.ok(!cloud.st.dns.some((r) => r.name === 'nas.exemple.fr'));
    assert.ok(cloud.st.dns.some((r) => r.id === 'r-mx'));
    assert.ok(!cloud.st.ingress.some((r) => (r as { hostname?: string }).hostname === 'nas.exemple.fr'));
    assert.match((await b('depublier', { domaine: 'inconnu.exemple.fr' })).text, /pas publié par Odin/);
    assert.ok(!cloud.st.calls.some((c) => c.startsWith('DELETE') && c.endsWith('r-mx')));
  } finally {
    bru.stop?.();
    if (saved === undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN = saved;
    rmSync(home, { recursive: true, force: true });
  }
});

test('programme sans empreinte publiée : refusé, rien n\'est exécuté', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bru-'));
  const saved = process.env.CLOUDFLARE_API_TOKEN; process.env.CLOUDFLARE_API_TOKEN = 'cle-de-test-cloudflare-123456';
  const cloud = fakeCloud('#!/bin/sh\nexec sleep 30\n', { digest: false });
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 0, out: '', err: '' }), fetch: cloud.fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  try {
    assert.ok((await v.act('bru', 'creer', { domaine: 'exemple.fr' })).ok);
    const d = await v.act('bru', 'demarrer');
    assert.equal(d.ok, false); assert.match(d.text, /empreinte du programme introuvable/);
    assert.ok(!existsSync(join(v.ctx('bru').home, 'bin', 'cloudflared')));
  } finally {
    bru.stop?.();
    if (saved === undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN = saved;
    rmSync(home, { recursive: true, force: true });
  }
});
