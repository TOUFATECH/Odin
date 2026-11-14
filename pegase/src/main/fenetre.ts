// Une fenêtre de Pégase : une vue d'interface (barre de côté, barre du haut, menus, pages pegase://)
// et, posées par-dessus, les vues des pages web (une par onglet affiché ; jusqu'à 4 en écran partagé,
// plus jusqu'à 4 vignettes de vidéos qui suivent).
import { BaseWindow, WebContentsView, ipcMain, clipboard, nativeTheme, screen, type WebContents } from 'electron';
import { join } from 'node:path';
import type { Bureau, Etat, Theme, Zone, Video, Ecran } from '../commun/types';
import { THEMES } from '../commun/types';
import { ProfilOuvert, type OngletRange, type DossierRange } from './profil';
import { nouvelId, versAdresse, domaine, adresseRecherche } from './outils';

export interface Appli {
  nouvelleFenetre(prive: boolean): void;
  changerTheme(f: Fenetre, t: Theme): void;
  etatGlobal(f: Fenetre): Partial<Etat>;
  action(f: Fenetre, action: string, arg: any): Promise<any> | any | undefined;
  fenetreFermee(f: Fenetre): void;
}

const fenetres = new Map<number, Fenetre>(); // id du webContents de l'interface → fenêtre

ipcMain.handle('pegase:etat', (e) => fenetres.get(e.sender.id)?.etat());
ipcMain.handle('pegase:faire', (e, action: string, arg: unknown) => fenetres.get(e.sender.id)?.faire(action, arg));
ipcMain.on('pegase:zones', (e, z: Zone[], couche: boolean) => fenetres.get(e.sender.id)?.poser(Array.isArray(z) ? z : [], couche));

const FOND: Record<Theme, string> = { noir: '#121318', blanc: '#F2F4F8', bleu: '#33377F', rouge: '#8E1A30', transparent: '#00000000', glace: '#DDE6F5' };
const RACCOURCIS = new Set(['C+t', 'C+n', 'CS+n', 'C+w', 'C+l', 'C+d', 'C+f', 'C+r', 'F5', 'CS+t', 'C+Tab', 'CS+Tab', 'A+ArrowLeft', 'A+ArrowRight', 'C+s', 'C+p',
  'CS+i', 'F12', 'C+=', 'C++', 'C+-', 'C+0', 'C+,', 'CS+c', 'CS+d', 'C+1', 'C+2', 'C+3', 'C+4', 'C+5', 'C+6', 'C+7', 'C+8', 'C+9', 'C+y', 'C+j', 'CS+o', 'F11']);

/** Le nom d'une combinaison de touches (« C+t », « CS+Tab »…), pareil pour l'interface et les pages. */
export function combo(i: { control?: boolean; meta?: boolean; shift?: boolean; alt?: boolean; key: string }): string {
  const c = i.control || i.meta;
  const p = `${c ? 'C' : ''}${i.shift && (c || i.key.length > 1) ? 'S' : ''}${i.alt ? 'A' : ''}`;
  const k = i.key.length === 1 ? i.key.toLowerCase() : i.key;
  return p ? `${p}+${k}` : k;
}

export class Fenetre {
  win!: BaseWindow;
  ui!: WebContentsView;
  espaceActif: string;
  actifs = new Map<string, { type: 'onglet' | 'bureau'; id: string }>(); // par espace
  barreReduite = false;
  panneauOdin = false;
  videos: string[] = [];
  ecran: Ecran = 'demarrage';
  private montrees = new Map<string, WebContentsView>();
  private css = new Map<string, string>(); // onglet → clé du CSS « vidéo qui suit »
  private couche = false;
  private pleinEcran: string | null = null;
  private planifie: NodeJS.Timeout | null = null;
  private pret = false;
  private theme: Theme;
  private dernieresZones: Zone[] = [];

  constructor(readonly profil: ProfilOuvert, readonly appli: Appli, private bornes?: Electron.Rectangle) {
    this.espaceActif = profil.espaces()[0]?.id ?? '';
    this.theme = profil.reglages().theme;
    this.creer();
    const change = () => this.planifier();
    const video = (id: string) => this.surVideo(id);
    const ouvrir = (o: any) => this.surOuvrir(o);
    const retirer = (vue: WebContentsView) => { for (const [id, v] of this.montrees) if (v === vue) { try { this.win.contentView.removeChildView(vue); } catch { /* */ } this.montrees.delete(id); } };
    const pip = (id: string) => this.pip(id);
    const chercher = (o: any) => this.surOuvrir({ url: adresseRecherche(o.q, this.profil.reglages().moteur, this.appli.etatGlobal(this).odin?.url), espace: o.espace, depuis: o.depuis });
    const demander = (o: any) => { this.panneauOdin = true; this.envoyer('odin', o); this.planifier(); };
    profil.on('change', change); profil.on('video', video); profil.on('ouvrir', ouvrir); profil.on('retirer-vue', retirer); profil.on('pip', pip); profil.on('chercher', chercher); profil.on('demander-odin', demander);
    this.win.on('closed', () => {
      profil.off('change', change); profil.off('video', video); profil.off('ouvrir', ouvrir); profil.off('retirer-vue', retirer); profil.off('pip', pip); profil.off('chercher', chercher); profil.off('demander-odin', demander);
    });
  }

  private creer(): void {
    const mac = process.platform === 'darwin', win = process.platform === 'win32';
    const t = this.theme;
    const ecranPrincipal = screen.getPrimaryDisplay().workAreaSize;
    const b = this.bornes ?? { width: Math.min(1440, ecranPrincipal.width), height: Math.min(900, ecranPrincipal.height) } as Electron.Rectangle;
    this.win = new BaseWindow({
      ...b, minWidth: 640, minHeight: 420, show: false, title: this.profil.prive ? 'Pégase · fenêtre privée' : 'Pégase',
      frame: mac, titleBarStyle: mac ? 'hiddenInset' : undefined, trafficLightPosition: mac ? { x: 14, y: 16 } : undefined,
      transparent: t === 'transparent', backgroundColor: FOND[t],
      ...(win && t === 'glace' ? { backgroundMaterial: 'acrylic' as const } : {}),
      ...(mac && (t === 'glace' || t === 'transparent') ? { vibrancy: 'under-window' as const, visualEffectState: 'active' as const } : {}),
      icon: join(__dirname, '..', '..', 'build', 'icone.png'),
    });
    this.ui = new WebContentsView({ webPreferences: { preload: join(__dirname, '..', 'preload', 'ui.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'pegase-ui', spellcheck: false } });
    this.ui.setBackgroundColor('#00000000');
    this.win.contentView.addChildView(this.ui);
    fenetres.set(this.ui.webContents.id, this);
    const wcId = this.ui.webContents.id;
    this.ui.webContents.on('will-navigate', (e) => e.preventDefault());
    this.ui.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) this.surOuvrir({ url, espace: this.espaceActif }); return { action: 'deny' }; });
    this.ui.webContents.on('before-input-event', (e, i) => { if (i.type === 'keyDown' && (i.key === 'F12' || combo(i) === 'CS+i') && process.env.PEGASE_DEV) { this.ui.webContents.openDevTools({ mode: 'detach' }); e.preventDefault(); } });
    this.ui.webContents.on('did-finish-load', () => { this.pret = true; this.envoyerEtat(); if (!this.win.isVisible()) this.win.show(); });
    this.ui.webContents.on('render-process-gone', () => { this.pret = false; setTimeout(() => !this.win.isDestroyed() && this.ui.webContents.reload(), 300); });
    this.ui.webContents.loadURL('pegase://app/index.html');
    const caler = () => { const [w, h] = this.win.getContentSize(); this.ui.setBounds({ x: 0, y: 0, width: w, height: h }); };
    caler();
    this.win.on('resize', caler);
    this.win.on('maximize', () => this.planifier()); this.win.on('unmaximize', () => this.planifier());
    this.win.on('focus', () => this.ui.webContents.focus());
    this.win.on('closed', () => {
      fenetres.delete(wcId);
      for (const [id, vue] of this.montrees) { this.montrees.delete(id); const v = this.profil.vivants.get(id); if (v && v.fenetre === this) v.fenetre = null; void vue; }
      if (!this.recreation) { try { this.ui.webContents.close(); } catch { /* */ } this.appli.fenetreFermee(this); }
    });
    this.profil.surVue = (v, wc) => this.brancherPage(v.id, wc);
  }

  private recreation = false;
  /** Le thème transparent a besoin d'une fenêtre transparente dès sa création : on refait la fenêtre, les pages restent. */
  changerTheme(t: Theme): void {
    if (!THEMES.includes(t)) return;
    const avant = this.theme; this.theme = t;
    const refaire = (avant === 'transparent') !== (t === 'transparent') || ((avant === 'glace') !== (t === 'glace') && process.platform !== 'linux');
    if (!refaire) { if (t !== 'transparent') this.win.setBackgroundColor(FOND[t]); this.planifier(); return; }
    const ancien = this.win, ancienneUi = this.ui, bornes = ancien.getBounds(), max = ancien.isMaximized();
    for (const [, vue] of this.montrees) { try { ancien.contentView.removeChildView(vue); } catch { /* */ } }
    this.montrees.clear();
    this.recreation = true; this.bornes = bornes; this.pret = false;
    this.creer();
    if (max) this.win.maximize();
    this.recreation = false;
    ancien.close();
    try { ancienneUi.webContents.close(); } catch { /* */ }
  }

  private brancherPage(id: string, wc: WebContents): void {
    wc.on('before-input-event', (e, i) => {
      if (i.type !== 'keyDown') return;
      const c = combo(i);
      if (RACCOURCIS.has(c)) { e.preventDefault(); this.envoyer('touche', c); }
    });
    wc.on('enter-html-full-screen', () => { this.pleinEcran = id; this.win.setFullScreen?.(true); this.poser(this.dernieresZones, this.couche); });
    wc.on('leave-html-full-screen', () => { this.pleinEcran = null; this.win.setFullScreen?.(false); this.poser(this.dernieresZones, this.couche); });
    wc.on('found-in-page', (_e, r) => this.envoyer('trouve', { actif: r.activeMatchOrdinal, total: r.matches }));
  }

  envoyer(commande: string, arg?: unknown): void { if (this.pret && !this.ui.webContents.isDestroyed()) this.ui.webContents.send('pegase:commande', commande, arg); }
  planifier(): void { if (this.planifie) return; this.planifie = setTimeout(() => { this.planifie = null; this.envoyerEtat(); }, 25); }
  private envoyerEtat(): void { if (this.pret && !this.win.isDestroyed()) this.ui.webContents.send('pegase:etat', this.etat()); }

  // ————— Ce que l'interface affiche —————
  actif(): { type: 'onglet' | 'bureau'; id: string } | null {
    const a = this.actifs.get(this.espaceActif);
    if (a && (a.type === 'onglet' ? this.profil.onglet(a.id) : this.profil.bureaux().some((b) => b.id === a.id))) return a;
    const premier = this.profil.tousVus().filter((o) => o.espace === this.espaceActif && !o.epingle).sort((x, y) => x.ordre - y.ordre)[0];
    return premier ? { type: 'onglet', id: premier.id } : null;
  }

  /** L'onglet au premier plan (dans un bureau : le premier de ses pages, ou celui choisi). */
  ongletCourant(): string | null {
    const a = this.actif(); if (!a) return null;
    if (a.type === 'onglet') return a.id;
    const b = this.profil.bureaux().find((x) => x.id === a.id);
    return this.focusBureau && b?.onglets.includes(this.focusBureau) ? this.focusBureau : b?.onglets[0] ?? null;
  }
  focusBureau: string | null = null;

  etat(): Etat {
    const p = this.profil;
    if (!p.espaces().some((e) => e.id === this.espaceActif)) this.espaceActif = p.espaces()[0]?.id ?? '';
    const r = p.reglages();
    const favs = p.favoris();
    const videos: Video[] = this.videos.map((id) => this.etatVideos.get(id) ?? { onglet: id, titre: p.onglet(id)?.titre ?? '', lecture: true, temps: 0, duree: 0, muet: false });
    const g = this.appli.etatGlobal(this);
    return {
      ecran: this.ecran, plateforme: process.platform,
      profil: p.profil(), profils: [],
      espaces: p.espaces(), espaceActif: this.espaceActif,
      onglets: p.tousVus(), dossiers: p.dossiersVus(), bureaux: p.bureaux(),
      actif: this.actif(),
      tuiles: favs.filter((f) => f.tuile), favorisBarre: favs.filter((f) => !f.dossier).slice(0, 60), nbFavoris: favs.filter((f) => f.type === 'favori').length,
      ranges: p.ranges().slice(0, 60),
      videos,
      telechargements: [],
      reglages: { ...r, theme: this.theme },
      synchro: { etat: 'local', attente: 0 },
      protection: { bloquesTotal: p.bloquesTotal, dns: 'système', dnsChiffre: false, filtres: 0, pret: false },
      barreReduite: this.barreReduite, panneauOdin: this.panneauOdin, prive: p.prive, maximise: this.win.isMaximized(),
      ...g,
    } as Etat;
  }

  // ————— Les pages posées dans la fenêtre —————
  poser(zones: Zone[], couche: boolean): void {
    if (this.win.isDestroyed()) return;
    this.dernieresZones = zones; this.couche = couche;
    let z = zones;
    if (this.pleinEcran) { const [w, h] = this.win.getContentSize(); z = [{ id: this.pleinEcran, x: 0, y: 0, w, h }]; couche = false; }
    const voulues = new Set<string>();
    const cv = this.win.contentView;
    for (const zone of z) {
      if (!this.profil.onglet(zone.id)) continue;
      voulues.add(zone.id);
      const v = this.profil.reveiller(zone.id);
      const vue = v.vue!;
      if (v.fenetre && v.fenetre !== this) (v.fenetre as Fenetre).lacher(zone.id);
      v.fenetre = this; v.dernierVu = Date.now();
      if (this.montrees.get(zone.id) !== vue) { cv.addChildView(vue); this.montrees.set(zone.id, vue); (vue as any).__parent = cv; }
      vue.setBounds({ x: Math.round(zone.x), y: Math.round(zone.y), width: Math.max(1, Math.round(zone.w)), height: Math.max(1, Math.round(zone.h)) });
    }
    for (const [id, vue] of [...this.montrees]) if (!voulues.has(id)) { try { cv.removeChildView(vue); } catch { /* */ } this.montrees.delete(id); const v = this.profil.vivants.get(id); if (v?.fenetre === this) v.fenetre = null; }
    // Menus ouverts : l'interface passe par-dessus les pages (ses zones de page restent transparentes).
    if (couche) cv.addChildView(this.ui); else cv.addChildView(this.ui, 0);
  }
  lacher(id: string): void { const vue = this.montrees.get(id); if (vue) { try { this.win.contentView.removeChildView(vue); } catch { /* */ } this.montrees.delete(id); } }
  montre(id: string): boolean { return this.montrees.has(id); }

  // ————— Vidéos qui suivent —————
  private etatVideos = new Map<string, Video>();
  private minuterieVideo: NodeJS.Timeout | null = null;

  /** Avant de changer de page : une vidéo qui joue dans une page qu'on quitte se met à suivre. */
  private avantChangement(prochains: string[]): void {
    if (!this.profil.reglages().videoAuto) return;
    for (const id of this.montrees.keys()) {
      if (prochains.includes(id) || this.videos.includes(id)) continue;
      const v = this.profil.vivants.get(id);
      if (v?.vue && v.lecture && v.video) this.suivre(id);
    }
    for (const id of prochains) if (this.videos.includes(id)) this.lacherVideo(id, false);
  }
  suivre(id: string): void {
    const v = this.profil.vivants.get(id); if (!v?.vue) return;
    if (this.videos.length >= 4) this.lacherVideo(this.videos[0], true);
    this.videos.push(id);
    const wc = v.vue.webContents;
    wc.executeJavaScript(`(()=>{const l=[...document.querySelectorAll('video')].sort((a,b)=>(b.clientWidth*b.clientHeight)-(a.clientWidth*a.clientHeight));const v=l.find(x=>!x.paused)||l[0];if(v)v.setAttribute('data-pegase-suit','');return !!v})()`, false).catch(() => 0);
    wc.insertCSS('[data-pegase-suit]{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;z-index:2147483647!important;background:#000!important;object-fit:contain!important;transform:none!important}html,body{overflow:hidden!important}', { cssOrigin: 'user' })
      .then((k) => this.css.set(id, k)).catch(() => 0);
    this.lancerSuiviVideo();
    this.planifier();
  }
  lacherVideo(id: string, pause: boolean): void {
    this.videos = this.videos.filter((x) => x !== id);
    this.etatVideos.delete(id);
    const wc = this.profil.vivants.get(id)?.vue?.webContents;
    const k = this.css.get(id); this.css.delete(id);
    if (wc) {
      if (k) wc.removeInsertedCSS(k).catch(() => 0);
      wc.executeJavaScript(`(()=>{const v=document.querySelector('[data-pegase-suit]');if(v){v.removeAttribute('data-pegase-suit');${pause ? 'v.pause();' : ''}}})()`, false).catch(() => 0);
    }
    this.planifier();
  }
  private lancerSuiviVideo(): void {
    if (this.minuterieVideo) return;
    this.minuterieVideo = setInterval(() => {
      if (!this.videos.length || this.win.isDestroyed()) { if (this.minuterieVideo) clearInterval(this.minuterieVideo); this.minuterieVideo = null; return; }
      for (const id of this.videos) {
        const wc = this.profil.vivants.get(id)?.vue?.webContents; if (!wc) { this.lacherVideo(id, false); continue; }
        wc.executeJavaScript(`(()=>{const v=document.querySelector('[data-pegase-suit]')||document.querySelector('video');return v?{l:!v.paused,t:v.currentTime,d:v.duration||0,m:v.muted}:null})()`, false)
          .then((r: any) => { if (r) { this.etatVideos.set(id, { onglet: id, titre: this.profil.onglet(id)?.titre ?? '', lecture: r.l, temps: r.t, duree: Number.isFinite(r.d) ? r.d : 0, muet: r.m || wc.isAudioMuted() }); this.planifier(); } })
          .catch(() => 0);
      }
    }, 1000);
  }
  private surVideo(_id: string): void { this.planifier(); }
  videoFaire(id: string, op: string): void {
    const wc = this.profil.vivants.get(id)?.vue?.webContents; if (!wc) return;
    const js: Record<string, string> = {
      basculer: 'v.paused?v.play():v.pause()', reculer: 'v.currentTime=Math.max(0,v.currentTime-10)', avancer: 'v.currentTime=v.currentTime+10',
      muet: 'v.muted=!v.muted',
    };
    if (!js[op]) return;
    wc.executeJavaScript(`(()=>{const v=document.querySelector('[data-pegase-suit]')||document.querySelector('video');if(v){${js[op]}}})()`, true).catch(() => 0);
  }
  pip(id: string): void {
    const wc = this.profil.vivants.get(id)?.vue?.webContents; if (!wc) return;
    wc.executeJavaScript(`(()=>{const l=[...document.querySelectorAll('video')];const v=l.find(x=>!x.paused)||l[0];if(!v)return false;(document.pictureInPictureElement?document.exitPictureInPicture():v.requestPictureInPicture()).catch(()=>0);return true})()`, true).catch(() => 0);
  }

  // ————— Ouvrir, activer, fermer —————
  private surOuvrir(o: { url: string; espace?: string; depuis?: string; arrierePlan?: boolean; partage?: boolean }): void {
    const espace = o.espace && this.profil.espaces().some((e) => e.id === o.espace) ? o.espace : this.espaceActif;
    const n = this.profil.creerOnglet(o.url, espace, { apres: undefined });
    if (o.partage && o.depuis) { this.partager(o.depuis, n.id); return; }
    if (!o.arrierePlan) this.activer(n.id);
    else this.profil.reveiller(n.id);
    this.planifier();
  }

  activer(id: string): void {
    const o = this.profil.onglet(id); if (!o) return;
    if (o.espace !== this.espaceActif) this.espaceActif = o.espace;
    // Un onglet qui fait partie d'un bureau : on montre le bureau, avec cette page au premier plan.
    const b = this.profil.bureaux().find((x) => x.onglets.includes(id));
    const prochains = b ? b.onglets : [id];
    this.avantChangement(prochains);
    if (b) { this.actifs.set(this.espaceActif, { type: 'bureau', id: b.id }); this.focusBureau = id; }
    else this.actifs.set(this.espaceActif, { type: 'onglet', id });
    if (!o.epingle || true) this.profil.mettreOnglet({ ...o, vu: Date.now() });
    this.planifier();
  }
  activerBureau(id: string): void {
    const b = this.profil.bureaux().find((x) => x.id === id); if (!b) return;
    this.avantChangement(b.onglets);
    this.espaceActif = b.espace; this.actifs.set(b.espace, { type: 'bureau', id }); this.focusBureau = b.onglets[0];
    this.planifier();
  }
  activerEspace(id: string): void {
    if (!this.profil.espaces().some((e) => e.id === id)) return;
    const a = this.actifs.get(id);
    const prochains = a ? (a.type === 'onglet' ? [a.id] : this.profil.bureaux().find((b) => b.id === a.id)?.onglets ?? []) : [];
    this.avantChangement(prochains);
    this.espaceActif = id;
    const t = this.profil.espaces().find((e) => e.id === id)?.theme;
    if (t && t !== this.theme) this.appli.changerTheme(this, t);
    this.planifier();
  }

  fermerOnglet(id: string): void {
    const ordre = this.listeVisible();
    const i = ordre.indexOf(id);
    const etaitActif = this.ongletCourant() === id;
    if (this.videos.includes(id)) this.lacherVideo(id, false);
    this.lacher(id);
    this.profil.fermerOnglet(id);
    if (etaitActif) {
      const reste = ordre.filter((x) => x !== id);
      const suivant = reste[Math.min(i, reste.length - 1)];
      if (suivant) this.activer(suivant); else this.actifs.delete(this.espaceActif);
    }
    this.planifier();
  }

  /** Les onglets de l'espace dans l'ordre de la barre de côté (épinglés, puis ceux du jour). */
  listeVisible(): string[] {
    const l = this.profil.tousVus().filter((o) => o.espace === this.espaceActif);
    return [...l.filter((o) => o.epingle).sort((a, b) => a.ordre - b.ordre), ...l.filter((o) => !o.epingle).sort((a, b) => a.ordre - b.ordre)].map((o) => o.id);
  }

  // ————— Écran partagé —————
  partager(a: string, b: string): void {
    const oa = this.profil.onglet(a), ob = this.profil.onglet(b); if (!oa || !ob) return;
    const bureaux = this.profil.bureaux();
    const ba = bureaux.find((x) => x.onglets.includes(a));
    for (const x of bureaux) if (x.onglets.includes(b) && x !== ba) this.retirerDuBureau(x.id, b);
    let bureau: Bureau;
    if (ba) {
      if (ba.onglets.includes(b)) return this.activerBureau(ba.id);
      if (ba.onglets.length >= 4) return void this.envoyer('message', 'Un écran partagé montre 4 pages au plus.');
      bureau = { ...ba, onglets: [...ba.onglets, b], disposition: ba.onglets.length + 1 >= 3 ? 'grille' : ba.disposition };
    } else bureau = { id: nouvelId('b'), espace: oa.espace, onglets: [a, b], disposition: 'ligne', ordre: oa.ordre };
    if (ob.espace !== oa.espace) this.profil.mettreOnglet({ ...ob, espace: oa.espace });
    this.profil.mettre('bureaux', bureau);
    this.activerBureau(bureau.id);
  }
  retirerDuBureau(bureau: string, onglet: string): void {
    const b = this.profil.bureaux().find((x) => x.id === bureau); if (!b) return;
    const reste = b.onglets.filter((x) => x !== onglet);
    if (reste.length < 2) { this.profil.suppr('bureaux', b.id); if (this.actif()?.id === b.id) this.actifs.set(this.espaceActif, { type: 'onglet', id: reste[0] ?? onglet }); }
    else this.profil.mettre('bureaux', { ...b, onglets: reste, disposition: reste.length === 2 && b.disposition === 'grille' ? 'ligne' : b.disposition });
    this.planifier();
  }

  // ————— Les actions venues de l'interface —————
  async faire(action: string, arg: any): Promise<any> {
    const p = this.profil;
    const courant = () => this.ongletCourant();
    const wcDe = (id?: string) => { const i = id ?? courant(); return i ? p.vivants.get(i)?.vue?.webContents : undefined; };
    const odin = this.appli.etatGlobal(this).odin?.url;
    switch (action) {
      case 'naviguer': {
        const url = versAdresse(String(arg?.texte ?? ''), p.reglages().moteur, odin); if (!url) return;
        if (arg?.nouvel || !courant()) { this.surOuvrir({ url, espace: this.espaceActif }); return; }
        const id = courant()!; const o = p.onglet(id)!;
        p.mettreOnglet({ ...o, url });
        const v = p.vivants.get(id);
        if (v?.vue) v.vue.webContents.loadURL(url).catch(() => 0); else p.reveiller(id);
        this.planifier(); return;
      }
      case 'ouvrir': return this.surOuvrir({ url: String(arg?.url), espace: arg?.espace, arrierePlan: !!arg?.arrierePlan });
      case 'interne': { // une page pegase:// (favoris, historique, réglages…) dans un onglet
        const url = `pegase://${String(arg?.page ?? 'accueil').replace(/[^a-z-]/g, '')}`;
        const deja = p.tousVus().find((o) => o.url === url && o.espace === this.espaceActif);
        if (deja) return this.activer(deja.id);
        return this.surOuvrir({ url, espace: this.espaceActif });
      }
      case 'activer': return this.activer(String(arg?.id));
      case 'activerBureau': return this.activerBureau(String(arg?.id));
      case 'focusBureau': this.focusBureau = String(arg?.id); this.planifier(); return;
      case 'espace': return this.activerEspace(String(arg?.id));
      case 'fermer': return this.fermerOnglet(String(arg?.id ?? courant()));
      case 'reculer': wcDe(arg?.id)?.navigationHistory.goBack(); return;
      case 'avancer': wcDe(arg?.id)?.navigationHistory.goForward(); return;
      case 'recharger': { const id = arg?.id ?? courant(); const v = id && p.vivants.get(id); if (v && v.vue && !v.plante) v.vue.webContents.reload(); else if (id) { p.endormir(id); p.reveiller(id); this.poser(this.dernieresZones, this.couche); } return; }
      case 'arreter': wcDe(arg?.id)?.stop(); return;
      case 'zoom': { const wc = wcDe(); if (!wc) return; const z = arg?.sens === 0 ? 0 : wc.getZoomLevel() + (arg?.sens > 0 ? 0.5 : -0.5); wc.setZoomLevel(Math.max(-5, Math.min(5, z))); return; }
      case 'trouver': { const wc = wcDe(); if (!wc) return; if (!arg?.texte) { wc.stopFindInPage('clearSelection'); return; } wc.findInPage(String(arg.texte), { forward: arg.sens !== -1, findNext: !!arg.suite }); return; }
      case 'imprimer': wcDe()?.print(); return;
      case 'outilsDev': wcDe()?.openDevTools({ mode: 'detach' }); return;
      case 'copierLien': { const id = arg?.id ?? courant(); const o = id && p.onglet(id); if (o) clipboard.writeText(o.url); return true; }
      case 'muet': { const wc = wcDe(arg?.id); if (wc) { wc.setAudioMuted(!wc.isAudioMuted()); this.planifier(); } return; }
      case 'dupliquer': { const o = p.onglet(String(arg?.id)); if (o) this.surOuvrir({ url: o.url, espace: o.espace }); return; }
      case 'renommer': { const o = p.onglet(String(arg?.id)); if (o && arg?.titre) { p.mettreOnglet({ ...o, titre: String(arg.titre).slice(0, 200) }); this.planifier(); } return; }
      case 'epingler': {
        const o = p.onglet(String(arg?.id)); if (!o) return;
        const oui = arg?.oui ?? !o.epingle;
        p.mettreOnglet({ ...o, epingle: !!oui, urlEpingle: oui ? o.url : undefined, dossier: oui ? o.dossier : undefined, ordre: Date.now() / 1e13 });
        this.planifier(); return;
      }
      case 'deplacer': { // glisser-déposer dans la barre de côté
        const o = p.onglet(String(arg?.id)); if (!o) return;
        const n: OngletRange = { ...o };
        if (arg.espace) n.espace = String(arg.espace);
        if ('epingle' in arg) n.epingle = !!arg.epingle;
        if ('dossier' in arg) n.dossier = arg.dossier || undefined;
        if (typeof arg.ordre === 'number') n.ordre = arg.ordre;
        if (n.epingle && !o.epingle) n.urlEpingle = n.url;
        p.mettreOnglet(n); this.planifier(); return;
      }
      case 'ranger': { // range les onglets du jour de l'espace
        const l = p.tousVus().filter((o) => o.espace === this.espaceActif && !o.epingle && !this.videos.includes(o.id));
        for (const o of l) this.fermerOnglet(o.id);
        return l.length;
      }
      case 'rouvrir': { const r = p.oterRange(String(arg?.id)); if (r) this.surOuvrir({ url: r.url, espace: p.espaces().some((e) => e.id === r.espace) ? r.espace : this.espaceActif }); return; }
      case 'rouvrirDernier': { const r = p.ranges()[0]; if (r) { p.oterRange(r.id); this.surOuvrir({ url: r.url, espace: this.espaceActif }); } return; }
      case 'rangesTous': return p.ranges();
      case 'nouvelEspace': {
        const l = p.espaces();
        const e = p.mettre('espaces', { id: nouvelId('e'), nom: String(arg?.nom || `Espace ${l.length + 1}`).slice(0, 40), couleur: Number(arg?.couleur ?? l.length % 8), ordre: (l.at(-1)?.ordre ?? 0) + 1 });
        this.activerEspace(e.id); return e.id;
      }
      case 'majEspace': { const e = p.espaces().find((x) => x.id === arg?.id); if (e) p.mettre('espaces', { ...e, ...(arg.nom ? { nom: String(arg.nom).slice(0, 40) } : {}), ...(typeof arg.couleur === 'number' ? { couleur: arg.couleur } : {}), ...(arg.theme !== undefined ? { theme: arg.theme || undefined } : {}) }); return; }
      case 'supprEspace': {
        const l = p.espaces(); if (l.length < 2) return void this.envoyer('message', 'Il faut garder au moins un espace.');
        const id = String(arg?.id); const vers = l.find((e) => e.id !== id)!.id;
        for (const o of p.ongletsRanges().filter((x) => x.espace === id)) p.mettreOnglet({ ...o, espace: vers });
        for (const d of p.dossiers().filter((x) => x.espace === id)) p.mettre('onglets', { ...d, espace: vers });
        p.suppr('espaces', id); if (this.espaceActif === id) this.activerEspace(vers); return;
      }
      case 'nouveauDossier': { const d: DossierRange = { id: nouvelId('d'), type: 'dossier', nom: String(arg?.nom || 'Nouveau dossier').slice(0, 60), espace: this.espaceActif, ouvert: true, ordre: Date.now() / 1e13 }; p.mettre('onglets', d); return d.id; }
      case 'majDossier': { const d = p.dossiers().find((x) => x.id === arg?.id); if (d) p.mettre('onglets', { ...d, ...(arg.nom ? { nom: String(arg.nom).slice(0, 60) } : {}), ...('ouvert' in arg ? { ouvert: !!arg.ouvert } : {}), ...(typeof arg.ordre === 'number' ? { ordre: arg.ordre } : {}) }); return; }
      case 'supprDossier': { const id = String(arg?.id); for (const o of p.ongletsRanges().filter((x) => x.dossier === id)) p.mettreOnglet({ ...o, dossier: undefined }); p.suppr('onglets', id); return; }
      case 'partager': return this.partager(String(arg?.a ?? courant()), String(arg?.b));
      case 'partagerNouveau': { const a = courant(); if (!a) return; const n = p.creerOnglet(String(arg?.url || 'pegase://accueil'), this.espaceActif); this.partager(a, n.id); return n.id; }
      case 'retirerBureau': return this.retirerDuBureau(String(arg?.bureau), String(arg?.onglet));
      case 'dispositionBureau': { const b = p.bureaux().find((x) => x.id === arg?.id); if (b && ['ligne', 'colonne', 'grille'].includes(arg?.disposition)) p.mettre('bureaux', { ...b, disposition: arg.disposition }); return; }
      case 'nommerBureau': { const b = p.bureaux().find((x) => x.id === arg?.id); if (b) p.mettre('bureaux', { ...b, nom: String(arg?.nom || '').slice(0, 40) || undefined }); return; }
      case 'defaireBureau': { const b = p.bureaux().find((x) => x.id === arg?.id); if (b) { p.suppr('bureaux', b.id); this.actifs.set(this.espaceActif, { type: 'onglet', id: this.focusBureau && b.onglets.includes(this.focusBureau) ? this.focusBureau : b.onglets[0] }); this.planifier(); } return; }
      case 'video': {
        if (arg?.op === 'retour') { this.activer(String(arg.onglet)); return; }
        if (arg?.op === 'fermer') { this.lacherVideo(String(arg.onglet), true); return; }
        if (arg?.op === 'pip') { this.pip(String(arg.onglet)); return; }
        if (arg?.op === 'suivre') { const id = String(arg.onglet); if (!this.videos.includes(id)) this.suivre(id); return; }
        return this.videoFaire(String(arg?.onglet), String(arg?.op));
      }
      case 'pip': return this.pip(String(arg?.id ?? courant()));
      case 'barre': this.barreReduite = arg?.reduite ?? !this.barreReduite; this.planifier(); return;
      case 'panneauOdin': this.panneauOdin = arg?.ouvert ?? !this.panneauOdin; this.planifier(); return;
      case 'theme': return this.appli.changerTheme(this, arg?.theme);
      case 'reglage': { const k = String(arg?.cle); if (k in p.reglages() && k !== 'theme') p.mettreReglage(k as any, arg.valeur); return; }
      case 'historique': return p.historique(String(arg?.q ?? ''), Number(arg?.n ?? 200));
      case 'effacerHistorique': { for (const h of p.historique('', 1e9)) if (!arg?.depuis || h.date >= arg.depuis) p.base.suppr('historique', h.id); this.planifier(); return; }
      case 'chercher': return this.chercher(String(arg?.q ?? ''));
      case 'fenetre': {
        if (arg?.op === 'min') this.win.minimize();
        else if (arg?.op === 'max') { if (this.win.isMaximized()) this.win.unmaximize(); else this.win.maximize(); }
        else if (arg?.op === 'fermer') this.win.close();
        else if (arg?.op === 'nouvelle') this.appli.nouvelleFenetre(false);
        else if (arg?.op === 'privee') this.appli.nouvelleFenetre(true);
        return;
      }
      case 'infosSite': {
        const id = arg?.id ?? courant(); const o = id && p.onglet(id); const v = id && p.vivants.get(id);
        if (!o) return null;
        return { url: o.url, domaine: domaine(o.url), bloques: v ? v.bloques : 0, securise: v ? v.securise : o.url.startsWith('https:'), son: v ? v.son : false, muet: v?.vue?.webContents.isAudioMuted() ?? false, zoom: v?.vue?.webContents.getZoomLevel() ?? 0 };
      }
      case 'effacerSite': { const id = arg?.id ?? courant(); const o = id && p.onglet(id); if (!o) return; const origine = new URL(o.url).origin; await p.session.clearStorageData({ origin: origine }); return true; }
      case 'dehors': p.ouvrirDehors(String(arg?.url)); return;
      case 'ecran': this.ecran = arg?.ecran; this.planifier(); return;
      case 'theme-systeme': return nativeTheme.shouldUseDarkColors ? 'noir' : 'blanc';
    }
    return this.appli.action(this, action, arg);
  }

  /** Les résultats de la barre de commande : onglets ouverts, favoris, historique. */
  chercher(q: string): any[] {
    const t = q.trim().toLowerCase(); if (!t) return [];
    const p = this.profil; const r: any[] = [];
    const vu = new Set<string>();
    for (const o of p.tousVus()) if (o.titre.toLowerCase().includes(t) || o.url.toLowerCase().includes(t)) { r.push({ type: 'onglet', id: o.id, titre: o.titre, url: o.url, icone: o.icone }); vu.add(o.url); }
    for (const f of p.favoris()) if (f.type === 'favori' && !vu.has(f.url) && (f.nom.toLowerCase().includes(t) || f.url.toLowerCase().includes(t))) { r.push({ type: 'favori', id: f.id, titre: f.nom, url: f.url, icone: f.icone }); vu.add(f.url); if (r.length > 12) break; }
    const hist = new Map<string, any>();
    for (const h of p.historique(t, 400)) { const k = h.url.replace(/#.*$/, ''); if (vu.has(k)) continue; const e = hist.get(k); if (e) e.n++; else hist.set(k, { type: 'historique', id: h.id, titre: h.titre, url: h.url, n: 1, date: h.date }); }
    r.push(...[...hist.values()].sort((a, b) => b.n - a.n || b.date - a.date).slice(0, 8));
    return r.slice(0, 20);
  }
}
