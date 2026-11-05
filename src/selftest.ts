// « Tout tester » : Odin vérifie, pour de vrai, chaque fonction reliée (modèle, Telegram, mail,
// agenda, Proxmox, Home Assistant, recherche web, mémoire par le sens, sauvegardes, accès extérieur,
// notifications) et dit précisément ce qui marche, ce qui ne marche pas, et quoi faire.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decryptBackup } from './backup.ts';
import type { OdinConfig, OdinPaths } from './config.ts';
import { backupDir } from './guard/watch.ts';
import { makeEmbedder } from './muninn/embed.ts';
import { listSubscriptions } from './push/webpush.ts';
import type { Router } from './providers/router.ts';
import { haApi } from './tools/homeassistant.ts';
import { pveApi } from './tools/proxmox.ts';
import { webSearch } from './tools/search.ts';
import { lanRequest } from './tools/lan.ts';
import { tunnel } from './web/tunnel.ts';

export interface Check { name: string; ok: boolean | null; detail: string; fix?: string }

const time = async <T>(f: () => Promise<T>, ms = 30_000): Promise<T> => Promise.race([f(), new Promise<T>((_, rej) => setTimeout(() => rej(new Error('trop long (plus de 30 s)')), ms))]);

export async function selfTest(o: { cfg: OdinConfig; paths: OdinPaths; router: Router; demo?: boolean; env?: NodeJS.ProcessEnv; only?: string }): Promise<Check[]> {
  const env = o.env ?? process.env, cfg = o.cfg, out: Check[] = [];
  const run = async (name: string, on: boolean, f: () => Promise<string>, fix?: string) => {
    if (o.only && o.only !== name) return;
    if (!on) { out.push({ name, ok: null, detail: 'non relié' }); return; }
    const t0 = Date.now();
    try { out.push({ name, ok: true, detail: `${await time(f)} (${Date.now() - t0} ms)` }); } catch (e) { out.push({ name, ok: false, detail: (e as Error).message.slice(0, 300), fix }); }
  };
  await run('Modèle', !o.demo, async () => {
    const r = await o.router.complete({ system: 'Réponds exactement : OK', messages: [{ role: 'user', content: 'Test : réponds OK.' }], tools: [], maxTokens: 20 }, { purpose: 'test' });
    if (!/ok/i.test(r.text)) throw new Error(`réponse inattendue : ${r.text.slice(0, 80)}`);
    return `${r.providerName} répond`;
  }, 'Réglages → Modèle : vérifie la clé ou la connexion (bouton Tester).');
  await run('Telegram', Boolean(cfg.channels.telegram?.enabled && env.TELEGRAM_BOT_TOKEN), async () => {
    const r = await (await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`, { signal: AbortSignal.timeout(15_000) })).json() as { ok: boolean; result?: { username: string }; description?: string };
    if (!r.ok) throw new Error(r.description ?? 'jeton refusé');
    return `bot @${r.result?.username}`;
  }, 'Réglages → Telegram : recolle le jeton donné par @BotFather.');
  await run('Recherche web', true, async () => { const r = await webSearch('Mayotte', 3, { provider: cfg.search.provider, searxngUrl: cfg.search.searxngUrl }); return `${r.provider} : ${r.results.length} résultat(s)`; }, 'Réglages → Recherche : ajoute une clé Brave ou une instance SearXNG.');
  await run('Mail', Boolean(cfg.mail.user && env.MAIL_PASSWORD), async () => {
    const { mailList } = await import('./tools/mail.ts');
    const r = await mailList.run({ count: 1 }, { mail: cfg.mail } as never);
    const text = typeof r === 'string' ? r : r.output;
    return /Aucun message|\[\d+\]/.test(text) ? 'connexion IMAP réussie' : text.slice(0, 120);
  }, 'Réglages → Mail : serveur, adresse et mot de passe d\'application (pas ton mot de passe habituel).');
  await run('Agenda', Boolean(env.CALENDAR_ICS_URL), async () => {
    const { calendarList } = await import('./tools/calendar.ts');
    const r = await calendarList.run({ days: 7 }, {} as never);
    const text = typeof r === 'string' ? r : r.output;
    if (/HTTP \d{3}/.test(text)) throw new Error(text);
    return `${(text.match(/\n·|·/g) ?? []).length ? 'rendez-vous lus' : 'agenda lu (rien cette semaine)'}`;
  }, 'Réglages → Agenda : recolle l\'adresse iCal secrète.');
  await run('Proxmox', Boolean(cfg.proxmox.url && env.PROXMOX_TOKEN), async () => { const r = await pveApi(cfg.proxmox.url, env.PROXMOX_TOKEN!, 'GET', '/cluster/resources') as Array<{ type: string }>; return `${r.filter((x) => x.type === 'qemu' || x.type === 'lxc').length} VM / conteneur(s)`; }, 'Réglages → Proxmox : adresse https://IP:8006 et jeton avec les droits PVEVMAdmin.');
  await run('Home Assistant', Boolean(cfg.homeAssistant.url && env.HA_TOKEN), async () => `${(await haApi(cfg.homeAssistant.url, env.HA_TOKEN!, 'GET', '/states') as unknown[]).length} entités`, 'Réglages → Maison : jeton longue durée.');
  const emb = makeEmbedder(cfg);
  await run('Mémoire par le sens', Boolean(emb), async () => `${(await emb!.embed('test')).length} dimensions`, 'Sur la machine d\'Ollama : « ollama pull nomic-embed-text ».');
  await run('Sauvegardes', cfg.autoBackup.enabled, async () => {
    const dir = backupDir(o.paths, cfg.autoBackup);
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.odinbk')).sort() : [];
    if (!files.length) throw new Error('aucune sauvegarde encore (la première se fait la nuit, ou « Sauvegarder maintenant »)');
    const pw = readFileSync(join(o.paths.home, 'backup-pass'), 'utf8');
    decryptBackup(readFileSync(join(dir, files.at(-1)!)), pw);
    return `dernière (${files.at(-1)}) déchiffrable : restauration possible`;
  }, 'Réglages → Sauvegarde : refais une sauvegarde ; vérifie le mot de passe.');
  await run('Accès extérieur', (cfg.tunnel?.kind ?? 'none') !== 'none', async () => {
    if (!tunnel.state.running || !tunnel.state.url) throw new Error(tunnel.state.error ?? 'tunnel arrêté');
    const r = await lanRequest(`${tunnel.state.url.replace(/\/$/, '')}/health`, { timeoutMs: 15_000 });
    if (r.status !== 200) throw new Error(`l'adresse répond ${r.status}`);
    return `${tunnel.state.url} répond`;
  }, 'Réglages → Accès : réactive le tunnel ; pour Tailscale, « sudo tailscale up » sur la machine.');
  await run('Notifications push', true, async () => `${listSubscriptions(o.paths.home).length} appareil(s) abonné(s)${listSubscriptions(o.paths.home).length ? '' : ' — Accueil → Application → Activer les notifications'}`);
  return out;
}

export const formatChecks = (cs: Check[]) => cs.map((c) => `${c.ok === null ? '⚪' : c.ok ? '✅' : '❌'} ${c.name} : ${c.detail}${c.fix && !c.ok ? `\n   → ${c.fix}` : ''}`).join('\n');
