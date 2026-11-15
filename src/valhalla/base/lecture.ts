// Alexandrie — Odin regarde la base d'une appli pour répondre (« combien de sauvegardes dans la base de Phénix ? ») :
// il trouve la base par le nom de l'appli (PHENIX_ODIN), et la lit en LECTURE SEULE, de trois façons à la fois :
//   1. le compte `odin_lecture` ne voit que les vues prévues (`v_*`) : jamais les tables, jamais les colonnes sensibles ;
//   2. la requête est vérifiée ici : une seule instruction SELECT (ou WITH … SELECT), aucun mot qui écrit ;
//   3. elle tourne dans une transaction READ ONLY, avec un délai, et le résultat est limité (200 lignes au plus).
// Les colonnes dont le nom dit « secret » (mot de passe, jeton, clé, empreinte, chiffré, adresse IP…) sont masquées.
// Chaque lecture est notée dans la traçabilité (trace.ts) et retenue par la mémoire d'Odin.
import { bases, open, type Base } from '../urdr/bases.ts';
import { statements, type Value } from '../urdr/db.ts';
import { aUneBase, rangementDe, RAISONS } from './inventaire.ts';
import { appliDeNom, ident, nomAffiche } from './noms.ts';
import { idAlexandrie, nomDeLaBase } from './index.ts';
import { tablesDe, tracer } from './trace.ts';

export const MAX_LIGNES = 200;
export const MASQUE = '•••';

/** Les mots qui écrivent, changent un réglage ou sortent de la base : refusés même dans une lecture. */
const INTERDITS = /\b(insert|update|delete|merge|upsert|drop|alter|create|grant|revoke|truncate|copy|call|do|execute|prepare|deallocate|set|reset|lock|vacuum|analyze|cluster|reindex|refresh|comment|security|listen|notify|unlisten|discard|checkpoint|import|into|nextval|setval|pg_sleep|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export|lo_\w+|dblink\w*|set_config|current_setting|txid_current|pg_advisory\w*|for\s+update|for\s+share)\b/i;

/** La requête est-elle une simple lecture ? Rend la requête nettoyée, ou lève une erreur qui dit pourquoi. */
export function lectureSeule(sql: string): string {
  const st = statements(String(sql ?? ''));
  if (st.length !== 1) throw new Error(st.length ? 'une seule instruction à la fois (pas de « ; » au milieu)' : 'requête vide');
  const q = st[0].trim(), sansTexte = q.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
  if (!/^(select|with)\b/i.test(sansTexte)) throw new Error('lecture seulement : la requête doit commencer par SELECT (ou WITH … SELECT)');
  const m = INTERDITS.exec(sansTexte); if (m) throw new Error(`lecture seulement : « ${m[0]} » est refusé ici`);
  return q;
}

/** Une colonne dont le nom dit qu'elle porte un secret ou une donnée privée. */
export function colonneSecrete(nom: string): boolean {
  const n = nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/mot_?de_?passe|passw|secret|jeton|token|hash|empreinte|chiffr|cipher|crypt|cookie|signature|authorization|bearer|private|prive/.test(n)) return true;
  const mots = new Set(n.split(/[^a-z0-9]+/).filter(Boolean));
  return ['pwd', 'cle', 'clef', 'key', 'apikey', 'salt', 'sel', 'otp', 'totp', 'iv', 'nonce', 'ip', 'session', 'sso', 'cert'].some((m) => mots.has(m));
}
/** Une valeur qui ressemble à un secret, quelle que soit sa colonne (jeton JWT, clé privée, en-tête d'autorisation). */
const valeurSecrete = (v: string): boolean => /^eyJ[\w-]{10,}\.[\w-]{10,}\.|-----BEGIN [A-Z ]*PRIVATE KEY|^(bearer|basic)\s+\S{12,}|^\$(2[aby]|argon2\w*|scrypt|pbkdf2)\$|^SCRAM-SHA-256\$/i.test(v.trim());

/** Masque les colonnes et valeurs secrètes d'un résultat. */
export function masquer(colonnes: string[], lignes: Array<Array<Value>>): { lignes: Array<Array<Value>>; masquees: string[] } {
  const sec = colonnes.map(colonneSecrete);
  return { lignes: lignes.map((r) => r.map((v, i) => (v === null ? v : sec[i] || valeurSecrete(String(v)) ? MASQUE : v))), masquees: colonnes.filter((_, i) => sec[i]) };
}

/** La base d'une appli dans la liste d'Alexandrie (le nom de l'appli, son identifiant ou le nom de sa base). */
export function baseDeLAppli(home: string, texte: string): { appli: string; base?: Base } {
  const appli = appliDeNom(texte); if (!appli) throw new Error(`appli inconnue : ${texte}`);
  const nom = nomDeLaBase(home, appli), l = bases(home);
  return { appli, base: l.find((b) => b.id === idAlexandrie(appli)) ?? l.find((b) => b.base === nom) };
}

export interface Lecture { appli: string; base: string; colonnes: string[]; lignes: Array<Array<Value>>; masquees: string[]; tables: string[]; tronque: boolean }

/**
 * Odin lit la base d'une appli : sans requête, la liste des vues qu'il peut lire et leur nombre de lignes ;
 * avec une requête, son résultat (lecture seule, limité, secrets masqués). `qui` et `pourquoi` vont dans la trace.
 */
export async function lireBaseAppli(home: string, o: { appli: string; requete?: string; qui?: string; pourquoi?: string; quand?: Date }): Promise<Lecture | { appli: string; absente: string }> {
  const { appli, base } = baseDeLAppli(home, o.appli);
  if (!base) {
    const r = rangementDe(appli);
    return { appli, absente: `${nomAffiche(appli)} n'a pas encore de base dans Alexandrie (${nomDeLaBase(home, appli)}${aUneBase(appli) ? ' : elle sera créée au prochain démarrage de la base d\'Odin' : ''}). Ses données : ${r.map((x) => `${x.donnees} (${x.support === 'base' ? 'en base' : `en fichiers : ${RAISONS[x.raison ?? 'reglages']}`})`).join(' ; ')}.` };
  }
  const requete = o.requete?.trim() ? lectureSeule(o.requete) : undefined;
  const d = await open(home, base);
  const trace = (tables: string[], lignes: number, ok: boolean) => tracer(home, { qui: o.qui ?? 'Odin (discussion)', appli, base: base.base ?? base.nom, tables, op: 'lecture', pourquoi: o.pourquoi ?? (requete ? 'question dans la discussion' : 'voir ce que contient la base'), lignes, ok, quand: o.quand });
  try {
    if (!requete) {
      // Ce qu'Odin peut lire : les vues (et tables) que son compte voit, avec leur nombre de lignes.
      const t = (await d.tables()).slice(0, 50);
      const lignes: Array<Array<Value>> = t.map((x) => [x.name, String(x.rows)]);
      trace(t.map((x) => x.name), t.length, true);
      return { appli, base: base.base ?? base.nom, colonnes: ['vue', 'lignes'], lignes, masquees: [], tables: t.map((x) => x.name), tronque: false };
    }
    const tables = tablesDe(requete);
    let r;
    try { r = await d.sql(`SELECT * FROM (${requete}) AS lecture_odin LIMIT ${MAX_LIGNES + 1}`, false); }
    catch (e) { trace(tables, 0, false); throw e; }
    const m = masquer(r.columns, r.rows.slice(0, MAX_LIGNES));
    trace(tables, m.lignes.length, true);
    return { appli, base: base.base ?? base.nom, colonnes: r.columns, lignes: m.lignes, masquees: m.masquees, tables, tronque: r.rows.length > MAX_LIGNES };
  } finally { await d.close().catch(() => undefined); }
}

/** Le résultat en texte court (pour la discussion). */
export function texteLecture(x: Lecture | { appli: string; absente: string }): string {
  if ('absente' in x) return x.absente;
  const cell = (v: Value) => (v === null ? '∅' : String(v).length > 80 ? `${String(v).slice(0, 79)}…` : String(v));
  return [`Base ${x.base} (${nomAffiche(x.appli)}), lecture seule :`, x.colonnes.join(' | '), ...x.lignes.slice(0, 30).map((r) => r.map(cell).join(' | ')),
    ...(x.lignes.length > 30 ? [`… ${x.lignes.length - 30} lignes de plus`] : []), ...(x.tronque ? [`(limité à ${MAX_LIGNES} lignes)`] : []),
    ...(x.masquees.length ? [`(colonnes masquées : ${x.masquees.join(', ')})`] : []), ...(x.lignes.length ? [] : ['(aucune ligne)'])].join('\n');
}
export { ident };
