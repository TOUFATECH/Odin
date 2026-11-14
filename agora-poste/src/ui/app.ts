// L'écran d'Agora sur l'ordinateur (maquette validée « StorePC ») : Mon store, Mises à jour, Historique, et l'écran
// de connexion à Odin. Aucune donnée n'est interprétée comme du HTML : tout passe par textContent.
import { ciel } from './ciel.js';
import { odin, reduirePhoto } from './odin-visage.js';

interface Ligne { id: string; nom: string; desc: string; mode: 'proposee' | 'office' | 'retiree'; par: string; impose: boolean; installee: boolean; versionLocale?: string; versionOdin?: string; installable: boolean; web?: string; enCours?: { action: string; progression?: number }; erreur?: string; majDispo: boolean }
interface Etat { connexion: 'aucune' | 'connexion' | 'ok' | 'horsligne'; odin?: { adresse: string; nom: string }; personne?: { nom: string; login: string; groupes: string[] }; appareil?: { nom: string; plateforme: string }; store: Ligne[]; historique: Array<{ quand: number; texte: string; ok: boolean }>; message?: string; connexionInfo?: { erreur?: string; codeRequis?: boolean; trouves?: Array<{ adresse: string; nom: string }> }; enLigne: boolean; version: string }
interface Api { etat(): Promise<Etat>; surEtat(f: (e: Etat) => void): void; faire(a: string, arg?: Record<string, unknown>): Promise<{ ok: boolean; message?: string; photo?: string }> }
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

let etat: Etat | undefined, onglet: 'store' | 'maj' | 'histo' | 'odin' = 'store', occupe = new Set<string>(), avis = '', photo = '';
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

// Ce qui est tapé dans l'écran de connexion survit aux nouveaux dessins (l'état d'Agora change pendant qu'on tape).
const saisie = { adresse: '', identifiant: '', motdepasse: '', code: '' };
const logo = (taille: number) => el('img', { class: 'logo', src: 'agora-256.png', alt: '', width: String(taille), height: String(taille) });
/** Le fond noir étoilé des écrans d'accueil, avec son contenu par-dessus. */
function ecranEtoile(...contenu: HTMLElement[]): HTMLElement {
  const c = el('canvas', { class: 'ciel', 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const x = el('div', { class: 'ecran' }, c, ...contenu);
  requestAnimationFrame(() => ciel(c));
  return x;
}

function ecranConnexion(e: Etat): HTMLElement {
  const info = e.connexionInfo ?? {};
  if (!saisie.adresse) saisie.adresse = e.odin?.adresse ?? info.trouves?.[0]?.adresse ?? '';
  const champ = (id: keyof typeof saisie, a: Attrs) => { const i = el('input', { id, name: id, value: saisie[id], ...a }) as HTMLInputElement; i.addEventListener('input', () => { saisie[id] = i.value; }); return i; };
  const adresse = champ('adresse', { placeholder: 'https://192.168.1.10:7777', autocomplete: 'url', spellcheck: 'false' });
  const ident = champ('identifiant', { autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' }), mdp = champ('motdepasse', { type: 'password', autocomplete: 'current-password' });
  const code = champ('code', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '7' });
  const err = el('p', { class: 'err', role: 'alert' }, avis || info.erreur || '');
  // Nos propres messages, en français, à la place de la bulle du navigateur (le formulaire est « novalidate »).
  const manque = (i: HTMLInputElement, nom: string) => { err.textContent = `Remplis « ${nom} ».`; i.focus(); return true; };
  const envoyer = async (ev: Event) => {
    ev.preventDefault(); err.textContent = '';
    if (!adresse.value.trim()) { err.textContent = 'Indique l\'adresse d\'Odin (ou clique sur un Odin trouvé).'; adresse.focus(); return; }
    if (!ident.value.trim() && manque(ident, 'Identifiant ou e-mail')) return;
    if (!mdp.value && manque(mdp, 'Mot de passe')) return;
    if (info.codeRequis && !code.value.trim() && manque(code, 'Code de vérification')) return;
    avis = ''; saisie.motdepasse = ''; saisie.code = '';
    await faire('connecter', { adresse: adresse.value.trim(), identifiant: ident.value, motdepasse: mdp.value, code: code.value });
  };
  const navigateur = () => { if (!adresse.value.trim()) { err.textContent = 'Indique d\'abord l\'adresse d\'Odin (ou clique sur un Odin trouvé).'; adresse.focus(); return; } void faire('navigateur', { adresse: adresse.value.trim() }); };
  return ecranEtoile(el('form', { class: 'connexion', novalidate: true, onsubmit: (ev) => void envoyer(ev) },
    el('div', { class: 'titre' }, logo(56), el('h1', {}, 'Agora')), el('p', {}, 'Le store d\'Odin : connecte-toi avec ton compte Odin, et retrouve ici les applis auxquelles tu as droit.'),
    info.trouves?.length ? el('div', { class: 'trouves' }, ...info.trouves.map((t) => el('button', { type: 'button', onclick: () => { adresse.value = t.adresse; saisie.adresse = t.adresse; } }, `${t.nom} · ${t.adresse}`))) : el('button', { class: 'lien', type: 'button', onclick: () => void faire('trouver') }, 'Chercher Odin sur le réseau'),
    el('label', { for: 'adresse' }, 'Adresse d\'Odin', adresse),
    el('label', { for: 'identifiant' }, 'Identifiant ou e-mail', ident),
    el('label', { for: 'motdepasse' }, 'Mot de passe', mdp),
    info.codeRequis ? el('label', { for: 'code' }, 'Code de vérification (appli d\'authentification)', code) : null,
    err,
    el('button', { class: 'bouton principal', type: 'submit' }, e.connexion === 'connexion' ? 'Connexion…' : 'Se connecter'),
    el('button', { class: 'lien', type: 'button', onclick: navigateur }, 'Se connecter avec le navigateur'),
    el('p', { class: 'note' }, 'Ton mot de passe n\'est jamais gardé sur cet ordinateur : seule la session, chiffrée par le système.')));
}
/** Avant la première réponse du moteur : le logo sur le ciel étoilé. */
const ecranDemarrage = () => ecranEtoile(el('div', { class: 'centre', role: 'status', 'aria-label': 'Agora démarre' }, logo(104), el('p', {}, 'Agora démarre…')));

/** L'avatar : la photo choisie (gardée sur ce PC), ou Odin animé tant qu'il n'y en a pas. Un clic pour choisir la photo. */
function avatar(): HTMLElement {
  const fichier = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true }) as HTMLInputElement;
  fichier.addEventListener('change', async () => {
    const f = fichier.files?.[0]; if (!f) return;
    try { const ph = await reduirePhoto(f); const r = await faire('photo', { photo: ph }); if (r.ok) { photo = ph; dessiner(); } }
    catch { avis = 'Cette image ne se lit pas : choisis une photo JPG, PNG ou WebP.'; dessiner(); }
  });
  const dedans = photo ? el('img', { src: photo, alt: '' }) : el('span', { class: 'odin' }, odin());
  return el('button', { class: `avatar${photo ? ' photo' : ' odin'}`, type: 'button', title: photo ? 'Changer ta photo' : 'Choisir ta photo', 'aria-label': photo ? 'Ta photo : la changer' : 'Ton avatar (Odin) : choisir une photo', onclick: () => fichier.click() }, dedans, fichier);
}
/** Le point d'état d'Odin : vert = à jour, orange = Odin injoignable pour l'instant, rouge = pas d'Odin. Il ouvre la connexion à Odin. */
function pointOdin(e: Etat): HTMLElement {
  const [cl, txt] = e.connexion === 'aucune' ? ['rouge', 'Pas d\'Odin : Agora n\'est relié à aucun Odin'] : e.enLigne ? ['vert', 'Odin : à jour avec Agora'] : ['orange', 'Odin injoignable pour l\'instant : nouvel essai bientôt'];
  return el('button', { class: 'point-odin', type: 'button', title: txt, 'aria-label': txt, onclick: () => { onglet = 'odin'; dessiner(); } }, el('span', { class: `pt-etat ${cl}` }));
}
/** L'écran de la connexion à Odin (un seul) : où en est la liaison, réessayer, se déconnecter. */
function ecranOdin(e: Etat): HTMLElement {
  const ligne = (k: string, v: string) => el('div', { class: 'kv' }, el('span', {}, k), el('b', {}, v));
  return el('div', { class: 'carte-odin' },
    el('p', {}, e.enLigne ? 'Agora est à jour avec Odin : les installations demandées arrivent toutes seules.' : (e.connexionInfo?.erreur ?? 'Odin ne répond pas pour l\'instant : Agora réessaie tout seul, et rien n\'est perdu.')),
    ligne('Odin', `${e.odin?.nom ?? 'Odin'}${e.odin?.adresse ? ` · ${e.odin.adresse}` : ''}`),
    ligne('Compte', e.personne ? `${e.personne.nom}${e.personne.login ? ` (${e.personne.login})` : ''}` : '—'),
    ligne('Cet ordinateur', e.appareil?.nom ?? '—'),
    ligne('Agora', e.version),
    el('div', { class: 'actions' },
      el('button', { class: 'bouton principal', type: 'button', onclick: () => void faire('rafraichir') }, 'Réessayer maintenant'),
      el('button', { class: 'bouton', type: 'button', onclick: () => void faire('deconnecter') }, 'Se déconnecter')));
}

function dessiner(): void {
  const racine = document.getElementById('appli')!; racine.replaceChildren();
  const e = etat; if (!e) { racine.append(ecranDemarrage()); return; }
  if (e.connexion === 'aucune' || (e.connexion === 'connexion' && !e.personne)) { racine.append(ecranConnexion(e)); return; }
  saisie.motdepasse = '';
  const maj = e.store.filter((l) => l.majDispo && l.installee && l.mode !== 'retiree');
  const nav = el('nav', { 'aria-label': 'Store' },
    el('div', { class: 'marque' }, logo(28), el('b', {}, 'Agora')),
    el('div', { class: 'qui' }, avatar(), el('span', {}, el('b', {}, e.personne?.nom ?? ''), el('small', {}, `${(e.personne?.groupes ?? []).join(', ')}${e.personne?.groupes?.length ? ' · ' : ''}${e.enLigne ? 'Odin connecté' : 'hors ligne'}`))),
    ...([['store', 'Mon store'], ['maj', 'Mises à jour'], ['histo', 'Historique']] as const).map(([k, t]) => el('button', { class: 'onglet', type: 'button', 'aria-current': onglet === k ? 'page' : undefined, onclick: () => { onglet = k; dessiner(); } }, t, k === 'maj' && maj.length ? el('span', { class: 'pastille' }, String(maj.length)) : null)),
    el('div', { class: 'bas' }, `${e.odin?.nom ?? 'Odin'} · ${e.appareil?.nom ?? ''}`, el('br'), el('button', { type: 'button', onclick: () => void faire('deconnecter') }, 'Se déconnecter'),
      photo ? el('br') : null, photo ? el('button', { type: 'button', onclick: () => void faire('photo', { photo: '' }).then((r) => { if (r.ok) { photo = ''; dessiner(); } }) }, 'Retirer la photo') : null));
  const contenu: HTMLElement[] = [];
  const titre = onglet === 'store' ? 'Mon store' : onglet === 'maj' ? 'Mises à jour' : onglet === 'odin' ? 'Connexion à Odin' : 'Historique';
  contenu.push(el('div', { class: 'tete' }, el('h1', {}, titre), pointOdin(e), el('span', { class: `ajour${e.enLigne ? '' : ' non'}` }, e.enLigne ? '✓ À jour avec Odin' : e.connexion === 'horsligne' ? 'Odin injoignable : nouvel essai bientôt' : 'Connexion…')));
  if (e.message && onglet === 'store') contenu.push(el('div', { class: 'message', role: 'status' }, el('span', {}, e.message), el('button', { type: 'button', 'aria-label': 'Fermer', onclick: () => void faire('fermerMessage') }, '✕')));
  if (avis) contenu.push(el('div', { class: 'message', role: 'alert' }, el('span', {}, avis), el('button', { type: 'button', 'aria-label': 'Fermer', onclick: () => { avis = ''; dessiner(); } }, '✕')));
  if (onglet === 'store') { const l = e.store.filter((x) => x.mode !== 'retiree' || x.installee || x.enCours); contenu.push(l.length ? el('div', { class: 'grille' }, ...l.map(carte)) : el('p', { class: 'vide' }, 'Ton store est vide pour l\'instant : un admin d\'Odin doit t\'ajouter à un groupe.')); }
  if (onglet === 'maj') contenu.push(maj.length ? el('div', { class: 'grille' }, ...maj.map(carte)) : el('p', { class: 'vide' }, 'Tout est à jour.'));
  if (onglet === 'odin') contenu.push(ecranOdin(e));
  if (onglet === 'histo') contenu.push(e.historique.length ? el('ul', { class: 'histo' }, ...e.historique.map((h) => el('li', { class: h.ok ? '' : 'non' }, el('time', {}, new Date(h.quand).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })), el('span', {}, h.texte)))) : el('p', { class: 'vide' }, 'Rien pour l\'instant.'));
  racine.append(nav, el('main', {}, ...contenu));
}

dessiner();
void agora.faire('lirePhoto').then((r) => { if (r.photo) { photo = r.photo; dessiner(); } }).catch(() => undefined);
agora.surEtat((e) => { etat = e; dessiner(); });
void agora.etat().then((e) => { etat = e; dessiner(); });
