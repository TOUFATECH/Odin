// « Gardé de partout » : chaque script (son but, son nom, ses dates, ses stats) est relié à la MÉMOIRE
// (Mnémosyne), au CERVEAU (une note + des liens) et à NOÛS (le réseau profond), pour qu'Odin « sache quels
// scripts il a faits » et puisse les lire, les analyser et les améliorer. JAMAIS le code dans tout ça : un
// script peut contenir un secret → il reste chiffré au coffre ; le résumé est masqué (mot de passe, e-mail,
// téléphone, IBAN, carte, jeton) avant d'entrer en mémoire.
//
// no-op sans deps (patron brancherMemoire) : le câblage est posé au démarrage (odin.ts) et retiré à l'arrêt.
// Noûs n'étant pas câblé au runtime, le pont Noûs est un no-op sûr tant que son moteur n'est pas là.

import type { Etape, LienArchytas, ScriptDetail } from './scripts.ts';

/** La mémoire d'Odin (Mnémosyne) : on n'utilise que ces deux gestes. */
export interface MuninnRef {
  remember(content: string, origin: 'owner' | 'agent' | 'untrusted', kind: string, tags: string, meta: { subject?: string; topic?: string; source?: string }): unknown;
  /** oublie les souvenirs d'un sujet (optionnel : sinon un souvenir « supprimé » prend la place de l'ancien). */
  oublierSujet?(subject: string): number;
}
/** Le Cerveau (notes Markdown reliées) : écrire une fiche et la mettre à la corbeille. */
export interface VaultRef {
  write(path: string, meta: Record<string, string | number | boolean | string[] | undefined>, body: string, o?: { quiet?: boolean }): string;
  trash?(path: string, o?: { quiet?: boolean }): string;
}
/** Noûs (réseau profond) : une seule entrée d'apprentissage, appelée quand son moteur est là. */
export interface NoosRef { nourrir(n: { sorte: 'note'; texte: string; source: string; fiable: boolean; note?: number }): void }

export interface DepsArchytas {
  home: string;
  muninn?: MuninnRef;
  vault?: VaultRef;
  noos?: NoosRef;
  /** masquage technique (Heimdall) ; par défaut aucun (le masquage « à la française » est toujours appliqué) */
  redact?: (t: string) => string;
  /** nom affiché d'une appli (pour les liens [[Fiche]]) ; par défaut l'identifiant */
  nomAppli?: (id: string) => string;
}

// ---------------------------------------------------------------------------------------------------------
// Masquage « à la française » : jamais un secret dans le résumé gardé en mémoire ou au Cerveau.
// ---------------------------------------------------------------------------------------------------------
export function masquer(t: string): string {
  return String(t ?? '')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '•••@•••')
    .replace(/\b(?:\+?\d[ .-]?){9,}\d\b/g, '•••')
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, '•••') // IBAN
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '•••') // carte
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|eyJ[A-Za-z0-9._-]{10,})\b/g, '•••')
    .replace(/\b(mot\s*de\s*passe|password|secret|jeton|token|cl[eé]|api[_-]?key)\s*[:=]\s*\S+/gi, '$1 •••');
}

const d = (ms: number): string => new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Les applis qu'un script utilise (actions des étapes + modules des déclencheurs d'événement). Pur. */
export function appliesUtilisees(detail: ScriptDetail): string[] {
  const set = new Set<string>();
  const marche = (l: Etape[] | undefined): void => { for (const e of l ?? []) { if (e.faire === 'action') set.add(e.module); else if (e.faire === 'si') { marche(e.alors); marche(e.sinon); } } };
  marche(detail.etapes);
  for (const dc of detail.declencheurs) if (dc.genre === 'evenement') set.add(dc.module);
  return [...set];
}

/** Construit le lien « gardé de partout » à partir des deps (ou un no-op sûr sans deps). */
export function lienDepuis(deps?: DepsArchytas): LienArchytas {
  if (!deps) return { enregistrer() { /* no-op */ }, oublier() { /* no-op */ } };
  const nettoyer = (t: string): string => masquer(deps.redact ? deps.redact(t) : t);
  const nomAppli = deps.nomAppli ?? ((id: string) => id);

  return {
    enregistrer(detail: ScriptDetail) {
      const subject = `script:${detail.nom}`;
      const resume = `Script « ${detail.nom} » (Archytas) — ${detail.mission || detail.description || 'sans mission'} : ${detail.description || 'script d\'automatisation'}. ${detail.stat.runs} exécution(s), ${detail.stat.ok} réussite(s), créé ${d(detail.cree)}, modifié ${d(detail.modifie)}.`;
      try { deps.muninn?.remember(nettoyer(resume), 'owner', 'script', 'archytas', { subject, topic: 'archytas', source: 'Archytas' }); } catch { /* la mémoire ne gêne jamais */ }
      // Le Cerveau : une fiche masquée, reliée aux fiches des applis utilisées — JAMAIS le code.
      try {
        const applis = appliesUtilisees(detail);
        const liens = applis.length ? `\n\nUtilise : ${applis.map((a) => `[[${nomAppli(a)}]]`).join(', ')}` : '';
        const taux = detail.stat.runs ? Math.round((detail.stat.ok / detail.stat.runs) * 100) : 0;
        const corps = `${nettoyer(detail.description || detail.mission || '')}\n\n- Genre : ${detail.genre === 'code' ? 'code libre (bac à sable)' : 'déclaratif'}\n- ${detail.stat.runs} exécution(s), ${taux}% de réussite\n- Version ${detail.version}${liens}`;
        deps.vault?.write(`Odin/Applis/Archytas/${detail.nom.replace(/[\\/:*?"<>|#^[\]]/g, ' ')}`, { type: 'script', mission: nettoyer(detail.mission).slice(0, 120), 'créé': d(detail.cree), 'modifié': d(detail.modifie), usages: detail.stat.runs, 'succès': detail.stat.ok, version: detail.version }, corps, { quiet: true });
      } catch { /* le Cerveau ne gêne jamais */ }
      // Noûs : une note d'apprentissage (no-op tant que son moteur n'est pas là).
      try {
        const actions = appliesUtilisees(detail).join(', ');
        const taux = detail.stat.runs ? Math.round((detail.stat.ok / detail.stat.runs) * 100) : 0;
        deps.noos?.nourrir({ sorte: 'note', texte: nettoyer(`${detail.mission} — ${detail.description} — appelle: ${actions} — ${detail.stat.runs} usages, ${taux}% succès`), source: `archytas:${detail.nom}`, fiable: true, note: detail.stat.ok / Math.max(1, detail.stat.runs) });
      } catch { /* Noûs ne gêne jamais */ }
    },
    oublier(nom: string) {
      const subject = `script:${nom}`;
      try {
        if (deps.muninn?.oublierSujet) deps.muninn.oublierSujet(subject);
        else deps.muninn?.remember(`Script « ${nom} » (Archytas) supprimé le ${d(Date.now())}.`, 'owner', 'script', 'archytas', { subject, topic: 'archytas', source: 'Archytas' });
      } catch { /* rien */ }
      try { deps.vault?.trash?.(`Odin/Applis/Archytas/${nom.replace(/[\\/:*?"<>|#^[\]]/g, ' ')}`, { quiet: true }); } catch { /* rien */ }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Le câblage posé au démarrage (patron brancherMemoire) : un proxy stable que le moteur tient, qui délègue au
// lien courant (ou ne fait rien). brancherArchytas(deps) l'active ; brancherArchytas(undefined) le retire.
// ---------------------------------------------------------------------------------------------------------
let actif: LienArchytas | undefined;
export function brancherArchytas(deps?: DepsArchytas): void { actif = deps ? lienDepuis(deps) : undefined; }
/** Le lien stable remis au moteur : il suit ce que brancherArchytas a posé. */
export const lienArchytas: LienArchytas = {
  enregistrer(detail) { actif?.enregistrer(detail); },
  oublier(nom) { actif?.oublier(nom); },
};
