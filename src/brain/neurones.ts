// Les liens du Cerveau vivent comme des synapses entre neurones. Ce module est pur : aucune lecture ni
// écriture, l'heure est toujours donnée en paramètre, et rien n'est tiré au hasard (les égalités sont
// départagées par identifiant). Il calcule :
//  - la force d'un lien (de 0 à 1), qui baisse doucement quand le lien ne sert plus (oubli) ;
//  - le renforcement quand les deux bouts ont servi ensemble (« ce qui sert ensemble se relie ») ;
//  - la propagation d'une activation de proche en proche, qui s'atténue à chaque saut ;
//  - la consolidation de la nuit, qui rend durable ce qui a beaucoup servi et efface le reste.
// Le texte des notes n'est jamais touché : les forces sont rangées à part (voir liens-vivants.ts).

/** D'où vient un lien : écrit par le propriétaire ([[…]]), d'usage (liens entre applis, fiche ↔ appli), ou appris par Odin. */
export type Origine = 'ecrit' | 'usage' | 'appris';
/** Un lien qui freine : « A remplace B », « A contredit B ». */
export type Frein = 'remplace' | 'contredit';

/**
 * Un lien rangé (une synapse). `a` < `b` (ordre des identifiants) ; `w` : force durable calculée à l'heure `t` ;
 * `j` : preuves accumulées depuis la dernière nuit ; `vu` : dernière utilisation confirmée (0 = jamais) ;
 * `n` : usages confirmés ; `k` : nuits consolidées ; `cree` : naissance ; `bloque` : plus de renforcement
 * jusqu'à cette date ; `absent` : depuis quand un des bouts manque.
 */
export interface Synapse { id: string; a: string; b: string; w: number; t: number; j: number; vu: number; n: number; k: number; cree: number; bloque?: number; absent?: number }

const JOUR = 86_400_000, HEURE = 3_600_000;

/** Les réglages du modèle (la carte en recopie BASE, APPRIS_VISIBLE et REPOS_MS). */
export const R = {
  BASE: { ecrit: 0.30, usage: 0.35, appris: 0 } as Record<Origine, number>,
  DEMI_VIE: { appris: 14 * JOUR, autre: 60 * JOUR },
  K_MAX: 4,
  PAS: 0.05,
  ESPACEMENT: HEURE,
  SEUIL_NUIT: 1.5,
  PAS_NUIT: 0.25,
  ATTENUATION: 0.5,
  SAUTS: 2,
  SEUIL_ALLUME: 0.12,
  SEUIL_AJOUT: 0.20,
  AJOUTS_MAX: 2,
  VOISINS: 16,
  REPOS_MS: 60_000,
  GAIN_REPOS: 0.5,
  FORCE_FREIN: 0.6,
  REDUIT_PERIME: 0.3,
  APPRIS_VISIBLE: 0.15,
  ELAGUE: 0.05,
  ELAGUE_JOURS: 30,
  APPRIS_PAR_POINT: 12,
  SOMME_PAR_POINT: 3,
  TOTAL_APPRIS: 20_000,
  BLOQUE_JOURS: 90,
} as const;

/** Clé d'une paire, la même dans les deux sens. */
export const cle = (x: string, y: string) => (x < y ? `${x}\u0001${y}` : `${y}\u0001${x}`);
/** Arrondi à 2 décimales (ce qui sort vers la carte). */
export const deux = (x: number) => Math.round(x * 100) / 100;

/** Un lien neuf, à sa force de base. */
export function nouvelle(x: string, y: string, o: Origine, now: number): Synapse {
  const [a, b] = x < y ? [x, y] : [y, x];
  return { id: cle(a, b), a, b, w: R.BASE[o], t: now, j: 0, vu: 0, n: 0, k: 0, cree: now };
}

/** Force d'un lien à l'heure `now` : la force rangée qui baisse avec le temps, jamais sous la base de son origine. */
export function forceDe(l: Synapse | undefined, o: Origine, now: number): number {
  const base = R.BASE[o];
  if (!l) return base;
  const T = (o === 'appris' ? R.DEMI_VIE.appris : R.DEMI_VIE.autre) * 2 ** Math.min(l.k || 0, R.K_MAX);
  const w = (Number.isFinite(l.w) ? l.w : 0) * 2 ** (-Math.max(0, now - l.t) / T);
  return Math.max(base, Math.min(1, w));
}

/**
 * Les deux bouts ont servi ensemble (preuve `s` de 0 à 1). Un usage trop rapproché du précédent compte à peine
 * (espacement d'une heure). Rien si le lien est bloqué. Rend la part retenue `e`.
 */
export function renforcer(l: Synapse, s: number, now: number, o: Origine = 'appris'): number {
  if (l.bloque && l.bloque > now) return 0;
  l.w = forceDe(l, o, now); l.t = now;
  const esp = l.n > 0 ? 1 - Math.exp(-Math.max(0, now - l.vu) / R.ESPACEMENT) : 1;
  const e = Math.max(0, Math.min(1, Number.isFinite(s) ? s : 0)) * esp;
  l.w = Math.min(1, l.w + R.PAS * e * (1 - l.w));
  l.j = (l.j || 0) + e;
  // Un usage confirmé, même trop rapproché, recule la date : une rafale compte pour un seul usage.
  if (s > 0) l.vu = now;
  if (e > 0.01) l.n = (l.n || 0) + 1;
  return e;
}

/** Un voisin vu depuis un point : son identifiant, la force du lien, et son origine (ou « frein »). */
export interface Voisin { id: string; f: number; o: Origine | 'frein' }
/** Un point allumé : son activation, le saut où il s'est allumé, et le lien qui l'a le plus nourri. */
export interface Allume { a: number; saut: number; de?: string; f?: number; o?: Origine }

/**
 * L'activation se propage depuis les points de départ, sur deux sauts au plus, en perdant la moitié à chaque saut.
 * Un point très relié partage son influx (division par la racine de la somme des forces). Un point au repos
 * transmet moitié moins. Un frein (« A remplace B ») atténue la cible. Seuls les points allumés (≥ SEUIL_ALLUME)
 * transmettent, chacun une seule fois. Rend les points de départ et les points allumés.
 */
export function propager(depart: Map<string, number>, voisins: (id: string) => Voisin[], info: (id: string) => { gain: number; reduit: number }, enRepos: (id: string) => boolean): Map<string, Allume> {
  const res = new Map<string, Allume>();
  for (const [id, a0] of [...depart].sort((x, y) => (x[0] < y[0] ? -1 : 1))) res.set(id, { a: Math.max(0, Math.min(1, a0)), saut: 0 });
  const transmis = new Set<string>();
  const par = (x: [string, Allume], y: [string, Allume]) => y[1].a - x[1].a || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0);
  for (let saut = 1; saut <= R.SAUTS; saut++) {
    const front = [...res].filter(([id, x]) => x.saut === saut - 1 && x.a >= R.SEUIL_ALLUME && !transmis.has(id)).sort(par);
    if (!front.length) break;
    const plus = new Map<string, number>(), frein = new Map<string, number>();
    const parent = new Map<string, { de: string; f: number; o: Origine; d: number }>();
    for (const [i, x] of front) {
      transmis.add(i);
      const { gain } = info(i);
      if (!(gain > 0)) continue;
      const vs = voisins(i);
      const L = vs.filter((v) => v.o !== 'frein' && v.id !== i && v.f > 0).sort((p, q) => q.f - p.f || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0)).slice(0, R.VOISINS);
      const S = L.reduce((s, v) => s + v.f, 0);
      // Le repos ne freine qu'un point allumé par propagation : un point de départ de la demande en cours transmet
      // toujours pleinement (sinon la même question posée deux fois dans la minute n'aurait pas la même réponse).
      const g = x.a * R.ATTENUATION * gain * (x.saut > 0 && enRepos(i) ? R.GAIN_REPOS : 1) / Math.sqrt(Math.max(1, S));
      for (const v of L) {
        const deja = res.get(v.id);
        if (deja && deja.saut < saut) continue; // aucun écho : un point déjà passé ne reçoit plus
        const d = g * v.f;
        plus.set(v.id, (plus.get(v.id) ?? 0) + d * info(v.id).reduit);
        const p = parent.get(v.id);
        if (!p || d > p.d) parent.set(v.id, { de: i, f: v.f, o: v.o as Origine, d });
      }
      for (const v of vs) if (v.o === 'frein' && v.id !== i) frein.set(v.id, (frein.get(v.id) ?? 0) + x.a * R.FORCE_FREIN * gain);
    }
    for (const j of [...new Set([...plus.keys(), ...frein.keys()])].sort()) {
      const cur = res.get(j), fr = Math.min(1, frein.get(j) ?? 0);
      const a = Math.min(1, (cur?.a ?? 0) + (plus.get(j) ?? 0)) * (1 - fr);
      if (cur) { cur.a = a; continue; }
      const p = parent.get(j);
      if (p) res.set(j, { a, saut, de: p.de, f: p.f, o: p.o });
    }
  }
  // Sous le seuil, un point qui n'est pas un point de départ ne s'allume pas.
  for (const [id, x] of [...res]) if (x.saut > 0 && x.a < R.SEUIL_ALLUME) res.delete(id);
  return res;
}

export interface Bilan { renforces: number; effaces: number; recadres: number }

/**
 * La nuit : chaque lien est fixé à sa force du moment ; ce qui a servi plusieurs fois (j ≥ SEUIL_NUIT) devient
 * plus durable (sa demi-vie double) ; les liens faibles et anciens, ou dont un bout manque depuis 30 jours,
 * s'effacent ; chaque point garde au plus 12 liens appris (somme ≤ 3) ; au total 20 000 liens appris au plus.
 */
export function consolider(liens: Synapse[], now: number, o: { origine: (a: string, b: string) => Origine; existe: (id: string) => boolean }): { garder: Synapse[]; effacer: string[]; bilan: Bilan } {
  const bilan: Bilan = { renforces: 0, effaces: 0, recadres: 0 };
  const effacer = new Set<string>(), orig = new Map<string, Origine>();
  const ELAGUE_MS = R.ELAGUE_JOURS * JOUR;
  for (const l of liens) {
    const og = o.origine(l.a, l.b); orig.set(l.id, og);
    l.w = forceDe(l, og, now); l.t = now;
    if ((l.j || 0) >= R.SEUIL_NUIT) { l.w = Math.min(1, l.w + R.PAS_NUIT * Math.min(1, l.j / 3) * (1 - l.w)); l.k = (l.k || 0) + 1; bilan.renforces++; }
    l.j = 0;
    const bloque = Boolean(l.bloque && l.bloque > now);
    if (l.bloque && !bloque) delete l.bloque;
    if (!o.existe(l.a) || !o.existe(l.b)) { l.absent ??= now; if (now - l.absent > ELAGUE_MS) { effacer.add(l.id); continue; } }
    else delete l.absent;
    if (bloque) continue; // un lien bloqué reste rangé : sinon il pourrait renaître
    if (og === 'appris' && l.w < R.ELAGUE && now - Math.max(l.vu || 0, l.cree || 0) > ELAGUE_MS) effacer.add(l.id);
    else if (og !== 'appris' && l.w <= R.BASE[og] + 0.01 && now - (l.vu || 0) > ELAGUE_MS) effacer.add(l.id); // retombé sur sa base : plus besoin de le ranger
  }
  // Plafonds par point, dans l'ordre des identifiants.
  const appris = liens.filter((l) => orig.get(l.id) === 'appris' && !effacer.has(l.id));
  const parPoint = new Map<string, Synapse[]>();
  for (const l of appris) for (const p of [l.a, l.b]) { const x = parPoint.get(p); if (x) x.push(l); else parPoint.set(p, [l]); }
  const fort = (p: Synapse, q: Synapse) => q.w - p.w || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0);
  const recadre = new Set<string>();
  for (const p of [...parPoint.keys()].sort()) {
    const vivants = parPoint.get(p)!.filter((l) => !effacer.has(l.id) && !(l.bloque && l.bloque > now)).sort(fort);
    for (const l of vivants.slice(R.APPRIS_PAR_POINT)) effacer.add(l.id);
    const gardes = vivants.slice(0, R.APPRIS_PAR_POINT), somme = gardes.reduce((s, l) => s + l.w, 0);
    if (somme > R.SOMME_PAR_POINT + 1e-9) for (const l of gardes) { l.w = l.w * R.SOMME_PAR_POINT / somme; recadre.add(l.id); }
  }
  // Un lien que le recadrage fait passer sous le seuil d'effacement part dès cette nuit (même condition d'ancienneté) :
  // une deuxième nuit à la même heure ne doit plus rien effacer.
  const parId = new Map(appris.map((l) => [l.id, l]));
  for (const id of [...recadre].sort()) {
    const l = parId.get(id);
    if (l && !effacer.has(id) && l.w < R.ELAGUE && now - Math.max(l.vu || 0, l.cree || 0) > ELAGUE_MS) effacer.add(id);
  }
  // Plafond total : les plus faibles partent.
  const restants = appris.filter((l) => !effacer.has(l.id)).sort(fort);
  for (const l of restants.slice(R.TOTAL_APPRIS)) effacer.add(l.id);
  bilan.effaces = effacer.size;
  bilan.recadres = [...recadre].filter((id) => !effacer.has(id)).length;
  return { garder: liens.filter((l) => !effacer.has(l.id)), effacer: [...effacer].sort(), bilan };
}
