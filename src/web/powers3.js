// Les pouvoirs d'Odin, nouvelle génération (maquette « Pouvoirs d'Odin » validée le 13/11/2026) : Odin prend la
// matière du pouvoir (sa forme change), fait son geste, l'attaque part de lui et détruit l'élément jusqu'au bout,
// puis il reprend sa couleur. Le moteur est celui de la maquette, tel quel : un canevas posé sur tout l'écran,
// une copie de l'élément fermé (« la fenêtre ») et un double d'Odin à la place de la mascotte.
// Seuls les pouvoirs que tu as gardés sont ici ; les autres restent dans l'ancien moteur (powers.js) ou sont retirés.
(() => {
  'use strict';
  if (window.OdinPowers3) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let root = null, cv = null, cx = null, hero = null, heroSize = 72, busy = false, running = false;
  const CSS = "/* gestes d'Odin */\n@keyframes p3gJump { 0%, 100% { transform: translateY(0) } 40% { transform: translateY(-46px) } }\n@keyframes p3gStomp { 0% { transform: translateY(0) } 45% { transform: translateY(-70px) scale(1.05) } 70% { transform: translateY(6px) scale(1.18, .78) } 100% { transform: none } }\n@keyframes p3gSpin { to { transform: rotate(720deg) } }\n@keyframes p3gRecoil { 0%, 100% { transform: none } 30% { transform: translateX(-14px) scale(.95) } }\n@keyframes p3gCharge { 0% { transform: scale(1) } 60% { transform: scale(1.2) } 100% { transform: scale(1) } }\n@keyframes p3gFloat { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-26px) } }\n@keyframes p3gGlitch { 0%, 100% { transform: none; opacity: 1 } 20% { transform: translateX(6px) skewX(12deg); opacity: .5 } 40% { transform: translateX(-6px); opacity: 1 } 60% { transform: skewX(-10deg); opacity: .6 } }\n#odinPw3 .g-jump { animation: p3gJump .55s ease-out } #odinPw3 .g-stomp { animation: p3gStomp .7s cubic-bezier(.3,0,.4,1) } #odinPw3 .g-spin { animation: p3gSpin .9s ease-in-out }\n#odinPw3 .g-recoil { animation: p3gRecoil .4s ease-out } #odinPw3 .g-charge { animation: p3gCharge .6s ease-in-out } #odinPw3 .g-float { animation: p3gFloat 1.2s ease-in-out } #odinPw3 .g-glitch { animation: p3gGlitch .5s steps(2) 2 }\n#odinPw3 /* ------------------------------------------------ Odin (m\u00eame dessin : boule lumineuse, #odinPw3 deux yeux, #odinPw3 halos) */\n.om { --size: 92px; position: relative; width: var(--size); height: var(--size); flex: none; transition: transform .3s }\n#odinPw3 .om .halo { position: absolute; inset: -6%; border-radius: 50%; background: radial-gradient(circle, transparent 74%, color-mix(in srgb, var(--halo, #fff) 46%, transparent) 82%, color-mix(in srgb, var(--halo, #fff) 22%, transparent) 90%, transparent 100%); filter: blur(1px) }\n#odinPw3 .om .orb { position: absolute; inset: 9%; border-radius: 50%; overflow: hidden; transition: background .35s, box-shadow .35s, filter .35s }\n#odinPw3 .om .fx { position: absolute; inset: 0; z-index: 2; pointer-events: none }\n#odinPw3 .om .eye { position: absolute; top: 37%; width: 8%; height: 19%; border-radius: 99px; background: var(--eye, #fff); box-shadow: var(--eyeglow, none); z-index: 3; animation: p3blink 5.5s infinite }\n#odinPw3 .om .eye.l { left: 36% } #odinPw3 .om .eye.r { left: 57% }\n#odinPw3 .om.pop { transform: scale(1.15) }\n@keyframes p3blink { 0%, 92%, 100% { transform: scaleY(1) } 95% { transform: scaleY(.1) } }\n@keyframes p3orbit { to { transform: rotate(360deg) } }\n@keyframes p3hue { to { filter: hue-rotate(360deg) } }\n@keyframes p3flow { from { background-position: 0 0 } to { background-position: 0 100% } }\n@keyframes p3flick { from { transform: scaleY(.85) rotate(-5deg) } to { transform: scaleY(1.18) rotate(5deg) } }\n@keyframes p3glow { to { box-shadow: 0 0 40px var(--glow2, rgba(255,40,20,.95)) } }\n@keyframes p3zap { 0%, 100% { opacity: 0 } 8% { opacity: 1 } 12% { opacity: 0 } 16% { opacity: 1 } 22% { opacity: 0 } 60% { opacity: .9 } 64% { opacity: 0 } }\n@keyframes p3wobble { 0%, 100% { transform: scale(1, 1) } 50% { transform: scale(1.05, .96) } }\n@keyframes p3lava { from { background-position: 0 0, 0 0 } to { background-position: 0 40px, 0 0 } }\n@keyframes p3glitch { 0%, 100% { transform: none; opacity: 1 } 20% { transform: translateX(2px) skewX(6deg); opacity: .8 } 22% { transform: translateX(-2px) } 60% { opacity: .9 } 62% { transform: translateX(1px) skewX(-4deg) } }\n@keyframes p3spinw { to { transform: rotate(-360deg) } }\n@keyframes p3rise { from { transform: translateY(6px); opacity: 0 } 30% { opacity: 1 } to { transform: translateY(-40px); opacity: 0 } }\n@media (prefers-reduced-motion: no-preference) {\n  #odinPw3 .om .halo { animation: p3orbit 9s linear infinite }\n  #odinPw3 .a-hue .orb { animation: p3hue 6s linear infinite } #odinPw3 .a-hue-slow .orb { animation: p3hue 10s linear infinite }\n  #odinPw3 .a-flow .orb { animation: p3flow 5s ease-in-out infinite alternate }\n  #odinPw3 .a-glow .orb { animation: p3glow 1.4s ease-in-out infinite alternate }\n  #odinPw3 .a-wobble { animation: p3wobble 4s ease-in-out infinite }\n  #odinPw3 .a-lava .orb { animation: p3lava 3s linear infinite, p3glow 1.6s ease-in-out infinite alternate }\n  #odinPw3 .a-spin .orb { animation: p3orbit 26s linear infinite } #odinPw3 .a-spinfast .orb { animation: p3spinw 2.4s linear infinite }\n  #odinPw3 .a-glitch .orb { animation: p3glitch 2.2s steps(1) infinite }\n  #odinPw3 .fx .flame { animation: p3flick 1s ease-in-out infinite alternate } #odinPw3 .fx .flame:nth-child(2) { animation-duration: .7s } #odinPw3 .fx .flame:nth-child(3) { animation-duration: 1.25s }\n  #odinPw3 .fx .bolt { animation: p3zap 2.3s steps(1) infinite }\n  #odinPw3 .fx .ember { animation: p3rise 2.4s linear infinite }\n}\n#odinPw3 .fx .flame { position: absolute; bottom: 74%; width: 22%; height: 38%; border-radius: 50% 50% 50% 50% / 62% 62% 38% 38%; transform-origin: 50% 100% }\n#odinPw3 .fx .ember { position: absolute; width: 3px; height: 3px; border-radius: 50%; bottom: 40% }\n#odinPw3 .fx .bolt { position: absolute; inset: 0 }\n#odinPw3 .fx .shine { position: absolute; left: 26%; top: 18%; width: 22%; height: 12%; border-radius: 50%; background: rgba(255,255,255,.85); transform: rotate(-30deg) }\n#odinPw3 .fx .spark { position: absolute; color: #fff; font-size: 12px; text-shadow: 0 0 6px var(--halo) }\n#odinPw3 .fx .leaf { position: absolute; width: 11px; height: 7px; border-radius: 50% 0; }\n#odinPw3 .fx .feather { position: absolute; width: 5px; height: 18px; border-radius: 50%; background: #2b2f3d }\n";
  function mount() {
    if (root && root.isConnected) return;
    root = document.createElement('div'); root.id = 'odinPw3'; root.setAttribute('aria-hidden', 'true');
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483001;overflow:hidden';
    const st = document.createElement('style'); st.textContent = CSS + '#odinPw3 canvas{position:absolute;inset:0;width:100%;height:100%}#odinPw3 .hero{position:absolute;z-index:2}';
    cv = document.createElement('canvas'); cx = cv.getContext('2d');
    hero = document.createElement('div'); hero.className = 'hero';
    root.append(st, hero, cv); document.body.append(root);
  }

  const orbOf = (s) => `radial-gradient(circle at 50% 46%, ${s[0]} 0, ${s[1]} 50%, ${s[2]} 82%, ${s[3]} 100%)`;
  const F = {
    // validées
    bleu: { name: 'Bleu Odin', bg: orbOf(['#1E5FD6', '#3A7BEA', '#7FB0F6', '#CFE2FF']), halo: '#BFD8FF', glow: '#3A7BEA', pc: ['#7FB0F6', '#CFE2FF'] },
    nuit: { name: 'Bleu nuit', bg: orbOf(['#2B3A9E', '#4459C8', '#8394E8', '#D3DAFF']), halo: '#C7CFFF', glow: '#4459C8', pc: ['#8394E8', '#D3DAFF'] },
    lagon: { name: 'Lagon', bg: orbOf(['#0B8F8C', '#1FB4B0', '#74DCD6', '#D2F6F3']), halo: '#B8F0EC', glow: '#1FB4B0', pc: ['#74DCD6', '#ffffff', '#1FB4B0'] },
    amethyste: { name: 'Améthyste', bg: orbOf(['#6B3FC9', '#8C5CE6', '#BFA3F5', '#EDE4FF']), halo: '#DCCBFF', glow: '#8C5CE6', pc: ['#BFA3F5', '#EDE4FF', '#6B3FC9'], fx: 'sparks' },
    emeraude: { name: 'Émeraude', bg: orbOf(['#17824F', '#2BAE6E', '#7FDDAA', '#D8F7E7']), halo: '#C2F2D8', glow: '#2BAE6E', pc: ['#7FDDAA', '#2BAE6E'], fx: 'leaves', leaf: '#3ccf7a' },
    corail: { name: 'Corail', bg: orbOf(['#D9472F', '#F06A4F', '#FFA896', '#FFE1DA']), halo: '#FFD2C8', glow: '#F06A4F', pc: ['#FFA896', '#F06A4F'] },
    bulle: { name: 'Bulle de savon', see: true, bg: 'radial-gradient(circle, rgba(255,255,255,.04) 56%, rgba(255,255,255,0) 64%), conic-gradient(from 40deg, rgba(255,120,210,.7), rgba(120,200,255,.7), rgba(150,255,190,.7), rgba(255,236,120,.7), rgba(255,120,210,.7))', mask: true, halo: '#ffd6f2', anim: 'a-hue-slow a-wobble', fx: 'shine', eyeglow: '0 0 0 1px rgba(80,90,140,.35)', pc: ['#ffb3e6', '#a8dcff', '#c8ffd8', '#fff3a8'] },
    glace: { name: 'Odin glacé', bg: 'linear-gradient(135deg, transparent 40%, rgba(255,255,255,.55) 41%, transparent 47%), linear-gradient(60deg, transparent 58%, rgba(255,255,255,.4) 59%, transparent 63%), radial-gradient(circle at 40% 34%, #ffffff 0, #e3f7ff 26%, #9fdcf7 62%, #3f97d6 100%)', halo: '#c9f0ff', glow: '#9fdcf7', eyeglow: '0 0 0 1.5px #2a6fb0', fx: 'sparks', pc: ['#ffffff', '#c9f0ff', '#7fd4ff'] },
    galaxie: { name: 'Galaxie', bg: 'radial-gradient(1.5px 1.5px at 30% 30%, #fff, transparent), radial-gradient(1px 1px at 66% 24%, #fff, transparent), radial-gradient(1.2px 1.2px at 72% 70%, #fff, transparent), radial-gradient(1px 1px at 24% 66%, #fff, transparent), conic-gradient(from 0deg, rgba(255,90,200,.55), rgba(90,120,255,.55), rgba(140,60,255,.55), rgba(255,90,200,.55)), radial-gradient(circle, #2a1458, #0b0626 80%)', halo: '#c8a8ff', glow: '#8a5cff', anim: 'a-spin', pc: ['#ffffff', '#c8a8ff', '#ff5ac8', '#5a3cff'] },
    aurore: { name: 'Aurore boréale', bg: 'linear-gradient(160deg, #0b1f3a 0%, #13405a 30%, #2ff0a8 52%, #7d5cff 74%, #0b1f3a 100%)', size: '100% 220%', halo: '#9ff7d6', glow: '#2ff0a8', anim: 'a-flow', pc: ['#2ff0a8', '#7d5cff', '#b8ffe6'] },
    neon: { name: 'Néon', bg: 'radial-gradient(circle at 50% 46%, #1a0b24 0, #22102f 62%, transparent 63%), radial-gradient(circle, transparent 62%, #ff3ad6 66%, #ff3ad6 70%, transparent 76%)', halo: '#ff8fe9', glow: '#ff3ad6', eye: '#3af0ff', eyeglow: '0 0 8px #3af0ff', pc: ['#ff3ad6', '#3af0ff'] },
    // refaites
    arc2: { name: 'Arc-en-ciel', bg: 'radial-gradient(circle at 50% 40%, rgba(255,255,255,.45), transparent 55%), repeating-conic-gradient(from 0deg, #ff2d3d 0 14%, #ff9a1f 14% 28%, #ffe62e 28% 42%, #2ee05a 42% 57%, #1fb6ff 57% 71%, #4a5bff 71% 85%, #b44dff 85% 100%)', halo: '#ffffff', glow: '#ff9a1f', anim: 'a-hue', pc: ['#ff2d3d', '#ff9a1f', '#ffe62e', '#2ee05a', '#1fb6ff', '#b44dff'], fx: 'sparks' },
    verre2: { name: 'Transparent', see: true, bg: 'radial-gradient(circle at 32% 26%, rgba(255,255,255,.9) 0, rgba(255,255,255,.25) 18%, transparent 30%), radial-gradient(circle at 70% 78%, rgba(255,255,255,.35), transparent 30%), radial-gradient(circle, rgba(170,210,255,.10) 60%, rgba(255,255,255,.55) 92%, rgba(255,255,255,.9) 100%)', glass: true, halo: '#ffffff', glow: 'rgba(255,255,255,.6)', eyeglow: '0 0 0 1px rgba(0,0,0,.35), 0 0 6px rgba(0,0,0,.25)', pc: ['#ffffff', '#dff0ff'] },
    feu2: { name: 'Odin en feu', bg: 'radial-gradient(circle at 50% 66%, #fff3a0 0, #ffb000 16%, #ff3a00 40%, #e00000 66%, #8a0000 100%)', halo: '#ff3a2a', glow: '#ff1a00', glow2: 'rgba(255,20,0,.95)', anim: 'a-glow', fx: 'flames', pc: ['#ff1a00', '#ff6a00', '#ffd000', '#8a0000'] },
    foudre2: { name: 'Foudre', bg: 'radial-gradient(circle at 50% 46%, #ffffff 0, #fffbd0 18%, #ffe600 40%, #b98cff 72%, #3b1fa8 100%)', halo: '#fff59a', glow: '#ffe600', glow2: 'rgba(255,230,0,.9)', anim: 'a-glow', fx: 'bolts', pc: ['#ffffff', '#ffe600', '#b98cff'] },
    argent2: { name: 'Chrome', bg: 'linear-gradient(180deg, #ffffff 0%, #d9dee6 22%, #6d7686 46%, #f2f4f7 52%, #9aa3b2 70%, #e8ebf0 100%)', halo: '#ffffff', glow: 'rgba(255,255,255,.5)', fx: 'shine', pc: ['#ffffff', '#c4cad4', '#7d8696'] },
    or2: { name: 'Or royal', bg: 'linear-gradient(160deg, #fff6d0 0%, #f0c24a 25%, #a8740a 50%, #ffe08a 62%, #b8860b 100%)', halo: '#ffe9a8', glow: '#e0a820', fx: 'shine', pc: ['#fff6d0', '#f0c24a', '#a8740a'] },
    // nouvelles
    rouge: { name: 'Rouge vif', bg: orbOf(['#c4000a', '#ff1020', '#ff5a5f', '#ffd0d0']), halo: '#ff8a8a', glow: '#ff1020', pc: ['#ff1020', '#ff5a5f', '#ffffff'] },
    magma: { name: 'Magma', bg: 'radial-gradient(circle at 30% 34%, #ffb000 0 3px, transparent 7px), radial-gradient(circle at 68% 62%, #ff5a00 0 2px, transparent 6px), repeating-linear-gradient(115deg, transparent 0 9px, #ff4a00 9px 11px, #ffb000 11px 12px, transparent 12px 19px), repeating-linear-gradient(35deg, transparent 0 13px, #ff3000 13px 15px, transparent 15px 23px), radial-gradient(circle, #3a1208 0, #1a0805 70%, #0d0402 100%)', halo: '#ff6a2a', glow: '#ff4a00', glow2: 'rgba(255,80,0,.95)', anim: 'a-lava', fx: 'embers', pc: ['#ff4a00', '#ffb000', '#3a1208', '#ff7a1a'] },
    // claires
    ciel: { name: 'Ciel clair', light: true, bg: orbOf(['#7cc4ff', '#a9d8ff', '#d4ecff', '#ffffff']), halo: '#e6f4ff', glow: '#a9d8ff', pc: ['#a9d8ff', '#ffffff'] },
    menthe: { name: 'Menthe', light: true, bg: orbOf(['#5fd6a8', '#8de6c2', '#c6f5e1', '#ffffff']), halo: '#dffbef', glow: '#8de6c2', pc: ['#8de6c2', '#ffffff'] },
    lavande: { name: 'Lavande', light: true, bg: orbOf(['#a48cf0', '#c2b0f7', '#e2d8ff', '#ffffff']), halo: '#efe9ff', glow: '#c2b0f7', pc: ['#c2b0f7', '#ffffff'] },
    peche: { name: 'Pêche', light: true, bg: orbOf(['#ff9f7a', '#ffbf9f', '#ffe0cf', '#ffffff']), halo: '#fff0e6', glow: '#ffbf9f', pc: ['#ffbf9f', '#ffffff'] },
    rose: { name: 'Rose poudré', light: true, bg: orbOf(['#f28bb5', '#f7b0cd', '#fcd9e7', '#ffffff']), halo: '#fff0f6', glow: '#f7b0cd', pc: ['#f7b0cd', '#ffffff'] },
    citron: { name: 'Citron doux', light: true, bg: orbOf(['#d8e64a', '#e8f07f', '#f5f8c2', '#ffffff']), halo: '#fbfde6', glow: '#e8f07f', pc: ['#e8f07f', '#ffffff'] },
    perle: { name: 'Perle', light: true, bg: 'radial-gradient(circle at 36% 30%, #ffffff 0, #f4f1ff 30%, #e7f0f7 60%, #d9e2ef 100%), conic-gradient(from 0deg, rgba(255,200,230,.25), rgba(200,230,255,.25), rgba(220,255,230,.25), rgba(255,200,230,.25))', halo: '#ffffff', glow: 'rgba(255,255,255,.8)', fx: 'shine', eye: '#7a86a8', pc: ['#ffffff', '#f4f1ff', '#e7f0f7'] },
    // matières des pouvoirs (nouvelles, à valider avec les pouvoirs)
    pierre: { name: 'Pierre', bg: 'radial-gradient(circle at 30% 30%, #a3876a 0 4px, transparent 6px), radial-gradient(circle at 70% 64%, #6b5642 0 5px, transparent 7px), radial-gradient(circle at 46% 46%, #b49a7a 0, #8a7058 60%, #5a4634 100%)', halo: '#c3a27a', glow: 'rgba(140,110,80,.6)', pc: ['#c3a27a', '#8a7058', '#5a4634'] },
    sable: { name: 'Sable', bg: 'radial-gradient(1px 1px at 20% 30%, #fff6dc, transparent), radial-gradient(1px 1px at 60% 40%, #a8814a, transparent), radial-gradient(1px 1px at 40% 70%, #fff6dc, transparent), radial-gradient(circle at 50% 44%, #f2d49a 0, #e0b870 55%, #c79a52 100%)', halo: '#f2d49a', glow: '#e0b870', anim: 'a-spinfast', pc: ['#e0b870', '#c79a52', '#f2d49a'] },
    vent: { name: 'Vent', see: true, bg: 'repeating-conic-gradient(from 0deg, rgba(255,255,255,.55) 0 8%, rgba(255,255,255,.05) 8% 16%), radial-gradient(circle, rgba(230,242,255,.5), rgba(207,227,240,.25))', glass: true, halo: '#ffffff', glow: 'rgba(255,255,255,.6)', anim: 'a-spinfast', eyeglow: '0 0 0 1px rgba(0,0,0,.3)', pc: ['#ffffff', '#e8f2ff'] },
    lumiere: { name: 'Lumière', bg: 'radial-gradient(circle at 50% 46%, #ffffff 0, #ffffff 30%, #fff6dc 60%, #ffe6a8 100%)', halo: '#ffffff', glow: 'rgba(255,250,220,.95)', glow2: 'rgba(255,255,255,.95)', anim: 'a-glow', eye: '#ffd36a', fx: 'sparks', pc: ['#ffffff', '#fff6dc', '#ffe9a0'] },
    pixel: { name: 'Pixels', bg: 'conic-gradient(from 0deg at 50% 50%, #5a6fdb 0 25%, #8fa0ff 25% 50%, #3c4660 50% 75%, #56617f 75%)', size: '22% 22%', square: true, halo: '#8fa0ff', glow: '#5a6fdb', anim: 'a-glitch', pc: ['#5a6fdb', '#8fa0ff', '#283044'], sq: true },
    aimant: { name: 'Métal aimanté', bg: 'linear-gradient(90deg, #ff3a3a 0 50%, #3a6aff 50% 100%), linear-gradient(180deg, rgba(255,255,255,.5), transparent 50%)', halo: '#ffd0d0', glow: 'rgba(255,90,90,.6)', fx: 'shine', pc: ['#ff5a5a', '#5a8aff', '#c4cad4'] },
    corbeau: { name: 'Corbeau', bg: 'radial-gradient(circle at 40% 30%, #4a5068 0, #2a2e3d 50%, #11131b 100%)', halo: '#c9d2e6', glow: 'rgba(160,170,200,.45)', fx: 'feathers', eye: '#9fd0ff', eyeglow: '0 0 6px #9fd0ff', pc: ['#2b2f3d', '#c9d2e6', '#11131b'] },
    onde: { name: 'Onde', bg: 'repeating-radial-gradient(circle, #9fd0ff 0 3px, #3d7fd0 3px 6px, #dff0ff 6px 8px)', halo: '#dff0ff', glow: '#9fd0ff', anim: 'a-glow', glow2: 'rgba(160,210,255,.9)', pc: ['#dff0ff', '#9fd0ff'] },
    automne: { name: 'Automne', bg: orbOf(['#c9502a', '#e85d2a', '#ff9a3d', '#f2c14a']), halo: '#ffd59a', glow: '#e85d2a', fx: 'leaves', leaf: '#ff9a3d', pc: ['#ff9a3d', '#e85d2a', '#f2c14a'] },
    poison: { name: 'Poison', bg: 'radial-gradient(circle at 35% 70%, #d6ff8a 0 3px, transparent 6px), radial-gradient(circle at 64% 30%, #d6ff8a 0 2px, transparent 5px), radial-gradient(circle at 50% 46%, #b8ff5a 0, #5fd12a 45%, #2a7a1a 100%)', halo: '#d6ff8a', glow: '#8aff5a', anim: 'a-wobble', pc: ['#b8ff8a', '#8aff5a', '#2a7a1a'] },
    plasma: { name: 'Plasma', bg: 'radial-gradient(circle at 50% 46%, #ffffff 0, #ff9af0 20%, #7a3cff 55%, #1a0a5a 100%)', halo: '#e6b8ff', glow: '#b14cff', glow2: 'rgba(200,90,255,.95)', anim: 'a-glow', fx: 'bolts', pc: ['#ffffff', '#ff9af0', '#7a3cff'] },
    encre: { name: 'Encre', bg: 'radial-gradient(circle at 35% 30%, #3a3f5a 0, #14162a 55%, #05060f 100%)', halo: '#5b3fa8', glow: 'rgba(90,60,170,.6)', anim: 'a-wobble', eye: '#cfd6ff', pc: ['#14162a', '#2a1a4a', '#05060f'] },
    holo: { name: 'Hologramme', see: true, bg: 'repeating-linear-gradient(0deg, rgba(90,240,255,.55) 0 2px, rgba(90,240,255,.12) 2px 5px), radial-gradient(circle, rgba(90,240,255,.2), rgba(90,240,255,.05))', glass: true, halo: '#5af0ff', glow: '#5af0ff', anim: 'a-glitch', eye: '#5af0ff', eyeglow: '0 0 6px #5af0ff', pc: ['#5af0ff', '#bff8ff'], sq: true },
    papier: { name: 'Papier', bg: 'linear-gradient(135deg, #ffffff 0 50%, #e8ecf3 50% 100%), linear-gradient(45deg, rgba(0,0,0,.05) 0 50%, transparent 50%)', halo: '#ffffff', glow: 'rgba(255,255,255,.5)', square: true, eye: '#3c4660', pc: ['#ffffff', '#e8ecf3'], sq: true },
    mercure: { name: 'Métal liquide', bg: 'radial-gradient(circle at 35% 28%, #ffffff 0, #dfe4ec 18%, #8a94a6 48%, #3a4252 80%, #c9d0dc 100%)', halo: '#ffffff', glow: 'rgba(220,228,240,.6)', anim: 'a-wobble', fx: 'shine', pc: ['#dfe4ec', '#8a94a6', '#ffffff'] },
    sakura: { name: 'Fleurs de cerisier', bg: orbOf(['#ff7aa8', '#ff9ac8', '#ffd0e4', '#ffffff']), halo: '#ffe0ee', glow: '#ff9ac8', fx: 'leaves', leaf: '#ffc4dd', pc: ['#ffc4dd', '#ff9ac8', '#ffffff'] },
  };

  // Couleurs vives pour les pouvoirs (demandées : bien lumineuses)
  Object.assign(F, {
    acide: { name: 'Acide', bg: 'radial-gradient(circle at 35% 70%, #f4ffb0 0 3px, transparent 6px), radial-gradient(circle at 64% 30%, #f4ffb0 0 2px, transparent 5px), radial-gradient(circle at 50% 46%, #f0ff6a 0, #9dff00 35%, #39ff14 70%, #1fbf00 100%)', halo: '#d9ff7a', glow: '#7dff2a', glow2: 'rgba(125,255,42,.95)', anim: 'a-glow a-wobble', pc: ['#d9ff7a', '#7dff2a', '#39ff14'] },
    onde: { name: 'Onde de choc', bg: 'repeating-radial-gradient(circle, #ffffff 0 2px, #4fd1ff 2px 6px, #0090ff 6px 9px)', halo: '#bfefff', glow: '#00b4ff', glow2: 'rgba(0,180,255,.95)', anim: 'a-glow', pc: ['#ffffff', '#4fd1ff', '#0090ff'] },
    rouge: { name: 'Rouge laser', bg: 'radial-gradient(circle at 50% 46%, #ffe0e0 0, #ff4d4d 30%, #ff0000 62%, #a00000 100%)', halo: '#ff9a9a', glow: '#ff0000', glow2: 'rgba(255,0,0,.95)', anim: 'a-glow', pc: ['#ff0000', '#ff8080', '#ffffff'] },
    lagon: { name: 'Lagon', bg: 'radial-gradient(circle at 50% 46%, #e6fffc 0, #3fe6d8 35%, #00b3c7 70%, #00708a 100%)', halo: '#a8fff6', glow: '#00d6e0', glow2: 'rgba(0,214,224,.9)', anim: 'a-glow', pc: ['#ffffff', '#3fe6d8', '#00b3c7'] },
  });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function fxOf(f) {
    if (f.fx === 'flames') return '<div class="fx"><i class="flame" style="left:28%;background:radial-gradient(circle at 50% 75%,#fff2a0,#ffb000 35%,#ff2a00 70%,transparent 100%)"></i><i class="flame" style="left:40%;height:50%;bottom:76%;background:radial-gradient(circle at 50% 75%,#fff2a0,#ff8a00 35%,#ff1a00 70%,transparent 100%)"></i><i class="flame" style="left:52%;background:radial-gradient(circle at 50% 75%,#fff2a0,#ffb000 35%,#e00000 70%,transparent 100%)"></i></div>';
    if (f.fx === 'embers') return `<div class="fx">${[20, 46, 70, 34, 60].map((x, i) => `<i class="ember" style="left:${x}%;background:${i % 2 ? '#ffb000' : '#ff4a00'};animation-delay:${i * .45}s"></i>`).join('')}</div>`;
    if (f.fx === 'bolts') return '<div class="fx"><svg class="bolt" viewBox="0 0 100 100" aria-hidden="true"><path d="M8 26 l14 9 -7 6 16 11" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/><path d="M92 60 l-14 -5 5 -9 -16 -9" fill="none" stroke="#fffbd0" stroke-width="2.2" stroke-linejoin="round"/><path d="M50 2 l-4 10 6 2 -5 9" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg></div>';
    if (f.fx === 'shine') return '<div class="fx"><i class="shine"></i></div>';
    if (f.fx === 'sparks') return `<div class="fx" style="--halo:${f.halo}"><span class="spark" style="left:2%;top:6%">✦</span><span class="spark" style="right:4%;top:28%;font-size:9px">✦</span><span class="spark" style="left:12%;bottom:8%;font-size:10px">✧</span></div>`;
    if (f.fx === 'leaves') return `<div class="fx"><i class="leaf" style="left:2%;top:12%;background:${f.leaf};transform:rotate(30deg)"></i><i class="leaf" style="right:0;top:52%;background:${f.leaf};transform:rotate(-20deg)"></i><i class="leaf" style="left:20%;bottom:0;background:${f.leaf};transform:rotate(70deg)"></i></div>`;
    if (f.fx === 'feathers') return '<div class="fx"><i class="feather" style="left:0;top:30%;transform:rotate(-40deg)"></i><i class="feather" style="right:2%;top:24%;transform:rotate(40deg)"></i></div>';
    return '';
  }
  function orbStyle(f) {
    return `background:${f.bg};${f.size ? `background-size:${f.size};` : ''}box-shadow:0 0 22px ${f.glow}${f.glass ? ', inset 0 -8px 18px rgba(255,255,255,.2)' : ''};${f.mask ? '-webkit-mask:radial-gradient(circle,rgba(0,0,0,.18) 52%,#000 74%);mask:radial-gradient(circle,rgba(0,0,0,.18) 52%,#000 74%);' : ''}${f.glass ? 'backdrop-filter:blur(5px) saturate(1.4);-webkit-backdrop-filter:blur(5px) saturate(1.4);border:1.5px solid rgba(255,255,255,.8);' : ''}${f.square ? 'border-radius:22%;' : ''}`;
  }
  function odin(id, cls = '') {
    const f = F[id];
    return `<div class="om ${f.anim || ''} ${cls}" data-form="${id}" style="--halo:${f.halo};--eye:${f.eye || '#fff'};--eyeglow:${f.eyeglow || 'none'};--glow2:${f.glow2 || f.glow}" aria-hidden="true"><i class="halo"></i><div class="orb" style="${orbStyle(f)}"></div>${fxOf(f)}<i class="eye l"></i><i class="eye r"></i></div>`;
  }

  const BASE = 'corail';
  // Pouvoirs où Odin garde sa couleur (corbeaux, foudre, éclair) ou change lui-même au bon moment (onde : en l'air).
  // Déjà décidés (13/11) : gardés → mis dans Odin ; supprimés → retirés. La maquette ne montre que le reste.
  const KEPT = new Set(["feu", "vague", "glace", "blizzard", "rochers", "seisme", "cristaux", "aurore", "gungnir", "lianes", "petales", "feuilles", "poison", "teleport", "pixels", "givre", "bulle_geante", "mercure", "encre", "hologramme", "origami", "plasma", "papillons", "bulles", "comete", "corbeaux", "eclair", "etoiles", "foudre", "ombre", "sable", "trounoir", "artifice", "jet", "lumiere", "magma_coulee", "meteores", "neon_coupe", "orage", "soleil", "spirale"]), DELETED = new Set(["bifrost", "laser", "lave", "rafale", "runes", "tornade", "aimant"]);
  const SHOWN = () => PW.filter((p) => st === 'tous' || (st === 'odin' && (choix[`pv_${p[0]}`] || {}).v === 'garder') || (st === 'sup' && (choix[`pv_${p[0]}`] || {}).v === 'supprimer') || (st === 'redo' && !['garder', 'supprimer'].includes((choix[`pv_${p[0]}`] || {}).v)));
  let st = 'tous';
  const CHANGES = {"bulles": "Refait : plein de petites bulles se collent à la fenêtre, éclatent, et la fenêtre part en petites bulles partout.", "sable": "Refait : vrai vent de sable sur tout l'écran ; le sable ronge la fenêtre de gauche à droite, grain par grain.", "foudre": "Refait : Odin garde sa couleur, la foudre crépite autour de lui puis part de lui ; éclairs mieux dessinés (tronc et branches).", "eclair": "Refait : Odin garde sa couleur, juste des éclairs qui crépitent autour de lui ; l'éclair géant tombe du ciel.", "etoiles": "Refait : de vraies étoiles filantes (étoile + longue traînée fine), puis la fenêtre part en poussière d'étoiles.", "trounoir": "Refait : trou noir réaliste (horizon noir, anneau de lumière, disque de matière) ; la fenêtre est étirée vers lui puis avalée.", "onde": "Refait : Odin saute, change de couleur en l'air, retombe, frappe le sol, l'onde traverse l'écran.", "aimant": "Refait : la fenêtre résiste, est arrachée, vole vers Odin, se tasse en bille de métal qu'il absorbe (plus de désintégration en carrés).", "ombre": "Refait : l'animation reste sur la fenêtre ; des tentacules d'ombre l'envahissent par les bords, puis elle part en fumée noire.", "spirale": "Refait : c'est la fenêtre elle-même qui tourne et devient une galaxie en spirale, puis s'éteint en étoiles.", "corbeaux": "Refait : Odin ne se transforme plus ; les deux corbeaux partent de lui et emportent la fenêtre.", "comete": "Pas encore décidé."};
  const NOFORM = new Set(['corbeaux', 'foudre', 'eclair', 'onde']);

  // ------------------------------------------------------------------ les pouvoirs : forme d'Odin, geste, attaque, destruction
  // [id, nom, forme, famille, ce qui se passe, script]
  const PW = [
    ['feu', 'Boule de feu', 'feu2', 'Feu', 'Odin s\'enflamme, lance une boule de feu ; la fenêtre brûle de bas en haut jusqu\'aux cendres.'],
    ['jet', 'Rayon de feu', 'feu2', 'Feu', 'Un rayon de feu sort de ses yeux ; la fenêtre prend feu et brûle entièrement.'],
    ['lave', 'Lave', 'magma', 'Feu', 'Odin devient magma ; la lave tombe sur la fenêtre et la fait fondre.'],
    ['meteores', 'Météores', 'magma', 'Feu', 'Odin appelle les météores ; ils percent la fenêtre de cratères, puis elle explose.'],
    ['comete', 'Comète', 'feu2', 'Feu', 'Une comète traverse l\'écran, transperce la fenêtre qui explose en flammes.'],
    ['vague', 'Vague', 'lagon', 'Eau', 'La vague monte du bas ; la fenêtre se fissure au contact, puis se brise quand l\'eau la recouvre.'],
    ['bulles', 'Bulles', 'bulle', 'Eau', 'Odin souffle des bulles ; une bulle enferme la fenêtre, monte et éclate.'],
    ['glace', 'Glace', 'glace', 'Glace', 'Odin se congèle et lance des éclats ; la fenêtre gèle, craque et vole en éclats.'],
    ['blizzard', 'Blizzard', 'glace', 'Glace', 'Une tempête de neige recouvre la fenêtre, qui s\'envole en flocons.'],
    ['rochers', 'Rochers', 'pierre', 'Terre', 'Odin devient pierre et lance des rochers ; la fenêtre est écrasée.'],
    ['seisme', 'Séisme', 'pierre', 'Terre', 'Odin frappe le sol ; tout tremble, le sol se fend et la fenêtre s\'effondre.'],
    ['sable', 'Tempête de sable', 'sable', 'Terre', 'Odin tourne en sable ; la fenêtre s\'efface grain par grain.'],
    ['cristaux', 'Cristaux', 'amethyste', 'Terre', 'Des cristaux violets jaillissent sous la fenêtre et la transpercent.'],
    ['tornade', 'Tornade', 'vent', 'Air', 'Une tornade part d\'Odin et aspire la fenêtre en tourbillonnant.'],
    ['rafale', 'Rafale', 'vent', 'Air', 'Un coup de vent emporte la fenêtre qui roule hors de l\'écran.'],
    ['foudre', 'Foudre', 'foudre2', 'Ciel', 'Odin se charge et lance la foudre sur la fenêtre, qui explose.'],
    ['orage', 'Orage', 'foudre2', 'Ciel', 'Un nuage noir se forme au-dessus de la fenêtre et la foudroie.'],
    ['eclair', 'Éclair', 'foudre2', 'Ciel', 'Un éclair géant tombe du ciel sur la fenêtre, éclair blanc, explosion.'],
    ['etoiles', 'Étoiles filantes', 'galaxie', 'Espace', 'Des étoiles filantes frappent la fenêtre, qui s\'éteint en étincelles.'],
    ['trounoir', 'Trou noir', 'galaxie', 'Espace', 'Un trou noir s\'ouvre et avale la fenêtre en spirale.'],
    ['aurore', 'Aurore boréale', 'aurore', 'Espace', 'Des voiles verts et violets descendent et dissolvent la fenêtre.'],
    ['soleil', 'Rayon de soleil', 'lumiere', 'Lumière', 'Un rayon de soleil tombe sur la fenêtre, qui part en lumière.'],
    ['lumiere', 'Lumière sacrée', 'lumiere', 'Lumière', 'Un pilier de lumière blanche efface la fenêtre.'],
    ['runes', 'Runes', 'lumiere', 'Lumière', 'Un cercle de runes entoure la fenêtre, qui s\'envole en poussière lumineuse.'],
    ['gungnir', 'Gungnir, la lance', 'or2', 'Lumière', 'Odin lance sa lance ; la fenêtre explose sous l\'impact.'],
    ['lianes', 'Lianes', 'emeraude', 'Nature', 'Des lianes poussent, serrent la fenêtre et l\'écrasent.'],
    ['petales', 'Pétales', 'sakura', 'Nature', 'La fenêtre s\'envole en pétales roses.'],
    ['feuilles', 'Feuilles d\'automne', 'automne', 'Nature', 'La fenêtre se découpe en feuilles qui tombent en tournoyant.'],
    ['poison', 'Acide', 'acide', 'Nature', 'Odin devient vert acide et crache un jet d\'acide ; la fenêtre fond complètement.'],
    ['laser', 'Laser des yeux', 'rouge', 'Énergie', 'Odin devient rouge vif ; le laser balaie toute la fenêtre, la brûle ligne par ligne, puis elle part en cendres.'],
    ['onde', 'Onde de choc', 'onde', 'Énergie', 'Odin saute et frappe le sol ; une onde part sur tout l\'écran et fait exploser la fenêtre.'],
    ['aimant', 'Aimant', 'aimant', 'Énergie', 'Odin attire la fenêtre vers lui et l\'écrase.'],
    ['teleport', 'Téléportation', 'neon', 'Énergie', 'La fenêtre grésille, se réduit à une ligne puis disparaît ailleurs.'],
    ['ombre', 'Ombre', 'encre', 'Mystère', 'Une ombre d\'encre monte du sol et avale la fenêtre.'],
    ['pixels', 'Pixels', 'pixel', 'Mystère', 'La fenêtre se pixelise et tombe en carrés.'],
    ['corbeaux', 'Huginn et Muninn', 'corbeau', 'Mystère', 'Les deux corbeaux attrapent la fenêtre et l\'emportent.'],
    ['bifrost', 'Bifröst', 'arc2', 'Fête', 'Un arc-en-ciel part d\'Odin ; la fenêtre glisse dessus et disparaît.'],
    ['artifice', 'Feu d\'artifice', 'arc2', 'Fête', 'Des fusées partent d\'Odin, la fenêtre explose en feu d\'artifice.'],
    ['magma_coulee', 'Coulée de magma', 'magma', 'Nouveaux', 'La fenêtre rougit, fond par le haut et coule jusqu\'en bas.'],
    ['givre', 'Givre', 'glace', 'Nouveaux', 'Le givre gagne la fenêtre par les coins, puis elle se brise doucement.'],
    ['bulle_geante', 'Bulle géante', 'bulle', 'Nouveaux', 'Une bulle géante avale la fenêtre et éclate.'],
    ['neon_coupe', 'Découpe néon', 'neon', 'Nouveaux', 'Des traits néon découpent la fenêtre en morceaux qui s\'éteignent.'],
    ['spirale', 'Spirale galactique', 'galaxie', 'Nouveaux', 'La fenêtre tourne en étoiles et part dans la galaxie.'],
    ['mercure', 'Métal liquide', 'mercure', 'Nouveaux', 'Du métal liquide recouvre la fenêtre et s\'écoule avec elle.'],
    ['encre', 'Tache d\'encre', 'encre', 'Nouveaux', 'Une tache d\'encre s\'étale et absorbe la fenêtre.'],
    ['hologramme', 'Hologramme', 'holo', 'Nouveaux', 'La fenêtre devient hologramme, grésille et s\'éteint.'],
    ['origami', 'Origami', 'papier', 'Nouveaux', 'La fenêtre se plie en avion de papier et s\'envole.'],
    ['plasma', 'Plasma', 'plasma', 'Nouveaux', 'Une sphère de plasma avale la fenêtre puis éclate.'],
    ['papillons', 'Papillons', 'sakura', 'Nouveaux', 'La fenêtre se défait en papillons qui s\'envolent.'],
  ];

  // ------------------------------------------------------------------ moteur d'animation du théâtre

  let W = 0, H = 0, DPR = 1;
  const R = (a, b) => a + Math.random() * (b - a), pick = (l) => l[Math.floor(Math.random() * l.length)];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const win = { x: 0, y: 0, w: 0, h: 0, img: null, base: null, mode: 'show', alpha: 1 };
  function renderWin(w, h) {
    const c = document.createElement('canvas'); c.width = Math.round(w * DPR); c.height = Math.round(h * DPR); const g = c.getContext('2d'); g.scale(DPR, DPR);
    const r = 10; g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(0, 0, w, h, r); g.fill();
    g.save(); g.beginPath(); g.roundRect(0, 0, w, h, r); g.clip();
    g.fillStyle = '#2457c5'; g.fillRect(0, 0, w, 24); g.fillStyle = '#fff'; g.font = '600 12px Inter, system-ui, sans-serif'; g.fillText('Fiche client · Odin', 10, 16);
    for (const [i, c2] of ['#ff5f57', '#febc2e', '#28c840'].entries()) { g.fillStyle = c2; g.beginPath(); g.arc(w - 14 - i * 14, 12, 4, 0, 7); g.fill(); }
    const cols = 3, rows = 4, cw = (w - 20) / cols, ch = (h - 44) / rows;
    for (let rr = 0; rr < rows; rr++) for (let cc = 0; cc < cols; cc++) {
      const x = 10 + cc * cw, y = 34 + rr * ch; g.fillStyle = rr === 0 ? '#e6edfb' : '#f6f8fc'; g.fillRect(x + 1, y + 1, cw - 2, ch - 2);
      g.fillStyle = rr === 0 ? '#2457c5' : '#94a3b8'; g.fillRect(x + 7, y + ch / 2 - 2.5, (cw - 16) * (0.45 + ((rr * 3 + cc) % 4) * 0.13), 5);
    }
    g.restore(); g.strokeStyle = 'rgba(0,0,0,.15)'; g.beginPath(); g.roundRect(.5, .5, w - 1, h - 1, r); g.stroke();
    return c;
  }
  function copyCanvas(src) { const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.getContext('2d').drawImage(src, 0, 0); return c; }
  const ground = () => Math.min(H - 14, Math.max(win.y + win.h + 40, heroC().y + heroC().r + 4));
  function heroC() { const a = hero.getBoundingClientRect(), b = { left: 0, top: 0 }; return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2, r: a.width / 2 }; }
  const eyes = () => { const c = heroC(); return { x: c.x + c.r * 0.25, y: c.y - c.r * 0.12 }; };
  const winC = () => ({ x: win.x + win.w / 2, y: win.y + win.h / 2 });

  // calques, particules, secousse, éclair blanc
  const layers = new Set(); let parts = []; let shakeT = 0, shakeA = 0, flashA = 0, flashC = '#ffffff';
  function layer(fn) { layers.add(fn); return () => layers.delete(fn); }
  function anim(ms, fn) { return new Promise((res) => { let t = 0; layer((g, dt) => { t += dt; const k = Math.min(1, t / ms); fn(g, k, dt); if (k >= 1) { res(); return false; } return true; }); }); }
  function shake(a, ms) { shakeA = Math.max(shakeA, a); shakeT = Math.max(shakeT, ms); }
  function flash(a = 0.8, c = '#ffffff') { flashA = a; flashC = c; }
  function emit(n, f) { if (parts.length > 2200) return; for (let i = 0; i < n; i++) parts.push(Object.assign({ x: 0, y: 0, vx: 0, vy: 0, ay: 0, drag: 0.99, life: 1, max: 1, s: 3, c: '#fff', glow: false, shape: 'dot', rot: 0, vr: 0, grow: 0 }, f(i))); }
  function drawWinImg(g, alpha = 1) { g.globalAlpha = alpha * win.alpha; g.drawImage(win.img, win.x, win.y, win.w, win.h); g.globalAlpha = 1; }
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(50, now - last); last = now;
    cx.setTransform(DPR, 0, 0, DPR, 0, 0); cx.clearRect(0, 0, W, H);
    if (shakeT > 0) { shakeT -= dt; cx.translate(R(-shakeA, shakeA), R(-shakeA, shakeA)); hero.style.translate = `${R(-shakeA, shakeA) / 2}px ${R(-shakeA, shakeA) / 2}px`; } else hero.style.translate = '';
    if (win.mode === 'show') drawWinImg(cx);
    for (const l of [...layers]) { cx.save(); const keep = l(cx, dt); cx.restore(); if (keep === false) layers.delete(l); }
    // particules
    const s = dt / 16.7;
    parts = parts.filter((p) => (p.life -= dt / 1000) > 0);
    for (const p of parts) {
      p.vx *= p.drag ** s; p.vy = p.vy * p.drag ** s + p.ay * s; p.x += p.vx * s; p.y += p.vy * s; p.rot += p.vr * s; p.s += p.grow * s;
      const a = Math.max(0, Math.min(1, p.life / p.max * (p.fadeIn ? Math.min(1, (p.max - p.life) / 0.15) : 1)));
      cx.globalAlpha = a; cx.globalCompositeOperation = p.glow ? 'lighter' : 'source-over'; cx.fillStyle = p.c; cx.strokeStyle = p.c;
      if (p.shape === 'dot') { cx.beginPath(); cx.arc(p.x, p.y, Math.max(0.3, p.s), 0, 7); cx.fill(); }
      else if (p.shape === 'sq') cx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
      else if (p.shape === 'line') { cx.lineWidth = p.w || 2; cx.beginPath(); cx.moveTo(p.x, p.y); cx.lineTo(p.x - p.vx * (p.len || 3), p.y - p.vy * (p.len || 3)); cx.stroke(); }
      else if (p.shape === 'smoke') { cx.globalAlpha = a * 0.35; cx.beginPath(); cx.arc(p.x, p.y, p.s, 0, 7); cx.fill(); }
      else if (p.shape === 'petal' || p.shape === 'leaf' || p.shape === 'shard' || p.shape === 'fly') {
        cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot); cx.beginPath();
        if (p.shape === 'petal') cx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, 7);
        else if (p.shape === 'leaf') { cx.moveTo(-p.s, 0); cx.quadraticCurveTo(0, -p.s * 0.8, p.s, 0); cx.quadraticCurveTo(0, p.s * 0.8, -p.s, 0); }
        else if (p.shape === 'fly') { const f = Math.abs(Math.sin(performance.now() / 60 + p.x)) * 0.7 + 0.3; cx.ellipse(-p.s * 0.6, 0, p.s * f, p.s * 0.7, -0.4, 0, 7); cx.ellipse(p.s * 0.6, 0, p.s * f, p.s * 0.7, 0.4, 0, 7); }
        else { cx.moveTo(0, -p.s); cx.lineTo(p.s * 0.6, p.s * 0.5); cx.lineTo(-p.s * 0.5, p.s * 0.7); cx.closePath(); }
        cx.fill(); cx.restore();
      } else if (p.shape === 'text') { cx.font = `${p.s}px serif`; cx.fillText(p.t, p.x, p.y); }
    }
    cx.globalAlpha = 1; cx.globalCompositeOperation = 'source-over';
    if (flashA > 0.01) { cx.setTransform(DPR, 0, 0, DPR, 0, 0); cx.fillStyle = flashC; cx.globalAlpha = flashA; cx.fillRect(0, 0, W, H); cx.globalAlpha = 1; flashA *= 0.86 ** (dt / 16.7); }
    if (busy || layers.size || parts.length || flashA > 0.01 || shakeT > 0) requestAnimationFrame(frame); else { running = false; cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, cv.width, cv.height); }
  }

  // ------------------------------------------------------------------ Odin : forme et gestes
  let heroForm = BASE;
  function setHero(id, extra = '') { hero.innerHTML = odin(id, extra); heroForm = id; const o = hero.firstElementChild; o.style.setProperty('--size', `${heroSize}px`); }
  async function gesture(cls, ms) { const o = hero.firstElementChild; o.classList.remove(cls); void o.offsetWidth; o.classList.add(cls); await wait(ms); o.classList.remove(cls); }
  async function transform(id) { // un éclair de la couleur du pouvoir, puis la nouvelle forme
    const c = heroC(), col = (F[id].pc || ['#fff'])[0];
    emit(40, () => { const a = R(0, 7), v = R(2, 6); return { x: c.x, y: c.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6, max: 0.6, s: R(1.5, 3.5), c: pick(F[id].pc || ['#fff']), glow: true, drag: 0.92 }; });
    flash(0.25, col); setHero(id, 'pop'); await wait(380); hero.firstElementChild?.classList.remove('pop');
  }
  async function revert() { const c = heroC(); emit(24, () => { const a = R(0, 7), v = R(1, 4); return { x: c.x, y: c.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5, max: 0.5, s: 2, c: '#ffffff', glow: true, drag: 0.9 }; }); setHero(BASE, 'pop'); await wait(300); hero.firstElementChild?.classList.remove('pop'); }

  // ------------------------------------------------------------------ attaques
  function glowLine(g, pts, color, core, width) {
    g.globalCompositeOperation = 'lighter'; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const [w, a, c] of [[width * 4, 0.12, color], [width * 2, 0.3, color], [width, 0.9, color], [width * 0.4, 1, core]]) { g.globalAlpha = a; g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(pts[0].x, pts[0].y); for (const p of pts.slice(1)) g.lineTo(p.x, p.y); g.stroke(); }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  function jagged(a, b, rough = 0.22, depth = 6) { let pts = [a, b]; for (let d = 0; d < depth; d++) { const n = [pts[0]]; for (let i = 1; i < pts.length; i++) { const p = pts[i - 1], q = pts[i], len = Math.hypot(q.x - p.x, q.y - p.y); n.push({ x: (p.x + q.x) / 2 + R(-1, 1) * len * rough, y: (p.y + q.y) / 2 + R(-1, 1) * len * rough }, q); } pts = n; } return pts; }
  function orb(g, x, y, r, cols) { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, cols[0]); gr.addColorStop(0.45, cols[1]); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.globalCompositeOperation = 'source-over'; }
  /** Un projectile qui vole de a à b (arc), avec sa traînée ; résout à l'impact. */
  async function projectile(a, b, o = {}) {
    const { ms = 520, arc = 0.18, r = 14, cols = ['#fff6a0', '#ff6a00'], trail = cols, draw, spin = 0 } = o;
    await anim(ms, (g, k) => {
      const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k - Math.sin(k * Math.PI) * arc * Math.hypot(b.x - a.x, b.y - a.y);
      if (draw) draw(g, x, y, k); else orb(g, x, y, r * 2.2, cols);
      emit(3, () => ({ x: x + R(-r / 2, r / 2), y: y + R(-r / 2, r / 2), vx: R(-1, 1) - (b.x - a.x) / 300, vy: R(-1, 1), life: 0.45, max: 0.45, s: R(r * 0.2, r * 0.5), c: pick(trail), glow: true, drag: 0.94, grow: -0.05 }));
      if (spin) emit(1, () => ({ x, y, vx: R(-0.5, 0.5), vy: R(-1, 0), life: 0.8, max: 0.8, s: 6, c: 'rgba(120,120,120,.6)', shape: 'smoke', grow: 0.3 }));
    });
  }
  function burst(x, y, n, cols, o = {}) { emit(n, () => { const a = R(0, 7), v = R(o.min ?? 2, o.max ?? 9); return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (o.up ?? 1), ay: o.g ?? 0.12, life: R(0.5, o.life ?? 1.1), max: o.life ?? 1.1, s: R(1.5, o.s ?? 4), c: pick(cols), glow: o.glow ?? true, drag: 0.95, shape: o.shape ?? 'dot' }; }); }
  function smoke(x, y, n, c = 'rgba(70,70,80,1)') { emit(n, () => ({ x: x + R(-20, 20), y: y + R(-10, 10), vx: R(-0.6, 0.6), vy: R(-1.4, -0.4), life: R(1, 2), max: 2, s: R(6, 14), c, shape: 'smoke', grow: 0.25, drag: 0.98 })); }

  // ------------------------------------------------------------------ destructions de la fenêtre (jusqu'au bout)
  const noise = (x, t) => Math.sin(x * 0.09 + t * 3) * 0.6 + Math.sin(x * 0.23 - t * 2) * 0.4;
  /** Brûle : un front de flammes monte, la fenêtre devient cendres. */
  async function burn(o = {}) {
    const { ms = 1500, edge = '#ffcf40', glow = '#ff3a00', ember = ['#ffd000', '#ff7a00', '#ff3a00'] } = o; win.mode = 'custom'; let t = 0;
    await anim(ms, (g, k, dt) => {
      t += dt / 1000; const front = win.y + win.h * (1.05 - k * 1.15);
      const path = new Path2D(); path.moveTo(win.x, win.y - 2); path.lineTo(win.x + win.w, win.y - 2);
      for (let x = win.w; x >= 0; x -= 5) path.lineTo(win.x + x, front + noise(x, t) * 9); path.closePath();
      g.save(); g.clip(path); drawWinImg(g); // la partie pas encore brûlée, roussie près du front
      const gr = g.createLinearGradient(0, front - 26, 0, front); gr.addColorStop(0, 'rgba(60,20,0,0)'); gr.addColorStop(1, 'rgba(60,20,0,.85)'); g.fillStyle = gr; g.fillRect(win.x, front - 26, win.w, 30); g.restore();
      g.globalCompositeOperation = 'lighter'; g.strokeStyle = edge; g.shadowColor = glow; g.shadowBlur = 14; g.lineWidth = 3; g.beginPath();
      for (let x = 0; x <= win.w; x += 5) { const y = front + noise(x, t) * 9; x ? g.lineTo(win.x + x, y) : g.moveTo(win.x, y); } g.stroke(); g.shadowBlur = 0; g.globalCompositeOperation = 'source-over';
      if (front > win.y - 10) {
        emit(5, () => ({ x: win.x + R(0, win.w), y: front + R(-4, 4), vx: R(-0.4, 0.4), vy: R(-2.6, -0.8), life: R(0.4, 0.9), max: 0.9, s: R(3, 7), c: pick(ember), glow: true, drag: 0.97, grow: -0.08 }));
        emit(1, () => ({ x: win.x + R(0, win.w), y: front, vx: R(-0.4, 0.4), vy: R(-1.2, -0.5), life: 1.6, max: 1.6, s: 8, c: 'rgba(60,60,70,1)', shape: 'smoke', grow: 0.25 }));
      }
    });
    win.mode = 'gone';
  }
  /** Fond : la fenêtre se teinte de la couleur, coule en colonnes et disparaît dans une flaque. */
  async function melt(o = {}) {
    const { ms = 1900, tint = '#7dff2a', drip = ['#d9ff7a', '#7dff2a', '#39ff14'], top = false } = o; win.mode = 'custom';
    const n = 46, cw = win.w / n, sp = Array.from({ length: n }, () => R(0.6, 1.4)), off = new Array(n).fill(0);
    const tinted = copyCanvas(win.img), tg = tinted.getContext('2d'); tg.globalCompositeOperation = 'source-atop'; tg.fillStyle = tint; tg.globalAlpha = 0.75; tg.fillRect(0, 0, tinted.width, tinted.height);
    await anim(ms, (g, k, dt) => {
      for (let i = 0; i < n; i++) {
        off[i] += sp[i] * (top ? 1.4 : 1) * k * k * dt * 0.12;
        const sx = (i / n) * win.img.width, sw = win.img.width / n, stretch = 1 + off[i] / win.h * 0.6;
        g.globalAlpha = Math.max(0, 1 - k * k * 1.05); g.drawImage(win.img, sx, 0, sw, win.img.height, win.x + i * cw, win.y + off[i], cw + 0.6, win.h * stretch);
        g.globalAlpha = Math.max(0, Math.min(1, k * 2.2) * (1 - k * k)); g.drawImage(tinted, sx, 0, sw, tinted.height, win.x + i * cw, win.y + off[i], cw + 0.6, win.h * stretch);
      }
      g.globalAlpha = 1;
      // flaque
      g.globalAlpha = Math.min(0.85, k * 1.4) * (k > 0.85 ? (1 - k) / 0.15 : 1); g.fillStyle = tint; g.beginPath(); g.ellipse(win.x + win.w / 2, ground() - 4, win.w * (0.3 + k * 0.5), 6 + k * 6, 0, 0, 7); g.fill(); g.globalAlpha = 1;
      emit(2, () => ({ x: win.x + R(0, win.w), y: win.y + win.h * R(0.7, 1) + off[Math.floor(R(0, n))] * 0.6, vx: 0, vy: R(0.5, 2), ay: 0.25, life: 0.9, max: 0.9, s: R(2, 4.5), c: pick(drip), glow: true }));
      if (Math.random() < 0.3) emit(1, () => ({ x: win.x + R(0, win.w), y: win.y + R(0, win.h), vx: 0, vy: -0.3, life: 0.5, max: 0.5, s: R(2, 5), c: 'rgba(255,255,255,.9)', grow: 0.15 }));
    });
    win.mode = 'gone';
  }
  /** Morceaux : la fenêtre se brise en triangles qui volent (radial = explosion, sinon chute). */
  function fragments(cols = 6, rows = 4) {
    const pts = []; for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) pts.push({ x: (c / cols) * win.w + (c && c < cols ? R(-1, 1) * win.w / cols * 0.3 : 0), y: (r / rows) * win.h + (r && r < rows ? R(-1, 1) * win.h / rows * 0.3 : 0) });
    const P = (c, r) => pts[r * (cols + 1) + c], fr = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const a = P(c, r), b = P(c + 1, r), d = P(c, r + 1), e = P(c + 1, r + 1); fr.push([a, b, e], [a, e, d]); }
    return fr.map((tri) => { const cxx = (tri[0].x + tri[1].x + tri[2].x) / 3, cyy = (tri[0].y + tri[1].y + tri[2].y) / 3; return { tri: tri.map((p) => ({ x: p.x - cxx, y: p.y - cyy })), x: win.x + cxx, y: win.y + cyy, ox: cxx, oy: cyy, vx: 0, vy: 0, rot: 0, vr: 0 }; });
  }
  async function shatter(o = {}) {
    const { ms = 1400, from = winC(), power = 8, gravity = 0.32, tint = null, cols = 7, rows = 5, lift = 0, sparks = null } = o; win.mode = 'custom';
    const fr = fragments(cols, rows);
    for (const f of fr) { const a = Math.atan2(f.y - from.y, f.x - from.x), v = R(0.5, 1) * power; f.vx = Math.cos(a) * v + R(-1, 1); f.vy = Math.sin(a) * v - R(1, 3) - lift; f.vr = R(-0.2, 0.2); }
    if (sparks) burst(from.x, from.y, 60, sparks, { max: 12 });
    await anim(ms, (g, k, dt) => {
      const s = dt / 16.7;
      for (const f of fr) {
        f.vy += gravity * s; f.x += f.vx * s; f.y += f.vy * s; f.rot += f.vr * s;
        g.save(); g.globalAlpha = Math.max(0, 1 - k * k); g.translate(f.x, f.y); g.rotate(f.rot); g.beginPath(); g.moveTo(f.tri[0].x, f.tri[0].y); g.lineTo(f.tri[1].x, f.tri[1].y); g.lineTo(f.tri[2].x, f.tri[2].y); g.closePath(); g.clip();
        g.drawImage(win.img, -f.ox, -f.oy, win.w, win.h); if (tint) { g.fillStyle = tint; g.globalAlpha *= 0.55; g.fillRect(-win.w, -win.h, win.w * 2, win.h * 2); } g.restore();
      }
    });
    win.mode = 'gone';
  }
  /** Fissures dessinées sur la fenêtre (à partir d'un point). */
  function crack(px, py, n = 7, color = 'rgba(30,40,60,.85)') {
    const g = win.img.getContext('2d'); g.save(); g.scale(DPR, DPR); g.strokeStyle = color; g.lineWidth = 1.6;
    for (let i = 0; i < n; i++) { let x = px - win.x, y = py - win.y, a = R(0, 7); g.beginPath(); g.moveTo(x, y); for (let j = 0; j < 6; j++) { a += R(-0.6, 0.6); x += Math.cos(a) * R(10, 24); y += Math.sin(a) * R(10, 24); g.lineTo(x, y); } g.stroke(); }
    g.restore();
  }
  /** Gèle : la fenêtre devient bleue, se couvre de givre et de fissures. */
  async function freeze(o = {}) {
    const { ms = 900, from = winC() } = o; const g2 = win.img.getContext('2d');
    await anim(ms, (g, k) => { g2.save(); g2.globalCompositeOperation = 'source-atop'; g2.fillStyle = `rgba(170,225,255,${0.05})`; g2.fillRect(0, 0, win.img.width, win.img.height); g2.restore(); if (Math.random() < 0.25) crack(from.x + R(-30, 30), from.y + R(-20, 20), 2, 'rgba(255,255,255,.9)'); emit(2, () => ({ x: win.x + R(0, win.w), y: win.y + R(0, win.h), vx: 0, vy: 0, life: 0.6, max: 0.6, s: R(1, 2.5), c: '#ffffff', glow: true })); });
  }
  /** Se dissout en particules (la couleur de la fenêtre, puis celle du pouvoir), dans une direction. */
  async function dissolve(o = {}) {
    const { ms = 1500, cols = null, dir = { x: 0, y: -1.6 }, sweep = 'x', shape = 'dot', glow = true, size = [1.6, 3.2], spread = 1 } = o; win.mode = 'custom';
    const img = pixels(win.img), step = 6, pts = [];
    for (let y = 0; y < win.h; y += step) for (let x = 0; x < win.w; x += step) { const i = (Math.floor(y * DPR) * win.img.width + Math.floor(x * DPR)) * 4; if (img[i + 3] < 20) continue; pts.push({ x, y, c: cols && Math.random() < 0.7 ? pick(cols) : `rgb(${img[i]},${img[i + 1]},${img[i + 2]})`, done: false }); }
    await anim(ms, (g, k) => {
      const lim = k * 1.15;
      g.save(); g.beginPath(); if (sweep === 'x') g.rect(win.x + win.w * Math.min(1, lim), win.y, win.w, win.h); else g.rect(win.x, win.y - 1, win.w, win.h * (1 - Math.min(1, lim)) + 1); g.clip(); drawWinImg(g); g.restore();
      for (const p of pts) { if (p.done) continue; const pos = sweep === 'x' ? p.x / win.w : 1 - p.y / win.h; if (pos <= lim) { p.done = true; emit(1, () => ({ x: win.x + p.x, y: win.y + p.y, vx: dir.x * R(0.5, 1.5) + R(-0.6, 0.6) * spread, vy: dir.y * R(0.5, 1.5) + R(-0.6, 0.6) * spread, life: R(0.7, 1.4), max: 1.4, s: R(size[0], size[1]), c: p.c, glow, shape, rot: R(0, 7), vr: R(-0.2, 0.2), drag: 0.985 })); } }
    });
    win.mode = 'gone';
  }
  /** Aspirée en tourbillon vers un point. */
  async function vortex(o = {}) {
    const { ms = 1300, at = winC(), cols = ['#c8a8ff', '#ffffff'], turns = 3 } = o; win.mode = 'custom';
    await anim(ms, (g, k) => {
      const e = k * k, s = 1 - e; g.save(); g.translate(at.x + (winC().x - at.x) * s, at.y + (winC().y - at.y) * s); g.rotate(e * turns * 6.28); g.scale(s, s); g.globalAlpha = 1 - e * 0.5; g.drawImage(win.img, -win.w / 2, -win.h / 2, win.w, win.h); g.restore();
      emit(3, () => { const a = R(0, 7), d = R(40, 120) * (1 - k * 0.6); return { x: at.x + Math.cos(a) * d, y: at.y + Math.sin(a) * d, vx: -Math.sin(a) * 3 - Math.cos(a) * 1.4, vy: Math.cos(a) * 3 - Math.sin(a) * 1.4, life: 0.5, max: 0.5, s: R(1, 2.5), c: pick(cols), glow: true }; });
    });
    win.mode = 'gone';
  }
  /** Écrasée : tassée vers le bas, poussière et débris. */
  async function crush(o = {}) {
    const { ms = 900, debris = ['#8a7058', '#c3a27a', '#5a4634'] } = o; win.mode = 'custom';
    await anim(ms, (g, k) => { const e = k * k, h = win.h * (1 - e * 0.95); g.globalAlpha = 1 - e * 0.4; g.drawImage(win.img, win.x + R(-2, 2) * (1 - k), win.y + win.h - h, win.w, h); g.globalAlpha = 1; if (k > 0.3) emit(4, () => ({ x: win.x + R(0, win.w), y: win.y + win.h, vx: R(-3, 3), vy: R(-4, -1), ay: 0.3, life: 0.9, max: 0.9, s: R(2, 5), c: pick(debris), shape: 'sq' })); });
    smoke(win.x + win.w / 2, win.y + win.h, 20, 'rgba(150,130,110,1)'); win.mode = 'gone';
  }
  /** Emportée le long d'un chemin (vent, corbeaux, arc-en-ciel). */
  async function carry(path, o = {}) {
    const { ms = 1200, spin = 0, shrink = 0.7 } = o; win.mode = 'custom';
    await anim(ms, (g, k) => { const p = path(k), s = 1 - k * shrink; g.save(); g.translate(p.x, p.y); g.rotate(spin * k); g.scale(s, s); g.globalAlpha = 1 - Math.max(0, k - 0.8) * 5; g.drawImage(win.img, -win.w / 2, -win.h / 2, win.w, win.h); g.restore(); });
    win.mode = 'gone';
  }
  /** Pixels : la fenêtre se pixelise puis tombe en carrés. */
  async function pixelate(o = {}) {
    const { ms = 1500, cols = null } = o; win.mode = 'custom'; const small = document.createElement('canvas'), sg = small.getContext('2d');
    await anim(ms * 0.45, (g, k) => { const bs = 2 + k * 14; small.width = Math.max(2, Math.round(win.w / bs)); small.height = Math.max(2, Math.round(win.h / bs)); sg.drawImage(win.img, 0, 0, small.width, small.height); g.imageSmoothingEnabled = false; g.drawImage(small, win.x, win.y, win.w, win.h); g.imageSmoothingEnabled = true; });
    const d = (() => { try { return sg.getImageData(0, 0, small.width, small.height).data; } catch { const k = document.createElement('canvas'); k.width = small.width; k.height = small.height; const kg = k.getContext('2d'); kg.drawImage(win.alt, 0, 0, k.width, k.height); return kg.getImageData(0, 0, k.width, k.height).data; } })(), bw = win.w / small.width, bh = win.h / small.height;
    for (let y = 0; y < small.height; y++) for (let x = 0; x < small.width; x++) { const i = (y * small.width + x) * 4; if (d[i + 3] < 20) continue; const c = cols && Math.random() < 0.4 ? pick(cols) : `rgb(${d[i]},${d[i + 1]},${d[i + 2]})`; emit(1, () => ({ x: win.x + x * bw + bw / 2, y: win.y + y * bh + bh / 2, vx: R(-1, 1), vy: R(-2, 0), ay: 0.35, life: R(0.8, 1.4) + (small.height - y) * 0.03, max: 1.6, s: Math.max(bw, bh) - 1, c, shape: 'sq' })); }
    win.mode = 'gone'; await wait(ms * 0.55);
  }
  /** Téléportation : glitch en tranches, ligne, point. */
  async function teleportOut(o = {}) {
    const { ms = 1100, cols = ['#3af0ff', '#ff3ad6'] } = o; win.mode = 'custom';
    await anim(ms, (g, k) => {
      if (k < 0.55) { const strips = 12, sh = win.h / strips; for (let i = 0; i < strips; i++) { const dx = R(-1, 1) * 22 * k * 2; g.drawImage(win.img, 0, (i * sh) * DPR, win.img.width, sh * DPR, win.x + dx, win.y + i * sh, win.w, sh); } g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.35; g.fillStyle = pick(cols); g.fillRect(win.x + R(-6, 6), win.y, win.w, win.h); }
      else { const q = (k - 0.55) / 0.45, h = Math.max(1, win.h * (1 - q * 3)), w = q > 0.33 ? win.w * (1 - (q - 0.33) * 1.5) : win.w; g.globalCompositeOperation = 'lighter'; g.fillStyle = cols[0]; g.shadowColor = cols[0]; g.shadowBlur = 18; g.fillRect(winC().x - w / 2, winC().y - h / 2, w, h); }
    });
    burst(winC().x, winC().y, 50, cols, { max: 6 }); win.mode = 'gone';
  }


  /** Un éclair bien dessiné : un tronc et des branches. */
  function bolt(a, b, o = {}) { const main = jagged(a, b, o.rough ?? 0.18, 6), br = []; for (let i = 0; i < (o.branches ?? 4); i++) { const p = main[Math.floor(R(0.2, 0.8) * main.length)], ang = Math.atan2(b.y - a.y, b.x - a.x) + R(-0.9, 0.9), len = Math.hypot(b.x - a.x, b.y - a.y) * R(0.12, 0.3); br.push(jagged(p, { x: p.x + Math.cos(ang) * len, y: p.y + Math.sin(ang) * len }, 0.25, 4)); } return { main, br }; }
  function drawBolt(g, bl, col = '#8fb4ff', w = 4) { glowLine(g, bl.main, col, '#ffffff', w); for (const p of bl.br) glowLine(g, p, col, '#ffffff', w * 0.45); }
  /** De petits arcs électriques autour d'Odin (il garde sa couleur). */
  function crackle(st) { return layer((g) => { const c = heroC(); for (let n = 0; n < 2; n++) if (Math.random() < 0.55) { const a1 = R(0, 6.28), a2 = a1 + R(0.5, 1.4), r = c.r * R(0.95, 1.3); drawBolt(g, { main: jagged({ x: c.x + Math.cos(a1) * r, y: c.y + Math.sin(a1) * r }, { x: c.x + Math.cos(a2) * r * 1.1, y: c.y + Math.sin(a2) * r * 1.1 }, 0.35, 3), br: [] }, '#8fb4ff', 2); } return st.on; }); }
  function starPath(g, x, y, r, rot = 0) { g.beginPath(); for (let i = 0; i < 10; i++) { const rr = i % 2 ? r * 0.45 : r, a = rot + i * Math.PI / 5 - Math.PI / 2; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); }

  // ------------------------------------------------------------------ les scénarios
  const caption = () => {};
  const S = {
    async feu() { await gesture('g-recoil', 250); const a = eyes(); await projectile(a, winC(), { r: 18, cols: ['#fff6a0', '#ff6a00'], trail: ['#ffd000', '#ff3a00', '#ff7a00'], spin: 1 }); flash(0.3, '#ff7a00'); burst(winC().x, winC().y, 70, ['#ffd000', '#ff7a00', '#ff1a00']); await burn(); },
    async jet() { const tgt = { x: win.x + win.w * 0.4, y: win.y + win.h * 0.6 }; caption('le rayon de feu frappe');
      await anim(900, (g, k) => { const e = eyes(), t = { x: tgt.x + Math.sin(k * 12) * 10, y: tgt.y }; glowLine(g, [e, t], '#ff6a00', '#fff3b0', 9); emit(4, () => ({ x: t.x, y: t.y, vx: R(-3, 3), vy: R(-4, 0), ay: 0.15, life: 0.5, max: 0.5, s: R(2, 4), c: pick(['#ffd000', '#ff6a00']), glow: true })); });
      await burn({ ms: 1300 }); },
    async lave() { await gesture('g-charge', 400); caption('la lave tombe');
      await anim(800, (g, k) => { const x = winC().x, w = 26; g.globalCompositeOperation = 'lighter'; const gr = g.createLinearGradient(x - w, 0, x + w, 0); gr.addColorStop(0, 'rgba(255,60,0,0)'); gr.addColorStop(0.5, '#ffb000'); gr.addColorStop(1, 'rgba(255,60,0,0)'); g.fillStyle = gr; g.fillRect(x - w, 0, w * 2, win.y + win.h * k); emit(3, () => ({ x: x + R(-w, w), y: R(0, win.y), vx: 0, vy: 3, life: 0.4, max: 0.4, s: R(2, 5), c: pick(['#ffb000', '#ff4a00']), glow: true })); });
      await melt({ tint: '#ff5a00', drip: ['#ffb000', '#ff4a00', '#ff7a1a'], top: true }); },
    async meteores() { await gesture('g-jump', 400); caption('les météores tombent');
      for (let i = 0; i < 4; i++) { const tx = win.x + R(0.15, 0.85) * win.w, ty = win.y + R(0.2, 0.8) * win.h; await projectile({ x: tx + R(80, 200), y: -40 }, { x: tx, y: ty }, { ms: 380, arc: 0, r: 13, cols: ['#ffe0a0', '#ff5a00'], trail: ['#ff7a00', '#ff3a00', '#ffb000'], spin: 1 }); flash(0.18, '#ff5a00'); shake(6, 180); burst(tx, ty, 30, ['#ffd000', '#ff5a00', '#5a2a10']); const g = win.img.getContext('2d'); g.save(); g.scale(DPR, DPR); const gr = g.createRadialGradient(tx - win.x, ty - win.y, 2, tx - win.x, ty - win.y, 22); gr.addColorStop(0, '#1a0805'); gr.addColorStop(0.6, '#5a1a05'); gr.addColorStop(0.8, '#ff5a00'); gr.addColorStop(1, 'rgba(255,90,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(tx - win.x, ty - win.y, 22, 0, 7); g.fill(); g.restore(); }
      shake(10, 300); flash(0.4, '#ff7a00'); await shatter({ power: 11, sparks: ['#ffd000', '#ff5a00'], tint: 'rgba(255,90,0,.6)' }); },
    async comete() { await gesture('g-recoil', 250); const a = heroC(); caption('la comète traverse');
      await projectile(a, { x: W + 120, y: winC().y - 10 }, { ms: 750, arc: 0.05, r: 22, cols: ['#ffffff', '#ff9a2a'], trail: ['#fff3c0', '#ffd36a', '#ff7a1a', '#ff3a00'], draw: (g, x, y, k) => { orb(g, x, y, 50, ['#ffffff', '#ff9a2a']); if (x > win.x && win.mode === 'show') { flash(0.35, '#ffb000'); shake(8, 250); win.hit = true; } } });
      await shatter({ from: { x: win.x, y: winC().y }, power: 12, sparks: ['#ffd36a', '#ff7a1a'], tint: 'rgba(255,120,30,.5)' }); },
    async vague() { caption('la vague monte du bas'); let level = H + 20; let cracked = false;
      const water = (g, lvl, t) => { g.globalAlpha = 0.88; const gr = g.createLinearGradient(0, lvl, 0, H); gr.addColorStop(0, '#5fe6ff'); gr.addColorStop(1, '#0060a8'); g.fillStyle = gr; g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W; x += 10) g.lineTo(x, lvl + Math.sin(x * 0.03 + t * 5) * 10 + Math.sin(x * 0.07 - t * 3) * 5); g.lineTo(W, H); g.closePath(); g.fill(); g.globalAlpha = 1; g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.beginPath(); for (let x = 0; x <= W; x += 10) { const y = lvl + Math.sin(x * 0.03 + t * 5) * 10 + Math.sin(x * 0.07 - t * 3) * 5; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); };
      let t = 0; let done = false;
      const stop = layer((g, dt) => { t += dt / 1000; water(g, level, t); emit(2, () => ({ x: R(0, W), y: level, vx: R(-1, 1), vy: R(-3, -1), ay: 0.15, life: 0.5, max: 0.5, s: R(1.5, 3), c: '#ffffff' })); return !done; });
      await anim(1000, (g, k) => { level = H + 20 - (H + 20 - (win.y + win.h)) * k; });
      crack(win.x + win.w * 0.5, win.y + win.h - 4, 9, 'rgba(255,255,255,.95)'); shake(4, 200); cracked = true; caption('elle touche : la fenêtre se fissure');
      await anim(700, (g, k) => { level = win.y + win.h - (win.h + 40) * k; });
      caption('elle la recouvre : la fenêtre se brise'); shake(6, 250);
      await shatter({ from: { x: winC().x, y: win.y + win.h + 30 }, power: 7, gravity: -0.06, lift: 2, tint: 'rgba(80,200,255,.45)', ms: 1100 });
      await anim(900, (g, k) => { level = win.y - 40 + (H + 60 - win.y) * k; }); done = true; stop(); },
    async bulles() { await gesture('g-charge', 300); caption('Odin souffle plein de petites bulles');
      const bub = (g, x, y, r) => { g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.3; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); const gr = g.createRadialGradient(x - r * 0.4, y - r * 0.4, 0.5, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.75)'); gr.addColorStop(0.55, 'rgba(160,220,255,.1)'); gr.addColorStop(1, 'rgba(255,150,220,.4)'); g.fillStyle = gr; g.fill(); };
      const stuck = [], fly = [];
      for (let i = 0; i < 30; i++) { const a = eyes(), b = { x: win.x + R(0.04, 0.96) * win.w, y: win.y + R(0.06, 0.94) * win.h }, r = R(5, 10); fly.push(projectile(a, b, { ms: R(450, 750), arc: R(0.1, 0.4), trail: ['#ffffff', '#bfe9ff', '#ffd1ef'], draw: (g, x, y) => bub(g, x, y, r) }).then(() => stuck.push({ ...b, r }))); await wait(30); }
      let on = true; const stop = layer((g) => { for (const s of stuck) bub(g, s.x + Math.sin(performance.now() / 200 + s.x) * 1.2, s.y, s.r); return on; });
      await Promise.all(fly); caption('les bulles collent à la fenêtre'); await wait(450);
      caption('elles éclatent : la fenêtre part en petites bulles partout');
      on = false; stop(); for (const s of stuck) burst(s.x, s.y, 5, ['#ffffff', '#ffb3e6', '#a8dcff'], { max: 3, g: 0, life: 0.35, s: 2 });
      const bl = []; for (let y = 5; y < win.h; y += 12) for (let x = 5; x < win.w; x += 12) bl.push({ x: win.x + x + R(-3, 3), y: win.y + y + R(-3, 3), r: R(2.5, 6.5), vy: R(-2.6, -0.6), vx: R(-1.4, 1.4), life: R(0.3, 1.5) });
      win.mode = 'custom';
      await anim(1700, (g, k, dt) => { if (k < 0.15) drawWinImg(g, 1 - k / 0.15); for (const b of bl) { if (b.life <= 0) continue; b.life -= dt / 1000; b.x += b.vx; b.y += b.vy; b.vx *= 0.99; if (b.life <= 0) { burst(b.x, b.y, 4, ['#ffffff', '#a8dcff', '#ffb3e6'], { max: 2.5, g: 0, life: 0.3, s: 1.8 }); continue; } bub(g, b.x, b.y, b.r); } });
      win.mode = 'gone'; },
    async glace() { await gesture('g-recoil', 250); caption('éclats de glace');
      for (let i = 0; i < 5; i++) { const a = eyes(), b = { x: win.x + R(0.1, 0.9) * win.w, y: win.y + R(0.2, 0.8) * win.h }; projectile(a, b, { ms: 420, arc: 0.05, draw: (g, x, y, k) => { g.save(); g.translate(x, y); g.rotate(Math.atan2(b.y - a.y, b.x - a.x)); g.fillStyle = '#e8f8ff'; g.shadowColor = '#7fd4ff'; g.shadowBlur = 12; g.beginPath(); g.moveTo(14, 0); g.lineTo(-10, -4); g.lineTo(-10, 4); g.closePath(); g.fill(); g.restore(); }, trail: ['#ffffff', '#bfe9ff'] }).then(() => { crack(b.x, b.y, 4, 'rgba(255,255,255,.95)'); burst(b.x, b.y, 12, ['#ffffff', '#bfe9ff'], { max: 4 }); }); await wait(110); }
      await wait(450); caption('la fenêtre gèle et craque'); await freeze({ ms: 900 }); shake(5, 200);
      await shatter({ power: 9, tint: 'rgba(190,235,255,.7)', sparks: ['#ffffff', '#bfe9ff'] }); },
    async blizzard() { caption('la tempête de neige'); let on = true;
      const stop = layer(() => { emit(8, () => ({ x: R(-20, W * 0.2), y: R(0, H * 0.8), vx: R(6, 11), vy: R(0.5, 2), life: 1.4, max: 1.4, s: R(1, 3), c: '#ffffff', glow: false })); return on; });
      const g2 = win.img.getContext('2d'); await anim(1200, () => { g2.save(); g2.globalCompositeOperation = 'source-atop'; g2.fillStyle = 'rgba(255,255,255,.06)'; g2.fillRect(0, 0, win.img.width, win.img.height); g2.restore(); });
      await dissolve({ cols: ['#ffffff', '#e8f6ff'], dir: { x: 5, y: 0.6 }, glow: false, size: [1.5, 3] }); on = false; stop(); },
    async rochers() { caption('Odin lance des rochers');
      const rock = (g, x, y, k) => { g.save(); g.translate(x, y); g.rotate(k * 9); g.fillStyle = '#8a7058'; g.beginPath(); g.moveTo(-12, -6); g.lineTo(-4, -13); g.lineTo(10, -9); g.lineTo(13, 5); g.lineTo(2, 13); g.lineTo(-11, 7); g.closePath(); g.fill(); g.fillStyle = '#b49a7a'; g.beginPath(); g.arc(-3, -3, 4, 0, 7); g.fill(); g.restore(); };
      for (let i = 0; i < 3; i++) { await gesture('g-recoil', 160); const b = { x: win.x + R(0.2, 0.8) * win.w, y: win.y + R(0.2, 0.7) * win.h }; await projectile(heroC(), b, { ms: 520, arc: 0.35, draw: rock, trail: ['#8a7058', '#5a4634'] }); shake(7, 200); burst(b.x, b.y, 20, ['#8a7058', '#c3a27a'], { glow: false, shape: 'sq', g: 0.3 }); crack(b.x, b.y, 6); }
      await crush(); },
    async seisme() { caption('Odin frappe le sol'); await gesture('g-stomp', 480); shake(14, 1200); flash(0.15, '#c3a27a');
      const c = heroC(), y0 = ground(); await anim(700, (g, k) => { g.strokeStyle = '#1a120c'; g.lineWidth = 4; g.beginPath(); let x = c.x, y = y0; g.moveTo(x, y); const end = c.x + (winC().x - c.x) * k; while (x < end) { x += 14; y = y0 + Math.sin(x * 0.3) * 4 + R(-2, 2); g.lineTo(x, y); } g.stroke(); emit(2, () => ({ x: end, y: y0, vx: R(-2, 2), vy: R(-5, -2), ay: 0.3, life: 0.7, max: 0.7, s: R(2, 4), c: pick(['#8a7058', '#5a4634']), shape: 'sq' })); });
      caption('la fenêtre s\'effondre'); for (let i = 0; i < 5; i++) crack(win.x + R(0, win.w), win.y + R(0, win.h), 3); await crush({ ms: 1000 }); },
    async sable() { caption('Odin tourne en tempête de sable'); gesture('g-spin', 900); let on = true;
      const stop = layer((g) => { const e = heroC(); g.fillStyle = 'rgba(224,184,112,.12)'; g.fillRect(0, 0, W, H); emit(16, () => ({ x: e.x + R(-10, 10), y: R(win.y - 50, ground()), vx: R(9, 16), vy: R(-0.6, 0.6), life: 1.1, max: 1.1, s: 1, c: pick(['#e0b870', '#c79a52', '#f2d49a', '#a8814a']), shape: 'line', len: 2.6, w: R(1, 2) })); return on; });
      await wait(650); caption('le sable ronge la fenêtre, de gauche à droite');
      const g2 = win.img.getContext('2d'); g2.save(); g2.globalCompositeOperation = 'source-atop'; g2.fillStyle = 'rgba(224,184,112,.28)'; g2.fillRect(0, 0, win.img.width, win.img.height); g2.restore();
      const rows = 36, front = Array.from({ length: rows }, () => R(-0.12, 0)), sp = Array.from({ length: rows }, () => R(0.7, 1.4));
      await anim(1900, (g, k, dt) => { g2.save(); g2.globalCompositeOperation = 'destination-out'; for (let i = 0; i < rows; i++) { front[i] += (dt / 1500) * sp[i]; const x = Math.max(0, front[i]) * win.img.width, rh = win.img.height / rows; g2.fillRect(0, i * rh - 0.5, x, rh + 1); if (front[i] > 0 && front[i] < 1) emit(2, () => ({ x: win.x + front[i] * win.w, y: win.y + (i + R(0, 1)) * win.h / rows, vx: R(5, 11), vy: R(-1.2, 0.8), ay: 0.05, life: 0.8, max: 0.8, s: R(1, 2.4), c: pick(['#e0b870', '#c79a52', '#f2d49a', '#fff0c8']) })); } g2.restore(); });
      win.mode = 'gone'; await wait(500); on = false; stop(); },
    async cristaux() { caption('les cristaux jaillissent'); const ys = win.y + win.h + 10;
      const cr = Array.from({ length: 7 }, (_, i) => ({ x: win.x + (i + 0.5) * win.w / 7 + R(-8, 8), h: R(0.7, 1.3) * win.h, w: R(10, 18), a: R(-0.25, 0.25) }));
      await anim(700, (g, k) => { for (const c of cr) { g.save(); g.translate(c.x, ground()); g.rotate(c.a); const h = (ground() - win.y + 20) * Math.min(1, k * 1.2) * c.h / win.h; const gr = g.createLinearGradient(0, 0, 0, -h); gr.addColorStop(0, '#6b46c8'); gr.addColorStop(1, '#e6d9ff'); g.fillStyle = gr; g.shadowColor = '#b48cff'; g.shadowBlur = 12; g.beginPath(); g.moveTo(-c.w / 2, 0); g.lineTo(0, -h); g.lineTo(c.w / 2, 0); g.closePath(); g.fill(); g.restore(); } });
      shake(5, 200); await shatter({ from: { x: winC().x, y: ys }, power: 8, tint: 'rgba(180,140,255,.55)', sparks: ['#e6d9ff', '#b48cff'] }); },
    async tornade() { caption('la tornade part d\'Odin'); gesture('g-spin', 900); let pos = heroC().x, on = true;
      const stop = layer((g) => { const base = ground(); for (let i = 0; i < 26; i++) { const y = base - i * (base - win.y + 30) / 26, r = 8 + i * 2.6, t = performance.now() / 120 + i; g.strokeStyle = `rgba(220,235,255,${0.25 + i / 60})`; g.lineWidth = 2; g.beginPath(); g.ellipse(pos + Math.sin(t * 0.3) * 6, y, r, r * 0.25, 0, 0, 7); g.stroke(); } emit(3, () => ({ x: pos + R(-30, 30), y: R(win.y, ground()), vx: R(-3, 3), vy: R(-3, -1), life: 0.6, max: 0.6, s: R(1, 2), c: '#ffffff' })); return on; });
      await anim(900, (g, k) => { pos = heroC().x + (winC().x - heroC().x) * k; });
      await carry((k) => ({ x: winC().x + Math.sin(k * 20) * 30 * (1 - k), y: winC().y - k * (win.y + win.h) }), { ms: 1100, spin: 14, shrink: 0.85 }); on = false; stop(); },
    async rafale() { caption('le coup de vent'); await gesture('g-charge', 300); let on = true;
      const stop = layer(() => { emit(5, () => ({ x: R(-20, W * 0.3), y: R(win.y - 40, win.y + win.h + 40), vx: R(14, 20), vy: R(-0.5, 0.5), life: 0.6, max: 0.6, c: 'rgba(255,255,255,.8)', shape: 'line', len: 4, w: 1.5 })); return on; });
      await wait(300); await carry((k) => ({ x: winC().x + k * k * (W + 300), y: winC().y - Math.sin(k * 3) * 30 }), { ms: 1200, spin: 9, shrink: 0.3 }); on = false; stop(); },
    async foudre() { caption('la foudre crépite autour d\'Odin'); const st = { on: true }; const stop = crackle(st); await wait(800);
      caption('la foudre part de lui vers la fenêtre');
      for (let i = 0; i < 4; i++) { const b = { x: win.x + R(0.15, 0.85) * win.w, y: win.y + R(0.2, 0.8) * win.h }; const bl = bolt(eyes(), b, { branches: 5 }); await anim(150, (g) => drawBolt(g, bl, '#7fa6ff', 4.5)); flash(0.3, '#e8eeff'); shake(5, 120); crack(b.x, b.y, 6, 'rgba(30,30,80,.9)'); burst(b.x, b.y, 18, ['#ffffff', '#cfe0ff', '#7fa6ff'], { max: 7 }); await wait(90); }
      const fin = bolt(eyes(), winC(), { branches: 8 }); await anim(240, (g) => drawBolt(g, fin, '#7fa6ff', 7)); flash(0.85, '#ffffff'); shake(12, 320);
      await shatter({ power: 13, sparks: ['#ffffff', '#cfe0ff', '#7fa6ff'], tint: 'rgba(160,190,255,.4)' }); st.on = false; stop(); },
    async orage() { caption('un nuage d\'orage se forme'); let on = true, cl = 0;
      const stop = layer((g) => { g.globalAlpha = cl; g.fillStyle = '#2a2448'; for (const [dx, dy, r] of [[-60, 0, 34], [-20, -14, 40], [24, -8, 38], [60, 4, 30], [0, 10, 36]]) { g.beginPath(); g.arc(winC().x + dx, win.y - 70 + dy, r, 0, 7); g.fill(); } g.globalAlpha = 1; if (cl > 0.5) emit(2, () => ({ x: winC().x + R(-80, 80), y: win.y - 50, vx: -0.5, vy: 7, life: 0.5, max: 0.5, c: 'rgba(160,180,255,.7)', shape: 'line', len: 2, w: 1 })); return on; });
      await anim(600, (g, k) => { cl = k; });
      for (let i = 0; i < 3; i++) { const b = { x: win.x + R(0.2, 0.8) * win.w, y: win.y + R(0.2, 0.7) * win.h }; const pts = jagged({ x: b.x + R(-30, 30), y: win.y - 60 }, b, 0.3, 5); await anim(120, (g) => glowLine(g, pts, '#9fb4ff', '#ffffff', 4)); flash(0.4, '#dfe6ff'); shake(5, 150); crack(b.x, b.y, 5); await wait(150); }
      await shatter({ power: 9, sparks: ['#ffffff', '#9fb4ff'], tint: 'rgba(150,170,255,.35)' }); await anim(400, (g, k) => { cl = 1 - k; }); on = false; stop(); },
    async eclair() { caption('le ciel gronde, des éclairs crépitent autour d\'Odin'); const st = { on: true }; const stop = crackle(st); await wait(700); flash(0.15, '#cfe0ff');
      const b = winC(); const bl = bolt({ x: b.x + R(-40, 40), y: -10 }, { x: b.x, y: win.y + 6 }, { branches: 7, rough: 0.16 });
      caption('un éclair géant tombe du ciel sur la fenêtre');
      await anim(130, (g, k) => drawBolt(g, { main: bl.main.slice(0, Math.max(2, Math.ceil(bl.main.length * k))), br: k > 0.7 ? bl.br : [] }, '#9fb4ff', 8));
      await anim(240, (g) => drawBolt(g, bl, '#9fb4ff', 9)); flash(1); shake(14, 400); crack(b.x, win.y + 8, 9, 'rgba(30,30,80,.9)');
      await shatter({ power: 14, sparks: ['#ffffff', '#e8f0ff', '#9fb4ff'], tint: 'rgba(220,230,255,.5)' }); st.on = false; stop(); },
    async etoiles() { caption('des étoiles filantes traversent le ciel'); const hits = [];
      for (let i = 0; i < 7; i++) { const b = { x: win.x + R(0.1, 0.9) * win.w, y: win.y + R(0.1, 0.9) * win.h }, a = { x: b.x - R(260, 420), y: b.y - R(220, 320) }; let rot = 0;
        hits.push(anim(650, (g, k) => { const e = k * k * (3 - 2 * k), x = a.x + (b.x - a.x) * e, y = a.y + (b.y - a.y) * e; rot += 0.2;
          const q = Math.max(0, e - 0.4), tx = a.x + (b.x - a.x) * q, ty = a.y + (b.y - a.y) * q, gr = g.createLinearGradient(tx, ty, x, y); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,240,200,.95)');
          g.strokeStyle = gr; g.lineWidth = 2.6; g.lineCap = 'round'; g.beginPath(); g.moveTo(tx, ty); g.lineTo(x, y); g.stroke();
          g.save(); g.shadowColor = '#ffe9a0'; g.shadowBlur = 16; g.fillStyle = '#fff8d8'; starPath(g, x, y, 9, rot); g.fill(); g.restore();
          if (Math.random() < 0.7) emit(1, () => ({ x, y, vx: R(-0.5, 0.5), vy: R(-0.5, 0.5), life: 0.6, max: 0.6, s: R(0.8, 1.8), c: pick(['#ffffff', '#ffe9a0', '#c8a8ff']), glow: true })); })
          .then(() => { burst(b.x, b.y, 14, ['#ffffff', '#ffe9a0', '#c8a8ff'], { max: 5, g: 0.02 }); crack(b.x, b.y, 4, 'rgba(60,40,120,.6)'); })); await wait(140); }
      await Promise.all(hits); caption('la fenêtre part en poussière d\'étoiles'); await dissolve({ cols: ['#ffffff', '#ffe9a0', '#c8a8ff'], dir: { x: 0.6, y: -1.2 }, size: [1, 2.6] }); },
    async trounoir() { caption('un trou noir s\'ouvre à côté de la fenêtre'); const c = { x: win.x - Math.min(110, W * 0.12), y: winC().y }; let r = 0, on = true;
      const draw = (g) => { if (r < 1) return; let gr = g.createRadialGradient(c.x, c.y, r, c.x, c.y, r * 3.2); gr.addColorStop(0, 'rgba(255,170,80,.5)'); gr.addColorStop(0.4, 'rgba(180,60,160,.16)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(c.x, c.y, r * 3.2, 0, 7); g.fill();
        const disk = (front) => { for (let i = 0; i < 4; i++) { const rr = r * (1.5 + i * 0.3); g.strokeStyle = i % 2 ? 'rgba(255,205,130,.8)' : 'rgba(255,135,55,.85)'; g.lineWidth = r * 0.15; g.beginPath(); g.ellipse(c.x, c.y, rr, rr * 0.2, -0.12, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2); g.stroke(); } };
        disk(false); g.strokeStyle = 'rgba(255,214,150,.9)'; g.lineWidth = r * 0.13; g.beginPath(); g.ellipse(c.x, c.y, r * 1.28, r * 1.18, 0, Math.PI, Math.PI * 2); g.stroke(); g.globalAlpha = 0.45; g.beginPath(); g.ellipse(c.x, c.y, r * 1.22, r * 1.06, 0, 0, Math.PI); g.stroke(); g.globalAlpha = 1;
        g.fillStyle = '#000'; g.beginPath(); g.arc(c.x, c.y, r, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,240,210,.9)'; g.lineWidth = 1.5; g.beginPath(); g.arc(c.x, c.y, r * 1.04, 0, 7); g.stroke(); disk(true); };
      const stop = layer((g) => { draw(g); return on; });
      await anim(800, (g, k) => { r = 36 * k * (2 - k); });
      caption('la fenêtre est étirée vers lui, puis avalée'); win.mode = 'custom'; const w0 = winC();
      await anim(1700, (g, k) => { const e = k * k, p = { x: w0.x + (c.x - w0.x) * e, y: w0.y + (c.y - w0.y) * e }, ang = Math.atan2(c.y - p.y, c.x - p.x);
        g.save(); g.translate(p.x, p.y); g.rotate(ang); g.scale((1 + e * 2.2) * (1 - e * 0.92), Math.max(0.02, 1 - e)); g.rotate(-ang); g.globalAlpha = 1 - Math.max(0, e - 0.85) * 6; g.drawImage(win.img, -win.w / 2, -win.h / 2, win.w, win.h); g.restore();
        if (Math.random() < 0.7) emit(1, () => { const a = R(0, 7), d = r * R(1.6, 2.6); return { x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d * 0.22, vx: -Math.sin(a) * 3, vy: Math.cos(a) * 0.7, life: 0.5, max: 0.5, s: R(1, 2), c: pick(['#ffd8a0', '#ff8a3d']), glow: true }; }); draw(g); });
      win.mode = 'gone'; caption('le trou noir se referme'); await anim(600, (g, k) => { r = 36 * (1 - k); }); flash(0.25, '#ffd8a0'); on = false; stop(); },
    async aurore() { caption('les voiles de l\'aurore descendent'); let on = true, lv = 0;
      const stop = layer((g) => { const t = performance.now() / 700; for (const [c, o] of [['#2ff0a8', 0], ['#7d5cff', 1.3], ['#3dd6ff', 2.4]]) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.35; const gr = g.createLinearGradient(0, 0, 0, lv); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, c); g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0); for (let x = 0; x <= W; x += 12) g.lineTo(x, lv + Math.sin(x * 0.015 + t + o) * 30); g.lineTo(W, 0); g.closePath(); g.fill(); } g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; return on; });
      await anim(900, (g, k) => { lv = (win.y + win.h * 0.6) * k; }); await dissolve({ cols: ['#2ff0a8', '#7d5cff', '#b8ffe6'], dir: { x: 0, y: -1.8 }, sweep: 'y' }); await anim(500, (g, k) => { lv = (win.y + win.h * 0.6) * (1 - k); }); on = false; stop(); },
    async soleil() { caption('le rayon de soleil'); let on = true, wd = 0;
      const stop = layer((g) => { g.globalCompositeOperation = 'lighter'; const gr = g.createLinearGradient(winC().x - wd, 0, winC().x + wd, 0); gr.addColorStop(0, 'rgba(255,240,180,0)'); gr.addColorStop(0.5, 'rgba(255,250,220,.9)'); gr.addColorStop(1, 'rgba(255,240,180,0)'); g.fillStyle = gr; g.fillRect(winC().x - wd, 0, wd * 2, ground()); g.globalCompositeOperation = 'source-over'; return on; });
      await anim(600, (g, k) => { wd = win.w * 0.7 * k; }); flash(0.4, '#fff6dc'); await dissolve({ cols: ['#ffffff', '#fff6dc', '#ffe9a0'], dir: { x: 0, y: -2.2 }, sweep: 'y' }); await anim(400, (g, k) => { wd = win.w * 0.7 * (1 - k); }); on = false; stop(); },
    async lumiere() { caption('le pilier de lumière'); let on = true, wd = 0;
      const stop = layer((g) => { g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(255,255,255,.85)'; g.shadowColor = '#fff'; g.shadowBlur = 40; g.fillRect(winC().x - wd, -10, wd * 2, ground() + 10); g.globalCompositeOperation = 'source-over'; return on; });
      await anim(500, (g, k) => { wd = (win.w / 2 + 20) * k; }); flash(0.6); await dissolve({ cols: ['#ffffff', '#fff3c0'], dir: { x: 0, y: -2.6 }, sweep: 'y', ms: 1100 }); await anim(500, (g, k) => { wd = (win.w / 2 + 20) * (1 - k); }); on = false; stop(); },
    async runes() { caption('le cercle de runes'); const c = winC(), RR = Math.hypot(win.w, win.h) / 2 + 20, glyphs = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃ'; let on = true, a0 = 0, al = 0;
      const stop = layer((g) => { a0 += 0.02; g.globalAlpha = al; g.strokeStyle = '#ffe9a0'; g.lineWidth = 2; g.shadowColor = '#ffd36a'; g.shadowBlur = 14; g.beginPath(); g.arc(c.x, c.y, RR, 0, 7); g.stroke(); g.fillStyle = '#fff3c0'; g.font = '18px serif'; g.textAlign = 'center'; for (let i = 0; i < 12; i++) { const a = a0 + i / 12 * 6.28; g.fillText(glyphs[i], c.x + Math.cos(a) * RR, c.y + Math.sin(a) * RR + 6); } g.globalAlpha = 1; return on; });
      await anim(700, (g, k) => { al = k; }); await dissolve({ cols: ['#ffd36a', '#fff3c0', '#ffffff'], dir: { x: 0, y: -1.8 } }); await anim(400, (g, k) => { al = 1 - k; }); on = false; stop(); },
    async gungnir() { await gesture('g-recoil', 300); caption('Odin lance Gungnir'); const a = eyes(), b = winC();
      await projectile(a, b, { ms: 300, arc: 0, draw: (g, x, y) => { g.save(); g.translate(x, y); g.rotate(Math.atan2(b.y - a.y, b.x - a.x)); g.fillStyle = '#fff3c0'; g.shadowColor = '#ffd36a'; g.shadowBlur = 16; g.fillRect(-60, -2, 60, 4); g.beginPath(); g.moveTo(18, 0); g.lineTo(0, -7); g.lineTo(0, 7); g.closePath(); g.fill(); g.restore(); }, trail: ['#fff3c0', '#ffd36a'] });
      flash(0.7, '#fff3c0'); shake(12, 300); await shatter({ power: 14, sparks: ['#fff3c0', '#ffd36a', '#ffffff'] }); },
    async lianes() { caption('les lianes poussent'); const vs = Array.from({ length: 5 }, (_, i) => ({ x: win.x + (i + 0.5) * win.w / 5, ph: R(0, 6) })); let on = true, k0 = 0;
      const stop = layer((g) => { g.strokeStyle = '#2f9e3a'; g.lineWidth = 5; g.lineCap = 'round'; for (const v of vs) { g.beginPath(); g.moveTo(v.x, ground()); const top = ground() - (ground() - win.y + 10) * k0; for (let y = ground(); y > top; y -= 6) g.lineTo(v.x + Math.sin(y * 0.06 + v.ph) * 16, y); g.stroke(); g.fillStyle = '#4fc35a'; for (let y = ground() - 20; y > top; y -= 26) { g.beginPath(); g.ellipse(v.x + Math.sin(y * 0.06 + v.ph) * 16 + 8, y, 7, 3.5, 0.5, 0, 7); g.fill(); } } return on; });
      await anim(900, (g, k) => { k0 = k; }); shake(4, 200); await crush({ debris: ['#4fc35a', '#2f9e3a', '#8fe08a'] }); burst(winC().x, win.y + win.h, 30, ['#4fc35a', '#8fe08a'], { glow: false, shape: 'leaf', s: 6 }); await wait(300); on = false; stop(); },
    async petales() { caption('les pétales'); await gesture('g-float', 300); await dissolve({ cols: ['#ffc4dd', '#ff9ac8', '#ffe0ee'], dir: { x: 2.2, y: -0.8 }, shape: 'petal', glow: false, size: [3, 5], spread: 1.6 }); },
    async feuilles() { caption('les feuilles tombent'); await dissolve({ cols: ['#ff9a3d', '#e85d2a', '#f2c14a'], dir: { x: 0.6, y: 1.4 }, shape: 'leaf', glow: false, size: [4, 7], spread: 1.4, sweep: 'y' }); },
    async poison() { await gesture('g-charge', 350); caption('Odin crache l\'acide'); let on = true;
      const stop = layer((g) => { const e = eyes(); emit(6, () => { const b = { x: win.x + R(0, win.w * 0.8), y: win.y + R(0, win.h) }, dx = b.x - e.x; return { x: e.x, y: e.y, vx: dx / 26 + R(-0.5, 0.5), vy: (b.y - e.y) / 26 - 6, ay: 0.46, life: 0.9, max: 0.9, s: R(2.5, 5), c: pick(['#f0ff6a', '#9dff00', '#39ff14']), glow: true, drag: 1 }; }); return on; });
      await wait(700); caption('l\'acide fait fondre toute la fenêtre'); await melt({ tint: '#7dff2a', drip: ['#f0ff6a', '#9dff00', '#39ff14'], ms: 2100 }); on = false; stop(); },
    async laser() { caption('le laser balaie la fenêtre'); const g2 = win.img.getContext('2d'); let p = null, lastRow = -1;
      const rows = 5; await anim(1700, (g, k) => {
        const rk = k * rows, row = Math.min(rows - 1, Math.floor(rk)), f = rk - row, dirR = row % 2 === 0;
        const x = win.x + win.w * (dirR ? f : 1 - f), y = win.y + 28 + (win.h - 36) * (row + 0.5) / rows, t = { x, y };
        glowLine(g, [eyes(), t], '#ff0000', '#ffe0e0', 4);
        if (row !== lastRow) { p = null; lastRow = row; }
        if (p) { g2.save(); g2.scale(DPR, DPR); g2.strokeStyle = '#1a0500'; g2.lineWidth = 6; g2.lineCap = 'round'; g2.beginPath(); g2.moveTo(p.x - win.x, p.y - win.y); g2.lineTo(x - win.x, y - win.y); g2.stroke(); g2.strokeStyle = '#ff6a00'; g2.lineWidth = 2; g2.stroke(); g2.restore(); }
        p = t;
        emit(4, () => ({ x, y, vx: R(-3, 3), vy: R(-4, 0), ay: 0.2, life: 0.5, max: 0.5, s: R(1.5, 3), c: pick(['#ffd000', '#ff3a00', '#ffffff']), glow: true })); emit(1, () => ({ x, y, vx: R(-0.3, 0.3), vy: -1, life: 1.2, max: 1.2, s: 5, c: 'rgba(60,60,60,1)', shape: 'smoke', grow: 0.2 }));
      });
      caption('elle brûle jusqu\'aux cendres'); await burn({ ms: 1100, edge: '#ff4a4a', glow: '#ff0000' }); },
    async onde() { caption('Odin saute');
      await anim(380, (g, k) => { hero.style.transform = `translateY(${-95 * Math.sin(k * Math.PI / 2)}px)`; }); await wait(80);
      caption('il retombe et frappe le sol'); await anim(170, (g, k) => { hero.style.transform = `translateY(${-95 * (1 - k * k)}px)`; }); hero.style.transform = '';
      shake(12, 500); flash(0.3, '#4fd1ff'); smoke(heroC().x, ground(), 14, 'rgba(160,200,230,1)');
      caption('l\'onde de choc traverse l\'écran'); const c = { x: heroC().x, y: ground() }, maxR = Math.hypot(W, H); let hit = false;
      await anim(1100, (g, k) => { const r = maxR * k; for (const [dr, w, a] of [[0, 10, 0.85], [-18, 5, 0.5], [-40, 3, 0.3]]) { g.strokeStyle = `rgba(80,200,255,${a * (1 - k)})`; g.lineWidth = w; g.beginPath(); g.ellipse(c.x, c.y, Math.max(1, r + dr), Math.max(1, (r + dr) * 0.55), 0, 0, 7); g.stroke(); }
        if (!hit && r > Math.hypot(win.x - c.x, (win.y + win.h / 2 - c.y) / 0.55)) { hit = true; shake(12, 300); flash(0.4, '#bfefff'); shatter({ from: { x: win.x - 40, y: winC().y }, power: 13, sparks: ['#ffffff', '#4fd1ff', '#0090ff'], tint: 'rgba(80,200,255,.35)' }); } });
      await wait(700); },
    async aimant() { caption('Odin aimante la fenêtre'); let on = true;
      const stop = layer((g) => { const a = heroC(), b = winC(), t = performance.now() / 200; g.setLineDash([8, 8]); g.lineDashOffset = -t * 6; g.lineWidth = 2.2; for (let i = -3; i <= 3; i++) { g.strokeStyle = i < 0 ? 'rgba(255,80,80,.6)' : 'rgba(90,140,255,.6)'; g.beginPath(); g.moveTo(a.x + a.r * 0.7, a.y + i * 4); g.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + i * 32, b.x - win.w * 0.3, b.y + i * 10); g.stroke(); } g.setLineDash([]); return on; });
      win.mode = 'custom'; await anim(650, (g, k) => { g.save(); g.translate(winC().x + R(-3, 3) * k, winC().y + R(-2, 2) * k); g.rotate(R(-0.02, 0.02) * k); g.drawImage(win.img, -win.w / 2, -win.h / 2, win.w, win.h); g.restore(); });
      caption('la fenêtre est arrachée et vole vers lui'); const a = heroC(), b = winC(), tx = a.x + a.r + 8;
      await anim(750, (g, k) => { const e = k * k, x = b.x + (tx - b.x) * e, y = b.y + (a.y - b.y) * e; g.save(); g.translate(x, y); g.scale((1 + e * 0.5) * (1 - e * 0.88), 1 - e * 0.88); g.drawImage(win.img, -win.w / 2, -win.h / 2, win.w, win.h); g.restore(); });
      shake(8, 220); flash(0.25, '#ffffff'); caption('elle se colle à lui, se tasse en bille de métal, et il l\'absorbe'); on = false; stop();
      await anim(500, (g, k) => { const s = 26 * (1 - k * 0.85), x = tx - k * (a.r + 8); g.save(); g.translate(x, a.y); const gr = g.createRadialGradient(-s * 0.3, -s * 0.3, 1, 0, 0, s / 2); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#c4cad4'); gr.addColorStop(1, '#6b7386'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, s / 2, 0, 7); g.fill(); g.restore(); });
      win.mode = 'gone';
      for (const col of ['255,80,80', '90,140,255']) { const c = heroC(); await anim(280, (g, k) => { g.strokeStyle = `rgba(${col},${1 - k})`; g.lineWidth = 3; g.beginPath(); g.arc(c.x, c.y, c.r * (1 + k * 1.3), 0, 7); g.stroke(); }); } },
    async teleport() { await gesture('g-glitch', 500); caption('la fenêtre se téléporte'); await teleportOut(); },
    async ombre() { caption('l\'ombre gagne la fenêtre par ses bords'); const g2 = win.img.getContext('2d'), D = Math.hypot(win.w, win.h);
      const tend = Array.from({ length: 12 }, (_, i) => { const side = i % 4, t = R(0.1, 0.9), p = side === 0 ? { x: t * win.w, y: 0 } : side === 1 ? { x: win.w, y: t * win.h } : side === 2 ? { x: t * win.w, y: win.h } : { x: 0, y: t * win.h }; return { p, a: Math.atan2(win.h / 2 - p.y, win.w / 2 - p.x) + R(-0.5, 0.5), ph: R(0, 6) }; });
      await anim(1500, (g, k) => { g2.save(); g2.scale(DPR, DPR); g2.fillStyle = 'rgba(10,6,22,.035)'; g2.fillRect(0, 0, win.w, win.h); g2.strokeStyle = 'rgba(8,4,16,.9)'; g2.lineCap = 'round';
        for (const t of tend) { const L = D * 0.55 * k; g2.lineWidth = 9 * (1 - k * 0.4); g2.beginPath(); g2.moveTo(t.p.x, t.p.y); for (let s = 0; s <= 1.001; s += 0.1) { const d = L * s, wv = Math.sin(s * 7 + k * 5 + t.ph) * 7; g2.lineTo(t.p.x + Math.cos(t.a) * d - Math.sin(t.a) * wv, t.p.y + Math.sin(t.a) * d + Math.cos(t.a) * wv); } g2.stroke(); } g2.restore();
        if (Math.random() < 0.4) emit(1, () => ({ x: win.x + R(0, win.w), y: win.y + R(0, win.h), vx: R(-0.3, 0.3), vy: R(-0.8, -0.2), life: 1, max: 1, s: R(4, 9), c: 'rgba(30,15,50,1)', shape: 'smoke', grow: 0.12 })); });
      caption('la fenêtre se dissout en fumée noire'); await dissolve({ cols: ['#1a0f2e', '#2d1b4e', '#0a0612'], dir: { x: 0, y: -0.9 }, glow: false, size: [2, 4.5] }); },
    async pixels() { await gesture('g-glitch', 400); caption('la fenêtre se pixelise'); await pixelate({ cols: ['#5a6fdb', '#8fa0ff'] }); },
    async corbeaux() { caption('les corbeaux arrivent'); const bird = (g, x, y, f) => { g.fillStyle = '#11131b'; g.beginPath(); g.ellipse(x, y, 9, 5, 0, 0, 7); g.fill(); g.beginPath(); g.moveTo(x - 4, y); g.quadraticCurveTo(x - 14, y - 14 * f, x - 22, y - 4 * f); g.quadraticCurveTo(x - 12, y - 2, x - 4, y); g.moveTo(x + 4, y); g.quadraticCurveTo(x + 14, y - 14 * f, x + 22, y - 4 * f); g.quadraticCurveTo(x + 12, y - 2, x + 4, y); g.fill(); g.fillStyle = '#9fd0ff'; g.beginPath(); g.arc(x + 7, y - 1, 1.3, 0, 7); g.fill(); };
      const a = heroC(); const tl = { x: win.x + 10, y: win.y }, tr = { x: win.x + win.w - 10, y: win.y };
      await anim(900, (g, k) => { const f = Math.sin(k * 30); bird(g, a.x + (tl.x - a.x) * k, a.y + (tl.y - a.y) * k - Math.sin(k * 3.14) * 60, f); bird(g, a.x + (tr.x - a.x) * k, a.y + (tr.y - a.y) * k - Math.sin(k * 3.14) * 90, -f); });
      caption('ils l\'emportent'); win.mode = 'custom';
      await anim(1300, (g, k) => { const dx = k * k * (W * 0.5), dy = -k * (win.y + win.h + 60), f = Math.sin(k * 40); g.save(); g.translate(winC().x + dx, winC().y + dy); g.rotate(Math.sin(k * 6) * 0.1); g.scale(1 - k * 0.4, 1 - k * 0.4); g.drawImage(win.img, -win.w / 2, -win.h / 2, win.w, win.h); g.restore(); bird(g, tl.x + dx, tl.y + dy - 4, f); bird(g, tr.x + dx, tr.y + dy - 4, -f); emit(1, () => ({ x: tl.x + dx, y: tl.y + dy, vx: R(-1, 1), vy: 1, ay: 0.05, life: 1.2, max: 1.2, s: 4, c: '#2b2f3d', shape: 'leaf', rot: R(0, 7), vr: 0.1 })); });
      win.mode = 'gone'; },
    async bifrost() { caption('le pont arc-en-ciel'); const a = heroC(), b = { x: W + 80, y: -40 }; const cols = ['#ff2d3d', '#ff9a1f', '#ffe62e', '#2ee05a', '#1fb6ff', '#4a5bff', '#b44dff']; let on = true, len = 0;
      const P = (k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k - Math.sin(k * 3.14) * 160 });
      const stop = layer((g) => { g.lineCap = 'round'; cols.forEach((c, i) => { g.strokeStyle = c; g.globalAlpha = 0.85; g.lineWidth = 6; g.beginPath(); for (let k = 0; k <= len; k += 0.02) { const p = P(k); k ? g.lineTo(p.x, p.y + i * 5 - 15) : g.moveTo(p.x, p.y + i * 5 - 15); } g.stroke(); }); g.globalAlpha = 1; return on; });
      await anim(700, (g, k) => { len = k; });
      // la fenêtre monte sur le pont et part au bout
      const kw = 0.62; await carry((k) => { const p = P(kw + (1 - kw) * k); return { x: winC().x + (p.x - winC().x) * Math.min(1, k * 2), y: winC().y + (p.y - winC().y) * Math.min(1, k * 2) }; }, { ms: 1300, spin: -0.4, shrink: 0.8 });
      await anim(400, () => {}); on = false; stop(); },
    async artifice() { caption('les fusées partent'); for (let i = 0; i < 3; i++) { const b = { x: win.x + R(0.2, 0.8) * win.w, y: win.y + R(0.2, 0.7) * win.h }, cols = pick([['#ff4a4a', '#ffe14a'], ['#4adf6a', '#4aa8ff'], ['#ff6ad5', '#ffffff']]); projectile({ x: heroC().x, y: heroC().y - 20 }, b, { ms: 520, arc: 0.4, r: 4, cols: ['#ffffff', cols[0]], trail: ['#ffe14a', '#ff9a1f'] }).then(() => { flash(0.15, cols[0]); burst(b.x, b.y, 70, cols, { max: 7, g: 0.06 }); }); await wait(200); }
      await wait(500); await shatter({ power: 10, sparks: ['#ff4a4a', '#ffe14a', '#4adf6a', '#4aa8ff', '#ff6ad5'] }); },
    // nouveaux
    async magma_coulee() { caption('la fenêtre rougit et fond'); const g2 = win.img.getContext('2d'); await anim(700, () => { g2.save(); g2.globalCompositeOperation = 'source-atop'; g2.fillStyle = 'rgba(255,60,0,.08)'; g2.fillRect(0, 0, win.img.width, win.img.height); g2.restore(); }); await melt({ tint: '#ff4a00', drip: ['#ffb000', '#ff4a00'], top: true, ms: 1800 }); },
    async givre() { caption('le givre gagne la fenêtre'); for (const [x, y] of [[win.x, win.y], [win.x + win.w, win.y], [win.x, win.y + win.h], [win.x + win.w, win.y + win.h]]) crack(x, y, 5, 'rgba(255,255,255,.9)'); await freeze({ ms: 1500 }); await shatter({ power: 4, gravity: 0.22, tint: 'rgba(200,240,255,.7)', ms: 1600 }); },
    async bulle_geante() { await gesture('g-charge', 300); caption('Odin souffle des bulles');
      const bub = (g, x, y, r) => { g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); const gr = g.createRadialGradient(x - r * 0.4, y - r * 0.4, 1, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.6)'); gr.addColorStop(0.6, 'rgba(160,220,255,.08)'); gr.addColorStop(1, 'rgba(255,150,220,.35)'); g.fillStyle = gr; g.fill(); };
      for (let i = 0; i < 6; i++) { const a = eyes(); projectile(a, { x: win.x + R(0, win.w), y: win.y + R(0, win.h) }, { ms: 700, arc: 0.3, draw: (g, x, y) => bub(g, x, y, 9) }); await wait(90); }
      await wait(500); win.mode = 'custom'; const c0 = winC(), R0 = Math.hypot(win.w, win.h) / 2 + 12;
      await anim(1400, (g, k) => { const yy = c0.y - k * k * (c0.y + 40), s = 1 - k * 0.3; g.save(); g.translate(c0.x, yy); g.rotate(Math.sin(k * 8) * 0.06); g.scale(s, s); g.drawImage(win.img, -win.w / 2, -win.h / 2, win.w, win.h); bub(g, 0, 0, R0); g.restore(); });
      win.mode = 'gone'; burst(c0.x, 10, 50, ['#ffffff', '#ffb3e6', '#a8dcff'], { max: 6 }); },
    async neon_coupe() { caption('les traits néon découpent'); for (let i = 0; i < 4; i++) { const y = win.y + R(0.15, 0.85) * win.h, a = { x: win.x - 20, y: y + R(-20, 20) }, b = { x: win.x + win.w + 20, y: y + R(-20, 20) }; await anim(160, (g, k) => glowLine(g, [a, { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }], pick(['#ff3ad6', '#3af0ff']), '#ffffff', 3)); }
      await shatter({ cols: 2, rows: 5, power: 5, gravity: 0.25, sparks: ['#ff3ad6', '#3af0ff'], tint: 'rgba(255,58,214,.25)' }); },
    async spirale() { caption('la fenêtre se met à tourner sur elle-même'); win.mode = 'custom'; const c = winC(), PAL = ['#ffffff', '#c8a8ff', '#ff5ac8', '#9fd0ff'];
      await anim(1900, (g, k) => { const e = k * k; g.save(); g.translate(c.x, c.y); g.rotate(e * 9); const s = Math.max(0.02, 1 - e * 0.95); g.scale(s, s * (1 - e * 0.45)); g.globalAlpha = 1 - e * 0.75; g.drawImage(win.img, -win.w / 2, -win.h / 2, win.w, win.h); g.restore();
        g.globalCompositeOperation = 'lighter'; for (let arm = 0; arm < 3; arm++) for (let i = 0; i < 28; i++) { const t = i / 28, ang = arm * 2.094 + t * 4.4 + k * 6, rr = 8 + t * Math.max(win.w, win.h) * 0.62 * Math.min(1, k * 1.4); g.globalAlpha = (1 - t) * Math.min(1, k * 2); g.fillStyle = PAL[(arm + i) % 4]; g.beginPath(); g.arc(c.x + Math.cos(ang) * rr, c.y + Math.sin(ang) * rr * 0.55, 1 + (1 - t) * 1.6, 0, 7); g.fill(); } g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
        orb(g, c.x, c.y, 28 * Math.min(1, k * 2), ['#ffffff', '#c8a8ff']); });
      win.mode = 'gone'; caption('la galaxie s\'éteint en étoiles'); burst(c.x, c.y, 60, PAL, { max: 5, g: 0 }); await anim(500, (g, k) => orb(g, c.x, c.y, 28 * (1 - k), ['#ffffff', '#c8a8ff'])); },
    async mercure() { caption('le métal liquide recouvre'); const g2 = win.img.getContext('2d'); await anim(700, (g, k) => { g2.save(); g2.globalCompositeOperation = 'source-atop'; g2.fillStyle = 'rgba(200,210,225,.12)'; g2.fillRect(0, 0, win.img.width, win.img.height * k / DPR * DPR); g2.restore(); }); await melt({ tint: '#c9d0dc', drip: ['#ffffff', '#c9d0dc', '#8a94a6'] }); },
    async encre() { caption('la tache d\'encre'); const c = winC(); let r = 0, on = true;
      const stop = layer((g) => { g.fillStyle = '#0a0b18'; g.beginPath(); for (let a = 0; a <= 6.3; a += 0.2) { const rr = r * (1 + Math.sin(a * 5) * 0.12 + Math.sin(a * 9) * 0.06); a ? g.lineTo(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr) : g.moveTo(c.x + rr, c.y); } g.closePath(); g.fill(); return on; });
      await anim(1000, (g, k) => { r = Math.hypot(win.w, win.h) * 0.6 * k; }); win.mode = 'gone'; await anim(700, (g, k) => { r = Math.hypot(win.w, win.h) * 0.6 * (1 - k); }); on = false; stop(); },
    async hologramme() { caption('l\'hologramme grésille'); await teleportOut({ cols: ['#5af0ff', '#bff8ff'], ms: 1400 }); },
    async origami() { caption('la fenêtre se plie'); win.mode = 'custom'; await anim(600, (g, k) => { const s = 1 - k * 0.85; g.drawImage(win.img, winC().x - win.w * s / 2, win.y, win.w * s, win.h); });
      await anim(1100, (g, k) => { const x = winC().x + k * k * W * 0.6, y = winC().y - k * (win.y + 80); g.save(); g.translate(x, y); g.rotate(-0.35); g.fillStyle = '#ffffff'; g.strokeStyle = '#94a3b8'; g.beginPath(); g.moveTo(26, 0); g.lineTo(-20, -14); g.lineTo(-10, 0); g.lineTo(-20, 14); g.closePath(); g.fill(); g.stroke(); g.restore(); }); win.mode = 'gone'; },
    async plasma() { caption('la sphère de plasma'); const c = winC(); let r = 0, on = true;
      const stop = layer((g) => { orb(g, c.x, c.y, r * 1.4, ['#ffffff', '#b14cff']); for (let i = 0; i < 4; i++) glowLine(g, jagged(c, { x: c.x + Math.cos(i * 1.6 + performance.now() / 300) * r, y: c.y + Math.sin(i * 1.6 + performance.now() / 300) * r }, 0.3, 3), '#ff9af0', '#ffffff', 1.5); return on; });
      await anim(800, (g, k) => { r = Math.hypot(win.w, win.h) * 0.6 * k; }); flash(0.6, '#e6b8ff'); await shatter({ power: 13, sparks: ['#ffffff', '#ff9af0', '#7a3cff'], tint: 'rgba(200,90,255,.5)' }); on = false; stop(); },
    async papillons() { caption('les papillons s\'envolent'); await dissolve({ cols: ['#ff9ac8', '#b48cff', '#7fd4ff', '#ffd36a'], dir: { x: 1.2, y: -1.6 }, shape: 'fly', glow: false, size: [4, 6], spread: 1.8, ms: 1600 }); },
  };
  // les nouveaux pouvoirs qui réutilisent un scénario
  S.bulle_geante = S.bulles;

  // ------------------------------------------------------------------ lecture d'un pouvoir
  let current = null;
  // ---------------------------------------------------------------- la copie de l'élément (« la fenêtre »)
  const PROPS = ['display', 'position', 'box-sizing', 'width', 'height', 'min-height', 'padding', 'margin', 'border', 'border-radius', 'background-color', 'background-image', 'color', 'font', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'white-space', 'overflow', 'flex', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap', 'grid-template-columns', 'grid-template-rows', 'grid-column', 'opacity', 'box-shadow', 'list-style', 'text-decoration', 'vertical-align', 'object-fit'];
  /** Capture, au moment où l'élément existe encore : sa forme en SVG (styles recopiés) et de quoi dessiner une réplique. */
  function capture(src) {
    try {
      const r = src.getBoundingClientRect(); if (!r.width || !r.height) return null;
      const cs = getComputedStyle(src), all = src.querySelectorAll('*'); let svg = null;
      if (all.length < 900) {
        const cl = src.cloneNode(true), list = [src, ...all], cls = [cl, ...cl.querySelectorAll('*')];
        for (let i = 0; i < list.length; i++) { const c = getComputedStyle(list[i]), d = cls[i]; if (!d.style) continue; d.removeAttribute('id'); d.removeAttribute('class'); let t = ''; for (const p of PROPS) t += `${p}:${c.getPropertyValue(p)};`; d.setAttribute('style', t); if (d.tagName === 'IMG' || d.tagName === 'VIDEO' || d.tagName === 'CANVAS' || d.tagName === 'IFRAME') d.replaceWith(Object.assign(document.createElement('div'), { style: `${t}background:#8892a6` })); }
        cl.style.margin = '0'; cl.style.width = `${r.width}px`; cl.style.height = `${r.height}px`;
        const bg = cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? (getComputedStyle(document.body).backgroundColor || '#fff') : cs.backgroundColor; cl.style.backgroundColor = bg;
        const html = new XMLSerializer().serializeToString(cl);
        svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${r.width}" height="${r.height}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
      }
      const bg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : (getComputedStyle(document.body).getPropertyValue('--panel').trim() || '#1c2335');
      const title = (src.querySelector('h1,h2,h3,h4,b,strong,.title,header') || src).textContent.trim().replace(/\s+/g, ' ').slice(0, 40);
      return { rect: { x: r.left, y: r.top, w: r.width, h: r.height }, svg, bg, fg: cs.color, radius: parseFloat(cs.borderTopLeftRadius) || 10, title };
    } catch { return null; }
  }
  /** Une réplique dessinée (toujours lisible par le moteur) : fond, titre, lignes. */
  function replica(c) {
    const { w, h } = c.rect, k = document.createElement('canvas'); k.width = Math.round(w * DPR); k.height = Math.round(h * DPR); const g = k.getContext('2d'); g.scale(DPR, DPR);
    g.fillStyle = c.bg; g.beginPath(); g.roundRect(0, 0, w, h, Math.min(c.radius, 18)); g.fill();
    g.fillStyle = c.fg || '#e8ecf8'; g.globalAlpha = 0.9; g.font = '600 13px system-ui, sans-serif'; if (c.title) g.fillText(c.title, 12, Math.min(22, h - 6));
    g.globalAlpha = 0.25; for (let y = 34; y < h - 8; y += 16) g.fillRect(12, y, (w - 24) * (0.5 + ((y / 16) % 3) * 0.16), 6);
    g.globalAlpha = 1; return k;
  }
  function draw(c) {
    return new Promise((res) => {
      const alt = replica(c); if (!c.svg) { res({ img: alt, alt }); return; }
      const im = new Image(); const done = (ok) => { if (!ok) { res({ img: alt, alt }); return; } const k = document.createElement('canvas'); k.width = alt.width; k.height = alt.height; const g = k.getContext('2d'); try { g.drawImage(im, 0, 0, k.width, k.height); res({ img: k, alt }); } catch { res({ img: alt, alt }); } };
      im.onload = () => done(true); im.onerror = () => done(false); setTimeout(() => done(false), 600);
      im.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(c.svg)}`;
    });
  }
  function pixels(k) { try { return k.getContext('2d').getImageData(0, 0, k.width, k.height).data; } catch { return win.alt.getContext('2d').getImageData(0, 0, win.alt.width, win.alt.height).data; } }

  // ---------------------------------------------------------------- jouer un pouvoir sur un élément fermé
  /** `cap` : capture faite avant la fermeture ; `from` : la mascotte (point + élément). Résout quand c'est fini. */
  async function play(cap, id, from) {
    if (busy || reduce || !S[id] || !cap) return false;
    const pw = PW.find((p) => p[0] === id); if (!pw) return false;
    busy = true; mount();
    DPR = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    const { img, alt } = await draw(cap);
    Object.assign(win, { x: cap.rect.x, y: cap.rect.y, w: cap.rect.w, h: cap.rect.h, base: img, img: copyCanvas(img), alt, mode: 'show', alpha: 1 }); parts = [];
    // le double d'Odin, à la place de la mascotte (qu'on cache le temps du pouvoir)
    const m = from?.el, mr = m?.getBoundingClientRect(); heroSize = Math.round(Math.max(48, Math.min(96, mr?.width || 64)));
    const hx = mr ? mr.left + mr.width / 2 : Math.max(60, win.x - 140), hy = mr ? mr.top + mr.height / 2 : Math.min(H - 70, win.y + win.h);
    hero.style.left = `${hx - heroSize / 2}px`; hero.style.top = `${hy - heroSize / 2}px`; hero.style.transform = '';
    const vis = m ? m.style.visibility : ''; if (m) m.style.visibility = 'hidden';
    setHero(BASE); if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
    try { if (!NOFORM.has(id)) { await transform(pw[2]); await wait(200); } await S[id](); await wait(250); if (heroForm !== BASE) await revert(); await wait(250); }
    catch (e) { console.warn('pouvoir', id, e); }
    win.mode = 'gone'; hero.innerHTML = ''; if (m) m.style.visibility = vis; busy = false;
    return true;
  }
  window.OdinPowers3 = { has: (id) => !!S[id] && KEPT.has(id), ids: () => PW.filter((p) => KEPT.has(p[0])).map((p) => p[0]), names: () => Object.fromEntries(PW.filter((p) => KEPT.has(p[0])).map((p) => [p[0], p[1]])), capture, play, get busy() { return busy; } };
})();
