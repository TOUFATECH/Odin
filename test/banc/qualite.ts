// Parcours de qualité de l'interface d'Odin, dans un vrai navigateur : débordements, éléments mal placés, texte
// recouvert ou illisible, onglets sur plusieurs lignes… et fluidité (temps d'ouverture, décalages, tâches longues,
// page qui se redessine toute seule, animations malgré « réduire les animations »).
//
//   node test/banc/qualite.ts --liste                                   les pages connues
//   node test/banc/qualite.ts --page appli:ullr --largeur 390           UNE page, une largeur (la commande à retenir)
//   node test/banc/qualite.ts --page aujourdhui,reglages --largeur 1280,390 --apparence mayotte
//   node test/banc/qualite.ts --tout --sortie /tmp/qualite              toutes les pages, toutes les largeurs
//   node test/banc/qualite.ts --ecrans --sortie /tmp/qualite            les grandes pages seulement ; --applis : la page de chaque appli
//   node test/banc/qualite.ts --fluidite --sortie /tmp/qualite          redessins automatiques et animations réduites
//   node test/banc/qualite.ts --rapport /tmp/qualite                    refait rapport.md et rapport.json du dossier
//   node test/banc/qualite.ts --url http://127.0.0.1:7790/ --cookie odin_session=… --js "window.OdinShow('home')"
//
// Options : --largeur 1440,1280,1024,768,390,360,320   --apparence sombre,clair,<thème>   --sortie <dossier>
//           --sans-capture   --onglets (ouvre aussi chaque onglet de la page)   --brut (sans regroupement)
//           --odin <dossier> : regarder l'interface d'une AUTRE copie du projet avec ce même outil
// Un vrai Odin de test est lancé pour l'occasion (compte créé, données de démonstration : `odin-plein.ts`).
// Un seul navigateur à la fois sur une petite machine : lance-le derrière `flock /tmp/odin-navigateur.lock`.

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { T, wait } from './lib.ts';
import { charger, ICI, odinPlein, type OdinPlein } from './odin-plein.ts';
import type { VraiOdin } from './odin-vrai.ts';
import { analyser, capturer, ligne, nettoyer, ORDRE, resume, TYPES, type Defaut, type Gravite, type Mesures, type OptionsDetection, type PageQ } from './debordements.ts';
import { animations, bougent, marquer, ouverture, pertes, poserSonde, redessin, type Ouverture, type Redessin } from './fluidite.ts';

// ------------------------------------------------------------------ Ce qu'il faut de Playwright (sans ses types)
interface Pg extends PageQ {
  goto(url: string, o?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  waitForSelector(sel: string, o?: { timeout?: number; state?: string }): Promise<unknown>;
  waitForFunction(js: string, arg?: unknown, o?: { timeout?: number }): Promise<unknown>;
  on(ev: string, fn: (x: { message?: string; text?(): string; type?(): string }) => void): void;
  route(url: string, fn: (r: { fulfill(o: { status?: number; contentType?: string; body: string }): Promise<void>; continue(): Promise<void>; request(): { url(): string } }) => unknown): Promise<void>;
  unroute(url: string): Promise<void>;
  close(): Promise<void>;
}
interface Ctx { newPage(): Promise<Pg>; addCookies(c: Array<Record<string, unknown>>): Promise<void>; addInitScript(js: string): Promise<void>; close(): Promise<void> }
interface Nav { newContext(o?: Record<string, unknown>): Promise<Ctx>; close(): Promise<void> }

// ------------------------------------------------------------------ Largeurs et apparences
export const LARGEURS: Record<number, number> = { 1440: 900, 1280: 800, 1024: 768, 768: 1024, 390: 844, 360: 740, 320: 568 };
/** « sombre » et « clair » : le thème d'origine (Valhalla) ; sinon l'identifiant d'un des thèmes de `src/web/themes.js`. */
export const APPARENCES = ['sombre', 'clair', 'mayotte', 'coucher', 'desert'];

// ------------------------------------------------------------------ Les pages
export interface Cible {
  id: string; titre: string;
  /** spa : dans l'interface, session ouverte · url : une adresse (session) · anonyme : sans session · neuf : un Odin sans compte · public : page publique */
  genre: 'spa' | 'url' | 'anonyme' | 'neuf' | 'public';
  /** Code lancé dans la page pour ouvrir l'écran (spa). */
  ouvrir?: string;
  url?: string;
  /** Sélecteur attendu avant de mesurer. */
  pret?: string;
  /** Les changements comptés pour « la page est stable » sont ceux sous cet élément. */
  racine?: string;
  /** Ouvre aussi chaque onglet trouvé sous ce sélecteur (un passage par onglet). */
  onglets?: string;
  /** … y compris ceux que la rangée ne montre pas pour l'instant (rubriques des Réglages). */
  ongletsCaches?: boolean;
  famille: 'ecran' | 'appli' | 'hors' | 'essai';
  /** Cette page montre exprès une notification : on ne la referme pas avant de mesurer. */
  bulle?: boolean;
  options?: OptionsDetection;
}
const spa = (id: string, titre: string, ouvrir: string, racine: string, extra: Partial<Cible> = {}): Cible => ({ id, titre, genre: 'spa', ouvrir, racine, pret: /^#v-[a-z]+$/.test(racine) ? `${racine}.on` : racine, famille: 'ecran', ...extra });
/** Une notification d'essai (bulle au-dessus de la mascotte) : que recouvre-t-elle sur cette page ? */
const BULLE = `window.OdinNotices.local({ title: 'Sauvegarde : le disque de sauvegarde est presque plein', detail: 'Il reste 14 Go sur le disque de sauvegarde.', level: 'souci', kind: 'Un souci' })`;
export const ECRANS: Cible[] = [
  spa('aujourdhui', 'Aujourd\'hui', `window.OdinShow('home')`, '#v-home'),
  spa('discussion', 'Discussion', `window.OdinShow('chat')`, '#v-chat'),
  spa('cerveau', 'Cerveau', `window.OdinShow('brain')`, '#v-brain'),
  spa('maison', 'Maison (réseau)', `window.OdinShow('net')`, '#v-net', { onglets: '#v-net .ntabs' }),
  spa('appareil', 'Fiche d\'un appareil', `window.OdinShow('net'); setTimeout(() => (document.querySelector('#v-net tr.clickable, #v-net .dev, #v-net [data-id]') || {}).click?.(), 400)`, '#v-net, #v-device'),
  spa('applis', 'Carte des applis', `window.OdinShow('apps')`, '#v-apps'),
  spa('reglages', 'Réglages', `window.OdinShow('settings')`, '#v-settings', { onglets: '#snav', ongletsCaches: true }),
  spa('evolutions', 'Évolutions', `window.OdinShow('home'); window.OdinEvolution.open()`, 'body'),
  spa('automatisations', 'Automatisations', `window.OdinShow('flows')`, '#v-flows'),
  spa('papyrus', 'Papyrus (bases)', `window.OdinShow('runes')`, '#v-runes'),
  spa('activite', 'Activité', `window.OdinShow('missions')`, '#v-missions'),
  spa('memoire', 'Mémoire', `window.OdinShow('memory')`, '#v-memory'),
  spa('competences', 'Compétences', `window.OdinShow('skills')`, '#v-skills'),
  spa('taches', 'Tâches planifiées', `window.OdinShow('jobs')`, '#v-jobs'),
  spa('decisions', 'Décisions', `window.OdinShow('audit')`, '#v-audit'),
  spa('palette', 'Chercher ou faire (Ctrl K)', `window.OdinShow('home'); document.querySelector('#palBtn').click()`, 'body'),
  spa('guide', 'Guide d\'Odin', `window.OdinShow('home'); window.OdinGuide.open()`, 'body', { options: { dessus: ['.guide'] } }),
  spa('menu', 'Menu ouvert (téléphone)', `window.OdinShow('home'); document.querySelector('#moreBtn').click()`, 'body', { options: { dessus: ['#sideNav'] } }),
  spa('visite', 'Visite guidée proposée au premier démarrage', `window.OdinTour.offer(true)`, 'body'),
  spa('bulle:aujourdhui', 'Notification sur Aujourd\'hui', `window.OdinShow('home'); ${BULLE}`, 'body', { bulle: true }),
  spa('bulle:discussion', 'Notification sur Discussion', `window.OdinShow('chat'); ${BULLE}`, 'body', { bulle: true }),
  spa('bulle:reglages', 'Notification sur Réglages', `window.OdinShow('settings'); ${BULLE}`, 'body', { bulle: true }),
  spa('bulle:applis', 'Notification sur la carte des applis', `window.OdinShow('apps'); ${BULLE}`, 'body', { bulle: true }),
  spa('bulle:appli', 'Notification sur la page d\'une appli', `void window.OdinApps.app('ullr').then(() => ${BULLE})`, 'body', { bulle: true }),
  spa('bulle:alchimie', 'Notification sur la page d\'Alchimie', `void window.OdinApps.app('dvalinn').then(() => ${BULLE})`, 'body', { bulle: true }),
  spa('bulle:cerveau', 'Notification sur le Cerveau', `window.OdinShow('brain'); ${BULLE}`, 'body', { bulle: true }),
  spa('bulle:maison', 'Notification sur Maison (réseau)', `window.OdinShow('net'); ${BULLE}`, 'body', { bulle: true }),
  spa('fenetre-odin', 'Petite fenêtre « Que veux-tu ? » (un toucher sur Odin)', `window.OdinShow('home'); window.OdinNotices.talk()`, 'body', { bulle: true, options: { dessus: ['#odinTalk'] } }),
  { id: 'ecran-maison', titre: 'Écran de la maison (/maison)', genre: 'url', url: '/maison', pret: 'body', famille: 'hors' },
  { id: 'recherche', titre: 'Recherche (/recherche)', genre: 'url', url: '/recherche', pret: 'body', famille: 'hors' },
  { id: 'connexion', titre: 'Connexion', genre: 'anonyme', url: '/', pret: '#login:not([hidden])', famille: 'hors' },
  { id: 'premier-demarrage', titre: 'Premier démarrage (code et QR code)', genre: 'neuf', url: '/', pret: '#login:not([hidden])', famille: 'hors' },
  { id: 'premier-demarrage:compte', titre: 'Premier démarrage (créer le compte ici)', genre: 'neuf', url: '/', pret: '#login:not([hidden])', ouvrir: `document.querySelector('#toForm')?.click()`, famille: 'hors' },
  { id: 'activer', titre: 'Première connexion depuis le téléphone (/activer)', genre: 'neuf', url: '/activer', pret: 'body', famille: 'hors' },
  { id: 'public:etat', titre: 'Page publique d\'état (Pulsar)', genre: 'public', url: 'etat', pret: 'body', famille: 'hors' },
  { id: 'public:reservation', titre: 'Page publique de réservation (Chronos)', genre: 'public', url: 'reservation', pret: 'body', famille: 'hors' },
  { id: 'public:formulaire', titre: 'Formulaire public (Talos)', genre: 'public', url: 'formulaire', pret: 'body', famille: 'hors' },
];
/** Les pages qu'on regarde quand rien n'est précisé. */
const CLES = ['aujourdhui', 'discussion', 'cerveau', 'maison', 'applis', 'reglages', 'appli:ullr', 'appli:dvalinn'];
const appli = (id: string, nom: string): Cible => ({ id: `appli:${id}`, titre: `Appli ${nom}`, genre: 'spa', ouvrir: `void window.OdinApps.app(${JSON.stringify(id)})`, racine: '#v-app', pret: '#v-app.on', onglets: '#v-app .body', famille: 'appli' });

/**
 * Une page d'essai pour les sections génériques des applis (tableau large, formulaire, cartes, journal, étapes…),
 * avec des libellés longs : elle montre ce que le dessin commun de `valhalla.js` supporte, quelles que soient les données.
 */
const LONG_MOT = 'sauvegarde-quotidienne-du-serveur-de-fichiers-du-bureau-de-mamoudzou.tar.zst', CHEMIN = '/home/awa/Documents/Comptabilite/2026/Factures/fournisseurs/electricite-de-mayotte/facture-janvier-2026-definitive.pdf';
export const VUE_ESSAI = {
  subtitle: '3 analyses en cours · 12 fichiers en quarantaine · dernière mise à jour des signatures il y a 2 heures et 14 minutes',
  kpis: [{ label: 'Fichiers analysés aujourd\'hui', value: '1 284 512' }, { label: 'En quarantaine', value: '12', tone: 'attention' }, { label: 'Signatures', value: 'version 2026.11.13-b' }, { label: 'Espace libre sur le disque de sauvegarde', value: '14,2 Go', pct: 8, tone: 'mauvais' }, { label: 'Dernière analyse', value: 'hier à 23 h 58' }],
  onglets: ['Analyser', 'Résultats', 'Règles', 'Réglages'],
  sections: [
    { kind: 'table', title: 'Tableau large (7 colonnes, actions par ligne)', columns: ['Fichier', 'Dossier', 'Menace', 'Trouvé le', 'Taille', 'Empreinte', 'État'], rows: [
      { cells: [LONG_MOT, CHEMIN, 'Cheval de Troie (Win32.Agent.Tesla)', '13/11/2026 18:02', '2,4 Mo', '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', 'en quarantaine'], tone: 'mauvais', actions: [{ label: 'Restaurer', action: 'etat' }, { label: 'Supprimer définitivement', action: 'etat' }, { label: 'Signaler une fausse alerte', action: 'etat' }] },
      { cells: ['photo.jpg', '/home/awa/Images', 'aucune', '12/11/2026 09:15', '812 Ko', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'sain'], tone: 'bon', actions: [{ label: 'Analyser de nouveau', action: 'etat' }] },
    ] },
    { kind: 'table', title: 'Tableau étroit (2 colonnes)', columns: ['Réglage', 'Valeur'], rows: [{ cells: ['Analyse planifiée', 'chaque nuit à 2 h'] }, { cells: ['Dossiers surveillés', '/home/awa/Téléchargements, /media/cle-usb-de-la-comptabilite'] }] },
    { kind: 'cards', title: 'Cartes', items: [
      { title: 'Société des Transports Maritimes de Mayotte et des Comores', sub: 'Client depuis le 12 janvier 2019', meta: 'madi.abdou-responsable-informatique@transports-maritimes.exemple.yt', badge: 'Mise à jour disponible', tone: 'attention', progress: 0.42, actions: [{ label: 'Mettre à jour maintenant', action: 'etat' }, { label: 'Plus tard', action: 'etat' }] },
      { title: 'NAS', sub: 'en ligne', badge: 'OK', tone: 'bon', actions: [{ label: 'Ouvrir', action: 'etat' }] },
      { title: LONG_MOT, sub: CHEMIN, tone: 'mauvais', actions: [{ label: 'Voir le détail de la sauvegarde', action: 'etat' }] },
    ] },
    { kind: 'list', title: 'Liste', items: [{ title: 'Le disque de sauvegarde est presque plein (97 %)', detail: `Plus gros fichier : ${CHEMIN}`, meta: 'il y a 3 minutes', tone: 'mauvais' }, { title: 'Tout va bien', detail: 'Aucune menace trouvée.' }] },
    { kind: 'log', title: 'Journal', lines: ['2026-11-13 18:02:11 analyse de ' + CHEMIN + ' : rien trouvé (empreinte 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08)', '2026-11-13 18:02:12 fin'] },
    { kind: 'text', title: 'Texte', text: `Un paragraphe d'explication avec un chemin sans espace ${CHEMIN} et une adresse https://exemple.yt/boutique/categorie/informatique/ordinateurs-portables/reference-ABCD-1234-EFGH-5678?couleur=gris.` },
    { kind: 'bars', title: 'Barres', items: [{ label: 'Documents de la comptabilité et des ressources humaines', value: 182, display: '182 Go' }, { label: 'Photos', value: 64, display: '64 Go' }, { label: LONG_MOT, value: 12, display: '12 Go (en baisse de 3 % ce mois-ci)' }] },
    { kind: 'courbe', title: 'Courbe', unit: 'Mo/s', labels: ['00 h', '04 h', '08 h', '12 h', '16 h', '20 h', '24 h'], series: [{ name: 'Envoi vers le serveur de sauvegarde', points: [1, 4, 12, 9, 22, 18, 6], tone: 'bon' }, { name: 'Réception', points: [2, 3, 5, 14, 9, 7, 3], tone: 'neutre' }] },
    { kind: 'form', title: 'Formulaire', action: 'etat', submit: 'Lancer l\'analyse complète de tous les dossiers', params: [
      { key: 'dossier', label: 'Dossier ou fichier à analyser (chemin complet sur la machine d\'Odin)', kind: 'text', required: true, help: 'Exemple : ' + CHEMIN },
      { key: 'mode', label: 'Mode', kind: 'select', options: ['rapide', 'complet (toutes les archives, plus lent sur un gros dossier)', 'personnalisé'], default: 'rapide' },
      { key: 'regles', label: 'Règles', kind: 'textarea', help: 'Une règle par ligne.' },
      { key: 'profondeur', label: 'Profondeur', kind: 'number', default: 5 },
      { key: 'secret', label: 'Mot de passe de l\'archive', kind: 'password' },
      { key: 'quarantaine', label: 'Mettre tout de suite en quarantaine ce qui est trouvé, sans me demander', kind: 'boolean', default: true },
      { key: 'fichier', label: 'Fichier', kind: 'text', depot: { plusieurs: true } },
    ] },
    { kind: 'steps', title: 'Étapes', items: [{ title: 'Choisir le poste à analyser sur le réseau', detail: 'Odin l\'a trouvé : PC-BUREAU-COMPTA-01 (192.168.1.50).', done: true }, { title: 'Donner le compte administrateur du poste', detail: 'Le mot de passe va dans le coffre et n\'est jamais affiché.', action: 'etat', button: 'Ouvrir le coffre des machines' }, { title: 'Lancer', detail: 'Environ 10 minutes.', action: 'etat', button: 'Analyser' }] },
  ],
  side: [{ kind: 'list', title: 'À côté', items: [{ title: 'Dernière mise à jour', detail: 'il y a 2 heures' }] }],
};

// ------------------------------------------------------------------ Résultats
export interface Passage { page: string; titre: string; famille: string; largeur: number; apparence: string; ouverture?: Ouverture; mesures?: Mesures; defauts: Defaut[]; erreurs: string[]; ms: number; redessin?: Redessin & { toutesLes?: number }; echec?: string }

const args = process.argv.slice(2);
const opt = (nom: string): string | undefined => { const i = args.indexOf(`--${nom}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined; };
const drapeau = (nom: string) => args.includes(`--${nom}`);
const liste = (v: string | undefined) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);
const slug = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60);

/** Attend que la mascotte et sa bulle soient posées (elles choisissent leur place après chaque changement de page). */
async function repos(page: Pg, max = 2600): Promise<void> {
  const js = `(() => [...document.querySelectorAll('#buddyRoam,#odinBubble,#odinTalk')].map((e) => { const r = e.getBoundingClientRect(); return Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width); }).join('|'))()`;
  let avant = await page.evaluate<string>(js), stable = 0; const t0 = Date.now();
  while (Date.now() - t0 < max) { await page.waitForTimeout(130); const a = await page.evaluate<string>(js); if (a === avant) { if (++stable >= 3) return; } else { stable = 0; avant = a; } }
}

interface Session { od: OdinPlein | undefined; neuf: VraiOdin | undefined; t: T; url: string; cookie: string; catalogue: Array<{ id: string; name: string }> }

/** Ouvre un contexte de navigateur à la largeur et dans l'apparence voulues. */
async function contexte(nav: Nav, largeur: number, apparence: string, o: { cookie?: string; url?: string; reduit?: boolean; visite?: boolean } = {}): Promise<Ctx> {
  const classique = apparence === 'sombre' || apparence === 'clair';
  const ctx = await nav.newContext({ viewport: { width: largeur, height: LARGEURS[largeur] ?? 800 }, deviceScaleFactor: 1, locale: 'fr-FR', colorScheme: apparence === 'clair' ? 'light' : 'dark', hasTouch: largeur <= 800, isMobile: largeur <= 480, reducedMotion: o.reduit ? 'reduce' : 'no-preference' });
  if (o.cookie && o.url) { const [name, ...v] = o.cookie.split('='); await ctx.addCookies([{ name, value: v.join('='), url: o.url, httpOnly: true, sameSite: 'Strict' }]); }
  // Le clair ou le sombre d'origine ; et la visite guidée du premier démarrage ne s'impose pas (elle a sa propre page : « visite »).
  await ctx.addInitScript(`try { localStorage.setItem('odin.theme', ${JSON.stringify(classique ? apparence : 'auto')}); if (!${JSON.stringify(Boolean(o.visite))}) localStorage.setItem('odin.tour', 'done'); } catch {}`);
  await poserSonde(ctx);
  return ctx;
}

/** Passe le détecteur sur la page telle qu'elle est, et capture les défauts les plus graves. */
async function mesurer(page: Pg, c: Cible, largeur: number, apparence: string, sortie: string | undefined, vus: Set<string>, o: { captures: boolean; brut: boolean; suffixe?: string }): Promise<{ defauts: Defaut[]; mesures: Mesures }> {
  const id = c.id + (o.suffixe ?? '');
  const r = await analyser(page, { ...c.options, regrouper: !o.brut });
  let n = 0;
  for (const d of r.defauts) {
    d.page = id; d.largeur = largeur; d.apparence = apparence;
    if (!sortie || !o.captures || d.gravite === 'info' || (d.gravite === 'mineur' && n >= 2) || n >= 8) continue;
    // Le même défaut (même page, même élément) n'est capturé qu'une fois par largeur ; d'une apparence à l'autre seulement s'il tient aux couleurs.
    const cle = `${id}|${d.type}|${d.selecteur}|${largeur}|${d.type === 'contraste' || d.type === 'sur-decor' ? apparence : ''}`;
    if (vus.has(cle)) continue; vus.add(cle);
    const f = join(sortie, 'captures', `${slug(id)}-${largeur}-${apparence}-${String(++n).padStart(2, '0')}-${d.type}.png`);
    try { if (await capturer(page, d, f)) d.capture = f; } catch { /* la page a changé pendant la capture : défaut gardé sans image */ }
  }
  await nettoyer(page);
  return r;
}

async function parcourir(nav: Nav, s: Session, cibles: Cible[], largeurs: number[], apparences: string[], sortie: string | undefined, o: { captures: boolean; brut: boolean; onglets: boolean }): Promise<Passage[]> {
  const tout: Passage[] = [], vus = new Set<string>();
  for (const apparence of apparences) {
    // Le thème est le même pour tous les écrans d'Odin : on le règle côté Odin.
    if (s.od) await s.od.json('/api/valhalla/act', { module: 'apparence', action: 'theme', input: { theme: apparence === 'sombre' || apparence === 'clair' ? 'valhalla' : apparence } });
    for (const largeur of largeurs) {
      const passages: Passage[] = [];
      const noter = (p: Passage) => { passages.push(p); tout.push(p); const g = p.defauts.filter((d) => d.gravite === 'grave').length; console.log(`${p.echec ? '✗' : g ? '!' : '·'} ${p.page.padEnd(34)} ${String(p.largeur).padStart(4)} ${p.apparence.padEnd(8)} ${p.echec ? p.echec : `${resume(p.defauts)}${p.ouverture ? ` · ouverte en ${p.ouverture.ms} ms${p.ouverture.decalage >= 0.05 ? `, décalage ${p.ouverture.decalage}` : ''}` : ''}`}`); };
      // --- L'interface (session ouverte) : une seule page de navigateur, on passe d'un écran à l'autre comme un utilisateur
      const dansSpa = cibles.filter((c) => c.genre === 'spa');
      if (dansSpa.length) {
        const ctx = await contexte(nav, largeur, apparence, { cookie: s.cookie, url: s.url }), page = await ctx.newPage(), erreurs: string[] = [];
        page.on('pageerror', (e) => erreurs.push(String(e.message ?? e)));
        try {
          await page.goto(s.url + '/'); await page.waitForSelector('#app:not([hidden])', { timeout: 20000 });
          await page.waitForFunction(`!!window.OdinApps && !!window.OdinShow && !!window.OdinThemes`, undefined, { timeout: 20000 });
          // Le thème voulu est-il bien en place ?
          const theme = apparence === 'sombre' || apparence === 'clair' ? '' : apparence;
          await page.evaluate(`window.OdinThemes.sync ? window.OdinThemes.sync() : 0`).catch(() => undefined);
          await page.waitForFunction(`(document.documentElement.dataset.odinTheme || '') === ${JSON.stringify(theme)}`, undefined, { timeout: 8000 }).catch(() => console.log(`  (le thème « ${apparence} » n'a pas pu être mis)`));
          await page.waitForTimeout(700);
          for (const c of dansSpa) {
            const t0 = Date.now(), avantErr = erreurs.length;
            try {
              if (c.id === 'essai:sections') await page.route('**/api/valhalla/view*', async (r) => { const u = new URL(r.request().url()); if (u.searchParams.get('id') !== 'ullr') return r.continue(); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'ullr', name: 'Page d\'essai des sections', family: 'Sécurité', what: 'Toutes les sortes de sections d\'une appli, avec des textes longs : ce que le dessin commun supporte, quelles que soient les données.', does: ['une fonction courte', 'une fonction décrite avec une phrase assez longue pour tenir sur deux lignes dans une colonne étroite'], story: 'Un nom d\'essai.', view: VUE_ESSAI, actions: [{ id: 'etat', label: 'État', what: 'État', params: [], read: true, grave: false, quick: true }, { id: 'analyser_tout', label: 'Analyser tous mes téléchargements maintenant', what: 'x', params: [], read: false, grave: true, quick: true }, { id: 'maj', label: 'Mettre à jour les signatures', what: 'x', params: [], read: false, grave: false, quick: true }, { id: 'autre', label: 'Analyser un dossier d\'un autre poste', what: 'Analyse sans rien installer.', params: [{ key: 'poste', label: 'Poste', kind: 'text', required: true }], read: false, grave: false, quick: false }], alerts: [{ id: 'a1', at: new Date().toISOString(), module: 'ullr', level: 'critique', title: 'Cheval de Troie trouvé dans ' + LONG_MOT, detail: CHEMIN, count: 3 }], links: [{ from: 'ullr', to: 'forseti', when: 'un fichier dangereux est trouvé', does: 'Forseti te prévient et garde la trace' }] }) }); });
              const m = await marquer(page, c.racine && c.racine !== 'body' && !c.racine.includes(',') ? c.racine : '');
              await page.evaluate(c.ouvrir!);
              if (c.pret && c.pret !== 'body') await page.waitForSelector(c.pret.split(',')[0].trim(), { timeout: 8000, state: 'attached' }).catch(() => undefined);
              const ouv = await ouverture(page, m, { calme: 350, max: 9000 });
              // Une notification arrivée toute seule fausserait la mesure de la page : elles ont leurs propres passages (« bulle:… »).
              if (!c.bulle) await page.evaluate(`window.OdinNotices?.closeTalk?.(true); window.OdinNotices?.hide?.()`).catch(() => undefined);
              // Odin a pu changer d'écran entre-temps (une réponse qui arrive…) : on revient sur le bon.
              if (c.pret && /\.on$/.test(c.pret) && !(await page.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(c.pret)})`))) { await page.evaluate(c.ouvrir!); await page.waitForTimeout(600); }
              // Odin se replace de lui-même toutes les 1,5 s si du contenu est apparu sous lui : on le lui demande tout de suite,
              // pour mesurer la page une fois qu'il est posé (ce qui reste couvert après ça est un vrai défaut de placement).
              await page.evaluate(`window.OdinCompanion?.sync?.('hopto')`).catch(() => undefined);
              await repos(page);
              if (!c.bulle) await page.evaluate(`window.OdinNotices?.hide?.()`).catch(() => undefined);
              const r = await mesurer(page, c, largeur, apparence, sortie, vus, o);
              noter({ page: c.id, titre: c.titre, famille: c.famille, largeur, apparence, ouverture: ouv, mesures: r.mesures, defauts: r.defauts, erreurs: erreurs.slice(avantErr), ms: Date.now() - t0 });
              // Chaque onglet de la page (rubriques des Réglages, vues de la Maison, onglets d'une appli dessinée à part).
              if (c.onglets && (o.onglets || c.famille === 'appli')) {
                const noms = await page.evaluate<string[]>(`[...new Set([...document.querySelectorAll(${JSON.stringify(c.onglets)} + ' [role=tab]')].filter((t) => (${JSON.stringify(Boolean(c.ongletsCaches))} || t.checkVisibility()) && t.getAttribute('aria-selected') !== 'true').map((t) => t.textContent.trim()))].slice(0, 40)`);
                for (const nom of noms) {
                  const t1 = Date.now(), m2 = await marquer(page, c.racine ?? '');
                  const ok = await page.evaluate<boolean>(`(() => { const t = [...document.querySelectorAll(${JSON.stringify(c.onglets)} + ' [role=tab]')].find((x) => x.textContent.trim() === ${JSON.stringify(nom)}); if (!t) return false; t.click(); return true; })()`);
                  if (!ok) continue;
                  const ouv2 = await ouverture(page, m2, { calme: 300, max: 6000 }); await repos(page, 1500);
                  if (!c.bulle) await page.evaluate(`window.OdinNotices?.hide?.()`).catch(() => undefined);
                  const r2 = await mesurer(page, c, largeur, apparence, sortie, vus, { ...o, suffixe: `:${slug(nom)}` });
                  noter({ page: `${c.id}:${slug(nom)}`, titre: `${c.titre} › ${nom}`, famille: c.famille, largeur, apparence, ouverture: ouv2, mesures: r2.mesures, defauts: r2.defauts, erreurs: [], ms: Date.now() - t1 });
                }
              }
              if (c.id === 'essai:sections') await page.unroute('**/api/valhalla/view*');
              // On referme ce que l'écran a ouvert par-dessus (palette, guide, menu, évolutions).
              if (c.bulle) await page.evaluate(`window.OdinNotices?.closeTalk?.(); window.OdinNotices?.hide?.()`).catch(() => undefined);
              if (['palette', 'guide', 'menu', 'evolutions', 'visite'].includes(c.id)) { await page.keyboard?.press('Escape'); await page.evaluate(`window.OdinEvolution?.close?.(); window.OdinGuide?.close?.(); document.querySelector('#scrim:not([hidden])')?.click()`).catch(() => undefined); await page.waitForTimeout(250); }
            } catch (e) { noter({ page: c.id, titre: c.titre, famille: c.famille, largeur, apparence, defauts: [], erreurs: erreurs.slice(avantErr), ms: Date.now() - t0, echec: `non mesurée : ${(e as Error).message.split('\n')[0].slice(0, 160)}` }); }
          }
        } finally { await ctx.close(); }
      }
      // --- Les pages à part : une adresse chacune (avec ou sans session, Odin sans compte, pages publiques)
      for (const c of cibles.filter((x) => x.genre !== 'spa')) {
        const t0 = Date.now();
        const base = c.genre === 'neuf' ? s.neuf?.url : s.url, chemin = c.genre === 'public' ? s.od?.publics[c.url as 'etat' | 'reservation' | 'formulaire'] : c.url;
        if (!base || !chemin) { noter({ page: c.id, titre: c.titre, famille: c.famille, largeur, apparence, defauts: [], erreurs: [], ms: 0, echec: 'non préparée sur cet Odin de test' }); continue; }
        const ctx = await contexte(nav, largeur, apparence, c.genre === 'url' ? { cookie: s.cookie, url: s.url } : {}), page = await ctx.newPage(), erreurs: string[] = [];
        page.on('pageerror', (e) => erreurs.push(String(e.message ?? e)));
        try {
          const m0 = Date.now();
          await page.goto(base + chemin, { waitUntil: 'load', timeout: 20000 });
          if (c.pret) await page.waitForSelector(c.pret, { timeout: 10000 }).catch(() => undefined);
          const m = await marquer(page, '');
          if (c.ouvrir) await page.evaluate(c.ouvrir);
          const ouv = await ouverture(page, m, { calme: 400, max: 8000 }); ouv.ms += Date.now() - m0 - ouv.ms > 0 ? 0 : 0;
          await page.waitForTimeout(400);
          const r = await mesurer(page, c, largeur, apparence, sortie, vus, o);
          noter({ page: c.id, titre: c.titre, famille: c.famille, largeur, apparence, ouverture: { ...ouv, ms: Date.now() - m0 - 400 }, mesures: r.mesures, defauts: r.defauts, erreurs, ms: Date.now() - t0 });
        } catch (e) { noter({ page: c.id, titre: c.titre, famille: c.famille, largeur, apparence, defauts: [], erreurs, ms: Date.now() - t0, echec: `non mesurée : ${(e as Error).message.split('\n')[0].slice(0, 160)}` }); }
        finally { await ctx.close(); }
      }
      if (sortie) { mkdirSync(sortie, { recursive: true }); const f = join(sortie, `passages-${apparence}-${largeur}.json`); const deja: Passage[] = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as Passage[] : []; const ids = new Set(passages.map((p) => p.page)); writeFileSync(f, JSON.stringify([...deja.filter((p) => !ids.has(p.page)), ...passages], null, 1)); }
    }
  }
  return tout;
}

/** Fluidité : les pages qui se redessinent toutes seules, et ce qui bouge encore quand on a demandé moins d'animations. */
async function fluidite(nav: Nav, s: Session, cibles: Cible[], sortie: string | undefined): Promise<void> {
  const out: Record<string, unknown> = { date: new Date().toISOString(), redessins: [] as unknown[], animations: [] as unknown[] };
  // 1. Pages d'applis qui se redessinent (refreshMs) : on pose des témoins et on regarde deux tours.
  const avecRefresh: Array<{ id: string; ms: number }> = [];
  for (const c of cibles.filter((x) => x.famille === 'appli')) { const id = c.id.slice(6); const r = await s.od!.json(`/api/valhalla/view?id=${encodeURIComponent(id)}`); const ms = Number((r.body.view as { refreshMs?: number } | undefined)?.refreshMs ?? 0); if (ms > 0) avecRefresh.push({ id, ms }); }
  console.log(`Pages qui se redessinent toutes seules : ${avecRefresh.map((x) => `${x.id} (${x.ms} ms)`).join(', ') || 'aucune'}`);
  for (const largeur of [1280, 390]) {
    const ctx = await contexte(nav, largeur, 'sombre', { cookie: s.cookie, url: s.url }), page = await ctx.newPage();
    try {
      await page.goto(s.url + '/'); await page.waitForSelector('#app:not([hidden])', { timeout: 20000 }); await page.waitForFunction(`!!window.OdinApps`, undefined, { timeout: 20000 }); await page.waitForTimeout(800);
      for (const a of avecRefresh) {
        const m = await marquer(page, '#v-app'); await page.evaluate(`void window.OdinApps.app(${JSON.stringify(a.id)})`); await ouverture(page, m, { calme: 300, max: 6000 });
        const duree = Math.min(12000, Math.max(800, a.ms) * 2 + 1500), r = await redessin(page, '#v-app .body', duree);
        if (!r) continue;
        const p = pertes(r);
        console.log(`${p.length ? '!' : '·'} ${a.id.padEnd(16)} ${String(largeur).padStart(4)} : ${r.redessins} redessin(s) en ${duree} ms, ${r.retires} éléments retirés / ${r.ajoutes} ajoutés${p.length ? ' → ' + p.join(' ; ') : ''}`);
        (out.redessins as unknown[]).push({ appli: a.id, largeur, toutesLes: a.ms, observe: duree, ...r, pertes: p });
        await page.evaluate(`window.OdinShow('home')`); await page.waitForTimeout(300);
      }
    } finally { await ctx.close(); }
  }
  // 2. « Réduire les animations » demandé : qu'est-ce qui tourne ou bouge encore ?
  for (const largeur of [1280, 390]) for (const reduit of [true, false]) {
    const ctx = await contexte(nav, largeur, 'sombre', { cookie: s.cookie, url: s.url, reduit }), page = await ctx.newPage();
    try {
      await page.goto(s.url + '/'); await page.waitForSelector('#app:not([hidden])', { timeout: 20000 }); await page.waitForFunction(`!!window.OdinApps`, undefined, { timeout: 20000 }); await page.waitForTimeout(1200);
      for (const c of cibles.filter((x) => x.genre === 'spa' && ['aujourdhui', 'discussion', 'cerveau', 'maison', 'applis', 'reglages', 'appli:ullr'].includes(x.id))) {
        await page.evaluate(c.ouvrir!); await page.waitForTimeout(1500);
        const an = (await animations(page)).filter((a) => a.visible), bg = await bougent(page, 1500);
        const sansFin = an.filter((a) => a.infinie);
        console.log(`${reduit && (sansFin.length || bg.length) ? '!' : '·'} ${c.id.padEnd(16)} ${String(largeur).padStart(4)} ${reduit ? 'animations réduites' : 'animations normales'} : ${an.length} animation(s) en cours dont ${sansFin.length} sans fin ; ${bg.length} élément(s) qui bougent${reduit && sansFin.length ? ' → ' + [...new Set(sansFin.map((a) => `${a.nom} (${a.sel})`))].slice(0, 6).join(', ') : ''}`);
        (out.animations as unknown[]).push({ page: c.id, largeur, reduit, enCours: an.length, sansFin: sansFin.map((a) => ({ nom: a.nom, sel: a.sel, bouge: a.bouge, duree: a.duree })), bougent: bg });
      }
    } finally { await ctx.close(); }
  }
  if (sortie) { mkdirSync(sortie, { recursive: true }); writeFileSync(join(sortie, 'fluidite.json'), JSON.stringify(out, null, 1)); }
}

// ------------------------------------------------------------------ Rapport
interface Ligne { cle: string; type: string; gravite: Gravite; selecteur: string; mesure: string; texte: string; pages: Set<string>; largeurs: Set<number>; apparences: Set<string>; capture?: string; n: number; exemple: Defaut; valeurs: Record<string, unknown> }
/** Le fichier de l'interface d'où vient un élément, d'après son sélecteur (pour savoir qui peut le corriger). */
export function origine(d: Defaut): string {
  const s = `${d.selecteur} ${d.dessous ?? ''} ${String(d.valeurs?.par ?? '')} ${String(d.valeurs?.boite ?? '')}`;
  if (/#odinBubble|#odinTalk|#odinAdvice|\.ob-|\.ot-|\.oa-/.test(s)) return 'notices.js';
  if (/\.odin-app-ic/.test(d.selecteur)) return 'app-icons.js';
  if (/#buddyRoam|\.odin\.roam|span\.odin(?![\w-])/.test(d.selecteur)) return 'companion.js';
  if (/\.fe-|#fenetre/.test(s)) return 'fenetre.js';
  if (/\.sv-/.test(s)) return 'pages/svalinn.js'; if (/\.ym-|\.ym\b/.test(s)) return 'pages/ymir.js'; if (/\.ur-/.test(s)) return 'pages/urdr.js'; if (/\.tj-/.test(s)) return 'pages/thjalfi.js'; if (/\.rd-/.test(s)) return 'pages/rodd.js'; if (/\.ng-|\.nf-/.test(s)) return 'pages/naglfar.js';
  if (/\.va-|#v-app\b|#v-apps\b|#vaTitle|#vaSub/.test(s)) return 'valhalla.js';
  if (/\.og-|\.gr-/.test(s)) return 'graph.js'; if (/\.br-|#v-brain/.test(s)) return 'brain.js'; if (/\.pk-/.test(s)) return 'packets.js'; if (/\.ev-/.test(s)) return 'evolution.js'; if (/\.gd-/.test(s)) return 'guide.js'; if (/\.rn-|#v-runes/.test(s)) return 'runes.js'; if (/\.fl-|#v-flows/.test(s)) return 'flows.js'; if (/#themeGrid/.test(s)) return 'themes.js';
  return d.page && /^(ecran-maison)/.test(d.page) ? 'maison.js' : d.page && /^recherche/.test(d.page) ? 'recherche.js' : d.page && /^(public|activer)/.test(d.page) ? 'page publique (serveur)' : 'ui.html';
}
function regrouper(passages: Passage[]): Ligne[] {
  const par = new Map<string, Ligne>();
  for (const p of passages) for (const d of p.defauts) {
    // Le même défaut sur plusieurs pages (même élément commun : barre, mascotte, bouton) ne fait qu'une ligne.
    const commun = /^(sous-fixe|cible-tactile|contraste|focus-invisible|texte-tronque)$/.test(d.type) || !/#v-app|\.va-/.test(d.selecteur) && p.famille !== 'appli';
    const cle = `${d.type}|${d.type === 'contraste' ? d.groupe : d.selecteur}|${commun ? '' : p.page.split(':').slice(0, 2).join(':')}`;
    let l = par.get(cle);
    if (!l) { l = { cle, type: d.type, gravite: d.gravite, selecteur: d.selecteur, mesure: d.mesure, texte: d.texte, pages: new Set(), largeurs: new Set(), apparences: new Set(), n: 0, exemple: d, valeurs: d.valeurs }; par.set(cle, l); }
    l.pages.add(p.page); l.largeurs.add(p.largeur); l.apparences.add(p.apparence); l.n += d.n ?? 1;
    if (ORDRE[d.gravite] < ORDRE[l.gravite] || (d.gravite === l.gravite && Number(d.valeurs?.px ?? 0) > Number(l.valeurs?.px ?? 0))) { l.gravite = d.gravite; l.mesure = d.mesure; l.exemple = d; l.valeurs = d.valeurs; l.texte = d.texte; }
    if (d.capture && (!l.capture || d === l.exemple)) l.capture = d.capture;
  }
  return [...par.values()].sort((a, b) => ORDRE[a.gravite] - ORDRE[b.gravite] || b.pages.size - a.pages.size || a.type.localeCompare(b.type));
}
const plage = (s: Set<number>) => [...s].sort((a, b) => b - a).join(', ');
export function rapport(dossier: string): { md: string; lignes: Ligne[]; passages: Passage[] } {
  const passages: Passage[] = [];
  for (const f of readdirSync(dossier).filter((x) => /^passages-.*\.json$/.test(x)).sort()) passages.push(...JSON.parse(readFileSync(join(dossier, f), 'utf8')) as Passage[]);
  const lignes = regrouper(passages), n = (g: Gravite) => lignes.filter((l) => l.gravite === g).length;
  const pages = new Set(passages.map((p) => p.page)), largeurs = new Set(passages.map((p) => p.largeur)), apparences = new Set(passages.map((p) => p.apparence));
  const L: string[] = [];
  L.push('# Odin : qualité de l\'interface (graphisme, placement, fluidité)', '', `Mesuré dans un vrai navigateur (Chromium) sur un Odin de test rempli de données de démonstration.`, '',
    `- ${passages.length} passages : ${pages.size} pages × largeurs ${plage(largeurs)} px × apparences ${[...apparences].join(', ')}`,
    `- ${lignes.length} défauts distincts : **${n('grave')} graves**, ${n('moyen')} moyens, ${n('mineur')} mineurs, ${n('info')} simples signalements`,
    `- ${passages.filter((p) => p.echec).length} page(s) non mesurée(s)`, '');
  const bloc = (titre: string, ls: Ligne[], max = 400) => {
    if (!ls.length) return;
    L.push(`## ${titre}`, '', '| Défaut | Où | Largeurs | Mesure | Fichier | Capture |', '|---|---|---|---|---|---|');
    for (const l of ls.slice(0, max)) { const pg = [...l.pages]; L.push(`| ${TYPES[l.type] ?? l.type} | ${pg.length > 3 ? `${pg.length} pages (${pg.slice(0, 3).join(', ')}…)` : pg.join(', ')}<br>\`${l.selecteur.replace(/\|/g, '\\|')}\` | ${plage(l.largeurs)}${l.apparences.size < apparences.size ? `<br>${[...l.apparences].join(', ')}` : ''} | ${l.mesure.replace(/\|/g, '\\|')}${l.n > l.pages.size * l.largeurs.size * l.apparences.size ? ` (×${l.n})` : ''} | ${origine({ ...l.exemple, page: pg[0] })} | ${l.capture ?? ''} |`); }
    if (ls.length > max) L.push('', `… et ${ls.length - max} autres (voir rapport.json).`);
    L.push('');
  };
  bloc('Défauts graves', lignes.filter((l) => l.gravite === 'grave'));
  bloc('Défauts moyens', lignes.filter((l) => l.gravite === 'moyen'));
  bloc('Défauts mineurs', lignes.filter((l) => l.gravite === 'mineur'), 150);
  bloc('Simples signalements', lignes.filter((l) => l.gravite === 'info'), 60);
  // Fluidité : ouverture des pages
  const ouv = passages.filter((p) => p.ouverture && !p.echec);
  if (ouv.length) {
    const parPage = new Map<string, Passage[]>(); for (const p of ouv) parPage.set(p.page, [...(parPage.get(p.page) ?? []), p]);
    const med = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
    const lignesO = [...parPage].map(([page, ps]) => ({ page, ms: med(ps.map((p) => p.ouverture!.ms)), max: Math.max(...ps.map((p) => p.ouverture!.ms)), decalage: Math.max(...ps.map((p) => p.ouverture!.decalage)), sources: ps.sort((a, b) => b.ouverture!.decalage - a.ouverture!.decalage)[0].ouverture!.sources, longue: Math.max(...ps.map((p) => p.ouverture!.longueMax)), expire: ps.some((p) => p.ouverture!.expire) }));
    L.push('## Fluidité : ouverture des pages', '', 'Temps entre l\'ouverture et le dernier changement de la page (requêtes finies). Décalage : somme des sauts de mise en page (au-delà de 0,1, ça se voit). Machine de test petite et partagée : les temps sont indicatifs, les écarts entre pages comptent plus que les valeurs.', '', '| Page | Ouverture (médiane) | Pire | Décalage de mise en page | Ce qui saute | Plus longue tâche |', '|---|---|---|---|---|---|');
    for (const o of lignesO.sort((a, b) => b.ms - a.ms).slice(0, 25)) L.push(`| ${o.page} | ${o.ms} ms${o.expire ? ' (bouge encore)' : ''} | ${o.max} ms | ${o.decalage} | ${o.sources.join(', ')} | ${o.longue} ms |`);
    L.push('', '### Pages dont la mise en page saute le plus', '', '| Page | Décalage | Ce qui saute |', '|---|---|---|');
    for (const o of lignesO.filter((x) => x.decalage >= 0.05).sort((a, b) => b.decalage - a.decalage).slice(0, 25)) L.push(`| ${o.page} | ${o.decalage} | ${o.sources.join(', ')} |`);
    L.push('');
  }
  if (existsSync(join(dossier, 'fluidite.json'))) {
    const f = JSON.parse(readFileSync(join(dossier, 'fluidite.json'), 'utf8')) as { redessins: Array<Redessin & { appli: string; largeur: number; toutesLes: number; observe: number; pertes: string[] }>; animations: Array<{ page: string; largeur: number; reduit: boolean; enCours: number; sansFin: Array<{ nom: string; sel: string; bouge: boolean }>; bougent: Array<{ sel: string; px: number }> }> };
    L.push('## Fluidité : pages qui se redessinent toutes seules', '', '| Appli | Largeur | Toutes les | Redessins observés | Éléments recréés | Ce que tu y perds |', '|---|---|---|---|---|---|');
    for (const r of f.redessins) L.push(`| ${r.appli} | ${r.largeur} | ${r.toutesLes} ms | ${r.redessins} en ${r.observe} ms | ${r.ajoutes} | ${r.pertes.join(' ; ') || 'rien'} |`);
    L.push('', '## Fluidité : « réduire les animations »', '', '| Page | Largeur | Réglage | Animations sans fin encore en cours | Éléments qui bougent |', '|---|---|---|---|---|');
    for (const a of f.animations) L.push(`| ${a.page} | ${a.largeur} | ${a.reduit ? 'réduites' : 'normales'} | ${a.sansFin.length ? [...new Set(a.sansFin.map((x) => `${x.nom} (${x.sel})`))].slice(0, 8).join(', ') : 'aucune'} | ${a.bougent.map((b) => `${b.sel} (${b.px} px)`).slice(0, 5).join(', ') || 'aucun'} |`);
    L.push('');
  }
  const echecs = passages.filter((p) => p.echec);
  if (echecs.length) { L.push('## Pages non mesurées', ''); for (const e of echecs) L.push(`- ${e.page} (${e.largeur}, ${e.apparence}) : ${e.echec}`); L.push(''); }
  const erreurs = passages.filter((p) => p.erreurs.length);
  if (erreurs.length) { L.push('## Erreurs de script vues pendant le parcours', ''); for (const e of [...new Map(erreurs.map((p) => [p.page + p.erreurs[0], p])).values()].slice(0, 40)) L.push(`- ${e.page} : ${e.erreurs[0].slice(0, 200)}`); L.push(''); }
  return { md: L.join('\n'), lignes, passages };
}

/** Écrit rapport.md (les notes écrites à la main, `notes.md`, viennent en tête ; puis les mesures) et rapport.json. */
function ecrireRapport(d: string): ReturnType<typeof rapport> {
  const r = rapport(d), notes = existsSync(join(d, 'notes.md')) ? readFileSync(join(d, 'notes.md'), 'utf8').trimEnd() + '\n\n---\n\n' : '';
  writeFileSync(join(d, 'rapport.md'), notes + r.md);
  writeFileSync(join(d, 'rapport.json'), JSON.stringify({ date: new Date().toISOString(), defauts: r.lignes.map((l) => ({ type: l.type, nom: TYPES[l.type] ?? l.type, gravite: l.gravite, selecteur: l.selecteur, mesure: l.mesure, texte: l.texte, pages: [...l.pages], largeurs: [...l.largeurs].sort((a, b) => b - a), apparences: [...l.apparences], fichier: origine({ ...l.exemple, page: [...l.pages][0] }), capture: l.capture, valeurs: l.valeurs, fois: l.n })), passages: r.passages.map((p) => ({ page: p.page, largeur: p.largeur, apparence: p.apparence, ouverture: p.ouverture, mesures: p.mesures, defauts: p.defauts.length, echec: p.echec })) }, null, 1));
  return r;
}

// ------------------------------------------------------------------ Lancement
async function main(): Promise<void> {
  if (opt('rapport')) {
    const d = opt('rapport')!, r = ecrireRapport(d);
    console.log(`Rapport écrit : ${join(d, 'rapport.md')} (${r.lignes.length} défauts distincts, ${r.passages.length} passages)`); return;
  }
  const pw = createRequire(import.meta.url)('playwright') as { chromium: { launch(o?: Record<string, unknown>): Promise<Nav> } };
  const sortie = opt('sortie'), captures = !drapeau('sans-capture'), brut = drapeau('brut');
  const largeurs = liste(opt('largeur')).map(Number).filter((n) => n >= 240) as number[];
  const apparences = liste(opt('apparence'));
  // Une adresse quelconque (un Odin déjà lancé, une autre page) : pas d'Odin de test.
  if (opt('url')) {
    const nav = await pw.chromium.launch(), url = opt('url')!, vus = new Set<string>(); let graves = 0;
    try {
      for (const largeur of largeurs.length ? largeurs : [1280, 390]) {
        const ctx = await contexte(nav, largeur, apparences[0] ?? 'sombre', { cookie: opt('cookie'), url }), page = await ctx.newPage();
        await page.goto(url, { waitUntil: 'load', timeout: 30000 }); await page.waitForTimeout(800);
        if (opt('js')) { await page.evaluate(opt('js')!); await page.waitForTimeout(1500); }
        const r = await mesurer(page, { id: slug(new URL(url).pathname) || 'page', titre: url, genre: 'url', famille: 'hors' }, largeur, apparences[0] ?? 'sombre', sortie, vus, { captures, brut });
        console.log(`\n${url} à ${largeur} px : ${resume(r.defauts)}`); for (const d of r.defauts) console.log(`  ${ligne(d)}${d.capture ? `\n      capture : ${d.capture}` : ''}`);
        graves += r.defauts.filter((d) => d.gravite === 'grave').length; await ctx.close();
      }
    } finally { await nav.close(); }
    process.exit(graves ? 1 : 0);
  }
  const t = new T();
  let code = 0;
  try {
    // L'Odin regardé : celui de cette copie, ou celui d'une autre copie du projet (--odin <dossier>), avec ce même outil.
    const racine = opt('odin') ? resolve(opt('odin')!) : ICI;
    if (racine !== ICI) console.log(`Odin regardé : ${racine}`);
    const od = await odinPlein(t, { racine });
    if (od.manques.length) console.log(`Données de démonstration incomplètes : ${od.manques.join(' ; ')}`);
    const cat = await od.json('/api/valhalla/catalog'), catalogue = ((cat.body.modules as Array<{ id: string; name: string }> | undefined) ?? []).map((m) => ({ id: m.id, name: m.name })).sort((a, b) => a.id.localeCompare(b.id));
    const toutes: Cible[] = [...ECRANS, ...catalogue.map((m) => appli(m.id, m.name)), { ...appli('ullr', 'essai'), id: 'essai:sections', titre: 'Page d\'essai des sections génériques', famille: 'essai', onglets: undefined }];
    if (drapeau('liste')) { for (const c of toutes) console.log(`${c.id.padEnd(30)} ${c.titre}`); console.log(`\nLargeurs : ${Object.keys(LARGEURS).join(', ')}   Apparences : ${APPARENCES.join(', ')} (ou tout thème de src/web/themes.js)`); return; }
    const voulues = liste(opt('page'));
    // --ecrans : les grandes pages, les pages à part et les notifications ; --applis : la page de chaque appli ; --tout : les deux.
    const cibles = drapeau('tout') ? toutes : drapeau('ecrans') ? toutes.filter((c) => c.famille === 'ecran' || c.famille === 'hors') : drapeau('applis') ? toutes.filter((c) => c.famille === 'appli' || c.famille === 'essai') : voulues.length ? voulues.flatMap((v) => { const f = v.endsWith('*') ? toutes.filter((c) => c.id.startsWith(v.slice(0, -1))) : toutes.filter((c) => c.id === v); if (!f.length) console.log(`Page inconnue : ${v} (voir --liste)`); return f; }) : toutes.filter((c) => CLES.includes(c.id));
    if (!cibles.length) { code = 2; return; }
    const neuf = cibles.some((c) => c.genre === 'neuf') ? await (await charger<typeof import('./odin-vrai.ts')>(racine, 'test/banc/odin-vrai.ts')).vraiOdin(t, { valhalla: false }) : undefined;
    const s: Session = { od, neuf, t, url: od.url, cookie: od.session, catalogue };
    const nav = await pw.chromium.launch(); t.onEnd(() => nav.close());
    const t0 = Date.now();
    if (drapeau('fluidite')) await fluidite(nav, s, cibles.some((c) => c.famille === 'appli') && (voulues.length || drapeau('tout')) ? cibles : toutes, sortie);
    else {
      const large = drapeau('tout') || drapeau('ecrans') || drapeau('applis');
      const ps = await parcourir(nav, s, cibles, largeurs.length ? largeurs : large ? Object.keys(LARGEURS).map(Number).sort((a, b) => b - a) : [1280, 390], apparences.length ? apparences : ['sombre'], sortie, { captures, brut, onglets: drapeau('onglets') || large });
      const tous = ps.flatMap((p) => p.defauts);
      console.log(`\n${ps.length} passage(s) en ${Math.round((Date.now() - t0) / 1000)} s : ${resume(tous)}`);
      if (ps.length <= 12) for (const p of ps) { console.log(`\n${p.titre} — ${p.largeur} px, ${p.apparence}`); for (const d of p.defauts) console.log(`  ${ligne(d)}${d.capture ? `\n      capture : ${d.capture}` : ''}`); }
      if (sortie) { ecrireRapport(sortie); console.log(`\nRapport : ${join(sortie, 'rapport.md')}`); }
      code = tous.some((d) => d.gravite === 'grave') ? 1 : 0;
    }
  } finally { await t.end(); await wait(50); }
  process.exit(code);
}
if (import.meta.url === `file://${process.argv[1]}`) void main().catch((e) => { console.error(e); process.exit(2); });
