// Les nouveaux noms des applis d'Odin et des parties de leurs fiches (maquette « Icônes et noms d'Odin »,
// validés par toi le 13/11/2026). Les identifiants ne changent pas (réglages, adresses, historique) : seul le nom
// affiché change. Les anciens noms sont oubliés : Odin ne les affiche plus et ne les comprend plus.
import type { Module } from './types.ts';

/** Nom affiché de chaque appli (identifiant → nom). */
export const NAMES: Record<string, string> = {
 "huginn": "Logos",
 "muninn": "Mnémosyne",
 "yggdrasil": "Athéna",
 "hlidskjalf": "Horus",
 "saga": "Thot",
 "runes": "Papyrus",
 "draupnir": "Talos",
 "urdr": "Alexandrie",
 "skidbladnir": "Nébuleuse",
 "fjalar": "Hermès",
 "volva": "Pythie",
 "frigg": "Chronos",
 "kvasir": "Pharos",
 "commandes": "Glyphes",
 "syn": "Zénith",
 "eir": "Hygie",
 "naglfar": "Argo",
 "ymir": "Hydre",
 "idunn": "Arachné",
 "sindri": "Phénix",
 "vordr": "Pulsar",
 "askr": "Atlas",
 "thjalfi": "Genèse",
 "skogul": "Némésis",
 "garmr": "Cerbère",
 "geri": "Méduse",
 "ran": "Ariane",
 "ullr": "Asclépios",
 "loki": "Sirènes",
 "svalinn": "Zéphyr",
 "gjoll": "Vortex",
 "vidarr": "Sphinx",
 "var": "Persona",
 "bru": "Bifröst",
 "ratatoskr": "Interprète",
 "gladsheim": "Hestia",
 "himinbjorg": "Cyclope",
 "aegir": "Apollon",
 "apparence": "Aurore",
 "freyja": "Vénus",
 "sessrumnir": "Odéon",
 "bygul": "Delta",
 "gersemi": "Sirius",
 "hildisvini": "Pléiades",
 "sjofn": "Odyssée",
 "folkvangr": "Comète",
 "dvalinn": "Alchimie",
 "mimisbrunnr": "Chroniques",
 "gefjon": "Héraclès",
 "sol": "Hélios",
 "fensalir": "Pyramide",
 "hlid": "Thermopyles",
 "ivaldi": "Dédale",
 "snotra": "Plume",
 "champollion": "Champollion",
 "leikvangr": "Olympie",
 "skuld": "Arche",
 "rodd": "Écho",
 "eitri": "Andromède",
 "hermod": "Satellites",
 "brisingamen": "Thésauros",
 "appareils": "Constellation",
 "brokkr": "Héphaïstos",
 "bragi": "Orphée",
 "heidrun": "Héra"
};
/** Les anciens noms : seulement pour retrouver les fiches déjà écrites sous l'ancien nom et les renommer.
 *  Odin ne les comprend plus et ne les affiche plus (tu as validé les nouveaux). */
export const OLD_NAMES: Record<string, string> = {
 "huginn": "Huginn",
 "muninn": "Muninn",
 "yggdrasil": "Yggdrasil",
 "hlidskjalf": "Hliðskjálf",
 "saga": "Saga",
 "runes": "Runes",
 "draupnir": "Draupnir",
 "urdr": "Urðr",
 "skidbladnir": "Skíðblaðnir",
 "fjalar": "Fjalar",
 "volva": "Völva",
 "frigg": "Frigg",
 "kvasir": "Kvasir",
 "commandes": "Commandes",
 "syn": "Sýn",
 "eir": "Eir",
 "naglfar": "Naglfar",
 "ymir": "Ymir",
 "idunn": "Idunn",
 "sindri": "Sindri",
 "vordr": "Vörðr",
 "askr": "Askr",
 "thjalfi": "Þjálfi",
 "skogul": "Skögul",
 "garmr": "Garmr",
 "geri": "Geri",
 "ran": "Rán",
 "ullr": "Ullr",
 "loki": "Loki",
 "svalinn": "Svalinn",
 "gjoll": "Gjöll",
 "vidarr": "Víðarr",
 "var": "Vár",
 "bru": "Brú",
 "ratatoskr": "Ratatoskr",
 "gladsheim": "Glaðsheimr",
 "himinbjorg": "Himinbjörg",
 "aegir": "Ægir",
 "apparence": "Apparence",
 "freyja": "Freyja",
 "sessrumnir": "Sessrúmnir",
 "bygul": "Bygul",
 "gersemi": "Gersemi",
 "hildisvini": "Hildisvíni",
 "sjofn": "Sjöfn",
 "folkvangr": "Fólkvangr",
 "dvalinn": "Dvalinn",
 "mimisbrunnr": "Mímisbrunnr",
 "gefjon": "Gefjon",
 "sol": "Sól",
 "fensalir": "Fensalir",
 "hlid": "Hlið",
 "ivaldi": "Ívaldi",
 "snotra": "Snotra",
 "champollion": "Reconnaissance",
 "leikvangr": "Leikvangr",
 "skuld": "Skuld",
 "rodd": "Rödd",
 "eitri": "Eitri",
 "hermod": "Hermod",
 "brisingamen": "Brísingamen",
 "appareils": "Appareils",
 "brokkr": "Brokkr",
 "bragi": "Bragi",
 "heidrun": "Heiðrún"
};
/** Les parties à l'intérieur des fiches (« Narfi · Telnet » → « Loki · Telnet »). */
export const PART_NAMES: Record<string, string> = {
 "Vígríðr": "Artémis",
 "Freki": "Clio",
 "Váli": "Hippocrate",
 "Galdr": "Grimoire",
 "Narfi": "Loki",
 "Fenrir": "Charybde",
 "Narfi-SSH": "Polyphème",
 "Sköll": "Labyrinthe",
 "Hel": "Léthé",
 "Thrym": "Pandore",
 "Skrymir": "Calypso",
 "Jörmungandr": "Troie",
 "Bergelmir": "Gorgone",
 "Logi": "Cassandre",
 "Hræsvelg": "Éole",
 "Surtr": "Hécatonchires",
 "Andvari": "Osiris",
 "Hvergelmir": "Oïkos",
 "Gjallarbrú": "Charon",
 "Gleipnir": "Orion",
 "Skírnir": "Phaéton",
 "Hjúki": "Mélissa",
 "Bil": "Néréide",
 "Alfheim": "Atome",
 "Gná": "Ondine",
 "Veðrfölnir": "Mercure",
 "Ýdalir": "Mosaïque",
 "Breiðablik": "Écume",
 "Vör": "Stentor",
 "Víðarr": "Sphinx",
 "Gjallarhorn": "Triton",
 "Ran": "Euterpe",
 "Nornes": "Moires",
 "Sessrúmnir": "Odéon",
 "Bygul": "Delta",
 "Gersemi": "Sirius",
 "Hildisvíni": "Pléiades",
 "Sjöfn": "Odyssée",
 "Fólkvangr": "Comète"
};

/** « Vígríðr · chasse aux menaces » → « Artémis · chasse aux menaces ». Pur. */
export function renamePart(label: string): string {
  const m = /^(.+?)( · .*)?$/.exec(label); if (!m) return label;
  const n = PART_NAMES[m[1]]; return n ? `${n}${m[2] ?? ''}` : label;
}
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ð/g, 'd').replace(/þ/g, 'th').replace(/æ/g, 'ae');
/** Anciens noms qui sont aussi des mots courants : on les garde comme mots-clés (« mes appareils »). */
const COMMON = new Set(['appareils', 'commandes', 'apparence', 'reconnaissance']);
/** Vrai si l'identifiant interne d'une appli est un ancien nom oublié (« garmr ») : Odin ne le comprend plus. Pur. */
export function forgetsId(id: string): boolean { const n = NAMES[id]; return !!n && !COMMON.has(id) && fold(n) !== fold(id); }
/** Applique le nouveau nom à une appli : l'ancien nom disparaît aussi de ses mots-clés. */
export function rename(m: Module): Module {
  const n = NAMES[m.id];
  const modes = m.modes?.map(renamePart);
  if (!n && !modes) return m;
  let words = m.words;
  if (n && n !== m.name) {
    const old = new Set([fold(m.name), fold(OLD_NAMES[m.id] ?? m.name), fold(m.id)].filter((w) => w !== fold(n) && !COMMON.has(w)));
    const hasOld = (w: string) => fold(w).split(/[^a-z0-9]+/).some((t) => old.has(t));
    words = [...new Set([...m.words.filter((w) => !hasOld(w)), fold(n), n.toLowerCase()])];
  }
  return Object.assign(m, { ...(n ? { name: n } : {}), words, ...(modes ? { modes } : {}) });
}
