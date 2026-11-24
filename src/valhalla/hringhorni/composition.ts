// Hringhorni — les piles (lot K3 de la maquette « Conteneurs et machines » validée le 23/11) : plusieurs conteneurs
// décrits ensemble dans un fichier de composition (le format courant : services, image, ports, volumes, réseaux,
// variables, dépendances). Ce fichier vient d'ailleurs (copié d'un site, d'un dépôt) : il est lu comme une donnée
// étrangère, jamais comme un ordre.
//   1. La lecture est STRICTE et BORNÉE : un lecteur du sous-ensemble utile du YAML, écrit ici (aucun paquet), qui
//      refuse les ancres, les alias, les fusions « << », les étiquettes « ! », les directives, plusieurs documents,
//      les clés complexes, les clés « __proto__ », les clés en double, les tabulations dans le retrait, et qui borne
//      la taille (64 Ko), le nombre de lignes, de services, d'éléments et la profondeur : pas de « bombe » de YAML.
//   2. L'analyse dit, ligne par ligne, ce qui est accepté, changé ou refusé. Refusé : tous les droits (`privileged`),
//      le disque entier, un dossier du système, personnel, d'Odin ou du moteur, le socket d'un moteur, le réseau de
//      la machine, ses processus (`pid: host`) et ses autres espaces, les capacités dangereuses, les périphériques,
//      les variables prises sur ce PC, construire une image, lire un fichier de ce PC (`env_file`)… et tout ce que
//      le moteur ne comprend pas (il ne lance pas ce qu'il ne comprend pas). Tant qu'une ligne est refusée, RIEN ne
//      se déploie.
//   3. L'ordre de démarrage suit les dépendances (un cycle est refusé, avec son chemin).
//   4. Une pile se déploie (son réseau à part, ses volumes, ses images, ses conteneurs, dans l'ordre), démarre,
//      s'arrête (dans l'ordre inverse) et se supprime : ses volumes sont GARDÉS par défaut ; les effacer ne touche
//      que ses dossiers à elle (les volumes qu'elle a créés, dont plus aucun autre conteneur ne se sert).
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { splitLine } from './cli.ts';
import { NOM_OBJET, type Mount, type Port, type Restart } from './store.ts';
import type { Ctr, Engine } from './engine.ts';

// =================================================================================================================
// 1. Le lecteur YAML strict
// =================================================================================================================
/** Une valeur lue : un texte, rien, une liste ou un dictionnaire (sans prototype : aucune clé ne touche aux objets). */
export type Val = null | string | Val[] | Obj;
export interface Obj { [cle: string]: Val }
/** Les bornes de la lecture (un fichier de composition courant tient très loin dedans). */
export const BORNES = { octets: 64 * 1024, lignes: 1500, profondeur: 8, noeuds: 4000, texte: 4096, liste: 200, services: 20 };
export class RefusYaml extends Error {}
const refuser = (t: string): never => { throw new RefusYaml(t); };
const CLES_INTERDITES = new Set(['__proto__', 'constructor', 'prototype']);
interface Ligne { n: number; ind: number; t: string; brut?: boolean }

/** Le commentaire d'une ligne retiré (un « # » en début de ligne ou après un blanc, hors guillemets). Un guillemet
 *  n'ouvre un texte qu'au début d'une valeur ; un guillemet ouvert jusqu'au bout de la ligne est refusé. */
function sansCommentaire(l: string, n: number): string {
  let q = '', avant = '';
  for (let k = 0; k < l.length; k++) {
    const c = l[k];
    if (q) { if (c === '\\' && q === '"') k++; else if (c === q) { if (q === '\'' && l[k + 1] === '\'') k++; else q = ''; } continue; }
    if ((c === '"' || c === '\'') && (avant === '' || /[\s:\-[{,]/.test(avant))) q = c;
    else if (c === '#' && (k === 0 || /\s/.test(l[k - 1]))) return l.slice(0, k);
    avant = c;
  }
  if (q) refuser(`ligne ${n} : texte entre guillemets non fermé (un texte sur plusieurs lignes n'est pas lu)`);
  return l;
}
const estTiret = (t: string) => t === '-' || t.startsWith('- ');
const ENTETE_BLOC = /(?:^-|^|:)\s*[|>][-+]?$/;
const debutInterdit = (s: string, n: number) => {
  if (/^&/.test(s)) refuser(`ligne ${n} : ancre « & » refusée (pas de renvoi dans le fichier)`);
  if (/^\*/.test(s)) refuser(`ligne ${n} : alias « * » refusé (pas de renvoi dans le fichier)`);
  if (/^!/.test(s)) refuser(`ligne ${n} : étiquette « ! » refusée`);
  if (/^[@`]/.test(s)) refuser(`ligne ${n} : caractère réservé au début d'une valeur`);
};
/** Un texte simple (sans guillemets) ou entre guillemets, en une ligne. Vide, « ~ » ou « null » : rien. */
function scalaire(brut: string, n: number, b = BORNES): string | null {
  const s = brut.trim();
  debutInterdit(s, n);
  if (s.length > b.texte) refuser(`ligne ${n} : texte trop long (${b.texte} caractères au plus)`);
  if (s.startsWith('"')) {
    const m = /^"((?:[^"\\]|\\.)*)"$/.exec(s); if (!m) refuser(`ligne ${n} : guillemets mal fermés`);
    return m![1].replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_x, e: string) => {
      if (e[0] === 'u' && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
      const t: Record<string, string> = { '\\': '\\', '"': '"', '/': '/', n: '\n', t: '\t', r: '\r', ' ': ' ' };
      if (!(e in t)) refuser(`ligne ${n} : échappement « \\${e} » inconnu`);
      return t[e];
    });
  }
  if (s.startsWith('\'')) { const m = /^'((?:[^']|'')*)'$/.exec(s); if (!m) refuser(`ligne ${n} : guillemets mal fermés`); return m![1].replace(/''/g, '\''); }
  if (s === '' || s === '~' || /^(null|Null|NULL)$/.test(s)) return null;
  if (/:\s/.test(s) || /:$/.test(s)) refuser(`ligne ${n} : « : » de trop dans « ${s.slice(0, 40)} » (mets la valeur entre guillemets)`);
  if (/^[[\]{}]/.test(s) || /^[|>]/.test(s)) refuser(`ligne ${n} : valeur illisible « ${s.slice(0, 40)} »`);
  return s;
}
/** Coupe « a, "b, c", d » aux virgules hors guillemets ; une liste ou un dictionnaire DANS une liste en ligne est refusé. */
function couper(s: string, n: number): string[] {
  const out: string[] = []; let cur = '', q = '';
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (q) { cur += c; if (c === '\\' && q === '"') { cur += s[++k] ?? ''; } else if (c === q) q = ''; continue; }
    if (c === '"' || c === '\'') { q = c; cur += c; } else if (c === '[' || c === '{' || c === ']' || c === '}') refuser(`ligne ${n} : liste dans une liste en ligne refusée (écris-la sur plusieurs lignes)`);
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  if (q) refuser(`ligne ${n} : guillemets mal fermés`);
  if (cur.trim() !== '' || out.length) out.push(cur);
  if (out.some((x) => x.trim() === '')) refuser(`ligne ${n} : élément vide dans une liste en ligne`);
  return out;
}

/** Lit un fichier YAML (le sous-ensemble utile, voir l'en-tête). Lève RefusYaml avec une phrase simple. Pur. */
export function lireYamlStrict(texte: string, b = BORNES): Val {
  if (typeof texte !== 'string' || !texte.trim()) refuser('fichier vide');
  if (Buffer.byteLength(texte, 'utf8') > b.octets) refuser(`fichier trop gros (${Math.round(b.octets / 1024)} Ko au plus)`);
  const src = texte.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(src)) refuser('caractère de contrôle dans le fichier');
  const ls = src.split('\n'); if (ls.length > b.lignes) refuser(`fichier trop long (${b.lignes} lignes au plus)`);
  const L: Ligne[] = []; let blocInd = -1, fin = false;
  for (let k = 0; k < ls.length; k++) {
    const l = ls[k], n = k + 1;
    if (l.length > b.texte) refuser(`ligne ${n} trop longue`);
    const lead = /^[ \t]*/.exec(l)![0];
    if (blocInd >= 0 && (l.trim() === '' || (!lead.includes('\t') && lead.length > blocInd))) { L.push({ n, ind: l.trim() === '' ? Number.MAX_SAFE_INTEGER : lead.length, t: l, brut: true }); continue; }
    blocInd = -1;
    if (lead.includes('\t')) refuser(`ligne ${n} : tabulation dans le retrait (des espaces seulement)`);
    const t = sansCommentaire(l, n).slice(lead.length).trimEnd();
    if (t === '') continue;
    if (fin) refuser(`ligne ${n} : du texte après la fin du document (« ... »)`);
    if (lead.length === 0 && t.startsWith('%')) refuser(`ligne ${n} : directive « % » refusée`);
    if (lead.length === 0 && (t === '---' || t.startsWith('--- '))) { if (L.length || t !== '---') refuser(`ligne ${n} : un seul document par fichier`); continue; }
    if (lead.length === 0 && t === '...') { fin = true; continue; }
    L.push({ n, ind: lead.length, t });
    if (ENTETE_BLOC.test(t)) blocInd = lead.length;
  }
  if (!L.length) refuser('fichier vide');
  let i = 0, noeuds = 0;
  const compter = () => { if (++noeuds > b.noeuds) refuser(`fichier trop chargé (${b.noeuds} éléments au plus)`); };
  const ici = () => L[i];
  const pasBrut = (l: Ligne) => { if (l.brut) refuser(`ligne ${l.n} : retrait inattendu`); return l; };
  const apres = (ind: number) => { if (i < L.length && L[i].ind > ind) refuser(`ligne ${L[i].n} : retrait inattendu`); };
  const cleDe = (t: string, n: number): { cle: string; reste: string } | null => {
    if (t === '?' || t.startsWith('? ')) refuser(`ligne ${n} : clé complexe « ? » refusée`);
    let m = /^"((?:[^"\\]|\\.)*)"\s*:(?:\s+(.*))?$/.exec(t);
    if (m) return { cle: scalaire(`"${m[1]}"`, n, b) ?? '', reste: (m[2] ?? '').trim() };
    m = /^'((?:[^']|'')*)'\s*:(?:\s+(.*))?$/.exec(t);
    if (m) return { cle: m[1].replace(/''/g, '\''), reste: (m[2] ?? '').trim() };
    m = /^([^\s"'#&*!|>%@`[\]{},?:][^:]*?)\s*:(?:\s+(.*))?$/.exec(t);
    if (m && !(m[1] === '-' || m[1].startsWith('- '))) return { cle: m[1], reste: (m[2] ?? '').trim() };
    return null;
  };
  const blocTexte = (entete: string, ind: number, n: number): string => {
    const m = /^([|>])([-+]?)$/.exec(entete); if (!m) refuser(`ligne ${n} : en-tête de bloc « ${entete.slice(0, 10)} » refusé`);
    const lignes: Ligne[] = [];
    while (i < L.length && L[i].brut && (L[i].t.trim() === '' || L[i].ind > ind)) lignes.push(L[i++]);
    const pleines = lignes.filter((x) => x.t.trim() !== ''); if (!pleines.length) return '';
    const base = pleines[0].ind;
    for (const x of pleines) if (x.ind < base) refuser(`ligne ${x.n} : retrait du bloc de texte`);
    let corps = lignes.map((x) => (x.t.trim() === '' ? '' : x.t.slice(base)));
    const finVides = corps.length - corps.map((x) => x !== '').lastIndexOf(true) - 1;
    corps = corps.slice(0, corps.length - finVides);
    let s = m![1] === '>' ? corps.join('\n').replace(/([^\n])\n(?!\n)/g, '$1 ') : corps.join('\n');
    s += m![2] === '-' ? '' : m![2] === '+' ? '\n'.repeat(finVides + 1) : '\n';
    if (s.length > b.texte * 4) refuser(`ligne ${n} : bloc de texte trop long`);
    return s;
  };
  const enLigne = (reste: string, n: number, ind: number): Val => {
    debutInterdit(reste, n);
    if (reste.startsWith('[')) {
      if (!reste.endsWith(']')) refuser(`ligne ${n} : liste en ligne non fermée (une seule ligne)`);
      const l = couper(reste.slice(1, -1), n); if (l.length > b.liste) refuser(`ligne ${n} : liste trop longue (${b.liste} au plus)`);
      return l.map((x) => { compter(); return scalaire(x, n, b); });
    }
    if (reste.startsWith('{')) {
      if (!reste.endsWith('}')) refuser(`ligne ${n} : dictionnaire en ligne non fermé (une seule ligne)`);
      const o: Obj = Object.create(null);
      for (const p of couper(reste.slice(1, -1), n)) {
        const c = cleDe(p.trim(), n); if (!c) refuser(`ligne ${n} : élément « ${p.trim().slice(0, 30)} » illisible`);
        verifierCle(c!.cle, o, n); compter(); o[c!.cle] = scalaire(c!.reste, n, b);
      }
      return o;
    }
    if (/^[|>]/.test(reste)) return blocTexte(reste, ind, n);
    return scalaire(reste, n, b);
  };
  const verifierCle = (cle: string, o: Obj, n: number) => {
    if (cle === '<<') refuser(`ligne ${n} : fusion « << » refusée (pas de renvoi dans le fichier)`);
    if (CLES_INTERDITES.has(cle)) refuser(`ligne ${n} : clé « ${cle} » refusée`);
    if (cle.length > 200) refuser(`ligne ${n} : clé trop longue`);
    if (Object.prototype.hasOwnProperty.call(o, cle)) refuser(`ligne ${n} : clé « ${cle.slice(0, 40)} » en double`);
  };
  const enfant = (ind: number, prof: number, dansDict: boolean): Val => {
    if (i < L.length && L[i].ind > ind && !L[i].brut) return bloc(prof + 1);
    if (dansDict && i < L.length && L[i].ind === ind && estTiret(L[i].t)) return sequence(ind, prof + 1);
    return null;
  };
  const bloc = (prof: number): Val => {
    if (prof > b.profondeur) refuser(`ligne ${ici().n} : trop imbriqué (${b.profondeur} niveaux au plus)`);
    const l = pasBrut(ici());
    return estTiret(l.t) ? sequence(l.ind, prof) : dictionnaire(l.ind, prof);
  };
  const sequence = (ind: number, prof: number): Val[] => {
    if (prof > b.profondeur) refuser(`ligne ${ici().n} : trop imbriqué (${b.profondeur} niveaux au plus)`);
    const out: Val[] = [];
    while (i < L.length && L[i].ind === ind && !L[i].brut && estTiret(L[i].t)) {
      if (out.length >= b.liste) refuser(`ligne ${L[i].n} : liste trop longue (${b.liste} au plus)`);
      compter();
      const l = L[i], reste = l.t.slice(1).trimStart(), col = ind + (l.t.length - reste.length);
      if (reste === '') { i++; out.push(enfant(ind, prof, false)); }
      else if (estTiret(reste)) { L[i] = { n: l.n, ind: col, t: reste }; out.push(sequence(col, prof + 1)); }
      else if (cleDe(reste, l.n)) { L[i] = { n: l.n, ind: col, t: reste }; out.push(dictionnaire(col, prof + 1)); }
      else { i++; out.push(enLigne(reste, l.n, ind)); }
      apres(ind);
    }
    return out;
  };
  const dictionnaire = (ind: number, prof: number): Obj => {
    if (prof > b.profondeur) refuser(`ligne ${ici().n} : trop imbriqué (${b.profondeur} niveaux au plus)`);
    const o: Obj = Object.create(null);
    while (i < L.length && L[i].ind === ind && !L[i].brut && !estTiret(L[i].t)) {
      const l = L[i], c = cleDe(l.t, l.n); if (!c) refuser(`ligne ${l.n} : illisible (« ${l.t.slice(0, 40)} »)`);
      verifierCle(c!.cle, o, l.n); compter(); i++;
      o[c!.cle] = c!.reste === '' ? enfant(ind, prof, true) : enLigne(c!.reste, l.n, ind);
      apres(ind);
    }
    return o;
  };
  const v = bloc(0);
  if (i < L.length) refuser(`ligne ${L[i].n} : retrait inattendu`);
  return v;
}

// =================================================================================================================
// 2. L'analyse d'un fichier de composition
// =================================================================================================================
export type Ton = 'ok' | 'change' | 'refus';
export interface Constat { ton: Ton; quoi: string; texte: string }
/** Un dossier partagé d'un service : un volume (son nom chez le moteur) ou un dossier de la machine. */
export interface MontagePile { volume?: string; host?: string; inner: string; ro: boolean }
export interface ServicePile {
  service: string; conteneur: string; image: string; cmd?: string[]; entrypoint?: string[]; env: Record<string, string>;
  ports: Port[]; montages: MontagePile[]; restart: Restart; memory: string; cpus?: string; user?: string; workdir?: string; hostname?: string;
  reseau: string | null; depend: string[];
}
export interface ReseauPile { nom: string; internet: boolean; externe: boolean }
export interface VolumePile { nom: string; externe: boolean }
export interface Analyse {
  nom: string; ok: boolean; services: ServicePile[]; ordre: string[]; volumes: VolumePile[]; reseaux: ReseauPile[];
  constats: Constat[]; refus: string[];
}
/** Ce que l'analyse doit protéger (des chemins de ce PC) et ce qui existe déjà chez le moteur. */
export interface Garde {
  maison?: string; odin?: string; moteur?: string; autres?: string[];
  conteneurs?: string[]; volumes?: string[]; reseaux?: string[]; piles?: string[];
  /** les ports déjà pris sur ce PC (et par qui) */
  portsPris?: Map<number, string>;
  /** vérifier le vrai chemin des dossiers qui existent (liens suivis) — sous Linux seulement */
  vraiChemin?: (p: string) => string | undefined;
}
/** Le nom d'une pile, d'un service : minuscules, chiffres, « - » (et « _ » pour un service), 30 caractères au plus. */
export const NOM_PILE = /^[a-z0-9][a-z0-9-]{0,29}$/;
const NOM_SERVICE = /^[a-z0-9][a-z0-9_-]{0,29}$/;
export const TEXTES_K3 = {
  memoireParDefaut: '512m',
  refusePrivilege: 'un conteneur n\'a jamais tous les droits sur le PC',
  refuseHote: 'le réseau de la machine n\'est jamais donné : le conteneur aurait toutes ses connexions',
  refusePid: 'les processus de la machine ne sont jamais visibles depuis un conteneur',
  refuseEspace: 'cet espace de la machine n\'est jamais partagé avec un conteneur',
  refusePeripherique: 'aucun périphérique de la machine n\'est donné à un conteneur',
  refuseCapacite: 'cette capacité donne un pouvoir sur la machine entière',
  refuseSocket: 'le socket d\'un moteur de conteneurs donne la machine entière',
  refuseDisque: 'le disque entier du PC n\'est jamais monté : seuls les dossiers que tu choisis',
  refuseSysteme: 'un dossier du système n\'est jamais donné à un conteneur',
  refusePerso: 'ton dossier personnel et tes dossiers à toi ne sont pas donnés par un fichier de composition',
  refuseOdin: 'les données d\'Odin (et son coffre) ne sont jamais données à un conteneur',
  refuseMoteur: 'le dossier du moteur ne se donne pas par son chemin (un volume se donne par son nom)',
  refuseCache: 'un dossier caché (clés, réglages d\'un compte) n\'est jamais donné',
  refuseRelatif: 'un chemin relatif n\'a pas de dossier de départ ici : donne un volume nommé ou un chemin complet',
  refuseVariablePC: 'Odin ne prend pas les variables de ce PC (elles pourraient contenir ses secrets) : écris la valeur, ou « $$ » pour un « $ »',
  refuseInconnu: 'pas compris : Odin ne lance pas ce qu\'il ne comprend pas',
  refuseConstruire: 'construire une image n\'est pas encore possible : donne une image d\'un registre',
  refuseFichierPC: 'lirait un fichier de ce PC : écris les variables dans « environment »',
  refuseCycle: 'les dépendances tournent en rond : {chemin}',
};
const CAPACITES_SURES = new Set(['NET_BIND_SERVICE', 'CHOWN', 'SETUID', 'SETGID', 'FOWNER', 'KILL', 'DAC_OVERRIDE', 'FSETID', 'SETPCAP', 'AUDIT_WRITE', 'MKNOD', 'SYS_CHROOT', 'SYS_NICE', 'IPC_LOCK', 'SYS_RESOURCE', 'WAKE_ALARM', 'BLOCK_SUSPEND']);
/** Les clés d'un service qu'Odin ne fait pas (encore), sans danger : notées « pas prises en compte ». */
const IGNOREES = new Set(['healthcheck', 'logging', 'stdin_open', 'tty', 'init', 'stop_grace_period', 'stop_signal', 'shm_size', 'ulimits', 'expose', 'labels', 'container_name', 'platform', 'pull_policy', 'mem_reservation', 'memswap_limit', 'cpu_shares', 'cpuset', 'oom_score_adj', 'domainname', 'dns', 'dns_search', 'dns_opt', 'extra_hosts', 'read_only', 'cap_drop', 'annotations', 'attach', 'tmpfs', 'restart_policy']);
const SYSTEME = /^(etc|usr|bin|sbin|lib|lib32|lib64|libx32|boot|dev|proc|sys|run|root|snap|var|opt|tmp|lost\+found)$/i;
const SYSTEME_PARTOUT = /^(windows|program files|program files \(x86\)|programdata|system32)$/i;
const PERSO = /^(images|pictures|photos|videos|vidéos|musique|music|documents|bureau|desktop|telechargements|téléchargements|downloads|public|modeles|modèles|templates|onedrive|dropbox)$/i;
const enPosix = (p: string) => posix.normalize(String(p).replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')).replace(/\/+$/, '') || '/';
const dedans = (p: string, r: string) => { const a = enPosix(p), b = enPosix(r); return a === b || a.startsWith(b === '/' ? '/' : `${b}/`); };

/** Pourquoi ce dossier de la machine ne peut pas être donné par un fichier de composition (undefined : il peut). */
export function pourquoiRefuserDossier(host: string, g: Garde = {}): string | undefined {
  const h = String(host ?? '');
  if (/^[A-Za-z]:|^\\\\/.test(h)) return 'un chemin de Windows : le moteur ne voit que des chemins de Linux';
  if (!h.startsWith('/')) return TEXTES_K3.refuseRelatif;
  if (h.split('/').includes('..')) return 'un chemin avec « .. » est refusé';
  const verif = (p: string): string | undefined => {
    const parts = enPosix(p).split('/').filter(Boolean);
    if (!parts.length) return TEXTES_K3.refuseDisque;
    if (parts.some((x) => /\.sock$/i.test(x) || /^(docker|podman|containerd|crio)$/i.test(x))) return TEXTES_K3.refuseSocket;
    if (SYSTEME.test(parts[0]) || parts.some((x) => SYSTEME_PARTOUT.test(x))) return TEXTES_K3.refuseSysteme;
    if (/^(mnt|media|srv|data|volumes|cdrom|run)$/i.test(parts[0]) && parts.length < 2) return TEXTES_K3.refuseDisque;
    if (/^(mnt|media)$/i.test(parts[0]) && parts.length < 3) return TEXTES_K3.refuseDisque;
    // Le dossier personnel de quiconque sur ce PC (et ceux d'un disque Windows vu par Linux, « /mnt/c/Users/… ») :
    // jamais par un fichier venu d'ailleurs, à n'importe quelle profondeur.
    if (parts.some((x) => /^(home|users)$/i.test(x))) return TEXTES_K3.refusePerso;
    if (g.maison && (dedans(p, g.maison) || dedans(g.maison, p))) return TEXTES_K3.refusePerso;
    if (parts.some((x) => PERSO.test(x))) return TEXTES_K3.refusePerso;
    for (const o of [g.odin, ...(g.autres ?? [])]) if (o && (dedans(p, o) || dedans(o, p))) return TEXTES_K3.refuseOdin;
    if (g.moteur && (dedans(p, g.moteur) || dedans(g.moteur, p))) return TEXTES_K3.refuseMoteur;
    if (parts.some((x) => x.startsWith('.'))) return TEXTES_K3.refuseCache;
    return undefined;
  };
  const r1 = verif(h); if (r1) return r1;
  // Un lien posé sur le chemin : le vrai dossier est vérifié lui aussi.
  const reel = g.vraiChemin?.(h);
  if (reel && enPosix(reel) !== enPosix(h)) { const r2 = verif(reel); if (r2) return `${r2} (par un lien)`; }
  return undefined;
}

/** L'ordre de démarrage : chaque service après ceux dont il dépend, sinon dans l'ordre du fichier. Un cycle : refus. Pur. */
export function ordreDemarrage(deps: Map<string, string[]>): string[] {
  const noms = [...deps.keys()], etat = new Map<string, 'encours' | 'fait'>(), out: string[] = [];
  const visiter = (n: string, chemin: string[]) => {
    if (etat.get(n) === 'fait') return;
    if (etat.get(n) === 'encours') { const d = chemin.indexOf(n); throw new RefusYaml(TEXTES_K3.refuseCycle.replace('{chemin}', [...chemin.slice(d), n].join(' → '))); }
    etat.set(n, 'encours');
    for (const d of deps.get(n) ?? []) visiter(d, [...chemin, n]);
    etat.set(n, 'fait'); out.push(n);
  };
  for (const n of noms) visiter(n, []);
  return out;
}

const estObj = (v: Val | undefined): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const vrai = (v: Val | undefined) => typeof v === 'string' && /^(true|yes|on)$/i.test(v);
const faux = (v: Val | undefined) => v === null || v === undefined || (typeof v === 'string' && /^(false|no|off)$/i.test(v));
const montre = (v: Val | undefined): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : JSON.stringify(v)).slice(0, 80);
/** Un texte du fichier, sans variable de ce PC : « $$ » donne « $ », tout autre « $ » suivi d'un nom est refusé. */
function sansVariable(s: string): string | null {
  if (/\$(?!\$)(\{|[A-Za-z_])/.test(s.replace(/\$\$/g, ''))) return null;
  return s.replace(/\$\$/g, '$');
}
const MEMOIRE = /^(\d+(?:\.\d+)?)\s*([kmg])?b?$/i;
const RESTART: Record<string, Restart> = { no: 'non', always: 'toujours', 'on-failure': 'si-erreur', 'unless-stopped': 'sauf-arret' };

/**
 * Analyse un fichier de composition : rien n'est lancé ni écrit. `nom` : le nom voulu pour la pile (sinon celui du
 * fichier, « name: »). Rend les constats (accepté, changé, refusé), les services prêts pour le moteur et l'ordre.
 */
export function analyserComposition(texte: string, o: { nom?: string; garde?: Garde } = {}): Analyse {
  const g = o.garde ?? {}, constats: Constat[] = [];
  const refus = (quoi: string, texte2: string) => { constats.push({ ton: 'refus', quoi, texte: texte2 }); };
  const change = (quoi: string, texte2: string) => { constats.push({ ton: 'change', quoi, texte: texte2 }); };
  const vide = (nom: string): Analyse => ({ nom, ok: false, services: [], ordre: [], volumes: [], reseaux: [], constats, refus: constats.filter((c) => c.ton === 'refus').map((c) => `${c.quoi} : ${c.texte}`) });
  let doc: Val;
  try { doc = lireYamlStrict(texte); } catch (e) { refus('Fichier illisible', (e as Error).message); return vide(String(o.nom ?? '')); }
  if (!estObj(doc)) { refus('Fichier', 'ce n\'est pas un fichier de composition (il faut « services: »)'); return vide(String(o.nom ?? '')); }
  for (const k of Object.keys(doc)) {
    if (['services', 'volumes', 'networks', 'name', 'version'].includes(k) || k.startsWith('x-')) continue;
    refus(`« ${k} »`, ['secrets', 'configs'].includes(k) ? 'pas encore : écris ces valeurs dans « environment »' : k === 'include' ? 'lirait d\'autres fichiers de ce PC' : TEXTES_K3.refuseInconnu);
  }
  const nomFichier = typeof doc.name === 'string' ? doc.name : '';
  const nom = String(o.nom ?? '').trim() || nomFichier;
  if (!nom) refus('Nom de la pile', 'donne un nom à la pile (minuscules, chiffres, « - »)');
  else if (!NOM_PILE.test(nom)) refus('Nom de la pile', `« ${nom.slice(0, 40)} » : minuscules, chiffres et « - », 30 caractères au plus`);
  else if (g.piles?.includes(nom)) refus('Nom de la pile', `une pile « ${nom} » existe déjà`);
  const pile = NOM_PILE.test(nom) ? nom : 'pile';

  // ---- volumes déclarés
  const volumes: VolumePile[] = [], volNom = new Map<string, string>();
  const vDecl = doc.volumes;
  if (vDecl !== undefined && vDecl !== null && !estObj(vDecl)) refus('« volumes »', 'une liste de noms de volumes, chacun avec ses réglages (ou {})');
  for (const [k, v] of Object.entries(estObj(vDecl) ? vDecl : {})) {
    const q = `Volume « ${k} »`;
    if (!NOM_OBJET.test(k)) { refus(q, 'nom de volume invalide (minuscules, chiffres, - _ .)'); continue; }
    if (v !== null && !estObj(v)) { refus(q, 'réglages illisibles'); continue; }
    const r = estObj(v) ? v : Object.create(null) as Obj; let bon = true;
    for (const c of Object.keys(r)) {
      if (c === 'driver' && (r.driver === 'local' || r.driver === null)) continue;
      if (c === 'driver') { refus(q, `pilote « ${montre(r.driver)} » refusé : seuls les volumes rangés par le moteur`); bon = false; }
      else if (c === 'driver_opts') { refus(q, '« driver_opts » refusé : il pourrait monter n\'importe quel dossier ou disque de la machine'); bon = false; }
      else if (c === 'labels') change(q, 'étiquettes pas prises en compte');
      else if (!['external', 'name'].includes(c)) { refus(`${q} · « ${c} »`, TEXTES_K3.refuseInconnu); bon = false; }
    }
    const externe = vrai(r.external), nomV = typeof r.name === 'string' ? r.name : externe ? k : `${pile}_${k}`;
    if (!NOM_OBJET.test(nomV)) { refus(q, `nom « ${nomV.slice(0, 40)} » invalide`); continue; }
    if (externe && !g.volumes?.includes(nomV)) { refus(q, `volume « ${nomV} » marqué « external » mais il n'existe pas : crée-le d'abord dans Volumes`); continue; }
    // Un volume qui existe déjà (d'une autre pile, d'un autre conteneur) : permis, mais dit (la pile lira et changera ses données).
    if (bon && g.volumes?.includes(nomV)) change(q, `le volume « ${nomV} » existe déjà : la pile pourra lire et changer ce qu'il contient (il n'est jamais effacé avec elle)`);
    if (bon) { volNom.set(k, nomV); volumes.push({ nom: nomV, externe: externe || Boolean(g.volumes?.includes(nomV)) }); }
  }
  // ---- réseaux déclarés (le réseau « default » de la pile : un réseau à part, à elle)
  const reseaux: ReseauPile[] = [], resNom = new Map<string, string>();
  const nDecl = doc.networks;
  if (nDecl !== undefined && nDecl !== null && !estObj(nDecl)) refus('« networks »', 'une liste de noms de réseaux, chacun avec ses réglages (ou {})');
  const declares = estObj(nDecl) ? nDecl : Object.create(null) as Obj;
  for (const [k, v] of Object.entries(declares)) {
    const q = `Réseau « ${k} »`;
    if (!NOM_SERVICE.test(k)) { refus(q, 'nom de réseau invalide'); continue; }
    if (v !== null && !estObj(v)) { refus(q, 'réglages illisibles'); continue; }
    const r = estObj(v) ? v : Object.create(null) as Obj; let bon = true;
    for (const c of Object.keys(r)) {
      if (c === 'driver' && (r.driver === 'bridge' || r.driver === null)) continue;
      if (c === 'driver') { refus(q, `pilote « ${montre(r.driver)} » refusé : seuls les réseaux à part du moteur`); bon = false; }
      else if (c === 'driver_opts' || c === 'ipam') { refus(`${q} · « ${c} »`, 'pas encore : le moteur choisit lui-même le sous-réseau'); bon = false; }
      else if (['labels', 'attachable', 'enable_ipv6'].includes(c)) change(q, `« ${c} » pas pris en compte`);
      else if (!['external', 'name', 'internal'].includes(c)) { refus(`${q} · « ${c} »`, TEXTES_K3.refuseInconnu); bon = false; }
    }
    const externe = vrai(r.external), nomR = typeof r.name === 'string' ? r.name : externe ? k : k === 'default' ? `pile-${pile}` : `${pile}-${k}`;
    if (!NOM_OBJET.test(nomR)) { refus(q, `nom « ${nomR.slice(0, 40)} » invalide`); continue; }
    if (externe && !g.reseaux?.includes(nomR)) { refus(q, `réseau « ${nomR} » marqué « external » mais il n'existe pas : crée-le d'abord dans Réseaux`); continue; }
    // Un réseau qui existe déjà (celui d'une autre pile, un réseau à part) : la pile verrait ses conteneurs par leur nom.
    // Jamais en silence par un simple « name: » ; seulement s'il est marqué « external », et c'est dit.
    if (!externe && g.reseaux?.includes(nomR)) { refus(q, `un réseau « ${nomR} » existe déjà (une autre pile ?) : la pile verrait ses conteneurs ; écris « external: true » si c'est voulu`); continue; }
    if (bon && externe) change(q, `la pile rejoint le réseau « ${nomR} », qui existe déjà : ses conteneurs et ceux qui y sont se voient par leur nom`);
    if (bon) { resNom.set(k, nomR); reseaux.push({ nom: nomR, internet: !vrai(r.internal), externe: externe || Boolean(g.reseaux?.includes(nomR)) }); }
  }

  // ---- les services
  const services: ServicePile[] = [], deps = new Map<string, string[]>();
  const sv = doc.services;
  if (!estObj(sv) || !Object.keys(sv).length) { refus('« services »', 'aucun service : il faut au moins un conteneur'); return vide(nom); }
  const noms = Object.keys(sv);
  if (noms.length > BORNES.services) refus('« services »', `trop de services (${BORNES.services} au plus dans une pile)`);
  const portsVus = new Map<string, string>();
  let reseauDefautUtilise = false;
  for (const s of noms.slice(0, BORNES.services)) {
    const q = (c?: string) => `${s}${c ? ` · ${c}` : ''}`;
    if (!NOM_SERVICE.test(s)) { refus(q(), 'nom de service invalide (minuscules, chiffres, - _, 30 caractères au plus)'); continue; }
    // (les autres conteneurs de la pile le trouvent par ce nom : jamais celui de la machine elle-même)
    if (/^(localhost|ip6-localhost|ip6-loopback)$/.test(s)) { refus(q(), 'ce nom désigne la machine elle-même : choisis-en un autre'); continue; }
    const d = sv[s];
    if (!estObj(d)) { refus(q(), 'réglages illisibles'); continue; }
    const conteneur = `${pile}-${s}`;
    if (g.conteneurs?.includes(conteneur)) refus(q(), `un conteneur « ${conteneur} » existe déjà`);
    const sp: ServicePile = { service: s, conteneur, image: '', env: {}, ports: [], montages: [], restart: 'non', memory: '', reseau: null, depend: [] };
    const texteDe = (c: string, v: Val | undefined, max = 1000): string | undefined => {
      if (typeof v !== 'string') { refus(q(c), 'un texte est attendu'); return undefined; }
      if (v.length > max) { refus(q(c), 'trop long'); return undefined; }
      const x = sansVariable(v); if (x === null) { refus(q(`${c}: ${v.slice(0, 40)}`), TEXTES_K3.refuseVariablePC); return undefined; }
      return x;
    };
    const commande = (c: string, v: Val | undefined): string[] | undefined => {
      if (typeof v === 'string') { const t = texteDe(c, v, 4000); if (t === undefined) return undefined; try { return splitLine(t); } catch (e) { refus(q(c), (e as Error).message); return undefined; } }
      if (Array.isArray(v) && v.every((x) => typeof x === 'string') && v.length <= 100) { const l = v.map((x) => texteDe(c, x, 4000)); return l.every((x) => x !== undefined) ? (l as string[]) : undefined; }
      refus(q(c), 'une commande : un texte ou une liste de textes'); return undefined;
    };
    for (const [c, v] of Object.entries(d)) {
      switch (c) {
        case 'image': { const t = texteDe(c, v, 255); if (t !== undefined) { if (/^[a-z0-9][a-z0-9._/:@-]{0,254}$/i.test(t)) sp.image = t; else refus(q('image'), `nom d'image illisible « ${t.slice(0, 60)} »`); } break; }
        case 'build': refus(q('build'), TEXTES_K3.refuseConstruire); break;
        case 'command': { const x = commande(c, v); if (x) sp.cmd = x; break; }
        case 'entrypoint': { const x = commande(c, v); if (x) sp.entrypoint = x; break; }
        case 'environment': {
          const paires: Array<[string, Val]> = Array.isArray(v) ? v.map((x) => { const t = typeof x === 'string' ? x : ''; const k = t.indexOf('='); return k > 0 ? [t.slice(0, k), t.slice(k + 1)] as [string, Val] : [t, null] as [string, Val]; }) : estObj(v) ? Object.entries(v) : [];
          if (!Array.isArray(v) && !estObj(v)) { refus(q(c), 'une liste « CLE=valeur » ou un dictionnaire'); break; }
          for (const [k, x] of paires) {
            if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(k)) { refus(q(`environment · ${k.slice(0, 40)}`), 'nom de variable invalide'); continue; }
            if (x === null) { refus(q(`environment · ${k}`), TEXTES_K3.refuseVariablePC); continue; }
            if (typeof x !== 'string') { refus(q(`environment · ${k}`), 'un texte est attendu'); continue; }
            const t = sansVariable(x); if (t === null) { refus(q(`environment · ${k}`), TEXTES_K3.refuseVariablePC); continue; }
            sp.env[k] = t;
          }
          break;
        }
        case 'env_file': refus(q('env_file'), TEXTES_K3.refuseFichierPC); break;
        case 'ports': {
          if (!Array.isArray(v)) { refus(q(c), 'une liste de ports (« 8080:80 »)'); break; }
          for (const x of v) {
            let hote = 0, dedansP = 0, proto: 'tcp' | 'udp' = 'tcp', ip = '';
            if (typeof x === 'string') {
              const m = /^(?:(\[[0-9a-fA-F:.]+\]|\d{1,3}(?:\.\d{1,3}){3}):)?(\d{1,5})(?::(\d{1,5}))?(?:\/(tcp|udp))?$/.exec(x.trim());
              if (!m) { refus(q(`ports · ${x.slice(0, 40)}`), 'port illisible (« 8080:80 », « 8080:80/udp » ; pas de plage)'); continue; }
              ip = m[1] ?? ''; if (!m[3]) { refus(q(`ports · ${x}`), 'donne le port de ce PC et celui du conteneur (« 8080:80 »)'); continue; }
              hote = Number(m[2]); dedansP = Number(m[3]); proto = (m[4] as 'udp') ?? 'tcp';
            } else if (estObj(x)) {
              hote = Number(x.published); dedansP = Number(x.target); proto = x.protocol === 'udp' ? 'udp' : 'tcp'; ip = typeof x.host_ip === 'string' ? x.host_ip : '';
              if (x.protocol !== undefined && x.protocol !== 'tcp' && x.protocol !== 'udp') { refus(q('ports'), `protocole « ${montre(x.protocol)} » inconnu`); continue; }
            } else { refus(q('ports'), 'port illisible'); continue; }
            if (ip) { refus(q(`ports · ${montre(x)}`), 'une adresse d\'écoute n\'est pas encore prise en compte (le port serait ouvert sur toutes les adresses) : retire-la'); continue; }
            if (!(hote >= 1 && hote <= 65535 && dedansP >= 1 && dedansP <= 65535)) { refus(q(`ports · ${montre(x)}`), 'port hors de 1 à 65535'); continue; }
            const cle = `${hote}/${proto}`;
            if (portsVus.has(cle)) { refus(q(`ports · ${hote}`), `déjà demandé par ${portsVus.get(cle)}`); continue; }
            const qui = g.portsPris?.get(hote); if (qui) { refus(q(`ports · ${hote}`), `déjà pris sur ce PC (${qui})`); continue; }
            portsVus.set(cle, s); sp.ports.push({ host: hote, inner: dedansP, proto });
          }
          break;
        }
        case 'volumes': {
          if (!Array.isArray(v)) { refus(q(c), 'une liste (« nom:/dossier » ou « /chemin:/dossier »)'); break; }
          for (const x of v) {
            let src = '', dst = '', ro = false, type = '';
            if (typeof x === 'string') {
              const p = x.split(':');
              if (p.length === 1) { refus(q(`volumes · ${x.slice(0, 40)}`), 'un volume sans nom : donne-lui un nom (« nom:/dossier »)'); continue; }
              if (p.length > 3 || (p[2] !== undefined && !/^(ro|rw|z|Z|ro,z|ro,Z|rw,z|rw,Z)$/.test(p[2]))) { refus(q(`volumes · ${x.slice(0, 60)}`), /^[A-Za-z]$/.test(p[0]) ? 'un chemin de Windows : le moteur ne voit que des chemins de Linux' : 'illisible (« nom:/dossier[:ro] »)'); continue; }
              [src, dst] = [p[0], p[1]]; ro = /^ro/.test(p[2] ?? ''); type = /^[/.~]/.test(src) || src.includes('/') ? 'bind' : 'volume';
            } else if (estObj(x)) {
              type = String(x.type ?? ''); src = typeof x.source === 'string' ? x.source : ''; dst = typeof x.target === 'string' ? x.target : ''; ro = vrai(x.read_only);
              // « read_only: 1 » ou « oui » : jamais deviné (le dossier serait donné en écriture sans qu'on le sache)
              if (x.read_only !== undefined && !ro && !faux(x.read_only)) { refus(q(`volumes · read_only: ${montre(x.read_only)}`), 'écris « true » ou « false »'); continue; }
              if (!['bind', 'volume'].includes(type)) { refus(q(`volumes · ${type || '?'}`), type === 'tmpfs' ? 'pas encore (un dossier en mémoire)' : 'seuls « volume » et « bind »'); continue; }
              if (!src) { refus(q('volumes'), 'un volume sans nom : donne-lui un nom'); continue; }
            } else { refus(q('volumes'), 'illisible'); continue; }
            const sv2 = sansVariable(src), dv = sansVariable(dst);
            if (sv2 === null || dv === null) { refus(q(`volumes · ${montre(x)}`), TEXTES_K3.refuseVariablePC); continue; }
            if (!dv.startsWith('/') || dv.split('/').includes('..') || enPosix(dv) === '/') { refus(q(`volumes · ${montre(x)}`), 'le dossier dans le conteneur doit être un chemin complet (pas « / », pas « .. »)'); continue; }
            if (type === 'bind') {
              const r = pourquoiRefuserDossier(sv2, g);
              if (r) { refus(`${q('volumes')} · « ${montre(x)} »`, r); continue; }
              sp.montages.push({ host: enPosix(sv2), inner: dv, ro });
              change(q('volumes'), `« ${enPosix(sv2)} » : un dossier de ce PC, que le conteneur ${ro ? 'lit seulement' : 'peut changer'} ; il n'est jamais effacé avec la pile`);
            } else {
              const nv = volNom.get(sv2);
              if (!nv) { refus(q(`volumes · ${sv2}`), NOM_OBJET.test(sv2) ? 'volume non déclaré dans « volumes: » en bas du fichier' : 'nom de volume invalide'); continue; }
              sp.montages.push({ volume: nv, inner: dv, ro });
            }
          }
          break;
        }
        case 'networks': {
          const l = Array.isArray(v) ? v : estObj(v) ? Object.keys(v) : null;
          if (!l || l.some((x) => typeof x !== 'string')) { refus(q(c), 'une liste de noms de réseaux'); break; }
          if (estObj(v)) for (const [k, r] of Object.entries(v)) if (estObj(r) && Object.keys(r).length) change(q(`networks · ${k}`), 'alias et adresses fixes pas pris en compte (le nom du service suffit)');
          if (l.length > 1) { refus(q(c), 'un seul réseau par conteneur pour l\'instant'); break; }
          const n = l[0] as string;
          if (n === 'default') { reseauDefautUtilise = true; sp.reseau = resNom.get('default') ?? `pile-${pile}`; break; }
          if (!resNom.has(n)) { refus(q(`networks · ${n}`), 'réseau non déclaré dans « networks: » en bas du fichier'); break; }
          sp.reseau = resNom.get(n)!;
          break;
        }
        case 'network_mode': {
          const m = String(v ?? '');
          if (m === 'host') refus(q('network_mode: host'), TEXTES_K3.refuseHote);
          else if (m === 'none') sp.reseau = '';
          else if (m === 'bridge' || m === 'default') { /* le réseau de la pile */ }
          else refus(q(`network_mode: ${m.slice(0, 40)}`), /^(service|container):/.test(m) ? 'partager le réseau d\'un autre conteneur n\'est pas encore possible' : TEXTES_K3.refuseInconnu);
          break;
        }
        case 'depends_on': {
          const l = Array.isArray(v) ? v : estObj(v) ? Object.keys(v) : null;
          if (!l || l.some((x) => typeof x !== 'string')) { refus(q(c), 'une liste de services'); break; }
          if (estObj(v)) for (const [k, r] of Object.entries(v)) if (estObj(r) && r.condition && r.condition !== 'service_started') change(q(`depends_on · ${k}`), `« ${montre(r.condition)} » : Odin attend que ${k} ait démarré (pas encore sa santé ni sa fin)`);
          for (const x of l as string[]) { if (!noms.includes(x)) refus(q(`depends_on · ${x}`), 'ce service n\'est pas dans le fichier'); else sp.depend.push(x); }
          break;
        }
        case 'restart': { const r = RESTART[String(v ?? '').replace(/:\d+$/, '')]; if (r) sp.restart = r; else refus(q(`restart: ${montre(v)}`), 'no, always, on-failure ou unless-stopped'); break; }
        case 'mem_limit': { const m = MEMOIRE.exec(String(v ?? '').trim()); if (m) sp.memory = `${m[1]}${(m[2] ?? '').toLowerCase()}`; else refus(q(`mem_limit: ${montre(v)}`), 'mémoire illisible (ex. 512m, 2g)'); break; }
        case 'cpus': { const n = Number(v); if (typeof v === 'string' && n > 0 && n <= 64) sp.cpus = String(n); else refus(q(`cpus: ${montre(v)}`), 'un nombre de cœurs (0.5, 2…)'); break; }
        case 'deploy': {
          if (!estObj(v)) { refus(q(c), 'illisible'); break; }
          for (const [k, x] of Object.entries(v)) {
            if (k === 'replicas') { if (String(x) !== '1') refus(q('deploy · replicas'), 'plusieurs copies : c\'est « Services mis à l\'échelle »'); continue; }
            if (k === 'resources' && estObj(x)) {
              const lim = estObj(x.limits) ? x.limits : null;
              if (lim?.memory !== undefined) { const m = MEMOIRE.exec(String(lim.memory ?? '').trim()); if (m) sp.memory ||= `${m[1]}${(m[2] ?? '').toLowerCase()}`; else refus(q('deploy · memory'), 'mémoire illisible'); }
              if (lim?.cpus !== undefined) { const n = Number(lim.cpus); if (n > 0 && n <= 64) sp.cpus ??= String(n); else refus(q('deploy · cpus'), 'un nombre de cœurs'); }
              if (estObj(x.reservations) && estObj(x.reservations.devices)) refus(q('deploy · devices'), TEXTES_K3.refusePeripherique);
              else if (Array.isArray(estObj(x.reservations) ? x.reservations.devices : undefined)) refus(q('deploy · devices'), TEXTES_K3.refusePeripherique);
              continue;
            }
            change(q(`deploy · ${k}`), 'pas pris en compte');
          }
          break;
        }
        case 'user': { const t = texteDe(c, v, 65); if (t !== undefined) { if (/^[A-Za-z0-9_.-]{1,32}(:[A-Za-z0-9_.-]{1,32})?$/.test(t)) sp.user = t; else refus(q(`user: ${t.slice(0, 40)}`), 'utilisateur illisible'); } break; }
        case 'working_dir': { const t = texteDe(c, v, 500); if (t !== undefined) { if (t.startsWith('/') && !t.split('/').includes('..')) sp.workdir = t; else refus(q(`working_dir: ${t.slice(0, 40)}`), 'un chemin complet dans le conteneur'); } break; }
        case 'hostname': { const t = texteDe(c, v, 63); if (t !== undefined) { if (/^[a-z0-9][a-z0-9-]{0,62}$/i.test(t)) sp.hostname = t; else refus(q(`hostname: ${t.slice(0, 40)}`), 'nom de machine illisible'); } break; }
        // ---- ce qui ouvre la machine : refusé
        case 'privileged': if (!faux(v)) refus(q(`privileged: ${montre(v)}`), TEXTES_K3.refusePrivilege); break;
        case 'pid': if (v !== null) refus(q(`pid: ${montre(v)}`), String(v) === 'host' ? TEXTES_K3.refusePid : 'partager les processus d\'un autre conteneur n\'est pas possible'); break;
        case 'ipc': case 'uts': case 'userns_mode': case 'cgroup':
          if (String(v ?? '') === 'host' || /^(service|container):/.test(String(v ?? ''))) refus(q(`${c}: ${montre(v)}`), TEXTES_K3.refuseEspace);
          else change(q(`${c}: ${montre(v)}`), 'pas pris en compte (chaque conteneur a le sien)');
          break;
        case 'cgroup_parent': refus(q(c), TEXTES_K3.refuseEspace); break;
        case 'devices': case 'device_cgroup_rules': case 'gpus': refus(q(c), TEXTES_K3.refusePeripherique); break;
        case 'volumes_from': refus(q(c), 'prendre les dossiers d\'un autre conteneur n\'est pas possible : donne-lui les mêmes volumes par leur nom'); break;
        case 'sysctls': refus(q(c), 'changer les réglages du noyau depuis un conteneur est refusé'); break;
        case 'cap_add': {
          const l = Array.isArray(v) ? v : [v];
          for (const x of l) {
            const cap = String(x ?? '').toUpperCase().replace(/^CAP_/, '');
            if (!CAPACITES_SURES.has(cap)) refus(q(`cap_add: ${cap.slice(0, 30)}`), TEXTES_K3.refuseCapacite);
            else change(q(`cap_add: ${cap}`), 'pas prise en compte : le conteneur garde les droits habituels du moteur');
          }
          break;
        }
        case 'security_opt': {
          for (const x of Array.isArray(v) ? v : [v]) {
            const t = String(x ?? '');
            if (/unconfined|label[:=]disable|no-new-privileges[:=]false|systempaths[:=]unconfined/i.test(t)) refus(q(`security_opt: ${t.slice(0, 40)}`), 'retirer une protection du conteneur est refusé');
            else change(q(`security_opt: ${t.slice(0, 40)}`), 'pas pris en compte');
          }
          break;
        }
        case 'extends': refus(q(c), 'lirait un autre fichier ou un autre service : écris ses réglages ici'); break;
        case 'secrets': case 'configs': refus(q(c), 'pas encore : écris ces valeurs dans « environment »'); break;
        case 'profiles': refus(q(c), 'pas encore : retire les services que tu ne veux pas'); break;
        case 'scale': if (String(v) !== '1') refus(q(c), 'plusieurs copies : c\'est « Services mis à l\'échelle »'); break;
        case 'links': change(q(c), 'pas besoin : les services se trouvent par leur nom'); break;
        default:
          if (IGNOREES.has(c) || c.startsWith('x-')) change(q(c), c === 'container_name' ? `Odin le nomme « ${conteneur} »` : c === 'read_only' || c === 'cap_drop' ? 'pas pris en compte : le conteneur garde les droits habituels du moteur' : 'pas pris en compte');
          else refus(q(c), TEXTES_K3.refuseInconnu);
      }
    }
    if (!sp.image && !Object.prototype.hasOwnProperty.call(d, 'build')) refus(q('image'), 'il faut une image');
    // (le moteur le refuserait au milieu du déploiement : dit avant)
    if (sp.reseau === '' && sp.ports.length) refus(q('ports'), 'réseau « aucun » : aucun port ne peut être ouvert');
    if (!sp.memory) { sp.memory = TEXTES_K3.memoireParDefaut; change(q('mémoire'), `pas de limite de mémoire : Odin met 512 Mo (changeable dans Ressources)`); }
    if (sp.reseau === null) { reseauDefautUtilise = true; sp.reseau = resNom.get('default') ?? `pile-${pile}`; }
    deps.set(s, sp.depend); services.push(sp);
  }
  if (reseauDefautUtilise && !resNom.has('default')) {
    const n = `pile-${pile}`;
    if (g.reseaux?.includes(n)) refus('Réseau de la pile', `un réseau « ${n} » existe déjà (une ancienne pile ?) : retire-le d'abord dans Réseaux`);
    else reseaux.unshift({ nom: n, internet: true, externe: false });
  }
  // ---- l'ordre de démarrage
  let ordre: string[] = [];
  try { ordre = ordreDemarrage(deps); } catch (e) { refus('Dépendances', (e as Error).message); }
  // ---- le résumé de ce qui est accepté
  const lesRefus = constats.filter((c) => c.ton === 'refus');
  if (services.length) {
    const ap = (x: ServicePile) => (x.depend.length ? `${x.service} (attend ${x.depend.join(', ')})` : x.service);
    const parNom = new Map(services.map((x) => [x.service, x]));
    constats.unshift({ ton: 'ok', quoi: `${services.length} conteneur${services.length > 1 ? 's' : ''}`, texte: (ordre.length ? ordre : services.map((x) => x.service)).map((n) => ap(parNom.get(n)!)).join(', puis ') });
    const vs = volumes.filter((v) => services.some((x) => x.montages.some((m) => m.volume === v.nom)));
    if (vs.length) constats.splice(1, 0, { ton: 'ok', quoi: `${vs.length} volume${vs.length > 1 ? 's' : ''}`, texte: vs.map((v) => `${v.nom}${v.externe ? ' (déjà là, gardé)' : ' (créé pour la pile)'}`).join(', ') });
    const ps = services.flatMap((x) => x.ports);
    if (ps.length) constats.splice(vs.length ? 2 : 1, 0, { ton: 'ok', quoi: `Port${ps.length > 1 ? 's' : ''} ${ps.map((p) => p.host).join(', ')}`, texte: 'libres sur ce PC' });
    const rs = reseaux.filter((r) => services.some((x) => x.reseau === r.nom));
    if (rs.length) constats.splice(1 + (vs.length ? 1 : 0) + (ps.length ? 1 : 0), 0, { ton: 'ok', quoi: `Réseau${rs.length > 1 ? 'x' : ''}`, texte: rs.map((r) => `${r.nom} (à part${r.internet ? '' : ', sans Internet'})`).join(', ') });
  }
  return { nom, ok: lesRefus.length === 0 && services.length > 0, services, ordre, volumes, reseaux, constats, refus: lesRefus.map((c) => `${c.quoi} : ${c.texte}`) };
}

// =================================================================================================================
// 3. Les piles chez le moteur
// =================================================================================================================
/** Une pile enregistrée : ce qui la compose, et ce qu'elle a créé elle-même (ses dossiers à elle). */
export interface Pile {
  nom: string; cree: string; fichier: string; ordre: string[];
  services: Array<{ service: string; conteneur: string; image: string }>;
  volumesPropres: string[]; reseauxPropres: string[]; volumes: string[]; reseaux: string[];
}
export type MoteurPile = Pick<Engine, 'ps' | 'find' | 'create' | 'start' | 'stop' | 'rm' | 'findImage' | 'pull' | 'createVolume' | 'createReseau' | 'rmReseau' | 'rmVolume' | 'utilisateursVolume' | 'reseaux' | 'volumes'> & { store: { dir: string; volumes(): Array<{ nom: string }>; reseaux(): Array<{ nom: string }> } };
const dossierPiles = (e: MoteurPile) => join(e.store.dir, 'piles');
const fichierPile = (e: MoteurPile, nom: string) => { if (!NOM_PILE.test(nom)) throw new Error(`nom de pile invalide : ${nom.slice(0, 40)}`); return join(dossierPiles(e), `${nom}.json`); };
export function piles(e: MoteurPile): Pile[] {
  let l: string[] = []; try { l = readdirSync(dossierPiles(e)); } catch { return []; }
  return l.filter((f) => /\.json$/.test(f) && NOM_PILE.test(f.slice(0, -5))).map((f) => pile(e, f.slice(0, -5))).filter((p): p is Pile => !!p).sort((a, b) => a.nom.localeCompare(b.nom));
}
export function pile(e: MoteurPile, nom: string): Pile | undefined {
  try { const p = JSON.parse(readFileSync(fichierPile(e, nom), 'utf8')) as Pile; return p && p.nom === nom && Array.isArray(p.ordre) && Array.isArray(p.services) ? p : undefined; } catch { return undefined; }
}
function enregistrer(e: MoteurPile, p: Pile): void {
  mkdirSync(dossierPiles(e), { recursive: true, mode: 0o700 });
  const f = fichierPile(e, p.nom), t = `${f}.${process.pid}.tmp`; writeFileSync(t, JSON.stringify(p, null, 1), { mode: 0o600 }); renameSync(t, f);
}
/** Les conteneurs d'une pile, dans son ordre de démarrage (ceux qui manquent sont sautés). Un conteneur qui porte le
 *  même nom mais n'est pas de cette pile (créé à part après coup) n'en fait jamais partie : ni démarré, ni supprimé. */
export function conteneursDe(e: MoteurPile, p: Pile): Ctr[] {
  const tous = e.ps(true);
  return p.ordre.map((s) => p.services.find((x) => x.service === s)?.conteneur).map((n) => tous.find((c) => c.spec.name === n && c.spec.labels?.['odin.pile'] === p.nom)).filter((c): c is Ctr => !!c);
}
export type Etape = (texte: string, fait: number, total: number) => void;
/**
 * Déploie une pile analysée SANS aucun refus : enregistre la pile d'abord (une coupure laisse une pile qu'on peut
 * supprimer), crée son réseau et ses volumes s'ils manquent (ceux-là sont « à elle »), récupère les images qui
 * manquent, crée les conteneurs, puis les démarre dans l'ordre. Un démarrage qui échoue s'arrête là (les suivants
 * restent créés, arrêtés) et le dit.
 */
export async function deployerPile(e: MoteurPile, a: Analyse, fichier: string, etape: Etape = () => {}): Promise<Pile> {
  if (!a.ok || a.refus.length) throw new Error(`pile refusée : ${a.refus[0] ?? 'rien à déployer'}`);
  if (pile(e, a.nom)) throw new Error(`une pile « ${a.nom} » existe déjà`);
  const avantV = new Set(e.store.volumes().map((v) => v.nom)), avantR = new Set(e.store.reseaux().map((r) => r.nom));
  const p: Pile = { nom: a.nom, cree: new Date().toISOString(), fichier: fichier.slice(0, BORNES.octets), ordre: a.ordre, services: a.services.map((s) => ({ service: s.service, conteneur: s.conteneur, image: s.image })), volumesPropres: [], reseauxPropres: [], volumes: a.volumes.map((v) => v.nom), reseaux: a.reseaux.map((r) => r.nom) };
  enregistrer(e, p);
  const total = a.services.length * 3 + 1; let fait = 0;
  for (const r of a.reseaux) if (!avantR.has(r.nom) && a.services.some((s) => s.reseau === r.nom)) { e.createReseau(r.nom, { internet: r.internet }); p.reseauxPropres.push(r.nom); }
  for (const v of a.volumes) if (!avantV.has(v.nom) && a.services.some((s) => s.montages.some((m) => m.volume === v.nom))) { e.createVolume(v.nom, true); p.volumesPropres.push(v.nom); }
  enregistrer(e, p); etape('réseau et volumes prêts', ++fait, total);
  for (const s of a.services) { if (!e.findImage(s.image)) { etape(`récupérer ${s.image}`, fait, total); await e.pull(s.image); } etape(`image de ${s.service} prête`, ++fait, total); }
  const parNom = new Map(a.services.map((s) => [s.service, s]));
  for (const n of a.ordre) {
    const s = parNom.get(n)!;
    await e.create({
      image: s.image, name: s.conteneur, cmd: s.cmd, entrypoint: s.entrypoint, env: s.env, ports: s.ports, restart: s.restart, memory: s.memory, cpus: s.cpus, user: s.user, workdir: s.workdir, hostname: s.hostname ?? s.service,
      mounts: s.montages.map((m): Mount => (m.volume ? { host: m.volume, inner: m.inner, ro: m.ro, volume: m.volume } : { host: m.host!, inner: m.inner, ro: m.ro })),
      network: s.reseau === '' ? 'aucun' : 'pont', reseau: s.reseau || undefined, labels: { 'odin.pile': a.nom, 'odin.pile.service': s.service },
    });
    etape(`${s.conteneur} créé`, ++fait, total);
  }
  for (const n of a.ordre) { const s = parNom.get(n)!; etape(`démarrer ${s.conteneur}`, fait, total); await e.start(s.conteneur); etape(`${s.conteneur} en marche`, ++fait, total); }
  return p;
}
/** Démarre ce qui ne tourne pas, dans l'ordre (chacun après ceux dont il dépend). */
export async function demarrerPile(e: MoteurPile, nom: string): Promise<string[]> {
  const p = pile(e, nom); if (!p) throw new Error(`pile inconnue : ${nom.slice(0, 40)}`);
  const fait: string[] = [];
  for (const c of conteneursDe(e, p)) if (c.state.status !== 'en marche') { await e.start(c.spec.name); fait.push(c.spec.name); }
  return fait;
}
/** Arrête tout, dans l'ordre inverse (ceux qui dépendent des autres d'abord). */
export async function arreterPile(e: MoteurPile, nom: string): Promise<string[]> {
  const p = pile(e, nom); if (!p) throw new Error(`pile inconnue : ${nom.slice(0, 40)}`);
  const fait: string[] = [];
  for (const c of conteneursDe(e, p).reverse()) if (c.state.status === 'en marche' || c.state.status === 'redémarre') { await e.stop(c.spec.name); fait.push(c.spec.name); }
  return fait;
}
/**
 * Supprime une pile : ses conteneurs (arrêtés d'abord, dans l'ordre inverse) et le réseau qu'elle a créé s'il ne sert
 * plus. Ses volumes sont GARDÉS ; avec `effacerVolumes`, seuls SES dossiers partent : les volumes qu'elle a créés,
 * dont plus aucun autre conteneur ne se sert, vérifiés par `garde` (jamais un dossier du système, personnel, d'Odin).
 * Un volume qui était là avant elle, ou un dossier de ce PC, n'est jamais effacé.
 */
export async function supprimerPile(e: MoteurPile, nom: string, o: { effacerVolumes?: boolean; garde?: (reel: string) => string | undefined } = {}): Promise<{ conteneurs: string[]; volumesEffaces: string[]; volumesGardes: Array<{ nom: string; raison: string }>; reseauxRetires: string[] }> {
  const p = pile(e, nom); if (!p) throw new Error(`pile inconnue : ${nom.slice(0, 40)}`);
  const conteneurs: string[] = [];
  for (const c of conteneursDe(e, p).reverse()) { await e.rm(c.spec.name, true); conteneurs.push(c.spec.name); }
  const reseauxRetires: string[] = [];
  for (const r of p.reseauxPropres) {
    const u = e.reseaux().find((x) => x.nom === r)?.conteneurs ?? [];
    if (!u.length && e.store.reseaux().some((x) => x.nom === r)) { try { await e.rmReseau(r); reseauxRetires.push(r); } catch { /* gardé, dit plus bas par son absence */ } }
  }
  const volumesEffaces: string[] = [], volumesGardes: Array<{ nom: string; raison: string }> = [];
  for (const v of p.volumes) {
    if (!o.effacerVolumes) { volumesGardes.push({ nom: v, raison: 'gardé (choix par défaut)' }); continue; }
    if (!p.volumesPropres.includes(v)) { volumesGardes.push({ nom: v, raison: 'il était là avant la pile' }); continue; }
    if (!e.store.volumes().some((x) => x.nom === v)) continue;
    const u = e.utilisateursVolume(v); if (u.length) { volumesGardes.push({ nom: v, raison: `sert encore à ${u.join(', ')}` }); continue; }
    try { e.rmVolume(v, o.garde); volumesEffaces.push(v); } catch (er) { volumesGardes.push({ nom: v, raison: (er as Error).message.slice(0, 200) }); }
  }
  rmSync(fichierPile(e, nom), { force: true });
  return { conteneurs, volumesEffaces, volumesGardes, reseauxRetires };
}
/** Le vrai chemin d'un dossier qui existe (liens suivis), sous Linux ; sinon rien. */
export const vraiCheminLinux = (p: string): string | undefined => { if (process.platform === 'win32' || !existsSync(p)) return undefined; try { return realpathSync.native(p); } catch { return undefined; } };
