// Visage d'Odin : dessine l'expression d'une humeur sur la mascotte (SVG 120×120) et tranche, seul,
// ce qui se voit à chaque instant (un seul arbitre du visage : priorités, durées, couleur, jamais deux fois pareil).
// Partagé par le site, l'interface web, le guide et le rendu des autocollants Telegram.
//
// Par mascotte, trois couches et un drapeau :
//   - le fond : sa disposition du moment (visage adouci, jamais en couleur) ;
//   - l'émotion : une seule à la fois, avec une fin (en couleur tant qu'elle dure : 20 s, 60 s ou 120 s au plus selon son degré) ;
//   - les états tenus : écoute, regarde, cache, concentration… un par demandeur (20 s de couleur, puis seul le visage reste) ;
//   - « il parle » : la bouche parle par-dessus l'expression en cours.
// Au repos, Odin a la couleur du thème et des yeux en pastille ; seule la concentration a les yeux carrés.
//
// API : OdinFace.ressent(el, id, opts) · fond(el, id) · tenir(el, id, qui, ms) · lacher(el, qui) · parole(el, oui, ms)
//       · geste(el, nom) · etat(el) · couleur(el) · liste() · dessin(id, opts) · pur (logique sans page)
//       anciens appels gardés : set(el, id, passing) · all(id) · flash(el, id, ms) · base(el, id) · MOODS · tintBase(hex)
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const DOC = typeof document !== 'undefined' ? document : null;
  const W = '#fff';
  const possede = (objet, cle) => Object.prototype.hasOwnProperty.call(objet, cle);

  // ---------- La palette : 66 émotions, 16 familles (la même liste que src/mood/mood.ts) ----------
  // identifiant | nom affiché | famille | degré (1 à 3) | icône | 4 teintes (centre → bord) | durée typique (s) | socle
  // L'ordre des lignes d'une famille est son échelle, du plus léger au plus fort.
  const TABLE = `
serenite|serein|joie|1|😌|#D4AB2F,#D6B656,#E3CD8B,#EFE2BD|12|joie
contentement|content|joie|1|😀|#E38E21,#E2A04A,#EBBE83,#F4DAB8|10|joie
joie|joyeux|joie|2|😊|#F0A818,#F7BD32,#FDD66B,#FFEDAE|25|joie
rire|rieur|joie|3|😄|#F28A12,#F8A630,#FCC468,#FFE1A8|20|rire
euphorie|euphorique|joie|3|😆|#F58700,#FF9A1F,#FFB861,#FFD39F|40|rire
melancolie|mélancolique|tristesse|1|😔|#5871BD,#7A8CC4,#A8B4D8,#D2D8EB|15|triste
triste|triste|tristesse|2|😢|#3264B8,#4C7AC7,#7FA0D7,#ADC2E5|30|triste
chagrin|chagriné|tristesse|3|🥺|#2C498E,#3B5BA8,#5F7DC7,#8CA2D7|50|triste
pleurs|en pleurs|tristesse|3|😭|#21397F,#2F4A9A,#4566C6,#748CD5|70|triste
agacement|agacé|colere|1|😑|#D65F1B,#E0763A,#E99E73,#F1C3A8|8|confus
frustration|frustré|colere|2|😣|#CB441B,#DD5A32,#E6886B,#EFB29F|20|colere
colere|fâché|colere|2|😠|#C8231C,#E0352B,#F06A55,#FFA593|40|colere
rage|enragé|colere|3|😡|#970A15,#B8121F,#E92332,#EF5B66|90|colere
inquiet|inquiet|peur|1|😟|#C77A1E,#D6913A,#E6B575,#F5DDB8|15|inquiet
apprehension|craintif|peur|2|😧|#7B62BC,#9583C4,#BBB0D9,#DCD6EB|15|inquiet
peur|effrayé|peur|2|😨|#6E5BB8,#8574CC,#AB9FE2,#D9D2F7|25|peur
terreur|terrifié|peur|3|😱|#4D3498,#5F45B0,#8570C7,#AB9CD8|45|peur
panique|paniqué|peur|3|😰|#B842F1,#C56CF0,#DAA2F6,#E9C7F9|60|peur
etonnement|étonné|surprise|1|😯|#34BBDF,#5CC4E0,#94D8EB,#C7EBF4|5|surprise
surprise|surpris|surprise|2|😮|#16A6D8,#30BCE8,#76D6F3,#BFEEFC|8|surprise
stupeur|stupéfait|surprise|3|😲|#0C71C0,#1487E0,#48A6EF,#80C1F4|14|surprise
moue|réticent|degout|1|🫤|#92993C,#A9B04E,#C0C57C,#D4D8A6|8|confus
degout|dégoûté|degout|2|🤢|#698C2B,#7FA63A,#A0C65C,#BAD68A|20|confus
mepris|méprisant|degout|3|🙄|#597D53,#6F8F6A,#93AC8F,#B5C6B2|30|colere
confiance|confiant|amour|1|🤝|#3A9879,#4CAF8E,#79C5AB,#A3D7C6|12|joie
tendresse|attendri|amour|1|🤗|#F26894,#F291B0,#F4A4BD,#F9C8D8|15|amour
gratitude|reconnaissant|amour|2|🥹|#F16E51,#F0907A,#F5B3A3,#F9D1C8|20|amour
admiration|admiratif|amour|2|😍|#E934A6,#E85DB5,#F097D0,#F7C9E7|20|amour
amour|aimant|amour|3|🥰|#E0457B,#EE6A97,#F7A3C0,#FFD3E2|40|amour
satisfaction|satisfait|fierte|1|😁|#8E66DC,#A88BE0,#C3AFE9,#DBCFF2|10|fierte
assurance|assuré|fierte|2|💪|#6B53F0,#8E7CF0,#B0A3F5,#D0C8F9|15|fierte
fierte|fier|fierte|2|😎|#7A4BD8,#9166E6,#B596F2,#DCCBFF|25|fierte
determination|déterminé|fierte|2|😤|#6528BF,#7A3FD0,#9F74DD,#C1A5E9|30|concentration
timidite|timide|gene|1|🤭|#F4836F,#F4A698,#F5AFA3,#F9CFC8|12|gene
gene|gêné|gene|2|😳|#E2557A,#EE7896,#F6A9BD,#FFD8E2|20|gene
culpabilite|coupable|gene|2|😓|#9B5575,#A8718A,#C19AAC,#D8C0CB|30|triste
honte|honteux|gene|3|🫣|#D8274F,#D94F6E,#E5869B,#F0B8C4|40|gene
envie|tenté|envie|1|🤤|#49A637,#5DBB4A,#88CD7A,#B0DEA7|15|excite
jalousie|jaloux|envie|2|😒|#76A014,#8FBF1E,#B0E13F,#C6E973|25|confus
curiosite|curieux|attente|1|🔍|#20AA88,#2CC6A0,#5ADABB,#8CE5CF|10|regarde
interet|intéressé|attente|1|🤓|#F8912F,#F5A65B,#F9C899,#FBE0C5|12|regarde
espoir|plein d'espoir|attente|2|🤞|#7ACA2D,#8FD14F,#B0DF84,#CFEBB4|20|joie
impatience|impatient|attente|2|⏳|#F5481E,#F26B4A,#F69E88,#FBCCC1|20|inquiet
enthousiasme|enthousiaste|attente|2|😃|#FF7621,#FF8F4A,#FFB88C,#FFD9C2|25|excite
excite|excité|attente|3|🤩|#F06A12,#F7872E,#FBAE66,#FFD6AE|45|excite
ennui|s'ennuie|manque|1|😐|#8D8D70,#9A9A8C,#B9B9AF,#D6D6D0|15|fatigue
nostalgie|nostalgique|manque|1|🥲|#BE8649,#C49A6C,#D7BB9B,#E9D9C7|20|triste
deception|déçu|manque|2|😞|#74619E,#8C7FA8,#AFA6C3,#D0CBDC|25|triste
solitude|seul|manque|2|🙁|#4A5B8C,#5E6FA0,#8894B9,#AEB7CF|30|triste
lassitude|las|fatigue|1|😩|#6797AB,#86A7B5,#AFC5CE,#D5E1E5|15|fatigue
fatigue|fatigué|fatigue|2|😴|#5F7287,#768A9F,#A1B1C2,#D2DBE4|30|fatigue
epuisement|épuisé|fatigue|3|😫|#455365,#5B6878,#7B899B,#9DA8B5|60|fatigue
sommeil|endormi|fatigue|3|💤|#3B4676,#4E5A8C,#6E7AAE,#959EC4|90|fatigue
clin|complice|esprit|1|😉|#14A3A0,#25BAB4,#6AD6CF,#B8F1EC|6|clin
reflexion|pensif|esprit|1|🤔|#4256C9,#5A6FDB,#8E9DEB,#C9D1FA|12|reflexion
doute|dubitatif|esprit|1|🤨|#54949A,#6FA3A8,#98BDC1,#BED6D8|12|confus
concentration|concentré|esprit|2|🧐|#2558B8,#3570D0,#6E9CE6,#B5CDF7|30|concentration
confus|perplexe|esprit|2|😕|#7C7FA0,#9396B4,#B6B8CF,#DEDFEB|15|confus
malice|malicieux|esprit|2|😏|#8E3FB8,#A659CC,#C68DE0,#EACBF7|15|malice
neutre|tranquille|calme|1|🙂|#2F6FE0,#3F82F0,#7EAEF8,#C3DBFF|0|neutre
calme|calme|calme|1|🙂|#3B9AC4,#5FA8C8,#90C3D9,#BEDCE9|15|neutre
soulagement|soulagé|calme|2|😅|#38C498,#5CC9A7,#8ED9C2,#BCE9DB|12|joie
ecoute|à l'écoute|dialogue|1|🙂|#2E9E5B,#43B672,#7CD29E,#C2EDD3|20|ecoute
regarde|attentif|dialogue|1|👀|#0E8FB8,#22A7CF,#64C6E2,#B2E6F4|20|regarde
parle|parle|dialogue|1|💬|#D8A112,#E8B62C,#F3CF68,#FCEAB0|20|parle
cache|ne regarde pas|dialogue|1|🙈|#8A6E4B,#A08562,#C1AA8C,#E5D8C6|20|cache
`;
  // identifiant | nom affiché | humeur de base | valence | éveil | rang (qui passe devant à degré égal)
  const FAMILLES_TABLE = `
joie|Joie|joie|1|2|5
tristesse|Tristesse|triste|-1|0|6
colere|Colère|colere|-1|2|8
peur|Peur|peur|-1|2|9
surprise|Surprise|surprise|0|2|7
degout|Dégoût|confus|-1|1|4
amour|Amour et lien|amour|1|1|5
fierte|Fierté et assurance|fierte|1|1|5
gene|Gêne|gene|-1|1|5
envie|Envie|malice|-1|1|4
attente|Attente|excite|1|2|4
manque|Déception et manque|triste|-1|0|3
fatigue|Fatigue|fatigue|-1|0|3
esprit|Esprit|reflexion|0|1|2
calme|Soulagement et calme|neutre|1|0|1
dialogue|Dialogue|ecoute|0|1|0
`;
  // Le visage de chaque émotion. y : forme des yeux · e : échelle des yeux [sx, sy] (ou [gauche, droite]) · d : écart ·
  // r : regard [dx, dy, suivi du pointeur] · a : petite animation des yeux · s : sourcils · b : bouche · j : rougeur (1 à 3) ·
  // x : extras · c : corps [posture, boucle, geste d'arrivée] · clign : clignement en secondes (0 = aucun) ·
  // coup : 0 = regard fixe · k : profondeur de la coupe des yeux · aura : halos [tour en secondes, force].
  const VISAGES = {
    serenite: { y: 'half', r: [0, 2, .3], b: 'petit', c: ['droit', 'balance', 'fond'], clign: 7, aura: [11, 1] },
    contentement: { y: 'sourit', b: 'petit', j: 1, c: ['droit', 'souffle', ''] },
    joie: { y: 'sourit', e: [1.05, 1.05], d: [-1, -1], a: 'bob', b: 'smile', j: 1, c: ['droit', 'rebond', 'bond'] },
    rire: { y: 'sourit', e: [1, .94], d: [1, -1], a: 'giggle', b: 'grin', c: ['droit', 'rire', 'bond'] },
    euphorie: { y: 'sourit', e: [1.1, 1.1], a: 'giggle', s: 'raised', b: 'grin', x: ['etincelles'], c: ['droit', 'sautille', 'bond'] },
    melancolie: { y: 'tombant', k: 4, r: [0, 3, .3], s: 'sad', b: 'flat', c: ['affaisse', 'lent', 'fond'] },
    triste: { y: 'tombant', a: 'sink', s: 'sad', b: 'frown', x: ['tear'], c: ['affaisse', 'lent', 'tasse'] },
    chagrin: { y: 'mouille', e: [1.1, 1.04], s: 'sad', b: 'wobble', x: ['tear'], c: ['petit', 'frisson', 'tasse'] },
    pleurs: { y: 'tombant', k: 5.75, e: [1, 1.05], d: [1, 2], a: 'sink', s: 'sad', b: 'grand_o', x: ['larmes'], c: ['affaisse', 'sanglot', 'tasse'] },
    agacement: { y: 'fache', k: 2.5, s: 'plat', b: 'flat', x: ['soupir'], c: ['droit', 'souffle', ''] },
    frustration: { y: 'fache', k: 4.75, d: [1.5, 0], s: 'angry', b: 'dents', x: ['sweat'], c: ['gonfle', 'gronde', 'gonfle'] },
    colere: { y: 'fache', k: 5.5, d: [-1, 0], s: 'angry', b: 'frown', x: ['veine'], c: ['gonfle', 'gronde', 'gonfle'] },
    rage: { y: 'fache', k: 6.5, e: [1, 1.08], a: 'shiver', s: 'angry', b: 'dents', x: ['fumee', 'veine'], c: ['gonfle', 'secoue', 'gonfle'], vive: 1, aura: [1.8, 1] },
    inquiet: { y: 'pill', e: [.92, .92], a: 'dart', s: 'sad', b: 'frown', x: ['sweat'], c: ['droit', 'vif', ''], clign: 2.6 },
    apprehension: { y: 'pill', e: [1.1, 1.08], s: 'peur', b: 'o', c: ['recule', 'frisson', 'recul'], clign: 2.6 },
    peur: { y: 'pill', e: [1.2, 1.15], a: 'shiver', s: 'peur', b: 'wavy', x: ['ombre'], c: ['petit', 'tremble', 'sursaut'], clign: 0 },
    terreur: { y: 'pill', e: [1.3, 1.3], s: 'peur', b: 'grand_o', x: ['ombre'], c: ['petit', 'tremble', 'sursaut'], clign: 0, coup: 0 },
    panique: { y: 'pill', e: [.7, .65], a: 'dart', s: 'peur', b: 'wobble', x: ['gouttes', 'ombre'], c: ['droit', 'affole', 'sursaut'], clign: 1.4, aura: [1.6, 1] },
    etonnement: { y: 'pill', e: [1.1, 1.1], s: 'raised', b: 'o', c: ['droit', 'souffle', 'penche'] },
    surprise: { y: 'pill', e: [1.3, 1.25], a: 'pop', s: 'raised', b: 'o', x: ['point_ex'], c: ['droit', 'souffle', 'sursaut'] },
    stupeur: { y: 'pill', e: [1.35, 1.3], s: 'raised', b: 'grand_o', c: ['droit', 'fige', 'sursaut'], clign: 0, coup: 0 },
    moue: { y: 'uneven', s: 'plat', b: 'moue', c: ['penche_d', 'souffle', 'recul'] },
    degout: { y: 'half', e: [.9, 1], d: [2, 1], s: 'sad', b: 'wavy', x: ['ombre'], c: ['recule', 'frisson', 'recul'] },
    mepris: { y: 'uneven', e: [[1, .8], [1, 1]], r: [-5, -3, 0], s: 'one', b: 'side', x: ['soupir'], c: ['gonfle', 'lent', 'recul'] },
    confiance: { y: 'pill', e: [1, 1.05], r: [0, 0, 1.2], b: 'petit', c: ['droit', 'lent', ''], clign: 6 },
    tendresse: { y: 'sourit', e: [1.08, 1.08], d: [1.5, 0], b: 'petit', j: 1, c: ['penche', 'lent', 'fremit'] },
    gratitude: { y: 'mouille', e: [1.04, 1], d: [1, -1], s: 'sad', b: 'smile', j: 1, c: ['penche', 'hoche', 'fond'] },
    admiration: { y: 'pill', e: [1.12, 1.1], a: 'pulse', s: 'raised', b: 'grin', j: 1, x: ['etincelles'], c: ['avance', 'battement', 'fremit'] },
    amour: { y: 'sourit', e: [1.12, 1.12], d: [2.5, 0], a: 'pulse', b: 'smile', j: 2, x: ['coeurs'], c: ['penche', 'battement', 'fremit'] },
    satisfaction: { y: 'sourit', d: [-2, -2], b: 'smile', c: ['gonfle', 'lent', 'fond'] },
    assurance: { y: 'pill', e: [1.06, 1.06], d: [-1.5, 0], r: [0, 0, 1.2], b: 'smirk', c: ['gonfle', 'lent', ''], clign: 6 },
    fierte: { y: 'up', e: [1.05, 1.1], b: 'smirk', x: ['lunettes'], c: ['gonfle', 'lent', 'gonfle'] },
    determination: { y: 'fache', k: 4, s: 'focus', b: 'flat', c: ['avance', 'vif', 'gonfle'] },
    timidite: { y: 'pill', e: [.88, .88], r: [3, 3, .3], a: 'shy', b: 'petit', j: 1, c: ['petit', 'souffle', 'fremit'] },
    gene: { y: 'pill', e: [1.05, 1], s: 'raised', b: 'flat', j: 3, x: ['sweat'], c: ['petit', 'souffle', 'fremit'], clign: 2.6 },
    culpabilite: { y: 'tombant', d: [1.5, 2], r: [-3, 4, .2], s: 'sad', b: 'frown', x: ['sweat'], c: ['affaisse', 'lent', 'tasse'] },
    honte: { y: 'half', e: [.85, .9], d: [1.5, 4], r: [0, 5, 0], s: 'sad', b: 'wavy', j: 3, x: ['main'], c: ['petit', 'lent', 'tasse'] },
    envie: { y: 'pill', e: [1.1, 1.1], d: [1.5, 1], r: [0, 0, 1.3], a: 'sparkle', s: 'raised', b: 'o', x: ['bave'], c: ['avance', 'vif', 'penche'] },
    jalousie: { y: 'half', e: [.95, 1], d: [-2, 1], r: [5, 0, .5], a: 'sly', s: 'plat', b: 'frown', c: ['recule', 'souffle', ''] },
    curiosite: { y: 'pill', e: [[1.12, 1.08], [1, 1]], r: [0, 0, 1.3], s: 'one', b: 'petit', x: ['point_int'], c: ['penche', 'souffle', 'penche'] },
    interet: { y: 'pill', e: [1.06, 1.06], a: 'attent', s: 'raised', b: 'petit', c: ['avance', 'hoche', 'penche'] },
    espoir: { y: 'up', e: [1.05, 1.05], s: 'raised', b: 'petit', x: ['etoile'], c: ['droit', 'lent', 'fond'] },
    impatience: { y: 'pill', e: [.95, 1], d: [1, -1], a: 'dart', s: 'plat', b: 'side', x: ['points'], c: ['droit', 'trepigne', ''], clign: 2.6 },
    enthousiasme: { y: 'up', e: [1.15, 1.15], a: 'bob', s: 'raised', b: 'grin', c: ['avance', 'rebond', 'bond'] },
    excite: { y: 'pill', e: [1.15, 1.2], a: 'sparkle', s: 'raised', b: 'grin', x: ['etincelles'], c: ['droit', 'sautille', 'bond'] },
    ennui: { y: 'half', d: [0, 3], r: [4, -2, .3], a: 'ponder', s: 'plat', b: 'flat', c: ['affaisse', 'balance', 'fond'] },
    nostalgie: { y: 'sourit', e: [.9, .95], d: [0, 2], r: [-4, -3, 0], s: 'sad', b: 'petit', x: ['tear'], c: ['penche', 'balance', 'fond'] },
    deception: { y: 'tombant', k: 5, d: [-1, 1], r: [0, 4, .4], s: 'sad', b: 'frown', x: ['soupir'], c: ['affaisse', 'lent', 'tasse'] },
    solitude: { y: 'half', e: [.9, .95], r: [0, 3, .3], s: 'sad', b: 'frown', c: ['petit', 'lent', 'tasse'], aura: [14, .3] },
    lassitude: { y: 'tombant', k: 3, s: 'sad', b: 'flat', x: ['soupir'], c: ['affaisse', 'lent', 'fond'] },
    fatigue: { y: 'half', e: [1, .96], d: [1, 2.5], a: 'pese', s: 'plat', b: 'baille', x: ['sweat'], c: ['affaisse', 'lent', 'fond'] },
    epuisement: { y: 'tombant', a: 'pese', s: 'sad', b: 'wobble', x: ['sweat', 'soupir'], c: ['tasse', 'lent', 'fond'] },
    // Le sommeil ne ferme pas les yeux en trait : il se lit aux zzz, à la tête qui tombe et à la respiration.
    sommeil: { y: 'half', d: [0, 2], r: [0, 3, 0], b: 'flat', x: ['zzz'], c: ['tasse', 'dodeline', 'fond'], clign: 9, coup: 0, aura: [16, .3] },
    clin: { y: 'pill', d: [-1, 0], a: 'clin', b: 'smirk', c: ['penche', 'souffle', 'penche'] },
    reflexion: { y: 'up', a: 'ponder', s: 'one', b: 'side', x: ['points'], c: ['penche', 'souffle', 'penche'] },
    doute: { y: 'up', e: [[1, 1], [1, .8]], s: 'one', b: 'moue', x: ['point_int'], c: ['penche_d', 'souffle', 'penche'] },
    concentration: { y: 'pill', e: [1.05, .45], d: [2.5, 0], s: 'focus', b: 'flat', c: ['avance', 'lent', ''], clign: 7, coup: 0 },
    confus: { y: 'uneven', e: [[1, .85], [1, 1.2]], a: 'ponder', s: 'sad', b: 'wavy', x: ['point_int'], c: ['penche', 'balance', 'penche'] },
    malice: { y: 'pill', e: [1, .82], r: [4, 0, .6], a: 'sly', s: 'one', b: 'smirk', c: ['penche_d', 'souffle', 'penche'] },
    neutre: { y: 'pill', c: ['droit', 'souffle', ''], aura: [7, 1] },
    calme: { y: 'pill', e: [1, .9], b: 'petit', c: ['droit', 'lent', 'fond'] },
    soulagement: { y: 'half', d: [-2.5, 0], s: 'sad', b: 'smile', x: ['soupir', 'sweat'], c: ['droit', 'lent', 'fond'] },
    ecoute: { y: 'pill', e: [1, 1.08], r: [0, 0, 1.3], a: 'attent', b: 'petit', c: ['penche', 'hoche', 'penche'] },
    regarde: { y: 'pill', e: [1.05, 1.05], a: 'look', c: ['avance', 'souffle', 'penche'] },
    parle: { y: 'pill', e: [1, 1.04], d: [0, -1], a: 'talk', b: 'talk', c: ['droit', 'parle', ''] },
    // Les mains couvrent les yeux : ils ne bougent plus dessous (ni regard, ni clignement).
    cache: { y: 'pill', e: [.8, .8], d: [2, 3], r: [0, 0, 0], b: 'petit', x: ['hands'], c: ['petit', 'souffle', ''], clign: 0, coup: 0 },
  };
  const AURA = { tristesse: [11, .5], colere: [3, 1], peur: [4, .8], manque: [11, .5], fatigue: [14, .4], calme: [10, .9] };

  const FAMILLES = {}, RANG = {}, MOODS = {}, ORDRE = [], ORIGINE = {};
  for (const l of FAMILLES_TABLE.trim().split('\n')) { const [id, nom, base, valence, eveil, rang] = l.split('|'); FAMILLES[id] = { nom, base, valence: +valence, eveil: +eveil, ids: [] }; RANG[id] = +rang; }
  for (const l of TABLE.trim().split('\n')) {
    const [id, nom, famille, degre, emoji, teintes, dure, socle] = l.split('|');
    MOODS[id] = { id, nom, famille, degre: +degre, emoji, tint: teintes.split(','), dure: +dure, socle, ...VISAGES[id] };
    ORIGINE[id] = MOODS[id].tint.slice(); ORDRE.push(id); FAMILLES[famille].ids.push(id);
  }
  /** La seule humeur aux yeux carrés (décision du 15/11/2026) ; toutes les autres gardent les yeux en pastille. */
  const SQUARE_MOOD = 'concentration';
  /** Formes d'yeux libres (arcs, cœurs, étoiles, yeux ronds, lunettes opaques) : éteintes tant que le propriétaire ne les a pas validées sur la planche. */
  const FORMES_LIBRES = false;
  /**
   * Règle du propriétaire (rappelée le 15/11/2026) : Odin n'a QUE ses deux yeux en pastille et sa couleur. Ni bouche, ni sourcils,
   * ni joues, ni dents, ni larmes, ni aucun autre ajout sur le visage. Une émotion se lit par la forme des pastilles (hauteur,
   * coupe, écart, regard), par leur mouvement, par la couleur du corps et par sa posture. Ne jamais repasser à faux sans son accord.
   */
  const YEUX_SEULS = true;
  /**
   * Précisions du propriétaire (15/11/2026) : quand il DORT, ses yeux sont fermés (deux pastilles couchées). Et AUTOUR de lui,
   * les petites marques d'émotion sont voulues : les « zzz » quand il dort, la goutte de sueur quand il est fatigué, les larmes,
   * les cœurs, les étincelles, les signes ? et !… Ce qui couvre ses yeux (mains, lunettes), ce qui assombrit son visage (voile)
   * ou ce qui sort d'une bouche (bave, soupir) reste éteint. Toujours pas de bouche, de sourcils ni de joues.
   */
  const YEUX_FERMES = new Set(['sommeil']);
  const MARQUES_PERMISES = new Set(['zzz', 'z', 'sweat', 'gouttes', 'tear', 'larmes', 'coeurs', 'etincelles', 'etoile', 'point_ex', 'point_int', 'points', 'fumee', 'veine']);
  const LIBRE = { rire: 'happy', amour: 'happy', euphorie: 'serre', pleurs: 'serre', frustration: 'serre', admiration: 'heart', excite: 'star', fierte: 'shades', clin: 'wink', serenite: 'closed', soulagement: 'closed', sommeil: 'closed', cache: 'closed', apprehension: 'wide', peur: 'wide', terreur: 'wide', surprise: 'wide', stupeur: 'wide', gene: 'wide', panique: 'small' };

  const connu = (id) => (typeof id === 'string' && possede(MOODS, id) ? id : 'neutre');
  const fam = (id) => MOODS[id].famille, deg = (id) => MOODS[id].degre;
  const socle = (id) => (typeof id === 'string' && possede(MOODS, id) ? MOODS[id].socle : String(id));
  /** La famille de l'émotion, du plus léger au plus fort. */
  const echelle = (id) => FAMILLES[fam(connu(id))].ids.slice();
  const rang = (id) => FAMILLES[fam(id)].ids.indexOf(id);
  const monter = (id) => { const e = echelle(id); return e[Math.min(e.length - 1, e.indexOf(connu(id)) + 1)]; };
  const descendre = (id) => { const e = echelle(id); return e[Math.max(0, e.indexOf(connu(id)) - 1)]; };
  /** Les familles dont l'ordre est une vraie échelle d'intensité : « un cran plus léger » n'a de sens que là. */
  const ECHELLES = new Set(['joie', 'tristesse', 'colere', 'peur', 'surprise', 'fatigue']);
  /** La même émotion un cran plus légère (usure, retombée). Hors d'une vraie échelle : elle-même ; la panique retombe en peur, pas en terreur. */
  const plusLeger = (id) => { id = connu(id); return id === 'panique' ? 'peur' : ECHELLES.has(fam(id)) ? descendre(id) : id; };
  const liste = () => ORDRE.map((id) => { const m = MOODS[id]; return { id, nom: m.nom, famille: m.famille, degre: m.degre, emoji: m.emoji, tint: ORIGINE[id].slice(), dure: m.dure, socle: m.socle }; });

  // ---------- Règles chiffrées, par degré (1, 2, 3) ----------
  const DEG = { pic: [0, 260, 420, 600], exa: [0, 1.06, 1.12, 1.2], monte: [0, 900, 500, 250], retour: [0, 1200, 1800, 2600], plafond: [0, 20000, 60000, 120000], ampli: [0, .6, 1, 1.25] };
  const HABITUDE = 90000;      // la même émotion redemandée dans ce délai s'use
  const RETOMBEE = 3000;       // après une émotion de degré 3 : un cran plus léger (voir plusLeger), sans couleur
  const DEVANT = 4000;         // une émotion forte passe devant un état tenu, pas plus longtemps
  const TENU_COULEUR = 20000;  // un état tenu garde sa couleur ce temps-là, puis seul le visage reste
  const GARDE = 600000;        // garde-fou : un état tenu (ou un fond posé par un ancien appel) ne reste pas plus de 10 minutes
  const TENUE = [0, 2000, 6000, 15000]; // ce qu'une émotion doit avoir duré avant de céder à une plus faible
  const DURABLE = new Set(['calme', 'fatigue', 'esprit']); // un fond de ces familles peut rester
  const tenable = (id) => fam(id) === 'dialogue' || id === SQUARE_MOOD;
  const borne = (ms) => (ms > 0 ? Math.min(ms, GARDE) : GARDE);
  /** Combien de temps une émotion se voit en couleur (ms) : sa durée typique ou celle demandée, jamais plus que le plafond de son degré. */
  function duree(id, ms) {
    id = connu(id); if (id === 'neutre') return 0;
    const voulu = typeof ms === 'number' && ms === ms ? ms : MOODS[id].dure * 1000;
    return Math.min(DEG.plafond[deg(id)], Math.max(600, voulu));
  }

  // ---------- La vie d'une émotion (fonctions pures : aucune page, l'horloge est toujours donnée) ----------
  // `n` compte les demandes : il dit qui est né après qui, même dans la même milliseconde.
  const etatNeuf = () => ({ fond: 'neutre', fondPose: false, fondDe: 0, emo: null, tenus: [], vus: {}, parle: null, usure: {}, n: 0, dernier: null });
  const fini = (e, ok, ms = 0, geste = false) => ({ ...e, dernier: { ok, ms, geste } });
  /** Le fond qui se voit : un fond posé par un ancien appel revient au calme au bout de 10 minutes (sauf calme, fatigue, esprit). */
  const fondVu = (e, t) => (!e.fondPose && e.fond !== 'neutre' && !DURABLE.has(fam(e.fond)) && t - e.fondDe >= GARDE ? 'neutre' : e.fond);
  /** Oublie ce qui est fini : états tenus arrivés au bout, parole terminée, émotion passée. */
  function nettoyer(e, t) {
    let tenus = e.tenus, vus = e.vus;
    if (tenus.some((x) => t >= x.a)) {
      tenus = e.tenus.filter((x) => t < x.a); vus = { ...vus };
      for (const x of e.tenus) if (t >= x.a && !tenus.some((y) => y.id === x.id)) vus[x.id] = { de: x.de, fin: x.a };
    }
    const parle = e.parle && t >= e.parle.a ? null : e.parle;
    const emo = e.emo && t >= e.emo.a + (e.emo.retombe ? RETOMBEE : 0) ? null : e.emo;
    return tenus === e.tenus && parle === e.parle && emo === e.emo ? e : { ...e, tenus, vus, parle, emo };
  }
  function relacher(e, qui, t) {
    const x = e.tenus.find((y) => y.qui === qui); if (!x) return e;
    const tenus = e.tenus.filter((y) => y !== x);
    return { ...e, tenus, vus: tenus.some((y) => y.id === x.id) ? e.vus : { ...e.vus, [x.id]: { de: x.de, fin: t } } };
  }
  /** Un état tenu au nom de `qui`. Sa couleur ne repart pas de zéro s'il était déjà tenu (ou lâché depuis peu). */
  function prendre(e, a, t) {
    const id = connu(a.id), qui = a.qui || 'defaut', vieux = e.tenus.find((x) => x.qui === qui);
    const meme = e.tenus.find((x) => x.id === id), vu = e.vus[id], garde = Boolean(vieux && vieux.id === id);
    const x = { qui, id, de: meme ? meme.de : vu && t - vu.fin < TENU_COULEUR ? vu.de : t, ordre: garde ? vieux.ordre : e.n + 1, a: t + borne(a.ms) };
    const reste = e.tenus.filter((y) => y.qui !== qui);
    const vus = vieux && !garde && !reste.some((y) => y.id === vieux.id) ? { ...e.vus, [vieux.id]: { de: vieux.de, fin: t } } : e.vus;
    return fini({ ...e, tenus: [...reste, x], vus, n: e.n + 1 }, true, 0, !meme);
  }
  /** Une émotion demandée : acceptée, prolongée, usée ou refusée selon ce qu'il ressent déjà. */
  function ressentir(e, a, t) {
    const demande = a.id;
    if (typeof demande !== 'string' || !possede(MOODS, demande) || demande === 'neutre') return fini(e, false);
    const E = e.emo && t < e.emo.a ? e.emo : null;
    const prolonger = () => {
      const fin = Math.min(Math.max(E.a, t + duree(E.id, a.ms) / 2), E.de + DEG.plafond[deg(E.id)]);
      const u = e.usure[E.demande];
      return fini({ ...e, emo: { ...E, a: fin }, usure: u ? { ...e.usure, [E.demande]: { ...u, fin } } : e.usure }, true, fin - t);
    };
    if (E && E.id === demande) return prolonger();
    // Habituation : la même émotion qui revient vite s'use (plus courte, puis un cran plus légère si sa famille est une vraie échelle).
    const libre = Boolean(a.force || a.sansHabitude) || fam(demande) === 'dialogue', u = e.usure[demande];
    const suite = !libre && u && t - u.fin < HABITUDE ? u.n + 1 : 1;
    const id = suite >= 3 ? plusLeger(demande) : demande, k = suite >= 3 ? .5 : suite === 2 ? .6 : 1;
    if (E && E.id === id) return prolonger();
    if (E && !a.force) {
      if (fam(E.id) === fam(id)) { if (rang(id) < rang(E.id)) return fini(e, false); }
      else {
        const assez = t - E.de >= Math.min(TENUE[deg(E.id)], .6 * (E.a - E.de));
        if (!(deg(id) > deg(E.id) || (deg(id) === deg(E.id) && RANG[fam(id)] > RANG[fam(E.id)]) || assez)) return fini(e, false);
      }
    }
    const ms = Math.max(600, Math.round(duree(id, a.ms) * k)), usure = { ...e.usure };
    if (E && usure[E.demande] && usure[E.demande].fin > t) usure[E.demande] = { ...usure[E.demande], fin: t };
    if (!libre) usure[demande] = { n: suite, fin: t + ms };
    const emo = { id, demande, de: t, a: t + ms, ordre: e.n + 1, retombe: deg(id) === 3, raison: a.raison ? String(a.raison) : '', source: a.source ? String(a.source) : '' };
    return fini({ ...e, emo, usure, n: e.n + 1 }, true, ms, suite === 1);
  }
  /**
   * Une action sur l'état (pur). Types : ressent, fond, tenir, lacher, parole, et les anciens appels pose (set), flash, base.
   * Le nouvel état porte `dernier` : { ok, ms (temps en couleur accordé), geste (jouer le geste d'arrivée) }.
   */
  function agir(e0, a, t) {
    const e = nettoyer(e0, t), type = a && a.type;
    if (type === 'ressent') return ressentir(e, a, t);
    if (type === 'fond') return fini({ ...e, fond: connu(a.id), fondPose: true, fondDe: t }, true);
    if (type === 'tenir') return prendre(e, a, t);
    if (type === 'lacher') return fini(relacher(e, a.qui || 'defaut', t), true);
    if (type === 'parole') return fini({ ...e, parle: a.oui ? { a: t + borne(a.ms), parSet: false } : null }, true);
    if (type === 'flash') {
      // Un éclat ne coupe jamais une émotion plus forte, ni un état déjà tenu.
      if (typeof a.id !== 'string' || !possede(MOODS, a.id) || a.id === 'neutre') return fini(e, false);
      const ms = typeof a.ms === 'number' && a.ms === a.ms ? a.ms : 2200;
      // (Un éclat qui suit un autre éclat le prolonge ou le remplace : sinon le visage clignoterait pendant qu'on écrit.)
      if (tenable(a.id)) return e.tenus.some((x) => x.qui !== 'flash') ? fini(e, false) : prendre(e, { id: a.id, qui: 'flash', ms: Math.max(600, ms) }, t);
      return ressentir(e, { id: a.id, ms, source: 'flash' }, t);
    }
    if (type === 'base') {
      // L'humeur d'une réponse : en couleur le temps de sa durée. Sans moteur de vie (fond() jamais appelé), elle devient aussi le fond.
      const id = connu(a.id);
      if (tenable(id)) return prendre(e, { id, qui: 'base' }, t);
      let x = relacher(e, 'base', t);
      if (!x.fondPose) x = { ...x, fond: id, fondDe: t };
      return id === 'neutre' ? fini(x, true) : ressentir(x, { id, source: 'base' }, t);
    }
    if (type === 'pose') {
      // set() : ce qu'on pose se voit tout de suite. « parle » : la bouche seulement, par-dessus le reste.
      if (a.id === 'parle' && !a.couleur) return fini({ ...e, parle: { a: t + GARDE, parSet: true } }, true);
      const id = connu(a.id);
      let x = e.parle && e.parle.parSet ? { ...e, parle: null } : e;
      if (tenable(id)) return prendre(x, { id, qui: 'set' }, t);
      x = relacher(x, 'set', t);
      if (a.couleur && id !== 'neutre') return ressentir(x, { id, force: true, sansHabitude: true, source: 'set' }, t);
      if (!x.fondPose) {
        x = { ...x, fond: id, fondDe: t };
        if (x.emo && x.emo.id !== id && x.emo.demande !== id) x = { ...x, emo: null };
      }
      return fini(x, true);
    }
    return fini(e, false);
  }
  /** Ce qui se voit à l'instant t, avec la couche qui le donne (pour le dessin et l'événement). */
  function regard(e, t) {
    const tenus = e.tenus.filter((x) => t < x.a), tenu = tenus.length ? tenus[tenus.length - 1] : null;
    const emo = e.emo && t < e.emo.a ? e.emo : null, parle = Boolean(e.parle && t < e.parle.a);
    const quand = []; // les prochains instants où quelque chose change
    if (parle) quand.push(e.parle.a);
    for (const x of tenus) quand.push(x.a);
    if (emo) quand.push(emo.a);
    let r;
    if (tenu && emo && deg(emo.id) >= 2 && emo.ordre > tenu.ordre && t < emo.de + DEVANT) {
      quand.push(emo.de + DEVANT);
      r = { id: emo.id, couleur: true, vif: true, couche: 'emotion', jusque: Math.min(emo.a, emo.de + DEVANT), raison: emo.raison, source: emo.source };
    } else if (tenu) {
      const fin = Math.min(tenu.de + TENU_COULEUR, tenu.a), couleur = t < fin;
      if (couleur) quand.push(fin);
      r = { id: tenu.id, couleur, vif: true, couche: 'tenu', jusque: couleur ? fin : 0, raison: '', source: tenu.qui };
    } else if (emo) r = { id: emo.id, couleur: true, vif: true, couche: 'emotion', jusque: emo.a, raison: emo.raison, source: emo.source };
    else if (e.emo && e.emo.retombe && t >= e.emo.a && t < e.emo.a + RETOMBEE) {
      quand.push(e.emo.a + RETOMBEE);
      r = { id: plusLeger(e.emo.id), couleur: false, vif: false, couche: 'retombee', jusque: 0, raison: e.emo.raison, source: e.emo.source };
    } else {
      const id = fondVu(e, t);
      if (!e.fondPose && id !== 'neutre' && !DURABLE.has(fam(id))) quand.push(e.fondDe + GARDE);
      r = { id, couleur: false, vif: false, couche: 'fond', jusque: 0, raison: '', source: 'fond' };
    }
    if (tenu && e.emo && e.emo.retombe && !emo) quand.push(e.emo.a + RETOMBEE);
    const apres = quand.filter((x) => x > t);
    return { ...r, parle, reveil: apres.length ? Math.min(...apres) : null, emotion: emo ? emo.id : null, tenu: tenu ? tenu.id : null };
  }
  /** Ce qu'il montre à l'instant t : { id, couleur, vif, parle, reveil } (reveil : le prochain instant où ça change, ou null). */
  function vue(e, t) { const r = regard(e, t); return { id: r.id, couleur: r.couleur, vif: r.vif, parle: r.parle, reveil: r.reveil }; }

  // ---------- Le dessin ----------
  const L = 47.5, R = 72.5, Y = 56;
  const f2 = (v) => +v.toFixed(2);
  // Yeux en pastille (pilule debout, 9 × 22) : la forme par défaut d'Odin, partout.
  const pill = (x, y = Y, h = 22, c = 'eye plein') => `<rect class="${c}" x="${x - 4.5}" y="${y - h / 2}" width="9" height="${h}" rx="4.5" fill="${W}"/>`;
  const line = (d, w = 4) => `<path class="trait" d="${d}" fill="none" stroke="${W}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const heart = (cx, cy, s = 6.5, c = 'eye plein', f = W) => `<path class="${c}" d="M${cx} ${f2(cy + s * .95)}C${f2(cx - s * 1.7)} ${f2(cy - s * .1)} ${f2(cx - s * .75)} ${f2(cy - s * 1.45)} ${cx} ${f2(cy - s * .45)}C${f2(cx + s * .75)} ${f2(cy - s * 1.45)} ${f2(cx + s * 1.7)} ${f2(cy - s * .1)} ${cx} ${f2(cy + s * .95)}Z" fill="${f}"/>`;
  const star = (cx, cy, r = 7.5) => { let d = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; d += `${i ? 'L' : 'M'}${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`; } return `<path class="eye plein bord" d="${d}Z" fill="${W}" stroke="${W}" stroke-width="1" stroke-linejoin="round"/>`; };
  // Pastille dont le bas est poussé par la joue : l'œil qui sourit (9 × 16).
  const sourit = (x) => `<path class="eye plein" d="M${x - 4.5} ${Y + 6}V${Y - 5.5}a4.5 4.5 0 0 1 9 0V${Y + 6}Q${x} ${Y + 1.5} ${x - 4.5} ${Y + 6}Z" fill="${W}"/>`;
  // Pastille coupée en biais par le haut. `bas` : +1 le coin bas est à droite, −1 à gauche ; k : profondeur de la coupe.
  const coupe = (x, bas, k) => `<path class="eye plein" d="M${x - 4.5} ${Y - 9 + (bas < 0 ? k : 0)}L${x + 4.5} ${Y - 9 + (bas > 0 ? k : 0)}V${Y + 6.5}a4.5 4.5 0 0 1-9 0Z" fill="${W}"/>`;
  const K = (m) => m.k ?? [4, 5.5, 6.5][m.degre - 1];
  // Pastille mouillée (9 × 23) : un reflet d'eau en bas.
  const eau = (x) => `<g class="eye">${pill(x, Y, 23, 'plein')}<path d="M${x - 3.3} ${Y + 5.5}Q${x} ${Y + 2.5} ${x + 3.3} ${Y + 5.5}Q${x + 3.3} ${Y + 10} ${x} ${Y + 10.3}Q${x - 3.3} ${Y + 10} ${x - 3.3} ${Y + 5.5}Z" fill="#4A98EC"/></g>`;
  // L'œil fermé : la pastille couchée (12 × 4).
  const couche = (x) => `<rect class="plein ferme" x="${x - 6}" y="${Y + 2}" width="12" height="4" rx="2" fill="${W}"/>`;
  // Chaque forme d'yeux : [œil gauche, œil droit]. Les formes livrées sont toutes des pastilles debout, sauf l'œil fermé de l'endormi.
  const EYES = {
    pill: () => [pill(L), pill(R)],
    up: () => [pill(L, Y - 4, 20), pill(R, Y - 4, 20)],
    uneven: () => [pill(L, Y, 22), pill(R, Y + 2, 14)],
    half: () => [pill(L, Y + 3.75, 14.5), pill(R, Y + 3.75, 14.5)],
    sourit: () => [sourit(L), sourit(R)],
    fache: (m) => [coupe(L, 1, K(m)), coupe(R, -1, K(m))],   // la coupe descend vers le nez
    tombant: (m) => [coupe(L, -1, K(m)), coupe(R, 1, K(m))], // la coupe descend vers l'extérieur
    mouille: () => (YEUX_SEULS ? [pill(L, Y, 23), pill(R, Y, 23)] : [eau(L), eau(R)]),
    ferme: () => [couche(L), couche(R)],
    // Formes libres : gardées pour la planche, jamais dessinées tant que FORMES_LIBRES est faux.
    happy: () => [line(`M${L - 5.5} ${Y + 4}Q${L} ${Y - 10} ${L + 5.5} ${Y + 4}`, 4.5), line(`M${R - 5.5} ${Y + 4}Q${R} ${Y - 10} ${R + 5.5} ${Y + 4}`, 4.5)],
    closed: () => [line(`M${L - 5.5} ${Y - 1}Q${L} ${Y + 9} ${L + 5.5} ${Y - 1}`, 4.5), line(`M${R - 5.5} ${Y - 1}Q${R} ${Y + 9} ${R + 5.5} ${Y - 1}`, 4.5)],
    wink: () => [pill(L), line(`M${R - 5.5} ${Y + 3}Q${R} ${Y - 7} ${R + 5.5} ${Y + 3}`, 4.5)],
    serre: () => [line(`M${L - 5} ${Y - 6}L${L + 4} ${Y}L${L - 5} ${Y + 6}`, 4.5), line(`M${R + 5} ${Y - 6}L${R - 4} ${Y}L${R + 5} ${Y + 6}`, 4.5)],
    wide: () => [`<ellipse class="eye plein" cx="${L}" cy="${Y}" rx="6.5" ry="9" fill="${W}"/>`, `<ellipse class="eye plein" cx="${R}" cy="${Y}" rx="6.5" ry="9" fill="${W}"/>`],
    small: () => [`<circle class="eye plein" cx="${L}" cy="${Y + 1}" r="3.8" fill="${W}"/>`, `<circle class="eye plein" cx="${R}" cy="${Y + 1}" r="3.8" fill="${W}"/>`],
    heart: () => [heart(L, Y), heart(R, Y)],
    star: () => [star(L, Y), star(R, Y)],
    shades: () => [`<path d="M36 48h48v6c0 6-4 10-10 10h-6c-4 0-6-3-7-6h-2c-1 3-3 6-7 6h-6c-6 0-10-4-10-10z" fill="#1E1A14"/><path d="M41 51h9M66 51h9" stroke="#fff" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/>`, ''],
  };
  // Taille de chaque œil avant échelle [largeur, hauteur] (pour une pastille coupée : son côté le plus court).
  const deux = (l, h) => () => [[l, h], [l, h]];
  const MESURE = { ferme: deux(12, 4), pill: deux(9, 22), up: deux(9, 20), uneven: () => [[9, 22], [9, 14]], half: deux(9, 14.5), sourit: deux(9, 16), fache: (m) => deux(9, 20 - K(m))(), tombant: (m) => deux(9, 20 - K(m))(), mouille: deux(9, 23), happy: deux(15.5, 11.5), closed: deux(15.5, 9.5), wink: () => [[9, 22], [15.5, 9.5]], serre: deux(13.5, 16.5), wide: deux(13, 18), small: deux(7.6, 7.6), heart: deux(22, 16), star: deux(15, 15), shades: deux(22, 16) };
  const GENRE = { ferme: 'ferme', pill: 'pastille', up: 'pastille', uneven: 'pastille', half: 'pastille', sourit: 'pastille', fache: 'pastille', tombant: 'pastille', mouille: 'pastille', happy: 'arc', closed: 'arc', wink: 'arc', serre: 'arc', wide: 'rond', small: 'rond', heart: 'signe', star: 'signe', shades: 'lunettes' };
  const BROWS = {
    angry: () => line('M39 40L53 46', 3.6) + line('M81 40L67 46', 3.6),
    sad: () => line('M40 45L53 39', 3.4) + line('M80 45L67 39', 3.4),
    raised: () => line('M40 38Q47.5 33 55 38', 3.4) + line('M65 38Q72.5 33 80 38', 3.4),
    one: () => line('M65 37Q72.5 32 80 37', 3.4),
    focus: () => line('M40 44L54 45', 3.4) + line('M80 44L66 45', 3.4),
    plat: () => line('M40 43H54', 3.4) + line('M66 43H80', 3.4),
    peur: () => line('M41 40L54 36', 3.4) + line('M79 40L66 36', 3.4),
  };
  const MOUTH = {
    smile: () => line('M50 76Q60 85 70 76', 3.6),
    grin: () => `<path class="plein bord" d="M47 74Q60 92 73 74Z" fill="${W}" stroke="${W}" stroke-width="2" stroke-linejoin="round"/>`,
    o: () => `<ellipse class="plein" cx="60" cy="79" rx="4.5" ry="5.5" fill="${W}"/>`,
    frown: () => line('M51 83Q60 75 69 83', 3.6),
    flat: () => line('M54 79H66', 3.6),
    wavy: () => line('M49 80Q54.5 76 60 80T71 80', 3.4),
    wobble: () => `<path class="plein" d="M50 79Q55 74 60 79T70 79Q65 86 60 84T50 79Z" fill="${W}"/>`,
    smirk: () => line('M51 79Q62 83 70 74', 3.6),
    side: () => line('M58 80H68', 3.4),
    talk: () => `<ellipse class="dit plein" cx="60" cy="79" rx="5.5" ry="4" fill="${W}"/>`,
    petit: () => line('M54 77Q60 82 66 77', 3.4),
    grand_o: () => `<ellipse class="plein" cx="60" cy="81" rx="6.5" ry="8.5" fill="${W}"/>`,
    dents: () => `<rect class="plein" x="49" y="75" width="22" height="10" rx="4" fill="${W}"/><path d="M54.5 75.5v9M60 75.5v9M65.5 75.5v9M49.5 80h21" fill="none" stroke="#000" stroke-opacity=".32" stroke-width="1.3"/>`,
    moue: () => line('M55 82Q61 77 67 81', 3.6),
    baille: () => `<ellipse class="baille plein" cx="60" cy="80" rx="5.5" ry="7.5" fill="${W}"/>`,
  };
  /** Les bouches pleines : les seules gardées en tout petit (pas la bouche tremblante : en tout petit, elle ressemblait à un sourire). */
  const PLEINES = new Set(['grin', 'o', 'grand_o', 'talk', 'dents', 'baille']);
  const goutte = (x, y, s, c, f = '#CFE8FF') => `<path class="${c}" d="M${x} ${y}q${f2(-4 * s)} ${f2(7 * s)} 0 ${f2(10 * s)}q${f2(4 * s)} ${f2(-3 * s)} 0 ${f2(-10 * s)}z" fill="${f}"/>`;
  const eclat = (x, y, r, c) => `<path class="${c}" d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="#FFF3B0"/>`;
  const zed = (x, y, s, c) => { const l = s * .82, t = s * .26; return `<path class="${c}" d="M${x} ${y}h${f2(l)}v${f2(t)}L${f2(x + t * 1.35)} ${f2(y + s - t)}H${f2(x + l)}v${f2(t)}H${x}v${f2(-t)}L${f2(x + l - t * 1.35)} ${f2(y + t)}H${x}Z" fill="${W}" stroke-linejoin="round"/>`; };
  const main = (cx, cy, tourne = 0) => `<g${tourne ? ` transform="rotate(${tourne} ${cx} ${cy})"` : ''}><ellipse class="main" cx="${cx}" cy="${cy}" rx="10.5" ry="13"/><path class="doigt" d="M${cx - 3.6} ${cy - 9.4}v5M${cx} ${cy - 10.8}v5.6M${cx + 3.6} ${cy - 9.4}v5" fill="none"/></g>`;
  const CROCHET = 'M82.6 22.2a5.5 5.5 0 1 1 8.6 4.6c-1.9 1.3-3.2 2.4-3.2 4.9';
  // Chaque extra : [calque, morceaux]. Calque « sous » : sous les yeux. Un morceau : [niveau, dessin] avec le niveau
  // 'gros' (gardé en tout petit), '' (grand et petit) ou 'fin' (grand seulement). Classe « dehors » : liseré de la
  // teinte foncée, pour rester lisible hors du disque et sur une page claire.
  const EXTRA = {
    tear: ['extra', [['gros', goutte(44, 67, 1, 'larme dehors', '#A9D4FF')]]],
    sweat: ['extra', [['fin', goutte(86, 36, 1, 'sueur dehors')]]],
    zzz: ['extra', [['gros', zed(81, 27, 10, 'zz plein dehors')], ['fin', zed(92, 18, 7.5, 'zz z2 plein dehors')], ['fin', zed(100, 11, 5.5, 'zz z3 plein dehors')]]],
    z: ['extra', [['gros', zed(83, 26, 9, 'zz plein dehors')]]],
    hands: ['extra', [['gros', main(46.5, 56.5) + main(73.5, 56.5)]]],
    main: ['extra', [['gros', main(73.5, 61.5, -8)]]],
    larmes: ['extra', [['gros', `<path class="flot" d="M43 68C40 78 41 88 44 97" fill="none" stroke="#A9D4FF" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="7 4"/><path class="flot" d="M77 68C80 78 79 88 76 97" fill="none" stroke="#A9D4FF" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="7 4"/>`]]],
    coeurs: ['extra', [['gros', heart(86, 30, 4.6, 'monte coeur', '#F0245F')], ['fin', heart(97, 19, 3.2, 'monte m2 coeur', '#F0245F')], ['fin', heart(76, 19, 2.6, 'monte m3 coeur', '#F0245F')]]],
    etincelles: ['extra', [['', eclat(90, 30, 6.5, 'brille dehors')], ['fin', eclat(27, 38, 4.5, 'brille b2 dehors')], ['fin', eclat(97, 54, 3.5, 'brille b3 dehors')]]],
    etoile: ['extra', [['', eclat(60, 24, 6.5, 'brille')]]],
    veine: ['extra', [['', `<path class="bat" d="M84 27q4 1 3 5M94 27q-4 1-3 5M84 37q4-1 3-5M94 37q-4-1-3-5" fill="none" stroke="#FFE0DA" stroke-width="2.6" stroke-linecap="round"/>`]]],
    fumee: ['extra', [['fin', `<path class="puff plein dehors" d="M14.5 39.5a3.3 3.3 0 0 1-.4-6.4a4 4 0 0 1 7.2-1.6a3.2 3.2 0 0 1 1.2 6.3q-.6 1.7-2.5 1.7z" fill="${W}"/>`], ['fin', `<path class="puff p2 plein dehors" d="M105.5 39.5a3.3 3.3 0 0 0 .4-6.4a4 4 0 0 0-7.2-1.6a3.2 3.2 0 0 0-1.2 6.3q.6 1.7 2.5 1.7z" fill="${W}"/>`]]],
    gouttes: ['extra', [['fin', goutte(28, 20, .8, 'gicle dehors') + goutte(60, 6, .8, 'gicle g2 dehors') + goutte(92, 20, .8, 'gicle g3 dehors')]]],
    // Voile sombre en haut du disque, en trois bandes légères.
    ombre: ['sous', [['gros', '<g fill="#0B1030" opacity=".12"><path d="M17.7 50A43.5 43.5 0 0 1 102.3 50Q60 40 17.7 50Z"/><path d="M20.4 42A43.5 43.5 0 0 1 99.6 42Q60 31 20.4 42Z"/><path d="M25.1 34A43.5 43.5 0 0 1 94.9 34Q60 24 25.1 34Z"/></g>']]],
    point_ex: ['extra', [['gros', `<g class="signe"><path class="plein dehors" d="M85.6 16.5h5l-1.1 13.5h-2.8Z" fill="${W}" stroke-linejoin="round"/><circle class="plein dehors" cx="88.1" cy="35.4" r="2.6" fill="${W}"/></g>`]]],
    point_int: ['extra', [['gros', `<g class="signe"><path class="lis" d="${CROCHET}" fill="none" stroke-width="6.6" stroke-linecap="round"/><path class="trait" d="${CROCHET}" fill="none" stroke="${W}" stroke-width="4" stroke-linecap="round"/><circle class="plein dehors" cx="88" cy="37.2" r="2.4" fill="${W}"/></g>`]]],
    points: ['extra', [['', `<circle class="pt plein dehors" cx="82" cy="35" r="2.2" fill="${W}"/><circle class="pt pt2 plein dehors" cx="89.5" cy="27.5" r="3" fill="${W}"/><circle class="pt pt3 plein dehors" cx="98.5" cy="18.5" r="3.8" fill="${W}"/>`]]],
    soupir: ['extra', [['fin', `<g class="soupir plein" fill="${W}" opacity=".78"><ellipse cx="78" cy="83" rx="5" ry="3.2"/><ellipse cx="85.5" cy="81" rx="3" ry="2"/></g>`]]],
    bave: ['extra', [['fin', '<path class="dehors" d="M63.6 82.4q-2.4 5.5 0 7.5q2.4-2 0-7.5z" fill="#CFE8FF"/>']]],
    // Lunettes aux verres teintés translucides : on voit les pastilles à travers.
    lunettes: ['extra', [['gros', '<path d="M36 48h48v6c0 6-4 10-10 10h-6c-4 0-6-3-7-6h-2c-1 3-3 6-7 6h-6c-6 0-10-4-10-10z" fill="#1E1A14" fill-opacity=".55"/><path d="M35.5 48.6h49" fill="none" stroke="#1E1A14" stroke-opacity=".82" stroke-width="2.6" stroke-linecap="round"/><path d="M41 52.6h8M66 52.6h8" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.8" stroke-linecap="round"/>']]],
  };
  /** Les extras gardés quand le visage est adouci (fond). */
  const EXTRAS_DOUX = new Set(['zzz', 'z', 'hands', 'main', 'points']);
  /** Les animations d'yeux gardées quand le visage est adouci (les plus lentes). */
  const YEUX_DOUX = new Set(['ponder', 'sink', 'pese', 'sly', 'shy', 'look']);
  const joues = (n) => (n ? [34, 86].map((x) => `<ellipse cx="${x}" cy="70" rx="${5.5 + n}" ry="${3.2 + n * .5}" fill="#E8305E" opacity="${f2(.22 + n * .14)}"/>`).join('') : '');
  // Postures du corps [rotation, dx, dy, sx, sy], multipliées par l'ampleur du degré.
  const POSES = { droit: [0, 0, 0, 1, 1], penche: [-7, 0, 0, 1, 1], penche_d: [7, 0, 0, 1, 1], affaisse: [0, 0, 3, 1.05, .94], gonfle: [0, 0, -2, 1.05, 1.05], petit: [0, 0, 2, .9, .9], avance: [0, 0, -1, 1.04, 1.04], recule: [5, 3, 0, .97, .97], tasse: [0, 0, 5, 1.09, .9] };
  const BOUCLES = ['souffle', 'lent', 'vif', 'rebond', 'sautille', 'rire', 'tremble', 'frisson', 'sanglot', 'gronde', 'secoue', 'balance', 'battement', 'dodeline', 'trepigne', 'hoche', 'affole', 'parle', 'fige'];
  /** Les boucles trop fortes pour être remplacées par celle de la parole. */
  const BOUCLE_GARDEE = new Set(['rire', 'sanglot', 'tremble', 'secoue', 'affole']);
  /** Gestes du corps joués une fois : leur durée (ms). */
  const GESTES = { sursaut: 380, bond: 620, recul: 450, tasse: 800, gonfle: 600, fond: 900, penche: 450, fremit: 350, hoche: 350 };
  /** Trois tailles : tout (47 px et plus), moins de détails (31 à 46), l'essentiel (30 et moins). Valeur : agrandissement des yeux. */
  const TAILLES = { grand: 1, petit: 1.18, mini: 1.3 };

  /**
   * Le dessin d'une émotion (pur). opts : { taille: 'grand' | 'petit' | 'mini', vif (faux = fond adouci), parle,
   * fige (vrai = rien ne bouge : ce qui ne se lisait que par une animation est dessiné) }.
   */
  function dessin(id, o = {}) {
    id = connu(id);
    const m = MOODS[id], taille = possede(TAILLES, o.taille || '') ? o.taille : 'grand', mini = taille === 'mini', petit = taille !== 'grand';
    const vif = o.vif !== false, parle = Boolean(o.parle);
    // Le clin d'œil n'existe que par son animation : quand rien ne bouge, l'œil droit est dessiné plus court (toujours une pastille debout) et un sourcil se lève.
    const clinFixe = m.a === 'clin' && (Boolean(o.fige) || !vif);
    const forme = FORMES_LIBRES && LIBRE[id] ? LIBRE[id] : YEUX_FERMES.has(id) ? 'ferme' : clinFixe ? 'uneven' : m.y, sourcil = clinFixe ? 'one' : m.s;
    const es = m.e ? (Array.isArray(m.e[0]) ? m.e : [m.e, m.e]) : [[1, 1], [1, 1]];
    const calques = { sous: '', extra: '' };
    for (const x of m.x || []) {
      if (YEUX_SEULS && !MARQUES_PERMISES.has(x)) continue;
      if (!vif && !EXTRAS_DOUX.has(x)) continue;
      const [ou, morceaux] = EXTRA[x];
      for (const [niveau, svg] of morceaux) if (niveau === 'gros' || (!mini && (niveau !== 'fin' || !petit))) calques[ou] += svg;
    }
    const k = DEG.ampli[m.degre] * (vif ? 1 : .5), P = POSES[m.c[0]], r = m.r || [0, 0, 1], d = m.d || [0, 0];
    // Quand le corps s'écrase ou s'étire (affaissé, tassé), les yeux ne suivent pas : ils gardent leur forme de pastille.
    const sx = 1 + (P[3] - 1) * k, sy = 1 + (P[4] - 1) * k, moyen = (sx + sy) / 2;
    let boucle = vif ? m.c[1] : 'souffle', bouche = m.b || '';
    if (parle) { bouche = 'talk'; if (!BOUCLE_GARDEE.has(boucle)) boucle = 'parle'; }
    const a = m.a && !clinFixe && (vif || YEUX_DOUX.has(m.a)) ? m.a : '', aura = m.aura || AURA[m.famille] || [7, 1];
    return {
      id, forme, genre: GENRE[forme], tint: m.tint, encre: encre(m.tint),
      mesure: MESURE[forme](m).map(([l, h], i) => [f2(l * es[i][0] * TAILLES[taille]), f2(h * es[i][1] * TAILLES[taille])]),
      yeux: EYES[forme](m),
      // Odin n'a que ses yeux et sa couleur : tout le reste du visage est vide (voir YEUX_SEULS).
      sourcils: YEUX_SEULS || mini || !sourcil || forme === 'shades' ? '' : BROWS[sourcil](),
      bouche: YEUX_SEULS || !bouche || (mini && !PLEINES.has(bouche)) ? '' : MOUTH[bouche](),
      joues: YEUX_SEULS || petit ? '' : joues(vif ? m.j || 0 : Math.min(1, m.j || 0)),
      sous: calques.sous, extras: calques.extra,
      vars: {
        '--lsx': es[0][0], '--lsy': es[0][1], '--rsx': es[1][0], '--rsy': es[1][1], '--edx': `${d[0]}px`, '--edy': `${d[1]}px`,
        '--o-gx': `${r[0]}px`, '--o-gy': `${r[1]}px`, '--o-suivi': r[2],
        '--o-rot': `${f2(P[0] * k)}deg`, '--o-px': `${f2(P[1] * k)}px`, '--o-py': `${f2(P[2] * k)}px`, '--o-sx': +sx.toFixed(3), '--o-sy': +sy.toFixed(3), '--o-yx': +(moyen / sx).toFixed(4), '--o-yy': +(moyen / sy).toFixed(4),
        '--o-clign': m.clign ? `${m.clign}s` : '5.2s', '--o-orbite': `${Math.min(aura[0], 9)}s`, '--o-aura': aura[1],
        '--o-c0': m.tint[0], '--o-c2': m.tint[2],
      },
      classes: [a ? (a === 'look' ? 'm-look' : `e-${a}`) : '', `c-${boucle}`, m.clign === 0 ? 'sans-clin' : '', m.coup === 0 ? 'sans-coup' : '', m.vive && vif ? 'o-vive' : '', `o-${taille}`].filter(Boolean),
      entree: vif ? m.c[2] : '',
    };
  }

  // ---------- Le style des expressions (posé une seule fois par ce fichier, après celui de la page) ----------
  // Toute animation citée ici a ses images clés ici (noms en c- g- x- f-) : aucune règle de la page n'est redéfinie.
  // Chrome ne peint pas `rotate`, `translate` ou `scale` posés sur un élément du dessin dont une animation fait bouger
  // `transform`. Donc : la posture du corps est dans `transform`, et ses boucles (c-) et ses gestes (g-) animent
  // `translate`, `rotate` et `scale` ; le regard est sur un groupe à lui (.regard) et la taille de chaque œil aussi
  // (.taille), sous les groupes que la page anime (.eyes, .brow).
  // Le clignement (o-blink), le coup d'œil (o-glance) et les petites animations d'yeux d'origine (e-bob, e-dart…)
  // restent ceux de la page ; s'ils manquent (site, page Maison, page Recherche), le visage reste lisible sans eux.
  const CSS = `
.odin{--o-encre:#fff}
.odin.ev-dark-eyes{--o-encre:#fff}
.odin .plein{fill:var(--o-encre);transition:fill var(--o-fondu,.7s) ease}.odin .trait,.odin .bord{stroke:var(--o-encre);transition:stroke var(--o-fondu,.7s) ease}
.odin stop{transition:stop-color var(--o-fondu,.7s) ease}
.odin .body{transform-origin:60px 60px;transform:translate(var(--o-px,0px),var(--o-py,0px)) rotate(var(--o-rot,0deg)) scale(var(--o-sx,1),var(--o-sy,1));transition:transform .5s cubic-bezier(.3,1.3,.5,1)}
.odin .body .eyes{scale:none;translate:none}
.odin .body .eyes .regard{transform-origin:60px 56px;scale:calc(var(--o-ty,1)*var(--o-yx,1)) calc(var(--o-ty,1)*var(--o-yy,1));translate:calc(var(--lookx,0px)*var(--o-suivi,1) + var(--o-gx,0px)) calc(var(--looky,0px)*var(--o-suivi,1) + var(--o-gy,0px));transition:translate .3s ease-out}
.odin.sans-coup .eyes{animation:none}
.odin.thinking:not(.follow):not(.sans-coup) .eyes{animation:x-cherche 2.8s ease-in-out infinite}
.odin .eye{transform-box:fill-box;transform-origin:center;animation-duration:var(--o-clign,5.2s)}
.odin.sans-clin .eye{animation:none}
.odin.o-clin .eyes .eye{animation:x-clin .2s ease-in-out}
.odin .eyes .brow.l,.odin .eyes .brow.r{transform-box:fill-box;transform-origin:center;scale:none;translate:none;transition:none}
.odin .eyes .brow .taille{transform-box:fill-box;transform-origin:center;transition:scale .45s cubic-bezier(.3,1.4,.5,1),translate .45s cubic-bezier(.3,1.4,.5,1)}
.odin .eyes .brow.l .taille{scale:calc(var(--lsx,1)*var(--o-exa,1)) calc(var(--lsy,1)*var(--o-exa,1));translate:var(--edx,0px) var(--edy,0px)}
.odin .eyes .brow.r .taille{scale:calc(var(--rsx,1)*var(--o-exa,1)) calc(var(--rsy,1)*var(--o-exa,1));translate:calc(-1*var(--edx,0px)) var(--edy,0px)}
.odin.e-pese .brow{animation:f-pese 2.8s ease-in-out infinite}
.odin.e-clin .brow.r{animation:f-clin 1.4s ease-in-out infinite}
.odin .mouth,.odin .cheeks,.odin .extra,.odin .sous{transition:opacity .3s}
.odin.o-sort .extra,.odin.o-sort .cheeks,.odin.o-sort .sous{opacity:0}
.odin .extra .main{fill:var(--o-c2,#7EAEF8);stroke:var(--o-c0,#2F6FE0);stroke-width:1.2px}
.odin .extra .doigt{stroke:var(--o-c0,#2F6FE0);stroke-width:1.1px;stroke-linecap:round;opacity:.55}
.odin .extra .dehors{stroke:var(--o-c0,#2F6FE0);stroke-width:1.4px;paint-order:stroke}
.odin .extra .lis{stroke:var(--o-c0,#2F6FE0)}
.odin .extra .coeur{stroke:#fff;stroke-width:1.2px;paint-order:stroke}
.odin.o-petit{--o-ty:1.18}
.odin.o-petit .brows{translate:0 -2px}
.odin.o-petit .brows .trait,.odin.o-petit .mouth .trait{stroke-width:5.5px}
.odin.o-mini{--o-ty:1.3}
.c-souffle .body{animation:c-souffle 4.4s ease-in-out infinite}
.c-lent .body{animation:c-lent 6.5s ease-in-out infinite}
.c-vif .body{animation:c-souffle 2.1s ease-in-out infinite}
.c-rebond .body{animation:c-rebond 1.6s ease-in-out infinite}
.c-sautille .body{animation:c-sautille .55s cubic-bezier(.3,.9,.4,1) infinite}
.c-rire .body{animation:c-rire .42s ease-in-out infinite}
.c-tremble .body{animation:c-tremble .12s linear infinite}
.c-frisson .body{animation:c-frisson 2.4s linear infinite}
.c-sanglot .body{animation:c-sanglot 1.6s ease-in-out infinite}
.c-gronde .body{animation:c-gronde .1s linear infinite}
.c-secoue .body{animation:c-secoue .5s ease-in-out infinite}
.c-balance .body{animation:c-balance 4s ease-in-out infinite}
.c-battement .body{animation:c-battement 1.1s ease-in-out infinite}
.c-dodeline .body{animation:c-dodeline 5s ease-in-out infinite}
.c-trepigne .body{animation:c-trepigne 1.5s ease-in-out infinite}
.c-hoche .body{animation:c-hoche 2.2s ease-in-out infinite}
.c-affole .body{animation:c-affole .28s ease-in-out infinite}
.c-parle .body{animation:c-parle .5s ease-in-out infinite}
.c-fige .body{animation:none}
.odin.g-sursaut .body{animation:g-sursaut .38s cubic-bezier(.3,.9,.4,1)}
.odin.g-bond .body{animation:g-bond .62s cubic-bezier(.3,.9,.4,1)}
.odin.g-recul .body{animation:g-recul .45s ease-out}
.odin.g-tasse .body{animation:g-tasse .8s ease}
.odin.g-gonfle .body{animation:g-gonfle .6s ease}
.odin.g-fond .body{animation:g-fond .9s ease}
.odin.g-penche .body{animation:g-penche .45s ease}
.odin.g-fremit .body{animation:g-fremit .35s linear}
.odin.g-hoche .body{animation:g-hoche .35s ease}
.odin .extra .monte,.odin .extra .brille,.odin .extra .bat,.odin .extra .puff,.odin .extra .gicle,.odin .mouth .baille,.odin .mouth .dit{transform-box:fill-box;transform-origin:center}
.odin .extra .larme{animation:x-larme 1.6s ease-in infinite}
.odin .extra .sueur{animation:x-larme 2.2s ease-in infinite}
.odin .extra .zz{animation:x-zz 2.4s ease-in-out infinite}.odin .extra .z2{animation-delay:.6s}.odin .extra .z3{animation-delay:1.2s}
.odin .extra .monte{animation:x-monte 2.4s ease-in infinite}.odin .extra .m2{animation-delay:.8s}.odin .extra .m3{animation-delay:1.6s}
.odin .extra .brille{animation:x-brille 1.2s ease-in-out infinite alternate}.odin .extra .b2{animation-delay:.4s}.odin .extra .b3{animation-delay:.8s}
.odin .extra .bat{animation:x-bat .5s ease-in-out infinite alternate}
.odin .extra .flot{animation:x-flot .6s linear infinite}
.odin .extra .puff{animation:x-puff 1.1s ease-out infinite}.odin .extra .p2{animation-delay:.55s}
.odin .extra .gicle{animation:x-gicle .9s ease-out infinite}.odin .extra .g2{animation-delay:.3s}.odin .extra .g3{animation-delay:.6s}
.odin .extra .soupir{animation:x-soupir 3.2s ease-out infinite}
.odin .extra .signe{transform-box:fill-box;transform-origin:50% 100%;animation:x-signe .45s cubic-bezier(.3,1.8,.5,1)}
.odin .extra .pt{animation:x-pt 1.2s ease-in-out infinite}.odin .extra .pt2{animation-delay:.2s}.odin .extra .pt3{animation-delay:.4s}
.odin .mouth .baille{animation:x-baille 5s ease-in-out infinite}
.odin .mouth .dit{animation:x-parole 1.9s linear infinite}
.odin .orbit{opacity:1}
.odin .orbit.o1{animation-duration:var(--o-orbite,7s)}.odin .orbit.o2{animation-duration:calc(var(--o-orbite,7s)*1.36)}
.odin.angry stop.s1,.odin.angry stop.s2,.odin.angry stop.s3,.odin.angry stop.s4{animation:none}
.odin.o-vive stop.s2{animation:x-vive .8s ease-in-out infinite}
@keyframes f-pese{0%,100%{transform:translateY(0)}50%{transform:translateY(1.6px)}}
@keyframes f-clin{0%,62%,100%{transform:scaleY(1)}72%,86%{transform:scaleY(.1)}}
@keyframes x-cherche{0%,100%{transform:translate(0,0)}25%,45%{transform:translate(-4px,-4px)}60%,80%{transform:translate(4px,-4px)}}
@keyframes x-clin{0%,100%{transform:scaleY(1)}45%,60%{transform:scaleY(.08)}}
@keyframes x-larme{0%{transform:translateY(0);opacity:0}15%{opacity:1}100%{transform:translateY(10px);opacity:0}}
@keyframes x-zz{0%,100%{transform:translateY(0);opacity:.35}50%{transform:translateY(-4px);opacity:1}}
@keyframes x-monte{0%{transform:translateY(4px) scale(.5);opacity:0}25%{opacity:1}100%{transform:translateY(-12px) scale(1);opacity:0}}
@keyframes x-brille{from{transform:scale(.35);opacity:.3}to{transform:scale(1) rotate(20deg);opacity:1}}
@keyframes x-bat{from{transform:scale(.9)}to{transform:scale(1.2)}}
@keyframes x-flot{to{stroke-dashoffset:-11}}
@keyframes x-puff{0%{transform:scale(.4);opacity:0}30%{opacity:.9}100%{transform:translateY(-8px) scale(1.25);opacity:0}}
@keyframes x-gicle{0%{transform:translateY(0);opacity:0}20%{opacity:1}100%{transform:translateY(-9px);opacity:0}}
@keyframes x-soupir{0%,55%{transform:translateX(0);opacity:0}65%{opacity:.8}100%{transform:translate(10px,-3px);opacity:0}}
@keyframes x-signe{0%{transform:scale(0)}100%{transform:scale(1)}}
@keyframes x-pt{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes x-baille{0%,58%,100%{transform:scale(.45,.25)}70%,86%{transform:scale(1)}}
@keyframes x-parole{0%,100%{transform:scaleY(.35)}8%{transform:scaleY(1.1)}17%{transform:scaleY(.5)}27%{transform:scaleY(1.2)}36%{transform:scaleY(.3)}47%{transform:scaleY(.9)}55%{transform:scaleY(.45)}66%{transform:scaleY(1.15)}74%{transform:scaleY(.6)}85%{transform:scaleY(1)}93%{transform:scaleY(.4)}}
@keyframes x-vive{50%{stop-color:var(--o-vif,#FF5A4A)}}
@keyframes c-souffle{0%,100%{scale:1;translate:0 0}50%{scale:1.035;translate:0 -1px}}
@keyframes c-lent{0%,100%{scale:1;translate:0 0}50%{scale:1.045;translate:0 -1.5px}}
@keyframes c-rebond{0%,100%{translate:0 0;scale:1}40%{translate:0 -5px;scale:.985 1.02}70%{translate:0 0;scale:1.03 .97}}
@keyframes c-sautille{0%,100%{translate:0 0;scale:1}40%{translate:0 -10px;scale:.98 1.03}70%{translate:0 0;scale:1.04 .96}}
@keyframes c-rire{0%,100%{translate:0 0;rotate:0deg;scale:1}50%{translate:0 -3px;rotate:3deg;scale:1.03 .97}}
@keyframes c-tremble{0%,100%{translate:0 0}25%{translate:-1.2px 0}75%{translate:1.2px 0}}
@keyframes c-frisson{0%,70%,100%{translate:0 0}74%,82%,90%{translate:-1.4px 0}78%,86%,94%{translate:1.4px 0}}
@keyframes c-sanglot{0%,60%,100%{translate:0 0;scale:1}10%{translate:0 -3px;scale:.98 1.03}20%{translate:0 0;scale:1}30%{translate:0 -2px;scale:.99 1.02}45%{translate:0 1.5px;scale:1.03 .97}}
@keyframes c-gronde{0%,100%{translate:0 0;scale:1.02}25%{translate:-.8px 0;scale:1.03}75%{translate:.8px 0;scale:1.03}}
@keyframes c-secoue{0%,100%{translate:0 0;rotate:0deg}20%{translate:-4px 0;rotate:-3deg}40%{translate:4px 0;rotate:3deg}60%{translate:-3px 0;rotate:0deg}80%{translate:3px 0;rotate:0deg}}
@keyframes c-balance{0%,100%{rotate:-3deg}50%{rotate:3deg}}
@keyframes c-battement{0%,56%,100%{scale:1}14%{scale:1.07}28%{scale:1}42%{scale:1.045}}
@keyframes c-dodeline{0%,100%{rotate:0deg;translate:0 0}55%{rotate:9deg;translate:0 2px}62%{rotate:-2deg;translate:0 0}70%{rotate:0deg;translate:0 0}}
@keyframes c-trepigne{0%,40%,100%{translate:0 0;scale:1}8%,24%{translate:0 -3px;scale:1}16%,32%{translate:0 0;scale:1.03 .97}}
@keyframes c-hoche{0%,60%,100%{translate:0 0;rotate:0deg}30%{translate:0 1.5px;rotate:2deg}}
@keyframes c-affole{0%,100%{translate:0 0;rotate:0deg}25%{translate:-3px 0;rotate:-2deg}75%{translate:3px 0;rotate:2deg}}
@keyframes c-parle{0%,100%{scale:1}50%{scale:1.04 .97}}
@keyframes g-sursaut{0%,100%{translate:0 0;scale:1}25%{translate:0 -9px;scale:.94 1.1}55%{translate:0 0;scale:1.06 .94}}
@keyframes g-bond{0%,100%{translate:0 0;scale:1}18%{translate:0 2px;scale:1.07 .92}48%{translate:0 -13px;scale:.96 1.07}74%{translate:0 0;scale:1.06 .94}}
@keyframes g-recul{0%,100%{translate:0 0;rotate:0deg;scale:1}30%{translate:5px 0;rotate:7deg;scale:.96}}
@keyframes g-tasse{0%,100%{translate:0 0;scale:1}35%{translate:0 -2px;scale:.98 1.03}70%{translate:0 4px;scale:1.07 .9}}
@keyframes g-gonfle{0%,100%{scale:1}45%{scale:1.12}60%{scale:1.1}}
@keyframes g-fond{0%,100%{scale:1}40%{scale:1.04 1.05}}
@keyframes g-penche{0%,100%{rotate:0deg}50%{rotate:-11deg}}
@keyframes g-fremit{0%,100%{translate:0 0;scale:1}20%,60%{translate:-1.5px 0;scale:1.02}40%,80%{translate:1.5px 0;scale:1.02}}
@keyframes g-hoche{0%,100%{translate:0 0;rotate:0deg}40%{translate:0 3px;rotate:3deg}}
@media (prefers-reduced-motion:reduce){.odin *{animation:none!important;transition:none!important}}
`;

  // ---------- Dans la page : groupes, couleur, transitions ----------
  const NS = 'http://www.w3.org/2000/svg';
  const MQ = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion:reduce)') : null;
  const reduit = () => Boolean(MQ && MQ.matches);
  let uid = 0;
  /** Identifiants uniques par mascotte : plusieurs visages sur une page ne partagent pas leurs dégradés. */
  function own(svg) {
    if (!svg || svg.dataset.own) return; svg.dataset.own = '1';
    const n = ++uid, map = {};
    svg.querySelectorAll('[id]').forEach((d) => { const id = d.id; map[id] = `${id}-${n}`; d.id = map[id]; });
    svg.querySelectorAll('*').forEach((x) => { for (const a of ['fill', 'filter', 'stroke']) { const v = x.getAttribute(a); const m = v && v.match(/^url\(#(.+)\)$/); if (m && map[m[1]]) x.setAttribute(a, `url(#${map[m[1]]})`); } });
  }
  /** Les groupes du visage, créés une fois : « sous » avant les yeux, puis sourcils, bouche, joues, extras. */
  function calques(el) {
    const svg = el.querySelector('svg'); if (!svg) return null;
    own(svg);
    const body = svg.querySelector('.body'), eyes = body && body.querySelector('.eyes'); if (!eyes) return null;
    const g = (c, avant) => { let x = body.querySelector(`:scope > g.${c}`); if (!x) { x = DOC.createElementNS(NS, 'g'); x.setAttribute('class', c); if (avant) body.insertBefore(x, avant); else body.append(x); } return x; };
    return { eyes, sous: g('sous', eyes), brows: g('brows'), mouth: g('mouth'), cheeks: g('cheeks'), extra: g('extra') };
  }
  /** Pose un dessin : yeux, sourcils, bouche, joues, extras, variables et classes (jamais la couleur). */
  function poser(el, D) {
    const f = calques(el); if (!f) return false;
    // Chaque œil : un groupe pour sa petite animation (brow), et dedans un groupe pour sa taille (taille) ; les deux yeux dans un groupe pour le regard.
    // Jamais une pose (scale, translate) et une animation de `transform` sur le même élément : Chrome ne peindrait pas la pose.
    const html = { eyes: `<g class="regard"><g class="brow l"><g class="taille">${D.yeux[0]}</g></g><g class="brow r"><g class="taille">${D.yeux[1]}</g></g></g>`, sous: D.sous, brows: D.sourcils, mouth: D.bouche, cheeks: D.joues, extra: D.extras };
    for (const k of Object.keys(html)) if (f[k]._odin !== html[k]) { f[k].innerHTML = html[k]; f[k]._odin = html[k]; }
    for (const k of Object.keys(D.vars)) if (k !== '--o-c0' && k !== '--o-c2') el.style.setProperty(k, D.vars[k]);
    for (const c of [...el.classList]) if (/^(e-|c-|m-|sans-)/.test(c) || /^o-(vive|grand|petit|mini)$/.test(c)) el.classList.remove(c);
    el.classList.add(...D.classes);
    return true;
  }
  /**
   * Règle du propriétaire (15/11/2026) : les pastilles des yeux restent BLANCHES, quelle que soit la situation (émotion, thème, fête).
   * Même sur un corps clair : aucune ombre, aucun contour, aucun ton sombre dans ni autour des yeux.
   */
  const encre = () => W;
  /** La couleur portée (4 teintes, halos compris) et l'encre qui va avec. La barre de saisie de la discussion prend celle de #buddyChat. */
  function teinter(el, t) {
    const svg = el.querySelector('svg'); if (!svg) return;
    svg.querySelectorAll('[id^="odinBody"] stop').forEach((st, i) => { st.style.stopColor = t[i] || t[3]; });
    svg.querySelectorAll('[id^="odinHalo"] stop').forEach((st) => { st.style.stopColor = t[3]; });
    el.style.setProperty('--o-c0', t[0]); el.style.setProperty('--o-c2', t[2]); el.style.setProperty('--o-encre', encre(t));
    if (el.id === 'buddyChat') DOC.documentElement.style.setProperty('--odin-tint', t[1]);
  }
  const tailleDe = (el) => { const l = el.clientWidth || 0; return !l || l >= 47 ? 'grand' : l >= 31 ? 'petit' : 'mini'; };
  // Ce que face.js retient pour chaque mascotte (jamais global, jamais dans el._flash).
  const VIES = new WeakMap();
  let observateur = null;
  function vie(el) {
    let v = VIES.get(el);
    if (!v) {
      // `du` : le visage dont le geste d'arrivée attend encore sa pose ; `voulu` : jusqu'à quand un geste demandé (geste()) garde la place.
      v = { etat: etatNeuf(), vu: null, posee: undefined, ton: '', forme: '', fam: '', taille: 'grand', reveil: 0, phases: [], gesteT: 0, du: '', voulu: 0 };
      VIES.set(el, v);
      // Un seul observateur de taille pour toutes les mascottes.
      if (typeof ResizeObserver === 'function') {
        observateur ||= new ResizeObserver((es) => { for (const x of es) { const w = VIES.get(x.target); if (w && w.vu && tailleDe(x.target) !== w.taille) rendre(x.target, { direct: true }); } });
        observateur.observe(el);
      }
    }
    return v;
  }
  function phase(v, ms, fn) { const p = setTimeout(() => { const i = v.phases.indexOf(p); if (i >= 0) v.phases.splice(i, 1); fn(); }, ms); v.phases.push(p); }
  function finPhases(el, v) {
    for (const p of v.phases) clearTimeout(p);
    v.phases.length = 0;
    el.classList.remove('o-clin', 'o-sort'); el.style.removeProperty('--o-exa');
  }
  /** Un geste du corps, joué une fois. */
  function jouer(el, v, nom) {
    clearTimeout(v.gesteT);
    for (const c of [...el.classList]) if (c.startsWith('g-')) el.classList.remove(c);
    void el.offsetWidth; // relance l'animation si le même geste revient
    el.classList.add(`g-${nom}`);
    v.gesteT = setTimeout(() => { v.gesteT = 0; el.classList.remove(`g-${nom}`); }, GESTES[nom] + 40);
  }
  /** Passe du visage montré au nouveau : fondu de couleur, clignement qui cache le changement de forme, geste d'arrivée. */
  function passer(el, v, avant, N, o) {
    finPhases(el, v);
    // Un geste d'arrivée encore dû (sa pose attendait derrière le clignement quand une autre demande est arrivée) est joué quand même, si le visage est le même.
    const veut = Boolean(o.entree) || v.du === N.cle; v.du = '';
    const d = deg(N.r.id), direct = Boolean(o.direct) || !avant || v.posee === undefined || reduit();
    const arrive = N.r.couleur && (!avant || !avant.couleur || avant.id !== N.r.id), part = !N.r.couleur && avant && avant.couleur;
    el.style.setProperty('--o-fondu', `${arrive ? DEG.monte[d] : part ? DEG.retour[deg(avant.id)] : 700}ms`);
    // La teinte qui bat (rage) s'arrête avant le fondu : sinon elle le masque, et une teinte reviendrait d'un coup avant les autres.
    if (!(MOODS[N.r.id].vive && N.r.vif)) el.classList.remove('o-vive');
    if (v.ton !== N.ton) { teinter(el, N.teintes); v.ton = N.ton; }
    if (v.posee === N.cle) return;
    const D = dessin(N.r.id, { taille: N.taille, vif: N.r.vif, parle: N.r.parle, fige: reduit() });
    const pose = () => { if (poser(el, D)) { v.posee = N.cle; v.forme = D.forme; v.fam = fam(N.r.id); } };
    const entree = () => {
      v.du = '';
      if (!veut || !D.entree || !N.r.vif) return;
      el.style.setProperty('--o-exa', DEG.exa[d]); phase(v, DEG.pic[d], () => el.style.removeProperty('--o-exa'));
      // Un geste demandé à l'instant (le sursaut de l'appel) garde la place : le geste d'arrivée ne l'écrase pas.
      if (Date.now() >= v.voulu) jouer(el, v, D.entree);
    };
    if (direct) return void pose();
    if (avant.vif && !N.r.vif) {
      // Retour au calme : les extras s'effacent, puis le visage se détend.
      el.classList.add('o-sort');
      phase(v, 300, () => { el.classList.remove('o-sort'); pose(); if (deg(avant.id) >= 2) jouer(el, v, 'fond'); });
    } else if (D.forme !== v.forme || fam(N.r.id) !== v.fam) {
      el.classList.add('o-clin');
      if (veut) v.du = N.cle;
      phase(v, 100, () => { pose(); entree(); });
      phase(v, 220, () => el.classList.remove('o-clin'));
    } else { pose(); entree(); }
  }
  function emettre(el, v, r, t) {
    if (typeof CustomEvent !== 'function') return;
    const m = MOODS[r.id], F = FAMILLES[m.famille];
    el.dispatchEvent(new CustomEvent('odin-humeur', { bubbles: true, detail: { id: r.id, famille: m.famille, degre: m.degre, valence: F.valence, eveil: F.eveil, couleur: r.couleur, teinte: (r.couleur ? m.tint : MOODS.neutre.tint)[1], fond: fondVu(v.etat, t), emotion: r.emotion, tenu: r.tenu, parle: r.parle, jusque: r.jusque || 0, raison: r.raison || '', source: r.source || '' } }));
  }
  /** Met la mascotte à jour d'après son état, et règle son unique minuterie de réveil sur le prochain changement. */
  function rendre(el, o = {}) {
    const v = vie(el), t = Date.now(), r = regard(v.etat, t), m = MOODS[r.id];
    const taille = tailleDe(el), teintes = r.couleur ? m.tint : MOODS.neutre.tint;
    const cle = `${r.id}|${r.vif ? 1 : 0}|${r.parle ? 1 : 0}|${taille}`, ton = teintes.join(' '), avant = v.vu;
    v.taille = taille; v.vu = { cle, id: r.id, couleur: r.couleur, vif: r.vif };
    if (v.posee !== cle || v.ton !== ton) passer(el, v, avant, { r, cle, ton, teintes, taille }, o);
    // Compatibilité : l'humeur montrée, et l'humeur dont il porte la couleur.
    if (el.dataset.mood !== r.id) el.dataset.mood = r.id;
    el._base = r.couleur ? r.id : 'neutre';
    const titre = `Odin : ${m.nom}`; if (el.getAttribute('title') !== titre) el.setAttribute('title', titre);
    clearTimeout(v.reveil); v.reveil = 0;
    if (r.reveil !== null && !DOC.hidden) v.reveil = setTimeout(() => { v.reveil = 0; if (el.isConnected && !DOC.hidden) rendre(el); }, Math.max(30, Math.min(r.reveil - t + 10, 900000)));
    if (avant ? avant.id !== r.id || avant.couleur !== r.couleur : r.id !== 'neutre' || r.couleur) emettre(el, v, r, t);
  }
  /** Applique une action à une mascotte et la redessine. Renvoie { ok, ms, geste }. */
  function appliquer(el, action, direct = false) {
    if (!el || !DOC || typeof el.querySelector !== 'function') return { ok: false, ms: 0, geste: false };
    const v = vie(el);
    v.etat = agir(v.etat, action, Date.now());
    const d = v.etat.dernier;
    rendre(el, { direct, entree: d.ok && d.geste });
    return d;
  }

  // ---------- Ce que les autres fichiers appellent ----------
  /** Une émotion : rend le temps (ms) pendant lequel elle sera montrée en couleur, 0 si elle est refusée. */
  function ressent(el, id, opts = {}) { const o = opts || {}; return appliquer(el, { type: 'ressent', id, ms: o.ms, raison: o.raison, force: o.force, sansHabitude: o.sansHabitude, source: o.source }).ms || 0; }
  /** La disposition de fond : son expression adoucie, jamais sa couleur ; elle reste jusqu'au prochain fond(). */
  function fond(el, id) { appliquer(el, { type: 'fond', id }); }
  /** Un état tenu au nom de `qui` (écoute, regarde, cache…). ms > 0 : lâché tout seul ; sinon au bout de 10 minutes. */
  function tenir(el, id, qui = 'defaut', ms = 0) { appliquer(el, { type: 'tenir', id, qui, ms }); }
  function lacher(el, qui = 'defaut') { appliquer(el, { type: 'lacher', qui }); }
  /** La bouche parle par-dessus l'expression en cours (yeux, sourcils, extras et couleur restent ceux de l'émotion). */
  function parole(el, oui, ms) { appliquer(el, { type: 'parole', oui: Boolean(oui), ms }); }
  /** Un geste du corps joué une fois. Faux si le nom est inconnu ou si le mouvement est réduit. */
  function geste(el, nom) {
    if (!el || !DOC || !possede(GESTES, nom) || reduit() || typeof el.querySelector !== 'function') return false;
    const v = vie(el); jouer(el, v, nom); v.voulu = Date.now() + GESTES[nom]; return true;
  }
  function etat(el) {
    const v = el && VIES.get(el), e = v ? v.etat : etatNeuf(), t = Date.now(), r = regard(e, t), m = MOODS[r.id];
    const E = e.emo && t < e.emo.a ? e.emo : null;
    return { id: r.id, famille: m.famille, degre: m.degre, couleur: r.couleur, teinte: (r.couleur ? m.tint : MOODS.neutre.tint)[1], fond: fondVu(e, t), emotion: E ? { id: E.id, de: E.de, a: E.a } : null, tenu: r.tenu, parle: r.parle };
  }
  /** Les 4 teintes portées à l'instant. */
  function couleur(el) { const s = etat(el); return (s.couleur ? MOODS[s.id].tint : MOODS.neutre.tint).slice(); }
  /**
   * Ancien appel : pose immédiate (aucune minuterie de transition). « parle » : la bouche seulement ; écoute, regarde,
   * cache, concentration : tenus au nom de « set » ; toute autre humeur : en couleur si `passing`, sinon sans couleur.
   */
  function set(el, id, passing = false) { appliquer(el, { type: 'pose', id, couleur: Boolean(passing) }, true); }
  const all = (id) => { if (DOC) DOC.querySelectorAll('.odin').forEach((el) => set(el, id)); };
  /** Ancien appel : une expression passagère. Elle ne coupe jamais une émotion plus forte ni un état déjà tenu. */
  function flash(el, id, ms = 2200) { appliquer(el, { type: 'flash', id, ms }); }
  /** Ancien appel : l'humeur d'une réponse (en couleur le temps de sa durée). */
  function base(el, id) { appliquer(el, { type: 'base', id }); }
  /** Couleur de fond d'Odin (celle du thème choisi) : il la prend au repos ; ses émotions la changent un moment, puis il y revient. null = sa couleur d'origine. */
  function tintBase(hex) {
    const ok = typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex);
    const mix = (h, w, k) => { const a = parseInt(h.slice(1), 16), b = w ? 255 : 0; const c = [16, 8, 0].map((s) => Math.round(((a >> s) & 255) * (1 - k) + b * k)); return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`; };
    MOODS.neutre.tint = ok ? [mix(hex, false, .14), hex, mix(hex, true, .32), mix(hex, true, .62)] : ORIGINE.neutre.slice();
    if (!DOC) return;
    // Repeint tout de suite ceux qui portent la couleur du thème ; ceux qui portent une émotion y reviendront en fondu.
    DOC.querySelectorAll('.odin').forEach((el) => { const v = VIES.get(el); if (!v || !v.vu) rendre(el, { direct: true }); else if (!v.vu.couleur) rendre(el); });
  }

  // ---------- Sons (synthétisés, aucun fichier) ----------
  // Le navigateur n'autorise le son qu'après un premier toucher ou clic. Coupé/rétabli avec OdinFace.mute().
  let ac = null, unlocked = false, soundOn = true;
  try { if (typeof localStorage !== 'undefined') soundOn = localStorage.getItem('odin-sound') !== '0'; } catch { /* stockage indisponible */ }
  const audio = () => {
    if (!unlocked || !soundOn) return null;
    if (!ac) { const A = G.AudioContext || G.webkitAudioContext; if (!A) return null; ac = new A(); }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  };
  /** Une note : fréquence de départ → d'arrivée, durée (s), forme d'onde, volume, décalage (s). */
  function note(f0, f1, dur, type = 'sine', vol = 0.16, delay = 0) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const SOUNDS = {
    bounce: () => { note(260, 640, 0.12, 'sine', 0.2); note(640, 380, 0.18, 'sine', 0.14, 0.12); },
    angry: () => { for (let i = 0; i < 3; i++) note(150 - i * 18, 95 - i * 10, 0.16, 'sawtooth', 0.07, i * 0.17); },
    laugh: () => { for (let i = 0; i < 4; i++) note(700 + i * 60, 900 + i * 60, 0.07, 'triangle', 0.1, i * 0.09); },
    hop: () => { note(420, 820, 0.1, 'sine', 0.13); },
    shake: () => { for (let i = 0; i < 5; i++) note(220, 180, 0.05, 'square', 0.04, i * 0.06); },
    tremble: () => { note(520, 480, 0.35, 'triangle', 0.06); },
    // « Oui ? » : deux notes qui montent, quand on l'appelle.
    appel: () => { note(520, 620, 0.09); note(700, 820, 0.12, 'sine', 0.1, 0.1); },
  };
  /** Le son qui accompagne certaines boucles du corps. */
  const SON_BOUCLE = { rire: 'laugh', sautille: 'hop', secoue: 'shake', gronde: 'shake', tremble: 'tremble', affole: 'tremble' };
  /** Son d'un mouvement (bounce, angry, laugh, hop, shake, tremble, appel) ou d'un changement d'humeur. */
  function sound(name) {
    if (possede(SOUNDS, name)) return SOUNDS[name]();
    if (name === 'colere' || name === 'rage') return SOUNDS.angry();
    const m = typeof name === 'string' && possede(MOODS, name) ? MOODS[name] : null, v = m ? FAMILLES[m.famille].valence : 0;
    if (v > 0) { note(660, 660, 0.12, 'sine', 0.11); note(990, 990, 0.18, 'sine', 0.1, 0.1); }
    else if (v < 0) { note(520, 520, 0.14, 'sine', 0.1); note(390, 370, 0.22, 'sine', 0.09, 0.12); }
    else note(740, 760, 0.14, 'sine', 0.08);
    if (m && SON_BOUCLE[m.c[1]]) SOUNDS[SON_BOUCLE[m.c[1]]]();
  }
  /**
   * Son du clignement : « tic » qui descend quand les yeux se ferment, qui remonte quand ils s'ouvrent.
   * Calé sur l'animation CSS o-blink (fermeture à 93,5 %, réouverture à 96 %).
   * Seulement pour la mascotte principale, visible à l'écran, page au premier plan.
   */
  function blinkSounds(el) {
    if (!el || !DOC || el._blink) return; el._blink = true;
    let visible = true;
    if ('IntersectionObserver' in G) new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(el);
    const schedule = (eye) => {
      clearTimeout(el._bt1); clearTimeout(el._bt2);
      const ms = (parseFloat(getComputedStyle(eye).animationDuration) || 5.2) * 1000;
      const ok = () => visible && !DOC.hidden && getComputedStyle(eye).animationName === 'o-blink';
      el._bt1 = setTimeout(() => { if (ok()) note(900, 520, 0.05, 'sine', 0.045); }, ms * 0.935);
      el._bt2 = setTimeout(() => { if (ok()) note(520, 940, 0.06, 'sine', 0.04); }, ms * 0.96);
    };
    const hook = () => {
      const eye = el.querySelector('.eye'); if (!eye || eye._hooked) return; eye._hooked = true;
      eye.addEventListener('animationstart', (e) => { if (e.animationName === 'o-blink') schedule(eye); });
      eye.addEventListener('animationiteration', (e) => { if (e.animationName === 'o-blink') schedule(eye); });
      schedule(eye);
    };
    hook(); new MutationObserver(hook).observe(el, { subtree: true, childList: true });
  }
  function mute(off) { soundOn = off === undefined ? !soundOn : !off; try { if (typeof localStorage !== 'undefined') localStorage.setItem('odin-sound', soundOn ? '1' : '0'); } catch { /* rien */ } return soundOn; }

  if (DOC) {
    // iPhone et iPad ne débloquent le son que sur la fin d'un toucher (touchend) ou un clic : on écoute tout, le premier suffit.
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) DOC.addEventListener(ev, () => { unlocked = true; audio(); }, { capture: true, passive: true });
    // Son coupé ou remis dans un autre onglet ou une autre fenêtre d'Odin : ici aussi, tout de suite.
    if (typeof G.addEventListener === 'function') G.addEventListener('storage', (e) => { if (e.key === 'odin-sound') soundOn = e.newValue !== '0'; });
    // Onglet de nouveau visible : chaque mascotte reprend là où elle en est (les minuteries ne tournent pas en arrière-plan).
    DOC.addEventListener('visibilitychange', () => { if (!DOC.hidden) DOC.querySelectorAll('.odin').forEach((el) => { if (VIES.has(el)) rendre(el, { direct: true }); }); });
    if (!DOC.getElementById('odin-face-css')) { const st = DOC.createElement('style'); st.id = 'odin-face-css'; st.textContent = CSS; (DOC.head || DOC.documentElement).append(st); }
    DOC.querySelectorAll('.odin svg').forEach(own);
  }

  G.OdinFace = {
    MOODS, FAMILLES, set, all, flash, base, own, sound, mute, blinkSounds, tintBase,
    liste, connu, socle, echelle, monter, descendre, duree,
    ressent, fond, tenir, lacher, parole, geste, etat, couleur, dessin,
    pur: { etatNeuf, agir, vue, DEG }, CSS,
    get soundOn() { return soundOn; },
  };
})();
