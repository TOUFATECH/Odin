// Noûs — étape 5 : les souvenirs reçoivent leurs vecteurs (recherche par le sens) EN ARRIÈRE-PLAN, par petits lots,
// seulement quand Odin est libre, avec un budget de temps par passage ; ils sont refaits quand le modèle change de
// version (la mémoire compare l'étiquette « noos-v<n>-p<k> » de chaque vecteur). Le calcul se fait dans le worker du
// moteur ; ici on ne fait qu'attendre, et on rend la main entre deux souvenirs.
//
// Changement de version sans trou (constat 13) : quand un NOUVEAU point de reprise arrive alors qu'un moteur est déjà en
// service, la recherche reste servie par l'ancien (et ses vecteurs) ; les vecteurs du nouveau sont préparés À PART (en
// mémoire vive) ; quand tous sont prêts, ils sont rangés d'un coup et le nouveau moteur passe en service. La mémoire ne
// garde qu'un vecteur par souvenir : c'est ce qui permet de ne rien changer à son format.
import { createHash } from 'node:crypto';
import type { Embedder } from '../../muninn/embed.ts';

export interface MemoireVecteurs {
  missingVectors(model: string, limit?: number): Array<{ id: number; content: string }>;
  setVector(id: number, model: string, vec: Float32Array): void;
}
export interface BilanVecteurs { faits: number; ms: number; raison?: string; prepares?: number; bascule?: boolean }

/** Un embedder qui sait préparer la version suivante à part (plongement.ts). */
interface AvecCandidat { candidat?(): Promise<Embedder | undefined>; basculer?(): void; abandonnerCandidat?(): void }

// Les vecteurs du candidat, préparés à part (par étiquette), avec l'empreinte du texte du souvenir, jusqu'à la bascule.
const prepares = new Map<string, Map<number, { v: Float32Array; h: string }>>();
// Les échecs du candidat d'affilée : au-delà de ECHECS_MAX, il est abandonné (la mémoire ne reste pas sans vecteurs).
const echecs = new Map<string, number>();
export const ECHECS_MAX = 3;
const empreinte = (t: string): string => createHash('sha256').update(t).digest('hex').slice(0, 16);

export async function remplirVecteurs(mem: MemoireVecteurs, emb: Embedder & AvecCandidat, o: { libre: () => boolean; budgetMs?: number; lot?: number; maintenant?: () => number } = { libre: () => true }): Promise<BilanVecteurs> {
  const t = o.maintenant ?? (() => performance.now());
  const t0 = t(), budget = o.budgetMs ?? 10_000, lot = o.lot ?? 20;
  let faits = 0;
  try {
    // 1. Un candidat attend ? On prépare SES vecteurs à part ; la recherche reste servie par le moteur en service.
    let cand = emb.candidat ? await emb.candidat() : undefined;
    if (cand && (echecs.get(cand.model) ?? 0) >= ECHECS_MAX) { emb.abandonnerCandidat?.(); prepares.clear(); cand = undefined; }
    if (cand) {
      let pret = prepares.get(cand.model);
      if (!pret) { prepares.clear(); pret = new Map(); prepares.set(cand.model, pret); }
      while (t() - t0 < budget) {
        const aFaire = mem.missingVectors(cand.model, pret.size + lot).filter((m) => !pret.has(m.id)).slice(0, lot);
        if (!aFaire.length) {
          // Tous prêts : rangés d'un coup, puis bascule — seulement ceux dont le texte n'a pas changé entre-temps (un
          // souvenir modifié ou oublié pendant la préparation n'emporte pas un vecteur périmé).
          const actuels = new Map(mem.missingVectors(cand.model, pret.size + lot).map((x) => [x.id, x.content]));
          for (const [id, x] of pret) { const c = actuels.get(id); if (c !== undefined && empreinte(c) === x.h) mem.setVector(id, cand.model, x.v); }
          const n = pret.size; prepares.clear(); emb.basculer?.();
          return { faits: n, ms: Math.round(t() - t0), prepares: n, bascule: true };
        }
        for (const m of aFaire) {
          if (!o.libre()) return { faits, ms: Math.round(t() - t0), raison: 'Odin répond', prepares: pret.size };
          if (t() - t0 >= budget) break;
          let v: Float32Array;
          try { v = await cand.embed(m.content, AbortSignal.timeout(8000)); echecs.set(cand.model, 0); }
          catch (e) {
            const n = (echecs.get(cand.model) ?? 0) + 1; echecs.set(cand.model, n);
            if (n >= ECHECS_MAX) { emb.abandonnerCandidat?.(); prepares.clear(); return { faits, ms: Math.round(t() - t0), raison: `nouvelle version abandonnée après ${n} échecs : ${String((e as Error)?.message ?? e).slice(0, 80)}` }; }
            throw e;
          }
          pret.set(m.id, { v, h: empreinte(m.content) }); faits++;
          await new Promise((ok) => setImmediate(ok));
        }
      }
      // (faits > 0 avec une raison : la passerelle repasse aussitôt, comme pour un remplissage ordinaire)
      return { faits, ms: Math.round(t() - t0), raison: 'budget de temps atteint (nouvelle version en préparation)', prepares: pret.size };
    }
    // 2. Sinon : les vecteurs manquants du moteur en service.
    while (t() - t0 < budget) {
      const aFaire = mem.missingVectors(emb.model, lot);
      if (!aFaire.length) return { faits, ms: Math.round(t() - t0) };
      for (const m of aFaire) {
        if (!o.libre()) return { faits, ms: Math.round(t() - t0), raison: 'Odin répond' };
        if (t() - t0 >= budget) break;
        const v = await emb.embed(m.content, AbortSignal.timeout(8000));
        mem.setVector(m.id, emb.model, v); faits++;
        await new Promise((ok) => setImmediate(ok));
      }
    }
    return { faits, ms: Math.round(t() - t0), raison: 'budget de temps atteint' };
  } catch (e) { return { faits, ms: Math.round(t() - t0), raison: String((e as Error)?.message ?? e).slice(0, 160) }; }
}
