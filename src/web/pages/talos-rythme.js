// Talos : le choix du rythme d'une automatisation, en clair (« Tous les jours à 7 h 30 », « Chaque mois, le 1er
// à 4 h »…), au lieu d'un planning cron. Le champ cron reste pour les experts. Sous le choix : la phrase et les trois
// prochaines exécutions, calculées par Odin à l'heure de son lieu (POST /api/draupnir/rythme/apercu).
// Ce fichier est chargé avant les autres scripts de l'interface : rien ne touche au document à son chargement.
// API : OdinRythme.editeur({ valeur, permis, onChange }) → élément ; OdinRythme.logique (fonctions pures, pour les essais).
(() => {
  'use strict';
  if (window.OdinRythme) return;

  // ---------------- Logique pure (sans document)
  const GENRES = [
    { genre: 'jour', label: 'Tous les jours' },
    { genre: 'semaine', label: 'Chaque semaine' },
    { genre: 'mois', label: 'Chaque mois' },
    { genre: 'une_fois', label: 'Une seule fois' },
    { genre: 'minutes', label: 'Toutes les N minutes' },
    { genre: 'heures', label: 'Toutes les N heures' },
    { genre: 'cron', label: 'Expert : cron' },
  ];
  /** Les jours de la semaine dans l'ordre d'affichage (lundi d'abord) ; 0 = dimanche, comme dans le planning. */
  const JOURS = [[1, 'L', 'lundi'], [2, 'M', 'mardi'], [3, 'M', 'mercredi'], [4, 'J', 'jeudi'], [5, 'V', 'vendredi'], [6, 'S', 'samedi'], [0, 'D', 'dimanche']];
  const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const entier = (x, d) => { const n = Number(x); return Number.isFinite(n) ? Math.round(n) : d; };

  /** Tous les champs du sélecteur, remplis d'après un rythme (les champs des autres genres gardent une valeur par défaut). */
  function versChamps(r) {
    const c = { genre: 'jour', heure: '07:30', jours: [1], jour: 1, date: '', n: 15, minute: 0, cron: '' };
    if (!r || typeof r !== 'object') return c;
    const g = GENRES.some((x) => x.genre === r.genre) ? r.genre : 'jour';
    c.genre = g;
    if (typeof r.heure === 'string') c.heure = r.heure;
    if (g === 'semaine' && Array.isArray(r.jours)) c.jours = [...r.jours];
    if (g === 'mois') c.jour = entier(r.jour, 1);
    if (g === 'une_fois') c.date = String(r.date ?? '');
    if (g === 'minutes') c.n = entier(r.n, 15);
    if (g === 'heures') { c.n = entier(r.n, 1); c.minute = entier(r.minute, 0); }
    if (g === 'cron') c.cron = String(r.cron ?? '');
    return c;
  }
  /** Le rythme que décrivent les champs (seulement ce qui sert à son genre). */
  function depuisChamps(c) {
    const g = c?.genre;
    if (g === 'semaine') return { genre: g, jours: [...new Set((c.jours ?? []).map((j) => entier(j, -1)))].sort((a, b) => a - b), heure: String(c.heure ?? '') };
    if (g === 'mois') return { genre: g, jour: entier(c.jour, 0), heure: String(c.heure ?? '') };
    if (g === 'une_fois') return { genre: g, date: String(c.date ?? ''), heure: String(c.heure ?? '') };
    if (g === 'minutes') return { genre: g, n: entier(c.n, 0) };
    if (g === 'heures') { const m = entier(c.minute, 0); return m ? { genre: g, n: entier(c.n, 0), minute: m } : { genre: g, n: entier(c.n, 0) }; }
    if (g === 'cron') return { genre: g, cron: String(c.cron ?? '').trim().replace(/\s+/g, ' ') };
    return { genre: 'jour', heure: String(c?.heure ?? '') };
  }
  const dateValide = (d) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d)); if (!m) return false;
    const x = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return x.getUTCFullYear() === +m[1] && x.getUTCMonth() === +m[2] - 1 && x.getUTCDate() === +m[3];
  };
  /** '' quand le rythme est bon, sinon ce qui ne va pas (une phrase prête à afficher). `permis` : genres autorisés. */
  function valide(r, permis) {
    if (!r || typeof r !== 'object' || !GENRES.some((x) => x.genre === r.genre)) return 'Choisis quand.';
    if (Array.isArray(permis) && permis.length && !permis.includes(r.genre)) return 'Ce rythme n\'est pas possible ici.';
    const h = () => (HEURE.test(String(r.heure ?? '')) ? '' : 'L\'heure doit être entre 00:00 et 23:59.');
    switch (r.genre) {
      case 'jour': return h();
      case 'semaine': return !Array.isArray(r.jours) || !r.jours.length ? 'Choisis au moins un jour.' : r.jours.some((j) => !Number.isInteger(j) || j < 0 || j > 6) ? 'Jour de la semaine inconnu.' : h();
      case 'mois': return !Number.isInteger(r.jour) || r.jour < 1 || r.jour > 31 ? 'Le jour du mois va de 1 à 31.' : h();
      case 'une_fois': return !dateValide(r.date) ? 'Choisis une date.' : h();
      case 'minutes': return !Number.isInteger(r.n) || r.n < 1 || r.n > 1440 ? 'De 1 à 1440 minutes.' : '';
      case 'heures': return !Number.isInteger(r.n) || r.n < 1 || r.n > 24 ? 'De 1 à 24 heures.' : r.minute !== undefined && (!Number.isInteger(r.minute) || r.minute < 0 || r.minute > 59) ? 'La minute va de 0 à 59.' : '';
      case 'cron': return String(r.cron ?? '').trim().split(/\s+/).filter(Boolean).length !== 5 ? 'Un planning cron a 5 champs : minute heure jour mois jour-de-la-semaine.' : '';
      default: return '';
    }
  }
  /** « à 7 h 30 », « à 15 h », « à minuit », « à midi ». */
  function aHeure(hm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm ?? '')); if (!m) return '';
    const H = Number(m[1]), M = Number(m[2]);
    if (H === 0 && M === 0) return 'à minuit';
    if (H === 12 && M === 0) return 'à midi';
    return `à ${H} h${M ? ` ${String(M).padStart(2, '0')}` : ''}`;
  }
  const NOMS_JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  /**
   * La phrase d'un rythme, écrite ici quand Odin ne la donne pas (aperçu pas encore reçu ou indisponible).
   * C'est la même forme que celle d'Odin ; la sienne reste celle qui fait foi.
   */
  function phrase(r) {
    if (!r) return '';
    switch (r.genre) {
      case 'minutes': return r.n === 1 ? 'Chaque minute' : `Toutes les ${r.n} minutes`;
      case 'heures': return `${r.n === 1 ? 'Toutes les heures' : `Toutes les ${r.n} heures`}${r.minute ? `, à la minute ${r.minute}` : ''}`;
      case 'jour': return `Tous les jours ${aHeure(r.heure)}`;
      case 'semaine': {
        const j = [...new Set(r.jours ?? [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
        if (j.length === 7) return `Tous les jours ${aHeure(r.heure)}`;
        if (j.join(',') === '1,2,3,4,5') return `Du lundi au vendredi ${aHeure(r.heure)}`;
        const noms = j.map((x) => NOMS_JOURS[x]); const liste = noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et le ${noms.at(-1)}` : noms[0] ?? '';
        return `Chaque semaine, le ${liste} ${aHeure(r.heure)}`;
      }
      case 'mois': return `Chaque mois, le ${r.jour === 1 ? '1er' : r.jour}${r.jour >= 29 ? ' (ou le dernier jour)' : ''} ${aHeure(r.heure)}`;
      case 'une_fois': {
        if (!dateValide(r.date)) return 'Une seule fois';
        const [y, m, d] = r.date.split('-').map(Number);
        const t = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
        return `Une seule fois, le ${t} ${aHeure(r.heure)}`;
      }
      case 'cron': return `Planning expert : ${r.cron}`;
      case 'secondes': return r.n >= 300 ? `Toutes les ${Math.round(r.n / 60)} minutes` : r.n === 60 ? 'En continu, chaque minute' : `En continu, toutes les ${r.n} secondes`;
      case 'libre': return String(r.texte ?? '');
      default: return '';
    }
  }

  // ---------------- Dessin
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  /** Un appel à Odin ; null quand la fonction n'existe pas (404, 403, réseau, réponse sans « ok »). */
  async function appel(path, body) {
    try {
      const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) } : { headers: { 'x-odin': '1' } });
      if (!r.ok && r.status !== 200) return null;
      const j = await r.json(); return j && typeof j === 'object' && 'ok' in j ? j : null;
    } catch { return null; }
  }
  const css = `
.ry{display:flex;flex-direction:column;gap:10px;min-width:0}.ry-l{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.ry label{font-size:14px;font-weight:600}
.ry select,.ry input{box-sizing:border-box;min-height:44px;padding:0 12px;border-radius:10px;border:1px solid var(--field,var(--line));background:var(--panel2,transparent);color:var(--ink);font:inherit;font-size:15px}
.ry input[type=number]{width:96px}.ry input.ry-cron{flex:1 1 200px;font-family:ui-monospace,Menlo,Consolas,monospace}
.ry-j{display:flex;gap:4px;flex-wrap:wrap}.ry-j button{width:44px;height:44px;border-radius:50%;border:1px solid var(--field,var(--line));background:var(--panel,transparent);color:var(--ink);font:inherit;font-weight:600;cursor:pointer}
.ry-j button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--on-accent,#fff)}.ry-j button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ry-ap{font-size:14px;padding:8px 10px;border-radius:10px;background:var(--panel2,transparent);border:1px solid var(--line)}.ry-ap b{display:block}.ry-ap ul{margin:4px 0 0;padding-left:18px;color:var(--muted)}.ry-ap small{display:block;color:var(--muted);margin-top:4px}
.ry-err{color:var(--bad);font-size:14px;margin:0}.ry-err:empty{display:none}
`;
  let styled = false, compteur = 0;
  function style() { if (styled) return; styled = true; document.head.append(el('style', {}, css)); }

  /**
   * Le sélecteur de rythme. `valeur` : le rythme de départ ; `permis` : les genres possibles (vide ou absent : tous) ;
   * `onChange(rythme)` : appelé à chaque rythme valable. L'élément rendu porte `.lire()` : le rythme valable, ou null.
   */
  function editeur({ valeur, permis, onChange } = {}) {
    style();
    const id = `ry${++compteur}`, c = versChamps(valeur);
    const genres = GENRES.filter((g) => !Array.isArray(permis) || !permis.length || permis.includes(g.genre));
    if (!genres.some((g) => g.genre === c.genre) && genres[0]) c.genre = genres[0].genre;
    const box = el('div', { class: 'ry' }), champs = el('div', { class: 'ry-l' }), err = el('p', { class: 'ry-err', role: 'alert' }), ap = el('div', { class: 'ry-ap', role: 'status', 'aria-live': 'polite' });
    const sel = el('select', { id: `${id}-g`, onchange: () => { c.genre = sel.value; if (c.genre === 'minutes' && c.n > 1440) c.n = 15; if (c.genre === 'heures' && (c.n < 1 || c.n > 24)) c.n = 1; dessiner(); changer(); } }, ...genres.map((g) => el('option', { value: g.genre, selected: g.genre === c.genre ? true : undefined }, g.label)));
    let courant = null, minuterie = null, demande = 0;
    const heureInput = () => el('input', { type: 'time', id: `${id}-h`, value: c.heure, 'aria-label': 'Heure', required: true, oninput: (e) => { c.heure = e.target.value; changer(); } });
    function dessiner() {
      const g = c.genre, kids = [];
      if (g === 'semaine') kids.push(el('div', { class: 'ry-j', role: 'group', 'aria-label': 'Jours de la semaine' }, ...JOURS.map(([n, court, long]) => el('button', { type: 'button', 'aria-pressed': String(c.jours.includes(n)), 'aria-label': long, title: long, onclick: (e) => { c.jours = c.jours.includes(n) ? c.jours.filter((x) => x !== n) : [...c.jours, n]; e.currentTarget.setAttribute('aria-pressed', String(c.jours.includes(n))); changer(); } }, court))));
      if (g === 'mois') kids.push(el('label', { for: `${id}-d` }, 'Le'), el('input', { type: 'number', id: `${id}-d`, min: '1', max: '31', value: String(c.jour), oninput: (e) => { c.jour = Number(e.target.value); changer(); } }));
      if (g === 'une_fois') kids.push(el('label', { for: `${id}-dt` }, 'Le'), el('input', { type: 'date', id: `${id}-dt`, value: c.date, oninput: (e) => { c.date = e.target.value; changer(); } }));
      if (g === 'jour' || g === 'semaine' || g === 'mois' || g === 'une_fois') kids.push(el('label', { for: `${id}-h` }, 'à'), heureInput());
      if (g === 'minutes' || g === 'heures') kids.push(el('label', { for: `${id}-n` }, 'Toutes les'), el('input', { type: 'number', id: `${id}-n`, min: '1', max: g === 'minutes' ? '1440' : '24', value: String(c.n), oninput: (e) => { c.n = Number(e.target.value); changer(); } }), el('span', {}, g === 'minutes' ? 'minutes' : 'heures'));
      if (g === 'heures') kids.push(el('label', { for: `${id}-m` }, 'à la minute'), el('input', { type: 'number', id: `${id}-m`, min: '0', max: '59', value: String(c.minute), oninput: (e) => { c.minute = Number(e.target.value); changer(); } }));
      if (g === 'cron') kids.push(el('label', { for: `${id}-c`, class: 'sr' }, 'Planning cron'), el('input', { class: 'ry-cron', id: `${id}-c`, value: c.cron, placeholder: '30 7 * * 1-5', spellcheck: 'false', autocomplete: 'off', oninput: (e) => { c.cron = e.target.value; changer(); } }));
      champs.replaceChildren(...kids);
    }
    function changer() {
      const r = depuisChamps(c), e = valide(r, permis);
      err.textContent = e; courant = e ? null : r;
      if (e) { ap.replaceChildren(); return; }
      ap.replaceChildren(el('b', {}, phrase(r)));
      try { onChange?.(r); } catch { /* le parent gère */ }
      clearTimeout(minuterie);
      minuterie = setTimeout(() => apercu(r), 300);
    }
    async function apercu(r) {
      const n = ++demande, x = await appel('/api/draupnir/rythme/apercu', r.genre === 'cron' ? { cron: r.cron } : { rythme: r });
      if (n !== demande || !x) return;
      // Refusé par le serveur (date déjà passée, planning qui ne tombe jamais) : le message sous « Quand », plus de phrase.
      if (!x.ok) { err.textContent = x.error ?? 'Rythme refusé.'; ap.replaceChildren(); return; }
      ap.replaceChildren(...[el('b', {}, x.phrase ?? phrase(r)),
        Array.isArray(x.prochainesTexte) && x.prochainesTexte.length ? el('ul', { 'aria-label': 'Prochaines exécutions' }, ...x.prochainesTexte.slice(0, 3).map((t) => el('li', {}, t))) : null,
        x.fuseau ? el('small', {}, x.ville ? `Heure de ${x.ville} (${x.fuseau})` : `Fuseau : ${x.fuseau}`) : null].filter(Boolean));
    }
    box.append(el('div', { class: 'ry-l' }, el('label', { for: `${id}-g` }, 'Quand'), sel), champs, err, ap);
    box.lire = () => courant;
    dessiner(); changer();
    return box;
  }

  window.OdinRythme = { editeur, phrase, logique: { GENRES, versChamps, depuisChamps, valide, phrase, aHeure } };
})();
