// Le dessin commun d'un widget et ses cinq états (maquette validée « Accueil », lot 25a ; croquis validé le 25/11,
// ses réponses 1 b, 2 b, 3 a). Le rendu (src/web/pages/widgets-rendu.js) est rejoué sans navigateur : chaque état a son
// texte, à un seul endroit ; une ligne au plus, un bouton au plus, le bouton pour le propriétaire seul ; jamais un
// chiffre inventé. Puis la lecture de fenetre.js et maison.js (ils s'en servent, la carte garde .fe-w), et la page
// /maison qui charge pages/widgets-*.js par motif. Enfin, dans un vrai navigateur s'il y en a un : le dessin.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { valhallaOf } from '../src/valhalla/odin.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const RENDU = lire('src/web/pages/widgets-rendu.js');
const FE = lire('src/web/fenetre.js');
const MAISON = lire('src/web/maison.js');

interface Decrit { etat: string; raison: string; donnee: boolean; texte: string; bouton: { texte: string; doux: boolean; raison: string } | null; icone: string; gris: boolean; pastille: string; reglage: boolean }
interface Rendu {
  TEXTES: { etats: Record<string, string>; raisons: Record<string, Record<string, [unknown, string]>> };
  ETATS: string[];
  decrire(e: unknown, o?: Record<string, unknown>): Decrit;
  depuis(at: unknown, maintenant?: number): string;
  porteUneMesure(v: unknown): boolean;
  VIE_PRIVEE: string[];
  etatSansProprio(applis: unknown, aDroit?: unknown): { etat: string; raison: string } | undefined;
}
/** Le rendu chargé sur une fausse fenêtre SANS document : s'il touchait la page à son chargement, il planterait. */
function charger(): Rendu {
  const win: Record<string, unknown> = {};
  vm.runInNewContext(RENDU, { window: win });
  assert.ok(win.OdinWidgetsRendu, 'window.OdinWidgetsRendu est posé');
  return win.OdinWidgetsRendu as Rendu;
}
const R = charger();
/** Le texte d'une fonction de fenetre.js, de son nom à la fonction suivante. */
function fonction(nom: string): string {
  const i = FE.indexOf(`  async function ${nom}(`) >= 0 ? FE.indexOf(`  async function ${nom}(`) : FE.indexOf(`  function ${nom}(`);
  assert.ok(i >= 0, `fenetre.js a la fonction ${nom}`);
  const fin = FE.slice(i + 10).search(/\n  (?:async )?function |\n  \/\*\*/);
  return FE.slice(i, fin < 0 ? undefined : i + 10 + fin);
}
const PROPRIO = { proprio: true, peutAgir: () => true, appli: 'Midgard' };
const MIN = 60_000;

test('rendu : rien n\'est touché au chargement, et un second chargement ne refait rien', () => {
  const win: Record<string, unknown> = {};
  vm.runInNewContext(RENDU, { window: win });
  const premier = win.OdinWidgetsRendu;
  vm.runInNewContext(RENDU, { window: win });
  assert.equal(win.OdinWidgetsRendu, premier, 'posé une seule fois');
  assert.deepEqual([...R.ETATS], ['ok', 'vide', 'source_absente', 'refuse', 'ancien'], 'les cinq états du serveur (sorte.ts)');
  for (const e of R.ETATS) assert.ok(R.TEXTES.etats[e], `l'état ${e} a son nom`);
});

test('prêt : la donnée telle quelle, sans ligne ni bouton ; le « ⋯ » pour le propriétaire seul', () => {
  const d = R.decrire({ etat: 'ok', at: Date.now(), donnee: { n: 7 } }, PROPRIO);
  assert.equal(d.donnee, true); assert.equal(d.texte, ''); assert.equal(d.bouton, null); assert.equal(d.pastille, '');
  assert.equal(d.reglage, true, 'le propriétaire a son « ⋯ »');
  assert.equal(R.decrire({ etat: 'ok' }, { proprio: false }).reglage, false, 'un membre ou une tablette : pas de « ⋯ »');
});

test('vide : une ligne, et un seul bouton qui y remédie (« Choisir le lieu »), pour le propriétaire seul', () => {
  const d = R.decrire({ etat: 'vide', raison: 'lieu_non_choisi' }, PROPRIO);
  assert.equal(d.donnee, false);
  assert.equal(d.texte, 'Rien à montrer : choisis ton lieu.');
  assert.deepEqual({ ...d.bouton }, { texte: 'Choisir le lieu', doux: false, raison: 'lieu_non_choisi' });
  assert.equal(R.decrire({ etat: 'vide', raison: 'lieu_non_choisi' }, { ...PROPRIO, proprio: false }).bouton, null, 'pas de bouton pour un membre');
  assert.equal(R.decrire({ etat: 'vide', raison: 'lieu_non_choisi' }, { ...PROPRIO, peutAgir: () => false }).bouton, null, 'jamais un bouton que l\'écran ne sait pas faire');
  assert.equal(R.decrire({ etat: 'vide', raison: 'rien_mesure' }, PROPRIO).texte, 'Rien de mesuré pour l\'instant.');
  assert.equal(R.decrire({ etat: 'vide', raison: 'rien_mesure' }, PROPRIO).bouton, null, 'rien à choisir : pas de bouton');
  assert.equal(R.decrire({ etat: 'vide', raison: 'meteo_pas_lue' }, PROPRIO).texte, 'Pas encore lue, Odin réessaie.');
  assert.equal(R.decrire({ etat: 'vide', raison: 'partie_introuvable' }, PROPRIO).texte, 'Cette partie n\'existe plus.');
});

test('vide, une liste vide (sa réponse 3 a) : le texte propre à ce qu\'elle montre, sans bouton', () => {
  const d = R.decrire({ etat: 'vide', raison: 'partie_vide' }, { ...PROPRIO, vide: 'Aucun appareil allumé.', titre: 'Appareils allumés' });
  assert.equal(d.texte, 'Aucun appareil allumé.'); assert.equal(d.bouton, null);
  assert.equal(R.decrire({ etat: 'vide', raison: 'partie_vide' }, { ...PROPRIO, titre: 'Appareils allumés' }).texte, 'Rien dans « Appareils allumés » pour l\'instant.', 'sans texte de l\'appli : le titre du widget');
});

test('source absente : « Midgard ne répond pas. » + « Réessayer » (doux), « est désactivée. » + « Activer »', () => {
  const m = R.decrire({ etat: 'source_absente', raison: 'appli_muette' }, PROPRIO);
  assert.equal(m.texte, 'Midgard ne répond pas.'); assert.deepEqual({ ...m.bouton }, { texte: 'Réessayer', doux: true, raison: 'appli_muette' });
  assert.equal(R.decrire({ etat: 'source_absente', raison: 'lecture_echouee' }, PROPRIO).texte, 'Midgard ne répond pas.');
  const a = R.decrire({ etat: 'source_absente', raison: 'appli_absente' }, PROPRIO);
  assert.equal(a.texte, 'Midgard est désactivée.'); assert.deepEqual({ ...a.bouton }, { texte: 'Activer', doux: false, raison: 'appli_absente' });
  assert.equal(R.decrire({ etat: 'source_absente', raison: 'appli_absente' }, { proprio: true, peutAgir: () => true }).texte, 'Cette appli est désactivée.', 'sans nom connu : rien d\'inventé');
  assert.equal(R.decrire({ etat: 'source_absente', raison: 'pas_encore_lu' }, PROPRIO).bouton, null);
});

test('refusé (sa réponse 2 b) : la tuile grisée, « Fermé · réservé au propriétaire. » ou « Vie privée… », jamais la donnée ni un bouton', () => {
  for (const raison of ['proprietaire_seul', 'appli_fermee', 'pas_pour_une_tablette', 'action_grave', 'accueil_du_proprietaire', 'lecteur_inconnu', 'droit_non_verifie', 'sorte_inconnue', 'un_code_neuf']) {
    const d = R.decrire({ etat: 'refuse', raison, donnee: { secret: 'Poids de Léa : 21 kg' } }, PROPRIO);
    assert.equal(d.texte, 'Fermé · réservé au propriétaire.', raison);
    assert.equal(d.donnee, false, `${raison} : jamais la donnée`); assert.equal(d.bouton, null, `${raison} : jamais de bouton, même pour le propriétaire`);
    assert.equal(d.gris, true, `${raison} : la tuile grisée`); assert.equal(d.reglage, false, `${raison} : pas de « ⋯ »`);
  }
  assert.equal(R.decrire({ etat: 'refuse', raison: 'vie_privee', appli: 'sol' }, PROPRIO).texte, 'Vie privée : à ouvrir par le propriétaire.');
  // Un état inconnu, absent, ou mal formé : fermé (le plus sûr).
  for (const e of [undefined, null, {}, { etat: 'pret' }, 'ok']) assert.equal(R.decrire(e, PROPRIO).etat, 'refuse');
});

test('ancien (sa réponse 1 b) : la donnée NORMALE, avec la pastille « il y a 12 min » ; jamais un chiffre inventé', () => {
  const now = Date.UTC(2026, 10, 25, 12, 0, 0);
  const d = R.decrire({ etat: 'ancien', at: now - 12 * MIN - 5000, donnee: { temp: 27 }, motif: 'hors_ligne' }, { ...PROPRIO, maintenant: now });
  assert.equal(d.donnee, true, 'la donnée reste, normale (pas grisée)'); assert.equal(d.gris, false);
  assert.equal(d.pastille, 'il y a 12 min'); assert.equal(d.texte, ''); assert.equal(d.bouton, null);
  assert.equal(R.depuis(now - 20_000, now), 'il y a moins d\'1 min');
  assert.equal(R.depuis(now - 59 * MIN, now), 'il y a 59 min');
  assert.equal(R.depuis(now - 3 * 60 * MIN, now), 'il y a 3 h');
  assert.equal(R.depuis(now - 50 * 60 * MIN, now), 'il y a 2 j');
  for (const at of [undefined, null, 'hier', NaN, 0, now + MIN]) assert.equal(R.depuis(at, now), 'lecture ancienne', `${String(at)} : aucun chiffre supposé`);
  assert.equal(R.porteUneMesure('0'), false); assert.equal(R.porteUneMesure('—'), false); assert.equal(R.porteUneMesure('7'), true);
});

test('un code serveur inconnu : le texte commun de son état, sans bouton', () => {
  const v = R.decrire({ etat: 'vide', raison: 'un_code_neuf' }, PROPRIO);
  assert.equal(v.texte, 'Rien à montrer : choisis quoi afficher.'); assert.equal(v.bouton, null, 'Odin ne sait pas y remédier : pas de bouton');
  assert.equal(R.decrire({ etat: 'source_absente', raison: 'un_code_neuf' }, PROPRIO).texte, 'Odin ne sait pas encore lire cela.');
});

test('vie privée (sa réponse b à la question 15) : fermée à tout autre que le propriétaire, avant toute lecture', async () => {
  const { APPLIS_VIE_PRIVEE } = await import('../src/valhalla/widgets/index.ts');
  assert.deepEqual([...R.VIE_PRIVEE].sort(), [...APPLIS_VIE_PRIVEE].sort(), 'la page a la même liste que le serveur (APPLIS_VIE_PRIVEE)');
  const tout = () => true;
  assert.deepEqual({ ...R.etatSansProprio(['frigg'], tout) }, { etat: 'refuse', raison: 'vie_privee' }, 'il a le droit sur Chronos : fermé quand même');
  assert.equal(R.decrire(R.etatSansProprio(['frigg'], tout), { proprio: false }).texte, 'Vie privée : à ouvrir par le propriétaire.');
  assert.deepEqual({ ...R.etatSansProprio(['midgard'], () => false) }, { etat: 'refuse', raison: 'appli_fermee' }, 'une appli qui n\'est pas à lui');
  assert.deepEqual({ ...R.etatSansProprio(['frigg'], () => false) }, { etat: 'refuse', raison: 'appli_fermee' }, 'le droit d\'abord, comme le serveur');
  assert.equal(R.etatSansProprio(['midgard'], tout), undefined, 'une appli à lui, hors vie privée : lue');
  assert.equal(R.etatSansProprio([], tout), undefined, 'aucune appli derrière');
  // Un droit qu'on ne peut pas vérifier : fermé.
  for (const d of [undefined, null, 'oui', () => 1, () => 'true']) assert.equal(R.etatSansProprio(['midgard'], d)?.etat, 'refuse');
  for (const a of ['__proto__', 'constructor', 'toString']) assert.equal(R.etatSansProprio([a], () => false)?.raison, 'appli_fermee');
  // fenetre.js : « est-ce le propriétaire ? » d'abord, puis les vues, jamais celle d'un widget fermé ; pareil pour le régler.
  assert.match(fonction('fetchViews'), /await lireEtats\(\);[\s\S]*&& !ferme\(w\)[\s\S]*\/api\/valhalla\/view/, 'les vues après les droits, sans les widgets fermés');
  assert.doesNotMatch(fonction('fetchViews'), /Promise\.all\(\[lireEtats\(\)/, 'plus de vue demandée avant de savoir qui regarde');
  assert.match(fonction('etatDe'), /if \(!proprio\) return R\.etatSansProprio\(/, 'tout autre que le propriétaire : la règle commune');
  assert.match(fonction('configure'), /^[^\n]*\n\s*if \(ferme\(w\)\) return;/, 'un widget fermé ne se règle pas (rien n\'est lu)');
  assert.match(FE, /let etats = null, proprio = false,/, 'pas le propriétaire tant que le serveur ne l\'a pas dit');
});

test('les textes des cinq états sont à UN SEUL endroit (widgets-rendu.js), jamais recopiés dans fenetre.js ni maison.js', () => {
  const phrases = ['Fermé · réservé au propriétaire.', 'Vie privée : à ouvrir par le propriétaire.', '} ne répond pas.', '} est désactivée.', 'Rien de mesuré pour', 'Rien à montrer', 'Cette partie n\\\'existe plus.', 'Pas encore lue', 'il y a ${n}', 'ne sait pas encore lire', 'Choisir le lieu'];
  for (const p of phrases) {
    assert.ok(RENDU.includes(p), `« ${p} » est dans widgets-rendu.js`);
    for (const [nom, src] of [['fenetre.js', FE], ['maison.js', MAISON]] as const) assert.ok(!src.includes(p), `« ${p} » n'est pas recopié dans ${nom}`);
  }
  // Chaque code « Les autres raisons » du croquis a son texte dans la table.
  const codes = { vide: ['lieu_non_choisi', 'site_non_choisi', 'action_non_choisie', 'partie_introuvable', 'site_introuvable', 'partie_vide', 'rien_mesure', 'meteo_pas_lue'], source_absente: ['appli_absente', 'appli_muette', 'lecture_echouee', 'action_absente', 'pas_encore_lu'], refuse: ['vie_privee'] };
  for (const [etat, l] of Object.entries(codes)) for (const c of l) assert.ok(Object.hasOwn(R.TEXTES.raisons[etat], c), `${etat} · ${c}`);
  // Les anciennes phrases de la fenêtre (un module sans donnée) ont laissé place aux états.
  assert.doesNotMatch(FE, /Appli indisponible pour l'instant|Cette sonde n\\'existe pas|Pas de chiffres pour cette appli/);
  assert.doesNotMatch(MAISON, /Pas de chiffres pour cette appli|Cette sonde n\\'existe pas/);
});

test('fenetre.js : la carte garde .fe-w, l\'en-tête commun, les états du serveur pour le propriétaire, le « ⋯ » pour lui seul', () => {
  assert.match(FE, /const box = el\('article', \{ class: 'fe-w',/, 'la carte garde la classe .fe-w');
  assert.match(FE, /const R = window\.OdinWidgetsRendu;/, 'fenetre.js lit le rendu commun');
  assert.match(FE, /R\.entete\(/, 'l\'en-tête de la maquette');
  assert.match(FE, /R\.decrire\(/, 'l\'état décrit par le rendu commun');
  assert.match(FE, /R\.contenu\(/, 'sa ligne et son bouton');
  assert.match(FE, /fetch\(`\/api\/widgets\/donnees/, 'le propriétaire reçoit les états du serveur');
  assert.match(FE, /regler: proprio && /, 'le « ⋯ » pour le propriétaire seul');
  assert.match(FE, /status === 401/, 'refusé par le serveur (un membre) : pas le propriétaire');
});

test('maison.js : l\'en-tête commun et les états sans donnée', () => {
  assert.match(MAISON, /window\.OdinWidgetsRendu/, 'maison.js lit le rendu commun');
  assert.match(MAISON, /\.entete\(/); assert.match(MAISON, /\.decrire\(/);
  assert.match(MAISON, /fEtat\('vide', 'rien_mesure'\)/, 'des chiffres sans mesure : rien d\'inventé');
  assert.match(MAISON, /fEtat\('vide', 'partie_vide', \{ vide: sc\.empty/, 'une liste vide le dit, avec le texte de l\'appli');
  assert.match(MAISON, /peutAgir: \(\) => false/, 'pas de bouton sur cet écran (le serveur n\'y sert que ce qui est permis)');
});

test('/maison charge pages/widgets-*.js par motif, avant maison.js, avec le nonce de la page', async () => {
  const { maisonRoute } = await import('../src/web/maison-api.ts');
  // La route est appelée telle quelle, sans réseau : une fausse requête, une fausse réponse qui garde ce qui est écrit.
  const tetes: Record<string, string> = {}; let html = '';
  const req = { method: 'GET', url: '/maison', headers: {} } as unknown as IncomingMessage;
  const res = { writeHead: (_c: number, h: Record<string, string>) => { Object.assign(tetes, h); return res; }, end: (t?: string) => { html = String(t ?? ''); return res; } } as unknown as ServerResponse;
  assert.equal(await maisonRoute(req, res, new URL('/maison', 'http://x'), { authed: false, name: 'Awa', mascot: '<svg></svg>', fail: () => {}, ask: async () => '' }), true);
  const nonce = /script-src 'nonce-([^']+)'/.exec(tetes['content-security-policy'] ?? '')?.[1];
  assert.ok(nonce, 'la page a son nonce');
  const attendus = readdirSync(new URL('../src/web/pages/', import.meta.url)).filter((n) => /^widgets-[a-z0-9-]+\.js$/.test(n)).sort();
  assert.ok(attendus.includes('widgets-rendu.js'));
  for (const n of attendus) assert.ok(html.includes(`<script nonce="${nonce}" src="/pages/${n}"></script>`), `${n} est chargé, avec le nonce`);
  assert.ok(html.indexOf('/pages/widgets-rendu.js') < html.indexOf('src="/maison.js"'), 'avant maison.js');
  // Entre les widgets et maison.js : le catalogue des thèmes (pages/themes-catalogue.js), lu par l'écran de la maison
  // pour ses thèmes. L'ordre attendu : les widgets, puis le catalogue, puis maison.js, chacun avec le nonce.
  const tag = (src: string) => `<script nonce="${nonce}" src="${src}"></script>`;
  assert.ok(html.includes(attendus.map((n) => tag(`/pages/${n}`)).join('') + tag('/pages/themes-catalogue.js') + tag('/maison.js')), 'les widgets, puis le catalogue des thèmes, puis maison.js');
  assert.equal(html.split('src="/pages/themes-catalogue.js"').length, 2, 'le catalogue des thèmes est chargé une seule fois');
  assert.doesNotMatch(html, /src="\/pages\/(?!widgets-|themes-catalogue\.js")/, 'aucun autre fichier de pages/');
  // Rien d'autre ne change pour une tablette : tous les scripts portent le nonce, aucun script écrit dans la page.
  assert.equal(html.split('<script').length, html.split(`<script nonce="${nonce}" src="/`).length, 'chaque script est un fichier servi par Odin, avec le nonce');
});

// ------------------------------------------------------------------ dans un vrai navigateur (ignoré sans Playwright)
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<{ newPage(o?: unknown): Promise<{ setContent(h: string): Promise<void>; addScriptTag(o: { content: string }): Promise<void>; evaluate<X>(f: string): Promise<X> }>; close(): Promise<void> }> } }; } catch { return undefined; } })();

test('dans un navigateur : refusé sans « ⋯ » ni bouton, le bouton fait 44 px, la pastille dans l\'en-tête', { skip: pw ? false : 'Playwright absent' }, async () => {
  const nav = await pw!.chromium.launch();
  try {
    const p = await nav.newPage({ viewport: { width: 390, height: 800 } });
    await p.setContent('<!doctype html><html><head></head><body style="--accent:#2F5BD3;--on-accent:#fff"><div id="h"></div></body></html>');
    await p.addScriptTag({ content: RENDU });
    const r = await p.evaluate<Record<string, unknown>>(`(() => {
      const R = window.OdinWidgetsRendu, h = document.getElementById('h');
      const carte = (e, o, titre) => { const a = document.createElement('article'); a.className = 'fe-w'; const d = R.decrire(e, o);
        a.append(R.entete({ titre, sous: d.gris ? '' : 'Midgard', pastille: d.pastille, gris: d.gris, regler: o.proprio && d.reglage ? () => {} : null }), ...(d.donnee ? [] : [R.corps(d, () => {})])); h.append(a); return a; };
      const ferme = carte({ etat: 'refuse', raison: 'appli_fermee' }, { proprio: false }, 'Poids de Léa');
      const vide = carte({ etat: 'vide', raison: 'lieu_non_choisi' }, { proprio: true, peutAgir: () => true }, 'Heure et lieu');
      const vieux = carte({ etat: 'ancien', at: Date.now() - 12 * 60000 }, { proprio: true }, 'Météo');
      const petit = R.entete({ titre: 'Allumés', petit: true, regler: () => {} });
      // Une carte étroite (182 px, 150 px dedans) : le titre garde sa place, rien ne sort de la carte.
      const etroite = document.createElement('article'); etroite.style.cssText = 'width:182px;padding:14px 16px;box-sizing:border-box'; const ouvrir = document.createElement('button'); ouvrir.textContent = 'Ouvrir ›';
      etroite.append(R.entete({ titre: 'Météo du jardin', sous: 'Hestia', pastille: 'il y a 12 min', extra: [ouvrir], regler: () => {} })); h.append(etroite);
      const bord = etroite.getBoundingClientRect();
      return {
        fermeTexte: [...ferme.querySelectorAll('.wr-n, .wr-s, .wr-ligne')].map((n) => n.textContent).join(' | '), fermeBoutons: ferme.querySelectorAll('button').length, fermeGris: ferme.querySelector('.wr-gris') !== null,
        videBouton: vide.querySelector('.wr-btn')?.textContent, videHaut: Math.round(vide.querySelector('.wr-btn').getBoundingClientRect().height),
        plusHaut: Math.round(vide.querySelector('.wr-plus').getBoundingClientRect().height), plusNom: vide.querySelector('.wr-plus').getAttribute('aria-label'),
        pastille: vieux.querySelector('.wr-h .wr-pastille')?.textContent, pastilleVue: vieux.querySelector('.wr-h .wr-pastille')?.lastChild?.textContent,
        etroiteTitre: Math.round(etroite.querySelector('.wr-n').getBoundingClientRect().width), etroiteDehors: [...etroite.querySelector('.wr-h').children].filter((n) => n.getBoundingClientRect().right > bord.right + 1).length,
        petitPlus: petit.querySelectorAll('.wr-plus').length,
        styles: document.querySelectorAll('#odinWidgetsRendu').length,
      };
    })()`);
    assert.equal(r.fermeTexte, 'Poids de Léa | Fermé · réservé au propriétaire.', 'le titre gardé, sans sous-titre, puis une seule ligne');
    assert.equal(r.fermeBoutons, 0, 'ni « ⋯ » ni bouton'); assert.equal(r.fermeGris, true);
    assert.equal(r.videBouton, 'Choisir le lieu'); assert.ok((r.videHaut as number) >= 44, 'bouton de 44 px');
    assert.ok((r.plusHaut as number) >= 44, '« ⋯ » de 44 px'); assert.equal(r.plusNom, 'Régler « Heure et lieu »');
    assert.equal(r.pastilleVue, 'il y a 12 min', 'la pastille ambre dans l\'en-tête');
    assert.equal(r.pastille, 'Donnée ancienne, lue il y a 12 min', 'un lecteur d\'écran lit la phrase entière');
    assert.ok((r.etroiteTitre as number) >= 80, `carte étroite : le titre reste lisible (${String(r.etroiteTitre)} px)`); assert.equal(r.etroiteDehors, 0, 'carte étroite : rien ne sort');
    assert.equal(r.petitPlus, 0, 'le petit chiffre n\'a pas de « ⋯ »');
    assert.equal(r.styles, 1, 'le style est posé une fois');
  } finally { await nav.close(); }
});

// Un vrai Odin d'essai, un membre de la famille qui a le droit sur Chronos (une appli de la vie privée) et sur Midgard.
// Avant la relecture du lot 25a, sa page demandait la vue de Chronos et montrait ses rendez-vous.
test('un membre sur l\'accueil : un widget « vie privée » reste fermé, et rien n\'est demandé pour lui', { skip: pw ? false : 'Playwright absent' }, async () => {
  interface Reponse { url(): string; status(): number }
  interface PageOdin { on(e: 'response', f: (r: Reponse) => void): void; goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: unknown): Promise<unknown>; waitForTimeout(n: number): Promise<void>; evaluate<X>(f: string): Promise<X> }
  interface Contexte { newPage(): Promise<PageOdin>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: () => void): Promise<void>; close(): Promise<void> }
  const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  const nav = await pw!.chromium.launch() as unknown as { newContext(o: unknown): Promise<Contexte>; close(): Promise<void> };
  try {
    const od = await vraiOdin(tt, { compte: true }), va = valhallaOf()!;
    const MDP = 'un-figuier-penche-sur-la-ravine-58';
    const W = (id: string, o: Record<string, unknown>) => ({ id, w: 1, c: 6, r: 2, ...o });
    const fenetre = { pages: [{ id: 'aaaa1111', name: 'Essai', widgets: [
      W('e0000001', { kind: 'chiffres', module: 'frigg', label: 'Rendez-vous de la semaine' }),
      W('e0000002', { kind: 'chiffres', module: 'midgard' }),
      W('e0000003', { kind: 'chiffres', module: 'askr', label: 'Appareils de la maison' }),
    ] }] };
    assert.equal((await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(fenetre) }, { by: 'toi', why: 'essai' })).ok, true);
    assert.equal((await va.act('var', 'ajouter', { login: 'membre-a', nom: 'Membre A', groupes: 'invite', mot_de_passe: MDP })).ok, true);
    for (const appli of ['odin', 'gladsheim', 'frigg', 'midgard']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-a' })).ok, true);
    // Sa connexion par Persona, comme un navigateur.
    const cookieDe = (r: Response) => r.headers.getSetCookie().find((c) => c.startsWith('odin_session='))?.split(';')[0] ?? '';
    let r = await fetch(`${od.url}/sso/odin`, { redirect: 'manual' });
    r = await fetch(new URL(r.headers.get('location')!, od.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
    r = await fetch(`${od.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: od.url }, body: new URLSearchParams({ demande, identifiant: 'membre-a', motdepasse: MDP }) });
    r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); const membre = cookieDe(r);
    assert.ok(membre, 'le membre a sa session');
    // Le serveur lui ouvre bien la vue de Chronos (il a le droit sur l'appli) : c'est donc la page qui doit ne rien demander.
    assert.equal((await fetch(`${od.url}/api/valhalla/view?id=frigg`, { headers: { cookie: membre, 'x-odin': '1' } })).status, 200, 'contrôle : la garde lui sert la vue de Chronos');
    // Lot 26 : pour le propriétaire seul, la page « Aujourd'hui » est la première ; sa page d'essai est la deuxième.
    async function voir(cookie: string, proprio = false) {
      const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-FR' });
      const [n, ...v] = cookie.split('='); await ctx.addCookies([{ name: n, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]);
      await ctx.addInitScript(() => { try { localStorage.setItem('odin.tour', 'done'); } catch { /* rien */ } });
      if (proprio) await ctx.addInitScript(() => { try { localStorage.setItem('odin.fenetre.page', '1'); } catch { /* rien */ } });
      const page = await ctx.newPage(), vues: string[] = [];
      page.on('response', (x) => { const u = new URL(x.url()); if (u.pathname === '/api/valhalla/view') vues.push(u.searchParams.get('id') ?? ''); });
      await page.goto(od.url + '/');
      await page.waitForSelector('#feGrid .fe-w[data-id="e0000002"]', { timeout: 30000 });
      await page.waitForTimeout(1500);
      const cartes = await page.evaluate<Array<{ id: string; ligne: string; gris: boolean; boutons: number; chiffres: number }>>(`[...document.querySelectorAll('#feGrid > .fe-w')].map((c) => ({ id: c.dataset.id, ligne: c.querySelector('.wr-ligne')?.textContent ?? '', gris: Boolean(c.querySelector('.wr-gris')), boutons: c.querySelectorAll('.wr-btn, .wr-plus, .fe-open').length, chiffres: c.querySelectorAll('.va-kpi').length }))`);
      await ctx.close();
      return { vues, carte: (id: string) => cartes.find((c) => c.id === id)! };
    }
    const m = await voir(membre);
    assert.ok(!m.vues.includes('frigg'), `la page du membre ne demande pas la vue de Chronos (demandées : ${m.vues.join(', ')})`);
    assert.ok(!m.vues.includes('askr'), 'ni celle d\'une appli qui n\'est pas à lui');
    // Depuis le 26/11 : sa page lit ses widgets par la route des widgets, et ne demande plus la vue d'AUCUNE appli pour eux.
    assert.deepEqual(m.vues, [], 'la page du membre ne demande plus de vue d\'appli pour un widget (pas même Midgard)');
    assert.deepEqual(m.carte('e0000001'), { id: 'e0000001', ligne: 'Vie privée : à ouvrir par le propriétaire.', gris: true, boutons: 0, chiffres: 0 });
    assert.deepEqual(m.carte('e0000003'), { id: 'e0000003', ligne: 'Fermé · réservé au propriétaire.', gris: true, boutons: 0, chiffres: 0 });
    assert.equal(m.carte('e0000002').gris, false, 'Midgard reste ouvert pour lui'); assert.equal(m.carte('e0000002').boutons, 1, 'sans « ⋯ » : seulement « Ouvrir › »');
    // Le propriétaire lui ouvre le widget de Chronos : il n'est plus fermé pour lui ; toujours aucune vue d'appli demandée.
    assert.equal((await va.act('gladsheim', 'ouvrir_widget', { widget: 'e0000001', personne: 'membre-a', ouvert: 'oui' })).ok, true);
    const o = await voir(membre);
    assert.deepEqual(o.vues, []);
    assert.equal(o.carte('e0000001').gris, false, 'ouvert pour lui'); assert.notEqual(o.carte('e0000001').ligne, 'Vie privée : à ouvrir par le propriétaire.');
    assert.equal(o.carte('e0000001').boutons, 1, 'sans « ⋯ » : seulement « Ouvrir › »');
    assert.equal(o.carte('e0000003').gris, true, 'l\'appli qui n\'est pas à lui reste fermée');
    // Le propriétaire : rien ne change pour lui.
    const p = await voir(od.session, true);
    assert.ok(p.vues.includes('frigg'), 'le propriétaire lit Chronos');
    assert.equal(p.carte('e0000001').gris, false); assert.equal(p.carte('e0000001').boutons, 2, '« Ouvrir › » et « ⋯ »');
  } finally { await nav.close(); await tt.end(); Object.assign(console, orig); }
});
