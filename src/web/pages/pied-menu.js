// Pied du menu d'Odin : les IA configurées (service, modèle, version configurée, celle qui sert en ce moment),
// ou « Cerveau d'Odin · autonome » quand aucun modèle n'est prêt ; puis la consommation des 24 heures (seulement
// avec un modèle, et seulement si la page la recevait déjà), la version d'Odin avec « Mises à jour », et le thème.
// Tout vient de l'état déjà envoyé à la page (state.settings.providers, state.usage) : aucune nouvelle route.
// Jamais d'adresse de serveur, de clé ni de jeton : seuls le nom lisible et l'identifiant du modèle sont recopiés.
// Un clic sur le bloc IA mène aux Réglages, rubrique Modèle. Menu replié : une seule pastille, le détail au survol.
// Ce fichier est chargé avant les autres scripts de l'interface : rien ne touche au document à son chargement ;
// le style est injecté une seule fois, au premier dessin (balise #pmCss).
// API : OdinPiedMenu.peindre(state), OdinPiedMenu.noterModele(nom), OdinPiedMenu.logique (pure).
(() => {
  'use strict';
  if (window.OdinPiedMenu) return;

  // ---------------- Logique pure (sans document)
  const MAX_LIGNES = 2;
  const PALIER = { local: 'sur ta machine', standard: 'palier standard', strong: 'palier le plus capable' };
  /** « Claude Sonnet 5.5 (Anthropic) » → { service: 'Anthropic', modele: 'Claude Sonnet 5.5' } ; sinon le nom entier. */
  function decouper(label) {
    const t = String(label || '').trim(), m = /^(.*\S)\s*\(([^()]+)\)$/.exec(t);
    return m ? { service: m[2].trim(), modele: m[1].trim() } : { service: '', modele: t };
  }
  /** Les deux premiers caractères lettres ou chiffres, la première en majuscule (« GPT-6 Luna » → « GP »). */
  function sigleDe(nom) {
    const c = String(nom || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2);
    return c ? c[0].toUpperCase() + c.slice(1) : null;
  }
  const norm = (s) => String(s || '').trim().toLowerCase();
  /** Vrai si le nom reçu avec une réponse (« Claude Sonnet 5.5 (Anthropic) », « anthropic:claude-sonnet-5-5 »…) désigne ce modèle. */
  function correspond(p, nom) {
    const n = norm(nom); if (!n) return false;
    const label = norm(p.label), model = norm(p.model);
    return n === label || n === model || (model && (n.endsWith(`:${model}`) || n.endsWith(`/${model}`))) || (label && n.includes(label));
  }
  function lignes(state, dernier) {
    const st = state || {}, reglages = st.settings || {};
    const prets = (Array.isArray(reglages.providers) ? reglages.providers : []).filter((p) => p && p.ready);
    const autonome = reglages.modelePret === false || !prets.length;
    let ia = [];
    if (!autonome) {
      const enCours = prets.find((p) => correspond(p, dernier)) || prets[0];
      ia = prets.map((p, k) => {
        const { service, modele } = decouper(p.label || p.model);
        const id = String(p.model || '');
        const role = (typeof p.index === 'number' ? p.index : k) === 0 ? 'principal' : 'secours';
        const titre = [service, modele, id ? `modèle configuré : ${id}` : '', PALIER[p.tier] || ''].filter(Boolean).join(' · ');
        return { role, service, modele, id, enCours: p === enCours, titre };
      });
      // Le principal en premier, puis les secours dans l'ordre des réglages.
      ia.sort((a, b) => (a.role === b.role ? 0 : a.role === 'principal' ? -1 : 1));
    }
    const reste = Math.max(0, ia.length - MAX_LIGNES);
    const u = st.usage;
    const conso = !autonome && u ? { jetons: (Number(u.tokens_in) || 0) + (Number(u.tokens_out) || 0), cout: Number(u.cost_usd) || 0 } : null;
    const titre = autonome
      ? 'Cerveau d\'Odin · autonome : il répond avec son Cerveau et sa mémoire, sans modèle d\'IA.'
      : ia.map((l) => `${l.titre}${l.enCours ? ' (en service)' : ''}`).join('\n');
    const pastille = { cerveau: autonome, sigle: autonome ? null : sigleDe(ia[0]?.modele || ia[0]?.id), titre };
    return { autonome, ia: ia.slice(0, MAX_LIGNES), autres: ia.slice(MAX_LIGNES), reste, conso, pastille };
  }

  // ---------------- Dessin
  const css = `
#piedMenu{gap:6px;padding-bottom:4px}
.pm-l{display:flex;align-items:center;gap:8px;min-width:0;font-size:12.5px;color:var(--dim);flex-wrap:nowrap}
.pm-l>span,.pm-l>a,.pm-l>button{min-width:0;overflow-wrap:anywhere}
.pm-ic{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.pm-ia{display:flex;align-items:flex-start;gap:8px;width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--ink);font:inherit;text-align:left;cursor:pointer;min-width:0}
.pm-ia:hover{border-color:var(--field-h,var(--accent))}
.pm-ia[hidden]{display:none}
.pm-ia-l{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}
.pm-t{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
.pm-r{display:flex;flex-direction:column;min-width:0}
.pm-n{display:flex;align-items:center;gap:6px;min-width:0;font-size:13px;font-weight:600}
.pm-n>span{min-width:0;overflow-wrap:anywhere;line-height:1.3}
.pm-s{font-size:11.5px;color:var(--dim);overflow-wrap:anywhere;line-height:1.3}
.pm-on{flex:none;width:8px;height:8px;border-radius:50%;background:var(--good);box-shadow:0 0 0 3px color-mix(in srgb,var(--good) 22%,transparent)}
.pm-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
.pm-plus{font-size:12px;color:var(--dim)}
.pm-plus summary{cursor:pointer;padding:2px 10px}
.pm-plus .pm-r{padding:4px 10px}
.pm-pastille{display:none;width:32px;height:32px;border-radius:50%;place-items:center;background:var(--sel);color:var(--accent);font-size:12.5px;font-weight:700;flex:none}
.pm-pastille .pm-ic{width:18px;height:18px}
@media (min-width:861px){
.app.replie:not(.sideopen) #piedMenu>:not(#piedIA){display:none}
.app.replie:not(.sideopen) #piedIA{padding:0;border:0;background:none;justify-content:center}
.app.replie:not(.sideopen) #piedIA .pm-ia-l{display:none}
.app.replie:not(.sideopen) .pm-pastille{display:grid}
}
`;
  const ICONES = {
    puce: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
    cerveau: '<path d="M9.5 4.5a3 3 0 0 0-5 2.5 3 3 0 0 0-1 5.2A3.2 3.2 0 0 0 7 17a2.8 2.8 0 0 0 5 1.5V6a2.5 2.5 0 0 0-2.5-1.5zM14.5 4.5a3 3 0 0 1 5 2.5 3 3 0 0 1 1 5.2A3.2 3.2 0 0 1 17 17a2.8 2.8 0 0 1-5 1.5"/>',
    jetons: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.5 10a2.5 2 0 0 1 5 0c0 2.5-5 1.5-5 4a2.5 2 0 0 0 5 0"/>',
  };
  const ic = (nom) => `<svg class="pm-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONES[nom]}</svg>`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const nombre = (n) => { try { return n.toLocaleString('fr-FR'); } catch { return String(n); } };
  // « En service » : un point vert devant le nom (texte lu par les lecteurs d'écran), pour laisser toute la largeur
  // au service, au modèle et à sa version, qui passent à la ligne au lieu d'être coupés.
  const ligneHtml = (l) => `<span class="pm-r"><span class="pm-n">${l.enCours ? '<i class="pm-on" title="en service"></i>' : ''}<span>${esc([l.service, l.modele].filter(Boolean).join(' · '))}${l.enCours ? '<span class="pm-sr"> (en service)</span>' : ''}</span></span><span class="pm-s">${esc(l.role)}${l.id ? ` · ${esc(l.id)}` : ''}</span></span>`;

  let dernier = null, dernierState = null;
  function injecterStyle() {
    if (document.getElementById('pmCss')) return;
    const s = document.createElement('style'); s.id = 'pmCss'; s.textContent = css; document.head.append(s);
  }
  function versReglages() {
    if (typeof window.OdinShow === 'function') window.OdinShow('settings');
    setTimeout(() => document.querySelector('.schip[data-sec="modele"]')?.click(), 0);
  }
  function peindre(state) {
    if (typeof document === 'undefined') return;
    dernierState = state;
    const bouton = document.getElementById('piedIA'), usage = document.getElementById('usage');
    const L = lignes(state, dernier);
    if (!bouton) { // ancien pied : la ligne de consommation d'avant
      if (usage && state?.usage) usage.textContent = `24 h : ${nombre((state.usage.tokens_in || 0) + (state.usage.tokens_out || 0))} jetons · ${(state.usage.cost_usd || 0).toFixed(3)} $`;
      return;
    }
    injecterStyle();
    if (!bouton.dataset.pm) { bouton.dataset.pm = '1'; bouton.addEventListener('click', versReglages); }
    // Sans les réglages (la page ne les reçoit pas), on ne devine rien.
    bouton.hidden = !state?.settings;
    const pastille = L.pastille.cerveau ? ic('cerveau') : esc(L.pastille.sigle || 'IA');
    const corps = L.autonome
      ? `<span class="pm-t">${ic('cerveau')}IA</span><span class="pm-r"><span class="pm-n"><span>Cerveau d'Odin · autonome</span></span><span class="pm-s">répond avec son Cerveau et sa mémoire</span></span>`
      : `<span class="pm-t">${ic('puce')}IA</span>${L.ia.map(ligneHtml).join('')}`;
    bouton.innerHTML = `<span class="pm-pastille" aria-hidden="true">${pastille}</span><span class="pm-ia-l">${corps}</span>`;
    bouton.title = `${L.pastille.titre}\nClic : réglages des modèles`;
    bouton.setAttribute('aria-label', `IA : ${L.autonome ? 'Cerveau d\'Odin, autonome' : L.ia.map((l) => `${[l.service, l.modele].filter(Boolean).join(' ')}${l.enCours ? ', en service' : ''}`).join(' ; ')}. Ouvrir les réglages des modèles`);
    // Au-delà de deux modèles, les autres sont repliés juste sous le bloc (pas de <details> dans un bouton).
    let plus = document.getElementById('piedIAPlus');
    if (L.reste) {
      if (!plus) { plus = document.createElement('details'); plus.id = 'piedIAPlus'; plus.className = 'pm-plus'; bouton.after(plus); }
      const ouvert = plus.open;
      plus.innerHTML = `<summary>+ ${L.reste} autre${L.reste > 1 ? 's' : ''}</summary>${L.autres.map(ligneHtml).join('')}`;
      plus.open = ouvert;
    } else plus?.remove();
    if (usage) {
      usage.hidden = !L.conso;
      if (L.conso) usage.innerHTML = `${ic('jetons')}<span>24 h : ${nombre(L.conso.jetons)} jetons · ${L.conso.cout.toFixed(3)} $</span>`;
    }
  }
  /** Une réponse vient d'arriver avec le nom du modèle qui l'a écrite : il devient « en service ». */
  function noterModele(nom) {
    if (!nom || nom === dernier) return;
    dernier = String(nom);
    if (dernierState) peindre(dernierState);
  }

  window.OdinPiedMenu = { peindre, noterModele, logique: { lignes, decouper, sigleDe, MAX_LIGNES } };
})();
