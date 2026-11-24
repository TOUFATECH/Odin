// Hydre, lot M3 (la page) : la liste des machines dans un vrai navigateur, sur un vrai Odin d'essai (aucune vraie VM :
// leurs processus sont simulés, aucune commande ni sortie réseau).
// - les quatre états (allumée, en pause, éteinte, en erreur) et le filtre par état, au clavier ;
// - « En dépendent : … » sur la carte, et le bloc « Ce qui dépend de … » (noter, retirer) ;
// - supprimer : le garde-fou dans la page (refus nommé quand un dépendant vivant existe ; sinon nom écrit et disque
//   choisi, bouton éteint jusque-là), au clavier, Échap rend la main au bouton ;
// - sous Windows, la carte « Ce PC : Windows » dit ce qui viendra ;
// - 390 et 1280 px, thème clair et thème sombre d'Odin : rien ne déborde, les cibles font 44 px.
// Sans Playwright sur la machine, l'essai est ignoré (il le dit). Avec YMIR_M3_CAPTURES=<dossier>, il garde ses captures.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';
import { systemeVm, type Machine } from '../src/valhalla/ymir/local.ts';

interface Loc { click(): Promise<void>; focus(): Promise<void>; count(): Promise<number>; textContent(): Promise<string | null>; isDisabled(): Promise<boolean>; first(): Loc; locator(s: string): Loc; screenshot(o: Record<string, unknown>): Promise<unknown>; scrollIntoViewIfNeeded(): Promise<void> }
interface Page { goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; waitForTimeout(n: number): Promise<void>; evaluate<R>(f: string | ((a: never) => R), a?: unknown): Promise<R>; locator(s: string, o?: Record<string, unknown>): Loc; keyboard: { press(k: string): Promise<void>; type(t: string): Promise<void> }; fill(s: string, v: string): Promise<void>; screenshot(o: Record<string, unknown>): Promise<unknown>; on(e: string, f: (x: unknown) => void): void; waitForFunction(f: string, a?: unknown, o?: Record<string, unknown>): Promise<unknown>; reload(): Promise<unknown> }
interface Contexte { addCookies(c: unknown[]): Promise<void>; addInitScript(s: string): Promise<void>; newPage(): Promise<Page>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sans = pw ? false : 'Playwright n\'est pas installé sur cette machine';
const CAPTURES = process.env.YMIR_M3_CAPTURES;

const t = new T();
let od: VraiOdin, nav: Navigateur | undefined, dir = '';
const origine = { ...systemeVm }, vivants = new Set<number>();
const VM = (o: Partial<Machine>): Machine => ({ id: 'a00000000001', nom: 'x', genre: 'vm', systeme: 'Debian', version: '13', famille: 'Linux', cpu: 2, ram: 2048, disque: 20, ip: '10.0.3.61', mac: '02:0d:1e:00:00:61', cree: Date.parse('2026-11-18T10:00:00'), apps: [], paquets: [], ...o });
const MACHINES = [
  VM({ id: 'a00000000001', nom: 'debian-13-web', ip: '10.0.3.61' }),
  VM({ id: 'a00000000002', nom: 'dc-labo', systeme: 'Windows Server 2025', version: '', famille: 'Windows', ip: '10.0.3.10', mac: '02:0d:1e:00:00:10', disque: 60, ram: 4096 }),
  VM({ id: 'a00000000003', nom: 'nas-sauvegardes-du-salon-et-du-bureau', systeme: 'Ubuntu', version: '24.04', ip: '10.0.3.63', mac: '02:0d:1e:00:00:63', pause: { depuis: Date.now() - 3600_000 } }),
  VM({ id: 'a00000000004', nom: 'vm-bureau', systeme: 'Windows 11', version: '', famille: 'Windows', ip: '10.0.3.62', mac: '02:0d:1e:00:00:62', disque: 80, ram: 8192, cpu: 4 }),
  VM({ id: 'a00000000005', nom: 'vm-test', ip: '10.0.3.64', mac: '02:0d:1e:00:00:64' }),
  VM({ id: 'a00000000006', nom: 'vm-cassee', ip: '10.0.3.65', mac: '02:0d:1e:00:00:65' }),
];

before(async () => {
  if (!pw) return;
  od = await vraiOdin(t, { compte: true });
  const ctx = valhallaOf()!.ctx('ymir'); dir = join(ctx.dir, 'machines');
  systemeVm.plateforme = () => 'linux'; systemeVm.enVie = (pid: number) => vivants.has(pid);
  systemeVm.qmp = async () => { throw new Error('essai : pas de QMP'); }; systemeVm.dossiersQmp = () => [join(ctx.dir, 'qmp')];
  const pids: Record<string, number> = { 'debian-13-web': 201, 'dc-labo': 202, 'nas-sauvegardes-du-salon-et-du-bureau': 203 };
  for (const m of MACHINES) {
    const d = join(dir, 'vm', m.nom); mkdirSync(d, { recursive: true });
    if (m.nom !== 'vm-cassee') writeFileSync(join(d, 'disque.qcow2'), 'disque');
    if (pids[m.nom]) { writeFileSync(join(d, 'pid'), String(pids[m.nom])); vivants.add(pids[m.nom]); }
  }
  writeFileSync(join(dir, 'machines.json'), JSON.stringify(MACHINES));
  ctx.saveSettings({ dependances: [
    { id: 'd1', de: 'a00000000002', genre: 'pc', qui: 'PC du domaine', nombre: 12, at: 1 },
    { id: 'd2', de: 'a00000000002', genre: 'machine', qui: 'a00000000001', at: 1 },
    { id: 'd3', de: 'a00000000005', genre: 'autre', qui: 'le site de la maison', at: 1 },
  ] });
  await od.json('/api/valhalla/act', { module: 'apparence', action: 'theme', input: { theme: 'valhalla' } });
  nav = await pw.chromium.launch();
});
after(async () => { await nav?.close(); Object.assign(systemeVm, origine); await t.end(); });

async function ouvrir(largeur: number, theme: 'clair' | 'sombre'): Promise<{ page: Page; ctxN: Contexte; erreurs: string[] }> {
  const doigt = largeur < 500;
  const ctxN = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 844 : 900 }, colorScheme: theme === 'sombre' ? 'dark' : 'light', hasTouch: doigt, isMobile: doigt, locale: 'fr-FR' });
  const [name, ...v] = od.session.split('=');
  await ctxN.addCookies([{ name, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctxN.addInitScript(`try { localStorage.setItem('odin.theme', ${JSON.stringify(theme)}); localStorage.setItem('odin.tour', 'done'); } catch {}`);
  const page = await ctxN.newPage(), erreurs: string[] = [];
  page.on('pageerror', (x) => erreurs.push(String(x))); page.on('console', (x) => { const m = x as { type(): string; text(): string }; if (m.type() === 'error' && !/ERR_NETWORK_CHANGED/.test(m.text())) erreurs.push(m.text()); }); // (le réseau du poste qui change : pas la page)
  await page.goto(`${od.url}/`); await page.waitForSelector('#app:not([hidden])', { timeout: 30000 }); await page.waitForTimeout(600);
  await page.evaluate('window.OdinApps.app("ymir")');
  await page.waitForSelector('.ym-c', { timeout: 30000 }); await page.waitForSelector('.ym-dep', { timeout: 15000 }); await page.waitForTimeout(400);
  return { page, ctxN, erreurs };
}
/** Attend qu'une expression soit vraie dans la page (la politique de sécurité d'Odin refuse waitForFunction avec un texte). */
async function attendre(page: Page, expr: string, ms = 15000): Promise<void> { const fin = Date.now() + ms; while (Date.now() < fin) { if (await page.evaluate(expr)) return; await page.waitForTimeout(150); } throw new Error(`toujours faux après ${ms} ms : ${expr}`); }
const capture = async (page: Page, nom: string, plein = false) => { if (CAPTURES) { mkdirSync(CAPTURES, { recursive: true }); await page.screenshot({ path: join(CAPTURES, `${nom}.png`), fullPage: plein }); } };
/** Rien ne déborde de l'écran ; les commandes de la liste font au moins 44 px. */
const mesure = (page: Page) => page.evaluate(`(() => {
  const vis = (b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const petites = [...document.querySelectorAll('.ym-filt button, .ym-c .ym-act button, .ym-guard button, .ym-guard input:not([type=radio]), .ym-guard .ch, .ym-deps button, .ym-addep select, .ym-addep input, .ym-addep button')].filter(vis).filter((b) => { const r = b.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map((b) => (b.getAttribute('aria-label') || b.textContent || b.tagName).trim().slice(0, 30) + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height));
  const deborde = [...document.querySelectorAll('.ym *')].filter(vis).filter((x) => x.getBoundingClientRect().right > innerWidth + 1 && !x.closest('.ym-tabs')).map((x) => x.tagName + '.' + x.className).slice(0, 8);
  return { page: document.documentElement.scrollWidth > innerWidth + 1, deborde, petites };
})()`) as Promise<{ page: boolean; deborde: string[]; petites: string[] }>;
const cartes = (page: Page) => page.evaluate(`[...document.querySelectorAll('.ym-c')].map((c) => c.querySelector('.hd b').textContent + ' : ' + c.querySelector('.ym-st').textContent.replace(/10\\.0\\.3\\.\\d+/, '').trim())`) as Promise<string[]>;

test('la liste : états, filtre au clavier, dépendants ; garde-fou de la suppression ; Windows ; 1280 sombre', { skip: sans }, async () => {
  const { page, ctxN, erreurs } = await ouvrir(1280, 'sombre');
  try {
    const l = await cartes(page);
    assert.ok(l.includes('debian-13-web : allumée'), l.join(' | ')); assert.ok(l.includes('nas-sauvegardes-du-salon-et-du-bureau : en pause'));
    assert.ok(l.includes('vm-bureau : éteinte')); assert.ok(l.includes('vm-cassee : en erreur'));
    assert.match(String(await page.locator('.ym-c', { hasText: 'vm-cassee' }).locator('.ym-errl').textContent()), /son disque est introuvable/);
    assert.match(String(await page.locator('.ym-c', { hasText: 'dc-labo' }).locator('.ym-dep').textContent()), /En dépendent : 12 PC du domaine, debian-13-web/);
    // Pas de « Supprimer » sur une machine qui tourne (allumée ou en pause), comme la maquette.
    assert.equal(await page.locator('.ym-c', { hasText: 'debian-13-web' }).locator('[data-sup]').count(), 0);
    assert.equal(await page.locator('.ym-c', { hasText: 'nas-sauvegardes' }).locator('[data-sup]').count(), 0);
    await capture(page, '1280-sombre-01-liste');
    await capture(page, '1280-sombre-01-liste-entiere', true);
    // Filtre par état, au clavier : « En pause » (Entrée), puis « En erreur », puis « Toutes ».
    await page.locator('[data-etat="pause"]').focus(); await page.keyboard.press('Enter'); await page.waitForSelector('[data-etat="pause"][aria-pressed="true"]');
    assert.deepEqual(await cartes(page), ['nas-sauvegardes-du-salon-et-du-bureau : en pause']);
    assert.equal(await page.evaluate('document.activeElement && document.activeElement.dataset.etat'), 'pause', 'le clavier reste sur le filtre');
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); await page.waitForSelector('[data-etat="erreur"][aria-pressed="true"]');
    assert.deepEqual(await cartes(page), ['vm-cassee : en erreur']);
    await capture(page, '1280-sombre-02-filtre-erreur');
    await page.locator('[data-etat="tout"]').focus(); await page.keyboard.press('Enter'); await page.waitForSelector('[data-etat="tout"][aria-pressed="true"]');
    // Un dépendant vivant (noté à la main) : la suppression est refusée et dit pourquoi ; aucun champ pour le nom.
    await page.locator('[data-sup="a00000000005"]').focus(); await page.keyboard.press('Enter');
    await page.waitForSelector('.ym-guard ul[role="alert"]', { timeout: 15000 });
    assert.match(String(await page.locator('.ym-guard').textContent()), /ne peut pas être supprimée maintenant.*le site de la maison en dépend \(noté à la main/);
    assert.equal(await page.locator('#ymGNom').count(), 0);
    await capture(page, '1280-sombre-03-refus-dependant');
    await page.keyboard.press('Escape');
    await attendre(page, '!document.querySelector(".ym-guard")');
    assert.equal(await page.locator('.ym-guard').count(), 0, 'Échap ferme');
    assert.equal(await page.evaluate('document.activeElement && document.activeElement.dataset.sup'), 'a00000000005', 'le clavier revient sur « Supprimer »');
    // vm-bureau : rien n'en dépend ; nom écrit et disque choisi, au clavier.
    await page.locator('[data-sup="a00000000004"]').focus(); await page.keyboard.press('Enter');
    await page.waitForSelector('#ymGNom', { timeout: 15000 }); await page.waitForTimeout(200);
    const ok = page.locator('.ym-guard [data-g="ok"]');
    assert.equal(await ok.isDisabled(), true, 'éteint au départ');
    assert.equal(await page.evaluate('document.activeElement && document.activeElement.id'), 'ymGNom', 'le clavier va au champ du nom');
    await page.keyboard.type('vm-bureau');
    assert.equal(await ok.isDisabled(), true, 'le disque n\'est pas encore choisi');
    await capture(page, '1280-sombre-04-supprimer');
    await page.locator('input[name="ymGDisque"][value="garder"]').focus(); await page.keyboard.press('Space');
    assert.equal(await ok.isDisabled(), false, 'nom juste et disque choisi');
    await capture(page, '1280-sombre-05-supprimer-pret');
    await page.locator('#ymGNom').focus(); await page.keyboard.press('Enter');
    await attendre(page, '![...document.querySelectorAll(".ym-c .hd b")].some((b) => b.textContent === "vm-bureau")');
    assert.match(String(await page.locator('.ym p[role="status"]').first().textContent()), /vm-bureau supprimée : son disque \(80 Go\) est gardé à part/);
    assert.ok(!(JSON.parse(readFileSync(join(dir, 'machines.json'), 'utf8')) as Machine[]).some((m) => m.nom === 'vm-bureau'));
    await capture(page, '1280-sombre-06-supprimee');
    // Le bloc « Ce qui dépend de dc-labo » : noter des PC, puis retirer la ligne.
    await page.locator('.ym-c', { hasText: 'dc-labo' }).click(); await attendre(page, '(document.getElementById("ymDT") || {}).textContent === "Ce qui dépend de dc-laboelle ne se supprime pas tant que ça tourne"');
    assert.match(String(await page.locator('section[aria-labelledby="ymDT"]').textContent()), /12 PC du domaine en dépendent \(noté à la main\)/);
    await page.locator('section[aria-labelledby="ymDT"]').scrollIntoViewIfNeeded(); await capture(page, '1280-sombre-07-dependances');
    const m = await mesure(page); assert.equal(m.page, false); assert.deepEqual(m.deborde, []); assert.deepEqual(m.petites, []);
    assert.deepEqual(erreurs, []);
  } finally { await ctxN.close(); }
});

for (const [largeur, theme] of [[390, 'clair'], [390, 'sombre'], [1280, 'clair']] as const) {
  test(`affichage ${largeur} px, thème ${theme} : liste, garde-fou, rien ne déborde, cibles de 44 px`, { skip: sans }, async () => {
    const { page, ctxN, erreurs } = await ouvrir(largeur, theme);
    try {
      await capture(page, `${largeur}-${theme}-01-liste`);
      await page.locator('[data-sup="a00000000005"]').click(); await page.waitForSelector('.ym-guard ul[role="alert"]', { timeout: 15000 });
      await page.locator('.ym-guard').scrollIntoViewIfNeeded(); await capture(page, `${largeur}-${theme}-02-refus`);
      await page.locator('.ym-guard [data-g="garder"]').click(); await page.waitForTimeout(300);
      await page.locator('[data-sup="a00000000006"]').click(); await page.waitForSelector('#ymGNom', { timeout: 15000 });
      await page.fill('#ymGNom', 'vm-cassee'); await page.locator('.ym-guard .ch', { hasText: 'L\'effacer' }).click();
      await page.locator('.ym-guard').scrollIntoViewIfNeeded(); await capture(page, `${largeur}-${theme}-03-supprimer`);
      const m = await mesure(page); assert.equal(m.page, false, 'la page défile en largeur'); assert.deepEqual(m.deborde, []); assert.deepEqual(m.petites, []);
      await page.locator('.ym-guard [data-g="garder"]').click(); await page.waitForTimeout(200);
      assert.deepEqual(erreurs, []);
    } finally { await ctxN.close(); }
  });
}

test('sous Windows : la carte « Ce PC : Windows » dit ce qui ne marche pas encore et ce qui viendra', { skip: sans }, async () => {
  systemeVm.plateforme = () => 'win32';
  const { page, ctxN, erreurs } = await ouvrir(390, 'sombre');
  try {
    const txt = String(await page.locator('.ym-win').textContent());
    assert.match(txt, /Ce PC : Windows/); assert.match(txt, /ne tournent pas encore/); assert.match(txt, /hyperviseur livré avec Windows/); assert.match(txt, /Windows Famille/);
    await capture(page, '390-sombre-04-windows');
    const m = await mesure(page); assert.equal(m.page, false); assert.deepEqual(m.deborde, []);
    assert.deepEqual(erreurs, []);
  } finally { systemeVm.plateforme = () => 'linux'; await ctxN.close(); }
});
