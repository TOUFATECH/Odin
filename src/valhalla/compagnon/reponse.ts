// Les consignes de réponse qu'Argos (l'EDR) fait exécuter sur un poste par son compagnon : tuer un processus,
// mettre un fichier en quarantaine là-bas, ou isoler le poste du réseau (il ne parle plus qu'à Odin). Chaque
// consigne est réversible (une consigne inverse la défait) et porte son identifiant pour le suivi.
//
// Ce fichier est pur : il définit la consigne et construit la commande exacte à lancer sur le poste (PowerShell
// pour Windows, sh pour Linux et macOS), avec ses garde-fous. L'exécution réelle se fait sur le poste (le compagnon,
// ou SSH) ; Odin n'envoie jamais un fichier dehors, et une isolation garde toujours Odin joignable.
//
// Rien ici ne tue, ne bloque ni n'isole quoi que ce soit : seulement le texte de la commande. Une action grave reste
// soumise à l'accord du propriétaire (côté Argos) et tout est journalisé.

import { isIP } from 'node:net';
import type { SystemePoste } from './telemetrie.ts';

export type GenreReponse = 'tuer' | 'quarantaine' | 'liberer' | 'isoler' | 'rendre_reseau';
/** Une consigne de réponse pour un poste. `annuleId` : l'identifiant de la consigne que celle-ci défait. */
export interface ConsigneReponse {
  id: string; genre: GenreReponse; at: number;
  pid?: number; nom?: string; fichier?: string; sha256?: string;
  /** l'adresse d'Odin que l'isolation laisse joignable (sinon le poste ne pourrait plus obéir). */ odin?: string;
  annuleId?: string;
}

const pidValide = (pid: unknown): pid is number => Number.isInteger(pid) && Number(pid) > 1 && Number(pid) < 2 ** 31;
/** Un chemin de fichier sans caractère de contrôle, de longueur raisonnable, non vide. Pur. */
export function cheminValide(f: unknown): f is string { return typeof f === 'string' && f.trim().length > 0 && f.length <= 400 && !/[\u0000-\u001f]/.test(f); }
/** L'adresse (IP ou nom d'hôte) par laquelle le poste joint Odin, pour la garder ouverte pendant l'isolation. Pur. */
export function hoteValide(h: unknown): h is string {
  if (typeof h !== 'string') return false; const t = h.trim();
  return isIP(t) !== 0 || /^[A-Za-z0-9]([\w.-]{0,251}[A-Za-z0-9])?$/.test(t);
}

/**
 * Vérifie qu'une consigne est bien formée (sinon rend la raison du refus), pour qu'aucune commande incomplète ou
 * dangereuse ne parte vers un poste. Pur.
 */
export function verifierConsigne(c: ConsigneReponse): string | undefined {
  switch (c.genre) {
    case 'tuer': return pidValide(c.pid) ? undefined : 'tuer un processus demande un numéro (pid) valide';
    case 'quarantaine': case 'liberer': return cheminValide(c.fichier) ? undefined : 'la quarantaine demande le chemin du fichier';
    // Une IP, jamais un nom : le pare-feu du poste n'autorise qu'une IP, et un nom couperait le poste d'Odin aussi
    // (la règle d'autorisation d'Odin échouerait en silence, et l'isolement ne serait plus annulable à distance).
    case 'isoler': return isIP(String(c.odin ?? '')) !== 0 ? undefined : 'isoler un poste demande l\'adresse IP d\'Odin (pas un nom) à garder joignable';
    case 'rendre_reseau': return undefined;
    default: return 'consigne inconnue';
  }
}
/** La consigne qui défait celle-ci (ou rien si elle n'est pas réversible). Pur. */
export function consigneInverse(c: ConsigneReponse, id: string, now: number): ConsigneReponse | undefined {
  if (c.genre === 'quarantaine') return { id, genre: 'liberer', at: now, fichier: c.fichier, annuleId: c.id };
  if (c.genre === 'isoler') return { id, genre: 'rendre_reseau', at: now, annuleId: c.id };
  // Tuer un processus ne se défait pas (le processus est arrêté) : on ne le relance pas tout seul.
  return undefined;
}
/** En clair, ce qu'une réponse va faire (pour l'accord du propriétaire et le journal). Pur. */
export function texteConsigne(c: ConsigneReponse, poste: string): string {
  switch (c.genre) {
    case 'tuer': return `arrêter le processus ${c.pid}${c.nom ? ` (${c.nom})` : ''} sur ${poste}`;
    case 'quarantaine': return `mettre à l'écart le fichier ${c.fichier} sur ${poste} (il ne pourra plus rien faire)`;
    case 'liberer': return `remettre en place le fichier ${c.fichier} sur ${poste}`;
    case 'isoler': return `couper ${poste} du réseau, sauf Odin : plus aucune autre connexion`;
    case 'rendre_reseau': return `rendre le réseau à ${poste}`;
  }
}

const DOSSIER_QUARANTAINE = { posix: '/var/lib/odin-compagnon/quarantaine', windows: 'C:\\ProgramData\\OdinCompagnon\\quarantaine' } as const;
const psChaine = (t: string) => `'${String(t).replace(/'/g, "''")}'`;
const shChaine = (t: string) => `'${String(t).replace(/'/g, `'\\''`)}'`;

/**
 * La commande à lancer sur le poste pour appliquer une consigne, selon son système. Rend rien si la consigne est mal
 * formée. L'isolation garde Odin joignable (son adresse, le DNS et le bouclage local) : le poste doit pouvoir continuer
 * à recevoir les consignes et, plus tard, la consigne qui lui rend le réseau. Pur.
 */
export function commandeDeConsigne(c: ConsigneReponse, sys: SystemePoste): string | undefined {
  if (verifierConsigne(c)) return undefined;
  const windows = sys === 'windows';
  switch (c.genre) {
    case 'tuer':
      return windows ? `Stop-Process -Id ${c.pid} -Force` : `kill -TERM ${c.pid} 2>/dev/null; sleep 2; kill -KILL ${c.pid} 2>/dev/null; true`;
    case 'quarantaine': {
      const q = windows ? DOSSIER_QUARANTAINE.windows : DOSSIER_QUARANTAINE.posix, f = c.fichier!;
      return windows
        ? `New-Item -ItemType Directory -Force -Path ${psChaine(q)} | Out-Null; Move-Item -LiteralPath ${psChaine(f)} -Destination (Join-Path ${psChaine(q)} ([IO.Path]::GetFileName(${psChaine(f)}) + '.' + [Guid]::NewGuid().ToString('N') + '.odin')) -Force`
        : `mkdir -p ${shChaine(q)} && mv -f ${shChaine(f)} ${shChaine(q)}/"$(basename ${shChaine(f)}).$(date +%s).odin" && chmod 000 ${shChaine(q)}/* 2>/dev/null; true`;
    }
    case 'liberer':
      // La remise en place est faite par le compagnon à partir de son registre de quarantaine (chemin d'origine gardé là-bas) ; ici on ne force rien.
      return windows ? `Write-Output ${psChaine(`à remettre : ${c.fichier}`)}` : `printf '%s\\n' ${shChaine(`à remettre : ${c.fichier}`)}`;
    case 'isoler': return windows ? isolerWindows(c.odin!) : isolerPosix(sys, c.odin!);
    case 'rendre_reseau': return windows ? rendreReseauWindows() : rendreReseauPosix(sys);
  }
}

/** Isole un poste Windows au pare-feu (bloque tout entrant et sortant), sauf Odin, le DNS et le bouclage. Pur. */
export function isolerWindows(odin: string): string {
  return [
    `New-NetFirewallRule -DisplayName 'Odin-isolation-autorise' -Direction Outbound -Action Allow -RemoteAddress ${psChaine(odin)} -Profile Any -ErrorAction SilentlyContinue | Out-Null`,
    `New-NetFirewallRule -DisplayName 'Odin-isolation-dns' -Direction Outbound -Action Allow -Protocol UDP -RemotePort 53 -ErrorAction SilentlyContinue | Out-Null`,
    `Set-NetFirewallProfile -Profile Domain,Public,Private -DefaultInboundAction Block -DefaultOutboundAction Block -ErrorAction SilentlyContinue`,
  ].join('; ');
}
/** Rend le réseau à un poste Windows (retire les règles d'isolation et remet la sortie autorisée). Pur. */
export function rendreReseauWindows(): string {
  return `Get-NetFirewallRule -DisplayName 'Odin-isolation-*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue; Set-NetFirewallProfile -Profile Domain,Public,Private -DefaultOutboundAction Allow -DefaultInboundAction Block -ErrorAction SilentlyContinue`;
}
/** Isole un poste Linux (nftables) ou macOS (pf) : ne laisse passer qu'Odin, le DNS et le bouclage. Pur. */
export function isolerPosix(sys: SystemePoste, odin: string): string {
  // `odin` est garanti être une IP (verifierConsigne le vérifie) : on n'ouvre jamais « to any », qui laisserait tout
  // sortir et n'isolerait rien. Une valeur invalide fait échouer la commande (rien n'est appliqué), plutôt que passer tout.
  if (sys === 'macos') {
    return `printf '%s\\n' 'set block-policy drop' 'pass quick on lo0 all' 'pass out quick proto udp to any port 53' 'pass out quick to ${odin}' 'pass in quick from ${odin}' 'block all' > /etc/pf.odin.conf && pfctl -E -f /etc/pf.odin.conf`;
  }
  const regle = `ip daddr ${odin}`;
  return `nft -f - <<'NFT'\nflush ruleset\ntable inet odin_isolation {\n  chain out { type filter hook output priority 0; policy drop; ct state established,related accept; oif lo accept; udp dport 53 accept; ${regle} accept; }\n  chain in { type filter hook input priority 0; policy drop; ct state established,related accept; iif lo accept; }\n}\nNFT`;
}
/** Rend le réseau à un poste Linux (nftables) ou macOS (pf). Pur. */
export function rendreReseauPosix(sys: SystemePoste): string {
  return sys === 'macos' ? `pfctl -d 2>/dev/null; rm -f /etc/pf.odin.conf; true` : `nft delete table inet odin_isolation 2>/dev/null; true`;
}
