// Les écrans avant le navigateur (maquettes « Démarrage », « Odin », « Compte », « Sauvegarde », « Connexion ») :
// logo et trois points, 1er lancement (Odin trouvé tout seul, connexion, restauration, « Ignorer »), création du compte,
// sauvegarde sur Odin (avec l'accord du propriétaire), choix du profil. Les mots de passe ne sont jamais réaffichés.
import type { Etat } from '../commun/types';
import { avatar } from './odin-visage';
import { LOGO, api, esc, type Ctx } from './commun';
import { I } from './icones';

let dernier = '';
let attente: { demande: string; code: string; adresse: string; minuterie: any } | null = null;

const etapes = (n: number, ignore = false) => `<ol class="etapes" aria-label="Étapes">${['Odin', 'Ton compte', 'C’est prêt'].map((t, i) => `<li class="${i + 1 === n ? 'actuelle' : i + 1 < n ? 'faite' : ''}"><span aria-hidden="true"></span>${i + 1} · ${t}${i === 0 && ignore ? ' (ignoré)' : ''}</li>`).join('')}</ol>`;
const tete = (titre: string, sous: string) => `<div class="tete-ecran">${LOGO(52)}<div><h1 id="t-ecran">${esc(titre)}</h1><span>${esc(sous)}</span></div></div>`;
const champMdp = (nom: string, label: string, auto: string) => `<label>${label}<span class="mdp"><input class="champ" type="password" name="${nom}" autocomplete="${auto}" required><button type="button" class="ib p" data-voir aria-label="Montrer le mot de passe" aria-pressed="false">${I.oeil(16)}</button></span></label>`;

/** Le bloc « Odin trouvé sur ton réseau » : adresse IP et port remplis tout seuls. */
function blocOdin(E: Etat): string {
  const t = E.premier?.trouves[0];
  let ip = '', port = '7777';
  if (t) { try { const u = new URL(t.adresse); ip = u.hostname.replace(/^\[|\]$/g, ''); port = u.port || '7777'; } catch { /* */ } }
  return `<div class="bloc-odin" data-adresse="${esc(t?.adresse ?? '')}">
    <div class="statut-odin" id="statut-odin">${statutOdin(E)}</div>
    <div class="ip-port"><label>Adresse IP d’Odin<input class="champ" name="hote" value="${esc(ip)}" inputmode="decimal" autocomplete="off" spellcheck="false"></label>
      <label>Port<input class="champ" name="port" value="${esc(port)}" inputmode="numeric" autocomplete="off"></label></div>
    <div class="rangee"><button type="button" class="bouton" data-tester>Tester</button><button type="button" class="bouton" data-chercher>Chercher Odin sur le réseau</button></div>
  </div>`;
}
function statutOdin(E: Etat): string {
  const t = E.premier?.trouves[0];
  if (t) return `<span class="ok-rond" aria-hidden="true">✓</span><div><b>Odin trouvé${/127\.0\.0\.1|localhost|\[::1\]/.test(t.adresse) ? ' sur ce PC' : ' sur ton réseau'}</b> <span class="doux">rempli tout seul</span><div class="doux petit">Connecté · ${esc(t.nom)} ${esc(t.version)} · le service de synchro ${t.comptes ? 'répond' : 'n’est pas démarré dans Odin'}.${t.empreinte ? ' Certificat retenu (épinglé).' : ''}</div></div>`;
  if (E.premier?.recherche) return `<span class="chargement" aria-hidden="true"></span><div><b>Recherche d’Odin sur ton réseau…</b><div class="doux petit">Si Odin est installé sur ce PC, rien à taper.</div></div>`;
  return `<span class="ko-rond" aria-hidden="true">?</span><div><b>Odin n’a pas été trouvé</b><div class="doux petit">Tape l’adresse IP du PC d’Odin (et son port), puis « Tester ».</div></div>`;
}

export function rendreEcran(E: Etat, ctx: Ctx): void {
  const el = document.getElementById('ecran')!;
  const cle = E.ecran;
  if (cle !== dernier) { dernier = cle; monter(el, E, ctx); }
  // Ce qui bouge sans refaire l'écran (les champs gardent ce qui est tapé).
  const st = el.querySelector('#statut-odin'); if (st) { const h = statutOdin(E); if (st.innerHTML !== h) st.innerHTML = h; }
  const b = el.querySelector<HTMLElement>('.bloc-odin');
  if (b && E.premier?.trouves[0] && b.dataset.adresse !== E.premier.trouves[0].adresse) {
    b.dataset.adresse = E.premier.trouves[0].adresse;
    try { const u = new URL(E.premier.trouves[0].adresse); (b.querySelector('[name=hote]') as HTMLInputElement).value = u.hostname.replace(/^\[|\]$/g, ''); (b.querySelector('[name=port]') as HTMLInputElement).value = u.port; } catch { /* */ }
  }
}

// Fond des écrans du 1er lancement : nuit noire, étoiles qui scintillent (quelques-unes brillent fort, les autres
// doucement) ; immobile si l'appareil demande moins d'animations. Les étoiles restent les mêmes d'un écran à l'autre.
type Etoile = { x: number; y: number; r: number; b: number; v: number; p: number; forte: boolean };
let etoiles: Etoile[] = [], anim = 0;
function ciel(el: HTMLElement): void {
  const c = el.querySelector('canvas.ciel') as HTMLCanvasElement | null; if (!c) return;
  const g = c.getContext('2d'); if (!g) return;
  if (!etoiles.length) for (let i = 0; i < 260; i++) { const forte = Math.random() < 0.07; etoiles.push({ x: Math.random(), y: Math.random(), r: forte ? 1.3 + Math.random() * 1.1 : 0.4 + Math.random() * 0.9, b: forte ? 0.85 : 0.25 + Math.random() * 0.45, v: 0.4 + Math.random() * 1.6, p: Math.random() * 6.3, forte }); }
  const calme = matchMedia('(prefers-reduced-motion: reduce)').matches;
  cancelAnimationFrame(anim);
  const dessiner = (t: number) => {
    if (!c.isConnected) return;
    const d = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
    g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
    for (const s of etoiles) {
      const sc = calme ? 1 : 0.55 + 0.45 * Math.sin(t / 1000 * s.v + s.p);
      const a = Math.min(1, s.b * (s.forte ? 0.6 + 0.4 * sc : sc)), x = s.x * w, y = s.y * h;
      if (s.forte) {
        const halo = g.createRadialGradient(x, y, 0, x, y, s.r * 7);
        halo.addColorStop(0, `rgba(210,225,255,${(a * 0.55).toFixed(3)})`); halo.addColorStop(1, 'rgba(210,225,255,0)');
        g.fillStyle = halo; g.beginPath(); g.arc(x, y, s.r * 7, 0, 6.2832); g.fill();
        g.strokeStyle = `rgba(255,255,255,${(a * 0.7).toFixed(3)})`; g.lineWidth = 0.8; const l = s.r * (4 + 3 * sc);
        g.beginPath(); g.moveTo(x - l, y); g.lineTo(x + l, y); g.moveTo(x, y - l); g.lineTo(x, y + l); g.stroke();
      }
      g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`; g.beginPath(); g.arc(x, y, s.r, 0, 6.2832); g.fill();
    }
    if (!calme) anim = requestAnimationFrame(dessiner);
  };
  anim = requestAnimationFrame(dessiner);
}

function monter(el: HTMLElement, E: Etat, ctx: Ctx): void {
  if (attente) { clearInterval(attente.minuterie); attente = null; }
  const e = E.ecran;
  if (e === 'navigateur') { el.innerHTML = ''; return; }
  if (e === 'demarrage') {
    el.innerHTML = `<div class="ecran" role="status" aria-label="Pégase démarre"><canvas class="ciel" aria-hidden="true"></canvas><div class="centre">${LOGO(112)}<div class="trois-points" aria-hidden="true"><span></span><span></span><span></span></div><p class="doux">Recherche d’Odin sur ton réseau…</p></div></div>`;
    ciel(el);
    return;
  }
  let corps = '';
  if (e === 'odin') {
    corps = `${tete('Retrouver ton profil', 'Pégase se connecte à Odin pour tout remettre comme avant.')}${etapes(1)}
      <form class="pile" novalidate data-ecran="odin">${blocOdin(E)}
        <label>Adresse e-mail<input class="champ" type="email" name="email" autocomplete="username" placeholder="ton adresse e-mail" required></label>
        ${champMdp('motdepasse', 'Mot de passe', 'current-password')}
        <label class="code-2fa" hidden>Code à 6 chiffres de ton appli d’authentification<input class="champ" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>
        <p class="erreur" role="alert" aria-live="assertive"></p>
        <div class="rangee boutons-ecran"><button class="bouton fort" type="submit">Restaurer mon profil</button><button class="bouton" type="button" data-ignorer="odin">Ignorer</button></div>
        <p class="note">Reviennent : ton profil, tes favoris, tes onglets, ton historique, ton agenda et tes réglages. Les cookies restent sur chaque PC. Le mot de passe ne s’affiche jamais et ne quitte pas ce PC en clair.</p>
      </form>`;
  } else if (e === 'compte') {
    corps = `${tete('Créer ton compte', 'Ton profil Pégase, rangé sur ce PC et sur Odin si tu veux.')}${etapes(2, true)}
      <form class="pile" novalidate data-ecran="compte">
        <label>Ton nom<input class="champ" name="nom" autocomplete="name" required value="${esc(E.premier?.compte?.nom ?? '')}"></label>
        <label>Adresse e-mail<input class="champ" type="email" name="email" autocomplete="email" value="${esc(E.premier?.compte?.email ?? '')}"></label>
        ${champMdp('motdepasse', 'Mot de passe', 'new-password')}
        ${champMdp('encore', 'Le même, encore', 'new-password')}
        <div class="solidite" aria-live="polite"><span class="jauge"><span></span></span><b>—</b></div>
        <p class="erreur" role="alert"></p>
        <div class="rangee boutons-ecran"><button class="bouton fort" type="submit">Créer mon compte</button><button class="bouton" type="button" data-ignorer="compte">Ignorer</button></div>
        <p class="note">« Ignorer » : tu navigues tout de suite avec un profil sur ce PC seulement. Tu pourras créer ton compte plus tard dans Réglages.</p>
      </form>`;
  } else if (e === 'sauvegarde') {
    const quoi: [string, string][] = [['Ton profil', 'nom, couleur'], ['Favoris', 'et dossiers'], ['Onglets et espaces', 'épinglés, bureaux'], ['Historique', 'pour demander à Odin'], ['Agenda', 'tes rendez-vous'], ['Réglages', 'couleurs, protection']];
    corps = `${tete('Sauvegarder ton profil sur Odin ?', 'Compte créé. Avec Odin, tu retrouves tout sur un autre PC ou sur ton téléphone.')}${etapes(3, true)}
      <form class="pile" novalidate data-ecran="sauvegarde"><h2 class="titre-ecran">Où est Odin ?</h2>${blocOdin(E)}
        <h2 class="titre-ecran">Ce qui part sur Odin</h2>
        <ul class="ce-qui-part">${quoi.map(([a, b]) => `<li><span class="ok-rond petit" aria-hidden="true">✓</span><b>${a}</b><span class="doux">${b}</span></li>`).join('')}<li><span class="ko-rond petit" aria-hidden="true">–</span><b>Cookies</b><span class="doux">restent sur ce PC</span></li></ul>
        <div class="attente-accord" hidden role="status"></div>
        <p class="erreur" role="alert"></p>
        <div class="rangee boutons-ecran"><button class="bouton fort" type="submit">Sauvegarder sur Odin</button><button class="bouton" type="button" data-ignorer="sauvegarde">Ignorer</button></div>
        <p class="note">Tout est chiffré avant de partir. « Ignorer » : ton profil reste sur ce PC ; tu peux brancher Odin plus tard dans Réglages → Synchro Odin.</p>
      </form>`;
  } else if (e === 'connexion') {
    const l = E.premier?.profilsPC ?? [];
    corps = `${tete('Qui navigue ?', 'Choisis ton profil.')}
      <div class="profils-pc" role="list">${l.map((x) => `<button class="carte-profil" role="listitem" data-profil="${esc(x.id)}">${avatar(x, 'grand')}<b>${esc(x.nom)}</b><span class="doux petit">${x.odin ? 'relié à Odin' : 'sur ce PC'}</span></button>`).join('')}</div>
      <div class="rangee boutons-ecran"><button class="bouton" data-vers="odin">Restaurer un profil depuis Odin</button><button class="bouton" data-ajouter>Ajouter un profil</button></div>`;
  }
  const fen = E.plateforme !== 'darwin' ? `<header class="fen-ecran"><button class="fen" data-a="fenetre" data-op="min" aria-label="Réduire">${I.min()}</button><button class="fen x" data-a="fenetre" data-op="fermer" aria-label="Fermer">${I.fermer()}</button></header>` : '';
  el.innerHTML = `<div class="ecran ecran-boite"><canvas class="ciel" aria-hidden="true"></canvas>${fen}<section class="boite-ecran large" aria-labelledby="t-ecran">${corps}</section></div>`;
  ciel(el);
  brancher(el, ctx);
  (el.querySelector('input:not([value]), input[value=""]') as HTMLInputElement | null)?.focus();
}

function brancher(el: HTMLElement, ctx: Ctx): void {
  const f = el.querySelector('form');
  const erreur = (t: string) => { const p = el.querySelector('.erreur'); if (p) p.textContent = t; };
  const adresse = (): string => {
    const h = (el.querySelector('[name=hote]') as HTMLInputElement | null)?.value.trim() ?? '';
    const port = (el.querySelector('[name=port]') as HTMLInputElement | null)?.value.trim() || '7777';
    const b = el.querySelector<HTMLElement>('.bloc-odin');
    if (b?.dataset.adresse) { try { const u = new URL(b.dataset.adresse); if (u.hostname.replace(/^\[|\]$/g, '') === h && u.port === port) return b.dataset.adresse; } catch { /* */ } }
    return h ? `https://${h.includes(':') ? `[${h}]` : h}:${port}` : '';
  };
  const occupe = (oui: boolean) => { for (const b of el.querySelectorAll<HTMLButtonElement>('button')) b.disabled = oui; };
  el.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
    if (b.hasAttribute('data-voir')) { const i = b.parentElement!.querySelector('input')!; const v = i.type === 'password'; i.type = v ? 'text' : 'password'; b.setAttribute('aria-pressed', String(v)); b.setAttribute('aria-label', v ? 'Cacher le mot de passe' : 'Montrer le mot de passe'); return; }
    if (b.dataset.ignorer) { await api.faire(`${b.dataset.ignorer}Ignorer`); return; }
    if (b.hasAttribute('data-chercher')) { erreur(''); await api.faire('odinChercher', {}); return; }
    if (b.hasAttribute('data-tester')) {
      const h = (el.querySelector('[name=hote]') as HTMLInputElement).value.trim(); if (!h) { erreur('Tape l’adresse IP du PC d’Odin.'); return; }
      occupe(true); const r = await api.faire('odinChercher', { hote: h, port: (el.querySelector('[name=port]') as HTMLInputElement).value }); occupe(false);
      erreur(r?.ok ? '' : r?.texte ?? 'Odin ne répond pas.'); return;
    }
    if (b.dataset.profil) { await api.faire('choisirProfil', { id: b.dataset.profil }); return; }
    if (b.dataset.vers) { await api.faire('ecranConnexion', { ecran: b.dataset.vers }); return; }
    if (b.hasAttribute('data-ajouter')) { await api.faire('ecranConnexion', { ecran: 'compte' }); return; }
  });
  if (!f) return;
  const mdp = f.querySelector<HTMLInputElement>('[name=motdepasse]');
  if (f.dataset.ecran === 'compte' && mdp) mdp.addEventListener('input', () => {
    const v = mdp.value; let s = 0;
    if (v.length >= 10) s++; if (v.length >= 14) s++; if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^\w\s]/.test(v) || /\s/.test(v)) s++;
    const n = v ? (v.length < 10 ? 0 : Math.min(3, Math.max(1, s - 1))) : -1;
    const so = f.querySelector<HTMLElement>('.solidite')!; so.dataset.n = String(n);
    so.querySelector('b')!.textContent = n < 0 ? '—' : ['Trop court (10 caractères au moins)', 'Moyen', 'Solide', 'Très solide'][n];
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); erreur('');
    // Nos propres messages, en français, à la place de la bulle du navigateur.
    const vide = [...f.querySelectorAll<HTMLInputElement>('input[required]')].find((i) => !i.value.trim());
    if (vide) { const nom = (vide.closest('label')?.firstChild?.textContent ?? '').trim(); erreur(nom ? `Remplis « ${nom} ».` : 'Remplis les champs.'); vide.focus(); return; }
    const mal = [...f.querySelectorAll<HTMLInputElement>('input[type=email]')].find((i) => i.value.trim() && !i.checkValidity());
    if (mal) { erreur('Cette adresse e-mail n’est pas valide.'); mal.focus(); return; }
    const d = Object.fromEntries(new FormData(f)) as Record<string, string>;
    if (f.dataset.ecran === 'odin') {
      const a = adresse(); if (!a) { erreur('Tape l’adresse IP d’Odin, ou attends qu’il soit trouvé.'); return; }
      occupe(true);
      const r = await api.faire('odinConnecter', { adresse: a, email: d.email, motdepasse: d.motdepasse, code: d.code || undefined });
      occupe(false);
      if (r?.ok) { ctx.toast('Profil retrouvé : tout revient depuis Odin.'); return; }
      if (r?.code === 'code_requis') { f.querySelector<HTMLElement>('.code-2fa')!.hidden = false; f.querySelector<HTMLInputElement>('[name=code]')!.focus(); }
      erreur(r?.texte ?? 'Odin ne répond pas.');
    } else if (f.dataset.ecran === 'compte') {
      if (d.motdepasse !== d.encore) { erreur('Les deux mots de passe ne sont pas pareils.'); return; }
      const r = await api.faire('compteCreer', { nom: d.nom, email: d.email, motdepasse: d.motdepasse });
      if (!r?.ok) erreur(r?.texte ?? 'Impossible de créer le compte.');
    } else if (f.dataset.ecran === 'sauvegarde') {
      const a = adresse(); if (!a) { erreur('Tape l’adresse IP d’Odin, ou cherche-le sur le réseau.'); return; }
      occupe(true);
      const r = await api.faire('sauvegarder', { adresse: a });
      if (r?.ok && r.etat === 'attente') {
        const z = f.querySelector<HTMLElement>('.attente-accord')!; z.hidden = false;
        z.innerHTML = `<span class="chargement" aria-hidden="true"></span><div><b>En attente de l’accord du propriétaire d’Odin</b><div class="doux petit">Il vient d’être prévenu. Le code affiché chez lui doit être : <b class="code-accord">${esc(r.code)}</b></div></div>`;
        attente = { demande: r.demande, code: r.code, adresse: a, minuterie: setInterval(async () => {
          const s = await api.faire('sauvegardeEtat', { adresse: a, demande: attente?.demande });
          if (s?.etat === 'attente') return;
          if (attente) clearInterval(attente.minuterie); attente = null; occupe(false); z.hidden = true;
          if (s?.ok && s.etat === 'ok') ctx.toast('Compte créé sur Odin : ton profil y est sauvegardé.');
          else erreur(s?.texte ?? 'La demande n’a pas abouti.');
        }, 2000) };
        return;
      }
      occupe(false);
      if (!r?.ok) erreur(r?.texte ?? 'Odin ne répond pas.');
    }
  });
}
