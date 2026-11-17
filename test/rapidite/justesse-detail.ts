// Banc de justesse, détail d'une demande : ce que Logos propose (appsFor, avec les scores), ce que la recherche dans
// les notes trouve parmi les fiches d'applis, et les mots que le Cerveau tire de la demande.
//
//   node --disable-warning=ExperimentalWarning test/rapidite/justesse-detail.ts "phrase 1" "phrase 2" …

process.env.ODIN_ESSAI = '1'; process.env.ODIN_NO_VOICE_INSTALL = '1'; process.env.ODIN_NO_LOCAL_BRAIN = '1';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { createOdin } = await import('../../src/runtime.ts');
const { MockProvider } = await import('../../src/providers/mock.ts');
const { valhallaOf, startValhalla, allModules } = await import('../../src/valhalla/odin.ts');
const { appsFor, keywords } = await import('../../src/valhalla/besoin.ts');
const { brainOf } = await import('../../src/tools/brain.ts');
const home = mkdtempSync(join(tmpdir(), 'odin-rapidite-detail-'));
const o = createOdin({ home, provider: new MockProvider([{ text: 'ok' }]), approver: { approve: async () => false } });
const arreter = startValhalla(o, async () => {}, { modules: allModules(o) });
await new Promise((x) => setTimeout(x, 1500));
const v = valhallaOf()!, vault = brainOf({ home, careCfg: o.cfg, workspace: o.paths.workspace });
for (const p of process.argv.slice(2)) {
  console.log(`\n« ${p} » mots : ${keywords(p).join(', ') || '(aucun)'}`);
  console.log('  Logos (appsFor) :', appsFor(v, p, 6).map((f) => `${f.m.id}/${f.m.name}=${f.score}${f.action ? `(${f.action.id})` : ''}`).join(' · ') || '(rien)');
  console.log('  fiches trouvées :', vault.search(keywords(p).join(' ') || p, 30).filter((r) => r.note.path.startsWith('Odin/Applis/')).slice(0, 6).map((r) => `${r.note.title}=${r.score.toFixed(1)}(${r.note.body.length} car.)`).join(' · ') || '(rien)');
}
try { arreter(); o.close(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }); } catch { /* */ }
process.exit(0);
