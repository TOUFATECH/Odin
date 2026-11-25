// Ce que partagent les essais du lot R1 (Réseau) : la liste exacte des actions protégées et des réglages valables.

/** Les actions de Vortex qui changent le réseau ou montrent un secret (QR code, fichier de configuration). */
export const VORTEX = ['ouvrir_port', 'fermer_port', 'detecter', 'port', 'allumer', 'eteindre', 'ajouter', 'qr', 'telecharger', 'modifier', 'serveur', 'activer', 'revoquer', 'adresse', 'reseaux'];
/** Les actions de Sphinx qui changent le DNS ou le DHCP. */
export const SPHINX = ['demarrer', 'arreter', 'bloquer', 'autoriser', 'regle', 'retirer_regle', 'ajouter_liste', 'activer_liste', 'retirer_liste', 'mettre_a_jour', 'services', 'appareil', 'couper_machine', 'couper_video', 'retablir_machine', 'bloquer_horaires', 'retirer_horaire', 'retirer_appareil', 'nom_local', 'retirer_nom', 'pubs_reseaux', 'horaires', 'dhcp_reglages', 'dhcp_demarrer', 'dhcp_arreter', 'dhcp_fixe', 'dhcp_retirer_fixe', 'dhcp_mode', 'dhcp_mac_etat', 'dhcp_approuver', 'dns_chiffre', 'pause', 'reprendre', 'reglages', 'vider_cache',
  // « bloque-la » (le réseau par la parole) : pas une écriture de plus, il passe par « dhcp_mac_etat » ; protégé et noté comme elles.
  'blocage_nommee'];

/** Des réglages valables pour chaque action (adresses et noms de documentation). */
export function entree(id: string): Record<string, unknown> {
  const E: Record<string, Record<string, unknown>> = {
    port: { ouvert: true }, ajouter: { nom: 'Téléphone 1', tout: true, dns_odin: false }, qr: { nom: 'Téléphone 1' }, telecharger: { nom: 'Téléphone 1' },
    modifier: { nom: 'Téléphone 1', fin: '2099-12-31' }, serveur: { port: 51820, keepalive: 25 }, activer: { nom: 'Téléphone 1', actif: false }, revoquer: { nom: 'Tablette 2' },
    adresse: { adresse: '198.51.100.20', port: 51820 }, reseaux: { reseaux: '10.0.0.0/24', dns: '10.0.0.2' },
    demarrer: { port: 53 }, bloquer: { domaine: 'pub.example.com' }, autoriser: { domaine: 'ok.example.org' }, regle: { regle: '||suivi.example.net^' }, retirer_regle: { regle: '||suivi.example.net^' },
    ajouter_liste: { nom: 'Liste essai', url: 'https://listes.example.org/hosts.txt', type: 'blocage' }, activer_liste: { id: 'pubs', active: false }, retirer_liste: { id: 'pubs' },
    services: { service: 'tiktok', coupe: true }, appareil: { nom: 'PC du bureau', adresses: '10.0.0.177', filtrage: 'global' }, couper_machine: { ip: '10.0.0.177', nom: 'PC du bureau' },
    couper_video: { ip: '10.0.0.177', coupe: true }, retablir_machine: { ip: '10.0.0.177' }, bloquer_horaires: { domaine: 'jeux.example.com', jours: 'tous', de: '21:00', a: '07:00' },
    retirer_horaire: { domaine: 'jeux.example.com' }, retirer_appareil: { nom: 'PC du bureau' }, nom_local: { nom: 'nas.maison', valeur: '10.0.0.10' }, retirer_nom: { nom: 'nas.maison' },
    pubs_reseaux: { actif: true }, horaires: { pour: 'maison', jours: 'tous', de: '21:00', a: '07:00' },
    dhcp_reglages: { debut: '10.0.0.100', fin: '10.0.0.199', passerelle: '10.0.0.1', masque: '255.255.255.0', dns: '10.0.0.2', heures: 12 }, dhcp_demarrer: { forcer: false },
    dhcp_fixe: { mac: '00:00:5e:00:53:01', ip: '10.0.0.50', nom: 'Imprimante' }, dhcp_retirer_fixe: { mac: '00:00:5e:00:53:01' }, dhcp_mode: { mode: 'liste' },
    dhcp_mac_etat: { mac: '00:00:5e:00:53:02', etat: 'bloque', nom: 'Appareil inconnu' }, dhcp_approuver: { mac: '00:00:5e:00:53:03', nom: 'Téléphone 2' },
    dns_chiffre: { actif: false, port: 853 }, pause: { minutes: 5 }, reglages: { strategie: 'rapide' },
  };
  return { ...(E[id] ?? {}) };
}

/** Le refus de la garde « propriétaire seul » (src/valhalla/service.ts). */
export const REFUS = /seul le propriétaire/;
