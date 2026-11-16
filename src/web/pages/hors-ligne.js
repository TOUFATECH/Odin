// Le message commun « ça n'a pas pu se mettre à jour » et le repli d'image, posés à la place de ce qui manque quand une
// ressource extérieure ne répond pas. Un seul composant pour toutes les applis : quoi (ce qui manque), pourquoi (la vraie
// cause, lue dans state.internet.services), depuis quand, ce qu'on montre à la place (marqué « ancien »), et ce qu'on peut
// faire (« Réessayer », ou « Ça repartira tout seul » quand l'attente est automatique). Clair et sombre, 390 px, style d'Odin.
// Aucune touche au DOM au chargement : les éléments sont fabriqués à la demande (chargeable sans document, pour les essais).
(() => {
  'use strict';
  if (window.OdinHorsLigne && window.OdinImgRepli) return;

  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'class') n.setAttribute('class', v);
      else if (k === 'style') n.setAttribute('style', v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };

  // La CSS du composant, posée une seule fois, à la première utilisation (jamais au chargement).
  let styleFaite = false;
  const STYLE = `
.odin-hl{max-width:390px;width:100%;box-sizing:border-box;margin:8px auto;padding:16px 18px;border:1px solid var(--line,#263849);border-radius:var(--r,14px);background:var(--panel2,#13202C);color:var(--ink,#E6ECEF);font:14px/1.5 var(--body,system-ui),sans-serif;display:flex;flex-direction:column;gap:10px}
.odin-hl-tete{display:flex;align-items:flex-start;gap:10px}
.odin-hl-ic{flex:none;width:32px;height:32px;border-radius:10px;display:grid;place-items:center;background:var(--warn-bg,#1F1D16);color:var(--warn,#F0B860)}
.odin-hl-ic svg{width:19px;height:19px}
.odin-hl-quoi{font-weight:600;font-size:15px}
.odin-hl-pourquoi{color:var(--muted,#A9B8C4);font-size:13.5px}
.odin-hl-depuis{color:var(--dim,#8FA0AE);font-size:12.5px}
.odin-hl-ancien{background:var(--hover,#1C2D3D);border-radius:10px;padding:9px 11px;font-size:13px;color:var(--ink,#E6ECEF)}
.odin-hl-ancien b{display:inline-block;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--warn,#F0B860);font-weight:700;margin-right:6px}
.odin-hl-pied{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.odin-hl-rees{border:0;background:var(--accent,#E3AC3F);color:var(--on-accent,#14100A);font-weight:600;border-radius:11px;padding:8px 14px;font-size:13.5px;cursor:pointer}
.odin-hl-rees:disabled{opacity:.55;cursor:default}
.odin-hl-auto{color:var(--dim,#8FA0AE);font-size:12.5px}
.odin-img-repli{display:inline-grid;place-items:center;flex:none;background:var(--field,#2E4356);color:var(--ink,#E6ECEF);font-weight:700;overflow:hidden;line-height:1}`;
  function poserStyle() {
    if (styleFaite) return; styleFaite = true;
    try { document.head.append(el('style', {}, STYLE)); } catch { /* pas de document : rien à poser */ }
  }

  // L'icône « nuage barré » (ressource hors d'atteinte).
  const iconeNuage = () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M4 4l16 16M7 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 17 9M20 15.5a4 4 0 0 0-2.3-3.6');
    p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
    svg.append(p); return svg;
  };

  // « depuis quand » en toutes lettres : aujourd'hui → « depuis 14 h 02 » ; un autre jour → la date.
  function formatDepuis(depuis) {
    if (depuis === undefined || depuis === null || depuis === '') return '';
    if (typeof depuis === 'string') return depuis;
    const d = new Date(depuis); if (Number.isNaN(d.getTime())) return '';
    const h = `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
    const auj = d.toDateString() === new Date().toDateString();
    return auj ? `depuis ${h}` : `depuis le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} à ${h}`;
  }

  // La durée écoulée en mots (« 10 min », « 2 h »), pour « tel service ne répond pas depuis 10 min ».
  function depuisCombien(depuis) {
    if (typeof depuis !== 'number') return '';
    const s = Math.max(0, Math.round((Date.now() - depuis) / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.round(s / 60); if (m < 60) return `${m} min`;
    const h = Math.round(m / 60); return h < 24 ? `${h} h` : `${Math.round(h / 24)} j`;
  }

  // La cause, en français, lue dans l'état réseau partagé (OdinReseau) pour un hôte donné.
  // Sans hôte : l'état général du réseau. Renvoie '' si tout va bien (l'appelant garde alors sa propre phrase).
  function raison(hote) {
    const net = window.OdinReseau?.etat?.();
    if (!net) return '';
    if (net.reseau === 'sans-reseau') return 'pas de réseau du tout';
    if (net.reseau === 'dns-muet') return 'la résolution des noms (DNS) est en panne';
    if (net.reseau === 'reseau-sans-internet') return 'pas de connexion Internet';
    const s = hote && net.services && net.services[hote];
    if (s && s.etat && s.etat !== 'ok') {
      const nom = joliHote(hote), quand = depuisCombien(s.depuis);
      const dep = quand ? ` depuis ${quand}` : '';
      if (s.etat === 'muet') return `${nom} ne répond pas${dep}`;
      if (s.etat === 'lent') return `${nom} répond très lentement${dep}`;
      if (s.etat === 'refus') return `${nom} a refusé la requête${dep}`;
      if (s.etat === 'limite') return `${nom} a atteint sa limite de requêtes${dep}`;
      return s.motif || `${nom} ne répond pas${dep}`;
    }
    return '';
  }

  // Un nom d'hôte plus lisible : api.open-meteo.com → Open-Meteo ; sinon le domaine sans « www. » / « api. ».
  const JOLIS = {
    'api.open-meteo.com': 'Open-Meteo', 'geocoding-api.open-meteo.com': 'Open-Meteo',
    'nominatim.openstreetmap.org': 'OpenStreetMap', 'tile.openstreetmap.org': 'OpenStreetMap',
    'api.github.com': 'GitHub', 'github.com': 'GitHub', 'raw.githubusercontent.com': 'GitHub',
    'formulae.brew.sh': 'Homebrew', 'flathub.org': 'Flathub', 'huggingface.co': 'Hugging Face',
    'ipapi.co': 'ipapi', 'api.ipify.org': 'ipify',
  };
  function joliHote(h) {
    if (!h) return 'Le service';
    if (JOLIS[h]) return JOLIS[h];
    const d = String(h).replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^(www|api)\./, '');
    return d.charAt(0).toUpperCase() + d.slice(1);
  }

  // Le message lui-même. { quoi, pourquoi?, hote?, depuis?, ancien?, onReessayer? } → élément DOM à poser à la place du contenu.
  function message(o = {}) {
    poserStyle();
    const pourquoi = o.pourquoi || raison(o.hote) || 'pas de connexion Internet';
    const dep = formatDepuis(o.depuis);
    const box = el('div', { class: 'odin-hl', role: 'status' });
    box.append(el('div', { class: 'odin-hl-tete' },
      el('span', { class: 'odin-hl-ic' }, iconeNuage()),
      el('div', { style: 'min-width:0' },
        el('div', { class: 'odin-hl-quoi' }, o.quoi || 'Mise à jour impossible'),
        el('div', { class: 'odin-hl-pourquoi' }, pourquoi),
        dep ? el('div', { class: 'odin-hl-depuis' }, dep) : null)));
    if (o.ancien !== undefined && o.ancien !== null && o.ancien !== '') {
      const bloc = el('div', { class: 'odin-hl-ancien' }, el('b', {}, 'Ancien'));
      bloc.append(o.ancien.nodeType ? o.ancien : document.createTextNode(String(o.ancien)));
      box.append(bloc);
    }
    const pied = el('div', { class: 'odin-hl-pied' });
    if (typeof o.onReessayer === 'function') {
      const b = el('button', { type: 'button', class: 'odin-hl-rees' }, 'Réessayer');
      b.addEventListener('click', async () => { b.disabled = true; try { await o.onReessayer(); } finally { try { b.disabled = false; } catch { /* retiré */ } } });
      pied.append(b);
    } else {
      pied.append(el('span', { class: 'odin-hl-auto' }, 'Ça repartira tout seul au retour d\'Internet.'));
    }
    box.append(pied);
    return box;
  }

  window.OdinHorsLigne = { message, raison, formatDepuis, depuisCombien, joliHote };

  // --------- Repli d'image : jamais d'image cassée ---------
  // brancher(img, { repli?, lettre? }) : si l'image ne charge pas, essaie l'icône locale de repli,
  // puis à défaut une pastille avec une lettre. onerror est posé ; une seule tentative par étape (pas de boucle).
  function monogramme(lettre, taille) {
    const s = el('span', { class: 'odin-img-repli', 'aria-hidden': 'true' },
      String(lettre || '?').slice(0, 1).toUpperCase());
    const t = Number(taille) || 0;
    if (t) { s.style.width = `${t}px`; s.style.height = `${t}px`; s.style.borderRadius = `${Math.round(t * 0.22)}px`; s.style.fontSize = `${Math.round(t * 0.46)}px`; }
    return s;
  }
  function brancher(img, opts = {}) {
    if (!img) return img;
    const repli = opts.repli, lettre = opts.lettre;
    let etape = 0;
    const taille = () => (img.width || parseInt(img.getAttribute?.('width'), 10) || 0);
    const onErr = () => {
      if (etape === 0 && repli) { etape = 1; img.src = repli; return; }
      img.onerror = null;
      try {
        const m = monogramme(lettre || img.getAttribute?.('alt') || img.alt || '?', taille());
        if (typeof img.replaceWith === 'function') img.replaceWith(m);
        else if (img.parentNode && typeof img.parentNode.replaceChild === 'function') img.parentNode.replaceChild(m, img);
      } catch { /* l'image n'est plus dans la page : rien à remplacer */ }
    };
    img.onerror = onErr;
    return img;
  }
  window.OdinImgRepli = { brancher, monogramme };
})();
