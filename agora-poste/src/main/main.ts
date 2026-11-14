// Agora, le store d'Odin sur l'ordinateur : le processus principal.
// Une fenêtre (Mon store, Mises à jour, Historique) et un moteur qui tourne même fenêtre fermée (icône près de
// l'horloge) : les installations imposées par l'admin d'Odin se font sans rien demander.
import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray, session } from 'electron';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { Rangement } from './stockage';
import { Connexion } from './odin';
import { Moteur } from './moteur';

app.setName('Agora');
const racine = process.env.AGORA_DOSSIER || join(app.getPath('appData'), process.platform === 'linux' ? 'agora' : 'Agora');
app.setPath('userData', racine);
if (process.platform === 'win32') app.setAppUserModelId('com.toufatech.agora');
if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();
if (!app.commandLine.hasSwitch('lang')) app.commandLine.appendSwitch('lang', 'fr');
if (app.isPackaged && (app.commandLine.hasSwitch('remote-debugging-port') || app.commandLine.hasSwitch('remote-debugging-pipe'))) { console.error('Agora refuse de démarrer avec un port de débogage ouvert.'); app.exit(1); }
/** Mode essai (jamais dans une version installée) : connexion automatique, coffre « basic » de Chromium. */
const ESSAI = !app.isPackaged && !!process.env.AGORA_ESSAI;
if (ESSAI) app.commandLine.appendSwitch('password-store', 'basic');
const CACHE = process.argv.includes('--cache') || process.argv.includes('--hidden');
if (!ESSAI && !app.requestSingleInstanceLock()) app.quit();

const r = new Rangement(racine), odin = new Connexion(r), moteur = new Moteur(odin, r, app.getVersion());
let fen: BrowserWindow | null = null, tray: Tray | null = null, quitter = false;
/** Le vrai logo d'Agora : petit pour la zone de notification ; grand (le .ico sous Windows) pour la fenêtre et la barre des tâches. */
const icone = (fichier = 'agora.png') => { const f = join(__dirname, '..', 'ui', fichier); return existsSync(f) ? nativeImage.createFromPath(f) : nativeImage.createEmpty(); };
const iconeFenetre = () => icone(process.platform === 'win32' ? 'agora.ico' : 'agora-256.png');

function fenetre(): void {
  if (fen) { fen.show(); fen.focus(); return; }
  fen = new BrowserWindow({ width: 1080, height: 700, minWidth: 720, minHeight: 520, title: 'Agora · le store d\'Odin', icon: iconeFenetre(), backgroundColor: '#000000', show: !CACHE,
    webPreferences: { preload: join(__dirname, '..', 'preload', 'ui.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false } });
  fen.removeMenu();
  // La fenêtre ne va nulle part ailleurs que sa propre page ; les liens s'ouvrent dans le navigateur du système.
  fen.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  fen.webContents.on('will-navigate', (e) => e.preventDefault());
  void fen.loadFile(join(__dirname, '..', 'ui', 'index.html'));
  fen.on('close', (e) => { if (!quitter && tray) { e.preventDefault(); fen?.hide(); } });
  fen.on('closed', () => { fen = null; });
}
const envoyer = () => fen?.webContents.send('agora:etat', moteur.etat);
moteur.on('etat', envoyer);

/** Démarrage avec la session (Linux : ~/.config/autostart ; Windows et Mac : ouverture à la connexion), fenêtre cachée. */
function demarrageAuto(): void {
  if (!app.isPackaged || ESSAI) return;
  if (process.platform === 'linux') {
    const d = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'autostart'), exe = process.env.APPIMAGE || process.execPath;
    try { mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'agora.desktop'), `[Desktop Entry]\nType=Application\nName=Agora\nComment=Le store d'Odin\nExec="${exe}" --cache\nX-GNOME-Autostart-enabled=true\n`); } catch { /* pas grave */ }
  } else app.setLoginItemSettings({ openAtLogin: true, args: ['--cache'] });
}

ipcMain.handle('agora:etat', () => moteur.etat);
ipcMain.handle('agora:faire', async (_e, action: string, arg: Record<string, unknown> = {}) => {
  const s = (v: unknown) => String(v ?? '').trim();
  switch (action) {
    case 'trouver': { const l = await odin.trouver().catch(() => []); moteur.etat = { ...moteur.etat, connexionInfo: { ...(moteur.etat.connexionInfo ?? {}), trouves: l.map((x) => ({ adresse: x.adresse, nom: x.nom })) } }; envoyer(); return { ok: true, trouves: l }; }
    case 'connecter': {
      const x = await odin.connecter(s(arg.adresse), s(arg.identifiant), s(arg.motdepasse), s(arg.code) || undefined);
      if (!x.ok) { moteur.etat = { ...moteur.etat, connexionInfo: { ...(moteur.etat.connexionInfo ?? {}), erreur: x.message, codeRequis: x.codeRequis } }; envoyer(); return x; }
      await moteur.relie(); return { ok: true };
    }
    case 'navigateur': { const x = await odin.parNavigateur(s(arg.adresse), async (u) => { await shell.openExternal(u); }); if (x.ok) await moteur.relie(); else { moteur.etat = { ...moteur.etat, connexionInfo: { erreur: x.message } }; envoyer(); } return x; }
    case 'installer': case 'desinstaller': case 'mettre_a_jour': return moteur.demander(action, s(arg.id));
    case 'ouvrir': {
      const c = moteur.cheminDe(s(arg.id));
      if (c.chemin) { if (c.chemin.endsWith('.AppImage')) { const { spawn } = await import('node:child_process'); const p = spawn(c.chemin, [], { detached: true, stdio: 'ignore' }); p.on('error', () => undefined); p.unref(); } else await shell.openPath(c.chemin); return { ok: true }; }
      if (c.web) { await shell.openExternal(c.web); return { ok: true }; }
      return { ok: false, message: 'Rien à ouvrir.' };
    }
    case 'rafraichir': await moteur.rafraichir(); return { ok: true };
    case 'fermerMessage': moteur.etat = { ...moteur.etat, message: undefined }; envoyer(); return { ok: true };
    case 'deconnecter': await moteur.deconnecter(); return { ok: true };
    // La photo de l'avatar (réduite par l'interface, gardée sur ce PC seulement) ; sans photo, c'est Odin qui s'affiche.
    case 'lirePhoto': { try { return { ok: true, photo: `data:image/jpeg;base64,${readFileSync(join(racine, 'photo.jpg')).toString('base64')}` }; } catch { return { ok: true, photo: '' }; } }
    case 'photo': {
      const ph = typeof arg.photo === 'string' ? arg.photo : '';
      if (!ph) { rmSync(join(racine, 'photo.jpg'), { force: true }); return { ok: true }; }
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(ph);
      if (!m || ph.length > 400_000) return { ok: false, message: 'Image refusée : choisis une photo JPG, PNG ou WebP.' };
      writeFileSync(join(racine, 'photo.jpg'), Buffer.from(m[1], 'base64')); return { ok: true };
    }
    default: return { ok: false, message: 'action inconnue' };
  }
});

app.on('second-instance', () => fenetre());
app.on('window-all-closed', () => { if (!tray) app.quit(); });
app.on('before-quit', () => { quitter = true; void moteur.quitter(); });
void app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  // L'interface n'a besoin d'aucune permission du système (caméra, micro, notifications…).
  session.defaultSession.setPermissionRequestHandler((_w, _p, ok) => ok(false));
  fenetre();
  try { tray = new Tray(icone()); tray.setToolTip('Agora · le store d\'Odin'); tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Ouvrir le store', click: () => fenetre() }, { type: 'separator' }, { label: 'Quitter Agora', click: () => { quitter = true; app.quit(); } }])); tray.on('click', () => fenetre()); } catch { tray = null; }
  demarrageAuto();
  if (ESSAI && process.env.AGORA_ODIN && process.env.AGORA_IDENTIFIANT && !r.relireSession()) {
    // Essai automatique : connexion par identifiant et mot de passe (sans la session du poste).
    const x = await odin.connecter(process.env.AGORA_ODIN, process.env.AGORA_IDENTIFIANT, process.env.AGORA_MOTDEPASSE ?? '', undefined, false);
    if (x.ok) await moteur.relie(); else { console.error(`[agora] connexion d'essai refusée : ${x.message}`); await moteur.demarrer(); }
  } else await moteur.demarrer();
  if (ESSAI) moteur.on('etat', (e) => { try { writeFileSync(join(racine, 'etat-essai.json'), JSON.stringify(e)); } catch { /* rien */ } });
  if (ESSAI) { try { writeFileSync(join(racine, 'etat-essai.json'), JSON.stringify(moteur.etat)); } catch { /* rien */ } }
});
