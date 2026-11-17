// Banc de JUSTESSE du Cerveau : ce que Brain met en tête pour le modèle nomme-t-il la bonne appli ?
//
//   node --disable-warning=ExperimentalWarning test/rapidite/justesse.ts [--detail]
//
// Les 140 demandes de la campagne des tâches de tous les jours (test/taches/campagne.ts, lu seulement) ; pour chaque
// demande qui attend une appli : la consultation du Cerveau (consultBrain, la même que celle du tour), dans un Odin
// jetable avec toutes ses applis. Deux mesures, sur l'ordre où le bloc du Cerveau les donne au modèle :
//  - « en tête » : la bonne appli est parmi les 3 premières applis nommées (section Applis, puis fiches d'applis) ;
//  - « 1re note » : la 1re note du bloc est la fiche de la bonne appli (la mesure de la campagne).
// Par langue (fr, en, autres) ; et le temps de chaque consultation.

process.env.ODIN_ESSAI = '1';
process.env.ODIN_NO_VOICE_INSTALL = '1';
process.env.ODIN_NO_LOCAL_BRAIN = '1';

import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { ecrireResultat, stat, tableau } from './outils.ts';

export interface LigneJustesse { id: string; langue: string; phrase: string; attendues: string[]; logos: string[]; mots: string[]; tete: string[]; notes: string[]; enTete: boolean; premiereNote: boolean; ms: number }

export async function mesurerJustesse(): Promise<{ lignes: LigneJustesse[]; ignorees: number; resume: Record<string, { n: number; enTete: number; premiereNote: number }> }> {
  const { DEMANDES } = await import('../taches/campagne.ts');
  // RAPIDITE_CONTEXTE : une autre copie de contexte.ts (ex. celle du dernier commit) pour comparer sur la même campagne.
  const { consultBrain } = await import(process.env.RAPIDITE_CONTEXTE ? (await import('node:url')).pathToFileURL(process.env.RAPIDITE_CONTEXTE).href : '../../src/brain/contexte.ts') as typeof import('../../src/brain/contexte.ts');
  const { liensDe } = await import('../../src/brain/liens-vivants.ts');
  const { keywords } = await import('../../src/valhalla/besoin.ts');
  const { brainOf } = await import('../../src/tools/brain.ts');
  const { valhallaOf, startValhalla, allModules } = await import('../../src/valhalla/odin.ts');
  const { createOdin } = await import('../../src/runtime.ts');
  const { MockProvider } = await import('../../src/providers/mock.ts');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  // Un Odin jetable avec toutes ses applis (sans passer par test/helpers.ts : rien n'est joué ici, on consulte seulement).
  const home = mkdtempSync(join(tmpdir(), 'odin-rapidite-justesse-'));
  const o = createOdin({ home, provider: new MockProvider([{ text: 'ok' }]), approver: { approve: async () => false }, configOverride: (c) => ({ ...c, watch: { ...c.watch, enabled: false }, continuous: { ...c.continuous, enabled: false, autoResume: false }, journal: { ...c.journal, enabled: false }, veille: { enabled: false, at: '12:30' }, update: { auto: 'off' as const, everyHours: 6 }, web: { ...c.web, portsParAppli: false } }) });
  const arreter = startValhalla(o, async () => {}, { modules: allModules(o) });
  const s = { o, fermer: () => { try { arreter(); } catch { /* */ } try { o.close(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }); } catch { /* */ } } };
  try {
    await new Promise((x) => setTimeout(x, 1500)); // les fiches des applis sont écrites au démarrage
    const v = valhallaOf()!;
    const vault = brainOf({ home: s.o.paths.home, careCfg: s.o.cfg, workspace: s.o.paths.workspace });
    const parNom = new Map(v.modules().map((m) => [m.name, m.id]));
    const lignes: LigneJustesse[] = []; let ignorees = 0;
    for (const d of DEMANDES) {
      if (d.attendu !== 'appli') continue;
      const attendues = [...new Set((d.applis ?? []).map((x) => x.split('.')[0]).filter((id) => v.module(id)?.id === id))];
      if (!attendues.length) { ignorees++; continue; }
      const liens = liensDe(s.o.muninn);
      const t = performance.now();
      const c = consultBrain({ vault, apps: v, liens: liens.actif() ? liens : undefined, souvenirs: [] }, d.phrase);
      const ms = performance.now() - t;
      const tete: string[] = [];
      for (const a of c.apps) if (!tete.includes(a.id)) tete.push(a.id);
      for (const n of c.notes) { const id = n.path.startsWith('Odin/Applis/') ? parNom.get(n.title) : undefined; if (id && !tete.includes(id)) tete.push(id); }
      const premiere = c.notes[0];
      lignes.push({ id: d.id, langue: d.langue, phrase: d.phrase, attendues, logos: c.apps.map((a) => a.id), mots: keywords(d.phrase), tete: tete.slice(0, 5), notes: c.notes.slice(0, 3).map((n) => n.title), enTete: tete.slice(0, 3).some((x) => attendues.includes(x)), premiereNote: Boolean(premiere && premiere.path.startsWith('Odin/Applis/') && attendues.includes(parNom.get(premiere.title) ?? '')), ms });
    }
    const resume: Record<string, { n: number; enTete: number; premiereNote: number }> = {};
    for (const g of ['fr', 'en', 'autres', 'tout']) {
      const l = lignes.filter((x) => g === 'tout' || (g === 'autres' ? !['fr', 'en'].includes(x.langue) : x.langue === g));
      resume[g] = { n: l.length, enTete: l.filter((x) => x.enTete).length, premiereNote: l.filter((x) => x.premiereNote).length };
    }
    return { lignes, ignorees, resume };
  } finally { s.fermer(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { lignes, ignorees, resume } = await mesurerJustesse();
  const pc = (a: number, n: number) => (n ? `${a}/${n} (${Math.round((a / n) * 100)} %)` : '—');
  const t = stat(lignes.map((l) => l.ms));
  let texte = `Justesse du Cerveau sur la campagne (${lignes.length} demandes qui attendent une appli ; ${ignorees} ignorées : appli attendue qui n'est pas un module).\n`;
  texte += tableau(['langue', 'bonne appli dans les 3 premières', '1re note = sa fiche'], ['fr', 'en', 'autres', 'tout'].map((g) => [g, pc(resume[g].enTete, resume[g].n), pc(resume[g].premiereNote, resume[g].n)])) + '\n';
  texte += `Temps d'une consultation : médiane ${t.mediane} ms, 95e ${t.p95} ms.\n`;
  // Pourquoi c'est raté : Logos ne propose rien (alors seules les fiches trouvées par la recherche du coffre comptent), ou
  // Logos propose une autre appli ; et : aucun mot retenu de la demande (écriture sans espaces, mots de 1-2 lettres).
  const ratees = lignes.filter((l) => !l.enTete);
  const causes = { 'Logos ne propose rien': ratees.filter((l) => !l.logos.length).length, 'Logos propose une autre appli': ratees.filter((l) => l.logos.length).length, 'aucun mot retenu de la demande': ratees.filter((l) => !l.mots.length).length };
  const bienLogos = lignes.filter((l) => l.logos.slice(0, 3).some((x) => l.attendues.includes(x))).length;
  texte += `Causes des ${ratees.length} ratées : ${Object.entries(causes).map(([k, n]) => `${k} ${n}`).join(' ; ')}. Logos seul a la bonne appli dans ses 3 premières pour ${bienLogos}/${lignes.length} demandes.\n`;
  if (process.argv.includes('--detail')) texte += `\nRatées :\n${lignes.filter((l) => !l.enTete).map((l) => `- [${l.langue}] ${l.phrase} → attendu ${l.attendues.join('/')} ; en tête : ${l.tete.join(', ') || '(rien)'} ; notes : ${l.notes.join(' | ') || '(aucune)'}`).join('\n')}\n`;
  ecrireResultat('justesse', { resume, ignorees, lignes }, texte);
  console.log(texte);
  process.exit(0);
}
