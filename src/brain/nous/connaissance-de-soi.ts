// Noûs — LA CONNAISSANCE DE SOI : les FICHES qu'Odin sait de lui-même, fabriquées à partir de ce qu'il EST.
//
// Le propriétaire l'a demandé (17/11) : qu'Odin comprenne son infrastructure, son interface, son modèle et son
// acquisition. Rien n'est écrit à la main ici qui puisse devenir faux : chaque fiche est tirée d'une structure réelle
// (le code de l'interface, la liste des applis, la configuration, l'état de Noûs, les réglages et le journal de
// Mathésis, l'inventaire, docs/etat.json). Si l'interface change, les fiches changent.
//
// Quatre familles :
//   - infrastructure : la machine, le port de l'interface et ceux des applis, les dossiers, la sauvegarde, la
//                      surveillance, les services réparés, les appareils de l'inventaire ;
//   - interface      : chaque page (menu de gauche), chaque onglet (rubriques des réglages, volets du Cerveau, applis),
//                      chaque réglage (son libellé, où il se trouve), chaque action d'appli (comment la faire) ;
//   - modele         : Soul (Noûs) et Brain, leur taille, l'entraînement, ce qu'il sait faire ou pas encore, l'état
//                      de chaque chose d'Odin (docs/etat.json) ;
//   - acquisition    : Mathésis (réglages, journal, sites absorbés), le premier corpus, ce qu'il retient et oublie.
//
// Une fiche : { id, famille, sujet, texte court et vrai, ou (page, onglet, réglage), source, cles }. `cles` : les mots
// qui la désignent sans ambiguïté (un libellé, un nom, une adresse) ; ils servent à reconnaître une fiche dans un texte.
// Tout est PUR : `lireInterface`, `lireVoletsCerveau` et `fabriquerFiches` ne lisent ni n'écrivent rien ; l'appelant
// leur donne les textes et les structures. Rien de privé n'entre : ni nom de machine, ni chemin du disque (les dossiers
// sont dits par rapport au dossier d'Odin), ni secret (seulement « enregistré » ou non, jamais la valeur).

export type Famille = 'infrastructure' | 'interface' | 'modele' | 'acquisition';
export const FAMILLES: readonly Famille[] = ['infrastructure', 'interface', 'modele', 'acquisition'];
export interface Ou { page: string; onglet?: string; reglage?: string }
/**
 * `reponse` : ce qu'une BONNE réponse à une question sur cette fiche doit dire (tous les éléments, sans accents ni
 * casse) — la valeur (un port, une adresse, un chemin) ou le lieu (page, onglet, réglage). Sert à juger une réponse
 * rendue en phrases, sans dépendre des mots qui « nomment » la fiche.
 */
export interface Fiche { id: string; famille: Famille; sujet: string; texte: string; ou?: Ou; source: string; cles: string[]; reponse?: string[] }

// ------------------------------------------------------------------------------------------------ lecture de l'interface
export interface PageUI { id: string; libelle: string; titre: string; resume: string; dansPlus: boolean; menu: boolean }
export interface RubriqueUI { id: string; libelle: string }
export interface ReglageUI { rubrique: string; id: string; libelle: string; carte: string; aide?: string }
export interface CarteUI { rubrique: string; titre: string; resume: string; dynamique: boolean }
export interface InterfaceLue { pages: PageUI[]; rubriques: RubriqueUI[]; cartes: CarteUI[]; reglages: ReglageUI[]; palette: Array<{ vue: string; libelle: string }>; raccourciPalette?: string }

const ENTITES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', rarr: '→', larr: '←', hellip: '…' };
/** Un morceau de HTML en texte d'une ligne (balises retirées, entités rendues). */
export function texteHtml(h: string): string {
  return h.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITES[e.toLowerCase()] ?? m))
    .replace(/\s+/g, ' ').trim();
}
/** Une chaîne JavaScript entre apostrophes, rendue (\' et \\ seulement). */
const chaineJs = (s: string) => s.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, ' ');
const JS = `'((?:[^'\\\\]|\\\\.)*)'`;

/** Lit la page principale (src/web/ui.html) : pages du menu, sections, rubriques et cartes des réglages, libellés, palette. */
export function lireInterface(html: string): InterfaceLue {
  const pages: PageUI[] = [], rubriques: RubriqueUI[] = [], cartes: CarteUI[] = [], reglages: ReglageUI[] = [];
  // 1. Le menu de gauche : les boutons « tab » (ceux du bloc « Plus » sont repliés).
  const debutPlus = html.indexOf('id="navMore"'), finPlus = html.indexOf('id="navEpingles"');
  const menu = new Map<string, { libelle: string; dansPlus: boolean }>();
  for (const m of html.matchAll(/<button class="tab" data-view="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)) {
    const lbl = /<span class="lbl">([\s\S]*?)<\/span>/.exec(m[2]);
    if (!lbl || menu.has(m[1])) continue;
    menu.set(m[1], { libelle: texteHtml(lbl[1]), dansPlus: debutPlus > 0 && m.index! > debutPlus && m.index! < finPlus });
  }
  // 2. Les sections (« view ») : leur titre et leur phrase d'en-tête.
  const sections = [...html.matchAll(/<section class="view[^"]*" id="v-([^"]+)" aria-label="([^"]*)">/g)];
  sections.forEach((m, i) => {
    const bloc = html.slice(m.index!, sections[i + 1]?.index ?? m.index! + 4000).slice(0, 6000);
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(bloc), sub = /<div class="sub"[^>]*>([\s\S]*?)<\/div>/.exec(bloc);
    const mn = menu.get(m[1]);
    pages.push({ id: m[1], libelle: mn?.libelle ?? texteHtml(m[2]), titre: h1 ? texteHtml(h1[1]) : texteHtml(m[2]), resume: sub ? texteHtml(sub[1]) : '', dansPlus: mn?.dansPlus ?? false, menu: Boolean(mn) });
  });
  // 3. Les rubriques des réglages (puces « schip »).
  for (const m of html.matchAll(/<button type="button" class="schip[^"]*" data-sec="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)) if (!rubriques.some((r) => r.id === m[1])) rubriques.push({ id: m[1], libelle: texteHtml(m[2]) });
  // 3 bis. Les rubriques ajoutées par le script de la page (« Ports » : el('button', { type: 'button', class: 'schip', 'data-sec': 'ports', … }, 'Ports')).
  for (const m of html.matchAll(new RegExp(`el\\('button', \\{ type: 'button', class: 'schip', 'data-sec': ${JS}[^}]*\\}, ${JS}\\)`, 'g'))) {
    const id = chaineJs(m[1]);
    if (id !== 'plus' && !rubriques.some((r) => r.id === id)) rubriques.push({ id, libelle: chaineJs(m[2]) });
  }
  // 4. Les cartes des réglages : écrites dans la page, ou remplies par le script (« more-… »).
  const blocDynamique = (id: string) => {
    const i = html.indexOf(`$('#${id}').replaceChildren(`);
    if (i < 0) return '';
    const suite = html.indexOf('$(\'#more-', i + 10);
    return html.slice(i, Math.min(suite > 0 ? suite : i + 9000, i + 9000));
  };
  for (const m of html.matchAll(/<article class="card" data-sec="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)) {
    const sec = m[1], corps = m[2];
    const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(corps), sub = /<p class="sub"[^>]*>([\s\S]*?)<\/p>/.exec(corps);
    if (h2) cartes.push({ rubrique: sec, titre: texteHtml(h2[1]), resume: sub ? texteHtml(sub[1]) : '', dynamique: false });
    const titre = h2 ? texteHtml(h2[1]) : rubriques.find((r) => r.id === sec)?.libelle ?? sec;
    for (const l of corps.matchAll(/<label for="([^"]+)"[^>]*>([\s\S]*?)<\/label>/g)) reglages.push({ rubrique: sec, id: l[1], libelle: texteHtml(l[2]), carte: titre });
    for (const l of corps.matchAll(/<label class="check"[^>]*>\s*<input[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/label>/g)) reglages.push({ rubrique: sec, id: l[1], libelle: texteHtml(l[2]), carte: titre });
    for (const d of corps.matchAll(/id="(more-[a-z0-9-]+)"/g)) {
      const b = blocDynamique(d[1]); if (!b) continue;
      const t = new RegExp(`el\\('h2', \\{\\}, ${JS}\\)`).exec(b), p = new RegExp(`el\\('p', \\{ class: 'sub'[^}]*\\}, ${JS}\\)`).exec(b);
      const titreD = t ? chaineJs(t[1]) : titre;
      if (t) cartes.push({ rubrique: sec, titre: titreD, resume: p ? chaineJs(p[1]) : '', dynamique: true });
      for (const f of b.matchAll(new RegExp(`F\\.(?:input|check)\\(${JS}, ${JS}`, 'g'))) reglages.push({ rubrique: sec, id: chaineJs(f[1]), libelle: chaineJs(f[2]), carte: titreD });
      for (const f of b.matchAll(new RegExp(`el\\('label', \\{ for: ${JS} \\}, ${JS}\\)`, 'g'))) reglages.push({ rubrique: sec, id: chaineJs(f[1]), libelle: chaineJs(f[2]), carte: titreD });
    }
  }
  // Un même champ n'est gardé qu'une fois (le premier libellé trouvé).
  const vus = new Set<string>();
  const uniques = reglages.filter((r) => { const k = `${r.rubrique}:${r.id}`; if (vus.has(k) || !r.libelle) return false; vus.add(k); return true; });
  // 5. La palette « Chercher ou faire » : ses destinations et son raccourci.
  const palette: Array<{ vue: string; libelle: string }> = [];
  const v = /const VIEWS = \[([\s\S]*?)\];/.exec(html);
  if (v) for (const x of v[1].matchAll(new RegExp(`\\[${JS}, ${JS}\\]`, 'g'))) palette.push({ vue: chaineJs(x[1]), libelle: chaineJs(x[2]) });
  const k = /id="palBtn"[^>]*>([\s\S]*?)<\/button>/.exec(html);
  return { pages, rubriques, cartes, reglages: uniques, palette, ...(k ? { raccourciPalette: texteHtml(k[1]) } : {}) };
}

/** Les volets du Cerveau (src/web/brain.js : navBtn('id', icône, 'Libellé')). */
export function lireVoletsCerveau(js: string): Array<{ id: string; libelle: string }> {
  return [...js.matchAll(new RegExp(`navBtn\\(${JS}, [^,]+, ${JS}\\)`, 'g'))].map((m) => ({ id: chaineJs(m[1]), libelle: chaineJs(m[2]) }));
}

// ------------------------------------------------------------------------------------------------ ce que la fabrique lit
export interface AppliSoi { id: string; name: string; family: string; what: string; does?: string[]; modes?: string[]; actions: Array<{ id: string; label: string; what?: string; read?: boolean }> }
export interface SourcesSoi {
  interface?: InterfaceLue;
  voletsCerveau?: Array<{ id: string; libelle: string }>;
  applis?: AppliSoi[];
  /** Le plan des ports des applis (src/valhalla/ports.ts). */
  ports?: Record<string, number>;
  /** La machine (jamais son nom) : système, processeur, mémoire, Node. */
  machine?: { systeme: string; architecture: string; coeurs: number; memoireGo: number; node: string };
  /** La configuration utile (src/config.ts) : rien de secret. */
  config?: {
    web?: { port: number; access?: string; tls?: boolean; enabled?: boolean };
    http?: { enabled: boolean; port: number };
    autoBackup?: { enabled: boolean; hour: number; keep: number; dir?: string };
    watch?: { enabled: boolean; intervalMin: number; diskPct: number; certDays: number; devices?: string[] };
    services?: Array<{ id?: string; name: string; where?: string; auto?: boolean }>;
  };
  /** Les dossiers d'Odin, par rapport au dossier d'Odin (`chemin` relatif). */
  dossiers?: Array<{ id: string; chemin: string; quoi: string }>;
  /** L'inventaire (Horus). */
  appareils?: Array<{ id: string; ip: string; nom: string; genre: string; etat: string; important?: boolean }>;
  /** L'état de Noûs (nousEtat de src/web/nous-api.ts). */
  nous?: Record<string, unknown>;
  /** Les gabarits de Soul (src/brain/nous/tailles.ts), poids compris. */
  tailles?: Array<{ taille: string; C: number; couches: number; tetes: number; vocab: number; contexte: number; poids: number }>;
  /** Le gabarit choisi sur cette machine, s'il est connu. */
  tailleChoisie?: string;
  /** Mathésis : ses réglages, son journal, les sites à absorber. */
  mathesis?: { reglages?: Record<string, unknown>; journal?: Array<{ id: string; at: number; genre: string; quoi: string; pourquoi?: string; source?: string; retenu?: Array<{ texte: string; niveau: string }> }>; sites?: Array<{ id: string; racine: string; etat: string; lues?: number; connues?: number; ajoute?: number; absorbeLe?: number }> };
  /** docs/etat.json. */
  etat?: { maj?: string; elements: Array<{ id: string; nom: string; etat: string; famille?: string; resume?: string }> };
  /** La mémoire (Mnémosyne) et le Cerveau : des comptes seulement. */
  memoire?: { souvenirs?: number; notes?: number };
  /** « Maintenant » (pour dire une date relative ; défaut : rien de relatif). */
  maintenant?: number;
}

// ------------------------------------------------------------------------------------------------ la fabrique
const nb = (n: number) => n.toLocaleString('fr-FR');
const jour = (ms: number) => { const d = new Date(ms); const z = (x: number) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };
const oui = (b: unknown) => (b ? 'oui' : 'non');
const plages = (p: unknown) => (Array.isArray(p) && p.length ? p.map((x: { de: number; a: number }) => (x.de === 0 && (x.a === 24 || x.a === 0) ? 'toute la journée' : `${x.de} h → ${x.a} h`)).join(', ') : 'jamais');
const cles = (...xs: Array<string | undefined>) => [...new Set(xs.map((x) => (x ?? '').replace(/\s+/g, ' ').trim()).filter((x) => x.length >= 2))];
const ETATS_APPAREIL: Record<string, string> = { online: 'en ligne', offline: 'déconnecté', removed: 'retiré' };
const ETATS_SITE: Record<string, string> = { 'a-explorer': 'à explorer', 'en-cours': 'en cours de lecture', 'en-suivi': 'lu, suivi chaque jour', 'en-pause': 'en pause', refuse: 'refusé' };

/** Fabrique les fiches de connaissance de soi. Pure ; rend les fiches triées par identifiant (sans doublon). */
export function fabriquerFiches(s: SourcesSoi): Fiche[] {
  const out = new Map<string, Fiche>();
  const poser = (f: Fiche) => { if (!out.has(f.id)) out.set(f.id, { ...f, texte: f.texte.replace(/\s+/g, ' ').trim(), cles: cles(...f.cles), ...(f.reponse ? { reponse: cles(...f.reponse) } : {}) }); };
  const ui = s.interface;
  const pageDe = (id: string) => ui?.pages.find((p) => p.id === id);
  const nomPage = (id: string) => pageDe(id)?.libelle ?? id;
  const reglagesPage = nomPage('settings');
  const accesMenu = (p: PageUI) => (p.menu ? (p.dansPlus ? `dans le menu de gauche, sous « Plus »` : `dans le menu de gauche`) : `depuis une autre page (pas dans le menu)`);

  // ---------------------------------------------------------------- INTERFACE
  if (ui) {
    for (const p of ui.pages) poser({
      id: `interface:page:${p.id}`, famille: 'interface', sujet: `la page « ${p.libelle} »`,
      texte: `La page « ${p.libelle} »${p.titre && p.titre !== p.libelle ? ` (titre : ${p.titre})` : ''} s'ouvre ${accesMenu(p)}.${p.resume ? ` ${p.resume}` : ''}`,
      ou: { page: p.libelle }, source: `src/web/ui.html#v-${p.id}`, cles: [p.libelle, p.titre], reponse: [p.libelle],
    });
    const parRubrique = new Map<string, CarteUI[]>();
    for (const c of ui.cartes) { if (!parRubrique.has(c.rubrique)) parRubrique.set(c.rubrique, []); parRubrique.get(c.rubrique)!.push(c); }
    for (const r of ui.rubriques) {
      const cs = parRubrique.get(r.id) ?? [];
      const champs = ui.reglages.filter((x) => x.rubrique === r.id).map((x) => x.libelle);
      poser({
        id: `interface:onglet:${r.id}`, famille: 'interface', sujet: `l'onglet « ${r.libelle} » des réglages`,
        texte: `Dans ${reglagesPage}, l'onglet « ${r.libelle} »${cs.length ? ` : ${cs.map((c) => `${c.titre}${c.resume ? ` — ${c.resume}` : ''}`).join(' ; ')}` : ''}${champs.length ? ` Réglages : ${champs.slice(0, 12).join(', ')}${champs.length > 12 ? '…' : ''}.` : ''}`,
        ou: { page: reglagesPage, onglet: r.libelle }, source: `src/web/ui.html#snav[data-sec=${r.id}]`, cles: [r.libelle, ...cs.map((c) => c.titre)], reponse: [reglagesPage, r.libelle],
      });
    }
    for (const x of ui.reglages) {
      const r = ui.rubriques.find((y) => y.id === x.rubrique);
      const onglet = r?.libelle ?? x.carte;
      poser({
        id: `interface:reglage:${x.rubrique}:${x.id}`, famille: 'interface', sujet: `le réglage « ${x.libelle} »`,
        texte: `« ${x.libelle} » se règle dans ${reglagesPage} → ${onglet}${x.carte && x.carte !== onglet ? `, carte « ${x.carte} »` : ''}.`,
        ou: { page: reglagesPage, onglet, reglage: x.libelle }, source: `src/web/ui.html#${x.id}`, cles: [x.libelle], reponse: [onglet, x.libelle],
      });
    }
    if (ui.palette.length || ui.raccourciPalette) poser({
      id: 'interface:palette', famille: 'interface', sujet: 'la palette « Chercher ou faire »',
      texte: `${ui.raccourciPalette ? `Le bouton « ${ui.raccourciPalette} » ouvre` : 'Une palette ouvre'} une recherche dans toute l'interface : écrans, réglages, actions, ou une demande à Odin. Elle mène à : ${ui.palette.map((p) => p.libelle).join(', ')}.`,
      ou: { page: 'menu de gauche', onglet: 'Chercher ou faire' }, source: 'src/web/ui.html#palette', cles: ['Chercher ou faire', 'Ctrl K'], reponse: ['Chercher ou faire'],
    });
  }
  const cerveau = pageDe('brain')?.libelle ?? 'Cerveau';
  for (const v of s.voletsCerveau ?? []) poser({
    id: `interface:volet-cerveau:${v.id}`, famille: 'interface', sujet: `le volet « ${v.libelle} » du Cerveau`,
    texte: `Dans la page ${cerveau}, le volet « ${v.libelle} » est dans la colonne de gauche (Pages du Cerveau).`,
    ou: { page: cerveau, onglet: v.libelle }, source: `src/web/brain.js#navBtn(${v.id})`, cles: [v.libelle], reponse: [cerveau, v.libelle],
  });
  const applisPage = pageDe('apps')?.libelle ?? 'Applis';
  for (const a of s.applis ?? []) {
    poser({
      id: `interface:appli:${a.id}`, famille: 'interface', sujet: `l'appli ${a.name}`,
      texte: `L'appli ${a.name} (${a.family}) : ${a.what} Sa page : ${applisPage} → ${a.name}.${a.modes?.length ? ` Ses onglets : ${a.modes.join(', ')}.` : ''} ${a.actions.length} action(s).`,
      ou: { page: applisPage, onglet: a.name }, source: `src/valhalla (module ${a.id})`, cles: [a.name, ...(a.modes ?? [])], reponse: [a.name],
    });
    for (const x of a.actions) poser({
      id: `interface:action:${a.id}:${x.id}`, famille: 'interface', sujet: `« ${x.label} » (${a.name})`,
      texte: `Pour « ${x.label} » : appli ${a.name} (${applisPage} → ${a.name}), action « ${x.label} »${x.what ? ` — ${x.what}` : ''}${x.read ? ' (lecture seule)' : ''}. On peut aussi le demander à Odin.`,
      ou: { page: applisPage, onglet: a.name, reglage: x.label }, source: `src/valhalla (action ${a.id}.${x.id})`, cles: [x.label], reponse: [a.name, x.label],
    });
  }

  // ---------------------------------------------------------------- INFRASTRUCTURE
  const m = s.machine;
  if (m) poser({
    id: 'infra:machine', famille: 'infrastructure', sujet: 'la machine où tourne Odin',
    texte: `Odin tourne sur une machine ${m.systeme} (${m.architecture}), ${m.coeurs} cœurs, ${m.memoireGo} Go de mémoire, avec Node ${m.node}. Aucune carte graphique n'est utilisée : Soul s'entraîne sur le processeur.`,
    source: 'node:os', cles: [m.systeme, m.architecture], reponse: [m.systeme],
  });
  const c = s.config ?? {};
  if (c.web) poser({
    id: 'infra:port-web', famille: 'infrastructure', sujet: 'le port de l\'interface d\'Odin',
    texte: `L'interface d'Odin écoute sur le port ${c.web.port}${c.web.tls !== undefined ? ` (HTTPS : ${oui(c.web.tls)})` : ''}${c.web.access ? `, accès « ${c.web.access} »` : ''}.`,
    source: 'config.json (web)', cles: [String(c.web.port)], reponse: [String(c.web.port)],
  });
  if (c.http) poser({
    id: 'infra:port-http', famille: 'infrastructure', sujet: 'l\'API HTTP d\'Odin',
    texte: `L'API HTTP (pour les automatisations extérieures) est ${c.http.enabled ? 'activée' : 'désactivée'}, port ${c.http.port}.`,
    source: 'config.json (http)', cles: [String(c.http.port)], reponse: [String(c.http.port)],
  });
  const nomAppli = new Map((s.applis ?? []).map((a) => [a.id, a.name]));
  // Le nom d'un onglet des réglages tel que la page le montre (rien d'écrit en dur quand la page le dit).
  const ongletDe = (id: string, defaut: string) => ui?.rubriques.find((x) => x.id === id)?.libelle ?? defaut;
  const ongletPorts = ui?.rubriques.find((x) => x.id === 'ports')?.libelle;
  for (const [id, port] of Object.entries(s.ports ?? {})) {
    if (s.applis && !nomAppli.has(id)) continue; // un port d'une appli absente de ce produit : pas de fiche
    const n = nomAppli.get(id) ?? id;
    poser({ id: `infra:port:${id}`, famille: 'infrastructure', sujet: `le port de ${n}`, texte: `L'appli ${n} a son propre port : ${port} (il se change dans sa page, « Son port »${ongletPorts ? `, ou dans ${reglagesPage} → ${ongletPorts}` : ''}).`, source: 'src/valhalla/ports.ts', cles: [String(port), n], reponse: [String(port)] });
  }
  if (c.autoBackup) poser({
    id: 'infra:sauvegarde', famille: 'infrastructure', sujet: 'la sauvegarde d\'Odin',
    texte: `Sauvegarde chiffrée automatique : ${c.autoBackup.enabled ? `activée, chaque nuit à ${c.autoBackup.hour} h` : 'désactivée'} ; ${c.autoBackup.keep} sauvegardes gardées${c.autoBackup.dir !== undefined ? ` ; dossier ${c.autoBackup.dir ? 'choisi' : 'pas encore choisi'}` : ''}. Elle se règle dans ${reglagesPage} → ${ongletDe('sauvegarde', 'Sauvegarde')}.`,
    ou: { page: reglagesPage, onglet: ongletDe('sauvegarde', 'Sauvegarde') }, source: 'config.json (autoBackup)', cles: ['sauvegarde chiffrée'], reponse: [reglagesPage, ongletDe('sauvegarde', 'Sauvegarde')],
  });
  if (c.watch) poser({
    id: 'infra:surveillance', famille: 'infrastructure', sujet: 'la surveillance (santé de la maison)',
    texte: `Surveillance ${c.watch.enabled ? 'activée' : 'désactivée'} : vérification toutes les ${c.watch.intervalMin} minutes, alerte disque à ${c.watch.diskPct} %, alerte certificat ${c.watch.certDays} jours avant expiration${c.watch.devices ? ` ; ${c.watch.devices.length} appareil(s) marqué(s) important(s)` : ''}.`,
    ou: { page: reglagesPage, onglet: ongletDe('surveillance', 'Surveillance') }, source: 'config.json (watch)', cles: ['surveillance'], reponse: [reglagesPage, ongletDe('surveillance', 'Surveillance')],
  });
  if (c.services) poser({
    id: 'infra:services', famille: 'infrastructure', sujet: 'les services surveillés et réparés',
    texte: c.services.length ? `${c.services.length} service(s) surveillé(s) toutes les 5 minutes et réparé(s) au besoin : ${c.services.map((x) => `${x.name}${x.where ? ` (${x.where === 'local' ? 'machine d\'Odin' : x.where})` : ''}${x.auto ? ', réparé tout seul' : ''}`).join(' ; ')}.` : `Aucun service n'est surveillé pour l'instant (${reglagesPage} → ${ongletDe('entretien', 'Entretien')} → Ajouter un service).`,
    ou: { page: reglagesPage, onglet: ongletDe('entretien', 'Entretien') }, source: 'config.json (services)', cles: c.services.map((x) => x.name), reponse: [reglagesPage, ongletDe('entretien', 'Entretien')],
  });
  for (const d of s.dossiers ?? []) poser({ id: `infra:dossier:${d.id}`, famille: 'infrastructure', sujet: `le dossier ${d.chemin}`, texte: `${d.quoi} : dans le dossier d'Odin, « ${d.chemin} ».`, source: 'src (chemins du produit)', cles: [d.chemin], reponse: [d.chemin === '.' ? 'dossier d\'Odin' : d.chemin] });
  if (s.appareils) {
    const en = s.appareils.filter((a) => a.etat === 'online').length;
    poser({
      id: 'infra:inventaire', famille: 'infrastructure', sujet: 'l\'inventaire des appareils',
      texte: `L'inventaire (Horus) compte ${s.appareils.filter((a) => a.etat !== 'removed').length} appareil(s) : ${en} en ligne, ${s.appareils.filter((a) => a.etat === 'offline').length} déconnecté(s)${s.appareils.some((a) => a.important) ? `, ${s.appareils.filter((a) => a.important).length} important(s)` : ''}. On les voit dans la page ${nomPage('net')}.`,
      ou: { page: nomPage('net') }, source: 'inventaire (Horus)', cles: ['inventaire'], reponse: [nomPage('net')],
    });
    for (const a of s.appareils) poser({
      id: `infra:appareil:${a.id}`, famille: 'infrastructure', sujet: `l'appareil ${a.nom || a.ip}`,
      texte: `L'appareil « ${a.nom || a.ip} » (${a.genre || 'genre inconnu'}), adresse ${a.ip}, est ${ETATS_APPAREIL[a.etat] ?? a.etat}${a.important ? ', marqué important' : ''}.`,
      ou: { page: nomPage('net') }, source: 'inventaire (Horus)', cles: [a.nom, a.ip], reponse: [a.ip],
    });
  }

  // ---------------------------------------------------------------- MODÈLE
  const n = s.nous as undefined | { actif?: boolean; entraine?: boolean; message?: string; prive?: boolean; lu?: { total?: number; octets?: number; parSource?: Array<{ source: string; n: number }> }; modeleDepart?: { installe?: boolean; texte?: string }; depart?: { choix?: string; texte?: string; fait?: boolean; quand?: string }; etapes?: { etape1?: { texte?: string } } | null; reglages?: { heuresNuit?: number; filsNuit?: number; disqueMaxMo?: number; puissance?: string }; entrainement?: { pas?: number; apprend?: boolean; fils?: number; filsMachine?: number }; oubli?: string; duels?: { joues?: number } };
  const pageNous = `${cerveau} → ${(s.voletsCerveau ?? []).find((v) => v.id === 'nous')?.libelle ?? 'Noûs'}`;
  if (s.tailles?.length) {
    const t = s.tailles;
    poser({
      id: 'modele:soul', famille: 'modele', sujet: 'Soul (Noûs), le réseau de neurones d\'Odin',
      texte: `Soul (Noûs à l'écran) est le petit réseau de neurones d'Odin, écrit dans Odin et entraîné sur le processeur de la machine. Trois gabarits : ${t.map((x) => `${x.taille} (${nb(x.poids)} poids)`).join(', ')}${s.tailleChoisie ? ` ; gabarit de cette machine : ${s.tailleChoisie}` : ''}. Sa page : ${pageNous}.`,
      ou: { page: cerveau, onglet: 'Noûs' }, source: 'src/brain/nous/tailles.ts', cles: ['Soul', 'Noûs'],
    });
    for (const x of t) poser({
      id: `modele:soul:gabarit:${x.taille}`, famille: 'modele', sujet: `le gabarit « ${x.taille} » de Soul`,
      texte: `Gabarit « ${x.taille} » : largeur ${x.C}, ${x.couches} couches, ${x.tetes} têtes d'attention, vocabulaire ${nb(x.vocab)} morceaux, contexte ${x.contexte}, soit ${nb(x.poids)} poids.`,
      source: 'src/brain/nous/tailles.ts', cles: [`gabarit ${x.taille}`],
    });
  }
  if (n) {
    poser({
      id: 'modele:soul:etat', famille: 'modele', sujet: 'où en est l\'entraînement de Soul',
      texte: `${n.actif === false ? 'Soul est en pause.' : 'Soul est actif.'} ${n.entraine ? 'Il a un point de reprise.' : 'Il n\'a pas encore de point de reprise (pas encore entraîné).'} ${n.message ?? ''} ${n.etapes?.etape1?.texte ? `Étape 1 : ${n.etapes.etape1.texte}.` : 'L\'entraînement n\'a pas encore commencé.'}${n.entrainement?.pas ? ` ${nb(n.entrainement.pas)} pas faits.` : ''} Duels joués : ${n.duels?.joues ?? 0}.`,
      ou: { page: cerveau, onglet: 'Noûs' }, source: 'src/web/nous-api.ts (nousEtat)', cles: ['point de reprise'],
    });
    poser({
      id: 'modele:soul:corpus', famille: 'modele', sujet: 'ce que Soul a lu (son corpus)',
      texte: `Soul a lu ${nb(n.lu?.total ?? 0)} exemple(s)${n.lu?.octets ? ` (${nb(Math.round(n.lu.octets / 1024))} Ko)` : ''}${n.lu?.parSource?.length ? ` : ${n.lu.parSource.map((x) => `${x.source} ${nb(x.n)}`).join(', ')}` : ''}.`,
      ou: { page: cerveau, onglet: 'Noûs' }, source: 'src/web/nous-api.ts (nousEtat.lu)', cles: ['corpus'],
    });
    if (n.reglages) poser({
      id: 'modele:soul:reglages', famille: 'modele', sujet: 'les réglages de l\'entraînement de Soul',
      texte: `Entraînement de Soul : puissance « ${n.reglages.puissance ?? '?'} »${n.entrainement?.fils ? ` (${n.entrainement.fils} fil(s) sur ${n.entrainement.filsMachine ?? '?'})` : ''}, ${n.reglages.heuresNuit} h la nuit sur ${n.reglages.filsNuit} fil(s), au plus ${nb(n.reglages.disqueMaxMo ?? 0)} Mo sur le disque. Ça se règle dans ${pageNous}.`,
      ou: { page: cerveau, onglet: 'Noûs', reglage: 'puissance' }, source: 'config.json (nous)', cles: ['puissance'],
    });
    if (n.modeleDepart) poser({
      id: 'modele:soul:depart', famille: 'modele', sujet: 'le modèle de départ de Soul',
      texte: `Modèle de départ : ${n.modeleDepart.texte ?? (n.modeleDepart.installe ? 'installé' : 'aucun')}.`,
      source: 'src/brain/nous/livraison.ts (departInstalle)', cles: ['modèle de départ'],
    });
  }
  poser({
    id: 'modele:sans-modele-exterieur', famille: 'modele', sujet: 'aucun modèle extérieur',
    texte: `Odin n'appelle aucun modèle extérieur : il répond par son code, sa mémoire (Brain) et Soul.${s.mathesis?.reglages ? ` Mathésis : appel à un modèle en ligne permis : ${oui(s.mathesis.reglages.modeleEnLigne)} ; appels payants par jour : ${(s.mathesis.reglages.budgets as { appelsPayants?: number } | undefined)?.appelsPayants ?? 0}.` : ''}`,
    source: 'src/valhalla/mathesis/reglages.ts ; docs/etat.json', cles: ['modèle extérieur'],
  });
  if (s.applis) {
    const actions = s.applis.reduce((t, a) => t + a.actions.length, 0);
    poser({ id: 'modele:sait-faire', famille: 'modele', sujet: 'ce qu\'Odin sait faire', texte: `Odin a ${s.applis.length} applis et ${nb(actions)} actions (dont ${nb(s.applis.reduce((t, a) => t + a.actions.filter((x) => x.read).length, 0))} en lecture seule). Toutes sont dans la page ${applisPage}.`, ou: { page: applisPage }, source: 'src/valhalla/odin.ts (allModules)', cles: [`${s.applis.length} applis`] });
  }
  if (s.memoire) poser({
    id: 'modele:brain', famille: 'modele', sujet: 'Brain, la mémoire d\'Odin',
    texte: `Brain est la mémoire d'Odin : ${s.memoire.souvenirs !== undefined ? `${nb(s.memoire.souvenirs)} souvenir(s)` : 'des souvenirs'}${s.memoire.notes !== undefined ? ` et ${nb(s.memoire.notes)} note(s)` : ''}. On la voit dans ${cerveau} (volets ${(s.voletsCerveau ?? []).map((v) => v.libelle).join(', ') || 'Souvenirs'}).`,
    ou: { page: cerveau }, source: 'Mnémosyne (src/muninn) et le coffre (src/brain/vault.ts)', cles: ['Brain', 'souvenirs'],
  });
  const ETAT: Record<string, string> = { fait: 'fait', 'en cours': 'en cours', 'à venir': 'à venir (pas encore fait)' };
  for (const e of s.etat?.elements ?? []) poser({
    id: `modele:etat:${e.id}`, famille: 'modele', sujet: e.nom,
    texte: `« ${e.nom} » : ${ETAT[e.etat] ?? e.etat}${e.famille ? ` (${e.famille})` : ''}.${e.resume ? ` ${e.resume}` : ''}`,
    source: `docs/etat.json#${e.id}`, cles: [e.nom], reponse: [e.nom.split(/[,(—:]/)[0].trim()],
  });

  // ---------------------------------------------------------------- ACQUISITION
  const r = s.mathesis?.reglages as undefined | { actif?: boolean; pause?: boolean; vitesse?: string; budgets?: Record<string, number>; heures?: unknown; heuresLourd?: unknown; dossiers?: string[]; nePasGarder?: boolean; modeleEnLigne?: boolean };
  const nomMathesis = nomAppli.get('mathesis') ?? 'Mathésis';
  const ouMathesis: Ou = { page: applisPage, onglet: nomMathesis };
  if (r) {
    poser({
      id: 'acquisition:mathesis', famille: 'acquisition', sujet: `${nomMathesis}, l'apprentissage d'Odin`,
      texte: `${nomMathesis} apprend tout seul : ${r.actif === false ? 'coupé' : r.pause ? 'en pause' : 'allumé'}, vitesse « ${r.vitesse} ». Ce qu'il range : ${r.nePasGarder ? 'rien (« ne pas garder »)' : 'ce qu\'il retient, dans la mémoire'}. Sa page : ${applisPage} → ${nomMathesis}.`,
      ou: ouMathesis, source: 'Mathésis (reglages)', cles: [nomMathesis], reponse: [nomMathesis],
    });
    poser({
      id: 'acquisition:mathesis:heures', famille: 'acquisition', sujet: `quand ${nomMathesis} travaille`,
      texte: `Travail léger (recherches, pages, dossiers ouverts) : ${plages(r.heures)}. Travail lourd (vidéos, gros fichiers) : ${plages(r.heuresLourd)}. Il s'arrête dès qu'Odin doit répondre.`,
      ou: ouMathesis, source: 'Mathésis (reglages.heures)', cles: ['travail lourd'],
    });
    if (r.budgets) poser({
      id: 'acquisition:mathesis:budgets', famille: 'acquisition', sujet: `combien ${nomMathesis} lit par jour`,
      texte: `Vitesse « ${r.vitesse} » : au plus ${nb(r.budgets.recherches ?? 0)} recherches, ${nb(r.budgets.pages ?? 0)} pages, ${nb(Math.round((r.budgets.octets ?? 0) / 1048576))} Mo, ${nb(r.budgets.minutesVideo ?? 0)} minutes de vidéo et ${nb(r.budgets.fichiers ?? 0)} fichiers par jour ; appels payants : ${r.budgets.appelsPayants ?? 0}.`,
      ou: ouMathesis, source: 'Mathésis (reglages.budgets)', cles: ['minutes de vidéo'],
    });
    poser({
      id: 'acquisition:mathesis:dossiers', famille: 'acquisition', sujet: `les dossiers ouverts à ${nomMathesis}`,
      texte: `${(r.dossiers ?? []).length} dossier(s) ouvert(s) à ${nomMathesis} (lus en lecture seule)${(r.dossiers ?? []).length ? '' : ' : aucun pour l\'instant'}.`,
      ou: ouMathesis, source: 'Mathésis (reglages.dossiers)', cles: ['dossiers ouverts'],
    });
  }
  const j = s.mathesis?.journal;
  if (j) {
    const tri = [...j].sort((a, b) => b.at - a.at);
    poser({
      id: 'acquisition:journal', famille: 'acquisition', sujet: `le journal de ${nomMathesis}`,
      texte: tri.length ? `Le journal de ${nomMathesis} a ${tri.length} entrée(s) ; la dernière le ${jour(tri[0].at)} : ${tri[0].quoi}.` : `Le journal de ${nomMathesis} est vide : il n'a encore rien appris tout seul.`,
      ou: ouMathesis, source: 'Mathésis (journal)', cles: ['journal'], reponse: [nomMathesis, 'journal'],
    });
    for (const e of tri) poser({
      id: `acquisition:journal:${e.id}`, famille: 'acquisition', sujet: `« ${e.quoi} »`,
      texte: `Le ${jour(e.at)}, ${nomMathesis} ${e.quoi}${e.pourquoi ? ` (pourquoi : ${e.pourquoi})` : ''}${e.source ? ` — source ${e.source}` : ''}${e.retenu?.length ? ` ; retenu : ${e.retenu.map((x) => x.texte).join(' ; ')}` : ''}.`,
      ou: ouMathesis, source: `Mathésis (journal ${e.id})`, cles: [e.source ?? ''],
    });
  }
  const sites = s.mathesis?.sites;
  if (sites) {
    poser({
      id: 'acquisition:sites', famille: 'acquisition', sujet: 'les sites à absorber',
      texte: sites.length ? `${sites.length} site(s) à absorber : ${sites.map((x) => `${x.id} (${ETATS_SITE[x.etat] ?? x.etat})`).join(', ')}.` : `Aucun site à absorber pour l'instant (on en donne un dans ${applisPage} → ${nomMathesis}, ou en le demandant).`,
      ou: ouMathesis, source: 'Mathésis (absorber)', cles: ['absorber'],
    });
    for (const x of sites) poser({
      id: `acquisition:site:${x.id}`, famille: 'acquisition', sujet: `le site ${x.id}`,
      texte: `Le site ${x.id} (${x.racine}) : ${ETATS_SITE[x.etat] ?? x.etat}${x.lues !== undefined ? ` ; ${nb(x.lues)} page(s) lue(s)` : ''}${x.connues !== undefined ? ` sur ${nb(x.connues)} connue(s)` : ''}${x.ajoute ? ` ; ajouté le ${jour(x.ajoute)}` : ''}${x.absorbeLe ? ` ; lu en entier le ${jour(x.absorbeLe)}` : ''}.`,
      ou: ouMathesis, source: `Mathésis (absorber ${x.id})`, cles: [x.id, x.racine],
    });
  }
  if (n?.depart) poser({
    id: 'acquisition:corpus-depart', famille: 'acquisition', sujet: 'le premier corpus de Soul',
    texte: `Premier corpus de Soul : « ${n.depart.choix} » — ${n.depart.texte ?? ''}. ${n.depart.fait ? `Fait${n.depart.quand ? ` le ${String(n.depart.quand).slice(0, 10)}` : ''}.` : 'Pas encore fait.'}`,
    ou: { page: cerveau, onglet: 'Noûs', reglage: 'premier corpus' }, source: 'src/brain/nous/corpus-depart.ts', cles: ['premier corpus'],
  });
  if (n?.oubli) poser({ id: 'acquisition:oubli', famille: 'acquisition', sujet: 'ce qu\'Odin oublie à la demande', texte: n.oubli, ou: { page: cerveau, onglet: 'Souvenirs' }, source: 'src/web/nous-api.ts (nousEtat.oubli)', cles: ['oublier'] });
  if (n) poser({
    id: 'acquisition:prive', famille: 'acquisition', sujet: 'le mode privé (ce qu\'Odin n\'apprend pas)',
    texte: `Mode privé : ${n.prive ? 'activé — Odin n\'apprend rien de ce qu\'on lui dit' : 'désactivé — Odin retient ce qu\'on lui dit (secrets masqués)'}.`,
    source: 'config.json (voice.privacy.privateMode)', cles: ['mode privé'],
  });
  return [...out.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Les dossiers d'Odin, dits par rapport au dossier d'Odin (jamais le chemin du disque) : `chemins` vient des chemins du
 * produit (odinPaths de src/config.ts, plus ceux des modules : Mathésis, Soul, secrets). Ce que chaque dossier contient
 * est rangé par la CLÉ du chemin : une clé inconnue garde son nom. Un chemin hors du dossier d'Odin est laissé.
 */
export const QUOI_DOSSIER: Record<string, string> = {
  home: 'Le dossier d\'Odin (toutes ses données)', config: 'La configuration', persona: 'La personnalité d\'Odin (SOUL.md)', db: 'La mémoire (souvenirs, conversations, inventaire)',
  skills: 'Les compétences', drafts: 'Les brouillons de compétences', workspace: 'L\'espace de travail', logs: 'Les journaux de fonctionnement',
  env: 'Les secrets (clés et mots de passe, chiffrés)', mathesis: 'Ce que Mathésis apprend (chiffré)', soul: 'Soul : corpus, points de reprise, entraînement', ports: 'Les ports changés des applis',
};
export function dossiersDe(home: string, chemins: Record<string, string>): Array<{ id: string; chemin: string; quoi: string }> {
  const sep = /[\\/]+/g, h = home.replace(sep, '/').replace(/\/$/, '');
  const out: Array<{ id: string; chemin: string; quoi: string }> = [];
  for (const [id, c] of Object.entries(chemins)) {
    const p = c.replace(sep, '/');
    const rel = p === h ? '.' : p.toLowerCase().startsWith(`${h.toLowerCase()}/`) ? p.slice(h.length + 1) : undefined;
    if (rel === undefined) continue;
    out.push({ id, chemin: rel, quoi: QUOI_DOSSIER[id] ?? id });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Le nombre de fiches par famille. */
export function comptesFiches(fs: Fiche[]): Record<Famille, number> {
  const o = Object.fromEntries(FAMILLES.map((f) => [f, 0])) as Record<Famille, number>;
  for (const f of fs) o[f.famille]++;
  return o;
}
