// Fiches : tout ce qu'Odin sait d'un appareil, d'une personne ou de toi, tenu à jour tout seul
// (un fait plus récent remplace l'ancien, qui reste dans l'historique).

import { obj, str, type Tool } from './registry.ts';

export const memoryProfile: Tool = {
  name: 'memory_profile',
  description: 'Fiche d\'un sujet : tout ce que tu sais d\'un appareil (nas, proxmox…), d\'une personne (personne:mariam), ou du propriétaire, avec les anciennes valeurs remplacées. Sans sujet : la liste des fiches.',
  risk: 'read',
  schema: obj({ subject: str('sujet (facultatif)') }),
  async run(i, ctx) {
    const subject = String(i.subject ?? '').trim();
    if (!subject) { const s = ctx.muninn.subjects(); return s.length ? s.map((x) => `${x.subject} (${x.n})`).join(', ') : 'Aucune fiche pour l\'instant.'; }
    const p = ctx.muninn.profile(subject);
    if (!p.current.length && !p.history.length) return `Rien de connu sur « ${subject} ».`;
    const d = (t: number) => new Date(t).toLocaleDateString('fr-FR');
    return [`Fiche « ${subject} » :`, ...p.current.map((m) => `- ${m.content}${m.source ? ` (${m.source})` : ` (${d(m.created_at)})`}${m.origin === 'owner' ? ' ✓ confirmé par toi' : ''}`),
      ...(p.history.length ? ['Anciennes valeurs :', ...p.history.slice(0, 10).map((m) => `- ${m.content} (jusqu'au ${d(m.created_at)})`)] : [])].join('\n');
  },
};
