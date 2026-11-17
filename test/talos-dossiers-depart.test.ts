// Talos : les automatisations de départ (src/draupnir/depart.ts) et leur installation, une seule fois.
// Les actives ne doivent rien faire qui engage le propriétaire sans lui : chaque action d'appli qu'elles lancent est
// cherchée dans le vrai module et doit être une lecture sans gravité.
// Chaque essai tourne dans un dossier jetable : rien n'est écrit dans le vrai dossier d'Odin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { automatisationsDepart, DOSSIERS_DEPART } from '../src/draupnir/depart.ts';
import { checkFlow, normalize, type Workflow } from '../src/draupnir/engine.ts';
import { EVENEMENTS } from '../src/draupnir/liens.ts';
import { CATALOG } from '../src/draupnir/nodes.ts';
import { LINKS, linkTemplates } from '../src/valhalla/links.ts';
import { Talos } from '../src/draupnir/service.ts';
import { setDraupnir } from '../src/tools/draupnir.ts';
import { draupnirGet, draupnirPost } from '../src/web/draupnir-api.ts';
import { infosFlow } from '../src/web/talos-api.ts';

const jetable = () => mkdtempSync(join(tmpdir(), 'talos-depart-'));
const avecTalos = async (f: (d: Talos, home: string) => void | Promise<void>) => {
  const home = jetable(), d = new Talos(home, {});
  try { await f(d, home); } finally { d.stop(); rmSync(home, { recursive: true, force: true }); }
};
const marque = (home: string) => join(home, 'draupnir', 'state', 'depart.json');
const flux = (over: Partial<Workflow> = {}): Partial<Workflow> => ({ name: 'Perso', active: false, nodes: [{ name: 'Go', type: 'déclencheur.manuel', params: {} }], connections: {}, ...over });

/** Les seuls types de nœuds permis dans une automatisation de départ livrée ACTIVE (liste fermée). */
const PERMIS = new Set(['déclencheur.planning', 'module.action', 'saga.attention', 'saga.écrire', 'données.regrouper', 'logique.fusionner', 'odin.demander', 'odin.prévenir']);
/** Jamais dans une active : envoi au nom du propriétaire, agent qui agit, requête web, adresse ouverte à tous. */
const INTERDITS = ['odin.mail', 'odin.message', 'odin.agent', 'web.requête', 'déclencheur.webhook', 'déclencheur.formulaire', 'déclencheur.flux', 'déclencheur.surveille'];

type Act = { id: string; read?: boolean; grave?: unknown };
/** L'action d'une appli, lue dans son module (export du même nom ; objet, ou fabrique sans argument). */
async function actionDe(module: string, action: string): Promise<Act | undefined> {
  assert.match(module, /^[a-z0-9_-]+$/, `nom de module sûr : ${module}`);
  const m = await import(new URL(`../src/valhalla/modules/${module}.ts`, import.meta.url).href) as Record<string, unknown>;
  const exp = m[module];
  assert.ok(exp, `le module ${module} exporte « ${module} »`);
  const mod = (typeof exp === 'function' ? (exp as () => unknown)() : exp) as { actions?: Act[] };
  return mod.actions?.find((a) => a.id === action);
}

/** Les automatisations de départ d'avant la série « Liens entre applis » (bilans et brouillons). */
const bilans = () => automatisationsDepart().filter((x) => !String(x.flow.id).startsWith('depart-lien-'));

test('1. entre 15 et 25 automatisations, identifiants uniques en « depart- », chacune dans un dossier connu', () => {
  assert.ok(bilans().length >= 15 && bilans().length <= 25, `${bilans().length} bilans et brouillons`);
  const l = automatisationsDepart();
  const ids = l.map((x) => String(x.flow.id));
  assert.equal(new Set(ids).size, ids.length, 'identifiants uniques');
  for (const id of ids) assert.match(id, /^depart-[a-z0-9-]+$/);
  for (const x of l) {
    assert.ok((DOSSIERS_DEPART as readonly string[]).includes(x.dossier), `${x.flow.id} : dossier ${x.dossier}`);
    assert.equal(x.flow.origin, 'depart');
    assert.ok(String(x.flow.settings?.description ?? '').length > 20, `${x.flow.id} : une phrase qui dit ce qu'elle fait`);
  }
  assert.ok(l.some((x) => x.flow.active) && l.some((x) => !x.flow.active), 'des actives et des brouillons');
});

test('2. chacune passe checkFlow ; chaque planning d\'une active a une prochaine exécution', () => {
  for (const x of automatisationsDepart()) {
    const w = normalize(x.flow);
    assert.equal(checkFlow(w, CATALOG), undefined, `${w.id} : ${checkFlow(w, CATALOG)}`);
    for (const n of w.nodes) assert.ok(CATALOG.has(n.type), `${w.id} : bloc ${n.type} connu`);
    if (w.active && w.nodes.some((n) => n.type === 'déclencheur.planning')) assert.ok(infosFlow(w).prochaine, `${w.id} : prochaine exécution calculée`);
  }
});

test('3. sûreté : les actives ne contiennent que des blocs permis, et des actions d\'applis en lecture sans gravité', async () => {
  const actives = bilans().filter((x) => x.flow.active === true);
  assert.ok(actives.length >= 10);
  for (const x of actives) {
    const w = normalize(x.flow);
    assert.equal(w.settings?.notifyOnError, false, `${w.id} : pas d'alerte d'échec chaque semaine`);
    for (const n of w.nodes) {
      assert.ok(!INTERDITS.includes(n.type), `${w.id} : bloc interdit ${n.type}`);
      assert.ok(PERMIS.has(n.type), `${w.id} : bloc hors de la liste permise ${n.type}`);
      if (n.type === 'module.action') {
        const a = await actionDe(String(n.params.module), String(n.params.action));
        assert.ok(a, `${w.id} : action ${n.params.module}/${n.params.action} introuvable`);
        assert.equal(a.read, true, `${w.id} : ${n.params.module}/${n.params.action} doit être une lecture`);
        assert.ok(!a.grave, `${w.id} : ${n.params.module}/${n.params.action} ne doit pas être grave`);
        assert.doesNotThrow(() => JSON.parse(String(n.params.entrée ?? '{}')), `${w.id} : réglages JSON valides`);
      }
      if (n.type === 'saga.écrire') assert.equal(n.params.mode, 'créer', `${w.id} : n'écrit qu'une note neuve`);
      if (n.type === 'odin.demander' && n.params.envoyer !== 'non') assert.match(String(n.params.consigne), /réponds RIEN\.$/, `${w.id} : se tait quand tout va bien`);
    }
  }
  // Les brouillons citent des actions qui existent aussi (sinon on ne pourrait pas les activer).
  for (const x of automatisationsDepart().filter((y) => !y.flow.active)) for (const n of x.flow.nodes ?? []) if (n.type === 'module.action') assert.ok(await actionDe(String(n.params.module), String(n.params.action)), `${x.flow.id} : action ${n.params.module}/${n.params.action}`);
});

test('3 bis. l\'essai de sûreté attrape un bloc engageant ajouté à une active', () => {
  const x = automatisationsDepart().find((y) => y.flow.active)!;
  const pire = { ...x.flow, nodes: [...(x.flow.nodes ?? []), { name: 'Envoyer', type: 'odin.mail', params: {} }] } as Partial<Workflow>;
  assert.ok(pire.nodes!.some((n) => INTERDITS.includes(n.type) || !PERMIS.has(n.type)));
});

test('4. rien de privé dans les définitions', () => {
  const json = JSON.stringify(automatisationsDepart());
  assert.ok(!json.includes('@'), 'aucune adresse');
  assert.ok(!/http/i.test(json), 'aucune adresse web');
  assert.ok(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(json), 'aucune adresse IP');
});

test('5. Odin neuf : tout est installé, les dossiers sont créés, la marque vaut « installe »', () => avecTalos((d, home) => {
  const defs = automatisationsDepart();
  const r = d.installerDepart();
  assert.deepEqual(r, { etat: 'installe', installees: defs.length });
  assert.equal(d.list().length, defs.length);
  for (const x of defs) {
    const w = d.parId(String(x.flow.id));
    assert.ok(w, `${x.flow.id} chargée`);
    assert.equal(w.active, x.flow.active === true, `${x.flow.id} : état`);
    assert.equal(d.nomDossier(String(w.dossier)), x.dossier, `${x.flow.id} : dans « ${x.dossier} »`);
  }
  assert.deepEqual(d.dossiers().map((x) => x.nom), [...DOSSIERS_DEPART]);
  assert.equal(d.marqueDepart()?.etat, 'installe');
  assert.ok(!readdirSync(join(home, 'draupnir', 'state')).some((f) => f.endsWith('.tmp')));
}));

test('5 bis. un dossier du même nom qui existe déjà est réutilisé', () => avecTalos((d) => {
  const s = d.creerDossier('sécurité');
  d.installerDepart();
  assert.equal(d.dossiers().filter((x) => x.nom.toLowerCase() === 'sécurité').length, 1);
  assert.equal(d.parId('depart-coffre')?.dossier, s.id);
}));

test('6. une seule fois : un second appel n\'ajoute rien ; jetée ou modifiée, elle ne revient pas', () => avecTalos((d) => {
  d.installerDepart();
  const n = d.list().length;
  assert.deepEqual(d.installerDepart(), { etat: 'installe', installees: 0 });
  assert.equal(d.list().length, n);
  d.trash('depart-coffre');
  const parc = d.save({ ...d.parId('depart-parc')!, name: 'Mon parc', active: false });
  assert.deepEqual(d.installerDepart(), { etat: 'installe', installees: 0 });
  assert.equal(d.parId('depart-coffre'), undefined, 'la jetée ne revient pas');
  assert.equal(d.parId('depart-parc')?.name, 'Mon parc');
  assert.equal(d.parId('depart-parc')?.updatedAt, parc.updatedAt, 'la modifiée n\'est pas réécrite');
  assert.equal(d.list().length, n - 1);
}));

test('7. reprise après coupure : la marque manque alors que la moitié existe, l\'appel complète sans doublon', () => avecTalos((d, home) => {
  d.installerDepart();
  const tous = d.list().map((w) => w.id).sort();
  for (const id of tous.slice(0, Math.floor(tous.length / 2))) unlinkSync(join(home, 'draupnir', 'flows', `${id}.json`));
  unlinkSync(marque(home));
  const r = d.installerDepart();
  assert.equal(r.etat, 'installe');
  assert.equal(r.installees, Math.floor(tous.length / 2));
  assert.deepEqual(d.list().map((w) => w.id).sort(), tous);
  assert.equal(d.dossiers().length, DOSSIERS_DEPART.length, 'aucun dossier en double');
}));

test('8. Odin qui a déjà les siennes : rien d\'ajouté, proposé ; « Les ajouter » installe, « Non merci » refuse', async () => {
  const home = jetable(), d = new Talos(home, {}); setDraupnir(d);
  const odin = {} as never;
  try {
    d.save(flux({ id: 'perso' }));
    assert.deepEqual(d.installerDepart(), { etat: 'propose', installees: 0 });
    assert.equal(d.list().length, 1);
    assert.deepEqual(d.installerDepart(), { etat: 'propose', installees: 0 }, 'pas d\'installation au démarrage suivant');
    const g = await draupnirGet(odin, '/api/draupnir/depart', new URLSearchParams(), '') as { ok: boolean; etat: string; liste: Array<{ id: string; nom: string; dossier: string; active: boolean; phrase: string }> };
    assert.equal(g.etat, 'propose');
    assert.equal(g.liste.length, automatisationsDepart().length);
    assert.ok(g.liste.every((x) => x.id && x.nom && x.dossier && typeof x.active === 'boolean' && x.phrase));
    const r = await draupnirPost(odin, '/api/draupnir/depart/installer', {}) as { ok: boolean; installees: number };
    assert.deepEqual(r, { ok: true, installees: automatisationsDepart().length });
    assert.equal(d.marqueDepart()?.etat, 'installe');
    assert.ok(d.parId('perso'), 'la sienne est gardée');
    assert.deepEqual(await draupnirPost(odin, '/api/draupnir/depart/installer', {}), { ok: false, error: 'déjà installées' });
  } finally { setDraupnir(undefined); d.stop(); rmSync(home, { recursive: true, force: true }); }

  const home2 = jetable(), d2 = new Talos(home2, {}); setDraupnir(d2);
  try {
    d2.save(flux({ id: 'perso' }));
    d2.installerDepart();
    assert.deepEqual(await draupnirPost(odin, '/api/draupnir/depart/refuser', {}), { ok: true });
    assert.equal(d2.marqueDepart()?.etat, 'refuse');
    assert.deepEqual(d2.installerDepart(), { etat: 'refuse', installees: 0 });
    assert.deepEqual(await draupnirPost(odin, '/api/draupnir/depart/installer', {}), { ok: false, error: 'proposition refusée' });
    assert.equal(d2.list().length, 1);
  } finally { setDraupnir(undefined); d2.stop(); rmSync(home2, { recursive: true, force: true }); }
});

test('8 bis. une automatisation à soi jetée à la corbeille compte aussi : rien n\'est installé d\'office', () => avecTalos((d) => {
  d.save(flux({ id: 'perso' })); d.trash('perso');
  assert.equal(d.installerDepart().etat, 'propose');
  assert.equal(d.list().length, 0);
}));

test('9. le constructeur n\'installe rien', () => avecTalos((d, home) => {
  assert.equal(d.list().length, 0);
  assert.equal(existsSync(marque(home)), false);
  const d2 = new Talos(home, {});
  assert.equal(d2.list().length, 0); d2.stop();
}));

test('10. une marque abîmée dit qu\'une décision a été prise : rien ne revient, rien n\'est proposé, sans lever', () => avecTalos(async (d, home) => {
  // Odin neuf qui a tout installé, puis jeté trois automatisations de départ et vidé la corbeille.
  d.installerDepart();
  for (const id of ['depart-coffre', 'depart-parc', 'depart-vm']) d.trash(id);
  d.viderCorbeille();
  const n = d.list().length;
  writeFileSync(marque(home), '{oups');
  assert.equal(d.marqueDepart()?.etat, 'installe');
  assert.deepEqual(d.installerDepart(), { etat: 'installe', installees: 0 });
  assert.equal(d.list().length, n, 'les jetées ne reviennent pas');
  // « Non merci », puis une marque vidée : l'encart ne revient pas.
  await avecTalos((d2, home2) => {
    d2.save(flux({ id: 'perso' })); d2.installerDepart(); d2.refuserDepart();
    writeFileSync(marque(home2), '');
    assert.notEqual(d2.installerDepart().etat, 'propose');
    assert.equal(d2.list().length, 1);
  });
}));

test('11. le point du matin réunit deux branches : météo et agenda même sans rien dans Thot', () => {
  const pm = normalize(automatisationsDepart().find((x) => x.flow.id === 'depart-point-matin')!.flow);
  assert.deepEqual(pm.connections['Chaque matin']?.[0]?.map((l) => l.node).sort(), ['Attention', 'Météo']);
  assert.equal(pm.nodes.find((n) => n.name === 'Réunir')?.type, 'logique.fusionner');
});

test('12. une active n\'écrit jamais sans filtre : chaque message passe par un résumé qui peut se taire', () => {
  // (Les liens entre applis, eux, ne partent que sur un événement : les prévenir à chaque fois est leur rôle, essai 13.)
  for (const x of bilans().filter((y) => y.flow.active)) for (const n of x.flow.nodes ?? []) assert.notEqual(n.type, 'odin.prévenir', `${x.flow.id} : « Me prévenir » écrirait à chaque passage`);
  // Le bilan du coffre ne cite aucun compte.
  const coffre = automatisationsDepart().find((x) => x.flow.id === 'depart-coffre')!;
  assert.match(String(coffre.flow.nodes!.find((n) => n.type === 'odin.demander')!.params.consigne), /sans citer aucun compte/);
});

// ---------------------------------------------------------------- La série « Liens entre applis » (17/11)
// Sa règle : un lien qui AGIT arrive en brouillon ; un lien qui ne fait que lire et le prévenir arrive actif. Sur un
// Odin déjà installé, les nouveaux liens sont seulement PROPOSÉS : rien n'est ajouté sans son « Les ajouter ».
// (Que chaque fonction existe, ne soit pas grave et soit une lecture pour un lien actif : essai talos-dossiers-depart-actives.)
const liens = () => automatisationsDepart().filter((x) => String(x.flow.id).startsWith('depart-lien-'));
/** Le code d'une appli : src/valhalla/modules/<id>.ts et, s'il existe, le dossier src/valhalla/<id>/. */
const sourcesDe = (id: string): string => {
  assert.match(id, /^[a-z0-9_-]+$/);
  const racine = new URL('../src/valhalla/', import.meta.url);
  const fichiers = [new URL(`modules/${id}.ts`, racine)];
  const dossier = new URL(`${id}/`, racine);
  if (existsSync(dossier)) for (const f of readdirSync(dossier, { recursive: true }) as string[]) if (f.endsWith('.ts')) fichiers.push(new URL(f.replace(/\\/g, '/'), dossier));
  return fichiers.filter((f) => existsSync(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
};
const idsDe = (l: Array<{ id: string }>) => l.map((x) => x.id);
const marqueLiens = (home: string) => join(home, 'draupnir', 'state', 'depart-liens.json');
/** Un Odin installé AVANT la série : sa marque ne connaît que les bilans, et il les a tous. */
const odinDAvant = (d: Talos, home: string) => {
  for (const x of bilans()) d.save({ ...x.flow });
  writeFileSync(marque(home), JSON.stringify({ version: 1, etat: 'installe', le: '2026-11-01T00:00:00.000Z', ids: bilans().map((x) => String(x.flow.id)) }));
};
type Prop = { ok: boolean; etat: string | null; liens: Array<{ id: string; nom: string; dossier: string; active: boolean; phrase: string }> };
const avecApi = async (f: (d: Talos, home: string, get: () => Promise<Prop>, post: (p: string, b?: Record<string, unknown>) => Promise<Record<string, unknown>>) => Promise<void>) => {
  const home = jetable(), d = new Talos(home, {}); setDraupnir(d);
  const odin = {} as never;
  try {
    await f(d, home, () => draupnirGet(odin, '/api/draupnir/depart', new URLSearchParams(), '') as Promise<Prop>, (p, b = {}) => draupnirPost(odin, p, b) as Promise<Record<string, unknown>>);
  } finally { setDraupnir(undefined); d.stop(); rmSync(home, { recursive: true, force: true }); }
};

test('13. la série « Liens entre applis » : « Quand une appli signale » un vrai événement, une autre appli fait, rien ne double un réflexe', () => {
  const l = liens();
  assert.ok(l.length >= 2, `${l.length} liens`);
  for (const x of l) {
    const w = normalize(x.flow), id = String(w.id);
    assert.equal(x.dossier, 'Liens entre applis', `${id} : rangé dans la série`);
    const q = w.nodes.filter((n) => CATALOG.get(n.type)?.trigger);
    assert.equal(q.length, 1, `${id} : un seul déclencheur`);
    assert.equal(q[0].type, 'déclencheur.module', `${id} : part quand une appli signale`);
    const de = String(q[0].params.module), ev = String(q[0].params.événement);
    assert.ok(EVENEMENTS[de]?.includes(ev), `${id} : ${de} signale vraiment « ${ev} »`);
    assert.notEqual(ev, 'iso_reconnue', `${id} : le lien des ISO attend sa réponse`);
    const vers = w.nodes.filter((n) => n.type === 'module.action').map((n) => String(n.params.module));
    assert.ok(vers.length >= 1 && vers.some((m) => m !== de), `${id} : une AUTRE appli fait quelque chose`);
    for (const n of w.nodes) assert.ok(['déclencheur.module', 'module.action', 'odin.prévenir'].includes(n.type), `${id} : bloc ${n.type}`);
    // Aucun réflexe ni modèle de links.ts ne fait déjà ce lien.
    for (const m of vers) assert.ok(!LINKS.some((k) => k.from === de && k.to === m), `${id} : le réflexe ${de} → ${m} existe déjà`);
    for (const t of linkTemplates()) for (const n of t.flow.nodes as Array<{ type: string; params: Record<string, unknown> }>) if (n.type === 'déclencheur.module') assert.notEqual(String(n.params['événement']), ev, `${id} : le modèle « ${t.name} » part déjà de « ${ev} »`);
    // L'appli qui signale ne fait pas déjà elle-même ce que le lien demande (ex. Hydre ajoute déjà la sonde Pulsar
    // d'une machine qu'elle crée : src/valhalla/ymir/machines.ts).
    const code = sourcesDe(de);
    for (const n of w.nodes.filter((y) => y.type === 'module.action')) {
      const m = String(n.params.module), a = String(n.params.action);
      assert.ok(!new RegExp(`\\.call\\(\\s*['"]${m}['"]\\s*,\\s*['"]${a}['"]`).test(code), `${id} : ${de} appelle déjà ${m} · ${a} lui-même`);
    }
  }
  // L'événement « machine_creee » ne transmet pas la MAC : Atlas ne peut pas reconnaître un appareil qu'il a déjà vu
  // sur le réseau ; la description le dit avant qu'il ne l'active.
  const inv = l.find((x) => x.flow.id === 'depart-lien-machine-inventaire');
  if (inv) assert.match(String(inv.flow.settings?.description), /double/, 'le risque de fiche en double est dit');
  assert.ok(l.some((x) => x.flow.active) && l.some((x) => !x.flow.active), 'des liens actifs (lecture) et des brouillons (action)');
});

test('14. Odin installé avant la série : les liens sont PROPOSÉS, rien n\'est ajouté sans « Les ajouter », puis plus rien', () => avecApi(async (d, home, get, post) => {
  odinDAvant(d, home);
  const n = d.list().length;
  assert.deepEqual(d.installerDepart(), { etat: 'installe', installees: 0 }, 'le démarrage n\'ajoute rien');
  const g = await get();
  assert.equal(g.etat, 'installe');
  assert.deepEqual(g.liens.map((x) => x.id).sort(), liens().map((x) => String(x.flow.id)).sort(), 'seule la série est proposée');
  assert.ok(g.liens.every((x) => x.nom && x.dossier === 'Liens entre applis' && typeof x.active === 'boolean' && x.phrase));
  assert.equal(d.list().length, n, 'rien d\'ajouté avant son accord');
  const r = await post('/api/draupnir/depart/liens/installer', { ids: idsDe(g.liens) });
  assert.deepEqual(r, { ok: true, installees: liens().length });
  for (const x of liens()) {
    const w = d.parId(String(x.flow.id));
    assert.ok(w, `${x.flow.id} ajouté`);
    assert.equal(w.active, x.flow.active === true, `${x.flow.id} : actif seulement s'il ne fait que lire`);
    assert.equal(d.nomDossier(String(w.dossier)), 'Liens entre applis');
  }
  assert.equal(d.list().length, n + liens().length);
  assert.deepEqual((await get()).liens, [], 'plus rien à proposer');
  assert.deepEqual(await post('/api/draupnir/depart/liens/installer', { ids: idsDe(g.liens) }), { ok: false, error: 'aucun lien à ajouter' });
  // Jeté puis corbeille vidée : jamais reproposé.
  d.trash(String(liens()[0].flow.id)); d.viderCorbeille();
  assert.deepEqual((await get()).liens, []);
}));

test('15. « Non merci » : la série ne revient plus ; un identifiant ajouté plus tard au code est proposé, une fois', () => avecApi(async (d, home, get, post) => {
  odinDAvant(d, home);
  const n = d.list().length;
  assert.deepEqual(await post('/api/draupnir/depart/liens/refuser', { ids: idsDe((await get()).liens) }), { ok: true });
  assert.deepEqual((await get()).liens, []);
  assert.equal(d.list().length, n, 'rien d\'ajouté');
  assert.equal(d.marqueDepart()?.etat, 'installe', 'la marque des automatisations de départ n\'a pas bougé');
  // Un lien ajouté au code après le refus : la marque de la série ne le connaît pas encore.
  const neuf = String(liens()[liens().length - 1].flow.id);
  const m = JSON.parse(readFileSync(marqueLiens(home), 'utf8')) as { ids: string[] };
  writeFileSync(marqueLiens(home), JSON.stringify({ ...m, ids: m.ids.filter((x) => x !== neuf) }));
  assert.deepEqual((await get()).liens.map((x) => x.id), [neuf], 'seul le nouveau est proposé');
  assert.deepEqual(await post('/api/draupnir/depart/liens/refuser', { ids: [neuf] }), { ok: true });
  assert.deepEqual((await get()).liens, [], 'une seule fois');
  assert.equal(d.list().length, n);
}));

test('16. marque abîmée : jamais une nouvelle proposition des automatisations de départ ; seule la série peut l\'être', () => avecApi(async (d, home, get) => {
  // Odin d'avant la série, qui avait jeté trois bilans et vidé la corbeille, puis dont la marque s'abîme.
  odinDAvant(d, home);
  for (const id of ['depart-coffre', 'depart-parc', 'depart-vm']) d.trash(id);
  d.viderCorbeille();
  writeFileSync(marque(home), '{oups');
  const g = await get();
  assert.ok(g.liens.every((x) => x.id.startsWith('depart-lien-')), 'aucun bilan reproposé');
  assert.equal(g.liens.length, liens().length);
  assert.deepEqual(d.installerDepart(), { etat: 'installe', installees: 0 });
  assert.equal(d.parId('depart-coffre'), undefined);
  // Odin neuf qui a tout installé (série comprise), jeté un lien, vidé la corbeille, puis marque abîmée : rien.
  await avecTalos((d2, home2) => {
    d2.installerDepart();
    d2.trash(String(liens()[0].flow.id)); d2.viderCorbeille();
    writeFileSync(marque(home2), '');
    assert.deepEqual(d2.liensAProposer(), []);
    // Les deux marques abîmées : toujours rien.
    writeFileSync(marqueLiens(home2), '[');
    assert.deepEqual(d2.liensAProposer(), []);
  });
}));

test('17. Odin neuf : la série s\'installe avec le reste et n\'est pas proposée ensuite ; en attente ou refusée, pas d\'encart à part', async () => {
  await avecTalos((d) => {
    d.installerDepart();
    for (const x of liens()) assert.equal(d.parId(String(x.flow.id))?.active, x.flow.active === true);
    assert.deepEqual(d.liensAProposer(), []);
  });
  await avecApi(async (d, _home, get, post) => {
    d.save(flux({ id: 'perso' })); d.installerDepart();
    const g = await get();
    assert.equal(g.etat, 'propose');
    assert.deepEqual(g.liens, [], 'la proposition des automatisations de départ comprend déjà la série');
    assert.deepEqual(await post('/api/draupnir/depart/refuser'), { ok: true });
    assert.deepEqual((await get()).liens, [], '« Non merci » vaut aussi pour la série');
    assert.equal(d.list().length, 1);
  });
});

test('18. l\'encart : « Odin propose N nouveaux liens entre applis », actifs et brouillons comptés', () => {
  const win: { OdinTalosDossiers?: { logique: { texteLiens: (l: Array<{ active: boolean }>) => string } } } = {};
  vm.runInNewContext(readFileSync(new URL('../src/web/pages/talos-dossiers.js', import.meta.url), 'utf8'), { window: win });
  const t = win.OdinTalosDossiers?.logique.texteLiens;
  assert.equal(typeof t, 'function', 'texteLiens est posé');
  assert.equal(t!([{ active: true }, { active: false }, { active: false }]), 'Odin propose 3 nouveaux liens entre applis : 1 ne fait que lire et te prévenir (il tourne seul), 2 agissent et arrivent en brouillon.');
  assert.equal(t!([{ active: false }]), 'Odin propose 1 nouveau lien entre applis : il agit et arrive en brouillon.');
  assert.equal(t!([{ active: true }]), 'Odin propose 1 nouveau lien entre applis : il ne fait que lire et te prévenir (il tourne seul).');
  // La question avant « Les ajouter » : jamais « 0 tourne seul ».
  const c = (win.OdinTalosDossiers?.logique as unknown as { texteConfirmLiens?: (l: Array<{ active: boolean }>) => string }).texteConfirmLiens;
  assert.equal(typeof c, 'function', 'texteConfirmLiens est posé');
  assert.equal(c!([{ active: false }, { active: false }]), 'Ajouter les 2 liens entre applis ? Ils agissent : ils restent en brouillon jusqu\'à ce que tu les actives.');
  assert.equal(c!([{ active: false }]), 'Ajouter ce lien entre applis ? Il agit : il reste en brouillon jusqu\'à ce que tu l\'actives.');
  assert.equal(c!([{ active: true }]), 'Ajouter ce lien entre applis ? Il tourne seul : il ne fait que lire et te prévenir.');
  assert.equal(c!([{ active: true }, { active: false }]), 'Ajouter les 2 liens entre applis ? 1 tourne seul : il ne fait que lire et te prévenir. Celui qui agit reste en brouillon jusqu\'à ce que tu l\'actives.');
  assert.equal(c!([{ active: true }, { active: true }, { active: false }, { active: false }]), 'Ajouter les 4 liens entre applis ? 2 tournent seuls : ils ne font que lire et te prévenir. Ceux qui agissent restent en brouillon jusqu\'à ce que tu les actives.');
  for (const l of [[{ active: false }], [{ active: false }, { active: false }]]) assert.doesNotMatch(c!(l), /\b0 /);
});

test('19. proposition de départ refusée AVANT la série : la série est proposée (une proposition, rien d\'ajouté sans accord)', () => avecApi(async (d, home, get) => {
  d.save(flux({ id: 'perso' }));
  writeFileSync(marque(home), JSON.stringify({ version: 1, etat: 'refuse', le: '2026-11-01T00:00:00.000Z', ids: bilans().map((x) => String(x.flow.id)) }));
  const g = await get();
  assert.equal(g.etat, 'refuse');
  assert.deepEqual(idsDe(g.liens).sort(), liens().map((x) => String(x.flow.id)).sort(), 'seule la série, jamais un bilan');
  assert.equal(d.list().length, 1, 'rien d\'ajouté');
  assert.deepEqual(d.installerDepart(), { etat: 'refuse', installees: 0 }, 'le démarrage n\'ajoute rien');
}));

test('20. « Les ajouter » et « Non merci » ne valent que pour les liens AFFICHÉS', () => avecApi(async (d, home, get, post) => {
  odinDAvant(d, home);
  const n = d.list().length, tous = idsDe((await get()).liens);
  assert.ok(tous.length >= 2);
  // Sans la liste affichée : rien.
  assert.equal((await post('/api/draupnir/depart/liens/installer')).ok, false, 'installer sans liste refusé');
  assert.equal((await post('/api/draupnir/depart/liens/refuser')).ok, false, 'refuser sans liste refusé');
  assert.equal(d.list().length, n);
  assert.deepEqual(idsDe((await get()).liens), tous, 'toujours proposés');
  // Un identifiant qui n'était pas affiché (ou inconnu) n'est ni ajouté ni refusé.
  assert.deepEqual(await post('/api/draupnir/depart/liens/installer', { ids: [tous[0], 'depart-bilan-securite', 'depart-lien-inconnu'] }), { ok: true, installees: 1 });
  assert.ok(d.parId(tous[0]));
  assert.equal(d.list().length, n + 1);
  assert.deepEqual(idsDe((await get()).liens), tous.slice(1), 'les autres restent proposés');
  assert.deepEqual(await post('/api/draupnir/depart/liens/refuser', { ids: [tous[1]] }), { ok: true });
  assert.deepEqual(idsDe((await get()).liens), tous.slice(2), 'seul l\'affiché est refusé');
}));
