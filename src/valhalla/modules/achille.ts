// Achille — tester la sécurité de TES PROPRES sites et appareils (comme on le ferait avec un proxy d'interception).
// Un proxy d'essai qu'on allume à la demande (et qui s'éteint tout seul), l'historique des requêtes de tes appareils,
// rejouer une requête modifiée, comparer deux réponses, encoder et décoder, et la recherche PASSIVE des défauts
// courants (en-têtes de sécurité, cookies, formulaires, versions exposées, certificat).
//
// Garde-fous (docs/achille-garde-fous.md) : seulement le réseau de la maison et les domaines que tu as déclarés ET
// prouvés ; toute autre cible est refusée et notée au journal ; aucun scanner actif, aucune liste d'attaque, aucun
// essai en rafale (rejeu : une requête par seconde, 300 par jour au plus) ; journal de tout ce qui est testé.
import { writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import type { Action, Module, ModCtx, RythmeAppli, Section, Tone } from '../types.ts';
import { journalDe } from '../base/journal.ts';
import { tacheEnPause } from '../automatismes.ts';
import { prochaine, type Rythme } from '../../draupnir/rythme.ts';
import { adresseMaison, dansLaPortee, domainePropre, nouveauJeton, nu, RESOLVEUR_SYSTEME, verifierPreuve, type Domaine, type Resolveur } from '../achille/portee.ts';
import { autorite, certificatAutorite } from '../achille/ca.ts';
import { comparer, decoder, encoder, FORMATS, lireJwt, masquerEntetes, masquerUrl, type Format } from '../achille/outils.ts';
import { envoyer, ligneDe, ProxyAchille, type Connecter, type Echange, type LigneJournal } from '../achille/proxy.ts';
import { portDuLien, REFUS_ODIN, versOdinLuiMeme } from '../boucle.ts';

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
export const PORT_PROXY = 8890, REJEUX_PAR_JOUR = 300;
const O = { P: 'Proxy', E: 'Échanges', D: 'Défauts', T: 'Outils' } as const;

// ---------------------------------------------------------------- Réseau (injectable pour les essais)
let reseau: { resoudre: Resolveur; connecter?: Connecter; fetch?: typeof fetch; machine?: Set<string> } = { resoudre: RESOLVEUR_SYSTEME };
/** Les essais remplacent la résolution DNS, la connexion et la lecture du fichier de preuve. */
export function reseauAchille(o: { resoudre?: Resolveur; connecter?: Connecter; fetch?: typeof fetch; machine?: Set<string> } = {}): void { reseau = { resoudre: o.resoudre ?? RESOLVEUR_SYSTEME, ...(o.connecter ? { connecter: o.connecter } : {}), ...(o.fetch ? { fetch: o.fetch } : {}), ...(o.machine ? { machine: o.machine } : {}) }; }

// ---------------------------------------------------------------- Réglages
const domaines = (ctx: ModCtx): Domaine[] => (Array.isArray(ctx.settings.domaines) ? ctx.settings.domaines as Domaine[] : []);
const appareils = (ctx: ModCtx): string[] => (Array.isArray(ctx.settings.appareils) ? (ctx.settings.appareils as string[]).map(String) : []);
const dureeH = (ctx: ModCtx) => Math.min(12, Math.max(0.05, Number(ctx.settings.dureeH) || 2));
const journal = (ctx: ModCtx) => journalDe<LigneJournal>(ctx, 'achille', 'journal.jsonl', { garder: 5000 });
const prouves = (ctx: ModCtx) => domaines(ctx).filter((d) => d.prouve).map((d) => d.nom);
const portee = (ctx: ModCtx) => (h: string) => dansLaPortee(h, { domaines: domaines(ctx), resoudre: reseau.resoudre });
function ca(ctx: ModCtx) {
  const a = autorite(ctx.dir, ctx.home, prouves(ctx));
  if (a.refaite && ctx.settings.caFaite) ctx.saveSettings({ caAReinstaller: true });
  if (!ctx.settings.caFaite) ctx.saveSettings({ caFaite: true });
  return a;
}
function noter(ctx: ModCtx, l: LigneJournal): void {
  journal(ctx).ajouter(l);
  if (l.genre === 'refus') ctx.emit('refus_hors_portee', { url: l.url ?? '', raison: l.raison ?? '' });
}
function surEchange(ctx: ModCtx, e: Echange): void {
  const vus = new Set(Array.isArray(ctx.settings.defautsVus) ? ctx.settings.defautsVus as string[] : []), hote = (() => { try { return new URL(e.url).host; } catch { return '?'; } })();
  let neuf = false;
  for (const d of e.defauts) { const k = `${hote}|${d.code}`; if (vus.has(k)) continue; vus.add(k); neuf = true; ctx.emit('defaut_trouve', { hote, code: d.code, niveau: d.niveau, titre: d.titre }); }
  if (neuf) ctx.saveSettings({ defautsVus: [...vus].slice(-500) });
  const tous = (ctx.settings.defauts as Record<string, Array<{ code: string; niveau: string; titre: string; conseil: string; vu: string }>> | undefined) ?? {};
  tous[hote] = e.defauts.map((d) => ({ ...d, vu: e.at })).slice(0, 30);
  ctx.saveSettings({ defauts: Object.fromEntries(Object.entries(tous).slice(-100)) });
}

// ---------------------------------------------------------------- Le proxy (un seul pour Odin)
let proxy: ProxyAchille | undefined;
function leProxy(ctx: ModCtx): ProxyAchille {
  proxy ??= new ProxyAchille({
    port: Number(ctx.settings.portProxy ?? PORT_PROXY), hote: s(ctx.settings.ecoute) || '0.0.0.0',
    portee: portee(ctx), appareils: () => appareils(ctx), autorite: () => ca(ctx),
    noter: (l) => noter(ctx, l), surEchange: (e) => surEchange(ctx, e),
    surArret: (pourquoi) => ctx.emit('proxy_eteint', { pourquoi }),
    ...(reseau.connecter ? { connecter: reseau.connecter } : {}),
  });
  return proxy;
}
/** Pour les essais : le proxy en cours. */
export const proxyAchille = () => proxy;

// ---------------------------------------------------------------- Rejeu (limité)
let dernierRejeu = 0;
const jour = (d: Date) => d.toISOString().slice(0, 10);
function entetesDeTexte(t: string): Record<string, string> {
  const h: Record<string, string> = {};
  for (const l of t.split('\n')) { const m = /^\s*([!#$%&'*+.^_`|~0-9A-Za-z-]+)\s*:\s*(.*)$/.exec(l); if (m) h[m[1].toLowerCase()] = m[2].trim(); }
  return h;
}
const memEchange = (id: unknown) => proxy?.echanges.find((e) => e.id === s(id));
const resume = (e: Echange) => `${e.methode} ${masquerUrl(e.url)} → ${e.code} (${e.ms} ms, ${e.taille} octets)`;

// ---------------------------------------------------------------- Contrôle passif planifié
const RYTHME_DEFAUT: RythmeAppli = { genre: 'semaine', jours: [1], heure: '05:00' };
const rythmeControle = (ctx: ModCtx): RythmeAppli => (ctx.settings.rythmeControle as RythmeAppli | undefined) ?? RYTHME_DEFAUT;
function duControle(ctx: ModCtx, now: Date): boolean {
  const depuis = Date.parse(s(ctx.settings.controleA) || s(ctx.settings.cree));
  if (!Number.isFinite(depuis)) { ctx.saveSettings({ cree: now.toISOString() }); return false; }
  const p = prochaine(rythmeControle(ctx) as Rythme, new Date(depuis));
  return Boolean(p && p.getTime() <= now.getTime());
}
async function controlePassif(ctx: ModCtx): Promise<string> {
  const l: string[] = [];
  for (const d of domaines(ctx).filter((x) => x.prouve)) {
    const url = `https://${d.nom}/`;
    try {
      const p = await dansLaPortee(d.nom, { domaines: domaines(ctx), resoudre: reseau.resoudre });
      if (!p.ok) { noter(ctx, { at: ctx.now().toISOString(), genre: 'refus', url, raison: p.raison }); l.push(`${d.nom} : refusé (${p.raison})`); continue; }
      const e = await envoyer({ methode: 'GET', url, entetes: { 'user-agent': 'Odin-Achille (contrôle passif)', accept: 'text/html' } }, p, { ...(reseau.connecter ? { connecter: reseau.connecter } : {}) });
      noter(ctx, { ...ligneDe(e), genre: 'echange', raison: 'contrôle passif' }); surEchange(ctx, e);
      l.push(`${d.nom} : ${e.defauts.length ? `${e.defauts.length} défaut(s)` : 'rien à signaler'}`);
    } catch (err) { noter(ctx, { at: ctx.now().toISOString(), genre: 'erreur', url, raison: (err as Error).message.slice(0, 200) }); l.push(`${d.nom} : ${(err as Error).message}`); }
  }
  ctx.saveSettings({ controleA: ctx.now().toISOString() });
  noter(ctx, { at: ctx.now().toISOString(), genre: 'controle', texte: l.join(' · ') || 'aucun domaine prouvé' });
  return l.length ? l.join('\n') : 'Aucun domaine déclaré et prouvé : rien à contrôler.';
}

// ---------------------------------------------------------------- Actions
const P_DOMAINE = { key: 'domaine', label: 'Domaine (ex. monsite.fr)', kind: 'text' as const, required: true };
const actions: Action[] = [
  { id: 'allumer_proxy', label: 'Allumer le proxy d\'essai', what: 'Le proxy écoute (port 8890) pour tes appareils autorisés, puis s\'éteint tout seul', params: [{ key: 'duree_h', label: 'Durée (heures)', kind: 'number', default: 2 }],
    grave: (i, ctx) => `allumer le proxy d'essai d'Achille (port ${Number(ctx?.settings.portProxy ?? PORT_PROXY)}) pour ${Number(i.duree_h) || (ctx ? dureeH(ctx) : 2)} h : tes appareils autorisés pourront y faire passer leurs requêtes`,
    words: ['intercepte les requetes', 'intercepter les requetes'],
    run: async (ctx, i) => {
      const h = Math.min(12, Math.max(0.01, Number(i.duree_h) || dureeH(ctx)));
      ca(ctx);
      const port = await leProxy(ctx).allumer(h * 3600_000);
      ctx.emit('proxy_allume', { port, heures: h });
      return { text: `🛡 Proxy d'essai allumé sur le port ${port} pour ${h} h. Règle le proxy de ton appareil sur l'adresse d'Odin, port ${port}, et installe le certificat d'Achille (bouton « Certificat »). Toute cible hors de ta portée sera refusée.`, data: { port } };
    } },
  { id: 'eteindre_proxy', label: 'Éteindre le proxy', what: 'Le proxy d\'essai s\'arrête tout de suite', run: (ctx) => { if (!proxy?.allume) return { text: 'Le proxy d\'essai est déjà éteint.' }; proxy.eteindre('à la demande'); return { text: '⏹ Proxy d\'essai éteint.' }; } },
  { id: 'declarer_domaine', label: 'Déclarer un de mes domaines', what: 'Achille te donne un jeton à publier pour prouver que le domaine est à toi', params: [P_DOMAINE],
    grave: (i) => `déclarer le domaine « ${s(i.domaine)} » comme t'appartenant (il ne sera testé qu'après la preuve)`,
    run: (ctx, i) => {
      const nom = domainePropre(i.domaine), l = domaines(ctx), deja = l.find((d) => d.nom === nom);
      const d: Domaine = deja ?? { nom, jeton: nouveauJeton(), declare: ctx.now().toISOString() };
      if (!deja) ctx.saveSettings({ domaines: [...l, d] });
      noter(ctx, { at: ctx.now().toISOString(), genre: 'domaine', texte: `domaine déclaré : ${nom}` });
      return { text: `📝 Pour prouver que ${nom} est à toi, publie ce jeton, au choix :\n- un enregistrement DNS TXT nommé _odin-achille.${nom} avec la valeur ${d.jeton}\n- ou un fichier https://${nom}/.well-known/odin-achille.txt qui contient ${d.jeton}\nPuis lance « Vérifier la preuve ».`, data: { domaine: nom, jeton: d.jeton } };
    } },
  { id: 'verifier_domaine', label: 'Vérifier la preuve', what: 'Lit l\'enregistrement TXT ou le fichier .well-known du domaine', params: [P_DOMAINE],
    grave: (i) => `vérifier la preuve de « ${s(i.domaine)} » (une lecture DNS et une requête vers ce site)`,
    run: async (ctx, i) => {
      const nom = domainePropre(i.domaine), l = domaines(ctx), d = l.find((x) => x.nom === nom);
      if (!d) return { ok: false, text: `${nom} n'est pas déclaré : commence par « Déclarer un de mes domaines ».` };
      const r = await verifierPreuve(d, { resoudre: reseau.resoudre, ...(reseau.fetch ? { fetch: reseau.fetch } : { fetch: ctx.fetch }) });
      if (!r.ok) { noter(ctx, { at: ctx.now().toISOString(), genre: 'domaine', texte: `preuve absente : ${nom}` }); return { ok: false, text: `✗ ${nom} : ${r.texte}.` }; }
      ctx.saveSettings({ domaines: l.map((x) => (x.nom === nom ? { ...x, prouve: ctx.now().toISOString(), par: r.par } : x)) });
      noter(ctx, { at: ctx.now().toISOString(), genre: 'domaine', texte: `domaine prouvé (${r.par}) : ${nom}` });
      ca(ctx);
      return { text: `✅ ${nom} est prouvé (${r.texte}). Il entre dans ta portée, ses sous-domaines aussi. L'autorité d'Achille a été refaite : réinstalle son certificat sur tes appareils.` };
    } },
  { id: 'retirer_domaine', label: 'Retirer un domaine', what: 'Le domaine sort de ta portée', params: [P_DOMAINE],
    run: (ctx, i) => {
      const nom = s(i.domaine).toLowerCase(), l = domaines(ctx);
      if (!l.some((d) => d.nom === nom)) return { ok: false, text: `${nom} n'est pas dans la liste.` };
      ctx.saveSettings({ domaines: l.filter((d) => d.nom !== nom) });
      noter(ctx, { at: ctx.now().toISOString(), genre: 'domaine', texte: `domaine retiré : ${nom}` });
      return { text: `🗑 ${nom} n'est plus dans ta portée.` };
    } },
  { id: 'ajouter_appareil', label: 'Autoriser un appareil', what: 'L\'adresse IP d\'un de tes appareils qui pourra passer par le proxy d\'essai', params: [{ key: 'adresse', label: 'Adresse IP de l\'appareil (ex. 192.168.1.20)', kind: 'text', required: true }],
    grave: (i) => `autoriser l'appareil ${s(i.adresse)} à passer par le proxy d'essai`,
    run: (ctx, i) => {
      const a = nu(s(i.adresse));
      if (!isIP(a) || !adresseMaison(a)) return { ok: false, text: 'Donne l\'adresse IP d\'un appareil de ta maison (ex. 192.168.1.20).' };
      if (!appareils(ctx).includes(a)) ctx.saveSettings({ appareils: [...appareils(ctx), a] });
      noter(ctx, { at: ctx.now().toISOString(), genre: 'appareil', texte: `appareil autorisé : ${a}` });
      return { text: `📱 ${a} peut passer par le proxy d'essai.` };
    } },
  { id: 'retirer_appareil', label: 'Retirer un appareil', what: 'L\'appareil ne peut plus passer par le proxy d\'essai', params: [{ key: 'adresse', label: 'Adresse IP', kind: 'text', required: true }],
    run: (ctx, i) => { const a = nu(s(i.adresse)); ctx.saveSettings({ appareils: appareils(ctx).filter((x) => x !== a) }); noter(ctx, { at: ctx.now().toISOString(), genre: 'appareil', texte: `appareil retiré : ${a}` }); return { text: `🗑 ${a} n'est plus autorisé.` }; } },
  { id: 'rejouer', label: 'Rejouer une requête', what: 'Renvoie une requête (modifiée ou non) vers un de tes sites : une par seconde, 300 par jour au plus',
    params: [{ key: 'id', label: 'Échange de départ (vide : nouvelle requête)', kind: 'text', default: '' }, { key: 'methode', label: 'Méthode', kind: 'select', options: ['', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'], default: '' }, { key: 'url', label: 'Lien (vide : celui de l\'échange)', kind: 'text', default: '' }, { key: 'entetes', label: 'En-têtes (un par ligne, « Nom: valeur » ; vide : ceux de l\'échange)', kind: 'textarea', default: '' }, { key: 'corps', label: 'Corps', kind: 'textarea', default: '' }],
    grave: (i) => `envoyer une requête ${s(i.methode) || 'rejouée'} vers ${s(i.url) || `l'échange ${s(i.id)}`}`,
    run: async (ctx, i) => {
      const now = ctx.now(), base = memEchange(i.id);
      if (s(i.id) && !base) return { ok: false, text: 'Cet échange n\'est plus en mémoire (seuls les 200 derniers y restent).' };
      const url = s(i.url) || base?.url || '';
      let u: URL; try { u = new URL(url); } catch { return { ok: false, text: 'Lien invalide (http:// ou https://).' }; }
      if (!/^https?:$/.test(u.protocol) || u.username || u.password) return { ok: false, text: 'Lien http ou https, sans identifiant écrit dedans.' };
      if (Date.now() - dernierRejeu < 1000) return { ok: false, text: 'Une requête par seconde au plus : attends un instant.' };
      const compte = ctx.settings.rejeux as { jour: string; n: number } | undefined, n = compte?.jour === jour(now) ? compte.n : 0;
      if (n >= REJEUX_PAR_JOUR) return { ok: false, text: `Plafond atteint : ${REJEUX_PAR_JOUR} rejeux par jour. Achille n'envoie pas de rafales.` };
      // Le rejeu accepte un service en essai sur cette machine (localhost), jamais les ports d'Odin lui-même.
      const p = await dansLaPortee(u.hostname, { domaines: domaines(ctx), resoudre: reseau.resoudre, boucle: true });
      const versOdin = p.ok && versOdinLuiMeme([nu(u.hostname), p.adresse ?? ''], portDuLien(u), reseau.machine);
      if (!p.ok || versOdin) { const raison = versOdin ? REFUS_ODIN : p.raison; noter(ctx, { at: now.toISOString(), genre: 'refus', url: masquerUrl(url), raison }); return { ok: false, text: `Refusé : ${versOdin ? raison : `hors de ta portée (${raison})`}.` }; }
      dernierRejeu = Date.now(); ctx.saveSettings({ rejeux: { jour: jour(now), n: n + 1 } });
      const entetes = s(i.entetes) ? entetesDeTexte(s(i.entetes)) : base?.entetesReq ?? {};
      const corps = s(i.corps) ? Buffer.from(String(i.corps), 'utf8') : base?.corpsReq;
      const e = await envoyer({ methode: s(i.methode) || base?.methode || 'GET', url: u.toString(), entetes, ...(corps ? { corps } : {}) }, p, { ...(reseau.connecter ? { connecter: reseau.connecter } : {}) });
      e.rejeu = true;
      const px = leProxy(ctx); px.echanges.push(e); if (px.echanges.length > 200) px.echanges.shift();
      noter(ctx, ligneDe(e, 'rejeu')); surEchange(ctx, e);
      return { text: `↻ ${resume(e)}${e.defauts.length ? ` · ${e.defauts.length} défaut(s)` : ''}`, data: { id: e.id, code: e.code } };
    } },
  { id: 'historique', label: 'Historique des requêtes', what: 'Les derniers échanges vus par le proxy (en-têtes secrets masqués)', read: true, external: true,
    run: () => { const l = (proxy?.echanges ?? []).slice(-30).reverse(); return { text: l.length ? l.map((e) => `${e.id} · ${resume(e)}`).join('\n') : 'Aucun échange en mémoire.', data: l.map((e) => ({ id: e.id, methode: e.methode, url: masquerUrl(e.url), code: e.code })) }; } },
  { id: 'echange', label: 'Voir un échange', what: 'Requête et réponse : en-têtes (secrets masqués) et début du corps', read: true, external: true, params: [{ key: 'id', label: 'Échange', kind: 'text', required: true }],
    run: (_ctx, i) => {
      const e = memEchange(i.id); if (!e) return { ok: false, text: 'Cet échange n\'est plus en mémoire.' };
      const h = (x: Record<string, string>) => Object.entries(x).map(([k, v]) => `  ${k}: ${v}`).join('\n');
      return { text: `${resume(e)}\nRequête :\n${h(masquerEntetes(e.entetesReq))}\nRéponse :\n${h(masquerEntetes(e.entetesRep))}\n\n${e.corpsRep.toString('utf8').slice(0, 4000)}${e.tronque ? '\n… (tronqué)' : ''}`, data: { id: e.id, defauts: e.defauts } };
    } },
  { id: 'comparer', label: 'Comparer deux réponses', what: 'Code, en-têtes et différence ligne par ligne', read: true, external: true, params: [{ key: 'a', label: 'Premier échange', kind: 'text', required: true }, { key: 'b', label: 'Second échange', kind: 'text', required: true }],
    run: (_ctx, i) => {
      const a = memEchange(i.a), b = memEchange(i.b); if (!a || !b) return { ok: false, text: 'Un des deux échanges n\'est plus en mémoire.' };
      const r = (e: Echange) => ({ code: e.code, entetes: masquerEntetes(e.entetesRep), corps: e.corpsRep.toString('utf8') });
      const d = comparer(r(a), r(b));
      if (d.identiques) return { text: '= Les deux réponses sont identiques.', data: d };
      return { text: [d.code ? `Code : ${d.code[0]} → ${d.code[1]}` : '', ...d.entetes.map((x) => `En-tête ${x.nom} : ${x.a ?? '—'} → ${x.b ?? '—'}`), ...d.lignes.filter((l) => l.genre !== '=').slice(0, 80).map((l) => `${l.genre} ${l.texte.slice(0, 200)}`), d.tronque ? '(seules les 2000 premières lignes sont comparées)' : ''].filter(Boolean).join('\n'), data: d };
    } },
  { id: 'encoder', label: 'Encoder', what: 'base64, base64url, URL, entités HTML ou hexadécimal', read: true, params: [{ key: 'format', label: 'Format', kind: 'select', options: [...FORMATS], default: 'base64' }, { key: 'texte', label: 'Texte', kind: 'textarea', required: true }],
    run: (_ctx, i) => { const f = s(i.format) as Format; if (!FORMATS.includes(f)) return { ok: false, text: `Format : ${FORMATS.join(', ')}.` }; const r = encoder(f, String(i.texte ?? '')); return { text: r, data: { resultat: r } }; } },
  { id: 'decoder', label: 'Décoder', what: 'base64, base64url, URL, entités HTML, hexadécimal, ou un jeton JWT (sans vérifier la signature)', read: true, params: [{ key: 'format', label: 'Format', kind: 'select', options: [...FORMATS, 'jwt'], default: 'base64' }, { key: 'texte', label: 'Texte', kind: 'textarea', required: true }],
    run: (_ctx, i) => {
      const f = s(i.format), t = String(i.texte ?? '');
      if (f === 'jwt') { const j = lireJwt(t); return { text: `${j.note}\nEn-tête : ${JSON.stringify(j.entete)}\nContenu : ${JSON.stringify(j.charge, null, 1)}${j.expire ? `\nExpire : ${j.expire}` : ''}`, data: j }; }
      if (!FORMATS.includes(f as Format)) return { ok: false, text: `Format : ${FORMATS.join(', ')} ou jwt.` };
      const r = decoder(f as Format, t); return { text: r, data: { resultat: r } };
    } },
  { id: 'defauts', label: 'Défauts trouvés', what: 'Ce que la recherche passive a relevé, site par site, avec un conseil', read: true,
    run: (ctx) => {
      const d = (ctx.settings.defauts as Record<string, Array<{ niveau: string; titre: string; conseil: string }>> | undefined) ?? {};
      const l = Object.entries(d).flatMap(([h, xs]) => xs.map((x) => `${h} · [${x.niveau}] ${x.titre} — ${x.conseil}`));
      return { text: l.length ? l.join('\n') : 'Aucun défaut relevé pour l\'instant.', data: d };
    } },
  { id: 'certificat', label: 'Certificat', what: 'Le certificat de l\'autorité d\'Achille, à installer sur tes appareils de test', read: true,
    run: (ctx) => {
      const a = ca(ctx); ctx.saveSettings({ caAReinstaller: false });
      return { text: `🔏 Certificat d'Achille (empreinte ${a.empreinte}). Il ne vaut que pour ta maison et tes domaines prouvés (${a.domaines.join(', ') || 'aucun'}).\n${MARCHE.join('\n')}`, fichiers: [{ nom: 'achille-autorite.crt', ref: 'autorite' }] };
    } },
  { id: 'journal', label: 'Journal', what: 'Tout ce qui a été testé ou refusé', read: true, external: true,
    run: (ctx) => { const l = journal(ctx).tout().slice(-50).reverse(); return { text: l.length ? l.map(ligneTexte).join('\n') : 'Journal vide.', data: l }; } },
  { id: 'controle_passif', label: 'Contrôle passif de mes sites', what: 'Une seule page par domaine prouvé : en-têtes, cookies, certificat', words: ['en tetes de securite', 'teste la securite de mon site', 'controle la securite de mon site'],
    run: async (ctx) => ({ text: `🔎 ${await controlePassif(ctx)}` }) },
];
const MARCHE = [
  'Windows : double-clic sur le fichier → Installer le certificat → Ordinateur local → « Autorités de certification racines de confiance ».',
  'macOS : double-clic → Trousseaux d\'accès (Système) → ouvre le certificat → « Toujours approuver ».',
  'Android : Paramètres → Sécurité → Chiffrement et identifiants → Installer un certificat → Certificat CA.',
  'iOS : ouvre le fichier → Réglages → Profil téléchargé → Installer, puis Réglages → Général → Informations → Réglages des certificats → active Achille.',
  'Linux : copie-le dans /usr/local/share/ca-certificates/achille.crt puis sudo update-ca-certificates (Firefox : Paramètres → Certificats → Importer).',
  'Pour le retirer : supprime « Achille (Odin) » de la même liste.',
];
function ligneTexte(l: LigneJournal): string {
  const q = new Date(l.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  if (l.genre === 'echange' || l.genre === 'rejeu') return `${q} · ${l.genre === 'rejeu' ? 'rejeu ' : ''}${l.methode} ${l.url} → ${l.code} (${l.ms} ms)`;
  return `${q} · ${l.genre}${l.url ? ` ${l.url}` : ''}${l.raison ? ` : ${l.raison}` : ''}${l.texte ? ` : ${l.texte}` : ''}${l.client ? ` (de ${l.client})` : ''}`;
}

// ---------------------------------------------------------------- Page
function vue(ctx: ModCtx) {
  const px = proxy, on = Boolean(px?.allume), ds = domaines(ctx), ex = (px?.echanges ?? []).slice(-40).reverse();
  const def = (ctx.settings.defauts as Record<string, Array<{ niveau: string; titre: string; conseil: string; vu: string }>> | undefined) ?? {};
  const nDef = Object.values(def).reduce((n, l) => n + l.length, 0);
  const ton = (n: string): Tone => (n === 'haut' ? 'mauvais' : n === 'moyen' ? 'attention' : 'neutre');
  const sections: Section[] = [
    { kind: 'text', onglet: O.P, title: 'Proxy d\'essai', tone: on ? 'attention' : 'neutre', text: on ? `Allumé sur le port ${px!.port}, jusqu'à ${new Date(px!.jusqua!).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}. Seuls tes appareils autorisés peuvent s'en servir, et seulement vers ta portée.` : 'Éteint. Allume-le quand tu veux tester un de tes sites : il s\'éteint tout seul.' },
    ...(ctx.settings.caAReinstaller ? [{ kind: 'text' as const, onglet: O.P, title: 'Certificat à réinstaller', tone: 'attention' as Tone, text: 'La liste de tes domaines a changé : l\'autorité d\'Achille a été refaite. Réinstalle son certificat sur tes appareils (bouton « Certificat »).' }] : []),
    { kind: 'actions', onglet: O.P, title: 'Commandes', boutons: [on ? { action: 'eteindre_proxy', label: 'Éteindre le proxy' } : { action: 'allumer_proxy', label: 'Allumer le proxy', primary: true }, { action: 'certificat', label: 'Certificat' }, { action: 'controle_passif', label: 'Contrôler mes sites' }], aide: 'Achille ne teste que ta maison et tes domaines prouvés. Aucun scanner actif, aucune rafale.' },
    { kind: 'table', onglet: O.P, title: 'Mes domaines', columns: ['Domaine', 'État', 'Jeton de preuve'], empty: 'Aucun domaine déclaré : seuls les appareils et noms de ta maison sont dans ta portée.',
      rows: ds.map((d) => ({ cells: [d.nom, d.prouve ? `prouvé (${d.par === 'txt' ? 'TXT' : 'fichier'})` : 'en attente de preuve', d.prouve ? '—' : d.jeton], tone: (d.prouve ? 'bon' : 'attention') as Tone, actions: [...(d.prouve ? [] : [{ action: 'verifier_domaine', label: 'Vérifier', input: { domaine: d.nom } }]), { action: 'retirer_domaine', label: 'Retirer', input: { domaine: d.nom } }] })) },
    { kind: 'form', onglet: O.P, title: 'Déclarer un de mes domaines', action: 'declarer_domaine', submit: 'Déclarer', params: [P_DOMAINE], aide: 'Tu recevras un jeton à publier (DNS TXT ou fichier .well-known).' },
    { kind: 'table', onglet: O.P, title: 'Appareils autorisés', columns: ['Adresse'], empty: 'Aucun : seule la machine d\'Odin peut passer par le proxy.', rows: appareils(ctx).map((a) => ({ cells: [a], actions: [{ action: 'retirer_appareil', label: 'Retirer', input: { adresse: a } }] })) },
    { kind: 'form', onglet: O.P, title: 'Autoriser un appareil', action: 'ajouter_appareil', submit: 'Autoriser', params: [{ key: 'adresse', label: 'Adresse IP (ex. 192.168.1.20)', kind: 'text', required: true }] },
    { kind: 'table', onglet: O.E, title: 'Derniers échanges', columns: ['Échange', 'Requête', 'Code', 'Durée', 'Taille'], empty: 'Aucun échange en mémoire (les corps ne sont jamais gardés sur le disque).',
      rows: ex.map((e) => ({ cells: [e.id, `${e.rejeu ? '↻ ' : ''}${e.methode} ${masquerUrl(e.url).slice(0, 90)}`, String(e.code), `${e.ms} ms`, `${e.taille} o`], tone: (e.code >= 500 ? 'mauvais' : e.code >= 400 ? 'attention' : 'neutre') as Tone, actions: [{ action: 'echange', label: 'Voir', input: { id: e.id } }, { action: 'rejouer', label: 'Rejouer', input: { id: e.id } }] })) },
    { kind: 'form', onglet: O.E, title: 'Rejouer une requête', action: 'rejouer', submit: 'Envoyer', params: actions.find((a) => a.id === 'rejouer')!.params!, aide: 'Une requête par seconde, 300 par jour au plus. La portée est revérifiée à chaque envoi.' },
    { kind: 'form', onglet: O.E, title: 'Comparer deux réponses', action: 'comparer', submit: 'Comparer', params: actions.find((a) => a.id === 'comparer')!.params! },
    { kind: 'list', onglet: O.D, title: 'Défauts trouvés', empty: 'Rien pour l\'instant : fais passer un de tes sites par le proxy, ou lance « Contrôler mes sites ».',
      items: Object.entries(def).flatMap(([h, l]) => l.map((x) => ({ title: `${h} · ${x.titre}`, detail: x.conseil, tone: ton(x.niveau), meta: x.niveau === 'haut' ? 'Grave' : x.niveau === 'moyen' ? 'À corriger' : 'Conseil' }))) },
    { kind: 'form', onglet: O.T, title: 'Encoder', action: 'encoder', submit: 'Encoder', params: actions.find((a) => a.id === 'encoder')!.params! },
    { kind: 'form', onglet: O.T, title: 'Décoder', action: 'decoder', submit: 'Décoder', params: actions.find((a) => a.id === 'decoder')!.params!, aide: 'Un jeton JWT est lu sans vérifier sa signature.' },
    { kind: 'log', onglet: O.T, title: 'Journal (testé et refusé)', lines: journal(ctx).tout().slice(-30).reverse().map(ligneTexte) },
  ];
  return {
    subtitle: 'Sécurité de tes propres sites',
    onglets: [O.P, O.E, O.D, O.T],
    kpis: [
      { label: 'Proxy', value: on ? 'allumé' : 'éteint', tone: (on ? 'attention' : 'neutre') as Tone },
      { label: 'Domaines prouvés', value: String(ds.filter((d) => d.prouve).length) },
      { label: 'Appareils', value: String(appareils(ctx).length) },
      { label: 'Défauts', value: String(nDef), tone: (nDef ? 'attention' : 'bon') as Tone },
    ],
    sections,
  };
}

export const achille: Module = {
  id: 'achille', name: 'Achille', family: 'Sécurité',
  what: 'Teste la sécurité de tes propres sites et appareils : proxy d\'essai, historique des requêtes, rejeu d\'une requête modifiée, comparaison, encodeur, et recherche passive des défauts courants. Jamais les sites des autres.',
  does: [
    'proxy d\'essai HTTP et HTTPS (port 8890), éteint par défaut, allumé avec ton accord et éteint tout seul après 2 h',
    'portée stricte : le réseau de ta maison et les domaines que tu as déclarés et prouvés (TXT ou .well-known) ; tout le reste est refusé et noté',
    'autorité de certification propre à Achille, limitée à ta maison et à tes domaines : elle ne peut rien signer pour un autre site',
    'historique des échanges (corps en mémoire seulement), rejeu d\'une requête modifiée (une par seconde, 300 par jour), comparaison de deux réponses',
    'recherche passive : en-têtes de sécurité, cookies, formulaires sans jeton, versions exposées, contenu mixte, CORS, certificat',
    'encodeur et décodeur (base64, URL, HTML, hexadécimal, JWT sans vérification)',
    'journal de tout ce qui est testé ou refusé, avec les valeurs secrètes masquées',
  ],
  from: ['Burp Suite', 'OWASP ZAP', 'mitmproxy'], upstream: ['zaproxy/zaproxy', 'mitmproxy/mitmproxy'],
  words: ['achille', 'teste la securite de mon site', 'intercepte les requetes', 'en tetes de securite', 'securite de mes sites'],
  actions,
  view: (ctx) => vue(ctx),
  retrait: (ctx, ref) => {
    if (ref !== 'autorite') return undefined;
    const c = certificatAutorite(ctx.dir) ?? ca(ctx).cert, f = join(ctx.dir, 'achille-autorite.crt');
    writeFileSync(f, c, { mode: 0o600 }); return f;
  },
  stop: () => { proxy?.eteindre('arrêt d\'Odin'); proxy = undefined; },
  watch: { every: 300, async run(ctx) {
    if (proxy?.allume && proxy.jusqua && Date.now() > proxy.jusqua) proxy.eteindre('délai écoulé');
    const now = ctx.now();
    if (duControle(ctx, now) && !tacheEnPause('achille', 'controle_passif')) await controlePassif(ctx);
  } },
  taches: () => [{
    id: 'controle_passif', nom: 'Contrôle passif de tes sites', quoi: 'Une seule page par domaine déclaré et prouvé : en-têtes, cookies, certificat. Rien d\'autre n\'est envoyé.', securite: true,
    rythme: rythmeControle, permis: ['jour', 'semaine', 'mois'],
    regler: (ctx, r) => { if (!['jour', 'semaine', 'mois'].includes(r.genre)) throw new Error('une fois par jour, par semaine ou par mois au plus'); ctx.saveSettings({ rythmeControle: r }); },
    lancer: { action: 'controle_passif' },
    dernier: (ctx) => (s(ctx.settings.controleA) ? { at: s(ctx.settings.controleA) } : undefined),
    prochain: (ctx, now) => prochaine(rythmeControle(ctx) as Rythme, new Date(Math.max(now.getTime() - 1, Date.parse(s(ctx.settings.controleA) || now.toISOString())))),
  }],
};
