// Fenêtre Profil, lot 5b — le bloc « Droits » sur la carte d'une personne (src/web/pages/personnes.js) et ce que la route
// lui donne à lire (src/web/personnes-api.ts). Le bloc n'appelle QUE les actions qui existent (user_save, user_link,
// user_unlink sur /api/action ; acces_cases, modifier, couper_appareil de Persona sur /api/valhalla/act), telles qu'elles
// sont : limiter part en un geste ; donner montre la validation venue du serveur (avant → après) et rien ne change avant
// le geste du propriétaire ; « Couper tout » demande une confirmation simple qui dit ce qui sera coupé. Un membre voit ses
// droits en lecture ; un nom piégé reste du texte. Prénoms et identifiants inventés.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fauxNavigateur, FauxEl } from './archytas-fixtures.ts';
import { Mnemosyne } from '../src/muninn/store.ts';
import { noterDroit, type Demandeur } from '../src/muninn/personnes.ts';
import { traiterPersonnes, type DepsPersonnes, type DroitsPersona, type Requete } from '../src/web/personnes-api.ts';

// ---------------------------------------------------------------- La route : l'état des droits, en lecture

const PROPRIO: Demandeur = { sorte: 'proprietaire' }, NOUR: Demandeur = { sorte: 'membre', personaId: 'p-nour' };
const lienP = (mu: Mnemosyne, userId: string, personaId: string) => mu.table<Record<string, unknown>>('personnes_liens', (r) => String(r.user_id)).put({ user_id: userId, persona_id: personaId, par: 'proprietaire', t: 1 });
const req = (dm: Demandeur, chemin: string): Requete => ({ methode: 'GET', chemin, query: new URLSearchParams(''), demandeur: dm });

function monde() {
  const mu = new Mnemosyne(':memory:');
  const nour = mu.saveUser({ name: 'Nour', role: 'member', autonomy: 'prudent' });
  const sami = mu.saveUser({ name: 'Sami', role: 'member', autonomy: 'equilibre' });
  mu.linkIdentity('telegram', '2001', nour.id); lienP(mu, nour.id, 'p-nour'); lienP(mu, sami.id, 'p-sami');
  const droits: Record<string, DroitsPersona> = {
    'p-nour': { login: 'nour', actif: true, admin: false, groupes: ['famille'], applis: [{ id: 'venus', nom: 'Vénus', personnel: false, par: ['famille'] }, { id: 'pegase', nom: 'Pégase', personnel: true, par: [] }, { id: 'bragi', nom: 'Bragi', personnel: false, par: [] }], appareils: [{ id: 's-1', sorte: 'appli', appli: 'Vénus', nom: 'Téléphone', plateforme: 'Android', vu: 5 }] },
    'p-sami': { login: 'sami', actif: false, admin: false, groupes: [], applis: [], appareils: [] },
  };
  const d: DepsPersonnes = {
    mu, personnesPersona: () => [{ id: 'p-nour', login: 'nour', name: 'Nour' }, { id: 'p-sami', login: 'sami', name: 'Sami' }],
    accesDe: (pid) => (pid === 'p-nour' ? { groupes: ['famille'], applis: [{ id: 'venus', nom: 'Vénus' }, { id: 'pegase', nom: 'Pégase' }] } : { groupes: [], applis: [] }),
    droitsDe: (pid) => droits[pid], prevenir: () => true, maintenant: () => 1_000_000,
  };
  return { mu, nour, sami, d };
}

test('route : le propriétaire reçoit l\'état des droits dans les deux registres (mémoire d\'Odin sur la carte, Persona dans « droits »)', () => {
  const { nour, d } = monde();
  const r = traiterPersonnes(req(PROPRIO, `/${nour.id}`), d);
  assert.equal(r.code, 200);
  const c = r.body.carte as Record<string, unknown>;
  assert.equal(c.role, 'member'); assert.equal(c.autonomie, 'prudent');
  const dr = c.droits as DroitsPersona;
  assert.equal(dr.login, 'nour'); assert.equal(dr.actif, true); assert.deepEqual(dr.groupes, ['famille']);
  assert.deepEqual(dr.applis.map((a) => [a.id, a.personnel, a.par]), [['venus', false, ['famille']], ['pegase', true, []], ['bragi', false, []]]);
  assert.equal(dr.appareils[0].id, 's-1', 'le propriétaire reçoit de quoi couper un appareil');
});

test('route : un membre reçoit SES droits en lecture (sans identifiant d\'appareil) ; l\'état des droits d\'un autre lui est refusé', () => {
  const { nour, sami, d } = monde();
  const r = traiterPersonnes(req(NOUR, `/${nour.id}`), d);
  assert.equal(r.code, 200);
  const dr = (r.body.carte as { droits: DroitsPersona }).droits;
  assert.equal(dr.login, 'nour');
  assert.deepEqual(dr.applis.map((a) => a.id), ['venus', 'pegase'], 'un membre ne reçoit que les applis qu\'il peut ouvrir, pas tout le catalogue');
  assert.equal('id' in dr.appareils[0], false, 'aucun identifiant de connexion pour un membre');
  const autre = traiterPersonnes(req(NOUR, `/${sami.id}`), d);
  assert.equal(autre.code, 403); assert.equal('carte' in autre.body, false);
  assert.equal(JSON.stringify(autre.body).includes('sami'), false, 'rien des droits de Sami');
});

test('route : l\'historique d\'une personne, vu par le propriétaire, porte les lignes du journal des droits qui la concernent (codes) ; pas celui d\'un membre', () => {
  const { mu, nour, sami, d } = monde();
  noterDroit(mu, { registre: 'odin', pour: nour.id, quoi: 'autonomie', avant: 'prudent', apres: 'equilibre', sens: 'donne', t: 10 });
  noterDroit(mu, { registre: 'persona', canal: 'persona', pour: '@nour', quoi: 'acces:venus', avant: 'admin', apres: 'admin,@nour', sens: 'donne', t: 20 });
  noterDroit(mu, { registre: 'odin', pour: sami.id, quoi: 'role', avant: 'member', apres: 'guest', sens: 'limite', t: 30 });
  const h = traiterPersonnes({ ...req(PROPRIO, `/${nour.id}/historique`) }, d);
  const l = h.body.lignes as Array<{ sorte: string; droit?: Record<string, string> }>;
  const dr = l.filter((x) => x.sorte === 'droit');
  assert.equal(dr.length, 2, 'les deux lignes de Nour, pas celle de Sami');
  assert.deepEqual(dr.map((x) => x.droit), [
    { registre: 'persona', pour: '@nour', quoi: 'acces:venus', avant: 'admin', apres: 'admin,@nour', sens: 'donne' },
    { registre: 'odin', pour: nour.id, quoi: 'autonomie', avant: 'prudent', apres: 'equilibre', sens: 'donne' },
  ]);
  const m = traiterPersonnes(req(NOUR, `/${nour.id}/historique`), d);
  assert.equal((m.body.lignes as Array<{ sorte: string }>).filter((x) => x.sorte === 'droit').length, 0, 'un membre ne voit pas le journal des droits (« seulement si elle essaie »)');
});

test('route : l\'aperçu d\'effacement compte les changements de ses droits, qui restent (journal du propriétaire) ; effacé, ils sont toujours là', () => {
  const { mu, nour, d } = monde();
  mu.noterHistorique({ t: 5, qui: nour.id, session: 'telegram:2001', canal: 'telegram', sorte: 'demande', preuve: 'appareil-appaire', partage: false });
  noterDroit(mu, { registre: 'odin', pour: nour.id, quoi: 'autonomie', avant: 'prudent', apres: 'equilibre', sens: 'donne', t: 10 });
  noterDroit(mu, { registre: 'persona', canal: 'persona', pour: '@nour', quoi: 'acces:venus', avant: 'admin', apres: 'admin,@nour', sens: 'donne', t: 20 });
  const post = (chemin: string, corps: Record<string, unknown>) => traiterPersonnes({ ...req(PROPRIO, `/${nour.id}${chemin}`), methode: 'POST', corps }, d);
  const ap = post('/effacer/apercu', {}).body as { bilan: { retire: { historique: number }; reste: Record<string, unknown> }; cible: { jusqua: number }; jeton: string };
  assert.equal(ap.bilan.retire.historique, 1);
  assert.equal(ap.bilan.reste.droits, 2, 'l\'aperçu dit que ses 2 changements de droits restent');
  assert.equal(post('/effacer', { jusqua: ap.cible.jusqua, jeton: ap.jeton }).code, 200);
  const h = traiterPersonnes(req(PROPRIO, `/${nour.id}/historique`), d).body.lignes as Array<{ sorte: string }>;
  assert.equal(h.filter((x) => x.sorte === 'droit').length, 2, 'ils sont toujours dans son historique');
  assert.equal(h.length, 2, 'la demande, elle, est effacée');
});

// ---------------------------------------------------------------- La page : le bloc « Droits »

const SOURCE = readFileSync(new URL('../src/web/pages/personnes.js', import.meta.url), 'utf8');
type Rendu = { etat: Record<string, unknown>; choisir: (id: string) => Promise<void> };
type Profil = { rendre: (h: unknown, c?: unknown) => Promise<Rendu | undefined>; logique: Record<string, unknown> & { T: Record<string, string>; t: (k: string, v?: Record<string, unknown>) => string; clesAttendues: () => string[] } };
function charger() {
  const nav = fauxNavigateur(); const ctx = vm.createContext(nav.sandbox); vm.runInContext(SOURCE, ctx);
  return { nav, P: (nav.window as { OdinProfil: Profil }).OdinProfil };
}
const tous = (n: FauxEl): FauxEl[] => { const out: FauxEl[] = []; const w = (x: FauxEl) => { for (const c of x.childNodes) if (c instanceof FauxEl) { out.push(c); w(c); } }; w(n); return out; };
const bouton = (h: FauxEl, txt: string) => tous(h).find((b) => b.localName === 'button' && b.textContent.includes(txt));
const attr = (h: FauxEl, k: string, v: string) => tous(h).find((x) => x.attributes[k] === v);
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const pur = (x: unknown) => JSON.parse(JSON.stringify(x));
const PIEGE = '<img src=x onerror=alert(1)>';

/** Une fausse route /api/personnes et un faux serveur des actions : ce qu'ils répondent, et le journal des envois. */
function scene(o: { membre?: boolean } = {}) {
  const carte = {
    id: 'u_nour', nom: PIEGE, role: 'member', autonomie: 'prudent', portrait: null,
    identites: [{ canal: 'telegram', pair: '2001', partage: false, preuve: 'appareil-appaire' }],
    persona: { id: 'p-nour', login: 'nour', nom: 'Nour' }, acces: { groupes: ['famille'], applis: [{ id: 'venus', nom: 'Vénus' }, { id: 'pegase', nom: 'Pégase' }] },
    droits: {
      login: 'nour', actif: true, admin: false, groupes: ['famille'],
      applis: [{ id: 'venus', nom: 'Vénus', personnel: false, par: ['famille'] }, { id: 'pegase', nom: 'Pégase', personnel: true, par: [] }, { id: 'bragi', nom: PIEGE, personnel: false, par: [] }, { id: 'hermes', nom: 'Hermès', personnel: false, par: ['*'] }],
      appareils: [{ ...(o.membre ? {} : { id: 's-1' }), sorte: 'appli', appli: 'Vénus', nom: PIEGE, plateforme: 'Android', vu: 1_700_000_000_000 }],
    },
    ...(o.membre ? {} : { note: '', notable: true }),
  };
  const lus: string[] = [], envois: Array<{ url: string; corps: Record<string, unknown> }> = [];
  let reponses: Array<Record<string, unknown>> = [];
  const lignes = [
    { id: 2, t: 1_700_000_100_000, sorte: 'droit', canal: 'web', preuve: 'session-proprietaire', partage: false, resultat: null, droit: { registre: 'odin', pour: 'u_nour', quoi: 'autonomie', avant: 'prudent', apres: 'equilibre', sens: 'donne' } },
    { id: 1, t: 1_700_000_000_000, sorte: 'droit', canal: 'persona', preuve: 'session-proprietaire', partage: false, resultat: null, droit: { registre: 'persona', pour: '@nour', quoi: 'acces:bragi', avant: 'admin,@nour', apres: 'admin', sens: 'limite' } },
  ];
  async function api(path: string) {
    lus.push(path);
    if (path === '') return o.membre ? { ok: true, proprietaire: false, personnes: [{ id: 'u_nour', nom: PIEGE, role: 'member', canaux: ['telegram'] }] }
      : { ok: true, proprietaire: true, personnes: [{ id: 'proprietaire', nom: '', role: 'owner', canaux: [], synthetique: true }, { id: 'u_nour', nom: PIEGE, role: 'member', canaux: ['telegram'] }] };
    if (path === '/u_nour') return { ok: true, proprietaire: !o.membre, carte: pur(carte) };
    if (path.startsWith('/u_nour/historique')) return { ok: true, lignes: o.membre ? [] : lignes, total: o.membre ? 0 : 2 };
    if (path === '/u_nour/mesures') return { ok: true, calculeLe: 1, mesures: [] };
    return { ok: false, code: 'inconnu' };
  }
  async function poster(url: string, corps: Record<string, unknown>) { envois.push({ url, corps: pur(corps) }); return reponses.shift() ?? { ok: true }; }
  const questions: string[] = [], coupures: string[] = [];
  let oui = false;
  const valider = async (txt: string) => { questions.push(txt); return oui; };
  const confirmerCoupure = async (txt: string) => { coupures.push(txt); return oui; };
  return { carte, lus, envois, questions, coupures, api, poster, valider, confirmerCoupure, repondre: (...r: Array<Record<string, unknown>>) => { reponses = r; }, dire: (x: boolean) => { oui = x; } };
}
async function ouvrir(o: { membre?: boolean } = {}) {
  const { nav, P } = charger(), s = scene(o), host = nav.make('div');
  const r = await P.rendre(host, { api: s.api, poster: s.poster, valider: s.valider, confirmerCoupure: s.confirmerCoupure });
  if (!o.membre) await r!.choisir('u_nour');
  await flush();
  return { host, s, P, r };
}
const relectures = (s: ReturnType<typeof scene>) => s.lus.filter((p) => p === '/u_nour').length;

test('page : le propriétaire voit le bloc « Droits » et ses deux registres nommés (mémoire d\'Odin ; Persona), d\'où vient chaque accès, identités et appareils', async () => {
  const { host } = await ouvrir();
  const bloc = host.querySelector('.pf-droits');
  assert.ok(bloc, 'le bloc existe');
  const txt = bloc!.textContent;
  assert.match(txt, /Droits/); assert.match(txt, /Dans la mémoire d'Odin/); assert.match(txt, /Dans Persona/);
  assert.match(txt, /telegram:2001/); assert.match(txt, /appareil appairé/);
  assert.match(txt, /par le groupe famille/); assert.match(txt, /accès à elle seule/);
  assert.match(txt, /Android/); assert.match(txt, /Compte : actif/);
  assert.ok(attr(bloc!, 'data-droit', 'role')?.localName === 'select', 'le rôle se règle');
  assert.ok(attr(bloc!, 'data-droit', 'autonomie')?.localName === 'select', 'l\'autonomie se règle');
  const venus = attr(bloc!, 'data-appli', 'venus')!, pegase = attr(bloc!, 'data-appli', 'pegase')!;
  assert.equal(venus.attributes.disabled, '', 'un accès venu du groupe ne se décoche pas ici (il toucherait tout le groupe)');
  assert.equal(pegase.attributes.disabled, undefined); assert.equal((pegase as unknown as { checked: boolean }).checked, true);
  for (const b of ['Délier', 'Lier…', 'Couper le compte', 'Couper tout…']) assert.ok(bouton(bloc!, b), b);
});

test('page : sans inconnus, la liste n\'écrit ni « null » ni « undefined » (vu à l\'écran)', async () => {
  // Un vrai navigateur écrit « null » pour replaceChildren(null) (le faux document l'ignore) : on fait comme lui, ici seulement.
  const proto = FauxEl.prototype as unknown as { replaceChildren: (...k: unknown[]) => void }, orig = proto.replaceChildren;
  proto.replaceChildren = function (this: unknown, ...k: unknown[]) { orig.apply(this, k.map((x) => (x === null || x === undefined ? String(x) : x))); };
  try {
    const { host } = await ouvrir();
    assert.doesNotMatch(host.querySelector('.pf-liste')!.textContent, /null|undefined/);
  } finally { proto.replaceChildren = orig; }
});

test('page : limiter part en un geste, sans validation — baisser le rôle ou l\'autonomie, décocher, délier, couper un appareil, couper le compte ; la carte se relit du serveur', async () => {
  const { host, s } = await ouvrir();
  const avant = relectures(s);
  const auto = attr(host, 'data-droit', 'autonomie')!; auto.value = 'prudent';
  const role = attr(host, 'data-droit', 'role')!; role.value = 'guest'; role.dispatch('change', { target: role }); await flush();
  assert.equal(s.envois.length, 0, 'choisir dans le sélecteur ne fait rien partir (au clavier, chaque flèche le change)');
  attr(host, 'data-appliquer', 'role')!.click(); await flush();
  assert.deepEqual(s.envois.at(-1), { url: '/api/action', corps: { kind: 'user_save', id: 'u_nour', name: PIEGE, role: 'guest', autonomy: 'prudent' } });
  assert.equal(relectures(s), avant + 1, 'la carte est relue du serveur');
  const pegase = attr(host, 'data-appli', 'pegase')!; pegase.dispatch('change', { target: pegase }); await flush();
  assert.deepEqual(s.envois.at(-1), { url: '/api/valhalla/act', corps: { module: 'var', action: 'acces_cases', input: { qui: '@nour', pegase: false } } });
  bouton(host, 'Délier')!.click(); await flush();
  assert.deepEqual(s.envois.at(-1), { url: '/api/action', corps: { kind: 'user_unlink', channel: 'telegram', peer: '2001' } });
  tous(host.querySelector('.pf-apx')!).find((b) => b.localName === 'button')!.click(); await flush();
  assert.deepEqual(s.envois.at(-1), { url: '/api/valhalla/act', corps: { module: 'var', action: 'couper_appareil', input: { id: 's-1' } } });
  bouton(host, 'Couper le compte')!.click(); await flush();
  assert.deepEqual(s.envois.at(-1), { url: '/api/valhalla/act', corps: { module: 'var', action: 'modifier', input: { login: 'nour', actif: 'coupé' } } });
  assert.equal(s.questions.length + s.coupures.length, 0, 'aucune validation de plus pour limiter');
  assert.ok(s.envois.every((e) => !('confirm' in e.corps)), 'jamais de confirmation envoyée d\'avance');
  assert.equal(relectures(s), avant + 5);
});

test('page : donner ouvre la validation du serveur (son texte avant → après, tel quel) ; annuler ne change rien et remet la case ; confirmer renvoie la même demande avec la confirmation', async () => {
  const { host, s } = await ouvrir();
  const TEXTE = 'Confirmer : donner à nour l\'accès à <b>Bragi</b> — applis : Pégase → Pégase, Bragi ?';
  s.repondre({ ok: false, confirm: TEXTE, error: 'x' }); s.dire(false);
  let bragi = attr(host, 'data-appli', 'bragi')!;
  (bragi as unknown as { checked: boolean }).checked = true; bragi.dispatch('change', { target: bragi }); await flush();
  assert.deepEqual(s.questions, [TEXTE], 'le texte du serveur, jamais recomposé par la page');
  assert.equal(s.envois.length, 1, 'refusée : rien d\'autre n\'est envoyé');
  assert.deepEqual(s.envois[0].corps, { module: 'var', action: 'acces_cases', input: { qui: '@nour', bragi: true } });
  bragi = attr(host, 'data-appli', 'bragi')!;
  assert.equal((bragi as unknown as { checked: boolean }).checked, false, 'la case revient à son état d\'avant');
  assert.match(host.querySelector('.pf-dst')!.textContent, /Rien n'a changé/);
  // Confirmé : la même demande, avec la confirmation, et rien de plus.
  s.repondre({ ok: false, confirm: TEXTE }, { ok: true, text: 'fait' }); s.dire(true);
  bragi.dispatch('change', { target: bragi }); await flush();
  assert.deepEqual(s.envois.slice(1).map((e) => e.corps), [{ module: 'var', action: 'acces_cases', input: { qui: '@nour', bragi: true } }, { module: 'var', action: 'acces_cases', input: { qui: '@nour', bragi: true }, confirm: true }]);
  // Monter l'autonomie, lier une identité, réactiver : la même validation, venue du serveur.
  s.repondre({ ok: false, confirm: 'Confirmer : Nour — autonomie : prudent → equilibre ?' }); s.dire(false);
  const auto = attr(host, 'data-droit', 'autonomie')!; auto.value = 'equilibre'; auto.dispatch('change', { target: auto }); await flush();
  attr(host, 'data-appliquer', 'autonomie')!.click(); await flush();
  assert.equal(s.questions.at(-1), 'Confirmer : Nour — autonomie : prudent → equilibre ?');
  assert.deepEqual(s.envois.at(-1)!.corps, { kind: 'user_save', id: 'u_nour', name: PIEGE, role: 'member', autonomy: 'equilibre' });
  assert.equal(attr(host, 'data-droit', 'autonomie')!.value, 'prudent', 'le sélecteur revient à son état d\'avant');
  const champ = tous(host).find((x) => x.localName === 'input' && x.attributes['data-droit'] === 'lier')!; champ.value = 'signal:3003';
  s.repondre({ ok: false, confirm: 'Confirmer : signal:3003 devient Nour — rôle : guest → member ?' });
  bouton(host, 'Lier…')!.click(); await flush();
  assert.deepEqual(s.envois.at(-1), { url: '/api/action', corps: { kind: 'user_link', id: 'u_nour', channel: 'signal', peer: '3003' } });
  assert.equal(s.questions.at(-1), 'Confirmer : signal:3003 devient Nour — rôle : guest → member ?');
  assert.ok(s.envois.every((e, i) => !('confirm' in e.corps) || (i > 0 && s.envois[i - 1].corps.confirm === undefined)), 'la confirmation ne part qu\'après le geste du propriétaire');
});

test('page : pendant la validation, une touche répétée (Entrée ou Espace maintenue) est arrêtée — elle ne confirme pas à la place du propriétaire ; une nouvelle frappe, si ; rien ne reste écouté après', async () => {
  const { nav, P } = charger(), s = scene(), host = nav.make('div');
  // Les écoutes que la page pose sur la fenêtre (en capture), et une frappe envoyée à celles qui sont là.
  const ecoutes: Array<{ type: string; fn: (e: unknown) => void; capture: boolean }> = [];
  const w = nav.window as Record<string, unknown>;
  w.addEventListener = (type: string, fn: (e: unknown) => void, o?: unknown) => { ecoutes.push({ type, fn, capture: o === true || Boolean(o && (o as { capture?: boolean }).capture) }); };
  w.removeEventListener = (type: string, fn: (e: unknown) => void) => { const i = ecoutes.findIndex((x) => x.type === type && x.fn === fn); if (i >= 0) ecoutes.splice(i, 1); };
  const frappe = (key: string, repeat: boolean) => {
    const e = { type: 'keydown', key, repeat, arrete: false, preventDefault() { this.arrete = true; }, stopPropagation() {}, stopImmediatePropagation() {} };
    for (const x of ecoutes.filter((y) => y.type === 'keydown' && y.capture)) x.fn(e);
    return e.arrete;
  };
  const vu: Array<Record<string, boolean>> = [];
  const valider = async (txt: string) => { vu.push({ entreeTenue: frappe('Enter', true), espaceTenu: frappe(' ', true), nouvelleEntree: frappe('Enter', false), echapTenu: frappe('Escape', true) }); return s.valider(txt); };
  const r = await P.rendre(host, { api: s.api, poster: s.poster, valider, confirmerCoupure: s.confirmerCoupure });
  await r!.choisir('u_nour'); await flush();
  s.repondre({ ok: false, confirm: 'Confirmer : signal:9999 devient Nour — rôle : guest → member ?' }); s.dire(false);
  const champ = tous(host).find((x) => x.localName === 'input' && x.attributes['data-droit'] === 'lier')!; champ.value = 'signal:9999';
  bouton(host, 'Lier…')!.click(); await flush();
  assert.equal(vu.length, 1, 'la validation s\'est ouverte');
  assert.deepEqual(vu[0], { entreeTenue: true, espaceTenu: true, nouvelleEntree: false, echapTenu: false }, 'Entrée ou Espace tenue arrêtée ; une nouvelle frappe et Échap passent');
  assert.equal(ecoutes.length, 0, 'l\'écoute est retirée une fois la validation fermée');
  assert.equal(s.envois.length, 1, 'rien n\'est parti avec la confirmation');
});

test('page : au clavier, parcourir le rôle ou l\'autonomie ne change rien ; « Appliquer » envoie, et seulement si le choix a changé', async () => {
  const { host, s } = await ouvrir();
  const role = attr(host, 'data-droit', 'role')!, appliquer = attr(host, 'data-appliquer', 'role')!;
  assert.equal(appliquer.localName, 'button'); assert.equal(appliquer.attributes.disabled, '', 'rien à appliquer tant que le choix n\'a pas changé');
  role.value = 'guest'; role.dispatch('change', { target: role }); role.value = 'owner'; role.dispatch('change', { target: role }); role.value = 'member'; role.dispatch('change', { target: role }); await flush();
  assert.equal(s.envois.length, 0, 'flèche Bas, flèche Bas, flèche Haut : rien ne part');
  assert.equal(appliquer.attributes.disabled, '', 'revenu au rôle d\'avant : rien à appliquer');
  appliquer.click(); await flush();
  assert.equal(s.envois.length, 0, 'même cliqué, un bouton sans changement n\'envoie rien');
  role.value = 'guest'; role.dispatch('change', { target: role });
  assert.equal(appliquer.attributes.disabled, undefined);
  assert.match(appliquer.attributes['aria-label'], /Rôle/);
});

test('page : une appli ouverte à « * » dit qu\'elle touche toute personne connectée, pas « tout le groupe »', async () => {
  const { host } = await ouvrir();
  const li = tous(host).find((x) => x.localName === 'label' && x.textContent.includes('Hermès'))!;
  assert.match(li.textContent, /toute personne connectée/);
  assert.doesNotMatch(li.textContent, /tout le groupe/);
  const venus = tous(host).find((x) => x.localName === 'label' && x.textContent.includes('Vénus'))!;
  assert.match(venus.textContent, /tout le groupe/);
});

test('page : une identité piégée (« ;role=owner » dans l\'identifiant) reste du texte dans l\'historique, sans se faire passer pour un rôle', () => {
  const { P } = charger();
  const texteDroit = P.logique.texteDroit as (d: Record<string, string>) => string;
  const lie = texteDroit({ quoi: 'identite', avant: 'signal:1;role=owner;user=;role=guest;autonomy=prudent', apres: 'signal:1;role=owner;user=u_nour;role=member;autonomy=prudent' });
  assert.ok(lie.includes('signal:1;role=owner'), 'l\'identifiant tel quel');
  assert.doesNotMatch(lie, /Propriétaire/);
  assert.match(lie, /Invité · Prudent → signal:1;role=owner · Membre · Prudent/);
  const delie = texteDroit({ quoi: 'identite', avant: 'telegram:2001;user=u_nour;role=member;autonomy=equilibre', apres: 'telegram:2001' });
  assert.equal(delie, 'Identité : telegram:2001 · Membre · Équilibré → telegram:2001');
  assert.equal(texteDroit({ quoi: 'identite', avant: 'telegram:2001;role=owner', apres: 'x' }), 'Identité : telegram:2001;role=owner → x', 'sans la fin écrite par Odin, rien n\'est lu comme un rôle');
});

test('page : la confirmation d\'effacement dit que les changements de ses droits restent', () => {
  const { P } = charger();
  const texteConfirmation = P.logique.texteConfirmation as (n: string, c: Record<string, unknown>, b: Record<string, unknown>) => string;
  const bilan = { retire: { historique: 3 }, reste: { historique: 0, messages: 0, missions: 0, aiguillage: 0, souvenirs: 0, note: false, lienPersona: false, droits: 2 } };
  const q = texteConfirmation('Nour', { jusqua: 1 }, bilan);
  const reste = q.slice(q.indexOf('Reste ailleurs'));
  assert.match(reste, /2 changements de ses droits/);
  assert.doesNotMatch(texteConfirmation('Nour', { jusqua: 1 }, { ...bilan, reste: { ...bilan.reste, droits: 0 } }), /de ses droits/);
});

test('page : un refus du serveur s\'affiche avec sa raison, en texte ; la case revient', async () => {
  const { host, s } = await ouvrir();
  s.repondre({ ok: false, text: `Persona · Accès : ${PIEGE}` });
  const pegase = attr(host, 'data-appli', 'pegase')!; pegase.dispatch('change', { target: pegase }); await flush();
  const st = host.querySelector('.pf-dst')!;
  assert.match(st.textContent, /Refusé : Persona · Accès : <img/);
  assert.equal(tous(host).filter((x) => x.localName === 'img').length, 0);
  assert.equal((attr(host, 'data-appli', 'pegase') as unknown as { checked: boolean }).checked, true);
});

test('page : une réponse en erreur (code HTTP d\'échec, sans « ok ») n\'est jamais dite « fait » ; la raison s\'affiche et la case revient', async () => {
  const { host, s } = await ouvrir();
  s.repondre({ status: 401, code: 'connexion', error: 'connexion requise' });
  const pegase = attr(host, 'data-appli', 'pegase')!; pegase.dispatch('change', { target: pegase }); await flush();
  const st = host.querySelector('.pf-dst')!;
  assert.doesNotMatch(st.textContent, /C'est fait/);
  assert.match(st.textContent, /Refusé : connexion requise/);
  assert.equal((attr(host, 'data-appli', 'pegase') as unknown as { checked: boolean }).checked, true);
});

test('page : « Couper tout » dit exactement ce qui sera coupé et ce qui reste ; refusé, rien ne part ; accepté, les actions de Persona qui limitent, sans confirmation d\'avance', async () => {
  const { host, s } = await ouvrir();
  bouton(host, 'Couper tout…')!.click(); await flush();
  assert.equal(s.coupures.length, 1); assert.equal(s.envois.length, 0, 'refusé : rien n\'est envoyé');
  const q = s.coupures[0];
  assert.match(q, /Pégase/); assert.match(q, /son compte Persona/); assert.match(q, /famille/);
  assert.match(q, /Rien n'est effacé de son historique/); assert.match(q, /mémoire d'Odin/);
  assert.ok(!q.includes('Vénus ') || q.indexOf('Vénus') > q.indexOf('Reste'), 'Vénus (par le groupe) n\'est pas dans ce qui est coupé');
  s.dire(true);
  bouton(host, 'Couper tout…')!.click(); await flush();
  assert.deepEqual(s.envois, [
    { url: '/api/valhalla/act', corps: { module: 'var', action: 'acces_cases', input: { qui: '@nour', pegase: false } } },
    { url: '/api/valhalla/act', corps: { module: 'var', action: 'modifier', input: { login: 'nour', actif: 'coupé' } } },
  ]);
  assert.equal(s.questions.length, 0);
});

test('page : l\'historique montre la ligne du journal des droits, traduite depuis ses codes', async () => {
  const { host } = await ouvrir();
  const txt = host.querySelectorAll('.pf-l').map((x) => x.textContent).join('\n');
  assert.match(txt, /Droit changé/); assert.match(txt, /Autonomie : Prudent → Équilibré/); assert.match(txt, /donné/);
  assert.match(txt, /Mémoire d'Odin/); assert.match(txt, /Persona/); assert.match(txt, /limité/);
  assert.ok(txt.includes(`Accès à ${PIEGE}`), 'l\'appli par son nom, en texte');
  assert.equal(txt.split(`pour ${PIEGE}`).length - 1, 2, '« @nour » (Persona) est dit par le nom de sa carte, comme son id dans la mémoire d\'Odin');
  assert.ok(!/acces:|equilibre|\[droit/.test(txt), 'aucun code brut');
});

test('page : un membre voit sa carte et ses droits, sans aucun bouton ni case pour les changer ; les noms piégés restent du texte', async () => {
  const { host } = await ouvrir({ membre: true });
  const bloc = host.querySelector('.pf-droits')!;
  assert.ok(bloc); assert.match(bloc.textContent, /Pégase/); assert.match(bloc.textContent, /Dans Persona/);
  assert.equal(tous(bloc).filter((x) => ['button', 'select', 'input'].includes(x.localName)).length, 0, 'lecture seule');
  assert.deepEqual(tous(host).filter((x) => x.localName === 'button' && x.className !== 'pf-p' && x.textContent !== 'En charger d\'autres').map((b) => b.textContent), ['Signaler une erreur'], 'hors de la liste et de la lecture de l\'historique, un seul bouton : signaler');
  assert.equal(tous(host).filter((x) => x.localName === 'select' || (x.localName === 'input' && x.attributes.type === 'checkbox')).length, 0);
  assert.equal(tous(host).filter((x) => x.localName === 'img' || x.localName === 'script').length, 0);
  assert.ok(bloc.textContent.includes(PIEGE), 'le nom de l\'appareil, tel quel');
});

test('page : le dictionnaire a les nouveaux codes, les cibles font 44 px, chaque contrôle est un vrai élément du clavier', () => {
  const { P } = charger();
  for (const k of ['sorte.droit', 'sens.donne', 'sens.limite', 'registre.odin', 'registre.persona']) assert.ok(P.logique.clesAttendues().includes(k), k);
  for (const k of P.logique.clesAttendues()) assert.ok(Object.hasOwn(P.logique.T, k), k);
  assert.match(SOURCE, /\.pf-case\{[^}]*min-height:44px/); assert.match(SOURCE, /\.pf-sel\{[^}]*min-height:44px/);
  assert.ok(!/innerHTML/.test(SOURCE));
});
