// Envoi RÉEL sur Telegram : seulement si tu donnes le jeton de ton bot (TELEGRAM_BOT_TOKEN, celui
// du coffre d'Odin) et ton identifiant de conversation (BANC_TELEGRAM_CHAT). Un seul message
// d'essai est envoyé, à toi. Sans ces deux réglages, le scénario est ignoré (rien n'est envoyé).

import { TelegramChannel } from '../../../src/bifrost/channels/telegram.ts';
import type { Scenario } from '../lib.ts';

export const telegramReel: Scenario = {
  id: 'telegram-reel', title: 'Envoi réel sur Telegram', mode: 'réel',
  what: 'Un message d\'essai envoyé pour de vrai à ton compte Telegram (demande TELEGRAM_BOT_TOKEN et BANC_TELEGRAM_CHAT).',
  async run(t) {
    const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.BANC_TELEGRAM_CHAT;
    if (!token || !chat) t.skip('jeton du bot (TELEGRAM_BOT_TOKEN) ou identifiant de conversation (BANC_TELEGRAM_CHAT) non fournis : rien n\'est envoyé');
    if (!/^-?\d+$/.test(chat!)) t.skip('BANC_TELEGRAM_CHAT doit être ton identifiant numérique Telegram');
    const api = 'https://api.telegram.org';
    const me = await (await fetch(`${api}/bot${token}/getMe`, { signal: AbortSignal.timeout(20_000) })).json() as { ok: boolean; result?: { username: string }; description?: string };
    if (!t.ok(me.ok, 'le jeton du bot est accepté par Telegram', me.description)) return;
    t.note(`Bot : @${me.result?.username}`);
    // Le canal d'Odin, tel qu'il tourne en service (même code que pour les alertes).
    const ch = new TelegramChannel(token!, api, { owner: chat!, progress: false });
    await ch.start(async () => {}); t.onEnd(() => ch.stop());
    await ch.send(chat!, `🧪 Essai du banc d'Odin (${new Date().toLocaleString('fr-FR')}) : si tu lis ce message, les alertes arrivent bien sur ton Telegram.`);
    // Telegram ne permet pas de relire un message envoyé : on vérifie que la conversation existe et accepte les messages du bot.
    const sent = await (await fetch(`${api}/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text: '✅ Deuxième message d\'essai (accusé de réception de Telegram vérifié).', disable_notification: true }), signal: AbortSignal.timeout(20_000) })).json() as { ok: boolean; result?: { message_id: number }; description?: string };
    t.ok(sent.ok && Number(sent.result?.message_id) > 0, 'Telegram confirme la remise du message à ta conversation', sent.description);
  },
};
