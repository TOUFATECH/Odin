// Commandes · toutes les invites de commande d'Odin sur une page : une par action de chaque appli, avec un
// exemple. « Donne-moi la commande pour bannir une adresse » → la bonne commande. Odin agit d'habitude tout
// seul (sans commande) ; la commande sert quand tu veux le faire toi-même, dans un script ou un terminal.
import { commandsOf, findCommands } from '../commands.ts';
import type { Module } from '../types.ts';

const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));
export const commandes: Module = {
  id: 'commandes', name: 'Commandes', family: 'Données',
  what: 'Toutes les invites de commande d\'Odin : une pour chaque fonction de chaque appli, avec un exemple prêt à copier.',
  does: ['une commande par action de chaque appli : odin <appli> <action> --option valeur', 'exemple prêt à copier, options, accord demandé pour ce qui est grave', 'trouver la commande d\'une demande (« la commande pour bannir une adresse »)', 'la liste est aussi dans la mémoire d\'Odin (fiche de chaque appli)'],
  from: [], upstream: [],
  words: ['invite de commande', 'invites de commande', 'ligne de commande', 'la commande pour', 'commande pour', 'commandes d\'odin'],
  actions: [
    { id: 'chercher', label: 'Trouver une commande', what: 'La commande qui fait ce que tu décris', read: true, params: [{ key: 'q', label: 'Ce que tu veux faire', kind: 'text', required: true }], words: ['la commande pour', 'commande pour', 'quelle commande'], run: (ctx, i) => {
      const found = findCommands(commandsOf(ctx.modules()), s(i.q));
      return { text: found.length ? found.map((c) => `- ${c.appName} · ${c.label}${c.grave ? ' (demande ton accord)' : ''} :\n  ${c.example}`).join('\n') : 'Aucune commande ne correspond. Dis « liste des commandes » pour tout voir.', data: found };
    } },
    { id: 'liste', label: 'Liste des commandes', what: 'Toutes les commandes, ou celles d\'une appli', read: true, params: [{ key: 'appli', label: 'Appli (vide : toutes)', kind: 'text', default: '' }], words: ['liste des commandes', 'toutes les commandes', 'invites de commande'], run: (ctx, i) => {
      const q = s(i.appli).trim().toLowerCase(), all = commandsOf(ctx.modules()).filter((c) => !q || c.app === q || c.appName.toLowerCase() === q);
      return { text: `${all.length} commande(s) :\n${all.slice(0, 200).map((c) => `- ${c.line}  — ${c.label}`).join('\n')}`, data: all };
    } },
  ],
  view(ctx) {
    const all = commandsOf(ctx.modules());
    return {
      subtitle: `${all.length} commandes · ${new Set(all.map((c) => c.app)).size} applis`,
      kpis: [{ label: 'Commandes', value: String(all.length) }, { label: 'Lecture seule', value: String(all.filter((c) => c.read).length) }, { label: 'Avec ton accord', value: String(all.filter((c) => c.grave).length) }],
      sections: [
        { kind: 'text', title: 'Comment ça marche', text: 'Dans un terminal sur la machine d\'Odin (Odin doit tourner) : odin <appli> <action> --option valeur. Exemple : odin vidarr bloquer --domaine tiktok.com. « odin commandes » les liste toutes, « odin commandes ban » cherche. Une action grave demande ta confirmation. Odin, lui, agit d\'habitude directement, sans commande.' },
        { kind: 'table', title: 'Toutes les commandes', columns: ['Appli', 'Exemple', 'Ce qu\'elle fait', 'Accord'], rows: all.map((c) => ({ cells: [c.appName, c.example, `${c.label} — ${c.what}`, c.grave ? 'oui' : c.read ? 'lecture' : '—'] })) },
      ],
    };
  },
};
