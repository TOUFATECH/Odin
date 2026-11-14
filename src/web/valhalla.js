// Espace « Applis » : toutes les applis d'Odin (Valhalla). Une seule interface générique dessine la
// page de chaque appli à partir de sa vue (chiffres clés, tableaux, listes, journaux, formulaires,
// actions par ligne). Plus : « J'ai besoin de… » (Odin choisit l'appli et explique), le fil
// d'alertes commun, et les liens entre applis.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  // Session expirée pendant l'usage : on revient à la page de connexion. Sur la page de connexion elle-même,
  // on ne recharge rien (sinon elle se rechargerait en boucle et effacerait ce que tu tapes).
  const appShown = () => { const a = document.querySelector('#app'); return Boolean(a && !a.hidden); };
  async function api(path, body) {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) } : { headers: { 'x-odin': '1' } });
    if (r.status === 401) { if (appShown()) location.reload(); throw new Error('session expirée'); }
    return r.json();
  }
  const css = `
.va-need{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px}.va-need input{flex:1 1 260px;min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--field);background:var(--panel)}
.va-ans{white-space:pre-wrap;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:0 0 18px;line-height:1.6}
.va-graph{margin:0 0 22px}.va-fam{margin:0 0 22px}.va-fam h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin:0 0 10px}
.va-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin:0 0 16px}
.va-kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.va-kpi small{display:block;color:var(--muted);font-size:13px}.va-kpi b{font-size:22px;font-variant-numeric:tabular-nums}
.va-kpi .va-bar{height:6px;border-radius:4px;background:var(--field);margin-top:8px;overflow:hidden}.va-kpi .va-bar i{display:block;height:100%;background:var(--good)}
.va-kpi.attention b,.va-tone-attention{color:var(--warn)}.va-kpi.mauvais b,.va-tone-mauvais{color:var(--bad)}.va-kpi.bon .va-bar i{background:var(--good)}.va-kpi.attention .va-bar i{background:var(--warn)}.va-kpi.mauvais .va-bar i{background:var(--bad)}
.va-page{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:16px;align-items:start}@media (max-width:980px){.va-page{grid-template-columns:minmax(0,1fr)}}.va-page>div{min-width:0}
.va-appgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:12px 8px}.va-appbtn{display:grid;justify-items:center;gap:6px;background:none;border:0;border-radius:12px;padding:8px 4px;color:var(--ink);font:inherit;font-size:12.5px;cursor:pointer;min-width:0}.va-appbtn span{overflow-wrap:anywhere;text-align:center}.va-appbtn:hover{background:var(--panel2)}.va-appbtn:focus-visible{outline:2px solid var(--accent)}
.va-sec{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:0 0 14px;min-width:0}.va-sec h2{font-size:16px;margin:0 0 10px}
.va-tw{position:relative;overflow-x:auto;-webkit-overflow-scrolling:touch}.va-t{width:100%;border-collapse:collapse;font-size:14px}.va-t th{text-align:left;color:var(--muted);font-weight:600;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}.va-t td{padding:8px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:break-word}.va-t td.va-short{white-space:nowrap}.va-t td.va-long{overflow-wrap:anywhere;min-width:150px}.va-t tr:last-child td{border-bottom:0}
.va-t td.va-acts{white-space:nowrap}.va-t td.va-acts .btn{margin:2px 4px 2px 0}
.va-t tr.va-tone-bon td:first-child{box-shadow:inset 3px 0 var(--good)}.va-t tr.va-tone-attention td:first-child{box-shadow:inset 3px 0 var(--warn)}.va-t tr.va-tone-mauvais td:first-child{box-shadow:inset 3px 0 var(--bad)}
.va-tuiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}.va-tuile{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--panel2);min-width:0}.va-tuile.va-tone-bon{border-left:3px solid var(--good)}.va-tuile.va-tone-attention{border-left:3px solid var(--warn);color:inherit}.va-tuile.va-tone-mauvais{border-left:3px solid var(--bad);color:inherit}.va-tuile-h{display:flex;gap:10px;align-items:center;min-width:0}.va-tuile-h img,.va-tuile-i{width:40px;height:40px;border-radius:9px;flex:none;object-fit:contain;background:var(--field)}.va-tuile-i{display:grid;place-items:center;font-weight:700}.va-tuile-h b{display:block;overflow-wrap:anywhere}.va-tuile-h small{display:block;color:var(--muted);font-size:12.5px;overflow-wrap:anywhere}.va-tuile-b{align-self:flex-start;font-size:12.5px;padding:2px 8px;border-radius:999px;background:var(--field)}.va-tuile.va-tone-attention .va-tuile-b{color:var(--warn)}.va-tuile.va-tone-bon .va-tuile-b{color:var(--good)}.va-tuile.va-tone-mauvais .va-tuile-b{color:var(--bad)}.va-tuile .va-bar{height:6px;border-radius:4px;background:var(--field);overflow:hidden}.va-tuile .va-bar i{display:block;height:100%;background:var(--warn)}.va-tuile-a{display:flex;flex-wrap:wrap;gap:6px;margin-top:auto}
.va-list{list-style:none;margin:0;padding:0}.va-list li{padding:8px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.va-list li:last-child{border-bottom:0}.va-list small{display:block;color:var(--muted)}
.va-log{margin:0;max-height:320px;overflow:auto;font-size:12.5px;line-height:1.6;white-space:pre-wrap;background:var(--panel2);border-radius:10px;padding:10px}
.va-bars{display:flex;flex-direction:column;gap:6px}.va-brow{display:grid;grid-template-columns:minmax(80px,40%) 1fr auto;gap:8px;align-items:center;font-size:14px}.va-brow i{display:block;height:10px;border-radius:5px;background:var(--accent)}
.va-form label{display:block;font-size:14px;font-weight:600;margin:10px 0 4px}.va-form input:not([type=checkbox]),.va-form textarea,.va-form select{width:100%;min-height:40px;padding:8px 10px;border-radius:10px;border:1px solid var(--field);background:var(--panel2)}.va-form textarea{min-height:90px}.va-form .btn{margin-top:12px}
.va-hc{display:grid;gap:8px}.va-hc .hd{display:flex;gap:10px;align-items:center}.va-hc .hd b{font-size:17px;display:block;line-height:1.2}.va-hc .chip{font-size:11.5px;padding:1px 8px;border-radius:99px;background:color-mix(in srgb,var(--ink) 10%,transparent);color:var(--muted)}
.va-hc h4,.va-story h4{margin:0 0 2px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.va-hc p{margin:0}.va-hc ul{margin:2px 0 0;padding-left:18px}.va-hc .st{display:flex;gap:8px;flex-wrap:wrap;font-size:12.5px}.va-hc .st span{padding:1px 8px;border-radius:99px}.va-hc .al{background:#EE6A5533;color:#ffb3a6}.va-hc .up{background:#4F9DDE33;color:#a9d2ff}.va-hc .go{color:var(--muted);font-size:12px}
.va-story{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));margin:0 0 14px}.va-story>div{border:1px solid var(--line);border-radius:12px;padding:12px 14px}.va-story p{margin:0}.va-story ul{margin:0;padding-left:18px}
.va-form .va-depot{display:flex;flex-direction:column;gap:6px}.va-form .va-depot-ou{font-size:13px;font-weight:400;color:var(--muted);margin:0}.va-form .va-depot input[type=file]{min-height:40px;padding:6px 0}.va-form .va-img{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.va-form .va-img input{min-height:40px}.va-imgpv{width:120px;height:68px;object-fit:cover;border-radius:8px;border:1px solid var(--line)}.va-form .va-chk{display:flex;gap:10px;align-items:center;font-weight:500;min-height:40px}.va-form .va-chk input{width:20px;height:20px;flex:none}
.va-form small.sub{display:block;margin-top:4px}.va-form .btn{display:flex}
.va-out{white-space:pre-wrap;font-size:14px;margin-top:10px;padding:10px;border-radius:10px;background:var(--panel2);overflow-wrap:anywhere}.va-out:empty{display:none}
.va-dl{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.va-dl:empty{display:none}.va-dl .btn{text-decoration:none}.va-form .va-dl .btn{margin-top:0}.va-res-x{margin:6px 0 12px}.va-res-x[hidden],.va-form .va-res-x[hidden]{display:none}.va-acts-bar+.va-out{margin:-6px 0 4px}
.va-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px}.va-tabs span{padding:4px 12px;border-radius:999px;border:1px solid var(--line);font-size:13px;color:var(--muted)}
.va-acts-bar{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}
.va-al{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px}.va-al>div{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}.va-al:last-child{border-bottom:0}.va-al .pill{flex:none}.va-al.ack{opacity:.55}
.va-mhead{display:none;align-items:center;gap:10px;margin:0 0 12px}.va-mhead h2{margin:0;font-size:20px}@media (max-width:700px){.va-mhead{display:flex}}
.va-links li{font-size:14px}.va-what{color:var(--muted);margin:-4px 0 14px}
.va-top{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:14px;margin:0 0 8px;align-items:start}.va-top:empty{display:none}.va-top .va-sec{margin:0 0 14px}
.va-manip{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}.va-manip>div:first-child{flex:1 1 220px;min-width:0;overflow-wrap:anywhere}.va-mbtn{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.va-prot.attention{border-color:var(--warn)}.va-t td.va-acts{white-space:normal}
.va-steps{list-style:none;margin:0;padding:0;counter-reset:st}.va-steps li{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:10px;align-items:start;padding:10px 0;border-bottom:1px solid var(--line)}.va-steps li:last-child{border-bottom:0}
.va-steps li::before{counter-increment:st;content:counter(st);display:grid;place-items:center;width:26px;height:26px;border-radius:50%;border:1px solid var(--line);font-size:13px;font-weight:600}
.va-steps li.ok::before{content:'✓';background:var(--good);border-color:var(--good);color:#fff}.va-steps small{display:block;color:var(--muted);white-space:pre-wrap}
.va-gr{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:14px;align-items:start}@media (max-width:1180px){.va-gr{grid-template-columns:minmax(0,1fr)}}.va-gr>div{min-width:0}
.va-per{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 10px}.va-per .btn[aria-pressed=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.va-fiche{border:1px solid var(--line);border-radius:14px;padding:14px;background:var(--panel2)}.va-fiche h3{margin:2px 0 4px;font-size:18px}.va-fiche .k{color:var(--muted);font-size:12.5px}
.va-chips{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.va-chips span{font-size:12.5px;padding:3px 10px;border-radius:999px;background:var(--field)}.va-chips .bon{background:color-mix(in srgb,var(--good) 22%,transparent)}.va-chips .attention{background:color-mix(in srgb,var(--warn) 25%,transparent)}.va-chips .mauvais{background:color-mix(in srgb,var(--bad) 25%,transparent)}
.va-kv{display:grid;grid-template-columns:118px minmax(0,1fr);gap:4px 10px;font-size:13.5px;margin:6px 0}.va-kv dt{color:var(--muted)}.va-kv dd{margin:0;overflow-wrap:anywhere}.va-kv dd small{display:block;color:var(--muted);font-size:12px}
.va-fl{list-style:none;margin:6px 0 0;padding:0;font-size:13px}.va-fl li{display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid var(--line)}.va-fl li small{color:var(--muted);white-space:nowrap}
.va-dlg{border:1px solid var(--line);border-radius:16px;background:var(--panel);color:inherit;padding:18px;max-width:min(560px,calc(100vw - 32px));width:100%}.va-dlg::backdrop{background:rgba(0,0,0,.45)}
.va-dlg img{display:block;width:min(320px,100%);margin:0 auto 12px;background:#fff;border-radius:10px;padding:10px}.va-dlg pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12.5px;background:var(--panel2);border-radius:10px;padding:10px;max-height:240px;overflow:auto}
#v-app>.head{display:none}#v-app>.body{background:var(--bg);--va-lien:color-mix(in srgb,var(--accent) 72%,var(--ink))}
.va-head{display:flex;flex-wrap:wrap;align-items:flex-start;gap:14px;margin:0 0 16px}.va-head>.va-tt{padding-top:5px}.va-head .va-back{min-height:44px;padding:0 14px;background:var(--panel);font-size:15px;font-weight:500;flex:none}.va-ic{flex:none;line-height:0}
.va-tt{flex:1 1 320px;min-width:0}.va-tt h1{margin:0;font-family:var(--display);font-weight:700;font-size:28px;line-height:1.15;letter-spacing:-.01em;overflow-wrap:anywhere}.va-desc{margin:2px 0 0;color:var(--muted);font-size:15px}.va-etat{margin:4px 0 0;font-size:14px;overflow-wrap:anywhere}
.va-plus{flex:none;font-size:15px;max-width:100%}.va-plus>summary{min-height:44px;display:flex;align-items:center;gap:6px;padding:0 12px;border-radius:10px;color:var(--va-lien);font-weight:500;cursor:pointer}.va-plus>summary:hover{background:var(--panel2)}.va-plus[open]{flex:1 1 100%}.va-plus .va-story{margin:8px 0 0}.va-plus .va-what-m{display:none;margin:4px 0 0;color:var(--muted);font-size:15px}
.va-plus[open]>summary{display:inline-flex}.va-plus>summary::before{content:'';flex:none;width:7px;height:7px;margin:0 4px 0 2px;border:solid currentColor;border-width:0 2px 2px 0;transform:rotate(-45deg);transition:transform .15s}.va-plus[open]>summary::before{transform:rotate(45deg) translate(-2px,-2px)}.va-plus>summary::-webkit-details-marker{display:none}.va-plus-o,.va-plus[open] .va-plus-f{display:none}.va-plus[open] .va-plus-o{display:inline}
.va-story h4{margin:0 0 6px}.va-plus .va-story{align-items:start}.va-parties{margin:8px 0 0!important}.va-story li+li{margin-top:2px}.va-fn{margin:6px 0 0}.va-fn>summary{min-height:32px;display:flex;align-items:center;color:var(--va-lien);font-weight:500;cursor:pointer}.va-fn ul{margin:4px 0 0}
.va-sim{list-style:none;display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0!important}.va-sim li{margin:0!important}.va-sim a,.va-sim span{display:inline-flex;align-items:center;min-height:32px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);font-size:14px;text-decoration:none;overflow-wrap:anywhere}.va-sim a{color:var(--va-lien)}.va-sim a:hover{border-color:var(--va-lien)}.va-sim a:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
@media (max-width:700px),(pointer:coarse){.va-sim a{min-height:44px}.va-fn>summary{min-height:44px}}
@media (max-width:700px){.va-head .va-tt h1{align-self:center}.va-head:has(.va-plus[open]) .va-desc{display:block;-webkit-line-clamp:unset;line-clamp:unset}.va-plus[open] .va-what-m{display:none}}
.va-postes{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;background:var(--panel);border:1px solid var(--line);margin:0 0 16px}.va-postes>label{margin:0 6px 0 0;font-size:15px;font-weight:600}.va-postes select{display:none}
.va-poste{display:inline-flex;align-items:center;gap:8px;min-height:44px;max-width:100%;padding:0 14px;border-radius:999px;border:1px solid var(--field-h,var(--line));background:var(--panel);color:var(--ink);font:inherit;font-size:15px;cursor:pointer}.va-poste span{overflow-wrap:anywhere;text-align:left}.va-poste small{color:var(--muted);font-size:13px;white-space:nowrap}
.va-poste[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--on-accent);font-weight:600}.va-poste[aria-pressed=true] small{color:inherit}.va-poste.va-plusposte{border-color:transparent;background:none;color:var(--va-lien);font-weight:500;padding:0 12px}.va-poste.va-plusposte:hover{background:var(--panel2)}
@media (max-width:700px){.va-postes{flex-direction:column;align-items:stretch;gap:4px;padding:0;border:0;background:none}.va-postes>label{font-size:14px;margin:0}.va-postes .va-poste{display:none}.va-postes select{display:block;width:100%;min-height:44px;padding:0 12px;border-radius:10px;border:1px solid var(--field-h,var(--line));background:var(--panel);color:var(--ink);font:inherit;font-size:16px;font-weight:600}.va-head{gap:8px 10px;margin-bottom:12px}.va-head .va-back{width:44px;padding:0;justify-content:center}.va-head .va-back>span{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}.va-tt{display:contents}.va-tt h1{flex:1 1 0;min-width:0;font-size:24px}.va-desc{flex:1 1 100%;margin:0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden}.va-etat{flex:1 1 100%;margin:0;font-size:13px;color:var(--muted)}.va-plus{flex:1 1 100%}.va-plus>summary{padding:0}.va-plus .va-what-m{display:block}.va-ecran .va-desc{display:block}}
@media (max-width:700px),(pointer:coarse){#v-app .btn.small{min-height:44px}}
.va-onglets{display:flex;flex-wrap:nowrap;gap:2px;overflow-x:auto;overflow-y:hidden;border-bottom:2px solid var(--line);margin:0 0 16px;scrollbar-width:thin}
.va-onglets button{flex:1 1 auto;max-width:180px;min-height:44px;padding:0 8px;white-space:nowrap;border:0;background:transparent;color:var(--muted);font:inherit;font-size:15px;cursor:pointer;border-radius:8px 8px 0 0}.va-onglets button:hover{background:var(--panel2)}.va-onglets button[aria-selected=true]{color:var(--ink);font-weight:600;box-shadow:inset 0 -3px 0 var(--accent)}.va-onglets button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.va-cells{display:flex;flex-wrap:wrap;gap:16px;align-items:stretch}.va-cells>*{flex:1 1 280px;min-width:0;margin:0;box-sizing:border-box}.va-cells>.va-large,.va-cells>.va-kpis{flex:1 1 100%}.va-cells>.va-double{flex:2 1 520px}
.va-carte{display:flex;flex-direction:column;gap:12px}.va-carte>h2{margin:0;font-size:17px}.va-carte .va-btn,.va-ecran .va-btn{min-height:44px;font-size:15px;font-weight:600}.va-carte .va-out,.va-carte .va-dl,.va-carte .va-res-x{margin:0}.va-carte .va-res-x{align-self:flex-start}
.va-aide{margin:0;color:var(--muted);font-size:13px}.va-l{font-size:14px;font-weight:600}.va-champ{box-sizing:border-box;width:100%;min-height:44px;padding:8px 12px;border-radius:10px;border:1px solid var(--field-h,var(--line));background:var(--panel2);color:var(--ink);font:inherit;font-size:15px}
.va-zone{flex:1;min-height:132px;box-sizing:border-box;padding:16px;border-radius:12px;border:2px dashed var(--field-h,var(--line));background:var(--panel2);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;color:var(--ink)}.va-zone p{margin:0;font-size:15px}.va-zone .va-zone-t{font-size:18px;font-weight:600}.va-zone svg{color:var(--va-lien)}.va-zone.va-sur{border-color:var(--accent);border-style:solid;background:color-mix(in srgb,var(--accent) 12%,var(--panel2))}
.va-dyn{display:flex;flex-direction:column;gap:14px}.va-dyn:empty{display:none}.va-choisi{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;background:var(--panel2)}.va-choisi p{margin:0;flex:1 1 200px;min-width:0;overflow-wrap:anywhere}.va-choisi span{color:var(--muted);font-size:14px}.va-choisi svg{flex:none}
.va-groupes{display:flex;flex-direction:column;gap:10px}.va-groupes h3{margin:0;font-size:17px;font-weight:600}.va-groupe{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.va-groupe>span{flex:1 1 100%;color:var(--muted);font-size:14px}
.va-press{min-height:44px;min-width:64px;padding:0 14px;border-radius:10px;border:1px solid var(--field-h,var(--line));background:var(--panel);color:var(--ink);font:inherit;font-size:15px;cursor:pointer}.va-press[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--on-accent);font-weight:600}.va-go{align-self:flex-start;min-height:48px;padding:0 24px}
.va-list li.va-li-f{display:flex;flex-wrap:wrap;align-items:center;gap:10px}.va-list li.va-li-f>div{flex:1 1 160px;min-width:0;overflow-wrap:anywhere}.va-list li.va-li-f .btn{min-height:44px;text-decoration:none;gap:6px}
.va-ecran{max-width:980px;margin:0 auto}.va-etape{padding:18px;border-radius:14px;background:var(--panel);border:1px solid var(--line);display:flex;flex-direction:column;gap:14px;margin:0 0 16px}.va-etape-h{display:flex;flex-wrap:wrap;align-items:center;gap:12px}.va-etape-h h2{margin:0;font-size:18px}.va-etape-h small{color:var(--muted);font-size:14px}
.va-num{flex:none;width:32px;height:32px;border-radius:999px;background:var(--accent);color:var(--on-accent);display:grid;place-items:center;font-weight:700}
.va-cartes{display:flex;flex-wrap:wrap;gap:10px}.va-cartes label{flex:1 1 240px;min-width:0;box-sizing:border-box;min-height:60px;padding:12px 14px;border-radius:12px;border:1px solid var(--field-h,var(--line));background:var(--panel);display:flex;align-items:flex-start;gap:12px;cursor:pointer}.va-cartes label:has(input:checked){border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}.va-cartes input{width:20px;height:20px;margin:2px 0 0;accent-color:var(--accent);flex:none}.va-cartes label>span{flex:1;min-width:0;overflow-wrap:anywhere}.va-cartes b{display:block}.va-cartes small{display:block;color:var(--muted);font-size:14px}
.va-ligne{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px}.va-ligne>div{flex:1 1 220px;min-width:0;display:flex;flex-direction:column;gap:4px}.va-ligne>.va-btn{flex:none}.va-ligne-c{align-items:center}.va-ligne-c>label{flex:0 1 auto}.va-ligne-c>.va-champ{flex:1 1 220px;width:auto}
.va-essai{margin:0;display:flex;align-items:flex-start;gap:8px;font-size:15px}.va-essai:empty{display:none}.va-essai.ok{color:var(--good)}.va-essai.ko{color:var(--bad)}.va-essai svg{flex:none;margin-top:2px}
.va-win{font-size:14px}.va-win summary{min-height:44px;display:flex;align-items:center;color:var(--va-lien);font-weight:500;cursor:pointer}.va-win p{margin:4px 0 8px}.va-win pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12.5px;background:var(--panel2);border-radius:10px;padding:10px;margin:0 0 8px}
.va-share{flex:none;min-height:44px;gap:8px;font-size:15px}.va-share.va-busy{opacity:.8}.va-partage{max-width:min(620px,calc(100vw - 32px))}.va-partage .va-cartes label{flex-basis:200px}
@media (max-width:700px){.va-desc,.va-etat,.va-plus{order:2}.va-share{width:44px;padding:0;justify-content:center}.va-share>span{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}}
.va-fin{display:flex;flex-wrap:wrap;align-items:center;gap:14px}.va-fin p{margin:0;flex:1 1 280px;min-width:0}
`;
  let st = null, cur = null, busy = false;
  /** Paramètres de la vue de chaque appli (période du graphe…), gardés quand la page se redessine. */
  const viewQ = {};
  /** L'onglet ouvert, l'écran à part ouvert, « En savoir plus » déplié, l'ajout de poste en cours : par appli, le temps de la visite. */
  const tabSel = {}, ecran = {}, plusOuvert = {}, assist = {};
  /** Ce qui est déposé dans une zone de dépôt et pas encore envoyé (fichier, lien, choix faits) : gardé quand la page se redessine. */
  const depots = new Map();
  /** Les réglages de chaque action de la page ouverte, et si la page a « Sur quel poste ? ». */
  let actParams = {}, pagePostes = false;
  /** Sans le réglage « poste » quand la page a « Sur quel poste ? » : la page le remplit toute seule. */
  const visibles = (ps) => (pagePostes ? (ps ?? []).filter((p) => p.key !== 'poste') : ps ?? []);
  const ico = (d, w = 18) => { const x = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: w, height: w, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) x.setAttribute(k, String(v)); x.innerHTML = d; return x; };
  const I = { retour: '<path d="M19 12H5M11 6l-6 6 6 6"/>', envoi: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>', plus: '<path d="M12 5v14M5 12h14"/>', ok: '<path d="M5 12l5 5 9-10"/>', non: '<path d="M6 6l12 12M18 6L6 18"/>', fichier: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>', bas: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>', machine: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>' };
  const LV = { critique: 'bad', haute: 'warn', moyenne: 'warn', info: '' };
  const icon = { Sécurité: '🛡', Machines: '🖥', Données: '🗂', Accès: '🔑', Maison: '🏠' };

  function field(p, id) {
    const v = p.default ?? '';
    if (p.kind === 'textarea') return el('textarea', { id, name: p.key, required: p.required }, String(v));
    if (p.kind === 'select') return el('select', { id, name: p.key, required: p.required }, ...(p.options ?? []).map((o) => el('option', { selected: o === v ? true : undefined }, o)));
    if (p.kind === 'boolean') return el('input', { id, name: p.key, type: 'checkbox', checked: v === true ? true : undefined });
    if (p.kind === 'image') {
      // Une image : aperçu tout de suite, envoyée (recadrée, assombrie) seulement quand tu valides le formulaire.
      const pv = el('img', { class: 'va-imgpv', alt: '', hidden: true });
      const inp = el('input', { id, name: p.key, type: 'file', accept: 'image/png,image/jpeg,image/webp', onchange: () => { const f = inp.files?.[0]; if (pv.src) URL.revokeObjectURL(pv.src); if (f) { pv.src = URL.createObjectURL(f); pv.hidden = false; } else pv.hidden = true; } });
      return el('span', { class: 'va-img' }, inp, pv);
    }
    if (p.depot) {
      // Un fichier : son chemin tapé, ou envoyé depuis cet appareil (l'un ou l'autre ; l'envoi part quand tu valides).
      const txt = el(p.kind === 'textarea' ? 'textarea' : 'input', { id, name: p.key, ...(p.kind === 'textarea' ? {} : { type: 'text', value: String(v) }), autocomplete: 'off', spellcheck: 'false', placeholder: 'chemin du fichier…' }, p.kind === 'textarea' ? String(v) : null);
      const fid = `${id}-envoi`, inp = el('input', { id: fid, name: `${p.key}__envoi`, type: 'file', multiple: p.depot.plusieurs ? true : undefined, 'aria-label': `${p.label} : envoyer depuis cet appareil` });
      return el('span', { class: 'va-depot' }, txt, el('label', { class: 'va-depot-ou', for: fid }, 'ou envoie-le depuis cet appareil :'), inp);
    }
    return el('input', { id, name: p.key, type: p.kind === 'number' ? 'number' : p.kind === 'password' ? 'password' : 'text', value: String(v), required: p.required, autocomplete: 'off', spellcheck: 'false' });
  }
  /** Envoie un fichier de l'appareil à une appli (là où elle reçoit ses fichiers) ; `suivi(pourcent)` pendant l'envoi. Rend sa référence. */
  function sendFile(mod, file, suivi) {
    return new Promise((ok, ko) => {
      const x = new XMLHttpRequest();
      x.open('POST', `/api/valhalla/depot?module=${encodeURIComponent(mod)}`);
      x.setRequestHeader('x-odin', '1'); x.setRequestHeader('x-filename', encodeURIComponent(file.name)); x.setRequestHeader('content-type', 'application/octet-stream');
      x.upload.onprogress = (e) => { if (e.lengthComputable && suivi) suivi(Math.round(100 * e.loaded / e.total)); };
      x.onload = () => { let r = {}; try { r = JSON.parse(x.responseText); } catch { /* réponse illisible */ } if (r.ok) ok(r.ref); else ko(new Error(r.error || `envoi refusé (${x.status})`)); };
      x.onerror = () => ko(new Error('connexion coupée pendant l\'envoi')); x.send(file);
    });
  }
  /** Une image pour un réglage : recadrée à la taille voulue (comme un fond d'écran), assombrie, puis envoyée à Odin. */
  async function sendImage(mod, p, file) {
    const o = p.image || { w: 1280, h: 720, type: 'jpeg' }, bmp = await createImageBitmap(file);
    const cv = document.createElement('canvas'); cv.width = o.w; cv.height = o.h; const g = cv.getContext('2d');
    const k = Math.max(o.w / bmp.width, o.h / bmp.height), w = bmp.width * k, h = bmp.height * k;
    g.fillStyle = '#000'; g.fillRect(0, 0, o.w, o.h); g.drawImage(bmp, (o.w - w) / 2, (o.h - h) / 2, w, h);
    if (o.voile) { g.fillStyle = `rgba(0,0,0,${o.voile})`; g.fillRect(0, 0, o.w, o.h); }
    const type = o.type === 'png' ? 'image/png' : 'image/jpeg', blob = await new Promise((ok) => cv.toBlob(ok, type, 0.86));
    if (!blob) throw new Error('le navigateur n\'a pas pu préparer l\'image');
    const r = await (await fetch(`/api/valhalla/image?module=${encodeURIComponent(mod)}&key=${encodeURIComponent(p.key)}`, { method: 'POST', headers: { 'x-odin': '1', 'content-type': type }, body: blob })).json();
    if (!r.ok) throw new Error(r.error || 'envoi refusé');
    return r.ref;
  }
  /**
   * Le dernier résultat de chaque action de la page ouverte. La page se redessine après une action : sans cette
   * mémoire, le résultat d'un formulaire disparaissait au bout d'une demi-seconde, celui d'un bouton au bout de quatre.
   */
  const kept = new Map(); let seen = {};
  /** Une case de résultat qui reste affichée : jusqu'à l'action suivante, au bouton « Fermer », ou en quittant la page. */
  function resultBox(key) {
    const out = el('div', { class: 'va-out', role: 'status' }), dl = el('div', { class: 'va-dl' });
    const close = el('button', { class: 'btn small va-res-x', type: 'button', hidden: true, onclick: () => set('') }, 'Fermer');
    // Les fichiers produits par l'action (une conversion…) : un bouton « Télécharger » par fichier, pour les reprendre sur cet appareil.
    const links = (files) => dl.replaceChildren(...(files ?? []).map((f) => el('a', { class: 'btn small', href: f.href, download: f.nom }, `Télécharger ${f.nom}`)));
    /** `temp` : un message de passage (« … », « Envoi : 45 % ») qui n'est pas gardé. */
    const set = (text, temp, files) => { out.textContent = text ?? ''; links(text && !temp ? files : []); if (text && !temp) kept.set(key, { text, files: files ?? [] }); else kept.delete(key); close.hidden = !text || Boolean(temp); };
    const k = kept.get(key); if (k) { out.textContent = k.text; links(k.files); close.hidden = false; }
    return { out, dl, close, set };
  }
  function form(mod, action, params, submit, o) {
    params = visibles(params);   // une action sans réglage : un simple bouton ; le poste vient de « Sur quel poste ? »
    // Le même formulaire peut être deux fois sur la page (section et « Autres actions ») : chacun garde son résultat.
    const nth = (seen[`${mod}:${action}`] = (seen[`${mod}:${action}`] ?? 0) + 1), res = resultBox(`f:${mod}:${action}:${nth}`), out = res.out;
    const f = el('form', { class: 'va-form', onsubmit: async (e) => {
      e.preventDefault(); const input = { ...(o?.fixe ?? {}) };
      res.set('…', true);
      for (const p of params) {
        const n = f.elements[p.key]; if (!n) continue;
        if (p.kind === 'image') { const file = n.files?.[0]; if (!file) { input[p.key] = ''; continue; } try { input[p.key] = await sendImage(mod, p, file); } catch (err) { res.set(`Image : ${err.message}`); return; } continue; }
        if (p.depot) {
          const files = [...(f.elements[`${p.key}__envoi`]?.files ?? [])];
          if (files.length) {
            const refs = [];
            try { for (const [k, file] of files.entries()) refs.push(await sendFile(mod, file, (pc) => { res.set(`Envoi de ${file.name}${files.length > 1 ? ` (${k + 1}/${files.length})` : ''} : ${pc} %`, true); })); }
            catch (err) { res.set(`✗ Envoi : ${err.message}`); return; }
            input[p.key] = [n.value.trim(), ...refs].filter(Boolean).join(', '); res.set('…', true); f.elements[`${p.key}__envoi`].value = ''; continue;
          }
          if (p.required && !n.value.trim()) { res.set('✗ Choisis un fichier à envoyer, ou tape son chemin.'); return; }
        }
        input[p.key] = p.kind === 'boolean' ? n.checked : p.kind === 'number' && n.value !== '' ? Number(n.value) : n.value;
      } const r = await runFull(mod, action, input); res.set(r.text, false, r.files);
    } }, ...params.map((p) => { const id = `va-${mod}-${action}-${p.key}`; return p.kind === 'boolean' ? el('label', { class: 'va-chk', for: id }, field(p, id), p.label) : [el('label', { for: id }, p.label, p.required ? ' *' : ''), field(p, id), p.help ? el('small', { class: 'sub' }, p.help) : null]; }), el('button', { class: 'btn primary', type: 'submit' }, submit), o?.aide ? el('p', { class: 'va-aide', style: 'margin-top:8px' }, o.aide) : null, out, res.dl, res.close);
    return f;
  }
  /** Lance une action : son texte, et les fichiers qu'elle a produits (à télécharger sur cet appareil). */
  async function runFull(mod, action, input, confirmed) {
    if (mod === cur && pagePostes && viewQ[mod]?.poste && !input?.poste && actParams[action]?.some((p) => p.key === 'poste')) input = { ...input, poste: viewQ[mod].poste };
    const r = await api('/api/valhalla/act', { module: mod, action, input, confirm: confirmed === true });
    if (r.confirm) { if (!window.confirm(r.confirm)) return { text: 'Annulé.', files: [] }; return runFull(mod, action, input, true); }
    if (r.ok && r.data && (r.data.svg || r.data.conf)) show(r.text, r.data);
    setTimeout(() => cur === mod && openApp(mod, true), 600);
    const files = r.ok && Array.isArray(r.fichiers) ? r.fichiers.map((f) => ({ nom: String(f.nom), href: `/api/valhalla/fichier?${new URLSearchParams({ module: String(r.module || mod), ref: String(f.ref) })}` })) : [];
    return { text: r.ok ? r.text : `✗ ${r.text ?? r.error}`, files };
  }
  async function run(mod, action, input) { return (await runFull(mod, action, input)).text; }
  /** Ce qu'une action rend à voir ou à garder : un QR code (image), un fichier texte à copier ou télécharger. */
  function show(text, d) {
    const dlg = el('dialog', { class: 'va-dlg', 'aria-label': text });
    const close = () => { dlg.close(); dlg.remove(); };
    const name = String(d.filename || 'configuration.conf').replace(/[^\w.-]/g, '_');
    dlg.append(el('h2', { style: 'margin:0 0 12px;font-size:17px' }, text),
      d.svg ? el('img', { src: `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(d.svg)))}`, alt: d.alt || 'QR code à scanner avec l\'appli WireGuard' }) : null,
      // La configuration contient la clé privée de l'appareil : cachée tant que tu ne demandes pas à la voir.
      d.conf ? el('details', { open: d.show ? true : undefined }, el('summary', { style: 'cursor:pointer;min-height:36px' }, d.label || 'Voir la configuration (contient la clé secrète de l\'appareil)'), el('pre', {}, d.conf)) : null,
      el('div', { class: 'va-acts-bar', style: 'margin:12px 0 0' },
        d.conf ? el('button', { class: 'btn small', type: 'button', onclick: async (e) => { try { await navigator.clipboard.writeText(d.conf); e.target.textContent = 'Copié'; } catch { e.target.textContent = 'Copie impossible'; } } }, 'Copier') : null,
        d.conf ? el('button', { class: 'btn small', type: 'button', onclick: () => { const a = el('a', { href: URL.createObjectURL(new Blob([d.conf], { type: 'text/plain' })), download: name }); document.body.append(a); a.click(); a.remove(); } }, `Télécharger ${name}`) : null,
        el('button', { class: 'btn small primary', type: 'button', onclick: close }, 'Fermer')));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }
  /** Une valeur courte ne se coupe jamais ; un long mot (chemin, empreinte, adresse) se coupe où il faut. */
  const cellClass = (c) => { const x = String(c ?? ''); return x.length <= 16 && !/\s.*\s.*\s/.test(x) ? 'va-short' : /\S{26,}/.test(x) ? 'va-long' : ''; };
  function section(mod, s) {
    const box = el('section', { class: 'va-sec' }, el('h2', {}, s.title));
    // Les boutons de la section (lignes d'un tableau, cartes, étapes) écrivent leur résultat ici, sous le titre : il reste lisible.
    const res = resultBox(`s:${mod}:${s.kind}:${s.title}`), done = (text) => { res.set(text); res.out.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); };
    if (s.kind === 'table' || s.kind === 'cards' || s.kind === 'steps') box.append(res.out, res.close);
    if (s.kind === 'table') {
      if (!s.rows.length) box.append(el('p', { class: 'sub' }, s.empty ?? 'Rien pour l\'instant.'));
      else {
        const hasA = s.rows.some((r) => r.actions?.length);
        box.append(el('div', { class: 'va-tw' }, el('table', { class: 'va-t' }, el('thead', {}, el('tr', {}, ...s.columns.map((c) => el('th', { scope: 'col' }, c)), hasA ? el('th', {}, el('span', { class: 'sr' }, 'Actions')) : null)),
          el('tbody', {}, ...s.rows.map((r) => el('tr', { class: r.tone ? `va-tone-${r.tone}` : '' }, ...r.cells.map((c) => el('td', { class: cellClass(c) }, c)), hasA ? el('td', { class: 'va-acts' }, ...(r.actions ?? []).map((a) => el('button', { class: 'btn small', type: 'button', onclick: async (e) => { e.target.disabled = true; const t = a.module && a.module !== mod ? await runOther(a.module, a.action, a.input) : await run(mod, a.action, a.input); e.target.disabled = false; done(t); } }, a.label))) : null))))));
      }
    } else if (s.kind === 'cards') {
      // Cartes avec icône (éditeur, système…) : seules les images data: ou de l'interface d'Odin sont affichées.
      const okIcon = (u) => typeof u === 'string' && (/^data:image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(u) || /^\/[^/]/.test(u));
      box.append(s.items.length ? el('div', { class: 'va-tuiles' }, ...s.items.map((c) => el('article', { class: `va-tuile${c.tone ? ` va-tone-${c.tone}` : ''}` },
        el('div', { class: 'va-tuile-h' }, okIcon(c.icon) ? el('img', { src: c.icon, alt: '', width: '40', height: '40', loading: 'lazy' }) : el('span', { class: 'va-tuile-i', 'aria-hidden': 'true' }, (c.title || '?').slice(0, 1)),
          el('div', {}, el('b', {}, c.title), c.sub ? el('small', {}, c.sub) : null, c.meta ? el('small', { class: 'va-tuile-m' }, c.meta) : null)),
        c.badge ? el('span', { class: 'va-tuile-b' }, c.badge) : null,
        typeof c.progress === 'number' ? el('div', { class: 'va-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(c.progress * 100)) }, el('i', { style: `width:${Math.max(0, Math.min(100, Math.round(c.progress * 100)))}%` })) : null,
        c.actions?.length ? el('div', { class: 'va-tuile-a' }, ...c.actions.map((a) => el('button', { class: 'btn small', type: 'button', onclick: async (e) => { e.target.disabled = true; const t = a.module && a.module !== mod ? await runOther(a.module, a.action, a.input) : await run(mod, a.action, a.input); e.target.disabled = false; done(t); } }, a.label))) : null))) : el('p', { class: 'sub' }, s.empty ?? 'Rien.'));
    } else if (s.kind === 'list') {
      // Une ligne peut porter un fichier de l'appli à reprendre sur cet appareil (bouton « Télécharger »).
      const ligne = (i) => (i.fichier ? el('li', { class: `va-li-f${i.tone ? ` va-tone-${i.tone}` : ''}` }, el('div', {}, el('b', {}, i.title), i.detail ? el('small', {}, i.detail) : null, i.meta ? el('small', {}, i.meta) : null), el('a', { class: 'btn small', href: `/api/valhalla/fichier?${new URLSearchParams({ module: mod, ref: String(i.fichier.ref) })}`, download: i.fichier.nom, 'aria-label': `Télécharger ${i.fichier.nom}` }, ico(I.bas), 'Télécharger'))
        : el('li', { class: i.tone ? `va-tone-${i.tone}` : '' }, el('b', {}, i.title), i.detail ? el('small', {}, i.detail) : null, i.meta ? el('small', {}, i.meta) : null));
      box.append(s.items.length ? el('ul', { class: 'va-list' }, ...s.items.map(ligne)) : el('p', { class: 'sub' }, s.empty ?? 'Rien.'));
      if (s.aide) box.append(el('p', { class: 'va-aide', style: 'margin-top:8px' }, s.aide));
    }
    else if (s.kind === 'log') box.append(el('pre', { class: 'va-log' }, s.lines.join('\n') || '—'));
    else if (s.kind === 'text') box.append(el('p', { class: s.tone ? `va-tone-${s.tone}` : '' }, s.text));
    else if (s.kind === 'courbe') {
      // Courbes en SVG : une ligne et une aire par série, l'échelle à gauche, les heures en bas, la valeur au survol.
      const W = 640, H = 180, P = 34, max = Math.max(1, ...s.series.flatMap((x) => x.points)), n = Math.max(2, s.labels.length);
      const X = (i) => P + (i * (W - P - 8)) / (n - 1), Y = (v) => H - 22 - (v / max) * (H - 34);
      const col = { bon: 'var(--good)', attention: 'var(--warn)', mauvais: 'var(--bad)', neutre: '#5b8fd9' };
      const fmt = (v) => (s.unit ? `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${s.unit}` : String(Math.round(v)));
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `${s.title} : ${s.series.map((x) => `${x.name} ${fmt(x.points.at(-1) ?? 0)}`).join(', ')}`); svg.style.width = '100%';
      let inner = `<g fill="var(--muted)" font-size="10">${[0, 0.5, 1].map((k) => `<text x="0" y="${Y(max * k) + 3}">${fmt(max * k)}</text><line x1="${P}" x2="${W - 8}" y1="${Y(max * k)}" y2="${Y(max * k)}" stroke="var(--line)" stroke-dasharray="3 4"/>`).join('')}`;
      const step = Math.max(1, Math.ceil(n / 6)); s.labels.forEach((l, i) => { if (i % step === 0) inner += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${l}</text>`; }); inner += '</g>';
      for (const x of s.series) { const c = col[x.tone] ?? 'var(--accent, #0b7f7c)', pts = x.points.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' '); inner += `<polygon points="${X(0)},${Y(0)} ${pts} ${X(x.points.length - 1)},${Y(0)}" fill="${c}" opacity=".12"/><polyline points="${pts}" fill="none" stroke="${c}" stroke-width="2"/>`; }
      svg.innerHTML = inner;
      const legend = el('div', { class: 'va-acts-bar', style: 'margin:6px 0 0;font-size:13px' }, ...s.series.map((x) => el('span', {}, el('b', { style: `color:${col[x.tone] ?? 'var(--accent, #0b7f7c)'}` }, '● '), `${x.name} : ${fmt(x.points.at(-2) ?? x.points.at(-1) ?? 0)}`)));
      box.append(s.series.some((x) => x.points.some((v) => v > 0)) ? el('div', {}, svg, legend) : el('p', { class: 'sub' }, s.empty ?? 'Rien pour l\'instant.'));
    }
    else if (s.kind === 'bars') { const max = Math.max(1, ...s.items.map((i) => i.value)); box.append(s.items.length ? el('div', { class: 'va-bars' }, ...s.items.map((i) => el('div', { class: 'va-brow' }, el('span', {}, i.label), el('i', { style: `width:${Math.round((i.value / max) * 100)}%` }), el('b', {}, i.display ?? String(i.value))))) : el('p', { class: 'sub' }, 'Rien.')); }
    else if (s.kind === 'form') box.append(form(mod, s.action, s.params, s.submit, s));
    else if (s.kind === 'depot') depot(mod, s, box, res);
    else if (s.kind === 'actions') {
      // Une carte de boutons ; son résultat reste dessous.
      box.classList.add('va-carte');
      const lance = async (btn, action, input) => { btn.disabled = true; res.set('…', true); const r = await runFull(mod, action, input ?? {}); btn.disabled = false; res.set(r.text, false, r.files); res.out.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); };
      for (const b of s.boutons ?? []) box.append(el('button', { class: `btn va-btn${b.primary ? ' primary' : ''}`, type: 'button', onclick: (e) => lance(e.currentTarget, b.action, b.input) }, b.label));
      if (s.liste) {
        const L = s.liste, lid = `va-${mod}-liste-${(seen[`li:${mod}`] = (seen[`li:${mod}`] ?? 0) + 1)}`;
        const libre = L.libre ? el('input', { class: 'va-champ', type: 'text', 'aria-label': L.libre, placeholder: L.libre, autocomplete: 'off', spellcheck: 'false', hidden: true }) : null;
        const sel = el('select', { class: 'va-champ', id: lid, onchange: () => { if (libre) { libre.hidden = sel.value !== '::autre::'; if (!libre.hidden) libre.focus(); } } }, ...L.valeurs.map((x) => el('option', { value: x.valeur }, x.label)), L.libre ? el('option', { value: '::autre::' }, L.libre) : null);
        box.append(el('label', { class: 'va-l', for: lid }, L.label), sel, libre, el('button', { class: 'btn va-btn', type: 'button', onclick: (e) => { const val = libre && sel.value === '::autre::' ? libre.value.trim() : sel.value; if (!val) { res.set(`✗ ${L.libre ?? L.label}`); libre?.focus(); return; } lance(e.currentTarget, L.action, { [L.champ]: val }); } }, L.bouton));
      }
      if (s.aide) box.append(el('p', { class: 'va-aide' }, s.aide));
      box.append(res.out, res.dl, res.close);
    }
    // Assistant de configuration : étapes numérotées, faites ou à faire, chacune avec son bouton.
    else if (s.kind === 'steps') box.append(el('ol', { class: 'va-steps' }, ...s.items.map((i) => el('li', { class: i.done ? 'ok' : '' }, el('div', {}, el('b', {}, i.title), i.detail ? el('small', {}, i.detail) : null), i.action && !i.done ? el('button', { class: 'btn small primary', type: 'button', onclick: async (e) => { e.target.disabled = true; const t = await run(mod, i.action, i.input ?? {}); e.target.disabled = false; done(t); } }, i.button ?? 'Faire') : el('span', { class: 'sub' }, i.done ? 'Fait' : '')))));
    else if (s.kind === 'graph') graphSection(mod, s, box);
    return box;
  }
  /**
   * Zone de dépôt : un fichier de l'appareil, glissé ou choisi. Sans « choix », il est envoyé et l'action part tout de
   * suite. Avec « choix », la page demande d'abord ce qu'on peut en faire (formats), puis envoie quand tu valides.
   */
  function depot(mod, s, box, res) {
    box.classList.add('va-carte'); if (s.choix) box.querySelector('h2')?.classList.add('sr');   // la zone parle d'elle-même : le titre reste pour les lecteurs d'écran
    const cle = `${mod}:${s.title}`, e = depots.get(cle) ?? { files: [], lien: '', choix: null, sel: {} }; depots.set(cle, e);
    const hid = `va-${mod}-dz-${(seen[`dz:${mod}`] = (seen[`dz:${mod}`] ?? 0) + 1)}`;
    const inp = el('input', { type: 'file', class: 'sr', tabindex: '-1', 'aria-hidden': 'true', multiple: s.plusieurs ? true : undefined, onchange: () => { const f = [...inp.files]; inp.value = ''; prendre(f); } });
    const bouton = el('button', { class: 'btn va-btn', type: 'button', onclick: () => inp.click() }, s.bouton ?? 'Choisir un fichier');
    const zone = el('div', { class: 'va-zone' }, ico(I.envoi, 28), el('p', { class: s.choix ? 'va-zone-t' : '' }, s.texte ?? 'Dépose un fichier ici'), s.choix ? bouton : null, s.choix && s.aide ? el('p', { class: 'va-aide' }, s.aide) : null);
    const dyn = el('div', { class: 'va-dyn' });
    const lienInp = s.lien && s.choix ? el('input', { class: 'va-champ', id: `${hid}-lien`, type: 'url', inputmode: 'url', placeholder: 'https://…', autocomplete: 'off', spellcheck: 'false', value: e.lien }) : null;
    /** Envoie les fichiers à l'appli, puis lance l'action avec leurs références. */
    const envoyer = async (files, extra) => {
      const refs = [];
      try { for (const [k, f] of files.entries()) refs.push(await sendFile(mod, f, (pc) => res.set(`Envoi de ${f.name}${files.length > 1 ? ` (${k + 1}/${files.length})` : ''} : ${pc} %`, true))); }
      catch (err) { res.set(`✗ Envoi : ${err.message}`); return false; }
      res.set('…', true);
      const r = await runFull(mod, s.action, { ...(extra ?? {}), [s.champ]: refs.join(', ') }); res.set(r.text, false, r.files); res.out.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      return !r.text.startsWith('✗') && r.text !== 'Annulé.';
    };
    /** Demande à l'appli ce qu'on peut faire de ce fichier (d'après son nom) : les formats possibles, la qualité… */
    const demander = async (nom) => {
      let r; try { r = await api('/api/valhalla/act', { module: mod, action: s.choix.action, input: { nom } }); } catch (err) { r = { ok: false, text: err.message }; }
      const c = r.ok && r.data && Array.isArray(r.data.groupes) ? r.data : { groupes: [], champ: '', refus: r.text ?? r.error ?? 'Je ne sais pas quoi faire de ce fichier.' };
      e.choix = c; e.sel = {};
      if (c.groupes.length) e.sel[c.champ] = c.defaut ?? c.groupes[0].valeurs[0].valeur;
      for (const o of c.options ?? []) e.sel[o.champ] = o.defaut ?? o.valeurs[0].valeur;
    };
    const choisi = () => { const c = e.choix; for (const g of c?.groupes ?? []) for (const x of g.valeurs) if (x.valeur === e.sel[c.champ]) return x.label; return ''; };
    const vider = () => { e.files = []; e.lien = ''; e.choix = null; e.sel = {}; if (lienInp) lienInp.value = ''; };
    const peindre = () => {
      const c = e.choix, nom = e.files.length ? (e.files.length > 1 ? `${e.files.length} fichiers` : e.files[0].name) : e.lien;
      if (!s.choix || !nom || !c) { dyn.replaceChildren(); return; }
      const presse = (champ, x) => el('button', { class: 'va-press', type: 'button', 'aria-pressed': String(e.sel[champ] === x.valeur), onclick: () => { e.sel[champ] = x.valeur; peindre(); dyn.querySelector(`[data-v="${CSS.escape(`${champ}:${x.valeur}`)}"]`)?.focus(); }, 'data-v': `${champ}:${x.valeur}` }, x.label);
      const go = el('button', { class: 'btn primary va-btn va-go', type: 'button', onclick: async () => {
        go.disabled = true;
        let ok;
        if (e.files.length) ok = await envoyer(e.files, e.sel);
        else { res.set('…', true); const r = await runFull(mod, s.lien.action, { ...e.sel, [s.lien.champ]: e.lien }); res.set(r.text, false, r.files); ok = !r.text.startsWith('✗') && r.text !== 'Annulé.'; }
        go.disabled = false; if (ok) { vider(); peindre(); }
      } }, s.choix.envoyer.replace('{choix}', choisi()));
      dyn.replaceChildren(...[
        el('div', { class: 'va-choisi' }, ico(I.fichier, 22), el('p', {}, el('b', {}, nom.length > 80 ? `${nom.slice(0, 77)}…` : nom), c.famille ? el('span', {}, ` · ${c.famille}`) : null), el('button', { class: 'btn va-btn', type: 'button', onclick: () => { vider(); peindre(); bouton.focus(); } }, 'Retirer')),
        c.refus ? el('p', { class: 'va-tone-mauvais', role: 'status' }, c.refus) : null,
        c.groupes.length ? el('div', { class: 'va-groupes', role: 'group', 'aria-labelledby': `${hid}-t` }, el('h3', { id: `${hid}-t` }, s.choix.titre), ...c.groupes.map((g) => el('div', { class: 'va-groupe' }, g.titre ? el('span', {}, g.titre) : null, ...g.valeurs.map((x) => presse(c.champ, x))))) : null,
        ...(c.groupes.length ? (c.options ?? []).map((o, k) => el('div', { class: 'va-groupes', role: 'group', 'aria-labelledby': `${hid}-o${k}` }, el('h3', { id: `${hid}-o${k}` }, o.titre), el('div', { class: 'va-groupe' }, ...o.valeurs.map((x) => presse(o.champ, x))))) : []),
        c.groupes.length ? go : null].filter(Boolean));
    };
    async function prendre(files) {
      if (!files.length) return;
      if (!s.plusieurs) files = files.slice(0, 1);
      if (!s.choix) { bouton.disabled = true; await envoyer(files); bouton.disabled = false; return; }
      e.files = files; e.lien = ''; if (lienInp) lienInp.value = ''; res.set('');
      await demander(files[0].name); peindre();
    }
    // Glisser-déposer sur toute la carte : la zone s'allume quand un fichier la survole.
    const sur = (on) => zone.classList.toggle('va-sur', on);
    box.addEventListener('dragover', (ev) => { if ([...(ev.dataTransfer?.types ?? [])].includes('Files')) { ev.preventDefault(); sur(true); } });
    box.addEventListener('dragleave', (ev) => { if (!box.contains(ev.relatedTarget)) sur(false); });
    box.addEventListener('drop', (ev) => { if (!ev.dataTransfer?.files?.length) return; ev.preventDefault(); sur(false); prendre([...ev.dataTransfer.files]); });
    box.append(zone, inp);
    if (!s.choix) { box.append(bouton); if (s.aide) box.append(el('p', { class: 'va-aide' }, s.aide)); }
    if (lienInp) {
      // Un lien à la place d'un fichier : dès qu'il a l'air complet, on demande ce qu'on peut en faire.
      let attente; const lire = async () => { const u = lienInp.value.trim(); if (u === e.lien && e.choix) return; if (!/^https?:\/\/[^\s/]+\.[^\s/]+\/\S+/i.test(u)) { if (!u && e.lien) { vider(); peindre(); } return; } e.files = []; e.lien = u; res.set(''); await demander(u); peindre(); };
      lienInp.addEventListener('input', () => { clearTimeout(attente); attente = setTimeout(lire, 700); }); lienInp.addEventListener('change', () => { clearTimeout(attente); lire(); });
      box.append(el('div', { style: 'display:flex;flex-direction:column;gap:4px' }, el('label', { class: 'va-l', for: `${hid}-lien` }, s.lien.label), lienInp, s.lien.aide ? el('p', { class: 'va-aide' }, s.lien.aide) : null));
    }
    box.append(dyn, res.out, res.dl, res.close);
    peindre();
  }
  /** Graphe d'une appli (même dessin que le Cerveau) : un clic sur un point ouvre sa fiche à droite. */
  function graphSection(mod, s, box) {
    const fiche = el('div', { class: 'va-fiche', 'aria-live': 'polite' });
    const host = el('div', {});
    const showDetail = (id) => {
      const d = s.details[id]; if (!d) return;
      fiche.replaceChildren(...[el('div', { class: 'k' }, d.kind), el('h3', {}, d.title), d.subtitle ? el('div', { class: 'sub' }, d.subtitle) : null,
        d.chips?.length ? el('div', { class: 'va-chips' }, ...d.chips.map((c) => el('span', { class: c.tone ?? '' }, c.label))) : null,
        d.rows?.length ? el('dl', { class: 'va-kv' }, ...d.rows.flatMap((r) => [el('dt', {}, r.k), el('dd', {}, r.v, r.src ? el('small', {}, r.src) : null)])) : null,
        d.list ? [el('b', { style: 'display:block;margin-top:10px;font-size:14px' }, d.list.title), d.list.items.length ? el('ul', { class: 'va-fl' }, ...d.list.items.map((i) => el('li', { class: i.tone ? `va-tone-${i.tone}` : '' }, el('span', { style: 'overflow-wrap:anywhere' }, i.text), i.meta ? el('small', {}, i.meta) : null))) : el('p', { class: 'sub' }, 'Rien.')] : null,
        d.actions?.length ? el('div', { class: 'va-acts-bar', style: 'margin:12px 0 0' }, ...d.actions.map((a) => el('button', { class: `btn small${a.primary ? ' primary' : ''}`, type: 'button', onclick: async (e) => { e.target.disabled = true; const t = a.module && a.module !== mod ? await runOther(a.module, a.action, a.input) : await run(mod, a.action, a.input); e.target.disabled = false; toast(t); } }, a.label))) : null].flat().filter(Boolean));
      fiche.querySelector('h3')?.focus?.({ preventScroll: true });
    };
    if (s.periods) box.append(el('div', { class: 'va-per', role: 'group', 'aria-label': 'Période' }, ...s.periods.options.map((o) => el('button', { class: 'btn small', type: 'button', 'aria-pressed': String(o.id === s.periods.current), onclick: () => { viewQ[mod] = { ...(viewQ[mod] ?? {}), periode: o.id }; openApp(mod, true); } }, o.label)), s.periods.when ? el('span', { class: 'sub' }, s.periods.when) : null));
    if (!s.nodes.length) { box.append(el('p', { class: 'sub' }, s.empty ?? 'Rien à montrer pour l\'instant.')); return; }
    box.append(el('div', { class: 'va-gr' }, host, el('div', {}, fiche)));
    const first = Object.keys(s.details)[0];
    if (first) showDetail(first); else fiche.append(el('p', { class: 'sub' }, 'Clique sur un point pour voir sa fiche.'));
    if (window.OdinGraph) window.OdinGraph.mount(host, { dark: true, nodes: s.nodes, edges: s.edges, legend: s.legend, label: s.title, search: 'Chercher (nom, adresse, domaine)…', counter: (n, e) => `${n.length} points · ${e.length} liens`, onOpen: (id) => showDetail(id) });
  }
  async function runOther(m, action, input) {
    const r = await api('/api/valhalla/act', { module: m, action, input });
    if (r.confirm) { if (!window.confirm(r.confirm)) return 'Annulé.'; const x = await api('/api/valhalla/act', { module: m, action, input, confirm: true }); return x.ok ? x.text : `✗ ${x.text ?? x.error}`; }
    // « Ouvrir » dans une autre appli : on y va (ex. la base d'une appli dans Alexandrie Studio).
    if (r.ok && action === 'ouvrir') { window.OdinOpenWant = { module: m, ...input }; setTimeout(() => openApp(m), 50); return r.text; }
    setTimeout(() => cur && openApp(cur, true), 600);
    return r.ok ? r.text : `✗ ${r.text ?? r.error}`;
  }
  function toast(t) { const n = el('div', { class: 'va-out', role: 'status', style: 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:60;max-width:min(560px,calc(100% - 32px));box-shadow:var(--shadow);background:var(--panel)' }, t); document.body.append(n); setTimeout(() => n.remove(), 4500); }

  async function openCatalog() {
    const box = $('#v-apps .body'); if (!box) return;
    st = await api('/api/valhalla/catalog');
    box.replaceChildren();
    if (!st.ok) { box.append(el('p', { class: 'sub' }, st.error)); return; }
    const ans = el('div', { class: 'va-ans', role: 'status', hidden: true });
    box.append(el('form', { class: 'va-need', role: 'search', onsubmit: async (e) => { e.preventDefault(); const q = $('#vaNeed').value.trim(); if (!q) return; ans.hidden = false; ans.textContent = '…'; const r = await api(`/api/valhalla/advise?need=${encodeURIComponent(q)}`); ans.replaceChildren(r.text, r.found?.[0] ? el('div', { style: 'margin-top:10px' }, el('button', { class: 'btn small primary', type: 'button', onclick: () => openApp(r.found[0].id) }, `Ouvrir ${r.found[0].name}`)) : ''); } },
      el('label', { for: 'vaNeed', class: 'sr' }, 'De quoi as-tu besoin ?'), el('input', { id: 'vaNeed', placeholder: 'J\'ai besoin de… (sauvegarder mes photos, bloquer un pirate, voir la caméra…)', autocomplete: 'off' }), el('button', { class: 'btn primary', type: 'submit' }, 'Trouver l\'appli')), ans);
    // Toutes les applis, avec leur icône (comme un menu démarrer) : un clic l'ouvre
    if (window.OdinAppIcons) {
      const grid = el('div', { class: 'va-appgrid', role: 'list', 'aria-label': 'Tes applis' });
      for (const m of [...st.modules].sort((a, b) => a.name.localeCompare(b.name, 'fr'))) { const b = el('button', { type: 'button', class: 'va-appbtn', role: 'listitem', title: m.what, onclick: () => openApp(m.id) }); b.innerHTML = window.OdinAppIcons.tile(m.id, m.name, 52); b.append(el('span', {}, m.name)); grid.append(b); }
      box.append(el('section', { class: 'va-sec' }, el('h2', {}, 'Tes applis'), grid));
    }
    // Ce qu'Odin a fait de lui-même : à garder ou à annuler. Et l'état de la protection, en une ligne.
    const top = el('div', { class: 'va-top' }); box.append(top);
    manips(top); protection(top);
    // Les applis en graphe (comme le Cerveau), avec les alertes et les nouveautés en pastilles
    const graph = el('div', { class: 'va-graph' });
    box.append(graph);
    drawGraph(graph);
    const al = await api('/api/valhalla/alerts?n=30');
    box.append(el('section', { class: 'va-sec' }, el('h2', {}, 'Alertes récentes'),
      el('div', { class: 'va-acts-bar' }, el('label', { for: 'vaLvl', class: 'sub' }, 'Sur ta messagerie à partir de :'), el('select', { id: 'vaLvl', onchange: async (e) => { await api('/api/valhalla/level', { level: e.target.value }); toast('Enregistré.'); } }, ...['info', 'moyenne', 'haute', 'critique'].map((l) => el('option', { selected: l === st.level ? true : undefined }, l))), el('button', { class: 'btn small', type: 'button', onclick: async () => { await api('/api/valhalla/ack', { ids: (al.alerts ?? []).map((a) => a.id) }); openCatalog(); } }, 'Tout marquer vu')),
      alerts(al.alerts ?? [])));
    box.append(el('section', { class: 'va-sec' }, el('h2', {}, 'Qui fait quoi : les liens entre applis'), el('ul', { class: 'va-list va-links' }, ...st.links.map((l) => el('li', {}, el('b', {}, l.from === l.to ? `${name(l.from)} · Odin répare seul` : `${name(l.from)} → ${name(l.to)}`), el('small', {}, `Quand ${l.when} : ${l.does}`)))),
      el('h2', { style: 'margin-top:16px' }, 'Usages de prédilection'), el('ul', { class: 'va-list' }, ...st.usages.map((u) => el('li', {}, el('b', {}, u.need), el('small', {}, `${u.chain.map(name).join(' → ')} — ${u.why}`))))));
    badge();
  }
  const name = (id) => st?.modules.find((m) => m.id === id)?.name ?? id;
  // Graphe des applis : Odin au centre, une famille par point vert, chaque appli reliée à sa famille et aux applis
  // avec lesquelles elle travaille. Pastille rouge ou orange : alertes ; bleue : nouveautés de son projet d'origine.
  let graphUi = null;
  /** La fiche d'une appli au survol de la carte : icône, nom, d'où vient le nom, ce qu'elle fait, ses fonctions. */
  function appCard(m) {
    const ic = el('span', { 'aria-hidden': 'true' }); if (window.OdinAppIcons) ic.innerHTML = window.OdinAppIcons.tile(m.id, m.name, 46);
    const st2 = [m.alerts ? el('span', { class: 'al' }, `${m.alerts} alerte(s)`) : null, m.updates ? el('span', { class: 'up' }, `${m.updates} nouveauté(s)`) : null].filter(Boolean);
    return el('div', { class: 'va-hc' }, el('div', { class: 'hd' }, ic, el('div', {}, el('b', {}, m.name), el('span', { class: 'chip' }, `${icon[m.family] ?? ''} ${m.family}`.trim()))),
      m.story ? el('div', {}, el('h4', {}, 'D\'où vient le nom'), el('p', {}, m.story)) : null,
      el('div', {}, el('h4', {}, 'Ce qu\'elle fait'), el('p', {}, m.what), (m.does || []).length ? el('ul', {}, ...m.does.slice(0, 3).map((x) => el('li', {}, x))) : null),
      st2.length ? el('div', { class: 'st' }, ...st2) : null, el('span', { class: 'go' }, `Clic : ouvrir ${m.name}`));
  }
  function drawGraph(into) {
    if (!st?.ok || !window.OdinGraph) return;
    const fams = [...new Set(st.modules.map((m) => m.family))];
    const nodes = [{ id: 'odin', label: 'Odin', hub: true, size: 20, color: '#E3AC3F', title: 'Odin : toutes ses applis' },
      ...fams.map((f) => ({ id: `fam:${f}`, label: `${icon[f] ?? ''} ${f}`.trim(), hub: true, title: `Famille ${f}` })),
      ...st.modules.map((m) => ({ id: m.id, label: m.name, icon: m.id, size: 16, what: m.what, sub: m.family, search: `${m.what} ${(m.does || []).join(' ')}`,
        alert: m.alerts ? { n: m.alerts, level: m.grave ? 'grave' : 'attention' } : undefined, update: m.updates || 0,
        title: `${m.name} — ${m.what}${m.alerts ? ` · ${m.alerts} alerte(s)` : ''}${m.updates ? ` · ${m.updates} nouveauté(s) de son projet d'origine` : ''}` }))];
    const edges = [...fams.map((f) => ['odin', `fam:${f}`]), ...st.modules.map((m) => [`fam:${m.family}`, m.id]), ...st.links.filter((l) => l.from !== l.to).map((l) => [l.from, l.to])];
    const data = { nodes, edges, card: (n) => { const m = st.modules.find((x) => x.id === n.id); return m ? appCard(m) : null; }, label: 'Graphe des applis d\'Odin', search: 'Chercher une appli…', counter: (n, e) => `${st.modules.length} applis · ${e.length} liens`, onOpen: (id) => { if (id === 'odin' || id.startsWith('fam:')) return; openApp(id); } };
    if (graphUi && into.contains(graphUi.el)) graphUi.update(data); else graphUi = window.OdinGraph.mount(into, data);
  }
  /** Les manips d'Odin (réflexes, soins, automatisations) qui attendent ta décision. */
  async function manips(into) {
    const box = el('section', { class: 'va-sec va-manips', hidden: true }); into.append(box);
    const draw = async () => {
      const r = await api('/api/valhalla/manips?n=40').catch(() => null); if (!r?.ok) return;
      // La simple tenue de registre (une note écrite, une fiche créée) reste dans le journal : rien à décider, rien à montrer ici.
      const todo = r.manips.filter((m) => m.state === 'à décider'), done = r.manips.filter((m) => m.state !== 'à décider' && !String(m.decidedBy ?? '').startsWith('réflexe')).slice(0, 5);
      box.hidden = !todo.length && !done.length; if (box.hidden) return;
      const decide = async (id, keep, confirmed, btn) => {
        if (btn) btn.disabled = true;
        const x = await api('/api/valhalla/manip', { id, keep, confirm: confirmed === true });
        if (x.confirm) { if (window.confirm(x.confirm)) return decide(id, keep, true, btn); if (btn) btn.disabled = false; return; }
        toast(x.text ?? (x.ok ? 'Fait.' : 'Impossible.')); draw();
      };
      const row = (m) => el('li', { class: 'va-manip' }, el('div', {}, el('b', {}, m.label), el('small', {}, m.text), el('small', {}, `${new Date(m.at).toLocaleString('fr-FR')} · ${m.by === 'odin' ? 'Odin, de lui-même' : m.by === 'réflexe' ? 'par réflexe' : m.by === 'automatisation' ? 'par une automatisation' : 'à la demande d\'un assistant'}${m.why ? ` · ${m.why}` : ''}`)),
        m.state === 'à décider' ? el('div', { class: 'va-mbtn' }, el('button', { class: 'btn small primary', type: 'button', onclick: (e) => decide(m.id, true, false, e.target) }, 'Garder'), m.canUndo ? el('button', { class: 'btn small', type: 'button', onclick: (e) => decide(m.id, false, false, e.target) }, 'Annuler') : el('span', { class: 'sub' }, 'pas d\'annulation possible'))
          : el('div', { class: 'va-mbtn' }, el('span', { class: `pill ${m.state === 'annulée' ? 'warn' : ''}` }, m.state), m.state === 'gardée' && m.canUndo ? el('button', { class: 'btn small', type: 'button', onclick: (e) => decide(m.id, false, false, e.target) }, 'Annuler') : null));
      box.replaceChildren(...[el('h2', {}, todo.length ? `Odin a fait ${todo.length} manip${todo.length > 1 ? 's' : ''} : à toi de décider` : 'Ce qu\'Odin a fait de lui-même'),
        el('p', { class: 'sub' }, r.autonomy === 'breaker' ? 'Mode Odin Breaker : Odin garde seul ses manips ; tu peux encore les annuler.' : 'Chaque manip peut être gardée ou annulée (annuler lance l\'action inverse).'),
        el('ul', { class: 'va-list' }, ...todo.map(row), ...done.map(row)),
        todo.length > 1 ? el('div', { class: 'va-acts-bar', style: 'margin:10px 0 0' }, el('button', { class: 'btn small', type: 'button', onclick: (e) => decide('tout', true, false, e.target) }, 'Tout garder')) : null].filter(Boolean));
    };
    await draw();
  }
  /** L'état de la protection (antivirus) en une ligne, avec l'accès à sa page. */
  async function protection(into) {
    if (!st.modules.some((m) => m.id === 'ullr')) return;
    const r = await api('/api/valhalla/act', { module: 'ullr', action: 'etat', input: {} }).catch(() => null); if (!r?.ok) return;
    const lines = String(r.text).split('\n'), bad = lines[0].startsWith('⚠');
    into.append(el('section', { class: `va-sec va-prot${bad ? ' attention' : ''}` }, el('h2', {}, 'Protection'), el('p', { class: bad ? 'va-tone-attention' : '' }, lines[0]), ...lines.slice(1, 4).filter((l) => l.startsWith('- ')).map((l) => el('p', { class: 'sub' }, l.slice(2))),
      el('p', { class: 'sub' }, lines.find((l) => l.startsWith('Signatures')) ?? ''), el('div', { class: 'va-acts-bar', style: 'margin:10px 0 0' }, el('button', { class: 'btn small primary', type: 'button', onclick: () => openApp('ullr') }, 'Ouvrir l\'antivirus'), el('button', { class: 'btn small', type: 'button', onclick: async (e) => { e.target.disabled = true; toast('Analyse des téléchargements en cours…'); const x = await api('/api/valhalla/act', { module: 'ullr', action: 'analyser', input: { dossier: 'téléchargements' } }); e.target.disabled = false; toast(x.text ?? 'Terminé.'); } }, 'Analyser mes téléchargements'))));
  }
  function alerts(list) {
    if (!list.length) return el('p', { class: 'sub' }, 'Aucune alerte.');
    return el('div', {}, ...list.map((a) => el('div', { class: `va-al${a.ack ? ' ack' : ''}` }, el('span', { class: `pill ${LV[a.level] ?? ''}` }, a.level), el('div', {}, el('b', {}, `${name(a.module)} — ${a.title}`), a.count > 1 ? ` (×${a.count})` : '', a.detail ? el('div', { class: 'sub' }, a.detail) : null, el('small', { class: 'sub' }, new Date(a.at).toLocaleString('fr-FR'))))));
  }
  // ---------------------------------------------------------------- La page d'une appli (maquette validée le 13/11/2026)
  const kpisBox = (v) => el('div', { class: 'va-kpis' }, ...v.kpis.map((k) => el('div', { class: `va-kpi ${k.tone ?? ''}`, title: k.hint ?? '' }, el('small', {}, k.label), el('b', {}, k.value), k.pct !== undefined ? el('div', { class: 'va-bar', role: 'progressbar', 'aria-valuenow': String(k.pct), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': k.label }, el('i', { style: `width:${Math.min(100, Math.max(0, k.pct))}%` })) : null)));
  const autresActions = (id, list) => el('section', { class: 'va-sec' }, el('h2', {}, 'Autres actions'), ...list.map((a) => el('details', {}, el('summary', { style: 'cursor:pointer;min-height:44px;display:flex;align-items:center' }, a.label, a.grave ? ' ⚠' : ''), el('p', { class: 'sub' }, a.what), form(id, a.id, a.params, a.label))));
  /** Sur un autre poste, seules les actions qui savent y aller sont proposées ; les autres agissent sur la machine d'Odin. */
  const surPoste = (id) => Boolean(pagePostes && viewQ[id]?.poste);
  const vaSurPoste = (id) => (a) => !surPoste(id) || (a.params ?? []).some((p) => p.key === 'poste');
  const notePoste = () => el('p', { class: 'va-aide', style: 'margin:0 0 14px' }, 'Les autres actions de cette appli agissent sur la machine d\'Odin : choisis « Cette machine » pour les retrouver.');
  /**
   * « Son port » : l'adresse directe de l'appli (http://adresse:port ouvre sa page, toujours avec ta connexion).
   * Mêmes demandes que Réglages → Ports (/api/ports) ; ouvrir sur le réseau demande ton accord.
   */
  function portBox(id) {
    const box = el('section', { class: 'va-sec va-port' }, el('h2', {}, 'Son port'), el('p', { class: 'sub' }, 'Lecture…'));
    const st = el('p', { class: 'va-essai', role: 'status' });
    const dessine = (a, I) => {
      if (!a) { box.replaceChildren(el('h2', {}, 'Son port'), el('p', { class: 'sub' }, 'Cette appli passe par l\'interface d\'Odin.')); return; }
      const scheme = I?.https ? 'https' : 'http', ecoute = a.port && a.etat === 'écoute';
      const inp = el('input', { class: 'va-champ', type: 'number', min: 1, max: 65535, inputmode: 'numeric', value: a.port ?? '', placeholder: 'aucun', id: `va-port-${id}`, style: 'max-width:140px' });
      const demande = async (faire, extra = {}) => {
        st.className = 'va-essai'; st.textContent = 'Un instant…';
        let x; try { x = await api('/api/ports', { appli: id, faire, ...extra }); if (x.confirm) { if (!window.confirm(x.confirm)) { st.textContent = 'Annulé : rien n\'a changé.'; return; } x = await api('/api/ports', { appli: id, faire, ...extra, confirm: true }); } } catch (e) { x = { ok: false, error: e.message }; }
        if (!x.ok) { st.className = 'va-essai ko'; st.textContent = `✗ ${x.error || x.text || 'refusé'}`; return; }
        dessine(x.appli, x.interface); st.className = 'va-essai ok'; st.textContent = x.text;
      };
      const garder = () => { const v = inp.value.trim(); return !v && a.port ? demande('retirer') : demande('regler', v ? { port: Number(v) } : {}); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); garder(); } });
      box.replaceChildren(el('h2', {}, 'Son port'),
        el('p', { class: 'sub', style: 'margin:0 0 8px' }, a.port ? `${a.port} · ${a.etat === 'écoute' ? (a.reseau ? 'ouvert sur le réseau' : 'sur cette machine seulement') : a.etat}${a.note ? ` · ${a.note}` : ''}` : 'Aucun port direct : elle s\'ouvre par l\'interface d\'Odin.'),
        el('div', { class: 'va-ligne va-ligne-c' }, el('label', { class: 'va-l', for: `va-port-${id}` }, 'Port'), inp, el('button', { class: 'btn', type: 'button', onclick: garder }, a.port ? 'Changer' : 'Donner un port')),
        el('div', { class: 'va-acts-bar', style: 'margin-top:8px' },
          ecoute ? el('button', { class: 'btn small', type: 'button', onclick: () => demande(a.reseau || a.reseauEnAttente ? 'fermer' : 'ouvrir') }, a.reseau || a.reseauEnAttente ? 'Fermer au réseau' : 'Ouvrir sur le réseau') : null,
          a.port ? el('button', { class: 'btn small', type: 'button', onclick: () => demande('retirer') }, 'Retirer') : null,
          ecoute ? el('a', { class: 'btn small', href: `${scheme}://${location.hostname}:${a.port}/`, target: '_blank', rel: 'noopener', style: 'text-decoration:none' }, 'Ouvrir') : null),
        st);
    };
    api(`/api/ports?${new URLSearchParams({ appli: id })}`).then((r) => (r?.ok ? dessine(r.appli, r.interface) : box.replaceChildren(el('h2', {}, 'Son port'), el('p', { class: 'sub' }, r?.error || 'Pas disponible pour l\'instant.')))).catch(() => box.remove());
    return box;
  }
  const liensBox = (r) => el('section', { class: 'va-sec' }, el('h2', {}, 'Liens avec les autres applis'), el('ul', { class: 'va-list' }, ...r.links.map((l) => el('li', {}, el('b', {}, `${name(l.from)} → ${name(l.to)}`), el('small', {}, `Quand ${l.when} : ${l.does}`)))));
  /**
   * La fiche de l'appli, dépliée en entrant (le même bloc pour toutes les applis) : d'où vient le nom, ce qu'elle fait,
   * ses parties, et les applicatifs similaires existants. Repliée une fois, elle reste repliée partout (réglage du navigateur).
   */
  const ficheOuverte = (o) => { try { if (o === undefined) return localStorage.getItem('odin.fiche') !== 'pliee'; localStorage.setItem('odin.fiche', o ? 'ouverte' : 'pliee'); } catch { /* navigateur sans stockage : dépliée */ } return true; };
  function fiche(id, r) {
    const v = r.view, does = r.does ?? [], sim = r.similaires ?? [], N = 3;
    const parties = v.tabs?.length ? el('p', { class: 'va-aide va-parties' }, `Ses parties : ${v.tabs.join(', ')}.`) : null;
    const fonctions = does.length ? el('div', {}, el('h4', {}, 'Ce qu\'elle fait'), el('ul', {}, ...does.slice(0, N).map((x) => el('li', {}, x))),
      does.length > N ? el('details', { class: 'va-fn' }, el('summary', {}, `Ses ${does.length - N} autres fonctions`), el('ul', {}, ...does.slice(N).map((x) => el('li', {}, x)))) : null, parties)
      : el('div', {}, el('h4', {}, 'Ce qu\'elle fait'), el('p', {}, r.what), parties);
    const similaires = el('div', {}, el('h4', {}, 'Applicatifs similaires existants'), sim.length
      ? el('ul', { class: 'va-sim' }, ...sim.map((x) => el('li', {}, x.site ? el('a', { href: x.site, target: '_blank', rel: 'noopener noreferrer', title: `Site officiel de ${x.nom} (nouvel onglet)` }, x.nom) : el('span', {}, x.nom))))
      : el('p', { class: 'va-aide' }, 'Aucun : c\'est une appli propre à Odin.'));
    return el('details', { class: 'va-plus' }, el('summary', {}, el('span', { class: 'va-plus-o' }, 'Replier la présentation'), el('span', { class: 'va-plus-f' }, 'Le nom, ce qu\'elle fait, les applicatifs similaires')), el('p', { class: 'va-what-m' }, r.what),
      el('div', { class: 'va-story' }, r.story ? el('div', {}, el('h4', {}, 'D\'où vient le nom'), el('p', {}, r.story)) : null, fonctions, similaires));
  }
  /** L'en-tête : retour, icône, nom, une ligne d'explication, puis la fiche de l'appli (dépliée en entrant). */
  function entete(id, r, retour, titre) {
    const v = r.view, ic = el('span', { class: 'va-ic', 'aria-hidden': 'true' }); if (!titre && window.OdinAppIcons) ic.innerHTML = window.OdinAppIcons.tile(id, r.name, 44);
    const plus = titre ? null : fiche(id, r);
    if (plus) { plus.open = plusOuvert[id] ?? ficheOuverte(); plus.addEventListener('toggle', () => { plusOuvert[id] = plus.open; ficheOuverte(plus.open); }); }
    return el('div', { class: 'va-head' }, el('button', { class: 'btn va-back', type: 'button', id: 'vaRetour', title: `Retour : ${retour.label}`, onclick: retour.go }, ico(I.retour), el('span', {}, retour.label)), titre ? null : ic,
      el('div', { class: 'va-tt' }, el('h1', {}, titre?.titre ?? r.name), el('p', { class: 'va-desc' }, titre?.texte ?? r.what), !titre && v.subtitle && v.subtitle !== r.what ? el('p', { class: 'va-etat', role: 'status' }, v.subtitle) : null), titre ? null : boutonPartage(id, r), plus);
  }
  /**
   * « Exporter et partager » (en haut de la page) : la page en Word, PDF, Markdown ou JSON (toute la page ou l'onglet
   * ouvert, pour le poste choisi), ou un lien privé / public vers une copie figée. L'icône dit « en cours », puis le fichier.
   */
  const exportEtat = {};
  function boutonPartage(id, r) {
    const etat = exportEtat[id], b = el('button', { class: `btn va-share${etat?.k === 'cours' ? ' va-busy' : ''}`, type: 'button', 'aria-haspopup': 'dialog', title: etat?.t ?? 'Exporter ou partager cette page', onclick: () => dialoguePartage(id, r) },
      ico(etat?.k === 'fini' ? I.ok : etat?.k === 'erreur' ? I.non : '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 15V3M7 8l5-5 5 5"/>'), el('span', {}, etat?.k === 'cours' ? 'Export…' : 'Exporter / partager'));
    return b;
  }
  async function dialoguePartage(id, r) {
    const v = r.view, onglet = v.onglets?.length ? (v.onglets.includes(tabSel[id]) ? tabSel[id] : v.onglets[0]) : '', poste = viewQ[id]?.poste ?? '';
    const dlg = el('dialog', { class: 'va-dlg va-partage', 'aria-labelledby': 'va-pt-t' }); document.body.append(dlg);
    const fermer = () => { dlg.close(); dlg.remove(); };
    dlg.addEventListener('close', () => dlg.remove());
    dlg.append(el('p', { class: 'sub' }, 'Lecture…')); dlg.showModal();
    let info; try { info = await api(`/api/valhalla/partage?${new URLSearchParams({ id })}`); } catch (e) { info = { ok: false, error: e.message }; }
    if (!info.ok) { dlg.replaceChildren(el('h2', { id: 'va-pt-t' }, 'Exporter ou partager'), el('p', { class: 'va-tone-mauvais' }, info.error ?? 'Pas disponible.'), el('button', { class: 'btn', type: 'button', onclick: fermer }, 'Fermer')); return; }
    const st = el('p', { class: 'va-essai', role: 'status' }), dit = (ok, t) => { st.className = `va-essai ${ok ? 'ok' : 'ko'}`; st.textContent = t; };
    const portee = onglet ? el('select', { class: 'va-champ', id: 'va-pt-portee' }, el('option', { value: onglet }, `L'onglet « ${onglet} »`), el('option', { value: '' }, 'Toute la page')) : null;
    const ou = () => ({ ...(viewQ[id] ?? {}), ...(portee?.value ? { onglet: portee.value } : {}), ...(poste ? { poste } : {}) });
    const majBouton = () => { const h = document.querySelector('#v-app .va-share'); if (h && cur === id) h.replaceWith(boutonPartage(id, r)); };
    const exporter = async (f, btn) => {
      btn.disabled = true; exportEtat[id] = { k: 'cours', t: `Export en ${f.nom}…` }; majBouton(); dit(true, `Export en ${f.nom}…`); st.className = 'va-essai';
      try {
        const x = await fetch(`/api/valhalla/export?${new URLSearchParams({ ...ou(), id, format: f.id })}`, { headers: { 'x-odin': '1' } });
        if (!x.ok) { const j = await x.json().catch(() => ({})); throw new Error(j.error ?? `refusé (${x.status})`); }
        const nom = decodeURIComponent((/filename\*=UTF-8''([^;]+)/i.exec(x.headers.get('content-disposition') ?? '') ?? [])[1] ?? '') || (/filename="([^"]+)"/i.exec(x.headers.get('content-disposition') ?? '') ?? [])[1] || `${r.name}.${f.ext}`;
        const url = URL.createObjectURL(await x.blob()), a = el('a', { href: url, download: nom }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
        exportEtat[id] = { k: 'fini', t: `Exporté : ${nom}` }; dit(true, `✓ ${nom}`);
      } catch (e) { exportEtat[id] = { k: 'erreur', t: `Export : ${e.message}` }; dit(false, `✗ ${e.message}`); }
      btn.disabled = false; majBouton();
    };
    const E = info.export, P = info.partage;
    const formats = el('div', { class: 'va-acts-bar' }, ...E.formats.filter((f) => f.permis).map((f) => el('button', { class: 'btn', type: 'button', title: `Télécharger en ${f.nom}`, onclick: (e) => exporter(f, e.currentTarget) }, f.nom)));
    const pasPermis = E.formats.filter((f) => !f.permis && f.raison);
    // Partager
    const type = el('select', { class: 'va-champ', id: 'va-pt-type' }, el('option', { value: 'prive' }, 'Privé'), el('option', { value: 'public' }, 'Public'));
    const jours = el('input', { class: 'va-champ', id: 'va-pt-jours', type: 'number', min: 1, max: P?.jours?.max ?? 90, value: P?.jours?.defaut ?? 7, style: 'max-width:110px' });
    const gens = el('div', { class: 'va-cartes' }, ...(P?.invites?.personnes ?? []).map((g) => el('label', {}, el('input', { type: 'checkbox', value: g.login }), el('span', {}, el('b', {}, g.nom || g.login), g.groupes?.length ? el('small', {}, g.groupes.join(', ')) : null))));
    const gensBox = el('div', { hidden: !(P?.invites?.personnes ?? []).length }, el('p', { class: 'va-l', style: 'margin:0 0 6px' }, 'Avec (facultatif)'), gens);
    const quiVoit = el('p', { class: 'va-aide' }, 'Privé : toi, ou les personnes que tu choisis (avec leur compte).');
    type.addEventListener('change', () => { gensBox.hidden = type.value !== 'prive' || !(P?.invites?.personnes ?? []).length; quiVoit.textContent = type.value === 'prive' ? 'Privé : toi, ou les personnes que tu choisis (avec leur compte).' : 'Public : toute personne qui a le lien, sans compte. Ton accord est demandé.'; });
    const lien = el('div', { class: 'va-ligne', hidden: true }), liste = el('ul', { class: 'va-list' });
    const peindreListe = (l) => liste.replaceChildren(...(l.length ? l.map((x) => el('li', { class: 'va-li-f' }, el('div', {}, el('b', {}, `${x.type === 'public' ? 'Public' : 'Privé'}${x.onglet ? ` · ${x.onglet}` : ''}`), el('small', {}, `jusqu'au ${new Date(x.fin).toLocaleDateString('fr-FR')} · ${x.ouvertures} ouverture${x.ouvertures > 1 ? 's' : ''}`)), el('button', { class: 'btn small', type: 'button', onclick: async () => { const y = await api('/api/valhalla/partage_retirer', { partage: x.id }); dit(y.ok, y.ok ? y.text : `✗ ${y.error}`); peindreListe((info.partages = info.partages.filter((z) => z.id !== x.id))); } }, 'Retirer'))) : [el('li', {}, el('small', {}, 'Aucun partage en cours.'))]));
    peindreListe(info.partages ?? []);
    const creer = async (btn, confirm) => {
      btn.disabled = true;
      const corps = { id, type: type.value, jours: Number(jours.value) || undefined, ...(portee?.value ? { onglet: portee.value } : {}), ...(poste ? { poste } : {}), vue: viewQ[id] ?? {}, personnes: [...gens.querySelectorAll('input:checked')].map((x) => x.value), ...(confirm ? { confirm: true } : {}) };
      let y; try { y = await api('/api/valhalla/partage', corps); } catch (e) { y = { ok: false, error: e.message }; }
      btn.disabled = false;
      if (y.confirm) { if (window.confirm(y.confirm)) return creer(btn, true); dit(false, 'Annulé : aucun lien créé.'); return; }
      if (!y.ok) { dit(false, `✗ ${y.error}`); return; }
      const champ = el('input', { class: 'va-champ', type: 'text', readonly: true, value: y.lien, 'aria-label': 'Lien du partage' });
      lien.hidden = false; lien.replaceChildren(el('div', {}, champ), el('button', { class: 'btn primary', type: 'button', onclick: async (e) => { try { await navigator.clipboard.writeText(y.lien); e.currentTarget.textContent = 'Copié'; } catch { champ.select(); e.currentTarget.textContent = 'Sélectionné : copie-le'; } } }, 'Copier le lien'));
      dit(true, `${y.text}${y.notes?.length ? ` ${y.notes.join(' ')}` : ''} Le lien n'est montré qu'une fois.`);
      try { const z = await api(`/api/valhalla/partages?${new URLSearchParams({ id })}`); if (z.ok) peindreListe((info.partages = z.partages)); } catch { /* liste inchangée */ }
    };
    dlg.replaceChildren(...[
      el('div', { class: 'va-etape-h' }, el('h2', { id: 'va-pt-t', style: 'margin:0;flex:1' }, `Exporter ou partager ${r.name}`), el('button', { class: 'btn small', type: 'button', onclick: fermer, 'aria-label': 'Fermer' }, ico(I.non))),
      portee ? el('div', { class: 'va-ligne va-ligne-c', style: 'margin:12px 0 0' }, el('label', { class: 'va-l', for: 'va-pt-portee' }, 'Quoi'), portee) : null,
      poste ? el('p', { class: 'va-aide', style: 'margin:8px 0 0' }, `Pour le poste choisi : ${v.postes?.choix.find((c) => c.id === poste)?.nom ?? poste}.`) : null,
      el('h3', { style: 'margin:16px 0 8px;font-size:16px' }, 'Exporter'), E.permis ? formats : el('p', { class: 'va-aide' }, E.raison),
      E.permis && E.retire?.length ? el('p', { class: 'va-aide', style: 'margin:6px 0 0' }, `Pas dans le fichier : ${E.retire.map((x) => x.quoi).join(', ')}.`) : null,
      ...(E.permis ? pasPermis.map((f) => el('p', { class: 'va-aide', style: 'margin:6px 0 0' }, `${f.nom} : ${f.raison}`)) : []),
      el('h3', { style: 'margin:18px 0 8px;font-size:16px' }, 'Partager'),
      P?.permis ? el('div', { style: 'display:flex;flex-direction:column;gap:10px' },
        el('div', { class: 'va-ligne' }, el('div', {}, el('label', { class: 'va-l', for: 'va-pt-type' }, 'Lien'), type), el('div', { style: 'flex:0 0 auto' }, el('label', { class: 'va-l', for: 'va-pt-jours' }, 'Jours'), jours)),
        quiVoit, gensBox, el('p', { class: 'va-aide' }, `Une copie figée, en lecture seule : les mots de passe et clés sont masqués. ${P.note ?? ''}`),
        el('button', { class: 'btn primary', type: 'button', style: 'align-self:flex-start', onclick: (e) => creer(e.currentTarget) }, 'Créer le lien'), lien,
        el('h3', { style: 'margin:8px 0 0;font-size:15px' }, 'Partages en cours'), liste) : el('p', { class: 'va-aide' }, P?.raison ?? 'Pas de partage pour cette appli.'),
      st].filter(Boolean));
  }
  /** « Sur quel poste ? » : des pastilles sur ordinateur, une liste sur téléphone. Le choix vaut pour toute la page. */
  function selecteur(id, r) {
    const P = r.view.postes, sid = `va-poste-${id}`, lid = `${sid}-l`;
    const choisir = (x) => {
      if (x === '+') { ecran[id] = 'poste'; delete assist[id]; render(id, r, false).then(() => document.getElementById('vaRetour')?.focus?.({ preventScroll: true })); return; }
      viewQ[id] = { ...(viewQ[id] ?? {}) }; if (x) viewQ[id].poste = x; else delete viewQ[id].poste;
      kept.clear(); depots.clear(); openApp(id, true);   // les résultats affichés étaient ceux de l'autre poste
    };
    const sel = el('select', { id: sid, onchange: (e) => choisir(e.target.value) }, ...P.choix.map((c) => el('option', { value: c.id, selected: c.id === P.actuel ? true : undefined }, c.sys ? `${c.nom} (${c.sys})` : c.nom)), P.ajouter ? el('option', { value: '+' }, 'Ajouter un poste…') : null);
    return el('section', { class: 'va-postes', role: 'group', 'aria-labelledby': lid }, el('label', { id: lid, for: sid }, 'Sur quel poste ?'),
      ...P.choix.map((c) => el('button', { class: 'va-poste', type: 'button', 'aria-pressed': String(c.id === P.actuel), onclick: () => choisir(c.id) }, c.id ? null : ico(I.machine), el('span', {}, c.nom), c.sys ? el('small', {}, c.sys) : null)),
      P.ajouter ? el('button', { class: 'va-poste va-plusposte', type: 'button', onclick: () => choisir('+') }, ico(I.plus), 'Ajouter un poste') : null, sel);
  }
  /**
   * L'écran « Ajouter un poste », pas à pas : 1 quel poste, 2 son compte administrateur et l'essai de connexion,
   * 3 (si l'appli le prévoit) ce qu'on en fait. Le mot de passe part une fois vers Odin, qui le range dans le coffre
   * si la connexion réussit ; il n'est jamais réaffiché.
   */
  function ecranPoste(id, r) {
    const P = r.view.postes, E = P.ensuite, a = (assist[id] ??= { poste: '', nom: '' }), trouves = P.trouves ?? [];
    const fermer = () => { delete ecran[id]; delete assist[id]; openApp(id, true).then(() => document.getElementById('vaRetour')?.focus?.({ preventScroll: true })); };
    const etape = (n, titre, note, ...kids) => el('section', { class: 'va-etape', 'aria-labelledby': `va-as-t${n}` }, el('div', { class: 'va-etape-h' }, el('span', { class: 'va-num', 'aria-hidden': 'true' }, String(n)), el('h2', { id: `va-as-t${n}` }, titre), note ? el('small', {}, note) : null), ...kids);
    // 1. Quel poste ?
    const adr = el('input', { class: 'va-champ', id: 'va-as-adr', type: 'text', placeholder: '192.168.1.…', autocomplete: 'off', spellcheck: 'false', oninput: () => { for (const x of cartes.querySelectorAll('input')) x.checked = false; raz(); } });
    const cartes = el('div', { class: 'va-cartes', role: 'radiogroup', 'aria-label': 'Postes trouvés sur ton réseau' }, ...trouves.map((t) => el('label', {}, el('input', { type: 'radio', name: 'va-as-poste', value: t.adresse, onchange: () => { adr.value = ''; raz(); } }), el('span', {}, el('b', {}, t.nom), el('small', {}, [t.adresse !== t.nom ? t.adresse : null, t.sys].filter(Boolean).join(' · '))))));
    const adresse = () => adr.value.trim() || cartes.querySelector('input:checked')?.value || '';
    const nomChoisi = () => a.nom || trouves.find((t) => t.adresse === adresse())?.nom || adresse() || 'ce poste';
    // 2. Son compte administrateur
    const user = el('input', { class: 'va-champ', id: 'va-as-user', type: 'text', autocomplete: 'off', spellcheck: 'false', oninput: () => raz() });
    const pw = el('input', { class: 'va-champ', id: 'va-as-pw', type: 'password', autocomplete: 'new-password', oninput: () => { if (pw.value) raz(); } });
    const etat = el('p', { class: 'va-essai', role: 'status' });
    const CMD = 'reg add HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System /v LocalAccountTokenFilterPolicy /t REG_DWORD /d 1 /f';
    const win = el('details', { class: 'va-win' }, el('summary', {}, 'Windows refuse le compte ? La commande à lancer une fois sur le PC'),
      el('p', {}, 'Windows bloque par défaut, à distance, les comptes administrateurs locaux (sauf le compte « Administrateur »). Sur le PC, ouvre une invite de commandes en administrateur et lance une fois cette commande. En attendant, Odin lit les dossiers partagés.'),
      el('pre', {}, CMD), el('button', { class: 'btn small', type: 'button', onclick: async (e) => { try { await navigator.clipboard.writeText(CMD); e.target.textContent = 'Copiée'; } catch { e.target.textContent = 'Copie impossible : sélectionne le texte'; } } }, 'Copier la commande'));
    const testBtn = el('button', { class: 'btn va-btn', type: 'button', onclick: () => tester() }, 'Tester la connexion');
    const dit = (ok, texte) => { etat.className = `va-essai ${ok ? 'ok' : 'ko'}`; etat.replaceChildren(ok ? ico(I.ok) : ico(I.non), el('span', {}, texte)); };
    function raz() { if (!a.poste && !etat.textContent) return maj(); a.poste = ''; a.nom = ''; etat.className = 'va-essai'; etat.replaceChildren(); maj(); }
    async function tester() {
      if (!adresse()) { dit(false, 'Choisis un poste dans la liste, ou tape son adresse.'); (trouves.length ? cartes.querySelector('input') : adr)?.focus(); return false; }
      testBtn.disabled = true; etat.className = 'va-essai'; etat.textContent = 'Connexion en cours…';
      let x; try { x = await api('/api/valhalla/poste', { adresse: adresse(), utilisateur: user.value.trim(), mot_de_passe: pw.value }); } catch (e) { x = { ok: false, text: `Odin ne répond pas : ${e.message}` }; }
      testBtn.disabled = false; dit(Boolean(x.ok), x.text ?? x.error ?? 'Connexion refusée.');
      if (x.commande) win.open = true;
      if (!x.ok) return false;
      a.poste = x.poste; a.nom = x.nom || adresse(); pw.value = ''; pw.placeholder = 'rangé dans le coffre'; maj(); return true;
    }
    // 3. Ce qu'on en fait (ou simplement : utiliser ce poste)
    const res = resultBox(`e:${id}`), prec = el('input', { class: 'va-champ', id: 'va-as-prec', type: 'text', autocomplete: 'off', spellcheck: 'false' }), precL = el('label', { class: 'va-l', for: 'va-as-prec' }), precBox = el('div', { class: 'va-ligne va-ligne-c', hidden: true }, precL, prec);
    const quoi = () => suite?.querySelector('input:checked')?.value ?? E?.defaut ?? E?.cartes[0]?.valeur;
    const suite = E ? el('div', { class: 'va-cartes', role: 'radiogroup', 'aria-labelledby': 'va-as-t3' }, ...E.cartes.map((c) => el('label', {}, el('input', { type: 'radio', name: 'va-as-quoi', value: c.valeur, checked: c.valeur === (E.defaut ?? E.cartes[0].valeur) ? true : undefined, onchange: () => maj() }), el('span', {}, el('b', {}, c.titre), c.detail ? el('small', {}, c.detail) : null)))) : null;
    const go = el('button', { class: 'btn primary va-btn va-go', type: 'button', onclick: () => lancer() });
    function maj() {
      go.textContent = E ? E.envoyer.replace('{poste}', nomChoisi()) : `Utiliser ${nomChoisi()}`;
      const d = E?.cartes.find((c) => c.valeur === quoi())?.demande; precBox.hidden = !d; if (d) { precL.textContent = d.label; prec.placeholder = d.exemple ?? ''; }
    }
    async function lancer() {
      if (!a.poste && !(await tester())) return;
      if (!E) { viewQ[id] = { ...(viewQ[id] ?? {}), poste: a.poste }; fermer(); return; }
      const c = E.cartes.find((x) => x.valeur === quoi()), input = { poste: a.poste, [E.champ]: c.valeur };
      if (c.demande) { const val = prec.value.trim(); if (!val) { res.set(`✗ ${c.demande.label}`); prec.focus(); return; } input[c.demande.champ] = val; }
      go.disabled = true; res.set('…', true); const x = await runFull(id, E.action, input); go.disabled = false;
      if (x.text.startsWith('✗') || x.text === 'Annulé.') { res.set(x.text); return; }
      // C'est lancé : retour à la page, sur ce poste, avec le résultat en haut.
      kept.delete(`e:${id}`); kept.set(`p:${id}`, { text: x.text, files: x.files }); viewQ[id] = { ...(viewQ[id] ?? {}), poste: a.poste }; fermer();
    }
    maj();
    return el('div', { class: 'va-ecran' }, entete(id, r, { label: r.name, go: fermer }, { titre: P.titre ?? 'Ajouter un poste', texte: P.texte ?? 'Windows, Mac, Linux ou NAS. Rien n\'est installé sur le poste, rien n\'y est touché sans ton accord.' }),
      etape(1, 'Quel poste ?', trouves.length ? 'Trouvés sur ton réseau' : '', trouves.length ? cartes : null, el('div', { class: 'va-ligne va-ligne-c' }, el('label', { class: 'va-l', for: 'va-as-adr' }, trouves.length ? 'Il n\'est pas dans la liste ? Son adresse :' : 'Son adresse sur ton réseau :'), adr)),
      etape(2, 'Son compte administrateur', 'Rangé dans le coffre, jamais affiché', el('div', { class: 'va-ligne' }, el('div', {}, el('label', { class: 'va-l', for: 'va-as-user' }, 'Identifiant'), user), el('div', {}, el('label', { class: 'va-l', for: 'va-as-pw' }, 'Mot de passe'), pw), testBtn), etat, win),
      etape(3, E ? E.titre : 'Utiliser ce poste', '', suite, precBox, el('div', { class: 'va-fin' }, go, el('p', { class: 'va-aide' }, E?.aide ?? 'Le poste sera proposé dans « Sur quel poste ? » de toutes les applis qui savent le lire.')), res.out, res.close));
  }
  /** Une page à onglets : chaque section dans le sien, en cartes côte à côte ; les chiffres clés ferment le premier onglet. */
  function pageOnglets(id, r) {
    const v = r.view, noms = v.onglets, sel = noms.includes(tabSel[id]) ? tabSel[id] : noms[0], dernier = noms[noms.length - 1];
    const va = (n) => { tabSel[id] = n; render(id, r, true).then(() => document.getElementById(`va-tab-${noms.indexOf(n)}`)?.focus()); };
    const liste = el('div', { class: 'va-onglets', role: 'tablist', 'aria-label': `Parties de ${r.name}` }, ...noms.map((n, i) => el('button', { type: 'button', role: 'tab', id: `va-tab-${i}`, 'aria-selected': String(n === sel), 'aria-controls': 'va-panneau', tabindex: n === sel ? '0' : '-1', onclick: () => va(n),
      onkeydown: (e) => { const k = e.key, j = k === 'ArrowRight' ? (i + 1) % noms.length : k === 'ArrowLeft' ? (i - 1 + noms.length) % noms.length : k === 'Home' ? 0 : k === 'End' ? noms.length - 1 : -1; if (j >= 0) { e.preventDefault(); va(noms[j]); } } }, n)));
    const panneau = el('div', { class: 'va-cells', role: 'tabpanel', id: 'va-panneau', 'aria-labelledby': `va-tab-${noms.indexOf(sel)}` });
    const toutes = [...v.sections, ...(v.side ?? [])], LARGES = new Set(['table', 'log', 'graph', 'courbe', 'steps', 'cards']);
    const large = (b) => { b.classList.add('va-large'); return b; };
    const aVoir = r.alerts.some((x) => !x.ack), alertesBox = () => large(el('section', { class: 'va-sec' }, el('h2', {}, 'Alertes'), alerts(r.alerts)));
    // Une alerte pas encore vue se montre tout de suite, en tête du premier onglet.
    if (sel === noms[0] && aVoir) panneau.append(alertesBox());
    for (const s of toutes) {
      if ((noms.includes(s.onglet) ? s.onglet : noms[0]) !== sel) continue;
      const b = section(id, s); b.classList.add((s.large ?? LARGES.has(s.kind)) ? 'va-large' : s.kind === 'depot' && s.choix ? 'va-double' : 'va-petit'); panneau.append(b);
    }
    if (sel === noms[0] && v.kpis?.length) panneau.append(kpisBox(v));
    if (sel === dernier) {
      // Tout ce que l'appli sait faire et qui n'a pas déjà sa carte dans un onglet.
      const pris = new Set(v.postes?.ensuite ? [v.postes.ensuite.action] : []);
      // Un formulaire qui ne montre qu'une partie des réglages (« Le fichier d'un lien ») laisse l'action complète dans « Autres actions ».
      for (const s of toutes) { if (s.kind === 'form' && s.params.length >= visibles(actParams[s.action]).length) pris.add(s.action); if (s.kind === 'actions') { for (const b of s.boutons) pris.add(b.action); if (s.liste) pris.add(s.liste.action); } if (s.kind === 'depot') { if (s.choix) pris.add(s.choix.action); if (s.lien) pris.add(s.lien.action); } }
      const autres = r.actions.filter((x) => !pris.has(x.id)).filter(vaSurPoste(id));
      if (autres.length) panneau.append(large(autresActions(id, autres)));
      if (surPoste(id)) panneau.append(large(notePoste()));
      if (!(sel === noms[0] && aVoir)) panneau.append(alertesBox());
      panneau.append(portBox(id));
      if (r.links.length) panneau.append(large(liensBox(r)));
    }
    return [liste, panneau];
  }
  /** Une page d'un seul tenant (appli sans onglets, ou qui a sa propre page dessinée). */
  async function pageSimple(id, r, quiet) {
    const v = r.view, main = el('div', {}), side = el('div', {}), top = el('div', {}), reserve = v.postes?.ensuite?.action;
    if (v.kpis?.length) top.append(kpisBox(v));
    const quick = r.actions.filter((a) => a.quick !== false && a.id !== reserve && !visibles(a.params).some((p) => p.required)).filter(vaSurPoste(id));
    if (quick.length) {
      // Le résultat d'un bouton rapide reste sous la barre (avant : une bulle par-dessus la page, disparue en 4 secondes).
      const res = resultBox(`q:${id}`);
      top.append(el('div', { class: 'va-acts-bar' }, ...quick.map((a) => el('button', { class: 'btn small', type: 'button', title: a.what, onclick: async (e) => { e.target.disabled = true; const t = await run(id, a.id, {}); e.target.disabled = false; res.set(t); res.out.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); } }, a.label, a.grave ? ' ⚠' : ''))), res.out, res.close);
    }
    // Les graphes prennent toute la largeur (le graphe à gauche, la fiche du point choisi à droite).
    const wide = el('div', {});
    for (const s of v.sections) (s.kind === 'graph' ? wide : main).append(section(id, s));
    for (const s of v.side ?? []) side.append(section(id, s));
    const used = new Set((v.side ?? []).filter((s) => s.kind === 'form').map((s) => s.action));
    const others = r.actions.filter((a) => (a.quick === false || visibles(a.params).some((p) => p.required)) && !used.has(a.id) && a.id !== reserve).filter(vaSurPoste(id));
    if (others.length) side.append(autresActions(id, others));
    if (surPoste(id)) side.append(notePoste());
    side.append(el('section', { class: 'va-sec' }, el('h2', {}, 'Alertes'), alerts(r.alerts)));
    side.append(portBox(id));
    if (r.links.length) side.append(liensBox(r));
    // Ariane : le champ d'adresse IP et les paquets (direct et historique), comme Wireshark
    if (id === 'ran' && window.OdinPackets) main.insertBefore(window.OdinPackets.finder(''), main.children[0] || null);
    // Une appli qui a sa propre page dessinée (src/web/pages/<appli>.js) : elle prend toute la largeur ;
    // les sections génériques restent à sa disposition (par exemple dans un onglet « Bases »).
    const page = window.OdinPages?.[id];
    if (page) {
      // La page rend false quand elle n'a rien à montrer : la page générique reste comme avant.
      const generic = [...main.childNodes], host = el('div', { class: 'va-custom', style: 'margin:0 0 18px' }); main.replaceChildren(); wide.append(host);
      let done = false;
      try { done = (await page({ host, generic, view: v, info: r, quiet: Boolean(quiet), reload: () => openApp(id, true), toast, show: (n) => window.OdinShow?.(n) })) !== false; } catch (e) { host.replaceChildren(el('p', { class: 'sub' }, String(e?.message ?? e))); }
      if (done) { main.hidden = true; side.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:0 16px;align-items:start'; }
      else { if (!host.childNodes.length) host.remove(); main.replaceChildren(...generic); }
    }
    return [top, wide, el('div', { class: 'va-page' }, main, side)];
  }
  /** Dessine la page d'une appli à partir de sa vue (sans la redemander : sert aussi au changement d'onglet). */
  async function render(id, r, quiet) {
    const box = $('#v-app .body'); if (!box) return;
    const v = r.view; seen = {}; actParams = Object.fromEntries(r.actions.map((a) => [a.id, a.params])); pagePostes = Boolean(v.postes);
    const t = $('#vaTitle'); if (t) t.textContent = r.name; const mc = $('#mcur'); if (mc) mc.textContent = r.name;
    // L'écran « Ajouter un poste » garde ce que tu y as tapé : la page ne le redessine pas pendant que tu le remplis.
    if (v.postes && ecran[id] === 'poste') { if (!(quiet && box.querySelector('.va-ecran'))) { box.replaceChildren(ecranPoste(id, r)); box.scrollTop = 0; } return; }
    const haut = resultBox(`p:${id}`);   // le résultat d'un écran à part (« analyse de PC-SALON lancée ») reste en haut de la page
    const corps = v.onglets?.length && !window.OdinPages?.[id] ? pageOnglets(id, r) : await pageSimple(id, r, quiet);
    if (cur !== id) return;
    box.replaceChildren(...[entete(id, r, { label: 'Applis', go: () => window.OdinShow?.('apps') }), v.postes ? selecteur(id, r) : null, haut.out, haut.dl, haut.close, ...corps].filter(Boolean));
  }
  async function openApp(id, quiet) {
    // Une nouvelle visite repart de zéro : cette machine, premier onglet, sans anciens résultats ni fichier en attente.
    if (!quiet || cur !== id) { kept.clear(); depots.clear(); if (viewQ[id]) delete viewQ[id].poste; delete tabSel[id]; delete ecran[id]; delete assist[id]; }
    cur = id;
    if (!quiet) window.OdinShow?.('app');
    const box = $('#v-app .body'); if (!box) return;
    if (!quiet) box.replaceChildren(el('p', { class: 'sub' }, 'Chargement…'));
    const r = await api(`/api/valhalla/view?${new URLSearchParams({ ...(viewQ[id] ?? {}), id })}`);
    if (cur !== id) return;
    if (!r.ok) { box.replaceChildren(el('p', { class: 'sub' }, r.error)); return; }
    await render(id, r, quiet);
    if (cur !== id) return;
    if (!quiet) document.getElementById('vaRetour')?.focus?.({ preventScroll: true });
    // Une page qui bouge (barre de progression) se met à jour toute seule, sauf pendant que tu remplis un champ.
    const v = r.view;
    if (v.refreshMs) setTimeout(() => {
      if (cur !== id || !$('#v-app.on')) return;
      const a = document.activeElement; if (a && box.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { setTimeout(() => openApp(id, true), v.refreshMs); return; }
      openApp(id, true);
    }, Math.max(800, v.refreshMs));
  }
  async function badge() { if (!appShown()) return; try { const a = (st ?? await api('/api/valhalla/catalog')).modules?.reduce((n, m) => n + (m.alerts ?? 0), 0) ?? 0; const b = $('#b-apps'); if (b) { b.hidden = !a; b.textContent = String(a); } } catch { /* rien */ } }
  function init() {
    const s = el('style', {}, css); document.head.append(s);
    $('#vaBack')?.addEventListener('click', () => { window.OdinShow?.('apps'); });
    setTimeout(badge, 4000); setInterval(() => { st = null; badge(); }, 120_000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.OdinApps = { open: () => { if (!busy) { busy = true; openCatalog().finally(() => { busy = false; }); } }, app: openApp, section, kpis: (v) => v };
})();
