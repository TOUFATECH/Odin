// Partage de la page d'une appli : un lien vers une copie figée, en lecture seule.
//   - lien privé : il faut être connecté à Odin (toi, ou une personne de Persona, toutes ou seulement les invitées) ;
//   - lien public : une adresse secrète, longue et tirée au hasard, sans compte.
// Chaque partage a une date de fin (jamais « pour toujours »), compte ses ouvertures, et se retire d'un geste.
// Sur le disque : la copie (déjà masquée) et l'empreinte de l'adresse secrète, jamais l'adresse elle-même : un fichier
// volé ne donne pas le lien. Le dossier est interdit aux outils de fichiers d'Odin (Heimdall).

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PageExport } from './export/page.ts';

export type TypePartage = 'prive' | 'public';
export interface Partage {
  /** identifiant du partage (pour le retirer) : il ne donne pas accès à la copie */
  id: string;
  /** empreinte SHA-256 de l'adresse secrète */
  h: string;
  appli: string; nom: string; type: TypePartage;
  cree: number; fin: number;
  ouvertures: number; derniere?: number;
  onglet?: string; poste?: string;
  /** lien privé : les personnes et les groupes de Persona invités (les deux vides : toute personne connectée) */
  personnes: string[]; groupes: string[];
  /** taille de la copie, et nombre de valeurs masquées dedans */
  octets: number; masques: number;
}
/** Durée d'un partage, en jours. */
export const DUREE = { defaut: 7, max: 90 } as const;
/** Pas plus de partages en cours que ça, ni de copie plus lourde que ça. */
export const MAX_PARTAGES = 50, MAX_OCTETS = 2 * 1024 * 1024;
/** La forme d'une adresse secrète : 32 octets tirés au hasard, écrits en 43 caractères. */
export const JETON = /^[A-Za-z0-9_-]{43}$/;

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

export class Partages {
  private dir: string;
  private now: () => number;
  constructor(dir: string, now: () => number = Date.now) { this.dir = dir; this.now = now; }

  private get index(): string { return join(this.dir, 'index.json'); }
  private copie(id: string): string { return join(this.dir, `${id}.json`); }
  private ecrire(fichier: string, data: unknown): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${fichier}.tmp`;
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    try { chmodSync(tmp, 0o600); } catch { /* Windows : droits gérés par le profil utilisateur */ }
    renameSync(tmp, fichier);
  }
  private lire(): Partage[] {
    try { const l = (JSON.parse(readFileSync(this.index, 'utf8')) as { partages?: Partage[] }).partages; return Array.isArray(l) ? l.filter((p) => p && typeof p.id === 'string' && /^[a-f0-9]{12}$/.test(p.id) && typeof p.h === 'string' && typeof p.fin === 'number') : []; } catch { return []; }
  }
  private garder(l: Partage[]): void { this.ecrire(this.index, { v: 1, partages: l }); }
  /** Les partages en cours ; ceux dont la date de fin est passée sont effacés, copie comprise. */
  private actifs(): Partage[] {
    const tous = this.lire(), t = this.now(), l = tous.filter((p) => p.fin > t);
    if (l.length !== tous.length) { for (const p of tous) if (p.fin <= t) rmSync(this.copie(p.id), { force: true }); this.garder(l); }
    return l;
  }

  /** Les partages en cours (les plus récents d'abord), pour une appli ou pour toutes. */
  liste(appli?: string): Partage[] { return this.actifs().filter((p) => !appli || p.appli === appli).sort((a, b) => b.cree - a.cree); }

  /**
   * Fige une page et crée son lien. Rend le partage et son adresse secrète : elle n'est donnée qu'ici, une seule fois.
   * Lève une erreur lisible si la copie est trop lourde ou s'il y a déjà trop de partages.
   */
  creer(page: PageExport, o: { type: TypePartage; fin: number; personnes?: string[]; groupes?: string[] }): { partage: Partage; jeton: string } {
    const l = this.actifs(), t = this.now();
    if (l.length >= MAX_PARTAGES) throw new Error(`Tu as déjà ${MAX_PARTAGES} partages en cours : retires-en un avant d'en créer un autre.`);
    if (!(o.fin > t)) throw new Error('La date de fin doit être dans le futur.');
    const corps = JSON.stringify(page), octets = Buffer.byteLength(corps);
    if (octets > MAX_OCTETS) throw new Error(`Cette page est trop lourde pour être partagée (${(octets / 1024 / 1024).toFixed(1).replace('.', ',')} Mo, 2 Mo au plus)${page.onglets?.length && !page.onglet ? ' : partage un seul onglet' : ''}.`);
    const jeton = randomBytes(32).toString('base64url');
    let id = randomBytes(6).toString('hex'); while (l.some((p) => p.id === id)) id = randomBytes(6).toString('hex');
    const partage: Partage = {
      id, h: sha(jeton), appli: page.app.id, nom: page.app.name, type: o.type, cree: t, fin: o.fin, ouvertures: 0,
      ...(page.onglet ? { onglet: page.onglet } : {}), ...(page.poste ? { poste: page.poste } : {}),
      personnes: o.type === 'prive' ? [...new Set(o.personnes ?? [])] : [], groupes: o.type === 'prive' ? [...new Set(o.groupes ?? [])] : [], octets, masques: page.masques,
    };
    this.ecrire(this.copie(id), page);
    this.garder([...l, partage]);
    // Ménage : une copie sans partage (retrait interrompu) ne reste pas sur le disque.
    try { const connus = new Set([...l.map((p) => p.id), id]); for (const f of readdirSync(this.dir)) { const m = /^([a-f0-9]{12})\.json$/.exec(f); if (m && !connus.has(m[1])) rmSync(join(this.dir, f), { force: true }); } } catch { /* au mieux */ }
    return { partage, jeton };
  }

  /** Le partage et sa copie pour cette adresse secrète (comparée en temps constant), s'il est encore en cours. */
  trouver(jeton: string): { partage: Partage; page: PageExport } | undefined {
    if (typeof jeton !== 'string' || !JETON.test(jeton)) return undefined;
    const h = Buffer.from(sha(jeton));
    let trouve: Partage | undefined;
    // On parcourt toute la liste, sans s'arrêter au premier : le temps de réponse ne dit rien de l'adresse.
    for (const p of this.actifs()) { const b = Buffer.from(p.h); if (b.length === h.length && timingSafeEqual(b, h)) trouve = p; }
    if (!trouve) return undefined;
    try { const page = JSON.parse(readFileSync(this.copie(trouve.id), 'utf8')) as PageExport; if (page && page.odin === 1 && Array.isArray(page.sections)) return { partage: trouve, page }; } catch { /* copie absente ou abîmée */ }
    this.retirer(trouve.id);
    return undefined;
  }

  /** Compte une ouverture ; rend le nouveau total. */
  compter(id: string): number {
    const l = this.actifs(), p = l.find((x) => x.id === id);
    if (!p) return 0;
    p.ouvertures = (p.ouvertures || 0) + 1; p.derniere = this.now();
    this.garder(l);
    return p.ouvertures;
  }

  /** Retire un partage tout de suite (le lien ne marche plus, la copie est effacée). */
  retirer(id: string): boolean {
    const l = this.actifs(), reste = l.filter((p) => p.id !== id);
    if (reste.length === l.length) return false;
    rmSync(this.copie(id), { force: true }); this.garder(reste);
    return true;
  }
  /** Retire tous les partages (d'une appli, ou de toutes) ; rend leur nombre. */
  retirerTout(appli?: string): number {
    const l = this.actifs(), pars = l.filter((p) => !appli || p.appli === appli);
    for (const p of pars) rmSync(this.copie(p.id), { force: true });
    if (pars.length) this.garder(l.filter((p) => !pars.includes(p)));
    return pars.length;
  }
}
