// Genèse · les écrans communs au démarrage par le RÉSEAU (PXE) et à la CLÉ USB : les visuels partagés qu'on voit
// partout. Odin animé (ses deux yeux en pastille blancs, ses halos — la mascotte « yeux seuls », rien d'autre), les
// trois points de chargement, la barre au thème, la ligne « Serveur Odin IP:port » (réseau) ou « Installation clé
// USB » (clé), et la fenêtre plein écran d'Odin ouverte en fin d'installation.
//
// La mascotte réutilise le DESSIN OFFICIEL d'Odin (le même squelette SVG que l'interface web et window.OdinFace :
// corps en dégradé, deux halos qui tournent, deux pastilles blanches) ; aucun fichier de la mascotte n'est modifié.
// On n'ajoute jamais de bouche, de sourcils, de joues : seulement les yeux et la couleur. Tout est en ligne (pas de
// script externe) : ça passe la règle de sécurité stricte de la page /ecran et ça marche hors ligne sur la clé.
// Fonctions PURES : elles renvoient du HTML/CSS/SVG en texte, elles n'écrivent rien.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { THEME_BARRES, barreTexte } from './ecran.ts';
import type { TextTheme, Theme } from './ecran.ts';

// ---------------------------------------------------------------------------------------------------------------
// L'ÉCRAN DE DÉMARRAGE GRAPHIQUE (lots C6 et S10) : LE MÊME pour la clé ODIN et pour le démarrage par le réseau.
// Sa seule source est src/web/pages/thjalfi-cle-menu.js (window.OdinGeneseCleMenu.ecran) : la page servie aux PC
// (ecran-page.ts), la copie hors ligne de la clé (ecran-offline.ts) et l'aperçu de la page Clés USB sont faits
// avec les MÊMES fonctions. On le lit ici une fois (comme les essais lisent face.js), sans rien exécuter d'autre.
// ---------------------------------------------------------------------------------------------------------------

/** Ce que l'écran de démarrage expose (voir src/web/pages/thjalfi-cle-menu.js). */
export interface EcranDemarrage {
  page(): string;
  css(): string;
  corps(): string;
  logique: {
    mot(mots: Record<string, Record<string, string>>, langue: string, k: string, v?: Record<string, unknown>): string;
    categorie(c: unknown): string;
    modesPour(source: SourceEcran, modes: unknown): string[];
    ordonner<T extends { id: unknown }>(systemes: T[], ordre?: unknown, caches?: unknown): T[];
    apparencePour(source: SourceEcran, r?: unknown): Apparence;
    cibleDefaut(systemes: Array<{ id: unknown; modes?: string[] }>, source: SourceEcran, defaut?: string): { id: string; mode: string } | null;
    sousTitre(x: unknown): string;
    descCle(x: unknown, source: SourceEcran): string;
    clavier(k: string, s: { vue: string; sel: number; n: number; pas?: number; cle?: boolean; shift?: boolean }): Record<string, unknown> | null;
  };
  donnees(): { MOTS: Record<string, Record<string, string>>; THEMES: string[]; SEQ: EtapeArrivee[]; DUREE: number; TEINTES: Record<string, string[]> };
  FORMES: Record<string, string[]>;
  POSES: Record<string, { yeux: string; echelle: [number, number] }>;
  SEQUENCE: EtapeArrivee[];
  DUREE: number;
  MOTS: Record<string, Record<string, string>>;
  THEMES: string[];
}
/** D'où démarre le PC : la clé ODIN ou le réseau. */
export type SourceEcran = 'cle' | 'reseau';
/** Une étape de l'arrivée d'Odin : à `a` ms, telle émotion, telle marque (zzz, !, ♥), et s'il se met en marche. */
export interface EtapeArrivee { a: number; pose: 'sommeil' | 'surprise' | 'neutre' | 'joie' | 'amour'; marque: '' | 'zzz' | '!' | '♥'; marche?: boolean }
/** L'apparence commune (clé et réseau) : thème graphique, thème texte, mode au démarrage, Odin à l'ouverture, délai. */
export interface Apparence { theme: string; texte: string; mode: 'graphique' | 'texte'; mascotte: boolean; delai: number }

let partage: EcranDemarrage | undefined;
/** L'écran de démarrage partagé (lu une fois dans src/web/pages/thjalfi-cle-menu.js). */
export function ecranDemarrage(): EcranDemarrage {
  if (!partage) {
    const window: { OdinGeneseCleMenu?: { ecran: EcranDemarrage } } = {};
    runInNewContext(readFileSync(new URL('../../web/pages/thjalfi-cle-menu.js', import.meta.url), 'utf8'), { window });
    if (!window.OdinGeneseCleMenu?.ecran) throw new Error('écran de démarrage introuvable (thjalfi-cle-menu.js)');
    partage = window.OdinGeneseCleMenu.ecran;
  }
  return partage;
}
/** Une copie « de ce monde » d'une donnée venue de l'écran partagé (les objets nés dans le bac à sable). */
const copie = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
/** L'arrivée d'Odin, pas à pas : il dort (zzz), sursaute (!), se déplace par petits sauts, est content (♥). */
export const sequenceArrivee = (): EtapeArrivee[] => copie(ecranDemarrage().SEQUENCE);
/** Ce que l'écran propose pour un système selon la source : « Installer pour moi » seulement par le réseau. Pur. */
export const modesPour = (source: SourceEcran, modes: unknown): string[] => copie(ecranDemarrage().logique.modesPour(source, modes));
/** Les systèmes dans l'ordre choisi, sans les cachés. Pur. */
export const ordonnerSystemes = <T extends { id: unknown }>(systemes: T[], ordre?: unknown, caches?: unknown): T[] => {
  const ids = ecranDemarrage().logique.ordonner(systemes.map((x, i) => ({ id: x.id, i })), ordre, caches) as unknown as Array<{ i: number }>;
  return ids.map((x) => systemes[x.i]);
};
/** L'apparence de l'écran pour la clé ou le réseau (un seul réglage commun ; « Mêmes thèmes que mes clés ODIN »). Pur. */
export const apparencePour = (source: SourceEcran, reglages?: unknown): Apparence => copie(ecranDemarrage().logique.apparencePour(source, reglages ?? {}));
/** La ligne de la barre du menu : « démarrage depuis la clé » ou « démarrage par le réseau » (dans la langue voulue). */
export const ligneBarre = (source: SourceEcran, langue = 'fr'): string => ecranDemarrage().logique.mot(ecranDemarrage().MOTS, langue, source === 'cle' ? 'barre.cle' : 'barre.reseau');

/** Les quatre teintes du corps d'Odin (centre → bord), reprises de l'humeur « tranquille » (face.js). */
export type Teintes = [string, string, string, string];
/** La teinte par défaut d'Odin : son bleu « tranquille » (identique au squelette de l'interface web). */
export const TEINTE_ODIN: Teintes = ['#2F6FE0', '#3F82F0', '#7EAEF8', '#C3DBFF'];

/**
 * Le DESSIN officiel d'Odin, figé, en SVG autonome (120×120). C'est le même squelette que l'interface web et que
 * window.OdinFace : corps rond en dégradé, deux halos, et SEULEMENT deux pastilles blanches (yeux seuls). `anime`
 * ajoute l'animation douce (halos qui tournent, respiration) par des classes CSS ; figé (false) il ne bouge pas,
 * pour une image GRUB ou une capture. Pur. On ne modifie jamais face.js : on réutilise son dessin.
 */
export function odinSvg(o: { tint?: Teintes; anime?: boolean; classe?: string } = {}): string {
  const t = o.tint ?? TEINTE_ODIN;
  const cls = `odin-fige${o.anime ? ' anime' : ''}${o.classe ? ` ${o.classe}` : ''}`;
  return `<svg class="${cls}" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" focusable="false" aria-hidden="true">`
    + '<defs>'
    + `<radialGradient id="odBody" cx="50%" cy="46%" r="54%"><stop offset="0" stop-color="${t[0]}"/><stop offset=".5" stop-color="${t[1]}"/><stop offset=".82" stop-color="${t[2]}"/><stop offset="1" stop-color="${t[3]}"/></radialGradient>`
    + `<radialGradient id="odHalo" cx="50%" cy="50%" r="50%"><stop offset=".8" stop-color="${t[3]}" stop-opacity=".65"/><stop offset=".93" stop-color="${t[3]}" stop-opacity=".38"/><stop offset="1" stop-color="${t[3]}" stop-opacity="0"/></radialGradient>`
    + '<radialGradient id="odHalo2" cx="50%" cy="50%" r="50%"><stop offset=".8" stop-color="#FFFFFF" stop-opacity=".72"/><stop offset=".93" stop-color="#FFFFFF" stop-opacity=".4"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>'
    + '<filter id="odSoft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation=".8"/></filter>'
    + '<filter id="odBlur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1"/></filter>'
    + '</defs>'
    + '<g class="o-orbit o1"><circle cx="63" cy="64" r="49" fill="url(#odHalo)" filter="url(#odBlur)"/></g>'
    + '<g class="o-orbit o2"><circle cx="57.5" cy="57" r="48" fill="url(#odHalo2)" filter="url(#odBlur)"/></g>'
    + '<g class="o-body"><circle cx="60" cy="60" r="44" fill="url(#odBody)" filter="url(#odSoft)"/>'
    + '<g class="o-eyes"><rect x="43" y="45" width="9" height="22" rx="4.5" fill="#fff"/><rect x="68" y="45" width="9" height="22" rx="4.5" fill="#fff"/></g>'
    + '</g></svg>';
}

/** Le CSS des visuels communs (animation d'Odin, 3 points, barre), posé une fois par page. Respecte reduced-motion. Pur. */
export function cssCommuns(): string {
  return `.odin-fige{display:block}
.odin-fige .o-orbit{transform-origin:60px 60px}
.odin-fige.anime .o1{animation:od-orbite 7s linear infinite}
.odin-fige.anime .o2{animation:od-orbite 9s linear infinite reverse}
.odin-fige.anime .o-body{transform-origin:60px 60px;animation:od-souffle 3.4s ease-in-out infinite}
@keyframes od-orbite{to{transform:rotate(360deg)}}
@keyframes od-souffle{0%,100%{transform:scale(1)}50%{transform:scale(1.03)}}
.od-points{display:inline-flex;gap:9px;justify-content:center;margin-top:16px}
.od-points i{width:11px;height:11px;border-radius:50%;background:var(--acc,#fff);opacity:.35;animation:od-point 1.2s ease-in-out infinite}
.od-points i:nth-child(2){animation-delay:.2s}.od-points i:nth-child(3){animation-delay:.4s}
@keyframes od-point{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-5px)}}
.od-barre{height:14px;border-radius:8px;overflow:hidden}
.od-barre i{display:block;height:100%;transition:width .6s ease}
.od-serveur{font-size:13px;letter-spacing:.04em;opacity:.85}
@media (prefers-reduced-motion:reduce){.odin-fige.anime .o1,.odin-fige.anime .o2,.odin-fige.anime .o-body,.od-points i,.od-barre i{animation:none;transition:none}}`;
}

/**
 * Le PREMIER CHARGEMENT (avant le menu) : Odin animé au centre, les trois points juste en dessous, et la ligne
 * serveur/clé en petit. Renvoie un fragment HTML (à poser dans la page ; le CSS vient de cssCommuns). Pur.
 */
export function premierChargement(o: { tint?: Teintes; serveur: ServeurOuCle; titre?: string } = { serveur: 'cle' }): string {
  return `<div class="od-premier" style="text-align:center">`
    + `<div style="width:132px;height:132px;margin:0 auto">${odinSvg({ tint: o.tint, anime: true })}</div>`
    + (o.titre ? `<h1 style="margin:14px 0 0">${echap(o.titre)}</h1>` : '')
    + `<div class="od-points"><i></i><i></i><i></i></div>`
    + `<div class="od-serveur" style="margin-top:18px">${echap(ligneServeur(o.serveur))}</div>`
    + `</div>`;
}

/** D'où vient l'écran : le serveur réseau (avec son adresse et son port) ou la clé USB. */
export type ServeurOuCle = 'cle' | { ip: string; port?: number };

/**
 * La ligne affichée partout, en petit et lisible : « Serveur Odin 192.168.x.x » (avec « :port » quand il en faut
 * un, ex. « :8888 » pour HTTP) pour le démarrage réseau, ou « Installation clé USB » pour la clé. Pur.
 */
export function ligneServeur(s: ServeurOuCle): string {
  if (s === 'cle') return 'Installation clé USB';
  const port = s.port && s.port !== 80 ? `:${s.port}` : '';
  return `Serveur Odin ${s.ip}${port}`;
}

/**
 * La BARRE DE PROGRESSION au thème (vue « chargement » après le choix d'un système). Renvoie le HTML de la barre,
 * aux couleurs du thème graphique. `pct` connu = un vrai pourcentage ; `pct` à null = une barre qui avance sans
 * mentir (on met une largeur modérée et on anime en CSS côté page). Pur.
 */
export function barreDuTheme(theme: Theme, pct: number | null): string {
  const b = THEME_BARRES[theme] ?? THEME_BARRES.bleu;
  const largeur = pct == null ? 35 : Math.max(0, Math.min(100, Math.round(pct)));
  const indef = pct == null ? ' od-indef' : '';
  return `<div class="od-barre${indef}" style="background:${b.track};box-shadow:0 0 18px ${b.glow}">`
    + `<i style="width:${largeur}%;background:${b.fill}"></i></div>`;
}

/** La même barre, mais en TEXTE (menu GRUB / iPXE), aux glyphes du thème texte. Pur. Dit par le chargeur quand il le permet. */
export function barreDuThemeTexte(texte: TextTheme, pct: number): string {
  return barreTexte(texte, pct);
}

const echap = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * La FENÊTRE PLEIN ÉCRAN d'Odin ouverte en FIN d'installation (première ouverture de session Windows, premier
 * démarrage d'Ubuntu) : Odin animé, les trois points, et une barre qui suit les logiciels qui s'installent. Page
 * locale autonome (aucun serveur, aucun script externe) ouverte en kiosque par le script de fin ; elle interroge un
 * petit fichier d'avancement local (avancement.json) et se ferme toute seule quand tout est posé. Pur : renvoie le
 * HTML de la page. `theme` habille la barre ; `titre` par défaut « Installation en cours ».
 */
export function fenetreFin(o: { theme: Theme; tint?: Teintes; titre?: string; etatUrl?: string } = { theme: 'bleu' }): string {
  const etat = o.etatUrl ?? 'avancement.json';
  const acc = THEME_BARRES[o.theme] ?? THEME_BARRES.bleu;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>Odin · fin de l'installation</title><style>`
    + `*{box-sizing:border-box}html,body{margin:0;height:100%}`
    + `body{display:flex;align-items:center;justify-content:center;background:radial-gradient(1200px 700px at 50% 30%,#2a4bd1,#0b1440 70%);color:#eef2ff;font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;--acc:#fff}`
    + `.wrap{max-width:560px;text-align:center;padding:24px}.wrap h1{font-size:30px;margin:18px 0 4px}.wrap p{color:#9fb0d8;margin:4px 0}`
    + `.od-logiciel{margin-top:10px;font-size:14px;color:#cdd8f5;min-height:20px}`
    + cssCommuns()
    + `</style></head><body><div class="wrap">`
    + `<div style="width:150px;height:150px;margin:0 auto">${odinSvg({ tint: o.tint, anime: true })}</div>`
    + `<h1>${echap(o.titre ?? 'Installation en cours')}</h1>`
    + `<p>Odin installe tes logiciels. Cette fenêtre se ferme toute seule à la fin.</p>`
    + `<div class="od-points"><i></i><i></i><i></i></div>`
    + `<div class="od-barre" style="margin-top:22px;background:${acc.track};box-shadow:0 0 18px ${acc.glow}"><i id="pg" style="width:0;background:${acc.fill}"></i></div>`
    + `<div class="od-logiciel" id="quoi"></div>`
    + `</div><script>'use strict';
var pg=document.getElementById('pg'),quoi=document.getElementById('quoi');
function tour(){fetch(${JSON.stringify(etat)},{cache:'no-store'}).then(function(r){return r.json();}).then(function(s){
 var p=Math.max(0,Math.min(100,s.pct||0));pg.style.width=p+'%';quoi.textContent=s.quoi||'';
 if(s.fini||p>=100){quoi.textContent='C\\'est prêt.';setTimeout(function(){try{window.close();}catch(e){}},2500);return;}
 setTimeout(tour,1500);}).catch(function(){setTimeout(tour,2500);});}
tour();
</script></body></html>`;
}

/**
 * Un fond d'écran / écran de démarrage (Plymouth) aux couleurs du thème, à poser EN OPTION par le script de fin
 * (jamais imposé). Renvoie un SVG de fond (logo + Odin figé) ; le lot A le transforme en image si on l'a choisi. Pur.
 */
export function fondDuTheme(o: { tint?: Teintes; titre?: string } = {}): string {
  return `<svg viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">`
    + `<rect width="1920" height="1080" fill="#0b1440"/>`
    + `<g transform="translate(830,380) scale(2.2)">${odinSvg({ tint: o.tint })}</g>`
    + `<text x="960" y="760" text-anchor="middle" fill="#eef2ff" font-family="sans-serif" font-size="54" font-weight="700" letter-spacing="8">ODIN</text>`
    + (o.titre ? `<text x="960" y="820" text-anchor="middle" fill="#9fb0d8" font-family="sans-serif" font-size="26">${echap(o.titre)}</text>` : '')
    + `</svg>`;
}
