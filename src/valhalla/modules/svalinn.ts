// Zéphyr — le bouclier du Wi-Fi de la maison (maquettes validées « Zéphyr · Wi-Fi de la maison » et « Régler la box ») :
// la note de sécurité du Wi-Fi et ce qu'il faut corriger (le plus urgent d'abord), les réseaux et les canaux autour,
// les appareils connectés (et leur nombre sur 24 h), le débit, le Wi-Fi invités (QR code), la box.
// Rien ne change sans ton accord : chaque changement est précédé d'une sauvegarde de l'état de la box, et si les
// appareils en Wi-Fi ne reviennent pas dans les 3 minutes, l'ancien réglage revient tout seul (retour automatique).
// Le mot de passe de la box : seulement celui que tu donnes, rangé dans le coffre ; Odin ne force jamais l'accès.
// Box pilotée : Livebox (Orange). Les autres : Odin lit ce qu'il peut (Wi-Fi autour, UPnP, appareils) et te guide.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assess, bestChannel, parseIw, parseNmcli, secuOf, wifiQr, type Change, type Facts, type Fix, type Net } from '../svalinn/analyse.ts';
import { isLivebox, Livebox, type BoxState } from '../svalinn/livebox.ts';
import { discover } from '../upnp.ts';
import { svg as qrSvg } from '../qr.ts';
import type { ActionResult, ModCtx, Module, Section } from '../types.ts';

const s = (v: unknown) => String(v ?? '').trim();
interface Etat { at: string; gateway?: string; nets: Net[]; mine?: Net; box?: BoxState; upnpSeen?: boolean; debit?: { mbps: number; at: string }; facts: Facts; note: number; verdict: string; fixes: Fix[]; source: string }
interface Pending { at: string; change: Change; undo?: Change; wifiBefore: number; label: string }
const etatFile = (ctx: ModCtx) => join(ctx.dir, 'etat.json');
const secretsFile = (ctx: ModCtx) => join(ctx.dir, 'secrets.json');
const histFile = (ctx: ModCtx) => join(ctx.dir, 'appareils.jsonl');
const readJson = <T>(f: string, d: T): T => { try { return JSON.parse(readFileSync(f, 'utf8')) as T; } catch { return d; } };
const lastEtat = (ctx: ModCtx) => readJson<Etat | undefined>(etatFile(ctx), undefined);
function secrets(ctx: ModCtx): { box?: string; invites?: string } { return readJson(secretsFile(ctx), {}); }
function setSecret(ctx: ModCtx, k: 'box' | 'invites', v: string | undefined) { mkdirSync(ctx.dir, { recursive: true, mode: 0o700 }); const x = secrets(ctx); if (v) x[k] = v; else delete x[k]; writeFileSync(secretsFile(ctx), JSON.stringify(x), { mode: 0o600 }); }
const boxCfg = (ctx: ModCtx) => ctx.settings.box as { host: string; marque: string; utilisateur?: string } | undefined;

async function gateway(ctx: ModCtx): Promise<string | undefined> { return /default via (\d+\.\d+\.\d+\.\d+)/.exec((await ctx.run('ip', ['route', 'show', 'default'], { timeoutMs: 3000 }).catch(() => ({ out: '' }))).out)?.[1]; }
/** Le Wi-Fi autour, vu par la carte Wi-Fi de la machine d'Odin (s'il en a une). */
async function scan(ctx: ModCtx): Promise<{ nets: Net[]; how: string }> {
  if (await ctx.has('nmcli')) { const r = await ctx.run('nmcli', ['-t', '-f', 'IN-USE,SSID,BSSID,CHAN,FREQ,SIGNAL,SECURITY', 'dev', 'wifi', 'list', '--rescan', 'auto'], { timeoutMs: 20000 }).catch(() => undefined); const nets = r?.code === 0 ? parseNmcli(r.out) : []; if (nets.length) return { nets, how: 'nmcli' }; }
  if (await ctx.has('iw')) {
    const dev = /Interface (\S+)/.exec((await ctx.run('iw', ['dev'], { timeoutMs: 3000 }).catch(() => ({ out: '' }))).out)?.[1];
    if (dev) { const r = await ctx.run('iw', ['dev', dev, 'scan'], { timeoutMs: 20000, sudo: true }).catch(() => undefined); if (r?.code === 0) return { nets: parseIw(r.out), how: 'iw' }; }
  }
  return { nets: [], how: 'aucune carte Wi-Fi sur la machine d\'Odin' };
}
/** Les appareils vus sur le réseau local quand la box n'est pas reliée (table des voisins). */
async function neigh(ctx: ModCtx): Promise<BoxState['devices']> {
  const out = (await ctx.run('ip', ['-4', 'neigh', 'show'], { timeoutMs: 3000 }).catch(() => ({ out: '' }))).out;
  return out.split('\n').map((l) => /^(\d+\.\d+\.\d+\.\d+) dev \S+ lladdr ([0-9a-f:]{17}) (\w+)/i.exec(l.trim())).filter((m): m is RegExpExecArray => Boolean(m)).map((m) => ({ name: m[1], mac: m[2], ip: m[1], active: /REACHABLE|DELAY|PROBE|STALE/.test(m[3]), wifi: false }));
}
function driver(ctx: ModCtx): Livebox | undefined { const b = boxCfg(ctx), pw = secrets(ctx).box; return b?.marque === 'livebox' && pw ? new Livebox(b.host, pw, { user: b.utilisateur, fetch: ctx.fetch }) : undefined; }

/** Tout relire : Wi-Fi autour, box, UPnP ; puis la note et les corrections. */
export async function refresh(ctx: ModCtx): Promise<Etat> {
  const prev = lastEtat(ctx), [gw, sc] = await Promise.all([gateway(ctx), scan(ctx)]);
  const d = driver(ctx); let box: BoxState | undefined, err = '';
  if (d) { try { box = await d.read(ctx.now()); } catch (e) { err = (e as Error).message; } }
  let upnpSeen: boolean | undefined;
  if (box?.upnp === undefined) { try { await discover({ timeoutMs: 2500, fetch: ctx.fetch }); upnpSeen = true; } catch { upnpSeen = false; } }
  const mine = sc.nets.find((n) => n.mine) ?? (box?.vaps[0] ? sc.nets.find((n) => n.ssid === box!.vaps[0].ssid) : undefined);
  const main = box?.vaps.find((v) => !v.guest);
  const r24 = box?.radios.find((r) => r.band === '2,4 GHz');
  const chanNow = r24?.channel ?? (mine && mine.chan <= 14 ? mine.chan : undefined);
  const facts: Facts = {
    security: main?.security ? secuOf(main.security) : mine ? secuOf(mine.security) : (ctx.settings.chiffrement as Facts['security']) ?? undefined,
    wps: main ? main.wps : mine?.wps ?? (ctx.settings.wps === true ? true : undefined),
    defaultPassword: ctx.settings.motDePasseOrigine === true ? true : undefined,
    upnp: box?.upnp ?? (upnpSeen ? true : undefined), remoteAdmin: box?.remote,
    channel: chanNow && sc.nets.length ? bestChannel(sc.nets, chanNow) : undefined, guest: box?.guest,
  };
  const a = assess(facts);
  const e: Etat = { at: ctx.now().toISOString(), gateway: gw, nets: sc.nets, mine, box, upnpSeen, debit: prev?.debit, facts, ...a, source: [box ? (box.model && box.model.toLowerCase().includes(box.brand.toLowerCase()) ? box.model : `${box.brand}${box.model ? ` ${box.model}` : ''}`) : err ? `box : ${err}` : boxCfg(ctx) ? 'box non pilotée' : 'box non reliée', sc.how].join(' · ') };
  mkdirSync(ctx.dir, { recursive: true, mode: 0o700 }); writeFileSync(etatFile(ctx), JSON.stringify(e), { mode: 0o600 });
  if (a.fixes.some((f) => f.level === 'urgent')) ctx.alert({ level: 'haute', title: `Wi-Fi : ${a.fixes.filter((f) => f.level === 'urgent').map((f) => f.title).join(', ')}`, detail: `Note ${a.note}/100. Zéphyr propose de corriger (avec ton accord).`, key: 'svalinn-urgent' });
  return e;
}
const devicesOf = async (ctx: ModCtx, e?: Etat) => e?.box?.devices ?? await neigh(ctx);
const GUIDE: Record<Change['kind'], (host: string) => string> = {
  wps: (h) => `Ouvre http://${h} → Wi-Fi → WPS → désactive-le, puis enregistre.`,
  securite: (h) => `Ouvre http://${h} → Wi-Fi → Sécurité → choisis « WPA2/WPA3 » (ou « WPA2-WPA3 mixte »), enregistre. Le Wi-Fi coupe environ 1 minute.`,
  canal: (h) => `Ouvre http://${h} → Wi-Fi → 2,4 GHz → Canal → choisis celui proposé (au lieu d'« automatique »), enregistre.`,
  upnp: (h) => `Ouvre http://${h} → Réseau (ou Avancé) → UPnP → désactive-le. Odin garde ses propres ouvertures de ports dans Vortex.`,
  distance: (h) => `Ouvre http://${h} → Accès à distance (ou Administration) → désactive l'accès depuis Internet.`,
  invites: (h) => `Ouvre http://${h} → Wi-Fi → Wi-Fi invités → active ou coupe.`,
  mot_de_passe: (h) => `Ouvre http://${h} → Administration → Mot de passe : mets-en un nouveau (Odin peut t'en proposer un), puis donne-le à Zéphyr (« Relier la box ») : il va dans le coffre.`,
};
function label(c: Change): string { return c.kind === 'wps' ? `WPS ${c.on ? 'activé' : 'coupé'}` : c.kind === 'securite' ? `chiffrement ${c.mode}` : c.kind === 'canal' ? `canal 2,4 GHz → ${c.chan}` : c.kind === 'upnp' ? `UPnP ${c.on ? 'activé' : 'coupé'}` : c.kind === 'distance' ? `accès à distance ${c.on ? 'ouvert' : 'fermé'}` : c.kind === 'invites' ? `Wi-Fi invités ${c.on ? 'allumé' : 'coupé'}` : 'mot de passe de la box'; }
/** Un changement accepté : sauvegarde, application, puis surveillance (retour automatique si le Wi-Fi ne revient pas). */
async function applyChange(ctx: ModCtx, c: Change): Promise<ActionResult> {
  const d = driver(ctx), host = boxCfg(ctx)?.host ?? (await gateway(ctx)) ?? '192.168.1.1';
  if (!d) return { text: `🛡 ${label(c)} : ta box n'est pas pilotée par Odin, voici comment faire :\n${GUIDE[c.kind](host)}\nOdin revérifie ensuite (« analyse le Wi-Fi »).` };
  const st = await d.read(ctx.now());
  const dir = join(ctx.dir, 'sauvegardes'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${ctx.now().toISOString().replace(/[:.]/g, '-')}.json`); writeFileSync(file, JSON.stringify(st), { mode: 0o600 });
  const undo = await d.apply(c, st);
  const wifiBefore = st.devices.filter((x) => x.active && x.wifi).length;
  if (ctx.settings.retour !== false && undo) ctx.saveSettings({ attente: { at: ctx.now().toISOString(), change: c, undo, wifiBefore, label: label(c) } satisfies Pending });
  return { text: `🛡 ${label(c)} : fait. État de la box sauvegardé juste avant.${undo && ctx.settings.retour !== false ? ` Si tes appareils en Wi-Fi (${wifiBefore}) ne reviennent pas dans les 3 minutes, l'ancien réglage revient tout seul.` : ''}` };
}
function changeOf(e: Etat | undefined, id: string): Change | undefined { return e?.fixes.find((f) => f.id === id)?.change; }

async function speed(ctx: ModCtx): Promise<{ mbps: number; at: string }> {
  const bytes = 25_000_000, t0 = performance.now();
  const r = await ctx.fetch(`https://speed.cloudflare.com/__down?bytes=${bytes}`, { signal: AbortSignal.timeout(60_000) }).catch(() => { throw new Error('Internet ne répond pas depuis la machine d\'Odin : test de débit impossible pour l\'instant'); });
  if (!r.ok || !r.body) throw new Error(`test de débit impossible (${r.status})`);
  let n = 0; const rd = r.body.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; }
  const sec = (performance.now() - t0) / 1000; return { mbps: Math.round((n * 8) / sec / 1e6), at: ctx.now().toISOString() };
}
function history(ctx: ModCtx): Array<{ at: string; n: number; wifi: number }> { try { return readFileSync(histFile(ctx), 'utf8').trim().split('\n').filter(Boolean).slice(-300).map((l) => JSON.parse(l)); } catch { return []; } }
/** Le nombre d'appareils par heure sur les dernières 24 h (24 barres, la dernière = maintenant). */
export function hours(h: Array<{ at: string; n: number }>, now: Date): number[] {
  const out = new Array<number>(24).fill(0), t = now.getTime();
  for (const x of h) { const k = Math.floor((t - Date.parse(x.at)) / 3_600_000); if (k >= 0 && k < 24) out[23 - k] = Math.max(out[23 - k], x.n); }
  return out;
}

export const svalinn: Module = {
  id: 'svalinn', name: 'Zéphyr', family: 'Sécurité',
  what: 'Le Wi-Fi de la maison : sa note de sécurité et ce qu\'il faut corriger, les réseaux et canaux autour, qui est connecté, le débit, le Wi-Fi invités, et la box (Livebox pilotée, les autres guidées). Rien ne change sans ton accord.',
  does: ['note du Wi-Fi sur 100 et corrections, le plus urgent d\'abord (WPS, chiffrement, mot de passe d\'origine, accès à distance, UPnP, canal encombré)', 'réseaux voisins et meilleur canal (carte Wi-Fi de la machine d\'Odin)', 'appareils connectés et leur nombre sur 24 h', 'test de débit', 'Wi-Fi invités avec QR code', 'Livebox : lecture et changements avec ton accord, sauvegarde avant, retour automatique si le Wi-Fi ne revient pas', 'autres box : Odin te guide écran par écran ; il ne force jamais l\'accès'],
  from: ['Home Assistant', 'WiFi Analyzer'], upstream: [],
  words: ['wifi', 'wi-fi', 'wi fi', 'box', 'livebox', 'wps', 'wpa3', 'wpa2', 'canal wifi', 'wifi invites', 'wifi invités', 'qui est connecte', 'qui est connecté', 'debit', 'débit', 'svalinn'],
  actions: [
    { id: 'etat', label: 'Analyser le Wi-Fi', what: 'Relit le Wi-Fi autour, la box et l\'UPnP, puis donne la note et ce qu\'il faut corriger', read: true, words: ['analyse le wifi', 'note du wifi', 'mon wifi est il sur', 'mon wifi est-il sûr'], run: async (ctx) => {
      const e = await refresh(ctx);
      return { text: `🛡 Wi-Fi : ${e.note}/100 (${e.verdict}) · ${e.source}\n${e.fixes.map((f) => `- [${f.level}] ${f.title} : ${f.detail}`).join('\n') || 'Rien à corriger.'}`, data: e };
    } },
    { id: 'relier_box', label: 'Relier la box', what: 'L\'adresse de la box et son mot de passe d\'administration (rangé dans le coffre, jamais affiché)', quick: false, params: [{ key: 'adresse', label: 'Adresse de la box', kind: 'text', default: '192.168.1.1' }, { key: 'marque', label: 'Marque', kind: 'select', options: ['livebox', 'autre'], default: 'livebox' }, { key: 'utilisateur', label: 'Utilisateur', kind: 'text', default: 'admin' }, { key: 'mot_de_passe', label: 'Mot de passe d\'administration', kind: 'password' }],
      run: async (ctx, i) => {
        const host = s(i.adresse) || (await gateway(ctx)) || '192.168.1.1'; if (!/^[\w.-]+(:\d{1,5})?$/.test(host)) throw new Error('adresse de box invalide');
        const marque = s(i.marque) || ((await isLivebox(host, ctx.fetch)) ? 'livebox' : 'autre');
        const pw = s(i.mot_de_passe);
        if (marque === 'livebox' && pw) { const d = new Livebox(host, pw, { user: s(i.utilisateur) || 'admin', fetch: ctx.fetch }); await d.login(); }
        ctx.saveSettings({ box: { host, marque, utilisateur: s(i.utilisateur) || 'admin' } });
        if (pw) { setSecret(ctx, 'box', pw); await ctx.call('brisingamen', 'ajouter', { nom: 'Box internet (Zéphyr)', identifiant: s(i.utilisateur) || 'admin', mot_de_passe: pw, site: `http://${host}`, coffre: 'TOUFATECH' }, 'ranger le mot de passe de la box').catch(() => undefined); }
        return { text: `📡 Box reliée (${host}, ${marque})${pw ? ' : connexion réussie, mot de passe rangé dans le coffre' : ' sans mot de passe : Odin lit ce qu\'il peut et te guide'}.` };
      } },
    { id: 'corriger', label: 'Corriger', what: 'Applique une correction proposée (la box est sauvegardée avant ; retour automatique si le Wi-Fi ne revient pas)', quick: false, params: [{ key: 'correction', label: 'Correction', kind: 'select', options: ['wps', 'chiffrement', 'canal', 'upnp', 'distance', 'mot_de_passe'], required: true }],
      grave: (i, ctx) => { const e = ctx ? lastEtat(ctx) : undefined, f = e?.fixes.find((x) => x.id === s(i.correction)); return `${f ? `${f.title} → ${f.button.toLowerCase()}` : `corriger ${s(i.correction)}`} sur la box (le Wi-Fi peut couper environ 1 minute)`; },
      run: async (ctx, i) => { const e = lastEtat(ctx) ?? await refresh(ctx), c = changeOf(e, s(i.correction)); if (!c) return { text: `Rien à corriger pour « ${s(i.correction)} » d'après la dernière analyse.`, ok: false }; const r = await applyChange(ctx, c); await refresh(ctx).catch(() => undefined); return r; } },
    { id: 'tout_corriger', label: 'Tout corriger avec Odin', what: 'Applique toutes les corrections proposées, une par une, avec une seule sauvegarde avant', quick: false, words: ['corrige tout le wifi', 'securise mon wifi', 'sécurise mon wifi'], grave: (_i, ctx) => { const e = ctx ? lastEtat(ctx) : undefined; return `corriger sur la box : ${(e?.fixes ?? []).filter((f) => f.change && f.change.kind !== 'mot_de_passe').map((f) => f.title).join(', ') || 'rien'} (le Wi-Fi peut couper environ 1 minute)`; },
      run: async (ctx) => { const e = await refresh(ctx), out: string[] = []; for (const f of e.fixes.filter((x) => x.change && x.change.kind !== 'mot_de_passe')) { try { out.push((await applyChange(ctx, f.change!)).text); } catch (err) { out.push(`✗ ${f.title} : ${(err as Error).message}`); } } await refresh(ctx).catch(() => undefined); return { text: out.join('\n') || 'Rien à corriger.' }; } },
    { id: 'annuler', label: 'Revenir en arrière', what: 'Remet le dernier réglage changé par Zéphyr', quick: false, grave: () => 'remettre le dernier réglage de la box', run: async (ctx) => { const p = ctx.settings.attente as Pending | undefined, last = ctx.settings.dernier as Pending | undefined, x = p ?? last; if (!x?.undo) return { text: 'Rien à annuler.', ok: false }; const r = await applyChange(ctx, x.undo); ctx.saveSettings({ attente: undefined, dernier: undefined }); return { text: `↩ ${x.label} annulé. ${r.text}` }; } },
    { id: 'invites', label: 'Wi-Fi invités', what: 'Allume ou coupe le Wi-Fi invités (Internet seulement : ni tes PC, ni tes caméras)', params: [{ key: 'allume', label: 'Allumé', kind: 'boolean', default: true }], grave: (i) => `${i.allume === false || s(i.allume) === 'false' ? 'couper' : 'allumer'} le Wi-Fi invités`, run: (ctx, i) => applyChange(ctx, { kind: 'invites', on: !(i.allume === false || s(i.allume) === 'false') }) },
    { id: 'qr_invites', label: 'QR code invités', what: 'Le QR code du Wi-Fi invités, à montrer à tes visiteurs', read: true, run: (ctx) => { const n = s((ctx.settings.invites as { ssid?: string } | undefined)?.ssid), pw = secrets(ctx).invites; if (!n) return { text: 'Donne d\'abord le nom et le mot de passe du Wi-Fi invités (Réglages de Zéphyr).', ok: false }; return { text: `QR code du Wi-Fi ${n}`, data: { svg: qrSvg(wifiQr(n, pw ?? '', pw ? 'WPA' : 'nopass'), { scale: 6, margin: 2 }), alt: `QR code du Wi-Fi ${n}` } }; } },
    { id: 'appareils', label: 'Qui est connecté ?', what: 'Les appareils connectés à la maison', read: true, words: ['qui est connecte', 'qui est connecté', 'appareils connectes', 'appareils connectés'], run: async (ctx) => { const l = (await devicesOf(ctx, lastEtat(ctx))).filter((d) => d.active); return { text: `${l.length} appareil${l.length > 1 ? 's' : ''} connecté${l.length > 1 ? 's' : ''}\n${l.map((d) => `- ${d.name}${d.ip ? ` (${d.ip})` : ''}${d.band ? ` · ${d.band}` : d.wifi ? ' · Wi-Fi' : ''}`).join('\n')}`, data: l }; } },
    { id: 'tester_debit', label: 'Tester le débit', what: 'Télécharge 25 Mo depuis un serveur de test (Cloudflare) et mesure la vitesse', read: true, words: ['teste la vitesse', 'test de debit', 'test de débit', 'vitesse internet'], run: async (ctx) => { const d = await speed(ctx), e = lastEtat(ctx); if (e) { e.debit = d; writeFileSync(etatFile(ctx), JSON.stringify(e), { mode: 0o600 }); } return { text: `⚡ ${d.mbps} Mb/s en réception.`, data: d }; } },
    { id: 'regler', label: 'Régler', what: 'Wi-Fi invités (nom, mot de passe), retour automatique, ce que tu sais de ta box', quick: false, params: [{ key: 'invites_nom', label: 'Nom du Wi-Fi invités', kind: 'text', default: '' }, { key: 'invites_mdp', label: 'Mot de passe du Wi-Fi invités', kind: 'password' }, { key: 'retour', label: 'Retour automatique (3 min)', kind: 'boolean', default: true }, { key: 'origine', label: 'La box a encore son mot de passe d\'origine', kind: 'boolean', default: false }],
      run: (ctx, i) => { const n = s(i.invites_nom); ctx.saveSettings({ retour: !(i.retour === false || s(i.retour) === 'false'), motDePasseOrigine: i.origine === true || s(i.origine) === 'true', ...(n ? { invites: { ssid: n } } : {}) }); if (s(i.invites_mdp)) setSecret(ctx, 'invites', s(i.invites_mdp)); return { text: 'Réglé.' }; } },
    { id: 'resume', label: 'Résumé', what: 'Le dernier état connu (sans relire la box), pour la page de Zéphyr', read: true, quiet: true, quick: false, run: async (ctx) => {
      const e = lastEtat(ctx), b = boxCfg(ctx), p = (ctx.settings.attente ?? ctx.settings.dernier) as Pending | undefined;
      const saves = (() => { try { return readdirSync(join(ctx.dir, 'sauvegardes')).sort(); } catch { return []; } })();
      return { text: e ? `${e.note}/100` : 'pas encore analysé', data: { etat: e, devices: await devicesOf(ctx, e), heures: hours(history(ctx), ctx.now()), box: b ? { ...b, motDePasse: Boolean(secrets(ctx).box) } : undefined, retour: ctx.settings.retour !== false, invites: { ssid: (ctx.settings.invites as { ssid?: string } | undefined)?.ssid, motDePasse: Boolean(secrets(ctx).invites) }, sauvegarde: saves.at(-1)?.replace(/\.json$/, ''), annulable: p?.undo ? p.label : undefined } };
    } },
  ],
  watch: { every: 60, async run(ctx) {
    // Retour automatique : 3 minutes après un changement, les appareils en Wi-Fi sont-ils revenus ?
    const p = ctx.settings.attente as Pending | undefined;
    if (p && ctx.now().getTime() - Date.parse(p.at) >= 180_000) {
      ctx.saveSettings({ attente: undefined, dernier: p });
      let back = -1; try { back = (await driver(ctx)?.read(ctx.now()))?.devices.filter((x) => x.active && x.wifi).length ?? -1; } catch { back = -1; }
      if (p.undo && p.wifiBefore >= 2 && back >= 0 && back < Math.ceil(p.wifiBefore / 2)) {
        try { await applyChange(ctx, p.undo); ctx.saveSettings({ attente: undefined }); ctx.alert({ level: 'haute', title: `Wi-Fi : ${p.label} annulé tout seul`, detail: `Seulement ${back} appareil(s) en Wi-Fi sur ${p.wifiBefore} sont revenus en 3 minutes : l'ancien réglage est remis.`, key: 'svalinn-retour' }); }
        catch (e) { ctx.alert({ level: 'critique', title: 'Wi-Fi : retour automatique impossible', detail: (e as Error).message, key: 'svalinn-retour' }); }
      } else if (back < 0 && driver(ctx)) ctx.alert({ level: 'haute', title: 'La box ne répond plus depuis le changement', detail: `${p.label} : vérifie la box (« Revenir en arrière » dans Zéphyr quand elle répond).`, key: 'svalinn-retour' });
    }
    // Le nombre d'appareils, toutes les 10 minutes (pour le graphique sur 24 h).
    const h = history(ctx), last = h.at(-1);
    if (!last || ctx.now().getTime() - Date.parse(last.at) >= 600_000) {
      const e = lastEtat(ctx); let l = await neigh(ctx); try { const d = driver(ctx); if (d) l = (await d.read(ctx.now())).devices; } catch { /* box injoignable : la table des voisins suffit */ }
      mkdirSync(ctx.dir, { recursive: true, mode: 0o700 }); appendFileSync(histFile(ctx), JSON.stringify({ at: ctx.now().toISOString(), n: l.filter((d) => d.active).length, wifi: l.filter((d) => d.active && d.wifi).length }) + '\n', { mode: 0o600 });
      if (!e || ctx.now().getTime() - Date.parse(e.at) > 6 * 3_600_000) await refresh(ctx).catch(() => undefined);
    }
  } },
  async view(ctx) {
    const e = lastEtat(ctx), devs = (await devicesOf(ctx, e)).filter((d) => d.active), b = boxCfg(ctx);
    const kpis = [{ label: 'Note du Wi-Fi', value: e ? `${e.note}/100` : '—', pct: e?.note, tone: (!e ? undefined : e.note >= 75 ? 'bon' : e.note >= 50 ? 'attention' : 'mauvais') as 'bon' | 'attention' | 'mauvais' | undefined }, { label: 'Connectés', value: String(devs.length) }, { label: 'Débit', value: e?.debit ? `${e.debit.mbps} Mb/s` : '—' }];
    const sections: Section[] = [
      { kind: 'table', title: 'À corriger', columns: ['Quoi', 'Pourquoi', 'Urgence'], rows: (e?.fixes ?? []).map((f) => ({ cells: [f.title, f.detail, f.level], tone: f.level === 'urgent' ? 'mauvais' as const : f.level === 'important' ? 'attention' as const : undefined, actions: f.change ? [{ action: 'corriger', label: f.button, input: { correction: f.id } }] : [] })), empty: e ? 'Rien à corriger.' : 'Lance « Analyser le Wi-Fi ».' },
      { kind: 'table', title: 'Connectés', columns: ['Appareil', 'Adresse', 'Liaison'], rows: devs.slice(0, 60).map((d) => ({ cells: [d.name, d.ip ?? '—', d.band ?? (d.wifi ? 'Wi-Fi' : '—')] })), empty: 'Aucun appareil vu.' },
      { kind: 'bars', title: 'Appareils sur 24 h', items: hours(history(ctx), ctx.now()).map((n, k) => ({ label: `${String((ctx.now().getHours() - 23 + k + 48) % 24).padStart(2, '0')} h`, value: n })) },
    ];
    const side: Section[] = [{ kind: 'text', title: 'Box', text: b ? `${b.host} · ${b.marque === 'livebox' ? 'Livebox (pilotée)' : 'guidée'}${secrets(ctx).box ? ' · mot de passe dans le coffre' : ''}` : 'Pas encore reliée : « Relier la box ».' }];
    return { subtitle: e ? `${devs.length} appareils · ${e.fixes.filter((f) => f.level === 'urgent').length} urgent · rien ne change sans ton accord` : 'Wi-Fi de la maison · rien ne change sans ton accord', kpis, sections, side };
  },
};
