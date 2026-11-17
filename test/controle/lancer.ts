// L'ENTRAÎNEMENT DE CONTRÔLE d'Odin (cahier APP-05, APP-06 ; lot 1, élément 8) : des scénarios fixes joués contre un Odin
// jetable, sans réseau, qui rendent une NOTE PAR DOMAINE. Chaque lancement est gardé (fichier daté + historique) pour
// voir la progression. Il ne modifie jamais Odin.
//
//   node --disable-warning=ExperimentalWarning test/controle/lancer.ts                 tout (sans modèle + modèle local)
//   … lancer.ts --partie sans-modele                                                    la partie déterministe seulement
//   … lancer.ts --domaine securite,memoire        … lancer.ts --id commande-vpn          un choix
//   … lancer.ts --sortie <dossier>                où ranger les notes (défaut : <dossier d'Odin>/controle)
//   … lancer.ts --liste                           la liste des scénarios
// Modèle local : SOUL_HOME=<dossier d'Odin jetable où Soul a un point de reprise> (et ODIN_CLE_DIR=<ses clés>) ;
// METIS_GGUF=<fichier GGUF> pour un modèle de langue local. Sans eux, ces scénarios sont « ignorés ».

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { reseau, type Scenario, type Verdict } from './banc.ts';
import { COMMANDES } from './commandes.ts';
import { VRAI_FAUX } from './vrai-faux.ts';
import { INFORMATION } from './information.ts';
import { ORGANISATION } from './organisation.ts';
import { MEDIAS } from './medias.ts';
import { VOIX } from './voix.ts';
import { MEMOIRE } from './memoire.ts';
import { SECURITE } from './securite.ts';
import { DECISIONS } from './decisions.ts';
import { MODELE_LOCAL, fermerModeleLocal } from './modele-local.ts';
import { LANGUES_SCENARIOS } from './langues.ts';

export const TOUS: Scenario[] = [...COMMANDES, ...VRAI_FAUX, ...INFORMATION, ...ORGANISATION, ...MEDIAS, ...VOIX, ...MEMOIRE, ...SECURITE, ...DECISIONS, ...LANGUES_SCENARIOS, ...MODELE_LOCAL];

const arg = (n: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const liste = (n: string) => arg(n)?.split(',').map((x) => x.trim()).filter(Boolean);

/** Le classement d'un résultat : réussi ; défaut réel d'Odin ; fonction pas encore codée ; scénario discutable (il mesure
 *  autre chose que ce qu'il annonce : on le montre, on ne le compte ni comme réussite ni comme défaut) ; ignoré. */
type Classe = 'reussi' | 'defaut' | 'pas-code' | 'discutable' | 'ignore';
interface Resultat { id: string; domaine: string; partie: string; titre: string; exigence: string; attendu: string; simule: boolean; ok: boolean | 'ignore'; classe: Classe; detail: string; ms: number }
const classer = (s: Scenario, ok: boolean | 'ignore'): Classe => ok === 'ignore' ? 'ignore' : s.nature === 'discutable' ? 'discutable' : ok ? 'reussi' : s.nature === 'pas-code' ? 'pas-code' : 'defaut';

async function jouerUn(s: Scenario): Promise<Resultat> {
  const t0 = performance.now();
  let v: Verdict;
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  try {
    v = await Promise.race([s.jouer(), new Promise<Verdict>((ok) => { minuterie = setTimeout(() => ok({ ok: false, detail: 'trop long (plus de 90 s)' }), 90_000); })]);
  } catch (e) { v = { ok: false, detail: `erreur : ${String((e as Error)?.message ?? e).slice(0, 160)}` }; }
  finally { if (minuterie) clearTimeout(minuterie); }
  return { id: s.id, domaine: s.domaine, partie: s.partie, titre: s.titre, exigence: s.exigence, attendu: s.attendu, simule: !!s.simule, ok: v.ok, classe: classer(v.nature ? { ...s, nature: v.nature } : s, v.ok), detail: v.detail.replace(/\s+/g, ' '), ms: Math.round(performance.now() - t0) };
}

async function main(): Promise<void> {
  if (process.argv.includes('--liste')) { for (const s of TOUS) console.log(`${s.id.padEnd(34)} ${s.domaine.padEnd(13)} ${s.partie.padEnd(13)} ${s.titre}`); return; }
  const parties = liste('partie'), domaines = liste('domaine'), ids = liste('id');
  const choix = TOUS.filter((s) => (!parties || parties.includes(s.partie)) && (!domaines || domaines.includes(s.domaine)) && (!ids || ids.includes(s.id)));
  // Le piège de la référence du noyau : s'il est armé (le code de Heimdall diffère de sa référence), chaque Odin jetable
  // refuse toute action engageante avant même de demander, et les notes « Décisions » et « Sécurité » seraient fausses.
  {
    const { verifierNoyau } = await import('../../src/heimdall/noyau.ts');
    const v = verifierNoyau() as { reference: boolean; ecarts: Array<{ fichier: string; etat: string }> };
    if (v.ecarts.length && !process.argv.includes('--malgre-noyau')) {
      console.log(`ARRÊT : le noyau d'Odin diffère de sa référence (${v.ecarts.map((e) => `${e.fichier} ${e.etat}`).join(', ')}).
Les notes « Décisions » et « Sécurité » seraient fausses. Refaire la référence (ou --malgre-noyau pour jouer quand même, notes à ne pas croire).`);
      return;
    }
  }
  const dossier = arg('sortie') ?? process.env.ODIN_CONTROLE_DIR ?? join(process.env.ODIN_HOME ?? join(homedir(), '.odin'), 'controle');
  // Les erreurs qui s'échappent d'un scénario (minuterie d'une appli…) ne doivent pas arrêter le contrôle.
  process.on('uncaughtException', (e) => console.error(`  (erreur hors scénario : ${(e as Error).message})`));
  process.on('unhandledRejection', (e) => console.error(`  (rejet hors scénario : ${String((e as Error)?.message ?? e)})`));
  const debut = new Date(), t0 = performance.now();
  const res: Resultat[] = [];
  // Les journaux des applis (console.log/error) sont mis de côté pendant un scénario : seul le verdict s'affiche.
  const log = console.log, err = console.error, warn = console.warn;
  for (const s of choix) {
    console.log = () => {}; console.error = () => {}; console.warn = () => {};
    const r = await jouerUn(s);
    console.log = log; console.error = err; console.warn = warn;
    res.push(r);
    const sym: Record<Classe, string> = { reussi: '✓ ', defaut: '✗ ', 'pas-code': '… ', discutable: '? ', ignore: '⏭ ' };
    log(`${sym[r.classe]} ${r.id.padEnd(34)} ${(r.ms / 1000).toFixed(1).padStart(5)} s  ${r.detail.slice(0, 150)}`);
  }
  await fermerModeleLocal().catch(() => undefined);
  // Notes par domaine : réussis / joués (les ignorés à part, les simulés comptés et signalés).
  const doms = [...new Set(res.map((r) => r.domaine))];
  const notes = doms.map((d) => {
    const x = res.filter((r) => r.domaine === d), joues = x.filter((r) => r.ok !== 'ignore');
    const n = (c: Classe) => x.filter((r) => r.classe === c).length;
    const reussis = n('reussi'), defauts = n('defaut'), pasCode = n('pas-code'), discutables = n('discutable');
    // La note ne compte que les scénarios qui mesurent ce qu'ils disent ET dont la fonction existe : réussis / (réussis + défauts).
    const base = reussis + defauts;
    return { domaine: d, reussis, defauts, pasCode, discutables, joues: joues.length, ignores: x.length - joues.length, simules: x.filter((r) => r.simule).length, note: base ? Math.round(reussis / base * 100) : null };
  });
  const parPartie = (p: string) => { const j = res.filter((r) => r.partie === p && r.ok !== 'ignore'); return { reussis: j.filter((r) => r.ok === true).length, joues: j.length, ignores: res.filter((r) => r.partie === p && r.ok === 'ignore').length }; };
  let version = '?'; try { version = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version; } catch { /* rien */ }
  const bilan = { date: debut.toISOString(), version, secondes: Math.round((performance.now() - t0) / 1000), scenarios: res.length, sansModele: parPartie('sans-modele'), modeleLocal: parPartie('modele-local'), modele: process.env.METIS_GGUF ? `Métis (${process.env.METIS_GGUF})` : process.env.SOUL_HOME ? 'Soul (local)' : 'aucun', reseauTentatives: reseau.tentatives, notes };
  log('\nNotes par domaine :');
  for (const n of notes) log(`  ${n.domaine.padEnd(13)} réussis ${n.reussis} · défauts ${n.defauts} · pas encore codés ${n.pasCode} · discutables ${n.discutables}${n.ignores ? ` · ignorés ${n.ignores}` : ''}${n.simules ? ` (${n.simules} simulé(s))` : ''}`);
  log(`Sans modèle : ${bilan.sansModele.reussis}/${bilan.sansModele.joues} · modèle local : ${bilan.modeleLocal.reussis}/${bilan.modeleLocal.joues} (${bilan.modeleLocal.ignores} ignoré(s)) · ${bilan.secondes} s · réseau tenté ${reseau.tentatives} fois (toujours coupé ou servi par le banc)`);
  // Garder : un fichier daté (détail) + une ligne d'historique (la courbe).
  mkdirSync(dossier, { recursive: true });
  const stamp = debut.toISOString().replace(/[:]/g, '-').slice(0, 19);
  const fichier = join(dossier, `controle-${stamp}.json`);
  writeFileSync(fichier, JSON.stringify({ ...bilan, resultats: res }, null, 1));
  const hist = join(dossier, 'historique.jsonl');
  appendFileSync(hist, JSON.stringify(bilan) + '\n');
  const md = [`# Entraînement de contrôle — ${debut.toLocaleString('fr-FR')}`, '', `Odin ${version} · ${res.length} scénarios · ${bilan.secondes} s · modèle : ${bilan.modele}`, '',
    'Réussis / (réussis + défauts) ne compte ni les fonctions pas encore codées, ni les scénarios discutables (montrés à part).', '',
    '| Domaine | Réussis | Défauts réels | Pas encore codés | Discutables | Ignorés | Simulés |', '|---|---|---|---|---|---|---|',
    ...notes.map((n) => `| ${n.domaine} | ${n.reussis} | ${n.defauts} | ${n.pasCode} | ${n.discutables} | ${n.ignores} | ${n.simules} |`),
    '', '## Détail', '', ...res.map((r) => `- ${({ reussi: '✓ réussi', defaut: '✗ défaut', 'pas-code': '… pas encore codé', discutable: `? discutable (${r.ok ? 'passe' : 'échoue'})`, ignore: '⏭ ignoré' } as Record<Classe, string>)[r.classe]} **${r.id}** (${r.exigence}${r.simule ? ', simulé' : ''}) — ${r.titre}\n  - attendu : ${r.attendu}\n  - vu : ${r.detail}`)].join('\n');
  writeFileSync(fichier.replace(/\.json$/, '.md'), md);
  log(`Notes gardées : ${fichier} (+ .md) et ${hist}`);
}

if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/').split('/').pop() ?? '§')) { await main(); process.exit(0); }
