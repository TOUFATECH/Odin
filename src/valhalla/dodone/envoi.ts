// Dodone · l'envoi d'une requête et ses tests. Le lien est vérifié (http ou https, sans identifiant écrit dedans,
// jamais vers les ports d'Odin lui-même ni vers les métadonnées d'un hébergeur ; un service en essai sur cette machine,
// http://localhost:3000 par exemple, est permis : voir boucle.ts), le nom est résolu pour vérifier où
// il mène vraiment, les redirections ne sont pas suivies (elles sont montrées), 30 s au plus, réponse lue jusqu'à
// 5 Mo, temps mesuré.
import { lookup } from 'node:dns/promises';
import { hoteInterdit, lienPropre } from '../lien.ts';
import { boucleLocale, portDuLien, REFUS_ODIN, versOdinLuiMeme } from '../boucle.ts';
import { cheminJson, texteTest, type Test } from './collections.ts';

export type Resoudre = (hote: string) => Promise<string[]>;
export const RESOUDRE_SYSTEME: Resoudre = async (h) => (await lookup(h, { all: true })).map((a) => a.address);
export const MAX_REPONSE = 5 * 1024 * 1024, DELAI = 30_000;

export interface Envoi { methode: string; url: string; entetes: Record<string, string>; corps?: string }
export interface Reponse { code: number; ms: number; entetes: Record<string, string>; corps: string; taille: number; tronque: boolean }
export interface ResultatTest { texte: string; ok: boolean; detail?: string }

/** Envoie la requête (déjà substituée). Lève une erreur claire si le lien est refusé ou si rien ne répond. */
export async function envoyer(f: typeof fetch, e: Envoi, o: { resoudre?: Resoudre; delaiMs?: number; max?: number; machine?: Set<string> } = {}): Promise<Reponse> {
  const u = lienPropreOuBoucle(e.url);
  const h = u.hostname.replace(/^\[|\]$/g, '');
  const adresses = [h, ...(await (o.resoudre ?? RESOUDRE_SYSTEME)(h).catch(() => [] as string[]))];
  // La boucle locale est permise (un service en essai sur cette machine), jamais les ports d'Odin lui-même.
  if (adresses.some((a) => hoteInterdit(a) && !boucleLocale(a))) throw new Error(`${u.hostname} mène à une adresse réservée (lien local ou métadonnées d'un hébergeur) : refusé`);
  if (versOdinLuiMeme(adresses, portDuLien(u), o.machine)) throw new Error(REFUS_ODIN);
  const methode = e.methode.toUpperCase(), max = o.max ?? MAX_REPONSE, t0 = performance.now();
  const r = await f(u.toString(), { method: methode, headers: e.entetes, redirect: 'manual', signal: AbortSignal.timeout(o.delaiMs ?? DELAI), ...(e.corps && !['GET', 'HEAD'].includes(methode) ? { body: e.corps } : {}) });
  const morceaux: Buffer[] = []; let taille = 0, gardee = 0;
  if (r.body) for await (const c of r.body as unknown as AsyncIterable<Uint8Array>) {
    taille += c.length;
    if (gardee < max) { const x = Buffer.from(c).subarray(0, max - gardee); morceaux.push(x); gardee += x.length; }
    else { await (r.body as ReadableStream).cancel().catch(() => undefined); break; }
  }
  const ms = Math.round(performance.now() - t0), entetes: Record<string, string> = {};
  r.headers.forEach((v, k) => { entetes[k] = v; });
  return { code: r.status, ms, entetes, corps: Buffer.concat(morceaux).toString('utf8'), taille, tronque: taille > max };
}

/** Le lien vérifié (lienPropre), mais la boucle locale est acceptée : http(s), sans identifiant écrit dedans. Pur. */
export function lienPropreOuBoucle(raw: string): URL {
  let u: URL; try { u = new URL(String(raw ?? '').trim()); } catch { return lienPropre(raw); }
  if (!boucleLocale(u.hostname)) return lienPropre(raw);
  if (!/^https?:$/.test(u.protocol)) throw new Error('seuls les liens http et https sont acceptés');
  if (u.username || u.password) throw new Error('n\'écris pas l\'identifiant ni le mot de passe dans le lien : mets-les dans un en-tête avec une variable du coffre');
  return u;
}

/** Les tests sur une réponse. Pur. */
export function evaluer(tests: Test[], r: Reponse): ResultatTest[] {
  let json: unknown, jsonLu = false;
  const lireJson = () => { if (!jsonLu) { jsonLu = true; try { json = JSON.parse(r.corps); } catch { json = undefined; } } return json; };
  return tests.map((t) => {
    const texte = texteTest(t);
    switch (t.genre) {
      case 'code': return { texte, ok: r.code === Number(t.valeur), detail: `reçu ${r.code}` };
      case 'temps': return { texte, ok: r.ms < Number(t.valeur), detail: `${r.ms} ms` };
      default: {
        const j = lireJson(); if (j === undefined) return { texte, ok: false, detail: 'la réponse n\'est pas du JSON' };
        const c = cheminJson(j, t.chemin ?? '');
        if (t.genre === 'json_existe') return { texte, ok: c.existe, ...(c.existe ? {} : { detail: 'absent' }) };
        if (!c.existe) return { texte, ok: false, detail: 'absent' };
        const v = typeof c.valeur === 'string' ? c.valeur : JSON.stringify(c.valeur);
        const ok = t.genre === 'json_egal' ? v === t.valeur : v.includes(t.valeur ?? '');
        return { texte, ok, ...(ok ? {} : { detail: `vaut ${v.slice(0, 80)}` }) };
      }
    }
  });
}
