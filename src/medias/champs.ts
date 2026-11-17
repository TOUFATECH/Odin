// Médias reçus : les clés de champs connues (nom en clair, groupe, sensibilité) et l'ajout d'une valeur à une fiche en
// cours. Chaque valeur garde sa source et sa fiabilité ; les doublons et les désaccords sont réglés à la fin par
// `finaliserChamps` (priorité des blocs, puis remarque « deux étiquettes disent des choses différentes »).

import type { Champ, Contexte, DateLue, Fiabilite, FicheEnCours, Groupe, ImageJointe, Manque, Position, TexteInclus } from './contrat.ts';
import { jourSeulement } from './dates.ts';
import { decoderLatin1Douteux, nettoyerTexte } from './octets.ts';
import { distanceKm } from './lieux.ts';

interface DefCle { nom: string; groupe: Groupe; sensible?: true }

const D = (nom: string, groupe: Groupe, sensible?: true): DefCle => (sensible ? { nom, groupe, sensible } : { nom, groupe });

export const CLES: Record<string, DefCle> = {
  titre: D('Titre', 'œuvre'), sous_titre: D('Sous-titre', 'œuvre'), regroupement: D('Regroupement', 'œuvre'),
  album: D('Album', 'œuvre'), album_origine: D('Album d\'origine', 'œuvre'),
  artiste: D('Artiste', 'personnes'), artiste_album: D('Artiste de l\'album', 'personnes'), interprete: D('Interprète', 'personnes'),
  chef: D('Chef d\'orchestre', 'personnes'), remix: D('Remix', 'personnes'), arrangeur: D('Arrangeur', 'personnes'),
  compositeur: D('Compositeur', 'personnes'), parolier: D('Parolier', 'personnes'), artiste_origine: D('Artiste d\'origine', 'personnes'),
  realisateur: D('Réalisation', 'personnes'), producteur: D('Production', 'personnes'), ingenieur: D('Ingénieur du son', 'personnes'),
  musiciens: D('Musiciens', 'personnes'), personnes: D('Personnes impliquées', 'personnes'),
  genre: D('Genre', 'œuvre'), piste: D('Piste', 'œuvre'), disque: D('Disque', 'œuvre'), compilation: D('Compilation', 'œuvre'),
  label: D('Label', 'droits et diffusion'), distributeur: D('Distributeur', 'droits et diffusion'), droits: D('Droits (©)', 'droits et diffusion'),
  production_droits: D('Droits de production (℗)', 'droits et diffusion'), licence: D('Licence', 'droits et diffusion'),
  isrc: D('ISRC', 'droits et diffusion'), code_barres: D('Code-barres (EAN/UPC)', 'droits et diffusion'), catalogue: D('N° de catalogue', 'droits et diffusion'),
  editeur_photo: D('Crédit / source', 'droits et diffusion'),
  // L'heure d'enregistrement d'une vidéo de téléphone (©day, bext) dit quand une personne était là : sensible (le jour
  // reste montré en mode masqué, seule l'heure est cachée).
  date_enregistrement: D('Enregistré le', 'œuvre', true), date_parution: D('Paru le', 'œuvre'), date_origine: D('Parution originale', 'œuvre'),
  date_prise_de_vue: D('Pris le', 'prise de vue', true), date_numerisation: D('Numérisé le', 'prise de vue', true),
  date_modification: D('Modifié le', 'logiciel'), date_creation_fichier: D('Fichier créé le', 'fichier'),
  lieu_enregistrement: D('Lieu d\'enregistrement', 'lieu', true),
  ville: D('Ville', 'lieu', true), region: D('Région', 'lieu', true), pays: D('Pays', 'lieu', true), code_pays: D('Code pays', 'lieu', true), sous_lieu: D('Lieu précis', 'lieu', true),
  appareil_marque: D('Marque de l\'appareil', 'appareil'), appareil_modele: D('Modèle de l\'appareil', 'appareil'), objectif: D('Objectif', 'appareil'),
  numero_serie_boitier: D('N° de série du boîtier', 'appareil', true), numero_serie_objectif: D('N° de série de l\'objectif', 'appareil', true),
  proprietaire_appareil: D('Propriétaire de l\'appareil', 'appareil', true),
  exposition: D('Temps de pose', 'réglages'), ouverture: D('Ouverture', 'réglages'), iso: D('Sensibilité ISO', 'réglages'), focale: D('Focale', 'réglages'),
  focale_35: D('Focale équivalente 24×36', 'réglages'), flash: D('Flash', 'réglages'), mode_exposition: D('Mode d\'exposition', 'réglages'),
  programme: D('Programme', 'réglages'), correction: D('Correction d\'exposition', 'réglages'), mesure: D('Mesure', 'réglages'),
  balance_blancs: D('Balance des blancs', 'réglages'), type_scene: D('Type de scène', 'réglages'),
  logiciel: D('Logiciel', 'logiciel'), description: D('Description', 'œuvre'), commentaire: D('Commentaire', 'œuvre'), mots_cles: D('Mots-clés', 'œuvre'),
  langue_declaree: D('Langue déclarée', 'œuvre'), tempo: D('Tempo (BPM)', 'œuvre'), tonalite: D('Tonalité', 'œuvre'), humeur: D('Humeur', 'œuvre'),
  support: D('Support d\'origine', 'œuvre'), serie: D('Série', 'œuvre'), saison: D('Saison', 'œuvre'), episode: D('Épisode', 'œuvre'),
  proprietaire_fichier: D('Propriétaire du fichier', 'personnes', true), compte_achat: D('Compte d\'achat', 'personnes', true),
  date_achat: D('Acheté le', 'droits et diffusion'), note_ecoute: D('Note', 'œuvre'), identifiant: D('Identifiant', 'technique'),
  auteur_document: D('Auteur', 'document'), modifie_par: D('Modifié par', 'document', true), entreprise: D('Entreprise', 'document'),
  pages: D('Pages', 'document'), mots: D('Mots', 'document'), chiffre: D('Chiffré', 'document'),
  orientation: D('Orientation', 'technique'), dimensions: D('Dimensions', 'technique'), profondeur_couleurs: D('Couleurs', 'technique'),
  animation: D('Animation', 'technique'), encodeur_audio: D('Encodeur', 'technique'),
  // L'origine d'une œuvre (pays de parution ou d'origine déclaré) : une donnée de l'œuvre, pas un lieu de prise de vue.
  origine: D('Origine', 'œuvre'),
};

// ─────────────────────────────── Sensibilité des champs libres ───────────────────────────────

/** Morceaux de nom qui disent un lieu ou qui identifient (recherchés dans le nom en minuscules). */
const NOMS_SENSIBLES = ['location', 'gps', 'geo', 'coord', 'iso6709', 'xyz', 'position', 'lieu', 'place', 'serial', 'owner', 'latitude', 'longitude'];
/** Mots entiers (« lat », « lon ») : cherchés comme mots, pour ne pas masquer « translation » ou « salon ». */
const MOTS_SENSIBLES = new Set(['lat', 'lon', 'lng', 'long', 'alt']);

/** Vrai si le NOM d'une étiquette libre dit une position ou un identifiant (« LOCATION », « GPSLatitude », « ©xyz »). */
export function cleSensible(nom: string): boolean {
  const bas = nom.slice(0, 128).toLowerCase();
  if (NOMS_SENSIBLES.some((x) => bas.includes(x))) return true;
  // Mots : coupure aux non-lettres et aux passages minuscule → majuscule (« GpsLat », « geo_lon »).
  let mot = '';
  const fin = (): boolean => { const m = mot; mot = ''; return MOTS_SENSIBLES.has(m); };
  const s = nom.slice(0, 128);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const lettre = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
    if (!lettre) { if (fin()) return true; continue; }
    const maj = c >= 'A' && c <= 'Z';
    const precMin = i > 0 && s[i - 1] >= 'a' && s[i - 1] <= 'z';
    if (maj && precMin && fin()) return true;
    mot += c.toLowerCase();
  }
  return fin();
}

/**
 * Vrai si une VALEUR ressemble à des coordonnées : « -12.7806+045.2275 » (ISO 6709), « -12.780556,45.227500 »,
 * « 12°46′50″S 45°13′39″E ». Analyse caractère par caractère (aucune expression régulière sur le contenu) : au moins
 * deux nombres, et soit deux nombres décimaux (2 décimales ou plus) dont le premier est une latitude possible, soit
 * des degrés (°) ; en dehors des nombres, seulement des séparateurs et les lettres des points cardinaux.
 */
export function ressembleACoordonnees(v: string): boolean {
  if (v.length > 100) return false;
  const nombres: Array<{ v: number; decimales: number }> = [];
  let degres = false;
  // Virgule décimale (« −12,780600 ; 45,227500 ») seulement quand il n'y a aucun point et qu'un « ; » sépare.
  const virguleDecimale = !v.includes('.') && v.includes(';');
  const chiffre = (x: string | undefined) => x !== undefined && x >= '0' && x <= '9';
  for (let i = 0; i < v.length;) {
    const c = v[i];
    if (chiffre(c) || ((c === '-' || c === '+' || c === '−') && chiffre(v[i + 1]))) {
      let j = i, s = '';
      if (c === '-' || c === '−') { s = '-'; j++; } else if (c === '+') j++;
      while (chiffre(v[j])) s += v[j++];
      let decimales = 0;
      if ((v[j] === '.' || (virguleDecimale && v[j] === ',')) && chiffre(v[j + 1])) {
        s += '.'; j++;
        while (chiffre(v[j])) { s += v[j++]; decimales++; }
      }
      nombres.push({ v: Number(s), decimales });
      if (nombres.length > 8) return false;
      i = j;
      continue;
    }
    if (c === '°') { degres = true; i++; continue; }
    if (' ,;/:\t\'"′″NSEWnsewOo'.includes(c)) { i++; continue; }
    return false;
  }
  if (nombres.length < 2 || nombres.some((x) => !Number.isFinite(x.v))) return false;
  if (degres) return true;
  const [a, b] = nombres;
  return a.decimales >= 2 && b.decimales >= 2 && Math.abs(a.v) <= 90 && Math.abs(b.v) <= 180;
}

/** Les étiquettes libres qui disent l'origine d'une œuvre (pays) : rangées sous « origine ». */
const CLES_ORIGINE = new Set(['country', 'releasecountry', 'release_country', 'origin', 'origin_country', 'country_of_origin', 'musicbrainz album release country']);

/** « YT » → « Mayotte (YT) » ; un autre texte est gardé tel quel. */
function origineEnClair(v: string): string {
  const t = v.trim();
  if (t.length === 2 && /^[A-Za-z]{2}$/.test(t)) {
    try { const n = new Intl.DisplayNames(['fr'], { type: 'region' }).of(t.toUpperCase()); if (n && n !== t.toUpperCase()) return `${n} (${t.toUpperCase()})`; } catch { /* code inconnu */ }
  }
  return v;
}

/** Rang des blocs (plus petit = prioritaire) quand plusieurs disent la même chose. */
const RANG_BLOC: Array<[string, number]> = [
  ['Vorbis', 10], ['ID3v2', 20], ['MP4', 30], ['MKV', 40], ['RIFF', 50], ['APE', 60], ['EXIF', 70], ['TIFF', 70], ['XMP', 80], ['IPTC', 90], ['PNG', 95],
  ['GIF', 96], ['JPEG', 96], ['AIFF', 97], ['ID3v1', 200], ['ffprobe', 300],
];
export function rangSource(source: string): number {
  for (const [p, r] of RANG_BLOC) if (source.startsWith(p)) return r;
  return 150;
}

export interface OptionsChamp {
  brut?: string | number; fiabilite?: Fiabilite; langue?: string; valeurs?: string[]; groupe?: Groupe; nom?: string;
  sensible?: boolean; encodageDouteux?: boolean; candidats?: Array<{ encodage: string; valeur: string }>;
  /** Ajouté au rang du bloc (ordre de priorité à l'intérieur d'une clé : LABEL avant ORGANIZATION…). */
  sousRang?: number;
}

/** Ajoute un champ à la fiche en cours (valeur nettoyée ; vide → rien). */
export function ajouterChamp(f: FicheEnCours, ctx: Contexte, cle: string, valeur: string, source: string, o: OptionsChamp = {}): Champ | undefined {
  const v = nettoyerTexte(valeur, 'utf-8', { max: ctx.budget.bornes.texteChamp }).texte;
  const valeurs = o.valeurs?.map((x) => nettoyerTexte(x).texte).filter(Boolean).slice(0, 256);
  if (!v && !valeurs?.length) return undefined;
  // Origine d'une œuvre déclarée dans une étiquette libre (COUNTRY, ORIGIN…) : rangée sous « origine », code de pays en clair.
  if (cle.startsWith('x:') && CLES_ORIGINE.has(cle.slice(2).toLowerCase())) {
    return ajouterChamp(f, ctx, 'origine', origineEnClair(v), source, { ...o, nom: undefined, groupe: undefined, brut: o.brut ?? v });
  }
  let def = CLES[cle];
  let libreSensible = false;
  if (!def) {
    if (!cle.startsWith('x:')) return undefined;
    if (ctx.travail.libres >= 500) {
      // Au-delà de 500 étiquettes libres : la lecture est dite partielle (jamais une troncature silencieuse).
      if (!f.partiel) f.partiel = 'plus de 500 étiquettes libres : les suivantes ne sont pas lues';
      remarque(f, 'plus de 500 étiquettes libres : les suivantes ne sont pas lues');
      return undefined;
    }
    ctx.travail.libres++;
    def = { nom: o.nom ?? cle.slice(2), groupe: o.groupe ?? 'technique' };
    // Une étiquette libre dont le NOM dit une position ou un identifiant suit le masquage.
    libreSensible = cleSensible(cle.slice(2)) || (o.nom !== undefined && cleSensible(o.nom));
  }
  const c: Champ = {
    cle, nom: o.nom ?? def.nom, valeur: v || valeurs!.join(' ; '), source, fiabilite: o.fiabilite ?? 'sure', groupe: o.groupe ?? def.groupe,
  };
  if (o.brut !== undefined) c.brut = o.brut;
  // Une VALEUR qui ressemble à des coordonnées est sensible, quel que soit le nom de l'étiquette.
  if (def.sensible || o.sensible || libreSensible || ressembleACoordonnees(c.valeur)) c.sensible = true;
  if (o.langue) c.langue = o.langue;
  if (valeurs && valeurs.length > 1) { c.valeurs = valeurs; c.valeur = valeurs.join(' ; '); }
  if (o.encodageDouteux) { c.encodageDouteux = true; if (o.candidats?.length) c.candidats = o.candidats.slice(0, 3); }
  f.champs.push(c);
  ctx.travail.rangs.set(c, rangSource(source) + (o.sousRang ?? 0));
  return c;
}

/** Ajoute un champ depuis des octets d'encodage déclaré ; Latin-1 avec octets ≥ 0x80 → douteux + candidats. */
export function ajouterChampOctets(f: FicheEnCours, ctx: Contexte, cle: string, b: Buffer, enc: string, source: string, o: OptionsChamp = {}): Champ | undefined {
  const { texte, encodageDouteux } = nettoyerTexte(b, enc, { nul: true });
  if (encodageDouteux && (enc === 'latin1' || enc === 'iso-8859-1')) {
    const { candidats } = decoderLatin1Douteux(b.subarray(0, Math.max(0, b.indexOf(0) >= 0 ? b.indexOf(0) : b.length)));
    return ajouterChamp(f, ctx, cle, texte, source, { ...o, encodageDouteux: true, candidats: candidats.filter((c) => c.valeur !== texte) });
  }
  return ajouterChamp(f, ctx, cle, texte, source, { ...o, encodageDouteux: o.encodageDouteux || encodageDouteux });
}

/** Ajoute une date à un champ et à la liste des dates. */
export function ajouterDate(f: FicheEnCours, ctx: Contexte, cle: string, d: DateLue | undefined, source: string, o: OptionsChamp = {}): void {
  if (!d) return;
  if (!f.dates.some((x) => x.iso === d.iso && x.role === d.role)) f.dates.push(d);
  ajouterChamp(f, ctx, cle, d.texte, source, { ...o, brut: d.iso });
}

/** Une date de prise de vue candidate (choisie par rang à la fin). */
export function candidatPrise(ctx: Contexte, d: DateLue | undefined, rang: number, source: string, douteuse = false): void {
  if (d) ctx.travail.datesPrise.push({ d, rang, source, douteuse });
}

/** Une position candidate (choisie par rang à la fin). */
export function candidatPosition(f: FicheEnCours, ctx: Contexte, p: Position | string, rang: number, quoi = 'la position'): void {
  if (typeof p === 'string') { ajouterManque(f, { quoi, raison: p, code: 'illisible' }); return; }
  ctx.travail.positions.push({ p, rang });
}

export function ajouterManque(f: FicheEnCours, m: Manque): void {
  if (!f.manque.some((x) => x.quoi === m.quoi && x.raison === m.raison)) f.manque.push(m);
}
export function remarque(f: FicheEnCours, r: string): void {
  if (f.remarques.length < 200 && !f.remarques.includes(r)) f.remarques.push(r);
}
/** Ajoute une image jointe ; quand on demande les images, ses octets sont gardés à côté (pour extraireImageJointe). */
export function ajouterImage(f: FicheEnCours, i: ImageJointe, octets?: Buffer, ctx?: Contexte): void {
  if (f.images.length >= 64) return;
  f.images.push(i);
  if (octets && ctx?.avecImages) ctx.travail.captures.set(f.images.length - 1, octets);
}
export function ajouterTexteInclus(f: FicheEnCours, t: TexteInclus): void {
  const texte = nettoyerTexte(t.texte).texte;
  if (texte && f.textesInclus.length < 64) f.textesInclus.push({ ...t, texte });
}
export function ajouterLangue(f: FicheEnCours, code: string | undefined, source: string): void {
  if (code && !f.languesDeclarees.some((l) => l.code === code && l.source === source) && f.languesDeclarees.length < 64) f.languesDeclarees.push({ code, source });
}

/** Format d'une image reconnu par ses octets (jamais par le MIME déclaré). */
export function formatImage(b: Buffer): string {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return 'png';
  if (b.length >= 6 && b.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp') return 'heif';
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a))) return 'tiff';
  return 'inconnu';
}
/** Dimensions d'une petite image jointe (PNG, JPEG, GIF) quand c'est simple. */
export function dimensionsImage(b: Buffer): { largeur?: number; hauteur?: number } {
  try {
    const fmt = formatImage(b);
    if (fmt === 'png' && b.length >= 24) return { largeur: b.readUInt32BE(16), hauteur: b.readUInt32BE(20) };
    if (fmt === 'gif' && b.length >= 10) return { largeur: b.readUInt16LE(6), hauteur: b.readUInt16LE(8) };
    if (fmt === 'jpeg') {
      let p = 2;
      for (let n = 0; n < 200 && p + 9 < b.length; n++) {
        if (b[p] !== 0xff) break;
        const m = b[p + 1], l = b.readUInt16BE(p + 2);
        if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { hauteur: b.readUInt16BE(p + 5), largeur: b.readUInt16BE(p + 7) };
        if (l < 2) break;
        p += 2 + l;
      }
    }
  } catch { /* abîmée */ }
  return {};
}

const cleComparaison = (s: string) => s.normalize('NFKC').toLocaleLowerCase().trim();

/**
 * Fin de lecture : règle les doublons (sources jointes par « + »), garde les désaccords (« probable » + remarque),
 * choisit la date de prise de vue et la position (2.5), signale le distributeur manquant.
 */
export function finaliserChamps(f: FicheEnCours, ctx: Contexte): void {
  // Date de prise de vue. Une date « par défaut » d'appareil (horloge jamais réglée : 01/01/1970, 01/01/1904…) n'est
  // jamais donnée comme prise de vue : elle est dite douteuse.
  const defauts = ctx.travail.datesPrise.filter((x) => estDateParDefaut(x.d));
  if (defauts.length) remarque(f, `date par défaut d'un appareil ignorée (${defauts[0].d.texte} : horloge sans doute jamais réglée)`);
  const prises = ctx.travail.datesPrise.filter((x) => !estDateParDefaut(x.d)).sort((a, b) => a.rang - b.rang);
  f.dates = f.dates.filter((d) => !(d.role === 'prise de vue' && estDateParDefaut(d)));
  for (const c of f.champs) if (c.cle.startsWith('date_') && typeof c.brut === 'string' && estDateParDefaut({ iso: c.brut }) && c.fiabilite !== 'douteuse') { c.fiabilite = 'douteuse'; remarque(f, `${c.nom.toLowerCase()} : date par défaut d'un appareil, sans doute fausse`); }
  if (prises.length && !f.champs.some((c) => c.cle === 'date_prise_de_vue')) {
    const p = prises[0];
    if (!f.dates.some((x) => x.iso === p.d.iso && x.role === p.d.role)) f.dates.unshift(p.d);
    const c = ajouterChamp(f, ctx, 'date_prise_de_vue', p.d.texte, p.source, { brut: p.d.iso, fiabilite: p.douteuse ? 'douteuse' : 'sure' });
    if (c) ctx.travail.rangs.set(c, 0);
  }
  // Position.
  const pos = [...ctx.travail.positions].sort((a, b) => a.rang - b.rang).map((x) => x.p);
  if (pos.length) {
    f.position = pos[0];
    for (const p of pos.slice(1)) {
      if (Math.abs(p.lat - pos[0].lat) < 1e-6 && Math.abs(p.lon - pos[0].lon) < 1e-6) continue;
      f.autresPositions.push(p);
      if (distanceKm(p, pos[0]) > 1) remarque(f, 'positions en désaccord (plus de 1 km entre deux étiquettes)');
    }
  }
  // Doublons et désaccords.
  const parCle = new Map<string, Champ[]>();
  for (const c of f.champs) { const l = parCle.get(c.cle); if (l) l.push(c); else parCle.set(c.cle, [c]); }
  const garde: Champ[] = [];
  for (const [, liste] of parCle) {
    const tries = [...liste].sort((a, b) => (ctx.travail.rangs.get(a) ?? 150) - (ctx.travail.rangs.get(b) ?? 150));
    const retenus: Champ[] = [];
    for (const c of tries) {
      const meme = retenus.find((r) => cleComparaison(r.valeur) === cleComparaison(c.valeur) && (!r.langue || !c.langue || r.langue === c.langue));
      if (meme) { if (!meme.source.split(' + ').includes(c.source)) meme.source = `${meme.source} + ${c.source}`; continue; }
      if (retenus.length) {
        // Une valeur dans une autre langue n'est pas un désaccord.
        if (!(c.langue && retenus.some((r) => r.langue && r.langue !== c.langue)) && !c.cle.startsWith('x:')) {
          if (c.fiabilite === 'sure') c.fiabilite = 'probable';
          remarque(f, `deux étiquettes disent des choses différentes pour ${c.nom.toLowerCase()}`);
        }
      }
      retenus.push(c);
    }
    garde.push(...retenus);
  }
  f.champs = garde;
  // Distributeur : jamais déduit.
  const familleMusique = f.nature.famille === 'son' || f.champs.some((c) => c.cle === 'album' || c.cle === 'label');
  if (familleMusique && f.champs.some((c) => c.groupe === 'œuvre' || c.groupe === 'personnes') && !f.champs.some((c) => c.cle === 'distributeur')) {
    const bruts = [...new Set(ctx.travail.droitsBruts)].slice(0, 4);
    ajouterManque(f, { quoi: 'le distributeur', raison: 'distributeur non indiqué dans le fichier', code: 'absent' });
    if (bruts.length) remarque(f, `mentions de droits brutes : ${bruts.join(' ; ')}`);
  }
}

/** Les « zéros » d'horloge des appareils et des formats : 1970 (Unix), 1904 (QuickTime), 1980 (DOS), 2000 (appareils). */
const ORIGINES_HORLOGE = ['1970-01-01', '1904-01-01', '1980-01-01T00:00', '2000-01-01T00:00', '1900-01-01', '1601-01-01'];
export function estDateParDefaut(d: { iso: string }): boolean {
  return ORIGINES_HORLOGE.some((x) => d.iso.startsWith(x));
}

/** Texte d'une date pour l'affichage masqué ou non. */
export function texteDate(d: DateLue, masquer: boolean): string {
  if (masquer) return jourSeulement(d);
  return d.fuseauSource === 'inconnu' && (d.precision === 'minute' || d.precision === 'seconde' || d.precision === 'milliseconde') ? `${d.texte} (fuseau inconnu)` : d.texte;
}

/** ISRC : 2 lettres, 3 alphanumériques, 2 chiffres, 5 chiffres (tirets retirés) ; sinon douteux. */
export function ajouterIsrc(f: FicheEnCours, ctx: Contexte, v: string, source: string): void {
  let s = '';
  for (const c of v.trim().slice(0, 32)) if (c !== '-' && c !== ' ') s += c.toUpperCase();
  const ok = s.length === 12 && /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(s);
  ajouterChamp(f, ctx, 'isrc', ok ? s : v, source, { fiabilite: ok ? 'sure' : 'douteuse' });
}

