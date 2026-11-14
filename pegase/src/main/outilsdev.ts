// L'inspecteur (les vrais outils de développement de Chromium, en français, aux couleurs du thème) et
// l'affichage mobile (émulation réelle : taille, densité, agent du téléphone, tactile, réseau lent).
// Rien n'ouvre de port de débogage : l'émulation passe par webContents.debugger, dans le processus.
import { WebContentsView, type WebContents } from 'electron';
import type { Mobile, Outils, Theme } from '../commun/types';
import appareils from '../commun/appareils.json';

type Appareil = { id: string; nom: string; w?: number; h?: number; ouvert?: number[]; ferme?: number[]; dpr: number; agent: string };
export const APPAREILS: Appareil[] = (appareils as any).groupes.flatMap((g: any) => g.appareils);

/** Les couleurs du thème Pégase reprises dans l'inspecteur (variables de couleur des outils de Chromium). */
export function cssOutils(t: Theme): string {
  const P: Record<Theme, { fond: string; fond2: string; texte: string; accent: string; clair: boolean }> = {
    noir: { fond: '#121318', fond2: '#1B1C23', texte: '#F2F3FA', accent: '#8E9BFF', clair: false },
    bleu: { fond: '#1E2150', fond2: '#282C66', texte: '#F2F3FA', accent: '#A9B4FF', clair: false },
    rouge: { fond: '#3A0D17', fond2: '#4A1420', texte: '#FFF4F5', accent: '#FF9BAA', clair: false },
    transparent: { fond: '#14182A', fond2: '#1C2238', texte: '#FFFFFF', accent: '#9BE7FF', clair: false },
    blanc: { fond: '#FFFFFF', fond2: '#F2F4F8', texte: '#1C1F2B', accent: '#4B5AE0', clair: true },
    glace: { fond: '#F4F8FF', fond2: '#E8EFFB', texte: '#10131C', accent: '#3E7BFA', clair: true },
  };
  const c = P[t] ?? P.bleu;
  return `:root, .theme-with-dark-background, :root.theme-with-dark-background {
    color-scheme: ${c.clair ? 'light' : 'dark'};
    --sys-color-cdt-base-container: ${c.fond} !important; --sys-color-cdt-base: ${c.fond} !important;
    --sys-color-surface: ${c.fond} !important; --sys-color-surface1: ${c.fond2} !important; --sys-color-surface2: ${c.fond2} !important;
    --sys-color-surface3: ${c.fond2} !important; --sys-color-surface4: ${c.fond2} !important; --sys-color-surface5: ${c.fond2} !important;
    --sys-color-header-container: ${c.fond2} !important; --sys-color-on-surface: ${c.texte} !important;
    --sys-color-primary: ${c.accent} !important; --sys-color-tonal-container: ${c.accent}33 !important;
    --sys-color-state-focus-select: ${c.accent}33 !important; --sys-color-primary-bright: ${c.accent} !important;
    --color-background: ${c.fond} !important; --color-background-elevation-1: ${c.fond2} !important; --color-text-primary: ${c.texte} !important;
  }`;
}

/** Ouvre l'inspecteur d'une page dans une vue à nous (ancrée à droite ou en bas), ou dans sa propre fenêtre. */
export function ouvrirOutils(wc: WebContents, position: Outils['position'], theme: Theme, ancienne?: WebContentsView | null): WebContentsView | null {
  if (wc.isDevToolsOpened()) wc.closeDevTools();
  if (ancienne) { try { ancienne.webContents.close(); } catch { /* */ } }
  if (position === 'fenetre') { wc.openDevTools({ mode: 'detach', activate: true, title: 'Inspecteur · Pégase' }); return null; }
  const v = new WebContentsView();
  v.setBackgroundColor(theme === 'blanc' || theme === 'glace' ? '#FFFFFF' : '#121318');
  try { v.setBorderRadius(10); } catch { /* */ }
  wc.setDevToolsWebContents(v.webContents);
  wc.openDevTools({ mode: 'detach', activate: false });
  const dt = v.webContents;
  // Français et sombre/clair : si les préférences de l'inspecteur n'étaient pas encore réglées, on les règle puis on le
  // recharge une fois (l'inspecteur ne change de langue qu'au chargement).
  let recharge = false;
  dt.on('did-finish-load', () => {
    colorer(dt, theme);
    if (!recharge) reglerOutils(dt, theme).then((change) => { if (change && !recharge && !dt.isDestroyed()) { recharge = true; dt.reload(); } }).catch(() => 0);
  });
  return v;
}
/**
 * Avant d'ouvrir l'inspecteur : ses préférences (français, sombre ou clair) sont posées par un inspecteur
 * caché, ouvert sur une page vide de la même session, puis refermé. Les préférences sont gardées par Electron.
 */
const prefsFaites = new Map<string, string>();
export async function preparerOutils(session: Electron.Session, theme: Theme): Promise<void> {
  const ui = theme === 'blanc' || theme === 'glace' ? 'default' : 'dark';
  const cle = String((session as any).storagePath ?? 'memoire');
  if (prefsFaites.get(cle) === ui) return;
  const page = new WebContentsView({ webPreferences: { session, sandbox: true } });
  const outils = new WebContentsView();
  try {
    await page.webContents.loadURL('about:blank');
    page.webContents.setDevToolsWebContents(outils.webContents);
    const pret = new Promise<void>((ok) => { outils.webContents.once('did-finish-load', () => ok()); setTimeout(ok, 5000); });
    page.webContents.openDevTools({ mode: 'detach', activate: false });
    await pret;
    await reglerOutils(outils.webContents, theme);
    prefsFaites.set(cle, ui);
  } catch { /* l'inspecteur s'ouvrira quand même, en anglais peut-être */ }
  finally { try { page.webContents.closeDevTools(); page.webContents.close(); outils.webContents.close(); } catch { /* */ } }
}

/** L'inspecteur en français et en thème sombre ou clair selon Pégase (préférences gardées par Electron). */
export function reglerOutils(dt: WebContents, theme: Theme): Promise<boolean> {
  const ui = theme === 'blanc' || theme === 'glace' ? 'default' : 'dark';
  return dt.executeJavaScript(`(()=>{const h=window.InspectorFrontendHost;if(!h||!h.getPreferences)return false;return new Promise(ok=>h.getPreferences(p=>{let change=false;
    if(p.language!=='"fr"'){h.setPreference('language','"fr"');change=true}
    if(p.uiTheme!=='"${ui}"'){h.setPreference('uiTheme','"${ui}"');change=true}
    if(p['languages-reminder-shown']!=='true'){h.setPreference('languages-reminder-shown','true')}
    ok(change)}))})()`, false).then((c) => !!c).catch(() => false);
}
const cles = new WeakMap<WebContents, string>();
export function colorer(dt: WebContents, theme: Theme): void {
  // Sombre ou clair : l'inspecteur suit « prefers-color-scheme » ; on le lui donne, à lui seul (les pages ne changent pas).
  const sombre = !(theme === 'blanc' || theme === 'glace');
  try {
    if (!dt.debugger.isAttached()) dt.debugger.attach('1.3');
    dt.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: sombre ? 'dark' : 'light' }] }).catch(() => 0);
  } catch { /* */ }
  const ancienne = cles.get(dt); if (ancienne) dt.removeInsertedCSS(ancienne).catch(() => 0);
  dt.insertCSS(cssOutils(theme)).then((k) => cles.set(dt, k)).catch(() => 0);
}

/** Affichage mobile : réglages de départ pour un appareil. */
export function mobileDe(id: string, avant?: Mobile): Mobile {
  const a = APPAREILS.find((x) => x.id === id) ?? APPAREILS[0];
  const plie = avant?.appareil === a.id ? avant.plie : false;
  const t = a.ouvert ? (plie ? a.ferme! : a.ouvert) : [a.w!, a.h!];
  const paysage = avant?.appareil === a.id ? avant.paysage : false;
  return { appareil: a.id, w: paysage ? t[1] : t[0], h: paysage ? t[0] : t[1], dpr: a.dpr, plie, paysage, zoom: avant?.zoom ?? 'ajuster', reseau: avant?.reseau ?? 'rapide', agent: a.agent };
}

/** Applique l'émulation à la page : taille, densité, agent du téléphone, tactile, réseau. */
export async function emuler(wc: WebContents, m: Mobile, echelle: number, uaNormal: string): Promise<void> {
  const ua = m.appareil === 'libre' ? uaNormal : (appareils as any).agents[m.agent] ?? uaNormal;
  const changer = wc.getUserAgent() !== ua;
  if (changer) wc.setUserAgent(ua);
  const cmd = async (c: string, a?: object) => { try { await wc.debugger.sendCommand(c, a); return true; } catch (e) { if (process.env.PEGASE_ESSAI) console.error(`émulation : ${c} refusé (${(e as Error).message})`); return false; } };
  try { if (!wc.debugger.isAttached()) wc.debugger.attach('1.3'); } catch { /* déjà branché */ }
  // Taille, densité et « téléphone » (balise viewport respectée, barres de défilement fines) : comme l'affichage
  // mobile de Chrome. (webContents.enableDeviceEmulation ne lit pas la balise viewport : on passe par le protocole.)
  const ok = await cmd('Emulation.setDeviceMetricsOverride', { width: m.w, height: m.h, deviceScaleFactor: m.dpr, mobile: m.appareil !== 'libre', scale: echelle, screenWidth: m.w, screenHeight: m.h, screenOrientation: m.paysage ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
  // Sans le protocole (un autre outil est branché) : l'émulation d'Electron, sans la balise viewport.
  if (!ok) wc.enableDeviceEmulation({ screenPosition: 'mobile', screenSize: { width: m.w, height: m.h }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: m.dpr, viewSize: { width: m.w, height: m.h }, scale: echelle });
  await cmd('Emulation.setTouchEmulationEnabled', { enabled: m.appareil !== 'libre', maxTouchPoints: 5 });
  await cmd('Emulation.setEmitTouchEventsForMouse', { enabled: m.appareil !== 'libre', configuration: 'mobile' });
  await cmd('Emulation.setUserAgentOverride', { userAgent: ua, platform: m.agent.startsWith('i') ? 'iPhone' : 'Linux armv8l' });
  const r = (appareils as any).reseaux[m.reseau];
  await cmd('Network.enable');
  await reseau(wc, r ? { offline: !!r.horsLigne, latency: r.latence ?? 0, downloadThroughput: r.descente ?? -1, uploadThroughput: r.montee ?? -1 } : null).catch(() => 0);
  if (changer) wc.reload();
}

/** Réseau lent ou coupé (Chromium 156 : conditions « par règle » + état en ligne / hors ligne de la page). */
async function reseau(wc: WebContents, c: { offline: boolean; latency: number; downloadThroughput: number; uploadThroughput: number } | null): Promise<void> {
  const x = c ?? { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
  try {
    await wc.debugger.sendCommand('Network.emulateNetworkConditionsByRule', { offline: x.offline, matchedNetworkConditions: c ? [{ urlPattern: '', latency: x.latency, downloadThroughput: x.downloadThroughput, uploadThroughput: x.uploadThroughput }] : [] });
    await wc.debugger.sendCommand('Network.overrideNetworkState', x);
  } catch { await wc.debugger.sendCommand('Network.emulateNetworkConditions', x); }
}

export async function quitterMobile(wc: WebContents, uaNormal: string): Promise<void> {
  wc.disableDeviceEmulation();
  try { if (wc.debugger.isAttached()) { await wc.debugger.sendCommand('Emulation.clearDeviceMetricsOverride'); await wc.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false }); await reseau(wc, null); wc.debugger.detach(); } } catch { /* */ }
  if (wc.getUserAgent() !== uaNormal) { wc.setUserAgent(uaNormal); wc.reload(); }
}
