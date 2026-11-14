// L'interface de Pégase : barre du haut, barre de côté, zone des pages, menus, barre de commande.
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import './style.css';
import type { Etat, OngletVu, Bureau, Theme, Zone } from '../commun/types';
import { I } from './icones';
import { api, esc, APPS, appIcone, domaine, iconeSite, titreOnglet, setOdin, getOdin, quand, minutes, srcSure, couleurDe, type Ctx } from './commun';
import { pageInterne, rafraichirPages } from './pages';
import { rendreEcran } from './ecrans';

let E: Etat;
/** Cette page est-elle la vue des vignettes (vidéos qui suivent) plutôt que l'interface entière ? */
const VIGNETTES = location.hash === '#vignettes';
if (VIGNETTES) document.documentElement.classList.add('vignettes');
type Menu = { type: string; x: number; y: number; arg?: any; ancre?: DOMRect };
const L = {
  menu: null as Menu | null,
  commande: null as null | { q: string; sel: number; nouvel: boolean; resultats: Resultat[]; jeton: number; partage?: boolean },
  trouver: null as null | { texte: string; actif: number; total: number },
  survolBarre: false,
  toast: '' as string, toastMinuterie: 0 as any,
  glisse: null as null | { type: string; id: string },
  posVideo: {} as Record<string, { x: number; y: number }>,
  renommer: null as string | null,
  odinFil: [] as { moi: boolean; texte: string }[],
};

const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T | null;
const raccourci = (k: string) => (E?.plateforme === 'darwin' ? k.replace('Ctrl+', '⌘').replace('Maj+', '⇧') : k);

// ————— Rendu —————
const derniers: Record<string, string> = {};
function poser(id: string, html: string): boolean {
  if (derniers[id] === html) return false;
  derniers[id] = html; const el = document.getElementById(id); if (el) el.innerHTML = html; return true;
}

const ctx: Ctx = { etat: () => E, rendre: () => rendre(), toast: (t) => toast(t), ouvrir: (url, nouvel) => api.faire(nouvel ? 'ouvrir' : 'naviguer', nouvel ? { url } : { texte: url }) };

function ongletsEspace(): OngletVu[] { return E.onglets.filter((o) => o.espace === E.espaceActif); }
function courant(): OngletVu | null {
  const a = E.actif; if (!a) return null;
  if (a.type === 'onglet') return E.onglets.find((o) => o.id === a.id) ?? null;
  const b = E.bureaux.find((x) => x.id === a.id); if (!b) return null;
  const f = focusBureau && b.onglets.includes(focusBureau) ? focusBureau : b.onglets[0];
  return E.onglets.find((o) => o.id === f) ?? null;
}
let focusBureau: string | null = null;

function rendre(): void {
  if (!E) return;
  if (VIGNETTES) { rendreVignettes(); return; }
  const html = document.documentElement;
  html.dataset.theme = E.reglages.theme;
  html.dataset.clair = String(E.reglages.theme === 'blanc' || E.reglages.theme === 'glace');
  html.dataset.verre = E.plateforme === 'linux' ? 'non' : 'oui';
  html.classList.toggle('mac', E.plateforme === 'darwin');
  html.style.setProperty('--vitre', String((E.reglages.transparence ?? 60) / 100));
  setOdin(E.odin?.url);
  document.title = E.prive ? 'Pégase · fenêtre privée' : `${courant() ? titreOnglet(courant()!.url, courant()!.titre) + ' · ' : ''}Pégase`;
  rendreEcran(E, ctx);
  poser('haut', haut());
  rendreCorps();
  rendreCouche();
  requestAnimationFrame(envoyerZones);
}

function haut(): string {
  const c = courant();
  const win = E.plateforme !== 'darwin';
  const sync = E.synchro;
  const badgeSync = sync.etat === 'ok' ? '<span class="badge ok lisible" title="Tes favoris, onglets et réglages sont aussi sur Odin."><span class="pt"></span>Odin · synchronisé</span>'
    : sync.etat === 'encours' ? '<span class="badge attente lisible"><span class="pt"></span>synchronisation…</span>'
    : sync.etat === 'horsligne' ? `<span class="badge attente lisible" title="Les changements partiront dès qu’Odin répond."><span class="pt"></span>hors ligne (${sync.attente} en attente)</span>`
    : `<button class="badge local lisible" data-a="interne" data-page="synchro" title="Relie Pégase à ton Odin pour retrouver tout sur tes autres appareils."><span class="pt"></span>Sur ce PC seulement</button>`;
  const dl = E.telechargements.filter((t) => t.etat === 'reception' || t.etat === 'analyse').length;
  const bloque = E.telechargements.some((t) => t.etat === 'bloque' && Date.now() - t.quand < 600000);
  const protege = `<button class="badge ${bloque ? 'attente' : 'ok'} lisible" data-a="menu" data-menu="telechargements" aria-label="Asclépios : téléchargements analysés"><img src="${appIcone('ullr')}" alt="" width="18" height="18">Protégé${dl ? `<span class="nb">${dl}</span>` : ''}</button>`;
  const adresse = c ? (c.url.startsWith('pegase://') ? (c.url === 'pegase://accueil' ? 'Chercher ou saisir une adresse…' : c.url) : domaine(c.url)) : 'Chercher ou saisir une adresse…';
  const reduite = E.barreReduite;
  return `<div class="g">
      <button class="ib" data-a="menu" data-menu="pegase" aria-label="Menu de Pégase" aria-haspopup="menu">${I.aile()}</button>
      <button class="ib" data-a="barre" aria-label="${reduite ? 'Rouvrir la barre de côté' : 'Masquer la barre de côté'}" aria-pressed="${reduite}">${I.barre()}</button>
      <span class="espaceur"></span>
      <button class="ib" data-a="reculer" aria-label="Page précédente" ${c?.peutReculer ? '' : 'disabled'}>${I.recul()}</button>
      <button class="ib" data-a="avancer" aria-label="Page suivante" ${c?.peutAvancer ? '' : 'disabled'}>${I.avance()}</button>
      ${c?.charge ? `<button class="ib" data-a="arreter" aria-label="Arrêter le chargement">${I.arret(16)}</button>` : `<button class="ib" data-a="recharger" aria-label="Recharger" ${c ? '' : 'disabled'}>${I.recharger()}</button>`}
    </div>
    <div class="c">
      <button class="ib p" data-a="copierLien" aria-label="Copier le lien" ${c && !c.url.startsWith('pegase:') ? '' : 'disabled'}>${I.lien()}</button>
      <button class="adresse lisible" data-a="commande" data-nouvel="0" title="${esc(c?.url ?? '')}">${c && c.url.startsWith('https:') ? `<span class="cad">${I.cadenas(13)}</span>` : ''}<span class="ellipse">${esc(adresse)}</span></button>
      <button class="ib p" data-a="menu" data-menu="site" aria-label="Contrôles du site" ${c && /^https?:/.test(c.url) ? '' : 'disabled'}>${I.reglagesSite()}</button>
    </div>
    <div class="d">
      ${E.prive ? '<span class="badge local lisible">Fenêtre privée</span>' : badgeSync}
      ${protege}
      <button class="ib" data-a="menu" data-menu="profil" aria-label="Ton profil Odin"><span class="avatar c${E.profil.couleur % 8}" aria-hidden="true">${esc(E.profil.lettre)}</span></button>
      <button class="ib" data-a="panneauOdin" aria-label="Odin sur le côté" aria-pressed="${E.panneauOdin}"><img src="${appIcone('valhalla')}" alt="" width="20" height="20"></button>
      <button class="ib" data-a="partagerNouveau" aria-label="Écran partagé" ${c ? '' : 'disabled'}>${I.partage()}</button>
      ${win ? `<button class="fen" data-a="fenetre" data-op="min" aria-label="Réduire">${I.min()}</button>
      <button class="fen" data-a="fenetre" data-op="max" aria-label="${E.maximise ? 'Restaurer' : 'Agrandir'}">${E.maximise ? I.restaurer() : I.max()}</button>
      <button class="fen x" data-a="fenetre" data-op="fermer" aria-label="Fermer">${I.fermer()}</button>` : ''}
    </div>`;
}

// ————— Barre de côté —————
function barre(flottante: boolean): string {
  const ons = ongletsEspace();
  const espace = E.espaces.find((e) => e.id === E.espaceActif);
  const actifId = E.actif?.type === 'onglet' ? E.actif.id : null;
  const bureauActif = E.actif?.type === 'bureau' ? E.actif.id : null;
  const tuiles = E.tuiles.length
    ? E.tuiles.slice(0, 12).map((f) => {
      const ouvert = ons.find((o) => o.url === f.url);
      return `<button class="tuile${ouvert && ouvert.id === courant()?.id ? ' actif' : ''}" data-a="tuile" data-id="${esc(f.id)}" title="${esc(f.nom)}" aria-label="${esc(f.nom)}" draggable="true" data-drag="favori:${esc(f.id)}">${iconeSite(f.url, f.icone, f.nom, 'ic')}</button>`;
    }).join('')
    : '';
  const dossiers = E.dossiers.filter((d) => d.espace === E.espaceActif).sort((a, b) => a.ordre - b.ordre);
  const epingles = ons.filter((o) => o.epingle).sort((a, b) => a.ordre - b.ordre);
  const jour = ons.filter((o) => !o.epingle).sort((a, b) => a.ordre - b.ordre);
  const bureaux = E.bureaux.filter((b) => b.espace === E.espaceActif);
  const dansBureau = new Map<string, Bureau>(); for (const b of bureaux) for (const id of b.onglets) dansBureau.set(id, b);

  const ligneOnglet = (o: OngletVu, dans = false) => {
    const titre = L.renommer === o.id ? `<input class="champ renommer" data-renommer="${esc(o.id)}" value="${esc(o.titre)}" aria-label="Nouveau nom de l’onglet">` : `<span class="t ellipse">${esc(titreOnglet(o.url, o.titre))}</span>`;
    const etat = o.son ? `<button class="x etat" data-a="muet" data-id="${esc(o.id)}" aria-label="${o.muet ? 'Remettre le son' : 'Couper le son'}">${o.muet ? I.sonCoupe(15) : I.son(15)}</button>` : '';
    return `<div class="ligne${dans ? ' dans' : ''}${o.id === actifId ? ' actif' : ''}${o.enVeille ? ' dort' : ''}" role="button" tabindex="0" data-a="activer" data-id="${esc(o.id)}" data-menu-ctx="onglet" draggable="true" data-drag="onglet:${esc(o.id)}" data-drop="onglet:${esc(o.id)}" title="${esc(o.titre)}\n${esc(o.url)}${o.enVeille ? '\n(en veille : la page se recharge quand tu l’ouvres)' : ''}">
      ${o.charge ? '<span class="ic chargement" aria-hidden="true"></span>' : iconeSite(o.url, o.icone, o.titre)}${titre}${etat}
      <button class="x" data-a="fermer" data-id="${esc(o.id)}" aria-label="Fermer l’onglet ${esc(o.titre)}">${I.fermer(12)}</button></div>`;
  };
  const ligneBureau = (b: Bureau) => {
    const ol = b.onglets.map((id) => E.onglets.find((o) => o.id === id)).filter(Boolean) as OngletVu[];
    const noms = ol.map((o) => titreOnglet(o.url, o.titre)).join(', ');
    return `${b.nom ? `<div class="groupe-nom">${I.bureau(13)}${esc(b.nom)} · ${ol.length} pages</div>` : ''}<button class="groupe${b.id === bureauActif ? ' actif' : ''}" data-a="activerBureau" data-id="${esc(b.id)}" data-menu-ctx="bureau" aria-label="Groupe de ${ol.length} pages : ${esc(noms)}">
      ${ol.map((o, i) => `${i ? '<span class="sep" aria-hidden="true"></span>' : ''}<span class="m">${iconeSite(o.url, o.icone, o.titre)}<span class="ellipse">${esc(titreOnglet(o.url, o.titre))}</span></span>`).join('')}</button>`;
  };
  const vusBureau = new Set<string>();
  const lignesJour = jour.map((o) => {
    const b = dansBureau.get(o.id);
    if (b) { if (vusBureau.has(b.id)) return ''; vusBureau.add(b.id); return ligneBureau(b); }
    return ligneOnglet(o);
  }).join('');
  const blocDossier = (d: typeof dossiers[0]) => `<div class="ligne dossier" role="button" tabindex="0" data-a="dossier" data-id="${esc(d.id)}" data-menu-ctx="dossier" aria-expanded="${d.ouvert}" data-drop="dossier:${esc(d.id)}" draggable="true" data-drag="dossier:${esc(d.id)}">${I.dossier(20)}<span class="t ellipse">${esc(d.nom)}</span></div>
      ${d.ouvert ? epingles.filter((o) => o.dossier === d.id).map((o) => ligneOnglet(o, true)).join('') : ''}`;
  const sansDossier = epingles.filter((o) => !o.dossier || !dossiers.some((d) => d.id === o.dossier));

  return `<nav class="barre${flottante ? ' flottante' : ''}" aria-label="Favoris, espace et onglets" id="nav">
    <div class="tuiles" aria-label="Favoris" data-drop="tuiles">${tuiles || '<div class="tuiles-vide">Glisse un onglet ici pour l’avoir toujours sous la main.</div>'}</div>
    <div class="defile">
      <div class="nom-espace lisible" data-drop="epingles"><span class="pt" aria-hidden="true"></span><b>${esc(espace?.nom ?? '')}</b></div>
      <div class="liste" data-drop="epingles">${dossiers.map(blocDossier).join('')}${sansDossier.map((o) => ligneOnglet(o)).join('')}</div>
      <div class="separateur"><span></span><button data-a="ranger" title="Range les onglets du jour de cet espace dans la boîte en bas.">${I.ranger()}Ranger</button></div>
      <div class="liste" data-drop="jour">
        <button class="ligne nouvel" data-a="commande" data-nouvel="1">${I.plus()}Nouvel onglet</button>
        ${lignesJour}
      </div>
    </div>
    <div class="bas">
      <button class="ib" data-a="menu" data-menu="ranges" aria-label="Onglets rangés">${I.boite()}</button>
      <div class="espaces" role="group" aria-label="Espaces de travail">${E.espaces.map((e, i) => `<button class="esp" data-a="espace" data-id="${esc(e.id)}" data-menu-ctx="espace" data-drop="espace:${esc(e.id)}" aria-label="Espace ${esc(e.nom)}${i < 9 ? ` (${raccourci('Ctrl+' + (i + 1))})` : ''}" title="${esc(e.nom)}" aria-pressed="${e.id === E.espaceActif}"><span class="c${e.couleur % 8}" aria-hidden="true"></span></button>`).join('')}</div>
      <button class="ib" data-a="menu" data-menu="plus" aria-label="Nouveau : espace, dossier, onglet">${I.plus()}</button>
    </div>
  </nav>`;
}

// ————— Zone des pages —————
let interneMonte: { cle: string; el: HTMLElement } | null = null;
function rendreCorps(): void {
  const reduite = E.barreReduite;
  document.getElementById('app')!.classList.toggle('reduite', reduite);
  const montrerBarre = !reduite || L.survolBarre;
  const a = E.actif;
  let pagesHtml = '';
  let ids: string[] = [];
  let disposition = '';
  if (a?.type === 'bureau') {
    const b = E.bureaux.find((x) => x.id === a.id);
    if (b) { ids = b.onglets; disposition = b.disposition; }
  } else if (a?.type === 'onglet') ids = [a.id];
  const partage = ids.length > 1;
  const c = courant();
  if (!ids.length) pagesHtml = `<section class="cadre-page"><div class="interne" data-interne="accueil"></div></section>`;
  else pagesHtml = ids.map((id) => {
    const o = E.onglets.find((x) => x.id === id); if (!o) return '';
    const interne = o.url.startsWith('pegase://');
    const tete = partage || reduite ? `<div class="tete-page">
        <button class="ib" data-a="reculer" data-id="${esc(o.id)}" aria-label="Page précédente" ${o.peutReculer ? '' : 'disabled'}>${I.recul(16)}</button>
        <button class="ib" data-a="recharger" data-id="${esc(o.id)}" aria-label="Recharger">${I.recharger(15)}</button>
        <span class="dom" data-a="focusPage" data-id="${esc(o.id)}">${esc(interne ? titreOnglet(o.url, o.titre) : domaine(o.url))}</span>
        ${partage ? `<button class="ib" data-a="agrandirPage" data-id="${esc(o.id)}" aria-label="Agrandir cette page">${I.agrandir(15)}</button>
        <button class="ib" data-a="retirerPage" data-id="${esc(o.id)}" aria-label="Retirer cette page de l'écran partagé">${I.retirer(15)}</button>` : `<button class="ib" data-a="menu" data-menu="site" aria-label="Contrôles du site">${I.reglagesSite(16)}</button>`}
      </div>` : '';
    const corps = interne ? `<div class="interne" data-interne="${esc(o.url.slice(9))}" data-onglet="${esc(o.id)}"></div>`
      : o.plante ? `<div class="zone-web"><div class="plante"><b>Cette page s’est arrêtée.</b><span>Elle a peut-être manqué de mémoire. Tu peux la relancer.</span><button class="bouton plein" data-a="recharger" data-id="${esc(o.id)}">Relancer la page</button></div></div>`
      : `<div class="zone-web" data-zone="${esc(o.id)}"><div class="attente">${o.enVeille ? 'Réveil de la page…' : 'Chargement…'}</div></div>`;
    return `<section class="cadre-page${partage || reduite ? ' partage' : ''}${partage && c?.id === o.id ? ' focus' : ''}" aria-label="${esc(domaine(o.url))}" data-section="${esc(o.id)}">${tete}${corps}</section>`;
  }).join('');
  const html = `${montrerBarre && !reduite ? barre(false) : ''}${reduite ? `<div class="bord-gauche" data-survol-barre="1" aria-hidden="true"></div>${L.survolBarre ? barre(true) : ''}` : ''}
    <main class="pages ${partage ? disposition : ''}" id="pages">${pagesHtml}</main>
    ${E.panneauOdin ? panneauOdin() : ''}`;
  if (poser('corps', html)) interneMonte = null;
  // Les pages pegase:// sont montées une fois, puis gardent leur état (champs, défilement).
  for (const el of document.querySelectorAll<HTMLElement>('[data-interne]')) {
    const cle = `${el.dataset.interne}|${el.dataset.onglet ?? ''}`;
    if (el.dataset.monte === cle) continue;
    el.dataset.monte = cle;
    pageInterne(el, el.dataset.interne!.replace(/\/.*$/, ''), ctx);
    interneMonte = { cle, el };
  }
  void interneMonte;
  rafraichirPages();
  const r = $<HTMLInputElement>('input.renommer'); if (r && document.activeElement !== r) { r.focus(); r.select(); }
}

function panneauOdin(): string {
  const fil = L.odinFil.length ? L.odinFil.map((m) => `<div class="bulle${m.moi ? ' moi' : ''}">${esc(m.texte)}</div>`).join('')
    : `<p class="doux">${E.odin?.connecte ? 'Demande-moi ce que tu veux, ou fais-moi résumer la page.' : 'Pégase n’est pas encore relié à ton Odin. Relie-le dans Réglages → Synchro Odin.'}</p>`;
  return `<aside class="panneau-odin" aria-label="Odin">
    <div class="po-tete"><img src="${appIcone('valhalla')}" alt="" width="26" height="26"><b>Odin</b><span class="doux petit t">${E.odin?.connecte ? esc(E.odin.nom) : 'pas relié'}</span>
      <button class="ib" data-a="panneauOdin" aria-label="Fermer le panneau d’Odin">${I.fermer()}</button></div>
    <div class="rangee po-actions"><button class="bouton" data-a="odinResumer">Résumer la page</button><button class="bouton" data-a="odinVerifier">Vérifie ce site</button></div>
    <div class="po-fil" id="po-fil">${fil}</div>
    <form data-form="odin"><textarea name="texte" placeholder="Demander à Odin…" aria-label="Demander à Odin"></textarea><button class="ib" type="submit" aria-label="Envoyer">${I.envoyer(18)}</button></form>
  </aside>`;
}

function videos(): string {
  return E.videos.map((v, i) => {
    const pos = L.posVideo[v.onglet];
    const o = E.onglets.find((x) => x.id === v.onglet);
    const titre = `${v.titre || o?.titre || 'Vidéo'}${o ? ' · ' + domaine(o.url) : ''}`;
    const pct = v.duree ? Math.min(100, (v.temps / v.duree) * 100) : 0;
    return `<section class="video" data-video="${esc(v.onglet)}" data-i="${i}" aria-label="Vidéo qui te suit : ${esc(titre)}" ${pos ? '' : ''}>
      <div class="vt" data-glisser-video="${esc(v.onglet)}">
        <button class="vb" data-a="video" data-op="retour" data-id="${esc(v.onglet)}" aria-label="Retourner à l'onglet de la vidéo">${I.retour(16)}</button>
        <h2 class="ellipse">${esc(titre)}</h2>
        <button class="vb" data-a="video" data-op="pip" data-id="${esc(v.onglet)}" aria-label="Sortir la vidéo dans sa propre petite fenêtre">${I.pip(16)}</button>
        <button class="vb" data-a="video" data-op="fermer" data-id="${esc(v.onglet)}" aria-label="Fermer la vidéo">${I.fermer(13)}</button>
      </div>
      <div class="vz" data-zone-video="${esc(v.onglet)}"></div>
      <div class="vc">
        <button class="vb" data-a="video" data-op="reculer" data-id="${esc(v.onglet)}" aria-label="Reculer de 10 secondes">${I.moins10(20)}</button>
        <button class="vb jouer" data-a="video" data-op="basculer" data-id="${esc(v.onglet)}" aria-label="${v.lecture ? 'Pause' : 'Lecture'}">${v.lecture ? I.pause(16) : I.lecture(16)}</button>
        <button class="vb" data-a="video" data-op="avancer" data-id="${esc(v.onglet)}" aria-label="Avancer de 10 secondes">${I.plus10(20)}</button>
        <span>${minutes(v.temps)}</span><span class="prog" aria-hidden="true"><span data-pct="${pct.toFixed(1)}"></span></span><span>${minutes(v.duree)}</span>
        <button class="vb" data-a="video" data-op="muet" data-id="${esc(v.onglet)}" aria-label="${v.muet ? 'Remettre le son' : 'Couper le son'}">${v.muet ? I.sonCoupe(16) : I.son(16)}</button>
      </div></section>`;
  }).join('');
}

/** Barres de progression des vidéos. */
function placerVideos(): void {
  for (const pr of document.querySelectorAll<HTMLElement>('.video [data-pct], .barre-prog [data-pct]')) pr.style.width = `${pr.dataset.pct}%`;
}

/** La vue des vignettes : les vidéos qui suivent, empilées ; la vidéo elle-même est posée par-dessus, dans le trou. */
function rendreVignettes(): void {
  document.documentElement.dataset.theme = E.reglages.theme;
  if (!poser('app', `<div class="pile-videos">${videos()}</div>`)) { /* rien de neuf */ }
  placerVideos();
  const z: Zone[] = [];
  for (const el of document.querySelectorAll<HTMLElement>('[data-zone-video]')) { const r = el.getBoundingClientRect(); z.push({ id: el.dataset.zoneVideo!, x: r.left, y: r.top, w: r.width, h: r.height }); }
  const cle = JSON.stringify(z); if (cle !== derniereZones) { derniereZones = cle; api.zones(z, false); }
}

// ————— Les pages web posées sur la fenêtre —————
let derniereZones = '';
function envoyerZones(): void {
  if (VIGNETTES) { rendreVignettes(); return; }
  placerFlottants();
  const z: Zone[] = [];
  const ouvert = !!(L.menu || L.commande || L.survolBarre || ecranOuvert() || document.querySelector('.boite-dialogue'));
  for (const el of document.querySelectorAll<HTMLElement>('[data-zone]')) {
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    z.push({ id: el.dataset.zone!, x: r.left, y: r.top, w: r.width, h: r.height });
  }
  if (ecranOuvert()) z.length = 0;
  // Le cadre (fond du thème) est percé à l'endroit des pages : quand un menu passe devant, on voit la page dessous.
  const W = innerWidth, H = innerHeight;
  const trous = z.map((r) => { const x = r.x, y = r.y, w = r.w, h = r.h, k = Math.min(10, w / 2, h / 2); return `M${x + k} ${y}H${x + w - k}A${k} ${k} 0 0 1 ${x + w} ${y + k}V${y + h - k}A${k} ${k} 0 0 1 ${x + w - k} ${y + h}H${x + k}A${k} ${k} 0 0 1 ${x} ${y + h - k}V${y + k}A${k} ${k} 0 0 1 ${x + k} ${y}Z`; }).join('');
  const cadre = document.getElementById('cadre')!;
  cadre.style.clipPath = z.length ? `path(evenodd, "M0 0H${W}V${H}H0Z${trous}")` : '';
  for (const el of document.querySelectorAll<HTMLElement>('[data-zone] .attente')) el.style.visibility = ouvert ? 'hidden' : '';
  const cle = JSON.stringify([z, ouvert]);
  if (cle === derniereZones) return;
  derniereZones = cle;
  api.zones(z, ouvert);
}
new ResizeObserver(() => requestAnimationFrame(envoyerZones)).observe(document.documentElement);
addEventListener('resize', () => requestAnimationFrame(envoyerZones));

// ————— Couche du dessus : menus, barre de commande, recherche dans la page —————
function rendreCouche(): void {
  let h = '';
  if (L.commande) h += `<div class="voile sombre" data-a="fermerCouche"></div>${commande()}`;
  else if (L.menu) h += `<div class="voile" data-a="fermerCouche"></div>${menus()}`;
  if (L.trouver) h += `<div class="flottant trouver" role="search"><input class="champ" id="trouver" placeholder="Chercher dans la page" value="${esc(L.trouver.texte)}" aria-label="Chercher dans la page"><span class="doux petit">${L.trouver.total ? `${L.trouver.actif}/${L.trouver.total}` : ''}</span><button class="ib p" data-a="trouverSuite" data-sens="-1" aria-label="Précédent">${I.recul(15)}</button><button class="ib p" data-a="trouverSuite" data-sens="1" aria-label="Suivant">${I.avance(15)}</button><button class="ib p" data-a="trouverFermer" aria-label="Fermer la recherche">${I.fermer(12)}</button></div>`;
  if (L.toast) h += `<div class="toast" role="status">${esc(L.toast)}</div>`;
  const change = poser('couche', h);
  if (change) {
    const ci = $<HTMLInputElement>('#commande-q');
    if (ci && document.activeElement !== ci) { ci.focus(); ci.setSelectionRange(ci.value.length, ci.value.length); }
    const t = $<HTMLInputElement>('#trouver'); if (t && L.trouver && !L.trouver.texte && document.activeElement !== t) t.focus();
    const m = $('.flottant[role="menu"] button, .flottant[role="dialog"] button'); if (m && L.menu && !document.querySelector('.flottant')?.contains(document.activeElement)) (m as HTMLElement).focus({ preventScroll: true });
  }
}

/** Les menus se posent près du bouton qui les ouvre, sans dépasser de la fenêtre. */
function placerFlottants(): void {
  const el = $<HTMLElement>('#couche .flottant:not(.trouver)'); if (!el || !L.menu) return;
  const m = L.menu; const w = el.offsetWidth, h = el.offsetHeight;
  let x = m.x, y = m.y;
  if (m.ancre && el.dataset.ancre) { x = m.ancre.left; y = m.ancre.bottom + 6; if (el.dataset.ancre === 'droite') x = m.ancre.right - w; if (el.dataset.ancre === 'haut') { y = m.ancre.top - h - 6; } }
  x = Math.max(8, Math.min(innerWidth - w - 8, x)); y = Math.max(8, Math.min(innerHeight - h - 8, y));
  el.style.left = `${x}px`; el.style.top = `${y}px`;
}

const NOMS_THEMES: Record<Theme, string> = { noir: 'Noir', blanc: 'Blanc', bleu: 'Bleu', rouge: 'Rouge', transparent: 'Transparent', glace: 'Glace' };
function menus(): string {
  const m = L.menu!;
  const item = (a: string, icone: string, texte: string, extra = '', kbd = '', attrs = '') => `<button class="item" role="menuitem" data-a="${a}" ${attrs}>${icone}<span class="ellipse">${texte}</span>${extra}${kbd ? `<span class="kbd">${raccourci(kbd)}</span>` : ''}</button>`;
  if (m.type === 'pegase') {
    const t = E.reglages.theme;
    return `<div class="flottant" role="menu" aria-label="Menu de Pégase" data-ancre="gauche">
      <div class="tete-menu"><span class="avatar c${E.profil.couleur % 8}">${esc(E.profil.lettre)}</span><div class="ellipse"><b>${esc(E.profil.nom)}</b><div class="petit doux">${E.odin?.connecte ? 'Compte Odin · synchronisé' : 'Sur ce PC'}</div></div><button class="bouton" data-a="interne" data-page="profil">Changer</button></div>
      <div class="trio"><button data-a="commande" data-nouvel="1">Onglet<small>${raccourci('Ctrl+T')}</small></button><button data-a="fenetre" data-op="nouvelle">Fenêtre<small>${raccourci('Ctrl+N')}</small></button><button data-a="fenetre" data-op="privee">Privée<small>${raccourci('Ctrl+Maj+N')}</small></button></div>
      <div class="titre">Couleur du navigateur · ${NOMS_THEMES[t]}</div>
      <div class="nuancier" role="group" aria-label="Couleur du navigateur">${(['noir', 'blanc', 'bleu', 'rouge', 'transparent', 'glace'] as Theme[]).map((x) => `<button class="nuance n-${x}" data-a="theme" data-theme="${x}" aria-label="${NOMS_THEMES[x]}" title="${NOMS_THEMES[x]}" aria-pressed="${x === t}"></button>`).join('')}<button class="nuance n-auto" data-a="theme" data-theme="auto" aria-label="Auto : suit le système" title="Auto"></button></div>
      <hr>
      ${item('menu', I.espaces(), 'Espaces de travail', I.fleche(), '', 'data-menu="espaces"')}
      ${item('interne', I.onglets(), 'Historique', '', 'Ctrl+Y', 'data-page="historique"')}
      ${item('interne', I.etoile(), 'Favoris', '', 'Ctrl+Maj+O', 'data-page="favoris"')}
      ${item('interne', I.telecharger(), 'Téléchargements', '', 'Ctrl+J', 'data-page="telechargements"')}
      ${item('interne', I.agenda(), 'Agenda', '', '', 'data-page="agenda"')}
      ${item('interne', I.importer(), 'Importer depuis un autre navigateur', '', '', 'data-page="importer"')}
      ${item('defaut', I.coeur(), 'Pégase, navigateur par défaut')}
      ${item('majPegase', I.maj(), 'Chercher une mise à jour')}
      ${item('interne', I.reglages(), 'Réglages', '', 'Ctrl+,', 'data-page="reglages"')}
      ${item('imprimer', I.imprimer(), 'Imprimer', '', 'Ctrl+P')}
      ${item('outilsDev', I.dev(), 'Développeur', '', 'Ctrl+Maj+I')}
      ${item('interne', I.aide(), 'Aide', '', '', 'data-page="aide"')}
      ${E.odin?.connecte ? item('deconnexion', I.sortir(), 'Se déconnecter') : ''}
    </div>`;
  }
  if (m.type === 'espaces') {
    return `<div class="flottant" role="menu" aria-label="Espaces de travail" data-ancre="gauche">
      <div class="titre">Espaces de travail</div>
      ${E.espaces.map((e, i) => `<button class="item" role="menuitem" data-a="espace" data-id="${esc(e.id)}"><span class="ltr c${e.couleur % 8}"></span><span class="ellipse">${esc(e.nom)}</span><span class="det">${E.onglets.filter((o) => o.espace === e.id).length} onglets</span><span class="kbd">${i < 9 ? raccourci('Ctrl+' + (i + 1)) : ''}</span></button>`).join('')}
      <hr>${item('nouvelEspace', I.plus(), 'Nouvel espace de travail')}
    </div>`;
  }
  if (m.type === 'plus') {
    return `<div class="flottant" role="menu" aria-label="Nouveau" data-ancre="haut">
      ${item('commande', I.plus(), 'Onglet', '', 'Ctrl+T', 'data-nouvel="1"')}
      ${item('nouvelEspace', I.espaces(), 'Espace de travail', '<span class="det">sa couleur, ses onglets</span>')}
      ${item('nouveauDossier', I.dossier(18), 'Dossier', '<span class="det">pour ranger les épinglés</span>')}
      ${item('partagerNouveau', I.bureau(), 'Bureau', '<span class="det">jusqu’à 4 pages, gardé</span>')}
    </div>`;
  }
  if (m.type === 'ranges') {
    const q = (m.arg?.q ?? '').toLowerCase();
    const l = E.ranges.filter((r) => !q || r.titre.toLowerCase().includes(q) || r.url.toLowerCase().includes(q)).slice(0, 30);
    return `<div class="flottant" role="dialog" aria-label="Onglets rangés" data-ancre="haut">
      <div class="titre">Onglets rangés · la boîte en bas</div>
      <div class="ranges-q"><input class="champ" data-champ="ranges" placeholder="Chercher dans les onglets rangés" value="${esc(m.arg?.q ?? '')}" aria-label="Chercher dans les onglets rangés"></div>
      ${l.length ? l.map((r) => `<button class="item" data-a="rouvrir" data-id="${esc(r.id)}">${iconeSite(r.url, undefined, r.titre)}<span class="ellipse">${esc(r.titre)}</span><span class="kbd">${quand(r.quand)}</span></button>`).join('') : '<p class="doux petit vide-menu">Rien de rangé pour l’instant.</p>'}
      <hr><p class="doux petit note-menu">Les onglets non épinglés se rangent seuls après ${E.reglages.rangerHeures} heures (réglable).</p>
    </div>`;
  }
  if (m.type === 'onglet') {
    const o = E.onglets.find((x) => x.id === m.arg); if (!o) return '';
    const b = E.bureaux.find((x) => x.onglets.includes(o.id));
    const autres = E.espaces.filter((e) => e.id !== o.espace);
    return `<div class="flottant" role="menu" aria-label="Onglet ${esc(o.titre)}">
      <div class="tete-menu">${iconeSite(o.url, o.icone, o.titre)}<b class="ellipse">${esc(titreOnglet(o.url, o.titre))}</b></div>
      ${item('copierLien', I.lien(), 'Copier le lien', '', '', `data-id="${esc(o.id)}"`)}
      ${item('renommer', I.crayon(), 'Renommer', '', '', `data-id="${esc(o.id)}"`)}
      ${item('muet', o.muet ? I.son() : I.sonCoupe(), o.muet ? 'Remettre le son' : 'Couper le son', '', '', `data-id="${esc(o.id)}"`)}
      ${b ? item('retirerPage', I.partage(), 'Sortir de l’écran partagé', '', '', `data-id="${esc(o.id)}"`) : item('partagerAvec', I.partage(), 'Ouvrir en écran partagé', '', '', `data-id="${esc(o.id)}"`)}
      ${item('pip', I.pip(), 'Vidéo en petite fenêtre', '', '', `data-id="${esc(o.id)}"`)}
      ${item('dupliquer', I.dupliquer(), 'Dupliquer', '', '', `data-id="${esc(o.id)}"`)}
      ${item('epingler', I.epingle(), o.epingle ? 'Désépingler' : 'Épingler', '', '', `data-id="${esc(o.id)}"`)}
      ${item('favori', I.etoile(), E.tuiles.some((f) => f.url === o.url) ? 'Retirer des favoris' : 'Ajouter aux favoris', '', 'Ctrl+D', `data-id="${esc(o.id)}"`)}
      ${autres.length ? `<div class="titre">Déplacer vers un espace</div>${autres.map((e) => item('deplacerEspace', `<span class="ltr c${e.couleur % 8}"></span>`, esc(e.nom), '', '', `data-id="${esc(o.id)}" data-espace="${esc(e.id)}"`)).join('')}` : ''}
      <hr>${item('fermer', I.fermer(), 'Fermer', '', 'Ctrl+W', `data-id="${esc(o.id)}"`)}
    </div>`;
  }
  if (m.type === 'bureau') {
    const b = E.bureaux.find((x) => x.id === m.arg); if (!b) return '';
    return `<div class="flottant" role="menu" aria-label="Écran partagé">
      <div class="titre">Écran partagé · ${b.onglets.length} pages</div>
      ${item('disposition', I.ligne(), 'Côte à côte', '', '', `data-id="${esc(b.id)}" data-disposition="ligne"`)}
      ${item('disposition', I.colonne(), 'L’une sur l’autre', '', '', `data-id="${esc(b.id)}" data-disposition="colonne"`)}
      ${b.onglets.length > 2 ? item('disposition', I.grille(), 'En grille', '', '', `data-id="${esc(b.id)}" data-disposition="grille"`) : ''}
      ${b.onglets.length < 4 ? item('ajouterPage', I.plus(), 'Ajouter une page', '', '', `data-id="${esc(b.id)}"`) : ''}
      ${item('nommerBureau', I.crayon(), b.nom ? 'Renommer le bureau' : 'Garder comme bureau (le nommer)', '', '', `data-id="${esc(b.id)}"`)}
      ${item('defaireBureau', I.retirer(), 'Séparer les pages', '', '', `data-id="${esc(b.id)}"`)}
    </div>`;
  }
  if (m.type === 'dossier') {
    return `<div class="flottant" role="menu" aria-label="Dossier">
      ${item('renommerDossier', I.crayon(), 'Renommer', '', '', `data-id="${esc(m.arg)}"`)}
      ${item('supprDossier', I.corbeille(), 'Supprimer le dossier (les onglets restent)', '', '', `data-id="${esc(m.arg)}"`)}
    </div>`;
  }
  if (m.type === 'espace') {
    const e = E.espaces.find((x) => x.id === m.arg); if (!e) return '';
    return `<div class="flottant" role="menu" aria-label="Espace ${esc(e.nom)}" data-ancre="haut">
      <div class="titre">Espace ${esc(e.nom)}</div>
      ${item('renommerEspace', I.crayon(), 'Renommer', '', '', `data-id="${esc(e.id)}"`)}
      <div class="nuancier">${[0, 1, 2, 3, 4, 5, 6, 7].map((c) => `<button class="nuance c${c}" data-a="couleurEspace" data-id="${esc(e.id)}" data-c="${c}" aria-label="Couleur ${c + 1}" aria-pressed="${e.couleur === c}"></button>`).join('')}</div>
      <div class="titre">Couleur du navigateur dans cet espace</div>
      <div class="nuancier">${(['noir', 'blanc', 'bleu', 'rouge', 'transparent', 'glace'] as Theme[]).map((x) => `<button class="nuance n-${x}" data-a="themeEspace" data-id="${esc(e.id)}" data-theme="${x}" aria-label="${NOMS_THEMES[x]}" aria-pressed="${e.theme === x}"></button>`).join('')}<button class="nuance n-auto" data-a="themeEspace" data-id="${esc(e.id)}" data-theme="" aria-label="Comme le reste du navigateur" aria-pressed="${!e.theme}"></button></div>
      ${E.espaces.length > 1 ? `<hr>${item('supprEspace', I.corbeille(), 'Supprimer l’espace (ses onglets vont dans un autre)', '', '', `data-id="${esc(e.id)}"`)}` : ''}
    </div>`;
  }
  if (m.type === 'site') return menuSite();
  if (m.type === 'telechargements') return menuTelechargements();
  if (m.type === 'profil') {
    return `<div class="flottant" role="menu" aria-label="Ton profil" data-ancre="droite">
      <div class="tete-menu"><span class="avatar c${E.profil.couleur % 8}">${esc(E.profil.lettre)}</span><div class="ellipse"><b>${esc(E.profil.nom)}</b><div class="petit doux">${E.profil.email ? esc(E.profil.email) : 'Profil de ce PC'}</div></div></div>
      ${item('interne', I.profil(18), 'Ton profil', '', '', 'data-page="profil"')}
      ${item('interne', I.reglages(), 'Synchro Odin', '', '', 'data-page="synchro"')}
      ${item('fenetre', I.oeil(), 'Fenêtre privée', '', 'Ctrl+Maj+N', 'data-op="privee"')}
    </div>`;
  }
  return '';
}

let infosSite: any = null;
function menuSite(): string {
  const c = courant(); if (!c) return '';
  const s = infosSite && infosSite.url === c.url ? infosSite : { domaine: domaine(c.url), bloques: c.bloques, securise: c.securise };
  const p = E.protection;
  return `<div class="flottant carte-site" role="dialog" aria-label="Contrôles du site" data-ancre="droite">
    <div class="tete-menu">${iconeSite(c.url, c.icone, c.titre)}<b class="ellipse">${esc(s.domaine)}</b></div>
    <div class="titre">Contrôles du site</div>
    <button class="item" data-a="copierLien">${I.partager()}<span>Partager le lien</span></button>
    <hr><div class="titre">${I.bouclier(14)} Bouclier</div>
    <div class="ligne-site"><div>Adresse demandée à</div><span class="val">${esc(p.dns)}${p.dnsChiffre ? ', chiffré' : ''}</span></div>
    <div class="ligne-site"><div>Pubs et pisteurs bloqués</div><span class="val">${c.bloques}</span></div>
    <div class="segments" role="group" aria-label="Niveau du bloqueur">${(['coupe', 'normal', 'strict'] as const).map((n) => `<button data-a="reglage" data-cle="bloqueur" data-valeur="${n}" aria-pressed="${E.reglages.bloqueur === n}">${n === 'coupe' ? 'Coupé' : n === 'normal' ? 'Normal' : 'Strict'}</button>`).join('')}</div>
    <div class="ligne-site"><div>Bandeau de cookies</div><span class="val">${E.reglages.cookiesRefus ? 'refusé tout seul' : 'à toi de choisir'}</span></div>
    <hr>
    <label class="ligne-site"><div>Vidéo en petite fenêtre automatique</div><input type="checkbox" class="interrupteur" data-reglage="videoAuto" ${E.reglages.videoAuto ? 'checked' : ''}></label>
    <div class="ligne-site">${I.cadenas()}<div>${s.securise ? 'Sécurisé' : 'Pas sécurisé : ce que tu tapes ici peut être lu en chemin.'}</div></div>
    <button class="item" data-a="effacerSite">${I.corbeille()}<span>Effacer les cookies et données de ce site</span></button>
  </div>`;
}

function menuTelechargements(): string {
  const l = E.telechargements;
  const ligne = (t: Etat['telechargements'][0]) => {
    const det = t.etat === 'sain' ? `<span class="ok">✓ Analysé · ✓ Enregistré</span>` : t.etat === 'bloque' ? `<span class="ko">Bloqué</span> · ${esc(t.detail)}` : t.etat === 'analyse' ? `<span class="encours">analyse…</span> · Gardé à part pendant l’analyse` : t.etat === 'reception' ? `<span class="encours">réception…</span>` : esc(t.detail);
    const pct = t.taille ? Math.round((t.recu / t.taille) * 100) : 0;
    return `<div class="dl">${I.telecharger()}<div class="corps-dl"><div class="nom ellipse">${esc(t.nom)}</div><div class="petit doux">${t.taille ? esc(String(Math.round(t.taille / 1024 / 1024 * 10) / 10).replace('.', ',')) + ' Mo · ' : ''}${det}</div>${t.etat === 'reception' ? `<div class="barre-prog"><span data-pct="${pct}"></span></div>` : ''}
      ${t.etat === 'sain' ? `<div class="rangee"><button class="bouton" data-a="dlOuvrir" data-id="${esc(t.id)}">Ouvrir</button><button class="bouton" data-a="dlDossier" data-id="${esc(t.id)}">Dossier</button></div>` : ''}</div></div>`;
  };
  return `<div class="flottant" role="dialog" aria-label="Téléchargements" data-ancre="droite">
    <div class="tete-menu"><img src="${appIcone('ullr')}" alt="" width="26" height="26"><div><b>Téléchargements</b><div class="petit doux">Vérifiés par Asclépios avant le PC</div></div></div>
    ${l.length ? l.slice(0, 8).map(ligne).join('') : '<p class="doux petit vide-menu">Aucun téléchargement pour l’instant. Chaque fichier sera gardé à part et analysé avant d’arriver sur ton PC.</p>'}
    <hr><button class="item" data-a="interne" data-page="telechargements">${I.telecharger()}<span>Tous les téléchargements</span><span class="kbd">${raccourci('Ctrl+J')}</span></button>
  </div>`;
}

// ————— Barre de commande (Ctrl+T) —————
type Resultat = { titre: string; suite?: string; action: string; icone: string; faire: () => void };
function commande(): string {
  const c = L.commande!;
  return `<section class="commande" aria-label="Barre de commande">
    <label>${I.loupe()}<span class="sr">Chercher ou saisir une adresse</span>
      <input id="commande-q" type="text" autocomplete="off" spellcheck="false" placeholder="Chercher ou saisir une adresse…" value="${esc(c.q)}" role="combobox" aria-expanded="true" aria-controls="resultats" aria-activedescendant="res-${c.sel}">
      <span class="etiquette">${E.reglages.moteur === 'pythie' && E.odin?.connecte ? 'Pythie' : nomMoteur()}</span></label>
    <div class="resultats" id="resultats" role="listbox">${c.resultats.map((r, i) => `<button class="resultat${i === c.sel ? ' sel' : ''}" id="res-${i}" role="option" aria-selected="${i === c.sel}" data-a="resultat" data-i="${i}">${r.icone}<span class="txt"><b>${esc(r.titre)}</b><span>${esc(r.suite ?? '')}</span></span><span class="act">${esc(r.action)}</span></button>`).join('')}</div>
  </section>`;
}
function nomMoteur(): string { return ({ duckduckgo: 'DuckDuckGo', google: 'Google', qwant: 'Qwant', pythie: 'Pythie' } as Record<string, string>)[E.reglages.moteur] ?? 'Recherche'; }
const picto = (svg: string) => `<span class="pic" aria-hidden="true">${svg}</span>`;

function ouvrirCommande(nouvel: boolean, texte = '', partage = false): void {
  L.menu = null;
  const c = courant();
  const q = texte || (!nouvel && c && !c.url.startsWith('pegase://') ? c.url : '');
  L.commande = { q, sel: 0, nouvel: nouvel || !c, resultats: [], jeton: 0, partage };
  calculerResultats();
  rendre();
  requestAnimationFrame(() => { const i = $<HTMLInputElement>('#commande-q'); if (i) { i.focus(); i.select(); } });
}

function calculerResultats(): void {
  const c = L.commande!; const q = c.q.trim(); const t = q.toLowerCase();
  const allerOuvrir = (url: string) => () => { fermerCouche(); if (c.partage) api.faire('partagerNouveau', { url }); else api.faire('naviguer', { texte: url, nouvel: c.nouvel }); };
  const r: Resultat[] = [];
  const estAdresse = /^(https?:\/\/|pegase:\/\/|localhost|\d{1,3}(\.\d{1,3}){3})/.test(q) || (!/\s/.test(q) && /^[^/?#]+\.[a-z]{2,}([/?#:].*)?$/i.test(q));
  if (q) {
    const odin = E.odin?.connecte && E.reglages.moteur === 'pythie';
    if (estAdresse) r.push({ titre: q, suite: ' · ouvrir cette adresse', action: 'Entrée', icone: iconeSite(/^[a-z]+:/.test(q) ? q : `https://${q}`, undefined, q), faire: allerOuvrir(q) });
    r.push(odin ? { titre: 'Demander à Pythie', suite: ` · « ${q} », cherche sur tous les moteurs`, action: estAdresse ? '' : 'Entrée', icone: `<img src="${appIcone('volva')}" alt="">`, faire: allerOuvrir(q.includes(' ') || !estAdresse ? q : `${q} `) }
      : { titre: `Chercher « ${q} »`, suite: ` · sur ${nomMoteur()}`, action: estAdresse ? '' : 'Entrée', icone: picto(I.loupe(16)), faire: allerOuvrir(estAdresse ? `${q} ` : q) });
  }
  // Actions de Pégase
  const actions: [string, string, string, () => void][] = [
    ['Écran partagé', 'met une 2e page à côté', I.partage(16), () => { fermerCouche(); ouvrirCommande(true, '', true); }],
    ['Favoris', 'tous tes favoris', I.etoile(16), () => { fermerCouche(); api.faire('interne', { page: 'favoris' }); }],
    ['Historique', 'les pages que tu as vues', I.horloge(16), () => { fermerCouche(); api.faire('interne', { page: 'historique' }); }],
    ['Téléchargements', 'vérifiés par Asclépios', I.telecharger(16), () => { fermerCouche(); api.faire('interne', { page: 'telechargements' }); }],
    ['Agenda', 'tes rendez-vous de la semaine', I.agenda(16), () => { fermerCouche(); api.faire('interne', { page: 'agenda' }); }],
    ['Réglages', 'apparence, protection, synchro', I.reglages(16), () => { fermerCouche(); api.faire('interne', { page: 'reglages' }); }],
    ['Importer', 'favoris de Chrome, Firefox, Edge, Brave, Arc', I.importer(16), () => { fermerCouche(); api.faire('interne', { page: 'importer' }); }],
    ['Nouvel espace', 'ses onglets, sa couleur', I.espaces(16), () => { fermerCouche(); api.faire('nouvelEspace', {}); }],
    ['Ranger les onglets', 'du jour, dans cet espace', I.boite(16), () => { fermerCouche(); api.faire('ranger'); }],
    ['Fenêtre privée', 'rien n’est gardé', I.oeil(16), () => { fermerCouche(); api.faire('fenetre', { op: 'privee' }); }],
    ...(['noir', 'blanc', 'bleu', 'rouge', 'transparent', 'glace'] as Theme[]).map((th) => [`Couleur : ${NOMS_THEMES[th]}`, 'couleur du navigateur', I.coeur(16), () => { fermerCouche(); api.faire('theme', { theme: th }); }] as [string, string, string, () => void]),
  ];
  const sans = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const ts = sans(t);
  for (const [titre, suite, ic, f] of actions) if (!q ? titre === 'Écran partagé' : sans(titre).includes(ts) || sans(suite).includes(ts)) r.push({ titre, suite: ` · ${suite}`, action: 'Ouvrir →', icone: picto(ic), faire: f });
  // Les applis d'Odin
  if (E.odin?.connecte && q) {
    for (const [id, a] of Object.entries(APPS)) if (sans(a.nom).includes(ts) && a.nom !== id) r.push({ titre: a.nom, suite: ' · appli Odin', action: 'Ouvrir →', icone: `<img src="${appIcone(id)}" alt="">`, faire: allerOuvrir(`${getOdin()}/#app=${id}`) });
  }
  // Onglets ouverts (sans recherche : les plus récents)
  const ons = E.onglets.filter((o) => !q || o.titre.toLowerCase().includes(t) || o.url.toLowerCase().includes(t)).slice(0, q ? 6 : 5);
  for (const o of ons) r.push({ titre: titreOnglet(o.url, o.titre), suite: '', action: 'Aller à l’onglet →', icone: iconeSite(o.url, o.icone, o.titre), faire: () => { fermerCouche(); api.faire('activer', { id: o.id }); } });
  c.resultats = r.slice(0, 14);
  if (c.sel >= c.resultats.length) c.sel = 0;
  // Favoris et historique : demandés au processus principal.
  if (q) {
    const jeton = ++c.jeton;
    api.faire('chercher', { q }).then((l: any[]) => {
      if (!L.commande || L.commande.jeton !== jeton) return;
      const deja = new Set(L.commande.resultats.map((x) => x.titre));
      for (const x of l) {
        if (x.type === 'onglet') continue;
        const titre = x.titre || domaine(x.url); if (deja.has(titre)) continue;
        L.commande.resultats.push({ titre, suite: ` — ${x.url}`, action: x.type === 'favori' ? '★' : '', icone: iconeSite(x.url, x.icone, x.titre), faire: allerOuvrir(x.url) });
      }
      L.commande.resultats = L.commande.resultats.slice(0, 16);
      rendreCouche();
    }).catch(() => 0);
  }
}

function fermerCouche(): void { L.menu = null; L.commande = null; infosSite = null; rendre(); }
function toast(t: string): void { L.toast = t; clearTimeout(L.toastMinuterie); L.toastMinuterie = setTimeout(() => { L.toast = ''; rendreCouche(); }, 3500); rendreCouche(); const a = document.getElementById('annonce'); if (a) a.textContent = t; }
function ecranOuvert(): boolean { return E?.ecran !== 'navigateur'; }

// ————— Actions —————
async function agir(a: string, d: DOMStringMap, el: HTMLElement): Promise<void> {
  const id = d.id;
  switch (a) {
    case 'menu': {
      const r = el.getBoundingClientRect();
      if (L.menu?.type === d.menu && !L.commande) { fermerCouche(); return; }
      L.commande = null; L.menu = { type: d.menu!, x: r.left, y: r.bottom + 6, ancre: r, arg: d.id };
      if (d.menu === 'site') api.faire('infosSite', {}).then((x) => { infosSite = x; rendreCouche(); }).catch(() => 0);
      rendre(); return;
    }
    case 'fermerCouche': fermerCouche(); return;
    case 'commande': ouvrirCommande(d.nouvel === '1'); return;
    case 'resultat': L.commande?.resultats[Number(d.i)]?.faire(); return;
    case 'interne': fermerCouche(); await api.faire('interne', { page: d.page }); return;
    case 'barre': L.survolBarre = false; await api.faire('barre', {}); return;
    case 'panneauOdin': await api.faire('panneauOdin', {}); return;
    case 'fenetre': fermerCouche(); await api.faire('fenetre', { op: d.op }); return;
    case 'theme': {
      let th = d.theme as Theme | 'auto';
      if (th === 'auto') th = await api.faire('theme-systeme');
      fermerCouche(); await api.faire('theme', { theme: th }); return;
    }
    case 'activer': if (L.renommer) return; await api.faire('activer', { id }); return;
    case 'activerBureau': await api.faire('activerBureau', { id }); return;
    case 'tuile': {
      const f = E.tuiles.find((x) => x.id === id); if (!f) return;
      const o = E.onglets.find((x) => x.url === f.url || (x.url.split('#')[0] === f.url.split('#')[0] && x.espace === E.espaceActif));
      if (o) await api.faire('activer', { id: o.id }); else await api.faire('ouvrir', { url: f.url });
      return;
    }
    case 'fermer': fermerCouche(); await api.faire('fermer', { id }); return;
    case 'reculer': await api.faire('reculer', { id }); return;
    case 'avancer': await api.faire('avancer', { id }); return;
    case 'recharger': await api.faire('recharger', { id }); return;
    case 'arreter': await api.faire('arreter', {}); return;
    case 'copierLien': { const ok = await api.faire('copierLien', { id }); fermerCouche(); if (ok) toast('Lien copié.'); return; }
    case 'muet': await api.faire('muet', { id }); if (L.menu) fermerCouche(); return;
    case 'ranger': { const n = await api.faire('ranger'); toast(n ? `${n} onglet${n > 1 ? 's' : ''} rangé${n > 1 ? 's' : ''} dans la boîte en bas.` : 'Aucun onglet du jour à ranger.'); return; }
    case 'rouvrir': fermerCouche(); await api.faire('rouvrir', { id }); return;
    case 'espace': fermerCouche(); await api.faire('espace', { id }); return;
    case 'dossier': { const dd = E.dossiers.find((x) => x.id === id); if (dd) await api.faire('majDossier', { id, ouvert: !dd.ouvert }); return; }
    case 'nouvelEspace': { fermerCouche(); const nom = await demander('Nom du nouvel espace', 'Travail'); if (nom) await api.faire('nouvelEspace', { nom }); return; }
    case 'nouveauDossier': { fermerCouche(); const nom = await demander('Nom du dossier', 'Nouveau dossier'); if (nom) await api.faire('nouveauDossier', { nom }); return; }
    case 'renommerDossier': { fermerCouche(); const dd = E.dossiers.find((x) => x.id === id); const nom = await demander('Nouveau nom du dossier', dd?.nom ?? ''); if (nom) await api.faire('majDossier', { id, nom }); return; }
    case 'supprDossier': fermerCouche(); await api.faire('supprDossier', { id }); return;
    case 'renommerEspace': { fermerCouche(); const e = E.espaces.find((x) => x.id === id); const nom = await demander('Nouveau nom de l’espace', e?.nom ?? ''); if (nom) await api.faire('majEspace', { id, nom }); return; }
    case 'couleurEspace': await api.faire('majEspace', { id, couleur: Number(d.c) }); return;
    case 'themeEspace': fermerCouche(); await api.faire('majEspace', { id, theme: d.theme || '' }); if (d.theme) await api.faire('theme', { theme: d.theme }); return;
    case 'supprEspace': fermerCouche(); await api.faire('supprEspace', { id }); return;
    case 'partagerNouveau': fermerCouche(); ouvrirCommande(true, '', true); return;
    case 'partagerAvec': { fermerCouche(); L.commande = null; const autres = ongletsEspace().filter((o) => o.id !== id); if (!autres.length) { await api.faire('activer', { id }); ouvrirCommande(true, '', true); return; } const cur = courant(); await api.faire('partager', { a: cur && cur.id !== id ? cur.id : autres[0].id, b: id }); return; }
    case 'agrandirPage': { const b = E.bureaux.find((x) => x.onglets.includes(id!)); if (b) { await api.faire('retirerBureau', { bureau: b.id, onglet: id }); await api.faire('activer', { id }); } return; }
    case 'retirerPage': { fermerCouche(); const b = E.bureaux.find((x) => x.onglets.includes(id!)); if (b) await api.faire('retirerBureau', { bureau: b.id, onglet: id }); return; }
    case 'focusPage': focusBureau = id ?? null; await api.faire('focusBureau', { id }); return;
    case 'disposition': fermerCouche(); await api.faire('dispositionBureau', { id, disposition: d.disposition }); return;
    case 'ajouterPage': { fermerCouche(); const b = E.bureaux.find((x) => x.id === id); if (b) { focusBureau = b.onglets[0]; ouvrirCommande(true, '', true); } return; }
    case 'nommerBureau': { fermerCouche(); const b = E.bureaux.find((x) => x.id === id); const nom = await demander('Nom du bureau', b?.nom ?? 'Bureau'); if (nom !== null) await api.faire('nommerBureau', { id, nom }); return; }
    case 'defaireBureau': fermerCouche(); await api.faire('defaireBureau', { id }); return;
    case 'renommer': fermerCouche(); L.renommer = id ?? null; rendre(); return;
    case 'pip': fermerCouche(); await api.faire('pip', { id }); return;
    case 'dupliquer': fermerCouche(); await api.faire('dupliquer', { id }); return;
    case 'epingler': fermerCouche(); await api.faire('epingler', { id }); return;
    case 'favori': fermerCouche(); await basculerFavori(id); return;
    case 'deplacerEspace': fermerCouche(); await api.faire('deplacer', { id, espace: d.espace }); return;
    case 'video': await api.faire('video', { onglet: id, op: d.op }); if (d.op === 'retour' || d.op === 'fermer') delete L.posVideo[id!]; return;
    case 'reglage': await api.faire('reglage', { cle: d.cle, valeur: d.valeur }); return;
    case 'effacerSite': { await api.faire('effacerSite', {}); fermerCouche(); toast('Cookies et données de ce site effacés.'); return; }
    case 'imprimer': fermerCouche(); await api.faire('imprimer'); return;
    case 'outilsDev': fermerCouche(); await api.faire('outilsDev'); return;
    case 'trouverSuite': if (L.trouver?.texte) await api.faire('trouver', { texte: L.trouver.texte, suite: true, sens: Number(d.sens) }); return;
    case 'trouverFermer': L.trouver = null; await api.faire('trouver', {}); rendre(); return;
    case 'odinResumer': await demanderOdin('', true); return;
    case 'odinVerifier': await demanderOdin('Vérifie ce site : est-il fiable ? Y a-t-il un risque d’arnaque ou de virus ?', false, true); return;
    case 'defaut': { fermerCouche(); const r = await api.faire('navigateurDefaut'); toast(r || 'Pégase est maintenant ton navigateur par défaut.'); return; }
    case 'majPegase': { fermerCouche(); toast('Recherche d’une mise à jour…'); const r = await api.faire('miseAJour'); toast(r || 'Pégase est à jour.'); return; }
    case 'deconnexion': fermerCouche(); await api.faire('deconnexion'); return;
    case 'dlOuvrir': await api.faire('dlOuvrir', { id }); return;
    case 'dlDossier': await api.faire('dlDossier', { id }); return;
    default: await api.faire(a, { ...d });
  }
}

async function basculerFavori(id?: string): Promise<void> {
  const o = id ? E.onglets.find((x) => x.id === id) : courant(); if (!o || o.url.startsWith('pegase://')) return;
  const r = await api.faire('basculerFavori', { url: o.url, nom: titreOnglet(o.url, o.titre), icone: o.icone });
  toast(r === 'ajoute' ? 'Ajouté aux favoris (en haut de la barre de côté).' : 'Retiré des favoris.');
}

async function demanderOdin(texte: string, resumer = false, verifier = false): Promise<void> {
  if (!E.panneauOdin) await api.faire('panneauOdin', { ouvert: true });
  const c = courant();
  L.odinFil.push({ moi: true, texte: resumer ? 'Résume cette page.' : texte });
  L.odinFil.push({ moi: false, texte: 'Odin réfléchit…' });
  rendre();
  const r = await api.faire('odinDemander', { texte, resumer, verifier, onglet: c?.id }).catch(() => null);
  L.odinFil[L.odinFil.length - 1] = { moi: false, texte: r?.texte ?? 'Odin n’a pas répondu. Vérifie qu’il est allumé et que Pégase y est relié (Réglages → Synchro Odin).' };
  rendre();
  const fil = document.getElementById('po-fil'); if (fil) fil.scrollTop = fil.scrollHeight;
}

/** Une petite question (nom d'espace, de dossier…) dans une boîte de Pégase. */
function demander(question: string, defaut: string): Promise<string | null> {
  return new Promise((ok) => {
    const boite = document.createElement('div');
    boite.className = 'boite-dialogue';
    boite.innerHTML = `<div class="voile sombre"></div><form class="flottant pile" role="dialog" aria-label="${esc(question)}"><label class="pile"><b>${esc(question)}</b><input class="champ" name="v" value="${esc(defaut)}"></label><div class="rangee"><button class="bouton plein" type="submit">OK</button><button class="bouton" type="button" data-annuler>Annuler</button></div></form>`;
    document.body.appendChild(boite);
    const f = boite.querySelector('form') as HTMLFormElement;
    f.style.left = '50%'; f.style.top = '30%'; f.style.transform = 'translateX(-50%)'; f.style.padding = '18px'; f.style.width = '360px';
    const fin = (v: string | null) => { boite.remove(); envoyerZones(); ok(v); };
    f.addEventListener('submit', (e) => { e.preventDefault(); fin(((f.elements.namedItem('v') as HTMLInputElement).value || '').trim() || null); });
    boite.querySelector('[data-annuler]')!.addEventListener('click', () => fin(null));
    boite.querySelector('.voile')!.addEventListener('click', () => fin(null));
    f.addEventListener('keydown', (e) => { if (e.key === 'Escape') fin(null); });
    envoyerZones();
    const i = f.querySelector('input')!; i.focus(); i.select();
  });
}

// ————— Clavier —————
function comboDe(e: KeyboardEvent): string {
  const c = e.ctrlKey || e.metaKey;
  const p = `${c ? 'C' : ''}${e.shiftKey && (c || e.key.length > 1) ? 'S' : ''}${e.altKey ? 'A' : ''}`;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return p ? `${p}+${k}` : k;
}
async function touche(k: string): Promise<boolean> {
  const c = courant();
  const liste = () => { const ons = ongletsEspace(); return [...ons.filter((o) => o.epingle).sort((a, b) => a.ordre - b.ordre), ...ons.filter((o) => !o.epingle).sort((a, b) => a.ordre - b.ordre)]; };
  switch (k) {
    case 'C+t': ouvrirCommande(true); return true;
    case 'C+l': ouvrirCommande(false); return true;
    case 'C+n': api.faire('fenetre', { op: 'nouvelle' }); return true;
    case 'CS+n': api.faire('fenetre', { op: 'privee' }); return true;
    case 'C+w': if (c) api.faire('fermer', { id: c.id }); return true;
    case 'CS+t': api.faire('rouvrirDernier'); return true;
    case 'C+d': basculerFavori(); return true;
    case 'C+f': L.trouver = { texte: '', actif: 0, total: 0 }; rendreCouche(); envoyerZones(); return true;
    case 'C+r': case 'F5': api.faire('recharger', {}); return true;
    case 'C+Tab': case 'CS+Tab': { const l = liste(); if (!l.length) return true; const i = l.findIndex((o) => o.id === c?.id); const n = l[(i + (k === 'C+Tab' ? 1 : -1) + l.length) % l.length]; api.faire('activer', { id: n.id }); return true; }
    case 'A+ArrowLeft': api.faire('reculer', {}); return true;
    case 'A+ArrowRight': api.faire('avancer', {}); return true;
    case 'C+s': api.faire('barre', {}); return true;
    case 'C+p': api.faire('imprimer'); return true;
    case 'CS+i': case 'F12': api.faire('outilsDev'); return true;
    case 'C+=': case 'C++': api.faire('zoom', { sens: 1 }); return true;
    case 'C+-': api.faire('zoom', { sens: -1 }); return true;
    case 'C+0': api.faire('zoom', { sens: 0 }); return true;
    case 'C+,': api.faire('interne', { page: 'reglages' }); return true;
    case 'C+y': api.faire('interne', { page: 'historique' }); return true;
    case 'C+j': api.faire('interne', { page: 'telechargements' }); return true;
    case 'CS+o': api.faire('interne', { page: 'favoris' }); return true;
    case 'CS+c': if (c) { await api.faire('copierLien', {}); toast('Lien copié.'); } return true;
    case 'CS+d': ouvrirCommande(true, '', true); return true;
    case 'Escape': if (L.commande || L.menu) { fermerCouche(); return true; } if (L.trouver) { L.trouver = null; api.faire('trouver', {}); rendre(); return true; } if (L.renommer) { L.renommer = null; rendre(); return true; } return false;
  }
  const n = /^C\+([1-9])$/.exec(k);
  if (n) { const e = E.espaces[Number(n[1]) - 1]; if (e) api.faire('espace', { id: e.id }); return true; }
  return false;
}

document.addEventListener('keydown', async (e) => {
  if (!E) return;
  const k = comboDe(e);
  // Dans la barre de commande : flèches et Entrée.
  if (L.commande && (e.target as HTMLElement)?.id === 'commande-q') {
    const c = L.commande;
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); c.sel = (c.sel + (k === 'ArrowDown' ? 1 : -1) + c.resultats.length) % Math.max(1, c.resultats.length); rendreCouche(); $('.resultat.sel')?.scrollIntoView({ block: 'nearest' }); return; }
    if (k === 'Enter') { e.preventDefault(); c.resultats[c.sel]?.faire(); return; }
  }
  if ((e.target as HTMLElement)?.id === 'trouver' && (k === 'Enter' || k === 'S+Enter')) { e.preventDefault(); if (L.trouver?.texte) api.faire('trouver', { texte: L.trouver.texte, suite: true, sens: k === 'Enter' ? 1 : -1 }); return; }
  const r = e.target as HTMLInputElement;
  if (r?.classList?.contains('renommer') && k === 'Enter') { e.preventDefault(); await api.faire('renommer', { id: r.dataset.renommer, titre: r.value }); L.renommer = null; rendre(); return; }
  if ((k === 'Enter' || k === ' ') && (e.target as HTMLElement)?.getAttribute?.('role') === 'button' && (e.target as HTMLElement).dataset.a) { e.preventDefault(); (e.target as HTMLElement).click(); return; }
  if (k === 'ContextMenu' || k === 'S+F10') { const t = (e.target as HTMLElement)?.closest?.('[data-menu-ctx]') as HTMLElement | null; if (t) { e.preventDefault(); const rr = t.getBoundingClientRect(); L.menu = { type: t.dataset.menuCtx!, x: rr.left + 20, y: rr.bottom, arg: t.dataset.id }; rendre(); return; } }
  const enChamp = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;
  if (enChamp && !k.startsWith('C') && k !== 'Escape' && k !== 'F5' && k !== 'F12') return;
  if (enChamp && ['C+a', 'C+c', 'C+v', 'C+x', 'C+z', 'CS+z', 'C+y'].includes(k)) return;
  if (await touche(k)) e.preventDefault();
}, true);

document.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'commande-q' && L.commande) { L.commande.q = t.value; L.commande.sel = 0; calculerResultats(); rendreCouche(); }
  else if (t.id === 'trouver' && L.trouver) { L.trouver.texte = t.value; api.faire('trouver', { texte: t.value }); }
  else if (t.dataset.champ === 'ranges' && L.menu) { L.menu.arg = { q: t.value }; rendreCouche(); const i = $<HTMLInputElement>('[data-champ="ranges"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
});
document.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.dataset.reglage) api.faire('reglage', { cle: t.dataset.reglage, valeur: t.type === 'checkbox' ? t.checked : t.value });
});
document.addEventListener('focusout', async (e) => {
  const t = e.target as HTMLInputElement;
  if (t.classList?.contains('renommer') && L.renommer) { const id = L.renommer; L.renommer = null; await api.faire('renommer', { id, titre: t.value }); rendre(); }
});
document.addEventListener('submit', (e) => {
  const f = e.target as HTMLFormElement;
  if (f.dataset.form === 'odin') { e.preventDefault(); const t = (f.elements.namedItem('texte') as HTMLTextAreaElement); const v = t.value.trim(); if (v) { t.value = ''; demanderOdin(v); } }
});

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
  if (!el || (el as HTMLButtonElement).disabled) return;
  if (el.closest('[data-interne]') && !el.closest('.cadre-page')?.querySelector('[data-interne]')?.contains(el) === false) { /* les pages internes gèrent leurs boutons */ }
  if (el.closest('.interne')) return;
  e.preventDefault(); e.stopPropagation();
  agir(el.dataset.a!, el.dataset, el).catch((err) => toast(String(err?.message ?? err)));
});
document.addEventListener('auxclick', (e) => {
  if (e.button !== 1) return;
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a="activer"]'); if (el) { e.preventDefault(); api.faire('fermer', { id: el.dataset.id }); }
});
document.addEventListener('contextmenu', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-menu-ctx]');
  if (!el || el.closest('.interne')) { if (!(e.target as HTMLElement).closest('input,textarea,.interne')) e.preventDefault(); return; }
  e.preventDefault();
  L.commande = null; L.menu = { type: el.dataset.menuCtx!, x: e.clientX, y: e.clientY, arg: el.dataset.id }; rendre();
});

// Barre réduite : la souris au bord gauche fait revenir la barre par-dessus la page.
document.addEventListener('mouseover', (e) => {
  const t = e.target as HTMLElement;
  if (E?.barreReduite && !L.survolBarre && t.closest?.('[data-survol-barre]')) { L.survolBarre = true; rendre(); }
});
document.addEventListener('mousemove', (e) => {
  if (L.survolBarre && e.clientX > 330 && !L.menu) { L.survolBarre = false; rendre(); }
});

// ————— Glisser-déposer dans la barre de côté —————
document.addEventListener('dragstart', (e) => {
  const el = (e.target as HTMLElement).closest?.('[data-drag]') as HTMLElement | null; if (!el) return;
  const [type, id] = el.dataset.drag!.split(':'); L.glisse = { type, id };
  e.dataTransfer!.effectAllowed = 'move'; e.dataTransfer!.setData('text/plain', el.dataset.drag!);
});
let cibleDrop: HTMLElement | null = null;
document.addEventListener('dragover', (e) => {
  if (!L.glisse) return;
  const el = (e.target as HTMLElement).closest?.('[data-drop]') as HTMLElement | null;
  if (cibleDrop && cibleDrop !== el) cibleDrop.classList.remove('drop-avant', 'drop-dans');
  cibleDrop = el; if (!el) return;
  e.preventDefault();
  const t = el.dataset.drop!;
  el.classList.add(t.startsWith('onglet:') ? 'drop-avant' : 'drop-dans');
});
document.addEventListener('dragend', () => { cibleDrop?.classList.remove('drop-avant', 'drop-dans'); cibleDrop = null; L.glisse = null; });
document.addEventListener('drop', async (e) => {
  const g = L.glisse; const el = cibleDrop; cibleDrop?.classList.remove('drop-avant', 'drop-dans'); cibleDrop = null; L.glisse = null;
  if (!g || !el) return;
  e.preventDefault();
  const [t, cible] = el.dataset.drop!.split(':');
  if (g.type === 'onglet') {
    const o = E.onglets.find((x) => x.id === g.id); if (!o) return;
    if (t === 'onglet') {
      const c = E.onglets.find((x) => x.id === cible); if (!c || c.id === o.id) return;
      const freres = E.onglets.filter((x) => x.espace === c.espace && x.epingle === c.epingle).sort((a, b) => a.ordre - b.ordre);
      const i = freres.findIndex((x) => x.id === c.id); const avant = freres[i - 1];
      const ordre = avant && avant.id !== o.id ? (avant.ordre + c.ordre) / 2 : c.ordre - 1;
      await api.faire('deplacer', { id: o.id, ordre, epingle: c.epingle, dossier: c.dossier ?? null, espace: c.espace });
    } else if (t === 'dossier') await api.faire('deplacer', { id: o.id, epingle: true, dossier: cible });
    else if (t === 'epingles') await api.faire('deplacer', { id: o.id, epingle: true, dossier: null });
    else if (t === 'jour') await api.faire('deplacer', { id: o.id, epingle: false, dossier: null });
    else if (t === 'espace') { await api.faire('deplacer', { id: o.id, espace: cible }); toast('Onglet déplacé vers un autre espace.'); }
    else if (t === 'tuiles') { await api.faire('basculerFavori', { url: o.url, nom: titreOnglet(o.url, o.titre), icone: o.icone, forcer: true }); toast('Ajouté aux favoris.'); }
  } else if (g.type === 'favori' && t === 'tuiles') {
    // réordonner les tuiles : on met la tuile glissée à la fin (simple et prévisible)
    await api.faire('favoriFin', { id: g.id });
  } else if (g.type === 'dossier' && t === 'dossier' && cible !== g.id) {
    const c = E.dossiers.find((x) => x.id === cible); if (c) await api.faire('majDossier', { id: g.id, ordre: c.ordre - 0.0001 });
  }
});

// Déplacer une vidéo qui suit (par sa barre de titre).
document.addEventListener('pointerdown', (e) => {
  const barre = (e.target as HTMLElement).closest?.('[data-glisser-video]') as HTMLElement | null;
  if (!barre || (e.target as HTMLElement).closest('button')) return;
  // La pile des vignettes est une vue à part : on demande au processus principal de la déplacer.
  let x0 = e.screenX, y0 = e.screenY;
  barre.setPointerCapture(e.pointerId);
  const bouge = (m: PointerEvent) => { const dx = m.screenX - x0, dy = m.screenY - y0; if (!dx && !dy) return; x0 = m.screenX; y0 = m.screenY; api.faire('deplacerVignettes', { dx, dy }); };
  const fin = () => { barre.removeEventListener('pointermove', bouge); barre.removeEventListener('pointerup', fin); };
  barre.addEventListener('pointermove', bouge); barre.addEventListener('pointerup', fin);
});

// ————— Messages du processus principal —————
api.surEtat((e) => { E = e; rendre(); });
// Une icône de site qui ne se charge pas : on met la lettre à la place.
document.addEventListener('error', (e) => {
  const im = e.target as HTMLImageElement;
  if (im?.tagName !== 'IMG' || !im.classList.contains('ic') || im.dataset.repli) return;
  im.dataset.repli = '1';
  const s = document.createElement('span');
  s.className = `ltr c${im.dataset.c ?? 0}`; s.textContent = im.dataset.l || '?'; s.setAttribute('aria-hidden', 'true');
  im.replaceWith(s);
}, true);
api.surCommande((c, arg) => {
  if (c === 'touche') touche(String(arg));
  else if (c === 'trouve' && L.trouver) { L.trouver.actif = arg.actif; L.trouver.total = arg.total; derniers.couche = ''; rendreCouche(); }
  else if (c === 'message') toast(String(arg));
  else if (c === 'commande' && arg === 'barre-commande') ouvrirCommande(true);
  else if (c === 'odin') { if (arg?.resumer) demanderOdin('', true); else if (arg?.texte) demanderOdin(`Explique-moi : « ${String(arg.texte).slice(0, 500)} »`); }
});
api.etat().then((e) => { if (e) { E = e; rendre(); } });
if (VIGNETTES) addEventListener('resize', () => rendreVignettes());
(window as any).__pegaseDemander = demander;
document.addEventListener('pegase:commande', () => ouvrirCommande(true));
document.addEventListener('pegase:odin', (e) => demanderOdin(String((e as CustomEvent).detail)));
void srcSure; void couleurDe;
