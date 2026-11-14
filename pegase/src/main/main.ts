// Pégase, le navigateur d'Odin : le processus principal.
import { app, protocol, session, net, BaseWindow, Menu, shell, nativeTheme } from 'electron';
import { join, normalize, extname } from 'node:path';
import { existsSync, readFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Etat, Theme } from '../commun/types';
import { ProfilOuvert } from './profil';
import { Fenetre, type Appli } from './fenetre';
import { ecrireSur } from './stockage';
import { nouvelId } from './outils';
import { Protection } from './protection';
import { actionFavoris } from './favoris';
import { brancherCertificats, certificatsEpingles } from './securite';
import { Synchro, trouverOdin, bonjour, type OdinTrouve } from './odin';
import { MotsDePasse, brancherMotsDePasse } from './motsdepasse';
import { actionsPages, viderEnFermant } from './actions';
import { controler } from './controle';
import { brancherPlumePegase, type PlumePegase } from './plume';
import { webContents } from 'electron';

// ————— Où ranger les données (dossier de profil du système) —————
// Windows : %APPDATA%\Pégase, Mac : ~/Library/Application Support/Pégase, Linux : ~/.config/pegase.
app.setName('Pégase');
const racineDonnees = process.env.PEGASE_DOSSIER || join(app.getPath('appData'), process.platform === 'linux' ? 'pegase' : 'Pégase');
app.setPath('userData', racineDonnees);
const dossierProfils = join(racineDonnees, process.platform === 'linux' ? 'profils' : 'Profils');
if (process.platform === 'win32') app.setAppUserModelId('com.toufatech.pegase');

// Bac à sable pour tous les rendus ; interface en français (outils de développement compris).
if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox(); // (essais ici en root : --no-sandbox ; chaque vue garde sandbox: true)
if (!app.commandLine.hasSwitch('lang')) app.commandLine.appendSwitch('lang', 'fr');
// Pégase n'ouvre jamais de port de débogage : un Pégase installé refuse de démarrer si on lui en donne un.
if (app.isPackaged && (app.commandLine.hasSwitch('remote-debugging-port') || app.commandLine.hasSwitch('remote-debugging-pipe'))) { console.error('Pégase refuse de démarrer avec un port de débogage ouvert.'); app.exit(1); }
const ESSAI = !app.isPackaged && !!process.env.PEGASE_ESSAI;

protocol.registerSchemesAsPrivileged([{ scheme: 'pegase', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!ESSAI && !app.requestSingleInstanceLock()) app.quit();

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
  synchros = new Map<ProfilOuvert, Synchro>();
  mdps = new Map<ProfilOuvert, MotsDePasse>();
  private controleMdp: { p: ProfilOuvert; m: MotsDePasse } | null = null;
  private controleEnCours: Promise<unknown> | null = null;
  protection!: Protection;
  plume!: PlumePegase;
  readonly appareil = appareil();
  /** 1er lancement : les Odin trouvés, la recherche en cours, le compte tapé (le mot de passe reste en mémoire seulement). */
  private recherche = { trouves: [] as OdinTrouve[], encours: false };
  private compteEnAttente: { nom: string; email: string; motdepasse: string } | null = null;

  async demarrer(): Promise<void> {
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
    this.servirInterface();
    brancherCertificats();
    brancherMotsDePasse((wcId) => {
      const wc = webContents.fromId(wcId); if (!wc) return null;
      const p = [...this.profils.values(), ...(this.controleMdp ? [this.controleMdp.p] : [])].find((x) => x.session === wc.session); if (!p) return null;
      if (this.controleMdp?.p === p) return { p, m: this.controleMdp.m, avertir: () => 0, gerer: () => 0 };
      const m = this.mdps.get(p); if (!m) return null;
      const f = () => [...this.fenetres].find((x) => x.profil === p && [...p.vivants.values()].some((v) => v.vue?.webContents.id === wcId && v.fenetre === x)) ?? [...this.fenetres].find((x) => x.profil === p);
      return { p, m, avertir: () => this.planifierTout(), gerer: () => { const x = f(); if (x) void x.faire('naviguer', { texte: 'pegase://reglages/motsdepasse', nouvel: true }); } };
    });
    // Plume (le correcteur d'Odin) dans les pages web : seul ce processus parle à Odin, jamais les fenêtres privées.
    this.plume = brancherPlumePegase({
      profils: () => this.profils.values(),
      synchro: (p) => this.synchros.get(p),
      ouvrir: (p, wcId, url) => {
        const x = [...this.fenetres].find((f) => f.profil === p && [...p.vivants.values()].some((v) => v.vue?.webContents.id === wcId && v.fenetre === f)) ?? [...this.fenetres].find((f) => f.profil === p);
        if (x) void x.faire('naviguer', { texte: url, nouvel: true });
      },
    });
    this.protection = new Protection(this as any, racineDonnees);
    await this.protection.demarrer();
    const p = this.ouvrirProfil(process.env.PEGASE_PROFIL || 'toi');
    this.ecrireListeProfils();
    this.protection.reglerDns(undefined, p.reglages().dnsSecours).then(() => { for (const x of this.fenetres) x.planifier(); }).catch(() => 0);
    const f = this.nouvelleFenetreDe(p);
    f.ecran = 'demarrage';
    void this.premierEcran(f, p);
    setInterval(() => this.veiller(), 30_000).unref();
    nativeTheme.on('updated', () => { for (const x of [...this.fenetres]) if (x.profil.reglages().themeAuto && !x.win.isDestroyed()) this.changerTheme(x, 'auto', true); });
    app.on('second-instance', (_e, argv) => {
      const url = argv.find((a) => /^https?:\/\//.test(a));
      const f = [...this.fenetres].find((x) => !x.profil.prive);
      if (f) { if (f.win.isMinimized()) f.win.restore(); f.win.focus(); if (url) f.faire('ouvrir', { url }); }
    });
    const url = process.argv.find((a) => /^https?:\/\//.test(a));
    if (url) f.faire('ouvrir', { url });
  }

  /** Envoi d'un fichier douteux à Asclépios (seulement si la personne l'a permis dans les réglages). */
  async odinAnalyse(p: ProfilOuvert, chemin: string, nom: string): Promise<{ sain: boolean; menace?: string } | null> {
    const sy = this.synchros.get(p); if (!sy?.lien) return null;
    if (statSync(chemin).size > 200 * 1024 * 1024) return null;
    return sy.analyser(readFileSync(chemin), nom);
  }

  /** Démarrage : profil déjà relié → le navigateur ; 1er lancement → chercher Odin (ce PC, puis le réseau). */
  private async premierEcran(f: Fenetre, p: ProfilOuvert): Promise<void> {
    const sy = this.synchros.get(p)!;
    const debut = Date.now();
    const montrer = async (e: Etat['ecran']) => { const reste = 700 - (Date.now() - debut); if (reste > 0) await new Promise((r) => setTimeout(r, reste)); f.ecran = e; f.planifier(); };
    const multi = this.listeProfils().filter((x) => x.id !== p.id).length > 0;
    if (sy.lien) { await sy.demarrer(); this.apresConnexion(p); return montrer(multi ? 'connexion' : 'navigateur'); }
    const sauter = ESSAI && process.env.PEGASE_PREMIER === 'non';
    if (sy.local.valeur.premierFait || sauter) {
      await montrer(multi ? 'connexion' : 'navigateur');
      // Connexion unique du poste en fond : si un autre programme d'Odin est connecté sur ce PC, Pégase le rejoint.
      if (!sauter) trouverOdin({ reseau: false }).then(async (t) => { if (t[0] && !sy.lien && (await sy.essayerSso(t[0])).ok) { this.apresConnexion(p); this.dire(p, 'Connecté à Odin par la connexion unique de ce PC.'); } }).catch(() => 0);
      return;
    }
    this.recherche = { trouves: [], encours: true };
    const t = await trouverOdin({ reseau: false }).catch(() => []);
    this.recherche.trouves = t;
    if (t[0] && (await sy.essayerSso(t[0])).ok) { this.recherche.encours = false; this.apresConnexion(p); await montrer('navigateur'); this.dire(p, 'Connecté à Odin par la connexion unique de ce PC : tout revient.'); return; }
    await montrer('odin');
    if (!t.length) this.chercherReseau();
    else { this.recherche.encours = false; this.planifierTout(); }
  }
  private chercherReseau(): void {
    this.recherche.encours = true; this.planifierTout();
    trouverOdin({ surTrouve: (x) => { if (!this.recherche.trouves.some((y) => y.adresse === x.adresse)) this.recherche.trouves.push(x); this.planifierTout(); } })
      .catch(() => []).finally(() => { this.recherche.encours = false; this.planifierTout(); });
  }
  private planifierTout(): void { for (const x of this.fenetres) x.planifier(); }
  private dire(p: ProfilOuvert, texte: string): void { for (const x of this.fenetres) if (x.profil === p) x.envoyer('message', texte); }

  /** Une fois relié : certificat d'Odin épinglé, DNS chiffré par Sphinx, signatures d'Asclépios. */
  private apresConnexion(p: ProfilOuvert): void {
    const sy = this.synchros.get(p); const l = sy?.lien; if (!sy || !l) return;
    try { const u = new URL(l.adresse); if (l.empreinte) certificatsEpingles.set(u.host, l.empreinte); } catch { /* */ }
    if (l.dns && l.adresse.startsWith('https:')) this.protection.reglerDns(l.adresse, p.reglages().dnsSecours).then(() => this.planifierTout()).catch(() => 0);
    sy.signatures(join(racineDonnees, 'signatures.json')).then((s) => { if (s) { this.protection.signatures = s; } }).catch(() => 0);
    this.planifierTout();
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
    if (!prive) {
      const sy = new Synchro(p);
      sy.surEtat = () => { for (const f of this.fenetres) if (f.profil === p) f.planifier(); };
      sy.surMessage = (t) => this.dire(p, t);
      this.synchros.set(p, sy);
      this.mdps.set(p, new MotsDePasse(p));
      if (ESSAI && process.env.PEGASE_PREMIER === 'non') sy.premierFait();
    }
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

  changerTheme(f: Fenetre, t: Theme | 'auto', parSysteme = false): void {
    // « Auto » : noir ou blanc selon le thème du système, et suit ses changements.
    if (t === 'auto') { f.profil.mettreReglage('themeAuto', true); t = nativeTheme.shouldUseDarkColors ? 'noir' : 'blanc'; }
    else if (!parSysteme) f.profil.mettreReglage('themeAuto', false);
    if (!['noir', 'blanc', 'bleu', 'rouge', 'transparent', 'glace'].includes(t)) return;
    f.profil.mettreReglage('theme', t);
    for (const x of this.fenetres) if (x.profil === f.profil) x.changerTheme(t);
  }

  etatGlobal(f: Fenetre): Partial<Etat> {
    const sy = this.synchros.get(f.profil); const l = sy?.lien;
    const odins = new Set([...this.synchros.values()].filter((x) => x.lien).map((x) => x.p.id));
    return {
      protection: this.protection.etat(f.profil),
      telechargements: this.protection.telechargements.liste(f.profil),
      synchro: sy ? sy.etat : { etat: 'local', attente: 0 },
      proposerMdp: (() => { const pr = this.mdps.get(f.profil)?.proposition; return pr && Date.now() - pr.quand < 5 * 60_000 ? { origine: pr.origine, identifiant: pr.identifiant, maj: !!pr.maj } as any : null; })(),
      odin: l ? { url: l.adresse, nom: l.profil ? `${l.nom} ${l.version}`.trim() : l.nom, connecte: true } : undefined,
      premier: f.ecran === 'navigateur' ? undefined : {
        trouves: this.recherche.trouves, recherche: this.recherche.encours,
        compte: this.compteEnAttente ? { nom: this.compteEnAttente.nom, email: this.compteEnAttente.email } : null,
        profilsPC: this.listeProfils().map((x) => ({ ...x, odin: odins.has(x.id) })),
      },
    };
  }

  /** Trouve l'Odin choisi (dans la liste, sinon en lui disant bonjour). */
  private async odinDe(adresse: string): Promise<OdinTrouve | null> {
    const t = this.recherche.trouves.find((x) => x.adresse === adresse); if (t) return t;
    try { const u = new URL(adresse); const b = await bonjour(u.hostname.replace(/^\[|\]$/g, ''), Number(u.port) || 7777); if (b) this.recherche.trouves.unshift(b); return b; } catch { return null; }
  }

  /** Ce qui touche à Odin (1er lancement, connexion, synchro, IA). */
  private async actionOdin(f: Fenetre, action: string, arg: any): Promise<{ fait: boolean; r?: unknown }> {
    const p = f.profil; const sy = this.synchros.get(p);
    const fini = (r?: unknown) => ({ fait: true, r });
    switch (action) {
      case 'odinChercher': {
        if (arg?.hote) {
          const b = await bonjour(String(arg.hote).trim(), Number(arg.port) || 7777);
          if (b) { this.recherche.trouves = [b, ...this.recherche.trouves.filter((x) => x.adresse !== b.adresse)]; this.planifierTout(); return fini({ ok: true, odin: b }); }
          return fini({ ok: false, texte: `Pas d'Odin à ${arg.hote}:${Number(arg.port) || 7777}. Vérifie l'adresse et que le PC d'Odin est allumé.` });
        }
        if (!this.recherche.encours) this.chercherReseau();
        return fini({ ok: true });
      }
      case 'odinConnecter': {
        if (!sy) return fini({ ok: false, texte: 'Une fenêtre privée ne se relie pas à Odin.' });
        const t = await this.odinDe(String(arg?.adresse ?? '')); if (!t) return fini({ ok: false, texte: 'Odin ne répond pas à cette adresse.' });
        const r = await sy.connecter(t, String(arg?.email ?? '').trim(), String(arg?.motdepasse ?? ''), arg?.code ? String(arg.code) : undefined);
        if (r.ok) { this.apresConnexion(p); f.ecran = 'navigateur'; f.planifier(); }
        return fini(r);
      }
      case 'odinIgnorer': f.ecran = 'compte'; f.planifier(); return fini();
      case 'ecranConnexion': f.ecran = arg?.ecran === 'odin' ? 'odin' : arg?.ecran === 'compte' ? 'compte' : 'navigateur'; if (f.ecran === 'odin' && !this.recherche.trouves.length && !this.recherche.encours) this.chercherReseau(); f.planifier(); return fini();
      case 'compteCreer': {
        const nom = String(arg?.nom ?? '').trim().slice(0, 60), email = String(arg?.email ?? '').trim().slice(0, 200), mdp = String(arg?.motdepasse ?? '');
        if (!nom) return fini({ ok: false, texte: 'Écris ton nom.' });
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fini({ ok: false, texte: 'Cette adresse e-mail n’a pas la bonne forme.' });
        if (mdp && mdp.length < 10) return fini({ ok: false, texte: 'Mot de passe : 10 caractères au moins.' });
        const pr = p.profil(); p.mettre('profil', { ...pr, nom, email: email || undefined, lettre: nom.slice(0, 1).toUpperCase() });
        this.ecrireListeProfils();
        if (mdp) sy?.retenirMotDePasse(mdp);
        this.compteEnAttente = { nom, email, motdepasse: mdp };
        f.ecran = 'sauvegarde'; f.planifier();
        if (!this.recherche.trouves.length && !this.recherche.encours) this.chercherReseau();
        return fini({ ok: true });
      }
      case 'compteIgnorer': case 'sauvegardeIgnorer': this.compteEnAttente = null; sy?.premierFait(); f.ecran = 'navigateur'; f.planifier(); return fini();
      case 'sauvegarder': { // créer la personne dans Odin (accord du propriétaire), puis tout envoyer
        const c = this.compteEnAttente; if (!sy || !c) return fini({ ok: false, texte: 'Recommence la création du compte.' });
        if (!c.email || !c.motdepasse) return fini({ ok: false, texte: 'Pour sauvegarder sur Odin, il faut une adresse e-mail et un mot de passe : reviens en arrière.' });
        const t = await this.odinDe(String(arg?.adresse ?? '')); if (!t) return fini({ ok: false, texte: 'Odin ne répond pas à cette adresse.' });
        const r = await sy.creerCompte(t, c.nom, c.email, c.motdepasse);
        if (!r.ok && r.codeErreur === 'existe_deja') { // déjà un compte : on essaie de s'y connecter avec le même mot de passe
          const k = await sy.connecter(t, c.email, c.motdepasse);
          if (k.ok) { this.compteEnAttente = null; this.apresConnexion(p); f.ecran = 'navigateur'; f.planifier(); return fini({ ok: true, etat: 'ok' }); }
          return fini({ ok: false, texte: 'Un compte Odin existe déjà avec cette adresse, avec un autre mot de passe : connecte-toi avec le tien (« Restaurer un profil depuis Odin »).' });
        }
        if (r.ok && r.etat === 'ok') { this.compteEnAttente = null; this.apresConnexion(p); f.ecran = 'navigateur'; f.planifier(); }
        return fini(r);
      }
      case 'sauvegardeEtat': {
        if (!sy) return fini({ ok: false });
        const t = await this.odinDe(String(arg?.adresse ?? '')); if (!t) return fini({ ok: false, etat: 'erreur', texte: 'Odin ne répond plus.' });
        const r = await sy.etatCompte(t, String(arg?.demande ?? ''));
        if (r.ok && r.etat === 'ok') { this.compteEnAttente = null; this.apresConnexion(p); f.ecran = 'navigateur'; f.planifier(); }
        return fini(r);
      }
      case 'choisirProfil': {
        const id = String(arg?.id ?? '');
        if (id === p.id) { f.ecran = 'navigateur'; f.planifier(); return fini(); }
        if (!this.listeProfils().some((x) => x.id === id)) return fini();
        const np = this.ouvrirProfil(id); const n = this.nouvelleFenetreDe(np); n.ecran = 'navigateur';
        void this.synchros.get(np)?.demarrer().then(() => this.apresConnexion(np));
        f.win.close(); return fini();
      }
      case 'deconnexion': await sy?.deconnecter(); this.planifierTout(); return fini(true);
      case 'synchroMaintenant': await sy?.verifier(); return fini(sy?.etat);
      case 'synchroInfos': {
        const taille = dossierTaille(p.opts.dossier);
        return fini({ lien: sy?.lien ? { adresse: sy.lien.adresse, nom: sy.lien.nom, version: sy.lien.version, mode: sy.lien.mode, profil: sy.lien.profil, derniere: sy.lien.derniere } : null, journal: sy?.local.valeur.journal ?? [], dossier: p.opts.dossier, taille, attente: sy?.etat.attente ?? 0 });
      }
      case 'ouvrirDossierProfil': shell.openPath(p.opts.dossier).catch(() => 0); return fini();
      case 'viderCache': await p.session.clearCache(); return fini(true);
      case 'odinCopies': return fini(sy?.lien ? await sy.copies().catch(() => []) : []);
      case 'odinRestaurer': return fini(sy?.lien ? await sy.restaurer(String(arg?.copie ?? '')) : 'Pas relié à Odin.');
      case 'odinMoi': return fini(sy?.lien ? await sy.moi().catch(() => null) : null);
      // Réglages → Plume (correcteur) : l'état, « Dans Pégase », et Réglages → Plume dans l'interface d'Odin.
      case 'plumeEtat': return fini(p.prive ? { prive: true } : sy?.lien ? { etat: await this.plume.etat(p) } : { relie: false });
      case 'plumeDansPegase': return fini(p.prive || !sy?.lien ? null : await this.plume.regler(p, { pegase: !!arg?.oui }));
      case 'plumeOuvrirOdin': return fini(this.plume.ouvrirReglages(p));
      case 'lienAgenda': return fini(sy?.lien ? await sy.lienAgenda(!!arg?.nouvelle).catch(() => null) : null);
      case 'voir': if (sy?.lien && ['tout', 'sans-historique', 'rien'].includes(arg?.v)) await sy.voir(arg.v).catch(() => false); return fini();
      case 'propositions': return fini(sy?.lien ? await sy.propositions() : []);
      case 'odinDemander': {
        if (!sy?.lien) return fini({ texte: 'Pégase n’est pas encore relié à ton Odin : Réglages → Synchro Odin.' });
        const id = arg?.onglet ? String(arg.onglet) : f.ongletCourant();
        const o = id ? p.onglet(id) : undefined; const wc = id ? p.vivants.get(id)?.vue?.webContents : undefined;
        let page: { url: string; titre: string; extrait: string } | undefined;
        if (o && wc && /^https?:/.test(o.url)) {
          // Le texte visible de la page, lu dans un monde isolé (la page ne peut pas le falsifier pour Pégase).
          const extrait = await wc.executeJavaScriptInIsolatedWorld(1002, [{ code: '(document.body ? document.body.innerText : "").slice(0, 20000)' }]).catch(() => '');
          page = { url: o.url, titre: o.titre, extrait: String(extrait ?? '') };
        }
        const texte = arg?.traduire ? 'Traduis cette page en français, sans rien ajouter.' : arg?.resumer ? 'Résume cette page en quelques points courts.' : arg?.verifier ? 'Vérifie ce site : est-il fiable ? Y a-t-il un risque d’arnaque ou de virus ?' : String(arg?.texte ?? '');
        if (arg?.verifier && o) { const a = await sy.adresse(o.url); if (a) return fini({ texte: `${a.texte}${a.verdict === 'sur' ? ' (Rien de connu ne veut pas dire « sûr à 100 % ».)' : ''}` }); }
        return fini({ texte: await sy.demander(texte, page) });
      }
      case 'controle': {
        if (!this.controleEnCours) this.controleEnCours = controler(this.protection, (cp, m) => { this.controleMdp = m ? { p: cp, m } : null; })
          .then((r) => { ecrireSur(join(racineDonnees, 'controle.json'), JSON.stringify(r)); return r; })
          .finally(() => { this.controleEnCours = null; });
        const r: any = await this.controleEnCours;
        const n = r.groupes.flatMap((g: any) => g.essais); const f = n.filter((x: any) => x.resultat === 'FAILLE').length;
        return fini({ texte: f ? `${f} faille(s) trouvée(s) : regarde le détail.` : `${n.filter((x: any) => x.resultat === 'bloqué').length} attaques bloquées sur ${n.length}.`, rapport: r });
      }
      case 'controleResultats': try { return fini(JSON.parse(readFileSync(join(racineDonnees, 'controle.json'), 'utf8'))); } catch { return fini(null); }
      case 'versions': return fini({ pegase: app.getVersion(), chromium: process.versions.chrome, electron: process.versions.electron });
      case 'miseAJour': return fini(await miseAJour());
      case 'navigateurDefaut': return fini(navigateurParDefaut());
      case 'verifierMdpOdin': return fini(sy ? sy.verifierMotDePasse(String(arg?.motdepasse ?? '')) : null);
    }
    return { fait: false };
  }

  async action(f: Fenetre, action: string, arg: any): Promise<any> {
    if (action === 'memoire') return this.memoire();
    if (action === 'dnsChange') { await this.protection.reglerDns(undefined, f.profil.reglages().dnsSecours); for (const x of this.fenetres) x.planifier(); return; }
    const fav = actionFavoris(f.profil, action, arg); if (fav.fait) return fav.r;
    const od = await this.actionOdin(f, action, arg); if (od.fait) return od.r;
    const pa = await actionsPages({ p: f.profil, sy: this.synchros.get(f.profil), mdp: this.mdps.get(f.profil), envoyer: (c, a) => f.envoyer(c, a), planifier: () => this.planifierTout() }, action, arg); if (pa.fait) return pa.r;
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
    if (![...this.fenetres].some((x) => x.profil === f.profil)) { this.synchros.get(f.profil)?.arreter(); this.synchros.delete(f.profil); f.profil.fermer(); this.profils.delete(f.profil.id); }
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

  quitter(): void { for (const s of this.synchros.values()) s.arreter(); for (const p of this.profils.values()) p.fermer(); }
}

/** Mises à jour : electron-updater lit les versions publiées sur GitHub (Releases du dépôt d'Odin). */
async function miseAJour(): Promise<string> {
  if (!app.isPackaged) return 'Version de développement : pas de mise à jour automatique.';
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = true;
    const r = await autoUpdater.checkForUpdates();
    const v = r?.updateInfo?.version;
    return v && v !== app.getVersion() ? `Pégase ${v} se télécharge : il s’installera quand tu fermeras Pégase.` : 'Pégase est à jour.';
  } catch (e) { return `Impossible de chercher une mise à jour (${String((e as Error).message ?? e).slice(0, 120)}).`; }
}
/** Pégase navigateur par défaut (Windows 10/11 demande de le choisir soi-même dans ses paramètres). */
function navigateurParDefaut(): string {
  const ok = ['http', 'https'].map((x) => app.setAsDefaultProtocolClient(x)).every(Boolean);
  if (process.platform === 'win32') { shell.openExternal('ms-settings:defaultapps').catch(() => 0); return 'Windows demande de choisir toi-même : dans « Applications par défaut », choisis Pégase pour le navigateur web.'; }
  return ok ? 'Pégase est maintenant ton navigateur par défaut.' : 'Ton système n’a pas accepté : choisis Pégase dans ses réglages d’applications par défaut.';
}

/** La place prise par un dossier (Mo), sans suivre les liens. */
function dossierTaille(d: string): number {
  let n = 0;
  const tour = (x: string, prof: number) => { if (prof > 6) return; let l: import('node:fs').Dirent[] = []; try { l = readdirSync(x, { withFileTypes: true }); } catch { return; } for (const e of l) { const c = join(x, e.name); if (e.isDirectory()) tour(c, prof + 1); else if (e.isFile()) { try { n += statSync(c).size; } catch { /* */ } } } };
  tour(d, 0);
  return Math.round(n / 1024 / 102.4) / 10;
}

const pegase = new Pegase();
if (ESSAI) (globalThis as any).__pegase = pegase; // pour les essais (Playwright évalue dans le processus principal)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
let vide = false;
app.on('before-quit', (e) => {
  // « Effacer en fermant Pégase » : cookies et données des sites effacés avant de partir (sauf les sites gardés).
  const l = [...pegase.profils.values()].filter((p) => p.reglages().viderFermeture && !p.prive);
  if (!vide && l.length) { e.preventDefault(); vide = true; Promise.race([Promise.all(l.map((p) => viderEnFermant(p))), new Promise((r) => setTimeout(r, 4000))]).finally(() => { pegase.quitter(); app.quit(); }); return; }
  pegase.quitter();
});
app.on('activate', () => { if (!BaseWindow.getAllWindows().length) pegase.nouvelleFenetre(false); });
app.whenReady().then(() => pegase.demarrer()).catch((e) => { console.error('Pégase n’a pas pu démarrer :', e); app.quit(); });
