// « La donnée d'un widget » (maquette validée « Accueil », lot 23) : une seule fonction, qui rend toujours l'un des cinq
// états (ok, vide, source_absente, refuse, ancien) et applique d'abord le public de la sorte (constat M12) : le
// propriétaire, un membre qui a le droit sur l'appli, une tablette « maison » (familles infos et maison, sans action
// grave). La vie privée reste fermée à un membre et à une tablette tant qu'il ne l'a pas ouverte (sa réponse b à la
// question 15). Les cinq sortes de l'accueil ne sont rendues qu'à lui, sur l'accueil (constat G4). Sur un Odin neuf,
// chaque sorte rend `vide` ou `source_absente`, jamais un chiffre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { defaultLayout, resetGladsheim, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import { APPLIS_VIE_PRIVEE, ETATS, SORTES, cleOuverture, donneeWidget, type EtatWidget, type Lecteur, type SourceWidget } from '../src/valhalla/widgets/index.ts';
import { sourceOdin } from '../src/valhalla/widgets/source.ts';
import type { View } from '../src/valhalla/types.ts';

const W = (kind: string, o: Partial<Widget> = {}): Widget => ({ id: `w-${kind}-${o.module ?? ''}`, kind: kind as Widget['kind'], w: 1, c: 4, r: 2, ...o });
const LUI: Lecteur = { qui: 'proprietaire', ecran: 'accueil' };
const TABLETTE: Lecteur = { qui: 'maison', ecran: 'maison' };
const membre = (droits: string[], ouverts: string[] = []): Lecteur => ({ qui: 'membre', ecran: 'maison', peutLire: (a) => droits.includes(a), ouverts: new Set(ouverts) });

/** Une source d'essai : des applis, leurs pages, leurs actions, la météo ; elle compte ce qui est lu. */
function fausse(o: { meteo?: 'ok' | 'ancien' | 'rien'; lieu?: boolean; vues?: Record<string, View> } = {}) {
  const lus: string[] = [];
  const applis: Record<string, { name: string; family: string }> = { midgard: { name: 'Midgard', family: 'Maison' }, himinbjorg: { name: 'Cyclope', family: 'Maison' }, vidarr: { name: 'Sphinx', family: 'Accès' }, ullr: { name: 'Asclépios', family: 'Sécurité' }, vordr: { name: 'Pulsar', family: 'Machines' }, baldr: { name: 'Lumière', family: 'Accès' }, gladsheim: { name: 'Hestia', family: 'Maison' } };
  const vues: Record<string, View> = { midgard: { kpis: [{ label: 'Allumés', value: '3' }], sections: [] }, himinbjorg: { kpis: [{ label: 'Caméras', value: '2' }], sections: [] }, ullr: { kpis: [{ label: 'Incidents', value: '1' }], sections: [{ kind: 'table', title: 'Détections', columns: ['a'], rows: [{ cells: ['x'] }] } as never] }, vordr: { kpis: [], sections: [{ kind: 'table', title: 'Sondes', columns: [], rows: [{ cells: ['Mon site', '', 'https://exemple.test', 'en ligne', '100 %', '99 %', '120 ms'], tone: 'bon' }] } as never] }, ...o.vues };
  const actions: Record<string, { label: string; grave: boolean; proprietaireSeul: boolean }> = { 'baldr.allumer': { label: 'Allumer', grave: false, proprietaireSeul: false }, 'midgard.serrure': { label: 'Ouvrir', grave: true, proprietaireSeul: false }, 'baldr.regler': { label: 'Régler', grave: false, proprietaireSeul: true } };
  const src: SourceWidget = {
    appli: (id) => (applis[id] ? { id, ...applis[id] } : undefined),
    vue: async (id) => { lus.push(id); return vues[id] ?? null; },
    action: (a, act) => actions[`${a}.${act}`],
    meteo: async () => { lus.push('meteo'); return o.meteo === 'rien' ? undefined : { donnee: { temp: 29 }, at: 1000, ancien: o.meteo === 'ancien', motif: o.meteo === 'ancien' ? 'Open-Meteo ne répond pas' : '' }; },
    lieu: () => ({ choisi: o.lieu !== false, nom: 'Lieu A', fuseau: 'Europe/Paris', heure12: false }),
    maintenant: () => 2000,
  };
  return { src, lus };
}

test('les cinq états, portés par un code : ok, vide, source_absente, refuse, ancien', async () => {
  assert.deepEqual([...ETATS], ['ok', 'vide', 'source_absente', 'refuse', 'ancien']);
  const { src } = fausse();
  const ok = await donneeWidget(W('chiffres', { module: 'midgard' }), LUI, src);
  assert.deepEqual(ok, { etat: 'ok', at: 2000, donnee: { appli: 'midgard', kpis: [{ label: 'Allumés', value: '3' }] } });
  assert.deepEqual(await donneeWidget(W('heure'), LUI, fausse({ lieu: false }).src), { etat: 'vide', raison: 'lieu_non_choisi' });
  assert.deepEqual(await donneeWidget(W('chiffres', { module: 'inventee' }), LUI, src), { etat: 'source_absente', raison: 'appli_absente' });
  assert.deepEqual(await donneeWidget(W('chiffres', { module: 'vidarr' }), membre([]), src), { etat: 'refuse', raison: 'appli_fermee', appli: 'vidarr' });
  assert.deepEqual(await donneeWidget(W('meteo'), LUI, fausse({ meteo: 'ancien' }).src), { etat: 'ancien', at: 1000, donnee: { temp: 29 }, motif: 'Open-Meteo ne répond pas' });
  assert.deepEqual(await donneeWidget(W('meteo'), LUI, fausse({ meteo: 'rien' }).src), { etat: 'vide', raison: 'meteo_pas_lue' });
  // Une lecture qui plante : un état, jamais une exception.
  const casse = fausse(); casse.src.vue = async () => { throw new Error('boum'); };
  assert.deepEqual(await donneeWidget(W('chiffres', { module: 'midgard' }), LUI, casse.src), { etat: 'source_absente', raison: 'lecture_echouee' });
  // Une donnée sans phrase : des codes et des valeurs, jamais un texte à montrer tel quel.
  for (const r of [ok]) assert.ok(!('texte' in r) && !('text' in r));
});

test('le propriétaire voit tout ; l\'adresse d\'un site n\'est donnée qu\'à lui', async () => {
  const { src } = fausse();
  const site = W('site', { module: 'vordr', label: 'Mon site' });
  const a = await donneeWidget(site, LUI, src);
  assert.equal(a.etat, 'ok'); assert.equal((a as { donnee: Record<string, unknown> }).donnee.cible, 'https://exemple.test');
  const t = await donneeWidget(site, TABLETTE, src);
  assert.equal(t.etat, 'ok'); assert.equal('cible' in (t as { donnee: Record<string, unknown> }).donnee, false, 'pas d\'adresse pour une tablette');
  for (const k of ['chiffres', 'section']) assert.notEqual((await donneeWidget(W(k, { module: 'himinbjorg', section: 'x' }), LUI, src)).etat, 'refuse', `${k} : vie privée ouverte au propriétaire`);
});

test('une tablette « maison » : familles infos et maison seulement, sans action grave, sans vie privée sauf ouverte', async () => {
  const { src, lus } = fausse();
  const etat = async (w: Widget, l: Lecteur = TABLETTE) => (await donneeWidget(w, l, src)) as EtatWidget & { raison?: string };
  assert.equal((await etat(W('heure'))).etat, 'ok');
  assert.equal((await etat(W('meteo'))).etat, 'ok');
  assert.equal((await etat(W('chiffres', { module: 'midgard' }))).etat, 'ok', 'les chiffres d\'une appli de la famille Maison');
  assert.equal((await etat(W('bouton', { module: 'baldr', action: 'allumer' }))).etat, 'ok', 'un bouton sans action grave');
  lus.length = 0;
  assert.deepEqual(await etat(W('chiffres', { module: 'ullr' })), { etat: 'refuse', raison: 'pas_pour_une_tablette' }, 'une appli hors de la famille Maison');
  assert.deepEqual(await etat(W('section', { module: 'ullr', section: 'Détections' })), { etat: 'refuse', raison: 'pas_pour_une_tablette' });
  assert.deepEqual(lus, [], 'rien n\'est lu pour qui n\'a pas le droit');
  assert.deepEqual(await etat(W('bouton', { module: 'midgard', action: 'serrure' })), { etat: 'refuse', raison: 'action_grave', appli: 'midgard' });
  assert.deepEqual(await etat(W('bouton', { module: 'baldr', action: 'regler' })), { etat: 'refuse', raison: 'proprietaire_seul', appli: 'baldr' });
  // Cyclope (les caméras) est de la famille Maison, mais de la vie privée : fermé tant qu'il ne l'a pas ouvert à cette tablette.
  const cam = W('chiffres', { module: 'himinbjorg' });
  assert.deepEqual(await etat(cam), { etat: 'refuse', raison: 'vie_privee', appli: 'himinbjorg' });
  assert.equal((await etat(cam, { ...TABLETTE, ouverts: new Set([cleOuverture(cam, 'himinbjorg')]) })).etat, 'ok', 'ouvert par lui, widget par widget');
  assert.equal((await etat(cam, { ...TABLETTE, ouverts: new Set(['un-autre']) })).etat, 'refuse', 'ouvrir un autre widget n\'ouvre pas celui-ci');
});

test('un membre : seulement les applis auxquelles il a droit ; la vie privée fermée tant qu\'il ne l\'a pas ouverte', async () => {
  const { src } = fausse();
  const ul = W('chiffres', { module: 'ullr' });
  assert.deepEqual(await donneeWidget(ul, membre([]), src), { etat: 'refuse', raison: 'appli_fermee', appli: 'ullr' });
  assert.equal((await donneeWidget(ul, membre(['ullr']), src)).etat, 'ok');
  assert.deepEqual(await donneeWidget(W('heure'), membre([]), src), { etat: 'refuse', raison: 'appli_fermee', appli: 'gladsheim' }, 'l\'heure se lit dans Hestia');
  assert.equal((await donneeWidget(W('heure'), membre(['gladsheim']), src)).etat, 'ok');
  // Sphinx (les appareils du réseau) : vie privée.
  const sp = W('chiffres', { module: 'vidarr' });
  assert.deepEqual(await donneeWidget(sp, membre(['vidarr']), src), { etat: 'refuse', raison: 'vie_privee', appli: 'vidarr' });
  assert.notEqual((await donneeWidget(sp, membre(['vidarr'], [cleOuverture(sp, 'vidarr')]), src)).etat, 'refuse');
  // Une action grave ou « propriétaire seul » n'est jamais servie à un membre, même avec le droit sur l'appli.
  assert.deepEqual(await donneeWidget(W('bouton', { module: 'midgard', action: 'serrure' }), membre(['midgard']), src), { etat: 'refuse', raison: 'action_grave', appli: 'midgard' });
  assert.deepEqual(await donneeWidget(W('bouton', { module: 'baldr', action: 'regler' }), membre(['baldr']), src), { etat: 'refuse', raison: 'proprietaire_seul', appli: 'baldr' });
  assert.equal((await donneeWidget(W('bouton', { module: 'baldr', action: 'allumer' }), membre(['baldr']), src)).etat, 'ok');
});

test('les cinq sortes de l\'accueil : rendues à lui seul, sur l\'accueil seul (jamais à /maison, même pour lui)', async () => {
  const { src, lus } = fausse();
  for (const k of ['a_faire', 'odin_a_fait', 'tu_veux', 'comportement', 'chiffres_cles']) {
    // Lots 26 et 27 : les cinq sont posables (la cinquième : le widget des cinq chiffres) ; leur donnée est dans l'état de la page du propriétaire, pas relue ici.
    const r = await donneeWidget(W(k), LUI, src);
    assert.equal(r.etat, 'ok', k); assert.deepEqual((r as { donnee: unknown }).donnee, { source: 'etat' }, `${k} : la donnée est dans l'état de la page`);
    for (const l of [TABLETTE, membre(['gladsheim', 'midgard'], [W(k).id]), { qui: 'proprietaire', ecran: 'maison' } as Lecteur, { qui: 'maison', ecran: 'accueil' } as Lecteur]) {
      assert.deepEqual(await donneeWidget(W(k), l, src), { etat: 'refuse', raison: 'accueil_du_proprietaire' }, `${k} refusé à ${l.qui} sur ${l.ecran}`);
    }
  }
  assert.deepEqual(lus, []);
  assert.deepEqual(await donneeWidget(W('inventee'), LUI, src), { etat: 'refuse', raison: 'sorte_inconnue' });
});

// Avec le widget des cinq chiffres, « chiffres_cles » (lot 27, deuxième part), et les quatre tuiles d'état (troisième part).
const DU_JOUR: string[] = ['a_faire', 'odin_a_fait', 'tu_veux', 'comportement', 'chiffres_cles', 'surveillance', 'sauvegarde', 'resume_matin', 'application'];
test('sur un Odin neuf, chaque sorte rend « vide » ou « source_absente », jamais un chiffre', async () => {
  const home = mkdtempSync(join(tmpdir(), 'widgets-etats-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('réseau coupé par le test'); }) as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  setValhalla(v); resetGladsheim();
  try {
    const src = sourceOdin(v), ids = v.modules().map((m) => m.id);
    const neuf = async (w: Widget) => {
      const r = await donneeWidget(w, LUI, src);
      // Lot 26 : les blocs du jour ne sont pas relus par le serveur (leur donnée est dans l'état de la page) ; rien d'autre qu'une provenance, aucun chiffre.
      if (DU_JOUR.includes(w.kind)) { assert.equal(r.etat, 'ok', w.kind); assert.deepEqual((r as { donnee: unknown }).donnee, { source: 'etat' }); return r; }
      assert.ok(r.etat === 'vide' || r.etat === 'source_absente', `${w.kind}${w.module ? ` (${w.module})` : ''} : ${JSON.stringify(r).slice(0, 200)}`);
      assert.equal('donnee' in r, false); assert.doesNotMatch(JSON.stringify(r), /[1-9]/, 'aucun chiffre');
      return r;
    };
    // Une de chaque sorte, réglée au plus simple.
    const une: Record<string, Widget> = {
      heure: W('heure'), meteo: W('meteo'), site: W('site', { module: 'vordr', label: 'Mon site' }), chiffres: W('chiffres', { module: 'midgard' }),
      section: W('section', { module: 'vordr', section: 'Sondes' }), bouton: W('bouton', { module: 'baldr' }),
      a_faire: W('a_faire'), odin_a_fait: W('odin_a_fait'), tu_veux: W('tu_veux'), comportement: W('comportement'),
      chiffres_cles: W('chiffres_cles'), // le widget des cinq chiffres (lot 27, deuxième part)
      // les quatre tuiles d'état (lot 27, troisième part)
      surveillance: W('surveillance'), sauvegarde: W('sauvegarde'), resume_matin: W('resume_matin'), application: W('application'),
      // les trois petits chiffres « Infos » de la maquette : sur un Odin neuf, ni lieu ni alerte, donc aucun chiffre
      heure_petite: W('heure_petite'), meteo_petite: W('meteo_petite'), alertes: W('alertes'),
      // la famille « veille » : la liste des alertes, les sites d'Arachné (grand et petit) ; neuf : aucune alerte, aucun site
      alertes_liste: W('alertes_liste'), sites: W('sites'), sites_petit: W('sites_petit'),
      // la famille « listes » : l'agenda de Chronos et les recherches de Pythie ; neuf : aucun rendez-vous, aucune recherche
      agenda: W('agenda'), recherches: W('recherches'),
      // sa seconde part : les sauvegardes de Phénix (neuf : aucun plan) et les pubs bloquées (neuf : Sphinx arrêté)
      sauvegardes: W('sauvegardes'), pubs_bloquees: W('pubs_bloquees'),
      // le widget de n'importe quelle appli, réglé au plus simple : aucune appli choisie (comme « bouton » sans action) ;
      // avec une appli, il montre ce que le catalogue en dit (sa phrase), et aucun chiffre que l'appli n'a pas mesuré
      // (test/widgets-generique.test.ts)
      appli: W('appli'),
      // ses raccourcis : sur un Odin neuf, aucune appli épinglée (les vues ne sont pas des applis), donc « vide »
      raccourcis: W('raccourcis'),
      // la famille « automatisations » : Talos n'est pas démarré dans cet essai, donc rien n'est lu (« source_absente »)
      automatisations: W('automatisations'), taches_planifiees: W('taches_planifiees'),
      // « Stockage » : Pyramide ne lit pas les disques sous Windows (« source_absente ») ; sur Linux ou Mac, elle lit la
      // vraie machine d'Odin (lsblk, df), dont les chiffres sont vrais dès la première lecture
      stockage: W('stockage'),
      // la famille « sante » : sur la machine de l'essai, Hygie n'a rien rangé et Tirésias n'a rien lu (ou ne lit pas sous
      // Windows) : « vide » ou « source_absente », jamais un chiffre
      sante_machine: W('sante_machine'), sante_disques: W('sante_disques'),
    };
    assert.deepEqual(Object.keys(une).sort(), SORTES.map((x) => x.id).sort(), 'toutes les sortes déclarées');
    for (const w of Object.values(une)) await neuf(w);
    // La fenêtre de départ d'un Odin neuf, sauf Hygie, qui lit la vraie machine (ses chiffres sont vrais dès la première seconde).
    for (const p of defaultLayout(ids).pages) for (const w of p.widgets) if (w.module !== 'eir') await neuf(w);
  } finally { setValhalla(undefined); v.stop(); rmSync(home, { recursive: true, force: true }); }
});

// ---------------- Relecture du lot 23 : ce qui passait et ne doit plus passer ----------------

test('relecture : qui regarde doit être l\'un des trois publics ; tout autre lecteur est fermé', async () => {
  const { src, lus } = fausse();
  for (const l of [{ qui: 'invite', ecran: 'maison' }, { qui: 'complet', ecran: 'maison' }, {}, { qui: 'membre', ecran: 'ailleurs', peutLire: () => true }]) {
    assert.deepEqual(await donneeWidget(W('chiffres', { module: 'midgard' }), l as unknown as Lecteur, src), { etat: 'refuse', raison: 'lecteur_inconnu' }, JSON.stringify(l));
  }
  assert.deepEqual(lus, [], 'rien de lu');
});

test('relecture : une source qui plante pendant la vérification du droit rend « refuse », jamais une exception', async () => {
  const { src } = fausse(); src.appli = () => { throw new Error('boum'); };
  assert.deepEqual(await donneeWidget(W('chiffres', { module: 'midgard' }), TABLETTE, src), { etat: 'refuse', raison: 'droit_non_verifie' });
  assert.deepEqual(await donneeWidget(W('heure'), LUI, src), { etat: 'source_absente', raison: 'lecture_echouee' });
});

test('relecture : ouvrir un widget n\'ouvre que l\'appli qu\'il lisait ; repointé sur une autre, il est refermé', async () => {
  const { src } = fausse();
  const w = W('chiffres', { id: 'cafe0001', module: 'midgard' });
  const l = membre(['midgard', 'himinbjorg'], [cleOuverture(w, 'midgard'), w.id]);
  assert.equal((await donneeWidget(w, l, src)).etat, 'ok');
  assert.deepEqual(await donneeWidget({ ...w, module: 'himinbjorg' }, l, src), { etat: 'refuse', raison: 'vie_privee', appli: 'himinbjorg' }, 'même identifiant, autre appli : fermé');
});

test('relecture : un site ne lit Pulsar que si son appli est Pulsar (le droit est vérifié sur cette appli-là)', async () => {
  const { src, lus } = fausse();
  const faux = W('site', { module: 'midgard', label: 'Mon site' });
  assert.deepEqual(await donneeWidget(faux, membre(['midgard']), src), { etat: 'source_absente', raison: 'appli_absente' });
  assert.deepEqual(lus, [], 'Pulsar n\'est pas lu');
});

test('relecture : la météo d\'un lieu jamais choisi n\'est ni lue ni affirmée ; Hestia désactivée, ni l\'heure ni la météo', async () => {
  const sansLieu = fausse({ lieu: false });
  assert.deepEqual(await donneeWidget(W('meteo'), LUI, sansLieu.src), { etat: 'vide', raison: 'lieu_non_choisi' });
  assert.deepEqual(sansLieu.lus, [], 'aucune recherche de météo pour un lieu supposé');
  const sansHestia = fausse(); const appli = sansHestia.src.appli; sansHestia.src.appli = (id) => (id === 'gladsheim' ? undefined : appli(id));
  for (const k of ['heure', 'meteo']) assert.deepEqual(await donneeWidget(W(k), LUI, sansHestia.src), { etat: 'source_absente', raison: 'appli_absente' }, k);
  assert.deepEqual(sansHestia.lus, []);
});

test('relecture : la liste de la vie privée, comparée au vrai catalogue des applis d\'Odin', async () => {
  const home = mkdtempSync(join(tmpdir(), 'widgets-vie-privee-'));
  try {
    const ids = new Set(allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never).map((m) => m.id));
    for (const a of APPLIS_VIE_PRIVEE) assert.ok(ids.has(a), `${a} : une vraie appli d'Odin (pas une faute de frappe)`);
    // Santé et position, finances et secrets, messages et voix, caméras, documents et fichiers, personnes, agenda, ce
    // que l'on regarde, écoute, cherche ou visite : rien de cela n'est ouvert sans lui.
    for (const a of ['gna', 'himinbjorg', 'frigg', 'brisingamen', 'var', 'agora', 'hlin', 'snotra', 'skidbladnir', 'champollion', 'sol', 'pegase', 'volva', 'vidarr', 'freyja', 'aegir', 'bragi', 'rodd', 'heidrun', 'svalinn', 'askr', 'forseti', 'argos', 'mimisbrunnr', 'gjoll']) {
      assert.ok(APPLIS_VIE_PRIVEE.includes(a), `${a} est dans la vie privée`);
    }
    const { src } = fausse();
    assert.deepEqual(await donneeWidget(W('chiffres', { module: 'brisingamen' }), membre(['brisingamen']), { ...src, appli: (id) => ({ id, name: id, family: 'Accès' }) }), { etat: 'refuse', raison: 'vie_privee', appli: 'brisingamen' });
  } finally { rmSync(home, { recursive: true, force: true }); }
});
