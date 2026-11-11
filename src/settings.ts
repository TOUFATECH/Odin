// Réglages modifiables après l'installation (interface web, onglet « Réglages »).
//
// - Les clés d'API vont dans ~/.odin/env (droits 600), jamais dans config.json ni dans la page :
//   l'interface ne reçoit que « définie / absente » et les 4 derniers caractères.
// - Seules quelques variables connues peuvent être écrites (liste SECRET_NAMES).
// - Le fichier env est lu par Node au démarrage, sur macOS, Linux ET Windows.

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readSecretFile, writeSecretFile } from './vault.ts';
import { join } from 'node:path';
import type { OdinConfig, OdinPaths, ProviderConfig } from './config.ts';
import { setConfigValue } from './config.ts';
import { CODEX_MODELS, loadCodexAuth } from './providers/codex.ts';
import { TTS_DEFAULTS } from './voice/voice.ts';
import { buildProvider, Router, strengthsOf, tierOf, visionOf, type Tier } from './providers/router.ts';
import { providerLabel, serviceOf } from './providers/journal.ts';

export const SECRET_NAMES = ['ABUSE_CH_KEY', 'VT_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'MOONSHOT_API_KEY', 'TELEGRAM_BOT_TOKEN', 'JEV_API_KEY', 'ELEVENLABS_API_KEY', 'BRAVE_API_KEY', 'TAVILY_API_KEY', 'EXA_API_KEY', 'GOOGLE_CSE_KEY', 'GOOGLE_CSE_CX', 'PROXMOX_TOKEN', 'HA_TOKEN', 'MAIL_PASSWORD', 'CALDAV_PASSWORD', 'CALENDAR_ICS_URL', 'DISCORD_BOT_TOKEN', 'SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'WHATSAPP_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'VENUS_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'NOTION_TOKEN', 'GITHUB_TOKEN', 'VERCEL_TOKEN', 'CLOUDFLARE_API_TOKEN', 'MQTT_PASSWORD', 'BRISINGAMEN_KEY', 'SINDRI_PASSWORD', 'TASMOTA_PASSWORD'] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

export const envFile = (paths: OdinPaths) => join(paths.home, 'env');

/** Lit ~/.odin/env (KEY=valeur, « export » et guillemets tolérés) sans écraser l'environnement existant. */
export function loadEnvFile(paths: OdinPaths, env: NodeJS.ProcessEnv = process.env): void {
  const text = readSecretFile(envFile(paths));
  if (text === undefined) return;
  for (const [k, v] of parseEnv(text.replace(/^\uFEFF/, ''))) if (env[k] === undefined) env[k] = v;
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
  // Identifiants des automatisations (Draupnir) : DRAUPNIR_NOM, choisis par le propriétaire.
  if (!(SECRET_NAMES as readonly string[]).includes(name) && !/^(DRAUPNIR|PROXMOX_TOKEN|CAMERA|MCP)_[A-Z0-9_]{2,40}$/.test(name)) throw new Error(`variable non autorisée : ${name}`);
  const v = value.trim();
  if (v.length > 400 || /[\s"'`$\\]/.test(v)) throw new Error('valeur invalide (espaces, guillemets ou caractères spéciaux refusés)');
  const f = envFile(paths);
  const lines = (readSecretFile(f) ?? '').split(/\r?\n/).filter((l) => l.trim() && !new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(l));
  if (v) lines.push(`${name}=${v}`);
  writeSecretFile(f, lines.length ? `${lines.join('\n')}\n` : '');
  if (v) env[name] = v; else delete env[name];
}

/** Ce que l'interface a le droit de voir d'une clé : présente ou non, et sa fin. */
export function secretHint(name: string, env: NodeJS.ProcessEnv = process.env): { set: boolean; hint: string } {
  const v = env[name] ?? '';
  return { set: Boolean(v), hint: v.length >= 12 ? `…${v.slice(-4)}` : v ? '…' : '' };
}

// ---------------------------------------------------------------- Modèle

export type ModelPreset = 'anthropic' | 'openrouter' | 'openai' | 'openai-codex' | 'deepseek' | 'kimi' | 'ollama' | 'custom';

export const PRESETS: Record<Exclude<ModelPreset, 'custom'>, { label: string; model: string; baseUrl?: string; keyEnv?: SecretName; kind: 'anthropic' | 'openai' | 'openai-codex'; price?: [number, number]; models?: string[]; note?: string }> = {
  anthropic: { label: 'Anthropic (Claude)', kind: 'anthropic', model: 'claude-sonnet-5-5', keyEnv: 'ANTHROPIC_API_KEY', price: [3, 15] },
  openrouter: { label: 'OpenRouter (tous les modèles)', kind: 'openai', model: 'anthropic/claude-sonnet-5.5', baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY' },
  openai: { label: 'OpenAI', kind: 'openai', model: 'gpt-5', baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY' },
  'openai-codex': { label: 'OpenAI Codex (abonnement ChatGPT)', kind: 'openai-codex', model: 'gpt-6-luna' },
  // IA chinoises, par leurs API officielles (compatibles OpenAI). Prix indicatifs en $ par million de jetons.
  deepseek: { label: 'DeepSeek', kind: 'openai', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1', keyEnv: 'DEEPSEEK_API_KEY', price: [0.15, 0.6], models: ['deepseek-flash', 'deepseek-v4-pro'],
    note: 'Clé sur platform.deepseek.com. Très économique, bon en code et en raisonnement. Données traitées en Chine : coche « pas de données personnelles » si tu préfères.' },
  kimi: { label: 'Kimi (Moonshot)', kind: 'openai', model: 'kimi-k2.6', baseUrl: 'https://api.moonshot.ai/v1', keyEnv: 'MOONSHOT_API_KEY', price: [0.95, 4], models: ['kimi-k2.6'],
    note: 'Clé sur platform.kimi.ai. Très long contexte (256 k), bon en code et en tâches à outils. Données traitées en Chine : coche « pas de données personnelles » si tu préfères.' },
  ollama: { label: 'Ollama (local, sans clé)', kind: 'openai', model: 'qwen3:14b', baseUrl: 'http://localhost:11434/v1' },
};

export function detectPreset(p: ProviderConfig | undefined): ModelPreset {
  if (!p) return 'anthropic';
  if (p.kind === 'anthropic') return 'anthropic';
  if (p.kind === 'openai-codex') return 'openai-codex';
  if (p.baseUrl?.includes('openrouter.ai')) return 'openrouter';
  if (p.baseUrl?.includes('deepseek.com')) return 'deepseek';
  if (p.baseUrl && /moonshot\.(ai|cn)|kimi\.ai/.test(p.baseUrl)) return 'kimi';
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
  if (c.preset === 'deepseek' && model === 'deepseek-v4-pro') { out.priceInPerM = 0.66; out.priceOutPerM = 1.98; }
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
export async function testProvider(p: ProviderConfig, timeoutMs = 20_000, env: NodeJS.ProcessEnv = process.env, paths?: OdinPaths): Promise<{ ok: boolean; message: string }> {
  const provider = buildProvider(p, env, paths);
  if (!provider) return { ok: false, message: p.kind === 'openai-codex' ? 'Odin n\'est pas encore connecté à ChatGPT : clique « Se connecter avec ChatGPT »' : p.apiKeyEnv ? `clé ${p.apiKeyEnv} absente` : 'fournisseur non configuré' };
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const r = await new Router([{ provider, cfg: p }], 0).complete({ system: 'Réponds par le seul mot OK.', messages: [{ role: 'user', content: 'Test de connexion.' }], tools: [], maxTokens: 16, signal });
    return { ok: true, message: `${provider.name} répond (${r.text?.trim().slice(0, 40) || 'OK'})` };
  } catch (e) {
    return { ok: false, message: (e as Error).message.replace(/^Tous les fournisseurs ont échoué :\n- /, '').slice(0, 300) };
  }
}

// ---------------------------------------------------------------- Vue d'ensemble

export function settingsView(cfg: OdinConfig, demo: boolean, env: NodeJS.ProcessEnv = process.env, paths?: OdinPaths) {
  const main = cfg.providers[0];
  const cx = paths ? loadCodexAuth(paths) : undefined;
  return {
    demo,
    // Connexion ChatGPT (Codex) : jamais les jetons, seulement l'état.
    codex: { connected: Boolean(cx), email: cx?.email ?? '', plan: cx?.plan ?? '', expiresAt: cx?.expires_at ?? 0, models: CODEX_MODELS },
    model: { preset: detectPreset(main), model: main?.model ?? '', baseUrl: main?.baseUrl ?? '', tier: tierOf(main ?? { kind: 'mock', model: '' }) },
    providers: cfg.providers.map((p, i) => ({ index: i, preset: detectPreset(p), model: p.model, baseUrl: p.baseUrl ?? '', tier: tierOf(p), ready: Boolean(buildProvider(p, env, paths)), label: providerLabel(`${p.kind === 'openai' ? serviceOf(p.baseUrl) : p.kind}:${p.model}`), strengths: strengthsOf(p), vision: visionOf(p), personal: p.personal !== false })),
    routing: { ...cfg.routing, showModel: cfg.routing.showModel ?? 'web' },
    presets: Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, { label: p.label, model: p.model, baseUrl: p.baseUrl ?? '', keyEnv: p.keyEnv ?? '', models: p.models ?? [], note: p.note ?? '' }])),
    secrets: Object.fromEntries(SECRET_NAMES.map((n) => [n, secretHint(n, env)])),
    search: { provider: cfg.search.provider, searxngUrl: cfg.search.searxngUrl },
    assist: { ...{ spelling: 'auto', tips: true, roam: true }, ...(cfg.assist ?? {}) },
    telegram: { enabled: Boolean(cfg.channels.telegram?.enabled), owners: (cfg.channels.telegram?.owners ?? []).map(String) },
    venus: { url: cfg.venus?.url ?? '', key: Boolean(process.env.VENUS_API_KEY) },
    alerts: { enabled: cfg.alerts?.enabled !== false, region: cfg.alerts?.region ?? '' },
    messaging: {
      discord: { enabled: Boolean(cfg.channels.discord?.enabled), owners: (cfg.channels.discord?.owners ?? []).join(', ') },
      slack: { enabled: Boolean(cfg.channels.slack?.enabled), owners: (cfg.channels.slack?.owners ?? []).join(', ') },
      signal: { enabled: Boolean(cfg.channels.signal?.enabled), url: cfg.channels.signal?.url ?? 'http://localhost:8080', number: cfg.channels.signal?.number ?? '', owners: (cfg.channels.signal?.owners ?? []).join(', ') },
      whatsapp: { enabled: Boolean(cfg.channels.whatsapp?.enabled), phoneId: cfg.channels.whatsapp?.phoneId ?? '', owners: (cfg.channels.whatsapp?.owners ?? []).join(', '), webhook: cfg.web.publicUrl ? `${cfg.web.publicUrl.replace(/\/$/, '')}/hook/whatsapp` : '' },
      mail: { enabled: Boolean(cfg.channels.mail?.enabled), owners: (cfg.channels.mail?.owners ?? []).join(', '), tag: cfg.channels.mail?.tag ?? 'odin' },
    },
    network: { enabled: cfg.network.enabled, intervalMin: cfg.network.intervalMin, notify: cfg.network.notify },
    mimir: { enabled: cfg.mimir.enabled, judge: cfg.mimir.judge, autonomy: cfg.mimir.autonomy },
    voice: { enabled: cfg.voice.enabled, speakReplies: cfg.voice.speakReplies, voiceReplies: cfg.voice.voiceReplies, ttsProvider: cfg.voice.tts.provider, ttsUrl: cfg.voice.tts.baseUrl, voiceId: cfg.voice.tts.voiceId, voiceName: cfg.voice.tts.voiceName, gender: cfg.voice.gender ?? 'homme', femaleVoiceId: cfg.voice.femaleVoiceId ?? '', ttsModel: cfg.voice.tts.model, sttUrl: cfg.voice.stt.baseUrl, sttModel: cfg.voice.stt.model, language: cfg.voice.stt.language },
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
    case 'model_personal': {
      // Modèle à qui ne rien confier de privé (maison, mails, réseau, fichiers, mémoire).
      const idx = Number(b.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cfg.providers.length) throw new Error('modèle inconnu');
      setConfigValue(paths, ['providers'], cfg.providers.map((p, i) => { if (i !== idx) return p; const { personal: _, ...rest } = p; return b.personal === false ? { ...rest, personal: false } : rest; }));
      return true;
    }
    case 'model_move': {
      // Remonter un modèle dans la liste (le premier est celui par défaut, à palier égal).
      const idx = Number(b.index), list = [...cfg.providers];
      if (!Number.isInteger(idx) || idx <= 0 || idx >= list.length) throw new Error('modèle inconnu');
      [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]];
      setConfigValue(paths, ['providers'], list);
      return true;
    }
    case 'routing': {
      setConfigValue(paths, ['routing'], {
        showModel: ['web', 'partout', 'jamais'].includes(String(b.showModel)) ? String(b.showModel) : (cfg.routing.showModel ?? 'web'),
        preferLocal: Boolean(b.preferLocal), strongForComplex: Boolean(b.strongForComplex), crossCheckRisky: Boolean(b.crossCheckRisky),
        quotaPauseMin: Math.min(240, Math.max(1, Math.round(Number(b.quotaPauseMin ?? cfg.routing.quotaPauseMin)) || 15)),
        monthlyBudgetUsd: Math.max(0, Number(b.monthlyBudgetUsd ?? cfg.routing.monthlyBudgetUsd ?? 0) || 0),
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
    case 'venus': {
      const url = String(b.url ?? '').trim().replace(/\/$/, '');
      if (url && !/^https?:\/\/[\w.-]+(:\d+)?$/.test(url)) throw new Error('adresse de Venus : http(s)://adresse:port');
      if (typeof b.key === 'string' && b.key.trim()) writeSecret(paths, 'VENUS_API_KEY', b.key.trim());
      setConfigValue(paths, ['venus'], { url }); cfg.venus = { url };
      return false;
    }
    case 'alerts': {
      const v = { enabled: Boolean(b.enabled), region: String(b.region ?? '').trim().slice(0, 80) };
      setConfigValue(paths, ['alerts'], v); cfg.alerts = v;
      return false;
    }
    case 'update': {
      const auto = String(b.auto);
      if (!['off', 'notify', 'auto'].includes(auto)) throw new Error('choix invalide');
      setConfigValue(paths, ['update'], { auto, everyHours: 6 });
      cfg.update = { auto: auto as 'off' | 'notify' | 'auto', everyHours: 6 }; // pris en compte tout de suite
      return false;
    }
    case 'messaging': {
      // Discord, Slack, Signal, WhatsApp, Mail : un bloc par messagerie ; les jetons vont dans le coffre (env).
      const list = (v: unknown) => String(v ?? '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
      const sec = (k: string, name: SecretName) => { const v = typeof b[k] === 'string' ? (b[k] as string).trim() : ''; if (v) writeSecret(paths, name, v); };
      const kind = String(b.mkind);
      if (kind === 'discord') {
        sec('token', 'DISCORD_BOT_TOKEN');
        const owners = list(b.owners); if (owners.some((o) => !/^\d{15,21}$/.test(o))) throw new Error('identifiants Discord : des nombres (Paramètres → Avancés → Mode développeur → Copier l\'identifiant)');
        if (b.enabled && !process.env.DISCORD_BOT_TOKEN) throw new Error('ajoute d\'abord le jeton du bot Discord');
        setConfigValue(paths, ['channels', 'discord'], { enabled: Boolean(b.enabled), tokenEnv: 'DISCORD_BOT_TOKEN', owners });
      } else if (kind === 'slack') {
        sec('botToken', 'SLACK_BOT_TOKEN'); sec('appToken', 'SLACK_APP_TOKEN');
        const owners = list(b.owners); if (owners.some((o) => !/^[UW][A-Z0-9]{6,}$/.test(o))) throw new Error('identifiants Slack : U… (profil → ⋮ → Copier l\'ID de membre)');
        if (b.enabled && (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_APP_TOKEN)) throw new Error('il faut les deux jetons Slack (xoxb-… et xapp-…)');
        setConfigValue(paths, ['channels', 'slack'], { enabled: Boolean(b.enabled), botTokenEnv: 'SLACK_BOT_TOKEN', appTokenEnv: 'SLACK_APP_TOKEN', owners });
      } else if (kind === 'signal') {
        const owners = list(b.owners), number = String(b.number ?? '').replace(/\s/g, '');
        if ([number, ...owners].some((o) => o && !/^\+\d{6,15}$/.test(o))) throw new Error('numéros Signal au format international : +262639…');
        setConfigValue(paths, ['channels', 'signal'], { enabled: Boolean(b.enabled), url: String(b.url || 'http://localhost:8080').trim(), number, owners });
      } else if (kind === 'whatsapp') {
        sec('token', 'WHATSAPP_TOKEN'); sec('appSecret', 'WHATSAPP_APP_SECRET'); sec('verifyToken', 'WHATSAPP_VERIFY_TOKEN');
        const owners = list(b.owners).map((o) => o.replace(/^\+/, '')); if (owners.some((o) => !/^\d{6,15}$/.test(o))) throw new Error('numéros WhatsApp : chiffres avec l\'indicatif (262639…)');
        if (b.enabled && (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_APP_SECRET)) throw new Error('il faut le jeton d\'accès et la clé secrète de l\'application Meta');
        if (b.enabled && !cfg.web.publicUrl) throw new Error('WhatsApp a besoin d\'une adresse publique pour Odin : Réglages → Accès (tunnel)');
        setConfigValue(paths, ['channels', 'whatsapp'], { enabled: Boolean(b.enabled), phoneId: String(b.phoneId ?? '').trim(), owners });
      } else if (kind === 'mail') {
        const owners = list(b.owners).map((o) => o.toLowerCase()); if (owners.some((o) => !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(o))) throw new Error('adresses mail invalides');
        if (b.enabled && !cfg.mail.imapHost) throw new Error('relie d\'abord la boîte mail (Réglages → Mail)');
        setConfigValue(paths, ['channels', 'mail'], { enabled: Boolean(b.enabled), owners, tag: String(b.tag ?? 'odin').trim().slice(0, 40), everySec: 60 });
      } else throw new Error('messagerie inconnue');
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
      const provider = (str('ttsProvider') ?? v.tts.provider) as typeof v.tts.provider;
      if (!(provider in TTS_DEFAULTS)) throw new Error('synthèse vocale : elevenlabs, piper ou openai');
      const defaults = TTS_DEFAULTS[provider];
      const switched = provider !== v.tts.provider;
      const ttsUrl = str('ttsUrl')?.trim() || (switched ? defaults.baseUrl : v.tts.baseUrl);
      if (!/^https?:\/\//.test(ttsUrl)) throw new Error('adresse du service de synthèse invalide (ex. http://localhost:5000)');
      const voiceId = str('voiceId')?.trim() ?? (switched ? defaults.voiceId : v.tts.voiceId);
      if (voiceId && !/^[A-Za-z0-9_.-]{1,80}$/.test(voiceId)) throw new Error('nom de voix invalide');
      const gender = (str('gender') ?? v.gender ?? 'homme') === 'femme' ? 'femme' : 'homme';
      const femaleVoiceId = (str('femaleVoiceId') ?? v.femaleVoiceId ?? '').trim();
      if (femaleVoiceId && !/^[A-Za-z0-9_.-]{1,80}$/.test(femaleVoiceId)) throw new Error('nom de voix de femme invalide');
      setConfigValue(paths, ['voice'], {
        ...v,
        gender, femaleVoiceId,
        enabled: Boolean(b.enabled), speakReplies: Boolean(b.speakReplies), speakRepliesChosen: true, voiceReplies: b.voiceReplies === undefined ? v.voiceReplies : Boolean(b.voiceReplies),
        tts: { provider, baseUrl: ttsUrl.replace(/\/$/, ''), apiKeyEnv: defaults.apiKeyEnv, voiceId, voiceName: str('voiceName')?.trim() ?? (switched ? '' : v.tts.voiceName), model: str('ttsModel')?.trim() || (switched ? defaults.model : v.tts.model) },
        stt: { ...v.stt, baseUrl: sttUrl.replace(/\/$/, ''), model: str('sttModel')?.trim() || v.stt.model, language: lang },
      });
      return true;
    }
    // Le bouton « Voix » de la discussion et de la bulle d'Odin : le même réglage que Réglages → Voix
    case 'speak': {
      setConfigValue(paths, ['voice', 'speakReplies'], Boolean(b.on));
      setConfigValue(paths, ['voice', 'speakRepliesChosen'], true);
      cfg.voice.speakReplies = Boolean(b.on); cfg.voice.speakRepliesChosen = true;
      return false; // rien à redémarrer
    }
    case 'search': {
      const provider = String(b.provider ?? 'auto');
      if (!['auto', 'duckduckgo', 'brave', 'tavily', 'searxng', 'exa', 'google'].includes(provider)) throw new Error('moteur inconnu');
      const url = str('searxngUrl')?.trim() ?? cfg.search.searxngUrl;
      if (url && !/^https?:\/\//.test(url)) throw new Error('adresse SearXNG invalide (ex. http://192.168.1.20:8080)');
      if (str('braveKey')) writeSecret(paths, 'BRAVE_API_KEY', str('braveKey')!);
      if (str('tavilyKey')) writeSecret(paths, 'TAVILY_API_KEY', str('tavilyKey')!);
      if (str('exaKey')) writeSecret(paths, 'EXA_API_KEY', str('exaKey')!);
      if (str('googleKey')) writeSecret(paths, 'GOOGLE_CSE_KEY', str('googleKey')!);
      if (str('googleCx')) writeSecret(paths, 'GOOGLE_CSE_CX', str('googleCx')!);
      setConfigValue(paths, ['search'], { provider, searxngUrl: url.replace(/\/$/, '') });
      return true;
    }
    case 'assist': {
      const spelling = String(b.spelling ?? 'auto');
      if (!['auto', 'ask', 'off'].includes(spelling)) throw new Error('correction : auto, ask ou off');
      setConfigValue(paths, ['assist'], { spelling, tips: b.tips !== false, roam: b.roam !== false });
      return true;
    }
    case 'secret': {
      writeSecret(paths, String(b.name), String(b.value ?? ''));
      return true;
    }
    default: throw new Error('section inconnue');
  }
}
