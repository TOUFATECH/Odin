// Noûs — étape 3 : LE PREMIER CORPUS. Le propriétaire l'a dit (17/11) : Odin ne débute pas à zéro, il part de ce
// qu'il EST. Le corpus de départ est donc fabriqué par Odin lui-même, sans gros corpus pris sur le web :
//   1. chaque appli : son nom, ce qu'elle fait, ses fonctions, ses actions (libellé, ce qu'elle fait, ses mots) ;
//   2. les liens entre applis et les usages (« besoin → chaîne d'applis ») ;
//   3. le guide des applis (la phrase de survol et ce qu'on y fait) ;
//   4. les compétences (leur nom et leur description) ;
//   5. les notes du Cerveau et les souvenirs du propriétaire — JAMAIS en mode privé, secrets masqués par nourrir() ;
//   6. des PAIRES « demande → appli et action », tirées des vraies définitions des modules (les mots de chaque action,
//      et quelques demandes du propriétaire résolues seulement si l'action existe vraiment), pour l'étape d'ajustement.
// Ce que Mathésis apprend arrive ensuite par la file, au fil de l'eau.
//
// Tout passe par nourrir() (masquage, mode privé, démonstration, interrupteur de Noûs) puis par le lecteur de la file
// (src/brain/nous/file-odin.ts), qui l'écrit chiffré et borné. Fait UNE fois par version (fichier « depart.json », écrit seulement quand tout est rangé).
import { DEMANDES_LANGUES } from './demandes-langues.ts';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { nourrir, type Nourriture } from './entree.ts';
import type { NoosDeps } from './deps.ts';

/** Le choix du premier corpus (réglage `nous.corpusDepart`). */
export type ChoixDepart = 'odin' | 'memoire' | 'web' | 'demander' | 'livraison';
export const CHOIX_DEPART: Record<ChoixDepart, string> = {
  odin: 'ce qu\'Odin est (ses applis, leurs liens, le guide, les compétences), puis tes notes et ta mémoire, et ce que Mathésis apprend',
  memoire: 'seulement tes notes et ta mémoire',
  web: 'des textes libres du web (pas encore fait : aucun gros corpus n\'est téléchargé)',
  demander: 'rien encore : Odin attend ton choix',
  livraison: 'seulement ce qu\'Odin est (applis, actions, liens, guide, compétences livrées) : rien de toi — le mode qui fabrique le modèle de départ livré',
};
export const VERSION_DEPART = 1;

/** Ce que le premier corpus lit d'Odin (tout est facultatif : une partie absente est simplement sautée). */
export interface SourcesDepart {
  modules?: Array<{ id: string; name: string; what: string; does?: string[]; words?: string[]; actions?: Array<{ id: string; label: string; what?: string; words?: string[]; read?: boolean }> }>;
  liens?: Array<{ from: string; to: string; when: string; does: string }>;
  usages?: Array<{ need: string; chain: string[]; why: string }>;
  survol?: Record<string, { phrase: string; faire: string[] }>;
  competences?: Array<{ name: string; description: string }>;
  /** Les notes du Cerveau, avec leurs propriétés : une capture (contenu venu de dehors) ou une note marquée « non
   *  fiable » n'est jamais un exemple fiable. */
  notes?: () => Array<{ title: string; body: string; meta?: { type?: unknown; fiable?: unknown } }>;
  /** Les souvenirs, avec leur identifiant (pour l'oubli). */
  souvenirs?: () => Array<{ id?: number; content: string; origin: string; kind?: string }>;
}

/** Des demandes réelles du propriétaire, résolues seulement si l'appli et l'action existent dans les définitions. */
export const DEMANDES_EXEMPLES: Array<{ demande: string; module: string; action: RegExp }> = [
  ...DEMANDES_LANGUES, // les mêmes actions en plusieurs langues (demandes-langues.ts)
  { demande: 'qui est connecté sur le VPN ?', module: 'gjoll', action: /^appareils$/ },
  { demande: 'lance tel film', module: 'freyja', action: /^regarder$/ },
  { demande: 'mets-moi l\'épisode 3 de la série', module: 'freyja', action: /^regarder$/ },
  { demande: 'j\'ai branché une clé USB, démarre dessus', module: 'thjalfi', action: /^cle_preparer$/ },
];

export interface BilanDepart { choix: ChoixDepart; textes: number; paires: number; nonResolues: string[]; ms: number; raison?: string }

const fichierDepart = (home: string) => join(home, 'cerveau-reseau', 'depart.json');
/**
 * Le premier corpus a-t-il déjà été fait (pour cette version) ? Fait « incomplet » parce que le disque était plein : il
 * n'est repris que si la place réglée a grandi depuis (`disqueMaxMo`), jamais à chaque passage.
 */
export function departFait(home: string, disqueMaxMo?: number): { fait: boolean; quand?: string; choix?: string; textes?: number; paires?: number; incomplet?: string } {
  try {
    const j = JSON.parse(readFileSync(fichierDepart(home), 'utf8')) as { version: number; quand: string; choix: string; textes: number; paires: number; incomplet?: string; disqueMaxMo?: number };
    if (j.version !== VERSION_DEPART) return { fait: false };
    if (j.incomplet && disqueMaxMo !== undefined && j.disqueMaxMo !== undefined && disqueMaxMo > j.disqueMaxMo) return { fait: false };
    return { fait: true, ...j };
  } catch { return { fait: false }; }
}

/** Marque le premier corpus comme fait, une fois TOUT rangé. */
export function marquerDepart(home: string, b: Pick<BilanDepart, 'choix' | 'textes' | 'paires'>, o: { incomplet?: string; disqueMaxMo?: number } = {}): void {
  mkdirSync(join(home, 'cerveau-reseau'), { recursive: true });
  const f = fichierDepart(home);
  writeFileSync(`${f}.tmp`, JSON.stringify({ version: VERSION_DEPART, quand: new Date().toISOString(), choix: b.choix, textes: b.textes, paires: b.paires, ...(o.incomplet ? { incomplet: o.incomplet, disqueMaxMo: o.disqueMaxMo } : {}) }), { mode: 0o600 });
  renameSync(`${f}.tmp`, f);
}

/** Fabrique le premier corpus et le donne à nourrir(). Rend ce qui a été donné. Ne lève jamais. */
export function fabriquerDepart(home: string, deps: NoosDeps, choix: ChoixDepart, s: SourcesDepart): BilanDepart {
  const t0 = performance.now();
  const bilan: BilanDepart = { choix, textes: 0, paires: 0, nonResolues: [], ms: 0 };
  const fin = (raison?: string) => { bilan.ms = Math.round(performance.now() - t0); if (raison) bilan.raison = raison; return bilan; };
  try {
    if (choix === 'demander') return fin('aucun choix encore : rien n\'est fait');
    if (choix === 'web') return fin('« textes libres du web » n\'est pas encore fait : rien n\'est téléchargé');
    if (deps.cfg.nous?.actif === false) return fin('Noûs est coupé');
    if (deps.demo) return fin('démonstration');
    let prive = true; try { prive = deps.privateMode() === true; } catch { prive = true; }
    if (prive) return fin('mode privé : rien n\'est appris');
    // (l'appelant donne une file à lui, assez grande pour tout le premier corpus, et la vide aussitôt vers le corpus)
    const donner = (n: Omit<Nourriture, 'fiable'> & { fiable?: boolean }) => {
      nourrir(deps, { fiable: true, ...n });
      if (n.sorte === 'echange') bilan.paires++; else bilan.textes++;
    };
    if (choix === 'odin' || choix === 'livraison') {
      for (const m of s.modules ?? []) {
        const actions = (m.actions ?? []).map((a) => `- ${a.label}${a.what ? ` : ${a.what}` : ''}${a.words?.length ? ` (on dit : ${a.words.slice(0, 6).join(', ')})` : ''}`).join('\n');
        donner({ sorte: 'note', source: `odin:applis`, texte: `L'appli ${m.name} (${m.id}) : ${m.what}\n${(m.does ?? []).map((d) => `- ${d}`).join('\n')}${actions ? `\nSes actions :\n${actions}` : ''}${m.words?.length ? `\nMots qui la désignent : ${m.words.slice(0, 12).join(', ')}` : ''}` });
        // Paires « demande → appli et action », tirées des mots de chaque action (sa vraie définition).
        for (const a of m.actions ?? []) for (const w of (a.words ?? []).slice(0, 6)) {
          if (String(w).trim().length < 4) continue;
          donner({ sorte: 'echange', source: 'odin:paires', demande: String(w), reponse: `${m.name} (${m.id}) → ${a.label} (${a.id})` });
        }
      }
      for (const l of s.liens ?? []) donner({ sorte: 'note', source: 'odin:liens', texte: `Lien entre applis : ${l.from} → ${l.to}. Quand ${l.when}, ${l.does}.` });
      for (const u of s.usages ?? []) donner({ sorte: 'note', source: 'odin:liens', texte: `Pour « ${u.need} » : ${u.chain.join(' → ')}. ${u.why}` });
      for (const [id, x] of Object.entries(s.survol ?? {})) donner({ sorte: 'note', source: 'odin:guide', texte: `${id} : ${x.phrase} On peut : ${x.faire.join(' ; ')}.` });
      for (const c of s.competences ?? []) donner({ sorte: 'note', source: 'odin:competences', texte: `Compétence « ${c.name} » : ${c.description}` });
      // Des demandes réelles du propriétaire, seulement si l'appli et l'action existent vraiment.
      for (const ex of DEMANDES_EXEMPLES) {
        const m = (s.modules ?? []).find((x) => x.id === ex.module);
        const a = m?.actions?.find((x) => ex.action.test(x.id) || ex.action.test(x.label.normalize('NFD').replace(/[̀-ͯ]/g, '')));
        if (!m || !a) { bilan.nonResolues.push(ex.demande); continue; }
        donner({ sorte: 'echange', source: 'odin:paires', demande: ex.demande, reponse: `${m.name} (${m.id}) → ${a.label} (${a.id})` });
      }
    }
    // Les notes du Cerveau et les souvenirs du propriétaire (jamais en mode privé : vérifié plus haut ; secrets masqués
    // par nourrir() ; les souvenirs « non fiables » — venus d'une page ou d'un document extérieur — sont laissés).
    // Le mode « livraison » (le modèle livré à tous) n'en prend JAMAIS : rien de privé n'y entre.
    if (choix === 'livraison') return fin();
    for (const n of (s.notes?.() ?? []).slice(0, 5000)) {
      if (!n.body.trim()) continue;
      // Seules les notes écrites par le propriétaire sont fiables ; une capture (une page venue de dehors) ou une note
      // marquée non fiable ne sert qu'à apprendre la langue (même règle que les liens vivants).
      const capture = n.meta?.type === 'capture' || n.meta?.fiable === false;
      donner({ sorte: 'lecture', source: 'memoire:notes', texte: `${n.title}\n${n.body.slice(0, 8000)}`, fiable: !capture });
    }
    for (const m of (s.souvenirs?.() ?? []).slice(0, 5000)) if (m.origin !== 'untrusted' && m.content.trim()) donner({ sorte: 'note', source: 'memoire:souvenirs', texte: m.content.slice(0, 4000), fiable: m.origin === 'owner', ...(Number.isInteger(m.id) ? { idSouvenir: m.id } : {}) });
    // Le premier corpus n'est marqué « fait » qu'APRÈS son rangement complet (marquerDepart, appelé par la tâche) :
    // un arrêt d'Odin au milieu le fait refaire (sans doublon : le corpus retire ce qu'il a déjà).
    return fin();
  } catch (e) { return fin(`panne : ${String((e as Error)?.message ?? e).slice(0, 120)}`); }
}

/** (essais) le premier corpus est-il marqué fait ? */
export const fichierDepartExiste = (home: string): boolean => existsSync(fichierDepart(home));
