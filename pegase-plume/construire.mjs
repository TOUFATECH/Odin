// Fabrique pegase-plume/plume-page.js : le script de Plume (src/web/plume.js + src/web/plume.css, le même que dans
// l'interface d'Odin) emballé pour le monde isolé de Pégase, avec son transport par IPC (PLUME_HOTE).
//
//   node pegase-plume/construire.mjs          → réécrit pegase-plume/plume-page.js
//   import { codePage } from './construire.mjs' → le code avec un autre transport (essais)
//
// Le fichier produit est commité : l'agent Pégase n'a qu'à le recopier (voir README.md). Un essai vérifie qu'il est à jour.
import { readFileSync, writeFileSync } from 'node:fs';

const ICI = new URL('./', import.meta.url);
const WEB = new URL('../src/web/', import.meta.url);

/** Le transport de Pégase : seul le processus principal parle à Odin (le jeton ne quitte jamais le processus principal). */
export const HOTE_PEGASE = `const { ipcRenderer } = require('electron');
  const PLUME_HOTE = {
    ou: 'pegase', ombre: true,
    appel: async (chemin, corps) => { const r = await ipcRenderer.invoke('pegase:plume', { chemin, corps }); if (!r || r.ok === false) { const e = new Error((r && r.message) || 'Plume ne répond pas.'); e.status = r && r.status; throw e; } return r; },
    ouvrirReglages: () => ipcRenderer.send('pegase:plume-reglages'),
    diffuser: () => {},
    ecouter: (f) => ipcRenderer.on('pegase:plume-etat', (_e, etat) => f(etat)),
    // Essais de Pégase seulement : le processus principal répond oui hors paquet et avec PEGASE_ESSAI (jamais chez toi).
    essai: (api) => { ipcRenderer.invoke('pegase:plume-essai').then((oui) => { if (oui === true) globalThis.__plumeEssai = api; }).catch(() => {}); },
  };`;

/** Le code du script de page, avec ce transport (`hote` : du code qui définit `const PLUME_HOTE = {…}`). */
export function codePage(hote = HOTE_PEGASE) {
  const css = readFileSync(new URL('plume.css', WEB), 'utf8'), js = readFileSync(new URL('plume.js', WEB), 'utf8');
  if (!js.includes('"/*@PLUME_CSS@*/"')) throw new Error('plume.js : la place du CSS manque');
  const corps = js.replace('"/*@PLUME_CSS@*/"', () => JSON.stringify(css));
  return `// FICHIER FABRIQUÉ par pegase-plume/construire.mjs à partir de src/web/plume.js et src/web/plume.css : ne pas le modifier à la main.
// Plume partout dans Pégase : à exécuter dans le monde isolé des pages (préchargement « page », contextIsolation, bac à sable).
// Voir pegase-plume/README.md.
(() => {
  'use strict';
  if (!/^https?:$/.test(location.protocol) || window.top !== window) return; // les pages web, pas les cadres
  ${hote}
${corps}
})();
`;
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  writeFileSync(new URL('plume-page.js', ICI), codePage());
  console.log('pegase-plume/plume-page.js fabriqué.');
}
