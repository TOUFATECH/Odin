// Genèse · onglet « Logiciels » (maquette validée « Genèse · Systèmes », lot S4, écrans 4 et 4b) : les logiciels à
// installer tout seuls à la fin de chaque installation, rangés dans des PROFILS nommés, communs à la clé USB, au
// démarrage par le réseau et aux machines virtuelles.
//   - un sous-onglet par système (Windows 11 et 10 ; Ubuntu et Debian ; Fedora) ;
//   - les profils (créer, renommer, dupliquer, supprimer avec confirmation), gardés par Odin côté serveur
//     (actions profils_logiciels et profil_logiciels, propriétaire seul) ;
//   - le catalogue : les logiciels DÉJÀ TÉLÉCHARGÉS, filtrés pour le système (la même source que l'étape 4 de la clé :
//     action cle_logiciels), chacun « tout seul » ou « te posera des questions » ; recherche ;
//   - « Ce qui sera installé tout seul » : l'ordre d'installation (monter, descendre, retirer) ;
//   - le script créé tout seul, refait en direct : LE MÊME aperçu que la clé (action cle_apercu_script, demande faite
//     par la logique de thjalfi-cle-logiciels.js, rien n'est recopié) ;
//   - tes scripts : mêmes règles que la clé (extension du système, 64 Ko, antivirus d'Odin) ; montrés comme du TEXTE,
//     jamais exécutés par Odin.
// Un changement reste un brouillon jusqu'à « Enregistrer » (ou « Annuler »). Tous les textes sont dans MOTS.
// Expose window.OdinGeneseLogiciels = { onglets, dessiner(root, onglet, hote), MOTS, logique, etat }.
(() => {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;

  // ---------------------------------------------------------------- les mots
  const MOTS = {
    onglet: 'Logiciels',
    titre: 'Logiciels',
    lead: 'Ceux qu\'Odin a déjà téléchargés pour Windows et les paquets des systèmes Linux. Choisis-les une fois, dans un profil : ils s\'installent tout seuls à la fin de chaque installation, par la clé, le réseau ou une machine virtuelle.',
    'os.groupe': 'Système',
    'os.windows': 'Windows 11 et 10', 'os.debian': 'Ubuntu et Debian', 'os.fedora': 'Fedora',
    'prof.titre': 'Profil', 'prof.groupe': 'Profil',
    'prof.nouveau': 'Nouveau profil', 'prof.renommer': 'Renommer', 'prof.dupliquer': 'Dupliquer', 'prof.supprimer': 'Supprimer',
    'prof.renommer.nom': 'Renommer le profil {nom}', 'prof.dupliquer.nom': 'Dupliquer le profil {nom}', 'prof.supprimer.nom': 'Supprimer le profil {nom}',
    'prof.question': 'Nom du nouveau profil', 'prof.question.renommer': 'Nouveau nom du profil',
    'prof.defaut': 'Standard',
    'prof.sert': 'Le profil « {nom} » est commun à la clé USB, au démarrage par le réseau et aux machines virtuelles. Aujourd\'hui il sert à l\'étape « Logiciels et scripts » de la clé ; réseau et machines virtuelles : bientôt.',
    'prof.charge': 'Odin lit tes profils…',
    'prof.erreur': 'Les profils ne peuvent pas être lus : {raison}',
    'prof.abimes': '{n} profil(s) abîmé(s) à la main laissé(s) de côté. À la prochaine écriture, Odin garde l\'ancien fichier à part : rien n\'est perdu.',
    'prof.illisible': 'Le fichier des profils est abîmé. À la prochaine écriture, Odin le garde à part : rien n\'est perdu.',
    'f.groupe': 'Montrer', 'f.tout': 'Tout', 'f.seuls': 'Tout seuls', 'f.questions': 'Avec questions', 'f.choisis': 'Choisis',
    q: 'Chercher un logiciel…', 'q.nom': 'Chercher un logiciel',
    'cat.charge': 'Odin cherche les logiciels déjà téléchargés…',
    'cat.erreur': 'Odin n\'a pas pu lire les logiciels : {raison}',
    'cat.vide.windows': 'Aucun logiciel pour Windows déjà téléchargé. Télécharge-les d\'abord : ils apparaîtront ici.',
    'cat.vide.linux': 'Aucun paquet pour ce système déjà téléchargé. Télécharge-les d\'abord : ils apparaîtront ici.',
    'cat.rien': 'Rien ne correspond.',
    'cat.note.windows': 'Seuls les logiciels déjà téléchargés par Odin sont proposés, filtrés pour Windows. « Te posera des questions » : copié, à finir à la main.',
    'cat.note.linux': 'Seuls les paquets déjà téléchargés par Odin sont proposés, filtrés pour ce système. Ils s\'installent à la fin de l\'installation.',
    seul: 'tout seul', questions: 'te posera des questions', absent: 'pas téléchargé',
    version: 'version {v}',
    'ord.titre': 'Ce qui sera installé tout seul',
    'ord.seuls.one': 'tout seul', 'ord.seuls.other': 'tout seuls',
    'ord.questions': '{n} te posera des questions',
    'ord.rang.one': '{n}er installé', 'ord.rang.other': '{n}e installé',
    'ord.vide': 'Rien de choisi pour ce système. Coche des logiciels dans la liste.',
    'ord.monter': 'Monter {nom}', 'ord.descendre': 'Descendre {nom}', 'ord.retirer': 'Retirer {nom}',
    'chg.titre': 'Profil « {nom} » changé', 'chg.nouveau': 'Profil « {nom} » pas encore enregistré',
    annuler: 'Annuler', enregistrer: 'Enregistrer',
    'aide.verif': 'Odin vérifie encore tes scripts.', 'aide.refuse': 'Retire d\'abord le script refusé.',
    'apercu.titre': 'Script créé tout seul', 'apercu.lead': 'Il change en direct. Le même que sur la clé, montré avant chaque déploiement.',
    'apercu.fichiers': 'Fichier montré',
    'apercu.pour': 'Aperçu pour', 'var.ubuntu': 'Ubuntu', 'var.debian': 'Debian',
    'apercu.calcul': 'Odin refait le script…', 'apercu.erreur': 'Odin n\'a pas pu montrer le script : {raison}', 'apercu.rien': 'Le script apparaît ici dès qu\'un choix est fait.',
    'scr.titre': 'Tes scripts',
    'scr.ajouter.windows': 'Ajouter un script (.ps1, .cmd, .bat)', 'scr.ajouter.linux': 'Ajouter un script (.sh)',
    'scr.choisir': 'Choisir un script à ajouter',
    'scr.aucun': 'Aucun script pour ce système.',
    'scr.sous': 'Lancé à la fin, après les logiciels',
    'scr.verif': 'L\'antivirus d\'Odin le vérifie…', 'scr.refuse': 'Refusé',
    'scr.monter': 'Monter {nom}', 'scr.descendre': 'Descendre {nom}', 'scr.voir': 'Voir {nom}', 'scr.cacher': 'Cacher {nom}', 'scr.retirer': 'Retirer {nom}',
    'scr.illisible': 'Odin n\'a pas pu lire « {nom} ».',
    'scr.note': 'Chaque script passe par l\'antivirus d\'Odin, à l\'ajout et de nouveau à chaque usage. C\'est un filet, pas une garantie : relis toujours ton script. Odin ne le lance jamais lui-même.',
    'pas.cle': 'Cet onglet a besoin de la clé USB de Genèse, qui n\'est pas chargée.',
  };
  const mot = (k, v) => String(MOTS[k] ?? k).replace(/\{(\w+)\}/g, (_m, x) => (v && v[x] != null ? String(v[x]) : ''));
  const langue = () => { try { return (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || undefined; } catch { return undefined; } };
  const nombre = (n) => { try { return new Intl.NumberFormat(langue()).format(n); } catch { return String(n); } };
  const forme = (n) => { try { return new Intl.PluralRules(langue() || 'fr').select(n) === 'one' ? 'one' : 'other'; } catch { return n > 1 ? 'other' : 'one'; } };
  const rang = (n) => { try { return new Intl.PluralRules(langue() || 'fr', { type: 'ordinal' }).select(n) === 'one' ? 'one' : 'other'; } catch { return n === 1 ? 'one' : 'other'; } };

  // ---------------------------------------------------------------- la logique (pure)
  /** La logique de l'étape 4 de la clé (thjalfi-cle-logiciels.js) : réutilisée, jamais recopiée. */
  const CL = () => (W.OdinGeneseCleLogiciels && W.OdinGeneseCleLogiciels.logique) || null;
  const OS = ['windows', 'debian', 'fedora'];
  /** Les familles de fichiers de chaque système (même tri que le serveur, thjalfi.ts FAMILLES_OS). */
  const FAMILLES = { windows: ['windows'], debian: ['linux-deb', 'linux-flatpak', 'linux-appimage'], fedora: ['linux-rpm', 'linux-flatpak', 'linux-appimage'] };
  const osCle = (os) => (os === 'windows' ? 'windows' : 'linux');
  /** Le système dont on montre le script (le même calcul que sur la clé, pour un système de cette famille). */
  const SYSTEME = { windows: { famille: 'windows', nom: 'Windows', fichier: '' }, debian: { famille: 'linux', nom: 'Ubuntu', fichier: '' }, fedora: { famille: 'linux', nom: 'Fedora', fichier: '' } };
  /** « Ubuntu et Debian » : un même jeu de paquets, mais pas les mêmes réponses d'installation ; l'aperçu montre l'un ou l'autre. */
  const VARIANTES = { debian: ['ubuntu', 'debian'] };
  const SYSTEME_VARIANTE = { ubuntu: { famille: 'linux', nom: 'Ubuntu', fichier: '' }, debian: { famille: 'linux', nom: 'Debian', fichier: '' } };
  /** Les options Windows de départ de la clé (étape 5) : le script de fin ne dépend pas d'elles. */
  const WIN = () => ({ exigences: true, local: true, compte: (W.OdinGeneseCleLogiciels && W.OdinGeneseCleLogiciels.MOTS && W.OdinGeneseCleLogiciels.MOTS['win.compte.defaut']) || 'Utilisateur', viePrivee: true, langue: true, activation: '', disque: 'choisir' });
  const propre = (x) => String(x == null ? '' : x).replace(/[\p{Cc}\p{Cf}]+/gu, '').trim();
  const familleDe = (l) => l.famille || (/\.(exe|msi|msix|msixbundle|appx)$/i.test(l.fichier) ? 'windows' : /\.deb$/i.test(l.fichier) ? 'linux-deb' : /\.rpm$/i.test(l.fichier) ? 'linux-rpm' : /\.flatpak(ref)?$/i.test(l.fichier) ? 'linux-flatpak' : /\.appimage$/i.test(l.fichier) ? 'linux-appimage' : 'autre');
  /** Le catalogue d'un système : les logiciels téléchargés de sa famille. Pur. */
  const pourOs = (liste, os) => (Array.isArray(liste) ? liste : []).filter((l) => l && l.fichier && FAMILLES[os].includes(familleDe(l)));
  const sansAccents = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  /** Le filtre (tout, seuls, questions, choisis) et la recherche (sans accents ni majuscules). Pur. */
  function filtrer(liste, filtre, q, choisis) {
    const t = sansAccents(q).trim(), pris = new Set((choisis || []).map((x) => x.fichier));
    return liste.filter((l) => (filtre === 'seuls' ? l.silencieux : filtre === 'questions' ? !l.silencieux : filtre === 'choisis' ? pris.has(l.fichier) : true)
      && (!t || sansAccents(`${l.nom} ${l.fichier} ${l.version ?? ''}`).includes(t)));
  }
  /** Déplacer un élément d'un cran (l'ordre d'installation). Pur. */
  function bouger(liste, i, pas) { const l = [...liste], j = i + pas; if (i < 0 || j < 0 || j >= l.length) return l; [l[i], l[j]] = [l[j], l[i]]; return l; }
  /** La demande d'aperçu d'un système du profil : celle que ferait la clé pour les mêmes choix (même fonction). */
  function demandeProfil(os, b, variante) {
    const L = CL(); if (!L) return null;
    const sys = (VARIANTES[os] && VARIANTES[os].includes(variante) && SYSTEME_VARIANTE[variante]) || SYSTEME[os];
    return L.demande(sys, b.logiciels, b.scripts.map((x) => ({ ...x, os: osCle(os) })), WIN());
  }
  /** Un profil reçu du serveur → un brouillon de la page (scripts avec leur verdict, relu par le serveur). Pur. */
  let uid = 0;
  function brouillonDe(p) {
    const b = {};
    for (const os of OS) {
      const x = (p && p.systemes && p.systemes[os]) || {};
      b[os] = {
        logiciels: (x.logiciels || []).map((l) => ({ id: String(l.id), fichier: String(l.fichier), nom: String(l.nom), silencieux: Boolean(l.silencieux) })),
        scripts: (x.scripts || []).map((s) => ({ uid: `p${++uid}`, nom: String(s.nom), contenu: String(s.contenu), etat: s.ok === false ? 'refuse' : 'ok', raison: s.ok === false ? propre(s.raison) : '' })),
      };
    }
    return b;
  }
  /** Ce qui part au serveur pour « Enregistrer ». Pur. */
  const versServeur = (b) => Object.fromEntries(OS.map((os) => [os, { logiciels: b[os].logiciels.map((l) => ({ id: l.id, fichier: l.fichier, nom: l.nom })), scripts: b[os].scripts.map((s) => ({ nom: s.nom, contenu: s.contenu })) }]));
  const signature = (b) => JSON.stringify(versServeur(b));
  const logique = { MOTS, mot, OS, FAMILLES, VARIANTES, pourOs, filtrer, bouger, demandeProfil, brouillonDe, versServeur, signature };

  // ---------------------------------------------------------------- l'état (gardé quand on change d'onglet)
  const Z = {
    os: 'windows', profil: '', filtre: 'tout', q: '', data: null, erreur: '', msg: '', msgKo: false, annonce: '', voir: '',
    brouillons: {}, dispo: { windows: { etat: 'rien', liste: [], raison: '' }, linux: { etat: 'rien', liste: [], raison: '' } },
    apercu: {}, vu: {}, enVol: false, refaire: false, occupe: false, variante: { debian: 'ubuntu' },
  };
  /** Le profil montré : celui choisi, le premier, ou un brouillon « Standard » pas encore enregistré. */
  function courant() {
    const l = (Z.data && Z.data.profils) || [];
    const p = l.find((x) => x.id === Z.profil) || l[0];
    if (p) { Z.profil = p.id; if (!Z.brouillons[p.id]) Z.brouillons[p.id] = brouillonDe(p); return { id: p.id, nom: p.nom, neuf: false, b: Z.brouillons[p.id], sauve: p }; }
    Z.profil = '';
    if (!Z.brouillons['']) Z.brouillons[''] = brouillonDe(null);
    return { id: '', nom: mot('prof.defaut'), neuf: true, b: Z.brouillons[''], sauve: null };
  }
  const change = (c) => (c.neuf ? OS.some((os) => c.b[os].logiciels.length || c.b[os].scripts.length) : signature(c.b) !== signature(brouillonDe(c.sauve)));
  const scriptsEnAttente = (c) => OS.some((os) => c.b[os].scripts.some((s) => s.etat === 'verif'));
  const scriptsRefuses = (c) => OS.some((os) => c.b[os].scripts.some((s) => s.etat === 'refuse'));

  // ---------------------------------------------------------------- le dessin
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(typeof c === 'object' ? c : document.createTextNode(String(c)));
    return n;
  };
  const P = { plus: 'M12 5v14M5 12h14', check: 'M5 12l5 5L20 7', up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', x: 'M6 6l12 12M18 6 6 18', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', pen: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4', copy: 'M9 9h11v11H9zM5 15H4V4h11v1' };
  const ic = (n, s = 16, w = 2) => { const v = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); v.setAttribute('viewBox', '0 0 24 24'); v.setAttribute('width', s); v.setAttribute('height', s); v.setAttribute('aria-hidden', 'true'); v.innerHTML = `<path d="${P[n]}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`; return v; };
  /** Une couleur stable par nom de logiciel (une forme, aucun logo). */
  const teinte = (nom) => { let h = 0; for (const c of String(nom)) h = (h * 31 + c.codePointAt(0)) % 360; return `hsl(${h} 52% 40%)`; };

  const CSS = `
.lg{display:flex;flex-direction:column;gap:14px;min-width:0}
.lg-card{background:var(--panel);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow,none);padding:18px;min-width:0}
.lg-card>h4{margin:0 0 4px;font-size:17px;letter-spacing:-.01em}.lg-lead{margin:0 0 14px;color:var(--muted);font-size:13px;line-height:1.45}
.lg-h5{font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);font-weight:700;margin:14px 0 8px;display:flex;align-items:center;gap:8px}
.lg-cnt{font-size:11px;font-weight:700;padding:1px 8px;border-radius:999px;background:color-mix(in srgb,var(--ink) 7%,transparent);color:var(--ink);letter-spacing:0;text-transform:none}
.lg-chips{display:flex;gap:8px;flex-wrap:wrap}
.lg-chip{min-height:44px;padding:0 16px;border-radius:999px;border:1px solid var(--line);background:var(--panel);font:600 13px inherit;color:var(--muted);cursor:pointer;display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
.lg-chip[aria-pressed=true],.lg-chip[aria-selected=true]{background:color-mix(in srgb,var(--accent,#0b7f7c) 14%,var(--panel));color:var(--ink);border-color:var(--accent,#0b7f7c)}
.lg-chip[aria-pressed=true] .lg-cnt{background:color-mix(in srgb,var(--accent,#0b7f7c) 22%,transparent)}
@media (max-width:600px){.lg-scroll{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;max-width:100%;padding:2px;margin:-2px}.lg-scroll::-webkit-scrollbar{display:none}.lg-scroll .lg-chip{flex:none}}
.lg-note{margin:8px 0 0;font-size:12.5px;color:var(--muted);line-height:1.45}
.lg-msg{margin:0;font-size:13px;color:var(--muted)}.lg-msg.ko{color:var(--bad,#e5484d);font-weight:600}
.lg-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.lg-btn{min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:600 13.5px inherit;display:inline-flex;align-items:center;justify-content:center;gap:7px;cursor:pointer;white-space:nowrap}
.lg-btn.pri{background:var(--accent,#0b7f7c);color:var(--on-accent,#fff);border-color:transparent}.lg-btn.ko{color:var(--bad,#e5484d)}.lg-btn:disabled{opacity:.45;cursor:not-allowed}
.lg-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:14px;align-items:start}@media (max-width:900px){.lg-grid{grid-template-columns:minmax(0,1fr)}}
.lg-col{display:flex;flex-direction:column;gap:14px;min-width:0}
.lg-q{width:100%;box-sizing:border-box;min-height:44px;border-radius:12px;border:1px solid var(--line);background:var(--field,var(--panel));color:var(--ink);padding:0 14px;font:inherit;font-size:14px;margin:12px 0 4px}
.lg-sw{display:flex;align-items:center;gap:12px;min-height:52px;padding:6px 8px;border-radius:12px;border:1px solid transparent;width:100%;text-align:left;background:none;color:var(--ink);font:inherit;cursor:pointer}
.lg-sw:hover{background:color-mix(in srgb,var(--ink) 5%,transparent)}
.lg-sw .box{width:24px;height:24px;border-radius:7px;border:2px solid var(--line);display:grid;place-items:center;flex:none}
.lg-sw[aria-checked=true] .box{background:var(--accent,#0b7f7c);border-color:var(--accent,#0b7f7c);color:var(--on-accent,#fff)}
.lg-swi{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-weight:800;font-size:13px;color:#fff;flex:none}
.lg-nm{flex:1;min-width:0}.lg-nm b{display:block;font-size:14px;font-weight:600;overflow-wrap:anywhere}.lg-nm small{display:block;font-size:12px;color:var(--muted);overflow-wrap:anywhere}
.lg-tag{font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;white-space:nowrap;flex:none}
.lg-tag.ok{background:color-mix(in srgb,var(--good,#1f9d55) 16%,transparent);color:color-mix(in srgb,var(--good,#1f9d55) 80%,var(--ink))}
.lg-tag.warn{background:color-mix(in srgb,var(--warn,#d97706) 18%,transparent);color:color-mix(in srgb,var(--warn,#d97706) 70%,var(--ink))}
.lg-tag.bad{background:color-mix(in srgb,var(--bad,#e5484d) 14%,transparent);color:color-mix(in srgb,var(--bad,#e5484d) 80%,var(--ink))}
.lg-sum{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--ink) 5%,transparent);font-size:13px}.lg-sum b{font-size:18px}
.lg-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;border:1px solid var(--line);margin-top:8px;flex-wrap:wrap}
.lg-item.refuse{border-color:var(--bad,#e5484d)}
.lg-ord{display:flex;gap:4px}
.lg-ib{width:44px;height:44px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);display:grid;place-items:center;flex:none;cursor:pointer;padding:0}
.lg-ib:disabled{opacity:.4;cursor:not-allowed}
.lg-item .lg-nm{min-width:120px}.lg-item small.ko{color:var(--bad,#e5484d);font-weight:600}
.lg-item pre{flex-basis:100%}
.lg-pend{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px;padding:10px 12px;border-radius:12px;border:1.5px solid var(--accent,#0b7f7c);background:color-mix(in srgb,var(--accent,#0b7f7c) 8%,var(--panel))}
.lg-pend b{flex:1;min-width:160px;font-size:13.5px}.lg-pend small{flex-basis:100%;color:var(--muted);font-size:12px}
.lg-files{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 6px}
.lg-files button{min-height:44px;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:none;font:600 12px ui-monospace,Consolas,monospace;color:var(--muted);cursor:pointer}
.lg-files button[aria-pressed=true]{background:color-mix(in srgb,var(--accent,#0b7f7c) 14%,var(--panel));color:var(--ink);border-color:var(--accent,#0b7f7c)}
.lg-code{font:12px/1.55 ui-monospace,Consolas,monospace;background:color-mix(in srgb,var(--ink) 6%,var(--panel));color:var(--ink);border:1px solid var(--line);border-radius:12px;padding:12px;overflow:auto;max-height:280px;white-space:pre;margin:0}
.lg-code:focus-visible{outline:2px solid var(--accent,#0b7f7c);outline-offset:2px}
.lg-add{margin-top:10px;width:100%}
@media (max-width:640px){
  .lg-card{padding:14px}
  .lg-sw .lg-tag{white-space:normal;text-align:center;max-width:96px}
  .lg-item .lg-nm{flex-basis:100%;order:-1}
  .lg-item .lg-ord{margin-right:auto}
}
`;

  // ---------------------------------------------------------------- dessiner
  /** Monte l'onglet dans root. hote : { post(action, input), act(action, input) (avec la confirmation d'une action grave) }. */
  async function dessiner(root, _onglet, hote) {
    if (typeof document !== 'undefined' && document.head && !document.getElementById?.('lgCss')) document.head.append(el('style', { id: 'lgCss' }, CSS));
    const post = (hote && hote.post) || (async (action, input) => (await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'thjalfi', action, input }) })).json());
    const act = (hote && hote.act) || post;
    const wrap = el('div', { class: 'lg', 'data-f': 'logiciels' });
    root.append(wrap);
    const raison = (r, e) => String((r && r.text) || (e && e.message) || e || '?');

    async function lireProfils() {
      let r, e;
      try { r = await post('profils_logiciels', {}); } catch (x) { e = x; }
      if (r && r.ok !== false && r.data && Array.isArray(r.data.profils)) { Z.data = r.data; Z.erreur = ''; } else Z.erreur = raison(r, e);
    }
    async function chargerCatalogue(o) {
      if (Z.dispo[o].etat === 'charge') return;
      Z.dispo[o] = { ...Z.dispo[o], etat: 'charge' };
      let r, e;
      try { r = await post('cle_logiciels', { os: o }); } catch (x) { e = x; }
      const l = r && r.data && Array.isArray(r.data.logiciels) ? r.data.logiciels : null;
      Z.dispo[o] = r && r.ok !== false && l ? { etat: 'pret', liste: l.filter((x) => x && typeof x === 'object' && x.fichier), raison: '' } : { etat: 'erreur', liste: [], raison: raison(r, e) };
      redessiner();
    }
    /** L'aperçu du système montré : une demande à la fois, refaite si les choix ont changé entre-temps. */
    async function rafraichir() {
      if (Z.enVol) { Z.refaire = true; return; }
      Z.enVol = true;
      try {
        do {
          Z.refaire = false;
          const c = courant(), os = Z.os, v = Z.variante[os] || '', q = demandeProfil(os, c.b[os], v);
          if (!q) break;
          const sig = JSON.stringify(q), cle = `${c.id}:${os}:${v}`;
          if (Z.apercu[cle] && Z.apercu[cle].sig === sig && Z.apercu[cle].etat !== 'calcul') break;
          Z.apercu[cle] = { ...(Z.apercu[cle] || {}), etat: 'calcul', sig };
          let r, e;
          try { r = await post('cle_apercu_script', q); } catch (x) { e = x; }
          const d = r && r.data;
          if (r && r.ok !== false && d && d.fichiers && typeof d.fichiers === 'object') {
            Z.apercu[cle] = { etat: 'pret', sig, fichiers: d.fichiers };
            // Les verdicts de l'antivirus, rangés sur les scripts envoyés (même ordre, même nom, même contenu).
            if (Array.isArray(d.scripts)) q.scripts.forEach((x, k) => {
              const v = d.scripts[k], s = c.b[os].scripts.find((y) => y.etat === 'verif' && y.nom === x.nom && y.contenu === x.contenu);
              if (!s || !v || v.nom !== x.nom) return;
              s.etat = v.ok ? 'ok' : 'refuse'; s.raison = v.ok ? '' : propre(v.raison);
              Z.annonce = v.ok ? '' : `${s.nom} : ${s.raison}`;
            });
          } else Z.apercu[cle] = { etat: 'erreur', sig, raison: raison(r, e) };
          redessiner();
        } while (Z.refaire);
      } finally { Z.enVol = false; }
    }

    // ---------------------------------------------------------- actions de la page
    const dire = (t, ko) => { Z.msg = t || ''; Z.msgKo = Boolean(ko); };
    function changer(focus) { void rafraichir(); redessiner(focus); }
    function cocher(l) {
      const c = courant(), b = c.b[Z.os], L = CL();
      b.logiciels = L ? L.basculerLogiciel(b.logiciels, l) : b.logiciels;
      changer(`sw:${l.fichier}`);
    }
    function ordre(i, pas) { const b = courant().b[Z.os]; b.logiciels = bouger(b.logiciels, i, pas); changer(`ord-${pas < 0 ? 'up' : 'down'}-${i + pas}`); }
    function retirer(i) { const b = courant().b[Z.os]; b.logiciels = b.logiciels.filter((_x, k) => k !== i); changer('ord-titre'); }
    function ajouterScript(nom, contenu) {
      const L = CL(), b = courant().b[Z.os];
      const octets = typeof TextEncoder === 'function' ? new TextEncoder().encode(String(contenu)).length : String(contenu).length;
      const refus = L ? L.refusLocal(nom, octets, osCle(Z.os), b.scripts.length) : mot('pas.cle');
      if (refus) { dire(refus, true); redessiner('scr-ajouter'); return false; }
      dire('');
      b.scripts = [...b.scripts, { uid: `s${++uid}`, nom: propre(String(nom).split(/[\\/]/).pop()), contenu: String(contenu), etat: 'verif', raison: '' }];
      changer('scr-ajouter');
      return true;
    }
    async function lireFichier(input) {
      const f = input && input.files && input.files[0];
      if (!f) return;
      try { input.value = ''; } catch { /* rien */ }
      const nom = propre(f.name);
      let t;
      try { t = typeof f.text === 'function' ? await f.text() : ''; } catch { dire(mot('scr.illisible', { nom }), true); redessiner('scr-ajouter'); return; }
      ajouterScript(nom, t);
    }
    function bougerScript(k, pas) { const b = courant().b[Z.os]; b.scripts = bouger(b.scripts, k, pas); changer(`scr-${pas < 0 ? 'up' : 'down'}-${b.scripts[k + pas] ? b.scripts[k + pas].uid : ''}`); }
    function retirerScript(u) { const b = courant().b[Z.os]; b.scripts = b.scripts.filter((x) => x.uid !== u); if (Z.voir === u) Z.voir = ''; changer('scr-ajouter'); }
    /** Une écriture sur les profils : la réponse du serveur (vraie) est dite ; la liste revient avec elle. */
    async function ecrire(input, focus, grave, oublier) {
      if (Z.occupe) return;
      Z.occupe = true; redessiner(focus);
      let r, e;
      try { r = await (grave ? act : post)('profil_logiciels', input); } catch (x) { e = x; }
      Z.occupe = false;
      if (r && r.ok !== false && r.data && Array.isArray(r.data.profils)) {
        Z.data = r.data; Z.erreur = '';
        // Le brouillon enregistré (ou supprimé) est oublié ; les autres brouillons restent tels quels (renommer ou dupliquer
        // un profil garde ses changements pas encore enregistrés).
        if (oublier !== undefined) delete Z.brouillons[oublier];
        if (r.data.choisi) Z.profil = r.data.choisi;
        dire(r.text, false);
        // L'étape 4 de la clé relira les profils (« Partir d'un profil ») la prochaine fois qu'elle s'ouvre.
        const CE = W.OdinGeneseCleLogiciels && W.OdinGeneseCleLogiciels.etat;
        if (CE && CE.profils) CE.profils = { etat: 'rien', liste: [], raison: '' };
      } else if (!(r && r.text === 'Annulé.')) dire(raison(r, e), true);
      Z.apercu = {};
      changer(focus);
    }
    async function nouveau(c) {
      const n = W.OdinDialog ? await W.OdinDialog.prompt(mot('prof.question'), '') : null;
      if (n == null || !String(n).trim()) return;
      // Le brouillon « Standard » pas encore enregistré : il devient ce nouveau profil (sinon il disparaîtrait de la page).
      if (c && c.neuf && change(c)) { await ecrire({ op: 'creer', nom: String(n), systemes: versServeur(c.b) }, 'prof-nouveau', false, ''); return; }
      await ecrire({ op: 'creer', nom: String(n) }, 'prof-nouveau');
    }
    async function renommer(c) {
      const n = W.OdinDialog ? await W.OdinDialog.prompt(mot('prof.question.renommer'), c.nom) : null;
      if (n == null || !String(n).trim() || String(n) === c.nom) return;
      await ecrire({ op: 'renommer', id: c.id, nom: String(n) }, 'prof-renommer');
    }
    const dupliquer = (c) => ecrire({ op: 'dupliquer', id: c.id }, 'prof-dupliquer');
    const supprimer = (c) => ecrire({ op: 'supprimer', id: c.id }, 'prof-nouveau', true, c.id);
    const enregistrer = (c) => ecrire(c.neuf ? { op: 'creer', nom: c.nom, systemes: versServeur(c.b) } : { op: 'enregistrer', id: c.id, systemes: versServeur(c.b) }, 'enregistrer', false, c.id);
    function annuler(c) { delete Z.brouillons[c.id]; dire(''); Z.apercu = {}; changer('prof-titre'); }

    // ---------------------------------------------------------- les blocs
    function haut(c) {
      const l = (Z.data && Z.data.profils) || [];
      const osTabs = el('div', { class: 'lg-chips lg-scroll', role: 'tablist', 'aria-label': mot('os.groupe') }, ...OS.map((os, i) => el('button', {
        type: 'button', class: 'lg-chip', role: 'tab', 'aria-selected': String(Z.os === os), tabindex: Z.os === os ? '0' : '-1', 'data-f': `os-${os}`, 'data-os': os,
        onclick: () => { if (Z.os !== os) { Z.os = os; Z.voir = ''; dire(''); changer(`os-${os}`); } },
        onkeydown: (e) => { const pas = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!pas) return; if (e.preventDefault) e.preventDefault(); const j = (i + pas + OS.length) % OS.length; Z.os = OS[j]; changer(`os-${OS[j]}`); },
      }, mot(`os.${os}`))));
      const compte = (b) => b[Z.os].logiciels.length;
      const chips = [...l.map((p) => { const b = Z.brouillons[p.id] || brouillonDe(p); return el('button', { type: 'button', class: 'lg-chip', 'aria-pressed': String(p.id === c.id), 'data-f': `prof:${p.id}`, 'data-prof': p.id, onclick: () => { Z.profil = p.id; Z.voir = ''; dire(''); changer(`prof:${p.id}`); } }, p.nom, el('span', { class: 'lg-cnt' }, nombre(compte(b)))); })];
      if (c.neuf) chips.push(el('button', { type: 'button', class: 'lg-chip', 'aria-pressed': 'true', 'data-f': 'prof:', 'data-prof': '' }, c.nom, el('span', { class: 'lg-cnt' }, nombre(compte(c.b)))));
      chips.push(el('button', { type: 'button', class: 'lg-chip', 'data-f': 'prof-nouveau', disabled: Z.occupe, onclick: () => nouveau(c) }, ic('plus', 15), mot('prof.nouveau')));
      const kids = [el('h4', { id: 'lg-titre', 'data-f': 'prof-titre', tabindex: '-1' }, mot('titre')), el('p', { class: 'lg-lead' }, mot('lead')), osTabs,
        el('div', { class: 'lg-h5' }, mot('prof.titre')), el('div', { class: 'lg-chips', role: 'group', 'aria-label': mot('prof.groupe') }, ...chips)];
      if (!Z.data && !Z.erreur) kids.push(el('p', { class: 'lg-note', role: 'status' }, mot('prof.charge')));
      if (Z.erreur) kids.push(el('p', { class: 'lg-msg ko', role: 'alert', style: 'margin-top:8px' }, mot('prof.erreur', { raison: Z.erreur })));
      const ab = Z.data ? Number(Z.data.abimes) || 0 : 0;
      if (ab) kids.push(el('p', { class: 'lg-msg ko', role: 'status', 'data-f': 'abimes', style: 'margin-top:8px' }, ab < 0 ? mot('prof.illisible') : mot('prof.abimes', { n: nombre(ab) })));
      kids.push(el('p', { class: 'lg-note' }, mot('prof.sert', { nom: c.nom })));
      kids.push(el('div', { class: 'lg-btns' },
        el('button', { type: 'button', class: 'lg-btn', 'data-f': 'prof-renommer', 'aria-label': mot('prof.renommer.nom', { nom: c.nom }), disabled: c.neuf || Z.occupe, onclick: () => renommer(c) }, ic('pen', 15), mot('prof.renommer')),
        el('button', { type: 'button', class: 'lg-btn', 'data-f': 'prof-dupliquer', 'aria-label': mot('prof.dupliquer.nom', { nom: c.nom }), disabled: c.neuf || Z.occupe, onclick: () => dupliquer(c) }, ic('copy', 15), mot('prof.dupliquer')),
        el('button', { type: 'button', class: 'lg-btn ko', 'data-f': 'prof-supprimer', 'aria-label': mot('prof.supprimer.nom', { nom: c.nom }), disabled: c.neuf || Z.occupe, onclick: () => supprimer(c) }, ic('trash', 15), mot('prof.supprimer'))));
      if (Z.msg) kids.push(el('p', { class: `lg-msg${Z.msgKo ? ' ko' : ''}`, role: Z.msgKo ? 'alert' : 'status', 'data-f': 'message', style: 'margin-top:10px' }, Z.msg));
      return el('section', { class: 'lg-card', 'aria-labelledby': 'lg-titre' }, ...kids);
    }
    const liste = el('div', { 'data-f': 'catalogue' });
    function rendreListe(c) {
      const o = osCle(Z.os), d = Z.dispo[o], b = c.b[Z.os];
      if (d.etat === 'rien') void chargerCatalogue(o);
      if (d.etat === 'charge' || d.etat === 'rien') { liste.replaceChildren(el('p', { class: 'lg-msg', role: 'status' }, mot('cat.charge'))); return; }
      if (d.etat === 'erreur') { liste.replaceChildren(el('p', { class: 'lg-msg ko', role: 'alert' }, mot('cat.erreur', { raison: d.raison }))); return; }
      const tout = pourOs(d.liste, Z.os);
      if (!tout.length) { liste.replaceChildren(el('p', { class: 'lg-msg', role: 'status' }, mot(`cat.vide.${o}`))); return; }
      const l = filtrer(tout, Z.filtre, Z.q, b.logiciels);
      liste.replaceChildren(...(l.length ? l.map((x) => {
        const pris = b.logiciels.some((y) => y.fichier === x.fichier), nom = propre(x.nom) || propre(x.fichier);
        return el('button', { type: 'button', class: 'lg-sw', role: 'checkbox', 'aria-checked': String(pris), 'data-f': `sw:${x.fichier}`, 'data-sw': propre(x.fichier), onclick: () => cocher(x) },
          el('span', { class: 'box' }, pris ? ic('check', 14, 3) : null),
          el('span', { class: 'lg-swi', style: `background:${teinte(nom)}`, 'aria-hidden': 'true' }, nom.slice(0, 2)),
          el('span', { class: 'lg-nm' }, el('b', {}, nom), el('small', {}, x.version ? mot('version', { v: propre(x.version) }) : propre(x.fichier))),
          el('span', { class: `lg-tag ${x.silencieux ? 'ok' : 'warn'}` }, mot(x.silencieux ? 'seul' : 'questions')));
      }) : [el('p', { class: 'lg-msg' }, mot('cat.rien'))]));
    }
    function catalogue(c) {
      const o = osCle(Z.os);
      const filtres = ['tout', 'seuls', 'questions', 'choisis'].map((f) => el('button', { type: 'button', class: 'lg-chip', 'aria-pressed': String(Z.filtre === f), 'data-f': `filtre-${f}`, 'data-filtre': f, onclick: () => { Z.filtre = f; redessiner(`filtre-${f}`); } }, mot(`f.${f}`)));
      const q = el('input', { class: 'lg-q', type: 'search', placeholder: mot('q'), 'aria-label': mot('q.nom'), 'data-f': 'recherche', oninput: (e) => { Z.q = String((e.currentTarget || e.target).value || ''); rendreListe(courant()); } });
      q.value = Z.q;
      rendreListe(c);
      return el('section', { class: 'lg-card', 'aria-label': mot(`os.${Z.os}`) }, el('div', { class: 'lg-chips lg-scroll', role: 'group', 'aria-label': mot('f.groupe') }, ...filtres), q, liste, el('p', { class: 'lg-note' }, mot(`cat.note.${o}`)));
    }
    function ordreBloc(c) {
      const b = c.b[Z.os], o = osCle(Z.os), dispo = Z.dispo[o];
      const connus = dispo.etat === 'pret' ? new Set(dispo.liste.map((x) => x.fichier)) : null;
      const seuls = b.logiciels.filter((x) => x.silencieux).length, q = b.logiciels.length - seuls;
      const kids = [el('h4', { 'data-f': 'ord-titre', tabindex: '-1' }, mot('ord.titre')),
        el('div', { class: 'lg-sum', 'data-f': 'resume' }, el('b', {}, nombre(seuls)), el('span', {}, mot(`ord.seuls.${forme(seuls)}`)), q ? el('span', { style: 'margin-left:8px' }, mot('ord.questions', { n: nombre(q) })) : null)];
      if (!b.logiciels.length) kids.push(el('p', { class: 'lg-note' }, mot('ord.vide')));
      b.logiciels.forEach((x, i) => {
        const nom = propre(x.nom) || propre(x.fichier), absent = connus && !connus.has(x.fichier);
        kids.push(el('div', { class: 'lg-item', 'data-ordre': propre(x.fichier) },
          el('span', { class: 'lg-ord' },
            el('button', { type: 'button', class: 'lg-ib', 'data-f': `ord-up-${i}`, 'aria-label': mot('ord.monter', { nom }), disabled: i === 0, onclick: () => ordre(i, -1) }, ic('up', 16)),
            el('button', { type: 'button', class: 'lg-ib', 'data-f': `ord-down-${i}`, 'aria-label': mot('ord.descendre', { nom }), disabled: i === b.logiciels.length - 1, onclick: () => ordre(i, 1) }, ic('down', 16))),
          el('span', { class: 'lg-nm' }, el('b', {}, nom), el('small', {}, mot(`ord.rang.${rang(i + 1)}`, { n: nombre(i + 1) }))),
          absent ? el('span', { class: 'lg-tag warn' }, mot('absent')) : !x.silencieux ? el('span', { class: 'lg-tag warn' }, mot('questions')) : null,
          el('button', { type: 'button', class: 'lg-ib', 'data-f': `ord-rm-${i}`, 'aria-label': mot('ord.retirer', { nom }), onclick: () => retirer(i) }, ic('x', 16))));
      });
      if (change(c)) {
        const attente = scriptsEnAttente(c), refuse = scriptsRefuses(c);
        kids.push(el('div', { class: 'lg-pend', role: 'status', 'data-f': 'changement' }, el('b', {}, mot(c.neuf ? 'chg.nouveau' : 'chg.titre', { nom: c.nom })),
          c.neuf ? null : el('button', { type: 'button', class: 'lg-btn', 'data-f': 'annuler', disabled: Z.occupe, onclick: () => annuler(c) }, mot('annuler')),
          el('button', { type: 'button', class: 'lg-btn pri', 'data-f': 'enregistrer', disabled: Z.occupe || attente || refuse, onclick: () => enregistrer(c) }, mot('enregistrer')),
          attente || refuse ? el('small', {}, mot(refuse ? 'aide.refuse' : 'aide.verif')) : null));
      }
      return el('section', { class: 'lg-card' }, ...kids);
    }
    function apercuBloc(c) {
      const a = Z.apercu[`${c.id}:${Z.os}:${Z.variante[Z.os] || ''}`], L = CL();
      const kids = [el('h4', {}, mot('apercu.titre')), el('p', { class: 'lg-lead' }, mot('apercu.lead'))];
      if (VARIANTES[Z.os]) kids.push(el('div', { class: 'lg-files', role: 'group', 'aria-label': mot('apercu.pour') }, ...VARIANTES[Z.os].map((v) => el('button', { type: 'button', 'aria-pressed': String(Z.variante[Z.os] === v), 'data-f': `var-${v}`, 'data-variante': v, onclick: () => { if (Z.variante[Z.os] !== v) { Z.variante[Z.os] = v; changer(`var-${v}`); } } }, mot(`var.${v}`)))));
      if (!L) kids.push(el('p', { class: 'lg-msg ko', role: 'alert' }, mot('pas.cle')));
      else if (a && a.etat === 'pret') {
        const noms = L.fichiersMontres(a.fichiers);
        if (!noms.includes(Z.vu[Z.os])) Z.vu[Z.os] = L.fichierDefaut(noms);
        const vu = Z.vu[Z.os];
        if (noms.length > 1) kids.push(el('div', { class: 'lg-files', role: 'group', 'aria-label': mot('apercu.fichiers') }, ...noms.map((n) => el('button', { type: 'button', 'aria-pressed': String(n === vu), 'data-f': `fic-${n}`, onclick: () => { Z.vu[Z.os] = n; redessiner(`fic-${n}`); } }, n))));
        // Le script est montré comme du TEXTE (textContent) : jamais interprété par la page.
        const pre = el('pre', { class: 'lg-code', tabindex: '0', 'aria-label': vu, 'data-apercu': vu });
        pre.textContent = String(a.fichiers[vu] ?? '');
        kids.push(pre);
      } else if (a && a.etat === 'erreur') kids.push(el('p', { class: 'lg-msg ko', role: 'alert' }, mot('apercu.erreur', { raison: a.raison })));
      else kids.push(el('p', { class: 'lg-msg', role: 'status' }, mot(a ? 'apercu.calcul' : 'apercu.rien')));
      // Tes scripts du système montré.
      const o = osCle(Z.os), b = c.b[Z.os];
      kids.push(el('div', { class: 'lg-h5' }, mot('scr.titre'), el('span', { class: 'lg-cnt' }, nombre(b.scripts.length))));
      if (!b.scripts.length) kids.push(el('p', { class: 'lg-note', style: 'margin:0' }, mot('scr.aucun')));
      b.scripts.forEach((x, k) => {
        const ligne = el('div', { class: `lg-item${x.etat === 'refuse' ? ' refuse' : ''}`, 'data-scr': x.nom },
          el('span', { class: 'lg-ord' },
            el('button', { type: 'button', class: 'lg-ib', 'data-f': `scr-up-${x.uid}`, 'aria-label': mot('scr.monter', { nom: x.nom }), disabled: k === 0, onclick: () => bougerScript(k, -1) }, ic('up', 16)),
            el('button', { type: 'button', class: 'lg-ib', 'data-f': `scr-down-${x.uid}`, 'aria-label': mot('scr.descendre', { nom: x.nom }), disabled: k === b.scripts.length - 1, onclick: () => bougerScript(k, 1) }, ic('down', 16))),
          el('span', { class: 'lg-nm' }, el('b', {}, x.nom), x.etat === 'refuse' ? el('small', { class: 'ko' }, x.raison) : el('small', {}, x.etat === 'verif' ? mot('scr.verif') : mot('scr.sous'))),
          x.etat === 'refuse' ? el('span', { class: 'lg-tag bad' }, mot('scr.refuse')) : null,
          el('button', { type: 'button', class: 'lg-ib', 'data-f': `scr-voir-${x.uid}`, 'aria-expanded': String(Z.voir === x.uid), 'aria-label': mot(Z.voir === x.uid ? 'scr.cacher' : 'scr.voir', { nom: x.nom }), onclick: () => { Z.voir = Z.voir === x.uid ? '' : x.uid; redessiner(`scr-voir-${x.uid}`); } }, ic('eye', 16)),
          el('button', { type: 'button', class: 'lg-ib', 'data-f': `scr-rm-${x.uid}`, 'aria-label': mot('scr.retirer', { nom: x.nom }), onclick: () => retirerScript(x.uid) }, ic('trash', 16)));
        if (Z.voir === x.uid) { const pre = el('pre', { class: 'lg-code', tabindex: '0', 'aria-label': x.nom }); pre.textContent = x.contenu; ligne.append(pre); }
        kids.push(ligne);
      });
      const choix = el('input', { type: 'file', accept: o === 'windows' ? '.ps1,.cmd,.bat' : '.sh', 'aria-label': mot('scr.choisir'), tabindex: '-1', 'data-f': 'scr-fichier', style: 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none', onchange: (e) => lireFichier(e.currentTarget || e.target) });
      kids.push(choix, el('button', { type: 'button', class: 'lg-btn lg-add', 'data-f': 'scr-ajouter', disabled: !L || b.scripts.length >= ((L && L.MAX_SCRIPTS) || 20), onclick: () => { if (typeof choix.click === 'function') choix.click(); } }, ic('plus', 15), mot(`scr.ajouter.${o}`)));
      // Le verdict de l'antivirus est dit une fois (région polie), pas répété à chaque redessin.
      kids.push(el('p', { role: 'status', 'aria-live': 'polite', 'data-f': 'scr-annonce', style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);margin:0' }, Z.annonce || ''));
      kids.push(el('p', { class: 'lg-note' }, mot('scr.note')));
      return el('section', { class: 'lg-card' }, ...kids);
    }

    /** Tout redessiner ; le focus revient sur le même contrôle (comparé par valeur : aucun nom n'entre dans un sélecteur). */
    function redessiner(focus) {
      // (La page est d'abord dessinée hors du document, puis greffée par Genèse : on dessine toujours.)
      const a = typeof document !== 'undefined' ? document.activeElement : null;
      const garde = focus || (a && wrap.contains(a) && a.getAttribute ? a.getAttribute('data-f') : '');
      const c = courant();
      if (!CL()) { wrap.replaceChildren(el('section', { class: 'lg-card' }, el('p', { class: 'lg-msg ko', role: 'alert' }, mot('pas.cle')))); return; }
      wrap.replaceChildren(haut(c), el('div', { class: 'lg-grid' }, catalogue(c), el('div', { class: 'lg-col' }, ordreBloc(c), apercuBloc(c))));
      if (garde) { const n = Array.from(wrap.querySelectorAll('[data-f]')).find((x) => x.getAttribute('data-f') === garde); if (n && n.focus) n.focus(); }
    }
    wrap.replaceChildren(el('p', { class: 'lg-msg', role: 'status' }, mot('prof.charge')));
    await lireProfils();
    redessiner();
    void rafraichir();
  }

  W.OdinGeneseLogiciels = { onglets: [['logiciels', MOTS.onglet]], dessiner, MOTS, logique, etat: Z };
})();
