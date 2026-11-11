// Ullr — les incidents : Odin relie ce que voient toutes ses applis.
// Un signal isolé (un processus bizarre, une connexion nouvelle, un fichier modifié) ne dit pas grand-chose.
// Plusieurs signaux qui touchent la même chose (la même adresse, le même programme, le même fichier, la
// même machine dans les mêmes minutes) racontent une attaque. Chaque incident a un score explicable, une
// chronologie, et une réponse : ce qu'Odin fait seul (annulable) et ce qu'il te propose (jamais de
// suppression ni d'arrêt brutal sans ton accord).

import { isIP } from 'node:net';
import { isPrivateV4 } from '../../hlidskjalf/discover.ts';

/** `anchor` : un vrai indice d'attaque (peut ouvrir un incident). Sans lui, le signal n'est que du contexte : il pèse peu et n'ouvre rien seul. */
export interface Signal { at: number; app: string; type: string; keys: string[]; weight: number; text: string; anchor?: boolean; attack?: string; ip?: string; file?: string; pid?: number; prog?: string }
export interface Incident { id: string; at: string; updated: string; title: string; kind: string; score: number; level: 'critique' | 'haute' | 'moyenne'; apps: string[]; signals: Signal[]; state: 'ouvert' | 'traité' | 'ignoré'; done: string[]; proposed: string[]; told: number; /** note du Cerveau qui raconte l'incident */ note?: string }
export interface Response { kind: 'bannir'; ip: string; why: string }

const WINDOW = 2 * 3600_000;
const s = (v: unknown) => String(v ?? '');
const SENSITIVE = /^\/etc\/(passwd|shadow|sudoers|ssh\/|cron|systemd\/|ld\.so\.preload|rc\.local|profile)|authorized_keys|\.bashrc$|\/crontabs\//;

/** Les applis qui renseignent Ullr, et ce que chacune lui apprend. */
export const SENSORS: Array<{ app: string; when: string; what: string }> = [
  { app: 'loki', when: 'un attaquant tombe dans un piège', what: 'attaquants pris dans les pièges (identifiants, commandes, fichiers déposés)' },
  { app: 'skogul', when: 'un processus suspect tourne ou un port s\'ouvre', what: 'processus suspects, ports nouvellement ouverts' },
  { app: 'geri', when: 'un programme parle à une adresse malveillante ou nouvelle', what: 'connexions vers des adresses malveillantes ou jamais vues' },
  { app: 'garmr', when: 'une adresse est bannie', what: 'bannissements au pare-feu' },
  { app: 'forseti', when: 'un fichier système est modifié', what: 'fichiers système modifiés (comptes, tâches planifiées, clés d\'accès)' },
  { app: 'eir', when: 'le processeur est saturé', what: 'processeur saturé (minage caché)' },
  { app: 'naglfar', when: 'un conteneur s\'arrête tout seul', what: 'conteneurs arrêtés sans raison' },
  { app: 'hermod', when: 'une machine du parc disparaît', what: 'machines disparues du réseau (pendant une attaque, ou après un passage)' },
  { app: 'himinbjorg', when: 'un mouvement est vu aux heures surveillées', what: 'mouvements aux heures surveillées (avec un support branché : quelqu\'un était là)' },
];

/** Un événement d'une appli → un signal (ou rien s'il n'apprend rien sur la sécurité). */
export function toSignal(e: { module: string; type: string; data: Record<string, unknown>; level?: string; title?: string }, now = Date.now()): Signal | undefined {
  const d = e.data ?? {}, k = `${e.module}.${e.type}`;
  const ip = [d.ip, d.adresse].map(s).find((x) => isIP(x));
  const sig = (weight: number, text: string, keys: string[], more: Partial<Signal> = {}): Signal => ({ at: now, app: e.module, type: e.type, keys, weight, text, ...(ip ? { ip } : {}), ...more });
  switch (k) {
    case 'loki.piege': return ip ? sig(d.type === 'capture' ? 45 : d.type === 'identifiants' || d.type === 'commande' ? 35 : 15, `un attaquant (${ip}) est tombé dans le piège ${s(d['piège'])} : ${s(d['détail']).slice(0, 80)}`, [`ip:${ip}`], { attack: 'T1110', anchor: d.type === 'capture' || d.type === 'identifiants' || d.type === 'commande' }) : undefined;
    case 'garmr.banni': return ip ? sig(10, `${ip} banni au pare-feu (${s(d.raison)})`, [`ip:${ip}`]) : undefined;
    case 'geri.malveillant': return sig(60, `le programme ${s(d.programme)} parle à ${ip}, adresse connue comme malveillante`, [`ip:${ip}`, `prog:${s(d.programme)}`, 'machine'], { prog: s(d.programme), attack: 'T1071', anchor: true });
    case 'geri.nouvelle_destination': return sig(5, `${s(d.programme)} contacte ${ip}:${s(d.port)} pour la première fois`, [`ip:${ip}`, `prog:${s(d.programme)}`], { prog: s(d.programme) });
    case 'skogul.suspect': return sig(45, `processus suspect (${s(d['règle'])}) : ${s(d['détail']).slice(0, 100)}`, [`prog:${s(d['détail']).split(/[\s/]/).filter(Boolean).pop() ?? ''}`, `pid:${s(d.pid)}`, 'machine'], { pid: Number(d.pid) || undefined, attack: 'T1059', anchor: true });
    case 'skogul.port_ouvert': return sig(15, `nouveau port ouvert : ${s(d.port)}`, ['machine'], { attack: 'T1571' });
    case 'ullr.menace': return d.genre === 'test' ? undefined : sig(d['gravité'] === 'critique' ? 70 : d['gravité'] === 'haute' ? 50 : 20, `fichier dangereux : ${s(d.menace)} (${s(d.fichier)})`, [`file:${s(d.fichier)}`, 'machine'], { file: s(d.fichier), anchor: true });
    case 'ullr.sentinelle': return sig(90, `un fichier sentinelle a été ${s(d.action)} : ${s(d.fichier)}`, ['machine', 'rançon'], { file: s(d.fichier), attack: 'T1486', anchor: true });
    case 'ullr.rafale': return sig(60, `${s(d.nombre)} fichiers renommés ou réécrits en ${s(d.secondes)} s dans ${s(d.dossier)}`, ['machine', 'rançon'], { attack: 'T1486', anchor: true });
    case 'ullr.support_branche': return sig(25, `support amovible branché : ${s(d.dossier)}`, ['machine', 'lieu']);
    case 'forseti.fichier_modifie': return sig(SENSITIVE.test(s(d.fichier)) ? 40 : 20, `fichier système modifié : ${s(d.fichier)}`, [`file:${s(d.fichier)}`, 'machine'], { file: s(d.fichier), attack: 'T1543', anchor: SENSITIVE.test(s(d.fichier)) });
    case 'eir.mesure': return Number(d.cpu) >= 95 ? sig(10, `processeur saturé (${s(d.cpu)} %)`, ['machine'], { attack: 'T1496' }) : undefined;
    case 'odin.connexion_refusee': return ip ? sig(15, `mot de passe d'Odin refusé depuis ${ip}`, [`ip:${ip}`, 'porte'], { attack: 'T1110', anchor: true }) : undefined;
    case 'himinbjorg.mouvement': return d['surveillé'] ? sig(30, `mouvement sur la caméra ${s(d['caméra'])} aux heures surveillées`, ['lieu'], { anchor: true }) : undefined;
    case 'naglfar.conteneur_arrete': return sig(8, `le conteneur ${s(d.conteneur)} s'est arrêté tout seul`, ['machine']);
    case 'hermod.machine_hors_ligne': return sig(8, `la machine ${s(d.machine)} a disparu du réseau`, ['machine', 'lieu']);
    default: return undefined;
  }
}

/** Les mêmes choses comptent pour un incident : même adresse, même programme, même fichier ; ou la machine entière dans les mêmes minutes. */
const LOOSE = new Set(['machine', 'porte', 'lieu', 'rançon']);
function related(inc: Incident, sig: Signal): boolean {
  const keys = new Set(inc.signals.flatMap((x) => x.keys));
  if (sig.keys.some((k) => !LOOSE.has(k) && keys.has(k))) return true;
  // Clés larges (la machine, la porte d'Odin) : seulement si c'est proche dans le temps (15 minutes).
  return sig.keys.some((k) => LOOSE.has(k) && keys.has(k)) && inc.signals.some((x) => Math.abs(sig.at - x.at) < 15 * 60_000);
}
function title(sigs: Signal[], apps: (id: string) => string): { title: string; kind: string } {
  const has = (k: string) => sigs.some((x) => `${x.app}.${x.type}` === k), n = (k: string) => sigs.filter((x) => `${x.app}.${x.type}` === k).length;
  if (has('ullr.sentinelle') || has('ullr.rafale')) return { kind: 'rançongiciel', title: 'Comportement de rançongiciel : des fichiers sont réécrits en masse' };
  if (has('geri.malveillant') && (has('loki.piege') || has('skogul.suspect'))) return { kind: 'compromission', title: 'Cette machine communique avec un attaquant' };
  if (has('geri.malveillant')) return { kind: 'communication malveillante', title: 'Un programme parle à une adresse malveillante' };
  if (has('skogul.suspect') && has('ullr.menace')) return { kind: 'malware actif', title: 'Un fichier dangereux est en cours d\'exécution' };
  if (has('skogul.suspect') && (has('geri.nouvelle_destination') || has('eir.mesure'))) return { kind: 'programme suspect', title: 'Un programme suspect est actif (réseau ou processeur anormal)' };
  if (n('odin.connexion_refusee') >= 3) return { kind: 'force brute', title: 'Quelqu\'un essaie de deviner ton mot de passe d\'Odin' };
  if (has('loki.piege') && has('odin.connexion_refusee')) return { kind: 'attaque ciblée', title: 'Un attaquant tombé dans un piège vise aussi Odin' };
  if (has('forseti.fichier_modifie') && (has('skogul.port_ouvert') || has('skogul.suspect'))) return { kind: 'installation furtive', title: 'Installation furtive possible : fichier système modifié et activité nouvelle' };
  if (has('himinbjorg.mouvement') && has('ullr.support_branche')) return { kind: 'intrusion physique', title: 'Quelqu\'un était là : mouvement aux heures surveillées, puis un support branché sur la machine' };
  if (has('ullr.menace')) return { kind: 'fichier dangereux', title: 'Fichier dangereux, et activité anormale au même moment' };
  if (has('loki.piege')) return { kind: 'attaque', title: 'Un attaquant insiste sur tes pièges' };
  return { kind: 'activité anormale', title: `Activité anormale vue par ${[...new Set(sigs.map((x) => apps(x.app)))].join(', ')}` };
}

export class Correlator {
  incidents: Incident[];
  private recent: Signal[] = [];
  constructor(saved: Incident[] = []) { this.incidents = saved; }

  /**
   * Ajoute un signal. Renvoie l'incident s'il vient d'apparaître ou de s'aggraver (à annoncer), et les
   * réponses automatiques à lancer (seulement des actions annulables).
   */
  add(sig: Signal, apps: (id: string) => string = (id) => id): { incident?: Incident; announce: boolean; responses: Response[] } {
    const now = sig.at;
    this.recent = [...this.recent.filter((x) => now - x.at < WINDOW), sig].slice(-400);
    let inc = this.incidents.find((i) => i.state === 'ouvert' && now - Date.parse(i.updated) < WINDOW && related(i, sig));
    if (!inc) {
      // Signaux récents qui touchent la même chose : s'ils suffisent, un incident naît.
      const group = this.recent.filter((x) => x === sig || related({ signals: [sig] } as Incident, x));
      // Il faut un vrai indice d'attaque, et soit deux applis qui se recoupent, soit un signal qui se suffit
      // (rançongiciel en cours, mot de passe d'Odin essayé cinq fois). Un bannissement est une réponse, pas un témoin.
      const anchors = group.filter((x) => x.anchor), sc = score(group);
      const witnesses = new Set(group.filter((x) => `${x.app}.${x.type}` !== 'garmr.banni').map((x) => x.app));
      const alone = anchors.some((x) => x.app === 'ullr' && (x.type === 'sentinelle' || x.type === 'rafale')) || anchors.filter((x) => x.app === 'odin' && x.type === 'connexion_refusee').length >= 5;
      if (!anchors.length || !((witnesses.size >= 2 && sc >= 45) || alone)) return { announce: false, responses: [] };
      const id = Math.random().toString(36).slice(2, 8);
      inc = { id, at: new Date(now).toISOString(), updated: new Date(now).toISOString(), title: '', kind: '', score: 0, level: 'moyenne', apps: [], signals: group.slice(-40), state: 'ouvert', done: [], proposed: [], told: 0 };
      this.incidents = [inc, ...this.incidents].slice(0, 100);
    } else inc.signals = [...inc.signals, sig].slice(-60);
    const before = inc.level, t = title(inc.signals, apps);
    inc.title = t.title; inc.kind = t.kind; inc.score = score(inc.signals); inc.level = inc.score >= 85 ? 'critique' : inc.score >= 60 ? 'haute' : 'moyenne';
    inc.apps = [...new Set(inc.signals.map((x) => apps(x.app)))]; inc.updated = new Date(now).toISOString();
    // Réponses : bannir les adresses extérieures impliquées (annulable) ; le reste est proposé.
    const responses: Response[] = [];
    if (inc.score >= 60) for (const ip of new Set(inc.signals.map((x) => x.ip).filter((x): x is string => Boolean(x)))) {
      // Jamais une adresse du réseau local ; et pas deux fois la même (déjà bannie par Loki, Geri ou toi).
      if (isPrivateV4(ip) || ip === '127.0.0.1' || ip.includes(':') || inc.done.includes(`bannir ${ip}`) || inc.signals.some((x) => x.app === 'garmr' && x.type === 'banni' && x.ip === ip)) continue;
      inc.done.push(`bannir ${ip}`); responses.push({ kind: 'bannir', ip, why: `incident « ${inc.title} »` });
    }
    const pids = [...new Set(inc.signals.map((x) => x.pid).filter((x): x is number => Boolean(x)))];
    inc.proposed = [...pids.map((p) => `tue le processus ${p}`), ...(inc.kind === 'intrusion physique' ? ['regarde les enregistrements de la caméra (« les clips »), et ce qui a été branché'] : []), ...(inc.kind === 'rançongiciel' ? ['coupe le réseau de la machine touchée et restaure les fichiers depuis Sindri (« mes sauvegardes »)'] : []), ...(inc.kind === 'force brute' ? ['change ton mot de passe d\'Odin si tu as un doute (Réglages → Accès)'] : [])];
    const rank = { moyenne: 0, haute: 1, critique: 2 };
    const announce = inc.told === 0 || rank[inc.level] > rank[before];
    if (announce) inc.told++;
    return { incident: inc, announce, responses };
  }
  set(id: string, state: Incident['state']): Incident | undefined { const i = this.incidents.find((x) => x.id === id); if (i) { i.state = state; i.updated = new Date().toISOString(); } return i; }
}
/** Score d'un groupe de signaux : ils se cumulent ; le même signal répété compte un peu plus à chaque fois, sans exploser (12 fois pour un indice d'attaque, 3 pour un simple contexte). */
export function score(sigs: Signal[]): number {
  const seen = new Map<string, number>(); let p = 1;
  for (const x of sigs) { const k = `${x.app}.${x.type}:${x.keys[0]}`, n = seen.get(k) ?? 0; seen.set(k, n + 1); if (n >= (x.anchor ? 12 : 3)) continue; p *= 1 - Math.min(n === 0 ? x.weight : Math.min(x.weight, 12), 100) / 100; }
  return Math.round(100 * (1 - p));
}
/** Le récit d'un incident (message, page, note du Cerveau). */
export function story(i: Incident): string {
  const lines = i.signals.slice(-12).map((x) => `- ${new Date(x.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · ${x.text}${x.attack ? ` [${x.attack}]` : ''}`);
  return [`Score de risque : ${i.score}/100 (${i.level}). Vu par : ${i.apps.join(', ')}.`, ...lines, i.done.length ? `Ce que j'ai fait : ${i.done.join(' ; ')} (annulable).` : '', i.proposed.length ? `Ce que je te propose : ${i.proposed.map((p) => `« ${p} »`).join(' ; ')}.` : ''].filter(Boolean).join('\n');
}
