// Noûs — ce qu'Odin lit de LUI-MÊME pour son premier corpus : ses applis (définitions réelles des modules), leurs liens
// et usages, le guide des applis, ses compétences, puis les notes du Cerveau et les souvenirs du propriétaire.
// Lecture seule ; rien ici ne range quoi que ce soit (c'est corpus-depart.ts qui passe tout par nourrir()).
import type { Odin } from '../../runtime.ts';
import { valhallaOf } from '../../valhalla/odin.ts';
import { LINKS, USAGES } from '../../valhalla/links.ts';
import { SURVOL } from '../../valhalla/survol.ts';
import { brainOf } from '../../tools/brain.ts';
import type { SourcesDepart } from './corpus-depart.ts';

export function sourcesDepartOdin(odin: Pick<Odin, 'paths' | 'cfg' | 'skills' | 'muninn'> & { paths: Odin['paths'] }): SourcesDepart {
  const v = valhallaOf();
  return {
    modules: (v?.modules() ?? []).map((m) => ({
      id: m.id, name: m.name, what: m.what, does: m.does, words: m.words,
      actions: m.actions.map((a) => ({ id: a.id, label: a.label, what: a.what, words: a.words, read: a.read })),
    })),
    liens: LINKS, usages: USAGES, survol: SURVOL,
    competences: (() => { try { return odin.skills.list().map((s) => ({ name: s.name, description: s.description })); } catch { return []; } })(),
    notes: () => { try { return brainOf({ home: odin.paths.home, careCfg: odin.cfg, workspace: odin.paths.workspace }).all().map((n) => ({ title: n.title, body: n.body, meta: { type: n.meta?.type, fiable: n.meta?.fiable } })); } catch { return []; } },
    souvenirs: () => { try { return odin.muninn.listMemories(5000).map((m) => ({ id: m.id, content: m.content, origin: m.origin, kind: m.kind })); } catch { return []; } },
  };
}
