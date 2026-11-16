// Écho · mode « Conversation » : Odin traduit à voix haute une conversation à deux, entre le français, l'anglais et le japonais.
// Je choisis MA langue et celle de MON INTERLOCUTEUR. Après un geste (« Commencer »), le micro reste ouvert : la page découpe
// les tours de parole aux pauses, envoie chaque tour à Odin (/api/rodd/conversation/tour), qui reconnaît la langue (donc qui
// parle), retire les hésitations et traduit ; la page dit la traduction dans la langue de l'autre. Les rôles s'inversent seuls.
// Sur téléphone : deux moitiés, celle de l'interlocuteur retournée pour qu'il lise face à moi.
// Rien n'est gardé dans le navigateur : ni texte, ni son (seul le son du dernier tour reste en mémoire, le temps de le renvoyer
// si Odin hésite sur qui a parlé). Ce fichier ne touche ni la page ni le réseau à son chargement : tout part de dessiner().
(() => {
  'use strict';
  const LANGUES = ['fr', 'en', 'ja'];
  const BCP = { fr: 'fr-FR', en: 'en-US', ja: 'ja-JP' };
  const NOM_LOCAL = { fr: 'Français', en: 'English', ja: '日本語' };
  const NOM_FR = { fr: 'français', en: 'anglais', ja: 'japonais' };
  const PROPOSE = { fr: ['en', 'ja'], en: ['fr', 'ja'], ja: ['fr', 'en'] };
  const TAUX = 16000;

  // Les textes de chaque moitié, dans sa langue (les réglages, eux, restent en français).
  const TEXTES = {
    fr: {
      ecoute: 'J\'écoute…', traduction: 'Je traduis…', voix: 'Je parle…', aVous: 'À vous', appui: 'Maintenir pour parler', parler: 'Parler',
      attente: 'En attente', ecrire: 'Écrire au lieu de parler', envoyer: 'Envoyer', corriger: 'Toucher pour corriger ce qui a été entendu',
      retraduire: 'Retraduire', redire: 'Redire', annuler: 'Annuler', autre: 'C\'était l\'autre personne ?', pasDeVoix: 'Pas de voix pour cette langue sur cet appareil',
      verifier: 'Nombres à vérifier', horsLigne: 'Traduction hors ligne, approximative', vide: 'Ici s\'affiche ce que dit l\'autre personne, dans votre langue.',
      erreur: 'La traduction a échoué', entendu: 'Entendu', incertain: 'Pas sûr de qui a parlé', ecouteKo: 'Odin n\'a pas pu écouter',
    },
    en: {
      ecoute: 'Listening…', traduction: 'Translating…', voix: 'Speaking…', aVous: 'Your turn', appui: 'Hold to talk', parler: 'Talk',
      attente: 'Waiting', ecrire: 'Type instead of speaking', envoyer: 'Send', corriger: 'Tap to correct what was heard',
      retraduire: 'Translate again', redire: 'Say it again', annuler: 'Cancel', autre: 'Was that the other person?', pasDeVoix: 'No voice for this language on this device',
      verifier: 'Please check the numbers', horsLigne: 'Offline translation, approximate', vide: 'What the other person says appears here, in your language.',
      erreur: 'Translation failed', entendu: 'Heard', incertain: 'Not sure who spoke', ecouteKo: 'Odin could not listen',
    },
    ja: {
      ecoute: '聞いています…', traduction: '翻訳しています…', voix: '話しています…', aVous: 'どうぞお話しください', appui: '押しながら話してください', parler: '話す',
      attente: 'お待ちください', ecrire: '話す代わりに入力する', envoyer: '送信する', corriger: 'タップして聞き取った内容を修正',
      retraduire: 'もう一度翻訳する', redire: 'もう一度読み上げる', annuler: 'キャンセル', autre: '相手の方の発言でしたか？', pasDeVoix: 'この端末にはこの言語の音声がありません',
      verifier: '数字をご確認ください', horsLigne: 'オフライン翻訳（おおよそ）', vide: '相手の方の言葉が、ここにあなたの言語で表示されます。',
      erreur: '翻訳できませんでした', entendu: '聞き取った内容', incertain: 'どちらが話したか分かりません', ecouteKo: '聞き取りができませんでした',
    },
  };

  // ---------------------------------------------------------------- logique pure (essayée sans navigateur)
  const autre = (q) => (q === 'moi' ? 'lui' : 'moi');
  const borne = (x, a, b) => Math.min(b, Math.max(a, x));

  /** Qui doit parler ensuite : l'autre que celui qui vient de parler ; rien ne change tant qu'Odin n'est pas sûr. */
  function attendu(actuel, tour) {
    if (!tour || !tour.ok || (tour.qui !== 'moi' && tour.qui !== 'lui')) return actuel;
    if (tour.incertain) return actuel;
    if (tour.rien) return tour.qui; // pas compris : la même personne répète
    return autre(tour.qui);
  }

  /** Face à face (téléphone : moitié du haut retournée) ou côte à côte (ordinateur). */
  function disposition(largeur, tactile, faceAFace) {
    const face = faceAFace === 'oui' ? true : faceAFace === 'non' ? false : (Number(largeur) <= 760 || !!tactile);
    return { mode: face ? 'face' : 'cote', rotation: face };
  }

  /** Une voix du navigateur dans la bonne langue (jamais une voix française pour du japonais), ou null. */
  function choisirVoix(voix, langue, localSeulement) {
    const l = String(langue || '').slice(0, 2).toLowerCase(), cible = String(BCP[l] || langue || '').toLowerCase();
    const code = (v) => String(v.lang || '').toLowerCase().replace('_', '-');
    const bonnes = [...(voix || [])].filter((v) => v && code(v).split('-')[0] === l && (!localSeulement || v.localService === true));
    if (!bonnes.length) return null;
    return bonnes.find((v) => code(v) === cible && v.localService) || bonnes.find((v) => code(v) === cible) || bonnes.find((v) => v.localService) || bonnes[0];
  }

  /** Niveau d'un morceau de son (moyenne quadratique). */
  function niveau(t) {
    if (!t || !t.length) return 0;
    let s = 0; for (let i = 0; i < t.length; i++) s += t[i] * t[i];
    return Math.sqrt(s / t.length);
  }

  /** Change la fréquence d'un son (moyenne pour descendre, plus proche pour monter) : la durée reste la même. */
  function reechantillonner(e, de, vers) {
    if (!e || !e.length) return new Float32Array(0);
    if (de === vers) return Float32Array.from(e);
    const r = de / vers, n = Math.max(1, Math.round(e.length / r)), s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.min(e.length - 1, Math.floor(i * r)), b = Math.min(e.length, Math.max(a + 1, Math.floor((i + 1) * r)));
      let t = 0; for (let j = a; j < b; j++) t += e[j];
      s[i] = t / (b - a);
    }
    return s;
  }

  /** Recolle des morceaux de son. */
  function coller(morceaux) {
    let n = 0; for (const m of morceaux) n += m.length;
    const s = new Float32Array(n); let o = 0;
    for (const m of morceaux) { s.set(m, o); o += m.length; }
    return s;
  }

  /** Un fichier WAV mono, 16 bits, à la fréquence donnée (16 kHz par défaut). */
  function encoderWav(s, taux = TAUX) {
    const n = s.length, buf = new ArrayBuffer(44 + n * 2), d = new DataView(buf);
    const ecr = (o, t) => { for (let i = 0; i < t.length; i++) d.setUint8(o + i, t.charCodeAt(i)); };
    ecr(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); ecr(8, 'WAVE'); ecr(12, 'fmt ');
    d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, taux, true);
    d.setUint32(28, taux * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); ecr(36, 'data'); d.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) { const v = borne(Number(s[i]) || 0, -1, 1); d.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
    return new Uint8Array(buf);
  }

  /**
   * Détecteur de parole : une image toutes les 50 ms (le niveau du micro). Rend un événement ou null :
   * { type:'debut' } la parole commence (150 ms au-dessus du seuil) ;
   * { type:'morceau' } après 8 s de parole, à la première pause de 0,4 s : un morceau part, le tour continue (« suite ») ;
   * { type:'fin', raison:'pause'|'coupe', vide } fin du tour (silence de « pause » secondes, ou 30 s sans pause) ;
   *   vide : rien n'a été dit depuis le dernier morceau ;
   * { type:'ignore' } moins de 300 ms de parole (un bruit), ou la voix d'Odin s'est mise à parler.
   * Le bruit de fond est appris pendant 500 ms, puis suivi (le plus bas sur 3 s, hors parole). Seuil = max(bruit × 3, 0,01).
   * opt.voix : la voix d'Odin parle (aucun tour ne commence, le bruit n'est pas appris) ;
   * opt.attente : on n'écoute pas encore (mode « un bouton chacun »), le bruit est appris.
   */
  function vad(o = {}) {
    const pas = o.pas ?? 50, fen = Math.round(3000 / pas), recents = Math.round(500 / pas);
    let pause = Math.round(borne(Number(o.pause) || 1.2, 0.8, 2.5) * 1000);
    const E = { t: 0, bruit: 0, seuil: 0.01, parole: false, debut: 0, morceau: 0, dessus: 0, silence: 0, derniere: 0, parleMorceau: false, hist: [], recents: [] };
    const apprendre = (n) => { E.hist.push(n); if (E.hist.length > fen) E.hist.shift(); E.bruit = Math.min(...E.hist); E.seuil = Math.max(E.bruit * 3, 0.01); };
    const finir = () => { E.parole = false; E.dessus = 0; E.silence = 0; };
    function image(n, opt = {}) {
      E.t += pas; n = Number.isFinite(n) ? Math.max(0, n) : 0;
      E.recents.push(n); if (E.recents.length > recents) E.recents.shift();
      if (opt.voix) {
        E.dessus = 0;
        if (E.parole) { finir(); return { type: 'ignore', raison: 'voix' }; }
        return null;
      }
      if (!E.parole) {
        if (E.t <= 500 || opt.attente) { E.dessus = 0; apprendre(n); return null; }
        if (n > E.seuil) {
          E.dessus += pas;
          if (E.dessus >= 150) {
            E.parole = true; E.debut = E.t - E.dessus; E.morceau = E.debut; E.silence = 0; E.derniere = E.t; E.parleMorceau = true; E.dessus = 0;
            return { type: 'debut', t: E.debut };
          }
          return null;
        }
        E.dessus = 0; apprendre(n); return null;
      }
      if (n > E.seuil) { E.silence = 0; E.derniere = E.t; E.parleMorceau = true; } else E.silence += pas;
      if (E.silence >= pause) {
        const parlee = E.derniere - E.debut, vide = !E.parleMorceau; finir();
        if (parlee < 300) return { type: 'ignore', raison: 'court' };
        return { type: 'fin', raison: 'pause', vide };
      }
      if (E.t - E.morceau >= 30000) {
        finir();
        // Le fond sonore a peut-être monté d'un coup : on le réapprend sur les 500 dernières millisecondes.
        E.hist = [...E.recents]; E.bruit = Math.min(...E.hist); E.seuil = Math.max(E.bruit * 3, 0.01);
        return { type: 'fin', raison: 'coupe', vide: false };
      }
      if (E.t - E.morceau >= 8000 && E.silence >= 400 && E.parleMorceau) { E.morceau = E.t; E.parleMorceau = false; return { type: 'morceau', raison: 'suite' }; }
      return null;
    }
    return {
      image,
      etat: () => ({ t: E.t, bruit: E.bruit, seuil: E.seuil, parole: E.parole }),
      regler: (p) => { pause = Math.round(borne(Number(p) || 1.2, 0.8, 2.5) * 1000); },
    };
  }

  /** « C'était l'autre personne ? » : seulement quand Odin hésite sur QUI a parlé, pas quand la langue sort de la paire. */
  const peutDireAutre = (tour) => !!(tour && tour.incertain && !tour.horsPaire);

  /** Le dernier morceau d'un tour (« suite ») n'a rien apporté (souffle, bruit) : le tour d'avant reste, avec sa traduction. */
  const garderSuite = (prec, r) => (prec && r && r.ok && (r.inchange || r.rien) ? prec : r);

  /** L'heure locale « 14:02 » d'une date ISO (jamais l'heure UTC lue dans la chaîne). */
  function heureLocale(iso) {
    const d = new Date(iso); if (!Number.isFinite(d.getTime())) return '--:--';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /** Les enfants à poser (replaceChildren changerait un null en texte « null »). */
  const enfants = (...k) => k.flat(9).filter((x) => x != null && x !== false);

  /** La hauteur de la scène face à face : l'écran, moins ce qui est au-dessus et la barre du bas d'Odin. */
  const hauteurScene = (haut, bas) => `max(320px, calc(100dvh - ${Math.max(0, Math.round(Number(haut) || 0))}px - ${Math.max(0, Math.round(Number(bas) || 0))}px - 12px))`;

  /** « 1,2 Mo », « 340 Ko », « 0 o » : la taille d'un son gardé, pour l'annoncer sans affoler. */
  function libelleTaille(octets) {
    const o = Math.max(0, Math.round(Number(octets) || 0));
    if (o < 1024) return `${o} o`;
    if (o < 1024 * 1024) return `${(o / 1024).toFixed(o < 10 * 1024 ? 1 : 0).replace('.', ',')} Ko`;
    return `${(o / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
  }

  /** « 1 min 05 », « 12 s » : une durée en secondes, pour annoncer la part d'enregistrement gardée. */
  function libelleDuree(secondes) {
    const s = Math.max(0, Math.round(Number(secondes) || 0));
    return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`;
  }

  /** La date d'une conversation en clair « 16/11/2026, 14:02 » (heure locale), ou « — » si la date manque. */
  function dateConv(iso) {
    const d = new Date(iso); if (!Number.isFinite(d.getTime())) return '—';
    const j = (n) => String(n).padStart(2, '0');
    return `${j(d.getDate())}/${j(d.getMonth() + 1)}/${d.getFullYear()}, ${j(d.getHours())}:${j(d.getMinutes())}`;
  }

  /** Les codes de langue d'une conversation, dans l'ordre d'apparition (pour un titre neutre « fr ↔ ja »). */
  function languesConv(tours) {
    const vus = [];
    for (const t of tours || []) for (const c of [t && t.de, t && t.vers]) if (c && !vus.includes(c)) vus.push(c);
    return vus;
  }

  /** L'état du voyant d'enregistrement : rouge et annoncé quand ça tourne, éteint sinon. */
  function etatRec(enr) {
    const actif = !!(enr && enr.actif);
    const octets = Math.max(0, Math.round(Number(enr && enr.sonOctets) || 0));
    return { actif, bouton: actif ? 'Arrêter l\'enregistrement' : 'Enregistrer cette conversation', annonce: actif ? `Enregistrement en cours${octets ? ` · ${libelleTaille(octets)}` : ''}` : '', taille: octets ? libelleTaille(octets) : '' };
  }

  const logique = { autre, attendu, disposition, choisirVoix, niveau, reechantillonner, coller, encoderWav, vad, peutDireAutre, garderSuite, heureLocale, enfants, hauteurScene, libelleTaille, libelleDuree, dateConv, languesConv, etatRec, PROPOSE, BCP };

  // ---------------------------------------------------------------- la page
  const P = {
    racine: null, act: null, etat: null, erreurEtat: '', reglages: null, conv: null, attendu: 'moi',
    vue: { moi: {}, lui: {} }, etatMoitie: { moi: 'attente', lui: 'attente' }, ui: null, edition: null,
    micro: null, voix: null, voixFin: 0, audio: null, stopVoix: null, file: Promise.resolve(),
    tourCourant: null, suiteDe: null, sonTour: [], dernierSon: null, dernierTour: null, attenteDire: 0, attenteTour: null,
    arme: null, armeMinuteur: 0, appui: null, nav: null, navChoisi: false, panneau: false, tiroir: false, horsPaire: null,
    verrou: null, derniereParole: 0, ecouteurs: [], dispo: '',
    enr: { conv: null, actif: false, peut: true, sonOctets: 0, limite: null }, enrVoulu: false, convOuverte: null,
  };

  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const chip = (t, c, lang) => el('span', { class: 'rd-chip', lang, style: `background:${c}1f;color:${c};box-shadow:inset 0 0 0 1px ${c}40` }, t);
  const actParDefaut = async (action, input = {}) => (await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'rodd', action, input }) })).json();
  const api = (chemin, corps, type) => fetch(`/api/rodd/conversation/${chemin}`, { method: 'POST', headers: { 'content-type': type || 'application/json', 'x-odin': '1' }, body: type ? corps : JSON.stringify(corps ?? {}) });
  const apiJson = async (chemin, corps, type) => {
    const r = await api(chemin, corps, type);
    try { return await r.json(); } catch { return { ok: false, error: `Réponse inattendue d'Odin (${r.status}).` }; }
  };
  // L'archive d'Écho (lot « serveur ») : son gardé, transcription conservée, résumé. Jamais d'erreur jetée : la vue reste.
  const archive = async (chemin, corps) => {
    try {
      const r = await fetch(`/api/rodd/archive/${chemin}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(corps ?? {}) });
      try { return await r.json(); } catch { return { ok: false, error: `Réponse inattendue d'Odin (${r.status}).` }; }
    } catch (e) { return { ok: false, error: e.message, absent: true }; }
  };

  const langue = (qui) => (qui === 'moi' ? P.reglages?.moi : P.reglages?.lui) || 'fr';
  const T = (qui) => TEXTES[langue(qui)] || TEXTES.fr;
  const infoLangue = (code) => P.etat?.langues?.find?.((l) => l.code === code);
  const nomLocal = (code) => infoLangue(code)?.nomLocal || NOM_LOCAL[code] || code;
  const nomFr = (code) => infoLangue(code)?.nom || NOM_FR[code] || code;
  const proposees = (moi) => { const p = infoLangue(moi)?.propose; return Array.isArray(p) && p.length ? p : PROPOSE[moi] || []; };
  const tactile = () => { try { return !!window.matchMedia?.('(pointer: coarse)').matches; } catch { return false; } };
  const enTrainDeParler = () => !!P.voix || Date.now() - P.voixFin < 400;
  const vivant = () => !!P.racine?.isConnected;

  const CSS = `
.rc{--moi:#4f8cff;--lui:#3ecf8e;display:flex;flex-direction:column;gap:14px;min-width:0}
.rc *{box-sizing:border-box}
.rc [hidden]{display:none!important}
.rc-ecrire button{white-space:nowrap;flex:none}
.rc [lang=ja]{font-family:'Hiragino Sans','Yu Gothic UI','Noto Sans JP',system-ui,sans-serif}
.rc .rd-btn,.rc .rc-ib{min-height:44px}
.rc-mut{color:var(--mut2,#9aa1b2);font-size:13px;margin:0}
.rc-scene{display:grid;gap:12px;min-width:0}
.rc-scene.cote{grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-areas:"barre barre" "moi lui"}
.rc-scene.face{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) auto minmax(0,1fr);grid-template-areas:"lui" "barre" "moi";min-height:320px}
.rc-m[data-qui=moi]{grid-area:moi}.rc-m[data-qui=lui]{grid-area:lui}.rc-barre{grid-area:barre}
.rc-scene.face .rc-m[data-qui=lui]{transform:rotate(180deg)}
.rc-m{--c:var(--moi);display:flex;flex-direction:column;gap:11px;padding:18px 20px;min-width:0;min-height:0;overflow:auto;position:relative;border:1px solid color-mix(in srgb,var(--c) 26%,transparent);background:linear-gradient(180deg,color-mix(in srgb,var(--c) 9%,#171a22) 0%,#14161dcc 60%)}
.rc-m::before{content:'';position:absolute;left:0;top:14px;bottom:14px;width:3px;border-radius:3px;background:linear-gradient(180deg,var(--c),transparent)}
.rc-m[data-qui=lui]{--c:var(--lui);border-color:color-mix(in srgb,var(--lui) 30%,transparent)}
.rc-tete{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}
.rc-tete b{font-size:15.5px;color:var(--c)}
.rc-pers{width:26px;height:26px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:13px;font-weight:700;color:var(--c);background:color-mix(in srgb,var(--c) 18%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--c) 45%,transparent)}
.rc-role{font-size:12px;color:var(--mut2,#9aa1b2)}
.rc-etat{margin-left:auto;display:inline-flex;align-items:center;gap:7px;font:600 13px inherit;color:var(--c);min-height:18px}
.rc-etat:empty{display:none}
.rc-etat::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--c);box-shadow:0 0 10px var(--c);animation:rc-pulse 1.3s ease-in-out infinite}
.rc-grand{margin:0;font-size:clamp(24px,4vw,33px);font-weight:600;line-height:1.35;overflow-wrap:anywhere;flex:1 1 auto;min-height:1.4em;letter-spacing:-.2px}
.rc-grand.vide{color:var(--mut2,#9aa1b2);font-size:17px;font-weight:500;letter-spacing:0}
.rc-petit{align-self:flex-start;max-width:100%;text-align:left;background:#ffffff08;border:1px dashed color-mix(in srgb,var(--c) 40%,#ffffff2a);border-radius:12px;padding:8px 12px;min-height:44px;color:#cfd3dd;font-size:14px;line-height:1.45;cursor:pointer;overflow-wrap:anywhere;font-family:inherit}
.rc-petit:hover{border-style:solid;color:#fff}
.rc-petit small{display:block;font-size:11.5px;color:var(--mut2,#9aa1b2)}
.rc-edit{display:flex;flex-direction:column;gap:8px}
.rc-edit textarea,.rc-ecrire input,.rc-panneau input[type=text],.rc-resume textarea{width:100%;min-width:0;min-height:44px;border-radius:12px;border:1px solid #ffffff1a;background:#0b0d12;color:var(--ink2,#eef0f6);padding:8px 12px;font:15px/1.45 inherit}
.rc-edit textarea{min-height:72px;resize:vertical}
.rc-notes{display:flex;gap:6px;flex-wrap:wrap}
.rc-actes{display:flex;gap:8px;flex-wrap:wrap}
.rc-ecrire{display:flex;gap:8px;min-width:0}
.rc-parler{width:100%;min-height:52px;justify-content:center;touch-action:none;-webkit-user-select:none;user-select:none;border-color:color-mix(in srgb,var(--c) 55%,transparent)!important;color:var(--c)!important;background:color-mix(in srgb,var(--c) 14%,transparent)!important}
.rc-parler.on{border-color:#ff3b3b88!important;color:#ff6b6b!important;background:#ff3b3b1a!important}
.rc-barre{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;padding:12px 14px;min-width:0}
.rc-go{min-height:48px;padding:0 20px;border-radius:999px;display:inline-flex;align-items:center;gap:10px;font:700 14px inherit;cursor:pointer;border:1px solid #4f8cff66;background:linear-gradient(180deg,#4f8cff33,#4f8cff1a);color:#dbe6ff;box-shadow:0 6px 18px #4f8cff22}
.rc-go:hover{border-color:#4f8cffaa}
.rc-go.on{border-color:#ff3b3b77;background:linear-gradient(180deg,#ff3b3b2a,#ff3b3b14);color:#ffd6d6;box-shadow:0 6px 18px #ff3b3b22}
.rc-voyant{width:12px;height:12px;border-radius:50%;background:#5b6070;flex:none}
.rc-voyant.on{background:#ff3b3b;animation:rc-bat 1.1s ease-in-out infinite}
.rc-statut{font:600 13px inherit;color:var(--mut2,#9aa1b2);min-width:0;flex:1 1 160px;text-align:center;overflow-wrap:anywhere}
.rc-rec{display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:0 14px;border-radius:999px;font:600 13px inherit;cursor:pointer;border:1px solid #ffffff1a;background:#ffffff0a;color:#cfd3dd}
.rc-rec:hover{border-color:#ffffff33;color:#fff}
.rc-rec .pt{width:11px;height:11px;border-radius:50%;background:#7a8192;flex:none}
.rc-rec.on{border-color:#ff3b3b88;background:#ff3b3b1f;color:#ffd6d6}
.rc-rec.on .pt{background:#ff3b3b;box-shadow:0 0 10px #ff3b3b;animation:rc-bat 1.1s ease-in-out infinite}
.rc-ib{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:#ffffff0a;border:1px solid #ffffff14;color:#cfd3dd;cursor:pointer;font-size:18px}
.rc-ib:hover{color:#fff;border-color:#ffffff30}
.rc-ib[aria-expanded=true]{border-color:#4f8cff77;color:#fff}
.rc-band{padding:12px 16px;display:flex;flex-direction:column;gap:8px;font-size:13.5px;line-height:1.45}
.rc-band.alerte{border-color:#f5a62466}
.rc-band pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;background:#0b0d12;border-radius:10px;padding:8px 10px;font-size:12.5px}
.rc-panneau,.rc-liste{padding:16px 18px;display:flex;flex-direction:column;gap:14px}
.rc-panneau .rd-seg{flex-wrap:wrap!important;overflow:visible!important;max-width:100%}
.rc-panneau .rd-seg button{white-space:normal!important}
.rc-ligne{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}
.rc-ligne>span:first-child{min-width:190px;color:var(--mut2,#9aa1b2);font-size:13px}
.rc-ligne label{display:inline-flex;align-items:center;gap:8px;min-height:44px;cursor:pointer}
.rc-ligne input[type=checkbox]{width:20px;height:20px}
.rc-ligne input[type=range]{flex:1 1 160px;min-width:0;max-width:320px}
.rc-conv{border:1px solid #ffffff14;border-radius:16px;padding:13px 15px;display:flex;flex-direction:column;gap:9px;background:#ffffff06}
.rc-conv.ici{border-color:#4f8cff55;background:#4f8cff10}
.rc-conv-h{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;min-width:0}
.rc-conv-h b{font-size:15px;overflow-wrap:anywhere}
.rc-conv-h .meta{flex:1 1 180px;min-width:0;display:flex;flex-direction:column;gap:3px}
.rc-conv-h small{color:var(--mut2,#9aa1b2);font-size:12px}
.rc-tours{padding:4px 0;display:flex;flex-direction:column;gap:7px;max-height:280px;overflow:auto}
.rc-tour{display:flex;flex-direction:column;gap:2px;border-left:2px solid color-mix(in srgb,var(--c,#4f8cff) 55%,transparent);padding:2px 0 2px 10px}
.rc-tour[data-qui=lui]{--c:var(--lui)}.rc-tour[data-qui=moi]{--c:var(--moi)}
.rc-tour small{color:var(--mut2,#9aa1b2);font-size:11.5px}
.rc-tour .e{font-size:13.5px;overflow-wrap:anywhere}.rc-tour .t{font-size:13.5px;color:#cfe0ff;overflow-wrap:anywhere}
.rc-resume{display:flex;flex-direction:column;gap:9px;background:#3ecf8e0f;border:1px solid #3ecf8e33;border-radius:14px;padding:13px 15px}
.rc-resume textarea{min-height:92px;resize:vertical}
.rc-resume audio{width:100%;height:38px}
.rc-corrige{display:flex;flex-direction:column;gap:9px;background:#ffffff08;border:1px solid #ffffff1a;border-radius:14px;padding:13px 15px}
.rc-corr{display:flex;flex-direction:column;gap:2px;border-left:2px solid #3ecf8e55;padding-left:9px}
.rc-corr .av{color:#9aa0ab;text-decoration:line-through}
.rc-corr .ap{color:#eef0f6}
.rc-son{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.rc-son audio{flex:1 1 220px;min-width:0;height:40px}
@keyframes rc-bat{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.3);opacity:.6}}
@keyframes rc-pulse{0%,100%{opacity:1}50%{opacity:.4}}
@media (prefers-reduced-motion:reduce){.rc-voyant.on,.rc-rec.on .pt,.rc-etat::before{animation:none}}
@media (max-width:480px){.rc-ligne>span:first-child{min-width:0;flex:1 1 100%}.rc-m{padding:13px 15px}.rc-barre{padding:9px}.rc-statut{order:9;flex:1 1 100%;font-size:12.5px}}
`;

  // ---------------------------------------------------------------- état, écouteurs
  async function chargerEtat() {
    try {
      const r = await apiJson('etat', {});
      if (r && r.ok && r.reglages) { P.etat = r; P.reglages = r.reglages; P.erreurEtat = ''; return true; }
      P.erreurEtat = r?.error || 'Odin n\'a pas répondu.';
    } catch (e) { P.erreurEtat = e.message; }
    P.etat = null; return false;
  }

  function poser(cible, type, fn) { cible.addEventListener(type, fn); P.ecouteurs.push([cible, type, fn]); }
  function retirer() { for (const [c, t, f] of P.ecouteurs) c.removeEventListener(t, f); P.ecouteurs = []; }

  function statut(t) { P.statut = t; if (P.ui?.statut) P.ui.statut.textContent = t; }
  function etat(qui, cle) {
    P.etatMoitie[qui] = cle;
    const n = P.ui?.etat?.[qui]; if (n) n.textContent = cle ? (TEXTES[langue(qui)]?.[cle] ?? '') : '';
  }
  function etatsRepos() {
    const mode = P.reglages?.ecoute;
    if (P.micro && mode === 'appui') { etat('moi', 'appui'); etat('lui', 'appui'); }
    else if (P.micro) { etat(P.attendu, 'aVous'); etat(autre(P.attendu), mode === 'auto' ? 'ecoute' : ''); }
    else { etat('moi', 'attente'); etat('lui', 'attente'); }
    if (P.micro) statut(mode === 'auto' ? 'J\'écoute… parlez chacun votre tour.' : mode === 'boutons' ? 'Touchez « Parler » dans votre moitié, puis parlez.' : 'Maintenez « Parler » (ou la barre d\'espace pour vous) pendant que vous parlez.');
  }
  function majVoyant() {
    const on = !!(P.micro || P.nav);
    P.ui?.voyant?.classList.toggle('on', on);
    if (P.ui?.go) { P.ui.go.classList.toggle('on', !!P.micro); P.ui.goTexte.textContent = P.micro ? 'Arrêter' : 'Commencer'; P.ui.go.setAttribute('aria-pressed', String(!!P.micro)); }
  }

  // ---------------------------------------------------------------- dessin
  function rendre() {
    if (!vivant() || !P.etat) return;
    const R = P.reglages, disp = disposition(window.innerWidth || 1280, tactile(), R.faceAFace);
    P.dispo = disp.mode;
    P.ui = { etat: {} };
    const scene = el('div', { class: `rc-scene ${disp.mode}` }, moitie('lui'), barre(), moitie('moi'));
    const kids = [...bandeaux(), scene];
    if (P.panneau) kids.push(panneau());
    if (P.tiroir) kids.push(tiroir());
    P.racine.replaceChildren(...kids);
    majVoyant();
    for (const q of ['moi', 'lui']) etat(q, P.etatMoitie[q]);
    if (P.statut) statut(P.statut);
    if (disp.mode === 'face') {
      const haut = Math.max(0, Math.round(scene.getBoundingClientRect().top + (window.scrollY || 0)));
      // La barre du bas d'Odin (téléphone) prend aussi de la place : sa hauteur compte la zone sûre du bas.
      let bas = 0;
      try { const b = document.querySelector('.bnav'); if (b && getComputedStyle(b).display !== 'none') bas = b.getBoundingClientRect().height; } catch { /* pas de barre */ }
      scene.style.height = hauteurScene(haut, bas);
    }
  }

  function moitie(qui) {
    const l = langue(qui), t = TEXTES[l], v = P.vue[qui] || {}, sien = v.petit;
    const grand = v.grand
      ? el('p', { class: 'rc-grand', lang: v.grandLang || l }, v.grand)
      : el('p', { class: 'rc-grand vide', lang: l }, t.vide);
    const notes = el('div', { class: 'rc-notes' },
      v.horsLigne ? chip(t.horsLigne, '#9aa1b2', l) : null,
      v.verifier ? chip(`${t.verifier} : ${v.verifier}`, '#f5a624', l) : null,
      v.sansVoix ? chip(t.pasDeVoix, '#f5a624', l) : null,
      v.erreur ? chip(`${t.erreur}`, '#ff6b6b', l) : null,
      v.erreurEcoute ? chip(t.ecouteKo, '#ff6b6b', l) : null);
    let petit = null;
    if (P.edition?.qui === qui) {
      const ta = el('textarea', { lang: l, 'aria-label': t.corriger }); ta.value = P.edition.texte;
      ta.addEventListener('input', () => { if (P.edition) P.edition.texte = ta.value; });
      petit = el('div', { class: 'rc-edit' }, ta, el('div', { class: 'rc-actes' },
        el('button', { class: 'rd-btn g', type: 'button', onclick: () => { const e = P.edition; P.edition = null; if (e.texte.trim()) envoyerTexte(e.texte.trim(), qui, e.id); else rendre(); } }, t.retraduire),
        el('button', { class: 'rd-btn n', type: 'button', onclick: () => { P.edition = null; rendre(); } }, t.annuler)));
      setTimeout(() => ta.focus(), 0);
    } else if (sien && sien.entendu) {
      petit = el('button', { class: 'rc-petit', type: 'button', lang: sien.de || l, title: t.corriger, 'aria-label': `${t.corriger} : ${sien.entendu}`, onclick: () => { P.edition = { qui, id: sien.id, texte: sien.entendu }; rendre(); } },
        el('small', { lang: l }, `${t.entendu} ✎`), sien.entendu);
    }
    const actes = el('div', { class: 'rc-actes' },
      v.incertain && P.dernierSon && P.dernierTour?.id === v.incertain ? el('button', { class: 'rd-btn', type: 'button', lang: l, onclick: () => cEtaitLAutre() }, t.autre) : null,
      v.redire && v.redire.traduit ? el('button', { class: 'rd-btn n', type: 'button', lang: l, onclick: () => dire(v.redire.traduit, v.redire.vers, autre(qui)) }, t.redire) : null);
    const bouton = boutonParler(qui, t);
    const champ = el('input', { type: 'text', lang: l, placeholder: t.ecrire, 'aria-label': t.ecrire, enterkeyhint: 'send' });
    const ecrire = el('form', { class: 'rc-ecrire', onsubmit: (e) => { e.preventDefault(); const x = champ.value.trim(); if (!x) return; champ.value = ''; envoyerTexte(x, qui); } },
      champ, el('button', { class: 'rd-btn n', type: 'submit', lang: l }, t.envoyer));
    const et = el('span', { class: 'rc-etat', role: 'status', 'aria-live': 'polite', lang: l });
    P.ui.etat[qui] = et;
    return el('section', { class: 'rd-g rc-m', 'data-qui': qui, lang: l, 'aria-label': `${qui === 'moi' ? 'Ma moitié' : 'Moitié de l\'interlocuteur'} : ${nomLocal(l)}` },
      el('div', { class: 'rc-tete' }, el('span', { class: 'rc-pers', 'aria-hidden': 'true' }, qui === 'moi' ? '•' : '••'),
        el('b', { lang: l }, nomLocal(l)), el('span', { class: 'rc-role', lang: 'fr' }, qui === 'moi' ? 'moi' : 'interlocuteur'), et),
      grand, notes, petit, actes, bouton, ecrire);
  }

  function boutonParler(qui, t) {
    const mode = P.reglages.ecoute, navire = !P.etat.ecoute?.pret && P.navChoisi;
    if (navire) return el('button', { class: 'rd-btn rc-parler', type: 'button', lang: langue(qui), onclick: () => ecouterNavigateur(qui) }, t.parler);
    if (mode === 'boutons') {
      return el('button', { class: `rd-btn rc-parler${P.arme === qui ? ' on' : ''}`, type: 'button', lang: langue(qui), 'aria-pressed': String(P.arme === qui), onclick: () => armer(qui) }, t.parler);
    }
    if (mode === 'appui') {
      const b = el('button', { class: `rd-btn rc-parler${P.appui?.qui === qui ? ' on' : ''}`, type: 'button', lang: langue(qui) }, t.appui);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); b.classList.add('on'); appuyer(qui); });
      const lacher = () => { b.classList.remove('on'); relacher(qui); };
      b.addEventListener('pointerup', lacher); b.addEventListener('pointercancel', lacher);
      b.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); appuyer(qui); } });
      b.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); relacher(qui); } });
      return b;
    }
    return null;
  }

  function barre() {
    const voyant = el('span', { class: 'rc-voyant', 'aria-hidden': 'true' });
    const goTexte = el('span', {}, P.micro ? 'Arrêter' : 'Commencer');
    const go = el('button', { class: 'rc-go', type: 'button', 'aria-pressed': String(!!P.micro), onclick: () => (P.micro ? arreterMicro('Micro coupé.') : commencer()) }, voyant, goTexte);
    const st = el('span', { class: 'rc-statut', role: 'status', 'aria-live': 'polite' }, P.statut || '');
    const inter = el('button', { class: 'rd-btn n', type: 'button', hidden: !P.voix, onclick: () => arreterVoix() }, 'Interrompre');
    const vrec = etatRec(P.enr);
    const actifRec = vrec.actif || (!P.enr.actif && P.enrVoulu);
    const rec = el('button', { class: `rc-rec${actifRec ? ' on' : ''}`, type: 'button', 'aria-pressed': String(actifRec),
      title: 'Garder une copie sonore de cette conversation, chiffrée sur la machine', 'aria-label': vrec.bouton + (actifRec ? ' (annoncé)' : ''),
      onclick: () => basculerEnr() }, el('span', { class: 'pt', 'aria-hidden': 'true' }), actifRec ? 'Enregistrement' : 'Enregistrer');
    Object.assign(P.ui, { voyant, go, goTexte, statut: st, interrompre: inter });
    return el('div', { class: 'rd-g rc-barre' }, go, rec, st, inter,
      el('button', { class: 'rc-ib', type: 'button', title: 'Inverser les deux langues', 'aria-label': 'Inverser les deux langues', onclick: () => regler({ moi: P.reglages.lui, lui: P.reglages.moi }) }, '⇅'),
      el('button', { class: 'rc-ib', type: 'button', title: 'Réglages de la conversation', 'aria-label': 'Réglages de la conversation', 'aria-expanded': String(P.panneau), onclick: () => { P.panneau = !P.panneau; rendre(); } }, '⚙'),
      el('button', { class: 'rd-btn n', type: 'button', 'aria-expanded': String(P.tiroir), onclick: () => { P.tiroir = !P.tiroir; rendre(); } }, 'Conversations'));
  }

  function bandeaux() {
    const E = P.etat, R = P.reglages, out = [];
    if (P.horsPaire && LANGUES.includes(P.horsPaire) && P.horsPaire !== R.moi && P.horsPaire !== R.lui) {
      const h = P.horsPaire;
      const ancien = P.dernierTour?.horsPaire === h ? P.dernierTour : null, attenduL = ancien ? langue(ancien.qui) : null;
      out.push(el('div', { class: 'rd-g rc-band alerte' }, el('span', {}, `J'entends du ${nomFr(h)} : passer à ${nomFr(R.moi)} ↔ ${nomFr(h)} ?`),
        el('div', { class: 'rc-actes' }, el('button', { class: 'rd-btn', type: 'button', onclick: () => changerPaire(h) }, 'Oui, changer'),
          ancien && P.dernierSon && attenduL !== h ? el('button', { class: 'rd-btn n', type: 'button', onclick: () => { P.horsPaire = null; reecouterComme(ancien.qui); } }, `Non, c'était bien du ${nomFr(attenduL)}`) : null,
          el('button', { class: 'rd-btn n', type: 'button', onclick: () => { P.horsPaire = null; P.dernierSon = null; rendre(); } }, 'Non'))));
    }
    if (!E.traduction?.pret) {
      out.push(el('div', { class: 'rd-g rc-band alerte' },
        el('b', {}, 'Pas de traduction possible pour l\'instant'),
        el('span', {}, E.traduction?.raison || 'Aucun modèle d\'IA ni serveur de traduction sur la machine.'),
        el('span', {}, 'Configure un modèle dans Réglages → Modèle, ou installe un serveur de traduction libre sur la machine (traduction hors ligne, approximative) :'),
        el('pre', {}, E.traduction?.aide || 'pip install libretranslate\nlibretranslate --load-only en,fr,ja'),
        el('div', {}, el('button', { class: 'rd-btn', type: 'button', onclick: () => window.OdinShow?.('settings') }, 'Ouvrir les Réglages'))));
    }
    if (!E.ecoute?.pret) {
      const sr = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      out.push(el('div', { class: 'rd-g rc-band alerte' },
        el('b', {}, 'Odin ne peut pas écouter'),
        el('span', {}, E.ecoute?.raison || 'Whisper n\'est pas installé sur la machine, et aucun service d\'écoute n\'est configuré (Réglages → Voix).'),
        el('span', {}, 'Vous pouvez toujours écrire au clavier dans chaque moitié.'),
        E.navigateurEcoute && sr && !R.local
          ? (P.navChoisi
            ? chip('Écoute du navigateur : le son part au service du navigateur', '#f5a624')
            : el('div', {}, el('button', { class: 'rd-btn n', type: 'button', onclick: () => { P.navChoisi = true; rendre(); } }, 'Utiliser l\'écoute du navigateur (le son part au service du navigateur)')))
          : null));
    } else if ((R.moi === 'ja' || R.lui === 'ja') && !E.ecoute?.japonais) {
      out.push(el('div', { class: 'rd-g rc-band alerte' }, el('span', {}, `Le modèle d'écoute installé${E.ecoute?.modele ? ` (${E.ecoute.modele})` : ''} comprend mal le japonais : installe le modèle Whisper « small » (ou plus grand) depuis Réglages → Voix.`)));
    }
    return out;
  }

  function pastilles() {
    const E = P.etat, e = E.ecoute || {}, tr = E.traduction || {}, vx = E.voix || {};
    const ecoute = e.pret ? (e.ou === 'machine' ? `Écoute : sur la machine${e.modele ? ` (${e.modele})` : ''}` : 'Écoute : service configuré') : 'Écoute : indisponible';
    const trad = tr.pret ? (tr.moteur === 'hors-ligne' ? `Traduction : hors ligne, approximative${tr.nom ? ` (${tr.nom})` : ''}` : `Traduction : modèle d'Odin${tr.nom ? ` (${tr.nom})` : ''}`) : 'Traduction : indisponible';
    const mot = { machine: 'machine', service: 'service', navigateur: 'navigateur' };
    const voix = `Voix : ${LANGUES.map((l) => `${NOM_FR[l]} ${mot[vx[l]] || '?'}`).join(' · ')}`;
    return el('div', { class: 'rc-notes' }, chip(ecoute, e.pret ? '#3ecf8e' : '#ff6b6b'), chip(trad, tr.pret ? '#3ecf8e' : '#ff6b6b'), chip(voix, '#4f8cff'), E.local ? chip('Tout sur la machine', '#3ecf8e') : null);
  }

  function panneau() {
    const R = P.reglages;
    const seg = (label, valeurs, actuel, champ) => el('div', { class: 'rc-ligne' }, el('span', {}, label),
      el('div', { class: 'rd-seg', role: 'group', 'aria-label': label }, ...valeurs.map(([v, t, lang]) => el('button', { type: 'button', lang, 'aria-pressed': String(actuel === v), onclick: () => regler({ [champ]: v }) }, t))));
    const coche = (label, champ) => { const i = el('input', { type: 'checkbox' }); i.checked = !!R[champ]; i.addEventListener('change', () => regler({ [champ]: i.checked })); return el('label', {}, i, label); };
    const curseur = (label, champ, min, max, pasR, unite) => {
      const val = el('b', {}, `${String(R[champ]).replace('.', ',')} ${unite}`);
      const i = el('input', { type: 'range', min, max, step: pasR, 'aria-label': label }); i.value = R[champ];
      i.addEventListener('input', () => { val.textContent = `${String(i.value).replace('.', ',')} ${unite}`; });
      i.addEventListener('change', () => regler({ [champ]: Number(i.value) }));
      return el('div', { class: 'rc-ligne' }, el('span', {}, label), i, val);
    };
    const ordre = proposees(R.moi); // la langue proposée par défaut d'abord (ordre donné par Odin)
    const serveur = el('input', { type: 'text', 'aria-label': 'Adresse du serveur de traduction sur la machine', inputmode: 'url', style: 'flex:1 1 220px;max-width:360px' }); serveur.value = R.serveur || '';
    return el('section', { class: 'rd-g rc-panneau', 'aria-label': 'Réglages de la conversation' },
      el('div', { class: 'rc-ligne' }, el('b', { style: 'font-size:16px' }, 'Réglages de la conversation'), el('button', { class: 'rd-btn n', type: 'button', style: 'margin-left:auto', onclick: () => { P.panneau = false; rendre(); } }, 'Fermer')),
      pastilles(),
      seg('Ma langue', LANGUES.map((c) => [c, `${nomLocal(c)}`, c]), R.moi, 'moi'),
      seg('Langue de l\'interlocuteur', ordre.map((c) => [c, `${nomLocal(c)}`, c]), R.lui, 'lui'),
      el('div', { class: 'rc-ligne' }, el('span', {}, 'En voyage'), el('div', { class: 'rc-actes' },
        el('button', { class: 'rd-btn n', type: 'button', onclick: () => regler({ voyage: 'angleterre' }) }, 'Je pars en Angleterre'),
        el('button', { class: 'rd-btn n', type: 'button', onclick: () => regler({ voyage: 'japon' }) }, 'Je pars au Japon'),
        el('button', { class: 'rd-btn n', type: 'button', onclick: () => regler({ voyage: 'france' }) }, 'Je pars en France'))),
      seg('Écoute', [['auto', 'Automatique'], ['boutons', 'Un bouton chacun'], ['appui', 'Appuyer pour parler']], R.ecoute, 'ecoute'),
      curseur('Fin de phrase après un silence de', 'pause', 0.8, 2.5, 0.1, 's'),
      el('div', { class: 'rc-ligne' }, el('span', {}, 'Voix'), coche('Dire ma phrase traduite', 'direMoi'), coche('Me dire sa réponse', 'direLui')),
      curseur('Vitesse de la voix', 'vitesse', 0.7, 1.5, 0.05, '×'),
      seg('Face à face (moitié retournée)', [['auto', 'Automatique'], ['oui', 'Oui'], ['non', 'Non']], R.faceAFace, 'faceAFace'),
      el('div', { class: 'rc-ligne' }, el('span', {}, 'Confidentialité'), coche('Tout sur la machine (rien ne part à un service extérieur)', 'local'), coche('Garder l\'historique (texte seulement, chiffré)', 'garder')),
      seg('Traduction par', [['auto', 'Automatique'], ['modele', 'Le modèle d\'Odin'], ['hors-ligne', 'Hors ligne (serveur sur la machine)']], R.moteur, 'moteur'),
      el('div', { class: 'rc-ligne' }, el('span', {}, 'Serveur de traduction (maison)'), serveur, el('button', { class: 'rd-btn n', type: 'button', onclick: () => regler({ serveur: serveur.value.trim() }) }, 'Enregistrer')));
  }

  function tiroir() {
    const corps = el('div', { style: 'display:flex;flex-direction:column;gap:12px' }, el('p', { class: 'rc-mut' }, 'Chargement…'));
    const box = el('section', { class: 'rd-g rc-liste', 'aria-label': 'Conversations passées' },
      el('div', { class: 'rc-ligne' }, el('b', { style: 'font-size:16px' }, 'Conversations passées'), el('button', { class: 'rd-btn n', type: 'button', style: 'margin-left:auto', onclick: () => { P.tiroir = false; rendre(); } }, 'Fermer')),
      corps);
    remplirTiroir(corps);
    return box;
  }

  const qui = (q) => (q === 'moi' ? 'Moi' : 'Interlocuteur');

  /** Télécharge un texte en fichier .txt (jamais une fenêtre native : un lien cliqué puis retiré). */
  function telecharger(texte, nom) {
    const url = URL.createObjectURL(new Blob([texte], { type: 'text/plain;charset=utf-8' }));
    const a = el('a', { href: url, download: nom || 'conversation.txt', style: 'display:none' }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /** Les tours d'une conversation, dans la liste (qui a parlé, langues, texte entendu, traduction, heure). */
  function transcription(tours) {
    return el('div', { class: 'rc-tours', 'aria-label': 'Transcription' }, ...tours.map((i) => el('div', { class: 'rc-tour', 'data-qui': i.qui === 'moi' ? 'moi' : 'lui' },
      el('small', {}, `${heureLocale(i.at)} · ${qui(i.qui)} · ${nomFr(i.de)} → ${nomFr(i.vers)}${i.corrige ? ' · corrigé' : ''}`),
      el('span', { class: 'e', lang: i.de }, i.entendu || ''), el('span', { class: 't', lang: i.vers }, i.traduit || '—'))));
  }

  /** Le bloc résumé d'une conversation : texte fait par le modèle d'Odin, modifiable et copiable, gardé avec la conversation. */
  function blocResume(conv) {
    const ta = el('textarea', { 'aria-label': 'Résumé de la conversation (modifiable)', placeholder: 'Pas encore de résumé.' });
    const etatR = el('span', { class: 'rc-mut' }, 'Chargement du résumé…');
    const copier = el('button', { class: 'rc-ib', type: 'button', title: 'Copier le résumé', 'aria-label': 'Copier le résumé', onclick: async (e) => { try { await navigator.clipboard.writeText(ta.value); e.currentTarget.style.color = '#3ecf8e'; } catch { ta.select(); } } }, '⧉');
    const resumer = el('button', { class: 'rd-btn g', type: 'button', onclick: async () => {
      resumer.disabled = true; etatR.textContent = 'Odin résume…';
      const r = await archive('resume', { conv });
      resumer.disabled = false;
      if (r && r.ok && typeof r.texte === 'string') { ta.value = r.texte; etatR.textContent = r.modele ? `Résumé par ${r.modele}.` : 'Résumé fait.'; enreg.hidden = false; }
      else { etatR.textContent = ''; await window.OdinDialog.alert(r?.aide || r?.error || 'Impossible de résumer : aucun modèle d\'Odin configuré.'); }
    } }, 'Résumer');
    const enreg = el('button', { class: 'rd-btn', type: 'button', hidden: true, onclick: async () => {
      const r = await archive('resume-modifier', { conv, texte: ta.value });
      etatR.textContent = r && r.ok ? 'Modifications enregistrées.' : (r?.error || 'Enregistrement refusé.'); if (r && r.ok) enreg.hidden = true;
    } }, 'Enregistrer les modifications');
    ta.addEventListener('input', () => { enreg.hidden = false; });
    (async () => {
      const r = await archive('resume-lire', { conv });
      if (r && r.ok && r.texte) { ta.value = r.texte; etatR.textContent = r.modifie ? 'Résumé modifié par vous.' : 'Résumé gardé.'; }
      else if (r && r.absent) { etatR.textContent = 'Le résumé n\'est pas encore disponible sur cette machine.'; resumer.disabled = true; }
      else etatR.textContent = 'Aucun résumé : touchez « Résumer ».';
    })();
    return el('div', { class: 'rc-resume', 'aria-label': 'Résumé' },
      el('div', { class: 'rc-ligne' }, el('b', { style: 'font-size:14px;color:#3ecf8e' }, 'Résumé'), resumer, el('span', { style: 'margin-left:auto' }, copier)),
      ta, el('div', { class: 'rc-actes' }, enreg, etatR));
  }

  /** Corriger l'orthographe d'une transcription gardée : chaque tour est corrigé DANS SA LANGUE par le modèle d'Odin.
   * On montre l'avant / après (ce qui a changé), puis le propriétaire garde (texte chiffré remplacé) ou annule. */
  function blocCorrection(conv) {
    const etat = el('span', { class: 'rc-mut' });
    const liste = el('div', { style: 'display:flex;flex-direction:column;gap:7px' });
    const garder = el('button', { class: 'rd-btn g', type: 'button' }, 'Garder les corrections');
    const annuler = el('button', { class: 'rd-btn n', type: 'button', onclick: () => { liste.replaceChildren(); actes.hidden = true; etat.textContent = 'Corrections annulées.'; } }, 'Annuler');
    const actes = el('div', { class: 'rc-actes', hidden: true }, garder, annuler);
    const corriger = el('button', { class: 'rd-btn', type: 'button', onclick: async () => {
      corriger.disabled = true; etat.textContent = 'Odin corrige l\'orthographe…'; liste.replaceChildren(); actes.hidden = true;
      const r = await archive('corriger', { conv });
      corriger.disabled = false;
      if (!r || !r.ok) { etat.textContent = ''; await window.OdinDialog.alert(r?.aide || r?.error || 'Impossible de corriger : aucun modèle d\'Odin configuré.'); return; }
      const changes = (r.tours || []).filter((t) => t.change);
      if (!changes.length) { etat.textContent = 'Aucune faute trouvée : rien à corriger.'; return; }
      etat.textContent = `${changes.length} tour${changes.length > 1 ? 's' : ''} à corriger (par ${r.modele || 'le modèle d\'Odin'}).`;
      liste.replaceChildren(...changes.map((t) => el('div', { class: 'rc-corr' },
        el('span', { class: 'av', lang: t.de }, t.avant), el('span', { class: 'ap', lang: t.de }, t.apres))));
      actes.hidden = false;
      garder.onclick = async () => {
        garder.disabled = true;
        const g = await archive('corriger-garder', { conv, corrections: changes.map((t) => ({ id: t.id, apres: t.apres })) });
        garder.disabled = false; liste.replaceChildren(); actes.hidden = true;
        etat.textContent = g && g.ok ? `Corrigé : ${g.n} tour${g.n > 1 ? 's' : ''} gardé${g.n > 1 ? 's' : ''}.` : (g?.error || 'Impossible de garder.');
        if (g && g.ok) remplirTiroir(P.ui.listeCorps);
      };
    } }, 'Corriger l\'orthographe');
    return el('div', { class: 'rc-corrige', 'aria-label': 'Corriger l\'orthographe' },
      el('div', { class: 'rc-ligne' }, el('b', { style: 'font-size:14px' }, 'Orthographe'), corriger),
      etat, liste, actes);
  }

  function carteConv(c, tours) {
    const ici = c.conv === P.conv, ouverte = P.convOuverte === c.conv;
    const codes = c.titre ? [] : languesConv(tours);
    const titre = c.titre || (codes.length >= 2 ? `Conversation ${nomFr(codes[0])} ↔ ${nomFr(codes[1])}` : 'Conversation traduite');
    const langs = (c.langues && c.langues.length ? c.langues : codes).map(nomFr).join(' ↔ ') || '—';
    const son = c.son && c.son.existe ? c.son : null;
    const url = `/api/rodd/archive/son?conv=${encodeURIComponent(c.conv)}`;
    const sousTitre = `${dateConv(c.debut || (tours[0] && tours[0].at))} · ${langs} · ${c.n || tours.length} tour${(c.n || tours.length) > 1 ? 's' : ''}${son ? ` · son ${libelleTaille(son.octets)}` : ''}${ici ? ' · en cours' : ''}`;
    const copier = async () => {
      const x = await P.act('conv_exporter', { conv: c.conv });
      const texte = x?.data?.texte; if (!texte) { await window.OdinDialog.alert(x?.text || x?.error || 'Rien à copier.'); return; }
      try { await navigator.clipboard.writeText(texte); statut('Transcription copiée.'); } catch { telecharger(texte, x.data.nom); }
    };
    const exporter = async () => {
      const x = await P.act('conv_exporter', { conv: c.conv });
      if (!x?.data?.texte) { await window.OdinDialog.alert(x?.text || x?.error || 'Rien à exporter.'); return; }
      telecharger(x.data.texte, x.data.nom || 'conversation.txt');
    };
    const supprimer = async () => {
      const ok = await window.OdinDialog.confirm(`Supprimer cette conversation ?\nSa transcription${son ? ', sa copie sonore' : ''} et son résumé seront effacés, sans retour.`, { ok: 'Supprimer', danger: true });
      if (!ok) return;
      const x = await P.act('conv_effacer', { conv: c.conv });
      if (P.convOuverte === c.conv) P.convOuverte = null;
      statut(x?.text || 'Conversation supprimée.'); remplirTiroir(P.ui.listeCorps);
    };
    const tete = el('div', { class: 'rc-conv-h' },
      el('div', { class: 'meta' }, el('b', {}, titre), el('small', {}, sousTitre)),
      el('button', { class: 'rd-btn n', type: 'button', 'aria-expanded': String(ouverte), onclick: () => { P.convOuverte = ouverte ? null : c.conv; remplirTiroir(P.ui.listeCorps); } }, ouverte ? 'Fermer' : 'Ouvrir'));
    const actes = el('div', { class: 'rc-actes' },
      el('button', { class: 'rd-btn', type: 'button', onclick: copier }, 'Copier'),
      el('button', { class: 'rd-btn n', type: 'button', onclick: exporter }, 'Exporter'),
      son ? el('a', { class: 'rd-btn n', href: url, download: `${titre}.wav`, role: 'button' }, 'Télécharger le son') : null,
      el('button', { class: 'rd-btn n', type: 'button', style: 'margin-left:auto;border-color:#ff6b6b55;color:#ff9a9a', onclick: supprimer }, 'Supprimer'));
    const detail = ouverte ? el('div', { style: 'display:flex;flex-direction:column;gap:11px' },
      son ? el('div', { class: 'rc-son' }, el('span', { class: 'rc-mut' }, 'Copie sonore'), el('audio', { controls: 'true', preload: 'none', src: url })) : null,
      transcription(tours), blocCorrection(c.conv), blocResume(c.conv)) : null;
    return el('div', { class: `rc-conv${ici ? ' ici' : ''}` }, tete, detail, actes);
  }

  async function remplirTiroir(corps) {
    P.ui = P.ui || {}; P.ui.listeCorps = corps;
    const r = await P.act('conv_historique', { n: 400 }).catch(() => null);
    const d = r?.data ?? { items: [], garde: true, conversations: [] };
    const items = d.items || [];
    const parConv = new Map();
    for (const i of items) { if (!parConv.has(i.conv)) parConv.set(i.conv, []); parConv.get(i.conv).push(i); }
    // On part de la liste des conversations du serveur (la plus récente d'abord) ; à défaut, on la déduit des tours.
    let convs = Array.isArray(d.conversations) && d.conversations.length ? [...d.conversations]
      : [...parConv.keys()].map((conv) => ({ conv, debut: parConv.get(conv)[0]?.at, n: parConv.get(conv).length }));
    if (P.conv && !convs.some((c) => c.conv === P.conv) && parConv.has(P.conv)) convs.unshift({ conv: P.conv, debut: parConv.get(P.conv)[0]?.at, n: parConv.get(P.conv).length });
    convs = convs.sort((a, b) => (a.conv === P.conv ? 0 : 1) - (b.conv === P.conv ? 0 : 1));
    const effacerTout = async () => {
      const ok = await window.OdinDialog.confirm('Supprimer toutes les conversations traduites ?\nTranscriptions, copies sonores et résumés seront effacés, sans retour.', { ok: 'Tout supprimer', danger: true });
      if (!ok) return;
      const x = await P.act('conv_effacer', {}); P.convOuverte = null;
      statut(x?.text || 'Tout effacé.'); remplirTiroir(corps);
    };
    corps.replaceChildren(...enfants(
      d.garde === false ? el('p', { class: 'rc-mut' }, 'L\'historique n\'est pas gardé (réglage « Garder l\'historique »).') : null,
      convs.length ? null : el('p', { class: 'rc-mut' }, 'Aucune conversation gardée pour l\'instant.'),
      ...convs.map((c) => carteConv(c, parConv.get(c.conv) || [])),
      convs.length ? el('div', { class: 'rc-actes', style: 'margin-top:4px' }, el('button', { class: 'rd-btn n', type: 'button', onclick: effacerTout }, 'Tout supprimer')) : null));
  }

  // ---------------------------------------------------------------- réglages
  async function regler(champs) {
    const r = await P.act('conv_regler', champs).catch((e) => ({ ok: false, error: e.message }));
    if (!r?.ok || !r.data) { await window.OdinDialog.alert(r?.text || r?.error || 'Réglage refusé.'); return; }
    const avant = P.reglages; P.reglages = r.data;
    if (P.micro && avant.pause !== P.reglages.pause) P.micro.vad.regler(P.reglages.pause);
    if (P.micro && avant.ecoute !== P.reglages.ecoute) { P.arme = null; P.appui = null; if (P.micro.rec) P.micro.rec = null; }
    if (['local', 'moteur', 'serveur', 'moi', 'lui'].some((k) => avant[k] !== P.reglages[k])) {
      const ancien = P.etat;
      if (!(await chargerEtat())) { P.etat = ancien; P.reglages = r.data; }
      if (P.micro && !P.etat.ecoute?.pret) { arreterMicro(P.etat.ecoute?.raison || 'Odin ne peut plus écouter : micro coupé.'); return; }
    }
    etatsRepos(); rendre();
  }

  // ---------------------------------------------------------------- micro
  function deverrouillerSon() {
    // Le geste de la personne autorise la lecture du son plus tard (iPhone) : un son muet, une phrase vide.
    try {
      const u = URL.createObjectURL(new Blob([encoderWav(new Float32Array(160))], { type: 'audio/wav' }));
      const a = new Audio(u); a.volume = 0; a.onended = a.onerror = () => URL.revokeObjectURL(u); a.play().catch(() => URL.revokeObjectURL(u));
    } catch { /* pas de son ici */ }
    try { if (window.speechSynthesis && window.SpeechSynthesisUtterance) { const u = new SpeechSynthesisUtterance(''); u.volume = 0; window.speechSynthesis.speak(u); } } catch { /* rien */ }
  }

  const nouvelleConv = () => { P.conv = `c-${Date.now().toString(36)}`; };
  const assurerConv = () => { if (!P.conv) nouvelleConv(); };

  /** L'état d'enregistrement de la conversation en cours (voyant, place prise), lu auprès du serveur d'archive. */
  async function chargerEnr() {
    if (!P.conv) { P.enr = { conv: null, actif: false, peut: true, sonOctets: 0, limite: null }; return; }
    const r = await archive('etat', { conv: P.conv });
    if (r && r.ok) P.enr = { conv: P.conv, actif: !!r.enregistre, peut: r.peutEnregistrer !== false, sonOctets: Number(r.sonOctets) || 0, limite: r.limite || null };
    else P.enr = { conv: P.conv, actif: P.enrVoulu, peut: !(r && r.absent), sonOctets: 0, limite: null };
  }

  /** Allume ou éteint la copie sonore de CETTE conversation (éteinte par défaut, toujours annoncée par le voyant rouge). */
  async function basculerEnr() {
    assurerConv();
    const vise = !(P.enr.actif || (!P.enr.actif && P.enrVoulu && !P.enr.conv));
    P.enrVoulu = vise;
    const r = await archive('enregistrer', { conv: P.conv, actif: vise });
    if (r && r.ok) { P.enr = { ...P.enr, conv: P.conv, actif: !!r.enregistre }; statut(r.enregistre ? 'Enregistrement : la copie sonore est gardée, chiffrée sur la machine.' : 'Enregistrement arrêté.'); }
    else if (r && r.absent) { statut('L\'enregistrement n\'est pas encore disponible sur cette machine.'); P.enr = { ...P.enr, actif: false }; P.enrVoulu = false; }
    else { await window.OdinDialog.alert(r?.error || 'Enregistrement refusé.'); P.enr = { ...P.enr, actif: false }; P.enrVoulu = false; }
    rendre();
  }

  async function commencer() {
    if (!P.etat.ecoute?.pret) {
      statut(P.navChoisi ? 'Touchez « Parler » dans votre moitié.' : 'Odin ne peut pas écouter : écrivez au clavier, ou voyez le bandeau ci-dessus.');
      return;
    }
    nouvelleConv(); P.vue = { moi: {}, lui: {} }; P.attendu = 'moi'; P.dernierSon = null; P.dernierTour = null; P.horsPaire = null;
    P.enr = { conv: P.conv, actif: false, peut: true, sonOctets: 0, limite: null };
    if (await demarrerMicro()) {
      // La personne avait demandé l'enregistrement avant de commencer : on l'allume pour cette conversation.
      if (P.enrVoulu) { const r = await archive('enregistrer', { conv: P.conv, actif: true }); if (r && r.ok) P.enr.actif = !!r.enregistre; }
      else chargerEnr().then(() => { if (vivant()) rendre(); });
      rendre();
    }
  }

  async function demarrerMicro() {
    if (P.micro) return true;
    if (!P.etat?.ecoute?.pret) { statut(P.etat?.ecoute?.raison || 'Odin ne peut pas écouter : écrivez au clavier.'); return false; }
    deverrouillerSon();
    const md = navigator.mediaDevices;
    if (!md || !(window.AudioContext || window.webkitAudioContext)) { statut('Micro indisponible ici : ouvrez Odin en HTTPS, ou écrivez au clavier.'); return false; }
    let flux;
    try { flux = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); } catch { statut('Accès au micro refusé par le navigateur.'); return false; }
    const AC = window.AudioContext || window.webkitAudioContext, ac = new AC();
    try { await ac.resume(); } catch { /* déjà en route */ }
    const src = ac.createMediaStreamSource(flux), an = ac.createAnalyser(); an.fftSize = 1024; src.connect(an);
    // ScriptProcessorNode : la page n'a pas le droit de charger un module de traitement du son (règles de sécurité).
    const sp = ac.createScriptProcessor(4096, 1, 1); src.connect(sp); sp.connect(ac.destination);
    const M = { flux, ac, src, an, sp, taux: ac.sampleRate, avant: [], avantN: 0, rec: null, vad: vad({ pause: P.reglages.pause }), minuteur: 0 };
    sp.onaudioprocess = (e) => {
      e.outputBuffer.getChannelData(0).fill(0);
      const x = reechantillonner(e.inputBuffer.getChannelData(0), M.taux, TAUX);
      if (M.rec) { M.rec.push(x); return; }
      M.avant.push(x); M.avantN += x.length;
      // 400 ms gardées avant le début de la parole (plus les 150 ms qu'il faut pour la reconnaître).
      while (M.avant.length > 1 && M.avantN - M.avant[0].length >= TAUX * 0.55) M.avantN -= M.avant.shift().length;
    };
    const tampon = new Float32Array(an.fftSize);
    M.minuteur = setInterval(() => imageMicro(M, tampon), 50);
    P.micro = M; P.derniereParole = Date.now();
    try { P.verrou = await navigator.wakeLock?.request?.('screen'); } catch { P.verrou = null; }
    assurerConv(); majVoyant(); etatsRepos();
    return true;
  }

  function prendre(M) { const s = M.rec ? coller(M.rec) : new Float32Array(0); M.rec = []; return s; }

  function imageMicro(M, tampon) {
    if (P.micro !== M) return;
    if (!vivant()) { arreter(); return; }
    M.an.getFloatTimeDomainData(tampon);
    const n = niveau(tampon), voix = enTrainDeParler();
    if (voix) { M.avant = []; M.avantN = 0; P.derniereParole = Date.now(); }
    if (P.appui) { M.vad.image(n, { attente: true }); return; }
    const ev = M.vad.image(n, { voix, attente: P.reglages.ecoute === 'appui' || (P.reglages.ecoute === 'boutons' && !P.arme) });
    if (ev) surEvenement(M, ev);
    if (Date.now() - P.derniereParole > 180000) arreterMicro('Micro coupé : 3 minutes sans parole.');
  }

  function surEvenement(M, ev) {
    if (ev.type === 'debut') {
      M.rec = [...M.avant]; M.avant = []; M.avantN = 0; P.derniereParole = Date.now();
      if (P.attenteDire) { clearTimeout(P.attenteDire); P.attenteDire = 0; P.suiteDe = P.attenteTour; P.attenteTour = null; P.sonTour = P.dernierSon ? [P.dernierSon] : []; }
      clearTimeout(P.armeMinuteur);
      const q = P.arme || P.suiteDe?.qui || P.attendu; etat(q, 'ecoute'); statut('J\'écoute…');
    } else if (ev.type === 'morceau') {
      envoyer(prendre(M), { fin: false });
    } else if (ev.type === 'fin') {
      const son = ev.vide ? null : prendre(M); M.rec = null;
      envoyer(son, { fin: true });
    } else if (ev.type === 'ignore') {
      M.rec = null;
      if (P.suiteDe && !P.tourCourant) { const t = P.suiteDe; P.suiteDe = null; finirTour(t); } else etatsRepos();
    }
  }

  function armer(qui) {
    (async () => {
      if (!P.micro && !(await demarrerMicro())) return;
      P.arme = qui; etat(qui, 'aVous'); statut(`À ${qui === 'moi' ? 'vous' : 'l\'interlocuteur'} : parlez.`);
      clearTimeout(P.armeMinuteur); P.armeMinuteur = setTimeout(() => { if (P.arme === qui && !P.micro?.rec) { P.arme = null; etatsRepos(); rendre(); } }, 10000);
      rendre();
    })();
  }

  function appuyer(qui) {
    if (P.appui) return;
    P.appui = { qui, t0: Date.now(), lache: false };
    (async () => {
      if (!P.micro && !(await demarrerMicro())) { P.appui = null; return; }
      const A = P.appui; if (!A || A.qui !== qui) return;
      if (A.lache) { P.appui = null; statut('Trop court : maintenez pendant que vous parlez.'); return; }
      const M = P.micro; M.rec = [...M.avant]; M.avant = []; M.avantN = 0; A.t0 = Date.now(); P.derniereParole = Date.now();
      etat(qui, 'ecoute'); statut('J\'écoute…');
    })();
  }

  function relacher(qui) {
    const A = P.appui; if (!A || A.qui !== qui) return;
    const M = P.micro;
    if (!M || !M.rec) { A.lache = true; return; }
    P.appui = null;
    const son = prendre(M); M.rec = null;
    if (Date.now() - A.t0 < 300 || son.length < TAUX * 0.3) { statut('Trop court : maintenez pendant que vous parlez.'); etatsRepos(); return; }
    envoyer(son, { fin: true, qui });
  }

  function arreterMicro(message) {
    const M = P.micro; if (!M) return;
    P.micro = null; clearInterval(M.minuteur); clearTimeout(P.armeMinuteur);
    const reste = M.rec && M.rec.length ? coller(M.rec) : null;
    try { M.sp.onaudioprocess = null; M.sp.disconnect(); M.src.disconnect(); } catch { /* déjà débranché */ }
    for (const t of M.flux.getTracks()) t.stop();
    M.ac.close().catch(() => {});
    try { P.verrou?.release?.().catch?.(() => {}); } catch { /* rien */ } P.verrou = null;
    P.arme = null; P.appui = null;
    if (reste && reste.length >= TAUX * 0.3 && vivant()) envoyer(reste, { fin: true });
    else if (P.attenteTour) { const t = P.attenteTour; clearTimeout(P.attenteDire); P.attenteDire = 0; P.attenteTour = null; direTour(t); }
    majVoyant(); etatsRepos(); if (message) statut(message);
    if (vivant()) rendre();
  }

  // ---------------------------------------------------------------- tours
  function envoyer(son, { fin, qui }) {
    assurerConv();
    const quiF = qui || P.arme || null;
    if (fin) P.arme = null;
    P.file = P.file.then(async () => {
      let tour = P.tourCourant || P.suiteDe;
      if (son && son.length >= TAUX * 0.3) {
        P.sonTour.push(son);
        etat(tour?.qui || quiF || P.attendu, 'traduction'); statut('Je traduis…');
        const q = new URLSearchParams({ conv: P.conv, qui: tour ? tour.qui : (quiF || 'auto'), attendu: P.attendu });
        if (tour) q.set('suite', tour.id);
        const r = await apiJson(`tour?${q}`, new Blob([encoderWav(son)], { type: 'audio/wav' }), 'audio/wav');
        if (!r || !r.ok) {
          const msg = r?.code === 'vide' ? '' : (r?.error || 'Odin n\'a pas pu traiter ce tour.');
          if (fin) { P.tourCourant = null; P.suiteDe = null; P.sonTour = []; if (tour) await finirTour(tour); else etatsRepos(); }
          // Le message s'écrit APRÈS le retour au repos (qui réécrit la barre d'état), et dans la moitié concernée.
          if (msg) await erreurEcoute(tour?.qui || quiF || P.attendu, msg, r?.code);
          return;
        }
        const garde = garderSuite(tour, r);
        if (garde === r) { tour = r; P.tourCourant = r; afficherTour(r); }
      }
      if (fin) { P.tourCourant = null; P.suiteDe = null; if (tour) await finirTour(tour); else { P.sonTour = []; etatsRepos(); } }
    }).catch((e) => { statut(e.message); });
  }

  async function finirTour(tour) {
    const total = P.sonTour.reduce((n, s) => n + s.length, 0);
    P.dernierSon = total && total <= TAUX * 60 ? coller(P.sonTour) : null; P.sonTour = [];
    P.dernierTour = tour;
    P.attendu = attendu(P.attendu, tour);
    if (tour.incertain && P.dernierSon) rendre(); // montre « C'était l'autre personne ? »
    if (tour.inacheve && P.micro) {
      P.attenteTour = tour;
      P.attenteDire = setTimeout(() => { P.attenteDire = 0; const t = P.attenteTour; P.attenteTour = null; if (t) direTour(t); }, 1500);
      return;
    }
    await direTour(tour);
  }

  function afficherTour(tour, { correction } = {}) {
    const s = tour.qui === 'lui' ? 'lui' : 'moi', o = autre(s);
    P.vue[s] = { ...(P.vue[s] || {}), petit: tour, incertain: peutDireAutre(tour) ? tour.id : null, erreur: !!tour.erreurTraduction && !tour.rien, erreurEcoute: '', redire: correction ? tour : null };
    if (tour.rien) {
      P.vue[s].grand = tour.message || ''; P.vue[s].grandLang = tour.de;
    } else {
      P.vue[o] = { ...(P.vue[o] || {}), grand: tour.traduit || '', grandLang: tour.vers, horsLigne: tour.moteur === 'hors-ligne', verifier: tour.verifier || '', sansVoix: false };
    }
    if (tour.horsPaire) P.horsPaire = tour.horsPaire;
    if (tour.erreurTraduction) statut(`Traduction impossible : ${tour.erreurTraduction}`);
    else if (tour.verifier) statut(`Nombres à vérifier : ${tour.verifier}`);
    if (P.edition && P.edition.id === tour.id) P.edition = null;
    rendre();
  }

  async function direTour(tour) {
    if (!tour || !tour.ok || !vivant()) { etatsRepos(); return; }
    const R = P.reglages;
    if (tour.rien) {
      if (tour.message && (tour.qui === 'moi' ? R.direLui : R.direMoi)) await dire(tour.message, tour.de, tour.qui);
      etatsRepos(); return;
    }
    // Une phrase vide ou une traduction en échec ne se dit jamais.
    if (!tour.traduit || tour.erreurTraduction) { etatsRepos(); if (tour.erreurTraduction) statut(`Traduction impossible : ${tour.erreurTraduction}`); return; }
    if (tour.qui === 'moi' ? R.direMoi : R.direLui) await dire(tour.traduit, tour.vers, autre(tour.qui));
    etatsRepos();
  }

  /** « C'était l'autre personne ? » : le son gardé repart avec l'autre personne imposée, puis il est oublié. */
  function cEtaitLAutre() { const ancien = P.dernierTour; if (ancien) return reecouterComme(autre(ancien.qui)); }

  /** Le son gardé repart avec cette personne (donc sa langue) imposée, puis il est oublié. */
  async function reecouterComme(qui) {
    const son = P.dernierSon, ancien = P.dernierTour; if (!son || !ancien) return;
    P.dernierSon = null;
    P.vue[ancien.qui] = { ...(P.vue[ancien.qui] || {}), incertain: null, petit: null };
    P.vue[qui] = { ...(P.vue[qui] || {}), grand: '' };
    etat(qui, 'traduction'); statut('Je traduis…');
    const q = new URLSearchParams({ conv: P.conv, qui, attendu: qui });
    const r = await apiJson(`tour?${q}`, new Blob([encoderWav(son)], { type: 'audio/wav' }), 'audio/wav');
    if (!r?.ok) { rendre(); statut(r?.error || 'Odin n\'a pas pu réécouter.'); return; }
    r.incertain = false; P.dernierTour = r; afficherTour(r); P.attendu = attendu(P.attendu, r);
    await direTour(r);
  }

  /** Une erreur d'écoute : dite dans la barre d'état ET dans la moitié de la personne ; micro coupé si l'écoute n'est plus possible. */
  async function erreurEcoute(qui, msg, code) {
    P.vue[qui] = { ...(P.vue[qui] || {}), erreurEcoute: msg };
    if (code === 'ecoute' && P.micro && (await chargerEtat()) && !P.etat.ecoute?.pret) { arreterMicro(msg); return; }
    if (vivant()) rendre();
    statut(msg);
  }

  /** « Oui, changer » : la langue entendue devient celle de l'interlocuteur, et sa phrase est traduite tout de suite. */
  async function changerPaire(h) {
    const ancien = P.dernierTour?.horsPaire === h ? P.dernierTour : null;
    P.horsPaire = null; P.dernierSon = null;
    await regler({ lui: h });
    if (ancien && ancien.entendu && P.reglages?.lui === h) envoyerTexte(ancien.entendu, 'lui');
  }

  function envoyerTexte(texte, qui, remplace) {
    assurerConv();
    P.file = P.file.then(async () => {
      etat(qui, 'traduction'); statut('Je traduis…');
      const r = await apiJson('texte', { conv: P.conv, texte, qui, ...(remplace ? { remplace } : {}) });
      if (!r?.ok) { etatsRepos(); rendre(); statut(r?.error || 'Odin n\'a pas pu traduire ce texte.'); return; }
      afficherTour(r, { correction: !!remplace });
      if (remplace) { etatsRepos(); return; }
      P.dernierTour = r; P.dernierSon = null; P.attendu = attendu(P.attendu, r);
      await direTour(r);
    }).catch((e) => statut(e.message));
  }

  // Repli : l'écoute du navigateur (choisie explicitement ; le son part au service du navigateur).
  function ecouterNavigateur(qui) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    // « tout sur la machine » ou « 100 % local » de la voix (navigateurEcoute faux) : le son ne part jamais au navigateur.
    if (!SR || P.nav || P.reglages.local || !P.etat?.navigateurEcoute) return;
    deverrouillerSon();
    const r = new SR(); r.lang = BCP[langue(qui)]; r.interimResults = false; r.continuous = false; r.maxAlternatives = 1;
    P.nav = r; majVoyant(); etat(qui, 'ecoute'); statut('J\'écoute (navigateur)…');
    r.onresult = (e) => { const t = [...e.results].map((x) => x[0]?.transcript || '').join(' ').trim(); if (t) envoyerTexte(t, qui); };
    r.onerror = (e) => statut(`Écoute du navigateur : ${e.error || 'erreur'}`);
    r.onend = () => { if (P.nav === r) P.nav = null; majVoyant(); };
    try { r.start(); } catch (e) { P.nav = null; majVoyant(); statut(e.message); }
  }

  // ---------------------------------------------------------------- voix
  async function dire(texte, lang, pourQui) {
    texte = String(texte || '').trim();
    if (!texte || !LANGUES.includes(lang) || !vivant()) return;
    arreterVoix();
    const jeton = {}; P.voix = jeton;
    if (P.ui?.interrompre) P.ui.interrompre.hidden = false;
    etat(pourQui, 'voix'); statut('Je parle…');
    try {
      const r = await api('dire', { texte, langue: lang });
      if (P.voix !== jeton) return;
      const type = r.headers.get('content-type') || '';
      if (r.ok && type.startsWith('audio/')) { await jouer(await r.blob(), jeton); return; }
      const j = await r.json().catch(() => ({ ok: false, error: 'Réponse inattendue d\'Odin.' }));
      if (j.ok && j.navigateur) {
        const ok = await direNavigateur(texte, lang, !!j.localSeulement, jeton);
        if (!ok && P.voix === jeton) { P.vue[pourQui] = { ...(P.vue[pourQui] || {}), sansVoix: true }; rendre(); }
      } else statut(j.error || 'Voix indisponible.');
    } catch (e) { statut(`Voix : ${e.message}`); } finally {
      if (P.voix === jeton) { P.voix = null; P.voixFin = Date.now(); P.stopVoix = null; if (P.ui?.interrompre) P.ui.interrompre.hidden = true; }
    }
  }

  function jouer(blob, jeton) {
    const url = URL.createObjectURL(blob), a = new Audio(url);
    P.audio = a;
    return new Promise((ok) => {
      const fin = () => { URL.revokeObjectURL(url); if (P.audio === a) P.audio = null; ok(); };
      a.onended = fin; a.onerror = fin; P.stopVoix = () => { a.pause(); fin(); };
      if (P.voix !== jeton) { fin(); return; }
      a.play().catch(fin);
    });
  }

  async function direNavigateur(texte, lang, localSeulement, jeton) {
    const ss = window.speechSynthesis;
    if (!ss || !window.SpeechSynthesisUtterance) return false;
    let voix = ss.getVoices();
    if (!voix.length) { await new Promise((ok) => { const t = setTimeout(ok, 900); ss.addEventListener?.('voiceschanged', () => { clearTimeout(t); ok(); }, { once: true }); }); voix = ss.getVoices(); }
    const v = choisirVoix(voix, lang, localSeulement);
    if (!v || P.voix !== jeton) return false;
    const u = new SpeechSynthesisUtterance(texte); u.voice = v; u.lang = v.lang; u.rate = borne(Number(P.reglages.vitesse) || 1, 0.7, 1.5);
    await new Promise((ok) => {
      const garde = setTimeout(ok, Math.max(6000, texte.length * 180));
      const fin = () => { clearTimeout(garde); ok(); };
      u.onend = fin; u.onerror = fin; P.stopVoix = () => { ss.cancel(); fin(); };
      ss.speak(u);
    });
    return true;
  }

  function arreterVoix() {
    if (!P.voix && !P.audio) return;
    P.voix = null; P.voixFin = Date.now();
    try { P.stopVoix?.(); } catch { /* rien */ }
    try { window.speechSynthesis?.cancel(); } catch { /* rien */ }
    P.stopVoix = null; P.audio = null;
    if (P.ui?.interrompre) P.ui.interrompre.hidden = true;
  }

  // ---------------------------------------------------------------- ce que voit rodd.js
  async function dessiner(host, o = {}) {
    retirer();
    P.act = o.act || actParDefaut;
    if (!document.getElementById('rcCss')) document.head.append(el('style', { id: 'rcCss' }, CSS));
    const racine = el('div', { class: 'rc' }, el('p', { class: 'rc-mut' }, 'Chargement du mode conversation…'));
    host.append(racine); P.racine = racine;
    const pret = await chargerEtat();
    // La page d'Écho a pu se redessiner pendant le chargement : seul le cadre encore à l'écran est rempli.
    if (!racine.isConnected) return;
    P.racine = racine;
    if (!pret) {
      racine.replaceChildren(el('div', { class: 'rd-g rc-band alerte' }, el('b', {}, 'Mode conversation indisponible'), el('span', {}, P.erreurEtat)));
      return;
    }
    if (!P.micro) { P.etatMoitie = { moi: 'attente', lui: 'attente' }; if (!P.statut) statut('Touchez « Commencer » : Odin écoute, traduit et parle pour vous deux.'); }
    poser(document, 'visibilitychange', () => { if (document.hidden && P.micro) arreterMicro('Micro coupé : la page est passée en arrière-plan.'); });
    poser(window, 'resize', () => { if (!vivant()) { retirer(); return; } const d = disposition(window.innerWidth || 1280, tactile(), P.reglages.faceAFace).mode; if (d !== P.dispo && !P.edition) rendre(); });
    const champ = (e) => /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target?.tagName || '') || e.target?.isContentEditable;
    poser(document, 'keydown', (e) => { if (!vivant()) { retirer(); return; } if (P.reglages?.ecoute === 'appui' && e.code === 'Space' && !e.repeat && !champ(e)) { e.preventDefault(); appuyer('moi'); } });
    poser(document, 'keyup', (e) => { if (P.reglages?.ecoute === 'appui' && e.code === 'Space' && P.appui?.qui === 'moi') { e.preventDefault(); relacher('moi'); } });
    rendre();
  }

  const occupe = () => !!(P.micro || P.nav);

  function arreter() {
    clearTimeout(P.attenteDire); P.attenteDire = 0; P.attenteTour = null;
    arreterMicro();
    arreterVoix();
    try { P.nav?.abort?.(); } catch { /* rien */ } P.nav = null;
    P.edition = null;
    retirer();
  }

  window.OdinEchoConversation = { dessiner, occupe, arreter, logique, TEXTES };
})();
