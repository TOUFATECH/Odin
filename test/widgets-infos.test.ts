// Les widgets « Infos » de l'accueil (maquette validée « Accueil ») : l'heure en petit chiffre, l'horloge (l'heure en
// grand, la date, la semaine), la météo en petit chiffre, le nombre d'alertes pas encore vues ; et le point d'accroche
// commun qui laisse le fichier d'une famille dessiner et poser ses sortes sans retoucher la fenêtre.
// Prouvé ici :
// - le choix « sorte ou style » : l'horloge est un style de la sorte « heure » (pas de jumeau) ; les trois petits
//   chiffres sont des sortes (un petit chiffre fait 2 × 1 et n'a pas de « ⋯ ») ; une fenêtre d'hier se relit telle quelle ;
// - l'heure et la date suivent le fuseau d'Odin, jamais celui de l'appareil ; la langue est celle de la page, 12 ou
//   24 h comme Odin est réglé ; lieu non choisi, fuseau inconnu : l'état « vide », jamais une heure supposée ;
// - la météo ancienne est marquée ancienne, avec l'heure de sa lecture ; jamais un chiffre inventé ;
// - le compte d'alertes suit « vu » ; zéro alerte : un état calme ; qui voit quoi (un membre, une tablette « maison »,
//   la clé d'accès), sur un vrai Odin jetable ;
// - le registre des rendus de famille, quel que soit l'ordre de chargement ; le tiroir propose les quatre et les pose
//   aux tailles de la maquette ; une sorte inconnue ne casse ni l'accueil ni l'écran de la maison ;
// - un petit chiffre garde sa taille dans chaque état (croquis validé des cinq états) : sans donnée, son libellé,
//   l'icône de l'état et deux ou trois mots, la phrase entière pour qui ne voit pas l'écran ; ni en-tête ni bouton ;
// - le nom d'une ligne du tiroir peut différer du titre de la carte (« Météo (petite) » dans le tiroir, « Météo » sur
//   la carte) ; sur une carte étroite, l'icône rétrécit et ne cède sa place que si la valeur en a besoin ;
// - dans un vrai navigateur (s'il y en a un) : 1280, 768 et 390 px.
// Aucun fuseau n'est écrit ici : ils sont pris dans la liste du moteur, loin de celui de la machine.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { TAILLE_SORTE, cleanLayout, type FPage, type Layout, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { auNomDe } from '../src/valhalla/sso/acces.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { SORTES_INFOS } from '../src/valhalla/widgets/infos.ts';
import { cleOuverture, copiable, donneeWidget, publicDe, servieALaMaison, sorteDe, sortesPosables, type EtatWidget, type Lecteur, type SourceWidget } from '../src/valhalla/widgets/index.ts';
import { sourceOdin } from '../src/valhalla/widgets/source.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

/** Un fichier du dépôt, ou rien s'il n'existe pas encore (chaque essai échoue alors pour sa propre raison). */
const lire = (f: string) => { try { return readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); } catch { return ''; } };
const FE = lire('src/web/fenetre.js'), MAISON = lire('src/web/maison.js'), RENDU = lire('src/web/pages/widgets-rendu.js'), INFOS = lire('src/web/pages/widgets-infos.js');
const FAMILLE_TS = lire('src/valhalla/widgets/infos.ts'), SOURCE_TS = lire('src/valhalla/widgets/source.ts');
const copie = <X>(x: X): X => JSON.parse(JSON.stringify(x));
const PETITES = ['heure_petite', 'meteo_petite', 'alertes'];
const IDS = ['gladsheim', 'midgard', 'vordr', 'var', 'forseti'];

// ------------------------------------------------------------------ deux fuseaux, pris dans la liste du moteur

const MAINTENANT = new Date();
/** Le décalage d'un fuseau à un instant, en minutes, lu par le moteur. */
function decalageMin(fuseau: string, d: Date): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: fuseau, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(d).map((x) => [x.type, x.value]));
  const minute = Math.floor(d.getTime() / 60000) * 60000;
  return Math.round((Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - minute) / 60000);
}
const ZONES: string[] = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
const ICI = Intl.DateTimeFormat().resolvedOptions().timeZone;
/** Le premier fuseau à une heure ronde, à quatre heures au moins de chacun de ceux-là. */
const loin = (de: string[]): string => ZONES.find((z) => { const o = decalageMin(z, MAINTENANT); return o % 60 === 0 && de.every((x) => Math.abs(o - decalageMin(x, MAINTENANT)) >= 240); })!;
const FUSEAU_ODIN = loin([ICI]), FUSEAU_APPAREIL = loin([ICI, FUSEAU_ODIN]);
const heureDans = (fuseau: string | undefined, d: Date, langue = 'fr', h12 = false) => new Intl.DateTimeFormat(langue, { ...(fuseau ? { timeZone: fuseau } : {}), hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', ...(h12 ? { hour12: true } : { hourCycle: 'h23' }) }).format(d);

// ------------------------------------------------------------------ les scripts de la page, sans navigateur

interface Declaration { sorte: string; style: string; titre: string; nom: string; quoi: string; symbole: string; appli: string; petit: boolean; proprio: boolean; vides: string[]; w: Record<string, unknown> }
interface Rendu {
  TEXTES: { raisons: Record<string, Record<string, [unknown, string]>>; courts: Record<string, string> }; STYLES: Record<string, Array<[string, string]>>;
  rendu(kind: unknown, style?: unknown): Declaration | undefined; posables(o?: unknown): Declaration[];
  dessineElleMeme(rf: unknown, d: unknown): boolean; dessiner(rf: unknown, e: unknown, o: unknown): unknown; sous(rf: unknown, e: unknown, o: unknown): string;
  etatPetit(d: unknown, o?: unknown): unknown;
  decrire(e: unknown, o?: Record<string, unknown>): { etat: string; raison: string; donnee: boolean; texte: string; bouton: unknown; pastille: string };
}
interface Heure { texte: string; segments: Array<{ v: string; petit: boolean }>; jour: string; semaine: number; decalage: string }
interface Infos { TEXTES: Record<string, Record<string, unknown>>; CSS: string; heureDe(l: unknown, d?: Date, langue?: string): Heure | null; semaineDe(a: number, m: number, j: number): number; cielDe(code: unknown): string }
/** Les scripts chargés sur une fausse fenêtre SANS document, dans l'ordre donné (chacun dans son propre contexte). */
function page(fichiers: string[]): { OdinWidgetsRendu?: Rendu; OdinWidgetsInfos?: Infos; OdinWidgetsFamilles?: unknown[] } {
  const win: Record<string, unknown> = {};
  for (const src of fichiers) vm.runInNewContext(src, { window: win });
  return win;
}
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));
/** Le texte entier de la fonction `nom` de fenetre.js (définie une seule fois ; chaînes et commentaires sautés). */
function fonction(nom: string, src = FE): string {
  const m = [...src.matchAll(new RegExp(`(?:async\\s+)?function\\s+${nom}\\s*\\(`, 'g'))];
  assert.equal(m.length, 1, `la fonction ${nom} existe, une seule fois`);
  const i = m[0].index ?? 0, corps = src.indexOf('{', fermer(src, src.indexOf('(', i)));
  return src.slice(i, fermer(src, corps) + 1);
}
function fermer(s: string, i: number): number {
  const ferme = ({ '(': ')', '{': '}', '[': ']' } as Record<string, string>)[s[i]];
  let n = 0;
  for (let j = i; j < s.length;) {
    const c = s[j];
    if (c === '\'' || c === '"' || c === '`') { const q = c; j++; while (j < s.length && s[j] !== q) { if (s[j] === '\\') j++; j++; } j++; continue; }
    if (c === '/' && s[j + 1] === '/') { j = s.indexOf('\n', j); if (j < 0) return s.length - 1; continue; }
    if (c === '/' && s[j + 1] === '*') { j = s.indexOf('*/', j) + 2; continue; }
    if (c === s[i]) n++; else if (c === ferme) { n--; if (n === 0) return j; }
    j++;
  }
  return s.length - 1;
}

// ------------------------------------------------------------------ une fausse source (aucun Odin)

const W = (kind: string, o: Record<string, unknown> = {}): Widget => ({ id: 'c2800000', kind, w: 1, c: 2, r: 1, ...o }) as unknown as Widget;
const LUI: Lecteur = { qui: 'proprietaire', ecran: 'accueil' }, TABLETTE: Lecteur = { qui: 'maison', ecran: 'maison' };
const membre = (droits: string[], ouverts: string[] = []): Lecteur => ({ qui: 'membre', ecran: 'accueil', peutLire: (a) => droits.includes(a), ouverts: new Set(ouverts) });
function fausse(o: { lieu?: boolean; fuseau?: string; heure12?: boolean; meteo?: 'ok' | 'ancien' | 'rien'; donnee?: Record<string, unknown>; alertes?: string[]; sans?: string[] } = {}) {
  const lus: string[] = [];
  const applis: Record<string, { name: string; family: string }> = { gladsheim: { name: 'Appli du lieu', family: 'Maison' }, forseti: { name: 'Appli des alertes', family: 'Sécurité' }, midgard: { name: 'Appli A', family: 'Maison' }, vordr: { name: 'Appli B', family: 'Machines' } };
  const src: SourceWidget = {
    appli: (id) => (applis[id] && !(o.sans ?? []).includes(id) ? { id, ...applis[id] } : undefined),
    vue: async (id) => { lus.push(`vue:${id}`); return null; },
    action: () => undefined,
    meteo: async () => { lus.push('meteo'); return o.meteo === 'rien' ? undefined : { donnee: o.donnee ?? { place: 'Lieu A', temp: 21, code: 61, unites: 'metrique', hi: 25, lo: 19, hours: [{ t: '10:00', temp: 22 }] }, at: 1000, ancien: o.meteo === 'ancien', motif: o.meteo === 'ancien' ? 'coupé' : '' }; },
    lieu: () => ({ choisi: o.lieu !== false, nom: 'Lieu A', fuseau: o.fuseau ?? FUSEAU_ODIN, heure12: o.heure12 === true }),
    maintenant: () => 2000,
    alertesNonVues: () => { lus.push('alertes'); return (o.alertes ?? []).map((appli) => ({ appli })); },
  } as SourceWidget;
  return { src, lus };
}
const etat = async (w: Widget, l: Lecteur, src: SourceWidget) => (await donneeWidget(w, l, src)) as EtatWidget & { raison?: string; donnee?: Record<string, unknown>; at?: number; appli?: string };

// ------------------------------------------------------------------ sorte ou style

test('le choix : l\'horloge est un style de « heure » (pas de jumeau) ; les trois petits chiffres sont des sortes, 2 × 1', () => {
  assert.equal(sorteDe('horloge'), undefined, 'pas de sorte jumelle de « heure »');
  assert.deepEqual([...sorteDe('heure')!.styles], ['simple', 'horloge'], 'l\'horloge : un style de la sorte « heure » ; le style de départ ne change pas');
  assert.deepEqual([...sorteDe('meteo')!.styles], ['simple'], 'la météo d\'aujourd\'hui ne change pas');
  for (const k of PETITES) {
    const s = sorteDe(k)!;
    assert.ok(s, `${k} est déclarée`); assert.equal(s.famille, 'infos'); assert.equal(s.posable, true); assert.deepEqual([...s.styles], ['simple']);
    assert.deepEqual(TAILLE_SORTE[k as keyof typeof TAILLE_SORTE], { mini: [2, 1], r: 1 }, `${k} : le petit chiffre de la maquette, 2 × 1`);
    assert.equal(s.accueilSeul, undefined); assert.equal(s.fixe, undefined); assert.equal(copiable(k), true); assert.equal(servieALaMaison(k), true);
  }
  for (const k of PETITES) { assert.ok(SORTES_INFOS.some((x) => x.id === k), `${k} : rangée dans le fichier de sa famille`); assert.ok(sortesPosables().some((x) => x.id === k), `${k} : Hestia l'accepte`); }
  // Qui peut les voir, au plus : l'heure et la météo en petit comme « heure » et « meteo » ; les alertes, jamais une tablette.
  assert.equal(publicDe(sorteDe('heure_petite')!), publicDe(sorteDe('heure')!)); assert.equal(publicDe(sorteDe('meteo_petite')!), publicDe(sorteDe('meteo')!));
  assert.deepEqual(sorteDe('heure_petite')!.applis, sorteDe('heure')!.applis); assert.deepEqual(sorteDe('meteo_petite')!.applis, sorteDe('meteo')!.applis);
  assert.equal(publicDe(sorteDe('alertes')!), 'membre'); assert.deepEqual(sorteDe('alertes')!.applis, ['forseti'], 'les alertes se lisent sous l\'appli des alertes (vie privée)');
  // Les tailles de la maquette passent par Hestia telles quelles ; le style de l'horloge est gardé, un style inconnu jeté.
  const un = (w: unknown) => cleanLayout({ pages: [{ name: 'P', widgets: [w] }] }, IDS).pages[0].widgets[0] as Widget | undefined;
  for (const k of PETITES) assert.deepEqual(un({ id: 'c2800001', kind: k, w: 1, c: 2, r: 1, pr: 1, module: 'midgard', section: 'x', action: 'y' }), { id: 'c2800001', kind: k, w: 1, c: 2, r: 1, pr: 1 } as unknown as Widget, `${k} : 2 × 1, aucune appli gardée`);
  assert.deepEqual(un({ id: 'c2800004', kind: 'heure', style: 'horloge', w: 1, c: 3, r: 2 }), { id: 'c2800004', kind: 'heure', w: 1, c: 3, r: 2, style: 'horloge' } as unknown as Widget);
  assert.equal('style' in un({ kind: 'heure', style: 'chiffre' })!, false, 'un style inconnu est jeté');
  assert.equal(un({ kind: 'heure_petite', label: 'x'.repeat(90) })?.label?.length, 40);
});

test('une fenêtre d\'hier se relit telle quelle : « heure », « meteo » et « site » ne changent ni de forme ni de donnée', async () => {
  const hier = { pages: [{ id: 'b2800009', name: 'Maison', maison: true, widgets: [
    { id: 'c2800011', kind: 'heure', w: 1, c: 4, r: 2 }, { id: 'c2800012', kind: 'meteo', w: 2, c: 8, r: 3, label: 'Dehors' }, { id: 'c2800013', kind: 'site', w: 1, c: 4, r: 2, module: 'vordr', label: 'Mon site' },
    { id: 'c2800014', kind: 'chiffres', w: 1, c: 4, r: 2, module: 'midgard' },
  ] }] };
  const une = cleanLayout(copie(hier), IDS);
  assert.deepEqual(une, hier as unknown as Layout, 'rien d\'ajouté, rien de retiré');
  assert.deepEqual(cleanLayout(copie(une), IDS), une);
  assert.ok(!JSON.stringify(une).includes('style'), 'aucun style écrit sur un widget d\'hier');
  // Leur donnée : la même qu'hier (le style de départ de « heure » ne demande pas de fuseau).
  const { src } = fausse({ fuseau: '' });
  assert.deepEqual(await etat(W('heure'), LUI, src), { etat: 'ok', at: 2000, donnee: { lieu: 'Lieu A', fuseau: '', heure12: false } });
  const m = await etat(W('meteo'), LUI, fausse().src);
  assert.equal(m.etat, 'ok'); assert.equal(m.at, 1000); assert.deepEqual(Object.keys(m.donnee!).sort(), ['code', 'hi', 'hours', 'lo', 'place', 'temp', 'unites'], 'la météo d\'aujourd\'hui garde toute sa donnée');
  // À l'écran : un widget « heure » sans style, « meteo », « site » n'ont pas de rendu déclaré (leur dessin d'aujourd'hui reste).
  const R = page([INFOS, RENDU]).OdinWidgetsRendu;
  assert.ok(R && typeof R.rendu === 'function', 'le registre des rendus de famille existe');
  for (const k of ['heure', 'meteo', 'site', 'chiffres', 'section', 'bouton', 'a_faire']) assert.equal(R.rendu(k), undefined, `${k} : son dessin d'aujourd'hui`);
  assert.equal(R.rendu('heure', 'simple'), undefined);
});

// ------------------------------------------------------------------ l'heure : le fuseau d'Odin

test('l\'heure côté serveur : lieu non choisi → « vide » ; fuseau inconnu → « vide » pour les dessins neufs ; sinon le lieu, le fuseau et 12 ou 24 h d\'Odin', async () => {
  for (const w of [W('heure_petite'), W('heure', { style: 'horloge', c: 3, r: 2 })]) {
    const nom = `${w.kind}${(w as { style?: string }).style ? ' (horloge)' : ''}`;
    assert.deepEqual(await etat(w, LUI, fausse({ lieu: false }).src), { etat: 'vide', raison: 'lieu_non_choisi' }, `${nom} : jamais une heure supposée`);
    assert.deepEqual(await etat(w, LUI, fausse({ fuseau: '' }).src), { etat: 'vide', raison: 'fuseau_inconnu' }, `${nom} : sans fuseau, jamais l'heure de l'appareil`);
    assert.deepEqual(await etat(w, LUI, fausse({ heure12: true }).src), { etat: 'ok', at: 2000, donnee: { lieu: 'Lieu A', fuseau: FUSEAU_ODIN, heure12: true } }, nom);
    // Comme « heure » : Hestia désactivée, rien n'est lu ; un membre sans le droit sur Hestia, refusé ; une tablette, permise.
    assert.deepEqual(await etat(w, LUI, fausse({ sans: ['gladsheim'] }).src), { etat: 'source_absente', raison: 'appli_absente' });
    assert.deepEqual(await etat(w, membre([]), fausse().src), { etat: 'refuse', raison: 'appli_fermee', appli: 'gladsheim' });
    assert.equal((await etat(w, membre(['gladsheim']), fausse().src)).etat, 'ok'); assert.equal((await etat(w, TABLETTE, fausse().src)).etat, 'ok');
  }
  // Aucune phrase dans la donnée, aucune heure calculée par le serveur : la page la calcule dans le fuseau reçu.
  assert.doesNotMatch(FAMILLE_TS, /toLocale|DateTimeFormat|new Date\(/, 'le fichier de famille ne formate aucune date');
});

test('l\'heure à l\'écran suit le fuseau d\'Odin, pas celui de l\'appareil ; la langue et 12 ou 24 h ne sont pas supposés', () => {
  const I = page([INFOS]).OdinWidgetsInfos;
  assert.ok(I && typeof I.heureDe === 'function', 'widgets-infos.js pose ses calculs sans document');
  const h = I.heureDe({ fuseau: FUSEAU_ODIN, heure12: false }, MAINTENANT, 'fr')!;
  assert.equal(h.texte, heureDans(FUSEAU_ODIN, MAINTENANT), 'l\'heure du fuseau d\'Odin');
  assert.notEqual(h.texte, heureDans(undefined, MAINTENANT), `pas celle de la machine (${ICI})`);
  assert.equal(h.segments.map((x) => x.v).join(''), h.texte); assert.ok(h.segments.every((x) => x.petit === false), 'sur 24 h : pas de matin ni d\'après-midi');
  // L'appareil change de fuseau : rien ne change à l'écran.
  const avant = process.env.TZ;
  try {
    process.env.TZ = FUSEAU_APPAREIL;
    assert.notEqual(heureDans(undefined, MAINTENANT), heureDans(FUSEAU_ODIN, MAINTENANT), 'contrôle : l\'appareil est bien ailleurs');
    assert.deepEqual(ici(I.heureDe({ fuseau: FUSEAU_ODIN, heure12: false }, MAINTENANT, 'fr')), ici(h), 'la même heure, la même date, la même semaine');
  } finally { if (avant === undefined) delete process.env.TZ; else process.env.TZ = avant; }
  // La date et la semaine sont celles du fuseau d'Odin : à minuit là-bas, le jour change là-bas.
  const minuit = new Date(Math.floor(MAINTENANT.getTime() / 86_400_000) * 86_400_000 - decalageMin(FUSEAU_ODIN, MAINTENANT) * 60_000);
  const veille = I.heureDe({ fuseau: FUSEAU_ODIN }, new Date(minuit.getTime() - 60_000), 'fr')!, jour = I.heureDe({ fuseau: FUSEAU_ODIN }, new Date(minuit.getTime() + 60_000), 'fr')!;
  assert.equal(veille.texte, '23:59'); assert.equal(jour.texte, '00:01', 'minuit : 00:01, jamais 24:01'); assert.notEqual(veille.jour, jour.jour, 'le jour change à minuit du fuseau d\'Odin');
  assert.equal(jour.jour, new Intl.DateTimeFormat('fr', { timeZone: FUSEAU_ODIN, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(minuit.getTime() + 60_000)));
  // La langue : celle qu'on lui donne (la page donne la sienne), rien d'écrit en français.
  const en = I.heureDe({ fuseau: FUSEAU_ODIN, heure12: true }, MAINTENANT, 'en')!;
  assert.equal(en.texte, heureDans(FUSEAU_ODIN, MAINTENANT, 'en', true)); assert.match(en.texte, /AM|PM/); assert.equal(en.segments.filter((x) => x.petit).length, 1, 'sur 12 h : le matin ou l\'après-midi, en petit');
  assert.equal(en.jour, new Intl.DateTimeFormat('en', { timeZone: FUSEAU_ODIN, weekday: 'long', day: 'numeric', month: 'long' }).format(MAINTENANT));
  assert.notEqual(en.jour, h.jour, 'la date change avec la langue');
  assert.match(h.decalage, /[+\-−]|^(UTC|GMT)$/, `le décalage du fuseau, lu par le moteur (${h.decalage})`);
  // Sans fuseau, ou avec un fuseau inconnu : rien, jamais l'heure de l'appareil.
  for (const l of [undefined, null, {}, { fuseau: '' }, { fuseau: 'Nulle/Part' }, { fuseau: 42 }]) assert.equal(I.heureDe(l, MAINTENANT, 'fr'), null, JSON.stringify(l));
  assert.doesNotMatch(INFOS, /fr[-_]fr/i, 'aucune langue écrite en dur'); assert.doesNotMatch(INFOS, /timeZone\s*:\s*['"`]/, 'aucun fuseau écrit en dur');
  assert.doesNotMatch(INFOS, /toLocale(Time|Date)?String\(/, 'aucune date formatée sans fuseau');
});

test('la semaine de l\'horloge : le numéro ISO, comparé jour par jour à un autre calcul', () => {
  const I = page([INFOS]).OdinWidgetsInfos;
  assert.ok(I && typeof I.semaineDe === 'function');
  /** Le jeudi de la semaine du jour donne l'année de la semaine ; son rang dans l'année, la semaine. */
  const iso = (a: number, m: number, j: number) => { const d = new Date(Date.UTC(a, m - 1, j)), lundi = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - lundi + 3); return 1 + Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000 / 7); };
  for (let t = Date.UTC(2024, 0, 1); t < Date.UTC(2029, 0, 1); t += 86_400_000) { const d = new Date(t); assert.equal(I.semaineDe(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), d.toISOString().slice(0, 10)); }
  assert.equal(I.semaineDe(2026, 1, 1), 1); assert.equal(I.semaineDe(2027, 1, 1), 53, 'le 1er janvier peut être dans la dernière semaine de l\'année d\'avant'); assert.equal(I.semaineDe(2024, 12, 30), 1);
});

// ------------------------------------------------------------------ la météo en petit

test('la météo en petit : lieu non choisi, pas encore lue, lue, ancienne (avec l\'heure de sa lecture) ; jamais un chiffre inventé', async () => {
  const w = W('meteo_petite');
  const sansLieu = fausse({ lieu: false });
  assert.deepEqual(await etat(w, LUI, sansLieu.src), { etat: 'vide', raison: 'lieu_non_choisi' }); assert.deepEqual(sansLieu.lus, [], 'aucune météo demandée pour un lieu supposé');
  assert.deepEqual(await etat(w, LUI, fausse({ meteo: 'rien' }).src), { etat: 'vide', raison: 'meteo_pas_lue' });
  // Seulement ce que le petit chiffre montre : le lieu, la température, le code du ciel.
  assert.deepEqual(await etat(w, LUI, fausse().src), { etat: 'ok', at: 1000, donnee: { lieu: 'Lieu A', temp: 21, code: 61 } });
  assert.deepEqual(await etat(w, LUI, fausse({ meteo: 'ancien' }).src), { etat: 'ancien', at: 1000, donnee: { lieu: 'Lieu A', temp: 21, code: 61 }, motif: 'coupé' }, 'ancienne : marquée, avec l\'heure de sa lecture');
  // Les unités d'Odin : des degrés Fahrenheit là où Odin est réglé ainsi (le nombre, pas une phrase).
  assert.equal((await etat(w, LUI, fausse({ donnee: { place: 'Lieu A', temp: 20, code: 0, unites: 'imperial' } }).src)).donnee!.temp, 68);
  // Une température absente ou illisible : rien d'affirmé (zéro degré serait un chiffre inventé).
  for (const temp of [undefined, null, '21', Number.NaN, Number.POSITIVE_INFINITY]) assert.deepEqual(await etat(w, LUI, fausse({ donnee: { place: 'Lieu A', temp, code: 0 } }).src), { etat: 'vide', raison: 'meteo_pas_lue' }, String(temp));
  assert.deepEqual((await etat(w, LUI, fausse({ donnee: { place: 'Lieu A', temp: 0, code: 'x' } }).src)).donnee, { lieu: 'Lieu A', temp: 0, code: -1 }, 'zéro degré lu est gardé ; un code illisible : aucun ciel');
  // Comme « meteo » : une tablette la reçoit, un membre a besoin de Hestia, Hestia désactivée : rien.
  assert.equal((await etat(w, TABLETTE, fausse().src)).etat, 'ok'); assert.deepEqual(await etat(w, membre([]), fausse().src), { etat: 'refuse', raison: 'appli_fermee', appli: 'gladsheim' });
  assert.deepEqual(await etat(w, LUI, fausse({ sans: ['gladsheim'] }).src), { etat: 'source_absente', raison: 'appli_absente' });
  // Le ciel à l'écran : une icône d'après le code, jamais un ciel supposé pour un code inconnu.
  const I = page([INFOS]).OdinWidgetsInfos;
  assert.ok(I && typeof I.cielDe === 'function');
  assert.deepEqual([0, 2, 3, 45, 55, 61, 82, 73, 86, 95, 99].map((c) => I.cielDe(c)), ['soleil', 'eclaircie', 'nuage', 'brume', 'pluie', 'pluie', 'pluie', 'neige', 'neige', 'orage', 'orage']);
  for (const c of [-1, 4, 999, Number.NaN, undefined, null, '0', {}]) assert.equal(I.cielDe(c), 'inconnu', String(c));
});

// ------------------------------------------------------------------ les alertes pas encore vues

test('les alertes : zéro → un état calme, sans chiffre ; sinon leur nombre ; qui voit quoi', async () => {
  const w = W('alertes', { id: 'c2800003' });
  assert.deepEqual(await etat(w, LUI, fausse().src), { etat: 'vide', raison: 'aucune_alerte' }, 'zéro alerte : un état calme, pas un chiffre d\'alarme');
  assert.deepEqual(await etat(w, LUI, fausse({ alertes: ['midgard', 'vordr', 'vordr'] }).src), { etat: 'ok', at: 2000, donnee: { nombre: 3 } }, 'le propriétaire : toutes');
  // L'appli des alertes désactivée : rien n'est lu. Une source qui ne sait pas lire les alertes : dit, sans chiffre.
  const eteinte = fausse({ alertes: ['midgard'], sans: ['forseti'] });
  assert.deepEqual(await etat(w, LUI, eteinte.src), { etat: 'source_absente', raison: 'appli_absente' }); assert.deepEqual(eteinte.lus, []);
  const sans = fausse({ alertes: ['midgard'] }); delete (sans.src as { alertesNonVues?: unknown }).alertesNonVues;
  assert.deepEqual(await etat(w, LUI, sans.src), { etat: 'source_absente', raison: 'pas_encore_lu' });
  // Une tablette « maison » : jamais (l'état des applis n'est pas pour un écran au mur), et rien n'est lu pour elle.
  const pour = fausse({ alertes: ['midgard', 'vordr'] });
  assert.deepEqual(await etat(w, TABLETTE, pour.src), { etat: 'refuse', raison: 'pas_pour_une_tablette' });
  assert.deepEqual(await etat(w, { ...TABLETTE, ouverts: new Set([cleOuverture(w, 'forseti')]) }, pour.src), { etat: 'refuse', raison: 'pas_pour_une_tablette' }, 'même « ouvert »');
  // Un membre : il lui faut le droit sur l'appli des alertes ; elle est de la vie privée, donc fermée tant que le
  // propriétaire ne lui a pas ouvert CE widget ; ouvert, il ne compte que les alertes des applis où il a le droit.
  assert.deepEqual(await etat(w, membre(['midgard', 'vordr']), pour.src), { etat: 'refuse', raison: 'appli_fermee', appli: 'forseti' });
  assert.deepEqual(await etat(w, membre(['forseti', 'midgard', 'vordr']), pour.src), { etat: 'refuse', raison: 'vie_privee', appli: 'forseti' });
  assert.deepEqual(pour.lus, [], 'rien n\'est lu pour qui n\'a pas le droit');
  const ouvert = [cleOuverture(w, 'forseti')];
  assert.deepEqual(await etat(w, membre(['forseti', 'midgard'], ouvert), pour.src), { etat: 'ok', at: 2000, donnee: { nombre: 1 } }, 'seulement l\'appli où il a le droit');
  assert.deepEqual(await etat(w, membre(['forseti'], ouvert), pour.src), { etat: 'vide', raison: 'aucune_alerte' }, 'aucune appli à lui : aucune alerte à voir, sans rien dire des autres');
  assert.deepEqual(await etat(w, { qui: 'membre', ecran: 'accueil', ouverts: new Set(ouvert) }, pour.src), { etat: 'refuse', raison: 'appli_fermee', appli: 'forseti' }, 'un droit qu\'on ne peut pas vérifier : fermé');
  assert.deepEqual(await etat({ ...w, id: 'c2800099' } as Widget, membre(['forseti', 'midgard'], ouvert), pour.src), { etat: 'refuse', raison: 'vie_privee', appli: 'forseti' }, 'ouvrir un widget n\'ouvre pas son voisin');
});

test('vrai Odin : le compte d\'alertes suit « vu » (ack), tel que Valhalla le garde ; au nom d\'un membre, pas les alertes de Sphinx des autres appareils', async () => {
  // Le Valhalla du vrai Odin d'essai (pas un second : ses applis sont partagées dans ce processus).
  toutVoir(); const v = valhallaOf()!;
  try {
    const w = W('alertes'), compte = async () => etat(w, LUI, sourceOdin(v));
    assert.deepEqual(await compte(), { etat: 'vide', raison: 'aucune_alerte' }, 'Odin neuf : aucune alerte, aucun chiffre');
    const a = v.alert('midgard', { level: 'haute', title: 'Essai A', key: 'essai-a' }), b = v.alert('vordr', { level: 'info', title: 'Essai B', key: 'essai-b' }), c = v.alert('vordr', { level: 'critique', title: 'Essai C', key: 'essai-c' });
    assert.ok(a && b && c, 'trois alertes levées');
    assert.equal((await compte()).donnee!.nombre, 3, 'toutes les gravités comptent, vues ou non sur la messagerie');
    v.ack([b!.id]);
    assert.equal((await compte()).donnee!.nombre, 2, 'une alerte marquée vue ne compte plus');
    v.ack([b!.id, 'inconnue']); assert.equal((await compte()).donnee!.nombre, 2, 'la marquer deux fois ne change rien');
    v.ack([a!.id, c!.id]);
    assert.deepEqual(await compte(), { etat: 'vide', raison: 'aucune_alerte' }, 'toutes vues : l\'état calme');
    // La même alerte revient (comptée, pas rangée de nouveau) : toujours vue. Une autre : elle compte.
    v.alert('midgard', { level: 'haute', title: 'Essai A', key: 'essai-a' });
    assert.deepEqual(await compte(), { etat: 'vide', raison: 'aucune_alerte' });
    assert.ok(v.alert('midgard', { level: 'moyenne', title: 'Essai D', key: 'essai-d' }));
    assert.equal((await compte()).donnee!.nombre, 1);
    // La source ne rend que l'appli de chaque alerte (ni titre, ni détail) ; une lecture par source.
    const src = sourceOdin(v);
    assert.deepEqual(src.alertesNonVues!(), [{ appli: 'midgard' }]); assert.equal(src.alertesNonVues!(), src.alertesNonVues!(), 'lue une fois par page');
    // Au nom d'un membre : une alerte de Sphinx qui n'est pas de son appareil n'est pas comptée (la règle de Valhalla).
    assert.ok(v.alert('vidarr', { level: 'haute', title: 'Essai E', key: 'essai-e', data: { mac: '02:00:00:00:00:01' } }));
    assert.deepEqual(sourceOdin(v).alertesNonVues!().map((x) => x.appli).sort(), ['midgard', 'vidarr'], 'le propriétaire : tout');
    assert.deepEqual(auNomDe({ login: 'membre-i', name: 'Membre I', groups: [] }, () => sourceOdin(v).alertesNonVues!()).map((x) => x.appli), ['midgard'], 'un membre : sans celle de Sphinx');
    assert.match(SOURCE_TS, /alertesNonVues: \(\) => \(alertes \?\?= v\.ctx\('gladsheim'\)\.alerts\(/, 'la source lit comme une appli (la règle des membres s\'applique), pas le journal entier');
  } finally { toutVoir(); }
});

// ------------------------------------------------------------------ le point d'accroche commun

test('le registre des rendus de famille : quel que soit l\'ordre de chargement, sans document, relu sans confiance', () => {
  for (const ordre of [[INFOS, RENDU], [RENDU, INFOS]]) {
    const win = page(ordre), R = win.OdinWidgetsRendu!;
    assert.ok(R && typeof R.rendu === 'function' && typeof R.posables === 'function', 'widgets-rendu.js porte le registre');
    assert.deepEqual(PETITES.map((k) => [R.rendu(k)?.sorte, R.rendu(k)?.petit, R.rendu(k)?.appli]), [['heure_petite', true, 'gladsheim'], ['meteo_petite', true, 'gladsheim'], ['alertes', true, 'forseti']]);
    const h = R.rendu('heure', 'horloge')!;
    assert.deepEqual([h.sorte, h.style, h.petit, h.appli, h.titre], ['heure', 'horloge', false, 'gladsheim', 'Horloge']);
    // Le titre de la carte et le nom de la ligne du tiroir : le même, sauf si la famille en déclare deux (la météo en
    // petit : « Météo » sur la carte ; « (petite) » ne sert qu'à la distinguer de l'autre dans le tiroir).
    assert.deepEqual([...PETITES.map((k) => R.rendu(k)!), h].map((d) => [d.titre, d.nom]), [['Heure', 'Heure'], ['Météo', 'Météo (petite)'], ['Alertes', 'Alertes'], ['Horloge', 'Horloge']]);
    assert.equal(R.rendu('heure_petite', 'horloge'), undefined, 'un style qu\'elle n\'a pas déclaré'); assert.equal(R.rendu('inventee'), undefined);
    for (const k of [undefined, null, 42, {}, '__proto__', 'constructor', 'toString']) assert.equal(R.rendu(k), undefined, String(k));
  }
  // Ni document ni rien d'autre touché au chargement ; un second chargement ne déclare pas deux fois.
  const win: Record<string, unknown> = {}; vm.runInNewContext(INFOS, { window: win }); vm.runInNewContext(INFOS, { window: win });
  assert.equal((win.OdinWidgetsFamilles as unknown[]).length, 1);
  // Des déclarations abîmées (un autre fichier, une faute) : ignorées, les bonnes restent.
  const sale: Record<string, unknown> = { OdinWidgetsFamilles: [null, 'x', { sortes: 'x' }, { famille: 'essai', sortes: [null, { sorte: 'A' }, { sorte: 'sans_dessin', titre: 'X' }, { sorte: 'bonne', titre: 'Bonne', dessiner: () => { throw new Error('boum'); }, sous: () => { throw new Error('boum'); } }, { sorte: 'bonne', titre: 'Double', dessiner: () => null }] }] };
  vm.runInNewContext(RENDU, { window: sale }); vm.runInNewContext(INFOS, { window: sale });
  const S = sale.OdinWidgetsRendu as Rendu;
  assert.equal(S.rendu('sans_dessin'), undefined); assert.equal(S.rendu('bonne')!.titre, 'Bonne', 'la première déclarée l\'emporte'); assert.equal(S.rendu('heure_petite')!.sorte, 'heure_petite');
  assert.equal(S.rendu('bonne')!.nom, 'Bonne', 'sans nom déclaré pour le tiroir : le titre');
  // Un rendu qui plante ne casse pas la page : rien (l'hôte écrit alors une ligne), jamais une exception.
  assert.equal(S.dessiner(S.rendu('bonne'), { etat: 'ok', at: 1, donnee: {} }, {}), null); assert.equal(S.sous(S.rendu('bonne'), {}, {}), '');
  assert.equal(S.dessiner(undefined, {}, {}), null); assert.equal(S.dessiner(S.rendu('bonne'), undefined, {}), null, 'sans état du serveur : rien n\'est dessiné');
});

test('qui dessine quoi : la donnée et l\'état calme par la famille ; les autres états par le dessin commun ; leurs textes à un seul endroit', () => {
  const R = page([INFOS, RENDU]).OdinWidgetsRendu!;
  assert.ok(R && typeof R.dessineElleMeme === 'function');
  const al = R.rendu('alertes')!, hp = R.rendu('heure_petite')!;
  const d = (e: unknown) => R.decrire(e, { proprio: true, peutAgir: () => true, appli: 'Appli' });
  assert.equal(R.dessineElleMeme(al, d({ etat: 'ok', at: 1, donnee: { nombre: 2 } })), true);
  assert.equal(R.dessineElleMeme(al, d({ etat: 'vide', raison: 'aucune_alerte' })), true, 'zéro alerte : le petit chiffre calme de la famille');
  assert.equal(R.dessineElleMeme(hp, d({ etat: 'vide', raison: 'aucune_alerte' })), false, 'seulement pour la sorte qui le déclare');
  for (const e of [{ etat: 'vide', raison: 'lieu_non_choisi' }, { etat: 'source_absente', raison: 'appli_absente' }, { etat: 'refuse', raison: 'vie_privee' }, { etat: 'refuse', raison: 'pas_pour_une_tablette', donnee: { nombre: 9 } }, undefined]) {
    assert.equal(R.dessineElleMeme(al, d(e)), false, JSON.stringify(e)); assert.equal(R.dessineElleMeme(hp, d(e)), false);
  }
  assert.equal(R.dessineElleMeme(undefined, d({ etat: 'ok' })), false);
  // Les trois raisons neuves ont leur texte dans la table commune ; zéro alerte et « pas encore rangé » n'ont pas de bouton.
  assert.equal(d({ etat: 'vide', raison: 'aucune_alerte' }).texte, 'Aucune alerte à voir.'); assert.equal(d({ etat: 'vide', raison: 'aucune_alerte' }).bouton, null);
  assert.match(d({ etat: 'vide', raison: 'fuseau_inconnu' }).texte, /fuseau/i); assert.match(d({ etat: 'vide', raison: 'pas_range' }).texte, /« Terminé »/); assert.equal(d({ etat: 'vide', raison: 'pas_range' }).bouton, null);
  for (const p of ['Aucune alerte à voir.']) for (const [nom, src] of [['fenetre.js', FE], ['maison.js', MAISON], ['widgets-infos.js', INFOS]] as const) assert.ok(!src.includes(p), `« ${p} » n'est pas recopié dans ${nom}`);
  // Le petit chiffre sans donnée (croquis validé des cinq états) : deux ou trois mots, un jeu par état, dans la table
  // commune et nulle part ailleurs ; la phrase entière reste celle de l'état (info-bulle, lecteur d'écran).
  assert.deepEqual(ici(R.TEXTES.courts), { vide: 'Rien à montrer', source_absente: 'Ne répond pas', refuse: 'Réservé' });
  assert.equal(typeof R.etatPetit, 'function', 'le dessin commun sait dessiner un petit chiffre sans donnée');
  for (const p of Object.values(ici(R.TEXTES.courts)) as string[]) for (const [nom, src] of [['fenetre.js', FE], ['maison.js', MAISON], ['widgets-infos.js', INFOS]] as const) assert.ok(!src.includes(p), `« ${p} » n'est pas recopié dans ${nom}`);
  // « Régler » : la sorte « heure » a deux styles, comme le serveur.
  assert.deepEqual(ici(R.STYLES.heure).map((x: [string, string]) => x[0]), [...sorteDe('heure')!.styles]);
  // Le fichier de famille : ses textes en tête, ses couleurs par les variables du thème, aucune donnée posée par innerHTML.
  assert.match(INFOS, /const TEXTES = \{/); assert.doesNotMatch(INFOS.replace(/\/\/[^\n]*/g, ''), /#[0-9a-f]{3,8}\b|rgba?\(/i, 'aucune couleur écrite en dur');
  assert.match(INFOS, /color-mix\(in srgb,var\(--wi-c\) 18%,transparent\)/, 'le fond de l\'icône : sa teinte à 18 %, comme la maquette');
  for (const m of INFOS.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)) assert.match(m[1], /^icone\(/, `innerHTML seulement pour une icône dessinée ici (${m[1].slice(0, 40)})`);
  assert.doesNotMatch(INFOS, /insertAdjacentHTML|document\.write|outerHTML/);
  assert.doesNotMatch(INFOS, /fetch\(|XMLHttpRequest|localStorage|\/api\//, 'le rendu ne lit rien : seulement l\'état rendu par le serveur');
});

test('le tiroir « Ajouter un widget » : les quatre, aux tailles de la maquette, pour qui a le droit ; Hestia les garde telles quelles', () => {
  const R = page([INFOS, RENDU]).OdinWidgetsRendu!;
  assert.ok(R && typeof R.posables === 'function');
  // Chaque ligne du tiroir porte le NOM déclaré (celui de la maquette : « Météo (petite) »), pas le titre de la carte.
  const tout = ici(R.posables({ proprio: true, aDroit: () => true }).map((x) => ({ nom: x.nom, appli: x.appli, w: x.w })));
  assert.deepEqual(tout, [
    { nom: 'Heure', appli: 'gladsheim', w: { kind: 'heure_petite', w: 1, c: 2, r: 1, pr: 1 } },
    { nom: 'Horloge', appli: 'gladsheim', w: { kind: 'heure', style: 'horloge', w: 1, c: 3, r: 2 } },
    { nom: 'Météo (petite)', appli: 'gladsheim', w: { kind: 'meteo_petite', w: 1, c: 2, r: 1, pr: 1 } },
    { nom: 'Alertes', appli: 'forseti', w: { kind: 'alertes', w: 1, c: 2, r: 1, pr: 1 } },
  ]);
  for (const x of R.posables({ proprio: true, aDroit: () => true })) assert.ok(typeof x.quoi === 'string' && x.quoi.length > 8 && x.symbole, `${x.nom} : sa phrase et son symbole`);
  // Posés puis rangés : Hestia garde la même sorte, le même style, la même taille (pas de saut à « Terminé »).
  const rangee = cleanLayout({ pages: [{ id: 'b2800001', name: 'P', widgets: tout.map((x: { w: Record<string, unknown> }, i: number) => ({ ...x.w, id: `c280000${i + 1}` })) }] }, IDS).pages[0].widgets;
  assert.deepEqual(rangee.map((w) => { const { id: _id, ...reste } = w as unknown as Record<string, unknown>; return reste; }), tout.map((x: { w: unknown }) => x.w));
  // Pour qui a le droit : sans l'appli des alertes dans son catalogue, pas de ligne « Alertes » ; sans catalogue, rien.
  const noms = (o: unknown) => [...R.posables(o).map((x) => x.nom)];
  assert.deepEqual(noms({ proprio: false, aDroit: (a: string) => a === 'gladsheim' }), ['Heure', 'Horloge', 'Météo (petite)']);
  assert.deepEqual(noms({ proprio: true, aDroit: (a: string) => a === 'forseti' }), ['Alertes']);
  for (const o of [undefined, {}, { proprio: true }, { proprio: true, aDroit: () => 1 }, { proprio: true, aDroit: () => { throw new Error('boum'); } }]) assert.deepEqual(noms(o), [], 'un droit qu\'on ne peut pas vérifier : rien');
  // fenetre.js : le tiroir lit le registre (aucune sorte neuve n'y est écrite), et annonce le titre déclaré.
  const c = fonction('catalogue');
  assert.match(c, /const declarees = R\.posables\(\{ proprio, aDroit \}\)\.map\(/, 'les lignes viennent du registre, pour qui a le droit');
  assert.match(c, /active: m \? OT\.active\(m\) : undefined, onclick: \(\) => add\(x\.w\)/, 'l\'appli lue désactivée : grisée ; « Ajouter » pose le widget à sa taille');
  assert.match(c, /return \{ nom: x\.nom, quoi: x\.quoi, icon: x\.symbole, /, 'la ligne porte le nom déclaré pour le tiroir');
  assert.match(c, /item\(\{ kind: 'heure' \}[^\n]*item\(\{ kind: 'meteo' \}[^\n]*'☀'\), \.\.\.declarees,/, 'après « Heure et lieu » et « Météo », qui restent');
  for (const k of [...PETITES, 'horloge']) assert.doesNotMatch(FE, new RegExp(`['"\`]${k}['"\`]`), `fenetre.js n'écrit pas « ${k} »`);
  for (const k of [...PETITES, 'horloge']) assert.doesNotMatch(MAISON, new RegExp(`['"\`]${k}['"\`]`), `maison.js n'écrit pas « ${k} »`);
  assert.match(fonction('montrerAjout'), /dire\(T\.pose\(w\?\.label \|\| renduDe\(w\)\?\.titre \|\| /, 'le widget posé est annoncé par son titre déclaré');
});

test('fenetre.js et maison.js : le rendu déclaré dessine le corps, dans le dessin commun ; une sorte inconnue a sa ligne', () => {
  // L'accueil : le registre d'abord (une famille peut reprendre une sorte d'aujourd'hui sans retoucher la fenêtre),
  // l'état vient du serveur seulement, pour CE réglage ; sans lui, rien n'est affirmé.
  assert.match(FE, /const renduDe = \(w\) => \(w \? R\.rendu\(w\.kind, w\.style\) : undefined\);/);
  const w = fonction('widget');
  const iF = w.indexOf('const rf = renduDe(w);'), iVide = w.indexOf('if (!d.donnee) {'), iJour = w.indexOf('if (JOUR.includes(w.kind))');
  assert.ok(iF > 0 && iF < iVide && iVide < iJour, 'le rendu déclaré passe avant les branches écrites en dur');
  const bloc = w.slice(iF, iVide);
  assert.match(bloc, /const s = etats\?\.get\(w\.id\), e = s && s\.sig === sigDe\(w\) \? s\.e : undefined/, 'l\'état rendu par le serveur, pour ce réglage');
  assert.match(bloc, /e && R\.dessineElleMeme\(rf, d\) \? R\.dessiner\(rf, e, o\) : null/, 'sans état du serveur, la famille ne dessine rien');
  assert.match(bloc, /raison: 'pas_range'/); assert.match(bloc, /raison: 'lecture_echouee'/);
  assert.match(bloc, /head\(/, 'l\'en-tête commun (titre, « ⋯ » du propriétaire)'); assert.match(bloc, /R\.contenu\(/, 'la ligne commune des états sans donnée');
  // Un petit chiffre garde sa taille dans chaque état : la donnée par sa famille, sinon l'état court du dessin commun ;
  // jamais l'en-tête ni la ligne et son bouton, qui feraient grandir la carte (et étireraient ses voisines).
  assert.match(bloc, /if \(rf\.petit\) \{ box\.append\(corps \?\? R\.etatPetit\(dd, \{ titre: titreDe\(w, d\.gris\) \}\)\); return box; \}/);
  assert.ok(bloc.indexOf('if (rf.petit)') < bloc.lastIndexOf('head('), 'avant l\'en-tête commun');
  assert.doesNotMatch(bloc, /innerHTML|api\(|act\(|fetch\(/, 'rien n\'est lu ni écrit ici');
  assert.match(w, /if \(w\.kind !== 'chiffres' && w\.kind !== 'section'\) \{[^\n]*contenuDe\('source_absente', 'pas_encore_lu'\)[^\n]*return box; \}/, 'une sorte que la page ne connaît pas : une ligne, la page continue');
  // Les branches d'aujourd'hui sont toujours là, telles quelles.
  for (const re of [/if \(w\.kind === 'meteo'\) \{\s*const d = await weather\(\);/, /if \(w\.kind === 'heure'\) \{ box\.append\(head\(w\.label \|\| TXT\.titres\.heure, 'Hestia', '🕒', 'gladsheim'\), horloge\(await lieu\(\)\)\); return box; \}/, /if \(w\.kind === 'site'\) \{/, /if \(w\.kind === 'bouton'\) \{/]) assert.match(w, re);
  assert.match(fonction('titreDe'), /const rf = renduDe\(w\); if \(rf\) return rf\.titre;/);
  // L'écran de la maison : la même règle, avec l'état que le serveur rend pour le widget ; jamais de bouton.
  const f = fonction('fWidget', MAISON);
  assert.match(f, /const rf = WR\(\)\?\.rendu\?\.\(w\.kind, w\.style\); if \(rf\) return fFamille\(w, rf\);\s*if \(w\.kind === 'meteo'\)/, 'le registre d\'abord');
  assert.match(f, /if \(!\['bouton', 'chiffres', 'section'\]\.includes\(w\.kind\)\) \{[^\n]*fEtat\('source_absente', 'pas_encore_lu'\)[^\n]*return card; \}/);
  const m = fonction('fFamille', MAISON);
  assert.match(m, /w\.etat && typeof w\.etat === 'object' \? w\.etat : \{ etat: 'source_absente', raison: 'pas_encore_lu' \}/, 'sans état rendu par le serveur : rien n\'est affirmé');
  assert.match(m, /peutAgir: \(\) => false/); assert.doesNotMatch(m, /innerHTML|api\(|fetch\(/);
  assert.match(m, /if \(rf\.petit\) \{ card\.append\(corps \?\? R\.etatPetit\(d, \{ titre \}\)\); return card; \}/, 'le petit chiffre : la même règle que sur l\'accueil');
});

// ------------------------------------------------------------------ un vrai Odin d'essai

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, lui = '';
const MDP = 'une-pirogue-sous-les-etoiles-28';
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const g = () => valhallaOf()!.ctx('gladsheim');
/** Range une fenêtre d'essai à la place de celle d'avant (oubliée d'abord : « À faire », une fois rangé, ne se retire pas). */
const ranger = async (f: unknown) => { g().saveSettings({ fenetre: undefined }); const r = await valhallaOf()!.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(f) }); assert.equal(r.ok, true, r.text); return r; };
const PAGE = 'b2800001', ID = { heure: 'c2800001', meteo: 'c2800002', alertes: 'c2800003', horloge: 'c2800004', hier: 'c2800005', dehors: 'c2800006' };
/** La page d'essai : les quatre widgets du lot, puis un « heure » et un « meteo » d'hier. */
const FENETRE = () => ({ pages: [{ id: PAGE, name: 'Infos', maison: true, widgets: [
  { id: ID.heure, kind: 'heure_petite', w: 1, c: 2, r: 1, pr: 1 }, { id: ID.meteo, kind: 'meteo_petite', w: 1, c: 2, r: 1, pr: 1 }, { id: ID.alertes, kind: 'alertes', w: 1, c: 2, r: 1, pr: 1 },
  { id: ID.horloge, kind: 'heure', style: 'horloge', w: 1, c: 3, r: 2 }, { id: ID.hier, kind: 'heure', w: 1, c: 4, r: 2 }, { id: ID.dehors, kind: 'meteo', w: 1, c: 4, r: 3 },
] }] });
type Rendue = { id: string; kind: string; etat: string; raison?: string; appli?: string; donnee?: Record<string, unknown> };
const donnees = async (h: Record<string, string> = {}) => { const r = await v.json(`/api/widgets/donnees?page=${PAGE}`, undefined, h); return { status: r.status, qui: r.body.qui, de: (id: string) => ((r.body.widgets as Rendue[] | undefined) ?? []).find((x) => x.id === id) }; };
const lieuChoisi = () => g().saveSettings({ ville: 'Lieu A', villeNom: 'Lieu A', fuseau: FUSEAU_ODIN, lat: '1', lon: '1', heure: '24h', suppose: '' });
const sansLieu = () => g().saveSettings({ ville: '', villeNom: '', fuseau: '', lat: '', lon: '', heure: '', suppose: '' });
const leverAlertes = () => { const va = valhallaOf()!, n = Date.now().toString(36); return [va.alert('midgard', { level: 'haute', title: 'Essai A', key: `a-${n}` }), va.alert('midgard', { level: 'info', title: 'Essai B', key: `b-${n}` }), va.alert('vordr', { level: 'moyenne', title: 'Essai C', key: `c-${n}` })].map((a) => a!.id); };
const toutVoir = () => { const va = valhallaOf()!; va.ack(va.alerts({ limit: 5000 }).map((a) => a.id)); };

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => [...IDS, 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-i', nom: 'Membre I', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'midgard', 'forseti']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-i' })).ok, true);
  lierProprietaire(persona()!);
  lui = await entrer('membre-i', MDP); assert.ok(lui, 'le membre a une session');
  assert.equal((await va.act('apparence', 'theme', { theme: 'valhalla' })).ok, true);
  sansLieu(); toutVoir();
  await ranger(FENETRE());
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('vrai Odin, neuf : lieu non choisi et aucune alerte → des états « vide », jamais un chiffre ; la fenêtre rangée garde sortes, style et tailles', async () => {
  sansLieu(); toutVoir();
  const gardee = (g().settings.fenetre as Layout).pages.find((p) => p.id === PAGE)!;
  assert.deepEqual(gardee.widgets, FENETRE().pages[0].widgets as unknown as Widget[], 'rangée telle que posée (2 × 1, 3 × 2, le style de l\'horloge)');
  const d = await donnees();
  assert.equal(d.status, 200); assert.equal(d.qui, 'proprietaire');
  for (const id of [ID.heure, ID.horloge, ID.meteo]) assert.deepEqual([d.de(id)!.etat, d.de(id)!.raison, 'donnee' in d.de(id)!], ['vide', 'lieu_non_choisi', false], id);
  assert.deepEqual([d.de(ID.alertes)!.etat, d.de(ID.alertes)!.raison, 'donnee' in d.de(ID.alertes)!], ['vide', 'aucune_alerte', false]);
  assert.equal(d.de(ID.hier)!.raison, 'lieu_non_choisi', 'le widget « heure » d\'hier : comme hier');
});

test('vrai Odin : l\'heure est rendue avec le fuseau d\'Odin (pas celui de la machine) ; sans fuseau, « vide » pour les dessins neufs', async () => {
  lieuChoisi();
  let d = await donnees();
  for (const id of [ID.heure, ID.horloge, ID.hier]) assert.deepEqual([d.de(id)!.etat, d.de(id)!.donnee], ['ok', { lieu: 'Lieu A', fuseau: FUSEAU_ODIN, heure12: false }], id);
  assert.notEqual(FUSEAU_ODIN, ICI);
  g().saveSettings({ heure: '12h' });
  assert.equal((await donnees()).de(ID.heure)!.donnee!.heure12, true, '12 ou 24 h : le réglage d\'Odin');
  g().saveSettings({ fuseau: '', heure: '24h' });
  d = await donnees();
  for (const id of [ID.heure, ID.horloge]) assert.deepEqual([d.de(id)!.etat, d.de(id)!.raison], ['vide', 'fuseau_inconnu'], id);
  assert.equal(d.de(ID.hier)!.etat, 'ok', 'le style de départ de « heure » ne change pas');
  // La météo en petit : la machine d'essai n'a pas de réseau ; rien n'est affirmé.
  assert.deepEqual([d.de(ID.meteo)!.etat, 'donnee' in d.de(ID.meteo)!], ['vide', false]);
  lieuChoisi();
});

test('vrai Odin : le compte suit « vu » par la route d\'aujourd\'hui ; un membre, une tablette « maison », la clé d\'accès', async () => {
  lieuChoisi(); toutVoir();
  const ids = leverAlertes();
  assert.deepEqual((await donnees()).de(ID.alertes)!.donnee, { nombre: 3 });
  assert.equal((await v.json('/api/valhalla/ack', { ids: [ids[1]] })).body.ok, true);
  assert.deepEqual((await donnees()).de(ID.alertes)!.donnee, { nombre: 2 }, 'marquée vue : elle ne compte plus');
  // Le membre a le droit sur l'appli des alertes, mais elle est de la vie privée : fermé, sans chiffre.
  let m = await donnees({ cookie: lui });
  assert.equal(m.status, 200); assert.equal(m.qui, 'membre');
  assert.deepEqual({ ...m.de(ID.alertes) }, { id: ID.alertes, kind: 'alertes', page: PAGE, etat: 'refuse', raison: 'vie_privee', appli: 'forseti' } as unknown as Rendue);
  assert.equal(m.de(ID.heure)!.etat, 'ok', 'l\'heure en petit : comme « heure », il a le droit sur Hestia'); assert.equal(m.de(ID.horloge)!.etat, 'ok');
  // Le propriétaire lui ouvre CE widget : il compte les alertes de Midgard (à lui), pas celle de Pulsar (pas à lui).
  assert.equal((await valhallaOf()!.act('gladsheim', 'ouvrir_widget', { widget: ID.alertes, personne: 'membre-i', ouvert: 'oui' })).ok, true);
  m = await donnees({ cookie: lui });
  assert.deepEqual([m.de(ID.alertes)!.etat, m.de(ID.alertes)!.donnee], ['ok', { nombre: 1 }]);
  assert.deepEqual((await donnees()).de(ID.alertes)!.donnee, { nombre: 2 }, 'le propriétaire : toujours toutes');
  assert.equal((await valhallaOf()!.act('gladsheim', 'ouvrir_widget', { widget: ID.alertes, personne: 'membre-i', ouvert: 'non' })).ok, true);
  assert.equal((await donnees({ cookie: lui })).de(ID.alertes)!.etat, 'refuse', 'refermé');
  // Une tablette « maison » : ni le widget des alertes, ni son compte ; les clés n'ouvrent pas la route des widgets.
  const cles = await Promise.all((['complet', 'maison'] as const).map(async (droits) => ((await valhallaOf()!.act('gladsheim', 'cle_tablette', { nom: `Tablette ${droits}`, droits })).data as { key: string }).key));
  for (const [i, cle] of cles.entries()) {
    const h = { cookie: '', 'x-odin-maison': cle };
    const e = await v.json('/api/maison/etat', undefined, h); assert.equal(e.status, 200);
    const servis = ((e.body.fenetre as FPage[]) ?? []).flatMap((p) => p.widgets.map((w) => w.kind as string));
    assert.ok(servis.includes('heure') && servis.includes('meteo'), 'la page est bien servie, avec ses widgets d\'hier');
    if (i === 1) { assert.ok(!servis.includes('alertes'), 'une tablette « maison » ne reçoit pas le widget des alertes'); assert.ok(!JSON.stringify(e.body.fenetre).includes('nombre'), 'ni son compte'); }
    assert.equal((await v.json(`/api/widgets/donnees?page=${PAGE}`, undefined, h)).status, 401, 'la clé d\'une tablette n\'ouvre pas la route des widgets');
  }
  const cle = { cookie: '', authorization: `Bearer ${v.token}` };
  assert.equal((await v.json(`/api/widgets/donnees?page=${PAGE}`, undefined, cle)).status, 401, 'la clé d\'accès n\'ouvre pas la route des widgets');
  assert.equal((await v.json(`/api/widgets/donnees?page=${PAGE}`, undefined, { cookie: '' })).status, 401, 'sans session : rien');
  // Toutes vues : l'état calme.
  toutVoir();
  assert.deepEqual([(await donnees()).de(ID.alertes)!.etat, (await donnees()).de(ID.alertes)!.raison], ['vide', 'aucune_alerte']);
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any, getComputedStyle: any;
interface Route { fetch(): Promise<{ json(): Promise<any> }>; fulfill(o: Record<string, unknown>): Promise<void>; continue(): Promise<void> }
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; click(s: string, o?: Record<string, unknown>): Promise<void>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>;
  route(u: string | RegExp, h: (r: Route) => Promise<void> | void): Promise<void>;
  keyboard: { press(k: string): Promise<void> }; waitForTimeout(ms: number): Promise<void>; on(e: string, f: (x: Error) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string | (() => void)): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });
// Captures facultatives (ODIN_CAPTURES=<dossier>) : pour regarder l'écran, jamais exigées par l'essai.
const CAPTURES = process.env.ODIN_CAPTURES;
const capture = async (p: Page, nom: string) => { if (!CAPTURES) return; mkdirSync(CAPTURES, { recursive: true }); await p.screenshot({ path: `${CAPTURES}/${nom}.png`, fullPage: true }); };

/** Ouvre l'accueil sur la page d'essai. L'appareil est dans un AUTRE fuseau que celui d'Odin. `avant` : poser des détournements avant le chargement. */
async function ouvrirPage(largeur: number, o: { cookie?: string; sombre?: boolean; chemin?: string; attendre?: string; avant?: (p: Page) => Promise<void> } = {}) {
  const doigt = largeur < 500;
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt, timezoneId: FUSEAU_APPAREIL, colorScheme: o.sombre ? 'dark' : 'light' });
  const [n, ...x] = (o.cookie ?? v.session).split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  // Le propriétaire a la page « Aujourd'hui » en premier : la page d'essai est la deuxième.
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); localStorage.setItem('odin.fenetre.page', '1'); ${o.sombre ? 'localStorage.setItem(\'odin.theme\', \'sombre\');' : ''} } catch { /* rien */ }`);
  const p = await ctx.newPage(), erreurs: string[] = [];
  p.on('pageerror', (e) => erreurs.push(String(e)));
  if (o.avant) await o.avant(p);
  await p.goto(v.url + (o.chemin ?? '/'));
  if (!o.chemin) await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  await p.waitForSelector(o.attendre ?? `#feGrid .fe-w[data-id="${ID.horloge}"]`, { timeout: 45000 });
  return { ctx, page: p, erreurs };
}
/** Remplace, dans la réponse de la route des widgets, l'état d'un widget (pour montrer un état que la machine d'essai, sans réseau, ne peut pas produire). */
const etatPour = (id: string, e: () => Record<string, unknown> | undefined) => (p: Page) => p.route(/\/api\/widgets\/donnees/, async (r) => {
  const rep = await r.fetch(), j = await rep.json(), force = e();
  if (force && Array.isArray(j?.widgets)) j.widgets = j.widgets.map((w: Record<string, unknown>) => (w.id === id ? { id: w.id, kind: w.kind, page: w.page, ...force } : w));
  await r.fulfill({ response: rep, json: j });
});
/** La même chose pour plusieurs widgets d'un coup : `forces()` rend, par identifiant, l'état à montrer (ou rien : celui du serveur). */
const etatsPour = (forces: () => Record<string, Record<string, unknown> | undefined>) => (p: Page) => p.route(/\/api\/widgets\/donnees/, async (r) => {
  const rep = await r.fetch(), j = await rep.json(), f = forces();
  if (Array.isArray(j?.widgets)) j.widgets = j.widgets.map((w: Record<string, unknown>) => (f[w.id as string] ? { id: w.id, kind: w.kind, page: w.page, ...f[w.id as string] } : w));
  await r.fulfill({ response: rep, json: j });
});
/** Ce que la page montre de chaque carte de la page d'essai. `petit` : le petit chiffre sans donnée (son état court), s'il est dessiné. */
const vu = (p: Page) => p.evaluate((ids: Record<string, string>) => {
  const txt = (n: any) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim(), r = (n: any) => n.getBoundingClientRect(), vw = document.documentElement.clientWidth;
  const sonde = document.createElement('i'); document.body.append(sonde);
  const couleur = (v: string) => { sonde.style.color = `var(${v})`; return getComputedStyle(sonde).color; };
  const out: Record<string, any> = { deborde: document.documentElement.scrollWidth > vw + 1, vw, warn: couleur('--warn'), ink: couleur('--ink'), muted: couleur('--muted'), colonnes: getComputedStyle(document.querySelector('#feGrid')).gridTemplateColumns.split(' ').length };
  for (const [nom, id] of Object.entries(ids)) {
    const c = document.querySelector(`#feGrid > .fe-w[data-id="${id}"]`); if (!c) { out[nom] = null; continue; }
    const ic = c.querySelector('.wi-ic'), v = c.querySelector('.wi-v'), l = c.querySelector('.wi-l'), b = r(c), ch = c.querySelector('.wi-chiffre'), pe = c.querySelector('.wr-petit');
    const dans = (n: any, cadre: any) => r(n).width > 0 && r(n).left >= r(cadre).left - 1 && r(n).right <= r(cadre).right + 1 && r(n).top >= r(cadre).top - 1 && r(n).bottom <= r(cadre).bottom + 1;
    out[nom] = {
      l: Math.round(b.width), h: Math.round(b.height), dedans: b.left >= 0 && b.right <= vw + 1, entete: Boolean(c.querySelector('.wr-h')), plus: Boolean(c.querySelector('.wr-plus')), titre: txt(c.querySelector('.wr-n')), sous: txt(c.querySelector('.wr-s')),
      valeur: txt(v), libelle: txt(l), dit: txt(c.querySelector('.wr-sr')), ton: [...(c.querySelector('.wi-chiffre')?.classList ?? [])].filter((x: string) => x !== 'wi-chiffre').join(' '),
      icone: ic ? { l: Math.round(r(ic).width), fond: getComputedStyle(ic).backgroundColor !== 'rgba(0, 0, 0, 0)', dessin: Boolean(ic.querySelector('svg')), teinte: getComputedStyle(ic).color, vue: getComputedStyle(ic).display !== 'none' && dans(ic, ch) } : null,
      petit: pe ? { etat: pe.dataset.etat ?? '', raison: pe.dataset.raison ?? '', court: txt(pe.querySelector('.wr-pc')), libelle: txt(pe.querySelector('.wr-pl')), bulle: pe.title, dit: txt(pe.querySelector('.wr-sr')),
        icone: pe.querySelector('.wr-pi') ? { l: Math.round(r(pe.querySelector('.wr-pi')).width), dessin: Boolean(pe.querySelector('.wr-pi svg')), vue: dans(pe.querySelector('.wr-pi'), pe) } : null,
        coupe: [...pe.querySelectorAll('.wr-pc, .wr-pl')].some((n: any) => n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1), couleur: getComputedStyle(pe.querySelector('.wr-pc')).color } : null,
      couleurValeur: v ? getComputedStyle(v).color : '', coupe: v ? v.scrollWidth > v.clientWidth + 1 : false, libelleCoupe: l ? l.scrollWidth > l.clientWidth + 1 : false, ligne: txt(c.querySelector('.wr-ligne')), bouton: txt(c.querySelector('.wr-btn')),
      grande: txt(c.querySelector('.wi-hh')), date: txt(c.querySelector('.wi-hd')), dansCarte: [...c.querySelectorAll('.wi-chiffre, .wi-horloge, .wi-hh, .wi-hd, .wi-v, .wi-l, .wr-petit, .wr-pc, .wr-pl')].every((n: any) => r(n).right <= b.right + 1 && r(n).bottom <= b.bottom + 1),
      ancienne: txt(c.querySelector('.fe-clock-h')),
    };
  }
  sonde.remove();
  return out;
}, ID);
/** Attend que les cartes ne bougent plus (un nouveau dessin les fait glisser à leur place : mesurer pendant ce temps donne de fausses tailles). */
const posee = (p: Page) => p.waitForFunction(() => { const w = window as any, t = [...document.querySelectorAll('#feGrid > .fe-w')].map((c: any) => { const r = c.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round).join(','); }).join(';'), avant = w.__posee; w.__posee = { t, n: avant && avant.t === t ? avant.n + 1 : 0 }; return w.__posee.n >= 5; }, undefined, { timeout: 15000, polling: 100 });
/** L'heure attendue dans un fuseau, à la minute d'avant et à celle d'après (la page a pu changer de minute). */
const minutes = (fuseau: string) => [new Date(Date.now() - 60_000), new Date(), new Date(Date.now() + 60_000)].map((d) => heureDans(fuseau, d));

test('navigateur, 1280 px, clair : les trois petits chiffres (2 × 1) et l\'horloge (3 × 2), à l\'heure d\'Odin ; l\'alarme seulement s\'il y a de quoi', { skip: sansNav }, async () => {
  lieuChoisi(); toutVoir(); const ids = leverAlertes();
  const meteo = { e: { etat: 'ok', at: Date.now(), donnee: { lieu: 'Lieu A', temp: 21, code: 61 } } as Record<string, unknown> };
  const { ctx, page: p, erreurs } = await ouvrirPage(1280, { avant: etatPour(ID.meteo, () => meteo.e) });
  try {
    await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.alertes}"] .wi-v`, { timeout: 30000 });
    const a = await vu(p);
    assert.equal(a.colonnes, 12, 'la grille de 12 colonnes'); assert.equal(a.deborde, false);
    // Un petit chiffre : une icône teintée, la valeur, son libellé ; ni en-tête ni « ⋯ » ; deux colonnes, une ligne.
    for (const k of ['heure', 'meteo', 'alertes']) {
      const c = a[k];
      assert.deepEqual([c.entete, c.plus], [false, false], `${k} : ni en-tête ni « ⋯ »`);
      assert.deepEqual([c.icone.l, c.icone.fond, c.icone.dessin], [42, true, true], `${k} : une icône teintée de 42 px`);
      assert.ok(c.valeur && c.libelle, `${k} : la valeur et son libellé (${c.valeur} | ${c.libelle})`);
      assert.equal(c.h, 74, `${k} : une ligne de la grille`); assert.equal(c.l, a.heure.l, 'la même largeur : deux colonnes'); assert.equal(c.dedans, true); assert.equal(c.dansCarte, true, `${k} : rien ne sort de la carte`); assert.equal(c.coupe, false);
    }
    assert.ok(Math.abs(a.heure.l - (a.horloge.l - 14) * 2 / 3) < 12, `deux colonnes contre trois (${a.heure.l} et ${a.horloge.l})`);
    // L'heure : celle du fuseau d'Odin, pas celle de l'appareil (qui est ailleurs).
    assert.ok(minutes(FUSEAU_ODIN).includes(a.heure.valeur), `l'heure d'Odin (${a.heure.valeur}, attendu ${minutes(FUSEAU_ODIN)[1]})`);
    assert.ok(!minutes(FUSEAU_APPAREIL).includes(a.heure.valeur), 'pas l\'heure de l\'appareil');
    assert.equal(a.heure.libelle, 'Heure'); assert.match(a.heure.dit, /Lieu A/);
    // L'horloge : l'en-tête commun, « ⋯ » pour le propriétaire, l'heure en grand, la date et la semaine, 3 × 2.
    const h = a.horloge;
    assert.deepEqual([h.entete, h.plus, h.titre], [true, true, 'Horloge']); assert.match(h.sous, /^Hestia · Lieu A/);
    assert.ok(minutes(FUSEAU_ODIN).includes(h.grande), `l'heure d'Odin en grand (${h.grande})`);
    const jour = new Intl.DateTimeFormat('fr', { timeZone: FUSEAU_ODIN, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    assert.ok(h.date.toLowerCase().startsWith(jour.toLowerCase()), `la date d'Odin (${h.date})`); assert.match(h.date, / · semaine \d{1,2}$/);
    assert.equal(h.h, 162, 'deux lignes de la grille'); assert.equal(h.dansCarte, true);
    // Les widgets d'hier, sur la même page : dessinés comme hier.
    assert.equal(a.hier.titre, 'Heure et lieu'); assert.ok(a.hier.ancienne, 'le widget « heure » d\'hier garde son dessin');
    assert.equal(a.dehors.titre, 'Météo');
    // La météo en petit : la température, le lieu, une icône du ciel.
    assert.deepEqual([a.meteo.valeur, a.meteo.libelle], ['21°', 'Lieu A']);
    // Les alertes : trois pas encore vues, en couleur d'alarme (la couleur du thème).
    assert.deepEqual([a.alertes.valeur, a.alertes.ton, a.alertes.libelle], ['3', 'wi-alarme', 'Alertes']); assert.equal(a.alertes.couleurValeur, a.warn); assert.equal(a.alertes.dit, '3 alertes non vues.');
    assert.equal(a.heure.couleurValeur, a.ink, 'un chiffre ordinaire : la couleur du texte');
    await p.evaluate((s: string) => document.querySelector(s).scrollIntoView({ block: 'center' }), `#feGrid .fe-w[data-id="${ID.horloge}"]`);
    await capture(p, 'infos-1280-clair');
    // Marquées vues, la météo devenue ancienne : à la lecture suivante, l'état calme et la pastille.
    assert.equal((await v.json('/api/valhalla/ack', { ids })).body.ok, true);
    meteo.e = { etat: 'ancien', at: Date.now() - 3 * 3600_000, donnee: { lieu: 'Lieu A', temp: 21, code: 61 }, motif: 'coupé' };
    await p.click('#fenetre .fe-tab[aria-pressed="true"]');
    await p.waitForFunction((s: string) => document.querySelector(s)?.textContent === '0', `#feGrid .fe-w[data-id="${ID.alertes}"] .wi-v`, { timeout: 20000 });
    await posee(p);
    const b = await vu(p);
    assert.deepEqual([b.alertes.valeur, b.alertes.ton, b.alertes.dit], ['0', 'wi-calme', 'Aucune alerte à voir.'], 'zéro alerte : un état calme');
    assert.equal(b.alertes.couleurValeur, b.ink, 'pas de couleur d\'alarme'); assert.notEqual(b.alertes.icone.teinte, a.alertes.icone.teinte, 'l\'icône non plus');
    assert.deepEqual([b.meteo.valeur, b.meteo.ton], ['21°', 'wi-ancien'], 'la météo ancienne reste, marquée'); assert.match(b.meteo.libelle, /^il y a 3 h · Lieu A$/, 'avec l\'heure de sa lecture');
    assert.equal(b.meteo.h, 74); assert.equal(b.meteo.dansCarte, true);
    await capture(p, 'infos-1280-clair-calme');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});

test('navigateur, 390 px, sombre : rien ne déborde, les petits chiffres côte à côte, « ⋯ » de 44 px ; lieu non choisi : l\'horloge a sa ligne et son bouton, un petit chiffre garde sa taille', { skip: sansNav }, async () => {
  lieuChoisi(); toutVoir(); leverAlertes();
  const meteo = { e: { etat: 'ok', at: Date.now(), donnee: { lieu: 'Lieu A', temp: -4, code: 73 } } as Record<string, unknown> | undefined };
  const { ctx, page: p, erreurs } = await ouvrirPage(390, { sombre: true, avant: etatPour(ID.meteo, () => meteo.e) });
  try {
    await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.alertes}"] .wi-v`, { timeout: 30000 });
    const a = await vu(p);
    assert.equal(a.deborde, false, 'la page ne déborde pas'); assert.equal(a.colonnes, 4, 'quatre colonnes au téléphone');
    for (const k of ['heure', 'meteo', 'alertes']) { assert.equal(a[k].dedans, true, k); assert.equal(a[k].dansCarte, true, `${k} : rien ne sort de la carte`); assert.equal(a[k].coupe, false); assert.equal(a[k].h, 84, `${k} : une ligne du téléphone`); assert.ok(a[k].l < a.vw / 2, `${k} : la moitié de l'écran`); }
    assert.equal(a.meteo.valeur, '-4°'); assert.ok(minutes(FUSEAU_ODIN).includes(a.heure.valeur));
    assert.equal(a.horloge.dedans, true); assert.equal(a.horloge.dansCarte, true); assert.ok(a.horloge.l > a.vw * 0.8, 'l\'horloge : toute la largeur');
    assert.ok(await p.evaluate((s: string) => { const b = document.querySelector(s).getBoundingClientRect(); return b.width >= 44 && b.height >= 44; }, `#feGrid .fe-w[data-id="${ID.horloge}"] .wr-plus`), '« ⋯ » de 44 px');
    await p.evaluate((s: string) => document.querySelector(s).scrollIntoView({ block: 'center' }), `#feGrid .fe-w[data-id="${ID.horloge}"]`);
    await capture(p, 'infos-390-sombre');
    // Le lieu n'est plus choisi : jamais une heure. L'horloge (une carte à en-tête) : la ligne commune et son seul
    // bouton (44 px). Les petits chiffres gardent leur ligne du téléphone (croquis validé des cinq états) : l'icône de
    // l'état, deux ou trois mots, leur libellé ; la phrase entière est leur info-bulle, dite à qui ne voit pas l'écran.
    sansLieu(); meteo.e = undefined;
    await p.evaluate(() => (document.querySelector('#fenetre .fe-tab[aria-pressed="true"]') as any).click());
    await p.waitForFunction((s: string) => Boolean(document.querySelector(s)), `#feGrid .fe-w[data-id="${ID.horloge}"] .wr-ligne`, { timeout: 20000 });
    await posee(p);
    const b = await vu(p);
    for (const k of ['heure', 'horloge', 'meteo']) { assert.equal(b[k].valeur, '', k); assert.equal(b[k].grande, ''); assert.equal(b[k].dedans, true); assert.equal(b[k].dansCarte, true, `${k} : rien ne sort de la carte`); }
    assert.deepEqual([b.horloge.ligne, b.horloge.bouton], ['Rien à montrer : choisis ton lieu.', 'Choisir le lieu']);
    for (const [k, libelle] of [['heure', 'Heure'], ['meteo', 'Météo']]) {
      const c = b[k];
      assert.deepEqual([c.petit?.court, c.petit?.libelle, c.petit?.bulle, c.petit?.dit], ['Rien à montrer', libelle, 'Rien à montrer : choisis ton lieu.', `${libelle}. Rien à montrer : choisis ton lieu.`], k);
      assert.deepEqual([c.h, c.entete, c.plus, c.ligne, c.bouton], [84, false, false, '', ''], `${k} : toujours une ligne du téléphone, sans en-tête ni bouton`);
      assert.equal(c.petit.coupe, false, `${k} : ses mots tiennent`);
    }
    assert.equal(b.alertes.h, 84, 'le chiffre voisin n\'est pas étiré');
    assert.equal(b.deborde, false);
    const btn = await p.evaluate((s: string) => { const c = document.querySelector(s), b = c.querySelector('.wr-btn').getBoundingClientRect(), r = c.getBoundingClientRect(); return { l: Math.round(b.width), h: Math.round(b.height), dedans: b.right <= r.right + 1 && b.bottom <= r.bottom + 1, carte: [Math.round(r.width), Math.round(r.height)] }; }, `#feGrid .fe-w[data-id="${ID.horloge}"]`);
    assert.ok(btn.h >= 44 && btn.l >= 44 && btn.dedans, `le bouton fait 44 px et reste dans la carte (${JSON.stringify(btn)})`);
    await capture(p, 'infos-390-sombre-sans-lieu');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); lieuChoisi(); }
});

test('navigateur : le tiroir propose les quatre et les pose ; rangés par « Terminé », ils sont lus ; « Régler » passe de « Heure et lieu » à « Horloge »', { skip: sansNav }, async () => {
  lieuChoisi(); toutVoir();
  await ranger({ pages: [{ id: PAGE, name: 'Infos', widgets: [{ id: ID.hier, kind: 'heure', w: 1, c: 4, r: 2 }] }] });
  const { ctx, page: p, erreurs } = await ouvrirPage(1280, { attendre: `#feGrid .fe-w[data-id="${ID.hier}"]` });
  try {
    await p.evaluate(() => window.OdinFenetre.edit(true)); await p.waitForSelector('#feTiroir', { state: 'attached' });
    const offerts = await p.evaluate(() => [...document.querySelectorAll('#feTiroir .fe-it b')].map((b: any) => b.textContent));
    for (const t of ['Heure', 'Horloge', 'Météo (petite)', 'Alertes', 'Heure et lieu', 'Météo']) assert.ok(offerts.includes(t), `le tiroir propose « ${t} » (${offerts.slice(0, 12).join(', ')})`);
    for (const t of ['Heure', 'Horloge', 'Météo (petite)', 'Alertes']) {
      await p.evaluate((n: string) => { (document.querySelector(`#feTiroir [aria-label="Ajouter ${n}"]`) as any).click(); }, t);
      await p.waitForFunction((n: number) => window.OdinFenetre.state().L.pages[1].widgets.length === n, ['Heure', 'Horloge', 'Météo (petite)', 'Alertes'].indexOf(t) + 2, { timeout: 15000 });
    }
    await p.waitForFunction(() => document.querySelectorAll('#feGrid > .fe-w').length === 5, undefined, { timeout: 15000 });
    const poses = await p.evaluate(() => window.OdinFenetre.state().L.pages[1].widgets.slice(1).map((w: any) => [w.kind, w.style ?? '', w.c, w.r, w.pr ?? 0]));
    assert.deepEqual(poses, [['heure_petite', '', 2, 1, 1], ['heure', 'horloge', 3, 2, 0], ['meteo_petite', '', 2, 1, 1], ['alertes', '', 2, 1, 1]], 'aux tailles de la maquette');
    // Pas encore rangés : le serveur ne les connaît pas, rien n'est affirmé. L'horloge le dit par sa ligne ; un petit
    // chiffre garde sa taille et le dit par ses mots courts (la phrase entière est son info-bulle, dite à qui ne voit pas).
    await posee(p);
    const attente = await p.evaluate(() => [...document.querySelectorAll('#feGrid > .fe-w')].slice(1).map((c: any) => { const pe = c.querySelector('.wr-petit'); return [pe ? pe.title : c.querySelector('.wr-ligne')?.textContent ?? '', pe ? pe.querySelector('.wr-pc').textContent : '', c.querySelector('.wi-v, .wi-hh') ? 'une valeur' : '', Math.round(c.getBoundingClientRect().height)]; }));
    const phrase = 'Appuie sur « Terminé » pour l\'afficher.';
    assert.deepEqual(attente, [[phrase, 'Rien à montrer', '', 74], [phrase, '', '', 162], [phrase, 'Rien à montrer', '', 74], [phrase, 'Rien à montrer', '', 74]], 'la même phrase pour les quatre ; les petits chiffres font toujours 2 × 1');
    await p.evaluate(() => { ([...document.querySelectorAll('#fenetre .fe-tools .btn')].find((b: any) => b.textContent === 'Terminé') as any).click(); });
    await p.waitForFunction(() => !document.querySelector('#fenetre.fe-edit'), undefined, { timeout: 15000 });
    const gardee = (g().settings.fenetre as Layout).pages.find((x) => x.id === PAGE)!.widgets.slice(1).map((w: any) => [w.kind, w.style ?? '', w.c, w.r, w.pr ?? 0]);
    assert.deepEqual(gardee, poses, 'Hestia garde les mêmes sortes, le même style, les mêmes tailles');
    await p.waitForSelector('#feGrid .wi-horloge .wi-hh', { timeout: 20000 });
    const lus = await p.evaluate(() => [...document.querySelectorAll('#feGrid > .fe-w')].slice(1).map((c: any) => (c.querySelector('.wi-v, .wi-hh')?.textContent ?? '').replace(/\s+/g, ' ').trim() || c.querySelector('.wr-ligne')?.textContent));
    assert.ok(minutes(FUSEAU_ODIN).includes(lus[0] as string) && minutes(FUSEAU_ODIN).includes(lus[1] as string), `rangés : l'heure d'Odin (${lus.join(' | ')})`);
    assert.equal(lus[3], '0', 'aucune alerte : le chiffre calme');
    // « Régler » sur le widget « heure » d'hier : Style → Horloge ; le même widget devient l'horloge, sans autre lecture.
    await p.click(`#feGrid .fe-w[data-id="${ID.hier}"] .wr-plus`); await p.waitForSelector('dialog.wr-regler[open]');
    const styles = await p.evaluate(() => [...document.querySelectorAll('dialog.wr-regler input[name="wrStyle"]')].map((i: any) => [i.value, i.checked, i.closest('label').textContent]));
    assert.deepEqual(styles, [['simple', true, 'Heure et lieu'], ['horloge', false, 'Horloge']]);
    await p.evaluate(() => { (document.querySelector('dialog.wr-regler input[name="wrStyle"][value="horloge"]') as any).click(); ([...document.querySelectorAll('dialog.wr-regler button')].find((b: any) => b.textContent === 'Valider') as any).click(); });
    await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.hier}"] .wi-horloge .wi-hh`, { timeout: 15000 });
    assert.equal(await p.evaluate((s: string) => document.querySelector(s)?.textContent, `#feGrid .fe-w[data-id="${ID.hier}"] .wr-n`), 'Horloge');
    await capture(p, 'infos-1280-modifier');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); await ranger(FENETRE()); }
});

test('navigateur : une sorte inconnue ne casse ni l\'accueil ni l\'écran de la maison', { skip: sansNav }, async () => {
  lieuChoisi(); toutVoir(); leverAlertes();
  await ranger(FENETRE());
  // L'accueil sans le fichier de la famille (il n'arrive pas) : ses sortes sont inconnues de la page ; elle dessine tout le reste.
  const sans = await ouvrirPage(1280, { attendre: `#feGrid .fe-w[data-id="${ID.hier}"]`, avant: (p) => p.route(/\/pages\/widgets-infos\.js/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' })) });
  try {
    await sans.page.waitForSelector(`#feGrid .fe-w[data-id="${ID.dehors}"]`, { timeout: 30000 });
    const a = await vu(sans.page);
    assert.equal(await sans.page.evaluate(() => document.querySelectorAll('#feGrid > .fe-w').length), 6, 'les six cartes sont là');
    // L'heure et les alertes ont une donnée, que la page ne sait pas dessiner : une ligne, jamais la donnée ; la météo, pas lue : sa ligne commune.
    for (const k of ['heure', 'alertes']) assert.deepEqual([a[k].ligne, a[k].valeur, a[k].bouton], ['Odin ne sait pas encore lire cela.', '', ''], `${k} : une ligne, rien d'inventé`);
    assert.deepEqual([a.meteo.ligne, a.meteo.valeur], ['Pas encore lue, Odin réessaie.', '']);
    assert.ok(!(await sans.page.evaluate((s: string) => document.querySelector(s).textContent, `#feGrid .fe-w[data-id="${ID.alertes}"]`)).includes('3'), 'le nombre des alertes est tu par une page qui ne sait pas le dessiner');
    assert.ok(a.horloge.ancienne, 'sans le rendu de la famille, l\'horloge reste un widget « heure » d\'hier'); assert.ok(a.hier.ancienne);
    assert.deepEqual(sans.erreurs, [], 'aucune erreur dans la page');
  } finally { await sans.ctx.close(); }
  // L'écran de la maison : le serveur y rend une sorte que la page ne connaît pas, et une sorte déclarée avec son état.
  const ajout = (p: Page) => p.route(/\/api\/maison\/etat/, async (r) => {
    const rep = await r.fetch(), j = await rep.json();
    if (Array.isArray(j?.fenetre) && j.fenetre[0]) j.fenetre[0].widgets.push(
      { id: 'c28000a1', kind: 'sorte_de_demain', w: 1, c: 4, r: 2, title: 'Demain' },
      { id: 'c28000a2', kind: 'meteo_petite', w: 1, c: 2, r: 1, title: '', etat: { etat: 'ancien', at: Date.now() - 12 * 60_000, donnee: { lieu: 'Lieu A', temp: 21, code: 95 }, motif: 'coupé' } },
      { id: 'c28000a3', kind: 'alertes', w: 1, c: 2, r: 1, title: '', etat: { etat: 'refuse', raison: 'pas_pour_une_tablette', donnee: { nombre: 7 } } },
      { id: 'c28000a4', kind: 'heure_petite', w: 1, c: 2, r: 1, title: '' });
    await r.fulfill({ response: rep, json: j });
  });
  const m = await ouvrirPage(1280, { chemin: '/maison', attendre: '[data-fw]', avant: ajout });
  try {
    await m.page.waitForSelector('[data-fw="c28000a4"]', { timeout: 30000 });
    const c = await m.page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-fw]')].map((n: any) => [n.dataset.fw, { titre: n.querySelector('.wr-n')?.textContent ?? '', ligne: n.querySelector('.wr-ligne')?.textContent ?? '', valeur: n.querySelector('.wi-v')?.textContent ?? '', libelle: (n.querySelector('.wi-l')?.textContent ?? '').replace(/\s+/g, ' ').trim(), boutons: n.querySelectorAll('.wr-btn, .wr-plus').length, texte: n.textContent,
      entete: Boolean(n.querySelector('.wr-h')), court: n.querySelector('.wr-petit .wr-pc')?.textContent ?? '', etiquette: n.querySelector('.wr-petit .wr-pl')?.textContent ?? '', bulle: n.querySelector('.wr-petit')?.title ?? '' }])));
    assert.ok(c[ID.hier] && c[ID.dehors] !== undefined, 'les widgets d\'hier sont dessinés');
    assert.deepEqual([c.c28000a1.titre, c.c28000a1.ligne], ['Demain', 'Odin ne sait pas encore lire cela.'], 'une sorte inconnue : sa carte le dit');
    assert.deepEqual([c.c28000a2.valeur, c.c28000a2.libelle], ['21°', 'il y a 12 min · Lieu A'], 'une sorte déclarée : dessinée avec l\'état rendu par le serveur');
    // Un petit chiffre sans donnée, comme sur l'accueil : son état court (les mots, son libellé), jamais d'en-tête ; la
    // phrase entière est son info-bulle.
    assert.deepEqual([c.c28000a3.court, c.c28000a3.etiquette, c.c28000a3.bulle, c.c28000a3.entete, c.c28000a3.valeur], ['Réservé', 'Alertes', 'Fermé · réservé au propriétaire.', false, ''], 'refusé : jamais la donnée'); assert.ok(!String(c.c28000a3.texte).includes('7'));
    assert.deepEqual([c.c28000a4.court, c.c28000a4.etiquette, c.c28000a4.bulle, c.c28000a4.entete, c.c28000a4.valeur], ['Ne répond pas', 'Heure', 'Odin ne sait pas encore lire cela.', false, ''], 'sans état du serveur : rien n\'est affirmé');
    assert.equal(Object.values(c).reduce((s: number, x: any) => s + ((String(x.ligne).length || String(x.court).length) && x.boutons ? 1 : 0), 0), 0, 'aucun bouton sur cet écran');
    assert.deepEqual(m.erreurs, [], 'aucune erreur dans la page');
  } finally { await m.ctx.close(); }
});

test('navigateur : un membre voit l\'heure d\'Odin ; le compte d\'alertes lui reste fermé (vie privée), sans chiffre', { skip: sansNav }, async () => {
  lieuChoisi(); toutVoir(); leverAlertes();
  await ranger(FENETRE());
  const { ctx, page: p, erreurs } = await ouvrirPage(1280, { cookie: lui, attendre: `#feGrid .fe-w[data-id="${ID.heure}"] .wi-v` });
  try {
    await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.alertes}"] .wr-petit`, { timeout: 30000 });
    await posee(p);
    const a = await vu(p);
    assert.ok(minutes(FUSEAU_ODIN).includes(a.heure.valeur), `l'heure d'Odin (${a.heure.valeur})`);
    // Fermé (vie privée) : le petit chiffre garde sa taille ; « Réservé » et son titre, la phrase entière en info-bulle.
    assert.deepEqual([a.alertes.petit?.etat, a.alertes.petit?.court, a.alertes.petit?.bulle, a.alertes.valeur, a.alertes.bouton, a.alertes.plus, a.alertes.entete], ['refuse', 'Réservé', 'Vie privée : à ouvrir par le propriétaire.', '', '', false, false], 'fermé : ni chiffre, ni bouton, ni « ⋯ »');
    assert.equal(a.alertes.petit.libelle, 'Alertes', 'le titre vient de la fenêtre, pas de l\'appli');
    assert.equal(a.alertes.petit.dit, 'Alertes. Vie privée : à ouvrir par le propriétaire.');
    for (const k of ['heure', 'meteo', 'alertes']) assert.equal(a[k].h, 74, `${k} : toujours 2 × 1, aucun voisin étiré`);
    assert.equal(a.meteo.petit?.libelle, 'Météo', 'la carte dit « Météo » ; « (petite) » ne sert qu\'au tiroir');
    assert.equal(a.horloge.plus, false, 'pas de « ⋯ » pour un membre'); assert.ok(minutes(FUSEAU_ODIN).includes(a.horloge.grande));
    assert.ok(!(await p.evaluate((s: string) => document.querySelector(s).textContent, `#feGrid .fe-w[data-id="${ID.alertes}"]`)).includes('3'), 'le nombre n\'arrive pas dans sa page');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});

test('navigateur, un thème de verre : les widgets gardent les couleurs que le thème donne à la carte, rien ne déborde', { skip: sansNav }, async (t) => {
  lieuChoisi(); toutVoir(); leverAlertes();
  await ranger(FENETRE());
  const va = valhallaOf()!, verre = await va.act('apparence', 'theme', { theme: 'glace' });
  if (!verre.ok) { t.skip('le thème de verre ne se pose pas sur cet Odin'); return; }
  const { ctx, page: p, erreurs } = await ouvrirPage(1280, { avant: etatPour(ID.meteo, () => ({ etat: 'ok', at: Date.now(), donnee: { lieu: 'Lieu A', temp: 21, code: 2 } })) });
  try {
    await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.alertes}"] .wi-v`, { timeout: 30000 });
    await posee(p);
    // Chaque couleur est lue DANS la carte : le thème peut y donner ses propres teintes (le verre), les widgets les suivent.
    const c = await p.evaluate((ids: Record<string, string>) => Object.fromEntries(Object.entries(ids).map(([nom, id]) => {
      const carte = document.querySelector(`#feGrid > .fe-w[data-id="${id}"]`), sonde = document.createElement('i'); carte.append(sonde);
      const couleur = (v: string) => { sonde.style.color = `var(${v})`; return getComputedStyle(sonde).color; }, de = (s: string) => { const n = carte.querySelector(s); return n ? getComputedStyle(n).color : ''; };
      const b = carte.getBoundingClientRect(), r = { ink: couleur('--ink'), muted: couleur('--muted'), warn: couleur('--warn'), valeur: de('.wi-v'), libelle: de('.wi-l'), grande: de('.wi-hh'), date: de('.wi-hd'), dedans: [...carte.querySelectorAll('.wi-chiffre, .wi-horloge, .wi-v, .wi-l, .wi-hh, .wi-hd')].every((n: any) => n.getBoundingClientRect().right <= b.right + 1 && n.getBoundingClientRect().bottom <= b.bottom + 1) };
      sonde.remove(); return [nom, r];
    })), { heure: ID.heure, meteo: ID.meteo, alertes: ID.alertes, horloge: ID.horloge });
    assert.equal(await p.evaluate(() => document.documentElement.dataset.odinTheme), 'glace', 'le thème de verre est posé');
    for (const k of ['heure', 'meteo']) { assert.equal(c[k].valeur, c[k].ink, `${k} : la valeur, couleur du texte de la carte`); assert.equal(c[k].libelle, c[k].muted, `${k} : le libellé`); assert.equal(c[k].dedans, true); }
    assert.equal(c.alertes.valeur, c.alertes.warn, 'les alertes : la couleur d\'alarme de la carte'); assert.equal(c.alertes.dedans, true);
    assert.equal(c.horloge.grande, c.horloge.ink); assert.equal(c.horloge.date, c.horloge.muted); assert.equal(c.horloge.dedans, true);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, 'la page ne déborde pas');
    await p.evaluate((s: string) => document.querySelector(s).scrollIntoView({ block: 'center' }), `#feGrid .fe-w[data-id="${ID.horloge}"]`);
    await capture(p, 'infos-1280-verre');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); await va.act('apparence', 'theme', { theme: 'valhalla' }); }
});

test('navigateur, 1280 px : sans donnée, un petit chiffre garde sa taille (2 × 1) : l\'icône de l\'état, deux ou trois mots, son libellé ; ni en-tête ni bouton ; ses voisins ne s\'étirent pas', { skip: sansNav }, async () => {
  sansLieu(); toutVoir();
  await ranger(FENETRE());
  const forces: { e: Record<string, Record<string, unknown> | undefined> } = { e: {} };
  const { ctx, page: p, erreurs } = await ouvrirPage(1280, { avant: etatsPour(() => forces.e) });
  try {
    await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.horloge}"] .wr-ligne`, { timeout: 30000 });
    await posee(p);
    const a = await vu(p);
    // Lieu non choisi (un Odin neuf) : l'heure et la météo en petit gardent leur ligne de la grille.
    for (const [k, libelle] of [['heure', 'Heure'], ['meteo', 'Météo']]) {
      const c = a[k];
      assert.deepEqual([c.h, c.l], [74, a.alertes.l], `${k} : une ligne de la grille, deux colonnes`);
      assert.deepEqual([c.entete, c.plus, c.ligne, c.bouton, c.valeur], [false, false, '', '', ''], `${k} : ni en-tête, ni « ⋯ », ni ligne, ni bouton, ni valeur`);
      assert.deepEqual([c.petit?.etat, c.petit?.raison, c.petit?.court, c.petit?.libelle], ['vide', 'lieu_non_choisi', 'Rien à montrer', libelle], `${k} : deux ou trois mots, et son libellé (« Météo », pas le nom du tiroir)`);
      assert.deepEqual([c.petit.bulle, c.petit.dit], ['Rien à montrer : choisis ton lieu.', `${libelle}. Rien à montrer : choisis ton lieu.`], 'la phrase entière : dans l\'info-bulle, et dite à qui ne voit pas l\'écran');
      assert.deepEqual([c.petit.icone?.l, c.petit.icone?.dessin, c.petit.icone?.vue, c.petit.coupe], [42, true, true, false], `${k} : l'icône de l'état, des mots entiers`);
      assert.equal(c.petit.couleur, a.muted, 'des mots sobres : la couleur discrète du thème'); assert.equal(c.dansCarte, true, `${k} : rien ne sort de la carte`);
    }
    assert.deepEqual([a.alertes.valeur, a.alertes.h], ['0', 74], 'le chiffre voisin (aucune alerte) n\'est pas étiré');
    // L'horloge est une carte à en-tête : le dessin commun, sa ligne et son seul bouton ; deux lignes de la grille.
    assert.deepEqual([a.horloge.entete, a.horloge.titre, a.horloge.ligne, a.horloge.bouton, a.horloge.h], [true, 'Horloge', 'Rien à montrer : choisis ton lieu.', 'Choisir le lieu', 162]);
    await capture(p, 'infos-1280-etats-vide');
    // Les autres états, montrés par une réponse détournée (cet Odin d'essai ne les produit pas pour son propriétaire) :
    // un fuseau que le navigateur ne connaît pas, une appli qui ne répond pas, un widget fermé.
    lieuChoisi();
    forces.e = {
      [ID.heure]: { etat: 'ok', at: Date.now(), donnee: { lieu: 'Lieu A', fuseau: 'Nulle/Part', heure12: false } },
      [ID.meteo]: { etat: 'source_absente', raison: 'appli_muette', appli: 'gladsheim' },
      [ID.alertes]: { etat: 'refuse', raison: 'vie_privee', appli: 'forseti', donnee: { nombre: 7 } },
    };
    await p.click('#fenetre .fe-tab[aria-pressed="true"]');
    await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.alertes}"] .wr-petit[data-etat="refuse"]`, { timeout: 20000 });
    await posee(p);
    const b = await vu(p);
    assert.deepEqual([b.heure.petit?.etat, b.heure.petit?.raison, b.heure.petit?.court, b.heure.petit?.libelle, b.heure.valeur], ['vide', 'fuseau_inconnu', 'Rien à montrer', 'Heure', ''], 'un fuseau illisible : jamais l\'heure de l\'appareil');
    assert.match(b.heure.petit.bulle, /^Fuseau du lieu inconnu/);
    assert.deepEqual([b.meteo.petit?.etat, b.meteo.petit?.court, b.meteo.petit?.libelle, b.meteo.petit?.bulle], ['source_absente', 'Ne répond pas', 'Météo', 'Hestia ne répond pas.']);
    assert.deepEqual([b.alertes.petit?.etat, b.alertes.petit?.court, b.alertes.petit?.libelle, b.alertes.petit?.bulle, b.alertes.valeur], ['refuse', 'Réservé', 'Alertes', 'Vie privée : à ouvrir par le propriétaire.', ''], 'refusé : le titre gardé, jamais la donnée');
    assert.ok(!(await p.evaluate((s: string) => document.querySelector(s).textContent, `#feGrid .fe-w[data-id="${ID.alertes}"]`)).includes('7'), 'le nombre n\'est écrit nulle part dans la carte');
    for (const k of ['heure', 'meteo', 'alertes']) { const c = b[k]; assert.deepEqual([c.h, c.entete, c.plus, c.ligne, c.bouton, c.dansCarte, c.petit.coupe, c.petit.icone?.vue], [74, false, false, '', '', true, false, true], `${k} : toujours 2 × 1, sans en-tête ni bouton`); }
    assert.equal(b.horloge.h, 162, 'l\'horloge : toujours 3 × 2');
    await capture(p, 'infos-1280-etats-autres');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); lieuChoisi(); }
});

test('navigateur, 768 px (tablette), sombre : sur une carte étroite, l\'icône d\'un petit chiffre reste, réduite ; la valeur reste entière, sur 24 h comme sur 12 h ; sans donnée, la carte ne grandit pas', { skip: sansNav }, async () => {
  lieuChoisi(); toutVoir(); leverAlertes();
  await ranger(FENETRE());
  // Le lieu de la météo porte ici un nom plus long que la carte : c'est le libellé qui se coupe, pas l'icône qui s'en va.
  const LONG = 'Lieu au nom bien plus long que la carte';
  const forces: { e: Record<string, Record<string, unknown> | undefined> } = { e: { [ID.meteo]: { etat: 'ok', at: Date.now(), donnee: { lieu: LONG, temp: -14, code: 73 } } } };
  const { ctx, page: p, erreurs } = await ouvrirPage(768, { sombre: true, avant: etatsPour(() => forces.e) });
  const relire = async (attendre: string) => { await p.evaluate(() => (document.querySelector('#fenetre .fe-tab[aria-pressed="true"]') as any).click()); await p.waitForSelector(attendre, { timeout: 20000 }); await posee(p); return vu(p); };
  try {
    await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.alertes}"] .wi-v`, { timeout: 30000 });
    await posee(p);
    const a = await vu(p);
    assert.equal(a.colonnes, 12, 'la tablette garde la grille de 12 colonnes'); assert.equal(a.deborde, false, 'la page ne déborde pas');
    for (const k of ['heure', 'meteo', 'alertes']) {
      const c = a[k];
      assert.ok(c.l < 140, `${k} : une carte étroite (${c.l} px)`); assert.equal(c.h, 74, `${k} : une ligne de la grille`);
      assert.ok(c.icone && c.icone.vue && c.icone.dessin && c.icone.fond && c.icone.l >= 24 && c.icone.l < 42, `${k} : l'icône reste, réduite (${JSON.stringify(c.icone)})`);
      assert.ok(c.valeur && c.libelle, `${k} : la valeur et son libellé`); assert.equal(c.coupe, false, `${k} : la valeur reste entière (${c.valeur})`); assert.equal(c.dansCarte, true, `${k} : rien ne sort de la carte`);
    }
    assert.ok(minutes(FUSEAU_ODIN).includes(a.heure.valeur), `l'heure d'Odin (${a.heure.valeur})`); assert.deepEqual([a.meteo.valeur, a.alertes.valeur], ['-14°', '3']);
    assert.deepEqual([a.meteo.libelle, a.meteo.libelleCoupe, a.heure.libelleCoupe, a.alertes.libelleCoupe], [LONG, true, false, false], 'un libellé trop long se coupe ; les autres sont entiers');
    await p.evaluate((s: string) => document.querySelector(s).scrollIntoView({ block: 'center' }), `#feGrid .fe-w[data-id="${ID.horloge}"]`);
    await capture(p, 'infos-768-sombre');
    // Sur 12 h, la valeur est plus longue : elle reste entière (l'icône lui cède sa place s'il le faut), la carte ne grandit pas.
    g().saveSettings({ heure: '12h' });
    const b = await relire(`#feGrid .fe-w[data-id="${ID.heure}"] .wi-v small`);
    assert.match(b.heure.valeur, /AM|PM/, `le matin ou l'après-midi (${b.heure.valeur})`);
    assert.deepEqual([b.heure.coupe, b.heure.h, b.heure.dansCarte], [false, 74, true], `sur 12 h, la valeur reste entière (${b.heure.valeur})`);
    for (const k of ['meteo', 'alertes']) assert.ok(b[k].icone.vue && b[k].coupe === false, `${k} : inchangé`);
    await capture(p, 'infos-768-sombre-12h');
    // Sans donnée, sur la même carte étroite : elle ne grandit pas, rien n'en sort, ses mots courts sont là.
    sansLieu(); forces.e = {};
    const c = await relire(`#feGrid .fe-w[data-id="${ID.heure}"] .wr-petit`);
    for (const k of ['heure', 'meteo']) assert.deepEqual([c[k].h, c[k].dansCarte, c[k].petit?.court, c[k].petit?.coupe, c[k].entete, c[k].bouton], [74, true, 'Rien à montrer', false, false, ''], `${k} : toujours 2 × 1, ses mots entiers`);
    assert.equal(c.alertes.h, 74, 'le chiffre voisin n\'est pas étiré'); assert.equal(c.deborde, false);
    await capture(p, 'infos-768-sombre-sans-lieu');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); lieuChoisi(); }
});
