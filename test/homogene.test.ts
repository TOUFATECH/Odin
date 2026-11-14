// « Tout homogène » : chaque appli d'Odin (celles d'aujourd'hui et celles codées plus tard) doit avoir
//   - son nom, l'histoire de son nom, ce qu'elle fait et ses « applicatifs similaires existants » (ou « aucun ») ;
//   - une page qui ne déborde pas (ordinateur 1280 px et téléphone 390 px), un en-tête complet, à la même place
//     que celui des autres applis ;
//   - Odin (la mascotte) jamais posé sur une commande, et jamais d'obstacle à un clic.
// La première partie est rapide (sans navigateur). La seconde ouvre un vrai navigateur sur un vrai Odin rempli ;
// sans Playwright sur la machine, elle est ignorée (elle le dit).
//   /home/claude/odin-wt/outils/navigateur.sh <copie> test/homogene.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { allModules } from '../src/valhalla/odin.ts';
import { NAME_STORY, SIMILAIRES, SITES_SIMILAIRES, similairesDe } from '../src/valhalla/names.ts';
import { analyser, debordementsGraves, type PageQ } from './banc/debordements.ts';
import { ecartsEntetes, entete, manquesEntete, odinPose, sousOdin, type Entete } from './banc/homogene.ts';
import { T } from './banc/lib.ts';
import { odinPlein } from './banc/odin-plein.ts';
import { makeOdin } from './helpers.ts';

// ------------------------------------------------------------------ Les fiches (sans navigateur)
test('chaque appli a un nom, l\'histoire de son nom, ce qu\'elle fait et ses applicatifs similaires (ou « aucun »)', () => {
  const o = makeOdin([{ text: 'ok' }]);
  try {
    const manques: string[] = [];
    for (const m of allModules(o as never)) {
      if (!m.name?.trim()) manques.push(`${m.id} : pas de nom`);
      if (!NAME_STORY[m.id]?.trim()) manques.push(`${m.id} (${m.name}) : pas d'histoire du nom (NAME_STORY dans src/valhalla/names.ts)`);
      if (!m.what?.trim()) manques.push(`${m.id} (${m.name}) : pas de « ce qu'elle fait » (what)`);
      const s = (m as { similaires?: unknown }).similaires;
      if (!(m.id in SIMILAIRES) && !Array.isArray(s)) manques.push(`${m.id} (${m.name}) : pas d'applicatifs similaires (SIMILAIRES dans src/valhalla/names.ts ; [] = aucun)`);
      for (const x of similairesDe(m)) if (!x.nom.trim() || /copi[ée]/i.test(x.nom)) manques.push(`${m.id} : similaire mal écrit « ${x.nom} »`);
    }
    assert.deepEqual(manques, []);
  } finally { o.cleanup(); }
});

test('applicatifs similaires : des sites officiels en https, et jamais le mot « copié » dans la page', () => {
  for (const [nom, url] of Object.entries(SITES_SIMILAIRES)) assert.match(url, /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i, nom);
  for (const l of Object.values(SIMILAIRES)) assert.equal(new Set(l).size, l.length, `doublon dans ${l.join(', ')}`);
  const page = readFileSync(new URL('../src/web/valhalla.js', import.meta.url), 'utf8');
  assert.match(page, /Applicatifs similaires existants/);
  assert.doesNotMatch(page, /[Aa]pplicatifs? copiés?/);
});

// ------------------------------------------------------------------ Dans un vrai navigateur
interface Page extends PageQ { goto(url: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; waitForFunction(js: string, a?: unknown, o?: Record<string, unknown>): Promise<unknown>; on(ev: string, f: (e: Error) => void): void }
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(js: string): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sans = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });

test('la page de chaque appli (1280 et 390 px) : en-tête complet et à la même place, rien qui déborde, Odin jamais sur une commande', { skip: sans, timeout: 600_000 }, async () => {
  const t = new T(); const od = await odinPlein(t, { reponses: 6 });
  const fautes: string[] = [];
  try {
    const applis = ((await od.json('/api/valhalla/catalog')).body.modules as Array<{ id: string; name: string }>);
    assert.ok(applis.length >= 60, `${applis.length} applis seulement`);
    for (const largeur of [1280, 390]) {
      const ctx = await nav!.newContext({ viewport: { width: largeur, height: largeur > 500 ? 800 : 844 }, deviceScaleFactor: 1, locale: 'fr-FR', colorScheme: 'dark', hasTouch: largeur < 500, isMobile: largeur < 500 });
      try {
        const [name, ...v] = od.session.split('=');
        await ctx.addCookies([{ name, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]);
        await ctx.addInitScript(`try { localStorage.setItem('odin.theme', 'sombre'); localStorage.setItem('odin.tour', 'done'); } catch {}`);
        const p = await ctx.newPage(); const erreurs: string[] = [];
        p.on('pageerror', (e) => erreurs.push(e.message));
        await p.goto(od.url + '/'); await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
        await p.waitForFunction('!!window.OdinApps && !!window.OdinShow && !!window.OdinNotices', undefined, { timeout: 20000 });
        const entetes: Entete[] = [];
        for (const m of applis) {
          const avant = erreurs.length;
          await p.evaluate(`window.OdinNotices.hide(); window.OdinApps.app(${JSON.stringify(m.id)})`);
          await p.waitForSelector('#v-app.on .va-head h1', { timeout: 15000 }).catch(() => undefined);
          await p.waitForTimeout(250);
          await p.evaluate('window.OdinNotices.closeTalk?.(true); window.OdinNotices.hide()');
          await odinPose(p);
          const e = await entete(p); if (e) { e.id = m.id; entetes.push(e); }
          for (const x of manquesEntete(e)) fautes.push(`${m.name} (${m.id}) ${largeur} px : ${x}`);
          for (const d of debordementsGraves((await analyser(p, { contraste: false, focus: false, decor: false, tactile: false, defiler: false })).defauts)) fautes.push(`${m.name} (${m.id}) ${largeur} px : ${d.type} ${d.selecteur} — ${d.mesure}`);
          const o = await sousOdin(p);
          if (o.commandes.length) fautes.push(`${m.name} (${m.id}) ${largeur} px : Odin posé sur ${o.commandes.join(', ')}`);
          if (o.bloque.length) fautes.push(`${m.name} (${m.id}) ${largeur} px : Odin empêche de cliquer sur ${o.bloque.join(', ')}`);
          // Le bouton commun « Exporter / partager » ouvre son dialogue dans chaque appli (même celles qui ne s'exportent pas).
          if (largeur === 1280) {
            await p.evaluate(`document.querySelector('#v-app .va-share')?.click()`);
            let ouvert = false;
            for (let i = 0; i < 25 && !ouvert; i++) { await p.waitForTimeout(200); ouvert = await p.evaluate<boolean>(`!!document.querySelector('dialog[open] #va-pt-t')`); }
            if (!ouvert) fautes.push(`${m.name} (${m.id}) : « Exporter / partager » ne s'ouvre pas`);
            await p.evaluate(`for (const d of document.querySelectorAll('dialog[open]')) d.close()`);
          }
          for (const x of erreurs.slice(avant)) fautes.push(`${m.name} (${m.id}) ${largeur} px : erreur dans la page — ${x}`);
        }
        for (const x of ecartsEntetes(entetes)) fautes.push(`${largeur} px : ${x}`);
      } finally { await ctx.close(); }
    }
  } finally { await t.end(); }
  assert.deepEqual(fautes, []);
});

test('Odin : un toucher fait son petit son partout (onglets, page d\'une appli, fenêtre, /maison, téléphone), aucun si le son est coupé ; ses coins laissent passer les clics', { skip: sans, timeout: 180_000 }, async () => {
  const t = new T(); const od = await odinPlein(t, { reponses: 6 });
  const fautes: string[] = [];
  // Chaque note jouée par Odin passe par un oscillateur : on les compte.
  const SONDE = `window.__sons = 0; { const s = OscillatorNode.prototype.start; OscillatorNode.prototype.start = function (...a) { window.__sons++; return s.apply(this, a); }; }`;
  try {
    for (const [largeur, coupe] of [[390, false], [1280, false], [390, true]] as Array<[number, boolean]>) {
      const tel = largeur < 500;
      const ctx = await nav!.newContext({ viewport: { width: largeur, height: tel ? 844 : 800 }, deviceScaleFactor: 1, locale: 'fr-FR', colorScheme: 'dark', hasTouch: tel, isMobile: tel });
      const quoi = `${largeur} px${coupe ? ', son coupé' : ''}`;
      try {
        const [name, ...v] = od.session.split('=');
        await ctx.addCookies([{ name, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]);
        await ctx.addInitScript(`try { localStorage.setItem('odin.theme', 'sombre'); localStorage.setItem('odin.tour', 'done'); localStorage.setItem('odin-sound', ${coupe ? "'0'" : "'1'"}); } catch {} ${SONDE}`);
        const p = await ctx.newPage() as Page & { touchscreen: { tap(x: number, y: number): Promise<void> }; mouse: { click(x: number, y: number): Promise<void> } };
        const toucher = async (sel: string): Promise<number> => {
          const c = await p.evaluate<{ x: number; y: number } | null>(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
          if (!c) return -1;
          const avant = await p.evaluate<number>('window.__sons');
          if (tel) await p.touchscreen.tap(c.x, c.y); else await p.mouse.click(c.x, c.y);
          await p.waitForTimeout(500);
          return (await p.evaluate<number>('window.__sons')) - avant;
        };
        await p.goto(od.url + '/'); await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
        await p.waitForFunction('!!window.OdinApps && !!window.OdinShow && !!window.OdinNotices', undefined, { timeout: 20000 });
        for (const [nom, ouvrir] of [['Aujourd\'hui (la fenêtre)', `window.OdinShow('home')`], ['Applis', `window.OdinShow('apps')`], ['page d\'Asclépios', `void window.OdinApps.app('ullr')`], ['Réglages', `window.OdinShow('settings')`], ['Maison', `window.OdinShow('net')`]]) {
          await p.evaluate(`window.OdinNotices.closeTalk?.(true); window.OdinNotices.hide(); ${ouvrir}`); await p.waitForTimeout(700); await odinPose(p);
          const n = await toucher('#buddyRoam .body circle');
          if (n < 0) fautes.push(`${quoi}, ${nom} : Odin n'est pas là`);
          else if (coupe ? n > 0 : n === 0) fautes.push(`${quoi}, ${nom} : ${n} note(s) jouée(s) au toucher`);
          await p.waitForTimeout(1600);
        }
        // Ses coins (hors de son corps) ne prennent pas les clics : ils vont à ce qui est dessous.
        const coin = await p.evaluate<string>(`(() => { const o = document.querySelector('#buddyRoam'); const r = o.getBoundingClientRect(); const e = document.elementFromPoint(r.left + 2, r.top + 2); return e && o.contains(e) ? 'Odin' : 'dessous'; })()`);
        if (coin !== 'dessous') fautes.push(`${quoi} : le coin vide du carré d'Odin prend les clics`);
        // L'écran de la maison (/maison) : sa mascotte fait le même son.
        await p.goto(od.url + '/maison'); await p.waitForSelector('.pet', { timeout: 20000 }).catch(() => undefined);
        // Elle se pose d'abord (sa place libre, dans l'écran) : on la touche une fois immobile.
        { let avant = '', stable = 0; for (let i = 0; i < 40 && stable < 4; i++) { await p.waitForTimeout(250); const a = await p.evaluate<string>(`(() => { const r = document.querySelector('.pet')?.getBoundingClientRect(); return r ? Math.round(r.left) + ',' + Math.round(r.top) : ''; })()`); if (a && a === avant) stable++; else { stable = 0; avant = a; } } }
        const n = await toucher('.pet');
        if (n < 0) fautes.push(`${quoi}, /maison : pas de mascotte`); else if (coupe ? n > 0 : n === 0) fautes.push(`${quoi}, /maison : ${n} note(s) jouée(s) au toucher`);
      } finally { await ctx.close(); }
    }
  } finally { await t.end(); }
  assert.deepEqual(fautes, []);
});
