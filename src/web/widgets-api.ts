// Qui voit quoi, widget par widget (maquette validée « Accueil », lot 24c) : le filet de sûreté du serveur.
// Rien ne change à l'écran. Deux usages :
//   - l'écran de la maison (/api/maison/etat, maison-api.ts) ne garde, de ses pages, que les widgets que le public de
//     leur sorte permet à qui regarde (lot 23 : droitDeVoir) ;
//   - la route /api/widgets/donnees rend la donnée des widgets de la fenêtre, par « la donnée d'un widget »
//     (donneeWidget), dans l'un des cinq états : au propriétaire (sa session), et à un membre connecté.
// Un membre (validé le 26/11, sa question 15, réponse b) : la garde des membres (sso/garde.ts) laisse passer cette
// seule route de /api/widgets/. Il reçoit la donnée d'un widget s'il a le droit sur chaque appli lue ; un widget qui lit
// une appli de la vie privée lui reste fermé, sauf si le propriétaire le lui a ouvert, à lui, pour cette appli
// (widgets/ouvertures.ts). La lecture est faite en son nom : une appli qui montre moins à un membre (Sphinx : son seul
// appareil) lui montre moins ici aussi. Sa page ne demande plus la vue d'une appli pour dessiner un widget.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defaultLayout, fenetreRangee, sansAccueilDuProprietaire, type FPage, type Layout, type Widget } from '../valhalla/modules/gladsheim.ts';
import { valhallaOf } from '../valhalla/odin.ts';
import { auNomDe } from '../valhalla/sso/acces.ts';
import { aDroit } from '../valhalla/sso/etat.ts';
import { membreDe } from '../valhalla/sso/garde.ts';
import { applisLues, donneeWidget, droitDeVoir, sorteDe, type EtatWidget, type Lecteur, type SourceWidget } from '../valhalla/widgets/index.ts';
import { ouverturesDe } from '../valhalla/widgets/ouvertures.ts';
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

/** La fenêtre rangée (ou celle de départ), comme Hestia la rend : avec la page « Aujourd'hui » (lot 26). */
function fenetreDe(v: Valhalla): Layout {
  try { return fenetreRangee(v.ctx('gladsheim')); } catch { return defaultLayout(v.modules().map((m) => m.id)); }
}

/**
 * Qui regarde l'accueil avec cette session de membre : ses droits d'appli (relus à chaque demande), et ce que le
 * propriétaire lui a ouvert, à lui (par l'identifiant de sa fiche Persona). Sans le droit d'entrer dans Odin, ou sans
 * le droit sur Hestia (la fenêtre est la sienne) : rien.
 */
export function lecteurMembre(v: Valhalla, m: NonNullable<ReturnType<typeof membreDe>>): Lecteur | undefined {
  // La fenêtre est celle de Hestia : sans le droit sur Hestia, sa page n'a pas de fenêtre, et rien d'elle ne lui est dit.
  if (!aDroit(m.ctx, m.p, 'odin') || !aDroit(m.ctx, m.p, 'gladsheim')) return undefined;
  return { qui: 'membre', ecran: 'accueil', peutLire: (appli) => aDroit(m.ctx, m.p, appli), ouverts: new Set(ouverturesDe(v.ctx('gladsheim'), m.p.id)) };
}

/**
 * Rend true si la requête était pour /api/widgets/. Sur l'accueil, par une session (ni la clé d'API, ni une clé de
 * tablette : server.ts le décide) : celle du propriétaire, ou celle d'un membre (retrouvée ici dans Persona, par son
 * cookie). Rien ici n'est essayable : pas de clé à deviner. La réponse dit qui regarde (`qui`) : la page ne montre les
 * réglages (« ⋯ ») qu'au propriétaire.
 */
export async function widgetsRoute(req: IncomingMessage, res: ServerResponse, url: URL, d: { proprietaire: () => boolean }): Promise<boolean> {
  if (!url.pathname.startsWith('/api/widgets/')) return false;
  const proprio = d.proprietaire(), m = proprio ? undefined : membreDe(String(req.headers.cookie ?? ''));
  if (!proprio && !m) { json(res, 401, { ok: false, error: 'connexion requise' }); return true; }
  if (url.pathname !== '/api/widgets/donnees') { json(res, 404, { ok: false, error: 'introuvable' }); return true; }
  if (req.method !== 'GET') { json(res, 405, { ok: false, error: 'méthode refusée' }); return true; }
  const v = valhallaOf(); if (!v) { json(res, 503, { ok: false, error: 'Les applis d\'Odin ne sont pas démarrées.' }); return true; }
  const l: Lecteur | undefined = m ? lecteurMembre(v, m) : { qui: 'proprietaire', ecran: 'accueil' };
  if (!l) { json(res, 403, { ok: false, error: 'réservé' }); return true; }
  const page = (url.searchParams.get('page') ?? '').slice(0, 40), src = sourceOdin(v);
  // Un membre ne reçoit pas les widgets de l'accueil du propriétaire (lot 26) : ils ne sont pas dans sa fenêtre, rien
  // n'en est dit ici non plus (ni leur identifiant, ni leur page).
  const pages = (m ? sansAccueilDuProprietaire(fenetreDe(v)) : fenetreDe(v)).pages.filter((p) => !page || p.id === page);
  const lireTout = async () => {
    const widgets: Array<{ id: string; kind: string; page: string } & EtatWidget> = [];
    for (const p of pages) for (const w of p.widgets) widgets.push({ id: w.id, kind: w.kind, page: p.id, ...await donneeWidget(w, l, src) });
    return widgets;
  };
  // Pour un membre, tout est lu EN SON NOM : une appli qui montre moins à un membre lui montre moins ici aussi.
  const widgets = m ? await auNomDe({ login: m.p.login, name: m.p.name, groups: m.p.groups }, lireTout) : await lireTout();
  json(res, 200, { ok: true, ecran: 'accueil', qui: l.qui, widgets, at: Date.now() });
  return true;
}
