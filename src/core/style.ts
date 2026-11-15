// Charte de réponse d'Odin, appliquée par le code à chaque réponse finale (sans modèle, instantané) :
// pas de formule creuse au début, pas de nom d'outil interne, pas d'avalanche d'émojis, pas de lignes vides
// en série. Les règles d'écriture elles-mêmes sont dans le prompt (CHARTER) ; ceci rattrape les écarts.

/** La charte telle qu'Odin la reçoit (placée juste après sa personnalité). */
export const CHARTER = `## Charte de réponse (prioritaire sur tout le reste pour la forme)
- Parle comme une personne, jamais comme une machine : langue courante, phrases comme on les dit à voix haute, tutoiement, « je » et « on ». Dis « C'est fait », « Ça n'a pas marché », « Je regarde » ; jamais « Requête traitée », « Action effectuée avec succès », « Opération terminée », « Erreur : … », « Veuillez… », « Votre demande a bien été prise en compte ».
- Suppose et propose avec naturel : « je pense que… », « à mon avis… », « on dirait que… », « tu veux que je… ? », « on pourrait… ». Une supposition se dit comme une supposition, jamais comme un fait.
- De la chaleur sans bavardage : un mot simple et vrai quand il a sa place, jamais de politesse en série ni de compliment gratuit.
- Commence par la réponse elle-même. Jamais de « Bien sûr ! », « Excellente question », ni de reformulation de la demande.
- Court par défaut : 1 à 3 phrases. Plus long seulement si on te demande une explication, un document, un plan ou une liste.
- Des chiffres plutôt que des adjectifs : « 92 % », « dans 3 semaines », pas « presque plein ».
- Aucun détail technique non demandé dans une réponse ordinaire : pas de nom d'outil, de code d'erreur, de chemin de fichier ni d'adresse IP, sauf s'il les demande ou s'il doit les taper.
- Un émoji au plus, seulement s'il porte un sens (alerte, réussite). Jamais d'émoji dans les titres.
- Ne raconte pas ce que tu as fait étape par étape : dis le résultat, et comment tu l'as vérifié en une demi-phrase si c'est une action.
- Si tu ne sais pas, dis-le en une phrase et propose la suite la plus utile.
- Une question à la fois, et seulement si tu ne peux vraiment pas décider par toi-même du sens le plus probable.
- Adapte au canal : très court en vocal et sur Telegram, plus structuré dans l'application (petits titres ### et listes courtes seulement pour les réponses longues).`;

const OPENERS = /^\s*(?:bien s[ûu]r|absolument|certainement|excellente question|tr[èe]s bonne question|bonne question|avec plaisir|parfait|super|g[ée]nial)\s*(?:[!.,:]+)\s*/i;
const PICTO = /\p{Extended_Pictographic}/gu;

// ---------------------------------------------------------------- Tournures d'automate → langue courante

/** « Veuillez … » → la même chose dite à quelqu'un qu'on tutoie (les verbes qui ne finissent pas en « er »). */
const TU: Record<string, string> = {
  saisir: 'saisis', choisir: 'choisis', fournir: 'donne', remplir: 'remplis', définir: 'définis', ouvrir: 'ouvre', attendre: 'attends', prendre: 'prends',
  mettre: 'mets', lire: 'lis', faire: 'fais', suivre: 'suis', répondre: 'réponds', reprendre: 'reprends', voir: 'regarde', dire: 'dis', écrire: 'écris',
};
const maj = (modele: string, mot: string) => (/^\p{Lu}/u.test(modele) ? mot.charAt(0).toUpperCase() + mot.slice(1) : mot);
/** Les formules d'automate sûres à remplacer (le reste est l'affaire de la charte, donc du modèle). */
const AUTOMATE: Array<[RegExp, string | ((...m: string[]) => string)]> = [
  [/(?:l['’])?(?:action|opération|tâche|commande|requête|demande)\s+(?:a\s+été\s+|est\s+)?(?:effectuée|réalisée|exécutée|terminée|accomplie|traitée)\s+avec\s+succès\s*[.!]?/giu, 'C\'est fait.'],
  [/(?<![\p{L}])(?:opération|action|tâche)\s+(?:réussie|terminée|effectuée)\s*[.!]/giu, 'C\'est fait.'],
  [/(?<![\p{L}])(?:requête|demande|commande)\s+(?:traitée|exécutée)\s*[.!]/giu, 'C\'est fait.'],
  [/(?:votre|ta)\s+(?:demande|requête)\s+a\s+(?:bien\s+)?été\s+prise\s+en\s+compte\s*[.!]?/giu, 'C\'est noté.'],
  [/(^|\n)([ \t]*)Erreur\s*:\s*/gu, '$1$2Ça n\'a pas marché : '],
  [/(?<![\p{L}])une\s+erreur\s+(?:est\s+survenue|s['’]est\s+produite)/giu, (m) => maj(m, 'ça n\'a pas marché')],
  [/(?<![\p{L}])veuillez\s+patienter/giu, (m) => maj(m, 'un instant')],
  [/(?<![\p{L}])veuillez\s+(?:vous\s+|te\s+)(\p{L}+er)(?![\p{L}])/giu, (m, v) => maj(m, `${v.slice(0, -1)}-toi`)],
  [/(?<![\p{L}])veuillez\s+(\p{L}+)(?![\p{L}])/giu, (m, v) => { const bas = v.toLowerCase(), tu = TU[bas] ?? (bas.endsWith('er') ? bas.slice(0, -1) : ''); return tu ? maj(m, tu) : m; }],
];
const AUTOMATE_VU = /avec\s+succès\s*[.!]|(?<![\p{L}])veuillez\s|(?<![\p{L}])requête\s+traitée|(?:^|\n)\s*Erreur\s*:|a\s+(?:bien\s+)?été\s+prise\s+en\s+compte/iu;
/** Remplace les tournures d'automate par la façon dont on le dit (hors des blocs de code et de ce qui est cité). Pur. */
export function parlerNaturel(text: string): string {
  const dehors = (t: string) => AUTOMATE.reduce((x, [re, par]) => (typeof par === 'string' ? x.replace(re, par) : x.replace(re, par)), t);
  let out = '', i = 0;
  for (const m of text.matchAll(/```[\s\S]*?```|`[^`\n]*`|«[^»\n]*»/g)) { out += dehors(text.slice(i, m.index)) + m[0]; i = m.index + m[0].length; }
  out += dehors(text.slice(i));
  // « C'est fait. C'est fait. » (deux formules à la suite) : une seule suffit.
  return out.replace(/(C'est fait\.)(?:\s+C'est fait\.)+/g, '$1');
}

/** Applique la charte à une réponse finale. `tools` : noms des outils internes à ne pas montrer. */
export function polishReply(text: string, tools: Iterable<string> = []): string {
  let t = text;
  // 1. Formule creuse au début (seulement s'il reste une vraie réponse derrière).
  const m = OPENERS.exec(t);
  if (m && t.slice(m[0].length).trim().length >= 12) { t = t.slice(m[0].length); t = t.charAt(0).toUpperCase() + t.slice(1); }
  // 1 bis. Tournures d'automate (« Action effectuée avec succès », « Erreur : », « Veuillez… ») : dites comme on parle.
  t = parlerNaturel(t);
  // 2. Noms d'outils internes : « (net_inventory) », « via l'outil machine_status », « avec `web_search` ».
  const names = [...tools].filter((n) => /_/.test(n)).sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (names.length) {
    const alt = names.join('|');
    t = t.replace(new RegExp(`\\s*\\((?:outil\\s+|via\\s+)?\`?(?:${alt})\`?\\)`, 'g'), '')
      .replace(new RegExp(`\\s+(?:via|avec|gr[âa]ce [àa]|par)\\s+(?:l'outil\\s+|mon outil\\s+)?\`?(?:${alt})\`?(?=[\\s.,;:!?)]|$)`, 'g'), '')
      .replace(new RegExp(`\\s*\\(?l'outil\\s+\`?(?:${alt})\`?\\)?`, 'g'), '');
  }
  // Même un outil inconnu : « via l'outil truc_machin » ne dit rien d'utile au propriétaire.
  t = t.replace(/\s+(?:via|avec|gr[âa]ce [àa]|par)\s+(?:l'outil|mon outil)\s+`?[a-z][a-z0-9]*_[a-z0-9_]+`?(?=[\s.,;:!?)]|$)/g, '');
  // 3. Émojis : jamais dans les titres, jamais en double, deux au plus dans toute la réponse.
  t = t.replace(/^(#{1,6}\s+)(?:\p{Extended_Pictographic}️?\s*)+/gmu, '$1');
  t = t.replace(/(\p{Extended_Pictographic}️?)(?:\s*\1)+/gu, '$1');
  let n = 0;
  t = t.replace(/(\p{Extended_Pictographic})(️)?\s?/gu, (all) => (++n <= 2 ? all : ''));
  // 4. Mise en page : pas plus d'une ligne vide d'affilée, pas d'espaces en fin de ligne.
  t = t.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

/** Contrôle qualité (pour les tests et le bilan) : ce qui dépasse la charte dans une réponse ordinaire. */
export function charterIssues(text: string, tools: Iterable<string> = []): string[] {
  const out: string[] = [];
  const plain = text.replace(/```[\s\S]*?```/g, '');
  const sentences = plain.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 2).length;
  if (OPENERS.test(text)) out.push('formule creuse au début');
  if ((text.match(PICTO) ?? []).length > 3) out.push('trop d\'émojis');
  for (const n of tools) if (/_/.test(n) && text.includes(n)) { out.push(`nom d'outil visible (${n})`); break; }
  if (sentences > 12 && !/^#{1,3}\s/m.test(text)) out.push('réponse longue sans structure');
  if (AUTOMATE_VU.test(plain.replace(/`[^`\n]*`|«[^»\n]*»/g, ''))) out.push('tournure d\'automate');
  return out;
}
