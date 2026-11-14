// L'écran de la maison (Hestia) : la page /maison, son script, et son API /api/maison/*.
// Deux façons d'y entrer :
//   - ta session Odin (cookie) : tous les droits, comme partout dans Odin ;
//   - une clé de tablette (en-tête x-odin-maison, lue depuis #cle=… dans l'adresse, jamais envoyée au serveur
//     dans l'URL) : droits « maison » (appareils, scènes, boutons sans action grave) ou « complet ».
// Une action grave (ouvrir la serrure, couper les sessions…) demande toujours une confirmation, et une tablette
// « maison » ne peut pas la lancer. La page peut s'afficher dans Home Assistant (seulement l'adresse autorisée).
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { understand } from '../valhalla/huginn.ts';
import { cleanLayout, defaultLayout, type Layout } from '../valhalla/modules/gladsheim.ts';
import type { Module } from '../valhalla/types.ts';
import { THEMES, appStates, familyNow, keyRights, memberOf, recordFix, tilesOf, weather, weatherText, wword } from '../valhalla/modules/gladsheim.ts';
import { cameraNames, preview } from '../valhalla/modules/himinbjorg.ts';
import { homeDevices, homePeople, homeScenes } from '../valhalla/modules/midgard.ts';
import { netState } from '../valhalla/modules/vidarr.ts';
import { valhallaOf } from '../valhalla/odin.ts';
import { noticesOf } from '../valhalla/notices.ts';

const MAISON_JS = (() => { try { return readFileSync(new URL('./maison.js', import.meta.url)); } catch { return Buffer.from(''); } })();
const s = (v: unknown) => String(v ?? '');
export interface MaisonDeps { authed: boolean; name: string; mascot: string; fail: () => void; ask: (text: string) => Promise<string> }
type Who = { rights: 'maison' | 'complet'; by: string };
const json = (res: ServerResponse, code: number, b: unknown) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(b)); };
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > 16_384) throw new Error('trop long'); parts.push(c as Buffer); }
  try { const j = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') as unknown; return j && typeof j === 'object' ? j as Record<string, unknown> : {}; } catch { return {}; }
}
/** Qui demande : ta session, ou une clé de tablette valide. */
function whoOf(req: IncomingMessage, d: MaisonDeps): Who | undefined {
  if (d.authed) return { rights: 'complet', by: 'toi' };
  const v = valhallaOf(), key = s(req.headers['x-odin-maison']);
  if (!v || !key) return undefined;
  const k = keyRights(v.ctx('gladsheim'), key); if (!k) { d.fail(); return undefined; }
  return { rights: k.rights, by: `tablette « ${k.name} »` };
}
/** La fenêtre rangée (ou celle de départ). */
function layoutOf(v: NonNullable<ReturnType<typeof valhallaOf>>): Layout {
  const g = v.ctx('gladsheim'), ids = v.modules().map((m) => m.id);
  try { return g.settings.fenetre ? cleanLayout(g.settings.fenetre, ids) : defaultLayout(ids); } catch { return defaultLayout(ids); }
}
/** Les pages « écran de la maison », avec ce qu'il faut pour les dessiner. */
async function maisonPages(v: NonNullable<ReturnType<typeof valhallaOf>>, full: boolean) {
  const pages = layoutOf(v).pages.filter((p) => p.maison), cache = new Map<string, Awaited<ReturnType<Module['view']>> | null>();
  const view = async (id: string) => { if (!cache.has(id)) { const m = v.module(id); cache.set(id, m ? await Promise.resolve(m.view(v.ctx(id), new URLSearchParams())).catch(() => null) : null); } return cache.get(id) ?? null; };
  const out = [];
  for (const p of pages) {
    const ws = [];
    for (const w of p.widgets) {
      const m = w.module ? v.module(w.module) : undefined;
      if (w.kind === 'meteo') { ws.push({ id: w.id, kind: 'meteo', w: w.w, title: w.label || 'Météo' }); continue; }
      if (!m) continue;
      if (!full && m.family !== 'Maison' && w.kind !== 'bouton') continue;
      if (w.kind === 'bouton') { const f = v.action(m.id, w.action ?? ''); if (!f) continue; const grave = Boolean(f.a.grave?.(w.input ?? {}, v.ctx(m.id))); if (grave && !full) continue; ws.push({ id: w.id, kind: 'bouton', w: w.w, title: w.label || f.a.label, app: m.name, grave }); continue; }
      const vw = await view(m.id); if (!vw) continue;
      if (w.kind === 'chiffres') ws.push({ id: w.id, kind: 'chiffres', w: w.w, title: w.label || m.name, app: m.name, kpis: (vw.kpis ?? []).slice(0, 6) });
      else { const sec = [...vw.sections, ...(vw.side ?? [])].find((x) => x.title === w.section && x.kind !== 'form' && x.kind !== 'graph'); if (sec) ws.push({ id: w.id, kind: 'section', w: w.w, title: w.label || sec.title, app: m.name, section: sec }); }
    }
    out.push({ id: p.id, name: p.name, widgets: ws });
  }
  return out;
}
/** Lance une action pour l'écran de la maison, avec la confirmation des actions graves. */
async function run(who: Who, module: string, action: string, input: Record<string, unknown>, confirm: boolean): Promise<Record<string, unknown>> {
  const v = valhallaOf(); if (!v) return { ok: false, text: 'Les applis d\'Odin ne sont pas démarrées.' };
  const f = v.action(module, action); if (!f) return { ok: false, text: 'action inconnue' };
  const grave = f.a.grave?.(input, v.ctx(f.m.id));
  if (grave && who.rights !== 'complet') return { ok: false, text: `« ${grave} » : action grave, à lancer depuis Odin (cette tablette n'a que les droits « maison »).` };
  if (grave && !confirm) return { ok: false, confirm: `Confirmer : ${grave} ?` };
  const r = await v.act(f.m.id, f.a.id, input, { by: 'toi', why: `écran de la maison (${who.by})` });
  return { ok: r.ok !== false, text: r.text };
}

/** Rend true si la requête était pour l'écran de la maison. */
export async function maisonRoute(req: IncomingMessage, res: ServerResponse, url: URL, d: MaisonDeps): Promise<boolean> {
  const p = url.pathname;
  if (p === '/maison.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' }); res.end(MAISON_JS); return true; }
  if (p === '/maison' && req.method === 'GET') {
    const v = valhallaOf(), ha = s(v?.ctx('gladsheim').settings.haOrigin), nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
    const frame = ha && /^https?:\/\/[\w.-]+(?::\d+)?$/.test(ha) ? `'self' ${ha}` : "'self'";
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; frame-ancestors ${frame}; base-uri 'none'; form-action 'none'`,
      'permissions-policy': 'microphone=(self), camera=(), geolocation=(), payment=(), usb=()',
    });
    res.end(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0b0e14"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><title>Maison · Odin</title><link rel="icon" href="/favicon.svg"></head><body><noscript>L'écran de la maison a besoin de JavaScript.</noscript><template id="mascotte">${d.mascot}</template><script nonce="${nonce}" src="/face.js"></script><script nonce="${nonce}" src="/powers3.js"></script><script nonce="${nonce}" src="/powers.js"></script><script nonce="${nonce}" src="/mascotte.js"></script><script nonce="${nonce}" src="/app-icons.js"></script><script nonce="${nonce}" src="/alchimie.js"></script><script nonce="${nonce}" src="/ciel.js"></script><script nonce="${nonce}" src="/maison.js"></script><script nonce="${nonce}" src="/plume.js"></script></body></html>`);
    return true;
  }
  // OwnTracks (mode HTTP) : chaque téléphone de la famille envoie sa position avec ses identifiants ; Odin répond
  // avec la dernière position des autres membres (chacun voit la famille sur sa carte).
  if (p === '/api/owntracks') {
    const v = valhallaOf(); if (!v) { json(res, 503, []); return true; }
    if (req.method !== 'POST') { json(res, 405, []); return true; }
    const m = memberOf(v.ctx('gladsheim'), s(req.headers.authorization)); if (!m) { d.fail(); res.writeHead(401, { 'www-authenticate': 'Basic realm="Odin"' }); res.end(); return true; }
    let b: Record<string, unknown>; try { b = await readBody(req); } catch { json(res, 413, []); return true; }
    json(res, 200, recordFix(v.ctx('gladsheim'), m, b)); return true;
  }
  if (!p.startsWith('/api/maison/')) return false;
  const who = whoOf(req, d);
  if (!who) { json(res, 401, { ok: false, error: 'connexion requise : ouvre Odin et connecte-toi, ou utilise un lien de tablette' }); return true; }
  const v = valhallaOf(); if (!v) { json(res, 503, { ok: false, error: 'Les applis d\'Odin ne sont pas démarrées.' }); return true; }
  const g = v.ctx('gladsheim'), mid = v.ctx('midgard');
  if (req.method === 'GET' && p === '/api/maison/etat') {
    const full = who.rights === 'complet';
    const [w, dev, apps, haPeople] = await Promise.all([weather(g), homeDevices(mid).catch(() => []), full ? appStates() : Promise.resolve([]), full ? homePeople(mid).catch(() => []) : Promise.resolve([])]);
    // La famille : les personnes de la box (Home Assistant) et les membres qui partagent leur position (OwnTracks).
    const people = full ? [...haPeople.map((x) => ({ ...x, source: 'Home Assistant' })), ...familyNow(g).filter((f) => !haPeople.some((h) => h.name.toLowerCase() === f.name.toLowerCase())).map((f) => ({ id: `ot:${f.id}`, name: f.name, state: f.place ?? 'position partagée', since: new Date(f.at).toISOString(), lat: f.lat, lon: f.lon, batt: f.batt, acc: f.acc, source: 'OwnTracks' }))] : [];
    // Le réseau de la maison (inventaire Atlas + baux DHCP de Sphinx) et ce qui est coupé à chaque appareil.
    const network: Array<{ ip: string; name: string; kind: string; cut: boolean; video: boolean }> = [];
    if (full) {
      const ns = v.module('vidarr') ? netState(v.ctx('vidarr')) : { leases: [], cut: new Set<string>(), video: new Set<string>() };
      const assets = ((v.ctx('askr').settings.assets as Array<{ ip?: string; name: string; kind: string; state?: string }> | undefined) ?? []).filter((a) => a.ip && a.state !== 'retiré');
      const seen = new Set<string>();
      for (const a of assets) { seen.add(a.ip!); network.push({ ip: a.ip!, name: a.name, kind: a.kind, cut: ns.cut.has(a.ip!), video: ns.video.has(a.ip!) }); }
      for (const l of ns.leases) if (!seen.has(l.ip)) { seen.add(l.ip); network.push({ ip: l.ip, name: l.name || l.ip, kind: 'appareil', cut: ns.cut.has(l.ip), video: ns.video.has(l.ip) }); }
      network.splice(80);
    }
    const rooms = [...new Set(dev.map((x) => x.room || 'Maison'))].map((r) => ({ name: r, devices: dev.filter((x) => (x.room || 'Maison') === r).map((x) => ({ id: x.id, name: x.name, kind: x.kind, state: x.state ?? '', unit: x.unit ?? '' })) }));
    // Odin d'aujourd'hui : le même sur tous les écrans (caché ou non, fête, couleur, pouvoirs).
    const mascotte = await v.act('apparence', 'mascotte', {}, { by: 'toi', why: 'écran de la maison' }).then((r) => r.data).catch(() => undefined);
    const tiles = tilesOf(g).map((t) => ({ id: t.id, label: t.label, icon: t.icon, color: t.color, module: t.module, grave: Boolean(v.action(t.module, t.action)?.a.grave?.(t.input, v.ctx(t.module))) }));
    // La fenêtre d'Odin : ses pages marquées « écran de la maison ». Une tablette « maison » ne voit que la météo, les
    // chiffres des applis de la famille Maison et les boutons sans action grave ; ta session (ou une clé « complet ») voit tout.
    const fenetre = await maisonPages(v, full);
    json(res, 200, { ok: true, fenetre, rights: who.rights, name: d.name, theme: s(g.settings.theme) || 'verre', themes: Object.fromEntries(Object.entries(THEMES).map(([k, x]) => [k, x.label])), weather: w ? { ...w, word: wword(w.code) } : undefined, rooms, scenes: homeScenes(mid).map((x) => x.name), tiles, apps, network, cameras: full ? cameraNames(v.ctx('himinbjorg')) : [], people, mascotte, notices: who.rights === 'complet' ? noticesOf()?.recent(8) ?? [] : [], at: Date.now() });
    return true;
  }
  // Aperçu d'une caméra (Cyclope) : une image JPEG, rafraîchie par la page.
  if (req.method === 'GET' && p === '/api/maison/camera') {
    if (who.rights !== 'complet') { json(res, 403, { ok: false, error: 'les caméras se regardent avec ta session (ou une clé « complet »)' }); return true; }
    try { const f = await preview(v.ctx('himinbjorg'), s(url.searchParams.get('nom')).slice(0, 80)); res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(readFileSync(f)); }
    catch (e) { json(res, 502, { ok: false, error: (e as Error).message }); }
    return true;
  }
  if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'méthode refusée' }); return true; }
  if (req.headers['x-odin'] !== '1') { json(res, 403, { ok: false, error: 'en-tête x-odin manquant' }); return true; }
  let b: Record<string, unknown>; try { b = await readBody(req); } catch { json(res, 413, { ok: false, error: 'trop long' }); return true; }
  const confirm = b.confirm === true;
  switch (p) {
    case '/api/maison/appareil': json(res, 200, await run(who, 'midgard', 'commander', { appareil: s(b.appareil).slice(0, 200), valeur: s(b.valeur).slice(0, 40) }, confirm)); return true;
    case '/api/maison/scene': json(res, 200, await run(who, 'midgard', 'scene', { scene: s(b.scene).slice(0, 80) }, confirm)); return true;
    case '/api/maison/fenetre': {
      const l = layoutOf(v), w = l.pages.filter((x) => x.maison).flatMap((x) => x.widgets).find((x) => x.id === s(b.id) && x.kind === 'bouton');
      if (!w?.module || !w.action) { json(res, 404, { ok: false, text: 'bouton introuvable' }); return true; }
      json(res, 200, await run(who, w.module, w.action, w.input ?? {}, confirm)); return true;
    }
    case '/api/maison/bouton': {
      const t = tilesOf(g).find((x) => x.id === s(b.id)); if (!t) { json(res, 404, { ok: false, text: 'bouton introuvable' }); return true; }
      json(res, 200, await run(who, t.module, t.action, t.input, confirm)); return true;
    }
    // Couper Internet ou la vidéo d'un appareil du réseau (Sphinx), seulement avec tous les droits.
    case '/api/maison/reseau': case '/api/maison/video': {
      if (who.rights !== 'complet') { json(res, 403, { ok: false, text: 'réservé à ta session (ou à une clé « complet »)' }); return true; }
      const ip = s(b.ip).trim().slice(0, 45), cut = b.couper !== false, nom = s(b.nom).trim().slice(0, 60);
      json(res, 200, p === '/api/maison/video' ? await run(who, 'vidarr', 'couper_video', { ip, coupe: cut, nom }, confirm) : await run(who, 'vidarr', cut ? 'couper_machine' : 'retablir_machine', cut ? { ip, nom } : { ip }, confirm));
      return true;
    }
    case '/api/maison/theme': {
      if (who.rights !== 'complet') { json(res, 403, { ok: false, text: 'le thème se change depuis Odin' }); return true; }
      json(res, 200, await run(who, 'gladsheim', 'theme', { theme: s(b.theme) }, false)); return true;
    }
    // Ce que tu dis à la mascotte : l'heure et la météo tout de suite ; le reste par Odin (mêmes droits et validations
    // que partout) ; une tablette « maison » ne commande que la maison.
    case '/api/maison/dire': {
      const text = s(b.texte).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 1000); if (!text) { json(res, 400, { ok: false, text: 'dis-moi quelque chose' }); return true; }
      if (/\b(quelle heure|l'heure|heure est-il)\b/i.test(text) && text.length < 40) { const n = new Date(); json(res, 200, { ok: true, text: `Il est ${n.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}, ${n.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}.` }); return true; }
      if (/\b(m[ée]t[ée]o|quel temps|il fait (chaud|froid|beau)|va-t-il pleuvoir|pluie)\b/i.test(text) && text.length < 60) { const w = await weather(g); json(res, 200, { ok: true, text: `${weatherText(w)}${w?.days[1] ? ` Demain : ${wword(w.days[1].code).toLowerCase()}, ${w.days[1].lo}° à ${w.days[1].hi}°.` : ''}`, mood: w && w.code >= 61 ? 'triste' : 'joie' }); return true; }
      const where = /\bo[uù] (?:est|sont|se trouve)\s+(.+?)\s*\??$/i.exec(text);
      if (where && who.rights === 'complet') {
        const q = where[1].toLowerCase().replace(/^(la |le |les )/, ''), fam = familyNow(g), hp = await homePeople(mid).catch(() => []);
        const list = /famille|tout le monde/.test(q) ? fam : fam.filter((f) => f.name.toLowerCase().includes(q));
        const ha = hp.filter((h) => /famille|tout le monde/.test(q) || h.name.toLowerCase().includes(q));
        if (list.length || ha.length) { json(res, 200, { ok: true, text: [...ha.map((h) => `${h.name} : ${h.state === 'home' ? 'à la maison' : h.state === 'not_home' ? 'absent' : h.state}.`), ...list.filter((f) => !ha.some((h) => h.name.toLowerCase() === f.name.toLowerCase())).map((f) => `${f.name} : ${f.place ?? 'position partagée'} il y a ${Math.max(1, Math.round((Date.now() - f.at) / 60_000))} min${f.batt !== undefined ? ` (batterie ${f.batt} %)` : ''}.`)].join('\n') }); return true; }
      }
      if (who.rights === 'complet') { json(res, 200, { ok: true, text: (await d.ask(text)).replace(/\[humeur:[^\]]*\]/g, '').trim() }); return true; }
      const u = await understand(v, text, 'maison').catch(() => undefined);
      if (u?.kind === 'action' && !u.doubt && ['midgard', 'gladsheim'].includes(u.module)) { json(res, 200, await run(who, u.module, u.action, u.input, confirm)); return true; }
      json(res, 200, { ok: false, text: 'Depuis cette tablette, je commande la maison (lumières, volets, scènes…). Pour le reste, demande-moi dans Odin.' });
      return true;
    }
    default: json(res, 404, { ok: false, error: 'introuvable' }); return true;
  }
}
