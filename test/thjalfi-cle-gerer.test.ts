// Genèse · Clés USB, lot C5 « Mes clés » (côté serveur). Ces essais n'écrivent QUE dans des dossiers temporaires (un
// « faux disque » : le dossier joue la partition ODIN) ou en mémoire ; la liste des disques est fausse ; aucune commande du
// système n'est lancée (ctx.run compte ses appels : il doit rester à zéro). Jamais un vrai disque lu, écrit ou formaté.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import * as G from '../src/valhalla/thjalfi/cle-gerer.ts';
import * as E from '../src/valhalla/thjalfi/cle-ecrire.ts';
import { nomBase } from '../src/valhalla/base/noms.ts';
import type { Disque } from '../src/valhalla/thjalfi/disques.ts';
import type { Recipe } from '../src/valhalla/thjalfi/recipes.ts';
import type { ModCtx } from '../src/valhalla/types.ts';

const Go = 1024 ** 3;
const dossiers: string[] = [];
const neuf = (n: string) => { const d = mkdtempSync(join(tmpdir(), `odin-c5-${n}-`)); dossiers.push(d); return d; };
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

const rUbuntu: Recipe = { kind: 'ubuntu', label: 'Ubuntu', auto: true, os: 'linux' };
const rLive: Recipe = { kind: 'casper', label: 'Ubuntu live', auto: false, os: 'linux' };
const rWin: Recipe = { kind: 'windows', label: 'Windows', auto: true, os: 'windows' };
const part = (o: { utilise?: number; montage?: string } = {}) => [{ nom: 'p1', label: 'ODIN', fs: 'exfat', tailleOctets: 57 * Go, utiliseOctets: o.utilise ?? 10 * Go, ...(o.montage ? { montage: o.montage } : {}) }, { nom: 'p2', label: 'VTOYEFI', fs: 'vfat', tailleOctets: 32 * 1024 ** 2 }];
const cle = (id: string, serie: string, o: { utilise?: number; estOdin?: boolean } = {}): Disque => ({ id, chemin: `faux-${id}`, modele: 'Clé USB 64 Go (fausse)', serie, tailleOctets: 58 * Go, genre: 'cle', externe: true, amovible: true, bus: 'usb', estOdin: o.estOdin ?? true, partitions: part(o) });
const INTERNE: Disque = { id: 'faux-interne', chemin: 'faux-1', modele: 'SSD interne (faux)', serie: 'SSD00112233', tailleOctets: 512 * Go, genre: 'interne', externe: false, amovible: false, bus: 'nvme', estOdin: true, partitions: part() };

/** Une clé déjà écrite par Odin avant ce lot (comme l'écriture du lot C4), dans un dossier qui joue sa partition ODIN. */
function cleEcrite(dir: string) {
  const f = (rel: string, c: string) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), c); };
  f('ISO/ubuntu-24.04-desktop-amd64.iso', 'ISO-UBUNTU');
  f('ISO/Win11_Pro_24H2_French_x64.iso', 'ISO-WIN');
  f('ISO/gparted-live-1.6.0-amd64.iso', 'ISO-GPARTED');
  f('persistence/ubuntu-24.04-desktop-amd64.dat', 'MEMOIRE');
  f('logiciels/windows/firefox.exe', 'EXE');
  f('odin/inject-Win11_Pro_24H2_French_x64.tar.gz', 'TAR');
  f('odin/autounattend.xml', '<xml/>');
  f('ecran-odin/systemes.json', '{}');
  f('ecran-odin/ecran/etat', '{}');
  f('ventoy/ventoy_grub.cfg', 'menuentry "VTOY_RET" --class=vtoyret {\n  echo ""\n}\n\nmenuentry "Linux installe" {\n  chainloader /x\n}\n');
  f('ventoy/ventoy.json', JSON.stringify({
    control: [{ VTOY_DEFAULT_MENU_MODE: '0' }, { VTOY_WIN11_BYPASS_CHECK: '1' }],
    theme: { file: '/ventoy/theme/odin/theme.txt', display_mode: 'GUI' },
    menu_alias: [{ image: '/ISO/Win11_Pro_24H2_French_x64.iso', alias: 'Windows 11' }, { image: '/ISO/ubuntu-24.04-desktop-amd64.iso', alias: 'Ubuntu 24.04' }, { image: '/ISO/gparted-live-1.6.0-amd64.iso', alias: 'GParted 1.6' }],
    menu_class: [{ key: 'Win11_Pro_24H2_French_x64.iso', class: 'windows' }],
    auto_install: [{ image: '/ISO/Win11_Pro_24H2_French_x64.iso', template: '/odin/autounattend.xml' }],
    injection: [{ image: '/ISO/Win11_Pro_24H2_French_x64.iso', archive: '/odin/inject-Win11_Pro_24H2_French_x64.tar.gz' }],
    persistence: [{ image: '/ISO/ubuntu-24.04-desktop-amd64.iso', backend: '/persistence/ubuntu-24.04-desktop-amd64.dat' }],
    password: { bootpwd: 'SHA256:abc' },
  }, null, 2));
}
/** Tous les fichiers sous un dossier (chemins relatifs). */
const tout = (d: string): string[] => (existsSync(d) ? readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath ?? d, e.name).slice(d.length + 1).replace(/\\/g, '/')).sort() : []);

/** Un Odin d'essai : des disques faux, une clé par dossier temporaire, une bibliothèque fausse, ctx.run qui compte. */
function monde(o: { disques: () => Disque[]; io?: (base: ReturnType<typeof G.ioGererDossier>) => G.IoGerer }) {
  const src = neuf('src'), home = neuf('home'), dir = neuf('dir');
  const fs = (n: string, c: string) => { const p = join(src, n); writeFileSync(p, c); return p; };
  const biblio = [
    { id: 'ubuntu', nom: 'ubuntu-24.04-desktop-amd64', chemin: fs('u.iso', 'ISO-UBUNTU'), recipe: rUbuntu },
    { id: 'ubuntu2', nom: 'ubuntu-24.04.2-desktop-amd64', chemin: fs('u2.iso', 'ISO-UBUNTU-NEUVE'), recipe: rUbuntu },
    { id: 'mint', nom: 'linuxmint-22-cinnamon-64bit', chemin: fs('mint.iso', 'ISO-MINT'), recipe: rLive },
    { id: 'win', nom: 'Win11_Pro_24H2_French_x64', chemin: fs('w.iso', 'ISO-WIN'), recipe: rWin },
  ];
  const cles = new Map<string, string>();
  const appels = { run: 0 };
  /** l'heure d'Odin (0 : l'heure vraie) */
  const horloge = { t: 0 };
  const settings = { get cleDisquesTest() { return o.disques(); } } as Record<string, unknown>;
  const ctx = {
    home, dir, settings, now: () => new Date(horloge.t || Date.now()),
    run: async () => { appels.run++; throw new Error('aucune commande pendant les essais'); },
    call: async () => { throw new Error('absent'); },
  } as unknown as ModCtx;
  const dossierDe = (id: string) => { if (!cles.has(id)) cles.set(id, neuf(`cle-${id}`)); return cles.get(id)!; };
  const actions = G.cleGerer({ bibliotheque: async () => biblio, io: (_c, d) => { const base = G.ioGererDossier(dossierDe(d.id)); return o.io ? o.io(base) : base; } }).actions;
  const act = (id: string, input: Record<string, unknown> = {}) => actions.find((a) => a.id === id)!.run(ctx, input);
  return { ctx, act, actions, dossierDe, appels, biblio, horloge };
}
const cibleDe = (d: Disque) => ({ id: d.id, serie: d.serie, tailleOctets: d.tailleOctets, modele: d.modele });
type Vue = { etat: string; id?: string; nom: string; branchee: boolean; changements?: number; contenu?: { systemes: Array<{ fichier: string; defautPermis: boolean }>; defaut?: string }; attente?: unknown; travail?: { fini: boolean; ok?: boolean; message: string } };
const cles = async (m: ReturnType<typeof monde>) => ((await m.act('cle_mes_cles')).data as { cles: Vue[] }).cles;
async function appliquer(m: ReturnType<typeof monde>, id: string) {
  const r = await m.act('cle_appliquer', { cle: id });
  if (r.ok) await G.attendreTravail(id);
  return r;
}
const U = 'ubuntu-24.04-desktop-amd64.iso', W = 'Win11_Pro_24H2_French_x64.iso', GP = 'gparted-live-1.6.0-amd64.iso', MINT = 'linuxmint-22-cinnamon-64bit.iso';

// ------------------------------------------------------------------------------------------------ règles pures
test('C5 · défaut sûr : jamais une installation automatique ni une image inconnue ; un live, un outil, un système installé : oui', () => {
  const e = (x: Partial<G.EntreeCle>): G.EntreeCle => ({ fichier: 'a.iso', nom: 'A', famille: 'Linux', mode: 'demarrer', kind: 'iso', auto: false, os: 'linux', choix: 'iso', ...x });
  assert.equal(G.defautPermis(e({ mode: 'installer', kind: 'ubuntu', auto: true })), false, 'installe tout seul');
  assert.equal(G.defautPermis(e({ kind: 'ubuntu', auto: true })), false, 'une ISO d\'installation, même sans fichier de réponses');
  assert.equal(G.defautPermis(e({ kind: 'iso' })), false, 'une image inconnue');
  assert.equal(G.defautPermis(e({ kind: 'casper' })), true, 'un système live');
  assert.equal(G.defautPermis(e({ choix: 'installe', kind: 'windows', os: 'windows' })), true, 'un Windows installé sur la clé démarre, n\'installe rien');
  assert.match(G.raisonPasDefaut(e({ nom: 'Ubuntu', mode: 'installer' }))!, /Ubuntu installe un système/);
});

test('C5 · chemins : seulement les dossiers d\'Odin sur la clé ; ni « .. », ni chemin absolu, ni lecteur, ni nom réservé', () => {
  for (const ok of ['ISO/a.iso', 'ventoy/ventoy.json', 'odin/cle-odin.json', 'ecran-odin/ecran/etat']) assert.equal(G.relSur(ok), ok);
  for (const ko of ['a.iso', '../x', 'ISO/../../Windows/x', '/ISO/a.iso', 'C:/ISO/a', 'ISO/con.iso', 'ISO/a.iso.', 'EFI/BOOT/x', 'ISO//a', 'ISO/./a']) assert.equal(G.relSur(ko), undefined, ko);
});

test('C5 · lire une clé écrite avant ce lot : le menu dans l\'ordre de ventoy.json, l\'installation automatique reconnue, rien d\'écrit', async () => {
  const d = neuf('lire'); cleEcrite(d);
  const avant = tout(d);
  const c = await G.lireCle(G.ioGererDossier(d));
  assert.equal(c.id, undefined, 'pas encore d\'identité');
  assert.deepEqual(c.systemes.map((s) => s.fichier), [W, U, GP]);
  assert.equal(c.systemes[0].mode, 'installer'); assert.equal(c.systemes[0].kind, 'windows');
  assert.equal(c.systemes[1].choix, 'persistance');
  assert.equal(c.systemes[2].famille, 'Outil');
  assert.deepEqual(c.logiciels.windows, ['firefox.exe']);
  assert.equal(c.occupation.memoire, 'MEMOIRE'.length);
  assert.deepEqual(tout(d), avant, 'lire n\'écrit rien');
});

// ------------------------------------------------------------------------------------------------ le parcours complet
test('C5 · une clé ODIN branchée est reconnue (identifiant posé dans le dossier d\'Odin seulement), rangée, changée sans être effacée', async () => {
  const A = cle('cle-a', 'AA11BB227F2A');
  const m = monde({ disques: () => [A, INTERNE] });
  const dA = m.dossierDe(A.id); cleEcrite(dA);
  const avant = tout(dA);
  let l = await cles(m);
  assert.equal(l.length, 1, 'seule la clé (jamais le disque interne, même ODIN)');
  assert.equal(l[0].etat, 'a-reconnaitre');
  // Reconnaître : un seul fichier ajouté, dans /odin.
  const r = await m.act('cle_reconnaitre', { cible: cibleDe(A) });
  assert.equal(r.ok, true, r.text);
  const id = (r.data as { id: string }).id;
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.deepEqual(tout(dA), [...avant, 'odin/cle-odin.json'].sort(), 'seul le fichier d\'identité est ajouté');
  l = await cles(m);
  assert.equal(l[0].etat, 'connue'); assert.equal(l[0].branchee, true);
  assert.deepEqual(l[0].contenu!.systemes.map((s) => [s.fichier, s.defautPermis]), [[W, false], [U, false], [GP, false]]);
  // Préparer : ranger, mettre GParted… refusé par défaut (image inconnue), Mint ajouté (live) par défaut, Windows retiré.
  const ko = await m.act('cle_changer', { cle: id, attente: { defaut: W } });
  assert.equal(ko.ok, false); assert.match(ko.text, /installe un système/);
  const ch = await m.act('cle_changer', { cle: id, attente: { ordre: [MINT, U, GP], ajouter: [{ iso: 'mint' }], retirer: [W], defaut: MINT } });
  assert.equal(ch.ok, true, ch.text);
  assert.deepEqual(tout(dA), [...avant, 'odin/cle-odin.json'].sort(), 'préparer n\'écrit RIEN sur la clé');
  l = await cles(m);
  assert.equal(l[0].changements, 4, 'ajout, retrait, ordre, défaut');
  // Appliquer.
  const ap = await appliquer(m, id);
  assert.equal(ap.ok, true, ap.text);
  l = await cles(m);
  assert.equal(l[0].travail?.ok, true, l[0].travail?.message);
  assert.equal(l[0].attente, null, 'plus rien en attente');
  const apres = tout(dA);
  assert.ok(apres.includes(`ISO/${MINT}`), 'Mint copié');
  assert.ok(!apres.includes(`ISO/${W}`), 'l\'image de Windows retirée');
  assert.ok(!apres.includes('odin/inject-Win11_Pro_24H2_French_x64.tar.gz'), 'son archive aussi');
  for (const f of ['ISO/' + U, 'ISO/' + GP, 'persistence/ubuntu-24.04-desktop-amd64.dat', 'logiciels/windows/firefox.exe', 'odin/autounattend.xml']) assert.ok(apres.includes(f), `${f} gardé`);
  assert.ok(!apres.some((f) => f.endsWith('.odin-part') || f.endsWith('.odin-neuf')), 'aucun fichier provisoire laissé');
  assert.equal(readFileSync(join(dA, 'ISO', U), 'utf8'), 'ISO-UBUNTU', 'Ubuntu intact');
  // Le menu : ventoy.json patché (défaut sûr, ordre, ce qu'Odin n'a pas écrit gardé), menu texte dans l'ordre.
  const vj = JSON.parse(readFileSync(join(dA, 'ventoy/ventoy.json'), 'utf8'));
  assert.deepEqual(vj.control.slice(0, 3), [{ VTOY_DEFAULT_IMAGE: `/ISO/${MINT}` }, { VTOY_MENU_TIMEOUT: '10' }, { VTOY_DEFAULT_MENU_MODE: '0' }]);
  assert.deepEqual(vj.menu_alias.map((a: { image: string }) => a.image), [`/ISO/${MINT}`, `/ISO/${U}`, `/ISO/${GP}`]);
  assert.equal(vj.auto_install, undefined, 'l\'installation de Windows retirée avec lui');
  assert.deepEqual(vj.password, { bootpwd: 'SHA256:abc' }, 'le mot de passe de démarrage gardé');
  assert.equal(vj.persistence.length, 1, 'la mémoire d\'Ubuntu gardée');
  const grub = readFileSync(join(dA, 'ventoy/ventoy_grub.cfg'), 'utf8');
  assert.ok(grub.indexOf('Linux Mint') < grub.indexOf('Ubuntu 24.04') && grub.indexOf('Ubuntu 24.04') < grub.indexOf('GParted'), 'l\'ordre choisi');
  assert.match(grub, /set default=odin-1/, 'Mint démarre seul');
  assert.match(grub, /menuentry "Linux installe"/, 'l\'entrée d\'un Linux installé gardée');
  const id2 = JSON.parse(readFileSync(join(dA, 'odin/cle-odin.json'), 'utf8'));
  assert.equal(id2.id, id); assert.equal(id2.defaut, MINT);
  assert.equal(JSON.parse(readFileSync(join(dA, 'ecran-odin/systemes.json'), 'utf8')).systemes[0].id, MINT, 'l\'écran graphique dans le même ordre');
  assert.equal(m.appels.run, 0, 'aucune commande');
});

test('C5 · changements en attente : une clé pas branchée les garde ; appliqués au prochain branchement de CETTE clé ; une autre (même modèle, même copie) n\'est jamais touchée', async () => {
  const A = cle('cle-a', 'AA11BB227F2A'), B = cle('cle-b', 'BB99CC887766');
  let branchees: Disque[] = [A];
  const m = monde({ disques: () => branchees });
  const dA = m.dossierDe(A.id); cleEcrite(dA);
  const id = ((await m.act('cle_reconnaitre', { cible: cibleDe(A) })).data as { id: string }).id;
  await cles(m);
  // On débranche A et on branche B : B est une COPIE exacte de A (même identifiant ODIN écrit dessus).
  branchees = [B];
  const dB = m.dossierDe(B.id);
  for (const f of tout(dA)) { mkdirSync(join(dB, f, '..'), { recursive: true }); writeFileSync(join(dB, f), readFileSync(join(dA, f))); }
  const avantB = tout(dB).map((f) => [f, readFileSync(join(dB, f), 'utf8')]);
  const ch = await m.act('cle_changer', { cle: id, attente: { retirer: [GP] }, armer: true });
  assert.equal(ch.ok, true, ch.text); assert.match(ch.text, /prochain branchement/);
  const l = await cles(m);
  const a = l.find((x) => x.id === id)!;
  assert.equal(a.branchee, false, 'A n\'est pas branchée'); assert.equal(a.changements, 1);
  assert.equal(l.find((x) => x.etat === 'copie')?.branchee, true, 'B est vue comme une copie');
  const r = await appliquer(m, id);
  assert.equal(r.ok, false); assert.match(r.text, /pas branchée/);
  assert.deepEqual(tout(dB).map((f) => [f, readFileSync(join(dB, f), 'utf8')]), avantB, 'B n\'est jamais touchée');
  const rec = await m.act('cle_reconnaitre', { cible: cibleDe(B) });
  assert.equal(rec.ok, false); assert.match(rec.text, /AUTRE clé/);
  // A revient : les changements s'appliquent à elle seule.
  branchees = [A, B];
  assert.equal((await appliquer(m, id)).ok, true);
  assert.ok(!existsSync(join(dA, 'ISO', GP)), 'GParted retiré de A');
  assert.ok(existsSync(join(dB, 'ISO', GP)), 'B garde tout');
  assert.deepEqual(tout(dB).map((f) => [f, readFileSync(join(dB, f), 'utf8')]), avantB);
});

test('C5 · garde-fous : disque interne, clé non ODIN, numéro de série illisible ou changé juste avant d\'écrire, place insuffisante : rien n\'est écrit', async () => {
  const A = cle('cle-a', 'AA11BB227F2A'), NON = cle('cle-n', 'NN11223344', { estOdin: false }), SANS = { ...cle('cle-s', ''), serie: undefined };
  let liste: Disque[] = [A, NON, SANS, INTERNE];
  const m = monde({ disques: () => liste });
  for (const d of [A, NON, SANS, INTERNE]) cleEcrite(m.dossierDe(d.id));
  const instant = () => [A, NON, SANS, INTERNE].map((d) => tout(m.dossierDe(d.id)).join('|')).join('#');
  const l = await cles(m);
  assert.deepEqual(l.map((x) => x.etat).sort(), ['a-reconnaitre', 'serie-illisible'], 'ni la clé non ODIN, ni le disque interne');
  for (const [d, re] of [[INTERNE, /interne/], [NON, /pas une clé ODIN/], [SANS, /illisible/]] as const) {
    const r = await m.act('cle_reconnaitre', { cible: cibleDe(d) });
    assert.equal(r.ok, false, d.id); assert.match(r.text, re);
  }
  const avant = instant();
  const id = ((await m.act('cle_reconnaitre', { cible: cibleDe(A) })).data as { id: string }).id;
  await cles(m);
  // Place : le Mint « pèse » 8 octets ; on dit que la partition est pleine.
  liste = [{ ...A, partitions: part({ utilise: 57 * Go - 100 }) }, NON, SANS, INTERNE];
  await m.act('cle_changer', { cle: id, attente: { ajouter: [{ iso: 'mint' }] } });
  const r1 = await appliquer(m, id);
  const t1 = (await cles(m)).find((x) => x.id === id)!.travail!;
  assert.equal(r1.ok, true); assert.equal(t1.ok, false); assert.match(t1.message, /Pas assez de place/);
  assert.ok(!existsSync(join(m.dossierDe(A.id), 'ISO', MINT)));
  // Le numéro de série change entre la lecture et l'écriture (un autre disque a pris la place) : refus, rien d'écrit.
  liste = [A, NON, SANS, INTERNE];
  let n = 0;
  const m2 = { ...m, ctx: { ...m.ctx, settings: { get cleDisquesTest() { n++; return n > 2 ? [{ ...A, serie: 'ZZ00000099' }] : [A]; } } } as unknown as ModCtx };
  const fA = tout(m.dossierDe(A.id));
  const r2 = await m.actions.find((a) => a.id === 'cle_appliquer')!.run(m2.ctx, { cle: id });
  if (r2.ok) await G.attendreTravail(id);
  const t2 = (await cles(m)).find((x) => x.id === id)!.travail!;
  assert.equal(t2.ok, false); assert.match(t2.message, /plus la même clé/); assert.match(t2.message, /Rien n'a été écrit/);
  assert.deepEqual(tout(m.dossierDe(A.id)), fA);
  assert.equal(instant().split('#').slice(1).join('#'), avant.split('#').slice(1).join('#'), 'les autres disques jamais touchés');
  assert.equal(m.appels.run, 0);
});

test('C5 · coupure en pleine écriture, à chaque geste : la clé reste démarrable (son menu ne cite que des fichiers présents)', async () => {
  const base: Record<string, string> = {};
  const d = neuf('coupe'); cleEcrite(d);
  for (const f of tout(d)) base[f] = readFileSync(join(d, f), 'utf8');
  const id = 'ab'.repeat(16);
  base['odin/cle-odin.json'] = JSON.stringify({ odin: 1, id, cree: 1, maj: 1, systemes: [], modeDefaut: 'graphique', delai: 10 });
  const biblio = [{ id: 'mint', nom: 'linuxmint-22-cinnamon-64bit', chemin: '/src/mint.iso', recipe: rLive }];
  const verifier = async () => undefined;
  const brut = { ajouter: [{ iso: 'mint' }], retirer: [W], ordre: [MINT, U, GP], defaut: MINT };
  // D'abord sans coupure : combien de gestes ?
  const io0 = G.ioGererSimulee({ ...base }, { libre: 50 * Go, sources: { '/src/mint.iso': 'ISO-MINT' } });
  const c0 = await G.lireCle(io0);
  const a0 = G.attenteDe(brut, c0, biblio, () => 8).attente!;
  assert.equal((await G.appliquerAttente(io0, c0, a0, biblio, { verifier, source: () => '/src/mint.iso' })).ok, true);
  const gestes = io0.ops.length;
  assert.ok(gestes >= 10, `gestes : ${gestes}`);
  for (let k = 1; k <= gestes; k++) {
    let n = 0;
    const io = G.ioGererSimulee({ ...base }, { libre: 50 * Go, sources: { '/src/mint.iso': 'ISO-MINT' }, couper: () => ++n === k });
    const c = await G.lireCle(io);
    const r = await G.appliquerAttente(io, c, G.attenteDe(brut, c, biblio, () => 8).attente!, biblio, { verifier, source: () => '/src/mint.iso' });
    assert.equal(r.ok, false, `coupure ${k}`); assert.match(r.message, /démarre toujours|Rien n'a été écrit/);
    const vj = JSON.parse(io.fichiers.get('ventoy/ventoy.json')!);
    const cites = [...vj.menu_alias.map((x: { image: string }) => x.image), ...vj.control.map((x: Record<string, string>) => x.VTOY_DEFAULT_IMAGE).filter(Boolean)].map((x: string) => x.replace(/^\//, ''));
    for (const f of cites) assert.ok(io.fichiers.has(f), `coupure ${k} : ventoy.json cite ${f}, absent`);
    for (const f of io.fichiers.get('ventoy/ventoy_grub.cfg')!.match(/\/ISO\/[^"]+/g) ?? []) assert.ok(io.fichiers.has(f.slice(1)), `coupure ${k} : le menu texte cite ${f}, absent`);
    // Après la coupure, on recommence : tout s'applique (les restes provisoires sont nettoyés).
    const c2 = await G.lireCle(io, biblio);
    const b2 = c2.systemes.some((s) => s.fichier === MINT) ? { ...brut, ajouter: [] } : brut;
    const r2 = await G.appliquerAttente(io, c2, G.attenteDe(b2, c2, biblio, () => 8).attente!, biblio, { verifier, source: () => '/src/mint.iso' });
    assert.equal(r2.ok, true, `reprise après la coupure ${k} : ${r2.message}`);
    assert.ok(io.fichiers.has(`ISO/${MINT}`) && !io.fichiers.has(`ISO/${W}`), `reprise ${k}`);
    assert.ok(![...io.fichiers.keys()].some((f) => /\.odin-(part|neuf)$/.test(f)), `reprise ${k} : aucun reste provisoire`);
  }
});

test('C5 · aucun raccourci suivi : un dossier ISO qui mène ailleurs (jonction) est refusé, rien n\'est écrit hors de la clé', async () => {
  const d = neuf('lien'), ailleurs = neuf('ailleurs');
  cleEcrite(d);
  rmSync(join(d, 'ISO'), { recursive: true, force: true });
  writeFileSync(join(ailleurs, 'precieux.txt'), 'NE PAS TOUCHER');
  try { symlinkSync(ailleurs, join(d, 'ISO'), 'junction'); } catch { return; /* pas de lien possible ici : essai sans objet */ }
  const io = G.ioGererDossier(d);
  await assert.rejects(io.ecrireAtomique('ISO/x.iso', 'X'), /lien/);
  await assert.rejects(io.retirer('ISO/precieux.txt'), /lien/);
  assert.deepEqual(await io.lister('ISO'), []);
  assert.deepEqual(readdirSync(ailleurs), ['precieux.txt']);
  // En mémoire aussi.
  const sim = G.ioGererSimulee({ 'ISO/a.iso': 'A' }, { liens: ['ISO'] });
  await assert.rejects(sim.retirer('ISO/a.iso'), /lien/);
});

test('C5 · relire la clé : chaque fichier comparé à son empreinte ; un fichier abîmé est signalé ; rien n\'est écrit', async () => {
  const A = cle('cle-a', 'AA11BB227F2A');
  const m = monde({ disques: () => [A] });
  const dA = m.dossierDe(A.id); cleEcrite(dA);
  const id = ((await m.act('cle_reconnaitre', { cible: cibleDe(A) })).data as { id: string }).id;
  await m.act('cle_changer', { cle: id, attente: { ajouter: [{ iso: 'mint' }] } });
  await appliquer(m, id);
  const avant = tout(dA);
  let r = await m.act('cle_relire', { cle: id }); assert.equal(r.ok, true, r.text); await G.attendreTravail(id);
  let t = (await cles(m)).find((x) => x.id === id)!.travail!;
  assert.equal(t.ok, true, t.message); assert.match(t.message, /aucune erreur/);
  writeFileSync(join(dA, 'ISO', MINT), 'ABIME');
  r = await m.act('cle_relire', { cle: id }); await G.attendreTravail(id);
  t = (await cles(m)).find((x) => x.id === id)!.travail!;
  assert.equal(t.ok, false); assert.match(t.message, /1 fichier\(s\) différent/);
  assert.deepEqual(tout(dA), avant, 'relire n\'écrit rien');
});

test('C5 · mises à jour PROPOSÉES (jamais faites seules) : une ISO plus récente ; la remplacer passe par l\'attente', async () => {
  const A = cle('cle-a', 'AA11BB227F2A');
  const m = monde({ disques: () => [A] });
  const dA = m.dossierDe(A.id); cleEcrite(dA);
  const id = ((await m.act('cle_reconnaitre', { cible: cibleDe(A) })).data as { id: string }).id;
  const avant = tout(dA);
  const r = await m.act('cle_mises_a_jour', { cle: id });
  const d = r.data as { propositions: Array<{ ancien: string; iso: string }>; ajoutables: Array<{ iso: string; defautPermis: boolean }>; menu: string };
  assert.deepEqual(d.propositions.map((p) => [p.ancien, p.iso]), [[U, 'ubuntu2']]);
  assert.equal(d.ajoutables.find((x) => x.iso === 'mint')?.defautPermis, true);
  assert.equal(d.ajoutables.find((x) => x.iso === 'ubuntu2')?.defautPermis, false, 'une ISO d\'installation n\'est jamais par défaut');
  assert.deepEqual(tout(dA), avant, 'proposer n\'écrit rien');
  assert.equal((await cles(m))[0].attente, null, 'et ne prépare rien tout seul');
  await m.act('cle_changer', { cle: id, attente: { remplacer: [{ ancien: U, iso: 'ubuntu2' }] } });
  await appliquer(m, id);
  assert.ok(existsSync(join(dA, 'ISO', 'ubuntu-24.04.2-desktop-amd64.iso')) && !existsSync(join(dA, 'ISO', U)));
  assert.ok(!existsSync(join(dA, 'persistence', 'ubuntu-24.04-desktop-amd64.dat')), 'la mémoire de l\'ancienne version suit son image');
  assert.equal(((await m.act('cle_mises_a_jour', { cle: id })).data as { menu: string }).menu, 'a-jour');
});

test('C5 · réservé au propriétaire ; le registre va dans la base de Genèse (GENESE_ODIN, schéma « cles ») sans numéro de série lisible', () => {
  for (const a of G.cleGerer().actions) assert.equal(a.proprietaireSeul, true, a.id);
  assert.equal(G.DEF_CLES.appli, 'thjalfi'); assert.equal(nomBase('thjalfi'), 'GENESE_ODIN');
  assert.doesNotMatch(G.DEF_CLES.migrations[0].sql.split('CREATE VIEW')[1], /serie/);
  assert.ok(E.cleUsb().actions.some((a) => a.id === 'cle_journal'), 'le journal des clés (lot S3) reste là');
});

test('C5 · une clé écrite par « Déployer » (lot C4, faux disque) se gère ensuite dans « Mes clés » : même dossier, même menu', async () => {
  const A = cle('cle-a', 'AA11BB227F2A');
  const src = neuf('src4'), home = neuf('home4'), dir = neuf('dir4');
  const iso = join(src, 'mint.iso'); writeFileSync(iso, 'ISO-MINT');
  const isoU = join(src, 'u.iso'); writeFileSync(isoU, 'ISO-UBUNTU');
  const biblio = [{ id: 'mint', nom: 'linuxmint-22-cinnamon-64bit', chemin: iso, recipe: rLive }, { id: 'ubuntu', nom: 'ubuntu-24.04-desktop-amd64', chemin: isoU, recipe: rUbuntu }];
  const ctx = { home, dir, settings: { cleDisquesTest: [A] }, now: () => new Date(), run: async () => { throw new Error('aucune commande'); }, call: async () => ({ ok: true, text: '', data: { fichiers: [] } }) } as unknown as ModCtx;
  const c4 = E.cleUsb({ bibliotheque: async () => biblio, antivirus: () => undefined, profil: () => ({ utilisateur: 'odin', langue: 'fr', clavier: 'fr', fuseau: 'Indian/Mayotte' }) }).actions;
  const r = await c4.find((a) => a.id === 'cle_preparer')!.run(ctx, { cible: cibleDe(A), systemes: [{ nom: 'Ubuntu 24.04', iso: 'iso:ubuntu', choix: 'iso' }], phrase: 'écrire sur la clé 58 go' });
  assert.equal(r.ok, true, r.text);
  const fin = await E.attendreEcriture(A.id); assert.equal(fin?.ok, true, fin?.message);
  const g = G.cleGerer({ bibliotheque: async () => biblio }).actions;
  const act = (id: string, i: Record<string, unknown> = {}) => g.find((a) => a.id === id)!.run(ctx, i);
  const l = ((await act('cle_mes_cles')).data as { cles: Vue[] }).cles;
  assert.equal(l[0].etat, 'a-reconnaitre');
  const id = ((await act('cle_reconnaitre', { cible: cibleDe(A) })).data as { id: string }).id;
  const vue = ((await act('cle_mes_cles')).data as { cles: Vue[] }).cles[0];
  assert.deepEqual(vue.contenu!.systemes.map((s) => [s.fichier, s.defautPermis]), [[U, false]], 'Ubuntu installe : jamais par défaut');
  const ch = await act('cle_changer', { cle: id, attente: { ajouter: [{ iso: 'mint' }], ordre: [MINT, U], defaut: MINT } });
  assert.equal(ch.ok, true, ch.text);
  assert.equal((await act('cle_appliquer', { cle: id })).ok, true); await G.attendreTravail(id);
  const v2 = ((await act('cle_mes_cles')).data as { cles: Vue[] }).cles[0];
  assert.equal(v2.travail?.ok, true, v2.travail?.message);
  assert.deepEqual(v2.contenu!.systemes.map((s) => s.fichier), [MINT, U]); assert.equal(v2.contenu!.defaut, MINT);
  const racine = join(dir, 'cle-essai', 'cle-a');
  assert.equal(readFileSync(join(racine, 'ISO', U), 'utf8'), 'ISO-UBUNTU', 'Ubuntu intact');
  const vj = JSON.parse(readFileSync(join(racine, 'ventoy/ventoy.json'), 'utf8'));
  assert.equal(vj.control[0].VTOY_DEFAULT_IMAGE, `/ISO/${MINT}`);
  assert.ok(vj.auto_install.some((x: { image: string }) => x.image === `/ISO/${U}`), 'l\'installation d\'Ubuntu (écrite par Déployer) gardée');
});

// ================================================================================================ relecture du lot C5
// Chaque essai ci-dessous échouait avant la relecture (une écriture sur la mauvaise clé, un accord qui n'en était pas un,
// une installation qui démarre seule, un réglage perdu…) et passe après.
const MARGE_CLE = 512 * 1024 ** 2;
const JOUR = 24 * 3600 * 1000;
/** Une clé écrite (lot C4), branchée, reconnue : rend son identifiant ODIN. */
async function connue(m: ReturnType<typeof monde>, d: Disque): Promise<string> {
  cleEcrite(m.dossierDe(d.id));
  const r = await m.act('cle_reconnaitre', { cible: cibleDe(d) });
  assert.equal(r.ok, true, r.text);
  await cles(m);
  return (r.data as { id: string }).id;
}
const photo = (d: string) => tout(d).map((f) => [f, readFileSync(join(d, f), 'utf8')]);
const sansAttente = { retirer: [], ajouter: [], remplacer: [], arme: false, depuis: 0 };

test('relecture C5 · un numéro de série que beaucoup de clés partagent (0123456789…) ne prouve rien : la clé est montrée, jamais reconnue ni changée', async () => {
  const A = cle('cle-a', '0123456789');
  const m = monde({ disques: () => [A] });
  const dA = m.dossierDe(A.id); cleEcrite(dA);
  const avant = photo(dA);
  assert.equal((await cles(m))[0].etat, 'serie-illisible', 'deux clés du même modèle porteraient le même numéro');
  const r = await m.act('cle_reconnaitre', { cible: cibleDe(A) });
  assert.equal(r.ok, false); assert.match(r.text, /beaucoup de clés partagent/); assert.match(r.text, /Rien n'a été écrit/);
  assert.deepEqual(photo(dA), avant);
  for (const s of ['0123456789', '0123456789ABCDEF', '1234567890AB', 'AAAAAAAAAAAA', '000000000001', 'FEDCBA987654', '12345']) assert.equal(G.serieGenerique(s), true, s);
  for (const s of ['AA11BB227F2A', '4C530001230412118021', '07B20C0513A4', '60A44C3FAE22B1A17971']) assert.equal(G.serieGenerique(s), false, s);
});

test('relecture C5 · deux clés branchées qui se présentent comme la même (même numéro de série, même identifiant) : aucune n\'est touchée', async () => {
  const A = cle('cle-a', 'AA11BB227F2A'), JUMELLE = cle('cle-j', 'AA11BB227F2A');
  let branchees: Disque[] = [A];
  const m = monde({ disques: () => branchees });
  const id = await connue(m, A);
  const dA = m.dossierDe(A.id), dJ = m.dossierDe(JUMELLE.id);
  for (const f of tout(dA)) { mkdirSync(join(dJ, f, '..'), { recursive: true }); writeFileSync(join(dJ, f), readFileSync(join(dA, f))); }
  branchees = [JUMELLE, A];
  assert.equal((await m.act('cle_changer', { cle: id, attente: { retirer: [GP] } })).ok, true);
  const avant = [photo(dA), photo(dJ)];
  const r = await appliquer(m, id);
  assert.equal(r.ok, false, 'Odin ne choisit pas au hasard'); assert.match(r.text, /Deux clés branchées/);
  assert.deepEqual([photo(dA), photo(dJ)], avant, 'ni l\'une ni l\'autre');
  branchees = [A];
  assert.equal((await appliquer(m, id)).ok, true, 'seule, la bonne clé est changée');
  assert.ok(!existsSync(join(dA, 'ISO', GP))); assert.ok(existsSync(join(dJ, 'ISO', GP)));
});

test('relecture C5 · un disque qui porte seulement le NOM « ODIN » (aucun menu d\'Odin dessus) n\'est jamais reconnu : rien n\'y est écrit', async () => {
  const D = cle('disque-perso', 'PP55QQ667788');
  const m = monde({ disques: () => [D] });
  const d = m.dossierDe(D.id);
  mkdirSync(join(d, 'Photos'), { recursive: true }); writeFileSync(join(d, 'Photos', 'vacances.jpg'), 'JPG');
  mkdirSync(join(d, 'ISO'), { recursive: true }); writeFileSync(join(d, 'ISO', 'mes-sauvegardes.iso'), 'A MOI');
  const avant = photo(d);
  const r = await m.act('cle_reconnaitre', { cible: cibleDe(D) });
  assert.equal(r.ok, false, r.text); assert.match(r.text, /pas une clé faite par lui/); assert.match(r.text, /Rien n'a été écrit/);
  assert.deepEqual(photo(d), avant, 'pas même le fichier d\'identité');
});

test('relecture C5 · « au prochain branchement » : un accord donné par le propriétaire, pour CES changements, valable 7 jours ; jamais glissé par la page, jamais gardé après un changement', async () => {
  const A = cle('cle-a', 'AA11BB227F2A');
  const m = monde({ disques: () => [A] });
  const id = await connue(m, A);
  const dA = m.dossierDe(A.id);
  const vue = async () => (await cles(m)).find((x) => x.id === id)! as Vue & { attente: { arme: boolean } | null; armeValide: boolean };
  const auto = () => m.act('cle_appliquer', { cle: id, auto: true });
  // 1) « arme » glissé dans les changements (une page trafiquée, une ancienne page) : ce n'est pas un accord.
  await m.act('cle_changer', { cle: id, attente: { retirer: [GP], arme: true, armeLe: 1 } });
  assert.equal((await vue()).attente!.arme, false, 'l\'accord est un geste à part');
  let r = await auto();
  assert.equal(r.ok, false); assert.match(r.text, /pas ton accord/);
  assert.ok(existsSync(join(dA, 'ISO', GP)));
  // 2) L'accord pour « ranger le menu », puis un retrait ajouté : l'accord tombe (il ne valait pas pour ce retrait).
  await m.act('cle_changer', { cle: id, attente: { ordre: [U, W, GP] }, armer: true });
  assert.equal((await vue()).attente!.arme, true); assert.equal((await vue()).armeValide, true);
  await m.act('cle_changer', { cle: id, attente: { ordre: [U, W, GP], retirer: [W] } });
  assert.equal((await vue()).attente!.arme, false, 'changer quoi que ce soit retire l\'accord');
  r = await auto();
  assert.equal(r.ok, false);
  assert.ok(existsSync(join(dA, 'ISO', W)), 'le retrait n\'est pas parti tout seul');
  // 3) L'accord, puis 8 jours : Odin ne l'applique plus tout seul (un retrait oublié ne part pas par surprise).
  const ch = await m.act('cle_changer', { cle: id, attente: { retirer: [GP] }, armer: true });
  assert.match(ch.text, /prochain branchement/); assert.match(ch.text, /7 jours/);
  m.horloge.t = Date.now() + 8 * JOUR;
  assert.equal((await vue()).armeValide, false);
  r = await auto();
  assert.equal(r.ok, false); assert.match(r.text, /plus de 7 jours/); assert.match(r.text, /Rien n'a été écrit/);
  assert.ok(existsSync(join(dA, 'ISO', GP)));
  // 4) Redonné : dans les 7 jours, la clé branchée, c'est appliqué.
  await m.act('cle_changer', { cle: id, attente: { retirer: [GP] }, armer: true });
  m.horloge.t += 2 * JOUR;
  r = await auto();
  assert.equal(r.ok, true, r.text);
  await G.attendreTravail(id);
  assert.ok(!existsSync(join(dA, 'ISO', GP)), 'appliqué au branchement, avec son accord');
  assert.equal(G.armeValide({ ...sansAttente, arme: true }, Date.now()), false, 'un accord sans date ne vaut rien');
});

test('relecture C5 · jamais une installation qui démarre seule : ventoy.json a le dernier mot (réglage par démarrage, par dossier, avec « * »), même si le fichier d\'identité dit « démarre »', async () => {
  const id = 'cd'.repeat(16);
  const man = { odin: 1, id, cree: 1, maj: 1, systemes: [{ fichier: MINT, nom: 'Linux Mint', famille: 'Linux', kind: 'casper', os: 'linux', auto: false, mode: 'demarrer', choix: 'iso' }], defaut: MINT, modeDefaut: 'graphique', delai: 5 };
  const pieges: Array<Record<string, unknown>> = [
    { auto_install: [{ image: `/ISO/${MINT}`, template: '/odin/user-data' }] },
    { auto_install_uefi: [{ image: `/ISO/${MINT}`, template: '/odin/user-data' }] },
    { auto_install: [{ parent: '/ISO', template: ['/odin/user-data'] }] },
    { auto_install_legacy: [{ image: '/iso/LINUXMINT-*.iso', template: '/odin/preseed.cfg' }] },
  ];
  for (const vj of pieges) {
    const io = G.ioGererSimulee({ [`ISO/${MINT}`]: 'ISO-MINT', 'odin/cle-odin.json': JSON.stringify(man), 'ventoy/ventoy.json': JSON.stringify(vj) });
    const c = await G.lireCle(io);
    const nom = Object.keys(vj)[0] + JSON.stringify(Object.values(vj)[0]).slice(0, 40);
    assert.equal(c.systemes[0].mode, 'installer', nom);
    assert.equal(G.defautPermis(c.systemes[0]), false, nom);
    assert.match(G.attenteDe({ defaut: MINT }, c, []).refus ?? '', /installe un système/, nom);
    assert.equal(G.menuFinal(c, sansAttente, []).defaut, undefined, `${nom} : l'ancien défaut n'est pas reconduit`);
  }
  // Un défaut caché dans un réglage « par démarrage » (il passe devant « control ») est remplacé par le même défaut sûr.
  const m0 = G.manifesteDe(JSON.stringify({ ...man, defaut: undefined }))!;
  const sortie = JSON.parse(G.patchVentoyJson(JSON.stringify({ control: [{ VTOY_DEFAULT_MENU_MODE: '0' }], control_uefi: [{ VTOY_DEFAULT_IMAGE: `/ISO/${W}` }, { VTOY_MENU_TIMEOUT: '3' }, { VTOY_WIN11_BYPASS_CHECK: '1' }] }), m0, []));
  assert.deepEqual(sortie.control_uefi, [{ VTOY_DEFAULT_MENU_MODE: '0' }, { VTOY_WIN11_BYPASS_CHECK: '1' }], 'plus de défaut ni de délai cachés');
});

test('relecture C5 · ventoy.json de la clé : la marque d\'octets en tête est lue (mot de passe gardé) ; illisible ou trop gros : Odin ne le remplace pas, rien n\'est écrit', async () => {
  const d = neuf('vj'); cleEcrite(d);
  const base: Record<string, string> = {};
  for (const f of tout(d)) base[f] = readFileSync(join(d, f), 'utf8');
  const id = 'ef'.repeat(16);
  base['odin/cle-odin.json'] = JSON.stringify({ odin: 1, id, cree: 1, maj: 1, systemes: [], modeDefaut: 'graphique', delai: 10 });
  const verifier = async () => undefined;
  const essai = async (vj: string, max?: number) => {
    const io = G.ioGererSimulee({ ...base, 'ventoy/ventoy.json': vj });
    if (max) { const lire = io.lire.bind(io); io.lire = async (rel, m) => (rel === 'ventoy/ventoy.json' ? undefined : lire(rel, m)); }
    const c = await G.lireCle(io);
    const a = G.attenteDe({ ordre: [GP, U, W] }, c, []).attente!;
    const r = await G.appliquerAttente(io, c, a, [], { verifier, source: () => undefined });
    return { io, r };
  };
  // Enregistré depuis un bloc-notes : trois octets de marque devant. Le mot de passe de démarrage ne doit pas disparaître.
  const bom = await essai(`﻿${base['ventoy/ventoy.json']}`);
  assert.equal(bom.r.ok, true, bom.r.message);
  const apres = JSON.parse(bom.io.fichiers.get('ventoy/ventoy.json')!);
  assert.deepEqual(apres.password, { bootpwd: 'SHA256:abc' }, 'le mot de passe de démarrage est gardé');
  assert.equal(apres.persistence.length, 1); assert.equal(apres.auto_install.length, 1);
  // Abîmé : on ne sait pas ce qu'il contenait, on ne l'écrase pas.
  const abime = await essai('{ "control": [ { "VTOY_DEFAULT_MENU_MODE": "0" }, ');
  assert.equal(abime.r.ok, false); assert.match(abime.r.message, /illisible ou trop gros/); assert.match(abime.r.message, /Rien n'a été écrit/);
  assert.deepEqual(abime.io.ops, [], 'aucun geste sur la clé');
  // Trop gros pour être lu : pareil (avant, il était pris pour absent et refait en entier).
  const gros = await essai(base['ventoy/ventoy.json'], 1);
  assert.equal(gros.r.ok, false); assert.match(gros.r.message, /illisible ou trop gros/);
  assert.deepEqual(gros.io.ops, []);
  assert.equal(gros.io.fichiers.get('ventoy/ventoy.json'), base['ventoy/ventoy.json']);
});

test('relecture C5 · application coupée après la copie : les changements se reprennent (l\'image déjà copiée est relue, pas « déjà sur la clé »), puis tout est fini', async () => {
  const A = cle('cle-a', 'AA11BB227F2A');
  let coupe = true;
  const m = monde({ disques: () => [A], io: (base) => ({ ...base, ecrireAtomique: async (rel: string, c: string) => { if (coupe && rel === 'ventoy/ventoy.json') { coupe = false; throw new Error('coupure (essai)'); } return base.ecrireAtomique(rel, c); } }) });
  const id = await connue(m, A);
  const dA = m.dossierDe(A.id);
  assert.equal((await m.act('cle_changer', { cle: id, attente: { ajouter: [{ iso: 'mint' }], retirer: [W] } })).ok, true);
  await appliquer(m, id);
  let v = (await cles(m)).find((x) => x.id === id)!;
  assert.equal(v.travail?.ok, false); assert.match(v.travail!.message, /restent en attente/);
  assert.ok(existsSync(join(dA, 'ISO', MINT)), 'Mint était déjà copié'); assert.ok(existsSync(join(dA, 'ISO', W)), 'Windows pas encore retiré');
  assert.equal(v.changements, 2, 'les deux changements attendent toujours');
  assert.deepEqual(v.contenu!.systemes.map((s) => s.fichier), [W, U, GP], 'Mint reste « à ajouter », pas en double');
  // Ranger encore, puis appliquer : rien n'est refusé.
  const ch = await m.act('cle_changer', { cle: id, attente: { ajouter: [{ iso: 'mint' }], retirer: [W], ordre: [MINT, U, GP] } });
  assert.equal(ch.ok, true, ch.text);
  const r = await appliquer(m, id);
  assert.equal(r.ok, true, r.text);
  v = (await cles(m)).find((x) => x.id === id)!;
  assert.equal(v.travail?.ok, true, v.travail?.message);
  assert.equal(v.attente, null);
  assert.ok(!existsSync(join(dA, 'ISO', W)), 'Windows retiré');
  assert.equal(readFileSync(join(dA, 'ISO', MINT), 'utf8'), 'ISO-MINT');
  assert.deepEqual(JSON.parse(readFileSync(join(dA, 'ventoy/ventoy.json'), 'utf8')).menu_alias.map((a: { image: string }) => a.image), [`/ISO/${MINT}`, `/ISO/${U}`, `/ISO/${GP}`]);
  assert.ok(!tout(dA).some((f) => f.endsWith('.odin-part') || f.endsWith('.odin-neuf')));
  // Une image du même nom qui n'est PAS celle qu'Odin avait copiée : jamais reprise, jamais remplacée.
  const io = G.ioGererSimulee({ 'odin/cle-odin.json': JSON.stringify({ odin: 1, id, cree: 1, maj: 1, systemes: [], modeDefaut: 'graphique', delai: 10 }), [`ISO/${MINT}`]: 'AUTRE CHOSE' });
  const c = G.sansReprises(await G.lireCle(io), { ...sansAttente, ajouter: [{ iso: 'mint', fichier: MINT, nom: 'Mint', taille: 8 }], copies: { [MINT]: 'a'.repeat(64) } });
  const a = G.attenteDe({ ajouter: [{ iso: 'mint' }], copies: { [MINT]: 'a'.repeat(64) } }, c, m.biblio, () => 8).attente!;
  const r2 = await G.appliquerAttente(io, c, a, m.biblio, { verifier: async () => undefined, source: () => '/src/mint.iso', libre: 50 * Go, dejaCopies: { [MINT]: 'a'.repeat(64) } });
  assert.equal(r2.ok, false); assert.match(r2.message, /déjà sur la clé/);
  assert.equal(io.fichiers.get(`ISO/${MINT}`), 'AUTRE CHOSE');
});

test('relecture C5 · retirer un système ne retire pas une mémoire partagée avec un système gardé', async () => {
  const A = cle('cle-a', 'AA11BB227F2A');
  const m = monde({ disques: () => [A] });
  const dA = m.dossierDe(A.id); cleEcrite(dA);
  const vj = JSON.parse(readFileSync(join(dA, 'ventoy/ventoy.json'), 'utf8'));
  vj.persistence.push({ image: `/ISO/${GP}`, backend: '/persistence/ubuntu-24.04-desktop-amd64.dat' });
  writeFileSync(join(dA, 'ventoy/ventoy.json'), JSON.stringify(vj));
  const id = ((await m.act('cle_reconnaitre', { cible: cibleDe(A) })).data as { id: string }).id;
  await cles(m);
  await m.act('cle_changer', { cle: id, attente: { retirer: [U] } });
  assert.equal((await appliquer(m, id)).ok, true);
  assert.equal((await cles(m))[0].travail?.ok, true);
  assert.ok(!existsSync(join(dA, 'ISO', U)), 'Ubuntu retiré');
  assert.equal(readFileSync(join(dA, 'persistence/ubuntu-24.04-desktop-amd64.dat'), 'utf8'), 'MEMOIRE', 'la mémoire que GParted utilise encore est gardée');
});

test('relecture C5 · restes d\'une copie ratée : retirés (si c\'est toujours la même clé), et leur place compte ; la clé revérifiée juste avant la mise en place d\'une image', async () => {
  const id = '9a'.repeat(16);
  const base = { 'odin/cle-odin.json': JSON.stringify({ odin: 1, id, cree: 1, maj: 1, systemes: [], modeDefaut: 'graphique', delai: 10 }), 'ventoy/ventoy.json': '{}', [`ISO/${U}`]: 'ISO-UBUNTU' };
  const biblio = [{ id: 'mint', nom: 'linuxmint-22-cinnamon-64bit', chemin: '/src/mint.iso', recipe: rLive }];
  const brut = { ajouter: [{ iso: 'mint' }] };
  // 1) La copie échoue (clé pleine, erreur d'écriture) : le fichier « à côté » ne reste pas sur la clé.
  let io = G.ioGererSimulee({ ...base }, { libre: 50 * Go, couper: (op, rel) => op === 'mettre-en-place' && rel === `ISO/${MINT}` });
  let c = await G.lireCle(io);
  let r = await G.appliquerAttente(io, c, G.attenteDe(brut, c, biblio, () => 8).attente!, biblio, { verifier: async () => undefined, source: () => '/src/mint.iso' });
  assert.equal(r.ok, false);
  assert.deepEqual([...io.fichiers.keys()].filter((f) => f.endsWith('.odin-part')), [], 'aucun reste (place prise pour rien)');
  // 2) Un vieux reste prend la place : il est retiré AVANT de compter, et sa place compte.
  io = G.ioGererSimulee({ ...base, 'ISO/vieux.iso.odin-part': 'x'.repeat(100) });
  c = await G.lireCle(io);
  r = await G.appliquerAttente(io, c, G.attenteDe(brut, c, biblio, () => 100).attente!, biblio, { verifier: async () => undefined, source: () => '/src/mint.iso', libre: MARGE_CLE + 50 });
  assert.equal(r.ok, true, r.message);
  // 3) La clé change PENDANT la copie (débranchée, une autre rebranchée) : rien n'est mis en place, rien n'est retiré.
  let change = false;
  io = G.ioGererSimulee({ ...base }, { libre: 50 * Go, couper: (op) => { if (op === 'copier-a-cote') change = true; return false; } });
  c = await G.lireCle(io);
  r = await G.appliquerAttente(io, c, G.attenteDe(brut, c, biblio, () => 8).attente!, biblio, { verifier: async () => (change ? 'Ce n\'est plus la même clé (numéro de série ou taille différents).' : undefined), source: () => '/src/mint.iso' });
  assert.equal(r.ok, false); assert.match(r.message, /plus la même clé/);
  assert.ok(!io.ops.includes(`mettre-en-place ISO/${MINT}`), 'l\'image n\'est pas mise en place sur une clé qui n\'est plus la bonne');
  assert.ok(!io.ops.some((x) => x.startsWith('retirer ')), 'et Odin n\'y retire rien');
  assert.equal(io.fichiers.has(`ISO/${MINT}`), false);
});

test('relecture C5 · « Déployer » (lot C4) n\'écrit pas sur une clé que « Mes clés » est en train de changer ; les réponses qui citent un nom venu de la clé sont marquées', async () => {
  const A = cle('cle-a', 'AA11BB227F2A');
  let lacher = () => {};
  const barriere = new Promise<void>((ok) => { lacher = ok; });
  const m = monde({ disques: () => [A], io: (base) => ({ ...base, copierAtomique: async (...a: Parameters<G.IoGerer['copierAtomique']>) => { await barriere; return base.copierAtomique(...a); } }) });
  const id = await connue(m, A);
  await m.act('cle_changer', { cle: id, attente: { ajouter: [{ iso: 'mint' }] } });
  assert.equal((await m.act('cle_appliquer', { cle: id })).ok, true);
  await new Promise((ok) => setTimeout(ok, 30));
  assert.equal(E.CLES_OCCUPEES.has(A.id), true, 'la clé est notée occupée');
  const prep = await E.cleUsb().actions.find((a) => a.id === 'cle_preparer')!.run(m.ctx, { cible: cibleDe(A), systemes: [], phrase: '' });
  assert.equal(prep.ok, false); assert.match(prep.text, /déjà en cours/);
  lacher();
  await G.attendreTravail(id);
  assert.equal(E.CLES_OCCUPEES.has(A.id), false, 'libérée à la fin');
  assert.equal((await cles(m))[0].travail?.ok, true);
  for (const a of m.actions) assert.equal(a.external, true, `${a.id} : sa réponse peut citer un nom venu de la clé`);
});

test('relecture C5 · écriture « Déployer » (lot C4) : deux Linux de la même famille (Ubuntu + Mint, Ubuntu + un live) partagent UN fichier de réponses, la relecture finale passe', async () => {
  const R = (kind: Recipe['kind'], auto = true): Recipe => ({ kind, label: kind, auto, os: 'linux' });
  const socle = { schema: 'gpt', secureBoot: true, label: 'ODIN', theme: 'bleu', texte: 'matrix', disposition: 'eventail', modeDefaut: 'graphique', delai: 5, images: [], vdisks: [], logiciels: [] };
  for (const second of [{ fichier: 'mint.iso', nom: 'Mint', famille: 'Linux', mode: 'installer', recipe: R('casper') }, { fichier: 'arch.iso', nom: 'Arch', famille: 'Linux', mode: 'demarrer', recipe: R('arch', false) }]) {
    const io = E.ioSimulee();
    const prep = { ...socle, systemes: [{ fichier: 'ubuntu.iso', nom: 'Ubuntu', famille: 'Linux', mode: 'installer', recipe: R('ubuntu') }, second] } as unknown as E.PreparationCle;
    const r = await E.ecrireCle(prep, io, E.buildersParDefaut, { cible: 'ODIN', motDePasse: 'MotDePasseEssai-9x!' });
    assert.equal(r.ok, true, `${second.nom} : ${r.message}`);
    const empreintes = new Set(r.manifeste.filter((l) => l.dest === 'odin/user-data').map((l) => l.sha256));
    assert.equal(empreintes.size, 1, 'un seul contenu pour odin/user-data');
  }
});
