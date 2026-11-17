// Écho · mode « Conversation » : le moteur. Écoute, traduction (le modèle d'Odin) et voix (celle du navigateur).
// Toutes les briques extérieures passent par `Deps` : les essais les remplacent, rien de réel.
//
// Depuis le 17/11/2026, Odin n'utilise aucun modèle qui ne soit pas le sien : plus de Whisper ni de service d'écoute,
// plus de serveur LibreTranslate, plus de voix de service ni de Piper. L'écoute et la traduction disent « pas encore »
// tant que les modèles d'Odin ne sont pas entraînés ; la voix du navigateur reste (décision du propriétaire).
// - Le son n'est jamais gardé (privacy.keepAudio forcé à faux sur la copie de la config).
import type { Heard } from '../../voice/local.ts';
import { hear, type VoiceConfig } from '../../voice/voice.ts';
import { pasEntraine } from '../../langue/pas-entraine.ts';
import { BCP47, consigneTraduction, hallucination, langueDe, lireTraduction, nettoyer, parole, pasCompris, quiParle, RIEN, validerTraduction, type Langue, type Qui, type Reglages } from './conversation.ts';

export interface ModeleTraduction {
  demander(system: string, user: string, signal?: AbortSignal): Promise<string>;
  /** le modèle est sur la machine ou la maison */
  local: boolean;
  nom: string;
}
export interface Deps {
  entendre?: (audio: Uint8Array, mime: string, v: VoiceConfig, signal?: AbortSignal) => Promise<Heard>;
  modele?: ModeleTraduction;
  env?: NodeJS.ProcessEnv;
}

const ECOUTE_MS = 60_000, TRADUCTION_MS = 20_000;

/** La config de la voix pour UNE écoute : langue détectée ou imposée (« fr! »), son jamais gardé. */
export function configEcoute(v: VoiceConfig, reglages: Pick<Reglages, 'local'>, langue: Langue | 'auto'): VoiceConfig {
  return {
    ...v,
    stt: { ...v.stt, language: langue === 'auto' ? 'auto' : langue === 'fr' ? 'fr!' : langue },
    privacy: { ...v.privacy, keepAudio: false },
    localOnly: Boolean(v.localOnly || reglages.local),
  };
}

export interface EtatEcoute { pret: boolean; ou: null; modele: string | null; japonais: boolean; raison?: string }
/** L'écoute n'est jamais prête : Whisper et les services d'écoute sont retirés ; le modèle d'écoute d'Odin n'est pas encore entraîné. */
export function etatEcoute(v: VoiceConfig, _reglages: Pick<Reglages, 'local'>, _deps: Deps = {}): EtatEcoute {
  return { pret: false, ou: null, modele: null, japonais: false, raison: pasEntraine('ecouter', v.stt.language) };
}

// Les écoutes passent une par une (Whisper sur la machine est lourd).
let file: Promise<unknown> = Promise.resolve();
function unParUn<T>(f: () => Promise<T>): Promise<T> { const p = file.then(f, f); file = p.catch(() => undefined); return p; }
function avecDelai<T>(p: Promise<T>, ms: number, quoi: string, ctrl?: AbortController): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<T>((_, ko) => { t = setTimeout(() => { ctrl?.abort(); ko(new Error(`${quoi} a pris trop de temps (plus de ${Math.round(ms / 1000)} s)`)); }, ms); })]).finally(() => clearTimeout(t));
}

/** La langue reconnue est-elle douteuse ? Confiance de Whisper sous 0,6, ou phrase très courte (moins de 3 mots, ou de 4 signes japonais). */
export function douteux(h: Pick<Heard, 'text' | 'confiance'>): boolean {
  if (typeof h.confiance === 'number' && h.confiance < 0.6) return true;
  const t = String(h.text ?? '').trim();
  if (/[぀-ヿ㐀-䶿一-鿿]/.test(t)) return [...t.replace(/[\s、。！？!?.,]/g, '')].length < 4;
  return t.split(/\s+/).filter((m) => /[\p{L}\p{N}]/u.test(m)).length < 3;
}

export interface Ecoute { brut: string; entendu: string; de?: Langue; qui: Qui; incertain?: boolean; horsPaire?: Langue; rien?: boolean; message?: string }
export interface DemandeEcoute { audio: Uint8Array; mime: string; qui: Qui | 'auto'; attendu: Qui; moi: Langue; lui: Langue }

/** Écoute un tour : langue imposée (qui = moi / lui) ou reconnue (qui = auto, réécoute dans la langue attendue si besoin). */
export async function ecouterTour(d: DemandeEcoute, v: VoiceConfig, reglages: Pick<Reglages, 'local'>, deps: Deps = {}): Promise<Ecoute> {
  if (!deps.entendre) { const e = etatEcoute(v, reglages, deps); if (!e.pret) throw new Error(e.raison); }
  const entendre = deps.entendre ?? ((a, m, vv, s) => hear(a, m, vv, s, deps.env ?? process.env));
  const une = (langue: Langue | 'auto') => unParUn(() => { const c = new AbortController(); return avecDelai(entendre(d.audio, d.mime, configEcoute(v, reglages, langue), c.signal), ECOUTE_MS, 'L\'écoute', c); });
  const langueDeQui = (q: Qui) => (q === 'moi' ? d.moi : d.lui);
  const fin = (h: Heard, qui: Qui, de: Langue, plus: Partial<Ecoute> = {}): Ecoute => {
    const brut = String(h.text ?? '').trim(), entendu = hallucination(brut) ? '' : nettoyer(brut, de);
    if (!entendu || hallucination(entendu)) return { brut, entendu: '', de, qui, ...plus, rien: true, message: pasCompris(de, qui) };
    return { brut, entendu, de, qui, ...plus };
  };
  if (d.qui !== 'auto') { const de = langueDeQui(d.qui); return fin(await une(de), d.qui, de); }
  const h = await une('auto');
  if (hallucination(String(h.text ?? '').trim())) return fin(h, d.attendu, langueDeQui(d.attendu));
  const p = quiParle({ detectee: langueDe(h.language, h.text), moi: d.moi, lui: d.lui });
  if (p === 'moi' || p === 'lui') return fin(h, p, langueDeQui(p));
  if (p && douteux(h)) {
    // Hors de la paire, mais Whisper n'en est pas sûr (phrase courte, « OK », un nom) : réécoute dans la langue attendue.
    const de = langueDeQui(d.attendu);
    return fin(await une(de), d.attendu, de, { incertain: true });
  }
  if (p) {
    // Une des trois langues, mais hors de la paire choisie : rien n'est traduit, la page le dit.
    const brut = String(h.text ?? '').trim();
    return { brut, entendu: nettoyer(brut, p.horsPaire), de: p.horsPaire, qui: d.attendu, horsPaire: p.horsPaire, incertain: true };
  }
  // Langue inconnue (bruit, autre langue) : réécoute dans la langue de la personne attendue.
  const de = langueDeQui(d.attendu);
  return fin(await une(de), d.attendu, de, { incertain: true });
}

// ---------------- Traduction ----------------
export interface Traduction { texte: string; moteur: 'modele' | 'hors-ligne' | null; erreur?: string; rien?: boolean; verifier?: string; aide?: string }
const AIDE_MODELE = pasEntraine('traduire');

/** Traduit un tour par le modèle d'Odin, sortie vérifiée ; sinon « pas encore » ; jamais de fausse traduction. */
export async function traduire(texte: string, de: Langue, vers: Langue, reglages: Pick<Reglages, 'local' | 'moteur' | 'serveur'>, deps: Deps = {}, signal?: AbortSignal, qui: Qui = 'moi'): Promise<Traduction> {
  const t = texte.trim(); if (!t) return { texte: '', moteur: null, rien: true };
  const essais: Array<'modele' | 'hors-ligne'> = reglages.moteur === 'modele' ? ['modele'] : reglages.moteur === 'hors-ligne' ? ['hors-ligne'] : ['modele', 'hors-ligne'];
  const erreurs: string[] = [];
  for (const m of essais) {
    if (m === 'modele') {
      const mo = deps.modele;
      if (!mo) { erreurs.push('aucun modèle d\'IA configuré'); continue; }
      if (reglages.local && !mo.local) { erreurs.push('« tout sur la machine » : le modèle configuré est en ligne'); continue; }
      try {
        const c = new AbortController(), fin = () => c.abort(); signal?.addEventListener('abort', fin, { once: true });
        const brut = await avecDelai(mo.demander(consigneTraduction(de, vers, qui), parole(t), c.signal), TRADUCTION_MS, 'La traduction', c).finally(() => signal?.removeEventListener('abort', fin));
        if (brut.includes(RIEN)) return { texte: '', moteur: 'modele', rien: true };
        const lu = lireTraduction(brut), v = validerTraduction(t, lu, vers);
        if (v.ok) return { texte: lu, moteur: 'modele', ...(v.verifier ? { verifier: v.verifier } : {}) };
        erreurs.push(`modèle : ${v.raison}`);
      } catch (e) { erreurs.push(`modèle : ${(e as Error).message.slice(0, 160)}`); }
    } else {
      // L'ancien serveur de traduction (LibreTranslate) est un modèle d'autrui : plus jamais appelé.
      erreurs.push(pasEntraine('traduire'));
    }
  }
  const aucun = !deps.modele || (reglages.local && !deps.modele.local);
  return { texte: '', moteur: null, erreur: `Pas de traduction : ${erreurs.join(' ; ')}.`, ...(aucun ? { aide: AIDE_MODELE } : {}) };
}

/** L'état de la traduction pour la page. */
export async function etatTraduction(reglages: Pick<Reglages, 'local' | 'moteur' | 'serveur'>, deps: Deps = {}): Promise<{ pret: boolean; moteur: 'modele' | 'hors-ligne' | null; nom: string; local: boolean; raison?: string; aide?: string }> {
  const mo = deps.modele, modeleOk = reglages.moteur !== 'hors-ligne' && mo && (!reglages.local || mo.local);
  if (modeleOk) return { pret: true, moteur: 'modele', nom: mo!.nom || 'modèle d\'Odin', local: mo!.local };
  return { pret: false, moteur: null, nom: '', local: Boolean(reglages.local), raison: pasEntraine('traduire'), aide: AIDE_MODELE };
}

// ---------------- Voix ----------------
export type OuVoix = 'navigateur';
/**
 * Qui dit la phrase : toujours le navigateur, dans la bonne langue. Les voix de service (ElevenLabs, OpenAI) et Piper
 * sur la machine sont des modèles d'autrui : retirés le 17/11/2026, jusqu'au modèle de voix d'Odin.
 */
export async function voixPour(_langue: Langue, _v: VoiceConfig, _reglages: Pick<Reglages, 'local'>, _deps: Deps = {}, _o: { telecharger?: boolean } = {}): Promise<OuVoix> {
  return 'navigateur';
}
export type Dit = { navigateur: true; langue: string; localSeulement: boolean };
/** Dit un texte : la consigne de le faire dire par le navigateur (dans la bonne langue). */
export async function dire(texte: string, langue: Langue, v: VoiceConfig, reglages: Pick<Reglages, 'local' | 'vitesse'>, _deps: Deps = {}, _signal?: AbortSignal): Promise<Dit> {
  if (!texte.trim()) throw new Error('rien à dire');
  return { navigateur: true, langue: BCP47[langue], localSeulement: Boolean(reglages.local || v.localOnly) };
}
