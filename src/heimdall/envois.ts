// Envoyer EN TON NOM (U2) : tout envoi à quelqu'un d'autre que toi (mail, messagerie) est « grave » — ta validation,
// même en Breaker, jamais « toujours » — et la demande de validation montre le destinataire et le texte EXACT.
// Les messages qu'Odin T'envoie (à toi, sur tes messageries) restent libres. Garde en code, sans modèle.

/** Les identités du propriétaire par messagerie (posées par la passerelle au démarrage). « * » = tout le canal. */
let proprietaires: Record<string, string[]> = {};
export function declarerProprietaires(o: Record<string, string[]>): void { proprietaires = { ...o }; }

const TEXTE_MAX = 2000;
const exact = (t: string) => (t.length > TEXTE_MAX ? `${t.slice(0, TEXTE_MAX)}… (${t.length - TEXTE_MAX} caractères de plus)` : t);

/** Le destinataire d'un envoi à un tiers (« canal:identifiant » ou l'adresse), ou undefined si c'est toi / pas un envoi. */
export function destinataireTiers(tool: string, input: Record<string, unknown>): string | undefined {
  if (tool === 'send_message') { const canal = String(input.channel ?? ''), dest = String(input.peer ?? ''); const p = proprietaires[canal] ?? []; return p.includes('*') || p.includes(dest) ? undefined : `${canal}:${dest}`; }
  if (tool === 'mail_send') return String(input.to ?? '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean).sort().join(',') || undefined;
  return undefined;
}

/** La raison « grave » d'un envoi à un tiers (destinataire et texte exact), ou undefined si ce n'est pas un envoi à un tiers. */
export function graveEnvoi(tool: string, input: Record<string, unknown>): string | undefined {
  if (tool === 'send_message') {
    const canal = String(input.channel ?? ''), dest = String(input.peer ?? '');
    const p = proprietaires[canal] ?? [];
    if (p.includes('*') || p.includes(dest)) return undefined; // c'est toi
    return `envoyer en ton nom à ${canal}:${dest} ce texte exact : « ${exact(String(input.text ?? ''))} »`;
  }
  if (tool === 'mail_send') {
    return `envoyer en ton nom un e-mail à ${String(input.to ?? '')} (sujet « ${String(input.subject ?? '')} ») avec ce texte exact : « ${exact(String(input.text ?? ''))} »`;
  }
  return undefined;
}
