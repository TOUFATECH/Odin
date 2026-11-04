// Réglages modifiables après l'installation (interface web, onglet « Réglages »).
//
// - Les clés d'API vont dans ~/.odin/env (droits 600), jamais dans config.json ni dans la page :
//   l'interface ne reçoit que « définie / absente » et les 4 derniers caractères.
// - Seules quelques variables connues peuvent être écrites (liste SECRET_NAMES).
// - Le fichier env est lu par Node au démarrage, sur macOS, Linux ET Windows.

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OdinConfig, OdinPaths, ProviderConfig } from './config.ts';
import { setConfigValue } from './config.ts';
import { buildProvider, Router, tierOf, type Tier } from './providers/router.ts';

export const SECRET_NAMES = ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'TELEGRAM_BOT_TOKEN', 'JEV_API_KEY', 'ELEVENLABS_API_KEY'] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

export const envFile = (paths: OdinPaths) => join(paths.home, 'env');

/** Lit ~/.odin/env (KEY=valeur, « export » et guillemets tolérés) sans écraser l'environnement existant. */
export function loadEnvFile(paths: OdinPaths, env: NodeJS.ProcessEnv = process.env): void {
  const f = envFile(paths);
  if (!existsSync(f)) return;
  for (const [k, v] of parseEnv(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''))) if (env[k] === undefined) env[k] = v;
}

function parseEnv(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    out.push([m[1], m[2].replace(/^(['"])(.*)\1$/, '$2')]);
  }
  return out;
}

/** Enregistre (ou efface si vide) une clé dans ~/.odin/env et dans l'environnement du processus. */
export function writeSecret(paths: OdinPaths, name: string, value: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!(SECRET_NAMES as readonly string[]).includes(name)) throw new Error(`variable non autorisée : ${name}`);
  const v = value.trim();
  if (v.length > 400 || /[\s"'`$\\]/.test(v)) throw new Error('valeur invalide (espaces, guillemets ou caractères spéciaux refusés)');
  const f = envFile(paths);
  const lines = existsSync(f) ? readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(l)) : [];
  if (v) lines.push(`${name}=${v}`);
  writeFileSync(f, lines.length ? `${lines.join('\n')}\n` : '', { mode: 0o600 });
  try { chmodSync(f, 0o600); } catch { /* Windows : le profil utilisateur protège le fichier */ }
  if (v) env[name] = v; else delete env[name];
}

/** Ce que l'interface a le droit de voir d'une clé : présente ou non, et sa fin. */
export function secretHint(name: string, env: NodeJS.ProcessEnv = process.env): { set: boolean; hint: string } {
  const v = env[name] ?? '';
  return { set: Boolean(v), hint: v.length >= 12 ? `…${v.slice(-4)}` : v ? '…' : '' };
}

// ---------------------------------------------------------------- Modèle

export type ModelPreset = 'anthropic' | 'openrouter' | 'openai' | 'ollama' | 'custom';

export const PRESETS: Record<Exclude<ModelPreset, 'custom'>, { label: string; model: string; baseUrl?: string; keyEnv?: SecretName; kind: 'anthropic' | 'openai'; price?: [number, number] }> = {
  anthropic: { label: 'Anthropic (Claude)', kind: 'anthropic', model: 'claude-sonnet-5-5', keyEnv: 'ANTHROPIC_API_KEY', price: [3, 15] },
  openrouter: { label: 'OpenRouter (tous les modèles)', kind: 'openai', model: 'anthropic/claude-sonnet-5.5', baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY' },
  openai: { label: 'OpenAI', kind: 'openai', model: 'gpt-5', baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY' },
  ollama: { label: 'Ollama (local, sans clé)', kind: 'openai', model: 'qwen3:14b', baseUrl: 'http://localhost:11434/v1' },
};

export function detectPreset(p: ProviderConfig | undefined): ModelPreset {
  if (!p) return 'anthropic';
  if (p.kind === 'anthropic') return 'anthropic';
  if (p.baseUrl?.includes('openrouter.ai')) return 'openrouter';
  if (p.baseUrl?.includes('api.openai.com')) return 'openai';
  if (p.baseUrl && /localhost|127\.0\.0\.1/.test(p.baseUrl)) return 'ollama';
  return 'custom';
}

export interface ModelChoice { preset: ModelPreset; model: string; baseUrl?: string }

/** Traduit le choix de l'interface en fournisseur pour config.json. */
export function providerFor(c: ModelChoice): ProviderConfig {
  const model = c.model.trim();
  if (!model || model.length > 120 || /\s/.test(model)) throw new Error('nom de modèle invalide');
  if (c.preset === 'custom') {
    const baseUrl = checkUrl(c.baseUrl);
    return { kind: 'openai', model, baseUrl, apiKeyEnv: 'OPENAI_API_KEY' };
  }
  const p = PRESETS[c.preset];
  if (!p) throw new Error('fournisseur inconnu');
  const baseUrl = c.preset === 'ollama' ? checkUrl(c.baseUrl || p.baseUrl) : p.baseUrl;
  const out: ProviderConfig = { kind: p.kind, model, ...(baseUrl ? { baseUrl } : {}), ...(p.keyEnv ? { apiKeyEnv: p.keyEnv } : {}) };
  if (p.price && model === p.model) { out.priceInPerM = p.price[0]; out.priceOutPerM = p.price[1]; }
  return out;
}

function checkUrl(u: string | undefined): string {
  try {
    const url = new URL(String(u ?? ''));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
    return url.toString().replace(/\/$/, '');
  } catch { throw new Error('adresse du service invalide (ex. http://localhost:11434/v1)'); }
}

/** Essaie le modèle avec une toute petite demande : sert au bouton « Tester ». */
export async function testProvider(p: ProviderConfig, timeoutMs = 20_000, env: NodeJS.ProcessEnv = process.env): Promise<{ ok: boolean; message: string }> {
  const provider = buildProvider(p, env);
  if (!provider) return { ok: false, message: p.apiKeyEnv ? `clé ${p.apiKeyEnv} absente` : 'fournisseur non configuré' };
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const r = await new Router([{ provider, cfg: p }], 0).complete({ system: 'Réponds par le seul mot OK.', messages: [{ role: 'user', content: 'Test de connexion.' }], tools: [], maxTokens: 16, signal });
    return { ok: true, message: `${provider.name} répond (${r.text?.trim().slice(0, 40) || 'OK'})` };
  } catch (e) {
    return { ok: false, message: (e as Error).message.replace(/^Tous les fournisseurs ont échoué :\n- /, '').slice(0, 300) };
  }
}

// ---------------------------------------------------------------- Vue d'ensemble

export function settingsView(cfg: OdinConfig, demo: boolean, env: NodeJS.ProcessEnv = process.env) {
  const main = cfg.providers[0];
  return {
    demo,
    model: { preset: detectPreset(main), model: main?.model ?? '', baseUrl: main?.baseUrl ?? '', tier: tierOf(main ?? { kind: 'mock', model: '' }) },
    providers: cfg.providers.map((p, i) => ({ index: i, preset: detectPreset(p), model: p.model, baseUrl: p.baseUrl ?? '', tier: tierOf(p), ready: Boolean(buildProvider(p, env)) })),
    routing: cfg.routing,
    presets: Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, { label: p.label, model: p.model, baseUrl: p.baseUrl ?? '', keyEnv: p.keyEnv ?? '' }])),
    secrets: Object.fromEntries(SECRET_NAMES.map((n) => [n, secretHint(n, env)])),
    telegram: { enabled: Boolean(cfg.channels.telegram?.enabled), owners: (cfg.channels.telegram?.owners ?? []).map(String) },
    network: { enabled: cfg.network.enabled, intervalMin: cfg.network.intervalMin, notify: cfg.network.notify },
    mimir: { enabled: cfg.mimir.enabled, judge: cfg.mimir.judge, autonomy: cfg.mimir.autonomy },
    voice: { enabled: cfg.voice.enabled, speakReplies: cfg.voice.speakReplies, voiceReplies: cfg.voice.voiceReplies, voiceId: cfg.voice.tts.voiceId, voiceName: cfg.voice.tts.voiceName, ttsModel: cfg.voice.tts.model, sttUrl: cfg.voice.stt.baseUrl, sttModel: cfg.voice.stt.model, language: cfg.voice.stt.language },
    web: { port: cfg.web.port, access: cfg.web.access, https: cfg.web.tls.enabled, cert: cfg.web.tls.cert, key: cfg.web.tls.key, behindProxy: cfg.web.behindProxy, publicUrl: cfg.web.publicUrl, networks: cfg.web.allowedNetworks.join(', ') },
  };
}

/** Bloc « web » tel qu'écrit dans config.json (pour ne rien perdre en le réécrivant). */
function readWeb(paths: OdinPaths): Record<string, unknown> {
  try { return (JSON.parse(readFileSync(paths.config, 'utf8')) as { web?: Record<string, unknown> }).web ?? {}; } catch { return {}; }
}

/** Applique un bloc de réglages ; renvoie true si Odin doit redémarrer ses services. */
export function applySettings(paths: OdinPaths, cfg: OdinConfig, section: string, b: Record<string, unknown>): boolean {
  const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : undefined);
  const saveKey = (name: string | undefined) => { const v = str('apiKey'); if (name && v !== undefined && v !== '') writeSecret(paths, name, v); };
  switch (section) {
    case 'model': {
      const p = providerFor({ preset: String(b.preset) as ModelPreset, model: String(b.model ?? ''), baseUrl: str('baseUrl') });
      if (['local', 'standard', 'strong'].includes(String(b.tier))) p.tier = String(b.tier) as Tier;
      saveKey(p.apiKeyEnv);
      const same = (x: ProviderConfig) => x.kind === p.kind && x.model === p.model && (x.baseUrl ?? '') === (p.baseUrl ?? '');
      if (b.asBackup) {
        // Ajouté comme modèle de secours (ou de palier différent), le principal ne change pas.
        const list = [...cfg.providers.filter((x) => !same(x)), p];
        if (list.length > 6) throw new Error('6 modèles au plus : retire-en un d\'abord');
        setConfigValue(paths, ['providers'], list);
      } else {
        // Le choix devient le fournisseur par défaut ; les autres restent en secours.
        setConfigValue(paths, ['providers'], [p, ...cfg.providers.filter((x) => !same(x))].slice(0, 6));
      }
      return true;
    }
    case 'model_remove': {
      const idx = Number(b.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cfg.providers.length) throw new Error('modèle inconnu');
      if (cfg.providers.length === 1) throw new Error('garde au moins un modèle');
      setConfigValue(paths, ['providers'], cfg.providers.filter((_, i) => i !== idx));
      return true;
    }
    case 'routing': {
      setConfigValue(paths, ['routing'], {
        preferLocal: Boolean(b.preferLocal), strongForComplex: Boolean(b.strongForComplex), crossCheckRisky: Boolean(b.crossCheckRisky),
        quotaPauseMin: Math.min(240, Math.max(1, Math.round(Number(b.quotaPauseMin ?? cfg.routing.quotaPauseMin)) || 15)),
      });
      return true;
    }
    case 'telegram': {
      const token = str('token');
      if (token) {
        if (!/^\d{5,12}:[A-Za-z0-9_-]{30,}$/.test(token.trim())) throw new Error('jeton Telegram invalide (format 123456789:ABC…)');
        writeSecret(paths, 'TELEGRAM_BOT_TOKEN', token);
      }
      const owners = String(b.owners ?? '').split(/[\s,;]+/).filter(Boolean);
      if (owners.some((o) => !/^-?\d{1,20}$/.test(o))) throw new Error('identifiants Telegram : des nombres séparés par des virgules');
      const enabled = Boolean(b.enabled);
      if (enabled && !process.env.TELEGRAM_BOT_TOKEN) throw new Error('ajoute d\'abord le jeton du bot');
      setConfigValue(paths, ['channels', 'telegram'], { enabled, tokenEnv: 'TELEGRAM_BOT_TOKEN', owners });
      return true;
    }
    case 'network': {
      const interval = Math.round(Number(b.intervalMin ?? cfg.network.intervalMin));
      if (!Number.isFinite(interval) || interval < 5 || interval > 1440) throw new Error('intervalle : entre 5 et 1440 minutes');
      setConfigValue(paths, ['network', 'enabled'], Boolean(b.enabled));
      setConfigValue(paths, ['network', 'intervalMin'], interval);
      setConfigValue(paths, ['network', 'notify'], Boolean(b.notify));
      return true;
    }
    case 'mimir': {
      const judge = String(b.judge ?? cfg.mimir.judge);
      saveKey(judge.includes('jev') || judge === 'auto' ? 'JEV_API_KEY' : undefined);
      setConfigValue(paths, ['mimir', 'judge'], judge);
      return true;
    }
    case 'access': {
      const access = String(b.access);
      if (!['local', 'lan', 'wan'].includes(access)) throw new Error('accès inconnu');
      const port = b.port === undefined || b.port === '' ? cfg.web.port : Math.round(Number(b.port));
      const cert = String(b.cert ?? '').trim(), key = String(b.key ?? '').trim();
      for (const f of [cert, key]) if (f && !existsSync(f)) throw new Error(`fichier introuvable : ${f}`);
      setConfigValue(paths, ['web'], {
        ...readWeb(paths),
        access, port,
        tls: { enabled: access === 'wan' ? true : Boolean(b.https), cert, key },
        behindProxy: access === 'wan' && Boolean(b.behindProxy),
        publicUrl: String(b.publicUrl ?? '').trim(),
        allowedNetworks: String(b.networks ?? '').split(/[\s,;]+/).filter(Boolean),
      });
      return true;
    }
    case 'voice': {
      const v = cfg.voice;
      if (str('elevenKey')) writeSecret(paths, 'ELEVENLABS_API_KEY', str('elevenKey')!);
      if (str('sttKey')) writeSecret(paths, 'OPENAI_API_KEY', str('sttKey')!);
      const sttUrl = str('sttUrl')?.trim() || v.stt.baseUrl;
      if (!/^https?:\/\//.test(sttUrl)) throw new Error('adresse Whisper invalide (ex. https://api.openai.com/v1 ou http://localhost:8000/v1)');
      const lang = (str('language') ?? v.stt.language).trim();
      if (lang && !/^[a-z]{2}$/.test(lang)) throw new Error('langue : un code à deux lettres (fr, en…) ou vide pour la détection automatique');
      setConfigValue(paths, ['voice'], {
        ...v,
        enabled: Boolean(b.enabled), speakReplies: Boolean(b.speakReplies), voiceReplies: b.voiceReplies === undefined ? v.voiceReplies : Boolean(b.voiceReplies),
        tts: { ...v.tts, voiceId: str('voiceId')?.trim() ?? v.tts.voiceId, voiceName: str('voiceName')?.trim() ?? v.tts.voiceName, model: str('ttsModel')?.trim() || v.tts.model },
        stt: { ...v.stt, baseUrl: sttUrl.replace(/\/$/, ''), model: str('sttModel')?.trim() || v.stt.model, language: lang },
      });
      return true;
    }
    case 'secret': {
      writeSecret(paths, String(b.name), String(b.value ?? ''));
      return true;
    }
    default: throw new Error('section inconnue');
  }
}
