// Le worker du bac à sable (isolation du code libre). Il reçoit le code et l'exécute dans le contexte node:vm
// de executerDansVm ; le pont `appeler` fait l'aller-retour vers le FIL PRINCIPAL (qui tient la vraie action,
// en liste blanche, action grave refusée). Le worker, lui, ne demande que « appelle module.action » : il n'a
// jamais la fonction d'action. Une panne ici n'arrête pas Odin : le fil principal remplace juste le worker.

import { parentPort } from 'node:worker_threads';
import { executerDansVm } from './bacasable.ts';
import type { Limites, Resultat } from './scripts.ts';

const port = parentPort;
if (port) {
  const attentes = new Map<number, (r: Resultat) => void>();
  let prochainId = 1;

  port.on('message', (m: { type: string; id?: number; code?: string; entree?: Record<string, unknown>; limites?: Limites; resultat?: Resultat }) => {
    if (m.type === 'appeler-res') { const f = attentes.get(m.id ?? 0); if (f) { attentes.delete(m.id ?? 0); f(m.resultat ?? { ok: false, texte: 'sans réponse' }); } return; }
    if (m.type !== 'run') return;
    // Le pont vu par le code : il demande au fil principal et attend sa réponse (jamais la fonction elle-même).
    const appeler = (module: string, action: string, entree?: Record<string, unknown>): Promise<Resultat> => new Promise((resolve) => {
      const id = prochainId++;
      attentes.set(id, resolve);
      try { port.postMessage({ type: 'appeler', id, module, action, entree: entree ?? {} }); } catch { resolve({ ok: false, texte: 'fil principal injoignable' }); }
    });
    void executerDansVm(String(m.code ?? ''), m.entree ?? {}, m.limites ?? { budgetMs: 2000, budgetMo: 64, maxAppels: 50, maxBoucles: 100_000 }, appeler)
      .then((resultat) => { try { port.postMessage({ type: 'fini', resultat }); } catch { /* parti */ } })
      .catch((e: unknown) => { try { port.postMessage({ type: 'fini', resultat: { ok: false, texte: (e as Error).message } }); } catch { /* parti */ } });
  });
}
