// Genèse · Clés USB — la fin du parcours de la maquette validée « Clés USB » (lot C4) :
//   - étape 6 « Vérifier » : le récapitulatif (clé, façon, systèmes, logiciels et scripts, options Windows), chacun avec
//     « Changer » ; le plan de place du serveur (ce qui est effacé, ce qui reste) ; le fichier de réponses Windows,
//     résumé en clair au-dessus et montré TEL QUEL, replié derrière « Voir le fichier exact » ; puis la confirmation :
//     la phrase à taper (donnée par le serveur) ET un appui long de 3 s. Les deux sont exigés ; la vraie vérification
//     (phrase, numéro de série, taille, disque choisissable) reste au serveur (cle_preparer) ;
//   - l'écran d'écriture : les étapes nommées (cle_progres), la progression, « Annuler » avec une confirmation qui dit si
//     la clé est déjà touchée (cle_annuler) ;
//   - l'écran de fin : Odin content, « Éjecter la clé » (cle_ejecter), et les touches de démarrage des PC.
// Tous les textes sont dans MOTS ; nombres selon la langue de la page (Intl). TOUT passe par OdinDialog.
// Expose window.OdinGeneseCleSuivi = { MOTS, logique, rendre(n, outils), verrouille(), etat }.
(() => {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;

  // ---------------------------------------------------------------- les mots
  const MOTS = {
    'v.titre': 'Vérifier avant d\'écrire',
    'v.lead': 'Relis tout. Rien n\'est encore écrit : tu peux encore tout changer.',
    'v.changer': 'Changer',
    'v.changer.de': 'Changer : {quoi}',
    'r.cle': 'Clé', 'r.disque': 'Disque', 'r.facon': 'Façon', 'r.systemes': 'Systèmes', 'r.logiciels': 'Logiciels et scripts', 'r.windows': 'Options Windows',
    'r.cle.val': '{nom} · {taille}', 'r.serie': 'numéro {serie}',
    'r.facon.iso': 'Clé de démarrage, plusieurs ISO', 'r.facon.installes': 'Systèmes installés', 'r.facon.deux': 'Les deux',
    'r.logiciels.val': '{n} logiciel(s) · {s} script(s)', 'r.aucun': 'Aucun',
    'choix.iso': 'ISO qui démarre', 'choix.persistance': 'ISO + mémoire', 'choix.installe': 'Installé', 'choix.vm': 'Copie de VM',
    'p.titre': 'Ce qui va se passer sur la clé',
    'p.charge': 'Odin calcule la place…',
    'p.erreur': 'Le plan n\'a pas pu être calculé : {raison}',
    'p.efface': 'Tout ce qui est sur la clé sera effacé.',
    'p.efface.disque': 'Tout ce qui est sur le disque sera effacé.',
    'p.garde': 'Rien n\'est effacé : la clé est déjà ODIN, seuls ses fichiers changent.',
    'p.reste': 'Il restera environ {go} Go libres.',
    'p.role.ISO ODIN': 'Partition ODIN (ISO, mémoires, disques)', 'p.role.WinToGo': 'Windows installé (fichier sur la partition ODIN)', 'p.role.Linux installé': 'Linux installé (sa partition)', 'p.role.persistance': 'Mémoire d\'un système (fichier)',
    'p.go': '{go} Go',
    'w.titre': 'Le fichier de réponses de Windows',
    'w.lead': 'Ce que Windows fera tout seul pendant l\'installation :',
    'w.exigences.oui': 'Il s\'installe même sans les exigences matérielles (puce de sécurité, démarrage sécurisé, mémoire).',
    'w.exigences.non': 'Les exigences matérielles sont gardées.',
    'w.local.oui': 'Un compte local « {nom} », sans compte en ligne. Aucun mot de passe n\'est écrit sur la clé : il est choisi à la première ouverture de session.',
    'w.local.non': 'Windows demande lui-même le compte à utiliser.',
    'w.vie.oui': 'Les questions de confidentialité sont passées, au plus discret.',
    'w.vie.non': 'Windows pose lui-même les questions de confidentialité.',
    'w.langue.oui': 'Langue, clavier et fuseau repris d\'Odin.',
    'w.langue.non': 'Windows demande la langue, le clavier et le fuseau.',
    'w.disque': 'Le disque du PC est choisi au moment d\'installer : aucun disque n\'est effacé tout seul.',
    'w.act.oui': 'La clé d\'activation du coffre est mise (jamais montrée en entier).',
    'w.act.non': 'Aucune clé d\'activation.',
    'w.voir': 'Voir le fichier exact',
    'w.charge': 'Odin prépare le fichier…',
    'w.erreur': 'Le fichier n\'a pas pu être montré : {raison}',
    'c.titre': 'Écrire la clé',
    'c.titre.disque': 'Écrire le disque',
    'c.phrase': 'Pour confirmer, tape exactement :',
    'c.phrase.label': 'La phrase de confirmation',
    'c.phrase.ok': 'Phrase juste.',
    'c.phrase.ko': 'La phrase n\'est pas encore juste.',
    'c.appui': 'Garde appuyé 3 secondes pour écrire',
    'c.appui.aide': 'Garde le bouton enfoncé (doigt, souris, ou touche Espace) pendant 3 secondes. Relâcher avant arrête tout.',
    'c.appui.encore': 'Encore {s} s…',
    'c.appui.lache': 'Relâché trop tôt : rien n\'est écrit.',
    'c.appui.ferme': 'Tape d\'abord la phrase.',
    'c.envoi': 'Odin revérifie la clé et commence…',
    'e.titre': 'Odin écrit la clé',
    'e.lead': 'Ne débranche pas la clé. Tu peux changer de page : l\'écriture continue.',
    'e.pct': '{pct} %',
    'e.annuler': 'Annuler l\'écriture',
    'e.annuler.rien': 'Rien n\'est encore écrit sur la clé. Arrêter maintenant ?',
    'e.annuler.touchee': 'La clé est déjà en partie écrite : si tu arrêtes, elle ne démarrera pas tant que tu ne recommences pas. Ce qui était dessus avant est déjà perdu. Arrêter quand même ?',
    'e.annuler.ok': 'Arrêter',
    'e.annuler.non': 'Continuer l\'écriture',
    'e.annulee': 'Arrêt demandé : Odin s\'arrête au prochain fichier.',
    'e.attente': 'Odin attend la réponse…',
    'phase.verifier': 'Revérifier la clé', 'phase.chargeur': 'Préparer le démarrage', 'phase.systemes': 'Copier les systèmes', 'phase.logiciels': 'Copier les logiciels',
    'phase.installes': 'Systèmes installés', 'phase.menu': 'Menu et écran d\'Odin', 'phase.scripts': 'Réponses et tes scripts', 'phase.controle': 'Tout relire',
    'etat.fait': 'fait', 'etat.encours': 'en cours', 'etat.attente': 'à venir', 'etat.erreur': 'arrêté',
    'f.titre': 'Ta clé ODIN est prête',
    'f.lead': 'Tout a été écrit puis relu.',
    'f.ejecter': 'Éjecter la clé',
    'f.ejecter.encours': 'Odin éjecte la clé…',
    'f.ejectee': 'Clé éjectée : tu peux la retirer.',
    'f.ejecter.ko': 'Éjection impossible : {raison}',
    'f.demarrer': 'Démarrer un PC sur la clé',
    'f.etape.1': 'Branche la clé sur le PC éteint.',
    'f.etape.2': 'Allume-le et appuie tout de suite, plusieurs fois, sur la touche du menu de démarrage.',
    'f.etape.3': 'Choisis la clé ODIN dans la liste : le menu d\'Odin s\'ouvre.',
    'f.touches': 'La touche selon la marque',
    'f.touches.autre': 'Autre marque : regarde l\'écran au démarrage, la touche y est souvent écrite.',
    'f.autre': 'Préparer une autre clé',
    'x.titre': 'L\'écriture s\'est arrêtée',
    'x.touchee': 'La clé est en partie écrite : elle ne démarrera pas tant que tu ne recommences pas.',
    'x.rien': 'Rien n\'a été écrit sur la clé.',
    'x.retour': 'Revenir à « Vérifier »',
  };
  const mot = (k, v) => String(MOTS[k] ?? k).replace(/\{(\w+)\}/g, (_m, x) => (v && v[x] != null ? String(v[x]) : ''));
  const langue = () => { try { return (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || undefined; } catch { return undefined; } };
  const nombre = (n) => { try { return new Intl.NumberFormat(langue()).format(n); } catch { return String(n); } };

  // ---------------------------------------------------------------- la logique (pure)
  const APPUI_MS = 3000;
  const PHASES = ['verifier', 'chargeur', 'systemes', 'logiciels', 'installes', 'menu', 'scripts', 'controle'];
  /** Même règle que le serveur (cle-ecrire.ts, phraseNormale) : sans accents, minuscules, espaces simples. */
  const phraseNormale = (x) => String(x == null ? '' : x).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const phraseOk = (saisie, attendue) => Boolean(attendue) && phraseNormale(saisie) === phraseNormale(attendue);
  /** On n'écrit QUE si la phrase est juste ET que l'appui a duré 3 s : l'un sans l'autre ne suffit jamais. */
  const peutEcrire = (o) => Boolean(o && o.phraseOk === true && Number(o.appuiMs) >= APPUI_MS);
  /** Les secondes qui restent à tenir (pour l'annonce). */
  const resteAppui = (ms) => Math.max(0, Math.ceil((APPUI_MS - Math.max(0, Number(ms) || 0)) / 1000));
  /** Le résumé en clair des options Windows (ce que le fichier de réponses fera). */
  function resumeWindows(w, activation) {
    const o = w || {};
    return [
      mot(o.exigences === false ? 'w.exigences.non' : 'w.exigences.oui'),
      o.local === false ? mot('w.local.non') : mot('w.local.oui', { nom: String(o.compte || 'Odin').trim() || 'Odin' }),
      mot(o.viePrivee === false ? 'w.vie.non' : 'w.vie.oui'),
      mot(o.langue === false ? 'w.langue.non' : 'w.langue.oui'),
      mot('w.disque'),
      mot(activation ? 'w.act.oui' : 'w.act.non'),
    ];
  }
  /** L'état de chaque étape nommée de l'écriture, d'après la réponse de cle_progres. */
  function etatsPhases(p) {
    const liste = Array.isArray(p && p.phases) && p.phases.length ? p.phases : PHASES;
    const i = liste.indexOf(p && p.phase);
    return liste.map((id, k) => {
      if (p && p.fini && p.reussi) return { id, etat: 'fait' };
      if (k < i) return { id, etat: 'fait' };
      if (k === i) return { id, etat: p && p.fini ? 'erreur' : 'encours' };
      return { id, etat: 'attente' };
    });
  }
  /** Le texte de la confirmation d'« Annuler » : il dit si la clé est déjà touchée. */
  const texteAnnuler = (touchee) => mot(touchee ? 'e.annuler.touchee' : 'e.annuler.rien');
  /** Les touches du menu de démarrage, par marque (les plus courantes). */
  const TOUCHES = [['Acer', 'F12'], ['Asus', 'F8 · Échap'], ['Dell', 'F12'], ['HP', 'F9 · Échap'], ['Lenovo', 'F12 · Fn + F12'], ['MSI', 'F11'], ['Samsung', 'F10 · Échap'], ['Toshiba', 'F12'], ['Mac', 'Option (⌥)']];
  /** La cible telle qu'elle part au serveur : son identifiant, son numéro de série, sa taille, son modèle (rien d'autre). */
  const cibleDe = (d) => (d ? { id: d.id, ...(d.serie ? { serie: d.serie } : {}), tailleOctets: Number(d.tailleOctets) || 0, ...(d.modele ? { modele: d.modele } : {}) } : null);

  const logique = { MOTS, mot, APPUI_MS, PHASES, phraseNormale, phraseOk, peutEcrire, resteAppui, resumeWindows, etatsPhases, texteAnnuler, TOUCHES, cibleDe };

  // ---------------------------------------------------------------- l'état
  const Z = {
    ecran: 'verifier', plan: { etat: 'rien', data: null, sig: '' }, xml: { etat: 'rien', texte: '', act: false, sig: '' }, saisie: '', msg: '',
    appui: { debut: 0, minuteur: 0, fini: false }, cible: null, progres: null, suivi: 0, envoi: false, eject: { etat: '', texte: '' }, ouvert: false,
  };
  let O = null;
  const dialog = () => (typeof W.OdinDialog === 'object' && W.OdinDialog) || { confirm: async () => false, alert: async () => {} };

  // ---------------------------------------------------------------- outils de dessin
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(typeof c === 'object' ? c : document.createTextNode(String(c)));
    return n;
  };
  const P = {
    check: 'M5 12l5 5L20 7', warn: 'M12 4l9 16H3zM12 10v4M12 17h.01', edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4', key: 'M8 2h8v6h-8zM6 8h12v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM10 4v2M14 4v2',
    stop: 'M7 7h10v10H7z', eject: 'M12 5l7 8H5zM5 17h14v2H5z', dot: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', left: 'M15 6l-6 6 6 6', file: 'M6 3h8l4 4v14H6zM14 3v4h4', plus: 'M12 5v14M5 12h14',
  };
  const ic = (n, s = 18, w = 2) => { const v = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); v.setAttribute('viewBox', '0 0 24 24'); v.setAttribute('width', s); v.setAttribute('height', s); v.setAttribute('aria-hidden', 'true'); v.innerHTML = `<path d="${P[n]}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`; return v; };

  const CSS = `
.ckv-rec{display:grid;gap:0;margin:0}
.ckv-rec>div{display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-top:1px solid var(--line)}
.ckv-rec>div:first-child{border-top:none;padding-top:4px}
.ckv-rec dt{width:150px;flex:none;font-size:12.5px;color:var(--muted);font-weight:600;padding-top:2px}
.ckv-rec dd{margin:0;flex:1;min-width:0;font-size:14px;overflow-wrap:anywhere}
.ckv-rec dd small{display:block;color:var(--muted);font-size:12.5px;margin-top:2px}
.ckv-rec ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px}
.ckv-rec .ck-btn{flex:none;min-height:44px;padding:0 12px}
.ckv-parts{display:flex;flex-direction:column;gap:6px;margin:10px 0 0;padding:0;list-style:none;font-size:13.5px}
.ckv-parts li{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
.ckv-parts b{font-variant-numeric:tabular-nums}
.ckv-alerte{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:12px;border:1.5px solid var(--bad);background:color-mix(in srgb,var(--bad) 8%,var(--panel));font-size:13.5px;font-weight:600;margin-top:10px}
.ckv-alerte.calm{border-color:var(--good);background:color-mix(in srgb,var(--good) 8%,var(--panel));font-weight:500}
.ckv-alerte svg{flex:none;margin-top:1px}
.ckv-w{margin:8px 0 0;padding-left:18px;font-size:13.5px;display:flex;flex-direction:column;gap:4px}
.ckv-voir{margin-top:12px;border:1px solid var(--line);border-radius:12px;background:color-mix(in srgb,var(--ink) 3%,var(--panel))}
.ckv-voir summary{cursor:pointer;min-height:44px;display:flex;align-items:center;gap:8px;padding:0 12px;font-weight:600;font-size:14px;list-style:none}
.ckv-voir summary::-webkit-details-marker{display:none}
.ckv-voir pre{margin:0;padding:12px;max-height:360px;overflow:auto;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;border-top:1px solid var(--line)}
.ckv-conf{border:2px solid var(--bad);border-radius:18px;padding:18px;background:var(--panel)}
.ckv-conf h4{margin:0 0 8px;font-size:17px}
.ckv-phrase{display:inline-block;margin:4px 0 10px;padding:6px 10px;border-radius:10px;background:color-mix(in srgb,var(--bad) 10%,transparent);font:700 15px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere;user-select:all}
.ckv-in{display:block;width:100%;box-sizing:border-box;min-height:48px;border-radius:12px;border:1.5px solid var(--line);background:var(--bg);color:var(--ink);font:500 16px inherit;padding:0 14px}
.ckv-in:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 25%,transparent)}
.ckv-in.ok{border-color:var(--good)}
.ckv-etat{display:block;font-size:12.5px;margin:6px 0 14px;color:var(--muted)}.ckv-etat.ok{color:var(--good);font-weight:600}
.ckv-appui{position:relative;overflow:hidden;width:100%;min-height:56px;border-radius:14px;border:none;background:var(--bad);color:#fff;font:700 15px inherit;cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none}
.ckv-appui:disabled{opacity:.45;cursor:not-allowed}
.ckv-appui:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.ckv-appui .ckv-remplir{position:absolute;inset:0 auto 0 0;width:0;background:color-mix(in srgb,#000 28%,transparent)}
.ckv-appui .ckv-txt{position:relative;display:inline-flex;align-items:center;gap:8px;justify-content:center;padding:0 12px}
.ckv-aide{display:block;font-size:12.5px;color:var(--muted);margin-top:8px}
.ckv-annonce{display:block;font-size:13px;margin-top:6px;min-height:1.2em;font-weight:600}
.ckv-phases{list-style:none;margin:14px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}
.ckv-phases li{display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:12px;border:1px solid var(--line);font-size:13.5px}
.ckv-phases i{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;flex:none;background:color-mix(in srgb,var(--ink) 7%,transparent);color:var(--muted)}
.ckv-phases li[data-etat=fait] i{background:var(--good);color:#fff}
.ckv-phases li[data-etat=encours]{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.ckv-phases li[data-etat=encours] i{background:var(--accent);color:var(--on-accent,#fff)}
.ckv-phases li[data-etat=erreur]{border-color:var(--bad)}.ckv-phases li[data-etat=erreur] i{background:var(--bad);color:#fff}
.ckv-phases small{display:block;color:var(--muted);font-size:11.5px}
.ckv-barre{height:14px;border-radius:7px;background:color-mix(in srgb,var(--ink) 9%,transparent);overflow:hidden;margin-top:14px}
.ckv-barre span{display:block;height:100%;background:var(--accent);transition:width .4s}
.ckv-pct{display:flex;justify-content:space-between;gap:10px;font-size:13px;margin-top:6px;flex-wrap:wrap}.ckv-pct b{font-variant-numeric:tabular-nums}
.ckv-fin{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.ckv-fin>div{flex:1;min-width:200px}.ckv-fin h4{margin:0;font-size:19px}.ckv-fin p{margin:4px 0 0;font-size:13.5px;color:var(--muted)}
.ckv-fin .ck-odin{width:88px;height:88px}
.ckv-ol{margin:8px 0 0;padding-left:20px;font-size:13.5px;display:flex;flex-direction:column;gap:4px}
.ckv-touches{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;margin:8px 0 0;padding:0;list-style:none}
.ckv-touches li{display:flex;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:10px;border:1px solid var(--line);font-size:13px}
.ckv-touches kbd{font:700 12.5px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap}
@media (max-width:640px){
  .ckv-rec>div{flex-wrap:wrap}.ckv-rec dt{width:100%}
  .ckv-conf{padding:14px}
}
@media (prefers-reduced-motion:reduce){.ckv-barre span{transition:none}}
`;

  // ---------------------------------------------------------------- lectures au serveur
  const systemes = () => (O && typeof O.composes === 'function' ? O.composes() || [] : []);
  const suite = () => (O && typeof O.suite === 'function' ? O.suite(systemes()) : null);
  async function lirePlan() {
    const cible = cibleDe(O && O.cle), sys = (suite() || {}).systemes || systemes();
    const sig = JSON.stringify([cible, sys]);
    if (!cible || Z.plan.sig === sig) return;
    Z.plan = { etat: 'charge', data: null, sig };
    let r; try { r = await O.post('cle_place', { cible, systemes: sys }); } catch (e) { r = { ok: false, text: String(e && e.message || e) }; }
    if (Z.plan.sig !== sig) return;
    Z.plan = r && r.data && typeof r.data.possible === 'boolean' ? { etat: 'pret', data: r.data, sig } : { etat: 'erreur', data: null, raison: (r && r.text) || '?', sig };
    if (O) O.redessiner();
  }
  async function lireXml() {
    const s = suite(), win = (s && s.systemes || []).find((x) => x.famille === 'windows');
    if (!win || !s.windows) { Z.xml = { etat: 'rien', texte: '', act: false, sig: '' }; return; }
    const entree = { systeme: { famille: 'windows', nom: win.nom, fichier: win.fichier }, logiciels: (win.logiciels || []).map((l) => ({ id: l.id, fichier: l.fichier })), scripts: (s.scripts || []).filter((x) => x.os === 'windows').map((x) => ({ nom: x.nom, contenu: x.contenu })), windows: s.windows };
    const sig = JSON.stringify(entree);
    if (Z.xml.sig === sig) return;
    Z.xml = { etat: 'charge', texte: '', act: false, sig };
    let r; try { r = await O.post('cle_apercu_script', entree); } catch (e) { r = { ok: false, text: String(e && e.message || e) }; }
    if (Z.xml.sig !== sig) return;
    const t = r && r.data && r.data.fichiers && r.data.fichiers['autounattend.xml'];
    Z.xml = typeof t === 'string' ? { etat: 'pret', texte: t, act: Boolean(r.data.activation), sig } : { etat: 'erreur', texte: '', raison: (r && r.text) || '?', act: false, sig };
    if (O) O.redessiner();
  }

  // ---------------------------------------------------------------- étape 6 : Vérifier
  function ligne(dt, dd, aller, quoi) {
    return el('div', {}, el('dt', {}, dt), el('dd', {}, dd),
      aller ? el('button', { type: 'button', class: 'ck-btn', 'data-f': `changer-${aller}`, 'aria-label': mot('v.changer.de', { quoi: dt }), onclick: () => O.aller(aller) }, ic('edit', 16), mot('v.changer')) : null);
  }
  function recap() {
    const v = O.vue || {}, s = suite(), sys = (s && s.systemes) || systemes(), disque = O.sorte === 'disque';
    const nbLog = sys.reduce((n, x) => n + ((x.logiciels || []).length), 0), nbScr = ((s && s.scripts) || []).length;
    const dl = el('dl', { class: 'ckv-rec' },
      ligne(mot(disque ? 'r.disque' : 'r.cle'), [mot('r.cle.val', { nom: v.nom || '', taille: v.taille || '' }), v.serieCourte ? el('small', {}, mot('r.serie', { serie: v.serieCourte })) : null], 1),
      ligne(mot('r.facon'), mot(`r.facon.${O.facon || 'iso'}`), 2),
      ligne(mot('r.systemes'), sys.length ? el('ul', {}, ...sys.map((x) => el('li', {}, el('b', {}, x.nom), ` · ${mot(`choix.${x.choix || 'iso'}`)}`))) : mot('r.aucun'), 3),
      ligne(mot('r.logiciels'), mot('r.logiciels.val', { n: nombre(nbLog), s: nombre(nbScr) }), 4));
    if (O.avecWindows && s && s.windows) dl.append(ligne(mot('r.windows'), el('ul', {}, ...resumeWindows(s.windows, Z.xml.act).slice(0, 3).map((t) => el('li', {}, t))), 5));
    return el('section', { class: 'ck-card' }, el('h4', {}, mot('v.titre')), el('p', { class: 'ck-lead' }, mot('v.lead')), dl);
  }
  function cartePlan() {
    const sec = el('section', { class: 'ck-card', 'aria-live': 'polite' }, el('h4', {}, mot('p.titre')));
    if (Z.plan.etat === 'erreur') { sec.append(el('p', { class: 'ck-msg ko', role: 'alert' }, mot('p.erreur', { raison: Z.plan.raison }))); return sec; }
    if (Z.plan.etat !== 'pret') { sec.append(el('p', { class: 'ck-msg', role: 'status' }, mot('p.charge'))); return sec; }
    const p = Z.plan.data;
    if (!p.possible) { sec.append(el('p', { class: 'ck-msg ko', role: 'alert' }, p.blocage || '')); return sec; }
    sec.append(...[el('ul', { class: 'ckv-parts' }, ...p.partitions.map((x) => el('li', {}, el('span', {}, mot(`p.role.${x.role}`)), el('b', {}, mot('p.go', { go: nombre(x.tailleGo) }))))),
      p.resteGo > 0 ? el('p', { class: 'ck-msg', style: 'margin:8px 0 0' }, mot('p.reste', { go: nombre(p.resteGo) })) : null,
      p.efface !== false
        ? el('div', { class: 'ckv-alerte', role: 'alert' }, ic('warn', 18), el('span', {}, mot(O.sorte === 'disque' ? 'p.efface.disque' : 'p.efface')))
        : el('div', { class: 'ckv-alerte calm' }, ic('check', 18), el('span', {}, mot('p.garde')))].filter(Boolean));
    return sec;
  }
  function carteWindows() {
    const s = suite();
    if (!O.avecWindows || !s || !s.windows) return null;
    const voir = el('details', { class: 'ckv-voir', 'data-f': 'voir-xml', ...(Z.ouvert ? { open: true } : {}), ontoggle: (e) => { Z.ouvert = Boolean(e.currentTarget && e.currentTarget.open); } },
      el('summary', {}, ic('file', 16), mot('w.voir')),
      Z.xml.etat === 'pret' ? el('pre', { 'data-xml': 'autounattend.xml', tabindex: '0' }, Z.xml.texte)
        : el('p', { class: Z.xml.etat === 'erreur' ? 'ck-msg ko' : 'ck-msg', style: 'margin:0;padding:12px' }, Z.xml.etat === 'erreur' ? mot('w.erreur', { raison: Z.xml.raison }) : mot('w.charge')));
    return el('section', { class: 'ck-card' }, el('h4', {}, mot('w.titre')), el('p', { class: 'ck-lead', style: 'margin:0' }, mot('w.lead')),
      el('ul', { class: 'ckv-w' }, ...resumeWindows(s.windows, Z.xml.act).map((t) => el('li', {}, t))), voir);
  }
  function confirmation() {
    const attendue = Z.plan.etat === 'pret' && Z.plan.data && Z.plan.data.possible ? String(Z.plan.data.phrase || '') : '';
    const juste = phraseOk(Z.saisie, attendue);
    const etat = el('span', { class: `ckv-etat${juste ? ' ok' : ''}`, id: 'ckv-etat', role: 'status' }, Z.saisie ? mot(juste ? 'c.phrase.ok' : 'c.phrase.ko') : '');
    const annonce = el('span', { class: 'ckv-annonce', role: 'status', 'aria-live': 'assertive', 'data-f': 'annonce' }, Z.msg);
    const remplir = el('span', { class: 'ckv-remplir' });
    const bouton = el('button', { type: 'button', class: 'ckv-appui', 'data-f': 'ecrire', disabled: !juste || Z.envoi, 'aria-describedby': 'ckv-appui-aide' }, remplir, el('span', { class: 'ckv-txt' }, ic('key'), mot(Z.envoi ? 'c.envoi' : 'c.appui')));
    const champ = el('input', { class: `ckv-in${juste ? ' ok' : ''}`, id: 'ckv-phrase', 'data-f': 'phrase', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-describedby': 'ckv-etat', disabled: Z.envoi || !attendue });
    champ.value = Z.saisie;
    champ.addEventListener('input', () => {
      Z.saisie = champ.value; const ok = phraseOk(Z.saisie, attendue);
      champ.className = `ckv-in${ok ? ' ok' : ''}`; etat.className = `ckv-etat${ok ? ' ok' : ''}`; etat.textContent = Z.saisie ? mot(ok ? 'c.phrase.ok' : 'c.phrase.ko') : '';
      bouton.disabled = !ok || Z.envoi;
    });
    // L'appui long : doigt, souris ou touche (Espace, Entrée). Relâcher avant 3 s arrête tout ; rien n'est envoyé.
    const commencer = (e) => {
      if (bouton.disabled || Z.appui.minuteur) return;
      if (e && e.preventDefault) e.preventDefault();
      Z.appui = { debut: Date.now(), minuteur: 0, fini: false }; Z.msg = '';
      let dit = -1;
      Z.appui.minuteur = setInterval(() => {
        const ms = Date.now() - Z.appui.debut;
        remplir.style.width = `${Math.min(100, (ms / APPUI_MS) * 100)}%`;
        const r = resteAppui(ms); if (r !== dit && r > 0) { dit = r; annonce.textContent = mot('c.appui.encore', { s: nombre(r) }); }
        if (peutEcrire({ phraseOk: phraseOk(Z.saisie, attendue), appuiMs: ms })) { clearInterval(Z.appui.minuteur); Z.appui = { debut: 0, minuteur: 0, fini: true }; void lancer(attendue); }
      }, 50);
    };
    const arreter = () => {
      if (!Z.appui.minuteur) return;
      clearInterval(Z.appui.minuteur); Z.appui = { debut: 0, minuteur: 0, fini: false };
      remplir.style.width = '0'; annonce.textContent = mot('c.appui.lache');
    };
    bouton.addEventListener('pointerdown', commencer);
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) bouton.addEventListener(ev, arreter);
    bouton.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) commencer(e); else if (e.key === ' ' || e.key === 'Enter') e.preventDefault(); });
    bouton.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') arreter(); });
    bouton.addEventListener('contextmenu', (e) => e.preventDefault());
    return el('section', { class: 'ckv-conf' }, el('h4', {}, mot(O.sorte === 'disque' ? 'c.titre.disque' : 'c.titre')),
      el('label', { for: 'ckv-phrase', style: 'display:block;font-size:13.5px' }, mot('c.phrase')),
      attendue ? el('span', { class: 'ckv-phrase', 'data-phrase': attendue, translate: 'no' }, attendue) : el('p', { class: 'ck-msg' }, mot('p.charge')),
      champ, etat, bouton, el('small', { class: 'ckv-aide', id: 'ckv-appui-aide' }, juste ? mot('c.appui.aide') : mot('c.appui.ferme')), annonce);
  }
  function etapeVerifier() {
    void lirePlan(); void lireXml();
    return [recap(), cartePlan(), carteWindows(), confirmation(), O.pied(O.avecWindows ? 5 : 4, 0, false, '')];
  }

  // ---------------------------------------------------------------- écriture
  async function lancer(attendue) {
    if (Z.envoi || !O) return;
    Z.envoi = true; O.redessiner('ecrire');
    const s = suite() || {};
    const cible = cibleDe(O.cle);
    let r; try { r = await O.post('cle_preparer', { cible, systemes: s.systemes || systemes(), windows: s.windows || null, scripts: s.scripts || [], phrase: Z.saisie || attendue }, true); } catch (e) { r = { ok: false, text: String(e && e.message || e) }; }
    Z.envoi = false;
    if (!r || r.ok === false) { Z.msg = (r && r.text) || '?'; Z.saisie = ''; if (O) O.redessiner('phrase'); return; }
    Z.cible = cible; Z.ecran = 'ecriture'; Z.progres = null; Z.saisie = ''; Z.msg = '';
    if (O) O.redessiner('annuler');
    suivre();
  }
  function suivre() {
    if (Z.suivi) clearInterval(Z.suivi);
    const tour = async () => {
      if (!Z.cible || !O) return;
      let r; try { r = await O.post('cle_progres', { cible: Z.cible }); } catch { return; }
      if (!r || !r.data) return;
      Z.progres = r.data;
      if (r.data.fini) {
        clearInterval(Z.suivi); Z.suivi = 0;
        Z.ecran = r.data.reussi ? 'fin' : 'echec';
        if (Z.ecran === 'fin') try { const m = O.wrap && O.wrap.querySelector && O.wrap.querySelector('.ckv-fin .ck-odin'); if (m && W.OdinFace && W.OdinFace.flash) W.OdinFace.flash(m.querySelector('svg') || m, 'joie', 4000); } catch { /* le dessin reste */ }
      }
      if (O && (!O.wrap || O.wrap.isConnected !== false)) O.redessiner(Z.ecran === 'fin' ? 'ejecter' : undefined);
    };
    Z.suivi = setInterval(() => { void tour(); }, 700);
    void tour();
  }
  async function annuler() {
    const touchee = Boolean(Z.progres && Z.progres.touchee);
    const ok = await dialog().confirm(texteAnnuler(touchee), { danger: true, ok: mot('e.annuler.ok'), annuler: mot('e.annuler.non') });
    if (!ok || !O || !Z.cible) return;
    try { await O.post('cle_annuler', { cible: Z.cible }); } catch { /* le suivi dira */ }
    Z.msg = mot('e.annulee'); O.redessiner('annuler');
  }
  function ecranEcriture() {
    const p = Z.progres || { pct: 0, etape: '', phase: 'verifier', phases: PHASES };
    const pct = Math.max(0, Math.min(100, Number(p.pct) || 0));
    return [el('section', { class: 'ck-card' },
      el('h4', {}, mot('e.titre')), el('p', { class: 'ck-lead', style: 'margin:0' }, mot('e.lead')),
      el('div', { class: 'ckv-barre', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': mot('e.titre') }, el('span', { style: `width:${pct}%` })),
      el('div', { class: 'ckv-pct', role: 'status', 'aria-live': 'polite' }, el('span', {}, Z.progres ? (p.etape || mot(`phase.${p.phase}`)) : mot('e.attente')), el('b', {}, mot('e.pct', { pct: nombre(pct) }))),
      el('ol', { class: 'ckv-phases', 'aria-label': mot('e.titre') }, ...etatsPhases(p).map((x, k) => el('li', { 'data-etat': x.etat, 'data-phase': x.id, ...(x.etat === 'encours' ? { 'aria-current': 'step' } : {}) },
        el('i', {}, x.etat === 'fait' ? ic('check', 14, 3) : x.etat === 'erreur' ? ic('stop', 12, 3) : nombre(k + 1)), el('span', {}, mot(`phase.${x.id}`), el('small', {}, mot(`etat.${x.etat}`)))))),
      Z.msg ? el('p', { class: 'ck-msg', role: 'status', style: 'margin:12px 0 0' }, Z.msg) : null,
      el('div', { class: 'ck-row' }, el('button', { type: 'button', class: 'ck-btn', 'data-f': 'annuler', disabled: Boolean(p.annulee), onclick: () => { void annuler(); } }, ic('stop'), mot('e.annuler'))))];
  }

  // ---------------------------------------------------------------- fin
  async function ejecter() {
    if (!O || !Z.cible || Z.eject.etat === 'encours') return;
    Z.eject = { etat: 'encours', texte: mot('f.ejecter.encours') }; O.redessiner('ejecter');
    let r; try { r = await O.post('cle_ejecter', { cible: Z.cible }); } catch (e) { r = { ok: false, text: String(e && e.message || e) }; }
    Z.eject = r && r.ok !== false ? { etat: 'ok', texte: mot('f.ejectee') } : { etat: 'ko', texte: mot('f.ejecter.ko', { raison: (r && r.text) || '?' }) };
    O.redessiner('ejecter');
  }
  function recommencer() {
    if (Z.suivi) clearInterval(Z.suivi);
    Object.assign(Z, { ecran: 'verifier', progres: null, cible: null, suivi: 0, eject: { etat: '', texte: '' }, msg: '', saisie: '', plan: { etat: 'rien', data: null, sig: '' } });
  }
  function ecranFin() {
    const m = O.mascotte ? O.mascotte() : el('span', { class: 'ck-odin', 'aria-hidden': 'true' });
    return [el('section', { class: 'ck-card ckv-fin' }, m, el('div', {}, el('h4', {}, mot('f.titre')), el('p', {}, mot('f.lead')),
      el('div', { class: 'ck-row' },
        el('button', { type: 'button', class: 'ck-btn pri', 'data-f': 'ejecter', disabled: Z.eject.etat === 'encours' || Z.eject.etat === 'ok', onclick: () => { void ejecter(); } }, ic('eject'), mot('f.ejecter')),
        el('button', { type: 'button', class: 'ck-btn', 'data-f': 'autre', onclick: () => { recommencer(); if (O.fin) O.fin(); } }, ic('plus'), mot('f.autre'))),
      Z.eject.texte ? el('p', { class: Z.eject.etat === 'ko' ? 'ck-msg ko' : 'ck-msg', role: 'status', style: 'margin:10px 0 0' }, Z.eject.texte) : null)),
    el('section', { class: 'ck-card' }, el('h4', {}, mot('f.demarrer')),
      el('ol', { class: 'ckv-ol' }, el('li', {}, mot('f.etape.1')), el('li', {}, mot('f.etape.2')), el('li', {}, mot('f.etape.3'))),
      el('div', { class: 'ck-h5' }, mot('f.touches')),
      el('ul', { class: 'ckv-touches' }, ...TOUCHES.map(([marque, t]) => el('li', {}, el('span', {}, marque), el('kbd', {}, t)))),
      el('p', { class: 'ck-msg', style: 'margin:10px 0 0' }, mot('f.touches.autre')))];
  }
  function ecranEchec() {
    const p = Z.progres || {};
    return [el('section', { class: 'ck-card' }, el('h4', {}, mot('x.titre')),
      el('div', { class: 'ckv-alerte', role: 'alert' }, ic('warn', 18), el('span', {}, p.message || '')),
      el('p', { class: 'ck-msg', style: 'margin:10px 0 0' }, mot(p.touchee ? 'x.touchee' : 'x.rien')),
      el('ol', { class: 'ckv-phases' }, ...etatsPhases(p).map((x, k) => el('li', { 'data-etat': x.etat }, el('i', {}, x.etat === 'fait' ? ic('check', 14, 3) : nombre(k + 1)), el('span', {}, mot(`phase.${x.id}`))))),
      el('div', { class: 'ck-row' }, el('button', { type: 'button', class: 'ck-btn pri', 'data-f': 'retour-verifier', onclick: () => { recommencer(); O.redessiner('phrase'); } }, ic('left'), mot('x.retour'))))];
  }

  /**
   * Rend l'étape 6 (Vérifier, puis l'écriture et la fin). outils : { cle (disque lu par cle_disques), vue (sa carte), sorte,
   * post(action, input, confirm), redessiner(focus), pied, aller(n), composes(), suite(composes), facon, avecWindows,
   * mascotte(), fin(), wrap }.
   */
  function rendre(_n, outils) {
    if (typeof document !== 'undefined' && document.head && !document.getElementById?.('ckvCss')) document.head.append(el('style', { id: 'ckvCss' }, CSS));
    O = outils;
    if (Z.ecran === 'ecriture') { if (!Z.suivi) suivre(); return ecranEcriture(); }
    if (Z.ecran === 'fin') return ecranFin();
    if (Z.ecran === 'echec') return ecranEchec();
    return etapeVerifier();
  }
  /** Pendant l'écriture, on ne change pas d'étape (la barre des étapes est verrouillée). */
  const verrouille = () => Z.ecran === 'ecriture';

  W.OdinGeneseCleSuivi = { MOTS, logique, rendre, verrouille, etat: Z };
})();
