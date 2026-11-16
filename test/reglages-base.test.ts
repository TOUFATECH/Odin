// Les réglages d'Odin dans Alexandrie (la base d'Odin, ODIN_ODIN, table reglages) : enregistrement → dans la base ;
// redémarrage → relu dans la base ; base absente → copie locale + alerte, puis resynchronisation ; aucun secret dans
// la base ; les données privées (numéro, e-mail, identifiant, position) jamais en clair, ni dans le dossier d'Odin ni
// dans la base. La base est remplacée par une base en mémoire (même interface que la vraie) ; un essai avec un VRAI
// PostgreSQL jetable tourne quand les programmes PostgreSQL sont sur la machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { amorcerReglages, DEF_REGLAGES, resteEnFichier, synchroniser, type EnBase, type Stockage } from '../src/reglages-base.ts';
import { loadConfig, odinPaths, setConfigValue } from '../src/config.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { nomBase } from '../src/valhalla/base/noms.ts';
import { Mnemosyne } from '../src/muninn/store.ts';
import { createOdin } from '../src/runtime.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { getAlarm, setAlarm, DEFAULT_ALARM } from '../src/home/alarm.ts';
import { rememberBefore } from '../src/undo.ts';
import type { AlertIn } from '../src/valhalla/types.ts';
import { pgDisponible, pgJetable } from './banc/pg-jetable.ts';
import { utiliserBase } from '../src/valhalla/base/index.ts';

process.env.ODIN_NO_VOICE_INSTALL ??= '1';
const silence = () => undefined;
const dossier = () => mkdtempSync(join(tmpdir(), 'odin-reglages-'));

/** Une base en mémoire : `panne` = elle ne répond pas (les écritures attendent, comme le journal d'attente). */
function fausseBase() {
  const lignes = new Map<string, EnBase>(), attente: Array<() => void> = [];
  const appliquer = (cle: string, valeur: unknown, maj: number, empreinte: string) => { const b = lignes.get(cle); if (!b || b.maj <= maj) lignes.set(cle, { valeur: JSON.parse(JSON.stringify(valeur)), maj, empreinte }); };
  const s = {
    panne: false, lignes,
    async lire() { if (s.panne) throw new Error('connexion refusée'); return new Map([...lignes].map(([k, v]) => [k, { ...v, valeur: JSON.parse(JSON.stringify(v.valeur)) }])); },
    poser(cle: string, valeur: unknown, maj: number, emp: string) { if (s.panne) attente.push(() => appliquer(cle, valeur, maj, emp)); else appliquer(cle, valeur, maj, emp); },
    retirer(cle: string) { if (s.panne) attente.push(() => lignes.delete(cle)); else lignes.delete(cle); },
    revenir() { s.panne = false; for (const f of attente.splice(0)) f(); },
  };
  return s as typeof s & Stockage;
}

test('la base des réglages d\'Odin s\'appelle ODIN_ODIN (règle NOM_ODIN), schéma « reglages »', () => {
  assert.equal(nomBase('odin'), 'ODIN_ODIN');
  assert.equal(DEF_REGLAGES.appli, 'odin'); assert.equal(DEF_REGLAGES.schema, 'reglages');
  assert.doesNotMatch(Object.values(DEF_REGLAGES.ecritures).join(' '), /'/, 'requêtes paramétrées seulement');
});

test('enregistrement → dans la base ; redémarrage → relu dans la base (la base fait foi) ; premier démarrage : fichiers copiés', async () => {
  const home = dossier(), paths = odinPaths(home), base = fausseBase();
  try {
    mkdirSync(home, { recursive: true });
    // Odin d'avant : des réglages en fichiers seulement.
    writeFileSync(paths.config, JSON.stringify({ name: 'Odin', network: { enabled: false } }, null, 2));
    const v0 = new Valhalla(home, []); v0.ctx('kvasir').saveSettings({ veille: ['ia'] }); v0.stop();
    // 1. Premier démarrage avec la base : tout y est copié, rien n'est perdu (les fichiers restent).
    let am = await amorcerReglages(home, { stockage: base, log: silence });
    assert.equal(am.source, 'base');
    assert.deepEqual(am.bilan!.versBase.sort(), ['config.json', 'valhalla/kvasir/réglages.json']);
    assert.ok(existsSync(paths.config) && existsSync(join(home, 'valhalla', 'kvasir', 'réglages.json')));
    // 2. Chaque enregistrement part dans la base.
    setConfigValue(paths, ['network', 'enabled'], true);
    assert.equal((base.lignes.get('config.json')!.valeur as { network: { enabled: boolean } }).network.enabled, true);
    const v = new Valhalla(home, []); v.ctx('kvasir').saveSettings({ veille: ['ia', 'linux'] }); v.saveSettings({ ordre: ['kvasir'] }); v.stop();
    assert.deepEqual((base.lignes.get('valhalla/kvasir/réglages.json')!.valeur as { veille: string[] }).veille, ['ia', 'linux']);
    assert.ok(base.lignes.has('valhalla/réglages.json'));
    // Réglages de la mémoire (réveil) : branchés comme dans runtime.ts.
    const odin = createOdin({ home, provider: new MockProvider([]) });
    await am.brancherMemoire(odin.muninn);
    setAlarm(odin.muninn, { ...DEFAULT_ALARM, enabled: true, work: '05:30' });
    assert.match(String(base.lignes.get('memoire:alarm')!.valeur), /05:30/);
    odin.close();
    am.arreter();
    // 3. Ailleurs (autre écran d'Odin, ou base restaurée) la base change : au redémarrage, elle fait foi.
    const b = base.lignes.get('config.json')!;
    base.lignes.set('config.json', { ...b, valeur: { ...(b.valeur as object), name: 'Odin du salon' }, maj: b.maj + 60_000, empreinte: 'autre' });
    const kv = base.lignes.get('memoire:alarm')!;
    base.lignes.set('memoire:alarm', { ...kv, valeur: JSON.stringify({ ...DEFAULT_ALARM, enabled: true, work: '06:15' }), empreinte: 'autre' });
    rmSync(join(home, 'valhalla', 'kvasir', 'réglages.json'));
    am = await amorcerReglages(home, { stockage: base, log: silence });
    assert.ok(am.bilan!.depuisBase.includes('config.json') && am.bilan!.depuisBase.includes('valhalla/kvasir/réglages.json'));
    assert.equal(loadConfig(paths).name, 'Odin du salon', 'relu dans la base');
    assert.deepEqual(new Valhalla(home, []).ctx('kvasir').settings.veille, ['ia', 'linux'], 'fichier perdu : recopié depuis la base');
    const odin2 = createOdin({ home, provider: new MockProvider([]) });
    await am.brancherMemoire(odin2.muninn);
    assert.equal(getAlarm(odin2.muninn).work, '06:15', 'réveil relu dans la base');
    odin2.close(); am.arreter();
    // 4. Un fichier modifié à la main (plus récent que la base) n'est pas écrasé : il part dans la base.
    const c = JSON.parse(readFileSync(paths.config, 'utf8')); c.name = 'Odin modifié à la main'; writeFileSync(paths.config, JSON.stringify(c));
    const futur = (Date.now() + 120_000) / 1000; utimesSync(paths.config, futur, futur);
    const r = await synchroniser(home, base);
    assert.ok(r.versBase.includes('config.json'));
    assert.equal((base.lignes.get('config.json')!.valeur as { name: string }).name, 'Odin modifié à la main');
    assert.equal(loadConfig(paths).name, 'Odin modifié à la main');
  } finally { rmSync(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); }
});

test('base absente au démarrage : copie locale + alerte ; les changements attendent ; la base revient et fait foi', async () => {
  const home = dossier(), paths = odinPaths(home), base = fausseBase();
  try {
    writeFileSync(paths.config, JSON.stringify({ name: 'Odin' }, null, 2));
    await (await amorcerReglages(home, { stockage: base, log: silence })).arreter();
    // Panne : Odin démarre quand même, avec sa copie, et le dit.
    base.panne = true;
    const am = await amorcerReglages(home, { stockage: base, log: silence });
    assert.equal(am.source, 'copie');
    assert.equal(loadConfig(paths).name, 'Odin', 'la copie locale sert');
    const alertes: AlertIn[] = []; am.brancherAlertes((a) => alertes.push(a));
    assert.equal(alertes.length, 1); assert.equal(alertes[0].key, 'reglages:copie'); assert.match(alertes[0].title, /copie locale/);
    // Un changement pendant la panne : dans la copie tout de suite, en attente pour la base.
    setConfigValue(paths, ['name'], 'Odin pendant la panne');
    assert.equal(loadConfig(paths).name, 'Odin pendant la panne');
    assert.equal((base.lignes.get('config.json')!.valeur as { name: string }).name, 'Odin');
    // La base revient : ce qui attendait part, puis elle fait foi ; l'alerte se referme ; les services sont prévenus.
    const relus: string[][] = []; am.surChangement((c) => relus.push(c));
    base.revenir(); await am.resynchroniser();
    assert.equal((base.lignes.get('config.json')!.valeur as { name: string }).name, 'Odin pendant la panne');
    assert.equal(alertes.at(-1)!.level, 'info'); assert.equal(alertes.at(-1)!.key, 'reglages:copie');
    assert.equal(am.source, 'base'); assert.deepEqual(relus, [], 'rien n\'a changé dans la base pendant la panne');
    am.arreter();
  } finally { rmSync(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); }
});

test('installation neuve sans base (ODIN_BASE=non) : comme avant, tout en fichiers', async () => {
  const home = dossier(), avant = process.env.ODIN_BASE;
  process.env.ODIN_BASE = 'non';
  try {
    const am = await amorcerReglages(home, { log: silence });
    assert.equal(am.source, 'sans-base'); assert.equal(am.base, undefined);
    const alertes: AlertIn[] = []; am.brancherAlertes((a) => alertes.push(a)); assert.equal(alertes.length, 0);
    const o = createOdin({ home, provider: new MockProvider([]) }); assert.equal(o.cfg.name, 'Odin'); o.close();
  } finally { if (avant === undefined) delete process.env.ODIN_BASE; else process.env.ODIN_BASE = avant; rmSync(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); }
});

test('aucun secret dans la base : applis à secrets, mots de passe, jetons, clés d\'API connues', async () => {
  const home = dossier(), base = fausseBase(), CLE = 'sk-temoin-SECRET-0123456789abcdef', avant = process.env.TEMOIN_API_KEY;
  process.env.TEMOIN_API_KEY = CLE;
  try {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ name: 'Odin' }));
    const v = new Valhalla(home, []);
    v.ctx('var').saveSettings({ people: [{ login: 'awa', hash: 'scrypt$témoin-empreinte' }] }); // Persona : secrets
    v.ctx('kvasir').saveSettings({ source: { url: 'https://exemple.fr', cle: CLE } }); // une clé d'API connue
    v.ctx('syn').saveSettings({ compte: { password: 'mdp-témoin-123' } }); // un mot de passe
    v.ctx('heidrun').saveSettings({ couleur: 'bleu' }); // rien de secret
    v.stop();
    const am = await amorcerReglages(home, { stockage: base, log: silence });
    assert.deepEqual([...base.lignes.keys()].sort(), ['config.json', 'valhalla/heidrun/réglages.json']);
    assert.deepEqual(am.bilan!.gardes.sort(), ['valhalla/kvasir/réglages.json', 'valhalla/syn/réglages.json', 'valhalla/var/réglages.json']);
    // Un enregistrement qui ajoute un secret ne part pas non plus.
    const v2 = new Valhalla(home, []); v2.ctx('heidrun').saveSettings({ token: 'jeton-témoin-abcdef' }); v2.stop();
    const tout = JSON.stringify([...base.lignes]);
    for (const t of [CLE, 'témoin-empreinte', 'mdp-témoin', 'jeton-témoin']) assert.ok(!tout.includes(t), `pas de « ${t} » dans la base`);
    assert.match(resteEnFichier('valhalla/brisingamen/réglages.json', {}) ?? '', /secrets/);
    am.arreter();
  } finally { if (avant === undefined) delete process.env.TEMOIN_API_KEY; else process.env.TEMOIN_API_KEY = avant; rmSync(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); }
});

/** Cherche un texte dans tous les fichiers d'un dossier. */
function trouveDans(dir: string, t: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) out.push(...trouveDans(p, t)); else if (readFileSync(p).includes(Buffer.from(t, 'utf8'))) out.push(p); }
  return out;
}

test('données privées jamais en clair : numéro, e-mail, identifiant, position (dossier d\'Odin et base) ; migration des anciennes', async () => {
  const home = dossier(), paths = odinPaths(home), base = fausseBase();
  const TEL = '+262639001122', MAIL = 'temoin.prive@exemple.fr', TG = '987654321', TEL2 = '+262639778899';
  try {
    // Odin d'avant : tout en clair (config, copie d'annulation, réveil, position de la maison, positions de la famille).
    writeFileSync(paths.config, JSON.stringify({ channels: { telegram: { enabled: false, tokenEnv: 'TELEGRAM_BOT_TOKEN', owners: [TG] }, signal: { enabled: false, url: 'http://127.0.0.1:8080', number: TEL, owners: [TEL] } }, mail: { imapHost: 'imap.exemple.fr', imapPort: 993, smtpHost: '', smtpPort: 465, user: MAIL, from: MAIL } }, null, 2));
    rememberBefore(home, 'essai', paths.config, 'ancienne copie');
    const m = new Mnemosyne(join(home, 'memoire')); m.setKv('alarm', JSON.stringify({ ...DEFAULT_ALARM, phone: TEL2, twilioFrom: TEL })); m.close?.();
    mkdirSync(join(home, 'valhalla', 'gladsheim'), { recursive: true });
    writeFileSync(join(home, 'valhalla', 'gladsheim', 'réglages.json'), JSON.stringify({ ville: 'Dembéni', lat: -12.84567, lon: 45.17891 }));
    writeFileSync(join(home, 'valhalla', 'gladsheim', 'positions.json'), JSON.stringify({ m1: [{ at: Date.now(), lat: -12.84567, lon: 45.17891 }] }));
    // Démarrage : base, puis Odin (migration), puis les applis.
    const am = await amorcerReglages(home, { stockage: base, log: silence });
    const odin = createOdin({ home, provider: new MockProvider([]) });
    await am.brancherMemoire(odin.muninn);
    const v = new Valhalla(home, []); const hestia = v.ctx('gladsheim');
    // Odin les lit en clair, en mémoire.
    assert.deepEqual(odin.cfg.channels.telegram!.owners, [TG]); assert.equal(odin.cfg.channels.signal!.number, TEL); assert.equal(odin.cfg.mail.user, MAIL);
    assert.equal(getAlarm(odin.muninn).phone, TEL2);
    assert.equal(hestia.settings.lat, -12.846, 'position gardée à ~100 m'); assert.equal(hestia.settings.lon, 45.179);
    // Un nouvel enregistrement reste chiffré.
    setConfigValue(paths, ['channels', 'telegram', 'owners'], [TG, '111222333']);
    assert.deepEqual(loadConfig(paths).channels.telegram!.owners, [TG, '111222333']);
    setAlarm(odin.muninn, { ...getAlarm(odin.muninn), phone: TEL2 });
    hestia.saveSettings({ lat: -12.846, lon: 45.179 });
    await synchroniser(home, base, odin.muninn);
    odin.close(); v.stop(); am.arreter();
    // Nulle part en clair : ni dans le dossier d'Odin (config, undo, mémoire, applis), ni dans la base.
    const tout = JSON.stringify([...base.lignes]);
    for (const t of [TEL, TEL2, MAIL, TG, '-12.84', '45.17', '111222333']) {
      assert.deepEqual(trouveDans(home, t), [], `« ${t} » en clair dans le dossier d'Odin`);
      assert.ok(!tout.includes(t), `« ${t} » en clair dans la base`);
    }
    assert.ok(base.lignes.has('config.json') && base.lignes.has('memoire:alarm'));
  } finally { rmSync(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); }
});

const SANS_PG = !pgDisponible() && 'PostgreSQL (initdb, pg_ctl) absent de la machine';
test('avec un VRAI PostgreSQL : réglages dans ODIN_ODIN, relus au redémarrage, base arrêtée → copie', { skip: SANS_PG, timeout: 180_000 }, async () => {
  const pg = await pgJetable(), home = pg.home, paths = odinPaths(home);
  const opts = { cible: { ...pg.cible, mode: 'machine' as const }, hringhorni: false, verifierMs: 300, log: silence, attenteMs: 60_000 };
  let am = await amorcerReglages(home, opts);
  try {
    assert.equal(am.source, 'base');
    setConfigValue(paths, ['name'], 'Odin en base');
    const a = am.base!.applisBranchees().find((x) => x.id === 'reglages')!; await a.vider();
    const r = await a.q('SELECT valeur->>$2 FROM reglages WHERE cle = $1', ['config.json', 'name']);
    assert.equal(r.rows[0][0], 'Odin en base');
    am.arreter(); await am.base!.arreter(); utiliserBase(undefined);
    // Redémarrage : relu dans la base (fichier effacé entre-temps).
    rmSync(paths.config);
    am = await amorcerReglages(home, opts);
    assert.equal(am.source, 'base'); assert.equal(loadConfig(paths).name, 'Odin en base');
    am.arreter(); await am.base!.arreter(); utiliserBase(undefined);
    // Base arrêtée : la copie sert.
    await pg.arreter();
    am = await amorcerReglages(home, { ...opts, attenteMs: 3000 });
    assert.equal(am.source, 'copie'); assert.equal(loadConfig(paths).name, 'Odin en base');
  } finally { am.arreter(); await am.base?.arreter(); utiliserBase(undefined); await pg.fin(); }
});
