// Talos : les automatisations de départ (src/draupnir/depart.ts) et leur installation, une seule fois.
// Les actives ne doivent rien faire qui engage le propriétaire sans lui : chaque action d'appli qu'elles lancent est
// cherchée dans le vrai module et doit être une lecture sans gravité.
// Chaque essai tourne dans un dossier jetable : rien n'est écrit dans le vrai dossier d'Odin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { automatisationsDepart, DOSSIERS_DEPART } from '../src/draupnir/depart.ts';
import { checkFlow, normalize, type Workflow } from '../src/draupnir/engine.ts';
import { CATALOG } from '../src/draupnir/nodes.ts';
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

test('1. entre 15 et 25 automatisations, identifiants uniques en « depart- », chacune dans un dossier connu', () => {
  const l = automatisationsDepart();
  assert.ok(l.length >= 15 && l.length <= 25, `${l.length} automatisations`);
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
    if (w.active) assert.ok(infosFlow(w).prochaine, `${w.id} : prochaine exécution calculée`);
  }
});

test('3. sûreté : les actives ne contiennent que des blocs permis, et des actions d\'applis en lecture sans gravité', async () => {
  const actives = automatisationsDepart().filter((x) => x.flow.active === true);
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
  for (const x of automatisationsDepart().filter((y) => y.flow.active)) for (const n of x.flow.nodes ?? []) assert.notEqual(n.type, 'odin.prévenir', `${x.flow.id} : « Me prévenir » écrirait à chaque passage`);
  // Le bilan du coffre ne cite aucun compte.
  const coffre = automatisationsDepart().find((x) => x.flow.id === 'depart-coffre')!;
  assert.match(String(coffre.flow.nodes!.find((n) => n.type === 'odin.demander')!.params.consigne), /sans citer aucun compte/);
});
