// Outils des essais de la page Kéryx (lot B) : un FAUX moteur conforme au CONTRAT partagé (le vrai est posé par
// le lot A, dans src/valhalla/keryx/ et src/web/keryx-api.ts) et un faux serveur qui répond EXACTEMENT comme les
// routes /api/keryx/*. Le faux pair SIP/modem rend un transcript figé, étiqueté « aucune vraie ligne ».
// Rien d'extérieur : tout en mémoire, aucun service ni numéro réel. Le faux navigateur est repris du lot voisin
// (test/archytas-fixtures.ts), on lui ajoute juste URLSearchParams (standard du navigateur, absent d'un vm nu).

// ---------------- Types du contrat (décrits ici pour les essais ; le lot A les tient en TypeScript).
export type Ligne = 'aucune' | 'modem' | 'sip';
export type NiveauAuto = 'prudent' | 'equilibre' | 'autonome';
export interface Surveillance { id: string; quoi: 'rappel_rdv' | 'mail_important'; reglage: string; actif: boolean }
export interface ReglagesKeryx { ligne: Ligne; numeros: string[]; autonomieApresSecret: NiveauAuto; actionGraveParAppel: 'interdite' | 'second_canal'; surveillances: Surveillance[]; modem?: { port: string; debit: number }; sip?: { serveur: string; utilisateur: string } }
export interface EntreeTrace { id: string; quand: string; canal: string; pair: string; sens: 'entrant' | 'sortant' | 'action'; texte: string; action?: { outil: string; resume: string; confirmee: boolean; gravite: 'routine' | 'important' | 'grave' }; resultat?: 'faite' | 'refusee' | 'en_attente' }
export interface EtatKeryx { ligne: Ligne; canauxActifs: string[]; mailBranche: boolean; agendaBranche: boolean; viePrivee: { captureEcran: false; pistageLieu: false }; telephonieEssayee: false }
export interface Essai { quoi: 'sip' | 'modem'; etapes: { sens: '→' | '←'; trame: string }[]; ok: boolean; note: string }

const NOTE_MATERIEL = 'Codé, pas essayé sur du vrai matériel.';

// ---------------- Un faux moteur conforme au CONTRAT (assez pour les essais du lot B et l'essai d'intégration).
export function fauxMoteur() {
  let reglages: ReglagesKeryx = {
    ligne: 'aucune',
    numeros: ['+33 6 12 34 56 78'],
    autonomieApresSecret: 'prudent',
    actionGraveParAppel: 'interdite',
    surveillances: [{ id: 's1', quoi: 'rappel_rdv', reglage: '1 h avant', actif: true }],
  };
  let secretPose = false;
  const T0 = Date.UTC(2026, 10, 16, 9, 0, 0);
  const trace: EntreeTrace[] = [
    { id: 't1', quand: new Date(T0).toISOString(), canal: 'telegram', pair: '+33 6 12 34 56 78', sens: 'entrant', texte: 'réponds à Paul qu\'on décale à jeudi 15 h' },
    { id: 't2', quand: new Date(T0 + 1000).toISOString(), canal: 'telegram', pair: '+33 6 12 34 56 78', sens: 'action', texte: '', action: { outil: 'mail_send', resume: 'Brouillon à Paul : décalage jeudi 15 h', confirmee: false, gravite: 'important' }, resultat: 'en_attente' },
    { id: 't3', quand: new Date(T0 + 60000).toISOString(), canal: 'telegram', pair: '+33 6 12 34 56 78', sens: 'entrant', texte: 'ok envoie' },
    { id: 't4', quand: new Date(T0 + 61000).toISOString(), canal: 'telegram', pair: '+33 6 12 34 56 78', sens: 'action', texte: '', action: { outil: 'mail_send', resume: 'Mail envoyé à Paul', confirmee: true, gravite: 'important' }, resultat: 'faite' },
    { id: 't5', quand: new Date(T0 + 62000).toISOString(), canal: 'telegram', pair: '+33 6 12 34 56 78', sens: 'sortant', texte: 'C\'est envoyé. Je l\'ai aussi noté dans ton agenda.' },
  ];

  return {
    get reglages() { return reglages; },
    get secretPose() { return secretPose; },
    get trace() { return trace; },
    etat(): EtatKeryx {
      return { ligne: reglages.ligne, canauxActifs: ['telegram', 'voix'], mailBranche: true, agendaBranche: false, viePrivee: { captureEcran: false, pistageLieu: false }, telephonieEssayee: false };
    },
    lireReglages(): ReglagesKeryx { return JSON.parse(JSON.stringify(reglages)); },
    ecrireReglages(patch: Partial<ReglagesKeryx>): ReglagesKeryx { reglages = { ...reglages, ...patch }; return this.lireReglages(); },
    poserSecret(code: string): { pose: true } { if (!code) throw new Error('code vide'); secretPose = true; return { pose: true }; },
    retirerSecret(): { pose: false } { secretPose = false; return { pose: false }; },
    historique(f: { avant?: string; n?: number }): { entrees: EntreeTrace[]; suite?: string } {
      const n = Math.min(200, Math.max(1, f.n || 50));
      let arr = trace.slice().sort((a, b) => b.quand.localeCompare(a.quand));
      if (f.avant) arr = arr.filter((e) => e.quand < f.avant!);
      const page = arr.slice(0, n);
      const suite = arr.length > n ? page[page.length - 1].quand : undefined;
      return { entrees: page, suite };
    },
    effacer(f: { id?: string; tout?: boolean }): { efface: number } {
      if (f.tout) { const k = trace.length; trace.length = 0; return { efface: k }; }
      const i = trace.findIndex((e) => e.id === f.id);
      if (i >= 0) { trace.splice(i, 1); return { efface: 1 }; }
      return { efface: 0 };
    },
    essayer(quoi: 'sip' | 'modem'): Essai { return quoi === 'sip' ? essaiSip() : essaiModem(); },
  };
}
export type FauxMoteur = ReturnType<typeof fauxMoteur>;

/** Faux pair SIP : REGISTER → 401 → digest → 200 → INVITE → 180 → 200 (SDP) → ACK → BYE → 200. */
export function essaiSip(): Essai {
  return {
    quoi: 'sip',
    etapes: [
      { sens: '→', trame: 'REGISTER sip:faux-registrar' },
      { sens: '←', trame: '401 Unauthorized (nonce=…, qop=auth)' },
      { sens: '→', trame: 'REGISTER (Authorization: Digest response=… MD5)' },
      { sens: '←', trame: '200 OK' },
      { sens: '→', trame: 'INVITE sip:faux-pair (SDP: PCMU/8000)' },
      { sens: '←', trame: '180 Ringing' },
      { sens: '←', trame: '200 OK (SDP: PCMU/8000)' },
      { sens: '→', trame: 'ACK' },
      { sens: '→', trame: 'BYE' },
      { sens: '←', trame: '200 OK' },
    ],
    ok: true,
    note: NOTE_MATERIEL + ' Échange prouvé contre un faux registrar ; le minuteur RTP reste à mesurer sur la machine cible.',
  };
}

/** Faux modem GSM/AT en mode texte : AT → OK, puis un SMS sortant AT+CMGS → « > » → texte + Ctrl-Z → +CMGS. */
export function essaiModem(): Essai {
  return {
    quoi: 'modem',
    etapes: [
      { sens: '→', trame: 'AT' },
      { sens: '←', trame: 'OK' },
      { sens: '→', trame: 'ATE0' },
      { sens: '←', trame: 'OK' },
      { sens: '→', trame: 'AT+CMGF=1' },
      { sens: '←', trame: 'OK' },
      { sens: '→', trame: 'AT+CMGS="+33600000000"' },
      { sens: '←', trame: '> ' },
      { sens: '→', trame: 'Essai Kéryx\\x1A' },
      { sens: '←', trame: '+CMGS: 42' },
      { sens: '←', trame: 'OK' },
    ],
    ok: true,
    note: NOTE_MATERIEL + ' SMS prouvé contre un faux modem ; l\'appel vocal exige un modem à audio USB.',
  };
}

/** Un faux fetch qui répond comme les routes /api/keryx/*. Journal des écritures pour les vérifications. */
export function fauxServeur(moteur: FauxMoteur) {
  const journal: Array<{ methode: string; chemin: string; corps: unknown }> = [];
  const rep = (status: number, j: unknown) => ({ status, ok: status >= 200 && status < 300, async json() { return j; } });
  async function fetch(url: string, init?: unknown) {
    const i = init as { method?: string; body?: string } | undefined;
    const methode = (i && i.method) || 'GET';
    const u = new URL(url, 'http://x');
    const chemin = u.pathname.replace('/api/keryx', '');
    const corps = i && i.body ? JSON.parse(i.body) : null;
    if (methode !== 'GET') journal.push({ methode, chemin, corps });
    try {
      if (chemin === '/etat') return rep(200, moteur.etat());
      if (chemin === '/reglages' && methode === 'GET') return rep(200, moteur.lireReglages());
      if (chemin === '/reglages' && methode === 'PUT') return rep(200, moteur.ecrireReglages(corps || {}));
      if (chemin === '/secret' && methode === 'POST') return rep(200, moteur.poserSecret(corps && corps.code));
      if (chemin === '/secret' && methode === 'DELETE') return rep(200, moteur.retirerSecret());
      if (chemin === '/historique') return rep(200, moteur.historique({ avant: u.searchParams.get('avant') || undefined, n: Number(u.searchParams.get('n')) || undefined }));
      if (chemin === '/historique/effacer') return rep(200, moteur.effacer(corps || {}));
      if (chemin === '/essayer') return rep(200, moteur.essayer(corps && corps.quoi));
      return rep(404, { error: 'inconnu' });
    } catch (e) { return rep(400, { error: (e as Error).message }); }
  }
  return { fetch, journal };
}

/** Une petite API appelable par les modules (même forme de retour que leur api interne), branchée au faux serveur. */
export function apiPour(serveur: { fetch: (u: string, i?: unknown) => unknown }) {
  return async (path: string, opts: { method?: string; body?: unknown } = {}): Promise<Record<string, unknown>> => {
    const init: { method: string; headers: Record<string, string>; body?: string } = { method: opts.method || 'GET', headers: { 'x-odin': '1' } };
    if (opts.body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    const r = (await serveur.fetch(`/api/keryx${path}`, init)) as { ok: boolean; status: number; json(): Promise<Record<string, unknown>> };
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, ...j };
  };
}
