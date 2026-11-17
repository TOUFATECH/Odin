// Banc de rapidité : SOUL (Noûs) sur le processeur — où part le temps d'un pas d'entraînement et d'une réponse.
//
//   node --disable-warning=ExperimentalWarning test/rapidite/soul.ts [profil|noyaux|maquettes|fils|comparer] …
//
// profil : un réseau « moyen » (poids au hasard : même calcul qu'un réseau entraîné), N suites de 128 morceaux,
//          perte + gradients sur le fil principal, sous le profil processeur ; temps propre par fonction, ramasse-miettes,
//          débit en morceaux/s ; puis la génération (une réponse de 32 morceaux).
// noyaux : GFLOP/s du produit de matrices d'Odin (WebAssembly SIMD) pour chaque forme utilisée par le gabarit « moyen ».
// fils : débit réel d'une séance (1 fil, ou fils d'aide) + génération + mémoire, pour un dossier de code donné.
// comparer : AVANT (copie du dernier commit hors du dépôt) / APRÈS sur 1, 4 et 7 fils, dans les mêmes minutes.
//   RAPIDITE_SORTIE=…/rapidite/processeur node … test/rapidite/soul.ts comparer <copie avant> [tours] [pas]
// Lecture seule de src/brain/nous : rien n'y est modifié.

process.env.ODIN_ESSAI = '1';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { chargeMachine, ecrireResultat, profiler, stat, tableau } from './outils.ts';

const { Reseau } = await import('../../src/brain/nous/calcul.ts');
const { hyperDe } = await import('../../src/brain/nous/tailles.ts');
const { noyaux, produitBloc } = await import('../../src/brain/nous/wasm.ts');

export function suites(n: number, T: number, V: number, graine = 1): Int32Array[] {
  let a = graine >>> 0; const r = () => { a = (a * 1664525 + 1013904223) >>> 0; return a; };
  return Array.from({ length: n }, () => { const s = new Int32Array(T); for (let i = 0; i < T; i++) s[i] = r() % V; return s; });
}

/** FLOP d'une perte + gradients sur une suite (2 par multiplication-addition) : produits de matrices, tête, attention. */
export function flopsSuite(h: { C: number; couches: number; vocab: number }, T: number) {
  const C = h.C, C4 = 4 * C, L = h.couches, V = h.vocab;
  const avantCouche = 2 * T * C * C * 4 + 2 * T * C * C4 * 2, attention = 2 * T * T * C; // QK et PV, causal ~moitié ×2
  const avant = L * (avantCouche + attention) + 2 * T * C * V;
  return { avant, total: 3 * avant, tete: 3 * 2 * T * C * V, attention: 3 * L * attention, couches: 3 * L * avantCouche };
}

async function profil(n: number) {
  const h = hyperDe('moyen'), r = new Reseau(h); r.initialiser(1);
  const s = suites(n + 2, h.contexte, h.vocab);
  r.perteEtGrad(s[0]); r.perteEtGrad(s[1]); r.jeterGrad(); // chauffe
  const charge = await chargeMachine(1000);
  const t0 = performance.now();
  const p = await profiler(async () => { for (let i = 2; i < n + 2; i++) r.perteEtGrad(s[i]); r.pasAdamW(3e-4); }, ['perteEtGrad', 'avant', 'retropropagation', 'layernorm', 'dLayernorm', 'transpose', 'pasAdamW', 'mm', 'ajoute', 'gelu', 'dgelu']);
  const ms = performance.now() - t0;
  // Génération : une réponse de 32 morceaux après une amorce de 16.
  const amorce = s[0].subarray(0, 16);
  const tg = performance.now(); for (let i = 0; i < 3; i++) r.generer(amorce, 32, { graine: i }); const msGen = (performance.now() - tg) / 3;
  const f = flopsSuite({ C: h.C, couches: h.couches, vocab: h.vocab }, h.contexte);
  return { charge, suites: n, ms, morceauxParS: (n * h.contexte) / (ms / 1000), gflopsEffectifs: (f.total * n) / (ms * 1e6), flops: f, inclusif: p.inclusif, propre: p.propre, totalEchantillonne: p.totalMs, generation32Ms: msGen, morceauxGeneresParS: 32 / (msGen / 1000) };
}

function noyauxMesure() {
  const k = noyaux(), h = hyperDe('moyen'), T = h.contexte, C = h.C, C4 = 4 * C, V = h.vocab;
  const formes: Array<[string, number, number, number]> = [
    ['q,k,v,o : T×C · C×C', T, C, C], ['ffn 1 : T×C · C×4C', T, C, C4], ['ffn 2 : T×4C · 4C×C', T, C4, C],
    ['tête : T×C · C×V', T, C, V], ['grad tête : V×T · T×C', V, T, C], ['grad w1 : C×T · T×4C', C, T, C4], ['génération : 1×C · C×4C', 1, C, C4],
  ];
  const out: Array<{ forme: string; wasm: number; js: number }> = [];
  for (const [nom, M, K, N] of formes) {
    const a = new Float32Array(M * K).map((_, i) => ((i % 13) - 6) * 0.01), b = new Float32Array(K * N).map((_, i) => ((i % 7) - 3) * 0.02), c = new Float32Array(M * N);
    const g = (f: () => void) => { f(); let n = 0; const t0 = performance.now(); do { f(); n++; } while (performance.now() - t0 < 300); return (2 * M * K * N * n) / ((performance.now() - t0) * 1e6); };
    out.push({ forme: `${nom} (${M}×${K}×${N})`, wasm: g(() => k.mm(c, a, b, M, K, N)), js: g(() => produitBloc(c, a, b, M, K, N)) });
  }
  return { simd: k.simd, formes: out };
}

/** Maquettes : noyau par blocs (avec et sans FMA, avec et sans recopie), attention par produits de matrices, perte à une
 *  seule exponentielle, temps du ramasse-miettes d'un pas. Chaque maquette est comparée au calcul actuel (écart max). */
async function maquettes() {
  const { noyauBloc } = await import('./noyau-bloc.ts');
  const k = noyaux(), h = hyperDe('moyen'), T = h.contexte, C = h.C, C4 = 4 * C, V = h.vocab;
  const res: Record<string, unknown> = {};
  const g = (f: () => void, flop: number) => { f(); let n = 0; const t0 = performance.now(); do { f(); n++; } while (performance.now() - t0 < 300); return (flop * n) / ((performance.now() - t0) * 1e6); };
  // 1. Noyaux.
  const lignes: Array<Array<string | number>> = [];
  for (const fmaOn of [false, true]) {
    const nb = noyauBloc(fmaOn); if (!nb) { lignes.push([`bloc 4×8${fmaOn ? ' + FMA' : ''}`, 'non validé ici', '', '', '']); continue; }
    for (const [nom, M, K, N] of [['T×C·C×C', T, C, C], ['T×C·C×4C', T, C, C4], ['T×4C·4C×C', T, C4, C], ['tête T×C·C×V', T, C, V], ['V×T·T×C', V, T, C]] as Array<[string, number, number, number]>) {
      const a = new Float32Array(M * K).map((_, i) => Math.sin(i) * 0.1), b = new Float32Array(K * N).map((_, i) => Math.cos(i) * 0.1), c1 = new Float32Array(M * N), c2 = new Float32Array(M * N);
      k.mm(c1, a, b, M, K, N); nb.mm(c2, a, b, M, K, N);
      let ecart = 0, ref = 0; for (let i = 0; i < c1.length; i++) { ecart = Math.max(ecart, Math.abs(c1[i] - c2[i])); ref = Math.max(ref, Math.abs(c1[i])); }
      const flop = 2 * M * K * N;
      const actuel = g(() => k.mm(c1, a, b, M, K, N), flop), bloc = g(() => nb.mm(c2, a, b, M, K, N), flop);
      nb.heap.set(a, 0); nb.heap.set(b, M * K); const brut = g(() => nb.brut(0, M * K * 4, (M * K + K * N) * 4, M, K, N), flop);
      lignes.push([`bloc 4×8${fmaOn ? ' + FMA' : ''} ${nom}`, actuel.toFixed(1), bloc.toFixed(1), brut.toFixed(1), `${(ecart / (ref || 1)).toExponential(1)}`]);
    }
  }
  res.noyaux = lignes;
  // 2. Attention d'une couche (4 têtes) : boucles actuelles (copie fidèle) contre produits de matrices par tête.
  const H = h.tetes, hd = C / H, inv = 1 / Math.sqrt(hd);
  const q = new Float32Array(T * C).map((_, i) => Math.sin(i * 0.37) * 0.5), kk = new Float32Array(T * C).map((_, i) => Math.cos(i * 0.11) * 0.5), v = new Float32Array(T * C).map((_, i) => Math.sin(i * 0.05));
  const attBoucles = (ao: Float32Array) => {
    const p = new Float32Array(H * T * T);
    for (let hh = 0; hh < H; hh++) { const hoff = hh * hd, poff = hh * T * T; for (let i = 0; i < T; i++) {
      let mx = -Infinity; for (let j = 0; j <= i; j++) { let s = 0; const qi = i * C + hoff, kj = j * C + hoff; for (let c = 0; c < hd; c++) s += q[qi + c] * kk[kj + c]; s *= inv; p[poff + i * T + j] = s; if (s > mx) mx = s; }
      let som = 0; for (let j = 0; j <= i; j++) { const e = Math.exp(p[poff + i * T + j] - mx); p[poff + i * T + j] = e; som += e; } const r = 1 / som; for (let j = 0; j <= i; j++) p[poff + i * T + j] *= r;
      const ai = i * C + hoff; for (let c = 0; c < hd; c++) { let s = 0; for (let j = 0; j <= i; j++) s += p[poff + i * T + j] * v[j * C + hoff + c]; ao[ai + c] = s; } } }
  };
  const qh = new Float32Array(T * hd), khT = new Float32Array(hd * T), vh = new Float32Array(T * hd), sc = new Float32Array(T * T), oh = new Float32Array(T * hd);
  const attMm = (ao: Float32Array) => {
    for (let hh = 0; hh < H; hh++) {
      const hoff = hh * hd;
      for (let i = 0; i < T; i++) for (let c = 0; c < hd; c++) { qh[i * hd + c] = q[i * C + hoff + c] * inv; khT[c * T + i] = kk[i * C + hoff + c]; vh[i * hd + c] = v[i * C + hoff + c]; }
      k.mm(sc, qh, khT, T, hd, T); // scores (le triangle supérieur sera mis à zéro)
      for (let i = 0; i < T; i++) { const o = i * T; let mx = -Infinity; for (let j = 0; j <= i; j++) if (sc[o + j] > mx) mx = sc[o + j]; let som = 0; for (let j = 0; j <= i; j++) { const e = Math.exp(sc[o + j] - mx); sc[o + j] = e; som += e; } const r = 1 / som; for (let j = 0; j <= i; j++) sc[o + j] *= r; for (let j = i + 1; j < T; j++) sc[o + j] = 0; }
      k.mm(oh, sc, vh, T, T, hd);
      for (let i = 0; i < T; i++) for (let c = 0; c < hd; c++) ao[i * C + hoff + c] = oh[i * hd + c];
    }
  };
  const ao1 = new Float32Array(T * C), ao2 = new Float32Array(T * C); attBoucles(ao1); attMm(ao2);
  let ecA = 0; for (let i = 0; i < ao1.length; i++) ecA = Math.max(ecA, Math.abs(ao1[i] - ao2[i]));
  const tps = (f: () => void) => { f(); let n = 0; const t0 = performance.now(); do { f(); n++; } while (performance.now() - t0 < 400); return (performance.now() - t0) / n; };
  res.attention = { bouclesMs: tps(() => attBoucles(ao1)), produitsMs: tps(() => attMm(ao2)), ecartMax: ecA };
  // 3. Perte : deux passes d'exponentielles (actuel) contre une seule (on garde e^(x−max), puis on divise).
  const logits = new Float32Array(T * V).map((_, i) => Math.sin(i * 0.001) * 3), d1 = new Float32Array(T * V), d2 = new Float32Array(T * V);
  const perte2 = () => { for (let t = 0; t < T - 1; t++) { const o = t * V; let mx = -Infinity; for (let x = 0; x < V; x++) if (logits[o + x] > mx) mx = logits[o + x]; let som = 0; for (let x = 0; x < V; x++) som += Math.exp(logits[o + x] - mx); const lse = mx + Math.log(som); for (let x = 0; x < V; x++) d1[o + x] = Math.exp(logits[o + x] - lse); } };
  const perte1 = () => { for (let t = 0; t < T - 1; t++) { const o = t * V; let mx = -Infinity; for (let x = 0; x < V; x++) if (logits[o + x] > mx) mx = logits[o + x]; let som = 0; for (let x = 0; x < V; x++) { const e = Math.exp(logits[o + x] - mx); d2[o + x] = e; som += e; } const r = 1 / som; for (let x = 0; x < V; x++) d2[o + x] *= r; } };
  perte2(); perte1(); let ecP = 0; for (let i = 0; i < d1.length; i++) ecP = Math.max(ecP, Math.abs(d1[i] - d2[i]));
  res.perte = { deuxExpMs: tps(perte2), uneExpMs: tps(perte1), ecartMax: ecP };
  // 4. Ramasse-miettes pendant 8 suites (perte + gradients), et mémoire allouée par suite.
  const { PerformanceObserver } = await import('node:perf_hooks');
  let gcMs = 0, gcN = 0; const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) { gcMs += e.duration; gcN++; } }); obs.observe({ entryTypes: ['gc'] });
  const r = new Reseau(h); r.initialiser(1); const s = suites(10, T, V); r.perteEtGrad(s[0]); r.jeterGrad();
  const t0 = performance.now(); for (let i = 1; i < 9; i++) r.perteEtGrad(s[i]); const msPas = performance.now() - t0;
  await new Promise((x) => setTimeout(x, 50)); obs.disconnect();
  res.ramasseMiettes = { ms: Math.round(gcMs), passages: gcN, partDuPas: Math.round((100 * gcMs) / msPas), msPas: Math.round(msPas) };
  return res;
}

/**
 * Débit d'un pas d'entraînement « moyen » sur `nFils` fils (séance réelle : seance() sur 1 fil, seanceParallele() avec
 * des fils d'aide au-delà), puis d'une génération, et la mémoire. `racine` : le dossier qui contient src/brain/nous
 * (le dépôt, ou une copie du dernier commit hors du dépôt pour la mesure « avant »). Le noyau peut être forcé par
 * ODIN_NOYAU (fma, bloc, ancien, js) dans le code qui le connaît.
 */
async function fils(racine: string, nFils: number, nPas: number) {
  const { pathToFileURL } = await import('node:url');
  const { join } = await import('node:path');
  const base = (f: string) => pathToFileURL(join(racine, 'src/brain/nous', f)).href;
  const calc = await import(base('calcul.ts')) as typeof import('../../src/brain/nous/calcul.ts');
  const { hyperDe: hy } = await import(base('tailles.ts')) as typeof import('../../src/brain/nous/tailles.ts');
  const h = hy('moyen'), sab = new SharedArrayBuffer(h.poids * 4);
  const r = new calc.Reseau(h, new Float32Array(sab)); r.initialiser(1);
  const nf = Math.max(1, nFils), parFil = Math.max(1, Math.round(8 / nf)), lot = parFil * nf;
  const donnees = suites(lot * (nPas + 1) * 2 + 8, h.contexte, h.vocab, 7);
  const aides = nf > 1 ? calc.lancerAides(h, sab, undefined, nf - 1) : undefined;
  const lancer = async (entrees: Int32Array[], maxPas: number) => {
    const o = { dureeMs: 600_000, graine: 3, tailleLot: 8, maxPas };
    // RAPIDITE_SANS_REPARTI=1 : le pas (addition des gradients + AdamW) fait par le seul fil de Noûs, comme avant.
    const a = aides && process.env.RAPIDITE_SANS_REPARTI === '1' ? { ...aides, reparti: undefined } : aides;
    return a ? calc.seanceParallele(r, [{ entrees }], o, a) : calc.seance(r, [{ entrees }], o);
  };
  await lancer(donnees.slice(0, lot * 2), 2); // chauffe (fils d'aide prêts, noyaux compilés)
  // Charge de la machine : 1 s juste avant (les autres programmes seuls), puis pendant la mesure (le fil de mesure est
  // bloqué, donc par différence des compteurs) : occupation totale, et la part des AUTRES programmes que ce banc.
  const chargeAvant = await chargeMachine(1000);
  const { cpus } = await import('node:os');
  const occ = () => cpus().reduce((s, c) => { const t = c.times; return { occupe: s.occupe + t.user + t.nice + t.sys + t.irq, total: s.total + t.user + t.nice + t.sys + t.irq + t.idle }; }, { occupe: 0, total: 0 });
  const o0 = occ(), c0 = process.cpuUsage();
  const av = await lancer(donnees.slice(lot * 2), nPas);
  const cpu = process.cpuUsage(c0), o1 = occ();
  const totalMs = o1.total - o0.total, occupeMs = o1.occupe - o0.occupe, banc = (cpu.user + cpu.system) / 1000;
  const chargePendant = { machine: Math.round((1000 * occupeMs) / totalMs) / 10, autres: Math.round((1000 * Math.max(0, occupeMs - banc)) / totalMs) / 10 };
  const amorce = donnees[0].subarray(0, 16);
  r.generer(amorce, 8);
  const tg = performance.now(); for (let i = 0; i < 3; i++) r.generer(amorce, 32, { graine: i }); const msGen = (performance.now() - tg) / 3;
  const mem = process.memoryUsage();
  if (aides) await calc.arreterAides(aides);
  return {
    racine, fils: nf, lot, pas: av.pas, morceaux: av.morceauxVus, ms: Math.round(av.tempsMs), morceauxParS: Math.round(av.morceauxVus / (av.tempsMs / 1000)),
    msParPas: Math.round(av.tempsMs / Math.max(1, av.pas)), perte: av.perte, generation32Ms: Math.round(msGen), morceauxGeneresParS: Math.round(32 / (msGen / 1000)),
    cpuBancMs: Math.round(banc), chargeAvant: chargeAvant.occupation, chargePendant,
    memoire: { rssMo: Math.round(mem.rss / 1e6), tasMo: Math.round(mem.heapUsed / 1e6), tamponsMo: Math.round(mem.arrayBuffers / 1e6), externeMo: Math.round(mem.external / 1e6) },
    noyau: (r as unknown as { modeNoyau?: string }).modeNoyau ?? 'ancien (code d\'origine)',
  };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const quoi = process.argv[2] ?? 'profil';
  if (quoi === 'comparer') {
    // node test/rapidite/soul.ts comparer <racine avant> [tours] [nPas] : AVANT (copie du dernier commit hors du dépôt) et
    // APRÈS (ce dépôt) en processus séparés, l'un juste après l'autre (ordre alterné d'un tour à l'autre), sur 1, 4 et 7
    // fils ; à 1 fil, aussi le code APRÈS avec un noyau forcé (bloc sans fusion, ancien) pour séparer les gains.
    const { execFileSync } = await import('node:child_process');
    const { resolve } = await import('node:path');
    const avant = resolve(process.argv[3] ?? '.'), apres = resolve('.'), tours = Number(process.argv[4] ?? 2), nPas = Number(process.argv[5] ?? 4);
    const lancer = (racine: string, n: number, noyau?: string) => JSON.parse(execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), 'fils', racine, String(n), String(nPas)], { env: { ...process.env, ...(noyau ? { ODIN_NOYAU: noyau } : {}) }, encoding: 'utf8', maxBuffer: 1 << 24 }).trim().split('\n').pop()!);
    const lignes: Array<Record<string, unknown>> = [];
    for (let t = 0; t < tours; t++) {
      for (const n of [1, 4, 7]) {
        const variantes: Array<[string, string, string | undefined]> = [['avant', avant, undefined], ['après', apres, undefined]];
        if (n === 1) variantes.push(['après, noyau bloc', apres, 'bloc'], ['après, noyau ancien', apres, 'ancien']);
        if (t % 2) variantes.reverse();
        const heure = new Date().toISOString();
        for (const [quoiV, racine, noyau] of variantes) { const r = lancer(racine, n, noyau); lignes.push({ tour: t, heure, fils: n, variante: quoiV, ...r }); console.log(t, n, quoiV, r.morceauxParS, 'morceaux/s', r.generation32Ms, 'ms/32', 'charge', r.chargeAvant, JSON.stringify(r.chargePendant)); }
      }
    }
    const lig = (n: number, v: string) => lignes.filter((l) => l.fils === n && l.variante === v);
    const med = (xs: number[]) => stat(xs).mediane;
    const tab: Array<Array<string | number>> = [];
    for (const n of [1, 4, 7]) for (const v of ['avant', 'après', 'après, noyau bloc', 'après, noyau ancien']) {
      const l = lig(n, v); if (!l.length) continue;
      const a = lig(n, 'avant');
      const rapports = l.map((x) => { const y = a.find((z) => z.tour === x.tour)!; return (x.morceauxParS as number) / (y.morceauxParS as number); });
      tab.push([n, v, med(l.map((x) => x.morceauxParS as number)), med(l.map((x) => x.msParPas as number)), v === 'avant' ? '—' : `×${med(rapports).toFixed(2)}`, med(l.map((x) => x.generation32Ms as number)), med(l.map((x) => (x.memoire as { rssMo: number }).rssMo)), l.map((x) => `${x.chargeAvant}/${(x.chargePendant as { autres: number }).autres}`).join(' '), String(l[0].noyau)]);
    }
    const texte = `Soul « moyen » : avant (dernier commit, copie hors du dépôt) et après, mêmes minutes, ${tours} tours, ${nPas} pas par mesure.\n` +
      tableau(['fils', 'code', 'morceaux/s', 'ms/pas', 'rapport', 'génération 32 (ms)', 'mémoire (Mo)', 'charge avant/autres pendant (%)', 'noyau'], tab) + '\n';
    ecrireResultat('soul-processeur', { lignes }, texte); console.log(texte); process.exit(0);
  }
  if (quoi === 'fils') {
    // node test/rapidite/soul.ts fils <racine> <nFils> [nPas] : une ligne JSON (le pilote compare avant / après).
    const { resolve } = await import('node:path');
    const res = await fils(resolve(process.argv[3] ?? '.'), Number(process.argv[4] ?? 1), Number(process.argv[5] ?? 4));
    console.log(JSON.stringify(res)); process.exit(0);
  }
  if (quoi === 'maquettes') {
    const c = await chargeMachine(1000), r = await maquettes() as { noyaux: Array<Array<string | number>>; attention: { bouclesMs: number; produitsMs: number; ecartMax: number }; perte: { deuxExpMs: number; uneExpMs: number; ecartMax: number }; ramasseMiettes: unknown };
    const texte = `Maquettes Soul — charge ${c.occupation} %\n` + tableau(['noyau / forme', 'actuel GFLOP/s', 'maquette GFLOP/s', 'sans recopie', 'écart relatif'], r.noyaux) +
      `\nAttention d'une couche (4 têtes, T=128) : boucles ${r.attention.bouclesMs.toFixed(2)} ms, produits de matrices ${r.attention.produitsMs.toFixed(2)} ms (écart max ${r.attention.ecartMax.toExponential(1)}).` +
      `\nPerte (softmax sur 127×4096) : deux exponentielles ${r.perte.deuxExpMs.toFixed(2)} ms, une seule ${r.perte.uneExpMs.toFixed(2)} ms (écart max ${r.perte.ecartMax.toExponential(1)}).` +
      `\nRamasse-miettes pendant 8 suites : ${JSON.stringify(r.ramasseMiettes)}\n`;
    ecrireResultat('soul-maquettes', { charge: c, ...r }, texte); console.log(texte); process.exit(0);
  }
  if (quoi === 'noyaux') {
    const c = await chargeMachine(1000), r = noyauxMesure();
    const texte = `Noyaux (SIMD : ${r.simd}) — charge ${c.occupation} %\n` + tableau(['forme', 'WebAssembly GFLOP/s', 'JS blocs GFLOP/s'], r.formes.map((x) => [x.forme, x.wasm.toFixed(2), x.js.toFixed(2)])) + '\n';
    ecrireResultat('soul-noyaux', { charge: c, ...r }, texte); console.log(texte);
  } else {
    const r = await profil(Number(process.argv[3] ?? 8));
    const texte = `Pas d'entraînement « moyen » sur 1 fil : ${r.suites} suites de 128 en ${Math.round(r.ms)} ms → ${Math.round(r.morceauxParS)} morceaux/s, ${r.gflopsEffectifs.toFixed(2)} GFLOP/s effectifs (charge ${r.charge.occupation} %).\n` +
      `FLOP par suite : ${(r.flops.total / 1e9).toFixed(2)} G (tête ${Math.round(100 * r.flops.tete / r.flops.total)} %, couches ${Math.round(100 * r.flops.couches / r.flops.total)} %, attention ${Math.round(100 * r.flops.attention / r.flops.total)} %).\n` +
      `Inclusif (ms) : ${JSON.stringify(Object.fromEntries(Object.entries(r.inclusif).map(([k, v]) => [k, Math.round(v)])))}\n` +
      `Temps propre (top) :\n${tableau(['fonction', 'ms', 'part'], r.propre.slice(0, 18).map((x) => [`${x.nom} ${x.url}`.slice(0, 70), Math.round(x.ms), `${Math.round(100 * x.ms / r.totalEchantillonne)} %`]))}\n` +
      `Génération : 32 morceaux en ${Math.round(r.generation32Ms)} ms (${Math.round(r.morceauxGeneresParS)} morceaux/s).\n`;
    ecrireResultat('soul-profil', r, texte); console.log(texte);
  }
  process.exit(0);
}
