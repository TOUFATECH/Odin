// Odin, moteur de recherche des navigateurs : la description OpenSearch, les suggestions pendant la frappe, le mode
// d'emploi par navigateur, et le contrôle du retour après connexion. Rien ici ne lit ni n'écrit l'historique sans
// session, et rien de ce qui est tapé n'est gardé.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ModCtx } from '../valhalla/types.ts';
import { history } from '../valhalla/modules/volva.ts';
import { noterQuestion, questionsRecentes } from '../valhalla/volva/questions.ts';
import { CATEGORIES, entetes, type Categorie } from '../valhalla/volva/lyncee/types.ts';
import { chercherLyncee, type ReponseLyncee } from '../valhalla/volva/lyncee/meta.ts';
import { LIEN_RECHERCHE, NOM_MOTEUR, pageListe, STYLE_COMMUN } from './recherche-liste.ts';

export { LIEN_RECHERCHE, NOM_MOTEUR };

export const DESCRIPTION_MOTEUR = 'Recherche d\'Odin (Lyncée) : plusieurs moteurs, fusionnés chez toi';

const xml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const html = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** L'origine d'Odin telle qu'on peut l'écrire dans une page (schéma://hôte[:port]), sinon undefined. Pur. */
export function origineSure(origine: string | undefined): string | undefined {
  const o = String(origine ?? '');
  return /^https?:\/\/([A-Za-z0-9.-]{1,253}|\[[0-9A-Fa-f:.]{2,45}\])(:\d{1,5})?$/.test(o) ? o : undefined;
}

/** Le retour après connexion : seulement une page de recherche d'Odin (jamais //, jamais une autre adresse). Pur. */
export const SUITE_RE = /^\/recherche(\?[^#\\\s]*)?$/;
export const suiteSure = (chemin: string): boolean => SUITE_RE.test(chemin);

/** La description OpenSearch (origine déjà vérifiée par origineSure). Pur. */
export function descriptionOpenSearch(origine: string): string {
  const o = xml(origine);
  return `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>${xml(NOM_MOTEUR)}</ShortName>
  <Description>${xml(DESCRIPTION_MOTEUR)}</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <Language>fr-fr</Language>
  <Image height="192" width="192" type="image/png">${o}/icon-192.png</Image>
  <Url type="text/html" method="get" template="${o}/recherche?q={searchTerms}"/>
  <Url type="application/x-suggestions+json" template="${o}/api/recherche/suggestions?q={searchTerms}"/>
  <Url type="application/opensearchdescription+xml" rel="self" template="${o}/opensearch.xml"/>
</OpenSearchDescription>
`;
}

// ---- Suggestions pendant la frappe ----

export type SourceSuggestions = 'aucune' | 'wikipedia' | 'duckduckgo' | 'brave';
const SOURCES: Record<Exclude<SourceSuggestions, 'aucune'>, { url: (q: string) => string; genre: 'page' | 'api' }> = {
  wikipedia: { url: (q) => `https://fr.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=8&namespace=0&format=json`, genre: 'api' },
  duckduckgo: { url: (q) => `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&kl=fr-fr&type=list`, genre: 'page' },
  brave: { url: (q) => `https://search.brave.com/api/suggest?q=${encodeURIComponent(q)}&rich=false`, genre: 'page' },
};
export const sourceSuggestions = (ctx: ModCtx | undefined): SourceSuggestions => {
  const v = String(ctx?.settings.suggestions ?? 'wikipedia');
  return v === 'aucune' || v === 'duckduckgo' || v === 'brave' ? v : 'wikipedia';
};
const propre = (t: unknown) => String(t ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);

/** Les propositions d'une source ouverte (format OpenSearch [q, [..]], ou liste d'objets { phrase }). Pur. */
export function lireSuggestions(j: unknown): string[] {
  const l = Array.isArray(j) && Array.isArray(j[1]) ? j[1] as unknown[] : Array.isArray(j) ? j as unknown[] : [];
  return l.map((x) => propre(typeof x === 'string' ? x : (x as { phrase?: unknown } | null)?.phrase)).filter(Boolean);
}

/** Les questions déjà posées qui commencent comme la frappe (questions notées, puis l'historique de Pythie). */
export function suggestionsLocales(ctx: ModCtx, q: string): string[] {
  const d = q.toLocaleLowerCase('fr');
  let l: string[] = [];
  try { l = [...questionsRecentes(ctx).map((x) => x.q), ...history(ctx).map((h) => h.q)]; } catch { /* rien de noté */ }
  return l.map(propre).filter((x) => x && x.toLocaleLowerCase('fr').startsWith(d));
}
const unique = (l: string[], max: number) => { const vu = new Set<string>(), r: string[] = []; for (const x of l) { const k = x.toLocaleLowerCase('fr'); if (vu.has(k)) continue; vu.add(k); r.push(x); if (r.length >= max) break; } return r; };

const compteurs = new Map<string, { debut: number; n: number }>();
/** 60 demandes par minute et par adresse (au-delà : liste vide). */
export function suggestionPermise(ip: string, maintenant = Date.now()): boolean {
  if (compteurs.size > 5000) for (const [k, c] of compteurs) if (maintenant - c.debut > 60_000) compteurs.delete(k);
  const c = compteurs.get(ip);
  if (!c || maintenant - c.debut > 60_000) { compteurs.set(ip, { debut: maintenant, n: 1 }); return true; }
  c.n++; return c.n <= 60;
}
/** Pour les essais : remet les compteurs à zéro. */
export const oublierCompteurs = () => compteurs.clear();

/** GET /api/recherche/suggestions?q= : public ; l'historique seulement avec une session ; rien n'est enregistré. */
export async function suggestionsRoute(_req: IncomingMessage, res: ServerResponse, url: URL, d: { authed: boolean; ctx?: ModCtx; ip: string }): Promise<void> {
  const q = propre(url.searchParams.get('q')).slice(0, 100);
  const fin = (l: string[]) => { res.writeHead(200, { 'content-type': 'application/x-suggestions+json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }); res.end(JSON.stringify([q, unique(l, 8)])); };
  if (!q || !suggestionPermise(d.ip || '?')) return fin([]);
  const locales = d.authed && d.ctx ? suggestionsLocales(d.ctx, q) : [];
  const src = sourceSuggestions(d.ctx);
  if (src === 'aucune' || !d.ctx) return fin(locales);
  let distantes: string[] = [];
  try {
    const s = SOURCES[src], f = d.ctx.fetch as typeof fetch;
    const r = await f(s.url(q), { headers: entetes(s.genre), credentials: 'omit', redirect: 'manual', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(900) });
    if (r.ok) distantes = lireSuggestions(await r.json());
  } catch { /* source muette : la liste locale seule */ }
  fin([...locales, ...distantes]);
}

// ---- Le mode d'emploi ----

/** La page « Odin dans ton navigateur » : pas à pas, honnête sur ce que chaque navigateur permet. */
export function pageNavigateurs(origine: string, nonce: string): string {
  const o = html(origine), modele = `${o}/recherche?q=%s`, sugg = `${o}/api/recherche/suggestions?q=%s`;
  const copie = (id: string, texte: string) => `<div class="cp"><code id="${id}">${texte}</code><button type="button" data-copier="${id}">Copier</button></div>`;
  const chrome = `{
  "DefaultSearchProviderEnabled": true,
  "DefaultSearchProviderName": "${NOM_MOTEUR}",
  "DefaultSearchProviderKeyword": "odin",
  "DefaultSearchProviderSearchURL": "${o}/recherche?q={searchTerms}",
  "DefaultSearchProviderSuggestURL": "${o}/api/recherche/suggestions?q={searchTerms}"
}`;
  const firefox = `{
  "policies": {
    "SearchEngines": {
      "Add": [{ "Name": "${NOM_MOTEUR}", "URLTemplate": "${o}/recherche?q={searchTerms}", "SuggestURLTemplate": "${o}/api/recherche/suggestions?q={searchTerms}", "Alias": "odin" }],
      "Default": "${NOM_MOTEUR}"
    }
  }
}`;
  const https = /^https:/.test(origine);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0f1116"><title>Odin dans ton navigateur</title><link rel="icon" href="/favicon.svg">${LIEN_RECHERCHE}
<style>${STYLE_COMMUN}
main{max-width:860px;margin:0 auto;padding:18px 16px 40px;display:flex;flex-direction:column;gap:14px}
section{padding:16px 18px}h1{margin:4px 0 0;font-size:clamp(24px,3.2vw,32px);letter-spacing:-.02em}h2{margin:0 0 8px;font-size:17px}
ol,ul{margin:6px 0;padding-left:22px}li{margin:4px 0}.doux{color:var(--muted);font-size:14px}
.cp{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}.cp code{flex:1;min-width:0;overflow-wrap:anywhere;background:var(--soft);border-radius:10px;padding:8px 10px;font-size:13.5px}
pre.cp code{white-space:pre}pre.cp{display:block}pre.cp code{display:block;overflow:auto}
.cp button{border:1px solid var(--line);background:var(--glass2);border-radius:10px;padding:7px 12px;font-weight:600;cursor:pointer;color:var(--text);font:inherit}
#msg{min-height:1.4em;color:var(--acc);font-weight:600}kbd{background:var(--soft);border-radius:6px;padding:1px 6px;font:inherit;font-size:13px}
</style></head><body><main>
<header class="card" style="padding:16px 18px"><a href="/recherche" class="act">← Recherche</a><h1>Odin dans ton navigateur</h1><p class="doux">Choisis Odin comme moteur de recherche : ce que tu tapes dans la barre d'adresse part vers ton Odin, qui interroge lui-même plusieurs moteurs (Lyncée) et te montre la liste fusionnée. Il faut être connecté à Odin dans ce navigateur.</p><p id="msg" role="status" aria-live="polite"></p></header>
<section class="card"><h2>L'adresse à donner au navigateur</h2><p class="doux">Le <b>%s</b> est remplacé par ce que tu tapes.</p>${copie('modele', modele)}<p class="doux">Suggestions pendant la frappe (si le navigateur le demande) :</p>${copie('sugg', sugg)}<p class="doux">Raccourci conseillé : <b>odin</b>. Tape <kbd>odin</kbd> puis <kbd>Tab</kbd> (ou une espace dans Firefox) pour chercher avec Odin sans en faire le moteur par défaut.</p></section>
${https ? '' : '<section class="card"><h2>Attention : adresse en http</h2><p class="doux">Ton Odin répond ici sans chiffrement. Garde ce réglage pour le réseau de la maison : hors de chez toi, ce que tu tapes passerait en clair. Préfère l\'adresse https d\'Odin.</p></section>'}
<section class="card"><h2>Avant tout : le certificat d'Odin</h2><p class="doux">Si ton Odin utilise son propre certificat (installé sans nom de domaine), installe d'abord <a href="/odin-cert.crt" class="act">le certificat d'Odin</a> sur l'appareil. Sinon le navigateur refuse d'appeler Odin en arrière-plan : les suggestions ne s'affichent pas, sans aucun message.</p></section>
<section class="card"><h2>Chrome et Edge sur ordinateur</h2>
<p><b>Ajout à la main</b> (sans suggestions) :</p><ol><li>Ouvre les <b>Paramètres</b> du navigateur, puis <b>Moteur de recherche</b> (dans Edge : <b>Confidentialité, recherche et services</b> &gt; <b>Barre d'adresse et recherche</b>).</li><li><b>Gérer les moteurs de recherche et la recherche sur les sites</b>.</li><li>Dans <b>Recherche sur le site</b>, clique sur <b>Ajouter</b> : nom <b>Odin</b>, raccourci <b>odin</b>, adresse ci-dessus (avec %s).</li><li>Dans le menu ⋮ de la ligne Odin : <b>Utiliser par défaut</b>.</li></ol>
<p><b>Avec les suggestions</b> :</p><ol><li>Fais une recherche dans Odin depuis ce navigateur (la page de recherche d'Odin se fait connaître toute seule).</li><li>Retourne dans <b>Gérer les moteurs de recherche</b> : Odin est dans les <b>raccourcis inactifs</b>. Active-le.</li><li>Choisis-le <b>par défaut</b> dans son menu ⋮.</li></ol></section>
<section class="card"><h2>Chrome sur Android et iPhone</h2><ol><li>Fais d'abord une recherche dans Odin avec Chrome.</li><li>Paramètres de Chrome &gt; <b>Moteur de recherche</b> : choisis <b>Odin</b> dans les moteurs récemment visités.</li></ol><p class="doux">S'il n'apparaît pas, Chrome ne le propose pas encore sur ce téléphone : garde un raccourci de l'écran d'accueil vers la recherche d'Odin.</p></section>
<section class="card"><h2>Firefox</h2><ul><li>Dans la barre d'adresse, clique sur le bouton de recherche (la loupe) : un <b>+</b> propose d'<b>ajouter « Odin »</b>.</li><li>Ou clic droit dans le champ de recherche de la page d'Odin &gt; <b>Ajouter un moteur de recherche</b>.</li><li>Ou <b>Paramètres</b> &gt; <b>Recherche</b> &gt; <b>Ajouter</b> (Firefox 140 et plus) : nom Odin, adresse ci-dessus avec %s, mot-clé odin.</li><li>Puis choisis Odin comme <b>moteur par défaut</b> en haut de <b>Paramètres &gt; Recherche</b>.</li></ul><p><b>Firefox sur Android</b> : Paramètres &gt; <b>Recherche</b> &gt; <b>Moteur de recherche par défaut</b> &gt; <b>Ajouter</b>, avec l'adresse ci-dessus.</p></section>
<section class="card"><h2>Safari (Mac, iPhone, iPad)</h2><p>Safari ne permet pas d'ajouter son propre moteur : il ne propose qu'une courte liste imposée. Seule une extension de redirection installée à part pourrait le faire, et Odin ne t'en impose aucune.</p><p class="doux">À la place : ajoute la page de recherche d'Odin à l'écran d'accueil (bouton Partager &gt; Sur l'écran d'accueil), ou utilise Pégase, le navigateur d'Odin, qui cherche avec Odin dès qu'il y est relié.</p></section>
<section class="card"><h2>Pégase, le navigateur d'Odin</h2><p class="doux">Rien à faire : relié à Odin, Pégase cherche avec Odin, sauf si tu as choisi un autre moteur dans ses réglages (Réglages &gt; Moteur de recherche &gt; Pythie).</p></section>
<section class="card"><h2>Et la recherche de Windows ?</h2><p class="doux">La zone de recherche de la barre des tâches de Windows ne se règle pas : elle garde son propre moteur. Ce qui compte, c'est le moteur de ton navigateur, réglé ci-dessus.</p></section>
<section class="card"><h2>Pour un parc d'ordinateurs géré</h2><p class="doux">Seulement si tu gères des postes par stratégies : voici les réglages à reprendre dans ton outil de gestion. Odin n'écrit rien dans le registre ni dans les postes.</p><p><b>Chrome et Edge</b> (stratégies) :</p><pre class="cp"><code id="pol-chrome">${chrome}</code><button type="button" data-copier="pol-chrome">Copier</button></pre><p><b>Firefox</b> (policies.json) :</p><pre class="cp"><code id="pol-firefox">${firefox}</code><button type="button" data-copier="pol-firefox">Copier</button></pre></section>
</main><script nonce="${nonce}">
(() => {
  const msg = document.getElementById('msg');
  const dire = (t) => { msg.textContent = t; clearTimeout(dire.m); dire.m = setTimeout(() => { msg.textContent = ''; }, 4000); };
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copier]'); if (!b) return;
    const t = document.getElementById(b.dataset.copier)?.textContent ?? '';
    try { await navigator.clipboard.writeText(t); dire('Copié.'); }
    catch { const r = document.createRange(); r.selectNodeContents(document.getElementById(b.dataset.copier)); const s = getSelection(); s.removeAllRanges(); s.addRange(r); dire('Sélectionné : copie-le avec Ctrl+C.'); }
  });
})();
</script></body></html>`;
}

// ---- La page de résultats classique ----

/** Les paramètres de la page classique, relus et bornés. Pur. */
export function lireDemande(sp: URLSearchParams): { q: string; cat: Categorie; p: number } {
  const q = String(sp.get('q') ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
  const c = String(sp.get('cat') ?? 'web'), cat = (Object.hasOwn(CATEGORIES, c) ? c : 'web') as Categorie;
  const p = Math.min(10, Math.max(1, Math.trunc(Number(sp.get('p'))) || 1));
  return { q, cat, p };
}
/** L'adresse de retour après connexion, construite ici à partir des paramètres relus (jamais recopiée telle quelle). Pur. */
export function suiteDe(o: { q: string; cat: Categorie; p: number }): string {
  const sp = new URLSearchParams({ q: o.q }); if (o.cat !== 'web') sp.set('cat', o.cat); if (o.p > 1) sp.set('p', String(o.p));
  const chemin = `/recherche?${sp.toString()}`;
  return suiteSure(chemin) ? chemin : '/recherche';
}

/** GET /recherche?q=… (hors mode=pythie) : la liste fusionnée par Lyncée, sans script. Sans session : connexion puis retour. */
export async function pageClassiqueRoute(res: ServerResponse, url: URL, d: { authed: boolean; ctx?: ModCtx }): Promise<void> {
  const o = lireDemande(url.searchParams);
  if (!d.authed) { res.writeHead(302, { location: `/?suite=${encodeURIComponent(suiteDe(o))}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); res.end(); return; }
  const entete = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" };
  if (!d.ctx) { res.writeHead(503, entete); res.end('<!doctype html><meta charset="utf-8"><title>Odin</title><p>Pythie n\'est pas démarré : la recherche est indisponible.</p>'); return; }
  let r: ReponseLyncee;
  try {
    r = await chercherLyncee(o.q, { categorie: o.cat, page: o.p, n: o.cat === 'images' ? 40 : 20, fetcher: d.ctx.fetch as typeof fetch, delai: 3500, signal: AbortSignal.timeout(8000) });
  } catch (e) { r = { q: o.q, categorie: o.cat, page: o.p, resultats: [], moteurs: [], erreurs: [String((e as Error)?.message ?? e).slice(0, 200)], pauses: [], duCache: false, suivante: false }; }
  // Les questions servent aux suggestions (réglable) ; l'historique des réponses de Pythie n'est pas rempli ici.
  if (o.p === 1) { try { noterQuestion(d.ctx, o.q); } catch { /* disque plein : la recherche reste servie */ } }
  res.writeHead(200, entete); res.end(pageListe(r, o));
}
