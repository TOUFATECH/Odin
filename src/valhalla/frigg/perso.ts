// Chronos · tes rendez-vous à toi (« planifie un rendez-vous mardi à 15 h ») et leur rappel, plus la vue en onglets
// (Agenda : tous les plannings d'Odin ; Rendez-vous ; Réglages). Le rappel part par la passerelle, sur ton moyen relié
// (Telegram d'abord), avec les boutons « C'est fait / Plus tard », sans IA au moment de l'envoi, et passe « Ne pas déranger ».
// Il se voit dans Talos (une ligne « rappel » de l'appli Chronos) ; annuler le rendez-vous retire son rappel.

import { randomBytes } from 'node:crypto';
import { parseWhen } from '../../cron/reminders.ts';
import { dateMurale, fuseauOdin, instant, murale, texteDate } from '../../draupnir/rythme.ts';
import { agendaOdin, sourcesOdin } from '../automatismes.ts';
import { agissant } from '../sso/acces.ts';
import type { Action, ModCtx, Section, View } from '../types.ts';
import type { Booking } from '../modules/frigg.ts';

const s = (v: unknown) => String(v ?? '').trim();
export const bookingsDe = (ctx: ModCtx): Booking[] => (ctx.settings.bookings as Booking[] | undefined) ?? [];
export const RAPPELS = ['1 h avant', 'la veille à 18 h', '15 min avant', 'au moment', 'aucun'];

/** « mardi 15 h », « demain 8 h », « 2026-11-18 15:00 » → l'instant, à l'heure du lieu d'Odin. */
export function lireQuand(texte: string, now: Date, fuseau?: string): Date | undefined {
  const tz = fuseauOdin(fuseau), t = texte.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2})[:h](\d{2})$/.exec(t);
  if (iso) return instant(+iso[1], +iso[2], +iso[3], +iso[4], +iso[5], tz);
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(t)) { const d = new Date(t); return Number.isNaN(d.getTime()) ? undefined : d; }
  const d = parseWhen(t, now); if (!d) return undefined;
  if (/\bdans\b/i.test(t)) return d; // « dans 2 heures » : une durée, pas une heure murale
  // parseWhen compte à l'heure de la machine : l'heure murale lue est remise à l'heure du lieu.
  return instant(d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), tz);
}
/** Quand part le rappel d'un rendez-vous. */
export function quandRappel(debut: Date, rappel: string, fuseau?: string): Date | undefined {
  switch (rappel) {
    case 'aucun': return undefined;
    case '15 min avant': return new Date(debut.getTime() - 15 * 60_000);
    case 'au moment': return debut;
    case 'la veille à 18 h': { const tz = fuseauOdin(fuseau), w = murale(debut.getTime(), tz), v = new Date(Date.UTC(w.y, w.mo - 1, w.d - 1)); return instant(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate(), 18, 0, tz); }
    default: return new Date(debut.getTime() - 3600_000);
  }
}
/** Retire le rappel programmé dans la passerelle. */
export function annulerRappel(job: string): boolean { try { return sourcesOdin().rappels?.annuler(job) ?? false; } catch { return false; } }
/** Le rappel d'une réservation est retiré depuis Talos : la réservation passe à « aucun ». */
export function oublierRappel(ctx: ModCtx, job: string): void {
  const l = bookingsDe(ctx); if (!l.some((b) => b.rappelJob === job)) return;
  ctx.saveSettings({ bookings: l.map((b) => (b.rappelJob === job ? { ...b, rappel: 'aucun', rappelJob: undefined } : b)) });
}

export const actionRendezVous: Action = {
  id: 'rendez_vous', label: 'Nouveau rendez-vous', what: 'Un rendez-vous à toi dans l\'agenda, et son rappel sur ta messagerie (Telegram d\'abord)',
  params: [
    { key: 'titre', label: 'Quoi', kind: 'text', required: true },
    { key: 'quand', label: 'Quand (« mardi 15 h », « 2026-11-18 15:00 »)', kind: 'text', required: true },
    { key: 'duree', label: 'Durée (minutes)', kind: 'number', default: 60 },
    { key: 'lieu', label: 'Où', kind: 'text', default: '' },
    { key: 'rappel', label: 'Rappel', kind: 'select', options: RAPPELS, default: '1 h avant' },
  ],
  undo: (_i, r) => { const id = (r.data as { id?: string } | undefined)?.id; return id ? { action: 'annuler', input: { id }, label: 'rendez-vous annulé' } : undefined; },
  run: (ctx, i) => {
    // Le rappel part sur la messagerie du propriétaire : un membre ne peut pas y écrire.
    if (agissant()) throw new Error('Les rendez-vous perso sont réservés au propriétaire.');
    const now = ctx.now(), titre = s(i.titre).slice(0, 120); if (!titre) throw new Error('dis ce qu\'est le rendez-vous');
    const debut = lireQuand(s(i.quand), now); if (!debut) throw new Error(`je ne comprends pas la date « ${s(i.quand)} » (ex. « mardi 15 h », « 2026-11-18 15:00 »)`);
    if (debut.getTime() <= now.getTime()) throw new Error('cette date est déjà passée');
    const duree = Math.max(5, Math.min(24 * 60, Math.round(Number(i.duree) || 60)));
    const fin = new Date(debut.getTime() + duree * 60_000), lieu = s(i.lieu).slice(0, 120);
    const rappel = RAPPELS.includes(s(i.rappel)) ? s(i.rappel) : '1 h avant';
    const a = dateMurale(debut), b = dateMurale(fin);
    const bk: Booking = { id: randomBytes(5).toString('hex'), service: 'Personnel', start: `${a.date}T${a.heure}`, end: `${b.date}T${b.heure}`, name: titre, contact: '', ...(lieu ? { note: lieu, lieu } : {}), status: 'confirmé', created: now.toISOString(), perso: true, rappel, debut: debut.toISOString() };
    // Le rappel : sur le moyen relié du propriétaire, par la passerelle (un rappel déjà passé part dans la minute).
    let dit = 'sans rappel';
    const q = quandRappel(debut, rappel), src = sourcesOdin();
    if (q) {
      const at = new Date(Math.max(q.getTime(), now.getTime() + 60_000));
      const job = src.rappels?.programmer(`Rendez-vous : ${titre} ${texteDate(debut, undefined, at)}${lieu ? ` (${lieu})` : ''}`, at);
      if (job) bk.rappelJob = job;
      const moyen = src.moyen?.();
      dit = !job ? 'rappel non programmé : la passerelle d\'Odin n\'est pas démarrée' : moyen ? `rappel ${rappel} sur ${moyen}` : `rappel ${rappel} noté, aucune messagerie reliée`;
    }
    ctx.saveSettings({ bookings: [...bookingsDe(ctx), bk] });
    ctx.emit('reservation', { ...bk });
    return { text: `📅 ${titre} : ${texteDate(debut, undefined, now)}${lieu ? ` · ${lieu}` : ''} (${duree} min) · ${dit}.`, data: { id: bk.id, debut: bk.debut, rappelJob: bk.rappelJob } };
  },
};

// ---------------------------------------------------------------- La vue en onglets

const A = 'Agenda', R = 'Rendez-vous', G = 'Réglages';
/** Les 14 prochains jours : tous les plannings d'Odin pour le propriétaire, seulement les rendez-vous des clients pour un membre. */
function agenda(ctx: ModCtx): Section[] {
  const now = ctx.now(), fin = new Date(now.getTime() + 14 * 86_400_000), membre = Boolean(agissant());
  const nomAppli = (id?: string) => (id ? ctx.modules().find((m) => m.id === id)?.name ?? id : 'Odin');
  const rdv = bookingsDe(ctx).filter((b) => b.status !== 'annulé' && (!membre || !b.perso)).map((b) => ({ quand: b.debut ?? b.start, titre: b.perso ? b.name : `${b.name} · ${b.service}`, appli: 'frigg', moyen: b.perso && b.rappel && b.rappel !== 'aucun' ? sourcesOdin().moyen?.() ?? '—' : '—', t: b.debut ? Date.parse(b.debut) : new Date(b.start).getTime() })).filter((x) => x.t >= now.getTime() - 3600_000 && x.t <= fin.getTime());
  const tout = membre ? [] : agendaOdin(now, fin);
  const lignes = tout.length ? tout.map((e) => ({ quand: e.quandTexte, quoi: e.titre, appli: nomAppli(e.appli), moyen: e.moyen ?? '—', t: Date.parse(e.quand) }))
    : rdv.map((x) => ({ quand: texteDate(new Date(x.t), undefined, now), quoi: x.titre, appli: nomAppli(x.appli), moyen: x.moyen, t: x.t }));
  lignes.sort((x, y) => x.t - y.t);
  return [
    { kind: 'table', onglet: A, large: true, title: 'Les 14 prochains jours', columns: ['Quand', 'Quoi', 'Appli', 'Rappel par'], empty: 'Rien de prévu dans les 14 prochains jours.', rows: lignes.slice(0, 200).map((x) => ({ cells: [x.quand, x.quoi, x.appli, x.moyen] })) },
    ...(membre ? [] : [{ kind: 'text' as const, onglet: A, title: 'Où ça se règle', text: 'Rendez-vous, rappels, automatisations et tâches : tout se règle dans Talos (menu Plus → Automatisations).' }]),
  ];
}
/** La page de Chronos en trois onglets : Agenda, Rendez-vous, Réglages. */
export function ongletsChronos(ctx: ModCtx, v: View): View {
  const ou = (t: string) => (t === 'À venir' ? R : G);
  return {
    ...v,
    onglets: [A, R, G],
    sections: [
      ...agenda(ctx),
      ...v.sections.map((x) => ({ ...x, onglet: ou(x.title) })),
      ...(agissant() ? [] : [{ kind: 'form' as const, onglet: R, title: 'Nouveau rendez-vous', action: 'rendez_vous', submit: 'Planifier', params: actionRendezVous.params ?? [], aide: 'Le rappel part sur ta messagerie (Telegram d\'abord) ; il se voit et se règle dans Talos.' }]),
    ],
    side: (v.side ?? []).map((x) => ({ ...x, onglet: G })),
  };
}
