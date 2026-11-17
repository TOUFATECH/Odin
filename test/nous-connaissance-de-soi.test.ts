// La fabrique des fiches de connaissance de soi (src/brain/nous/connaissance-de-soi.ts) : la lecture de l'interface
// sur un petit morceau écrit à la main, puis sur la vraie page ; une fiche pour chaque page, chaque onglet et chaque
// réglage trouvés ; aucune fiche ne cite une page absente ; rien de privé dans les fiches d'un Odin jetable.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { comptesFiches, dossiersDe, fabriquerFiches, lireInterface, lireVoletsCerveau, texteHtml, type Fiche } from '../src/brain/nous/connaissance-de-soi.ts';
import { dossierJetable, environnementBanc } from './soul-banc/catalogue.ts';

const UI = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');
const BRAIN = readFileSync(new URL('../src/web/brain.js', import.meta.url), 'utf8');

test('Lire un petit morceau d\'interface : menu, sections, rubriques, cartes, réglages, palette', () => {
  const html = `<nav><button class="tab" data-view="home" aria-current="page"><svg></svg><span class="lbl">Aujourd'hui</span></button>
<div class="navmore" id="navMore" hidden><button class="tab" data-view="jobs"><span class="lbl">Tâches</span></button><div id="navEpingles"></div></div>
<button class="tab" data-view="settings"><span class="lbl">Réglages</span></button></nav>
<section class="view on" id="v-home" aria-label="Aujourd'hui"><div class="head"><div><h1>Aujourd'hui</h1><div class="sub">Ce qui compte &amp; plus.</div></div></div></section>
<section class="view" id="v-jobs" aria-label="Tâches planifiées"><h1>Tâches planifiées</h1><div class="sub">Elles tournent.</div></section>
<section class="view" id="v-settings" aria-label="Réglages"><h1>Réglages</h1>
<button type="button" class="schip" data-sec="surveillance" role="tab">Surveillance</button><button type="button" class="schip" data-sec="mail" role="tab">Mail</button>
<article class="card" data-sec="surveillance"><form><h2>Surveillance</h2><p class="sub" style="x">Odin veille.</p>
<label class="check"><input type="checkbox" id="wt-on"> Surveillance activée</label><div class="field"><label for="wt-int">Vérifier toutes les (minutes)</label><input id="wt-int"></div></form></article>
<article class="card" data-sec="mail"><div class="form" id="more-mail"></div></article></section>
<script>const VIEWS = [['home', 'Aujourd\\'hui'], ['jobs', 'Tâches planifiées']];
$('#more-mail').replaceChildren(el('h2', {}, 'Mail'), el('p', { class: 'sub', style: 'margin:0' }, 'Odin lit tes mails.'), F.input('ml-user', 'Adresse e-mail (identifiant)', M.mail.user), F.check('ml-on', 'Lire les mails', true));
</script>`;
  const ui = lireInterface(html);
  assert.deepEqual(ui.pages.map((p) => [p.id, p.libelle, p.dansPlus, p.menu]), [['home', 'Aujourd\'hui', false, true], ['jobs', 'Tâches', true, true], ['settings', 'Réglages', false, true]]);
  assert.equal(ui.pages[0].resume, 'Ce qui compte & plus.');
  assert.deepEqual(ui.rubriques, [{ id: 'surveillance', libelle: 'Surveillance' }, { id: 'mail', libelle: 'Mail' }]);
  assert.deepEqual(ui.reglages.map((r) => `${r.rubrique}:${r.id}=${r.libelle}`).sort(), ['mail:ml-on=Lire les mails', 'mail:ml-user=Adresse e-mail (identifiant)', 'surveillance:wt-int=Vérifier toutes les (minutes)', 'surveillance:wt-on=Surveillance activée']);
  assert.deepEqual(ui.cartes.map((c) => [c.rubrique, c.titre, c.dynamique]), [['surveillance', 'Surveillance', false], ['mail', 'Mail', true]]);
  assert.deepEqual(ui.palette, [{ vue: 'home', libelle: 'Aujourd\'hui' }, { vue: 'jobs', libelle: 'Tâches planifiées' }]);
  const fs = fabriquerFiches({ interface: ui });
  const r = fs.find((f) => f.id === 'interface:reglage:surveillance:wt-int')!;
  assert.deepEqual(r.ou, { page: 'Réglages', onglet: 'Surveillance', reglage: 'Vérifier toutes les (minutes)' });
  assert.match(fs.find((f) => f.id === 'interface:page:jobs')!.texte, /sous « Plus »/);
  assert.equal(texteHtml('a <b>b</b> &rarr; &#233;'), 'a b → é');
  assert.deepEqual(lireVoletsCerveau(`navBtn('accueil', IC.home, 'Accueil'), navBtn('nous', IC.star, 'Noûs')`), [{ id: 'accueil', libelle: 'Accueil' }, { id: 'nous', libelle: 'Noûs' }]);
});

test('Sur la vraie interface : une fiche par page, onglet et réglage trouvés ; aucune fiche ne cite une page absente', () => {
  const ui = lireInterface(UI), volets = lireVoletsCerveau(BRAIN);
  assert.ok(ui.pages.length >= 10, `pages trouvées : ${ui.pages.length}`);
  assert.ok(ui.rubriques.length >= 20, `rubriques : ${ui.rubriques.length}`);
  assert.ok(ui.reglages.length >= 100, `réglages : ${ui.reglages.length}`);
  assert.ok(volets.length >= 4, `volets du Cerveau : ${volets.length}`);
  for (const id of ['home', 'chat', 'brain', 'net', 'apps', 'settings']) assert.ok(ui.pages.some((p) => p.id === id && p.menu), `page ${id} dans le menu`);
  // Version 2 (M10) : l'onglet « Ports », ajouté par le script de la page, a sa fiche ; les ports des applis y renvoient.
  assert.ok(ui.rubriques.some((r) => r.id === 'ports'), 'onglet Ports lu');
  const fs = fabriquerFiches({ interface: ui, voletsCerveau: volets, applis: [{ id: 'mathesis', name: 'Mathésis', family: 'Données', what: 'Apprend.', modes: [], actions: [{ id: 'pause', label: 'Pause' }] }] });
  const ids = new Set(fs.map((f) => f.id));
  for (const p of ui.pages) assert.ok(ids.has(`interface:page:${p.id}`), `fiche de la page ${p.id}`);
  for (const r of ui.rubriques) assert.ok(ids.has(`interface:onglet:${r.id}`), `fiche de l'onglet ${r.id}`);
  for (const r of ui.reglages) assert.ok(ids.has(`interface:reglage:${r.rubrique}:${r.id}`), `fiche du réglage ${r.rubrique}:${r.id}`);
  for (const v of volets) assert.ok(ids.has(`interface:volet-cerveau:${v.id}`), `fiche du volet ${v.id}`);
  const pages = new Set([...ui.pages.map((p) => p.libelle), 'menu de gauche']);
  for (const f of fs) if (f.ou) assert.ok(pages.has(f.ou.page), `${f.id} cite la page « ${f.ou.page} » absente`);
  // Les onglets cités sous Réglages existent ; ceux du Cerveau aussi.
  const reglages = ui.pages.find((p) => p.id === 'settings')!.libelle, cerveau = ui.pages.find((p) => p.id === 'brain')!.libelle;
  for (const f of fs) {
    if (f.ou?.page === reglages && f.ou.onglet) assert.ok(ui.rubriques.some((r) => r.libelle === f.ou!.onglet) || ui.cartes.some((c) => c.titre === f.ou!.onglet), `${f.id} : onglet « ${f.ou.onglet} » absent`);
    if (f.ou?.page === cerveau && f.ou.onglet) assert.ok(volets.some((v) => v.libelle === f.ou!.onglet), `${f.id} : volet « ${f.ou.onglet} » absent`);
  }
  // Une fiche est courte et vraie : jamais vide, jamais d'un seul mot.
  for (const f of fs) { assert.ok(f.texte.length > 15 && f.texte.length < 2000, `${f.id} : texte de ${f.texte.length} caractères`); assert.ok(f.sujet && f.source, f.id); }
  assert.deepEqual(fabriquerFiches({ interface: ui, voletsCerveau: volets }), fabriquerFiches({ interface: ui, voletsCerveau: volets }), 'deux fabrications identiques');
});

test('Les dossiers sont dits par rapport au dossier d\'Odin ; un chemin dehors est laissé', () => {
  const h = join(tmpdir(), 'odin-x');
  assert.deepEqual(dossiersDe(h, { home: h, config: join(h, 'config.json'), mathesis: join(h, 'valhalla', 'mathesis'), dehors: join(tmpdir(), 'ailleurs') }), [
    { id: 'config', chemin: 'config.json', quoi: 'La configuration' }, { id: 'home', chemin: '.', quoi: 'Le dossier d\'Odin (toutes ses données)' }, { id: 'mathesis', chemin: 'valhalla/mathesis', quoi: 'Ce que Mathésis apprend (chiffré)' },
  ]);
});

test('Sur un Odin jetable : les quatre familles, et rien de privé (nom de machine, compte, chemin du disque, secret)', async () => {
  const { home, fin } = dossierJetable('odin-soi-essai-');
  environnementBanc(home);
  try {
    writeFileSync(join(home, 'env'), 'HA_TOKEN=jeton-secret-7f3a9c\n', { mode: 0o600 });
    const { preparerOdin } = await import('./soul-banc/soi.ts');
    const o = await preparerOdin(home, {
      config: { homeAssistant: { url: 'http://198.51.100.40:8123' } },
      appareils: [{ ip: '198.51.100.7', mac: 'aa:00:5e:00:53:07', nom: 'Imprimante' }],
      mathesis: { journal: [{ id: 'j1', at: '2026-11-16T09:00:00', genre: 'lecture', quoi: 'a lu une page', source: 'https://example.org/a' }], sites: [{ id: 'example.org', racine: 'https://example.org/', etat: 'en-suivi', lues: 3, connues: 4 }] },
      souvenirs: ['Le chat s\'appelle Pixel.'],
    }, Date.parse('2026-11-17T10:00:00'));
    try {
      const c = comptesFiches(o.fiches);
      for (const f of ['infrastructure', 'interface', 'modele', 'acquisition'] as const) assert.ok(c[f] > 0, `famille ${f} vide`);
      const ids = new Set(o.fiches.map((f) => f.id));
      for (const id of ['infra:machine', 'infra:port-web', 'infra:sauvegarde', 'infra:inventaire', 'infra:appareil:aa:00:5e:00:53:07', 'modele:soul', 'modele:soul:etat', 'modele:sans-modele-exterieur', 'acquisition:mathesis', 'acquisition:journal:j1', 'acquisition:site:example.org', 'interface:appli:mathesis', 'interface:page:settings']) assert.ok(ids.has(id), `fiche ${id} absente`);
      const interdits = [hostname(), userInfo().username, home, home.replace(/\\/g, '/'), tmpdir(), 'jeton-secret-7f3a9c'].filter((x) => x && x.length >= 3 && !/^(odin|localhost)$/i.test(x));
      const tout = (f: Fiche) => `${f.id} ${f.sujet} ${f.texte} ${f.source} ${f.cles.join(' ')} ${JSON.stringify(f.ou ?? {})}`.toLowerCase();
      for (const f of o.fiches) for (const x of interdits) assert.ok(!tout(f).includes(x.toLowerCase()), `${f.id} contient « ${x} »`);
      assert.match(o.fiches.find((f) => f.id === 'modele:brain')!.texte, /1 souvenir/);
      // Version 2 (M10) : « important » vient de la surveillance du produit, pas de la préparation du jeu.
      assert.doesNotMatch(o.fiches.find((f) => f.id === 'infra:inventaire')!.texte, /important/);
      // Chaque fiche dit ce qu'une bonne réponse doit contenir (port, adresse, lieu), pour juger un texte.
      assert.deepEqual(o.fiches.find((f) => f.id === 'infra:appareil:aa:00:5e:00:53:07')!.reponse, ['198.51.100.7']);
      assert.ok(o.fiches.filter((f) => f.id.startsWith('infra:port:')).every((f) => f.reponse?.length === 1 && /^\d+$/.test(f.reponse[0])));
    } finally { o.fin(); }
  } finally { fin(); }
});
