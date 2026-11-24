// Qui voit quoi, widget par widget (maquette validée « Accueil », lot 24c) : le filet de sûreté du serveur.
// Rien ne change à l'écran. Deux usages :
//   - l'écran de la maison (/api/maison/etat, maison-api.ts) ne garde, de ses pages, que les widgets que le public de
//     leur sorte permet à qui regarde (lot 23 : droitDeVoir) ;
//   - la route /api/widgets/donnees rend la donnée des widgets de la fenêtre au propriétaire, par « la donnée d'un
//     widget » (donneeWidget), dans l'un des cinq états.
// Une session de membre n'atteint jamais /api/widgets/ : la garde des membres (sso/garde.ts) ferme toute route
// /api/… qu'elle ne connaît pas. C'est le défaut sûr. Le jour où un widget doit être servi à un membre, la garde devra
// laisser passer cette route : à montrer avant.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { cleanLayout, defaultLayout, type FPage, type Layout, type Widget } from '../valhalla/modules/gladsheim.ts';
import { valhallaOf } from '../valhalla/odin.ts';
import { applisLues, donneeWidget, droitDeVoir, sorteDe, type EtatWidget, type Lecteur, type SourceWidget } from '../valhalla/widgets/index.ts';
import { sourceOdin } from '../valhalla/widgets/source.ts';

type Valhalla = NonNullable<ReturnType<typeof valhallaOf>>;
const json = (res: ServerResponse, code: number, b: unknown) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(b)); };

/**
 * Qui regarde l'écran de la maison. Ta session, ou une clé « complet » : les droits du propriétaire (son choix « Oui,
 * comme aujourd'hui »), sauf les quatre sortes de l'accueil, que droitDeVoir ne rend jamais sur cet écran. Une clé
 * « maison » : une tablette. Ce que le propriétaire a ouvert à une tablette (vie privée, sa réponse b à la question 15)
 * n'a pas encore de lieu où être gardé : rien n'est ouvert, les widgets « vie privée » lui restent fermés.
 */
export function lecteurMaison(full: boolean): Lecteur {
  return full ? { qui: 'proprietaire', ecran: 'maison' } : { qui: 'maison', ecran: 'maison', ouverts: new Set<string>() };
}

/**
 * Un widget peut-il être servi à ce lecteur ? D'abord le public de sa sorte (droitDeVoir : rien n'est lu). À un autre
 * que le propriétaire, jamais un widget dont une appli lue est désactivée (ou absente) : elle ne serait pas lue pour
 * lui, ni son bouton lancé. Pour une sorte qui lance une action (famille « maison » : le bouton), aussi l'action
 * elle-même : grave ou « propriétaire seul », jamais à une tablette ni à un membre. Un droit qu'on n'a pas pu
 * vérifier : non.
 */
export async function widgetPermis(w: Widget, l: Lecteur, src: SourceWidget): Promise<boolean> {
  try {
    if (droitDeVoir(w, l, src)) return false;
    const s = sorteDe(w.kind)!;
    if (l.qui !== 'proprietaire' && applisLues(w, s).some((a) => !src.appli(a))) return false;
    if (s.famille !== 'maison') return true;
    return (await donneeWidget(w, l, src)).etat !== 'refuse';
  } catch { return false; }
}

/** Les pages, chacune réduite aux widgets que ce lecteur peut recevoir (même ordre, mêmes pages). */
export async function pagesPermises<P extends FPage>(v: Valhalla, pages: P[], l: Lecteur, src: SourceWidget = sourceOdin(v)): Promise<P[]> {
  const out: P[] = [];
  for (const p of pages) {
    const ws: Widget[] = [];
    for (const w of p.widgets) if (await widgetPermis(w, l, src)) ws.push(w);
    out.push({ ...p, widgets: ws });
  }
  return out;
}

/** Les pages « écran de la maison » de la fenêtre, filtrées pour ta session (ou une clé « complet ») ou une tablette « maison ». */
export const pagesMaisonPermises = <P extends FPage>(v: Valhalla, pages: P[], full: boolean) => pagesPermises(v, pages, lecteurMaison(full));

/**
 * Le bouton de l'écran de la maison qu'une requête veut lancer (/api/maison/fenetre) : seulement s'il est l'un de ceux
 * servis à qui le demande. Sans cela, une tablette « maison » lancerait un bouton qu'on ne lui montre pas (une appli de
 * la vie privée, une appli désactivée) et en lirait la réponse.
 */
export async function boutonMaison<P extends FPage>(v: Valhalla, pages: P[], id: string, full: boolean): Promise<Widget | undefined> {
  const w = pages.filter((p) => p.maison).flatMap((p) => p.widgets).find((x) => x.id === id && x.kind === 'bouton');
  return w && await widgetPermis(w, lecteurMaison(full), sourceOdin(v)) ? w : undefined;
}

/** La fenêtre rangée (ou celle de départ). */
function fenetreDe(v: Valhalla): Layout {
  const g = v.ctx('gladsheim'), ids = v.modules().map((m) => m.id);
  try { return g.settings.fenetre ? cleanLayout(g.settings.fenetre, ids) : defaultLayout(ids); } catch { return defaultLayout(ids); }
}

/**
 * Rend true si la requête était pour /api/widgets/. Le propriétaire seul, par sa session (ni la clé d'API, ni une clé
 * de tablette, ni un membre : server.ts le décide), sur l'accueil. Rien ici n'est essayable : pas de clé à deviner.
 */
export async function widgetsRoute(req: IncomingMessage, res: ServerResponse, url: URL, d: { proprietaire: () => boolean }): Promise<boolean> {
  if (!url.pathname.startsWith('/api/widgets/')) return false;
  if (!d.proprietaire()) { json(res, 401, { ok: false, error: 'connexion requise' }); return true; }
  if (url.pathname !== '/api/widgets/donnees') { json(res, 404, { ok: false, error: 'introuvable' }); return true; }
  if (req.method !== 'GET') { json(res, 405, { ok: false, error: 'méthode refusée' }); return true; }
  const v = valhallaOf(); if (!v) { json(res, 503, { ok: false, error: 'Les applis d\'Odin ne sont pas démarrées.' }); return true; }
  const page = (url.searchParams.get('page') ?? '').slice(0, 40), l: Lecteur = { qui: 'proprietaire', ecran: 'accueil' }, src = sourceOdin(v);
  const pages = fenetreDe(v).pages.filter((p) => !page || p.id === page);
  const widgets: Array<{ id: string; kind: string; page: string } & EtatWidget> = [];
  for (const p of pages) for (const w of p.widgets) widgets.push({ id: w.id, kind: w.kind, page: p.id, ...await donneeWidget(w, l, src) });
  json(res, 200, { ok: true, ecran: 'accueil', widgets, at: Date.now() });
  return true;
}
