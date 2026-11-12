// Apparence · les 20 thèmes d'Odin (maquettes validées). Le choix est gardé par Odin (le même sur tous tes
// écrans), se change dans les Réglages, en parlant (« Odin, change ton thème », « mets le thème glace »,
// « remets automatique », aussi sur Telegram), ou tout seul selon l'heure et la météo (au plus une fois par heure,
// sauf orage). Les couleurs et décors sont dans l'interface (themes.js) ; ici : le choix et la règle automatique.
import type { ModCtx, Module } from '../types.ts';

const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));
export const THEME_NAMES: Record<string, string> = {
  glace: 'Glace', vacances: 'Vacances', paysage: 'Paysage', ciel: 'Ciel', nuit: 'Nuit étoilée', aurore: 'Aurore boréale', ocean: 'Océan', plage: 'Plage et palmiers', foret: 'Forêt', montagne: 'Montagne',
  coucher: 'Coucher de soleil', desert: 'Désert', pluie: 'Pluie', orage: 'Orage', neige: 'Neige', mayotte: 'Mayotte', printemps: 'Printemps fleuri', automne: 'Automne', espace: 'Espace', valhalla: 'Valhalla (classique)',
};
const IDS = Object.keys(THEME_NAMES);
interface Wx { place?: string; temp?: number; code?: number }
const wordOf = (c?: number) => (c === undefined ? '' : c <= 1 ? 'beau' : c <= 3 ? 'nuageux' : c <= 48 ? 'brumeux' : c <= 67 || (c >= 80 && c <= 82) ? 'pluvieux' : c <= 77 || c === 85 || c === 86 ? 'neigeux' : 'orageux');

/** Le thème qui va avec l'heure et la météo (règles validées sur la maquette). Pur. */
export function autoTheme(hour: number, w?: Wx): { id: string; why: string } {
  const c = w?.code, t = w?.temp, at = w?.place ? ` à ${w.place}` : '';
  if (c !== undefined && c >= 95) return { id: 'orage', why: `orage${at}` };
  if (c !== undefined && ((c >= 51 && c <= 67) || (c >= 80 && c <= 82))) return { id: 'pluie', why: `il pleut${at}` };
  if (c !== undefined && ((c >= 71 && c <= 77) || c === 85 || c === 86)) return { id: 'neige', why: `il neige${at}` };
  if (hour >= 21 || hour < 6) return { id: 'nuit', why: 'c\'est la nuit' };
  if (hour < 9) return { id: 'paysage', why: 'c\'est le matin' };
  if (hour >= 17 && hour < 19) return { id: 'coucher', why: 'fin de journée' };
  if (t !== undefined && t > 32) return { id: 'glace', why: `il fait ${t}°${at}, pour rafraîchir` };
  if (c !== undefined && (c === 3 || c === 45 || c === 48)) return { id: 'foret', why: `ciel couvert${at}` };
  if (c !== undefined && c <= 2 && hour < 19) return hour < 14 ? { id: 'ciel', why: `il fait ${t ?? '?'}° et beau${at}` } : { id: 'plage', why: `il fait ${t ?? '?'}° et beau${at}` };
  return { id: 'mayotte', why: 'par défaut chez toi' };
}
/** L'heure locale (fuseau réglable, Mayotte par défaut). */
const hourIn = (d: Date, tz: string) => { try { return Number(new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(d)); } catch { return d.getHours(); } };

export const apparence: Module = (() => {
  const mode = (ctx: ModCtx) => (s(ctx.settings.mode) === 'fixe' ? 'fixe' : 'auto');
  async function meteo(ctx: ModCtx): Promise<Wx | undefined> {
    try { return (await ctx.call('gladsheim', 'meteo', {}, 'choisir le thème selon la météo')).data as Wx | undefined; } catch { return undefined; }
  }
  /** Le thème en ce moment : le choisi, ou l'automatique (au plus un changement par heure, sauf orage). */
  async function now(ctx: ModCtx): Promise<{ mode: 'auto' | 'fixe'; theme: string; why: string; wx?: Wx }> {
    if (mode(ctx) === 'fixe' && THEME_NAMES[s(ctx.settings.theme)]) return { mode: 'fixe', theme: s(ctx.settings.theme), why: 'choisi par toi' };
    const wx = await meteo(ctx), c = autoTheme(hourIn(ctx.now(), s(ctx.settings.fuseau) || 'Indian/Mayotte'), wx);
    const last = ctx.settings.auto as { theme?: string; at?: number; why?: string } | undefined, t = ctx.now().getTime();
    if (last?.theme && last.theme !== c.id && t - (last.at ?? 0) < 3600_000 && c.id !== 'orage') return { mode: 'auto', theme: last.theme, why: last.why ?? '', wx };
    if (last?.theme !== c.id) ctx.saveSettings({ auto: { theme: c.id, at: t, why: c.why } });
    return { mode: 'auto', theme: c.id, why: c.why, wx };
  }
  const others = (cur: string) => ['glace', 'nuit', 'mayotte'].filter((x) => x !== cur).slice(0, 3).map((x) => THEME_NAMES[x]).concat('Au hasard').join(' · ');
  return {
    id: 'apparence', name: 'Apparence', family: 'Maison',
    what: 'Les 20 thèmes d\'Odin : couleurs, décor et couleur d\'Odin au repos, choisis par toi ou selon l\'heure et la météo.',
    does: ['20 thèmes (Glace, Vacances, Paysage, Ciel, Nuit étoilée, Plage, Mayotte…)', 'le même thème sur tous tes écrans', 'automatique : nuit, matin, journée, fin de journée, pluie, orage, chaleur', 'Odin prend la couleur du thème au repos ; ses humeurs gardent leurs couleurs', '« Odin, change ton thème », aussi sur Telegram'],
    from: [], upstream: [],
    words: ['change ton thème', 'change de thème', 'thème d\'odin', 'mets le thème', 'remets automatique', 'thèmes'],
    actions: [
      { id: 'etat', label: 'Thème actuel', what: 'Le thème d\'Odin en ce moment, et pourquoi', read: true, quiet: true, words: ['quel thème', 'thème actuel'], run: async (ctx) => {
        const n = await now(ctx); return { text: `🎨 Thème : ${THEME_NAMES[n.theme]} (${n.mode === 'auto' ? `automatique : ${n.why}` : 'choisi par toi'}).`, data: { mode: n.mode, theme: n.theme, name: THEME_NAMES[n.theme], why: n.why } };
      } },
      { id: 'theme', label: 'Changer de thème', what: 'Un thème au choix, « automatique » (heure et météo) ou « au hasard » ; sans précision, Odin choisit celui qui va avec le temps qu\'il fait', params: [{ key: 'theme', label: 'Thème', kind: 'select', options: ['automatique', 'au hasard', ...IDS], default: '' }],
        words: ['change ton thème', 'change de thème', 'mets le thème', 'remets automatique', 'thème automatique'], run: async (ctx, i) => {
          const want = s(i.theme).trim().toLowerCase(), before = (await now(ctx)).theme;
          if (/^auto/.test(want)) { ctx.saveSettings({ mode: 'auto', auto: undefined }); const n = await now(ctx); return { text: `🎨 Automatique : en ce moment ${THEME_NAMES[n.theme]} (${n.why}). Il changera selon l'heure et la météo.`, data: { mode: 'auto', theme: n.theme } }; }
          let id = IDS.find((x) => x === want) ?? IDS.find((x) => THEME_NAMES[x].toLowerCase() === want || THEME_NAMES[x].toLowerCase().startsWith(want) && want.length >= 3);
          let why = '';
          if (!id && /hasard/.test(want)) id = IDS.filter((x) => x !== before && x !== 'valhalla')[Math.floor(Math.random() * (IDS.length - 2))];
          if (!id && want) throw new Error(`thème inconnu : « ${want} » (${IDS.map((x) => THEME_NAMES[x]).join(', ')})`);
          if (!id) { // « change ton thème » : celui qui va avec le temps, sinon un autre
            const wx = await meteo(ctx), c = autoTheme(hourIn(ctx.now(), s(ctx.settings.fuseau) || 'Indian/Mayotte'), wx);
            id = c.id !== before ? c.id : IDS.filter((x) => x !== before && x !== 'valhalla')[Math.floor(Math.random() * (IDS.length - 2))]; why = c.id === id ? c.why : '';
          }
          ctx.saveSettings({ mode: 'fixe', theme: id });
          return { text: `🎨 Je passe en ${THEME_NAMES[id]}${why ? ` : ${why}` : ''}. Tu en préfères un autre ? ${others(id)}. Dis « remets automatique » pour suivre l'heure et la météo.`, data: { mode: 'fixe', theme: id } };
        } },
    ],
    async view(ctx) {
      const n = await now(ctx);
      return {
        subtitle: `${THEME_NAMES[n.theme]} · ${n.mode === 'auto' ? 'automatique' : 'choisi par toi'}`,
        kpis: [{ label: 'Thème', value: THEME_NAMES[n.theme] }, { label: 'Mode', value: n.mode === 'auto' ? 'Automatique' : 'Choisi', hint: n.why }],
        sections: [
          { kind: 'cards', title: 'Les 20 thèmes', items: IDS.map((id) => ({ title: THEME_NAMES[id], badge: id === n.theme ? 'en ce moment' : undefined, tone: id === n.theme ? 'bon' as const : 'neutre' as const, actions: id === n.theme ? [] : [{ action: 'theme', label: 'Choisir', input: { theme: id } }] })) },
          { kind: 'text', title: 'En automatique', text: '21 h – 6 h : Nuit étoilée · 6 h – 9 h : Paysage · journée, beau temps : Ciel, puis Plage l\'après-midi · 17 h – 19 h : Coucher de soleil · pluie : Pluie · orage ou cyclone : Orage · plus de 32° : Glace · ciel couvert : Forêt · sinon : Mayotte. Au plus un changement par heure, en fondu ; une alerte grave reste toujours rouge.' },
        ],
      };
    },
  };
})();
