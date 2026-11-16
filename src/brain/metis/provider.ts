// Fournisseur de modèle « Métis » : fait tourner un modèle ouvert (GGUF) DANS Odin, sans serveur réglé par adresse.
// Il s'insère comme n'importe quel fournisseur (interface Provider de src/types.ts) : palier local, gratuit, privé.
//
// Honnêteté sur les outils : Métis répond en TEXTE. L'appel d'outils par le modèle n'est branché que si un gabarit
// fiable est écrit pour la famille ; tant que ce n'est pas le cas, les outils demandés sont ignorés et la réponse le
// DIT, plutôt que d'inventer un appel. On ne promet jamais ce qu'on n'a pas vérifié.

import type { Provider, CompletionRequest, ModelResponse, Message } from '../../types.ts';
import type { ModeleGguf } from './types.ts';
import { generer } from './moteur.ts';

/** Construit l'invite texte à partir du système et des messages, selon le gabarit de discussion du modèle. */
export function construireInvite(systeme: string, messages: Message[], gabarit?: string): string {
  const roleFr = (r: Message['role']): string => (r === 'user' ? 'Utilisateur' : r === 'assistant' ? 'Assistant' : 'Outil');
  // Gabarit « ChatML » (qwen, phi, beaucoup de modèles récents) : repéré par ses balises.
  if (gabarit && gabarit.includes('<|im_start|>')) {
    let s = '';
    if (systeme) s += `<|im_start|>system\n${systeme}<|im_end|>\n`;
    for (const m of messages) {
      const r = m.role === 'assistant' ? 'assistant' : m.role === 'tool' ? 'tool' : 'user';
      s += `<|im_start|>${r}\n${m.content}<|im_end|>\n`;
    }
    s += '<|im_start|>assistant\n';
    return s;
  }
  // Gabarit « [INST] » (llama 2 / mistral).
  if (gabarit && gabarit.includes('[INST]')) {
    let s = '';
    const sys = systeme ? `<<SYS>>\n${systeme}\n<</SYS>>\n\n` : '';
    let first = true;
    for (const m of messages) {
      if (m.role === 'user' || m.role === 'tool') { s += `[INST] ${first ? sys : ''}${m.content} [/INST]`; first = false; }
      else if (m.role === 'assistant') s += ` ${m.content} `;
    }
    return s;
  }
  // Repli générique lisible (aucun gabarit connu). Fonctionnel, non spécifique à une famille.
  let s = systeme ? `Système : ${systeme}\n\n` : '';
  for (const m of messages) s += `${roleFr(m.role)} : ${m.content}\n`;
  s += 'Assistant : ';
  return s;
}

export class ProviderMetis implements Provider {
  readonly name: string;
  private ouvrir: () => Promise<ModeleGguf>;
  private nomModele: string;
  private home: string;
  private modele?: ModeleGguf;

  constructor(ouvrir: () => Promise<ModeleGguf>, nomModele: string, home: string) {
    this.ouvrir = ouvrir;
    this.nomModele = nomModele;
    this.home = home;
    this.name = `metis:${nomModele}`;
  }

  private async modeleOuvert(): Promise<ModeleGguf> {
    if (!this.modele) this.modele = await this.ouvrir();
    return this.modele;
  }

  async complete(req: CompletionRequest): Promise<ModelResponse> {
    const modele = await this.modeleOuvert();
    const invite = construireInvite(req.system, req.messages, modele.gabaritDiscussion);
    const amorce = modele.decoupage.encoder(invite);
    const max = Math.max(1, req.maxTokens || 512);
    const r = await generer(modele, {
      amorce,
      maxMorceaux: max,
      signal: req.signal,
      onDelta: req.onDelta,
    });
    // Outils demandés mais non branchés pour cette famille : on le dit, on n'invente rien.
    let texte = r.texte;
    if (req.tools.length > 0) {
      texte += '\n\n(Métis : ce modèle local répond en texte ; l\'appel d\'outils n\'est pas encore branché pour sa famille, aucune action n\'a été déclenchée.)';
    }
    return {
      text: texte,
      toolCalls: [],
      usage: { inputTokens: amorce.length, outputTokens: r.morceaux },
      stopReason: r.morceaux >= max ? 'max_tokens' : 'end',
    };
  }
}
