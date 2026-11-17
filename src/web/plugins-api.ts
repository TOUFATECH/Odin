// L'API des plugins des compétences : /api/plugins/* — compétences, connecteurs MCP et plugins vus ensemble, avec
// leurs liens prouvés vers Brain, la Mémoire et Soul. Propriétaire seul (ni membre de la maison, ni invité).
//
// Un connecteur est une porte vers un service extérieur : il ne se branche que par l'action « ajouter » de
// l'Interprète, après une confirmation explicite (409 puis confirme:true). Son jeton va au coffre (writeSecret) et
// n'est jamais renvoyé, affiché ni journalisé : la réponse dit seulement s'il y en a un.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { writeSecret } from '../settings.ts';
import type { Tool } from '../tools/registry.ts';
import { valhallaOf } from '../valhalla/odin.ts';
import { adresseMasquee, construireEtat, MARQUE_DEBRANCHE, proprietaireOutil, slugMcp } from '../plugins/graphe.ts';
import { enregistrerPlugin, ErreurPlugins, lier, supprimerPlugin, type References } from '../plugins/magasin.ts';
import { confsMcp, interprete, lireSources, type OdinPlugins, type ValhallaLike } from '../plugins/sources.ts';

export interface DepsPluginsRoute {
  /** Vrai seulement pour le propriétaire (pas un membre, pas un invité). */
  proprietaire(): boolean;
  /** Vrai pour un membre de la maison bien connecté : refusé (403) sans compter d'essai raté. */
  membre?(): boolean;
  odin: OdinPlugins & { redactor?: { redact(t: string): string } };
  /** Compte un essai raté (anti force brute). */
  fail(): void;
  /** Défaut : valhallaOf ; injecté par les essais. */
  valhalla?: () => ValhallaLike | undefined;
  /** Défaut : Date.now. */
  maintenant?: () => number;
}

const MAX_CORPS = 64 * 1024;
// Lettres et chiffres de toute écriture (pas seulement l'alphabet latin), espaces, « _ », « . », « - ».
const NOM_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,39}$/u;
/** La clé du coffre qui porte le jeton d'un connecteur (celle que lit l'Interprète). */
const cleJeton = (nom: string) => `MCP_${slugMcp(nom).toUpperCase()}`;
/** Cette machine même : seul cas où un jeton peut partir sur une adresse non chiffrée (http://). */
const boucle = (host: string) => /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i.test(host);
/** Adresses « lien local » (dont les métadonnées des hébergeurs, 169.254.169.254) : jamais un connecteur. */
const lienLocal = (host: string) => /^169\.254\.\d{1,3}\.\d{1,3}$/.test(host) || /^\[fe[89ab][0-9a-f]:/i.test(host) || /^metadata\.google\.internal$/i.test(host);
/** L'origine d'une adresse (schéma, hôte, port), pour comparer deux adresses. */
const origine = (u: string | undefined) => { try { return new URL(String(u ?? '')).origin; } catch { return ''; } };
const s = (v: unknown) => String(v ?? '');
const json = (res: ServerResponse, code: number, b: unknown): void => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(b)); };
/** Retire une valeur secrète d'un texte avant de le rendre (par précaution : les textes d'action ne la contiennent pas). */
const sans = (texte: string, secret?: string) => (secret ? texte.split(secret).join('•••') : texte);

/** Le corps JSON (objet), 64 Kio au plus. */
async function lireCorps(req: IncomingMessage): Promise<{ ok: true; b: Record<string, unknown> } | { ok: false; code: 413 | 400 }> {
  const morceaux: Buffer[] = []; let n = 0, trop = false;
  for await (const c of req) { if (trop) continue; n += (c as Buffer).length; if (n > MAX_CORPS) { trop = true; morceaux.length = 0; continue; } morceaux.push(c as Buffer); }
  if (trop) return { ok: false, code: 413 };
  try {
    const b = JSON.parse(Buffer.concat(morceaux).toString('utf8') || 'null') as unknown;
    return b && typeof b === 'object' && !Array.isArray(b) ? { ok: true, b: b as Record<string, unknown> } : { ok: false, code: 400 };
  } catch { return { ok: false, code: 400 }; }
}

/** Ce qui existe aujourd'hui : compétences actives et connecteurs réglés. */
const references = (d: DepsPluginsRoute, v: ValhallaLike | undefined): References => ({ skills: new Set(d.odin.skills.list().map((x) => x.name)), mcp: new Set(confsMcp(v).map((c) => c.name)) });

/**
 * Ferme la porte tout de suite : les outils du connecteur débranché restent inscrits dans le registre d'Odin (le
 * registre n'a pas de retrait), on les remplace donc par des outils qui refusent. Un nouveau branchement les remet.
 */
function couperOutils(registre: { all(): Tool[]; upsert(t: Tool): void } | undefined, nom: string, tous: string[]): void {
  if (!registre) return;
  for (const t of registre.all()) {
    if (!t.name.startsWith('mcp_') || proprietaireOutil(t.name, tous) !== nom || String(t.description ?? '').startsWith(MARQUE_DEBRANCHE)) continue;
    registre.upsert({ ...t, description: `${MARQUE_DEBRANCHE} connecteur « ${nom} » débranché : outil indisponible.`, grave: undefined, run: async () => `Le connecteur « ${nom} » est débranché : cet outil n'est plus disponible.` });
  }
}

/** Traite une requête /api/plugins/* ; rend true si c'est le cas. */
export async function pluginsRoute(req: IncomingMessage, res: ServerResponse, url: URL, d: DepsPluginsRoute): Promise<boolean> {
  const p = url.pathname;
  if (!p.startsWith('/api/plugins/')) return false;
  if (!d.proprietaire()) {
    // Un membre de la maison bien connecté n'est pas un essai de force brute : refusé sans bloquer son adresse.
    if (d.membre?.()) { json(res, 403, { ok: false, error: 'Réservé au propriétaire d\'Odin.' }); return true; }
    d.fail(); json(res, 401, { ok: false, error: 'Réservé au propriétaire d\'Odin.' }); return true;
  }
  if (req.method === 'POST' && req.headers['x-odin'] !== '1') { json(res, 403, { ok: false, error: 'En-tête x-odin manquant.' }); return true; }
  const maintenant = d.maintenant ?? Date.now;
  const v = (d.valhalla ?? valhallaOf)();
  let secret: string | undefined;
  try {
    if (req.method === 'GET' && p === '/api/plugins/etat') {
      json(res, 200, construireEtat(await lireSources(d.odin, v, maintenant())));
      return true;
    }
    if (req.method !== 'POST') { json(res, 404, { ok: false, error: 'Inconnu.' }); return true; }
    const c = await lireCorps(req);
    if (!c.ok) { json(res, c.code, { ok: false, error: c.code === 413 ? 'Corps trop gros.' : 'Corps illisible.' }); return true; }
    const b = c.b, home = d.odin.paths.home, quand = new Date(maintenant());
    switch (p) {
      case '/api/plugins/plugin': json(res, 200, { ok: true, plugin: enregistrerPlugin(home, b, references(d, v), quand) }); return true;
      case '/api/plugins/plugin/supprimer': supprimerPlugin(home, b.id); json(res, 200, { ok: true }); return true;
      case '/api/plugins/lien': lier(home, b.skill, b.mcp, b.relie === true, references(d, v), quand); json(res, 200, { ok: true }); return true;
      case '/api/plugins/connecteur/ajouter': {
        const nom = s(b.nom).trim(), jeton = s(b.jeton).trim();
        // « HTTPS://… » est une adresse : le schéma est remis en minuscules (l'Interprète ne reconnaît que « https:// »).
        let source = s(b.source).trim();
        const schema = /^(https?):\/\//i.exec(source);
        if (schema) source = `${schema[1].toLowerCase()}://${source.slice(schema[0].length)}`;
        const http = Boolean(schema);
        secret = jeton || undefined;
        if (!NOM_RE.test(nom) || slugMcp(nom).length < 2) { json(res, 400, { ok: false, error: 'Nom invalide : lettres, chiffres, espaces, « _ », « . » ou « - », 40 caractères au plus.' }); return true; }
        if (!source || source.length > 500) { json(res, 400, { ok: false, error: 'Lien ou commande obligatoire (500 caractères au plus).' }); return true; }
        let hote = '';
        if (http) {
          try { hote = new URL(source).host.replace(/:\d+$/, ''); } catch { json(res, 400, { ok: false, error: 'Adresse illisible.' }); return true; }
          if (lienLocal(hote)) { json(res, 400, { ok: false, error: 'Adresse « lien local » refusée (169.254.x.x, fe80::) : c\'est celle des services internes d\'une machine, jamais un connecteur.' }); return true; }
        }
        if (jeton && !http) { json(res, 400, { ok: false, error: 'Un jeton ne se donne qu\'à un connecteur en ligne (https://…).' }); return true; }
        if (jeton && source.startsWith('http://') && !boucle(hote)) { json(res, 400, { ok: false, error: 'Un jeton ne part que sur une adresse chiffrée (https://…), sauf vers cette machine même (127.0.0.1, localhost).' }); return true; }
        if (!v || !interprete(v)) { json(res, 503, { ok: false, error: 'Les applis d\'Odin ne sont pas démarrées.' }); return true; }
        const f = v.action('ratatoskr', 'ajouter');
        if (!f) { json(res, 503, { ok: false, error: 'Les applis d\'Odin ne sont pas démarrées.' }); return true; }
        // Le jeton est rangé par « slug » (MCP_<SLUG>) : deux noms au même slug partageraient le même jeton.
        const confs = confsMcp(v), slug = slugMcp(nom), cle = cleJeton(nom);
        const autre = confs.find((c) => c.name !== nom && slugMcp(c.name) === slug);
        if (autre) { json(res, 400, { ok: false, error: `Ce nom se confond avec le connecteur « ${autre.name} » (même identifiant interne « ${slug} ») : choisis un autre nom, ou débranche d'abord « ${autre.name} ».` }); return true; }
        const ancien = confs.find((c) => c.name === nom);
        const variables = s(b.variables), passeLaCle = variables.toUpperCase().split(',').map((x) => x.trim()).includes(cle);
        // Sans nouveau jeton, un ancien jeton rangé sous ce nom ne part QUE vers la même origine que le connecteur remplacé.
        const garder = !jeton && Boolean(process.env[cle]) && http && ancien?.kind === 'http' && origine(ancien.url) === origine(source);
        const effacer = !jeton && Boolean(process.env[cle]) && !garder && !passeLaCle;
        const input = { nom, source, variables };
        if (b.confirme !== true) {
          const why = f.a.grave?.(input, v.ctx('ratatoskr')) ?? `brancher le connecteur « ${nom} »`;
          const morceaux = [`Confirmer : ${why}`];
          if (ancien) morceaux.push(`Cela remplace le connecteur « ${nom} » déjà branché (${adresseMasquee(ancien)}).`);
          if (jeton) morceaux.push(`Le jeton donné sera rangé au coffre et envoyé à ${origine(source)}.`);
          else if (garder) morceaux.push(`Le jeton déjà au coffre pour ce connecteur sera envoyé à ${origine(source)}.`);
          else if (effacer) morceaux.push('Un ancien jeton rangé sous ce nom sera effacé du coffre : il ne part pas vers ce nouveau connecteur.');
          json(res, 409, { ok: false, confirmer: `${morceaux.join(' ')} ?` }); return true;
        }
        try {
          if (jeton) writeSecret(d.odin.paths, cle, jeton);
          else if (effacer) writeSecret(d.odin.paths, cle, '');
        } catch (e) { json(res, 400, { ok: false, error: sans((e as Error).message, secret) }); return true; }
        const r = await v.act('ratatoskr', 'ajouter', input);
        if (r.ok === false) { json(res, 502, { ok: false, error: sans(s(r.text), secret).slice(0, 300) }); return true; }
        json(res, 200, { ok: true, texte: sans(s(r.text), secret) }); return true;
      }
      case '/api/plugins/connecteur/reconnecter':
      case '/api/plugins/connecteur/retirer':
      case '/api/plugins/connecteur/jeton': {
        if (!v || !interprete(v)) { json(res, 503, { ok: false, error: 'Les applis d\'Odin ne sont pas démarrées.' }); return true; }
        const nom = s(b.nom), conf = confsMcp(v).find((x) => x.name === nom);
        if (!conf) { json(res, 404, { ok: false, error: 'Connecteur inconnu.' }); return true; }
        const cle = cleJeton(nom);
        if (p.endsWith('/jeton')) {
          const jeton = s(b.jeton).trim(); secret = jeton || undefined;
          if (conf.kind === 'stdio') { json(res, 400, { ok: false, error: 'Un jeton ne se donne qu\'à un connecteur en ligne (https://…).' }); return true; }
          let hote = ''; try { hote = new URL(String(conf.url ?? '')).host.replace(/:\d+$/, ''); } catch { hote = ''; }
          if (jeton && !String(conf.url ?? '').startsWith('https://') && !boucle(hote)) { json(res, 400, { ok: false, error: 'Un jeton ne part que sur une adresse chiffrée (https://…), sauf vers cette machine même (127.0.0.1, localhost).' }); return true; }
          try { writeSecret(d.odin.paths, cle, jeton); } catch (e) { json(res, 400, { ok: false, error: sans((e as Error).message, secret) }); return true; }
          json(res, 200, { ok: true, jeton: Boolean(process.env[cle]) }); return true;
        }
        const retirer = p.endsWith('/retirer');
        const restants = confsMcp(v).filter((x) => x.name !== nom), cleLibre = !restants.some((x) => cleJeton(x.name) === cle);
        if (retirer && b.confirme !== true) { json(res, 409, { ok: false, confirmer: `Débrancher le connecteur « ${nom} » ? Ses outils sont coupés tout de suite${cleLibre && process.env[cle] ? ' et son jeton est effacé du coffre' : ''}.` }); return true; }
        const tous = confsMcp(v).map((x) => x.name);
        const r = await v.act('ratatoskr', retirer ? 'retirer' : 'reconnecter', { nom });
        if (r.ok === false) { json(res, 502, { ok: false, error: s(r.text).slice(0, 300) }); return true; }
        if (retirer) {
          couperOutils(d.odin.tools, nom, tous);
          if (cleLibre && process.env[cle]) { try { writeSecret(d.odin.paths, cle, ''); } catch (e) { console.error('plugins : jeton non effacé', (e as Error).message); } }
          json(res, 200, { ok: true, texte: `${nom} débranché : ses outils sont coupés.` }); return true;
        }
        json(res, 200, { ok: true, texte: s(r.text) }); return true;
      }
      default: json(res, 404, { ok: false, error: 'Inconnu.' }); return true;
    }
  } catch (e) {
    if (e instanceof ErreurPlugins) { json(res, e.code, { ok: false, error: e.message }); return true; }
    const brut = sans(String((e as Error)?.stack ?? e), secret);
    let texte = brut; try { texte = d.odin.redactor?.redact(brut) ?? brut; } catch { /* texte brut, sans le secret */ }
    console.error('plugins :', texte);
    if (!res.headersSent) json(res, 500, { ok: false, error: 'Erreur interne.' });
    return true;
  }
}
