// La page Kéryx (src/web/pages/keryx*.js) avec un FAUX moteur conforme au CONTRAT : on vérifie que la page charge,
// montre le bandeau « vie privée » (aucune capture, aucun pistage) et l'état honnête (mail/agenda branchés ou non),
// lit et écrit les réglages, pose/retire le code secret, affiche et efface l'historique, et rend un transcript de
// faux pair étiqueté « aucune vraie ligne ». Rien d'extérieur : tout en mémoire, aucun vrai service ni numéro.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fauxNavigateur } from './archytas-fixtures.ts';
import { fauxMoteur, fauxServeur, apiPour } from './keryx-fixtures.ts';

const FICHIERS = ['keryx-historique.js', 'keryx-reglages.js', 'keryx.js']; // ordre de service (alphabétique)
const sources = FICHIERS.map((n) => readFileSync(new URL(`../src/web/pages/${n}`, import.meta.url), 'utf8'));

interface Win { OdinKeryx: { rendre: (h: unknown, c?: unknown) => Promise<unknown>; logique: Record<string, unknown> }; OdinKeryxReglages: { rendre: (h: unknown, c?: unknown) => Promise<void>; logique: Record<string, unknown> }; OdinKeryxHistorique: { rendre: (h: unknown, c?: unknown) => Promise<{ charger: (r: boolean) => Promise<void>; effacerTout: () => Promise<void>; etat: { entrees: unknown[] } }>; logique: Record<string, unknown> }; OdinPages: Record<string, (a: unknown) => Promise<unknown>>; OdinDialog?: unknown }

function charger() {
  const nav = fauxNavigateur();
  nav.sandbox.URLSearchParams = URLSearchParams; // standard du navigateur, à fournir au vm nu
  const ctx = vm.createContext(nav.sandbox);
  for (const src of sources) vm.runInContext(src, ctx);
  const win = nav.window as unknown as Win;
  (win as { OdinDialog?: unknown }).OdinDialog = { confirm: async () => true, alert: async () => {} };
  return { nav, win };
}

const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
type FEl = { textContent: string; querySelectorAll: (s: string) => FEl[]; querySelector: (s: string) => FEl | null; value: string; attributes: Record<string, string>; click: () => void; dispatch: (t: string, e?: unknown) => void; setAttribute: (k: string, v: string) => void };
const boutons = (host: FEl) => host.querySelectorAll('button');
const boutonTexte = (host: FEl, t: string) => boutons(host).find((b) => b.textContent.includes(t));

test('kéryx : les trois modules s\'enregistrent et la page est dans OdinPages', () => {
  const { win } = charger();
  assert.ok(win.OdinKeryx, 'window.OdinKeryx posé');
  assert.ok(win.OdinKeryxReglages && win.OdinKeryxReglages.rendre, 'window.OdinKeryxReglages posé');
  assert.ok(win.OdinKeryxHistorique && win.OdinKeryxHistorique.rendre, 'window.OdinKeryxHistorique posé');
  assert.equal(typeof win.OdinPages.keryx, 'function', 'la page est enregistrée dans OdinPages.keryx');
});

test('kéryx : logique pure (libellés honnêtes, contrôle d\'un numéro)', () => {
  const { win } = charger();
  const R = win.OdinKeryxReglages.logique as { ligneTitre: (l: string) => string; autoTitre: (a: string) => string; valideNumero: (n: string) => boolean; nettoieNumero: (n: string) => string };
  assert.equal(R.ligneTitre('aucune'), 'Aucune ligne');
  assert.equal(R.autoTitre('autonome'), 'Autonome');
  assert.equal(R.valideNumero('+33 6 12 34 56 78'), true);
  assert.equal(R.valideNumero('abc'), false);
  assert.equal(R.valideNumero('123'), false, 'trop court');
  assert.equal(R.nettoieNumero('+33 6 12'), '+33612');
  const K = win.OdinKeryx.logique as { ligneEtat: (l: string) => string; resumeCanaux: (e: unknown) => string };
  assert.equal(K.ligneEtat('sip'), 'ligne SIP');
  assert.equal(K.resumeCanaux({ canauxActifs: ['telegram', 'voix'] }), 'telegram, voix');
  assert.equal(K.resumeCanaux({ canauxActifs: [] }), 'aucun canal actif pour l\'instant');
  const H = win.OdinKeryxHistorique.logique as { graviteTexte: (g: string) => string; resultatTexte: (r: string) => string; sensTitre: (s: string) => string };
  assert.equal(H.graviteTexte('grave'), 'grave');
  assert.equal(H.resultatTexte('refusee'), 'refusée');
  assert.equal(H.sensTitre('entrant'), 'Reçu');
});

test('kéryx : la page complète charge, montre le bandeau vie privée et l\'état honnête', async () => {
  const { nav, win } = charger();
  const serveur = fauxServeur(fauxMoteur());
  nav.brancherServeur(serveur.fetch); // la page passe par le fetch global du sandbox
  const host = nav.make('div') as unknown as FEl;
  const pris = await win.OdinPages.keryx({ host });
  await flush();
  assert.equal(pris, true, 'la page prend la main (retourne true)');
  const txt = host.textContent;
  assert.match(txt, /AUCUNE capture d'écran/, 'le bandeau vie privée est présent');
  assert.match(txt, /piste PAS ta position/);
  assert.match(txt, /non branché/, 'l\'agenda non branché est signalé');
  assert.match(txt, /aucune ligne/, 'l\'état de ligne est montré');
  // Volet par défaut = Réglages.
  assert.match(txt, /Numéros connus/);
  assert.match(txt, /\+33 6 12 34 56 78/, 'le numéro de la liste blanche est affiché');
  assert.match(txt, /Code secret/);
});

test('kéryx réglages : bandeau « non essayé » sur SIP, et transcript du faux pair', async () => {
  const { nav, win } = charger();
  const serveur = fauxServeur(fauxMoteur());
  const host = nav.make('div') as unknown as FEl;
  await win.OdinKeryxReglages.rendre(host, { api: apiPour(serveur) });
  await flush();
  // Choisir la ligne SIP → bandeau matériel + bouton Essayer.
  const segSip = boutonTexte(host, 'SIP');
  assert.ok(segSip, 'le segment SIP existe');
  segSip!.click();
  await flush();
  assert.match(host.textContent, /pas essayé sur du vrai matériel/i, 'le bandeau honnête apparaît sur SIP');
  const essayer = boutonTexte(host, 'Essayer');
  assert.ok(essayer, 'un bouton Essayer est présent pour SIP');
  essayer!.click();
  await flush();
  const txt = host.textContent;
  assert.match(txt, /aucune vraie ligne/i, 'le transcript est étiqueté « aucune vraie ligne »');
  assert.match(txt, /REGISTER/, 'le transcript SIP montre le REGISTER du faux pair');
  assert.match(txt, /200 OK/);
});

test('kéryx réglages : ajouter un numéro et enregistrer envoie un PUT /reglages', async () => {
  const { nav, win } = charger();
  const moteur = fauxMoteur();
  const serveur = fauxServeur(moteur);
  const host = nav.make('div') as unknown as FEl;
  await win.OdinKeryxReglages.rendre(host, { api: apiPour(serveur) });
  await flush();
  const saisie = host.querySelectorAll('input').find((e) => (e.attributes.placeholder || '').includes('+33'));
  assert.ok(saisie, 'le champ d\'ajout de numéro existe');
  saisie!.value = '+33 7 00 11 22 33';
  boutonTexte(host, 'Ajouter')!.click();
  await flush();
  assert.match(host.textContent, /\+33 7 00 11 22 33/, 'le nouveau numéro apparaît dans la liste');
  boutonTexte(host, 'Enregistrer les réglages')!.click();
  await flush();
  const put = serveur.journal.find((x) => x.methode === 'PUT' && x.chemin === '/reglages');
  assert.ok(put, 'un PUT /reglages a été envoyé');
  const corps = put!.corps as { numeros: string[] };
  assert.ok(corps.numeros.some((n) => n.includes('00 11 22 33')), 'le PUT contient le nouveau numéro');
  assert.ok(moteur.reglages.numeros.some((n) => n.includes('00 11 22 33')), 'le moteur a enregistré le numéro');
});

test('kéryx réglages : poser puis retirer le code secret', async () => {
  const { nav, win } = charger();
  const moteur = fauxMoteur();
  const serveur = fauxServeur(moteur);
  const host = nav.make('div') as unknown as FEl;
  await win.OdinKeryxReglages.rendre(host, { api: apiPour(serveur) });
  await flush();
  const codeInput = host.querySelectorAll('input').find((e) => e.attributes.type === 'password');
  assert.ok(codeInput, 'le champ du code secret existe');
  codeInput!.value = 'mon-code-secret';
  boutonTexte(host, 'Poser le code')!.click();
  await flush();
  const post = serveur.journal.find((x) => x.methode === 'POST' && x.chemin === '/secret');
  assert.ok(post, 'un POST /secret a été envoyé');
  assert.equal((post!.corps as { code: string }).code, 'mon-code-secret');
  assert.equal(moteur.secretPose, true, 'le moteur note le secret posé');
  assert.match(host.textContent, /Code secret posé/, 'la page confirme sans réafficher le code');
  // Retirer (OdinDialog.confirm renvoie true dans le stub).
  boutonTexte(host, 'Retirer le code')!.click();
  await flush();
  assert.ok(serveur.journal.find((x) => x.methode === 'DELETE' && x.chemin === '/secret'), 'un DELETE /secret a été envoyé');
  assert.equal(moteur.secretPose, false, 'le moteur note le secret retiré');
});

test('kéryx historique : affiche les échanges avec gravité et état, et les efface pour de vrai', async () => {
  const { nav, win } = charger();
  const moteur = fauxMoteur();
  const serveur = fauxServeur(moteur);
  const host = nav.make('div') as unknown as FEl;
  const ctrl = await win.OdinKeryxHistorique.rendre(host, { api: apiPour(serveur) });
  await flush();
  const txt = host.textContent;
  assert.match(txt, /décale à jeudi 15 h/, 'un message entrant est affiché');
  assert.match(txt, /mail_send/, 'une action est affichée');
  assert.match(txt, /important/, 'la gravité est affichée');
  assert.match(txt, /en attente|faite/, 'l\'état de l\'action est affiché');
  assert.ok(ctrl.etat.entrees.length >= 5, 'toutes les entrées sont chargées');
  // Tout effacer (confirm = true dans le stub) → effacement réel côté moteur.
  await ctrl.effacerTout();
  await flush();
  const efface = serveur.journal.find((x) => x.chemin === '/historique/effacer' && (x.corps as { tout?: boolean }).tout === true);
  assert.ok(efface, 'un POST /historique/effacer { tout:true } a été envoyé');
  assert.equal(moteur.trace.length, 0, 'le moteur a réellement vidé la trace');
  assert.match(host.textContent, /Rien pour l'instant|apparaîtront ici/, 'la page montre l\'historique vide');
});

test('kéryx intégration (faux moteur) : état → réglages → secret → historique → essayer de bout en bout', async () => {
  const { nav, win } = charger();
  const moteur = fauxMoteur();
  const serveur = fauxServeur(moteur);
  const api = apiPour(serveur);
  // 1. état
  const etat = await api('/etat') as { ligne: string; viePrivee: { captureEcran: boolean }; telephonieEssayee: boolean };
  assert.equal(etat.ligne, 'aucune');
  assert.equal(etat.viePrivee.captureEcran, false);
  assert.equal(etat.telephonieEssayee, false);
  // 2. réglages lus/écrits
  const r0 = await api('/reglages') as { ligne: string };
  assert.equal(r0.ligne, 'aucune');
  const r1 = await api('/reglages', { method: 'PUT', body: { autonomieApresSecret: 'equilibre' } }) as { autonomieApresSecret: string };
  assert.equal(r1.autonomieApresSecret, 'equilibre');
  // 3. secret
  assert.deepEqual(await api('/secret', { method: 'POST', body: { code: 'x1234' } }), { ok: true, status: 200, pose: true });
  assert.deepEqual(await api('/secret', { method: 'DELETE' }), { ok: true, status: 200, pose: false });
  // 4. historique
  const h = await api('/historique?n=50') as { entrees: unknown[] };
  assert.ok(Array.isArray(h.entrees) && h.entrees.length >= 5);
  // 5. essayer (SIP et modem)
  const sip = await api('/essayer', { method: 'POST', body: { quoi: 'sip' } }) as { quoi: string; etapes: unknown[]; note: string };
  assert.equal(sip.quoi, 'sip');
  assert.ok(sip.etapes.length > 0);
  assert.match(sip.note, /pas essayé sur du vrai matériel/i);
  const modem = await api('/essayer', { method: 'POST', body: { quoi: 'modem' } }) as { quoi: string };
  assert.equal(modem.quoi, 'modem');
});
