// Serrures, alarme, portail : TOUJOURS validés (M1, DOM-08). Garde en code, sans modèle : ouvrir, déverrouiller ou
// désarmer → « grave » (ton accord, même en Breaker, jamais « toujours ») ; fermer et armer restent libres. Jamais
// depuis une tâche automatique, un invité ou une conversation qui a lu un contenu extérieur (refus, policy.ts).

export const GRAVE_MAISON = 'ouvrir ou désarmer la maison';

const MOTS = /(porte|serrure|portail|garage|alarme|verrou|door|lock|gate|alarm)/i;
/** Services qui OUVRENT, DÉVERROUILLENT ou DÉSARMENT (ou allument un interrupteur de portail, etc.). */
const OUVRE = /^(unlock|open|open_cover|open_cover_tilt|set_cover_position|toggle|turn_on|press|alarm_disarm|disarm|trigger)$/;
const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Ce qu'on sait d'une entité (son nom lisible, sa classe, et pour une scène ou un script : les entités qu'il touche). */
export interface InfoEntite { nom?: string; classe?: string; entites?: string[] }

/** La raison « grave » d'un appel Home Assistant, ou undefined. Pur. `info` : par entité. */
export function graveMaison(domain: string, service: string, entity: string, info: Record<string, InfoEntite> = {}): string | undefined {
  const ents = entity.split(',').map((x) => x.trim()).filter(Boolean);
  const pourquoi = (e: string, quoi: string) => `${GRAVE_MAISON} : ${quoi} (${e})`;
  // Une serrure : tout service autre que « lock » l'ouvre (unlock, open, et même turn_off / toggle par homeassistant.*).
  if (domain === 'lock' && service !== 'lock') return pourquoi(entity || 'toutes les serrures', 'déverrouiller');
  const serrures = ents.filter((e) => /^lock\./.test(e));
  if (serrures.length && service !== 'lock') return pourquoi(serrures.join(', '), `déverrouiller (${domain}.${service})`);
  const alarmes = ents.filter((e) => /^alarm_control_panel\./.test(e));
  if (alarmes.length && /disarm|turn_off|toggle/.test(service)) return pourquoi(alarmes.join(', '), 'désarmer l\'alarme');
  if (domain === 'alarm_control_panel' && /disarm/.test(service)) return pourquoi(entity || 'l\'alarme', 'désarmer l\'alarme');
  if (domain === 'alarm_control_panel') return undefined; // armer : libre
  for (const e of ents.length ? ents : ['']) {
    const i = info[e] ?? {};
    const sensible = MOTS.test(norm(`${e} ${i.nom ?? ''}`)) || /^(door|garage|gate|garage_door)$/.test(i.classe ?? '');
    if (domain === 'cover' && sensible && /^(open_cover|open_cover_tilt|set_cover_position|toggle)$/.test(service)) return pourquoi(e, 'ouvrir');
    // Une scène, un script, une automatisation : grave s'ils touchent une serrure, une alarme ou une porte — OU si leur
    // contenu n'a pas pu être lu (prudence : un nom neutre ne dit rien de ce qu'ils font).
    const lance = domain === 'script' ? !/^(turn_off|reload)$/.test(service) : domain === 'automation' ? /^(trigger|turn_on|toggle)$/.test(service) : domain === 'scene' && /^(turn_on|apply)$/.test(service);
    if ((domain === 'scene' || domain === 'script' || domain === 'automation') && lance) {
      if (!i.entites) return pourquoi(e, `lancer « ${i.nom || e} », dont je n'ai pas pu lire ce qu'il touche`);
      const touche = i.entites.find((x) => /^(lock|alarm_control_panel)\./.test(x) || MOTS.test(norm(x)));
      if (touche || sensible) return pourquoi(e, `lancer « ${i.nom || e} », qui touche ${touche ?? 'une ouverture'}`);
    }
    if (!['cover', 'scene', 'script', 'automation', 'lock'].includes(domain) && sensible && OUVRE.test(service)) return pourquoi(e, `${domain}.${service}`);
  }
  return undefined;
}
