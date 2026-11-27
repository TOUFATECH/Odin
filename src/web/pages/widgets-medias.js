// La famille « medias » des widgets de l'accueil (maquette validée « Accueil », les cartes « Lecteur » et « Messages »).
// - « Lecteur » : ce qu'Apollon a lancé, tel qu'il le garde (« Radio · lancé il y a 4 minutes · sur cette machine »),
//   jamais « en cours » : Apollon ne sait pas si cela joue encore. Puis « Arrêter » et ses radios et ses listes, chacune
//   lancée d'un appui par l'action d'Apollon qui existe (POST /api/valhalla/act, « jouer » ; « Arrêter » : « stop »). Ni
//   barre, ni durée, ni précédent, ni suivant, ni pause : Apollon ne les connaît pas. Ni radio ni liste : la phrase calme
//   et « Ouvrir Apollon ».
// - « Messages » : ses conversations récentes, par titre, d'où elles viennent quand Odin le sait, et leur âge ; un appui
//   ouvre la Discussion. Aucun compteur de « non lus », aucun texte de message (la page ne les reçoit pas).
// Ce fichier DÉCLARE ses sortes au registre commun (pages/widgets-rendu.js) ; l'accueil les dessine et les propose sans
// rien savoir d'elles. Chaque dessin est fait de l'état que le serveur a rendu (src/valhalla/widgets/medias.ts).
// - Au propriétaire seul (le serveur décide), jamais sur l'écran de la maison. En mode « Modifier », rien ne part.
// - Un nom de radio, de liste ou de morceau, un titre de conversation viennent de dehors : posés par textContent, isolés
//   dans leur sens d'écriture, coupés à l'écran avec leur entier en info-bulle ; jamais du code.
// - La carte ne s'étire pas : autant de choix (ou de conversations) que sa hauteur RÉELLE en tient, puis « et N de plus ».
// - Aucun mouvement (rien n'est animé). Les âges dans la langue de la page (Intl).
// Rien n'est touché au chargement : seulement window.OdinWidgetsMedias (ses textes et calculs, pour les essais) et sa
// déclaration.
(() => {
  'use strict';
  if (window.OdinWidgetsMedias) return;

  // ---------------- Dictionnaire (tous les textes de la famille)
  const TEXTES = {
    lecteur: 'Lecteur', lecteurQuoi: 'Apollon : tes radios et tes listes, d\'un appui, et ce qu\'Odin vient de lancer',
    messages: 'Messages', messagesQuoi: 'Tes conversations récentes avec Odin',
    lance: (t) => `lancé ${t}`, ici: 'sur cette machine', sur: (n) => `sur ${n}`,
    sortes: { radio: 'Radio', liste: 'Liste', morceau: 'Morceau' }, morceaux: (n) => `${n} morceau(x)`,
    jouer: (n) => `Jouer ${n}`, arreter: 'Arrêter', arreterQuoi: 'Arrête la lecture sur cette machine',
    annule: 'Rien n\'est parti.', echec: 'Apollon ne répond pas.',
    plus: (n) => `et ${n} de plus`, rienAEcouter: 'Aucune radio ni liste dans Apollon.', ouvrirApollon: 'Ouvrir Apollon',
    discussion: 'Discussion', sansTitre: 'sans titre', aucune: 'Aucune conversation.', ouvrirDiscussion: 'Ouvrir la Discussion',
    origines: { principal: '', raccourci: 'depuis le téléphone', maison: 'depuis l\'écran de la maison', voix: 'depuis la voix', venus: 'depuis Vénus', cerveau: 'depuis le Cerveau', reglages: 'depuis les Réglages' },
  };
  const T = TEXTES;

  // ---------------- Calculs (sans document)
  /** « il y a 3 heures », dans la langue donnée, depuis `at` (ms) jusqu'à `maintenant` ; une heure illisible ou à venir : ''. */
  function ilYa(at, maintenant, langue) {
    const d = Number(maintenant) - Number(at);
    if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0 || !Number.isFinite(d) || d < 0) return '';
    const s = d / 1000, [v, u] = s < 60 ? [0, 'second'] : s < 3600 ? [Math.floor(s / 60), 'minute'] : s < 86400 ? [Math.floor(s / 3600), 'hour'] : [Math.floor(s / 86400), 'day'];
    try { return new Intl.RelativeTimeFormat(langue, { numeric: 'auto' }).format(-v, u); } catch { return ''; }
  }
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  /** Le titre d'une conversation, comme la Discussion le montre (sans l'étiquette entre crochets, sur une ligne). */
  function titreConv(c) {
    if (c && c.origine === 'principal') return T.discussion;
    const t = String(c && typeof c.titre === 'string' ? c.titre : '').replace(/^\[[^\]]*\]\s*/, '').replace(/\s+/g, ' ').trim();
    return t || T.sansTitre;
  }
  const nomLu = (x) => (typeof x === 'string' && x ? x : '');

  // ---------------- Dessin (seulement quand un hôte l'appelle)
  const ICONES = {
    radio: '<path d="M4 9h16v10H4zM8 9l9-5"/><circle cx="9" cy="14" r="2"/><path d="M14 13h3M14 16h3"/>',
    liste: '<path d="M4 6h11M4 11h11M4 16h7M17 10v8M17 18a2 2 0 1 1-2-2"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
    sortie: '<path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4"/>',
  };
  const icone = (k) => (own(ICONES, k) ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[k]}</svg>` : '');
  // Les couleurs : celles du thème d'Odin (--ink, --muted, --line, --accent). Aucune couleur écrite ici. Aucune animation.
  const CSS = `
:has(>.wd-corps){display:flex;flex-direction:column}
.wd-corps{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column;gap:6px;color:var(--ink,var(--text,inherit))}
.wd-defile{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column;gap:6px;overflow:auto;overscroll-behavior:contain;padding:3px;margin:-3px}
.wd-defile>*{flex:none;min-width:0}
.wd-dit,.wd-plus,.wd-calme{margin:0;font-size:12px;line-height:1.35;color:var(--muted,inherit);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wd-joue{margin:0;font-size:12px;line-height:1.35;color:var(--muted,inherit);min-width:0;overflow:hidden;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.wd-joue.wd-une{display:block;white-space:nowrap;text-overflow:ellipsis}
.wd-joue b{color:var(--ink,inherit);font-weight:650;unicode-bidi:isolate}
.wd-dit:empty,.wd-plus:empty{display:none}.wd-calme{font-size:13px;white-space:normal}
.wd-choixs{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:4px 6px;min-width:0}
.wd-choixs>li{min-width:0;max-width:100%;display:flex}
.wd-choixs>.wd-it{flex:1 1 110px;max-width:calc(100% - 50px)}.wd-choixs>.wd-it>.wd-btn{flex:1 1 auto}
.wd-choixs>li:last-child{flex:0 0 auto;margin-left:auto}.wd-choixs>li:has(>.wd-plus:empty){display:none}
.wd-btn{max-width:100%;min-height:44px;min-width:44px;padding:4px 12px;border-radius:12px;border:1px solid var(--line,currentColor);background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:600;line-height:1.25;cursor:pointer;display:inline-flex;align-items:center;gap:6px;min-width:0}
.wd-btn svg{flex:none;width:16px;height:16px;color:var(--muted,inherit)}
.wd-btn:focus-visible,.wd-conv:focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:2px}
.wd-stop{min-width:44px;justify-content:center}
.wd-btn:disabled{opacity:.6;cursor:default}
.wd-n{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;unicode-bidi:isolate;color:var(--ink,inherit)}
.wd-choixs .wd-plus{align-self:center}
.wd-convs{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;min-width:0}
.wd-conv{width:100%;min-height:44px;padding:4px 8px;border:0;border-bottom:1px solid var(--line,currentColor);border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;min-width:0}
.wd-conv .wd-n{flex:1 1 0;font-size:13px;font-weight:600}
.wd-m{flex:0 1 auto;max-width:40%;font-size:11.5px;color:var(--muted,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}
.wd-corps [hidden]{display:none!important}
.wd-bas{flex:none;display:flex;gap:6px;min-width:0}
@container (max-width:260px){.wd-m{max-width:34%}.wd-stop>span:last-child{display:none}.wd-stop{padding:4px}}`;
  function poserStyle() {
    const R = window.OdinWidgetsRendu;
    if (R && typeof R.poserStyle === 'function') R.poserStyle();
    if (document.getElementById('odinWidgetsMedias')) return;
    // Hors téléphone, la carte a la hauteur de ses lignes : son corps ne compte pas dans cette hauteur. Au téléphone, la
    // hauteur suit le contenu.
    const G = window.OdinGrille, tel = G && G.GRILLE && Number.isInteger(G.GRILLE.telephone) ? G.GRILLE.telephone : 700;
    const s = document.createElement('style'); s.id = 'odinWidgetsMedias'; s.textContent = `${CSS}\n@media (min-width:${tel + 1}px){.fe-w>.wd-corps{contain:size}}`; document.head.append(s);
  }
  function el(t, cls, texte) { const n = document.createElement(t); if (cls) n.className = cls; if (texte !== undefined) n.textContent = texte; return n; }
  /** Un texte venu de dehors : du texte, isolé dans son sens d'écriture, en entier dans l'info-bulle. */
  function dehors(t, cls, texte) { const n = el(t, cls, texte); n.dir = 'auto'; n.title = texte; return n; }
  const langue = () => { try { return document.documentElement.lang || undefined; } catch { return undefined; } };
  const nombre = (n, lg) => { try { return new Intl.NumberFormat(lg).format(n); } catch { return String(n); } };
  const decor = (k) => { const s = el('span'); s.setAttribute('aria-hidden', 'true'); s.style.display = 'inline-flex'; s.innerHTML = icone(k); return s; };
  const enModif = (n) => Boolean(n.closest('.fe-edit'));
  /** Un appel à ce qui existe sur le serveur (la session de la page) ; rend la réponse lue, ou rien. */
  async function poster(corps) {
    try {
      const r = await fetch('/api/valhalla/act', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(corps) });
      return await r.json().catch(() => ({ ok: false }));
    } catch { return undefined; }
  }
  /** Lance l'action d'Apollon ; une confirmation demandée par le serveur est montrée À CHAQUE FOIS. Rend le texte à dire. */
  async function agir(action, input) {
    const corps = { module: 'aegir', action, input };
    let r = await poster(corps);
    if (r && r.confirm) {
      const D = window.OdinDialog; let oui = false;
      try { oui = D && typeof D.confirm === 'function' ? (await D.confirm(String(r.confirm), { danger: true })) === true : false; } catch { oui = false; }
      if (!oui) return T.annule;
      r = await poster({ ...corps, confirm: true });
    }
    if (!r) return T.echec;
    const t = typeof r.text === 'string' ? r.text : typeof r.error === 'string' ? r.error : '';
    return (t.split('\n')[0] || (r.ok === false ? T.echec : '')).slice(0, 240);
  }
  /** Un bouton qui mène ailleurs dans Odin (rien en mode « Modifier », jamais sur l'écran de la maison). */
  function mener(o, texte, hash) {
    if (o && o.ecran === 'maison') return null;
    const b = el('button', 'wd-btn'); b.type = 'button';
    b.append(decor('sortie'), el('span', '', texte));
    b.addEventListener('click', (ev) => { ev.stopPropagation(); if (enModif(b)) return; location.hash = hash; });
    return b;
  }
  function calme(texte, bouton) {
    poserStyle();
    const c = el('div', 'wd-corps'), f = el('div', 'wd-defile'); f.append(el('p', 'wd-calme', texte)); c.append(f);
    if (bouton) { const bas = el('div', 'wd-bas'); bas.append(bouton); c.append(bas); }
    return c;
  }
  /** La hauteur du widget, en lignes de la grille (celle que la grille lui donne, sinon celle qui est écrite). */
  function lignesDe(w, defaut) {
    const G = window.OdinGrille;
    try { if (G && typeof G.taille === 'function') return G.taille(w).r; } catch { /* la valeur écrite */ }
    return w && Number.isInteger(w.r) ? w.r : defaut;
  }
  /**
   * Autant d'éléments que la carte en tient : hors téléphone (hauteur tenue), tout remettre puis retirer le dernier tant
   * que la zone qui défile déborde (jusqu'à `min`) ; au téléphone (la carte suit son contenu), `montre` au plus. Puis
   * « et N de plus ».
   */
  function ajusteur(c, f, liste, items, total, montre, min, plus, lg, serrer) {
    const compter = () => { const n = liste.querySelectorAll(':scope > .wd-it').length, reste = total - n; plus.textContent = reste > 0 ? T.plus(nombre(reste, lg)) : ''; };
    const remettre = (k) => { for (const it of items) it.remove(); for (const it of items.slice(0, k)) liste.insertBefore(it, plus.parentNode && plus.parentNode.parentNode === liste ? plus.parentNode : null); compter(); };
    const ajuster = () => {
      let tenue = false; try { tenue = /size/.test(getComputedStyle(c).contain || ''); } catch { /* suit le contenu */ }
      if (serrer) serrer(false);
      if (!tenue) { remettre(Math.min(items.length, montre)); return; }
      const deborde = () => f.scrollHeight > f.clientHeight + 1;
      const essayer = () => { let k = items.length; remettre(k); while (k > min && deborde()) { k--; remettre(k); } return k; };
      // Rien ne tient : on serre (serrer(true) rend vrai s'il a changé quelque chose) et on recommence.
      if (essayer() === 0 && items.length && serrer && serrer(true)) essayer();
    };
    remettre(Math.min(items.length, montre));
    if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(() => { if (!c.isConnected) { ro.disconnect(); return; } ajuster(); }); ro.observe(c); }
  }

  /** « Lecteur » : ce qui a été lancé, « Arrêter », ses radios et ses listes. Une donnée illisible : rien (null). */
  function lecteur(e, o) {
    if (e && e.etat === 'vide') return e.raison === 'rien_a_ecouter' ? calme(T.rienAEcouter, mener(o, T.ouvrirApollon, '#app=aegir')) : null;
    const d = e && e.donnee && typeof e.donnee === 'object' ? e.donnee : {};
    if (!Array.isArray(d.radios) || !Array.isArray(d.listes)) return null;
    const choix = [...d.radios.map(nomLu).filter(Boolean).map((nom) => ({ nom, sorte: 'radio' })), ...d.listes.filter((x) => x && nomLu(x.nom)).map((x) => ({ nom: x.nom, sorte: 'liste', morceaux: Number.isInteger(x.morceaux) ? x.morceaux : 0 }))];
    const j = d.joue && typeof d.joue === 'object' && nomLu(d.joue.quoi) ? d.joue : null;
    if (!choix.length && !j) return null; // illisible : rien d'affirmé
    poserStyle();
    const lg = langue(), maison = o && o.ecran === 'maison', peutJouer = d.jouer === true && !maison, peutArreter = d.arreter === true && !maison;
    const c = el('div', 'wd-corps'), f = el('div', 'wd-defile');
    // Ce qui a été lancé : le nom, quand, où. Jamais « en cours ».
    const joue = el('p', 'wd-joue');
    if (j) {
      const quand = ilYa(j.depuis, Date.now(), lg), ou = nomLu(j.enceinte) ? T.sur(j.enceinte) : T.ici, sorte = own(T.sortes, j.sorte) ? T.sortes[j.sorte] : '';
      const fin = [quand ? T.lance(quand) : '', ou].filter(Boolean).join(' · ');
      const b = dehors('b', '', j.quoi); joue.append(...(sorte ? [`${sorte} `] : []), b, fin ? ` · ${fin}` : '');
      joue.title = `${sorte ? `${sorte} ` : ''}${j.quoi}${fin ? ` · ${fin}` : ''}`;
    } else joue.hidden = true;
    const dit = el('p', 'wd-dit'); dit.setAttribute('role', 'status');
    f.append(joue, dit);
    const liste = el('ul', 'wd-choixs'), boutons = [];
    const lancer = (b, a) => {
      b.addEventListener('click', async (ev) => {
        ev.stopPropagation(); if (enModif(b)) return; // en mode « Modifier » : rien ne part
        for (const x of boutons) x.disabled = true;
        try { const t = await agir(a.action, a.input); dit.textContent = t; joue.hidden = Boolean(t) || !j; } finally { for (const x of boutons) x.disabled = false; }
      });
    };
    if (peutArreter) {
      const li = el('li'), b = el('button', 'wd-btn wd-stop'); b.type = 'button'; b.title = T.arreterQuoi; b.setAttribute('aria-label', T.arreter);
      b.append(decor('stop'), el('span', '', T.arreter)); lancer(b, { action: 'stop', input: {} }); boutons.push(b); li.append(b); liste.append(li);
    }
    const items = choix.map((x) => {
      const li = el('li', 'wd-it');
      const n = dehors('span', 'wd-n', x.nom);
      if (peutJouer) {
        const b = el('button', 'wd-btn wd-choix'); b.type = 'button'; b.setAttribute('aria-label', T.jouer(x.nom));
        b.title = x.sorte === 'liste' ? `${x.nom} · ${T.morceaux(nombre(x.morceaux, lg))}` : x.nom;
        b.append(decor(x.sorte), n); lancer(b, { action: 'jouer', input: { quoi: x.nom } }); boutons.push(b); li.append(b);
      } else { const s = el('span', 'wd-btn wd-choix'); s.append(decor(x.sorte), n); li.append(s); }
      return li;
    });
    const plusLi = el('li'), plus = el('p', 'wd-plus'); plusLi.append(plus); liste.append(plusLi);
    f.append(liste); c.append(f);
    // Ce qui a été lancé tient sur deux lignes ; dans une petite carte où aucune radio ne tiendrait plus, sur une seule
    // (coupée, entière dans l'info-bulle) : une radio à lancer passe d'abord.
    const serrer = (oui) => { if (joue.hidden || joue.classList.contains('wd-une') === oui) return false; joue.classList.toggle('wd-une', oui); return true; };
    ajusteur(c, f, liste, items, choix.length, Math.max(2, lignesDe(o && o.w, 2) * 2), 0, plus, lg, serrer);
    return c;
  }

  /** « Messages » : ses conversations récentes ; un appui ouvre la Discussion. Une donnée illisible : rien (null). */
  function messages(e, o) {
    if (e && e.etat === 'vide') return e.raison === 'aucune_conversation' ? calme(T.aucune, mener(o, T.ouvrirDiscussion, '#chat')) : null;
    const d = e && e.donnee && typeof e.donnee === 'object' ? e.donnee : {};
    const convs = (Array.isArray(d.conversations) ? d.conversations : []).filter((x) => x && typeof x === 'object' && typeof x.titre === 'string');
    if (!convs.length) return null;
    poserStyle();
    const lg = langue(), maint = Date.now(), maison = o && o.ecran === 'maison';
    const c = el('div', 'wd-corps'), f = el('div', 'wd-defile'), liste = el('ul', 'wd-convs');
    const items = convs.map((x) => {
      const li = el('li', 'wd-it'), t = titreConv(x), b = el(maison ? 'div' : 'button', 'wd-conv');
      const meta = [own(T.origines, x.origine) ? T.origines[x.origine] : '', ilYa(x.at, maint, lg)].filter(Boolean).join(' · ');
      b.append(dehors('span', 'wd-n', t)); if (meta) b.append(el('small', 'wd-m', meta));
      if (!maison) {
        b.type = 'button'; b.title = meta ? `${t} · ${meta}` : t;
        b.addEventListener('click', (ev) => { ev.stopPropagation(); if (enModif(b)) return; location.hash = '#chat'; });
      }
      li.append(b); return li;
    });
    const plusLi = el('li'), plus = el('p', 'wd-plus'); plusLi.append(plus); liste.append(plusLi);
    f.append(liste); c.append(f);
    const total = Number.isInteger(d.total) && d.total >= convs.length ? d.total : convs.length;
    ajusteur(c, f, liste, items, total, Math.max(1, lignesDe(o && o.w, 2)), 1, plus, lg);
    return c;
  }

  window.OdinWidgetsMedias = { TEXTES, CSS, ilYa, titreConv, lecteur, messages };
  // La déclaration de la famille (lue par pages/widgets-rendu.js, quel que soit l'ordre de chargement). Les tailles sont
  // celles de la maquette : 4 × 2. Au propriétaire seul, jamais sur l'écran de la maison (la même marque que leurs sortes,
  // medias.ts). « Lecteur » est rangé avec la famille d'Apollon ; « Messages » avec Odin, comme la maquette.
  (window.OdinWidgetsFamilles = window.OdinWidgetsFamilles || []).push({ famille: 'medias', sortes: [
    { sorte: 'lecteur', appli: 'aegir', proprio: true, jamaisALaMaison: true, titre: T.lecteur, quoi: T.lecteurQuoi, symbole: '♫', poser: { c: 4, r: 2, pc: 4 }, vides: ['rien_a_ecouter'], dessiner: lecteur },
    { sorte: 'messages', groupe: 'odin', proprio: true, jamaisALaMaison: true, titre: T.messages, quoi: T.messagesQuoi, symbole: '✉', poser: { c: 4, r: 2, pc: 4 }, vides: ['aucune_conversation'], dessiner: messages },
  ] });
})();
