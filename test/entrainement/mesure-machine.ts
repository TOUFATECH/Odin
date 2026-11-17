// Mesure de la machine pour l'entraînement de Soul (Noûs) : vitesse d'un pas d'entraînement du gabarit « moyen »
// (8 séquences de 128 morceaux, passe avant + arrière + pas AdamW), avec 1, 4 et 7 fils qui travaillent en même temps,
// et la mémoire prise. Chaque fil tient son propre réseau (le moteur d'aujourd'hui n'entraîne que sur UN fil : on
// mesure ici ce que la machine pourrait donner, pas ce que le moteur fait déjà).
//
//   node --disable-warning=ExperimentalWarning test/entrainement/mesure-machine.ts [secondes par mesure] [fils…]
//
// Rien n'est écrit sur le disque. Sortie : un objet JSON par ligne.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus, totalmem, freemem } from 'node:os';
import { Reseau } from '../../src/brain/nous/calcul.ts';
import { hyperDe } from '../../src/brain/nous/tailles.ts';

interface Ordre { secondes: number; taille: 'petit' | 'moyen' | 'grand'; graine: number }

/** Fait des pas d'entraînement pendant `secondes` ; rend le nombre de pas et la durée. */
function travailler(o: Ordre): { pas: number; ms: number; msParPas: number; rssMo: number } {
  const h = hyperDe(o.taille);
  const r = new Reseau(h); r.initialiser(o.graine);
  const seqs: Int32Array[] = [];
  for (let k = 0; k < 8; k++) { const s = new Int32Array(h.contexte); for (let i = 0; i < s.length; i++) s[i] = 8 + ((i * 2654435761 + k * 97) >>> 0) % (h.vocab - 8); seqs.push(s); }
  // chauffe : un pas
  for (const s of seqs) r.perteEtGrad(s); r.pasAdamW(3e-4);
  const t0 = performance.now(); let pas = 0;
  while (performance.now() - t0 < o.secondes * 1000) { for (const s of seqs) r.perteEtGrad(s); r.pasAdamW(3e-4); pas++; }
  const ms = performance.now() - t0;
  return { pas, ms: Math.round(ms), msParPas: Math.round(ms / Math.max(1, pas)), rssMo: Math.round(process.memoryUsage().rss / 1048576) };
}

if (!isMainThread && parentPort) {
  parentPort.postMessage(travailler(workerData as Ordre));
} else if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/').split('/').pop() ?? '§')) {
  const secondes = Number(process.argv[2] ?? 20);
  const liste = (process.argv.slice(3).length ? process.argv.slice(3) : ['1', '4', '7']).map(Number);
  console.log(JSON.stringify({ machine: { coeurs: cpus().length, modele: cpus()[0]?.model, memoireGo: Math.round(totalmem() / 1e9 * 10) / 10, libreGo: Math.round(freemem() / 1e9 * 10) / 10 }, poidsMoyen: hyperDe('moyen').poids }));
  for (const n of liste) {
    const avant = freemem();
    const t0 = performance.now();
    let pire = 0;
    const sonde = setInterval(() => { pire = Math.max(pire, avant - freemem()); }, 500);
    const res = await Promise.all(Array.from({ length: n }, (_, i) => new Promise<ReturnType<typeof travailler>>((ok, ko) => {
      const w = new Worker(new URL(import.meta.url), { workerData: { secondes, taille: 'moyen', graine: 1 + i } satisfies Ordre });
      w.once('message', (m) => { ok(m as ReturnType<typeof travailler>); void w.terminate(); });
      w.once('error', ko);
    })));
    clearInterval(sonde);
    const pasTotal = res.reduce((a, r) => a + r.pas, 0);
    const duree = (performance.now() - t0) / 1000;
    console.log(JSON.stringify({
      fils: n, secondes, pasParFil: res.map((r) => r.pas), msParPasMoyen: Math.round(res.reduce((a, r) => a + r.msParPas, 0) / n),
      pasParMinuteTotal: Math.round(pasTotal / secondes * 60), morceauxParSeconde: Math.round(pasTotal * 8 * 128 / secondes),
      memoirePriseMo: Math.round(pire / 1048576), dureeReelleS: Math.round(duree),
    }));
  }
}
