// L'argent TOUJOURS validé — la garde EN CODE, sans modèle (note « Réécrire son code », § 2.2 A.2) : un clic, une
// saisie, une touche ou un choix dans le navigateur alors que la page affichée porte des signes de paiement, ou une
// requête vers une adresse de paiement connue → « grave » (ton accord, même en Breaker, jamais « toujours »).
// Honnêteté : aucune règle automatique ne reconnaîtra 100 % des paiements d'un site inconnu ; la vraie garantie viendra
// du lot paiements (carte virtuelle plafonnée, seulement par l'outil de paiement).

const SIGNES = [
  /\b(payer|paiement|régler (la|ma|votre) commande|commander|passer (la |ma )?commande|confirmer (la |ma |votre )?commande|valider (le |mon |votre )?paiement|acheter maintenant|finaliser (l'|mon |votre )?achat|abonnement payant|s'abonner)\b/i,
  /\b(pay now|place (your )?order|buy now|checkout|complete (your )?purchase|confirm (and )?pay|subscribe now)\b/i,
  /(num[ée]ro de (la )?carte|card number|cvv|cvc|cryptogramme|date d'expiration|expiry date|iban\b)/i,
  /(stripe\.com|js\.stripe|paypal\.com|checkout\.com|adyen|braintree|sumup|payplug|mollie|klarna|worldpay|lydia-app|3-?d ?secure|secure\.payline|paylib|apple ?pay|google ?pay)/i,
];
/** Adresses de paiement connues (http_request). */
const HOTES = /(^|\.)(stripe\.com|paypal\.com|checkout\.com|adyen\.com|braintreegateway\.com|sumup\.com|payplug\.com|mollie\.com|klarna\.com|worldpay\.com|lydia-app\.com|payline\.com|gocardless\.com|square(up)?\.com)$/i;

/** La page porte-t-elle des signes de paiement ? Rend le signe trouvé. Pur. */
export function signePaiement(texte: string): string | undefined {
  for (const r of SIGNES) { const m = r.exec(texte); if (m) return m[0]; }
  return undefined;
}

// La dernière page vue par le navigateur, par conversation (notée par executer.ts à la sortie des outils du
// navigateur : la garde ne dépend pas du code du navigateur).
const pages = new Map<string, { texte: string; at: number }>();
/** La conversation racine : une aide (…:sub:…) voit la même page que la conversation qui l'a lancée (même navigateur). */
const racine = (session: string): string => session.split(':sub:')[0];
export function noterPage(session: string, texte: string): void {
  pages.set(racine(session), { texte: texte.slice(0, 200_000), at: Date.now() });
  if (pages.size > 200) pages.delete(pages.keys().next().value!);
}
/** (essais) oublie les pages. */
export function oublierPages(): void { pages.clear(); }

const OUTILS_NAVIGATEUR = new Set(['browser_click', 'browser_type', 'browser_key', 'browser_select']);

/** La raison « grave » si cet appel peut payer ; sinon undefined. */
export function graveArgent(tool: string, input: Record<string, unknown>, session: string): string | undefined {
  if (OUTILS_NAVIGATEUR.has(tool)) {
    const p = pages.get(racine(session));
    // Saisie d'un numéro de carte, même sans page vue.
    if (tool === 'browser_type' && /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,7}\b/.test(String(input.text ?? ''))) return 'paiement possible : un numéro de carte serait saisi';
    const signe = p ? signePaiement(p.texte) : undefined;
    if (signe) return `paiement possible : la page affichée parle de « ${signe} »`;
    return undefined;
  }
  if (tool === 'http_request') {
    try { const h = new URL(String(input.url ?? '')).hostname; if (HOTES.test(h)) return `paiement possible : requête vers ${h}`; } catch { /* adresse invalide : refusée ailleurs */ }
  }
  return undefined;
}
