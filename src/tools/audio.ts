// Outil du cœur : décrire un son ou une musique joint à la discussion (parole transcrite, musique, sons reconnus), avec
// la confiance et le temps mesuré. Tout est calculé sur la machine par l'oreille d'Odin (Syrinx, src/audio) ; la parole
// n'est transcrite que par la transcription LOCALE déjà installée (jamais un service en ligne, jamais d'installation,
// l'audio brut n'est pas gardé) ; aucun modèle de texte n'est appelé ici (résumé sans modèle). Ce que l'outil rend revient
// dans la discussion, comme tout résultat d'outil. Le contenu entendu est une donnée non fiable (entourée, session marquée).
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { wrapUntrusted } from '../heimdall/injection.ts';
import { toolPath } from '../heimdall/policy.ts';
import type { Ecouter } from '../audio/contrat.ts';
import { obj, str, type Tool, type ToolResult } from './registry.ts';
import { ecouteurLocal, modeleSonsLocal, oreille, texteErreur } from '../valhalla/syrinx/bande-son.ts';
import { comprendreSon, rapportSon } from '../valhalla/syrinx/ligne-de-temps.ts';
import { dirPoidsSons } from '../valhalla/syrinx/base.ts';

const s = (v: unknown) => String(v ?? '').trim();
const QUOI = ['tout', 'parole', 'musique', 'sons'] as const;
type Quoi = (typeof QUOI)[number];

export const audioAnalyze: Tool = {
  name: 'audio_analyze',
  description: 'Décrit un fichier audio (son, musique, enregistrement), calculé sur la machine : parole transcrite (transcription locale seulement) avec la langue et les tours de parole, musique (tempo, tonalité, structure), sons reconnus (sonnette, alarme, aboiement…), avec la confiance et le temps mesuré. Aucun service en ligne n\'est appelé par l\'outil ; sa réponse revient dans la discussion. quoi = tout (défaut), parole, musique ou sons.',
  risk: 'read',
  taints: true,
  schema: obj({ path: str('fichier audio'), quoi: { type: 'string', enum: [...QUOI], description: 'ce qu\'il faut écouter : tout, parole, musique ou sons' } }, ['path']),
  summarize: (i) => `écouter ${s(i.path)}`,
  async run(i, ctx): Promise<string | ToolResult> {
    const path = s(i.path), quoi: Quoi = (QUOI as readonly string[]).includes(s(i.quoi)) ? s(i.quoi) as Quoi : 'tout';
    const f = toolPath(ctx, path);
    if (!existsSync(f) || !statSync(f).isFile()) return `Fichier introuvable : ${path}`;
    const or = await oreille();
    if (!or) return 'L\'oreille d\'Odin n\'est pas encore prête sur cette machine (le calcul du son n\'est pas installé). Pour la seule parole : audio_transcribe.';
    // Le modèle absent reste « pas prêt » (undefined : texte honnête « pas téléchargé ») ; seule la parole ne le demande pas.
    const modele = quoi === 'parole' ? null : ctx.home ? await modeleSonsLocal(dirPoidsSons(ctx.home)) : undefined;
    // La transcription : seulement la transcription LOCALE déjà installée (jamais le service en ligne, rien d'installé).
    const ecouter: Ecouter | null = quoi === 'tout' || quoi === 'parole' ? await ecouteurLocal(ctx.voice) : null;
    let r;
    try {
      r = await or.analyserSon({ fichier: f }, { signal: ctx.signal, modele, ecouter, demander: null, sonsSeuls: quoi === 'sons', avecEmpreinte: false, dossierTemp: ctx.home ? join(ctx.home, 'valhalla', 'syrinx', 'tmp') : undefined });
    } catch (e) { return `${path} : ${texteErreur(e)}`; }
    const a = r.analyse;
    if (a.parole.etat === 'pas_prete' && !ecouter) a.parole.raison = 'la transcription locale n\'est pas installée sur ce poste (Réglages → Voix)';
    // Résumé SANS modèle de texte : l'outil n'envoie rien à un modèle (la discussion en fera ce qu'elle veut).
    const sens = quoi === 'tout' ? await comprendreSon(a, null) : undefined;
    return { output: wrapUntrusted(`son ${path}`, rapportSon(a, sens, { quoi }).slice(0, 40_000)), tainted: true };
  },
};

export const AUDIO_TOOLS: Tool[] = [audioAnalyze];
