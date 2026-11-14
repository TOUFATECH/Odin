// Plume partout dans Pégase — le côté processus principal (Electron). CommonJS, sans dépendance.
// La page n'a jamais l'accès à Odin : le script de page (plume-page.js, monde isolé) demande ici par IPC, et seul ce
// fichier parle à Odin, avec le jeton de l'appareil (que la page ne voit jamais). Contrat : docs/plume-protocole.md.
//
//   const { brancherPlume } = require('./plume-main.cjs');
//   brancherPlume({ ipcMain, appelOdin, estPage, ouvrirReglages, pages });
'use strict';

const ROUTES = new Set(['etat', 'corriger', 'reglages', 'dictionnaire', 'ignorer']);
const REGLAGES = ['actif', 'odin', 'pegase', 'ia', 'grammaire', 'langue'];

/** Ne garde que ce que la route attend (rien d'autre ne part vers Odin). Pur. */
function nettoyer(chemin, corps) {
  if (corps === undefined || corps === null) return undefined;
  if (typeof corps !== 'object' || Array.isArray(corps)) return null;
  const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  if (chemin === 'corriger') return typeof corps.texte === 'string' && corps.texte.length <= 20000 ? { texte: corps.texte, ou: 'pegase', champ: ['texte', 'ligne', 'recherche'].includes(corps.champ) ? corps.champ : 'texte', ...(s(corps.langue, 10) ? { langue: s(corps.langue, 10) } : {}) } : null;
  if (chemin === 'reglages') { const o = {}; for (const k of REGLAGES) if (k === 'langue' ? typeof corps[k] === 'string' : typeof corps[k] === 'boolean') o[k] = corps[k]; return Object.keys(o).length ? o : null; }
  if (chemin === 'dictionnaire') return s(corps.ajouter, 60) ? { ajouter: s(corps.ajouter, 60) } : s(corps.retirer, 60) ? { retirer: s(corps.retirer, 60) } : null;
  if (chemin === 'ignorer') {
    if (corps.oublier === true) return { oublier: true };
    if (corps.retirer && typeof corps.retirer === 'object') return { retirer: { avant: s(corps.retirer.avant, 200) || '', regle: s(corps.retirer.regle, 80) || '' } };
    return s(corps.avant, 200) ? { avant: s(corps.avant, 200), regle: s(corps.regle, 80) || '' } : null;
  }
  return null;
}

/**
 * Branche Plume dans le processus principal de Pégase.
 * @param {object} o
 * @param {import('electron').IpcMain} o.ipcMain
 * @param {(chemin: string, corps?: unknown) => Promise<{ status: number, j: any }>} o.appelOdin  GET (corps absent) ou POST JSON
 *        vers `https://<Odin>/api/plume/<chemin>` avec `Authorization: Bearer <jeton de l'appareil>` (la fonction `appel`
 *        de src/main/odin.ts, certificat épinglé). Rend `{ status: 0 }` si Pégase n'est pas relié à Odin.
 * @param {(webContentsId: number) => boolean} o.estPage  vrai seulement pour les onglets de pages web (pas l'interface de Pégase)
 * @param {() => void} o.ouvrirReglages  ouvre Réglages → Plume (l'interface d'Odin à l'adresse `<Odin>/#plume`, dans un onglet)
 * @param {() => Iterable<import('electron').WebContents>} o.pages  les onglets ouverts (pour leur dire quand Plume change)
 * @param {boolean} [o.prive]  vrai dans une fenêtre privée : Plume n'y envoie rien (au choix de l'agent Pégase)
 */
function brancherPlume(o) {
  let dernier = null;
  const diffuser = (etat) => {
    if (!etat || typeof etat !== 'object') return;
    const sig = JSON.stringify(etat); if (sig === dernier) return; dernier = sig;
    for (const wc of o.pages()) { try { if (!wc.isDestroyed()) wc.send('pegase:plume-etat', etat); } catch { /* onglet fermé */ } }
  };
  o.ipcMain.handle('pegase:plume', async (e, d) => {
    if (!o.estPage(e.sender.id)) return { ok: false, status: 403, message: 'Réservé aux pages.' };
    const f = e.senderFrame; if (!f || f !== f.top) return { ok: false, status: 403, message: 'Pas dans un cadre.' };
    const chemin = d && typeof d.chemin === 'string' ? d.chemin : ''; if (!ROUTES.has(chemin)) return { ok: false, status: 400, message: 'Route inconnue.' };
    const corps = nettoyer(chemin, d.corps); if (corps === null) return { ok: false, status: 400, message: 'Demande refusée.' };
    if ((chemin === 'etat' || chemin === 'corriger' || chemin === 'reglages') && (corps === undefined) !== (chemin === 'etat')) return { ok: false, status: 400, message: 'Demande refusée.' };
    try {
      const r = await o.appelOdin(`/api/plume/${chemin}`, corps);
      if (!r || !r.status) return { ok: false, status: 0, message: 'Pégase n\'est pas relié à Odin.' };
      if (r.status !== 200) return { ok: false, status: r.status, message: (r.j && (r.j.message || r.j.error)) || `Odin répond ${r.status}.` };
      if (chemin === 'etat' || chemin === 'reglages') diffuser(r.j);
      if (chemin === 'corriger' && r.j && r.j.actif === false) diffuser({ ...(dernier ? JSON.parse(dernier) : {}), actif: false });
      return r.j;
    } catch (err) { return { ok: false, status: 0, message: `Odin ne répond pas (${err && err.message ? err.message : 'réseau'}).` }; }
  });
  o.ipcMain.on('pegase:plume-reglages', (e) => { if (o.estPage(e.sender.id)) o.ouvrirReglages(); });
  return { diffuser, nettoyer };
}

module.exports = { brancherPlume, nettoyer };
