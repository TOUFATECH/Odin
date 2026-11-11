// Tests d'intrusion sur un VRAI Odin (interface web démarrée pour l'occasion, vraies requêtes HTTP,
// vrai navigateur). On joue l'attaquant : entrer sans compte, deviner le mot de passe, faire agir le
// navigateur du propriétaire à sa place (CSRF), injecter du code dans les pages (XSS), lire des
// fichiers hors du dossier permis, faire exécuter une commande par une appli, récupérer un secret.
// Chaque vérification décrit ce que l'attaquant tente et ce qui doit se passer.

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { connect } from 'node:net';
import { join } from 'node:path';
import { allModules, valhallaOf } from '../../../src/valhalla/odin.ts';
import { publicKey } from '../../../src/valhalla/modules/frigg.ts';
import { COMPTE, vraiOdin } from '../odin-vrai.ts';
import { until, wait, type Scenario } from '../lib.ts';
import { openBrowser } from '../navigateur.ts';

const XSS = '"><img src=x onerror="window.__xss=1"><script>window.__xss=1</script>';
const MARK = 'ODIN_BANC_INJECTION';
const SRC = new URL('../../../src/web/', import.meta.url);

/** Toutes les adresses d'API écrites dans le code du serveur (une nouvelle route est donc testée d'office). */
function apiRoutes(): string[] {
  const out = new Set<string>();
  for (const f of ['server.ts', 'valhalla-api.ts', 'draupnir-api.ts', 'brain-api.ts']) {
    const src = readFileSync(new URL(f, SRC), 'utf8');
    for (const m of src.matchAll(/'(\/api\/[\w/-]+)'/g)) out.add(m[1].endsWith('/') ? `${m[1]}x` : m[1]);
  }
  return [...out].sort();
}
const PUBLIC_POST = new Set(['/api/pair', '/api/pair/status', '/api/account/create', '/api/account/login', '/api/account/logout']);

export const securite: Scenario = {
  id: 'securite', title: 'Tests d\'intrusion sur Odin', mode: 'réel',
  what: 'Un attaquant contre l\'interface d\'un vrai Odin : entrer sans compte, force brute, CSRF, XSS (dans un vrai navigateur), traversée de chemins, injection de commandes dans toutes les applis, fuite de secrets, en-têtes de sécurité.',
  async run(t) {
    // Des secrets reconnaissables dans le coffre : aucun ne doit jamais sortir par l'interface.
    const SECRETS: Record<string, string> = { HA_TOKEN: 'SECRET-HA-7f3a91', PROXMOX_TOKEN: 'root@pam!odin=SECRET-PVE-55aa01', TELEGRAM_BOT_TOKEN: '123456:SECRET-TG-90bc12', CAMERA_ENTREE: 'SECRET-CAM-4411zz', TASMOTA_PASSWORD: 'SECRET-TAS-8822yy', MCP_VERCEL: 'SECRET-MCP-3300xx' };
    const before = Object.fromEntries(Object.keys(SECRETS).map((k) => [k, process.env[k]]));
    Object.assign(process.env, SECRETS);
    t.onEnd(() => { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

    const od = await vraiOdin(t, { script: [{ text: `Réponse avec [un lien](javascript:window.__xss=1) et ${XSS}` }, { text: 'ok' }, { text: 'ok' }] });
    const B = od.url, home = od.o.paths.home;
    const raw = (path: string, init: RequestInit = {}) => fetch(B + path, { redirect: 'manual', ...init });
    const J = { 'content-type': 'application/json', 'x-odin': '1' };

    // ------------------------------------------------------------------ 1. Avant le compte
    t.eq((await raw('/api/state')).status, 401, 'sans rien : l\'interface est fermée');
    const setupCookie = { cookie: `odin_token=${od.token}` };
    t.eq((await raw('/api/state', { headers: setupCookie })).status, 401, 'le lien de première connexion ne donne pas accès aux données, seulement le droit de créer le compte');
    t.eq((await raw('/api/account/create', { method: 'POST', headers: { 'content-type': 'application/json', ...setupCookie }, body: JSON.stringify(COMPTE) })).status, 403, 'création du compte sans l\'en-tête anti-CSRF : refusée');
    for (const [bad, why] of [[{ ...COMPTE, password: 'azertyuiop' }, 'mot de passe trop courant'], [{ ...COMPTE, password: 'court' }, 'mot de passe trop court'], [{ ...COMPTE, email: 'pas-une-adresse' }, 'adresse e-mail invalide'], [{ ...COMPTE, prenom: '' }, 'prénom vide']] as const) {
      t.eq((await raw('/api/account/create', { method: 'POST', headers: { ...J, ...setupCookie }, body: JSON.stringify(bad) })).status, 400, `création refusée : ${why}`);
    }
    t.ok(!existsSync(join(home, 'compte.json')), 'aucun compte n\'est créé tant qu\'une donnée est refusée');
    const made = await raw('/api/account/create', { method: 'POST', headers: { ...J, ...setupCookie }, body: JSON.stringify({ ...COMPTE, prenom: 'Awa<img src=x onerror=1>' }) });
    const session = made.headers.getSetCookie().find((c) => c.startsWith('odin_session=')) ?? '';
    t.eq(made.status, 200, 'le compte se crée avec le lien de première connexion');
    t.match(session, /^odin_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\//, 'session : cookie HttpOnly (invisible pour les scripts) et SameSite=Strict (jamais envoyé depuis un autre site)');
    const S = { cookie: session.split(';')[0] };
    const account = JSON.parse(readFileSync(join(home, 'compte.json'), 'utf8')) as { prenom: string; pass: { algo: string; N: number; hash: string } };
    t.ok(!/[<>]/.test(account.prenom), 'le prénom est nettoyé (pas de balise HTML gardée)', account.prenom);
    const disk = readFileSync(join(home, 'compte.json'), 'utf8') + readFileSync(join(home, 'sessions.json'), 'utf8');
    t.ok(!disk.includes(COMPTE.password) && !disk.includes(S.cookie.split('=')[1]) && account.pass.algo === 'scrypt' && account.pass.hash.length >= 40, 'sur le disque : ni le mot de passe ni l\'identifiant de session, seulement des empreintes (scrypt, SHA-256)');
    if (process.platform !== 'win32') t.ok([join(home, 'compte.json'), join(home, 'sessions.json'), join(home, 'web-token')].every((f) => (statSync(f).mode & 0o077) === 0), 'fichiers du compte lisibles par le propriétaire seulement (droits 600)');

    // ------------------------------------------------------------------ 2. Entrer sans identifiants
    t.eq((await raw('/api/state', { headers: S })).status, 200, 'avec la session : accès');
    t.eq((await raw('/api/state', { headers: setupCookie })).status, 401, 'compte créé : le jeton en cookie ne vaut plus rien');
    const link = await raw(`/?token=${od.token}`);
    t.ok(link.status === 302 && !link.headers.get('set-cookie'), 'le lien avec jeton redirige vers l\'écran de connexion, sans donner de cookie');
    t.eq((await raw('/api/account/create', { method: 'POST', headers: { ...J, ...setupCookie }, body: JSON.stringify(COMPTE) })).status, 409, 'un deuxième compte ne peut pas être créé');
    const forged = S.cookie.slice(0, -1) + (S.cookie.endsWith('A') ? 'B' : 'A');
    t.eq((await raw('/api/state', { headers: { cookie: forged } })).status, 401, 'session inventée (un caractère de différence) : refusée');
    t.eq((await raw('/api/state', { headers: { cookie: 'odin_session=' } })).status, 401, 'session vide : refusée');
    const routes = apiRoutes();
    const open: string[] = [];
    for (const r of routes) {
      const g = await raw(r), p = PUBLIC_POST.has(r) ? undefined : await raw(r, { method: 'POST', headers: J, body: '{}' });
      if (g.status !== 401 && !(PUBLIC_POST.has(r) && [401, 404, 405].includes(g.status))) open.push(`GET ${r} → ${g.status}`);
      if (p && p.status !== 401) open.push(`POST ${r} → ${p.status}`);
    }
    t.ok(routes.length > 40 && !open.length, `les ${routes.length} adresses d'API trouvées dans le code répondent « 401 » sans identifiants`, open.join(' ; '));
    const pub = await Promise.all(['/health', '/manifest.webmanifest', '/valhalla.js', '/favicon.svg'].map(async (p) => (await raw(p)).status));
    t.eq(pub, [200, 200, 200, 200], 'seuls restent publics : la page d\'accueil, son code, l\'icône et « /health »');
    t.eq((await raw('/mcp', { method: 'POST', headers: { ...J, ...S }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' })).status, 401, 'serveur MCP : la session d\'un navigateur ne suffit pas (clé d\'API exigée : une page piégée ne peut pas s\'en servir)');
    t.eq((await raw('/api/ask', { method: 'POST', headers: S, body: 'bonjour' })).status, 401, 'raccourci vocal : pareil, clé d\'API exigée');
    t.eq((await raw('/api/state', { headers: { authorization: `Bearer ${'f'.repeat(48)}` } })).status, 401, 'fausse clé d\'API : refusée');
    t.eq((await raw('/api/state', { headers: { authorization: `Bearer ${od.token}` } })).status, 200, 'la vraie clé d\'API (programmes) fonctionne');

    // ------------------------------------------------------------------ 3. Deviner le mot de passe
    const login = (email: string, password: string, h: Record<string, string> = J) => raw('/api/account/login', { method: 'POST', headers: h, body: JSON.stringify({ email, password }) });
    t.eq((await login(COMPTE.email, COMPTE.password, { 'content-type': 'application/json' })).status, 403, 'connexion sans l\'en-tête anti-CSRF : refusée');
    const wrongPass = await login(COMPTE.email, 'mauvais-mot-de-passe'), wrongMail = await login('inconnu@exemple.yt', COMPTE.password);
    const [m1, m2] = [await wrongPass.json() as { error: string }, await wrongMail.json() as { error: string }];
    t.ok(wrongPass.status === 401 && wrongMail.status === 401 && m1.error === m2.error, 'mauvais mot de passe ou adresse inconnue : même réponse (on ne peut pas deviner quelle adresse existe)', `${m1.error} / ${m2.error}`);
    const good = await login(COMPTE.email, COMPTE.password);
    const second = good.headers.getSetCookie().find((c) => c.startsWith('odin_session='))?.split(';')[0] ?? '';
    t.ok(good.status === 200 && second && second !== S.cookie, 'bon mot de passe : nouvelle session (jamais la même que la précédente)');
    for (let i = 0; i < 5; i++) await login(COMPTE.email, `essai-numero-${i}-xxxx`);
    const locked = await login(COMPTE.email, COMPTE.password);
    t.ok(locked.status === 429 && Number(locked.headers.get('retry-after')) >= 20, 'après 5 erreurs de suite : attente imposée, même avec le bon mot de passe (force brute inutile)', `${locked.status} retry-after=${locked.headers.get('retry-after')}`);
    t.eq((await raw('/api/state', { headers: S })).status, 200, 'pendant ce temps, les sessions déjà ouvertes continuent de marcher');
    (od.web.accounts as unknown as { lockedUntil: number; fails: number }).lockedUntil = 0; (od.web.accounts as unknown as { fails: number }).fails = 0;

    // ------------------------------------------------------------------ 4. Faire agir le navigateur du propriétaire (CSRF)
    const csrf: string[] = [];
    for (const [path, body] of [['/api/action', '{"kind":"token_rotate"}'], ['/api/message', '{"text":"x"}'], ['/api/valhalla/act', '{"module":"garmr","action":"bannir","input":{"ip":"1.2.3.4"}}'], ['/api/account/password', `{"current":"${COMPTE.password}","next":"un-autre-mot-de-passe-long"}`], ['/api/account/revoke', '{"id":"autres"}'], ['/api/brain/write', '{}'], ['/api/draupnir/save', '{}'], ['/api/runes/add', '{}']] as const) {
      // Ce qu'un formulaire d'un autre site peut envoyer : le cookie (s'il partait) et un corps « text/plain », jamais d'en-tête x-odin.
      const r = await raw(path, { method: 'POST', headers: { ...S, 'content-type': 'text/plain', origin: 'https://site-piege.example' }, body });
      if (r.status !== 403) csrf.push(`${path} → ${r.status}`);
    }
    t.ok(!csrf.length, 'un formulaire d\'un autre site (sans l\'en-tête x-odin) est refusé partout, même avec le cookie', csrf.join(' ; '));
    const pre = await raw('/api/action', { method: 'OPTIONS', headers: { origin: 'https://site-piege.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-odin,content-type' } });
    const cors = await raw('/api/state', { headers: { ...S, origin: 'https://site-piege.example' } });
    t.ok(!pre.headers.get('access-control-allow-origin') && !cors.headers.get('access-control-allow-origin') && !cors.headers.get('access-control-allow-credentials'), 'aucune autorisation CORS : un autre site ne peut ni ajouter l\'en-tête, ni lire les réponses');
    const rebound = await new Promise<number>((res) => httpGet({ host: '127.0.0.1', port: od.port, path: '/api/state', headers: { ...S, host: 'attaquant.example' } }, (r) => { r.resume(); res(r.statusCode ?? 0); }).on('error', () => res(0)));
    t.eq(rebound, 403, 'nom de domaine d\'un attaquant pointé sur Odin (« DNS rebinding ») : refusé');

    // ------------------------------------------------------------------ 5. En-têtes de sécurité
    const st0 = await raw('/api/state', { headers: S });
    const page = await raw('/', { headers: S }), csp = page.headers.get('content-security-policy') ?? '', html = await page.text();
    t.ok(/default-src 'none'/.test(csp) && /script-src 'nonce-[A-Za-z0-9+/=]+'(?:;|$)/.test(csp) && !/script-src[^;]*unsafe-(inline|eval)/.test(csp) && /frame-ancestors 'none'/.test(csp) && /base-uri 'none'/.test(csp) && /form-action 'self'/.test(csp), 'politique de contenu stricte : scripts autorisés seulement par jeton à usage unique, aucune mise en cadre', csp);
    t.ok(page.headers.get('x-frame-options') === 'DENY' && page.headers.get('x-content-type-options') === 'nosniff' && page.headers.get('referrer-policy') === 'no-referrer' && /no-store/.test(page.headers.get('cache-control') ?? ''), 'anti-cadre, anti-devinette de type, pas de « referer », page jamais gardée en cache');
    t.ok(page.headers.get('cross-origin-opener-policy') === 'same-origin' && /camera=\(self\).*geolocation=\(\)/.test(page.headers.get('permissions-policy') ?? '') && st0.headers.get('cross-origin-resource-policy') === 'same-origin', 'fenêtre isolée des autres sites, réponses illisibles depuis un autre site, permissions du navigateur réduites au micro et à la caméra');
    const nonce2 = /script-src 'nonce-([^']+)'/.exec((await raw('/', { headers: S })).headers.get('content-security-policy') ?? '')?.[1];
    t.ok(nonce2 && !csp.includes(nonce2), 'le jeton des scripts change à chaque page');
    const st = await raw('/api/state', { headers: S });
    t.ok(st.headers.get('x-content-type-options') === 'nosniff' && /no-store/.test(st.headers.get('cache-control') ?? ''), 'réponses de l\'API : jamais en cache, type non devinable');
    t.ok(!/odin_session|un-cheval-bleu/.test(html) && !html.includes(od.token), 'la page ne contient ni la session, ni la clé d\'API, ni le mot de passe');

    // ------------------------------------------------------------------ 6. Requêtes tordues
    const weird: string[] = [];
    for (const [name, init, want] of [
      ['JSON cassé', { method: 'POST', headers: { ...J, ...S }, body: '{"kind":' }, [400]],
      ['« null » à la place d\'un objet', { method: 'POST', headers: { ...J, ...S }, body: 'null' }, [400]],
      ['une liste à la place d\'un objet', { method: 'POST', headers: { ...J, ...S }, body: '[1,2]' }, [400]],
      ['action inconnue', { method: 'POST', headers: { ...J, ...S }, body: '{"kind":"__proto__"}' }, [200, 400, 404]],
      ['corps de 12 Mo', { method: 'POST', headers: { ...J, ...S }, body: `{"kind":"x","pad":"${'a'.repeat(12 * 1024 * 1024)}"}` }, [413, 0]],
    ] as Array<[string, RequestInit, number[]]>) {
      const r = await raw('/api/action', init).catch(() => undefined);
      const body = r ? await r.text().catch(() => '') : '';
      if (!want.includes(r?.status ?? 0) || /\bat \w+ \(|node:internal|\/home\/|\/src\//.test(body)) weird.push(`${name} → ${r?.status} ${body.slice(0, 80)}`);
    }
    t.ok(!weird.length, 'requêtes malformées : erreur propre (400 ou 413), jamais de trace interne ni de chemin de fichier', weird.join(' ; '));
    t.ok((({}) as Record<string, unknown>).polluted === undefined && (await raw('/api/action', { method: 'POST', headers: { ...J, ...S }, body: '{"kind":"cfg_save","section":"__proto__","value":{"polluted":1},"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}}}' })).status < 500 && (({}) as Record<string, unknown>).polluted === undefined, 'pollution de prototype (« __proto__ ») : sans effet');
    // Connexion lente et incomplète : elle ne doit pas bloquer les autres.
    const slow = connect(od.port, '127.0.0.1'); slow.on('error', () => {}); slow.write('POST /api/action HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 1000000\r\n\r\n{"kind":');
    t.eq((await raw('/api/state', { headers: S })).status, 200, 'une connexion volontairement lente et incomplète ne bloque pas les autres');
    slow.destroy();
    t.eq((await raw('/health')).status, 200, 'après tout cela, Odin répond toujours');

    // ------------------------------------------------------------------ 7. Lire hors du dossier permis
    writeFileSync(join(home, 'secret-banc.txt'), MARK);
    const leaks: string[] = [];
    for (const p of ['/fonts/../../compte.json', '/fonts/..%2f..%2fcompte.json', '/..%2fcompte.json', '/%2e%2e/%2e%2e/etc/passwd', '/icon-192.png/../../compte.json', '/api/brain/note?path=../../compte.json', '/api/brain/note?path=..%2F..%2Fsecret-banc.txt', '/api/brain/note?path=/etc/passwd', '/api/brain/file?path=../../compte.json', '/api/runes/export?base=../../compte', '/api/valhalla/view?id=../../compte', '/api/history?peer=../../../compte', '/api/draupnir/flow?id=../../compte.json']) {
      const r = await new Promise<string>((res) => httpGet({ host: '127.0.0.1', port: od.port, path: p, headers: S }, (x) => { let d = ''; x.on('data', (c: Buffer) => { d += c; }); x.on('end', () => res(d)); }).on('error', () => res('')));
      if (/scrypt|"hash"|root:x:0|ODIN_BANC_INJECTION/.test(r)) leaks.push(p);
    }
    const viaChat = await raw('/api/message', { method: 'POST', headers: { ...J, ...S }, body: JSON.stringify({ text: 'lis ça', files: [{ file: '../compte.json', type: 'text/plain' }, { file: 'inbox/../../compte.json' }, { file: '/etc/passwd' }] }) });
    t.ok(!leaks.length && viaChat.status === 202, 'traversée de chemins (« ../ ») sur les fichiers statiques, le Cerveau, les bases, les pièces jointes : rien ne sort', leaks.join(' ; '));

    // ------------------------------------------------------------------ 8. Injection de commandes dans toutes les applis
    const ran: Array<{ cmd: string; args: string[] }> = [];
    // Les commandes ne sont pas lancées : elles sont notées, et chaque outil est annoncé « présent »
    // pour que chaque appli aille jusqu'au bout de la construction de sa commande.
    const fuzz = t.valhalla(allModules(od.o), { run: async (cmd, args) => { ran.push({ cmd, args }); return { code: 0, out: /command -v/.test(args.join(' ')) ? '/usr/bin/outil' : '', err: '' }; }, fetch: (async () => { throw new Error('réseau coupé par le banc'); }) as unknown as typeof fetch });
    const payloads = [`x; touch /tmp/${MARK}`, `$(touch /tmp/${MARK})`, `\`touch /tmp/${MARK}\``, `x | touch /tmp/${MARK}`, `x && touch /tmp/${MARK}`, `--${MARK}=1`, `x\ntouch /tmp/${MARK}`];
    let tried = 0; const crashed: string[] = [];
    for (const m of fuzz.v.modules()) for (const a of m.actions) {
      // Loki ouvre de vrais ports, Ullr parcourt le disque : on vérifie ici la construction des commandes, pas ces effets-là.
      if (m.id === 'loki' && a.id === 'allumer') continue;
      for (const p of payloads.slice(0, a.params?.length ? payloads.length : 1)) {
        const input = Object.fromEntries((a.params ?? []).map((q) => [q.key, q.kind === 'boolean' ? true : q.kind === 'select' ? (q.options?.[0] ?? p) : p]));
        tried++;
        try { await Promise.race([fuzz.v.act(m.id, a.id, input), wait(4000)]); } catch (e) { crashed.push(`${m.id}.${a.id} : ${(e as Error).message.slice(0, 60)}`); }
      }
    }
    // Deux familles de programmes lisent leurs arguments comme un petit programme : les interpréteurs
    // (sh -c « … ») et le pare-feu nft. Aucune saisie ne doit s'y retrouver.
    const shells = ran.filter((r) => { const bin = r.cmd.split('/').pop() ?? ''; return (/^(sh|bash|zsh|dash|ksh|cmd|powershell|pwsh)$/.test(bin) && r.args.some((x, i) => r.args[i - 1] === '-c' && (x.includes(MARK) || x.includes('touch /tmp')))) || (/^(nft|iptables|ip6tables)$/.test(bin) && r.args.some((x) => x.includes(MARK))); });
    t.ok(tried > 400 && ran.length > 100 && !existsSync(`/tmp/${MARK}`) && !shells.length, `${tried} essais d'injection (« ; », « $( ) », « | », accents graves…) dans les réglages de toutes les actions des ${fuzz.v.modules().length} applis : aucune commande injectée`, shells.map((x) => `${x.cmd} ${x.args.join(' ').slice(0, 120)}`).join(' ; '));
    t.ok(!crashed.length, 'aucune action ne plante sur une saisie malveillante (erreur propre à la place)', crashed.slice(0, 5).join(' ; '));
    // Une option glissée à la place d'un nom (« --quelquechose ») ne doit pas devenir une option de la commande système.
    const opt = `--${MARK}=1`;
    const options = ran.filter((r) => { const i = r.args.indexOf(opt); return i >= 0 && !r.args.slice(0, i).includes('--') && !/^-/.test(r.args[i - 1] ?? '') && !/^(sh|bash)$/.test(r.cmd); });
    t.ok(!options.length, 'une valeur qui commence par « -- » n\'est jamais passée comme option à une commande système', [...new Set(options.map((x) => `${x.cmd} ${x.args.slice(0, 4).join(' ')}`))].slice(0, 8).join(' ; '));

    // ------------------------------------------------------------------ 9. Secrets
    const v = valhallaOf()!;
    let dump = await (await raw('/api/state', { headers: S })).text() + await (await raw('/api/valhalla/catalog', { headers: S })).text() + await (await raw('/api/account/me', { headers: S })).text();
    for (const m of v.modules()) dump += await (await raw(`/api/valhalla/view?id=${m.id}`, { headers: S })).text();
    const mcp = await raw('/mcp', { method: 'POST', headers: { ...J, authorization: `Bearer ${od.token}` }, body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }, ...v.modules().slice(0, 30).map((m, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: { name: `odin_${m.id}`, arguments: { action: m.actions.find((a) => a.read && !(a.params ?? []).some((p) => p.required))?.id ?? 'x' } } }))]) });
    dump += await mcp.text();
    const found = [...Object.entries(SECRETS).filter(([, val]) => dump.includes(val)).map(([k]) => k), ...(dump.includes(COMPTE.password) ? ['mot de passe'] : []), ...(dump.includes(account.pass.hash) ? ['empreinte du mot de passe'] : []), ...(dump.includes(S.cookie.split('=')[1]) ? ['session'] : []), ...(dump.includes(String(process.env.MQTT_PASSWORD)) ? ['MQTT_PASSWORD'] : []), ...(dump.includes(String(process.env.BRISINGAMEN_KEY)) ? ['BRISINGAMEN_KEY'] : [])];
    t.ok(dump.length > 20_000 && !found.length, `l'état d'Odin, le catalogue, la page des ${v.modules().length} applis et le serveur MCP : aucun secret du coffre, ni mot de passe, ni session dans les réponses`, found.join(', '));
    t.ok(!dump.includes(od.token), 'la clé d\'API n\'apparaît dans aucune de ces réponses (elle ne sort que par le bouton « Copier la clé »)');

    // ------------------------------------------------------------------ 10. XSS : du code injecté dans les données, vu dans un vrai navigateur
    v.alert('forseti', { level: 'haute', title: `Alerte ${XSS}`, detail: XSS, key: 'xss' });
    await v.act('frigg', 'prestation', { nom: 'Coupe', minutes: 30 });
    await v.act('frigg', 'horaires', { horaires: 'lundi 08:00-18:00\nmardi 08:00-18:00\nmercredi 08:00-18:00\njeudi 08:00-18:00\nvendredi 08:00-18:00\nsamedi 08:00-18:00\ndimanche 08:00-18:00' });
    const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10), key = publicKey(v.ctx('frigg'));
    const booked = await raw(`/r/${key}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ service: 'Coupe', jour: day, heure: '10:00', nom: `Client ${XSS}`, contact: XSS, note: XSS }).toString() });
    const pubHtml = await booked.text() + await (await raw(`/r/${key}?service=${encodeURIComponent(XSS)}&jour=${day}`)).text();
    t.ok(booked.status === 200 && !/<img src=x|<script>window/.test(pubHtml) && /default-src 'none'/.test(booked.headers.get('content-security-policy') ?? ''), 'page publique de réservation (ouverte à Internet) : le code envoyé par un visiteur est neutralisé, et la page n\'autorise aucun script', `${booked.status} ${booked.headers.get('content-security-policy')}`);
    v.ctx('appareils').saveSettings({ devices: { xss1: { id: 'xss1', name: `Lampe ${XSS}`, kind: 'light', room: XSS, network: 'MQTT', state: XSS, stateTopic: 'x/y', commandTopic: 'x/z' } } });
    await v.act('saga', 'noter', { titre: 'Note du banc', texte: `Texte ${XSS}\n\n[lien](javascript:window.__xss=1)\n\n<iframe srcdoc="<script>parent.__xss=1</script>"></iframe>` });
    await v.act('runes', 'ajouter', { base: 'Clients', titre: `Fiche ${XSS}` });
    await raw('/api/message', { method: 'POST', headers: { ...J, ...S }, body: JSON.stringify({ text: `Bonjour ${XSS} [clic](javascript:window.__xss=1)` }) });
    await wait(1200);

    const browser = await openBrowser(t);
    if (!browser) { t.note('Navigateur de test (Playwright) absent : les vérifications XSS dans la page sont ignorées.'); return; }
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addCookies([{ name: 'odin_session', value: S.cookie.split('=')[1], url: B, httpOnly: true, sameSite: 'Strict' }]);
    const pg = await ctx.newPage(), blocked: string[] = [], errors: string[] = [];
    pg.on('console', (m) => { if (/Content Security Policy|Refused to/.test(m.text())) blocked.push(m.text().slice(0, 120)); });
    pg.on('pageerror', (e) => errors.push(e.message));
    await pg.goto(B + '/'); await pg.waitForSelector('#app:not([hidden])');
    const visited: string[] = [], bad: string[] = []; let sawPayloadAsText = 0;
    const check = async (label: string) => {
      await pg.waitForTimeout(700); visited.push(label);
      const r = await pg.evaluate<{ flag: number; nodes: number; shown: boolean }>(`({ flag: window.__xss || 0, nodes: document.querySelectorAll('img[src="x"], iframe[srcdoc], script:not([nonce]):not([src]), a[href^="javascript:" i], [onerror], [onclick], [onload]').length, shown: document.body.innerText.includes('onerror=') })`);
      if (r.flag || r.nodes) bad.push(`${label} (exécuté : ${r.flag}, éléments injectés : ${r.nodes})`);
      if (r.shown) sawPayloadAsText++;
    };
    for (const view of ['home', 'chat', 'brain', 'runes', 'flows', 'apps', 'audit', 'memory', 'missions', 'jobs', 'skills', 'net', 'settings']) { await pg.evaluate(`window.OdinShow(${JSON.stringify(view)})`); await check(`écran ${view}`); }
    for (const id of ['forseti', 'frigg', 'appareils', 'midgard', 'runes', 'saga', 'loki', 'garmr']) { await pg.evaluate(`void window.OdinApps.app(${JSON.stringify(id)})`); await check(`appli ${id}`); }
    t.ok(!bad.length, `code injecté dans une alerte, une réservation, un appareil, une note, une fiche et la discussion, puis ${visited.length} écrans ouverts dans un vrai navigateur : rien ne s'exécute`, bad.join(' ; '));
    t.ok(sawPayloadAsText >= 3, 'le code injecté est affiché comme du simple texte (pas effacé en silence, pas interprété)', `${sawPayloadAsText} écran(s)`);
    // Le rendu des notes du Cerveau (Markdown) : balises, liens « javascript: », cadres… rien ne doit devenir un élément actif.
    const mdNodes = await pg.evaluate<number>(`(() => { const d = document.createElement('div'); d.innerHTML = window.OdinBrain.md(${JSON.stringify(`# Titre ${XSS}\n\nTexte ${XSS} [lien](javascript:window.__xss=1) [[Page${XSS}|${XSS}]] #tag${XSS}\n\n<iframe srcdoc="x"></iframe>\n\n| a | b |\n|---|---|\n| ${XSS} | x |\n\n> [!note] ${XSS}\n> ${XSS}\n\n- [ ] ${XSS}\n\n\`\`\`\n${XSS}\n\`\`\``)}); return d.querySelectorAll('script, img, iframe, object, embed, form, [onerror], [onclick], [style], a[href^="javascript:" i]').length + (window.__xss || 0); })()`);
    t.eq(mdNodes, 0, 'notes du Cerveau : le Markdown piégé (balises, « javascript: », cadres, tableaux, encadrés) ne produit aucun élément actif');
    const store = await pg.evaluate<string>('JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie');
    t.ok(!store.includes(S.cookie.split('=')[1]) && !store.includes(od.token) && !/un-cheval-bleu/.test(store), 'dans le navigateur, les scripts ne peuvent lire ni la session, ni la clé d\'API, ni le mot de passe (rien dans le stockage local ni dans les cookies lisibles)');
    // Un script injecté malgré tout serait bloqué par la politique de contenu : on le vérifie en vrai.
    const inline = await pg.evaluate<number>(`(() => { const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.body.append(s); const d = document.createElement('div'); d.innerHTML = '<img src="/nexistepas" onerror="window.__inline = 1">'; document.body.append(d); return new Promise((r) => setTimeout(() => r(window.__inline || 0), 600)); })()`);
    t.ok(inline === 0 && blocked.length > 0, 'dernier rempart : même un script ajouté de force dans la page est bloqué par le navigateur (politique de contenu)', `${inline} / ${blocked[0] ?? 'aucun blocage vu'}`);
    t.ok(!errors.length, 'aucune erreur de script pendant le parcours', errors.slice(0, 3).join(' ; '));

    // ------------------------------------------------------------------ 11. Fin de session
    const other = await login(COMPTE.email, COMPTE.password), o2 = { cookie: other.headers.getSetCookie().find((c) => c.startsWith('odin_session='))!.split(';')[0] };
    const sse = await raw('/api/stream', { headers: o2 }); const reader = sse.body!.getReader(); let ended = false;
    void (async () => { try { for (;;) { const { done } = await reader.read(); if (done) break; } } catch { /* coupé */ } ended = true; })();
    const chg = await raw('/api/account/password', { method: 'POST', headers: { ...J, ...S }, body: JSON.stringify({ current: COMPTE.password, next: 'un-nouveau-mot-de-passe-bien-long' }) });
    t.ok(chg.status === 200 && (await raw('/api/state', { headers: o2 })).status === 401 && (await raw('/api/state', { headers: S })).status === 200, 'mot de passe changé : les autres appareils sont déconnectés, celui-ci reste');
    t.ok(await until(() => ended, 4000), 'le flux temps réel de l\'appareil déconnecté est coupé aussitôt');
    t.eq((await raw('/api/account/password', { method: 'POST', headers: { ...J, authorization: `Bearer ${od.token}` }, body: JSON.stringify({ current: 'pas-le-bon', next: 'encore-un-autre-mot-de-passe' }) })).status, 400, 'la clé d\'API ne permet pas de changer le mot de passe sans connaître l\'actuel');
    const out = await raw('/api/account/logout', { method: 'POST', headers: { ...J, ...S }, body: '{}' });
    t.ok(out.status === 200 && /odin_session=; .*Max-Age=0/.test(out.headers.getSetCookie().join(' | ')) && (await raw('/api/state', { headers: S })).status === 401, 'déconnexion : la session est détruite sur le serveur (le cookie volé avant ne marche plus)');
  },
};

