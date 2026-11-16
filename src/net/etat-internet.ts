// Odin — état d'Internet partagé.
//
// Une seule sonde pour tout Odin : elle dit à tout moment si Odin a Internet, et pourquoi pas.
// Avant, chaque appli devinait depuis un échec de requête (météo qui disparaît sans un mot,
// « fetch failed » montré tel quel…). Ici l'état est calculé une fois, puis poussé dans /api/state
// pour que chaque page explique proprement ce qui manque.
//
// Quatre états possibles (voir sonder()) :
//  - 'sans-reseau'           : pas de réseau du tout (passerelle locale injoignable) ;
//  - 'reseau-sans-internet'  : réseau local présent, mais Internet ne répond pas ;
//  - 'dns-muet'              : le nom ne résout plus, mais une adresse littérale passe (DNS en panne) ;
//  - 'en-ligne'              : Internet répond.
//
// Rien ici ne coupe le réseau de la machine ; les sondes sont injectables pour les essais.

/** Les quatre états du réseau, du plus grave au plus sain. */
export type EtatReseau = 'sans-reseau' | 'reseau-sans-internet' | 'dns-muet' | 'en-ligne';

/** État d'un service extérieur donné (ex. api.open-meteo.com), tenu au fil des vraies requêtes des applis. */
export type EtatService = 'ok' | 'muet' | 'lent' | 'refus' | 'limite';

export interface ServiceInfo {
  etat: EtatService;
  /** ms epoch : depuis quand le service est dans cet état. */
  depuis: number;
  /** ms epoch : dernière fois qu'on a eu des nouvelles de ce service. */
  dernier: number;
  /** Raison courte, en français (« ne répond pas depuis 10 min »…). */
  motif?: string;
}

/** Instantané complet, tel qu'il part dans /api/state sous `internet`. */
export interface EtatInternet {
  reseau: EtatReseau;
  /** ms epoch : début de l'état réseau courant (« depuis quand »). */
  depuis: number;
  /** ms epoch : dernière sonde. */
  verifieA: number;
  /** Services extérieurs connus, par hôte. */
  services: Record<string, ServiceInfo>;
}

/** Les trois sondes élémentaires (injectables pour les essais). Chacune rend vrai si elle réussit. */
export interface Sondes {
  /** La passerelle locale (box) est-elle joignable ? `null` = on ne sait pas (on ne force alors pas « sans-reseau »). */
  passerelle(): Promise<boolean | null>;
  /** generate_204 demandé par NOM (teste aussi le DNS). */
  parNom(): Promise<boolean>;
  /** generate_204 demandé par ADRESSE littérale (sans DNS). */
  parIp(): Promise<boolean>;
}

export interface OptionsSonde {
  sondes?: Sondes;
  /** Intervalle normal entre deux sondes quand tout va bien (ms). */
  intervalleMs?: number;
  /** Attente de départ quand c'est coupé ; double à chaque échec, plafonnée. */
  minAttenteMs?: number;
  maxAttenteMs?: number;
  /** Horloge (ms epoch), injectable pour les essais. */
  maintenant?: () => number;
}

// ------------------------------------------------------------------ singleton

const auj = () => Date.now();

let courant: EtatInternet = { reseau: 'en-ligne', depuis: auj(), verifieA: 0, services: {} };
let demarree = false;
let minuterie: ReturnType<typeof setTimeout> | undefined;
let echecsDaffilee = 0;
let horloge: () => number = auj;
let cfg: Required<Omit<OptionsSonde, 'sondes' | 'maintenant'>> = { intervalleMs: 60_000, minAttenteMs: 1_000, maxAttenteMs: 60_000 };
let sondes: Sondes = sondesReseau();

const auxChangements: Array<(e: EtatInternet) => void> = [];
const auxRetours: Array<() => void> = [];

function instantane(): EtatInternet {
  return { reseau: courant.reseau, depuis: courant.depuis, verifieA: courant.verifieA, services: { ...courant.services } };
}

/** L'instantané courant (ce que la page reçoit sous `internet`). */
export function etatInternet(): EtatInternet { return instantane(); }

/** Vrai si Odin a Internet d'après la dernière sonde. */
export function enLigne(): boolean { return courant.reseau === 'en-ligne'; }

/** Rappelé à chaque changement d'état réseau (pour notify('state')). */
export function surChangement(cb: (e: EtatInternet) => void): void { auxChangements.push(cb); }

/** Rappelé une fois quand le réseau repasse à 'en-ligne' (reprises, replanifications). */
export function auRetour(cb: () => void): void { auxRetours.push(cb); }

function poserReseau(etat: EtatReseau): void {
  const t = horloge();
  courant.verifieA = t;
  if (etat === courant.reseau) return;
  const revientEnLigne = etat === 'en-ligne' && courant.reseau !== 'en-ligne';
  courant = { ...courant, reseau: etat, depuis: t };
  for (const cb of auxChangements) { try { cb(instantane()); } catch { /* un abonné ne bloque pas les autres */ } }
  if (revientEnLigne) for (const cb of auxRetours.splice(0)) { try { cb(); } catch { /* idem */ } }
}

/**
 * Note le résultat d'une vraie requête d'une appli vers un service extérieur.
 * Alimente `services` pour que le message puisse dire « Open-Meteo ne répond pas depuis 10 min ».
 */
export function marquerService(hote: string, etat: EtatService, motif?: string): void {
  if (!hote) return;
  const t = horloge(), avant = courant.services[hote];
  const depuis = avant && avant.etat === etat ? avant.depuis : t;
  courant.services = { ...courant.services, [hote]: { etat, depuis, dernier: t, ...(motif ? { motif } : {}) } };
  // Un service qui échoue alors qu'on se croit en ligne : on resonde tout de suite.
  if (etat !== 'ok' && courant.reseau === 'en-ligne' && demarree) void sonder().catch(() => {});
}

/** Classe le réseau en un des quatre états à partir des trois sondes. */
async function sonder(): Promise<EtatReseau> {
  let etat: EtatReseau;
  const passerelle = await sondes.passerelle().catch(() => null);
  if (passerelle === false) etat = 'sans-reseau';
  else if (await sondes.parNom().catch(() => false)) etat = 'en-ligne';
  else if (await sondes.parIp().catch(() => false)) etat = 'dns-muet';
  else etat = passerelle === true ? 'reseau-sans-internet' : 'reseau-sans-internet';
  poserReseau(etat);
  if (etat === 'en-ligne') echecsDaffilee = 0; else echecsDaffilee++;
  return etat;
}

/** Une sonde immédiate (utilisée par les essais et au premier échec d'une appli). */
export async function sonderMaintenant(): Promise<EtatInternet> { await sonder(); return instantane(); }

function prochainDelai(): number {
  if (courant.reseau === 'en-ligne') return cfg.intervalleMs;
  // Attente croissante plafonnée quand c'est coupé (1, 2, 4, 8 s … max).
  return Math.min(cfg.maxAttenteMs, cfg.minAttenteMs * 2 ** Math.min(echecsDaffilee, 20));
}

function planifier(): void {
  if (!demarree) return;
  minuterie = setTimeout(() => { void sonder().finally(planifier); }, prochainDelai());
  if (typeof minuterie === 'object' && 'unref' in minuterie) minuterie.unref();
}

/** Démarre la sonde partagée (singleton : un seul appel réel, les suivants n'ont pas d'effet). */
export function demarrer(opts: OptionsSonde = {}): void {
  if (opts.sondes) sondes = opts.sondes;
  if (opts.maintenant) { horloge = opts.maintenant; if (courant.depuis === 0) courant.depuis = horloge(); }
  cfg = {
    intervalleMs: opts.intervalleMs ?? cfg.intervalleMs,
    minAttenteMs: opts.minAttenteMs ?? cfg.minAttenteMs,
    maxAttenteMs: opts.maxAttenteMs ?? cfg.maxAttenteMs,
  };
  if (demarree) return;
  demarree = true;
  void sonder().finally(planifier);
}

/** Arrête la sonde (essais, arrêt propre). */
export function arreter(): void { demarree = false; if (minuterie) clearTimeout(minuterie); minuterie = undefined; }

/** Remet l'état à zéro (essais seulement). */
export function reinitialiser(): void {
  arreter();
  horloge = auj;
  echecsDaffilee = 0;
  sondes = sondesReseau();
  cfg = { intervalleMs: 60_000, minAttenteMs: 1_000, maxAttenteMs: 60_000 };
  courant = { reseau: 'en-ligne', depuis: auj(), verifieA: 0, services: {} };
  auxChangements.splice(0);
  auxRetours.splice(0);
}

// ------------------------------------------------------------------ sondes réelles

/** generate_204 par nom, par IP, et joignabilité de la passerelle, sans dépendance externe. */
function sondesReseau(): Sondes {
  const NOM = 'https://www.google.com/generate_204';
  // Adresse littérale de connectivité de Cloudflare (sans DNS) : un 204 signifie Internet joignable.
  const IP = 'http://1.1.1.1/cdn-cgi/trace';
  const essai = async (url: string, attendu: (r: Response) => boolean): Promise<boolean> => {
    try { const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5_000) }); return attendu(r); }
    catch { return false; }
  };
  return {
    async passerelle() {
      // On ne sait pas lire la table de routage de façon portable ici : on ne force donc pas « sans-reseau ».
      return null;
    },
    parNom: () => essai(NOM, (r) => r.status === 204 || r.status === 200),
    parIp: () => essai(IP, (r) => r.ok || r.status === 204),
  };
}
