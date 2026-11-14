// Pégase, le navigateur d'Odin : le processus principal.
import { app, protocol, session, net, BaseWindow, Menu } from 'electron';
import { join, normalize, extname } from 'node:path';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Etat, Theme } from '../commun/types';
import { ProfilOuvert } from './profil';
import { Fenetre, type Appli } from './fenetre';
import { ecrireSur } from './stockage';
import { nouvelId } from './outils';
import { Protection } from './protection';
import { actionFavoris } from './favoris';

// ————— Où ranger les données (dossier de profil du système) —————
// Windows : %APPDATA%\Pégase, Mac : ~/Library/Application Support/Pégase, Linux : ~/.config/pegase.
app.setName('Pégase');
const racineDonnees = process.env.PEGASE_DOSSIER || join(app.getPath('appData'), process.platform === 'linux' ? 'pegase' : 'Pégase');
app.setPath('userData', racineDonnees);
const dossierProfils = join(racineDonnees, process.platform === 'linux' ? 'profils' : 'Profils');
if (process.platform === 'win32') app.setAppUserModelId('com.toufatech.pegase');

protocol.registerSchemesAsPrivileged([{ scheme: 'pegase', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!process.env.PEGASE_ESSAI && !app.requestSingleInstanceLock()) app.quit();

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https: http:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'";
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json' };

function appareil(): string {
  const f = join(racineDonnees, 'appareil.json');
  try { return JSON.parse(readFileSync(f, 'utf8')).id; } catch { /* premier lancement */ }
  mkdirSync(racineDonnees, { recursive: true });
  const id = nouvelId('pc-');
  ecrireSur(f, JSON.stringify({ id }));
  return id;
}

class Pegase implements Appli {
  fenetres = new Set<Fenetre>();
  profils = new Map<string, ProfilOuvert>();
  protection!: Protection;
  readonly appareil = appareil();

  async demarrer(): Promise<void> {
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
    this.servirInterface();
    this.protection = new Protection(this as any, racineDonnees);
    await this.protection.demarrer();
    const p = this.ouvrirProfil(process.env.PEGASE_PROFIL || 'toi');
    this.ecrireListeProfils();
    this.protection.reglerDns(undefined, p.reglages().dnsSecours).then(() => { for (const x of this.fenetres) x.planifier(); }).catch(() => 0);
    const f = this.nouvelleFenetreDe(p);
    f.ecran = 'navigateur';
    setInterval(() => this.veiller(), 30_000).unref();
    app.on('second-instance', (_e, argv) => {
      const url = argv.find((a) => /^https?:\/\//.test(a));
      const f = [...this.fenetres].find((x) => !x.profil.prive);
      if (f) { if (f.win.isMinimized()) f.win.restore(); f.win.focus(); if (url) f.faire('ouvrir', { url }); }
    });
    const url = process.argv.find((a) => /^https?:\/\//.test(a));
    if (url) f.faire('ouvrir', { url });
  }

  /** Les fichiers de l'interface, servis en pegase://app/… avec une CSP stricte. */
  private servirInterface(): void {
    const dist = join(__dirname, '..', 'ui');
    session.fromPartition('pegase-ui').protocol.handle('pegase', async (req) => {
      const u = new URL(req.url);
      if (u.host !== 'app') return new Response('Introuvable', { status: 404 });
      const chemin = normalize(join(dist, decodeURIComponent(u.pathname)));
      if (!chemin.startsWith(dist) || !existsSync(chemin)) return new Response('Introuvable', { status: 404 });
      const r = await net.fetch(pathToFileURL(chemin).toString());
      return new Response(r.body, { headers: { 'content-type': TYPES[extname(chemin)] ?? 'application/octet-stream', 'content-security-policy': CSP, 'x-content-type-options': 'nosniff' } });
    });
    session.fromPartition('pegase-ui').setPermissionRequestHandler((_wc, perm, ok) => ok(perm === 'clipboard-sanitized-write'));
  }

  ouvrirProfil(nom: string, prive = false): ProfilOuvert {
    const id = prive ? `prive-${nouvelId()}` : nom.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'toi';
    const deja = this.profils.get(id); if (deja) return deja;
    const p = new ProfilOuvert({ id, dossier: join(dossierProfils, id), appareil: this.appareil, prive, preparerSession: (s, pr) => this.protection.preparerSession(s, pr) });
    this.profils.set(id, p);
    return p;
  }

  nouvelleFenetreDe(p: ProfilOuvert): Fenetre {
    const f = new Fenetre(p, this);
    this.fenetres.add(f);
    return f;
  }

  nouvelleFenetre(prive: boolean): void {
    const base = [...this.fenetres].find((x) => !x.profil.prive);
    const p = prive ? this.ouvrirProfil('prive', true) : base?.profil ?? this.ouvrirProfil('toi');
    const f = this.nouvelleFenetreDe(p);
    f.ecran = 'navigateur';
    if (!p.tousVus().length || prive) f.envoyer('commande', 'barre-commande');
  }

  changerTheme(f: Fenetre, t: Theme): void {
    if (!['noir', 'blanc', 'bleu', 'rouge', 'transparent', 'glace'].includes(t)) return;
    f.profil.mettreReglage('theme', t);
    for (const x of this.fenetres) if (x.profil === f.profil) x.changerTheme(t);
  }

  etatGlobal(f: Fenetre): Partial<Etat> {
    return {
      protection: this.protection.etat(f.profil),
      telechargements: this.protection.telechargements.liste(f.profil),
    };
  }

  async action(f: Fenetre, action: string, arg: any): Promise<any> {
    if (action === 'memoire') return this.memoire();
    if (action === 'dnsChange') { await this.protection.reglerDns(undefined, f.profil.reglages().dnsSecours); for (const x of this.fenetres) x.planifier(); return; }
    const fav = actionFavoris(f.profil, action, arg); if (fav.fait) return fav.r;
    const p = f.profil;
    switch (action) {
      case 'majProfil': {
        const pr = p.profil(); const n = { ...pr };
        if (arg?.nom) { n.nom = String(arg.nom).slice(0, 60); n.lettre = n.nom.trim().slice(0, 1).toUpperCase() || 'T'; }
        if (typeof arg?.couleur === 'number') n.couleur = arg.couleur % 8;
        p.mettre('profil', n); this.ecrireListeProfils(); return;
      }
      case 'statsProfil': {
        const depuis = Date.now() - 30 * 86400_000;
        const ms = p.historique('', 1e9).filter((h) => h.date > depuis).reduce((s, h) => s + (h.duree ?? 0), 0);
        const ouverts = new Set([...this.profils.values()].map((x) => x.id));
        return { heures: Math.round(ms / 360_000) / 10, bloques: p.bloquesTotal, profils: this.listeProfils().map((x) => ({ ...x, actif: ouverts.has(x.id) })) };
      }
      case 'ouvrirProfil': {
        const id = String(arg?.id || ''); if (!this.listeProfils().some((x) => x.id === id)) return;
        const n = this.nouvelleFenetreDe(this.ouvrirProfil(id)); n.ecran = 'navigateur'; return;
      }
      case 'nouveauProfil': {
        const nom = String(arg?.nom || '').trim().slice(0, 60); if (!nom) return;
        const id = nom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profil';
        let k = id, i = 2; while (this.listeProfils().some((x) => x.id === k)) k = `${id}-${i++}`;
        const np = this.ouvrirProfil(k);
        np.mettre('profil', { id: 'moi', nom, lettre: nom.slice(0, 1).toUpperCase(), couleur: (this.listeProfils().length + 1) % 8 });
        this.ecrireListeProfils();
        const n = this.nouvelleFenetreDe(np); n.ecran = 'navigateur'; return;
      }
    }
    return this.protection.action(f, action, arg);
  }

  fenetreFermee(f: Fenetre): void {
    this.fenetres.delete(f);
    if (![...this.fenetres].some((x) => x.profil === f.profil)) { f.profil.fermer(); this.profils.delete(f.profil.id); }
    if (!this.fenetres.size && process.platform !== 'darwin') app.quit();
  }

  /** Onglets inactifs mis en veille (10 min par défaut) ; onglets du jour rangés après 12 h. */
  veiller(): void {
    const now = Date.now();
    for (const p of this.profils.values()) {
      const r = p.reglages();
      const enVideo = new Set([...this.fenetres].filter((f) => f.profil === p).flatMap((f) => f.videos));
      for (const [id, v] of p.vivants) {
        if (!v.vue || v.fenetre || enVideo.has(id) || v.son) continue;
        if (now - v.dernierVu > r.veilleMinutes * 60_000) p.endormir(id);
      }
      if (r.rangerHeures > 0 && !p.prive) {
        for (const o of p.ongletsRanges()) {
          if (o.epingle || p.vivants.get(o.id)?.fenetre || enVideo.has(o.id)) continue;
          if (now - (o.vu || 0) > r.rangerHeures * 3_600_000) p.fermerOnglet(o.id);
        }
      }
    }
  }

  /** La mémoire de tout Pégase (processus principal, interface, pages), en Mo. */
  memoire(): { total: number; processus: { type: string; mo: number }[] } {
    const l = app.getAppMetrics().map((m) => ({ type: m.type, mo: Math.round(m.memory.workingSetSize / 1024) }));
    return { total: l.reduce((s, x) => s + x.mo, 0), processus: l };
  }

  /** Les profils de ce PC (nom affiché gardé à part, sans rien de secret, pour la liste). */
  listeProfils(): { id: string; nom: string; lettre: string; couleur: number }[] {
    try { return JSON.parse(readFileSync(join(dossierProfils, 'profils.json'), 'utf8')); } catch { return []; }
  }
  ecrireListeProfils(): void {
    const l = this.listeProfils();
    for (const p of this.profils.values()) {
      if (p.prive) continue;
      const pr = p.profil(); const i = l.findIndex((x) => x.id === p.id);
      const e = { id: p.id, nom: pr.nom, lettre: pr.lettre, couleur: pr.couleur };
      if (i >= 0) l[i] = e; else l.push(e);
    }
    mkdirSync(dossierProfils, { recursive: true });
    ecrireSur(join(dossierProfils, 'profils.json'), JSON.stringify(l));
  }

  quitter(): void { for (const p of this.profils.values()) p.fermer(); }
}

const pegase = new Pegase();
(globalThis as any).__pegase = pegase; // pour les essais (Playwright évalue dans le processus principal)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => pegase.quitter());
app.on('activate', () => { if (!BaseWindow.getAllWindows().length) pegase.nouvelleFenetre(false); });
app.whenReady().then(() => pegase.demarrer()).catch((e) => { console.error('Pégase n’a pas pu démarrer :', e); app.quit(); });
