// La télémétrie que le compagnon d'un poste envoie à Odin (pour Argos, l'EDR) : les processus en cours et leur
// filiation, les connexions sortantes, et les points de persistance (ce qui se relance au démarrage). Plus la
// détection d'une rafale de rançongiciel sur le poste (beaucoup de fichiers réécrits en peu de temps).
//
// Le compagnon (compagnon.py) collecte ces données avec les outils du système (Windows, Linux, macOS) ou avec
// osquery s'il est présent, puis les envoie en JSON à POST /api/compagnon/telemetrie. Ce fichier tient :
//   - le modèle (ce qu'est une télémétrie) ;
//   - la normalisation de ce que le poste envoie (tout vient du poste : c'est une donnée, jamais un ordre ; textes
//     coupés, tailles bornées, aucune exécution) ;
//   - l'arbre de filiation des processus (qui a lancé quoi) ;
//   - la détection d'une rafale de rançongiciel ;
//   - le repérage d'un point de persistance suspect.
// Tout est pur (aucun accès disque ni réseau) : Argos l'appelle à la réception, les essais le vérifient sans poste.

export type SystemePoste = 'windows' | 'linux' | 'macos';
/** Un processus vu sur le poste. `ppid` : le processus qui l'a lancé (0 ou lui-même pour la racine). */
export interface Processus { pid: number; ppid: number; nom: string; chemin?: string; utilisateur?: string; ligne?: string; depuis?: string }
/** Une connexion sortante du poste vers Internet (jamais une adresse de la maison, filtrée par le compagnon). */
export interface ConnexionSortante { pid?: number; prog?: string; proto: string; rip: string; rport: number }
/** Un genre de persistance : ce qui fait qu'un programme se relance tout seul. */
export type GenrePersistance = 'run' | 'tache' | 'service' | 'demarrage' | 'cron' | 'systemd' | 'launchagent' | 'launchdaemon';
/** Un point de persistance : d'où il se lance (`emplacement`), son nom, et ce qu'il lance (`cible`). */
export interface Persistance { genre: GenrePersistance; nom: string; cible: string; emplacement?: string; utilisateur?: string }
/** Un événement sur un fichier vu par le compagnon (renommé ou réécrit) : sert à repérer une rafale de rançongiciel. */
export interface EvtFichier { chemin: string; action: 'renommé' | 'réécrit' | 'créé'; t: number }
/** La télémétrie d'un poste à un instant. */
export interface Telemetrie {
  poste: string; sys: SystemePoste; t: number;
  processus: Processus[]; connexions: ConnexionSortante[]; persistance: Persistance[];
  /** true si osquery a servi à collecter (plus fiable) plutôt que les outils de base. */ osquery?: boolean;
  /** une rafale de réécritures repérée sur le poste (rançongiciel probable). */ rafale?: Rafale;
}
export interface Rafale { nombre: number; secondes: number; dossier: string }

const BORNES = { processus: 4000, connexions: 2000, persistance: 2000 } as const;
const s = (v: unknown, n = 200) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const entier = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 2 ** 31 ? Math.trunc(n) : 0; };
const GENRES = new Set<GenrePersistance>(['run', 'tache', 'service', 'demarrage', 'cron', 'systemd', 'launchagent', 'launchdaemon']);
const estSysteme = (x: unknown): x is SystemePoste => x === 'windows' || x === 'linux' || x === 'macos';

/** Normalise un processus reçu, ou rien s'il n'a pas au moins un pid et un nom. Pur. */
export function normaliserProcessus(x: unknown): Processus | undefined {
  const o = x as Record<string, unknown>; if (!o || typeof o !== 'object') return undefined;
  const pid = entier(o.pid), nom = s(o.nom, 160); if (!pid || !nom) return undefined;
  return { pid, ppid: entier(o.ppid), nom, ...(o.chemin ? { chemin: s(o.chemin, 400) } : {}), ...(o.utilisateur ? { utilisateur: s(o.utilisateur, 80) } : {}), ...(o.ligne ? { ligne: s(o.ligne, 500) } : {}), ...(o.depuis ? { depuis: s(o.depuis, 40) } : {}) };
}
/** Normalise une connexion sortante reçue, ou rien si l'adresse est illisible. Pur. */
export function normaliserConnexion(x: unknown): ConnexionSortante | undefined {
  const o = x as Record<string, unknown>; if (!o || typeof o !== 'object') return undefined;
  const rip = s(o.rip, 60); if (!/^[0-9a-f.:]{3,60}$/i.test(rip)) return undefined;
  return { proto: s(o.proto, 8) || 'tcp', rip, rport: entier(o.rport), ...(o.pid ? { pid: entier(o.pid) } : {}), ...(o.prog ? { prog: s(o.prog, 160) } : {}) };
}
/** Normalise un point de persistance reçu, ou rien si son genre est inconnu. Pur. */
export function normaliserPersistance(x: unknown): Persistance | undefined {
  const o = x as Record<string, unknown>; if (!o || typeof o !== 'object') return undefined;
  const genre = s(o.genre, 20) as GenrePersistance; if (!GENRES.has(genre)) return undefined;
  const nom = s(o.nom, 200); if (!nom) return undefined;
  return { genre, nom, cible: s(o.cible, 400), ...(o.emplacement ? { emplacement: s(o.emplacement, 300) } : {}), ...(o.utilisateur ? { utilisateur: s(o.utilisateur, 80) } : {}) };
}
/**
 * La télémétrie reçue d'un poste, bornée et nettoyée (jamais un ordre : que des données). `poste` est imposé par
 * Odin (le jeton du compagnon), pas par le corps de la requête. Pur.
 */
export function normaliserTelemetrie(poste: string, corps: Record<string, unknown>, now = Date.now()): Telemetrie {
  const sys = estSysteme(corps.sys) ? corps.sys : 'linux';
  const liste = <T>(v: unknown, f: (x: unknown) => T | undefined, max: number): T[] => (Array.isArray(v) ? v : []).slice(0, max).map(f).filter((x): x is T => Boolean(x));
  const processus = liste(corps.processus, normaliserProcessus, BORNES.processus);
  const connexions = liste(corps.connexions, normaliserConnexion, BORNES.connexions);
  const persistance = liste(corps.persistance, normaliserPersistance, BORNES.persistance);
  const r = corps.rafale as Record<string, unknown> | undefined;
  const rafale = r && typeof r === 'object' && entier(r.nombre) ? { nombre: entier(r.nombre), secondes: entier(r.secondes), dossier: s(r.dossier, 400) } : undefined;
  return { poste, sys, t: now, processus, connexions, persistance, ...(corps.osquery === true ? { osquery: true } : {}), ...(rafale ? { rafale } : {}) };
}

/** Un nœud de l'arbre des processus : un processus et ses enfants (dans l'ordre d'apparition). */
export interface NoeudProcessus { proc: Processus; enfants: NoeudProcessus[] }
/**
 * L'arbre de filiation des processus : les racines (sans parent connu dans la liste, ou parent = soi), et pour
 * chacune ses enfants. Un cycle (parent qui redescend sur un ancêtre) ne boucle pas : il est rattaché à la racine. Pur.
 */
export function arbreProcessus(procs: Processus[]): NoeudProcessus[] {
  const parPid = new Map<number, Processus>(); for (const p of procs) if (!parPid.has(p.pid)) parPid.set(p.pid, p);
  const noeud = new Map<number, NoeudProcessus>();
  for (const p of parPid.values()) noeud.set(p.pid, { proc: p, enfants: [] });
  // Vrai si `cible` est un ancêtre de `depart` (en remontant les parents). Sert à ne pas créer de boucle.
  const ancetre = (depart: number, cible: number): boolean => {
    let cur: number | undefined = depart; const vus = new Set<number>();
    while (cur !== undefined && noeud.has(cur) && !vus.has(cur)) { if (cur === cible) return true; vus.add(cur); const n: Processus = parPid.get(cur)!; cur = n.ppid !== n.pid && noeud.has(n.ppid) ? n.ppid : undefined; }
    return false;
  };
  const racines: NoeudProcessus[] = [];
  for (const n of noeud.values()) {
    const pp = n.proc.ppid;
    // Rattache à son parent seulement si le parent existe, n'est pas lui-même, et n'est pas déjà sous lui (pas de cycle).
    if (noeud.has(pp) && pp !== n.proc.pid && !ancetre(pp, n.proc.pid)) noeud.get(pp)!.enfants.push(n);
    else racines.push(n);
  }
  return racines;
}
function setGet<K, V>(m: Map<K, V>, k: K, v: V): V { m.set(k, v); return v; }
/** La filiation d'un processus : lui, puis son parent, son grand-parent… (du plus récent au plus ancien). Pur. */
export function filiation(procs: Processus[], pid: number): Processus[] {
  const parPid = new Map(procs.map((p) => [p.pid, p])); const out: Processus[] = []; const vus = new Set<number>();
  let p = parPid.get(pid);
  while (p && !vus.has(p.pid)) { out.push(p); vus.add(p.pid); p = p.ppid !== p.pid ? parPid.get(p.ppid) : undefined; }
  return out;
}

/** Dossiers d'où un programme ne devrait pas se lancer (temporaires, téléchargements, corbeille…). Pur. */
const DOSSIERS_LOUCHES = /(\\temp\\|\\tmp\\|\/tmp\/|\\appdata\\local\\temp\\|\/downloads\/|\\downloads\\|\\\$recycle\.bin\\|\/\.trash\/|\\users\\public\\|\/dev\/shm\/|\\programdata\\[^\\]+\.exe$)/i;
/** Un processus lancé depuis un endroit louche (dossier temporaire…) ? Pur. */
export function processusLouche(p: Processus): string | undefined {
  const c = (p.chemin ?? p.ligne ?? '').toLowerCase();
  if (DOSSIERS_LOUCHES.test(c)) return 'lancé depuis un dossier temporaire ou de téléchargement';
  if (/powershell.*(-enc|-encodedcommand|-w hidden|frombase64string|downloadstring|iex )/i.test(p.ligne ?? '')) return 'commande PowerShell masquée ou téléchargée';
  if (/\b(mshta|regsvr32|rundll32)\b.*(http|\\\\)/i.test(p.ligne ?? '')) return 'exécution à distance par un outil du système';
  return undefined;
}
/** Un point de persistance qui mérite un regard (cible dans un dossier louche, script encodé, tâche sans éditeur). Pur. */
export function persistanceSuspecte(p: Persistance): string | undefined {
  const c = p.cible.toLowerCase();
  if (DOSSIERS_LOUCHES.test(c)) return 'se relance depuis un dossier temporaire ou de téléchargement';
  if (/-enc|frombase64string|downloadstring|\biex\b|\bcurl\b.*\|.*\bsh\b|\bwget\b.*\|.*\bsh\b/i.test(c)) return 'script encodé ou téléchargé au démarrage';
  if (/\.(vbs|js|hta|ps1|bat|cmd)(\s|$)/i.test(c) && p.genre !== 'service') return 'script lancé automatiquement';
  return undefined;
}

/**
 * Repère une rafale de rançongiciel à partir d'événements fichiers : au moins `seuil` fichiers renommés ou réécrits
 * dans un même dossier en moins de `fenetreMs`. Rend la rafale (nombre, durée, dossier) ou rien. Pur.
 */
export function rafaleRancongiciel(evts: EvtFichier[], o: { fenetreMs?: number; seuil?: number } = {}): Rafale | undefined {
  const fenetre = o.fenetreMs ?? 60_000, seuil = o.seuil ?? 25;
  const touche = evts.filter((e) => e.action !== 'créé').sort((a, b) => a.t - b.t);
  const parDossier = new Map<string, EvtFichier[]>();
  for (const e of touche) { const d = dossier(e.chemin); (parDossier.get(d) ?? setGet(parDossier, d, [])).push(e); }
  let best: Rafale | undefined;
  for (const [d, l] of parDossier) {
    let i = 0;
    for (let j = 0; j < l.length; j++) {
      while (l[j].t - l[i].t > fenetre) i++;
      const n = j - i + 1;
      if (n >= seuil && (!best || n > best.nombre)) best = { nombre: n, secondes: Math.round((l[j].t - l[i].t) / 1000), dossier: d };
    }
  }
  return best;
}
function dossier(chemin: string): string { const c = chemin.replace(/[\\/][^\\/]*$/, ''); return c || chemin; }

// ---------------------------------------------------------------- Lecture des sorties brutes des outils du système
// Le compagnon envoie déjà du JSON ; mais quand il s'appuie sur les outils de base, il formate chaque relevé en
// lignes simples « a|b|c », faciles à relire et à vérifier. Ces lecteurs servent côté compagnon et aux essais.

/** `ps -eo pid=,ppid=,user=,comm=,args=` (Linux, macOS) → processus. Pur. */
export function lireProcessusPosix(out: string): Processus[] {
  const res: Processus[] = [];
  for (const l of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/.exec(l); if (!m) continue;
    const ligne = m[5].trim();
    res.push({ pid: Number(m[1]), ppid: Number(m[2]), utilisateur: m[3], nom: m[4], ...(ligne ? { ligne, chemin: ligne.split(/\s+/)[0] } : {}) });
  }
  return res;
}
/** Lignes « pid|ppid|nom|chemin|utilisateur » (Windows, Get-CimInstance Win32_Process). Pur. */
export function lireProcessusWindows(out: string): Processus[] {
  const res: Processus[] = [];
  for (const l of out.split('\n')) {
    const c = l.split('|'); if (c.length < 3 || !/^\d+$/.test(c[0].trim())) continue;
    const nom = (c[2] ?? '').trim(); if (!nom) continue;
    res.push({ pid: Number(c[0]), ppid: Number(c[1]) || 0, nom, ...(c[3]?.trim() ? { chemin: c[3].trim() } : {}), ...(c[4]?.trim() ? { utilisateur: c[4].trim() } : {}) });
  }
  return res;
}
/** `netstat -ano` (Windows) → connexions sortantes établies (« proto local remote état pid »). Pur. */
export function lireConnexionsWindows(out: string): ConnexionSortante[] {
  const res: ConnexionSortante[] = [];
  for (const l of out.split('\n')) {
    const c = l.trim().split(/\s+/); if (c.length < 5 || !/^(TCP|UDP)$/i.test(c[0])) continue;
    if (c[0].toUpperCase() === 'TCP' && !/ESTABLISHED/i.test(c[3])) continue;
    const remote = c[2], cut = remote.lastIndexOf(':'); if (cut < 0) continue;
    const rip = remote.slice(0, cut).replace(/^\[|\]$/g, ''), rport = Number(remote.slice(cut + 1));
    if (!/^[0-9a-f.:]{3,60}$/i.test(rip) || rip === '0.0.0.0' || rip === '*' || rip === '::' || rip === '::1' || rip.startsWith('127.')) continue;
    res.push({ proto: c[0].toLowerCase(), rip, rport, pid: Number(c.at(-1)) || undefined });
  }
  return res;
}
