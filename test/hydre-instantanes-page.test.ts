// Hydre, les instantanés d'une VM de ce PC (la page) : dans un vrai navigateur, sur un vrai Odin d'essai.
// AUCUNE vraie VM et AUCUN vrai qemu-img : un faux qemu-img et un faux canal QMP dans le même processus tiennent les
// instantanés de chaque disque ; le processus de la VM est simulé ; la place du disque aussi.
// - l'onglet « Instantanés » : la liste (nom, date, taille, tout seul ou à la main), « Prendre un instantané » ;
// - « Revenir ici » : le garde-fou dit ce qui est perdu, puis Odin prend un instantané de maintenant et revient ;
// - la corbeille : le garde-fou « Retirer », puis l'instantané part ;
// - les automatiques, comme la maquette validée : son en-tête, son seul interrupteur et ses mots (« Avant chaque mise à
//   jour du système », « un instantané tout seul, gardé 7 jours ») ; aucun choix « combien en garder » ; la place et le
//   budget (bouton coupé sans place) ;
// - sous Windows : la raison, rien d'autre ;
// - 390 et 1280 px, thème clair et sombre : rien ne déborde, les cibles font 44 px, la ligne de la frise s'arrête au
//   dernier point ;
// - le clavier : il revient où l'on était (après « Prendre », l'interrupteur, un garde-fou fermé, même pour un nom à
//   guillemets venu d'un disque importé) ; Échap ferme un garde-fou ;
// - la lecture : le bouton rouge lisible (contraste 4,5), le texte du garde-fou pas plus grand que son titre, le titre
//   de l'interrupteur de la taille de ceux de la liste, le message du réglage sous l'interrupteur.
// Sans Playwright sur la machine, l'essai est ignoré (il le dit). Avec HYDRE_INSTANTANES_CAPTURES=<dossier>, il garde ses captures.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';
import { systemeVm, type Machine } from '../src/valhalla/ymir/local.ts';
import { hoteVm } from '../src/valhalla/ymir/creation.ts';
import { systemeInstantanes } from '../src/valhalla/ymir/instantanes.ts';

interface Loc { click(o?: Record<string, unknown>): Promise<void>; count(): Promise<number>; textContent(): Promise<string | null>; first(): Loc; getAttribute(n: string): Promise<string | null>; isDisabled(): Promise<boolean> }
interface Page { goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; waitForTimeout(n: number): Promise<void>; evaluate<R>(f: string): Promise<R>; locator(s: string, o?: Record<string, unknown>): Loc; screenshot(o: Record<string, unknown>): Promise<unknown>; on(e: string, f: (x: unknown) => void): void; keyboard: { press(k: string): Promise<void> } }
interface Contexte { addCookies(c: unknown[]): Promise<void>; addInitScript(s: string): Promise<void>; newPage(): Promise<Page>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sans = pw ? false : 'Playwright n\'est pas installé sur cette machine';
const CAPTURES = process.env.HYDRE_INSTANTANES_CAPTURES;
const GO = 1024 ** 3;

const t = new T();
let od: VraiOdin, nav: Navigateur | undefined, dMachines = '';
const origine = { sv: { ...systemeVm }, si: { ...systemeInstantanes }, h: { ...hoteVm } };
interface Snap { name: string; dateSec: number; vmState: number }
/** Le faux QEMU : par disque, ses instantanés ; la VM 5001 (vm-web) est allumée, les autres éteintes. */
const Q = { disques: new Map<string, Snap[]>(), vivants: new Set<number>([5001]), horloge: 1_790_000_000, qmp: [] as string[], img: [] as string[][] };
const VM = (o: Partial<Machine>): Machine => ({ id: 'e5c4b3a2f1d0', nom: 'vm-web', genre: 'vm', systeme: 'Debian', version: '13', famille: 'Linux', cpu: 2, ram: 2048, disque: 32, ip: '10.0.3.80', mac: '02:0d:1e:00:00:08', cree: 0, apps: [], paquets: [], ...o });
const snaps = (nom: string) => { const f = join(dMachines, 'vm', nom, 'disque.qcow2'); if (!Q.disques.has(f)) Q.disques.set(f, []); return Q.disques.get(f)!; };

before(async () => {
  if (!pw) return;
  od = await vraiOdin(t, { compte: true });
  const v = valhallaOf()!, ctx = v.ctx('ymir'), qdir = join(ctx.dir, 'qmp'); dMachines = join(ctx.dir, 'machines');
  mkdirSync(qdir, { recursive: true, mode: 0o700 });
  systemeVm.plateforme = () => 'linux'; systemeVm.dossiersQmp = () => [qdir];
  systemeVm.enVie = (p: number) => Q.vivants.has(p);
  hoteVm.coeurs = () => 8; hoteVm.memoire = () => 32 * GO; hoteVm.disque = () => ({ total: 500 * GO, libre: 200 * GO });
  const l = [VM({}), VM({ id: 'aa0000000002', nom: 'vm-labo', ip: '10.0.3.81' }), VM({ id: 'ff0000000005', nom: 'serveur-de-fichiers-principal-du-salon', ip: '10.0.3.85' })];
  const vmDe = (sock: string) => l.find((m) => sock.endsWith(`${m.id}.qmp`))!;
  systemeInstantanes.qemuImg = async (_c, args) => {
    Q.img.push(args);
    const file = args.at(-1)!; if (!Q.disques.has(file)) Q.disques.set(file, []); const s = Q.disques.get(file)!;
    if (args[0] === 'info') return { code: 0, err: '', out: JSON.stringify({ format: 'qcow2', 'actual-size': 4 * GO + s.reduce((a, x) => a + x.vmState, 0), snapshots: s.map((x, k) => ({ id: String(k + 1), name: x.name, 'date-sec': x.dateSec, 'vm-state-size': x.vmState })) }) };
    if (args[1] === '-c') { s.push({ name: args[2], dateSec: Q.horloge++, vmState: 0 }); return { code: 0, out: '', err: '' }; }
    if (args[1] === '-a') return { code: 0, out: '', err: '' };
    if (args[1] === '-d') { const k = s.findIndex((x) => x.name === args[2]); if (k >= 0) s.splice(k, 1); return { code: 0, out: '', err: '' }; }
    return { code: 1, out: '', err: 'essai' };
  };
  systemeVm.qmp = async (sock: string, execute: string, args?: Record<string, unknown>) => {
    const m = vmDe(sock), s = snaps(m.nom);
    if (execute === 'human-monitor-command') {
      const [cmd, tag] = String(args?.['command-line']).split(' '); Q.qmp.push(`${cmd} ${tag}`);
      if (cmd === 'savevm') { s.push({ name: tag, dateSec: Q.horloge++, vmState: 2 * GO }); return ''; }
      if (cmd === 'loadvm') return s.some((x) => x.name === tag) ? '' : 'Error: introuvable';
      if (cmd === 'delvm') { const k = s.findIndex((x) => x.name === tag); if (k >= 0) s.splice(k, 1); return ''; }
    }
    Q.qmp.push(execute);
    if (execute === 'query-status') return { running: true, status: 'running' };
    if (execute === 'stop' || execute === 'cont') return {};
    throw new Error(`essai : ${execute}`);
  };
  for (const [m, pid] of [[l[0], 5001], [l[1], 5002], [l[2], 5005]] as const) { mkdirSync(join(dMachines, 'vm', m.nom), { recursive: true }); writeFileSync(join(dMachines, 'vm', m.nom, 'pid'), String(pid)); writeFileSync(join(dMachines, 'vm', m.nom, 'disque.qcow2'), 'faux disque'); writeFileSync(join(qdir, `${m.id}.qmp`), ''); }
  writeFileSync(join(dMachines, 'machines.json'), JSON.stringify(l));
  // vm-web a déjà deux instantanés : un à la main (avec sa mémoire), un tout seul avant une mise à jour.
  snaps('vm-web').push({ name: 'odin-20261116-182000-aaaa', dateSec: 1_763_317_200, vmState: 2 * GO }, { name: 'odin-20261121-030000-bbbb', dateSec: 1_763_694_000, vmState: 0 });
  writeFileSync(join(dMachines, 'vm', 'vm-web', 'instantanes.json'), JSON.stringify([{ tag: 'odin-20261116-182000-aaaa', nom: 'Après l\'installation', at: 1_763_317_200_000 }, { tag: 'odin-20261121-030000-bbbb', auto: 'maj', at: 1_763_694_000_000 }]));
  // vm-labo vient d'un disque importé : un instantané qu'Odin n'a pas pris, au nom avec des guillemets.
  snaps('vm-labo').push({ name: 'import "ancien"', dateSec: 1_760_000_000, vmState: 0 });
  await od.json('/api/valhalla/act', { module: 'apparence', action: 'theme', input: { theme: 'valhalla' } });
  nav = await pw.chromium.launch();
});
after(async () => { await nav?.close(); Object.assign(systemeVm, origine.sv); Object.assign(systemeInstantanes, origine.si); Object.assign(hoteVm, origine.h); await t.end(); });

async function ouvrir(largeur: number, theme: 'clair' | 'sombre'): Promise<{ page: Page; ctxN: Contexte; erreurs: string[] }> {
  const doigt = largeur < 500;
  const ctxN = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 844 : 900 }, colorScheme: theme === 'sombre' ? 'dark' : 'light', hasTouch: doigt, isMobile: doigt, locale: 'fr-FR' });
  const [name, ...v] = od.session.split('=');
  await ctxN.addCookies([{ name, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctxN.addInitScript(`try { localStorage.setItem('odin.theme', ${JSON.stringify(theme)}); localStorage.setItem('odin.tour', 'done'); } catch {}`);
  const page = await ctxN.newPage(), erreurs: string[] = [];
  page.on('pageerror', (x) => erreurs.push(String(x))); page.on('console', (x) => { const m = x as { type(): string; text(): string }; if (m.type() === 'error' && !/ERR_NETWORK_CHANGED/.test(m.text())) erreurs.push(m.text()); });
  await page.goto(`${od.url}/`); await page.waitForSelector('#app:not([hidden])', { timeout: 30000 }); await page.waitForTimeout(600);
  await page.evaluate('window.OdinApps.app("ymir")');
  await page.waitForSelector('.ym-tabs', { timeout: 30000 });
  await page.locator('.ym-tabs button', { hasText: 'Instantanés' }).click();
  await page.waitForSelector('.ym-inst', { timeout: 30000 });
  return { page, ctxN, erreurs };
}
async function attendre(page: Page, expr: string, ms = 15000): Promise<void> { const fin = Date.now() + ms; while (Date.now() < fin) { if (await page.evaluate(expr)) return; await page.waitForTimeout(100); } throw new Error(`toujours faux après ${ms} ms : ${expr}`); }
/** Une capture (la page défile dans son cadre : on en prend une par morceau, de la liste aux réglages). */
const capture = async (page: Page, nom: string) => {
  if (!CAPTURES) return; mkdirSync(CAPTURES, { recursive: true });
  for (const [k, sel] of [['a', '.ym-inst'], ['b', '.ym-snaps'], ['c', '.ym-inst .ym-opt']] as const) { await page.evaluate(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: 'start' })`); await page.screenshot({ path: join(CAPTURES, `${nom}-${k}.png`) }); }
};
const texte = (page: Page) => page.evaluate<string>(`document.querySelector('.ym-inst').innerText`);
/** L'en-tête et l'interrupteur de la maquette validée, avec ses mots ; un seul interrupteur, aucun choix « combien en garder ». */
const commeLaMaquette = async (page: Page) => {
  const tx = await texte(page);
  assert.match(tx, /Une photo de la machine à un moment : on peut y revenir\. Odin en prend un tout seul avant chaque mise à jour et avant la sauvegarde de la nuit\./);
  assert.match(tx, /Avant chaque mise à jour du système\s*un instantané tout seul, gardé 7 jours/);
  assert.doesNotMatch(tx, /Automatiques gardés|plus récents|Avant chaque sauvegarde|réglable/);
  const sw = await page.evaluate<string[][]>(`[...document.querySelectorAll('.ym-inst [role=switch]')].map((b) => [b.dataset.f, b.getAttribute('aria-label')])`);
  assert.deepEqual(sw, [['avant-maj', 'Avant chaque mise à jour du système']], 'un seul interrupteur, celui de la maquette');
  assert.equal(await page.locator('.ym-inst select, .ym-inst input, #ymInstGarder, .ym-garder').count(), 0, 'aucun choix « combien en garder »');
};
/** Les écarts d'affichage et de clavier relevés : tous dits ensemble à la fin d'un passage, pas seulement le premier. */
let ecarts: string[] = [];
const noter = (ok: boolean, quoi: string) => { if (!ok) ecarts.push(quoi); };
const devient = async (page: Page, expr: string, ms = 6000) => { try { await attendre(page, expr, ms); return true; } catch { return false; } };
/** Le contraste (WCAG) entre le texte et le fond d'un élément (fond opaque). */
const contraste = (page: Page, sel: string) => page.evaluate<number>(`(() => {
  const cs = getComputedStyle(document.querySelector(${JSON.stringify(sel)})), rgb = (t) => t.match(/[\\d.]+/g).slice(0, 3).map(Number);
  const L = (c) => c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, k) => a + v * [0.2126, 0.7152, 0.0722][k], 0);
  const a = L(rgb(cs.color)), b = L(rgb(cs.backgroundColor)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
})()`);
/** Rien ne déborde ; les commandes des instantanés font au moins 44 px ; la ligne de la frise s'arrête au dernier point. */
const verifier = async (page: Page) => {
  const fil = await page.evaluate<number | null>(`(() => {
    const ul = document.querySelector('.ym-inst .ym-snaps'); if (!ul) return null;
    const bas = (x) => { const s = getComputedStyle(x, '::before'); if (s.content === 'none' || s.display === 'none' || s.position !== 'absolute') return -1e9; return x.getBoundingClientRect().top + parseFloat(s.top) + parseFloat(s.height); };
    return Math.round(Math.max(bas(ul), ...[...ul.children].map(bas)) - ul.lastElementChild.querySelector('.pt').getBoundingClientRect().bottom);
  })()`);
  noter(fil === null || fil <= 0, `la ligne de la frise dépasse le dernier point de ${fil} px (${await page.evaluate<number>('innerWidth')} px)`);
  const m = await page.evaluate(`(() => {
    const vis = (b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden'; };
    const petites = [...document.querySelectorAll('.ym-inst button, .ym-inst select')].filter(vis).filter((b) => { const r = b.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map((b) => (b.getAttribute('aria-label') || b.textContent || b.tagName).trim().slice(0, 30) + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height));
    const deborde = [...document.querySelectorAll('.ym *')].filter(vis).filter((x) => x.getBoundingClientRect().right > innerWidth + 1 && !x.closest('.ym-tabs')).map((x) => x.tagName + '.' + x.className).slice(0, 8);
    return { page: document.documentElement.scrollWidth > innerWidth + 1, deborde, petites };
  })()`) as { page: boolean; deborde: string[]; petites: string[] };
  assert.equal(m.page, false, 'la page défile en largeur'); assert.deepEqual(m.deborde, []); assert.deepEqual(m.petites, []);
};

test('la liste, prendre, revenir (garde-fou), retirer (garde-fou), les automatiques ; 1280 clair et sombre', { skip: sans }, async () => {
  ecarts = [];
  for (const theme of ['clair', 'sombre'] as const) {
    const { page, ctxN, erreurs } = await ouvrir(1280, theme);
    try {
      await attendre(page, `document.querySelectorAll('.ym-snaps li').length >= 3`);
      const tx = await texte(page);
      assert.match(tx, /vm-web\s*· allumée/); assert.match(tx, /Après l'installation\s*le \d\d\/\d\d à \d\d:\d\d · à la main · 2 Go \(mémoire comprise\)/);
      assert.match(tx, /Avant la mise à jour\s*le \d\d\/\d\d à \d\d:\d\d · tout seul · disque seul/);
      assert.match(tx, /Maintenant\s*la machine en marche/); assert.match(tx, /Disque et instantanés : 6 Go sur ce PC\. Le budget d'Hydre laisse encore 150 Go/);
      // Les automatiques comme la maquette ; le titre de l'interrupteur a la taille des titres de la liste.
      await commeLaMaquette(page);
      assert.equal(await page.locator('[data-f="avant-maj"]').getAttribute('aria-checked'), 'true', 'allumé tant qu\'on n\'y a pas touché');
      const tailles = await page.evaluate<string[]>(`[...document.querySelectorAll('.ym-inst .ym-opt .tx b, .ym-inst .ym-snaps .nm b')].map((x) => getComputedStyle(x).fontSize)`);
      noter(tailles.length >= 4 && new Set(tailles).size === 1, `titre de l'interrupteur et titres de la liste de tailles différentes : ${tailles.join(', ')}`);
      await verifier(page); await capture(page, `1280-${theme}-01-liste`);
      if (theme === 'clair') continue;
      // Prendre : par le canal de la VM (« savevm »), puis la liste relue.
      Q.qmp.length = 0;
      await page.locator('[data-f="prendre"]').click();
      await attendre(page, `document.querySelectorAll('.ym-snaps li').length === 4`);
      assert.match(Q.qmp[0], /^savevm odin-/); assert.match(await texte(page), /vm-web : instantané pris, mémoire comprise/);
      noter(await devient(page, `document.activeElement?.dataset?.f === 'prendre'`), 'après « Prendre », le clavier revient au bouton');
      // Revenir : le garde-fou dit ce qui est perdu ; « Non » le ferme sans rien faire.
      await page.locator('[data-revenir="odin-20261116-182000-aaaa"]').click();
      await page.waitForSelector('.ym-inst .ym-guard');
      assert.match(await texte(page), /Revenir à « Après l'installation » \?\s*Tout ce qui a changé dans vm-web depuis \(fichiers, réglages\) est perdu\. Odin prend d'abord un instantané de maintenant/);
      const g = await page.evaluate<{ p: number; t: number }>(`(() => { const g = document.querySelector('.ym-inst .ym-guard'); return { p: parseFloat(getComputedStyle(g.querySelector('p')).fontSize), t: parseFloat(getComputedStyle(g.querySelector('.t')).fontSize) }; })()`);
      noter(g.p < g.t, `garde-fou : le texte (${g.p} px) n'est pas plus petit que son titre (${g.t} px)`);
      const c1 = await contraste(page, '[data-f="revenir-ok"]'); noter(c1 >= 4.5, `« Revenir à cet instantané » : contraste ${c1.toFixed(2)}, sous 4,5`);
      await capture(page, '1280-sombre-02-revenir');
      await page.locator('[data-f="revenir-non"]').click(); await attendre(page, `!document.querySelector('.ym-inst .ym-guard')`);
      // Échap ferme le garde-fou ; le clavier revient à « Revenir ici ».
      await page.locator('[data-revenir="odin-20261116-182000-aaaa"]').click(); await page.waitForSelector('.ym-inst .ym-guard');
      noter(await devient(page, `document.activeElement?.dataset?.f === 'revenir-non'`), 'garde-fou ouvert : le clavier est sur « Non »');
      await page.keyboard.press('Escape');
      noter(await devient(page, `!document.querySelector('.ym-inst .ym-guard') && document.activeElement?.dataset?.revenir === 'odin-20261116-182000-aaaa'`), 'Échap ferme le garde-fou et rend le clavier à « Revenir ici »');
      if (await page.locator('.ym-inst .ym-guard').count()) { await page.locator('[data-f="revenir-non"]').click(); await attendre(page, `!document.querySelector('.ym-inst .ym-guard')`); }
      Q.qmp.length = 0;
      await page.locator('[data-revenir="odin-20261116-182000-aaaa"]').click(); await page.locator('[data-f="revenir-ok"]').click();
      await attendre(page, `/est revenue à « Après l'installation »/.test(document.querySelector('.ym-inst')?.innerText ?? '')`);
      assert.deepEqual(Q.qmp.slice(1), ['stop', 'loadvm odin-20261116-182000-aaaa', 'cont']); assert.match(Q.qmp[0], /^savevm odin-/);
      assert.match(await texte(page), /Avant de revenir à « Après l'installation »/);
      // Un instantané pris éteinte : le garde-fou dit d'éteindre d'abord, sans bouton pour revenir.
      await page.locator('[data-revenir="odin-20261121-030000-bbbb"]').click(); await page.waitForSelector('.ym-inst .ym-guard');
      assert.match(await texte(page), /pris machine éteinte : il ne garde pas sa mémoire\. Éteins d'abord vm-web/); assert.equal(await page.locator('[data-f="revenir-ok"]').count(), 0);
      await page.locator('[data-f="revenir-non"]').click(); await attendre(page, `!document.querySelector('.ym-inst .ym-guard')`);
      // Retirer : garde-fou, puis « delvm ».
      Q.qmp.length = 0;
      await page.locator('[data-retirer="odin-20261121-030000-bbbb"]').click(); await page.waitForSelector('.ym-inst .ym-guard');
      assert.match(await texte(page), /Retirer « Avant la mise à jour » \?\s*On ne pourra plus revenir à cet instantané de vm-web/);
      const c2 = await contraste(page, '[data-f="retirer-ok"]'); noter(c2 >= 4.5, `« Retirer l'instantané » : contraste ${c2.toFixed(2)}, sous 4,5`);
      await page.locator('[data-f="retirer-ok"]').click();
      await attendre(page, `/instantané « Avant la mise à jour » retiré/.test(document.querySelector('.ym-inst')?.innerText ?? '')`);
      assert.deepEqual(Q.qmp, ['delvm odin-20261121-030000-bbbb']);
      noter(await devient(page, `document.activeElement?.dataset?.f === 'prendre'`), 'après « Retirer », le clavier revient à « Prendre un instantané »');
      // Les automatiques : l'interrupteur de la maquette, coupé puis remis.
      const reglage = () => valhallaOf()!.ctx('ymir').settings.instantanes as { avantMaj: boolean; avantSauvegarde: boolean };
      await page.locator('[data-f="avant-maj"]').click();
      await attendre(page, `document.querySelector('[data-f="avant-maj"]').getAttribute('aria-checked') === 'false'`);
      noter(await devient(page, `document.activeElement?.dataset?.f === 'avant-maj'`), 'après l\'interrupteur, le clavier y reste');
      // Le message du réglage s'affiche sous l'interrupteur (là où l'on vient de toucher), pas au-dessus de la place.
      noter(await page.evaluate<boolean>(`(() => { const g = document.querySelector('.ym-inst .ym-opt'), l = [...document.querySelectorAll('.ym-inst [role=status]')].filter((x) => /Instantanés automatiques/.test(x.textContent)); return l.length === 1 && Boolean(g.compareDocumentPosition(l[0]) & Node.DOCUMENT_POSITION_FOLLOWING); })()`), 'le message du réglage s\'affiche sous l\'interrupteur');
      assert.match(await texte(page), /Instantanés automatiques : pas avant les mises à jour, avant chaque sauvegarde ; gardés 7 jours/);
      assert.deepEqual(reglage(), { avantMaj: false, avantSauvegarde: true });
      await commeLaMaquette(page);
      await page.locator('[data-f="avant-maj"]').click();
      await attendre(page, `document.querySelector('[data-f="avant-maj"]').getAttribute('aria-checked') === 'true'`);
      noter(await devient(page, `document.activeElement?.dataset?.f === 'avant-maj'`), 'interrupteur remis : le clavier y reste');
      assert.deepEqual(reglage(), { avantMaj: true, avantSauvegarde: true });
      await verifier(page); await capture(page, '1280-sombre-03-apres');
      assert.deepEqual(erreurs, []);
    } finally { await ctxN.close(); }
  }
  assert.deepEqual(ecarts, []);
});

test('au téléphone : une VM éteinte (qemu-img), la place qui manque coupe le bouton, sous Windows la raison ; 390 clair et sombre', { skip: sans }, async () => {
  for (const theme of ['clair', 'sombre'] as const) {
    const { page, ctxN, erreurs } = await ouvrir(390, theme);
    ecarts = [];
    try {
      await attendre(page, `document.querySelectorAll('.ym-snaps li').length >= 1`);
      await page.locator('[data-inst="ff0000000005"]').click();
      await attendre(page, `document.querySelector('[data-inst="ff0000000005"]')?.getAttribute('aria-pressed') === 'true' && /la machine éteinte/.test(document.querySelector('.ym-inst')?.innerText ?? '')`);
      // Au premier passage elle n'a encore rien (l'instantané pris plus bas reste pour le thème sombre).
      if (theme === 'clair') assert.match(await texte(page), /serveur-de-fichiers-principal-du-salon n'a pas encore d'instantané/);
      noter(/un instantané pris machine éteinte demande environ 1 Go/.test(await texte(page)), 'texte de la place : « un instantané pris machine éteinte »');
      await commeLaMaquette(page);
      await verifier(page); await capture(page, `390-${theme}-01-machine`);
      if (theme === 'clair') {
        Q.img.length = 0;
        await page.locator('[data-f="prendre"]').click();
        await attendre(page, `document.querySelectorAll('.ym-snaps li').length === 2`);
        assert.deepEqual(Q.img.filter((x) => x[0] === 'snapshot').map((x) => x[1]), ['-c'], 'éteinte : qemu-img');
        assert.match(await texte(page), /disque seul/);
        await verifier(page); await capture(page, '390-clair-02-pris');
        // Plus de place dans le budget d'Hydre : le bouton est coupé, la raison est dite.
        hoteVm.disque = () => ({ total: 500 * GO, libre: 50 * GO });
        await page.locator('[data-inst="aa0000000002"]').click();
        await attendre(page, `/Pas assez de place pour un nouvel instantané/.test(document.querySelector('.ym-inst')?.innerText ?? '')`);
        assert.equal(await page.locator('[data-f="prendre"]').isDisabled(), true);
        // Un instantané d'un disque importé, au nom avec des guillemets : son garde-fou s'ouvre et se ferme, le clavier revient.
        await page.evaluate(`[...document.querySelectorAll('[data-revenir]')].find((b) => b.dataset.revenir === 'import "ancien"').click()`);
        await page.waitForSelector('.ym-inst .ym-guard');
        await page.locator('[data-f="revenir-non"]').click();
        noter(await devient(page, `!document.querySelector('.ym-inst .ym-guard') && document.activeElement?.dataset?.revenir === 'import "ancien"'`), 'garde-fou d\'un nom à guillemets fermé : le clavier revient à son « Revenir ici »');
        hoteVm.disque = () => ({ total: 500 * GO, libre: 200 * GO });
        // Sous Windows : la raison, sans liste ni bouton.
        systemeVm.plateforme = () => 'win32';
        await page.locator('.ym-tabs button', { hasText: 'Machines' }).click(); await page.waitForTimeout(300);
        await page.locator('.ym-tabs button', { hasText: 'Instantanés' }).click();
        await attendre(page, `/leurs instantanés non plus/.test(document.querySelector('.ym-inst')?.innerText ?? '')`);
        assert.equal(await page.locator('.ym-snaps').count(), 0);
        await verifier(page); await capture(page, '390-clair-03-windows');
        systemeVm.plateforme = () => 'linux';
      }
      assert.deepEqual(ecarts, []);
      assert.deepEqual(erreurs, []);
    } finally { systemeVm.plateforme = () => 'linux'; await ctxN.close(); }
  }
  assert.ok(readFileSync(join(dMachines, 'machines.json'), 'utf8').includes('vm-web'));
});
