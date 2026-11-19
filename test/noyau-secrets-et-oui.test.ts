// Garde-fous d'Odin, suite des détours de Windows et des réponses aux validations.
// 1. Les fichiers de secrets et les données du noyau (configuration, journal d'audit, référence connue) restent hors des
//    outils de fichiers même écrits autrement : un flux NTFS (« .odin/vault.json::$DATA »), un point ou une espace en fin
//    de nom, un nom court 8.3, un partage réseau (« \\localhost\C$\… »). Sous Linux et macOS, rien ne change.
// 2. Un « oui » (ou « non ») tout court ne vaut que s'il n'y a qu'UNE demande en attente ; sinon Odin donne la liste,
//    chacune avec son identifiant (« /yes id », « /no id » restent exacts).
// 3. Une réponse arrivée après l'échéance (Heimdall a déjà dit non) dit « trop tard, rien n'est parti », jamais « Autorisé ».
// Tout se fait dans un dossier temporaire, sur un faux dossier d'Odin : jamais sur un vrai fichier.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toolPath, isSecretFile, type ApprovalRequest } from '../src/heimdall/policy.ts';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel } from '../src/bifrost/channel.ts';
import type { AgentEvent } from '../src/types.ts';
import { Approbations, TROP_TARD } from '../src/heimdall/approbations.ts';
import { makeOdin } from './helpers.ts';

const WIN = process.platform === 'win32';
const B = '\\';
const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

/** Un faux dossier personnel : un faux « .odin » (coffre, configuration, journal d'audit, référence) et un dossier de travail. */
function fauxHome(): string {
  const d = mkdtempSync(join(tmpdir(), 'noyau-secrets-')); dossiers.push(d);
  mkdirSync(join(d, '.odin', 'logs'), { recursive: true }); mkdirSync(join(d, 'travail'), { recursive: true });
  writeFileSync(join(d, '.odin', 'vault.json'), 'faux-coffre');
  writeFileSync(join(d, '.odin', 'config.json'), '{"faux":true}');
  writeFileSync(join(d, '.odin', 'noyau-reference-connue.txt'), 'fausse-reference');
  writeFileSync(join(d, '.odin', 'logs', 'audit.jsonl'), '{}\n');
  writeFileSync(join(d, '.odin', 'notes.md'), 'notes');
  writeFileSync(join(d, 'travail', 'a.txt'), 'travail');
  return d;
}

/** Le nom court 8.3 que le système a donné à une entrée d'un dossier, s'il en a donné un (sinon undefined). */
function nomCourt(dossier: string, nom: string): string | undefined {
  try {
    const sortie = execFileSync('cmd.exe', ['/d', '/c', 'dir', '/a', '/x', dossier], { encoding: 'latin1', windowsHide: true });
    for (const l of sortie.split(/\r?\n/)) { const m = l.match(/\s(\S+~\d+(?:\.\S+)?)\s+(\S.*)$/); if (m && m[2].trim().toLowerCase() === nom.toLowerCase()) return m[1]; }
  } catch { /* pas de dir */ }
  return undefined;
}

/** Le même dossier par le partage d'administration de la machine (« \\localhost\C$\… »), s'il répond. */
function parPartage(dossier: string, forme: 'unc' | 'unc-long'): string | undefined {
  const lettre = dossier[0], reste = dossier.slice(2);
  const p = forme === 'unc' ? `${B}${B}localhost${B}${lettre}$${reste}` : `${B}${B}?${B}UNC${B}localhost${B}${lettre}$${reste}`;
  return /^[A-Za-z]:\\/.test(dossier) && existsSync(p) ? p : undefined;
}

const plein = { workspace: '', fullAccess: true };
/** Ce que toolPath laisse passer (le contenu lu, pour la preuve), ou undefined s'il refuse. */
function passe(p: string, ecriture = false): string | undefined {
  try { const out = toolPath(plein, p, { ecriture }); try { return `permis (lu : ${JSON.stringify(readFileSync(out, 'utf8').slice(0, 20))})`; } catch { return 'permis'; } } catch { return undefined; }
}

test('Windows : un fichier de secrets d\'Odin par un flux NTFS, un point final, un nom court ou un partage → refusé comme le chemin normal', { skip: !WIN && 'Windows seulement' }, () => {
  const h = fauxHome(), o = join(h, '.odin');
  const formes = [
    `${o}${B}vault.json::$DATA`, `${o}${B}vault.json:$DATA`, `${o}${B}VAULT.JSON::$data`, `${o}${B}vault.json.`, `${o}${B}vault.json  `,
    `${o}:$I30:$INDEX_ALLOCATION${B}vault.json`, `${h}${B}.odin.${B}vault.json`,
  ];
  const coO = nomCourt(h, '.odin'), coV = nomCourt(o, 'vault.json');
  if (coO) formes.push(`${h}${B}${coO}${B}vault.json`);
  if (coV) formes.push(`${o}${B}${coV}`);
  const unc = parPartage(h, 'unc'), uncL = parPartage(h, 'unc-long');
  if (unc) formes.push(`${unc}${B}.odin${B}vault.json`, `${unc}${B}.odin${B}vault.json::$DATA`, ...(coO ? [`${unc}${B}${coO}${B}vault.json`] : []));
  if (uncL) formes.push(`${uncL}${B}.odin${B}vault.json::$DATA`);
  const nom = (f: string) => f.replace(uncL ?? '\0', '<partage-long>').replace(unc ?? '\0', '<partage>').replace(h, '<dossier>');
  const permis = formes.map((f) => [nom(f), passe(f), passe(f, true)] as const).filter(([, l, e]) => l || e).map(([f, l, e]) => `${f} → lecture ${l ?? 'refusée'}, écriture ${e ?? 'refusée'}`);
  console.log(`# formes essayées : ${formes.length} (nom court de .odin : ${coO ?? 'aucun'}, de vault.json : ${coV ?? 'aucun'}, partage : ${unc ? 'oui' : 'non'})`);
  assert.deepEqual(permis, []);
  // isSecretFile (Alexandrie, les projets) : la même règle sur le texte
  assert.ok(isSecretFile(`${o}${B}vault.json::$DATA`), 'isSecretFile(…vault.json::$DATA)');
  assert.ok(isSecretFile(`${o}${B}vault.json.`), 'isSecretFile(…vault.json.)');
  assert.ok(isSecretFile('x/.odin/vault.json:$DATA'));
});

test('Windows : isSecretFile (Alexandrie, les photos de Hlín, les projets) reconnaît aussi un nom court, une jonction et un partage, comme toolPath', { skip: !WIN && 'Windows seulement' }, () => {
  const h = fauxHome(), o = join(h, '.odin');
  const formes = [`${o}${B}vault.json::$DATA`];
  const coO = nomCourt(h, '.odin'), coV = nomCourt(o, 'vault.json');
  if (coO) formes.push(`${h}${B}${coO}${B}vault.json`, `${h}${B}${coO}${B}vault.json::$DATA`);
  if (coV) formes.push(`${o}${B}${coV}`, `${o}${B}${coV}::$DATA`);
  try { symlinkSync(o, join(h, 'lien'), 'junction'); formes.push(`${h}${B}lien${B}vault.json`, `${h}${B}lien${B}vault.json::$DATA`); } catch { /* pas de jonction ici */ }
  const unc = parPartage(h, 'unc');
  if (unc) {
    if (coO) formes.push(`${unc}${B}${coO}${B}vault.json`);
    if (coV) formes.push(`${unc}${B}.odin${B}${coV}::$DATA`);
    if (existsSync(join(h, 'lien'))) formes.push(`${unc}${B}lien${B}vault.json`);
  }
  const vus = formes.filter((f) => { try { toolPath(plein, f); return false; } catch { return true; } });
  assert.deepEqual(vus, formes, 'toolPath refuse déjà toutes ces formes');
  const non = formes.filter((f) => !isSecretFile(f)).map((f) => f.replace(unc ?? '\0', '<partage>').replace(h, '<dossier>'));
  console.log(`# formes essayées : ${formes.length} (nom court de .odin : ${coO ?? 'aucun'}, de vault.json : ${coV ?? 'aucun'}, partage : ${unc ? 'oui' : 'non'})`);
  assert.deepEqual(non, []);
  // un fichier ordinaire par les mêmes chemins n'est pas un secret
  assert.equal(isSecretFile(join(h, 'travail', 'a.txt')), false);
  if (existsSync(join(h, 'lien'))) assert.equal(isSecretFile(`${h}${B}lien${B}notes.md`), false);
});

test('Windows : la configuration, le journal d\'audit et la référence du noyau par un flux, un point final, un nom court ou un partage → pas d\'écriture', { skip: !WIN && 'Windows seulement' }, () => {
  const h = fauxHome(), o = join(h, '.odin');
  const formes = [
    `${o}${B}config.json::$DATA`, `${o}${B}config.json.`, `${o}${B}CONFIG.json :$DATA`, `${o}${B}noyau-reference-connue.txt::$DATA`,
    `${o}${B}logs${B}audit.jsonl::$DATA`, `${o}${B}logs:$I30:$INDEX_ALLOCATION${B}audit.jsonl`,
  ];
  const coO = nomCourt(h, '.odin'), coR = nomCourt(o, 'noyau-reference-connue.txt'), coC = nomCourt(o, 'config.json');
  if (coO) formes.push(`${h}${B}${coO}${B}config.json`);
  if (coR) formes.push(`${o}${B}${coR}`);
  if (coC) formes.push(`${o}${B}${coC}`);
  const unc = parPartage(h, 'unc');
  if (unc) formes.push(`${unc}${B}.odin${B}config.json`, `${unc}${B}.odin${B}config.json::$DATA`, `${unc}${B}.odin${B}noyau-reference-connue.txt::$DATA`);
  const permis = formes.filter((f) => passe(f, true)).map((f) => `écriture permise : ${f.replace(unc ?? '\0', '<partage>').replace(h, '<dossier>')}`);
  // dans l'espace de travail (sans l'accès complet) : pareil
  for (const f of ['.odin/config.json::$DATA', '.odin/noyau-reference-connue.txt.', '.odin/logs/audit.jsonl::$DATA']) {
    try { toolPath({ workspace: h }, f, { ecriture: true }); permis.push(`écriture permise dans l'espace de travail : ${f}`); } catch { /* refusé */ }
  }
  console.log(`# formes essayées : ${formes.length + 3} (noms courts : ${[coO, coR, coC].filter(Boolean).join(', ') || 'aucun'}, partage : ${unc ? 'oui' : 'non'})`);
  assert.deepEqual(permis, []);
});

test('ne change pas : un chemin ordinaire (même par un flux ou un partage), lire la configuration, un fichier ordinaire de .odin', () => {
  const h = fauxHome(), o = join(h, '.odin');
  assert.equal(readFileSync(toolPath(plein, join(h, 'travail', 'a.txt')), 'utf8'), 'travail');
  assert.ok(toolPath(plein, join(h, 'travail', 'a.txt'), { ecriture: true }));
  assert.ok(toolPath(plein, join(o, 'notes.md'), { ecriture: true }), 'un fichier ordinaire de .odin s\'écrit');
  assert.ok(toolPath(plein, join(o, 'config.json')), 'la configuration se lit (seule l\'écriture est réservée)');
  assert.ok(toolPath(plein, join(h, 'vault.json'), { ecriture: true }), 'un « vault.json » hors de .odin n\'est pas un secret d\'Odin');
  assert.ok(toolPath({ workspace: h }, 'travail/a.txt', { ecriture: true }));
  assert.throws(() => toolPath(plein, join(o, 'vault.json')), /secrets/);
  assert.throws(() => toolPath(plein, join(o, 'config.json'), { ecriture: true }), /garde-fous/);
  if (WIN) {
    assert.ok(toolPath(plein, `${h}${B}travail${B}a.txt::$DATA`, { ecriture: true }), 'un fichier ordinaire par un flux reste permis');
    const unc = parPartage(h, 'unc');
    if (unc) assert.equal(readFileSync(toolPath(plein, `${unc}${B}travail${B}a.txt`), 'utf8'), 'travail');
  } else {
    // ailleurs qu'en Windows, « vault.json::$DATA » est un autre fichier : la règle reste celle du texte
    assert.equal(isSecretFile('/x/.odin/vault.json::$DATA'), false);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Les réponses aux validations, par la passerelle (Telegram d'essai, propriétaire « 42 »).

function passerelle(timeoutSec?: number) {
  const o = makeOdin([], timeoutSec ? { config: (c) => ({ ...c, policy: { ...c.policy, approvalTimeoutSec: timeoutSec } }) } : {});
  const sent: string[] = [], events: AgentEvent[] = [];
  const tg: Channel = { name: 'telegram', interactive: true, defaultPeer: '42', start: async () => {}, stop: async () => {}, send: async (_p, text) => { sent.push(text); }, event: (_p, e) => { events.push(e); } };
  const gw = new Gateway(o, { owners: { telegram: ['42'] } });
  gw.add(tg);
  const dire = (text: string, peer = '42') => gw.handle({ channel: 'telegram', peer, name: 'moi', text });
  const demande = (id: string, summary: string) => {
    const r: ApprovalRequest = { id, tool: 'valhalla_manip', risk: 'exec', summary, reason: 'demande d\'un membre', sessionId: 'telegram:42', grantable: false };
    const etat = { reponse: 'attente' as unknown };
    void gw.approver.approve(r).then((a) => { etat.reponse = a; });
    return etat;
  };
  return { o, gw, sent, events, dire, demande };
}
const tour = () => new Promise((r) => setImmediate(r));

test('deux demandes en attente (B puis A) : « oui » tout court ne valide rien et donne la liste ; « /yes id » reste exact ; seule, un « oui » marche comme avant', async () => {
  const { sent, events, dire, demande } = passerelle();
  const b = demande('dem-b0001', 'annuler le rendez-vous de Lou');
  const a = demande('dem-a0002', 'annuler le rendez-vous de Sam');
  await tour();
  await dire('oui'); await tour();
  assert.deepEqual([b.reponse, a.reponse], ['attente', 'attente'], `un « oui » nu ne valide rien quand deux demandes attendent (B=${String(b.reponse)}, A=${String(a.reponse)})`);
  assert.equal(events.filter((e) => e.type === 'approval_done').length, 0);
  const liste = sent.at(-1)!;
  assert.match(liste, /dem-b0001/); assert.match(liste, /dem-a0002/);
  assert.match(liste, /\/yes dem-b0001/); assert.match(liste, /\/no dem-a0002/);
  assert.match(liste, /rendez-vous de Lou/);
  // « non » et « toujours » tout courts : pareil
  await dire('non'); await dire('ok !'); await tour();
  assert.deepEqual([b.reponse, a.reponse], ['attente', 'attente']);
  // quelqu'un d'autre que le propriétaire : rien
  await dire('/yes dem-b0001', '666'); await tour();
  assert.equal(b.reponse, 'attente');
  // « /yes id » : exactement celle-là
  await dire('/yes dem-b0001'); await tour();
  assert.deepEqual([b.reponse, a.reponse], [true, 'attente']);
  assert.deepEqual(events.filter((e) => e.type === 'approval_done').map((e) => (e as { id: string }).id), ['dem-b0001']);
  // une seule demande attend : le « oui » nu marche comme avant
  await dire('oui'); await tour();
  assert.equal(a.reponse, true);
  // « /no id » reste exact
  const c = demande('dem-c0003', 'effacer une note'), d = demande('dem-d0004', 'effacer une photo');
  await tour();
  await dire('/no dem-d0004'); await tour();
  assert.deepEqual([c.reponse, d.reponse], ['attente', false]);
  await dire('non'); await tour();
  assert.equal(c.reponse, false, 'seule restante : un « non » nu la refuse');
});

test('une réponse après l\'échéance : « trop tard, rien n\'est parti », jamais « Autorisé »', async () => {
  const { sent, events, dire, demande } = passerelle(1);
  // dans les temps : comme avant
  const t = demande('dem-t0001', 'envoyer un message'); await tour();
  await dire('/yes dem-t0001'); await tour();
  assert.equal(t.reponse, true);
  // après l'échéance (Heimdall a déjà dit non au bout d'une seconde)
  demande('dem-l0002', 'envoyer un autre message'); await tour();
  await new Promise((r) => setTimeout(r, 1_150));
  const avant = events.length;
  await dire('oui'); await tour();
  const done = events.slice(avant).filter((e) => e.type === 'approval_done');
  assert.deepEqual(done, [], `pas d'« approval_done » (l'interface afficherait « Autorisé. ») : ${JSON.stringify(done)}`);
  assert.match(sent.at(-1)!, /trop tard/i);
  assert.match(sent.at(-1)!, /rien n'est parti/i);
  await dire('/yes dem-l0002'); await tour();
  assert.deepEqual(events.slice(avant).filter((e) => e.type === 'approval_done'), []);
  assert.match(sent.at(-1)!, /trop tard/i);
});

test('Approbations (le noyau) : plusieurs en attente → aucune « seule » ni « dernière » ; après l\'échéance → trop tard, la demande ne part pas', async () => {
  const a = new Approbations();
  const p1 = a.attendre('x1', { echeanceMs: 60_000, resume: 'un' }); a.attendre('x2', { echeanceMs: 60_000, resume: 'deux' });
  assert.equal(a.seule(), undefined); assert.equal(a.derniere(), undefined);
  assert.deepEqual(a.dansLesTemps().map((x) => x.id), ['x1', 'x2']);
  assert.deepEqual(a.repondre('x1', 'oui', true), { ok: true, reponse: 'yes' });
  assert.equal(await p1, true); assert.equal(a.seule(), 'x2');
  let parti = false; void a.attendre('x3', { echeanceMs: 1_000 }).then(() => { parti = true; });
  assert.deepEqual(a.repondre('x3', 'oui', true, Date.now() + 1_000), { ok: false, raison: TROP_TARD });
  await tour(); assert.equal(parti, false);
});
