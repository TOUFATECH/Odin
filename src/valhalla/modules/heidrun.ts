// Héra — le filtrage web et le contrôle parental, pensé pour la famille : un profil par enfant (son âge, ses
// appareils), des réglages tout prêts selon l'âge (sites pour adultes bloqués, recherche sécurisée, réseaux
// sociaux coupés pour les plus jeunes), l'heure du coucher (Internet coupé la nuit), « pause » d'un geste, et
// le rapport de la journée (sites les plus vus, tentatives bloquées, heures d'activité). Héra ne filtre rien
// elle-même : elle règle Sphinx (le DNS d'Odin), qui fait le travail pour toute la maison.
// Limites dites clairement : un appareil qui n'utilise pas le DNS d'Odin (ou qui passe en 4G) y échappe.
import type { ActionResult, Kpi, ModCtx, Module } from '../types.ts';

export type Age = 'petit' | 'enfant' | 'ado' | 'adulte';
export interface Profil { id: string; nom: string; age: Age; appareils: string[]; coucher?: { jours: string; de: string; a: string }; pause?: boolean; cree: number }
interface DomainStat { n: number; b: number }
interface ClientStat { name?: string; n: number; b: number; threats: number; first: number; last: number; domains: Record<string, DomainStat> }
const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));

/** Les réglages tout prêts selon l'âge. Les services sont ceux que Sphinx sait couper. */
export const AGES: Record<Age, { label: string; quoi: string; filtre: boolean; services: string[]; coucher?: { de: string; a: string } }> = {
  petit: { label: 'Petit (moins de 8 ans)', quoi: 'sites pour adultes bloqués, recherche sécurisée, réseaux sociaux, messageries et jeux en ligne coupés', filtre: true, services: ['tiktok', 'instagram', 'snapchat', 'facebook', 'x', 'discord', 'twitch', 'reddit', 'telegram', 'whatsapp', 'pinterest', 'roblox', 'fortnite', 'steam'], coucher: { de: '19:30', a: '07:00' } },
  enfant: { label: 'Enfant (8 à 12 ans)', quoi: 'sites pour adultes bloqués, recherche sécurisée, réseaux sociaux coupés', filtre: true, services: ['tiktok', 'instagram', 'snapchat', 'facebook', 'x', 'discord', 'twitch', 'reddit', 'telegram'], coucher: { de: '20:30', a: '07:00' } },
  ado: { label: 'Ado (13 à 17 ans)', quoi: 'sites pour adultes bloqués, recherche sécurisée ; réseaux sociaux laissés', filtre: true, services: [], coucher: { de: '22:30', a: '06:30' } },
  adulte: { label: 'Adulte', quoi: 'aucun filtre en plus de celui de la maison', filtre: false, services: [] },
};
const IP = /^\d{1,3}(\.\d{1,3}){3}$/;
/** Les adresses d'une saisie (« 192.168.1.20, 192.168.1.21 »), vérifiées. Pur. */
export function adresses(x: unknown): string[] {
  const l = [...new Set(s(x).split(/[,\s;]+/).map((y) => y.trim()).filter(Boolean))];
  for (const ip of l) if (!IP.test(ip) || ip.split('.').some((n) => Number(n) > 255)) throw new Error(`adresse invalide : ${ip} (attendu : 192.168.1.20)`);
  return l;
}
const hm = (x: string) => { const m = /^(\d{1,2})[:h](\d{2})$/.exec(x.trim()); if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error('heure sous la forme 21:00'); return `${m[1].padStart(2, '0')}:${m[2]}`; };
/** Le nom de domaine « principal » (cdn.video.exemple.fr → exemple.fr ; bbc.co.uk reste entier). Pur. */
export function domainePrincipal(d: string): string {
  const p = d.toLowerCase().replace(/\.$/, '').split('.'); if (p.length <= 2) return p.join('.');
  const deux = /^(co|com|org|net|gov|gouv|ac|edu)$/.test(p[p.length - 2]) && p[p.length - 1].length === 2;
  return p.slice(deux ? -3 : -2).join('.');
}
export interface Rapport { requetes: number; bloquees: number; dangereuses: number; premier?: number; dernier?: number; sites: Array<{ site: string; n: number; b: number }>; refuses: Array<{ site: string; b: number }> }
/** Le rapport d'un enfant à partir de ce que Sphinx a vu de ses appareils. Pur. */
export function rapport(clients: Record<string, ClientStat>, ips: string[]): Rapport {
  const r: Rapport = { requetes: 0, bloquees: 0, dangereuses: 0, sites: [], refuses: [] }, par = new Map<string, { n: number; b: number }>();
  for (const ip of ips) {
    const c = clients[ip]; if (!c) continue;
    r.requetes += c.n; r.bloquees += c.b; r.dangereuses += c.threats;
    if (c.first && (!r.premier || c.first < r.premier)) r.premier = c.first; if (c.last && (!r.dernier || c.last > r.dernier)) r.dernier = c.last;
    for (const [d, x] of Object.entries(c.domains ?? {})) { const k = domainePrincipal(d), o = par.get(k) ?? { n: 0, b: 0 }; o.n += x.n; o.b += x.b; par.set(k, o); }
  }
  const tous = [...par.entries()].map(([site, x]) => ({ site, ...x }));
  r.sites = tous.filter((x) => x.n > x.b).sort((a, b) => b.n - a.n).slice(0, 10);
  r.refuses = tous.filter((x) => x.b > 0).sort((a, b) => b.b - a.b).slice(0, 8).map((x) => ({ site: x.site, b: x.b }));
  return r;
}
const heure = (t?: number) => (t ? new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—');
const profils = (ctx: ModCtx): Profil[] => (ctx.settings.profils as Profil[] | undefined) ?? [];
const slug = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'profil';
function trouver(ctx: ModCtx, qui: unknown): Profil {
  const k = s(qui).trim().toLowerCase(), l = profils(ctx), p = l.find((x) => x.id === k || x.nom.toLowerCase() === k) ?? l.find((x) => x.nom.toLowerCase().includes(k));
  if (!k || !p) throw new Error(l.length ? `profil « ${s(qui)} » introuvable (profils : ${l.map((x) => x.nom).join(', ')})` : 'aucun profil : crée d\'abord le profil de l\'enfant');
  return p;
}
const sphinx = (ctx: ModCtx) => ctx.modules().some((m) => m.id === 'vidarr');
const nomRegle = (p: Profil) => `Héra · ${p.nom}`;
/** Pose les réglages du profil dans Sphinx : une seule règle pour tous ses appareils, puis la coupure (pause ou coucher). */
async function appliquer(ctx: ModCtx, p: Profil): Promise<string[]> {
  if (!sphinx(ctx)) throw new Error('Sphinx (le DNS d\'Odin) n\'est pas là : Héra a besoin de lui pour filtrer');
  const a = AGES[p.age], notes: string[] = [], why = `Héra applique le profil de ${p.nom}`;
  const etape = async (action: string, input: Record<string, unknown>): Promise<ActionResult> => { const r = await ctx.call('vidarr', action, input, why, { interne: true }); if (r.ok === false) notes.push(r.text.split('\n')[0]); return r; };
  if (!p.appareils.length) return ['aucun appareil dans ce profil : ajoute l\'adresse de sa tablette ou de son téléphone'];
  await etape('appareil', { nom: nomRegle(p), adresses: p.appareils.join(', '), filtrage: a.filtre ? 'oui' : 'global', parental: a.filtre, recherche_sure: a.filtre, services: a.services.join(', '), amont: '' });
  if (p.pause) await etape('couper_machine', { ip: p.appareils[0], nom: nomRegle(p) });
  else if (p.coucher) await etape('couper_machine', { ip: p.appareils[0], nom: nomRegle(p), jours: p.coucher.jours, de: p.coucher.de, a: p.coucher.a });
  return notes;
}
async function retirerDeSphinx(ctx: ModCtx, p: Profil): Promise<void> {
  if (!sphinx(ctx) || !p.appareils.length) return;
  await ctx.call('vidarr', 'retablir_machine', { ip: p.appareils[0] }, undefined, { interne: true }).catch(() => undefined);
  await ctx.call('vidarr', 'retirer_appareil', { nom: nomRegle(p) }, undefined, { interne: true }).catch(() => undefined);
}
async function vuParSphinx(ctx: ModCtx, periode = 'jour'): Promise<Record<string, ClientStat>> {
  if (!sphinx(ctx)) return {};
  const r = await ctx.call('vidarr', 'historique', { periode }).catch(() => undefined);
  return ((r?.data as { clients?: Record<string, ClientStat> } | undefined)?.clients) ?? {};
}
const etatDe = (p: Profil) => (p.pause ? '⏸ Internet en pause' : p.coucher ? `🌙 coucher ${p.coucher.de} → ${p.coucher.a}` : 'pas d\'heure de coucher');
const texteRapport = (p: Profil, r: Rapport, quand: string) => `${p.nom} · ${quand} : ${r.requetes} demande(s), ${r.bloquees} bloquée(s)${r.dangereuses ? `, ${r.dangereuses} dangereuse(s)` : ''}${r.premier ? ` · actif de ${heure(r.premier)} à ${heure(r.dernier)}` : ''}\n${r.sites.length ? `Sites les plus vus : ${r.sites.map((x) => `${x.site} (${x.n})`).join(', ')}` : 'Aucune activité vue par Sphinx.'}${r.refuses.length ? `\nBloqués : ${r.refuses.map((x) => `${x.site} (${x.b})`).join(', ')}` : ''}`;
const ageParam = { key: 'age', label: 'Âge', kind: 'select' as const, options: Object.keys(AGES), default: 'enfant', help: Object.entries(AGES).map(([k, v]) => `${k} : ${v.label}`).join(' · ') };

export const heidrun: Module = {
  id: 'heidrun', name: 'Héra', family: 'Maison',
  what: 'Le filtrage web et le contrôle parental : un profil par enfant avec ses appareils, des réglages tout prêts selon l\'âge, l\'heure du coucher, la pause d\'Internet d\'un geste et le rapport de la journée. Héra règle Sphinx, qui filtre pour toute la maison.',
  does: ['un profil par enfant : son âge et ses appareils (tablette, téléphone, console)', 'réglages tout prêts selon l\'âge : sites pour adultes bloqués, recherche sécurisée, réseaux sociaux et jeux en ligne coupés pour les plus jeunes', 'heure du coucher : Internet coupé la nuit, tous les jours ou certains jours', 'pause : Internet coupé tout de suite pour un enfant, et rétabli d\'un geste', 'rapport du jour ou du mois : sites les plus vus, tentatives bloquées, heures d\'activité', 'tout passe par Sphinx (le DNS d\'Odin) ; limite dite clairement : un appareil en 4G ou sur un autre DNS y échappe'],
  from: ['AdGuard Home (contrôle parental)', 'Google Family Link', 'Pi-hole'], upstream: ['AdguardTeam/AdGuardHome', 'pi-hole/pi-hole'],
  words: ['contrôle parental', 'controle parental', 'filtrage web', 'heure du coucher', 'pause internet', 'temps d\'écran', 'profil enfant', 'profils enfants', 'héra', 'hera', 'heidrun', 'family link'],
  actions: [
    { id: 'profil', label: 'Créer ou régler un profil', what: 'Un enfant, son âge, ses appareils, son heure de coucher ; les réglages sont posés dans Sphinx', params: [{ key: 'nom', label: 'Prénom', kind: 'text', required: true }, ageParam, { key: 'appareils', label: 'Adresses de ses appareils', kind: 'text', default: '', help: 'ex. 192.168.1.20, 192.168.1.21 (voir Sphinx → Appareils du réseau)' }, { key: 'coucher_de', label: 'Coucher : Internet coupé à (vide : l\'heure conseillée pour son âge ; « non » : jamais)', kind: 'text', default: '' }, { key: 'coucher_a', label: 'Jusqu\'à', kind: 'text', default: '' }, { key: 'jours', label: 'Jours (tous, ou lun, mar…)', kind: 'text', default: 'tous' }],
      words: ['crée un profil enfant', 'ajoute un profil enfant'], run: async (ctx, i) => {
        const nom = s(i.nom).trim().slice(0, 40); if (!nom) throw new Error('prénom vide');
        const age = (s(i.age) in AGES ? s(i.age) : 'enfant') as Age, l = profils(ctx), old = l.find((x) => x.nom.toLowerCase() === nom.toLowerCase());
        const ap = s(i.appareils).trim() ? adresses(i.appareils) : old?.appareils ?? [];
        const pris = l.find((x) => x !== old && x.appareils.some((ip) => ap.includes(ip))); if (pris) throw new Error(`un de ces appareils est déjà dans le profil de ${pris.nom}`);
        const de = s(i.coucher_de).trim(), conseil = AGES[age].coucher;
        const coucher = /^(non|jamais|aucun)$/i.test(de) ? undefined : de ? { jours: s(i.jours).trim() || 'tous', de: hm(de), a: hm(s(i.coucher_a).trim() || conseil?.a || '07:00') } : old?.coucher && old.age === age ? old.coucher : conseil ? { jours: s(i.jours).trim() || 'tous', ...conseil } : undefined;
        const p: Profil = { id: old?.id ?? `${slug(nom)}-${Date.now().toString(36).slice(-4)}`, nom, age, appareils: ap, coucher, pause: old?.pause, cree: old?.cree ?? ctx.now().getTime() };
        if (old && old.appareils.join() !== ap.join()) await retirerDeSphinx(ctx, old);
        const notes = await appliquer(ctx, p);
        ctx.saveSettings({ profils: [...l.filter((x) => x !== old), p] });
        return { text: `👨‍👩‍👧 Profil de ${nom} (${AGES[age].label}) : ${AGES[age].quoi}.\n${ap.length ? `Appareils : ${ap.join(', ')}` : 'Aucun appareil pour l\'instant.'} · ${etatDe(p)}.${notes.length ? `\n⚠ ${notes.join(' ; ')}` : ''}`, data: p };
      } },
    { id: 'pause', label: 'Pause d\'Internet', what: 'Coupe Internet tout de suite pour un enfant (ses appareils), jusqu\'à ce que tu le rétablisses', params: [{ key: 'nom', label: 'Prénom', kind: 'text', required: true }], words: ['pause internet pour', 'mets internet en pause pour'], run: async (ctx, i) => {
      const p = trouver(ctx, i.nom); p.pause = true; const notes = await appliquer(ctx, p); ctx.saveSettings({ profils: profils(ctx).map((x) => (x.id === p.id ? p : x)) });
      return { text: `⏸ Internet est en pause pour ${p.nom} (${p.appareils.length} appareil(s)).${notes.length ? `\n⚠ ${notes.join(' ; ')}` : ''}` };
    }, undo: (i) => ({ action: 'reprendre', input: { nom: i.nom }, label: 'Rétablir Internet' }) },
    { id: 'reprendre', label: 'Rétablir Internet', what: 'Fin de la pause : l\'enfant retrouve Internet (l\'heure du coucher reste en place)', words: ['rétablis internet pour', 'fin de la pause internet pour'], params: [{ key: 'nom', label: 'Prénom', kind: 'text', required: true }], run: async (ctx, i) => {
      const p = trouver(ctx, i.nom); p.pause = false;
      if (sphinx(ctx) && p.appareils.length) await ctx.call('vidarr', 'retablir_machine', { ip: p.appareils[0] }, undefined, { interne: true }).catch(() => undefined);
      const notes = await appliquer(ctx, p); ctx.saveSettings({ profils: profils(ctx).map((x) => (x.id === p.id ? p : x)) });
      return { text: `▶ ${p.nom} retrouve Internet${p.coucher ? ` (coucher toujours à ${p.coucher.de})` : ''}.${notes.length ? `\n⚠ ${notes.join(' ; ')}` : ''}` };
    } },
    { id: 'rapport', label: 'Rapport', what: 'Ce que Sphinx a vu des appareils d\'un enfant : sites les plus vus, bloqués, heures d\'activité', read: true, params: [{ key: 'nom', label: 'Prénom', kind: 'text', required: true }, { key: 'periode', label: 'Période', kind: 'select', options: ['jour', 'mois'], default: 'jour' }], words: ['rapport du contrôle parental de', 'sites vus par'], run: async (ctx, i) => {
      const p = trouver(ctx, i.nom), per = s(i.periode) === 'mois' ? 'mois' : 'jour', r = rapport(await vuParSphinx(ctx, per), p.appareils);
      return { text: texteRapport(p, r, per === 'mois' ? 'ce mois-ci' : 'aujourd\'hui'), data: r };
    } },
    { id: 'profils', label: 'Profils', what: 'Les enfants, leurs appareils et leurs réglages', words: ['profils du contrôle parental'], read: true, run: (ctx) => { const l = profils(ctx); return { text: l.length ? l.map((p) => `- ${p.nom} (${AGES[p.age].label}) : ${p.appareils.join(', ') || 'aucun appareil'} · ${etatDe(p)}`).join('\n') : 'Aucun profil. Crée celui de ton enfant : prénom, âge, adresses de ses appareils.', data: l }; } },
    { id: 'retirer', label: 'Retirer un profil', what: 'Le profil et ses réglages dans Sphinx sont retirés (l\'enfant suit les réglages de la maison)', words: ['retire le profil enfant'], params: [{ key: 'nom', label: 'Prénom', kind: 'text', required: true }], run: async (ctx, i) => {
      const p = trouver(ctx, i.nom); await retirerDeSphinx(ctx, p); ctx.saveSettings({ profils: profils(ctx).filter((x) => x.id !== p.id) });
      return { text: `Profil de ${p.nom} retiré : ses appareils suivent maintenant les réglages de toute la maison.` };
    } },
  ],
  async view(ctx) {
    const l = profils(ctx), vu = l.length ? await vuParSphinx(ctx) : {}, ok = sphinx(ctx);
    const rap = new Map(l.map((p) => [p.id, rapport(vu, p.appareils)]));
    const kpis: Kpi[] = [{ label: 'Profils', value: String(l.length) }, { label: 'Appareils suivis', value: String(l.reduce((a, p) => a + p.appareils.length, 0)) }, { label: 'Bloqués aujourd\'hui', value: String([...rap.values()].reduce((a, r) => a + r.bloquees, 0)), tone: 'neutre' }, { label: 'En pause', value: String(l.filter((p) => p.pause).length), tone: l.some((p) => p.pause) ? 'attention' : 'neutre' }];
    return {
      subtitle: l.length ? `${l.length} profil(s)` : 'Aucun profil : crée celui de ton enfant.', kpis,
      sections: [
        ...(!l.length ? [{ kind: 'steps' as const, title: 'Mise en route', items: [{ title: 'Sphinx (le DNS d\'Odin) filtre pour la maison', detail: ok ? 'présent : vérifie qu\'il est démarré et que la box donne son adresse aux appareils' : 'absent', done: ok }, { title: 'Créer le profil de ton enfant', detail: 'prénom, âge, adresses de ses appareils', done: false }] }] : []),
        { kind: 'cards', title: 'Les enfants', items: l.map((p) => { const r = rap.get(p.id)!; return { title: p.nom, sub: `${AGES[p.age].label} · ${p.appareils.length} appareil(s)`, badge: p.pause ? 'en pause' : p.coucher ? `coucher ${p.coucher.de}` : undefined, tone: p.pause ? 'attention' as const : 'bon' as const, meta: `Aujourd'hui : ${r.requetes} demande(s), ${r.bloquees} bloquée(s)${r.premier ? ` · ${heure(r.premier)} → ${heure(r.dernier)}` : ''}`, actions: [{ action: p.pause ? 'reprendre' : 'pause', label: p.pause ? 'Rétablir Internet' : 'Pause', input: { nom: p.nom } }, { action: 'rapport', label: 'Rapport', input: { nom: p.nom } }] }; }) },
        ...l.filter((p) => rap.get(p.id)!.sites.length).map((p) => ({ kind: 'bars' as const, title: `${p.nom} : sites les plus vus aujourd'hui`, items: rap.get(p.id)!.sites.map((x) => ({ label: x.site, value: x.n })) })),
        { kind: 'form', title: 'Créer ou régler un profil', action: 'profil', submit: 'Enregistrer', params: [{ key: 'nom', label: 'Prénom', kind: 'text', required: true }, ageParam, { key: 'appareils', label: 'Adresses de ses appareils', kind: 'text', default: '', help: 'ex. 192.168.1.20, 192.168.1.21' }, { key: 'coucher_de', label: 'Internet coupé à (vide : conseillé pour son âge ; « non » : jamais)', kind: 'text', default: '' }, { key: 'coucher_a', label: 'Jusqu\'à', kind: 'text', default: '' }] },
      ],
      side: [
        { kind: 'list', title: 'Réglages selon l\'âge', items: Object.values(AGES).map((a) => ({ title: a.label, detail: `${a.quoi}${a.coucher ? ` · coucher conseillé ${a.coucher.de}` : ''}` })) },
        { kind: 'text', title: 'Ce qu\'Héra ne peut pas faire', text: 'Le filtrage passe par le DNS d\'Odin (Sphinx). Un appareil qui passe par les données mobiles (4G, 5G), par un VPN, ou réglé à la main sur un autre DNS y échappe. Pour l\'empêcher : coupe les données mobiles sur l\'appareil de l\'enfant, et bloque les autres DNS sur la box.' },
      ],
    };
  },
};
