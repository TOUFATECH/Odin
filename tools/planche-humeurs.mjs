// La planche des humeurs d'Odin : les 66 visages en 72, 46 et 22 px, chacun avec sa couleur, pour régler à l'œil
// (teintes pâles, ombre de la peur, points de réflexion, lisibilité en tout petit). Elle ne modifie rien dans le dépôt.
//
// Usage : node tools/planche-humeurs.mjs              → page servie sur http://127.0.0.1:4517/
//         node tools/planche-humeurs.mjs 4600         → même page sur un autre port
//         node tools/planche-humeurs.mjs planche.html → la page est écrite dans ce fichier
// Dans l'adresse : ?clair (page claire) · ?fige (aucune animation) · ?f=joie,peur (seulement ces familles).
// En haut de la page, un Odin vivant : un clic sur une case lui fait ressentir l'émotion (couleur, durée, retour au thème).
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const lire = (chemin) => readFileSync(new URL(chemin, ROOT), 'utf8');

function page() {
  // Les règles d'affichage de la mascotte sont celles de l'interface (même découpe que le guide).
  const ui = lire('src/web/ui.html').split('\n');
  const de = ui.findIndex((l) => l.startsWith('.odin{display:inline-block')), a = ui.findIndex((l) => l.startsWith('@media (prefers-reduced-motion:reduce){.odin .talk'));
  if (de < 0 || a < de) throw new Error('règles de la mascotte introuvables dans src/web/ui.html');
  const regles = ui.slice(de, a + 1).join('\n'), mascotte = lire('tools/site/parts/mascot.svg').trim(), visage = lire('src/web/face.js');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Planche des humeurs d'Odin</title>
<style>
body{margin:0;padding:14px 16px 40px;font:13px/1.35 system-ui,sans-serif;background:#101A24;color:#E6ECEF}
body.clair{background:#EEF2F1;color:#15212B}
h1{font-size:16px;margin:0 0 4px}h2{font-size:13px;margin:18px 0 6px;opacity:.85}
p{margin:0 0 8px;opacity:.75;max-width:900px}
.vivant{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin:10px 0 4px;padding:10px 12px;border:1px solid #8884;border-radius:12px}
.vivant .odin{width:84px;height:84px;flex:none}
.vivant pre{margin:0;font:12px/1.4 ui-monospace,Consolas,monospace;white-space:pre-wrap;min-width:260px;flex:1}
.vivant button{font:inherit;color:inherit;background:none;border:1px solid #8886;border-radius:8px;padding:5px 9px;cursor:pointer}
.rang{display:flex;flex-wrap:wrap;gap:8px}
.case{width:152px;border:1px solid #8884;border-radius:10px;padding:8px 6px 6px;display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;background:none;color:inherit;font:inherit}
.case:hover{border-color:#8889}
.trio{display:flex;align-items:flex-end;gap:10px;height:84px}
.t72{width:72px;height:72px}.t46{width:46px;height:46px}.t22{width:22px;height:22px}
.case b{font-size:12px}.case small{opacity:.7;font-size:10.5px;text-align:center}
${regles}
</style></head>
<body>
<h1>Les humeurs d'Odin</h1>
<p>Chaque case montre une émotion en 72, 46 et 22 px, avec sa couleur. Clique une case : l'Odin vivant la ressent (couleur le temps de l'émotion, puis retour à la couleur du thème).</p>
<div class="vivant"><span class="odin" id="vivant">${mascotte}</span><pre id="etat"></pre>
<span><button type="button" data-essai="ecoute">Écoute (tenue)</button> <button type="button" data-essai="cache">Cache (tenue)</button> <button type="button" data-essai="lache">Lâcher</button> <button type="button" data-essai="parle">Parle 3 s</button> <button type="button" data-essai="theme">Autre thème</button></span></div>
<div id="planche"></div>
<script>${visage}</script>
<script>
const F = window.OdinFace, MASCOTTE = ${JSON.stringify(mascotte)}, Q = new URLSearchParams(location.search);
if (Q.has('clair')) document.body.classList.add('clair');
if (Q.has('fige')) { const st = document.createElement('style'); st.textContent = '.odin *{animation:none!important;transition:none!important}'; document.head.append(st); }
const NS = 'http://www.w3.org/2000/svg';
// Un visage fixe : le dessin pur de l'émotion, posé tel quel avec sa couleur (sans passer par la vie de l'émotion).
function fixe(id, px) {
  const s = document.createElement('span'); s.className = 'odin t' + px; s.innerHTML = MASCOTTE; F.own(s.querySelector('svg'));
  const D = F.dessin(id, { taille: px <= 30 ? 'mini' : px <= 46 ? 'petit' : 'grand' }), body = s.querySelector('.body'), yeux = body.querySelector('.eyes');
  const g = (c, avant) => { const x = document.createElementNS(NS, 'g'); x.setAttribute('class', c); if (avant) body.insertBefore(x, avant); else body.append(x); return x; };
  g('sous', yeux).innerHTML = D.sous;
  yeux.innerHTML = '<g class="regard"><g class="brow l"><g class="taille">' + D.yeux[0] + '</g></g><g class="brow r"><g class="taille">' + D.yeux[1] + '</g></g></g>';
  g('brows').innerHTML = D.sourcils; g('mouth').innerHTML = D.bouche; g('cheeks').innerHTML = D.joues; g('extra').innerHTML = D.extras;
  for (const [k, v] of Object.entries(D.vars)) s.style.setProperty(k, v);
  s.style.setProperty('--o-encre', D.encre);
  s.classList.add(...D.classes);
  s.querySelectorAll('[id^="odinBody"] stop').forEach((st, i) => { st.style.stopColor = D.tint[i]; });
  s.querySelectorAll('[id^="odinHalo"] stop').forEach((st) => { st.style.stopColor = D.tint[3]; });
  s.title = id + ' : yeux ' + D.forme + ' ' + JSON.stringify(D.mesure);
  return s;
}
const vivant = document.getElementById('vivant'), seules = Q.get('f') ? Q.get('f').split(',') : null, parId = Object.fromEntries(F.liste().map((m) => [m.id, m]));
for (const [f, fa] of Object.entries(F.FAMILLES)) {
  if (seules && !seules.includes(f)) continue;
  const h = document.createElement('h2'); h.textContent = fa.nom; const r = document.createElement('div'); r.className = 'rang';
  for (const id of fa.ids) {
    const m = parId[id], c = document.createElement('button'); c.type = 'button'; c.className = 'case';
    const t = document.createElement('div'); t.className = 'trio'; t.append(fixe(id, 72), fixe(id, 46), fixe(id, 22));
    const b = document.createElement('b'); b.textContent = m.emoji + ' ' + id + ' · ' + m.degre;
    const sm = document.createElement('small'); sm.textContent = m.nom + ' · ' + m.dure + ' s';
    c.append(t, b, sm); c.addEventListener('click', () => F.ressent(vivant, id, { force: true, sansHabitude: true, raison: 'planche' })); r.append(c);
  }
  document.getElementById('planche').append(h, r);
}
// L'Odin vivant : au repos, la couleur du thème ; son état est écrit à côté.
F.set(vivant, 'neutre');
const THEMES = ['#22AA66', '#B8862B', null]; let theme = 0;
document.addEventListener('click', (e) => {
  const k = e.target.closest('[data-essai]')?.dataset.essai; if (!k) return;
  if (k === 'ecoute' || k === 'cache') F.tenir(vivant, k, 'planche');
  else if (k === 'lache') F.lacher(vivant, 'planche');
  else if (k === 'parle') F.parole(vivant, true, 3000);
  else if (k === 'theme') F.tintBase(THEMES[theme++ % THEMES.length]);
});
const ecrire = () => { const s = F.etat(vivant); document.getElementById('etat').textContent = 'montre : ' + s.id + (s.couleur ? ' (en couleur ' + s.teinte + ')' : ' (couleur du thème ' + s.teinte + ')') + '\\nfond : ' + s.fond + ' · émotion : ' + (s.emotion ? s.emotion.id + ', encore ' + Math.max(0, Math.round((s.emotion.a - Date.now()) / 1000)) + ' s' : 'aucune') + ' · tenu : ' + (s.tenu || 'rien') + ' · parle : ' + (s.parle ? 'oui' : 'non'); };
ecrire(); setInterval(ecrire, 500);
</script></body></html>`;
}

const arg = process.argv[2];
if (arg && !/^\d+$/.test(arg)) { writeFileSync(arg, page(), 'utf8'); console.log(`planche écrite : ${arg}`); }
else {
  const port = Number(arg) || 4517;
  createServer((req, res) => {
    try { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(page()); }
    catch (e) { res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }); res.end(String(e && e.stack)); }
  }).listen(port, '127.0.0.1', () => console.log(`planche : http://127.0.0.1:${port}/`));
}
