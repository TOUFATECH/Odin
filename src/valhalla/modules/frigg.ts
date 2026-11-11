// Frigg — les rendez-vous : prestations (durée, prix), horaires d'ouverture, créneaux libres calculés,
// page publique de réservation (lien secret), confirmation et annulation, rappel la veille, et chaque
// réservation devient un événement (Draupnir, Saga). Pensé pour un salon, un cabinet, un dépannage.

import { randomBytes } from 'node:crypto';
import type { ModCtx, Module } from '../types.ts';

export interface Service { name: string; minutes: number; price?: number }
export interface Booking { id: string; service: string; start: string; end: string; name: string; contact: string; note?: string; status: 'attente' | 'confirmé' | 'annulé'; created: string; reminded?: boolean }
/** Horaires : un jour (0 = dimanche) → plages « 9:00-12:00,14:00-18:00 ». */
export type Hours = Record<string, string>;
const s = (v: unknown) => String(v ?? '');
const services = (ctx: ModCtx): Service[] => (ctx.settings.services as Service[] | undefined) ?? [];
const bookings = (ctx: ModCtx): Booking[] => (ctx.settings.bookings as Booking[] | undefined) ?? [];
const hours = (ctx: ModCtx): Hours => (ctx.settings.hours as Hours | undefined) ?? { 1: '9:00-12:00,14:00-18:00', 2: '9:00-12:00,14:00-18:00', 3: '9:00-12:00,14:00-18:00', 4: '9:00-12:00,14:00-18:00', 5: '9:00-12:00,14:00-18:00', 6: '9:00-13:00' };
const hm = (t: string) => { const [h, m = '0'] = t.split(':'); return Number(h) * 60 + Number(m); };
const pad = (n: number) => String(n).padStart(2, '0');
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Créneaux libres d'un jour (heure locale), pas de 15 min, en évitant les réservations existantes. */
export function freeSlots(day: string, minutes: number, h: Hours, taken: Booking[], now = new Date(), step = 15): string[] {
  const d = new Date(`${day}T00:00`); if (Number.isNaN(d.getTime())) return [];
  const ranges = (h[String(d.getDay())] ?? '').split(',').map((r) => r.trim().split('-')).filter((r) => r.length === 2);
  const busy = taken.filter((b) => b.status !== 'annulé' && b.start.startsWith(day)).map((b) => [hm(b.start.slice(11)), hm(b.end.slice(11))]);
  const out: string[] = [];
  for (const [a, b] of ranges) for (let t = hm(a); t + minutes <= hm(b); t += step) {
    const at = new Date(d.getTime() + t * 60_000); if (at <= now) continue;
    if (busy.some(([x, y]) => t < y && t + minutes > x)) continue;
    out.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
  }
  return out;
}
export function book(ctx: ModCtx, i: { service: string; jour: string; heure: string; nom: string; contact: string; note?: string }, publicRequest = false): Booking {
  const sv = services(ctx).find((x) => x.name.toLowerCase() === i.service.toLowerCase()); if (!sv) throw new Error('prestation inconnue');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.jour) || !/^\d{1,2}:\d{2}$/.test(i.heure)) throw new Error('jour ou heure invalide');
  const name = i.nom.trim().slice(0, 80), contact = i.contact.trim().slice(0, 120); if (!name || !contact) throw new Error('nom et contact obligatoires');
  const heure = i.heure.padStart(5, '0');
  if (!freeSlots(i.jour, sv.minutes, hours(ctx), bookings(ctx), ctx.now()).includes(heure)) throw new Error('ce créneau n\'est plus libre');
  const start = new Date(`${i.jour}T${heure}`), end = new Date(start.getTime() + sv.minutes * 60_000);
  const b: Booking = { id: randomBytes(5).toString('hex'), service: sv.name, start: local(start), end: local(end), name, contact, note: i.note?.slice(0, 500), status: publicRequest && ctx.settings.confirm !== false ? 'attente' : 'confirmé', created: ctx.now().toISOString() };
  ctx.saveSettings({ bookings: [...bookings(ctx), b] });
  ctx.emit('reservation', { ...b });
  void ctx.notify(`📅 ${publicRequest ? 'Nouvelle demande' : 'Rendez-vous'} : ${b.name} · ${b.service} · ${b.start.replace('T', ' à ')}${b.status === 'attente' ? ' (à confirmer dans Frigg)' : ''}`);
  return b;
}
/** Lien public secret (créé une fois). */
export function publicKey(ctx: ModCtx): string { let k = s(ctx.settings.publicKey); if (!k) { k = randomBytes(12).toString('base64url'); ctx.saveSettings({ publicKey: k }); } return k; }
export function publicInfo(ctx: ModCtx): { title: string; services: Service[] } { return { title: s(ctx.settings.title) || 'Prendre rendez-vous', services: services(ctx) }; }
export function publicSlots(ctx: ModCtx, service: string, day: string): string[] { const sv = services(ctx).find((x) => x.name === service); return sv ? freeSlots(day, sv.minutes, hours(ctx), bookings(ctx), ctx.now()) : []; }

function setStatus(ctx: ModCtx, id: string, status: Booking['status']): Booking {
  const b = bookings(ctx).find((x) => x.id === id); if (!b) throw new Error('rendez-vous introuvable');
  ctx.saveSettings({ bookings: bookings(ctx).map((x) => (x.id === id ? { ...x, status } : x)) });
  ctx.emit(status === 'annulé' ? 'reservation_annulee' : 'reservation_confirmee', { ...b, status });
  return { ...b, status };
}

export const frigg: Module = {
  id: 'frigg', name: 'Frigg', family: 'Données',
  what: 'Les rendez-vous : prestations, horaires, créneaux libres et page publique de réservation.',
  does: ['prestations avec durée et prix', 'horaires d\'ouverture par jour', 'créneaux libres calculés tout seuls', 'page publique de réservation (lien secret) sans compte', 'confirmation, annulation, rappel la veille sur ta messagerie', 'chaque réservation peut lancer une automatisation (SMS, fiche client dans Runes…)'],
  from: ['Cal.com', 'Easy!Appointments', 'Calendso'], upstream: ['calcom/cal.com', 'alextselegidis/easyappointments'],
  words: ['rendez-vous', 'rdv', 'reservation', 'réservation', 'creneau', 'créneau', 'prestation', 'agenda du salon', 'prendre rendez-vous', 'disponibilites', 'disponibilités'],
  actions: [
    { id: 'agenda', label: 'Rendez-vous à venir', what: 'Les prochains rendez-vous', read: true, words: ['a venir', 'à venir', 'prochains', 'aujourd hui', 'demain'], run: (ctx) => { const now = local(ctx.now()); const l = bookings(ctx).filter((b) => b.status !== 'annulé' && b.end >= now).sort((a, b) => a.start.localeCompare(b.start)); return { text: l.map((b) => `- ${b.start.replace('T', ' ')} · ${b.name} · ${b.service}${b.status === 'attente' ? ' (à confirmer)' : ''}`).join('\n') || 'Aucun rendez-vous à venir.' }; } },
    { id: 'creneaux', label: 'Créneaux libres', what: 'Pour une prestation et un jour', read: true, params: [{ key: 'service', label: 'Prestation', kind: 'text', required: true }, { key: 'jour', label: 'Jour (AAAA-MM-JJ)', kind: 'text', required: true }], words: ['creneaux', 'créneaux', 'libre', 'dispo'], run: (ctx, i) => { const sv = services(ctx).find((x) => x.name.toLowerCase() === s(i.service).toLowerCase()); if (!sv) throw new Error('prestation inconnue'); const f = freeSlots(s(i.jour), sv.minutes, hours(ctx), bookings(ctx), ctx.now()); return { text: f.length ? f.join(', ') : 'Aucun créneau libre ce jour-là.', data: f }; } },
    { id: 'reserver', label: 'Réserver', what: 'Ajoute un rendez-vous', params: [{ key: 'service', label: 'Prestation', kind: 'text', required: true }, { key: 'jour', label: 'Jour (AAAA-MM-JJ)', kind: 'text', required: true }, { key: 'heure', label: 'Heure (HH:MM)', kind: 'text', required: true }, { key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'contact', label: 'Téléphone ou e-mail', kind: 'text', required: true }, { key: 'note', label: 'Note', kind: 'text', default: '' }], run: (ctx, i) => { const b = book(ctx, { service: s(i.service), jour: s(i.jour), heure: s(i.heure), nom: s(i.nom), contact: s(i.contact), note: s(i.note) }); return { text: `📅 ${b.name} · ${b.service} · ${b.start.replace('T', ' à ')}` }; } },
    { id: 'confirmer', label: 'Confirmer', what: 'Confirme une demande', params: [{ key: 'id', label: 'Rendez-vous', kind: 'text', required: true }], run: (ctx, i) => { const b = setStatus(ctx, s(i.id), 'confirmé'); return { text: `✓ ${b.name} confirmé.` }; } },
    { id: 'annuler', label: 'Annuler', what: 'Annule un rendez-vous', params: [{ key: 'id', label: 'Rendez-vous', kind: 'text', required: true }], grave: (i) => `annuler le rendez-vous ${s(i.id)}`, run: (ctx, i) => { const b = setStatus(ctx, s(i.id), 'annulé'); return { text: `✗ ${b.name} annulé.` }; } },
    { id: 'prestation', label: 'Ajouter une prestation', what: 'Nom, durée, prix', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'minutes', label: 'Durée (minutes)', kind: 'number', required: true }, { key: 'prix', label: 'Prix (€)', kind: 'number', default: '' }], run: (ctx, i) => { const sv: Service = { name: s(i.nom).trim(), minutes: Math.max(5, Number(i.minutes) || 30), price: i.prix === '' || i.prix === undefined ? undefined : Number(i.prix) }; ctx.saveSettings({ services: [...services(ctx).filter((x) => x.name !== sv.name), sv] }); return { text: `✂ ${sv.name} (${sv.minutes} min${sv.price !== undefined ? `, ${sv.price} €` : ''}).` }; } },
    { id: 'horaires', label: 'Horaires', what: 'Une ligne par jour : « lundi 9:00-12:00,14:00-18:00 »', params: [{ key: 'horaires', label: 'Horaires', kind: 'textarea', required: true }], run: (ctx, i) => {
      const J: Record<string, number> = { dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 }, h: Hours = {};
      for (const l of s(i.horaires).split('\n')) { const m = /^\s*(\w+)\s+(.+)$/.exec(l.toLowerCase()); if (m && J[m[1]] !== undefined && /^[\d:,\s-]+$/.test(m[2])) h[J[m[1]]] = m[2].replace(/\s/g, ''); }
      ctx.saveSettings({ hours: h }); return { text: `🕘 Horaires enregistrés (${Object.keys(h).length} jour(s)).` };
    } },
    { id: 'page', label: 'Page publique', what: 'Lien à donner à tes clients', read: true, run: (ctx) => ({ text: `Lien de réservation : /r/${publicKey(ctx)} (à ajouter après l'adresse publique d'Odin).`, data: { path: `/r/${publicKey(ctx)}` } }) },
  ],
  view(ctx) {
    const now = local(ctx.now()), up = bookings(ctx).filter((b) => b.status !== 'annulé' && b.end >= now).sort((a, b) => a.start.localeCompare(b.start));
    const today = up.filter((b) => b.start.startsWith(now.slice(0, 10))), wait = up.filter((b) => b.status === 'attente');
    return {
      subtitle: `${up.length} rendez-vous à venir · ${wait.length} à confirmer`,
      kpis: [{ label: 'Aujourd\'hui', value: String(today.length) }, { label: 'À confirmer', value: String(wait.length), tone: wait.length ? 'attention' : 'bon' }, { label: 'Prestations', value: String(services(ctx).length) }],
      sections: [
        { kind: 'table', title: 'À venir', columns: ['Quand', 'Client', 'Contact', 'Prestation', 'État'], empty: 'Aucun rendez-vous.', rows: up.slice(0, 80).map((b) => ({ cells: [b.start.replace('T', ' '), b.name, b.contact, b.service, b.status], tone: b.status === 'attente' ? 'attention' : 'bon', actions: [...(b.status === 'attente' ? [{ action: 'confirmer', label: 'Confirmer', input: { id: b.id } }] : []), { action: 'annuler', label: 'Annuler', input: { id: b.id } }] })) },
        { kind: 'table', title: 'Prestations', columns: ['Prestation', 'Durée', 'Prix'], empty: 'Ajoute une prestation à droite.', rows: services(ctx).map((x) => ({ cells: [x.name, `${x.minutes} min`, x.price !== undefined ? `${x.price} €` : '—'] })) },
        { kind: 'text', title: 'Page publique', text: `Tes clients réservent sur /r/${publicKey(ctx)} — sans compte. ${ctx.settings.confirm === false ? 'Réservations confirmées automatiquement.' : 'Chaque demande attend ta confirmation.'}` },
      ],
      side: [{ kind: 'form', title: 'Ajouter une prestation', action: 'prestation', submit: 'Ajouter', params: frigg.actions[5].params! }, { kind: 'form', title: 'Horaires', action: 'horaires', submit: 'Enregistrer', params: frigg.actions[6].params! }],
    };
  },
  watch: { every: 900, run(ctx) {
    // Rappel la veille (une fois).
    const t = ctx.now(), tomorrow = local(new Date(t.getTime() + 86_400_000)).slice(0, 10);
    const due = bookings(ctx).filter((b) => b.status === 'confirmé' && !b.reminded && b.start.startsWith(tomorrow));
    if (!due.length || t.getHours() < 17) return;
    void ctx.notify(`📅 Demain :\n${due.map((b) => `- ${b.start.slice(11)} ${b.name} (${b.service}) · ${b.contact}`).join('\n')}`);
    ctx.saveSettings({ bookings: bookings(ctx).map((b) => (due.some((d) => d.id === b.id) ? { ...b, reminded: true } : b)) });
    for (const b of due) ctx.emit('rappel', { ...b });
  } },
};
