// Atlas — l'inventaire du matériel : chaque appareil a sa fiche (type, fabricant, modèle, numéro de série,
// MAC, IP, pièce, propriétaire, achat, garantie, état), son étiquette QR, son historique. Les appareils vus
// sur le réseau (registre d'Odin, DHCP de Sphinx, VPN) s'ajoutent tout seuls ; les prêts, les garanties qui
// finissent et les licences sont suivis. Fonctions reprises (réécrites) de Snipe-IT, GLPI et NetBox.
// (Atlas : le frêne d'où les dieux tirèrent le premier homme — ici, chaque objet de la maison prend son nom.)
import { randomBytes } from 'node:crypto';
import type { GraphDetail, GraphEdge, GraphNode, ModCtx, Module, Param, Tone } from '../types.ts';
import { svg as qrSvg } from '../qr.ts';
import { vendorOf } from '../../hlidskjalf/vendors.ts';

export type State = 'en service' | 'en stock' | 'en réparation' | 'prêté' | 'retiré';
export interface Asset {
  id: string; tag: string; name: string; kind: string;
  maker?: string; model?: string; serial?: string; mac?: string; ip?: string; os?: string;
  location?: string; owner?: string; state: State;
  bought?: string; price?: number; vendor?: string; warrantyEnd?: string; notes?: string;
  loan?: { to: string; since: string; due?: string };
  source: string; firstSeen: number; lastSeen?: number;
  history: Array<{ t: number; what: string }>;
}
export interface Licence { id: string; name: string; seats: number; expires?: string; assets: string[]; inVault?: boolean; notes?: string }
/** Ce que le registre réseau d'Odin sait d'un appareil vu sur le réseau. */
export interface Seen { ip: string; mac?: string; name?: string; model?: string; kind?: string; os?: string; firstSeen?: number; lastSeen?: number; online?: boolean }

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
const KINDS = ['ordinateur', 'portable', 'téléphone', 'tablette', 'serveur', 'réseau', 'imprimante', 'télé', 'caméra', 'objet connecté', 'console', 'autre'];
const STATES: State[] = ['en service', 'en stock', 'en réparation', 'prêté', 'retiré'];
const DATE = /^\d{4}-\d{2}-\d{2}$/, MAC = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const assets = (ctx: ModCtx): Asset[] => (ctx.settings.assets as Asset[] | undefined) ?? [];
const licences = (ctx: ModCtx): Licence[] => (ctx.settings.licences as Licence[] | undefined) ?? [];
const save = (ctx: ModCtx, a: Asset[]) => ctx.saveSettings({ assets: a });
const today = (ctx: ModCtx) => { const d = ctx.now(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400_000);

/** Le type d'appareil deviné d'après ce qu'on sait (registre, fabricant, nom). Pur. */
export function guessKind(x: { kind?: string; model?: string; name?: string; maker?: string; os?: string }): string {
  const t = `${x.kind ?? ''} ${x.model ?? ''} ${x.name ?? ''} ${x.maker ?? ''} ${x.os ?? ''}`.toLowerCase();
  if (/imprim|printer|epson|brother|canon|hp ?(laser|desk|office)/.test(t)) return 'imprimante';
  if (/t[eé]l[eé]|tv|bravia|roku|chromecast|fire ?tv|shield/.test(t)) return 'télé';
  if (/cam[eé]ra|hikvision|dahua|reolink|ezviz/.test(t)) return 'caméra';
  if (/iphone|android|pixel|galaxy s|t[eé]l[eé]phone|phone|xiaomi|redmi|oppo|huawei p/.test(t)) return 'téléphone';
  if (/ipad|tablet|tablette|galaxy tab/.test(t)) return 'tablette';
  if (/routeur|router|box|livebox|freebox|switch|access point|ubiquiti|unifi|tp-link|mikrotik|starlink|r[eé]seau/.test(t)) return 'réseau';
  if (/playstation|xbox|nintendo|console/.test(t)) return 'console';
  if (/esp32|espressif|tasmota|shelly|sonoff|tuya|objet|iot|ampoule|prise/.test(t)) return 'objet connecté';
  if (/nas|synology|qnap|serveur|server|proxmox|raspberry/.test(t)) return 'serveur';
  if (/macbook|laptop|portable|thinkpad|xps/.test(t)) return 'portable';
  if (/windows|linux|mac|pc|ordinateur|desktop|imac/.test(t)) return 'ordinateur';
  return 'autre';
}
function nextTag(list: Asset[]): string { const n = Math.max(0, ...list.map((a) => Number(/(\d+)$/.exec(a.tag)?.[1] ?? 0))) + 1; return `ODN-${String(n).padStart(4, '0')}`; }
function find(ctx: ModCtx, q: unknown): Asset {
  const x = s(q).toLowerCase(); if (!x) throw new Error('quel appareil ? (nom, étiquette, IP ou MAC)');
  const l = assets(ctx), a = l.find((y) => y.tag.toLowerCase() === x || y.ip === x || y.mac?.toLowerCase() === x || y.serial?.toLowerCase() === x || y.name.toLowerCase() === x) ?? l.find((y) => y.name.toLowerCase().includes(x));
  if (!a) throw new Error(`appareil « ${s(q)} » introuvable dans l'inventaire`); return a;
}
const put = (ctx: ModCtx, a: Asset, what: string) => { a.history = [...a.history, { t: ctx.now().getTime(), what }].slice(-100); save(ctx, assets(ctx).map((x) => (x.id === a.id ? a : x))); };

/**
 * Ajoute ou met à jour les appareils vus sur le réseau : une fiche par MAC (ou par IP sans MAC). Ce que tu
 * as écrit à la main (nom, pièce, propriétaire…) n'est jamais écrasé. Rend les nouvelles fiches. Pur sur la liste.
 */
export function merge(list: Asset[], seen: Seen[], now: number, vendor: (mac: string) => string = () => ''): { list: Asset[]; added: Asset[]; updated: number } {
  const out = list.map((a) => ({ ...a })), added: Asset[] = []; let updated = 0;
  for (const x of seen) {
    const mac = x.mac?.toLowerCase();
    const a = (mac ? out.find((y) => y.mac?.toLowerCase() === mac) : undefined) ?? (!mac ? out.find((y) => y.ip === x.ip && !y.mac) : undefined);
    if (a) {
      const before = JSON.stringify([a.ip, a.model, a.os, a.maker]);
      if (x.ip && a.ip !== x.ip) { a.history = [...a.history, { t: now, what: `nouvelle adresse ${x.ip} (avant ${a.ip ?? '—'})` }]; a.ip = x.ip; }
      a.model ||= x.model; a.os ||= x.os; a.maker ||= mac ? vendor(mac) || undefined : undefined;
      if (x.online !== false) a.lastSeen = x.lastSeen ?? now;
      if (JSON.stringify([a.ip, a.model, a.os, a.maker]) !== before) updated++;
      continue;
    }
    const maker = mac ? vendor(mac) || undefined : undefined;
    const n: Asset = { id: randomBytes(6).toString('hex'), tag: nextTag([...out]), name: x.name || x.model || (maker ? `${maker} (${x.ip})` : `Appareil ${x.ip}`), kind: guessKind({ ...x, maker }), maker, model: x.model, mac, ip: x.ip, os: x.os, state: 'en service', source: 'réseau', firstSeen: x.firstSeen ?? now, lastSeen: x.lastSeen ?? now, history: [{ t: now, what: 'vu sur le réseau, fiche créée par Odin' }] };
    out.push(n); added.push(n);
  }
  return { list: out, added, updated };
}
/** Les garanties qui finissent dans les `within` jours (ou déjà finies depuis moins de 7 jours), les prêts en retard. Pur. */
export function due(list: Asset[], on: string, within = 30): { warranty: Array<{ a: Asset; left: number }>; late: Array<{ a: Asset; late: number }> } {
  return {
    warranty: list.filter((a) => a.warrantyEnd && a.state !== 'retiré').map((a) => ({ a, left: days(on, a.warrantyEnd!) })).filter((x) => x.left <= within && x.left >= -7).sort((x, y) => x.left - y.left),
    late: list.filter((a) => a.loan?.due && a.loan.due < on).map((a) => ({ a, late: days(a.loan!.due!, on) })),
  };
}
const csvCell = (v: unknown) => { const x = s(v).replace(/^[=+\-@]/, "'$&"); return /[;"\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
const COLS: Array<[string, keyof Asset]> = [['etiquette', 'tag'], ['nom', 'name'], ['type', 'kind'], ['fabricant', 'maker'], ['modele', 'model'], ['serie', 'serial'], ['mac', 'mac'], ['ip', 'ip'], ['piece', 'location'], ['proprietaire', 'owner'], ['etat', 'state'], ['achat', 'bought'], ['prix', 'price'], ['fournisseur', 'vendor'], ['garantie', 'warrantyEnd'], ['notes', 'notes']];
/** Export CSV (séparateur « ; » pour Excel en français ; les cellules qui commencent par = + - @ sont neutralisées). Pur. */
export function toCsv(list: Asset[]): string { return [COLS.map((c) => c[0]).join(';'), ...list.map((a) => COLS.map(([, k]) => csvCell(a[k])).join(';'))].join('\n'); }
/** Import CSV : une ligne par appareil, colonnes reconnues par leur nom (« nom » obligatoire). Pur. */
export function fromCsv(text: string): Array<Partial<Asset>> {
  const rows = text.replace(/\r/g, '').split('\n').filter((l) => l.trim()); if (!rows.length) return [];
  const sep = rows[0].includes(';') ? ';' : ',';
  const split = (l: string) => { const out: string[] = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === sep) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out.map((x) => x.trim()); };
  const head = split(rows[0]).map((h) => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, ''));
  const idx = (n: string) => head.indexOf(n);
  if (idx('nom') < 0) throw new Error('il faut au moins une colonne « nom »');
  return rows.slice(1).map((l) => { const v = split(l), o: Partial<Asset> = {}; for (const [h, k] of COLS) { const i = idx(h); if (i >= 0 && v[i]) (o as Record<string, unknown>)[k] = k === 'price' ? Number(v[i].replace(',', '.')) || undefined : v[i].replace(/^'([=+\-@])/, '$1'); } return o; }).filter((o) => o.name);
}

// ---------------- Le graphe ----------------
const COLOR: Record<State, string> = { 'en service': '#E8EAEC', 'en stock': '#4F9DDE', 'en réparation': '#F0A040', prêté: '#B48CF0', retiré: '#7d8791' };
export function assetGraph(list: Asset[], on: string, online: (a: Asset) => boolean): { nodes: GraphNode[]; edges: GraphEdge[]; details: Record<string, GraphDetail> } {
  const nodes: GraphNode[] = [{ id: 'odin', label: 'Odin · Atlas', sub: `${list.length} appareil(s)`, square: true, size: 18, color: '#4F9DDE', hub: true }], edges: GraphEdge[] = [], details: Record<string, GraphDetail> = {};
  const dd0 = due(list, on);
  details.odin = { kind: 'Atlas', title: 'L\'inventaire', subtitle: `${list.length} appareil(s)`, chips: [{ label: `${list.filter(online).length} en ligne`, tone: 'bon' }, ...(dd0.warranty.length ? [{ label: `${dd0.warranty.length} garantie(s) à surveiller`, tone: 'attention' as Tone }] : []), ...(dd0.late.length ? [{ label: `${dd0.late.length} prêt(s) en retard`, tone: 'mauvais' as Tone }] : [])], rows: (['en service', 'en stock', 'en réparation', 'prêté', 'retiré'] as State[]).map((st) => ({ k: st, v: String(list.filter((a) => a.state === st).length) })), actions: [{ action: 'synchroniser', label: 'Ajouter les appareils du réseau', input: {}, primary: true }, { action: 'exporter', label: 'Exporter (CSV)', input: {} }] };
  const places = [...new Set(list.map((a) => a.location || 'Sans pièce'))];
  for (const p of places) { const inP = list.filter((a) => (a.location || 'Sans pièce') === p); nodes.push({ id: `l:${p}`, label: p, sub: `${inP.length} appareil(s)`, square: true, size: 12, color: '#7FB3E6', hub: true }); edges.push({ a: 'odin', b: `l:${p}`, w: 2, color: '#7FB3E6' }); details[`l:${p}`] = { kind: 'Pièce', title: p, rows: inP.map((a) => ({ k: a.name, v: `${a.kind} · ${a.state}`, src: a.tag })) }; }
  const owners = [...new Set(list.map((a) => a.loan?.to || a.owner).filter(Boolean))] as string[];
  for (const o of owners) { nodes.push({ id: `o:${o}`, label: o, sub: 'personne', size: 6, color: '#B48CF0' }); details[`o:${o}`] = { kind: 'Personne', title: o, rows: list.filter((a) => a.owner === o || a.loan?.to === o).map((a) => ({ k: a.name, v: a.loan?.to === o ? `prêté${a.loan.due ? ` jusqu'au ${a.loan.due}` : ''}` : 'à elle', src: a.tag })) }; }
  const d = due(list, on);
  for (const a of list) {
    const id = `a:${a.id}`, w = d.warranty.find((x) => x.a.id === a.id), late = d.late.find((x) => x.a.id === a.id), on1 = online(a);
    nodes.push({ id, label: a.name, sub: `${a.tag} · ${a.kind}`, size: 8, color: COLOR[a.state], off: a.state === 'retiré', ring: late ? '#EE6A55' : w ? '#F0A040' : on1 ? '#57C98A' : undefined, search: `${a.tag} ${a.ip ?? ''} ${a.mac ?? ''} ${a.serial ?? ''} ${a.model ?? ''}` });
    edges.push({ a: id, b: `l:${a.location || 'Sans pièce'}` });
    const who = a.loan?.to || a.owner; if (who) edges.push({ a: id, b: `o:${who}`, dash: Boolean(a.loan), color: a.loan ? '#B48CF0' : undefined });
    const tone: Tone = a.state === 'en service' ? 'bon' : a.state === 'retiré' ? 'neutre' : 'attention';
    details[id] = {
      kind: `Appareil · ${a.kind}`, title: a.name, subtitle: `${a.tag}${a.location ? ` · ${a.location}` : ''}${a.owner ? ` · ${a.owner}` : ''}`,
      chips: [{ label: a.state, tone }, ...(on1 ? [{ label: 'En ligne', tone: 'bon' as Tone }] : a.ip ? [{ label: 'Pas vu récemment' }] : []), ...(w ? [{ label: w.left < 0 ? `Garantie finie depuis ${-w.left} j` : `Garantie : ${w.left} j`, tone: 'attention' as Tone }] : []), ...(late ? [{ label: `Prêt en retard de ${late.late} j`, tone: 'mauvais' as Tone }] : []), { label: `ajouté par ${a.source}` }],
      rows: [
        { k: 'Fabricant', v: a.maker || '—', src: a.mac && a.source !== 'toi' ? 'déduit de la MAC' : '' }, { k: 'Modèle', v: a.model || '—' }, { k: 'N° de série', v: a.serial || '—' },
        { k: 'MAC', v: a.mac || '—' }, { k: 'IP', v: a.ip || '—', src: a.lastSeen ? `vu le ${new Date(a.lastSeen).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}` : '' },
        ...(a.os ? [{ k: 'Système', v: a.os }] : []),
        { k: 'Achat', v: [a.bought, a.price !== undefined ? `${a.price.toLocaleString('fr-FR')} €` : '', a.vendor].filter(Boolean).join(' · ') || '—' },
        { k: 'Garantie', v: a.warrantyEnd ? `jusqu'au ${a.warrantyEnd}` : '—' },
        ...(a.loan ? [{ k: 'Prêté à', v: `${a.loan.to} depuis le ${a.loan.since}${a.loan.due ? `, retour prévu le ${a.loan.due}` : ''}` }] : []),
        ...(a.notes ? [{ k: 'Notes', v: a.notes }] : []),
      ],
      list: { title: 'Historique', items: [...a.history].reverse().slice(0, 10).map((h) => ({ text: h.what, meta: new Date(h.t).toLocaleDateString('fr-FR') })) },
      actions: [{ action: 'etiquette', label: 'Étiquette QR', input: { appareil: a.tag }, primary: true }, a.loan ? { action: 'rendre', label: 'Rendu', input: { appareil: a.tag } } : { action: 'preter', label: 'Prêter…', input: { appareil: a.tag, a: '', retour: '' } }, ...(a.ip ? [{ action: 'surveiller', label: 'Surveiller (Pulsar)', input: { appareil: a.tag } }, { action: 'lire', label: 'Voir ses paquets (Ariane)', input: { ip: a.ip }, module: 'ran' }] : [])],
    };
  }
  return { nodes, edges, details };
}

const ADD: Param[] = [
  { key: 'nom', label: 'Nom', kind: 'text', required: true },
  { key: 'type', label: 'Type', kind: 'select', options: KINDS, default: 'ordinateur' },
  { key: 'fabricant', label: 'Fabricant', kind: 'text', default: '' }, { key: 'modele', label: 'Modèle', kind: 'text', default: '' }, { key: 'serie', label: 'N° de série', kind: 'text', default: '' },
  { key: 'mac', label: 'Adresse MAC', kind: 'text', default: '' }, { key: 'ip', label: 'Adresse IP', kind: 'text', default: '' },
  { key: 'piece', label: 'Pièce (salon, bureau…)', kind: 'text', default: '' }, { key: 'proprietaire', label: 'À qui', kind: 'text', default: '' },
  { key: 'achat', label: 'Date d\'achat (AAAA-MM-JJ)', kind: 'text', default: '' }, { key: 'prix', label: 'Prix (€)', kind: 'text', default: '' }, { key: 'fournisseur', label: 'Fournisseur', kind: 'text', default: '' },
  { key: 'garantie', label: 'Fin de garantie (AAAA-MM-JJ)', kind: 'text', default: '' }, { key: 'notes', label: 'Notes', kind: 'textarea', default: '' },
];
/** Les champs d'une fiche tapés dans un formulaire → vérifiés. */
function fields(i: Record<string, unknown>, partial: boolean): Partial<Asset> {
  const o: Partial<Asset> = {}, set = (k: keyof Asset, v: unknown) => { if (s(v) || !partial) (o as Record<string, unknown>)[k] = s(v) || undefined; };
  if (s(i.nom) || !partial) { if (!s(i.nom) && !partial) throw new Error('donne un nom'); o.name = s(i.nom).slice(0, 80) || undefined; }
  if (s(i.type)) { if (!KINDS.includes(s(i.type))) throw new Error(`type : ${KINDS.join(', ')}`); o.kind = s(i.type); }
  set('maker', i.fabricant); set('model', i.modele); set('serial', i.serie); set('location', i.piece); set('owner', i.proprietaire); set('vendor', i.fournisseur); set('notes', i.notes);
  if (s(i.mac)) { const m = s(i.mac).toLowerCase().replace(/-/g, ':'); if (!MAC.test(m)) throw new Error('adresse MAC invalide (aa:bb:cc:dd:ee:ff)'); o.mac = m; }
  if (s(i.ip)) { if (!/^[\d.]+$|^[0-9a-f:]+$/i.test(s(i.ip))) throw new Error('adresse IP invalide'); o.ip = s(i.ip); }
  for (const [k, f] of [['achat', 'bought'], ['garantie', 'warrantyEnd']] as const) if (s(i[k])) { if (!DATE.test(s(i[k]))) throw new Error(`${k} : date sous la forme 2026-11-12`); o[f] = s(i[k]); }
  if (s(i.prix)) { const p = Number(s(i.prix).replace(/\s/g, '').replace(',', '.').replace(/€$/, '')); if (!Number.isFinite(p) || p < 0) throw new Error('prix invalide'); o.price = p; }
  return o;
}

export function askr(o: { seen?: () => Seen[] } = {}): Module {
  /** Ce qui est vu sur le réseau : le registre d'Odin et les baux du DHCP de Sphinx. */
  const seenNow = async (ctx: ModCtx): Promise<Seen[]> => {
    const out = new Map<string, Seen>();
    for (const x of o.seen?.() ?? []) out.set(x.mac?.toLowerCase() || x.ip, x);
    const leases = ((await ctx.call('vidarr', 'baux', {}).catch(() => undefined))?.data as Array<{ mac: string; ip: string; name?: string; expires: number; first?: number }> | undefined) ?? [];
    for (const l of leases) { const k = l.mac.toLowerCase(), x = out.get(k); out.set(k, { ...x, ip: l.ip, mac: k, name: x?.name || l.name, lastSeen: Math.max(x?.lastSeen ?? 0, l.expires > Date.now() ? Date.now() : 0) || x?.lastSeen, firstSeen: x?.firstSeen ?? l.first }); }
    return [...out.values()];
  };
  const sync = async (ctx: ModCtx) => { const r = merge(assets(ctx), await seenNow(ctx), ctx.now().getTime(), vendorOf); if (r.added.length || r.updated) save(ctx, r.list); return r; };
  const m: Module = {
    id: 'askr', name: 'Atlas', family: 'Machines',
    what: 'L\'inventaire du matériel : une fiche par appareil (modèle, série, MAC, IP, pièce, propriétaire, achat, garantie), étiquettes QR, prêts et licences, avec les appareils du réseau ajoutés tout seuls.',
    does: ['fiche par appareil : type, fabricant, modèle, n° de série, MAC, IP, système, pièce, propriétaire, achat, prix, fournisseur, garantie, notes, historique', 'appareils vus sur le réseau (registre d\'Odin, DHCP de Sphinx) ajoutés tout seuls, sans écraser ce que tu as écrit', 'état : en service, en stock, en réparation, prêté, retiré', 'prêts (à qui, retour prévu) et alerte de retard ; alerte avant la fin de garantie', 'étiquette QR imprimable pour chaque appareil', 'licences (postes utilisés, expiration), clé rangée dans le coffre Thésauros', 'graphe : pièces, appareils, personnes ; export et import CSV (Excel)'],
    from: ['Snipe-IT', 'GLPI', 'NetBox'], upstream: ['grokability/snipe-it', 'glpi-project/glpi', 'netbox-community/netbox'],
    words: ['inventaire du matériel', 'inventaire du materiel', 'inventaire matériel', 'mon inventaire', 'inventorier', 'fiche matériel', 'mon matériel', 'garantie', 'numéro de série', 'numero de serie', 'étiquette', 'prêter', 'preter', 'prêté', 'licence', 'licences', 'parc matériel'],
    actions: [
      { id: 'ajouter', label: 'Ajouter un appareil', what: 'Une nouvelle fiche dans l\'inventaire', params: ADD, run: (ctx, i) => {
        const f = fields(i, false), l = assets(ctx);
        if (f.mac && l.some((a) => a.mac === f.mac)) throw new Error(`cette MAC est déjà dans l'inventaire (${l.find((a) => a.mac === f.mac)!.tag})`);
        if (f.serial && l.some((a) => a.serial === f.serial)) throw new Error('ce numéro de série est déjà dans l\'inventaire');
        const a: Asset = { id: randomBytes(6).toString('hex'), tag: nextTag(l), name: f.name!, kind: f.kind ?? guessKind({ name: f.name, model: f.model, maker: f.maker }), ...f, maker: f.maker ?? (f.mac ? vendorOf(f.mac) || undefined : undefined), state: 'en service', source: 'toi', firstSeen: ctx.now().getTime(), history: [{ t: ctx.now().getTime(), what: 'fiche créée' }] } as Asset;
        save(ctx, [...l, a]);
        return { text: `📦 ${a.name} ajouté (${a.tag}, ${a.kind}${a.warrantyEnd ? `, garantie jusqu'au ${a.warrantyEnd}` : ''}).`, data: { tag: a.tag } };
      }, undo: (_i, r) => ({ action: 'supprimer', input: { appareil: (r.data as { tag?: string } | undefined)?.tag }, label: 'Supprimer la fiche' }) },
      { id: 'modifier', label: 'Modifier une fiche', what: 'Change ce qui est renseigné (les champs vides ne changent pas)', quick: false, params: [{ key: 'appareil', label: 'Appareil (nom, étiquette, IP, MAC)', kind: 'text', required: true }, ...ADD.map((p) => ({ ...p, required: false, default: '' })), { key: 'etat', label: 'État', kind: 'select', options: ['', ...STATES], default: '' }], run: (ctx, i) => {
        const a = { ...find(ctx, i.appareil) }, f = fields(i, true), changed = Object.keys(f);
        if (s(i.etat)) { if (!STATES.includes(s(i.etat) as State)) throw new Error(`état : ${STATES.join(', ')}`); if (a.state !== s(i.etat)) { changed.push('état'); a.state = s(i.etat) as State; } }
        if (!changed.length) throw new Error('rien à changer');
        Object.assign(a, f); put(ctx, a, `modifié : ${changed.join(', ')}`);
        return { text: `✏️ ${a.name} (${a.tag}) : ${changed.join(', ')} mis à jour.` };
      } },
      { id: 'chercher', label: 'Chercher', what: 'Par nom, étiquette, modèle, série, IP, MAC, pièce ou personne', read: true, params: [{ key: 'q', label: 'Recherche', kind: 'text', required: true }], run: (ctx, i) => {
        // « * » : tout l'inventaire (Plume en tire un schéma du réseau).
        const q = s(i.q).toLowerCase(), r = assets(ctx).filter((a) => q === '*' || [a.tag, a.name, a.kind, a.maker, a.model, a.serial, a.ip, a.mac, a.location, a.owner, a.loan?.to].some((x) => x?.toLowerCase().includes(q)));
        return { text: r.map((a) => `- ${a.tag} · ${a.name} (${a.kind}${a.model ? `, ${a.model}` : ''}) · ${a.state}${a.location ? ` · ${a.location}` : ''}${a.ip ? ` · ${a.ip}` : ''}`).join('\n') || 'Rien trouvé.', data: r.map((a) => ({ nom: a.name, genre: a.kind, ip: a.ip, etat: a.state })) };
      } },
      { id: 'synchroniser', label: 'Ajouter les appareils du réseau', what: 'Ceux que le registre d\'Odin et le DHCP ont vus (rien n\'est écrasé)', run: async (ctx) => { const r = await sync(ctx); return { text: r.added.length ? `🔄 ${r.added.length} appareil(s) ajouté(s) : ${r.added.map((a) => `${a.name} (${a.tag})`).join(', ')}.${r.updated ? ` ${r.updated} fiche(s) mise(s) à jour.` : ''}` : r.updated ? `🔄 ${r.updated} fiche(s) mise(s) à jour (adresse, modèle).` : 'Rien de nouveau sur le réseau.' }; } },
      { id: 'preter', label: 'Prêter', what: 'À qui, jusqu\'à quand', params: [{ key: 'appareil', label: 'Appareil', kind: 'text', required: true }, { key: 'a', label: 'À qui', kind: 'text', required: true }, { key: 'retour', label: 'Retour prévu (AAAA-MM-JJ, facultatif)', kind: 'text', default: '' }], run: (ctx, i) => {
        const a = { ...find(ctx, i.appareil) }; if (!s(i.a)) throw new Error('à qui ?'); if (a.loan) throw new Error(`déjà prêté à ${a.loan.to}`); if (a.state === 'retiré') throw new Error('appareil retiré de l\'inventaire');
        if (s(i.retour) && (!DATE.test(s(i.retour)) || s(i.retour) < today(ctx))) throw new Error('retour : une date à venir, sous la forme 2026-12-31');
        a.loan = { to: s(i.a).slice(0, 60), since: today(ctx), ...(s(i.retour) ? { due: s(i.retour) } : {}) }; a.state = 'prêté'; put(ctx, a, `prêté à ${a.loan.to}${a.loan.due ? ` jusqu'au ${a.loan.due}` : ''}`);
        return { text: `🤝 ${a.name} prêté à ${a.loan.to}${a.loan.due ? `, retour prévu le ${a.loan.due} (je te préviens s'il n'est pas rendu)` : ''}.` };
      }, undo: (i) => ({ action: 'rendre', input: { appareil: i.appareil }, label: 'Rendu' }) },
      { id: 'rendre', label: 'Rendu', what: 'L\'appareil prêté est revenu', quick: false, params: [{ key: 'appareil', label: 'Appareil', kind: 'text', required: true }], run: (ctx, i) => { const a = { ...find(ctx, i.appareil) }; if (!a.loan) throw new Error('il n\'est pas prêté'); const who = a.loan.to; a.loan = undefined; a.state = 'en service'; put(ctx, a, `rendu par ${who}`); return { text: `✅ ${a.name} rendu par ${who}.` }; } },
      { id: 'etiquette', label: 'Étiquette QR', what: 'Un QR code à coller sur l\'appareil : il ouvre sa fiche', quick: false, read: true, params: [{ key: 'appareil', label: 'Appareil', kind: 'text', required: true }], run: (ctx, i) => {
        const a = find(ctx, i.appareil), text = `ODIN ${a.tag} · ${a.name}${a.serial ? ` · S/N ${a.serial}` : ''}`;
        return { text: `🏷 Étiquette de ${a.name} (${a.tag}).`, data: { svg: qrSvg(text, { scale: 6, margin: 3 }), alt: `QR code de l'étiquette ${a.tag}`, conf: `${a.tag}\n${a.name}\n${[a.maker, a.model].filter(Boolean).join(' ')}${a.serial ? `\nS/N ${a.serial}` : ''}`, label: 'Texte de l\'étiquette', show: true, filename: `etiquette-${a.tag}.txt` } };
      } },
      { id: 'surveiller', label: 'Surveiller avec Pulsar', what: 'Une sonde ping pour cet appareil (alerte s\'il ne répond plus)', quick: false, params: [{ key: 'appareil', label: 'Appareil', kind: 'text', required: true }], run: async (ctx, i) => {
        const a = find(ctx, i.appareil); if (!a.ip) throw new Error('pas d\'adresse IP connue pour cet appareil');
        const r = await ctx.call('vordr', 'ajouter', { nom: a.name, genre: 'ping', cible: a.ip, groupe: a.location || 'Maison', secondes: 60, essais: 3 }, `surveiller ${a.name} (inventaire)`);
        if (r.ok !== false) put(ctx, { ...a }, 'surveillé par Pulsar');
        return { ok: r.ok, text: r.text };
      } },
      { id: 'retirer', label: 'Retirer du service', what: 'Vendu, cassé, donné : la fiche reste dans l\'historique', quick: false, params: [{ key: 'appareil', label: 'Appareil', kind: 'text', required: true }, { key: 'pourquoi', label: 'Pourquoi', kind: 'text', default: '' }], run: (ctx, i) => { const a = { ...find(ctx, i.appareil) }; a.state = 'retiré'; a.loan = undefined; put(ctx, a, `retiré${s(i.pourquoi) ? ` : ${s(i.pourquoi)}` : ''}`); return { text: `📤 ${a.name} retiré du service (la fiche est gardée).` }; } },
      { id: 'supprimer', label: 'Supprimer une fiche', what: 'Efface la fiche et son historique', quick: false, params: [{ key: 'appareil', label: 'Appareil', kind: 'text', required: true }], grave: () => 'effacer la fiche et son historique (pour garder une trace, utilise plutôt « Retirer du service »)', run: (ctx, i) => { const a = find(ctx, i.appareil); save(ctx, assets(ctx).filter((x) => x.id !== a.id)); return { text: `🗑 Fiche ${a.tag} (${a.name}) supprimée.` }; } },
      { id: 'licence', label: 'Ajouter une licence', what: 'Logiciel, nombre de postes, expiration ; la clé va dans le coffre', quick: false, params: [{ key: 'nom', label: 'Logiciel', kind: 'text', required: true }, { key: 'postes', label: 'Nombre de postes', kind: 'number', default: 1 }, { key: 'expire', label: 'Expiration (AAAA-MM-JJ, facultatif)', kind: 'text', default: '' }, { key: 'cle', label: 'Clé de licence (rangée dans le coffre, jamais affichée)', kind: 'password', default: '' }], run: async (ctx, i) => {
        const name = s(i.nom).slice(0, 80); if (!name) throw new Error('quel logiciel ?'); if (licences(ctx).some((l) => l.name.toLowerCase() === name.toLowerCase())) throw new Error('cette licence existe déjà');
        if (s(i.expire) && !DATE.test(s(i.expire))) throw new Error('expiration sous la forme 2026-12-31');
        const seats = Math.max(1, Math.min(10000, Number(i.postes) || 1));
        let inVault = false;
        if (s(i.cle)) { const r = await ctx.call('brisingamen', 'ajouter', { nom: `Licence ${name}`, identifiant: name, mot_de_passe: s(i.cle), coffre: 'TOUFATECH' }, `ranger la clé de licence de ${name}`); inVault = r.ok !== false; if (!inVault) throw new Error(`la clé n'a pas pu aller dans le coffre : ${r.text}`); }
        ctx.saveSettings({ licences: [...licences(ctx), { id: randomBytes(5).toString('hex'), name, seats, ...(s(i.expire) ? { expires: s(i.expire) } : {}), assets: [], inVault }] });
        return { text: `🔑 Licence ${name} : ${seats} poste(s)${s(i.expire) ? `, jusqu'au ${s(i.expire)}` : ''}${inVault ? ' ; clé rangée dans le coffre Thésauros' : ''}.` };
      } },
      { id: 'attribuer', label: 'Attribuer une licence', what: 'Un poste de la licence va à un appareil', quick: false, params: [{ key: 'licence', label: 'Licence', kind: 'text', required: true }, { key: 'appareil', label: 'Appareil', kind: 'text', required: true }], run: (ctx, i) => {
        const ls = licences(ctx), l = ls.find((x) => x.name.toLowerCase() === s(i.licence).toLowerCase()); if (!l) throw new Error('licence introuvable');
        const a = find(ctx, i.appareil); if (l.assets.includes(a.id)) throw new Error('déjà attribuée à cet appareil'); if (l.assets.length >= l.seats) throw new Error(`plus de poste libre (${l.seats} utilisés)`);
        ctx.saveSettings({ licences: ls.map((x) => (x === l ? { ...l, assets: [...l.assets, a.id] } : x)) }); put(ctx, { ...a }, `licence ${l.name} attribuée`);
        return { text: `🔑 ${l.name} attribuée à ${a.name} (${l.assets.length + 1}/${l.seats} postes).` };
      } },
      { id: 'exporter', label: 'Exporter (CSV)', what: 'Tout l\'inventaire pour Excel', read: true, quick: false, run: (ctx) => ({ text: `📄 ${assets(ctx).length} appareil(s) exporté(s).`, data: { conf: toCsv(assets(ctx)), filename: `inventaire-${today(ctx)}.csv`, label: 'Voir le fichier CSV' } }) },
      { id: 'importer', label: 'Importer (CSV)', what: 'Colle un tableau (colonnes : nom, type, fabricant, modele, serie, mac, ip, piece, proprietaire, achat, prix, fournisseur, garantie, notes)', quick: false, params: [{ key: 'csv', label: 'Contenu CSV', kind: 'textarea', required: true }], run: (ctx, i) => {
        const rows = fromCsv(s(i.csv)); if (!rows.length) throw new Error('aucune ligne comprise');
        let l = assets(ctx); const added: string[] = [], skipped: string[] = [];
        for (const r of rows) {
          if ((r.mac && l.some((a) => a.mac === r.mac?.toLowerCase())) || (r.serial && l.some((a) => a.serial === r.serial))) { skipped.push(String(r.name)); continue; }
          const a: Asset = { id: randomBytes(6).toString('hex'), tag: nextTag(l), kind: r.kind && KINDS.includes(r.kind) ? r.kind : guessKind(r), ...r, mac: r.mac?.toLowerCase(), name: String(r.name).slice(0, 80), state: STATES.includes(r.state as State) ? r.state as State : 'en service', source: 'import', firstSeen: ctx.now().getTime(), history: [{ t: ctx.now().getTime(), what: 'importé (CSV)' }] } as Asset;
          l = [...l, a]; added.push(a.tag);
        }
        save(ctx, l);
        return { text: `📥 ${added.length} appareil(s) importé(s)${skipped.length ? ` ; ${skipped.length} déjà présent(s) (même MAC ou série) : ${skipped.slice(0, 5).join(', ')}` : ''}.` };
      } },
    ],
    view(ctx) {
      const l = assets(ctx), on = today(ctx), dd = due(l, on), now = ctx.now().getTime();
      const online = (a: Asset) => Boolean(a.lastSeen && now - a.lastSeen < 15 * 60_000);
      const g = assetGraph(l, on, online), ls = licences(ctx);
      const value = l.filter((a) => a.state !== 'retiré').reduce((n, a) => n + (a.price ?? 0), 0);
      return {
        subtitle: `${l.length} appareil(s) · ${l.filter((a) => a.state === 'prêté').length} prêté(s) · ${dd.warranty.length} garantie(s) bientôt finie(s)`,
        kpis: [
          { label: 'Appareils', value: String(l.filter((a) => a.state !== 'retiré').length) }, { label: 'En ligne', value: String(l.filter(online).length), tone: 'bon' },
          { label: 'Garanties à surveiller', value: String(dd.warranty.length), tone: dd.warranty.length ? 'attention' : 'bon' }, { label: 'Prêts en retard', value: String(dd.late.length), tone: dd.late.length ? 'mauvais' : 'bon' },
          { label: 'Valeur d\'achat', value: `${value.toLocaleString('fr-FR')} €` },
        ],
        sections: [
          { kind: 'graph', title: 'Graphe de l\'inventaire', ...g, empty: 'Inventaire vide : « Ajouter les appareils du réseau », ou ajoute un appareil à droite.', legend: [['#4F9DDE', 'Odin, pièce, en stock'], ['#E8EAEC', 'en service'], ['#57C98A', 'en ligne'], ['#F0A040', 'réparation / garantie'], ['#B48CF0', 'prêté / personne'], ['#EE6A55', 'prêt en retard']] },
          { kind: 'table', title: 'Appareils', columns: ['Étiquette', 'Nom', 'Type', 'Modèle', 'IP', 'Pièce', 'État', 'Garantie'], empty: 'Aucun appareil.', rows: l.map((a) => ({ cells: [a.tag, a.name, a.kind, [a.maker, a.model].filter(Boolean).join(' ') || '—', a.ip ?? '—', a.location ?? '—', a.loan ? `prêté à ${a.loan.to}` : a.state, a.warrantyEnd ?? '—'], tone: dd.late.some((x) => x.a.id === a.id) ? 'mauvais' as const : dd.warranty.some((x) => x.a.id === a.id) ? 'attention' as const : undefined, actions: [{ action: 'etiquette', label: 'Étiquette', input: { appareil: a.tag } }] })) },
          { kind: 'table', title: 'Licences', columns: ['Logiciel', 'Postes', 'Expiration', 'Clé'], empty: 'Aucune licence.', rows: ls.map((x) => ({ cells: [x.name, `${x.assets.length} / ${x.seats}`, x.expires ?? '—', x.inVault ? 'dans le coffre' : '—'], tone: x.expires && x.expires < on ? 'mauvais' as const : undefined })) },
        ],
        side: [{ kind: 'form', title: 'Ajouter un appareil', action: 'ajouter', submit: 'Ajouter', params: ADD }, { kind: 'form', title: 'Prêter un appareil', action: 'preter', submit: 'Prêter', params: m.actions.find((a) => a.id === 'preter')!.params! }],
      };
    },
    // Chaque heure : les appareils du réseau s'ajoutent ; chaque jour, garanties et prêts en retard.
    watch: { every: 3600, async run(ctx) {
      try { await sync(ctx); } catch { /* registre indisponible : au prochain tour */ }
      const on = today(ctx); if (ctx.settings.checkedOn === on) return;
      const dd = due(assets(ctx), on);
      for (const { a, left } of dd.warranty) ctx.alert({ level: left <= 7 ? 'haute' : 'moyenne', title: left < 0 ? `Garantie de ${a.name} finie depuis ${-left} jour(s)` : `Garantie de ${a.name} : plus que ${left} jour(s)`, detail: `${a.tag}${a.model ? ` · ${a.model}` : ''}${a.serial ? ` · S/N ${a.serial}` : ''}. Si l'appareil a un défaut, c'est le moment de le faire réparer.`, key: `askr-garantie-${a.id}` });
      for (const { a, late } of dd.late) ctx.alert({ level: 'moyenne', title: `${a.name} n'est pas rendu (${late} jour(s) de retard)`, detail: `Prêté à ${a.loan!.to} le ${a.loan!.since}, retour prévu le ${a.loan!.due}.`, key: `askr-pret-${a.id}` });
      for (const l of licences(ctx)) if (l.expires) { const left = days(on, l.expires); if (left <= 30 && left >= -7) ctx.alert({ level: 'moyenne', title: `Licence ${l.name} : ${left < 0 ? `expirée depuis ${-left} jour(s)` : `expire dans ${left} jour(s)`}`, key: `askr-licence-${l.id}` }); }
      ctx.saveSettings({ checkedOn: on });
    } },
  };
  return m;
}
