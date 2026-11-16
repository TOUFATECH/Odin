// L'interpréteur des scripts DÉCLARATIFS : une donnée (des étapes) lue pas à pas. AUCUN code n'est exécuté
// (zéro surface d'évasion). Les étapes ne peuvent appeler QUE des actions d'applis, par le pont unique
// `Appeler` (routé vers v.act({ auto:true, by:'automatisation' }) en liste blanche) : une action grave est
// donc refusée, un require/fs/réseau n'existe pas ici. Tout ce que le script reçoit (entrée, variables,
// événement) est traité comme hostile : jamais évalué, seulement comparé et recopié comme texte.
//
// Borné : au plus `maxAppels` appels d'applis et `maxBoucles` étapes lues (une condition profondément
// imbriquée ne peut pas faire tourner Odin sans fin). Ne bloque jamais, ne fait jamais planter Odin.

import type { Appeler, Etape, Limites, Resultat } from './scripts.ts';

interface Etat { variables: Record<string, string>; dernier?: Resultat; appels: number; etapesLues: number; journal: string[] }

const str = (v: unknown): string => (v === undefined || v === null ? '' : typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Remplace {{variable}} par sa valeur (texte seul, jamais évalué). Une variable inconnue devient vide. */
function substituer(texte: string, vars: Record<string, string>): string {
  return texte.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, nom: string) => vars[nom] ?? '');
}

/** Recopie une entrée d'action en substituant les variables dans les valeurs texte (jamais d'évaluation). */
function entreeAvecVars(entree: Record<string, unknown> | undefined, vars: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entree ?? {})) out[k] = typeof v === 'string' ? substituer(v, vars) : v;
  return out;
}

/**
 * Évalue une condition SANS eval : « gauche op droite », op ∈ ==, !=, <, >, <=, >=, contient, commence,
 * vide, plein. Les opérandes sont des littéraux ou {{variable}} / {{dernier}} / {{dernier.ok}}. Une
 * condition mal écrite vaut faux (jamais d'erreur qui arrête le script).
 */
export function evaluerCondition(cond: string, etat: Etat): boolean {
  const vars = { ...etat.variables, dernier: etat.dernier?.texte ?? '', 'dernier.ok': etat.dernier?.ok ? 'oui' : 'non' };
  const brut = cond.trim();
  // Unaires : « {{x}} vide » / « {{x}} plein ».
  let m = /^(.*?)\s+(vide|plein)$/i.exec(brut);
  if (m) { const g = substituer(m[1].trim(), vars); return m[2].toLowerCase() === 'vide' ? g === '' : g !== ''; }
  m = /^(.*?)\s*(==|!=|<=|>=|<|>|contient|commence)\s*(.*)$/i.exec(brut);
  if (!m) return false;
  const g = substituer(m[1].trim(), vars).trim(), op = m[2].toLowerCase(), d = substituer(m[3].trim(), vars).trim();
  const ng = Number(g), nd = Number(d), nombres = g !== '' && d !== '' && !Number.isNaN(ng) && !Number.isNaN(nd);
  switch (op) {
    case '==': return g === d;
    case '!=': return g !== d;
    case '<': return nombres ? ng < nd : g < d;
    case '>': return nombres ? ng > nd : g > d;
    case '<=': return nombres ? ng <= nd : g <= d;
    case '>=': return nombres ? ng >= nd : g >= d;
    case 'contient': return g.toLowerCase().includes(d.toLowerCase());
    case 'commence': return g.toLowerCase().startsWith(d.toLowerCase());
    default: return false;
  }
}

async function lire(etapes: Etape[], appeler: Appeler, limites: Limites, etat: Etat, debut: number, signal?: AbortSignal): Promise<void> {
  for (const e of etapes) {
    if (signal?.aborted) throw new Error('arrêté');
    if (Date.now() - debut > limites.budgetMs) throw new Error('temps dépassé');
    if (++etat.etapesLues > limites.maxBoucles) throw new Error('trop d\'étapes (borne atteinte)');
    if (e.faire === 'poser') {
      etat.variables[e.variable] = substituer(str(e.valeur), { ...etat.variables, dernier: etat.dernier?.texte ?? '' });
      etat.journal.push(`pose ${e.variable}`);
    } else if (e.faire === 'si') {
      const vrai = evaluerCondition(e.cond, etat);
      etat.journal.push(`si ${e.cond} → ${vrai ? 'alors' : 'sinon'}`);
      await lire(vrai ? e.alors : (e.sinon ?? []), appeler, limites, etat, debut, signal);
    } else if (e.faire === 'action') {
      if (++etat.appels > limites.maxAppels) throw new Error('trop d\'appels d\'applis (borne atteinte)');
      // LE SEUL chemin vers le monde : le pont en liste blanche (v.act auto) ; une action grave y est refusée.
      const r = await appeler(e.module, e.action, entreeAvecVars(e.entree, etat.variables));
      etat.dernier = r;
      etat.journal.push(`${e.module} · ${e.action} → ${r.ok ? 'ok' : 'refusé/échec'}`);
      if (!r.ok) throw new Error(`« ${e.module} · ${e.action} » : ${r.texte.slice(0, 160)}`);
    }
  }
}

/**
 * Lance un script déclaratif. Rend un résultat agrégé (ok si toutes les étapes ont réussi). Ne lève pas vers
 * l'appelant : toute erreur est renvoyée en { ok:false }. Le temps est borné et mesuré.
 */
export async function interpreter(etapes: Etape[] | undefined, appeler: Appeler, o: { limites: Limites; entree?: Record<string, unknown>; signal?: AbortSignal }): Promise<Resultat> {
  const debut = Date.now();
  const variables: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.entree ?? {})) variables[k] = str(v);
  const etat: Etat = { variables, appels: 0, etapesLues: 0, journal: [] };
  try {
    await lire(etapes ?? [], appeler, o.limites, etat, debut, o.signal);
    return { ok: true, texte: etat.journal.length ? `✓ ${etat.appels} appel(s) d'appli, ${etat.journal.length} étape(s).` : 'Script vide.', ms: Date.now() - debut };
  } catch (err) {
    return { ok: false, texte: (err as Error).message, ms: Date.now() - debut };
  }
}

/** La liste « module.action » appelée par un script (récursif dans les « si ») : sert à la liste blanche et à la porte de qualité. */
export function actionsDe(etapes: Etape[] | undefined): string[] {
  const out: string[] = [];
  const marche = (l: Etape[]): void => { for (const e of l) { if (e.faire === 'action') out.push(`${e.module}.${e.action}`); else if (e.faire === 'si') { marche(e.alors); marche(e.sinon ?? []); } } };
  marche(etapes ?? []);
  return out;
}
