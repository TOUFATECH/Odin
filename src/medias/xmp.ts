// Médias reçus : les champs XMP (photos, vidéos, PDF). Formes attribut ET élément de rdf:Description ; rdf:Alt
// (x-default d'abord, les autres langues gardées), rdf:Seq / rdf:Bag (valeurs multiples). Les espaces de noms sont
// comparés par URI. XMP étendu des JPEG : recollé à part (images.ts) puis lu ici.

import type { Contexte, FicheEnCours, Groupe } from './contrat.ts';
import { ajouterChamp, ajouterDate, ajouterManque, candidatPosition, candidatPrise, remarque } from './champs.ts';
import { lireDateIso } from './dates.ts';
import { creerPosition, lireGpsXmp } from './lieux.ts';
import { versBcp47 } from './langues-codes.ts';
import { lireXml, type NoeudXml } from './xml.ts';

const NS: Record<string, string> = {
  'http://purl.org/dc/elements/1.1/': 'dc',
  'http://ns.adobe.com/xap/1.0/': 'xmp',
  'http://ns.adobe.com/exif/1.0/': 'exif',
  'http://ns.adobe.com/tiff/1.0/': 'tiff',
  'http://ns.adobe.com/photoshop/1.0/': 'photoshop',
  'http://ns.adobe.com/xap/1.0/rights/': 'xmpRights',
  'http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/': 'Iptc4xmpCore',
  'http://iptc.org/std/Iptc4xmpExt/2008-02-29/': 'Iptc4xmpExt',
  'http://cipa.jp/exif/1.0/': 'exifEX',
  'http://ns.adobe.com/exif/1.0/aux/': 'aux',
  'http://ns.adobe.com/pdf/1.3/': 'pdf',
  'http://ns.adobe.com/xap/1.0/mm/': 'xmpMM',
  'http://ns.adobe.com/xmp/1.0/DynamicMedia/': 'xmpDM',
  'http://ns.adobe.com/camera-raw-settings/1.0/': 'crs',
  'http://ns.google.com/photos/1.0/camera/': 'GCamera',
  'http://ns.adobe.com/xmp/note/': 'xmpNote',
};
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

/** Propriété XMP → clé connue. */
const CORRESPONDANCES: Record<string, string> = {
  'dc:title': 'titre', 'dc:creator': 'artiste', 'dc:description': 'description', 'dc:subject': 'mots_cles', 'dc:rights': 'droits',
  'dc:language': 'langue_declaree', 'dc:publisher': 'label',
  'xmp:CreatorTool': 'logiciel', 'tiff:Make': 'appareil_marque', 'tiff:Model': 'appareil_modele', 'tiff:Artist': 'artiste',
  'tiff:ImageDescription': 'description', 'tiff:Copyright': 'droits', 'tiff:Software': 'logiciel',
  'photoshop:City': 'ville', 'photoshop:State': 'region', 'photoshop:Country': 'pays', 'Iptc4xmpCore:Location': 'sous_lieu',
  'Iptc4xmpCore:CountryCode': 'code_pays', 'photoshop:Credit': 'editeur_photo', 'photoshop:Source': 'editeur_photo',
  'xmpRights:UsageTerms': 'licence', 'xmpRights:WebStatement': 'licence', 'aux:Lens': 'objectif', 'exifEX:LensModel': 'objectif',
  'aux:SerialNumber': 'numero_serie_boitier', 'exifEX:BodySerialNumber': 'numero_serie_boitier', 'exifEX:LensSerialNumber': 'numero_serie_objectif',
  'exifEX:CameraOwnerName': 'proprietaire_appareil', 'pdf:Producer': 'logiciel', 'pdf:Keywords': 'mots_cles',
  'xmpDM:artist': 'artiste', 'xmpDM:album': 'album', 'xmpDM:composer': 'compositeur', 'xmpDM:genre': 'genre', 'xmpDM:trackNumber': 'piste',
  'xmpDM:copyright': 'droits', 'xmpDM:engineer': 'ingenieur', 'xmpDM:tempo': 'tempo', 'xmpDM:key': 'tonalite',
  'photoshop:Headline': 'x:titre_court',
};
/** Propriétés techniques sans intérêt pour la personne (identifiants internes). */
const IGNOREES = new Set(['xmpMM:DocumentID', 'xmpMM:InstanceID', 'xmpMM:OriginalDocumentID', 'xmpMM:History', 'xmpMM:DerivedFrom', 'xmp:MetadataDate',
  'crs', 'xmpNote:HasExtendedXMP', 'photoshop:DocumentAncestors', 'xmpMM:Ingredients', 'xmpMM:Pantry', 'xmpMM:Manifest']);

interface Valeur { texte: string; valeurs?: string[]; langues?: Array<{ lang: string; texte: string }> }

function valeurDe(n: NoeudXml): Valeur | undefined {
  const conteneur = n.enfants.find((e) => e.ns === RDF && (e.local === 'Alt' || e.local === 'Seq' || e.local === 'Bag'));
  if (conteneur) {
    const lis = conteneur.enfants.filter((e) => e.ns === RDF && e.local === 'li');
    if (!lis.length) return undefined;
    if (conteneur.local === 'Alt') {
      const langues = lis.map((li) => ({ lang: li.lang ?? 'x-default', texte: li.texte.trim() })).filter((x) => x.texte);
      if (!langues.length) return undefined;
      langues.sort((a, b) => (a.lang === 'x-default' ? -1 : b.lang === 'x-default' ? 1 : 0));
      return { texte: langues[0].texte, langues };
    }
    const vals = lis.map((li) => li.texte.trim()).filter(Boolean);
    return vals.length ? { texte: vals.join(' ; '), valeurs: vals } : undefined;
  }
  if (n.enfants.length) return undefined;     // structure (non lue)
  const t = n.texte.trim();
  return t ? { texte: t } : undefined;
}

export function lireXmp(texte: string, f: FicheEnCours, ctx: Contexte, origine = 'XMP'): void {
  const debut = texte.indexOf('<');
  if (debut < 0) return;
  const racine = lireXml(texte.slice(debut), { profondeur: ctx.budget.bornes.profondeurXml });
  const descriptions: NoeudXml[] = [];
  const pile = [racine];
  let k = 0;
  while (pile.length && k++ < 100_000) {
    const x = pile.pop()!;
    ctx.budget.pas();
    if (x.ns === RDF && x.local === 'Description') descriptions.push(x);
    else pile.push(...x.enfants);
  }
  const props: Array<{ nom: string; v: Valeur }> = [];
  for (const d of descriptions) {
    for (const a of d.attrs) {
      const p = NS[a.ns];
      if (!p || a.ns === RDF) continue;
      const t = a.valeur.trim();
      if (t) props.push({ nom: `${p}:${a.local}`, v: { texte: t } });
    }
    for (const e of d.enfants) {
      const p = NS[e.ns];
      if (!p) continue;
      const v = valeurDe(e);
      if (v) props.push({ nom: `${p}:${e.local}`, v });
    }
  }
  const m = ctx.maintenant;
  let lat: string | undefined, lon: string | undefined, alt: string | undefined, altRef: string | undefined;
  for (const { nom, v } of props) {
    const source = `${origine}:${nom}`;
    if (IGNOREES.has(nom) || IGNOREES.has(nom.split(':')[0])) continue;
    switch (nom) {
      case 'exif:DateTimeOriginal': candidatPrise(ctx, lireDateIso(v.texte, 'prise de vue', m), 2, source); continue;
      case 'photoshop:DateCreated': candidatPrise(ctx, lireDateIso(v.texte, 'prise de vue', m), 3, source); continue;
      case 'xmp:ModifyDate': ajouterDate(f, ctx, 'date_modification', lireDateIso(v.texte, 'modification', m), source); continue;
      case 'xmp:CreateDate': ajouterDate(f, ctx, 'date_creation_fichier', lireDateIso(v.texte, 'création du fichier', m), source, { sensible: true }); continue;
      case 'exif:DateTimeDigitized': ajouterDate(f, ctx, 'date_numerisation', lireDateIso(v.texte, 'numérisation', m), source); continue;
      case 'exif:GPSLatitude': lat = v.texte; continue;
      case 'exif:GPSLongitude': lon = v.texte; continue;
      case 'exif:GPSAltitude': alt = v.texte; continue;
      case 'exif:GPSAltitudeRef': altRef = v.texte; continue;
      case 'tiff:Orientation': continue;
      case 'dc:language': {
        const code = versBcp47(v.texte);
        if (code) { ajouterChamp(f, ctx, 'langue_declaree', code, source, { brut: code }); if (!f.languesDeclarees.some((l) => l.code === code)) f.languesDeclarees.push({ code, source }); }
        continue;
      }
      default: break;
    }
    let cle = CORRESPONDANCES[nom];
    let groupe: Groupe | undefined;
    if (!cle) {
      if (nom.startsWith('exif:') || nom.startsWith('tiff:') || nom.startsWith('aux:') || nom.startsWith('GCamera:')) continue;   // déjà lus dans l'EXIF
      cle = `x:${nom}`.slice(0, 66); groupe = 'logiciel';
    }
    if (v.langues && v.langues.length > 1) {
      // Une seule valeur (x-default d'abord) ; les autres langues restent dans `valeurs`.
      const def = v.langues[0];
      const memeTexte = v.langues.find((l) => l.lang !== 'x-default' && l.texte === def.texte);
      const langue = versBcp47(def.lang !== 'x-default' ? def.lang : memeTexte?.lang);
      const c = ajouterChamp(f, ctx, cle, def.texte, source, { langue, groupe, nom: groupe ? nom : undefined });
      if (c) c.valeurs = [...new Set(v.langues.map((l) => l.texte))].slice(0, 64);
    } else ajouterChamp(f, ctx, cle, v.texte, source, { valeurs: v.valeurs, groupe, nom: groupe ? nom : undefined, langue: v.langues?.[0] && v.langues[0].lang !== 'x-default' ? versBcp47(v.langues[0].lang) : undefined });
  }
  if (lat !== undefined || lon !== undefined) {
    const la = lat ? lireGpsXmp(lat) : undefined, lo = lon ? lireGpsXmp(lon) : undefined;
    if (la === undefined || lo === undefined) ajouterManque(f, { quoi: 'la position (XMP)', raison: 'coordonnées XMP illisibles', code: 'illisible' });
    else {
      let a: number | undefined;
      if (alt) { const k2 = alt.indexOf('/'); a = k2 > 0 ? Number(alt.slice(0, k2)) / Number(alt.slice(k2 + 1)) : Number(alt); if (!Number.isFinite(a)) a = undefined; if (a !== undefined && altRef === '1') a = -a; }
      candidatPosition(f, ctx, creerPosition({ lat: la, lon: lo, altitudeM: a, source: `${origine} exif:GPS`, fiabilite: 'probable' }), 2);
    }
  }
  if (!descriptions.length) remarque(f, `${origine} : aucune description RDF`);
}
