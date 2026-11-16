// RTP : le transport du son d'un appel, en pur Node (node:dgram), écrit d'après la norme publique (RFC 3550, en-tête de
// 12 octets) — rien recopié d'un code sous licence. Un paquet toutes les 20 ms porte 160 octets de G.711 (8 kHz).
//
// LE POINT DUR, MESURÉ par l'éclaireur : le minuteur. Un setTimeout(20) naïf prend du retard à chaque tour (le retard
// s'additionne) ; sous Windows, la dérive atteint plusieurs secondes sur 10 s — un son inécoutable. La parade est un
// ORDONNANCEUR À ÉCHÉANCE ABSOLUE : chaque tour vise base + n × période, et recalcule son attente depuis l'heure réelle,
// si bien que le retard d'un tour ne se reporte pas sur les suivants. C'est ce que fait `delaiProchain`.

/**
 * L'attente avant le tour numéro `n` (0, 1, 2…), depuis l'instant de départ `base`, à l'heure qu'il est `maintenant`.
 * Toujours mesurée par rapport à l'échéance absolue (base + n × période) : un tour en retard n'entraîne pas les autres.
 * Pur, donc mesurable sans vrai minuteur.
 */
export function delaiProchain(base: number, n: number, periodeMs: number, maintenant: number): number {
  return Math.max(0, base + n * periodeMs - maintenant);
}

/** L'ordonnanceur à échéance absolue : il appelle `tour` toutes les `periodeMs`, sans accumuler le retard. */
export class OrdonnanceurEcheance {
  private base = 0;
  private n = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private actif = false;
  private readonly periodeMs: number;
  private readonly tour: () => void;
  private readonly maintenant: () => number;
  constructor(periodeMs: number, tour: () => void, maintenant: () => number = () => performance.now()) {
    this.periodeMs = periodeMs; this.tour = tour; this.maintenant = maintenant;
  }

  demarrer(): void {
    if (this.actif) return;
    this.actif = true; this.base = this.maintenant(); this.n = 0;
    this.planifier();
  }
  private planifier(): void {
    const delai = delaiProchain(this.base, this.n, this.periodeMs, this.maintenant());
    this.timer = setTimeout(() => {
      if (!this.actif) return;
      this.n++;
      try { this.tour(); } catch { /* un tour raté ne doit pas casser l'horloge */ }
      this.planifier();
    }, delai);
    this.timer.unref?.();
  }
  arreter(): void { this.actif = false; if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  /** Combien de tours ont eu lieu (diagnostic). */
  get tours(): number { return this.n; }
}

export interface EnteteRtp { version: number; charge: number; marque: boolean; sequence: number; horodatage: number; ssrc: number }

/** Fabrique un paquet RTP (en-tête 12 octets + charge). */
export function construirePaquet(e: { charge: number; sequence: number; horodatage: number; ssrc: number; marque?: boolean }, donnees: Uint8Array): Uint8Array {
  const p = new Uint8Array(12 + donnees.length);
  const v = new DataView(p.buffer);
  p[0] = 0x80; // version 2, pas de padding, pas d'extension, 0 CSRC
  p[1] = (e.marque ? 0x80 : 0) | (e.charge & 0x7f);
  v.setUint16(2, e.sequence & 0xffff, false);
  v.setUint32(4, e.horodatage >>> 0, false);
  v.setUint32(8, e.ssrc >>> 0, false);
  p.set(donnees, 12);
  return p;
}

/** Lit un paquet RTP ; rien si l'en-tête est trop court ou n'est pas de la version 2 (trame hostile rejetée vite). */
export function lirePaquet(p: Uint8Array): { entete: EnteteRtp; charge: Uint8Array } | undefined {
  if (p.length < 12) return undefined;
  const version = (p[0] >> 6) & 0x03;
  if (version !== 2) return undefined;
  const csrc = p[0] & 0x0f, debut = 12 + csrc * 4;
  if (p.length < debut) return undefined;
  const v = new DataView(p.buffer, p.byteOffset, p.byteLength);
  return {
    entete: { version, charge: p[1] & 0x7f, marque: (p[1] & 0x80) !== 0, sequence: v.getUint16(2, false), horodatage: v.getUint32(4, false), ssrc: v.getUint32(8, false) },
    charge: p.subarray(debut),
  };
}
