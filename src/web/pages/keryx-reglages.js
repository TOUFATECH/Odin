// Réglages de Kéryx (l'assistant d'Odin joignable de dehors). Cette moitié de la page règle :
//   - la ou les lignes : « aucune » par défaut (Kéryx marche alors sur les messageries déjà actives et la voix),
//     « modem » (SMS par modem GSM) ou « sip » (appel SIP). Modem et SIP portent un bandeau HONNÊTE :
//     « codé, pas essayé sur du vrai matériel » ;
//   - la liste blanche des numéros connus (cran 1 de l'authentification) ;
//   - le code secret, exigé avant toute action sensible (cran 2). Il part UNE fois et n'est jamais réaffiché ;
//   - le niveau d'autonomie accordé APRÈS le secret, et le sort des actions graves reçues par appel ;
//   - les surveillances : ce que Kéryx a le droit de surveiller pour t'écrire de lui-même.
// Un bouton « Essayer » rejoue un FAUX pair (SIP ou modem) : aucune vraie ligne n'est touchée.
// La page ne connaît ni base ni serveur : elle n'appelle que les routes /api/keryx/* (voir le CONTRAT du lot).
// Chargée toute seule ; sert la moitié « Réglages » de la page Kéryx. Toute confirmation passe par OdinDialog.
(() => {
  'use strict';
  window.OdinKeryxReglages = window.OdinKeryxReglages || {};
  if (window.OdinKeryxReglages.rendre) return;

  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };

  // ---------------- Logique pure (sans document) : libellés honnêtes et contrôle d'un numéro.
  const LIGNES = {
    aucune: { titre: 'Aucune ligne', sous: 'Kéryx reste joignable par les messageries déjà actives (Telegram…) et par la voix d\'Odin. Rien à brancher.' },
    modem: { titre: 'Modem GSM (USB)', sous: 'SMS par un modem GSM avec ta SIM. L\'appel vocal demande un modem à audio USB (rare).' },
    sip: { titre: 'Ligne SIP / VoIP', sous: 'Appel par ta ligne SIP, en pur Node. C\'est le chemin natif le plus réaliste pour la voix.' },
  };
  const AUTOS = {
    prudent: { titre: 'Prudent', sous: 'Kéryx lit et rédige, mais DEMANDE avant chaque action. Rien ne part sans ton « ok ».' },
    equilibre: { titre: 'Équilibré', sous: 'Les gestes routiniers passent seuls ; tout ce qui est important ou grave demande ton accord.' },
    autonome: { titre: 'Autonome', sous: 'Kéryx agit de lui-même pour le courant. Une action grave exige TOUJOURS ton accord (Heimdall).' },
  };
  const SURVS = { rappel_rdv: 'Rappel de rendez-vous', mail_important: 'Mail important' };
  const ligneTitre = (l) => (LIGNES[l] || LIGNES.aucune).titre;
  const autoTitre = (a) => (AUTOS[a] || AUTOS.prudent).titre;
  const survTitre = (q) => SURVS[q] || q;
  // Un numéro acceptable : chiffres, avec un éventuel « + » en tête, 6 à 20 chiffres. Donnée externe = prudence.
  const valideNumero = (n) => typeof n === 'string' && /^\+?[0-9][0-9 .-]{4,25}$/.test(n.trim()) && (n.replace(/[^0-9]/g, '').length >= 6);
  const nettoieNumero = (n) => String(n || '').trim().replace(/[ .\-]/g, '');

  const BANDEAU_MATERIEL = 'Codé, pas essayé sur du vrai matériel. Tant qu\'aucune ligne n\'est branchée, SMS et appel restent une démonstration contre un faux pair.';

  const CSS = `
.kxr{display:flex;flex-direction:column;gap:16px;min-width:0}
.kxr-sec{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:13px 14px;min-width:0}
.kxr-sec>h3{margin:0 0 4px;font:600 14px inherit;color:var(--ink)}
.kxr-sec>.kxr-aide{margin:0 0 10px;font-size:12.5px;color:var(--muted);line-height:1.5}
.kxr-seg{display:flex;flex-wrap:wrap;gap:6px}
.kxr-seg button{flex:1 1 120px;min-height:40px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);padding:0 10px;font:600 13px inherit;cursor:pointer}
.kxr-seg button[aria-pressed="true"]{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 16%,transparent)}
.kxr-sous{margin:8px 0 0;font-size:12.5px;color:var(--muted);line-height:1.5}
.kxr-mat{margin:10px 0 0;font-size:12.5px;line-height:1.5;color:var(--ink);background:var(--warn-bg,color-mix(in srgb,var(--warn,#C9972B) 14%,transparent));border:1px solid var(--warn,#C9972B);border-radius:10px;padding:8px 10px}
.kxr-conf{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.kxr-f{display:flex;flex-direction:column;gap:4px}
.kxr-f>label{font-size:12.5px;color:var(--muted)}
.kxr input[type=text],.kxr input[type=number],.kxr input[type=password],.kxr select{box-sizing:border-box;width:100%;min-height:40px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);padding:0 10px;font:inherit;font-size:13.5px}
.kxr-nums{display:flex;flex-direction:column;gap:6px;margin-top:4px}
.kxr-num{display:flex;align-items:center;gap:8px}
.kxr-num span{flex:1 1 auto;font-size:13.5px;color:var(--ink);word-break:break-all}
.kxr-add{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
.kxr-add input{flex:1 1 140px}
.kxr button.kxr-b{min-height:40px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:0 14px;font:600 13px inherit;cursor:pointer}
.kxr button.kxr-b.prim{background:var(--accent);border-color:var(--accent);color:var(--on-accent,#fff)}
.kxr button.kxr-b.mini{min-height:34px;padding:0 10px;font-size:12.5px}
.kxr button.kxr-b.danger{color:var(--bad,#C0392B);border-color:color-mix(in srgb,var(--bad,#C0392B) 50%,var(--line))}
.kxr-surv{display:flex;flex-direction:column;gap:8px;margin-top:4px}
.kxr-srow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;border:1px solid var(--line);border-radius:10px;padding:8px;background:var(--panel2)}
.kxr-srow select{flex:1 1 150px}
.kxr-srow input[type=text]{flex:2 1 160px}
.kxr-chk{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ink);cursor:pointer}
.kxr-barre{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.kxr-etat{font-size:12.5px;color:var(--muted);margin-left:auto}
.kxr-essai{margin-top:10px}
.kxr-trace{margin-top:8px;border:1px solid var(--line);border-radius:10px;background:var(--panel2);padding:8px;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-x:auto;color:var(--ink)}
.kxr-note{font-size:12px;color:var(--muted);font-style:italic;margin-top:6px}
`;
  function style() { if (!document.getElementById('kxr-css')) document.head.append(el('style', { id: 'kxr-css' }, CSS)); }

  // ---------------- Rendu. ctx = { api, toast?, recharger? }
  async function rendre(host, ctx = {}) {
    style();
    const api = ctx.api || defautApi;
    const dire = (m) => { try { ctx.toast ? ctx.toast(m) : null; } catch { /* sans toast */ } };
    host.replaceChildren(el('p', { class: 'kxr-aide', style: 'color:var(--muted)' }, 'Chargement des réglages…'));
    const rep = await api('/reglages');
    if (!rep || rep.ok === false) { host.replaceChildren(el('p', { class: 'kxr-mat' }, 'Réglages de Kéryx indisponibles pour l\'instant.')); return; }
    // Copie de travail (jamais le mot de passe SIP, qui reste au coffre).
    const cfg = {
      ligne: rep.ligne || 'aucune',
      numeros: Array.isArray(rep.numeros) ? rep.numeros.slice() : [],
      autonomieApresSecret: rep.autonomieApresSecret || 'prudent',
      actionGraveParAppel: rep.actionGraveParAppel || 'interdite',
      surveillances: Array.isArray(rep.surveillances) ? rep.surveillances.map((s) => ({ ...s })) : [],
      modem: rep.modem ? { port: rep.modem.port || '', debit: rep.modem.debit || 115200 } : { port: '', debit: 115200 },
      sip: rep.sip ? { serveur: rep.sip.serveur || '', utilisateur: rep.sip.utilisateur || '' } : { serveur: '', utilisateur: '' },
    };

    const racine = el('div', { class: 'kxr' });
    const redraw = () => peindre();
    host.replaceChildren(racine);

    function peindre() {
      racine.replaceChildren(
        sectionLigne(),
        sectionNumeros(),
        sectionSecret(),
        sectionAutonomie(),
        sectionSurveillances(),
        barreEnregistrer(),
      );
    }

    // ---- Ligne (aucune / modem / sip) + config conditionnelle + essayer.
    function sectionLigne() {
      const sec = el('div', { class: 'kxr-sec' },
        el('h3', {}, 'Ligne'),
        el('p', { class: 'kxr-aide' }, 'Par quoi joindre Kéryx. « Aucune » suffit : il répond déjà par Telegram et par la voix. Une ligne ajoute SMS ou appel.'));
      const seg = el('div', { class: 'kxr-seg', role: 'group', 'aria-label': 'Choix de la ligne' });
      for (const l of ['aucune', 'modem', 'sip']) {
        seg.append(el('button', { type: 'button', 'aria-pressed': String(cfg.ligne === l), onclick: () => { cfg.ligne = l; redraw(); } }, ligneTitre(l)));
      }
      sec.append(seg, el('p', { class: 'kxr-sous' }, LIGNES[cfg.ligne].sous));
      if (cfg.ligne !== 'aucune') sec.append(el('p', { class: 'kxr-mat', role: 'note' }, BANDEAU_MATERIEL));
      if (cfg.ligne === 'modem') sec.append(confModem());
      if (cfg.ligne === 'sip') sec.append(confSip());
      if (cfg.ligne !== 'aucune') sec.append(blocEssayer(cfg.ligne === 'sip' ? 'sip' : 'modem'));
      return sec;
    }
    function confModem() {
      const port = champ('Port série (ex. COM4 ou /dev/ttyUSB0)', 'text', cfg.modem.port, (v) => { cfg.modem.port = v; });
      const debit = champ('Débit', 'number', String(cfg.modem.debit), (v) => { cfg.modem.debit = Number(v) || 115200; });
      return el('div', { class: 'kxr-conf' }, port, debit,
        el('p', { class: 'kxr-note' }, 'Parler à un périphérique série sans paquet ajouté est limité : une brique de l\'OS reste à préciser. Non essayé sur du vrai matériel.'));
    }
    function confSip() {
      const serveur = champ('Serveur SIP (ex. sip.mon-operateur.fr)', 'text', cfg.sip.serveur, (v) => { cfg.sip.serveur = v; });
      const user = champ('Utilisateur SIP', 'text', cfg.sip.utilisateur, (v) => { cfg.sip.utilisateur = v; });
      return el('div', { class: 'kxr-conf' }, serveur, user,
        el('p', { class: 'kxr-note' }, 'Le mot de passe SIP se range au coffre d\'Odin, jamais sur cette page. Non essayé sur du vrai matériel.'));
    }
    function blocEssayer(quoi) {
      const sortie = el('div', { class: 'kxr-trace', role: 'status', hidden: true });
      const note = el('p', { class: 'kxr-note', hidden: true });
      const bouton = el('button', { type: 'button', class: 'kxr-b mini', onclick: async () => {
        bouton.disabled = true; sortie.hidden = false; note.hidden = true; sortie.textContent = 'Essai en cours (faux pair, aucune vraie ligne)…';
        const e = await api('/essayer', { method: 'POST', body: { quoi } });
        bouton.disabled = false;
        if (!e || e.ok === false && !Array.isArray(e.etapes)) { sortie.textContent = 'L\'essai n\'a pas pu démarrer.'; return; }
        const lignes = (e.etapes || []).map((p) => `${p.sens} ${p.trame}`).join('\n');
        sortie.textContent = `— Faux pair ${quoi.toUpperCase()}, aucune vraie ligne —\n${lignes || '(aucune trame)'}\n— ${e.ok ? 'échange complet' : 'échange interrompu'} —`;
        note.hidden = false; note.textContent = e.note || BANDEAU_MATERIEL;
      } }, `Essayer (${quoi.toUpperCase()}, faux pair)`);
      return el('div', { class: 'kxr-essai' }, bouton, sortie, note);
    }

    // ---- Liste blanche des numéros.
    function sectionNumeros() {
      const sec = el('div', { class: 'kxr-sec' },
        el('h3', {}, 'Numéros connus (liste blanche)'),
        el('p', { class: 'kxr-aide' }, 'Cran 1 de la sécurité : un numéro absent de cette liste n\'obtient rien d\'utile. Un numéro affiché peut être usurpé : il ne suffit JAMAIS pour agir, le code secret reste exigé.'));
      const liste = el('div', { class: 'kxr-nums' });
      if (!cfg.numeros.length) liste.append(el('p', { class: 'kxr-note' }, 'Aucun numéro pour l\'instant.'));
      cfg.numeros.forEach((n, i) => liste.append(el('div', { class: 'kxr-num' },
        el('span', {}, n),
        el('button', { type: 'button', class: 'kxr-b mini danger', 'aria-label': `Retirer ${n}`, onclick: () => { cfg.numeros.splice(i, 1); redraw(); } }, 'Retirer'))));
      const saisie = el('input', { type: 'text', inputmode: 'tel', placeholder: '+33 6 12 34 56 78', 'aria-label': 'Nouveau numéro' });
      const ajouter = () => {
        const v = saisie.value;
        if (!valideNumero(v)) { toastLocal('Numéro invalide : chiffres, et un « + » possible en tête.'); return; }
        const propre = nettoieNumero(v);
        if (cfg.numeros.some((x) => nettoieNumero(x) === propre)) { toastLocal('Ce numéro est déjà dans la liste.'); return; }
        cfg.numeros.push(v.trim()); redraw();
      };
      saisie.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ajouter(); } });
      sec.append(liste, el('div', { class: 'kxr-add' }, saisie, el('button', { type: 'button', class: 'kxr-b', onclick: ajouter }, 'Ajouter')));
      return sec;
    }
    function toastLocal(m) { if (ctx.toast) dire(m); else if (window.OdinDialog) window.OdinDialog.alert(m); }

    // ---- Code secret (part une fois, jamais réaffiché).
    function sectionSecret() {
      const sec = el('div', { class: 'kxr-sec' },
        el('h3', {}, 'Code secret'),
        el('p', { class: 'kxr-aide' }, 'Cran 2 : ce code doit être prouvé avant toute action sensible. Il part UNE fois vers le coffre d\'Odin (rangé en empreinte, jamais en clair) et n\'est plus jamais réaffiché.'));
      const saisie = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Nouveau code secret', 'aria-label': 'Nouveau code secret' });
      const poser = el('button', { type: 'button', class: 'kxr-b prim', onclick: async () => {
        const code = saisie.value;
        if (!code || code.length < 4) { toastLocal('Un code d\'au moins 4 caractères, c\'est plus sûr.'); return; }
        poser.disabled = true;
        const r = await api('/secret', { method: 'POST', body: { code } });
        poser.disabled = false; saisie.value = '';
        if (r && (r.pose || r.ok)) { dire('Code secret posé.'); etatSecret.textContent = 'Code secret posé. Il est exigé avant toute action sensible.'; }
        else toastLocal('Le code n\'a pas pu être posé.');
      } }, 'Poser le code');
      const retirer = el('button', { type: 'button', class: 'kxr-b danger', onclick: async () => {
        const oui = window.OdinDialog ? await window.OdinDialog.confirm('Retirer le code secret ? Sans lui, aucune action sensible ne pourra plus être autorisée de l\'extérieur.', { ok: 'Retirer', danger: true }) : true;
        if (!oui) return;
        const r = await api('/secret', { method: 'DELETE' });
        if (r && (r.pose === false || r.ok)) { dire('Code secret retiré.'); etatSecret.textContent = 'Aucun code secret. Aucune action sensible ne sera autorisée de l\'extérieur.'; }
        else toastLocal('Le code n\'a pas pu être retiré.');
      } }, 'Retirer le code');
      const etatSecret = el('p', { class: 'kxr-note' }, 'Pose un code pour autoriser les actions sensibles ; laisse vide pour tout garder en lecture seule.');
      sec.append(el('div', { class: 'kxr-add' }, saisie, poser), el('div', { class: 'kxr-barre', style: 'margin-top:8px' }, retirer), etatSecret);
      return sec;
    }

    // ---- Autonomie après secret + actions graves par appel.
    function sectionAutonomie() {
      const sec = el('div', { class: 'kxr-sec' },
        el('h3', {}, 'Ce que Kéryx a le droit de faire'),
        el('p', { class: 'kxr-aide' }, 'Une fois le code prouvé, jusqu\'où Kéryx peut agir seul. Une action grave demande TOUJOURS ton accord, quel que soit le niveau.'));
      const seg = el('div', { class: 'kxr-seg', role: 'group', 'aria-label': 'Niveau d\'autonomie après le secret' });
      for (const a of ['prudent', 'equilibre', 'autonome']) {
        seg.append(el('button', { type: 'button', 'aria-pressed': String(cfg.autonomieApresSecret === a), onclick: () => { cfg.autonomieApresSecret = a; redraw(); } }, autoTitre(a)));
      }
      sec.append(seg, el('p', { class: 'kxr-sous' }, AUTOS[cfg.autonomieApresSecret].sous));
      const grave = el('div', { class: 'kxr-f', style: 'margin-top:12px' },
        el('label', { for: 'kxr-grave' }, 'Action grave demandée par un APPEL vocal'),
        selectEl('kxr-grave', [['interdite', 'Interdite par la voix (il faut un autre canal)'], ['second_canal', 'Permise, mais confirmée sur un second canal (message)']], cfg.actionGraveParAppel, (v) => { cfg.actionGraveParAppel = v; }));
      sec.append(grave, el('p', { class: 'kxr-note' }, 'Au téléphone, le code peut être entendu par un tiers présent. Pour une action grave, Kéryx exige une confirmation écrite ou la refuse, selon ce réglage.'));
      return sec;
    }

    // ---- Surveillances proactives.
    function sectionSurveillances() {
      const sec = el('div', { class: 'kxr-sec' },
        el('h3', {}, 'Ce que Kéryx peut surveiller'),
        el('p', { class: 'kxr-aide' }, 'Kéryx peut t\'écrire de lui-même (un rappel, un mail important). Il ne surveille que ce que tu actives ici, rien d\'autre.'));
      const liste = el('div', { class: 'kxr-surv' });
      if (!cfg.surveillances.length) liste.append(el('p', { class: 'kxr-note' }, 'Aucune surveillance. Kéryx n\'écrira pas de lui-même.'));
      cfg.surveillances.forEach((s, i) => {
        const type = selectEl(`kxr-sv-${i}`, [['rappel_rdv', survTitre('rappel_rdv')], ['mail_important', survTitre('mail_important')]], s.quoi, (v) => { s.quoi = v; });
        const reglage = el('input', { type: 'text', value: s.reglage || '', placeholder: 'ex. 1 h avant', 'aria-label': 'Réglage de la surveillance', oninput: (e) => { s.reglage = e.target.value; } });
        const actif = el('label', { class: 'kxr-chk' }, caseAcocher(s.actif !== false, (on) => { s.actif = on; }), 'Active');
        const retirer = el('button', { type: 'button', class: 'kxr-b mini danger', 'aria-label': 'Retirer cette surveillance', onclick: () => { cfg.surveillances.splice(i, 1); redraw(); } }, 'Retirer');
        liste.append(el('div', { class: 'kxr-srow' }, type, reglage, actif, retirer));
      });
      const ajouter = el('button', { type: 'button', class: 'kxr-b', style: 'margin-top:8px', onclick: () => { cfg.surveillances.push({ id: 's' + Date.now().toString(36), quoi: 'rappel_rdv', reglage: '', actif: true }); redraw(); } }, 'Ajouter une surveillance');
      sec.append(liste, ajouter);
      return sec;
    }

    // ---- Enregistrer (PUT /reglages avec l'objet complet).
    function barreEnregistrer() {
      const etat = el('span', { class: 'kxr-etat', role: 'status' }, '');
      const bouton = el('button', { type: 'button', class: 'kxr-b prim', onclick: async () => {
        bouton.disabled = true; etat.textContent = 'Enregistrement…';
        const corps = {
          ligne: cfg.ligne,
          numeros: cfg.numeros.slice(),
          autonomieApresSecret: cfg.autonomieApresSecret,
          actionGraveParAppel: cfg.actionGraveParAppel,
          surveillances: cfg.surveillances.map((s) => ({ id: s.id, quoi: s.quoi, reglage: s.reglage || '', actif: s.actif !== false })),
        };
        if (cfg.ligne === 'modem') corps.modem = { port: cfg.modem.port, debit: cfg.modem.debit };
        if (cfg.ligne === 'sip') corps.sip = { serveur: cfg.sip.serveur, utilisateur: cfg.sip.utilisateur };
        const r = await api('/reglages', { method: 'PUT', body: corps });
        bouton.disabled = false;
        if (r && r.ok !== false && r.ligne) { etat.textContent = 'Réglages enregistrés.'; dire('Réglages de Kéryx enregistrés.'); if (ctx.recharger) ctx.recharger(); }
        else { etat.textContent = 'Échec de l\'enregistrement.'; }
      } }, 'Enregistrer les réglages');
      return el('div', { class: 'kxr-sec' }, el('div', { class: 'kxr-barre' }, bouton, etat));
    }

    // ---- Petits contrôles.
    function champ(libelle, type, valeur, onInput) {
      const id = 'kxr-c-' + Math.random().toString(36).slice(2, 8);
      const input = el('input', { type, id, value: valeur, oninput: (e) => onInput(e.target.value) });
      return el('div', { class: 'kxr-f' }, el('label', { for: id }, libelle), input);
    }
    function selectEl(id, options, valeur, onChange) {
      const s = el('select', { id, onchange: (e) => onChange(e.target.value) });
      for (const [v, t] of options) { const o = el('option', { value: v }, t); if (v === valeur) o.setAttribute('selected', ''); s.append(o); }
      s.value = valeur;
      return s;
    }
    function caseAcocher(coche, onChange) {
      const c = el('input', { type: 'checkbox', onchange: (e) => onChange(e.target.checked) });
      if (coche) c.setAttribute('checked', ''), c.checked = true;
      return c;
    }

    peindre();
  }

  async function defautApi(path, opts = {}) {
    try {
      const init = { method: opts.method || 'GET', headers: { 'x-odin': '1' } };
      if (opts.body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
      const r = await fetch(`/api/keryx${path}`, init);
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, ...j };
    } catch { return { ok: false, text: 'Kéryx ne répond pas.' }; }
  }

  window.OdinKeryxReglages = {
    rendre,
    logique: { ligneTitre, autoTitre, survTitre, valideNumero, nettoieNumero, LIGNES, AUTOS, SURVS, BANDEAU_MATERIEL },
  };
})();
