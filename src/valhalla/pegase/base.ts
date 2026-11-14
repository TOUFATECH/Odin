// Pégase dans la base d'Odin (PostgreSQL, schéma « pegase ») : les tables, les vues pour Odin, le support du magasin,
// la migration automatique des fichiers au premier passage (copie de secours, données comparées avant/après) et le
// retour en fichiers.
//
// La mémoire du magasin reste la même : la base est lue une fois au démarrage, puis chaque écriture passe par le
// journal d'attente (rejouable : upsert avec la même règle de conflit que la synchro) et part dans la base.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BaseAttente, inscrireMigrable, type AppliBase, type BaseOdin, type DefAppli, type Valeur } from '../base/index.ts';
import { COLS, jourDe, SupportFichiers, type Appareil, type Col, type Copie, type Magasin, type Prefs, type Rec, type Support } from './store.ts';

export const DEF_PEGASE: DefAppli = {
  id: 'pegase',
  migrations: [{
    v: 1, nom: 'données synchronisées de Pégase',
    sql: `
CREATE TABLE enregistrements (profil text NOT NULL, col text NOT NULL, id text NOT NULL, data jsonb NOT NULL DEFAULT '{}', maj bigint NOT NULL, appareil text NOT NULL, suppr boolean NOT NULL DEFAULT false, jour date, PRIMARY KEY (profil, col, id));
CREATE INDEX enregistrements_maj ON enregistrements (profil, col, maj);
CREATE TABLE prefs (profil text PRIMARY KEY, voir text NOT NULL, agenda_cle text);
CREATE TABLE appareils (id text PRIMARY KEY, profil text NOT NULL, nom text NOT NULL, plateforme text NOT NULL, cree bigint NOT NULL, vu bigint NOT NULL, ip text, jeton text, sso text, revoque bigint, synchro bigint, envoyes integer NOT NULL DEFAULT 0, recus integer NOT NULL DEFAULT 0);
CREATE TABLE copies (profil text NOT NULL, id text NOT NULL, date bigint NOT NULL, raison text NOT NULL, nombres jsonb NOT NULL, cols jsonb NOT NULL, PRIMARY KEY (profil, id));
-- Les vues qu'Odin peut lire (compte odin_lecture) : jamais les empreintes de jetons ni les adresses IP ;
-- l'historique seulement des profils qui ont choisi « Odin voit tout », rien du tout pour « Odin ne voit rien ».
CREATE VIEW v_historique AS SELECT e.profil, e.id, e.data->>'url' AS adresse, e.data->>'titre' AS titre, e.data->>'recherche' AS recherche, to_timestamp(COALESCE((e.data->>'date')::bigint, e.maj) / 1000.0) AS quand, e.jour
  FROM enregistrements e JOIN prefs p ON p.profil = e.profil AND p.voir = 'tout' WHERE e.col = 'historique' AND NOT e.suppr;
CREATE VIEW v_donnees AS SELECT e.profil, e.col AS collection, e.id, e.data AS donnees, to_timestamp(e.maj / 1000.0) AS modifie
  FROM enregistrements e LEFT JOIN prefs p ON p.profil = e.profil WHERE e.col NOT IN ('historique', 'reglages') AND NOT e.suppr AND COALESCE(p.voir, 'sans-historique') <> 'rien';
CREATE VIEW v_agenda AS SELECT profil, id, donnees->>'titre' AS titre, donnees->>'debut' AS debut, donnees->>'fin' AS fin, donnees->>'lieu' AS lieu, modifie FROM v_donnees WHERE collection = 'agenda';
CREATE VIEW v_appareils AS SELECT profil, nom, plateforme, to_timestamp(cree / 1000.0) AS cree, to_timestamp(vu / 1000.0) AS vu, to_timestamp(synchro / 1000.0) AS synchro, revoque IS NOT NULL AS revoque, envoyes, recus FROM appareils;
GRANT SELECT ON v_historique, v_donnees, v_agenda, v_appareils TO odin_lecture`,
  }],
  ecritures: {
    /** des enregistrements d'un profil ($1), en lot ($2 : JSON) ; la règle de conflit de la synchro : le plus récent gagne */
    recs: `INSERT INTO enregistrements (profil, col, id, data, maj, appareil, suppr, jour)
      SELECT $1::text, x.col, x.id, COALESCE(x.data, jsonb_build_object()), x.maj, x.appareil, x.suppr, x.jour FROM jsonb_to_recordset($2::jsonb) AS x(col text, id text, data jsonb, maj bigint, appareil text, suppr boolean, jour date)
      ON CONFLICT (profil, col, id) DO UPDATE SET data = EXCLUDED.data, maj = EXCLUDED.maj, appareil = EXCLUDED.appareil, suppr = EXCLUDED.suppr, jour = EXCLUDED.jour
      WHERE EXCLUDED.maj > enregistrements.maj OR (EXCLUDED.maj = enregistrements.maj AND EXCLUDED.appareil COLLATE "C" < enregistrements.appareil COLLATE "C")`,
    prefs: 'INSERT INTO prefs (profil, voir, agenda_cle) VALUES ($1, $2, $3) ON CONFLICT (profil) DO UPDATE SET voir = EXCLUDED.voir, agenda_cle = EXCLUDED.agenda_cle',
    appareil: `INSERT INTO appareils SELECT * FROM jsonb_populate_record(NULL::appareils, $1::jsonb)
      ON CONFLICT (id) DO UPDATE SET profil = EXCLUDED.profil, nom = EXCLUDED.nom, plateforme = EXCLUDED.plateforme, cree = EXCLUDED.cree, vu = EXCLUDED.vu, ip = EXCLUDED.ip, jeton = EXCLUDED.jeton, sso = EXCLUDED.sso, revoque = EXCLUDED.revoque, synchro = EXCLUDED.synchro, envoyes = EXCLUDED.envoyes, recus = EXCLUDED.recus`,
    copie: 'INSERT INTO copies (profil, id, date, raison, nombres, cols) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb) ON CONFLICT (profil, id) DO UPDATE SET date = EXCLUDED.date, raison = EXCLUDED.raison, nombres = EXCLUDED.nombres, cols = EXCLUDED.cols',
    copie_effacer: 'DELETE FROM copies WHERE profil = $1 AND id = $2',
  },
};
const LOT = 1000;
const ligneRec = (r: Rec, jour: string | null) => ({ col: r.col, id: r.id, data: r.data ?? {}, maj: Math.trunc(r.maj), appareil: r.appareil, suppr: Boolean(r.suppr), jour });
function lots<T>(l: T[], n = LOT): T[][] { const o: T[][] = []; for (let i = 0; i < l.length; i += n) o.push(l.slice(i, i + n)); return o; }
const num = (v: string | null) => (v === null ? undefined : Number(v));

/** Les données Pégase dans la base d'Odin (lues une fois, puis tenues à jour par le journal d'attente). */
export class SupportBase implements Support {
  readonly nom = 'base' as const;
  readonly appli: AppliBase;
  private lu = false;
  private pr: Record<string, Prefs> = {};
  private apps: Appareil[] = [];
  private profils = new Map<string, { cols: Map<Col, Rec[]>; hist: Array<[string, Rec]> }>();
  private noms = new Set<string>();
  private cop = new Map<string, Copie[]>();
  private octets = new Map<string, number>();
  constructor(a: AppliBase) { this.appli = a; }
  pret(): boolean { return this.lu; }

  /** Lit tout dans la base (après avoir envoyé ce qui attendait). */
  async charger(): Promise<void> {
    await this.appli.vider();
    const pr: Record<string, Prefs> = {};
    for (const [p, v, k] of (await this.appli.q('SELECT profil, voir, agenda_cle FROM prefs')).rows) pr[p!] = { voir: v as Prefs['voir'], ...(k ? { agendaCle: k } : {}) };
    const apps = (await this.appli.q('SELECT id, profil, nom, plateforme, cree, vu, ip, jeton, sso, revoque, synchro, envoyes, recus FROM appareils ORDER BY cree, id')).rows.map(([id, profil, nom, plateforme, cree, vu, ip, jeton, sso, revoque, synchro, envoyes, recus]) => {
      const a: Appareil = { id: id!, profil: profil!, nom: nom!, plateforme: plateforme!, cree: Number(cree), vu: Number(vu), envoyes: Number(envoyes), recus: Number(recus) };
      if (ip !== null) a.ip = ip; if (jeton !== null) a.jeton = jeton; if (sso !== null) a.sso = sso; if (revoque !== null) a.revoque = num(revoque); if (synchro !== null) a.synchro = num(synchro);
      return a;
    });
    const profils = new Map<string, { cols: Map<Col, Rec[]>; hist: Array<[string, Rec]> }>(), octets = new Map<string, number>();
    const prof = (pid: string) => { let p = profils.get(pid); if (!p) { p = { cols: new Map(COLS.filter((c) => c !== 'historique').map((c) => [c, [] as Rec[]])), hist: [] }; profils.set(pid, p); } return p; };
    for (const [pid, col, id, data, maj, appareil, suppr, jour] of (await this.appli.q('SELECT profil, col, id, data::text, maj, appareil, suppr, to_char(jour, $1) FROM enregistrements ORDER BY profil, col, maj, id', ['YYYY-MM-DD'])).rows) {
      const r: Rec = { id: id!, col: col as Col, data: JSON.parse(data!) as Record<string, unknown>, maj: Number(maj), appareil: appareil!, ...(suppr === 't' ? { suppr: true as const } : {}) };
      const p = prof(pid!); octets.set(pid!, (octets.get(pid!) ?? 0) + data!.length + 60);
      if (r.col === 'historique') p.hist.push([jour ?? jourDe(r.maj), r]); else p.cols.get(r.col)?.push(r);
    }
    const cop = new Map<string, Copie[]>();
    for (const [pid, id, date, raison, nombres] of (await this.appli.q('SELECT profil, id, date, raison, nombres::text FROM copies ORDER BY date DESC')).rows) {
      cop.set(pid!, [...(cop.get(pid!) ?? []), { id: id!, date: Number(date), raison: raison as Copie['raison'], nombres: JSON.parse(nombres!) as Record<string, number> }]);
    }
    this.pr = pr; this.apps = apps; this.profils = profils; this.octets = octets; this.cop = cop;
    this.noms = new Set([...profils.keys(), ...cop.keys()]);
    this.lu = true;
  }
  /** Remplit la mémoire depuis un instantané (migration : rien à relire). */
  remplir(snap: ReturnType<Magasin['instantane']>, copies: Map<string, Array<Copie & { cols: Record<string, Rec[]> }>>): void {
    this.pr = structuredClone(snap.prefs); this.apps = structuredClone(snap.appareils); this.profils.clear();
    for (const [pid, p] of snap.profils) this.noms.add(pid);
    for (const [pid, l] of copies) { this.noms.add(pid); this.cop.set(pid, l.map((c) => ({ id: c.id, date: c.date, raison: c.raison, nombres: c.nombres })).sort((a, b) => b.date - a.date)); }
    for (const [pid, p] of snap.profils) this.octets.set(pid, [...p.cols.values()].reduce((n, l) => n + l.reduce((k, r) => k + JSON.stringify(r.data).length + 60, 0), 0));
    this.lu = true;
  }
  lirePrefs(): Record<string, Prefs> { return this.pr; }
  ecrirePrefs(tout: Record<string, Prefs>, pid: string): void { const p = tout[pid]; if (p) this.appli.ecrire(['prefs', pid, p.voir, p.agendaCle ?? null]); }
  lireAppareils(): Appareil[] { return this.apps; }
  ecrireAppareils(_tous: Appareil[], a: Appareil): void { this.appli.ecrire(['appareil', JSON.stringify(a)]); }
  personnes(): string[] { return [...this.noms]; }
  lireProfil(pid: string): { cols: Map<Col, Rec[]>; hist: Array<[string, Rec]> } {
    // Une fois lu, le profil vit dans la mémoire du magasin : on ne le garde pas deux fois.
    const p = this.profils.get(pid); this.profils.delete(pid); this.noms.add(pid);
    return p ?? { cols: new Map(), hist: [] };
  }
  ecrireCol(pid: string, _c: Col, _tous: Iterable<Rec>, changes: Rec[]): void {
    if (!changes.length) return; this.noms.add(pid);
    this.octets.set(pid, (this.octets.get(pid) ?? 0) + changes.reduce((n, r) => n + JSON.stringify(r.data).length + 60, 0));
    this.appli.ecrire(...lots(changes).map((l): [string, ...Valeur[]] => ['recs', pid, JSON.stringify(l.map((r) => ligneRec(r, null)))]));
  }
  ajouterHistorique(pid: string, parJour: Map<string, Rec[]>): void {
    const l = [...parJour].flatMap(([j, rs]) => rs.map((r) => ligneRec(r, j))); if (!l.length) return; this.noms.add(pid);
    this.octets.set(pid, (this.octets.get(pid) ?? 0) + l.length * 120);
    this.appli.ecrire(...lots(l).map((x): [string, ...Valeur[]] => ['recs', pid, JSON.stringify(x)]));
  }
  copies(pid: string): Copie[] { return [...(this.cop.get(pid) ?? [])]; }
  ecrireCopie(pid: string, c: Copie, cols: Record<string, Rec[]>): void {
    this.noms.add(pid); this.cop.set(pid, [c, ...(this.cop.get(pid) ?? []).filter((x) => x.id !== c.id)].sort((a, b) => b.date - a.date));
    this.appli.ecrire(['copie', pid, c.id, c.date, c.raison, JSON.stringify(c.nombres), JSON.stringify(cols)]);
  }
  effacerCopie(pid: string, id: string): void { this.cop.set(pid, (this.cop.get(pid) ?? []).filter((x) => x.id !== id)); this.appli.ecrire(['copie_effacer', pid, id]); }
  async lireCopie(pid: string, id: string): Promise<(Copie & { cols: Record<string, Rec[]> }) | undefined> {
    if (!this.appli.prete) throw new BaseAttente('la base de Pégase');
    await this.appli.vider();
    const r = (await this.appli.q('SELECT date, raison, nombres::text, cols::text FROM copies WHERE profil = $1 AND id = $2', [pid, id])).rows[0];
    return r ? { id, date: Number(r[0]), raison: r[1] as Copie['raison'], nombres: JSON.parse(r[2]!) as Record<string, number>, cols: JSON.parse(r[3]!) as Record<string, Rec[]> } : undefined;
  }
  taille(pid: string): number { return this.octets.get(pid) ?? 0; }
}

// ---------------- Branchement, migration, retour ----------------
const EN_BASE = 'en-base.json', RETOUR = 'fichiers.json';
const horodatage = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
export interface EtatPegase { support: 'fichiers' | 'base'; pret: boolean; attente: number; message: string }

/** Les données exactes d'un magasin (pour comparer avant / après). */
export function compter(snap: ReturnType<Magasin['instantane']>, copies: Map<string, Copie[]>): { recs: Record<string, number>; prefs: number; appareils: number; copies: number } {
  const recs: Record<string, number> = {};
  for (const p of snap.profils.values()) for (const [c, l] of p.cols) recs[c] = (recs[c] ?? 0) + l.length;
  return { recs, prefs: Object.keys(snap.prefs).length, appareils: snap.appareils.length, copies: [...copies.values()].reduce((n, l) => n + l.length, 0) };
}

/**
 * Branche le magasin de Pégase sur la base d'Odin :
 * - données déjà en base (repère en-base.json) : lues dès que la base est prête (avant : « base pas prête ») ;
 * - données en fichiers : migrées au premier passage (copie de secours, comparaison avant/après), puis en base ;
 * - retour en fichiers demandé (repère fichiers.json) : on n'y touche plus.
 */
export function brancherPegase(m: Magasin, b: BaseOdin, o: { log?: (t: string) => void; alerte?: (titre: string, detail: string) => void } = {}): void {
  const log = o.log ?? ((t: string) => console.log(`[pegase] ${t}`));
  if (existsSync(join(m.dir, RETOUR))) { log('données gardées en fichiers (retour demandé) : « repasser en base » dans Alexandrie pour les remettre dans la base'); }
  const a = b.appli(DEF_PEGASE, m.dir);
  let sb = m.support instanceof SupportBase ? m.support : new SupportBase(a);
  if (existsSync(join(m.dir, EN_BASE)) && m.support.nom === 'fichiers') m.changerSupport(sb, { oublier: true });
  let enCours: Promise<void> | undefined;
  const quandPrete = () => {
    enCours ??= (async () => {
      if (existsSync(join(m.dir, RETOUR))) return;
      if (m.support === sb) { if (!sb.pret()) { await sb.charger(); log('données lues dans la base d\'Odin'); } return; }
      const r = await migrer(m, sb); log(r);
    })().catch((e) => { log(`base : ${(e as Error).message}`); if (!(e instanceof BaseAttente)) o.alerte?.('Pégase : passage dans la base d\'Odin en échec', `${(e as Error).message}. Les données restent utilisables ; Odin réessaiera au prochain démarrage.`); }).finally(() => { enCours = undefined; });
    return enCours;
  };
  a.on('prete', () => void quandPrete());
  if (a.prete) void quandPrete();
  inscrireMigrable({
    id: 'pegase', nom: 'Pégase',
    etat: () => etatPegase(m),
    attendre: async () => { await quandPrete(); await a.vider(); },
    retour: async () => { const t = await retourFichiers(m, 'à ta demande'); sb = new SupportBase(a); return t; },
    repasser: async () => { rmSync(join(m.dir, RETOUR), { force: true }); await quandPrete(); return m.support.nom === 'base' ? '🗄 Pégase est de nouveau dans la base d\'Odin.' : '⏳ Pégase repassera dans la base dès qu\'elle sera prête.'; },
  });
}

export function etatPegase(m: Magasin): EtatPegase {
  const s = m.support, att = s instanceof SupportBase ? s.appli.attente.taille : 0;
  const message = s.nom === 'fichiers' ? (existsSync(join(m.dir, RETOUR)) ? 'en fichiers (retour demandé)' : 'en fichiers (passera dans la base dès qu\'elle sera prête)')
    : !s.pret() ? 'dans la base, en attente qu\'elle réponde' : att ? `dans la base (${att} écriture(s) en attente sur le disque)` : 'dans la base';
  return { support: s.nom, pret: s.pret(), attente: att, message };
}

/** Fichiers → base : tout est écrit, envoyé, recompté ; puis les fichiers vont dans une copie de secours. */
export async function migrer(m: Magasin, sb: SupportBase): Promise<string> {
  if (!(m.support instanceof SupportFichiers)) return 'déjà dans la base';
  const f = m.support;
  // Instantané et changement de support d'un seul tenant (rien ne s'intercale : pas d'attente entre les deux).
  const snap = m.instantane(), copies = new Map<string, Array<Copie & { cols: Record<string, Rec[]> }>>();
  for (const pid of new Set([...snap.profils.keys(), ...f.personnes()])) { const l = f.copies(pid).map((c) => f.lireCopieTout(pid, c.id)).filter((x): x is Copie & { cols: Record<string, Rec[]> } => Boolean(x)); if (l.length) copies.set(pid, l); }
  const avant = compter(snap, copies);
  sb.remplir(snap, copies); m.changerSupport(sb);
  const a = sb.appli, lignes: Array<[string, ...Valeur[]]> = [];
  for (const [pid, p] of Object.entries(snap.prefs)) lignes.push(['prefs', pid, p.voir, p.agendaCle ?? null]);
  for (const x of snap.appareils) lignes.push(['appareil', JSON.stringify(x)]);
  for (const [pid, p] of snap.profils) {
    const recs = [...p.cols].flatMap(([c, l]) => l.map((r) => ligneRec(r, c === 'historique' ? p.jourDe.get(r.id) ?? jourDe(r.maj) : null)));
    for (const l of lots(recs)) lignes.push(['recs', pid, JSON.stringify(l)]);
  }
  for (const [pid, l] of copies) for (const c of l) lignes.push(['copie', pid, c.id, c.date, c.raison, JSON.stringify(c.nombres), JSON.stringify(c.cols)]);
  if (lignes.length) a.ecrire(...lignes);
  await a.vider();
  // Recompte dans la base : tout doit y être.
  const recs: Record<string, number> = {};
  for (const [c, n] of (await a.q('SELECT col, count(*) FROM enregistrements GROUP BY col')).rows) recs[c!] = Number(n);
  const n = async (t: string) => Number((await a.q(`SELECT count(*) FROM ${t}`)).rows[0][0]);
  const apres = { recs, prefs: await n('prefs'), appareils: await n('appareils'), copies: await n('copies') };
  const manque = [...Object.entries(avant.recs).filter(([c, k]) => (apres.recs[c] ?? 0) < k).map(([c, k]) => `${c} ${apres.recs[c] ?? 0}/${k}`), ...(['prefs', 'appareils', 'copies'] as const).filter((k) => apres[k] < avant[k]).map((k) => `${k} ${apres[k]}/${avant[k]}`)];
  if (manque.length) { await retourFichiers(m, `migration incomplète (${manque.join(', ')})`); throw new Error(`la migration vers la base n'est pas complète (${manque.join(', ')}) : Pégase reste en fichiers`); }
  // Copie de secours : les fichiers d'avant partent dans avant-base-<date>/ (gardés pour le retour).
  const secours = join(m.dir, `avant-base-${horodatage(Date.now())}`); mkdirSync(secours, { recursive: true, mode: 0o700 });
  for (const x of ['profils.json', 'appareils.json', 'p']) if (existsSync(join(m.dir, x))) renameSync(join(m.dir, x), join(secours, x));
  writeFileSync(join(m.dir, EN_BASE), JSON.stringify({ depuis: new Date().toISOString(), secours: secours.split('/').pop(), avant }, null, 1), { mode: 0o600 });
  const total = Object.values(avant.recs).reduce((x, y) => x + y, 0);
  return `données passées dans la base d'Odin : ${total} enregistrement(s), ${avant.appareils} appareil(s), ${avant.copies} copie(s) — fichiers d'avant gardés dans ${secours.split('/').pop()}`;
}

/** Base → fichiers : la mémoire (lue dans la base) est réécrite en fichiers, et Pégase y reste. */
export async function retourFichiers(m: Magasin, raison: string): Promise<string> {
  const sb = m.support; if (!(sb instanceof SupportBase)) return 'Pégase est déjà en fichiers.';
  if (!sb.pret()) throw new BaseAttente('la base de Pégase');
  const snap = m.instantane(), f = new SupportFichiers(m.dir), copies = new Map<string, Array<Copie & { cols: Record<string, Rec[]> }>>();
  for (const pid of snap.profils.keys()) { const l: Array<Copie & { cols: Record<string, Rec[]> }> = []; for (const c of sb.copies(pid)) { const x = await sb.lireCopie(pid, c.id); if (x) l.push(x); } copies.set(pid, l); }
  await sb.appli.vider().catch(() => undefined);
  f.ecrirePrefs(snap.prefs); f.ecrireAppareils(snap.appareils);
  for (const [pid, p] of snap.profils) {
    const d = f.pdir(pid);
    for (const [c, l] of p.cols) if (c !== 'historique') f.ecrireCol(pid, c, l);
    for (const x of readdirSync(join(d, 'historique'))) rmSync(join(d, 'historique', x), { force: true });
    const parJour = new Map<string, Rec[]>(); for (const r of p.cols.get('historique') ?? []) { const j = p.jourDe.get(r.id) ?? jourDe(r.maj); parJour.set(j, [...(parJour.get(j) ?? []), r]); }
    if (parJour.size) f.ajouterHistorique(pid, parJour);
    rmSync(join(d, 'copies'), { recursive: true, force: true });
    for (const c of copies.get(pid) ?? []) { const { cols, ...meta } = c; f.ecrireCopie(pid, meta, cols); }
  }
  writeFileSync(join(m.dir, RETOUR), JSON.stringify({ depuis: new Date().toISOString(), raison }, null, 1), { mode: 0o600 });
  rmSync(join(m.dir, EN_BASE), { force: true });
  m.changerSupport(f);
  return `↩ Pégase est revenu en fichiers (${raison}) : ${snap.profils.size} profil(s). Les données restent aussi dans la base.`;
}
