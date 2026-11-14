// Tirésias — l'historique de chaque disque et les alertes quand ça se dégrade. À chaque lecture, un relevé : au
// plus un par jour et par disque, plus un dès que quelque chose change (un secteur réalloué de plus, l'état qui
// bascule…). Les relevés sont de petits fichiers JSON, gardés des années. Les alertes naissent d'une comparaison
// entre le relevé d'avant et celui de maintenant : ce qui monte compte plus que ce qui est.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AlertIn } from '../types.ts';
import { appeler, avertissements, cleDisque, type Disque, type Etat, type Genre, type Tendance } from './smart.ts';

/** Un relevé : l'état d'un disque à un moment (noms courts : il y en a des centaines par disque). */
export interface Releve {
  /** quand (ISO) et quel jour (AAAA-MM-JJ, à l'heure de la machine d'Odin) */
  t: string; j: string;
  e: Etat;
  /** température à la lecture, et la plus haute du jour */
  temp?: number; tmax?: number;
  /** heures de marche, allumages */
  h?: number; a?: number;
  /** secteurs réalloués, en attente, illisibles ; erreurs de câble */
  r?: number; p?: number; i?: number; c?: number;
  /** usure (%), octets écrits */
  u?: number; w?: number;
  /** ce que le disque dit de lui-même (vrai : tout va bien) */
  s?: boolean;
  /** NVMe : avertissement critique, erreurs de données, réserve (%) */
  cw?: number; me?: number; res?: number;
  /** relevé pris parce que quelque chose a changé depuis le précédent */
  ch?: true;
}
/** La fiche de suivi d'un disque : qui il est, ses relevés, et de quoi on a déjà prévenu. */
export interface Suivi {
  cle: string; nom: string; modele?: string; serie?: string; taille?: number; genre: Genre; usb?: boolean;
  /** dernière fois qu'il a répondu (ISO) */
  vu: string;
  releves: Releve[];
  /** dernière alerte envoyée par sujet (ISO) : pour rappeler sans rabâcher */
  rappels?: Record<string, string>;
  /** sa fiche a été proposée à l'inventaire (on ne la recrée pas si tu l'as supprimée) */
  inventorie?: boolean;
  /** signalé comme disparu (ISO) */
  disparu?: string;
}
const MAX_RELEVES = 1500;
const p2 = (n: number) => String(n).padStart(2, '0');
/** Le jour, à l'heure de la machine d'Odin : « 2026-11-13 ». Pur. */
export const jourDe = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** « 2026-11-03 » → « 3 novembre » (avec l'année si ce n'est pas celle en cours). Pur. */
export function jourDit(j: string, now?: Date): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(j); if (!m) return j;
  return `${Number(m[3]) === 1 ? '1er' : Number(m[3])} ${MOIS[Number(m[2]) - 1] ?? ''}${now && Number(m[1]) !== now.getFullYear() ? ` ${m[1]}` : ''}`;
}

/** Le relevé d'un disque à cet instant. Pur. */
export function releveDe(d: Disque, now: Date): Releve {
  const r: Releve = { t: now.toISOString(), j: jourDe(now), e: d.etat };
  const met = <K extends keyof Releve>(k: K, v: Releve[K] | undefined) => { if (v !== undefined) r[k] = v; };
  met('temp', d.temperature); met('tmax', d.temperature); met('h', d.heures); met('a', d.allumages);
  met('r', d.realloues); met('p', d.attente); met('i', d.illisibles); met('c', d.crc);
  met('u', d.usure); met('w', d.ecrit); met('s', d.passe); met('cw', d.critique); met('me', d.erreursMedia); met('res', d.reserve);
  return r;
}
/** Le palier d'usure : 0 (moins de 80 %), 80, 90 ou 100. Pur. */
export const palier = (u: number | undefined) => (u === undefined ? 0 : u >= 100 ? 100 : u >= 90 ? 90 : u >= 80 ? 80 : 0);
/** Quelque chose d'important a-t-il changé entre deux relevés ? (la température et les heures bougent tout le temps : elles ne comptent pas). Pur. */
export function aChange(a: Releve, b: Releve): boolean {
  return a.e !== b.e || a.r !== b.r || a.p !== b.p || a.i !== b.i || a.c !== b.c || a.s !== b.s || a.cw !== b.cw || a.me !== b.me || palier(a.u) !== palier(b.u) || (a.res !== undefined && b.res !== undefined && Math.abs(a.res - b.res) >= 5);
}
/**
 * Range la lecture d'un disque dans son suivi. Premier relevé du jour : il est ajouté. Même jour sans changement :
 * le relevé du jour est mis à jour (dernières valeurs, température la plus haute). Quelque chose a changé : un relevé
 * de plus. Rend le suivi, et le relevé d'avant (pour comparer). Pur.
 */
export function noter(ancien: Suivi | undefined, d: Disque, now: Date): { suivi: Suivi; avant?: Releve } {
  const r = releveDe(d, now), releves = [...(ancien?.releves ?? [])], avant = releves.at(-1);
  const plusChaud = (a?: number, b?: number) => (a === undefined ? b : b === undefined ? a : Math.max(a, b));
  if (!avant || avant.j !== r.j) releves.push(r);
  else {
    const tmax = plusChaud(r.tmax, avant.tmax), chaud = tmax !== undefined ? { tmax } : {};
    if (aChange(avant, r)) releves.push({ ...r, ...chaud, ch: true });
    else releves[releves.length - 1] = { ...avant, ...r, ...chaud, t: avant.t };
  }
  const suivi: Suivi = { ...(ancien ?? {}), cle: cleDisque(d), nom: d.nom, genre: d.genre, vu: now.toISOString(), releves: releves.slice(-MAX_RELEVES), ...(d.modele ? { modele: d.modele } : {}), ...(d.serie ? { serie: d.serie } : {}), ...(d.taille ? { taille: d.taille } : {}), ...(d.usb ? { usb: true } : {}) };
  delete suivi.disparu;
  return { suivi, ...(avant ? { avant } : {}) };
}
/**
 * Ce qui a monté sur les `jours` derniers jours : on compare au dernier relevé d'avant cette période (ou au tout
 * premier s'il est plus récent). Rien si rien n'a monté. Pur.
 */
export function tendanceDe(releves: Releve[], maintenant: Pick<Releve, 'r' | 'p' | 'i' | 'c' | 'me'>, now: Date, jours = 30): Tendance | undefined {
  if (!releves.length) return undefined;
  const limite = now.getTime() - jours * 86_400_000, ref = [...releves].reverse().find((x) => Date.parse(x.t) <= limite) ?? releves[0];
  const delta = (a: number | undefined, b: number | undefined) => (a !== undefined && b !== undefined && a > b ? a - b : undefined);
  const t: Tendance = { depuis: jourDit(ref.j, now) };
  const r = delta(maintenant.r, ref.r), p = delta(maintenant.p, ref.p), i = delta(maintenant.i, ref.i), c = delta(maintenant.c, ref.c), me = delta(maintenant.me, ref.me);
  if (r) t.realloues = r; if (p) t.attente = p; if (i) t.illisibles = i; if (c) t.crc = c; if (me) t.erreursMedia = me;
  return r || p || i || c || me ? t : undefined;
}

/** Ce que le module ajoute à chaque alerte : où est le disque, quoi faire (sauvegarder d'abord, puis remplacer), le bouton. */
export interface Conseil { ou?: string; etapes: string[]; fix?: AlertIn['fix']; poste?: string }
const RAPPEL = 7 * 86_400_000;
/**
 * Les alertes à lever pour cette lecture, d'après le relevé d'avant. On prévient quand ça se dégrade : l'état qui
 * passe à Mauvais (ou à Attention), un compteur qui monte, l'usure qui franchit 80 % puis 90 %, un avertissement
 * critique, une température trop haute ; et on rappelle une fois par semaine un disque resté Mauvais. Pur.
 */
export function alertesDe(d: Disque, avant: Releve | undefined, suivi: Pick<Suivi, 'cle' | 'rappels'>, now: Date, c: Conseil): { alertes: AlertIn[]; rappels: Record<string, string> } {
  const out: AlertIn[] = [], rappels = { ...(suivi.rappels ?? {}) }, cle = suivi.cle, qui = `${appeler(d)}${c.ou ? ` sur ${c.ou}` : ''}`;
  if (d.enVeille || d.smart !== 'oui') return { alertes: out, rappels };
  const data = { disque: d.nom, cle, ...(c.poste ? { poste: c.poste } : {}) };
  const raisons = d.raisons.map((x) => x.texte).join(' '), suite = 'Sauvegarde d\'abord ce qui compte, remplace le disque ensuite.';
  const lever = (a: Omit<AlertIn, 'data' | 'steps'> & { etapes?: string[] }) => { const { etapes, ...reste } = a; out.push({ ...reste, steps: etapes ?? c.etapes, ...(c.fix && !etapes ? { fix: c.fix } : {}), data }); };
  const vieux = (sujet: string) => now.getTime() - (Date.parse(rappels[sujet] ?? '') || 0) >= RAPPEL;

  // 1. L'état bascule à Mauvais : une seule alerte, avec toutes les raisons (elle remplace les alertes de détail).
  if (d.etat === 'mauvais' && avant?.e !== 'mauvais') { rappels.mauvais = now.toISOString(); lever({ level: 'critique', title: `Disque ${qui} : état Mauvais`, detail: `${raisons} ${suite}`, key: `mauvais:${cle}` }); }
  else {
    // 2. Un disque resté Mauvais : rappel une fois par semaine (on oublie vite, lui continue de s'abîmer).
    if (d.etat === 'mauvais' && vieux('mauvais')) { rappels.mauvais = now.toISOString(); lever({ level: 'critique', title: `Disque ${qui} : toujours en état Mauvais`, detail: `${raisons} Il n'a pas été remplacé. ${suite}`, key: `mauvais:${cle}:${jourDe(now)}` }); }
    // 3. Les compteurs qui montent : le disque continue de s'abîmer.
    const monte = (k: 'r' | 'p' | 'i' | 'me', val: number | undefined, un: string, plusieurs: string, quoi: string) => {
      const old = avant?.[k]; if (val === undefined || old === undefined || val <= old) return;
      const n = val - old; lever({ level: d.etat === 'mauvais' ? 'critique' : 'haute', title: `Disque ${qui} : ${n.toLocaleString('fr-FR')} ${n > 1 ? plusieurs : un} de plus`, detail: `Il en compte ${val.toLocaleString('fr-FR')} (${old.toLocaleString('fr-FR')} le ${jourDit(avant!.j, now)}). ${quoi} ${suite}`, key: `${k}:${cle}:${val}` });
    };
    monte('r', d.realloues, 'secteur réalloué', 'secteurs réalloués', 'Le disque remplace des zones abîmées : son usure avance.');
    monte('p', d.attente, 'secteur en attente', 'secteurs en attente', 'Ce sont des zones qu\'il n\'arrive plus à lire : des fichiers peuvent déjà être abîmés.');
    monte('i', d.illisibles, 'secteur illisible', 'secteurs illisibles', 'Des zones ne se lisent plus du tout.');
    monte('me', d.erreursMedia, 'erreur de données', 'erreurs de données', 'Le disque n\'a pas su relire certaines données.');
    // 4. Un avertissement critique nouveau (NVMe).
    const nouveaux = (d.critique ?? 0) & ~(avant?.cw ?? 0);
    if (nouveaux && d.etat !== 'mauvais') lever({ level: nouveaux & ~34 ? 'critique' : 'haute', title: `Disque ${qui} : avertissement critique`, detail: `${avertissements(nouveaux).map((x) => `${x[0].toUpperCase()}${x.slice(1)}.`).join(' ')} ${suite}`, key: `critique:${cle}:${d.critique}` });
    // 5. L'usure franchit 80 %, puis 90 % (100 % fait basculer l'état : déjà annoncé plus haut).
    const pa = palier(d.usure);
    if (pa > palier(avant?.u) && pa < 100) lever({ level: pa >= 90 ? 'haute' : 'moyenne', title: `Disque ${qui} : usure à ${d.usure} %`, detail: pa >= 90 ? 'Il arrive au bout de la durée de vie prévue par le fabricant. Commande son remplaçant maintenant, et garde une sauvegarde à jour.' : 'Il a consommé l\'essentiel de la durée de vie prévue par le fabricant. Prévois son remplacement dans les mois qui viennent, et garde une sauvegarde à jour.', key: `usure:${cle}:${pa}`, etapes: ['Vérifie que ta sauvegarde est à jour (Phénix).', pa >= 90 ? 'Commande un disque de remplacement.' : 'Prévois l\'achat d\'un disque de remplacement.', 'Le jour du changement : copie le disque sur le nouveau, puis retire l\'ancien.'] });
    // 6. Le reste : l'état passe à Attention sans qu'une alerte plus précise l'ait dit (premier relevé d'un disque déjà marqué, erreurs récentes…).
    if (d.etat === 'attention' && avant?.e !== 'attention' && avant?.e !== 'mauvais' && !out.length && d.raisons.some((x) => x.cle !== 'temp' && x.cle !== 'critique:temp')) lever({ level: 'moyenne', title: `Disque ${qui} : à surveiller`, detail: `${d.raisons.filter((x) => x.cle !== 'temp').map((x) => x.texte).join(' ')} Garde une sauvegarde à jour et regarde si ça évolue.`, key: `attention:${cle}`, etapes: ['Vérifie que ta sauvegarde est à jour (Phénix).', 'Regarde l\'onglet « Historique » de Tirésias dans quelques jours : si les nombres montent, remplace le disque.'] });
    // 7. Le câble : les erreurs de transmission qui montent ne viennent presque jamais du disque.
    if (d.crc !== undefined && avant?.c !== undefined && d.crc > avant.c) lever({ level: 'moyenne', title: `Disque ${qui} : erreurs de câble en hausse`, detail: `${(d.crc - avant.c).toLocaleString('fr-FR')} erreur(s) de transmission de plus (${d.crc.toLocaleString('fr-FR')} en tout). C'est le plus souvent le câble ou la prise, pas le disque.`, key: `cable:${cle}:${d.crc}`, etapes: ['Éteins la machine, rebranche le câble du disque des deux côtés.', 'Si le nombre monte encore, change le câble SATA (ou le boîtier USB).'] });
  }
  // 8. Trop chaud : une alerte par jour au plus, tant que ça dure.
  if (d.temperature !== undefined && d.limites && d.temperature >= d.limites.alerte) lever({ level: 'haute', title: `Disque ${qui} trop chaud : ${d.temperature} °C`, detail: `La limite pour ${d.genre === 'disque dur' ? 'un disque dur' : d.genre === 'inconnu' ? 'ce disque' : `un ${d.genre}`} est de ${d.limites.alerte} °C. La chaleur use un disque bien plus vite.`, key: `chaud:${cle}:${jourDe(now)}`, etapes: ['Vérifie que l\'air circule : ventilateurs qui tournent, grilles dépoussiérées, pièce pas trop chaude.', 'Éloigne le disque des autres sources de chaleur, ajoute un ventilateur si besoin.', 'Allège ce qui le fait travailler sans arrêt (gros transferts, analyses).'] });
  return { alertes: out, rappels };
}

// ---------------- Les courbes ----------------
/**
 * Les valeurs d'une mesure dans le temps, pour plusieurs disques, sur les mêmes jours : une étiquette par jour où au
 * moins un disque a un relevé (les `max` derniers), et pour chaque disque sa dernière valeur connue ce jour-là. Pur.
 */
export function courbe(suivis: Suivi[], champ: 'temp' | 'tmax' | 'u' | 'r' | 'p' | 'i' | 'w', max = 60): { labels: string[]; series: Array<{ name: string; points: number[] }> } {
  const avec = suivis.filter((s) => s.releves.some((r) => r[champ] !== undefined));
  const jours = [...new Set(avec.flatMap((s) => s.releves.filter((r) => r[champ] !== undefined).map((r) => r.j)))].sort().slice(-max);
  const series = avec.map((s) => {
    const parJour = new Map<string, number>(); for (const r of s.releves) { const v = r[champ]; if (v !== undefined) parJour.set(r.j, champ === 'tmax' ? Math.max(v, parJour.get(r.j) ?? -273) : v); }
    const connus = [...parJour.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const points = jours.map((j) => { let v = connus[0][1]; for (const [jj, x] of connus) { if (jj <= j) v = x; else break; } return v; });
    return { name: s.nom + (s.modele ? ` · ${s.modele}` : ''), points };
  });
  return { labels: jours.map((j) => `${j.slice(8)}/${j.slice(5, 7)}`), series };
}

// ---------------- Les fichiers ----------------
/** Le dossier d'un poste dans les données de l'appli (« ici » : la machine d'Odin). */
export const dossierPoste = (dir: string, poste: string) => join(dir, 'postes', poste.replace(/[^A-Za-z0-9_-]/g, '') || 'ici');
const fichier = (dir: string, poste: string, cle: string) => join(dossierPoste(dir, poste), 'disques', `${cle.replace(/[^A-Za-z0-9_-]/g, '')}.json`);
function ecrire(f: string, x: unknown): void { mkdirSync(join(f, '..'), { recursive: true }); const tmp = `${f}.tmp`; writeFileSync(tmp, JSON.stringify(x)); renameSync(tmp, f); }
export function lireSuivi(dir: string, poste: string, cle: string): Suivi | undefined {
  try { const s = JSON.parse(readFileSync(fichier(dir, poste, cle), 'utf8')) as Suivi; return s && Array.isArray(s.releves) ? s : undefined; } catch { return undefined; }
}
export function ecrireSuivi(dir: string, poste: string, s: Suivi): void { ecrire(fichier(dir, poste, s.cle), s); }
export function oublierSuivi(dir: string, poste: string, cle: string): boolean { const f = fichier(dir, poste, cle); if (!existsSync(f)) return false; rmSync(f, { force: true }); return true; }
/** Tous les disques suivis d'un poste, les derniers vus d'abord. */
export function listerSuivis(dir: string, poste: string): Suivi[] {
  const d = join(dossierPoste(dir, poste), 'disques'); let noms: string[] = []; try { noms = readdirSync(d).filter((f) => f.endsWith('.json')); } catch { return []; }
  return noms.map((f) => lireSuivi(dir, poste, f.slice(0, -5))).filter((s): s is Suivi => Boolean(s)).sort((a, b) => b.vu.localeCompare(a.vu));
}
/** La dernière lecture complète d'un poste (pour montrer la page tout de suite, même après un redémarrage ou poste éteint). */
export function lireDernier<T>(dir: string, poste: string): T | undefined { try { return JSON.parse(readFileSync(join(dossierPoste(dir, poste), 'dernier.json'), 'utf8')) as T; } catch { return undefined; } }
export function ecrireDernier(dir: string, poste: string, x: unknown): void { ecrire(join(dossierPoste(dir, poste), 'dernier.json'), x); }
