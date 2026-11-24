// « Régler » un widget (maquette validée « Accueil », lot 25b) : ce que le serveur garde de « Quand je touche le
// widget », et ses deux règles de rangement. Tout est pur : rien ne lit Odin ici.
//
// « Quand je touche le widget », cinq choix (maquette) :
//   - ouvrir l'appli : rien d'écrit dans le widget (c'est le départ ; une fenêtre déjà rangée se relit identique) ;
//   - lancer une action de l'appli : `{ quoi: 'action', action, input }` — toujours une action de l'appli DU widget (son
//     champ `module`), jamais d'une autre. Elle part par le chemin de toutes les actions (/api/valhalla/act) : accord à
//     CHAQUE fois si elle est grave, droit d'appli pour un membre, « propriétaire seul » respecté. Rien ici ne la lance ;
//   - aller à un écran : `{ quoi: 'ecran', ecran }`, l'un des écrans connus (ECRANS) ;
//   - ouvrir une adresse web : `{ quoi: 'adresse', adresse }`, nettoyée ici (adresseNette) ;
//   - rien : `{ quoi: 'rien' }`.
// Une tablette « maison » ne reçoit jamais ce réglage : l'écran de la maison ne rend d'un widget que les champs qu'il
// nomme (maison-api.ts), et ne lance que le bouton sur mesure (boutonMaison, widgets-api.ts) — un essai le prouve.
// Un membre ne le reçoit que sur un widget qu'il peut voir, et jamais pour une action grave ou « propriétaire seul »
// (toucherServi ici, la règle dans gladsheim.ts) : l'adresse ou les réglages d'un widget fermé ne lui arrivent pas.
import type { Layout, Widget } from '../modules/gladsheim.ts';
import { sorteDe } from './index.ts';
import type { Outils, SorteWidget } from './sorte.ts';

/** Les écrans où un widget peut mener : l'accueil d'Odin, l'écran de la maison (dans Odin). */
export const ECRANS_TOUCHER = ['accueil', 'maison'] as const;
export type EcranToucher = (typeof ECRANS_TOUCHER)[number];
/** Ce que fait un widget quand on le touche. Absent : ouvrir son appli (comme aujourd'hui). */
export type Toucher =
  | { quoi: 'action'; action: string; input?: Record<string, string> }
  | { quoi: 'ecran'; ecran: EcranToucher }
  | { quoi: 'adresse'; adresse: string }
  | { quoi: 'rien' };

/** Longueur d'une adresse, au plus. */
export const ADRESSE_MAX = 500;
// Espaces, caractères de commande, barre oblique inversée, séparateurs de ligne Unicode : jamais dans une adresse.
const INTERDITS = /[\u0000-\u0020\u007f-\u009f\\\u2028\u2029]/;

/**
 * Une adresse web nettoyée, ou rien si elle est refusée. Seulement http ou https (ni javascript:, ni data:, ni file:,
 * ni rien d'autre), écrite en entier (« https:// »), sans identifiants (« nom:motdepasse@ »), sans espace ni
 * caractère de commande, 500 signes au plus. Rend l'adresse telle que le navigateur la lira (le vrai nom du site,
 * les lettres étrangères en clair dans leur forme codée) : la même adresse relue rend la même chose. Pur.
 */
export function adresseNette(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t || t.length > ADRESSE_MAX || INTERDITS.test(t) || !/^https?:\/\/[^/?#]/i.test(t)) return undefined;
  let u: URL; try { u = new URL(t); } catch { return undefined; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
  if (u.username || u.password || !u.hostname) return undefined;
  return u.href.length <= ADRESSE_MAX ? u.href : undefined;
}

const ID_ACTION = /^[a-z_][a-z0-9_]{0,39}$/i;

/**
 * « Quand je touche le widget », nettoyé : l'un des quatre réglages écrits, ou rien (ouvrir l'appli). `out` : le widget
 * déjà nettoyé par sa sorte. Une action : seulement pour un widget qui lit l'appli qu'il a choisie (son `module`,
 * déjà vérifié présent), et jamais pour une sorte qui lance déjà une action (le bouton sur mesure). Tout ce qui n'est
 * pas reconnu est jeté : le widget reste, il ouvre son appli. Pur.
 */
export function toucherNet(brut: unknown, sorte: SorteWidget, out: Pick<Widget, 'module' | 'action'>, t: Outils): Toucher | undefined {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return undefined;
  const o = brut as Record<string, unknown>;
  if (o.quoi === 'rien') return { quoi: 'rien' };
  if (o.quoi === 'ecran') { const e = ECRANS_TOUCHER.find((x) => x === o.ecran); return e ? { quoi: 'ecran', ecran: e } : undefined; }
  if (o.quoi === 'adresse') { const a = adresseNette(o.adresse); return a ? { quoi: 'adresse', adresse: a } : undefined; }
  if (o.quoi === 'action') {
    if (sorte.applis !== 'choisie' || !out.module || out.action) return undefined;
    const action = t.str(o.action, 40); if (!ID_ACTION.test(action)) return undefined;
    const inp = (o.input && typeof o.input === 'object' && !Array.isArray(o.input) ? o.input : {}) as Record<string, unknown>;
    const input = Object.fromEntries(Object.entries(inp).slice(0, 12).filter(([k]) => /^[a-z_][a-z0-9_]{0,30}$/i.test(k)).map(([k, v]) => [k, t.str(v, 300)]));
    return { quoi: 'action', action, ...(Object.keys(input).length ? { input } : {}) };
  }
  return undefined;
}

/**
 * Les adresses qu'une fenêtre envoyée demande d'ouvrir au toucher et que le serveur refuse (telles qu'envoyées,
 * coupées à 80 signes, sans caractère de commande, caché ou de sens d'écriture). Ranger la fenêtre les refuse en le disant, plutôt que de les jeter
 * sans bruit ; relire une fenêtre déjà rangée les jette (cleanLayout). Pur.
 */
export function adressesRefusees(raw: unknown): string[] {
  const pages = (raw && typeof raw === 'object' ? (raw as { pages?: unknown }).pages : undefined), out: string[] = [];
  // Autant de pages que cleanLayout en lit (huit pages, plus une page sous un code, où qu'elle soit dans la liste).
  for (const p of (Array.isArray(pages) ? pages : []).slice(0, 32)) {
    const ws = (p && typeof p === 'object' ? (p as { widgets?: unknown }).widgets : undefined);
    for (const w of (Array.isArray(ws) ? ws : []).slice(0, 64)) {
      const t = (w && typeof w === 'object' ? (w as { toucher?: unknown }).toucher : undefined) as { quoi?: unknown; adresse?: unknown } | undefined;
      if (t && typeof t === 'object' && t.quoi === 'adresse' && !adresseNette(t.adresse)) out.push(String(t.adresse ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]+/g, ' ').trim().slice(0, 80));
    }
  }
  return out;
}

/**
 * Une sorte « fixe » (« À faire », constat M11) se déplace, d'une place ou d'une page à l'autre, mais ne se retire
 * pas : si la fenêtre rangée en portait un et que la nouvelle n'en porte plus, rend la sorte manquante (le rangement
 * est refusé). Sans fenêtre d'avant, ou sans widget fixe avant : rien. Pur.
 */
export function retraitRefuse(avant: Layout | undefined, apres: Layout): string | undefined {
  if (!avant) return undefined;
  const sortes = (l: Layout) => new Set(l.pages.flatMap((p) => p.widgets).map((w) => w.kind as string).filter((k) => sorteDe(k)?.fixe === true));
  const reste = sortes(apres);
  return [...sortes(avant)].find((k) => !reste.has(k));
}

/**
 * La fenêtre servie à un autre que le propriétaire : « Quand je touche » n'y reste que sur les widgets que `garde`
 * permet. Pour les autres, ni l'adresse, ni l'action, ni ses réglages ne sont servis (le widget reste à sa place, et
 * ouvre son appli comme avant). La fenêtre gardée n'est pas touchée. Pur.
 */
export function toucherServi<L extends Layout>(l: L, garde: (w: Widget) => boolean): L {
  const sans = (w: Widget): Widget => { if (!w.toucher) return w; let oui = false; try { oui = garde(w); } catch { oui = false; } if (oui) return w; const reste = { ...w }; delete reste.toucher; return reste; };
  return { ...l, pages: l.pages.map((p) => ({ ...p, widgets: p.widgets.map(sans) })) };
}
