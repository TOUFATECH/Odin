// Talos : chaque automatisation de départ livrée ACTIVE, lancée pour de bon sur un Odin neuf (dossier jetable,
// vraies applis d'Odin, commandes et réseau simulés et vides, IA simulée qui répond RIEN) :
// - elle réussit (aucune ne tombe en erreur faute de réglage ou parce qu'elle tourne sous Windows) ;
// - elle se tait : aucun message n'est envoyé quand il n'y a rien à dire.
// Le point du matin donne la météo et les rendez-vous même quand Thot n'a rien qui demande attention.
// Les modules sont importés APRÈS avoir posé ODIN_HOME : rien n'est écrit dans le vrai dossier d'Odin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'talos-depart-actives-'));
process.env.ODIN_HOME = home;

test('chaque active réussit sur un Odin neuf et ne dit rien quand il n\'y a rien à dire', { timeout: 300_000 }, async () => {
  const { Valhalla } = await import('../src/valhalla/service.ts');
  const { allModules } = await import('../src/valhalla/odin.ts');
  const { DEFAULT_CONFIG } = await import('../src/config.ts');
  const { Talos } = await import('../src/draupnir/service.ts');
  const { automatisationsDepart } = await import('../src/draupnir/depart.ts');
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), {
    run: async () => ({ code: 0, out: '', err: '' }), fetch: (async () => new Response('')) as unknown as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre',
  } as never);
  const envoyes: string[] = [], demandes: string[] = [];
  const d = new Talos(home, {
    module: (m: string, a: string, i: Record<string, unknown>) => v.act(m, a, i, { auto: true, by: 'automatisation' } as never),
    ask: async (t: string) => { demandes.push(t); return 'RIEN'; },
    notify: async (t: string) => { envoyes.push(t); },
    saga: { search: () => [], read: () => undefined, create: () => 'x.md', append: () => 'x.md', attention: () => [], rows: () => [] },
  } as never);
  try {
    d.installerDepart();
    // Les liens entre applis ne partent que sur un événement : essai suivant.
    const actives = automatisationsDepart().filter((x) => x.flow.active && !String(x.flow.id).startsWith('depart-lien-')).map((x) => String(x.flow.id));
    assert.ok(actives.length >= 10);
    const echecs: string[] = [];
    for (const id of actives) {
      const ex = await Promise.race([d.run(id, undefined, 'test'), new Promise<{ status: string; error: string }>((r) => setTimeout(() => r({ status: 'délai', error: '20 s dépassées' }), 20_000))]) as { status: string; error?: string; failedNode?: string };
      if (ex.status !== 'succès') echecs.push(`${id} : ${ex.status}${ex.failedNode ? ` [${ex.failedNode}]` : ''} ${ex.error ?? ''}`);
    }
    assert.deepEqual(echecs, [], 'chaque active réussit sur un Odin neuf');
    assert.deepEqual(envoyes, [], 'aucun message quand il n\'y a rien à dire');
    // Point du matin sans rien dans Thot : la météo et l'agenda sont lus, et Odin est bien consulté.
    const pm = d.runs('depart-point-matin', 1)[0];
    for (const etape of ['Météo', 'Agenda', 'Réunir', 'Résumer']) assert.ok(pm.nodes[etape], `point du matin : étape « ${etape} » passée`);
    assert.equal(pm.nodes.Regrouper, undefined, 'rien à regrouper');

    // ---------------- Les liens entre applis, contre les vraies applis.
    // Chaque fonction existe, n'est pas grave avec ses réglages ; un lien est actif SEULEMENT s'il ne fait que lire.
    const { estGrave } = await import('../src/draupnir/liens.ts');
    const liens = automatisationsDepart().filter((x) => String(x.flow.id).startsWith('depart-lien-'));
    assert.ok(liens.length >= 2);
    for (const x of liens) {
      let lit = true;
      for (const n of x.flow.nodes ?? []) {
        if (n.type !== 'module.action') continue;
        const m = v.modules().find((y) => y.id === n.params.module), a = m?.actions.find((y) => y.id === n.params.action);
        assert.ok(a, `${x.flow.id} : ${String(n.params.module)} · ${String(n.params.action)} existe`);
        assert.equal(estGrave(a, JSON.parse(String(n.params.entrée ?? '{}'))), false, `${x.flow.id} : ${a.id} n'est pas grave`);
        for (const p of a.params ?? []) if (p.required) assert.ok(String(n.params.entrée).includes(`"${p.key}"`), `${x.flow.id} : « ${p.key} » est rempli`);
        if (!a.read) lit = false;
      }
      assert.equal(x.flow.active === true, lit, `${x.flow.id} : ${lit ? 'ne fait que lire : actif' : 'agit : brouillon'}`);
    }
    // Un lien actif part vraiment quand l'appli signale, et prévient le propriétaire.
    for (const x of liens.filter((y) => y.flow.active)) {
      const q = (x.flow.nodes ?? []).find((n) => n.type === 'déclencheur.module')!, de = String(q.params.module);
      const avant: number = envoyes.length;
      await d.onModule({ module: de, name: v.modules().find((m) => m.id === de)!.name, type: String(q.params.événement), data: { login: 'camille', ip: '203.0.113.7' } });
      const ex = d.runs(String(x.flow.id), 1)[0];
      assert.equal(ex?.status, 'succès', `${x.flow.id} : ${ex?.error ?? 'aucune exécution'}`);
      assert.equal(envoyes.length, avant + 1, `${x.flow.id} : un message`);
    }
  } finally { d.stop(); }
});

test.after(() => { try { rmSync(home, { recursive: true, force: true }); } catch { /* fichiers encore ouverts : dossier temporaire */ } });
