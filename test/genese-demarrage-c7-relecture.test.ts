// Genèse · clé USB, lot C7 — RELECTURE EN ADVERSAIRE du menu de démarrage en mode texte. Chaque essai rejoue une
// attaque ou un défaut trouvé : l'entrée par défaut que Ventoy ne retrouverait pas (il démarrerait alors la 1re image
// de sa liste, un installateur), un délai sans système par défaut (même effet en mode graphique), une langue piégée qui
// casse l'écriture, un nom piégé en Unicode qui se replie en signes du chargeur, un disque du PC qui pourrait viser la
// clé elle-même, et le menu texte qui doit TOUJOURS être écrit sur la clé (faux disque : un dossier temporaire).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMenuTexte, textesMenuTexte } from '../src/valhalla/thjalfi/cle-grub.ts';
import { buildVentoyJson, reglagesDemarrage, TITRE_ENTREE_ODIN } from '../src/valhalla/thjalfi/cle-boot.ts';
import * as E from '../src/valhalla/thjalfi/cle-ecrire.ts';
import type { PreparationCle } from '../src/valhalla/thjalfi/cle-types.ts';
import type { Recipe } from '../src/valhalla/thjalfi/recipes.ts';
import type { Disque } from '../src/valhalla/thjalfi/disques.ts';
import type { ModCtx } from '../src/valhalla/types.ts';

const rec = (kind: Recipe['kind'], os: Recipe['os']): Recipe => ({ kind, label: `${kind}`, auto: true, os });
function prep(p: Partial<PreparationCle> = {}): PreparationCle {
  return {
    schema: 'gpt', secureBoot: true, label: 'ODIN', theme: 'bleu', texte: 'matrix', disposition: 'eventail',
    modeDefaut: 'texte', delai: 5, langue: 'fr',
    systemes: [
      { fichier: 'windows-11.iso', nom: 'Windows 11', famille: 'Windows', mode: 'installer', recipe: rec('windows', 'windows') },
      { fichier: 'ubuntu-24.04.iso', nom: 'Ubuntu Desktop', famille: 'Linux', mode: 'installer', recipe: rec('ubuntu', 'linux') },
    ],
    images: [], vdisks: [], logiciels: [], defaut: 'ubuntu-24.04.iso',
    ...p,
  };
}
const control = (p: PreparationCle) => Object.assign({}, ...JSON.parse(buildVentoyJson(p)).control) as Record<string, string>;
const titres = (cfg: string) => [...cfg.matchAll(/^menuentry "([^"]*)"/gm)].map((m) => m[1]);

test('relecture C7 · en mode texte, ventoy.json vise une entrée qui EXISTE dans le menu texte (titre exact), quel que soit le réglage', () => {
  // Avant : « F6>2  Ubuntu Desktop » alors que l'entrée s'appelle «  2  Ubuntu Desktop » (espace devant), et « F6>D »
  // sans système par défaut : aucune entrée de ce nom. Ventoy, ne trouvant pas, démarrait au délai 0 la 1re image.
  for (const p of [prep(), prep({ defaut: undefined }), prep({ delai: 0 }), prep({ langue: 'de' }), prep({ systemes: Array.from({ length: 12 }, (_, i) => ({ fichier: `s${i}.iso`, nom: `S${i}`, famille: 'Linux' as const, mode: 'demarrer' as const, recipe: rec('ubuntu', 'linux') })), defaut: 's10.iso' })]) {
    const c = control(p);
    assert.match(c.VTOY_DEFAULT_IMAGE, /^F6>/);
    const vise = c.VTOY_DEFAULT_IMAGE.slice(3);
    assert.ok(titres(buildMenuTexte(p)).includes(vise), `« ${vise} » est le titre exact d'une entrée`);
  }
  // L'entrée visée ne démarre rien elle-même : elle relit le menu texte (son attente et son système par défaut).
  const cfg = buildMenuTexte(prep());
  const bloc = cfg.slice(cfg.indexOf(`menuentry "${TITRE_ENTREE_ODIN}"`)).split('\n').slice(0, 3);
  assert.deepEqual(bloc.map((l) => l.trim()), [`menuentry "${TITRE_ENTREE_ODIN}" --id odin-menu --hotkey=o --class odin {`, 'configfile "${vtoy_iso_part}/ventoy/ventoy_grub.cfg"', '}']);
  // Le défaut du menu texte reste le système choisi, ou le disque du PC ; jamais l'entrée qui relit (pas de boucle).
  assert.ok(cfg.includes('set default=odin-2'));
  assert.ok(buildMenuTexte(prep({ defaut: undefined })).includes('set default=odin-disque'));
  assert.ok(!/set default=odin-menu/.test(cfg));
});

test('relecture C7 · mode graphique : jamais de délai sans système par défaut (Ventoy démarrerait un installateur tout seul)', () => {
  // Avant : VTOY_MENU_TIMEOUT posé même sans VTOY_DEFAULT_IMAGE ; Ventoy démarre alors la 1re image (ici Windows 11).
  const sans = control(prep({ modeDefaut: 'graphique', defaut: undefined }));
  assert.equal(sans.VTOY_MENU_TIMEOUT, undefined);
  assert.equal(sans.VTOY_DEFAULT_IMAGE, undefined);
  // Délai 0 : on attend qu'on choisisse (Ventoy : pas de délai), au lieu de démarrer aussitôt.
  const zero = control(prep({ modeDefaut: 'graphique', delai: 0 }));
  assert.equal(zero.VTOY_MENU_TIMEOUT, undefined);
  assert.equal(zero.VTOY_DEFAULT_IMAGE, '/ISO/ubuntu-24.04.iso');
  // Avec un système par défaut et un délai : les deux.
  const avec = control(prep({ modeDefaut: 'graphique', delai: 8 }));
  assert.deepEqual([avec.VTOY_DEFAULT_IMAGE, avec.VTOY_MENU_TIMEOUT], ['/ISO/ubuntu-24.04.iso', '8']);
});

test('relecture C7 · une langue piégée ne casse rien ; shimaoré et kibushi montrent le français en attendant leurs phrases', () => {
  // Avant : « constructor », « toString », « __proto__ »… trouvaient une propriété d'objet : buildMenuTexte plantait.
  for (const l of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    assert.deepEqual(textesMenuTexte(l), textesMenuTexte('en'), l);
    assert.doesNotThrow(() => buildMenuTexte(prep({ langue: l })), l);
  }
  for (const l of ['swb', 'buc', 'SWB', 'buc-YT']) assert.deepEqual(textesMenuTexte(l), textesMenuTexte('fr'), l);
  assert.ok(buildMenuTexte(prep({ langue: 'swb' })).includes('Demarrer sur le disque du PC'));
  // La langue n'arrive jamais telle quelle : un code seul, ou rien.
  assert.equal(reglagesDemarrage({ langue: 'fr";reboot;"' }).langue, undefined);
  assert.equal(reglagesDemarrage({ langue: 'fr_FR.UTF-8' }).langue, 'fr');
  assert.equal(reglagesDemarrage({ langue: 'en-GB' }).langue, 'en');
  assert.equal(reglagesDemarrage({ langue: 42 }).langue, undefined);
  // Le délai : ni booléen, ni liste, ni texte piégé.
  for (const d of [true, [5], '5; reboot', '${x}', Infinity, NaN]) assert.equal(reglagesDemarrage({ delai: d }).delai, 10, String(d));
  // Un thème texte inconnu (venu un jour de la page) ne casse pas l'écriture et ne passe pas dans le fichier.
  const cfg = buildMenuTexte(prep({ texte: '";reboot;"' as never }));
  assert.ok(!cfg.includes('reboot'));
  for (const m of cfg.matchAll(/color_[a-z]+=(\S+)/g)) assert.match(m[1], /^[a-z-]+\/[a-z-]+$/);
});

test('relecture C7 · un nom en Unicode qui se replie en signes du chargeur reste un simple titre', () => {
  const pieges = [
    'Ubuntu; reboot',            // point d'interrogation grec : se replie en « ; »
    'Win＂ ＄{prefix}',      // guillemet et dollar pleine largeur
    'A menuentry x { }',   // séparateurs de ligne Unicode
    'B\u0085C\u000Bvert',            // NEL, tabulation verticale
    'D‮evil‬',             // inversion du sens d'écriture
    'E`cmd`',              // se replie en accent grave
    'x'.repeat(5000),
  ];
  const p = prep({ systemes: pieges.map((nom, i) => ({ fichier: `p${i}.iso`, nom, famille: 'Linux' as const, mode: 'demarrer' as const, recipe: rec('ubuntu', 'linux') })), defaut: undefined });
  const cfg = buildMenuTexte(p);
  assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(cfg), 'tout en ASCII');
  const t = titres(cfg);
  assert.equal(t.length, pieges.length + 4);
  for (const x of t) assert.ok(!/[;"$`\\{}]/.test(x) && x.length <= 64, x);
  assert.equal((cfg.match(/^menuentry /gm) || []).length, pieges.length + 4, 'aucune entrée de plus');
  assert.ok(!/^\s*reboot\b/m.test(cfg) && !cfg.includes('${prefix}'));
});

test('relecture C7 · « Disque du PC » ne vise jamais la clé, même si le chargeur ne dit pas où elle est', () => {
  const cfg = buildMenuTexte(prep());
  const fn = cfg.slice(cfg.indexOf('function odin_disque {'), cfg.indexOf('\n}\n', cfg.indexOf('function odin_disque {')));
  // Avant : sans « vtoydev », la comparaison laissait passer tous les disques, la clé comprise.
  assert.ok(fn.indexOf('if [ -n "${vtoydev}" ]; then') >= 0 && fn.indexOf('if [ -n "${vtoydev}" ]; then') < fn.indexOf('for d in'));
  // Rien n'y écrit : ni commande d'écriture, ni sauvegarde de variables.
  assert.ok(!/\b(save_env|load_env|write|dd|parttool|cryptomount)\b/.test(fn));
});

// ---------------- Sur un faux disque (dossier temporaire), par l'action d'écriture elle-même ----------------
const G = 1024 ** 3;
const dossiers: string[] = [];
const neuf = (n: string) => { const d = mkdtempSync(join(tmpdir(), `odin-c7r-${n}-`)); dossiers.push(d); return d; };
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const CLE: Disque = { id: 'faux-cle-c7', chemin: 'faux-7', modele: 'Clé USB 64 Go (fausse)', serie: 'C7C7C7C7', tailleOctets: 58 * G, genre: 'cle', externe: true, amovible: true, bus: 'usb', partitions: [] };
const PHRASE = 'effacer la clé 58 go';

function monde() {
  const src = neuf('src'), img = neuf('img'), home = neuf('home'), dir = neuf('dir');
  const f = (n: string, c: string) => { const p = join(src, n); writeFileSync(p, c); return p; };
  const biblio = [
    { id: 'ubuntu', nom: 'ubuntu-24.04-desktop-amd64', chemin: f('ubuntu.iso', 'ISO-UBUNTU-FAUSSE'), recipe: rec('ubuntu', 'linux') },
    { id: 'win11', nom: 'Win11_Pro_24H2_French_x64', chemin: f('win11.iso', 'ISO-WINDOWS-FAUSSE'), recipe: rec('windows', 'windows') },
  ];
  const settings = { cleDisquesTest: [CLE], cleImageTest: img } as Record<string, unknown>;
  const ctx = {
    home, dir, settings, now: () => new Date(),
    run: async () => { throw new Error('aucune commande pendant les essais'); },
    call: async (m: string) => { if (m === 'fjalar') return { ok: true, text: '', data: { fichiers: [] } }; throw new Error('absent'); },
  } as unknown as ModCtx;
  const actions = E.cleUsb({
    bibliotheque: async () => biblio, antivirus: () => undefined, cleActivation: () => undefined,
    profil: () => ({ utilisateur: 'famille', langue: 'fr_FR.UTF-8', clavier: 'fr', fuseau: 'Indian/Mayotte' }),
  }).actions;
  return { img, ctx, ecrire: actions.find((a) => a.id === 'cle_preparer')! };
}
const sys = (id: string, nom: string) => ({ nom, iso: `iso:${id}`, famille: id === 'win11' ? 'windows' : 'linux', choix: 'iso' });

test('relecture C7 · l\'image écrite porte TOUJOURS le menu texte (sans Linux installé), avec le mode, le délai et la langue demandés', async () => {
  // Avant : /ventoy/ventoy_grub.cfg n'était écrit que s'il y avait un Linux installé ; mode, délai et langue étaient figés.
  const m = monde();
  const r = await m.ecrire.run(m.ctx, { cible: { id: CLE.id, serie: CLE.serie, tailleOctets: CLE.tailleOctets, modele: CLE.modele }, systemes: [sys('win11', 'Windows 11'), sys('ubuntu', 'Ubuntu')], phrase: PHRASE, modeDefaut: 'texte', delai: 3, langue: 'swb' });
  assert.equal(r.ok, true, r.text);
  const fin = await (E as unknown as { attendreEcriture(id: string): Promise<{ ok: boolean; message: string }> }).attendreEcriture(CLE.id);
  assert.equal(fin.ok, true, fin.message);
  const cfg = readFileSync(join(m.img, 'ventoy/ventoy_grub.cfg'), 'utf8');
  assert.deepEqual(titres(cfg), [' 1  Windows 11', ' 2  Ubuntu', ' G  Passer en mode graphique', ' D  Demarrer sur le disque du PC', 'ODIN', 'VTOY_RET']);
  assert.equal((cfg.match(/sleep --interruptible 1/g) || []).length, 3, 'le délai demandé');
  assert.ok(cfg.includes('set default=odin-disque'), 'aucun système par défaut : le disque du PC');
  const vj = JSON.parse(readFileSync(join(m.img, 'ventoy/ventoy.json'), 'utf8'));
  const c = Object.assign({}, ...vj.control);
  assert.equal(vj.theme.display_mode, 'CLI');
  assert.equal(c.VTOY_DEFAULT_IMAGE, 'F6>ODIN');
  // Rien de personnel dans les fichiers de démarrage : ni le compte, ni le fuseau, ni la série de la clé.
  for (const x of [cfg, JSON.stringify(vj)]) for (const s of ['famille', 'Mayotte', CLE.serie!]) assert.ok(!x.includes(s), s);

  // Rien demandé : graphique, la langue d'Odin (français), et AUCUN délai sans système par défaut.
  const m2 = monde();
  const r2 = await m2.ecrire.run(m2.ctx, { cible: { id: CLE.id, serie: CLE.serie, tailleOctets: CLE.tailleOctets, modele: CLE.modele }, systemes: [sys('win11', 'Windows 11')], phrase: PHRASE });
  assert.equal(r2.ok, true, r2.text);
  assert.equal((await (E as unknown as { attendreEcriture(id: string): Promise<{ ok: boolean }> }).attendreEcriture(CLE.id)).ok, true);
  const cfg2 = readFileSync(join(m2.img, 'ventoy/ventoy_grub.cfg'), 'utf8');
  assert.ok(cfg2.includes('Demarrer sur le disque du PC'), 'la langue d\'Odin');
  const vj2 = JSON.parse(readFileSync(join(m2.img, 'ventoy/ventoy.json'), 'utf8'));
  const c2 = Object.assign({}, ...vj2.control);
  assert.equal(vj2.theme.display_mode, 'GUI');
  assert.equal(c2.VTOY_MENU_TIMEOUT, undefined, 'pas de Windows qui s\'installe tout seul au bout de 10 s');
});
