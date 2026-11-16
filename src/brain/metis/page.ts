// Page Métis : la liste des modèles ouverts téléchargés, leur vitesse MESURÉE (morceaux par seconde), la mémoire
// qu'ils prennent, et la taille conseillée d'après la machine. Honnête : tant qu'un modèle n'a pas tourné pour de
// vrai (mesure.essayeSurVrai = false), la page le dit « codé, pas encore essayé sur un vrai modèle ».
//
// La page est servie par la route propriétaire /api/metis/page du serveur web d'Odin (127.0.0.1, voir src/web/metis-api.ts),
// protégée comme les autres routes d'Odin. Ce fichier ne fait que PRODUIRE le HTML (un fragment inséré dans OdinDialog
// côté interface) ; il ne contacte aucun service.

import type { ModeleCatalogue, CapaciteMachine } from './types.ts';

const ech = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

const mo = (octets: number): string => {
  const m = octets / (1024 * 1024);
  return m >= 1024 ? `${(m / 1024).toFixed(1)} Go` : `${Math.round(m)} Mo`;
};

/** Une ligne de tableau pour un modèle, avec sa vitesse mesurée (ou « pas encore essayé »). */
export function ligneModele(m: ModeleCatalogue): string {
  const taille = mo(m.tailleOctets);
  let vitesse: string;
  if (!m.mesure) vitesse = '<span class="dim">pas encore mesuré</span>';
  else if (!m.mesure.essayeSurVrai) vitesse = '<span class="dim">codé, pas encore essayé sur un vrai modèle</span>';
  else vitesse = `${m.mesure.morceauxParSeconde.toFixed(1)} morceaux/s · ${Math.round(m.mesure.memoireMo)} Mo`;
  return `<tr><td data-label="Modèle">${ech(m.nom)}</td><td data-label="Famille">${ech(m.arch)}</td><td data-label="Quantification">${ech(m.quant)}</td><td data-label="Taille">${taille}</td><td data-label="Type">${ech(m.type)}</td><td data-label="Vitesse mesurée">${vitesse}</td></tr>`;
}

/** Le HTML complet de la page Métis. */
export function pageMetisHtml(modeles: ModeleCatalogue[], cap?: CapaciteMachine, tailleConseillee?: string): string {
  const lignes = modeles.length
    ? modeles.map(ligneModele).join('')
    : '<tr><td colspan="6" class="empty dim">Aucun modèle téléchargé. Télécharge un modèle ouvert (GGUF) pour que le cerveau local réponde.</td></tr>';
  const conseil = tailleConseillee
    ? `<p>Taille conseillée pour cette machine : <b>${ech(tailleConseillee)}</b>.</p>`
    : '';
  const machine = cap
    ? `<p class="dim">Machine mesurée : ${cap.gflops.toFixed(1)} GFLOP/s, ${Math.round(cap.ramLibreMo)} Mo de mémoire libre, modèle acceptable jusqu'à ${mo(cap.octetsMax)}.</p>`
    : '';
  return [
    '<section class="metis">',
    '<h2>Métis — modèles de langue ouverts, dans Odin</h2>',
    "<p>Métis lit lui-même les modèles ouverts (format GGUF) et les fait tourner dans Odin, sans serveur à côté ni adresse à régler.</p>",
    "<p><b>Honnête :</b> sur un petit processeur sans carte graphique, seuls les petits modèles sont utilisables. La vitesse ci-dessous est MESURÉE sur cette machine, jamais promise.</p>",
    conseil,
    machine,
    '<table class="tbl"><thead><tr><th>Modèle</th><th>Famille</th><th>Quantification</th><th>Taille</th><th>Type</th><th>Vitesse mesurée</th></tr></thead>',
    `<tbody>${lignes}</tbody></table>`,
    '</section>',
  ].join('');
}

/** Résumé court pour une alerte ou un briefing : combien de modèles, lesquels essayés pour de vrai. */
export function resumeMetis(modeles: ModeleCatalogue[]): string {
  if (!modeles.length) return 'Métis : aucun modèle ouvert téléchargé.';
  const essayes = modeles.filter((m) => m.mesure?.essayeSurVrai).length;
  return `Métis : ${modeles.length} modèle(s) ouvert(s) téléchargé(s), ${essayes} essayé(s) pour de vrai.`;
}
