// Le tout premier démarrage d'Odin sur une machine qui n'est pas sous Linux (Windows, macOS), installé en copiant le
// code, sans PostgreSQL : la base d'Odin ne peut pas s'y préparer (Hringhorni, le moteur de conteneurs d'Odin, a
// besoin de Linux). Odin ne doit alors ni essayer Hringhorni (il irait chercher une image PostgreSQL sur un registre
// extérieur, puis attendrait dix minutes pour rien, et recommencerait), ni dire « la base se prépare » : il démarre
// avec ses réglages en fichiers et dit tout de suite pourquoi la base manque.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { amorcerReglages } from '../src/reglages-base.ts';
import { utiliserBase } from '../src/valhalla/base/index.ts';
import { useEngine, type EngineLike } from '../src/valhalla/modules/naglfar.ts';
import { Engine } from '../src/valhalla/hringhorni/engine.ts';

process.env.ODIN_NO_VOICE_INSTALL ??= '1';
const SOUS_LINUX = process.platform === 'linux' && 'sous Linux, Hringhorni peut préparer la base : cet essai vise les autres systèmes';

test('premier démarrage hors Linux, sans PostgreSQL : ni Hringhorni ni téléchargement, et la raison est dite tout de suite', { skip: SOUS_LINUX, timeout: 60_000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'odin-premier-'));
  // Un faux moteur : il note chaque lancement (qui commencerait par télécharger l'image « postgres » sur un registre).
  const lancements: string[] = [];
  const faux = {
    find(n: string): never { throw new Error(`conteneur introuvable : ${n}`); },
    runJob(o: { image: string }) { lancements.push(o.image); return { id: 'essai', kind: 'installer', image: o.image, phase: 'attente', pct: 0, done: 0, total: 1, note: '', started: new Date().toISOString() }; },
    findImage() { return undefined; },
  } as unknown as EngineLike;
  useEngine(() => faux);
  const journal: string[] = [];
  const t0 = Date.now();
  // Comme la passerelle (src/cli/main.ts) : sans cible, sans option, au premier lancement.
  const am = await amorcerReglages(home, { log: (l) => journal.push(l) });
  const duree = Date.now() - t0;
  const dateNow = Date.now;
  t.diagnostic(am.message);
  try {
    assert.deepEqual(lancements, [], 'Hringhorni n\'est pas essayé hors Linux (il téléchargerait une image PostgreSQL)');
    assert.equal(am.source, 'copie', 'Odin démarre avec ses réglages en fichiers');
    assert.doesNotMatch(am.message, /se prépare/, `la base ne « se prépare » pas : elle ne le peut pas ici (${am.message})`);
    assert.equal(am.base?.etat, 'absente', am.base?.message);
    assert.match(am.base?.message ?? '', new RegExp(process.platform), 'le message dit sur quel système la base manque');
    // Le message des réglages reprend la cause seule, pas tout le message de la base emboîté dedans.
    assert.match(am.message, new RegExp(process.platform), 'la cause est dans le message des réglages');
    assert.doesNotMatch(am.message, /Odin marche quand même/, `pas de message emboîté (${am.message})`);
    assert.equal(am.message.match(/ne répond pas/g)?.length ?? 0, 1, `« ne répond pas » une seule fois (${am.message})`);
    // L'état « absente » au retour prouve que la vérification a fini avant le délai de démarrage (sinon elle serait
    // encore « en préparation ») ; la durée n'est qu'un repère, avec de la marge pour une machine chargée.
    t.diagnostic(`durée de l'amorce : ${duree} ms`);
    assert.ok(duree < 20_000, `la raison est connue sans attendre une préparation (${duree} ms)`);
  } finally {
    // Avant la correction, une attente de dix minutes tourne encore (waitServer) : on la fait finir.
    Date.now = () => dateNow() + 3_600_000;
    await am.base?.verifier().catch(() => undefined);
    Date.now = dateNow;
    am.arreter(); await am.base?.arreter(); utiliserBase(undefined);
    useEngine(() => new Engine());
    rmSync(home, { recursive: true, force: true });
  }
});
