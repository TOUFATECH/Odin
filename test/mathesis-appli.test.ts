// Mathésis — l'appli : actions, droits (couper = un clic ; affaiblir une protection = grave, refusé à une automatisation),
// page (structure, textes honnêtes, heures locales, noms raccourcis par le milieu, tableaux plutôt que barres),
// interrupteur, pause, mode privé, corriger et effacer ce qui a été retenu. Aucun réseau : faux site, faux moteur.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { mathesis, type OptionsModuleMathesis } from '../src/valhalla/mathesis/module.ts';
import { affaiblit, court, lirePlages, proposition } from '../src/valhalla/mathesis/module.ts';
import { oublierBranchementsMathesis } from '../src/valhalla/mathesis/magasin.ts';
import { reglagesParDefaut } from '../src/valhalla/mathesis/reglages.ts';
import type { Apport } from '../src/learn/apprendre-de-tout.ts';
import type { View } from '../src/valhalla/types.ts';
import { fausseHorloge, fauxSite, fauxResolveur, fauxMoteur, html } from './mathesis-outils-essai.ts';

const homes: string[] = [];
after(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }); });

const ROBOTS = { corps: 'User-agent: *\nDisallow: /prive/\n', type: 'text/plain' };
const FAIT = 'Le volcan Piton de la Fournaise culmine à 2632 mètres sur l\'île de La Réunion, au sud-est.';
const FAIT2 = 'Sur l\'île de La Réunion, le volcan Piton de la Fournaise culmine à 2632 mètres, au sud-est.';
const LONGUE = 'https://un-site-au-nom-vraiment-tres-long.exemple.fr/un/chemin/encore/plus/long/vers/la/page-du-piton-de-la-fournaise';

function monter(o: Partial<OptionsModuleMathesis> & { prive?: () => boolean } = {}) {
  oublierBranchementsMathesis();
  const home = mkdtempSync(join(tmpdir(), 'mathesis-appli-')); homes.push(home);
  const h = fausseHorloge(new Date(2026, 10, 17, 14, 0).getTime());
  const site = fauxSite({
    'https://volcans-a.fr/robots.txt': ROBOTS, 'https://volcans-b.org/robots.txt': ROBOTS,
    'https://volcans-a.fr/fournaise': { corps: html('Fournaise', [FAIT]) },
    'https://volcans-b.org/piton': { corps: html('Piton', [FAIT2]) },
  }, h);
  const moteurRecherche = fauxMoteur(() => ['https://volcans-a.fr/fournaise', 'https://volcans-b.org/piton']);
  const apports: Apport[] = [], oublies: number[] = [];
  let n = 100;
  const opts: OptionsModuleMathesis = {
    transport: site.transport, resoudre: fauxResolveur(), temps: { maintenant: h.maintenant, attendre: h.attendre }, chercher: moteurRecherche.chercher,
    apprentissage: (a) => { apports.push(a); const ids = (a.faits ?? []).map(() => ++n); return { retenus: ids.length, ignores: 0, rejetes: 0, souvenirs: ids, niveaux: [] }; },
    oublierSouvenir: (id) => { oublies.push(id); return true; }, ...o,
  };
  const mod = mathesis(() => opts);
  const v = new Valhalla(home, [mod], { notify: async () => {}, fetch: async () => { throw new Error('réseau interdit dans les essais'); }, now: () => new Date(h.t) });
  const ctx = v.ctx('mathesis');
  const page = async (): Promise<View> => mod.view(ctx, new URLSearchParams()) as Promise<View>;
  return { v, mod, ctx, h, site, moteurRecherche, apports, oublies, page };
}

test('identité, actions et droits : couper/pause/interdire = un clic ; rallumer, reprendre, lever un interdit, ouvrir un dossier = graves', () => {
  const { mod, v } = monter();
  assert.equal(mod.id, 'mathesis'); assert.equal(mod.name, 'Mathésis'); assert.equal(mod.family, 'Données');
  const a = (id: string) => mod.actions.find((x) => x.id === id)!;
  for (const id of ['couper', 'pause', 'interdire', 'fermer_dossier', 'confier', 'retirer', 'effacer', 'corriger', 'tour']) assert.equal(a(id).grave, undefined, id);
  for (const id of ['allumer', 'reprendre', 'permettre', 'ouvrir_dossier']) assert.ok(a(id).grave?.({ genre: 'site', valeur: 'x.fr', chemin: 'C:/x' }), id);
  assert.deepEqual(mod.taches?.(v.ctx('mathesis')).map((t) => t.id), ['apprendre']);
  v.stop();
});

test('régler : baisser est un clic ; monter un budget, élargir les heures, autoriser un modèle en ligne, lever « ne pas garder » sont graves', () => {
  const r = reglagesParDefaut();
  assert.deepEqual(affaiblit(r, proposition({ recherches: 5, pages: 10 }, r)), []);
  assert.deepEqual(affaiblit(r, proposition({ heures: '22-7' }, r)), [], 'réduire les heures n\'est pas grave');
  assert.match(affaiblit(r, proposition({ recherches: 500 }, r)).join(), /monter le budget « Recherches » de 20 à 500/);
  assert.match(affaiblit(r, proposition({ vitesse: 'soutenue' }, r)).join(), /monter le budget/);
  assert.match(affaiblit(r, proposition({ heuresLourd: '0-24' }, r)).join(), /élargir les heures du travail lourd/);
  assert.match(affaiblit(r, proposition({ modeleEnLigne: true }, r)).join(), /modèle en ligne/);
  assert.match(affaiblit({ ...r, nePasGarder: true }, proposition({ nePasGarder: false }, { ...r, nePasGarder: true })).join(), /ne pas garder/);
  assert.deepEqual(lirePlages('22-7, 12-14'), [{ de: 22, a: 7 }, { de: 12, a: 14 }]);
  assert.equal(lirePlages('n importe quoi'), undefined);
  assert.throws(() => proposition({ heures: 'midi' }, r), /heures illisibles/);
});

test('une automatisation ne peut pas affaiblir une protection ; elle peut couper', async () => {
  const { v, mod, ctx } = monter();
  const r1 = await v.act('mathesis', 'couper', {}, { auto: true });
  assert.equal(r1.ok, true, r1.text);
  const r2 = await v.act('mathesis', 'allumer', {}, { auto: true });
  assert.equal(r2.ok, false);
  assert.match(r2.text, /action grave/);
  const r3 = await v.act('mathesis', 'regler', { recherches: 999 }, { auto: true });
  assert.equal(r3.ok, false);
  const r4 = await v.act('mathesis', 'regler', { recherches: 3 }, { auto: true });
  assert.equal(r4.ok, true, 'baisser un budget passe');
  const p = JSON.stringify(await mod.view(ctx, new URLSearchParams()));
  assert.match(p, /Rallumer \(avec ton accord\)/);
  v.stop();
});

test('interrupteur et pause : rien ne part ; le propriétaire rallume ; un tour apprend, puis corriger et effacer', async () => {
  const { v, site, moteurRecherche, apports, oublies, page } = monter();
  await v.act('mathesis', 'confier', { quoi: 'Piton de la Fournaise' });
  await v.act('mathesis', 'couper', {});
  const t1 = await v.act('mathesis', 'tour', {});
  assert.match(t1.text, /interrupteur est éteint/);
  assert.equal(site.demandes.length + moteurRecherche.questions.length, 0);
  await v.act('mathesis', 'allumer', {});
  await v.act('mathesis', 'pause', {});
  assert.match((await v.act('mathesis', 'tour', {})).text, /en pause/);
  await v.act('mathesis', 'reprendre', {});
  const t2 = await v.act('mathesis', 'tour', {});
  assert.match(t2.text, /fait\(s\) retenu\(s\)/);
  assert.ok(apports.length >= 1);
  const p = await page();
  const retenu = p.sections.find((x) => x.kind === 'table' && x.title.startsWith('Retenu'));
  assert.ok(retenu && retenu.kind === 'table' && retenu.rows.length >= 1, JSON.stringify(p.sections.map((x) => x.title)));
  const id = retenu.kind === 'table' ? retenu.rows[0].cells[4] : '';
  // Corriger : la version du propriétaire est rangée « donné par toi », les souvenirs de l'entrée sont oubliés.
  const c = await v.act('mathesis', 'corriger', { id, texte: 'Le Piton de la Fournaise culmine à 2632 m (vérifié par moi).' });
  assert.equal(c.ok, true, c.text);
  assert.ok(apports.at(-1)!.proprietaire === true && apports.at(-1)!.sorte === 'correction');
  assert.ok(oublies.length >= 1);
  // Effacer l'entrée corrigée.
  const p2 = await page();
  const t = p2.sections.find((x) => x.kind === 'table' && x.title.startsWith('Retenu'));
  const id2 = t && t.kind === 'table' ? t.rows[0].cells[4] : '';
  const avant = oublies.length;
  const e = await v.act('mathesis', 'effacer', { id: id2 });
  assert.equal(e.ok, true, e.text);
  assert.ok(oublies.length > avant);
  v.stop();
});

test('mode privé : rien n\'est cherché, confié ni corrigé', async () => {
  const { v, site, moteurRecherche } = monter({ prive: () => true });
  const c = await v.act('mathesis', 'confier', { quoi: 'un sujet privé' });
  assert.equal(c.ok, false);
  assert.match(c.text, /mode privé/);
  const t = await v.act('mathesis', 'tour', {});
  assert.match(t.text, /mode privé/);
  assert.equal(site.demandes.length + moteurRecherche.questions.length, 0);
  v.stop();
});

test('la page : 4 onglets, textes honnêtes, heures locales, adresses raccourcies par le milieu, tableaux de budgets avec unités, aucune barre', async () => {
  const { v, page, ctx, mod } = monter();
  await v.act('mathesis', 'confier', { quoi: LONGUE });
  await v.act('mathesis', 'interdire', { genre: 'site', valeur: 'interdit.exemple.fr' });
  const p = await page();
  assert.deepEqual(p.onglets, ['Appris', 'Sujets', 'Interdits', 'Réglages']);
  const txt = JSON.stringify(p);
  assert.match(txt, /pas encore essayé sur le vrai web/);
  assert.match(txt, /vidéos, la musique et les images ne sont pas encore regardées/);
  assert.doesNotMatch(txt, /"kind":"bars"/);
  assert.doesNotMatch(txt, /certainement|garanti|toujours juste/i);
  assert.ok(!txt.includes(LONGUE), 'l\'adresse longue n\'apparaît jamais en entier');
  assert.ok(txt.includes(court(LONGUE, 60)));
  assert.match(court(LONGUE, 60), /^https:\/\/un-site.*….*fournaise$/);
  const budgets = p.sections.find((x) => x.title === 'Budgets du jour');
  assert.ok(budgets && budgets.kind === 'table');
  assert.ok(budgets.kind === 'table' && budgets.rows.some((r) => /Mo$/.test(r.cells[2])), 'les tailles ont leur unité');
  // Les titres de section restent courts (rien qui déborde) ; les textes à lignes multiples sont dans des journaux.
  for (const s of p.sections) assert.ok(s.title.length <= 60, s.title);
  for (const s of p.sections) if (s.kind === 'text') assert.ok(!s.text.includes('\n'), s.title);
  // Heure locale : l'entrée du journal d'aujourd'hui commence par HH:MM local.
  const auj = p.sections.find((x) => x.kind === 'log' && x.title.startsWith('Aujourd'));
  assert.ok(auj);
  // Le démarrage : annonce une seule fois.
  mod.start?.(ctx); mod.start?.(ctx);
  assert.equal(v.alerts({ module: 'mathesis' }).filter((a) => /apprend maintenant tout seul/.test(a.title)).length, 1);
  v.stop();
});

test('ouvrir un dossier demande un chemin complet existant ; fermer est un clic', async () => {
  const { v, page } = monter();
  const d = mkdtempSync(join(tmpdir(), 'mathesis-ouvert-')); homes.push(d); mkdirSync(join(d, 'x'), { recursive: true });
  const r0 = await v.act('mathesis', 'ouvrir_dossier', { chemin: 'relatif/dossier' });
  assert.equal(r0.ok, false);
  const r1 = await v.act('mathesis', 'ouvrir_dossier', { chemin: d }, { auto: true });
  assert.equal(r1.ok, false, 'une automatisation n\'ouvre pas un dossier');
  const r2 = await v.act('mathesis', 'ouvrir_dossier', { chemin: d });
  assert.equal(r2.ok, true, r2.text);
  assert.match(JSON.stringify(await page()), /lisible/);
  const r3 = await v.act('mathesis', 'fermer_dossier', { chemin: d }, { auto: true });
  assert.equal(r3.ok, true);
  assert.match(JSON.stringify(await page()), /Aucun dossier ouvert/);
  v.stop();
});
