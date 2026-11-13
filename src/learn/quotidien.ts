// Le « Quotidien » dans le Cerveau : ce qu'Odin a appris à refaire sans IA, en notes reliées.
//
// Chaque mission apprise (une demande → une ou plusieurs actions, voir acquis.ts) a sa note : ce qu'il
// fait (avec un lien vers chaque appli), les façons de le dire, comment il l'a appris, combien de fois il
// s'en est servi, les missions proches. Une note d'ensemble, « Cerveau direct », explique comment il
// réfléchit avec ces liens. Le graphe du Cerveau montre tout ça relié aux applis.
//
// Ces notes sont un MIROIR : les actions rejouées viennent de la mémoire d'Odin, jamais du texte d'une
// note (une note peut être modifiée par n'importe quoi ; une action, non). Odin les tient à jour ; ce que
// tu écris sous « Mes notes » est gardé. Mettre une note du Quotidien à la corbeille depuis le Cerveau,
// c'est lui demander d'oublier cette mission.

import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { formatNote, isoDay, parseNote, safeName, vaultEvents, type NoteMeta, type Vault } from '../brain/vault.ts';
import { fold, forget, loadAcquis, loadLinks, missionOf, stepsOf, wordsOf, type Acquis, type Kv, type Shape, type Step, type WordLink } from './acquis.ts';

const DIR = 'Quotidien', HUB = `${DIR}/Cerveau direct`, MINE = '## Mes notes', MAP = 'quotidien-notes';
const MINE_HINT = '_Écris ici ce que tu veux retenir : Odin ne touche pas à cette partie._';

/** Une mission : les mêmes actions, dites d'une ou plusieurs façons. */
export interface Mission { key: string; main: Acquis; all: Acquis[]; uses: number; last: number; at: number }
export interface DailyDeps {
  vault: Vault; kv: Kv;
  /** Le nom d'une appli d'Odin à partir de son identifiant (pour le lien vers sa fiche). */
  app?: (ref: string) => string | undefined;
  /** Masque les secrets connus avant d'écrire. */
  redact?: (t: string) => string;
  now?: number;
}

/** Regroupe les acquis par mission (plusieurs façons de le dire, les mêmes actions). La plus récemment utilisée d'abord. Pur. */
export function missions(list: Acquis[]): Mission[] {
  const by = new Map<string, Acquis[]>();
  for (const a of list) { const k = missionOf(a); by.set(k, [...(by.get(k) ?? []), a]); }
  return [...by.entries()].map(([key, all]) => {
    // La phrase d'origine (celle qu'une IA avait réglée) donne son nom à la mission ; les autres façons de le dire suivent.
    all.sort((x, y) => Number(x.origin === 'lien') - Number(y.origin === 'lien') || x.at - y.at);
    return { key, main: all[0], all, uses: all.reduce((n, a) => n + a.uses, 0), last: Math.max(...all.map((a) => a.last)), at: Math.min(...all.map((a) => a.at)) };
  }).sort((x, y) => y.last - x.last || x.key.localeCompare(y.key));
}

const fr = (at: number) => new Date(at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
/** Un texte venu d'une phrase ne doit ni créer de lien ni casser la mise en page. */
const plain = (x: string) => x.replace(/\[\[([^\]]*)\]\]/g, '« $1 »').replace(/[[\]|#^`*<>]/g, ' ').replace(/\s+/g, ' ').trim();
export const titleOf = (m: Mission): string => { const p = plain(m.main.phrase); return p.charAt(0).toUpperCase() + p.slice(1); };
const SHAPES: Record<Shape, string> = { ip: 'une adresse IP', nombre: 'un nombre', url: 'une adresse web', domaine: 'un nom de domaine', mot: 'un mot', texte: 'quelques mots' };

/** L'appli d'Odin derrière une action (pour relier la mission à sa fiche). */
const appRef = (s: Step): string | undefined => { const i = (s.input ?? {}) as Record<string, unknown>; return s.tool === 'valhalla' ? String(i.appli ?? '') || undefined : s.tool === 'ha_call' ? 'midgard' : s.tool === 'venus' ? 'freyja' : undefined; };
// Le nom ne doit pas dépendre du moment (applis démarrées ou non) : sinon la note changerait d'un lancement à l'autre.
const FIXED: Record<string, string> = { midgard: 'Midgard', freyja: 'Vénus' };
const appName = (s: Step, app?: DailyDeps['app']): string | undefined => {
  const r = appRef(s); if (!r) return undefined;
  return app?.(r) ?? FIXED[r] ?? (s.tool === 'valhalla' && s.label.includes(' · ') ? plain(s.label).split(' · ')[0] : undefined);
};
function stepLine(s: Step, app?: DailyDeps['app']): string {
  const name = appName(s, app), label = plain(s.label);
  if (!name) return label;
  return label.startsWith(`${name} · `) ? `[[${name}]] · ${label.slice(name.length + 3)}` : `${label} ([[${name}]])`;
}
/** Les valeurs de la phrase d'origine qui peuvent changer d'une fois sur l'autre. */
function slotValues(a: Acquis): string[] {
  if (!a.slots.length) return [];
  try { const m = new RegExp(a.pattern, 'ud').exec(fold(a.phrase)); return a.slots.map((_s, i) => { const span = m?.indices?.[i + 1]; return span ? a.phrase.slice(span[0], span[1]) : ''; }); } catch { return []; }
}
/** Les missions qui partagent au moins deux mots de sens avec celle-ci (trois au plus). */
function neighbours(m: Mission, all: Mission[]): Array<{ m: Mission; common: string[] }> {
  const mine = wordsOf(m.main);
  return all.filter((o) => o.key !== m.key)
    .map((o) => { const w = wordsOf(o.main); return { m: o, common: [...mine.keys()].filter((k) => w.has(k)).map((k) => mine.get(k) ?? k) }; })
    .filter((x) => x.common.length >= 2).sort((x, y) => y.common.length - x.common.length || y.m.uses - x.m.uses || x.m.key.localeCompare(y.m.key)).slice(0, 3);
}
const groupOf = (m: Mission, app?: DailyDeps['app']): string => {
  const names = [...new Set(stepsOf(m.main).map((s) => appName(s, app) ?? plain(s.label).split(' · ')[0]))];
  return names.length > 1 ? 'Plusieurs applis' : names[0] || 'Autres';
};
interface NoteCtx { all: Mission[]; links: WordLink[]; paths: Map<string, string>; app?: DailyDeps['app'] }
const linkTo = (m: Mission, c: NoteCtx) => `[[${c.paths.get(m.key) ?? `${DIR}/${safeName(titleOf(m))}`}|${titleOf(m)}]]`;

/** La note d'une mission (pur). */
export function missionNote(m: Mission, c: NoteCtx): { meta: NoteMeta; body: string } {
  const steps = stepsOf(m.main), apps = [...new Set(steps.map((s) => appName(s, c.app)).filter(Boolean))] as string[];
  const values = slotValues(m.main).map((v, i) => ({ v, shape: m.main.slots[i].shape })).filter((x) => x.v);
  const words = new Set(m.all.flatMap((a) => [...wordsOf(a).keys()]));
  const linked = c.links.filter((l) => words.has(l.a) && words.has(l.b));
  const near = neighbours(m, c.all);
  const body = [
    `# ${titleOf(m)}`,
    `> Mission du quotidien : je la refais **sans IA**. Note tenue par Odin, voir [[${HUB}|Cerveau direct]].`,
    '## Ce que je fais',
    steps.map((s, k) => `${k + 1}. ${stepLine(s, c.app)}`).join('\n'),
    ...(steps.length > 1 ? ['Dans cet ordre. Si une action échoue ou si tu la refuses, je m\'arrête là et je te le dis.'] : []),
    '## Comment tu le dis',
    m.all.map((a) => `- « ${plain(a.phrase)} » — ${a.origin === 'lien' ? `relié le ${fr(a.at)} : tu m'as dit oui` : `appris le ${fr(a.at)} : une IA l'avait réglé`}${a.uses ? ` · utilisé ${a.uses} fois` : ''}`).join('\n'),
    ...(values.length ? ['## Ce qui peut changer', `${values.map((x) => `« ${plain(x.v)} » (${SHAPES[x.shape]})`).join(', ')} : la même phrase avec une autre valeur marche aussi. L'appli et l'action, elles, ne changent jamais.`] : []),
    '## Comment je l\'ai appris',
    `Le ${fr(m.at)}, une IA a réglé cette demande ${steps.length > 1 ? `en ${steps.length} actions` : 'en une action'}. J'ai retenu « cette phrase → ${steps.length > 1 ? 'ces actions' : 'cette action'} ». ${m.uses ? `Depuis, je l'ai refaite seul ${m.uses} fois, la dernière le ${fr(m.last)}.` : 'Je ne l\'ai pas encore refaite seul.'}`,
    ...(linked.length ? ['## Mots que j\'ai reliés', linked.map((l) => `- « ${plain(l.said[0])} » = « ${plain(l.said[1])} »`).join('\n')] : []),
    ...(near.length ? ['## Missions proches', near.map((x) => `- ${linkTo(x.m, c)} (mots en commun : ${x.common.map(plain).join(', ')})`).join('\n')] : []),
    '## Pour me le faire oublier',
    `Dis « oublie l'acquis ${m.main.id} », ou mets cette note à la corbeille depuis le Cerveau. Je repasserai alors par une IA pour cette demande.`,
  ].join('\n\n');
  // Peu de propriétés : ce qui se trie dans la base « Quotidien », et de quoi retrouver la note si tu la renommes (« mission »).
  const meta: NoteMeta = {
    type: 'quotidien', appli: apps.join(', ') || plain(steps[0].label).split(' · ')[0], étapes: steps.length, utilisé: m.uses,
    'dernière fois': m.uses ? isoDay(new Date(m.last)) : undefined, mission: m.key, 'tenue par': 'Odin',
  };
  return { meta, body };
}

/** La note d'ensemble : comment marche le Cerveau direct, ce qu'il sait faire, les mots qu'il a reliés (pur). */
export function hubNote(all: Mission[], links: WordLink[], paths: Map<string, string>, app?: DailyDeps['app'], see: string[] = []): { meta: NoteMeta; body: string } {
  const c: NoteCtx = { all, links, paths, app };
  const groups = [...new Set(all.map((m) => groupOf(m, app)))].sort((a, b) => Number(a === 'Plusieurs applis') - Number(b === 'Plusieurs applis') || a.localeCompare(b, 'fr'));
  const body = [
    '# Cerveau direct',
    '> Ce que je sais refaire **sans IA**, parce que je l\'ai appris en te parlant. Note tenue par Odin.',
    '## Comment ça marche',
    [
      '1. **Tu demandes.** Si je sais déjà le faire seul, je le fais, sans IA.',
      '2. **Sinon, une IA s\'en charge.** Si elle règle ta demande par une action, ou par quelques actions à la suite, je retiens « cette phrase → ces actions » : c\'est une mission.',
      '3. **La fois suivante, je la refais seul.** La même phrase, ou la même avec une autre valeur (une autre adresse, un autre nom).',
      '4. **Je fais des liens.** Deux façons de dire la même mission ? Je relie le mot qui change (« lampe » = « lumière »).',
      '5. **Quand aucune IA ne répond, je réfléchis avec ces liens.** Si ta phrase ressemble à une mission que je connais, je te dis comment j\'ai fait le lien, et je te demande avant d\'agir. Après ton oui, cette façon de le dire est retenue.',
    ].join('\n'),
    '## Ce qui ne change jamais',
    [
      '- Chaque action passe par les mêmes garde-fous qu\'avec une IA. Une action grave s\'apprend aussi, mais elle attend ton accord à chaque fois, avec ou sans IA.',
      '- Je n\'apprends que de TES demandes : jamais d\'un mail, d\'une page web, d\'un document ni d\'une tâche planifiée.',
      '- Rien n\'est appris d\'une phrase qui dépend du moment (« demain », « ça », « la première »), ni d\'un secret.',
      '- Un rapprochement n\'est proposé que si chaque mot de ta phrase est expliqué. Je ne devine pas.',
      '- Une mission qui échoue deux fois est oubliée. « Non, pas ça » juste après l\'oublie aussi.',
    ].join('\n'),
    `## Ce que je sais faire${all.length ? ` (${all.length} mission${all.length > 1 ? 's' : ''})` : ''}`,
    ...(all.length
      ? groups.flatMap((g) => [`### ${g}`, all.filter((m) => groupOf(m, app) === g).sort((x, y) => titleOf(x).localeCompare(titleOf(y), 'fr')).map((m) => `- ${linkTo(m, c)} — ${plain(m.main.label)}${m.all.length > 1 ? ` · ${m.all.length} façons de le dire` : ''}`).join('\n')])
      : ['Rien encore. Ça vient tout seul : quand une IA règle une de tes demandes par une action (ou quelques-unes à la suite), je la retiens ici.']),
    ...(links.length ? ['## Mots que j\'ai reliés', links.slice(0, 60).map((l) => `- « ${plain(l.said[0])} » = « ${plain(l.said[1])} »${l.n > 1 ? ` (vu ${l.n} fois)` : ''}`).join('\n')] : []),
    ...(see.length ? [`Voir aussi ${see.map((s) => `[[${s}]]`).join(' et ')}.`] : []),
  ].join('\n\n');
  return { meta: { type: 'fiche', tags: ['odin', 'quotidien'], 'tenue par': 'Odin' }, body };
}

// ---------------- Écriture dans le coffre ----------------

type NoteMap = Record<string, { path: string; sum: string; title?: string }>;
const readMap = (kv: Kv): NoteMap => { try { const m = JSON.parse(kv.getKv(MAP) || '{}') as NoteMap; return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; } catch { return {}; } };
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

/** Écrit une note tenue par Odin, en gardant ta partie « Mes notes ». Une note à toi du même nom n'est jamais écrasée. */
function put(d: DailyDeps, path: string, meta: NoteMeta, body: string): 'écrite' | 'pareille' | 'à toi' {
  const full = d.vault.abs(path);
  let mine = '', created: string | undefined, before: string | undefined;
  if (existsSync(full)) {
    before = readFileSync(full, 'utf8');
    const old = parseNote(before);
    if (old.meta['tenue par'] !== 'Odin') return 'à toi';
    const cut = old.body.indexOf(MINE);
    if (cut >= 0) mine = old.body.slice(cut + MINE.length).trim();
    if (typeof old.meta['créé'] === 'string') created = old.meta['créé'];
  }
  const whole: NoteMeta = { ...meta, créé: created ?? isoDay(new Date(d.now ?? Date.now())) };
  const text = `${body.trim()}\n\n${MINE}\n\n${mine && mine !== MINE_HINT ? mine : MINE_HINT}\n`;
  if (before !== undefined && formatNote(whole, text) === before) return 'pareille';
  d.vault.write(path, whole, text, { quiet: true });
  return 'écrite';
}

/**
 * Met les notes du Quotidien à l'image de ce qu'Odin sait : une note par mission, la note « Cerveau direct »,
 * et la corbeille (restaurable) pour les missions oubliées. Ne réécrit que ce qui a changé.
 * `full` (au démarrage) : relit tout le coffre, pour suivre une note que tu aurais renommée ou déplacée.
 */
export function syncQuotidien(d: DailyDeps, o: { full?: boolean } = {}): { written: number; removed: number; total: number } {
  const all = missions(loadAcquis(d.kv)), links = loadLinks(d.kv), map = readMap(d.kv);
  let written = 0, removed = 0, see: string[] = [];
  if (o.full) {
    const notes = d.vault.all(true);
    for (const n of notes) if (n.meta['tenue par'] === 'Odin' && n.meta.type === 'quotidien' && typeof n.meta.mission === 'string') map[n.meta.mission] = { ...map[n.meta.mission], path: n.path.replace(/\.md$/, ''), sum: '' };
    see = ['Comment fonctionne Odin', 'Les applis d\'Odin'].filter((t) => notes.some((n) => n.title === t));
    d.kv.setKv(`${MAP}:voir`, JSON.stringify(see));
  } else { try { see = JSON.parse(d.kv.getKv(`${MAP}:voir`) || '[]') as string[]; } catch { see = []; } }

  // 1. Où va chaque note : celle qu'elle a déjà, sinon un nom libre dans « Quotidien ».
  const low = (p: string) => p.toLowerCase(), taken = new Set(Object.entries(map).filter(([k]) => k !== 'hub').map(([, x]) => low(x.path)));
  for (const m of all) {
    const cur = map[m.key], base = safeName(titleOf(m));
    const free = () => { let name = base, k = 2; while (low(`${DIR}/${name}`) === low(HUB) || taken.has(low(`${DIR}/${name}`)) || existsSync(d.vault.abs(`${DIR}/${name}`))) name = `${base} (${k++})`; return `${DIR}/${name}`; };
    if (cur && existsSync(d.vault.abs(cur.path))) {
      // La phrase qui donnait son nom à la mission a été oubliée, une autre reste : la note prend son nom (sauf si tu l'as renommée toi-même).
      if (cur.title && cur.title !== base && basename(cur.path) === cur.title) {
        const to = free();
        try { d.vault.rename(cur.path, to); taken.delete(low(cur.path)); map[m.key] = { path: to, sum: '', title: base }; taken.add(low(to)); } catch { /* elle garde son nom */ }
      } else if (!cur.title) cur.title = basename(cur.path) === base ? base : cur.title;
      continue;
    }
    const path = free();
    map[m.key] = { path, sum: '', title: base }; taken.add(low(path));
  }
  const paths = new Map(all.map((m) => [m.key, map[m.key].path]));
  const red = (s: string) => (d.redact ? d.redact(s) : s);

  // 2. Une note par mission.
  for (const m of all) {
    const n = missionNote(m, { all, links, paths, app: d.app }), body = red(n.body), sum = hash(JSON.stringify(n.meta) + body);
    if (!o.full && map[m.key].sum === sum) continue;
    const r = put(d, map[m.key].path, n.meta, body);
    if (r === 'écrite') written++;
    map[m.key].sum = r === 'à toi' ? '' : sum;
  }
  // 3. Mission oubliée : sa note part à la corbeille (restaurable), sans réveiller les automatisations.
  for (const key of Object.keys(map)) {
    if (key === 'hub' || paths.has(key)) continue;
    try { const full = d.vault.abs(map[key].path); if (existsSync(full) && parseNote(readFileSync(full, 'utf8')).meta['tenue par'] === 'Odin') { d.vault.trash(map[key].path, { quiet: true }); removed++; } } catch { /* déjà partie */ }
    delete map[key];
  }
  // 4. La note d'ensemble.
  const h = hubNote(all, links, paths, d.app, see), hb = red(h.body), hs = hash(JSON.stringify(h.meta) + hb);
  if (o.full || map.hub?.sum !== hs || !existsSync(d.vault.abs(HUB))) { if (put(d, HUB, h.meta, hb) === 'écrite') written++; map.hub = { path: HUB, sum: hs }; }
  d.kv.setKv(MAP, JSON.stringify(map));
  return { written, removed, total: all.length };
}

/**
 * Mettre une note du Quotidien à la corbeille (depuis le Cerveau), c'est demander à Odin d'oublier la mission :
 * toutes ses façons de le dire sont oubliées, et il repassera par une IA. Rend de quoi arrêter l'écoute.
 */
export function watchQuotidien(d: DailyDeps, after?: (forgotten: number) => void): () => void {
  const on = (e: { kind: string; path: string; type?: string }) => {
    if (e.kind !== 'corbeille' || e.type !== 'quotidien') return;
    try {
      const map = readMap(d.kv), p = e.path.replace(/\.md$/, ''), key = Object.keys(map).find((k) => k !== 'hub' && map[k].path === p);
      if (!key || existsSync(d.vault.abs(p))) return; // pas une note d'Odin, ou pas dans ce coffre
      let n = 0;
      for (const a of loadAcquis(d.kv)) if (missionOf(a) === key) n += forget(d.kv, a.id);
      delete map[key]; d.kv.setKv(MAP, JSON.stringify(map));
      syncQuotidien(d);
      after?.(n);
    } catch { /* le Cerveau reste utilisable */ }
  };
  vaultEvents.on('change', on);
  return () => { vaultEvents.off('change', on); };
}

/** Au démarrage : les notes sont remises à jour, et la corbeille est écoutée. */
export function startQuotidien(d: DailyDeps, log: (line: string) => void = () => {}): () => void {
  try { const r = syncQuotidien(d, { full: true }); if (r.written || r.removed) log(`[cerveau] quotidien : ${r.written} note(s) mise(s) à jour, ${r.removed} retirée(s), ${r.total} mission(s)`); } catch (e) { log(`[cerveau] quotidien : ${(e as Error).message}`); }
  return watchQuotidien(d);
}
