// Contrôle parental : des horaires par appareil (la tablette des enfants coupée à 21 h, rendue à 7 h),
// appliqués sur la box par Odin. 10 minutes avant la coupure, il te prévient avec des boutons pour
// prolonger (+15 min, +30 min, +1 h). Jamais la box elle-même ni la machine d'Odin.

import { routerAction, routerMachine } from '../hlidskjalf/router.ts';
import { gatewayOf, localIps } from '../tools/network.ts';
import { obj, str, num, type Tool } from '../tools/registry.ts';

export interface ParentalRule { id: string; device: string; label: string; mac: string; bed: string; wake: string; days?: number[]; until?: number; state?: 'blocked' | 'open'; warned?: string }
type Kv = { getKv(k: string): string | undefined | null; setKv(k: string, v: string): void };
export const KEY = 'parental-rules';
export const rules = (kv: Kv): ParentalRule[] => { try { return JSON.parse(kv.getKv(KEY) ?? '[]') as ParentalRule[]; } catch { return []; } };
const save = (kv: Kv, l: ParentalRule[]) => kv.setKv(KEY, JSON.stringify(l));
const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
export const hhmm = (s: string) => { const m = /^([01]?\d|2[0-3])\s*[h:]\s*([0-5]\d)?$/.exec(s.trim()); return m ? `${m[1].padStart(2, '0')}:${m[2] ?? '00'}` : undefined; };

/** L'appareil doit-il être coupé maintenant ? (pur) Les jours s'appliquent au soir de la coupure. */
export function shouldBlock(r: Pick<ParentalRule, 'bed' | 'wake' | 'days' | 'until'>, now = new Date()): boolean {
  if (r.until && r.until > now.getTime()) return false;
  const m = now.getHours() * 60 + now.getMinutes(), b = toMin(r.bed), w = toMin(r.wake);
  const dayOk = (d: number) => !r.days?.length || r.days.includes(d);
  if (b > w) { if (m >= b) return dayOk(now.getDay()); if (m < w) return dayOk((now.getDay() + 6) % 7); return false; }
  return m >= b && m < w && dayOk(now.getDay());
}

/** Minutes avant la prochaine coupure (pur), ou undefined si pas dans l'heure. */
export function minutesToBed(r: Pick<ParentalRule, 'bed' | 'days' | 'until'>, now = new Date()): number | undefined {
  const m = now.getHours() * 60 + now.getMinutes(), b = toMin(r.bed);
  const until = r.until && r.until > now.getTime() ? Math.round((r.until - now.getTime()) / 60_000) : undefined;
  if (until != null) return until <= 60 ? until : undefined;
  if (r.days?.length && !r.days.includes(now.getDay())) return undefined;
  return b > m && b - m <= 60 ? b - m : undefined;
}

export interface ParentalEnv { kv: Kv; home: string; inventory: { find(q: string): { id: number; ip: string; mac: string; kind: string; label: string; name: string; hostname: string } | undefined; list(f: { status: 'online' | 'all' }): Array<{ id: number; ip: string; kind: string }>; setBlocked(id: number, b: boolean, why: string): void } }

/** Applique les horaires (chaque minute). Renvoie les messages : coupures, retours, avertissements (avec l'id de la règle). */
export async function applyParental(env: ParentalEnv, now = new Date(), act = routerAction): Promise<Array<{ text: string; warnId?: string }>> {
  const l = rules(env.kv), out: Array<{ text: string; warnId?: string }> = [];
  if (!l.length) return out;
  const gw = gatewayOf(env.inventory as never);
  const m = routerMachine(env.home, gw?.ip);
  for (const r of l) {
    const want = shouldBlock(r, now) ? 'blocked' : 'open';
    const left = minutesToBed(r, now), day = now.toDateString();
    if (want === 'open' && left != null && left <= 10 && r.warned !== `${day}:${r.until ?? 0}`) { r.warned = `${day}:${r.until ?? 0}`; out.push({ text: `⏰ ${r.label} sera coupé dans ${left} min (${r.until ? 'fin de la prolongation' : `coucher à ${r.bed}`}).`, warnId: r.id }); }
    if (want === (r.state ?? 'open')) continue;
    if (!m) { out.push({ text: `⚠️ Contrôle parental : je n'ai pas d'accès à la box pour ${want === 'blocked' ? 'couper' : 'rendre'} ${r.label} (Réseau → box).` }); continue; }
    const res = await act(env.home, m, want === 'blocked' ? 'block' : 'unblock', r.mac).catch((e) => ({ ok: false, kind: 'linux' as const, out: (e as Error).message }));
    if (!res.ok) { out.push({ text: `⚠️ Contrôle parental : échec sur la box pour ${r.label} (${res.out.slice(0, 120)}).` }); continue; }
    r.state = want; if (want === 'open') r.until = r.until && r.until > now.getTime() ? r.until : undefined;
    const d = env.inventory.find(r.mac); if (d) env.inventory.setBlocked(d.id, want === 'blocked', `contrôle parental (${r.bed} – ${r.wake})`);
    out.push({ text: want === 'blocked' ? `🌙 ${r.label} coupé (contrôle parental, jusqu'à ${r.wake}).` : `☀️ ${r.label} a de nouveau Internet.` });
  }
  save(env.kv, l);
  return out;
}

/** Prolonge (minutes) : l'appareil reste ou redevient ouvert jusque-là. */
export function extend(kv: Kv, idOrName: string, minutes: number, now = Date.now()): ParentalRule | undefined {
  const l = rules(kv), q = idOrName.toLowerCase();
  const r = l.find((x) => x.id === idOrName || x.label.toLowerCase().includes(q) || x.device.toLowerCase() === q);
  if (!r) return undefined;
  r.until = Math.max(r.until ?? 0, now) + minutes * 60_000; r.warned = undefined;
  save(kv, l);
  return r;
}

const DAYS: Record<string, number> = { dim: 0, lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6 };
/** « semaine », « week-end », « lun,mar,mer » → jours (pur). */
export function parseDays(s: string): number[] | undefined {
  const x = s.toLowerCase();
  if (!x || /tous|chaque jour/.test(x)) return undefined;
  if (/semaine|ecole|école/.test(x)) return [0, 1, 2, 3, 4]; // soirs avant un jour d'école : dim → jeu
  if (/week/.test(x)) return [5, 6];
  const d = [...x.matchAll(/(dim|lun|mar|mer|jeu|ven|sam)/g)].map((m) => DAYS[m[1]]);
  return d.length ? [...new Set(d)].sort() : undefined;
}

export const parentalTool: Tool = {
  name: 'parental_control',
  description: 'Contrôle parental sur la box : horaires par appareil (coupé au coucher, rendu au lever), prolongation, liste, retrait. action : ajouter (appareil, coucher HH:MM, lever HH:MM, jours : tous | semaine (soirs d\'école) | week-end | lun,mar…), prolonger (appareil, minutes), liste, retirer (appareil).',
  risk: 'external',
  schema: obj({ action: str('ajouter | prolonger | liste | retirer'), appareil: str('nom, IP ou MAC de l\'appareil'), nom: str('nom affiché (« tablette de Lina »)'), coucher: str('HH:MM'), lever: str('HH:MM'), jours: str('tous | semaine | week-end | lun,mar…'), minutes: num('prolongation en minutes') }, ['action']),
  summarize: (i) => `contrôle parental : ${String(i.action)} ${String(i.appareil ?? '')} ${i.coucher ? `${i.coucher}–${i.lever}` : ''}${i.minutes ? `+${i.minutes} min` : ''}`,
  async run(i, ctx) {
    const a = String(i.action ?? '').toLowerCase(), q = String(i.appareil ?? '').trim();
    const l = rules(ctx.muninn);
    if (a.startsWith('aj')) {
      const inv = ctx.inventory; if (!inv) return 'Inventaire du réseau indisponible.';
      const d = inv.find(q); if (!d?.mac) return d ? `Je ne connais pas l'adresse MAC de ${q} : relance un balayage du réseau.` : `Appareil introuvable : ${q}.`;
      if (d.kind === 'routeur' || localIps().includes(d.ip)) return 'Pas de contrôle parental sur la box ni sur ma propre machine.';
      const bed = hhmm(String(i.coucher ?? '')), wake = hhmm(String(i.lever ?? ''));
      if (!bed || !wake) return 'Il faut une heure de coucher et de lever (HH:MM).';
      const r: ParentalRule = { id: `pc${Date.now().toString(36)}`, device: q, label: String(i.nom ?? '') || d.label || d.name || d.hostname || d.ip, mac: d.mac, bed, wake, days: parseDays(String(i.jours ?? '')) };
      ctx.muninn.setKv(KEY, JSON.stringify([...l.filter((x) => x.mac !== r.mac), r]));
      return `Contrôle parental : ${r.label} coupé de ${bed} à ${wake}${r.days ? ` (${r.days.length === 5 && !r.days.includes(5) ? 'soirs d\'école' : r.days.map((x) => Object.keys(DAYS)[x]).join(', ')})` : ', tous les jours'}. Je préviens 10 min avant, avec de quoi prolonger.`;
    }
    if (a.startsWith('prol')) { const r = extend(ctx.muninn, q, Math.max(5, Math.min(240, Number(i.minutes) || 30))); return r ? `${r.label} : Internet prolongé jusqu'à ${new Date(r.until!).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.` : `Aucune règle pour ${q}.`; }
    if (a.startsWith('ret')) {
      const gone = l.filter((x) => x.id === q || x.label.toLowerCase().includes(q.toLowerCase()) || x.device === q);
      ctx.muninn.setKv(KEY, JSON.stringify(l.filter((x) => !gone.includes(x))));
      // Une règle retirée pendant la coupure : l'appareil est rendu tout de suite.
      for (const r of gone.filter((x) => x.state === 'blocked')) { const m = ctx.inventory && ctx.home ? routerMachine(ctx.home, gatewayOf(ctx.inventory as never)?.ip) : undefined; if (m) await routerAction(ctx.home!, m, 'unblock', r.mac).catch(() => undefined); }
      return gone.length ? `Règle retirée${gone.some((x) => x.state === 'blocked') ? ' et appareil rendu' : ''}.` : 'Aucune règle de ce nom.';
    }
    return l.length ? l.map((r) => `${r.id} · ${r.label} · ${r.bed} → ${r.wake}${r.days ? ` · jours ${r.days.join(',')}` : ''} · ${r.state === 'blocked' ? 'coupé' : 'ouvert'}${r.until && r.until > Date.now() ? ` (prolongé jusqu'à ${new Date(r.until).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})` : ''}`).join('\n') : 'Aucun contrôle parental.';
  },
};
