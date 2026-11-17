// Mathésis — lot 4 : le réseau de la maison. Odin lit ce que le propriétaire lui a OUVERT (une liste de dossiers
// choisie dans les réglages, vide par défaut), et rien d'autre.
//
// LECTURE SEULE, par construction : ce fichier n'ouvre les fichiers qu'en lecture (`readFileSync` drapeau « r »), ne
// crée, ne déplace, ne modifie et ne supprime jamais rien dans ces dossiers.
//
// JAMAIS AILLEURS : chaque dossier ouvert est résolu en son chemin RÉEL ; chaque entrée parcourue l'est aussi (liens
// symboliques et jonctions suivis PUIS recontrôlés, « .. » sans effet) et doit rester DANS un dossier ouvert réel et
// hors des dossiers interdits — sinon elle n'est ni lue ni parcourue. Un lecteur réseau n'est lu que s'il est lui-même
// ouvert : un lien qui y mène depuis un dossier ouvert est refusé.
//
// Un fichier inchangé (même taille et même date) n'est pas rouvert ; un fichier rouvert dont l'empreinte n'a pas changé
// n'est pas réanalysé. Budgets par jour : nombre de fichiers et taille lue. Les documents sont lus page par page par
// les lecteurs déjà là (PDF, Word, Excel, PowerPoint, OpenDocument, RTF, HTML, texte) ; une image n'est lue que si
// l'œil d'Odin est prêt, sinon c'est dit. Ce qui est lu est rangé par l'entrée commune d'apprentissage (source, date)
// et nourrit Noûs, en local : rien n'est envoyé à un modèle en ligne.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative } from 'node:path';
import type { Apport, ResultatApprentissage } from '../../learn/apprendre-de-tout.ts';
import type { Budget } from './budget.ts';
import type { Empreintes } from './empreintes.ts';
import { dossierInterdit } from './interdits.ts';
import type { Journal } from './journal.ts';
import type { Magasin } from './magasin.ts';
import { court, plier } from './outils.ts';
import { PHRASES_ARRET } from './reglages.ts';
import type { Interdits, RaisonArret, Reglages } from './types.ts';

export const FORMATS_TEXTE = ['txt', 'md', 'csv'] as const;
export const FORMATS_DOCS = ['pdf', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'html', 'htm', 'xhtml'] as const;
export const FORMATS_IMAGES = ['png', 'jpg', 'jpeg', 'webp', 'gif'] as const;
/** Au-delà, c'est du travail lourd (passage suivant, la nuit) : pas lu ici. */
export const TAILLE_MAX_FICHIER = 40 * 1024 * 1024;
export const ETATS_MAX = 20_000;
/** Un document décompressé au-delà de cette taille n'est pas lu dans les dossiers ouverts (travail léger). */
export const DECOMPRESSION_MAX = 20 * 1024 * 1024;
const FORMATS_ARCHIVES = ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'] as const;

/** La taille décompressée annoncée par une archive ZIP (répertoire central), sans rien décompresser ; Infinity si illisible. */
export function tailleDecompressee(buf: Buffer): number {
  try {
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return Infinity;
    const n = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16), total = 0;
    for (let k = 0; k < n; k++) {
      if (buf.readUInt32LE(p) !== 0x02014b50) return Infinity;
      total += buf.readUInt32LE(p + 24);
      p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    }
    return total;
  } catch { return Infinity; }
}
const PROFONDEUR_MAX = 8;

/** L'œil d'Odin pour une image avec du texte (absent tant qu'il n'est pas prêt). */
export type LireImage = (octets: Buffer, ext: string) => Promise<string | undefined>;

export interface EtatFichier { taille: number; mtimeMs: number; empreinte?: string; statut: 'lu' | 'pas_lu' | 'refus'; raison?: string; pages?: number; vu: number }

export interface BilanMaison {
  examines: number; lus: number; inchanges: number; refuses: Array<{ chemin: string; raison: string }>;
  pasLus: Array<{ chemin: string; raison: string }>; arret?: RaisonArret; racines: Array<{ dossier: string; ok: boolean; raison?: string }>;
}

/** Un chemin réel est-il dans (ou égal à) un dossier réel ? (insensible à la casse sous Windows, via path.relative) */
export function dedans(reel: string, racine: string): boolean {
  const r = relative(racine, reel);
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
}

/** Le chemin réel, ou undefined (absent, illisible, boucle). */
function reelDe(p: string): string | undefined { try { return realpathSync(p); } catch { return undefined; } }

/** Découpe un texte en parties (« pages ») : saut de page s'il y en a, sinon environ `taille` caractères par partie. */
export function parties(texte: string, taille = 4000): string[] {
  const t = String(texte ?? '');
  if (t.includes('\f')) return t.split('\f').map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  let reste = t.trim();
  while (reste.length > taille) {
    let coupe = reste.lastIndexOf('\n\n', taille);
    if (coupe < taille / 2) coupe = reste.lastIndexOf('\n', taille);
    if (coupe < taille / 2) coupe = taille;
    out.push(reste.slice(0, coupe).trim());
    reste = reste.slice(coupe).trim();
  }
  if (reste) out.push(reste);
  return out;
}

/** Lit un document page par page avec les lecteurs d'Odin (chargés tard). `approx` = pages découpées par Odin. */
export async function lirePages(octets: Buffer, chemin: string): Promise<{ pages: string[]; via: string; approx: boolean; lu: boolean }> {
  const ext = extname(chemin).slice(1).toLowerCase();
  try {
    if ((FORMATS_TEXTE as readonly string[]).includes(ext)) { const p = parties(octets.toString('utf8')); return { pages: p, via: 'texte', approx: !octets.includes(0x0c), lu: p.length > 0 }; }
    if (ext === 'pdf') {
      const { readPdf } = await import('../../files/pdf.ts');
      const r = readPdf(octets, chemin);
      if (r.text.includes('\f')) return { pages: parties(r.text), via: `PDF (${r.via})`, approx: false, lu: true };
      const n = Math.max(1, r.pages);
      const p = n > 1 ? parties(r.text, Math.max(500, Math.ceil(r.text.length / n))) : parties(r.text);
      return { pages: p, via: `PDF (${r.via}, ${r.pages} page(s) annoncée(s) ; découpage approximatif : le lecteur intégré ne sépare pas les pages)`, approx: true, lu: r.text.trim().length > 0 };
    }
    if (ext === 'docx') { const { readDocx } = await import('../../files/office.ts'); const t = readDocx(octets); return { pages: parties(t), via: 'Word', approx: true, lu: t.length > 0 }; }
    if (ext === 'pptx') { const { readPptx } = await import('../../files/office.ts'); const t = readPptx(octets); return { pages: t.split(/\n\n(?=## Diapositive )/).filter(Boolean), via: 'PowerPoint (une page par diapositive)', approx: false, lu: t.length > 0 }; }
    if (ext === 'xlsx') { const { readXlsx, toCsv } = await import('../../files/office.ts'); const f = readXlsx(octets, 500); return { pages: f.map((x) => `## ${x.name}\n${toCsv(x.rows)}`), via: 'Excel (une page par feuille)', approx: false, lu: f.length > 0 }; }
    const { lireDocument } = await import('../theia/documents.ts');
    const d = lireDocument(octets, ext);
    return { pages: d.lu ? parties(d.texte) : [], via: d.via, approx: true, lu: d.lu };
  } catch (e) {
    return { pages: [], via: `illisible (${court(String((e as Error)?.message ?? e), 80)})`, approx: false, lu: false };
  }
}

/** La première phrase utile d'une page (sans modèle : ce que retient Odin de la page ; le texte entier va à Noûs). */
function phraseUtile(page: string): string | undefined {
  for (const brute of page.split(/(?<=[.!?])\s+|\n+/)) {
    const p = brute.replace(/^[-#*\s]+/, '').replace(/\s+/g, ' ').trim();
    if (p.length >= 40 && p.length <= 300 && /[a-zA-ZÀ-ÿ]{3}/.test(p)) return p;
  }
  return undefined;
}

export interface OptionsMaison {
  magasin: Magasin;
  budget: Budget;
  empreintes: Empreintes;
  journal: Journal;
  reglages: () => Reglages;
  interdits: () => Interdits;
  garde: () => RaisonArret | undefined;
  apprendre: (a: Apport) => ResultatApprentissage;
  maintenant: () => number;
  /** L'œil d'Odin (Théia), s'il est prêt ; sinon les images sont dites « pas encore lues ». */
  lireImage?: () => LireImage | undefined;
  /** Bornes d'un passage. */
  parTour?: { entrees?: number; fichiers?: number };
}

export class LecteurMaison {
  private readonly o: OptionsMaison;
  constructor(o: OptionsMaison) { this.o = o; }

  etats(): Record<string, EtatFichier> { return this.o.magasin.lire<Record<string, EtatFichier>>('fichiers', {}); }
  private noter(chemin: string, e: EtatFichier): void {
    if (this.o.reglages().nePasGarder) return; // « ne pas garder » : aucun chemin ni empreinte rangés
    const t = { ...this.etats(), [chemin]: e };
    const cles = Object.keys(t);
    if (cles.length > ETATS_MAX) for (const k of cles.sort((a, b) => t[a].vu - t[b].vu).slice(0, cles.length - ETATS_MAX)) delete t[k];
    this.o.magasin.ecrire('fichiers', t);
  }

  /** Les dossiers ouverts, résolus en chemins réels (un dossier absent, illisible ou interdit est refusé et dit). */
  racines(): Array<{ dossier: string; reel?: string; raison?: string }> {
    const i = this.o.interdits();
    return this.o.reglages().dossiers.map((dossier) => {
      if (!isAbsolute(dossier)) return { dossier, raison: 'chemin non absolu' };
      const reel = reelDe(dossier);
      if (!reel) return { dossier, raison: 'introuvable ou illisible' };
      try { if (!statSync(reel).isDirectory()) return { dossier, raison: 'pas un dossier' }; } catch { return { dossier, raison: 'illisible' }; }
      if (dossierInterdit(i, dossier) || dossierInterdit(i, reel)) return { dossier, raison: 'dossier interdit par toi' };
      return { dossier, reel };
    });
  }

  /** Ce chemin réel peut-il être lu ? (dans un dossier ouvert réel, hors des dossiers interdits) */
  permis(reel: string, racinesReelles: string[]): boolean {
    if (!racinesReelles.some((r) => dedans(reel, r))) return false;
    return !dossierInterdit(this.o.interdits(), reel);
  }

  /** Un passage de lecture des dossiers ouverts, borné. Ne lève jamais. */
  async parcourir(signal?: AbortSignal): Promise<BilanMaison> {
    const bilan: BilanMaison = { examines: 0, lus: 0, inchanges: 0, refuses: [], pasLus: [], racines: [] };
    const maxEntrees = this.o.parTour?.entrees ?? 5000, maxLus = this.o.parTour?.fichiers ?? 50;
    const rac = this.racines();
    bilan.racines = rac.map((r) => ({ dossier: r.dossier, ok: Boolean(r.reel), ...(r.raison ? { raison: r.raison } : {}) }));
    const reelles = rac.map((r) => r.reel).filter((x): x is string => Boolean(x));
    // Les racines sont déjà « vues » : une jonction qui ramène au dossier ouvert ne le fait pas reparcourir.
    const vus = new Set<string>(reelles);
    const pile: Array<{ chemin: string; profondeur: number }> = reelles.map((r) => ({ chemin: r, profondeur: 0 }));
    let entrees = 0;
    try {
      while (pile.length) {
        const g = this.o.garde(); if (g) { bilan.arret = g; break; }
        if (signal?.aborted) { bilan.arret = 'abandon'; break; }
        if (entrees >= maxEntrees || bilan.lus >= maxLus) break;
        const { chemin, profondeur } = pile.shift()!;
        let noms: string[];
        try { noms = readdirSync(chemin).sort(); } catch { bilan.refuses.push({ chemin, raison: 'dossier illisible' }); continue; }
        for (const nom of noms) {
          if (entrees >= maxEntrees || bilan.lus >= maxLus) break;
          entrees++;
          const brut = join(chemin, nom);
          const reel = reelDe(brut);
          if (!reel) { bilan.refuses.push({ chemin: brut, raison: 'introuvable (lien cassé ?)' }); continue; }
          // Le lien, la jonction ou le « .. » qui mène hors d'un dossier ouvert (ou dans un dossier interdit) est refusé.
          if (!this.permis(reel, reelles) || dossierInterdit(this.o.interdits(), brut)) { bilan.refuses.push({ chemin: brut, raison: 'mène hors des dossiers ouverts, ou dans un dossier interdit' }); continue; }
          if (vus.has(reel)) continue;
          vus.add(reel);
          let st;
          try { st = statSync(reel); } catch { continue; }
          if (st.isDirectory()) {
            if (profondeur < PROFONDEUR_MAX) pile.push({ chemin: reel, profondeur: profondeur + 1 });
            else bilan.pasLus.push({ chemin: reel, raison: `trop profond (au-delà de ${PROFONDEUR_MAX} niveaux) : pas lu` });
            continue;
          }
          if (!st.isFile()) continue;
          const r = await this.fichier(reel, st.size, st.mtimeMs, bilan);
          if (r === 'arret') break;
        }
        if (bilan.arret) break;
      }
    } catch (e) {
      bilan.refuses.push({ chemin: '—', raison: `panne du passage : ${court(String((e as Error)?.message ?? e), 120)}` });
    }
    if (bilan.lus || bilan.arret) this.o.journal.noter({ genre: bilan.arret ? 'arret' : 'fichier', quoi: `dossiers ouverts : ${bilan.lus} fichier(s) lu(s), ${bilan.inchanges} inchangé(s) non relu(s)${bilan.arret ? ` — arrêt : ${PHRASES_ARRET[bilan.arret]}` : ''}` });
    return bilan;
  }

  /** Un fichier : inchangé → rien ; sinon lu (budget), empreinte, pages, rangement. Rend 'arret' si le travail doit cesser. */
  private async fichier(reel: string, taille: number, mtimeMs: number, bilan: BilanMaison): Promise<'ok' | 'arret'> {
    const ext = extname(reel).slice(1).toLowerCase();
    const image = (FORMATS_IMAGES as readonly string[]).includes(ext);
    if (!image && !(FORMATS_TEXTE as readonly string[]).includes(ext) && !(FORMATS_DOCS as readonly string[]).includes(ext)) return 'ok';
    bilan.examines++;
    const connu = this.etats()[reel];
    if (connu && connu.taille === taille && connu.mtimeMs === mtimeMs && connu.statut !== 'pas_lu') { bilan.inchanges++; return 'ok'; }
    const lireImage = image ? this.o.lireImage?.() : undefined;
    if (image && !lireImage) {
      if (!connu || connu.statut !== 'pas_lu') this.noter(reel, { taille, mtimeMs, statut: 'pas_lu', raison: 'image : l\'œil d\'Odin n\'est pas encore prêt, pas encore lue', vu: this.o.maintenant() });
      bilan.pasLus.push({ chemin: reel, raison: 'image : l\'œil d\'Odin n\'est pas encore prêt' });
      return 'ok';
    }
    if (taille > TAILLE_MAX_FICHIER) {
      this.noter(reel, { taille, mtimeMs, statut: 'refus', raison: 'trop gros pour le travail léger (passage suivant, la nuit)', vu: this.o.maintenant() });
      bilan.pasLus.push({ chemin: reel, raison: 'trop gros pour le travail léger' });
      return 'ok';
    }
    const g = this.o.garde(); if (g) { bilan.arret = g; return 'arret'; }
    if (this.o.budget.restant('fichiers') < 1 || this.o.budget.restant('octetsFichiers') < taille) { bilan.arret = 'budget'; return 'arret'; }
    this.o.budget.prendre('fichiers'); this.o.budget.prendre('octetsFichiers', taille);
    let octets: Buffer;
    try { octets = readFileSync(reel, { flag: 'r' }); } catch { bilan.refuses.push({ chemin: reel, raison: 'fichier illisible' }); return 'ok'; }
    // Un document Office ou OpenDocument est une archive : c'est sa taille DÉCOMPRESSÉE qui compte (budget et borne).
    const decompresse = (FORMATS_ARCHIVES as readonly string[]).includes(ext) ? tailleDecompressee(octets) : taille;
    if (decompresse > DECOMPRESSION_MAX) {
      const raison = Number.isFinite(decompresse) ? `trop gros une fois décompressé (${Math.round(decompresse / 1048576)} Mo, au-delà de ${DECOMPRESSION_MAX / 1048576} Mo)` : 'archive illisible (document abîmé)';
      this.noter(reel, { taille, mtimeMs, statut: 'refus', raison, vu: this.o.maintenant() });
      bilan.pasLus.push({ chemin: reel, raison });
      return 'ok';
    }
    if (decompresse > taille && !this.o.budget.prendre('octetsFichiers', decompresse - taille)) { bilan.arret = 'budget'; return 'arret'; }
    const empreinte = createHash('sha256').update(octets).digest('hex');
    const etat: EtatFichier = { taille, mtimeMs, empreinte, statut: 'lu', vu: this.o.maintenant() };
    if (connu?.empreinte === empreinte || this.o.empreintes.dejaAnalyse(`fichier:${empreinte}`)) {
      this.noter(reel, { ...etat, pages: connu?.pages });
      bilan.inchanges++;
      return 'ok';
    }
    let pages: string[], via: string, approx: boolean;
    if (image) {
      let t: string | undefined;
      try { t = await lireImage!(octets, ext); } catch { t = undefined; }
      pages = t?.trim() ? [t.trim()] : []; via = 'image lue par l\'œil d\'Odin'; approx = false;
    } else ({ pages, via, approx } = await lirePages(octets, reel));
    if (!pages.length) {
      this.noter(reel, { ...etat, statut: 'pas_lu', raison: `rien de lisible (${via})` });
      bilan.pasLus.push({ chemin: reel, raison: `rien de lisible (${via})` });
      if (!this.o.reglages().nePasGarder) this.o.empreintes.marquer(`fichier:${empreinte}`, court(reel, 160));
      return 'ok';
    }
    const nom = basename(reel);
    const faits = pages.slice(0, 20).map((p) => phraseUtile(p)).filter((x): x is string => Boolean(x)).map((texte) => ({ texte, sujet: plier(nom.replace(/\.[^.]+$/, '')).slice(0, 60) }));
    const garder = !this.o.reglages().nePasGarder;
    const souvenirs: number[] = [];
    if (garder) {
      const res = this.o.apprendre({ sorte: 'lecture', source: `fichier:${nom}`, date: Math.round(mtimeMs), faits, texte: pages.join('\n\n').slice(0, 50_000) });
      souvenirs.push(...res.souvenirs);
    }
    if (!this.o.reglages().nePasGarder) this.o.empreintes.marquer(`fichier:${empreinte}`, court(reel, 160));
    this.noter(reel, { ...etat, pages: pages.length });
    bilan.lus++;
    if (!garder) { this.o.journal.noter({ genre: 'ecarte', quoi: `a lu un fichier d'un dossier ouvert (${pages.length} page(s)) sans rien garder (réglage « ne pas garder »)` }); return 'ok'; }
    this.o.journal.noter({
      genre: garder ? 'fichier' : 'ecarte', quoi: `a lu « ${court(nom, 80)} » page par page (${pages.length} page(s), ${via}${approx ? ', pages découpées par Odin' : ''})${garder ? '' : ' sans rien garder (réglage « ne pas garder »)'}`,
      pourquoi: 'dossier ouvert par toi', source: reel,
      retenu: garder ? faits.slice(0, 10).map((f) => ({ texte: court(f.texte, 300), niveau: 'à vérifier' })) : [],
      ...(souvenirs.length ? { souvenirs } : {}),
    });
    return 'ok';
  }
}
