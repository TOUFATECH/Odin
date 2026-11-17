// Le MODÈLE DE DÉPART de Soul (Noûs) livré avec Odin, version 1 — banc de mesure autour des outils du PRODUIT
// (`tools/soul-depart.ts` corpus / exporter / verifier ; `src/brain/nous/livraison.ts`). Dossiers JETABLES seulement.
//
//   node --disable-warning=ExperimentalWarning test/entrainement/soul-livraison.ts temoins <dossier> <fichier-temoins>
//       → prouve que le mode « livraison » ignore des notes et souvenirs semés (témoins inventés) dans un Odin jetable
//   … soul-livraison.ts entrainer <dossier> --minutes 40 --fils 4 [--essai]
//       → mesure AVANT, puis des séances successives du moteur du produit (une séance = un passage sur les données),
//         banc public mesuré après chaque passage, point de reprise écrit seulement quand c'est mieux ; mesure APRÈS.
//         --essai : une seule courte séance (2 min) pour regarder la courbe.
//   … soul-livraison.ts installer <dossier-odin-neuf> [<fichier-temoins>]
//       → installe le modèle livré (modeles/soul-depart) dans un Odin jetable neuf, recharge, recherche par le sens,
//         propositions, et cherche les témoins dans ce qui ressort.
//
// La séance du produit (`tools/soul-depart.ts entrainer`) ne fait qu'UN passage sur les données : pour 30 à 60 min de
// calcul, ce banc enchaîne des passages avec les mêmes fonctions du produit (nouvelEntraineur, seance, perteSur, ecrire).

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

process.env.ODIN_ESSAI = '1';
const [, , cmd, cible, arg2] = process.argv;
const opt = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
if (!cible || /[\\/]\.odin([\\/]|$)/i.test(resolve(cible))) { console.log('donne un dossier JETABLE'); process.exit(1); }
const DOS = resolve(cible);
process.env.ODIN_CLE_DIR = join(DOS, 'cles');

const L = await import('../../src/brain/nous/livraison.ts');
const { decoupageDe } = await import('../../src/brain/nous/preparation.ts');
const moteur = await import('../../src/brain/nous/moteur.ts');
const { lireDecoupageSerialise, SPECIAUX } = await import('../../src/brain/nous/decoupage.ts');
const { TENUES } = await import('./demandes-langues.ts');
type Ex = { texte: string; sorte: 'note' | 'echange' | 'lecture' | 'maitre' | 'correction' };

const lireCorpus = () => readFileSync(join(DOS, 'corpus-livraison.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Ex);
const journal = (o: Record<string, unknown>) => appendFileSync(join(DOS, 'courbe-livraison.jsonl'), JSON.stringify({ quand: new Date().toISOString(), ...o }) + '\n');

/** Bits par octet du banc public, par la façade (même calcul que livraison.ts bitsParOctet). */
async function bpo(e: { perteSur(j: Int32Array[]): Promise<number> }, dec: ReturnType<typeof lireDecoupageSerialise>, textes: string[]): Promise<number> {
  let nats = 0, octets = 0;
  for (const t of textes) {
    const ids = dec.encoder(t);
    const seq = new Int32Array(ids.length + 2); seq[0] = SPECIAUX.BOS; seq.set(ids, 1); seq[seq.length - 1] = SPECIAUX.EOS;
    for (let i = 0; i < seq.length - 1; i += 128) { const c = seq.slice(i, Math.min(seq.length, i + 128)); if (c.length >= 2) nats += (await e.perteSur([c])) * (c.length - 1); }
    octets += Buffer.byteLength(t, 'utf8');
  }
  return nats / (octets * Math.LN2);
}

type Jeu = Array<{ langue: string; demande: string; module: string; action: string }>;
/** Les jeux GARDÉS À PART (jamais appris) : v1 (60, mêmes actions apprises, autres mots), v2 (autres mots des actions de v2,
 *  6 langues), inconnues (actions qu'aucune demande apprise ne vise). */
async function jeux(): Promise<Record<string, Jeu>> {
  const { TENUES_V2, INCONNUES } = await import('./demandes-v2-tenues.ts');
  return { v1: TENUES, v2: TENUES_V2, inconnues: INCONNUES };
}

/** Justesse « demande → bonne appli · action » par langue : Soul (proposer, même forme que les paires apprises :
 *  [USER] demande [ASSISTANT]) contre la recherche par mots d'aujourd'hui (appsFor). « aucune » = « pas encore » :
 *  juste pour Soul s'il le dit, pour les mots s'ils ne trouvent aucune appli. */
async function justesse(e: { proposer(d: { texte: string; maxMorceaux?: number; graine?: number }): Promise<{ texte: string; confiance: number }> }, jeu: Jeu) {
  const { appsFor } = await import('../../src/valhalla/besoin.ts');
  const { Valhalla } = await import('../../src/valhalla/service.ts');
  const { allModules } = await import('../../src/valhalla/odin.ts');
  const h = join(DOS, 'valhalla-mots'); mkdirSync(h, { recursive: true });
  const v = new Valhalla(h, allModules({ paths: { home: h, workspace: join(h, 'ws') }, cfg: {} } as never));
  const par: Record<string, { n: number; motsAppli: number; motsAction: number; soulAppli: number; soulAction: number }> = {};
  const exemples: Array<Record<string, string>> = [];
  for (const t of jeu) {
    const p = (par[t.langue] ??= { n: 0, motsAppli: 0, motsAction: 0, soulAppli: 0, soulAction: 0 }); p.n++;
    const m = appsFor(v, t.demande, 1)[0];
    if (t.module === 'aucune') { if (!m) { p.motsAppli++; p.motsAction++; } }
    else if (m?.m.id === t.module) { p.motsAppli++; if (m.action?.id === t.action) p.motsAction++; }
    const r = await e.proposer({ texte: t.demande, maxMorceaux: 32, graine: 1 });
    const ids = [...r.texte.matchAll(/\(([a-z0-9_]+)\)/g)].map((x) => x[1]);
    if (ids[0] === t.module) { p.soulAppli++; if (ids[1] === t.action) p.soulAction++; }
    if (exemples.length < 40) exemples.push({ langue: t.langue, demande: t.demande, attendu: `${t.module} · ${t.action}`, mots: m ? `${m.m.id} · ${m.action?.id ?? '?'}` : '(rien)', soul: r.texte.trim().slice(0, 70) });
  }
  const total = Object.values(par).reduce((a2, x) => ({ n: a2.n + x.n, motsAppli: a2.motsAppli + x.motsAppli, motsAction: a2.motsAction + x.motsAction, soulAppli: a2.soulAppli + x.soulAppli, soulAction: a2.soulAction + x.soulAction }), { n: 0, motsAppli: 0, motsAction: 0, soulAppli: 0, soulAction: 0 });
  return { parLangue: par, total, exemples };
}

/** Recherche par le sens : pour chaque demande française du jeu v2, la fiche d'appli la plus proche (75 fiches). */
async function sens(e: { plonger(t: string): Promise<Float32Array> }, jeu: Jeu) {
  const { allModules } = await import('../../src/valhalla/odin.ts');
  const h = join(DOS, 'valhalla-mots');
  const mods = allModules({ paths: { home: h, workspace: join(h, 'ws') }, cfg: {} } as never);
  const cos = (x: Float32Array, y: Float32Array) => { let p = 0, nx = 0, ny = 0; for (let i = 0; i < x.length; i++) { p += x[i] * y[i]; nx += x[i] ** 2; ny += y[i] ** 2; } return p / Math.sqrt(nx * ny); };
  const fiches: Array<[string, Float32Array]> = [];
  for (const m of mods) fiches.push([m.id, await e.plonger(`${m.name} : ${m.what}`)]);
  let top1 = 0, top3 = 0, n = 0;
  for (const t of jeu.filter((x) => x.langue === 'fr' && x.module !== 'aucune')) {
    n++;
    const q = await e.plonger(t.demande);
    const c = fiches.map(([id, x]) => [id, cos(q, x)] as const).sort((p1, p2) => p2[1] - p1[1]);
    if (c[0][0] === t.module) top1++;
    if (c.slice(0, 3).some((x) => x[0] === t.module)) top3++;
  }
  return { n, top1, top3, hasard: Math.round(1000 / mods.length) / 10 };
}

async function mesurer(etiquette: string, e: Parameters<typeof justesse>[0] & Parameters<typeof sens>[0] & { perteSur(j: Int32Array[]): Promise<number>; completer(a: string, n: number, o?: { graine?: number }): Promise<string> }, dec: ReturnType<typeof lireDecoupageSerialise>, banc: string[]) {
  const t0 = performance.now();
  const b = await bpo(e, dec, banc);
  const js: Record<string, Awaited<ReturnType<typeof justesse>>> = {};
  for (const [nom, jeu] of Object.entries(await jeux())) js[nom] = await justesse(e, jeu);
  const se = await sens(e, (await jeux()).v2);
  const amorces = ['L\'appli Vortex', 'Pour bloquer un site', 'Odin est', 'Sphinx'];
  const completions: Array<{ amorce: string; suite: string }> = [];
  for (const am of amorces) completions.push({ amorce: am, suite: await e.completer(am, 30, { graine: 1 }) });
  const r = { etiquette, bitsParOctetBancPublic: b, textesBanc: banc.length, justesse: js, sens: se, completions, secondes: Math.round((performance.now() - t0) / 1000) };
  writeFileSync(join(DOS, `mesures-${etiquette}.json`), JSON.stringify(r, null, 1));
  console.log(`${etiquette} : banc ${b.toFixed(3)} bit/octet ; sens (fr, 75 fiches) top 1 ${se.top1}/${se.n}, top 3 ${se.top3}/${se.n} (hasard ${se.hasard} %)`);
  for (const [nom, j] of Object.entries(js)) {
    console.log(`  [${nom}] appli : Soul ${j.total.soulAppli}/${j.total.n}, mots ${j.total.motsAppli}/${j.total.n} ; appli+action : Soul ${j.total.soulAction}, mots ${j.total.motsAction}`);
    for (const [lg, x] of Object.entries(j.parLangue)) console.log(`     ${lg} : Soul ${x.soulAppli}/${x.n} (action ${x.soulAction}) · mots ${x.motsAppli}/${x.n} (action ${x.motsAction})`);
  }
  return r;
}

/** Mesure un modèle DÉJÀ entraîné (dossier d'Odin jetable avec un point de reprise) sur les mêmes jeux et le banc
 *  public de CE dossier de corpus (chaque modèle découpe avec son propre découpage). */
async function comparer(home: string, etiquette: string): Promise<void> {
  const { lireReprise } = await import('../../src/brain/nous/reprise.ts');
  const ck = await lireReprise(home); if (!ck) { console.log('aucun point de reprise dans', home); return; }
  const banc = L.bancPublic(lireCorpus() as never, 64);
  const e = await moteur.chargerEntraineur(home);
  try { await mesurer(etiquette, e as never, ck.decoupage, banc); } finally { await e.arreter(); }
}

async function entrainer(): Promise<void> {
  const ex = lireCorpus();
  const minutes = Number(opt('minutes', '40')), fils = Number(opt('fils', '4')), essai = process.argv.includes('--essai');
  const hyper = moteur.gabarit('moyen');
  const decS = decoupageDe(ex.map((x) => x.texte), hyper.vocab, 0x0d1a), dec = lireDecoupageSerialise(decS);
  const banc = L.bancPublic(ex as never, 64);
  const home = join(DOS, 'odin'); mkdirSync(home, { recursive: true });
  const e = await moteur.nouvelEntraineur(hyper, dec, 0x0d1a, home);
  try {
    if (!existsSync(join(DOS, 'mesures-avant.json'))) await mesurer('avant', e as never, dec, banc);
    let meilleur = await bpo(e, dec, banc), n = 0, sansMieux = 0, passage = 0;
    const fin = performance.now() + (essai ? 2 : minutes) * 60_000, t0 = performance.now();
    journal({ type: 'debut', fils, minutes: essai ? 2 : minutes, bpo: meilleur, banc: banc.length });
    while (performance.now() < fin && sansMieux < 3) {
      passage++;
      const jeux = L.jeuxLivraison(ex as never, decS, { contexte: hyper.contexte, graine: 0x0d1a + passage, maxSequences: 100_000 });
      const ac = new AbortController();
      const av = await e.seance([{ entrees: jeux.entrainement, ...(jeux.roles ? { roles: jeux.roles as Int32Array[] } : {}) }], { dureeMs: Math.max(1000, fin - performance.now()), fils, signal: ac.signal, graine: 0x0d1a + passage });
      const b = await bpo(e, dec, banc);
      journal({ type: 'passage', passage, pas: av.pas, perte: av.perte, bpo: b, sequences: jeux.entrainement.length, s: Math.round((performance.now() - t0) / 1000) });
      console.log(`passage ${passage} : ${av.pas} pas, perte d'entraînement ${av.perte.toFixed(3)}, banc public ${b.toFixed(3)} bit/octet (${Math.round((performance.now() - t0) / 60000)} min)`);
      if (b < meilleur - 0.002) { meilleur = b; sansMieux = 0; await e.ecrire(n++); journal({ type: 'reprise', passage, bpo: b }); }
      else sansMieux++;
    }
    if (n === 0) await e.ecrire(n++);
    // La provenance (comme tools/soul-depart.ts entrainer) : ce point vient de CE corpus de livraison.
    L.ecrireProvenance(home, JSON.parse(readFileSync(join(DOS, 'corpus-bilan.json'), 'utf8')).empreinte);
    journal({ type: 'fin', passages: passage, meilleur, minutes: Math.round((performance.now() - t0) / 600) / 100 });
  } finally { await e.arreter(); }
  // APRÈS : le meilleur point de reprise, rechargé comme le produit le fait.
  const e2 = await moteur.chargerEntraineur(home);
  try { await mesurer(essai ? 'essai' : 'apres', e2 as never, dec, banc); } finally { await e2.arreter(); }
}

/** Le corpus de la VERSION 2 : le corpus de livraison du produit (inchangé, celui de la v1) + les demandes de
 *  src/brain/nous/demandes-v2.ts, que le produit n'importe pas encore. Même forme de paire que le produit ; « pas encore »
 *  pour ce qu'Odin ne sait pas faire. Écrit corpus-livraison.jsonl et corpus-bilan.json (empreinte calculée comme livraison.ts). */
async function corpusV2(fichierTemoins?: string): Promise<void> {
  const { createHash } = await import('node:crypto');
  const { allModules } = await import('../../src/valhalla/odin.ts');
  const { LINKS, USAGES } = await import('../../src/valhalla/links.ts');
  const { SURVOL } = await import('../../src/valhalla/survol.ts');
  const { DEMANDES_V2 } = await import('../../src/brain/nous/demandes-v2.ts');
  mkdirSync(DOS, { recursive: true });
  const h = join(DOS, 'odin-vide');
  const mods = allModules({ paths: { home: h, workspace: join(h, 'espace'), logs: join(h, 'journaux') }, cfg: {} } as never);
  const sources = L.sourcesLivraison({ modules: mods.map((m) => ({ id: m.id, name: m.name, what: m.what, does: m.does, words: m.words, actions: m.actions.map((a) => ({ id: a.id, label: a.label, what: a.what, words: a.words, read: a.read })) })), liens: LINKS, usages: USAGES, survol: SURVOL }, resolve('.'));
  const c = L.corpusLivraison(sources);
  const exemples: Ex[] = [...(c.exemples as Ex[])];
  let ajoutees = 0; const nonResolues: string[] = [];
  for (const d of DEMANDES_V2) {
    if (d.module === 'aucune') { exemples.push({ texte: `${d.demande}\nPas encore (aucune) → Odin ne sait pas encore le faire (pas_encore)`, sorte: 'echange' }); ajoutees++; continue; }
    const m = mods.find((x) => x.id === d.module), a = m?.actions.find((x) => x.id === d.action);
    if (!m || !a) { nonResolues.push(d.demande); continue; }
    exemples.push({ texte: `${d.demande}\n${m.name} (${m.id}) → ${a.label} (${a.id})`, sorte: 'echange' }); ajoutees++;
  }
  const hash = createHash('sha256'); let octets = 0;
  for (const e of exemples) { hash.update(Buffer.from(`${e.sorte}\u0000${e.texte}\u0001`, 'utf8')); octets += Buffer.byteLength(e.texte, 'utf8'); }
  const T = fichierTemoins ? readFileSync(fichierTemoins, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  const trouves = L.temoinsTrouves(exemples.map((e) => e.texte), T);
  const bilan = { ...c.bilan, exemples: exemples.length, paires: c.bilan.paires + ajoutees, octets, empreinte: hash.digest('hex'), nonResolues: [...c.bilan.nonResolues, ...nonResolues], demandesV2: ajoutees, temoinsTrouves: trouves.length };
  writeFileSync(join(DOS, 'corpus-livraison.jsonl'), exemples.map((e) => JSON.stringify(e)).join('\n'));
  writeFileSync(join(DOS, 'corpus-bilan.json'), JSON.stringify(bilan, null, 1));
  console.log(`corpus v2 : ${bilan.exemples} exemples (${bilan.textes} textes, ${bilan.paires} paires dont ${ajoutees} demandes v2), ${octets} octets, témoins trouvés ${trouves.length}, non résolues ${nonResolues.length}`);
}

async function temoins(fichier: string): Promise<void> {
  const T = ['Zéphyrine Mbalawé-Koudou', 'Kolotrapo-7741', 'le code de la porte est 4419-BX', 'rue des Flamboyants-Oubliés', 'Pistoulet le chat tigré', 'wifi-Kalandria-993'];
  writeFileSync(fichier, T.join('\n') + '\n');
  const { makeOdin } = await import('../helpers.ts');
  const { allModules } = await import('../../src/valhalla/odin.ts');
  const { LINKS, USAGES } = await import('../../src/valhalla/links.ts');
  const { SURVOL } = await import('../../src/valhalla/survol.ts');
  const o = makeOdin([{ text: 'ok' }]);
  try {
    // De fausses notes et de faux souvenirs, semés exprès dans un Odin jetable.
    for (const t of T) o.muninn.remember(`Il faut se souvenir que ${t}.`, 'owner', 'fact', '', { subject: 'proprietaire' });
    const mods = allModules(o);
    const sources = { ...L.sourcesLivraison({ modules: mods.map((m) => ({ id: m.id, name: m.name, what: m.what, does: m.does, words: m.words, actions: m.actions.map((a) => ({ id: a.id, label: a.label, what: a.what, words: a.words, read: a.read })) })), liens: LINKS, usages: USAGES, survol: SURVOL }, resolve('.')),
      notes: () => T.map((t, i) => ({ title: `Note ${i}`, body: `Note privée : ${t}.` })),
      souvenirs: () => o.muninn.listMemories(100).map((m) => ({ content: m.content, origin: m.origin })) };
    const c = L.corpusLivraison(sources as never);
    const trouves = L.temoinsTrouves(c.exemples.map((x) => x.texte), T);
    // Contre-épreuve : le corpus « odin » (celui d'un Odin chez le propriétaire) LES prend, lui.
    const { fabriquerDepart } = await import('../../src/brain/nous/corpus-depart.ts');
    const { fileBornee } = await import('../../src/brain/nous/deps.ts');
    const file = fileBornee(500_000);
    fabriquerDepart(join(DOS, 'contre-epreuve'), { cfg: { learning: { observe: true }, nous: { actif: true } }, privateMode: () => false, essai: false, file }, 'odin', sources as never);
    const contre = L.temoinsTrouves(file.prendre(500_000).map((x) => x.texte), T);
    const r = { semes: T.length, souvenirsSemes: o.muninn.listMemories(100).length, livraison: { exemples: c.bilan.exemples, temoinsTrouves: trouves }, contreEpreuveModeOdin: { temoinsTrouves: contre.length } };
    writeFileSync(join(DOS, 'preuve-temoins.json'), JSON.stringify(r, null, 1));
    console.log(JSON.stringify(r));
  } finally { o.cleanup(); }
}

async function installer(fichierTemoins?: string): Promise<void> {
  const home = join(DOS, 'odin-neuf'); mkdirSync(home, { recursive: true });
  const T = fichierTemoins ? readFileSync(fichierTemoins, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  const odin = { cfg: { nous: { actif: true } }, paths: { home } };
  const r1 = await L.installerModeleDepart(odin as never, process.env.SOUL_MODELE ? { dossier: process.env.SOUL_MODELE } : {});
  const r2 = await L.installerModeleDepart(odin as never, process.env.SOUL_MODELE ? { dossier: process.env.SOUL_MODELE } : {}); // deuxième passage : rien n'est écrasé
  const m = await moteur.chargerMoteur(home);
  if (!m) { console.log(JSON.stringify({ r1, r2, recharge: 'aucun' })); return; }
  const cos = (a: Float32Array, b: Float32Array) => { let s = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2; } return s / Math.sqrt(x * y); };
  // Recherche par le sens : pour chaque demande, la plus proche parmi quelques fiches d'applis.
  const fiches = { vidarr: 'Sphinx : le serveur DNS d\'Odin, bloque pubs, pisteurs et sites dangereux', aegir: 'Apollon : ta musique et tes radios, lecture sur les enceintes', gjoll: 'Vortex : le VPN de la maison, tes appareils se connectent chez toi', sindri: 'Phénix : les sauvegardes de tes dossiers et de tes PC', frigg: 'Chronos : les rendez-vous, horaires et créneaux libres', himinbjorg: 'Cyclope : tes caméras, voir, photographier, enregistrer' };
  const vf: Record<string, Float32Array> = {}; for (const [k, t] of Object.entries(fiches)) vf[k] = await m.plonger(t);
  const q = [['bloque les publicités', 'vidarr'], ['mets de la musique', 'aegir'], ['qui est sur le VPN ?', 'gjoll'], ['sauvegarde mes fichiers', 'sindri'], ['mes rendez-vous de demain', 'frigg'], ['photo de la caméra du jardin', 'himinbjorg'], ['block the ads', 'vidarr'], ['play some music', 'aegir']] as const;
  let bons = 0; const voisins: string[] = [];
  for (const [d, att] of q) { const v = await m.plonger(d); const best = Object.entries(vf).map(([k, x]) => [k, cos(v, x)] as const).sort((a, b) => b[1] - a[1]); if (best[0][0] === att) bons++; voisins.push(`${d} → ${best[0][0]} (${best[0][1].toFixed(3)})${best[0][0] === att ? '' : ` ≠ ${att}`}`); }
  // Les témoins : rien de ce qui sort ne doit les contenir.
  const sorties: string[] = [];
  for (const a of ['Il faut se souvenir que', 'Note privée :', 'le code de la porte est', 'Le propriétaire s\'appelle', 'rue des']) sorties.push(await m.completer(a, 40, { graine: 1 }));
  for (const t of TENUES.slice(0, 10)) sorties.push((await m.proposer({ texte: t.demande, maxMorceaux: 32, graine: 1 })).texte);
  const fuites = L.temoinsTrouves(sorties, T);
  const r = { premierPassage: r1, deuxiemePassage: r2, depart: L.departInstalle(home), recharge: { pret: m.pret, modele: m.modeleEmbedding, poids: m.hyper.poids }, rechercheParLeSens: { justes: bons, sur: q.length, voisins }, temoins: { cherches: T.length, retrouves: fuites }, exemplesDeSortie: sorties.slice(0, 6).map((s) => s.slice(0, 80)) };
  await m.arreter();
  writeFileSync(join(DOS, 'preuve-installation.json'), JSON.stringify(r, null, 1));
  console.log(JSON.stringify(r, null, 1));
}

if (cmd === 'entrainer') await entrainer();
else if (cmd === 'temoins') await temoins(resolve(arg2 ?? join(DOS, 'temoins.txt')));
else if (cmd === 'installer') await installer(arg2);
else if (cmd === 'corpus-v2') await corpusV2(arg2);
else if (cmd === 'comparer') await comparer(resolve(arg2!), opt('etiquette', 'comparaison')!);
else console.log('commandes : temoins <dossier> <fichier> | entrainer <dossier> --minutes N --fils K [--essai] | installer <dossier> [témoins]');
process.exit(0);
