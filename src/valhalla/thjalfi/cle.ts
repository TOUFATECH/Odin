// Genèse · le mot de passe d'installation : le poste doit le donner avant d'avoir le menu des systèmes et les
// fichiers d'installation.
//   - Odin ne garde que son empreinte (scrypt, sel aléatoire), jamais le mot de passe ; rien dans le menu, les
//     journaux, les événements ni les alertes.
//   - Les essais sont comptés par poste (adresse MAC + adresse IP) et par adresse IP AVANT tout calcul : 5 erreurs
//     = poste bloqué 15 minutes, puis 1 h, puis 24 h s'il recommence ; au-delà de 10 refus en une heure (tous
//     postes confondus), Odin prévient et ralentit tous les essais.
//   - Un bon mot de passe donne un laissez-passer court, lié au poste (MAC + adresse IP), gardé en mémoire.
//   - iPXE lit le clavier comme un clavier américain : un mot de passe tapé sur un clavier AZERTY arrive
//     transformé (a ↔ q, z ↔ w, chiffres…). Odin garde une deuxième empreinte pour cette forme-là.
// Limite connue : le mot de passe voyage en clair sur le réseau local (iPXE officiel n'a pas HTTPS).
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** Le coût scrypt des nouvelles empreintes (64 Mo par calcul, comme le compte d'Odin). Les essais le réduisent. */
export const COUT = { N: 65536 };
const LONGUEUR = 32;
export const ESSAIS_MAX = 5;
export const ESSAIS_MAX_IP = 20;
export const VERROU_MS = 15 * 60_000;
/** Le laissez-passer : 20 min sans rien charger et il tombe ; jamais plus de 6 h. */
export const PASSE_MS = 20 * 60_000;
export const PASSE_MAX_MS = 6 * 3600_000;

export interface Empreinte { algo: 'scrypt'; N: number; r: number; p: number; salt: string; hash: string; /** la forme « tapé sur un clavier AZERTY » (même sel) */ hash2?: string }
/** Ce qui est rangé dans secrets.json (clé « cle ») : l'empreinte, jamais le mot de passe. */
export interface CleSecret { e: Empreinte; depuis: number }
export type Pour = 'toutes' | 'inconnus';

function deriver(mdp: string, sel: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((ok, ko) => scrypt(mdp.normalize('NFKC'), sel, LONGUEUR, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 }, (e, k) => (e ? ko(e) : ok(k))));
}
/** Un seul calcul à la fois (chacun prend de la mémoire) : les autres attendent leur tour. */
let file: Promise<unknown> = Promise.resolve();
const aSonTour = <T,>(f: () => Promise<T>): Promise<T> => { const p = file.then(f, f); file = p.catch(() => undefined); return p; };

// Clavier AZERTY (français) lu comme un clavier américain : la touche compte, pas la lettre gravée dessus.
const AZERTY = 'azqwAZQWm,;:!M?./§&é"\'(-è_çà)1234567890ù%*µ^$£¨²';
const QWERTY = 'qwazQWAZ;m,./:M<>?1234567890-!@#$%^&*()\'"\\|[]}{`';
/** Ce que reçoit iPXE quand ce mot de passe est tapé sur un clavier AZERTY. Pur. */
export function tapeEnAzerty(mdp: string): string {
  let out = '';
  for (const c of mdp) { const i = AZERTY.indexOf(c); out += i >= 0 ? QWERTY[i] : c; }
  return out;
}
export const LONGUEUR_MIN = 10;
// Les mots de passe que tout le monde essaie d'abord (comparés sans majuscules).
const COURANTS = new Set(['motdepasse1', 'motdepasse12', 'motdepasse123', 'mot de passe', 'password12', 'password123', 'password1234', 'passw0rd123', 'azertyuiop', 'azertyuiop1', 'azertyuiop123', 'azerty1234', 'azerty12345', 'azerty123456', 'qwertyuiop', 'qwertyuiop1', 'qwerty1234', 'qwerty12345', 'qwerty123456', '1q2w3e4r5t', '1q2w3e4r5t6y', 'aqwzsxedcrfv', '1a2z3e4r5t', '1a2z3e4r5t6y', 'administrateur', 'administrator', 'admin12345', 'admin123456', 'bonjour123', 'bonjour1234', 'soleil1234', 'jetaime123', 'iloveyou123', 'changeme123', 'letmein123', 'welcome123', 'bienvenue1', 'bienvenue123', 'installation', 'installation1', 'odin123456', 'genese1234', 'toufatech1', 'toufatech123', 'abcdefghij', 'abcdef123456', 'abcd123456', 'abc1234567', 'football123', 'marseille13', 'doudou1234', 'loulou1234', 'nicolas123', 'camille123']);
/** Le mot de passe choisi est-il acceptable ? Rend la raison du refus, ou rien. Pur. */
export function refusMotDePasse(mdp: string): string | undefined {
  if (mdp.length < LONGUEUR_MIN) return `mot de passe trop court (${LONGUEUR_MIN} caractères au moins)`;
  const bas = mdp.toLowerCase();
  if (COURANTS.has(bas) || /^(.)\1+$/.test(bas) || /^(.{1,4})\1+$/.test(bas) || '0123456789012345678901234567890'.includes(bas) || '9876543210987654321098765432109'.includes(bas) || /^(azerty|qwerty|motdepasse|password|admin|odin|genese|pxe)[\d\s!.@#*_-]*$/.test(bas)) return 'mot de passe trop courant (il serait essayé en premier) : choisis-en un autre';
  if (mdp.length > 64) return 'mot de passe trop long (64 caractères au plus)';
  if (/[\u0000-\u001f\u007f]/.test(mdp)) return 'le mot de passe ne doit pas contenir de caractère invisible';
  if (/^\s|\s$/.test(mdp)) return 'pas d\'espace au début ni à la fin du mot de passe';
  return undefined;
}

/** L'empreinte d'un nouveau mot de passe (et de sa forme « clavier AZERTY »). */
export async function empreinte(mdp: string, N = COUT.N): Promise<Empreinte> {
  const sel = randomBytes(16), alt = tapeEnAzerty(mdp);
  const h = await aSonTour(() => deriver(mdp, sel, N, 8, 1));
  const h2 = alt === mdp ? undefined : await aSonTour(() => deriver(alt, sel, N, 8, 1));
  return { algo: 'scrypt', N, r: 8, p: 1, salt: sel.toString('base64'), hash: h.toString('base64'), ...(h2 ? { hash2: h2.toString('base64') } : {}) };
}
/** Le mot de passe reçu est-il le bon ? Un seul calcul, comparé aux deux formes, en temps constant. */
export async function verifier(mdp: string, e: Empreinte | undefined): Promise<boolean> {
  const ref = e ?? { algo: 'scrypt' as const, N: COUT.N, r: 8, p: 1, salt: 'b2Rpbi1nZW5lc2Utc2VsLWZhY3RpY2U=', hash: '' };
  const k = await aSonTour(() => deriver(String(mdp).slice(0, 200), Buffer.from(ref.salt, 'base64'), ref.N, ref.r, ref.p));
  let ok = false;
  for (const h of [ref.hash, ref.hash2]) { if (!h) continue; const w = Buffer.from(h, 'base64'); if (w.length === k.length && timingSafeEqual(w, k)) ok = true; }
  return Boolean(e) && ok;
}

/** Les blocages qui s'allongent : le premier dure 15 min, le deuxième 1 h, les suivants 24 h. */
export const VERROUS_MS = [VERROU_MS, 3600_000, 24 * 3600_000];
/** Quand des mots de passe faux arrivent en nombre, chaque essai attend son tour (un toutes les 3 s). Les essais le mettent à 0. */
export const RALENTI = { ms: 3000 };
/** Les essais ratés, par poste et par adresse : en mémoire (repartent de zéro si Odin redémarre). */
export class Essais {
  private m = new Map<string, { n: number; dernier: number; verrou?: number; fois?: number }>();
  /** Bloqué jusqu'à quand (ms) ? Rien si le poste peut essayer. */
  verrou(cle: string, now: number): number | undefined { const x = this.m.get(cle); return x?.verrou && x.verrou > now ? x.verrou : undefined; }
  /**
   * Note une erreur ; rend le nombre d'erreurs et, si la limite est atteinte, la fin du blocage. Le compte ne retombe
   * qu'après `calme` SANS erreur (pas à heure fixe : attendre entre deux séries ne sert à rien), et un blocage qui
   * revient dans les 24 h dure plus longtemps.
   */
  rate(cle: string, now: number, max = ESSAIS_MAX, calme = VERROU_MS): { n: number; verrou?: number } {
    let x = this.m.get(cle);
    if (x && now - x.dernier > 24 * 3600_000) x = undefined;
    if (!x) x = { n: 0, dernier: now };
    else if (now - x.dernier > calme || (x.verrou && x.verrou <= now)) { x.n = 0; delete x.verrou; }
    x.n++; x.dernier = now;
    if (x.n >= max) { x.fois = (x.fois ?? 0) + 1; x.verrou = now + VERROUS_MS[Math.min(x.fois, VERROUS_MS.length) - 1]; }
    this.m.delete(cle); this.m.set(cle, x);
    while (this.m.size > 5000) this.m.delete(this.m.keys().next().value!);
    return { n: x.n, verrou: x.verrou };
  }
  bon(cle: string): void { this.m.delete(cle); }
  /** Les postes bloqués en ce moment (pour la page). */
  verrous(now: number): Array<{ cle: string; jusqua: number }> { return [...this.m].filter(([, x]) => x.verrou && x.verrou > now).map(([cle, x]) => ({ cle, jusqua: x.verrou! })); }
}

export interface Passe { mac: string; /** les adresses IP d'où ce poste a parlé (la première : celle d'où il a donné le mot de passe) */ ips: string[]; qui?: string; cree: number; jusqua: number }
/** Les laissez-passer : un par poste, en mémoire. */
export class Passes {
  private m = new Map<string, Passe>();
  donner(mac: string, ip: string, qui: string | undefined, now: number): Passe { const p: Passe = { mac, ips: [ip], ...(qui ? { qui } : {}), cree: now, jusqua: now + PASSE_MS }; this.m.set(mac, p); return p; }
  private vivant(p: Passe | undefined, now: number): Passe | undefined { if (!p) return undefined; if (p.jusqua <= now || now - p.cree > PASSE_MAX_MS) { this.m.delete(p.mac); return undefined; } return p; }
  /** Le laissez-passer de ce poste, s'il est encore valable. */
  de(mac: string, now: number): Passe | undefined { return this.vivant(this.m.get(mac), now); }
  /** Un laissez-passer valable pour cette adresse (fichiers demandés sans adresse MAC). */
  parIp(ip: string, now: number): Passe | undefined { for (const p of [...this.m.values()]) if (p.ips.includes(ip) && this.vivant(p, now)) return p; return undefined; }
  /** Le poste charge quelque chose : son laissez-passer est prolongé. */
  prolonger(p: Passe, now: number): void { p.jusqua = Math.min(now + PASSE_MS, p.cree + PASSE_MAX_MS); }
  retirer(mac: string): void { this.m.delete(mac); }
  vider(): void { this.m.clear(); }
  liste(now: number): Passe[] { return [...this.m.values()].filter((p) => this.vivant(p, now)); }
}

// ---------------- Les scripts iPXE (purs) ----------------
// Rien de ce que dit le poste (nom, série, modèle…) n'est recopié ici : seulement l'adresse MAC déjà nettoyée.
const DISQUE = [':local', 'echo Demarrage sur le disque...', 'iseq ${platform} efi && exit 1 ||', 'sanboot --no-describe --drive 0x80 || exit 1'];
const macSure = (mac: string) => (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac) ? mac : '');

/** Le menu fermé : le disque du poste (par défaut), ou « installer » qui demande le mot de passe. Pur. */
export function menuFerme(o: { base: string; mac: string; delai: number; look?: string[] }): string {
  const mac = macSure(o.mac), hote = /^https?:\/\/([^/]+)/.exec(o.base)?.[1] ?? '';
  return [
    '#!ipxe', `# Odin · Genèse — menu protégé — ${mac}`, `set base ${o.base}`, ...(o.look ?? []),
    `menu ODIN - Installation protegee par un mot de passe (${mac})`,
    'item local Demarrer sur le disque de cette machine',
    'item cle Installer un systeme (mot de passe demande)',
    `choose --default local --timeout ${Math.max(0, Math.round(o.delai * 1000))} sel || goto local`, 'goto ${sel}', '',
    ':cle', 'echo', 'echo Nom : qui installe ce poste. Mot de passe : celui des installations (regle dans Odin).', 'echo Clavier lu comme un clavier americain : tape normalement, Odin reconnait un AZERTY.',
    'login || goto local',
    // Le mot de passe part dans le corps de la demande (POST), jamais dans l'adresse.
    'params || goto basique', 'param mdp ${password} ||', 'param qui ${username} ||',
    `chain \${base}/cle.ipxe?mac=${mac}&fw=\${platform}##params || goto refus`, 'goto local', '',
    // iPXE sans la commande « params » : identification HTTP simple (en-tête, jamais dans l'adresse).
    ':basique', `chain http://odin:\${password:uristring}@${hote}/cle.ipxe?mac=${mac}&fw=\${platform} || goto refus`, 'goto local', '',
    ':refus', 'clear password ||', 'clear username ||', 'echo Odin n\'a pas pu verifier le mot de passe.', 'sleep 4', '',
    ...DISQUE, '',
  ].join('\n');
}
/** Après un bon mot de passe : le poste oublie ce qu'il a tapé et reprend le menu (ouvert, cette fois). Pur. */
export function scriptAccepte(o: { base: string; mac: string; fw: string }): string {
  const fw = o.fw.replace(/[^\w-]/g, '').slice(0, 12) || '${platform}';
  return ['#!ipxe', 'clear password ||', 'clear username ||', 'echo Mot de passe accepte.', `chain ${o.base}/menu.ipxe?mac=${macSure(o.mac)}&fw=${fw} || goto local`, ...DISQUE, ''].join('\n');
}
/** Après un mauvais mot de passe : essais restants, puis retour au menu fermé ; poste bloqué : son disque. Pur. */
export function scriptRefuse(o: { base: string; mac: string; fw: string; essai?: number; minutes?: number }): string {
  const fw = o.fw.replace(/[^\w-]/g, '').slice(0, 12) || '${platform}', tete = ['#!ipxe', 'clear password ||', 'clear username ||'];
  if (o.minutes !== undefined) { const mn = Math.max(1, Math.round(o.minutes)); return [...tete, `echo Trop d'essais : ce poste est bloque ${mn >= 120 ? `${Math.round(mn / 60)} h` : `${mn} min`}. Odin a prevenu le proprietaire.`, 'sleep 8', 'goto local', ...DISQUE, ''].join('\n'); }
  return [...tete, `echo Mot de passe refuse${o.essai ? ` (essai ${o.essai} sur ${ESSAIS_MAX})` : ''}.`, 'sleep 3', `chain ${o.base}/menu.ipxe?mac=${macSure(o.mac)}&fw=${fw} || goto local`, ...DISQUE, ''].join('\n');
}
/** Un poste refusé (bloqué, installations suspendues) : un message clair, puis TOUJOURS son propre disque. Pur. */
export function scriptRefus(lignes: string[]): string {
  return ['#!ipxe', '# Odin · Genèse — refus', 'echo', ...lignes.map((l) => `echo ${l.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .,:()'-]/g, ' ').replace(/\s+/g, ' ').trim()}`), 'echo', 'sleep 8', 'goto local', ...DISQUE, ''].join('\n');
}
