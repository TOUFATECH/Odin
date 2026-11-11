// Arbre d'évolution d'Odin : chaque mise à jour, avec sa date, rangée par planète (une appli ou une partie
// d'Odin) autour du soleil (Odin lui-même). Lu dans l'historique git de l'installation (les mises à jour
// d'Odin passent par git), donc toujours à jour sans rien écrire à la main ; sans dépôt git (copie
// d'archive), on se rabat sur evolutions.json, livré avec le code et régénéré à chaque version
// (npm run evolutions).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface Evolution {
  /** empreinte courte du changement */
  id: string;
  /** date ISO (AAAA-MM-JJ) */
  date: string;
  /** heure ISO complète */
  at: string;
  /** numéro de version (« 1.6.1 ») quand le changement en publie une */
  version?: string;
  title: string;
  /** détails (puces du message) */
  details: string[];
  /** planètes concernées (identifiants de PLANETS) */
  planets: string[];
  /** nouveauté (feat), amélioration ou correction */
  kind: 'nouveauté' | 'amélioration' | 'correction';
}
export interface Planet { id: string; name: string; what: string; words: RegExp }

/** Les planètes : les applis d'Odin et ses grandes parties. Un changement peut en toucher plusieurs. */
export const PLANETS: Planet[] = [
  { id: 'discussion', name: 'Discussion', what: 'Parler à Odin, par écrit ou à la voix', words: /discussion|conversation|chat\b|messages?\b|réponse/i },
  { id: 'voix', name: 'Voix', what: 'Écoute, voix d\'Odin, mains libres', words: /\bvoix\b|vocal|audio|micro|mains libres|tts|stt|parle/i },
  { id: 'guide', name: 'Guide', what: 'Mascotte, visite guidée, aide sur chaque page', words: /guide|visite|présentation|mascotte|infobulle|bulle/i },
  { id: 'interface', name: 'Interface', what: 'Pages, thèmes, téléphone', words: /interface|thème|écran|page|téléphone|mobile|menu|navigation/i },
  { id: 'cerveau', name: 'Cerveau', what: 'Notes reliées, graphe, connecteurs', words: /cerveau|notes?\b|graphe|connecteur|notion/i },
  { id: 'canaux', name: 'Canaux', what: 'Telegram, WhatsApp, Signal, Discord, Slack, mail', words: /telegram|whatsapp|signal\b|discord|slack|canaux|canal/i },
  { id: 'maison', name: 'Maison', what: 'Réseau, appareils, box, domotique', words: /réseau|appareil|maison|box\b|domotique|home assistant|wled|hue|mac\b|hlidskjalf/i },
  { id: 'machines', name: 'Machines', what: 'Serveurs, Proxmox, droits, mises à jour', words: /machine|proxmox|serveur|ssh|droits|sudo|administrateur|windows|linux|docker|conteneur/i },
  { id: 'securite', name: 'Sécurité', what: 'Heimdall, coffre, antivirus, compte', words: /sécurité|heimdall|coffre|mot de passe|antivirus|ullr|compte|connexion|jeton|chiffr|garmr/i },
  { id: 'applis', name: 'Applis (Valhalla)', what: 'Les applis reliées entre elles', words: /appli|valhalla|idunn|sindri|brokkr|garmr|loki|frigg|bragi|hermod|kvasir|ymir|aegir|eir|forseti|geri|gjoll|himinbjorg|midgard|naglfar|ratatoskr|skogul|brisingamen|venus/i },
  { id: 'automatisations', name: 'Automatisations', what: 'Draupnir, Runes, tâches planifiées', words: /automatisation|draupnir|runes?\b|tâche|planifi|rappel|cron|webhook/i },
  { id: 'memoire', name: 'Mémoire et compétences', what: 'Ce qu\'Odin retient et apprend', words: /mémoire|souvenir|compétence|apprend|muninn|mimir/i },
  { id: 'ia', name: 'Modèles d\'IA', what: 'Fournisseurs, routage, sans IA', words: /openai|anthropic|claude|codex|ollama|openrouter|routage|deepseek|moonshot|fournisseur|modèle d'ia|modèle local|\bllm\b|sans ia/i },
  { id: 'installation', name: 'Installation', what: 'Installer, mettre à jour, sauvegarder', words: /install|mise à jour|mises à jour|sauvegarde|restaur|version|docker|tests?\b/i },
];

const VERSION = /^v?(\d+\.\d+(?:\.\d+)?)\s*[:—-]\s*/i;
const ODIN_VERSION = /^Odin\s+(\d+\.\d+(?:\.\d+)?)\s*[:—-]\s*/i;

function kindOf(title: string, body: string, version?: string): Evolution['kind'] {
  const t = `${title} ${body}`.toLowerCase();
  if (version && !/^(corrige|correction)/.test(t)) return 'nouveauté';
  if (/^(corrige|correction|réparé|fix)|\bcorrig|\bbogue|\bbug\b|ne plante plus|qui plantait/.test(t)) return 'correction';
  if (/^v?\d+\.\d+|nouveau|nouvelle|ajout|arrive|première version|\bnouveaut/.test(t)) return 'nouveauté';
  return 'amélioration';
}
function planetsOf(text: string): string[] {
  const out = PLANETS.filter((p) => p.words.test(text)).map((p) => p.id);
  return out.length ? out.slice(0, 5) : ['interface'];
}

/** Un message de changement → une évolution (les lignes d'attribution sont retirées). */
export function parseCommit(id: string, at: string, subject: string, body: string): Evolution {
  let title = subject.trim(), version: string | undefined;
  const v = VERSION.exec(title) ?? ODIN_VERSION.exec(title);
  if (v) { version = v[1]; title = title.slice(v[0].length).trim(); }
  const details = body.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(co-authored-by|claude-session|signed-off-by|https?:\/\/)/i.test(l))
    .reduce<string[]>((acc, l) => { if (/^[-•*]\s+/.test(l)) acc.push(l.replace(/^[-•*]\s+/, '')); else if (acc.length) acc[acc.length - 1] += ` ${l}`; else acc.push(l); return acc; }, [])
    .slice(0, 30);
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return { id, at, date: at.slice(0, 10), version, title, details, planets: planetsOf(`${subject}\n${details.join('\n')}`), kind: kindOf(title, body, version) };
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundled = join(dirname(fileURLToPath(import.meta.url)), 'evolutions.json');

/** Historique git de l'installation (le plus récent d'abord) ; undefined sans git ou sans dépôt. */
export function fromGit(dir = root, max = 1000): Evolution[] | undefined {
  if (!existsSync(join(dir, '.git'))) return undefined;
  const r = spawnSync('git', ['-C', dir, 'log', `-n${max}`, '--date=iso-strict', '--format=%h%x1f%ad%x1f%s%x1f%b%x1e'], { encoding: 'utf8', timeout: 8000, maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) return undefined;
  return r.stdout.split('\x1e').map((x) => x.replace(/^\n/, '')).filter(Boolean).map((rec) => {
    const [id = '', at = '', subject = '', body = ''] = rec.split('\x1f');
    return parseCommit(id, at, subject, body);
  }).filter((e) => e.id && e.title);
}

let cache: { at: number; list: Evolution[] } | undefined;
/** Toutes les évolutions (git d'abord, sinon la liste livrée), gardées 5 minutes. */
export function evolutions(): Evolution[] {
  if (cache && Date.now() - cache.at < 300_000) return cache.list;
  let list = fromGit();
  if (!list?.length) { try { list = JSON.parse(readFileSync(bundled, 'utf8')) as Evolution[]; } catch { list = []; } }
  cache = { at: Date.now(), list };
  return list;
}

/** Ce que l'interface reçoit : le soleil (version courante), les planètes et leurs évolutions. */
export function evolutionTree(current: string): unknown {
  const list = evolutions();
  const planets = PLANETS.map((p) => {
    const items = list.filter((e) => e.planets.includes(p.id));
    return { id: p.id, name: p.name, what: p.what, count: items.length, last: items[0]?.date ?? null, items: items.map((e) => e.id) };
  }).filter((p) => p.count);
  const versions = list.filter((e) => e.version).map((e) => ({ version: e.version, date: e.date, title: e.title, id: e.id }));
  return { ok: true, sun: { name: 'Odin', version: current, since: list.at(-1)?.date ?? null, total: list.length }, planets, versions, evolutions: list };
}

/** Régénère evolutions.json (livré avec le code, pour les installations sans git). */
export function writeBundled(): number {
  const list = fromGit();
  if (!list) throw new Error('pas de dépôt git ici');
  writeFileSync(bundled, `${JSON.stringify(list, null, 1)}\n`);
  return list.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log(`${writeBundled()} évolutions écrites dans ${bundled}`);
