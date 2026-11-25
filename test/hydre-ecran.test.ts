// Hydre, l'écran d'une machine virtuelle dans le navigateur (maquette « Conteneurs et machines » validée, écrans 13 et 13b),
// côté Odin. AUCUNE vraie VM : le canal de contrôle QMP est un faux QEMU (il écrit une vraie capture PPM à l'endroit
// demandé par « screendump », note chaque « send-key » et « input-send-event ») ; le processus de la VM est simulé.
// - une vue s'ouvre (jeton rendu seulement dans les données, jamais dans le texte : l'outil de l'IA ne lit que le texte) ;
// - l'image : une vraie capture convertie en PNG, à un rythme borné (deux demandes trop proches : la seconde attend,
//   sans capture), « inchangée » si l'écran n'a pas bougé ; la capture est effacée tout de suite ; en pause, l'image figée
//   avec l'état ; éteinte : aucun appel QMP, aucune image ; une capture ratée : une erreur, jamais une vieille image ;
// - le clavier par touches physiques (la disposition est celle de la VM), Ctrl+Alt+Suppr, Échap, Tab, flèches, F1-F12,
//   la touche < > des claviers européens, les touches japonaises ; un code inconnu, trop de touches : refusés ; le texte
//   du téléphone ; en pause ou éteinte : refusé ;
// - la souris : position absolue et clic (gauche, droit, milieu) ; hors de l'écran refusé ;
// - fermée (ou oubliée trop longtemps) : la vue ne vaut plus rien, et rien de l'écran n'est gardé ;
// - propriétaire seul : membre, automatisation, autre assistant, clé d'API refusés, sans toucher la VM ; l'ouverture et la
//   fermeture sont notées dans « qui a fait quoi », pas chaque image ;
// - sous Windows, un LXC, un modèle : un état clair, jamais une image ; aucun port réseau ouvert par ce code.
// Après relecture :
// - une vue retirée parce qu'une autre s'est ouverte dit « ouverte ailleurs » (la page ne la rouvre pas d'elle-même :
//   plusieurs pages ne se retirent plus leurs vues en boucle) ; une vue retirée ou oubliée laisse sa ligne de fermeture ;
// - des demandes d'image simultanées ne font qu'une capture (la borne de rythme tient) ;
// - sous Windows, la phrase parle de l'écran, pas de la pause ;
// - une tablette : « maison » refusée ; « complet » (tous les droits, choisis par le propriétaire) ne reçoit jamais le jeton.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as serveurHttp } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { systemeVm, type Machine } from '../src/valhalla/ymir/local.ts';
import { ecranHorloge, ECRAN, qcodeDe, vuesOuvertes } from '../src/valhalla/ymir/ecran.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { valhallaPost } from '../src/web/valhalla-api.ts';
import { maisonRoute } from '../src/web/maison-api.ts';
import { resetGladsheim } from '../src/valhalla/modules/gladsheim.ts';

const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
const origine = { sv: { ...systemeVm }, h: { ...ecranHorloge } };
after(() => { Object.assign(systemeVm, origine.sv); Object.assign(ecranHorloge, origine.h); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

/** Une capture PPM (P6) de w × h, d'une seule couleur. */
const ppm = (w: number, h: number, rgb: [number, number, number]) => Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`, 'latin1'), Buffer.alloc(w * h * 3).map((_, i) => rgb[i % 3])]);

/** Un faux QEMU : il tient l'état (en marche, figée, éteinte), écrit la capture demandée et note chaque commande. */
function fauxQemu() {
  const f = { enMarche: true, vivant: true, couleur: [20, 30, 60] as [number, number, number], rate: false, commandes: [] as Array<{ execute: string; args?: Record<string, unknown> }>, captures: [] as string[] };
  systemeVm.plateforme = () => 'linux';
  systemeVm.enVie = () => f.vivant;
  systemeVm.qmp = async (_sock: string, execute: string, args?: Record<string, unknown>) => {
    f.commandes.push({ execute, args });
    if (!f.vivant) throw new Error('la VM ne répond pas (QMP)');
    if (execute === 'screendump') { if (f.rate) throw new Error('essai : capture impossible'); const fic = String(args?.filename); f.captures.push(fic); writeFileSync(fic, ppm(64, 40, f.couleur)); return {}; }
    if (execute === 'send-key' || execute === 'input-send-event') return {};
    if (execute === 'query-status') return { running: f.enMarche, status: f.enMarche ? 'running' : 'paused' };
    if (execute === 'stop') { f.enMarche = false; return {}; }
    if (execute === 'cont') { f.enMarche = true; return {}; }
    throw new Error(`commande QMP inattendue : ${execute}`);
  };
  return f;
}
const VM = (o: Partial<Machine> = {}): Machine => ({ id: 'e5c4b3a2f1d0', nom: 'vm-web', genre: 'vm', systeme: 'Debian', version: '13', famille: 'Linux', cpu: 2, ram: 2048, disque: 32, ip: '10.0.3.80', mac: '02:0d:1e:00:00:08', cree: 0, apps: [], paquets: [], ...o });

/** Un Odin d'essai (aucune commande système, aucune sortie réseau) : une VM allumée, une seconde VM, un LXC, un modèle. */
function monde() {
  const home = neuf('hydre-ecran-'), qdir = join(home, 'qmp'); mkdirSync(qdir, { recursive: true, mode: 0o700 });
  systemeVm.dossiersQmp = () => [qdir];
  let t = 1_000_000; ecranHorloge.maintenant = () => t;
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), {
    run: async () => ({ code: 1, out: '', err: 'essai : aucune commande' }),
    fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre',
  });
  const d = join(home, 'valhalla', 'ymir', 'machines');
  const l = [VM(), VM({ id: 'aa0000000002', nom: 'vm-labo', ip: '10.0.3.81' }), VM({ id: 'cc0000000003', nom: 'lxc-web', genre: 'lxc', ip: '10.0.3.82' }), VM({ id: 'dd0000000004', nom: 'vm-modele', ip: '10.0.3.83', estModele: true })];
  for (const m of l) if (m.genre === 'vm') { mkdirSync(join(d, 'vm', m.nom), { recursive: true }); writeFileSync(join(d, 'vm', m.nom, 'pid'), '4242'); writeFileSync(join(qdir, `${m.id}.qmp`), ''); }
  writeFileSync(join(d, 'machines.json'), JSON.stringify(l));
  const act = (action: string, input: Record<string, unknown> = {}, o: Record<string, unknown> = {}) => v.act('ymir', action, input, o);
  const ouvrir = async (machine = 'vm-web') => { const r = await act('ecran_ouvrir', { machine }); assert.equal(r.ok, true, r.text); return (r.data as { vue: string }).vue; };
  return { v, home, qdir, d, act, ouvrir, avancer: (ms: number) => { t += ms; }, fin: () => v.stop() };
}
/** Les fichiers d'écran restés sur le disque (captures, images) : il n'en reste jamais. */
const restes = (w: { home: string }) => { const out: string[] = []; const voir = (p: string) => { for (const e of readdirSync(p, { withFileTypes: true })) { const q = join(p, e.name); if (e.isDirectory()) voir(q); else if (/\.(ppm|png)$/i.test(e.name)) out.push(q); } }; voir(w.home); return out; };

test('ouvrir l\'écran : un jeton de vue dans les données seulement, le rythme borné donné à la page', async () => {
  fauxQemu(); const w = monde();
  try {
    const r = await w.act('ecran_ouvrir', { machine: 'vm-web' });
    assert.equal(r.ok, true, r.text);
    const d = r.data as { vue: string; machine: { nom: string }; etat: string; rythme: { visible: number; pause: number; cachee: number } };
    assert.match(d.vue, /^[a-f0-9]{32}$/); assert.equal(d.machine.nom, 'vm-web'); assert.equal(d.etat, 'en marche');
    assert.ok(!r.text.includes(d.vue), 'le jeton n\'est jamais dans le texte (l\'outil de l\'IA ne lit que le texte)');
    // Au plus 5 images par seconde quand on regarde ; bien moins en pause, éteinte ou onglet caché.
    assert.ok(d.rythme.visible >= ECRAN.imageMinMs && d.rythme.visible >= 200, JSON.stringify(d.rythme));
    assert.ok(d.rythme.pause > d.rythme.visible && d.rythme.cachee > d.rythme.pause, JSON.stringify(d.rythme));
    assert.equal(vuesOuvertes(w.v.ctx('ymir')), 1);
  } finally { w.fin(); }
});

test('l\'image : une vraie capture en PNG, rythme borné, « inchangée » sans renvoi, capture effacée tout de suite', async () => {
  const f = fauxQemu(), w = monde();
  try {
    const vue = await w.ouvrir();
    const i1 = await w.act('ecran_image', { machine: 'vm-web', vue });
    assert.equal(i1.ok, true, i1.text);
    const d1 = i1.data as { png: string; etat: string; largeur: number; hauteur: number };
    const png = Buffer.from(d1.png, 'base64');
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'un PNG');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [64, 40], 'aux dimensions de l\'écran de la VM');
    assert.equal(d1.etat, 'en marche'); assert.deepEqual([d1.largeur, d1.hauteur], [64, 40]);
    assert.equal(f.captures.length, 1); assert.ok(f.captures[0].startsWith(w.qdir), 'la capture passe par le dossier réservé à Odin');
    assert.equal(existsSync(f.captures[0]), false, 'la capture est effacée tout de suite'); assert.deepEqual(restes(w), []);
    // Trop tôt : pas de capture, la page attend.
    const tot = await w.act('ecran_image', { machine: 'vm-web', vue });
    assert.equal(tot.ok, true); assert.ok((tot.data as { attendre: number }).attendre > 0); assert.equal((tot.data as { png?: string }).png, undefined);
    assert.equal(f.captures.length, 1, 'aucune capture de plus');
    // L'écran n'a pas bougé : « inchangée », sans renvoyer l'image.
    w.avancer(ECRAN.imageMinMs);
    const i2 = await w.act('ecran_image', { machine: 'vm-web', vue });
    assert.equal((i2.data as { inchange?: boolean }).inchange, true); assert.equal((i2.data as { png?: string }).png, undefined);
    // La page a perdu son image : « tout » la redemande.
    w.avancer(ECRAN.imageMinMs);
    const tout = await w.act('ecran_image', { machine: 'vm-web', vue, tout: true });
    assert.ok((tout.data as { png?: string }).png, 'l\'image est redonnée');
    // L'écran change : la nouvelle image.
    f.couleur = [200, 10, 10]; w.avancer(ECRAN.imageMinMs);
    const i3 = await w.act('ecran_image', { machine: 'vm-web', vue });
    assert.ok((i3.data as { png?: string }).png); assert.notEqual((i3.data as { png: string }).png, d1.png);
    assert.deepEqual(restes(w), [], 'aucune capture ni image ne reste');
  } finally { w.fin(); }
});

test('en pause : l\'image figée et l\'état ; éteinte : aucun appel, aucune image ; capture ratée : une erreur, jamais une vieille image', async () => {
  const f = fauxQemu(), w = monde();
  try {
    const vue = await w.ouvrir();
    assert.equal((await w.act('pause_machine', { machine: 'vm-web' })).ok, true);
    w.avancer(ECRAN.imageMinMs);
    const p = await w.act('ecran_image', { machine: 'vm-web', vue });
    assert.equal((p.data as { etat: string }).etat, 'en pause'); assert.ok((p.data as { png?: string }).png, 'l\'écran figé, tel qu\'il est');
    const tp = await w.act('ecran_touches', { machine: 'vm-web', vue, touches: 'KeyA' });
    assert.equal(tp.ok, false); assert.match(tp.text, /en pause : reprends-la/);
    const sp = await w.act('ecran_souris', { machine: 'vm-web', vue, x: 0.5, y: 0.5, bouton: 'gauche' });
    assert.equal(sp.ok, false); assert.match(sp.text, /en pause/);
    assert.equal(f.commandes.filter((c) => c.execute === 'send-key' || c.execute === 'input-send-event').length, 0);
    await w.act('reprendre_machine', { machine: 'vm-web' });
    // Capture ratée : une erreur claire, pas d'image (jamais l'ancienne).
    f.rate = true; w.avancer(ECRAN.imageMinMs);
    const ko = await w.act('ecran_image', { machine: 'vm-web', vue });
    assert.equal(ko.ok, false); assert.match(ko.text, /écran illisible/); assert.equal((ko.data as { etat: string; png?: string }).etat, 'illisible'); assert.equal((ko.data as { png?: string }).png, undefined);
    f.rate = false;
    // Éteinte : aucun appel QMP, aucune image.
    f.vivant = false; f.commandes.length = 0; w.avancer(ECRAN.imageMinMs);
    const off = await w.act('ecran_image', { machine: 'vm-web', vue });
    assert.equal(off.ok, true); assert.equal((off.data as { etat: string }).etat, 'éteinte'); assert.equal((off.data as { png?: string }).png, undefined);
    assert.deepEqual(f.commandes, [], 'rien n\'est demandé à une VM éteinte');
    assert.match((await w.act('ecran_touches', { machine: 'vm-web', vue, touches: 'KeyA' })).text, /éteinte : démarre-la/);
  } finally { w.fin(); }
});

test('le clavier : touches physiques (Ctrl+Alt+Suppr, Échap, Tab, flèches, F1-F12, < >, japonais), texte du téléphone, refus', async () => {
  const f = fauxQemu(), w = monde();
  try {
    // Pur : le code de la touche physique devient le code QMP (la disposition reste celle de la VM : AZERTY, QWERTZ…).
    for (const [code, q] of [['KeyA', 'a'], ['Digit2', '2'], ['Escape', 'esc'], ['Tab', 'tab'], ['ArrowUp', 'up'], ['ArrowLeft', 'left'], ['F1', 'f1'], ['F12', 'f12'], ['Delete', 'delete'], ['Enter', 'ret'], ['IntlBackslash', 'less'], ['ControlLeft', 'ctrl'], ['AltRight', 'alt_r'], ['IntlRo', 'ro'], ['Convert', 'henkan'], ['NumpadEnter', 'kp_enter']] as const) assert.equal(qcodeDe(code), q, code);
    assert.equal(qcodeDe('constructor'), undefined); assert.equal(qcodeDe('__proto__'), undefined); assert.equal(qcodeDe('Power'), undefined);
    const vue = await w.ouvrir(), cles = () => f.commandes.filter((c) => c.execute === 'send-key').map((c) => (c.args!.keys as Array<{ type: string; data: string }>).map((k) => `${k.type}:${k.data}`).join('+'));
    const r = await w.act('ecran_touches', { machine: 'vm-web', vue, touches: 'ControlLeft,AltLeft,Delete' });
    assert.equal(r.ok, true, r.text); assert.deepEqual(cles(), ['qcode:ctrl+qcode:alt+qcode:delete']);
    for (const t of ['Escape', 'Tab', 'ArrowDown', 'F5', 'F11', 'ShiftLeft,KeyB', 'IntlBackslash']) assert.equal((await w.act('ecran_touches', { machine: 'vm-web', vue, touches: t })).ok, true, t);
    assert.deepEqual(cles().slice(1), ['qcode:esc', 'qcode:tab', 'qcode:down', 'qcode:f5', 'qcode:f11', 'qcode:shift+qcode:b', 'qcode:less']);
    // Le texte tapé au clavier du téléphone (clavier américain dans la VM, comme le clavier de la fiche).
    f.commandes.length = 0;
    assert.equal((await w.act('ecran_touches', { machine: 'vm-web', vue, texte: 'ls -l' })).ok, true);
    assert.deepEqual(cles(), ['qcode:l', 'qcode:s', 'qcode:spc', 'qcode:minus', 'qcode:l']);
    // Refus : code inconnu, trop de touches ensemble, rien du tout, un accent au texte ; rien n'est envoyé.
    f.commandes.length = 0;
    assert.match((await w.act('ecran_touches', { machine: 'vm-web', vue, touches: 'KeyA,Power' })).text, /touche inconnue/);
    assert.match((await w.act('ecran_touches', { machine: 'vm-web', vue, touches: 'ControlLeft,AltLeft,ShiftLeft,MetaLeft,KeyA,KeyB' })).text, /trop de touches/);
    assert.match((await w.act('ecran_touches', { machine: 'vm-web', vue, touches: 'KeyA,KeyA' })).text, /deux fois/);
    assert.match((await w.act('ecran_touches', { machine: 'vm-web', vue })).text, /aucune touche/);
    assert.match((await w.act('ecran_touches', { machine: 'vm-web', vue, texte: 'é' })).text, /impossible à taper/);
    assert.match((await w.act('ecran_touches', { machine: 'vm-web', vue, texte: 'x'.repeat(ECRAN.texteMax + 1) })).text, /trop long/);
    assert.deepEqual(cles(), []);
    // Un rythme borné : au-delà de ce qu'un humain tape, la page est freinée.
    let freine = false;
    for (let k = 0; k < ECRAN.touchesParSeconde + 5; k++) { const x = await w.act('ecran_touches', { machine: 'vm-web', vue, touches: 'KeyA' }); if (x.ok === false && /trop vite/.test(x.text)) { freine = true; break; } }
    assert.ok(freine, 'les touches sont bornées par seconde'); assert.ok(cles().length <= ECRAN.touchesParSeconde);
  } finally { w.fin(); }
});

test('la souris : position absolue et clic ; hors de l\'écran refusé', async () => {
  const f = fauxQemu(), w = monde();
  try {
    const vue = await w.ouvrir(), ev = () => f.commandes.filter((c) => c.execute === 'input-send-event').map((c) => c.args!.events);
    assert.equal((await w.act('ecran_souris', { machine: 'vm-web', vue, x: 0.5, y: 0.25 })).ok, true);
    assert.deepEqual(ev(), [[{ type: 'abs', data: { axis: 'x', value: 16384 } }, { type: 'abs', data: { axis: 'y', value: 8192 } }]]);
    f.commandes.length = 0;
    for (const [b, q] of [['gauche', 'left'], ['droit', 'right'], ['milieu', 'middle']] as const) {
      f.commandes.length = 0;
      const r = await w.act('ecran_souris', { machine: 'vm-web', vue, x: 1, y: 0, bouton: b });
      assert.equal(r.ok, true, r.text);
      assert.deepEqual(ev(), [[{ type: 'abs', data: { axis: 'x', value: 32767 } }, { type: 'abs', data: { axis: 'y', value: 0 } }, { type: 'btn', data: { down: true, button: q } }], [{ type: 'btn', data: { down: false, button: q } }]], b);
    }
    f.commandes.length = 0;
    for (const [x, y] of [[-0.1, 0.5], [0.5, 1.2], ['abc', 0.2], [Number.NaN, 0]] as const) assert.match((await w.act('ecran_souris', { machine: 'vm-web', vue, x, y })).text, /hors de l'écran/, `${x},${y}`);
    assert.match((await w.act('ecran_souris', { machine: 'vm-web', vue, x: 0.2, y: 0.2, bouton: 'quatre' })).text, /bouton inconnu/);
    assert.deepEqual(ev(), []);
  } finally { w.fin(); }
});

test('la vue : jeton d\'une autre machine, inconnu, fermé ou oublié refusé ; rien de l\'écran n\'est gardé', async () => {
  const f = fauxQemu(), w = monde(), ctx = w.v.ctx('ymir');
  try {
    const vue = await w.ouvrir('vm-web');
    for (const [machine, jeton] of [['vm-labo', vue], ['vm-web', 'f'.repeat(32)], ['vm-web', '__proto__'], ['vm-web', 'constructor']] as const) {
      const r = await w.act('ecran_image', { machine, vue: jeton });
      assert.equal(r.ok, false, `${machine} ${jeton}`); assert.equal((r.data as { etat: string }).etat, 'fermee'); assert.match(r.text, /vue de l'écran.* est fermée/);
    }
    assert.equal((await w.act('ecran_image', { machine: 'vm-web', vue: '' })).ok, false, 'sans vue');
    assert.equal(f.captures.length, 0, 'aucune capture sans une vue valable');
    await w.act('ecran_touches', { machine: 'vm-web', vue, touches: 'KeyA' }); await w.act('ecran_souris', { machine: 'vm-web', vue, x: 0.1, y: 0.1, bouton: 'gauche' });
    const fe = await w.act('ecran_fermer', { machine: 'vm-web', vue });
    assert.equal(fe.ok, true); assert.match(fe.text, /Écran de vm-web fermé \(1 touche, 1 clic\)/);
    assert.equal(vuesOuvertes(ctx), 0);
    assert.equal((await w.act('ecran_image', { machine: 'vm-web', vue })).ok, false, 'fermée : elle ne vaut plus rien');
    assert.equal((await w.act('ecran_touches', { machine: 'vm-web', vue, touches: 'KeyA' })).ok, false);
    // Oubliée (onglet fermé sans le dire) : au-delà de sa durée sans nouvelles, elle ne vaut plus rien non plus.
    const v2 = await w.ouvrir('vm-web'); w.avancer(ECRAN.vueSansNouvellesMs + 1);
    assert.equal((await w.act('ecran_image', { machine: 'vm-web', vue: v2 })).ok, false);
    assert.equal(vuesOuvertes(ctx), 0);
    // Pas plus de quelques vues à la fois : la plus ancienne laisse sa place.
    const l: string[] = []; for (let k = 0; k < ECRAN.vuesMax + 1; k++) l.push(await w.ouvrir());
    assert.equal(vuesOuvertes(ctx), ECRAN.vuesMax);
    w.avancer(ECRAN.imageMinMs);
    assert.equal((await w.act('ecran_image', { machine: 'vm-web', vue: l[0] })).ok, false, 'la plus ancienne est fermée');
    assert.equal((await w.act('ecran_image', { machine: 'vm-web', vue: l.at(-1) })).ok, true);
    assert.deepEqual(restes(w), [], 'aucune capture ni image sur le disque');
  } finally { w.fin(); }
});

test('propriétaire seul : membre, automatisation, autre assistant, clé d\'API refusés ; ouverture et fermeture notées, pas chaque image', async () => {
  const f = fauxQemu(), w = monde();
  setValhalla(w.v);
  try {
    const ids = ['ecran_ouvrir', 'ecran_image', 'ecran_touches', 'ecran_souris', 'ecran_fermer'];
    for (const id of ids) { const a = w.v.action('ymir', id)?.a; assert.equal(a?.proprietaireSeul, true, id); assert.notEqual(a?.read, true, `${id} : pas une lecture libre`); assert.equal(a?.quick, false, `${id} : pas de bouton générique`); }
    const vue = await w.ouvrir(); f.commandes.length = 0;
    const refus = /seul le propriétaire/;
    for (const [qui, o] of [['un membre', { qui: 'member' }], ['une automatisation', { auto: true, by: 'automatisation' }], ['un autre assistant', { by: 'assistant', auto: true }], ['une conversation marquée', { marque: true }]] as const) {
      assert.match((await w.act('ecran_ouvrir', { machine: 'vm-web' }, o)).text, refus, qui);
      assert.match((await w.act('ecran_image', { machine: 'vm-web', vue }, o)).text, refus, qui);
      assert.match((await w.act('ecran_touches', { machine: 'vm-web', vue, touches: 'ControlLeft,AltLeft,Delete' }, o)).text, refus, qui);
      assert.match((await w.act('ecran_souris', { machine: 'vm-web', vue, x: 0.5, y: 0.5, bouton: 'gauche' }, o)).text, refus, qui);
    }
    const cle = await valhallaPost('/api/valhalla/act', { module: 'ymir', action: 'ecran_touches', input: { machine: 'vm-web', vue, touches: 'KeyA' }, confirm: true }) as { ok: boolean; text: string };
    assert.equal(cle.ok, false); assert.match(cle.text, /pas avec la clé d'API/);
    assert.deepEqual(f.commandes, [], 'aucun refusé n\'a touché la VM');
    // « Qui a fait quoi » : l'ouverture et la fermeture (avec le compte des touches), pas chaque image ni chaque touche.
    w.avancer(ECRAN.imageMinMs); await w.act('ecran_image', { machine: 'vm-web', vue });
    await w.act('ecran_touches', { machine: 'vm-web', vue, touches: 'KeyA' }); await w.act('ecran_touches', { machine: 'vm-web', vue, touches: 'KeyB' });
    await w.act('ecran_fermer', { machine: 'vm-web', vue });
    const j = (await w.act('qui_a_fait')).text;
    assert.match(j, /propriétaire · Ouvrir l'écran \(machine : vm-web\) · fait/);
    assert.match(j, /propriétaire · Fermer l'écran \(machine : vm-web\) · fait : Écran de vm-web fermé \(2 touches, 0 clic\)/);
    assert.doesNotMatch(j, /Image de l'écran|Touches à l'écran|Souris/);
    assert.ok(!j.includes(vue), 'le jeton n\'est pas dans le journal');
  } finally { setValhalla(undefined); w.fin(); }
});

test('sous Windows, un LXC, un modèle, une machine inconnue : un état clair, jamais une image', async () => {
  const f = fauxQemu(), w = monde();
  try {
    systemeVm.plateforme = () => 'win32';
    const win = await w.act('ecran_ouvrir', { machine: 'vm-web' });
    assert.equal(win.ok, false); assert.match(win.text, /Sous Windows, les VM de ce PC ne tournent pas encore dans Hydre/); assert.equal((win.data as { etat: string }).etat, 'moteur');
    systemeVm.plateforme = () => 'linux';
    const lxc = await w.act('ecran_ouvrir', { machine: 'lxc-web' });
    assert.equal(lxc.ok, false); assert.match(lxc.text, /LXC n'a pas d'écran/); assert.equal((lxc.data as { etat: string }).etat, 'lxc');
    assert.match((await w.act('ecran_ouvrir', { machine: 'vm-modele' })).text, /est un modèle/);
    assert.match((await w.act('ecran_ouvrir', { machine: 'aucune' })).text, /machine introuvable/);
    // Une vue ouverte sous Linux ne donne plus d'image si Odin se retrouve sous Windows (aucune capture tentée).
    const vue = await w.ouvrir(); systemeVm.plateforme = () => 'win32'; w.avancer(ECRAN.imageMinMs);
    const i = await w.act('ecran_image', { machine: 'vm-web', vue });
    assert.equal(i.ok, false); assert.equal((i.data as { etat: string; png?: string }).etat, 'moteur'); assert.equal((i.data as { png?: string }).png, undefined);
    assert.equal(f.commandes.length, 0);
  } finally { systemeVm.plateforme = () => 'linux'; w.fin(); }
});

test('aucun port réseau : l\'écran parle à la VM par son canal local (QMP), sans serveur ni connexion à lui', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'valhalla', 'ymir', 'ecran.ts'), 'utf8');
  assert.doesNotMatch(src, /from 'node:(net|http|https|http2|dgram|tls)'/);
  assert.doesNotMatch(src, /createServer|\.listen\(|vnc|spice/i);
  assert.match(src, /systemeVm\.qmp\(/, 'tout passe par le canal de contrôle d\'Hydre');
});

test('relecture : une vue retirée par une autre dit « ouverte ailleurs », et sa fermeture est notée', async () => {
  fauxQemu(); const w = monde();
  setValhalla(w.v);
  try {
    const l: string[] = []; for (let k = 0; k < ECRAN.vuesMax + 1; k++) l.push(await w.ouvrir());
    w.avancer(ECRAN.imageMinMs);
    const r = await w.act('ecran_image', { machine: 'vm-web', vue: l[0] });
    assert.equal(r.ok, false); assert.equal((r.data as { etat: string }).etat, 'ailleurs', 'la page sait qu\'on lui a pris sa place : elle ne rouvre pas d\'elle-même');
    assert.match(r.text, /ouvert ailleurs/);
    // Un jeton jamais donné reste « fermée » (rien n'est dit sur les autres vues).
    assert.equal(((await w.act('ecran_image', { machine: 'vm-web', vue: 'a'.repeat(32) })).data as { etat: string }).etat, 'fermee');
    const j = (await w.act('qui_a_fait')).text;
    assert.match(j, /Fermer l'écran \(machine : vm-web\) · fait : Écran de vm-web fermé : ouvert ailleurs/);
    assert.ok(!l.some((v) => j.includes(v)), 'aucun jeton dans le journal');
  } finally { setValhalla(undefined); w.fin(); }
});

test('relecture : une vue oubliée (sans nouvelles) laisse aussi sa ligne de fermeture', async () => {
  fauxQemu(); const w = monde(), ctx = w.v.ctx('ymir');
  setValhalla(w.v);
  try {
    const vue = await w.ouvrir();
    await w.act('ecran_touches', { machine: 'vm-web', vue, touches: 'KeyA' });
    w.avancer(ECRAN.vueSansNouvellesMs + 1);
    assert.equal(vuesOuvertes(ctx), 0);
    const j = (await w.act('qui_a_fait')).text;
    assert.match(j, /Odin seul · Fermer l'écran \(machine : vm-web\) · fait : Écran de vm-web fermé : sans nouvelles de la page depuis une minute \(1 touche, 0 clic\)/);
    assert.equal((j.match(/Fermer l'écran/g) ?? []).length, 1, 'une seule ligne');
  } finally { setValhalla(undefined); w.fin(); }
});

test('relecture : des demandes d\'image simultanées ne font qu\'une capture (la borne de rythme tient)', async () => {
  const f = fauxQemu(), w = monde();
  try {
    const vue = await w.ouvrir();
    const l = await Promise.all([0, 1, 2].map(() => w.act('ecran_image', { machine: 'vm-web', vue })));
    assert.equal(f.captures.length, 1, `${f.captures.length} captures pour 3 demandes au même instant`);
    assert.equal(l.filter((r) => (r.data as { png?: string }).png).length, 1);
    assert.equal(l.filter((r) => (r.data as { attendre?: number }).attendre).length, 2);
  } finally { w.fin(); }
});

test('relecture : sous Windows, la phrase parle de l\'écran (pas de la pause)', async () => {
  fauxQemu(); const w = monde();
  try {
    systemeVm.plateforme = () => 'win32';
    const win = await w.act('ecran_ouvrir', { machine: 'vm-web' });
    assert.equal(win.ok, false); assert.match(win.text, /écran/i); assert.doesNotMatch(win.text, /pause/i);
  } finally { systemeVm.plateforme = () => 'linux'; w.fin(); }
});

test('relecture : une tablette « maison » est refusée ; « complet » ne reçoit jamais le jeton de la vue', async () => {
  const f = fauxQemu(), w = monde();
  setValhalla(w.v); resetGladsheim();
  const srv = serveurHttp((req, res) => { void maisonRoute(req, res, new URL(req.url!, 'http://x'), { authed: false, name: '', mascot: '<svg></svg>', fail: () => {}, ask: async () => '' }).then((fait) => { if (!fait) { res.writeHead(404); res.end(); } }); });
  try {
    assert.notEqual((await w.v.act('gladsheim', 'bouton', { appli: 'ymir', action: 'ecran_ouvrir', reglages: 'machine=vm-web', nom: 'Écran' })).ok, false);
    const tuile = (w.v.ctx('gladsheim').settings.tiles as Array<{ id: string; module: string }>).find((t) => t.module === 'ymir')!;
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const appel = async (droits: string) => {
      const key = ((await w.v.act('gladsheim', 'cle_tablette', { nom: `Tablette ${droits}`, droits })).data as { key: string }).key;
      return await (await fetch(`${base}/api/maison/bouton`, { method: 'POST', headers: { 'x-odin-maison': key, 'x-odin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ id: tuile.id, confirm: true }) })).json() as Record<string, unknown>;
    };
    const maison = await appel('maison');
    assert.equal(maison.ok, false); assert.match(String(maison.text), /droits « maison »/);
    assert.equal(f.captures.length, 0);
    const complet = await appel('complet');
    assert.deepEqual(Object.keys(complet).sort(), ['ok', 'text'], 'seul le texte revient à la tablette');
    assert.doesNotMatch(JSON.stringify(complet), /[a-f0-9]{32}/, 'jamais le jeton');
  } finally { srv.close(); setValhalla(undefined); w.fin(); }
});
