// Durcissement de Pégase : ce que les pages web ont le droit de faire, et ce qu'elles n'ont pas le droit de faire.
// (bac à sable partout, navigations gardées, fenêtres surgissantes seulement après un geste, permissions demandées,
// protocoles externes demandés ou bloqués, HTTPS d'abord, certificats invalides arrêtés, cookies tiers coupés,
// IP locale cachée à WebRTC, adresses trompeuses montrées en clair).
import { app, dialog, shell, type WebContents, type Session } from 'electron';
import { domainToUnicode } from 'node:url';
import { getDomain } from 'tldts-experimental';

/** Protocoles qu'une page ne peut jamais faire ouvrir (attaques connues : Follina, search-ms…). */
const PROTOCOLES_INTERDITS = new Set(['ms-msdt', 'search-ms', 'search', 'ms-officecmd', 'ms-word', 'ms-excel', 'ms-powerpoint', 'ms-cxh', 'ms-cxh-full', 'ms-appinstaller', 'file', 'javascript', 'vbscript', 'jar', 'smb', 'ldap', 'ms-settings', 'shell', 'res', 'its', 'mk', 'mhtml', 'ms-its', 'hcp', 'help', 'calculator', 'ms-diagnostics']);
/** Ce qu'une page web peut charger en navigation principale. */
const SCHEMAS_WEB = /^(https?|about|blob|data|view-source):/i;

export const gestes = new Map<number, number>(); // id du webContents → heure du dernier geste (clic, touche)
const exceptionsCertificat = new Set<string>(); // hôtes acceptés malgré un certificat invalide (cette session seulement)
export const httpPermis = new Set<string>((!app.isPackaged && process.env.PEGASE_HTTP_OK ? process.env.PEGASE_HTTP_OK.split(',') : []));

/** Une adresse privée ou locale (pas d'HTTPS d'abord pour elle). */
export function hotePrive(h: string): boolean {
  return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?fe80:|.*\.local$|.*\.lan$|.*\.home\.arpa$|.*\.internal$)/i.test(h) || /^\d+\.\d+\.\d+\.\d+$/.test(h) && /^(127|10|192\.168|169\.254)\./.test(h);
}

/**
 * Le nom d'hôte à montrer : en lettres normales s'il est d'un seul alphabet, sinon en xn--… (anti-sosie),
 * et jamais de caractère qui retourne le texte (RTL).
 */
export function hoteAffiche(hote: string): string {
  const uni = domainToUnicode(hote) || hote;
  if (uni === hote) return hote.replace(/[‪-‮⁦-⁩‎‏]/g, '');
  const scripts = new Set<string>();
  for (const ch of uni.replace(/[.\-0-9]/g, '')) {
    for (const s of ['Latin', 'Cyrillic', 'Greek', 'Armenian', 'Hebrew', 'Arabic', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Thai', 'Devanagari', 'Georgian', 'Cherokee']) {
      if (new RegExp(`\\p{Script=${s}}`, 'u').test(ch)) { scripts.add(s); break; }
    }
  }
  const japonais = [...scripts].every((s) => ['Han', 'Hiragana', 'Katakana', 'Latin'].includes(s));
  const coreen = [...scripts].every((s) => ['Han', 'Hangul', 'Latin'].includes(s));
  // Un seul alphabet (ou les mélanges normaux du japonais / du coréen) : on montre les lettres ; sinon le punycode.
  if (scripts.size <= 1 || japonais || coreen) {
    // Même d'un seul alphabet, un nom tout en cyrillique qui imite un nom latin reste suspect : on garde le punycode
    // quand toutes ses lettres ressemblent à des lettres latines.
    if (scripts.has('Cyrillic') && /^[аеорсухіјѕԁԛԝ.\-0-9]+$/u.test(uni)) return hote;
    return uni;
  }
  return hote;
}

/** Les règles posées sur chaque page web. */
export function durcirPage(wc: WebContents, ouvrirOnglet: (url: string, arrierePlan: boolean) => void): void {
  wc.setWebRTCIPHandlingPolicy('default_public_interface_only');
  wc.on('before-input-event', (_e, i) => { if (i.type === 'mouseDown' || i.type === 'keyDown' || i.type === 'rawKeyDown') gestes.set(wc.id, Date.now()); });
  wc.on('input-event', (_e, i) => { if (i.type === 'mouseDown' || i.type === 'keyDown' || i.type === 'rawKeyDown' || i.type === 'gestureTap' || i.type === 'touchStart') gestes.set(wc.id, Date.now()); });
  wc.once('destroyed', () => gestes.delete(wc.id));
  const garde = (e: Electron.Event, url: string) => {
    if (!SCHEMAS_WEB.test(url)) { e.preventDefault(); return; }
    // Une page ne peut pas, toute seule, se changer en data: (hameçonnage) : seulement un geste ou un lien.
    if (/^data:/i.test(url) && !/^data:image\//i.test(url)) e.preventDefault();
  };
  wc.on('will-navigate', garde);
  wc.on('will-frame-navigate', (e) => { if (!SCHEMAS_WEB.test(e.url) && !/^(about|blob|data):/i.test(e.url)) e.preventDefault(); });
  wc.on('will-redirect', (e, url) => { if (!SCHEMAS_WEB.test(url)) e.preventDefault(); });
  // Fenêtres surgissantes : seulement juste après un geste de la personne, une à la fois ; jamais de lien « opener ».
  wc.setWindowOpenHandler(({ url, disposition }) => {
    const geste = gestes.get(wc.id) ?? 0;
    if (Date.now() - geste < 1500 && /^(https?|about:blank)/i.test(url)) {
      gestes.set(wc.id, 0); // un geste = une fenêtre
      ouvrirOnglet(url, disposition === 'background-tab');
    }
    return { action: 'deny' };
  });
}

/** Les règles posées sur chaque session de profil : permissions, protocoles externes, certificats. */
export function durcirSession(s: Session, nomSite: (wc: WebContents | null, url?: string) => string): void {
  const reponses = new Map<string, boolean>();
  const demandes = new Map<string, number[]>();
  const noms: Record<string, (d: any) => string> = {
    media: (d) => (d?.mediaTypes?.includes('video') ? 'ta caméra et ton micro' : 'ton micro'), geolocation: () => 'ta position', notifications: () => 't’envoyer des notifications',
    'clipboard-read': () => 'lire ton presse-papiers', midi: () => 'tes instruments MIDI', midiSysex: () => 'tes instruments MIDI', 'display-capture': () => 'voir ton écran',
    hid: () => 'des appareils branchés (HID)', serial: () => 'des ports série', usb: () => 'des appareils USB', idleDetection: () => 'savoir si tu es devant l’écran',
  };
  s.setPermissionCheckHandler((wc, permission, origine) => {
    if (['fullscreen', 'clipboard-sanitized-write', 'pointerLock'].includes(permission)) return true;
    return reponses.get(`${origine}|${permission}`) === true || (wc ? reponses.get(`${new URL(wc.getURL() || 'about:blank').origin}|${permission}`) === true : false);
  });
  s.setPermissionRequestHandler((wc, permission, rappel, details: any) => {
    if (['fullscreen', 'clipboard-sanitized-write', 'pointerLock'].includes(permission)) return rappel(true);
    if (permission === 'openExternal') return protocoleExterne(wc, details?.externalURL, rappel);
    const nom = noms[permission]?.(details);
    if (!nom || !details?.requestingUrl) return rappel(false);
    let origine = ''; try { origine = new URL(details.requestingUrl).origin; } catch { return rappel(false); }
    const cle = `${origine}|${permission}`;
    if (reponses.has(cle)) return rappel(reponses.get(cle)!);
    // Avalanche de demandes : plus de 3 en une minute pour un site → refusé sans demander.
    const l = (demandes.get(origine) ?? []).filter((t) => Date.now() - t < 60_000); l.push(Date.now()); demandes.set(origine, l);
    if (l.length > 3 || !details.isMainFrame && permission !== 'media') return rappel(false);
    if (process.env.PEGASE_PERMISSIONS === 'refuser' && !app.isPackaged) { reponses.set(cle, false); return rappel(false); }
    dialog.showMessageBox({ type: 'question', buttons: ['Autoriser', 'Refuser'], defaultId: 1, cancelId: 1, noLink: true, title: 'Pégase', message: `${nomSite(wc, details.requestingUrl)} veut ${nom.startsWith('t’') || nom.startsWith('savoir') || nom.startsWith('lire') || nom.startsWith('voir') ? nom : `utiliser ${nom}`}.`, detail: 'Refuse si tu ne sais pas pourquoi ce site en a besoin. Tu peux changer d’avis dans Réglages → Permissions des sites.' })
      .then((r) => { const ok = r.response === 0; reponses.set(cle, ok); rappel(ok); }).catch(() => rappel(false));
  });
  (s as any).__reponsesPermissions = reponses;
}

/** Un lien vers un programme (mailto:, zoommtg:…) : demandé avant ; certains protocoles dangereux, jamais. */
function protocoleExterne(wc: WebContents | null, url: string | undefined, rappel: (ok: boolean) => void): void {
  if (!url) return rappel(false);
  let proto = ''; try { proto = new URL(url).protocol.replace(':', '').toLowerCase(); } catch { return rappel(false); }
  if (PROTOCOLES_INTERDITS.has(proto) || proto.startsWith('ms-') && !['ms-teams'].includes(proto)) return rappel(false);
  if (process.env.PEGASE_PERMISSIONS === 'refuser' && !app.isPackaged) return rappel(false);
  const site = wc ? new URL(wc.getURL() || 'about:blank').hostname : 'Une page';
  dialog.showMessageBox({ type: 'question', buttons: ['Ouvrir', 'Annuler'], defaultId: 1, cancelId: 1, noLink: true, title: 'Pégase', message: `${site} veut ouvrir un programme de ton ordinateur (lien « ${proto}: »).`, detail: 'N’accepte que si tu as cliqué toi-même sur ce lien et que tu connais ce programme.' })
    .then((r) => { if (r.response === 0) shell.openExternal(url).catch(() => 0); rappel(false); }).catch(() => rappel(false));
}

/** Certificats invalides : arrêt, sauf si la personne a choisi de continuer pour cet hôte (jamais retenu après fermeture). */
export function brancherCertificats(): void {
  app.on('certificate-error', (e, _wc, url, _erreur, _cert, rappel) => {
    let hote = ''; try { hote = new URL(url).host; } catch { /* */ }
    if (exceptionsCertificat.has(hote)) { e.preventDefault(); rappel(true); return; }
    rappel(false);
  });
}
export function accepterCertificat(hote: string): void { exceptionsCertificat.add(hote); }

/** Cookies tiers : on retire les en-têtes Cookie / Set-Cookie d'une requête faite pour un autre site que la page. */
export function siteDe(url: string): string { try { const h = new URL(url).hostname; return getDomain(h) || h; } catch { return ''; } }
export function estTiers(d: { url: string; resourceType?: string; webContents?: WebContents | null; referrer?: string; frame?: any }): boolean {
  if (d.resourceType === 'mainFrame') return false;
  const haut = d.webContents?.getURL?.() || d.referrer || '';
  if (!haut || !/^https?:/.test(haut)) return false;
  return siteDe(d.url) !== siteDe(haut);
}

/** HTTPS d'abord : une adresse http:// d'un site public est d'abord essayée en https://. */
export function httpsDabord(url: string): string | null {
  if (!/^http:\/\//i.test(url)) return null;
  try {
    const u = new URL(url);
    if (hotePrive(u.hostname) || httpPermis.has(u.hostname)) return null;
    u.protocol = 'https:'; return u.toString();
  } catch { return null; }
}
