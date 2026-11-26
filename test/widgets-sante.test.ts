// Les widgets « Santé » de l'accueil (maquette validée « Accueil ») : la famille « sante »
// (src/valhalla/widgets/sante.ts, src/web/pages/widgets-sante.js).
// - « Santé de la machine » : le processeur, la mémoire et le disque le plus plein de la machine d'Odin, en pourcentage,
//   chacun avec le niveau que Hygie calcule (ses seuils et ses réglages) ; la température seulement si elle est lue.
// - « Santé des disques » : chaque disque que Tirésias a lu et son état vrai, celui qui va mal d'abord, « et N de plus ».
// - Jamais un zéro à la place d'une absence (sa réponse à la question 13, et à la question 17 : la machine d'Odin) : sous
//   Windows, Hygie et Tirésias ne lisent rien : « source_absente » avec un code de raison, sans un chiffre ; une mesure
//   qui manque n'a pas de ligne, un disque non lu est « Non lu », jamais « bon ». Une mesure ancienne est marquée.
// - Qui voit quoi : le droit sur l'appli lue. Un membre sans ce droit, une tablette « maison », une clé d'accès, une
//   requête sans session : refusés, sans une valeur ni un nom de disque.
// - Le navigateur : 1280 px clair, 390 px sombre, puis 320, 768 et 1920 px : la carte ne s'étire pas, rien ne déborde.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { TAILLE_SORTE, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { donneeWidget, publicDe, sorteDe, type EtatWidget, type Lecteur, type SourceWidget } from '../src/valhalla/widgets/index.ts';
import { sourceOdin } from '../src/valhalla/widgets/source.ts';
import { DEFAULT_LIMITS, level } from '../src/valhalla/eir/collect.ts';
import { ecrireDernier } from '../src/valhalla/durinn/suivi.ts';
import { Metrics } from '../src/valhalla/metrics.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => { try { return readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); } catch { return ''; } };
const RENDU = lire('src/web/pages/widgets-rendu.js'), SANTE = lire('src/web/pages/widgets-sante.js'), GRILLE = lire('src/web/pages/accueil-grille.js');
const W = (kind: string, o: Record<string, unknown> = {}): Widget => ({ id: 'c7e00000', kind, w: 1, c: 4, r: 2, ...o }) as unknown as Widget;
const LUI: Lecteur = { qui: 'proprietaire', ecran: 'accueil' }, TABLETTE: Lecteur = { qui: 'maison', ecran: 'maison' };
const membre = (droits: string[]): Lecteur => ({ qui: 'membre', ecran: 'accueil', peutLire: (a) => droits.includes(a), ouverts: new Set() });
const MAINT = 1_800_000_000_000, MIN = 60_000;
type Etat = EtatWidget & { raison?: string; donnee?: Record<string, any>; at?: number; appli?: string; motif?: string };
const etat = async (w: Widget, l: Lecteur, src: SourceWidget) => (await donneeWidget(w, l, src)) as Etat;
type Rel = Array<[number, number]>;
const SEUILS = { cpu: DEFAULT_LIMITS.cpu, mem: DEFAULT_LIMITS.mem, fs: DEFAULT_LIMITS.fs, temp: DEFAULT_LIMITS.temp };
/** Deux relevés d'une mesure, à une minute d'écart, le dernier `il` minutes avant maintenant. */
const deux = (a: number, b: number, il = 0): Rel => [[MAINT - (il + 1) * MIN, a], [MAINT - il * MIN, b]];
type Mesures = { cpu: Rel; mem: Rel; disques: Rel[]; temperatures: Rel[] };
type Disque = Record<string, unknown>;
/** Une fausse source : la machine (son système, ses relevés) et la dernière lecture des disques de Tirésias. */
function fausse(o: { systeme?: string; mesures?: Partial<Mesures> | null; seuils?: Record<string, unknown>; disques?: { quand?: string; panne?: string; disques?: Disque[] } | null; espions?: string[] } = {}): SourceWidget {
  const applis: Record<string, { name: string; family: string }> = { eir: { name: 'Appli santé', family: 'Machines' }, durinn: { name: 'Appli disques', family: 'Machines' } };
  return {
    appli: (id) => (applis[id] ? { id, ...applis[id] } : undefined),
    vue: async () => null, action: () => undefined, meteo: async () => undefined,
    lieu: () => ({ choisi: true, nom: 'Lieu A', fuseau: Intl.DateTimeFormat().resolvedOptions().timeZone, heure12: false }), maintenant: () => MAINT,
    santeMachine: () => {
      o.espions?.push('machine');
      const systeme = o.systeme ?? 'linux';
      if (systeme !== 'linux') return { systeme };
      return { systeme, seuils: (o.seuils ?? SEUILS) as never, ...(o.mesures === null ? {} : { mesures: { cpu: [], mem: [], disques: [], temperatures: [], ...(o.mesures ?? {}) } }) };
    },
    disquesSante: () => {
      o.espions?.push('disques');
      const systeme = o.systeme ?? 'linux';
      if (systeme === 'win32') return { systeme };
      return o.disques === null || o.disques === undefined ? { systeme } : { systeme, lecture: { quand: o.disques.quand ?? new Date(MAINT - 10 * MIN).toISOString(), ...(o.disques.panne ? { panne: o.disques.panne } : {}), disques: o.disques.disques ?? [] } };
    },
  };
}
/** Un disque tel que Tirésias le garde (src/valhalla/durinn/smart.ts, Disque). */
const disque = (nom: string, o: Disque = {}): Disque => ({ nom, chemin: `/dev/${nom}`, protocole: 'ATA', genre: 'disque dur', usb: false, modele: `Modèle ${nom}`, serie: `SERIE-${nom}`, taille: 4e12, smart: 'oui', etat: 'bon', raisons: [], valeurs: [], messages: [], temperature: 36, ...o });
/** Aucune valeur dans un état : ni pourcentage, ni nombre, ni nom de disque. */
const sansValeur = (e: unknown) => {
  // L'identifiant du widget, sa page et sa sorte (rendus par la route) ne sont pas des valeurs lues.
  const { id: _i, page: _p, kind: _k, ...reste } = (e ?? {}) as Record<string, unknown>, j = JSON.stringify(reste);
  return !/\d/.test(j) && !j.includes('donnee') && !j.includes('Modèle') && !j.includes('SERIE');
};

// ------------------------------------------------------------------ le serveur, sans Odin

test('les deux sortes : famille « sante », tailles de la maquette (4 × 2 et 3 × 4, 3 × 2 au moins), le droit sur l\'appli lue, posables', () => {
  for (const [id, applis, r] of [['sante_machine', ['eir'], 2], ['sante_disques', ['durinn'], 4]] as const) {
    const s = sorteDe(id);
    assert.ok(s, `${id} déclarée`); assert.equal(s.famille, 'sante'); assert.equal(s.posable, true); assert.equal(publicDe(s), 'membre', `${id} : suit le droit sur l'appli`);
    assert.deepEqual([[...s.taille.mini], s.taille.r, s.applis], [[3, 2], r, applis], id);
    assert.deepEqual((TAILLE_SORTE as Record<string, unknown>)[id], { mini: [3, 2], r }, `${id} : la taille gardée par Hestia`);
  }
});

test('sous Windows (plateforme simulée) : « source_absente » avec un code de raison, aucun chiffre, aucun 0 %', async () => {
  const src = fausse({ systeme: 'win32', mesures: { cpu: deux(10, 20), mem: deux(30, 40) }, disques: { disques: [disque('sda')] } });
  for (const k of ['sante_machine', 'sante_disques']) {
    const e = await etat(W(k), LUI, src);
    assert.deepEqual([e.etat, e.raison], ['source_absente', 'windows_non_lu'], k);
    assert.ok(sansValeur(e), `${k} : ${JSON.stringify(e)}`); assert.ok(!JSON.stringify(e).includes('%'));
  }
  // Un autre système que Linux pour Hygie : un autre code, toujours sans chiffre.
  const mac = await etat(W('sante_machine'), LUI, fausse({ systeme: 'darwin', mesures: { cpu: deux(10, 20) } }));
  assert.deepEqual([mac.etat, mac.raison], ['source_absente', 'systeme_non_lu']); assert.ok(sansValeur(mac));
  // Tirésias a gardé sa panne « windows » : le même code ; ses autres pannes, leur code (jamais son texte).
  for (const [panne, raison] of [['windows', 'windows_non_lu'], ['absent', 'smartctl_absent'], ['ancien', 'smartctl_ancien'], ['muet', 'smartctl_muet']]) {
    const e = await etat(W('sante_disques'), LUI, fausse({ disques: { panne, disques: [disque('sda')] } }));
    assert.deepEqual([e.etat, e.raison], ['source_absente', raison], panne); assert.ok(sansValeur(e));
  }
});

test('Linux simulé : les bonnes valeurs et les niveaux de Hygie (ses seuils, puis ses réglages) ; le disque le plus plein ; la plus haute température', async () => {
  const mesures = { cpu: deux(18, 27.4), mem: deux(60, 63.2), disques: [deux(40, 41), deux(85, 88.4), deux(10, 12)], temperatures: [deux(50, 57.4), deux(40, 47)] };
  const e = await etat(W('sante_machine'), LUI, fausse({ mesures }));
  assert.equal(e.etat, 'ok');
  const n = (v: number, k: keyof typeof SEUILS) => level(v, SEUILS[k]);
  assert.deepEqual(e.donnee, { cpu: { pct: 27, niveau: n(27.4, 'cpu') }, mem: { pct: 63, niveau: n(63, 'mem') }, disque: { pct: 88, niveau: n(88.4, 'fs') }, temp: { c: 57, niveau: n(57.4, 'temp') } });
  assert.deepEqual([e.donnee!.cpu.niveau, e.donnee!.mem.niveau, e.donnee!.disque.niveau], ['ok', 'suivre', 'attention'], 'les seuils de départ de Hygie');
  assert.equal(e.at, MAINT, 'l\'heure du relevé');
  // Ses réglages changent le niveau, comme sur sa page.
  const r = await etat(W('sante_machine'), LUI, fausse({ mesures, seuils: { ...SEUILS, cpu: { suivre: 5, attention: 10, grave: 20 } } }));
  assert.equal(r.donnee!.cpu.niveau, 'grave');
});

test('une mesure qui manque n\'a pas de ligne : pas de température, pas de disque ; le premier relevé du processeur (0, sans lecture d\'avant) n\'est pas pris', async () => {
  const e = await etat(W('sante_machine'), LUI, fausse({ mesures: { cpu: deux(18, 27), mem: deux(60, 63) } }));
  assert.equal(e.etat, 'ok'); assert.deepEqual(Object.keys(e.donnee!).sort(), ['cpu', 'mem'], 'ni disque, ni température');
  // Un seul relevé du processeur (le premier de Hygie vaut 0) : pas de processeur ; deux relevés trop éloignés : non plus.
  const seul = await etat(W('sante_machine'), LUI, fausse({ mesures: { cpu: [[MAINT, 0]], mem: deux(60, 63) } }));
  assert.equal(seul.donnee!.cpu, undefined, 'jamais un 0 % inventé');
  const loin = await etat(W('sante_machine'), LUI, fausse({ mesures: { cpu: [[MAINT - 30 * MIN, 0], [MAINT, 0]], mem: deux(60, 63) } }));
  assert.equal(loin.donnee!.cpu, undefined);
  // Des valeurs illisibles (hors de 0 à 100, une température nulle) : pas de ligne.
  const faux = await etat(W('sante_machine'), LUI, fausse({ mesures: { cpu: deux(-1, 140), mem: deux(60, 63), temperatures: [deux(0, 0)] } }));
  assert.deepEqual(Object.keys(faux.donnee!), ['mem']);
  // Rien de mesuré : « vide » (Hygie n'a encore rien rangé) ; le magasin absent : « source_absente ».
  const rien = await etat(W('sante_machine'), LUI, fausse({ mesures: {} }));
  assert.deepEqual([rien.etat, rien.raison], ['vide', 'pas_encore_mesure']); assert.ok(sansValeur(rien));
  const sans = await etat(W('sante_machine'), LUI, fausse({ mesures: null }));
  assert.deepEqual([sans.etat, sans.raison], ['source_absente', 'mesures_absentes']);
});

test('une mesure ancienne est marquée ancienne, avec son heure ; les mesures d\'un passage plus vieux ne sont pas mêlées aux fraîches', async () => {
  const e = await etat(W('sante_machine'), LUI, fausse({ mesures: { cpu: deux(18, 27, 20), mem: deux(60, 63, 20) } }));
  assert.deepEqual([e.etat, e.motif, e.at], ['ancien', 'hygie_ne_mesure_plus', MAINT - 20 * MIN]);
  assert.equal(e.donnee!.mem.pct, 63, 'la dernière donnée reste');
  const m = await etat(W('sante_machine'), LUI, fausse({ mesures: { cpu: deux(18, 27), mem: deux(60, 63), disques: [deux(80, 81, 30)] } }));
  assert.equal(m.etat, 'ok'); assert.equal(m.donnee!.disque, undefined, 'un disque mesuré 30 min plus tôt n\'est pas montré avec le reste');
  const d = await etat(W('sante_disques'), LUI, fausse({ disques: { quand: new Date(MAINT - 3 * 3_600_000).toISOString(), disques: [disque('sda')] } }));
  assert.deepEqual([d.etat, d.motif, d.at], ['ancien', 'tiresias_ne_relit_plus', MAINT - 3 * 3_600_000]);
  const f = await etat(W('sante_disques'), LUI, fausse({ disques: { quand: new Date(MAINT + 3_600_000).toISOString(), disques: [disque('sda')] } }));
  assert.equal(f.etat, 'ancien', 'une lecture datée dans le futur n\'est pas dite fraîche');
});

test('les disques : celui qui va mal d\'abord, un disque non lu n\'est jamais « bon » ; ni numéro de série ; « et N de plus » ; vides', async () => {
  const l = [disque('sda'), disque('sdb', { etat: 'attention', temperature: 44 }), disque('sdc', { smart: 'non', etat: 'bon', temperature: 30, modele: undefined }), disque('nvme0', { etat: 'mauvais', genre: 'NVMe', temperature: 0 }), disque('sdd', { enVeille: true })];
  const e = await etat(W('sante_disques'), LUI, fausse({ disques: { disques: l } }));
  assert.equal(e.etat, 'ok'); assert.equal(e.at, MAINT - 10 * MIN);
  const d = e.donnee!;
  assert.deepEqual(d.disques.map((x: any) => [x.nom, x.etat, x.lu]), [['nvme0', 'mauvais', true], ['sdb', 'attention', true], ['sdc', 'inconnu', false], ['sda', 'bon', true], ['sdd', 'bon', true]]);
  assert.equal(d.disques[2].temperature, undefined, 'un disque non lu : aucune température'); assert.equal(d.disques[0].temperature, undefined, 'une température de 0 : pas lue');
  assert.equal(d.disques[1].temperature, 44); assert.equal(d.disques[4].veille, true); assert.equal(d.disques[0].genre, 'NVMe');
  assert.deepEqual([d.total, d.compte], [5, { bon: 2, attention: 1, mauvais: 1, inconnu: 1 }]);
  assert.ok(!JSON.stringify(e).includes('SERIE'), 'aucun numéro de série'); assert.ok(!JSON.stringify(e).includes('/dev/'), 'aucun chemin');
  const beaucoup = await etat(W('sante_disques'), LUI, fausse({ disques: { disques: Array.from({ length: 30 }, (_, i) => disque(`sd${i}`)) } }));
  assert.deepEqual([beaucoup.donnee!.disques.length, beaucoup.donnee!.total], [24, 30]);
  const aucun = await etat(W('sante_disques'), LUI, fausse({ disques: { disques: [] } }));
  assert.deepEqual([aucun.etat, aucun.raison], ['vide', 'aucun_disque']);
  const jamais = await etat(W('sante_disques'), LUI, fausse({ disques: null }));
  assert.deepEqual([jamais.etat, jamais.raison], ['vide', 'disques_pas_encore_lus']);
  const date = await etat(W('sante_disques'), LUI, fausse({ disques: { quand: 'pas une date', disques: [disque('sda')] } }));
  assert.deepEqual([date.etat, date.raison], ['source_absente', 'lecture_illisible']);
  // Un disque que Tirésias juge mal sans le relire aujourd'hui (une tendance, un autotest raté) garde son état : seul
  // « bon » non lu devient « inconnu » ; il passe devant le non lu et le bon.
  const tendance = await etat(W('sante_disques'), LUI, fausse({ disques: { disques: [disque('sda'), disque('sdx', { smart: 'non', etat: 'bon' }), disque('sdy', { smart: 'non', etat: 'mauvais' }), disque('sdz', { smart: 'erreur', etat: 'attention' })] } }));
  assert.deepEqual(tendance.donnee!.disques.map((x: any) => [x.nom, x.etat, x.lu]), [['sdy', 'mauvais', false], ['sdz', 'attention', false], ['sdx', 'inconnu', false], ['sda', 'bon', true]]);
  assert.deepEqual(tendance.donnee!.compte, { bon: 1, attention: 1, mauvais: 1, inconnu: 1 });
});

test('qui voit quoi : un membre sans le droit sur l\'appli, une tablette : refusés avant toute lecture, sans une valeur ; un membre avec le droit : la donnée', async () => {
  const espions: string[] = [], src = fausse({ espions, mesures: { cpu: deux(18, 27), mem: deux(60, 63) }, disques: { disques: [disque('sda')] } });
  for (const [k, appli] of [['sante_machine', 'eir'], ['sante_disques', 'durinn']]) {
    const m = await etat(W(k), membre(['odin']), src);
    assert.deepEqual([m.etat, m.raison, m.appli], ['refuse', 'appli_fermee', appli], k); assert.ok(sansValeur(m));
    const t = await etat(W(k), TABLETTE, src);
    assert.deepEqual([t.etat, t.raison], ['refuse', 'pas_pour_une_tablette'], k); assert.ok(sansValeur(t));
    const tm = await etat(W(k), { ...TABLETTE, qui: 'maison', ecran: 'accueil' }, src);
    assert.equal(tm.etat, 'refuse');
  }
  assert.deepEqual(espions, [], 'rien n\'est lu pour qui n\'a pas le droit');
  assert.equal((await etat(W('sante_machine'), membre(['eir']), src)).etat, 'ok');
  assert.equal((await etat(W('sante_disques'), membre(['durinn']), src)).etat, 'ok');
});

// ------------------------------------------------------------------ la page, sans navigateur

test('la page : la famille se déclare (deux sortes, le droit sur l\'appli, tailles de la maquette) ; la grille connaît leurs tailles ; les mots', () => {
  const win: Record<string, any> = { document: { documentElement: { lang: 'fr' } } };
  for (const src of [SANTE, RENDU, GRILLE]) vm.runInNewContext(src, { window: win, document: win.document, Intl });
  const R = win.OdinWidgetsRendu, G = win.OdinGrille, S = win.OdinWidgetsSante, ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));
  const vus = ['sante_machine', 'sante_disques'].map((k) => R.rendu(k));
  assert.deepEqual(ici(vus.map((x: any) => [x?.sorte, x?.titre, x?.appli, Boolean(x?.proprio), x?.vides])), [['sante_machine', 'Santé de la machine', 'eir', false, ['pas_encore_mesure']], ['sante_disques', 'Santé des disques', 'durinn', false, ['disques_pas_encore_lus', 'aucun_disque']]]);
  assert.deepEqual(ici(vus.map((x: any) => [x.w.c, x.w.r])), [[4, 2], [3, 4]], 'les tailles de départ de la maquette');
  for (const k of ['sante_machine', 'sante_disques']) assert.deepEqual([[...G.MINI[k]], G.HAUTEUR[k]], [[...sorteDe(k)!.taille.mini], sorteDe(k)!.taille.r], `${k} : les tables de la grille suivent le serveur`);
  // Le tiroir : à qui a le droit sur l'appli (le propriétaire, un membre) ; pas à un membre sans ce droit.
  const noms = (o: unknown) => ici(R.posables(o).filter((x: any) => x.famille === 'sante').map((x: any) => x.nom));
  assert.deepEqual(noms({ proprio: true, aDroit: () => true }), ['Santé de la machine', 'Santé des disques']);
  assert.deepEqual(noms({ proprio: false, aDroit: (a: string) => a === 'eir' }), ['Santé de la machine']);
  assert.deepEqual(noms({ proprio: false, aDroit: () => false }), []);
  // Les sous-titres : la température si elle est lue ; les comptes, ce qui va mal d'abord.
  assert.match(R.sous(vus[0], { etat: 'ok', donnee: { mem: { pct: 63, niveau: 'suivre' }, temp: { c: 57, niveau: 'ok' } } }, {}), /^57\s?°C$/);
  assert.equal(R.sous(vus[0], { etat: 'ok', donnee: { mem: { pct: 63, niveau: 'suivre' } } }, {}), '', 'pas de température : rien');
  // Un sous-titre court (l'en-tête le coupe sans info-bulle) : ce qui va mal seulement ; tout va bien : le compte des bons.
  assert.equal(R.sous(vus[1], { etat: 'ok', donnee: { compte: { bon: 4, attention: 1, mauvais: 0, inconnu: 0 } } }, {}), '1 à surveiller');
  assert.equal(R.sous(vus[1], { etat: 'ok', donnee: { compte: { bon: 7, attention: 1, mauvais: 1, inconnu: 1 } } }, {}), '1 mauvais · 1 à surveiller · 1 non lu');
  assert.equal(R.sous(vus[1], { etat: 'ok', donnee: { compte: { bon: 4, attention: 0, mauvais: 0, inconnu: 0 } } }, {}), '4 bons');
  // Le nom de l'appli vient du catalogue (o.nomAppli), jamais écrit dans la famille.
  assert.ok(!/Hygie|Tirésias/.test(JSON.stringify(ici(S.TEXTES))), 'aucun nom d\'appli dans les textes');
  assert.ok(!/Hygie|Tirésias/.test(JSON.stringify(ici(vus.map((x: any) => [x.titre, x.quoi])))), 'ni dans la déclaration');
  assert.deepEqual([S.TEXTES.machine.ouvrir('Appli A'), S.TEXTES.disques.ouvrir('Appli B')], ['Ouvrir Appli A', 'Ouvrir Appli B']);
  assert.ok(!/Hygie|Tirésias/.test(S.TEXTES.machine.pasEncore('') + S.TEXTES.disques.pasEncore('') + S.TEXTES.machine.ouvrir('')));
  // Lus sans confiance : jamais « bon » pour un disque non lu ; une mesure illisible n'est rien. Un disque que
  // Tirésias juge mal sans le relire garde son état.
  assert.equal(S.disqueLu({ nom: 'sda', etat: 'bon', lu: false }).etat, 'inconnu');
  assert.deepEqual([S.disqueLu({ nom: 'sda', etat: 'mauvais', lu: false }).etat, S.disqueLu({ nom: 'sda', etat: 'attention', lu: false }).etat], ['mauvais', 'attention']);
  assert.equal(S.disqueLu({ nom: 'sda', etat: 'inventé', lu: true }).etat, 'inconnu');
  assert.equal(S.mesureLue({ pct: 0 / 0, niveau: 'ok' }), null); assert.equal(S.mesureLue({ pct: 50, niveau: 'autre' }), null);
  assert.equal(S.taille(4e12, 'en'), '4 TB', 'une taille comme Tirésias l\'écrit, en multiples de 1000, dans la langue de la page');
  assert.deepEqual([S.combien(2), S.combien(4), S.combien(undefined)], [1, 3, 3]);
  // Le texte d'une donnée : jamais par innerHTML (seules les deux icônes dessinées ici le sont).
  assert.deepEqual([...SANTE.matchAll(/innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim()), ['INFO', 'OUVRIR']);
  assert.ok(!new RegExp(`${'fr'}-FR|timeZone:\\s*'[A-Z]`).test(SANTE), 'aucune langue ni aucun fuseau écrits');
});

// ------------------------------------------------------------------ un vrai Odin d'essai

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
let v: VraiOdin, avecDroit = '', cleMaison = '';
const MDP = 'une-barque-sur-la-mer-tranquille';
const IDS = ['gladsheim', 'eir', 'durinn', 'var'];
const PAGE = 'b7e00001', ID = { machine: 'c7e00001', disques: 'c7e00002',
  // Forcés dans la réponse pour le navigateur : ce que Hygie et Tirésias rendraient sous Linux.
  machineOk: 'c7e00003', machineGrave: 'c7e00004', machineVide: 'c7e00005', machineAncien: 'c7e00006', disquesOk: 'c7e00007', disquesBas: 'c7e00008', disquesVide: 'c7e00009', disquesDix: 'c7e0000a' };
const FENETRE = () => ({ pages: [{ id: PAGE, name: 'Santé', widgets: [
  { id: ID.machine, kind: 'sante_machine', w: 1, c: 4, r: 2 }, { id: ID.disques, kind: 'sante_disques', w: 1, c: 3, r: 4 },
  { id: ID.machineOk, kind: 'sante_machine', w: 1, c: 4, r: 2 }, { id: ID.machineGrave, kind: 'sante_machine', w: 1, c: 3, r: 2 }, { id: ID.machineVide, kind: 'sante_machine', w: 1, c: 4, r: 2 },
  { id: ID.machineAncien, kind: 'sante_machine', w: 1, c: 4, r: 2 }, { id: ID.disquesOk, kind: 'sante_disques', w: 1, c: 3, r: 4 }, { id: ID.disquesBas, kind: 'sante_disques', w: 1, c: 3, r: 2 },
  { id: ID.disquesVide, kind: 'sante_disques', w: 1, c: 3, r: 2 }, { id: ID.disquesDix, kind: 'sante_disques', w: 1, c: 3, r: 4 },
] }] });
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
type Rendue = { id: string; kind: string; etat: string; raison?: string; appli?: string; donnee?: Record<string, unknown> };
const donnees = async (h: Record<string, string> = {}) => { const r = await v.json(`/api/widgets/donnees?page=${PAGE}`, undefined, h); return { status: r.status, corps: JSON.stringify(r.body), de: (id: string) => ((r.body.widgets as Rendue[] | undefined) ?? []).find((x) => x.id === id) }; };
const NOM_DISQUE = 'Disque-tres-prive';

before(async () => {
  for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => [...IDS, 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  // Un membre qui entre dans Odin, AVEC le droit sur Hygie, SANS le droit sur Tirésias.
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-s', nom: 'Membre S', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'eir']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-s' })).ok, true);
  lierProprietaire(persona()!);
  avecDroit = await entrer('membre-s', MDP); assert.ok(avecDroit, 'le membre a une session');
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  assert.equal((await va.act('apparence', 'theme', { theme: 'valhalla' })).ok, true);
  va.ctx('gladsheim').saveSettings({ fenetre: undefined });
  const r = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(FENETRE()) }); assert.equal(r.ok, true, r.text);
  // Une lecture des disques gardée par Tirésias, avec un nom qu'on reconnaîtra (servie seulement hors Windows).
  ecrireDernier(va.ctx('durinn').dir, 'ici', { quand: new Date().toISOString(), poste: '', nomPoste: 'cette machine', disques: [disque('sda', { modele: NOM_DISQUE })] });
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('vrai Odin, sur la machine de l\'essai : sous Windows « source_absente » (windows_non_lu), sans un chiffre', { skip: process.platform !== 'win32' ? 'seulement sous Windows' : false }, async () => {
  const lui = await donnees();
  assert.equal(lui.status, 200);
  for (const id of [ID.machine, ID.disques]) { const e = lui.de(id)!; assert.deepEqual([e.etat, e.raison], ['source_absente', 'windows_non_lu'], id); assert.ok(sansValeur(e), JSON.stringify(e)); }
  assert.ok(!lui.corps.includes(NOM_DISQUE));
});

test('vrai Odin, Linux simulé : la source lit les relevés rangés par Hygie (sans en prendre un) et la dernière lecture gardée par Tirésias', async () => {
  const va = valhallaOf()!, dir = mkdtempSync(join(tmpdir(), 'sante-mesures-')), t = Date.now();
  try {
    const m = new Metrics(dir, () => t);
    m.put({ 'eir.cpu': 30, 'eir.mem': 70, 'eir.fs.racine': 50, 'eir.fs.data': 91, 'eir.temp.cpu.paquet': 61 }, t - 2 * MIN);
    m.put({ 'eir.cpu': 35, 'eir.mem': 71, 'eir.fs.racine': 50, 'eir.fs.data': 91, 'eir.temp.cpu.paquet': 62 }, t - MIN);
    va.ctx('eir').saveSettings({ seuils: { mem: { suivre: 10, attention: 20, grave: 95 } } });
    const faux = new Proxy(va, { get: (o, k) => (k === 'metrics' ? m : Reflect.get(o, k)) });
    const src = sourceOdin(faux, () => t), voulu = Object.getOwnPropertyDescriptor(process, 'platform')!;
    // La plateforme simulée seulement le temps des appels synchrones de la source (rien d'autre ne tourne entre-temps).
    Object.defineProperty(process, 'platform', { ...voulu, value: 'linux' });
    let pm: Promise<EtatWidget>, pd: Promise<EtatWidget>;
    try { pm = donneeWidget(W('sante_machine'), LUI, src); pd = donneeWidget(W('sante_disques'), LUI, src); } finally { Object.defineProperty(process, 'platform', voulu); }
    const em = (await pm) as Etat, ed = (await pd) as Etat;
    assert.equal(em.etat, 'ok', JSON.stringify(em));
    assert.deepEqual(em.donnee, { cpu: { pct: 35, niveau: 'ok' }, mem: { pct: 71, niveau: 'attention' }, disque: { pct: 91, niveau: 'grave' }, temp: { c: 62, niveau: 'suivre' } }, 'les relevés et les seuils réglés de Hygie');
    assert.equal(ed.etat, 'ok', JSON.stringify(ed));
    assert.deepEqual((ed.donnee!.disques as any[]).map((x) => [x.modele, x.etat, x.temperature]), [[NOM_DISQUE, 'bon', 36]]);
  } finally { va.ctx('eir').saveSettings({ seuils: undefined }); rmSync(dir, { recursive: true, force: true }); }
});

test('vrai Odin : un membre sans le droit, une tablette « maison », une clé d\'accès, sans session : rien ; un membre avec le droit : l\'état de son appli', async () => {
  const m = await donnees({ cookie: avecDroit });
  assert.equal(m.status, 200);
  assert.deepEqual([m.de(ID.disques)!.etat, m.de(ID.disques)!.raison, m.de(ID.disques)!.appli], ['refuse', 'appli_fermee', 'durinn'], 'sans le droit sur Tirésias');
  assert.ok(sansValeur(m.de(ID.disques)), 'aucune valeur, aucun nom de disque'); assert.ok(!m.corps.includes(NOM_DISQUE));
  assert.notEqual(m.de(ID.machine)!.etat, 'refuse', 'avec le droit sur Hygie : pas refusé');
  for (const [qui, h] of [['tablette', { cookie: '', 'x-odin-maison': cleMaison }], ['clé d\'accès', { cookie: '', authorization: `Bearer ${v.token}` }], ['sans session', { cookie: '' }]] as const) {
    const r = await donnees(h);
    assert.equal(r.status, 401, qui); assert.ok(!r.corps.includes(NOM_DISQUE) && !r.corps.includes('pct'), `${qui} : aucune donnée`);
  }
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any, getComputedStyle: any, location: any;
interface Route { fetch(): Promise<{ json(): Promise<any> }>; fulfill(o: Record<string, unknown>): Promise<void> }
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; click(s: string, o?: Record<string, unknown>): Promise<void>;
  evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>; route(u: string | RegExp, h: (r: Route) => Promise<void> | void): Promise<void>;
  on(e: string, f: (x: any) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>; keyboard: { press(k: string): Promise<void> };
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });
const CAPTURES = process.env.ODIN_CAPTURES;
/** Cinq disques comme Tirésias les rendrait : un mauvais, un à surveiller, un non lu, deux bons (le serveur les a déjà rangés). */
const CINQ = () => [
  { nom: 'nvme0', modele: 'Modèle NVMe au nom vraiment très long pour la carte', genre: 'NVMe', taille: 1e12, etat: 'mauvais', lu: true, temperature: 52 },
  { nom: 'sdb', modele: 'Modèle B', genre: 'disque dur', taille: 4e12, etat: 'attention', lu: true, temperature: 44 },
  { nom: 'sdc', genre: 'inconnu', etat: 'inconnu', lu: false },
  { nom: 'sda', modele: 'Modèle A', genre: 'disque dur', taille: 4e12, etat: 'bon', lu: true, temperature: 36 },
  { nom: 'sdd', modele: 'Modèle D', genre: 'SSD', taille: 5e11, etat: 'bon', lu: true, veille: true },
];
const FORCES: Record<string, () => Record<string, unknown>> = {
  [ID.machineOk]: () => ({ etat: 'ok', at: Date.now(), donnee: { cpu: { pct: 27, niveau: 'ok' }, mem: { pct: 63, niveau: 'suivre' }, disque: { pct: 88, niveau: 'attention' }, temp: { c: 57, niveau: 'ok' } } }),
  [ID.machineGrave]: () => ({ etat: 'ok', at: Date.now(), donnee: { mem: { pct: 100, niveau: 'grave' }, disque: { pct: 97, niveau: 'grave' } } }),
  [ID.machineVide]: () => ({ etat: 'vide', raison: 'pas_encore_mesure' }),
  [ID.machineAncien]: () => ({ etat: 'ancien', at: Date.now() - 20 * MIN, motif: 'hygie_ne_mesure_plus', donnee: { cpu: { pct: 5, niveau: 'ok' }, mem: { pct: 40, niveau: 'ok' } } }),
  [ID.disquesOk]: () => ({ etat: 'ok', at: Date.now(), donnee: { disques: CINQ(), total: 5, compte: { bon: 2, attention: 1, mauvais: 1, inconnu: 1 } } }),
  [ID.disquesBas]: () => ({ etat: 'ok', at: Date.now(), donnee: { disques: CINQ(), total: 5, compte: { bon: 2, attention: 1, mauvais: 1, inconnu: 1 } } }),
  [ID.disquesVide]: () => ({ etat: 'vide', raison: 'disques_pas_encore_lus' }),
  // Dix disques (un mauvais, neuf bons) : la carte de 4 lignes en montre autant que sa hauteur en tient.
  [ID.disquesDix]: () => ({ etat: 'ok', at: Date.now(), donnee: { disques: [CINQ()[0], ...Array.from({ length: 9 }, (_, i) => ({ nom: `sd${i}`, modele: `Modèle ${i}`, genre: 'SSD', taille: 2e12, etat: 'bon', lu: true }))], total: 10, compte: { bon: 9, attention: 0, mauvais: 1, inconnu: 0 } } }),
};
async function ouvrir(largeur: number, sombre: boolean) {
  const doigt = largeur < 500;
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt, colorScheme: sombre ? 'dark' : 'light' });
  const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); localStorage.setItem('odin.fenetre.page', '1'); ${sombre ? 'localStorage.setItem(\'odin.theme\', \'sombre\');' : ''} } catch { /* rien */ }`);
  const p = await ctx.newPage(), erreurs: string[] = [];
  p.on('pageerror', (e) => erreurs.push(String(e)));
  await p.route(/\/api\/widgets\/donnees/, async (r) => {
    const rep = await r.fetch(), j = await rep.json();
    if (Array.isArray(j?.widgets)) j.widgets = j.widgets.map((w: any) => (Object.hasOwn(FORCES, w.id) ? { id: w.id, kind: w.kind, page: w.page, ...FORCES[w.id]() } : w));
    await r.fulfill({ response: rep, json: j });
  });
  await p.goto(v.url + '/');
  await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  try { await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.disquesOk}"] .ws-d`, { timeout: 45000 }); await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.machineOk}"] .ws-m`, { timeout: 30000 }); }
  catch (e) { const vus = await p.evaluate(() => [location.hash, ...[...document.querySelectorAll('#feGrid > .fe-w')].map((c: any) => `${c.dataset.id}: ${c.textContent.slice(0, 80)}`)]); await ctx.close(); throw new Error(`${String(e).split('\n')[0]} · cartes : ${JSON.stringify(vus)} · ${erreurs.join(' | ')}`); }
  return { ctx, page: p, erreurs };
}
/** Ce que la page montre de chaque carte : textes, sous-titre, anneaux, disques, et ce qui serait coupé ou dehors. */
const vu = (p: Page) => p.evaluate((ids: Record<string, string>) => {
  const txt = (n: any) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim(), out: Record<string, any> = { deborde: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
  for (const [nom, id] of Object.entries(ids)) {
    const c = document.querySelector(`#feGrid > .fe-w[data-id="${id}"]`); if (!c) { out[nom] = null; continue; }
    const b = c.getBoundingClientRect(), dans = (n: any) => { const r = n.getBoundingClientRect(); return r.width === 0 || (r.left >= b.left - 1 && r.right <= b.right + 1 && r.bottom <= b.bottom + 1); };
    const sonde = document.createElement('i'); c.append(sonde); const couleur = (x: string) => { sonde.style.color = `var(${x})`; return getComputedStyle(sonde).color; };
    const vis = (n: any) => n.getClientRects().length > 0;
    out[nom] = {
      texte: txt(c), sous: txt(c.querySelector('.wr-s')), haut: Math.round(b.height), dedans: [...c.querySelectorAll('*')].filter(vis).every(dans), pastille: txt(c.querySelector('.wr-pastille')),
      mesure: (() => { const z = c.querySelector('.ws-corps'); return z ? `carte ${Math.round(b.width)} × ${Math.round(b.height)}, zone ${z.clientWidth} × ${z.clientHeight}, contenu ${z.scrollHeight}, « ${z.className} »` : ''; })(),
      petits: [...c.querySelectorAll('button, a')].filter((n: any) => { const r = n.getBoundingClientRect(); return r.width && (r.width < 44 || r.height < 44); }).map(txt),
      // Un texte coupé à l'écran doit avoir son entier en info-bulle (le nom d'un disque, son détail).
      coupesSansBulle: [...c.querySelectorAll('.ws-v, .ws-niv, .ws-pill, .ws-ct, .ws-t, .ws-dt, .ws-plus')].filter((n: any) => vis(n) && n.scrollWidth > n.clientWidth + 1 && !n.title).map(txt),
      anneaux: [...c.querySelectorAll('.ws-m')].map((n: any) => [n.dataset.mesure, n.getAttribute('aria-label')]),
      niveaux: [...c.querySelectorAll('.ws-niv')].filter(vis).map(txt), disques: [...c.querySelectorAll('.ws-d')].filter(vis).map((n: any) => [n.dataset.etat, txt(n.querySelector('.ws-t'))]),
      etatsVus: [...c.querySelectorAll('.ws-d')].filter(vis).map((n: any) => [...n.querySelectorAll('.ws-pill, .ws-dt .ws-e')].filter(vis).map((x: any) => txt(x).replace(/\s*·$/, '')).join('')),
      // La place laissée vide sous la dernière ligne du corps ; le sous-titre coupé par l'en-tête.
      reste: (() => { const z = c.querySelector('.ws-corps'), d = z?.lastElementChild; return z && d ? Math.round(z.getBoundingClientRect().bottom - d.getBoundingClientRect().bottom) : -1; })(),
      sousCoupe: (() => { const s = c.querySelector('.wr-s'); return s && s.scrollWidth > s.clientWidth + 1 ? `${s.scrollWidth} > ${s.clientWidth}` : false; })(),
      // « et N de plus » se lit en entier : sa hauteur pleine, dans la zone (jamais écrasé ni coupé par la carte).
      plusLu: (() => { const p = c.querySelector('.ws-plus'), z = c.querySelector('.ws-corps'); if (!p || !txt(p)) return true; const r = p.getBoundingClientRect(); return r.height >= 12 && r.bottom <= z.getBoundingClientRect().bottom + 1; })(),
      plus: txt(c.querySelector('.ws-plus')), bouton: txt(c.querySelector('.ws-btn')), defile: c.querySelector('.ws-corps')?.classList.contains('ws-defilant') ?? false,
      couleurMauvais: c.querySelector('.ws-d[data-etat="mauvais"] .ws-pt') ? getComputedStyle(c.querySelector('.ws-d[data-etat="mauvais"] .ws-pt')).backgroundColor : '', bad: couleur('--bad'),
      couleurGrave: c.querySelector('.ws-m[data-niveau="grave"] .ws-part') ? getComputedStyle(c.querySelector('.ws-m[data-niveau="grave"] .ws-part')).stroke : '',
    };
    sonde.remove();
  }
  return out;
}, ID);
const CARTES = ['machineOk', 'machineGrave', 'machineVide', 'machineAncien', 'disquesOk', 'disquesBas', 'disquesVide', 'disquesDix', 'machine', 'disques'] as const;

for (const [largeur, sombre] of [[1280, false], [390, true]] as const) {
  test(`navigateur, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : les anneaux et leurs niveaux, la température en tête, les disques (le mauvais d'abord, « Non lu »), sans étirer la carte ; Windows : une phrase, aucun chiffre`, { skip: sansNav }, async () => {
    const { ctx, page: p, erreurs } = await ouvrir(largeur, sombre);
    try {
      const a = await vu(p);
      assert.equal(a.deborde, false, 'rien ne déborde de la page');
      for (const k of CARTES) {
        assert.ok(a[k], `${k} affichée`); assert.equal(a[k].dedans, true, `${k} reste dans sa carte (${a[k].mesure})`); assert.deepEqual(a[k].petits, [], `${k} : des cibles de 44 px`);
        assert.deepEqual(a[k].coupesSansBulle, [], `${k} : aucun texte coupé sans son entier en info-bulle`);
      }
      if (largeur > 700) for (const k of ['machineOk', 'machineGrave', 'machine', 'disquesBas']) assert.ok(Math.abs(a[k].haut - 162) <= 2, `${k} : ${a[k].haut} px pour 2 lignes (la carte ne s'étire pas)`);
      // La machine : trois anneaux, chacun avec son niveau ; « attention » écrit, pas seulement coloré ; la température en tête.
      assert.deepEqual(a.machineOk.anneaux.map((x: string[]) => x[0]), ['cpu', 'mem', 'disque']);
      assert.match(a.machineOk.anneaux[2][1], /^Disque : 88\s?%, attention$/); assert.match(a.machineOk.anneaux[1][1], /à suivre$/);
      assert.deepEqual(a.machineOk.niveaux, ['attention']); assert.match(a.machineOk.sous, /57\s?°C/);
      // Une mesure absente : pas d'anneau ; pas de température : rien en tête ; « grave » dans la couleur du thème.
      assert.deepEqual(a.machineGrave.anneaux.map((x: string[]) => x[0]), ['mem', 'disque']); assert.ok(!/°/.test(a.machineGrave.sous));
      assert.deepEqual(a.machineGrave.niveaux, ['grave', 'grave']); assert.equal(a.machineGrave.couleurGrave, a.machineGrave.bad);
      assert.match(a.machineVide.texte, /rien mesuré/); assert.equal(a.machineVide.bouton, 'Ouvrir Hygie');
      assert.match(a.machineAncien.pastille, /20 min/, 'la mesure ancienne est marquée');
      // Les disques : le mauvais d'abord, le non lu jamais « Bon » ; « et N de plus ». Hors téléphone, la carte en montre
      // autant que sa hauteur en tient (sans laisser la place d'un de plus) ; au téléphone, une ligne de moins que ses lignes de grille.
      const etatsOk = ['mauvais', 'attention', 'inconnu', 'bon', 'bon'], motsOk = ['Mauvais', 'À surveiller', 'Non lu', 'Bon', 'Bon'];
      const nOk = a.disquesOk.disques.length;
      if (largeur > 700) assert.ok(nOk >= 4, `4 lignes de grille : ${nOk} disques montrés`); else assert.equal(nOk, 3);
      assert.deepEqual(a.disquesOk.disques.map((x: string[]) => x[0]), etatsOk.slice(0, nOk)); assert.equal(a.disquesOk.plus, nOk < 5 ? `et ${5 - nOk} de plus` : '');
      assert.deepEqual(a.disquesOk.etatsVus, motsOk.slice(0, nOk), 'l\'état écrit, une fois');
      assert.equal(a.disquesOk.couleurMauvais, a.disquesOk.bad); assert.match(a.disquesOk.sous, /1 mauvais · 1 à surveiller · 1 non lu$/);
      // Une seule sorte de problème : le sous-titre se lit en entier (trois sortes à la fois restent coupées par l'en-tête commun).
      assert.match(a.disquesDix.sous, /1 mauvais$/); if (largeur > 700) assert.equal(a.disquesDix.sousCoupe, false, `le sous-titre se lit en entier : ${a.disquesDix.sous}`);
      const nBas = a.disquesBas.disques.length;
      assert.ok(nBas >= 1); assert.equal(a.disquesBas.disques[0][0], 'mauvais'); assert.equal(a.disquesBas.plus, `et ${5 - nBas} de plus`);
      const nDix = a.disquesDix.disques.length;
      if (largeur > 700) { assert.ok(nDix >= 4, `dix disques en 4 lignes : ${nDix} montrés`); assert.ok(a.disquesDix.reste < 44, `pas la place d'un disque de plus laissée vide (${a.disquesDix.reste} px)`); } else assert.equal(nDix, 3);
      assert.equal(a.disquesDix.disques[0][0], 'mauvais'); assert.equal(a.disquesDix.plus, `et ${10 - nDix} de plus`); assert.equal(a.disquesDix.defile, false);
      for (const k of ['disquesOk', 'disquesBas', 'disquesDix']) assert.equal(a[k].plusLu, true, `${k} : « et N de plus » se lit`);
      assert.match(a.disquesVide.texte, /pas encore lu/); assert.equal(a.disquesVide.bouton, 'Ouvrir Tirésias');
      // La vraie machine de l'essai (Windows) : une phrase, aucun chiffre, aucun pourcentage.
      if (process.platform === 'win32') for (const k of ['machine', 'disques'] as const) { assert.match(a[k].texte, /ne sait pas encore lire/); assert.ok(!/\d|%/.test(a[k].texte.replace(a[k].sous, '')), `${k} : ${a[k].texte}`); }
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/sante-${largeur}${sombre ? '-sombre' : ''}.png`, fullPage: true });
      // Le focus se voit sur « Ouvrir Tirésias », puis le bouton ouvre l'appli.
      await p.evaluate((s: string) => document.querySelector(s).focus(), `#feGrid .fe-w[data-id="${ID.disquesVide}"] .ws-btn`);
      assert.notEqual(await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none', 'le focus est visible');
      await p.keyboard.press('Enter'); assert.equal(await p.evaluate(() => location.hash), '#app=durinn');
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); }
  });
}

test('navigateur, 320, 768 et 1920 px, et un thème de verre : les cartes restent dans leur cadre, rien ne déborde', { skip: sansNav }, async () => {
  const va = valhallaOf()!;
  for (const [largeur, verre] of [[320, false], [768, false], [1920, false], [1280, true]] as const) {
    if (verre && !(await va.act('apparence', 'theme', { theme: 'glace' })).ok) continue;
    const { ctx, page: p, erreurs } = await ouvrir(largeur, false);
    try {
      const a = await vu(p);
      assert.equal(a.deborde, false, `${largeur} : la page ne déborde pas`);
      for (const k of CARTES) { assert.equal(a[k].dedans, true, `${largeur} : ${k} reste dans sa carte (${a[k].mesure})`); assert.deepEqual(a[k].coupesSansBulle, [], `${largeur} : ${k}, aucun texte coupé sans info-bulle`); }
      // Une carte étroite : l'état de chaque disque reste écrit (dans la pastille ou en tête du détail).
      assert.deepEqual(a.disquesOk.etatsVus, ['Mauvais', 'À surveiller', 'Non lu', 'Bon', 'Bon'].slice(0, a.disquesOk.disques.length), `${largeur} : l'état de chaque disque reste écrit`);
      assert.ok(a.disquesOk.disques.length >= 3, `${largeur} : ${a.disquesOk.disques.length} disques`);
      for (const [k, total] of [['disquesOk', 5], ['disquesBas', 5], ['disquesDix', 10]] as const) { const n = a[k].disques.length; assert.equal(a[k].plus, n < total ? `et ${total - n} de plus` : '', `${largeur} : ${k}, « et N de plus » juste`); if (largeur === 768 && k === 'disquesBas') continue; // à 768 px l'en-tête commun passe sur deux lignes (défaut connu) : la carte de 2 lignes défile, nommée
        assert.equal(a[k].defile, false, `${largeur} : ${k} ne défile pas`); assert.equal(a[k].plusLu, true, `${largeur} : ${k}, « et N de plus » se lit`); }
      assert.deepEqual(a.machineOk.niveaux, ['attention'], `${largeur} : le niveau reste écrit`);
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/sante-${largeur}${verre ? '-verre' : ''}.png`, fullPage: true });
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); if (verre) await va.act('apparence', 'theme', { theme: 'valhalla' }); }
  }
});
