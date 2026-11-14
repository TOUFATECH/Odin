// pegase://reglages/<section> : les réglages (maquettes « Synchro », « Cookies », « Mots de passe », « Sécurité »).
// Colonne de gauche : Général · Confidentialité et sécurité · Autres ; à droite, la section choisie.
import type { Theme } from '../commun/types';
import { odinVisage } from './odin-visage';
import { api, esc, iconeSite, quand, taille, appIcone, type Ctx } from './commun';
import { I } from './icones';
import appareilsJson from '../commun/appareils.json';

type Section = { id: string; nom: string; groupe: string };
const SECTIONS: Section[] = [
  { id: 'apparence', nom: 'Apparence et couleurs', groupe: 'Général' },
  { id: 'synchro', nom: 'Synchro Odin', groupe: 'Général' },
  { id: 'plume', nom: 'Plume (correcteur)', groupe: 'Général' },
  { id: 'cookies', nom: 'Cookies et données des sites', groupe: 'Confidentialité et sécurité' },
  { id: 'motsdepasse', nom: 'Mots de passe', groupe: 'Confidentialité et sécurité' },
  { id: 'permissions', nom: 'Permissions des sites', groupe: 'Confidentialité et sécurité' },
  { id: 'securite', nom: 'Sécurité', groupe: 'Confidentialité et sécurité' },
  { id: 'bouclier', nom: 'Bouclier (pubs, pisteurs)', groupe: 'Confidentialité et sécurité' },
  { id: 'telechargements', nom: 'Téléchargements et Asclépios', groupe: 'Autres' },
  { id: 'mobile', nom: 'Affichage mobile', groupe: 'Autres' },
  { id: 'langues', nom: 'Langues et traduction', groupe: 'Autres' },
  { id: 'apropos', nom: 'À propos de Pégase', groupe: 'Autres' },
];
const NOMS_THEMES: Record<Theme, string> = { noir: 'Noir', blanc: 'Blanc', bleu: 'Bleu', rouge: 'Rouge', transparent: 'Transparent', glace: 'Glace' };
const choix = (cle: string, val: string, opts: [string, string][], label = '') => `<select class="champ" data-cle="${cle}" ${label ? `aria-label="${esc(label)}"` : ''}>${opts.map(([v, t]) => `<option value="${v}"${v === val ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
const inter = (cle: string, oui: boolean, label: string) => `<input type="checkbox" class="interrupteur" data-cle="${cle}" ${oui ? 'checked' : ''} aria-label="${esc(label)}">`;
const SOLIDITE: Record<string, [string, string]> = { fort: ['Fort', 'ok'], moyen: ['Moyen', 'moyen'], faible: ['Faible', 'ko'], reutilise: ['Réutilisé', 'ko'] };

export function pageReglages(el: HTMLElement, ctx: Ctx): () => void {
  const section = (el.dataset.interne ?? 'reglages').split('/')[1] || 'apparence';
  const nav = () => {
    const groupes = [...new Set(SECTIONS.map((s) => s.groupe))];
    return `<nav class="nav-reglages" aria-label="Sections des réglages"><h1>Réglages</h1>${groupes.map((g) => `<div class="groupe-reglages"><div class="titre-groupe">${esc(g)}</div>${SECTIONS.filter((s) => s.groupe === g).map((s) => `<button class="ligne${s.id === section ? ' actif' : ''}" data-rubrique="${s.id}" ${s.id === section ? 'aria-current="page"' : ''}>${esc(s.nom)}</button>`).join('')}</div>`).join('')}</nav>`;
  };
  el.innerHTML = `<div class="reglages-mise">${nav()}<div class="contenu corps-reglages" id="corps-reglages"></div></div>`;
  const corps = el.querySelector<HTMLElement>('#corps-reglages')!;
  el.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-rubrique]'); if (b) api.faire('naviguer', { texte: `pegase://reglages/${b.dataset.rubrique}` }); });
  const f = (SECTIONS_RENDU[section] ?? SECTIONS_RENDU.apparence)(corps, ctx);
  return typeof f === 'function' ? f : () => {};
}

type Rendu = (el: HTMLElement, ctx: Ctx) => void | (() => void);
/** Les changements de réglages simples (listes, interrupteurs) dans une section. */
function brancherReglages(el: HTMLElement, apres?: () => void): void {
  el.addEventListener('change', async (e) => {
    const t = e.target as HTMLInputElement; const cle = t.dataset.cle; if (!cle) return;
    const v = t.type === 'checkbox' ? t.checked : (['veilleMinutes', 'rangerHeures', 'transparence'].includes(cle) ? Number(t.value) : t.value);
    await api.faire('reglage', { cle, valeur: v }); apres?.();
  });
}
/** Une petite question « retape ton mot de passe d'Odin » dans la page. */
function demanderMdp(texte: string): Promise<string | null> {
  return new Promise((ok) => {
    const b = document.createElement('div'); b.className = 'boite-dialogue';
    b.innerHTML = `<div class="voile sombre"></div><form class="flottant pile boite-mdp" role="dialog" aria-label="${esc(texte)}"><b>${esc(texte)}</b><input class="champ" type="password" name="v" autocomplete="current-password" aria-label="Mot de passe d’Odin"><div class="rangee"><button class="bouton" type="button" data-annuler>Annuler</button><button class="bouton plein" type="submit">Afficher 30 s</button></div></form>`;
    document.body.appendChild(b);
    const f = b.querySelector('form')!; const fin = (v: string | null) => { b.remove(); document.dispatchEvent(new CustomEvent('pegase:zones')); ok(v); };
    f.addEventListener('submit', (e) => { e.preventDefault(); fin((f.elements.namedItem('v') as HTMLInputElement).value); });
    b.querySelector('[data-annuler]')!.addEventListener('click', () => fin(null)); b.querySelector('.voile')!.addEventListener('click', () => fin(null));
    f.addEventListener('keydown', (e) => { if (e.key === 'Escape') fin(null); });
    document.dispatchEvent(new CustomEvent('pegase:zones'));
    (f.querySelector('input') as HTMLInputElement).focus();
  });
}

const SECTIONS_RENDU: Record<string, Rendu> = {
  apparence: (el, ctx) => {
    const dessiner = () => {
      const r = ctx.etat().reglages;
      el.innerHTML = `<h2 class="titre-section">Apparence et couleurs</h2><div class="pile">
        <section class="carte"><div class="reglage"><div><b>Couleur du navigateur</b><div class="doux petit">Chaque espace peut garder la sienne (clic droit sur l’espace, en bas de la barre). « Auto » suit le thème clair ou sombre de ton système.</div></div>
          <div class="nuancier">${(Object.keys(NOMS_THEMES) as Theme[]).map((t) => `<button class="nuance n-${t}" data-theme="${t}" aria-label="${NOMS_THEMES[t]}" title="${NOMS_THEMES[t]}" aria-pressed="${r.theme === t}"></button>`).join('')}<button class="nuance n-auto" data-theme="auto" aria-label="Auto : suit le système" title="Auto" aria-pressed="${!!r.themeAuto}"></button></div></div>
          <div class="reglage"><div><b>Transparence de la vitre</b><div class="doux petit">Pour « Transparent » : plus ou moins de bureau visible derrière.</div></div><input type="range" min="10" max="95" value="${r.transparence}" data-cle="transparence" aria-label="Transparence"></div></section>
        <section class="carte"><h3>Onglets</h3>
          <div class="reglage"><div><b>Mettre en veille les onglets inactifs après</b><div class="doux petit">Une page en veille ne prend plus de mémoire ; elle se recharge quand tu y reviens.</div></div>${choix('veilleMinutes', String(r.veilleMinutes), [['5', '5 minutes'], ['10', '10 minutes'], ['30', '30 minutes'], ['60', '1 heure'], ['100000', 'Jamais']], 'Mise en veille')}</div>
          <div class="reglage"><div><b>Ranger les onglets du jour après</b></div>${choix('rangerHeures', String(r.rangerHeures), [['12', '12 heures'], ['24', '1 jour'], ['168', '1 semaine'], ['0', 'Jamais']], 'Rangement')}</div>
          <div class="reglage"><div><b>Vidéo qui te suit</b><div class="doux petit">Quand tu quittes un onglet qui joue une vidéo, elle te suit dans un coin (4 au plus).</div></div>${inter('videoAuto', r.videoAuto, 'Vidéo qui te suit')}</div>
          <div class="reglage"><div><b>Moteur de recherche</b><div class="doux petit">Pythie cherche sur tous les moteurs depuis ton Odin.</div></div>${choix('moteur', r.moteur, [['pythie', 'Pythie (Odin)'], ['duckduckgo', 'DuckDuckGo'], ['qwant', 'Qwant'], ['google', 'Google']], 'Moteur')}</div></section></div>`;
    };
    dessiner(); brancherReglages(el);
    el.addEventListener('input', (e) => { const t = e.target as HTMLInputElement; if (t.dataset.cle === 'transparence') document.documentElement.style.setProperty('--vitre', String(Number(t.value) / 100)); });
    el.addEventListener('click', async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-theme]'); if (!b) return;
      await api.faire('theme', { theme: b.dataset.theme }); setTimeout(dessiner, 120);
    });
  },

  synchro: (el, ctx) => {
    const dessiner = async () => {
      const E = ctx.etat(); const info = await api.faire('synchroInfos').catch(() => null);
      const l = info?.lien; const r = E.reglages;
      const copies: any[] = l ? await api.faire('odinCopies').catch(() => []) : [];
      const moi = l ? await api.faire('odinMoi').catch(() => null) : null;
      const quoi: [string, string][] = [['Ton profil', 'nom, couleur'], ['Favoris', 'et dossiers'], ['Onglets et espaces', 'épinglés, bureaux'], ['Historique', r.synchroHistorique === 'tout' ? 'cherchable par Odin' : 'synchronisé, mais Odin ne le lit pas'], ['Agenda', 'tes rendez-vous'], ['Réglages', 'couleurs, protection'], ['Téléchargements', 'le journal, pas les fichiers']];
      let ip = '', port = ''; if (l) { try { const u = new URL(l.adresse); ip = u.hostname.replace(/^\[|\]$/g, ''); port = u.port; } catch { /* */ } }
      el.innerHTML = `<h2 class="titre-section">Synchro Odin</h2><div class="pile">
        <section class="carte">${l ? `<div class="rangee"><span class="odin grand-odin" aria-hidden="true">${odinVisage(E.odin?.connecte ? 'joie' : 'confus')}</span><div class="pousse"><b>Odin connecté</b><div class="doux petit">${E.synchro.etat === 'ok' ? `Synchronisé${l.derniere ? ` · ${quand(l.derniere)}` : ''}` : E.synchro.etat === 'horsligne' ? `Hors ligne (${E.synchro.attente} en attente)` : 'Synchronisation…'} · ${l.mode === 'sso' ? 'connexion unique de ce PC' : 'jeton de cet appareil'} · ${esc(l.profil?.nom ?? '')}</div></div>
            <button class="bouton" data-maintenant>Synchroniser maintenant</button><button class="bouton danger" data-deconnecter>Déconnecter</button></div>
            <div class="ip-port lecture"><label>Adresse IP<input class="champ" value="${esc(ip)}" readonly></label><label>Port<input class="champ" value="${esc(port)}" readonly></label></div>`
          : `<form class="pile" data-relier><div class="rangee"><span class="odin grand-odin" aria-hidden="true">${odinVisage(E.odin?.connecte ? 'joie' : 'confus')}</span><div><b>Pas encore relié à Odin</b><div class="doux petit">Relie Pégase à ton Odin pour retrouver tout sur tes autres appareils.</div></div></div>
            <div class="ip-port"><label>Adresse IP d’Odin<input class="champ" name="hote" placeholder="192.168.1.10" required></label><label>Port<input class="champ" name="port" value="7777"></label></div>
            <label>Adresse e-mail<input class="champ" type="email" name="email" autocomplete="username" required></label><label>Mot de passe<input class="champ" type="password" name="motdepasse" autocomplete="current-password" required></label>
            <p class="erreur" role="alert"></p><div class="rangee"><button class="bouton plein" type="submit">Se connecter</button><button class="bouton" type="button" data-chercher>Chercher Odin sur le réseau</button></div></form>`}</section>
        <section class="carte"><h3>Ce qui est synchronisé</h3><ul class="ce-qui-part">${quoi.map(([a, b]) => `<li><span class="ok-rond petit" aria-hidden="true">✓</span><b>${a}</b><span class="doux">${b}</span></li>`).join('')}<li><span class="ko-rond petit" aria-hidden="true">–</span><b>Cookies et mots de passe</b><span class="doux">restent sur ce PC, jamais envoyés</span></li></ul>
          <div class="reglage"><div><b>Ce qu’Odin peut lire de ta navigation</b><div class="doux petit">Pour lui demander « qu’est-ce que je regardais hier ? ». Rien des fenêtres privées.</div></div>${choix('synchroHistorique', r.synchroHistorique, [['tout', 'Tout (historique compris)'], ['sans-historique', 'Tout sauf l’historique'], ['rien', 'Rien']], 'Ce qu’Odin peut lire')}</div></section>
        <section class="carte"><h3>Ton profil sur ce PC</h3><div class="doux petit">${esc(info?.dossier ?? '')}</div><div class="doux petit">${info ? `${String(info.taille).replace('.', ',')} Mo · chiffré (clé gardée par le système)` : ''}</div>
          <div class="rangee"><button class="bouton" data-dossier>Ouvrir le dossier</button><button class="bouton" data-cache>Vider le cache</button><button class="bouton" data-importer>Importer d’un autre navigateur</button></div></section>
        ${l ? `<section class="carte"><h3>Restaurer depuis Odin</h3>${copies.length ? `<table class="tableau"><tbody>${copies.slice(0, 12).map((c) => `<tr><td>${esc(new Date(c.date).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }))}</td><td class="doux petit">${esc(c.raison)} · ${Object.entries(c.nombres ?? {}).map(([k, v]) => `${v} ${k}`).join(', ')}</td><td class="col-act"><button class="bouton" data-restaurer="${esc(c.id)}">Restaurer</button></td></tr>`).join('')}</tbody></table>` : '<p class="doux">Pas encore de copie : Odin en fait une chaque jour.</p>'}</section>` : ''}
        ${moi?.appareils?.length ? `<section class="carte"><h3>Tes appareils</h3><table class="tableau"><tbody>${moi.appareils.map((a: any) => `<tr><td><b>${esc(a.nom)}</b></td><td class="doux petit">${esc(a.plateforme)}</td><td class="doux petit">${a.enLigne ? 'en ligne' : a.vu ? `vu ${quand(a.vu)}` : ''}</td></tr>`).join('')}</tbody></table><p class="doux petit">Un appareil perdu ? Révoque-le dans l’appli Pégase d’Odin.</p></section>` : ''}
        ${l ? '<section class="carte"><h3>Agenda sur ton téléphone ou dans l’agenda Windows</h3><p class="doux petit">Un lien d’abonnement en lecture seule (iCalendar).</p><div class="rangee"><button class="bouton" data-lien-agenda>Copier le lien d’abonnement</button></div></section>' : ''}
        <section class="carte"><h3>Dernières synchros</h3>${(info?.journal ?? []).length ? `<table class="tableau"><tbody>${info.journal.slice(0, 10).map((j: any) => `<tr><td>${esc(j.quoi)}</td><td class="doux petit col-heure">${quand(j.quand)}</td></tr>`).join('')}</tbody></table>` : '<p class="doux">Rien pour l’instant.</p>'}</section>
      </div>`;
    };
    void dessiner(); brancherReglages(el);
    el.addEventListener('click', async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
      if (b.hasAttribute('data-maintenant')) { await api.faire('synchroMaintenant'); ctx.toast('Synchronisé.'); void dessiner(); }
      else if (b.hasAttribute('data-deconnecter')) { await api.faire('deconnexion'); ctx.toast('Pégase n’est plus relié à Odin. Tes données restent sur ce PC.'); void dessiner(); }
      else if (b.hasAttribute('data-dossier')) api.faire('ouvrirDossierProfil');
      else if (b.hasAttribute('data-cache')) { await api.faire('viderCache'); ctx.toast('Cache vidé.'); void dessiner(); }
      else if (b.hasAttribute('data-importer')) api.faire('naviguer', { texte: 'pegase://importer' });
      else if (b.dataset.restaurer) { const t = await api.faire('odinRestaurer', { copie: b.dataset.restaurer }); ctx.toast(String(t)); }
      else if (b.hasAttribute('data-lien-agenda')) { const u = await api.faire('lienAgenda'); if (u) { await navigator.clipboard.writeText(u).catch(() => 0); ctx.toast('Lien d’abonnement copié.'); } }
      else if (b.hasAttribute('data-chercher')) { await api.faire('odinChercher', {}); ctx.toast('Recherche d’Odin sur le réseau…'); setTimeout(async () => { const E = await api.etat(); const t = E.premier?.trouves?.[0]; const h = el.querySelector<HTMLInputElement>('[name=hote]'); if (t && h) { const u = new URL(t.adresse); h.value = u.hostname; (el.querySelector('[name=port]') as HTMLInputElement).value = u.port; } }, 3000); }
    });
    el.addEventListener('submit', async (e) => {
      const f = e.target as HTMLFormElement; if (!f.hasAttribute('data-relier')) return; e.preventDefault();
      const d = Object.fromEntries(new FormData(f)) as Record<string, string>;
      const t = await api.faire('odinChercher', { hote: d.hote, port: d.port });
      const err = f.querySelector('.erreur')!;
      if (!t?.ok) { err.textContent = t?.texte ?? 'Odin ne répond pas.'; return; }
      const r = await api.faire('odinConnecter', { adresse: t.odin.adresse, email: d.email, motdepasse: d.motdepasse });
      if (!r?.ok) { err.textContent = r?.texte ?? 'Connexion refusée.'; return; }
      ctx.toast('Relié à Odin : la synchro commence.'); void dessiner();
    });
    let avant = ''; return () => { const k = JSON.stringify(ctx.etat().synchro); if (k !== avant) { const premier = !avant; avant = k; if (!premier) void dessiner(); } };
  },

  // Plume, le correcteur d'Odin dans les pages web : le réglage est celui de la personne dans Odin (le même partout).
  // Ici : « Dans Pégase » seulement ; l'interrupteur principal (« Désactiver » coupe partout) ne se rallume que dans
  // Réglages → Plume d'Odin.
  plume: (el, ctx) => {
    const dessiner = async () => {
      const r = await api.faire('plumeEtat').catch(() => null) as { prive?: boolean; relie?: boolean; etat?: Record<string, any> | null } | null;
      const tete = `<h2 class="titre-section">Plume (correcteur)</h2><p class="sous">Plume souligne les fautes pendant que tu écris dans les sites, les formulaires et leurs barres de recherche (rouge : orthographe et frappe ; bleu : grammaire) et propose une correction : rien ne change sans ton clic. Jamais dans un champ de mot de passe, de code, de carte bancaire ni dans un éditeur de code. Le texte ne part que vers ton Odin, jamais ailleurs.</p>`;
      const e = r?.etat;
      if (r?.prive) { el.innerHTML = `${tete}<section class="carte"><p class="doux">Pas de Plume dans une fenêtre privée : rien de ce que tu y écris n’est envoyé.</p></section>`; return; }
      if (!r || r.relie === false) { el.innerHTML = `${tete}<section class="carte"><p class="doux">Plume passe par ton Odin : relie d’abord Pégase à Odin (Réglages → Synchro Odin).</p><div class="rangee"><button class="bouton" data-synchro>Synchro Odin</button></div></section>`; return; }
      if (!e) { el.innerHTML = `${tete}<section class="carte"><p class="doux">Odin ne répond pas pour l’instant : réessaie dans un moment.</p></section>`; return; }
      const depuis = e.depuis ? new Date(Number(e.depuis)).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
      el.innerHTML = `${tete}<div class="pile"><section class="carte">
        <div class="rangee"><img src="${appIcone('snotra')}" alt="" width="40" height="40"><div class="pousse"><b>Plume</b><div class="doux petit">${e.actif ? `Activé${e.pegase ? ' dans Pégase' : ', mais pas dans Pégase'}${e.correcteur === 'LanguageTool' ? ' · LanguageTool' : ''}` : `Désactivé partout${depuis ? ` depuis le ${esc(depuis)}` : ''} : seul Réglages → Plume d’Odin le rallume.`}</div></div></div>
        <div class="reglage"><div><b>Dans Pégase</b><div class="doux petit">Sites, formulaires, barre de recherche${e.actif ? '' : ' (Plume est désactivé partout)'}.</div></div><input type="checkbox" class="interrupteur" data-plume-pegase ${e.pegase ? 'checked' : ''} ${e.actif ? '' : 'disabled'} aria-label="Plume dans Pégase"></div>
        <div class="rangee"><button class="bouton" data-plume-odin>Ouvrir Réglages → Plume dans Odin</button></div>
        <p class="doux petit">Langue, ton dictionnaire, les fautes ignorées, « Odin se sert de Plume » : dans Odin. Le réglage est le même sur tous tes appareils.</p></section></div>`;
    };
    void dessiner();
    el.addEventListener('change', async (ev) => {
      const t = ev.target as HTMLInputElement; if (!t.hasAttribute('data-plume-pegase')) return;
      const r = await api.faire('plumeDansPegase', { oui: t.checked });
      ctx.toast(r ? (t.checked ? 'Plume corrige de nouveau dans Pégase.' : 'Plume ne corrige plus dans Pégase.') : 'Odin ne répond pas : rien n’a changé.'); void dessiner();
    });
    el.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
      if (b.hasAttribute('data-plume-odin')) void api.faire('plumeOuvrirOdin');
      else if (b.hasAttribute('data-synchro')) api.faire('naviguer', { texte: 'pegase://reglages/synchro' });
    });
  },

  cookies: (el, ctx) => {
    let ouvert = ''; let q = '';
    const dessiner = async () => {
      const r = ctx.etat().reglages; const d = await api.faire('cookiesListe');
      const sites = (d?.sites ?? []).filter((s: any) => !q || s.site.includes(q));
      const details = ouvert ? await api.faire('cookiesSite', { site: ouvert }) : [];
      el.innerHTML = `<div class="rangee entete-section"><h2 class="titre-section pousse">Cookies et données des sites</h2><button class="bouton danger" data-tout>Tout effacer…</button></div>
        <div class="cartes trois"><div class="carte chiffre"><div><b>${d?.sites.length ?? 0}</b><span>sites</span></div></div><div class="carte chiffre"><div><b>${d?.total ?? 0}</b><span>cookies</span></div></div><div class="carte chiffre"><div><b>${taille((d?.taille ?? 0) + (d?.cache ?? 0))}</b><span>avec le cache</span></div></div></div>
        <p class="sous">Restent sur cet ordinateur, chiffrés. Jamais envoyés à Odin.</p>
        <section class="carte"><div class="reglage"><div><b>Bloquer les cookies tiers</b><div class="doux petit">Les pisteurs d’autres sites ne te suivent pas.</div></div>${inter('cookiesTiers', r.cookiesTiers, 'Bloquer les cookies tiers')}</div>
          <div class="reglage"><div><b>Effacer en fermant Pégase</b><div class="doux petit">Sauf les sites que tu gardes (${r.garderSites.length}).</div></div>${inter('viderFermeture', r.viderFermeture, 'Effacer en fermant Pégase')}</div></section>
        <input class="champ recherche-page" type="search" placeholder="Chercher un site ou un cookie" value="${esc(q)}" data-q aria-label="Chercher un site">
        <section class="carte liste-sites">${sites.length ? sites.map((s: any) => `<div class="site-cookies${s.site === ouvert ? ' ouvert' : ''}">
          <button class="ligne-site-c" data-site="${esc(s.site)}" aria-expanded="${s.site === ouvert}">${iconeSite(`https://${s.site}/`, undefined, s.site)}<b class="pousse ellipse">${esc(s.site)}</b><span class="doux petit">${s.n} cookie${s.n > 1 ? 's' : ''} · ${taille(s.taille)}</span>${s.garde ? '<span class="puce">gardé</span>' : ''}<span aria-hidden="true">${s.site === ouvert ? '⌄' : '›'}</span></button>
          ${s.site === ouvert ? `<table class="tableau"><thead><tr><th>Nom</th><th>Valeur</th><th>Expire</th><th>Protection</th><th></th></tr></thead><tbody>${details.map((k: any, i: number) => `<tr><td class="ellipse"><b>${esc(k.nom)}</b></td><td><button class="valeur-masquee" data-voir="${i}" aria-label="Afficher la valeur de ${esc(k.nom)}">••••••••••••</button></td><td class="petit">${k.expire ? esc(new Date(k.expire).toLocaleDateString('fr-FR')) : 'Fin de session'}</td><td class="petit">${[k.secure ? 'Secure' : '', k.httpOnly ? 'HttpOnly' : '', k.sameSite && k.sameSite !== 'unspecified' ? `SameSite=${k.sameSite === 'no_restriction' ? 'None' : k.sameSite[0].toUpperCase() + k.sameSite.slice(1)}` : ''].filter(Boolean).map((x) => `<span class="puce">${x}</span>`).join(' ')}</td><td class="col-act"><button class="ib p" data-suppr="${i}" aria-label="Supprimer le cookie ${esc(k.nom)}">${I.corbeille(15)}</button></td></tr>`).join('')}</tbody></table>
          <div class="rangee"><button class="bouton" data-garder="${esc(s.site)}" aria-pressed="${s.garde}">${s.garde ? 'Ne plus garder en fermant' : 'Garder ce site en fermant'}</button><button class="bouton danger" data-suppr-site="${esc(s.site)}">Effacer ce site</button></div>` : ''}</div>`).join('') : '<p class="doux">Aucun cookie.</p>'}</section>`;
      (el as any).__details = details;
      const i = el.querySelector<HTMLInputElement>('[data-q]'); if (i && q) { i.focus(); i.setSelectionRange(q.length, q.length); }
    };
    void dessiner(); brancherReglages(el, () => void dessiner());
    el.addEventListener('input', (e) => { const t = e.target as HTMLInputElement; if (t.dataset.q !== undefined) { q = t.value.trim().toLowerCase(); void dessiner(); } });
    el.addEventListener('click', async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
      const det = (el as any).__details as any[];
      if (b.dataset.site) { ouvert = ouvert === b.dataset.site ? '' : b.dataset.site; void dessiner(); }
      else if (b.dataset.voir) { const k = det[Number(b.dataset.voir)]; const v = await api.faire('cookieValeur', { nom: k.nom, domaine: k.domaine, chemin: k.chemin }); b.textContent = v ?? '(vide)'; b.classList.add('montree'); }
      else if (b.dataset.suppr) { const k = det[Number(b.dataset.suppr)]; await api.faire('cookieSuppr', { nom: k.nom, domaine: k.domaine, chemin: k.chemin, secure: k.secure }); void dessiner(); }
      else if (b.dataset.supprSite) { await api.faire('cookiesSupprSite', { site: b.dataset.supprSite }); ouvert = ''; ctx.toast('Cookies et données de ce site effacés.'); void dessiner(); }
      else if (b.dataset.garder) { await api.faire('garderSite', { site: b.dataset.garder, oui: b.getAttribute('aria-pressed') !== 'true' }); void dessiner(); }
      else if (b.hasAttribute('data-tout')) { b.textContent = 'Sûr ? Cliquer encore pour tout effacer'; b.removeAttribute('data-tout'); b.setAttribute('data-tout-ok', ''); }
      else if (b.hasAttribute('data-tout-ok')) { await api.faire('cookiesTout'); ctx.toast('Tous les cookies et données des sites sont effacés.'); void dessiner(); }
    });
  },

  motsdepasse: (el, ctx) => {
    let montres: Record<string, string> = {};
    const dessiner = async () => {
      const r = ctx.etat().reglages; const d = await api.faire('mdpListe');
      if (!d) { el.innerHTML = '<h2 class="titre-section">Mots de passe</h2><p class="doux">Une fenêtre privée ne garde aucun mot de passe.</p>'; return; }
      const sys = ctx.etat().plateforme === 'win32' ? 'le coffre de Windows' : ctx.etat().plateforme === 'darwin' ? 'le Trousseau du Mac' : 'le coffre du système';
      el.innerHTML = `<div class="rangee entete-section"><h2 class="titre-section pousse">Mots de passe</h2><button class="bouton" data-generer>Créer un mot de passe fort</button><button class="bouton plein" data-ajouter>Ajouter</button></div>
        <section class="carte"><div class="rangee"><b class="grand-chiffre">${d.bilan.n}</b><div><b>enregistré${d.bilan.n > 1 ? 's' : ''}</b><div class="doux petit">Chiffrés avec une clé gardée par ${sys}, sur cet ordinateur. Toujours masqués.</div></div></div>
          <div class="bilan ${d.bilan.reutilises || d.bilan.faibles ? 'attention' : ''}"><b>Bilan : ${d.bilan.reutilises} réutilisé${d.bilan.reutilises > 1 ? 's' : ''}, ${d.bilan.faibles} faible${d.bilan.faibles > 1 ? 's' : ''}</b><span class="doux petit">Vérifié sur ce PC, sans envoyer tes mots de passe. Les fuites connues : pas encore vérifiées.</span></div></section>
        <section class="carte"><div class="reglage"><div><b>Proposer d’enregistrer</b><div class="doux petit">Après une connexion réussie.</div></div>${inter('proposerMdp', r.proposerMdp, 'Proposer d’enregistrer')}</div>
          <div class="reglage"><div><b>Copie chiffrée dans le coffre d’Odin</b><div class="doux petit">Pour les retrouver sur un autre appareil : bientôt, avec Thésauros (aujourd’hui, rien ne quitte ce PC).</div></div><input type="checkbox" class="interrupteur" disabled aria-label="Copie dans Odin (bientôt)"></div></section>
        <section class="carte">${d.entrees.length ? `<table class="tableau mdp-table"><thead><tr><th>Site</th><th>Identifiant</th><th>Mot de passe</th><th>Solidité</th><th></th></tr></thead><tbody>${d.entrees.map((x: any) => `<tr>
          <td>${iconeSite(x.origine, undefined, x.site)} <b>${esc(x.site)}</b>${x.solidite === 'reutilise' ? `<div class="doux petit">Même mot de passe que ${x.autres} autre${x.autres > 1 ? 's' : ''} site${x.autres > 1 ? 's' : ''}</div>` : x.solidite === 'faible' ? `<div class="doux petit">${x.longueur} caractères, facile à deviner</div>` : ''}</td>
          <td class="ellipse">${esc(x.identifiant)}</td>
          <td><span class="secret" data-secret="${esc(x.id)}">${montres[x.id] ? esc(montres[x.id]) : '••••••••••'}</span></td>
          <td><span class="puce sol-${SOLIDITE[x.solidite][1]}">${SOLIDITE[x.solidite][0]}</span></td>
          <td class="col-act"><button class="ib p" data-afficher="${esc(x.id)}" aria-label="Afficher le mot de passe de ${esc(x.site)}">${I.oeil(16)}</button><button class="ib p" data-copier="${esc(x.id)}" aria-label="Copier le mot de passe de ${esc(x.site)}">${I.dupliquer(16)}</button><button class="ib p" data-suppr="${esc(x.id)}" aria-label="Supprimer le mot de passe de ${esc(x.site)}">${I.corbeille(16)}</button></td></tr>`).join('')}</tbody></table>` : '<p class="doux">Aucun mot de passe enregistré. Connecte-toi à un site : Pégase te proposera de le garder.</p>'}
          <p class="doux petit">Remplissage seulement quand tu cliques sur la clé dans le champ, et seulement sur le site exact (jamais un site sosie ni un cadre caché d’un autre site).</p></section>
        ${d.jamais.length ? `<section class="carte"><h3>Jamais pour ces sites</h3>${d.jamais.map((o: string) => `<div class="rangee"><span class="pousse">${esc(o)}</span><button class="bouton" data-plus-jamais="${esc(o)}">Retirer</button></div>`).join('')}</section>` : ''}`;
    };
    void dessiner(); brancherReglages(el);
    const deverrouiller = async (op: 'mdpReveler' | 'mdpCopier', id: string) => {
      let r = await api.faire(op, { id });
      if (!r?.ok && !/^Ce n’est pas/.test(r?.texte ?? '')) { ctx.toast(r?.texte ?? 'Refusé.'); return; }
      if (!r?.ok) { const m = await demanderMdp('Retape ton mot de passe Odin pour l’afficher.'); if (m === null) return; r = await api.faire(op, { id, motdepasse: m }); }
      if (!r?.ok) { ctx.toast(r?.texte ?? 'Refusé.'); return; }
      if (r.copie) { ctx.toast('Copié. Le presse-papiers sera vidé dans 30 s.'); return; }
      montres[id] = r.motdepasse; void dessiner();
      setTimeout(() => { delete montres[id]; void dessiner(); }, 30_000);
    };
    el.addEventListener('click', async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
      if (b.dataset.afficher) await deverrouiller('mdpReveler', b.dataset.afficher);
      else if (b.dataset.copier) await deverrouiller('mdpCopier', b.dataset.copier);
      else if (b.dataset.suppr) { await api.faire('mdpSuppr', { id: b.dataset.suppr }); void dessiner(); }
      else if (b.dataset.plusJamais) { await api.faire('mdpPlusJamais', { origine: b.dataset.plusJamais }); void dessiner(); }
      else if (b.hasAttribute('data-generer')) { await api.faire('mdpGenerer', { copier: true }); ctx.toast('Un mot de passe fort est copié (le presse-papiers sera vidé dans 30 s).'); }
      else if (b.hasAttribute('data-ajouter')) {
        const site = await (window as any).__pegaseDemander?.('Adresse du site (ex. mayotte.fr)', ''); if (!site) return;
        const ident = await (window as any).__pegaseDemander?.('Identifiant (e-mail ou nom)', ''); if (ident === null) return;
        const m = await demanderMdp('Le mot de passe de ce site'); if (!m) return;
        const r = await api.faire('mdpAjouter', { site, identifiant: ident, motdepasse: m }); ctx.toast(r?.ok ? 'Mot de passe enregistré.' : r?.texte ?? 'Impossible.'); void dessiner();
      }
    });
  },

  permissions: (el) => {
    const NOMS: Record<string, string> = { media: 'Caméra et micro', geolocation: 'Position', notifications: 'Notifications', 'clipboard-read': 'Lire le presse-papiers', midi: 'MIDI', midiSysex: 'MIDI', 'display-capture': 'Voir l’écran', hid: 'Appareils HID', serial: 'Ports série', usb: 'Appareils USB', idleDetection: 'Présence devant l’écran' };
    const dessiner = async () => {
      const l: any[] = await api.faire('permissionsListe') ?? [];
      el.innerHTML = `<h2 class="titre-section">Permissions des sites</h2><p class="sous">Caméra, micro, position, notifications… : refusées tant que tu n’as pas dit oui. Une page qui demande plus de 3 fois en une minute est refusée sans te déranger. Les liens vers des programmes de ton PC sont demandés avant (certains, dangereux, jamais : ms-msdt, search-ms…).</p>
        <section class="carte">${l.length ? `<table class="tableau"><tbody>${l.map((x) => `<tr><td class="ellipse"><b>${esc(x.origine)}</b></td><td>${esc(NOMS[x.permission] ?? x.permission)}</td><td><span class="puce ${x.ok ? 'sol-ok' : 'sol-ko'}">${x.ok ? 'Autorisé' : 'Refusé'}</span></td><td class="col-act"><button class="bouton" data-oublier="${esc(x.cle)}">Oublier</button></td></tr>`).join('')}</tbody></table>` : '<p class="doux">Aucun site n’a demandé de permission depuis l’ouverture de Pégase.</p>'}
        <p class="doux petit">Les réponses valent jusqu’à la fermeture de Pégase.</p></section>`;
    };
    void dessiner();
    el.addEventListener('click', async (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-oublier]'); if (b) { await api.faire('permissionOublier', { cle: b.dataset.oublier }); void dessiner(); } });
  },

  securite: (el, ctx) => {
    const dessiner = async (encours = false) => {
      const c = await api.faire('controleResultats').catch(() => null);
      const groupes: any[] = c?.groupes ?? [];
      const n = groupes.reduce((s, g) => s + g.essais.length, 0), bloques = groupes.reduce((s, g) => s + g.essais.filter((x: any) => x.resultat === 'bloqué').length, 0);
      const failles = groupes.reduce((s, g) => s + g.essais.filter((x: any) => x.resultat === 'FAILLE').length, 0);
      const protections: [string, string][] = [['Chaque site isolé (bac à sable)', 'Un site ne peut pas lire un autre site ni ton ordinateur'], ['HTTPS d’abord', 'Avertit avant une page non chiffrée'], ['Adresses piégées démasquées', 'Lettres sosies d’un autre alphabet montrées en clair (xn--…)'], ['Cookies tiers bloqués', 'Et adresse IP cachée aux appels vidéo des sites'], ['Permissions demandées', 'Caméra, micro, position, notifications : refusées sans ton accord'], ['Liens vers des programmes', 'Pégase demande avant d’ouvrir une appli depuis un site']];
      el.innerHTML = `<div class="rangee entete-section"><h2 class="titre-section pousse">Sécurité</h2><button class="bouton plein" data-relancer ${encours ? 'disabled' : ''}>${encours ? 'Contrôle en cours…' : 'Relancer le contrôle'}</button></div>
        <section class="carte resultat-controle ${failles ? 'faille' : n ? 'ok' : ''}">${c ? `<b class="grand">${n} attaques essayées, ${bloques} bloquées${failles ? `, ${failles} FAILLE${failles > 1 ? 'S' : ''}` : ''}</b>
          <div class="doux petit">Contrôle du ${esc(new Date(c.date).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }))} · Pégase ${esc(c.version)} · Chromium ${esc(c.chromium)}. Aucune protection ne garantit 100 % : le contrôle se relance à chaque mise à jour.</div>` : '<b>Pas encore de contrôle sur ce PC.</b><div class="doux petit">« Relancer le contrôle » essaie pour de vrai une trentaine d’attaques contre Pégase, sur une page piège locale (rien ne sort de ce PC).</div>'}</section>
        <section class="carte"><div class="grille-protections">${protections.map(([a, b]) => `<div class="rangee"><span class="ok-rond petit" aria-hidden="true">✓</span><div><b>${a}</b><div class="doux petit">${b}</div></div></div>`).join('')}</div></section>
        ${groupes.length ? `<section class="carte"><h3>Ce qui a été essayé contre Pégase</h3>${groupes.map((g, i) => {
          const f = g.essais.filter((x: any) => x.resultat === 'FAILLE').length, ne = g.essais.filter((x: any) => x.resultat === 'non essayé').length;
          return `<details class="groupe-attaques" ${f ? 'open' : ''}><summary><div class="pousse"><b>${esc(g.nom)}</b><div class="doux petit">${esc(g.detail)}</div></div><span class="doux petit">${g.essais.length} essais</span><span class="puce ${f ? 'sol-ko' : 'sol-ok'}">${f ? `✗ ${f} FAILLE${f > 1 ? 'S' : ''}` : ne ? `✓ Bloqué (${ne} non essayé${ne > 1 ? 's' : ''})` : '✓ Bloqué'}</span></summary>
            <table class="tableau"><tbody>${g.essais.map((x: any) => `<tr><td>${esc(x.nom)}</td><td class="doux petit">${esc(x.detail ?? '')}</td><td><span class="puce ${x.resultat === 'FAILLE' ? 'sol-ko' : x.resultat === 'bloqué' ? 'sol-ok' : ''}">${x.resultat === 'bloqué' ? 'bloqué' : esc(x.resultat)}</span></td></tr>`).join('')}</tbody></table></details>`; void i;
        }).join('')}</section>` : ''}`;
    };
    void dessiner();
    el.addEventListener('click', async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-relancer]'); if (!b) return;
      await dessiner(true);
      const r = await api.faire('controle').catch(() => null);
      ctx.toast(r?.texte ?? 'Contrôle terminé.'); await dessiner();
    });
  },

  bouclier: (el, ctx) => {
    const dessiner = () => {
      const E = ctx.etat(); const r = E.reglages; const p = E.protection;
      el.innerHTML = `<h2 class="titre-section">Bouclier (pubs, pisteurs)</h2><div class="pile">
        <div class="cartes trois"><div class="carte chiffre"><img src="${appIcone('vidarr')}" alt="" width="36" height="36"><div><b>${p.bloquesTotal.toLocaleString('fr-FR')}</b><span>bloqués depuis l’ouverture</span></div></div><div class="carte chiffre"><div><b>${p.filtres.toLocaleString('fr-FR')}</b><span>règles chargées</span></div></div><div class="carte chiffre"><div><b>${p.dnsChiffre ? 'Chiffré' : 'Non chiffré'}</b><span>${esc(p.dns)}</span></div></div></div>
        <section class="carte"><div class="reglage"><div><b>Bloqueur dans les pages</b><div class="doux petit">Listes du même genre que Brave (EasyList, EasyPrivacy…). « Strict » bloque aussi les boutons des réseaux sociaux.</div></div>${choix('bloqueur', r.bloqueur, [['coupe', 'Coupé'], ['normal', 'Normal'], ['strict', 'Strict']], 'Niveau du bloqueur')}</div>
          <div class="reglage"><div><b>Refuser tout seul les bandeaux de cookies</b></div>${inter('cookiesRefus', r.cookiesRefus, 'Refuser les bandeaux de cookies')}</div>
          <div class="reglage"><div><b>Adresses des sites (DNS chiffré)</b><div class="doux petit">Avec Odin : Sphinx. Sans Odin : ce service public chiffré.</div></div>${choix('dnsSecours', r.dnsSecours, [['https://dns.quad9.net/dns-query', 'Quad9 (Suisse)'], ['https://cloudflare-dns.com/dns-query', 'Cloudflare'], ['https://dns.adguard-dns.com/dns-query', 'AdGuard (bloque les pubs)'], ['https://dns.google/dns-query', 'Google']], 'DNS de secours')}</div></section>
        <p class="doux petit">Le détail de chaque page : Inspecter → panneau « Bouclier ».</p></div>`;
    };
    dessiner(); brancherReglages(el, () => setTimeout(dessiner, 100));
  },

  telechargements: (el, ctx) => {
    const r = ctx.etat().reglages;
    el.innerHTML = `<h2 class="titre-section">Téléchargements et Asclépios</h2><div class="pile">
      <section class="carte"><p>Chaque fichier attend à part (quarantaine) pendant l’analyse ; il n’arrive dans tes Téléchargements que s’il est sain. Pégase n’ouvre jamais un fichier tout seul. Aucune analyse ne garantit 100 %.</p>
        <div class="reglage"><div><b>Envoyer les fichiers à Asclépios (Odin) pour analyse</b><div class="doux petit">Sinon, seule l’analyse sur ce PC est faite (empreintes connues d’Asclépios${ctx.etat().plateforme === 'win32' ? ' et antivirus de Windows' : ''}). Seul le journal des téléchargements part sur Odin, jamais les fichiers sans ton accord.</div></div>${inter('analyseOdin', r.analyseOdin, 'Analyse par Odin')}</div>
        <div class="rangee"><button class="bouton" data-liste>Voir tous les téléchargements</button></div></section></div>`;
    brancherReglages(el);
    el.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-liste]')) api.faire('naviguer', { texte: 'pegase://telechargements' }); });
  },

  mobile: (el) => {
    const g = (appareilsJson as any).groupes as any[];
    el.innerHTML = `<h2 class="titre-section">Affichage mobile</h2><div class="pile"><section class="carte"><p>Clic droit sur une page → « Affichage mobile » (Ctrl+Maj+M) : la page s’affiche comme sur le téléphone choisi (taille, densité, agent du téléphone, tactile, réseau lent), sans ouvrir de port de débogage.</p>
      ${g.map((x) => `<h3>${esc(x.nom)}</h3><table class="tableau"><tbody>${x.appareils.map((a: any) => `<tr><td><b>${esc(a.nom)}</b>${a.aConfirmer ? ' <span class="puce">à confirmer</span>' : ''}</td><td class="doux">${a.w ? `${a.w} × ${a.h}` : `${a.ouvert.join(' × ')} ouvert · ${a.ferme.join(' × ')} fermé`}</td><td class="doux">×${String(a.dpr).replace('.', ',')}</td></tr>`).join('')}</tbody></table>`).join('')}</section></div>`;
  },

  langues: (el, ctx) => {
    el.innerHTML = `<h2 class="titre-section">Langues et traduction</h2><div class="pile"><section class="carte">
      <div class="reglage"><div><b>Langue de Pégase</b><div class="doux petit">Français, pour tout : menus, pages de Pégase et inspecteur.</div></div><span class="puce">Français</span></div>
      <div class="reglage"><div><b>Traduire une page en français</b><div class="doux petit">Clic droit → « Traduire en français » : la traduction est faite par ton Odin${ctx.etat().odin?.connecte ? '' : ' (relie Pégase à Odin pour l’activer)'}. Rien ne part chez un service de traduction extérieur.</div></div><span class="puce ${ctx.etat().odin?.connecte ? 'sol-ok' : ''}">${ctx.etat().odin?.connecte ? 'Prête' : 'Odin pas relié'}</span></div></section></div>`;
  },

  apropos: (el, ctx) => {
    void api.faire('versions').then((v: any) => {
      el.innerHTML = `<h2 class="titre-section">À propos de Pégase</h2><div class="pile"><section class="carte">
        <div class="rangee"><img src="${appIcone('pegase')}" alt="" width="48" height="48"><div><b>Pégase ${esc(v?.pegase ?? '')}</b><div class="doux petit">Le navigateur d’Odin · TOUFATECH · licence MIT</div></div></div>
        <table class="tableau"><tbody><tr><td>Chromium</td><td>${esc(v?.chromium ?? '')}</td></tr><tr><td>Electron</td><td>${esc(v?.electron ?? '')}</td></tr><tr><td>Bloqueur</td><td>@ghostery/adblocker-electron (MPL-2.0, utilisé tel quel)</td></tr></tbody></table>
        <div class="rangee"><button class="bouton" data-maj>Chercher une mise à jour</button></div>
        <p class="doux petit">Pas de « Caster » : Pégase ne peut pas envoyer proprement une page vers une télé. Les installateurs ne sont pas encore signés (certificat payant pas encore choisi) : Windows et Mac peuvent afficher un avertissement à l’installation.</p></section></div>`;
    });
    el.addEventListener('click', async (e) => { if ((e.target as HTMLElement).closest('[data-maj]')) { ctx.toast('Recherche d’une mise à jour…'); const r = await api.faire('miseAJour'); ctx.toast(r || 'Pégase est à jour.'); } });
  },
};
