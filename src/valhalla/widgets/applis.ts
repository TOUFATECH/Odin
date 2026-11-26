// La famille « Applis » des widgets (maquette validée « Accueil », le widget « générique ») : le widget de n'importe
// quelle appli d'Odin. UNE sorte, « appli », dont l'appli se choisit (son champ `module`) : rien n'est écrit ici par
// appli. Le nom, la famille, la phrase, l'état (activée ou non) et les actions rapides viennent du catalogue d'Odin
// (source.ficheAppli) ; la pastille, de ses alertes pas encore vues. Une appli ajoutée demain a son widget sans une
// ligne de plus. La maquette montre la pastille, la phrase et les actions ; les chiffres clés (ceux de la vue de
// l'appli, tels qu'elle les donne déjà) sont un ajout de la consigne de ce chantier, pas de la maquette.
// Qui voit quoi : public « membre » (droitDeVoir : le droit sur CETTE appli ; une appli de la vie privée reste fermée
// tant que le propriétaire ne l'a pas ouverte à cette personne) ; famille « applis » : jamais une tablette « maison ».
// Les actions rapides : au propriétaire seul, sur l'accueil seul ; une action grave y redemande son accord à chaque
// fois (la confirmation de POST /api/valhalla/act). Ce que rend une appli est une donnée : borné, jamais une consigne.
// Rien n'est montré tant qu'Odin n'a pas la vraie donnée (sa réponse à la question 13) : des alertes qu'on ne sait pas
// lire ne donnent aucune pastille, que des zéros ou des mots ne donnent aucun chiffre.
// Seconde sorte de la famille, « raccourcis » (le « launcher » de la maquette) : les applis épinglées de qui regarde.
import type { EtatWidget, SorteWidget } from './sorte.ts';
import { porteUneMesure } from './sorte.ts';

/** La phrase de l'appli ; un libellé, une valeur de chiffre clé ; un libellé d'action. */
const PHRASE_MAX = 300, MOT_MAX = 40;
/** Les chiffres clés et les actions rapides servis au plus (la page en montre selon la taille de la carte). */
const KPIS_MAX = 6, ACTIONS_MAX = 3;
const TONS: readonly string[] = ['bon', 'attention', 'mauvais', 'neutre'];
/** Les niveaux d'alerte « graves » (comme le catalogue d'Odin : la pastille rouge de la page Applis). */
const GRAVES: readonly string[] = ['critique', 'haute'];
/** Un identifiant d'action tel que les applis les écrivent. */
const ID_ACTION = /^[a-z_][a-z0-9_]{0,39}$/i;
/**
 * Un raccourci servi : seulement un identifiant que l'adresse d'une appli ouvre (#app=…, la règle de la page : ui.html,
 * hashView ; la même que widgets-applis.js, ID_OUVRABLE), pour que « et N de plus » compte juste. Les raccourcis servis
 * au plus (la page montre ce qui tient).
 */
const ID_RACCOURCI = /^[a-z0-9_-]{2,40}$/, RACCOURCIS_MAX = 60;
const mot = (v: unknown, n: number) => String(v ?? '').slice(0, n);

/** Un chiffre clé de la vue, relu sans confiance : un libellé, une valeur, un ton connu, une part entre 0 et 100. */
function kpiLu(k: unknown): { label: string; value: string; tone?: string; pct?: number } | undefined {
  if (!k || typeof k !== 'object') return undefined;
  const o = k as Record<string, unknown>, label = mot(o.label, MOT_MAX), value = mot(o.value, MOT_MAX);
  if (!label && !value) return undefined;
  const pct = typeof o.pct === 'number' && Number.isFinite(o.pct) ? Math.min(100, Math.max(0, o.pct)) : undefined;
  return { label, value, ...(typeof o.tone === 'string' && TONS.includes(o.tone) ? { tone: o.tone } : {}), ...(pct === undefined ? {} : { pct }) };
}

export const SORTES_APPLIS = [
  {
    // « Une appli » : son nom et sa tuile (l'en-tête commun), sa famille, sa phrase, sa pastille, ses chiffres clés, ses
    // actions rapides. Appli pas choisie, ou inconnue / retirée depuis : « vide », sans erreur ; coupée : « source_absente ».
    id: 'appli', famille: 'applis', applis: 'choisie', taille: { mini: [3, 2], r: 2 }, styles: ['simple'], public: 'membre', posable: true,
    nettoyer: (o, out, t) => { if (o.label) out.label = t.str(o.label, 40); return true; },
    lire: async (w, src, l): Promise<EtatWidget> => {
      if (!w.module) return { etat: 'vide', raison: 'appli_non_choisie' };
      if (!src.ficheAppli) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      const f = src.ficheAppli(w.module);
      if (!f || f.id !== w.module) return { etat: 'vide', raison: 'appli_retiree' };
      if (!f.active) return { etat: 'source_absente', raison: 'appli_absente' };
      const vw = await src.vue(f.id);
      // Les chiffres clés tels que l'appli les donne ; que des zéros, des tirets ou des mots : aucun (jamais un faux chiffre).
      const lus = (Array.isArray(vw?.kpis) ? vw.kpis : []).slice(0, KPIS_MAX).map(kpiLu).filter((k) => k !== undefined);
      const kpis = lus.some((k) => porteUneMesure(k.value)) ? lus : [];
      // Ses alertes pas encore vues (lues au nom de qui regarde) : des comptes, ni titre ni détail.
      const al = src.alertesAVoir ? src.alertesAVoir().filter((a) => a.appli === f.id) : undefined;
      const lui = l.qui === 'proprietaire' && l.ecran === 'accueil';
      return { etat: 'ok', at: src.maintenant(), donnee: {
        appli: f.id, famille: mot(f.family, MOT_MAX), phrase: mot(f.what, PHRASE_MAX), kpis,
        ...(al ? { alertes: { aVoir: al.length, graves: al.filter((a) => GRAVES.includes(String(a.niveau))).length } } : {}),
        ...(vw ? {} : { muette: true }),
        // Les actions rapides : au propriétaire seul, sur l'accueil seul (ni un membre, ni l'écran de la maison).
        // Comme sa page : sans l'action qu'elle réserve à son écran « Sur quel poste ? » (postes.ensuite).
        ...(lui ? { actions: f.actions.filter((a) => ID_ACTION.test(String(a.id)) && a.id !== vw?.postes?.ensuite?.action).slice(0, ACTIONS_MAX).map((a) => ({ id: a.id, label: mot(a.label, MOT_MAX), grave: a.grave === true })) } : {}),
      } };
    },
  },
  {
    // « Raccourcis d'applis » (la maquette : « launcher ») : les applis épinglées de qui regarde (les épingles du menu,
    // par compte), dans leur ordre, chacune avec son nom du catalogue ; la page les dessine en tuiles qui ouvrent l'appli.
    // Aucune appli écrite ici. Une appli retirée d'Odin ou désactivée n'est pas servie (ni son identifiant) ; un membre
    // ne reçoit que les applis où il a le droit, sans même que le nom des autres soit lu ; aucune : « vide ». Ce sont les
    // épingles d'une personne : jamais sur l'écran de la maison (au mur, lu par toute la maison), à personne.
    id: 'raccourcis', famille: 'applis', applis: [], taille: { mini: [3, 2], r: 2 }, styles: ['simple'], public: 'membre', posable: true,
    nettoyer: (o, out, t) => { if (o.label) out.label = t.str(o.label, 40); return true; },
    lire: async (_w, src, l): Promise<EtatWidget> => {
      if (l.ecran !== 'accueil') return { etat: 'refuse', raison: 'accueil_seul' };
      if (l.qui !== 'proprietaire' && l.qui !== 'membre') return { etat: 'refuse', raison: 'pas_pour_une_tablette' };
      if (!src.epingles) return { etat: 'source_absente', raison: 'pas_encore_lu' };
      const ids = src.epingles(l.qui);
      if (!ids) return { etat: 'source_absente', raison: 'epingles_illisibles' };
      const applis: Array<{ appli: string; nom: string }> = [];
      for (const id of new Set(ids)) {
        if (applis.length >= RACCOURCIS_MAX) break;
        if (typeof id !== 'string' || !ID_RACCOURCI.test(id) || (l.qui === 'membre' && l.peutLire?.(id) !== true)) continue;
        const a = src.appli(id); // une appli retirée ou désactivée : rien
        if (a && a.id === id) applis.push({ appli: a.id, nom: mot(a.name, MOT_MAX) });
      }
      return applis.length ? { etat: 'ok', at: src.maintenant(), donnee: { applis } } : { etat: 'vide', raison: 'aucune_epingle' };
    },
  },
] as const satisfies readonly SorteWidget[];
