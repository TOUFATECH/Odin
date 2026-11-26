// La famille « Santé » des widgets (maquette validée « Accueil ») : la santé de la machine d'Odin (le processeur, la
// mémoire et le disque le plus plein, en pourcentage, chacun avec SON niveau tel que Hygie le calcule ; la température
// seulement si elle est lue) et la santé de ses disques (chaque disque que Tirésias connaît et son état vrai, celui qui
// va mal d'abord). La machine montrée est celle d'Odin (sa réponse à la question 17).
// Rien n'est montré tant qu'Odin n'a pas la vraie donnée (sa réponse à la question 13), jamais un zéro à la place d'une
// absence : Hygie ne lit que les fichiers de Linux (src/valhalla/eir/collect.ts) et Tirésias ne lit pas les disques sous
// Windows (src/valhalla/modules/durinn.ts) : sur une telle machine, l'état « source_absente » avec son code, sans un
// chiffre. Une mesure qui manque (pas de température, un disque illisible) : pas de ligne, ou « non lu » ; jamais 0 %
// ni « bon » par défaut.
// Ces widgets ne LANCENT aucune mesure : ils lisent ce que Hygie a déjà rangé chaque minute dans le magasin de mesures,
// et la dernière lecture des disques que Tirésias a gardée (sa veille la refait toutes les 30 minutes). Une mesure trop
// vieille est rendue « ancien », avec son heure.
// Qui voit quoi : le widget suit le droit sur l'appli qu'il lit (public « membre ») : un membre sans ce droit est refusé
// avant toute lecture, sans une valeur ni un nom de disque ; une tablette « maison » est refusée (famille hors « infos »
// et « maison ») ; la route des widgets ne s'ouvre ni à une clé d'accès ni sans session. Aucune action : « Ouvrir » seul.
import { level, type Limits } from '../eir/collect.ts';
import type { EtatWidget, Releves, SorteWidget } from './sorte.ts';

/** Le libellé choisi par la personne : 40 signes. */
const etiquette: NonNullable<SorteWidget['nettoyer']> = (o, out, t) => { if (o.label) out.label = t.str(o.label, 40); return true; };
/** Hygie range une mesure par minute : sans relevé depuis cinq minutes, la mesure est ancienne. */
export const MACHINE_ANCIENNE = 5 * 60_000;
/**
 * Le processeur se mesure entre deux lectures : le premier relevé de Hygie après son démarrage n'en a pas de précédente
 * et vaut 0 (collect.ts, health). Une valeur du processeur n'est donc prise qu'avec un relevé juste avant (deux minutes
 * et demie au plus).
 */
const CPU_SUITE = 150_000;
/** Tirésias relit les disques toutes les 30 minutes : plus de deux tours sans lecture (et dix minutes de marge), ancienne. */
export const DISQUES_ANCIENS = 70 * 60_000;
/** Les disques servis au plus (Tirésias en lit 24 au plus par machine) ; le total dit le reste. */
export const DISQUES_SERVIS = 24;
const NIVEAUX: readonly string[] = ['ok', 'suivre', 'attention', 'grave'];
const ETATS_DISQUE: readonly string[] = ['bon', 'attention', 'mauvais', 'inconnu'];
/** Un disque qui va mal se voit d'abord ; un disque non lu passe devant un disque bon (rien n'est dit sain par défaut). */
const RANG: Record<string, number> = { mauvais: 0, attention: 1, inconnu: 2, bon: 3 };
const GENRES: readonly string[] = ['disque dur', 'SSD', 'NVMe', 'inconnu'];
const fini = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
/** La machine que Hygie et Tirésias ne savent pas lire : un code, pour la phrase de l'écran. */
const pasLue = (systeme: string): EtatWidget => ({ etat: 'source_absente', raison: systeme === 'win32' ? 'windows_non_lu' : 'systeme_non_lu' });

/** Le dernier relevé valable d'une suite (instant fini, pas dans le futur, valeur dans les bornes), et celui d'avant. */
function derniers(r: Releves | undefined, ok: (v: number) => boolean, maintenant: number): Array<readonly [number, number]> {
  return (Array.isArray(r) ? r : []).filter((p) => Array.isArray(p) && fini(p[0]) && fini(p[1]) && p[0] <= maintenant && ok(p[1])).sort((a, b) => a[0] - b[0]).slice(-2);
}
const pourcentage = (v: number) => v >= 0 && v <= 100;
/** Comme Hygie garde un capteur de température : au-dessus de zéro, 200 °C au plus (collect.ts, sensors). */
const degres = (v: number) => v > 0 && v <= 200;

/**
 * Ce que montre « Santé de la machine », à partir des relevés de Hygie. Pur. Chaque mesure : sa valeur arrondie et
 * son niveau, calculé avec les seuils de Hygie et la règle de Hygie (level). Le disque : le plus plein des disques
 * montés. La température : la plus haute des températures lues. Les mesures montrées sont du même passage de Hygie
 * (à cinq minutes près de la plus récente) ; `at` : le plus ancien de ces relevés (jamais plus frais qu'il n'est).
 */
export function santeDeLaMachine(m: { cpu?: Releves; mem?: Releves; disques?: readonly Releves[]; temperatures?: readonly Releves[] }, seuils: Record<string, Limits>, maintenant: number):
  { donnee: Record<string, { pct?: number; c?: number; niveau: string }>; at: number } | undefined {
  const pris: Record<string, readonly [number, number]> = {};
  const cpu = derniers(m.cpu, pourcentage, maintenant);
  if (cpu.length === 2 && cpu[1][0] - cpu[0][0] <= CPU_SUITE) pris.cpu = cpu[1];
  const mem = derniers(m.mem, pourcentage, maintenant).at(-1); if (mem) pris.mem = mem;
  const plusHaut = (l: readonly Releves[] | undefined, ok: (v: number) => boolean) => (Array.isArray(l) ? l : []).map((r) => derniers(r, ok, maintenant).at(-1))
    .filter((p): p is readonly [number, number] => Boolean(p)).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const disques = plusHaut(m.disques, pourcentage), temps = plusHaut(m.temperatures, degres);
  if (!pris.cpu && !pris.mem && !disques.length) return undefined;
  // Le passage le plus récent de Hygie : ce qui est plus vieux de cinq minutes n'est pas montré avec lui.
  const recent = Math.max(...[pris.cpu, pris.mem, ...disques].filter(Boolean).map((p) => p![0]));
  const duPassage = (p: readonly [number, number] | undefined) => (p && recent - p[0] <= MACHINE_ANCIENNE ? p : undefined);
  const d = disques.find((p) => duPassage(p)), t = temps.find((p) => duPassage(p));
  if (d) pris.disque = d;
  for (const k of ['cpu', 'mem'] as const) if (!duPassage(pris[k])) delete pris[k];
  const seuil = (k: string) => seuils[k];
  const niv = (v: number, k: string) => { const s = seuil(k); return s && NIVEAUX.includes(level(v, s)) ? level(v, s) : undefined; };
  const donnee: Record<string, { pct?: number; c?: number; niveau: string }> = {};
  // Les niveaux, comme la page de Hygie les calcule : le processeur et le disque sur la valeur lue, la mémoire arrondie.
  const poser = (k: 'cpu' | 'mem' | 'disque', seuilDe: string, arrondiAvant: boolean) => {
    const p = pris[k]; if (!p) return;
    const v = arrondiAvant ? Math.round(p[1]) : p[1], n = niv(v, seuilDe); if (!n) return;
    donnee[k] = { pct: Math.round(p[1]), niveau: n };
  };
  poser('cpu', 'cpu', false); poser('mem', 'mem', true); poser('disque', 'fs', false);
  if (t) { const n = niv(t[1], 'temp'); if (n) { donnee.temp = { c: Math.round(t[1]), niveau: n }; pris.temp = t; } }
  const montres = Object.keys(donnee).map((k) => pris[k][0]);
  if (!donnee.cpu && !donnee.mem && !donnee.disque) return undefined;
  return { donnee, at: Math.min(...montres) };
}

/** Un disque tel que le widget le sert : son nom court, son modèle, son genre, sa taille, son état vrai. Pur. */
function disqueVu(d: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!d || typeof d !== 'object' || typeof d.nom !== 'string' || !d.nom.trim()) return undefined;
  // Un disque non relu n'est jamais dit « bon » ; mais ce que Tirésias juge mal sans le relire (une tendance, un
  // autotest raté : src/valhalla/durinn/smart.ts) garde son état, pour passer devant.
  const lu = d.smart === 'oui', connu = typeof d.etat === 'string' && ETATS_DISQUE.includes(d.etat) ? d.etat : 'inconnu', etat = !lu && connu === 'bon' ? 'inconnu' : connu;
  return {
    nom: d.nom.trim().slice(0, 40),
    ...(typeof d.modele === 'string' && d.modele.trim() ? { modele: d.modele.trim().slice(0, 80) } : {}),
    genre: typeof d.genre === 'string' && GENRES.includes(d.genre) ? d.genre : 'inconnu',
    ...(fini(d.taille) && d.taille > 0 ? { taille: d.taille } : {}),
    etat, lu,
    ...(lu && fini(d.temperature) && degres(d.temperature) ? { temperature: Math.round(d.temperature) } : {}),
    ...(d.enVeille === true ? { veille: true } : {}),
  };
}

export const SORTES_SANTE = [
  {
    // « Santé de la machine » (la maquette : trois anneaux, Processeur, Mémoire, Disque, et la température en tête).
    id: 'sante_machine', famille: 'sante', applis: ['eir'], taille: { mini: [3, 2], r: 2 }, styles: ['anneaux'], public: 'membre', posable: true,
    nettoyer: etiquette,
    lire: async (_w, src): Promise<EtatWidget> => {
      if (!src.santeMachine) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      const r = src.santeMachine();
      if (!r) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      if (r.systeme !== 'linux') return pasLue(String(r.systeme ?? ''));
      if (!r.mesures) return { etat: 'source_absente', raison: 'mesures_absentes' };
      const maintenant = src.maintenant(), s = santeDeLaMachine(r.mesures, r.seuils ?? {}, maintenant);
      if (!s) return { etat: 'vide', raison: 'pas_encore_mesure' };
      return maintenant - s.at > MACHINE_ANCIENNE
        ? { etat: 'ancien', at: s.at, donnee: s.donnee, motif: 'hygie_ne_mesure_plus' }
        : { etat: 'ok', at: s.at, donnee: s.donnee };
    },
  },
  {
    // « Santé des disques » (la maquette : une ligne par disque, sa pastille, son genre et sa température, et son état).
    id: 'sante_disques', famille: 'sante', applis: ['durinn'], taille: { mini: [3, 2], r: 4 }, styles: ['liste'], public: 'membre', posable: true,
    nettoyer: etiquette,
    lire: async (_w, src): Promise<EtatWidget> => {
      if (!src.disquesSante) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      const r = src.disquesSante();
      if (!r) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      if (r.systeme === 'win32') return pasLue('win32');
      const l = r.lecture;
      if (!l) return { etat: 'vide', raison: 'disques_pas_encore_lus' };
      // Ce qui a empêché Tirésias de lire : un code, jamais son texte (il peut nommer la machine ou un chemin).
      if (l.panne) return { etat: 'source_absente', raison: l.panne === 'windows' ? 'windows_non_lu' : l.panne === 'absent' ? 'smartctl_absent' : l.panne === 'ancien' ? 'smartctl_ancien' : 'smartctl_muet' };
      const quand = Date.parse(String(l.quand ?? ''));
      if (!fini(quand)) return { etat: 'source_absente', raison: 'lecture_illisible' };
      const tous = (Array.isArray(l.disques) ? l.disques : []).map((d) => disqueVu(d as unknown as Record<string, unknown>)).filter((d): d is Record<string, unknown> => Boolean(d));
      if (!tous.length) return { etat: 'vide', raison: 'aucun_disque' };
      const ordre = tous.map((d, i) => ({ d, i })).sort((a, b) => RANG[String(a.d.etat)] - RANG[String(b.d.etat)] || a.i - b.i).map((x) => x.d);
      const compte = Object.fromEntries(ETATS_DISQUE.map((e) => [e, tous.filter((d) => d.etat === e).length]));
      const donnee = { disques: ordre.slice(0, DISQUES_SERVIS), total: tous.length, compte };
      const maintenant = src.maintenant();
      // Une lecture datée dans le futur (horloge qui a reculé) n'est pas dite fraîche.
      return maintenant - quand > DISQUES_ANCIENS || quand - maintenant > 60_000 ?{ etat: 'ancien', at: quand, donnee, motif: 'tiresias_ne_relit_plus' } : { etat: 'ok', at: quand, donnee };
    },
  },
] as const satisfies readonly SorteWidget[];
