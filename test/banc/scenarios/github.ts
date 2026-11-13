// Pharos contre le VRAI GitHub (en ligne) : il lit les versions des projets d'origine, repère une
// nouveauté, la note dans la base « Évolutions » et prévient ; il étudie un lien GitHub et le
// rattache à la bonne appli. L'analyse détaillée par IA est jouée avec une IA simulée (signalée).

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../../../src/config.ts';
import { allModules } from '../../../src/valhalla/odin.ts';
import { kvasir, watched } from '../../../src/valhalla/modules/kvasir.ts';
import type { Scenario } from '../lib.ts';

export const github: Scenario = {
  id: 'github', title: 'Pharos ↔ GitHub', mode: 'réel',
  what: 'Le vrai GitHub : versions des dépôts d\'origine, détection d\'une nouveauté (fiche + message), étude d\'un lien et rattachement à une appli sans doublon.',
  async run(t) {
    const ping = await fetch('https://github.com/n8n-io/n8n/releases.atom', { headers: { 'user-agent': 'odin-banc' }, signal: AbortSignal.timeout(20_000) }).catch(() => undefined);
    if (!ping?.ok) t.skip('GitHub n\'est pas joignable depuis cette machine (pas d\'accès à Internet ?)');
    const home = t.tmp('banc-kvasir-');
    const odin = { paths: { home, workspace: join(home, 'ws') }, cfg: DEFAULT_CONFIG } as never;
    let ia = false;
    const { v, alerts, sent } = t.valhalla(allModules(odin), {
      // IA simulée pour l'étude détaillée d'un dépôt (une vraie IA n'est pas disponible sur le banc).
      ask: async (text) => { if (!ia) throw new Error('pas d\'IA'); return /README du dépôt/.test(text) ? '1. Surveille la disponibilité de sites.\n2. Appli la plus proche : Hygie.\n3. Déjà couvert : mesures de la machine.\n4. Nouveau :\n+ page d\'état publique à partager\n+ surveillance d\'un certificat HTTPS avant expiration' : 'rien d\'utile'; },
    });
    const ctx = v.ctx('kvasir'), list = watched(ctx);
    t.ok(list.length >= 30, `${list.length} dépôts d'origine suivis`);

    // Premier passage : les versions sont mémorisées, sans prévenir.
    const first = await v.act('kvasir', 'verifier');
    const seen = ctx.settings.seen as Record<string, string>, d1 = first.data as { news: unknown[]; checked: number; limited?: string };
    t.ok(first.ok && d1.news.length === 0 && d1.checked >= list.length - 3, 'premier passage : versions lues sur GitHub et mémorisées, sans alerte', first.text);
    t.ok(Object.keys(seen).length >= list.length - 10, `versions réelles mémorisées (ex. ${Object.entries(seen).slice(0, 3).map(([r, tag]) => `${r} ${tag}`).join(', ')})`, JSON.stringify(seen).slice(0, 200));
    const missing = (ctx.settings.missing as string[] | undefined) ?? [];
    t.ok(missing.length === 0, 'tous les dépôts suivis existent bien sur GitHub', `introuvables : ${missing.join(', ')}`);
    if (d1.limited) t.note(`Limite de GitHub atteinte pendant l'essai : ${d1.limited}`);

    // Une nouveauté : on fait croire à Pharos qu'il connaissait une version plus ancienne d'un dépôt réel.
    const target = Object.keys(seen)[0], real = seen[target], mod = v.module(list.find((x) => x.repo === target)!.module)!;
    const et = { ...(ctx.settings.etags as Record<string, string>) }; delete et[`r:${target}`]; delete et[`t:${target}`];
    ctx.saveSettings({ seen: { ...seen, [target]: 'v0.0.0-banc' }, etags: et });
    await kvasir.watch!.run(ctx);
    t.ok(alerts.some((a) => a.module === 'kvasir' && a.title.startsWith(`${target} ${real}`) && a.title.includes(mod.name)), `nouvelle version repérée : ${target} ${real} (pour ${mod.name})`, JSON.stringify(alerts.map((a) => a.title)));
    t.ok(sent.some((x) => /Pharos : 1 nouvelle\(s\) version\(s\)/.test(x) && x.includes(target)), 'message envoyé sur ta messagerie');
    const base = join(home, 'cerveau', 'Bases', 'Évolutions');
    t.ok(existsSync(base) && readdirSync(base).some((f) => f.includes(target.split('/')[1])), 'fiche créée dans la base Papyrus « Évolutions »', existsSync(base) ? readdirSync(base).join(', ') : 'dossier absent');
    const n = alerts.length; await kvasir.watch!.run(ctx);
    t.ok(alerts.length === n, 'la même version n\'est pas annoncée deux fois');
    t.ok(Object.keys(ctx.settings.etags as object).length >= list.length - 6, 'les passages suivants ne demandent que ce qui a changé (réponses « inchangé » de GitHub)');
    t.match(seen['n8n-io/n8n'] ?? '', /^n8n@\d+\.\d+/, `les étiquettes « roulantes » sont ignorées (n8n : ${seen['n8n-io/n8n']}, pas « v1 » ni « stable »)`);
    t.ok(!/\d+b\d+$|rc|beta/i.test(seen['home-assistant/core'] ?? 'x'), `les préversions sont ignorées (Home Assistant : ${seen['home-assistant/core']})`);

    // Étudier un lien GitHub : rattachement par mots-clés (sans IA).
    const kuma = await v.act('kvasir', 'etudier', { lien: 'https://github.com/louislam/uptime-kuma' });
    t.ok(kuma.ok && /Rattaché à \*\*Hygie\*\*/.test(kuma.text) && /mots-clés seulement/.test(kuma.text), 'lien GitHub étudié sans IA : uptime-kuma est rattaché à Hygie', kuma.text.slice(0, 300));
    t.ok(watched(ctx).some((x) => x.repo === 'louislam/uptime-kuma' && x.module === 'eir'), 'le dépôt est maintenant suivi pour Hygie');
    const again = await v.act('kvasir', 'etudier', { lien: 'github.com/louislam/uptime-kuma/' });
    t.match(again.text, /déjà suivi/, 'le même lien une deuxième fois : pas de doublon');
    // Avec IA (simulée) : les fonctions nouvelles vont au carnet de travail.
    ia = true;
    const withIa = await v.act('kvasir', 'etudier', { lien: 'https://github.com/louislam/uptime-kuma' });
    t.ok(withIa.ok && /2 fonction\(s\) nouvelle\(s\)/.test(withIa.text), 'avec IA (simulée) : 2 fonctions nouvelles notées au carnet', withIa.text.slice(-200));
    await v.act('kvasir', 'etudier', { lien: 'https://github.com/louislam/uptime-kuma' });
    t.eq((ctx.settings.ideas as unknown[]).length, 2, 'étudié une fois de plus : le carnet ne contient pas de doublon');
    t.match((await v.act('kvasir', 'carnet')).text, /\[Hygie\] page d'état publique à partager \(louislam\/uptime-kuma\)/, 'le carnet de travail les liste par appli');

    t.match((await v.act('kvasir', 'etudier', { lien: 'https://exemple.fr/pas-github' })).text, /non reconnu/, 'lien qui n\'est pas GitHub : refus clair');
    t.match((await v.act('kvasir', 'etudier', { lien: 'https://github.com/toufatech/ce-depot-n-existe-pas-banc' })).text, /introuvable ou privé/, 'dépôt inexistant : message clair');
  },
};
