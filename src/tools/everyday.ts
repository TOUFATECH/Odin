// Le quotidien : annuler ce qu'Odin a fait, fiches à garder, budget et abonnements, surveillance de prix,
// énergie de la maison, démarches administratives, et ton « mode » du moment (conduite, réunion, sommeil).
// Odin s'en sert de lui-même quand la conversation s'y prête : pas besoin de demander l'outil.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { undo, undoList } from '../undo.ts';
import { haApi, type HaState } from './homeassistant.ts';
import { brainOf } from './brain.ts';
import { num, obj, str, type Tool, type ToolContext } from './registry.ts';
import { parseWhen, whenFr } from '../cron/reminders.ts';

const s = (v: unknown) => String(v ?? '').trim();
type Kv = { getKv(k: string): string | undefined | null; setKv(k: string, v: string): void };
const read = <T>(kv: Kv, k: string, d: T): T => { try { const v = kv.getKv(k); return v ? JSON.parse(v) as T : d; } catch { return d; } };
const write = (kv: Kv, k: string, v: unknown) => kv.setKv(k, JSON.stringify(v));
const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
const slug = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'fiche';

// ------------------------------------------------------------------ annuler

export const undoRecent: Tool = {
  name: 'undo_recent',
  description: 'Liste ce qu\'Odin a modifié récemment (fichiers, réglages), avec de quoi l\'annuler. « since » en français courant (« hier soir », « depuis 2 heures », « aujourd\'hui »).',
  risk: 'read',
  schema: obj({ since: str('depuis quand (facultatif, 24 h par défaut)') }),
  async run(i, ctx) {
    if (!ctx.home) return 'Indisponible ici.';
    const now = Date.now(), raw = s(i.since);
    let from = now - 86_400_000;
    if (/hier soir/i.test(raw)) { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(18, 0, 0, 0); from = d.getTime(); }
    else if (/aujourd/i.test(raw)) { const d = new Date(); d.setHours(0, 0, 0, 0); from = d.getTime(); }
    else if (raw) { const w = parseWhen(raw.replace(/^depuis\s+/i, 'dans '), new Date(2 * now - now)); if (w) from = now - (w.getTime() - now); }
    const l = undoList(ctx.home).filter((e) => e.at >= from && !e.undone).reverse().slice(0, 40);
    return l.length ? l.map((e) => `${e.id} · ${new Date(e.at).toLocaleString('fr-FR')} · ${e.tool} · ${e.path}${e.backup ? '' : ' (fichier créé)'}`).join('\n') : 'Rien de modifié sur cette période.';
  },
};

export const undoApply: Tool = {
  name: 'undo_apply',
  description: 'Annule des modifications d\'Odin : remet les fichiers (ou réglages) dans leur état d\'avant. ids = identifiants de undo_recent, ou « tout » avec since pour annuler toute une période.',
  risk: 'write',
  schema: obj({ ids: str('identifiants séparés par des virgules, ou « tout »'), since: str('avec « tout » : depuis quand') }, ['ids']),
  summarize: (i) => `annuler ${s(i.ids)}${s(i.since) ? ` depuis ${s(i.since)}` : ''}`,
  async run(i, ctx) {
    if (!ctx.home) return 'Indisponible ici.';
    let ids = s(i.ids).split(/[\s,]+/).filter(Boolean);
    if (ids[0] === 'tout') {
      const from = /hier soir/i.test(s(i.since)) ? (() => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(18, 0, 0, 0); return d.getTime(); })() : Date.now() - 86_400_000;
      ids = undoList(ctx.home).filter((e) => e.at >= from && !e.undone).map((e) => e.id);
    }
    // Du plus récent au plus ancien : chaque fichier revient à son état d'origine.
    const order = undoList(ctx.home).filter((e) => ids.includes(e.id)).sort((a, b) => b.at - a.at);
    return order.length ? order.map((e) => undo(ctx.home!, e.id)).join('\n') : 'Rien à annuler.';
  },
};

// ------------------------------------------------------------------ fiches

// Les fiches vivent dans le Cerveau (dossier « Fiches ») : une seule mémoire, visible dans le graphe.
const notesDir = (ctx: ToolContext) => join(brainOf(ctx).root, 'Fiches');

export const noteSave: Tool = {
  name: 'note_save',
  description: 'Garde une fiche utile pour plus tard (« comment j\'ai installé le NAS », une procédure, une adresse, un plan) dans ~/.odin/notes. À faire de toi-même quand tu viens d\'expliquer ou de réussir quelque chose qu\'on refera.',
  risk: 'write',
  schema: obj({ title: str('titre court'), content: str('contenu en Markdown') }, ['title', 'content']),
  summarize: (i) => `fiche « ${s(i.title)} »`,
  async run(i, ctx) {
    if (ctx.isTainted()) return 'Refusé : pas de fiche après lecture d\'un contenu non fiable (elle pourrait contenir des consignes piégées).';
    const dir = notesDir(ctx); mkdirSync(dir, { recursive: true });
    const file = join(dir, `${slug(s(i.title))}.md`);
    writeFileSync(file, `# ${s(i.title)}\n\n${s(i.content)}\n`, { mode: 0o600 });
    ctx.muninn.remember(`Fiche « ${s(i.title)} » (notes/${slug(s(i.title))}.md) : ${s(i.content).replace(/\s+/g, ' ').slice(0, 300)}`, 'agent', 'procedure', '', { subject: `fiche:${slug(s(i.title))}`, topic: 'fiche', source: 'fiche' });
    return `Fiche gardée : ${file}`;
  },
};

export const noteFind: Tool = {
  name: 'note_find',
  description: 'Retrouve et lit les fiches gardées (procédures, adresses, plans). Sans mot : la liste.',
  risk: 'read',
  schema: obj({ query: str('mot à chercher (facultatif)') }),
  async run(i, ctx) {
    const dir = notesDir(ctx);
    if (!existsSync(dir)) return 'Aucune fiche pour l\'instant.';
    const q = s(i.query).toLowerCase();
    const files = readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => ({ f, t: readFileSync(join(dir, f), 'utf8') }));
    const hit = q ? files.filter((x) => x.t.toLowerCase().includes(q) || x.f.includes(slug(q))) : files;
    if (!hit.length) return 'Aucune fiche ne correspond.';
    return q && hit.length <= 3 ? hit.map((x) => x.t.slice(0, 6000)).join('\n\n---\n\n') : hit.map((x) => `- ${x.t.split('\n')[0].replace(/^#\s*/, '')} (notes/${x.f})`).join('\n');
  },
};

// ------------------------------------------------------------------ budget et abonnements

export interface Sub { name: string; amount: number; period: 'mois' | 'an' | 'semaine'; day?: number; category?: string; history: Array<{ at: number; amount: number }>; used?: number }
export const subs = (kv: Kv) => read<Sub[]>(kv, 'budget-subs', []);
export interface Expense { at: number; label: string; amount: number; category?: string }
const perMonth = (x: Sub) => x.period === 'an' ? x.amount / 12 : x.period === 'semaine' ? x.amount * 52 / 12 : x.amount;

/** Ajoute ou met à jour un abonnement ; renvoie la hausse éventuelle (pur sur le stockage). */
export function upsertSub(kv: Kv, x: { name: string; amount: number; period?: Sub['period']; day?: number; category?: string }, now = Date.now()): { sub: Sub; hike?: number } {
  const l = subs(kv), k = x.name.toLowerCase();
  let cur = l.find((y) => y.name.toLowerCase() === k), hike: number | undefined;
  if (cur) {
    if (Math.abs(x.amount - cur.amount) >= 0.01) { if (x.amount > cur.amount) hike = x.amount - cur.amount; cur.history.push({ at: now, amount: x.amount }); cur.amount = x.amount; }
    if (x.period) cur.period = x.period; if (x.day) cur.day = x.day; if (x.category) cur.category = x.category;
  } else { cur = { name: x.name, amount: x.amount, period: x.period ?? 'mois', day: x.day, category: x.category, history: [{ at: now, amount: x.amount }] }; l.push(cur); }
  write(kv, 'budget-subs', l);
  return { sub: cur, hike };
}

export const budgetTool: Tool = {
  name: 'budget',
  description: 'Budget et abonnements : action « abonnement » (ajoute ou met à jour : nom, montant, période mois/an/semaine, jour de prélèvement ; Odin repère les hausses de prix), « depense » (montant, libellé), « supprimer » (nom), « bilan » (mois en cours : abonnements, dépenses, total, hausses). À utiliser de toi-même quand une facture ou un relevé passe sous tes yeux.',
  risk: 'write',
  schema: obj({ action: str('abonnement | depense | supprimer | bilan'), name: str('nom ou libellé'), amount: num('montant en euros'), period: str('mois | an | semaine'), day: num('jour du prélèvement (1-31)'), category: str('catégorie (facultatif)') }, ['action']),
  summarize: (i) => `budget : ${s(i.action)} ${s(i.name)} ${i.amount != null ? eur(Number(i.amount)) : ''}`,
  async run(i, ctx) {
    const kv = ctx.muninn, a = s(i.action).toLowerCase();
    if (a.startsWith('abonn')) {
      if (!s(i.name) || !(Number(i.amount) > 0)) throw new Error('nom et montant requis');
      const r = upsertSub(kv, { name: s(i.name), amount: Number(i.amount), period: (['mois', 'an', 'semaine'].includes(s(i.period)) ? s(i.period) : undefined) as Sub['period'] | undefined, day: Number(i.day) || undefined, category: s(i.category) || undefined });
      return `Abonnement « ${r.sub.name} » : ${eur(r.sub.amount)} par ${r.sub.period}${r.sub.day ? `, prélevé le ${r.sub.day}` : ''}.${r.hike ? `\n⚠️ Hausse de ${eur(r.hike)} par rapport au prix connu : signale-la au propriétaire.` : ''}`;
    }
    if (a.startsWith('dep')) {
      if (!(Number(i.amount) > 0)) throw new Error('montant requis');
      const l = read<Expense[]>(kv, 'budget-expenses', []); l.push({ at: Date.now(), label: s(i.name) || 'dépense', amount: Number(i.amount), category: s(i.category) || undefined }); write(kv, 'budget-expenses', l.slice(-2000));
      return `Dépense notée : ${s(i.name)} ${eur(Number(i.amount))}.`;
    }
    if (a.startsWith('supp')) { const l = subs(kv), n = l.filter((x) => x.name.toLowerCase() !== s(i.name).toLowerCase()); write(kv, 'budget-subs', n); return l.length === n.length ? 'Aucun abonnement de ce nom.' : `Abonnement « ${s(i.name)} » retiré.`; }
    return budgetReport(kv);
  },
};

/** Bilan du mois (pur sur le stockage). */
export function budgetReport(kv: Kv, now = Date.now()): string {
  const l = subs(kv), start = new Date(now); start.setDate(1); start.setHours(0, 0, 0, 0);
  const ex = read<Expense[]>(kv, 'budget-expenses', []).filter((e) => e.at >= start.getTime());
  const subTotal = l.reduce((t, x) => t + perMonth(x), 0), exTotal = ex.reduce((t, e) => t + e.amount, 0);
  const hikes = l.filter((x) => x.history.length > 1 && x.amount > x.history[x.history.length - 2].amount);
  const lines = [`Abonnements : ${eur(subTotal)} par mois (${eur(subTotal * 12)} par an)`, ...l.sort((a, b) => perMonth(b) - perMonth(a)).map((x) => `- ${x.name} : ${eur(x.amount)}/${x.period}${x.day ? ` (le ${x.day})` : ''}`)];
  if (ex.length) lines.push('', `Dépenses notées ce mois-ci : ${eur(exTotal)}`, ...ex.slice(-10).map((e) => `- ${new Date(e.at).toLocaleDateString('fr-FR')} ${e.label} : ${eur(e.amount)}`));
  if (hikes.length) lines.push('', 'Hausses repérées :', ...hikes.map((x) => `- ${x.name} : ${eur(x.history[x.history.length - 2].amount)} → ${eur(x.amount)}`));
  return l.length || ex.length ? lines.join('\n') : 'Aucun abonnement ni dépense noté. Envoie-moi une facture ou dis « mon abonnement Netflix est à 13,49 € par mois ».';
}

/** Prélèvements qui arrivent dans `days` jours (pour prévenir la veille). */
export function upcomingCharges(kv: Kv, now = Date.now(), days = 2): Sub[] {
  const d = new Date(now); d.setDate(d.getDate() + days);
  return subs(kv).filter((x) => x.period === 'mois' && x.day === d.getDate());
}

// ------------------------------------------------------------------ surveillance de prix

export interface Watch { id: string; url: string; label: string; below?: number; last?: number; lowest?: number; checked?: number; told?: number }
export const watches = (kv: Kv) => read<Watch[]>(kv, 'price-watch', []);

/** Prix d'une page produit (pur) : données structurées d'abord, puis motifs « 399,99 € ». */
export function extractPrice(html: string): number | undefined {
  const num = (x: string) => { const n = Number(x.replace(/\s| /g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 && n < 1_000_000 ? n : undefined; };
  for (const re of [/"price"\s*:\s*"?([\d.,]+)"?/i, /itemprop=["']price["'][^>]*content=["']([\d.,]+)/i, /content=["']([\d.,]+)["'][^>]*itemprop=["']price["']/i, /property=["'](?:product|og):price:amount["'][^>]*content=["']([\d.,]+)/i, /data-price=["']([\d.,]+)/i]) {
    const m = re.exec(html); const n = m && num(m[1]); if (n) return n;
  }
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const m = /(\d{1,3}(?:[\s .]\d{3})*(?:,\d{2})?)\s?(?:€|EUR)/.exec(text) ?? /€\s?(\d{1,3}(?:[\s .]\d{3})*(?:[.,]\d{2})?)/.exec(text);
  return m ? num(m[1]) : undefined;
}

export const priceWatch: Tool = {
  name: 'price_watch',
  description: 'Surveille le prix d\'un produit sur une page web et prévient le propriétaire quand il baisse (ou passe sous un seuil). action : ajouter (url, label, below), liste, retirer (id). Vérifié toutes les 6 h.',
  risk: 'network',
  schema: obj({ action: str('ajouter | liste | retirer'), url: str('adresse de la page produit'), label: str('nom du produit'), below: num('prévenir sous ce prix (€, facultatif)'), id: str('à retirer') }, ['action']),
  summarize: (i) => `surveiller le prix : ${s(i.label) || s(i.url)}`,
  async run(i, ctx) {
    const kv = ctx.muninn, a = s(i.action).toLowerCase(), l = watches(kv);
    if (a.startsWith('aj')) {
      if (!/^https?:\/\//.test(s(i.url))) throw new Error('adresse http(s) requise');
      const w: Watch = { id: `px${Date.now().toString(36)}`, url: s(i.url), label: s(i.label) || new URL(s(i.url)).hostname, below: Number(i.below) || undefined };
      const price = await fetchPrice(w.url).catch(() => undefined);
      if (price) { w.last = price; w.lowest = price; w.checked = Date.now(); }
      write(kv, 'price-watch', [...l, w]);
      return `Je surveille « ${w.label} »${price ? ` (prix actuel : ${eur(price)})` : ' (prix pas encore lu sur la page)'}${w.below ? `, je te préviens sous ${eur(w.below)}` : ', je te préviens à chaque baisse'}.`;
    }
    if (a.startsWith('ret')) { const n = l.filter((w) => w.id !== s(i.id) && w.label.toLowerCase() !== s(i.label).toLowerCase()); write(kv, 'price-watch', n); return n.length < l.length ? 'Surveillance retirée.' : 'Introuvable.'; }
    return l.length ? l.map((w) => `${w.id} · ${w.label} · ${w.last ? eur(w.last) : '?'}${w.lowest ? ` (le plus bas : ${eur(w.lowest)})` : ''}${w.below ? ` · seuil ${eur(w.below)}` : ''}`).join('\n') : 'Aucun prix surveillé.';
  },
};

export async function fetchPrice(url: string, fetchFn: typeof fetch = fetch): Promise<number | undefined> {
  const r = await fetchFn(url, { headers: { 'user-agent': 'Mozilla/5.0 (Odin; surveillance de prix)', 'accept-language': 'fr-FR,fr' }, signal: AbortSignal.timeout(20_000), redirect: 'follow' });
  if (!r.ok) return undefined;
  return extractPrice((await r.text()).slice(0, 3_000_000));
}

/** Vérifie les prix ; renvoie les messages à envoyer (baisses, seuils atteints). */
export async function checkPrices(kv: Kv, now = Date.now(), fetchFn: typeof fetch = fetch): Promise<string[]> {
  const l = watches(kv), out: string[] = [];
  for (const w of l) {
    if (w.checked && now - w.checked < 6 * 3600_000) continue;
    const p = await fetchPrice(w.url, fetchFn).catch(() => undefined);
    w.checked = now;
    if (!p) continue;
    const prev = w.last;
    w.last = p; w.lowest = Math.min(w.lowest ?? p, p);
    if (w.below && p <= w.below && (!w.told || now - w.told > 86_400_000)) { out.push(`💶 ${w.label} est à ${eur(p)} (sous ton seuil de ${eur(w.below)}) : ${w.url}`); w.told = now; }
    else if (!w.below && prev && p <= prev * 0.95) { out.push(`💶 ${w.label} baisse : ${eur(prev)} → ${eur(p)} : ${w.url}`); w.told = now; }
  }
  write(kv, 'price-watch', l);
  return out;
}

// ------------------------------------------------------------------ énergie

export const energyReport: Tool = {
  name: 'energy_report',
  description: 'Consommation électrique de la maison (capteurs de puissance et d\'énergie de Home Assistant) et appareils du réseau allumés toute la nuit sans raison : propose quoi éteindre.',
  risk: 'read',
  schema: obj({}),
  async run(_i, ctx) {
    const out: string[] = [];
    const haUrl = (ctx.homeAssistant?.url ?? '').replace(/\/$/, '');
    if (haUrl && process.env.HA_TOKEN) {
      const states = await haApi(haUrl, process.env.HA_TOKEN, 'GET', '/states') as HaState[];
      const power = states.filter((x) => (x.attributes.device_class === 'power' || /^(W|kW)$/.test(x.attributes.unit_of_measurement ?? '')) && Number.isFinite(Number(x.state)))
        .map((x) => ({ name: x.attributes.friendly_name ?? x.entity_id, w: Number(x.state) * (x.attributes.unit_of_measurement === 'kW' ? 1000 : 1) })).sort((a, b) => b.w - a.w);
      const energy = states.filter((x) => x.attributes.device_class === 'energy' && Number.isFinite(Number(x.state)));
      if (power.length) out.push(`Puissance en ce moment : ${Math.round(power.reduce((t, x) => t + x.w, 0))} W au total`, ...power.slice(0, 8).map((x) => `- ${x.name} : ${Math.round(x.w)} W`));
      if (energy.length) out.push('', 'Compteurs d\'énergie :', ...energy.slice(0, 6).map((x) => `- ${x.attributes.friendly_name ?? x.entity_id} : ${x.state} ${x.attributes.unit_of_measurement ?? ''}`));
    } else out.push('Pas de Home Assistant relié : je ne vois pas les capteurs de consommation (Réglages → Maison).');
    // Appareils du réseau allumés la nuit (d'après le rythme appris)
    const pres = read<Record<string, { seen: number[]; on: number[] }>>(ctx.muninn, 'env-presence', {});
    const night = [1, 2, 3, 4], devs = ctx.inventory?.list({ status: 'all' }) ?? [];
    const awake = devs.filter((d) => { const p = pres[String(d.id)]; if (!p) return false; let s2 = 0, o = 0; for (let day = 0; day < 7; day++) for (const h of night) { s2 += p.seen[day * 24 + h]; o += p.on[day * 24 + h]; } const all = p.on.reduce((a, b) => a + b, 0) / Math.max(1, p.seen.reduce((a, b) => a + b, 0)); return s2 >= 7 && o / s2 > 0.8 && all < 0.95 && !/routeur|box/i.test(`${d.kind} ${d.name}`); });
    if (awake.length) out.push('', 'Allumés presque toutes les nuits (à éteindre ou mettre en veille ?) :', ...awake.slice(0, 8).map((d) => `- ${d.label || d.name || d.hostname || d.ip} (${d.ip})`));
    return out.join('\n');
  },
};

// ------------------------------------------------------------------ démarches administratives

const DEMARCHES: Record<string, { pieces: string[]; quand: string; ou: string }> = {
  impots: { pieces: ['numéro fiscal et mot de passe impots.gouv.fr', 'revenus de l\'année (bulletins, attestation France Travail, pensions)', 'frais réels éventuels', 'dons, garde d\'enfants, emploi à domicile (reçus)'], quand: 'déclaration des revenus chaque printemps (avril à juin selon le département) ; avis d\'imposition l\'été', ou: 'impots.gouv.fr' },
  caf: { pieces: ['numéro allocataire', 'pièce d\'identité', 'RIB', 'justificatif de domicile ou bail', 'revenus des 12 derniers mois', 'acte de naissance des enfants'], quand: 'déclaration trimestrielle pour certaines aides (RSA, prime d\'activité) ; changement de situation à signaler sous un mois', ou: 'caf.fr (Mayotte : CSSM, cssm.fr)' },
  assurance: { pieces: ['contrat et numéro de sociétaire', 'constat amiable ou déclaration de sinistre', 'photos, factures, devis', 'dépôt de plainte en cas de vol'], quand: 'sinistre à déclarer en général sous 5 jours ouvrés (2 jours pour un vol)', ou: 'espace client de l\'assureur' },
  'carte grise': { pieces: ['certificat de cession ou d\'immatriculation', 'pièce d\'identité', 'justificatif de domicile de moins de 6 mois', 'permis de conduire', 'contrôle technique de moins de 6 mois (véhicule de plus de 4 ans)'], quand: 'changement de propriétaire sous 1 mois ; changement d\'adresse sous 1 mois', ou: 'ants.gouv.fr' },
  identite: { pieces: ['pré-demande en ligne', 'photo d\'identité de moins de 6 mois', 'justificatif de domicile', 'ancien titre ou déclaration de perte/vol', 'timbre fiscal pour un passeport ou une CNI perdue'], quand: 'délais de rendez-vous en mairie parfois longs : s\'y prendre plusieurs mois avant un voyage', ou: 'ants.gouv.fr puis une mairie équipée' },
  'france travail': { pieces: ['pièce d\'identité', 'carte Vitale', 'RIB', 'attestations employeur', 'CV'], quand: 'inscription dans les 12 mois après la fin du contrat ; actualisation chaque mois', ou: 'francetravail.fr' },
  sante: { pieces: ['carte Vitale à jour', 'attestation de droits', 'carte de mutuelle', 'ordonnances et factures'], quand: 'mise à jour de la carte Vitale une fois par an ; remboursements sous 2 ans', ou: 'ameli.fr (Mayotte : cssm.fr)' },
};

export const demarche: Tool = {
  name: 'demarche_guide',
  description: 'Aide pour une démarche administrative (impôts, CAF/CSSM, assurance, carte grise, carte d\'identité/passeport, France Travail, santé) : pièces à réunir, délais habituels, où la faire. Vérifie toujours la règle à jour sur le site officiel avant d\'agir, puis propose des rappels pour les échéances.',
  risk: 'read',
  schema: obj({ type: str('démarche : impots, caf, assurance, carte grise, identite, france travail, sante') }, ['type']),
  async run(i) {
    const k = s(i.type).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const key = Object.keys(DEMARCHES).find((x) => k.includes(x.normalize('NFD').replace(/[̀-ͯ]/g, '').split(' ')[0])) ?? (/passeport|cni/.test(k) ? 'identite' : /chomage|emploi/.test(k) ? 'france travail' : /cssm|allocation/.test(k) ? 'caf' : /mutuelle|ameli|vitale/.test(k) ? 'sante' : undefined);
    if (!key) return `Je n'ai pas de fiche toute prête pour « ${s(i.type)} » : cherche la démarche sur service-public.fr (web_search) puis fais la liste des pièces.`;
    const d = DEMARCHES[key];
    return `Démarche : ${key}\nPièces à réunir :\n${d.pieces.map((p) => `- ${p}`).join('\n')}\nDélais habituels : ${d.quand}\nOù : ${d.ou}\nÀ faire : vérifier la règle à jour sur le site officiel (elle change), retrouver les pièces avec doc_find, proposer des rappels avant l'échéance.`;
  },
};

// ------------------------------------------------------------------ mode du moment

export type LifeMode = 'disponible' | 'conduite' | 'reunion' | 'sommeil' | 'occupe';
export const getMode = (kv: Kv, now = Date.now()): { mode: LifeMode; until: number } => { const m = read<{ mode: LifeMode; until: number } | null>(kv, 'life-mode', null); return m && m.until > now ? m : { mode: 'disponible', until: 0 }; };
export function setMode(kv: Kv, mode: LifeMode, minutes: number, now = Date.now()): void { write(kv, 'life-mode', { mode, until: mode === 'disponible' ? 0 : now + minutes * 60_000 }); }

/** Ce que tu dis de ta situation (pur) : « je conduis », « je suis en réunion », « bonne nuit », « je suis de retour ». */
export function modeFromText(t: string, now = new Date()): { mode: LifeMode; minutes: number } | undefined {
  const x = t.toLowerCase();
  if (/\b(je (conduis|suis au volant|prends la route|suis en voiture)|sur la route)\b/.test(x)) return { mode: 'conduite', minutes: 90 };
  if (/\b(je suis|je pars|je rentre) en (r[ée]union|rendez-vous|rdv)\b|\bj'ai une r[ée]union\b/.test(x)) return { mode: 'reunion', minutes: 60 };
  if (/\b(bonne nuit|je vais (me coucher|dormir)|je me couche)\b/.test(x)) { const w = new Date(now); w.setDate(w.getDate() + (now.getHours() >= 12 ? 1 : 0)); w.setHours(7, 0, 0, 0); return { mode: 'sommeil', minutes: Math.max(60, Math.round((w.getTime() - now.getTime()) / 60_000)) }; }
  if (/\b(je suis (de retour|dispo|disponible|arriv[ée])|c'est bon je suis l[àa]|r[ée]union finie|bien arriv[ée])\b/.test(x)) return { mode: 'disponible', minutes: 0 };
  return undefined;
}

export const modeSet: Tool = {
  name: 'mode_set',
  description: 'Ton mode du moment : conduite (réponses courtes en vocal), reunion ou occupe (seulement l\'urgent, le reste gardé pour après), sommeil (rien sauf l\'urgent jusqu\'au réveil), disponible. Odin le règle aussi tout seul quand tu le dis (« je conduis », « bonne nuit »).',
  risk: 'read',
  schema: obj({ mode: str('disponible | conduite | reunion | sommeil | occupe'), minutes: num('durée (facultatif)') }, ['mode']),
  async run(i, ctx) {
    const m = s(i.mode) as LifeMode;
    if (!['disponible', 'conduite', 'reunion', 'sommeil', 'occupe'].includes(m)) throw new Error('mode inconnu');
    setMode(ctx.muninn, m, Number(i.minutes) || (m === 'sommeil' ? 480 : 60));
    return m === 'disponible' ? 'Mode normal.' : `Mode ${m} jusqu'à ${whenFr(new Date(getMode(ctx.muninn).until))}.`;
  },
};

export const EVERYDAY_TOOLS: Tool[] = [undoRecent, undoApply, noteSave, noteFind, budgetTool, priceWatch, energyReport, demarche, modeSet];
