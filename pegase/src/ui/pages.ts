// Les pages pegase:// (dessinées par l'interface, dans la zone des pages) : accueil, favoris, historique,
// réglages, téléchargements, aide. Agenda, import, profil et synchro sont dans pages2.ts.
import type { Favori, HistoireLigne, Theme } from '../commun/types';
import { api, esc, iconeSite, domaine, quand, taille, appIcone, LOGO, type Ctx } from './commun';
import { I } from './icones';
import { pagesSuite } from './pages2';

type Page = (el: HTMLElement, ctx: Ctx) => void | (() => void);
const rafraichir = new Map<HTMLElement, () => void>();

/** Monte une page pegase:// dans son élément. */
export function pageInterne(el: HTMLElement, nom: string, ctx: Ctx): void {
  const p = PAGES[nom] ?? pagesSuite[nom] ?? PAGES.inconnue;
  const r = p(el, ctx);
  if (typeof r === 'function') rafraichir.set(el, r); else rafraichir.delete(el);
}
/** Les pages qui montrent des choses vivantes (téléchargements…) se mettent à jour avec l'état. */
export function rafraichirPages(): void { for (const [el, f] of rafraichir) { if (!el.isConnected) rafraichir.delete(el); else f(); } }

const ouvrirCommande = () => document.dispatchEvent(new CustomEvent('pegase:commande'));

const PAGES: Record<string, Page> = {
  inconnue: (el) => { el.innerHTML = `<div class="contenu"><h1>Page introuvable</h1><p class="sous">Cette page de Pégase n’existe pas.</p></div>`; },

  accueil: (el, ctx) => {
    const dessiner = () => {
      const E = ctx.etat();
      const recents = E.onglets.filter((o) => !o.url.startsWith('pegase://')).slice(0, 6);
      el.innerHTML = `<div class="accueil">${LOGO(72)}
        <button class="adresse champ-accueil" data-ouvrir-commande>${I.loupe(18)}<span>Chercher ou saisir une adresse…</span><span class="kbd-accueil">${E.plateforme === 'darwin' ? '⌘T' : 'Ctrl T'}</span></button>
        <div class="propositions" id="propositions"></div>
        ${E.tuiles.length ? `<div class="propositions">${E.tuiles.slice(0, 8).map((f) => `<button class="proposition" data-url="${esc(f.url)}">${iconeSite(f.url, f.icone, f.nom)}<span class="ellipse">${esc(f.nom)}</span></button>`).join('')}</div>` : ''}
        ${recents.length ? `<div class="propositions">${recents.map((o) => `<button class="proposition" data-onglet="${esc(o.id)}">${iconeSite(o.url, o.icone, o.titre)}<span class="ellipse">${esc(o.titre || domaine(o.url))}</span></button>`).join('')}</div>` : ''}
      </div>`;
      // Idées d'Odin pour la page d'accueil (contrat §4) : rendez-vous, sites à surveiller, « tu cherchais… ».
      if (E.odin?.connecte) api.faire('propositions').then((l: any[]) => {
        const p = el.querySelector('#propositions'); if (!p || !Array.isArray(l)) return;
        p.innerHTML = l.slice(0, 6).map((x) => `<button class="proposition" ${x.url ? `data-url="${esc(x.url)}"` : `data-demander="${esc(x.texte)}"`}><img src="${appIcone(x.appli || 'valhalla')}" alt="" width="22" height="22"><span>${esc(x.texte)}</span></button>`).join('');
      }).catch(() => 0);
    };
    dessiner();
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
      if (b.hasAttribute('data-ouvrir-commande')) ouvrirCommande();
      else if (b.dataset.url) ctx.ouvrir(b.dataset.url);
      else if (b.dataset.onglet) api.faire('activer', { id: b.dataset.onglet });
      else if (b.dataset.demander) document.dispatchEvent(new CustomEvent('pegase:odin', { detail: b.dataset.demander }));
    });
  },

  favoris: (el, ctx) => {
    let tout: Favori[] = []; let dossier = ''; let q = '';
    const charger = async () => { tout = await api.faire('favoris'); dessiner(); };
    const dessiner = () => {
      const dossiers = tout.filter((f) => f.type === 'dossier');
      const liens = tout.filter((f) => f.type === 'favori' && (!dossier || f.dossier === dossier) && (!q || f.nom.toLowerCase().includes(q) || f.url.toLowerCase().includes(q)));
      const n = (id: string) => tout.filter((f) => f.type === 'favori' && f.dossier === id).length;
      el.innerHTML = `<div class="contenu">
        <div class="rangee entete-page"><h1>Favoris</h1><span class="doux">★ ${tout.filter((f) => f.type === 'favori').length}</span><span class="pousse"></span>
          <input class="champ recherche-page" type="search" placeholder="Chercher dans les favoris" value="${esc(q)}" aria-label="Chercher dans les favoris" data-q>
          <button class="bouton" data-nouveau-dossier>+ Nouveau dossier</button></div>
        <p class="sous">Glisse un favori vers un dossier. Les favoris sont gardés sur ce PC${ctx.etat().odin?.connecte ? ' et sur Odin, et reviennent sur ton téléphone' : ' (relie Odin pour les retrouver partout)'}.</p>
        <div class="favoris-grille">
          <div class="liste dossiers-fav" role="list">
            <button class="ligne${!dossier ? ' actif' : ''}" data-dossier="">${I.etoile(18)}<span class="t">Tous</span><span class="doux">${tout.filter((f) => f.type === 'favori').length}</span></button>
            ${dossiers.map((d) => `<button class="ligne${dossier === d.id ? ' actif' : ''}" data-dossier="${esc(d.id)}" data-drop-fav="${esc(d.id)}">${I.dossier(18)}<span class="t ellipse">${esc(d.nom)}</span><span class="doux">${n(d.id)}</span></button>`).join('')}
          </div>
          <div class="carte liens-fav">${liens.length ? `<table class="tableau"><tbody>${liens.slice(0, 500).map((f) => `<tr draggable="true" data-fav="${esc(f.id)}">
            <td class="col-ic">${iconeSite(f.url, f.icone, f.nom)}</td>
            <td><button class="lien-fav" data-ouvrir="${esc(f.url)}"><b class="ellipse">${esc(f.nom)}</b><span class="doux petit ellipse">${esc(f.url)}</span></button></td>
            <td class="col-act"><button class="ib p" data-tuile="${esc(f.id)}" aria-label="${f.tuile ? 'Retirer des tuiles' : 'Mettre en tuile en haut de la barre de côté'}" aria-pressed="${!!f.tuile}">${I.epingle(16)}</button>
            <button class="ib p" data-renommer-fav="${esc(f.id)}" aria-label="Renommer">${I.crayon(16)}</button>
            <button class="ib p" data-suppr-fav="${esc(f.id)}" aria-label="Supprimer ce favori">${I.corbeille(16)}</button></td></tr>`).join('')}</tbody></table>${liens.length > 500 ? `<p class="doux petit">et ${liens.length - 500} autres : cherche pour les trouver.</p>` : ''}`
            : `<p class="doux">${q ? 'Aucun favori ne correspond.' : 'Aucun favori ici. Ajoute la page ouverte avec Ctrl+D, ou importe ceux de ton ancien navigateur.'}</p>${q ? '' : '<button class="bouton" data-importer>Importer mes favoris</button>'}`}</div>
        </div></div>`;
      const i = el.querySelector<HTMLInputElement>('[data-q]'); if (i && q) { i.focus(); i.setSelectionRange(q.length, q.length); }
    };
    el.addEventListener('input', (e) => { const t = e.target as HTMLInputElement; if (t.dataset.q !== undefined) { q = t.value.toLowerCase(); dessiner(); } });
    el.addEventListener('click', async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
      if (b.dataset.dossier !== undefined) { dossier = b.dataset.dossier; dessiner(); }
      else if (b.dataset.ouvrir) ctx.ouvrir(b.dataset.ouvrir, true);
      else if (b.dataset.supprFav) { await api.faire('supprFavori', { id: b.dataset.supprFav }); await charger(); }
      else if (b.dataset.tuile) { await api.faire('tuileFavori', { id: b.dataset.tuile }); await charger(); }
      else if (b.dataset.renommerFav) { const f = tout.find((x) => x.id === b.dataset.renommerFav); const nom = await prompt2(el, 'Nouveau nom', f?.nom ?? ''); if (nom) { await api.faire('majFavori', { id: f!.id, nom }); await charger(); } }
      else if (b.hasAttribute('data-nouveau-dossier')) { const nom = await prompt2(el, 'Nom du dossier', 'Nouveau dossier'); if (nom) { await api.faire('dossierFavori', { nom }); await charger(); } }
      else if (b.hasAttribute('data-importer')) api.faire('interne', { page: 'importer' });
    });
    let glisse = '';
    el.addEventListener('dragstart', (e) => { const tr = (e.target as HTMLElement).closest<HTMLElement>('[data-fav]'); if (tr) { glisse = tr.dataset.fav!; e.dataTransfer!.setData('text/plain', glisse); } });
    el.addEventListener('dragover', (e) => { if ((e.target as HTMLElement).closest('[data-drop-fav]') && glisse) e.preventDefault(); });
    el.addEventListener('drop', async (e) => { const d = (e.target as HTMLElement).closest<HTMLElement>('[data-drop-fav]'); if (d && glisse) { e.preventDefault(); await api.faire('majFavori', { id: glisse, dossier: d.dataset.dropFav }); glisse = ''; await charger(); } });
    charger();
  },

  historique: (el, ctx) => {
    let q = ''; let l: HistoireLigne[] = [];
    const charger = async () => { l = await api.faire('historique', { q, n: 400 }); dessiner(); };
    const dessiner = () => {
      const jours = new Map<string, HistoireLigne[]>();
      for (const h of l) { const j = new Date(h.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); if (!jours.has(j)) jours.set(j, []); jours.get(j)!.push(h); }
      el.innerHTML = `<div class="contenu">
        <div class="rangee entete-page"><h1>Historique</h1><span class="pousse"></span><input class="champ recherche-page" type="search" placeholder="Chercher dans l’historique" value="${esc(q)}" aria-label="Chercher dans l’historique" data-q>
          <button class="bouton danger" data-effacer="${Date.now() - 3600_000}">Effacer la dernière heure</button><button class="bouton danger" data-effacer="0">Tout effacer</button></div>
        <p class="sous">Les fenêtres privées ne laissent rien ici.${ctx.etat().odin?.connecte ? ' L’historique part aussi vers Odin (réglable dans Réglages → Synchro), pour que tu puisses lui demander « qu’est-ce que je regardais hier ? ».' : ''}</p>
        ${l.length ? [...jours].map(([j, hs]) => `<h2 class="jour">${esc(j)}</h2><div class="carte"><table class="tableau"><tbody>${hs.map((h) => `<tr>
          <td class="col-heure doux petit">${new Date(h.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td>
          <td class="col-ic">${iconeSite(h.url, undefined, h.titre)}</td>
          <td><button class="lien-fav" data-ouvrir="${esc(h.url)}"><b class="ellipse">${esc(h.titre || domaine(h.url))}</b><span class="doux petit ellipse">${esc(domaine(h.url))}</span></button></td></tr>`).join('')}</tbody></table></div>`).join('')
          : `<p class="doux">${q ? 'Rien ne correspond.' : 'Rien pour l’instant.'}</p>`}
      </div>`;
      const i = el.querySelector<HTMLInputElement>('[data-q]'); if (i && q) { i.focus(); i.setSelectionRange(q.length, q.length); }
    };
    let minut: any;
    el.addEventListener('input', (e) => { const t = e.target as HTMLInputElement; if (t.dataset.q !== undefined) { q = t.value; clearTimeout(minut); minut = setTimeout(charger, 150); } });
    el.addEventListener('click', async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
      if (b.dataset.ouvrir) ctx.ouvrir(b.dataset.ouvrir, true);
      else if (b.dataset.effacer !== undefined) { await api.faire('effacerHistorique', { depuis: Number(b.dataset.effacer) }); ctx.toast('Historique effacé.'); await charger(); }
    });
    charger();
  },

  telechargements: (el, ctx) => {
    const dessiner = () => {
      const l = ctx.etat().telechargements;
      el.innerHTML = `<div class="contenu"><div class="rangee entete-page"><img src="${appIcone('ullr')}" alt="" width="34" height="34"><div><h1>Téléchargements</h1><p class="sous">Chaque fichier attend à part (quarantaine) pendant qu’Asclépios l’analyse ; il n’arrive sur ton PC que s’il est sain. Aucune analyse ne garantit 100 %.</p></div></div>
        <div class="carte">${l.length ? l.map((t) => `<div class="dl">${I.telecharger()}<div class="corps-dl"><div class="nom ellipse">${esc(t.nom)}</div>
          <div class="petit doux">${t.taille ? taille(t.taille) + ' · ' : ''}${quand(t.quand)} · ${t.etat === 'sain' ? '<span class="ok">✓ Analysé · ✓ Enregistré</span>' : t.etat === 'bloque' ? '<span class="ko">Bloqué</span>' : t.etat === 'analyse' ? '<span class="encours">analyse…</span>' : t.etat === 'reception' ? '<span class="encours">réception…</span>' : ''} ${esc(t.detail)}</div>
          ${t.etat === 'sain' ? `<div class="rangee"><button class="bouton" data-ouvrir-dl="${esc(t.id)}">Ouvrir</button><button class="bouton" data-dossier-dl="${esc(t.id)}">Dossier</button></div>` : ''}</div></div>`).join('') : '<p class="doux">Aucun téléchargement pour l’instant.</p>'}</div></div>`;
    };
    dessiner();
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
      if (b.dataset.ouvrirDl) api.faire('dlOuvrir', { id: b.dataset.ouvrirDl });
      if (b.dataset.dossierDl) api.faire('dlDossier', { id: b.dataset.dossierDl });
    });
    let avant = '';
    return () => { const k = JSON.stringify(ctx.etat().telechargements); if (k !== avant) { avant = k; dessiner(); } };
  },

  reglages: (el, ctx) => {
    const NOMS: Record<Theme, string> = { noir: 'Noir', blanc: 'Blanc', bleu: 'Bleu', rouge: 'Rouge', transparent: 'Transparent', glace: 'Glace' };
    const dessiner = async () => {
      const E = ctx.etat(); const r = E.reglages;
      const mem = await api.faire('memoire').catch(() => null);
      const choix = (cle: string, val: string, opts: [string, string][]) => `<select class="champ" data-cle="${cle}">${opts.map(([v, t]) => `<option value="${v}"${v === val ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
      el.innerHTML = `<div class="contenu"><h1>Réglages</h1><p class="sous">Tout est gardé sur ce PC, chiffré${E.odin?.connecte ? ', et sur ton Odin' : ''}.</p>
        <div class="pile">
        <section class="carte"><h2>Apparence</h2>
          <div class="reglage"><div><b>Couleur du navigateur</b><div class="doux petit">Chaque espace peut garder la sienne (clic droit sur l’espace, en bas de la barre).</div></div>
            <div class="nuancier">${(Object.keys(NOMS) as Theme[]).map((t) => `<button class="nuance n-${t}" data-theme="${t}" aria-label="${NOMS[t]}" title="${NOMS[t]}" aria-pressed="${r.theme === t}"></button>`).join('')}</div></div>
          <div class="reglage"><div><b>Transparence de la vitre</b><div class="doux petit">Pour le thème « Transparent » : plus ou moins de bureau visible derrière.</div></div><input type="range" min="10" max="95" value="${r.transparence}" data-cle="transparence" aria-label="Transparence"></div>
        </section>
        <section class="carte"><h2>Onglets</h2>
          <div class="reglage"><div><b>Mettre en veille les onglets inactifs après</b><div class="doux petit">Une page en veille ne prend plus de mémoire ; elle se recharge quand tu y reviens.</div></div>${choix('veilleMinutes', String(r.veilleMinutes), [['5', '5 minutes'], ['10', '10 minutes'], ['30', '30 minutes'], ['60', '1 heure'], ['100000', 'Jamais']])}</div>
          <div class="reglage"><div><b>Ranger les onglets du jour après</b><div class="doux petit">Les onglets non épinglés vont dans la boîte en bas de la barre.</div></div>${choix('rangerHeures', String(r.rangerHeures), [['12', '12 heures'], ['24', '1 jour'], ['168', '1 semaine'], ['0', 'Jamais']])}</div>
          <div class="reglage"><div><b>Vidéo en petite fenêtre automatique</b><div class="doux petit">Quand tu quittes un onglet qui joue une vidéo, elle te suit dans un coin (4 au plus).</div></div><input type="checkbox" class="interrupteur" data-cle="videoAuto" ${r.videoAuto ? 'checked' : ''}></div>
        </section>
        <section class="carte"><h2>Recherche</h2>
          <div class="reglage"><div><b>Moteur de recherche</b><div class="doux petit">Pythie cherche sur tous les moteurs depuis ton Odin.</div></div>${choix('moteur', r.moteur, [['pythie', 'Pythie (Odin)'], ['duckduckgo', 'DuckDuckGo'], ['qwant', 'Qwant'], ['google', 'Google']])}</div>
        </section>
        <section class="carte"><h2>Protection</h2>
          <div class="reglage"><div><b>Bloqueur dans les pages</b><div class="doux petit">Pubs et pisteurs (listes du même genre que Brave). « Strict » bloque aussi les boutons des réseaux sociaux.</div></div>${choix('bloqueur', r.bloqueur, [['coupe', 'Coupé'], ['normal', 'Normal'], ['strict', 'Strict']])}</div>
          <div class="reglage"><div><b>Refuser tout seul les bandeaux de cookies</b></div><input type="checkbox" class="interrupteur" data-cle="cookiesRefus" ${r.cookiesRefus ? 'checked' : ''}></div>
          <div class="reglage"><div><b>Adresses des sites (DNS)</b><div class="doux petit">En ce moment : ${esc(E.protection.dns)}${E.protection.dnsChiffre ? ', chiffré' : ''}. Avec Odin : Sphinx. Sans Odin : ce service public chiffré.</div></div>${choix('dnsSecours', r.dnsSecours, [['https://dns.quad9.net/dns-query', 'Quad9 (Suisse)'], ['https://cloudflare-dns.com/dns-query', 'Cloudflare'], ['https://dns.adguard-dns.com/dns-query', 'AdGuard (bloque les pubs)'], ['https://dns.google/dns-query', 'Google']])}</div>
          <div class="reglage"><div><b>Envoyer les fichiers douteux à Odin pour analyse</b><div class="doux petit">Sinon, seule l’analyse sur ce PC est faite (empreintes connues d’Asclépios${E.plateforme === 'win32' ? ' et antivirus de Windows' : ''}).</div></div><input type="checkbox" class="interrupteur" data-cle="analyseOdin" ${r.analyseOdin ? 'checked' : ''}></div>
        </section>
        <section class="carte"><h2>Synchro Odin</h2>
          <div class="reglage"><div><b>${E.odin?.connecte ? `Relié à ${esc(E.odin.nom)}` : 'Pas encore relié à Odin'}</b><div class="doux petit">Favoris, onglets, espaces, agenda, réglages et historique, à la seconde, sur tous tes appareils.</div></div><button class="bouton" data-page="synchro">Ouvrir</button></div>
          <div class="reglage"><div><b>Ce qu’Odin reçoit de ta navigation</b></div>${choix('synchroHistorique', r.synchroHistorique, [['tout', 'Tout (historique compris)'], ['sans-historique', 'Tout sauf l’historique'], ['rien', 'Rien']])}</div>
        </section>
        <section class="carte"><h2>Pégase</h2>
          <div class="reglage"><div><b>Mémoire utilisée</b><div class="doux petit">${mem ? `${mem.total} Mo en tout (${mem.processus.length} processus), avec ${E.onglets.filter((o) => !o.enVeille).length} onglet(s) éveillé(s).` : '—'}</div></div><button class="bouton" data-memoire>Mesurer</button></div>
          <div class="reglage"><div><b>Mises à jour</b><div class="doux petit">Pégase se met à jour tout seul depuis les versions publiées d’Odin.</div></div><button class="bouton" data-maj>Chercher maintenant</button></div>
          <div class="reglage"><div><b>Importer</b><div class="doux petit">Favoris de Chrome, Edge, Brave, Arc et Firefox trouvés sur ce PC.</div></div><button class="bouton" data-page="importer">Importer</button></div>
        </section></div></div>`;
    };
    dessiner();
    el.addEventListener('change', async (e) => {
      const t = e.target as HTMLInputElement; const cle = t.dataset.cle; if (!cle) return;
      const v = t.type === 'checkbox' ? t.checked : (['veilleMinutes', 'rangerHeures', 'transparence'].includes(cle) ? Number(t.value) : t.value);
      await api.faire('reglage', { cle, valeur: v });
    });
    el.addEventListener('input', (e) => { const t = e.target as HTMLInputElement; if (t.dataset.cle === 'transparence') document.documentElement.style.setProperty('--vitre', String(Number(t.value) / 100)); });
    el.addEventListener('click', async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
      if (b.dataset.theme) { await api.faire('theme', { theme: b.dataset.theme }); setTimeout(dessiner, 100); }
      else if (b.dataset.page) api.faire('interne', { page: b.dataset.page });
      else if (b.hasAttribute('data-memoire')) dessiner();
      else if (b.hasAttribute('data-maj')) { ctx.toast('Recherche d’une mise à jour…'); const r = await api.faire('miseAJour'); ctx.toast(r || 'Pégase est à jour.'); }
    });
  },

  aide: (el, ctx) => {
    const m = ctx.etat().plateforme === 'darwin';
    const k = (s: string) => (m ? s.replace(/Ctrl\+/g, '⌘').replace(/Maj\+/g, '⇧') : s);
    const l: [string, string][] = [['Ctrl+T', 'Barre de commande : chercher, ouvrir une adresse, une appli d’Odin'], ['Ctrl+L', 'Changer l’adresse de la page'], ['Ctrl+W', 'Fermer l’onglet'], ['Ctrl+Maj+T', 'Rouvrir le dernier onglet fermé'], ['Ctrl+D', 'Ajouter aux favoris'], ['Ctrl+F', 'Chercher dans la page'], ['Ctrl+S', 'Masquer ou montrer la barre de côté'], ['Ctrl+Maj+D', 'Écran partagé'], ['Ctrl+1 … 9', 'Aller à l’espace 1 … 9'], ['Ctrl+Tab', 'Onglet suivant'], ['Ctrl+N', 'Nouvelle fenêtre'], ['Ctrl+Maj+N', 'Fenêtre privée'], ['Ctrl+Y', 'Historique'], ['Ctrl+J', 'Téléchargements'], ['Ctrl+,', 'Réglages'], ['Alt+←  Alt+→', 'Page précédente, suivante'], ['Ctrl+ +  Ctrl+ −  Ctrl+0', 'Zoom']];
    el.innerHTML = `<div class="contenu"><h1>Aide</h1><p class="sous">Pégase a la même structure qu’Arc : une barre de côté avec tes favoris en tuiles, tes espaces, tes onglets épinglés et ceux du jour.</p>
      <section class="carte"><h2>Raccourcis clavier</h2><table class="tableau"><tbody>${l.map(([a, b]) => `<tr><td class="col-kbd"><b>${esc(k(a))}</b></td><td>${esc(b)}</td></tr>`).join('')}</tbody></table></section></div>`;
  },
};

/** Une petite question dans la page (sans fenêtre du système). */
export function prompt2(_el: HTMLElement | null, question: string, defaut: string): Promise<string | null> {
  // window.prompt n'existe pas dans Electron : on passe par une boîte de Pégase.
  return (window as any).__pegaseDemander?.(question, defaut) ?? Promise.resolve(null);
}
