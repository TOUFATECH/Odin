// Sphinx · « Adresses fixes » (maquette « Réseau » validée, lot R3) : le plan de tout le réseau et les adresses réservées.
//   - le plan des adresses : la box, Odin, les adresses fixes, la plage distribuée (prises, libres), les adresses
//     retenues, les libres ; une barre, et sa légende en mots (la couleur ne dit jamais rien toute seule) ;
//   - les adresses fixes : qui garde quelle adresse ; changer, retirer (avec une question dans la page) ; la box, Odin
//     et le serveur DNS de la maison sont verrouillés ;
//   - « Réserver une adresse » : l'appareil, l'adresse, le nom ; Odin vérifie l'adresse pendant que tu tapes (déjà
//     prise, réservée, hors du réseau : refusée ; dans la plage distribuée : acceptée, et retirée de la plage).
// Tout ce qui est vrai vient du serveur (lecture « plan_adresses », qui vérifie aussi une adresse sans rien écrire) ;
// les gestes passent par les actions « dhcp_fixe » et « dhcp_retirer_fixe » (propriétaire seul, mêmes règles côté
// serveur : la page ne décide de rien). Un nom d'appareil vient du réseau : il est TOUJOURS posé comme du texte, jamais
// comme du HTML. Tous les textes de la page sont dans MOTS. L'écran s'ajoute à la page de Sphinx (sphinx-appareils.js).
(() => {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;
  const SX = W.OdinSphinx;
  if (!SX || !SX.outils || typeof SX.ajouter !== 'function') return;
  const { el, ic, demander, traits } = SX.outils;
  traits.crayon = 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4';
  traits.corbeille = 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6';

  // ---------------------------------------------------------------- les mots
  const MOTS = {
    onglet: 'Adresses fixes',
    'membre.titre': 'Ce que tu vois',
    'box.titre': 'La box distribue les adresses',
    'box.texte': 'Une adresse fixe est seulement notée : elle sera donnée dès qu\'Odin distribuera les adresses.',
    'p.titre': 'Le plan des adresses', 'p.lead': 'Le réseau de la maison, de {de} à {a} : qui prend quoi.', 'p.aria': 'Plan des adresses, de {de} à {a}',
    'p.plage': 'Plage distribuée : {de} à {a}.', 'p.sansplage': 'Aucune plage distribuée dans ce réseau : vérifie les réglages du DHCP.',
    'p.tranche': '{de} à {a} · {quoi}', 'p.une': '{de} · {quoi}',
    's.box': 'La box', 's.odin': 'Odin', 's.dns': 'Serveur DNS de la maison', 's.fixe': 'Adresses fixes', 's.bail': 'Distribuées en ce moment',
    's.plage': 'Libres dans la plage distribuée', 's.retenue': 'Retenues (appareil bloqué ou en pause, pas encore lâchées)', 's.libre': 'Libres hors de la plage',
    'f.titre': 'Adresses fixes', 'f.lead': 'Un appareil garde toujours la même adresse (il est reconnu à son adresse MAC) et le même nom.',
    'f.vide': 'Aucune adresse fixe pour l\'instant.', 'f.verrou': 'verrouillée', 'f.bloque': 'bloqué', 'f.pause': 'en pause', 'f.attente': 'attend ton accord', 'f.tient': 'tient encore {ip}', 'f.ici': 'ton appareil',
    'f.modifier': 'Changer l\'adresse fixe de {nom}', 'f.retirer': 'Retirer l\'adresse fixe de {nom}',
    'k.titre': 'Retirer l\'adresse fixe de « {nom} » ?', 'k.texte': 'Il reprendra une adresse de la plage distribuée, et {ip} redeviendra libre. S\'il est bloqué ou en pause, il le reste.',
    'k.texte.liste': 'Seuls les appareils approuvés reçoivent une adresse, et son accord tenait à cette adresse fixe : sans elle, il attendra de nouveau ton accord. {ip} redeviendra libre.',
    'k.ok': 'Retirer l\'adresse fixe', 'k.annuler': 'Annuler', 'k.demande': 'Odin retire…',
    'r.titre': 'Réserver une adresse', 'r.titre.modif': 'Changer l\'adresse fixe de « {nom} »',
    'r.lead': 'Choisis l\'appareil ; Odin propose la première adresse libre hors de la plage distribuée, et vérifie celle que tu tapes.',
    'r.lead.modif': 'Tape la nouvelle adresse : Odin la vérifie avant de rien changer.',
    'r.aucun': 'Aucun appareil à qui réserver une adresse : ils apparaissent ici dès qu\'ils demandent une adresse à Odin.',
    'r.appareil': 'Appareil', 'r.choisir': 'Choisis un appareil…', 'r.sans': 'aucune adresse', 'r.ip': 'Adresse fixe', 'r.nom': 'Nom de l\'appareil',
    'r.ok': 'Réserver', 'r.ok.modif': 'Enregistrer', 'r.demande': 'Odin enregistre…', 'r.propose': 'Prendre {ip} (proposée par Odin)', 'r.annuler': 'Annuler',
    'r.verifie': 'Odin vérifie…', 'r.attend': 'Choisis un appareil et une adresse : Odin la vérifie avant de la réserver.',
    'r.proprio': 'Réserver, changer et retirer une adresse fixe : le propriétaire seul.',
    'e.silence': 'Odin ne répond pas.', 'e.lecture': 'Odin n\'a pas pu lire le plan des adresses.',
  };
  const mot = (k, v = {}) => String(MOTS[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(v[n] ?? ''));
  const SORTES = ['box', 'odin', 'dns', 'fixe', 'bail', 'plage', 'retenue', 'libre'];

  const CSS = `
.sp-plan{display:flex;gap:1px;height:40px;border-radius:12px;overflow:hidden;border:1px solid var(--line);background:var(--line);margin:6px 0 4px}
.sp-seg{display:block;min-width:3px;height:100%;flex:1 1 0}
.sp-box{background:var(--muted)}
.sp-odin{background:var(--accent)}
.sp-dns{background:color-mix(in srgb,var(--accent) 50%,var(--ink))}
.sp-fixe{background:var(--good)}
.sp-bail{background:var(--warn)}
.sp-plage{background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--warn) 42%,var(--panel)) 0 4px,color-mix(in srgb,var(--warn) 10%,var(--panel)) 4px 8px)}
.sp-retenue{background:var(--bad)}
.sp-libre{background:var(--panel2,var(--panel))}
.sp-axe{display:flex;justify-content:space-between;gap:12px;font-size:12px;color:var(--muted)}
.sp-leg{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;line-height:1.4}
.sp-leg li{display:flex;align-items:center;gap:8px;min-width:0}
.sp-leg .sp-seg{width:16px;height:16px;min-width:16px;flex:none;border-radius:5px;border:1px solid var(--line)}
.sp-liste{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.sp-ent{display:flex;align-items:center;gap:10px;padding:8px;border-radius:12px;border:1px solid var(--line);flex-wrap:wrap;min-width:0}
.sp-nm{flex:1 1 140px;min-width:0}
.sp-nm b{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:14px;font-weight:600;overflow-wrap:anywhere}
.sp-nm small{display:block;color:var(--muted);font-size:12px;overflow-wrap:anywhere}
.sp-ibtn{min-width:44px;min-height:44px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);display:inline-grid;place-items:center;cursor:pointer;flex:none;padding:0}
.sp-ent .sa-garde{flex:1 1 100%;margin:4px 0 0}
.sp-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.sp-champ{display:flex;flex-direction:column;gap:4px;min-width:0}
.sp-champ label,.sp-champ .sp-lab{font-size:12.5px;color:var(--muted);font-weight:600}
.sp-champ :is(input,select){min-height:44px;border-radius:12px;border:1px solid var(--line);background:var(--panel2,var(--panel));color:var(--ink);padding:0 12px;font:14px inherit;min-width:0;width:100%}
.sp-champ .sp-fixee{min-height:44px;display:flex;align-items:center;font-weight:600;overflow-wrap:anywhere}
.sp-v{display:flex;gap:8px;align-items:flex-start;margin:12px 0 0;font-size:13.5px;font-weight:600;line-height:1.45;overflow-wrap:anywhere}
.sp-v svg{flex:none;margin-top:1px}
.sp-v.ok{color:var(--good)}.sp-v.warn{color:var(--warn)}.sp-v.bad{color:var(--bad)}.sp-v.off{color:var(--muted);font-weight:500}
.sp-avis{margin:6px 0 0;padding-left:18px;font-size:13px;color:var(--muted);line-height:1.5}
`;
  function style() { if (!document.getElementById('sp-css')) document.head.append(el('style', { id: 'sp-css' }, CSS)); }

  /** Ce qu'une réponse refusée ou muette donne à lire. */
  const texteDe = (r) => String((r && (r.text ?? r.error)) ?? mot('e.silence'));
  /** La couleur d'une vérification : refus, accepté avec une remarque (dans la plage), accepté. Pur. */
  const tonDe = (v) => (!v.ok ? 'bad' : v.dansPlage && v.code !== 'meme' ? 'warn' : 'ok');
  /** La légende du plan : une ligne par sorte d'adresse présente, avec ce qu'elle couvre. Pur. */
  function legende(plan) {
    const out = [];
    for (const s of SORTES) {
      const n = plan.comptes[s] || 0; if (!n) continue;
      const t = plan.tranches.filter((x) => x.sorte === s);
      const ou = s === 'box' && plan.box ? plan.box : s === 'odin' && plan.odin ? plan.odin : t.length === 1 ? (t[0].n === 1 ? t[0].de : `${t[0].de} à ${t[0].a}`) : String(n);
      out.push({ sorte: s, texte: `${mot(`s.${s}`)} · ${ou}` });
    }
    return out;
  }

  // ---------------------------------------------------------------- l'écran
  /** Monte l'écran dans `racine`. `quoi.mac` : l'appareil venu de sa fiche (« Réserver cette adresse »). Rend { relire, pret }. */
  function ecran(racine, quoi) {
    style();
    // mac : l'appareil choisi ; ip, nom : ce qui est tapé ; verdict + cle : la dernière vérification et ce qu'elle a vérifié ;
    // modif : on change une adresse fixe qui existe ; retirer : la question « retirer ? » ouverte pour cet appareil.
    const S = { D: null, mac: '', ip: '', nom: '', verdict: null, cle: '', modif: false, retirer: '', occupe: false, res: null, venu: quoi && quoi.mac ? String(quoi.mac) : '' };
    const zNote = el('div', {}), zPlan = el('div', {}), zFixes = el('div', {}), zForm = el('div', {});
    racine.append(zNote, zPlan, zFixes, zForm);
    const viser = (cle) => { for (const n of racine.querySelectorAll('[data-f]')) if (n.getAttribute('data-f') === cle) { n.focus(); return true; } return false; };
    const proprio = () => S.D?.proprietaire === true;
    const fixesDe = () => S.D?.fixes ?? [], candidats = () => S.D?.appareils ?? [];
    const choisi = () => fixesDe().find((f) => f.mac === S.mac) ?? candidats().find((d) => d.mac === S.mac);
    const cleDe = () => `${S.mac} ${S.ip.trim()}`;

    function notes() {
      const D = S.D, n = [];
      if (D && D.limite) n.push(el('div', { class: 'sa-note', role: 'note' }, ic('shield'), el('div', {}, el('b', {}, mot('membre.titre')), el('p', {}, D.limite))));
      else if (D && D.dhcp && D.dhcp.allume === false) n.push(el('div', { class: 'sa-note', role: 'note' }, ic('shield'), el('div', {}, el('b', {}, mot('box.titre')), el('p', {}, mot('box.texte')))));
      zNote.replaceChildren(...n);
    }
    function plan() {
      const p = S.D?.plan;
      if (!p) return void zPlan.replaceChildren();
      if (!p.ok) return void zPlan.replaceChildren(el('section', { class: 'sa-card' }, el('h2', {}, mot('p.titre')), el('p', { class: 'sa-avis bad', role: 'alert' }, ic('warn', 18), p.erreur)));
      const seg = (t) => { const n = el('span', { class: `sp-seg sp-${t.sorte}`, title: t.n === 1 ? mot('p.une', { de: t.de, quoi: mot(`s.${t.sorte}`) }) : mot('p.tranche', { de: t.de, a: t.a, quoi: mot(`s.${t.sorte}`) }) }); n.style.flexGrow = String(t.n); return n; };
      zPlan.replaceChildren(el('section', { class: 'sa-card' },
        el('h2', {}, mot('p.titre')), el('p', { class: 'sa-lead' }, mot('p.lead', { de: p.premiere, a: p.derniere })),
        el('div', { class: 'sp-plan', role: 'img', 'aria-label': mot('p.aria', { de: p.premiere, a: p.derniere }) }, p.tranches.map(seg)),
        el('div', { class: 'sp-axe sa-mono', 'aria-hidden': 'true' }, el('span', {}, p.premiere), el('span', {}, p.derniere)),
        el('ul', { class: 'sp-leg' }, legende(p).map((l) => el('li', {}, el('span', { class: `sp-seg sp-${l.sorte}`, 'aria-hidden': 'true' }), el('span', {}, l.texte)))),
        el('p', { class: 'sa-lead', style: 'margin-bottom:0' }, p.plage.taille ? mot('p.plage', { de: p.plage.debut, a: p.plage.fin }) : mot('p.sansplage'))));
    }
    function question(f) {
      const annuler = () => { S.retirer = ''; fixes(); viser(`ret:${f.mac}`); };
      const oui = async () => {
        if (S.occupe) return; S.occupe = true; fixes(); viser('k-ok');
        const r = await demander('dhcp_retirer_fixe', { mac: f.mac });
        S.occupe = false; S.retirer = ''; S.res = { ok: r.ok !== false && !r.error, text: texteDe(r) };
        if (S.mac === f.mac) { S.mac = ''; S.ip = ''; S.nom = ''; S.modif = false; S.verdict = null; S.cle = ''; }
        await relire(); viser('dev') || viser(`ret:${f.mac}`);
      };
      return el('div', { class: 'sa-garde', role: 'alert', 'aria-live': 'assertive', onkeydown: (ev) => { if (ev.key === 'Escape') { ev.preventDefault?.(); annuler(); } } },
        el('b', { class: 'sa-gt' }, mot('k.titre', { nom: f.nom })), el('p', {}, mot(f.accord === false && f.etat === 'actif' ? 'k.texte.liste' : 'k.texte', { ip: f.ip })),
        el('div', { class: 'sa-acts' },
          el('button', { type: 'button', class: 'sa-btn dng', disabled: S.occupe, 'data-f': 'k-ok', onclick: oui }, ic('corbeille', 18), S.occupe ? mot('k.demande') : mot('k.ok')),
          el('button', { type: 'button', class: 'sa-btn ghost', disabled: S.occupe, 'data-f': 'k-non', onclick: annuler }, mot('k.annuler'))));
    }
    function fixes() {
      const l = fixesDe(), P = proprio();
      if (!S.D || (!P && !l.length)) return void zFixes.replaceChildren();
      const ligne = (f) => el('li', { class: 'sp-ent' },
        el('span', { class: 'sa-lg' }, ic(f.type, 21)),
        el('span', { class: 'sp-nm' },
          el('b', {}, f.nom, ' · ', el('span', { class: 'sa-mono' }, f.ip),
            f.garde ? el('span', { class: 'sa-tag' }, mot('f.verrou')) : null,
            f.etat === 'bloque' ? el('span', { class: 'sa-tag warn' }, mot('f.bloque')) : f.etat === 'pause' ? el('span', { class: 'sa-tag warn' }, mot('f.pause')) : f.etat === 'attente' ? el('span', { class: 'sa-tag warn' }, mot('f.attente')) : null,
            f.tient ? el('span', { class: 'sa-tag' }, mot('f.tient', { ip: f.tient })) : null,
            f.ici ? el('span', { class: 'sa-tag acc' }, mot('f.ici')) : null),
          el('small', {}, el('span', { class: 'sa-mono' }, f.mac), f.nomReseau ? [' · ', el('span', { class: 'sa-mono' }, f.nomReseau)] : null)),
        P && !f.garde ? [
          el('button', { type: 'button', class: 'sp-ibtn', 'aria-label': mot('f.modifier', { nom: f.nom }), title: mot('f.modifier', { nom: f.nom }), 'data-f': `mod:${f.mac}`, onclick: () => modifier(f) }, ic('crayon')),
          el('button', { type: 'button', class: 'sp-ibtn', 'aria-label': mot('f.retirer', { nom: f.nom }), title: mot('f.retirer', { nom: f.nom }), 'data-f': `ret:${f.mac}`, onclick: () => { S.retirer = f.mac; S.res = null; fixes(); formulaire(); viser('k-non'); } }, ic('corbeille')),
        ] : null,
        S.retirer === f.mac ? question(f) : null);
      zFixes.replaceChildren(el('section', { class: 'sa-card' },
        el('h2', {}, mot('f.titre'), el('span', { class: 'sa-cnt' }, String(l.length))), el('p', { class: 'sa-lead' }, mot('f.lead')),
        l.length ? el('ul', { class: 'sp-liste' }, l.map(ligne)) : el('p', { class: 'sa-vide' }, mot('f.vide')),
        !P ? el('p', { class: 'sa-lead', style: 'margin-bottom:0' }, mot('r.proprio')) : null));
    }
    /** Changer une adresse fixe qui existe : le formulaire prend cet appareil, son adresse et son nom. */
    function modifier(f) {
      S.mac = f.mac; S.ip = f.ip; S.nom = f.nom; S.modif = true; S.retirer = ''; S.res = null; S.verdict = null; S.cle = '';
      fixes(); formulaire(); viser('ip'); void verifier();
    }
    /** Un appareil est choisi dans la liste : Odin propose la première adresse libre hors de la plage. */
    function prendre(mac, ip) {
      const d = candidats().find((x) => x.mac === mac);
      S.mac = d ? mac : ''; S.modif = false; S.verdict = null; S.cle = ''; S.res = null;
      S.ip = d ? (ip || S.D?.plan?.proposee || d.ip || '') : ''; S.nom = d && d.nom !== 'Appareil sans nom' ? d.nom : '';
    }
    let zV = el('div', {}), bOk = null;
    function verdict() {
      const v = S.verdict, frais = v && S.cle === cleDe(), pret = Boolean(frais && v.ok && !S.occupe);
      if (bOk) { if (pret) bOk.removeAttribute('disabled'); else bOk.setAttribute('disabled', ''); }
      if (!S.mac || !S.ip.trim()) return void zV.replaceChildren(el('p', { class: 'sp-v off' }, mot('r.attend')));
      if (!frais) return void zV.replaceChildren(el('p', { class: 'sp-v off' }, mot('r.verifie')));
      const ton = tonDe(v), propose = !v.ok && v.proposee && v.proposee !== S.ip.trim();
      zV.replaceChildren(...[el('p', { class: `sp-v ${ton}` }, ic(ton === 'ok' ? 'check' : 'warn', 18), el('span', {}, v.message)),
        v.avis && v.avis.length ? el('ul', { class: 'sp-avis' }, v.avis.map((x) => el('li', {}, x))) : null,
        propose ? el('div', { class: 'sa-acts' }, el('button', { type: 'button', class: 'sa-btn', 'data-f': 'propose', onclick: () => { S.ip = v.proposee; formulaire(); viser('ip'); void verifier(); } }, ic('pin', 18), mot('r.propose', { ip: v.proposee }))) : null].filter(Boolean));
    }
    let enVerif = false, aRefaire = false;
    /** Odin vérifie l'adresse tapée (une lecture : rien n'est écrit). Jamais deux vérifications en même temps. */
    async function verifier() {
      const mac = S.mac, ip = S.ip.trim();
      if (!mac || !ip) { S.verdict = null; S.cle = ''; return void verdict(); }
      if (enVerif) { aRefaire = true; return; }
      enVerif = true; verdict();
      try {
        const r = await demander('plan_adresses', { mac, ip }), v = r && r.data ? r.data.verdict : null;
        if (S.mac === mac && S.ip.trim() === ip) { S.verdict = v && typeof v.message === 'string' ? v : { ok: false, code: '', message: texteDe(r), avis: [], proposee: '' }; S.cle = `${mac} ${ip}`; }
      } finally { enVerif = false; }
      verdict();
      if (aRefaire) { aRefaire = false; await verifier(); }
    }
    async function reserver() {
      const v = S.verdict; if (S.occupe || !v || !v.ok || S.cle !== cleDe()) return;
      const mac = S.mac; S.occupe = true; formulaire(); viser('r-ok');
      const r = await demander('dhcp_fixe', { mac, ip: S.ip.trim(), nom: S.nom.trim() });
      const ok = r.ok !== false && !r.error; S.occupe = false; S.res = { ok, text: texteDe(r) };
      if (ok) { S.mac = ''; S.ip = ''; S.nom = ''; S.modif = false; S.verdict = null; S.cle = ''; await relire(); viser(`mod:${mac}`) || viser('dev'); return; }
      S.verdict = null; S.cle = ''; formulaire(); viser('ip'); await verifier();
    }
    function formulaire() {
      if (!S.D || !proprio()) { bOk = null; return void zForm.replaceChildren(); }
      const d = choisi(), l = candidats();
      const resultat = S.res && S.res.text ? el('p', { class: `sa-res${S.res.ok ? '' : ' non'}`, role: 'status' }, S.res.text) : null;
      if (!S.modif && !l.length) { bOk = null; return void zForm.replaceChildren(el('section', { class: 'sa-card' }, el('h2', {}, mot('r.titre')), el('p', { class: 'sa-vide' }, mot('r.aucun')), resultat)); }
      const dev = S.modif
        ? el('div', { class: 'sp-champ' }, el('span', { class: 'sp-lab' }, mot('r.appareil')), el('span', { class: 'sp-fixee' }, d ? d.nom : S.mac))
        : el('div', { class: 'sp-champ' }, el('label', { for: 'sp-dev' }, mot('r.appareil')),
          el('select', { id: 'sp-dev', 'data-f': 'dev', onchange: (e) => { prendre(e.target.value); formulaire(); viser('dev'); void verifier(); } },
            el('option', { value: '', selected: !S.mac }, mot('r.choisir')), l.map((x) => el('option', { value: x.mac, selected: x.mac === S.mac }, `${x.nom} · ${x.ip || mot('r.sans')}`))));
      if (!S.modif) dev.querySelector('select').value = S.mac;
      const ipIn = el('input', { id: 'sp-ip', type: 'text', inputmode: 'decimal', maxlength: 15, class: 'sa-mono', autocomplete: 'off', spellcheck: 'false', 'data-f': 'ip', value: S.ip, oninput: (e) => { S.ip = String(e.target.value); S.res = null; verdict(); void verifier(); }, onkeydown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault?.(); void reserver(); } } });
      const nomIn = el('input', { id: 'sp-nom', type: 'text', maxlength: 60, autocomplete: 'off', spellcheck: 'false', 'data-f': 'nom', value: S.nom, oninput: (e) => { S.nom = String(e.target.value); } });
      ipIn.value = S.ip; nomIn.value = S.nom;
      zV = el('div', { role: 'status', 'aria-live': 'polite' });
      bOk = el('button', { type: 'button', class: 'sa-btn pri', 'data-f': 'r-ok', disabled: true, onclick: reserver }, ic('pin', 18), S.occupe ? mot('r.demande') : mot(S.modif ? 'r.ok.modif' : 'r.ok'));
      zForm.replaceChildren(el('section', { class: 'sa-card' },
        el('h2', {}, S.modif ? mot('r.titre.modif', { nom: d ? d.nom : S.mac }) : mot('r.titre')), el('p', { class: 'sa-lead' }, mot(S.modif ? 'r.lead.modif' : 'r.lead')),
        el('div', { class: 'sp-form' }, dev, el('div', { class: 'sp-champ' }, el('label', { for: 'sp-ip' }, mot('r.ip')), ipIn), el('div', { class: 'sp-champ' }, el('label', { for: 'sp-nom' }, mot('r.nom')), nomIn)),
        zV,
        el('div', { class: 'sa-acts' }, bOk,
          S.modif ? el('button', { type: 'button', class: 'sa-btn ghost', 'data-f': 'r-non', disabled: S.occupe, onclick: () => { const mac = S.mac; S.mac = ''; S.ip = ''; S.nom = ''; S.modif = false; S.verdict = null; S.cle = ''; formulaire(); viser(`mod:${mac}`); } }, mot('r.annuler')) : null),
        resultat));
      verdict();
    }
    let enVol = false;
    async function relire(o = {}) {
      // En direct : pas pendant une question ouverte ni pendant un geste ; jamais deux relectures en même temps.
      const fige = () => Boolean(S.retirer || S.occupe);
      if (o.discret && (fige() || enVol)) return;
      let r; if (o.discret) enVol = true;
      try { r = await demander('plan_adresses'); } finally { if (o.discret) enVol = false; }
      if (o.discret && fige()) return;
      if (r && r.data && Array.isArray(r.data.fixes)) S.D = r.data;
      else if (!S.D) S.D = { proprietaire: false, limite: String((r && (r.text ?? r.error)) ?? mot('e.lecture')), dhcp: { allume: true }, plan: null, fixes: [], appareils: [], verdict: null };
      // L'appareil venu de sa fiche : déjà une adresse fixe → on la change ; sinon on lui réserve celle qu'il tient.
      if (S.venu && proprio()) {
        const mac = S.venu, f = fixesDe().find((x) => x.mac === mac); S.venu = '';
        if (f && !f.garde) { S.mac = f.mac; S.ip = f.ip; S.nom = f.nom; S.modif = true; } else if (!f) { const d = candidats().find((x) => x.mac === mac); if (d) prendre(mac, d.ip); }
        notes(); plan(); fixes(); formulaire(); viser('ip'); return void await verifier();
      }
      // L'appareil choisi n'est plus là (retiré ailleurs) : le formulaire repart de zéro.
      if (S.mac && !choisi()) { S.mac = ''; S.ip = ''; S.nom = ''; S.modif = false; S.verdict = null; S.cle = ''; }
      const cle = document.activeElement?.getAttribute?.('data-f');
      notes(); plan(); fixes();
      // Pendant que tu tapes, le formulaire ne bouge pas sous tes doigts : seule la vérification est refaite.
      if (o.discret && (cle === 'ip' || cle === 'nom' || cle === 'dev')) { if (S.mac && S.ip.trim()) await verifier(); return; }
      formulaire(); if (cle) viser(cle);
      if (S.mac && S.ip.trim()) await verifier();
    }
    return { relire, etat: S };
  }

  SX.ajouter({ id: 'fixes', titre: () => mot('onglet'), dessiner: (n, quoi) => { const e = ecran(n, quoi); return { relire: e.relire, pret: e.relire(), etat: e.etat }; } });
  SX.plan = { MOTS, legende, tonDe };
})();
