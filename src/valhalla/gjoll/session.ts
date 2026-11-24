// Vortex : d'où part une demande quand ce n'est pas la session du propriétaire.
//
// Décision du propriétaire (26/11) : une tablette de l'écran de la maison, même avec les droits « complet », ne demande
// ni le QR code ni le fichier de configuration d'un appareil du VPN (ils portent sa clé secrète). L'écran de la maison
// dit ici quelle tablette demande ; Vortex refuse ces gestes-là (src/valhalla/modules/gjoll.ts). Sans rien de posé :
// la demande ne vient pas d'une tablette.
import { AsyncLocalStorage } from 'node:async_hooks';

/** Posé par l'écran de la maison pour toute la demande d'une tablette : son nom d'affichage (« tablette « Salon » »). */
export const parTablette = new AsyncLocalStorage<string>();
/** La tablette qui demande, ou rien (session du propriétaire, ou tout autre chemin). */
export const tabletteQuiDemande = (): string | undefined => parTablette.getStore() || undefined;
