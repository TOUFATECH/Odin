// Genèse, Andromède et Hydre · « Par la parole » (maquettes validées « Systèmes » et « Clés USB », lots S11 et C8).
// Une phrase dite va à la bonne appli et à la bonne action, avec le système relu contre la bibliothèque réelle, la clé
// contre les clés vues et les PC contre ceux vus au démarrage réseau ; deux qui conviennent : Odin demande lequel et rien
// ne part. La parole PRÉPARE et propose : elle n'efface aucun PC et n'écrit aucune clé (la phrase tapée et l'appui long
// restent dans la page) ; créer une VM passe par « Créer une VM » et le budget de ce PC, toujours avec ton accord.
// SÛRETÉ DES ESSAIS : dossiers temporaires neufs ; AUCUN vrai disque (liste de disques fausse, la clé est un dossier),
// AUCUN vrai PC (chaque PC qui démarre est simulé par la demande qu'il ferait), AUCUN téléchargement (toute sortie réseau
// est refusée et comptée), AUCUNE vraie VM (QEMU et qemu-img simulés, PC fictif).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { forgetPending, understand } from '../src/valhalla/huginn.ts';
import { tryDirect, type DirectDeps } from '../src/core/direct.ts';
import { systemeVm, type Machine } from '../src/valhalla/ymir/local.ts';
import { demandeVm, essaisVm, hoteVm, MOTS_VM_DITE, taillesDites } from '../src/valhalla/ymir/creation.ts';
import { noterFiche, type FicheIso } from '../src/valhalla/ymir/isos.ts';
import { cibleAvecExclusion, couperDemande, macsDites, motsDits, pcsRecents, relireDit, rienDeNomme, sansAmorce, suitesDeNumeros, type Nommable } from '../src/valhalla/thjalfi/parole-noms.ts';
import { MOTS_PAROLE, TEXTES_PAROLE, type CarteDite, type PreparationDite } from '../src/valhalla/thjalfi/parole.ts';
import type { Disque } from '../src/valhalla/thjalfi/disques.ts';
import type { Module } from '../src/valhalla/types.ts';

const GO = 1024 ** 3;
const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
const origine = { sv: { ...systemeVm }, h: { ...hoteVm }, e: { ...essaisVm }, cle: process.env.BRISINGAMEN_KEY };
after(() => {
  setValhalla(undefined); Object.assign(systemeVm, origine.sv); Object.assign(hoteVm, origine.h); Object.assign(essaisVm, origine.e);
  if (origine.cle === undefined) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = origine.cle;
  for (const d of dossiers) rmSync(d, { recursive: true, force: true });
});
const FIX = join(import.meta.dirname, 'fixtures', 'thjalfi');

const A = '52:54:00:3a:91:0c', B = '52:54:00:7e:12:a4', C = '52:54:00:c1:5b:77';
const part = (montage?: string) => [{ nom: 'p1', label: 'ODIN', fs: 'exfat', tailleOctets: 57 * GO, utiliseOctets: 10 * GO, ...(montage ? { montage } : {}) }, { nom: 'p2', label: 'VTOYEFI', fs: 'vfat', tailleOctets: 32 * 1024 ** 2 }];
const CLE_NEUVE: Disque = { id: 'fausse-cle-64', chemin: 'faux-64', modele: 'Clé Lagon (fausse)', serie: 'LAGON0064AB12', tailleOctets: 58 * GO, genre: 'cle', externe: true, amovible: true, bus: 'usb', estOdin: false, partitions: [] } as Disque;
const CLE_32: Disque = { id: 'fausse-cle-32', chemin: 'faux-32', modele: 'Clé Corail (fausse)', serie: 'CORAIL0032CD34', tailleOctets: 29 * GO, genre: 'cle', externe: true, amovible: true, bus: 'usb', estOdin: false, partitions: [] } as Disque;
const CLE_ODIN: Disque = { id: 'fausse-cle-odin', chemin: 'faux-odin', modele: 'Clé Passe (fausse)', serie: 'PASSE0064EF56', tailleOctets: 58 * GO, genre: 'cle', externe: true, amovible: true, bus: 'usb', estOdin: true, partitions: part('faux-montage') } as Disque;
const INTERNE: Disque = { id: 'faux-interne', chemin: 'faux-1', modele: 'SSD interne (faux)', serie: 'SSD00112233', tailleOctets: 512 * GO, genre: 'interne', externe: false, amovible: false, bus: 'nvme', estOdin: false, partitions: [] } as Disque;

/** Ce qu'une clé écrite par Odin porte (un dossier joue sa partition ODIN). */
function cleEcrite(dir: string) {
  const f = (rel: string, c: string) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), c); };
  f('ISO/memtest86plus-7.20.iso', 'ISO-MEMTEST');
  f('ecran-odin/systemes.json', '{}');
  f('ventoy/ventoy_grub.cfg', 'menuentry "VTOY_RET" --class=vtoyret {\n  echo ""\n}\n');
  f('ventoy/ventoy.json', JSON.stringify({ control: [{ VTOY_DEFAULT_MENU_MODE: '0' }], theme: { file: '/ventoy/theme/odin/theme.txt', display_mode: 'GUI' }, menu_alias: [{ image: '/ISO/memtest86plus-7.20.iso', alias: 'Memtest' }] }, null, 2));
}
const tout = (d: string): string[] => (existsSync(d) ? readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath ?? d, e.name).slice(d.length + 1).replace(/\\/g, '/')).sort() : []);

interface Options { disques?: Disque[]; deuxUbuntu?: boolean; memoirePc?: number }
/** Un Odin d'essai : la bibliothèque d'essai (Ubuntu, Debian, Windows prêts ; Rocky pas encore analysé), des disques faux, un PC fictif. */
async function monde(o: Options = {}) {
  const home = neuf('odin-parole-'), sorties: string[] = [], lancees: string[][] = [], coffre: Array<Record<string, unknown>> = [], vivants = new Set<number>();
  process.env.BRISINGAMEN_KEY = 'cd'.repeat(32);
  let pid = 4000;
  systemeVm.plateforme = () => 'linux'; systemeVm.enVie = (p: number) => vivants.has(p);
  systemeVm.qmp = async () => { throw new Error('essai : pas de QMP ici'); }; systemeVm.dossiersQmp = () => [join(home, 'qmp')];
  hoteVm.coeurs = () => 6; hoteVm.memoire = () => (o.memoirePc ?? 24) * GO; hoteVm.disque = () => ({ total: 500 * GO, libre: 200 * GO });
  essaisVm.ping = async () => true; essaisVm.port = async () => true;
  const run = async (cmd: string, args: string[] = []) => {
    lancees.push([cmd, ...args]);
    if (cmd === 'sh') return { code: /qemu-system-x86_64|qemu-img|\bip$/.test(args[1] ?? '') ? 0 : 1, out: '', err: '' };
    if (cmd === 'ping') return { code: 1, out: '', err: '' };
    if (cmd === 'qemu-img') { writeFileSync(args[3], 'faux disque qcow2'); return { code: 0, out: '', err: '' }; }
    if (cmd === 'qemu-system-x86_64') { const p = ++pid; vivants.add(p); writeFileSync(args[args.indexOf('-pidfile') + 1], String(p)); return { code: 0, out: '', err: '' }; }
    return { code: 0, out: '', err: '' };
  };
  const mods = allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never) as Module[];
  // Le coffre : un espion (rien n'est écrit dans un vrai coffre ; on voit ce qui lui est confié).
  const aj = mods.find((m) => m.id === 'brisingamen')!.actions.find((a) => a.id === 'ajouter')!;
  aj.run = async (_c, i) => { coffre.push(i); return { text: 'ajouté' }; };
  const aucuneSortie = (async (u: unknown) => { sorties.push(String(u)); throw new Error('essai : aucune sortie réseau'); }) as never;
  const v = new Valhalla(home, mods, { run: run as never, fetch: aucuneSortie, notify: async () => {}, autonomy: () => 'equilibre' });
  setValhalla(v);
  const espace = join(home, 'iso'); mkdirSync(espace, { recursive: true });
  for (const f of readdirSync(FIX)) writeFileSync(join(espace, f.replace(/\.gz$/, '')), gunzipSync(readFileSync(join(FIX, f))));
  if (o.deuxUbuntu) copyFileSync(join(espace, 'ubuntu-24.04.3-live-server-amd64.iso'), join(espace, 'ubuntu-24.04.3-desktop-amd64.iso'));
  await v.act('eitri', 'dossier', { chemin: espace });
  await v.act('ymir', 'espace_iso', { dossier: espace });
  const cy = v.ctx('ymir');
  for (const f of ((await v.act('ymir', 'bibliotheque_iso')).data as { isos: FicheIso[] }).isos) {
    const sha = createHash('sha256').update(readFileSync(f.chemin)).digest('hex');
    if (/rocky/i.test(f.nom)) noterFiche(cy, { ...f, sha256: sha, editeur: true, antivirus: { at: 1, verdict: 'non analysé', texte: '' } });
    else noterFiche(cy, { ...f, sha256: sha, editeur: true, antivirus: { at: 1, verdict: 'sain', texte: 'rien trouvé' } });
  }
  const ct = v.ctx('thjalfi');
  ct.saveSettings({ ip: '192.168.1.10', mode: 'aucun', cleDisquesTest: o.disques ?? [CLE_NEUVE, INTERNE] });
  const mod = v.modules().find((m) => m.id === 'thjalfi') as unknown as { serveurSimule: (c: unknown) => { simuler: (m: string, u: string, f: string) => Promise<{ status: number; body: string }> } };
  const h = mod.serveurSimule(ct);
  /** Un PC qui démarre par le réseau (simulé : la demande qu'il ferait au menu). */
  const pc = async (mac: string, q = '', ip = '192.168.1.21') => (await h.simuler('GET', `/menu.ipxe?mac=${mac}&fw=efi${q ? `&${q}` : ''}`, ip)).body;
  const dir = join(home, 'valhalla', 'thjalfi');
  const autorisees = () => { try { return JSON.parse(readFileSync(join(dir, 'deploiements-autorises.json'), 'utf8')) as unknown[]; } catch { return []; } };
  /** La phrase comprise par Logos (« appli.action {réglages} »), et ce qui partirait sans IA quand une IA est là (strict). */
  const dit = async (t: string): Promise<{ compris: string; direct: string }> => {
    const u = await understand(v, t, `p-${Math.random()}`);
    const compris = !u ? '—' : u.kind === 'action' ? `${u.module}.${u.action} ${JSON.stringify(u.input)}${u.doubt ? ' (doute)' : ''}` : u.kind === 'ask' ? `${u.module}.${u.action} ? ${u.missing}` : u.kind;
    const calls: string[] = [];
    const d: DirectDeps = { sessionId: `pd-${Math.random()}`, has: () => true, kv: { getKv: () => undefined, setKv: () => {} },
      run: async (name, input) => { calls.push(name === 'valhalla' ? `${String(input.appli)}.${String(input.quoi)} ${String(input.entree ?? '')}`.trim() : name); return { ok: true, content: 'fait' }; } };
    const r = await tryDirect(t, d); forgetPending(d.sessionId);
    return { compris, direct: r.done ? calls.at(-1) ?? '(réponse)' : `IA · ${r.why}` };
  };
  const carte = (r: { data?: unknown }) => (r.data as { carte: CarteDite }).carte;
  const preparation = async () => ((await v.act('thjalfi', 'preparation_dite')).data as { preparation: PreparationDite | null }).preparation;
  const machines = () => { try { return JSON.parse(readFileSync(join(home, 'valhalla', 'ymir', 'machines', 'machines.json'), 'utf8')) as Machine[]; } catch { return []; } };
  return { v, home, dir, espace, sorties, lancees, coffre, pc, autorisees, dit, carte, preparation, machines, fin: () => { setValhalla(undefined); v.stop(); } };
}
type Monde = Awaited<ReturnType<typeof monde>>;
/** Une clé ODIN connue d'Odin (écrite avant, reconnue par « Mes clés »). */
async function avecCleConnue(w: Monde): Promise<string> {
  cleEcrite(join(w.dir, 'cle-essai', CLE_ODIN.id.replace(/[^\w-]/g, '_')));
  const r = await w.v.act('thjalfi', 'cle_reconnaitre', { cible: { id: CLE_ODIN.id, serie: CLE_ODIN.serie, tailleOctets: CLE_ODIN.tailleOctets, modele: CLE_ODIN.modele } });
  assert.equal(r.ok, true, r.text);
  return (r.data as { id: string }).id;
}

// ---------------------------------------------------------------------------------------------- les règles pures
test('un nom dit est relu contre la liste réelle : un seul convient, sinon Odin demande lequel ; jamais un morceau de mot', () => {
  const l = [{ nom: 'Ubuntu Server 24.04.3', autres: ['ubuntu-24.04.3-live-server-amd64', 'Ubuntu Server'], version: '24.04.3' }, { nom: 'Debian 13.1.0', autres: ['debian-13.1.0-amd64-netinst', 'Debian'], version: '13.1.0' }, { nom: 'Windows 11', autres: ['Win11_24H2_French_x64'], version: '11' }];
  const ok = (d: string, liste: Nommable[] = l) => { const r = relireDit(d, liste); return r.ok ? r.x.nom : `${r.raison}:${r.choix.map((c) => c.nom).join('|')}`; };
  assert.equal(ok('Ubuntu'), 'Ubuntu Server 24.04.3'); assert.equal(ok('ubuntu'), 'Ubuntu Server 24.04.3'); assert.equal(ok('l\'Ubuntu'), 'Ubuntu Server 24.04.3');
  assert.equal(ok('Ubuntu 24.04'), 'Ubuntu Server 24.04.3'); assert.equal(ok('ubuntu server'), 'Ubuntu Server 24.04.3');
  assert.equal(ok('Windows 11'), 'Windows 11'); assert.equal(ok('windows'), 'Windows 11'); assert.equal(ok('le Windows 11'), 'Windows 11');
  assert.equal(ok('la dernière Debian'), 'Debian 13.1.0'); assert.equal(ok('the latest Debian'), 'Debian 13.1.0'); assert.equal(ok('das neueste Debian'), 'Debian 13.1.0'); assert.equal(ok('la última Debian'), 'Debian 13.1.0');
  assert.equal(ok('la dernière version de Debian'), 'Debian 13.1.0');
  // un morceau de mot, une autre version, un autre système : jamais choisi
  assert.equal(ok('ubu'), 'proche:Ubuntu Server 24.04.3'); assert.equal(ok('deb'), 'proche:Debian 13.1.0'); assert.equal(ok('Windows 10'), 'proche:Windows 11');
  assert.equal(ok('Ubuntu 22.04'), 'proche:Ubuntu Server 24.04.3'); assert.equal(ok('Fedora'), 'inconnu:'); assert.equal(ok(''), 'vide:'); assert.equal(ok('la'), 'vide:');
  assert.equal(ok('11'), 'Windows 11', 'un numéro seul qui ne désigne qu\'un nom'); assert.equal(ok('13'), 'Debian 13.1.0');
  // deux qui conviennent : les deux sont rendus, aucun n'est pris
  const deux = [...l, { nom: 'Ubuntu 24.04.3 (bureau)', autres: ['ubuntu-24.04.3-desktop-amd64'], version: '24.04.3' }, { nom: 'Windows 11 (ARM 64)', autres: [] as string[], version: '11' }];
  assert.equal(ok('Ubuntu', deux), 'plusieurs:Ubuntu Server 24.04.3|Ubuntu 24.04.3 (bureau)');
  assert.equal(ok('la dernière Ubuntu', deux), 'plusieurs:Ubuntu Server 24.04.3|Ubuntu 24.04.3 (bureau)', 'même version : « la dernière » ne départage pas');
  assert.equal(ok('Ubuntu Server', deux), 'Ubuntu Server 24.04.3'); assert.equal(ok('Windows 11', deux), 'Windows 11', 'le nom exact passe avant celui qui le contient');
  // « la dernière » : la version la plus haute, seulement si chacune dit la sienne
  const versions = [{ nom: 'Debian 12.9.0', version: '12.9.0' }, { nom: 'Debian 13.1.0', version: '13.1.0' }];
  assert.equal(ok('Debian', versions), 'plusieurs:Debian 12.9.0|Debian 13.1.0'); assert.equal(ok('la dernière Debian', versions), 'Debian 13.1.0');
  assert.equal(ok('la dernière Debian', [{ nom: 'Debian 12.9.0', version: '12.9.0' }, { nom: 'Debian testing' }]), 'plusieurs:Debian 12.9.0|Debian testing');
  assert.deepEqual(motsDits('la dernière version de Debian'), { mots: ['debian'], derniere: true });
});

test('la phrase est coupée en deux : le système, puis la cible (clé ou PC), en français, anglais, espagnol et allemand', () => {
  const c = (t: string, g: 'cle' | 'pcs') => { const x = couperDemande(t, g); return `${x.systeme} | ${x.cible}`; };
  assert.equal(c('Windows 11 sur la clé', 'cle'), 'Windows 11 | '); assert.equal(c('Ubuntu à ma clé', 'cle'), 'Ubuntu | '); assert.equal(c('Ubuntu à ma clé Lagon', 'cle'), 'Ubuntu | Lagon');
  assert.equal(c('installe-moi un système sur la clé', 'cle'), 'un système | '); assert.equal(c('Windows 11 on the USB stick', 'cle'), 'Windows 11 | ');
  assert.equal(c('Ubuntu a mi memoria USB', 'cle'), 'Ubuntu | '); assert.equal(c('Ubuntu zu meinem USB-Stick hinzu', 'cle'), 'Ubuntu | hinzu'); assert.equal(c('Windows 11 auf dem USB-Stick', 'cle'), 'Windows 11 | ');
  assert.equal(c('Ubuntu sur les PC qui viennent de démarrer', 'pcs'), 'Ubuntu | qui viennent de démarrer'); assert.equal(c('Ubuntu on the PCs that just booted', 'pcs'), 'Ubuntu | that just booted');
  assert.equal(c('Ubuntu en los PC que acaban de arrancar', 'pcs'), 'Ubuntu | que acaban de arrancar'); assert.equal(c('Ubuntu auf den PCs die gerade gestartet sind', 'pcs'), 'Ubuntu | die gerade gestartet sind');
  assert.equal(c('Debian sur le poste pc-01', 'pcs'), 'Debian | pc-01'); assert.equal(c('Ubuntu', 'pcs'), 'Ubuntu | ');
  for (const t of ['qui viennent de démarrer', 'that just booted', 'that just started', 'que acaban de arrancar', 'die gerade gestartet sind', 'au menu']) assert.equal(pcsRecents(t), true, t);
  assert.equal(pcsRecents('pc-01'), false); assert.equal(pcsRecents(''), false);
  assert.deepEqual(macsDites('sur 52-54-00-3A-91-0C et 52:54:00:7e:12:a4'), [A, B]);
  assert.equal(sansAmorce('installe-moi un système'), 'un système'); assert.equal(sansAmorce('Ubuntu'), 'Ubuntu');
  for (const t of ['', 'un système', 'a system', 'ein System', 'un sistema', 'le système']) assert.equal(rienDeNomme(t), true, t);
  assert.equal(rienDeNomme('Ubuntu'), false);
});

test('« crée-moi une VM… » : le système, puis les tailles dites après « avec » ; rien d\'autre n\'est deviné', () => {
  const d = (t: string) => { const x = demandeVm(t); return [x.systeme, x.tailles.memoire, x.tailles.disque, x.tailles.cpu, x.tailles.reste].join(' | '); };
  assert.equal(d('crée-moi une VM Ubuntu'), 'Ubuntu |  |  |  | '); assert.equal(d('Ubuntu'), 'Ubuntu |  |  |  | '); assert.equal(d('create a VM with Ubuntu'), 'Ubuntu |  |  |  | ');
  assert.equal(d('crée-moi une VM Ubuntu avec 4 Go de mémoire et 40 Go de disque'), 'Ubuntu | 4 | 40 |  | ');
  assert.equal(d('Debian avec 2 cœurs et 8 Go de RAM'), 'Debian | 8 |  | 2 | '); assert.equal(d('Ubuntu with 8 GB of memory'), 'Ubuntu | 8 |  |  | ');
  assert.equal(d('Ubuntu avec beaucoup de puissance'), 'Ubuntu |  |  |  | beaucoup puissance');
  assert.deepEqual(taillesDites('4 Go de mémoire'), { memoire: 4, reste: '' });
});

// ---------------------------------------------------------------------------------------------- le routage
test('par la parole : chaque phrase va à la bonne appli et à la bonne action, en français, anglais, espagnol et allemand ; sans IA quand une IA est là aussi', async () => {
  const w = await monde();
  try {
    const attendu: Array<[string, string]> = [
      // français (ses mots)
      ['boot-moi la clé', 'thjalfi.cle_dit {}'],
      ['installe-moi un système sur la clé', 'thjalfi.cle_dit {}'],
      ['mets Windows 11 sur la clé', 'thjalfi.cle_mettre_dit {"demande":"Windows 11 sur la clé"}'],
      ['copie Debian sur ma clé USB', 'thjalfi.cle_mettre_dit {"demande":"Debian sur ma clé USB"}'],
      ['déploie Debian sur les postes qui viennent de démarrer', 'thjalfi.deployer_dit {"demande":"Debian sur les postes qui viennent de démarrer"}'],
      ['ajoute Ubuntu à ma clé', 'thjalfi.cle_ajouter_dit {"demande":"Ubuntu à ma clé"}'],
      ['installe Ubuntu sur les PC qui viennent de démarrer', 'thjalfi.deployer_dit {"demande":"Ubuntu sur les PC qui viennent de démarrer"}'],
      ['télécharge la dernière Debian', 'eitri.telecharger {"nom":"debian"}'],
      ['télécharge la dernière version de Debian', 'eitri.telecharger {"nom":"debian"}'],
      ['fais-moi une clé bootable', 'thjalfi.cle_dit {}'],
      ['installe Debian sur le poste pc-01', 'thjalfi.deployer_dit {"demande":"Debian sur le poste pc-01"}'],
      ['où en est le travail ?', 'thjalfi.travaux_dit {}'],
      // anglais
      ['make the USB stick bootable', 'thjalfi.cle_dit {}'],
      ['install a system on the USB stick', 'thjalfi.cle_dit {}'],
      ['put Windows 11 on the USB stick', 'thjalfi.cle_mettre_dit {"demande":"Windows 11 on the USB stick"}'],
      ['add Ubuntu to my USB stick', 'thjalfi.cle_ajouter_dit {"demande":"Ubuntu to my USB stick"}'],
      ['install Ubuntu on the PCs that just booted', 'thjalfi.deployer_dit {"demande":"Ubuntu on the PCs that just booted"}'],
      ['download the latest Debian', 'eitri.telecharger {"nom":"debian"}'],
      ['how is the work going?', 'thjalfi.travaux_dit {}'],
      // espagnol
      ['haz la memoria USB arrancable', 'thjalfi.cle_dit {}'],
      ['instala un sistema en la memoria USB', 'thjalfi.cle_dit {}'],
      ['pon Windows 11 en la memoria USB', 'thjalfi.cle_mettre_dit {"demande":"Windows 11 en la memoria USB"}'],
      ['añade Ubuntu a mi memoria USB', 'thjalfi.cle_ajouter_dit {"demande":"Ubuntu a mi memoria USB"}'],
      ['instala Ubuntu en los PC que acaban de arrancar', 'thjalfi.deployer_dit {"demande":"Ubuntu en los PC que acaban de arrancar"}'],
      ['descarga la última Debian', 'eitri.telecharger {"nom":"debian"}'],
      ['cómo va el trabajo?', 'thjalfi.travaux_dit {}'],
      // allemand
      ['mach den USB-Stick bootfähig', 'thjalfi.cle_dit {}'],
      ['installiere ein System auf dem USB-Stick', 'thjalfi.cle_dit {}'],
      ['installiere Windows 11 auf dem USB-Stick', 'thjalfi.cle_mettre_dit {"demande":"Windows 11 auf dem USB-Stick"}'],
      ['füge Ubuntu zu meinem USB-Stick hinzu', 'thjalfi.cle_ajouter_dit {"demande":"Ubuntu zu meinem USB-Stick hinzu"}'],
      ['installiere Ubuntu auf den PCs die gerade gestartet sind', 'thjalfi.deployer_dit {"demande":"Ubuntu auf den PCs die gerade gestartet sind"}'],
      ['lade das neueste Debian herunter', 'eitri.telecharger {"nom":"debian"}'],
      ['wie weit ist die Arbeit?', 'thjalfi.travaux_dit {}'],
      // japonais : une écriture sans espaces ; seules les phrases entières sans nom à relire sont lues
      ['USBメモリを起動用にして', 'thjalfi.cle_dit {}'],
      ['インストールの進捗は？', 'thjalfi.travaux_dit {}'],
    ];
    const faux: string[] = [];
    for (const [t, a] of attendu) {
      const r = await w.dit(t);
      if (r.compris !== a) faux.push(`« ${t} » compris ${r.compris} (attendu ${a})`);
      else if (r.direct !== a) faux.push(`« ${t} » sans IA : ${r.direct} (attendu ${a})`);
    }
    // créer une VM : la bonne action d'Hydre, et le système dans la demande (le verbe et « une VM » tombent à la relecture)
    for (const t of ['crée-moi une VM Ubuntu', 'crée une machine virtuelle Ubuntu', 'create a VM with Ubuntu', 'crea una VM Ubuntu', 'erstelle eine VM Ubuntu']) {
      const r = await w.dit(t), m = /^ymir\.creer_vm_dit \{"demande":"(.*)"\}$/.exec(r.compris);
      if (!m || demandeVm(m[1]).systeme !== 'Ubuntu') faux.push(`« ${t} » compris ${r.compris}`);
      else if (r.direct !== r.compris) faux.push(`« ${t} » sans IA : ${r.direct}`);
    }
    assert.deepEqual(faux, [], `${attendu.length + 5 - faux.length}/${attendu.length + 5}`);
    // rien n'est parti (on regarde seulement ce qui serait compris) : ni PC autorisé, ni VM, ni téléchargement
    assert.deepEqual(w.autorisees(), []); assert.deepEqual(w.machines(), []); assert.deepEqual(w.sorties, []); assert.equal(await w.preparation(), null);
  } finally { w.fin(); }
});

test('par la parole : les phrases des autres applis et des anciennes actions restent à elles', async () => {
  const w = await monde();
  try {
    const reste: Array<[string, RegExp]> = [
      ['clé usb', /^thjalfi\.cle_disques/], ['mes clés', /^thjalfi\.cle_mes_cles/], ['où en est la clé', /^thjalfi\.cle_progres/], ['allume le pxe', /^thjalfi\.allumer/],
      ['machines en cours de déploiement', /^thjalfi\.machines/], ['historique des déploiements', /^thjalfi\.historique/],
      ['crée une machine', /^ymir\.creer_machine/], ['crée un lxc', /^ymir\.creer_machine/],
      ['catalogue des iso', /^eitri\.catalogue/], ['état des iso', /^eitri\.etat/],
    ];
    for (const [t, re] of reste) { const r = await w.dit(t); assert.match(r.compris, re, t); }
    // des mots de tous les jours : ni Genèse ni Hydre ne les prennent pour un geste dit
    const DITS = /^(thjalfi\.(cle_dit|cle_mettre_dit|cle_ajouter_dit|deployer_dit|travaux_dit)|ymir\.creer_vm_dit)/;
    // (pour les logiciels d'Hermès, « la dernière version de … » reste une demande pour une IA, comme avant)
    assert.doesNotMatch((await w.dit('Télécharge la dernière version de Node')).direct, /telecharger/);
    for (const t of ['retrouve la clé du wifi', 'ajoute du lait à ma liste de courses', 'installe Firefox', 'mets la lumière du salon', 'où en est ma commande', 'démarre la vm web', 'arrête la machine web', 'liste des vm',
      'télécharge Firefox', 'mets à jour les iso', 'quelle heure est-il', 'installe le conteneur nginx', 'ajoute une note', 'éteins le pc du salon', 'où en est wiki', 'combien de systèmes sur la clé ?'])
      assert.doesNotMatch((await w.dit(t)).direct, DITS, t);
  } finally { w.fin(); }
});

// ---------------------------------------------------------------------------------------------- les PC du réseau
test('« installe Ubuntu sur les PC qui viennent de démarrer » : système relu, PC VUS au menu, « Vérifier » préparé — rien n\'est autorisé ni effacé', async () => {
  const w = await monde();
  try {
    await w.pc(A, 'serie=PC1A2B3C&uuid=4c4c4544-0042-3510-8051-b4c04f4e3732'); await w.pc(B, '', '192.168.1.22'); await w.pc(C, '', '192.168.1.23');
    w.v.ctx('thjalfi').saveSettings({ bloques: { [C]: { at: 1, raison: 'prêté' } } });
    const r = await w.v.act('thjalfi', 'deployer_dit', { demande: 'Ubuntu sur les PC qui viennent de démarrer' });
    assert.equal(r.ok, true, r.text);
    const c = w.carte(r);
    assert.equal(c.etat, 'prepare'); assert.deepEqual(c.ouvrir, { appli: 'thjalfi', onglet: 'deployer', etape: 'verifier' });
    assert.match(r.text, /Prêt à vérifier : Ubuntu Server 24\.04\.3 sur 2 PC \(effacer et installer\)/);
    assert.match(r.text, new RegExp(A)); assert.match(r.text, new RegExp(B)); assert.doesNotMatch(r.text, new RegExp(C), 'un PC bloqué n\'est pas pris');
    assert.match(r.text, /Rien n'est autorisé, rien n'est effacé\./); assert.ok(r.text.includes(TEXTES_PAROLE.verifierPcs)); assert.ok(r.text.includes(TEXTES_PAROLE.jamais));
    // la phrase de la page n'est jamais donnée par la parole
    assert.doesNotMatch(JSON.stringify(r), /effacer \d+ pc/i);
    const p = (await w.preparation())!;
    assert.equal(p.sorte, 'reseau'); assert.equal(p.facon, 'auto'); assert.deepEqual(p.pcs!.map((x) => x.mac).sort(), [A, B].sort()); assert.equal(p.systemes[0].iso, 'ubuntu-24-04-3-live-server-amd64');
    // RIEN n'est autorisé : aucun PC ne s'installerait, aucun mot de passe n'est rangé
    assert.deepEqual(w.autorisees(), []); assert.deepEqual(w.coffre, []);
    assert.doesNotMatch(await w.pc(A), /autoinstall|ds=nocloud/, 'le PC retrouve le menu, pas une installation');
    // les autres langues donnent la même préparation
    for (const d of ['Ubuntu on the PCs that just booted', 'Ubuntu en los PC que acaban de arrancar', 'Ubuntu auf den PCs die gerade gestartet sind']) {
      const x = await w.v.act('thjalfi', 'deployer_dit', { demande: d }); assert.equal(x.ok, true, d); assert.deepEqual((await w.preparation())!.pcs!.map((y) => y.mac).sort(), [A, B].sort(), d);
    }
    // une adresse écrite : seulement un PC déjà vu ; un nom dit : relu contre les PC vus
    const un = await w.v.act('thjalfi', 'deployer_dit', { demande: `Debian sur le PC ${A}` });
    assert.equal(un.ok, true, un.text); assert.deepEqual((await w.preparation())!.pcs!.map((x) => x.mac), [A]); assert.match(un.text, /Debian 13\.1\.0 sur 1 PC/);
    const inconnu = await w.v.act('thjalfi', 'deployer_dit', { demande: 'Debian sur le PC 52:54:00:99:99:99' });
    assert.equal(inconnu.ok, false); assert.match(inconnu.text, /Odin n'a jamais vu au démarrage réseau : 52:54:00:99:99:99/);
    assert.match((await w.v.act('thjalfi', 'deployer_dit', { demande: `Debian sur le PC ${C}` })).text, /Bloqué dans Genèse/);
    assert.match((await w.v.act('thjalfi', 'deployer_dit', { demande: 'Debian sur le PC bureau-de-papa' })).text, /Je ne connais pas « bureau papa »|Je ne connais pas « bureau de papa »/);
    // Windows par le réseau, sans partage réglé, un outil qui ne s'installe pas seul : dit, rien d'effacé
    const mem = await w.v.act('thjalfi', 'deployer_dit', { demande: 'Memtest sur les PC qui viennent de démarrer' });
    if (mem.ok) assert.equal((await w.preparation())!.facon, 'menu', 'un outil est proposé au menu, sans rien effacer');
    assert.deepEqual(w.autorisees(), []); assert.deepEqual(w.sorties, []);
  } finally { w.fin(); }
});

test('déployer par la parole : deux systèmes qui conviennent → Odin demande lequel ; absent mais au catalogue → téléchargement proposé ; aucun PC → rien', async () => {
  const w = await monde({ deuxUbuntu: true });
  try {
    await w.pc(A);
    const deux = await w.v.act('thjalfi', 'deployer_dit', { demande: 'Ubuntu sur les PC qui viennent de démarrer' });
    assert.equal(deux.ok, false); assert.match(deux.text, /Plusieurs systèmes conviennent pour « ubuntu » : « .* » ou « .* »\. Lequel \? Rien n'est fait\./);
    assert.equal(w.carte(deux).propositions.length, 2); assert.equal(await w.preparation(), null, 'rien n\'est préparé');
    // le nom dit en entier lève le doute
    const un = await w.v.act('thjalfi', 'deployer_dit', { demande: 'Ubuntu Server sur les PC qui viennent de démarrer' });
    assert.equal(un.ok, true, un.text); assert.equal((await w.preparation())!.systemes[0].nom, 'Ubuntu Server 24.04.3');
    w.v.ctx('thjalfi').saveSettings({ preparationDite: null });
    // pas dans la bibliothèque, mais Andromède sait le télécharger : PROPOSÉ, jamais lancé
    const f = await w.v.act('thjalfi', 'deployer_dit', { demande: 'Arch Linux sur les PC qui viennent de démarrer' });
    assert.equal(f.ok, false); assert.match(f.text, /« arch linux » n'est pas dans ta bibliothèque\. Andromède sait le télécharger : Arch Linux\. Rien n'est fait\./);
    assert.deepEqual(w.carte(f).propositions.map((p) => [p.appli, p.action, p.input]), [['eitri', 'telecharger', { nom: 'arch' }]]);
    // plusieurs au catalogue : lesquels ; rien nulle part : dit
    assert.match((await w.v.act('thjalfi', 'deployer_dit', { demande: 'Fedora sur les PC qui viennent de démarrer' })).text, /Le catalogue d'Andromède a « Fedora .* » ou « Fedora .* »\. Lequel \?/);
    assert.match((await w.v.act('thjalfi', 'deployer_dit', { demande: 'Solaris sur les PC qui viennent de démarrer' })).text, /Je ne connais pas « solaris » dans ta bibliothèque\. Rien n'est fait\. Prêts : /);
    // dans la bibliothèque mais pas encore prêt (antivirus pas passé)
    assert.match((await w.v.act('thjalfi', 'deployer_dit', { demande: 'Rocky sur les PC qui viennent de démarrer' })).text, /est dans ta bibliothèque, mais pas encore prêt/);
    // sans système : Odin propose ; sans PC au menu : rien
    const sans = await w.v.act('thjalfi', 'deployer_dit', { demande: 'un système sur les PC qui viennent de démarrer' });
    assert.equal(sans.ok, false); assert.match(sans.text, /Quel système installer \?/); assert.ok(w.carte(sans).propositions.length >= 3);
    assert.equal(await w.preparation(), null); assert.deepEqual(w.autorisees(), []); assert.deepEqual(w.sorties, [], 'aucun téléchargement lancé');
  } finally { w.fin(); }
  const v = await monde();
  try {
    const r = await v.v.act('thjalfi', 'deployer_dit', { demande: 'Ubuntu sur les PC qui viennent de démarrer' });
    assert.equal(r.ok, false); assert.match(r.text, /Genèse est éteint : aucun PC ne peut être vu|Aucun PC n'attend au menu/); assert.match(r.text, /Rien n'est autorisé, rien n'est effacé\./);
    assert.equal(await v.preparation(), null);
  } finally { v.fin(); }
});

// ---------------------------------------------------------------------------------------------- les clés
test('« boot-moi la clé » : Odin montre la clé vue et propose (le plus récent d\'abord, puis « Je choisis moi-même ») ; jamais un disque interne ; rien d\'écrit', async () => {
  const w = await monde();
  try {
    const r = await w.v.act('thjalfi', 'cle_dit');
    assert.equal(r.ok, true, r.text);
    const c = w.carte(r);
    assert.equal(c.etat, 'a-choisir'); assert.match(r.text, /Clé vue : Clé Lagon \(fausse\) · 58 Go · ce qui est dessus sera effacé, seulement après la phrase tapée dans la page/);
    assert.doesNotMatch(r.text, /SSD interne/); assert.doesNotMatch(JSON.stringify(r), /LAGON0064AB12/, 'le numéro de série n\'est pas dans la carte');
    assert.equal(c.propositions.filter((p) => p.conseille).length, 1); assert.equal(c.propositions[0].conseille, true); assert.equal(c.propositions.at(-1)!.label, TEXTES_PAROLE.moiMeme);
    assert.ok(c.propositions.some((p) => p.dire === 'mets Windows 11 sur la clé')); assert.ok(!c.propositions.some((p) => /Rocky/.test(p.label)), 'un système pas prêt n\'est pas proposé');
    // chaque proposition dite revient à la bonne action
    for (const p of c.propositions.filter((x) => x.dire)) assert.match((await w.dit(p.dire!)).compris, /^thjalfi\.cle_mettre_dit /, p.dire);
    assert.equal(await w.preparation(), null); assert.equal(existsSync(join(w.dir, 'cle-essai')), false);
  } finally { w.fin(); }
  const s = await monde({ disques: [INTERNE] });
  try {
    const r = await s.v.act('thjalfi', 'cle_dit');
    assert.match(r.text, /Aucune clé USB vue\. Branche-la, puis redis-le\. \(Un disque interne n'est jamais proposé\.\)/);
    assert.match((await s.v.act('thjalfi', 'cle_mettre_dit', { demande: 'Windows 11 sur la clé' })).text, /Windows 11 est prêt\. Aucune clé USB vue/);
    assert.equal(await s.preparation(), null);
  } finally { s.fin(); }
});

test('« mets Windows 11 sur la clé » : système et clé relus, « Vérifier » préparé ; deux clés → laquelle ; rien n\'est écrit par la parole', async () => {
  const w = await monde();
  try {
    const r = await w.v.act('thjalfi', 'cle_mettre_dit', { demande: 'Windows 11 sur la clé' });
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /Prêt à vérifier : Windows 11 sur Clé Lagon \(fausse\) \(58 Go\)\./); assert.match(r.text, /Rien n'est écrit sur la clé\./); assert.ok(r.text.includes(TEXTES_PAROLE.verifierCle));
    assert.deepEqual(w.carte(r).ouvrir, { appli: 'thjalfi', onglet: 'cle', etape: 'verifier' });
    assert.doesNotMatch(JSON.stringify(r), /effacer la cl|écrire sur la cl/i, 'la phrase de la page n\'est pas donnée');
    assert.doesNotMatch(JSON.stringify(r), /LAGON0064AB12/, 'le numéro de série reste chez Odin');
    const p = (await w.preparation())!;
    assert.equal(p.sorte, 'cle'); assert.equal(p.cle!.id, CLE_NEUVE.id); assert.equal((p.cle as Record<string, unknown>).serie, undefined, 'le numéro de série ne sort pas, même pour la page'); assert.equal((p.cle as Record<string, unknown>).empreinte, undefined); assert.equal(p.systemes[0].iso, 'win11-24h2-french-x64');
    // aucune écriture : ni dossier de clé d'essai, ni demande d'écriture au journal
    assert.equal(existsSync(join(w.dir, 'cle-essai')), false);
    assert.deepEqual(((await w.v.act('thjalfi', 'cle_journal')).data as { lignes: unknown[] }).lignes, []);
    assert.match((await w.v.act('thjalfi', 'cle_progres', { cible: { id: CLE_NEUVE.id } })).text, /Aucune écriture en cours/);
    // « installe-moi un système sur la clé » arrivé ici : comme « boot-moi la clé », Odin propose
    const prop = await w.v.act('thjalfi', 'cle_mettre_dit', { demande: 'installe-moi un système sur la clé' });
    assert.equal(w.carte(prop).etat, 'a-choisir'); assert.match(prop.text, /Quel système veux-tu y mettre \?/);
    assert.match((await w.v.act('thjalfi', 'cle_mettre_dit', { demande: 'Windows 10 sur la clé' })).text, /Je ne connais pas « windows 10 » tel quel dans ta bibliothèque\. Tu parles de « Windows 11 » \?/);
  } finally { w.fin(); }
  const d = await monde({ disques: [CLE_NEUVE, CLE_32, INTERNE] });
  try {
    const r = await d.v.act('thjalfi', 'cle_mettre_dit', { demande: 'Windows 11 sur la clé' });
    assert.equal(r.ok, false); assert.match(r.text, /Plusieurs clés sont branchées\. Laquelle \? Rien n'est fait\./); assert.equal(d.carte(r).propositions.length, 2); assert.equal(await d.preparation(), null);
    const lagon = await d.v.act('thjalfi', 'cle_mettre_dit', { demande: 'Windows 11 sur la clé Lagon' });
    assert.equal(lagon.ok, true, lagon.text); assert.equal((await d.preparation())!.cle!.id, CLE_NEUVE.id);
    const taille = await d.v.act('thjalfi', 'cle_mettre_dit', { demande: 'Windows 11 sur la clé 29 Go' });
    assert.equal(taille.ok, true, taille.text); assert.equal((await d.preparation())!.cle!.id, CLE_32.id);
    assert.match((await d.v.act('thjalfi', 'cle_mettre_dit', { demande: 'Windows 11 sur la clé Kingston' })).text, /Je ne connais pas « kingston » parmi les clés branchées/);
    // dans l'autre monde, le disque interne n'a jamais été proposé
    assert.doesNotMatch(JSON.stringify(d.carte(r)), /SSD interne/);
  } finally { d.fin(); }
});

test('« ajoute Ubuntu à ma clé » : un changement EN ATTENTE sur la clé ODIN connue (le geste de « Mes clés ») ; rien n\'est écrit, rien n\'est armé', async () => {
  const w = await monde({ disques: [CLE_ODIN, INTERNE] });
  try {
    // sans clé connue : Odin n'ajoute rien à une clé qu'il n'a pas faite
    const rien = await w.v.act('thjalfi', 'cle_ajouter_dit', { demande: 'Ubuntu à ma clé' });
    assert.equal(rien.ok, false); assert.match(rien.text, /Odin ne connaît encore aucune clé ODIN/);
    const id = await avecCleConnue(w), dossier = join(w.dir, 'cle-essai', CLE_ODIN.id.replace(/[^\w-]/g, '_')), avant = tout(dossier);
    const r = await w.v.act('thjalfi', 'cle_ajouter_dit', { demande: 'Ubuntu à ma clé' });
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /Ubuntu Server 24\.04\.3 sera ajouté à « .* »\./); assert.match(r.text, /1 changement en attente ; rien n'est écrit pour l'instant\./); assert.ok(r.text.includes(TEXTES_PAROLE.appliquer));
    assert.equal(w.carte(r).etat, 'attente');
    type Vue = { id?: string; etat: string; changements?: number; armeValide?: boolean; attente?: { arme: boolean; ajouter: Array<{ iso: string }> } };
    const vue = async () => ((await w.v.act('thjalfi', 'cle_mes_cles')).data as { cles: Vue[] }).cles.find((x) => x.id === id)!;
    let k = await vue();
    assert.equal(k.changements, 1); assert.equal(k.attente!.arme, false, 'la parole ne donne jamais l\'accord « au prochain branchement »'); assert.equal(k.armeValide, false);
    assert.deepEqual(k.attente!.ajouter.map((x) => x.iso), ['ubuntu-24-04-3-live-server-amd64']);
    // un second ajout garde le premier ; le même système deux fois : pas de doublon ; déjà sur la clé : refusé par « Mes clés »
    const deux = await w.v.act('thjalfi', 'cle_ajouter_dit', { demande: 'Debian à ma clé' });
    assert.equal(deux.ok, true, deux.text); k = await vue(); assert.equal(k.changements, 2); assert.deepEqual(k.attente!.ajouter.map((x) => x.iso).sort(), ['debian-13-1-0-amd64-netinst', 'ubuntu-24-04-3-live-server-amd64']);
    await w.v.act('thjalfi', 'cle_ajouter_dit', { demande: 'Ubuntu à ma clé' }); assert.equal((await vue()).changements, 2);
    const deja = await w.v.act('thjalfi', 'cle_ajouter_dit', { demande: 'Memtest à ma clé' });
    assert.equal(deja.ok, false); assert.match(deja.text, /déjà sur cette clé/); assert.equal((await vue()).changements, 2);
    // autres langues, et le nom de la clé dit
    for (const dm of ['Windows 11 to my USB stick', 'Windows 11 a mi memoria USB', 'Windows 11 zu meinem USB-Stick hinzu', 'Windows 11 à ma clé Passe']) {
      await w.v.act('thjalfi', 'cle_changer', { cle: id, vider: true });
      const x = await w.v.act('thjalfi', 'cle_ajouter_dit', { demande: dm }); assert.equal(x.ok, true, `${dm} : ${x.text}`); assert.deepEqual((await vue()).attente!.ajouter.map((y) => y.iso), ['win11-24h2-french-x64'], dm);
    }
    assert.match((await w.v.act('thjalfi', 'cle_ajouter_dit', { demande: 'Windows 11 à ma clé Kingston' })).text, /Je ne connais pas « kingston » parmi tes clés ODIN/);
    assert.match((await w.v.act('thjalfi', 'cle_ajouter_dit', { demande: 'un système à ma clé' })).text, /Quel système ajouter à « /);
    // RIEN n'a été écrit sur la clé : mêmes fichiers qu'avant (seul le registre d'Odin a changé)
    assert.deepEqual(tout(dossier), avant); assert.equal(await w.preparation(), null); assert.deepEqual(w.sorties, []);
  } finally { w.fin(); }
});

// ---------------------------------------------------------------------------------------------- la VM
test('« crée-moi une VM Ubuntu » : Odin propose le nom et les tailles, demande toujours l\'accord, puis crée par « Créer une VM » dans le budget de ce PC', async () => {
  const w = await monde();
  try {
    const a = w.v.action('ymir', 'creer_vm_dit')!.a, ctx = w.v.ctx('ymir');
    assert.equal(a.proprietaireSeul, true);
    const g = String(a.grave!({ demande: 'crée-moi une VM Ubuntu' }, ctx));
    assert.match(g, /^créer la VM vm-ubuntu-server-1 avec Ubuntu Server 24\.04\.3 : 2 processeur\(s\), 2 Go de mémoire, 20 Go de disque, sur le réseau des machines, installation à la main$/);
    assert.match(String(a.grave!({ demande: 'Ubuntu' })), /^créer une VM depuis le système dit/, 'sans ses réglages : la confirmation quand même');
    // par la discussion : jamais sans la confirmation
    const q = await w.v.order('crée-moi une VM Ubuntu', 'vm-dite');
    assert.equal(q.ok, false); assert.equal(q.confirm, g); assert.deepEqual(w.machines(), []);
    const r = await w.v.order('crée-moi une VM Ubuntu', 'vm-dite', { confirm: true });
    assert.equal(r.ok, true, r.text);
    const m = w.machines(); assert.equal(m.length, 1); assert.equal(m[0].nom, 'vm-ubuntu-server-1'); assert.equal(m[0].genre, 'vm'); assert.equal(m[0].ram, 2 * 1024); assert.equal(m[0].disque, 20); assert.equal(m[0].cpu, 2);
    assert.match(m[0].iso ?? '', /ubuntu-24\.04\.3-live-server-amd64\.iso$/); assert.deepEqual(w.coffre, [], 'installation à la main : aucun mot de passe créé');
    // les tailles dites : dans la confirmation, puis vérifiées par le budget
    assert.match(String(a.grave!({ demande: 'Debian avec 4 Go de mémoire et 30 Go de disque' }, ctx)), /^créer la VM vm-debian-1 avec Debian 13\.1\.0 : 2 processeur\(s\), 4 Go de mémoire, 30 Go de disque/);
    // au-delà de ce que ce PC peut donner : refus avec les chiffres, sans confirmation pour rien, rien de créé
    assert.equal(a.grave!({ demande: 'Debian avec 64 Go de mémoire' }, ctx), undefined);
    const trop = await w.v.act('ymir', 'creer_vm_dit', { demande: 'Debian avec 64 Go de mémoire' });
    assert.equal(trop.ok, false); assert.match(trop.text, /Refusé, rien n'est créé : ce PC ne peut pas le donner/); assert.equal(w.machines().length, 1);
    // un nom qui ne désigne pas un seul système prêt : rien ne part, aucune confirmation
    for (const [d, re] of [['Fedora', /Je ne connais pas « fedora » dans la bibliothèque\. Rien n'est créé\. Systèmes prêts : /], ['Rocky', /Rocky Linux 9 9\.6 : .*pas encore prêt\. Rien n'est créé\./], ['Windows 10', /Tu parles de « Windows 11 » \?/], ['Ubuntu avec beaucoup de puissance', /Je n'ai pas compris « beaucoup puissance »/]] as const) {
      assert.equal(a.grave!({ demande: d }, ctx), undefined, d);
      const x = await w.v.act('ymir', 'creer_vm_dit', { demande: d }); assert.equal(x.ok, false, d); assert.match(x.text, re, d);
    }
    // ni un membre, ni une automatisation
    for (const o of [{ qui: 'member' }, { auto: true, by: 'automatisation' }]) assert.match((await w.v.act('ymir', 'creer_vm_dit', { demande: 'Debian' }, o as never)).text, /seul le propriétaire/);
    assert.equal(w.machines().length, 1); assert.deepEqual(w.sorties, []);
  } finally { w.fin(); }
});

test('créer une VM par la parole : deux systèmes qui conviennent → Odin demande lequel ; au-delà du seuil → l\'accord du budget est dans la confirmation', async () => {
  const w = await monde({ deuxUbuntu: true });
  try {
    const a = w.v.action('ymir', 'creer_vm_dit')!.a, ctx = w.v.ctx('ymir');
    assert.equal(a.grave!({ demande: 'Ubuntu' }, ctx), undefined);
    const r = await w.v.act('ymir', 'creer_vm_dit', { demande: 'Ubuntu' });
    assert.equal(r.ok, false); assert.match(r.text, /Plusieurs systèmes conviennent pour « ubuntu » : « .* » ou « .* »\. Lequel \? Rien n'est créé\./); assert.deepEqual(w.machines(), []);
    assert.match(String(a.grave!({ demande: 'Ubuntu Server' }, ctx)), /avec Ubuntu Server 24\.04\.3/);
    // 8 Go : au-delà du seuil sans accord (4 Go) : la raison du budget s'ajoute à la confirmation
    const gros = String(a.grave!({ demande: 'Ubuntu Server avec 8 Go de mémoire' }, ctx));
    assert.match(gros, /8 Go de mémoire.* — .*8 Go/);
    assert.equal(gros.endsWith(String(w.v.action('ymir', 'creer_vm')!.a.grave!({ nom: 'vm-ubuntu-server-1', coeurs: 2, memoire: 8, disque: 20 }, ctx)).replace(/^créer la VM vm-ubuntu-server-1 : /, '')), true, 'le même texte d\'accord que « Créer une VM »');
  } finally { w.fin(); }
});

// ---------------------------------------------------------------------------------------------- suivi et sûreté
test('« où en est le travail » : une carte de suivi (ce qui est préparé, les changements de clé en attente), sans secret ; « télécharge » reste au propriétaire', async () => {
  const w = await monde({ disques: [CLE_ODIN, INTERNE] });
  try {
    const vide = await w.v.act('thjalfi', 'travaux_dit');
    assert.equal(vide.ok, true, vide.text); assert.equal(w.carte(vide).etat, 'rien'); assert.match(vide.text, /Aucun travail en cours : ni clé, ni PC, ni téléchargement\./);
    await avecCleConnue(w); await w.pc(A);
    await w.v.act('thjalfi', 'cle_ajouter_dit', { demande: 'Ubuntu à ma clé' });
    await w.v.act('thjalfi', 'deployer_dit', { demande: 'Debian sur les PC qui viennent de démarrer' });
    const r = await w.v.act('thjalfi', 'travaux_dit');
    assert.match(r.text, /Préparé par la parole, à vérifier dans la page : Debian 13\.1\.0 sur 1 PC/); assert.match(r.text, /1 changement\(s\) en attente \(clé branchée : « Appliquer » dans Mes clés\)/);
    assert.deepEqual(w.carte(r).suivi, { appli: 'thjalfi', action: 'travaux_dit' });
    assert.doesNotMatch(JSON.stringify(r), /PASSE0064EF56|mot de passe|mdp/i);
    // une préparation dite ne vaut que 30 minutes
    const p = (await w.preparation())!; w.v.ctx('thjalfi').saveSettings({ preparationDite: { ...p, expire: Date.now() - 1 } }); assert.equal(await w.preparation(), null);
    // gestes et lectures de la parole : au propriétaire seul (disques, PC, adresses)
    for (const id of ['cle_dit', 'cle_mettre_dit', 'cle_ajouter_dit', 'deployer_dit', 'travaux_dit', 'preparation_dite']) {
      assert.equal(w.v.action('thjalfi', id)!.a.proprietaireSeul, true, id); assert.equal(w.v.action('thjalfi', id)!.a.external, true, id);
      for (const o of [{ qui: 'member' }, { auto: true, by: 'automatisation' }]) { const x = await w.v.act('thjalfi', id, { demande: 'Ubuntu sur la clé' }, o as never); assert.equal(x.ok, false, id); assert.equal(x.data, undefined, id); }
    }
    assert.equal(w.v.action('eitri', 'telecharger')!.a.proprietaireSeul, true);
    assert.match((await w.v.act('eitri', 'telecharger', { nom: 'debian' }, { qui: 'member' } as never)).text, /seul le propriétaire/);
    // aucune action dite n'efface ni n'écrit : pas de confirmation à donner par la parole (rien de grave à valider)
    for (const id of ['cle_dit', 'cle_mettre_dit', 'cle_ajouter_dit', 'deployer_dit']) assert.equal(w.v.action('thjalfi', id)!.a.grave, undefined, id);
    assert.deepEqual(w.autorisees(), []); assert.deepEqual(w.sorties, []);
  } finally { w.fin(); }
});

test('les mots de la parole : seulement des expressions de plusieurs mots — jamais un verbe seul ni un mot courant seul', () => {
  for (const [k, l] of Object.entries(MOTS_PAROLE)) for (const m of l) assert.ok(m.trim().includes(' ') || /[^\x00-\x7f]{3}/.test(m), `${k} : « ${m} » est un mot seul`);
  for (const m of MOTS_VM_DITE) assert.ok(m.trim().includes(' '), m);
});

// ---------------------------------------------------------------------------------------------- relecture adverse
test('relecture : un numéro dit est le DÉBUT du numéro du nom ; « la dernière » ne départage que deux versions du même système', () => {
  const l = [{ nom: 'Ubuntu Server 24.04.3', autres: ['ubuntu-24.04.3-live-server-amd64', 'Ubuntu Server'], version: '24.04.3' }, { nom: 'Debian 13.1.0', autres: ['debian-13.1.0-amd64-netinst', 'Debian'], version: '13.1.0' },
    { nom: 'Ubuntu 22.04 (bureau)', autres: ['ubuntu-22.04-desktop-amd64'], version: '22.04' }, { nom: 'Windows 11', autres: ['Win11_24H2_French_x64'], version: '11' }];
  const ok = (d: string) => { const r = relireDit(d, l); return r.ok ? r.x.nom : `${r.raison}:${r.choix.map((c) => c.nom).join('|')}`; };
  // un numéro pris au milieu ne désigne rien
  assert.equal(ok('Debian 1'), 'proche:Debian 13.1.0'); assert.equal(ok('Debian 0'), 'proche:Debian 13.1.0');
  assert.equal(ok('Ubuntu 3'), 'proche:Ubuntu Server 24.04.3|Ubuntu 22.04 (bureau)'); assert.equal(ok('Ubuntu 04'), 'proche:Ubuntu Server 24.04.3|Ubuntu 22.04 (bureau)');
  // le début du numéro, lui, désigne
  assert.equal(ok('Ubuntu 24'), 'Ubuntu Server 24.04.3'); assert.equal(ok('Ubuntu 24.04'), 'Ubuntu Server 24.04.3'); assert.equal(ok('Ubuntu 24.04.3'), 'Ubuntu Server 24.04.3'); assert.equal(ok('Ubuntu 22'), 'Ubuntu 22.04 (bureau)');
  assert.equal(ok('Debian 13'), 'Debian 13.1.0'); assert.equal(ok('Debian 13.1'), 'Debian 13.1.0'); assert.equal(ok('11'), 'Windows 11'); assert.equal(ok('Windows 11'), 'Windows 11');
  // « la dernière Ubuntu » : un serveur et un bureau ne sont pas deux versions du même système → Odin demande
  assert.equal(ok('la dernière Ubuntu'), 'plusieurs:Ubuntu Server 24.04.3|Ubuntu 22.04 (bureau)');
  assert.deepEqual(suitesDeNumeros('Ubuntu Server 24.04.3'), [['24', '04', '3']]); assert.deepEqual(suitesDeNumeros('Win11_24H2_French_x64'), [['11'], ['64']]);
  // « sauf le mien » : dit dans les langues comprises
  for (const t of ['qui viennent de démarrer sauf le mien', 'that just booted except pc-02', 'that just booted but not mine', 'que acaban de arrancar menos el mío', 'die gerade gestartet sind außer meinem', 'mais pas celui du salon']) assert.equal(cibleAvecExclusion(t), true, t);
  for (const t of ['qui viennent de démarrer', 'pc-01', 'sans-fil-03', 'that just booted', '']) assert.equal(cibleAvecExclusion(t), false, t);
});

test('relecture : un système prêt et un autre du même nom pas encore prêt → Odin demande lequel (jamais « celui qui est prêt » en silence)', async () => {
  const w = await monde({ deuxUbuntu: true });
  try {
    const cy = w.v.ctx('ymir');
    for (const f of ((await w.v.act('ymir', 'bibliotheque_iso')).data as { isos: FicheIso[] }).isos) if (/desktop/.test(f.nom)) noterFiche(cy, { ...f, antivirus: { at: 1, verdict: 'non analysé', texte: '' } });
    await w.pc(A);
    const r = await w.v.act('thjalfi', 'deployer_dit', { demande: 'Ubuntu sur les PC qui viennent de démarrer' });
    assert.equal(r.ok, false, r.text); assert.match(r.text, /Plusieurs systèmes conviennent pour « ubuntu » : « .* » ou « .* »\. Lequel \? Rien n'est fait\. \(Pas encore prêt : « .* »\.\)/);
    assert.deepEqual(w.carte(r).propositions.map((p) => p.label), ['Ubuntu Server 24.04.3'], 'seul celui qui est prêt peut être redit'); assert.equal(await w.preparation(), null);
    const k = await w.v.act('thjalfi', 'cle_mettre_dit', { demande: 'Ubuntu sur la clé' });
    assert.equal(k.ok, false); assert.match(k.text, /Plusieurs systèmes conviennent/); assert.equal(await w.preparation(), null);
    // la VM : aucune confirmation pour « Ubuntu », rien de créé
    const a = w.v.action('ymir', 'creer_vm_dit')!.a;
    assert.equal(a.grave!({ demande: 'Ubuntu' }, cy), undefined);
    const vm = await w.v.act('ymir', 'creer_vm_dit', { demande: 'Ubuntu' });
    assert.equal(vm.ok, false); assert.match(vm.text, /Plusieurs systèmes conviennent pour « ubuntu »/); assert.match(vm.text, /l'antivirus ne l'a pas encore vu/); assert.deepEqual(w.machines(), []);
    // le nom entier lève le doute
    assert.equal((await w.v.act('thjalfi', 'deployer_dit', { demande: 'Ubuntu Server sur les PC qui viennent de démarrer' })).ok, true);
    assert.match(String(a.grave!({ demande: 'Ubuntu Server' }, cy)), /avec Ubuntu Server 24\.04\.3/);
  } finally { w.fin(); }
});

test('relecture : « … sauf le mien » ne prépare pas tous les PC ; un PC d\'identité douteuse n\'est jamais préparé pour être effacé', async () => {
  const w = await monde();
  try {
    await w.pc(A, 'serie=AAA111'); await w.pc(B, '', '192.168.1.22');
    for (const d of ['Ubuntu sur les PC qui viennent de démarrer sauf le mien', 'Ubuntu on the PCs that just booted except pc-02', 'Ubuntu en los PC que acaban de arrancar menos el mío', 'Ubuntu auf den PCs die gerade gestartet sind außer meinem']) {
      const r = await w.v.act('thjalfi', 'deployer_dit', { demande: d });
      assert.equal(r.ok, false, d); assert.ok(r.text.includes(TEXTES_PAROLE.exclusion), d); assert.match(r.text, /Rien n'est autorisé, rien n'est effacé\./); assert.equal(await w.preparation(), null, d);
    }
    // la même adresse citée par un AUTRE appareil (autre numéro de série) : identité douteuse pendant 24 h
    await w.pc(A, 'serie=BBB222', '192.168.1.77');
    const r = await w.v.act('thjalfi', 'deployer_dit', { demande: 'Ubuntu sur les PC qui viennent de démarrer' });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /Ubuntu Server 24\.04\.3 sur 1 PC/); assert.match(r.text, new RegExp(`Laissé de côté \\(identité douteuse[^\\n]*\\) : ${A}\\.`));
    assert.deepEqual((await w.preparation())!.pcs!.map((x) => x.mac), [B]); assert.doesNotMatch(JSON.stringify(r), /AAA111|BBB222/, 'aucun numéro de série dans la carte');
    // dit par son adresse : refusé, et la préparation d'avant n'est pas remplacée
    const un = await w.v.act('thjalfi', 'deployer_dit', { demande: `Debian sur le PC ${A}` });
    assert.equal(un.ok, false); assert.match(un.text, new RegExp(`Identité douteuse pour ${A}`)); assert.doesNotMatch(JSON.stringify(un), /AAA111|BBB222/);
    assert.deepEqual((await w.preparation())!.pcs!.map((x) => x.mac), [B]); assert.equal((await w.preparation())!.systemes[0].nom, 'Ubuntu Server 24.04.3');
    // le PC préparé vient d'être bloqué : la page ne reprend plus cette préparation
    w.v.ctx('thjalfi').saveSettings({ bloques: { [B]: { at: 1, raison: 'prêté' } } });
    const p = await w.v.act('thjalfi', 'preparation_dite');
    assert.equal((p.data as { preparation: unknown }).preparation, null); assert.match(p.text, new RegExp(`${TEXTES_PAROLE.changee} : le PC ${B} est bloqué\\.`));
    // le seul PC au menu est douteux : rien n'est préparé
    const seul = await w.v.act('thjalfi', 'deployer_dit', { demande: 'Ubuntu sur les PC qui viennent de démarrer' });
    assert.equal(seul.ok, false); assert.match(seul.text, /Identité douteuse/);
    assert.deepEqual(w.autorisees(), []); assert.deepEqual(w.coffre, []);
  } finally { w.fin(); }
});

test('relecture : un disque externe n\'est pas « la clé » ; la préparation ne garde ni numéro de série ni phrase, et ne vaut que pour CE qui a été vu', async () => {
  const HDD = { ...CLE_NEUVE, id: 'faux-hdd', modele: 'Disque Sauvegarde (faux)', serie: 'SAUVE2000XY77', genre: 'disque-externe', tailleOctets: 2000 * GO } as Disque;
  const d = await monde({ disques: [HDD, INTERNE] });
  try {
    const r = await d.v.act('thjalfi', 'cle_mettre_dit', { demande: 'Debian sur la clé' });
    assert.equal(r.ok, false, r.text); assert.match(r.text, /Disque externe vu \(ce n'est pas une clé USB\) : Disque Sauvegarde \(faux\) · 2000 Go/); assert.match(r.text, /Ce n'est pas une clé USB\. Si c'est bien là que tu veux écrire, dis son nom\. Rien n'est fait\./);
    assert.equal(await d.preparation(), null, 'rien n\'est préparé sur un disque que tu n\'as pas nommé');
    const b = await d.v.act('thjalfi', 'cle_dit');
    assert.match(b.text, /Disque externe vu/); assert.ok(d.carte(b).propositions.some((p) => p.dire === 'mets Debian 13.1.0 sur la clé Disque Sauvegarde (faux)'), 'la proposition nomme le disque');
    const n = await d.v.act('thjalfi', 'cle_mettre_dit', { demande: 'Debian sur la clé Disque Sauvegarde' });
    assert.equal(n.ok, true, n.text); assert.equal((await d.preparation())!.cle!.id, 'faux-hdd');
  } finally { d.fin(); }
  const w = await monde();
  try {
    await w.pc(A);
    const r = await w.v.act('thjalfi', 'cle_mettre_dit', { demande: 'Windows 11 sur la clé' });
    assert.equal(r.ok, true, r.text);
    // ce qu'Odin garde : ni le numéro de série, ni une phrase, ni un accord
    const garde = JSON.stringify(w.v.ctx('thjalfi').settings.preparationDite);
    assert.doesNotMatch(garde, /LAGON0064AB12/); assert.doesNotMatch(garde, /phrase|appui|effacer|accord/i);
    assert.deepEqual(Object.keys((await w.preparation())!).sort(), ['at', 'cle', 'expire', 'sorte', 'systemes']); assert.deepEqual(Object.keys((await w.preparation())!.cle!).sort(), ['id', 'modele', 'tailleOctets']);
    // une AUTRE clé prend sa place (même identifiant de disque, même modèle, même taille, autre numéro de série) : plus reprise
    w.v.ctx('thjalfi').saveSettings({ cleDisquesTest: [{ ...CLE_NEUVE, serie: 'AUTRE0064ZZ99' }, INTERNE] });
    const autre = await w.v.act('thjalfi', 'preparation_dite');
    assert.equal((autre.data as { preparation: unknown }).preparation, null); assert.match(autre.text, /la clé n'est plus branchée, ou ce n'est plus la même/);
    w.v.ctx('thjalfi').saveSettings({ cleDisquesTest: [CLE_NEUVE, INTERNE] }); assert.equal((await w.preparation())!.cle!.id, CLE_NEUVE.id, 'la même clé rebranchée : reprise');
    // une préparation fabriquée (PC jamais vu, phrase glissée, durée trop longue) n'est jamais rendue telle quelle
    const now = Date.now(), sys = [{ iso: 'ubuntu-24-04-3-live-server-amd64', nom: 'Ubuntu' }];
    w.v.ctx('thjalfi').saveSettings({ preparationDite: { sorte: 'reseau', at: now, expire: now + 60_000, systemes: sys, pcs: [{ mac: '52:54:00:99:99:99' }], facon: 'auto' } });
    assert.equal(await w.preparation(), null, 'un PC qu\'Odin n\'a jamais vu');
    w.v.ctx('thjalfi').saveSettings({ preparationDite: { sorte: 'reseau', at: now, expire: now + 60_000, systemes: sys, pcs: [{ mac: A }], facon: 'auto', phrase: 'effacer 1 pc', appui: true, identite: { [A]: 'x' } } });
    const p = (await w.preparation())!;
    assert.deepEqual(Object.keys(p).sort(), ['at', 'expire', 'facon', 'pcs', 'sorte', 'systemes'], 'ni phrase, ni appui, ni choix d\'identité'); assert.deepEqual(p.pcs, [{ mac: A }]); assert.equal(p.systemes[0].nom, 'Ubuntu Server 24.04.3', 'le nom relu, pas celui écrit');
    w.v.ctx('thjalfi').saveSettings({ preparationDite: { sorte: 'reseau', at: now, expire: now + 24 * 3600_000, systemes: sys, pcs: [{ mac: A }], facon: 'auto' } });
    assert.equal(await w.preparation(), null, 'jamais plus de 30 minutes');
    w.v.ctx('thjalfi').saveSettings({ preparationDite: { sorte: 'reseau', at: now, expire: now + 60_000, systemes: [{ iso: 'rocky-9-6-x86-64-minimal', nom: 'Rocky' }, { iso: 'inconnu', nom: 'x' }], pcs: [{ mac: A }], facon: 'auto' } });
    assert.equal(await w.preparation(), null, 'un système pas prêt');
    // « oublier » : au propriétaire seul ; après, plus rien à reprendre
    await w.v.act('thjalfi', 'deployer_dit', { demande: 'Debian sur les PC qui viennent de démarrer' }); assert.ok(await w.preparation());
    for (const o of [{ qui: 'member' }, { qui: 'guest' }, { marque: true }, { auto: true, by: 'automatisation' }, { de: 'ran' }]) {
      for (const id of ['preparation_oublier', 'preparation_dite', 'deployer_dit', 'cle_mettre_dit', 'cle_ajouter_dit']) { const x = await w.v.act('thjalfi', id, { demande: 'Windows 11 sur la clé' }, o as never); assert.equal(x.ok, false, `${id} ${JSON.stringify(o)}`); assert.equal(x.data, undefined, id); }
      assert.equal((await w.v.act('ymir', 'creer_vm_dit', { demande: 'Debian' }, o as never)).ok, false);
    }
    assert.equal((await w.preparation())!.systemes[0].nom, 'Debian 13.1.0', 'personne d\'autre ne remplace ni n\'efface la préparation');
    // une phrase venue d'une autre appli (la voix), ou de la clé d'API : refusée aussi
    const autres: Array<[string, Record<string, unknown>]> = [['appli:ran', {}], ['principal', { qui: 'guest' }]];
    for (const [s, o] of autres) assert.equal((await w.v.order('installe Ubuntu sur les PC qui viennent de démarrer', s, o as never)).ok, false, s);
    assert.equal((await w.preparation())!.systemes[0].nom, 'Debian 13.1.0');
    assert.equal((await w.v.act('thjalfi', 'preparation_oublier')).ok, true); assert.equal(await w.preparation(), null);
    assert.deepEqual(w.autorisees(), []); assert.deepEqual(w.machines(), []); assert.deepEqual(w.sorties, []);
  } finally { w.fin(); }
});

test('relecture : la VM créée est EXACTEMENT celle annoncée — la bibliothèque ou les machines ont changé entre l\'annonce et le « oui » : refus, rien n\'est créé', async () => {
  const v = await monde();
  try {
    const cy = v.v.ctx('ymir'), brut = v.v.action('ymir', 'creer_vm_dit')!.a;
    const q = await v.v.order('crée-moi une VM Ubuntu', 'vm-x');
    assert.match(String(q.confirm), /^créer la VM vm-ubuntu-server-1 avec Ubuntu Server 24\.04\.3 : 2 processeur\(s\), 2 Go de mémoire, 20 Go de disque/);
    // entre-temps : un Ubuntu « bureau » arrive et devient prêt ; le « Server » annoncé est bloqué par l'antivirus
    copyFileSync(join(v.espace, 'ubuntu-24.04.3-live-server-amd64.iso'), join(v.espace, 'ubuntu-24.04.3-desktop-amd64.iso'));
    for (const f of ((await v.v.act('ymir', 'bibliotheque_iso')).data as { isos: FicheIso[] }).isos) {
      if (/desktop/.test(f.nom)) noterFiche(cy, { ...f, sha256: createHash('sha256').update(readFileSync(f.chemin)).digest('hex'), editeur: true, antivirus: { at: 1, verdict: 'sain', texte: 'rien trouvé' } });
      if (/live-server/.test(f.nom)) noterFiche(cy, { ...f, antivirus: { at: 2, verdict: 'bloqué', texte: 'menace' } });
    }
    const r = await v.v.order('crée-moi une VM Ubuntu', 'vm-x', { confirm: true });
    assert.equal(r.ok, false, r.text); assert.deepEqual(v.machines(), [], 'aucune VM créée avec un autre système que celui annoncé');
    // les machines changent entre l'annonce et le « oui » : le nom annoncé n'est plus libre
    const d1 = await v.v.order('crée-moi une VM Debian', 'vm-y');
    assert.match(String(d1.confirm), /^créer la VM vm-debian-1 avec Debian 13\.1\.0/);
    const autre = await v.v.order('crée une machine virtuelle Debian', 'vm-z'); assert.match(String(autre.confirm), /vm-debian-1/);
    assert.equal((await v.v.order('crée une machine virtuelle Debian', 'vm-z', { confirm: true })).ok, true); assert.deepEqual(v.machines().map((m) => m.nom), ['vm-debian-1']);
    const d2 = await v.v.order('crée-moi une VM Debian', 'vm-y', { confirm: true });
    assert.equal(d2.ok, false); assert.match(d2.text, /Ce qu'Odin t'a annoncé n'est plus ce qu'il créerait .*ce serait maintenant vm-debian-2 avec Debian 13\.1\.0.*Redis-le.*Rien n'est créé\./); assert.equal(v.machines().length, 1);
    // redit : la nouvelle proposition est montrée, puis créée telle quelle
    const d3 = await v.v.order('crée-moi une VM Debian', 'vm-y'); assert.match(String(d3.confirm), /^créer la VM vm-debian-2 avec Debian 13\.1\.0/);
    assert.equal((await v.v.order('crée-moi une VM Debian', 'vm-y', { confirm: true })).ok, true); assert.deepEqual(v.machines().map((m) => m.nom).sort(), ['vm-debian-1', 'vm-debian-2']);
    // sans annonce (l'action lancée sans que la garde ait montré quoi que ce soit) : rien n'est créé
    const sans = await brut.run(cy, { demande: 'Debian avec 2 cœurs' });
    assert.equal(sans.ok, false); assert.match(sans.text, /Odin ne t'a pas encore montré ce qu'il créerait/); assert.equal(v.machines().length, 2);
    // une annonce ne sert qu'une fois
    assert.equal((await v.v.act('ymir', 'creer_vm_dit', { demande: 'Debian avec 2 cœurs' })).ok, true); assert.equal(v.machines().length, 3);
    assert.match((await brut.run(cy, { demande: 'Debian avec 2 cœurs' })).text, /pas encore montré/); assert.equal(v.machines().length, 3);
  } finally { v.fin(); }
});

test('relecture : « télécharge … » avec un morceau de nom qui convient à plusieurs → Odin demande lequel, aucun téléchargement ne part', async () => {
  const w = await monde();
  try {
    for (const n of ['serv', 'linux', 'windows', 'ubu', 'deb']) {
      const r = await w.v.act('eitri', 'telecharger', { nom: n });
      assert.equal(r.ok, false, `${n} : ${r.text}`); assert.match(r.text, /plusieurs iso conviennent pour « .* » : « .* », « .* ».*Lequel \? Redis-le avec son nom entier\. Rien n'est fait\./i, n);
    }
    assert.deepEqual(w.sorties, [], 'aucune sortie réseau pour un nom qui ne désigne pas un seul système');
    assert.match((await w.v.act('eitri', 'suivre', { nom: 'serv' })).text, /plusieurs iso conviennent/i);
    // le nom entier ou l'identifiant : pris ; « debian » seul prend « netinst », et la réponse nomme l'autre
    const deb = await w.v.act('eitri', 'telecharger', { nom: 'debian' });
    assert.match(deb.text, /Debian \(netinst\)/); assert.match(deb.text, /C'est « Debian \(netinst\) » qui est pris\. Il existe aussi : « Debian \(DVD complet\) »/);
    assert.doesNotMatch((await w.v.act('eitri', 'telecharger', { nom: 'debian-dvd' })).text, /Il existe aussi/);
    assert.match((await w.v.act('eitri', 'telecharger', { nom: 'netinst' })).text, /Debian \(netinst\)/, 'un morceau qui ne désigne qu\'un seul nom');
    assert.ok(w.sorties.length > 0);
  } finally { w.fin(); }
});

test('relecture : seule une phrase qui CRÉE propose une VM — « copie », « télécharge », « supprime », « stop » une VM ne proposent rien', async () => {
  for (const t of ['copie une VM Debian', 'télécharge une VM Debian', 'supprime une VM Debian', 'stop a VM Debian', 'delete a VM Debian', 'déploie une VM Debian', 'copy a VM Debian']) assert.notEqual(demandeVm(t).systeme, 'Debian', t);
  for (const t of ['crée-moi une VM Debian', 'fais-moi une VM Debian', 'installe une VM Debian', 'create a VM with Debian', 'make me a VM Debian', 'crea una VM Debian', 'erstelle eine VM Debian', 'une VM Debian', 'Debian']) assert.equal(demandeVm(t).systeme, 'Debian', t);
  const w = await monde();
  try {
    const a = w.v.action('ymir', 'creer_vm_dit')!.a, cy = w.v.ctx('ymir');
    for (const t of ['copie une VM Debian', 'télécharge une VM Debian', 'supprime une VM Debian', 'stop a VM Debian', 'delete a VM Debian']) {
      assert.equal(a.grave!({ demande: t }, cy), undefined, `${t} : aucune création n'est proposée`);
      const r = await w.v.act('ymir', 'creer_vm_dit', { demande: t }); assert.equal(r.ok, false, t); assert.match(r.text, /Rien n'est créé/, t);
    }
    assert.deepEqual(w.machines(), []);
    // des phrases de tous les jours qui parlent d'une clé ou de PC sans nommer un système : Genèse le dit, rien n'est préparé
    for (const [id, d] of [['cle_mettre_dit', 'photos sur la clé usb'], ['deployer_dit', 'docker on the pcs']] as const) {
      const r = await w.v.act('thjalfi', id, { demande: d }); assert.equal(r.ok, false, d); assert.ok(r.text.includes(TEXTES_PAROLE.systemesSeulement), d);
    }
    assert.equal(await w.preparation(), null);
  } finally { w.fin(); }
});

test('relecture : « ajoute … à ma clé » retire l\'accord « au prochain branchement » donné avant, et le dit', async () => {
  const w = await monde({ disques: [CLE_ODIN, INTERNE] });
  try {
    const id = await avecCleConnue(w);
    type Vue = { id?: string; changements?: number; armeValide?: boolean; attente?: { arme: boolean; ajouter: Array<{ iso: string }> } };
    const vue = async () => ((await w.v.act('thjalfi', 'cle_mes_cles')).data as { cles: Vue[] }).cles.find((x) => x.id === id)!;
    // l'accord donné dans la page, pour UN changement précis
    const arme = await w.v.act('thjalfi', 'cle_changer', { cle: id, attente: { ajouter: [{ iso: 'debian-13-1-0-amd64-netinst', nom: 'Debian' }] }, armer: true });
    assert.equal(arme.ok, true, arme.text); assert.equal((await vue()).armeValide, true);
    // la parole ajoute un autre système : les changements ne sont plus ceux accordés
    const r = await w.v.act('thjalfi', 'cle_ajouter_dit', { demande: 'Ubuntu à ma clé' });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /L'accord « au prochain branchement » que tu avais donné est retiré/);
    const k = await vue();
    assert.equal(k.changements, 2); assert.equal(k.attente!.arme, false); assert.equal(k.armeValide, false, 'rien ne partira tout seul au branchement');
    assert.match((await w.v.act('thjalfi', 'cle_appliquer', { cle: id, auto: true })).text, /n'ont pas ton accord pour partir au branchement/);
    // sans accord donné avant : la phrase ne parle pas d'accord
    await w.v.act('thjalfi', 'cle_changer', { cle: id, vider: true });
    assert.doesNotMatch((await w.v.act('thjalfi', 'cle_ajouter_dit', { demande: 'Ubuntu à ma clé' })).text, /accord/);
  } finally { w.fin(); }
});

test('relecture : « les PC du salon qui viennent de démarrer » — une précision en plus n\'est pas ignorée (jamais « tous » à sa place)', async () => {
  const w = await monde();
  try {
    await w.pc(A); await w.pc(B, '', '192.168.1.22');
    for (const [d, mot] of [['Ubuntu sur les PC du salon qui viennent de démarrer', 'salon'], ['Ubuntu on the PCs in the office that just booted', 'office'], ['Ubuntu en los PC de la oficina que acaban de arrancar', 'oficina'], ['Ubuntu auf den PCs im Büro die gerade gestartet sind', 'buro']] as const) {
      const r = await w.v.act('thjalfi', 'deployer_dit', { demande: d });
      assert.equal(r.ok, false, d); assert.match(r.text, new RegExp(`Je n'ai pas compris « [^»]*${mot}[^»]* »`), d); assert.match(r.text, /Rien n'est autorisé, rien n'est effacé\./); assert.equal(await w.preparation(), null, d);
    }
    // sans précision en plus : les PC au menu, comme avant
    for (const d of ['Ubuntu sur les PC qui viennent de démarrer', 'Ubuntu sur les PC qui viennent juste de démarrer', 'Ubuntu sur les PC qui sont au menu', 'Ubuntu on the PCs that have just booted', 'Ubuntu auf den PCs die gerade gestartet sind', 'Ubuntu sur les PC']) {
      const r = await w.v.act('thjalfi', 'deployer_dit', { demande: d });
      assert.equal(r.ok, true, `${d} : ${r.text}`); assert.deepEqual((await w.preparation())!.pcs!.map((x) => x.mac).sort(), [A, B].sort(), d);
    }
    assert.deepEqual(w.autorisees(), []);
  } finally { w.fin(); }
});
