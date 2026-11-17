// Banc du PREMIER ENTRAÎNEMENT de Soul (Noûs, le cerveau profond d'Odin), sur ce qu'Odin EST : ses applis, leurs
// actions et leurs mots, leurs liens, le guide, ses compétences et outils, ses fiches du Cerveau, ses documents.
// Tout se passe dans un dossier d'Odin JETABLE (SOUL_TRAVAIL), jamais dans le vrai dossier d'Odin de la machine :
// les clés de la machine du banc sont rangées dans <travail>/cles (ODIN_CLE_DIR), pas avec les vraies.
//
//   $env:SOUL_TRAVAIL = 'D:\un\dossier\jetable'      (défaut : <dossier temporaire>/odin-soul-travail)
//   node --disable-warning=ExperimentalWarning test/entrainement/soul.ts corpus
//   … soul.ts decoupage
//   … soul.ts mesurer avant              (réseau neuf, même découpage)
//   … soul.ts entrainer --etape 1 --minutes 30 --fils 4
//   … soul.ts entrainer --etape 2 --minutes 30 --fils 4
//   … soul.ts mesurer apres              (recharge le point de reprise par chargerMoteur / chargerEntraineur)
//   … soul.ts moteur-reel                (le chemin du produit : nouvelEntraineur → seance → ecrire → chargerMoteur)
//   … soul.ts nuit --minutes 3           (une séance de nuit du produit, porte de qualité comprise, sur le point actuel)
//   … soul.ts exporter <dossier>         (poids + découpage NON scellés : ils ne contiennent que du public)
//
// Entraînement à plusieurs fils : le moteur du produit n'entraîne aujourd'hui que sur UN fil (moteur.ts, `o.fils`
// accepté mais ignoré). Le banc partage donc lui-même le travail : chaque fil calcule les gradients d'une part du lot
// sur les MÊMES poids (mémoire partagée), le fil principal les additionne et fait le pas AdamW (calcul.ts, inchangé).
// Le point de reprise est écrit par ecrireReprise (reprise.ts) : c'est le format exact du produit.
// Arrêt propre à tout moment : créer le fichier <travail>/STOP (un point de reprise est écrit avant de s'arrêter).

import { Worker, MessageChannel, isMainThread, workerData, type MessagePort } from 'node:worker_threads';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { tmpdir, freemem } from 'node:os';
import { join } from 'node:path';

const TRAVAIL = process.env.SOUL_TRAVAIL || join(tmpdir(), 'odin-soul-travail');
process.env.ODIN_CLE_DIR = join(TRAVAIL, 'cles');
process.env.ODIN_ESSAI = '1';
process.env.ODIN_NO_VOICE_INSTALL = '1';
const HOME = join(TRAVAIL, 'odin');
const F = {
  corpus: join(TRAVAIL, 'corpus.json'),
  decoupage: join(TRAVAIL, 'decoupage.json'),
  courbe: join(TRAVAIL, 'courbe.jsonl'),
  stop: join(TRAVAIL, 'STOP'),
  mesures: (e: string) => join(TRAVAIL, `mesures-${e}.json`),
};

const { Reseau, perteSur } = await import('../../src/brain/nous/calcul.ts');
const { hyperDe } = await import('../../src/brain/nous/tailles.ts');
const { apprendreDecoupage, lireDecoupageSerialise, serialiserDecoupage, SPECIAUX } = await import('../../src/brain/nous/decoupage.ts');
type Hyper = import('../../src/brain/nous/tailles.ts').Hyper;
type DecoupageConcret = import('../../src/brain/nous/decoupage.ts').DecoupageConcret;

// ------------------------------------------------------------------------------------------------ outils communs
const arg = (nom: string, defaut?: string): string | undefined => { const i = process.argv.indexOf(`--${nom}`); return i > 0 ? process.argv[i + 1] : defaut; };
const hache = (s: string): number => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const journal = (o: Record<string, unknown>): void => { appendFileSync(F.courbe, JSON.stringify({ quand: new Date().toISOString(), ...o }) + '\n'); };
function prng(graine: number): () => number { let a = graine >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export interface Texte { source: string; texte: string }
export interface Paire { demande: string; reponse: string; module: string; source: string }
export interface CorpusSoul { quand: string; textes: Texte[]; paires: Paire[]; gardees: Paire[]; fiches: Array<{ id: string; nom: string; texte: string }>; bilanProduit: unknown; ajoutsBanc: string[] }

/** Le format texte d'une paire, compatible avec proposer() et scoreDe() du moteur (qui ne savent pas passer de jetons de rôle). */
export const amorceDe = (demande: string): string => `Demande : ${demande}\nRéponse :`;
export const reponseDe = (r: string): string => ` ${r}`;

// ------------------------------------------------------------------------------------------------ 1. le corpus
async function faireCorpus(): Promise<void> {
  mkdirSync(TRAVAIL, { recursive: true });
  const { makeOdin } = await import('../helpers.ts');
  const { allModules, seedBrain } = await import('../../src/valhalla/odin.ts');
  const { LINKS, USAGES } = await import('../../src/valhalla/links.ts');
  const { SURVOL } = await import('../../src/valhalla/survol.ts');
  const { brainOf } = await import('../../src/tools/brain.ts');
  const { fabriquerDepart } = await import('../../src/brain/nous/corpus-depart.ts');
  const { fileBornee } = await import('../../src/brain/nous/deps.ts');
  const { APPRISES, GARDEES } = await import('./demandes.ts');
  const o = makeOdin([{ text: 'ok' }]);
  try {
    const modules = allModules(o);
    // Comme chez le propriétaire après « odin init » : les fiches des applis sont dans le Cerveau.
    const fiches = seedBrain(o);
    const competences = [
      ...(() => { try { return o.skills.list().map((s) => ({ name: s.name, description: s.description })); } catch { return []; } })(),
      // Ajout du banc : les outils de l'agent (le produit ne lit que les compétences « skills »).
      ...o.tools.all().map((t) => ({ name: `outil ${t.name}`, description: String(t.description ?? '') })),
    ];
    const sources = {
      modules: modules.map((m) => ({ id: m.id, name: m.name, what: m.what, does: m.does, words: m.words, actions: m.actions.map((a) => ({ id: a.id, label: a.label, what: a.what, words: a.words, read: a.read })) })),
      liens: LINKS, usages: USAGES, survol: SURVOL, competences,
      notes: () => { try { return brainOf({ home: o.paths.home, careCfg: o.cfg, workspace: o.paths.workspace }).all().map((n) => ({ title: n.title, body: n.body })); } catch { return []; } },
      souvenirs: () => [] as Array<{ content: string; origin: string }>,
    };
    const file = fileBornee(200_000);
    const deps = { cfg: { learning: { observe: true }, nous: { actif: true } }, privateMode: () => false, demo: false, essai: false, file };
    const bilan = fabriquerDepart(o.paths.home, deps, 'odin', sources);
    const tout = file.prendre(file.taille());
    const textes: Texte[] = [], paires: Paire[] = [];
    for (const e of tout) {
      if (e.sorte === 'echange' && e.demande && e.reponse) {
        const mod = /\(([a-z0-9_]+)\) →/.exec(e.reponse)?.[1] ?? '';
        paires.push({ demande: e.demande, reponse: e.reponse, module: mod, source: e.source });
      } else if (e.texte) textes.push({ source: e.source, texte: e.texte });
    }
    // Ajout du banc : les documents du dépôt (docs/*.md) et le guide d'Odin (README) — le produit ne les lit pas.
    const racine = new URL('../../', import.meta.url);
    for (const f of readdirSync(new URL('docs/', racine)).filter((x) => x.endsWith('.md'))) textes.push({ source: `docs:${f}`, texte: readFileSync(new URL(`docs/${f}`, racine), 'utf8') });
    try { textes.push({ source: 'docs:README.md', texte: readFileSync(new URL('README.md', racine), 'utf8') }); } catch { /* absent */ }
    // Les demandes en phrases : la moitié apprise (paires), l'autre gardée à part.
    const nomDe = new Map(modules.map((m) => [m.id, m.name]));
    const enPaire = (d: { demande: string; ok: string[] }, source: string): Paire => ({ demande: d.demande, reponse: `${nomDe.get(d.ok[0]) ?? d.ok[0]} (${d.ok[0]})`, module: d.ok[0], source });
    for (const d of APPRISES) paires.push(enPaire(d, 'banc:demandes'));
    // Une part des paires du produit est gardée à part aussi (tirée au hachage : reproductible).
    const gardees: Paire[] = GARDEES.map((d) => enPaire(d, 'banc:demandes-gardees'));
    const apprendre: Paire[] = [];
    for (const p of paires) (p.source === 'odin:paires' && hache(p.demande + p.reponse) % 100 < 12 ? gardees : apprendre).push(p);
    // Une fiche courte par appli, pour la recherche « par le sens » (nom + ce qu'elle fait).
    const fichesCourtes = modules.map((m) => ({ id: m.id, nom: m.name, texte: `${m.name} : ${m.what}` }));
    const c: CorpusSoul = {
      quand: new Date().toISOString(), textes, paires: apprendre, gardees, fiches: fichesCourtes,
      bilanProduit: { ...bilan, fichesCerveau: fiches },
      ajoutsBanc: ['documents docs/*.md et README.md', 'outils de l\'agent comme compétences', `${APPRISES.length} demandes en phrases apprises, ${GARDEES.length} gardées à part`],
    };
    writeFileSync(F.corpus, JSON.stringify(c));
    const parSource = new Map<string, number>();
    for (const t of textes) { const k = t.source.split(':')[0] + ':' + (t.source.split(':')[1] ?? '').split('.')[0].slice(0, 20); parSource.set(k, (parSource.get(k) ?? 0) + 1); }
    console.log(JSON.stringify({
      bilanProduit: bilan, modules: modules.length, actions: modules.reduce((a, m) => a + m.actions.length, 0),
      textes: textes.length, caracteresTextes: textes.reduce((a, t) => a + t.texte.length, 0),
      paires: apprendre.length, gardees: gardees.length, competences: competences.length, fichesCerveau: fiches,
      parSource: Object.fromEntries([...parSource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)),
    }, null, 1));
  } finally { o.cleanup(); }
}

const lireCorpus = (): CorpusSoul => JSON.parse(readFileSync(F.corpus, 'utf8')) as CorpusSoul;
/** Le texte d'une tranche est-il gardé à part ? (≈ 8 % des textes, au hachage de la source et du début). */
const texteGarde = (t: Texte): boolean => hache(t.source + t.texte.slice(0, 200)) % 100 < 8;

// ------------------------------------------------------------------------------------------------ 2. le découpage
// Le découpage est celui du PRODUIT (apprendreDecoupage de decoupage.ts). Le 17/11 au matin, il avait un défaut (une
// même fusion rechoisie en boucle : 3 412 fusions sur 3 832 identiques) ; il a été corrigé dans le produit, avec l'espace
// de tête collé au mot. La séance faite avant la correction est gardée à part (travail-ancien-decoupage).
function faireDecoupage(): void {
  const c = lireCorpus();
  const t0 = performance.now();
  const appr = [...c.textes.filter((t) => !texteGarde(t)).map((t) => t.texte), ...c.paires.map((p) => `${amorceDe(p.demande)}${reponseDe(p.reponse)}`)];
  const d = apprendreDecoupage(appr, 4096, 0x0d1a);
  { const fp = Array.from(d.fusions); const dist = new Set<string>(); for (let i = 0; i < fp.length; i += 2) dist.add(`${fp[i]},${fp[i + 1]}`); console.log(JSON.stringify({ fusionsDistinctes: dist.size })); }
  const ms = performance.now() - t0;
  const s = serialiserDecoupage(d);
  writeFileSync(F.decoupage, JSON.stringify({ vocab: s.vocab, version: s.version, fusions: Array.from(s.fusions) }));
  let car = 0, mor = 0; for (const t of appr) { car += t.length; mor += d.encoder(t).length; }
  const ex = 'Vortex : le VPN de la maison, qui est connecté ?';
  console.log(JSON.stringify({ fusions: s.fusions.length / 2, version: s.version, secondes: Math.round(ms / 100) / 10, caracteres: car, morceaux: mor, caracteresParMorceau: Math.round(car / mor * 100) / 100, exemple: Array.from(d.encoder(ex)).map((i) => d.decoder([i])) }));
}
function lireDecoupage(): DecoupageConcret {
  const j = JSON.parse(readFileSync(F.decoupage, 'utf8')) as { vocab: number; version: number; fusions: number[] };
  return lireDecoupageSerialise({ vocab: j.vocab, version: j.version, fusions: Int32Array.from(j.fusions) });
}

/** Nombre d'octets de texte que porte chaque identifiant (spéciaux : 0 ; octets : 1 ; fusion : somme de ses deux parties). */
function octetsParId(d: DecoupageConcret): Uint16Array {
  const n = new Uint16Array(d.vocab); for (let b = 0; b < 256; b++) n[8 + b] = 1;
  const f = d.fusions; for (let i = 0; i < f.length / 2; i++) n[264 + i] = n[f[2 * i]] + n[f[2 * i + 1]];
  return n;
}
/** Octets prédits dans un jeu de suites (les cibles : tout sauf le premier morceau). */
function octetsCibles(d: DecoupageConcret, seqs: Int32Array[]): number { const o = octetsParId(d); let t = 0; for (const s of seqs) for (let i = 1; i < s.length; i++) t += o[s[i]]; return t; }
const bitsParOctet = (perteMoyenne: number, nPredits: number, octets: number): number => perteMoyenne * nPredits / octets / Math.LN2;

// ------------------------------------------------------------------------------------------------ séquences
interface Seq { ids: Int32Array; roles?: Int32Array }
const CONTEXTE = 128;
/** Découpe un texte en fenêtres de 128 morceaux au plus (le moteur ne borne pas lui-même : voir le rapport). */
function fenetres(d: DecoupageConcret, texte: string): Int32Array[] {
  const ids = [...d.encoder(texte), SPECIAUX.EOS];
  const out: Int32Array[] = [];
  for (let i = 0; i < ids.length; i += CONTEXTE) { const f = ids.slice(i, i + CONTEXTE); if (f.length >= 16 || i === 0) out.push(Int32Array.from(f)); }
  return out;
}
/** Une paire : « Demande : …\nRéponse : » puis la réponse et la fin ; on n'apprend que la réponse (masque de rôles). */
function seqPaire(d: DecoupageConcret, p: Paire): Seq | undefined {
  const a = d.encoder(amorceDe(p.demande)), r = d.encoder(reponseDe(p.reponse));
  const ids = Int32Array.from([...a, ...r, SPECIAUX.EOS]);
  if (ids.length > CONTEXTE || a.length < 1) return undefined;
  const roles = new Int32Array(ids.length);
  for (let t = a.length - 1; t < ids.length - 1; t++) roles[t] = 1; // la position t prédit ids[t+1]
  return { ids, roles };
}
function preparer(d: DecoupageConcret, c: CorpusSoul) {
  const texteAppr: Int32Array[] = [], texteGardes: Int32Array[] = [];
  for (const t of c.textes) (texteGarde(t) ? texteGardes : texteAppr).push(...fenetres(d, t.texte));
  const pairesAppr = c.paires.map((p) => seqPaire(d, p)).filter((x): x is Seq => !!x);
  const pairesGardees = c.gardees.map((p) => seqPaire(d, p)).filter((x): x is Seq => !!x);
  return { texteAppr, texteGardes, pairesAppr, pairesGardees };
}

// ------------------------------------------------------------------------------------------------ le fil de calcul (worker)
// Les fils parlent par un PORT À EUX (MessageChannel) : calcul.ts démarre son propre lecteur d'ordres sur parentPort
// dès qu'il est importé dans un worker (calcul.ts l. 655-657) et répondrait « ordre inconnu » à nos messages.
interface DonneesFil { hyper: Hyper; sabPoids: SharedArrayBuffer; sabGrad: SharedArrayBuffer; seqs: Int32Array[]; roles: Array<Int32Array | null>; port: MessagePort }
if (!isMainThread && (workerData as { soul?: boolean })?.soul) {
  const w = workerData as DonneesFil & { soul: true };
  const r = new Reseau(w.hyper, new Float32Array(w.sabPoids));
  r.grads = new Float32Array(w.sabGrad);
  w.port.on('message', (m: { type: string; idx: number[]; poids?: number[] }) => {
    if (m.type === 'grad') {
      r.jeterGrad();
      let s = 0, n = 0;
      m.idx.forEach((i, k) => { const p = r.perteEtGrad(w.seqs[i], m.poids?.[k] ?? 1, w.roles[i] ?? undefined); if (Number.isFinite(p)) { s += p; n++; } else s = NaN; });
      w.port.postMessage({ s, n, nAccum: m.idx.length });
    } else if (m.type === 'perte') {
      let s = 0, n = 0;
      for (const i of m.idx) { const ids = w.seqs[i]; if (ids.length < 2) continue; const l = perteSur(r, [ids]); s += l * (ids.length - 1); n += ids.length - 1; }
      w.port.postMessage({ s, n });
    }
  });
}

class Pool {
  private fils: Array<{ w: Worker; port: MessagePort; grad: Float32Array }> = [];
  constructor(hyper: Hyper, sabPoids: SharedArrayBuffer, seqs: Seq[], n: number) {
    for (let k = 0; k < n; k++) {
      const sabGrad = new SharedArrayBuffer(hyper.poids * 4);
      const ch = new MessageChannel();
      const w = new Worker(new URL(import.meta.url), { workerData: { soul: true, hyper, sabPoids, sabGrad, seqs: seqs.map((s) => s.ids), roles: seqs.map((s) => s.roles ?? null), port: ch.port2 }, transferList: [ch.port2], resourceLimits: { maxOldGenerationSizeMb: 1024 } });
      w.on('error', (e) => { console.error('fil de calcul tombé :', e); process.exit(3); });
      this.fils.push({ w, port: ch.port1, grad: new Float32Array(sabGrad) });
    }
  }
  get n(): number { return this.fils.length; }
  grad(k: number): Float32Array { return this.fils[k].grad; }
  demander<T>(k: number, msg: unknown): Promise<T> { return new Promise((ok) => { const p = this.fils[k].port; p.once('message', (m: T) => ok(m)); p.postMessage(msg); }); }
  async perte(idx: number[]): Promise<number> {
    const parts = this.fils.map((_, k) => idx.filter((_, i) => i % this.fils.length === k));
    const r = await Promise.all(parts.map((p, k) => this.demander<{ s: number; n: number }>(k, { type: 'perte', idx: p })));
    const s = r.reduce((a, x) => a + x.s, 0), n = r.reduce((a, x) => a + x.n, 0);
    return n ? s / n : NaN;
  }
  async fermer(): Promise<void> { for (const f of this.fils) f.port.close(); await Promise.all(this.fils.map((f) => f.w.terminate())); }
}

// ------------------------------------------------------------------------------------------------ 3. entraîner
async function entrainer(): Promise<void> {
  const { ecrireReprise, lireReprise, prochainNumero } = await import('../../src/brain/nous/reprise.ts');
  const etape = Number(arg('etape', '1'));
  const minutes = Number(arg('minutes', '30'));
  const nFils = Math.max(1, Number(arg('fils', '4')));
  const lot = Number(arg('lot', String(nFils * 4)));
  const lrMax = Number(arg('lr', etape === 1 ? '6e-4' : '3e-4'));
  const toutesMin = Number(arg('reprise-toutes', '10'));
  const graine = Number(arg('graine', String(0x50a1)));
  const d = lireDecoupage(), c = lireCorpus();
  const { texteAppr, texteGardes, pairesAppr, pairesGardees } = preparer(d, c);
  // Les séquences de la séance. Étape 1 : les textes. Étape 2 : les paires (×3), plus des textes rejoués (anti-oubli).
  const seqs: Seq[] = [];
  const gardeTexte: number[] = [], gardePaire: number[] = [];
  for (const s of texteGardes) { gardeTexte.push(seqs.length); seqs.push({ ids: s }); }
  for (const s of pairesGardees) { gardePaire.push(seqs.length); seqs.push(s); }
  const appr: number[] = [];
  if (etape === 1) for (const s of texteAppr) { appr.push(seqs.length); seqs.push({ ids: s }); }
  else {
    for (const s of pairesAppr) { const i = seqs.length; seqs.push(s); appr.push(i, i, i); }
    const rng = prng(graine ^ 0x77);
    const nRejeu = Math.round(appr.length * 0.3);
    for (let k = 0; k < nRejeu; k++) { appr.push(seqs.length); seqs.push({ ids: texteAppr[Math.floor(rng() * texteAppr.length)] }); }
  }
  const h = hyperDe('moyen');
  const sabPoids = new SharedArrayBuffer(h.poids * 4);
  const maitre = new Reseau(h, new Float32Array(sabPoids));
  const ck = await lireReprise(HOME);
  let courbe: Array<{ pas: number; perte: number }> = [];
  if (ck) {
    if (ck.decoupage.version !== d.version) throw new Error('le point de reprise a un autre découpage');
    maitre.importerPoids(ck.poids); maitre.importerMoments(ck.m, ck.v, ck.pas); courbe = ck.courbe;
    console.log(`reprise du point ${ck.n} (pas ${ck.pas})`);
  } else { maitre.initialiser(graine); console.log('réseau neuf'); }
  const pool = new Pool(h, sabPoids, seqs, nFils);
  const evalTexte = gardeTexte.slice(0, 160), evalPaire = gardePaire;
  const evT = evalTexte.map((i) => seqs[i].ids), nPredT = evT.reduce((a, x) => a + x.length - 1, 0), octT = octetsCibles(d, evT);
  const bpo = (p: number) => Math.round(bitsParOctet(p, nPredT, octT) * 1000) / 1000;
  const ecrire = async (raison: string): Promise<string> => {
    const n = prochainNumero(HOME), mm = maitre.exporterMoments();
    const ch = await ecrireReprise(HOME, n, { hyper: h, decoupage: serialiserDecoupage(d), poids: Float32Array.from(maitre.poids), m: mm.m, v: mm.v, pas: mm.pas, graine, courbe, modeleVersion: 1 }, 2);
    journal({ type: 'reprise', etape, n, pas: maitre.pas, raison, octets: statSync(ch).size });
    return ch;
  };
  const p0t = await pool.perte(evalTexte), p0p = await pool.perte(evalPaire);
  journal({ type: 'debut', etape, fils: nFils, lot, lrMax, minutes, sequences: appr.length, gardeTexte: evalTexte.length, gardePaire: evalPaire.length, perteTenueTexte: p0t, bitsParOctetTexte: bpo(p0t), perteTenuePaires: p0p, pas: maitre.pas, libreMo: Math.round(freemem() / 1048576) });
  console.log(`étape ${etape} : ${appr.length} séquences, ${nFils} fils, lot ${lot}, lr ${lrMax} ; perte tenue à part : textes ${p0t.toFixed(3)}, paires ${p0p.toFixed(3)}`);
  const rng = prng(graine + maitre.pas);
  let ordre = appr.slice().sort(() => rng() - 0.5);
  let pos = 0, epoque = 0, meilleure = etape === 1 ? p0t : p0p;
  const t0 = performance.now(), fin = t0 + minutes * 60_000;
  let derniereReprise = t0, dernierEval = t0, glisse = NaN, pasSeance = 0;
  const premierPas = maitre.pas;
  try {
    while (performance.now() < fin && !existsSync(F.stop)) {
      // lr : montée sur 100 pas, puis cosinus vers lr/10 selon le TEMPS de la séance.
      const prog = (performance.now() - t0) / (fin - t0);
      const pasSeanceLocal = maitre.pas - premierPas;
      const lr = pasSeanceLocal < 100 ? lrMax * (pasSeanceLocal + 1) / 100 : lrMax * (0.1 + 0.9 * 0.5 * (1 + Math.cos(Math.PI * Math.min(1, prog))));
      const idx: number[] = [];
      for (let k = 0; k < lot; k++) { if (pos >= ordre.length) { pos = 0; epoque++; ordre = appr.slice().sort(() => rng() - 0.5); } idx.push(ordre[pos++]); }
      const parts = Array.from({ length: pool.n }, (_, k) => idx.filter((_, i) => i % pool.n === k));
      const rep = await Promise.all(parts.map((p, k) => pool.demander<{ s: number; n: number; nAccum: number }>(k, { type: 'grad', idx: p })));
      const s = rep.reduce((a, x) => a + x.s, 0), n = rep.reduce((a, x) => a + x.n, 0), nAcc = rep.reduce((a, x) => a + x.nAccum, 0);
      if (!Number.isFinite(s) || n === 0) { journal({ type: 'lot-ecarte', pas: maitre.pas }); continue; }
      // somme des gradients des fils dans le réseau maître, puis écrêtage de la norme globale à 1 (le moteur n'en a pas)
      const G = maitre.grads; G.set(pool.grad(0)); for (let k = 1; k < pool.n; k++) { const g = pool.grad(k); for (let i = 0; i < G.length; i++) G[i] += g[i]; }
      let nn = 0; for (let i = 0; i < G.length; i++) { const x = G[i] / nAcc; nn += x * x; } const norme = Math.sqrt(nn);
      if (norme > 1) { const f = 1 / norme; for (let i = 0; i < G.length; i++) G[i] *= f; }
      (maitre as unknown as { nAccum: number }).nAccum = nAcc;
      maitre.pasAdamW(lr); pasSeance++;
      const perteLot = s / n; glisse = Number.isNaN(glisse) ? perteLot : 0.95 * glisse + 0.05 * perteLot;
      if (maitre.pas % 10 === 0) journal({ type: 'pas', etape, pas: maitre.pas, epoque, perteLot: Math.round(perteLot * 1000) / 1000, glisse: Math.round(glisse * 1000) / 1000, lr: Number(lr.toExponential(2)), norme: Math.round(norme * 100) / 100, s: Math.round((performance.now() - t0) / 1000) });
      if (performance.now() - dernierEval > 5 * 60_000) {
        dernierEval = performance.now();
        const pt = await pool.perte(evalTexte), pp = await pool.perte(evalPaire);
        courbe.push({ pas: maitre.pas, perte: etape === 1 ? pt : pp });
        journal({ type: 'tenue', etape, pas: maitre.pas, perteTenueTexte: pt, bitsParOctetTexte: bpo(pt), perteTenuePaires: pp, libreMo: Math.round(freemem() / 1048576) });
        console.log(`pas ${maitre.pas} (époque ${epoque}) : lot ${glisse.toFixed(3)} · tenue à part textes ${pt.toFixed(3)} (${bpo(pt)} bits/octet) paires ${pp.toFixed(3)}`);
        const ref = etape === 1 ? pt : pp;
        if (!Number.isFinite(ref) || ref > meilleure * 1.5) { journal({ type: 'divergence', pas: maitre.pas, ref, meilleure }); console.log('divergence : arrêt sans écrire'); return; }
        meilleure = Math.min(meilleure, ref);
      }
      if (performance.now() - derniereReprise > toutesMin * 60_000) { derniereReprise = performance.now(); await ecrire('régulier'); }
    }
    const pt = await pool.perte(evalTexte), pp = await pool.perte(evalPaire);
    courbe.push({ pas: maitre.pas, perte: etape === 1 ? pt : pp });
    const ch = await ecrire('fin de séance');
    journal({ type: 'fin', etape, pas: maitre.pas, pasSeance, epoque, minutes: Math.round((performance.now() - t0) / 600) / 100, perteTenueTexte: pt, bitsParOctetTexte: bpo(pt), perteTenuePaires: pp, chemin: ch });
    console.log(`fin : ${pasSeance} pas (${epoque} époques), tenue à part textes ${pt.toFixed(3)} paires ${pp.toFixed(3)} → ${ch}`);
  } finally { await pool.fermer(); if (existsSync(F.stop)) rmSync(F.stop, { force: true }); }
}

// ------------------------------------------------------------------------------------------------ 4. mesurer
async function mesurer(etiquette: string): Promise<void> {
  const moteurMod = await import('../../src/brain/nous/moteur.ts');
  const { appsFor } = await import('../../src/valhalla/besoin.ts');
  const { Valhalla } = await import('../../src/valhalla/service.ts');
  const { allModules } = await import('../../src/valhalla/odin.ts');
  const { DEFAULT_CONFIG } = await import('../../src/config.ts');
  const d = lireDecoupage(), c = lireCorpus();
  const { texteGardes, pairesGardees } = preparer(d, c);
  const t0 = performance.now();
  // Le réseau : le point de reprise (par chargerEntraineur, et chargerMoteur doit le recharger aussi), sinon un neuf.
  let e: import('../../src/brain/nous/moteur.ts').Entraineur;
  let recharge: Record<string, unknown> = {};
  const ck = (await import('../../src/brain/nous/reprise.ts')).listerReprises(HOME);
  if (ck.length) {
    const m = await moteurMod.chargerMoteur(HOME);
    recharge = { pointsDeReprise: ck, chargerMoteur: m ? { pret: m.pret, modele: m.modeleEmbedding, poids: m.hyper.poids } : 'undefined' };
    if (m) { const v = await m.plonger('qui est connecté sur le VPN ?'); recharge.plongementTaille = v.length; recharge.plongementFini = Array.from(v).every(Number.isFinite); await m.arreter(); }
    e = await moteurMod.chargerEntraineur(HOME);
  } else {
    e = moteurMod.nouvelEntraineur(hyperDe('moyen'), d, 0x50a1, join(TRAVAIL, 'neuf'));
    recharge = { pointsDeReprise: [], reseau: 'neuf (graine 0x50a1), même découpage' };
  }
  try {
    const jeuT = texteGardes.slice(0, 160);
    const perteTexte = await e.perteSur(jeuT);
    const bitsTexte = bitsParOctet(perteTexte, jeuT.reduce((a, x) => a + x.length - 1, 0), octetsCibles(d, jeuT));
    // perte sur la RÉPONSE seulement des paires gardées : −score moyen
    let sp = 0; for (const p of c.gardees) sp += -(await e.scoreDe(amorceDe(p.demande), reponseDe(p.reponse)));
    const perteReponses = sp / c.gardees.length;
    // Justesse « demande → bonne appli » sur les demandes en phrases gardées à part + 60 paires du produit gardées.
    const h = join(TRAVAIL, 'valhalla-mots'); mkdirSync(h, { recursive: true });
    const mods = allModules({ paths: { home: h, workspace: join(h, 'ws') }, cfg: DEFAULT_CONFIG } as never);
    const v = new Valhalla(h, mods);
    const cos = (a: Float32Array, b: Float32Array) => { let s = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return s / (Math.sqrt(na * nb) || 1); };
    const vecFiche = new Map<string, Float32Array>();
    for (const f of c.fiches) { const ids = d.encoder(f.texte); const txt = ids.length > 120 ? d.decoder(ids.slice(0, 120)) : f.texte; vecFiche.set(f.id, await e.plonger(txt)); }
    const jeux = {
      phrases: c.gardees.filter((p) => p.source === 'banc:demandes-gardees'),
      motsProduit: c.gardees.filter((p) => p.source === 'odin:paires').slice(0, 60),
    };
    const { GARDEES } = await import('./demandes.ts');
    const okDe = (p: Paire): string[] => GARDEES.find((g) => g.demande === p.demande)?.ok ?? [p.module];
    const res: Record<string, Record<string, number>> = {};
    const exemples: Array<Record<string, unknown>> = [];
    for (const [nom, jeu] of Object.entries(jeux)) {
      let mots = 0, sens = 0, gen = 0, score = 0, sensTop3 = 0;
      for (const p of jeu) {
        const ok = okDe(p);
        const m1 = appsFor(v, p.demande, 3)[0]?.m.id; if (m1 && ok.includes(m1)) mots++;
        const q = await e.plonger(p.demande);
        const classes = [...vecFiche.entries()].map(([id, x]) => ({ id, s: cos(q, x) })).sort((a, b) => b.s - a.s);
        if (ok.includes(classes[0].id)) sens++;
        if (classes.slice(0, 3).some((x) => ok.includes(x.id))) sensTop3++;
        const prop = await e.proposer({ texte: amorceDe(p.demande), maxMorceaux: 24, graine: 1 });
        const idGen = /\(([a-z0-9_]+)\)/.exec(prop.texte)?.[1];
        if (idGen && ok.includes(idGen)) gen++;
        let best = '', bs = -Infinity;
        for (const f of c.fiches) { const sc = await e.scoreDe(amorceDe(p.demande), reponseDe(`${f.nom} (${f.id})`)); if (sc > bs) { bs = sc; best = f.id; } }
        if (ok.includes(best)) score++;
        if (nom === 'phrases' && exemples.length < 14) exemples.push({ demande: p.demande, attendu: ok, mots: m1 ?? '(rien)', sens: classes.slice(0, 3).map((x) => `${x.id} ${x.s.toFixed(3)}`), propose: prop.texte.trim().slice(0, 80), confiance: Math.round(prop.confiance * 1000) / 1000, score: best });
      }
      const n = jeu.length;
      res[nom] = { n, motsAujourdhui: mots / n, sensPlongements: sens / n, sensTop3: sensTop3 / n, generation: gen / n, scoreMax: score / n };
    }
    const amorces = ['L\'appli Vortex (gjoll) :', 'Pour « sauvegarder mes photos » :', amorceDe('qui est connecté sur le VPN ?'), amorceDe('lance-moi la série Lupin, saison 2, épisode 3'), amorceDe('j\'ai branché une clé USB, démarre dessus'), 'Lien entre applis : Cyclope →', 'Compétence « outil web_search » :', 'Odin est'];
    const completions: Array<{ amorce: string; suite: string }> = [];
    for (const a of amorces) completions.push({ amorce: a, suite: await e.completer(a, 40, { graine: 1 }) });
    // Le chemin DIRECT (Reseau du moteur, sans la façade) avec la forme de l'entraînement du banc (« Demande : …\nRéponse : »).
    // Depuis la correction du 17/11, proposer() et scoreDe() du produit présentent la demande en [USER] … [ASSISTANT] : une
    // autre forme que celle apprise par cette séance. Les deux sont mesurés ; seul le direct correspond à l'entraînement.
    const banc: Record<string, unknown> = {};
    const { lireReprise } = await import('../../src/brain/nous/reprise.ts');
    const ckb = ck.length ? await lireReprise(HOME) : undefined;
    const rb = new Reseau(hyperDe('moyen'));
    if (ckb) rb.importerPoids(ckb.poids); else rb.initialiser(0x50a1);
    const genB = (q: string) => { const g = rb.generer(d.encoder(amorceDe(q)), 24, { arretId: SPECIAUX.EOS, graine: 1 }); return { texte: d.decoder(g.ids), confiance: g.confiance }; };
    for (const [nom, jeu] of Object.entries(jeux)) {
      let gen = 0, score = 0;
      const ex: Array<Record<string, unknown>> = [];
      for (const p of jeu) {
        const ok = okDe(p);
        const g = genB(p.demande); const idGen = /\(([a-z0-9_]+)\)/.exec(g.texte)?.[1];
        if (idGen && ok.includes(idGen)) gen++;
        const dem = d.encoder(amorceDe(p.demande));
        let best = '', bs = -Infinity;
        for (const f of c.fiches) { const sc = rb.score(dem, d.encoder(reponseDe(`${f.nom} (${f.id})`))); if (sc > bs) { bs = sc; best = f.id; } }
        if (ok.includes(best)) score++;
        if (nom === 'phrases' && ex.length < 14) ex.push({ demande: p.demande, attendu: ok, propose: g.texte.trim().slice(0, 80), confiance: Math.round(g.confiance * 1000) / 1000, score: best });
      }
      banc[nom] = { n: jeu.length, generation: gen / jeu.length, scoreMax: score / jeu.length, exemples: ex };
    }
    const sortie = { etiquette, quand: new Date().toISOString(), recharge, perteTenueTextes: perteTexte, bitsParOctetTextes: bitsTexte, fenetresTenues: Math.min(160, texteGardes.length), perteReponsesGardees: perteReponses, pairesGardees: c.gardees.length, justesse: res, justesseDirecteFormeDuBanc: banc, exemples, completions, secondes: Math.round((performance.now() - t0) / 1000) };
    writeFileSync(F.mesures(etiquette), JSON.stringify(sortie, null, 1));
    console.log(JSON.stringify(sortie, null, 1));
  } finally { await (e as unknown as { arreter(): Promise<void> }).arreter(); }
}

// ------------------------------------------------------------------------------------------------ 5. le chemin du produit
async function moteurReel(): Promise<void> {
  const moteurMod = await import('../../src/brain/nous/moteur.ts');
  const { lotPreEntrainement } = await import('../../src/brain/nous/etapes.ts');
  const d = lireDecoupage(), c = lireCorpus();
  const { texteAppr, texteGardes } = preparer(d, c);
  const home = join(TRAVAIL, 'chemin-produit'); rmSync(home, { recursive: true, force: true }); mkdirSync(home, { recursive: true });
  const e = moteurMod.nouvelEntraineur(hyperDe('moyen'), d, 7, home);
  const banc = texteGardes.slice(0, 32);
  const avant = await e.perteSur(banc);
  const ac = new AbortController();
  const lot = lotPreEntrainement(texteAppr.slice(0, 400).map((m) => ({ morceaux: m, sorte: 'note' as const, fiable: true })));
  const av = await e.seance([lot], { dureeMs: 90_000, fils: 4, signal: ac.signal, graine: 7 });
  const apres = await e.perteSur(banc);
  const ch = await e.ecrire(0);
  await e.arreter();
  const m = await moteurMod.chargerMoteur(home);
  const prop = m ? await m.proposer({ texte: 'L\'appli', maxMorceaux: 12 }) : undefined;
  await m?.arreter();
  console.log(JSON.stringify({ avant, apres, avancee: av, chemin: ch, octets: statSync(ch).size, recharge: m ? { pret: m.pret, modele: m.modeleEmbedding } : 'undefined', proposition: prop }));
}

// ------------------------------------------------------------------------------------------------ 6. une séance de nuit du produit
async function nuitProduit(): Promise<void> {
  const moteurMod = await import('../../src/brain/nous/moteur.ts');
  const { seanceDeNuit } = await import('../../src/brain/nous/nuit.ts');
  const { listerReprises } = await import('../../src/brain/nous/reprise.ts');
  const d = lireDecoupage(), c = lireCorpus();
  const { texteAppr, texteGardes } = preparer(d, c);
  const e = await moteurMod.chargerEntraineur(HOME);
  const dernier = listerReprises(HOME)[0] ?? -1;
  const ac = new AbortController();
  const b = await seanceDeNuit({ entraineur: e, banc: () => texteGardes.slice(0, 64), lots: () => [{ entrees: texteAppr.slice(0, 2000) }], dernierPoint: dernier, graine: 11, heuresNuit: Number(arg('minutes', '3')) / 60, filsNuit: 3, signal: ac.signal });
  await e.arreter();
  journal({ type: 'nuit-produit', ...b, avancee: b.avancee });
  console.log(JSON.stringify(b));
}

// ------------------------------------------------------------------------------------------------ 7. exporter (portable)
async function exporter(dossier: string): Promise<void> {
  const { lireReprise } = await import('../../src/brain/nous/reprise.ts');
  const ck = await lireReprise(HOME);
  if (!ck) throw new Error('aucun point de reprise');
  mkdirSync(dossier, { recursive: true });
  writeFileSync(join(dossier, 'soul-depart.poids.bin'), Buffer.from(ck.poids.buffer, ck.poids.byteOffset, ck.poids.byteLength));
  // Les moments d'AdamW (pour reprendre l'entraînement sans à-coup chez le propriétaire).
  writeFileSync(join(dossier, 'soul-depart.moments.bin'), Buffer.concat([Buffer.from(ck.m.buffer, ck.m.byteOffset, ck.m.byteLength), Buffer.from(ck.v.buffer, ck.v.byteOffset, ck.v.byteLength)]));
  const s = serialiserDecoupage(ck.decoupage);
  writeFileSync(join(dossier, 'soul-depart.json'), JSON.stringify({ format: 1, hyper: ck.hyper, pas: ck.pas, graine: ck.graine, modeleVersion: ck.modeleVersion, courbe: ck.courbe, decoupage: { vocab: s.vocab, version: s.version, fusions: Buffer.from(s.fusions.buffer).toString('base64') }, note: 'Poids de Soul (Noûs) entraînés sur ce qu\'Odin est (contenu public du dépôt). Non scellés : à installer avec test/entrainement/installer-soul.ts, qui les scelle avec la clé de la machine.' }, null, 1));
  console.log(JSON.stringify({ dossier, pas: ck.pas, octetsPoids: ck.poids.byteLength }));
}

// ------------------------------------------------------------------------------------------------
if (isMainThread) {
  const cmd = process.argv[2];
  mkdirSync(TRAVAIL, { recursive: true });
  if (cmd === 'corpus') await faireCorpus();
  else if (cmd === 'decoupage') faireDecoupage();
  else if (cmd === 'mesurer') await mesurer(process.argv[3] ?? 'avant');
  else if (cmd === 'entrainer') await entrainer();
  else if (cmd === 'moteur-reel') await moteurReel();
  else if (cmd === 'nuit') await nuitProduit();
  else if (cmd === 'exporter') await exporter(process.argv[3] ?? join(TRAVAIL, 'export'));
  else console.log('commandes : corpus | decoupage | mesurer avant|apres | entrainer --etape 1|2 --minutes N --fils K | moteur-reel | nuit --minutes N | exporter <dossier>');
  process.exit(0);
}
