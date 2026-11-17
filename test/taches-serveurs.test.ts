// Tâches de tous les jours, famille « serveurs, machines virtuelles et conteneurs » (campagne `test/taches/`).
//  - Sans IA, des demandes ordinaires partaient ailleurs : « donne-moi l'IP et l'accès du conteneur web » vers la
//    CRÉATION d'un service d'Argo, « partage le dossier Photos en Samba » vers la simple liste des partages.
//  - La validation demandée pour lancer un conteneur venu d'un lien ne disait pas que tes dossiers y seraient branchés.
process.env.ODIN_ESSAI = '1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeEngine, makeOdin } from './helpers.ts';
import { allModules, startValhalla, valhallaOf } from '../src/valhalla/odin.ts';
import { understand } from '../src/valhalla/huginn.ts';
import { useEngine } from '../src/valhalla/modules/naglfar.ts';

const resume = (u: Awaited<ReturnType<typeof understand>>) => !u ? 'rien' : u.kind === 'action' ? `${u.module}.${u.action}` : u.kind === 'ask' ? `${u.module}.${u.action} (demande)` : u.kind;

test('serveurs et conteneurs : la bonne appli, sans IA', { timeout: 120_000 }, async () => {
  useEngine(() => fakeEngine([{ Names: 'web', Image: 'nginx:1.27', State: 'running' }]));
  const o = makeOdin([]);
  const stop = startValhalla(o, async () => {}, { modules: allModules(o) });
  try {
    const v = valhallaOf()!;
    let n = 0;
    const vu = async (phrase: string) => resume(await understand(v, phrase, `srv-${n++}`));
    assert.match(await vu('donne-moi l\'IP et l\'accès du conteneur web'), /^naglfar\.(ports|lister)/);
    assert.match(await vu('partage le dossier Photos en Samba'), /^fensalir\.ajouter_partage/);
  } finally { stop(); o.cleanup(); }
});

test('lancer un conteneur : la validation dit quels dossiers et quels ports il reçoit', () => {
  const o = makeOdin([]);
  try {
    const a = allModules(o).find((m) => m.id === 'naglfar')!.actions.find((x) => x.id === 'lancer')!;
    const t = String(a.grave?.({ image: 'ghcr.io/exemple/appli:latest', dossiers: 'C:/Users/moi/Documents:/data', ports: '8080:80' }, {} as never));
    assert.match(t, /ghcr\.io\/exemple\/appli/);
    assert.match(t, /C:\/Users\/moi\/Documents/);
    assert.match(t, /8080/);
    // Sans dossier ni port : rien de plus.
    assert.doesNotMatch(String(a.grave?.({ image: 'nginx:1.27' }, {} as never)), /dossier|port/);
  } finally { o.cleanup(); }
});
