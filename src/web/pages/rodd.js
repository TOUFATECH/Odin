// Écho dans l'interface (maquettes validées « Écho · Dictée » et « Écho · mes mots et lien avec la voix d'Odin », bleu et vert) :
// - Dictée : Odin au centre, stylo en main, écrit ce que tu dis ; maintiens le bouton (ou Ctrl + Espace) pour parler.
//   L'audio part à Odin (Whisper local), tes mots corrigent ce qui a été mal entendu, puis la mise en forme choisie.
//   « Odin, … » au début = une demande à Odin (ses actions graves gardent ton accord).
// - Mes mots : ce que tu dis → ce qu'Odin écrit (dictée ET voix d'Odin), et le lien avec la voix d'Odin.
// Le micro ne s'ouvre que pendant l'appui ; rien ne part ailleurs que chez Odin.
(() => {
  'use strict';
  window.OdinPages = window.OdinPages || {};
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const act = async (action, input = {}) => (await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'rodd', action, input }) })).json();
  const ICON = {
    mic: 'M9 3h6v11H9zM5 11a7 7 0 0 0 14 0M12 18v3', copy: 'M9 9h11v11H9zM5 15V5a2 2 0 0 1 2-2h8', send: 'm22 2-7 20-4-9-9-4zM22 2 11 13', pc: 'M3 4h18v12H3zM8 20h8M12 16v4',
    phone: 'M7 2h10v20H7zM11 18h2', web: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18', tv: 'M3 5h18v12H3zM8 21h8', chat: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z',
    spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6 6 18', check: 'M5 12l5 5L20 7', edit: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  };
  const ic = (n, s = 16) => { const v = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); v.setAttribute('viewBox', '0 0 24 24'); v.setAttribute('width', s); v.setAttribute('height', s); v.setAttribute('aria-hidden', 'true'); v.innerHTML = `<path d="${ICON[n]}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`; return v; };
  const BLUE = '#4f8cff', GREEN = '#3ecf8e';
  const CSS = `
.rd{--b:${BLUE};--g:${GREEN};--ink2:#eef0f6;--mut2:#9aa1b2;color:var(--ink2);border-radius:24px;padding:22px 24px;display:flex;flex-direction:column;gap:16px;
  background:radial-gradient(900px 600px at 50% -10%,#13254a 0%,transparent 60%),radial-gradient(800px 600px at 100% 100%,#0e2f22 0%,transparent 55%),#0d0f14}
.rd *{box-sizing:border-box}
.rd-g{background:linear-gradient(180deg,#1d2029cc,#14161dcc);border:1px solid #ffffff12;border-radius:22px;box-shadow:0 20px 60px #0005,inset 0 1px 0 #ffffff0d}
.rd-seg{display:inline-flex;gap:4px;padding:4px;border-radius:999px;background:#ffffff0a;border:1px solid #ffffff10;flex-wrap:wrap}
.rd-seg button{font:600 13px inherit;padding:8px 16px;min-height:36px;border-radius:999px;color:var(--mut2);background:none;border:0;cursor:pointer}
.rd-seg button[aria-pressed=true],.rd-seg button[aria-selected=true]{background:#4f8cff1f;color:var(--b);box-shadow:inset 0 0 0 1px #4f8cff55}
.rd-chip{display:inline-flex;align-items:center;gap:6px;min-height:26px;padding:0 10px;border-radius:999px;font:600 12px inherit}
.rd-ib{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:#ffffff0a;border:1px solid #ffffff10;color:#cfd3dd;cursor:pointer}
.rd-ib:hover{color:#fff;border-color:#ffffff30}
.rd-top{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.rd-main{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:16px;align-items:start}@media (max-width:1100px){.rd-main{grid-template-columns:1fr}}
.rd-hero{padding:30px 28px 24px;display:flex;flex-direction:column;align-items:center;gap:18px;position:relative;overflow:hidden}
.rd-hero::before{content:'';position:absolute;inset:-40% 20% auto;height:420px;background:radial-gradient(closest-side,#4f8cff26,transparent);pointer-events:none}
.rd-od{position:relative;width:132px;height:132px;display:grid;place-items:center;border:0;background:none;cursor:pointer;touch-action:none;-webkit-user-select:none;user-select:none}
.rd-od .halo{position:absolute;inset:0;border-radius:50%;background:radial-gradient(closest-side,#4f8cff40,transparent 70%);opacity:.5;transition:opacity .2s}
.rd-od.on .halo{animation:rd-halo 1.6s ease-in-out infinite;opacity:1}
.rd-od .disc{position:relative;width:104px;height:104px;border-radius:50%;background:radial-gradient(circle at 50% 35%,#2c3c5e,#12141a);display:grid;place-items:center;box-shadow:0 0 0 1px #4f8cff55,0 10px 30px #0008}
.rd-od .odin{width:78px;height:78px;display:block}
.rd-od .pen{position:absolute;right:-6px;bottom:8px;color:var(--b);transform-origin:15% 85%;opacity:0;transition:opacity .2s}
.rd-od.on .pen,.rd-od.busy .pen{opacity:1;animation:rd-plume .9s ease-in-out infinite}
.rd-od:focus-visible{outline:2px solid var(--b);outline-offset:4px;border-radius:50%}
.rd-st{display:flex;align-items:center;gap:10px;font:600 13px inherit;color:var(--b);min-height:20px}.rd-st i{width:8px;height:8px;border-radius:50%;background:var(--b);box-shadow:0 0 12px var(--b)}
.rd-st.idle{color:var(--mut2)}.rd-st.idle i{background:var(--mut2);box-shadow:none}
.rd-txt{margin:0;max-width:780px;text-align:center;font:500 23px/1.5 inherit;letter-spacing:-.2px;min-height:1.5em;color:var(--ink2)}
.rd-txt.ph{color:var(--mut2);font-size:18px}
.rd-cur{display:inline-block;width:3px;height:1em;background:var(--b);vertical-align:-4px;margin-left:3px;border-radius:2px;animation:rd-clign 1s steps(1) infinite}
.rd-w{display:flex;align-items:center;gap:4px;height:46px}.rd-w i{width:4px;height:46px;border-radius:3px;background:linear-gradient(180deg,var(--b),var(--g));transform:scaleY(.12);transition:transform .08s}
.rd-res{padding:16px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.rd-res .t{flex:1;min-width:240px;display:flex;flex-direction:column;gap:8px}
.rd-res textarea{width:100%;min-height:64px;resize:vertical;background:#0b0d12;color:var(--ink2);border:1px solid #ffffff1a;border-radius:12px;padding:10px 12px;font:16px/1.55 inherit}
.rd-res .acts{display:flex;gap:8px}
.rd-ask{padding:14px 18px;display:flex;align-items:center;gap:14px;border-color:#3ecf8e40;flex-wrap:wrap}
.rd-feed{padding:16px 18px;display:flex;flex-direction:column}
.rd-feed .it{display:flex;gap:12px;padding:11px 0;border-bottom:1px solid #ffffff14}.rd-feed .it:last-child{border-bottom:0}
.rd-feed small{font-size:12px;color:var(--mut2)}
.rd-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.rd-card{background:#ffffff08;border:1px solid #ffffff10;border-radius:16px;padding:14px 16px;display:flex;flex-direction:column;gap:6px}
.rd-card b{font-size:17px}.rd-card .m{font-size:12.5px;color:var(--mut2)}
.rd-form{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.rd-form input,.rd-type textarea{min-height:40px;border-radius:12px;border:1px solid #ffffff1a;background:#0b0d12;color:var(--ink2);padding:0 12px;font:inherit}
.rd-type textarea{width:100%;min-height:70px;padding:10px 12px;resize:vertical}
.rd-btn{min-height:40px;border-radius:12px;border:1px solid #4f8cff55;background:#4f8cff1f;color:var(--b);padding:0 14px;font:600 13.5px inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.rd-btn.g{border-color:#3ecf8e55;background:#3ecf8e1f;color:var(--g)}.rd-btn.n{border-color:#ffffff1a;background:#ffffff0a;color:var(--mut2)}
.rd-flow{position:relative;display:grid;grid-template-columns:minmax(220px,290px) auto minmax(220px,290px);justify-content:space-between;gap:28px;align-items:center}
@media (max-width:900px){.rd-flow{grid-template-columns:1fr}.rd-flow svg{display:none}}
.rd-node{display:flex;align-items:center;gap:10px;background:#ffffff08;border-radius:14px;padding:10px 14px;position:relative;z-index:1}
.rd-node b{font-size:13.5px}.rd-node small{font-size:12px;color:var(--mut2)}
.rd-hub{display:flex;flex-direction:column;align-items:center;gap:8px;background:radial-gradient(circle at 50% 30%,#2a2f3a,#14161c);border:1px solid #4f8cff55;border-radius:22px;padding:18px 26px;box-shadow:0 0 40px #4f8cff22;text-align:center;position:relative;z-index:1}
.rd-hub .odin{width:56px;height:56px;display:block}
.rd .odin svg{filter:drop-shadow(0 0 8px #4f8cffaa) drop-shadow(0 0 2px #ffffff55)}
.rd-hint{display:flex;align-items:center;gap:10px;background:#4f8cff12;border:1px dashed #4f8cff55;border-radius:14px;padding:10px 14px;font-size:13px;color:#c9dbff;flex-wrap:wrap}
@keyframes rd-plume{0%,100%{transform:rotate(-16deg) translate(-1px,1px)}50%{transform:rotate(9deg) translate(3px,-2px)}}
@keyframes rd-halo{0%,100%{transform:scale(1);opacity:.55}50%{transform:scale(1.08);opacity:.95}}
@keyframes rd-clign{50%{opacity:0}}
@media (prefers-reduced-motion:reduce){.rd-od.on .pen,.rd-od.busy .pen,.rd-od.on .halo,.rd-cur{animation:none}}
`;
  const chip = (t, c) => el('span', { class: 'rd-chip', style: `background:${c}1f;color:${c};box-shadow:inset 0 0 0 1px ${c}40` }, t);
  const MODES = [['tel quel', 'Tel quel'], ['corrigé', 'Corrigé'], ['mail', 'Mail'], ['traduire', 'Traduire'], ['liste', 'Liste']];
  // La mascotte d'Odin (la même que partout : ses humeurs, ses habits de fête).
  let uid = 0;
  const odin = () => {
    const t = document.querySelector('#buddy svg') || document.querySelector('.odin svg'); const s = el('span', { class: 'odin', 'aria-hidden': 'true' }); if (!t) return s;
    // Ses dégradés ont leurs propres noms dans chaque copie : un modèle caché (écran de connexion) ne s'affiche pas.
    const n = ++uid, c = t.cloneNode(true);
    c.querySelectorAll('[id]').forEach((e) => { const o = e.id; e.id = `${o}-rd${n}`; c.querySelectorAll('*').forEach((x) => { for (const a of ['fill', 'filter', 'stroke']) if (x.getAttribute(a) === `url(#${o})`) x.setAttribute(a, `url(#${o}-rd${n})`); }); });
    s.append(c); window.OdinFace?.own?.(c); return s;
  };
  const S = { tab: 'dictee', mode: null, last: null, rec: null, t0: 0, busy: false, partial: '' };

  function feedItem(e) {
    const where = /tél|phone/i.test(e.ou) ? 'phone' : /web/i.test(e.ou) ? 'web' : /telegram/i.test(e.ou) ? 'chat' : /gla/i.test(e.ou) ? 'tv' : 'pc';
    return el('div', { class: 'it' }, el('span', { class: 'rd-ib', style: `width:34px;height:34px;flex:none;cursor:default${e.odin ? `;color:${GREEN}` : ''}` }, ic(where, 15)),
      el('div', { style: 'display:flex;flex-direction:column;gap:3px;min-width:0' }, el('small', {}, `${e.at.slice(11, 16)} · ${e.ou} · `, el('b', { style: `color:${e.odin ? GREEN : BLUE}` }, e.odin ? 'Odin' : e.mode)), el('span', { style: 'font-size:13.5px;line-height:1.45;overflow-wrap:anywhere' }, e.texte.slice(0, 220))));
  }

  async function dictation(root, redraw) {
    const h = (await act('historique')).data ?? { items: [], jour: { dictees: 0, demandes: 0 }, mode: 'corrigé', garde: true };
    if (!S.mode) S.mode = h.mode;
    const st = el('div', { class: 'rd-st idle', role: 'status', 'aria-live': 'polite' }, el('i'), el('span', {}, 'Prêt'));
    const txt = el('p', { class: 'rd-txt ph' }, 'Maintiens Odin (ou Ctrl + Espace) et parle : il écrit ce que tu dis.');
    const bars = Array.from({ length: 48 }, () => el('i'));
    const wave = el('div', { class: 'rd-w', 'aria-hidden': 'true' }, ...bars);
    const od = el('button', { class: 'rd-od', type: 'button', 'aria-label': 'Maintenir pour dicter' }, el('i', { class: 'halo' }), el('span', { class: 'disc' }, odin()), el('span', { class: 'pen' }, ic('edit', 28)));
    const say = (t, idle) => { st.className = `rd-st${idle ? ' idle' : ''}`; st.lastChild.textContent = t; };
    let raf = 0, tick = 0;
    const start = async () => {
      if (S.rec || S.busy) return;
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { say('Micro indisponible ici : ouvre Odin en HTTPS, ou tape le texte plus bas.', true); return; }
      let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch { say('Accès au micro refusé par le navigateur.', true); return; }
      const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
      const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined), chunks = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const ac = new (window.AudioContext || window.webkitAudioContext)(), an = ac.createAnalyser(); an.fftSize = 128; ac.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const draw = () => { an.getByteFrequencyData(buf); bars.forEach((b, i) => { const v = buf[Math.floor((i / bars.length) * buf.length * .7)] / 255; b.style.transform = `scaleY(${Math.max(.08, v)})`; }); raf = requestAnimationFrame(draw); };
      draw();
      S.rec = { mr, stream, ac, chunks }; S.t0 = Date.now(); od.classList.add('on'); txt.className = 'rd-txt'; txt.replaceChildren(el('span', { class: 'rd-cur' }));
      tick = setInterval(() => { const s = Math.floor((Date.now() - S.t0) / 1000); say(`Odin t'écoute · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`); if (s >= 120) stop(); }, 250);
      mr.start(250);
    };
    const stop = async () => {
      const r = S.rec; if (!r) return; S.rec = null; clearInterval(tick); cancelAnimationFrame(raf); bars.forEach((b) => { b.style.transform = 'scaleY(.12)'; });
      od.classList.remove('on');
      await new Promise((ok) => { r.mr.onstop = ok; r.mr.stop(); }); r.stream.getTracks().forEach((t) => t.stop()); r.ac.close().catch(() => {});
      if (Date.now() - S.t0 < 450) { say('Trop court : maintiens le bouton pendant que tu parles.', true); txt.className = 'rd-txt ph'; txt.textContent = 'Maintiens Odin (ou Ctrl + Espace) et parle : il écrit ce que tu dis.'; return; }
      S.busy = true; od.classList.add('busy'); say('Odin écrit ce que tu as dit…');
      try {
        const blob = new Blob(r.chunks, { type: r.mr.mimeType || 'audio/webm' });
        const res = await fetch(`/api/rodd/dictee?${new URLSearchParams({ mode: S.mode, ou: 'Odin (web)' })}`, { method: 'POST', headers: { 'content-type': blob.type, 'x-odin': '1' }, body: blob }).then((x) => x.json());
        if (!res.ok) { say(res.error || 'Échec de la dictée.', true); txt.className = 'rd-txt ph'; txt.textContent = res.error || ''; return; }
        S.last = res; await redraw();
      } catch (e) { say(e.message, true); } finally { S.busy = false; od.classList.remove('busy'); }
    };
    od.addEventListener('pointerdown', (e) => { e.preventDefault(); od.setPointerCapture?.(e.pointerId); start(); });
    od.addEventListener('pointerup', stop); od.addEventListener('pointercancel', stop);
    od.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start(); } });
    od.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') stop(); });
    const kd = (e) => { if (!root.isConnected) { document.removeEventListener('keydown', kd); document.removeEventListener('keyup', ku); return; } if (e.ctrlKey && e.code === 'Space' && !e.repeat) { e.preventDefault(); start(); } };
    const ku = (e) => { if (S.rec && (e.code === 'Space' || e.key === 'Control')) stop(); };
    document.addEventListener('keydown', kd); document.addEventListener('keyup', ku);

    const seg = el('div', { class: 'rd-seg', role: 'group', 'aria-label': 'Mise en forme' }, ...MODES.map(([id, t]) => el('button', { type: 'button', 'aria-pressed': String(S.mode === id), onclick: (e) => { S.mode = id; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); } }, t)));
    const hero = el('div', { class: 'rd-g rd-hero' }, od, st, txt, wave, el('div', { style: 'display:flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:center' }, seg, el('span', { style: 'font-size:12.5px;color:var(--mut2)' }, 'Maintiens ', el('b', { style: 'color:var(--ink2)' }, 'Ctrl + Espace'), ', ou garde le doigt sur Odin')));
    const col = el('div', { style: 'display:flex;flex-direction:column;gap:14px;min-width:0' }, hero);
    const L = S.last;
    if (L && !L.odin) {
      txt.className = 'rd-txt'; txt.textContent = L.texte; say(`Écrit · ${MODES.find((m) => m[0] === S.mode)?.[1] ?? S.mode}`, true);
      const ta = el('textarea', { 'aria-label': 'Texte dicté (tu peux le corriger)' }); ta.value = L.texte;
      const chips = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, L.ia ? chip('✓ mis en forme par Odin', GREEN) : chip(S.mode === 'tel quel' ? 'tel quel' : 'ponctuation de base', '#9aa1b2'), L.brut !== L.texte ? chip(`dicté : ${L.brut.slice(0, 60)}${L.brut.length > 60 ? '…' : ''}`, BLUE) : null);
      const learnBtn = el('button', { class: 'rd-btn g', type: 'button', hidden: true, onclick: async () => { const r = await act('apprendre', { avant: L.texte, apres: ta.value }); learnBtn.textContent = r.ok ? `✓ ${r.text}` : r.text; L.texte = ta.value; } }, ic('check', 14), 'Retenir mes corrections');
      ta.addEventListener('input', () => { learnBtn.hidden = ta.value === L.texte; });
      col.append(el('div', { class: 'rd-g rd-res' }, el('div', { class: 't' }, chips, ta, learnBtn),
        el('div', { class: 'acts' }, el('button', { class: 'rd-ib', type: 'button', title: 'Copier', 'aria-label': 'Copier', onclick: async (e) => { try { await navigator.clipboard.writeText(ta.value); e.currentTarget.style.color = GREEN; } catch { ta.select(); } } }, ic('copy', 17)),
          el('button', { class: 'rd-ib', type: 'button', title: 'Envoyer à Odin dans la discussion', 'aria-label': 'Envoyer à Odin', onclick: () => { window.OdinShow?.('chat'); window.OdinChat?.send?.(ta.value, 'Écho'); } }, ic('send', 17)))));
    } else if (L && L.odin) {
      txt.className = 'rd-txt'; txt.textContent = L.brut; say('Une demande pour Odin', true);
      col.append(el('div', { class: 'rd-g rd-ask' }, el('span', { class: 'disc', style: 'width:44px;height:44px;border-radius:50%;background:#12141a;display:grid;place-items:center;box-shadow:0 0 0 1px #3ecf8e66' }, Object.assign(odin(), { style: 'width:34px;height:34px;display:block' })),
        el('div', { style: 'flex:1;min-width:220px;display:flex;flex-direction:column;gap:3px' }, el('b', { style: `font-size:14px;color:${GREEN}` }, `« Odin, ${L.texte} »`), el('span', { style: 'font-size:13px;color:var(--mut2);white-space:pre-wrap' }, `Une demande, pas une dictée. ${L.odin ?? ''}`.slice(0, 600))),
        el('button', { class: 'rd-btn n', type: 'button', onclick: async () => { const r = await act('dicter', { texte: L.texte, mode: S.mode }); S.last = { ...r.data, odin: undefined }; await redraw(); } }, 'C\'était une dictée')));
    }
    // Sans micro : taper ou coller ce qui a été dicté ailleurs.
    const typed = el('textarea', { placeholder: 'Pas de micro ? Colle ou tape un texte dicté, Odin le met en forme avec tes mots.', 'aria-label': 'Texte à mettre en forme' });
    col.append(el('details', { class: 'rd-g rd-type', style: 'padding:12px 16px' }, el('summary', { style: 'cursor:pointer;min-height:32px;color:var(--mut2);font-size:13px' }, 'Mettre en forme un texte (sans micro)'),
      el('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-top:8px' }, typed, el('div', {}, el('button', { class: 'rd-btn', type: 'button', onclick: async () => { if (!typed.value.trim()) return; const r = await act('dicter', { texte: typed.value, mode: S.mode }); if (!r.ok && !r.data) { alert(r.text || r.error); return; } S.last = r.data ?? { texte: r.text, brut: typed.value, ia: false }; await redraw(); } }, 'Mettre en forme')))));
    const feed = el('aside', { class: 'rd-g rd-feed', 'aria-label': 'Dernières dictées' }, el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:4px' }, el('b', { style: 'font-size:15px' }, 'Aujourd\'hui'), el('small', { style: 'margin-left:auto' }, `${h.jour.dictees} dictée${h.jour.dictees > 1 ? 's' : ''} · ${h.jour.demandes} demande${h.jour.demandes > 1 ? 's' : ''}`)),
      ...h.items.slice(0, 8).map(feedItem), h.items.length ? null : el('p', { style: 'color:var(--mut2);font-size:13px' }, h.garde ? 'Aucune dictée pour l\'instant.' : 'L\'historique n\'est pas gardé (Réglages de Écho).'));
    root.append(el('div', { class: 'rd-main' }, col, feed));
  }

  async function words(root, redraw) {
    const l = (await act('mots')).data ?? [];
    const mot = el('input', { placeholder: 'Le mot à bien écrire (Mamoudzou)', 'aria-label': 'Mot', required: true }), heard = el('input', { placeholder: 'On entend (mamoud zou, mamoudzu)', 'aria-label': 'Ce qu\'on entend, séparé par des virgules', style: 'flex:1;min-width:200px' }), kind = el('input', { placeholder: 'Type (ville, appli…)', 'aria-label': 'Type', style: 'width:170px' });
    const form = el('form', { class: 'rd-form', onsubmit: async (e) => { e.preventDefault(); if (!mot.value.trim()) return; const r = await act('ajouter_mot', { mot: mot.value, entendus: heard.value, genre: kind.value }); if (!r.ok) alert(r.text || r.error); await redraw(); } }, mot, heard, kind, el('button', { class: 'rd-btn', type: 'submit' }, ic('plus', 14), 'Ajouter'));
    const cards = el('div', { class: 'rd-cards' }, ...l.map((m) => el('div', { class: 'rd-card' },
      el('div', { style: 'display:flex;align-items:center;gap:8px' }, el('b', {}, m.mot), el('span', { class: 'm', style: 'margin-left:auto' }, m.genre ?? '')),
      el('span', { class: 'm' }, 'on entend : ', el('span', { style: 'color:#cfd3dd' }, m.entendus.join(', ') || '—')),
      el('div', { style: 'display:flex;align-items:center;gap:6px;margin-top:2px;flex-wrap:wrap' }, chip('dictée', BLUE), chip('voix d\'Odin', GREEN), m.appris ? chip('appris', '#9aa1b2') : null,
        el('button', { class: 'rd-ib', type: 'button', style: 'margin-left:auto;width:32px;height:32px', title: `Retirer ${m.mot}`, 'aria-label': `Retirer ${m.mot}`, onclick: async () => { if (!confirm(`Retirer « ${m.mot} » de tes mots ?`)) return; await act('retirer_mot', { mot: m.mot }); await redraw(); } }, ic('x', 14))))));
    const box = el('div', { class: 'rd-g', style: 'padding:20px 22px;display:flex;flex-direction:column;gap:14px' },
      el('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' }, el('b', { style: 'font-size:16px' }, 'Mes mots'), el('span', { style: 'font-size:12.5px;color:var(--mut2)' }, 'ce que tu dis → ce qu\'Odin écrit')),
      form, l.length ? cards : el('p', { style: 'color:var(--mut2);font-size:13px;margin:0' }, 'Aucun mot pour l\'instant : ajoute les noms qu\'Odin entend mal (villes, clients, applis).'),
      el('div', { class: 'rd-hint' }, ic('spark', 16), 'Quand tu corriges une dictée, « Retenir mes corrections » ajoute tout seul les mots changés.'));
    const node = (t, d, i, c) => el('div', { class: 'rd-node', style: `border:1px solid ${c}40` }, el('span', { class: 'rd-ib', style: `width:34px;height:34px;color:${c};cursor:default` }, ic(i, 16)), el('div', { style: 'display:flex;flex-direction:column;gap:2px' }, el('b', {}, t), el('small', {}, d)));
    const left = el('div', { style: 'display:flex;flex-direction:column;gap:28px' }, node('Dictée sur tes PC', 'la capsule, dans toutes les applis', 'pc', BLUE), node('Dictée sur le téléphone', 'appli Odin', 'phone', BLUE), node('Dictée dans cette page', 'maintiens Odin', 'web', BLUE));
    const right = el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, node('Odin sur le web', 'le micro de la discussion', 'web', GREEN), node('Odin sur Telegram', 'tes vocaux', 'chat', GREEN), node('Hestia', 'l\'écran de la maison', 'tv', GREEN), node('« Odin, … » en dictée', 'devient une demande', 'spark', GREEN));
    const hub = el('div', { class: 'rd-hub' }, odin(), el('b', { style: 'font-size:15px' }, 'Tes mots + Whisper local'), el('small', { style: 'font-size:12px;color:var(--mut2)' }, 'soufflés avant d\'écouter,', el('br'), 'corrigés après'));
    const flow = el('div', { class: 'rd-flow' }, left, hub, right);
    const lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); lines.setAttribute('aria-hidden', 'true'); lines.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible';
    flow.prepend(lines);
    const link = () => {
      if (!flow.isConnected) return; const F = flow.getBoundingClientRect(), H = hub.getBoundingClientRect(); if (!F.width || getComputedStyle(lines).display === 'none') return;
      const hx1 = H.left - F.left, hx2 = H.right - F.left, hy = H.top - F.top + H.height / 2;
      const path = (x1, y1, x2, y2, c) => `<path d="M${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}" fill="none" stroke="${c}" stroke-opacity=".55" stroke-width="2" stroke-dasharray="5 5"/>`;
      lines.innerHTML = [...left.children].map((n) => { const r = n.getBoundingClientRect(); return path(r.right - F.left, r.top - F.top + r.height / 2, hx1, hy, BLUE); }).join('') + [...right.children].map((n) => { const r = n.getBoundingClientRect(); return path(hx2, hy, r.left - F.left, r.top - F.top + r.height / 2, GREEN); }).join('');
    };
    root.append(box, el('div', { class: 'rd-g', style: 'padding:20px 22px;display:flex;flex-direction:column;gap:14px' }, el('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' }, el('b', { style: 'font-size:16px' }, 'Le lien avec la voix d\'Odin'), el('span', { style: 'font-size:12.5px;color:var(--mut2)' }, 'une seule écoute, les mêmes mots, partout où tu parles')), flow));
    requestAnimationFrame(link); if ('ResizeObserver' in window) new ResizeObserver(link).observe(flow);
  }

  window.OdinPages.rodd = async ({ host }) => {
    if (!document.getElementById('rdCss')) document.head.append(el('style', { id: 'rdCss' }, CSS));
    if (S.rec) return; // une dictée en cours : on ne redessine pas sous ton doigt
    const root = el('div', { class: 'rd' }); host.append(root);
    const redraw = async () => {
      const tabs = el('div', { class: 'rd-seg', role: 'tablist', style: 'margin:0 auto' }, ...[['dictee', 'Dictée'], ['mots', 'Mes mots']].map(([id, t]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(S.tab === id), onclick: () => { S.tab = id; redraw(); } }, t)));
      const head = el('div', { class: 'rd-top' }, el('span', { style: `width:40px;height:40px;border-radius:12px;background:#4f8cff1f;color:${BLUE};display:grid;place-items:center;box-shadow:inset 0 0 0 1px #4f8cff40` }, ic('mic', 20)),
        el('div', {}, el('b', { style: 'font-size:19px;letter-spacing:-.2px' }, 'Écho'), el('div', { style: 'font-size:12.5px;color:var(--mut2)' }, 'Dictée vocale · reliée à la voix d\'Odin')), tabs, chip('● 100 % local · Whisper', GREEN));
      const body = el('div', { style: 'display:flex;flex-direction:column;gap:14px' });
      root.replaceChildren(head, body);
      if (S.tab === 'mots') await words(body, redraw); else await dictation(body, redraw);
    };
    await redraw();
  };
})();
