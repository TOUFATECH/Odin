// Recherche par le sens dans la mémoire : un petit modèle d'« embeddings » LOCAL (Ollama,
// nomic-embed-text par défaut, gratuit) transforme chaque souvenir en vecteur. Odin retrouve alors
// « mon serveur de fichiers » même si le souvenir parle du « NAS ». Facultatif : sans lui, la
// recherche par mots (avec accents et préfixes) reste active.

import type { OdinConfig } from '../config.ts';

export interface Embedder { model: string; embed(text: string, signal?: AbortSignal): Promise<Float32Array> }

/** Adresse d'Ollama : celle des réglages, sinon celle d'un fournisseur Ollama déjà configuré. */
export function embedUrl(cfg: OdinConfig): string {
  if (cfg.memory?.embedUrl) return cfg.memory.embedUrl.replace(/\/$/, '');
  const p = cfg.providers.find((x) => /:11434/.test(x.baseUrl ?? ''));
  return p?.baseUrl ? p.baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '') : '';
}

export function makeEmbedder(cfg: OdinConfig, fetcher: typeof fetch = fetch): Embedder | undefined {
  const url = embedUrl(cfg), model = cfg.memory?.embedModel || 'nomic-embed-text';
  if (!url || cfg.memory?.semantic === false) return undefined;
  return {
    model,
    async embed(text, signal) {
      const r = await fetcher(`${url}/api/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, prompt: text.slice(0, 2000) }), signal: signal ?? AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`embeddings : HTTP ${r.status} (« ollama pull ${model} » sur la machine d'Ollama ?)`);
      const d = await r.json() as { embedding?: number[] };
      if (!d.embedding?.length) throw new Error('embeddings : réponse vide');
      return Float32Array.from(d.embedding);
    },
  };
}
