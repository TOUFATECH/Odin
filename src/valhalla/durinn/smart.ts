// Tirésias — lire la santé d'un disque. La sortie JSON de « smartctl » (smartmontools 7.0 ou plus) devient une fiche
// en français simple : état Bon / Attention / Mauvais avec la raison, température, heures, allumages, secteurs
// réalloués, usure, quantité écrite, et chaque valeur SMART expliquée (ce que c'est, si c'est grave).
// Format lu : la page de manuel smartctl(8) (option --json, codes de sortie) et les notes de version 7.0 à 7.5 de
// smartmontools. Aucun code repris : seulement le format de sortie du programme. Tout est pur ici.

export type Etat = 'bon' | 'attention' | 'mauvais' | 'inconnu';
export type Genre = 'disque dur' | 'SSD' | 'NVMe' | 'inconnu';
/** Une valeur que le disque tient sur lui-même, expliquée. */
export interface Valeur {
  /** numéro de la valeur (disques ATA) ou nom court (NVMe, SCSI) */
  id: string;
  nom: string;
  /** le nom anglais donné par smartctl, pour qui veut chercher plus loin */
  origine?: string;
  /** ce que dit le disque, lisible (« 34 °C », « 8 », « 21 204 h ») */
  valeur: string;
  /** la note que le disque se donne : « 100 (pire 98, seuil 36) » */
  note?: string;
  etat: Etat | 'info';
  explication: string;
  /** ce qu'il faut en penser quand la valeur n'est pas normale (sert aux raisons de l'état) */
  si?: string;
}
/** Une raison de l'état, en clair. `cle` dit de quoi on parle (pour les alertes et les essais). */
export interface Raison { cle: string; niveau: 'attention' | 'mauvais'; texte: string }
export interface Disque {
  /** « sda », « nvme0 » */
  nom: string;
  /** ce qu'on donne à smartctl : « /dev/sda » */
  chemin: string;
  /** type passé à smartctl (-d) quand il en faut un : « sat », « usbjmicron », « megaraid,0 » */
  type?: string;
  protocole: 'ATA' | 'NVMe' | 'SCSI' | '';
  genre: Genre;
  /** branché en USB (boîtier, clé) */
  usb: boolean;
  modele?: string; famille?: string; serie?: string; micrologiciel?: string;
  /** en octets */
  taille?: number;
  /** tours par minute (disque dur) */
  tours?: number;
  /** le disque donne-t-il des informations de santé ? */
  smart: 'oui' | 'non' | 'coupé';
  /** ce que le disque dit de lui-même : vrai = « tout va bien », faux = « panne proche » */
  passe?: boolean;
  temperature?: number; heures?: number; allumages?: number;
  realloues?: number; attente?: number; illisibles?: number; crc?: number;
  /** usure d'un SSD, en % de la durée de vie prévue (peut dépasser 100) */
  usure?: number;
  /** NVMe : réserve de cellules de secours restante (%) et le seuil sous lequel le disque s'inquiète */
  reserve?: number; reserveSeuil?: number;
  /** quantité écrite et lue depuis que le disque existe, en octets */
  ecrit?: number; lu?: number;
  /** NVMe : avertissement critique (0 = aucun) et erreurs de données non corrigées */
  critique?: number; erreursMedia?: number;
  /** le dernier test que le disque a fait sur lui-même a échoué */
  autotestRate?: string;
  /** erreurs notées par le disque ces 7 derniers jours de marche */
  erreursRecentes?: number;
  /** limites de température : celles du disque quand il les donne */
  limites?: { attention: number; alerte: number };
  /** pas réveillé (le disque dormait et on ne l'a pas dérangé) */
  enVeille?: boolean;
  /** ce que smartctl a dit de particulier (erreurs, avertissements), traduit */
  messages: string[];
  /** le code de sortie de smartctl (champ de bits, voir sa page de manuel) */
  sortie: number;
  valeurs: Valeur[];
  etat: Etat; raisons: Raison[];
}
/** À partir de quelle température s'inquiéter (attention) puis prévenir (alerte), par genre de disque. */
export interface Seuils { hdd: { attention: number; alerte: number }; ssd: { attention: number; alerte: number }; nvme: { attention: number; alerte: number } }
export const SEUILS: Seuils = { hdd: { attention: 50, alerte: 60 }, ssd: { attention: 60, alerte: 70 }, nvme: { attention: 70, alerte: 80 } };
/** Ce qui a bougé sur 30 jours (lu dans l'historique) : un compteur qui monte est plus parlant que sa valeur. */
export interface Tendance { depuis: string; realloues?: number; attente?: number; illisibles?: number; crc?: number; erreursMedia?: number }

// ---------------- Mise en forme ----------------
const fr = (n: number, max = 0) => n.toLocaleString('fr-FR', { maximumFractionDigits: max });
/** Taille d'un disque comme elle est vendue (1 Go = 1 milliard d'octets) : « 4 To », « 500 Go ». Pur. */
export function taille(o: number): string {
  const u = [[1e12, 'To'], [1e9, 'Go'], [1e6, 'Mo'], [1e3, 'ko']] as const;
  for (const [k, nom] of u) if (o >= k) { const v = o / k; return `${fr(v, v < 10 && Math.abs(v - Math.round(v)) >= 0.05 ? 1 : 0)} ${nom}`; }
  return `${Math.max(0, Math.round(o))} octets`;
}
/** « 21 204 h (2 ans 5 mois) ». Pur. */
export function duree(h: number): string {
  if (h < 48) return `${fr(h)} h`;
  const j = Math.floor(h / 24), ans = Math.floor(j / 365), mois = Math.floor((j % 365) / 30);
  const dit = ans ? `${ans} an${ans > 1 ? 's' : ''}${mois ? ` ${mois} mois` : ''}` : mois ? `${mois} mois` : `${j} jours`;
  return `${fr(h)} h (${dit})`;
}
const pluriel = (n: number, un: string, plusieurs: string) => `${fr(n)} ${n > 1 ? plusieurs : un}`;
/** Texte venu du disque (modèle, série…) : sans caractère de commande, borné. Ce n'est jamais un ordre. */
const propre = (x: unknown, max = 80) => (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const nombre = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
/** L'identifiant stable d'un disque pour son historique : modèle + numéro de série (le nom « sda » peut changer). Pur. */
export function cleDisque(d: Pick<Disque, 'nom' | 'modele' | 'serie'>): string {
  const s = (x: string) => x.normalize('NFD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (d.serie ? `${s(d.modele ?? 'disque')}_${s(d.serie)}` : s(d.nom) || 'disque').slice(0, 80);
}

// ---------------- Ce que veut dire chaque valeur (disques ATA / SATA) ----------------
// `juge` : « zero » = tout nombre au-dessus de zéro est un mauvais signe (il change l'état du disque) ; « suivre » =
// à surveiller s'il n'est pas à zéro, sans changer l'état (des disques sains en ont) ; « cable » = vient souvent du
// câble ; « note » = seule la note du disque compte ; « info » = simple compteur.
interface Sens { re: RegExp; nom: string; quoi: string; juge: 'zero' | 'suivre' | 'cable' | 'note' | 'info'; si?: string }
const SENS: Sens[] = [
  { re: /^Raw_Read_Error_Rate/, nom: 'Erreurs de lecture', quoi: 'Erreurs que le disque rencontre en lisant et corrige tout seul. Sur certains disques le nombre affiché est énorme et normal : seule la note compte.', juge: 'note' },
  { re: /^Throughput_Performance/, nom: 'Performance générale', quoi: 'Rapidité du disque, mesurée par lui-même. Si la note baisse, il ralentit.', juge: 'note' },
  { re: /^Spin_Up_Time/, nom: 'Temps de mise en route', quoi: 'Temps que met le disque à atteindre sa vitesse. S\'il s\'allonge beaucoup, le moteur fatigue.', juge: 'note' },
  { re: /^Start_Stop_Count/, nom: 'Démarrages du moteur', quoi: 'Nombre de fois où le disque s\'est mis à tourner. Simple compteur.', juge: 'info' },
  { re: /^(Reallocated_Sector_Ct|Retired_Block_Count|Reallocated?_NAND_Bl(oc)?k_C(ou)?nt|Reallocated_Block_Count)/, nom: 'Secteurs réalloués', quoi: 'Zones abîmées que le disque a remplacées par des zones de réserve. Zéro est la valeur normale.', juge: 'zero', si: 'Chaque zone remplacée est un petit morceau du disque qui a lâché. Quelques-unes : à surveiller. Si le nombre monte : sauvegarde, puis remplace le disque.' },
  { re: /^Seek_Error_Rate/, nom: 'Erreurs de positionnement', quoi: 'Erreurs de la tête de lecture quand elle se place. Nombre énorme et normal sur certains disques : seule la note compte.', juge: 'note' },
  { re: /^Seek_Time_Performance/, nom: 'Rapidité de positionnement', quoi: 'Rapidité de la tête de lecture à se placer. Si la note baisse, la mécanique fatigue.', juge: 'note' },
  { re: /^Power_On_(Hours|Minutes|Seconds|Half_Minutes)/, nom: 'Temps de fonctionnement', quoi: 'Temps total pendant lequel le disque a été allumé. Simple compteur : un disque de plus de 5 ans mérite une sauvegarde à jour.', juge: 'info' },
  { re: /^Spin_Retry_Count/, nom: 'Démarrages ratés', quoi: 'Fois où le moteur a dû s\'y reprendre pour lancer le disque. Zéro est la valeur normale.', juge: 'zero', si: 'Le moteur ou l\'alimentation fatigue : sauvegarde et surveille de près.' },
  { re: /^Calibration_Retry_Count/, nom: 'Calibrages ratés', quoi: 'Fois où le disque a dû refaire son réglage au démarrage. Zéro est la valeur normale.', juge: 'suivre', si: 'La mécanique fatigue : à surveiller.' },
  { re: /^Power_Cycle_Count/, nom: 'Allumages', quoi: 'Nombre de mises sous tension. Simple compteur.', juge: 'info' },
  { re: /^Helium_Level/, nom: 'Niveau d\'hélium', quoi: 'Disque rempli d\'hélium : s\'il fuit, la note baisse et le disque est condamné.', juge: 'note' },
  { re: /^(Avail(able)?_Reservd_Space|Reserved?_Block_(Count|Cnt)|Unused_Rsvd_Blk_Cnt_Tot|Unused_Reserved?_Bl(oc)?k|Spare_Blocks_Remaining|Minimum_Spares_Remaining|Remaining_Spare)/, nom: 'Réserve de cellules (SSD)', quoi: 'Cellules de secours qui restent pour remplacer celles qui s\'usent. Si la note passe sous le seuil, le SSD n\'a plus de réserve.', juge: 'note' },
  { re: /^Program_Fail_(Count|Cnt)/, nom: 'Échecs d\'écriture (SSD)', quoi: 'Fois où une cellule a refusé une écriture. Zéro est la valeur normale.', juge: 'suivre', si: 'Des cellules lâchent : à surveiller, sauvegarde à jour.' },
  { re: /^Erase_Fail_(Count|Cnt)/, nom: 'Échecs d\'effacement (SSD)', quoi: 'Fois où une cellule a refusé d\'être effacée. Zéro est la valeur normale.', juge: 'suivre', si: 'Des cellules lâchent : à surveiller, sauvegarde à jour.' },
  { re: /^(Wear_Leveling_Count|Ave(rage)?_Block-?_?Erase_Count|Average_Erase_Count|Avg_Erase_Count|Wear_Range_Delta)/, nom: 'Usure des cellules (SSD)', quoi: 'Combien de fois, en moyenne, chaque cellule a été effacée. La note part de 100 et descend avec l\'usure.', juge: 'note' },
  { re: /^(Unexpect(ed)?_Power_Loss|Unsafe_Shutdown_Count|Power-Off_Retract_Count|POR_Recovery_Count|Sudden_Power_Lost|Unexpect_Power_Loss_Ct)/, nom: 'Coupures brutales', quoi: 'Fois où le courant a été coupé sans arrêt propre. Beaucoup de coupures abîment un disque : un onduleur aide.', juge: 'info' },
  { re: /^Used_R(e)?s(er)?v(e)?d_Bl(oc)?k_C(ou)?nt/, nom: 'Cellules de réserve utilisées (SSD)', quoi: 'Cellules de secours déjà mises en service pour remplacer des cellules usées. Zéro est la valeur normale.', juge: 'suivre', si: 'Le SSD a commencé à puiser dans sa réserve : à surveiller.' },
  { re: /^Runtime_Bad_Block/, nom: 'Blocs devenus mauvais', quoi: 'Zones qui ont lâché pendant que le disque travaillait. Zéro est la valeur normale.', juge: 'suivre', si: 'Des zones lâchent : à surveiller, sauvegarde à jour.' },
  { re: /^SATA_(Iface_)?Downshift/, nom: 'Baisses de vitesse du câble', quoi: 'Fois où la liaison avec l\'ordinateur a dû ralentir. Le plus souvent le câble ou la prise.', juge: 'cable', si: 'Si le nombre monte, change le câble SATA.' },
  { re: /^End-to-End_Error/, nom: 'Erreurs internes de transfert', quoi: 'Données abîmées entre la mémoire du disque et sa surface. Zéro est la valeur normale.', juge: 'zero', si: 'Le disque abîme des données en interne : sauvegarde et remplace-le.' },
  { re: /^(Reported_Uncorrect|Uncorrectable_Error_Cnt|Reported_UE_Counts)/, nom: 'Erreurs non corrigées', quoi: 'Lectures que le disque n\'a pas réussi à corriger. Zéro est la valeur normale.', juge: 'zero', si: 'Des données n\'ont pas pu être lues : sauvegarde et surveille de près.' },
  { re: /^Command_Timeout/, nom: 'Commandes sans réponse', quoi: 'Fois où le disque n\'a pas répondu à temps. Souvent le câble ou l\'alimentation, parfois le disque.', juge: 'cable', si: 'Si le nombre monte, vérifie le câble et l\'alimentation.' },
  { re: /^High_Fly_Writes/, nom: 'Écritures tête trop haute', quoi: 'Fois où la tête a écrit en volant trop haut ; le disque recommence alors l\'écriture.', juge: 'info' },
  { re: /^Airflow_Temperature/, nom: 'Température de l\'air dans le disque', quoi: 'Température mesurée dans le boîtier du disque.', juge: 'info' },
  { re: /^G-Sense_Error_Rate/, nom: 'Chocs détectés', quoi: 'Chocs ou vibrations reçus pendant que le disque travaillait.', juge: 'info' },
  { re: /^Load_Cycle_Count/, nom: 'Rangements de la tête', quoi: 'Fois où la tête de lecture s\'est rangée. Un disque dur en supporte en général plusieurs centaines de milliers.', juge: 'info' },
  { re: /^(Temperature_(Celsius|Internal|Case)|Drive_Temperature)/, nom: 'Température', quoi: 'Température du disque. La chaleur l\'use plus vite : garde-le au frais et dépoussiéré.', juge: 'info' },
  { re: /^(Hardware_ECC_Recovered|ECC_Error_Rate|Soft_ECC_Correct)/, nom: 'Erreurs corrigées par le disque', quoi: 'Erreurs de lecture rattrapées par le disque lui-même. Seule la note compte.', juge: 'note' },
  { re: /^Reallocat(ed|ion)_Event_Count/, nom: 'Opérations de remplacement', quoi: 'Fois où le disque a remplacé, ou tenté de remplacer, une zone abîmée. Zéro est la valeur normale.', juge: 'suivre', si: 'Le disque a dû remplacer des zones : à surveiller avec les secteurs réalloués.' },
  { re: /^Current_Pending_(Sector|ECC)/, nom: 'Secteurs en attente', quoi: 'Zones que le disque n\'arrive plus à lire correctement ; il les remplacera à la prochaine écriture. Zéro est la valeur normale.', juge: 'zero', si: 'Ce qui s\'y trouvait est peut-être perdu. Sauvegarde maintenant ; si le nombre monte, remplace le disque.' },
  { re: /^(Off-?line_Uncorrectable|Uncorrectable_Sector_Ct|Total_Offl_Uncorrectabl)/, nom: 'Secteurs illisibles', quoi: 'Zones illisibles trouvées par le disque pendant ses propres vérifications. Zéro est la valeur normale.', juge: 'zero', si: 'Des zones ne se lisent plus. Sauvegarde maintenant ; si le nombre monte, remplace le disque.' },
  { re: /^((UDMA|SATA|Interface)_CRC_Error|CRC_Error_Count)/, nom: 'Erreurs de transmission (câble)', quoi: 'Erreurs entre le disque et l\'ordinateur. Le plus souvent c\'est le câble ou la prise, pas le disque. Le compteur ne revient jamais à zéro.', juge: 'cable', si: 'Si le nombre monte, change le câble SATA (ou le boîtier USB).' },
  { re: /^(Multi_Zone_Error_Rate|Write_Error_Rate)/, nom: 'Erreurs d\'écriture', quoi: 'Erreurs rencontrées en écrivant. Seule la note compte.', juge: 'note' },
  { re: /^Soft_Read_Error_Rate/, nom: 'Erreurs de lecture rattrapées', quoi: 'Erreurs de lecture corrigées par le disque. Seule la note compte.', juge: 'note' },
  { re: /^(Percent_Life(time)?_Remain|SSD_Life_Left|Remaining_Lifetime_Perc|Media_Wearout_Indicator|Drive_Life_Remaining|Lifetime_Remaining|Life_Remaining|Percent_Lifetime_Used|Endurance_Remaining)/, nom: 'Durée de vie restante (SSD)', quoi: 'La note part de 100 et descend à mesure que le SSD s\'use. Sous le seuil, il a fait son temps.', juge: 'note' },
  { re: /^Head_Flying_Hours/, nom: 'Heures de vol de la tête', quoi: 'Temps pendant lequel la tête de lecture a été au-dessus des plateaux. Simple compteur.', juge: 'info' },
  { re: /^(Total_LBAs_Written|Host_Writes|Lifetime_Writes|Total_Writes|Total_Host_Sector_Write|NAND_Writes|Writes_GiB|Data_Written)/, nom: 'Total écrit', quoi: 'Tout ce qui a été écrit sur le disque depuis qu\'il existe. Un SSD est prévu pour une certaine quantité.', juge: 'info' },
  { re: /^(Total_LBAs_Read|Host_Reads|Lifetime_Reads|Total_Reads|Total_Host_Sector_Read|Data_Read)/, nom: 'Total lu', quoi: 'Tout ce qui a été lu sur le disque depuis qu\'il existe. Simple compteur.', juge: 'info' },
  { re: /^Free_Fall_Sensor/, nom: 'Chutes détectées', quoi: 'Fois où le disque a senti une chute et a rangé sa tête pour se protéger.', juge: 'info' },
];
const INCONNUE: Omit<Sens, 're' | 'nom'> = { quoi: 'Valeur propre au fabricant. Seule la note compte : tant qu\'elle reste au-dessus du seuil, tout va bien.', juge: 'note' };
/** À partir de combien un compteur fait passer le disque de « Attention » à « Mauvais ». */
export const BEAUCOUP = { realloues: 100, attente: 10, illisibles: 10, hausse: 10 };

type J = Record<string, unknown>;
const obj = (x: unknown): J => (x && typeof x === 'object' && !Array.isArray(x) ? x as J : {});
const tab = (x: unknown): J[] => (Array.isArray(x) ? x.filter((y) => y && typeof y === 'object') as J[] : []);
interface Attribut { id: number; nom: string; note?: number; pire?: number; seuil?: number; echec: '' | 'now' | 'past'; alerte: boolean; brut: number; texte: string }
/** Le nombre que le disque affiche pour une valeur : le premier nombre de son texte (« 32 (Min/Max 24/38) » → 32,
 *  « 2725 (151 234 0) » → 2725), car le nombre brut complet empile parfois plusieurs compteurs. */
function brutDe(raw: J): number {
  const t = typeof raw.string === 'string' ? /^\s*(\d+)/.exec(raw.string)?.[1] : undefined;
  return t !== undefined ? Number(t) : nombre(raw.value) ?? 0;
}
function attributs(j: J): Attribut[] {
  return tab(obj(j.ata_smart_attributes).table).filter((a) => typeof a.id === 'number').map((a) => {
    const raw = obj(a.raw), f = obj(a.flags), w = typeof a.when_failed === 'string' ? a.when_failed.toLowerCase() : '';
    return { id: a.id as number, nom: propre(a.name, 40) || `Valeur_${String(a.id)}`, note: nombre(a.value), pire: nombre(a.worst), seuil: nombre(a.thresh), echec: /now/.test(w) ? 'now' as const : /past/.test(w) ? 'past' as const : '' as const, alerte: f.prefailure === true, brut: brutDe(raw), texte: propre(raw.string, 40) || String(nombre(raw.value) ?? '') };
  });
}
/** Une quantité écrite ou lue donnée par une valeur ATA : l'unité est dans le nom que smartctl lui donne. */
function quantite(a: Attribut, bloc: number): number | undefined {
  if (!(a.brut > 0)) return undefined;
  if (/32MiB/i.test(a.nom)) return a.brut * 32 * 1024 ** 2;
  if (/GiB/i.test(a.nom)) return a.brut * 1024 ** 3;
  if (/_GB$/i.test(a.nom)) return a.brut * 1e9;
  if (/MiB/i.test(a.nom)) return a.brut * 1024 ** 2;
  if (/LBAs|Sector/i.test(a.nom)) return a.brut * bloc;
  return undefined;
}
/** Une ligne du tableau « statistiques de l'appareil » (option -x de smartctl), par son nom. */
function statistique(j: J, re: RegExp): number | undefined {
  for (const p of tab(obj(j.ata_device_statistics).pages)) for (const t of tab(p.table)) if (typeof t.name === 'string' && re.test(t.name) && obj(t.flags).valid !== false) return nombre(t.value);
  return undefined;
}
const sens = (nom: string): Sens | undefined => SENS.find((s) => s.re.test(nom));
const lisible = (nom: string) => nom.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

/** Les messages de smartctl, traduits quand on les reconnaît (le reste est gardé tel quel, borné). Pur. */
export function traduire(m: string): string {
  const t = propre(m, 200);
  if (/Unknown USB bridge/i.test(t)) return `boîtier USB que smartctl ne connaît pas${/\[(0x[0-9a-f]+:0x[0-9a-f]+)/i.test(t) ? ` (${/\[(0x[0-9a-f]+:0x[0-9a-f]+)/i.exec(t)![1]})` : ''} : il ne transmet pas la santé du disque tel quel`;
  if (/Unable to detect device type/i.test(t)) return 'disque virtuel, ou d\'un type que smartctl ne sait pas lire';
  if (/Permission denied|Operation not permitted|not permitted/i.test(t)) return 'pas le droit de lire ce disque (il faut être administrateur)';
  if (/No such (device|file)/i.test(t)) return 'ce disque n\'est plus là';
  if (/lacks SMART capability|SMART support is:\s*Unavailable/i.test(t)) return 'ce disque n\'a pas de SMART';
  if (/STANDBY|SLEEP mode|low-power/i.test(t)) return 'le disque dort (pas réveillé)';
  if (/based on an Attribute check/i.test(t)) return 'état déduit des valeurs (le disque ne répond pas à la question directe)';
  if (/Read Device Identity failed|IDENTIFY DEVICE.*failed|Read NVMe Identify.*failed/i.test(t)) return 'le disque n\'a pas répondu à la demande d\'identité (boîtier USB ou type de disque à régler)';
  return t;
}

/** Les disques trouvés par « smartctl --scan --json ». Pur. */
export function lireScan(texte: string): Array<{ chemin: string; type: string }> {
  let j: J; try { j = obj(JSON.parse(texte)); } catch { return []; }
  return tab(j.devices).map((d) => ({ chemin: propre(d.name, 200), type: propre(d.type, 40) })).filter((d) => d.chemin && !d.chemin.startsWith('-'));
}
/** La version de smartctl lue dans sa sortie JSON (« 7.4 ») ; rien si la sortie n'est pas du JSON de smartctl. Pur. */
export function versionDe(texte: string): string | undefined {
  try { const v = obj(obj(JSON.parse(texte)).smartctl).version; return Array.isArray(v) && v.length >= 2 ? `${Number(v[0])}.${Number(v[1])}` : undefined; } catch { return undefined; }
}
/** Le nom court d'un disque d'après ce qu'on donne à smartctl. Pur. */
export const nomCourt = (chemin: string, type?: string) => `${chemin.startsWith('/dev/') ? chemin.slice(5) : chemin.split('/').filter(Boolean).pop() ?? chemin}${type && type.includes(',') ? ` [${type}]` : ''}`.slice(0, 60);

/**
 * La fiche d'un disque à partir de la sortie de « smartctl --json -x <disque> ». Ne lève jamais d'erreur : une sortie
 * illisible rend une fiche « inconnu » qui dit pourquoi. `veille` : on avait demandé de ne pas réveiller le disque.
 */
export function lireSmart(texte: string, o: { chemin?: string; type?: string; seuils?: Seuils; veille?: boolean; tendance?: Tendance } = {}): Disque {
  let j: J = {}, illisible = false; try { j = obj(JSON.parse(texte)); } catch { illisible = true; }
  const sm = obj(j.smartctl), dev = obj(j.device), chemin = propre(dev.name, 200) || o.chemin || '', type = o.type || undefined;
  const proto = propre(dev.protocol, 10), protocole = proto === 'ATA' || proto === 'NVMe' || proto === 'SCSI' ? proto : '';
  const brutsMsg = tab(sm.messages).map((m) => propre(m.string, 200)).filter(Boolean), messages = [...new Set(brutsMsg.map(traduire))];
  const sortie = nombre(sm.exit_status) ?? 0, bloc = nombre(j.logical_block_size) ?? 512;
  const at = attributs(j), n = obj(j.nvme_smart_health_information_log), aN = Object.keys(n).length > 0;
  const par = (re: RegExp) => at.find((a) => re.test(a.nom)), num = (id: number) => at.find((a) => a.id === id);
  const support = obj(j.smart_support), statut = obj(j.smart_status), temp = obj(j.temperature);
  const tours = nombre(j.rotation_rate);
  const d: Disque = {
    nom: nomCourt(chemin || 'disque', type), chemin, ...(type ? { type } : {}), protocole,
    genre: protocole === 'NVMe' ? 'NVMe' : tours === 0 ? 'SSD' : tours && tours > 0 ? 'disque dur' : 'inconnu',
    usb: /^(usb|snt)/i.test(propre(dev.type, 40)) || /USB/i.test(propre(dev.info_name, 200)),
    smart: 'oui', messages, sortie, valeurs: [], etat: 'inconnu', raisons: [],
  };
  const modele = propre(j.model_name) || propre(j.scsi_model_name) || [propre(j.vendor ?? j.scsi_vendor, 40), propre(j.product ?? j.scsi_product, 40)].filter(Boolean).join(' ');
  if (modele) d.modele = modele;
  if (propre(j.model_family)) d.famille = propre(j.model_family);
  if (propre(j.serial_number)) d.serie = propre(j.serial_number, 60);
  if (propre(j.firmware_version ?? j.revision ?? j.scsi_revision, 30)) d.micrologiciel = propre(j.firmware_version ?? j.revision ?? j.scsi_revision, 30);
  const cap = nombre(obj(j.user_capacity).bytes) ?? nombre(j.nvme_total_capacity); if (cap) d.taille = cap;
  if (tours && tours > 0) d.tours = tours;
  if (typeof statut.passed === 'boolean') d.passe = statut.passed;

  // Pas réveillé : le disque dormait et on avait demandé de ne pas le déranger. smartctl sort alors avec le code 2
  // sans avoir lu la santé, et sans erreur d'ouverture (une vraie panne d'accès s'écrit dans ses messages).
  if (o.veille && (sortie & 2) && typeof statut.passed !== 'boolean' && !at.length && !aN && !brutsMsg.some((m) => /open device|Unable to detect|Unknown USB|No such|failed/i.test(m))) { d.enVeille = true; d.messages = ['le disque dort (pas réveillé)']; return d; }

  // ---- Les mesures communes
  const t = nombre(temp.current) ?? nombre(n.temperature) ?? (par(/^Temperature_(Celsius|Internal|Case)|^Drive_Temperature/) ?? par(/^Airflow_Temperature/))?.brut;
  if (t !== undefined && t > 0 && t < 150) d.temperature = Math.round(t);
  const h = nombre(obj(j.power_on_time).hours) ?? nombre(n.power_on_hours) ?? par(/^Power_On_Hours/)?.brut; if (h !== undefined) d.heures = h;
  const c = nombre(j.power_cycle_count) ?? nombre(n.power_cycles) ?? num(12)?.brut ?? nombre(obj(j.scsi_start_stop_cycle_counter).accumulated_start_stop_cycles); if (c !== undefined) d.allumages = c;

  if (protocole === 'ATA' || at.length) {
    const r = num(5), p = num(197), u = num(198), crc = num(199);
    if (r) d.realloues = r.brut; if (p) d.attente = p.brut; if (u) d.illisibles = u.brut; if (crc) d.crc = crc.brut;
    // L'usure d'un SSD : la mesure normalisée quand le disque la donne, sinon la note de sa valeur d'usure.
    const vie = at.find((a) => /^(SSD_Life_Left|Percent_Life(time)?_Remain|Remaining_Lifetime_Perc|Media_Wearout_Indicator|Drive_Life_Remaining|Lifetime_Remaining|Life_Remaining|Endurance_Remaining)/.test(a.nom)) ?? at.find((a) => a.id === 177 && /^Wear_Leveling_Count/.test(a.nom));
    const usure = nombre(obj(j.endurance_used).current_percent) ?? statistique(j, /^Percentage Used Endurance Indicator/i) ?? (vie && vie.note !== undefined && vie.note >= 1 && vie.note <= 100 && d.genre !== 'disque dur' ? 100 - vie.note : undefined);
    if (usure !== undefined) { d.usure = Math.max(0, Math.round(usure)); if (d.genre === 'inconnu') d.genre = 'SSD'; }
    const secteurs = statistique(j, /^Logical Sectors Written/i), ecr = at.find((a) => /^(Total_LBAs_Written|Host_Writes|Lifetime_Writes|Total_Writes|Total_Host_Sector_Write|Writes_GiB|Data_Written)/.test(a.nom));
    const ecrit = secteurs !== undefined ? secteurs * bloc : ecr ? quantite(ecr, bloc) : undefined; if (ecrit) d.ecrit = ecrit;
    const lus = statistique(j, /^Logical Sectors Read/i), lec = at.find((a) => /^(Total_LBAs_Read|Host_Reads|Lifetime_Reads|Total_Reads|Total_Host_Sector_Read|Data_Read)/.test(a.nom));
    const lu = lus !== undefined ? lus * bloc : lec ? quantite(lec, bloc) : undefined; if (lu) d.lu = lu;
    // Le dernier test que le disque a fait sur lui-même, et les erreurs qu'il a notées récemment.
    const jt = obj(j.ata_smart_self_test_log), dernier = tab(obj(jt.extended ?? jt.standard).table)[0], st = obj(dernier?.status);
    if (dernier && st.passed === false) d.autotestRate = propre(st.string, 80) || 'échec';
    const je = obj(j.ata_smart_error_log), log = obj(je.extended ?? je.summary), nbErr = nombre(log.count) ?? 0;
    if (nbErr > 0 && d.heures !== undefined) { const recentes = tab(log.table).filter((e) => typeof e.lifetime_hours === 'number' && d.heures! - (e.lifetime_hours as number) <= 168 && d.heures! - (e.lifetime_hours as number) >= 0).length; if (recentes) d.erreursRecentes = recentes; }
    if (nbErr > 0) d.valeurs.push({ id: 'journal', nom: 'Journal des erreurs', valeur: pluriel(nbErr, 'erreur notée', 'erreurs notées'), etat: d.erreursRecentes ? 'attention' : 'info', explication: `Le disque garde la trace des commandes qui ont échoué. ${d.erreursRecentes ? 'Certaines datent de ces derniers jours : à surveiller.' : 'Aucune ces derniers jours de marche : de vieilles erreurs ne sont pas inquiétantes.'}` });
  }
  if (protocole === 'NVMe' || aN) {
    const cw = nombre(n.critical_warning) ?? nombre(obj(statut.nvme).value); if (cw !== undefined) d.critique = cw;
    const pu = nombre(obj(j.endurance_used).current_percent) ?? nombre(n.percentage_used); if (pu !== undefined) d.usure = pu;
    const sp = nombre(n.available_spare); if (sp !== undefined) d.reserve = sp; const spt = nombre(n.available_spare_threshold); if (spt !== undefined) d.reserveSeuil = spt;
    const w = nombre(n.data_units_written); if (w) d.ecrit = w * 512_000; const rd = nombre(n.data_units_read); if (rd) d.lu = rd * 512_000;
    const me = nombre(n.media_errors); if (me !== undefined) d.erreursMedia = me;
  }
  if (protocole === 'SCSI') {
    const g = nombre(j.scsi_grown_defect_list); if (g !== undefined) d.realloues = g;
    const el = obj(j.scsi_error_counter_log), nc = ['read', 'write', 'verify'].map((k) => nombre(obj(el[k]).total_uncorrected_errors)).filter((x): x is number => x !== undefined);
    if (nc.length) d.illisibles = nc.reduce((a, b) => a + b, 0);
    const pu = nombre(obj(j.endurance_used).current_percent) ?? nombre(j.scsi_percentage_used_endurance_indicator); if (pu !== undefined) { d.usure = pu; if (d.genre === 'inconnu') d.genre = 'SSD'; }
  }

  // ---- Le disque donne-t-il sa santé ?
  const rien = d.passe === undefined && !at.length && !aN && d.realloues === undefined && d.temperature === undefined;
  if (support.available === false || illisible || rien) d.smart = 'non';
  else if (support.enabled === false) d.smart = 'coupé';
  if (illisible && !messages.length) d.messages = ['smartctl n\'a rien répondu de lisible pour ce disque'];

  // ---- Les limites de température : celles du disque quand il les donne, sinon celles du genre de disque.
  const s = o.seuils ?? SEUILS, base = d.genre === 'NVMe' ? s.nvme : d.genre === 'SSD' ? s.ssd : s.hdd;
  const propreAuDisque = nombre(obj(j.nvme_composite_temperature_threshold).warning) ?? nombre(temp.op_limit_max) ?? nombre(temp.drive_trip);
  const alerte = propreAuDisque && propreAuDisque >= 40 && propreAuDisque < base.alerte ? propreAuDisque : base.alerte;
  d.limites = { attention: Math.min(base.attention, alerte - 5), alerte };

  d.valeurs.push(...valeursAta(at, d, bloc), ...valeursNvme(n, d), ...valeursScsi(d));
  const v = juger(d, o.tendance); d.etat = v.etat; d.raisons = v.raisons;
  return d;
}

/** Chaque valeur d'un disque ATA / SATA, expliquée. */
function valeursAta(at: Attribut[], d: Disque, bloc: number): Valeur[] {
  return at.map((a): Valeur => {
    const s = sens(a.nom), x = s ?? INCONNUE, chaleur = /^(Temperature_|Drive_Temperature|Airflow_Temperature)/.test(a.nom);
    const nom = s?.nom ?? (/^Unknown/i.test(a.nom) ? `Valeur n° ${a.id}` : lisible(a.nom));
    let valeur = a.texte, etat: Valeur['etat'] = x.juge === 'note' || x.juge === 'zero' ? 'bon' : 'info', suite = '', si: string | undefined;
    if (/^Power_On_Hours/.test(a.nom) && d.heures !== undefined) valeur = duree(d.heures);
    else if (chaleur && a.brut > 0 && a.brut < 150) valeur = `${a.brut} °C`;
    else { const q = x.juge === 'info' && /Writ|Read/.test(a.nom) ? quantite(a, bloc) : undefined; if (q) valeur = taille(q); }
    if (x.juge === 'zero') { if (a.brut > 0) { etat = 'attention'; si = x.si; suite = x.si ?? ''; } else suite = 'Ici : zéro, parfait.'; }
    if ((x.juge === 'suivre' || x.juge === 'cable') && a.brut > 0) suite = x.si ?? '';
    // Les nombres qui font passer le disque en « Mauvais » valent aussi pour la ligne de la valeur.
    if ((a.id === 5 && a.brut >= BEAUCOUP.realloues) || (a.id === 197 && a.brut >= BEAUCOUP.attente) || (a.id === 198 && a.brut >= BEAUCOUP.illisibles)) etat = 'mauvais';
    if (a.echec === 'now' && chaleur) { etat = 'attention'; suite = 'Le disque dit lui-même qu\'il a trop chaud en ce moment.'; }
    else if (a.echec === 'now') { etat = a.alerte ? 'mauvais' : 'attention'; si = a.alerte ? 'la note est passée sous le seuil du fabricant, le disque annonce une panne proche' : 'la note est passée sous le seuil du fabricant, cette partie du disque est usée'; suite = `${si[0].toUpperCase()}${si.slice(1)}.${a.alerte ? ' Sauvegarde, puis remplace-le.' : ''}`; }
    // Une note repassée au-dessus du seuil n'est qu'un souvenir (un jour de grosse chaleur, par exemple) : on le dit, sans alarme.
    else if (a.echec === 'past') suite = `${suite} La note est déjà passée sous le seuil par le passé ; elle est revenue au-dessus.`.trim();
    const note = a.note !== undefined ? `${a.note}${a.pire !== undefined ? ` (pire ${a.pire}${a.seuil ? `, seuil ${a.seuil}` : ''})` : ''}` : undefined;
    return { id: String(a.id), nom, origine: a.nom, valeur, ...(note ? { note } : {}), etat, explication: `${x.quoi}${suite ? ` ${suite}` : ''}`, ...(si ? { si } : {}) };
  });
}
/** Les valeurs d'un disque NVMe (son « journal de santé »), expliquées. */
function valeursNvme(n: J, d: Disque): Valeur[] {
  if (!Object.keys(n).length) return [];
  const out: Valeur[] = [], v = (id: string, nom: string, valeur: string, etat: Valeur['etat'], explication: string) => { out.push({ id, nom, origine: id, valeur, etat, explication }); };
  const g = (k: string) => nombre(n[k]);
  if (d.critique !== undefined) v('critical_warning', 'Avertissement critique', d.critique ? avertissements(d.critique).join(' ; ') : 'aucun', d.critique ? (d.critique & ~34 ? 'mauvais' : 'attention') : 'bon', 'Le signal d\'alarme du disque. « Aucun » est la valeur normale ; tout autre message demande une sauvegarde tout de suite.');
  if (d.temperature !== undefined) v('temperature', 'Température', `${d.temperature} °C`, d.limites && d.temperature >= d.limites.attention ? 'attention' : 'info', `Température du disque. Un NVMe chauffe vite : au-delà de ${d.limites?.alerte ?? 80} °C il ralentit pour se protéger.`);
  if (d.reserve !== undefined) v('available_spare', 'Réserve de cellules', `${d.reserve} %${d.reserveSeuil !== undefined ? ` (alarme sous ${d.reserveSeuil} %)` : ''}`, d.reserveSeuil !== undefined && d.reserve <= d.reserveSeuil ? 'mauvais' : d.reserve < 50 ? 'attention' : 'bon', 'Cellules de secours qui restent pour remplacer celles qui s\'usent. 100 % : réserve intacte.');
  if (d.usure !== undefined) v('percentage_used', 'Usure', `${d.usure} %`, d.usure >= 100 ? 'mauvais' : d.usure >= 80 ? 'attention' : 'bon', 'Part de la durée de vie prévue par le fabricant déjà consommée. À 100 % le disque a fait son temps (il peut encore marcher, mais sans garantie).');
  if (d.ecrit !== undefined) v('data_units_written', 'Total écrit', taille(d.ecrit), 'info', 'Tout ce qui a été écrit sur le disque depuis qu\'il existe. Un SSD est prévu pour une certaine quantité.');
  if (d.lu !== undefined) v('data_units_read', 'Total lu', taille(d.lu), 'info', 'Tout ce qui a été lu sur le disque depuis qu\'il existe. Simple compteur.');
  if (d.heures !== undefined) v('power_on_hours', 'Temps de fonctionnement', duree(d.heures), 'info', 'Temps total pendant lequel le disque a été allumé.');
  if (d.allumages !== undefined) v('power_cycles', 'Allumages', fr(d.allumages), 'info', 'Nombre de mises sous tension. Simple compteur.');
  const us = g('unsafe_shutdowns'); if (us !== undefined) v('unsafe_shutdowns', 'Coupures brutales', fr(us), 'info', 'Fois où le courant a été coupé sans arrêt propre. Beaucoup de coupures abîment un disque : un onduleur aide.');
  if (d.erreursMedia !== undefined) v('media_errors', 'Erreurs de données', fr(d.erreursMedia), d.erreursMedia > 0 ? 'attention' : 'bon', `Données que le disque n'a pas réussi à relire correctement. Zéro est la valeur normale.${d.erreursMedia > 0 ? ' Des données ont pu être abîmées : sauvegarde et surveille ce nombre.' : ''}`);
  const ne = g('num_err_log_entries'); if (ne !== undefined) v('num_err_log_entries', 'Lignes du journal d\'erreurs', fr(ne), 'info', 'Nombre de messages notés par le disque. Beaucoup de disques y notent des choses sans gravité : ce nombre seul ne dit rien.');
  const bt = g('controller_busy_time'); if (bt !== undefined) v('controller_busy_time', 'Temps de travail', `${fr(bt)} min`, 'info', 'Temps passé par le disque à traiter des demandes. Simple compteur.');
  const wt = g('warning_temp_time'); if (wt !== undefined) v('warning_temp_time', 'Temps passé trop chaud', `${fr(wt)} min`, wt > 0 ? 'info' : 'bon', `Minutes passées au-dessus de la température d'alerte du disque. Zéro est la valeur normale${wt > 0 ? ' ; ici il a déjà eu trop chaud : améliore son refroidissement' : ''}.`);
  const ct = g('critical_comp_time'); if (ct !== undefined) v('critical_comp_time', 'Temps passé en surchauffe', `${fr(ct)} min`, ct > 0 ? 'info' : 'bon', `Minutes passées au-dessus de la température critique. Zéro est la valeur normale${ct > 0 ? ' ; ici il a déjà surchauffé' : ''}.`);
  return out;
}
/** Les mesures d'un disque SCSI / SAS, expliquées. */
function valeursScsi(d: Disque): Valeur[] {
  if (d.protocole !== 'SCSI') return [];
  const out: Valeur[] = [];
  if (d.temperature !== undefined) out.push({ id: 'temperature', nom: 'Température', valeur: `${d.temperature} °C`, etat: d.limites && d.temperature >= d.limites.attention ? 'attention' : 'info', explication: 'Température du disque. La chaleur l\'use plus vite.' });
  if (d.realloues !== undefined) out.push({ id: 'scsi_grown_defect_list', nom: 'Secteurs réalloués', valeur: fr(d.realloues), etat: d.realloues >= BEAUCOUP.realloues ? 'mauvais' : d.realloues > 0 ? 'attention' : 'bon', explication: 'Zones abîmées que le disque a remplacées par des zones de réserve depuis sa fabrication. Zéro est la valeur normale ; si le nombre monte, sauvegarde puis remplace le disque.' });
  if (d.illisibles !== undefined) out.push({ id: 'total_uncorrected_errors', nom: 'Erreurs non corrigées', valeur: fr(d.illisibles), etat: d.illisibles >= BEAUCOUP.illisibles ? 'mauvais' : d.illisibles > 0 ? 'attention' : 'bon', explication: 'Lectures, écritures ou vérifications que le disque n\'a pas réussi à corriger. Zéro est la valeur normale.' });
  if (d.heures !== undefined) out.push({ id: 'power_on_time', nom: 'Temps de fonctionnement', valeur: duree(d.heures), etat: 'info', explication: 'Temps total pendant lequel le disque a été allumé.' });
  if (d.allumages !== undefined) out.push({ id: 'start_stop_cycles', nom: 'Allumages', valeur: fr(d.allumages), etat: 'info', explication: 'Nombre de démarrages. Simple compteur.' });
  if (d.usure !== undefined) out.push({ id: 'endurance', nom: 'Usure', valeur: `${d.usure} %`, etat: d.usure >= 100 ? 'mauvais' : d.usure >= 80 ? 'attention' : 'bon', explication: 'Part de la durée de vie prévue déjà consommée.' });
  return out;
}
/** Les messages de l'avertissement critique d'un NVMe (un bit par message, d'après la norme NVMe). Pur. */
export function avertissements(cw: number): string[] {
  const m: string[] = [];
  if (cw & 1) m.push('la réserve de cellules de secours est presque épuisée');
  if (cw & 2) m.push('la température est sortie des limites');
  if (cw & 4) m.push('le disque n\'est plus fiable (trop d\'erreurs)');
  if (cw & 8) m.push('le disque s\'est mis en lecture seule : il n\'accepte plus d\'écriture');
  if (cw & 16) m.push('sa protection contre les coupures de courant est en panne');
  if (cw & 32) m.push('une zone de mémoire protégée n\'est plus fiable');
  if (cw & ~63) m.push(`autre signal (${cw})`);
  return m;
}

/**
 * L'état d'un disque et ses raisons, en clair. « Bon » veut dire : rien d'anormal dans ce que le disque déclare
 * (un disque peut quand même tomber en panne d'un coup). `tendance` : ce qui a monté sur 30 jours. Pur.
 */
export function juger(d: Disque, tendance?: Tendance): { etat: Etat; raisons: Raison[] } {
  if (d.enVeille) return { etat: 'inconnu', raisons: [] };
  const r: Raison[] = [], dit = (cle: string, niveau: Raison['niveau'], texte: string) => { r.push({ cle, niveau, texte }); };
  const compteur = ['5', '197', '198'];
  if (d.passe === false) dit('smart', 'mauvais', 'Le disque annonce lui-même une panne proche (son test de santé SMART a échoué).');
  // Avertissement critique d'un NVMe : la température seule (2) et la mémoire protégée (32) appellent l'attention, le reste est grave.
  for (const bit of [1, 4, 8, 16, 2, 32]) if ((d.critique ?? 0) & bit) dit(bit === 2 ? 'critique:temp' : 'critique', bit === 2 || bit === 32 ? 'attention' : 'mauvais', `Avertissement critique du disque : ${avertissements(bit)[0]}.`);
  if (d.autotestRate) dit('autotest', 'mauvais', `Le dernier test que le disque a fait sur lui-même a échoué (${d.autotestRate}) : des zones ne se lisent plus.`);
  // Les trois compteurs qui annoncent le mieux une panne : peu = attention, beaucoup (ou sous le seuil du fabricant) = mauvais.
  const sousSeuil = (id: string) => d.valeurs.some((v) => v.id === id && v.etat === 'mauvais');
  const nb = (cle: string, id: string, n: number | undefined, beaucoup: number, un: string, plusieurs: string, quoi: string) => { if (n) dit(cle, n >= beaucoup || sousSeuil(id) ? 'mauvais' : 'attention', `${pluriel(n, un, plusieurs)} : ${quoi}`); };
  nb('realloues', '5', d.realloues, BEAUCOUP.realloues, 'secteur réalloué', 'secteurs réalloués', (d.realloues ?? 0) >= BEAUCOUP.realloues ? 'le disque a déjà remplacé beaucoup de zones abîmées, il arrive au bout.' : 'le disque a déjà remplacé des zones abîmées par des zones de réserve.');
  nb('attente', '197', d.attente, BEAUCOUP.attente, 'secteur en attente', 'secteurs en attente', 'des zones qu\'il n\'arrive plus à lire correctement.');
  nb('illisibles', '198', d.illisibles, BEAUCOUP.illisibles, d.protocole === 'SCSI' ? 'erreur non corrigée' : 'secteur illisible', d.protocole === 'SCSI' ? 'erreurs non corrigées' : 'secteurs illisibles', 'des données que le disque n\'a pas su relire.');
  // Les autres valeurs ATA qui ne vont pas : sous le seuil du fabricant, ou un compteur qui devrait rester à zéro.
  for (const v of d.valeurs) if (/^\d+$/.test(v.id) && !compteur.includes(v.id) && v.si && (v.etat === 'mauvais' || v.etat === 'attention')) dit(`valeur:${v.id}`, v.etat, /seuil du fabricant/.test(v.si) ? `« ${v.nom} » : ${v.si}.` : `« ${v.nom} » : ${v.valeur}. ${v.si}`);
  if (d.erreursMedia) dit('erreursMedia', 'attention', `${pluriel(d.erreursMedia, 'erreur de données', 'erreurs de données')} : le disque n'a pas su relire certaines données.`);
  const alarmeReserve = Boolean((d.critique ?? 0) & 1);
  if (d.reserve !== undefined && d.reserveSeuil !== undefined && d.reserve <= d.reserveSeuil) { if (!alarmeReserve) dit('reserve', 'mauvais', `Réserve de cellules de secours à ${d.reserve} % : elle est épuisée.`); }
  else if (d.reserve !== undefined && d.reserve < 50) dit('reserve', 'attention', `Réserve de cellules de secours à ${d.reserve} % : le disque a commencé à remplacer des cellules usées.`);
  if (d.usure !== undefined && d.usure >= 100) dit('usure', 'mauvais', `Usure à ${d.usure} % : ce disque a dépassé la durée de vie prévue par le fabricant.`);
  else if (d.usure !== undefined && d.usure >= 90) dit('usure', 'attention', `Usure à ${d.usure} % : ce disque arrive au bout de la durée de vie prévue. Prévois son remplacement.`);
  else if (d.usure !== undefined && d.usure >= 80) dit('usure', 'attention', `Usure à ${d.usure} % : ce disque a consommé l'essentiel de la durée de vie prévue.`);
  if (d.erreursRecentes) dit('erreurs', 'attention', `${pluriel(d.erreursRecentes, 'erreur notée', 'erreurs notées')} par le disque ces derniers jours.`);
  if (d.temperature !== undefined && d.limites && d.temperature >= d.limites.attention && !((d.critique ?? 0) & 2)) dit('temp', 'attention', `Température de ${d.temperature} °C : ${d.temperature >= d.limites.alerte ? 'trop chaud' : 'chaud'} pour ${d.genre === 'disque dur' ? 'un disque dur' : d.genre === 'inconnu' ? 'un disque' : `un ${d.genre}`} (limite ${d.limites.alerte} °C). La chaleur l'use plus vite : aère, dépoussière.`);
  // Ce qui monte compte plus que ce qui est : un compteur qui grimpe dit que le disque continue de s'abîmer.
  if (tendance) {
    const monte = (cle: string, delta: number | undefined, quoi: string) => { if (delta && delta > 0) dit(`hausse:${cle}`, delta >= BEAUCOUP.hausse ? 'mauvais' : 'attention', `${quoi} en hausse : +${fr(delta)} depuis le ${tendance.depuis}. Le disque continue de s'abîmer.`); };
    monte('realloues', tendance.realloues, 'Secteurs réalloués'); monte('attente', tendance.attente, 'Secteurs en attente'); monte('illisibles', tendance.illisibles, 'Secteurs illisibles'); monte('erreursMedia', tendance.erreursMedia, 'Erreurs de données');
    if (tendance.crc && tendance.crc > 0) dit('hausse:crc', 'attention', `Erreurs de transmission en hausse : +${fr(tendance.crc)} depuis le ${tendance.depuis}. C'est le plus souvent le câble ou la prise : change le câble SATA (ou le boîtier USB).`);
  }
  if (r.some((x) => x.niveau === 'mauvais')) return { etat: 'mauvais', raisons: [...r.filter((x) => x.niveau === 'mauvais'), ...r.filter((x) => x.niveau !== 'mauvais')] };
  if (r.length) return { etat: 'attention', raisons: r };
  if (d.smart !== 'oui') return { etat: 'inconnu', raisons: [] };
  return { etat: 'bon', raisons: [] };
}

/** Pourquoi un disque ne donne pas sa santé, en une phrase. Pur. */
export function pourquoiInconnu(d: Pick<Disque, 'nom' | 'enVeille' | 'smart' | 'messages' | 'usb'>): string {
  if (d.enVeille) return 'Le disque dort : je ne l\'ai pas réveillé. Sa dernière lecture reste valable.';
  if (d.smart === 'coupé') return 'Le suivi de santé (SMART) est coupé sur ce disque. Pour l\'allumer : « smartctl -s on » sur ce disque.';
  if (/^(vd|xvd)/.test(d.nom)) return 'Disque virtuel : sa santé se lit sur la machine qui l\'héberge, pas ici.';
  if (/^mmcblk/.test(d.nom)) return 'Carte mémoire ou mémoire soudée : elle ne donne pas d\'informations de santé.';
  if (d.messages.length) return `Pas d'informations de santé : ${d.messages[0]}.`;
  if (d.usb) return 'Clé ou boîtier USB qui ne transmet pas la santé du disque.';
  return 'Ce disque ne donne pas d\'informations de santé.';
}
const MOT: Record<Etat, string> = { bon: 'Bon', attention: 'Attention', mauvais: 'Mauvais', inconnu: 'Inconnu' };
export const motEtat = (e: Etat) => MOT[e];
/** Comment appeler un disque dans une phrase : « sda (WD Red 4 To) ». Pur. */
export const appeler = (d: Pick<Disque, 'nom' | 'modele' | 'taille'>) => `${d.nom}${d.modele || d.taille ? ` (${[d.modele, d.taille ? taille(d.taille) : ''].filter(Boolean).join(' ')})` : ''}`;
/** Ce qu'est le disque, en quelques mots : « disque dur 5 400 tr/min », « SSD », « NVMe », « clé ou disque USB ». Pur. */
export function genreDit(d: Pick<Disque, 'genre' | 'tours' | 'usb'>): string {
  const g = d.genre === 'disque dur' ? `disque dur${d.tours ? ` ${fr(d.tours)} tr/min` : ''}` : d.genre === 'inconnu' ? (d.usb ? 'clé ou disque USB' : 'disque') : d.genre;
  return d.usb && d.genre !== 'inconnu' ? `${g}, en USB` : g;
}
/** Les mesures principales sur une ligne : « 34 °C · 21 204 h (2 ans 5 mois) · 312 allumages · usure 12 % ». Pur. */
export function mesures(d: Pick<Disque, 'genre' | 'temperature' | 'heures' | 'allumages' | 'realloues' | 'attente' | 'illisibles' | 'usure' | 'ecrit'>): string {
  return [d.temperature !== undefined ? `${d.temperature} °C` : '', d.heures !== undefined ? duree(d.heures) : '', d.allumages !== undefined ? pluriel(d.allumages, 'allumage', 'allumages') : '',
    d.realloues !== undefined ? pluriel(d.realloues, 'secteur réalloué', 'secteurs réalloués') : '', d.attente ? pluriel(d.attente, 'secteur en attente', 'secteurs en attente') : '', d.illisibles ? pluriel(d.illisibles, 'secteur illisible', 'secteurs illisibles') : '',
    d.usure !== undefined ? `usure ${d.usure} %` : '', d.ecrit && d.genre !== 'disque dur' ? `${taille(d.ecrit)} écrits` : ''].filter(Boolean).join(' · ');
}
