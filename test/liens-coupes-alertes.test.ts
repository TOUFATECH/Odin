// Couper un lien d'alerte (livraison L2, premier lot : ullr, sindri, eir, naglfar, ymir, hermod). Une alerte porte la
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

const { LINKS } = liens;
const BRANCHEES = (liens as { ALERTES_BRANCHEES?: ReadonlySet<string> }).ALERTES_BRANCHEES;
const VALHALLA = fileURLToPath(new URL('../src/valhalla/', import.meta.url));

// Combien d'appels d'alerte portent la clé, lien par lien (relus à la main : carnets couper-un-lien-l2a et
// couper-un-lien-l2b). Un appel ajouté ou retiré fait échouer l'essai : il faut le relire.
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
};
/** Les liens du deuxième lot. */
const LOT2 = ['svalinn-alerte-wifi', 'skuld-alerte-sauvegarde-base', 'vidarr-alerte-site-dangereux', 'vidarr-alerte-inondation-dns',
  'vidarr-alerte-dns-amont', 'vidarr-alerte-appareil-inconnu', 'mimisbrunnr-alerte-message-repete', 'gna-alerte-historique', 'vordr-alerte-sonde'];

/** Les fichiers d'une appli : son module, et son dossier s'il existe. */
function fichiersDe(app: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const tour = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) tour(p); else if (n.endsWith('.ts')) out.push([relative(VALHALLA, p).replace(/\\/g, '/'), readFileSync(p, 'utf8')]); } };
  try { out.push([`modules/${app}.ts`, readFileSync(join(VALHALLA, 'modules', `${app}.ts`), 'utf8')]); } catch { /* pas de module */ }
  try { if (statSync(join(VALHALLA, app)).isDirectory()) tour(join(VALHALLA, app)); } catch { /* pas de dossier */ }
  return out;
}
/** Tous les fichiers de src/valhalla. */
function toutValhalla(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const tour = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) tour(p); else if (n.endsWith('.ts')) out.push([relative(VALHALLA, p).replace(/\\/g, '/'), readFileSync(p, 'utf8')]); } };
  tour(VALHALLA); return out;
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

test('douze applis branchées : chaque lien d\'alerte porte sa clé sur les appels qui en relèvent, et seulement eux', () => {
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
      assert.ok(f === `modules/${l!.from}.ts` || f.startsWith(`${l!.from}/`), `${f} : la clé « ${m[1]} » est posée hors de ${l!.from}`);
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

test('les liens qui se coupent d\'ici : les 21 à point unique et les 15 alertes branchées ; les autres alertes « pas encore »', () => {
  const lignes = lignesLiensEcrits(undefined);
  const coupables = lignes.filter((x) => x.coupable).map((x) => x.id.slice(5));
  const attendus = LINKS.filter((l) => 'par' in l.coupure && (l.coupure.par === 'reflexe' || (l.coupure.par === 'alerte' && BRANCHEES?.has(l.id)))).map((l) => l.id);
  assert.deepEqual(coupables, attendus);
  assert.equal(coupables.length, 21 + 6 + 9);
  for (const id of LOT2) assert.ok(coupables.includes(id), `${id} se coupe d'ici`);
  // Les 14 autres liens d'alerte ne se coupent pas encore d'ici.
  const autres = LINKS.filter((l) => 'par' in l.coupure && l.coupure.par === 'alerte' && !BRANCHEES?.has(l.id));
  assert.equal(autres.length, 14);
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
    // Un lien d'alerte d'une autre appli : pas encore, même par le propriétaire.
    const s = await v.json(P, { id: 'lien:askr-alerte-garantie', pause: true, confirme: true });
    assert.notEqual(s.body.ok, true); assert.equal(await coupe('lien:askr-alerte-garantie'), undefined);
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
