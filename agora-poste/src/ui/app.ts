// L'écran d'Agora sur l'ordinateur (maquette validée « StorePC ») : Mon store, Mises à jour, Historique, et l'écran
// de connexion à Odin. Aucune donnée n'est interprétée comme du HTML : tout passe par textContent.

interface Ligne { id: string; nom: string; desc: string; mode: 'proposee' | 'office' | 'retiree'; par: string; impose: boolean; installee: boolean; versionLocale?: string; versionOdin?: string; installable: boolean; web?: string; enCours?: { action: string; progression?: number }; erreur?: string; majDispo: boolean }
interface Etat { connexion: 'aucune' | 'connexion' | 'ok' | 'horsligne'; odin?: { adresse: string; nom: string }; personne?: { nom: string; login: string; groupes: string[] }; appareil?: { nom: string; plateforme: string }; store: Ligne[]; historique: Array<{ quand: number; texte: string; ok: boolean }>; message?: string; connexionInfo?: { erreur?: string; codeRequis?: boolean; trouves?: Array<{ adresse: string; nom: string }> }; enLigne: boolean; version: string }
interface Api { etat(): Promise<Etat>; surEtat(f: (e: Etat) => void): void; faire(a: string, arg?: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> }
const agora = (window as unknown as { agora: Api }).agora;

type Attrs = Record<string, string | boolean | ((e: Event) => void) | undefined>;
function el(tag: string, a: Attrs = {}, ...enfants: Array<Node | string | null | undefined | false>): HTMLElement {
  const x = document.createElement(tag);
  for (const [k, v] of Object.entries(a)) { if (v === undefined || v === false) continue; if (typeof v === 'function') x.addEventListener(k.replace(/^on/, ''), v); else if (v === true) x.setAttribute(k, ''); else x.setAttribute(k, v); }
  for (const c of enfants) if (c !== null && c !== undefined && c !== false) x.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return x;
}
const COULEURS = [['#0EA5A4', '#0B7F7C'], ['#F472B6', '#BE185D'], ['#60A5FA', '#1D4ED8'], ['#FBBF24', '#D97706'], ['#A78BFA', '#6D28D9'], ['#34D399', '#047857']];
const couleur = (id: string) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COULEURS[h % COULEURS.length]; };
const icone = (l: Ligne) => { const [a, b] = couleur(l.id); const x = el('span', { class: 'ico', 'aria-hidden': 'true' }, l.nom.slice(0, 1).toUpperCase()); x.style.background = `linear-gradient(135deg, ${a}, ${b})`; return x; };

let etat: Etat | undefined, onglet: 'store' | 'maj' | 'histo' = 'store', occupe = new Set<string>(), avis = '';
const faire = async (a: string, arg: Record<string, unknown> = {}) => { const r = await agora.faire(a, arg); if (!r.ok && r.message) { avis = r.message; dessiner(); } return r; };

function texteEtat(l: Ligne): { texte: string; erreur?: boolean } {
  if (l.enCours) return { texte: `${l.enCours.action === 'desinstaller' ? 'Désinstallation…' : l.enCours.action === 'mettre_a_jour' ? 'Mise à jour…' : 'Installation…'}${l.enCours.progression !== undefined ? ` ${l.enCours.progression} %` : ''}` };
  if (l.erreur) return { texte: l.erreur, erreur: true };
  if (l.mode === 'retiree') return { texte: `Retirée${l.par ? ` par ${l.par}` : ''}${l.installee ? ' · désinstallation en attente' : ''}` };
  if (l.installee) return { texte: `Installée${l.versionLocale ? ` · ${l.versionLocale}` : ''}${l.majDispo ? ` (nouvelle version ${l.versionOdin})` : ''}` };
  if (!l.installable && l.web) return { texte: 'Dans ton espace Odin' };
  if (!l.installable) return { texte: 'Pas pour cet ordinateur' };
  return { texte: l.mode === 'office' ? `Installation prévue${l.par ? ` par ${l.par}` : ''}` : `Proposée${l.par ? ` par ${l.par}` : ''}` };
}
function carte(l: Ligne): HTMLElement {
  const e = texteEtat(l), boutons: HTMLElement[] = [], attend = occupe.has(l.id);
  if (l.enCours) { const b = el('span', { class: 'barre', 'aria-hidden': 'true' }, el('span')); (b.firstChild as HTMLElement).style.width = `${l.enCours.progression ?? 5}%`; boutons.push(b); }
  else {
    if (l.installee || (l.web && !l.installable)) boutons.push(el('button', { class: 'bouton', type: 'button', onclick: () => void faire('ouvrir', { id: l.id }) }, 'Ouvrir'));
    if (l.installee && l.majDispo && l.mode !== 'retiree') boutons.push(el('button', { class: 'bouton principal', type: 'button', disabled: attend, onclick: () => clic('mettre_a_jour', l.id) }, 'Mettre à jour'));
    if (l.installee && !l.impose) boutons.push(el('button', { class: 'bouton', type: 'button', disabled: attend, onclick: () => clic('desinstaller', l.id) }, 'Désinstaller'));
    if (!l.installee && l.installable && l.mode !== 'retiree') boutons.push(el('button', { class: 'bouton principal', type: 'button', disabled: attend, onclick: () => clic('installer', l.id), 'data-element': l.id }, 'Installer'));
  }
  return el('article', { 'data-element': l.id },
    el('div', { class: 'haut' }, icone(l), el('span', {}, el('b', {}, l.nom), l.desc ? el('small', {}, l.desc) : null)),
    el('span', { class: `etat${e.erreur ? ' erreur' : ''}` }, e.texte),
    l.impose && l.mode !== 'retiree' ? el('span', { class: 'impose' }, `🔒 Imposée${l.par ? ` par ${l.par}` : ''}`) : null,
    el('div', { class: 'actions' }, ...boutons));
}
function clic(a: string, id: string): void { occupe.add(id); dessiner(); void faire(a, { id }).finally(() => { occupe.delete(id); dessiner(); }); }

function ecranConnexion(e: Etat): HTMLElement {
  const info = e.connexionInfo ?? {}, adresse = el('input', { id: 'adresse', name: 'adresse', value: e.odin?.adresse ?? info.trouves?.[0]?.adresse ?? '', placeholder: 'https://192.168.1.10:7777', autocomplete: 'url', spellcheck: 'false' }) as HTMLInputElement;
  const ident = el('input', { id: 'identifiant', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' }) as HTMLInputElement, mdp = el('input', { id: 'motdepasse', type: 'password', autocomplete: 'current-password' }) as HTMLInputElement;
  const code = el('input', { id: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '7' }) as HTMLInputElement;
  const envoyer = async (ev: Event) => { ev.preventDefault(); if (!adresse.value.trim()) { avis = 'Indique l\'adresse d\'Odin (ou clique sur un Odin trouvé).'; dessiner(); return; } avis = ''; await faire('connecter', { adresse: adresse.value.trim(), identifiant: ident.value, motdepasse: mdp.value, code: code.value }); };
  return el('form', { class: 'connexion', onsubmit: (ev) => void envoyer(ev) },
    el('h1', {}, 'Agora'), el('p', {}, 'Le store d\'Odin : connecte-toi avec ton compte Odin, et retrouve ici les applis auxquelles tu as droit.'),
    info.trouves?.length ? el('div', { class: 'trouves' }, ...info.trouves.map((t) => el('button', { type: 'button', onclick: () => { adresse.value = t.adresse; } }, `${t.nom} · ${t.adresse}`))) : el('button', { class: 'lien', type: 'button', onclick: () => void faire('trouver') }, 'Chercher Odin sur le réseau'),
    el('label', { for: 'adresse' }, 'Adresse d\'Odin', adresse),
    el('label', { for: 'identifiant' }, 'Identifiant ou e-mail', ident),
    el('label', { for: 'motdepasse' }, 'Mot de passe', mdp),
    info.codeRequis ? el('label', { for: 'code' }, 'Code de vérification (appli d\'authentification)', code) : null,
    info.erreur || avis ? el('p', { class: 'err', role: 'alert' }, avis || info.erreur || '') : null,
    el('button', { class: 'bouton principal', type: 'submit' }, e.connexion === 'connexion' ? 'Connexion…' : 'Se connecter'),
    el('button', { class: 'lien', type: 'button', onclick: () => { if (adresse.value.trim()) void faire('navigateur', { adresse: adresse.value.trim() }); } }, 'Se connecter avec le navigateur'),
    el('p', { class: 'note' }, 'Ton mot de passe n\'est jamais gardé sur cet ordinateur : seule la session, chiffrée par le système.'));
}

function dessiner(): void {
  const racine = document.getElementById('appli')!; racine.replaceChildren();
  const e = etat; if (!e) return;
  if (e.connexion === 'aucune' || (e.connexion === 'connexion' && !e.personne)) { racine.append(ecranConnexion(e)); return; }
  const maj = e.store.filter((l) => l.majDispo && l.installee && l.mode !== 'retiree');
  const nav = el('nav', { 'aria-label': 'Store' },
    el('div', { class: 'qui' }, el('span', { class: 'avatar', 'aria-hidden': 'true' }, (e.personne?.nom ?? '?').slice(0, 1).toUpperCase()), el('span', {}, el('b', {}, e.personne?.nom ?? ''), el('small', {}, `${(e.personne?.groupes ?? []).join(', ')}${e.personne?.groupes?.length ? ' · ' : ''}${e.enLigne ? 'Odin connecté' : 'hors ligne'}`))),
    ...([['store', 'Mon store'], ['maj', 'Mises à jour'], ['histo', 'Historique']] as const).map(([k, t]) => el('button', { class: 'onglet', type: 'button', 'aria-current': onglet === k ? 'page' : undefined, onclick: () => { onglet = k; dessiner(); } }, t, k === 'maj' && maj.length ? el('span', { class: 'pastille' }, String(maj.length)) : null)),
    el('div', { class: 'bas' }, `${e.odin?.nom ?? 'Odin'} · ${e.appareil?.nom ?? ''}`, el('br'), el('button', { type: 'button', onclick: () => void faire('deconnecter') }, 'Se déconnecter')));
  const contenu: HTMLElement[] = [];
  const titre = onglet === 'store' ? 'Mon store' : onglet === 'maj' ? 'Mises à jour' : 'Historique';
  contenu.push(el('div', { class: 'tete' }, el('h1', {}, titre), el('span', { class: `ajour${e.enLigne ? '' : ' non'}` }, e.enLigne ? '✓ À jour avec Odin' : e.connexion === 'horsligne' ? 'Odin injoignable : nouvel essai bientôt' : 'Connexion…')));
  if (e.message && onglet === 'store') contenu.push(el('div', { class: 'message', role: 'status' }, el('span', {}, e.message), el('button', { type: 'button', 'aria-label': 'Fermer', onclick: () => void faire('fermerMessage') }, '✕')));
  if (avis) contenu.push(el('div', { class: 'message', role: 'alert' }, el('span', {}, avis), el('button', { type: 'button', 'aria-label': 'Fermer', onclick: () => { avis = ''; dessiner(); } }, '✕')));
  if (onglet === 'store') { const l = e.store.filter((x) => x.mode !== 'retiree' || x.installee || x.enCours); contenu.push(l.length ? el('div', { class: 'grille' }, ...l.map(carte)) : el('p', { class: 'vide' }, 'Ton store est vide pour l\'instant : un admin d\'Odin doit t\'ajouter à un groupe.')); }
  if (onglet === 'maj') contenu.push(maj.length ? el('div', { class: 'grille' }, ...maj.map(carte)) : el('p', { class: 'vide' }, 'Tout est à jour.'));
  if (onglet === 'histo') contenu.push(e.historique.length ? el('ul', { class: 'histo' }, ...e.historique.map((h) => el('li', { class: h.ok ? '' : 'non' }, el('time', {}, new Date(h.quand).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })), el('span', {}, h.texte)))) : el('p', { class: 'vide' }, 'Rien pour l\'instant.'));
  racine.append(nav, el('main', {}, ...contenu));
}

agora.surEtat((e) => { etat = e; dessiner(); });
void agora.etat().then((e) => { etat = e; dessiner(); });
