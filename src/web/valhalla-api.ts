// API web des applis d'Odin (Valhalla) : catalogue, page d'une appli (vue générique), actions,
// alertes, liens, conseil « j'ai besoin de… ». Plus la page publique de réservation de Frigg (/r/…),
// sans script, sans compte, débit limité.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { advise } from '../tools/valhalla.ts';
import { LINKS, USAGES } from '../valhalla/links.ts';
import { book, publicInfo, publicKey, publicSlots } from '../valhalla/modules/frigg.ts';
import { valhallaOf } from '../valhalla/odin.ts';
import { body, esc, page } from './draupnir-api.ts';

const s = (v: unknown) => String(v ?? '');

export async function valhallaGet(path: string, q: URLSearchParams): Promise<unknown> {
  const v = valhallaOf(); if (!v) return { ok: false, error: 'Les applis d\'Odin ne sont pas démarrées.' };
  switch (path) {
    case '/api/valhalla/catalog': {
      const alerts = v.alerts({ limit: 500 }).filter((a) => !a.ack);
      return { ok: true, modules: v.modules().map((m) => ({ id: m.id, name: m.name, family: m.family, what: m.what, does: m.does, from: m.from, modes: m.modes ?? [], actions: m.actions.map((a) => ({ id: a.id, label: a.label, what: a.what, params: a.params ?? [], read: Boolean(a.read), grave: Boolean(a.grave) })), alerts: alerts.filter((a) => a.module === m.id).length })), links: LINKS, usages: USAGES, level: v.settings().alertLevel ?? 'haute' };
    }
    case '/api/valhalla/view': {
      const m = v.module(s(q.get('id'))); if (!m) return { ok: false, error: 'appli inconnue' };
      try { return { ok: true, id: m.id, name: m.name, family: m.family, what: m.what, view: await m.view(v.ctx(m.id), q), actions: m.actions.map((a) => ({ id: a.id, label: a.label, what: a.what, params: a.params ?? [], read: Boolean(a.read), grave: Boolean(a.grave) })), alerts: v.alerts({ module: m.id, limit: 30 }), links: LINKS.filter((l) => l.from === m.id || l.to === m.id) }; }
      catch (e) { return { ok: false, error: (e as Error).message }; }
    }
    case '/api/valhalla/alerts': return { ok: true, alerts: v.alerts({ module: q.get('module') ?? undefined, q: q.get('q') ?? undefined, limit: Number(q.get('n') ?? 200) }) };
    case '/api/valhalla/advise': return { ok: true, text: advise(v, s(q.get('need'))), found: v.find(s(q.get('need'))).slice(0, 5).map((f) => ({ id: f.m.id, name: f.m.name, score: f.score, action: f.action?.id })) };
    default: return undefined;
  }
}

/**
 * Actions depuis l'interface : la personne qui clique est le propriétaire (jeton web). Une action
 * grave demande une confirmation explicite (`confirm: true`) que l'interface affiche avant d'envoyer.
 */
export async function valhallaPost(path: string, b: Record<string, unknown>): Promise<unknown> {
  const v = valhallaOf(); if (!v) return { ok: false, error: 'Les applis d\'Odin ne sont pas démarrées.' };
  switch (path) {
    case '/api/valhalla/act': {
      const f = v.action(s(b.module), s(b.action)); if (!f) return { ok: false, error: 'action inconnue' };
      const input = (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>;
      const why = f.a.grave?.(input, v.ctx(f.m.id));
      if (why && b.confirm !== true) return { ok: false, confirm: `Confirmer : ${why} ?` };
      const r = await v.act(f.m.id, f.a.id, input);
      return { ok: r.ok !== false, text: r.text, data: r.data && typeof r.data === 'object' && 'file' in (r.data as object) ? { file: true } : r.data };
    }
    case '/api/valhalla/ack': v.ack(Array.isArray(b.ids) ? b.ids.map(String) : []); return { ok: true };
    case '/api/valhalla/level': { const l = s(b.level); if (!['info', 'moyenne', 'haute', 'critique'].includes(l)) return { ok: false, error: 'niveau inconnu' }; v.saveSettings({ alertLevel: l }); return { ok: true }; }
    default: return undefined;
  }
}

// ---------------------------------------------------------------- Frigg : réservation publique
const hits = new Map<string, number[]>();
export async function friggPublic(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const m = /^\/r\/([\w-]{12,64})$/.exec(url.pathname); if (!m) return false;
  const v = valhallaOf(), ctx = v?.ctx('frigg');
  if (!ctx || m[1] !== publicKey(ctx)) { page(res, 404, 'Lien inactif', '<h1>Lien inactif</h1><p>Cette page de réservation n\'existe plus.</p>'); return true; }
  const info = publicInfo(ctx);
  const ip = String(req.socket.remoteAddress ?? ''), now = Date.now(), h = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (req.method === 'POST') {
    if (h.length >= 10) { page(res, 429, info.title, `<h1>${esc(info.title)}</h1><p class="err">Trop de demandes : réessaie plus tard.</p>`); return true; }
    h.push(now); hits.set(ip, h);
    let f: Record<string, string> = {}; try { f = Object.fromEntries(new URLSearchParams(await body(req, 16 * 1024))); } catch { /* vide */ }
    if (f._site) { page(res, 200, info.title, `<h1>${esc(info.title)}</h1><p>Merci, ta demande est enregistrée.</p>`); return true; }
    try {
      const b = book(ctx, { service: s(f.service), jour: s(f.jour), heure: s(f.heure), nom: s(f.nom), contact: s(f.contact), note: s(f.note) }, true);
      page(res, 200, info.title, `<h1>${esc(info.title)}</h1><p>${b.status === 'attente' ? 'Merci ! Ta demande est enregistrée, tu recevras une confirmation.' : 'C\'est réservé, merci !'}</p><p><strong>${esc(b.service)}</strong><br>${esc(b.start.slice(0, 10).split('-').reverse().join('/'))} à ${esc(b.start.slice(11))}</p>`);
    } catch (e) { page(res, 400, info.title, `<h1>${esc(info.title)}</h1><p class="err" role="alert">${esc((e as Error).message)}</p><p><a href="${esc(url.pathname)}">Revenir</a></p>`); }
    return true;
  }
  const service = s(url.searchParams.get('service')), day = /^\d{4}-\d{2}-\d{2}$/.test(s(url.searchParams.get('jour'))) ? s(url.searchParams.get('jour')) : '';
  const today = new Date().toISOString().slice(0, 10);
  const opts = info.services.map((x) => `<option${x.name === service ? ' selected' : ''} value="${esc(x.name)}">${esc(x.name)} · ${x.minutes} min${x.price !== undefined ? ` · ${x.price} €` : ''}</option>`).join('');
  if (!info.services.length) { page(res, 200, info.title, `<h1>${esc(info.title)}</h1><p>Aucune prestation n'est ouverte à la réservation pour l'instant.</p>`); return true; }
  const step1 = `<form method="get"><label for="s">Prestation</label><select id="s" name="service" required>${opts}</select><label for="j">Jour</label><input id="j" name="jour" type="date" min="${today}" value="${esc(day)}" required><button type="submit">Voir les créneaux</button></form>`;
  let step2 = '';
  if (service && day) {
    const slots = publicSlots(ctx, service, day);
    step2 = slots.length
      ? `<form method="post"><input type="hidden" name="service" value="${esc(service)}"><input type="hidden" name="jour" value="${esc(day)}"><label for="h">Heure</label><select id="h" name="heure" required>${slots.map((x) => `<option>${x}</option>`).join('')}</select><label for="n">Nom</label><input id="n" name="nom" required autocomplete="name"><label for="c">Téléphone ou e-mail</label><input id="c" name="contact" required autocomplete="tel"><label for="o">Note (facultatif)</label><textarea id="o" name="note"></textarea><div style="position:absolute;left:-9999px" aria-hidden="true"><label for="f_site">Site</label><input id="f_site" name="_site" tabindex="-1" autocomplete="off"></div><button type="submit">Réserver</button></form>`
      : '<p class="err" role="status">Aucun créneau libre ce jour-là : choisis un autre jour.</p>';
  }
  page(res, 200, info.title, `<h1>${esc(info.title)}</h1><p>Choisis ta prestation et ton jour, puis l'heure.</p>${step1}${step2}`);
  return true;
}
