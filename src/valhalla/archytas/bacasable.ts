// LE BAC À SABLE du code libre (genre « code »), opt-in par script, livré en dernier. Un script « code » est
// du JS qui s'exécute : on l'isole le plus fort possible SANS dépendance, et on le DIT honnêtement.
//
// CE QUE JE NE PROMETS PAS (dit à l'écran et ici) : node:vm seul N'EST PAS une prison de sécurité (position
// officielle de Node), et ce contexte n'en est PAS une. Un objet hôte dans le contexte (entree, console, le
// pont `appeler`, ou le global `this` lui-même) remet le constructeur Function de l'hôte par sa chaîne de
// prototypes : `entree.constructor.constructor("return process")()` atteint le vrai process — donc fs,
// child_process, le réseau, avec les privilèges OS d'Odin. `codeGeneration:{strings:false}` coupe seulement
// eval/new Function DANS le contexte, pas cette évasion (essai test/archytas-bacasable.test.ts, « limite
// connue »). Le worker ne change rien à cela : il isole la mémoire et permet un arrêt dur, mais son realm a
// les mêmes privilèges. Donc le code libre n'est PAS une barrière de sécurité — c'est un confort d'exécution
// pour du code que TU as écrit et relu, rien d'autre. Désactivé par défaut, opt-in propriétaire par script.
//
// CE QUI EST VRAI (vérifié), sans valoir sécurité contre du code hostile : le code n'atteint les applis d'Odin
// QUE par le pont `appeler` (liste blanche, action grave refusée côté fil principal) ; process/require/fetch
// ne sont pas FOURNIS au contexte (mais restent atteignables par la chaîne constructor, cf. ci-dessus) ; une
// boucle infinie synchrone est coupée (timeout vm) ; le code libre ne tourne QU'EN worker (jamais sur le fil
// principal : une boucle de microtâches y gèlerait Odin) ; un timeout dur termine le worker et une panne du
// worker n'arrête JAMAIS Odin (on('error') → Odin continue), ni ne le fait planter, ni ne le bloque.

import vm from 'node:vm';
import { Worker } from 'node:worker_threads';
import type { Appeler, BacASable, Limites, Resultat } from './scripts.ts';

/** Le message honnête montré avant d'activer le code libre (aucune promesse de sécurité qu'on n'a pas). */
export const AVERTISSEMENT_CODE_LIBRE = 'Le code libre n\'est PAS une barrière de sécurité : il peut atteindre ta machine. À n\'activer que pour du code que TU as écrit et relu.';

const str = (v: unknown): string => (v === undefined || v === null ? '' : typeof v === 'string' ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })());

/**
 * Le cœur du bac à sable, EN PROCESSUS (sans worker) : un contexte node:vm NEUF, globals minimaux, pas de
 * process/require/fetch, pas de génération de code (eval/Function coupés), timeout vm pour les boucles
 * synchrones. Le seul lien vers le monde est `appeler` (le pont en liste blanche). Ne lève jamais : toute
 * erreur revient en { ok:false }. La version worker (plus bas) ajoute l'isolation et l'arrêt dur.
 */
export async function executerDansVm(code: string, entree: Record<string, unknown>, limites: Limites, appeler: Appeler, signal?: AbortSignal): Promise<Resultat> {
  const debut = Date.now();
  let appels = 0;
  const sortie: string[] = [];
  // Le pont : compté (maxAppels), arrêtable, routé vers v.act(auto) par l'appelant (grave refusée côté hôte).
  const pont = async (module: unknown, action: unknown, entreeAppel: unknown): Promise<{ ok: boolean; texte: string }> => {
    if (signal?.aborted) throw new Error('arrêté');
    if (Date.now() - debut > limites.budgetMs) throw new Error('temps dépassé');
    if (++appels > limites.maxAppels) throw new Error('trop d\'appels d\'applis (borne atteinte)');
    const r = await appeler(String(module), String(action), entreeAppel && typeof entreeAppel === 'object' ? entreeAppel as Record<string, unknown> : {});
    return { ok: r.ok === true, texte: String(r.texte ?? '') };
  };
  const contexte: Record<string, unknown> = {
    appeler: pont,
    entree: JSON.parse(JSON.stringify(entree ?? {})),
    console: { log: (...a: unknown[]) => { if (sortie.length < 50) sortie.push(a.map(str).join(' ')); } },
  };
  // Contexte NEUF ; eval et new Function coupés (codeGeneration:false) ; pas de wasm.
  vm.createContext(contexte, { codeGeneration: { strings: false, wasm: false } });
  const enveloppe = `"use strict";(async()=>{\n${code}\n})()`;
  try {
    const budget = Math.max(50, limites.budgetMs);
    const p = vm.runInContext(enveloppe, contexte, { timeout: budget, filename: 'archytas-script.js' }) as Promise<unknown>;
    // Filet pour l'asynchrone (le timeout vm ne couvre que le synchrone) : ce setTimeout est une MACROTÂCHE. Il
    // rattrape une attente asynchrone ordinaire, mais PAS une boucle de microtâches (`while(true){ await … }`),
    // qui l'affame et gèle la boucle d'événements. Seule la version worker, qui TERMINE le fil, y survit — c'est
    // pourquoi le code libre ne tourne qu'en worker (creerBacWorker refuse si le worker est indisponible).
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    const capAsync = new Promise<never>((_ok, ko) => { minuteur = setTimeout(() => ko(new Error('temps dépassé')), budget + 300); minuteur.unref?.(); });
    try {
      const val = await Promise.race([Promise.resolve(p), capAsync]);
      return { ok: true, texte: resume(sortie, val), ms: Date.now() - debut };
    } finally { if (minuteur) clearTimeout(minuteur); }
  } catch (err) {
    return { ok: false, texte: (err as Error).message || 'erreur du script', ms: Date.now() - debut };
  }
}

function resume(sortie: string[], val: unknown): string {
  const parts: string[] = [];
  if (sortie.length) parts.push(sortie.join('\n').slice(0, 2000));
  if (val !== undefined && val !== null) parts.push(`→ ${str(val).slice(0, 400)}`);
  return parts.join('\n') || '✓ script terminé.';
}

/** Un bac à sable EN PROCESSUS (sans worker) : pratique pour les essais et les machines sans worker. */
export function bacDirect(): BacASable {
  return {
    executer: (code, entree, limites, appeler) => executerDansVm(code, entree, limites, appeler),
    arreter() { /* rien à arrêter */ },
  };
}

// ---------------------------------------------------------------------------------------------------------
// La version WORKER (isolation + arrêt dur), patron Noûs. Un worker neuf par exécution (contexte node:vm
// neuf), terminé ensuite ; resourceLimits ; unref (ne tient pas Odin en vie) ; on('error') → Odin continue ;
// timeout dur qui termine le worker. Le pont `appeler` reste sur le FIL PRINCIPAL (liste blanche, grave
// refusée) : le worker ne fait que demander, il n'a jamais la fonction d'action elle-même.
// ---------------------------------------------------------------------------------------------------------
export function creerBacWorker(reglages?: () => { budgetMo: number }): BacASable {
  return {
    async executer(code, entree, limites, appeler): Promise<Resultat> {
      const budgetMo = reglages?.().budgetMo ?? limites.budgetMo;
      let worker: Worker | undefined;
      let appels = 0;
      return await new Promise<Resultat>((resolve) => {
        let fini = false;
        const terminer = (r: Resultat): void => { if (fini) return; fini = true; clearTimeout(dur); try { void worker?.terminate(); } catch { /* déjà fini */ } resolve(r); };
        const dur = setTimeout(() => terminer({ ok: false, texte: 'temps dépassé (le script a été arrêté).' }), Math.max(100, limites.budgetMs) + 500);
        dur.unref?.();
        try {
          worker = new Worker(new URL('./bacasable-worker.ts', import.meta.url), {
            name: 'archytas-bac',
            resourceLimits: { maxOldGenerationSizeMb: Math.max(16, budgetMo), maxYoungGenerationSizeMb: Math.max(8, Math.round(budgetMo / 4)) },
            env: {}, // 0 secret hérité
          });
        } catch (e) {
          // Worker indisponible : on REFUSE le code libre (déclaratif seul). On ne retombe JAMAIS sur le fil
          // principal : un code `while(true){ await Promise.resolve(); }` est une boucle de microtâches que ni le
          // timeout vm (synchrone seulement) ni un setTimeout (macrotâche affamée) ne coupent — il gèlerait Odin.
          clearTimeout(dur);
          return void resolve({ ok: false, texte: `Le code libre a besoin d'un worker isolé, indisponible ici (${(e as Error).message}). Utilise un script déclaratif.` });
        }
        worker.unref();
        worker.on('message', (m: { type: string; id?: number; module?: string; action?: string; entree?: Record<string, unknown>; resultat?: Resultat }) => {
          if (m.type === 'fini') return void terminer(m.resultat ?? { ok: false, texte: 'sans résultat' });
          if (m.type === 'appeler') {
            void (async () => {
              let r: Resultat;
              if (++appels > limites.maxAppels) r = { ok: false, texte: 'trop d\'appels d\'applis (borne atteinte)' };
              else { try { r = await appeler(String(m.module), String(m.action), m.entree ?? {}); } catch (e) { r = { ok: false, texte: (e as Error).message }; } }
              try { worker!.postMessage({ type: 'appeler-res', id: m.id, resultat: { ok: r.ok === true, texte: String(r.texte ?? '') } }); } catch { /* worker parti */ }
            })();
          }
        });
        worker.on('error', (e) => terminer({ ok: false, texte: `le script a échoué : ${e.message}` })); // Odin continue
        worker.on('messageerror', () => terminer({ ok: false, texte: 'message du script illisible' }));
        worker.on('exit', () => terminer({ ok: false, texte: 'le script s\'est arrêté' }));
        try { worker.postMessage({ type: 'run', code, entree, limites }); } catch (e) { terminer({ ok: false, texte: (e as Error).message }); }
      });
    },
    arreter() { /* un worker neuf par exécution : rien à garder */ },
  };
}
