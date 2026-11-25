// Hydre, l'écran d'une machine virtuelle dans le navigateur (la page) : dans un vrai navigateur, sur un vrai Odin d'essai.
// AUCUNE vraie VM : le canal de contrôle QMP est un faux QEMU dans le même processus (il écrit une vraie capture à chaque
// « screendump », note les touches et la souris) ; le processus de la VM est simulé.
// - l'onglet « Écran » (et le bouton « Écran » d'une carte allumée) : l'image arrive et se renouvelle quand l'écran change ;
// - le clavier : un clic donne le clavier à la VM (et rien d'autre), Échap, Tab, F2 et une lettre partent comme touches
//   physiques, Ctrl+Alt rend le clavier à la page ; « Ctrl+Alt+Suppr » ; la souris : un clic à la bonne place ;
// - le rythme baisse quand l'onglet est caché et quand la machine est en pause (voile « En pause ») ;
// - éteinte : un état clair et « Démarrer », jamais une image ; sous Windows : la raison ;
// - quitter l'onglet ferme la vue : Odin ne garde plus rien ; le plein écran ;
// - au téléphone : la barre de touches (Échap, Tab, Ctrl, Alt, flèches, Entrée, F1 à F12), Ctrl collant, le clavier du téléphone ;
// - 390 et 1280 px, thème clair et sombre : rien ne déborde, les cibles font 44 px.
// Sans Playwright sur la machine, l'essai est ignoré (il le dit). Avec HYDRE_ECRAN_CAPTURES=<dossier>, il garde ses captures.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';
import { systemeVm, type Machine } from '../src/valhalla/ymir/local.ts';
import { vuesOuvertes } from '../src/valhalla/ymir/ecran.ts';

interface Loc { click(o?: Record<string, unknown>): Promise<void>; focus(): Promise<void>; count(): Promise<number>; textContent(): Promise<string | null>; first(): Loc; getAttribute(n: string): Promise<string | null>; boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> }
interface Page { goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; waitForTimeout(n: number): Promise<void>; evaluate<R>(f: string | ((a: never) => R), a?: unknown): Promise<R>; locator(s: string, o?: Record<string, unknown>): Loc; keyboard: { press(k: string): Promise<void>; down(k: string): Promise<void>; up(k: string): Promise<void>; type(t: string): Promise<void> }; mouse: { click(x: number, y: number): Promise<void> }; screenshot(o: Record<string, unknown>): Promise<unknown>; on(e: string, f: (x: unknown) => void): void }
interface Contexte { addCookies(c: unknown[]): Promise<void>; addInitScript(s: string): Promise<void>; newPage(): Promise<Page>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sans = pw ? false : 'Playwright n\'est pas installé sur cette machine';
const CAPTURES = process.env.HYDRE_ECRAN_CAPTURES;

const t = new T();
let od: VraiOdin, nav: Navigateur | undefined;
const origine = { ...systemeVm };
/** Le faux QEMU : une VM allumée (vm-web), une éteinte (vm-labo) ; il écrit une capture et note touches et souris. */
const Q = { enMarche: true, vivants: new Set<number>([5001]), couleur: 40, captures: 0, touches: [] as string[], souris: [] as unknown[] };
const ppm = (w: number, h: number, c: number) => { const px = Buffer.alloc(w * h * 3); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = (y * w + x) * 3; px[k] = c; px[k + 1] = (x * 255 / w) | 0; px[k + 2] = (y * 255 / h) | 0; } return Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`, 'latin1'), px]); };
const VM = (o: Partial<Machine>): Machine => ({ id: 'e5c4b3a2f1d0', nom: 'vm-web', genre: 'vm', systeme: 'Debian', version: '13', famille: 'Linux', cpu: 2, ram: 2048, disque: 32, ip: '10.0.3.80', mac: '02:0d:1e:00:00:08', cree: 0, apps: [], paquets: [], ...o });

before(async () => {
  if (!pw) return;
  od = await vraiOdin(t, { compte: true });
  const v = valhallaOf()!, ctx = v.ctx('ymir'), qdir = join(ctx.dir, 'qmp'), d = join(ctx.dir, 'machines');
  mkdirSync(qdir, { recursive: true, mode: 0o700 });
  systemeVm.plateforme = () => 'linux'; systemeVm.dossiersQmp = () => [qdir];
  systemeVm.enVie = (p: number) => Q.vivants.has(p);
  systemeVm.qmp = async (_s: string, execute: string, args?: Record<string, unknown>) => {
    if (execute === 'screendump') { Q.captures++; writeFileSync(String(args?.filename), ppm(320, 200, Q.couleur)); return {}; }
    if (execute === 'send-key') { Q.touches.push((args!.keys as Array<{ data: string }>).map((k) => k.data).join('+')); return {}; }
    if (execute === 'input-send-event') { Q.souris.push(args!.events); return {}; }
    if (execute === 'query-status') return { running: Q.enMarche, status: Q.enMarche ? 'running' : 'paused' };
    if (execute === 'stop') { Q.enMarche = false; return {}; }
    if (execute === 'cont') { Q.enMarche = true; return {}; }
    throw new Error(`essai : ${execute}`);
  };
  // Relecture : une troisième VM, éteinte, au nom long (l'état doit rester visible au téléphone).
  const l = [VM({}), VM({ id: 'aa0000000002', nom: 'vm-labo', ip: '10.0.3.81' }), VM({ id: 'ff0000000005', nom: 'serveur-de-fichiers-principal-du-salon', ip: '10.0.3.85' })];
  for (const [m, pid] of [[l[0], 5001], [l[1], 5002], [l[2], 5005]] as const) { mkdirSync(join(d, 'vm', m.nom), { recursive: true }); writeFileSync(join(d, 'vm', m.nom, 'pid'), String(pid)); writeFileSync(join(d, 'vm', m.nom, 'disque.qcow2'), 'faux disque'); writeFileSync(join(qdir, `${m.id}.qmp`), ''); }
  writeFileSync(join(d, 'machines.json'), JSON.stringify(l));
  await od.json('/api/valhalla/act', { module: 'apparence', action: 'theme', input: { theme: 'valhalla' } });
  nav = await pw.chromium.launch();
});
after(async () => { await nav?.close(); Object.assign(systemeVm, origine); await t.end(); });

async function ouvrir(largeur: number, theme: 'clair' | 'sombre', onglet = true, hauteur?: number): Promise<{ page: Page; ctxN: Contexte; erreurs: string[] }> {
  const doigt = largeur < 500;
  const ctxN = await nav!.newContext({ viewport: { width: largeur, height: hauteur ?? (doigt ? 844 : 900) }, colorScheme: theme === 'sombre' ? 'dark' : 'light', hasTouch: doigt, isMobile: doigt, locale: 'fr-FR' });
  const [name, ...v] = od.session.split('=');
  await ctxN.addCookies([{ name, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctxN.addInitScript(`try { localStorage.setItem('odin.theme', ${JSON.stringify(theme)}); localStorage.setItem('odin.tour', 'done'); } catch {}`);
  const page = await ctxN.newPage(), erreurs: string[] = [];
  page.on('pageerror', (x) => erreurs.push(String(x))); page.on('console', (x) => { const m = x as { type(): string; text(): string }; if (m.type() === 'error' && !/ERR_NETWORK_CHANGED/.test(m.text())) erreurs.push(m.text()); });
  await page.goto(`${od.url}/`); await page.waitForSelector('#app:not([hidden])', { timeout: 30000 }); await page.waitForTimeout(600);
  await page.evaluate('window.OdinApps.app("ymir")');
  await page.waitForSelector('.ym-tabs', { timeout: 30000 });
  if (onglet) { await page.locator('.ym-tabs button', { hasText: 'Écran' }).click(); await page.waitForSelector('.ym-scr', { timeout: 30000 }); }
  return { page, ctxN, erreurs };
}
async function attendre(page: Page, expr: string, ms = 15000): Promise<void> { const fin = Date.now() + ms; while (Date.now() < fin) { if (await page.evaluate(expr)) return; await page.waitForTimeout(100); } throw new Error(`toujours faux après ${ms} ms : ${expr}`); }
async function attendreQue(f: () => boolean, quoi: string, ms = 10000): Promise<void> { const fin = Date.now() + ms; while (Date.now() < fin) { if (f()) return; await new Promise((ok) => setTimeout(ok, 50)); } throw new Error(`toujours faux après ${ms} ms : ${quoi}`); }
const capture = async (page: Page, nom: string, plein = false) => { if (CAPTURES) { mkdirSync(CAPTURES, { recursive: true }); await page.screenshot({ path: join(CAPTURES, `${nom}.png`), fullPage: plein }); } };
const imagePrete = `(() => { const i = document.querySelector('.ym-scr img'); return !!i && !i.hidden && i.complete && i.naturalWidth === 320; })()`;
/** Rien ne déborde de l'écran ; les commandes de l'écran font au moins 44 px. */
const verifier = async (page: Page) => {
  const m = await page.evaluate(`(() => {
    const vis = (b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden'; };
    const petites = [...document.querySelectorAll('.ym-ecr button, .ym-ecr [role=application]')].filter(vis).filter((b) => { const r = b.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map((b) => (b.getAttribute('aria-label') || b.textContent || b.tagName).trim().slice(0, 30) + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height));
    const deborde = [...document.querySelectorAll('.ym *')].filter(vis).filter((x) => x.getBoundingClientRect().right > innerWidth + 1 && !x.closest('.ym-tabs') && !x.closest('.ym-vin')).map((x) => x.tagName + '.' + x.className).slice(0, 8);
    return { page: document.documentElement.scrollWidth > innerWidth + 1, deborde, petites };
  })()`) as { page: boolean; deborde: string[]; petites: string[] };
  assert.equal(m.page, false, 'la page défile en largeur'); assert.deepEqual(m.deborde, []); assert.deepEqual(m.petites, []);
};

test('l\'image en continu, le clavier, la souris, Ctrl+Alt+Suppr, le rythme qui baisse, quitter l\'onglet ferme la vue ; 1280 sombre', { skip: sans }, async () => {
  const { page, ctxN, erreurs } = await ouvrir(1280, 'sombre');
  const ctx = valhallaOf()!.ctx('ymir');
  try {
    await attendre(page, imagePrete);
    assert.match(String(await page.locator('.ym-pick').textContent()), /vm-web · allumée.*vm-labo · éteinte/);
    assert.equal(vuesOuvertes(ctx), 1, 'une vue ouverte');
    // L'écran change : l'image suit.
    const src1 = await page.evaluate(`document.querySelector('.ym-scr img').src`) as string;
    Q.couleur = 220;
    await attendre(page, `document.querySelector('.ym-scr img').src !== ${JSON.stringify(src1)}`);
    await capture(page, '1280-sombre-01-ecran');
    // Le premier clic donne le clavier (et ne clique pas dans la VM).
    const box = (await page.locator('.ym-scr img').boundingBox())!; Q.souris.length = 0;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 4);
    await attendre(page, `!document.querySelector('.ym-scr .grab').hidden`);
    assert.equal(await page.evaluate(`document.activeElement && document.activeElement.classList.contains('ym-scr')`), true);
    assert.equal(Q.souris.length, 0, 'le premier clic ne fait que donner le clavier');
    // Les touches physiques partent dans la VM ; Tab et Échap restent dans la VM (le clavier ne quitte pas l'écran).
    Q.touches.length = 0;
    for (const k of ['KeyA', 'Escape', 'Tab', 'F2', 'Shift+KeyB']) await page.keyboard.press(k);
    await attendreQue(() => Q.touches.length >= 5, 'cinq touches');
    assert.deepEqual(Q.touches, ['a', 'esc', 'tab', 'f2', 'shift+b']);
    assert.equal(await page.evaluate(`document.activeElement && document.activeElement.classList.contains('ym-scr')`), true, 'Tab n\'a pas fait quitter l\'écran');
    // La souris : un clic à la bonne place (le milieu en largeur, le quart en hauteur).
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 4);
    await attendreQue(() => Q.souris.length >= 2, 'clic');
    const ev = Q.souris.find((e) => (e as Array<{ type: string }>).some((x) => x.type === 'btn')) as Array<{ type: string; data: { axis?: string; value?: number; button?: string; down?: boolean } }>;
    const xv = ev.find((e) => e.data.axis === 'x')!.data.value!, yv = ev.find((e) => e.data.axis === 'y')!.data.value!;
    assert.ok(Math.abs(xv - 16384) < 400 && Math.abs(yv - 8192) < 400, `${xv},${yv}`); assert.deepEqual(ev.at(-1)!.data, { down: true, button: 'left' });
    // Ctrl+Alt : le clavier revient à la page.
    await page.keyboard.down('Control'); await page.keyboard.down('Alt'); await page.keyboard.up('Alt'); await page.keyboard.up('Control');
    await attendre(page, `document.querySelector('.ym-scr .grab').hidden`);
    Q.touches.length = 0; await page.keyboard.press('KeyZ'); await page.waitForTimeout(400);
    assert.deepEqual(Q.touches, [], 'clavier rendu : plus rien ne part');
    // Ctrl+Alt+Suppr par le bouton.
    await page.locator('[data-f="cad"]').click();
    await attendreQue(() => Q.touches.includes('ctrl+alt+delete'), 'Ctrl+Alt+Suppr');
    await capture(page, '1280-sombre-02-clavier');
    // Le rythme : au plus 5 images par seconde quand on regarde.
    let n0 = Q.captures; await page.waitForTimeout(2000);
    const vues = Q.captures - n0; assert.ok(vues >= 3 && vues <= 11, `${vues} captures en 2 s`);
    // Onglet caché : presque plus rien.
    await page.evaluate(`Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'))`);
    await page.waitForTimeout(400); n0 = Q.captures; await page.waitForTimeout(2000);
    assert.ok(Q.captures - n0 <= 1, `${Q.captures - n0} captures en 2 s, onglet caché`);
    await page.evaluate(`delete document.hidden; document.dispatchEvent(new Event('visibilitychange'))`);
    // En pause : le voile, et une image toutes les quelques secondes.
    await valhallaOf()!.act('ymir', 'pause_machine', { machine: 'vm-web' });
    await attendre(page, `!document.querySelector('.ym-scr .voile').hidden`, 8000);
    await page.waitForTimeout(300); n0 = Q.captures; await page.waitForTimeout(2000);
    assert.ok(Q.captures - n0 <= 1, `${Q.captures - n0} captures en 2 s, en pause`);
    assert.ok(await page.locator('.ym-tool button', { hasText: 'Reprendre' }).count() === 1, 'Reprendre dans la barre');
    await capture(page, '1280-sombre-03-pause');
    await valhallaOf()!.act('ymir', 'reprendre_machine', { machine: 'vm-web' });
    await attendre(page, `document.querySelector('.ym-scr .voile').hidden`, 8000);
    // Le plein écran.
    await page.locator('[data-f="plein"]').click();
    await attendre(page, `!!document.fullscreenElement && document.fullscreenElement.classList.contains('ym-plein') && !!document.fullscreenElement.querySelector('.ym-scr img')`, 5000);
    assert.equal(await page.evaluate(`!!document.fullscreenElement.querySelector('[data-f="cad"]')`), true, 'Ctrl+Alt+Suppr reste là en plein écran');
    await page.locator('[data-f="plein"]').click();
    await attendre(page, `!document.fullscreenElement`, 5000);
    // Une machine éteinte : un état clair et « Démarrer », jamais une image.
    await page.locator('[data-ecran="aa0000000002"]').click();
    await attendre(page, `document.querySelector('.ym-scr .etat') && /vm-labo est éteinte/.test(document.querySelector('.ym-scr .etat').textContent)`);
    assert.equal(await page.evaluate(`document.querySelector('.ym-scr img').hidden && !document.querySelector('.ym-scr img').getAttribute('src')`), true, 'aucune image');
    assert.equal(await page.locator('.ym-scr .etat button', { hasText: 'Démarrer' }).count(), 1);
    await attendreQue(() => vuesOuvertes(ctx) === 1, 'l\'ancienne vue est fermée, une seule reste');
    await capture(page, '1280-sombre-04-eteinte');
    // Quitter l'onglet ferme la vue : Odin ne garde plus rien.
    await page.locator('.ym-tabs button', { hasText: 'Machines' }).click();
    await attendreQue(() => vuesOuvertes(ctx) === 0, 'vue fermée en quittant l\'onglet');
    n0 = Q.captures; await page.waitForTimeout(800); assert.equal(Q.captures, n0, 'plus aucune capture');
    // Le bouton « Écran » d'une carte allumée ouvre l'écran de cette machine.
    await page.waitForSelector('[data-ecr="e5c4b3a2f1d0"]', { timeout: 15000 });
    await page.locator('[data-ecr="e5c4b3a2f1d0"]').click();
    await page.waitForSelector('.ym-scr'); await attendre(page, imagePrete);
    assert.equal(await page.locator('[data-ecran="e5c4b3a2f1d0"]').getAttribute('aria-pressed'), 'true');
    await verifier(page);
    assert.deepEqual(erreurs, []);
  } finally { await ctxN.close(); }
});

test('au téléphone : la barre de touches (F1-F12, flèches, Ctrl collant), le clavier du téléphone ; 390 clair', { skip: sans }, async () => {
  const { page, ctxN, erreurs } = await ouvrir(390, 'clair');
  try {
    await attendre(page, imagePrete);
    const libelles = await page.evaluate(`[...document.querySelectorAll('.ym-vkeys button')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.textContent.trim())`) as string[];
    for (const k of ['Échap', 'Tab', 'Ctrl', 'Alt', '↑', '↓', '←', '→', 'Entrée', 'F1', 'F12']) assert.ok(libelles.includes(k), `${k} : ${libelles.join(' ')}`);
    Q.touches.length = 0;
    await page.locator('.ym-vkeys [data-k="Escape"]').click();
    await page.locator('.ym-vkeys [data-k="ctrl"]').click();
    assert.equal(await page.locator('.ym-vkeys [data-k="ctrl"]').getAttribute('aria-pressed'), 'true');
    await page.locator('.ym-vkeys [data-k="alt"]').click();
    await page.locator('.ym-vkeys [data-k="F2"]').click();
    await page.locator('.ym-vkeys [data-k="ArrowUp"]').click();
    await attendreQue(() => Q.touches.length >= 3, 'trois envois');
    assert.deepEqual(Q.touches, ['esc', 'ctrl+alt+f2', 'up'], 'Ctrl et Alt collants pour une seule touche');
    assert.equal(await page.locator('.ym-vkeys [data-k="ctrl"]').getAttribute('aria-pressed'), 'false');
    // Le clavier du téléphone : ce qui est tapé part dans la VM.
    Q.touches.length = 0;
    await page.locator('.ym-vkeys [data-k="clavier"]').click();
    assert.equal(await page.evaluate(`document.activeElement && document.activeElement.classList.contains('ym-vin')`), true);
    await page.keyboard.type('ls');
    await attendreQue(() => Q.touches.length >= 2, 'texte');
    assert.deepEqual(Q.touches, ['l', 's']);
    await capture(page, '390-clair-01-touches', true);
    await verifier(page);
    assert.deepEqual(erreurs, []);
  } finally { await ctxN.close(); }
});

for (const [largeur, theme] of [[390, 'sombre'], [1280, 'clair']] as const) {
  test(`affichage ${largeur} px, thème ${theme} : rien ne déborde, cibles de 44 px`, { skip: sans }, async () => {
    const { page, ctxN, erreurs } = await ouvrir(largeur, theme);
    try {
      await attendre(page, imagePrete); await page.waitForTimeout(200);
      await capture(page, `${largeur}-${theme}-01-ecran`, true); await verifier(page);
      await page.locator('[data-ecran="aa0000000002"]').click();
      await attendre(page, `/vm-labo est éteinte/.test(document.querySelector('.ym-scr .etat').textContent)`);
      await capture(page, `${largeur}-${theme}-02-eteinte`, true); await verifier(page);
      assert.deepEqual(erreurs, []);
    } finally { await ctxN.close(); }
  });
}

test('sous Windows : l\'écran dit pourquoi, sans image ; 390 sombre', { skip: sans }, async () => {
  systemeVm.plateforme = () => 'win32';
  const { page, ctxN, erreurs } = await ouvrir(390, 'sombre');
  try {
    await attendre(page, `!!document.querySelector('.ym-scr .etat') && /Sous Windows/.test(document.querySelector('.ym-scr .etat').textContent)`);
    // Relecture : la phrase parle de l'écran, pas de la pause.
    const phrase = String(await page.evaluate(`document.querySelector('.ym-scr .etat').textContent`));
    assert.match(phrase, /leur écran ne peut donc pas s'afficher ici/); assert.doesNotMatch(phrase, /pause/i);
    assert.equal(await page.locator('.ym-scr img').count(), 0, 'aucune image');
    await capture(page, '390-sombre-03-windows', true); await verifier(page);
    assert.deepEqual(erreurs, []);
  } finally { systemeVm.plateforme = () => 'linux'; await ctxN.close(); }
});

// Après relecture (affichage et sûreté) : la vue retirée par une autre ne se rouvre pas toute seule ; pause et reprise
// faites ailleurs changent la barre sur place sans prendre le clavier à la VM ; l'image et la barre tiennent dans l'écran
// (et remplissent le plein écran) ; un nom long garde son état ; les flèches lisibles ; la ligne d'état n'est réécrite
// que si elle change ; la note du clavier du téléphone dit que la VM doit être en clavier américain.
test('relecture : une vue retirée par une autre ne se rouvre pas d\'elle-même (« Ouvrir ici ») ; 1280 clair', { skip: sans }, async () => {
  const { page, ctxN, erreurs } = await ouvrir(1280, 'clair');
  const v = valhallaOf()!, ctx = v.ctx('ymir');
  try {
    await attendre(page, imagePrete);
    // Quatre autres écrans s'ouvrent ailleurs : celui de la page laisse sa place.
    const autres: string[] = [];
    for (let k = 0; k < 4; k++) autres.push(((await v.act('ymir', 'ecran_ouvrir', { machine: 'vm-web' })).data as { vue: string }).vue);
    await attendre(page, `/ouvert ailleurs/.test(document.querySelector('.ym-scr .etat').textContent) && !!document.querySelector('.ym-scr .etat button[data-f="ici"]')`, 8000);
    assert.equal(await page.evaluate(`document.querySelector('.ym-scr img').hidden && !document.querySelector('.ym-scr img').getAttribute('src')`), true, 'plus d\'image');
    await page.waitForTimeout(1500);
    // Elle n'a repris la place de personne : les quatre autres vues valent toujours.
    for (const vue of autres) assert.notEqual(((await v.act('ymir', 'ecran_image', { machine: 'vm-web', vue })).data as { etat?: string }).etat, 'ailleurs', 'une autre vue a été retirée par la page');
    await capture(page, 'relecture-1280-clair-ailleurs');
    // « Ouvrir ici » : la page reprend l'écran (une autre vue laisse sa place).
    await page.locator('.ym-scr .etat button[data-f="ici"]').click();
    await attendre(page, imagePrete);
    assert.equal(vuesOuvertes(ctx), 4);
    for (const vue of autres) await v.act('ymir', 'ecran_fermer', { machine: 'vm-web', vue });
    assert.deepEqual(erreurs, []);
  } finally { await ctxN.close(); }
});

test('relecture : pause et reprise faites ailleurs : la barre et le choix suivent sur place, le clavier reste à la VM ; 390 clair', { skip: sans }, async () => {
  const { page, ctxN, erreurs } = await ouvrir(390, 'clair');
  try {
    await attendre(page, imagePrete);
    await page.locator('.ym-scr').click();
    await attendre(page, `!document.querySelector('.ym-scr .grab').hidden`);
    await page.evaluate(`document.querySelector('.ym-scr').dataset.essai = 'meme'`);
    await valhallaOf()!.act('ymir', 'pause_machine', { machine: 'vm-web' });
    await attendre(page, `!document.querySelector('.ym-scr .voile').hidden`, 8000);
    // Dès le voile : « Reprendre », Ctrl+Alt+Suppr grisé, le choix dit « en pause » ; le même écran, le clavier toujours à la VM.
    const etat = `(() => { const t = document.querySelector('.ym-tool').textContent, c = document.querySelector('[data-f="cad"]'), p = document.querySelector('[data-ecran="e5c4b3a2f1d0"]').textContent, s = document.querySelector('.ym-scr'); return { reprendre: /Reprendre/.test(t), pause: /Pause/.test(t.replace('Reprendre', '')), cad: c.disabled, choix: p, meme: s.dataset.essai === 'meme', focus: document.activeElement === s, grab: !s.querySelector('.grab').hidden }; })()`;
    const p = await page.evaluate(etat) as Record<string, unknown>;
    assert.deepEqual(p, { reprendre: true, pause: false, cad: true, choix: 'vm-web · en pause', meme: true, focus: true, grab: true });
    await capture(page, 'relecture-390-clair-pause');
    await valhallaOf()!.act('ymir', 'reprendre_machine', { machine: 'vm-web' });
    await attendre(page, `document.querySelector('.ym-scr .voile').hidden`, 8000);
    const r = await page.evaluate(etat) as Record<string, unknown>;
    assert.deepEqual(r, { reprendre: false, pause: true, cad: false, choix: 'vm-web · allumée', meme: true, focus: true, grab: true });
    assert.deepEqual(erreurs, []);
  } finally { await ctxN.close(); }
});

test('relecture : l\'image et la barre tiennent dans l\'écran, le plein écran est rempli, la ligne d\'état ne clignote pas ; 1280 × 720 sombre', { skip: sans }, async () => {
  const { page, ctxN, erreurs } = await ouvrir(1280, 'sombre', true, 720);
  try {
    await attendre(page, imagePrete); await page.waitForTimeout(300);
    // Un écran d'ordinateur portable : l'écran de la VM amené en haut, la barre (Ctrl+Alt+Suppr, Plein écran, Pause) se voit aussi.
    const h = await page.evaluate(`(() => { document.querySelector('.ym-scr').scrollIntoView({ block: 'start' }); const t = document.querySelector('.ym-tool').getBoundingClientRect(), s = document.querySelector('.ym-scr').getBoundingClientRect(), i = document.querySelector('.ym-scr img').getBoundingClientRect(); return { bas: Math.round(t.bottom - s.top), haut: innerHeight, img: Math.round(i.height), ratio: Math.round(i.width / i.height * 100) / 100 }; })()`) as { bas: number; haut: number; img: number; ratio: number };
    assert.ok(h.bas <= h.haut, `l'écran et la barre font ${h.bas} px de haut (l'image ${h.img} px), la fenêtre fait ${h.haut} px`);
    assert.equal(h.ratio, 1.6, 'l\'image garde son format');
    // La ligne d'état n'est réécrite que si elle change.
    const n = await page.evaluate(`new Promise((ok) => { let n = 0; const o = new MutationObserver((l) => { n += l.length; }); o.observe(document.querySelector('.ym-tool .grow'), { childList: true, characterData: true, subtree: true }); setTimeout(() => { o.disconnect(); ok(n); }, 1500); })`) as number;
    assert.ok(n <= 1, `${n} réécritures de la ligne d'état en 1,5 s sans changement`);
    // Le plein écran : l'image remplit la largeur ou la hauteur (sans changer de format).
    await page.locator('[data-f="plein"]').click();
    await attendre(page, `!!document.fullscreenElement`, 5000); await page.waitForTimeout(300);
    const f = await page.evaluate(`(() => { const i = document.querySelector('.ym-scr img').getBoundingClientRect(); return { l: i.width / innerWidth, h: i.height / innerHeight, ratio: Math.round(i.width / i.height * 100) / 100 }; })()`) as { l: number; h: number; ratio: number };
    assert.ok(f.l > 0.9 || f.h > 0.7, `plein écran : l'image prend ${Math.round(f.l * 100)} % de la largeur, ${Math.round(f.h * 100)} % de la hauteur`);
    assert.equal(f.ratio, 1.6);
    await capture(page, 'relecture-1280-sombre-plein');
    await page.locator('[data-f="plein"]').click(); await attendre(page, `!document.fullscreenElement`, 5000);
    assert.deepEqual(erreurs, []);
  } finally { await ctxN.close(); }
});

test('relecture : au téléphone, un nom long garde son état, les flèches sont lisibles, la note dit le clavier américain ; 390 sombre', { skip: sans }, async () => {
  const { page, ctxN, erreurs } = await ouvrir(390, 'sombre');
  try {
    await attendre(page, imagePrete);
    const m = await page.evaluate(`(() => { const b = document.querySelector('[data-ecran="ff0000000005"]'), st = b.querySelector('.st'), r = b.getBoundingClientRect(), q = st && st.getBoundingClientRect(); return { st: st ? st.textContent : '', dedans: !!q && q.width > 0 && q.right <= r.right + 0.5, fleche: parseFloat(getComputedStyle(document.querySelector('.ym-vkeys [data-k="ArrowUp"]')).fontSize), note: document.querySelector('.ym-ecr .ym-note').textContent }; })()`) as { st: string; dedans: boolean; fleche: number; note: string };
    assert.equal(m.st, ' · éteinte'); assert.equal(m.dedans, true, 'l\'état d\'un nom long reste visible');
    assert.ok(m.fleche >= 16, `flèches en ${m.fleche} px`);
    assert.match(m.note, /la VM doit être réglée en clavier américain/);
    await capture(page, 'relecture-390-sombre-nom-long', true); await verifier(page);
    assert.deepEqual(erreurs, []);
  } finally { await ctxN.close(); }
});
