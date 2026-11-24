// La clé d'accès « lire et parler seulement » : les contournements essayés à la relecture, chacun tenu par un essai.
//  - une autre méthode que GET ou POST (HEAD, OPTIONS, avec un corps) n'écrit pas ;
//  - une réponse de validation cachée par la coupe du texte (le serveur coupe à 4 000 ou 20 000 caractères) ne passe pas ;
//  - aucune phrase de la clé ne tranche une validation, dans aucune langue, avec ou sans caractère invisible ;
//  - une action d'appli marquée « lecture » ne suffit pas : seules celles écrites dans la liste passent ;
//  - le détail d'une automatisation (il porte le chemin secret de son webhook) ne se lit pas avec la clé ;
//  - l'en-tête de la clé sous toutes ses formes, la clé avec un cookie (vrai ou faux), les chemins déformés ;
//  - les formes de réponse reconnues par la passerelle et celles du filtre restent les mêmes (sentinelle).
// Un vrai Odin d'essai, dans un dossier temporaire, sur un port libre. Adresses d'exemple seulement.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readFileSync } from 'node:fs';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { setTunFactory } from '../src/valhalla/modules/gjoll.ts';
import { ACTIONS_LUES, FORMES_PASSERELLE, REFUS_CLE, REFUS_ESPACES, estValidationOuCommande, refusDeLaCle } from '../src/web/cle-acces.ts';
import type { GateDecision } from '../src/heimdall/policy.ts';
import type { AgentEvent } from '../src/types.ts';

setTunFactory(async () => ({ write: () => {}, onPacket: () => {}, close: () => {} }));
const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin;
const parties: Array<{ peer: string; id: string }> = [];
const dorm = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function attendre(f: () => boolean, ms = 8000): Promise<boolean> { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await dorm(40); } return true; }

/** Une demande brute : n'importe quelle méthode, avec un corps même là où un navigateur n'en met pas. */
function brut(methode: string, chemin: string, corps: unknown, entetes: Record<string, string>): Promise<{ status: number; texte: string }> {
  return new Promise((ok, ko) => {
    const data = corps === undefined ? '' : typeof corps === 'string' ? corps : JSON.stringify(corps);
    const r = request({ host: '127.0.0.1', port: v.port, method: methode, path: chemin, headers: { 'content-type': 'application/json', 'x-odin': '1', 'content-length': String(Buffer.byteLength(data)), ...entetes } }, (res) => {
      const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => ok({ status: res.statusCode ?? 0, texte: Buffer.concat(p).toString('utf8') }));
    });
    r.on('error', ko); r.end(data);
  });
}
const avecCle = (methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) => brut(methode, chemin, corps, { authorization: `Bearer ${v.token}`, ...entetes });
/** Une validation qui attend ; rend son identifiant et de quoi savoir si elle a été tranchée. */
async function demandeEnAttente(quoi: string): Promise<{ id: string; rendu: () => GateDecision | undefined; fin: Promise<GateDecision> }> {
  const avant = parties.length; let rendu: GateDecision | undefined;
  const fin = v.o.heimdall.gate({ tool: 'shell', risk: 'exec', summary: quoi, sessionId: 'web:principal', tainted: false, grave: 'supprimer des fichiers' });
  void fin.then((d) => { rendu = d; });
  assert.ok(await attendre(() => parties.length === avant + 1), 'la demande attend la réponse du propriétaire');
  return { id: parties.at(-1)!.id, rendu: () => rendu, fin };
}

before(async () => {
  console.log = () => {}; console.error = () => {}; console.warn = () => {};
  v = await vraiOdin(tt, { compte: true, script: () => ({ text: 'bien reçu' }), modules: (o) => allModules(o).filter((m) => ['var', 'svalinn', 'vidarr', 'gjoll'].includes(m.id)) });
  v.o.cfg.web.portsParAppli = false;
  const ev = v.web.event.bind(v.web);
  v.web.event = (peer: string, e: AgentEvent) => { if (e.type === 'approval') parties.push({ peer, id: (e as unknown as { id: string }).id }); ev(peer, e); };
});
after(async () => {
  for (const x of parties) await v.json('/api/message', { text: `/no ${x.id}` }).catch(() => undefined);
  await tt.end(); Object.assign(console, orig);
});

test('la règle : avec la clé, seules GET et POST sont jugées ; toute autre méthode est refusée (HEAD et OPTIONS aussi)', () => {
  for (const m of ['HEAD', 'OPTIONS', 'PUT', 'DELETE', 'PATCH', 'PROPFIND', 'options', 'head']) for (const c of ['/venus/ma-liste', '/venus/yt/abonnements', '/api/state', '/api/terminal/apercu/s0123abcd/', '/api/action']) assert.equal(refusDeLaCle(m, c)?.phrase, REFUS_CLE, `${m} ${c}`);
  assert.equal(refusDeLaCle('GET', '/api/state'), undefined); assert.equal(refusDeLaCle('get', '/api/state'), undefined);
});

test('une autre méthode que GET ou POST, avec un corps : la clé n\'écrit pas (les demandes de Vénus)', async () => {
  const demandes = async () => (await brut('GET', '/venus/demandes', undefined, { cookie: v.session })).texte;
  const avant = await demandes();
  for (const m of ['OPTIONS', 'HEAD', 'PUT', 'PATCH', 'DELETE']) {
    const r = await avecCle(m, '/venus/demandes', { titre: `Film intrus ${m}`, type: 'film' });
    assert.equal(r.status, 403, `${m} → ${r.status} ${r.texte.slice(0, 80)}`);
  }
  assert.equal(await demandes(), avant, 'les demandes n\'ont pas bougé'); assert.doesNotMatch(await demandes(), /intrus/);
});

test('une réponse de validation cachée par la coupe du texte ne passe pas (4 000 caractères au raccourci, 20 000 à la page)', async () => {
  // Le mot, puis de quoi remplir jusqu'à la coupe (des « ! » ou des espaces : la passerelle les prend avec le mot), puis
  // une longue phrase que la coupe fait disparaître : la passerelle ne recevrait que « oui!!!!… », c'est-à-dire « oui ».
  const longue = (mot: string, n: number, plein = '!') => `${mot}${plein.repeat(n - mot.length)}et ensuite raconte-moi une très longue histoire avec beaucoup de détails sur la journée`;
  for (const plein of ['!', '.', ' ']) for (const mot of ['oui', 'yes', 'always', 'toujours', 'ok', ' oui']) {
    assert.equal(estValidationOuCommande(longue(mot, 4000, plein)), false, 'en entier, ce n\'est pas une réponse courte : c\'est la coupe qui la fait');
    assert.equal(estValidationOuCommande(longue(mot, 4000, plein), 4000), true, `raccourci : ${mot}`);
    assert.equal(estValidationOuCommande(longue(mot, 20_000, plein), 20_000), true, `page : ${mot}`);
    assert.ok(refusDeLaCle('POST', '/api/ask', { corps: { text: longue(mot, 4000, plein) } }), `/api/ask ${mot}`);
    assert.ok(refusDeLaCle('POST', '/api/message', { corps: { text: longue(mot, 20_000, plein) } }), `/api/message ${mot}`);
  }
  for (const [chemin, n] of [['/api/message', 20_000], ['/api/ask', 4000]] as Array<[string, number]>) {
    const d = await demandeEnAttente(`supprimer le dossier essai-coupe-${n}`);
    const envoi = avecCle('POST', chemin, { text: longue('oui', n) });
    const r = await Promise.race([envoi, dorm(1500).then(() => ({ status: 0, texte: 'pas de réponse (le raccourci attend Odin)' }))]);
    await dorm(300);
    const tranchee = d.rendu();
    if (tranchee === undefined) { assert.equal((await v.json('/api/message', { text: `/no ${d.id}` })).status, 202); await d.fin; }
    assert.equal(tranchee, undefined, `${chemin} : la clé a tranché la validation (${JSON.stringify(tranchee)})`);
    assert.equal(r.status, 403, `${chemin} → ${r.status} ${r.texte.slice(0, 80)}`);
  }
});

test('une très longue suite d\'espaces dans le texte de la clé est refusée tout de suite (elle bloquait Odin pendant des minutes)', async () => {
  const t0 = Date.now();
  for (const chemin of ['/api/ask', '/api/message']) {
    const r = await avecCle('POST', chemin, { text: `bonjour${' '.repeat(3000)}raconte-moi ma journée` });
    assert.equal(r.status, 403, `${chemin} → ${r.status}`); assert.equal(JSON.parse(r.texte).error, REFUS_ESPACES);
  }
  assert.equal((await avecCle('GET', '/api/state')).status, 200, 'Odin répond toujours');
  assert.ok(Date.now() - t0 < 5000, `Odin n'a pas été bloqué (${Date.now() - t0} ms)`);
  assert.equal(refusDeLaCle('POST', '/api/message', { corps: { text: `a${'\n'.repeat(41)}b` } })?.phrase, REFUS_ESPACES, 'des retours à la ligne aussi');
  assert.equal(refusDeLaCle('POST', '/api/message', { corps: { text: `bonjour${' '.repeat(40)}Odin,\n\n\n    raconte-moi ma journée` } }), undefined, 'un texte ordinaire passe');
});

test('aucune phrase de la clé ne tranche une validation : langues, casse, ponctuation, espaces et caractères invisibles', async () => {
  const d = await demandeEnAttente('supprimer le dossier essai-langues');
  const phrases = ['oui', 'OUI', 'Oui.', 'oui !!!', ' oui ', 'o u i', 'ｏｕｉ', 'oui\u200b', '\u200boui', 'yes\u200b', 'always\u200b', 'toujours\u200d', '\ufeffoui', 'oui\u00a0', 'oui\u2060', 'yes', 'YES', 'Yes!', 'always', 'go', 'ok', 'okay', 'vas-y', 'vas y', 'd\'accord', 'd’accord', 'daccord', 'ouais', 'toujours',
    'sí', 'si', 'ja', 'ndio', 'ewa', 'eka', 'da', 'sim', 'evet', 'na\'am', 'hai', 'oui oui', 'oui, vas-y', 'je confirme', 'je valide', 'c\'est bon', 'accepte', 'valide', 'approuve', `/yes ${d.id}`, `/YES ${d.id}`, ` /yes ${d.id}`, `\u200b/yes ${d.id}`, `/always ${d.id}`, `/toujours ${d.id}`, `/oui ${d.id}`, `yes ${d.id}`, `oui ${d.id}`, `／yes ${d.id}`];
  const tranche: string[] = [];
  for (const p of phrases) {
    for (const chemin of ['/api/message', '/api/ask']) {
      // Le raccourci attend la réponse d'Odin : on n'attend pas la sienne, on regarde seulement la validation.
      const envoi = avecCle('POST', chemin, { text: p }).catch(() => ({ status: 0, texte: '' }));
      if (chemin === '/api/message') await envoi; else await Promise.race([envoi, dorm(150)]);
      await dorm(60);
      if (d.rendu() !== undefined) { tranche.push(`${chemin} ${JSON.stringify(p)}`); break; }
    }
    if (d.rendu() !== undefined) break;
  }
  await dorm(300);
  assert.deepEqual(tranche, [], 'aucune de ces phrases n\'a tranché la validation');
  assert.equal(d.rendu(), undefined, 'la demande attend toujours');
  assert.equal((await v.json('/api/message', { text: `/no ${d.id}` })).status, 202); assert.equal((await d.fin).allowed, false);
});

test('le filtre suit la passerelle : les mêmes formes de réponse, lues dans son code (sentinelle)', () => {
  const src = readFileSync(new URL('../src/bifrost/gateway.ts', import.meta.url), 'utf8');
  for (const [nom, forme] of Object.entries(FORMES_PASSERELLE)) assert.ok(src.includes(forme), `la passerelle ne reconnaît plus « ${nom} » sous cette forme : remets cle-acces.ts d'accord avec elle (${forme})`);
  // Et rien d'autre dans la passerelle ne répond à une validation : un seul endroit appelle « repondre ».
  assert.equal(src.split('this.approbations.repondre(').length - 1, 1, 'un seul endroit tranche une validation dans la passerelle');
});

test('une action d\'appli marquée « lecture » ne suffit pas : seules celles écrites dans la liste passent à la clé', async () => {
  const va = valhallaOf()!;
  // « Tester le débit » est marquée lecture, mais télécharge 25 Mo et écrit un fichier ; le fichier de configuration du VPN aussi.
  for (const [module, action] of [['svalinn', 'tester_debit'], ['gjoll', 'telecharger'], ['gjoll', 'trafic'], ['vidarr', 'tester'], ['var', 'personnes']]) {
    assert.equal(va.action(module, action)?.a.read, true, `${module}.${action} est bien marquée lecture`);
    assert.equal(refusDeLaCle('POST', '/api/valhalla/act', { corps: { module, action, input: {} }, applis: va })?.phrase, REFUS_CLE, `${module}.${action}`);
  }
  for (const nom of ACTIONS_LUES) { const [module, action] = nom.split('.'); const f = (await import('../src/valhalla/odin.ts')).allModules(v.o).find((m) => m.id === module)?.actions.find((a) => a.id === action); assert.ok(f, `${nom} existe`); assert.equal(f.read, true, `${nom} est une lecture`); assert.ok(!f.proprietaireSeul, `${nom} n'est pas « propriétaire seul »`); }
  // Noms fabriqués : rien ne passe.
  for (const c of [{ module: '__proto__', action: 'constructor' }, { module: 'constructor', action: 'prototype' }, { module: 'svalinn', action: '__proto__' }, { module: 'svalinn' }, {}]) {
    const r = await avecCle('POST', '/api/valhalla/act', c);
    assert.equal(r.status, 403, `${JSON.stringify(c)} → ${r.status}`);
  }
  for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) assert.equal((await avecCle('POST', '/api/action', { kind: k })).status, 403, k);
  for (const k of [['audit_list'], { toString: 'audit_list' }, 1, true, null]) assert.equal((await avecCle('POST', '/api/action', { kind: k })).status, 403, JSON.stringify(k));
});

test('des lectures qui rendent un secret ou lancent quelque chose : pas pour la clé', async () => {
  // Le détail d'une automatisation porte le chemin secret de son webhook (qui l'a la lance, sans clé ni session).
  assert.equal(refusDeLaCle('GET', '/api/draupnir/flow')?.phrase, REFUS_CLE);
  assert.equal(refusDeLaCle('GET', '/api/draupnir/state'), undefined, 'la liste des automatisations reste lisible');
  // Le contenu brut d'un paquet du réseau ; l'écoute en direct, qui lance une capture.
  assert.equal(refusDeLaCle('GET', '/api/ran/packet')?.phrase, REFUS_CLE); assert.equal(refusDeLaCle('GET', '/api/ran/live')?.phrase, REFUS_CLE);
  assert.equal(refusDeLaCle('GET', '/api/ran/history'), undefined, 'qui parle à qui reste lisible');
  for (const c of ['/api/draupnir/flow?id=x', '/api/ran/packet?id=1', '/api/ran/live']) assert.equal((await avecCle('GET', c)).status, 403, c);
  assert.notEqual((await brut('GET', '/api/ran/packet?id=1', undefined, { cookie: v.session })).status, 403, 'la session du propriétaire lit toujours');
});

test('l\'en-tête de la clé sous toutes ses formes, et la clé avec un cookie : toujours « lire et parler »', async () => {
  const geste = { kind: 'dry_run', on: true };
  for (const a of [`Bearer ${v.token}`, `bearer ${v.token}`, `BEARER   ${v.token}`, `Bearer\t${v.token}`, v.token]) {
    const r = await brut('POST', '/api/action', geste, { authorization: a });
    assert.equal(r.status, 403, `${a.slice(0, 10)}… → ${r.status}`); assert.equal(v.o.agent.dryRun(), false);
  }
  // La clé avec le vrai cookie du propriétaire : c'est une demande de la clé (un programme), pas le navigateur.
  assert.equal((await avecCle('POST', '/api/action', geste, { cookie: v.session })).status, 403);
  // La clé avec un faux cookie : pas mieux.
  assert.equal((await avecCle('POST', '/api/action', geste, { cookie: 'odin_session=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' })).status, 403);
  assert.equal(v.o.agent.dryRun(), false, 'rien n\'a changé');
  // Les autres endroits où une clé pourrait se glisser ne valent rien : en-tête x-api-key, adresse, cookie, corps.
  for (const [chemin, ent, corps] of [['/api/action', { 'x-api-key': v.token }, geste], [`/api/action?token=${v.token}`, {}, geste], [`/api/action?key=${v.token}`, {}, geste], ['/api/action', { cookie: `odin_token=${v.token}` }, geste], ['/api/action', {}, { ...geste, token: v.token, key: v.token }]] as Array<[string, Record<string, string>, unknown]>) {
    const r = await brut('POST', chemin, corps, ent);
    assert.equal(r.status, 401, `${chemin} ${Object.keys(ent).join(',')} → ${r.status}`);
  }
  // Le propriétaire dans son navigateur (son cookie, sans clé) n'est pas gêné.
  const p = await brut('POST', '/api/action', geste, { cookie: v.session });
  assert.equal(p.status, 200); assert.equal(v.o.agent.dryRun(), true);
  await brut('POST', '/api/action', { kind: 'dry_run', on: false }, { cookie: v.session }); assert.equal(v.o.agent.dryRun(), false);
});

test('les chemins déformés et la méthode glissée dans un en-tête n\'écrivent pas', async () => {
  const geste = { kind: 'dry_run', on: true };
  for (const c of ['/api/action/', '//api/action', '/API/ACTION', '/api/%61ction', '/api/action;x=1', '/api/action%2f', '/api/./action', '/api/x/../action', '/api/action?kind=dry_run&on=true', '/api/action#x']) {
    const r = await avecCle('POST', c, geste);
    assert.notEqual(r.status, 200, `${c} → ${r.status} ${r.texte.slice(0, 80)}`); assert.equal(v.o.agent.dryRun(), false, c);
  }
  for (const e of ['x-http-method-override', 'x-method-override', 'x-http-method']) {
    const r = await avecCle('GET', '/api/action', geste, { [e]: 'POST' });
    assert.notEqual(r.status, 200, e); assert.equal(v.o.agent.dryRun(), false, e);
  }
  // Une lecture fermée ne s'ouvre pas par une autre écriture de son chemin.
  for (const c of ['/api/conversations/export?all=1', '/api/conversations/export/?all=1', '/API/conversations/export?all=1', '/api/conversations//export?all=1', '/api/conversations/export%3Fall=1', '/api/terminal', '/api/terminal/', '/api/valhalla/fichier/?module=vidarr&ref=x', '/api/valhalla/partages/', '/api/runes/export/?base=x', '/api/memoire/export/']) {
    const r = await avecCle('GET', c);
    assert.ok(r.status === 403 || r.status === 404 || r.status === 405, `${c} → ${r.status} ${r.texte.slice(0, 60)}`);
  }
});

test('les lectures gardées ne rendent ni la clé, ni un mot de passe, ni une clé privée', async () => {
  const va = valhallaOf()!;
  va.ctx('gjoll').saveSettings({ server: { ...(va.ctx('gjoll').settings.server as object ?? {}), endpoint: '198.51.100.20', iface: 'wg-essai' } });
  assert.equal((await va.act('gjoll', 'ajouter', { nom: 'Téléphone 2', dns_odin: false, montrer: false })).ok, true);
  assert.equal((await va.act('svalinn', 'regler', { invites_nom: 'Maison-Invites', invites_mdp: 'bienvenue-essai-2026' })).ok, true);
  const lectures = ['/api/state', '/api/account/me', '/api/validations/attente', '/api/history', '/api/routing', '/api/evolutions', '/api/valhalla/catalog', '/api/valhalla/alerts', '/api/valhalla/manips', '/api/valhalla/notices', '/api/ports', '/api/fil', '/api/keryx/reglages', '/api/keryx/etat', '/api/keryx/secret', '/api/draupnir/state', '/api/plugins/etat', ...['var', 'svalinn', 'vidarr', 'gjoll'].map((m) => `/api/valhalla/view?id=${m}`)];
  const fuites: string[] = [];
  for (const c of lectures) {
    const r = await avecCle('GET', c);
    if (r.texte.includes(v.token)) fuites.push(`${c} : la clé d'accès`);
    if (/bienvenue-essai-2026/.test(r.texte)) fuites.push(`${c} : le mot de passe du Wi-Fi invités`);
    if (/PrivateKey|PresharedKey|"private(Key)?"\s*:\s*"[A-Za-z0-9+/=]{20,}/.test(r.texte)) fuites.push(`${c} : une clé privée du VPN`);
    if (/"(hash|salt|totp|secret)"\s*:\s*"[^"]{8,}/.test(r.texte)) fuites.push(`${c} : une empreinte ou un secret`);
    if (v.session && r.texte.includes(v.session.split('=')[1])) fuites.push(`${c} : le jeton de session`);
  }
  assert.deepEqual(fuites, []);
});
