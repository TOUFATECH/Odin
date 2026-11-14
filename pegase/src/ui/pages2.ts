// Pages pegase:// : profil (et, à l'étape 5, agenda, import, synchro Odin).
import { api, esc, appIcone, type Ctx } from './commun';
import { odinVisage, reduirePhoto } from './odin-visage';
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
        <div class="profil-avatar"><span class="anneau" aria-hidden="true"></span><span class="dedans">${E.profil.photo ? `<img src="${E.profil.photo}" alt="Ta photo">` : `<span class="odin" role="img" aria-label="Odin">${odinVisage()}</span>`}</span>
          <button class="profil-couleur" data-photo aria-label="${E.profil.photo ? 'Changer la photo' : 'Mettre une photo'}">${I.crayon(15)}</button>
          <input type="file" accept="image/jpeg,image/png,image/webp" data-fichier-photo hidden></div>
        <div class="profil-nom"><h1>${esc(E.profil.nom)}</h1>
          <span class="doux">${E.odin?.connecte ? 'Compte Odin' : 'Profil de ce PC'} · espace actif ${esc(E.espaces.find((x) => x.id === E.espaceActif)?.nom ?? '')}</span>
          <div class="rangee puces"><span class="puce"><span class="pt ${E.synchro.etat === 'ok' ? 'vert' : ''}"></span>${E.synchro.etat === 'ok' ? 'Synchronisé' : E.synchro.etat === 'horsligne' ? `Hors ligne (${E.synchro.attente} en attente)` : 'Sur ce PC seulement'}</span>
          <span class="puce">Rangé chiffré sur ce PC</span></div></div>
        <div class="rangee"><button class="bouton" data-renommer-profil>Renommer</button>${E.profil.photo ? '<button class="bouton" data-retirer-photo>Retirer la photo</button>' : ''}${E.odin?.connecte ? '<button class="bouton" data-deconnexion>Se déconnecter</button>' : '<button class="bouton plein" data-synchro>Relier à Odin</button>'}</div>
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
  // Photo choisie : réduite ici, puis gardée dans le profil ; sans photo, c'est Odin qui s'affiche.
  el.addEventListener('change', async (e) => {
    const i = e.target as HTMLInputElement; if (!i.matches?.('[data-fichier-photo]') || !i.files?.[0]) return;
    try { const r = await api.faire('majProfil', { photo: await reduirePhoto(i.files[0]) }); if (r && r.ok === false) ctx.toast(r.texte); } catch { ctx.toast('Cette image ne peut pas être lue.'); }
    i.value = ''; setTimeout(dessiner, 80);
  });
  el.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
    if (b.hasAttribute('data-renommer-profil')) { const n = await prompt2(el, 'Ton nom', ctx.etat().profil.nom); if (n) { await api.faire('majProfil', { nom: n }); setTimeout(dessiner, 80); } }
    else if (b.hasAttribute('data-couleur')) { await api.faire('majProfil', { couleur: (ctx.etat().profil.couleur + 1) % 8 }); setTimeout(dessiner, 80); }
    else if (b.hasAttribute('data-photo')) el.querySelector<HTMLInputElement>('[data-fichier-photo]')?.click();
    else if (b.hasAttribute('data-retirer-photo')) { await api.faire('majProfil', { photo: '' }); setTimeout(dessiner, 80); }
    else if (b.hasAttribute('data-nouvel-espace')) { const n = await prompt2(el, 'Nom du nouvel espace', 'Travail'); if (n) { await api.faire('nouvelEspace', { nom: n }); setTimeout(dessiner, 80); } }
    else if (b.dataset.espace) api.faire('espace', { id: b.dataset.espace });
    else if (b.hasAttribute('data-synchro')) api.faire('interne', { page: 'synchro' });
    else if (b.hasAttribute('data-deconnexion')) api.faire('deconnexion');
    else if (b.dataset.ouvrirProfil) api.faire('ouvrirProfil', { id: b.dataset.ouvrirProfil });
    else if (b.hasAttribute('data-nouveau-profil')) { const n = await prompt2(el, 'Nom du nouveau profil (ex. Invité, Enfant)', ''); if (n) api.faire('nouveauProfil', { nom: n }); }
  });
};

// HTTPS d'abord et certificats : la page de Pégase à la place d'une page qui n'est pas sûre.
pagesSuite.avertissement = (el) => {
  const onglet = el.dataset.onglet;
  api.faire('avertissement', { id: onglet }).then((a: { type: string; url: string; erreur?: string } | null) => {
    if (!a) { el.innerHTML = `<div class="contenu avertissement"><h1>Rien à signaler</h1><p class="sous">Cette page n’a plus d’avertissement.</p></div>`; return; }
    let hote = a.url; try { hote = new URL(a.url).host; } catch { /* adresse brute */ }
    const cert = a.type === 'certificat';
    el.innerHTML = `<div class="contenu avertissement" role="alert">
      <div class="rangee">${I.bouclier(40)}<h1>${cert ? 'Connexion pas sûre' : 'Ce site n’est pas chiffré'}</h1></div>
      <p class="sous">${cert
        ? `Le certificat de <b>${esc(hote)}</b> n’est pas valable${a.erreur ? ` (${esc(a.erreur)})` : ''}. Quelqu’un essaie peut-être de se faire passer pour ce site : ne tape ni mot de passe ni carte bancaire.`
        : `<b>${esc(hote)}</b> ne répond pas en HTTPS. Ce que tu tapes sur ce site (mots de passe, messages) peut être lu en chemin.`}</p>
      <div class="rangee"><button class="bouton plein" data-retour>Revenir en lieu sûr</button>
        <button class="bouton" data-continuer>${cert ? 'Continuer quand même (déconseillé)' : 'Continuer sans chiffrement'}</button></div>
      <p class="doux petit">${cert ? 'Pégase ne retient pas ce choix : il te reposera la question la prochaine fois.' : 'Pégase retient ce choix pour ce site jusqu’à ce que tu le fermes.'}</p></div>`;
  }).catch(() => 0);
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
    if (b.hasAttribute('data-retour')) api.faire('avertissementSuite', { id: onglet, op: 'retour' });
    if (b.hasAttribute('data-continuer')) api.faire('avertissementSuite', { id: onglet, op: 'continuer' });
  });
};

// ————— Agenda (maquette « Agenda ») : semaine, jour, mois ; glisser-déposer ; .ics ; synchronisé avec Odin —————
type Rdv = { id: string; titre: string; debut: string; fin: string; lieu?: string; agenda?: string; rappel?: number; couleur?: string; notes?: string };
const pad2 = (n: number) => String(n).padStart(2, '0');
function isoLocal(d: Date): string {
  const o = -d.getTimezoneOffset(), sg = o >= 0 ? '+' : '-', a = Math.abs(o);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00${sg}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
}
const jourDe = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const lundi = (d: Date) => { const j = jourDe(d); j.setDate(j.getDate() - ((j.getDay() + 6) % 7)); return j; };
const COULEURS_RDV = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6'];
const H0 = 7, H1 = 22, PX = 48; // heures affichées, pixels par heure

pagesSuite.agenda = (el, ctx) => {
  let vue: 'jour' | 'semaine' | 'mois' = 'semaine'; let ref = jourDe(new Date()); let l: Rdv[] = []; let aPoser: { id: string; titre: string; duree: number }[] = [];
  const charger = async () => { l = await api.faire('agenda') ?? []; aPoser = await api.faire('aPoser') ?? []; dessiner(); };
  const couleur = (r: Rdv) => r.couleur ?? COULEURS_RDV[[...new Set(l.map((x) => x.agenda ?? 'Perso'))].indexOf(r.agenda ?? 'Perso') % COULEURS_RDV.length];
  const jours = () => { if (vue === 'jour') return [ref]; const m = lundi(ref); return Array.from({ length: 7 }, (_, i) => new Date(m.getFullYear(), m.getMonth(), m.getDate() + i)); };
  const dessiner = () => {
    const js = jours(); const auj = jourDe(new Date()).getTime();
    const titre = vue === 'mois' ? ref.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : vue === 'jour' ? ref.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : `Semaine du ${js[0].getDate()}${js[0].getMonth() !== js[6].getMonth() ? ' ' + js[0].toLocaleDateString('fr-FR', { month: 'long' }) : ''} au ${js[6].toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
    const agendas = [...new Set(l.map((x) => x.agenda ?? 'Perso'))];
    // Petit mois de côté
    const m0 = new Date(ref.getFullYear(), ref.getMonth(), 1), d0 = lundi(m0);
    const mini = Array.from({ length: 42 }, (_, i) => new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i));
    const evts = (d: Date) => l.filter((r) => { const a = new Date(r.debut.length === 10 ? `${r.debut}T00:00` : r.debut); return jourDe(a).getTime() === d.getTime(); });
    let grille = '';
    if (vue === 'mois') {
      grille = `<div class="mois-grille">${['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map((n) => `<div class="tete-jour">${n}</div>`).join('')}${mini.map((d) => `<div class="case-mois${d.getMonth() !== ref.getMonth() ? ' autre' : ''}${d.getTime() === auj ? ' auj' : ''}" data-jour="${d.getTime()}"><span class="n">${d.getDate()}</span>${evts(d).slice(0, 3).map((r) => `<button class="evt-mois" data-rdv="${esc(r.id)}" data-css="--c:${couleur(r)}">${esc(r.titre)}</button>`).join('')}</div>`).join('')}</div>`;
    } else {
      const heures = Array.from({ length: H1 - H0 }, (_, i) => H0 + i);
      grille = `<div class="semaine" data-css="--n:${js.length}"><div class="coin"></div>${js.map((d) => `<div class="tete-jour${d.getTime() === auj ? ' auj' : ''}">${d.toLocaleDateString('fr-FR', { weekday: 'short' })} <b>${d.getDate()}</b></div>`).join('')}
        <div class="heures">${heures.map((h) => `<div class="heure">${pad2(h)}:00</div>`).join('')}</div>
        ${js.map((d) => `<div class="colonne-jour" data-jour="${d.getTime()}" data-css="height:${(H1 - H0) * PX}px">${evts(d).filter((r) => r.debut.length > 10).map((r) => {
          const a = new Date(r.debut), b = new Date(r.fin); const top = Math.max(0, (a.getHours() + a.getMinutes() / 60 - H0) * PX); const h = Math.max(20, ((b.getTime() - a.getTime()) / 3600_000) * PX);
          return `<button class="evt" data-rdv="${esc(r.id)}" data-css="top:${top}px;height:${h}px;--c:${couleur(r)}"><b class="ellipse">${esc(r.titre)}</b><span class="ellipse">${pad2(a.getHours())}:${pad2(a.getMinutes())} – ${pad2(b.getHours())}:${pad2(b.getMinutes())}${r.lieu ? ` · ${esc(r.lieu)}` : ''}</span></button>`;
        }).join('')}${evts(d).filter((r) => r.debut.length === 10).map((r) => `<button class="evt journee" data-rdv="${esc(r.id)}" data-css="--c:${couleur(r)}">${esc(r.titre)}</button>`).join('')}</div>`).join('')}</div>`;
    }
    el.innerHTML = `<div class="agenda">
      <aside class="cote-agenda">
        <button class="bouton plein" data-nouveau>+ Nouveau rendez-vous</button>
        <div class="mini-mois"><div class="rangee"><b class="pousse">${esc(ref.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }))}</b></div>
          <div class="mini-grille">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x) => `<span class="doux">${x}</span>`).join('')}${mini.map((d) => `<button class="${d.getMonth() !== ref.getMonth() ? 'autre' : ''}${d.getTime() === auj ? ' auj' : ''}${js.some((x) => x.getTime() === d.getTime()) ? ' choisi' : ''}" data-aller="${d.getTime()}" aria-label="${esc(d.toLocaleDateString('fr-FR', { dateStyle: 'full' }))}">${d.getDate()}</button>`).join('')}</div></div>
        <div><div class="titre-cote">Agendas</div>${(agendas.length ? agendas : ['Perso']).map((a) => `<div class="rangee petit"><span class="pastille" data-css="background:${COULEURS_RDV[agendas.indexOf(a) % COULEURS_RDV.length] ?? COULEURS_RDV[0]}"></span><span class="pousse">${esc(a)}</span><span class="doux">${ctx.etat().odin?.connecte ? 'Odin' : 'ce PC'}</span></div>`).join('')}</div>
        <div><div class="titre-cote">À poser</div><p class="doux petit">Glisse un rendez-vous sur la semaine</p>
          ${aPoser.length ? aPoser.map((b) => `<div class="a-poser" data-poser="${esc(b.id)}"><b class="ellipse">${esc(b.titre)}</b><span class="doux petit">${b.duree} min</span><button class="ib p" data-retirer-poser="${esc(b.id)}" aria-label="Retirer">${I.fermer(11)}</button></div>`).join('') : '<p class="doux petit">Tout est posé.</p>'}
          <button class="bouton petit-bouton" data-ajouter-poser>+ À poser</button></div>
        <div class="rangee"><label class="bouton">Importer .ics<input type="file" accept=".ics,text/calendar" hidden data-ics></label><button class="bouton" data-exporter>Exporter .ics</button></div>
      </aside>
      <section class="corps-agenda">
        <div class="rangee entete-agenda"><h1 class="pousse">${esc(titre)}</h1><button class="ib p" data-pas="-1" aria-label="Avant">‹</button><button class="bouton" data-auj>Aujourd’hui</button><button class="ib p" data-pas="1" aria-label="Après">›</button>
          <div class="segments" role="group" aria-label="Vue">${(['jour', 'semaine', 'mois'] as const).map((v) => `<button data-vue="${v}" aria-pressed="${v === vue}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></div>
        ${grille}
      </section></div>`;
    // La CSP de l'interface interdit les styles écrits dans le HTML : positions et couleurs sont posées par le CSSOM.
    for (const x of el.querySelectorAll<HTMLElement>('[data-css]')) x.style.cssText = x.dataset.css!;
  };
  const editer = (r: Partial<Rdv>) => {
    const b = document.createElement('div'); b.className = 'boite-dialogue';
    const a = r.debut ? new Date(r.debut.length === 10 ? `${r.debut}T09:00` : r.debut) : new Date(), f = r.fin ? new Date(r.fin.length === 10 ? `${r.fin}T10:00` : r.fin) : new Date(a.getTime() + 3600_000);
    const date = `${a.getFullYear()}-${pad2(a.getMonth() + 1)}-${pad2(a.getDate())}`;
    b.innerHTML = `<div class="voile sombre"></div><form class="flottant pile boite-rdv" role="dialog" aria-label="Rendez-vous">
      <label>Titre<input class="champ" name="titre" value="${esc(r.titre ?? '')}" required></label>
      <div class="rangee"><label>Date<input class="champ" type="date" name="date" value="${date}" required></label><label>Début<input class="champ" type="time" name="h1" value="${pad2(a.getHours())}:${pad2(a.getMinutes())}"></label><label>Fin<input class="champ" type="time" name="h2" value="${pad2(f.getHours())}:${pad2(f.getMinutes())}"></label></div>
      <label>Lieu<input class="champ" name="lieu" value="${esc(r.lieu ?? '')}"></label>
      <div class="rangee"><label>Agenda<input class="champ" name="agenda" value="${esc(r.agenda ?? 'Perso')}"></label><label>Rappel (minutes avant)<input class="champ" type="number" min="0" name="rappel" value="${r.rappel ?? ''}"></label></div>
      <label>Notes<textarea class="champ" name="notes">${esc(r.notes ?? '')}</textarea></label>
      <p class="erreur" role="alert"></p>
      <div class="rangee">${r.id ? '<button class="bouton danger" type="button" data-suppr>Supprimer</button>' : ''}<span class="pousse"></span><button class="bouton" type="button" data-annuler>Annuler</button><button class="bouton plein" type="submit">Enregistrer</button></div></form>`;
    document.body.appendChild(b); document.dispatchEvent(new CustomEvent('pegase:zones'));
    const fm = b.querySelector('form')!; const fin = () => { b.remove(); document.dispatchEvent(new CustomEvent('pegase:zones')); };
    b.querySelector('.voile')!.addEventListener('click', fin); b.querySelector('[data-annuler]')!.addEventListener('click', fin);
    fm.addEventListener('keydown', (e) => { if (e.key === 'Escape') fin(); });
    b.querySelector('[data-suppr]')?.addEventListener('click', async () => { await api.faire('agendaSuppr', { id: r.id }); fin(); await charger(); });
    fm.addEventListener('submit', async (e) => {
      e.preventDefault(); const d = Object.fromEntries(new FormData(fm)) as Record<string, string>;
      const debut = new Date(`${d.date}T${d.h1 || '09:00'}`), finD = new Date(`${d.date}T${d.h2 || d.h1 || '10:00'}`);
      const x = await api.faire('agendaMettre', { rdv: { ...r, titre: d.titre, debut: isoLocal(debut), fin: isoLocal(finD < debut ? new Date(debut.getTime() + 3600_000) : finD), lieu: d.lieu, agenda: d.agenda, rappel: d.rappel === '' ? undefined : Number(d.rappel), notes: d.notes } });
      if (!x?.ok) { fm.querySelector('.erreur')!.textContent = x?.texte ?? 'Impossible.'; return; }
      fin(); await charger();
    });
    (fm.querySelector('[name=titre]') as HTMLInputElement).focus();
  };
  // Glisser un rendez-vous (ou un « à poser ») sur la semaine, à la souris ou au doigt : l'heure suit, par quarts d'heure.
  let glisse: { type: 'rdv' | 'poser'; id: string; dy: number; x0: number; y0: number; fantome: HTMLElement | null; source: HTMLElement } | null = null;
  let sansClic = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement; const r = t.closest<HTMLElement>('[data-rdv]:not(.journee):not(.evt-mois)'), p = t.closest<HTMLElement>('[data-poser]');
    if (t.closest('[data-retirer-poser]') || (!r && !p)) return;
    const s = (r ?? p)!;
    glisse = { type: r ? 'rdv' : 'poser', id: r ? r.dataset.rdv! : p!.dataset.poser!, dy: r ? Math.max(0, e.clientY - s.getBoundingClientRect().top) : 0, x0: e.clientX, y0: e.clientY, fantome: null, source: s };
  });
  el.addEventListener('pointermove', (e) => {
    const g = glisse; if (!g) return;
    if (!g.fantome) {
      if (Math.abs(e.clientX - g.x0) + Math.abs(e.clientY - g.y0) < 5) return;
      const b = g.source.getBoundingClientRect(); g.fantome = g.source.cloneNode(true) as HTMLElement;
      g.fantome.classList.add('fantome'); g.fantome.style.cssText = `position:fixed;left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;pointer-events:none;opacity:.8;z-index:50`;
      document.body.appendChild(g.fantome); el.setPointerCapture?.(e.pointerId);
    }
    g.fantome.style.left = `${e.clientX - 10}px`; g.fantome.style.top = `${e.clientY - g.dy}px`;
  });
  const lacher = async (e: PointerEvent) => {
    const g = glisse; glisse = null; if (!g?.fantome) return;
    g.fantome.remove(); sansClic = true; setTimeout(() => { sansClic = false; }, 50);
    const sous = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const c = sous?.closest<HTMLElement>('[data-jour]'); if (!c) return;
    const jour = new Date(Number(c.dataset.jour));
    let h = vue === 'mois' ? 9 : H0 + Math.max(0, (e.clientY - c.getBoundingClientRect().top - g.dy) / PX); h = Math.min(H1 - 0.25, Math.round(h * 4) / 4);
    const debut = new Date(jour.getFullYear(), jour.getMonth(), jour.getDate(), Math.floor(h), Math.round((h % 1) * 60));
    if (g.type === 'rdv') {
      const r = l.find((x) => x.id === g.id); if (!r || r.debut.length === 10) return;
      const duree = new Date(r.fin).getTime() - new Date(r.debut).getTime();
      await api.faire('agendaMettre', { rdv: { ...r, debut: isoLocal(debut), fin: isoLocal(new Date(debut.getTime() + duree)) } });
    } else {
      const b = aPoser.find((x) => x.id === g.id); if (!b) return;
      await api.faire('agendaMettre', { rdv: { titre: b.titre, debut: isoLocal(debut), fin: isoLocal(new Date(debut.getTime() + b.duree * 60_000)), agenda: 'Perso' } });
      await api.faire('aPoserMettre', { liste: aPoser.filter((x) => x.id !== b.id) });
    }
    await charger();
  };
  el.addEventListener('pointerup', (e) => { void lacher(e); });
  el.addEventListener('pointercancel', () => { glisse?.fantome?.remove(); glisse = null; });
  el.addEventListener('dblclick', (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.colonne-jour'); if (!c || (e.target as HTMLElement).closest('[data-rdv]')) return;
    const jour = new Date(Number(c.dataset.jour)); const h = Math.floor(H0 + (e.clientY - c.getBoundingClientRect().top) / PX);
    const debut = new Date(jour.getFullYear(), jour.getMonth(), jour.getDate(), h, 0);
    editer({ debut: isoLocal(debut), fin: isoLocal(new Date(debut.getTime() + 3600_000)) });
  });
  el.addEventListener('change', async (e) => {
    const i = e.target as HTMLInputElement; if (!i.hasAttribute('data-ics') || !i.files?.[0]) return;
    const r = await api.faire('agendaImporter', { texte: await i.files[0].text() }); ctx.toast(`${r?.n ?? 0} rendez-vous importé${(r?.n ?? 0) > 1 ? 's' : ''}.`); await charger();
  });
  el.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b || sansClic) return;
    if (b.dataset.rdv) { const r = l.find((x) => x.id === b.dataset.rdv); if (r) editer(r); }
    else if (b.hasAttribute('data-nouveau')) { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); editer({ debut: isoLocal(d), fin: isoLocal(new Date(d.getTime() + 3600_000)) }); }
    else if (b.dataset.vue) { vue = b.dataset.vue as any; dessiner(); }
    else if (b.dataset.pas) { const n = Number(b.dataset.pas); ref = vue === 'mois' ? new Date(ref.getFullYear(), ref.getMonth() + n, 1) : new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + n * (vue === 'jour' ? 1 : 7)); dessiner(); }
    else if (b.hasAttribute('data-auj')) { ref = jourDe(new Date()); dessiner(); }
    else if (b.dataset.aller) { ref = new Date(Number(b.dataset.aller)); dessiner(); }
    else if (b.hasAttribute('data-exporter')) { const ok = await api.faire('agendaExporter'); if (ok) ctx.toast('Agenda exporté (.ics).'); }
    else if (b.hasAttribute('data-ajouter-poser')) { const t = await prompt2(el, 'Rendez-vous à poser plus tard', ''); if (t) { aPoser.push({ id: `ap${Date.now()}`, titre: t, duree: 60 }); await api.faire('aPoserMettre', { liste: aPoser }); dessiner(); } }
    else if (b.dataset.retirerPoser) { await api.faire('aPoserMettre', { liste: aPoser.filter((x) => x.id !== b.dataset.retirerPoser) }); await charger(); }
  });
  void charger();
  let avant = ''; return () => { const k = `${ctx.etat().nbFavoris}|${ctx.etat().synchro.derniere ?? ''}`; if (k !== avant) { const p = !avant; avant = k; if (!p) void charger(); } };
};

// ————— Importer (maquette « Import ») : favoris de Chrome, Edge, Brave, Firefox, Arc… trouvés sur ce PC —————
pagesSuite.importer = (el, ctx) => {
  let l: { navigateur: string; id: string; nom: string; type: string; n?: number }[] = []; let coches = new Set<string>(); let etat: 'choix' | 'encours' | 'fini' = 'choix'; let res: any = null;
  const dessiner = () => {
    const navs = [...new Set(l.map((x) => x.navigateur))];
    el.innerHTML = `<div class="contenu"><div class="rangee entete-page">${I.importer(30)}<h1>Importer d’un autre navigateur</h1></div>
      ${l.length ? `<p class="sous"><b>${esc(navs.join(', ').replace(/, ([^,]*)$/, ' et $1'))} ${navs.length > 1 ? 'sont installés' : 'est installé'} sur ce PC.</b> Pégase a trouvé leurs profils. Coche ce que tu veux récupérer.</p>` : '<p class="sous">Aucun autre navigateur trouvé sur ce PC (Chrome, Edge, Brave, Vivaldi, Opera, Firefox, Arc).</p>'}
      <section class="carte">${l.map((x) => `<label class="ligne-import"><input type="checkbox" data-id="${esc(x.id)}" ${coches.has(x.id) ? 'checked' : ''} ${etat !== 'choix' ? 'disabled' : ''}><span class="ltr c${navs.indexOf(x.navigateur) % 8}" aria-hidden="true">${esc(x.navigateur[0])}</span><span class="pousse"><b>${esc(x.navigateur)}</b> · ${esc(x.nom)}</span><span class="doux petit">${x.type === 'arc' ? `${x.n ?? 0} onglets épinglés (espaces)` : `${x.n ?? 0} favoris`}</span></label>`).join('')}
        <div class="ligne-import desactive"><span class="pousse"><b>Historique</b></span><span class="puce">bientôt</span></div>
        <div class="ligne-import desactive"><span class="pousse"><b>Mots de passe</b></span><span class="doux petit">jamais sans ton accord</span></div></section>
      ${etat === 'encours' ? '<p role="status"><span class="chargement" aria-hidden="true"></span> Récupération en cours…</p>' : ''}
      ${etat === 'fini' && res ? `<p role="status" class="ok"><b>C’est fait :</b> ${res.favoris} favori${res.favoris > 1 ? 's' : ''}${res.espaces ? `, ${res.espaces} espace${res.espaces > 1 ? 's' : ''}` : ''}${res.onglets ? `, ${res.onglets} onglet${res.onglets > 1 ? 's' : ''} épinglé${res.onglets > 1 ? 's' : ''}` : ''}.${ctx.etat().odin?.connecte ? ' Ils partent aussi sur Odin.' : ''}</p>` : ''}
      <div class="rangee"><button class="bouton plein" data-tout ${!l.length || etat !== 'choix' ? 'disabled' : ''}>Tout récupérer</button><button class="bouton" data-plus-tard>${etat === 'fini' ? 'Fermer' : 'Plus tard'}</button>${etat === 'fini' ? '<button class="bouton" data-voir>Voir mes favoris</button>' : ''}</div>
      <p class="doux petit">L’historique de ces navigateurs est rangé dans un format (SQLite) que Pégase ne lit pas encore : bientôt. Les mots de passe iront dans Thésauros, seulement avec ton accord, et ne s’affichent jamais. Tout ce qui est récupéré part ensuite sur Odin avec le reste. Les espaces d’Arc deviennent des espaces de travail Pégase.</p></div>`;
  };
  api.faire('importDetecter').then((x: any[]) => { l = x ?? []; coches = new Set(l.map((y) => y.id)); dessiner(); });
  el.addEventListener('change', (e) => { const i = e.target as HTMLInputElement; if (i.dataset.id) { if (i.checked) coches.add(i.dataset.id); else coches.delete(i.dataset.id); } });
  el.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
    if (b.hasAttribute('data-tout')) { etat = 'encours'; dessiner(); res = await api.faire('importer', { ids: [...coches] }); etat = 'fini'; dessiner(); }
    else if (b.hasAttribute('data-plus-tard')) api.faire('fermer', {});
    else if (b.hasAttribute('data-voir')) api.faire('naviguer', { texte: 'pegase://favoris' });
  });
  dessiner();
};
