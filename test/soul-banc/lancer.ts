// Banc de Soul : la COMMANDE de mesure. Elle prend un ou plusieurs jeux et une ou plusieurs méthodes, et écrit dans
// le dossier de sortie un rapport JSON complet et un tableau lisible (Markdown) par jeu et par méthode.
//
//   node --disable-warning=ExperimentalWarning test/soul-banc/lancer.ts \
//        --jeu test/soul-banc/jeux/developpement.json [--jeu test/soul-banc/jeux/principal.json] \
//        --methodes mots,logos[,aiguilleur] --sortie <dossier> [--fuites] [--sans-fuites] [--fige <nom de jeu>] [--seuil 0.8]
//
// Jeu FIGÉ (« principal » : nom de fichier qui commence par « principal », champ "fige": true, ou --fige <nom>) :
// aucune phrase n'est écrite nulle part (ni demandes ratées, ni phrases des fuites) ; seulement des comptes par appli,
// par langue, par écriture et par sorte. Jeu de développement : la liste des demandes ratées est écrite en plus.
//
// Tout se passe dans un dossier d'Odin jetable (jamais le vrai dossier du propriétaire) ; rien n'est lancé sur la
// machine (les commandes des applis sont notées, le réseau est coupé). La charge de la machine pendant la mesure est
// notée à côté des temps.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { dossierJetable, environnementBanc, existe, lireCatalogue, couverture, modulesDuProduit } from './catalogue.ts';
import { contexteDe, defautsDuJeu, juste, rapport, type Contexte, type Jeu, type Proportion, type Rapport, type Releve, type Reponse, type Resultat } from './mesure.ts';

const args = process.argv.slice(2);
const tous = (nom: string) => args.flatMap((a, i) => (a === `--${nom}` && args[i + 1] ? [args[i + 1]] : []));
const un = (nom: string, defaut?: string) => tous(nom)[0] ?? defaut;
const drapeau = (nom: string) => args.includes(`--${nom}`);

// ------------------------------------------------------------------------------------------------ mise en forme
/** Pourcentage tronqué (jamais arrondi vers le haut), une décimale. */
const pc = (x: number) => `${(Math.floor(x * 1000) / 10).toFixed(1).replace('.', ',')} %`;
/** k/n = p [bas ; haut] — borne basse tronquée vers le bas, borne haute arrondie vers le haut (intervalle jamais rétréci). */
export const prop = (p: Proportion) => (p.n ? `${p.k}/${p.n} = ${pc(p.p)} [${pc(p.bas)} ; ${(Math.ceil(p.haut * 1000) / 10).toFixed(1).replace('.', ',')} %]` : '—');
const ligne = (nom: string, r: Releve) => `| ${nom} | ${r.n} | ${prop(r.appli1)} | ${prop(r.appli3)} | ${prop(r.action1)} | ${prop(r.action3)} |`;
const tableau = (titre: string, groupes: Record<string, Releve>) => [
  `### ${titre}`, '', '| groupe | n | appli, 1er rang | appli, 3 premiers | appli + action, 1er rang | appli + action, 3 premiers |', '|---|---:|---|---|---|---|',
  ...Object.entries(groupes).map(([k, r]) => ligne(k, r)), '',
];

export function markdown(jeu: string, methode: string, r: Rapport, extra: { charge: string; fige: boolean; absentes?: string[] }): string {
  const rc = r.risqueCouverture, pts = rc.length <= 12 ? rc : [...new Set([0, 1, 2, 3, 5, 8, 12, 18, 25, 35, 50, 70, 100].map((q) => Math.min(rc.length - 1, Math.floor((q / 100) * (rc.length - 1)))))].map((i) => rc[i]);
  const L = r.langues, R = r.relances;
  return [
    `# Banc de Soul : ${methode} sur ${jeu}`, '',
    `Jeu ${extra.fige ? 'FIGÉ (aucune phrase écrite ici)' : 'de développement'} ; ${r.global.n} demandes. Intervalles de Wilson à 95 %. Pourcentages tronqués, borne haute arrondie vers le haut.`, '',
    '## En tête', '',
    `- Dans le champ d'Odin, appli au 1er rang : ${prop(r.dansLeChamp.appli1)} ; appli + action : ${prop(r.dansLeChamp.action1)}.`,
    `- Les mêmes sans « aussi » : appli ${prop(r.dansLeChampStrict.appli1)} ; appli + action ${prop(r.dansLeChampStrict.action1)}.`,
    `- Les mêmes sans les ${r.fuites} demandes déjà apprises ou présentes dans un autre jeu : appli ${prop(r.sansFuites.appli1)} ; appli + action ${prop(r.sansFuites.action1)}.`,
    `- Moyenne des ${L.langues} langues (dans le champ, appli au 1er rang, chaque langue pèse autant) : ${pc(L.moyenne)} ; la pire : ${L.pire ? `${L.pire.langue} ${pc(L.pire.p)} sur ${L.pire.n}` : '—'} ; français ${prop(L.francais)} ; autres langues ${prop(L.autres)}.`,
    `- Justesse hors du champ, forcée à répondre (premier choix « pas encore », qu'elle passe la main ou non) : ${prop(r.horsChampForce)}.`,
    r.decisionInerte
      ? `- Décision : la méthode n'agit jamais seule (0 « seul ») : la couche de décision ne sert à rien tant que son seuil « seul » n'est pas atteint, et « agit seule hors champ » ne dit rien de sa sûreté.`
      : `- Décision : agit seule ${r.decisions.seul} fois, juste ${prop(r.decisions.justesSeul)}.`,
    `- Relances (${R.n}) : avec le contexte du jeu ${prop(R.avecContexte)} ; sans l'appli active ${prop(R.sansAppliActive)} ; l'appli active du jeu est la réponse attendue dans ${R.appliActiveEstLaReponse} relance(s)${R.appliActiveEstLaReponse ? ' : là, le premier chiffre ne mesure pas la compréhension' : ''}.`, '',
    '## Ensemble', '', '| groupe | n | appli, 1er rang | appli, 3 premiers | appli + action, 1er rang | appli + action, 3 premiers |', '|---|---:|---|---|---|---|',
    ligne('dans le champ d\'Odin', r.dansLeChamp), ligne('dans le champ, sans « aussi »', r.dansLeChampStrict), ligne('dans le champ, sans fuites', r.sansFuites),
    ligne('toutes les demandes (hors champ : passer la main compte juste)', r.global), '',
    ...tableau('Par sorte', r.parSorte), ...tableau('Par langue', r.parLangue), ...tableau('Par écriture', r.parEcriture),
    '## Décisions', '',
    `- agit seule : ${r.decisions.seul} demandes, justes (appli + action) : ${prop(r.decisions.justesSeul)}`,
    `- propose trois choix : ${r.decisions.trois} demandes, le bon dans les trois : ${prop(r.decisions.dansTrois)}`,
    `- passe la main : ${r.decisions.main} demandes`, '',
    '## Hors du champ d\'Odin', '',
    `- ${r.horsChamp.n} demandes ; agit seule sur une appli : ${prop(r.horsChamp.agitSeule)} ; propose une appli : ${prop(r.horsChamp.proposeAppli)}`, '',
    '## Risque-couverture (1er rang, appli + action)', '',
    `Aire sous la courbe : ${r.aireRC.toFixed(4)}. Couverture au plus 10 % d'erreurs : ${pc(r.couverture90.couverture)} (seuil ${r.couverture90.seuil ?? '—'}) ; au plus 5 % : ${pc(r.couverture95.couverture)} (seuil ${r.couverture95.seuil ?? '—'}).`, '',
    '| seuil de confiance | répond | couverture | erreurs | risque |', '|---:|---:|---:|---:|---:|',
    ...pts.map((p) => `| ${p.seuil.toFixed(4)} | ${p.repond} | ${pc(p.couverture)} | ${p.erreurs} | ${pc(p.risque)} |`), '',
    '## Calibration (1er rang, appli + action)', '',
    `Écart attendu (ECE, 10 cases) : ${r.calibration.ece.toFixed(4)} ; écart maximal : ${r.calibration.mce.toFixed(4)}.`, '',
    '| confiance | n | confiance moyenne | justesse |', '|---|---:|---:|---:|',
    ...r.calibration.cases.filter((c) => c.n).map((c) => `| ${c.de.toFixed(1)}–${c.a.toFixed(1)} | ${c.n} | ${c.confiance.toFixed(3)} | ${c.justesse.toFixed(3)} |`), '',
    '## Temps par demande', '',
    `Médiane ${r.temps.mediane.toFixed(2)} ms ; 95e centile ${r.temps.p95.toFixed(2)} ms ; maximum ${r.temps.max.toFixed(2)} ms. Charge de la machine pendant la mesure : ${extra.charge}.`, '',
    ...tableau('Par appli (toutes les applis du catalogue)', r.parAppli),
  ].join('\n');
}

// ------------------------------------------------------------------------------------------------ charge de la machine
function instantCpu() { return cpus().map((c) => ({ occ: c.times.user + c.times.nice + c.times.sys + c.times.irq, tot: c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle })); }
function charge(avant: ReturnType<typeof instantCpu>, apres: ReturnType<typeof instantCpu>): string {
  let occ = 0, tot = 0; apres.forEach((c, i) => { occ += c.occ - (avant[i]?.occ ?? 0); tot += c.tot - (avant[i]?.tot ?? 0); });
  return `${tot ? Math.round((100 * occ) / tot) : 0} % des ${apres.length} cœurs occupés (ce banc compris)`;
}

// ------------------------------------------------------------------------------------------------ principal
async function principal(): Promise<void> {
  const jeux = tous('jeu'), noms = (un('methodes', 'mots') ?? 'mots').split(',').map((x) => x.trim()).filter(Boolean), sortie = un('sortie');
  if (!jeux.length || !sortie) { console.error('usage : lancer.ts --jeu <fichier.json> [--jeu …] --methodes mots,logos,aiguilleur --sortie <dossier> [--fuites] [--sans-fuites] [--fige <nom>]'); process.exitCode = 2; return; }
  const figesDemandes = new Set(tous('fige'));
  const { home, fin } = dossierJetable();
  environnementBanc(home);
  mkdirSync(sortie, { recursive: true });
  try {
    const mods = await modulesDuProduit(home);
    const cat = await lireCatalogue(home);
    const cov = await couverture(cat);
    writeFileSync(resolve(sortie, 'catalogue.json'), JSON.stringify({ applis: cat.applis.length, actions: cat.actions, couverture: cov, liste: cat.applis.map((a) => ({ id: a.id, nom: a.name, actions: a.actions.map((x) => x.id) })) }, null, 1));
    console.log(`catalogue : ${cat.applis.length} applis, ${cat.actions} actions ; actions avec des mots : ${cov.avecMots} ; couples appris par les mots : ${cov.parMots}, + exemples : ${cov.plusExemples}, + v2 : ${cov.plusV2}`);

    const lus = jeux.map((f) => {
      const j = JSON.parse(readFileSync(f, 'utf8')) as Jeu;
      const nom = basename(f).replace(/\.json$/i, '');
      const fige = j.fige === true || nom.startsWith('principal') || figesDemandes.has(nom);
      // La forme est contrôlée sur le jeu tel qu'il est écrit (un contexte d'une autre forme serait sinon ignoré en silence).
      const defautsForme = defautsDuJeu(j);
      // Une action absente vaut null (format convenu) ; un contexte en texte est le tour précédent (le jeu n'est pas réécrit).
      j.demandes = (j.demandes ?? []).map((d) => ({ ...d, action: d.action ?? null, appli: d.appli === 'aucune' ? null : d.appli ?? null, contexte: contexteDe(d.contexte) }));
      return { f, nom, j, fige, defautsForme };
    });

    for (const x of lus) {
      const aussiInconnu = (a: string) => { const i = a.indexOf('.'); const e = existe(cat, i > 0 ? a.slice(0, i) : a, i > 0 ? a.slice(i + 1) : null); return !e.appli || !e.action; };
      const defauts = [...x.defautsForme, ...x.j.demandes.flatMap((d) => { const e = existe(cat, d.appli, d.action); return [...(e.appli ? [] : [`${d.id} : appli inconnue « ${d.appli} »`]), ...(e.action ? [] : [`${d.id} : action inconnue « ${d.appli}.${d.action} »`]), ...(d.aussi ?? []).filter(aussiInconnu).map((a) => `${d.id} : « aussi » inconnu « ${a} »`)]; })];
      writeFileSync(resolve(sortie, `defauts-${x.nom}.json`), JSON.stringify(defauts, null, 1));
      console.log(`${x.nom} : ${x.j.demandes.length} demandes, ${defauts.length} défaut(s) de forme ou d'identifiant${x.fige ? ' (jeu figé)' : ''}`);
    }

    // Fuites (relecture M1) : calculées à chaque mesure (sauf --sans-fuites). Les demandes qui ressemblent à ce que les
    // méthodes ont appris, ou à une demande d'un autre jeu, sont comptées à part (« sans fuites ») ; une demande d'un jeu
    // de développement qui ressemble à une demande d'un jeu figé n'a jamais sa phrase écrite. Les fichiers détaillés ne
    // sont écrits qu'avec --fuites.
    const fuitesDe = new Map<string, Set<string>>(), versFige = new Map<string, Set<string>>();
    if (!drapeau('sans-fuites')) {
      const F = await import('./fuites.ts');
      const seuil = Number(un('seuil', '0.8'));
      const t0 = performance.now();
      const { sources, parFamille } = await F.sourcesApprentissage(mods);
      const index = new F.Index(sources);
      const bilan: Record<string, unknown> = { seuil, sources: index.taille, parFamille, jeux: {} as Record<string, unknown> };
      const masquer = (fige: boolean, l: ReturnType<typeof F.fuitesContre>) => (fige ? l.map(({ phrase: _p, texteSource: _t, ...r }) => r) : l);
      for (const x of lus) {
        const contre = F.fuitesContre(x.j.demandes, index, seuil), internes = F.doublonsInternes(x.j.demandes, seuil);
        const autres = lus.filter((y) => y !== x).map((y) => ({ jeu: y.nom, fuites: F.fuitesContre(x.j.demandes, new F.Index(y.j.demandes.map((d) => ({ texte: d.phrase, source: `${y.nom}#${d.id}` }))), seuil) }));
        fuitesDe.set(x.nom, new Set([...contre.map((f) => f.id), ...autres.flatMap((a) => a.fuites.map((f) => f.id))]));
        versFige.set(x.nom, new Set(autres.filter((a) => lus.find((y) => y.nom === a.jeu)?.fige).flatMap((a) => a.fuites.map((f) => f.id))));
        if (!drapeau('fuites')) continue;
        (bilan.jeux as Record<string, unknown>)[x.nom] = {
          demandes: x.j.demandes.length, contreApprentissage: F.resume(contre), internes: F.resume(internes), entreJeux: autres.map((a) => ({ jeu: a.jeu, ...F.resume(a.fuites) })),
          parSource: contre.reduce<Record<string, number>>((o, f) => { const k = f.source.replace(/ \(.*$/, ''); o[k] = (o[k] ?? 0) + 1; return o; }, {}),
        };
        writeFileSync(resolve(sortie, `fuites-${x.nom}.json`), JSON.stringify({ jeu: x.nom, fige: x.fige, seuil, contreApprentissage: masquer(x.fige, contre), internes: masquer(x.fige, internes), entreJeux: autres.map((a) => ({ jeu: a.jeu, fuites: masquer(x.fige || lus.find((y) => y.nom === a.jeu)!.fige, a.fuites) })) }, null, 1));
        console.log(`fuites ${x.nom} : contre l'apprentissage ${JSON.stringify(F.resume(contre))} ; internes ${JSON.stringify(F.resume(internes))} ; ${autres.map((a) => `contre ${a.jeu} ${JSON.stringify(F.resume(a.fuites))}`).join(' ; ')}`);
      }
      bilan.ms = Math.round(performance.now() - t0);
      if (drapeau('fuites')) writeFileSync(resolve(sortie, 'fuites-bilan.json'), JSON.stringify(bilan, null, 1));
      console.log(`fuites comptées à part : ${lus.map((x) => `${x.nom} ${fuitesDe.get(x.nom)?.size ?? 0}`).join(', ')} (${bilan.ms} ms)`);
    }

    const { monde, methodes } = await import('./methodes.ts');
    const m = await monde(home, cat);
    try {
      const { pretes, absentes } = await methodes(noms, m);
      for (const a of absentes) console.log(`méthode absente : ${a.nom} (${a.raison})`);
      writeFileSync(resolve(sortie, 'methodes-absentes.json'), JSON.stringify(absentes, null, 1));
      for (const meth of pretes) for (const x of lus) {
        const rs: Resultat[] = [];
        const c0 = instantCpu(), t0 = performance.now();
        const jouer = async (phrase: string, contexte?: Contexte): Promise<Reponse> => {
          try { return await meth.repondre(phrase, contexte); } catch (e) { return { choix: [], decision: 'main' as const, confiance: 0, erreur: String((e as Error)?.message ?? e).slice(0, 200) } as Reponse; }
        };
        for (const d of x.j.demandes) {
          const t = performance.now();
          const reponse = await jouer(d.phrase, d.contexte);
          const ms = performance.now() - t;
          // Relance : rejouée avec le seul tour précédent (sans appli active ni action précédente), hors du temps mesuré.
          let reponseSansAppli: Reponse | undefined;
          if (d.sorte === 'relance') reponseSansAppli = d.contexte?.appli || d.contexte?.actionPrecedente ? await jouer(d.phrase, contexteDe(d.contexte?.precedent)) : reponse;
          rs.push({ demande: d, reponse, ms, ...(reponseSansAppli ? { reponseSansAppli } : {}) });
        }
        const total = performance.now() - t0, ch = charge(c0, instantCpu());
        const r = rapport(rs, cat.applis.map((a) => a.id), { fuites: fuitesDe.get(x.nom) });
        const nomF = `${x.nom}-${meth.nom}`;
        writeFileSync(resolve(sortie, `rapport-${nomF}.json`), JSON.stringify({ jeu: x.nom, version: x.j.version, origine: x.j.origine, fige: x.fige, methode: meth.nom, description: meth.description, quand: new Date().toISOString(), msTotal: Math.round(total), charge: ch, ...r }, null, 1));
        writeFileSync(resolve(sortie, `tableau-${nomF}.md`), markdown(x.nom, meth.nom, r, { charge: ch, fige: x.fige }));
        if (!x.fige) {
          const cachees = versFige.get(x.nom) ?? new Set<string>();
          const ratees = rs.filter((y) => !juste(y.demande, y.reponse, 'action', 1)).map((y) => ({
            id: y.demande.id, langue: y.demande.langue, sorte: y.demande.sorte, phrase: cachees.has(y.demande.id) ? '(cachée : ressemble à une demande d\'un jeu figé)' : y.demande.phrase, attendu: `${y.demande.appli ?? 'pas encore'}${y.demande.action ? `.${y.demande.action}` : ''}`,
            appliJuste: juste(y.demande, y.reponse, 'appli', 1), dansTrois: juste(y.demande, y.reponse, 'action', 3),
            obtenu: y.reponse.choix.slice(0, 3).map((c) => `${c.appli ?? 'pas encore'}${c.action ? `.${c.action}` : ''}`), decision: y.reponse.decision, confiance: y.reponse.confiance,
          }));
          writeFileSync(resolve(sortie, `ratees-${nomF}.json`), JSON.stringify(ratees, null, 1));
        }
        console.log(`${meth.nom} sur ${x.nom} : DANS LE CHAMP appli 1er rang ${fmt(r.dansLeChamp.appli1)} ; appli+action ${fmt(r.dansLeChamp.action1)} ; sans fuites ${fmt(r.sansFuites.appli1)} ; moyenne des langues ${pc(r.langues.moyenne)} ; hors champ forcé ${fmt(r.horsChampForce)} ; relances avec contexte ${fmt(r.relances.avecContexte)}, sans appli active ${fmt(r.relances.sansAppliActive)} ; décision ${r.decisionInerte ? "inerte (jamais seule)" : `seule ${r.decisions.seul}`} ; temps médian ${r.temps.mediane.toFixed(2)} ms, p95 ${r.temps.p95.toFixed(2)} ms ; ${ch}`);
      }
    } finally { m.fin(); }
  } finally { fin(); }
}
const fmt = prop;

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await principal();
  // Des applis gardent des minuteries : le banc s'arrête quand il a fini.
  process.exit(process.exitCode ?? 0);
}
