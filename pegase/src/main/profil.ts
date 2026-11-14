// Un profil ouvert : sa base chiffrée, sa session Chromium (cookies à part), ses onglets vivants.
import { WebContentsView, session as sessions, type Session, type WebContents, shell } from 'electron';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import type { Bureau, DossierVu, Espace, Favori, OngletVu, Range, Reglages, HistoireLigne, Profil as ProfilT, Collection } from '../commun/types';
import { REGLAGES_DEFAUT } from '../commun/types';
import { Base } from './stockage';
import { nouvelId, domaine } from './outils';
import { durcirPage, durcirSession, hoteAffiche, siteDe } from './securite';

/** Ce qui est rangé pour un onglet (collection « onglets », type « onglet »). */
export interface OngletRange { id: string; type: 'onglet'; url: string; titre: string; icone?: string; espace: string; epingle: boolean; dossier?: string; ordre: number; appareil: string; vu: number; urlEpingle?: string }
export interface DossierRange { id: string; type: 'dossier'; nom: string; espace: string; ouvert: boolean; ordre: number }

/** L'état du moment d'un onglet (jamais rangé). */
export class Vivant {
  vue: WebContentsView | null = null;
  charge = false; peutReculer = false; peutAvancer = false; son = false; video = false; lecture = false;
  bloques = 0; securise = false; certificat?: string; plante = false;
  dernierVu = Date.now();
  fenetre: unknown = null; // la fenêtre qui montre la vue en ce moment
  menu: Electron.ContextMenuParams | null = null; // le dernier clic droit dans la page
  /** HTTPS d'abord : l'adresse http d'origine, si on essaie d'abord la version https. */
  avertir: { type: 'https' | 'http' | 'certificat'; url: string; erreur?: string } | null = null;
  avertissement: { type: 'https' | 'http' | 'certificat'; url: string; erreur?: string } | null = null;
  constructor(readonly id: string) {}
}

export const COULEURS = ['#F2C366', '#7FB2FF', '#6CE0B8', '#FF9C86', '#C9A8FF', '#FF8FB8', '#9BE7FF', '#C9CEDB'];

export interface OptionsProfil { id: string; dossier: string; appareil: string; prive?: boolean; preparerSession?: (s: Session, p: ProfilOuvert) => void; telechargements?: string; fond?: boolean; avantSession?: (s: Session) => void }

export class ProfilOuvert extends EventEmitter {
  readonly base: Base;
  readonly session: Session;
  readonly vivants = new Map<string, Vivant>();
  readonly prive: boolean;
  readonly id: string;
  bloquesTotal = 0;
  private enMemoire = new Map<string, OngletRange>(); // onglets d'une fenêtre privée (jamais écrits)
  /** Qui crée les vues (la fenêtre branche ses écouteurs). */
  surVue: ((v: Vivant, wc: WebContents) => void) | null = null;
  private visites = new Map<string, { id: string; debut: number }>();

  constructor(readonly opts: OptionsProfil) {
    super();
    this.setMaxListeners(50);
    this.id = opts.id; this.prive = !!opts.prive;
    this.base = new Base(opts.dossier, opts.appareil, !!opts.prive);
    this.session = this.prive ? sessions.fromPartition(`prive-${nouvelId()}`, { cache: false }) : sessions.fromPartition(`persist:${opts.id}`);
    // Un navigateur ordinaire aux yeux des sites : sans « Electron » ni « Pégase » dans l'identité du navigateur.
    opts.avantSession?.(this.session);
    this.session.setUserAgent(this.session.getUserAgent().replace(/\s(Electron|pegase|Pégase|P%C3%A9gase)\/\S+/gi, ''));
    durcirSession(this.session, (wc, url) => hoteAffiche(new URL(url || wc?.getURL() || 'about:blank').hostname || 'Une page'));
    this.base.surChangement((_e, local) => { if (!local) this.emit('change'); });
    opts.preparerSession?.(this.session, this);
    // Les mots de passe de Pégase (proposer d'enregistrer, la clé dans le champ) : dans le monde isolé de chaque cadre.
    this.session.registerPreloadScript({ type: 'frame', filePath: join(__dirname, '..', 'preload', 'page.js') });
    this.premiereFois();
  }

  // ————— Données —————
  reglages(): Reglages { return { ...REGLAGES_DEFAUT, ...(this.base.get<Partial<Reglages>>('reglages', 'general') ?? {}) }; }
  mettreReglage<K extends keyof Reglages>(k: K, v: Reglages[K]): void { const r = this.reglages(); r[k] = v; this.base.mettre('reglages', { id: 'general', ...r }); this.emit('change'); }
  profil(): ProfilT {
    const p = this.base.get<ProfilT>('profil', 'moi');
    return p ?? { id: 'moi', nom: this.prive ? 'Fenêtre privée' : 'Toi', couleur: 0, lettre: this.prive ? 'P' : 'T' };
  }
  espaces(): Espace[] { return this.base.tous<Espace>('espaces').sort((a, b) => a.ordre - b.ordre); }

  ongletsRanges(): OngletRange[] {
    if (this.prive) return [...this.enMemoire.values()];
    return this.base.tous<OngletRange | DossierRange>('onglets').filter((o): o is OngletRange => o.type === 'onglet')
      .filter((o) => o.epingle || o.appareil === this.opts.appareil);
  }
  onglet(id: string): OngletRange | undefined { return this.prive ? this.enMemoire.get(id) : (this.base.get<OngletRange>('onglets', id)); }
  mettreOnglet(o: OngletRange): void { if (this.prive) this.enMemoire.set(o.id, o); else this.base.mettre('onglets', o); }
  dossiers(): DossierRange[] { return this.base.tous<OngletRange | DossierRange>('onglets').filter((o): o is DossierRange => o.type === 'dossier'); }
  bureaux(): Bureau[] { return this.base.tous<Bureau>('bureaux'); }
  favoris(): Favori[] { return this.base.tous<Favori>('favoris').sort((a, b) => a.ordre - b.ordre); }

  private premiereFois(): void {
    if (this.espaces().length) return;
    const e: Espace = { id: nouvelId('e'), nom: this.prive ? 'Privée' : 'Perso', couleur: 0, ordre: 0 };
    this.base.mettre('espaces', e);
  }

  vu(id: string): OngletVu | null {
    const o = this.onglet(id); if (!o) return null;
    const v = this.vivants.get(id);
    return {
      id: o.id, url: o.url, titre: o.titre || domaine(o.url), icone: o.icone, espace: o.espace, epingle: o.epingle, dossier: o.dossier, ordre: o.ordre,
      charge: !!v?.charge, peutReculer: !!v?.peutReculer, peutAvancer: !!v?.peutAvancer, enVeille: !v?.vue,
      son: !!v?.son, muet: !!v?.vue?.webContents.isAudioMuted(), video: !!v?.video, prive: this.prive, plante: v?.plante,
      bloques: v?.bloques ?? 0, securise: v ? v.securise : o.url.startsWith('https:'), certificat: v?.certificat,
      hote: (() => { try { const u = new URL(o.url); return /^https?:$/.test(u.protocol) ? hoteAffiche(u.hostname) : o.url; } catch { return o.url; } })(),
      site: (() => { try { const u = new URL(o.url); return /^https?:$/.test(u.protocol) ? hoteAffiche(siteDe(o.url) || u.hostname) : ''; } catch { return ''; } })(),
    };
  }
  tousVus(): OngletVu[] { return this.ongletsRanges().map((o) => this.vu(o.id)!).filter(Boolean); }
  dossiersVus(): DossierVu[] { return this.dossiers().map((d) => ({ id: d.id, nom: d.nom, espace: d.espace, ouvert: d.ouvert, ordre: d.ordre })); }

  ranges(): Range[] {
    if (this.prive) return [];
    return (this.base.get<{ id: string; liste: Range[] }>('reglages', `ranges-${this.opts.appareil}`)?.liste ?? []);
  }
  ranger(liste: Range[]): void {
    if (this.prive) return;
    const tout = [...liste, ...this.ranges()].slice(0, 300);
    this.base.mettre('reglages', { id: `ranges-${this.opts.appareil}`, liste: tout });
  }
  oterRange(id: string): Range | undefined {
    const l = this.ranges(); const r = l.find((x) => x.id === id);
    if (r) this.base.mettre('reglages', { id: `ranges-${this.opts.appareil}`, liste: l.filter((x) => x.id !== id) });
    return r;
  }

  // ————— Onglets —————
  creerOnglet(url: string, espace: string, opts: { epingle?: boolean; dossier?: string; titre?: string; apres?: string } = {}): OngletRange {
    const freres = this.ongletsRanges().filter((o) => o.espace === espace && !!o.epingle === !!opts.epingle);
    const ordre = opts.apres ? (this.onglet(opts.apres)?.ordre ?? 0) + 0.5 : (freres.length ? Math.min(...freres.map((o) => o.ordre)) - 1 : 0);
    const o: OngletRange = { id: nouvelId('o'), type: 'onglet', url, titre: opts.titre ?? '', espace, epingle: !!opts.epingle, dossier: opts.dossier, ordre, appareil: this.opts.appareil, vu: Date.now() };
    if (opts.epingle) o.urlEpingle = url;
    this.mettreOnglet(o);
    this.emit('change');
    return o;
  }

  /** Donne vie à un onglet (crée sa vue et charge sa page) s'il dort. */
  reveiller(id: string): Vivant {
    let v = this.vivants.get(id);
    if (!v) { v = new Vivant(id); this.vivants.set(id, v); }
    if (v.vue) return v;
    const o = this.onglet(id);
    const vue = new WebContentsView({ webPreferences: { session: this.session, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true, backgroundThrottling: !this.opts.fond, safeDialogs: true, safeDialogsMessage: 'Empêcher cette page d’ouvrir d’autres boîtes' } });
    vue.setBackgroundColor('#FFFFFF');
    try { vue.setBorderRadius(10); } catch { /* ancienne version */ }
    v.vue = v.vue ?? vue; v.plante = false;
    this.brancher(v, vue.webContents);
    this.surVue?.(v, vue.webContents);
    if (o?.url) vue.webContents.loadURL(o.url).catch(() => { /* l'erreur s'affiche dans la page */ });
    return v;
  }

  /** Met un onglet en veille : sa page est fermée, il garde son adresse et son titre. */
  endormir(id: string): void {
    const v = this.vivants.get(id);
    if (!v?.vue) return;
    const vue = v.vue; v.vue = null; v.charge = false; v.son = false; v.video = false; v.lecture = false;
    try { (vue as any).__parent?.removeChildView?.(vue); } catch { /* déjà retirée */ }
    this.emit('retirer-vue', vue);
    try { vue.webContents.close(); } catch { /* déjà fermée */ }
    this.emit('change');
  }

  fermerOnglet(id: string): void {
    const o = this.onglet(id);
    this.endormir(id);
    this.vivants.delete(id);
    this.finVisite(id);
    if (this.prive) this.enMemoire.delete(id); else this.base.suppr('onglets', id);
    if (o && !this.prive) this.ranger([{ id: nouvelId('r'), url: o.url, titre: o.titre || domaine(o.url), espace: o.espace, quand: Date.now() }]);
    for (const b of this.bureaux()) if (b.onglets.includes(id)) {
      const reste = b.onglets.filter((x) => x !== id);
      if (reste.length < 2) this.base.suppr('bureaux', b.id); else this.base.mettre('bureaux', { ...b, onglets: reste });
    }
    this.emit('change');
  }

  private brancher(v: Vivant, wc: WebContents): void {
    const maj = () => {
      if (wc.isDestroyed() || v.vue?.webContents !== wc) return;
      const o = this.onglet(v.id); if (!o) return;
      v.peutReculer = wc.navigationHistory.canGoBack(); v.peutAvancer = wc.navigationHistory.canGoForward();
      const url = wc.getURL(); const titre = wc.getTitle();
      if (url && (url !== o.url || (titre && titre !== o.titre && !titre.startsWith('http')))) {
        this.mettreOnglet({ ...o, url, titre: titre && titre !== url ? titre : o.titre });
      }
      this.emit('change');
    };
    wc.on('did-start-loading', () => { v.charge = true; this.emit('change'); });
    wc.on('did-stop-loading', () => { v.charge = false; maj(); });
    wc.on('did-navigate', (_e, url) => { if (v.avertir?.type === 'https' && url.startsWith('https:')) v.avertir = null; v.bloques = 0; v.securise = url.startsWith('https:'); v.certificat = undefined; maj(); this.visite(v.id, url, wc.getTitle()); });
    wc.on('did-navigate-in-page', (_e, url, principal) => { if (principal) { maj(); this.visite(v.id, url, wc.getTitle()); } });
    wc.on('page-title-updated', (_e, titre) => {
      const o = this.onglet(v.id); if (o && titre && o.titre !== titre) { this.mettreOnglet({ ...o, titre }); this.titreVisite(v.id, titre); this.emit('change'); }
    });
    wc.on('page-favicon-updated', (_e, icones) => {
      const o = this.onglet(v.id); const ic = icones.find((i) => /^https?:|^data:image/.test(i));
      if (o && ic && o.icone !== ic) { this.mettreOnglet({ ...o, icone: ic }); this.emit('change'); }
    });
    wc.on('media-started-playing', () => { v.lecture = true; this.verifierVideo(v, wc); });
    wc.on('media-paused', () => { v.lecture = false; this.emit('video', v.id); });
    wc.on('audio-state-changed', (e) => { v.son = e.audible; this.emit('change'); });
    wc.on('render-process-gone', (_e, d) => { if (d.reason !== 'clean-exit') { v.plante = true; v.charge = false; this.emit('change'); } });
    wc.on('certificate-error', () => { v.securise = false; });
    durcirPage(wc, (url, arrierePlan) => { const o = this.onglet(v.id); this.emit('ouvrir', { url, espace: o?.espace, depuis: v.id, arrierePlan }); });
    // Clic droit : le menu de Pégase (dessiné par l'interface), pas celui du système.
    wc.on('context-menu', (_e, p) => { v.menu = p; this.emit('menu-page', { id: v.id, p: menuDepuis(p, wc) }); });
    // HTTPS d'abord et certificats : si la version chiffrée ne répond pas, on prévient au lieu d'une page vide.
    wc.on('did-fail-load', (_e, code, desc, url, principal) => {
      if (!principal || code === -3) return;
      const avant = v.avertir;
      if (avant?.type === 'https' && url.startsWith('https:')) this.avertir(v, { type: 'http', url: avant.url, erreur: desc });
      else if (code <= -200 && code > -300) this.avertir(v, { type: 'certificat', url, erreur: desc });
    });
  }

  /** Une page d'avertissement de Pégase à la place de la page (certificat invalide, site sans HTTPS). */
  avertir(v: Vivant, a: NonNullable<Vivant['avertir']>): void {
    v.avertir = a; v.avertissement = a;
    const o = this.onglet(v.id); if (!o) return;
    this.mettreOnglet({ ...o, url: `pegase://avertissement`, titre: a.type === 'certificat' ? 'Connexion pas sûre' : 'Site sans chiffrement' });
    // La page d'erreur de Chromium est fermée : c'est la page d'avertissement de Pégase qui s'affiche à la place.
    setImmediate(() => this.endormir(v.id));
    this.emit('change');
  }

  private verifierVideo(v: Vivant, wc: WebContents): void {
    wc.executeJavaScript('(()=>{const l=[...document.querySelectorAll("video")].filter(x=>!x.paused&&x.readyState>1);return l.length>0})()', false)
      .then((oui: boolean) => { v.video = !!oui; this.emit('video', v.id); this.emit('change'); }).catch(() => 0);
  }

  // ————— Historique —————
  private visite(onglet: string, url: string, titre: string): void {
    if (this.prive || !/^https?:/.test(url)) return;
    this.finVisite(onglet);
    const h: HistoireLigne = { id: nouvelId('h'), url, titre: titre || domaine(url), date: Date.now(), appareil: this.opts.appareil };
    this.visites.set(onglet, { id: h.id, debut: h.date });
    this.base.mettre('historique', h);
    this.elaguerHistorique();
  }
  private titreVisite(onglet: string, titre: string): void {
    const vis = this.visites.get(onglet); if (!vis) return;
    const h = this.base.get<HistoireLigne>('historique', vis.id); if (h && h.titre !== titre) this.base.mettre('historique', { ...h, titre });
  }
  finVisite(onglet: string): void {
    const vis = this.visites.get(onglet); if (!vis) return;
    this.visites.delete(onglet);
    const h = this.base.get<HistoireLigne>('historique', vis.id);
    if (h) this.base.mettre('historique', { ...h, duree: Date.now() - vis.debut });
  }
  private elague = 0;
  private elaguerHistorique(): void {
    if (++this.elague % 200) return;
    const tout = this.base.tous<HistoireLigne>('historique');
    if (tout.length <= 50000) return;
    for (const h of tout.sort((a, b) => a.date - b.date).slice(0, tout.length - 50000)) this.base.suppr('historique', h.id);
  }
  historique(q = '', n = 200): HistoireLigne[] {
    const t = q.toLowerCase();
    return this.base.tous<HistoireLigne>('historique').filter((h) => !t || h.url.toLowerCase().includes(t) || (h.titre || '').toLowerCase().includes(t))
      .sort((a, b) => b.date - a.date).slice(0, n);
  }

  /** Ce que la personne a écrit d'autre ailleurs (favoris importés, etc.) : un raccourci pour mettre. */
  mettre<T extends { id: string }>(col: Collection, data: T): T { const r = this.base.mettre(col, data); this.emit('change'); return r; }
  suppr(col: Collection, id: string): void { this.base.suppr(col, id); this.emit('change'); }

  ouvrirDehors(url: string): void { shell.openExternal(url).catch(() => 0); }

  fermer(): void {
    for (const id of [...this.vivants.keys()]) { this.finVisite(id); this.endormir(id); }
    this.base.sauver();
    if (this.prive) this.session.clearStorageData().catch(() => 0);
  }
}

/** Ce que l'interface a besoin de savoir d'un clic droit (sans rien de la page au-delà). */
export function menuDepuis(p: Electron.ContextMenuParams, wc: WebContents) {
  return {
    x: p.x, y: p.y, lien: p.linkURL || '', texteLien: (p.linkText || '').slice(0, 80), image: p.mediaType === 'image' ? p.srcURL : '', video: p.mediaType === 'video',
    selection: (p.selectionText || '').slice(0, 2000), editable: p.isEditable, suggestions: p.dictionarySuggestions.slice(0, 4), motMalOrthographie: p.misspelledWord || '',
    peutReculer: wc.navigationHistory.canGoBack(), peutAvancer: wc.navigationHistory.canGoForward(), url: wc.getURL(), cadre: p.frameURL || '',
  };
}
