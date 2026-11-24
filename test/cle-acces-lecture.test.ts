// La clé d'accès (clé d'API, « Authorization: Bearer … ») : lire et parler seulement. Décision du propriétaire (24/11) :
// « Elle peut lire l'état et parler à Odin (qui demande toujours ta validation pour agir). Tous les gestes qui écrivent
// sont réservés à ta session. » La règle tient dans src/web/cle-acces.ts ; le serveur la pose avant toute route.
// Ici : pour chaque famille de gestes, la clé reçoit 403 et RIEN n'est écrit ; la session du propriétaire marche comme
// avant ; les lectures et « parler » marchent avec la clé ; la clé ne peut pas répondre à une demande de validation.
// Un vrai Odin d'essai (serveur web + applis), dans un dossier temporaire, sur un port libre. Le tunnel reste éteint
// (carte factice) : aucune commande réseau. Adresses d'exemple seulement.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { T } from './banc/lib.ts';
import { COMPTE, vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { setTunFactory } from '../src/valhalla/modules/gjoll.ts';
import { ACTIONS_LUES, GESTES_LUS, REFUS_CLE, REFUS_VALIDATION, estValidationOuCommande, refusDeLaCle, reponseSecrete } from '../src/web/cle-acces.ts';
import type { GateDecision } from '../src/heimdall/policy.ts';
import type { AgentEvent } from '../src/types.ts';

setTunFactory(async () => ({ write: () => {}, onPacket: () => {}, close: () => {} }));
const MARQUE = 'REPONSE-DU-FAUX-MODELE-7c1e';
const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, cle: Record<string, string>;
const journal: string[] = [], parties: Array<{ peer: string; id: string }> = [];
const dorm = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function attendre(f: () => boolean, ms = 8000): Promise<boolean> { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await dorm(40); } return true; }

/** L'empreinte de tout ce qu'Odin garde sur le disque (hors base de la mémoire et journaux, qui bougent tout seuls). */
function disque(): string {
  const h = createHash('sha256'), voir = (dir: string) => {
    for (const n of readdirSync(dir).sort()) {
      const p = join(dir, n), st = statSync(p);
      if (st.isDirectory()) { if (p !== v.o.paths.logs) voir(p); continue; }
      if (/\.(db|sqlite)(-wal|-shm|-journal)?$/.test(n) || /\.log$/.test(n)) continue;
      h.update(p.slice(v.o.paths.home.length)); h.update(readFileSync(p));
    }
  };
  voir(v.o.paths.home); return h.digest('hex');
}
/** Ce qui vit en mémoire et que les gestes fermés changeraient. */
const etat = () => JSON.stringify({ autonomie: v.o.cfg.mimir.autonomy, essai: v.o.agent.dryRun(), profil: (v.web as unknown as { accounts: { profile(): unknown } }).accounts.profile(), reseau: valhallaOf()!.ctx('vidarr').settings, vpn: valhallaOf()!.ctx('gjoll').settings, comptes: valhallaOf()!.ctx('var').settings });
/** Une demande avec la clé, par n'importe quelle méthode. */
async function avecCle(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown>; texte: string }> {
  const r = await fetch(v.url + chemin, { method: methode, headers: { ...cle, ...(methode === 'GET' ? {} : { 'content-type': 'application/json', 'x-odin': '1' }), ...entetes }, body: methode === 'GET' ? undefined : typeof corps === 'string' ? corps : JSON.stringify(corps ?? {}), redirect: 'manual' });
  const texte = await r.text(); let body: Record<string, unknown> = {}; try { body = JSON.parse(texte) as Record<string, unknown>; } catch { body = {}; }
  return { status: r.status, body, texte };
}

before(async () => {
  console.log = (...a: unknown[]) => { journal.push(a.map(String).join(' ')); }; console.error = () => {}; console.warn = () => {};
  v = await vraiOdin(tt, { compte: true, script: () => ({ text: MARQUE }), modules: (o) => allModules(o).filter((m) => ['var', 'svalinn', 'vidarr', 'gjoll'].includes(m.id)) });
  v.o.cfg.web.portsParAppli = false;
  cle = { authorization: `Bearer ${v.token}` };
  const ev = v.web.event.bind(v.web);
  v.web.event = (peer: string, e: AgentEvent) => { if (e.type === 'approval') parties.push({ peer, id: (e as unknown as { id: string }).id }); ev(peer, e); };
  const va = valhallaOf()!;
  va.ctx('gjoll').saveSettings({ server: { ...(va.ctx('gjoll').settings.server as object ?? {}), endpoint: '198.51.100.20', iface: 'wg-essai' } });
  assert.equal((await va.act('gjoll', 'ajouter', { nom: 'Téléphone 1', dns_odin: false, montrer: false })).ok, true);
  va.ctx('svalinn').saveSettings({ invites: { ssid: 'Maison-Invites' } });
});
after(async () => {
  for (const x of parties) await v.json('/api/message', { text: `/no ${x.id}` }).catch(() => undefined);
  await tt.end(); Object.assign(console, orig);
});

// ---------------------------------------------------------------- la règle, seule
test('la règle : lire est permis, écrire est fermé, et toute route nouvelle qui écrit est fermée d\'office', () => {
  for (const c of ['/api/state', '/api/valhalla/catalog', '/api/account/me', '/api/validations/attente', '/api/stream', '/api/history', '/', '/api/une-lecture-de-demain']) assert.equal(refusDeLaCle('GET', c), undefined, c);
  for (const c of ['/api/conversations/export', '/api/runes/export', '/api/memoire/export', '/api/valhalla/export', '/api/valhalla/export/google/etat', '/api/valhalla/fichier', '/api/valhalla/partages', '/api/valhalla/partage', '/api/terminal/lire', '/api/terminal/apercu/s0123abcd/', '/api/rodd/archive/son']) assert.equal(refusDeLaCle('GET', c)?.phrase, REFUS_CLE, c);
  for (const c of ['/api/ports', '/api/backup', '/api/restore', '/api/upload', '/api/photo', '/api/valhalla/level', '/api/valhalla/ack', '/api/valhalla/depot', '/api/valhalla/morceau', '/api/valhalla/image', '/api/valhalla/order', '/api/valhalla/manip', '/api/valhalla/activer', '/api/valhalla/poste', '/api/plugins/installer', '/api/account/update', '/api/account/password', '/api/account/revoke', '/api/account/double-facteur/commencer', '/api/draupnir/save', '/api/runes/ligne', '/api/brain/page', '/api/voice/retirer', '/api/voice/clone', '/api/keryx/essayer', '/api/epingles', '/api/plume/reglage', '/api/personnes', '/api/reecritures/refuser', '/api/terminal/ecrire', '/api/widgets/regler', '/api/une-route-de-demain']) assert.equal(refusDeLaCle('POST', c)?.phrase, REFUS_CLE, c);
  for (const m of ['PUT', 'DELETE', 'PATCH']) assert.equal(refusDeLaCle(m, '/api/keryx/reglages')?.phrase, REFUS_CLE, m);
  // Le corps décide : tant qu'il n'est pas lu, pas de réponse ; lu, le geste est jugé.
  assert.equal(refusDeLaCle('POST', '/api/action'), undefined);
  assert.equal(refusDeLaCle('POST', '/api/action', { corps: { kind: 'audit_list' } }), undefined);
  for (const k of ['settings_save', 'cfg_save', 'set_autonomy', 'set_code_validation', 'device_block', 'tunnel_start', 'tunnel_stop', 'noyau_accepter', 'noyau_restaurer', 'access_links', 'token_rotate', 'vault_enable', 'vault_unlock', 'vault_disable', 'vault_lock', 'admin_password', 'machine_save', 'machine_remove', 'user_save', 'user_delete', 'user_link', 'pairing_approve', 'pairing_reject', 'pair_decide', 'backup_now', 'backup_save', 'update_apply', 'host_restart', 'app_restart', 'skill_approve', 'memory_forget', 'grant_revoke', 'cron_remove', 'routine_add', 'undo', 'fil_masquer', 'push_subscribe', 'channel_test', 'un_geste_de_demain', '', undefined]) assert.equal(refusDeLaCle('POST', '/api/action', { corps: { kind: k } })?.phrase, REFUS_CLE, String(k));
  // Les routes qui ont leur propre clé gardent leur réponse à elles.
  for (const c of ['/api/maison/theme', '/api/owntracks', '/api/pair', '/api/pair/status', '/api/setup/start', '/api/setup/status', '/api/account/create', '/api/account/login', '/api/account/logout', '/api/connexion-qr/decider']) assert.equal(refusDeLaCle('POST', c), undefined, c);
});

test('la règle : chaque geste gardé par la clé existe vraiment dans le serveur (pas de nom mal écrit)', () => {
  const src = readFileSync(new URL('../src/web/server.ts', import.meta.url), 'utf8');
  for (const k of GESTES_LUS) assert.ok(src.includes(`case '${k}':`), k);
  assert.ok(!GESTES_LUS.has('access_links'), 'les liens d\'accès et la clé ne se lisent pas avec la clé');
});

test('la règle : une réponse à une validation ou une commande n\'est pas « parler »', () => {
  for (const t of ['oui', 'Oui !', ' non ', 'ok', 'OK.', 'vas-y', 'vas y', 'd\'accord', 'd’accord', 'toujours', 'always', 'yes', 'no', 'go', 'ouais', 'nan', '/yes a1b2', '/no a1b2', '/oui 12', '/toujours 12', '/habitude oui', '/reveil ok', '/nimporte', 'oui, supprime', 'oui supprime cette conversation', 'confirme', 'ok pour moi']) assert.equal(estValidationOuCommande(t), true, t);
  for (const t of ['bonjour', 'quelle heure est-il ?', 'allume la lumière du salon', 'est-ce que oui ou non il va pleuvoir demain sur toute la région ?', 'non, je voulais dire : quel temps fera-t-il demain matin à la maison ?', 'raconte-moi ma journée']) assert.equal(estValidationOuCommande(t), false, t);
  assert.equal(refusDeLaCle('POST', '/api/ask', { corps: { text: 'oui' } })?.phrase, REFUS_VALIDATION);
  assert.equal(refusDeLaCle('POST', '/api/message', { corps: { text: '/yes 12' } })?.phrase, REFUS_VALIDATION);
  assert.equal(refusDeLaCle('POST', '/api/ask', { corps: { text: 'bonjour' } }), undefined);
});

test('la règle : une action d\'appli ne passe que si elle lit, sans confirmation, sans « propriétaire seul » ; une réponse secrète ne part pas', () => {
  // Une action écrite dans la liste (`ACTIONS_LUES`) ; le second filet : elle doit rester une lecture, sans « propriétaire seul », sans confirmation.
  const formes: Record<string, { m: { id: string }; a: Record<string, unknown> } | undefined> = { lire: { m: { id: 'x' }, a: { read: true } }, ecrire: { m: { id: 'x' }, a: {} }, seul: { m: { id: 'x' }, a: { read: true, proprietaireSeul: true } }, seulSelon: { m: { id: 'x' }, a: { read: true, proprietaireSeul: () => true } }, grave: { m: { id: 'x' }, a: { read: true, grave: () => 'remontrer le QR code' } }, casse: { m: { id: 'x' }, a: { read: true, grave: () => { throw new Error('panne'); } } } };
  const applis = (forme: string) => ({ ctx: () => ({}), action: () => formes[forme] });
  const juge = (forme: string, plus: Record<string, unknown> = {}) => refusDeLaCle('POST', '/api/valhalla/act', { corps: { module: 'svalinn', action: 'qr_invites', ...plus }, applis: applis(forme) });
  assert.ok(ACTIONS_LUES.has('svalinn.qr_invites'));
  assert.equal(juge('lire'), undefined);
  for (const a of ['ecrire', 'seul', 'seulSelon', 'grave', 'casse', 'inconnue']) assert.equal(juge(a)?.phrase, REFUS_CLE, a);
  assert.equal(juge('lire', { confirm: true })?.phrase, REFUS_CLE, 'une confirmation est une validation');
  assert.equal(refusDeLaCle('POST', '/api/valhalla/act', { corps: { module: 'svalinn', action: 'qr_invites' } })?.phrase, REFUS_CLE, 'sans les applis : fermé');
  // Hors de la liste : même une vraie lecture est fermée (la marque « read: true » ne suffit pas).
  assert.equal(refusDeLaCle('POST', '/api/valhalla/act', { corps: { module: 'x', action: 'lire' }, applis: applis('lire') })?.phrase, REFUS_CLE);
  assert.equal(reponseSecrete({ ok: true, data: { svg: '<svg/>', secret: true } }), true);
  assert.equal(reponseSecrete({ ok: true, data: { conf: '[Interface]\nPrivateKey = AAAA\n' } }), true);
  assert.equal(reponseSecrete({ ok: true, data: { file: true } }), true); assert.equal(reponseSecrete({ ok: true, fichiers: [{ nom: 'a', ref: 'b' }] }), true);
  assert.equal(reponseSecrete({ ok: true, text: 'rien', data: { svg: '<svg/>' } }), false); assert.equal(reponseSecrete(null), false);
  assert.equal(refusDeLaCle('POST', '/api/valhalla/act', { reponse: { ok: true, data: { secret: true } } })?.phrase, REFUS_CLE);
  // Le journal du refus ne porte jamais le contenu : seulement la méthode, le chemin et le nom du geste.
  assert.equal(refusDeLaCle('POST', '/api/action', { corps: { kind: 'admin_password', password: 'un-secret-a-ne-pas-noter' } })?.quoi, 'POST /api/action (admin_password)');
});

// ---------------------------------------------------------------- le vrai serveur : la clé n'écrit plus
test('la clé d\'accès : 403 sur chaque famille de gestes qui écrivent, et rien n\'est écrit', async () => {
  const avantDisque = disque(), avant = etat(), passe: string[] = [];
  const gestes: Array<Record<string, unknown>> = [
    { kind: 'settings_save', section: 'voice', values: { enabled: true } }, { kind: 'cfg_save', path: 'web.portsParAppli', value: true },
    { kind: 'set_autonomy', autonomy: 'autonome' }, { kind: 'set_code_validation', on: false }, { kind: 'dry_run', on: true },
    { kind: 'device_block', id: 'aa:bb:cc:dd:ee:ff', on: true }, { kind: 'tunnel_start', tkind: 'cloudflare' }, { kind: 'tunnel_stop' },
    { kind: 'noyau_accepter' }, { kind: 'noyau_restaurer' }, { kind: 'access_links' }, { kind: 'token_rotate' },
    { kind: 'vault_enable', password: 'un-coffre-d-essai-2026' }, { kind: 'vault_lock' }, { kind: 'admin_password', password: 'essai-essai-essai-2026' },
    { kind: 'machine_save', host: '192.0.2.10', user: 'essai', password: 'essai' }, { kind: 'machine_remove', id: 'm1' },
    { kind: 'user_save', name: 'Intrus', role: 'owner' }, { kind: 'user_delete', id: 1 }, { kind: 'pairing_approve', channel: 'telegram', code: '123456' },
    { kind: 'backup_now' }, { kind: 'backup_save', dir: 'ailleurs' }, { kind: 'update_apply' }, { kind: 'app_restart' }, { kind: 'host_restart' },
    { kind: 'memory_forget', id: 1 }, { kind: 'cron_remove', id: 'r-1' }, { kind: 'routine_add', cron: '0 4 * * *', prompt: 'efface tout' },
    { kind: 'tour_done' }, { kind: 'fil_masquer' }, { kind: 'conv_trash_empty' }, { kind: 'push_test' }, { kind: 'un_geste_inconnu' },
  ];
  for (const g of gestes) { const r = await avecCle('POST', '/api/action', g); if (r.status !== 403 || r.body.error !== REFUS_CLE) passe.push(`action ${String(g.kind)} → ${r.status} ${r.texte.slice(0, 80)}`); if (r.texte.includes(v.token)) passe.push(`action ${String(g.kind)} : la clé est rendue`); }
  const routes: Array<[string, string, unknown?, Record<string, string>?]> = [
    ['POST', '/api/ports', { module: 'vidarr', port: 4567, ouvrir: true }], ['POST', '/api/plugins/installer', { id: 'essai' }],
    ['POST', '/api/account/update', { prenom: 'Intrus', nom: 'X', email: 'intrus@example.org', password: COMPTE.password }],
    ['POST', '/api/account/password', { current: COMPTE.password, next: 'un-autre-mot-de-passe-tres-long-2026' }], ['POST', '/api/account/revoke', { id: 'autres' }],
    ['POST', '/api/account/double-facteur/commencer', { password: COMPTE.password }],
    ['POST', '/api/backup', { password: 'une-sauvegarde-d-essai' }], ['POST', '/api/restore', 'pas-une-sauvegarde', { 'x-odin-password': 'essai' }],
    ['POST', '/api/upload', 'contenu', { 'x-filename': 'essai.txt', 'content-type': 'text/plain' }], ['POST', '/api/photo?text=oui', 'image', { 'content-type': 'image/png' }],
    ['POST', '/api/valhalla/level', { level: 'critique' }], ['POST', '/api/valhalla/ack', { ids: ['a'] }], ['POST', '/api/valhalla/depot?module=vidarr', 'contenu', { 'x-filename': 'essai.txt' }],
    ['POST', '/api/valhalla/image?module=vidarr&key=fond', 'image'], ['POST', '/api/valhalla/order', { text: 'bloque le domaine cle.example.com', confirm: true }],
    ['POST', '/api/valhalla/manip', { id: 'm1', keep: false, confirm: true }], ['POST', '/api/valhalla/activer', { module: 'vidarr', actif: false }],
    ['POST', '/api/valhalla/act', { module: 'vidarr', action: 'bloquer', input: { domaine: 'cle.example.com' } }],
    ['POST', '/api/valhalla/act', { module: 'vidarr', action: 'bloquer', input: { domaine: 'cle.example.com' }, confirm: true }],
    ['POST', '/api/valhalla/act', { module: 'gjoll', action: 'ajouter', input: { nom: 'Intrus', dns_odin: false } }],
    ['POST', '/api/valhalla/act', { module: 'var', action: 'ajouter', input: { login: 'intrus', nom: 'Intrus', groupes: 'admin', mot_de_passe: 'un-mot-de-passe-d-essai-2026' } }],
    ['POST', '/api/draupnir/save', { flow: { name: 'essai' } }], ['POST', '/api/runes/base', { nom: 'essai' }], ['POST', '/api/brain/page', { titre: 'essai' }],
    ['POST', '/api/voice/retirer', { id: 'v1' }], ['PUT', '/api/keryx/reglages', { actif: true }], ['DELETE', '/api/keryx/secret'], ['POST', '/api/keryx/essayer', { texte: 'essai' }],
    ['POST', '/api/epingles', { ids: ['vidarr'] }], ['POST', '/api/personnes', { nom: 'Intrus' }], ['POST', '/api/reecritures/refuser', { id: 'b1' }],
    ['POST', '/api/terminal/ecrire', { id: 's0123abcd', texte: 'echo essai' }], ['POST', '/api/widgets/regler', { id: 'w1' }],
    ['GET', '/api/conversations/export?all=1'], ['GET', '/api/runes/export?base=essai'], ['GET', '/api/memoire/export'], ['GET', '/api/valhalla/export?module=vidarr&format=json'],
    ['GET', '/api/valhalla/fichier?module=vidarr&ref=x'], ['GET', '/api/valhalla/partages'], ['GET', '/api/terminal/lire?id=s0123abcd'],
  ];
  for (const [m, chemin, corps, ent] of routes) { const r = await avecCle(m, chemin, corps, ent); if (r.status !== 403 || r.body.error !== REFUS_CLE) passe.push(`${m} ${chemin} → ${r.status} ${r.texte.slice(0, 80)}`); }
  assert.deepEqual(passe, [], 'tout est refusé à la clé d\'accès');
  assert.equal(etat(), avant, 'rien n\'a changé en mémoire'); assert.equal(disque(), avantDisque, 'rien n\'a été écrit sur le disque');
  assert.equal((await avecCle('GET', '/api/state')).status, 200, 'la clé n\'a pas été changée : elle lit toujours');
  // Les routes ouvertes à tous gardent leur réponse à elles : la clé n'y donne aucun droit.
  assert.equal((await avecCle('POST', '/api/setup/start', {})).status, 409); assert.equal((await avecCle('POST', '/api/account/create', COMPTE)).status, 409);
  assert.equal((await avecCle('POST', '/api/pair', {})).status, 403); assert.equal((await avecCle('POST', '/api/connexion-qr/decider', { c: 'abcdefgh', ok: true })).status, 401, 'autoriser une connexion par QR code : il faut une session');
  assert.equal((await avecCle('POST', '/api/owntracks', { _type: 'location', lat: 0.5, lon: 0.5 })).status, 401); assert.equal((await avecCle('POST', '/api/maison/theme', { theme: 'clair' })).status, 401);
  assert.equal(etat(), avant); assert.equal(disque(), avantDisque);
  // Chaque refus est noté dans le journal du serveur, sans le contenu de la demande.
  const notes = journal.filter((l) => l.includes('clé d\'accès : refus de'));
  assert.ok(notes.length >= gestes.length + routes.length, `${notes.length} refus notés`);
  assert.ok(notes.some((l) => l.includes('POST /api/action (admin_password)')));
  assert.doesNotMatch(notes.join('\n'), new RegExp(`essai-essai-essai-2026|${COMPTE.password}|${v.token}`), 'ni mot de passe ni clé dans le journal');
});

test('la clé d\'accès : les lectures marchent toujours', async () => {
  for (const c of ['/api/state', '/api/valhalla/catalog', '/api/valhalla/view?id=vidarr', '/api/valhalla/alerts', '/api/account/me', '/api/validations/attente', '/api/history', '/api/evolutions', '/api/routing']) assert.equal((await avecCle('GET', c)).status, 200, c);
  const j = await avecCle('POST', '/api/action', { kind: 'audit_list', period: 'jour' });
  assert.equal(j.status, 200); assert.equal(j.body.ok, true, j.texte.slice(0, 200));
  const f = await avecCle('POST', '/api/action', { kind: 'device_page', id: 'inconnu' });
  assert.equal(f.status, 200, 'la demande va jusqu\'au geste'); assert.equal(f.body.error, 'appareil inconnu');
  const m = await fetch(`${v.url}/api/mascotte`, { headers: cle }); assert.notEqual(m.status, 403, 'la mascotte des applis reliées');
});

test('la clé d\'accès : une action de lecture d\'appli passe ; si sa réponse est secrète, elle ne part pas', async () => {
  // Le Wi-Fi invités sans mot de passe : un QR code à montrer à tout le monde. Lecture, pas de secret : permis.
  const ouvert = await avecCle('POST', '/api/valhalla/act', { module: 'svalinn', action: 'qr_invites', input: {} });
  assert.equal(ouvert.status, 200, ouvert.texte.slice(0, 200)); assert.equal(ouvert.body.ok, true); assert.match(String((ouvert.body.data as { svg?: string }).svg), /^<svg/);
  // Avec un mot de passe : la même lecture rend un secret. La clé ne le reçoit pas ; la session, si.
  assert.equal((await valhallaOf()!.act('svalinn', 'regler', { invites_nom: 'Maison-Invites', invites_mdp: 'bienvenue-essai-2026' })).ok, true);
  const garde = await avecCle('POST', '/api/valhalla/act', { module: 'svalinn', action: 'qr_invites', input: {} });
  assert.equal(garde.status, 403, garde.texte.slice(0, 200)); assert.equal(garde.body.error, REFUS_CLE); assert.doesNotMatch(garde.texte, /<svg|bienvenue/);
  const proprio = await v.json('/api/valhalla/act', { module: 'svalinn', action: 'qr_invites', input: {} });
  assert.equal(proprio.status, 200); assert.equal((proprio.body.data as { secret?: boolean }).secret, true);
  // Le QR code d'un appareil du VPN : une lecture qui demande une confirmation. Ni sans, ni avec.
  for (const confirm of [false, true]) {
    const q = await avecCle('POST', '/api/valhalla/act', { module: 'gjoll', action: 'qr', input: { nom: 'Téléphone 1' }, confirm });
    assert.equal(q.status, 403, `confirm ${confirm}`); assert.doesNotMatch(q.texte, /<svg|PrivateKey/);
  }
});

test('la clé d\'accès : parler à Odin marche toujours (/api/ask et /api/message)', async () => {
  const r = await avecCle('POST', '/api/ask', { text: 'raconte-moi ma journée' });
  assert.equal(r.status, 200, r.texte.slice(0, 200)); assert.match(r.texte, new RegExp(MARQUE));
  const brut = await avecCle('POST', '/api/ask', 'quelle heure est-il ?', { 'content-type': 'text/plain' });
  assert.equal(brut.status, 200); assert.ok(brut.texte.trim().length > 0 && !/session/.test(brut.texte), 'le texte brut du raccourci : Odin répond');
  assert.equal((await avecCle('POST', '/api/message', { text: 'bonjour Odin' })).status, 202);
  assert.equal((await avecCle('POST', '/api/voice/texte', { text: 'Il est 14 h 30.' })).status, 200, 'préparer un texte à dire n\'écrit rien');
});

test('la clé d\'accès ne peut pas répondre à une demande de validation : seule la session du propriétaire le peut', async () => {
  const avant = parties.length; let rendu: GateDecision | undefined;
  const g = v.o.heimdall.gate({ tool: 'shell', risk: 'exec', summary: 'supprimer le dossier essai-cle', sessionId: 'web:principal', tainted: false, grave: 'supprimer des fichiers' });
  void g.then((d) => { rendu = d; });
  assert.ok(await attendre(() => parties.length === avant + 1), 'la demande attend la réponse du propriétaire');
  const id = parties.at(-1)!.id;
  // La clé la voit (lecture), mais aucune de ses phrases ne la tranche.
  assert.ok(((await avecCle('GET', '/api/validations/attente')).body.list as Array<{ id: string }>).some((x) => x.id === id));
  for (const [chemin, corps] of [['/api/ask', { text: `/yes ${id}` }], ['/api/ask', { text: 'oui' }], ['/api/ask', { text: 'toujours' }], ['/api/message', { text: `/yes ${id}` }], ['/api/message', { text: 'Oui !' }], ['/api/message', { text: `/toujours ${id}` }], ['/api/photo?text=oui', 'image']] as Array<[string, unknown]>) {
    const r = await avecCle('POST', chemin, corps, typeof corps === 'string' ? { 'content-type': 'image/png' } : {});
    assert.equal(r.status, 403, `${chemin} ${JSON.stringify(corps)}`); assert.match(String(r.body.error), /session/);
  }
  const brut = await avecCle('POST', '/api/ask', 'oui', { 'content-type': 'text/plain' });
  assert.equal(brut.status, 403, 'le texte brut du raccourci aussi');
  await dorm(200);
  assert.equal(rendu, undefined, 'la demande attend toujours : la clé n\'a rien tranché');
  assert.ok(((await v.json('/api/validations/attente')).body.list as Array<{ id: string }>).some((x) => x.id === id), 'toujours en attente');
  // La session du propriétaire répond comme avant.
  assert.equal((await v.json('/api/message', { text: `/yes ${id}` })).status, 202);
  assert.equal((await g).allowed, true, 'son oui fait partir l\'action');
});

// ---------------------------------------------------------------- la session du propriétaire : comme avant
test('contrôle : la session du propriétaire fait les mêmes gestes comme avant', async () => {
  assert.equal((await v.json('/api/action', { kind: 'dry_run', on: true })).body.on, true); assert.equal(v.o.agent.dryRun(), true);
  assert.equal((await v.json('/api/action', { kind: 'dry_run', on: false })).body.on, false);
  assert.equal((await v.json('/api/action', { kind: 'set_autonomy', autonomy: 'prudent' })).body.ok, true); assert.equal(v.o.cfg.mimir.autonomy, 'prudent');
  const b = await v.json('/api/valhalla/act', { module: 'vidarr', action: 'bloquer', input: { domaine: 'session.example.com' } });
  assert.equal(b.body.ok, true, JSON.stringify(b.body)); assert.match(JSON.stringify(valhallaOf()!.ctx('vidarr').settings), /session\.example\.com/);
  assert.equal((await v.json('/api/valhalla/level', { level: 'haute' })).body.ok, true);
  const l = await v.json('/api/action', { kind: 'access_links' }); assert.equal(l.body.key, v.token, 'les liens d\'accès et la clé : dans sa session');
  const p = await v.json('/api/account/update', { prenom: 'Awa', nom: 'Saïd', email: COMPTE.email, password: COMPTE.password });
  assert.equal(p.status, 200, JSON.stringify(p.body)); assert.equal(p.body.ok, true);
  assert.equal((await fetch(`${v.url}/api/conversations/export?all=1`, { headers: { cookie: v.session } })).status !== 403, true, 'l\'export reste à la session');
});

test('contrôle : sans compte, il n\'y a pas encore de session — la clé installe Odin comme avant', async () => {
  const neuf = await vraiOdin(tt, { valhalla: false });
  const k = { authorization: `Bearer ${neuf.token}` };
  const r = await neuf.json('/api/action', { kind: 'dry_run', on: true }, k);
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.on, true);
  await neuf.json('/api/action', { kind: 'dry_run', on: false }, k);
});
