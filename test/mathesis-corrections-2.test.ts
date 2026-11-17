// Mathésis — essais de NON-RÉGRESSION des 7 constats de la seconde relecture croisée (carnets/relecture-mathesis-2.md).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { creerMathesis } from '../src/valhalla/mathesis/moteur.ts';
import { MagasinMemoire } from '../src/valhalla/mathesis/magasin.ts';
import { manquesEnAttente, signalerManque, signalerVerdicts, viderManques } from '../src/valhalla/mathesis/signaux.ts';
import { mathesis } from '../src/valhalla/mathesis/module.ts';
import { oublierBranchementsMathesis } from '../src/valhalla/mathesis/magasin.ts';
import { liensDe } from '../src/valhalla/mathesis/lecteur.ts';
import { odinRepond, oublierReponses } from '../src/valhalla/mathesis/occupe.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { createDocx } from '../src/files/office.ts';
import { makeOdin } from './helpers.ts';
import { fausseHorloge } from './mathesis-outils-essai.ts';

const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
const moteur = (o: { occupe?: () => boolean } = {}) => creerMathesis({ dossier: 'x', home: 'x', magasin: new MagasinMemoire(), chercher: async () => [], transport: async () => { throw new Error('aucun réseau'); }, ...o });

// ------------------------------------------------------------------ 1. coupée : la boîte aux manques ne garde rien
test('1. Mathésis coupée : rien n\'est déposé, et rien de la coupure ne devient un sujet au rallumage', async () => {
  viderManques();
  const m = moteur();
  signalerManque({ sujet: 'déposé quand elle était allumée', origine: 'sujet_recurrent' });
  assert.equal(manquesEnAttente(), 1);
  m.eteindre();
  assert.equal(manquesEnAttente(), 0, 'couper vide la boîte');
  signalerVerdicts('quel traitement pour la maladie de ma mère', []);
  signalerManque({ sujet: 'autre question pendant la coupure', origine: 'question_sans_reponse' });
  assert.equal(manquesEnAttente(), 0, 'coupée : rien n\'est gardé');
  m.allumer();
  await m.tour({ manques: 0, revisites: 0 });
  assert.deepEqual(m.curiosite.liste().map((x) => x.sujet), [], 'rien de la coupure n\'arrive dans la liste de curiosité');
});

// ------------------------------------------------------------------ 2 et 3. le module : fermer un dossier, confier une adresse
function monterModule() {
  oublierBranchementsMathesis();
  const home = tmp('mathesis-c2-');
  const h = fausseHorloge(new Date(2026, 10, 17, 14, 0).getTime());
  const mod = mathesis(() => ({ chercher: async () => [], transport: async () => { throw new Error('aucun réseau'); }, temps: { maintenant: h.maintenant, attendre: h.attendre } }));
  const v = new Valhalla(home, [mod], { notify: async () => {}, fetch: async () => { throw new Error('réseau interdit'); }, now: () => new Date(h.t) });
  return { v, mod, ctx: v.ctx('mathesis') };
}

test('2. fermer un dossier : même chemin avec une autre casse ou une barre finale ; « pas ouvert » quand rien n\'est retiré', async () => {
  const { v, mod, ctx } = monterModule();
  const d = tmp('Mes Documents-');
  assert.equal((await v.act('mathesis', 'ouvrir_dossier', { chemin: d })).ok, true);
  const autreForme = (process.platform === 'win32' ? d.toUpperCase() : d) + sep;
  const r = await v.act('mathesis', 'fermer_dossier', { chemin: autreForme });
  assert.equal(r.ok, true, r.text);
  assert.match(JSON.stringify(await mod.view(ctx, new URLSearchParams())), /Aucun dossier ouvert/);
  const r2 = await v.act('mathesis', 'fermer_dossier', { chemin: d });
  assert.equal(r2.ok, false);
  assert.match(r2.text, /n'était pas ouvert/);
  v.stop();
});

test('3. confier une adresse privée : refusée et dite ; une adresse publique passe', async () => {
  const { v } = monterModule();
  const r = await v.act('mathesis', 'confier', { quoi: 'http://192.168.1.1/admin http://localhost:8080/' });
  assert.equal(r.ok, false);
  assert.match(r.text, /Refusée\(s\).*192\.168\.1\.1.*localhost/);
  const r2 = await v.act('mathesis', 'confier', { quoi: 'https://exemple.fr/page http://10.0.0.1/x' });
  assert.equal(r2.ok, true, r2.text);
  assert.match(r2.text, /Refusée\(s\).*10\.0\.0\.1/);
  v.stop();
});

// ------------------------------------------------------------------ 4 et 5. dossiers ouverts
function maison() {
  const racine = tmp('mathesis-c2-maison-');
  const ouvert = join(racine, 'ouvert');
  mkdirSync(ouvert, { recursive: true });
  const m = creerMathesis({ dossier: racine, home: racine, magasin: new MagasinMemoire(), chercher: async () => [], transport: async () => { throw new Error('aucun réseau'); }, apprentissage: () => ({ retenus: 0, ignores: 0, rejetes: 0, souvenirs: [], niveaux: [] }) });
  m.regler({ dossiers: [ouvert] });
  return { racine, ouvert, m };
}

test('4. un document très compressé : borné à sa taille décompressée, et compté ainsi dans le budget', async () => {
  const { ouvert, m } = maison();
  writeFileSync(join(ouvert, 'piege.docx'), createDocx('a'.repeat(25 * 1024 * 1024)));
  writeFileSync(join(ouvert, 'normal.docx'), createDocx(`# Jardin\n\n${'Le jardin créole donne des brèdes et des piments toute l\'année. '.repeat(400)}`));
  const b = await m.maison.parcourir();
  assert.ok(b.pasLus.some((p) => p.chemin.endsWith('piege.docx') && /décompressé/.test(p.raison)), JSON.stringify(b.pasLus));
  assert.equal(b.lus, 1);
  assert.ok(m.budget.utilise().octetsFichiers > 20_000, `budget compté décompressé : ${m.budget.utilise().octetsFichiers} octets`);
});

test('5. au-delà de 8 niveaux, c\'est dit ; une jonction vers le dossier ouvert ne le fait pas reparcourir', async () => {
  const { ouvert, m } = maison();
  let d = ouvert;
  for (let k = 0; k < 10; k++) { d = join(d, `n${k}`); mkdirSync(d); }
  writeFileSync(join(d, 'loin.txt'), 'Le jardin créole donne des brèdes et des piments toute l\'année, même en saison sèche.');
  writeFileSync(join(ouvert, 'pres.txt'), 'Le jardin créole donne des brèdes et des piments toute l\'année, même en saison sèche.');
  symlinkSync(ouvert, join(ouvert, 'boucle'), 'junction');
  const b = await m.maison.parcourir();
  assert.ok(b.pasLus.some((p) => /trop profond/.test(p.raison)), JSON.stringify(b.pasLus));
  assert.equal(b.examines, 1, 'le fichier proche n\'est examiné qu\'une fois');
});

// ------------------------------------------------------------------ 6. le signal « Odin répond » est toujours levé
test('6. une panne avant la réponse ne laisse pas le signal « Odin répond » posé', async () => {
  oublierReponses();
  const o = makeOdin([{ text: 'ok' }]);
  try {
    (o.muninn as unknown as { startMission: () => void }).startMission = () => { throw new Error('panne simulée'); };
    await assert.rejects(o.agent.run('bonjour', { sessionId: 's1' }));
    assert.equal(odinRepond(), false, 'le signal est levé');
  } finally { o.cleanup(); }
});

// ------------------------------------------------------------------ 7. lien sans guillemets
test('7. un lien sans guillemets est extrait', () => {
  assert.deepEqual(liensDe('<a href=/sans-guillemets>Le jardin</a> <a href=\'/b\'>B</a> <a href="/c">C</a>', 'https://e.fr/', 10).map((l) => l.url), ['https://e.fr/sans-guillemets', 'https://e.fr/b', 'https://e.fr/c']);
});
