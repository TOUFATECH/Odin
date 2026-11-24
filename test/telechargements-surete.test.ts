// Les téléchargements d'un lien donné par quelqu'un : la bibliothèque (ISO d'Hydre, logiciels d'Hermès) et Atalante.
// Un lien public qui renvoie (redirection) vers la machine d'Odin, la maison, un nom local, les métadonnées d'un
// hébergeur, ou de https vers http, n'est jamais suivi. Une adresse de la maison tapée par le propriétaire (avec son
// accord) reste possible, mais jamais atteinte par une redirection depuis un site public. Réseau simulé : rien ne sort.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { brancherGarde, type Passage } from '../src/valhalla/ullr/garde.ts';
import { attendreAtalante, reseauAtalante } from '../src/valhalla/modules/atalante.ts';
import { sonder } from '../src/valhalla/atalante/morceaux.ts';
import { download } from '../src/valhalla/forge/forge.ts';

// Les cibles d'une redirection piégée : la machine (sous plusieurs écritures), les métadonnées, la maison, un nom
// local, un nom à une étiquette, et un site public mais en http (le contenu peut être changé en route).
const PIEGES: Array<[string, string]> = [
  ['boucle 127.0.0.1', 'http://127.0.0.1:8080/x.iso'],
  ['boucle [::1]', 'http://[::1]/x.iso'],
  ['boucle cachée [::ffff:7f00:1]', 'http://[::ffff:7f00:1]/x.iso'],
  ['boucle en nombre 2130706433', 'http://2130706433/x.iso'],
  ['métadonnées 169.254.169.254', 'http://169.254.169.254/latest/meta-data/x.iso'],
  ['maison 192.168.1.10', 'http://192.168.1.10/x.iso'],
  ['nom local nas.local', 'https://nas.local/x.iso'],
  ['nom à une étiquette', 'https://nas/x.iso'],
  ['https vers http', 'http://miroir.exemple.org/x.iso'],
];
const REDIR = 'https://pub.exemple.org/r?vers=';
const redirige = (cible: string) => `${REDIR}${encodeURIComponent(cible)}`;
/** Les adresses publiques du faux réseau ; le reste ne se résout pas (ou mène à la maison pour « nas »). */
const resoudre = async (h: string) => (h.endsWith('exemple.org') ? ['203.0.113.10'] : h === 'nas' ? ['192.168.1.20'] : []);

/** Un faux réseau : `…/r?vers=X` renvoie (302) vers X ; tout autre lien est « atteint » et sert
 *  un petit fichier. Il suit les redirections lui-même quand on ne lui demande pas `redirect: 'manual'` (comme fetch). */
function reseau() {
  const atteints: string[] = [];
  const f = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input), u = new URL(url);
    if (u.pathname === '/r' && u.searchParams.has('vers')) {
      const loc = u.searchParams.get('vers')!;
      if (init?.redirect === 'manual') return new Response(null, { status: 302, headers: { location: loc } });
      return f(loc, init);
    }
    atteints.push(url);
    const corps = Buffer.from(`contenu de ${url}`);
    return new Response(corps, { status: 200, headers: { 'content-length': String(corps.length) } });
  };
  return { f: f as typeof fetch, atteints };
}

const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
after(() => { brancherGarde(undefined); reseauAtalante(); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
brancherGarde(async (): Promise<Passage> => ({ ok: true, bloque: false, analyse: true, sha256: '0'.repeat(64), taille: 1, score: 0, pourquoi: [], texte: 'rien', gardien: 'asclepios' }));

function monde() {
  const home = neuf('odin-tsurete-'), net = reseau();
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { fetch: net.f, notify: async () => {}, autonomy: () => 'equilibre' } as never);
  // Asclépios ne juge aucun site dangereux ici : seule la règle des adresses décide.
  const ullr = v.modules().find((m) => m.id === 'ullr')!.actions.find((a) => a.id === 'adresse')!;
  ullr.run = (async () => ({ text: '', data: { score: 0 } })) as typeof ullr.run;
  return { v, home, net };
}

test('bibliothèque (ISO d\'Hydre) : un lien public qui renvoie vers la machine, la maison, un nom local ou en http n\'est jamais suivi', async () => {
  const w = monde();
  try {
    await w.v.act('ymir', 'espace_iso', { dossier: join(w.home, 'iso') });
    for (const [quoi, cible] of PIEGES) {
      w.net.atteints.length = 0;
      const r = await w.v.act('ymir', 'importer_iso', { lien: redirige(cible), nom: 'piege.iso' }).catch((e) => ({ ok: false, text: (e as Error).message }));
      assert.deepEqual(w.net.atteints, [], `${quoi} : rien n'est demandé à la cible (${r.text})`);
      assert.equal(r.ok, false, quoi);
    }
    // L'usage normal reste : un lien public en https, et un miroir public en https.
    w.net.atteints.length = 0;
    assert.notEqual((await w.v.act('ymir', 'importer_iso', { lien: 'https://cdimage.exemple.org/debian-13.2.0-amd64-netinst.iso' })).ok, false);
    assert.notEqual((await w.v.act('ymir', 'importer_iso', { lien: redirige('https://miroir.exemple.org/ubuntu-24.04.3-desktop-amd64.iso') })).ok, false);
    assert.deepEqual(w.net.atteints, ['https://cdimage.exemple.org/debian-13.2.0-amd64-netinst.iso', 'https://miroir.exemple.org/ubuntu-24.04.3-desktop-amd64.iso']);
  } finally { w.v.stop(); }
});

test('bibliothèque (logiciels d\'Hermès) : même règle ; une adresse de la maison tapée demande l\'accord, et ne renvoie jamais ailleurs dans la maison', async () => {
  const w = monde();
  try {
    const act = w.v.modules().find((m) => m.id === 'fjalar')!.actions.find((a) => a.id === 'importer_logiciel')!;
    for (const [quoi, cible] of PIEGES) {
      w.net.atteints.length = 0;
      const r = await w.v.act('fjalar', 'importer_logiciel', { lien: redirige(cible), nom: 'piege.exe' }).catch((e) => ({ ok: false, text: (e as Error).message }));
      assert.deepEqual(w.net.atteints, [], `${quoi} : rien n'est demandé à la cible (${r.text})`);
    }
    // Tapée par le propriétaire : une adresse de la maison est une action grave (son accord), puis elle est servie.
    assert.ok(act.grave?.({ lien: 'http://192.168.1.10/outil-1.0.exe' }), 'l\'adresse de la maison demande l\'accord');
    assert.equal(act.grave?.({ lien: 'https://outils.exemple.org/outil-1.0.exe' }), undefined);
    w.net.atteints.length = 0;
    assert.notEqual((await w.v.act('fjalar', 'importer_logiciel', { lien: 'http://192.168.1.10/outil-1.0.exe' })).ok, false);
    assert.deepEqual(w.net.atteints, ['http://192.168.1.10/outil-1.0.exe']);
    // Mais cette adresse ne renvoie ni vers une autre de la maison, ni vers un site public qui y ramène.
    for (const cible of ['http://192.168.1.11/autre.exe', redirige('http://192.168.1.12/autre.exe')]) {
      w.net.atteints.length = 0;
      await w.v.act('fjalar', 'importer_logiciel', { lien: `http://192.168.1.10/r?vers=${encodeURIComponent(cible)}`, nom: 'autre.exe' }).catch(() => undefined);
      assert.deepEqual(w.net.atteints, [], cible);
    }
    // La machine d'Odin, même tapée : jamais.
    w.net.atteints.length = 0;
    await w.v.act('fjalar', 'importer_logiciel', { lien: 'http://127.0.0.1:8080/outil.exe' }).catch(() => undefined);
    assert.deepEqual(w.net.atteints, []);
  } finally { w.v.stop(); }
});

test('download sûr : le nom d\'un miroir qui mène à la maison est refusé avant toute demande', async () => {
  const net = reseau(), dir = neuf('odin-tsurete-dl-');
  await assert.rejects(download(net.f, { version: '', url: redirige('https://interne.exemple.org/x.iso'), file: 'x.iso' }, dir, { surete: { resoudre: async (h) => (h === 'interne.exemple.org' ? ['10.0.0.5'] : ['203.0.113.10']) } }), /maison ou de la machine/);
  assert.deepEqual(net.atteints, []);
});

test('Atalante : un lien public qui renvoie vers la machine, la maison, un nom local ou en http n\'est jamais suivi', async () => {
  const w = monde();
  reseauAtalante({ resoudre });
  try {
    w.v.ctx('atalante').saveSettings({ dossier: join(w.home, 'rangement') });
    for (const [quoi, cible] of PIEGES) {
      w.net.atteints.length = 0;
      const nom = `piege-${PIEGES.findIndex((p) => p[1] === cible)}.bin`;
      const r = await w.v.act('atalante', 'ajouter', { lien: redirige(cible), nom });
      await attendreAtalante();
      assert.deepEqual(w.net.atteints, [], `${quoi} : rien n'est demandé à la cible (${r.text})`);
      assert.match((await w.v.act('atalante', 'file', {})).text, new RegExp(`${nom.replace('.', '\\.')} · echec`), quoi);
    }
    // Tapée avec l'accord du propriétaire : l'adresse de la maison est servie ; mais une maison → site public → maison
    // n'est jamais suivie jusqu'au bout.
    w.net.atteints.length = 0;
    await w.v.act('atalante', 'ajouter', { lien: 'http://192.168.1.10/nas.bin' }); await attendreAtalante();
    assert.ok(w.net.atteints.includes('http://192.168.1.10/nas.bin'));
    assert.ok(existsSync(join(w.home, 'rangement', 'Autres', 'nas.bin')));
    w.net.atteints.length = 0;
    const retour = `http://192.168.1.11/r?vers=${encodeURIComponent(redirige('http://192.168.1.12/retour.bin'))}`;
    await w.v.act('atalante', 'ajouter', { lien: retour, nom: 'retour.bin' }); await attendreAtalante();
    assert.ok(!w.net.atteints.includes('http://192.168.1.12/retour.bin'), 'jamais la maison atteinte depuis un site public');
    // Un lien public en http tapé par le propriétaire reste possible (usage existant).
    w.net.atteints.length = 0;
    await w.v.act('atalante', 'ajouter', { lien: 'http://dl.exemple.org/doc.bin' }); await attendreAtalante();
    assert.ok(w.net.atteints.includes('http://dl.exemple.org/doc.bin'));
  } finally { w.v.stop(); }
});

test('la sonde partagée (Atalante, Comète) : jamais de https vers http, ni vers un nom à une étiquette', async () => {
  for (const cible of ['http://miroir.exemple.org/x.bin', 'https://nas/x.bin']) {
    const net = reseau();
    await assert.rejects(sonder(net.f, redirige(cible)));
    assert.deepEqual(net.atteints, [], cible);
  }
  const net = reseau();
  assert.equal((await sonder(net.f, redirige('https://miroir.exemple.org/x.bin'))).url, 'https://miroir.exemple.org/x.bin');
});
