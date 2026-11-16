// Théia — détecter et SUIVRE à l'intérieur d'UNE vidéo. Le détecteur (trouver les boîtes : personne, animal, véhicule,
// objet…) vient d'un modèle ouvert calculé par le moteur d'Odin ; ici on écrit la partie qui NE dépend d'aucun modèle :
//   - le suivi par recouvrement (IoU, façon SORT) : garder un même élément sous le même repère tant qu'on le voit ;
//   - le comptage (combien de personnes, de véhicules… vus en tout) ;
//   - les événements par règles : entrée dans le cadre, colis déposé, chute (allongement + vitesse), véhicule, départ de
//     feu (couleur chaude + scintillement), avec le moment exact.
// Le suivi reste DANS une vidéo : il ne relie jamais un même élément entre deux sources différentes.
// VISAGES : identifier une personne (« c'est toi ») est ÉTEINT par défaut et très encadré (voir `identificationPermise`).
// « codé, pas encore essayé sur du vrai modèle » tant qu'un vrai détecteur ouvert n'a pas tourné et été mesuré.

/** Une boîte [x, y, largeur, hauteur] en pixels (coin haut-gauche). */
export type Boite = [number, number, number, number];
/** Une détection d'un modèle sur une image : sa classe, sa boîte, sa confiance. */
export interface Detection { classe: string; boite: Boite; score: number }
/** Un détecteur ouvert (branché plus tard sur un modèle calculé par Odin) : les objets vus sur une image. */
export interface Detecteur { detecter(rgba: Uint8Array, largeur: number, hauteur: number): Promise<Detection[]> }

/** Recouvrement de deux boîtes (intersection sur union), 0..1. */
export function iou(a: Boite, b: Boite): number {
  const ax2 = a[0] + a[2], ay2 = a[1] + a[3], bx2 = b[0] + b[2], by2 = b[1] + b[3];
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a[1], b[1]));
  const inter = ix * iy, uni = a[2] * a[3] + b[2] * b[3] - inter;
  return uni > 0 ? inter / uni : 0;
}
const centre = (b: Boite): [number, number] => [b[0] + b[2] / 2, b[1] + b[3] / 2];

/** Une piste : un repère stable, sa classe, ses boîtes dans le temps, son état. */
export interface Piste {
  repere: string; classe: string;
  boites: Array<{ t: number; boite: Boite }>;
  vuDe: number; vuA: number; vivante: boolean; absenceDepuis: number;
}

/**
 * Le suivi par recouvrement sur UNE vidéo : à chaque image, on relie chaque détection à la piste la plus recouvrante
 * (IoU au-dessus d'un seuil) ; sinon on ouvre une nouvelle piste. Une piste disparue depuis trop longtemps se ferme.
 */
export class SuiviVideo {
  private pistes_: Piste[] = [];
  private compteur = 0;
  private seuilIoU: number;
  private patience: number;
  constructor(seuilIoU = 0.3, patience = 2.0) { this.seuilIoU = seuilIoU; this.patience = patience; }

  /** Une image : son instant et les détections ; rend les pistes mises à jour. */
  pousser(t: number, detections: Detection[]): Piste[] {
    const libres = new Set(this.pistes_.filter((p) => p.vivante).map((p) => p.repere));
    // Chaque détection cherche la meilleure piste vivante de même classe par IoU.
    for (const d of detections) {
      let meilleure: Piste | undefined, meilleurIoU = this.seuilIoU;
      for (const p of this.pistes_) {
        if (!p.vivante || p.classe !== d.classe || !libres.has(p.repere)) continue;
        const last = p.boites[p.boites.length - 1].boite, s = iou(last, d.boite);
        if (s >= meilleurIoU) { meilleurIoU = s; meilleure = p; }
      }
      if (meilleure) {
        meilleure.boites.push({ t, boite: d.boite }); meilleure.vuA = t; meilleure.absenceDepuis = 0; libres.delete(meilleure.repere);
      } else {
        this.compteur++;
        this.pistes_.push({ repere: `${d.classe}-${this.compteur}`, classe: d.classe, boites: [{ t, boite: d.boite }], vuDe: t, vuA: t, vivante: true, absenceDepuis: 0 });
      }
    }
    // Les pistes non revues vieillissent ; au-delà de la patience, elles se ferment.
    for (const p of this.pistes_) if (p.vivante && libres.has(p.repere)) { p.absenceDepuis = t - p.vuA; if (p.absenceDepuis > this.patience) p.vivante = false; }
    return this.pistes_;
  }
  pistes(): Piste[] { return this.pistes_; }
  /** Combien d'éléments distincts d'une classe ont été vus en tout (comptage). */
  compte(classe?: string): number { return this.pistes_.filter((p) => !classe || p.classe === classe).length; }
}

/** Un événement repéré sur la vidéo : quoi, quand, et sur quel repère. */
export interface Evenement { type: string; t: number; repere: string; detail?: string }

/**
 * Les événements par règles, à partir des pistes (aucun modèle en plus) :
 *   - entrée : la première apparition d'une personne / d'un véhicule ;
 *   - colis : un objet « colis/carton » qui apparaît et reste immobile ;
 *   - chute : une personne dont la boîte s'allonge vite en largeur (hauteur < largeur) puis ne bouge plus ;
 *   - véhicule : l'apparition d'un véhicule ;
 *   - comptage inclus par les repères.
 */
export function evenementsParRegles(pistes: Piste[]): Evenement[] {
  const ev: Evenement[] = [];
  for (const p of pistes) {
    if (p.classe === 'personne' || p.classe === 'vehicule') ev.push({ type: 'entrée', t: p.vuDe, repere: p.repere, detail: `${p.classe} entre dans le cadre` });
    if (p.classe === 'vehicule') ev.push({ type: 'véhicule', t: p.vuDe, repere: p.repere });
    if (/colis|carton|paquet/.test(p.classe)) {
      const bouge = p.boites.some((b, i) => i > 0 && iou(b.boite, p.boites[i - 1].boite) < 0.5);
      if (!bouge && p.boites.length >= 2) ev.push({ type: 'colis', t: p.vuA, repere: p.repere, detail: 'objet déposé, immobile' });
    }
    if (p.classe === 'personne') {
      for (let i = 1; i < p.boites.length; i++) {
        const [, , w0, h0] = p.boites[i - 1].boite, [, , w1, h1] = p.boites[i].boite, dt = p.boites[i].t - p.boites[i - 1].t || 1;
        const etaitDebout = h0 > w0, estAllonge = w1 > h1 * 1.2, vite = (Math.abs(h1 - h0) / Math.max(1, h0)) / dt > 0.4;
        if (etaitDebout && estAllonge && vite) { ev.push({ type: 'chute', t: p.boites[i].t, repere: p.repere, detail: 'personne au sol (allongement rapide)' }); break; }
      }
    }
  }
  return ev.sort((a, b) => a.t - b.t);
}

/** Départ de feu par l'image (sans modèle) : part de pixels chauds (rouge/orange vif) ET scintillement entre deux images. */
export function departDeFeu(statsCouleur: { partChaude: number; scintillement: number }): boolean {
  return statsCouleur.partChaude > 0.06 && statsCouleur.scintillement > 0.15;
}

// ------------------------------------------------------------------ Visages (très sensible, éteint par défaut)
/** Le cadre d'un enrôlement de visage (gabarit chiffré, consentement, expiration). */
export interface Enrolement { id: string; nom: string; consenti: boolean; expire?: number }

/**
 * Identifier une personne par son visage n'est permis QUE : la reconnaissance est allumée, la source est un
 * enregistrement DU PROPRIÉTAIRE (ses caméras / sa bibliothèque / ses fichiers), et la personne a été ENRÔLÉE avec son
 * accord, non expirée. Sinon Odin DÉCRIT (« une personne ») sans mettre de nom. Jamais sur une vidéo publique ni sur un
 * inconnu. Cette fonction dit seulement si c'est permis ; la décision reste refusée par défaut.
 */
export function identificationPermise(o: { allumee: boolean; sourceDuProprietaire: boolean; enrolement?: Enrolement; maintenant?: number }): boolean {
  if (!o.allumee || !o.sourceDuProprietaire || !o.enrolement) return false;
  if (!o.enrolement.consenti) return false;
  if (o.enrolement.expire && o.enrolement.expire < (o.maintenant ?? Date.now())) return false;
  return true;
}
