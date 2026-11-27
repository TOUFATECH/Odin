// La maison, sa sécurité (maquette validée « Accueil ») : deux sortes de plus dans la famille « maison », rangées dans
// leur propre fichier (src/valhalla/widgets/maison-securite.ts, src/web/pages/widgets-maison-securite.js).
// - « Sécurité » : SES serrures (leur état lu : verrouillée, ouverte, non lu), SES portes qui ouvrent la maison (un
//   garage, un portail : la règle de Midgard) avec l'état que l'appareil rend, et combien de caméras Odin connaît. Ni
//   alarme (rien n'existe dans Odin), ni bouclier fixe, ni « protégé » ; « tout est fermé » seulement si TOUT est lu et
//   fermé ; un état non lu n'est jamais compté fermé ; rien à montrer : « vide ».
// - « Caméra » : la VRAIE image d'une caméra de Cyclope, par la route qui existe (GET /api/maison/camera?nom=), jamais un
//   dessin ; jamais « En direct » (c'est une image prise à la demande) ; redemandée lentement, seulement à l'écran, page
//   visible, hors du mode « Modifier » ; une seule demande par caméra et par période, même pour dix cartes. Posée depuis
//   le tiroir : une seule caméra, prise d'office ; plusieurs, « Régler » s'ouvre sur le choix ; aucune, rien n'est posé.
//   Son choix (« camera:<nom> ») n'est gardé à l'enregistrement que si c'est une de ses caméras (gladsheim.ts).
// - Qui voit : le propriétaire, sur son accueil, seul. Un membre (même avec le droit sur la maison), une tablette
//   « maison », une clé « complet » sur l'écran de la maison, une clé d'accès, sans session : refusés AVANT toute lecture.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { TAILLE_SORTE, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { admiseALaMaison, copiable, donneeWidget, publicDe, sorteDe, type EtatWidget, type Lecteur, type SourceWidget } from '../src/valhalla/widgets/index.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => { try { return readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); } catch { return ''; } };
const RENDU = lire('src/web/pages/widgets-rendu.js'), PAGE_JS = lire('src/web/pages/widgets-maison-securite.js'), GRILLE = lire('src/web/pages/accueil-grille.js');
const SERVEUR_TS = lire('src/valhalla/widgets/maison-securite.ts');
const W = (kind: string, o: Record<string, unknown> = {}): Widget => ({ id: 'd39b0000', kind, w: 2, c: 4, r: 3, ...o }) as unknown as Widget;
const LUI: Lecteur = { qui: 'proprietaire', ecran: 'accueil' }, LUI_MAISON: Lecteur = { qui: 'proprietaire', ecran: 'maison' }, TABLETTE: Lecteur = { qui: 'maison', ecran: 'maison' };
const membre = (ouverts: string[] = []): Lecteur => ({ qui: 'membre', ecran: 'accueil', peutLire: () => true, ouverts: new Set(ouverts) });
const MAINT = 1_800_000_000_000, MIN = 60_000, H = 3_600_000;
type Etat = EtatWidget & { raison?: string; donnee?: Record<string, any>; at?: number; choix?: Array<Record<string, unknown>> };
const etat = async (w: Widget, l: Lecteur, src: SourceWidget) => (await donneeWidget(w, l, src)) as Etat;

type Ap = { ids: string; piece: string; sorte: string; etat: string; unite: string; marche: string; arret: string; enLigne?: boolean; vuA?: number; id?: string; nom?: string };
const ap = (sorte: string, etat: string, o: Partial<Ap> = {}): Ap => ({ ids: `zb_${sorte}`, piece: 'Pièce A', sorte, etat, unite: '', marche: '', arret: '', vuA: MAINT - 2 * MIN, ...o });
/** Une fausse source : les appareils de la maison et les caméras ; chaque lecture est notée dans `lus`. */
function fausse(appareils: Ap[] | undefined, cameras?: string[] | null, o: { sansMidgard?: boolean; sansCyclope?: boolean } = {}) {
  const lus: string[] = [];
  const src = {
    appli: (id: string) => ((id === 'midgard' && !o.sansMidgard) || (id === 'himinbjorg' && !o.sansCyclope) ? { id, name: id === 'midgard' ? 'Appli maison' : 'Appli caméras', family: 'Maison' } : undefined),
    vue: async () => null, action: () => undefined, meteo: async () => undefined,
    lieu: () => ({ choisi: true, nom: 'Lieu A', fuseau: 'UTC', heure12: false }), maintenant: () => MAINT,
    appareilsMaison: async () => { lus.push('appareils'); return appareils ? { unites: 'metrique' as const, appareils } : undefined; },
    ...(cameras === null ? {} : { camerasMaison: () => { lus.push('cameras'); return cameras; } }),
  } as unknown as SourceWidget;
  return { src, lus };
}

// ------------------------------------------------------------------ le serveur, avec une fausse source

test('les deux sortes : famille « maison », propriétaire seul, jamais sur l\'écran de la maison ; « Sécurité » et « Caméra » posables', () => {
  const s = sorteDe('maison_securite')!, c = sorteDe('maison_camera')!;
  assert.ok(s && c);
  for (const x of [s, c]) {
    assert.equal(x.famille, 'maison', x.id); assert.equal(publicDe(x), 'proprietaire', `${x.id} : propriétaire seul`);
    assert.equal(x.jamaisALaMaison, true, `${x.id} : la marque « jamais sur l'écran de la maison »`); assert.equal(admiseALaMaison(x.id), false, x.id);
    assert.equal(copiable(x.id), false, `${x.id} : jamais copiée vers l'écran de la maison`);
  }
  assert.deepEqual(s.applis, ['midgard']); assert.deepEqual(c.applis, ['himinbjorg']);
  // La maquette : « Sécurité » 4 × 3, 3 × 3 au moins ; « Caméra » 4 × 3, 3 × 2 au moins.
  assert.equal(s.posable, true); assert.deepEqual([[...s.taille.mini], s.taille.r], [[3, 3], 3]);
  assert.deepEqual(TAILLE_SORTE['maison_securite' as keyof typeof TAILLE_SORTE], { mini: [3, 3], r: 3 });
  // Suit la pose de « Caméra » (son choix est maintenant gardé à l'enregistrement, et « Régler » sait le faire) : posable.
  assert.equal(c.posable, true, 'la caméra se pose');
  assert.deepEqual([[...c.taille.mini], c.taille.r], [[3, 2], 3]);
  assert.deepEqual(TAILLE_SORTE['maison_camera' as keyof typeof TAILLE_SORTE], { mini: [3, 2], r: 3 });
});

test('sécurité : une serrure ouverte, une fermée, une non lue : trois lignes vraies, et jamais « tout est fermé »', async () => {
  const { src } = fausse([ap('serrure', 'unlocked', { nom: 'Serrure A', id: 's1' }), ap('serrure', 'locked', { nom: 'Serrure B', id: 's2' }), ap('serrure', 'locked', { nom: 'Serrure C', id: 's3', enLigne: false }), ap('lumière', 'on')], ['Cam A', 'Cam B']);
  const e = await etat(W('maison_securite'), LUI, src);
  assert.equal(e.etat, 'ok'); assert.equal(e.at, MAINT);
  assert.deepEqual(e.donnee!.serrures, [
    { nom: 'Serrure A', piece: 'Pièce A', etat: 'ouverte' },
    { nom: 'Serrure C', piece: 'Pièce A', etat: 'non_lu' },
    { nom: 'Serrure B', piece: 'Pièce A', etat: 'fermee' },
  ], 'trois lignes vraies, la plus grave d\'abord');
  assert.equal(e.donnee!.toutFerme, false, 'une ouverte et une non lue : jamais « tout est fermé »');
  assert.deepEqual(e.donnee!.comptes, { fermees: 1, ouvertes: 1, nonLues: 1, inconnues: 0 });
  assert.deepEqual(e.donnee!.cameras, { n: 2, noms: ['Cam A', 'Cam B'] });
  // Une serrure non lue seule, avec une fermée : toujours pas « tout est fermé ».
  const nonLue = await etat(W('maison_securite'), LUI, fausse([ap('serrure', 'locked'), ap('serrure', '')]).src);
  assert.equal(nonLue.donnee!.toutFerme, false); assert.equal(nonLue.donnee!.comptes.nonLues, 1);
  // Muette depuis plus d'un jour : non lue (l'état d'hier n'est pas celui d'aujourd'hui).
  const vieille = await etat(W('maison_securite'), LUI, fausse([ap('serrure', 'locked', { vuA: MAINT - 25 * H })]).src);
  assert.equal(vieille.donnee!.serrures[0].etat, 'non_lu'); assert.equal(vieille.donnee!.toutFerme, false);
  // Un état lu qu'Odin ne sait pas dire (bloquée) : « inconnu », jamais fermé.
  const bloquee = await etat(W('maison_securite'), LUI, fausse([ap('serrure', 'jammed')]).src);
  assert.equal(bloquee.donnee!.serrures[0].etat, 'inconnu'); assert.equal(bloquee.donnee!.toutFerme, false);
});

test('sécurité : tout lu et fermé → il le dit ; les portes qui ouvrent la maison (la règle de Midgard) avec leur état ; un volet ordinaire n\'en est pas une', async () => {
  const l = [ap('serrure', 'locked', { nom: 'Serrure A', id: 's1' }), ap('serrure', 'LOCKED', { nom: 'Serrure B', id: 's2' }),
    ap('volet', 'closed', { nom: 'Porte G', id: 'ha:cover.garage' }), ap('volet', 'open', { nom: 'Volet C', id: 'ha:cover.chambre' })];
  const e = await etat(W('maison_securite'), LUI, fausse(l, []).src);
  assert.equal(e.donnee!.toutFerme, true);
  assert.deepEqual(e.donnee!.ouvertures, [{ nom: 'Porte G', piece: 'Pièce A', etat: 'fermee' }], 'le volet d\'une chambre ne compte pas');
  // Aucune caméra connue : pas de ligne (jamais un 0 à la place d'une absence) ; Cyclope absente : pas de ligne non plus.
  assert.equal('cameras' in e.donnee!, false);
  assert.equal('cameras' in (await etat(W('maison_securite'), LUI, fausse(l, undefined, { sansCyclope: true }).src)).donnee!, false);
  // La porte ouverte : plus « tout est fermé ».
  const o = await etat(W('maison_securite'), LUI, fausse([...l.slice(0, 2), ap('volet', 'open', { nom: 'Porte G', id: 'ha:cover.garage' })], []).src);
  assert.equal(o.donnee!.toutFerme, false); assert.equal(o.donnee!.ouvertures[0].etat, 'ouverte');
});

test('sécurité : aucune alarme, aucun bouclier fixe, jamais « protégé » — ni dans la donnée, ni dans le code', async () => {
  const e = await etat(W('maison_securite'), LUI, fausse([ap('serrure', 'locked')], ['Cam A']).src);
  const tout = JSON.stringify(e);
  assert.doesNotMatch(tout, /alarm|protég|protect|bouclier|shield|mode|22:00/i);
  for (const f of [PAGE_JS, SERVEUR_TS]) {
    assert.ok(f.length > 0, 'le fichier existe');
    assert.doesNotMatch(f, /Alarme prête|Tout est protégé|Mode « Maison »|\bshield\b|camSVG|En direct|<svg[^>]*viewBox="0 0 400 240"/, 'ni alarme, ni bouclier, ni image dessinée, ni « En direct »');
    for (const mot of ['Porte d\'entrée', 'Garage', 'Portail', '3 en ligne']) assert.ok(!f.includes(mot), `aucun exemple de la maquette : ${mot}`);
  }
});

test('sécurité : rien à montrer → « vide » ; Midgard muette ou absente : rien d\'inventé', async () => {
  assert.deepEqual(await etat(W('maison_securite'), LUI, fausse([ap('lumière', 'on')], []).src), { etat: 'vide', raison: 'rien_a_surveiller' });
  assert.deepEqual(await etat(W('maison_securite'), LUI, fausse([], undefined).src), { etat: 'vide', raison: 'rien_a_surveiller' });
  // Seulement des caméras : une ligne, sans « tout est fermé ».
  const c = await etat(W('maison_securite'), LUI, fausse([], ['Cam A']).src);
  assert.equal(c.etat, 'ok'); assert.equal(c.donnee!.toutFerme, false); assert.deepEqual(c.donnee!.serrures, []);
  assert.deepEqual(await etat(W('maison_securite'), LUI, fausse(undefined, ['Cam A']).src), { etat: 'source_absente', raison: 'appli_muette' });
  assert.equal((await etat(W('maison_securite'), LUI, fausse([], [], { sansMidgard: true }).src)).etat, 'source_absente');
});

test('caméra : le choix (une caméra : prise ; plusieurs : à choisir ; aucune : « vide ») ; retirée : dit ; jamais d\'image dans la donnée', async () => {
  const cam = (cible?: string) => W('maison_camera', cible ? { cible } : {});
  assert.deepEqual(await etat(cam(), LUI, fausse([], []).src), { etat: 'vide', raison: 'aucune_camera', choix: [] });
  const pas = await etat(cam(), LUI, fausse([], ['Cam A', 'Cam B']).src);
  assert.equal(pas.etat, 'vide'); assert.equal(pas.raison, 'camera_non_choisie');
  assert.deepEqual(pas.choix, [{ cible: 'camera:Cam A', nom: 'Cam A' }, { cible: 'camera:Cam B', nom: 'Cam B' }]);
  const ok = await etat(cam('camera:cam b'), LUI, fausse([], ['Cam A', 'Cam B']).src);
  assert.equal(ok.etat, 'ok'); assert.deepEqual(ok.donnee, { nom: 'Cam B' }, 'le nom tel que Cyclope le garde (la route le retrouve sans tenir compte des majuscules)');
  assert.doesNotMatch(JSON.stringify(ok), /jpeg|base64|data:|\/api\//, 'ni image ni adresse dans la donnée : la page appelle la route qui existe');
  assert.deepEqual(await etat(cam('camera:Cam Z'), LUI, fausse([], ['Cam A']).src), { etat: 'vide', raison: 'camera_absente', choix: [{ cible: 'camera:Cam A', nom: 'Cam A' }] });
  // Un choix d'appareil (une autre sorte de choix) : pas une caméra.
  assert.equal((await etat(cam('appareil:x'), LUI, fausse([], ['Cam A']).src)).raison, 'camera_non_choisie');
  // Cyclope absente ou désactivée : rien n'est lu.
  assert.equal((await etat(cam('camera:Cam A'), LUI, fausse([], ['Cam A'], { sansCyclope: true }).src)).etat, 'source_absente');
  // Le choix nettoyé : « camera:<nom> », 80 signes au plus (la route en lit 80), jamais un nom réservé.
  const net = sorteDe('maison_camera')!.nettoyer!;
  const n = (cible: unknown) => { const out = { id: 'x', kind: 'maison_camera' } as unknown as Widget; net({ cible }, out, { str: (v, k) => String(v ?? '').trim().slice(0, k) }); return out.cible; };
  assert.equal(n('camera:Cam A'), 'camera:Cam A'); assert.equal(n(`camera:${'x'.repeat(81)}`), undefined); assert.equal(n('camera:__proto__'), undefined);
  assert.equal(n('appareil:x'), undefined); assert.equal(n('camera:'), undefined); assert.equal(n(42), undefined);
});

test('qui voit : un membre (même ouvert), une tablette « maison », une clé « complet » sur l\'écran de la maison : refusés sans une lecture', async () => {
  for (const kind of ['maison_securite', 'maison_camera']) {
    for (const l of [membre(), membre(['d39b0000@midgard', 'd39b0000@himinbjorg']), TABLETTE, LUI_MAISON, { qui: 'maison', ecran: 'accueil' } as Lecteur]) {
      const { src, lus } = fausse([ap('serrure', 'locked', { nom: 'Serrure A' })], ['Cam A']);
      const e = await etat(W(kind, { cible: 'camera:Cam A' }), l, src);
      assert.equal(e.etat, 'refuse', `${kind} : ${l.qui} sur ${l.ecran}`);
      assert.equal('donnee' in e || 'choix' in e, false); assert.doesNotMatch(JSON.stringify(e), /Cam A|Serrure A/);
      assert.deepEqual(lus, [], `${kind} : rien n'est lu pour ${l.qui} sur ${l.ecran}`);
    }
  }
  // Le choix des caméras n'est servi qu'au propriétaire, sur son accueil.
  assert.ok((await etat(W('maison_camera'), LUI, fausse([], ['Cam A']).src)).choix);
});

test('qui voit : le second verrou, dans la lecture elle-même (sans la règle commune devant) : seul le propriétaire sur son accueil', async () => {
  for (const kind of ['maison_securite', 'maison_camera']) {
    const lireSeule = sorteDe(kind)!.lire!;
    for (const l of [membre(), membre(['d39b0000@midgard', 'd39b0000@himinbjorg']), TABLETTE, LUI_MAISON, { qui: 'maison', ecran: 'accueil' } as Lecteur]) {
      const { src, lus } = fausse([ap('serrure', 'locked', { nom: 'Serrure A' })], ['Cam A']);
      const e = (await lireSeule(W(kind, { cible: 'camera:Cam A' }), src, l)) as Etat;
      assert.deepEqual(e, { etat: 'refuse', raison: 'proprietaire_seul' }, `${kind} : ${l.qui} sur ${l.ecran}`);
      assert.deepEqual(lus, [], `${kind} : rien n'est lu pour ${l.qui} sur ${l.ecran}`);
    }
  }
});

test('sécurité : rangée par gravité (ouverte, non lue, inconnue, puis fermée) ; au-delà de ce qui est servi, une ouverte n\'est jamais coupée', async () => {
  const l = [ap('serrure', 'locked', { nom: 'S1' }), ap('serrure', 'jammed', { nom: 'S2' }), ap('serrure', 'locked', { nom: 'S3' }), ap('serrure', '', { nom: 'S4' }), ap('serrure', 'unlocked', { nom: 'S5' })];
  const e = await etat(W('maison_securite'), LUI, fausse(l).src);
  assert.deepEqual(e.donnee!.serrures.map((x: { nom: string }) => x.nom), ['S5', 'S4', 'S2', 'S1', 'S3'], 'la plus grave d\'abord, l\'ordre des appareils sinon');
  // Beaucoup de serrures fermées, une ouverte en dernier : elle est servie (et la première).
  const beaucoup = [...Array.from({ length: 60 }, (_, i) => ap('serrure', 'locked', { nom: `F${i}` })), ap('serrure', 'unlocked', { nom: 'Ouv' })];
  const b = await etat(W('maison_securite'), LUI, fausse(beaucoup).src);
  assert.equal(b.donnee!.serrures[0].nom, 'Ouv'); assert.ok(b.donnee!.serrures.length < 61, 'la liste servie a une borne');
  assert.deepEqual(b.donnee!.comptes, { fermees: 60, ouvertes: 1, nonLues: 0, inconnues: 0 }, 'le compte entier reste dit');
});

// ------------------------------------------------------------------ la page, sans document

const fenetre = () => {
  const win: Record<string, any> = { document: undefined };
  win.window = win; vm.createContext(win);
  vm.runInContext(GRILLE, win); vm.runInContext(RENDU, win); vm.runInContext(PAGE_JS, win);
  return win;
};

test('page : déclarées dans la famille « maison », au propriétaire seul, avec la même marque que le serveur ; la grille suit le serveur', () => {
  const win = fenetre(), R = win.OdinWidgetsRendu;
  const s = R.rendu('maison_securite'), c = R.rendu('maison_camera');
  assert.ok(s && c);
  for (const d of [s, c]) { assert.equal(d.famille, 'maison'); assert.equal(d.proprio, true); assert.equal(d.jamaisALaMaison, true, `${d.sorte} : la marque du serveur`); assert.equal(d.groupe, ''); }
  assert.equal(s.appli, 'midgard'); assert.equal(c.appli, 'himinbjorg');
  // Suit la pose de « Caméra » : elle a sa ligne dans le tiroir, au propriétaire seul (avant : pas de ligne).
  assert.equal(s.tiroir, true); assert.equal(c.tiroir, true, 'la caméra est proposée');
  assert.equal(R.posables({ proprio: false, aDroit: () => true }).filter((d: any) => /securite|camera/.test(d.sorte)).length, 0, 'jamais proposée à un membre');
  assert.deepEqual(R.posables({ proprio: true, aDroit: () => true }).filter((d: any) => /securite|camera/.test(d.sorte)).map((d: any) => d.sorte).join(','), 'maison_securite,maison_camera', 'au propriétaire : les deux');
  assert.equal(R.posables({ proprio: true, aDroit: (a: string) => a !== 'himinbjorg' }).some((d: any) => d.sorte === 'maison_camera'), false, 'sans le droit sur Cyclope : pas de ligne');
  assert.deepEqual([...win.OdinGrille.MINI.maison_securite], [3, 3]); assert.equal(win.OdinGrille.HAUTEUR.maison_securite, 3);
  assert.deepEqual([...win.OdinGrille.MINI.maison_camera], [3, 2]); assert.equal(win.OdinGrille.HAUTEUR.maison_camera, 3);
  assert.deepEqual([...s.vides], ['rien_a_surveiller']);
});

test('page : l\'adresse de l\'image est celle de la route qui existe ; un nom piégé y est encodé et ne change pas l\'adresse', () => {
  const S = fenetre().OdinWidgetsMaisonSecurite;
  assert.equal(S.adresseImage('Cam A'), '/api/maison/camera?nom=Cam%20A');
  const piege = '../x?nom=autre&y=<img src=x onerror=1>#z';
  const a = S.adresseImage(piege), u = new URL(a, 'http://h.invalid');
  assert.equal(u.pathname, '/api/maison/camera'); assert.deepEqual([...u.searchParams.keys()], ['nom']); assert.equal(u.searchParams.get('nom'), piege); assert.equal(u.hash, '');
  assert.equal(S.adresseImage(''), ''); assert.equal(S.adresseImage(42), '');
});

test('page : une image n\'est demandée qu\'à l\'écran, page visible, hors « Modifier », sur l\'accueil, au rythme lent dit', () => {
  const S = fenetre().OdinWidgetsMaisonSecurite, P = S.PERIODE;
  assert.ok(P >= 20_000, 'un rythme lent'); assert.match(S.TEXTES.camera.rythme(P), /\d+ s/);
  const base = { aLEcran: true, pageVisible: true, modifier: false, ecran: 'accueil', dernier: 0, maintenant: 10 * P };
  assert.equal(S.aDemander(base), true);
  for (const k of [{ aLEcran: false }, { pageVisible: false }, { modifier: true }, { ecran: 'maison' }, { dernier: 10 * P - 1000 }]) assert.equal(S.aDemander({ ...base, ...k }), false, JSON.stringify(k));
  // Jamais « En direct » : c'est une image prise à la demande.
  assert.doesNotMatch(JSON.stringify(S.TEXTES), /direct|live/i);
});

test('page : sécurité, les mots disent vrai (fermée à clé, ouverte, non lue ; « tout est fermé » seulement si le serveur le dit)', () => {
  const S = fenetre().OdinWidgetsMaisonSecurite;
  assert.equal(S.entete({ toutFerme: true, comptes: { fermees: 2, ouvertes: 0, nonLues: 0, inconnues: 0 } }), 'Tout est fermé');
  assert.equal(S.entete({ toutFerme: false, comptes: { fermees: 1, ouvertes: 1, nonLues: 1, inconnues: 0 } }), '1 ouverte · 1 non lue');
  assert.equal(S.entete({ toutFerme: false, comptes: { fermees: 0, ouvertes: 0, nonLues: 0, inconnues: 0 }, cameras: { n: 2 } }), '');
  assert.equal(S.TEXTES.etats.fermee.serrure, 'Fermée à clé'); assert.equal(S.TEXTES.etats.non_lu.serrure, 'État non lu');
});

test('page : « et N de plus » compte aussi ce que le serveur n\'a pas servi (au-delà de sa borne)', () => {
  const S = fenetre().OdinWidgetsMaisonSecurite;
  const l = (n: number) => Array.from({ length: n }, () => ({ nom: 'x', piece: '', etat: 'fermee' }));
  assert.equal(S.nonServies({ serrures: l(48), ouvertures: l(2), comptes: { fermees: 60, ouvertes: 0, nonLues: 0, inconnues: 0 } }), 10);
  assert.equal(S.nonServies({ serrures: l(3), ouvertures: [], comptes: { fermees: 3, ouvertes: 0, nonLues: 0, inconnues: 0 } }), 0);
  assert.equal(S.nonServies({ serrures: l(3) }), 0, 'sans compte : rien d\'inventé'); assert.equal(S.nonServies(null), 0);
});

// ------------------------------------------------------------------ un vrai Odin d'essai

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
let v: VraiOdin, avecDroit = '', cleMaison = '', cleComplet = '';
const MDP = 'une-pirogue-sur-le-lagon-calme-49';
const PAGE = 'b39b0001', PIEGE = '<img src=x onerror="window.__pirate=1">';
const ID = { securite: 'd39b0001' };
const FENETRE = (avec: boolean, mini = false) => ({ pages: [
  { id: PAGE, name: 'Maison', widgets: avec ? [mini ? { id: ID.securite, kind: 'maison_securite', w: 1, c: 3, r: 3, pc: 4 } : { id: ID.securite, kind: 'maison_securite', w: 1, c: 4, r: 3, pc: 4 }] : [] },
  { id: 'b39b0002', name: 'Au mur', maison: true, widgets: avec ? [{ id: 'd39b0010', kind: 'maison_securite', w: 1, c: 4, r: 3 }] : [] },
] });
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
type Rendue = { id: string; kind: string; etat: string; raison?: string; donnee?: Record<string, any> };
const donnees = async (h: Record<string, string> = {}) => { const r = await v.json(`/api/widgets/donnees?page=${PAGE}`, undefined, h); return { status: r.status, corps: JSON.stringify(r.body), de: (id: string) => ((r.body.widgets as Rendue[] | undefined) ?? []).find((w) => w.id === id) }; };
const ecranMaison = async (h: Record<string, string>) => { const r = await v.json('/api/maison/etat', undefined, h); const { at: _a, mascotte: _m, ...reste } = r.body; return { status: r.status, reste }; };
const regler = async (avec: boolean, mini = false) => { const va = valhallaOf()!; va.ctx('gladsheim').saveSettings({ fenetre: undefined }); const r = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(FENETRE(avec, mini)) }); assert.equal(r.ok, true, r.text); };
const QUI = () => ({ tablette: { cookie: '', 'x-odin-maison': cleMaison }, complet: { cookie: '', 'x-odin-maison': cleComplet }, membre: { cookie: avecDroit }, cle: { cookie: '', authorization: `Bearer ${v.token}` }, sans: { cookie: '' } });

before(async () => {
  for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['gladsheim', 'midgard', 'himinbjorg', 'var', 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-m', nom: 'Membre M', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'midgard', 'himinbjorg']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-m' })).ok, true);
  lierProprietaire(persona()!);
  avecDroit = await entrer('membre-m', MDP); assert.ok(avecDroit, 'le membre a une session');
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  cleComplet = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette complet', droits: 'complet' })).data as { key: string }).key;
  // Ses caméras : une au nom ordinaire, une au nom piégé ; sans détection de mouvement (rien ne lit leur flux).
  for (const nom of ['Cam A', PIEGE]) assert.equal((await va.act('himinbjorg', 'ajouter', { nom, adresse: 'rtsp://camera-a.invalid/flux', mouvement: false })).ok, true, nom);
  await regler(true);
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('vrai Odin : le propriétaire, sur son accueil : ses caméras comptées (sans serrure : aucune ligne inventée) ; rien sur l\'écran de la maison', async () => {
  const lui = await donnees();
  assert.equal(lui.status, 200);
  const s = lui.de(ID.securite)!; assert.equal(s.etat, 'ok', JSON.stringify(s));
  assert.deepEqual(s.donnee, { serrures: [], ouvertures: [], comptes: { fermees: 0, ouvertes: 0, nonLues: 0, inconnues: 0 }, toutFerme: false, cameras: { n: 2, noms: ['Cam A', PIEGE] } });
  assert.doesNotMatch(lui.corps, /rtsp|invalid/, 'jamais l\'adresse d\'une caméra');
  // L'écran de la maison (sa session, une clé « complet », une tablette) : le widget n'y est jamais servi.
  for (const h of [{}, QUI().complet, QUI().tablette]) {
    const m = await v.json('/api/maison/etat', undefined, h); assert.equal(m.status, 200);
    const ws = ((m.body.fenetre as Array<{ widgets: Array<{ id: string }> }>) ?? []).flatMap((p) => p.widgets);
    assert.ok(!ws.some((w) => w.id === 'd39b0010'), 'jamais sur l\'écran de la maison');
  }
});

test('vrai Odin : un membre (avec le droit sur la maison et les caméras), une tablette, une clé « complet », une clé d\'accès, sans session : rien de plus qu\'avant, rien lu', async () => {
  const himin = valhallaOf()!.ctx('himinbjorg').dir;
  const m = await donnees(QUI().membre);
  assert.equal(m.status, 200);
  const e = m.de(ID.securite)!; assert.deepEqual([e.etat, e.raison, 'donnee' in e], ['refuse', 'proprietaire_seul', false]);
  assert.ok(!m.corps.includes('Cam A'), 'aucun nom de caméra pour un membre');
  for (const k of ['tablette', 'complet', 'cle', 'sans'] as const) { const r = await donnees(QUI()[k]); assert.equal(r.status, 401, k); assert.ok(!r.corps.includes('Cam A'), k); }
  // L'écran de la maison, avec et sans ces widgets posés sur la page « au mur » : exactement la même chose pour chacun.
  const apres: Record<string, unknown> = {}; for (const [k, h] of Object.entries(QUI())) apres[k] = await ecranMaison(h);
  await regler(false);
  try { for (const [k, h] of Object.entries(QUI())) assert.deepEqual(apres[k], await ecranMaison(h), `${k} : l'écran de la maison ne change pas`); }
  finally { await regler(true); }
  // L'image, rejouée sur la route qui existe : refusée à tous ceux-là, sans qu'aucune image soit prise (aucun aperçu écrit).
  for (const [k, attendu] of [['tablette', 403], ['membre', 401], ['cle', 401], ['sans', 401]] as const) {
    const r = await fetch(`${v.url}/api/maison/camera?nom=${encodeURIComponent('Cam A')}`, { headers: QUI()[k], redirect: 'manual' });
    assert.equal(r.status, attendu, k); assert.notEqual(r.headers.get('content-type'), 'image/jpeg', k); await r.arrayBuffer();
  }
  assert.equal(existsSync(join(himin, 'apercus')), false, 'aucune image prise pour eux');
  assert.deepEqual((await ecranMaison(QUI().tablette)).reste.cameras, [], 'une tablette « maison » ne reçoit aucun nom de caméra (comme avant)');
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any, location: any, getComputedStyle: any, requestAnimationFrame: (f: () => void) => number, DataTransfer: any, DragEvent: any;
interface Route { fetch(): Promise<{ json(): Promise<any> }>; fulfill(o: Record<string, unknown>): Promise<void>; request(): { url(): string } }
interface Page {
  dblclick(s: string): Promise<void>; keyboard: { press(k: string): Promise<void> };
  goto(u: string): Promise<unknown>; waitForFunction(f: () => unknown, a?: unknown, o?: Record<string, unknown>): Promise<unknown>; click(s: string): Promise<void>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; waitForTimeout(n: number): Promise<void>;
  evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>; route(u: string | RegExp, h: (r: Route) => Promise<void> | void): Promise<void>;
  on(e: string, f: (x: any) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });
const CAPTURES = process.env.ODIN_CAPTURES;
const NOMS = ['Serrure du devant avec un nom très long pour voir la coupe', 'Serrure B', PIEGE, 'Serrure D', 'Serrure E'];
const FORCE = () => ({ etat: 'ok', at: Date.now(), donnee: {
  serrures: NOMS.map((nom, i) => ({ nom, piece: 'Pièce A', etat: ['fermee', 'fermee', 'non_lu', 'ouverte', 'inconnu'][i] })),
  ouvertures: [{ nom: 'Porte G', piece: 'Pièce B', etat: 'fermee' }], comptes: { fermees: 3, ouvertes: 1, nonLues: 1, inconnues: 1 }, toutFerme: false, cameras: { n: 2, noms: ['Cam A', PIEGE] } } });
// Une petite image (un pixel) : servie à la place de la route, pour l'essai seulement.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
async function ouvrir(largeur: number, sombre: boolean, force: () => Record<string, unknown> = FORCE, image: { type: string; corps: Buffer } = { type: 'image/png', corps: PIXEL }) {
  const doigt = largeur < 500;
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: 900 }, hasTouch: doigt, isMobile: doigt, colorScheme: sombre ? 'dark' : 'light' });
  const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); localStorage.setItem('odin.fenetre.page', '1'); ${sombre ? 'localStorage.setItem(\'odin.theme\', \'sombre\');' : ''} } catch { /* rien */ }`);
  const p = await ctx.newPage(), erreurs: string[] = [], images: string[] = [];
  p.on('pageerror', (e) => erreurs.push(String(e)));
  await p.route(/\/api\/widgets\/donnees/, async (r) => {
    const rep = await r.fetch(), j = await rep.json();
    if (Array.isArray(j?.widgets)) j.widgets = j.widgets.map((w: any) => (w.id === ID.securite ? { id: w.id, kind: w.kind, page: w.page, ...force() } : w));
    await r.fulfill({ response: rep, json: j });
  });
  await p.route(/\/api\/maison\/camera/, async (r) => { images.push(r.request().url()); await r.fulfill({ status: 200, headers: { 'content-type': image.type, 'cache-control': 'no-store' }, body: image.corps }); });
  await p.goto(v.url + '/');
  await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  // « Sombre » : un vrai thème sombre d'Odin (« Verre sombre », posé par Apparence), vérifié sur la page ; « clair » : le thème de départ, clair.
  if (sombre) await p.waitForFunction(() => document.documentElement.dataset.theme === 'dark', undefined, { timeout: 15000 });
  else assert.notEqual(await p.evaluate(() => document.documentElement.dataset.theme), 'dark', 'le thème de départ est clair');
  await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.securite}"] .wsc`, { timeout: 45000 });
  return { ctx, page: p, erreurs, images };
}
/** Le thème d'Odin : « Verre sombre » pour un essai sombre, puis l'automatique d'avant (celui de départ). */
const theme = async (sombre: boolean) => { assert.equal((await valhallaOf()!.act('apparence', 'theme', { theme: sombre ? 'h-verre' : 'automatique' })).ok, true); };
const pose = (p: Page) => p.evaluate(() => document.fonts.ready.then(() => new Promise<void>((f) => requestAnimationFrame(() => requestAnimationFrame(() => f())))));
const mesure = (p: Page, sel: string) => p.evaluate((s: string) => {
  const c = document.querySelector(s); if (!c) return null;
  const b = c.getBoundingClientRect(), vis = (n: any) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
  const dans = (n: any) => { const r = n.getBoundingClientRect(); return r.width <= 0 || r.height <= 0 || (r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1); };
  return {
    deborde: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, pirate: Boolean(window.__pirate),
    texte: (c.textContent ?? '').replace(/\s+/g, ' '),
    dehors: [...c.querySelectorAll('*')].filter(vis).filter((n: any) => !dans(n)).map((n: any) => `${n.tagName}.${n.className?.baseVal ?? n.className}`),
    petits: [...c.querySelectorAll('button, a')].filter(vis).filter((n: any) => { const r = n.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).map((n: any) => n.textContent),
    coupesSansBulle: [...c.querySelectorAll('.wsc *')].filter((n: any) => vis(n) && n.children.length === 0 && n.scrollWidth > n.clientWidth + 1 && !n.closest('[title]')).map((n: any) => n.textContent),
    vues: [...c.querySelectorAll('.wsc [data-item]')].filter(vis).length, plus: c.querySelector('.wsc-plus:not([hidden])')?.textContent ?? '',
    svgImage: c.querySelectorAll('.wsc svg[viewBox="0 0 400 240"]').length,
    // L'état dans le corps (jamais seulement dans un sous-titre coupé) : son texte et s'il se lit en entier.
    etatCorps: (() => { const n = c.querySelector('.wsc-etat'); return n && vis(n) ? { t: n.textContent, entier: n.scrollWidth <= n.clientWidth + 1 } : null; })(),
    boutonsCoupes: [...c.querySelectorAll('.wsc-btn')].filter(vis).filter((n: any) => n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1).map((n: any) => n.textContent),
    ecartPlus: (() => { const p = c.querySelector('.wsc-plus'), its = [...c.querySelectorAll('.wsc [data-item]')].filter(vis); if (!p || !p.textContent || !its.length) return 0; return p.getBoundingClientRect().top - its[its.length - 1].getBoundingClientRect().bottom; })(),
    premier: c.querySelector('.wsc [data-item]')?.dataset.etat ?? '',
  };
}, sel);

for (const [largeur, sombre] of [[1280, false], [390, true], [768, false], [768, true]] as const) {
  test(`navigateur, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : « Sécurité » dans sa carte, cibles de 44 px, un nom piégé reste du texte`, { skip: sansNav }, async () => {
    await theme(sombre);
    const { ctx, page: p, erreurs } = await ouvrir(largeur, sombre);
    try {
      await pose(p);
      const a = (await mesure(p, `#feGrid > .fe-w[data-id="${ID.securite}"]`))!;
      assert.deepEqual(a.etatCorps, { t: '1 ouverte · 1 non lue · 1 état inconnu', entier: true }, 'l\'état se lit en entier dans le corps');
      assert.equal(a.premier, 'ouverte', 'la plus grave en premier'); assert.ok(a.ecartPlus < 14, `« et N de plus » suit la dernière ligne (${a.ecartPlus} px)`);
      assert.ok(a, 'affichée'); assert.equal(a.deborde, false, 'rien ne déborde de la page'); assert.equal(a.pirate, false, 'aucun script injecté');
      assert.deepEqual(a.dehors, [], 'reste dans sa carte'); assert.deepEqual(a.petits, [], 'cibles de 44 px'); assert.deepEqual(a.coupesSansBulle, [], 'un texte coupé a son entier en info-bulle');
      assert.match(a.texte, /1 ouverte · 1 non lue/); assert.match(a.texte, /Ouverte/); assert.doesNotMatch(a.texte, /Tout est fermé|protégé|Alarme|En direct/);
      assert.ok(a.vues >= 1, 'au moins une ligne se voit'); if (a.vues < 7) assert.match(a.plus, /^et \d+ de plus$/, 'le reste est compté');
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/maison-securite-${largeur}${sombre ? '-sombre' : ''}.png`, fullPage: true });
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); await theme(false); }
  });
}

test('navigateur : une ligne de « Sécurité » mène à l\'appli de la maison (au clavier aussi) ; en mode « Modifier », rien ne part', { skip: sansNav }, async () => {
  const { ctx, page: p, erreurs } = await ouvrir(1280, false);
  try {
    await pose(p);
    const sel = `#feGrid > .fe-w[data-id="${ID.securite}"] .wsc-li button[data-item]`;
    const info = await p.evaluate((s: string) => [...document.querySelectorAll(s)].filter((b: any) => b.getClientRects().length > 0).map((b: any) => ({ h: b.getBoundingClientRect().height, l: b.getAttribute('aria-label') || '' })), sel);
    assert.ok(info.length >= 1, 'chaque ligne est un bouton'); assert.ok(info.every((x: { h: number }) => x.h >= 44), 'cibles de 44 px');
    assert.ok(info.every((x: { l: string }) => /Ouverte|Fermée|non lu|inconnu|Caméras/.test(x.l)), 'le lecteur d\'écran entend l\'état');
    await p.evaluate((s: string) => { location.hash = ''; document.querySelector(s).focus(); }, sel);
    await p.evaluate(() => document.activeElement.click());
    assert.equal(await p.evaluate(() => location.hash), '#app=midgard');
    // En mode « Modifier » (la classe de la grille), le même appui ne part nulle part.
    await p.evaluate((s: string) => { location.hash = ''; const b = document.querySelector(s); b.closest('#feGrid').classList.add('fe-edit'); b.click(); b.closest('#feGrid').classList.remove('fe-edit'); }, sel);
    assert.equal(await p.evaluate(() => location.hash), '');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur, la plus petite taille (3 × 3), de 320 à 1920 px (768 compris), « tout est fermé » et l\'état « vide » : rien ne sort de la carte', { skip: sansNav }, async () => {
  await regler(true, true);
  try {
    const ferme = () => ({ etat: 'ok', at: Date.now(), donnee: { serrures: [{ nom: 'Serrure A', piece: '', etat: 'fermee' }], ouvertures: [], comptes: { fermees: 1, ouvertes: 0, nonLues: 0, inconnues: 0 }, toutFerme: true } });
    for (const [largeur, force] of [[320, FORCE], [768, FORCE], [1280, ferme], [1920, FORCE], [768, () => ({ etat: 'vide', raison: 'rien_a_surveiller' })]] as const) {
      const { ctx, page: p, erreurs } = await ouvrir(largeur, false, force);
      try {
        await pose(p);
        const a = (await mesure(p, `#feGrid > .fe-w[data-id="${ID.securite}"]`))!;
        assert.equal(a.deborde, false, `${largeur} : la page ne déborde pas`); assert.deepEqual(a.dehors, [], `${largeur} : dans sa carte`);
        assert.deepEqual(a.petits, [], `${largeur} : cibles de 44 px`); assert.deepEqual(a.coupesSansBulle, [], `${largeur} : info-bulles`);
        if (force === ferme) { assert.match(a.texte, /Tout est fermé/); assert.deepEqual(a.etatCorps, { t: 'Tout est fermé', entier: true }, `${largeur} : l'état dans le corps`); }
        if (force === FORCE) assert.deepEqual(a.etatCorps, { t: '1 ouverte · 1 non lue · 1 état inconnu', entier: true }, `${largeur} : l'état se lit en entier, même à la taille mini`);
        assert.deepEqual(a.boutonsCoupes, [], `${largeur} : aucun bouton coupé`);
        if (force !== ferme && force !== FORCE) assert.match(a.texte, /Aucune serrure, aucune porte, aucune caméra/);
        assert.deepEqual(erreurs, []);
      } finally { await ctx.close(); }
    }
  } finally { await regler(true); }
});

/** La carte « Caméra » dessinée dans une vraie page d'Odin (elle n'est pas encore posable) : une boîte de la taille d'une carte. */
const poserCamera = (p: Page, e: Record<string, unknown>, o: Record<string, unknown> = {}) => p.evaluate(({ e, o }: any) => {
  const R = window.OdinWidgetsRendu, d = R.rendu('maison_camera');
  let hote = document.getElementById('hoteCam'); if (hote) hote.remove();
  hote = document.createElement('div'); hote.id = 'hoteCam'; hote.className = 'fe-w'; hote.style.cssText = 'position:fixed;left:10px;top:10px;width:300px;height:220px;display:flex;flex-direction:column;z-index:99';
  if (o.modifier) { const f = document.createElement('div'); f.id = 'fenetreEssai'; f.className = 'fe-edit'; f.append(hote); document.body.append(f); } else document.body.append(hote);
  hote.append(R.dessiner(d, e, { w: { id: 'd39b0099', kind: 'maison_camera' }, ecran: o.ecran ?? 'accueil' }));
  return true;
}, { e, o });
const camOk = { etat: 'ok', at: Date.now(), donnee: { nom: PIEGE } };

test('navigateur : « Caméra », la vraie route appelée une fois, nom encodé ; l\'image garde ses proportions ; jamais « En direct » ; une caméra qui ne répond pas est dite, sans image', { skip: sansNav }, async () => {
  const { ctx, page: p, erreurs, images } = await ouvrir(1280, false);
  try {
    await poserCamera(p, camOk);
    await p.waitForSelector('#hoteCam img.wsc-img[src^="blob:"]', { timeout: 10000 });
    assert.equal(images.length, 1, 'une image demandée');
    const u = new URL(images[0]); assert.equal(u.pathname, '/api/maison/camera'); assert.equal(u.searchParams.get('nom'), PIEGE); assert.deepEqual([...u.searchParams.keys()], ['nom']);
    const vu = await p.evaluate(() => { const i = document.querySelector('#hoteCam img.wsc-img'), t = document.querySelector('#hoteCam').textContent; return { fit: getComputedStyle(i).objectFit, t, pirate: Boolean(window.__pirate), svg: document.querySelectorAll('#hoteCam svg[viewBox="0 0 400 240"]').length }; });
    assert.equal(vu.fit, 'contain', 'ni étirée, ni déformée'); assert.doesNotMatch(vu.t, /direct/i); assert.match(vu.t, /^Reçue à \S/, 'l\'heure d\'abord : celle où l\'image est arrivée'); assert.equal(vu.pirate, false); assert.equal(vu.svg, 0, 'aucun dessin');
    // Une caméra qui ne répond pas (la route rend 502) : dit, et l'image d'avant n'est plus montrée comme actuelle.
    await p.route(/\/api\/maison\/camera/, async (r) => { images.push(r.request().url()); await r.fulfill({ status: 502, headers: { 'content-type': 'application/json' }, body: '{"ok":false}' }); });
    await p.evaluate(() => window.OdinWidgetsMaisonSecurite.demanderTout(true));
    await p.waitForSelector('#hoteCam .wsc-cam[data-panne]', { timeout: 10000 });
    const panne = await p.evaluate(() => ({ t: document.querySelector('#hoteCam').textContent, img: document.querySelectorAll('#hoteCam img.wsc-img:not([hidden])').length, cadre: document.querySelector('#hoteCam .wsc-cadre').getClientRects().length }));
    assert.match(panne.t, /ne répond pas/); assert.equal(panne.img, 0, 'aucune image figée présentée comme actuelle'); assert.equal(panne.cadre, 0, 'pas de cadre vide au-dessus du message');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur : « Caméra » en mode « Modifier », page cachée, ou sur l\'écran de la maison : aucune image demandée ; retirée : dit', { skip: sansNav }, async () => {
  const { ctx, page: p, erreurs, images } = await ouvrir(1280, false);
  try {
    await poserCamera(p, camOk, { modifier: true }); await p.waitForTimeout(800);
    await p.evaluate(() => window.OdinWidgetsMaisonSecurite.demanderTout());
    assert.deepEqual(images, [], 'en mode « Modifier », rien');
    await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await poserCamera(p, camOk); await p.waitForTimeout(800); await p.evaluate(() => window.OdinWidgetsMaisonSecurite.demanderTout());
    assert.deepEqual(images, [], 'page cachée, rien');
    await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); });
    await poserCamera(p, camOk, { ecran: 'maison' }); await p.waitForTimeout(800); await p.evaluate(() => window.OdinWidgetsMaisonSecurite.demanderTout());
    assert.deepEqual(images, [], 'sur l\'écran de la maison, rien');
    await poserCamera(p, { etat: 'vide', raison: 'camera_absente' });
    assert.match(await p.evaluate(() => document.querySelector('#hoteCam').textContent), /n'existe plus/);
    // Retirée, avec d'autres caméras à choisir : le même mot que « pas encore choisie », pour le même geste.
    await poserCamera(p, { etat: 'vide', raison: 'camera_absente', choix: [{ cible: 'camera:Cam A', nom: 'Cam A' }] });
    assert.equal(await p.evaluate(() => document.querySelector('#hoteCam [data-action=choisir]')?.textContent), 'Choisir une caméra');
    assert.deepEqual(images, []); assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

// ------------------------------------------------------------------ « Caméra » posée depuis le tiroir

test('page : la pose et « Régler » de « Caméra » — ses caméras, par leur nom, tirées de ce que l\'écran de la maison reçoit ; la même règle que le serveur ; le choix d\'avant reste, retiré sous un mot neutre', async () => {
  const win = fenetre(), S = win.OdinWidgetsMaisonSecurite;
  assert.equal(S.genrePose('maison_camera'), 'camera');
  for (const k of ['maison_securite', 'maison_lumiere', 'heure', '__proto__', undefined]) assert.equal(S.genrePose(k), '', String(k));
  assert.equal(S.raisonNonChoisie, 'camera_non_choisie');
  assert.match(S.TEXTES.aucun.camera, /Aucune caméra/); assert.match(S.TEXTES.poseIllisible, /rien n'est posé/);
  // La pose : les noms de /api/maison/etat (etat.cameras), sous la forme des choix du serveur ; rien de lisible : null.
  const noms = ['Cam A', ' ', '', '__proto__', 'x'.repeat(81), 42, null, 'Cam B', PIEGE];
  const pose = S.choixDePose('maison_camera', [], { cameras: noms });
  assert.deepEqual(JSON.parse(JSON.stringify(pose)), [{ cible: 'camera:Cam A', nom: 'Cam A' }, { cible: 'camera:Cam B', nom: 'Cam B' }, { cible: `camera:${PIEGE}`, nom: PIEGE }]);
  const serveur = await etat(W('maison_camera'), LUI, fausse([], noms.filter((x) => typeof x === 'string') as string[]).src);
  assert.deepEqual(JSON.parse(JSON.stringify(pose)), serveur.choix, 'la pose propose ce que « Régler » proposera (la règle du serveur)');
  assert.deepEqual(JSON.parse(JSON.stringify(S.choixDePose('maison_camera', [], { cameras: [] }))), []);
  for (const d of [undefined, null, {}, { cameras: 'Cam A' }]) assert.equal(S.choixDePose('maison_camera', [], d), null);
  assert.equal(S.choixDePose('maison_lumiere', [], { cameras: ['Cam A'] }), null, 'une autre sorte : rien');
  // « Régler » : le champ du choix.
  const choix = [{ cible: 'camera:Cam A', nom: 'Cam A' }, { cible: `camera:${PIEGE}`, nom: PIEGE }, { cible: 'appareil:x', nom: 'Pas une caméra' }, { cible: 'camera:__proto__', nom: 'P' }];
  const c = S.champChoix({ kind: 'maison_camera' }, { etat: 'vide', choix });
  assert.equal(c.libelle, 'La caméra montrée'); assert.equal(c.depart, ''); assert.equal(c.sansListe, false); assert.equal(c.aide, '');
  assert.deepEqual(JSON.parse(JSON.stringify(c.options)), [{ v: '', texte: 'Choisir…' }, { v: 'camera:Cam A', texte: 'Cam A' }, { v: `camera:${PIEGE}`, texte: PIEGE }]);
  assert.equal(c.titre('camera:Cam A'), 'Cam A'); assert.equal(c.titre('camera:Inconnue'), '');
  // Choisie puis retirée d'Odin : elle reste, sous un mot neutre (jamais « camera:… » écrit).
  const r = S.champChoix({ kind: 'maison_camera', cible: 'camera:Cam Z' }, { etat: 'vide', raison: 'camera_absente', choix: choix.slice(0, 1) });
  assert.deepEqual(JSON.parse(JSON.stringify(r.options)), [{ v: 'camera:Cam Z', texte: 'Caméra retirée' }, { v: 'camera:Cam A', texte: 'Cam A' }]);
  assert.equal(r.depart, 'camera:Cam Z');
  assert.ok([...c.options, ...r.options].every((o: any) => !/camera:/.test(o.texte)), 'jamais un identifiant écrit');
  // Pas de liste (pas encore rangé, ou un autre que le propriétaire) : rien à choisir, la phrase dit quoi faire.
  const sans = S.champChoix({ kind: 'maison_camera' }, { etat: 'ok' });
  assert.equal(sans.sansListe, true); assert.match(sans.aide, /Terminé/);
  assert.match(S.champChoix({ kind: 'maison_camera' }, { etat: 'vide', choix: [] }).aide, /Aucune caméra/);
  assert.equal(S.champChoix({ kind: 'maison_lumiere' }, { choix }), null, 'une autre sorte : pas de champ');
  assert.equal(S.champChoix({ kind: 'maison_securite' }, { choix }), null);
  const long = S.champChoix({ kind: 'maison_camera' }, { choix: [{ cible: `camera:${'n'.repeat(60)}`, nom: 'n'.repeat(60) }] });
  assert.equal(long.titre(`camera:${'n'.repeat(60)}`), `${'n'.repeat(39)}…`, 'un titre proposé de 40 signes au plus');
});

test('page : le point d\'accroche commun de la pose et de « Régler » (fenetre.js) — la tuile d\'un appareil et la caméra y passent, une famille qui ne déclare rien n\'y est pas', () => {
  const FE = lire('src/web/fenetre.js');
  const corps = (nom: string) => { const i = FE.indexOf(nom); assert.ok(i >= 0, nom); return FE.slice(i, FE.indexOf('\n  }\n', i)); };
  assert.match(FE, /const famillesChoisies = \(\) => \[window\.OdinWidgetsMaisonAppareils, window\.OdinWidgetsMaisonSecurite\]\.filter\(/);
  assert.match(corps('async function poser('), /choisieDe\(w\.kind\)/); assert.match(corps('async function poser('), /choixDePose\(w\.kind, d\.rooms, d\)/);
  assert.match(corps('async function poser('), /raisonNonChoisie \|\| 'appareil_non_choisi'/, 'la tuile d\'un appareil garde sa raison');
  assert.match(corps('function poserGlisse('), /choisieDe\(x\.sorte\)/);
  assert.match(FE, /const choisie = Boolean\(choisieDe\(x\.sorte\)\);/);
  assert.match(FE, /famillesChoisies\(\)\.reduce\(\(c, F\) => c \?\? \(typeof F\.champChoix === 'function' \? F\.champChoix\(w, eCh\) : null\) \?\? null, null\)/);
  assert.doesNotMatch(FE, /window\.OdinWidgetsMaisonAppareils\?\.(genrePose|champChoix|choixDePose)/, 'plus aucun passage direct');
});

/** Une fenêtre rangée par le rangement d'Odin (la vérification des choix comprise). */
const rangerF = async (f: unknown) => { const va = valhallaOf()!; va.ctx('gladsheim').saveSettings({ fenetre: undefined }); const r = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(f) }); assert.equal(r.ok, true, r.text); };
const rangeesC = () => ((valhallaOf()!.ctx('gladsheim').settings.fenetre ?? { pages: [] }) as { pages: Array<{ widgets: Widget[] }> }).pages.flatMap((x) => x.widgets);
const ciblesC = (ids: string[]) => ids.map((id) => rangeesC().find((w) => w.id === id)?.cible);
const CAM = (id: string, cible?: string) => ({ id, kind: 'maison_camera', w: 1, c: 4, r: 3, ...(cible ? { cible } : {}) });
const AVEC_CAMS = (cams: Array<Record<string, unknown>>) => { const f = FENETRE(true); f.pages[0].widgets.push(...(cams as never[])); return f; };

test('vrai Odin : à l\'enregistrement, « camera:<nom> » gardé si c\'est une de ses caméras ; inconnu, piégé ou mal écrit : retiré ; retirée plus tard : gardé, la carte le dit ; Cyclope coupée : retiré', async () => {
  const va = valhallaOf()!;
  try {
    await rangerF(AVEC_CAMS([CAM('d39b0021', 'camera:Cam A'), CAM('d39b0022', 'camera:Inconnue'), CAM('d39b0023', 'camera:cam a'), CAM('d39b0024', `camera:Cam A${PIEGE}`), CAM('d39b0025', `camera:${PIEGE}`), CAM('d39b0026', 'appareil:Cam A'), CAM('d39b0027')]));
    assert.deepEqual(ciblesC(['d39b0021', 'd39b0022', 'd39b0023', 'd39b0024', 'd39b0025', 'd39b0026', 'd39b0027']), ['camera:Cam A', undefined, undefined, undefined, `camera:${PIEGE}`, undefined, undefined]);
    const lui = await donnees();
    assert.deepEqual(lui.de('d39b0021')!.donnee, { nom: 'Cam A' }, 'son nom, jamais une image ni une adresse');
    assert.equal(lui.de('d39b0022')!.raison, 'camera_non_choisie', 'retiré : redevenu « pas encore choisi »');
    assert.doesNotMatch(lui.corps, /rtsp|invalid/);
    // Une caméra ajoutée, choisie, puis retirée de Cyclope : le choix rangé reste ; la carte dit qu'elle n'existe plus.
    assert.equal((await va.act('himinbjorg', 'ajouter', { nom: 'Cam C', adresse: 'rtsp://camera-c.invalid/flux', mouvement: false })).ok, true);
    await rangerF(AVEC_CAMS([CAM('d39b0021', 'camera:Cam A'), CAM('d39b0028', 'camera:Cam C')]));
    assert.deepEqual(ciblesC(['d39b0021', 'd39b0028']), ['camera:Cam A', 'camera:Cam C']);
    assert.equal((await va.act('himinbjorg', 'retirer', { camera: 'Cam C' })).ok, true);
    const f = AVEC_CAMS([CAM('d39b0021', 'camera:Cam A'), CAM('d39b0028', 'camera:Cam C')]);
    assert.equal((await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(f) })).ok, true);
    assert.deepEqual(ciblesC(['d39b0021', 'd39b0028']), ['camera:Cam A', 'camera:Cam C'], 'déjà rangée : gardée');
    assert.equal((await donnees()).de('d39b0028')!.raison, 'camera_absente');
    // Cyclope coupée au moment d'enregistrer : un choix neuf est retiré (le plus prudent) ; celui déjà rangé reste.
    assert.equal((await va.activer('himinbjorg', false)).ok, true);
    try {
      const g = AVEC_CAMS([CAM('d39b0021', 'camera:Cam A'), CAM('d39b0028', 'camera:Cam C'), CAM('d39b0029', 'camera:Cam A')]);
      assert.equal((await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(g) })).ok, true);
      assert.deepEqual(ciblesC(['d39b0021', 'd39b0028', 'd39b0029']), ['camera:Cam A', 'camera:Cam C', undefined]);
    } finally { assert.equal((await va.activer('himinbjorg', true)).ok, true); }
  } finally { await va.act('himinbjorg', 'retirer', { camera: 'Cam C' }); await regler(true); }
});

test('vrai Odin : « Caméra » posée — un membre (avec le droit sur la maison et les caméras), une tablette, une clé « complet », une clé d\'accès, sans session : ni la liste, ni un nom, ni une image', async () => {
  const himin = valhallaOf()!.ctx('himinbjorg').dir;
  try {
    await rangerF(AVEC_CAMS([CAM('d39b0021', 'camera:Cam A'), CAM('d39b0022')]));
    // Lui : la liste des choix, par leur nom.
    const lui = await donnees();
    assert.deepEqual((lui.de('d39b0022') as unknown as { choix: unknown }).choix, [{ cible: 'camera:Cam A', nom: 'Cam A' }, { cible: `camera:${PIEGE}`, nom: PIEGE }]);
    const m = await donnees(QUI().membre);
    assert.equal(m.status, 200);
    for (const id of ['d39b0021', 'd39b0022']) { const e = m.de(id)!; assert.deepEqual([e.etat, e.raison, 'donnee' in e, 'choix' in e], ['refuse', 'proprietaire_seul', false, false], id); }
    assert.ok(!m.corps.includes('Cam A') && !m.corps.includes('camera:'), 'ni un nom, ni un choix');
    for (const k of ['tablette', 'complet', 'cle', 'sans'] as const) { const r = await donnees(QUI()[k]); assert.equal(r.status, 401, k); assert.ok(!r.corps.includes('Cam A'), k); }
    for (const [k, h] of Object.entries(QUI())) {
      const e = await ecranMaison(h);
      if (k !== 'complet') assert.ok(!JSON.stringify(e).includes('Cam A'), `${k} : aucun nom de caméra sur l'écran de la maison`);
      assert.ok(!JSON.stringify(e.reste.fenetre ?? []).includes('maison_camera'), `${k} : jamais posée sur l'écran de la maison`);
    }
    for (const [k, attendu] of [['tablette', 403], ['membre', 401], ['cle', 401], ['sans', 401]] as const) {
      const r = await fetch(`${v.url}/api/maison/camera?nom=${encodeURIComponent('Cam A')}`, { headers: QUI()[k], redirect: 'manual' });
      assert.equal(r.status, attendu, k); await r.arrayBuffer();
    }
    assert.equal(existsSync(join(himin, 'apercus')), false, 'aucune image prise pour eux');
  } finally { await regler(true); }
});

const carteC = (id: string) => `#feGrid .fe-w[data-id="${id}"]`;
const cartesC = (p: Page) => p.evaluate(() => [...document.querySelectorAll('#feGrid > .fe-w')].map((c: any) => c.dataset.id as string));
const attendreC = async (p: Page, f: (s: string) => boolean, s: string) => { for (let i = 0; i < 300; i++) { if (await p.evaluate(f, s)) return; await p.waitForTimeout(100); } throw new Error(`attendu en vain : ${String(f).slice(0, 140)}`); };
const modifierC = async (p: Page) => { await p.click('#fenetre .fe-mod'); await p.waitForSelector('#fenetre .fe-ajout'); };
const tiroirC = async (p: Page) => { await p.click('#fenetre .fe-ajout'); await p.waitForSelector('#feTiroir.open'); await p.waitForTimeout(350); };
const cliquerC = (p: Page, sel: string, t: string) => p.evaluate((a: string[]) => { const b = [...document.querySelectorAll(a[0])].find((n: any) => n.textContent.trim() === a[1]); if (!b) throw new Error(`pas de bouton « ${a[1]} »`); b.click(); }, [sel, t]);
const choixC = (p: Page) => p.evaluate(() => {
  const d = document.querySelector('dialog.wr-regler[open]'), s = d?.querySelector('#wrRCi'); if (!d || !s) return null;
  return { label: d.querySelector('label[for="wrRCi"]')?.textContent ?? '', valeurs: [...s.options].map((o: any) => o.value), textes: [...s.options].map((o: any) => o.textContent), propose: d.querySelector('#wrRT')?.placeholder ?? '',
    deborde: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 || d.scrollWidth > d.clientWidth + 1, haut: s.getBoundingClientRect().height };
});
const choisirC = (p: Page, v: string) => p.evaluate((x: string) => { const s = document.querySelector('#wrRCi'); s.value = x; s.dispatchEvent(new Event('change', { bubbles: true })); }, v);
/** Ses caméras, telles que l'écran de la maison les reçoit (sa session), changées pour l'essai : ce que lit la pose (`undefined` : rien de lisible). */
const camerasLues = (p: Page, noms: () => string[] | undefined) => p.route(/\/api\/maison\/etat/, async (r) => { const rep = await r.fetch(), j = await rep.json(); const n = noms(); if (n) j.cameras = n; else delete j.cameras; await r.fulfill({ response: rep, json: j }); });
const AJOUTER = '#feTiroir button[aria-label="Ajouter Caméra"]';
const imageDe = (p: Page, id: string) => p.evaluate((s: string) => document.querySelector(`${s} img.wsc-img`)?.getAttribute('src') ?? '', carteC(id));
const aSonImage = (s: string) => /^blob:/.test(document.querySelector(`${s} img.wsc-img`)?.getAttribute('src') ?? '');

for (const largeur of [1280, 390] as const) {
  test(`navigateur, ${largeur} px : poser « Caméra » avec trois caméras — « Régler » s'ouvre aussitôt sur le choix ; choisir ; annuler laisse « Choisir une caméra », qui rouvre « Régler »`, { skip: sansNav }, async () => {
    const va = valhallaOf()!;
    assert.equal((await va.act('himinbjorg', 'ajouter', { nom: 'Cam C', adresse: 'rtsp://camera-c.invalid/flux', mouvement: false })).ok, true);
    await regler(true);
    const { ctx, page: p, erreurs, images } = await ouvrir(largeur, false);
    try {
      const avant = await cartesC(p);
      await modifierC(p); await tiroirC(p);
      // Dans le groupe de la maison (la maquette la range dans « Maison »), pour lui.
      assert.equal(await p.evaluate(() => { const b = document.querySelector('#feTiroir button[aria-label="Ajouter Caméra"]'); let h = b?.closest('.fe-it')?.previousElementSibling; while (h && h.tagName !== 'H3') h = h.previousElementSibling; return /^Maison · /.test(h?.textContent ?? ''); }), true, 'rangée avec la maison');
      await p.click(AJOUTER);
      await p.waitForSelector('dialog.wr-regler[open] #wrRCi', { timeout: 15000 });
      let a = (await choixC(p))!;
      assert.equal(a.label, 'La caméra montrée');
      await attendreC(p, () => document.activeElement?.id === 'wrRCi', '');
      assert.deepEqual(a.valeurs, ['', 'camera:Cam A', `camera:${PIEGE}`, 'camera:Cam C'], 'ses trois caméras, rien d\'autre');
      assert.deepEqual(a.textes.slice(1), ['Cam A', PIEGE, 'Cam C'], 'par leur nom, tel qu\'il les a nommées');
      assert.equal(a.deborde, false); assert.ok(a.haut >= 44 - 0.5, 'le choix se touche sur 44 px');
      assert.equal(await p.evaluate(() => Boolean(window.__pirate)), false, 'un nom piégé reste du texte');
      const apres = await cartesC(p); assert.deepEqual(apres.slice(0, -1), avant, 'posée à la fin'); const une = apres[apres.length - 1];
      await choisirC(p, 'camera:Cam C'); a = (await choixC(p))!; assert.equal(a.propose, 'Cam C', 'le titre proposé suit le choix');
      await cliquerC(p, 'dialog.wr-regler button', 'Valider'); await attendreC(p, () => !document.querySelector('dialog.wr-regler[open]'), '');
      // Une seconde, et « Annuler » : la carte dit quoi faire, son bouton rouvre « Régler » (au clavier aussi).
      await tiroirC(p); await p.click(AJOUTER);
      await p.waitForSelector('dialog.wr-regler[open] #wrRCi', { timeout: 15000 });
      const deux = (await cartesC(p)).slice(-1)[0]; assert.notEqual(deux, une);
      await cliquerC(p, 'dialog.wr-regler button', 'Annuler'); await attendreC(p, () => !document.querySelector('dialog.wr-regler[open]'), '');
      const sel = `${carteC(deux)} .wsc [data-action=choisir]`;
      await p.waitForSelector(sel, { timeout: 10000 });
      assert.equal(await p.evaluate((s: string) => document.querySelector(s).textContent, sel), 'Choisir une caméra');
      assert.match(await p.evaluate((s: string) => document.querySelector(`${s} .wsc`).textContent, carteC(deux)), /Aucune caméra choisie/);
      const t = await p.evaluate((s: string) => { const n = document.querySelector(s); return [n.offsetWidth, n.offsetHeight]; }, sel); assert.ok(t[0] >= 44 && t[1] >= 44, `44 px (${t})`);
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, 'rien ne déborde');
      await attendreC(p, (s: string) => !document.querySelector(s)?.closest('.fe-w')?.classList.contains('fe-pop'), sel);
      await p.evaluate((s: string) => document.querySelector(s).scrollIntoView({ block: 'center' }), sel); await p.waitForTimeout(300);
      assert.equal(await p.evaluate((s: string) => { const b = document.querySelector(s), r = b.getBoundingClientRect(), n = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return n === b ? '' : String(n?.className ?? n); }, sel), '', '« Choisir une caméra » reçoit l\'appui à son point, en mode « Modifier »');
      await p.evaluate((s: string) => document.querySelector(s).focus(), sel); await p.keyboard.press('Enter');
      await p.waitForSelector('dialog.wr-regler[open] #wrRCi');
      a = (await choixC(p))!; assert.deepEqual(a.valeurs, ['', 'camera:Cam A', `camera:${PIEGE}`, 'camera:Cam C'], 'la même liste');
      await p.keyboard.press('Escape'); await attendreC(p, () => !document.querySelector('dialog.wr-regler[open]'), '');
      assert.equal(await p.evaluate((s: string) => Boolean(document.activeElement?.closest(s)), carteC(deux)), true, 'le focus revient sur la carte');
      assert.deepEqual(images, [], 'en mode « Modifier », aucune image demandée');
      // « Terminé » : la première montre la vraie image de la caméra choisie ; la seconde reste « pas encore choisie ».
      await cliquerC(p, '#fenetre button', 'Terminé');
      await attendreC(p, aSonImage, carteC(une));
      assert.ok(images.length >= 1 && images.every((u) => new URL(u).searchParams.get('nom') === 'Cam C'), 'l\'image demandée est celle de la caméra choisie');
      await p.waitForSelector(`${carteC(deux)} .wsc [data-action=choisir]`);
      assert.deepEqual(ciblesC([une, deux]), ['camera:Cam C', undefined]);
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/camera-pose-trois-${largeur}.png`, fullPage: true });
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); await va.act('himinbjorg', 'retirer', { camera: 'Cam C' }); await regler(true); }
  });

  test(`navigateur, ${largeur} px : poser « Caméra » avec une seule caméra — prise d'office (au bouton, deux appuis rapides, au glisser), la carte montre son image ; sans aucune, rien n'est posé et le tiroir le dit`, { skip: sansNav }, async () => {
    await regler(true);
    const { ctx, page: p, erreurs, images } = await ouvrir(largeur, false);
    try {
      let lues: string[] | undefined = ['Cam A'];
      await camerasLues(p, () => lues);
      const avant = await cartesC(p);
      await modifierC(p); await tiroirC(p);
      await p.dblclick(AJOUTER);
      await attendreC(p, (n: any) => document.querySelectorAll('#feGrid > .fe-w').length === Number(n), String(avant.length + 1));
      await p.waitForTimeout(600);
      assert.equal((await cartesC(p)).length, avant.length + 1, 'deux appuis rapides : un seul widget');
      assert.equal(await p.evaluate(() => Boolean(document.querySelector('dialog.wr-regler[open]'))), false, 'aucun choix à faire : « Régler » ne s\'ouvre pas');
      const une = (await cartesC(p)).slice(-1)[0];
      // Au glisser : refaite d'après sa déclaration (une cible glissée d'ailleurs n'est jamais reprise).
      await p.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/odin-module', JSON.stringify({ kind: 'maison_camera', cible: 'camera:Inconnue', c: 12 })); document.querySelector('#feGrid').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); });
      await attendreC(p, (n: any) => document.querySelectorAll('#feGrid > .fe-w').length === Number(n), String(avant.length + 2));
      const glissee = (await cartesC(p)).slice(-1)[0];
      // Aucune caméra : rien n'est posé, la ligne du tiroir le dit ; rien de lisible : aussi.
      for (const [l, mot] of [[[], 'Aucune caméra dans Odin'], [undefined, 'ne lit pas tes caméras']] as const) {
        lues = l === undefined ? undefined : [...l];
        await tiroirC(p); await p.click(AJOUTER);
        await attendreC(p, (m: string) => ([...document.querySelectorAll('#feTiroir .fe-it')].find((n: any) => n.querySelector('b')?.textContent === 'Caméra')?.textContent ?? '').includes(m), mot);
        assert.equal((await cartesC(p)).length, avant.length + 2, 'rien de posé');
        assert.equal(await p.evaluate(() => Boolean(document.querySelector('#feTiroir.open'))), true, 'le tiroir reste ouvert');
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 || document.querySelector('#feTiroir').scrollWidth > document.querySelector('#feTiroir').clientWidth + 1), false, 'rien ne déborde');
        await p.keyboard.press('Escape'); await attendreC(p, () => !document.querySelector('#feTiroir.open'), '');
      }
      assert.deepEqual(images, [], 'en mode « Modifier », aucune image demandée');
      await cliquerC(p, '#fenetre button', 'Terminé');
      for (const id of [une, glissee]) await attendreC(p, aSonImage, carteC(id));
      assert.deepEqual(ciblesC([une, glissee]), ['camera:Cam A', 'camera:Cam A'], 'l\'unique caméra, prise d\'office');
      assert.equal(images.length, 1, 'deux cartes de la même caméra : une seule prise');
      assert.equal(await imageDe(p, une), await imageDe(p, glissee), 'la même image');
      assert.doesNotMatch(await p.evaluate((s: string) => document.querySelector(s).textContent, carteC(une)), /direct/i);
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/camera-pose-une-${largeur}.png`, fullPage: true });
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); await regler(true); }
  });
}

test('navigateur, 1280 px : dix cartes de la même caméra — une seule prise par période ; une carte qui vient à l\'écran reçoit la même image, sans nouvelle prise', { skip: sansNav }, async () => {
  const ids = Array.from({ length: 10 }, (_, i) => `d39b003${i}`);
  await rangerF(AVEC_CAMS(ids.map((id) => CAM(id, 'camera:Cam A'))));
  assert.deepEqual(ciblesC(ids), ids.map(() => 'camera:Cam A'));
  const { ctx, page: p, erreurs, images } = await ouvrir(1280, false);
  try {
    await attendreC(p, aSonImage, carteC(ids[0]));
    await p.waitForTimeout(4500);
    assert.equal(images.length, 1, `une seule prise (${images.length})`);
    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(4500);
    assert.equal(images.length, 1, 'une carte venue à l\'écran ne refait pas de prise pendant la période');
    const vues = await p.evaluate((l: string[]) => l.map((id) => { const c = document.querySelector(`#feGrid .fe-w[data-id="${id}"]`), r = c.getBoundingClientRect(); return { a: r.bottom > 0 && r.top < window.innerHeight, src: c.querySelector('img.wsc-img')?.getAttribute('src') ?? '' }; }), ids);
    const src = vues.find((x) => x.src)?.src ?? '';
    assert.ok(src.startsWith('blob:'));
    for (const x of vues.filter((y) => y.a)) assert.equal(x.src, src, 'chaque carte à l\'écran montre la même image');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); await regler(true); }
});

for (const largeur of [320, 768, 1920] as const) {
  test(`navigateur, ${largeur} px : « Caméra » à sa plus petite taille (3 × 2), choisie ou pas encore : rien ne sort de la carte, le bouton se touche sur 44 px`, { skip: sansNav }, async () => {
    await rangerF(AVEC_CAMS([{ ...CAM('d39b0040'), c: 3, r: 2 }, { ...CAM('d39b0041', 'camera:Cam A'), c: 3, r: 2 }]));
    const { ctx, page: p, erreurs } = await ouvrir(largeur, false);
    try {
      await p.waitForSelector(`${carteC('d39b0040')} .wsc [data-action=choisir]`, { timeout: 20000 });
      // Hors de l'écran, rien n'est demandé : la carte est d'abord amenée à l'écran.
      await p.evaluate((s: string) => document.querySelector(s).scrollIntoView({ block: 'center' }), carteC('d39b0041'));
      await attendreC(p, aSonImage, carteC('d39b0041'));
      await pose(p);
      for (const id of ['d39b0040', 'd39b0041']) {
        const a = (await mesure(p, `#feGrid > .fe-w[data-id="${id}"]`))!;
        assert.equal(a.deborde, false, `${id} : rien ne déborde de la page`); assert.deepEqual(a.dehors, [], `${id} : reste dans sa carte`);
        assert.deepEqual(a.petits, [], `${id} : cibles de 44 px`); assert.deepEqual(a.boutonsCoupes, [], `${id} : le bouton n'est pas coupé`);
      }
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/camera-mini-${largeur}.png`, fullPage: true });
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); await regler(true); }
  });
}

// Une image en portrait (9:16), servie à la place de la route, pour l'essai seulement.
const PORTRAIT = { type: 'image/svg+xml', corps: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160" fill="#7a8"/></svg>') };
const boitesC = (p: Page, id: string) => p.evaluate((s: string) => { const c = document.querySelector(s), i = c?.querySelector('img.wsc-img'), d = c?.querySelector('.wsc-dit'), w = c?.querySelector('.wsc'); if (!c || !i || !d || !w) return null; const r = (n: any) => { const b = n.getBoundingClientRect(); return { t: b.top, b: b.bottom, h: b.height, w: b.width }; }; return { carte: r(c), img: r(i), dit: r(d), wsc: r(w), vue: window.innerHeight, ditVu: d.getClientRects().length > 0 && getComputedStyle(d).visibility !== 'hidden' && d.textContent.length > 0 }; }, carteC(id));

for (const largeur of [390, 320] as const) {
  test(`navigateur, ${largeur} px : une image en portrait n'étire pas la carte au-delà de l'écran (le cadre est borné, l'image garde ses proportions)`, { skip: sansNav }, async () => {
    await rangerF(AVEC_CAMS([CAM('d39b0050', 'camera:Cam A')]));
    const { ctx, page: p, erreurs } = await ouvrir(largeur, false, FORCE, PORTRAIT);
    try {
      await p.evaluate((s: string) => document.querySelector(s).scrollIntoView({ block: 'center' }), carteC('d39b0050'));
      await attendreC(p, aSonImage, carteC('d39b0050'));
      await attendreC(p, (s: string) => (document.querySelector(`${s} img.wsc-img`)?.naturalHeight ?? 0) > 0, carteC('d39b0050'));
      await pose(p);
      const b = (await boitesC(p, 'd39b0050'))!;
      assert.ok(b.img.h <= b.vue * 0.6 + 1, `l'image tient dans l'écran (${Math.round(b.img.h)} px pour ${b.vue})`);
      assert.ok(b.carte.h <= b.vue * 0.8, `la carte tient dans l'écran (${Math.round(b.carte.h)} px pour ${b.vue})`);
      assert.equal(await p.evaluate((s: string) => getComputedStyle(document.querySelector(`${s} img.wsc-img`)).objectFit, carteC('d39b0050')), 'contain', 'ni étirée, ni coupée');
      const a = (await mesure(p, carteC('d39b0050')))!; assert.equal(a.deborde, false); assert.deepEqual(a.dehors, []);
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/camera-portrait-${largeur}.png`, fullPage: true });
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); await regler(true); }
  });
}

for (const largeur of [768, 1280, 1920] as const) {
  test(`navigateur, ${largeur} px : « Caméra » en 3 × 2 — l'image prend toute la hauteur de la carte, la phrase (l'heure de la prise) reste lue, par-dessus, dans la carte`, { skip: sansNav }, async () => {
    await rangerF(AVEC_CAMS([{ ...CAM('d39b0060', 'camera:Cam A'), c: 3, r: 2 }]));
    const { ctx, page: p, erreurs } = await ouvrir(largeur, false);
    try {
      await p.evaluate((s: string) => document.querySelector(s).scrollIntoView({ block: 'center' }), carteC('d39b0060'));
      await attendreC(p, aSonImage, carteC('d39b0060'));
      await attendreC(p, (s: string) => /\d/.test(document.querySelector(`${s} .wsc-dit`)?.textContent ?? ''), carteC('d39b0060'));
      await pose(p);
      const b = (await boitesC(p, 'd39b0060'))!;
      assert.ok(b.img.h >= b.wsc.h - 1, `l'image a toute la hauteur du corps (${Math.round(b.img.h)} sur ${Math.round(b.wsc.h)})`);
      assert.equal(b.ditVu, true, 'l\'heure de la prise reste dite');
      assert.ok(b.dit.t >= b.carte.t && b.dit.b <= b.carte.b + 1, 'la phrase reste dans la carte');
      const a = (await mesure(p, carteC('d39b0060')))!; assert.equal(a.deborde, false); assert.deepEqual(a.dehors, []); assert.deepEqual(a.coupesSansBulle, []);
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/camera-3x2-${largeur}.png`, fullPage: true });
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); await regler(true); }
  });
}

test('navigateur, 1280 px : une carte « Caméra » sous le pli ne demande rien ; amenée à l\'écran, une prise ; hors « Modifier », « Choisir une caméra » ouvre « Régler » et le focus revient', { skip: sansNav }, async () => {
  // Des cartes « pas encore choisies » (aucune demande) devant, pour pousser la carte choisie sous le pli.
  const devant = Array.from({ length: 12 }, (_, i) => CAM(`d39c00${String(i).padStart(2, '0')}`));
  await rangerF(AVEC_CAMS([...devant, CAM('d39b0080', 'camera:Cam A')]));
  const { ctx, page: p, erreurs, images } = await ouvrir(1280, false);
  try {
    await p.waitForSelector(`${carteC('d39b0080')} .wsc-cam`, { timeout: 20000 });
    await p.waitForTimeout(4500);
    assert.ok(await p.evaluate((s: string) => document.querySelector(s).getBoundingClientRect().top >= window.innerHeight, carteC('d39b0080')), 'la carte est bien sous le pli');
    assert.deepEqual(images, [], 'sous le pli : aucune image demandée');
    await p.evaluate((s: string) => document.querySelector(s).scrollIntoView({ block: 'center' }), carteC('d39b0080'));
    await attendreC(p, aSonImage, carteC('d39b0080'));
    assert.equal(images.length, 1, 'amenée à l\'écran : une prise');
    // Hors « Modifier » : le bouton d'une carte pas encore choisie ouvre « Régler » sur le choix, au vrai clic ; le focus revient sur sa carte.
    assert.equal(await p.evaluate(() => Boolean(document.querySelector('.fe-edit'))), false, 'hors du mode « Modifier »');
    const sel = `${carteC(devant[0].id)} .wsc [data-action=choisir]`;
    await p.evaluate((s: string) => document.querySelector(s).scrollIntoView({ block: 'center' }), sel); await p.waitForTimeout(300);
    await p.click(sel);
    await p.waitForSelector('dialog.wr-regler[open] #wrRCi', { timeout: 10000 });
    assert.deepEqual((await choixC(p))!.valeurs, ['', 'camera:Cam A', `camera:${PIEGE}`]);
    await p.keyboard.press('Escape'); await attendreC(p, () => !document.querySelector('dialog.wr-regler[open]'), '');
    await attendreC(p, (s: string) => Boolean(document.activeElement?.closest(s)), carteC(devant[0].id));
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); await regler(true); }
});
