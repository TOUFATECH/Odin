// Couper un lien d'alerte (livraison L2, premier lot : ullr, sindri, eir, naglfar, ymir, hermod ; deuxième : svalinn,
// skuld, vidarr, mimisbrunnr, gna, vordr ; troisième : askr, valgrind, var, bru, thjalfi, skidbladnir, gjoll ; quatrième : idunn, syn, hlin, durinn, pegase, hel). Une alerte porte la
// clé de son lien ; au point central (`Valhalla.alert`), si ce lien est coupé, l'alerte est rangée et visible comme
// d'habitude, mais son message ne part pas sur la messagerie, et elle garde la trace « message non envoyé : lien coupé
// par toi ». Couper le lien n'arrête pas ce que fait l'appli : seul le message est en jeu. Une alerte sans clé ne
// change pas. Un état illisible ne coupe rien. Comme en L1 : un lien qui protège se confirme, lève une alerte haute (qui,
// elle, part toujours) et se rétablit seul ; seule la session du navigateur du propriétaire coupe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as liens from '../src/valhalla/links.ts';
import { couperLien, lienCoupe, type LienACouper } from '../src/valhalla/automatismes.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import type { Alert, Module } from '../src/valhalla/types.ts';
import { lignesLiensEcrits } from '../src/web/talos-api.ts';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { relierProprietaire } from '../src/valhalla/sso/etat.ts';
import { startDraupnir } from '../src/draupnir/odin.ts';
import { gna } from '../src/valhalla/modules/gna.ts';
import { tousLesChoix } from '../src/valhalla/gna/historique.ts';
import { resetVordr, runOne, vordr } from '../src/valhalla/modules/vordr.ts';
import { askr } from '../src/valhalla/modules/askr.ts';
import { skidbladnir } from '../src/valhalla/modules/skidbladnir.ts';
import { suivi } from '../src/valhalla/thjalfi/suivi.ts';
import { hlin } from '../src/valhalla/modules/hlin.ts';
import { nouvelAppareil } from '../src/valhalla/modules/pegase.ts';
import { oublierMagasin } from '../src/valhalla/pegase/store.ts';
import { syn } from '../src/valhalla/modules/syn.ts';
import { lireSmart } from '../src/valhalla/durinn/smart.ts';
import { alertesDe, noter } from '../src/valhalla/durinn/suivi.ts';

const { LINKS } = liens;
const BRANCHEES = (liens as { ALERTES_BRANCHEES?: ReadonlySet<string> }).ALERTES_BRANCHEES;
const VALHALLA = fileURLToPath(new URL('../src/valhalla/', import.meta.url));

// Combien d'appels d'alerte portent la clé, lien par lien (relus à la main : carnets couper-un-lien-l2a,
// couper-un-lien-l2b, couper-un-lien-l2c et couper-un-lien-l2d). Un appel ajouté ou retiré fait échouer l'essai : il faut le relire.
const APPELS: Record<string, number> = {
  'ullr-alerte-menace': 5,
  'sindri-alerte-sauvegarde': 2,
  'eir-alerte-saturation': 2,
  'naglfar-alerte-conteneur': 1,
  'ymir-alerte-machine-virtuelle': 3,
  'hermod-alerte-machine-disparue': 1,
  // Deuxième lot (L2b).
  'svalinn-alerte-wifi': 2,
  'skuld-alerte-sauvegarde-base': 1,
  'vidarr-alerte-site-dangereux': 1,
  'vidarr-alerte-inondation-dns': 1,
  'vidarr-alerte-dns-amont': 1,
  'vidarr-alerte-appareil-inconnu': 1,
  'mimisbrunnr-alerte-message-repete': 1,
  'gna-alerte-historique': 1,
  'vordr-alerte-sonde': 3,
  // Troisième lot (L2c). Genèse : l'envoi commun des notifications regroupées (thjalfi/suivi.ts : début, fin, échec,
  // abandon, poste inconnu) et le poste bloqué qui se présente.
  'askr-alerte-garantie': 3,
  'valgrind-alerte-service': 2,
  'var-alerte-compte-verrouille': 2,
  'bru-alerte-tunnel': 1,
  'thjalfi-alerte-installation': 2,
  'skidbladnir-alerte-fichiers': 3,
  'gjoll-alerte-fin-acces': 1,
  // Quatrième lot (L2d). Arachné : l'envoi commun de son journal, pour les seuls événements du lien ; Tirésias : les
  // alertes de dégradation (sauf le câble) et le disque qui ne répond plus.
  'idunn-alerte-site': 1,
  'syn-alerte-seuil': 1,
  'hlin-alerte-donnees-perso': 2,
  'durinn-alerte-disque': 2,
  'pegase-alerte-telechargement': 3,
  'agora-alerte-store': 3,
  'hel-alerte-recuperation': 3,
};
/** Les liens du deuxième lot. */
const LOT2 = ['svalinn-alerte-wifi', 'skuld-alerte-sauvegarde-base', 'vidarr-alerte-site-dangereux', 'vidarr-alerte-inondation-dns',
  'vidarr-alerte-dns-amont', 'vidarr-alerte-appareil-inconnu', 'mimisbrunnr-alerte-message-repete', 'gna-alerte-historique', 'vordr-alerte-sonde'];
/** Les liens du troisième lot. */
const LOT3 = ['askr-alerte-garantie', 'valgrind-alerte-service', 'var-alerte-compte-verrouille', 'bru-alerte-tunnel', 'thjalfi-alerte-installation',
  'skidbladnir-alerte-fichiers', 'gjoll-alerte-fin-acces'];
/** Les liens du quatrième lot. Agora (agora-alerte-store) n'en est pas : ses alertes du lien sont levées hors de src/valhalla. */
const LOT4 = ['idunn-alerte-site', 'syn-alerte-seuil', 'hlin-alerte-donnees-perso', 'durinn-alerte-disque', 'pegase-alerte-telechargement',
  'hel-alerte-recuperation'];

/** Un fichier rangé ailleurs où l'appli lève elle-même une alerte de son lien (même contexte) : déclaré à la main, un par un. */
const AUSSI: Record<string, string[]> = { var: ['sso/oidc.ts'], agora: ['../web/agora-api.ts'], pegase: ['../web/pegase-api.ts'] };
/** Les fichiers d'une appli : son module, son dossier s'il existe, et ceux déclarés ci-dessus. */
function fichiersDe(app: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const tour = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) tour(p); else if (n.endsWith('.ts')) out.push([relative(VALHALLA, p).replace(/\\/g, '/'), readFileSync(p, 'utf8')]); } };
  try { out.push([`modules/${app}.ts`, readFileSync(join(VALHALLA, 'modules', `${app}.ts`), 'utf8')]); } catch { /* pas de module */ }
  try { if (statSync(join(VALHALLA, app)).isDirectory()) tour(join(VALHALLA, app)); } catch { /* pas de dossier */ }
  for (const f of AUSSI[app] ?? []) out.push([f, readFileSync(join(VALHALLA, f), 'utf8')]);
  return out;
}
/** Tous les fichiers de src/valhalla. */
function toutValhalla(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const tour = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) tour(p); else if (n.endsWith('.ts')) out.push([relative(VALHALLA, p).replace(/\\/g, '/'), readFileSync(p, 'utf8')]); } };
  tour(VALHALLA);
  // Les fichiers déclarés à la main qui vivent hors de src/valhalla (les routes web d'une appli).
  for (const f of Object.values(AUSSI).flat()) if (f.startsWith('../')) out.push([f, readFileSync(join(VALHALLA, f), 'utf8')]);
  return out;
}
/**
 * Le texte de chaque appel `alert(` d'un fichier, de la parenthèse ouvrante à la fermante (les chaînes, y compris les
 * gabarits et leurs `${…}`, sont sautées pour compter les parenthèses).
 */
function appelsAlerte(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\balert\(/g)) {
    let i = m.index! + m[0].length, prof = 1;
    const pile: string[] = []; // gabarits ouverts
    while (i < src.length && prof > 0) {
      const c = src[i];
      if (pile.length && pile.at(-1) === '`') {
        if (c === '\\') { i += 2; continue; }
        if (c === '`') { pile.pop(); i++; continue; }
        if (c === '$' && src[i + 1] === '{') { pile.push('{'); i += 2; continue; }
        i++; continue;
      }
      if (c === "'" || c === '"') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; continue; }
      if (c === '`') { pile.push('`'); i++; continue; }
      if (c === '{') { if (pile.length) pile.push('{'); i++; continue; }
      if (c === '}') { if (pile.length && pile.at(-1) === '{') pile.pop(); i++; continue; }
      if (!pile.length || pile.at(-1) === '{') { if (c === '(') prof++; else if (c === ')') prof--; }
      i++;
    }
    out.push(src.slice(m.index!, i));
  }
  return out;
}

test('vingt-cinq applis branchées : chaque lien d\'alerte porte sa clé sur les appels qui en relèvent, et seulement eux', () => {
  assert.ok(BRANCHEES, 'links.ts dit quels liens d\'alerte sont branchés (ALERTES_BRANCHEES)');
  assert.deepEqual([...BRANCHEES!].sort(), Object.keys(APPELS).sort());
  for (const id of BRANCHEES!) {
    const l = LINKS.find((x) => x.id === id);
    assert.ok(l, id); assert.equal(l!.to, 'forseti', id);
    assert.ok('par' in l!.coupure && l!.coupure.par === 'alerte', `${id} : « par son alerte »`);
    const appels = fichiersDe(l!.from).flatMap(([, t]) => appelsAlerte(t)).filter((a) => a.includes(`lien: '${id}'`));
    assert.ok(appels.length >= 1, `${id} : sa clé apparaît dans au moins un appel d'alerte de ${l!.from}`);
    assert.equal(appels.length, APPELS[id], `${id} : ${appels.length} appel(s) portent la clé, la relecture en comptait ${APPELS[id]}`);
  }
  // Partout dans Valhalla : une clé de lien posée sur une alerte est une clé branchée, dans un fichier de l'appli source.
  const vus = new Map<string, number>();
  for (const [f, t] of toutValhalla()) {
    for (const a of appelsAlerte(t)) for (const m of a.matchAll(/\blien: '([a-z0-9-]+)'/g)) {
      const l = LINKS.find((x) => x.id === m[1]);
      assert.ok(l && BRANCHEES!.has(m[1]), `${f} : la clé « ${m[1]} » n'est pas un lien d'alerte branché`);
      assert.ok(f === `modules/${l!.from}.ts` || f.startsWith(`${l!.from}/`) || (AUSSI[l!.from] ?? []).includes(f), `${f} : la clé « ${m[1]} » est posée hors de ${l!.from}`);
      vus.set(m[1], (vus.get(m[1]) ?? 0) + 1);
    }
  }
  assert.deepEqual(Object.fromEntries([...vus].sort()), Object.fromEntries(Object.entries(APPELS).sort()));
  // Une clé posée seule (hors d'un appel d'alerte) dans les applis branchées : rien.
  for (const app of new Set([...BRANCHEES!].map((id) => LINKS.find((x) => x.id === id)!.from))) for (const [f, t] of fichiersDe(app)) {
    const dansAlertes = appelsAlerte(t).reduce((n, a) => n + [...a.matchAll(/\blien: '[a-z0-9-]+-alerte-[a-z0-9-]+'/g)].length, 0);
    assert.equal([...t.matchAll(/\blien: '[a-z0-9-]+-alerte-[a-z0-9-]+'/g)].length, dansAlertes, `${f} : une clé de lien hors d'un appel d'alerte`);
  }
});

test('les liens qui se coupent d\'ici : les 21 à point unique et les 29 alertes : toutes sont branchées', () => {
  const lignes = lignesLiensEcrits(undefined);
  const coupables = lignes.filter((x) => x.coupable).map((x) => x.id.slice(5));
  const attendus = LINKS.filter((l) => 'par' in l.coupure && (l.coupure.par === 'reflexe' || (l.coupure.par === 'alerte' && BRANCHEES?.has(l.id)))).map((l) => l.id);
  assert.deepEqual(coupables, attendus);
  assert.equal(coupables.length, 21 + 6 + 9 + 7 + 6 + 1);
  for (const id of [...LOT2, ...LOT3, ...LOT4]) assert.ok(coupables.includes(id), `${id} se coupe d'ici`);
  // Plus aucun lien d'alerte ne reste « pas encore » : Agora est branché par ses routes web (table AUSSI).
  const autres = LINKS.filter((l) => 'par' in l.coupure && l.coupure.par === 'alerte' && !BRANCHEES?.has(l.id));
  assert.deepEqual(autres.map((l) => l.id), []);
  for (const l of autres) assert.equal(lignes.find((x) => x.id === `lien:${l.id}`)!.coupable, false, l.id);
});

/** Une Valhalla neuve avec deux applis d'essai, qui note les messages envoyés et les alertes émises. */
function bancValhalla(fichierAutomatismes?: string, autres: Array<string | Module> = []) {
  const home = mkdtempSync(join(tmpdir(), 'liens-coupes-alertes-'));
  if (fichierAutomatismes !== undefined) { mkdirSync(join(home, 'valhalla'), { recursive: true }); writeFileSync(join(home, 'valhalla', 'automatismes.json'), fichierAutomatismes); }
  let now = new Date('2026-11-18T10:00:00Z');
  const messages: string[] = [], emises: Alert[] = [];
  const mod = (id: string, name: string) => ({ id, name, family: 'Système', what: 'essai', does: [], from: [], upstream: [], words: [], actions: [], view: () => ({ sections: [] }) }) as unknown as Module;
  const v = new Valhalla(home, [mod('hermod', 'Hermès'), mod('ullr', 'Asclépios'), ...autres.map((x) => (typeof x === 'string' ? mod(x, x) : x))], { notify: async (t) => { messages.push(t); }, now: () => now });
  v.events.on('alert', (a: Alert) => emises.push(a));
  return { v, messages, emises, get now() { return now; }, set now(d: Date) { now = d; }, fin: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}
const QUI = 'le propriétaire (essai)';
const HERMOD: LienACouper = { id: 'hermod-alerte-machine-disparue', nom: 'Hermès → Forseti', de: 'hermod', protege: false, qui: QUI };
const ULLR: LienACouper = { id: 'ullr-alerte-menace', nom: 'Asclépios → Forseti', de: 'ullr', protege: { raison: 'porte jusqu\'à toi l\'alerte d\'une menace trouvée' }, qui: QUI };

test('lien coupé : l\'alerte est rangée et visible, son message ne part pas, la trace est là ; rétabli, le message part', () => {
  const b = bancValhalla();
  try {
    const ctx = b.v.ctx('hermod');
    // Avant toute coupure : le message part, comme aujourd'hui.
    ctx.alert({ level: 'haute', title: 'Poste-1 ne répond plus', key: 'down:1', lien: 'hermod-alerte-machine-disparue' });
    assert.equal(b.messages.length, 1);
    assert.equal(couperLien(HERMOD, true, { confirme: true }).ok, true);
    assert.equal(b.messages.length, 1, 'la coupure d\'un lien qui ne protège pas pose une alerte moyenne (sous le seuil du message)');
    const avant = b.emises.length;
    const r = ctx.alert({ level: 'critique', title: 'Poste-2 ne répond plus', key: 'down:2', lien: 'hermod-alerte-machine-disparue' }) as unknown as Alert & { nonEnvoye?: string };
    assert.equal(b.messages.length, 1, 'lien coupé : le message ne part pas, même critique');
    assert.equal(r.nonEnvoye, 'message non envoyé : lien coupé par toi');
    assert.equal(b.emises.length, avant + 1, 'l\'alerte est émise dans Odin (bulle, fil) comme d\'habitude');
    const rangee = b.v.alerts({ module: 'hermod' }).find((a) => a.title === 'Poste-2 ne répond plus') as (Alert & { nonEnvoye?: string }) | undefined;
    assert.ok(rangee, 'l\'alerte est rangée dans le fil commun');
    assert.equal(rangee!.nonEnvoye, 'message non envoyé : lien coupé par toi');
    assert.equal(rangee!.lien, 'hermod-alerte-machine-disparue');
    // Une alerte SANS clé de la même appli : inchangée (le message part, aucune trace).
    const sans = ctx.alert({ level: 'haute', title: 'Disque de Poste-2 presque plein', key: 'disk:2' })! as Alert & { nonEnvoye?: string };
    assert.equal(b.messages.length, 2); assert.match(b.messages[1], /Hermès — Disque de Poste-2 presque plein/);
    assert.equal(sans.nonEnvoye, undefined); assert.equal('lien' in sans, false);
    // Une alerte d'un autre lien, non coupé : le message part.
    b.v.ctx('ullr').alert({ level: 'haute', title: 'Asclépios : menace', key: 'hit:1', lien: 'ullr-alerte-menace' });
    assert.equal(b.messages.length, 3);
    // Rétabli : le message part de nouveau.
    assert.equal(couperLien(HERMOD, false).ok, true);
    const apres = ctx.alert({ level: 'haute', title: 'Poste-3 ne répond plus', key: 'down:3', lien: 'hermod-alerte-machine-disparue' }) as unknown as Alert & { nonEnvoye?: string };
    assert.equal(b.messages.length, 4); assert.equal(apres.nonEnvoye, undefined);
  } finally { b.fin(); }
});

test('un lien qui protège : confirmation avec sa raison, alerte haute qui part toujours, retour seul à l\'échéance', () => {
  const b = bancValhalla();
  try {
    const ctx = b.v.ctx('ullr');
    const a = couperLien(ULLR, true) as { ok: boolean; code?: string; confirm?: string };
    assert.equal(a.code, 'accord'); assert.match(a.confirm!, /Ce lien protège : porte jusqu'à toi l'alerte d'une menace trouvée/);
    // L'heure de fin, aujourd'hui, se lit « jusqu'à 11 h 00 » (pas « jusqu'à à 11 h 00 »), vu à l'écran.
    assert.doesNotMatch(a.confirm!, /jusqu'à à/);
    assert.equal(lienCoupe('ullr-alerte-menace'), false);
    assert.equal(couperLien(ULLR, true, { confirme: true }).ok, true);
    // L'alerte qui prévient de la coupure part TOUJOURS, même venant de l'appli dont le lien est coupé.
    assert.equal(b.messages.length, 1); assert.match(b.messages[0], /Lien coupé jusqu'à .*Asclépios → Forseti/);
    const coupure = b.v.alerts({ module: 'ullr' })[0] as Alert & { nonEnvoye?: string };
    assert.equal(coupure.level, 'haute'); assert.equal(coupure.nonEnvoye, undefined);
    // Pendant la coupure : la menace est rangée, son message ne part pas.
    ctx.alert({ level: 'critique', title: 'Asclépios a bloqué essai.exe', key: 'arrivee:1', lien: 'ullr-alerte-menace' });
    assert.equal(b.messages.length, 1);
    assert.ok(b.v.alerts({ module: 'ullr' }).some((x) => x.title === 'Asclépios a bloqué essai.exe'));
    // 1 h par défaut : à l'échéance, le lien se rétablit seul et le message repart.
    b.now = new Date(b.now.getTime() + 3600_000 + 1);
    assert.equal(lienCoupe('ullr-alerte-menace'), false);
    ctx.alert({ level: 'critique', title: 'Asclépios a bloqué essai2.exe', key: 'arrivee:2', lien: 'ullr-alerte-menace' });
    assert.equal(b.messages.length, 2); assert.match(b.messages[1], /essai2\.exe/);
    assert.ok(b.v.alerts({ module: 'ullr' }).find((x) => x.id === coupure.id)!.ack, 'l\'alerte de coupure est vue au rétablissement');
  } finally { b.fin(); }
});

test('une alerte retenue pendant la coupure n\'est pas « déjà envoyée » : au retour du lien, sa première occurrence part', () => {
  const b = bancValhalla();
  try {
    const ctx = b.v.ctx('ullr');
    assert.equal(couperLien(ULLR, true, { confirme: true }).ok, true);
    const n = b.messages.length; // l'alerte de coupure
    const menace = { level: 'critique' as const, title: 'Asclépios a bloqué essai.exe', key: 'a', lien: 'ullr-alerte-menace' };
    assert.ok(ctx.alert(menace), 'retenue mais rangée');
    // Pendant la coupure : la même alerte reste comptée, pas rangée deux fois.
    b.now = new Date(b.now.getTime() + 60_000);
    assert.equal(ctx.alert(menace), undefined);
    assert.equal(b.messages.length, n);
    // Retour seul à l'échéance : la menace toujours présente part enfin (sans attendre la fin des 6 h).
    b.now = new Date(b.now.getTime() + 3600_000);
    assert.equal(lienCoupe('ullr-alerte-menace'), false);
    assert.ok(ctx.alert(menace), 'au retour du lien, elle passe');
    assert.equal(b.messages.length, n + 1, 'son message part'); assert.match(b.messages.at(-1)!, /essai\.exe/);
    // Une fois partie, la règle des 6 h reprend comme d'habitude.
    b.now = new Date(b.now.getTime() + 60_000);
    assert.equal(ctx.alert(menace), undefined);
    assert.equal(b.messages.length, n + 1);
    // Témoin : une alerte sans clé, déjà envoyée, reste comptée dans les 6 h (inchangé).
    ctx.alert({ level: 'haute', title: 'Sans clé', key: 'sans' });
    const m = b.messages.length;
    b.now = new Date(b.now.getTime() + 60_000);
    assert.equal(ctx.alert({ level: 'haute', title: 'Sans clé', key: 'sans' }), undefined);
    assert.equal(b.messages.length, m);
  } finally { b.fin(); }
});

// Deuxième lot : pour chaque lien, une alerte qui en relève (titre et clé des appels qui portent la clé) et une alerte
// de la même appli qui n'en relève pas (titre et clé d'un appel laissé sans clé, carnet couper-un-lien-l2b). Toutes au
// niveau « haute » pour que le message parte au seuil par défaut.
const LOT2_ALERTES: Record<string, { releve: { title: string; key: string }; horsLien: { title: string; key: string } }> = {
  'svalinn-alerte-wifi': { releve: { title: 'Wi-Fi : WPS allumé', key: 'svalinn-urgent' }, horsLien: { title: 'La box ne répond plus depuis le changement', key: 'svalinn-retour' } },
  'skuld-alerte-sauvegarde-base': { releve: { title: '💾 Sauvegarde de Ventes ratée', key: 'skuld-b1' }, horsLien: { title: '💾 Ventes : copie au 2e site ratée', key: 'skuld-site-b1' } },
  'vidarr-alerte-site-dangereux': { releve: { title: 'Tablette-1 a voulu joindre un site dangereux', key: 'dns-menace-10.0.0.5-mal.exemple' }, horsLien: { title: 'Odin a remarqué quelque chose sur le réseau', key: 'revue-x' } },
  'vidarr-alerte-inondation-dns': { releve: { title: '10.0.0.6 inonde le DNS', key: 'dns-flood-10.0.0.6' }, horsLien: { title: 'Le DNS d\'Odin n\'a pas pu démarrer', key: 'dns-demarrage' } },
  'vidarr-alerte-dns-amont': { releve: { title: 'Le DNS n\'arrive plus à joindre Internet', key: 'dns-amont' }, horsLien: { title: 'Le DHCP d\'Odin n\'a pas pu démarrer', key: 'dhcp-demarrage' } },
  'vidarr-alerte-appareil-inconnu': { releve: { title: 'Nouvel appareil sur le réseau : 02:00:00:00:00:01', key: 'dhcp-nouveau-02:00:00:00:00:01' }, horsLien: { title: 'Appareil en attente d\'approbation : 02:00:00:00:00:02', key: 'dhcp-attente-02:00:00:00:00:02' } },
  'mimisbrunnr-alerte-message-repete': { releve: { title: 'Chroniques : « Failed password » 10 fois en 5 min', key: 'chroniques:r1:1' }, horsLien: { title: 'mimisbrunnr : surveillance en échec', key: 'watch:mimisbrunnr' } },
  'gna-alerte-historique': { releve: { title: 'Trajets : l\'historique n\'est plus gardé comme prévu', key: 'gna-dossier' }, horsLien: { title: 'gna : surveillance en échec', key: 'watch:gna' } },
  'vordr-alerte-sonde': { releve: { title: '❌ Box est en panne', key: 'vordr-m1' }, horsLien: { title: '⏫ Toujours pas pris en main : Mémoire', key: 'vordr-esc-p1-1' } },
};

test('deuxième lot : pour chacun des neuf liens, coupé → l\'alerte est rangée et son message ne part pas ; une alerte de l\'appli hors du lien part ; rétabli → le message part', () => {
  assert.deepEqual(Object.keys(LOT2_ALERTES).sort(), [...LOT2].sort());
  for (const id of LOT2) {
    const l = LINKS.find((x) => x.id === id)!;
    const b = bancValhalla(undefined, [l.from]);
    try {
      const ctx = b.v.ctx(l.from), { releve, horsLien } = LOT2_ALERTES[id];
      const lien: LienACouper = { id, nom: `${l.from} → Forseti`, de: l.from, protege: l.protege ? { raison: l.protege.raison } : false, qui: QUI };
      assert.equal(couperLien(lien, true, { confirme: true }).ok, true, id);
      assert.equal(lienCoupe(id), true, id);
      const n = b.messages.length; // l'alerte de coupure (haute) d'un lien qui protège
      const r = ctx.alert({ level: 'haute', ...releve, lien: id }) as unknown as Alert & { nonEnvoye?: string };
      assert.equal(b.messages.length, n, `${id} coupé : le message ne part pas`);
      assert.equal(r.nonEnvoye, 'message non envoyé : lien coupé par toi', id);
      assert.ok(b.v.alerts({ module: l.from }).some((a) => a.title === releve.title && a.lien === id), `${id} : l'alerte est rangée`);
      // Une alerte de la même appli qui ne relève pas du lien : son message part toujours.
      ctx.alert({ level: 'haute', ...horsLien });
      assert.equal(b.messages.length, n + 1, `${id} coupé : « ${horsLien.title} » part toujours`);
      // Vidarr : couper un de ses quatre liens ne retient pas les alertes des trois autres.
      if (l.from === 'vidarr') for (const autre of LOT2.filter((x) => x.startsWith('vidarr-') && x !== id)) {
        const m = b.messages.length;
        ctx.alert({ level: 'haute', ...LOT2_ALERTES[autre].releve, lien: autre });
        assert.equal(b.messages.length, m + 1, `${id} coupé : l'alerte de ${autre} part`);
      }
      // Rétabli : le message part de nouveau (une autre occurrence, et la même alerte retenue).
      assert.equal(couperLien(lien, false).ok, true, id);
      const m = b.messages.length;
      const apres = ctx.alert({ level: 'haute', ...releve, lien: id }) as unknown as Alert & { nonEnvoye?: string };
      assert.ok(apres, `${id} rétabli : l'alerte retenue passe`); assert.equal(apres.nonEnvoye, undefined);
      assert.equal(b.messages.length, m + 1, `${id} rétabli : le message part`);
      assert.ok(b.messages.at(-1)!.includes(releve.title), id);
    } finally { b.fin(); }
  }
});

test('deuxième lot, par le code des applis : l\'alerte de Gná (historique) et la panne d\'une sonde de Vörðr portent leur clé', async () => {
  // Gná : le fichier des choix illisible est signalé ; la surveillance lève l'alerte « historique » (clé posée).
  {
    const b = bancValhalla(undefined, [gna]);
    try {
      const ctx = b.v.ctx('gna');
      const lien: LienACouper = { id: 'gna-alerte-historique', nom: 'Gná → Forseti', de: 'gna', protege: false, qui: QUI };
      assert.equal(couperLien(lien, true, { confirme: true }).ok, true);
      const n = b.messages.length;
      mkdirSync(ctx.dir, { recursive: true }); writeFileSync(join(ctx.dir, 'choix.json'), '{ abîmé');
      tousLesChoix(ctx.dir);
      await gna.watch!.run(ctx);
      const a = b.v.alerts({ module: 'gna' }).find((x) => x.key === 'gna:gna-dossier') as (Alert & { nonEnvoye?: string }) | undefined;
      assert.ok(a, 'l\'alerte est rangée'); assert.equal(a!.lien, 'gna-alerte-historique');
      assert.equal(a!.nonEnvoye, 'message non envoyé : lien coupé par toi');
      assert.equal(b.messages.length, n, 'lien coupé : le message ne part pas');
    } finally { b.fin(); }
  }
  // Vörðr : une sonde « signe de vie » sans battement passe en panne ; l'alerte de panne porte la clé.
  {
    resetVordr();
    const b = bancValhalla(undefined, [vordr]);
    try {
      const ctx = b.v.ctx('vordr');
      const lien: LienACouper = { id: 'vordr-alerte-sonde', nom: 'Vörðr → Forseti', de: 'vordr', protege: false, qui: QUI };
      assert.equal(couperLien(lien, true, { confirme: true }).ok, true);
      const n = b.messages.length;
      const m = { id: 'essai-push', name: 'Sonde-essai', kind: 'push', target: '', every: 300, retries: 1, timeoutMs: 1000, group: 'Maison', token: 'jeton-essai' } as unknown as Parameters<typeof runOne>[1];
      await runOne(ctx, m, b.now.getTime());
      const a = b.v.alerts({ module: 'vordr' }).find((x) => x.title === '❌ Sonde-essai est en panne') as (Alert & { nonEnvoye?: string }) | undefined;
      assert.ok(a, 'l\'alerte de panne est rangée'); assert.equal(a!.lien, 'vordr-alerte-sonde');
      assert.equal(b.messages.length, n, 'lien coupé : le message ne part pas');
    } finally { b.fin(); resetVordr(); }
  }
});

// Troisième lot : comme le deuxième. L'alerte « hors du lien » est celle d'un appel laissé sans clé (carnet
// couper-un-lien-l2c), au niveau « haute » pour que le message parte au seuil par défaut.
const LOT3_ALERTES: Record<string, { releve: { title: string; key: string }; horsLien: { title: string; key: string } }> = {
  'askr-alerte-garantie': { releve: { title: 'Garantie de Portable-1 : plus que 3 jour(s)', key: 'askr-garantie-a1' }, horsLien: { title: 'Atlas : surveillance en échec', key: 'watch:askr' } },
  'valgrind-alerte-service': { releve: { title: 'Le service derrière site.exemple ne répond plus', key: 'valgrind-5xx-h1' }, horsLien: { title: 'Le proxy d\'Odin n\'a pas pu démarrer', key: 'valgrind-demarrage' } },
  'var-alerte-compte-verrouille': { releve: { title: 'Compte « nour » verrouillé 15 minutes', key: 'var-verrou-p1-1' }, horsLien: { title: 'Un e-mail de Persona n\'a pas pu partir', key: 'var-courrier' } },
  'bru-alerte-tunnel': { releve: { title: 'Le tunnel Cloudflare est coupé', key: 'bru-coupe' }, horsLien: { title: 'Le tunnel Cloudflare n\'a pas pu démarrer', key: 'bru-demarrage' } },
  'thjalfi-alerte-installation': { releve: { title: '❌ Installation ratée sur pc-1', key: 'thjalfi-echec-1' }, horsLien: { title: '🖥 pc-2 demande « Installer pour moi » : Ubuntu 24.04', key: 'thjalfi-demande-d1' } },
  'skidbladnir-alerte-fichiers': { releve: { title: 'Fichier dangereux reçu dans « Famille » : essai.exe', key: 'skid-virus-1' }, horsLien: { title: 'Les fichiers (Nébuleuse) n\'ont pas pu démarrer', key: 'skid-demarrage' } },
  'gjoll-alerte-fin-acces': { releve: { title: 'Accès VPN de « tablette » terminé', key: 'vpn-fin-tablette' }, horsLien: { title: 'Le VPN n\'a pas pu redémarrer', key: 'vpn-demarrage' } },
};

test('troisième lot : pour chacun des sept liens, coupé → l\'alerte est rangée et son message ne part pas ; une alerte de l\'appli hors du lien part ; rétabli → le message part', () => {
  assert.deepEqual(Object.keys(LOT3_ALERTES).sort(), [...LOT3].sort());
  for (const id of LOT3) {
    const l = LINKS.find((x) => x.id === id)!;
    const b = bancValhalla(undefined, [l.from]);
    try {
      const ctx = b.v.ctx(l.from), { releve, horsLien } = LOT3_ALERTES[id];
      const lien: LienACouper = { id, nom: `${l.from} → Forseti`, de: l.from, protege: l.protege ? { raison: l.protege.raison } : false, qui: QUI };
      assert.equal(couperLien(lien, true, { confirme: true }).ok, true, id);
      assert.equal(lienCoupe(id), true, id);
      const n = b.messages.length;
      const r = ctx.alert({ level: 'haute', ...releve, lien: id }) as unknown as Alert & { nonEnvoye?: string };
      assert.equal(b.messages.length, n, `${id} coupé : le message ne part pas`);
      assert.equal(r.nonEnvoye, 'message non envoyé : lien coupé par toi', id);
      assert.ok(b.v.alerts({ module: l.from }).some((a) => a.title === releve.title && a.lien === id), `${id} : l'alerte est rangée`);
      ctx.alert({ level: 'haute', ...horsLien });
      assert.equal(b.messages.length, n + 1, `${id} coupé : « ${horsLien.title} » part toujours`);
      assert.equal(couperLien(lien, false).ok, true, id);
      const m = b.messages.length;
      const apres = ctx.alert({ level: 'haute', ...releve, lien: id }) as unknown as Alert & { nonEnvoye?: string };
      assert.ok(apres, `${id} rétabli : l'alerte retenue passe`); assert.equal(apres.nonEnvoye, undefined);
      assert.equal(b.messages.length, m + 1, `${id} rétabli : le message part`);
      assert.ok(b.messages.at(-1)!.includes(releve.title), id);
    } finally { b.fin(); }
  }
});

test('troisième lot, par le code des applis : Atlas (garantie, licence), Nébuleuse (espace plein), Genèse (notifications regroupées) portent leur clé', async () => {
  // Atlas : la surveillance du jour lève la garantie (haute : 3 jours) et la licence ; lien coupé, rien ne part.
  {
    const b = bancValhalla(undefined, [askr({ seen: () => [] })]);
    try {
      const ctx = b.v.ctx('askr');
      const a = { id: 'a1', tag: 'ODN-0001', name: 'Portable-1', kind: 'portable', state: 'en service', warrantyEnd: '2026-11-21', source: 'essai', firstSeen: 0, history: [] };
      ctx.saveSettings({ assets: [a], licences: [{ id: 'l1', name: 'Suite-essai', seats: 1, expires: '2026-11-25', assets: [] }] });
      const lien: LienACouper = { id: 'askr-alerte-garantie', nom: 'Atlas → Forseti', de: 'askr', protege: false, qui: QUI };
      assert.equal(couperLien(lien, true, { confirme: true }).ok, true);
      const n = b.messages.length;
      await b.v.modules().find((m) => m.id === 'askr')!.watch!.run(ctx);
      const g = b.v.alerts({ module: 'askr' }).find((x) => x.key === 'askr:askr-garantie-a1') as (Alert & { nonEnvoye?: string }) | undefined;
      assert.ok(g, 'la garantie est rangée'); assert.equal(g!.level, 'haute'); assert.equal(g!.lien, 'askr-alerte-garantie');
      assert.equal(g!.nonEnvoye, 'message non envoyé : lien coupé par toi');
      const lc = b.v.alerts({ module: 'askr' }).find((x) => x.key === 'askr:askr-licence-l1');
      assert.ok(lc); assert.equal(lc!.lien, 'askr-alerte-garantie');
      assert.equal(b.messages.length, n, 'lien coupé : le message de la garantie ne part pas');
      // Rétabli, le lendemain : la garantie part de nouveau.
      assert.equal(couperLien(lien, false).ok, true);
      b.now = new Date(b.now.getTime() + 24 * 3600_000);
      await b.v.modules().find((m) => m.id === 'askr')!.watch!.run(ctx);
      assert.equal(b.messages.length, n + 1); assert.match(b.messages.at(-1)!, /Garantie de Portable-1/);
    } finally { b.fin(); }
  }
  // Nébuleuse : un espace plein à plus de 90 % ; l'alerte porte la clé et sa trace (moyenne : sous le seuil du message).
  {
    const b = bancValhalla(undefined, [skidbladnir]);
    const dossier = mkdtempSync(join(tmpdir(), 'liens-coupes-espace-'));
    try {
      const ctx = b.v.ctx('skidbladnir');
      writeFileSync(join(dossier, 'gros.bin'), Buffer.alloc(2048));
      ctx.saveSettings({ spaces: [{ id: 'famille', name: 'Famille', path: dossier, read: ['famille'], write: ['famille'], quotaGb: 1 / 1024 ** 3 * 1024, versions: 0 }], lastPurge: Date.now() });
      const lien: LienACouper = { id: 'skidbladnir-alerte-fichiers', nom: 'Nébuleuse → Forseti', de: 'skidbladnir', protege: { raison: 'te prévient d\'un fichier suspect arrivé dans tes espaces' }, qui: QUI };
      assert.equal(couperLien(lien, true, { confirme: true }).ok, true);
      await b.v.modules().find((m) => m.id === 'skidbladnir')!.watch!.run(ctx);
      const a = b.v.alerts({ module: 'skidbladnir' }).find((x) => x.key === 'skidbladnir:skid-plein-famille') as (Alert & { nonEnvoye?: string }) | undefined;
      assert.ok(a, 'l\'alerte d\'espace plein est rangée'); assert.equal(a!.lien, 'skidbladnir-alerte-fichiers');
      assert.equal(a!.nonEnvoye, 'message non envoyé : lien coupé par toi');
    } finally { b.fin(); rmSync(dossier, { recursive: true, force: true }); }
  }
  // Genèse : l'envoi commun des notifications (la première tout de suite, les suivantes regroupées) porte la clé.
  {
    const b = bancValhalla(undefined, ['thjalfi']);
    const S = suivi({} as never);
    try {
      const ctx = b.v.ctx('thjalfi');
      const lien: LienACouper = { id: 'thjalfi-alerte-installation', nom: 'Genèse → Forseti', de: 'thjalfi', protege: { raison: 'te signale aussi un poste inconnu ou bloqué qui se présente pour s\'installer' }, qui: QUI };
      assert.equal(couperLien(lien, true, { confirme: true }).ok, true);
      const n = b.messages.length;
      S.prevenir(ctx, 'échec', 'pc-1', { level: 'haute', title: '❌ Installation ratée sur pc-1', detail: 'essai', key: 'thjalfi-echec-pc-1' });
      S.prevenir(ctx, 'échec', 'pc-2', { level: 'haute', title: '❌ Installation ratée sur pc-2', detail: 'essai', key: 'thjalfi-echec-pc-2' });
      S.prevenir(ctx, 'échec', 'pc-3', { level: 'haute', title: '❌ Installation ratée sur pc-3', detail: 'essai', key: 'thjalfi-echec-pc-3' });
      b.now = new Date(b.now.getTime() + 60_000);
      S.prevenir(ctx, 'début', 'pc-4', { level: 'info', title: '▶ pc-4 démarre', key: 'thjalfi-debut-pc-4' });
      const l = b.v.alerts({ module: 'thjalfi' }) as Array<Alert & { nonEnvoye?: string }>;
      const premiere = l.find((x) => x.title === '❌ Installation ratée sur pc-1'), lot = l.find((x) => /2 autres installations ratées/.test(x.title));
      assert.ok(premiere && lot, 'la première et le lot sont rangés');
      for (const x of [premiere!, lot!]) { assert.equal(x.lien, 'thjalfi-alerte-installation', x.title); assert.equal(x.nonEnvoye, 'message non envoyé : lien coupé par toi', x.title); }
      assert.equal(b.messages.length, n, 'lien coupé : aucun message');
      // Rétabli : la notification suivante part.
      assert.equal(couperLien(lien, false).ok, true);
      S.prevenir(ctx, 'fini', 'pc-5', { level: 'haute', title: '✅ pc-5 installée', key: 'thjalfi-fini-pc-5' });
      assert.equal(b.messages.length, n + 1); assert.match(b.messages.at(-1)!, /pc-5 installée/);
    } finally { S.fermer(); b.fin(); }
  }
});

// Quatrième lot : comme le troisième. L'alerte « hors du lien » est celle d'un appel laissé sans clé (carnet
// couper-un-lien-l2d) ; Iris et Perséphone n'en ont pas d'autre que les alertes communes de Valhalla (« surveillance en
// échec »), reprises ici. Toutes au niveau « haute » pour que le message parte au seuil par défaut.
const LOT4_ALERTES: Record<string, { releve: { title: string; key: string }; horsLien: { title: string; key: string } }> = {
  'idunn-alerte-site': { releve: { title: 'site.exemple : le site ne répond plus (erreur 502)', key: 'site.exemple:hors_ligne:x' }, horsLien: { title: 'site.exemple : les enregistrements DNS de site.exemple ont changé', key: 'site.exemple:dns_change:x' } },
  'syn-alerte-seuil': { releve: { title: 'Maison · Mémoire : Hygie 97 %', key: 'syn:b1:p1:m:mauvais' }, horsLien: { title: 'Iris : surveillance en échec', key: 'watch:syn' } },
  'hlin-alerte-donnees-perso': { releve: { title: '2 nouveaux résultats sur toi (1 à risque élevé)', key: 'nouveaux:f1:2026-11-18' }, horsLien: { title: 'L\'accord de Lilo A. a plus de 12 mois', key: 'accord:f2' } },
  'durinn-alerte-disque': { releve: { title: 'Disque sda : état Mauvais', key: 'mauvais:k1' }, horsLien: { title: 'Disque sda : erreurs de câble en hausse', key: 'cable:k1:x' } },
  'pegase-alerte-telechargement': { releve: { title: 'Pégase : fichier bloqué (essai.exe)', key: 'pegase:bloque:x' }, horsLien: { title: 'Pégase : copie impossible', key: 'pegase:copie' } },
  'hel-alerte-recuperation': { releve: { title: 'Perséphone : récupération interrompue', key: 'hel:echec:/dev/sdb' }, horsLien: { title: 'Perséphone : surveillance en échec', key: 'watch:hel' } },
};

test('quatrième lot : pour chacun des six liens, coupé → l\'alerte est rangée et son message ne part pas ; une alerte de l\'appli hors du lien part ; rétabli → le message part', () => {
  assert.deepEqual(Object.keys(LOT4_ALERTES).sort(), [...LOT4].sort());
  for (const id of LOT4) {
    const l = LINKS.find((x) => x.id === id)!;
    const b = bancValhalla(undefined, [l.from]);
    try {
      const ctx = b.v.ctx(l.from), { releve, horsLien } = LOT4_ALERTES[id];
      const lien: LienACouper = { id, nom: `${l.from} → Forseti`, de: l.from, protege: l.protege ? { raison: l.protege.raison } : false, qui: QUI };
      assert.equal(couperLien(lien, true, { confirme: true }).ok, true, id);
      assert.equal(lienCoupe(id), true, id);
      const n = b.messages.length;
      const r = ctx.alert({ level: 'haute', ...releve, lien: id }) as unknown as Alert & { nonEnvoye?: string };
      assert.equal(b.messages.length, n, `${id} coupé : le message ne part pas`);
      assert.equal(r.nonEnvoye, 'message non envoyé : lien coupé par toi', id);
      assert.ok(b.v.alerts({ module: l.from }).some((a) => a.title === releve.title && a.lien === id), `${id} : l'alerte est rangée`);
      ctx.alert({ level: 'haute', ...horsLien });
      assert.equal(b.messages.length, n + 1, `${id} coupé : « ${horsLien.title} » part toujours`);
      assert.equal(couperLien(lien, false).ok, true, id);
      const m = b.messages.length;
      const apres = ctx.alert({ level: 'haute', ...releve, lien: id }) as unknown as Alert & { nonEnvoye?: string };
      assert.ok(apres, `${id} rétabli : l'alerte retenue passe`); assert.equal(apres.nonEnvoye, undefined);
      assert.equal(b.messages.length, m + 1, `${id} rétabli : le message part`);
      assert.ok(b.messages.at(-1)!.includes(releve.title), id);
    } finally { b.fin(); }
  }
});

test('quatrième lot, par le code des applis : Gygès (délai d\'une demande de retrait dépassé) et Pégase (nouvel appareil) portent leur clé', async () => {
  // Gygès : une demande envoyée dont le délai d'un mois est passé ; la surveillance lève l'alerte du délai (moyenne).
  {
    const b = bancValhalla(undefined, [hlin]);
    try {
      const ctx = b.v.ctx('hlin');
      mkdirSync(ctx.dir, { recursive: true });
      writeFileSync(join(ctx.dir, 'demandes.json'), JSON.stringify([{ id: 'd1', fiche: 'f1', site: 'annuaire.exemple', type: 'effacement', montre: [], creee: '2026-09-01', envoyee: '2026-09-02', avant: '2026-10-02', relances: [], etat: 'envoyée', lettres: [] }]));
      const lien: LienACouper = { id: 'hlin-alerte-donnees-perso', nom: 'Gygès → Forseti', de: 'hlin', protege: { raison: 'te prévient quand tes données personnelles réapparaissent quelque part' }, qui: QUI };
      assert.equal(couperLien(lien, true, { confirme: true }).ok, true);
      const n = b.messages.length;
      await b.v.modules().find((m) => m.id === 'hlin')!.watch!.run(ctx);
      const a = b.v.alerts({ module: 'hlin' }).find((x) => x.key === 'hlin:delai:d1') as (Alert & { nonEnvoye?: string }) | undefined;
      assert.ok(a, 'l\'alerte du délai est rangée'); assert.equal(a!.lien, 'hlin-alerte-donnees-perso');
      assert.equal(a!.nonEnvoye, 'message non envoyé : lien coupé par toi');
      assert.equal(b.messages.length, n, 'lien coupé : aucun message');
    } finally { b.fin(); }
  }
  // Pégase : un nouvel appareil sur un profil ; l'alerte porte la clé et sa trace (moyenne : sous le seuil du message).
  {
    const b = bancValhalla(undefined, ['pegase']);
    const ctx = b.v.ctx('pegase');
    try {
      const lien: LienACouper = { id: 'pegase-alerte-telechargement', nom: 'Pégase → Forseti', de: 'pegase', protege: { raison: 'te prévient d\'un téléchargement bloqué ou d\'un nouvel appareil sur un profil' }, qui: QUI };
      assert.equal(couperLien(lien, true, { confirme: true }).ok, true);
      const r = nouvelAppareil(ctx, { id: 'p1', name: 'Nour' }, { nom: 'Tablette-1', plateforme: 'android' });
      const a = b.v.alerts({ module: 'pegase' }).find((x) => x.key === `pegase:pegase:appareil:${r.appareil.id}`) as (Alert & { nonEnvoye?: string }) | undefined;
      assert.ok(a, 'l\'alerte du nouvel appareil est rangée'); assert.equal(a!.lien, 'pegase-alerte-telechargement');
      assert.equal(a!.nonEnvoye, 'message non envoyé : lien coupé par toi');
    } finally { oublierMagasin(ctx.dir); b.fin(); }
  }
});

test('quatrième lot, par le code d\'Iris : un seuil rouge (alerte haute) est retenu, lien coupé ; le même, lien en place, part', async () => {
  const l = LINKS.find((x) => x.id === 'syn-alerte-seuil')!;
  const lien: LienACouper = { id: l.id, nom: 'Iris → Forseti', de: 'syn', protege: l.protege ? { raison: l.protege.raison } : false, qui: QUI };
  /** Un banc avec Iris, le tableau « Machine » et un processeur à 95 % (seuil rouge) ; la surveillance d'Iris tourne. */
  const tour = async (coupe: boolean) => {
    const b = bancValhalla(undefined, [syn]);
    try {
      for (let k = 30; k >= 0; k--) b.v.metrics.put({ 'eir.cpu': 95 }, b.now.getTime() - k * 60e3);
      b.v.metrics.flush();
      assert.match((await b.v.act('syn', 'modele', { modele: 'machine' })).text, /Tableau « Machine » ajouté/);
      assert.equal(couperLien(lien, coupe, { confirme: true }).ok, true);
      const n = b.messages.length;
      await b.v.modules().find((m) => m.id === 'syn')!.watch!.run(b.v.ctx('syn'));
      const a = b.v.alerts({ module: 'syn' }).find((x) => /Processeur : eir\.cpu 95 %/.test(x.title)) as (Alert & { nonEnvoye?: string }) | undefined;
      assert.ok(a, 'l\'alerte du seuil rouge est rangée'); assert.equal(a!.level, 'haute'); assert.equal(a!.lien, 'syn-alerte-seuil');
      return { nonEnvoye: a!.nonEnvoye, envoyes: b.messages.slice(n) };
    } finally { b.fin(); }
  };
  const c = await tour(true);
  assert.equal(c.nonEnvoye, 'message non envoyé : lien coupé par toi');
  assert.ok(!c.envoyes.some((m) => /eir\.cpu 95 %/.test(m)), 'lien coupé : le message du seuil rouge ne part pas');
  // Témoin : la même alerte haute, lien en place, part (elle passe le seuil d'envoi par défaut).
  const r = await tour(false);
  assert.equal(r.nonEnvoye, undefined);
  assert.ok(r.envoyes.some((m) => /eir\.cpu 95 %/.test(m)), 'lien en place : le message part');
});

test('quatrième lot, Tirésias : les erreurs de câble restent hors du lien (clé `cable:` de durinn/suivi.ts, exclue par modules/durinn.ts)', () => {
  // Le vrai calcul des alertes : un disque dont les secteurs réalloués ET les erreurs de câble montent.
  const FX = fileURLToPath(new URL('./fixtures/durinn/', import.meta.url));
  const sdb = lireSmart(readFileSync(join(FX, 'sdb.json'), 'utf8')); sdb.nom = 'sdb';
  const plus = lireSmart(JSON.stringify((JSON.parse(readFileSync(join(FX, 'variantes.json'), 'utf8')) as Record<string, unknown>).sdb_plus)); plus.nom = 'sdb';
  const n0 = noter(undefined, { ...sdb, crc: 3 }, new Date('2026-11-01T10:00:00'));
  const n = noter(n0.suivi, { ...plus, crc: 9 }, new Date('2026-11-01T18:00:00'));
  const a = alertesDe({ ...plus, crc: 9 }, n.avant, n.suivi, new Date('2026-11-01T18:00:00'), { etapes: [] }).alertes;
  const cable = a.filter((x) => /erreurs de câble/.test(x.title)), autres = a.filter((x) => !/erreurs de câble/.test(x.title));
  assert.equal(cable.length, 1, 'une alerte de câble'); assert.ok(autres.length >= 1, 'et au moins une alerte de dégradation');
  assert.ok(cable[0].key?.startsWith('cable:'), `la clé de l'alerte de câble commence par « cable: » (${cable[0].key})`);
  for (const x of autres) assert.ok(!x.key?.startsWith('cable:'), `${x.title} : pas une clé de câble`);
  // L'appel qui les lève : la clé du lien sur toutes, sauf celles dont la clé commence par « cable: ».
  const src = readFileSync(join(VALHALLA, 'modules', 'durinn.ts'), 'utf8');
  assert.ok(src.includes('for (const x of a.alertes) ctx.alert(x.key?.startsWith(\'cable:\') ? x : { ...x, lien: \'durinn-alerte-disque\' });'), 'modules/durinn.ts exclut le préfixe « cable: »');
});

test('un état illisible ne coupe rien : le message part', () => {
  for (const f of ['{ pas du JSON', JSON.stringify({ pauses: { 'lien:hermod-alerte-machine-disparue': { depuis: 'hier', lien: true, protege: false } } }),
    JSON.stringify({ pauses: { 'lien:ullr-alerte-menace': { depuis: '2026-11-18T09:00:00Z', lien: true, protege: true } } })]) {
    const b = bancValhalla(f);
    try {
      b.v.ctx('hermod').alert({ level: 'haute', title: 'Poste-1 ne répond plus', key: 'down:1', lien: 'hermod-alerte-machine-disparue' });
      b.v.ctx('ullr').alert({ level: 'haute', title: 'menace', key: 'hit:1', lien: 'ullr-alerte-menace' });
      assert.equal(b.messages.length, 2, f.slice(0, 40));
    } finally { b.fin(); }
  }
  // Témoin : le même fichier, en règle, coupe bien.
  const b = bancValhalla(JSON.stringify({ pauses: { 'lien:hermod-alerte-machine-disparue': { depuis: '2026-11-18T09:00:00Z', lien: true, protege: false } } }));
  try {
    b.v.ctx('hermod').alert({ level: 'haute', title: 'Poste-1 ne répond plus', key: 'down:1', lien: 'hermod-alerte-machine-disparue' });
    assert.equal(b.messages.length, 0);
  } finally { b.fin(); }
});

const lienDe = (body: Record<string, unknown>, id: string) => (body.liens as Array<{ id: string; coupe?: unknown; coupable: boolean }>).find((x) => x.id === id)!;

test('la route : le propriétaire coupe un lien d\'alerte (la confirmation dit que l\'appli continue d\'agir) ; clé, membre, invité, sans session : refusés', { timeout: 120_000 }, async () => {
  const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => undefined;
  try {
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['var', 'brisingamen'].includes(m.id)) }), va = valhallaOf()!;
    tt.onEnd(startDraupnir(v.o, async () => undefined));
    relierProprietaire(va.ctx('var'));
    const P = '/api/draupnir/automatisme/pause';
    const coupe = async (id: string) => lienDe((await v.json('/api/draupnir/automatismes')).body, id).coupe;
    for (const id of Object.keys(APPELS)) assert.equal(lienDe((await v.json('/api/draupnir/automatismes')).body, `lien:${id}`).coupable, true, id);
    // Un lien qui protège : accord (sa raison, et ce qui continue), puis coupé, puis rétabli.
    const ID = 'lien:ullr-alerte-menace';
    const a = await v.json(P, { id: ID, pause: true });
    assert.equal(a.body.code, 'accord', JSON.stringify(a.body));
    assert.match(String(a.body.confirm), /Ce lien protège/);
    assert.match(String(a.body.confirm), /continue/); assert.match(String(a.body.confirm), /l'alerte reste rangée/);
    // La page ne montre pas (encore) la mention « message non envoyé » : la confirmation ne la promet pas.
    assert.doesNotMatch(String(a.body.confirm), /message non envoyé/);
    // Elle dit de quelles alertes il s'agit : celles de ce lien.
    assert.match(String(a.body.confirm), /alertes de ce lien/);
    assert.equal((await v.json(P, { id: ID, pause: true, confirme: true })).body.ok, true);
    assert.ok(await coupe(ID), 'coupé');
    assert.equal((await v.json(P, { id: ID, pause: false })).body.ok, true);
    assert.equal(await coupe(ID), undefined, 'rétabli');
    // Un lien qui ne protège pas : la confirmation le dit aussi.
    const h = await v.json(P, { id: 'lien:naglfar-alerte-conteneur', pause: true });
    assert.equal(h.body.code, 'accord'); assert.match(String(h.body.confirm), /continue/);
    // Un lien d'une autre famille, déclaré « pas encore » : refusé, même par le propriétaire.
    const s = await v.json(P, { id: 'lien:urdr-coffre-mot-de-passe', pause: true, confirme: true });
    assert.notEqual(s.body.ok, true); assert.equal(await coupe('lien:urdr-coffre-mot-de-passe'), undefined);
    const tentatives: Array<[string, Promise<{ status: number; body: Record<string, unknown> }>]> = [
      ['clé d\'accès en Bearer', v.json(P, { id: ID, pause: true, confirme: true }, { authorization: `Bearer ${v.token}` })],
      ['session + clé en paramètre', v.json(`${P}?token=${v.token}`, { id: ID, pause: true, confirme: true })],
      ['session + clé en X-API-Key', v.json(P, { id: ID, pause: true, confirme: true }, { cookie: v.session, 'x-api-key': v.token })],
      ['sans session', v.json(P, { id: ID, pause: true, confirme: true }, { cookie: '' })],
    ];
    for (const [quoi, p] of tentatives) {
      const r = await p;
      assert.notEqual(r.body.ok, true, `${quoi} : refusé (${r.status})`);
      assert.equal(await coupe(ID), undefined, `${quoi} : rien n'est coupé`);
    }
    for (const [login, groupe] of [['nour', 'famille'], ['lilo', 'invite']]) {
      const mdp = `${login}-ciel-de-sable-sous-la-pluie-27`;
      assert.equal((await va.act('var', 'ajouter', { login, nom: login, groupes: groupe, email: `${login}@exemple.yt`, mot_de_passe: mdp })).ok, true);
      let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' });
      const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
      r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: login, motdepasse: mdp }) });
      r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' });
      const cookie = r.headers.getSetCookie().find((x) => x.startsWith('odin_session='))?.split(';')[0] ?? '';
      if (groupe === 'famille') assert.ok(cookie, `${login} a une session`);
      const m = await v.json(P, { id: ID, pause: true, confirme: true }, { cookie });
      assert.notEqual(m.body.ok, true, `${login} (${groupe}) : refusé (${m.status})`);
      assert.equal(await coupe(ID), undefined, `${login} : rien n'est coupé`);
    }
  } finally { Object.assign(console, orig); await tt.end(); }
});
