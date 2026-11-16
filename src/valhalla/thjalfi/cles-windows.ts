// Genèse · clés d'activation Windows — le propriétaire dépose SES PROPRES clés (une par édition de Windows). Odin les
// garde chiffrées dans le coffre (jamais en clair sur le disque, jamais dans les journaux, jamais renvoyées en entier
// à la page : seuls les 5 derniers caractères sont montrés). Au déploiement d'une image Windows, si une clé est
// déposée pour l'édition de CETTE image, Odin l'écrit dans le fichier de réponses (unattend.xml) ; sinon il laisse la
// place vide et Windows s'installe sans activation (permis). Odin ne fait que RANGER et UTILISER des clés fournies :
// il n'en génère aucune, ne contourne rien, n'active rien en masse.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chiffrerChamp, dechiffrerChamp } from '../../vault.ts';

/**
 * Les éditions de Windows reconnues (une clé par édition). `mots` : des groupes de mots ; une édition est reconnue
 * dans le nom d'une image quand CHAQUE groupe a au moins un de ses mots présent. L'ordre va du plus précis au plus
 * général (Server et Entreprise avant Pro et Famille).
 */
export interface Edition { id: string; label: string; mots: string[][] }
export const EDITIONS: Edition[] = [
  { id: 'windows-server-2025', label: 'Windows Server 2025', mots: [['server'], ['2025']] },
  { id: 'windows-server-2022', label: 'Windows Server 2022', mots: [['server'], ['2022']] },
  { id: 'windows-server-2019', label: 'Windows Server 2019', mots: [['server'], ['2019']] },
  { id: 'windows-11-entreprise', label: 'Windows 11 Entreprise', mots: [['11'], ['entreprise', 'enterprise']] },
  { id: 'windows-11-pro', label: 'Windows 11 Pro', mots: [['11'], ['pro', 'professionnel', 'professional']] },
  { id: 'windows-11-famille', label: 'Windows 11 Famille', mots: [['11'], ['famille', 'home', 'familiale']] },
  { id: 'windows-10-entreprise', label: 'Windows 10 Entreprise', mots: [['10'], ['entreprise', 'enterprise']] },
  { id: 'windows-10-pro', label: 'Windows 10 Pro', mots: [['10'], ['pro', 'professionnel', 'professional']] },
  { id: 'windows-10-famille', label: 'Windows 10 Famille', mots: [['10'], ['famille', 'home', 'familiale']] },
];
export const editionParId = (id: string): Edition | undefined => EDITIONS.find((e) => e.id === id);
/** L'édition d'après ce que choisit le propriétaire : par identifiant OU par libellé exact (casse ignorée). Pur. */
export function editionDepuisChoix(choix: string): Edition | undefined {
  const c = (choix ?? '').trim().toLowerCase();
  return EDITIONS.find((e) => e.id === c || e.label.toLowerCase() === c);
}

/** Le nom d'une image, mis à plat (minuscules, sans accents) pour la reconnaissance. Pur. */
const aplat = (s: string) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Un mot présent comme token : pour un nombre (« 11 »), bornes entre chiffres seulement (« win11 » compte, « 2011 » non) ; pour un mot, bornes entre lettres/chiffres (« pro » compte, pas « professionnel »). Pur. */
function motPresent(texte: string, mot: string): boolean {
  const bord = /^[0-9]+$/.test(mot) ? '[^0-9]' : '[^a-z0-9]';
  return new RegExp(`(^|${bord})${mot}(${bord}|$)`).test(texte);
}
/**
 * L'édition reconnue dans le nom (et le libellé) d'une image Windows, ou rien si le nom ne la dit pas clairement.
 * On ne devine jamais : sans certitude, aucune clé n'est injectée (Windows s'installe sans activation). Pur.
 */
export function editionDeImage(nom: string, label = ''): Edition | undefined {
  const t = `${aplat(nom)} ${aplat(label)}`;
  return EDITIONS.find((e) => e.mots.every((groupe) => groupe.some((m) => motPresent(t, m))));
}

/** Le format d'une clé Windows : 5 groupes de 5 caractères (lettres et chiffres) séparés par des tirets. */
const RE_CLE = /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/;
/** Nettoie et vérifie une clé saisie (espaces, tirets et casse tolérés). Rend la clé normalisée, ou rien si le format est faux. Pur. */
export function normaliserCle(brute: string): string | undefined {
  const compact = (brute ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.length !== 25) return undefined;
  const avecTirets = compact.replace(/(.{5})(?=.)/g, '$1-');
  return RE_CLE.test(avecTirets) ? avecTirets : undefined;
}
/** Les 5 derniers caractères d'une clé (ce qu'on montre, le reste masqué). Pur. */
export const indiceCle = (cle: string): string => cle.slice(-5);
/** L'affichage masqué d'une clé d'après son indice (jamais la clé entière). Pur. */
export const masque = (indice: string): string => `•••••-•••••-•••••-•••••-${indice}`;

/** Une clé rangée (sur le disque) : la clé elle-même est chiffrée (coffre), jamais en clair. */
interface CleRangee { edition: string; indice: string; chiffre: string; pose: number }
/** Vue publique d'une clé pour la page : jamais la clé en entier, seulement son indice. */
export interface CleVue { id: string; edition: string; indice: string; pose: number }

const fichier = (dir: string) => join(dir, 'cles-windows.json');
function lire(dir: string): Record<string, CleRangee> {
  try { const o = JSON.parse(readFileSync(fichier(dir), 'utf8')) as unknown; return o && typeof o === 'object' ? o as Record<string, CleRangee> : {}; } catch { return {}; }
}
function ecrire(dir: string, x: Record<string, CleRangee>): void {
  mkdirSync(dir, { recursive: true });
  const f = fichier(dir); writeFileSync(`${f}.tmp`, JSON.stringify(x), { mode: 0o600 }); renameSync(`${f}.tmp`, f);
}
/** La liste masquée pour la page : édition, indice (5 derniers), date. Jamais la clé en entier. */
export function clesPubliques(dir: string): CleVue[] {
  return Object.entries(lire(dir)).map(([id, c]) => ({ id, edition: c.edition, indice: c.indice, pose: c.pose }))
    .sort((a, b) => a.edition.localeCompare(b.edition, 'fr'));
}
/** Une clé est-elle déposée pour cette édition ? */
export const aUneCle = (dir: string, editionId: string): boolean => Boolean(lire(dir)[editionId]);
/** Dépose (ou remplace) la clé d'une édition : vérifiée, chiffrée par le coffre (clé de la machine), rangée. Rend l'indice. */
export function deposerCle(home: string, dir: string, editionId: string, cleBrute: string): { edition: string; indice: string } {
  const ed = editionParId(editionId); if (!ed) throw new Error('édition de Windows inconnue');
  const cle = normaliserCle(cleBrute); if (!cle) throw new Error('clé invalide : format attendu XXXXX-XXXXX-XXXXX-XXXXX-XXXXX');
  const all = lire(dir);
  all[ed.id] = { edition: ed.label, indice: indiceCle(cle), chiffre: chiffrerChamp(home, cle), pose: Date.now() };
  ecrire(dir, all);
  return { edition: ed.label, indice: indiceCle(cle) };
}
/** Supprime la clé d'une édition. */
export function supprimerCle(dir: string, editionId: string): boolean {
  const all = lire(dir); if (!all[editionId]) return false; delete all[editionId]; ecrire(dir, all); return true;
}
/**
 * La clé en clair pour une édition (déchiffrée du coffre), ou rien. À n'utiliser qu'au moment du déploiement ;
 * ne jamais la mettre dans un journal ni la renvoyer à la page.
 */
export function cleEnClair(home: string, dir: string, editionId: string): string | undefined {
  const c = lire(dir)[editionId]; if (!c) return undefined;
  try { return dechiffrerChamp(home, c.chiffre); } catch { return undefined; }
}
/** La clé à injecter pour une image Windows donnée : l'édition reconnue dans son nom, puis sa clé déposée (ou rien). */
export function clePourImage(home: string, dir: string, nom: string, label = ''): string | undefined {
  const ed = editionDeImage(nom, label); return ed ? cleEnClair(home, dir, ed.id) : undefined;
}
/** Le fichier des clés existe-t-il (au moins une clé déposée) ? */
export const fichierCles = (dir: string): boolean => existsSync(fichier(dir));
