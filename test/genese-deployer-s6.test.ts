// Genèse · Déployer, lot S6 (côté serveur) : « deployer » autorise en lot les PC choisis, UNE fois chacun, pour ce système
// et ces réglages, un temps limité ; effacer demande la phrase « effacer N pc », vérifiée ici ; au démarrage, le PC doit être
// EXACTEMENT celui autorisé (adresse MAC, numéro de série, carte mère, taille du disque quand il la dit), sinon rien n'est
// effacé ; un mot de passe par PC, chiffré et rangé dans le coffre, jamais montré.
// SÛRETÉ : aucun serveur n'écoute (ni DHCP, ni TFTP, ni HTTP) : chaque PC qui démarre est SIMULÉ par la demande qu'il
// ferait (PxeHttp.simuler, le même traitement que par le réseau). Aucun vrai PC, aucun vrai disque. Dossiers temporaires neufs.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { after, test } from 'node:test';
import * as T from '../src/valhalla/modules/thjalfi.ts';
import * as SRV from '../src/valhalla/thjalfi/server.ts';
import * as R from '../src/valhalla/thjalfi/recipes.ts';
import { sha512crypt } from '../src/valhalla/thjalfi/recipes.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { dechiffrerChamp } from '../src/vault.ts';

const X = T as unknown as Record<string, any>;
const S6 = SRV as unknown as Record<string, any>;
const RR = R as unknown as Record<string, any>;
const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const FIX = join(import.meta.dirname, 'fixtures', 'thjalfi');
const isoDir = (dir: string) => { mkdirSync(dir, { recursive: true }); for (const f of readdirSync(FIX)) writeFileSync(join(dir, f.replace(/\.gz$/, '')), gunzipSync(readFileSync(join(FIX, f)))); return dir; };

const A = '52:54:00:3a:91:0c', B = '52:54:00:7e:12:a4', C = '52:54:00:c1:5b:77', D = '52:54:00:0d:00:01', E = '52:54:00:0e:00:01';
const IP_A = '192.168.1.21', IP_VOISIN = '192.168.1.99';
const GO = 1024 ** 3;

// ---------------- Les règles pures ----------------
test('S6 · identiteDifferente : adresse, numéro de série, carte mère, taille du disque — un seul écart et rien n\'est effacé', () => {
  assert.equal(typeof S6.identiteDifferente, 'function', 'identiteDifferente exporté par thjalfi/server.ts');
  const att = { mac: A, serie: 'PC1A2B3C', uuid: '4c4c4544-0042-3510-8051-b4c04f4e3732', disque: 256 * GO };
  const bon = { serie: 'PC1A2B3C', uuid: '4c4c4544-0042-3510-8051-b4c04f4e3732', disque: 256 * GO };
  assert.equal(S6.identiteDifferente(att, A, bon), undefined, 'c\'est bien lui');
  assert.equal(S6.identiteDifferente(att, A.toUpperCase().replace(/:/g, '-'), { ...bon, serie: 'pc1a2b3c' }), undefined, 'mêmes valeurs, autre écriture');
  assert.equal(S6.identiteDifferente(att, A, { serie: bon.serie, uuid: bon.uuid }), undefined, 'iPXE ne connaît pas la taille du disque : la série et la carte mère suffisent');
  assert.match(S6.identiteDifferente(att, B, bon), /adresse MAC/);
  assert.match(S6.identiteDifferente(att, A, { ...bon, serie: 'AUTRE123' }), /numéro de série différent/, 'MAC usurpée, autre numéro de série');
  assert.match(S6.identiteDifferente(att, A, { uuid: bon.uuid, disque: bon.disque }), /numéro de série absent/, 'un PC qui tait sa série n\'est pas cru');
  assert.match(S6.identiteDifferente(att, A, { ...bon, uuid: '11111111-2222-3333-4444-555555555555' }), /carte mère différent/);
  assert.match(S6.identiteDifferente(att, A, { serie: bon.serie }), /carte mère absent/);
  assert.match(S6.identiteDifferente(att, A, { ...bon, disque: 512 * GO }), /taille du disque/, 'MAC usurpée, autre taille de disque');
  assert.equal(S6.identiteDifferente({ mac: A }, A, {}), undefined, 'ajouté à la main, jamais vu : seule l\'adresse est connue');
  assert.match(S6.identiteDifferente({ mac: '' }, A, bon), /adresse MAC/, 'une autorisation sans adresse ne vaut pour personne ici');
  assert.match(S6.identiteDifferente(att, '', bon), /adresse MAC/);
});

test('S6 · autorisationPour : la sienne d\'abord, sinon « le prochain » ; jamais une utilisée, annulée ou expirée', () => {
  const now = 1_000_000;
  const a = (o: Record<string, unknown>) => ({ id: String(Math.random()), lot: 'l', iso: 'u', facon: 'auto', nom: 'pc-01', cree: now - 10, expire: now + 1000, mac: A, ...o });
  const l = [a({ id: 'pro', mac: '', cree: now - 50 }), a({ id: 'a' }), a({ id: 'usee', mac: B, consommee: { at: now, mac: B } }), a({ id: 'annulee', mac: C, annulee: { at: now, raison: 'x' } }), a({ id: 'vieille', mac: D, expire: now - 1 })];
  assert.equal(S6.autorisationPour(l, A, now).id, 'a');
  assert.equal(S6.autorisationPour(l, E, now).id, 'pro', 'jamais pris dans un déploiement : « le prochain »');
  // Déjà pris dans un déploiement depuis moins de 24 h (utilisée, annulée, expirée) : jamais « le prochain » à sa place.
  for (const m of [B, C, D]) assert.equal(S6.autorisationPour(l, m, now), undefined, `${m} : pas « le prochain »`);
  assert.equal(S6.autorisationPour(l, B, now + 24 * 3600_000 + 1)?.id, undefined, '« le prochain » a expiré entre-temps');
  assert.equal(S6.autorisationPour(l.map((x: Record<string, unknown>) => (x.id === 'pro' ? { ...x, expire: now + 48 * 3600_000 } : x)), B, now + 24 * 3600_000 + 1).id, 'pro', 'au-delà de 24 h, de nouveau un PC comme les autres');
  assert.equal(S6.autorisationPour(l.filter((x: { id: string }) => x.id !== 'pro'), B, now), undefined, 'utilisée : jamais rejouée');
  assert.equal(S6.autorisationPour(l.filter((x: { id: string }) => x.id !== 'pro'), D, now), undefined, 'expirée');
  assert.equal(S6.autorisationPour(l, 'pas-une-mac', now), undefined);
  assert.equal(S6.autorisationPour('x', A, now), undefined);
  assert.equal(S6.tailleDisqueVue(new URLSearchParams('disque=274877906944')), 256 * GO);
  for (const v of ['', '-5', '12abc', '1e12', '99999999999999999999', '1024']) assert.equal(S6.tailleDisqueVue(new URLSearchParams(`disque=${v}`)), undefined, v);
});

test('S6 · demandeDeploiement, phrase, noms et mots de passe par PC', () => {
  assert.equal(X.phraseDeploiement(2), 'effacer 2 pc');
  const d = X.demandeDeploiement({ pcs: [A, A.toUpperCase(), B], prochain: true, facon: 'auto' });
  assert.deepEqual(d, { pcs: [A, B], prochain: true, facon: 'auto', n: 3 }, 'sans doublon ; le prochain compte');
  assert.deepEqual(X.demandeDeploiement({ pcs: `${A}, ${B}` }).pcs, [A, B], 'écrite en texte');
  for (const bad of [{ pcs: ['ff:ff:ff:ff:ff:ff'] }, { pcs: ['01:00:5e:00:00:01'] }, { pcs: ['x'] }, { pcs: [] }, { pcs: [A], facon: 'effacer-tout' }, { pcs: Array.from({ length: 51 }, (_, k) => `52:54:00:00:01:${k.toString(16).padStart(2, '0')}`) }, { pcs: { a: 1 } }])
    assert.ok('refus' in X.demandeDeploiement(bad), JSON.stringify(bad).slice(0, 80));
  assert.deepEqual(RR.nomsDesPcs([{ mac: A }, { mac: B }, { mac: '' }], 'auto'), ['pc-01', 'pc-02', 'pc-03']);
  assert.deepEqual(RR.nomsDesPcs([{ mac: A }, { mac: B }], 'auto', ['PC-01']), ['pc-02', 'pc-03'], 'un nom déjà pris est sauté');
  assert.deepEqual(RR.nomsDesPcs([{ mac: A, vu: 'Bureau Été' }, { mac: B, vu: 'bureau-ete' }, { mac: C }], 'vu'), ['bureau-ete', 'pc-01', 'pc-c15b77'], 'deux PC n\'ont jamais le même nom');
  assert.equal(RR.nomsDesPcs([{ mac: A, vu: '<script>x' }], 'vu')[0], 'script-x');
  const pws = new Set(Array.from({ length: 200 }, () => RR.motDePassePc()));
  assert.equal(pws.size, 200, 'un mot de passe neuf par PC');
  for (const p of pws) assert.match(p, /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-km-zA-HJ-NP-Z2-9]{16}$/);
  assert.equal(X.optionsDeploiement({ compte: 'Bad/Name' }).refus !== undefined, true);
  assert.deepEqual(X.optionsDeploiement({}), { exigences: true, local: true, compte: 'Utilisateur', viePrivee: true, langue: true, activation: 'auto' });
});

// ---------------- Avec Odin, PC simulés ----------------
interface Monde { v: Valhalla; home: string; dir: string; pc: (mac: string, q?: string, ip?: string) => Promise<string>; get: (p: string, ip?: string) => Promise<{ status: number; body: string }>; avance: (ms: number) => void; fin: () => void }
async function monde(o: { sansCoffre?: boolean } = {}): Promise<Monde> {
  const home = mkdtempSync(join(tmpdir(), 'odin-s6-')); dossiers.push(home);
  const saved = process.env.BRISINGAMEN_KEY; process.env.BRISINGAMEN_KEY = 'cd'.repeat(32);
  let t = new Date(2026, 10, 23, 12, 0).getTime();
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never).filter((m) => !(o.sansCoffre && m.id === 'brisingamen')), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('aucun réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(t) } as never);
  await v.act('eitri', 'dossier', { chemin: isoDir(join(home, 'iso')) });
  v.ctx('thjalfi').saveSettings({ ip: '192.168.1.10', mode: 'aucun' });
  const mod = v.modules().find((m) => m.id === 'thjalfi') as unknown as { serveurSimule: (c: unknown) => { simuler: (m: string, u: string, f: string) => Promise<{ status: number; body: string }> } };
  assert.equal(typeof mod.serveurSimule, 'function', 'le serveur de démarrage se simule sans rien écouter');
  const h = mod.serveurSimule(v.ctx('thjalfi'));
  const get = (p: string, ip = IP_A) => h.simuler('GET', p, ip);
  const pc = async (mac: string, q = '', ip = IP_A) => (await get(`/menu.ipxe?mac=${mac}&fw=efi${q ? `&${q}` : ''}`, ip)).body;
  return { v, home, dir: join(home, 'valhalla', 'thjalfi'), pc, get, avance: (ms) => { t += ms; }, fin: () => { v.stop(); if (saved === undefined) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = saved; } };
}
const UBU = 'ubuntu-24-04-3-live-server-amd64', WIN = 'win11-24h2-french-x64', MEM = 'memtest86plus-7-20';
const SERIE_A = 'serie=PC1A2B3C&uuid=4c4c4544-0042-3510-8051-b4c04f4e3732';
const autorisees = (w: Monde) => { try { return JSON.parse(readFileSync(join(w.dir, 'deploiements-autorises.json'), 'utf8')) as Array<Record<string, any>>; } catch { return []; } };
const tousLesFichiers = (d: string): string => readdirSync(d, { recursive: true }).map(String).filter((f) => { try { return statSync(join(d, f)).isFile(); } catch { return false; } }).map((f) => { try { return readFileSync(join(d, f), 'latin1'); } catch { return ''; } }).join('\n');

test('S6 · « deployer » : propriétaire seul, action grave ; la phrase EXACTE vérifiée ici ; rien d\'autorisé sinon', async () => {
  const w = await monde();
  try {
    const dep = w.v.modules().find((m) => m.id === 'thjalfi')!.actions.find((a) => a.id === 'deployer')!;
    assert.ok(dep, 'action deployer'); assert.equal(dep.proprietaireSeul, true); assert.equal(typeof dep.grave, 'function');
    assert.match(dep.grave!({ pcs: [A, B], facon: 'auto', iso: UBU }) ?? '', /EFFACER le disque de 2 PC/);
    assert.match(dep.grave!({ pcs: [A], facon: 'menu', iso: UBU }) ?? '', /sans rien effacer/);
    const bon = { pcs: [A, B], iso: UBU, facon: 'auto', phrase: 'effacer 2 pc' };
    for (const qui of [{ qui: 'member' as const }, { qui: 'guest' as const }, { auto: true }, { by: 'automatisation' as const }, { by: 'odin' as const }]) {
      const r = await w.v.act('thjalfi', 'deployer', bon, qui);
      assert.equal(r.ok, false, JSON.stringify(qui)); assert.equal(r.data, undefined, 'rien ne fuit');
    }
    // Appel direct sans la phrase, ou avec une autre : refusé côté serveur, rien n'est écrit.
    for (const phrase of [undefined, '', 'effacer 1 pc', 'effacer 3 pc', 'oui', 'effacer 2 pcs', 'effacer deux pc']) {
      const r = await w.v.act('thjalfi', 'deployer', { ...bon, phrase });
      assert.equal(r.ok, false, String(phrase)); assert.match(r.text, /Phrase incorrecte : il faut taper exactement « effacer 2 pc »/);
    }
    assert.deepEqual(autorisees(w), [], 'aucune autorisation sans la phrase');
    assert.equal((await w.v.act('thjalfi', 'deployer', { ...bon, phrase: ' Effacer  2  PC ' })).ok, true, 'majuscules et espaces ne comptent pas');
    // Un PC bloqué, une image qui ne s'installe pas seule, Windows sans partage : refusés.
    w.v.ctx('thjalfi').saveSettings({ bloques: { [C]: { at: 1, raison: 'prêté' } } });
    assert.match((await w.v.act('thjalfi', 'deployer', { pcs: [C], iso: UBU, facon: 'auto', phrase: 'effacer 1 pc' })).text, /Bloqué/);
    assert.match((await w.v.act('thjalfi', 'deployer', { pcs: [D], iso: MEM, facon: 'auto', phrase: 'effacer 1 pc' })).text, /ne s'installe pas tout seul/);
    assert.match((await w.v.act('thjalfi', 'deployer', { pcs: [D], iso: WIN, facon: 'auto', phrase: 'effacer 1 pc' })).text, /partage réseau/);
    assert.match((await w.v.act('thjalfi', 'deployer', { pcs: [D], iso: WIN, facon: 'menu' })).text, /seulement en « effacer et installer tout seul »/);
    assert.match((await w.v.act('thjalfi', 'deployer', { pcs: [D], iso: 'nimporte', facon: 'menu' })).text, /pas prêt/);
  } finally { w.fin(); }
});

test('S6 · un mot de passe par PC : chiffré, rangé dans le coffre, jamais dans une réponse, un journal ou un fichier en clair', async () => {
  const w = await monde();
  try {
    await w.pc(A, SERIE_A); // le PC A a été vu au menu (sa série est connue d'Odin)
    const r = await w.v.act('thjalfi', 'deployer', { pcs: [A, B], iso: UBU, facon: 'auto', phrase: 'effacer 2 pc', noms: 'auto' });
    assert.equal(r.ok, true, r.text);
    const l = autorisees(w);
    assert.equal(l.length, 2);
    const a = l.find((x) => x.mac === A)!, b = l.find((x) => x.mac === B)!;
    assert.equal(a.nom, 'pc-01'); assert.equal(b.nom, 'pc-02');
    assert.equal(a.serie, 'PC1A2B3C', 'la série vue par Odin est gardée pour la revérifier');
    assert.equal(b.serie, undefined, 'B jamais vu : rien d\'inventé');
    const pwA = dechiffrerChamp(w.home, a.mdp), pwB = dechiffrerChamp(w.home, b.mdp);
    assert.match(pwA, /^[A-Za-z0-9]{16}$/); assert.notEqual(pwA, pwB, 'un mot de passe PAR PC');
    assert.notEqual(a.mdp, pwA, 'gardé chiffré');
    // Le coffre a une entrée par PC (sans montrer le mot de passe).
    const c = await w.v.act('brisingamen', 'chercher', { q: 'Déploiement' });
    assert.match(c.text, /Déploiement · pc-01 \(52:54:00:3a:91:0c\)/); assert.match(c.text, /Déploiement · pc-02/);
    // Le PC A démarre : il est bien lui → son installation, avec SON mot de passe (empreinte seulement).
    const m = await w.pc(A, SERIE_A);
    assert.match(m, /autoinstall/); const tok = /seed\/([\w-]+)\//.exec(m)![1];
    const ud = (await w.get(`/seed/${tok}/user-data`)).body;
    assert.match(ud, /hostname: pc-01/);
    const h = /password: "(\$6\$[^$]+\$[^"]+)"/.exec(ud)![1];
    assert.equal(sha512crypt(pwA, h.split('$')[2]), h, 'l\'empreinte est celle du mot de passe de CE PC');
    // Nulle part en clair : réponses, résultat de l'action, journal des manips, fichiers d'Odin.
    for (const [quoi, txt] of [['réponse de deployer', JSON.stringify(r)], ['menu', m], ['user-data', ud], ['fichiers d\'Odin', tousLesFichiers(w.home)]] as const) {
      assert.ok(!txt.includes(pwA) && !txt.includes(pwB), `mot de passe en clair dans : ${quoi}`);
    }
  } finally { w.fin(); }
});

test('S6 · ATTAQUES au démarrage : PC non autorisé, MAC usurpée (autre série, série tue, autre disque), rejeu, expiration, « prochain » deux fois', async () => {
  const w = await monde();
  try {
    await w.pc(A, `${SERIE_A}&disque=${256 * GO}`); // vu au menu : série, carte mère, taille du disque
    const ok = (pcs: string[], o: Record<string, unknown> = {}) => w.v.act('thjalfi', 'deployer', { pcs, iso: UBU, facon: 'auto', phrase: `effacer ${pcs.length + (o.prochain ? 1 : 0)} pc`, ...o });
    assert.equal((await ok([A])).ok, true);
    // 1) Un PC qui n'est pas autorisé démarre : le menu ordinaire, son disque par défaut, rien n'est effacé.
    const c = await w.pc(C, 'serie=XYZ');
    assert.doesNotMatch(c, /autoinstall/); assert.match(c, /choose --default local/);
    // 2) La MAC de A recopiée sur un autre PC (autre série) : refus, rien n'est effacé, l'autorisation est annulée.
    const faux = await w.pc(A, 'serie=AUTRE999&uuid=4c4c4544-0042-3510-8051-b4c04f4e3732', IP_VOISIN);
    assert.doesNotMatch(faux, /autoinstall|seed\//); assert.match(faux, /choose --default local/);
    assert.ok(w.v.alerts({ module: 'thjalfi' }).some((x) => /Déploiement refusé/.test(x.title)), 'Odin prévient');
    assert.doesNotMatch(await w.pc(A, `${SERIE_A}&disque=${256 * GO}`), /autoinstall/, 'annulée : même le vrai PC doit être réautorisé');
    // Deux appareils ont cité l'adresse de A : pas de nouvel effacement tant que ce n'est pas clair (24 h).
    const conteste = await ok([A]);
    assert.equal(conteste.ok, false); assert.match(conteste.text, /Deux appareils différents ont démarré avec l'adresse 52:54:00:3a:91:0c/);
    const revu = async () => { w.avance(24 * 3600_000 + 1000); await w.pc(A, `${SERIE_A}&disque=${256 * GO}`); };
    // 3) Série tue, ou autre taille de disque : refus.
    await revu(); assert.equal((await ok([A])).ok, true);
    assert.doesNotMatch(await w.pc(A, 'uuid=4c4c4544-0042-3510-8051-b4c04f4e3732'), /autoinstall/, 'série tue');
    await revu(); assert.equal((await ok([A])).ok, true);
    assert.doesNotMatch(await w.pc(A, `${SERIE_A}&disque=${512 * GO}`), /autoinstall/, 'autre disque');
    // 4) Le bon PC : une seule fois ; le même menu redemandé (rejeu) n'efface plus rien.
    await revu(); assert.equal((await ok([A])).ok, true);
    const bon = await w.pc(A, SERIE_A);
    assert.match(bon, /autoinstall/); assert.match(bon, /choose --default e-ubuntu-24-04-3-live-server-amd64 --timeout 5000/);
    for (let k = 0; k < 3; k++) assert.doesNotMatch(await w.pc(A, SERIE_A), /autoinstall/, 'autorisation rejouée : refusée');
    const tok = /seed\/([\w-]+)\//.exec(bon)![1];
    assert.equal((await w.get(`/seed/${tok}/user-data`, IP_VOISIN)).status, 404, 'le jeton vu passer ne sert pas à un voisin');
    assert.equal((await w.get(`/seed/${tok}/user-data`)).status, 200, 'au PC vérifié seulement');
    // 5) Expirée : 2 h passées, plus rien.
    assert.equal((await ok([B])).ok, true);
    w.avance(2 * 3600_000 + 1000);
    assert.doesNotMatch(await w.pc(B), /autoinstall/, 'autorisation expirée');
    // 6) « Le prochain PC qui démarre » : UNE fois, et il expire (30 min).
    assert.equal((await ok([], { prochain: true })).ok, true);
    const d = await w.pc(D, 'serie=DDD111');
    assert.match(d, /autoinstall/, 'le premier PC qui démarre le prend');
    assert.doesNotMatch(await w.pc(E, 'serie=EEE222'), /autoinstall/, 'le deuxième : refusé');
    assert.equal((await ok([], { prochain: true })).ok, true);
    w.avance(30 * 60_000 + 1000);
    assert.doesNotMatch(await w.pc(E, 'serie=EEE222'), /autoinstall/, '« prochain » expiré');
    // 7) Une ancienne autorisation (« autoriser », installation automatique) ne rattrape pas un PC refusé.
    assert.equal((await w.v.act('thjalfi', 'autoriser', { mac: A, iso: 'ubuntu', auto: true })).ok, true);
    assert.equal((await ok([A])).ok, true);
    const usurpe = await w.pc(A, 'serie=AUTRE999&uuid=4c4c4544-0042-3510-8051-b4c04f4e3732', IP_VOISIN);
    assert.doesNotMatch(usurpe, /autoinstall|seed\//, 'refusé : aucune autre installation automatique ce coup-ci');
    // Aucune trace de seed pour les refusés.
    const l = autorisees(w);
    assert.ok(l.filter((a) => a.annulee).length >= 3, 'les autorisations refusées sont annulées, jamais réutilisables');
  } finally { w.fin(); }
});

test('S6 · « proposer au menu sans effacer » ne déclenche jamais d\'effacement', async () => {
  const w = await monde();
  try {
    const r = await w.v.act('thjalfi', 'deployer', { pcs: [A], iso: UBU, facon: 'menu' });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /Rien n'est effacé/);
    assert.equal(autorisees(w)[0].mdp, undefined, 'aucun compte créé, aucun mot de passe');
    const m = await w.pc(A, SERIE_A);
    assert.doesNotMatch(m, /autoinstall|seed\//); assert.match(m, /choose --default e-ubuntu-24-04-3-live-server-amd64 /);
    assert.match(m, /Ubuntu Server \(installatio/, 'l\'installation normale, avec ses questions');
  } finally { w.fin(); }
});

test('S6 · Windows : nom et mot de passe de CE PC (forme exigée par Windows, au seul PC vérifié), options de l\'étape 5', async () => {
  const w = await monde();
  try {
    await w.v.act('thjalfi', 'partage_windows', { unc: '\\\\nas\\iso', dossier: join(w.home, 'nas'), utilisateur: 'odin', mot_de_passe: 'secret-du-nas' });
    const r = await w.v.act('thjalfi', 'deployer', { pcs: [A], iso: WIN, facon: 'auto', phrase: 'effacer 1 pc', windows: { exigences: true, local: true, compte: 'Awa', viePrivee: true, langue: true, activation: 'aucune' } });
    assert.equal(r.ok, true, r.text);
    const pw = dechiffrerChamp(w.home, autorisees(w)[0].mdp);
    const m = await w.pc(A, SERIE_A);
    const tok = /seed\/([\w-]+)\//.exec(m)![1];
    const ua = (await w.get(`/seed/${tok}/unattend.xml`)).body;
    assert.match(ua, /<ComputerName>pc-01<\/ComputerName>/); assert.match(ua, /<Name>Awa<\/Name>/);
    assert.match(ua, /BypassTPMCheck/, 'sans les exigences'); assert.match(ua, /<ProtectYourPC>3<\/ProtectYourPC>/);
    assert.match(ua, /<WillWipeDisk>true<\/WillWipeDisk>/, 'le disque autorisé est effacé, le reste non');
    assert.ok(!ua.includes(pw), 'jamais en clair');
    // Windows exige le mot de passe dans son fichier de réponses (forme encodée) : seulement là, seulement au PC vérifié.
    assert.ok(ua.includes(Buffer.from(`${pw}Password`, 'utf16le').toString('base64')));
    assert.equal((await w.get(`/seed/${tok}/unattend.xml`, IP_VOISIN)).status, 404);
    assert.match(ua, /<Key><\/Key>/, 'clé d\'activation : aucune, comme choisi');
  } finally { w.fin(); }
});

test('S6 · « deployer » refusé par la clé d\'API (hors session du propriétaire)', async () => {
  const w = await monde();
  try {
    const { setValhalla } = await import('../src/valhalla/odin.ts');
    const { valhallaPost } = await import('../src/web/valhalla-api.ts');
    setValhalla(w.v);
    for (const action of ['deployer', 'deployer_apercu']) {
      const api = await valhallaPost('/api/valhalla/act', { module: 'thjalfi', action, input: { pcs: [A], iso: UBU, facon: 'auto', phrase: 'effacer 1 pc' } }) as { ok: boolean; code?: string; data?: unknown };
      assert.equal(api.ok, false, action); assert.equal(api.code, 'proprietaire', action); assert.equal(api.data, undefined);
    }
    assert.deepEqual(autorisees(w), []);
  } finally { w.fin(); }
});

test('S6 · une tablette « maison » ne déploie pas (bouton de sa page refusé)', async () => {
  const { T: Banc } = await import('./banc/lib.ts');
  const { vraiOdin } = await import('./banc/odin-vrai.ts');
  const { allModules: tous, valhallaOf } = await import('../src/valhalla/odin.ts');
  const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  try {
    const od = await vraiOdin(tt, { compte: true, modules: (o) => tous(o).filter((m) => ['gladsheim', 'thjalfi'].includes(m.id)) });
    const va = valhallaOf()!;
    const entree = { pcs: [A], iso: UBU, facon: 'auto', phrase: 'effacer 1 pc' };
    const f = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify({ pages: [{ id: 'a1b2c3d4', name: 'Maison', maison: true, widgets: [{ id: 'b0000001', kind: 'bouton', w: 1, module: 'thjalfi', action: 'deployer', label: 'PC', input: entree }] }] }) });
    assert.equal(f.ok, true, f.text);
    const cle = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette entrée', droits: 'maison' })).data as { key: string }).key;
    const r = await od.json('/api/maison/fenetre', { id: 'b0000001' }, { cookie: '', 'x-odin-maison': cle });
    assert.notEqual(r.body.ok, true, JSON.stringify(r.body));
    assert.equal(r.body.data, undefined);
  } finally { await tt.end(); Object.assign(console, orig); }
});

test('S6 · sans le coffre, aucun PC n\'est autorisé (personne ne connaîtrait son mot de passe)', async () => {
  const w = await monde({ sansCoffre: true });
  try {
    const r = await w.v.act('thjalfi', 'deployer', { pcs: [A], iso: UBU, facon: 'auto', phrase: 'effacer 1 pc' });
    assert.equal(r.ok, false); assert.match(r.text, /coffre/);
    assert.deepEqual(autorisees(w), []);
    assert.doesNotMatch(await w.pc(A, SERIE_A), /autoinstall/);
  } finally { w.fin(); }
});

// ---------------- Relecture en adversaire (sûreté d'abord) : ce qui ne doit JAMAIS effacer une deuxième fois ----------------
const valables = (w: Monde, mac: string) => autorisees(w).filter((a) => a.mac === mac && !a.consommee && !a.annulee);

test('S6 · relecture : un PC déjà déployé (ou refusé) ne reprend jamais « le prochain PC qui démarre »', async () => {
  const w = await monde();
  try {
    await w.pc(A, SERIE_A);
    assert.equal((await w.v.act('thjalfi', 'deployer', { pcs: [A], prochain: true, iso: UBU, facon: 'auto', phrase: 'effacer 2 pc' })).ok, true);
    assert.match(await w.pc(A, SERIE_A), /autoinstall/, 'A : sa propre autorisation');
    // L'installateur redémarre A (le réseau d'abord) : jamais un deuxième effacement, même avec « le prochain » encore libre.
    for (let k = 0; k < 2; k++) assert.doesNotMatch(await w.pc(A, SERIE_A), /autoinstall|seed\//, `A redémarre (${k + 1})`);
    // « Le prochain » d'un AUTRE lot, lancé pendant l'installation de A : A ne le prend pas non plus.
    assert.equal((await w.v.act('thjalfi', 'deployer', { pcs: [], prochain: true, iso: UBU, facon: 'auto', phrase: 'effacer 1 pc' })).ok, true);
    assert.doesNotMatch(await w.pc(A, SERIE_A), /autoinstall|seed\//, 'A en pleine installation : pas le « prochain » d\'un autre lot');
    // Un PC nommé dans le lot, refusé (identité différente), ne retombe pas sur « le prochain » au démarrage suivant.
    await w.pc(B, 'serie=BBB111');
    assert.equal((await w.v.act('thjalfi', 'deployer', { pcs: [B], prochain: true, iso: UBU, facon: 'auto', phrase: 'effacer 2 pc' })).ok, true);
    assert.doesNotMatch(await w.pc(B, 'serie=AUTRE999', IP_VOISIN), /autoinstall/, 'refusé');
    assert.doesNotMatch(await w.pc(B, 'serie=AUTRE999', IP_VOISIN), /autoinstall|seed\//, 'refusé, il redémarre : pas « le prochain » à sa place');
    // Le « prochain » reste pour un PC jamais vu dans un déploiement.
    assert.match(await w.pc(D, 'serie=DDD111', '192.168.1.40'), /autoinstall/);
  } finally { w.fin(); }
});

test('S6 · relecture : « deployer » qui attend le coffre ne fait jamais revivre une autorisation utilisée entre-temps ; deux onglets à la fois', async () => {
  const w = await monde();
  const bris = w.v.modules().find((m) => m.id === 'brisingamen')!.actions.find((a) => a.id === 'ajouter')!, orig = bris.run;
  try {
    await w.pc(A, SERIE_A);
    assert.equal((await w.v.act('thjalfi', 'deployer', { pcs: [A], iso: UBU, facon: 'auto', phrase: 'effacer 1 pc' })).ok, true);
    let lacher!: () => void; const porte = new Promise<void>((ok) => { lacher = ok; });
    bris.run = async (c, i) => { await porte; return orig(c, i); };
    const lent = w.v.act('thjalfi', 'deployer', { pcs: [B], iso: UBU, facon: 'auto', phrase: 'effacer 1 pc' });
    await new Promise((ok) => setTimeout(ok, 100)); // « deployer » a lu la liste et attend le coffre
    assert.match(await w.pc(A, SERIE_A), /autoinstall/, 'A démarre et utilise SON autorisation');
    lacher(); assert.equal((await lent).ok, true);
    bris.run = orig;
    assert.doesNotMatch(await w.pc(A, SERIE_A), /autoinstall|seed\//, 'l\'autorisation de A, utilisée, ne revit pas (aucun second effacement)');
    assert.equal(valables(w, B).length, 1, 'B autorisé');
    // Deux onglets lancent « deployer » pour le même PC au même moment : une seule autorisation valable à la fin.
    const [r1, r2] = await Promise.all([1, 2].map(() => w.v.act('thjalfi', 'deployer', { pcs: [C], iso: UBU, facon: 'auto', phrase: 'effacer 1 pc' })));
    assert.equal(r1.ok && r2.ok, true);
    assert.equal(valables(w, C).length, 1, 'jamais deux autorisations valables pour le même PC');
  } finally { bris.run = orig; w.fin(); }
});

test('S6 · relecture : après « fini », les fichiers de réponses (mot de passe) ne sont plus servis', async () => {
  const w = await monde();
  try {
    await w.pc(A, SERIE_A);
    assert.equal((await w.v.act('thjalfi', 'deployer', { pcs: [A], iso: UBU, facon: 'auto', phrase: 'effacer 1 pc' })).ok, true);
    const tok = /seed\/([\w-]+)\//.exec(await w.pc(A, SERIE_A))![1];
    assert.equal((await w.get(`/seed/${tok}/user-data`)).status, 200);
    assert.equal((await w.get(`/etat/${tok}?e=fini&nom=pc-01&ip=${IP_A}`)).status, 200);
    for (const n of ['user-data', 'preseed.cfg', 'ks.cfg', 'script-1.sh']) assert.equal((await w.get(`/seed/${tok}/${n}`)).status, 404, `${n} après la fin`);
    assert.equal((await w.get(`/w/${tok}/apres.ps1`)).status, 404);
  } finally { w.fin(); }
});
test('S6 · relecture : une requête forgée (MAC recopiée, autre série) avant l\'autorisation ne devient jamais l\'identité gardée', async () => {
  const w = await monde();
  try {
    const FORGE = 'serie=FORGE666&uuid=11111111-2222-3333-4444-555555555555';
    await w.pc(A, SERIE_A); // le vrai PC A, vu au menu
    await w.pc(A, FORGE, IP_VOISIN); // un voisin cite l'adresse de A, avec la série qu'il veut (sans connaître la vraie)
    const r = await w.v.act('thjalfi', 'deployer', { pcs: [A], iso: UBU, facon: 'auto', phrase: 'effacer 1 pc' });
    assert.equal(r.ok, false, 'identité contestée : rien n\'est autorisé'); assert.match(r.text, /Deux appareils différents/);
    assert.deepEqual(autorisees(w), []);
    assert.doesNotMatch(await w.pc(A, FORGE, IP_VOISIN), /autoinstall|seed\//, 'le voisin n\'est pas pris pour A');
    // « Proposer au menu » (rien d'effacé) reste possible.
    assert.equal((await w.v.act('thjalfi', 'deployer', { pcs: [A], iso: UBU, facon: 'menu' })).ok, true);
    // 24 h plus tard, seul le vrai A vu : de nouveau possible, et le voisin toujours refusé.
    w.avance(24 * 3600_000 + 1000); await w.pc(A, SERIE_A);
    assert.equal((await w.v.act('thjalfi', 'deployer', { pcs: [A], iso: UBU, facon: 'auto', phrase: 'effacer 1 pc' })).ok, true);
    assert.doesNotMatch(await w.pc(A, FORGE, IP_VOISIN), /autoinstall|seed\//);
  } finally { w.fin(); }
});
