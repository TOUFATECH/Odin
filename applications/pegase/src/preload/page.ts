/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// Ce que Pégase met dans chaque page web pour ses mots de passe, dans le MONDE ISOLÉ de Pégase (bac à sable,
// contextIsolation) : la page ne voit rien d'ici (aucun contextBridge, aucune variable partagée).
// - Après une connexion (geste réel : clic ou Entrée), Pégase propose d'enregistrer le mot de passe.
// - Une petite clé apparaît dans le champ du mot de passe s'il y a quelque chose d'enregistré pour CE site exact ;
//   le remplissage ne se fait qu'au clic réel sur la clé (le processus principal vérifie aussi l'origine et le geste).
import { ipcRenderer } from 'electron';

const web = /^https?:$/.test(location.protocol);
type Cle = { id: string; identifiant: string };

function visible(el: HTMLElement): boolean { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 8 && getComputedStyle(el).visibility !== 'hidden'; }
function champIdentifiant(mdp: HTMLInputElement): HTMLInputElement | null {
  const racine = mdp.form ?? document;
  const l = [...racine.querySelectorAll<HTMLInputElement>('input')].filter((i) => /^(text|email|tel|)$/.test(i.type) && visible(i));
  const avant = l.filter((i) => i.compareDocumentPosition(mdp) & Node.DOCUMENT_POSITION_FOLLOWING);
  return l.find((i) => /username|email/.test(i.autocomplete)) ?? avant.at(-1) ?? l[0] ?? null;
}
function ecrire(i: HTMLInputElement, v: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  set ? set.call(i, v) : (i.value = v);
  i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true }));
}

if (web) {
  // ————— 1) Proposer d'enregistrer après une connexion —————
  let dernierEnvoi = 0;
  const capter = (racine: ParentNode | null) => {
    const mdp = [...(racine ?? document).querySelectorAll<HTMLInputElement>('input[type=password]')].find((i) => i.value && visible(i));
    if (!mdp || Date.now() - dernierEnvoi < 800) return;
    dernierEnvoi = Date.now();
    const id = champIdentifiant(mdp);
    ipcRenderer.send('pegase:mdp-soumis', { identifiant: (id?.value ?? '').slice(0, 300), motdepasse: mdp.value.slice(0, 1000) });
  };
  document.addEventListener('submit', (e) => { if (e.isTrusted) capter(e.target as HTMLFormElement); }, true);
  document.addEventListener('keydown', (e) => { if (e.isTrusted && e.key === 'Enter' && (e.target as HTMLInputElement)?.type === 'password') capter((e.target as HTMLInputElement).form ?? document); }, true);
  document.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    const b = (e.target as HTMLElement)?.closest?.('button, input[type=submit], [role=button]') as HTMLElement | null;
    if (b && !b.closest('[data-pegase-cle]')) capter((b as HTMLButtonElement).form ?? b.closest('form') ?? document);
  }, true);

  // ————— 2) La clé dans le champ —————
  let hote: HTMLElement | null = null; let ombre: ShadowRoot | null = null; let cible: HTMLInputElement | null = null; let cles: Cle[] = [];
  const fermer = () => { hote?.remove(); hote = null; ombre = null; };
  const placer = () => {
    if (!hote || !cible) return;
    const r = cible.getBoundingClientRect();
    hote.style.cssText = `position:fixed!important;z-index:2147483647!important;left:${Math.round(r.right - 30)}px!important;top:${Math.round(r.top + (r.height - 24) / 2)}px!important;width:24px!important;height:24px!important;margin:0!important;padding:0!important;border:0!important;display:block!important`;
  };
  const montrerMenu = () => {
    if (!ombre || !cible) return;
    const r = cible.getBoundingClientRect();
    const m = document.createElement('div'); m.className = 'menu'; m.setAttribute('role', 'menu');
    m.style.cssText = `left:${Math.round(Math.min(innerWidth - 300, r.left) - (r.right - 30))}px;top:30px`;
    const t = document.createElement('div'); t.className = 't'; t.textContent = `Enregistré pour ${location.hostname}`; m.appendChild(t);
    for (const c of cles) { const b = document.createElement('button'); b.setAttribute('role', 'menuitem'); b.textContent = c.identifiant || '(sans identifiant)'; b.dataset.id = c.id; m.appendChild(b); }
    const g = document.createElement('button'); g.setAttribute('role', 'menuitem'); g.textContent = 'Créer un mot de passe fort'; g.dataset.generer = '1'; m.appendChild(g);
    const k = document.createElement('button'); k.setAttribute('role', 'menuitem'); k.textContent = 'Gérer les mots de passe'; k.dataset.gerer = '1'; m.appendChild(k);
    ombre.querySelector('.menu')?.remove(); ombre.appendChild(m);
  };
  const montrerCle = async (i: HTMLInputElement) => {
    cible = i;
    cles = await ipcRenderer.invoke('pegase:mdp-cles').catch(() => []) as Cle[];
    if (!cles.length && i.type !== 'password') { fermer(); return; }
    if (!hote) {
      hote = document.createElement('pegase-cle'); hote.setAttribute('data-pegase-cle', '');
      ombre = hote.attachShadow({ mode: 'closed' });
      ombre.innerHTML = `<style>:host{all:initial}button{font:13px system-ui,sans-serif}
        .k{all:unset;width:24px;height:24px;display:grid;place-items:center;border-radius:6px;cursor:pointer;background:#4B5AE0;color:#fff}
        .menu{position:absolute;min-width:260px;background:#1E1F2A;color:#F2F3FA;border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:6px;box-shadow:0 18px 40px rgba(0,0,0,.4);display:flex;flex-direction:column}
        .menu .t{font:600 12px system-ui;color:rgba(242,243,250,.7);padding:6px 8px}
        .menu button{all:unset;font:14px system-ui;padding:8px;border-radius:8px;cursor:pointer}.menu button:hover,.menu button:focus{background:rgba(255,255,255,.1)}</style>
        <button class="k" aria-label="Mots de passe de Pégase" title="Mots de passe de Pégase"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/></svg></button>`;
      ombre.addEventListener('click', async (e) => {
        if (!e.isTrusted) return; // un clic simulé par la page ne remplit jamais rien
        const b = (e.composedPath()[0] as HTMLElement).closest?.('button') as HTMLButtonElement | null; if (!b) return;
        e.preventDefault(); e.stopPropagation();
        if (b.classList.contains('k')) { if (ombre?.querySelector('.menu')) ombre.querySelector('.menu')!.remove(); else montrerMenu(); return; }
        if (b.dataset.gerer) { ipcRenderer.send('pegase:mdp-gerer'); fermer(); return; }
        if (b.dataset.generer) {
          const v = await ipcRenderer.invoke('pegase:mdp-generer') as string | null; if (!v) return;
          const champs = [...document.querySelectorAll<HTMLInputElement>('input[type=password]')].filter(visible);
          for (const c of (champs.length ? champs.filter((x) => !x.value || x === cible) : [])) ecrire(c, v);
          fermer(); return;
        }
        if (b.dataset.id) {
          const r = await ipcRenderer.invoke('pegase:mdp-remplir', b.dataset.id) as { identifiant: string; motdepasse: string } | null;
          if (!r || !cible) { fermer(); return; }
          const mdp = cible.type === 'password' ? cible : [...(cible.form ?? document).querySelectorAll<HTMLInputElement>('input[type=password]')].find(visible) ?? null;
          const id = mdp ? champIdentifiant(mdp) : cible;
          if (id && r.identifiant) ecrire(id, r.identifiant);
          if (mdp) ecrire(mdp, r.motdepasse);
          fermer();
        }
      }, true);
      document.documentElement.appendChild(hote);
    }
    placer();
  };
  document.addEventListener('focusin', (e) => {
    const i = e.target as HTMLInputElement;
    if (!e.isTrusted || !(i instanceof HTMLInputElement)) return;
    if (i.type === 'password' || ((/^(text|email|)$/.test(i.type)) && /username|email/.test(i.autocomplete))) void montrerCle(i);
  }, true);
  document.addEventListener('focusout', (e) => { const r = e.relatedTarget as Node | null; if (hote && r !== hote && !hote.contains(r)) setTimeout(() => { if (document.activeElement !== hote) fermer(); }, 200); }, true);
  addEventListener('scroll', placer, true); addEventListener('resize', placer);
}
