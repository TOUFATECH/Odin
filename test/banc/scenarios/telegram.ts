// Les alertes d'Odin sur Telegram, de bout en bout : un vrai Odin (passerelle, canal Telegram,
// applis, garde-fous) relié à un serveur Telegram simulé qui parle le même protocole. On vérifie ce
// qui part VRAIMENT sur le réseau : alertes selon leur niveau, photo de caméra, secrets masqués,
// « Ne pas déranger », questions du propriétaire avec et sans IA, accord demandé par boutons.
// L'envoi à un vrai compte Telegram demande ton jeton : il ne peut pas être essayé sur un banc.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Gateway } from '../../../src/bifrost/gateway.ts';
import { TelegramChannel } from '../../../src/bifrost/channels/telegram.ts';
import type { CompletionRequest, ModelResponse } from '../../../src/types.ts';
import { coreModules, startValhalla, valhallaOf } from '../../../src/valhalla/odin.ts';
import { frigg } from '../../../src/valhalla/modules/frigg.ts';
import { himinbjorg } from '../../../src/valhalla/modules/himinbjorg.ts';
import { call, makeOdin } from '../../helpers.ts';
import { telegramSim } from '../sim/telegram.ts';
import { until, wait, type Scenario } from '../lib.ts';

const OWNER = 42;
// Plus petit JPEG valide (1×1) : la « photo » d'une caméra.
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=', 'base64');

export const telegram: Scenario = {
  id: 'telegram', title: 'Alertes d\'Odin ↔ Telegram', mode: 'simulé',
  what: 'Un vrai Odin relié à un serveur Telegram simulé (même protocole) : alertes par niveau, photo, secrets masqués, « Ne pas déranger », questions avec et sans IA, accord par boutons.',
  async run(t) {
    const tg = await telegramSim(); t.onEnd(() => tg.close());
    const env = { BANC_API_TOKEN: process.env.BANC_API_TOKEN, MQTT_PASSWORD: process.env.MQTT_PASSWORD, BRISINGAMEN_KEY: process.env.BRISINGAMEN_KEY };
    t.onEnd(() => { for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
    process.env.BANC_API_TOKEN = 'cle-tres-secrete-123456';

    // Le « cerveau » : une IA simulée qui se sert de l'outil des applis, ou plus d'Internet du tout.
    let brain: 'ia' | 'coupé' = 'ia', toolAsk: Record<string, unknown> = { action: 'alertes' };
    const script = (req: CompletionRequest): Partial<ModelResponse> => {
      if (brain === 'coupé') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
      const last = req.messages.at(-1);
      if (last?.role === 'tool' || (Array.isArray((last as { toolResults?: unknown[] } | undefined)?.toolResults))) return { text: `Voici ce que disent tes applis :\n${String(last?.content ?? '').slice(0, 600)}` };
      return call('valhalla', toolAsk);
    };
    const o = makeOdin(script);
    t.onEnd(() => o.cleanup());
    const gw = new Gateway(o, { owners: { telegram: [String(OWNER)] } });
    gw.add(new TelegramChannel(tg.token, tg.url, { owner: String(OWNER), progress: false, home: o.paths.home }));
    await gw.start(); t.onEnd(() => gw.stop());
    const stop = startValhalla(o, (text, opts) => gw.notifyOwner(text, opts), { modules: [...coreModules(o), frigg, himinbjorg] });
    t.onEnd(stop);
    const v = valhallaOf()!;
    const sentTo = (chat: number) => tg.sent.filter((m) => m.chat_id === String(chat));
    const lastText = () => { const m = sentTo(OWNER).at(-1); return m?.text ?? m?.caption ?? ''; };

    t.ok(await until(() => tg.calls.some((c) => c.method === 'getMe') && tg.calls.some((c) => c.method === 'getUpdates'), 5000), 'Odin se connecte au serveur Telegram (getMe) et écoute les messages (getUpdates)');
    const bad = new TelegramChannel('123:jeton-faux', tg.url);
    t.ok(await bad.start(async () => {}).then(() => false, (e: Error) => /invalide/.test(e.message)), 'jeton de bot refusé : erreur claire au démarrage');

    // Alertes selon leur niveau (réglage par défaut : à partir de « haute »).
    v.alert('frigg', { level: 'info', title: 'Petite information' }); v.alert('frigg', { level: 'moyenne', title: 'Alerte moyenne' });
    await wait(300);
    t.ok(sentTo(OWNER).length === 0, 'alertes « info » et « moyenne » : rien n\'est envoyé (seuil : haute)', JSON.stringify(tg.sent.map((m) => m.text)));
    v.alert('frigg', { level: 'haute', title: 'Sauvegarde échouée', detail: 'Le disque de sauvegarde ne répond plus.' });
    t.ok(await until(() => /🟠 Chronos — Sauvegarde échouée\nLe disque de sauvegarde ne répond plus\./.test(lastText()), 4000), 'alerte « haute » : message envoyé à ton compte, avec l\'appli et le détail', lastText());
    t.eq(sentTo(OWNER).at(-1)?.method, 'sendMessage', '(par sendMessage, vers ton identifiant seulement)');

    // Photo d'une caméra jointe à l'alerte.
    const photo = join(o.paths.home, 'portail.jpg'); writeFileSync(photo, JPEG);
    v.alert('himinbjorg', { level: 'haute', title: 'Mouvement : Portail', detail: '32 % de l\'image a changé', photo });
    t.ok(await until(() => sentTo(OWNER).at(-1)?.method === 'sendPhoto', 4000), 'alerte de caméra : envoyée comme une photo (sendPhoto)', JSON.stringify(sentTo(OWNER).at(-1)?.method));
    const ph = sentTo(OWNER).at(-1);
    t.ok(ph?.file?.data.equals(JPEG) && /image\/jpeg/.test(ph.file.type) && /Cyclope — Mouvement : Portail/.test(ph.caption ?? ''), 'la photo arrive entière, avec la légende de l\'alerte', `${ph?.file?.data.length} octets, ${ph?.caption}`);

    // Un message d'une appli (réservation Chronos).
    v.ctx('frigg').saveSettings({ services: [{ name: 'Coupe', minutes: 30 }], hours: { 0: '8:00-20:00', 1: '8:00-20:00', 2: '8:00-20:00', 3: '8:00-20:00', 4: '8:00-20:00', 5: '8:00-20:00', 6: '8:00-20:00' } });
    const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const book = await v.act('frigg', 'reserver', { service: 'Coupe', jour: day, heure: '10:00', nom: 'Ali', contact: '0639 00 00 00' });
    t.ok(book.ok && await until(() => /📅 Rendez-vous : Ali · Coupe/.test(lastText()), 4000), 'une réservation Chronos te prévient sur Telegram', `${book.text} | ${lastText()}`);

    // Secrets : jamais en clair sur la messagerie.
    v.alert('frigg', { level: 'haute', title: 'Erreur du service', detail: 'Réponse : accès refusé avec cle-tres-secrete-123456' });
    t.ok(await until(() => /Erreur du service/.test(lastText()), 4000) && !tg.sent.some((m) => (m.text ?? m.caption ?? '').includes('cle-tres-secrete-123456')), 'un secret présent dans une alerte est masqué avant l\'envoi', lastText());

    // « Seulement l'urgent » : une alerte haute attend, une critique passe tout de suite.
    o.muninn.setKv('discretion', 'urgent');
    const n = sentTo(OWNER).length;
    v.alert('frigg', { level: 'haute', title: 'Alerte qui peut attendre' });
    await wait(400);
    t.ok(sentTo(OWNER).length === n, 'mode « seulement l\'urgent » : l\'alerte haute est gardée pour plus tard');
    v.alert('himinbjorg', { level: 'critique', title: 'Intrusion détectée' });
    t.ok(await until(() => /🔴 Cyclope — Intrusion détectée/.test(lastText()), 4000), 'une alerte critique passe quand même, tout de suite', lastText());
    t.match(lastText(), /Pendant que tu étais occupé[\s\S]*Alerte qui peut attendre/, 'et ce qui attendait est joint au message');
    o.muninn.setKv('discretion', '');

    // Le propriétaire écrit : avec IA, Odin consulte ses applis et répond.
    tg.say(OWNER, 'Quelles sont les alertes ?');
    t.ok(await until(() => /Voici ce que disent tes applis[\s\S]*Intrusion détectée/.test(lastText()), 10_000), 'question du propriétaire (avec IA) : Odin lit le fil d\'alertes de ses applis et répond', lastText().slice(0, 300));
    // Un inconnu écrit : rien ne lui est dit.
    tg.say(99, 'Quelles sont les alertes ?', { first_name: 'Inconnu' });
    await wait(1200);
    t.ok(!sentTo(99).some((m) => /Intrusion|Sauvegarde|alerte/i.test(m.text ?? '')), 'un inconnu qui écrit au bot n\'apprend rien', JSON.stringify(sentTo(99).map((m) => m.text)));

    // Action grave : l'accord est demandé par des boutons sous le message.
    const rdv = (v.ctx('frigg').settings.bookings as Array<{ id: string }>)[0].id;
    toolAsk = { action: 'action', appli: 'frigg', quoi: 'annuler', entree: JSON.stringify({ id: rdv }) };
    tg.say(OWNER, 'Annule le rendez-vous d\'Ali');
    const asked = await until(() => sentTo(OWNER).some((m) => JSON.stringify(m.reply_markup ?? '').includes('ok:yes:')), 10_000);
    const ask = sentTo(OWNER).filter((m) => JSON.stringify(m.reply_markup ?? '').includes('ok:yes:')).at(-1);
    t.ok(asked && /annuler le rendez-vous/i.test(ask?.text ?? ''), 'action grave (annuler un rendez-vous) : Odin demande ton accord avec des boutons Oui / Non', ask?.text);
    t.ok((v.ctx('frigg').settings.bookings as Array<{ status: string }>)[0].status === 'confirmé', 'tant que tu n\'as pas répondu, rien n\'est fait');
    const yes = /"callback_data":"(ok:yes:[^"]+)"/.exec(JSON.stringify(ask?.reply_markup))?.[1] ?? '';
    tg.press(OWNER, yes);
    t.ok(await until(() => (v.ctx('frigg').settings.bookings as Array<{ status: string }>)[0].status === 'annulé', 10_000), 'tu appuies sur « Oui » : le rendez-vous est annulé');

    // Sans IA (plus d'Internet) : Odin choisit quand même l'appli et explique.
    brain = 'coupé';
    tg.say(OWNER, 'j\'ai besoin de prendre rendez-vous pour une coupe');
    t.ok(await until(() => /Chronos/.test(lastText()) && /rendez-vous/i.test(lastText()), 12_000), 'sans IA : « j\'ai besoin de… » → Odin choisit Chronos et explique', lastText().slice(0, 300));
    t.ok(existsSync(join(o.paths.home, 'valhalla', 'alertes.jsonl')) && readFileSync(join(o.paths.home, 'valhalla', 'alertes.jsonl'), 'utf8').split('\n').filter(Boolean).length >= 6, 'toutes les alertes (même non envoyées) sont gardées dans le fil commun');
  },
};
