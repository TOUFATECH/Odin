// Hydre, cloner et exporter une VM de ce PC (la page) : dans un vrai navigateur, sur un vrai Odin d'essai.
// AUCUNE vraie VM, AUCUN vrai qemu-img : les commandes des copies passent par un faux (systemeCopies), le canal QMP et
// les instantanés aussi ; seul l'outil d'archive du système (tar) est lancé, sur les dossiers de l'essai.
// - l'onglet « Cloner et exporter », avec les mots de la maquette : le choix de la machine, le nom proposé (libre), la
//   sorte (« Liée (rapide, petite) » fermée hors d'un modèle, avec la raison ; « Complète (indépendante) ») et sa phrase,
//   « Cloner … » et « En faire un modèle » ; une copie complète, puis une copie liée depuis un modèle ;
// - exporter : « Vers une clé USB » fermée avec la raison (Genèse ne sait pas encore copier le disque d'une VM sur une
//   vraie clé) et lisible, « Dans un fichier .ody » choisie d'abord (l'empreinte vérifiée après la copie, dite seulement si
//   c'est vrai), « Vers un serveur du réseau » fermée avec la raison ; trois colonnes égales et le rond coché à 1280 ;
//   machine allumée : l'instantané le dit ; machine Windows : sa note ; la taille à copier, mesurée ; les guillemets ne
//   se séparent pas de leur mot ; le champ du nom n'a pas l'air fermé ;
// - importer : un .ody choisi est envoyé, vérifié, importé ; le clavier revient à la zone ;
// - en passant : la ligne sous l'interrupteur des instantanés quand « avant la sauvegarde » est coupé ; le bouton rouge
//   de suppression d'une machine lisible (contraste 4,5) ;
// - 390 et 1280 px, clair et sombre : rien ne déborde, les cibles font 44 px, le clavier revient où l'on était.
// Sans Playwright sur la machine, l'essai est ignoré (il le dit).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';
import { systemeVm, type Machine } from '../src/valhalla/ymir/local.ts';
import { hoteVm } from '../src/valhalla/ymir/creation.ts';
import { systemeInstantanes } from '../src/valhalla/ymir/instantanes.ts';
import { systemeCopies } from '../src/valhalla/ymir/copies.ts';

interface Loc { click(o?: Record<string, unknown>): Promise<void>; count(): Promise<number>; fill(v: string): Promise<void>; getAttribute(n: string): Promise<string | null>; isDisabled(): Promise<boolean>; setInputFiles(f: string): Promise<void> }
interface Page { goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; waitForTimeout(n: number): Promise<void>; evaluate<R>(f: string): Promise<R>; locator(s: string, o?: Record<string, unknown>): Loc; screenshot(o: Record<string, unknown>): Promise<unknown>; on(e: string, f: (x: unknown) => void): void }
interface Contexte { addCookies(c: unknown[]): Promise<void>; addInitScript(s: string): Promise<void>; newPage(): Promise<Page>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sans = pw ? false : 'Playwright n\'est pas installé sur cette machine';
const CAPTURES = process.env.HYDRE_COPIES_CAPTURES;
const GO = 1024 ** 3;
const TAR = process.platform === 'win32' && existsSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')) ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

const t = new T();
let od: VraiOdin, nav: Navigateur | undefined, dMachines = '';
const origine = { sv: { ...systemeVm }, si: { ...systemeInstantanes }, sc: { ...systemeCopies }, h: { ...hoteVm } };
const VM = (o: Partial<Machine>): Machine => ({ id: 'e5c4b3a2f1d0', nom: 'vm-web', genre: 'vm', systeme: 'Debian', version: '13', famille: 'Linux', cpu: 2, ram: 2048, disque: 32, ip: '10.0.3.80', mac: '02:0d:1e:00:00:08', cree: 0, apps: [], paquets: [], ...o });
const Q = { snaps: new Map<string, string[]>(), qmp: [] as string[], cmds: [] as string[][] };
const machines = () => JSON.parse(readFileSync(join(dMachines, 'machines.json'), 'utf8')) as Machine[];

before(async () => {
  if (!pw) return;
  od = await vraiOdin(t, { compte: true });
  const v = valhallaOf()!, ctx = v.ctx('ymir'), qdir = join(ctx.dir, 'qmp'); dMachines = join(ctx.dir, 'machines');
  mkdirSync(qdir, { recursive: true, mode: 0o700 });
  // Le budget sans accord de l'essai couvre les copies : pas de confirmation à chaque clone.
  ctx.saveSettings({ budgetVm: { memoireGo: 64, disqueGo: 4000 } });
  systemeVm.plateforme = () => 'linux'; systemeVm.dossiersQmp = () => [qdir];
  systemeVm.enVie = (p: number) => p === 5101;
  hoteVm.coeurs = () => 8; hoteVm.memoire = () => 32 * GO; hoteVm.disque = () => ({ total: 500 * GO, libre: 200 * GO });
  const l = [VM({}), VM({ id: 'aa0000000002', nom: 'vm-labo', ip: '10.0.3.81' }), VM({ id: 'bb0000000003', nom: 'vm-base', ip: '10.0.3.82', estModele: true }), VM({ id: 'cc0000000004', nom: 'vm-bureau', ip: '10.0.3.83', systeme: 'Windows', version: '11', famille: 'Windows' }), VM({ id: 'dd0000000005', nom: 'vm-vieille', ip: '10.0.3.84' })];
  const pid: Record<string, number> = { 'vm-web': 5101, 'vm-labo': 5102, 'vm-base': 5103, 'vm-bureau': 5104, 'vm-vieille': 5105 };
  for (const m of l) { mkdirSync(join(dMachines, 'vm', m.nom), { recursive: true }); writeFileSync(join(dMachines, 'vm', m.nom, 'pid'), String(pid[m.nom])); writeFileSync(join(dMachines, 'vm', m.nom, 'disque.qcow2'), 'x'.repeat(3 * 1024 * 1024)); writeFileSync(join(qdir, `${m.id}.qmp`), ''); }
  writeFileSync(join(dMachines, 'machines.json'), JSON.stringify(l));
  const lesSnaps = (f: string) => { if (!Q.snaps.has(f)) Q.snaps.set(f, []); return Q.snaps.get(f)!; };
  systemeInstantanes.qemuImg = async (_c, args) => {
    if (args[0] === 'info') return { code: 0, err: '', out: JSON.stringify({ format: 'qcow2', 'actual-size': GO, snapshots: lesSnaps(args.at(-1)!).map((x, k) => ({ id: String(k + 1), name: x, 'date-sec': 1_790_000_000 + k, 'vm-state-size': 2 * GO })) }) };
    return { code: 1, out: '', err: 'essai' };
  };
  systemeVm.qmp = async (sock: string, execute: string, args?: Record<string, unknown>) => {
    const m = machines().find((x) => sock.endsWith(`${x.id}.qmp`))!, s = lesSnaps(join(dMachines, 'vm', m.nom, 'disque.qcow2'));
    if (execute === 'human-monitor-command') {
      const [cmd, tag] = String(args?.['command-line']).split(' '); Q.qmp.push(`${cmd} ${tag}`);
      if (cmd === 'savevm') { s.push(tag); return ''; }
      if (cmd === 'delvm') { const k = s.indexOf(tag); if (k >= 0) s.splice(k, 1); return ''; }
    }
    Q.qmp.push(execute); throw new Error(`essai : ${execute}`);
  };
  systemeCopies.run = async (_c, cmd, args) => {
    Q.cmds.push([cmd, ...args]);
    if (cmd === 'ping') return { code: 1, out: '', err: '' };
    if (cmd === 'qemu-img' && args[0] === 'info') return { code: 0, out: JSON.stringify({ format: 'qcow2' }), err: '' };
    if (cmd === 'qemu-img' && args[0] === 'check') return { code: 0, out: 'No errors were found on the image.', err: '' };
    if (cmd === 'qemu-img' && args[0] === 'create') { writeFileSync(args.at(-1)!, 'copie liée'); return { code: 0, out: '', err: '' }; }
    if (cmd === 'qemu-img' && args[0] === 'convert') { copyFileSync(args.at(-2)!, args.at(-1)!); if (args.includes('-l')) appendFileSync(args.at(-1)!, 'instantané'); return { code: 0, out: '', err: '' }; }
    if (cmd === 'tar') return new Promise((ok) => execFile(TAR, args.filter((x) => x !== '--numeric-owner'), { maxBuffer: 1 << 24 }, (e, out, err) => ok({ code: e ? 1 : 0, out, err })));
    return { code: 1, out: '', err: `essai : ${cmd}` };
  };
  await od.json('/api/valhalla/act', { module: 'apparence', action: 'theme', input: { theme: 'valhalla' } });
  nav = await pw.chromium.launch();
});
after(async () => { await nav?.close(); Object.assign(systemeVm, origine.sv); Object.assign(systemeInstantanes, origine.si); Object.assign(systemeCopies, origine.sc); Object.assign(hoteVm, origine.h); await t.end(); });

async function ouvrir(largeur: number, theme: 'clair' | 'sombre', onglet = 'Cloner et exporter'): Promise<{ page: Page; ctxN: Contexte; erreurs: string[] }> {
  const doigt = largeur < 500;
  const ctxN = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 844 : 900 }, colorScheme: theme === 'sombre' ? 'dark' : 'light', hasTouch: doigt, isMobile: doigt });
  const [name, ...v] = od.session.split('=');
  await ctxN.addCookies([{ name, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctxN.addInitScript(`try { localStorage.setItem('odin.theme', ${JSON.stringify(theme)}); localStorage.setItem('odin.tour', 'done'); } catch {}`);
  const page = await ctxN.newPage(), erreurs: string[] = [];
  page.on('pageerror', (x) => erreurs.push(String(x))); page.on('console', (x) => { const m = x as { type(): string; text(): string }; if (m.type() === 'error' && !/ERR_NETWORK_CHANGED/.test(m.text())) erreurs.push(m.text()); });
  await page.goto(`${od.url}/`); await page.waitForSelector('#app:not([hidden])', { timeout: 30000 }); await page.waitForTimeout(600);
  await page.evaluate('window.OdinApps.app("ymir")');
  await page.waitForSelector('.ym-tabs', { timeout: 30000 });
  await page.locator('.ym-tabs button', { hasText: onglet }).click();
  return { page, ctxN, erreurs };
}
async function attendre(page: Page, expr: string, ms = 20000): Promise<void> { const fin = Date.now() + ms; while (Date.now() < fin) { if (await page.evaluate(expr)) return; await page.waitForTimeout(100); } throw new Error(`toujours faux après ${ms} ms : ${expr}`); }
const texte = (page: Page) => page.evaluate<string>(`[...document.querySelectorAll('.ym-cop')].map((x) => x.innerText).join('\\n')`);
const pret = (page: Page, nom: string) => attendre(page, `document.querySelector('[data-cop][aria-pressed=true]')?.textContent.startsWith(${JSON.stringify(nom)}) && Boolean(document.querySelector('.ym-cop .foot'))`);
const choisir = async (page: Page, id: string, nom: string) => { await page.locator(`[data-cop="${id}"]`).click(); await pret(page, nom); };
let ecarts: string[] = [];
const noter = (ok: boolean, quoi: string) => { if (!ok) ecarts.push(quoi); };
const devient = async (page: Page, expr: string, ms = 6000) => { try { await attendre(page, expr, ms); return true; } catch { return false; } };
const capture = async (page: Page, nom: string) => { if (!CAPTURES) return; mkdirSync(CAPTURES, { recursive: true }); await page.screenshot({ path: join(CAPTURES, `${nom}.png`), fullPage: true }); };
const contraste = (page: Page, sel: string) => page.evaluate<number>(`(() => {
  const cs = getComputedStyle(document.querySelector(${JSON.stringify(sel)})), rgb = (t) => t.match(/[\\d.]+/g).slice(0, 3).map(Number);
  const L = (c) => c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, k) => a + v * [0.2126, 0.7152, 0.0722][k], 0);
  const a = L(rgb(cs.color)), b = L(rgb(cs.backgroundColor)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
})()`);
/** Le contraste d'un texte sur ce qui est vraiment derrière lui (fonds transparents composés, opacité comprise). */
const contrasteTexte = (page: Page, sel: string) => page.evaluate<number>(`(() => {
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgba = (t) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = t; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const el = document.querySelector(${JSON.stringify(sel)}), couches = []; let op = 1;
  for (let x = el; x; x = x.parentElement) { const cs = getComputedStyle(x); op *= Number(cs.opacity); const c = rgba(cs.backgroundColor); if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && c[3] > 0) couches.push(c); }
  let fond = matchMedia('(prefers-color-scheme: dark)').matches ? [0, 0, 0] : [255, 255, 255];
  for (const c of couches.reverse()) fond = fond.map((v, k) => c[k] * c[3] + v * (1 - c[3]));
  const t = rgba(getComputedStyle(el).color), a = t[3] * op, coul = fond.map((v, k) => t[k] * a + v * (1 - a));
  const L = (c) => c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, k) => s + v * [0.2126, 0.7152, 0.0722][k], 0);
  const x = L(coul), y = L(fond); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
})()`);
/** Rien ne déborde ; les commandes de l'onglet font au moins 44 px. */
const verifier = async (page: Page) => {
  const m = await page.evaluate(`(() => {
    const vis = (b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden'; };
    const petites = [...document.querySelectorAll('.ym-cop button, .ym-cop input, .ym-cop a, .ym-cop [role=button]')].filter(vis).filter((b) => { const r = b.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map((b) => (b.getAttribute('aria-label') || b.textContent || b.tagName).trim().slice(0, 30) + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height));
    const deborde = [...document.querySelectorAll('.ym *')].filter(vis).filter((x) => x.getBoundingClientRect().right > innerWidth + 1 && !x.closest('.ym-tabs')).map((x) => x.tagName + '.' + x.className).slice(0, 8);
    return { page: document.documentElement.scrollWidth > innerWidth + 1, deborde, petites };
  })()`) as { page: boolean; deborde: string[]; petites: string[] };
  assert.equal(m.page, false, 'la page défile en largeur'); assert.deepEqual(m.deborde, []); assert.deepEqual(m.petites, []);
};

test('cloner (complète, puis liée depuis un modèle), exporter dans un .ody (éteinte, allumée), les mots de la maquette ; 1280 clair et sombre', { skip: sans }, async () => {
  ecarts = [];
  for (const theme of ['clair', 'sombre'] as const) {
    const { page, ctxN, erreurs } = await ouvrir(1280, theme);
    try {
      await pret(page, 'vm-web');
      let tx = await texte(page);
      assert.match(tx, /Cloner\s*Une deuxième machine à partir de celle-ci : son propre nom, sa propre adresse\./);
      assert.match(tx, /vm-web est allumée : une copie se fait machine éteinte/); assert.equal(await page.locator('[data-f="cloner"]').isDisabled(), true);
      assert.match(tx, /Exporter\s*La machine entière dans un fichier vérifié \(empreinte\), pour la garder, l'emporter ou la démarrer ailleurs\./);
      // Vers une clé USB : fermée tant que Genèse ne sait pas copier le disque d'une VM sur une vraie clé, la raison dite ;
      // rien ne mène à une impasse. « Dans un fichier .ody » est choisie d'abord ; vm-web tourne : l'instantané le dit.
      assert.equal(await page.locator('[data-expd="cle"]').isDisabled(), true); assert.equal(await page.locator('[data-expd="cle"]').getAttribute('aria-checked'), 'false');
      assert.equal(await page.locator('[data-expd="fichier"]').getAttribute('aria-checked'), 'true');
      assert.match(tx, /Vers une clé USB\s*«\sCopie de VM\s» sur une clé ODIN : la clé démarre sur cette machine, sur n'importe quel PC\. Pas encore possible : Genèse ne sait pas encore copier le disque d'une machine virtuelle sur une vraie clé/);
      assert.doesNotMatch(tx, /Conseillé/, 'une option fermée n\'est pas conseillée'); assert.equal(await page.locator('[data-f="cle"]').count(), 0);
      assert.match(tx, /vm-web reste allumée\s*Odin prend un instantané et exporte celui-là : la machine continue de tourner\./); assert.equal(await page.locator('[data-f="exporter"]').count(), 1);
      // Les guillemets ne se séparent pas de leur mot ; la raison d'une option fermée se lit (4,5) ; le rond coché ;
      // trois colonnes égales sur toute la largeur ; le champ du nom n'a pas l'air fermé.
      assert.doesNotMatch(tx, /« | »/);
      for (const k of ['cle', 'serveur']) { const c = await contrasteTexte(page, `[data-expd="${k}"] .p`); assert.ok(c >= 4.5, `raison de « ${k} » : contraste ${c.toFixed(2)}, sous 4,5`); }
      assert.ok(await page.evaluate<boolean>(`(() => { const t = document.querySelector('[data-expd="fichier"] .tick'); return Boolean(t) && t.getBoundingClientRect().width >= 20 && getComputedStyle(t).backgroundColor !== getComputedStyle(document.querySelector('[data-expd="cle"] .tick')).backgroundColor; })()`), 'le rond coché de la destination choisie');
      const cols = await page.evaluate<{ g: number; w: number[] }>(`(() => ({ g: document.querySelector('[aria-label="Vers"]').getBoundingClientRect().width, w: [...document.querySelectorAll('[data-expd]')].map((b) => b.getBoundingClientRect().width) }))()`);
      assert.ok(cols.w.every((x) => Math.abs(x - cols.w[0]) < 2) && cols.w.reduce((a, b) => a + b, 0) > cols.g * 0.9, `trois colonnes égales : ${cols.w.map(Math.round).join(', ')} sur ${Math.round(cols.g)}`);
      assert.doesNotMatch(await page.evaluate<string>(`getComputedStyle(document.querySelector('#ymCln')).fontFamily`), /monospace/);
      // Vers un serveur : fermé, la raison dite.
      assert.equal(await page.locator('[data-expd="serveur"]').isDisabled(), true); assert.match(tx, /Elle tourne là-bas ; ici, elle s'éteint\. Aucun serveur de virtualisation relié/);
      assert.match(tx, /Importer : dépose ici un fichier \.ody, ou clique pour le choisir\. Il passe par l'antivirus avant tout\./);
      // La taille à copier : mesurée (3 Mo de disque d'essai), jamais inventée.
      assert.match(tx, /vm-web · environ 3 Mo à copier/);
      await verifier(page); await capture(page, `1280-${theme}-01`);
      // vm-labo, éteinte : nom proposé libre ; « Liée » fermée hors d'un modèle, avec la raison.
      await choisir(page, 'aa0000000002', 'vm-labo');
      noter(await devient(page, `document.activeElement?.dataset?.cop === 'aa0000000002'`), 'après le choix de la machine, le clavier reste sur sa puce');
      tx = await texte(page);
      assert.equal(await page.evaluate<string>(`document.querySelector('#ymCln').value`), theme === 'clair' ? 'vm-labo-copie' : 'vm-labo-copie-2');
      assert.equal(await page.locator('[data-clt="liee"]').isDisabled(), true); assert.equal(await page.locator('[data-clt="complete"]').getAttribute('aria-checked'), 'true');
      assert.match(tx, /Complète : un disque à elle \(32 Go\)\. Nouvelle adresse et nouvelle carte réseau données toutes seules ; dans son système, le nom d'ordinateur ne change pas tout seul\./);
      assert.match(tx, /Une copie liée se fait depuis un modèle/);
      // Un nom déjà pris : dit tout de suite, « Cloner » fermé.
      await page.locator('#ymCln').fill('vm-base');
      await attendre(page, `/Le nom\\s«\\svm-base\\s» est déjà pris/.test(document.querySelector('#ymClnE').textContent)`);
      assert.equal(await page.locator('[data-f="cloner"]').isDisabled(), true);
      await page.locator('#ymCln').fill(theme === 'clair' ? 'vm-labo-copie' : 'vm-labo-copie-2');
      if (theme === 'clair') {
        await page.locator('[data-f="cloner"]').click();
        await attendre(page, `/vm-labo-copie : copie complète prête/.test(document.querySelector('.ym-cop')?.innerText ?? '')`);
        noter(await devient(page, `document.activeElement?.dataset?.f === 'cloner'`), 'après « Cloner », le clavier revient au bouton');
        assert.ok(machines().some((x) => x.nom === 'vm-labo-copie'));
        // Le modèle : « Liée » ouverte et choisie, sa phrase ; la copie liée.
        await choisir(page, 'bb0000000003', 'vm-base');
        assert.equal(await page.locator('[data-clt="liee"]').getAttribute('aria-checked'), 'true');
        assert.match(await texte(page), /Liée : elle partage le disque de départ et n'écrit que ses changements ; l'original ne peut plus être supprimé tant qu'elle existe\./);
        assert.equal(await page.locator('[data-f="modele"]').isDisabled(), true, 'déjà un modèle');
        await page.locator('[data-f="cloner"]').click();
        await attendre(page, `/vm-base-copie : copie liée prête/.test(document.querySelector('.ym-cop')?.innerText ?? '')`);
        assert.match(await texte(page), /Copies liées à ce modèle : vm-base-copie\./);
        assert.ok(Q.cmds.some((c) => c[0] === 'qemu-img' && c[1] === 'create'));
        // Dans un fichier .ody : l'empreinte vérifiée après la copie, dite parce que c'est vrai.
        await page.locator('[data-expd="fichier"]').click();
        await attendre(page, `document.querySelector('[data-expd="fichier"]')?.getAttribute('aria-checked') === 'true' && Boolean(document.querySelector('[data-f="exporter"]'))`);
        noter(await devient(page, `document.activeElement?.dataset?.expd === 'fichier'`), 'après le choix « Dans un fichier .ody », le clavier y reste');
        await page.locator('[data-f="exporter"]').click();
        await attendre(page, `/vm-base\\.ody enregistré/.test(document.querySelector('.ym-cop:last-of-type')?.innerText ?? '')`);
        assert.match(await texte(page), /vm-base\.ody enregistré\s*Empreinte vérifiée après la copie ✓/);
        noter(await devient(page, `document.activeElement?.dataset?.f === 'exporter'`), 'après « Exporter », le clavier revient au bouton');
      } else {
        // Allumée : l'instantané le dit, puis l'export (la machine continue de tourner).
        await choisir(page, 'e5c4b3a2f1d0', 'vm-web');
        await attendre(page, `/vm-web reste allumée\\s*Odin prend un instantané et exporte celui-là : la machine continue de tourner\\./.test(document.querySelector('.ym')?.innerText ?? '')`);
        Q.qmp.length = 0;
        await page.locator('[data-f="exporter"]').click();
        await attendre(page, `/vm-web\\.ody enregistré/.test(document.querySelector('.ym')?.innerText ?? '')`);
        assert.match(Q.qmp[0], /^savevm odin-/); assert.match(Q.qmp.at(-1)!, /^delvm odin-/);
        // Une machine Windows : sa note.
        await choisir(page, 'cc0000000004', 'vm-bureau');
        assert.match(await texte(page), /Une machine Windows emporte sa licence et ses comptes : garde la clé ou le fichier en lieu sûr\./);
        assert.match(await texte(page), /le nom d'ordinateur et l'identité de Windows ne changent pas tout seuls/);
      }
      await verifier(page); await capture(page, `1280-${theme}-02`);
      assert.deepEqual(erreurs, []);
    } finally { await ctxN.close(); }
  }
  assert.deepEqual(ecarts, []);
});

test('en passant : le bouton rouge de suppression lisible ; la ligne sous l\'interrupteur quand « avant la sauvegarde » est coupé', { skip: sans }, async () => {
  const { page, ctxN, erreurs } = await ouvrir(1280, 'clair', 'Machines');
  try {
    await page.waitForSelector('[data-sup]', { timeout: 30000 });
    const c = await contraste(page, '[data-sup]');
    assert.ok(c >= 4.5, `bouton « Supprimer » : contraste ${c.toFixed(2)}, sous 4,5`);
    await od.json('/api/valhalla/act', { module: 'ymir', action: 'reglages_instantanes', input: { avant_sauvegarde: false }, confirm: true });
    await page.locator('.ym-tabs button', { hasText: 'Instantanés' }).click();
    await page.waitForSelector('.ym-inst .ym-opt', { timeout: 30000 });
    const tx = await page.evaluate<string>(`document.querySelector('.ym-inst').innerText`);
    assert.match(tx, /Odin en prend un tout seul avant chaque mise à jour\./); assert.doesNotMatch(tx, /avant la sauvegarde de la nuit\./, 'l\'en-tête ne dit plus le contraire');
    assert.match(tx, /Avant la sauvegarde de la nuit : coupé par l'action « Réglages des instantanés »\. Aucun instantané n'est pris avant elle\./);
    assert.ok(await page.evaluate<boolean>(`Boolean(document.querySelector('.ym-inst .ym-opt').compareDocumentPosition(document.querySelector('[data-f="sans-sauvegarde"]')) & Node.DOCUMENT_POSITION_FOLLOWING)`), 'la ligne est sous l\'interrupteur');
    await od.json('/api/valhalla/act', { module: 'ymir', action: 'reglages_instantanes', input: { avant_sauvegarde: true }, confirm: true });
    assert.deepEqual(erreurs, []);
  } finally { await ctxN.close(); }
});

test('au téléphone : importer un .ody choisi (envoyé, vérifié, importé), sous Windows la raison ; 390 clair et sombre', { skip: sans }, async () => {
  ecarts = [];
  for (const theme of ['clair', 'sombre'] as const) {
    const { page, ctxN, erreurs } = await ouvrir(390, theme);
    try {
      await pret(page, 'vm-web');
      await verifier(page); await capture(page, `390-${theme}-01`);
      if (theme === 'clair') {
        // Un .ody fait ailleurs : vm-vieille exportée, puis retirée de ce PC.
        const ex = await od.json('/api/valhalla/act', { module: 'ymir', action: 'exporter_machine', input: { machine: 'vm-vieille', dossier: join(dMachines, '..', 'sortie') } });
        const fichier = String((ex.body.data as { fichier?: string } | undefined)?.fichier ?? ''); assert.ok(fichier.endsWith('vm-vieille.ody'), String(ex.body.text));
        writeFileSync(join(dMachines, 'machines.json'), JSON.stringify(machines().filter((x) => x.nom !== 'vm-vieille'))); rmSync(join(dMachines, 'vm', 'vm-vieille'), { recursive: true, force: true });
        await page.locator('[data-f="importer-fichier"]').setInputFiles(fichier);
        await attendre(page, `/vm-vieille importée \\(VM Debian 13\\)/.test(document.querySelector('.ym')?.innerText ?? '')`, 60000);
        assert.ok(machines().some((x) => x.nom === 'vm-vieille'));
        noter(await devient(page, `document.activeElement?.dataset?.f === 'importer'`), 'après l\'import, le clavier revient à la zone');
        await verifier(page); await capture(page, '390-clair-02-import');
        // Sous Windows : la raison, rien d'autre.
        systemeVm.plateforme = () => 'win32';
        await page.locator('.ym-tabs button', { hasText: 'Machines' }).click(); await page.waitForTimeout(300);
        await page.locator('.ym-tabs button', { hasText: 'Cloner et exporter' }).click();
        await attendre(page, `/les cloner et les exporter non plus/.test(document.querySelector('.ym-cop')?.innerText ?? '')`);
        assert.equal(await page.locator('[data-f="cloner"]').count(), 0);
        await verifier(page); await capture(page, '390-clair-03-windows');
        systemeVm.plateforme = () => 'linux';
      }
      assert.deepEqual(erreurs, []);
    } finally { systemeVm.plateforme = () => 'linux'; await ctxN.close(); }
  }
  assert.deepEqual(ecarts, []);
});
