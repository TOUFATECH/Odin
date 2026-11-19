// La fenêtre Profil (src/web/pages/personnes.js) dans un faux navigateur, avec une fausse route /api/personnes : la liste,
// la carte, l'historique paginé, la note, l'effacement (la confirmation dit exactement ce qui part et ce qui reste, et rien
// ne part sans elle), la vue d'un membre (la sienne, en lecture, « Signaler une erreur ») ; un nom piégé reste du texte ;
// le dictionnaire des textes est complet. Prénoms inventés.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fauxNavigateur, FauxEl } from './archytas-fixtures.ts';
import { CODES_ERREUR } from '../src/web/personnes-api.ts';

const SOURCE = readFileSync(new URL('../src/web/pages/personnes.js', import.meta.url), 'utf8');
type Logique = { T: Record<string, string>; t: (k: string, v?: Record<string, unknown>) => string; clesAttendues: () => string[]; periodeDe: (a: string, b: string) => { depuis: number; jusqua: number } | undefined; texteConfirmation: (nom: string, cible: unknown, bilan: unknown) => string };
type Profil = { rendre: (h: unknown, c?: unknown) => Promise<{ etat: { lignes: unknown[]; carte: unknown }; choisir: (id: string) => Promise<void>; charger: () => Promise<void> } | undefined>; logique: Logique };

function charger() {
  const nav = fauxNavigateur();
  const ctx = vm.createContext(nav.sandbox);
  vm.runInContext(SOURCE, ctx);
  return { nav, P: (nav.window as { OdinProfil: Profil }).OdinProfil };
}
const tous = (n: FauxEl): FauxEl[] => { const out: FauxEl[] = []; const w = (x: FauxEl) => { for (const c of x.childNodes) if (c instanceof FauxEl) { out.push(c); w(c); } }; w(n); return out; };
const bouton = (h: FauxEl, txt: string) => tous(h).find((b) => b.localName === 'button' && b.textContent.includes(txt));
const pur = (x: unknown) => JSON.parse(JSON.stringify(x));
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

const PIEGE = '<img src=x onerror=alert(1)>';
/** Une fausse route : le propriétaire (ou un membre) et ses réponses ; le journal des appels. */
function fausseRoute(o: { membre?: boolean; n?: number } = {}) {
  const appels: Array<{ path: string; opts?: { method?: string; body?: Record<string, unknown> } }> = [];
  const lignes = Array.from({ length: o.n ?? 45 }, (_, i) => ({ id: i + 1, t: 1_700_000_000_000 - i * 60_000, sorte: 'demande', canal: 'telegram', preuve: 'appareil-appaire', partage: i === 0, resultat: i % 2 ? 'reussi' : 'sans_tour', ...(i === 0 ? { quoi: PIEGE } : {}) }));
  const carte = { id: 'u_nour', nom: PIEGE, role: 'member', autonomie: 'prudent', identites: [{ canal: 'telegram', pair: '2001', partage: true, preuve: 'appareil-appaire' }], persona: null, acces: null, portrait: null, ...(o.membre ? {} : { note: 'ancienne note', notable: true }) };
  const bilan = { retire: { historique: 45 }, reste: { historique: 0, messages: 12, missions: 7, aiguillage: 7, souvenirs: 2, note: true, lienPersona: false, compteurInconnus: 'non-touche', audit: 'non-touche', sauvegardes: 'non-touchees' } };
  async function api(path: string, opts?: { method?: string; body?: Record<string, unknown> }) {
    appels.push({ path, opts });
    if (path === '') return o.membre ? { ok: true, proprietaire: false, personnes: [{ id: 'u_nour', nom: PIEGE, role: 'member', canaux: ['telegram'] }] }
      : { ok: true, proprietaire: true, personnes: [{ id: 'proprietaire', nom: '', role: 'owner', canaux: [], synthetique: true }, { id: 'u_nour', nom: PIEGE, role: 'member', canaux: ['telegram'] }, { id: 'u_sami', nom: 'Sami', role: 'guest', canaux: ['signal'] }], inconnus: { total: 3, parCanal: { telegram: 3 } } };
    if (path === '/u_nour') return { ok: true, proprietaire: !o.membre, carte };
    if (path.startsWith('/u_nour/historique')) {
      const q = new URLSearchParams(path.split('?')[1]), n = Number(q.get('n')), av = q.get('avant');
      const debut = av ? lignes.findIndex((l) => `${l.t}-${l.id}` === av) + 1 : 0, page = lignes.slice(debut, debut + n), der = page.at(-1);
      return { ok: true, lignes: page, total: lignes.length, ...(debut + n < lignes.length && der ? { suite: `${der.t}-${der.id}` } : {}) };
    }
    if (path === '/u_nour/note') return { ok: true, note: opts?.body?.texte };
    if (path === '/u_nour/effacer/apercu') return { ok: true, cible: { id: 'u_nour', jusqua: 1_700_000_100_000 }, bilan, jeton: 'j-1' };
    if (path === '/u_nour/effacer') return opts?.body?.jeton === 'j-1' ? { ok: true, bilan } : { ok: false, code: 'change' };
    if (path === '/moi/signaler') return { ok: true, envoye: true };
    return { ok: false, code: 'inconnu' };
  }
  return { api, appels };
}

test('le dictionnaire est complet : chaque texte appelé, chaque code envoyé par Odin (rôles, preuves, résultats, refus, erreurs)', () => {
  const { P } = charger();
  const T = P.logique.T;
  const appeles = [...SOURCE.matchAll(/\bt\('([\w.-]+)'/g)].map((m) => m[1]);
  assert.ok(appeles.length > 40);
  for (const k of appeles) assert.ok(Object.hasOwn(T, k), `texte manquant : ${k}`);
  for (const k of P.logique.clesAttendues()) assert.ok(Object.hasOwn(T, k), `code sans texte : ${k}`);
  for (const c of CODES_ERREUR) assert.ok(Object.hasOwn(T, `erreur.${c}`), `erreur sans texte : ${c}`);
  for (const [k, v] of Object.entries(T)) if (!k.startsWith('raison.proprietaire') && k !== 'raison.la-sienne') assert.ok(v.trim(), `texte vide : ${k}`);
  assert.equal(P.logique.t('histo.total', { n: 1 }), '1 ligne'); assert.equal(P.logique.t('histo.total', { n: 3 }), '3 lignes');
  assert.equal(P.logique.t('n.existe.pas'), '[n.existe.pas]', 'une clé absente se voit');
});

test('un nom piégé reste du texte (jamais un élément), dans la liste, la carte et l\'historique', async () => {
  const { nav, P } = charger();
  const host = nav.make('div'), f = fausseRoute();
  const r = await P.rendre(host, { api: f.api });
  await r!.choisir('u_nour'); await flush();
  assert.equal(tous(host).filter((x) => x.localName === 'img' || x.localName === 'script').length, 0);
  assert.ok(tous(host).some((x) => x.className === 'pf-n' && x.textContent === PIEGE), 'le nom, tel quel, en texte');
  assert.ok(tous(host).some((x) => x.localName === 'h2' && x.textContent === PIEGE));
  assert.ok(tous(host).some((x) => x.className === 'pf-q' && x.textContent === PIEGE), 'ce que la demande disait, en texte');
});

test('le propriétaire : la liste (lui sans fiche, les canaux, le compteur des inconnus), la carte en lecture, l\'historique au fil du défilement, la note', async () => {
  const { nav, P } = charger();
  const host = nav.make('div'), f = fausseRoute();
  const r = await P.rendre(host, { api: f.api });
  const noms = host.querySelectorAll('.pf-n').map((x) => x.textContent);
  assert.deepEqual(noms, ['Toi (propriétaire)', PIEGE, 'Sami']);
  assert.ok(host.querySelectorAll('.pf-s').some((x) => x.textContent === 'Invité · signal'));
  assert.match(host.querySelector('.pf-inc')!.textContent, /^3 messages d'inconnus non appairés/);
  bouton(host, PIEGE)!.click(); await flush();
  assert.equal(r!.etat.lignes.length, 30, 'une première page');
  assert.match(host.textContent, /Tout se règle aussi dans Réglages › Personnes \(mémoire d'Odin\) et dans Persona/);
  assert.match(host.textContent, /appareil appairé · appareil partagé/);
  assert.match(host.textContent, /Aucun compte Persona relié/);
  assert.match(host.textContent, /Vide pour l'instant : Odin le rédigera lui-même/);
  // Lot 5b : le propriétaire règle les droits dans le bloc « Droits » (rôle, autonomie) ; sans compte Persona, aucune case d'appli.
  assert.equal(tous(host).filter((x) => x.localName === 'select').length, 2, 'rôle et autonomie se règlent');
  assert.ok(!tous(host).some((x) => x.localName === 'input' && x.attributes.type === 'checkbox'), 'aucune case d\'appli sans compte Persona relié');
  assert.equal(bouton(host, 'Couper tout'), undefined, 'rien à couper dans Persona sans compte relié');
  bouton(host, 'En charger d\'autres')!.click(); await flush();
  assert.equal(r!.etat.lignes.length, 45);
  assert.equal((bouton(host, 'En charger d\'autres') as unknown as { hidden: boolean }).hidden, true, 'fin de l\'historique : plus de bouton');
  assert.equal(host.querySelectorAll('.pf-l').length, 45, 'ni doublon ni trou');
  const zone = host.querySelector('textarea')!; assert.equal(zone.value, 'ancienne note');
  zone.value = 'préfère les messages courts';
  bouton(host, 'Enregistrer la note')!.click(); await flush();
  assert.deepEqual(pur(f.appels.at(-1)), { path: '/u_nour/note', opts: { method: 'POST', body: { texte: 'préfère les messages courts' } } });
  assert.match(host.textContent, /Note enregistrée\./);
});

test('l\'effacement : la confirmation dit exactement ce qui part et ce qui reste ailleurs ; refusée, rien ne part', async () => {
  const { nav, P } = charger();
  const host = nav.make('div'), f = fausseRoute(), questions: string[] = [];
  let reponse = false;
  const r = await P.rendre(host, { api: f.api, confirmer: async (txt: string) => { questions.push(txt); return reponse; } });
  await r!.choisir('u_nour'); await flush();
  bouton(host, 'Voir ce qui sera effacé')!.click(); await flush();
  assert.equal(questions.length, 1);
  const q = questions[0];
  assert.match(q, /Retiré pour de bon : 45 lignes de son historique/);
  for (const x of ['12 messages de ses conversations', '7 tours d\'Odin (Activité)', '7 lignes du journal d\'aiguillage', '2 souvenirs à son nom', 'ta note sur elle', 'le journal des décisions (audit)', 'les sauvegardes déjà faites', 'le compteur des inconnus']) assert.ok(q.includes(x), x);
  assert.ok(!q.includes('lien avec son compte Persona'), 'pas de lien Persona : il n\'est pas cité');
  assert.ok(!f.appels.some((a) => a.path === '/u_nour/effacer'), 'refusée : aucun effacement demandé');
  reponse = true;
  bouton(host, 'Voir ce qui sera effacé')!.click(); await flush();
  const eff = f.appels.find((a) => a.path === '/u_nour/effacer')!;
  assert.deepEqual(pur(eff.opts!.body), { jusqua: 1_700_000_100_000, jeton: 'j-1' }, 'la confirmation porte le jeton de l\'aperçu');
  assert.match(host.textContent, /45 lignes effacées\./);
  // Une période mal remplie : rien n'est demandé.
  const n = f.appels.length;
  const radios = tous(host).filter((x) => x.localName === 'input' && x.attributes.type === 'radio');
  (radios[1] as unknown as { checked: boolean }).checked = true; (radios[0] as unknown as { checked: boolean }).checked = false;
  bouton(host, 'Voir ce qui sera effacé')!.click(); await flush();
  assert.equal(f.appels.length, n); assert.match(host.textContent, /Choisis les deux dates/);
});

test('un membre : sa fiche seulement, en lecture (ni note, ni effacement, ni réglages), et « Signaler une erreur »', async () => {
  const { nav, P } = charger();
  const host = nav.make('div'), f = fausseRoute({ membre: true, n: 3 });
  await P.rendre(host, { api: f.api, demander: async () => 'mon canal est faux' }); await flush();
  assert.deepEqual(host.querySelectorAll('.pf-n').map((x) => x.textContent), [PIEGE]);
  assert.equal(host.querySelector('textarea'), null);
  assert.equal(bouton(host, 'Voir ce qui sera effacé'), undefined); assert.equal(bouton(host, 'Ouvrir Persona'), undefined);
  assert.match(host.textContent, /Ta fiche, en lecture\./);
  assert.ok(!tous(host).some((x) => x.localName === 'select' || x.localName === 'input'), 'aucun sélecteur ni case : ses droits en lecture');
  assert.equal(bouton(host, 'Délier'), undefined); assert.equal(bouton(host, 'Lier'), undefined);
  bouton(host, 'Signaler une erreur')!.click(); await flush();
  assert.deepEqual(pur(f.appels.at(-1)), { path: '/moi/signaler', opts: { method: 'POST', body: { texte: 'mon canal est faux' } } });
  assert.match(host.textContent, /le propriétaire d'Odin est prévenu/);
});

test('un refus de la route se dit en clair (sans connexion, lien absent)', async () => {
  const { nav, P } = charger();
  const h1 = nav.make('div'); await P.rendre(h1, { api: async () => ({ ok: false, code: 'connexion', status: 401 }) });
  assert.match(h1.textContent, /Connecte-toi à Odin\./);
  const h2 = nav.make('div'); await P.rendre(h2, { api: async () => ({ ok: false, code: 'refuse', raison: 'lien-absent' }) });
  assert.match(h2.textContent, /Ton compte n'est pas encore relié à ta fiche/);
});

test('menu « Plus » : Profil reste visible même non épinglé (un membre ne peut pas épingler de vue ; des épingles déjà réglées)', () => {
  type Ep = { logique: { VUES: string[]; vuesCachees: (l: string[]) => string[]; vuesToujours: (l: string[]) => string[] } };
  const win: { OdinEpingles?: Ep } = {};
  vm.runInNewContext(readFileSync(new URL('../src/web/pages/epingles.js', import.meta.url), 'utf8'), { window: win });
  const L = win.OdinEpingles!.logique;
  assert.equal(typeof L.vuesCachees, 'function', 'la règle des vues cachées est une fonction pure');
  // Un membre : aucune épingle de vue. Les vues du propriétaire restent cachées, Profil non.
  assert.deepEqual(pur(L.vuesToujours([])), ['vue:profil']);
  assert.ok(!L.vuesCachees([]).includes('vue:profil'));
  assert.deepEqual(pur(L.vuesCachees([])), ['vue:flows', 'vue:runes', 'vue:missions', 'vue:skills', 'vue:jobs', 'vue:audit']);
  // Un propriétaire aux épingles réglées avant Profil : Profil apparaît quand même ; épinglé, il n'est pas en double.
  assert.deepEqual(pur(L.vuesToujours(['vue:flows', 'appli:ymir'])), ['vue:profil']);
  assert.deepEqual(pur(L.vuesToujours(['vue:profil'])), []);
  assert.ok(!L.vuesCachees(['vue:flows']).includes('vue:flows'));
});

// ---------------------------------------------------------------- Lot 3 : « Ce qu'Odin a observé »
const CASES = Array.from({ length: 24 }, (_, h) => (h === 8 ? 12 : h === 20 ? 9 : h === 13 ? 4 : 0));
const CORR = Array.from({ length: 24 }, (_, h) => (h === 7 || h === 8 || h === 20 ? 1 : 0));
function mesuresFausses(o: { membre?: boolean; peu?: boolean; heuresCorrigees?: boolean } = {}) {
  const n = o.peu ? 7 : 25, peu = n < 20;
  return [
    { cle: 'langues', etat: 'mesure', n, tropPeu: peu, valeur: { parts: [{ code: 'fr', n: 15, part: 0.6 }, { code: PIEGE, n: 5, part: 0.2 }], nonReconnues: { n: 5, part: 0.2 } }, cache: false, corrigeParProprietaire: false },
    { cle: 'longueur', etat: 'mesure', n, tropPeu: peu, valeur: { mediane: 38, unite: 'grapheme' }, cache: false, corrigeParProprietaire: true, ...(o.membre ? {} : { valeurMesuree: { mediane: 71, unite: 'grapheme' } }) },
    o.heuresCorrigees
      ? { cle: 'heures', etat: 'mesure', n, tropPeu: peu, valeur: { cases: CORR }, cache: false, corrigeParProprietaire: true, ...(o.membre ? {} : { valeurMesuree: { cases: CASES } }) }
      : { cle: 'heures', etat: 'mesure', n, tropPeu: peu, valeur: { cases: CASES }, cache: false, corrigeParProprietaire: false },
    { cle: 'applis', etat: 'non-mesure', n: 0, tropPeu: true, valeur: null, aNoter: 'appli-du-tour', cache: false, corrigeParProprietaire: false },
    ...(o.membre ? [] : [{ cle: 'abouties', etat: 'mesure', n: 20, tropPeu: false, valeur: { part: 0.75, abouties: 15 }, cache: true, corrigeParProprietaire: false }]),
  ];
}
async function carteAvecMesures(o: { membre?: boolean; peu?: boolean; heuresCorrigees?: boolean } = {}) {
  const { nav, P } = charger();
  const host = nav.make('div'), f = fausseRoute({ membre: o.membre, n: 3 });
  const appels: Array<{ path: string; body?: Record<string, unknown> }> = [];
  const api = async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
    if (path === '/u_nour/mesures') return { ok: true, calculeLe: 1_700_000_000_000, mesures: mesuresFausses(o) };
    if (path.startsWith('/u_nour/mesures/')) { appels.push({ path, body: opts?.body }); return { ok: true, calculeLe: 1_700_000_000_000, mesures: mesuresFausses(o) }; }
    return f.api(path, opts);
  };
  const r = await P.rendre(host, { api });
  if (!o.membre) await r!.choisir('u_nour');
  await flush();
  const bloc = host.querySelector('.pf-obs');
  return { host, bloc: bloc!, appels, P };
}
const item = (bloc: FauxEl, cle: string) => tous(bloc).find((x) => x.attributes['data-mesure'] === cle)!;

test('la carte montre « Ce qu\'Odin a observé » : chaque mesure, sa valeur dite simplement, « sur N observations », la date du calcul', async () => {
  const { host, bloc } = await carteAvecMesures();
  assert.ok(bloc, 'le bloc est sur la carte');
  const txt = bloc.textContent;
  assert.ok(tous(host).some((x) => x.localName === 'h3' && x.textContent === "Ce qu'Odin a observé"), 'son titre');
  assert.match(txt, /Calculé le /);
  for (const cle of ['langues', 'longueur', 'heures', 'applis', 'abouties']) assert.ok(item(bloc, cle), cle);
  assert.match(item(bloc, 'langues').textContent, /60\s?%/); assert.match(item(bloc, 'langues').textContent, /non reconnue/);
  assert.match(item(bloc, 'langues').textContent, /sur 25 observations/);
  assert.match(item(bloc, 'longueur').textContent, /38 caractères/);
  assert.match(item(bloc, 'abouties').textContent, /75\s?%/);
  // Les heures : 24 petites barres, et le même contenu en texte.
  const h = item(bloc, 'heures');
  assert.equal(tous(h).filter((x) => x.className === 'pf-hb').length, 24);
  assert.match(h.textContent, /3 heures sur 24/); // le texte équivalent dit les heures les plus fréquentes
  const graphe = tous(h).find((x) => x.attributes.role === 'img')!;
  assert.ok(graphe.attributes['aria-label'].includes('12'), 'les barres ont un texte équivalent complet');
  // Non mesuré : dit, avec la raison.
  assert.match(item(bloc, 'applis').textContent, /non mesuré/i);
  assert.match(item(bloc, 'applis').textContent, /pas encore notée/);
  // Corrigée : la marque, et la mesure d'Odin pour le propriétaire seulement.
  assert.match(item(bloc, 'longueur').textContent, /corrigé par toi/);
  assert.match(item(bloc, 'longueur').textContent, /71/);
  assert.match(item(bloc, 'abouties').textContent, /Cachée/);
  // Aucune phrase qui juge : seulement les textes du dictionnaire « mes. ».
  assert.doesNotMatch(txt, /\[mes\./, 'aucune clé absente');
});

test('« trop peu » : sous 20 observations la mesure est grisée et le dit', async () => {
  const { bloc } = await carteAvecMesures({ peu: true });
  for (const cle of ['langues', 'longueur', 'heures']) {
    const x = item(bloc, cle);
    assert.ok(x.classList.contains('peu'), `${cle} grisée`);
    assert.match(x.textContent, /trop peu/);
    assert.match(x.textContent, /sur 7 observations/);
  }
  assert.ok(!item(bloc, 'abouties').classList.contains('peu'), '20 observations : pas grisée');
  assert.doesNotMatch(item(bloc, 'abouties').textContent, /trop peu/);
});

test('une valeur piégée dans les mesures reste du texte', async () => {
  const { host, bloc } = await carteAvecMesures();
  assert.equal(tous(host).filter((x) => x.localName === 'img' || x.localName === 'script').length, 0);
  assert.ok(item(bloc, 'langues').textContent.includes(PIEGE));
});

test('le propriétaire cache, corrige (formulaire adapté), annule ; chaque fois la mesure revient à jour', async () => {
  const { bloc, appels } = await carteAvecMesures();
  bouton(item(bloc, 'heures'), 'Cacher')!.click(); await flush();
  assert.deepEqual(pur(appels.at(-1)), { path: '/u_nour/mesures/heures', body: { cacher: true } });
  bouton(item(bloc, 'abouties'), 'Remettre')!.click(); await flush();
  assert.deepEqual(pur(appels.at(-1)), { path: '/u_nour/mesures/abouties', body: { cacher: false } });
  bouton(item(bloc, 'longueur'), 'Annuler ma correction')!.click(); await flush();
  assert.deepEqual(pur(appels.at(-1)), { path: '/u_nour/mesures/longueur', body: { annuler: true } });
  // Corriger la longueur : un nombre.
  bouton(item(bloc, 'longueur'), 'Corriger')!.click(); await flush();
  const champ = tous(item(bloc, 'longueur')).find((x) => x.localName === 'input')!;
  champ.value = '42';
  bouton(item(bloc, 'longueur'), 'Enregistrer')!.click(); await flush();
  assert.deepEqual(pur(appels.at(-1)), { path: '/u_nour/mesures/longueur', body: { corriger: { mediane: 42 } } });
  // Corriger la part des abouties : un pourcentage.
  bouton(item(bloc, 'abouties'), 'Corriger')!.click(); await flush();
  tous(item(bloc, 'abouties')).find((x) => x.localName === 'input')!.value = '40';
  bouton(item(bloc, 'abouties'), 'Enregistrer')!.click(); await flush();
  assert.deepEqual(pur(appels.at(-1)), { path: '/u_nour/mesures/abouties', body: { corriger: { part: 0.4 } } });
  // Corriger les heures : 24 boutons, une heure habituelle ou non.
  bouton(item(bloc, 'heures'), 'Corriger')!.click(); await flush();
  const hs = tous(item(bloc, 'heures')).filter((x) => x.localName === 'button' && x.attributes['aria-pressed'] !== undefined);
  assert.equal(hs.length, 24);
  assert.equal(hs[8].attributes['aria-pressed'], 'true', 'pré-rempli depuis la mesure');
  hs[8].click(); hs[21].click();
  bouton(item(bloc, 'heures'), 'Enregistrer')!.click(); await flush();
  const attendu = Array(24).fill(0); attendu[13] = 1; attendu[20] = 1; attendu[21] = 1;
  assert.deepEqual(pur(appels.at(-1)), { path: '/u_nour/mesures/heures', body: { corriger: { cases: attendu } } });
  // Corriger les langues : un code et sa part, ligne par ligne.
  bouton(item(bloc, 'langues'), 'Corriger')!.click(); await flush();
  const ins = tous(item(bloc, 'langues')).filter((x) => x.localName === 'input');
  ins[0].value = 'swb'; ins[1].value = '70'; ins[2].value = 'fr'; ins[3].value = '30';
  bouton(item(bloc, 'langues'), 'Enregistrer')!.click(); await flush();
  assert.deepEqual(pur(appels.at(-1)), { path: '/u_nour/mesures/langues', body: { corriger: { parts: [{ code: 'swb', part: 0.7 }, { code: 'fr', part: 0.3 }] } } });
  // « applis » n'est pas mesuré : rien à corriger ni à cacher.
  assert.equal(tous(item(bloc, 'applis')).filter((x) => x.localName === 'button').length, 0);
});

test('un membre voit ses mesures en lecture : ni bouton, ni valeur d\'origine, et la marque dit « corrigé par le propriétaire »', async () => {
  const { bloc } = await carteAvecMesures({ membre: true });
  assert.ok(bloc);
  assert.equal(tous(bloc).filter((x) => x.localName === 'button').length, 0);
  assert.equal(item(bloc, 'abouties'), undefined);
  assert.match(item(bloc, 'longueur').textContent, /corrigé par le propriétaire/);
  assert.doesNotMatch(item(bloc, 'longueur').textContent, /71/);
});

test('heures corrigées : seules les heures choisies sont dites, sans nombre qu\'Odin n\'a pas mesuré', async () => {
  for (const membre of [false, true]) {
    const { bloc } = await carteAvecMesures({ heuresCorrigees: true, membre });
    const h = item(bloc, 'heures');
    const valeur = tous(h).find((x) => x.className === 'pf-ht')!;
    assert.doesNotMatch(valeur.textContent, /\(\d/, 'aucun compte entre parenthèses');
    assert.doesNotMatch(valeur.textContent, /le plus souvent/);
    assert.match(valeur.textContent, /3 heures/, 'les trois heures choisies');
    const graphe = tous(h).find((x) => x.attributes.role === 'img')!;
    assert.doesNotMatch(graphe.attributes['aria-label'], /:\s*1\b/, 'le texte équivalent ne donne pas de compte');
    assert.equal(tous(h).filter((x) => x.className === 'pf-hb').length, 24);
    // Le propriétaire voit toujours la vraie mesure d'Odin, avec ses comptes.
    if (!membre) assert.match(h.textContent, /Mesure d'Odin : .*\(12\)/);
  }
});

test('une mesure cachée le dit en bon français', async () => {
  const { bloc } = await carteAvecMesures();
  assert.match(item(bloc, 'abouties').textContent, /Cachée : toi seul la vois/);
});

test('la confirmation d\'effacement dit ce que deviennent les mesures', () => {
  const { P } = charger();
  const bilan = { retire: { historique: 4 }, reste: { historique: 0, messages: 0, missions: 0, aiguillage: 0, souvenirs: 0, note: false, lienPersona: false, mesuresCorrigees: 2 } };
  const q = P.logique.texteConfirmation('Nour', { jusqua: 1_700_000_000_000 }, bilan);
  assert.match(q, /mesures gardées de « Ce qu'Odin a observé »/);
  assert.match(q, /2 mesures que tu as cachées ou corrigées/);
  const q0 = P.logique.texteConfirmation('Nour', { jusqua: 1_700_000_000_000 }, { ...bilan, reste: { ...bilan.reste, mesuresCorrigees: 0 } });
  assert.doesNotMatch(q0, /cachées ou corrigées/);
});

test('logique pure : une période de deux dates, du début du premier jour à la fin du second ; sinon rien', () => {
  const { P } = charger();
  const p = P.logique.periodeDe('2026-11-01', '2026-11-02')!;
  assert.equal(p.jusqua - p.depuis, 2 * 86_400_000 - 1);
  assert.equal(P.logique.periodeDe('2026-11-03', '2026-11-02'), undefined);
  assert.equal(P.logique.periodeDe('', '2026-11-02'), undefined);
});
