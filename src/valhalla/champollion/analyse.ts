// Champollion · comprendre un texte : type de document, langue, dates, événements (rendez-vous, échéances,
// livraisons…), montants, contacts, liens. Pur, testé, sans IA (l'IA d'Odin, si elle est là, ajoute un résumé).

const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const MOIS_COURT: Record<string, number> = { janv: 1, jan: 1, fevr: 2, fev: 2, mars: 3, mar: 3, avr: 4, mai: 5, juin: 6, juil: 7, aout: 8, sept: 9, sep: 9, oct: 10, nov: 11, dec: 12 };
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2200;

export interface DateFound { date: string; heure?: string; texte: string; index: number }
export interface Event { quand: string; heure?: string; quoi: string; genre: string }
export interface Analyse {
  type: string; langue: 'français' | 'anglais' | 'autre'; mots: number; resume: string[];
  dates: DateFound[]; evenements: Event[]; montants: Array<{ valeur: number; texte: string; total: boolean }>;
  emails: string[]; telephones: string[]; liens: string[]; iban: string[];
}

const TYPES: Array<[string, RegExp]> = [
  ['devis', /\bdevis\b|offre de prix/],
  ['facture', /\bfacture\b|n[°o] de facture|montant (ttc|ht)|total ttc/],
  ['bulletin de salaire', /bulletin de (salaire|paie)|salaire (brut|net)|net a payer/],
  ['relevé bancaire', /releve de compte|solde (crediteur|debiteur|au)|\biban\b.*\bbic\b/],
  ['ordonnance', /ordonnance|posologie|\bcomprime|\bmg\b.*par jour/],
  ['contrat', /\bcontrat\b|entre les soussignes|article \d+|le present contrat/],
  ['convocation', /convocation|vous etes convoque|est convoque/],
  ['billet ou réservation', /reservation|embarquement|numero de vol|\bvol\b [a-z]{2}\s?\d|check-in|confirmation de commande/],
  ['attestation', /\battestation\b|certifie que|atteste que/],
  ['CV', /curriculum|experiences? professionnelles?|competences|formation\s*:/],
  ['courrier', /madame, monsieur|veuillez agreer|cordialement|objet\s*:/],
];
const EVENT_WORDS: Array<[string, RegExp]> = [
  ['rendez-vous', /rendez-vous|\brdv\b|consultation|rencontre/],
  ['réunion', /reunion|visio|meeting|assemblee/],
  ['échéance', /echeance|date limite|avant le|au plus tard|a payer le|a regler|expire|valable jusqu/],
  ['livraison', /livraison|livre le|expedi|retrait/],
  ['voyage', /\bvol\b|depart|arrivee|embarquement|check-in/],
  ['convocation', /convoqu|audience|examen|entretien/],
  ['événement', /anniversaire|fete|mariage|soiree|spectacle|match|concert/],
];

/** Les dates du texte (formats français et ISO, « 13 novembre 2026 », « lundi 16 nov. », « demain »), avec l'heure à côté. */
export function findDates(text: string, now = new Date()): DateFound[] {
  const out: DateFound[] = [], t = fold(text), Y = now.getFullYear();
  const heureAt = (i: number) => { const m = /^[^\n.]{0,24}?\b(?:a\s+|de\s+|vers\s+)?(\d{1,2})\s?(?:h|:)\s?(\d{2})?\b/.exec(t.slice(i, i + 40)); if (!m) return undefined; const h = Number(m[1]), mi = Number(m[2] ?? 0); return h < 24 && mi < 60 ? `${pad(h)}:${pad(mi)}` : undefined; };
  const push = (y: number, m: number, d: number, idx: number, len: number) => { if (!valid(y, m, d)) return; if (out.some((x) => Math.abs(x.index - idx) < 4)) return; out.push({ date: iso(y, m, d), heure: heureAt(idx + len), texte: text.slice(idx, idx + len).trim(), index: idx }); };
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(+m[1], +m[2], +m[3], m.index!, m[0].length);
  for (const m of t.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g)) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; push(y, +m[2], +m[1], m.index!, m[0].length); }
  const moisRe = `(${MOIS.join('|')}|${Object.keys(MOIS_COURT).join('|')})\\.?`;
  for (const m of t.matchAll(new RegExp(`\\b(?:(?:${JOURS.join('|')})\\s+)?(\\d{1,2})(?:er)?\\s+${moisRe}(?:\\s+(\\d{4}))?`, 'g'))) {
    const mois = MOIS.indexOf(m[2]) + 1 || MOIS_COURT[m[2]]; let y = m[3] ? +m[3] : Y;
    if (!m[3] && new Date(y, mois - 1, +m[1]).getTime() < now.getTime() - 60 * 864e5) y++; // sans année : la prochaine
    push(y, mois, +m[1], m.index!, m[0].length);
  }
  for (const m of t.matchAll(/\b(aujourd'hui|demain|apres-demain)\b/g)) { const d = new Date(now); d.setDate(d.getDate() + (m[1] === 'demain' ? 1 : m[1] === 'apres-demain' ? 2 : 0)); push(d.getFullYear(), d.getMonth() + 1, d.getDate(), m.index!, m[0].length); }
  return out.sort((a, b) => a.index - b.index);
}

/** Ce qu'on comprend d'un texte. `now` pour les dates relatives. */
export function analyse(text: string, now = new Date()): Analyse {
  const t = fold(text), words = t.split(/\s+/).filter(Boolean);
  const fr = (t.match(/\b(le|la|les|de|des|du|et|est|une|pour|vous|nous|avec|sur|dans|au|aux|chez|avant|apres)\b/g) ?? []).length + Math.floor((text.match(/[éèêàçùâîôû]/gi) ?? []).length / 2), en = (t.match(/\b(the|and|is|of|to|for|you|with|on|in|your|this)\b/g) ?? []).length;
  const type = TYPES.find(([, re]) => re.test(t))?.[0] ?? (words.length < 40 ? 'message' : 'document');
  const dates = findDates(text, now);
  // Une phrase (ou ligne) qui porte une date et un mot d'événement = un événement
  const evenements: Event[] = [];
  const sentences = [...text.matchAll(/[^\n.!?]+[.!?]?/g)].map((m) => ({ s: m[0], i: m.index! }));
  for (const d of dates) {
    const sen = sentences.find((x) => d.index >= x.i && d.index < x.i + x.s.length); if (!sen) continue;
    const f = fold(sen.s), g = EVENT_WORDS.find(([, re]) => re.test(f));
    if (g || d.heure) evenements.push({ quand: d.date, heure: d.heure, quoi: sen.s.trim().replace(/\s+/g, ' ').slice(0, 160), genre: g?.[0] ?? 'rendez-vous' });
  }
  const montants = [...text.matchAll(/(\d{1,3}(?:[  .]\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?(€|eur\b|euros?)/gi)].map((m) => {
    const v = Number(m[1].replace(/[  .](?=\d{3}\b)/g, '').replace(',', '.'));
    const before = fold(text.slice(Math.max(0, m.index! - 30), m.index!));
    return { valeur: v, texte: m[0].trim(), total: /total|net a payer|a payer|montant ttc|solde/.test(before) };
  }).filter((x) => Number.isFinite(x.valeur));
  const uniq = (l: string[]) => [...new Set(l)];
  const emails = uniq(text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []);
  const telephones = uniq((text.match(/(?:\+262|\+33|\b0)\s?[1-9](?:[\s.-]?\d{2}){4}\b/g) ?? []).map((x) => x.replace(/[\s.-]/g, ' ').replace(/\s+/g, ' ').trim()));
  const liens = uniq(text.match(/https?:\/\/[^\s<>"')]+/g) ?? []);
  const iban = uniq((text.match(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/g) ?? []).map((x) => x.replace(/\s/g, '')));
  const resume = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 3 && /[a-zà-ÿ]{3}/i.test(l)).slice(0, 3).map((l) => l.slice(0, 140));
  return { type, langue: fr > en && fr >= 2 ? 'français' : en > fr && en >= 2 ? 'anglais' : 'autre', mots: words.length, resume, dates, evenements, montants, emails, telephones, liens, iban };
}

/** Le compte rendu en texte. Pur. */
export function report(a: Analyse, source: string): string {
  const fmtD = (d: string, h?: string) => `${new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${h ? ` à ${h.replace(':', ' h ')}` : ''}`;
  const total = a.montants.find((m) => m.total) ?? null;
  return [
    `📄 ${source} · ${a.type} · ${a.langue} · ${a.mots} mots`,
    ...(a.resume.length ? [`En bref : ${a.resume.join(' / ')}`] : []),
    ...(a.evenements.length ? ['Événements :', ...a.evenements.slice(0, 10).map((e) => `- ${e.genre} · ${fmtD(e.quand, e.heure)} · ${e.quoi}`)] : a.dates.length ? [`Dates : ${a.dates.slice(0, 6).map((d) => fmtD(d.date, d.heure)).join(' · ')}`] : []),
    ...(a.montants.length ? [`Montants : ${a.montants.slice(0, 6).map((m) => m.texte).join(' · ')}${total ? ` (total : ${total.texte})` : ''}`] : []),
    ...(a.emails.length || a.telephones.length ? [`Contacts : ${[...a.emails, ...a.telephones].slice(0, 6).join(' · ')}`] : []),
    ...(a.iban.length ? [`IBAN : ${a.iban.map((x) => `${x.slice(0, 4)} … ${x.slice(-4)}`).join(' · ')}`] : []),
    ...(a.liens.length ? [`Liens : ${a.liens.slice(0, 5).join(' · ')}`] : []),
  ].join('\n');
}
