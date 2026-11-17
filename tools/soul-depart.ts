// Fabriquer le MODÈLE DE DÉPART de Soul (Noûs) livré avec Odin — outil du dépôt, à lancer chez TOUFATECH, jamais chez
// le propriétaire. Tout se fait dans un dossier d'Odin JETABLE (jamais ~/.odin). Aucun paquet ajouté.
//
//   node --disable-warning=ExperimentalWarning tools/soul-depart.ts corpus   <dossier-jetable> [--temoins fichier]
//       → <dossier>/corpus-livraison.jsonl + corpus-bilan.json (rien que ce qu'Odin est ; témoins contrôlés)
//   node --disable-warning=ExperimentalWarning tools/soul-depart.ts entrainer <dossier-jetable> [--secondes 60] [--gabarit petit|moyen] [--fils 1]
//                                                                  [--passages 20] [--patience 3]
//       → apprend le découpage et un réseau sur ce corpus en PLUSIEURS passages : mesure sur le banc public (bits par
//         octet) après chaque passage, point de reprise écrit seulement s'il fait mieux (le meilleur est gardé), arrêt
//         après --patience passages sans progrès, --passages au plus, ou le temps donné ; dans <dossier>/odin
//   node --disable-warning=ExperimentalWarning tools/soul-depart.ts exporter  <dossier-jetable> [--version 1] [--sortie modeles/soul-depart] [--temoins fichier] [--epingler]
//       → le modèle (poids en float16, découpage, manifeste, licence) — refusé si un témoin ressort. L'épingle du PRODUIT
//         (src/brain/nous/modele-depart-epingle.json) n'est écrite qu'avec --epingler ; sinon elle va à côté du modèle
//         (<sortie>/epingle.json) et le produit n'est pas touché
//   node --disable-warning=ExperimentalWarning tools/soul-depart.ts verifier [dossier]
//       → vérifie les empreintes et la lecture du modèle livré (ou dit qu'aucun n'est livré)
//
// Le fichier de témoins : une phrase par ligne (un nom, un appareil, un site absorbé, une phrase de note…). Le banc
// d'entraînement peut aussi appeler directement les fonctions de src/brain/nous/livraison.ts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [, , commande, cible, ...reste] = process.argv;
const option = (nom: string, defaut?: string): string | undefined => { const i = reste.indexOf(`--${nom}`); return i >= 0 ? reste[i + 1] : defaut; };
const dire = (s: string) => console.log(s);
const temoinsDe = (f?: string): string[] => (f ? readFileSync(f, 'utf8').split(/\r?\n/).map((x) => x.trim()).filter(Boolean) : []);

async function corpus(dossier: string): Promise<void> {
  const L = await import('../src/brain/nous/livraison.ts');
  const { allModules } = await import('../src/valhalla/odin.ts');
  const { LINKS, USAGES } = await import('../src/valhalla/links.ts');
  const { SURVOL } = await import('../src/valhalla/survol.ts');
  mkdirSync(dossier, { recursive: true });
  const home = join(dossier, 'odin');
  // Les définitions RÉELLES des applis, lues sur un faux Odin vide (dossier jetable) : aucune donnée de qui que ce soit.
  const mods = allModules({ paths: { home, workspace: join(home, 'espace'), logs: join(home, 'journaux') }, cfg: {} } as never);
  const sources = L.sourcesLivraison({
    modules: mods.map((m) => ({ id: m.id, name: m.name, what: m.what, does: m.does, words: m.words, actions: m.actions.map((a) => ({ id: a.id, label: a.label, what: a.what, words: a.words, read: a.read })) })),
    liens: LINKS, usages: USAGES, survol: SURVOL,
  }, racine);
  const c = L.corpusLivraison(sources);
  const trouves = L.temoinsTrouves(c.exemples.map((e) => e.texte), temoinsDe(option('temoins')));
  writeFileSync(join(dossier, 'corpus-livraison.jsonl'), c.exemples.map((e) => JSON.stringify(e)).join('\n'));
  writeFileSync(join(dossier, 'corpus-bilan.json'), JSON.stringify({ ...c.bilan, temoinsTrouves: trouves.length }, null, 1));
  dire(`corpus de livraison : ${c.bilan.exemples} exemples (${c.bilan.textes} textes, ${c.bilan.paires} paires), ${c.bilan.octets} octets, empreinte ${c.bilan.empreinte.slice(0, 16)}…`);
  dire(`sources : ${JSON.stringify(c.bilan.sources)} ; demandes non résolues : ${c.bilan.nonResolues.length}`);
  if (trouves.length) { dire(`REFUSÉ : ${trouves.length} témoin(s) dans le corpus`); process.exitCode = 2; }
}

function lireCorpus(dossier: string) {
  const exemples = readFileSync(join(dossier, 'corpus-livraison.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { texte: string; sorte: 'note' | 'echange' | 'lecture' | 'maitre' | 'correction' });
  const bilan = JSON.parse(readFileSync(join(dossier, 'corpus-bilan.json'), 'utf8'));
  return { exemples, bilan };
}

async function entrainer(dossier: string): Promise<void> {
  const L = await import('../src/brain/nous/livraison.ts');
  const { decoupageDe } = await import('../src/brain/nous/preparation.ts');
  const { gabarit, nouvelEntraineur } = await import('../src/brain/nous/moteur.ts');
  const { lireDecoupageSerialise } = await import('../src/brain/nous/decoupage.ts');
  const c = lireCorpus(dossier);
  const home = join(dossier, 'odin'); mkdirSync(home, { recursive: true });
  const secondes = Number(option('secondes', '60')), fils = Number(option('fils', '1'));
  const passages = Number(option('passages', '20')), patience = Number(option('patience', '3'));
  const nomGabarit = option('gabarit', 'moyen');
  if (nomGabarit !== 'petit' && nomGabarit !== 'moyen') { dire('gabarit : petit ou moyen'); process.exitCode = 1; return; }
  if (!(passages >= 1) || !(patience >= 1) || !(secondes > 0)) { dire('--passages, --patience et --secondes : des nombres positifs'); process.exitCode = 1; return; }
  const hyper = gabarit(nomGabarit);
  const dec = decoupageDe(c.exemples.map((e) => e.texte), hyper.vocab, 0x0d1a);
  const { prochainNumero } = await import('../src/brain/nous/reprise.ts');
  const banc = L.bancPublic(c.exemples);
  const e = await nouvelEntraineur(hyper, lireDecoupageSerialise(dec), 0x0d1a, home);
  const ac = new AbortController(); process.once('SIGINT', () => { dire('arrêt demandé : je garde le meilleur point déjà écrit'); ac.abort(); });
  try {
    const r = await L.entrainerPassages({
      e, exemples: c.exemples, dec, banc, dureeMs: secondes * 1000, fils, maxPassages: passages, patience, signal: ac.signal, premier: prochainNumero(home),
      surPassage: (p) => dire(`passage ${p.passage} : ${p.pas} pas, perte ${p.perte.toFixed(3)}, banc public ${p.bitsParOctet.toFixed(4)} bit/octet${p.garde ? ' — meilleur, gardé' : ''} (${p.secondes} s)`),
    });
    L.ecrireProvenance(home, c.bilan.empreinte); // ce point vient de CE corpus (vérifié par l'export)
    const pourquoi = { passages: `${passages} passage(s) faits`, temps: 'temps écoulé', 'sans-progres': `${patience} passage(s) sans progrès`, interrompu: 'interrompu' }[r.arret];
    dire(`fini (${pourquoi}) : banc public ${r.depart.toFixed(4)} → ${r.meilleur.toFixed(4)} bit/octet ; le meilleur point est le dernier écrit dans ${home} (${r.points} point(s) écrit(s))`);
  } finally { await e.arreter(); }
}

async function exporter(dossier: string): Promise<void> {
  const L = await import('../src/brain/nous/livraison.ts');
  const c = lireCorpus(dossier);
  const sortie = resolve(option('sortie', join(racine, 'modeles', 'soul-depart'))!);
  const epingler = reste.includes('--epingler');
  const r = await L.exporterModeleDepart({ home: join(dossier, 'odin'), sortie, corpus: c, temoins: temoinsDe(option('temoins')), version: Number(option('version', '1')), licence: join(racine, 'LICENSE'), epinglerProduit: epingler });
  if (!r.ok) { dire(r.raison); process.exitCode = 2; return; }
  dire(`exporté dans ${sortie} : v${r.manifeste.version}, ${r.manifeste.poids.nombre} poids (float16), banc public ${r.manifeste.mesures.bancPublic.bitsParOctet} bit/octet`);
  dire(epingler ? `épingle du PRODUIT écrite : ${r.epingle} (Odin n'installera que ce modèle-là)` : `épingle écrite À CÔTÉ du modèle : ${r.epingle} (le produit n'est pas touché ; --epingler pour livrer)`);
}

async function verifier(dossier?: string): Promise<void> {
  const L = await import('../src/brain/nous/livraison.ts');
  const livre = resolve(join(racine, 'modeles', 'soul-depart'));
  const d = resolve(dossier ?? livre);
  // Aucun modèle (ni dossier, ni manifeste) : un état propre, dit tel quel.
  if (!existsSync(join(d, L.FICHIERS.manifeste))) {
    if (d === livre) dire(`aucun modèle de départ livré avec cette version (${L.lireEpingle() ? 'une épingle existe mais pas de modèle' : 'ni modèle, ni épingle'}) : Odin partira d'un réseau neuf`);
    else { dire(`aucun modèle de départ dans ${d}`); process.exitCode = 2; }
    return;
  }
  // Un modèle exporté pour essai porte son épingle à côté ; le modèle livré est vérifié contre l'épingle du produit.
  const aCote = join(d, L.EPINGLE_A_COTE), parACote = d !== livre && existsSync(aCote);
  if (parACote) dire(`(vérifié contre l'épingle à côté du modèle, ${aCote}, pas contre celle du produit)`);
  const r = L.lireModeleDepart(d, parACote ? { epingle: aCote } : {});
  if (!r.ok) { dire(`REFUSÉ : ${r.raison}`); process.exitCode = 2; return; }
  dire(`modèle de départ v${r.modele.manifeste.version} lisible, empreintes justes : ${r.modele.poids.length} poids, corpus ${r.modele.manifeste.corpus.exemples} exemples, banc public ${r.modele.manifeste.mesures.bancPublic.bitsParOctet} bit/octet`);
}

if (!commande || !['corpus', 'entrainer', 'exporter', 'verifier'].includes(commande)) {
  dire('usage : tools/soul-depart.ts corpus|entrainer|exporter <dossier-jetable> [options] | verifier [dossier]');
  process.exitCode = 1;
} else if (commande !== 'verifier' && (!cible || resolve(cible).toLowerCase().includes(`${join('', '.odin')}`.toLowerCase()))) {
  dire('donne un dossier JETABLE (jamais le dossier d\'Odin du propriétaire)'); process.exitCode = 1;
} else if (commande === 'corpus') await corpus(resolve(cible!));
else if (commande === 'entrainer') await entrainer(resolve(cible!));
else if (commande === 'exporter') { if (!existsSync(join(resolve(cible!), 'corpus-livraison.jsonl'))) { dire('lance d\'abord « corpus » dans ce dossier'); process.exitCode = 1; } else await exporter(resolve(cible!)); }
else await verifier(cible);
