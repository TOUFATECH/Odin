// Mesure de la mémoire de Pégase (app.getAppMetrics) avec 1, 5 et 20 onglets réels (pages locales lourdes :
// texte, images, script), puis après la mise en veille des onglets inactifs. Lancer : xvfb-run -a node test/outils/memoire.mjs
import { lancer, serveur, principal } from '../banc.mjs';
const page = (i) => `<!doctype html><meta charset="utf-8"><title>Article ${i}</title><style>body{font:16px system-ui;max-width:800px;margin:auto}img{width:100%;height:auto}</style>
<h1>Article ${i}</h1>${Array.from({ length: 60 }, (_, k) => `<p>${'Mayotte, île aux parfums, lagon et mangrove. '.repeat(8)} ${k}</p>`).join('')}
<canvas id="c" width="1200" height="800"></canvas><script>const c=document.getElementById('c').getContext('2d');for(let y=0;y<800;y+=8)for(let x=0;x<1200;x+=8){c.fillStyle='hsl('+((x+y+${i * 37})%360)+',70%,50%)';c.fillRect(x,y,8,8)}
window.donnees=Array.from({length:20000},(_, k)=>({k,t:'element '+k}));</script>`;
const web = await serveur({ '*': (q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(page(q.url)); } });
const { app, ui, fermer } = await lancer({ env: { PEGASE_DNS: 'systeme', PEGASE_LISTES: '/dev/null' } });
const mo = () => principal(app, () => globalThis.__pegase.memoire());
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const res = {};
try {
  await pause(3000); res['0 onglet'] = (await mo()).total;
  let n = 0;
  for (const cible of [1, 5, 20]) {
    while (n < cible) { await ui.evaluate((u) => window.pegase.faire('ouvrir', { url: u }), `${web.url}/a${n}`); n++; await pause(700); }
    await pause(4000); const m = await mo(); res[`${cible} onglet${cible > 1 ? 's' : ''}`] = m.total; res[`${cible} (processus)`] = m.processus.length;
  }
  // Mise en veille : tous les onglets sauf celui qu'on regarde (comme après 10 minutes sans les ouvrir).
  await principal(app, () => { const f = [...globalThis.__pegase.fenetres][0]; const p = f.profil; const c = f.ongletCourant(); for (const [id, v] of p.vivants) if (v.vue && id !== c) p.endormir(id); });
  await pause(4000); res['20 onglets, 19 en veille'] = (await mo()).total;
  console.log(JSON.stringify(res, null, 1));
} finally { await fermer(); await web.fermer(); }
