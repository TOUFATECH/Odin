// Orphée · la conversation en direct (service vocal temps réel), au-dessus de la page d'Orphée (qui reste entière).
// Le micro (avec l'annulation d'écho du navigateur) part à Odin par petits morceaux de 64 ms ; Odin les passe au
// service temps réel, qui dit quand tu parles, quand ta phrase est finie, et quand tu coupes Odin. Odin répond
// segment par segment ; s'il est coupé, il s'arrête aussitôt, et « continue » reprend au premier mot jamais dit.
// Sans le service (pas de Python sur la machine d'Odin, ou en panne), ce panneau le dit et la voix habituelle reste.
// Le micro ne s'ouvre qu'après un clic sur « Parler en direct » et se ferme avec « Arrêter ».
(() => {
  'use strict';
  window.OdinPages = window.OdinPages || {};
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const post = async (quoi, corps, brut) => (await fetch(`/api/voice/orphee/${quoi}`, { method: 'POST', headers: brut ? { 'content-type': 'application/octet-stream', 'x-odin': '1' } : { 'content-type': 'application/json', 'x-odin': '1' }, body: brut ?? JSON.stringify(corps ?? {}) })).json();
  const CSS = `
.or{border:1px solid #ffffff14;border-radius:18px;padding:16px 18px;display:flex;flex-direction:column;gap:12px;background:linear-gradient(180deg,#1b1e27,#14161d);margin-bottom:16px}
.or *{box-sizing:border-box}.or h2{margin:0;font-size:16px}.or small{color:#9aa1b2}
.or-l{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.or-b{font:600 13px inherit;padding:8px 16px;min-height:36px;border-radius:999px;border:1px solid #ffffff1a;background:#ffffff0a;color:inherit;cursor:pointer}
.or-b.on{border-color:#e2a93b;color:#e2a93b}
.or-st{font:600 13px inherit;color:#9aa1b2}.or-st.parle{color:#3ecf8e}.or-st.odin{color:#4f8cff}.or-st.coupe{color:#e2a93b}
.or-txt{min-height:1.5em;font-size:16px;line-height:1.5;overflow-wrap:anywhere}
.or-log{display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto;font-size:14px}
.or-log p{margin:0;overflow-wrap:anywhere}.or-log .moi{color:#cfd3dd}.or-log .odin{color:#9ec0ff}
@media (pointer:coarse){.or-b{min-height:44px}}`;
  const S = { id: '', ctx: null, flux: null, src: null, proc: null, tampon: [], envoi: false, son: null, segment: null, debutSon: 0, partiel: '', final: '', attendFinal: null, sse: null, moteurs: null, coupeA: 0, volume: 0.8 };
  let panneau = null, etat = null, texte = null, journal = null, bouton = null, info = null;

  const statut = (t, c = '') => { if (etat) { etat.textContent = t; etat.className = `or-st ${c}`; } };
  const note = (qui, t) => { if (!journal) return; journal.append(el('p', { class: qui }, `${qui === 'moi' ? 'Toi' : 'Odin'} : ${t}`)); journal.scrollTop = journal.scrollHeight; };

  /** 48 kHz (ou autre) → 16 kHz, 16 bits. */
  function vers16k(f32, taux) {
    const r = taux / 16000, n = Math.floor(f32.length / r), out = new Int16Array(n);
    for (let i = 0; i < n; i++) { const x = f32[Math.floor(i * r)]; out[i] = Math.max(-32768, Math.min(32767, Math.round(x * 32767))); }
    return out;
  }
  async function pousser() {
    if (S.envoi || !S.id || !S.tampon.length) return;
    const n = S.tampon.reduce((a, b) => a + b.length, 0); if (n < 1024) return;
    const bloc = new Int16Array(n); let k = 0; for (const t of S.tampon) { bloc.set(t, k); k += t.length; } S.tampon = [];
    S.envoi = true;
    try { const r = await post(`audio?id=${S.id}`, null, bloc.buffer); for (const e of r.evenements ?? []) traiter(e); }
    catch { /* un morceau perdu : on continue */ } finally { S.envoi = false; }
  }
  function couper(e) {
    if (!S.son) return;
    const joue = Math.round(S.son.currentTime * 1000), duree = Math.round((S.son.duration || 0) * 1000);
    S.son.pause(); S.son = null; S.file = [];
    statut(`Coupé (${e.raison === 'mot_arret' ? `« ${e.mot} »` : 'tu as parlé'}) · décision en ${e.latence_ms} ms`, 'coupe');
    if (S.segment) void post('coupure', { id: S.id, segment: S.segment, joue_ms: joue, duree_ms: duree });
    void post('controle', { id: S.id, type: 'odin_fin' });
    S.segment = null;
  }
  function traiter(e) {
    if (e.type === 'parole_debut') { if (!S.son) statut('Je t\'écoute…', 'parle'); S.partiel = ''; S.final = ''; }
    else if (e.type === 'partiel') { S.partiel = e.texte; if (texte) texte.textContent = e.texte; }
    else if (e.type === 'final') { S.final = e.texte; if (texte) texte.textContent = e.texte; S.attendFinal?.(); }
    else if (e.type === 'soupcon' && S.son) S.son.volume = S.volume * 0.3;
    else if (e.type === 'fausse_alerte' && S.son) S.son.volume = S.volume;
    else if (e.type === 'coupure') couper(e);
    else if (e.type === 'fin_de_tour') void tour();
  }
  async function tour() {
    // Avec la transcription en direct, le texte définitif arrive juste après la fin du tour (1,5 s au plus).
    if (S.moteurs?.stt && S.moteurs.stt !== 'aucune' && !S.final) await new Promise((ok) => { S.attendFinal = ok; setTimeout(ok, 1500); });
    S.attendFinal = null;
    statut('Je réfléchis…', 'odin');
    const r = await post('tour', { id: S.id, texte: S.final || S.partiel || '' }).catch(() => null);
    S.partiel = ''; S.final = '';
    if (!r?.ok) { statut(r?.error ?? 'Odin n\'a pas répondu.', 'coupe'); return; }
    if (r.rien) { statut('Rien entendu.'); return; }
    note('moi', r.compris && r.compris !== r.entendu ? `${r.entendu} → ${r.compris}` : r.entendu);
    if (r.stop) { statut('D\'accord, je me tais.'); return; }
    const segs = r.reponse?.segments ?? []; if (!segs.length) { statut('…'); return; }
    note('odin', segs.map((x) => x.texte).join(' '));
    S.file = [...segs]; void suivant();
  }
  async function suivant() {
    const seg = S.file?.shift();
    if (!seg) { S.segment = null; void post('controle', { id: S.id, type: 'odin_fin' }); statut('À toi.', ''); return; }
    S.segment = seg.id;
    await post('controle', { id: S.id, type: 'odin_parle', segment: seg.id, texte: seg.texte });
    const r = await fetch('/api/voice/speak', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ text: seg.texte }) }).catch(() => null);
    if (!r || !/^audio\//.test(r.headers.get('content-type') ?? '')) { void post('dit', { id: S.id, segment: seg.id }); return suivant(); } // pas de voix : le texte reste affiché
    if (S.segment !== seg.id) return; // coupé pendant la fabrication du son
    const a = new Audio(URL.createObjectURL(await r.blob())); a.volume = S.volume; S.son = a;
    statut('Odin parle… (coupe-le quand tu veux)', 'odin');
    a.onended = () => { if (S.son !== a) return; S.son = null; void post('dit', { id: S.id, segment: seg.id }); void suivant(); };
    await a.play().catch(() => { S.son = null; void suivant(); });
  }
  async function demarrer() {
    statut('Ouverture…');
    const r = await post('session', {}).catch(() => null);
    if (!r?.ok) { statut(r?.error ?? 'Conversation en direct indisponible : la voix habituelle reste là.', 'coupe'); return; }
    S.id = r.id; S.moteurs = r.moteurs ?? null;
    if (info) info.textContent = S.moteurs ? `Parole : ${S.moteurs.vad} · fin de phrase : ${S.moteurs.tour} · texte en direct : ${S.moteurs.stt}` : '';
    try { S.flux = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); }
    catch { statut('Micro refusé par le navigateur.', 'coupe'); await post('fin', { id: S.id }); S.id = ''; return; }
    S.ctx = new AudioContext(); S.src = S.ctx.createMediaStreamSource(S.flux);
    S.proc = S.ctx.createScriptProcessor(2048, 1, 1);
    S.proc.onaudioprocess = (ev) => { S.tampon.push(vers16k(ev.inputBuffer.getChannelData(0), S.ctx.sampleRate)); void pousser(); };
    S.src.connect(S.proc); S.proc.connect(S.ctx.destination);
    S.sse = new EventSource(`/api/voice/orphee/evenements?id=${S.id}`);
    S.sse.onmessage = (m) => { try { const e = JSON.parse(m.data); if (e.type === 'partiel' || e.type === 'final') traiter(e); } catch { /* ligne illisible */ } };
    bouton.textContent = 'Arrêter'; bouton.classList.add('on'); statut('À toi : parle quand tu veux.');
  }
  async function arreter() {
    try { S.proc?.disconnect(); S.src?.disconnect(); S.flux?.getTracks().forEach((t) => t.stop()); await S.ctx?.close(); } catch { /* déjà fermé */ }
    S.sse?.close(); S.son?.pause();
    if (S.id) await post('fin', { id: S.id }).catch(() => 0);
    Object.assign(S, { id: '', ctx: null, flux: null, src: null, proc: null, tampon: [], son: null, segment: null, sse: null });
    bouton.textContent = 'Parler en direct'; bouton.classList.remove('on'); statut('Conversation fermée.');
  }

  window.OdinPages.bragi = async ({ host }) => {
    if (!document.getElementById('orCss')) document.head.append(el('style', { id: 'orCss' }, CSS));
    if (!panneau) {
      etat = el('span', { class: 'or-st', role: 'status', 'aria-live': 'polite' }, '');
      texte = el('p', { class: 'or-txt', 'aria-live': 'polite' });
      journal = el('div', { class: 'or-log' });
      info = el('small');
      bouton = el('button', { class: 'or-b', type: 'button', onclick: () => (S.id ? arreter() : demarrer()) }, 'Parler en direct');
      panneau = el('section', { class: 'or', 'aria-label': 'Conversation en direct' }, el('h2', {}, 'Conversation en direct'), el('div', { class: 'or-l' }, bouton, etat), info, texte, journal,
        el('small', {}, 'Coupe Odin en parlant ou en disant « stop » ; « continue » reprend où il en était. « Non, je voulais dire … » corrige un mot mal entendu.'));
    }
    host.append(panneau);
    if (!S.id) {
      const r = await fetch('/api/voice/orphee/etat').then((x) => x.json()).catch(() => null);
      if (r?.repli) statut(r.etat === 'absent' || r.etat === 'en panne' ? `Indisponible : ${r.raison}` : 'Service en cours de lancement…');
      else statut('Prêt.');
    }
    return false; // la page générique d'Orphée reste en dessous
  };
})();
