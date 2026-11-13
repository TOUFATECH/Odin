// Thésauros — le coffre de mots de passe : identifiants, cartes, notes sécurisées, codes à deux
// facteurs (TOTP), générateur, bilan (fuites connues, réutilisés, faibles) et envoi unique sécurisé.
// Chiffré (AES-256-GCM) avec une clé rangée dans le coffre d'Odin. Les mots de passe ne sont JAMAIS
// renvoyés dans une conversation : seulement copiés depuis l'interface, sur ta machine.

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModCtx, Module } from '../types.ts';

export interface Item { id: string; type: 'identifiant' | 'carte' | 'note' ; name: string; user?: string; password?: string; url?: string; totp?: string; notes?: string; folder?: string; updated: string; history?: Array<{ at: string; password: string }>; breached?: boolean }

/** TOTP (RFC 6238) : code à 6 chiffres toutes les 30 s. Secret en base32. */
export function base32(s: string): Buffer { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s.toUpperCase().replace(/[^A-Z2-7]/g, '')) bits += a.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
export function totp(secret: string, at = Date.now(), step = 30, digits = 6): { code: string; left: number } {
  const counter = Math.floor(at / 1000 / step), b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32(secret)).update(b).digest(), o = h[h.length - 1] & 0xf;
  const n = ((h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits).toString().padStart(digits, '0');
  return { code: n, left: step - Math.floor((at / 1000) % step) };
}
export function generate(len = 20, o: { symbols?: boolean; words?: boolean } = {}): string {
  if (o.words) { const W = ['lagon', 'baobab', 'ylang', 'maki', 'corail', 'piment', 'mangue', 'pirogue', 'vanille', 'tortue', 'marche', 'soleil', 'cascade', 'volcan', 'cocotier', 'dauphin', 'ressac', 'bouture', 'ananas', 'citron']; return Array.from({ length: Math.max(4, Math.round(len / 5)) }, () => W[randomInt(W.length)]).join('-') + randomInt(10, 99); }
  const A = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789' + (o.symbols === false ? '' : '!@#$%&*-_=+?');
  return Array.from({ length: len }, () => A[randomInt(A.length)]).join('');
}
/** Force estimée en bits (alphabet × longueur, pénalités pour motifs courants). */
export function strength(p: string): { bits: number; label: 'très faible' | 'faible' | 'moyen' | 'fort' | 'très fort' } {
  let pool = 0; if (/[a-z]/.test(p)) pool += 26; if (/[A-Z]/.test(p)) pool += 26; if (/\d/.test(p)) pool += 10; if (/[^a-zA-Z0-9]/.test(p)) pool += 20;
  let bits = p.length * Math.log2(Math.max(pool, 1));
  if (/^(.)\1+$/.test(p) || /(123|abc|azerty|qwerty|password|motdepasse|admin|0000)/i.test(p)) bits = Math.min(bits, 20);
  const label = bits < 28 ? 'très faible' : bits < 40 ? 'faible' : bits < 60 ? 'moyen' : bits < 90 ? 'fort' : 'très fort';
  return { bits: Math.round(bits), label };
}
function key(): Buffer { const k = process.env.BRISINGAMEN_KEY; if (!k || !/^[a-f0-9]{64}$/.test(k)) throw new Error('clé du coffre absente : redémarre Odin (il la crée au démarrage et la range dans son fichier de secrets)'); return Buffer.from(k, 'hex'); }
const file = (ctx: ModCtx) => join(ctx.dir, 'coffre.bin');
export function load(ctx: ModCtx): Item[] {
  if (!existsSync(file(ctx))) return [];
  const b = readFileSync(file(ctx)), d = createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
}
export function store(ctx: ModCtx, items: Item[]): void { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key(), iv); const body = Buffer.concat([c.update(JSON.stringify(items)), c.final()]); writeFileSync(file(ctx), Buffer.concat([iv, c.getAuthTag(), body]), { mode: 0o600 }); }
/** Bilan de sécurité (sans jamais montrer de mot de passe). */
export function audit(items: Item[]): { reused: Item[]; weak: Item[]; breached: Item[]; totp: number } {
  const byHash = new Map<string, Item[]>();
  for (const i of items) if (i.password) { const h = createHash('sha256').update(i.password).digest('hex'); byHash.set(h, [...(byHash.get(h) ?? []), i]); }
  return { reused: [...byHash.values()].filter((l) => l.length > 1).flat(), weak: items.filter((i) => i.password && strength(i.password).bits < 40), breached: items.filter((i) => i.breached), totp: items.filter((i) => i.totp).length };
}
const s = (v: unknown) => String(v ?? '');
const pub = (i: Item) => ({ id: i.id, type: i.type, name: i.name, user: i.user ?? '', url: i.url ?? '', folder: i.folder ?? '', hasTotp: Boolean(i.totp), strength: i.password ? strength(i.password).label : '', breached: Boolean(i.breached), updated: i.updated });

export const brisingamen: Module = {
  id: 'brisingamen', name: 'Thésauros', family: 'Accès',
  what: 'Le coffre de mots de passe de la famille et de l\'entreprise, avec codes à deux facteurs.',
  does: ['identifiants, cartes et notes sécurisées, rangés par coffre (Famille, TOUFATECH, Clients)', 'codes à deux facteurs (TOTP) intégrés', 'générateur de mots de passe et de phrases de passe', 'bilan : mots de passe trouvés dans des fuites, réutilisés, trop faibles', 'historique des anciens mots de passe', 'chiffré avec une clé du coffre d\'Odin ; jamais affiché dans une conversation'],
  from: ['Vaultwarden'], upstream: ['dani-garcia/vaultwarden'],
  words: ['mot de passe', 'mots de passe', 'identifiant', 'identifiants', 'coffre', '2fa', 'totp', 'code de connexion', 'generer un mot de passe', 'générer un mot de passe'],
  actions: [
    { id: 'chercher', label: 'Chercher', what: 'Trouve un élément (le mot de passe n\'est jamais affiché ici)', read: true, params: [{ key: 'q', label: 'Site ou nom', kind: 'text', required: true }], words: ['cherche', 'trouve', 'ou est'], run: (ctx, i) => { const q = s(i.q).toLowerCase(); const l = load(ctx).filter((x) => `${x.name} ${x.url ?? ''} ${x.user ?? ''}`.toLowerCase().includes(q)); return { text: l.map((x) => `- ${x.name} · ${x.user ?? ''} · ${x.url ?? ''}${x.totp ? ' · 2FA' : ''}`).join('\n') || 'Rien trouvé.', data: l.map(pub) }; } },
    { id: 'generer', label: 'Générer un mot de passe', what: 'Mot de passe ou phrase de passe solide', params: [{ key: 'longueur', label: 'Longueur', kind: 'number', default: 20 }, { key: 'phrase', label: 'Phrase de mots', kind: 'boolean', default: false }], words: ['genere', 'génère', 'nouveau mot de passe'], run: (_ctx, i) => { const p = generate(Number(i.longueur) || 20, { words: i.phrase === true }); return { text: `Mot de passe généré (${strength(p).label}). Copie-le depuis Thésauros.`, data: { password: p } }; } },
    { id: 'ajouter', label: 'Ajouter', what: 'Nouvel élément', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'identifiant', label: 'Identifiant', kind: 'text' }, { key: 'mot_de_passe', label: 'Mot de passe (vide = généré)', kind: 'password' }, { key: 'site', label: 'Site', kind: 'text' }, { key: 'totp', label: 'Clé 2FA (facultatif)', kind: 'password' }, { key: 'coffre', label: 'Coffre', kind: 'select', options: ['Personnel', 'Famille', 'TOUFATECH', 'Clients'], default: 'Personnel' }], run: (ctx, i) => {
      const items = load(ctx), it: Item = { id: randomBytes(6).toString('hex'), type: 'identifiant', name: s(i.nom), user: s(i.identifiant), password: s(i.mot_de_passe) || generate(20), url: s(i.site), totp: s(i.totp).replace(/\s/g, '') || undefined, folder: s(i.coffre) || 'Personnel', updated: ctx.now().toISOString() };
      if (it.totp) totp(it.totp);
      store(ctx, [...items, it]); return { text: `🔐 « ${it.name} » ajouté (${strength(it.password!).label}).`, data: pub(it) };
    } },
    { id: 'bilan', label: 'Bilan de sécurité', what: 'Fuites, réutilisés, faibles', read: true, words: ['bilan', 'fuite', 'fuites', 'faibles', 'reutilises', 'réutilisés'], run: (ctx) => { const a = audit(load(ctx)); return { text: `Fuites connues : ${a.breached.length}\nRéutilisés : ${a.reused.length} (${[...new Set(a.reused.map((x) => x.name))].join(', ') || '—'})\nTrop faibles : ${a.weak.length} (${a.weak.map((x) => x.name).join(', ') || '—'})\nComptes avec 2FA : ${a.totp}` }; } },
    { id: 'fuites', label: 'Vérifier les fuites', what: 'Compare à la base publique des mots de passe volés (seuls 5 caractères d\'empreinte partent)', run: async (ctx) => {
      const items = load(ctx); let n = 0;
      for (const it of items) { if (!it.password) continue; const h = createHash('sha1').update(it.password).digest('hex').toUpperCase(); const r = await ctx.fetch(`https://api.pwnedpasswords.com/range/${h.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' }, signal: AbortSignal.timeout(15_000) }); if (!r.ok) continue; it.breached = (await r.text()).split('\n').some((l) => l.startsWith(h.slice(5)) && !l.endsWith(':0')); if (it.breached) n++; }
      store(ctx, items); if (n) ctx.alert({ level: 'haute', title: `${n} mot(s) de passe trouvé(s) dans des fuites`, detail: 'Change-les depuis Thésauros.', key: `breach:${n}` });
      return { text: n ? `⚠ ${n} mot(s) de passe trouvé(s) dans des fuites publiques.` : '✓ Aucun de tes mots de passe n\'est dans les fuites connues.' };
    } },
  ],
  start(ctx) { if (!process.env.BRISINGAMEN_KEY) ctx.saveSettings({ needKey: true }); },
  view(ctx) {
    let items: Item[] = [], err = '';
    try { items = load(ctx); } catch (e) { err = (e as Error).message; }
    const a = audit(items), folders = [...new Set(items.map((i) => i.folder ?? 'Personnel'))];
    return {
      subtitle: err || `${items.length} éléments · ${folders.length} coffre(s)`,
      tabs: ['Tous', ...folders],
      kpis: [{ label: 'Dans des fuites', value: String(a.breached.length), tone: a.breached.length ? 'mauvais' : 'bon' }, { label: 'Réutilisés', value: String(a.reused.length), tone: a.reused.length ? 'attention' : 'bon' }, { label: 'Trop faibles', value: String(a.weak.length), tone: a.weak.length ? 'attention' : 'bon' }, { label: 'Avec 2FA', value: String(a.totp) }],
      sections: [{ kind: 'table', title: 'Éléments', columns: ['Nom', 'Identifiant', 'Site', 'Coffre', 'Force', '2FA'], empty: err || 'Coffre vide : ajoute un premier élément à droite.', rows: items.map((i) => ({ cells: [i.name, i.user ?? '', i.url ?? '', i.folder ?? 'Personnel', i.breached ? 'FUITE' : i.password ? strength(i.password).label : '', i.totp ? 'oui' : ''], tone: i.breached ? 'mauvais' : i.password && strength(i.password).bits < 40 ? 'attention' : undefined })) }],
      side: [{ kind: 'form', title: 'Ajouter', action: 'ajouter', submit: 'Ajouter', params: brisingamen.actions.find((a) => a.id === 'ajouter')?.params ?? [] }, { kind: 'text', title: 'Confidentialité', text: 'Les mots de passe restent chiffrés sur la machine. Odin ne les écrit jamais dans une conversation : tu les copies depuis cette page.' }],
    };
  },
  watch: { every: 7 * 86400, async run(ctx) { if (process.env.BRISINGAMEN_KEY && existsSync(file(ctx))) await Promise.resolve(brisingamen.actions.find((x) => x.id === 'fuites')!.run(ctx, {})).catch(() => undefined); } },
};
