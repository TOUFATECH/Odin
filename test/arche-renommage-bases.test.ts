// Le nom repris du 23/11 (« Arche » passe de la sauvegarde des bases — skuld, désormais « Amphore » — aux conteneurs —
// naglfar, avant « Argo ») : ce qui tourne sur l'Odin du propriétaire, prouvé sur des copies FABRIQUÉES.
//
// AUCUN vrai serveur PostgreSQL : le client est simulé au niveau des requêtes (ce que la base d'Odin envoie : existence
// des bases et des comptes, ALTER DATABASE … RENAME, ALTER ROLE … RENAME / PASSWORD, CREATE …). Le faux serveur se
// comporte comme PostgreSQL pour ces requêtes (renommer vers un nom pris : refusé ; base absente : refusé). Ce qui n'est
// donc PAS prouvé ici : les verrous et les connexions ouvertes d'un vrai serveur (pg_terminate_backend), et la casse
// réelle des noms côté serveur.
//
// (a) les bases : rien perdu, rien mélangé, dans tous les ordres (ARCHE_ODIN et ARGO_ODIN ; une seule ; AMPHORE_ODIN déjà
//     là ; coupure au milieu ; redémarrage qui refait ; noms-bases.json perdu) ; les sauvegardes chiffrées suivent le nom ;
// (b) les fiches du Cerveau : « Mes notes » gardées, liens suivis, rien écrasé, refaire ne change rien, une fiche écrite à
//     la main n'est jamais déplacée ;
// (c) ce qui garde un identifiant (et pas un nom) : activation, épingles, réglages, journaux, liste d'Alexandrie ;
// (d) la parole : « Arche » → conteneurs, « Amphore » → sauvegarde des bases, « Argo » → toujours les conteneurs.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BaseOdin, garderNom, nomsGardes, idAlexandrie } from '../src/valhalla/base/index.ts';
import { dossierSauvegardes, sauvegardes } from '../src/valhalla/base/sauvegarde.ts';
import { bases, password, saveBases, setPassword } from '../src/valhalla/urdr/bases.ts';
import { dossierJournaux } from '../src/valhalla/base/journal.ts';
import { proprietaireJournal } from '../src/valhalla/base/noms.ts';
import { Vault } from '../src/brain/vault.ts';
import { syncSheets } from '../src/valhalla/fiches.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { findApp } from '../src/valhalla/directports.ts';
import { understand } from '../src/valhalla/huginn.ts';

const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

// ---------------------------------------------------------------------------------------------------------------
// Un faux serveur PostgreSQL, au niveau des requêtes.
// ---------------------------------------------------------------------------------------------------------------
interface Serveur { bases: Map<string, string>; comptes: Map<string, string>; log: string[]; panne?: (sql: string) => boolean }
function serveur(b: Record<string, string>, c: Record<string, string>): Serveur { return { bases: new Map(Object.entries(b)), comptes: new Map(Object.entries(c)), log: [] }; }
const un = (s: string) => s.replace(/""/g, '"');
function connexion(sv: Serveur) {
  return {
    async query(sql: string, p: Array<string | number | boolean | null> = []) {
      if (/FROM pg_database WHERE datname = \$1/.test(sql)) return { rows: sv.bases.has(String(p[0])) ? [['1']] : [] };
      if (/FROM pg_roles WHERE rolname = \$1/.test(sql)) return { rows: sv.comptes.has(String(p[0])) ? [['1']] : [] };
      if (/pg_terminate_backend/.test(sql)) return { rows: [] };
      const f = /SELECT format\('(ALTER|CREATE) ROLE %I LOGIN PASSWORD %L'/.exec(sql);
      if (f) return { rows: [[`${f[1]} ROLE "${String(p[0])}" LOGIN PASSWORD '${String(p[1]).replace(/'/g, "''")}'`]] };
      throw new Error(`requête inattendue : ${sql}`);
    },
    async simple(sql: string) {
      if (sv.panne?.(sql)) throw new Error(`coupure (essai) : ${sql}`);
      let m: RegExpExecArray | null;
      if ((m = /^ALTER DATABASE "((?:[^"]|"")+)" RENAME TO "((?:[^"]|"")+)"$/.exec(sql))) {
        const [a, n] = [un(m[1]), un(m[2])];
        if (!sv.bases.has(a)) throw Object.assign(new Error(`database "${a}" does not exist`), { code: '3D000' });
        if (sv.bases.has(n)) throw Object.assign(new Error(`database "${n}" already exists`), { code: '42P04' });
        sv.bases.set(n, sv.bases.get(a)!); sv.bases.delete(a); sv.log.push(`base ${a} → ${n}`); return;
      }
      if ((m = /^ALTER DATABASE "((?:[^"]|"")+)" ALLOW_CONNECTIONS (true|false)$/.exec(sql))) { if (!sv.bases.has(un(m[1]))) throw new Error(`database "${un(m[1])}" does not exist`); return; }
      if ((m = /^ALTER ROLE "((?:[^"]|"")+)" RENAME TO "((?:[^"]|"")+)"$/.exec(sql))) {
        const [a, n] = [un(m[1]), un(m[2])];
        if (!sv.comptes.has(a)) throw new Error(`role "${a}" does not exist`);
        if (sv.comptes.has(n)) throw new Error(`role "${n}" already exists`);
        sv.comptes.set(n, ''); sv.comptes.delete(a); sv.log.push(`compte ${a} → ${n}`); return; // MD5 : le mot de passe est perdu au renommage
      }
      if ((m = /^ALTER ROLE "((?:[^"]|"")+)" PASSWORD '((?:[^']|'')*)'$/.exec(sql)) || (m = /^ALTER ROLE "((?:[^"]|"")+)" LOGIN PASSWORD '((?:[^']|'')*)'$/.exec(sql))) {
        if (!sv.comptes.has(un(m[1]))) throw new Error(`role "${un(m[1])}" does not exist`);
        sv.comptes.set(un(m[1]), m[2].replace(/''/g, "'")); sv.log.push(`mot de passe ${un(m[1])}`); return;
      }
      if ((m = /^CREATE ROLE "((?:[^"]|"")+)" LOGIN PASSWORD '((?:[^']|'')*)'$/.exec(sql))) {
        if (sv.comptes.has(un(m[1]))) throw new Error(`role "${un(m[1])}" already exists`);
        sv.comptes.set(un(m[1]), m[2].replace(/''/g, "'")); sv.log.push(`compte créé ${un(m[1])}`); return;
      }
      if ((m = /^CREATE DATABASE "((?:[^"]|"")+)" OWNER /.exec(sql))) {
        if (sv.bases.has(un(m[1]))) throw new Error(`database "${un(m[1])}" already exists`);
        sv.bases.set(un(m[1]), '(vide)'); sv.log.push(`base créée ${un(m[1])}`); return;
      }
      if (/^(GRANT|REVOKE) /.test(sql)) return;
      throw new Error(`commande inattendue : ${sql}`);
    },
  };
}
/** Une base d'Odin branchée sur le faux serveur (sans démarrage : directement « prête »). */
function baseSur(home: string, sv: Serveur): BaseOdin {
  const b = new BaseOdin(home, { log: () => {} });
  const reserve = { avec: async <T>(f: (c: ReturnType<typeof connexion>) => Promise<T>) => f(connexion(sv)), fermer: async () => {} };
  Object.assign(b as unknown as Record<string, unknown>, { cible: { mode: 'machine', hote: '127.0.0.1', port: 5432, admin: 'postgres' }, admin: reserve, etat: 'prete' });
  return b;
}
/** L'Odin d'avant le 23/11 : la base de la sauvegarde des bases (skuld) s'appelle ARCHE_ODIN ; celle des conteneurs (naglfar), si elle existe, ARGO_ODIN. */
function odinDAvant(o: { arche?: boolean; argo?: boolean; amphore?: boolean; gardes?: boolean } = {}) {
  const home = neuf('arche-noms-');
  const b: Record<string, string> = {}, c: Record<string, string> = {};
  if (o.arche !== false) { b.ARCHE_ODIN = 'données de la sauvegarde des bases (skuld)'; c.ARCHE_ODIN = 'mdp-skuld'; setPassword(home, 'base-skuld', 'mdp-skuld'); if (o.gardes !== false) garderNom(home, 'skuld', { nom: 'ARCHE_ODIN', depuis: '2026-11-01T00:00:00.000Z' }); }
  if (o.argo) { b.ARGO_ODIN = 'données des conteneurs (naglfar)'; c.ARGO_ODIN = 'mdp-naglfar'; setPassword(home, 'base-naglfar', 'mdp-naglfar'); if (o.gardes !== false) garderNom(home, 'naglfar', { nom: 'ARGO_ODIN', depuis: '2026-11-01T00:00:00.000Z' }); }
  if (o.amphore) { b.AMPHORE_ODIN = 'une autre base, déjà là'; c.AMPHORE_ODIN = 'mdp-autre'; }
  return { home, sv: serveur(b, c) };
}
const contenu = (sv: Serveur) => Object.fromEntries([...sv.bases.entries()].sort());
/** Chaque appli entre dans SA base avec SON mot de passe (celui qu'Odin garde est celui du compte). */
function entre(home: string, sv: Serveur, appli: string, base: string) {
  assert.equal(nomsGardes(home)[appli]?.nom, base, `${appli} : nom gardé`);
  assert.ok(sv.comptes.has(base), `${appli} : le compte ${base} existe`);
  assert.equal(sv.comptes.get(base), password(home, `base-${appli}`), `${appli} : son mot de passe est celui de son compte`);
  assert.equal(bases(home).find((x) => x.id === idAlexandrie(appli))?.base, base, `${appli} : Alexandrie la montre sous ${base}`);
}
const ORDRES: Array<[string, (b: BaseOdin) => Promise<unknown>]> = [
  ['skuld puis naglfar', async (b) => { await b.baseDe('skuld'); await b.baseDe('naglfar'); }],
  ['naglfar puis skuld', async (b) => { await b.baseDe('naglfar'); await b.baseDe('skuld'); }],
  ['les deux en même temps', (b) => Promise.all([b.baseDe('naglfar'), b.baseDe('skuld')])],
  ['les deux en même temps (autre sens)', (b) => Promise.all([b.baseDe('skuld'), b.baseDe('naglfar')])],
];

test('(a) ARCHE_ODIN et ARGO_ODIN existent : dans tous les ordres, chaque base garde ses données sous son nouveau nom ; refaire ne change rien', async () => {
  for (const [ordre, faire] of ORDRES) {
    const { home, sv } = odinDAvant({ argo: true });
    await faire(baseSur(home, sv));
    assert.deepEqual(contenu(sv), { AMPHORE_ODIN: 'données de la sauvegarde des bases (skuld)', ARCHE_ODIN: 'données des conteneurs (naglfar)' }, ordre);
    entre(home, sv, 'skuld', 'AMPHORE_ODIN'); entre(home, sv, 'naglfar', 'ARCHE_ODIN');
    // Redémarrage : refait, rien ne bouge.
    sv.log.length = 0; const b2 = baseSur(home, sv); await faire(b2);
    assert.deepEqual(sv.log, [], `${ordre} : refaire ne change rien`);
    assert.deepEqual(contenu(sv), { AMPHORE_ODIN: 'données de la sauvegarde des bases (skuld)', ARCHE_ODIN: 'données des conteneurs (naglfar)' });
  }
});

test('(a) seulement ARCHE_ODIN (le cas de l\'Odin du propriétaire : les conteneurs n\'ont pas de base) : elle devient AMPHORE_ODIN ; une base des conteneurs, si elle vient, est neuve', async () => {
  for (const [ordre, faire] of ORDRES) {
    const { home, sv } = odinDAvant();
    await faire(baseSur(home, sv));
    assert.deepEqual(contenu(sv), { AMPHORE_ODIN: 'données de la sauvegarde des bases (skuld)', ARCHE_ODIN: '(vide)' }, ordre);
    entre(home, sv, 'skuld', 'AMPHORE_ODIN'); entre(home, sv, 'naglfar', 'ARCHE_ODIN');
  }
  // Seule la sauvegarde des bases démarre (les conteneurs n'ont pas de base) : rien d'autre n'est créé.
  const { home, sv } = odinDAvant();
  await baseSur(home, sv).baseDe('skuld');
  assert.deepEqual(contenu(sv), { AMPHORE_ODIN: 'données de la sauvegarde des bases (skuld)' });
  entre(home, sv, 'skuld', 'AMPHORE_ODIN');
});

test('(a) seulement ARGO_ODIN : elle devient ARCHE_ODIN ; la sauvegarde des bases reçoit une AMPHORE_ODIN neuve', async () => {
  for (const [ordre, faire] of ORDRES) {
    const { home, sv } = odinDAvant({ arche: false, argo: true });
    await faire(baseSur(home, sv));
    assert.deepEqual(contenu(sv), { AMPHORE_ODIN: '(vide)', ARCHE_ODIN: 'données des conteneurs (naglfar)' }, ordre);
    entre(home, sv, 'skuld', 'AMPHORE_ODIN'); entre(home, sv, 'naglfar', 'ARCHE_ODIN');
  }
});

test('(a) AMPHORE_ODIN existe déjà à côté d\'ARCHE_ODIN : rien n\'est touché (ni renommé, ni repris, ni mot de passe changé), dans tous les ordres', async () => {
  for (const [ordre, faire] of ORDRES) {
    const { home, sv } = odinDAvant({ argo: true, amphore: true });
    const avant = contenu(sv), comptes = Object.fromEntries(sv.comptes);
    await assert.rejects(faire(baseSur(home, sv)), /existent toutes les deux|rien n'est touché/, ordre);
    assert.deepEqual(contenu(sv), avant, `${ordre} : aucune base touchée`);
    assert.deepEqual(Object.fromEntries(sv.comptes), comptes, `${ordre} : aucun compte touché`);
    assert.equal(nomsGardes(home).skuld.nom, 'ARCHE_ODIN'); assert.equal(nomsGardes(home).naglfar.nom, 'ARGO_ODIN');
  }
});

test('(a) coupure au milieu (après chaque commande possible) puis redémarrage : tout finit à sa place, rien perdu ni mélangé', async () => {
  // Compter les commandes d'une migration complète, puis couper après la 1re, la 2e… et relancer.
  const ref = odinDAvant({ argo: true }); let total = 0;
  ref.sv.panne = () => { total++; return false; }; await ORDRES[1][1](baseSur(ref.home, ref.sv));
  assert.ok(total > 6);
  for (const [ordre, faire] of ORDRES) for (let k = 1; k <= total; k++) {
    const { home, sv } = odinDAvant({ argo: true }); let n = 0;
    sv.panne = () => ++n === k;
    await faire(baseSur(home, sv)).catch(() => undefined);
    sv.panne = undefined;
    await faire(baseSur(home, sv));
    assert.deepEqual(contenu(sv), { AMPHORE_ODIN: 'données de la sauvegarde des bases (skuld)', ARCHE_ODIN: 'données des conteneurs (naglfar)' }, `${ordre}, coupure à la commande ${k}`);
    entre(home, sv, 'skuld', 'AMPHORE_ODIN'); entre(home, sv, 'naglfar', 'ARCHE_ODIN');
  }
});

test('(a) noms-bases.json perdu : la base ARCHE_ODIN (sauvegarde des bases) n\'est jamais reprise par les conteneurs', async () => {
  for (const [ordre, faire] of ORDRES) {
    const { home, sv } = odinDAvant({ gardes: false });
    await faire(baseSur(home, sv)).catch(() => undefined);
    assert.equal(sv.bases.get('AMPHORE_ODIN'), 'données de la sauvegarde des bases (skuld)', `${ordre} : la sauvegarde des bases garde ses données`);
    assert.notEqual(sv.bases.get('ARCHE_ODIN'), 'données de la sauvegarde des bases (skuld)', `${ordre} : les conteneurs n'ont pas pris sa base`);
    entre(home, sv, 'skuld', 'AMPHORE_ODIN');
  }
  // Les conteneurs seuls (la sauvegarde des bases éteinte) : la base qui porte l'ancien nom de l'autre appli n'est pas prise.
  const { home, sv } = odinDAvant({ gardes: false });
  await baseSur(home, sv).baseDe('naglfar');
  assert.deepEqual(contenu(sv), { AMPHORE_ODIN: 'données de la sauvegarde des bases (skuld)', ARCHE_ODIN: '(vide)' }, 'jamais reprise par les conteneurs : elle est passée chez la sauvegarde des bases d\'abord');
  assert.equal(sv.comptes.get('AMPHORE_ODIN'), 'mdp-skuld', 'son compte garde le mot de passe de la sauvegarde des bases (pas celui des conteneurs)');
  entre(home, sv, 'skuld', 'AMPHORE_ODIN'); entre(home, sv, 'naglfar', 'ARCHE_ODIN');
  // Les deux fichiers de noms perdus APRÈS une migration finie (noms-bases.json ET la liste d'Alexandrie) : rien n'est
  // touché, les deux applis refusent (aucune donnée déplacée ni mélangée) plutôt que de deviner.
  const fini = odinDAvant({ argo: true }); await ORDRES[0][1](baseSur(fini.home, fini.sv));
  rmSync(join(fini.home, 'valhalla', 'urdr', 'noms-bases.json')); saveBases(fini.home, []);
  const avant = contenu(fini.sv);
  for (const [, faire] of ORDRES) await faire(baseSur(fini.home, fini.sv)).catch(() => undefined);
  assert.deepEqual(contenu(fini.sv), avant, 'tout perdu sur le disque : aucune base déplacée');
  // Seulement noms-bases.json perdu (la liste d'Alexandrie dit qui est qui) : chacun retrouve la sienne.
  const moitie = odinDAvant({ argo: true }); await ORDRES[0][1](baseSur(moitie.home, moitie.sv));
  rmSync(join(moitie.home, 'valhalla', 'urdr', 'noms-bases.json'));
  for (const [ordre, faire] of ORDRES) {
    await faire(baseSur(moitie.home, moitie.sv));
    assert.deepEqual(contenu(moitie.sv), { AMPHORE_ODIN: 'données de la sauvegarde des bases (skuld)', ARCHE_ODIN: 'données des conteneurs (naglfar)' }, ordre);
    entre(moitie.home, moitie.sv, 'skuld', 'AMPHORE_ODIN'); entre(moitie.home, moitie.sv, 'naglfar', 'ARCHE_ODIN');
  }
});

test('(a) les sauvegardes chiffrées de la base d\'Odin suivent le nouveau nom (une sauvegarde ARCHE_ODIN-… n\'est jamais prise pour celle des conteneurs)', async () => {
  const { home, sv } = odinDAvant({ argo: true });
  const d = dossierSauvegardes(home); mkdirSync(d, { recursive: true });
  for (const f of ['ARCHE_ODIN-20261120-020000.dump.odinbk', 'ARCHE_ODIN-20261121-020000.dump.odinbk', 'ARGO_ODIN-20261121-020000.dump.odinbk', 'PEGASE_ODIN-20261121-020000.dump.odinbk']) writeFileSync(join(d, f), f);
  await ORDRES[1][1](baseSur(home, sv));
  const parBase = (b: string) => sauvegardes(home).filter((x) => x.base === b).map((x) => x.date).sort();
  assert.deepEqual(parBase('AMPHORE_ODIN'), ['2026-11-20T02:00:00Z', '2026-11-21T02:00:00Z'], 'celles de la sauvegarde des bases');
  assert.deepEqual(parBase('ARCHE_ODIN'), ['2026-11-21T02:00:00Z'], 'celle des conteneurs (ancienne ARGO_ODIN)');
  assert.deepEqual(parBase('PEGASE_ODIN'), ['2026-11-21T02:00:00Z'], 'les autres ne bougent pas');
  const lire = (f: string) => readdirSync(d).includes(f);
  assert.ok(lire('AMPHORE_ODIN-20261120-020000.dump.odinbk'));
  // Refaire ne change rien, et un fichier déjà là n'est jamais écrasé.
  writeFileSync(join(d, 'ARGO_ODIN-20261121-020000.dump.odinbk'), 'copie tardive');
  await ORDRES[1][1](baseSur(home, sv));
  assert.ok(existsSync(join(d, 'ARGO_ODIN-20261121-020000.dump.odinbk')), 'un nom déjà pris : le fichier reste où il est');
});

// ---------------------------------------------------------------------------------------------------------------
// (b) les fiches du Cerveau
// ---------------------------------------------------------------------------------------------------------------
function valhalla(home: string) {
  return new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('hors ligne'); }) as never, notify: async () => {} });
}
const fiche = (titre: string, famille: string, note: string): [Record<string, string | string[]>, string] => [{ type: 'fiche', tags: ['odin', 'appli', famille], 'tenue par': 'Odin' }, `# ${titre}\n\nancien texte généré\n\n## Mes notes\n\n${note}\n`];

test('(b) fiches du Cerveau : notes gardées, liens suivis, rien écrasé ; refaire ne change rien ; ordre des fiches indifférent', () => {
  const home = neuf('arche-fiches-'), v = valhalla(home);
  try {
    const mods = v.modules();
    const vault = new Vault(join(home, 'cerveau'));
    vault.write('Odin/Applis/Arche', ...fiche('Arche', 'données', 'MA NOTE SAUVEGARDES'));
    vault.write('Odin/Applis/Argo', ...fiche('Argo', 'machines', 'MA NOTE CONTENEURS'));
    vault.write('Journal/2026-11-20', { type: 'note' }, 'Voir [[Arche]], [[Arche#Mes notes]], [[Arche|la sauvegarde]], [[Argo]] et [[Argos]].');
    syncSheets(vault, mods);
    const amphore = vault.read('Odin/Applis/Amphore')!, arche = vault.read('Odin/Applis/Arche')!;
    assert.match(amphore.body, /## Mes notes\s+MA NOTE SAUVEGARDES/); assert.doesNotMatch(amphore.body, /MA NOTE CONTENEURS/);
    assert.match(arche.body, /## Mes notes\s+MA NOTE CONTENEURS/); assert.doesNotMatch(arche.body, /MA NOTE SAUVEGARDES/);
    assert.equal(vault.read('Odin/Applis/Argo'), undefined);
    assert.equal(vault.read('Journal/2026-11-20')!.body.trim(), 'Voir [[Amphore]], [[Amphore#Mes notes]], [[Amphore|la sauvegarde]], [[Arche]] et [[Argos]].');
    const photo = JSON.stringify(vault.all(true).map((n) => [n.path, vault.read(n.path)!.body]).sort());
    syncSheets(vault, mods); syncSheets(vault, mods);
    assert.equal(JSON.stringify(vault.all(true).map((n) => [n.path, vault.read(n.path)!.body]).sort()), photo, 'refaire ne change rien');
  } finally { v.stop(); }
});

test('(b) une fiche « Arche » écrite à la main par le propriétaire n\'est jamais déplacée ni écrasée ; la fiche Argo reste alors où elle est, avec ses notes', () => {
  const home = neuf('arche-fiches-main-'), v = valhalla(home);
  try {
    const mods = v.modules(), vault = new Vault(join(home, 'cerveau'));
    vault.write('Odin/Applis/Arche', { type: 'note' }, '# Arche\n\nMA PROPRE NOTE, écrite à la main.\n');
    vault.write('Odin/Applis/Argo', ...fiche('Argo', 'machines', 'MA NOTE CONTENEURS'));
    syncSheets(vault, mods);
    assert.equal(vault.read('Odin/Applis/Arche')!.body, '# Arche\n\nMA PROPRE NOTE, écrite à la main.\n');
    assert.match(vault.read('Odin/Applis/Argo')!.body, /MA NOTE CONTENEURS/, 'pas de perte : la fiche des conteneurs reste sous son ancien nom');
    assert.ok(vault.read('Odin/Applis/Amphore'), 'la fiche d\'Amphore est écrite à neuf');
  } finally { v.stop(); }
});

test('(b) un Cerveau à moitié passé (coupure entre les deux déplacements) : la suite se fait au redémarrage', () => {
  const home = neuf('arche-fiches-moitie-'), v = valhalla(home);
  try {
    const mods = v.modules(), vault = new Vault(join(home, 'cerveau'));
    vault.write('Odin/Applis/Amphore', ...fiche('Arche', 'données', 'MA NOTE SAUVEGARDES'));
    vault.write('Odin/Applis/Argo', ...fiche('Argo', 'machines', 'MA NOTE CONTENEURS'));
    syncSheets(vault, mods);
    assert.match(vault.read('Odin/Applis/Arche')!.body, /MA NOTE CONTENEURS/); assert.match(vault.read('Odin/Applis/Amphore')!.body, /MA NOTE SAUVEGARDES/);
  } finally { v.stop(); }
});

// ---------------------------------------------------------------------------------------------------------------
// (c) ce qui garde un identifiant, pas un nom
// ---------------------------------------------------------------------------------------------------------------
test('(c) activation, journaux, liste d\'Alexandrie : rangés par identifiant (skuld, naglfar), le nouveau nom ne les déplace pas', () => {
  assert.equal(proprietaireJournal('arche'), 'skuld', 'le journal « arche » (historique des sauvegardes) reste celui de la sauvegarde des bases');
  assert.match(dossierJournaux('/h', 'skuld').replace(/\\/g, '/'), /journaux\/skuld$/);
  assert.equal(idAlexandrie('skuld'), 'odin-skuld'); assert.equal(idAlexandrie('naglfar'), 'odin-naglfar');
  // Une liste d'Alexandrie d'avant : l'entrée de la sauvegarde des bases (odin-skuld) passe sur AMPHORE_ODIN, rien d'autre.
  const { home, sv } = odinDAvant();
  saveBases(home, [{ id: 'odin-skuld', nom: 'ARCHE_ODIN', type: 'postgres', hote: '127.0.0.1', port: 5432, utilisateur: 'odin_lecture', base: 'ARCHE_ODIN', ssl: 'non', version: undefined, ajoutee: '2026-11-01T00:00:00.000Z' }]);
  return baseSur(home, sv).baseDe('skuld').then(() => {
    assert.deepEqual(bases(home).map((b) => [b.id, b.base, b.ajoutee]), [['odin-skuld', 'AMPHORE_ODIN', '2026-11-01T00:00:00.000Z']]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// (d) la parole
// ---------------------------------------------------------------------------------------------------------------
test('(d) parole : « Arche » → conteneurs, « Amphore » → sauvegarde des bases ; « Argo » (l\'ancien nom) : conteneurs dans les ports directs, et jamais un geste dans la parole', async () => {
  const home = neuf('arche-parole-'), v = valhalla(home);
  try {
    const mods = v.modules();
    assert.equal(findApp(mods, 'Arche').id, 'naglfar'); assert.equal(findApp(mods, 'Amphore').id, 'skuld');
    assert.equal(findApp(mods, 'Argo').id, 'naglfar', 'l\'ancien nom des conteneurs mène aux conteneurs (avant : Argos, par le début du nom)');
    assert.equal(findApp(mods, 'Argos').id, 'argos');
    const vu = async (p: string) => { const u = await understand(v, p, `parole-${Math.random()}`) as { kind?: string; module?: string; action?: string } | undefined; return u?.kind === 'action' ? `${u.module}.${u.action}` : u?.kind ?? 'rien'; };
    assert.match(await vu('Arche'), /^naglfar\./); assert.match(await vu('ouvre Amphore'), /^skuld\./);
    // « Argo » et « Argos » ont la même racine pour Soul (le « s » final est retiré) : c'était déjà le cas avant le 23/11.
    // Le plus sûr (« Argo » est aussi un film, pour Vénus) : ne rien forcer, mais vérifier que l'ancien nom ne déclenche
    // jamais un geste — au pire une lecture.
    for (const p of ['Argo', 'ouvre Argo', 'lance Argo', 'arrête Argo', 'supprime Argo', 'mets à jour Argo', 'redémarre web dans Argo']) {
      const r = await vu(p); if (!r.includes('.')) continue;
      const [m, a] = r.split('.'); assert.equal(v.action(m, a)?.a.read, true, `« ${p} » → ${r} : une lecture seulement`);
    }
    assert.match(await vu('joue le film Argo'), /^freyja\.regarder/, 'le film reste un film');
  } finally { v.stop(); }
});

test('(b) une note à toi qui s\'appelle aussi « Arche » (ailleurs dans le Cerveau) : ses liens [[Arche]] ne sont jamais redirigés, aucune fiche n\'est mélangée', () => {
  const home = neuf('arche-fiches-homonyme-'), v = valhalla(home);
  try {
    const mods = v.modules(), vault = new Vault(join(home, 'cerveau'));
    vault.write('Projets/Arche', { type: 'note' }, '# Arche\n\nMON PROJET ARCHE (rien à voir avec Odin).\n');
    vault.write('Journal/2026-11-21', { type: 'note' }, 'Avancer sur [[Arche]].');
    vault.write('Odin/Applis/Arche', ...fiche('Arche', 'données', 'MA NOTE SAUVEGARDES'));
    vault.write('Odin/Applis/Argo', ...fiche('Argo', 'machines', 'MA NOTE CONTENEURS'));
    syncSheets(vault, mods); syncSheets(vault, mods);
    assert.equal(vault.read('Journal/2026-11-21')!.body.trim(), 'Avancer sur [[Arche]].', 'le lien vers ton projet n\'est pas redirigé');
    assert.match(vault.read('Projets/Arche')!.body, /MON PROJET ARCHE/);
    // Aucune fiche ne porte les notes d'une autre appli.
    for (const n of vault.all(true).filter((x) => x.path.startsWith('Odin/Applis/'))) {
      const b = vault.read(n.path.replace(/\.md$/, ''))!.body;
      assert.ok(!(/MA NOTE SAUVEGARDES/.test(b) && /MA NOTE CONTENEURS/.test(b)), n.path);
      if (/MA NOTE SAUVEGARDES/.test(b)) assert.doesNotMatch(b, /^# Arche\n\n> Tes conteneurs/m, `${n.path} : les notes des sauvegardes sous la fiche des conteneurs`);
      if (/MA NOTE CONTENEURS/.test(b)) assert.doesNotMatch(b, /Famille : \*\*Données\*\*/, `${n.path} : les notes des conteneurs sous la fiche d'Amphore`);
    }
    assert.ok(vault.all(true).some((n) => /MA NOTE SAUVEGARDES/.test(vault.read(n.path.replace(/\.md$/, ''))!.body)), 'notes des sauvegardes gardées');
    assert.ok(vault.all(true).some((n) => /MA NOTE CONTENEURS/.test(vault.read(n.path.replace(/\.md$/, ''))!.body)), 'notes des conteneurs gardées');
  } finally { v.stop(); }
});

test('(b) « Amphore » existe déjà (note à toi) : la fiche « Arche » des sauvegardes n\'est jamais réécrite en fiche des conteneurs avec tes notes dedans', () => {
  const home = neuf('arche-fiches-amphore-'), v = valhalla(home);
  try {
    const mods = v.modules(), vault = new Vault(join(home, 'cerveau'));
    vault.write('Odin/Applis/Amphore', { type: 'note' }, '# Amphore\n\nMA NOTE SUR LES AMPHORES.\n');
    vault.write('Odin/Applis/Arche', ...fiche('Arche', 'données', 'MA NOTE SAUVEGARDES'));
    syncSheets(vault, mods); syncSheets(vault, mods);
    assert.equal(vault.read('Odin/Applis/Amphore')!.body, '# Amphore\n\nMA NOTE SUR LES AMPHORES.\n');
    const arche = vault.read('Odin/Applis/Arche')!.body;
    assert.ok(!(/MA NOTE SAUVEGARDES/.test(arche) && /Famille : \*\*Machines\*\*/.test(arche)), 'les notes des sauvegardes ne passent pas sous la fiche des conteneurs');
    assert.match(arche, /MA NOTE SAUVEGARDES/, 'rien perdu');
  } finally { v.stop(); }
});

test('(b) pas de fiche « Argo » (seulement la fiche « Arche » des sauvegardes) : la nouvelle fiche des conteneurs ne reprend jamais les notes des sauvegardes', () => {
  const home = neuf('arche-fiches-sans-argo-'), v = valhalla(home);
  try {
    const mods = v.modules(), vault = new Vault(join(home, 'cerveau'));
    vault.write('Odin/Applis/Arche', ...fiche('Arche', 'données', 'MA NOTE SAUVEGARDES'));
    syncSheets(vault, mods);
    assert.match(vault.read('Odin/Applis/Amphore')!.body, /MA NOTE SAUVEGARDES/);
    assert.doesNotMatch(vault.read('Odin/Applis/Arche')!.body, /MA NOTE SAUVEGARDES/, 'les notes des sauvegardes ne sont pas recopiées sous la fiche des conteneurs');
  } finally { v.stop(); }
});
