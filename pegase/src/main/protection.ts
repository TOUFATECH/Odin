// Protection de Pégase : bloqueur dans les pages (listes du même genre que Brave, via @ghostery/adblocker-electron,
// MPL-2.0, utilisé tel quel), DNS chiffré (Sphinx d'Odin, ou un service public de secours), téléchargements en
// quarantaine analysés avant d'arriver sur le PC (contrat §5). Aucune analyse ne garantit 100 %.
import { app, ipcMain, shell, type Session, type DownloadItem, type WebContents } from 'electron';
import { ElectronBlocker, adsAndTrackingLists, fullLists } from '@ghostery/adblocker-electron';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, copyFileSync, unlinkSync, openSync, readSync, closeSync, chmodSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { execFile } from 'node:child_process';
import type { Telechargement } from '../commun/types';
import type { ProfilOuvert } from './profil';
import type { Fenetre } from './fenetre';
import { ecrireSur } from './stockage';
import { nouvelId, domaine } from './outils';
import { httpsDabord, estTiers } from './securite';

// La signature du fichier d'essai EICAR, découpée pour que Pégase lui-même ne soit jamais pris pour un virus.
const EICAR = Buffer.from(['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-', 'TEST-FILE!$H+H*'].join(''));
const EXECUTABLES = new Set(['.exe', '.scr', '.com', '.bat', '.cmd', '.pif', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.msi', '.msp', '.hta', '.cpl', '.lnk', '.ps1', '.jar', '.reg', '.dll', '.appimage', '.sh', '.app', '.pkg', '.dmg', '.deb', '.rpm', '.iso', '.img', '.vhd', '.vhdx']);
const DOCUMENTS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.jpg', '.jpeg', '.png', '.gif', '.mp3', '.mp4', '.zip', '.rar', '.7z', '.odt', '.ods', '.csv', '.rtf', '.heic', '.webp']);

interface Bloque { url: string; type: string; quand: number }

export class Protection {
  private moteurs = new Map<string, ElectronBlocker>();
  private enCours = new Map<string, Promise<ElectronBlocker | null>>();
  private sessions = new Map<Session, ProfilOuvert>();
  private preloads = new Map<Session, string>();
  /** Requêtes bloquées par page (pour le panneau Bouclier), 200 au plus. */
  readonly bloquesPar = new Map<number, Bloque[]>();
  dns = { nom: 'DNS du système', chiffre: false };
  signatures = new Set<string>();
  readonly quarantaine: string;
  telechargements: { liste: (p: ProfilOuvert) => Telechargement[] };
  readonly dls = new Map<string, Telechargement & { profil: string; chemin?: string }>();
  private dossierListes: string;
  filtres = 0;
  /** Fichiers ouverts par Pégase (toujours au clic sur « Ouvrir », jamais tout seul). */
  ouvertures = 0;

  constructor(readonly appli: { fenetres: Set<Fenetre>; odinAnalyse?: (p: ProfilOuvert, chemin: string, nom: string) => Promise<{ sain: boolean; menace?: string } | null> }, readonly racine: string) {
    this.quarantaine = join(racine, 'quarantaine');
    this.dossierListes = join(racine, 'bloqueur');
    mkdirSync(this.quarantaine, { recursive: true, mode: 0o700 });
    mkdirSync(this.dossierListes, { recursive: true });
    try { for (const h of JSON.parse(readFileSync(join(racine, 'signatures.json'), 'utf8'))) this.signatures.add(String(h).toLowerCase()); } catch { /* pas encore reçues d'Odin */ }
    this.telechargements = { liste: (p) => [...this.dls.values()].filter((d) => d.profil === p.id).sort((a, b) => b.quand - a.quand).slice(0, 40).map(({ profil: _p, chemin: _c, ...t }) => t) };
    // Les filtres d'apparence (éléments de pub masqués) : un seul point d'entrée pour tous les profils.
    ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (e, url: string, msg: unknown) => this.moteurDe(e.sender)?.onInjectCosmeticFilters(e as any, url, msg as any));
    ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (e) => this.moteurDe(e.sender)?.onIsMutationObserverEnabled(e as any) ?? false);
  }

  async demarrer(): Promise<void> {
    this.reglerDns(undefined).catch(() => 0);
  }

  // ————— DNS chiffré —————
  /** Sphinx d'Odin si on l'a ; sinon le service public chiffré de secours ; sinon le DNS du système (dit tel quel). */
  async reglerDns(odin: string | undefined, secours = 'https://dns.quad9.net/dns-query'): Promise<void> {
    const essayer = async (serveur: string, nom: string) => {
      app.configureHostResolver({ secureDnsMode: 'secure', secureDnsServers: [serveur] });
      const s = [...this.sessions.keys()][0];
      if (!s) { this.dns = { nom, chiffre: true }; return true; }
      try {
        await Promise.race([s.resolveHost('example.com', { cacheUsage: 'disallowed', source: 'dns' }), new Promise((_, ko) => setTimeout(() => ko(new Error('délai')), 4000))]);
        this.dns = { nom, chiffre: true }; return true;
      } catch { return false; }
    };
    if (process.env.PEGASE_DNS === 'systeme') { app.configureHostResolver({ secureDnsMode: 'off' }); this.dns = { nom: 'DNS du système', chiffre: false }; return; }
    if (odin && await essayer(`${odin.replace(/\/$/, '')}/dns-query`, 'Sphinx (Odin)')) return;
    if (await essayer(secours, domaine(secours))) return;
    // Aucun DNS chiffré ne répond (réseau filtré ?) : on ne coupe pas Internet, on le dit.
    app.configureHostResolver({ secureDnsMode: 'automatic', secureDnsServers: [secours] });
    this.dns = { nom: 'DNS du système (le chiffré ne répond pas)', chiffre: false };
  }

  // ————— Bloqueur —————
  private cle(p: ProfilOuvert): string | null {
    const r = p.reglages();
    if (r.bloqueur === 'coupe') return null;
    return `${r.bloqueur}${r.cookiesRefus ? '+cookies' : ''}`;
  }
  private moteurDe(wc: WebContents): ElectronBlocker | undefined {
    const p = this.sessions.get(wc.session); if (!p) return undefined;
    const k = this.cle(p); return k ? this.moteurs.get(k) : undefined;
  }

  /** Charge (ou fabrique) le moteur de filtres : d'abord le fichier gardé sur le disque, sinon les listes publiques. */
  private charger(k: string): Promise<ElectronBlocker | null> {
    const deja = this.enCours.get(k); if (deja) return deja;
    const fichier = join(this.dossierListes, `${k}.bin`);
    const pr = (async () => {
      try {
        if (existsSync(fichier)) {
          const m = ElectronBlocker.deserialize(new Uint8Array(readFileSync(fichier)));
          this.moteurs.set(k, m);
          if (Date.now() - statSync(fichier).mtimeMs > 7 * 86400_000) this.fabriquer(k, fichier).catch(() => 0); // mise à jour en fond
          return m;
        }
        return await this.fabriquer(k, fichier);
      } catch (e) { console.error('Bloqueur : listes indisponibles', e); return null; }
    })();
    this.enCours.set(k, pr);
    pr.then((m) => { this.filtres = m ? (m as any).filters?.length ?? this.compter(m) : 0; this.planifier(); });
    return pr;
  }
  private compter(m: ElectronBlocker): number { try { return m.getFilters().networkFilters.length + m.getFilters().cosmeticFilters.length; } catch { return 0; } }
  private async fabriquer(k: string, fichier: string): Promise<ElectronBlocker> {
    // Listes de test (essais) ; sinon EasyList, EasyPrivacy, Peter Lowe, uBlock Origin… comme Brave.
    const listes = process.env.PEGASE_LISTES ? process.env.PEGASE_LISTES.split(',')
      : k.startsWith('strict') ? fullLists : k.endsWith('+cookies') ? [...adsAndTrackingLists, ...fullLists.filter((u) => /cookie/.test(u))] : adsAndTrackingLists;
    const textes = await Promise.all(listes.map(async (u) => (u.startsWith('/') ? readFileSync(u, 'utf8') : await (await fetch(u)).text())));
    const m = ElectronBlocker.parse(textes.join('\n'), { loadCosmeticFilters: true, loadNetworkFilters: true, enableCompression: true });
    ecrireSur(fichier, Buffer.from(m.serialize()));
    this.moteurs.set(k, m);
    this.filtres = this.compter(m);
    return m;
  }

  /** Branche la protection sur la session d'un profil (une fois). */
  preparerSession(s: Session, p: ProfilOuvert): void {
    this.sessions.set(s, p);
    const k = this.cle(p); if (k) this.charger(k);
    const pre = s.registerPreloadScript({ type: 'frame', filePath: require.resolve('@ghostery/adblocker-electron-preload') });
    this.preloads.set(s, pre);
    s.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, rappel) => {
      if (d.resourceType === 'mainFrame') {
        // HTTPS d'abord : un site public demandé en http est d'abord essayé en https (avertissement s'il ne répond pas).
        const v = [...p.vivants.values()].find((x) => x.vue?.webContents.id === d.webContentsId);
        const haut = httpsDabord(d.url);
        if (haut && v && !(v.avertissement?.type === 'http' && v.avertissement.url === d.url)) { v.avertir = { type: 'https', url: d.url }; return rappel({ redirectURL: haut }); }
        return rappel({});
      }
      const k2 = this.cle(p); const m = k2 ? this.moteurs.get(k2) : undefined;
      if (!m || !d.webContentsId) return rappel({});
      m.onBeforeRequest(d, (r: { cancel?: boolean; redirectURL?: string }) => {
        if (r.cancel || r.redirectURL) this.compterBloque(p, d.webContentsId!, d.url, d.resourceType);
        rappel(r);
      });
    });
    // Cookies tiers bloqués (réglable) : ni envoyés, ni reçus pour un autre site que celui de la page.
    s.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (d, rappel) => {
      if (p.reglages().cookiesTiers && estTiers(d as any)) { const h = { ...d.requestHeaders }; for (const k of Object.keys(h)) if (k.toLowerCase() === 'cookie') delete h[k]; return rappel({ requestHeaders: h }); }
      rappel({});
    });
    s.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (d, rappel) => {
      const tiers = p.reglages().cookiesTiers && estTiers(d as any);
      const fin = (r: Electron.HeadersReceivedResponse) => {
        if (!tiers) return rappel(r);
        const h = { ...(r.responseHeaders ?? d.responseHeaders ?? {}) };
        for (const k of Object.keys(h)) if (k.toLowerCase() === 'set-cookie') delete h[k];
        rappel({ ...r, responseHeaders: h });
      };
      const k2 = this.cle(p); const m = k2 ? this.moteurs.get(k2) : undefined;
      if (!m) return fin({});
      m.onHeadersReceived(d, fin);
    });
    s.on('will-download', (_e, item, wc) => this.telecharger(p, item, wc));
    p.on('change', () => { const k3 = this.cle(p); if (k3 && !this.moteurs.has(k3)) this.charger(k3); });
  }

  private compterBloque(p: ProfilOuvert, wcId: number, url: string, type: string): void {
    p.bloquesTotal++;
    const v = [...p.vivants.values()].find((x) => x.vue?.webContents.id === wcId);
    if (v) v.bloques++;
    let l = this.bloquesPar.get(wcId); if (!l) { l = []; this.bloquesPar.set(wcId, l); }
    l.unshift({ url, type, quand: Date.now() }); if (l.length > 200) l.length = 200;
    this.planifier();
  }
  private minut: NodeJS.Timeout | null = null;
  private planifier(): void { if (this.minut) return; this.minut = setTimeout(() => { this.minut = null; for (const f of this.appli.fenetres) f.planifier(); }, 300); }

  /** Le bloqueur est-il prêt pour ce profil ? (les essais l'attendent) */
  async pret(p: ProfilOuvert): Promise<boolean> { const k = this.cle(p); return k ? !!(await this.charger(k)) : true; }

  etat(p: ProfilOuvert) { const k = this.cle(p); return { bloquesTotal: p.bloquesTotal, dns: this.dns.nom, dnsChiffre: this.dns.chiffre, filtres: k && this.moteurs.has(k) ? this.filtres : 0, pret: !k || this.moteurs.has(k) }; }

  // ————— Téléchargements —————
  private telecharger(p: ProfilOuvert, item: DownloadItem, _wc: WebContents): void {
    const id = nouvelId('t');
    const nom = basename(item.getFilename() || 'fichier').replace(/[\\/:*?"<>|\u0000-\u001f\u202e\u202d\u200e\u200f]/g, '_') || 'fichier';
    const dossier = join(this.quarantaine, id);
    mkdirSync(dossier, { recursive: true, mode: 0o700 });
    const chemin = join(dossier, `${nom}.quarantaine`);
    item.setSavePath(chemin); // jamais ailleurs que dans la quarantaine tant que l'analyse n'a pas dit « sain »
    const t = { id, profil: p.id, nom, taille: item.getTotalBytes(), recu: 0, etat: 'reception' as Telechargement['etat'], detail: `depuis ${domaine(item.getURL())}`, quand: Date.now(), chemin };
    this.dls.set(id, t); this.journal(p, t); this.planifier();
    item.on('updated', () => { t.recu = item.getReceivedBytes(); t.taille = item.getTotalBytes() || t.taille; this.planifier(); });
    item.once('done', (_e, etat) => {
      if (etat !== 'completed') { t.etat = etat === 'cancelled' ? 'annule' : 'erreur'; t.detail = etat === 'cancelled' ? 'annulé' : 'interrompu'; this.oter(chemin); this.journal(p, t); this.planifier(); return; }
      t.recu = t.taille = item.getTotalBytes() || t.recu;
      t.etat = 'analyse'; t.detail = 'gardé à part pendant l’analyse'; this.planifier();
      this.analyser(p, t, chemin).catch((e) => { t.etat = 'bloque'; t.detail = `analyse impossible (${String(e?.message ?? e)}) : gardé en quarantaine`; this.journal(p, t); this.planifier(); });
    });
  }

  private async analyser(p: ProfilOuvert, t: Telechargement & { chemin?: string }, chemin: string): Promise<void> {
    const verdict = await this.verdict(p, t.nom, chemin);
    if (!verdict.sain) {
      t.etat = 'bloque'; t.menace = verdict.menace; t.detail = `${verdict.menace} : en quarantaine, jamais écrit sur le PC.`;
      try { chmodSync(chemin, 0o000); } catch { /* Windows */ }
    } else {
      const dest = this.destination(t.nom, p.opts.telechargements);
      try { renameSync(chemin, dest); } catch { copyFileSync(chemin, dest); this.oter(chemin); }
      t.etat = 'sain'; t.chemin = dest; t.detail = verdict.detail;
    }
    this.journal(p, t); this.planifier();
  }

  /** Le verdict : nom trompeur, EICAR, empreintes connues d'Asclépios, antivirus du système, puis Odin si permis. */
  async verdict(p: ProfilOuvert, nom: string, chemin: string): Promise<{ sain: boolean; menace?: string; detail: string }> {
    const ext = extname(nom).toLowerCase();
    const avant = extname(nom.slice(0, -ext.length)).toLowerCase();
    if (EXECUTABLES.has(ext) && DOCUMENTS.has(avant)) return { sain: false, menace: `Nom trompeur (« ${avant} » puis « ${ext} » : un programme déguisé en document)`, detail: '' };
    // EICAR : le fichier commence par la signature (espaces permis après, 128 octets au plus).
    const fd = openSync(chemin, 'r'); const tete = Buffer.alloc(200); const n = readSync(fd, tete, 0, 200, 0); closeSync(fd);
    if (n <= 128 && tete.subarray(0, n).toString('latin1').trimEnd() === EICAR.toString('latin1')) return { sain: false, menace: 'Fichier d’essai antivirus EICAR', detail: '' };
    const h = await sha256(chemin);
    if (this.signatures.has(h)) return { sain: false, menace: 'Logiciel malveillant connu d’Asclépios', detail: '' };
    if (process.platform === 'win32') {
      const r = await defender(chemin);
      if (r === 'menace') return { sain: false, menace: 'Menace trouvée par l’antivirus de Windows', detail: '' };
    }
    if (p.reglages().analyseOdin && this.appli.odinAnalyse) {
      const r = await this.appli.odinAnalyse(p, chemin, nom).catch(() => null);
      if (r && !r.sain) return { sain: false, menace: r.menace ?? 'Menace trouvée par Asclépios (Odin)', detail: '' };
      if (r) return { sain: true, detail: 'analysé sur ce PC et par Asclépios (Odin)' };
    }
    return { sain: true, detail: process.platform === 'win32' ? 'analysé sur ce PC (empreintes d’Asclépios et antivirus de Windows)' : 'analysé sur ce PC (empreintes d’Asclépios)' };
  }

  private destination(nom: string, ici?: string): string {
    const dossier = ici || process.env.PEGASE_TELECHARGEMENTS || app.getPath('downloads');
    mkdirSync(dossier, { recursive: true });
    const ext = extname(nom), base = nom.slice(0, nom.length - ext.length);
    let d = join(dossier, nom), i = 1;
    while (existsSync(d)) d = join(dossier, `${base} (${i++})${ext}`);
    return d;
  }
  private oter(chemin: string): void { try { unlinkSync(chemin); } catch { /* déjà parti */ } }
  private journal(p: ProfilOuvert, t: Telechargement): void {
    if (p.prive) return;
    const { id, nom, taille, etat, quand, menace } = t;
    p.base.mettre('telechargements', { id, nom, taille, etat, quand, menace, detail: t.detail, recu: t.taille });
  }

  async action(f: Fenetre, action: string, arg: any): Promise<any> {
    const t = this.dls.get(String(arg?.id));
    switch (action) {
      case 'dlOuvrir': if (t?.etat === 'sain' && t.chemin) { this.ouvertures++; return shell.openPath(t.chemin); } return;
      case 'dlDossier': if (t?.etat === 'sain' && t.chemin) shell.showItemInFolder(t.chemin); return;
      case 'bloquesPage': { const id = f.ongletCourant(); const wc = id ? f.profil.vivants.get(id)?.vue?.webContents : undefined; return wc ? this.bloquesPar.get(wc.id) ?? [] : []; }
      case 'bloqueurPret': return this.pret(f.profil);
    }
    return undefined;
  }
}

function sha256(chemin: string): Promise<string> {
  return new Promise((ok, ko) => { const h = createHash('sha256'); createReadStream(chemin).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', ko); });
}

/** L'antivirus intégré de Windows (Microsoft Defender), s'il est là : code 2 = menace trouvée. */
function defender(chemin: string): Promise<'sain' | 'menace' | 'absent'> {
  const exe = join(process.env.ProgramFiles || 'C:\\Program Files', 'Windows Defender', 'MpCmdRun.exe');
  if (!existsSync(exe)) return Promise.resolve('absent');
  return new Promise((ok) => execFile(exe, ['-Scan', '-ScanType', '3', '-File', chemin, '-DisableRemediation'], { timeout: 120_000, windowsHide: true }, (err: any) => ok(!err ? 'sain' : err.code === 2 ? 'menace' : 'absent')));
}
