// Venus (ton serveur multimédia) piloté par Odin : « mets One Piece sur la télé du salon »,
// « qu'est-ce qui passe ce soir ? », « enregistre le match », « quels écrans sont allumés ? ».
// Odin parle à Venus avec une clé API (Venus → Serveur → Clés API), gardée dans son coffre.

import { request as httpReq } from 'node:http';
import { request as httpsReq } from 'node:https';
import { isPrivateV4 } from '../hlidskjalf/discover.ts';
import { obj, str, type Tool, type ToolContext } from './registry.ts';

export interface VenusConf { url: string; key: string }
export function venusConf(ctx: Pick<ToolContext, 'venus'>, env = process.env): VenusConf {
  const url = (ctx.venus?.url ?? '').replace(/\/$/, ''), key = env.VENUS_API_KEY ?? '';
  if (!url || !key) throw new Error('Venus n\'est pas relié : Réglages → Maison → Venus (adresse et clé API créée dans Venus → Serveur → Clés API).');
  return { url, key };
}

/** Appel à l'API de Venus. Certificat auto-signé accepté seulement sur le réseau local. */
export function venusApi<T = unknown>(c: VenusConf, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const u = new URL(c.url + path);
  const local = isPrivateV4(u.hostname) || /\.local$|^localhost$/.test(u.hostname);
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : undefined;
    const req = (u.protocol === 'https:' ? httpsReq : httpReq)(u, { method, headers: { 'x-api-key': c.key, accept: 'application/json', ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) }, timeout: 15_000, ...(u.protocol === 'https:' && local ? { rejectUnauthorized: false } : {}) }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (b) => chunks.push(b));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ((res.statusCode ?? 500) >= 400) return reject(new Error(`Venus : ${(() => { try { return (JSON.parse(text) as { error?: string }).error ?? text; } catch { return text; } })().slice(0, 200)} (HTTP ${res.statusCode})`));
        try { resolve(JSON.parse(text) as T); } catch { resolve(text as T); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Venus ne répond pas')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

export interface VCard { id: number; title: string; type: string; slug: string; path: string; number?: number; year?: number; category?: string }
const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Meilleur titre pour une demande (pur) : numéro de chaîne, titre exact, puis titre qui contient les mots. */
export function bestMatch(cards: VCard[], q: string): VCard | undefined {
  const n = norm(q).replace(/^(la |le |les |l )?(chaine|serie|film|anime|episode) /, '');
  const num = /^(\d{1,4})$/.exec(n);
  if (num) return cards.find((c) => c.type === 'channel' && c.number === Number(num[1]));
  return cards.find((c) => norm(c.title) === n)
    ?? cards.find((c) => norm(c.title).startsWith(n))
    ?? cards.filter((c) => n.split(' ').every((w) => norm(c.title).includes(w))).sort((a, b) => a.title.length - b.title.length)[0];
}

/** Adresse qui LANCE la lecture dans Venus (pur). */
export function playPathOf(c: VCard): string {
  if (c.type === 'channel') return `/tv/${c.number ?? c.id}-${c.slug}`;
  if (c.type === 'movie' || c.type === 'clip' || c.type === 'episode') return `/lecture/${c.slug}`;
  return c.path; // une série : sa page (Venus propose l'épisode suivant)
}

async function catalog(c: VenusConf): Promise<VCard[]> {
  const [ch, all] = await Promise.all([venusApi<VCard[]>(c, 'GET', '/api/library?type=channel'), venusApi<VCard[]>(c, 'GET', '/api/library')]);
  return [...ch, ...all];
}

const hm = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export const venusTool: Tool = {
  name: 'venus',
  description: 'Pilote Venus, le serveur multimédia de la maison. action : regarder (quoi : film, série, chaîne par nom ou numéro ; ou : nom de l\'écran, « salon »…), programme (ce qui passe maintenant / ce soir, filtre facultatif), enregistrer (quoi : titre d\'une émission du guide ; serie : oui pour toutes les diffusions), ecrans (écrans où Venus est ouvert), chercher (quoi).',
  risk: 'external',
  schema: obj({ action: str('regarder | programme | enregistrer | ecrans | chercher'), quoi: str('titre, chaîne ou numéro'), ou: str('écran (facultatif)'), serie: str('oui pour enregistrer toutes les diffusions') }, ['action']),
  summarize: (i) => `Venus : ${String(i.action)} ${String(i.quoi ?? '')}${i.ou ? ` sur ${String(i.ou)}` : ''}`,
  async run(i, ctx) {
    const c = venusConf(ctx), a = norm(String(i.action ?? '')), q = String(i.quoi ?? '').trim(), where = norm(String(i.ou ?? ''));
    if (a.startsWith('ecran')) {
      const d = await venusApi<Array<{ id: string; name: string; tv: boolean; playing: boolean }>>(c, 'GET', '/api/devices/open');
      return d.length ? d.map((x) => `- ${x.name}${x.tv ? ' (télé)' : ''}${x.playing ? ' — en lecture' : ''}`).join('\n') : 'Aucun écran n\'a Venus ouvert en ce moment.';
    }
    if (a.startsWith('cherch')) {
      const cards = await catalog(c), n = norm(q);
      const hits = cards.filter((x) => n.split(' ').every((w) => norm(x.title).includes(w))).slice(0, 12);
      return hits.length ? hits.map((x) => `- ${x.title}${x.year ? ` (${x.year})` : ''} · ${x.type === 'channel' ? `chaîne ${x.number}` : x.category === 'anime' ? 'animé' : x.type}`).join('\n') : `Rien dans Venus pour « ${q} ».`;
    }
    if (a.startsWith('progr')) {
      const [chans, nn] = await Promise.all([venusApi<VCard[]>(c, 'GET', '/api/library?type=channel'), venusApi<Record<string, Array<{ title: string; start: number; stop: number }>>>(c, 'GET', '/api/epg/now')]);
      const f = norm(q);
      const lines = chans.filter((ch) => !f || norm(ch.title).includes(f) || String(ch.number) === f || (nn[ch.id] ?? []).some((p) => norm(p.title).includes(f)))
        .map((ch) => { const [cur, next] = nn[ch.id] ?? []; return cur ? `${ch.number}. ${ch.title} : ${cur.title} (${hm(cur.start)}–${hm(cur.stop)})${next ? `, puis ${next.title} à ${hm(next.start)}` : ''}` : ''; }).filter(Boolean);
      return lines.length ? lines.slice(0, 40).join('\n') : 'Pas de programme connu (guide des programmes vide ou chaîne introuvable).';
    }
    if (a.startsWith('enreg')) {
      const now = Date.now(), from = now - 3600_000, to = now + 24 * 3600_000;
      const g = await venusApi<{ channels: Array<{ id: number; title: string; number?: number }>; programs: Record<string, Array<{ id: number; title: string; start: number; stop: number; channel: number }>> }>(c, 'GET', `/api/epg?from=${from}&to=${to}`);
      const n = norm(q);
      const prog = Object.values(g.programs).flat().filter((p) => p.stop > now && norm(p.title).includes(n)).sort((x, y) => x.start - y.start)[0];
      if (!prog) return `Je ne trouve pas « ${q} » dans le guide des prochaines 24 h.`;
      const series = /^(oui|yes|true|1)$/i.test(String(i.serie ?? ''));
      await venusApi(c, 'POST', '/api/recordings', { programId: prog.id, series });
      const ch = g.channels.find((x) => x.id === prog.channel);
      return `Enregistrement programmé : « ${prog.title} » sur ${ch?.title ?? 'la chaîne'}, ${new Date(prog.start).toLocaleDateString('fr-FR', { weekday: 'long' })} ${hm(prog.start)}–${hm(prog.stop)}${series ? ' (et toutes les diffusions suivantes)' : ''}.`;
    }
    // regarder
    const cards = await catalog(c), it = bestMatch(cards, q);
    if (!it) return `Je ne trouve pas « ${q} » dans Venus.`;
    const devs = await venusApi<Array<{ id: string; name: string; tv: boolean }>>(c, 'GET', '/api/devices/open');
    const dev = (where ? devs.find((d) => norm(d.name).includes(where)) : undefined) ?? devs.find((d) => d.tv) ?? (devs.length === 1 ? devs[0] : undefined);
    if (!dev) return devs.length ? `Sur quel écran ? Ouverts : ${devs.map((d) => d.name).join(', ')}.` : `J'ai trouvé « ${it.title} », mais aucun écran n'a Venus ouvert : allume la télé et ouvre Venus, puis redis-le-moi.`;
    await venusApi(c, 'POST', `/api/devices/${encodeURIComponent(dev.id)}/open`, { path: playPathOf(it) });
    return `▶️ « ${it.title} »${it.type === 'channel' ? ` (chaîne ${it.number})` : ''} lancé sur ${dev.name}.`;
  },
};
