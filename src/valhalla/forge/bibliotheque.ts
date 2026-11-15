// La bibliothèque commune (Andromède pour les ISO, Hermès pour les logiciels) : un dossier choisi dans les réglages,
// scanné (tout fichier du bon genre, même déposé à la main, entre dans la bibliothèque), une fiche par fichier
// (reconnaissance, taille, dates, source, empreinte SHA-256, antivirus, dernière vérification, qui l'utilise),
// l'antivirus d'abord pour tout ce qui entre (quarantaine d'abord), l'import (envoi, lien, dossier, partage), et la
// vérification planifiée de toute la bibliothèque (mensuelle par défaut). Les anciennes versions rangées dans
// « old » par la forge y restent visibles (marquées « ancienne »).
// Les fiches vont dans la base de l'appli qui tient la bibliothèque (journal : Hydre pour les ISO, Hermès pour les logiciels).

import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { journalDe } from '../base/journal.ts';
import { lienPropre } from '../lien.ts';
import { quarantaineDabord, type Passage } from '../ullr/garde.ts';
import type { Action, ModCtx, Section, TacheAppli } from '../types.ts';
import { download } from './forge.ts';
import { tacheEnPause } from '../automatismes.ts';
import { depuisPlanVerif, fuseauOdin, instant, lireHeure, murale, prochaine, versPlanVerif, type Rythme } from '../../draupnir/rythme.ts';

export interface Fiche {
  id: string; nom: string; chemin: string; taille: number; sha256?: string; ajoute: number;
  /** comment elle est entrée : envoi, lien, dossier, partage, téléchargement de la forge, déposée à la main */
  origine: 'envoi' | 'lien' | 'dossier' | 'partage' | 'andromede' | 'hermes' | 'déposée';
  /** le lien de téléchargement d'origine (ou le dossier, le partage d'où elle vient) */
  source?: string;
  /** la page officielle */
  page?: string;
  antivirus?: { at: number; verdict: 'sain' | 'à vérifier' | 'bloqué' | 'non analysé'; texte: string };
  /** l'empreinte publiée par l'éditeur a été vérifiée au téléchargement (Andromède, Hermès) */
  editeur?: boolean;
  verifiee?: { at: number; ok: boolean; texte: string };
  /** ancienne version rangée dans « old » */
  ancienne?: boolean;
  /** icône ou logo (image en data:) */
  icone?: string;
  // Ce qui est reconnu (selon le genre)
  systeme?: string; detail?: string; distribution?: string; version?: string; arch?: string; edition?: string; efi?: boolean; pilotes?: boolean;
  /** logiciels : éditeur, produit, système visé */
  editeurNom?: string; produit?: string; vise?: string;
  /** qui l'utilise (machines d'Hydre, postes où il est installé) : calculé */
  utilisePar?: string[];
}
export interface Genre {
  id: 'iso' | 'logiciel'; libelle: string; libelles: string;
  /** les fichiers de ce genre */
  motif: RegExp;
  /** le sous-dossier où vont les fichiers importés */
  importes: string;
  /** le journal (base de l'appli) et son fichier d'avant la base */
  journal: string; fichierJournal: string;
  /** le réglage du plan de vérification */
  cleVerif: string;
  /** pour l'antivirus et les notifications */
  origine: string; usage: string; appli: string;
  reconnaitre(chemin: string, nom: string): Promise<Partial<Fiche>>;
  interieur?(chemin: string): Promise<Array<{ nom: string; donnees: Buffer }>>;
}
interface Evt { at: number; op: 'fiche' | 'retrait' | 'verification'; fiche?: Fiche; chemin: string; texte?: string }

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const slash = (p: string) => p.replace(/\\/g, '/');
const cle = (p: string) => slash(resolve(p));
export const idDe = (chemin: string) => createHash('sha256').update(cle(chemin)).digest('base64url').slice(0, 16);
export const sha256Fichier = (f: string) => new Promise<string>((ok, ko) => { const h = createHash('sha256'); createReadStream(f).on('data', (c) => h.update(c)).on('end', () => ok(h.digest('hex'))).on('error', ko); });
export const tailleTexte = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} Go` : n >= 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

// ---------------------------------------------------------------- Vérification planifiée (mensuelle par défaut)
export interface PlanVerif { frequence: 'jour' | 'semaine' | 'mois'; /** jour de la semaine (0 = dimanche) ou du mois (1 à 28) */ jour: number; heure: string; derniere?: number }
export const PLAN_DEFAUT: PlanVerif = { frequence: 'mois', jour: 1, heure: '04:00' };
export const planDe = (ctx: ModCtx, cleVerif: string): PlanVerif => ({ ...PLAN_DEFAUT, ...((ctx.settings[cleVerif] as Partial<PlanVerif> | undefined) ?? {}) });
/** Le prochain passage après `now` (et après la dernière vérification), à l'heure du lieu d'Odin (comme Talos l'écrit). Pur. */
export function prochaineVerif(p: PlanVerif, now: Date, fuseau?: string): Date {
  const apres = p.derniere && p.derniere > now.getTime() ? new Date(p.derniere) : now;
  return prochaine(depuisPlanVerif(p), apres, fuseau) ?? new Date(now.getTime() + 30 * 86_400_000);
}
/** La vérification est-elle due ? Jamais faite : à la première heure prévue ; sinon, le passage après la dernière est arrivé. Heure du lieu. Pur. */
export function verifDue(p: PlanVerif, now: Date, fuseau?: string): boolean {
  if (p.derniere) return prochaineVerif({ ...p, derniere: undefined }, new Date(p.derniere), fuseau) <= now;
  const tz = fuseauOdin(fuseau), w = murale(now.getTime(), tz), [h, m] = (lireHeure(p.heure) ?? '04:00').split(':').map(Number);
  const jour = p.frequence === 'jour' || (p.frequence === 'semaine' ? w.wd === p.jour : w.d === Math.max(1, Math.min(28, p.jour)));
  return jour && now >= instant(w.y, w.mo, w.d, h, m, tz);
}
/** Lit le formulaire du plan (fréquence, jour, heure). Pur. */
export function lirePlan(i: Record<string, unknown>, avant: PlanVerif): PlanVerif {
  const f = (['mois', 'semaine', 'jour'].includes(s(i.frequence)) ? s(i.frequence) : avant.frequence) as PlanVerif['frequence'];
  const h = /^\d{1,2}:\d\d$/.test(s(i.heure)) ? s(i.heure).padStart(5, '0') : avant.heure;
  const j = s(i.jour) === '' ? (f === 'semaine' ? Math.min(6, avant.jour) : avant.jour) : f === 'semaine' ? Math.max(0, Math.min(6, Number(i.jour) || 0)) : Math.max(1, Math.min(28, Number(i.jour) || 1));
  return { ...avant, frequence: f, jour: j, heure: h };
}
/** La tâche « vérification de la bibliothèque » déclarée pour Talos (son plan reste dans le réglage `cleVerif`). */
export function tacheVerification(o: { id: string; nom: string; quoi: string; cleVerif: string; action: string }): TacheAppli {
  return {
    id: o.id, nom: o.nom, quoi: o.quoi, permis: ['jour', 'semaine', 'mois'], lancer: { action: o.action },
    rythme: (ctx) => depuisPlanVerif(planDe(ctx, o.cleVerif)),
    regler: (ctx, r) => {
      const p = versPlanVerif(r as Rythme);
      if (!p) throw new Error('Pour cette vérification : tous les jours, un seul jour de la semaine, ou un jour du mois de 1 à 28.');
      ctx.saveSettings({ [o.cleVerif]: { ...planDe(ctx, o.cleVerif), frequence: p.frequence, jour: p.jour, heure: p.heure } });
    },
    dernier: (ctx) => { const d = planDe(ctx, o.cleVerif).derniere; return d ? { at: new Date(d).toISOString() } : undefined; },
    prochain: (ctx, now) => prochaineVerif(planDe(ctx, o.cleVerif), now),
  };
}
/** La tâche Talos qui suspend la vérification planifiée d'un genre : [appli, tâche]. */
export const tacheDuGenre = (g: Genre): [string, string] => (g.id === 'iso' ? ['ymir', 'verification_iso'] : ['fjalar', 'verification_logiciels']);
export const planTexte = (p: PlanVerif) => `chaque ${p.frequence}${p.frequence === 'mois' ? ` (le ${p.jour})` : p.frequence === 'semaine' ? ` (${['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][p.jour]})` : ''} à ${p.heure}`;

// ---------------------------------------------------------------- La bibliothèque d'un genre, dans un dossier
export interface Import { fiche?: Fiche; passage: Passage; texte: string }
export interface Verification { texte: string; abimes: string[]; bloques: string[]; nouvelles: string }
/** Les vérifications en cours, par genre (ISO, logiciels). */
const VERIFS_EN_COURS = new Map<string, Promise<Verification>>();
export class Bibliotheque {
  private static cache = new Map<string, { cle: string; r: Partial<Fiche> }>();
  readonly ctx: ModCtx; readonly genre: Genre; readonly racine: string;
  constructor(ctx: ModCtx, genre: Genre, racine: string) { this.ctx = ctx; this.genre = genre; this.racine = racine; }
  private journal() { return journalDe<Evt>(this.ctx, this.genre.journal, this.genre.fichierJournal, { garder: 5000, quand: (e) => e.at }); }
  get importes(): string { return join(this.racine, this.genre.importes); }
  get arrivees(): string { return join(this.racine, '.arrivees'); }

  /** Les fiches enregistrées (dernier état de chaque chemin). */
  fiches(): Map<string, Fiche> {
    const m = new Map<string, Fiche>();
    for (const e of this.journal().tout()) { const k = cle(e.chemin); if (e.op === 'retrait') m.delete(k); else if (e.op === 'fiche' && e.fiche) m.set(k, e.fiche); }
    return m;
  }
  noter(f: Fiche): Fiche { const { utilisePar: _u, ...g } = f; this.journal().ajouter({ at: Date.now(), op: 'fiche', fiche: g, chemin: f.chemin }); return f; }
  oublier(chemin: string): void { this.journal().ajouter({ at: Date.now(), op: 'retrait', chemin }); }

  /** Les fichiers du dossier (2 niveaux, « old » compris ; ni fichiers cachés ni téléchargements entamés). */
  fichiers(): Array<{ chemin: string; taille: number; mtime: number }> {
    const out: Array<{ chemin: string; taille: number; mtime: number }> = [];
    const walk = (d: string, depth: number) => { let n: string[] = []; try { n = readdirSync(d); } catch { return; } for (const x of n.sort()) { if (x.startsWith('.')) continue; const p = join(d, x); let st; try { st = statSync(p); } catch { continue; } if (st.isDirectory()) { if (depth < 3) walk(p, depth + 1); } else if (this.genre.motif.test(x)) out.push({ chemin: p, taille: st.size, mtime: st.mtimeMs }); } };
    walk(this.racine, 0);
    return out;
  }
  /** Les téléchargements et envois en cours (fichiers « .nom.part ») : visibles, jamais utilisables. */
  enCours(): Array<{ nom: string; chemin: string; recu: number }> {
    const out: Array<{ nom: string; chemin: string; recu: number }> = [];
    const walk = (d: string, depth: number) => { let n: string[] = []; try { n = readdirSync(d); } catch { return; } for (const x of n) { const p = join(d, x); let st; try { st = statSync(p); } catch { continue; } if (st.isDirectory()) { if (depth < 3 && x !== '.morceaux') walk(p, depth + 1); } else if (/^\..+\.part$/.test(x) && this.genre.motif.test(x.slice(1, -5))) out.push({ nom: x.slice(1, -5), chemin: p, recu: st.size }); } };
    walk(this.racine, 0);
    return out;
  }
  /** Toute la bibliothèque, avec les fiches ; un fichier sans fiche est reconnu à la demande (pas encore analysé). */
  async liste(): Promise<Fiche[]> {
    const connues = this.fiches(), out: Fiche[] = [];
    for (const x of this.fichiers()) {
      const k = connues.get(cle(x.chemin)), ancienne = /[\\/]old[\\/][^\\/]+$/.test(x.chemin);
      if (k) { out.push({ ...k, chemin: x.chemin, taille: x.taille, ancienne }); continue; }
      const c = Bibliotheque.cache.get(x.chemin), cl = `${x.taille}:${x.mtime}`;
      const r = c?.cle === cl ? c.r : await this.genre.reconnaitre(x.chemin, basename(x.chemin)).catch(() => ({})); Bibliotheque.cache.set(x.chemin, { cle: cl, r });
      out.push({ id: idDe(x.chemin), nom: basename(x.chemin), chemin: x.chemin, taille: x.taille, ajoute: x.mtime, origine: 'déposée', ancienne, ...r, antivirus: { at: 0, verdict: 'non analysé', texte: 'pas encore analysé (trouvé dans le dossier) : analysé au prochain passage' } });
    }
    return out;
  }
  /** Les fichiers du dossier qui n'ont pas encore de fiche (déposés à la main, copiés par un autre moyen). */
  sansFiche(): Array<{ chemin: string }> {
    const c = this.fiches(), now = Date.now();
    // Un gros fichier modifié à l'instant est sans doute encore en train d'être copié : il attend le passage suivant.
    return this.fichiers().filter((x) => !c.has(cle(x.chemin)) && !(x.taille > 64 * 1024 * 1024 && now - x.mtime < 30_000));
  }
  async trouver(q: unknown): Promise<Fiche> {
    const t = s(q).trim(), l = await this.liste(), low = t.toLowerCase(), sans = (n: string) => n.toLowerCase().replace(this.genre.motif, '');
    const f = l.find((x) => x.id === t || slash(x.chemin) === slash(t) || x.nom.toLowerCase() === low || sans(x.nom) === low) ?? (low.length >= 3 ? l.find((x) => x.nom.toLowerCase().includes(low) && !x.ancienne) ?? l.find((x) => x.nom.toLowerCase().includes(low)) : undefined);
    if (!f) throw new Error(t ? `${this.genre.libelle} introuvable dans la bibliothèque : « ${t} »` : `choisis ${this.genre.id === 'iso' ? 'l\'ISO' : 'le logiciel'}`);
    return f;
  }
  private dedans(p: string): boolean { const r = relative(resolve(this.racine), resolve(p)); return !r.startsWith('..') && !r.startsWith('.arrivees') && !/^\.|[\\/]\./.test(r); }

  /**
   * Fait entrer un fichier : l'antivirus d'abord (quarantaine d'abord), puis la fiche. Un fichier déjà dans le dossier
   * est enregistré sur place, sans copie ; sinon il est copié (ou déplacé, pour une arrivée) dans « importes ».
   */
  async importer(src: string, o: { nom?: string; origine: Fiche['origine']; source?: string; page?: string; deplacer?: boolean; editeur?: boolean }): Promise<Import> {
    if (!existsSync(src) || !statSync(src).isFile()) throw new Error(`fichier introuvable : ${src}`);
    let nom = (o.nom || basename(src)).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim() || 'fichier';
    if (this.genre.id === 'iso' && !/\.iso$/i.test(nom)) nom += '.iso';
    let final = src, travail = src;
    if (!this.dedans(src)) {
      mkdirSync(this.importes, { recursive: true });
      final = join(this.importes, nom);
      const k0 = nom.lastIndexOf('.'), b = k0 > 0 ? nom.slice(0, k0) : nom, e = k0 > 0 ? nom.slice(k0) : '';
      for (let k = 2; existsSync(final) && k < 1000; k++) final = join(this.importes, `${b} (${k})${e}`);
      // Le travail se fait sur un fichier caché « .part » : il n'apparaît dans la bibliothèque qu'une fois jugé sûr.
      travail = join(this.importes, `.${basename(final)}.part`);
      if (o.deplacer) { try { renameSync(src, travail); } catch { copyFileSync(src, travail); rmSync(src, { force: true }); } } else copyFileSync(src, travail);
    }
    const g = this.genre, origineTxt = ({ envoi: 'envoi depuis le navigateur', lien: 'lien', dossier: 'dossier', partage: 'partage réseau', andromede: 'Andromède', hermes: 'Hermès', 'déposée': 'déposé dans le dossier' } as Record<string, string>)[o.origine];
    const p = await quarantaineDabord({ fichier: travail, destination: final, nom: basename(final), origine: `${g.origine} (${origineTxt})`, source: o.source, usage: g.usage, ...(g.interieur ? { interieur: () => g.interieur!(travail) } : {}) }, this.ctx);
    if (p.bloque) { rmSync(travail, { force: true }); this.oublier(final); return { passage: p, texte: `${p.texte} Il n'entre pas dans la bibliothèque : décide dans Asclépios (accepter, refuser, libérer).` }; }
    if (travail !== final) renameSync(travail, final);
    const r = await g.reconnaitre(final, basename(final)).catch(() => ({} as Partial<Fiche>)), st = statSync(final), avant = this.fiches().get(cle(final));
    const f = this.noter({ ...(avant ?? {}), id: idDe(final), nom: basename(final), chemin: final, taille: st.size, sha256: p.sha256, ajoute: avant?.ajoute ?? Date.now(), origine: avant && o.origine === 'déposée' ? avant.origine : o.origine, ...(o.source ?? avant?.source ? { source: o.source ?? avant?.source } : {}), ...(o.page ?? avant?.page ? { page: o.page ?? avant?.page } : {}), ...(o.editeur !== undefined ? { editeur: o.editeur } : avant?.editeur !== undefined ? { editeur: avant.editeur } : {}), ...r, ancienne: /[\\/]old[\\/][^\\/]+$/.test(final), antivirus: { at: Date.now(), verdict: p.niveau ? 'à vérifier' : 'sain', texte: p.texte } });
    return { fiche: f, passage: p, texte: `${g.id === 'iso' ? '📀' : '📦'} ${f.nom} : ${f.detail ?? f.produit ?? ''}${f.systeme ? ` (${f.systeme})` : f.vise ? ` (${f.vise})` : ''} · ${tailleTexte(f.taille)} · empreinte ${p.sha256.slice(0, 16)}… · antivirus : ${p.niveau ? 'à vérifier' : 'rien trouvé'}.` };
  }
  /** Depuis un lien http(s) : téléchargement reprenable dans les arrivées, puis l'antivirus. */
  async importerLien(lien: string, nom?: string): Promise<Import> {
    const u = lienPropre(lien), fichier = (nom || decodeURIComponent(u.pathname.split('/').pop() || 'fichier')).replace(/[\\/:*?"<>|]/g, '_') || 'fichier';
    const r = await download(this.ctx.fetch, { version: '', url: u.toString(), file: fichier }, this.arrivees);
    return this.importer(r.path, { nom: fichier, origine: 'lien', source: u.toString(), deplacer: true });
  }
  /** Retire un fichier de la bibliothèque (le fichier est supprimé). */
  async retirer(q: unknown): Promise<Fiche> { const f = await this.trouver(q); rmSync(f.chemin, { force: true }); this.oublier(f.chemin); Bibliotheque.cache.delete(f.chemin); return f; }
  /** La forge a rangé une ancienne version dans « old » (ou l'a supprimée) : la fiche suit. */
  deplacee(de: string, vers: string): void {
    const c = this.fiches().get(cle(de)); this.oublier(de);
    if (c && vers) this.noter({ ...c, chemin: vers, id: idDe(vers), ancienne: true });
  }
  /** Fait entrer UN fichier trouvé sans fiche (un par passage : l'empreinte d'un gros fichier prend du temps). */
  async scanner(): Promise<Fiche | undefined> {
    const x = this.sansFiche()[0]; if (!x) return undefined;
    return (await this.importer(x.chemin, { origine: 'déposée', source: 'déposé dans le dossier' }).catch(() => undefined))?.fiche;
  }

  /**
   * Vérifie toute la bibliothèque : empreinte recalculée (fichier abîmé ?), nouvelle analyse antivirus, nouvelles
   * versions (`nouvelles`). Le compte rendu part en notification et reste dans l'historique.
   */
  verifier(nouvelles?: () => Promise<string>): Promise<Verification> {
    // Une seule vérification à la fois par genre : la surveillance de l'appli et « Lancer maintenant » dans Talos
    // reçoivent le même compte rendu au lieu de tout vérifier deux fois en même temps.
    const k = this.genre.id, deja = VERIFS_EN_COURS.get(k);
    if (deja) return deja;
    const p = this.verifierSeul(nouvelles).finally(() => VERIFS_EN_COURS.delete(k));
    VERIFS_EN_COURS.set(k, p);
    return p;
  }
  private async verifierSeul(nouvelles?: () => Promise<string>): Promise<Verification> {
    const l = await this.liste(), lignes: string[] = [], abimes: string[] = [], bloques: string[] = [], g = this.genre;
    for (const f of l) {
      const sum = await sha256Fichier(f.chemin).catch(() => ''), abime = Boolean(f.sha256 && sum && f.sha256 !== sum);
      if (abime) abimes.push(f.nom);
      const p = await quarantaineDabord({ fichier: f.chemin, nom: f.nom, origine: `${g.origine} (vérification planifiée)`, usage: g.usage, ...(g.interieur ? { interieur: () => g.interieur!(f.chemin) } : {}) }, this.ctx);
      if (p.bloque) { bloques.push(f.nom); lignes.push(`⛔ ${f.nom} : ${p.menace} → quarantaine`); this.oublier(f.chemin); continue; }
      const texte = abime ? 'empreinte changée : fichier abîmé ou modifié' : `empreinte ${f.sha256 ? 'identique' : 'mesurée'}, antivirus : ${p.niveau ? 'à vérifier' : 'rien trouvé'}`;
      this.noter({ ...f, sha256: f.sha256 ?? sum, antivirus: { at: Date.now(), verdict: p.niveau ? 'à vérifier' : 'sain', texte: p.texte }, verifiee: { at: Date.now(), ok: !abime, texte } });
      lignes.push(`${abime ? '❌' : '✔'} ${f.nom} : ${texte}`);
    }
    const nv = nouvelles ? await nouvelles().catch(() => '') : '';
    const texte = [`Vérification de ${l.length} ${g.libelles} : ${l.length - abimes.length - bloques.length} sain(s)${abimes.length ? `, ${abimes.length} abîmé(s)` : ''}${bloques.length ? `, ${bloques.length} en quarantaine` : ''}.`, ...lignes, ...(nv ? ['Nouvelles versions :', nv] : ['Pas de nouvelle version.'])].join('\n');
    this.journal().ajouter({ at: Date.now(), op: 'verification', chemin: this.racine, texte });
    this.ctx.saveSettings({ [g.cleVerif]: { ...planDe(this.ctx, g.cleVerif), derniere: this.ctx.now().getTime() } });
    this.ctx.alert({ level: abimes.length || bloques.length ? 'haute' : 'info', title: `${g.appli} : vérification des ${g.libelles} (${l.length})`, detail: texte.slice(0, 1500), key: `verif-${g.id}-${new Date().toISOString().slice(0, 10)}` });
    return { texte, abimes, bloques, nouvelles: nv };
  }
  comptesRendus(n = 20): Array<{ at: number; texte: string }> { return this.journal().tout().filter((e) => e.op === 'verification').slice(-n).reverse().map((e) => ({ at: e.at, texte: e.texte ?? '' })); }
  plan(): PlanVerif { return planDe(this.ctx, this.genre.cleVerif); }
  planifier(i: Record<string, unknown>): PlanVerif { const p = lirePlan(i, this.plan()); this.ctx.saveSettings({ [this.genre.cleVerif]: p }); return p; }
}

// ---------------------------------------------------------------- Logos et icônes génériques (dessinés ici, aucune marque copiée)
const svg = (corps: string, fond: string) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="${fond}"/>${corps}</svg>`).toString('base64')}`;
/**
 * Un petit logo générique par famille de système, dessiné ici : une fenêtre (Windows), un écran sur pied (macOS), un
 * manchot (Linux, une couleur par distribution), un hexagone (BSD), un disque (autre). Aucun logo de marque. Pur.
 */
export function logoSysteme(f: Pick<Fiche, 'systeme' | 'distribution' | 'detail' | 'pilotes'>): string {
  const d = `${f.distribution ?? ''} ${f.detail ?? ''}`.toLowerCase();
  if (f.pilotes) return svg('<rect x="11" y="13" width="18" height="14" rx="2" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M15 13v-3M20 13v-3M25 13v-3M15 27v3M20 27v3M25 27v3" stroke="#fff" stroke-width="2.4"/>', '#64748b');
  if (f.systeme === 'Windows') return svg('<rect x="9" y="11" width="22" height="18" rx="2.5" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M9 16.5h22" stroke="#fff" stroke-width="2.4"/><circle cx="12.6" cy="13.8" r="1" fill="#fff"/><circle cx="16" cy="13.8" r="1" fill="#fff"/>', '#0a6cd6');
  if (f.systeme === 'macOS') return svg('<rect x="9" y="10" width="22" height="15" rx="2.5" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M17 25l-1 5h8l-1-5M14 30h12" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>', '#6b7280');
  if (f.systeme === 'BSD') return svg('<path d="M20 8l10 6v12l-10 6-10-6V14z" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/><text x="20" y="24" font-family="system-ui,sans-serif" font-size="8" font-weight="800" fill="#fff" text-anchor="middle">BSD</text>', '#ab2b28');
  if (f.systeme === 'Linux') {
    // Un manchot stylisé pour toutes les distributions ; la couleur du fond dit laquelle.
    const fond = /ubuntu/.test(d) ? '#e95420' : /debian/.test(d) ? '#a80030' : /fedora/.test(d) ? '#3c6eb4' : /mint/.test(d) ? '#5fa04e' : /arch|manjaro/.test(d) ? '#1793d1' : /alpine/.test(d) ? '#0d597f' : /rocky|alma|red hat|rhel/.test(d) ? '#10b981' : /kali|tails/.test(d) ? '#367bf0' : /suse/.test(d) ? '#73ba25' : /proxmox/.test(d) ? '#e57000' : '#334155';
    return svg('<ellipse cx="20" cy="22" rx="7.5" ry="9.5" fill="#fff"/><ellipse cx="20" cy="23.5" rx="4.6" ry="6.4" fill="#f5c542"/><circle cx="17.6" cy="16" r="1.2" fill="#222"/><circle cx="22.4" cy="16" r="1.2" fill="#222"/><path d="M18.5 18.5h3l-1.5 1.6z" fill="#f59e0b"/>', fond);
  }
  return svg('<circle cx="20" cy="20" r="10" fill="none" stroke="#fff" stroke-width="2.4"/><circle cx="20" cy="20" r="2.6" fill="#fff"/>', '#475569');
}
/** Une icône générique par catégorie de logiciel (globe, chevrons, lecture, clé, bouclier, réseau, page). Pur. */
export function iconeCategorie(categorie: string): string {
  const c = categorie.toLowerCase();
  if (/internet|navigateur|courrier/.test(c)) return svg('<circle cx="20" cy="20" r="10" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M10 20h20M20 10c4 3.5 4 16.5 0 20M20 10c-4 3.5-4 16.5 0 20" fill="none" stroke="#fff" stroke-width="2"/>', '#0e7490');
  if (/d[ée]velop/.test(c)) return svg('<path d="M16 14l-6 6 6 6M24 14l6 6-6 6" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>', '#4338ca');
  if (/multim|vid[ée]o|son|image/.test(c)) return svg('<circle cx="20" cy="20" r="10" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M17.5 15.5v9l7.5-4.5z" fill="#fff"/>', '#b45309');
  if (/s[ée]curit/.test(c)) return svg('<path d="M20 9l9 3.4v6.6c0 5.6-3.9 9-9 10.2-5.1-1.2-9-4.6-9-10.2v-6.6z" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/><path d="M16 20l3 3 5-6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>', '#15803d');
  if (/r[ée]seau/.test(c)) return svg('<circle cx="20" cy="12" r="3" fill="#fff"/><circle cx="12" cy="27" r="3" fill="#fff"/><circle cx="28" cy="27" r="3" fill="#fff"/><path d="M20 15v5M20 20l-7 5M20 20l7 5" stroke="#fff" stroke-width="2.2"/>', '#7c3aed');
  if (/bureau/.test(c)) return svg('<path d="M13 9h10l5 5v17H13z" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/><path d="M17 19h7M17 23h7M17 27h4" stroke="#fff" stroke-width="2"/>', '#be185d');
  return svg('<path d="M27.5 12.5a5.5 5.5 0 0 0-7.6 6.4L11 27.8 13.2 30l8.9-8.9a5.5 5.5 0 0 0 6.4-7.6l-3.3 3.3-2.6-2.6z" fill="#fff"/>', '#475569');
}
/** Une icône générique par type d'installateur (quand le fichier n'en contient pas de lisible). Pur. */
export function iconeType(nom: string): string {
  const e = (/\.([a-z0-9]+)$/i.exec(nom)?.[1] ?? '').toLowerCase();
  const [lettres, fond] = ({ exe: ['EXE', '#0a6cd6'], msi: ['MSI', '#2563eb'], msix: ['MSIX', '#1d4ed8'], appx: ['APPX', '#1d4ed8'], msixbundle: ['MSIX', '#1d4ed8'], dmg: ['DMG', '#6b7280'], pkg: ['PKG', '#4b5563'], deb: ['DEB', '#a80030'], rpm: ['RPM', '#cc0000'], appimage: ['APP', '#0f766e'], apk: ['APK', '#3ddc84'], zip: ['ZIP', '#a16207'] } as Record<string, [string, string]>)[e] ?? ['?', '#475569'];
  return svg(`<path d="M12 9h11l5 5v17H12z" fill="#fff" opacity=".95"/><text x="20" y="27" font-family="system-ui,sans-serif" font-size="${lettres.length > 3 ? 6 : 7.5}" font-weight="800" fill="${fond}" text-anchor="middle">${lettres}</text>`, fond);
}

// ---------------------------------------------------------------- Actions et vue communes (Hermès ; Andromède passe par Hydre)
const date = (n?: number) => (n ? new Date(n).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
/** La fiche complète, en texte. Pur. */
export function ficheTexte(f: Fiche, g: Pick<Genre, 'id'>): string {
  return [`${g.id === 'iso' ? '📀' : '📦'} ${f.nom}${f.ancienne ? ' (ancienne version, dans « old »)' : ''}`,
    g.id === 'iso' ? `Système : ${f.systeme ?? '?'} · ${f.detail ?? ''}${f.version ? ` · version ${f.version}` : ''}${f.arch ? ` · ${f.arch}` : ''}${f.edition ? ` · ${f.edition}` : ''}`
      : `Logiciel : ${f.produit ?? f.nom}${f.editeurNom ? ` · éditeur ${f.editeurNom}` : ''}${f.version ? ` · version ${f.version}` : ''} · pour ${f.vise ?? '?'}${f.arch ? ` (${f.arch})` : ''}`,
    `Taille : ${tailleTexte(f.taille)} · ajouté le ${date(f.ajoute)}`,
    `Liens : ${f.page ? `page officielle ${f.page}` : 'pas de page officielle connue'}${f.source ? ` · origine ${f.source}` : ''}`,
    `Empreinte SHA-256 : ${f.sha256 ?? 'pas encore calculée'}${f.editeur === true ? ' · identique à celle publiée par l\'éditeur' : f.editeur === false ? ' · l\'éditeur n\'en publie pas' : ''}`,
    `Antivirus : ${f.antivirus?.verdict ?? 'non analysé'}${f.antivirus?.at ? ` (${date(f.antivirus.at)})` : ''}`,
    `Dernière vérification : ${f.verifiee ? `${date(f.verifiee.at)} · ${f.verifiee.texte}` : 'jamais'}`,
    `${g.id === 'iso' ? 'Machines qui l\'utilisent' : 'Installé sur'} : ${f.utilisePar?.length ? f.utilisePar.join(', ') : 'aucune'}`].join('\n');
}
/** Les cartes de la bibliothèque (logo ou icône, nom, version, état). Pur. */
export function cartes(l: Fiche[], g: Pick<Genre, 'id'>, o: { module?: string; fiche: string; onglet?: string }): Section {
  return { kind: 'cards', ...(o.onglet ? { onglet: o.onglet } : {}), title: `Bibliothèque (${l.length})`, empty: 'Rien dans le dossier pour l\'instant.', items: l.map((f) => ({ icon: f.icone ?? (g.id === 'iso' ? logoSysteme(f) : iconeType(f.nom)), title: f.nom,
    sub: g.id === 'iso' ? `${f.systeme ?? ''}${f.detail ? ` · ${f.detail}` : ''}${f.arch ? ` · ${f.arch}` : ''}` : `${f.produit ?? ''}${f.version ? ` ${f.version}` : ''}${f.editeurNom ? ` · ${f.editeurNom}` : ''} · ${f.vise ?? ''}`,
    meta: `${tailleTexte(f.taille)} · ${date(f.ajoute)}${f.sha256 ? ` · ${f.sha256.slice(0, 10)}…${f.editeur ? ' ✓ éditeur' : ''}` : ''}${f.utilisePar?.length ? ` · ${f.utilisePar.join(', ')}` : ''}`,
    badge: f.ancienne ? 'ancienne (old)' : f.antivirus?.verdict ?? 'non analysé', tone: f.antivirus?.verdict === 'sain' ? 'bon' as const : f.antivirus?.verdict === 'à vérifier' ? 'attention' as const : 'neutre' as const,
    actions: [{ action: o.fiche, label: 'Fiche', input: { nom: f.id, iso: f.id }, ...(o.module ? { module: o.module } : {}) }] })) } as Section;
}
/** Les actions de la bibliothèque d'une appli de la forge (Hermès) : liste, fiche, import, vérification planifiée. */
export function actionsBibliotheque(o: { genre: Genre; racine: (ctx: ModCtx) => string; nouvelles?: (ctx: ModCtx) => Promise<string>; utilisePar?: (ctx: ModCtx) => Promise<Map<string, string[]>> }): Action[] {
  const B = (ctx: ModCtx) => new Bibliotheque(ctx, o.genre, o.racine(ctx)), g = o.genre;
  const liste = async (ctx: ModCtx) => { const l = await B(ctx).liste(), u = o.utilisePar ? await o.utilisePar(ctx).catch(() => new Map<string, string[]>()) : new Map<string, string[]>(); for (const f of l) f.utilisePar = u.get(f.chemin) ?? u.get(f.produit ?? '') ?? []; return l; };
  return [
    { id: 'bibliotheque', label: 'Bibliothèque', what: `Tous les ${g.libelles} du dossier (téléchargés, importés, déposés à la main, anciens dans « old ») avec leur fiche`, read: true, words: [`bibliotheque des ${g.libelles}`], run: async (ctx) => { const l = await liste(ctx); return { text: l.map((f) => `- ${f.nom} · ${f.produit ?? f.detail ?? ''}${f.version ? ` ${f.version}` : ''} · ${tailleTexte(f.taille)} · antivirus : ${f.antivirus?.verdict ?? 'non analysé'}${f.ancienne ? ' · ancienne' : ''}`).join('\n') || `Rien dans ${o.racine(ctx)}.`, data: { dossier: o.racine(ctx), fichiers: l, enCours: B(ctx).enCours() } }; } },
    { id: 'fiche', label: 'Fiche', what: `Tout sur un ${g.libelle} : icône, nom, éditeur, version, système visé, taille, dates, liens, empreinte, antivirus, vérification, où il sert`, read: true, params: [{ key: 'nom', label: g.libelle, kind: 'text', required: true }], run: async (ctx, i) => { const f0 = await B(ctx).trouver(i.nom), f = (await liste(ctx)).find((x) => x.chemin === f0.chemin) ?? f0; return { text: ficheTexte(f, g), data: f }; } },
    { id: 'importer', label: `Importer un ${g.libelle}`, what: 'Depuis un lien http(s) ou un fichier de ce PC (ou d\'un partage monté) : antivirus d\'abord, puis rangé dans le dossier', external: true, params: [{ key: 'lien', label: 'Lien http(s)', kind: 'text', default: '' }, { key: 'chemin', label: 'Ou un fichier', kind: 'text', default: '' }, { key: 'nom', label: 'Nom (facultatif)', kind: 'text', default: '' }], run: async (ctx, i) => {
      const r = s(i.lien) ? await B(ctx).importerLien(s(i.lien), s(i.nom) || undefined) : s(i.chemin) ? await B(ctx).importer(s(i.chemin), { nom: s(i.nom) || undefined, origine: 'dossier', source: s(i.chemin) }) : undefined;
      if (!r) throw new Error('donne un lien ou un fichier'); return { ok: !r.passage.bloque, text: r.texte, data: r.fiche };
    } },
    { id: 'verification', label: `Planifier la vérification des ${g.libelles}`, what: 'Chaque mois par défaut : empreinte recalculée, antivirus, nouvelles versions, compte rendu', params: [{ key: 'frequence', label: 'Fréquence', kind: 'select', options: ['mois', 'semaine', 'jour'], default: 'mois' }, { key: 'jour', label: 'Jour (1 à 28 ; ou 0 = dimanche à 6)', kind: 'number', default: 1 }, { key: 'heure', label: 'Heure (HH:MM)', kind: 'text', default: '04:00' }], run: (ctx, i) => { const p = B(ctx).planifier(i); return { text: `🗓 Vérification des ${g.libelles} : ${planTexte(p)}. Prochaine : ${prochaineVerif(p, ctx.now()).toLocaleString('fr-FR')}.`, data: { ...p, prochaine: prochaineVerif(p, ctx.now()).toISOString() } }; } },
    { id: 'plan_verification', quick: false, label: 'Plan de vérification', what: 'Quand la bibliothèque est vérifiée, et le prochain passage', read: true, run: (ctx) => { const p = B(ctx).plan(), n = prochaineVerif(p, ctx.now()); return { text: `${planTexte(p)} · prochaine : ${n.toLocaleString('fr-FR')}`, data: { ...p, prochaine: n.toISOString() } }; } },
    { id: 'verifier_tout', label: `Vérifier tous les ${g.libelles}`, what: 'Maintenant : empreinte, antivirus, nouvelles versions ; compte rendu', run: async (ctx) => { const r = await B(ctx).verifier(o.nouvelles ? () => o.nouvelles!(ctx) : undefined); return { text: r.texte, data: r }; } },
    { id: 'comptes_rendus', quick: false, label: 'Comptes rendus des vérifications', what: 'L\'historique des vérifications', read: true, run: (ctx) => { const l = B(ctx).comptesRendus(); return { text: l.map((x) => `— ${date(x.at)}\n${x.texte}`).join('\n') || 'Aucune vérification faite.', data: l }; } },
  ];
}
/** La surveillance commune : un fichier déposé à la main entre dans la bibliothèque ; la vérification se fait à son heure. */
export async function surveiller(ctx: ModCtx, g: Genre, racine: string, nouvelles?: () => Promise<string>): Promise<void> {
  const b = new Bibliotheque(ctx, g, racine);
  await b.scanner();
  if (verifDue(b.plan(), ctx.now()) && !tacheEnPause(...tacheDuGenre(g))) await b.verifier(nouvelles);
}
