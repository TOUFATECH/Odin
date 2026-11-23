// Genèse · onglet « Systèmes » (maquette validée « Genèse · Systèmes », lot S1) : la bibliothèque des systèmes
// téléchargés, la même que pour la clé USB, le démarrage par le réseau et les machines virtuelles.
//   - quatre chiffres : prêts à déployer, en cours (téléchargement, vérification), place du dossier des ISO, mises à jour ;
//   - filtres (Tout, Windows, Linux, Outils, Serveurs) et recherche ;
//   - une carte par système, avec son état VRAI (action en lecture « systemes » de Genèse, qui réunit la bibliothèque
//     d'Hydre et les téléchargements d'Andromède) : empreinte et antivirus, téléchargement avec sa progression,
//     vérification en cours, empreinte fausse (fichier jeté), mise à jour disponible ;
//   - « Déployer » : sur une clé USB (ouvre l'onglet « Clé USB », ce système déjà choisi pour l'étape 3) ; par le réseau
//     et en machine virtuelle arrivent plus tard (montrés « bientôt », jamais inventés).
// Ce que l'appli sait déjà faire reste joignable : « Détail » (la fiche d'Hydre), « Arrêter » un téléchargement,
// « Mettre à jour » et « Retélécharger » (Andromède), « Ajouter un système » (Andromède).
// Pas de fin de support : la bibliothèque ne la connaît pas encore (rien n'est inventé).
// Tous les textes sont dans MOTS ; tailles et nombres selon la langue de la page (Intl). TOUT passe par OdinDialog.
// Expose window.OdinGeneseSystemes = { onglets, dessiner(root, onglet, hote), MOTS, logique, etat }.
(() => {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;

  // ---------------------------------------------------------------- les mots
  const MOTS = {
    onglet: 'Systèmes',
    titre: 'Ma bibliothèque',
    lead: 'Les systèmes qu\'Odin a téléchargés : la même bibliothèque pour la clé USB, le démarrage par le réseau et les machines virtuelles.',
    'k.prets.one': 'système prêt à déployer', 'k.prets.other': 'systèmes prêts à déployer',
    'k.cours': 'en cours', 'k.cours.de': 'en cours · {nom} {pct}', 'k.cours.verif': 'en cours · {nom} en vérification',
    'k.place': 'sur {total} · dossier des ISO', 'k.place.seul': 'dossier des ISO',
    'k.majs.one': 'mise à jour disponible', 'k.majs.other': 'mises à jour disponibles',
    'f.groupe': 'Filtrer les systèmes', 'f.tout': 'Tout', 'f.windows': 'Windows', 'f.linux': 'Linux', 'f.outil': 'Outils', 'f.serveur': 'Serveurs',
    q: 'Chercher dans la bibliothèque…', 'q.nom': 'Chercher un système',
    ajouter: 'Ajouter un système',
    'fam.windows': 'Windows', 'fam.linux': 'Linux', 'fam.outil': 'Outil', 'fam.serveur': 'Serveur', 'fam.autre': 'Autre',
    'e.editeur': 'Empreinte vérifiée', 'e.calculee': 'Empreinte notée', 'e.changee': 'Empreinte changée',
    'e.editeur.aide': 'Identique à l\'empreinte publiée par l\'éditeur.', 'e.calculee.aide': 'L\'éditeur ne publie pas d\'empreinte : Odin a noté celle du fichier.', 'e.changee.aide': 'Le fichier ne correspond plus à son empreinte : retélécharge-le.',
    'a.propre': 'Antivirus : propre', 'a.a_verifier': 'Antivirus : à vérifier', 'a.bloque': 'Antivirus : bloqué',
    maj: '{version} disponible',
    'dl.ligne': '{pct} · {recu} sur {total}', 'dl.ligne.sans': '{recu} reçus', 'dl.vitesse': '{v}/s', 'dl.reste': 'reste {t}',
    'dl.nom': 'Téléchargement de {nom}',
    verif: 'Téléchargé · empreinte et antivirus en cours…',
    faux: 'Empreinte fausse : fichier jeté',
    'faux.texte': 'Le fichier reçu n\'est pas celui que l\'éditeur publie. Rien n\'a été gardé.',
    bloque: 'L\'antivirus l\'a bloqué : il n\'est jamais proposé.',
    deployer: 'Déployer', 'deployer.nom': 'Déployer {nom}',
    'deployer.vers': 'Vers quoi ?', 'deployer.cle': 'Sur une clé USB', 'deployer.cle.texte': 'Ouvre la clé USB avec ce système déjà choisi.',
    'deployer.reseau': 'Par le réseau', 'deployer.vm': 'En machine virtuelle', bientot: 'bientôt',
    'deployer.fermer': 'Fermer',
    'raison.verification': 'Déployable une fois l\'empreinte et l\'antivirus passés.',
    'raison.inconnu': 'Odin ne sait pas encore démarrer cette image.',
    'raison.bloque': 'Bloqué par l\'antivirus.',
    'raison.absent': 'Pas encore dans la bibliothèque.',
    detail: 'Détail', 'detail.nom': 'Détail de {nom}',
    'maj.bouton': 'Mettre à jour', 'maj.nom': 'Mettre à jour {nom}',
    'maj.confirme': 'Télécharger {nom} {version} depuis le site officiel ? L\'ancienne version ira dans « old ».',
    retel: 'Retélécharger', 'retel.confirme': 'Retélécharger {nom} depuis le site officiel ?',
    arreter: 'Arrêter', 'arreter.nom': 'Arrêter le téléchargement de {nom}',
    'arreter.confirme': 'Arrêter le téléchargement de {nom} ? Le fichier entamé reprendra au prochain téléchargement.',
    lance: 'C\'est parti : Andromède télécharge {nom}.',
    reponse: 'Andromède, pour {nom} : {texte}',
    'faux.detail': '{nom} : le fichier reçu ne correspondait pas à l\'empreinte publiée par l\'éditeur. Il a été jeté le {le}.{pourquoi}',
    charge: 'Lecture de la bibliothèque…',
    vide: 'Aucun système pour l\'instant. Ajoute-en un depuis Andromède : il apparaît ici une fois téléchargé et vérifié.',
    'vide.filtre': 'Aucun système ne correspond.',
    'pas.biblio': 'La bibliothèque d\'Hydre ne répond pas : les systèmes ne peuvent pas être lus pour l\'instant.',
    erreur: 'Les systèmes ne peuvent pas être lus : {raison}',
    annule: 'Annulé.',
    'u.to': '{n} To', 'u.go': '{n} Go', 'u.mo': '{n} Mo', 'u.min': '{n} min', 'u.h': '{h} h {m}',
  };
  const mot = (k, v) => String(MOTS[k] ?? k).replace(/\{(\w+)\}/g, (_m, x) => (v && v[x] != null ? String(v[x]) : ''));
  const langue = () => (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || 'fr';
  const pluriel = (n, base) => { let r = 'other'; try { r = new Intl.PluralRules(langue()).select(n); } catch { r = n > 1 ? 'other' : 'one'; } return mot(`${base}.${r === 'one' ? 'one' : 'other'}`); };
  const nombre = (n, d = 0, min = d) => { try { return new Intl.NumberFormat(langue(), { maximumFractionDigits: d, minimumFractionDigits: min }).format(n); } catch { return String(n); } };
  const GIO = 1024 ** 3;
  /** « 5,8 Go », « 1 To », « 640 Mo ». Pur. */
  const taille = (o) => { const n = Math.max(0, Number(o) || 0); if (n >= 1024 * GIO) return mot('u.to', { n: nombre(n / (1024 * GIO), n >= 10 * 1024 * GIO ? 0 : 1, 0) }); if (n >= GIO) return mot('u.go', { n: nombre(n / GIO, 1) }); return mot('u.mo', { n: nombre(Math.round(n / 1024 ** 2)) }); };
  const pct = (p) => { try { return new Intl.NumberFormat(langue(), { style: 'percent', maximumFractionDigits: 0 }).format(p / 100); } catch { return `${p} %`; } };
  const duree = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? mot('u.min', { n: nombre(m) }) : mot('u.h', { h: nombre(Math.floor(m / 60)), m: String(m % 60).padStart(2, '0') }); };

  // ---------------------------------------------------------------- la logique (pure)
  const FILTRES = ['tout', 'windows', 'linux', 'outil', 'serveur'];
  const COULEURS = [[/windows/, '#2f6fe0'], [/ubuntu/, '#e95420'], [/debian/, '#a80030'], [/fedora/, '#3c6eb4'], [/mint/, '#4f8f2f'], [/proxmox/, '#c25f00'], [/rocky/, '#0f7a55'], [/alma/, '#0f4266'], [/truenas/, '#0072a6'], [/arch/, '#1572a6'], [/alpine/, '#0d597f'], [/memtest/, '#6d3fd6'], [/clonezilla/, '#8a6d3b'], [/gparted/, '#5b6470'], [/kali/, '#2f62c9']];
  const couleur = (c) => (COULEURS.find(([re]) => re.test(String(c.nom).toLowerCase())) || [0, c.famille === 'outil' ? '#5b6470' : '#4b5bc6'])[1];
  const sansAccents = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  /** Le filtre et la recherche (sans accents ni majuscules, sur le nom, la version et le fichier). Pur. */
  function filtrer(cartes, filtre, q) {
    const t = sansAccents(q).trim();
    return (Array.isArray(cartes) ? cartes : []).filter((c) => (filtre === 'tout' || !FILTRES.includes(filtre) || c.famille === filtre) && (!t || sansAccents(`${c.nom} ${c.version ?? ''} ${c.fichier ?? ''}`).includes(t)));
  }
  /** La vitesse d'un téléchargement entre deux lectures (octets/s) et le temps restant. Pur. */
  function vitesse(avant, maintenant) {
    if (!avant || !maintenant || maintenant.t <= avant.t || maintenant.recu < avant.recu) return undefined;
    const v = (maintenant.recu - avant.recu) / ((maintenant.t - avant.t) / 1000);
    if (!(v > 0)) return undefined;
    return { v, ...(maintenant.total ? { resteMs: ((maintenant.total - maintenant.recu) / v) * 1000 } : {}) };
  }
  const nomComplet = (c) => (c.version ? `${c.nom} ${c.version}` : c.nom);
  const logique = { MOTS, mot, FILTRES, filtrer, vitesse, taille, nomComplet, couleur };

  // ---------------------------------------------------------------- l'état (gardé quand on change d'onglet)
  const Z = { filtre: 'tout', q: '', data: null, erreur: '', vers: '', debits: {}, msg: '' };

  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(typeof c === 'object' ? c : document.createTextNode(String(c)));
    return n;
  };
  const P = {
    check: 'M5 12l5 5L20 7', warn: 'M12 3 2 20h20zM12 10v4M12 17h.01', bolt: 'M13 2 4 14h7l-1 8 9-12h-7z', x: 'M6 6l12 12M18 6 6 18',
    refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7', plus: 'M12 5v14M5 12h14', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
    usb: 'M9 2h6v6H9zM7 8h10v9a5 5 0 0 1-10 0z', net: 'M12 3v6M5 21v-4h14v4M12 9v8M4 9h16', vm: 'M3 4h18v12H3zM8 20h8M12 16v4',
  };
  const ic = (n, s = 16, w = 2) => { const v = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); v.setAttribute('viewBox', '0 0 24 24'); v.setAttribute('width', s); v.setAttribute('height', s); v.setAttribute('aria-hidden', 'true'); v.innerHTML = `<path d="${P[n]}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`; return v; };

  const CSS = `
.sy{display:flex;flex-direction:column;gap:14px;min-width:0}
.sy-k{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}@media (max-width:900px){.sy-k{grid-template-columns:repeat(2,minmax(0,1fr))}}
.sy-k>div{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:14px 16px;min-width:0;box-shadow:var(--shadow,none)}
.sy-k b{display:block;font-size:22px;letter-spacing:-.3px;line-height:1.2}.sy-k span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;overflow-wrap:anywhere}
.sy-k .ok b{color:var(--good,#1f9d55)}.sy-k .maj b{color:var(--warn,#b45309)}
.sy-bar{height:6px;border-radius:4px;background:color-mix(in srgb,var(--ink) 10%,transparent);overflow:hidden;margin-top:10px}.sy-bar i{display:block;height:100%;border-radius:4px;background:var(--accent,#0b7f7c)}
.sy-bar.raye i{background:repeating-linear-gradient(-45deg,var(--accent,#0b7f7c) 0 8px,color-mix(in srgb,var(--accent,#0b7f7c) 55%,transparent) 8px 16px)}
.sy-card{background:var(--panel);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow,none);padding:18px;min-width:0}
.sy-card>h4{margin:0 0 4px;font-size:17px;letter-spacing:-.01em}.sy-lead{margin:0 0 14px;color:var(--muted);font-size:13px;line-height:1.45}
.sy-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.sy-chips{display:flex;gap:6px;flex-wrap:wrap}@media (max-width:600px){.sy-chips{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;max-width:100%;padding:2px;margin:-2px}.sy-chips::-webkit-scrollbar{display:none}.sy-chips button{flex:none}}
.sy-chip{min-height:44px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--panel);font:600 13px inherit;color:var(--muted);cursor:pointer}
.sy-chip[aria-pressed=true]{background:color-mix(in srgb,var(--accent,#0b7f7c) 14%,var(--panel));color:var(--ink);border-color:var(--accent,#0b7f7c)}
.sy-q{flex:1;min-width:200px;min-height:44px;border-radius:12px;border:1px solid var(--line);background:var(--field,var(--panel));color:var(--ink);padding:0 14px;font:inherit;font-size:14px}
@media (max-width:600px){.sy-q{flex-basis:100%;min-width:0}}
.sy-btn{min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:600 13.5px inherit;display:inline-flex;align-items:center;justify-content:center;gap:7px;cursor:pointer;white-space:nowrap}
.sy-btn svg{flex:none}.sy-btn.pri{background:var(--accent,#0b7f7c);color:var(--on-accent,#fff);border-color:transparent}.sy-btn:disabled{opacity:.5;cursor:not-allowed}
.sy-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,290px),1fr));gap:12px}
.sy-sys{border:1.5px solid var(--line);background:var(--panel);border-radius:16px;padding:12px;display:flex;flex-direction:column;gap:10px;min-width:0}
.sy-sys .top{display:flex;gap:10px;align-items:center;min-width:0}
.sy-mono{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:17px;flex:none;position:relative;overflow:hidden}
.sy-mono::after{content:"";position:absolute;inset:auto -30% -50% auto;width:70%;height:70%;border-radius:50%;background:rgba(255,255,255,.22)}
.sy-sys .nm{min-width:0;flex:1}.sy-sys .nm b{display:block;font-size:14.5px;overflow-wrap:anywhere}.sy-sys .nm small{color:var(--muted);font-size:12px}
.sy-st{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12.5px;color:var(--muted)}.sy-st b{color:var(--ink)}
.sy-tag{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:999px;background:color-mix(in srgb,var(--ink) 8%,transparent);color:var(--ink)}
.sy-tag.ok{background:color-mix(in srgb,var(--good,#1f9d55) 16%,transparent);color:color-mix(in srgb,var(--good,#1f9d55) 80%,var(--ink))}
.sy-tag.warn{background:color-mix(in srgb,var(--warn,#d97706) 18%,transparent);color:color-mix(in srgb,var(--warn,#d97706) 70%,var(--ink))}
.sy-tag.bad{background:color-mix(in srgb,var(--bad,#e5484d) 14%,transparent);color:color-mix(in srgb,var(--bad,#e5484d) 80%,var(--ink))}
.sy-about{margin:0;font-size:12.5px;color:var(--muted);line-height:1.4}
.sy-acts{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:8px;margin-top:auto}
.sy-vers{display:flex;flex-direction:column;gap:6px;border:1px dashed var(--line);border-radius:12px;padding:8px}
.sy-vers>b{font-size:12.5px;color:var(--muted)}.sy-vers .sy-btn{justify-content:flex-start}
.sy-vers .sy-btn small{margin-left:auto;font-weight:600;color:var(--muted)}
.sy-msg{margin:0;font-size:13px;color:var(--muted)}
@media (prefers-reduced-motion:no-preference){.sy-bar.raye i{animation:syRaye 1s linear infinite;background-size:22.6px 22.6px}}
@keyframes syRaye{to{background-position:22.6px 0}}
`;

  // ---------------------------------------------------------------- les demandes
  const postModule = async (module, action, input = {}, confirm = false) => (await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module, action, input, confirm }) })).json();
  const dire = async (t) => { if (t && W.OdinDialog) await W.OdinDialog.alert(t); };

  /** Déployer sur une clé USB : ce système choisi pour l'étape 3 (par la même porte que le clic sur sa carte), puis l'onglet « Clé USB ». */
  function deployerSurCle(c, hote) {
    const SYS = W.OdinGeneseCleSystemes, ET = W.OdinGeneseCleEtapes;
    if (SYS && SYS.etat && c.iso) {
      const E = SYS.etat, L = SYS.logique || {}, id = `iso:${c.iso}`, deja = (E.choisis || {})[id];
      // La bibliothèque de la clé (lue une fois) ne connaît pas encore ce système (téléchargé depuis) : elle sera relue.
      const liste = E.biblio && Array.isArray(E.biblio.liste) && typeof L.entrees === 'function' ? L.entrees(E.biblio.liste, [], false) : [];
      const e = liste.find((x) => x.id === id);
      if (!e && E.biblio && E.biblio.etat !== 'charge') E.biblio = { ...E.biblio, etat: 'rien' };
      // Déjà choisi (peut-être réglé à la main) : gardé tel quel. Sinon le choix de départ de la façon, comme un clic sur sa carte.
      if (!deja) E.choisis = { ...(E.choisis || {}), [id]: { choix: e && typeof L.defautPour === 'function' ? L.defautPour(E.facon, e) : 'iso', main: false } };
    }
    if (ET && ET.etat) {
      ET.etat.onglet = 'deployer';
      // Une clé déjà choisie : droit à l'étape 3. Sinon l'étape 1 (choisir la clé) ; le système attend à l'étape 3.
      if (ET.etat.cle) ET.etat.etape = 3;
    }
    Z.vers = '';
    if (hote && typeof hote.aller === 'function') hote.aller('cle');
  }

  // ---------------------------------------------------------------- dessins
  function chiffres(d) {
    const c = d.chiffres || {}, p = d.place || {};
    const prem = c.premier;
    const cours = prem ? (prem.pct != null ? mot('k.cours.de', { nom: prem.nom, pct: pct(prem.pct) }) : mot('k.cours.verif', { nom: prem.nom })) : mot('k.cours');
    const occ = p.total ? Math.min(100, (p.utilise / p.total) * 100) : 0;
    return el('div', { class: 'sy-k', 'data-f': 'chiffres' },
      el('div', { class: 'ok' }, el('b', { 'data-k': 'prets' }, nombre(c.prets || 0)), el('span', {}, pluriel(c.prets || 0, 'k.prets'))),
      el('div', {}, el('b', { 'data-k': 'cours' }, nombre(c.enCours || 0)), el('span', {}, cours), prem && prem.pct != null ? el('div', { class: 'sy-bar', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.max(2, prem.pct)}%` })) : null),
      el('div', {}, el('b', { 'data-k': 'place' }, taille(p.utilise || 0)), el('span', {}, p.total ? mot('k.place', { total: taille(p.total) }) : mot('k.place.seul')), p.total ? el('div', { class: 'sy-bar', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.max(1, occ)}%` })) : null),
      el('div', { class: c.majs ? 'maj' : '' }, el('b', { 'data-k': 'majs' }, nombre(c.majs || 0)), el('span', {}, pluriel(c.majs || 0, 'k.majs'))));
  }

  function etatLigne(c) {
    if (c.etat === 'telechargement') {
      const t = c.telechargement || {}, d = Z.debits[c.id];
      const parts = [t.total ? mot('dl.ligne', { pct: pct(t.pct ?? Math.floor((t.recu / t.total) * 100)), recu: taille(t.recu), total: taille(t.total) }) : mot('dl.ligne.sans', { recu: taille(t.recu) })];
      if (d) { parts.push(mot('dl.vitesse', { v: taille(d.v) })); if (d.resteMs != null) parts.push(mot('dl.reste', { t: duree(d.resteMs) })); }
      const p = t.pct ?? (t.total ? Math.floor((t.recu / t.total) * 100) : 0);
      return [el('div', { class: 'sy-bar', role: 'progressbar', 'aria-valuenow': String(p), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': mot('dl.nom', { nom: c.nom }) }, el('i', { style: `width:${Math.max(2, p)}%` })),
        el('div', { class: 'sy-st', 'data-f': 'progres' }, parts.join(' · '))];
    }
    if (c.etat === 'verification') return [el('div', { class: 'sy-bar raye', 'aria-hidden': 'true' }, el('i', { style: 'width:100%' })), el('div', { class: 'sy-st' }, mot('verif'))];
    if (c.etat === 'empreinte_fausse') return [el('div', { class: 'sy-st' }, el('span', { class: 'sy-tag bad' }, ic('warn', 12), mot('faux'))), el('p', { class: 'sy-about' }, mot('faux.texte'))];
    if (c.etat === 'bloque') return [el('div', { class: 'sy-st' }, el('span', { class: 'sy-tag bad' }, ic('warn', 12), mot('a.bloque'))), el('p', { class: 'sy-about' }, mot('bloque'))];
    const tags = [];
    if (c.empreinte) tags.push(el('span', { class: `sy-tag ${c.empreinte === 'editeur' ? 'ok' : c.empreinte === 'changee' ? 'bad' : ''}`, title: mot(`e.${c.empreinte}.aide`) }, c.empreinte === 'editeur' ? ic('check', 12, 3) : null, mot(`e.${c.empreinte}`)));
    if (c.antivirus && c.antivirus !== 'en_cours') tags.push(el('span', { class: `sy-tag ${c.antivirus === 'propre' ? 'ok' : c.antivirus === 'bloque' ? 'bad' : 'warn'}` }, mot(`a.${c.antivirus}`)));
    if (c.maj) tags.push(el('span', { class: 'sy-tag warn', 'data-f': 'maj' }, mot('maj', { version: c.maj.version })));
    return [el('div', { class: 'sy-st' }, ...tags)];
  }

  function actions(c, hote, redessiner) {
    const nom = nomComplet(c);
    const detail = el('button', { type: 'button', class: 'sy-btn', 'data-f': 'detail', 'aria-label': mot('detail.nom', { nom }), onclick: () => ouvrirDetail(c) }, mot('detail'));
    if (c.etat === 'telechargement') {
      return [el('button', { type: 'button', class: 'sy-btn', 'data-f': 'arreter', 'aria-label': mot('arreter.nom', { nom }), disabled: !c.source, onclick: async () => {
        if (!(await W.OdinDialog.confirm(mot('arreter.confirme', { nom }), { danger: true }))) return;
        const r = await postModule('eitri', 'annuler', { nom: c.source }); await dire(r.text); await redessiner();
      } }, ic('x', 15), mot('arreter'))];
    }
    if (c.etat === 'verification' || c.etat === 'bloque') return [detail];
    if (c.etat === 'empreinte_fausse') {
      return [c.source ? el('button', { type: 'button', class: 'sy-btn pri', 'data-f': 'retel', onclick: () => telecharger(c, mot('retel.confirme', { nom: c.nom }), redessiner) }, ic('refresh', 15), mot('retel')) : null, detail];
    }
    const dep = el('button', { type: 'button', class: 'sy-btn pri', 'data-f': 'deployer', 'aria-label': mot('deployer.nom', { nom }), 'aria-expanded': String(Z.vers === c.id), disabled: !c.deployable, title: c.deployable ? null : mot(`raison.${c.raison || 'absent'}`),
      onclick: () => {
        if (!c.deployable) return;
        // L'onglet « Déployer » (thjalfi-deployer.js) est là : il s'ouvre à « Vers quoi », ce système déjà choisi, pour les
        // trois cibles (clé, réseau, machine virtuelle). Sinon, « Vers quoi ? » ici, comme avant.
        const D = W.OdinGeneseDeployer;
        if (D && typeof D.choisirSysteme === 'function' && hote && typeof hote.aller === 'function' && D.choisirSysteme(c)) { Z.vers = ''; hote.aller('deployer'); return; }
        Z.vers = Z.vers === c.id ? '' : c.id; redessiner(false, { carte: c.id, f: Z.vers ? 'vers-cle' : 'deployer' });
      } }, ic('bolt', 15), mot('deployer'));
    const majB = c.maj ? el('button', { type: 'button', class: 'sy-btn', 'data-f': 'mettre-a-jour', 'aria-label': mot('maj.nom', { nom }), onclick: () => telecharger(c, mot('maj.confirme', { nom: c.nom, version: c.maj.version }), redessiner) }, ic('refresh', 15), mot('maj.bouton')) : null;
    return [dep, detail, majB];
  }

  /** « Vers quoi ? » : la clé USB maintenant ; le réseau et les machines virtuelles plus tard. */
  function vers(c, hote, redessiner) {
    // Échap ferme « Vers quoi ? » et rend la main au bouton « Déployer » de la carte.
    const fermer = (e) => { if (!e || e.key !== 'Escape') return; if (e.preventDefault) e.preventDefault(); Z.vers = ''; void redessiner(false, { carte: c.id, f: 'deployer' }); };
    return el('div', { class: 'sy-vers', 'data-vers': c.id, role: 'group', 'aria-label': mot('deployer.vers'), onkeydown: fermer },
      el('b', {}, mot('deployer.vers')),
      el('button', { type: 'button', class: 'sy-btn pri', 'data-f': 'vers-cle', title: mot('deployer.cle.texte'), onclick: () => deployerSurCle(c, hote) }, ic('usb', 15), mot('deployer.cle')),
      el('button', { type: 'button', class: 'sy-btn', 'data-f': 'vers-reseau', disabled: true }, ic('net', 15), mot('deployer.reseau'), el('small', {}, mot('bientot'))),
      el('button', { type: 'button', class: 'sy-btn', 'data-f': 'vers-vm', disabled: true }, ic('vm', 15), mot('deployer.vm'), el('small', {}, mot('bientot'))));
  }

  async function telecharger(c, question, redessiner) {
    if (!c.source || !(await W.OdinDialog.confirm(question))) return;
    // Le téléchargement dure : on ne l'attend pas, la carte le suit (relue toutes les 3 s). Mais une réponse rapide
    // (un passage déjà en cours, une source à télécharger à la main, déjà à jour, un refus) est dite telle quelle :
    // jamais « C'est parti » quand rien ne part.
    const envoi = postModule('eitri', 'telecharger', { nom: c.source }).catch((e) => ({ ok: false, text: String((e && e.message) || e) }));
    const vite = await Promise.race([envoi, new Promise((ok) => { setTimeout(() => ok(null), 1500); })]);
    Z.msg = vite ? mot('reponse', { nom: c.nom, texte: (vite && vite.text) || '?' }) : mot('lance', { nom: c.nom });
    await redessiner(true);
  }

  async function ouvrirDetail(c) {
    if (c.etat === 'empreinte_fausse') {
      const le = c.le ? new Date(c.le).toLocaleString(langue(), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
      await dire(mot('faux.detail', { nom: nomComplet(c), le, pourquoi: c.pourquoi ? `\n${c.pourquoi}` : '' })); return;
    }
    const r = await postModule('ymir', 'fiche_iso', { iso: c.fichier || c.nom }).catch((e) => ({ ok: false, text: String(e && e.message || e) }));
    if (W.OdinDialog) await W.OdinDialog.alert(r.text || '', { title: nomComplet(c) });
  }

  function carte(c, hote, redessiner) {
    const lettre = (String(c.nom).trim().charAt(0) || '?').toUpperCase();
    const sous = [mot(`fam.${c.famille}`), c.genre ? c.genre.charAt(0).toUpperCase() + c.genre.slice(1) : null, c.taille ? taille(c.taille) : null].filter(Boolean).join(' · ');
    return el('div', { class: 'sy-sys', role: 'listitem', 'data-carte': c.id, 'data-etat': c.etat },
      el('div', { class: 'top' }, el('span', { class: 'sy-mono', style: `background:${couleur(c)}`, 'aria-hidden': 'true' }, lettre), el('span', { class: 'nm' }, el('b', {}, nomComplet(c)), el('small', {}, sous))),
      ...etatLigne(c),
      Z.vers === c.id ? vers(c, hote, redessiner) : null,
      el('div', { class: 'sy-acts' }, ...actions(c, hote, redessiner)));
  }

  /** Monte l'onglet dans root. hote : { post, aller(onglet) } (la page de Genèse). */
  async function dessiner(root, _onglet, hote) {
    if (typeof document !== 'undefined' && document.head && !document.getElementById?.('sysCss')) document.head.append(el('style', { id: 'sysCss' }, CSS));
    const post = (hote && hote.post) || ((a, i) => postModule('thjalfi', a, i));
    const wrap = el('div', { class: 'sy', 'data-f': 'systemes' });
    root.append(wrap);
    const haut = el('div', {}), grille = el('div', { class: 'sy-grid', role: 'list', 'data-f': 'grille' }), note = el('p', { class: 'sy-msg', role: 'status' });
    const chips = el('div', { class: 'sy-chips', role: 'group', 'aria-label': mot('f.groupe') });
    const q = el('input', { class: 'sy-q', type: 'search', placeholder: mot('q'), 'aria-label': mot('q.nom'), value: Z.q, 'data-f': 'recherche', oninput: (e) => { Z.q = e.target.value; rendreGrille(); } });
    q.value = Z.q;
    const ajouter = el('button', { type: 'button', class: 'sy-btn pri', 'data-f': 'ajouter', onclick: () => { location.hash = '#app=eitri'; } }, ic('plus', 15), mot('ajouter'));
    // Les filtres restent les mêmes boutons (seul « aria-pressed » change) : le focus du clavier ne se perd pas.
    const boutonsFiltre = FILTRES.map((f) => el('button', { type: 'button', class: 'sy-chip', 'data-filtre': f, 'aria-pressed': String(Z.filtre === f), onclick: () => { Z.filtre = f; for (const b of boutonsFiltre) b.setAttribute('aria-pressed', String(b.getAttribute('data-filtre') === Z.filtre)); rendreGrille(); } }, mot(`f.${f}`)));
    chips.append(...boutonsFiltre);
    wrap.append(haut, el('section', { class: 'sy-card', 'aria-labelledby': 'sy-titre' }, el('h4', { id: 'sy-titre' }, mot('titre')), el('p', { class: 'sy-lead' }, mot('lead')),
      el('div', { class: 'sy-tools' }, chips, q, ajouter), note, grille));

    /** Où est le focus dans la grille : { carte, f } (la carte et le bouton), pour le rendre après un nouveau dessin. */
    function focusDansGrille() {
      const a = typeof document !== 'undefined' ? document.activeElement : null;
      if (!a || !grille.contains(a)) return undefined;
      let x = a; while (x && x !== grille && !(x.getAttribute && x.getAttribute('data-carte') != null)) x = x.parentNode;
      return x && x !== grille ? { carte: x.getAttribute('data-carte'), f: a.getAttribute && a.getAttribute('data-f') } : undefined;
    }
    function rendreGrille(focus) {
      const d = Z.data, garde = focus || focusDansGrille();
      note.textContent = Z.erreur ? mot('erreur', { raison: Z.erreur }) : !d ? mot('charge') : d.lu && d.lu.bibliotheque === false && !d.cartes.length ? mot('pas.biblio') : Z.msg;
      if (!d) { grille.replaceChildren(); return; }
      const l = filtrer(d.cartes, Z.filtre, Z.q);
      grille.replaceChildren(...l.map((c) => carte(c, hote, redessiner)));
      if (!l.length) grille.append(el('p', { class: 'sy-msg' }, d.cartes.length ? mot('vide.filtre') : mot('vide')));
      // Le même bouton de la même carte (comparé par valeur : aucun nom de fichier n'entre dans un sélecteur) ; sinon « Déployer ».
      if (garde && garde.carte) {
        const k = Array.from(grille.querySelectorAll('[data-carte]')).find((n) => n.getAttribute('data-carte') === garde.carte);
        const n = k && ((garde.f && k.querySelector(`[data-f="${String(garde.f).replace(/[^\w-]/g, '')}"]`)) || k.querySelector('[data-f="deployer"]'));
        if (n && n.focus) n.focus();
      }
    }
    let minuteur = 0;
    /** Visible : dans la page ET pas dans un onglet caché (l'onglet « Tout » de Genèse cache le corps sans le retirer). */
    const visible = () => { if (!wrap.isConnected) return false; for (let x = wrap; x; x = x.parentNode) if (x.hidden) return false; return true; };
    // En direct : tant qu'un téléchargement ou une vérification est en cours, on relit toutes les 3 s — seulement quand
    // la page est visible ; un seul minuteur ; il s'arrête dès que l'onglet est quitté (y revenir redessine tout).
    function armer() {
      clearTimeout(minuteur); minuteur = 0;
      const vivant = Z.data && (Z.data.cartes || []).some((c) => c.etat === 'telechargement' || c.etat === 'verification');
      if (!vivant) return;
      const tic = () => {
        minuteur = 0;
        if (!visible()) return;
        if (typeof document !== 'undefined' && document.hidden) { minuteur = setTimeout(tic, 3000); return; }
        void redessiner(true);
      };
      minuteur = setTimeout(tic, 3000);
    }
    async function redessiner(relire = true, focus) {
      if (relire) {
        let r; try { r = await post('systemes', {}); } catch (e) { r = { ok: false, text: String(e && e.message || e) }; }
        if (r && r.ok !== false && r.data) {
          const t = Date.now(), avant = Z.data;
          Z.debits = {};
          for (const c of r.data.cartes || []) {
            if (c.etat !== 'telechargement' || !c.telechargement) continue;
            const a = avant && (avant.cartes || []).find((x) => x.id === c.id);
            const v = a && a.telechargement ? vitesse({ recu: a.telechargement.recu, t: avant.lu_le || 0 }, { recu: c.telechargement.recu, total: c.telechargement.total, t }) : undefined;
            if (v) Z.debits[c.id] = v;
          }
          Z.data = { ...r.data, lu_le: t }; Z.erreur = '';
        } else { Z.erreur = (r && r.text) || '?'; }
      }
      haut.replaceChildren(Z.data ? chiffres(Z.data) : el('span'));
      rendreGrille(focus);
      armer();
    }
    await redessiner(true);
  }

  W.OdinGeneseSystemes = { onglets: [['systemes', MOTS.onglet]], dessiner, MOTS, logique, etat: Z };
})();
