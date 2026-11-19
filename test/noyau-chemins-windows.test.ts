// Les détours d'écriture de Windows vers le noyau et le code sensible : un flux NTFS (« src/vault.ts::$DATA »,
// « src/heimdall:$I30:$INDEX_ALLOCATION/policy.ts »), un nom court 8.3 (« DECISI~1.TS »), un point ou une espace en fin
// de nom, un caractère de contrôle. Le chemin est ramené au fichier qu'il désigne (ou traité comme le noyau) : la règle
// de réécriture demande la validation du noyau, exactement comme pour le chemin normal. Sous Linux et macOS, rien ne
// change. Tout se fait dans un dossier temporaire, sur une fausse arborescence : jamais sur un vrai fichier du noyau.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as noyau from '../src/heimdall/noyau.ts';
import { Heimdall, type ApprovalRequest, type GateInput } from '../src/heimdall/policy.ts';
import { cheminsCodeDe, deciderPuisLancer } from '../src/heimdall/executer.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

const { estNoyau, estSensible, graveNoyau, cheminReelRelatif, cheminVraiRelatif, RACINE_APPLI } = noyau;
const WIN = process.platform === 'win32';
const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const enSlash = (x: string | undefined) => x?.replace(/\\/g, '/');

/** Une fausse racine d'appli : un faux coffre, une fausse règle, un faux fichier sensible, un fichier ordinaire. */
function fausseRacine(): string {
  const r = mkdtempSync(join(tmpdir(), 'noyau-chemins-')); dossiers.push(r);
  mkdirSync(join(r, 'src', 'heimdall'), { recursive: true }); mkdirSync(join(r, 'src', 'mimir'), { recursive: true });
  mkdirSync(join(r, 'src', 'core'), { recursive: true }); mkdirSync(join(r, 'src', 'web', 'pages'), { recursive: true });
  writeFileSync(join(r, 'src', 'vault.ts'), 'coffre\n');
  writeFileSync(join(r, 'src', 'heimdall', 'policy.ts'), 'règles\n');
  writeFileSync(join(r, 'src', 'mimir', 'decisions.ts'), 'table\n');
  writeFileSync(join(r, 'src', 'core', 'agent.ts'), 'boucle\n');
  writeFileSync(join(r, 'src', 'web', 'pages', 'nous.js'), 'page\n');
  return r;
}

/** Le nom court 8.3 que le système a donné à un fichier, s'il en a donné un (sinon undefined). */
function nomCourt(dossier: string, nom: string): string | undefined {
  try {
    const sortie = execFileSync('cmd.exe', ['/d', '/c', 'dir', '/x', dossier], { encoding: 'latin1', windowsHide: true });
    for (const l of sortie.split(/\r?\n/)) { const m = l.match(/\s(\S+~\d+\.\S+)\s+(\S.*)$/); if (m && m[2].trim().toLowerCase() === nom.toLowerCase()) return m[1]; }
  } catch { /* pas de dir */ }
  return undefined;
}

function heimdall(validation: string) {
  const demandes: ApprovalRequest[] = [];
  const h = new Heimdall({ ...DEFAULT_CONFIG.policy, approvalTimeoutSec: 1 }, { approve: (r) => { demandes.push(r); return new Promise(() => { /* pas de réponse */ }); } });
  h.setAutonomy('breaker');
  h.setValidationCode(() => validation);
  return { h, demandes };
}
const appel = (cheminsCode: string[], extra: Partial<GateInput> = {}): GateInput => ({ tool: 'self_edit', risk: 'exec', summary: 'modifier mon code', sessionId: 's', tainted: false, cheminsCode, ...extra });

// Les détours vers le noyau, et le fichier qu'ils désignent.
const DETOURS_NOYAU: Array<[string, string]> = [
  ['src/vault.ts::$DATA', 'src/vault.ts'],
  ['src/heimdall:$I30:$INDEX_ALLOCATION/policy.ts', 'src/heimdall/policy.ts'],
  ['src::$INDEX_ALLOCATION/vault.ts', 'src/vault.ts'],
  ['SRC/Vault.TS::$data', 'src/vault.ts'],
  ['src/vault.ts.', 'src/vault.ts'],
  ['src/vault.ts  ', 'src/vault.ts'],
  ['src/vault.ts:autre', 'src/vault.ts'],
  ['src/mimir/decisions.ts. :$DATA', 'src/mimir/decisions.ts'],
];

test('Windows : un flux NTFS, un point ou une espace finale désignent le noyau → reconnus comme le noyau', { skip: !WIN && 'Windows seulement' }, () => {
  const r = fausseRacine();
  const manques: string[] = [];
  for (const [detour, vrai] of DETOURS_NOYAU) {
    const reel = enSlash(cheminVraiRelatif(detour, r))?.toLowerCase();
    if (reel !== vrai) manques.push(`cheminVraiRelatif(${JSON.stringify(detour)}) = ${JSON.stringify(reel)}`);
    if (!estNoyau(detour)) manques.push(`estNoyau(${JSON.stringify(detour)}) = false`);
    const g = graveNoyau(detour, r);
    if (g?.toLowerCase() !== `modifier un garde-fou d'odin : ${vrai}`) manques.push(`graveNoyau(${JSON.stringify(detour)}) = ${JSON.stringify(g)}`);
  }
  assert.deepEqual(manques, []);
  // cheminReelRelatif garde le nom écrit (le flux reste visible pour qui veut le refuser : les brouillons de code)
  assert.equal(enSlash(cheminReelRelatif('src/vault.ts::$DATA', r)), 'src/vault.ts::$DATA');
  // le code sensible aussi
  assert.ok(estSensible('src/core/agent.ts::$DATA')); assert.ok(estSensible('src/core/agent.ts.'));
  assert.equal(enSlash(cheminVraiRelatif('src/core:$I30:$INDEX_ALLOCATION/agent.ts', r)), 'src/core/agent.ts');
  // un fichier du noyau qui n'existe pas encore : son flux ou son point final le crée, c'est donc lui
  assert.ok(graveNoyau('src/heimdall/neuf.ts::$DATA', r)); assert.ok(estNoyau('src/brain/nous/modele-depart-epingle.json::$DATA'));
  assert.equal(enSlash(cheminVraiRelatif('src/brain/nous/modele-depart-epingle.json.', r)), 'src/brain/nous/modele-depart-epingle.json');
  // un caractère de contrôle : jamais le vrai nom d'un fichier → traité comme le noyau
  assert.ok(estNoyau('src/web/pages/nous.js\u0001')); assert.ok(graveNoyau('src/web/pages/nous.js\u0007', r));
});

test('Windows : la preuve du détour, dans un dossier temporaire — écrire dans « vault.ts::$DATA » réécrit bien vault.ts', { skip: !WIN && 'Windows seulement' }, () => {
  const r = fausseRacine();
  writeFileSync(join(r, 'src', 'vault.ts::$DATA'), 'réécrit\n');
  assert.equal(readFileSync(join(r, 'src', 'vault.ts'), 'utf8'), 'réécrit\n');
  writeFileSync(join(r, 'src', 'heimdall:$I30:$INDEX_ALLOCATION', 'policy.ts'), 'réécrite\n');
  assert.equal(readFileSync(join(r, 'src', 'heimdall', 'policy.ts'), 'utf8'), 'réécrite\n');
});

test('Windows : un nom court 8.3 réel est ramené au vrai nom', { skip: !WIN && 'Windows seulement' }, (t) => {
  const r = fausseRacine();
  const court = nomCourt(join(r, 'src', 'mimir'), 'decisions.ts');
  if (!court) { t.skip('le système ne crée pas de nom court sur ce disque'); return; }
  const detour = `src/mimir/${court}`;
  assert.ok(existsSync(join(r, detour)), `${detour} désigne bien decisions.ts`);
  assert.equal(enSlash(cheminVraiRelatif(detour, r)), 'src/mimir/decisions.ts');
  assert.match(graveNoyau(detour, r) ?? '', /^modifier un garde-fou d'Odin : src\/mimir\/decisions\.ts$/);
  assert.deepEqual(cheminsCodeDe('self_edit', { path: detour }, { workspace: tmpdir(), fullAccess: true }, r).map(enSlash), ['src/mimir/decisions.ts']);
});

test('Windows : la règle de réécriture — un détour vers le noyau demande la validation du noyau, même avec « jamais »', { skip: !WIN && 'Windows seulement' }, async () => {
  const r = fausseRacine();
  const ctx = { workspace: tmpdir(), fullAccess: true };
  const manques: string[] = [];
  for (const [detour, vrai] of DETOURS_NOYAU) {
    for (const outil of ['self_edit', 'fs_write', 'fs_edit']) {
      const chemin = outil === 'self_edit' ? detour : join(r, detour);
      const fichiers = cheminsCodeDe(outil, { path: chemin }, ctx, r);
      const { h, demandes } = heimdall('jamais');
      const d = await h.gate(appel(fichiers, { tool: outil }));
      const vu = `${outil} ${JSON.stringify(detour)} → ${JSON.stringify(fichiers.map(enSlash))}, permis=${d.allowed}, questions=${demandes.length}`;
      if (JSON.stringify(fichiers.map((x) => enSlash(x)?.toLowerCase())) !== JSON.stringify([vrai]) || d.allowed !== false || demandes.length !== 1
        || demandes[0].severity !== 'grave' || demandes[0].grantable !== false || !/modifier un garde-fou d'Odin : /.test(demandes[0].reason)) manques.push(vu);
    }
  }
  assert.deepEqual(manques, []);
  // le code sensible par un flux : sa validation, même avec « jamais »
  const { h, demandes } = heimdall('jamais');
  const f = cheminsCodeDe('fs_write', { path: join(r, 'src', 'core', 'agent.ts::$DATA') }, ctx, r);
  assert.equal((await h.gate(appel(f, { tool: 'fs_write' }))).allowed, false);
  assert.match(demandes[0].reason, /code sensible d'Odin/);
  // de bout en bout sur le vrai dossier d'Odin (rien n'est écrit : l'outil d'essai n'écrit pas)
  const v = heimdall('jamais');
  let lance = false;
  const outil = { name: 'fs_write', description: '', risk: 'write' as const, schema: { type: 'object', properties: {} }, async run() { lance = true; return 'écrit'; } };
  const res = await deciderPuisLancer(v.h, outil as never, { path: join(RACINE_APPLI, 'src', 'vault.ts::$DATA'), content: 'x' }, { ...ctx, sessionId: 's', channel: 'web', peer: 'p', isTainted: () => false } as never, { sessionId: 's', tainted: false });
  assert.equal(res.decision.allowed, false); assert.equal(lance, false); assert.equal(v.demandes.length, 1);
  assert.match(v.demandes[0].reason, /modifier un garde-fou d'Odin : src\/vault\.ts/);
});

/** Le chemin d'un dossier local par le partage d'administration de sa machine (« \\localhost\C$\… »), s'il répond. */
function parPartage(dossier: string, forme: 'unc' | 'unc-ip' | 'unc-long' | 'mup'): string | undefined {
  const B = '\\', lettre = dossier[0], reste = dossier.slice(2);
  const p = forme === 'unc' ? `${B}${B}localhost${B}${lettre}$${reste}` : forme === 'unc-ip' ? `${B}${B}127.0.0.1${B}${lettre}$${reste}`
    : forme === 'unc-long' ? `${B}${B}?${B}UNC${B}localhost${B}${lettre}$${reste}` : `${B}${B}?${B}GLOBALROOT${B}Device${B}Mup${B}localhost${B}${lettre}$${reste}`;
  return existsSync(p) ? p : undefined;
}

test('Windows : un partage vers la racine (\\\\localhost\\C$\\…, \\\\?\\UNC\\…, \\\\?\\GLOBALROOT\\Device\\Mup\\…) mène au noyau → reconnu comme le noyau', { skip: !WIN && 'Windows seulement' }, async (t) => {
  const r = fausseRacine();
  if (!/^[A-Za-z]:\\/.test(r) || !parPartage(r, 'unc')) { t.skip('pas de partage d\'administration sur cette machine'); return; }
  const ctx = { workspace: tmpdir(), fullAccess: true };
  const manques: string[] = [];
  const B = '\\';
  for (const forme of ['unc', 'unc-ip', 'unc-long', 'mup'] as const) {
    const base = parPartage(r, forme);
    if (!base) continue;
    for (const [suite, vrai] of [[`src${B}vault.ts`, 'src/vault.ts'], [`src${B}vault.ts::$DATA`, 'src/vault.ts'], [`SRC${B}heimdall:$I30:$INDEX_ALLOCATION${B}policy.ts`, 'src/heimdall/policy.ts'], [`src${B}heimdall${B}neuf.ts`, 'src/heimdall/neuf.ts']] as const) {
      const p = `${base}${B}${suite}`;
      const reel = enSlash(cheminVraiRelatif(p, r))?.toLowerCase();
      if (reel !== vrai) manques.push(`${forme} cheminVraiRelatif(${JSON.stringify(suite)}) = ${JSON.stringify(reel)}`);
      for (const outil of ['fs_write', 'fs_edit']) {
        const fichiers = cheminsCodeDe(outil, { path: p }, ctx, r);
        const { h, demandes } = heimdall('jamais');
        const d = await h.gate(appel(fichiers, { tool: outil }));
        if (d.allowed !== false || demandes.length !== 1 || demandes[0].severity !== 'grave' || !/modifier un garde-fou d'Odin : /.test(demandes[0].reason)) manques.push(`${forme} ${outil} ${JSON.stringify(suite)} → ${JSON.stringify(fichiers.map(enSlash))}, permis=${d.allowed}, questions=${demandes.length}`);
      }
    }
    // le code sensible par un partage : sa validation, même avec « jamais »
    const f = cheminsCodeDe('fs_write', { path: `${base}${B}src${B}core${B}agent.ts` }, ctx, r);
    if (JSON.stringify(f.map(enSlash)) !== '["src/core/agent.ts"]') manques.push(`${forme} sensible → ${JSON.stringify(f)}`);
  }
  assert.deepEqual(manques, []);
  // un nom court 8.3 derrière un partage : ramené lui aussi au vrai nom
  const court = nomCourt(join(r, 'src', 'mimir'), 'decisions.ts');
  if (court) assert.equal(enSlash(cheminVraiRelatif(`${parPartage(r, 'unc')}${B}src${B}mimir${B}${court}`, r)), 'src/mimir/decisions.ts');
  // la preuve, dans le dossier temporaire : écrire par le partage réécrit bien le faux coffre
  writeFileSync(`${parPartage(r, 'unc')}${B}src${B}vault.ts`, 'par le partage\n');
  assert.equal(readFileSync(join(r, 'src', 'vault.ts'), 'utf8'), 'par le partage\n');
  // ce qui ne change pas : un fichier hors de la racine, par le même partage, reste hors du code (aucune règle de code)
  const ailleurs = mkdtempSync(join(tmpdir(), 'hors-racine-')); dossiers.push(ailleurs);
  writeFileSync(join(ailleurs, 'note.txt'), 'x\n');
  assert.deepEqual(cheminsCodeDe('fs_write', { path: `${parPartage(ailleurs, 'unc')}${B}note.txt` }, ctx, r), []);
  assert.equal(cheminVraiRelatif(`${parPartage(ailleurs, 'unc')}${B}src${B}vault.ts`, r), undefined, 'un « src/vault.ts » ailleurs n\'est pas le noyau');
});

test('ce qui ne change pas : chemin normal hors noyau, réglage du propriétaire, membre refusé, détour après un contenu extérieur', async () => {
  const jamais = heimdall('jamais');
  assert.equal((await jamais.h.gate(appel(['src/web/pages/nous.js']))).allowed, true, '« jamais » : le code ordinaire sans question');
  assert.equal(jamais.demandes.length, 0);
  const chaque = heimdall('chaque-fois');
  assert.equal((await chaque.h.gate(appel(['src/web/pages/nous.js']))).allowed, false);
  assert.match(chaque.demandes[0].reason, /réécrire mon code \(src\/web\/pages\/nous\.js\)/, '« chaque-fois » : la question ordinaire, pas celle du noyau');
  const membre = heimdall('jamais');
  const m = await membre.h.gate(appel(['src/web/pages/nous.js'], { maxAutonomy: 'prudent' }));
  assert.equal(m.allowed, false); assert.match(String((m as { reason?: string }).reason), /seul le propriétaire/);
  if (WIN) {
    const r = fausseRacine();
    const f = cheminsCodeDe('self_edit', { path: 'src/vault.ts::$DATA' }, { workspace: tmpdir() }, r);
    const mm = await membre.h.gate(appel(f, { maxAutonomy: 'prudent' }));
    assert.equal(mm.allowed, false, 'un membre : refusé aussi par le détour');
    const ext = heimdall('jamais');
    const t = await ext.h.gate(appel(f, { tainted: true }));
    assert.equal(t.allowed, false); assert.equal(ext.demandes.length, 0, 'le noyau après un contenu extérieur : refus sans même demander');
    // un nom ordinaire reste ordinaire (pas de « : », pas de point final) et garde sa règle
    assert.deepEqual(cheminsCodeDe('self_edit', { path: 'src/web/pages/nous.js' }, { workspace: tmpdir() }, r).map(enSlash), ['src/web/pages/nous.js']);
  }
});

test('Linux et macOS : rien ne change (les deux-points, le point et l\'espace finale y sont des caractères de nom)', () => {
  const vu = (noyau as Record<string, unknown>).nomVuParWindows as ((c: string, p?: string) => string) | undefined;
  assert.equal(typeof vu, 'function', 'la règle des noms Windows est une fonction pure, testable sur chaque système');
  for (const p of ['linux', 'darwin'] as const) {
    for (const c of ['src/vault.ts::$DATA', 'src/heimdall:$I30:$INDEX_ALLOCATION/policy.ts', 'src/vault.ts.', 'src/vault.ts  ', 'src/x\u0001.ts']) assert.equal(vu!(c, p), c, `${p} : ${JSON.stringify(c)} inchangé`);
  }
  assert.equal(vu!('src/vault.ts::$DATA', 'win32'), 'src/vault.ts');
  assert.equal(vu!('src\\heimdall:$I30:$INDEX_ALLOCATION\\policy.ts. ', 'win32'), 'src\\heimdall\\policy.ts');
  assert.equal(vu!('C:\\odin\\src\\vault.ts::$DATA', 'win32'), 'C:\\odin\\src\\vault.ts', 'la lettre du lecteur est gardée');
  assert.equal(vu!('src/../vault.ts', 'win32'), 'src/../vault.ts', '« . » et « .. » ne sont pas touchés');
  if (!WIN) {
    // sur ce système, ces noms sont d'autres fichiers : pas le noyau
    assert.ok(!estNoyau('src/vault.ts::$DATA')); assert.ok(!estNoyau('src/vault.ts.'));
  }
});
