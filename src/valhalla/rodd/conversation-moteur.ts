// Écho · mode « Conversation » : le moteur. Écoute (Whisper, langue reconnue ou imposée), traduction (le modèle
// d'Odin, ou un serveur LibreTranslate sur la machine ou le réseau de la maison) et voix (service, Piper, ou la
// voix du navigateur). Toutes les briques extérieures passent par `Deps` : les essais les remplacent, rien de réel.
//
// - Le son n'est jamais gardé (privacy.keepAudio forcé à faux sur la copie de la config).
// - Le japonais ne va JAMAIS à Piper (aucune voix Piper japonaise : il le lirait avec la voix française).
// - « tout sur la machine » (réglage de la conversation) : écoute sur la machine, modèle seulement s'il est local,
//   serveur de traduction seulement sur la machine ou la maison, voix du navigateur seulement si elle est locale.
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ensurePiperVoice, localPiper, localWhisper, PIPER_LANG, speakLocal, voiceHome, type Heard } from '../../voice/local.ts';
import { forSpeech, hear, providerReady, speakAudio, type VoiceConfig } from '../../voice/voice.ts';
import { BCP47, consigneTraduction, hallucination, langueDe, lireTraduction, nettoyer, parole, pasCompris, quiParle, RIEN, serveurPermis, validerTraduction, type Langue, type Qui, type Reglages } from './conversation.ts';

export interface ModeleTraduction {
  demander(system: string, user: string, signal?: AbortSignal): Promise<string>;
  /** tous les fournisseurs configurés sont sur la machine ou la maison (Ollama…) */
  local: boolean;
  nom: string;
}
export interface Deps {
  entendre?: (audio: Uint8Array, mime: string, v: VoiceConfig, signal?: AbortSignal) => Promise<Heard>;
  modele?: ModeleTraduction;
  fetch?: typeof fetch;
  parlerMachine?: (texte: string, home: string | undefined, voix: string, langue: string, vitesse: number) => Promise<Uint8Array>;
  parlerService?: typeof speakAudio;
  piperVoix?: (langue: string) => Promise<string | undefined>;
  whisper?: () => { bin: string; model: string } | undefined;
  piper?: () => { bin: string; model: string } | undefined;
  env?: NodeJS.ProcessEnv;
}

const ECOUTE_MS = 60_000, TRADUCTION_MS = 20_000;
const estLocale = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(u);

/** La config de la voix pour UNE écoute : langue détectée ou imposée (« fr! »), son jamais gardé. */
export function configEcoute(v: VoiceConfig, reglages: Pick<Reglages, 'local'>, langue: Langue | 'auto'): VoiceConfig {
  return {
    ...v,
    stt: { ...v.stt, language: langue === 'auto' ? 'auto' : langue === 'fr' ? 'fr!' : langue },
    privacy: { ...v.privacy, keepAudio: false },
    localOnly: Boolean(v.localOnly || reglages.local),
  };
}

export interface EtatEcoute { pret: boolean; ou: 'machine' | 'service' | null; modele: string | null; japonais: boolean; raison?: string }
/** L'écoute est-elle prête, où, avec quel modèle Whisper, et comprend-elle le japonais ? */
export function etatEcoute(v: VoiceConfig, reglages: Pick<Reglages, 'local'>, deps: Deps = {}): EtatEcoute {
  const cv = configEcoute(v, reglages, 'auto'), env = deps.env ?? process.env;
  const service = !cv.localOnly && (Boolean(env[v.stt.apiKeyEnv]) || (v.enabled && estLocale(v.stt.baseUrl)));
  const w = (deps.whisper ?? localWhisper)();
  const modele = w ? basename(w.model) : null;
  const jaMachine = Boolean(modele && /small|medium|large/i.test(modele) && !/\.en\b|\.en\.bin$|-en\b/i.test(modele));
  if (service) return { pret: true, ou: 'service', modele, japonais: true };
  if (w) return { pret: true, ou: 'machine', modele, japonais: jaMachine, ...(jaMachine ? {} : { raison: `Le modèle Whisper installé (${modele}) comprend mal le japonais : installe le modèle « small » ou plus grand (multilingue, jamais « .en »).` }) };
  return { pret: false, ou: null, modele: null, japonais: false, raison: cv.localOnly ? 'L\'écoute n\'est pas installée sur la machine : dis à Odin « installe la voix locale ».' : 'L\'écoute n\'est pas prête : dis à Odin « installe la voix locale », ou ajoute une clé dans Réglages → Voix.' };
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
const AIDE_MODELE = 'Configure un modèle dans Réglages → Modèle, ou lance un serveur de traduction LibreTranslate sur la machine (pip install libretranslate, puis libretranslate --load-only en,fr,ja).';

const sonde = new Map<string, { at: number; ok: boolean; langues: string[] }>();
/** Le serveur LibreTranslate répond-il, et avec quelles langues ? (une fois par minute au plus, 800 ms d'attente) */
export async function sonderLibre(url: string, f: typeof fetch = fetch, maintenant = Date.now()): Promise<{ ok: boolean; langues: string[] }> {
  const base = serveurPermis(url); if (!base) return { ok: false, langues: [] };
  const c = sonde.get(base); if (c && maintenant - c.at < 60_000) return c;
  let r = { at: maintenant, ok: false, langues: [] as string[] };
  try {
    const res = await f(`${base}/languages`, { signal: AbortSignal.timeout(800), redirect: 'error' });
    if (res.ok) { const l = await res.json() as Array<{ code?: string }>; const codes = Array.isArray(l) ? l.map((x) => String(x.code ?? '')).filter(Boolean) : []; r = { at: maintenant, ok: codes.includes('en'), langues: codes }; }
  } catch { /* ne répond pas */ }
  sonde.set(base, r); return r;
}
/** Oublie la sonde (essais, ou réglage changé). */
export const oublierSonde = () => sonde.clear();

/** Traduit avec LibreTranslate ; fr ↔ ja passe par l'anglais (Argos ne traduit pas directement). */
export async function traduireLibre(url: string, q: string, de: Langue, vers: Langue, f: typeof fetch = fetch, signal?: AbortSignal): Promise<string> {
  const base = serveurPermis(url);
  if (!base) throw new Error('adresse du serveur de traduction refusée : seulement la machine ou le réseau de la maison');
  const un = async (t: string, s: Langue, c: Langue) => {
    const res = await f(`${base}/translate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: t, source: s, target: c, format: 'text' }), signal: signal ?? AbortSignal.timeout(TRADUCTION_MS), redirect: 'error' });
    if (!res.ok) throw new Error(`le serveur de traduction a refusé (HTTP ${res.status})`);
    const j = await res.json() as { translatedText?: unknown };
    return String(j.translatedText ?? '').trim();
  };
  if (de !== 'en' && vers !== 'en') return un(await un(q, de, 'en'), 'en', vers);
  return un(q, de, vers);
}

/** Traduit un tour : modèle puis serveur hors ligne (selon le réglage), sortie vérifiée ; jamais de fausse traduction. */
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
      const f = deps.fetch ?? fetch;
      if (!serveurPermis(reglages.serveur)) { erreurs.push('adresse du serveur de traduction refusée'); continue; }
      const s = await sonderLibre(reglages.serveur, f);
      if (!s.ok) { erreurs.push('aucun serveur de traduction ne répond sur la machine'); continue; }
      if (![de, vers].every((l) => s.langues.includes(l))) { erreurs.push(`le serveur de traduction n'a pas le ${[de, vers].filter((l) => !s.langues.includes(l)).join(', ')}`); continue; }
      try {
        const lu = lireTraduction(await traduireLibre(reglages.serveur, t, de, vers, f, signal)), v = validerTraduction(t, lu, vers);
        if (v.ok) return { texte: lu, moteur: 'hors-ligne', ...(v.verifier ? { verifier: v.verifier } : {}) };
        erreurs.push(`hors ligne : ${v.raison}`);
      } catch (e) { erreurs.push(`hors ligne : ${(e as Error).message.slice(0, 160)}`); }
    }
  }
  const aucun = !deps.modele || (reglages.local && !deps.modele.local);
  return { texte: '', moteur: null, erreur: `Pas de traduction : ${erreurs.join(' ; ')}.`, ...(aucun ? { aide: AIDE_MODELE } : {}) };
}

/** L'état de la traduction pour la page (le serveur est sondé une fois par minute au plus). */
export async function etatTraduction(reglages: Pick<Reglages, 'local' | 'moteur' | 'serveur'>, deps: Deps = {}): Promise<{ pret: boolean; moteur: 'modele' | 'hors-ligne' | null; nom: string; local: boolean; raison?: string; aide?: string }> {
  const mo = deps.modele, modeleOk = reglages.moteur !== 'hors-ligne' && mo && (!reglages.local || mo.local);
  if (modeleOk) return { pret: true, moteur: 'modele', nom: mo!.nom || 'modèle d\'Odin', local: mo!.local };
  if (reglages.moteur !== 'modele') {
    const s = await sonderLibre(reglages.serveur, deps.fetch ?? fetch);
    if (s.ok) return { pret: true, moteur: 'hors-ligne', nom: 'traduction hors ligne, approximative (LibreTranslate)', local: true };
  }
  const raison = !mo ? 'Aucun modèle d\'IA n\'est configuré, et aucun serveur de traduction ne répond sur la machine.' : reglages.local ? '« Tout sur la machine » : le modèle configuré est en ligne, et aucun serveur de traduction ne répond sur la machine.' : reglages.moteur === 'modele' ? 'Le modèle est choisi, mais il n\'est pas disponible.' : 'Aucun serveur de traduction ne répond.';
  return { pret: false, moteur: null, nom: '', local: Boolean(reglages.local), raison, aide: AIDE_MODELE };
}

// ---------------- Voix ----------------
export type OuVoix = 'service' | 'machine' | 'navigateur';
/** Le fichier de la voix Piper d'une langue, s'il est déjà là (sans rien télécharger). */
export function voixPiperPresente(langue: string, home?: string): string | undefined {
  const p = PIPER_LANG[langue]; if (!p) return undefined;
  const [, loc, who, q] = p.split('/'), f = join(voiceHome(home), 'piper-voices', `${loc}-${who}-${q}.onnx`);
  return existsSync(f) && existsSync(`${f}.json`) ? f : undefined;
}
/**
 * Le service de voix sait-il lire les trois langues ? ElevenLabs avec un modèle multilingue, ou l'API d'OpenAI.
 * Un modèle anglais seul (eleven_turbo_v2…) ou un serveur de la maison (Kokoro, voix française…) : seulement le français,
 * la langue d'Odin ; l'anglais et le japonais passent à Piper ou au navigateur.
 */
export function serviceMultilingue(v: Pick<VoiceConfig, 'tts'>): boolean {
  if (v.tts.provider === 'elevenlabs') return /multilingual|v2_5|v3/i.test(v.tts.model || 'eleven_multilingual_v2');
  if (v.tts.provider === 'openai') { try { return new URL(v.tts.baseUrl || 'https://api.openai.com/v1').hostname === 'api.openai.com'; } catch { return false; } }
  return false;
}
/** Qui dit la phrase dans cette langue : le service (s'il est permis), Piper (jamais en japonais), ou le navigateur. */
export async function voixPour(langue: Langue, v: VoiceConfig, reglages: Pick<Reglages, 'local'>, deps: Deps = {}, o: { telecharger?: boolean } = {}): Promise<OuVoix> {
  const env = deps.env ?? process.env;
  if (!reglages.local && !v.localOnly && v.enabled && (v.tts.provider === 'openai' || v.tts.provider === 'elevenlabs') && providerReady(v, env) && (langue === 'fr' || serviceMultilingue(v))) return 'service';
  if (langue === 'ja') return 'navigateur'; // aucune voix Piper japonaise : jamais la voix française
  if (!(deps.piper ?? (() => localPiper()))()) return 'navigateur';
  if (langue === 'fr') return 'machine';
  const fichier = o.telecharger === false && !deps.piperVoix ? voixPiperPresente(langue) : await (deps.piperVoix ?? ((l: string) => ensurePiperVoice(l)))(langue).catch(() => undefined);
  return fichier ? 'machine' : 'navigateur';
}
export type Dit = { data: Uint8Array; mime: string } | { navigateur: true; langue: string; localSeulement: boolean };
/** Dit un texte : le son, ou la consigne de le faire dire par le navigateur (dans la bonne langue). */
export async function dire(texte: string, langue: Langue, v: VoiceConfig, reglages: Pick<Reglages, 'local' | 'vitesse'>, deps: Deps = {}, signal?: AbortSignal): Promise<Dit> {
  const nav: Dit = { navigateur: true, langue: BCP47[langue], localSeulement: Boolean(reglages.local || v.localOnly) };
  const t = texte.trim().slice(0, 2000); if (!t) throw new Error('rien à dire');
  const ou = await voixPour(langue, v, reglages, deps);
  try {
    if (ou === 'service') { const a = await (deps.parlerService ?? speakAudio)(t, { ...v, speech: { ...v.speech, rate: reglages.vitesse } }, 'mp3_44100_128', signal, deps.env ?? process.env, langue); return { data: a.data, mime: a.mime }; }
    if (ou === 'machine') {
      const genre = v.gender === 'femme' || /siwis/.test(v.tts.voiceId) ? 'femme' : '';
      return { data: await (deps.parlerMachine ?? speakLocal)(forSpeech(t, langue), undefined, genre, langue, reglages.vitesse), mime: 'audio/wav' };
    }
  } catch { /* la voix ne marche pas : le navigateur prend le relais */ }
  return nav;
}
