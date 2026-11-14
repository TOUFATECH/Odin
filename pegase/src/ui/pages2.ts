// Pages pegase:// : profil (et, à l'étape 5, agenda, import, synchro Odin).
import { api, esc, appIcone, type Ctx } from './commun';
import { I } from './icones';
import { prompt2 } from './pages';

type Page = (el: HTMLElement, ctx: Ctx) => void | (() => void);
export const pagesSuite: Record<string, Page> = {};

pagesSuite.profil = (el, ctx) => {
  const dessiner = async () => {
    const E = ctx.etat();
    const s = await api.faire('statsProfil').catch(() => null) ?? { heures: 0, bloques: 0, profils: [] };
    const espaces = E.espaces.map((e) => ({ e, n: E.onglets.filter((o) => o.espace === e.id).length, b: E.bureaux.filter((b) => b.espace === e.id).length }));
    el.innerHTML = `<div class="contenu pile-large">
      <section class="profil-tete">
        <div class="profil-avatar"><span class="anneau" aria-hidden="true"></span><span class="lettre">${esc(E.profil.lettre)}</span>
          <button class="profil-couleur" data-couleur aria-label="Changer la couleur">${I.crayon(15)}</button></div>
        <div class="profil-nom"><h1>${esc(E.profil.nom)}</h1>
          <span class="doux">${E.odin?.connecte ? 'Compte Odin' : 'Profil de ce PC'} · espace actif ${esc(E.espaces.find((x) => x.id === E.espaceActif)?.nom ?? '')}</span>
          <div class="rangee puces"><span class="puce"><span class="pt ${E.synchro.etat === 'ok' ? 'vert' : ''}"></span>${E.synchro.etat === 'ok' ? 'Synchronisé' : E.synchro.etat === 'horsligne' ? `Hors ligne (${E.synchro.attente} en attente)` : 'Sur ce PC seulement'}</span>
          <span class="puce">Rangé chiffré sur ce PC</span></div></div>
        <div class="rangee"><button class="bouton" data-renommer-profil>Renommer</button>${E.odin?.connecte ? '<button class="bouton" data-deconnexion>Se déconnecter</button>' : '<button class="bouton plein" data-synchro>Relier à Odin</button>'}</div>
      </section>
      <div class="cartes">
        <div class="carte chiffre"><img src="${appIcone('vidarr')}" alt="" width="40" height="40"><div><b>${s.bloques.toLocaleString('fr-FR')}</b><span>pubs et pisteurs bloqués</span><small class="doux">depuis l’ouverture de Pégase</small></div></div>
        <div class="carte chiffre"><img src="${appIcone('frigg')}" alt="" width="40" height="40"><div><b>${s.heures.toLocaleString('fr-FR')} h</b><span>de navigation</span><small class="doux">ces 30 derniers jours</small></div></div>
        <div class="carte chiffre"><img src="${appIcone('skidbladnir')}" alt="" width="40" height="40"><div><b>${E.onglets.length}</b><span>onglets ouverts</span><small class="doux">${E.onglets.filter((o) => o.enVeille).length} en veille</small></div></div>
        <div class="carte chiffre"><img src="${appIcone('brisingamen')}" alt="" width="40" height="40"><div><b>${E.nbFavoris}</b><span>favoris</span><small class="doux">${E.tuiles.length} en tuiles</small></div></div>
      </div>
      <div class="deux-colonnes">
        <section class="carte"><div class="rangee"><h2 class="pousse">Espaces de travail</h2><button class="bouton" data-nouvel-espace>+ Nouvel espace</button></div>
          <div class="espaces-profil">${espaces.map(({ e, n, b }) => `<button class="carte-espace" data-espace="${esc(e.id)}"><span class="ltr grand c${e.couleur % 8}"></span><b>${esc(e.nom)}</b><span class="doux petit">${n} onglet${n > 1 ? 's' : ''}${b ? ` · ${b} bureau${b > 1 ? 'x' : ''}` : ''}</span></button>`).join('')}</div></section>
        <section class="carte"><h2>Protection</h2>
          <div class="pile">${[['ullr', 'Analyse des téléchargements', 'Asclépios : quarantaine et analyse avant enregistrement'], ['vidarr', 'Adresses des sites', `${E.protection.dns}${E.protection.dnsChiffre ? ', chiffré' : ''}`], ['vidarr', 'Bloqueur dans les pages', `niveau ${E.reglages.bloqueur === 'coupe' ? 'coupé' : E.reglages.bloqueur}, ${E.protection.filtres.toLocaleString('fr-FR')} règles`], ['brisingamen', 'Mots de passe', 'Thésauros, bientôt']].map(([ic, a, b]) => `<div class="rangee"><img src="${appIcone(ic)}" alt="" width="30" height="30"><div><b>${esc(a)}</b><div class="doux petit">${esc(b)}</div></div></div>`).join('')}</div></section>
        <section class="carte"><h2>Profils sur ce PC</h2>
          <div class="pile">${s.profils.map((p: any) => `<div class="rangee"><span class="ltr grand c${p.couleur % 8}">${esc(p.lettre)}</span><b class="pousse">${esc(p.nom)}</b>${p.actif ? '<span class="doux petit">ouvert</span>' : `<button class="bouton" data-ouvrir-profil="${esc(p.id)}">Ouvrir</button>`}</div>`).join('')}
          <button class="bouton" data-nouveau-profil>+ Ajouter un profil</button>
          <p class="doux petit">Chaque profil a ses favoris, ses espaces, ses cookies et son historique, chiffrés à part.</p></div></section>
      </div></div>`;
  };
  dessiner();
  el.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
    if (b.hasAttribute('data-renommer-profil')) { const n = await prompt2(el, 'Ton nom', ctx.etat().profil.nom); if (n) { await api.faire('majProfil', { nom: n }); setTimeout(dessiner, 80); } }
    else if (b.hasAttribute('data-couleur')) { await api.faire('majProfil', { couleur: (ctx.etat().profil.couleur + 1) % 8 }); setTimeout(dessiner, 80); }
    else if (b.hasAttribute('data-nouvel-espace')) { const n = await prompt2(el, 'Nom du nouvel espace', 'Travail'); if (n) { await api.faire('nouvelEspace', { nom: n }); setTimeout(dessiner, 80); } }
    else if (b.dataset.espace) api.faire('espace', { id: b.dataset.espace });
    else if (b.hasAttribute('data-synchro')) api.faire('interne', { page: 'synchro' });
    else if (b.hasAttribute('data-deconnexion')) api.faire('deconnexion');
    else if (b.dataset.ouvrirProfil) api.faire('ouvrirProfil', { id: b.dataset.ouvrirProfil });
    else if (b.hasAttribute('data-nouveau-profil')) { const n = await prompt2(el, 'Nom du nouveau profil (ex. Invité, Enfant)', ''); if (n) api.faire('nouveauProfil', { nom: n }); }
  });
};
