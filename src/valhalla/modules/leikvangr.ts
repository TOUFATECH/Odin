// Olympie — les jeux rétro (comme RetroArch / EmulationStation, côté bibliothèque) : Odin range TES jeux par
// console d'après leurs fichiers, nettoie les noms (région, version), repère les variantes d'un même jeu, garde
// tes favoris et ce que tu as joué, prépare les listes de lecture de RetroArch, et lance un jeu sur l'écran de la
// machine quand RetroArch est installé. Odin ne télécharge aucun jeu : seulement tes propres copies.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, sep } from 'node:path';
import type { Kpi, ModCtx, Module } from '../types.ts';

export interface Console { id: string; nom: string; ext: string[]; dossiers: RegExp; coeur: string; base: string }
export interface Jeu { chemin: string; nom: string; console: string; region?: string; octets: number }
const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));

/** Les consoles reconnues : extensions propres, noms de dossier habituels, cœur RetroArch conseillé, nom de la base RetroArch. */
export const CONSOLES: Console[] = [
  { id: 'nes', nom: 'Nintendo NES', ext: ['nes', 'fds', 'unf'], dossiers: /^(nes|famicom|nintendo)$/i, coeur: 'nestopia', base: 'Nintendo - Nintendo Entertainment System' },
  { id: 'snes', nom: 'Super Nintendo', ext: ['sfc', 'smc'], dossiers: /^(snes|sfc|super ?nintendo|superfamicom)$/i, coeur: 'snes9x', base: 'Nintendo - Super Nintendo Entertainment System' },
  { id: 'gb', nom: 'Game Boy', ext: ['gb'], dossiers: /^(gb|game ?boy)$/i, coeur: 'gambatte', base: 'Nintendo - Game Boy' },
  { id: 'gbc', nom: 'Game Boy Color', ext: ['gbc'], dossiers: /^(gbc|game ?boy ?color)$/i, coeur: 'gambatte', base: 'Nintendo - Game Boy Color' },
  { id: 'gba', nom: 'Game Boy Advance', ext: ['gba'], dossiers: /^(gba|game ?boy ?advance)$/i, coeur: 'mgba', base: 'Nintendo - Game Boy Advance' },
  { id: 'n64', nom: 'Nintendo 64', ext: ['n64', 'z64', 'v64'], dossiers: /^(n64|nintendo ?64)$/i, coeur: 'mupen64plus_next', base: 'Nintendo - Nintendo 64' },
  { id: 'nds', nom: 'Nintendo DS', ext: ['nds'], dossiers: /^(nds|ds|nintendo ?ds)$/i, coeur: 'melonds', base: 'Nintendo - Nintendo DS' },
  { id: 'megadrive', nom: 'Mega Drive', ext: ['gen', 'smd', 'md'], dossiers: /^(megadrive|mega ?drive|genesis|md)$/i, coeur: 'genesis_plus_gx', base: 'Sega - Mega Drive - Genesis' },
  { id: 'mastersystem', nom: 'Master System', ext: ['sms'], dossiers: /^(mastersystem|master ?system|sms)$/i, coeur: 'genesis_plus_gx', base: 'Sega - Master System - Mark III' },
  { id: 'gamegear', nom: 'Game Gear', ext: ['gg'], dossiers: /^(gamegear|game ?gear|gg)$/i, coeur: 'genesis_plus_gx', base: 'Sega - Game Gear' },
  { id: 'pcengine', nom: 'PC Engine', ext: ['pce'], dossiers: /^(pcengine|pc ?engine|pce|turbografx.*)$/i, coeur: 'mednafen_pce_fast', base: 'NEC - PC Engine - TurboGrafx 16' },
  { id: 'atari2600', nom: 'Atari 2600', ext: ['a26'], dossiers: /^(atari ?2600|a2600)$/i, coeur: 'stella', base: 'Atari - 2600' },
  { id: 'atari7800', nom: 'Atari 7800', ext: ['a78'], dossiers: /^(atari ?7800|a7800)$/i, coeur: 'prosystem', base: 'Atari - 7800' },
  { id: 'lynx', nom: 'Atari Lynx', ext: ['lnx'], dossiers: /^(lynx|atari ?lynx)$/i, coeur: 'handy', base: 'Atari - Lynx' },
  { id: 'psx', nom: 'PlayStation', ext: ['pbp'], dossiers: /^(psx|ps1|psone|playstation)$/i, coeur: 'pcsx_rearmed', base: 'Sony - PlayStation' },
  { id: 'psp', nom: 'PSP', ext: ['cso'], dossiers: /^(psp|playstation ?portable)$/i, coeur: 'ppsspp', base: 'Sony - PlayStation Portable' },
  { id: 'dreamcast', nom: 'Dreamcast', ext: ['cdi', 'gdi'], dossiers: /^(dreamcast|dc)$/i, coeur: 'flycast', base: 'Sega - Dreamcast' },
  { id: 'saturn', nom: 'Saturn', ext: [], dossiers: /^(saturn|sega ?saturn)$/i, coeur: 'mednafen_saturn', base: 'Sega - Saturn' },
  { id: 'arcade', nom: 'Arcade', ext: [], dossiers: /^(arcade|mame|fbneo|fba|neogeo|neo ?geo|cps[123]?)$/i, coeur: 'fbneo', base: 'FBNeo - Arcade Games' },
];
/** Extensions partagées par plusieurs consoles : c'est le dossier qui décide. */
const PARTAGEES = new Set(['zip', '7z', 'iso', 'cue', 'chd', 'bin', 'img', 'ccd', 'm3u']);
const PISTES = new Set(['bin', 'img', 'ccd']); // morceaux d'un disque : le .cue ou le .m3u suffit dans la liste

/** La console d'un fichier : par son extension, sinon par le nom d'un de ses dossiers. Pur. */
export function consoleDe(chemin: string): Console | undefined {
  const ext = extname(chemin).slice(1).toLowerCase(), dirs = chemin.split(/[\\/]/).slice(0, -1).reverse();
  const parDossier = () => { for (const d of dirs) { const c = CONSOLES.find((x) => x.dossiers.test(d)); if (c) return c; } return undefined; };
  if (ext === 'md') return parDossier()?.id === 'megadrive' ? parDossier() : undefined; // « .md » est aussi du Markdown
  const direct = CONSOLES.find((c) => c.ext.includes(ext)); if (direct) return direct;
  return PARTAGEES.has(ext) ? parDossier() : undefined;
}
/** « Sonic the Hedgehog (Europe) (Rev 1) [!].md » → nom propre et région. Pur. */
export function nomPropre(fichier: string): { nom: string; region?: string } {
  const brut = basename(fichier).replace(/\.[^.]+$/, ''), tags = [...brut.matchAll(/[([]([^)\]]+)[)\]]/g)].map((m) => m[1]);
  const region = tags.map((t) => /^(Europe|France|USA|Japan|World|Germany|Spain|Italy|Brazil|Korea|Asia|Australia|En|Fr)(,|$)/i.exec(t)?.[1]).find(Boolean);
  let nom = brut.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const art = /^(.*), (The|Le|La|Les|L')$/i.exec(nom); if (art) nom = `${art[2]}${art[2].endsWith('\'') ? '' : ' '}${art[1]}`;
  return { nom: nom || brut, ...(region ? { region: ({ en: 'Europe', fr: 'France' } as Record<string, string>)[region.toLowerCase()] ?? region } : {}) };
}
/** Parcourt le dossier des jeux. Les pistes d'un disque (.bin à côté d'un .cue) ne comptent pas comme des jeux. */
export function ranger(racines: string[]): Jeu[] {
  const out: Jeu[] = [];
  const walk = (d: string, n: number) => {
    if (n > 5) return; let names: string[] = []; try { names = readdirSync(d); } catch { return; }
    const aCue = names.some((e) => /\.(cue|m3u|gdi)$/i.test(e));
    for (const e of names.sort()) {
      if (e.startsWith('.')) continue; const p = join(d, e); let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { walk(p, n + 1); continue; }
      const ext = extname(e).slice(1).toLowerCase(); if (aCue && PISTES.has(ext)) continue;
      const c = consoleDe(p); if (!c) continue;
      const np = nomPropre(e); out.push({ chemin: p, nom: np.nom, console: c.id, ...(np.region ? { region: np.region } : {}), octets: st.size });
    }
  };
  for (const r of racines) walk(r, 0);
  return out.sort((a, b) => a.console.localeCompare(b.console) || a.nom.localeCompare(b.nom, 'fr'));
}
/** Les jeux présents en plusieurs versions (même console, même nom propre). Pur. */
export function variantes(l: Jeu[]): Jeu[][] {
  const g = new Map<string, Jeu[]>(); for (const j of l) { const k = `${j.console}|${j.nom.toLowerCase()}`; g.set(k, [...(g.get(k) ?? []), j]); }
  return [...g.values()].filter((x) => x.length > 1);
}
/** Une liste de lecture RetroArch (.lpl) pour une console. Pur. */
export function listeRetroarch(c: Console, jeux: Jeu[]): string {
  return JSON.stringify({ version: '1.5', default_core_path: '', default_core_name: '', label_display_mode: 0, right_thumbnail_mode: 0, left_thumbnail_mode: 0, sort_mode: 0, items: jeux.map((j) => ({ path: j.chemin, label: j.nom, core_path: 'DETECT', core_name: 'DETECT', crc32: 'DETECT', db_name: `${c.base}.lpl` })) }, null, 2);
}
const taille = (o: number) => (o >= 1024 ** 3 ? `${(o / 1024 ** 3).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go` : `${Math.max(1, Math.round(o / 1024 ** 2))} Mo`);
const dossiers = (ctx: ModCtx): string[] => { const l = (ctx.settings.dossiers as string[] | undefined) ?? []; return l.length ? l : ['ROMs', 'roms', 'Roms', join('RetroPie', 'roms'), join('Jeux', 'ROMs'), join('Games', 'ROMs')].map((d) => join(homedir(), d)).filter((d) => existsSync(d)); };
const lire = (ctx: ModCtx): Jeu[] => { try { return JSON.parse(readFileSync(join(ctx.dir, 'jeux.json'), 'utf8')) as Jeu[]; } catch { return []; } };
const ecrire = (ctx: ModCtx, l: Jeu[]) => { mkdirSync(ctx.dir, { recursive: true }); writeFileSync(join(ctx.dir, 'jeux.json.tmp'), JSON.stringify(l)); renameSync(join(ctx.dir, 'jeux.json.tmp'), join(ctx.dir, 'jeux.json')); };
const favoris = (ctx: ModCtx): string[] => (ctx.settings.favoris as string[] | undefined) ?? [];
const joues = (ctx: ModCtx): Record<string, { n: number; dernier: number }> => (ctx.settings.joues as Record<string, { n: number; dernier: number }> | undefined) ?? {};
const consoleNom = (id: string) => CONSOLES.find((c) => c.id === id)?.nom ?? id;
function trouver(ctx: ModCtx, qui: unknown): Jeu {
  const k = s(qui).trim().toLowerCase(), l = lire(ctx); if (!k) throw new Error('quel jeu ?');
  const j = l.find((x) => x.chemin.toLowerCase() === k) ?? l.find((x) => x.nom.toLowerCase() === k) ?? l.find((x) => x.nom.toLowerCase().includes(k));
  if (!j) throw new Error(l.length ? `jeu « ${s(qui)} » introuvable` : 'aucun jeu rangé : lance « Ranger les jeux »'); return j;
}
/** Les cœurs RetroArch installés (fichiers *_libretro.so / .dll / .dylib). */
function coeurs(): Map<string, string> {
  const out = new Map<string, string>(), h = homedir();
  for (const d of [join(h, '.config/retroarch/cores'), join(h, '.var/app/org.libretro.RetroArch/config/retroarch/cores'), '/usr/lib/libretro', '/usr/lib/x86_64-linux-gnu/libretro', '/usr/lib64/libretro', join(h, 'AppData/Roaming/RetroArch/cores'), join(h, 'Library/Application Support/RetroArch/cores')]) {
    let names: string[] = []; try { names = readdirSync(d); } catch { continue; }
    for (const e of names) { const m = /^(.+)_libretro\.(so|dll|dylib)$/.exec(e); if (m && !out.has(m[1])) out.set(m[1], join(d, e)); }
  }
  return out;
}

export const leikvangr: Module = {
  id: 'leikvangr', name: 'Olympie', family: 'Maison',
  what: 'Les jeux rétro (comme RetroArch) : tes jeux rangés par console, les noms nettoyés, tes favoris et ce que tu as joué, les listes de lecture pour RetroArch, et le lancement d\'un jeu sur l\'écran de la machine. Odin ne télécharge aucun jeu.',
  does: ['tes jeux rangés par console (19 consoles reconnues : NES, Super Nintendo, Game Boy, Nintendo 64, Mega Drive, PlayStation, arcade…)', 'noms nettoyés : région et version retirées du titre, gardées à part', 'variantes d\'un même jeu (plusieurs régions ou versions) repérées', 'favoris, nombre de parties et dernière partie', 'listes de lecture RetroArch (.lpl) fabriquées pour chaque console', 'lancement d\'un jeu avec RetroArch et le bon cœur, sur l\'écran de la machine d\'Odin', 'tes propres copies seulement : aucun téléchargement de jeux'],
  from: ['RetroArch', 'EmulationStation', 'RomM'], upstream: ['libretro/RetroArch', 'rommapp/romm'],
  words: ['jeux rétro', 'jeux retro', 'rétrogaming', 'retrogaming', 'émulateur', 'emulateur', 'retroarch', 'roms', 'olympie', 'leikvangr', 'emulationstation'],
  actions: [
    { id: 'ranger', label: 'Ranger les jeux', what: 'Parcourt ton dossier de jeux et les range par console', words: ['range mes jeux rétro', 'indexe mes jeux rétro'], run: (ctx) => {
      const d = dossiers(ctx); if (!d.length) throw new Error('aucun dossier de jeux : ajoute le tien (« Dossier des jeux »)');
      const l = ranger(d); ecrire(ctx, l); ctx.saveSettings({ dernier: ctx.now().getTime() });
      const par = new Map<string, number>(); for (const j of l) par.set(j.console, (par.get(j.console) ?? 0) + 1);
      return { text: `🎮 ${l.length} jeu(x) sur ${par.size} console(s) : ${[...par.entries()].map(([c, n]) => `${consoleNom(c)} (${n})`).join(', ') || 'rien trouvé'}.`, data: { jeux: l.length } };
    } },
    { id: 'dossier', label: 'Dossier des jeux', what: 'Le dossier où sont tes jeux (un sous-dossier par console : snes, gba, psx…)', words: ['ajoute un dossier de jeux rétro'], params: [{ key: 'chemin', label: 'Chemin du dossier', kind: 'text', required: true }], run: (ctx, i) => {
      const d = s(i.chemin).trim(); if (!d || !existsSync(d) || !statSync(d).isDirectory()) throw new Error('dossier introuvable');
      ctx.saveSettings({ dossiers: [...new Set([...((ctx.settings.dossiers as string[] | undefined) ?? []), d])] }); return { text: `📁 ${d} ajouté : lance « Ranger les jeux ».` };
    } },
    { id: 'jeux', label: 'Jeux', what: 'Tes jeux, par console ou par nom', read: true, params: [{ key: 'console', label: 'Console (vide : toutes)', kind: 'select', options: ['', ...CONSOLES.map((c) => c.id)], default: '' }, { key: 'texte', label: 'Dans le nom', kind: 'text', default: '' }], words: ['mes jeux rétro', 'quels jeux rétro'], run: (ctx, i) => {
      const l = lire(ctx).filter((j) => (!s(i.console) || j.console === s(i.console)) && (!s(i.texte) || j.nom.toLowerCase().includes(s(i.texte).toLowerCase())));
      return { text: l.length ? `${l.length} jeu(x) :\n${l.slice(0, 60).map((j) => `- ${j.nom}${j.region ? ` (${j.region})` : ''} · ${consoleNom(j.console)}`).join('\n')}` : 'Aucun jeu (lance « Ranger les jeux »).', data: l.slice(0, 500) };
    } },
    { id: 'variantes', label: 'Variantes', what: 'Les jeux que tu as en plusieurs versions ou régions', words: ['variantes de mes jeux rétro'], read: true, run: (ctx) => { const v = variantes(lire(ctx)); return { text: v.length ? v.slice(0, 40).map((x) => `- ${x[0].nom} (${consoleNom(x[0].console)}) : ${x.map((j) => j.region ?? basename(j.chemin)).join(', ')}`).join('\n') : 'Aucun jeu en double.', data: v }; } },
    { id: 'favori', label: 'Favori', what: 'Ajoute un jeu aux favoris, ou l\'en retire', words: ['mets en favori le jeu rétro'], params: [{ key: 'jeu', label: 'Jeu (nom)', kind: 'text', required: true }], run: (ctx, i) => {
      const j = trouver(ctx, i.jeu), f = favoris(ctx), on = !f.includes(j.chemin); ctx.saveSettings({ favoris: on ? [...f, j.chemin] : f.filter((x) => x !== j.chemin) });
      return { text: on ? `⭐ ${j.nom} est dans tes favoris.` : `${j.nom} n'est plus dans tes favoris.` };
    } },
    { id: 'lancer', label: 'Lancer un jeu', what: 'Ouvre le jeu avec RetroArch sur l\'écran de la machine d\'Odin', params: [{ key: 'jeu', label: 'Jeu (nom)', kind: 'text', required: true }], words: ['lance le jeu rétro', 'joue au jeu rétro'], run: async (ctx, i) => {
      const j = trouver(ctx, i.jeu), c = CONSOLES.find((x) => x.id === j.console)!;
      if (!await ctx.has('retroarch')) throw new Error('RetroArch n\'est pas installé sur la machine d\'Odin (paquet « retroarch »)');
      if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) throw new Error('la machine d\'Odin n\'a pas d\'écran ouvert : lance le jeu depuis un poste avec RetroArch et la liste de lecture d\'Olympie');
      const co = coeurs(), coeur = co.get(c.coeur) ?? [...co.entries()].find(([k]) => k.startsWith(c.coeur.split('_')[0]))?.[1];
      if (!coeur) throw new Error(`il manque le cœur « ${c.coeur} » dans RetroArch (Menu → Charger un cœur → Télécharger un cœur)`);
      // Le jeu part en arrière-plan : Odin n'attend pas la fin de la partie. Les chemins sont passés tels quels, jamais interprétés.
      const r = await ctx.run('sh', ['-c', 'nohup "$0" -L "$1" "$2" >/dev/null 2>&1 &', 'retroarch', coeur, j.chemin], { timeoutMs: 8000 }); if (r.code) throw new Error(r.err.trim() || 'RetroArch n\'a pas démarré');
      const jo = joues(ctx); jo[j.chemin] = { n: (jo[j.chemin]?.n ?? 0) + 1, dernier: ctx.now().getTime() }; ctx.saveSettings({ joues: jo });
      return { text: `🎮 ${j.nom} (${c.nom}) démarre sur l'écran de la machine.` };
    } },
    { id: 'listes_retroarch', label: 'Listes pour RetroArch', what: 'Fabrique une liste de lecture (.lpl) par console, à copier dans le dossier « playlists » de RetroArch', words: ['prépare les listes retroarch'], run: (ctx) => {
      const l = lire(ctx); if (!l.length) throw new Error('aucun jeu rangé : lance « Ranger les jeux »');
      const d = join(ctx.dir, 'playlists'); mkdirSync(d, { recursive: true }); let n = 0;
      for (const c of CONSOLES) { const jx = l.filter((j) => j.console === c.id); if (!jx.length) continue; writeFileSync(join(d, `${c.base}.lpl`), listeRetroarch(c, jx)); n++; }
      return { text: `📜 ${n} liste(s) de lecture écrite(s) dans ${d}${sep} : copie-les dans le dossier « playlists » de RetroArch.`, data: { dossier: d } };
    } },
  ],
  async view(ctx) {
    const l = lire(ctx), f = favoris(ctx), jo = joues(ctx), co = coeurs(), ra = await ctx.has('retroarch');
    const par = CONSOLES.map((c) => ({ c, n: l.filter((j) => j.console === c.id).length })).filter((x) => x.n);
    const recents = Object.entries(jo).sort((a, b) => b[1].dernier - a[1].dernier).slice(0, 8).map(([p, x]) => ({ j: l.find((y) => y.chemin === p), x })).filter((y) => y.j);
    const kpis: Kpi[] = [{ label: 'Jeux', value: String(l.length) }, { label: 'Consoles', value: String(par.length) }, { label: 'Favoris', value: String(f.length) }, { label: 'Place', value: taille(l.reduce((a, j) => a + j.octets, 0)) }, { label: 'RetroArch', value: ra ? `${co.size} cœur(s)` : 'absent', tone: ra ? 'bon' : 'neutre' }];
    const carte = (j: Jeu) => ({ title: j.nom, sub: `${consoleNom(j.console)}${j.region ? ` · ${j.region}` : ''}`, badge: f.includes(j.chemin) ? '⭐' : undefined, meta: jo[j.chemin] ? `${jo[j.chemin].n} partie(s)` : taille(j.octets), actions: [...(ra ? [{ action: 'lancer', label: 'Jouer', input: { jeu: j.chemin } }] : []), { action: 'favori', label: f.includes(j.chemin) ? 'Retirer des favoris' : 'Favori', input: { jeu: j.chemin } }] });
    return {
      subtitle: l.length ? `${l.length} jeu(x) · ${par.length} console(s)` : 'Pas encore rangé : indique ton dossier de jeux.', kpis,
      sections: [
        ...(!l.length ? [{ kind: 'steps' as const, title: 'Mise en route', items: [{ title: 'Ton dossier de jeux', detail: dossiers(ctx).join(', ') || 'aucun trouvé (un sous-dossier par console : snes, gba, psx…)', done: dossiers(ctx).length > 0 }, { title: 'Ranger les jeux', done: false, action: 'ranger', button: 'Ranger' }] }] : []),
        ...(f.length ? [{ kind: 'cards' as const, title: 'Favoris', items: l.filter((j) => f.includes(j.chemin)).slice(0, 12).map(carte) }] : []),
        ...(recents.length ? [{ kind: 'cards' as const, title: 'Joués récemment', items: recents.map((y) => carte(y.j!)) }] : []),
        { kind: 'bars', title: 'Par console', items: par.map((x) => ({ label: x.c.nom, value: x.n })) },
        { kind: 'table', title: 'Tous les jeux', columns: ['Jeu', 'Console', 'Région', 'Taille'], empty: 'Aucun jeu rangé.', rows: l.slice(0, 200).map((j) => ({ cells: [j.nom, consoleNom(j.console), j.region ?? '', taille(j.octets)], actions: [...(ra ? [{ action: 'lancer', label: 'Jouer', input: { jeu: j.chemin } }] : []), { action: 'favori', label: f.includes(j.chemin) ? '★' : '☆', input: { jeu: j.chemin } }] })) },
      ],
      side: [
        { kind: 'list', title: 'Dossiers des jeux', empty: 'Aucun dossier.', items: dossiers(ctx).map((d) => ({ title: d })) },
        { kind: 'text', title: 'Tes propres jeux seulement', text: 'Olympie range et lance les copies que tu possèdes. Odin ne télécharge aucun jeu et ne propose aucun site pour en trouver.' },
        { kind: 'text', title: 'Jouer', text: ra ? `RetroArch est installé (${co.size} cœur(s)). « Jouer » ouvre le jeu sur l'écran de la machine d'Odin.` : 'RetroArch n\'est pas installé sur la machine d\'Odin. Les « Listes pour RetroArch » servent à retrouver tes jeux rangés dans RetroArch sur un autre poste.' },
      ],
    };
  },
  watch: { every: 12 * 3600, run(ctx) { const d = dossiers(ctx); if (d.length && lire(ctx).length) ecrire(ctx, ranger(d)); } },
};
