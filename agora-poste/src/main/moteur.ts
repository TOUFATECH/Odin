// Agora sur l'ordinateur : le moteur du store.
// - Inscrit le poste dans Odin, envoie l'inventaire (ce que le store a installé ici et qui est encore là), lit « mon store ».
// - Écoute le flux des ordres : un ordre imposé (installée d'office, forcé par l'admin, retiré) s'exécute sans rien demander,
//   un par un, avec la progression envoyée à Odin ; sinon c'est la personne qui clique (Installer, Désinstaller, Ouvrir).
// - Chaque installateur est vérifié (empreinte SHA-256) avant d'être installé ; un fichier différent est refusé et effacé.
// - Hors ligne : on réessaie la connexion (1 s, 2 s, 4 s… 30 s au plus) ; les ordres attendent dans Odin.

import { EventEmitter } from 'node:events';
import type { Connexion } from './odin';
import { LecteurSse } from './odin';
import type { Rangement } from './stockage';
import { desinstaller, EmpreinteFausse, formatsDuSysteme, installer, present, telecharger, type Installe, type Paquet } from './installeur';
import type { EtatUI, LigneStore, Mode } from '../commun/types';
import { pourLaPersonne } from './texte';

export interface Article { id: string; nom: string; desc: string; mode: Mode; par: string; web?: string; paquet?: Paquet; force?: 'installee' | 'absente'; etat?: string; version?: string; majDispo?: boolean }
export interface Ordre { id: string; element: string; nom: string; action: 'installer' | 'desinstaller' | 'mettre_a_jour'; version?: string; impose: boolean; par: string; qui: string }
type Tache = { ordre?: Ordre; element: string; action: Ordre['action']; par: 'personne' | 'impose' };
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Moteur extends EventEmitter {
  etat: EtatUI;
  private store: Article[] = [];
  private file: Tache[] = []; private occupe = false;
  private enCours = new Map<string, { action: Ordre['action']; progression?: number }>();
  private erreurs = new Map<string, string>();
  private fluxOuvert: { destroy(): void } | null = null; private arret = false; private pause = 1000;
  private dejaVus = new Set<string>(); private premierStore = true;
  constructor(private odin: Connexion, private r: Rangement, version: string) {
    super();
    this.etat = { connexion: 'aucune', store: [], historique: r.historique.slice(0, 100), enLigne: false, version };
  }
  private changer(p: Partial<EtatUI>): void { this.etat = { ...this.etat, ...p }; this.emit('etat', this.etat); }
  /** Rend l'état de l'interface à partir du store d'Odin et de ce qui est vraiment installé ici. */
  private recalculer(): void {
    const lignes: LigneStore[] = this.store.map((a) => {
      const loc = this.r.installes[a.id], ec = this.enCours.get(a.id);
      return { id: a.id, nom: a.nom, desc: a.desc, mode: a.mode, par: a.par, impose: a.mode === 'office' || a.force === 'installee', installee: Boolean(loc), ...(loc ? { versionLocale: loc.version } : {}), ...(a.paquet ? { versionOdin: a.paquet.version } : {}),
        installable: Boolean(a.paquet && formatsDuSysteme().includes(a.paquet.format)), ...(a.web ? { web: a.web } : {}), ...(ec ? { enCours: ec } : {}), ...(this.erreurs.get(a.id) ? { erreur: this.erreurs.get(a.id) } : {}),
        majDispo: Boolean(loc && a.paquet && a.paquet.version !== loc.version && a.mode !== 'retiree') };
    });
    this.changer({ store: lignes, historique: this.r.historique.slice(0, 100) });
  }

  /** Démarre : session (gardée ou du poste), inscription, inventaire, store, flux. */
  async demarrer(): Promise<void> {
    this.changer({ connexion: 'connexion', ...(this.r.reglages.adresse ? { odin: { adresse: this.r.reglages.adresse, nom: this.r.reglages.nomOdin ?? 'Odin' } } : {}) });
    const o = await this.odin.ouvrir();
    if (!o.ok) { this.changer({ connexion: 'aucune', connexionInfo: { ...(o.message && this.r.reglages.adresse ? { erreur: o.message } : {}) } }); return; }
    await this.relie();
  }
  /** Après une connexion réussie. */
  async relie(): Promise<void> {
    this.arret = false;
    this.changer({ connexion: 'ok', odin: { adresse: this.odin.adresse, nom: this.r.reglages.nomOdin ?? 'Odin' }, connexionInfo: undefined });
    const ok = await this.inscrire();
    if (ok) void this.ecouter();
  }
  private async inscrire(): Promise<boolean> {
    try {
      const i = await this.odin.api('inscrire', { nom: this.odin.sso.appareil.nom, plateforme: this.odin.sso.appareil.plateforme, systeme: systeme(), version: this.etat.version });
      if (i.status !== 200) { this.changer({ connexion: i.status === 401 || i.status === 403 ? 'aucune' : 'horsligne', connexionInfo: { erreur: i.j.message ?? `Odin a répondu ${i.status}.` } }); return false; }
      this.changer({ personne: { nom: i.j.personne.nom, login: i.j.personne.login, groupes: i.j.personne.groupes ?? [] }, appareil: { nom: i.j.appareil.nom, plateforme: i.j.appareil.plateforme } });
      // Inventaire : ce que le store a installé ici et qui est encore là (la personne a pu l'effacer à la main).
      for (const [id, x] of Object.entries(this.r.installes)) if (!(await present(x))) { delete this.r.installes[id]; this.r.noter(`${x.nom} n'est plus sur ce poste (enlevé à la main).`, false); }
      this.r.sauverInstalles();
      await this.odin.api('inventaire', { applis: Object.values(this.r.installes).map((x) => ({ element: x.element, etat: 'installee', version: x.version, par: x.par })) });
      this.prendreStore(i.j.store ?? []);
      for (const o of (i.j.ordres ?? []) as Ordre[]) this.recevoir(o);
      return true;
    } catch (e) { this.changer({ connexion: 'horsligne', connexionInfo: { erreur: `Odin ne répond pas (${pourLaPersonne((e as Error).message)}).` } }); return false; }
  }
  private prendreStore(l: Article[]): void {
    const nouveaux = l.filter((a) => a.mode !== 'retiree' && !this.dejaVus.has(a.id));
    for (const a of l) this.dejaVus.add(a.id);
    this.store = l;
    if (!this.premierStore && nouveaux.length) { const par = nouveaux.find((a) => a.par)?.par; this.changer({ message: `${par ? `${par} t'a ouvert de nouvelles applis` : 'Du nouveau'} : ${nouveaux.length} nouveauté${nouveaux.length > 1 ? 's arrivent' : ' arrive'} dans ton store.` }); }
    this.premierStore = false;
    this.recalculer();
  }
  async rafraichir(): Promise<void> { const r = await this.odin.api('store').catch(() => undefined); if (r?.status === 200) this.prendreStore(r.j.store ?? []); }

  /** Le flux des ordres, avec reconnexion. */
  private async ecouter(): Promise<void> {
    while (!this.arret) {
      try {
        const f = await this.odin.flux();
        if (f.statusCode !== 200) {
          let b = ''; for await (const c of f) b += c; const j = (() => { try { return JSON.parse(b); } catch { return {}; } })();
          if (f.statusCode === 404 && j.code === 'appareil_inconnu') { if (await this.inscrire()) continue; }
          if (f.statusCode === 401) { this.changer({ connexion: 'aucune', enLigne: false, connexionInfo: { erreur: j.message ?? 'Reconnecte-toi à Odin.' } }); return; }
          throw new Error(j.message ?? `Odin a répondu ${f.statusCode}`);
        }
        this.fluxOuvert = f; this.pause = 1000; this.changer({ enLigne: true, connexion: 'ok' });
        const lecteur = new LecteurSse((type, data) => this.surEvenement(type, data));
        f.setEncoding('utf8');
        for await (const c of f) lecteur.morceau(String(c));
        this.fluxOuvert = null;
        if (!this.arret) await this.rafraichir();
      } catch (e) {
        this.fluxOuvert = null; if (this.arret) return;
        this.changer({ enLigne: false, connexion: 'horsligne', connexionInfo: { erreur: `Odin ne répond pas (${pourLaPersonne((e as Error).message)}) : nouvel essai bientôt.` } });
        await attendre(this.pause); this.pause = Math.min(30_000, this.pause * 2);
        if (this.etat.connexion === 'horsligne') { const ok = await this.inscrire(); if (ok) this.changer({ connexion: 'ok', connexionInfo: undefined }); }
      }
    }
  }
  private surEvenement(type: string, data: string): void {
    let j: any; try { j = JSON.parse(data); } catch { return; }
    if (type === 'ordre') this.recevoir(j as Ordre);
    else if (type === 'annule') { this.file = this.file.filter((t) => t.ordre?.id !== j.id); }
    else if (type === 'store') void this.rafraichir();
    else if (type === 'retire') { this.arret = true; this.changer({ connexion: 'aucune', enLigne: false, connexionInfo: { erreur: String(j.message ?? 'Cet appareil a été retiré du store.') } }); }
  }
  /** Un ordre imposé : il passe dans la file, sans rien demander. */
  private recus = new Set<string>();
  private recevoir(o: Ordre): void {
    // Un même ordre peut arriver deux fois (inscription puis flux, ou reconnexion) : il n'est fait qu'une fois.
    if (this.recus.has(o.id)) return; this.recus.add(o.id);
    this.file.push({ ordre: o, element: o.element, action: o.action, par: 'impose' }); void this.vider();
  }
  /** La personne clique : Installer, Mettre à jour, Désinstaller (refusé si c'est imposé). */
  async demander(action: 'installer' | 'desinstaller' | 'mettre_a_jour', id: string): Promise<{ ok: boolean; message?: string }> {
    const a = this.store.find((x) => x.id === id); if (!a) return { ok: false, message: 'Cet élément n\'est plus dans ton store.' };
    if (action === 'desinstaller' && (a.mode === 'office' || a.force === 'installee')) return { ok: false, message: `${a.nom} est imposée${a.par ? ` par ${a.par}` : ''} : tu ne peux pas l'enlever.` };
    if (action !== 'desinstaller' && (a.mode === 'retiree' || !a.paquet)) return { ok: false, message: `${a.nom} ne s'installe pas sur ce poste.` };
    this.file.push({ element: id, action, par: 'personne' }); void this.vider(); return { ok: true };
  }
  private async vider(): Promise<void> {
    if (this.occupe) return; this.occupe = true;
    try { while (this.file.length) { const t = this.file.shift()!; await this.faire(t); } } finally { this.occupe = false; }
  }
  /** Les comptes rendus partent dans l'ordre (une progression ne doit jamais arriver après « installée »). */
  private envois: Promise<unknown> = Promise.resolve();
  private compteRendu(t: Tache, etat: string, plus: Record<string, unknown> = {}): Promise<void> {
    const p = this.envois.then(() => this.odin.api('etat', { element: t.element, etat, ...(t.ordre ? { ordre: t.ordre.id } : {}), par: t.par, ...plus })).catch(() => undefined);
    this.envois = p; return p.then(() => undefined);
  }
  private async faire(t: Tache): Promise<void> {
    let a = this.store.find((x) => x.id === t.element);
    // L'ordre parle d'une version que ce store ne connaît pas encore : on relit le store d'Odin d'abord.
    if (!a || (t.action !== 'desinstaller' && (!a.paquet || (t.ordre?.version && a.paquet.version !== t.ordre.version)))) { await this.rafraichir(); a = this.store.find((x) => x.id === t.element); }
    const nom = a?.nom ?? t.ordre?.nom ?? t.element, qui = t.ordre?.qui ? ` (imposé par ${t.ordre.qui})` : t.ordre ? ' (imposé)' : '';
    this.erreurs.delete(t.element);
    try {
      if (t.action === 'desinstaller') {
        const x = this.r.installes[t.element];
        if (!x) { await this.compteRendu(t, 'absente'); return; }
        this.enCours.set(t.element, { action: 'desinstaller' }); this.recalculer(); await this.compteRendu(t, 'desinstallation');
        await desinstaller(x); delete this.r.installes[t.element]; this.r.sauverInstalles();
        this.r.noter(`${nom} désinstallée${qui}.`); await this.compteRendu(t, 'absente');
        return;
      }
      const p = a?.paquet; if (!p) throw new Error('pas d\'installateur pour ce poste dans le store');
      if (!formatsDuSysteme().includes(p.format)) throw new Error(`format ${p.format} : pas pour ce système`);
      this.enCours.set(t.element, { action: t.action, progression: 0 }); this.recalculer(); await this.compteRendu(t, 'installation', { progression: 0 });
      let dernier = 0;
      const fichier = await telecharger(p.telecharger, p.sha256, {
        dossier: this.r.dossier + '/telechargements',
        ...(p.telecharger.startsWith('/') ? { ouvrir: (u: string) => this.odin.telechargement(u) } : {}),
        progression: (pc) => { const v = Math.round(pc * 0.9); this.enCours.set(t.element, { action: t.action, progression: v }); this.recalculer(); if (v - dernier >= 10) { dernier = v; void this.compteRendu(t, 'installation', { progression: v }); } },
      });
      this.enCours.set(t.element, { action: t.action, progression: 95 }); this.recalculer();
      const ancien = this.r.installes[t.element];
      const x: Installe = await installer(fichier, p, { id: t.element, nom }, ancien?.par === 'personne' && t.par === 'impose' ? 'personne' : t.par);
      this.r.installes[t.element] = x; this.r.sauverInstalles();
      this.r.noter(`${nom} ${p.version} ${t.action === 'mettre_a_jour' || ancien ? 'mise à jour' : 'installée'}${qui}.`);
      await this.compteRendu(t, 'installee', { version: p.version });
    } catch (e) {
      const m = e instanceof EmpreinteFausse ? e.message : pourLaPersonne(`${(e as Error).message}`);
      this.erreurs.set(t.element, m); this.r.noter(`${nom} : ${t.action === 'desinstaller' ? 'désinstallation' : 'installation'} refusée ou ratée — ${m}`, false);
      await this.compteRendu(t, 'erreur', { erreur: m.slice(0, 200), ...(this.r.installes[t.element] ? { version: this.r.installes[t.element].version } : {}) });
    } finally { this.enCours.delete(t.element); this.recalculer(); }
  }
  /** Ouvre une appli : installée ici (AppImage…), ou appli d'Odin dans le navigateur. */
  cheminDe(id: string): { chemin?: string; web?: string } { const x = this.r.installes[id], a = this.store.find((y) => y.id === id); return { ...(x?.chemin ? { chemin: x.chemin } : {}), ...(a?.web ? { web: `${this.odin.adresse}/#app=${a.web}` } : {}) }; }
  async quitter(): Promise<void> { this.arret = true; this.fluxOuvert?.destroy(); }
  async deconnecter(): Promise<void> { this.arret = true; this.fluxOuvert?.destroy(); await this.odin.api('desinscrire', {}).catch(() => undefined); await this.odin.deconnecter(); this.store = []; this.changer({ connexion: 'aucune', personne: undefined, store: [], enLigne: false, message: undefined }); }
}
function systeme(): string {
  const os = require('node:os') as typeof import('node:os');
  if (process.platform === 'win32') return `Windows ${os.release()}`.slice(0, 40);
  if (process.platform === 'darwin') return `macOS ${os.release()}`.slice(0, 40);
  try { const t = require('node:fs').readFileSync('/etc/os-release', 'utf8') as string; return (/^PRETTY_NAME="?([^"\n]+)/m.exec(t)?.[1] ?? 'Linux').slice(0, 40); } catch { return 'Linux'; }
}
