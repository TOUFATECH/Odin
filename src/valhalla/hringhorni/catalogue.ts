// Hringhorni — le catalogue (lot K4 de la maquette « Conteneurs et machines » validée le 23/11) : des applications
// courantes, utiles à la maison, à déployer en un geste.
//   1. La liste est ÉCRITE ICI, dans le code d'Odin (choix du propriétaire : « une liste tenue dans Odin ») : aucun
//      service tiers n'est consulté pour la montrer. Seules les images sont tirées au déploiement, du registre officiel
//      de chaque appli, par le moteur existant.
//   2. Chaque appli est une COMPOSITION comme celles du lot K3 : elle passe par `analyserComposition` et TOUS ses refus
//      (droits de la machine, disque, dossiers du système ou personnels, réseau de la machine, périphériques…), jamais
//      une exception. Une appli qui demanderait un droit refusé n'entre pas dans la liste (un essai le vérifie).
//   3. Chaque image est ÉPINGLÉE : son nom et une étiquette précise (jamais « latest » ni une étiquette qui bouge). Une
//      nouvelle version ne vient jamais toute seule : c'est « Mises à jour », et le propriétaire décide.
//   4. Les données vont dans des VOLUMES NOMMÉS, à la pile (jamais un dossier de ce PC) : supprimer l'appli les garde ;
//      les effacer ne touche que ses dossiers à elle (choix du propriétaire : « Ses dossiers seulement »).
//   5. Les ports sont PROPOSÉS puis vérifiés libres sur ce PC (le suivant libre sinon, et c'est dit) ; chaque service a
//      sa mémoire au plus. Un mot de passe interne (entre l'appli et sa base) est tiré au hasard à chaque déploiement,
//      jamais écrit ici ni montré.
// Les noms d'autres produits ne s'écrivent que dans « alternativeA » (règle du projet).
import { randomBytes } from 'node:crypto';
import { analyserComposition, lireYamlStrict, NOM_PILE, type Analyse, type Garde, type Obj } from './composition.ts';

/** Un port proposé par une appli : `cle` le relie à « {{port:cle}} » dans sa composition. */
export interface PortCatalogue { cle: string; propose: number; quoi: string; web?: boolean }
export interface EntreeCatalogue {
  id: string; nom: string; categorie: string; quoi: string;
  /** les produits dont elle tient lieu (le seul endroit où leurs noms s'écrivent) */
  alternativeA: string[];
  ports: PortCatalogue[];
  /** qui peut l'ouvrir une fois lancée : « premier-compte » (le premier venu sur le réseau de la maison crée le compte
   *  administrateur tant que le propriétaire ne l'a pas fait), « sans-compte » (ouverte à tout le réseau de la maison).
   *  K3 n'accepte pas encore d'adresse d'écoute : le port est ouvert sur tout le réseau, et la confirmation le dit. */
  acces: 'premier-compte' | 'sans-compte';
  /** ce qu'il faut savoir en l'ouvrant la première fois */
  premiere: string;
  /** une limite dite franchement (où mettre ses fichiers, ce qui n'est pas dedans) */
  note?: string;
  /** la composition : « {{port:cle}} » et « {{secret:cle}} » sont remplis au déploiement */
  composition: string;
}

const PREMIER_COMPTE = 'Le premier compte créé devient l\'administrateur : ouvre-la tout de suite après le déploiement et crée le tien.';
/** Ce que la confirmation dit de l'accès (relecture K4 : le conseil seul ne suffisait pas, il n'était pas dans l'accord).
 *  K3 refuse encore une adresse d'écoute : le port est ouvert à tout le réseau de la maison. */
export const TEXTES_ACCES: Record<EntreeCatalogue['acces'], string> = {
  'premier-compte': 'son port est ouvert à tout le réseau de la maison : tant que tu n\'as pas créé ton compte, n\'importe qui sur le réseau de la maison peut le créer avant toi et en devenir l\'administrateur (ouvre-la tout de suite)',
  'sans-compte': 'sans mot de passe, ouverte à tout le réseau de la maison',
};

export const CATALOGUE: readonly EntreeCatalogue[] = [
  {
    id: 'photos', nom: 'Galerie de photos', categorie: 'Photos', quoi: 'Tes photos et vidéos rangées par date et par lieu, sur ta machine, avec l\'envoi depuis le téléphone.',
    alternativeA: ['Immich', 'Google Photos', 'iCloud Photos'], acces: 'premier-compte',
    ports: [{ cle: 'web', propose: 20070, quoi: 'la galerie', web: true }],
    premiere: PREMIER_COMPTE,
    note: 'Sans la reconnaissance des visages : elle téléchargerait ses modèles ailleurs que dans le registre officiel.',
    composition: `services:
  serveur:
    image: ghcr.io/immich-app/immich-server:v1.123.0
    ports: ["{{port:web}}:2283"]
    volumes: ["bibliotheque:/usr/src/app/upload"]
    environment:
      DB_HOSTNAME: base
      DB_USERNAME: galerie
      DB_PASSWORD: "{{secret:base}}"
      DB_DATABASE_NAME: galerie
      REDIS_HOSTNAME: cache
      IMMICH_MACHINE_LEARNING_ENABLED: "false"
    depends_on: [base, cache]
    restart: unless-stopped
    mem_limit: 2g
  cache:
    image: redis:6.2.16-alpine
    restart: unless-stopped
    mem_limit: 256m
  base:
    image: tensorchord/pgvecto-rs:pg14-v0.2.0
    environment:
      POSTGRES_USER: galerie
      POSTGRES_PASSWORD: "{{secret:base}}"
      POSTGRES_DB: galerie
      POSTGRES_INITDB_ARGS: "--data-checksums"
    volumes: ["base:/var/lib/postgresql/data"]
    command:
      - postgres
      - -c
      - shared_preload_libraries=vectors.so
      - -c
      - 'search_path="$$user", public, vectors'
      - -c
      - logging_collector=on
    restart: unless-stopped
    mem_limit: 1g
volumes:
  bibliotheque: {}
  base: {}
`,
  },
  {
    id: 'medias', nom: 'Serveur de médias', categorie: 'Médias', quoi: 'Films, séries et musique sur la télé, les ordinateurs et les téléphones de la maison.',
    alternativeA: ['Jellyfin', 'Plex', 'Emby'], acces: 'premier-compte',
    ports: [{ cle: 'web', propose: 20100, quoi: 'le serveur de médias', web: true }],
    premiere: 'À la première ouverture, un assistant crée ton compte et tes bibliothèques : fais-le tout de suite, le premier qui l\'ouvre en devient l\'administrateur.',
    note: 'Tes films vont dans son volume « films » (lu seulement par l\'appli) ; choisir un dossier de ta machine viendra plus tard.',
    composition: `services:
  serveur:
    image: jellyfin/jellyfin:10.10.3
    ports: ["{{port:web}}:8096"]
    volumes: ["reglages:/config", "cache:/cache", "films:/media:ro"]
    restart: unless-stopped
    mem_limit: 2g
volumes:
  reglages: {}
  cache: {}
  films: {}
`,
  },
  {
    id: 'musique', nom: 'Bibliothèque musicale', categorie: 'Médias', quoi: 'Ta musique en ligne dans la maison, avec listes de lecture, sur le navigateur et les applis de téléphone.',
    alternativeA: ['Navidrome', 'Spotify', 'Deezer'], acces: 'premier-compte',
    ports: [{ cle: 'web', propose: 20101, quoi: 'la bibliothèque', web: true }],
    premiere: PREMIER_COMPTE,
    note: 'Ta musique va dans son volume « musique » (lu seulement par l\'appli).',
    composition: `services:
  serveur:
    image: deluan/navidrome:0.53.3
    ports: ["{{port:web}}:4533"]
    volumes: ["donnees:/data", "musique:/music:ro"]
    restart: unless-stopped
    mem_limit: 512m
volumes:
  donnees: {}
  musique: {}
`,
  },
  {
    id: 'livres-audio', nom: 'Livres audio et podcasts', categorie: 'Lecture', quoi: 'Tes livres audio et tes podcasts, avec la reprise là où tu t\'étais arrêté, sur chaque appareil.',
    alternativeA: ['Audiobookshelf', 'Audible'], acces: 'premier-compte',
    ports: [{ cle: 'web', propose: 20102, quoi: 'la bibliothèque', web: true }],
    premiere: PREMIER_COMPTE,
    composition: `services:
  serveur:
    image: ghcr.io/advplyr/audiobookshelf:2.17.5
    ports: ["{{port:web}}:80"]
    volumes: ["livres:/audiobooks", "podcasts:/podcasts", "reglages:/config", "metadonnees:/metadata"]
    restart: unless-stopped
    mem_limit: 512m
volumes:
  livres: {}
  podcasts: {}
  reglages: {}
  metadonnees: {}
`,
  },
  {
    id: 'notes', nom: 'Bloc-notes', categorie: 'Notes', quoi: 'Des notes rapides, des listes et des idées, cherchables, pour toi ou pour la famille.',
    alternativeA: ['Memos', 'Google Keep'], acces: 'premier-compte',
    ports: [{ cle: 'web', propose: 20300, quoi: 'le bloc-notes', web: true }],
    premiere: PREMIER_COMPTE,
    note: 'Ensuite, d\'autres peuvent s\'inscrire depuis le réseau de la maison : ferme les inscriptions dans ses réglages si tu ne le veux pas.',
    composition: `services:
  serveur:
    image: neosmemo/memos:0.22.5
    ports: ["{{port:web}}:5230"]
    volumes: ["donnees:/var/opt/memos"]
    environment:
      MEMOS_MODE: prod
      MEMOS_PORT: "5230"
    restart: unless-stopped
    mem_limit: 256m
volumes:
  donnees: {}
`,
  },
  {
    id: 'flux', nom: 'Lecteur de flux', categorie: 'Lecture', quoi: 'Les nouveaux articles de tes sites préférés, au même endroit, relus toutes les 30 minutes.',
    alternativeA: ['FreshRSS', 'Feedly', 'Inoreader'], acces: 'premier-compte',
    ports: [{ cle: 'web', propose: 20310, quoi: 'le lecteur', web: true }],
    premiere: 'À la première ouverture, un assistant crée ton compte (garde la base proposée, un simple fichier) : fais-le tout de suite, le premier qui l\'ouvre en devient l\'administrateur.',
    composition: `services:
  serveur:
    image: freshrss/freshrss:1.24.3
    ports: ["{{port:web}}:80"]
    volumes: ["donnees:/var/www/FreshRSS/data", "extensions:/var/www/FreshRSS/extensions"]
    environment:
      CRON_MIN: "3,33"
    restart: unless-stopped
    mem_limit: 256m
volumes:
  donnees: {}
  extensions: {}
`,
  },
  {
    id: 'accueil', nom: 'Page d\'accueil de la maison', categorie: 'Maison', quoi: 'Une page avec les liens de tes applis et de tes appareils, à mettre en page de démarrage du navigateur.',
    alternativeA: ['Homepage', 'Heimdall'], acces: 'sans-compte',
    ports: [{ cle: 'web', propose: 20320, quoi: 'la page d\'accueil', web: true }],
    premiere: 'Sans compte : la page est visible de toute la maison. Ses liens se règlent dans son volume « reglages ».',
    composition: `services:
  serveur:
    image: ghcr.io/gethomepage/homepage:v0.9.10
    ports: ["{{port:web}}:3000"]
    volumes: ["reglages:/app/config"]
    restart: unless-stopped
    mem_limit: 256m
volumes:
  reglages: {}
`,
  },
  {
    id: 'surveillance', nom: 'Surveillance des sites', categorie: 'Outils', quoi: 'Vérifie chaque minute que tes sites et appareils répondent, et garde l\'historique des pannes.',
    alternativeA: ['Uptime Kuma', 'UptimeRobot'], acces: 'premier-compte',
    ports: [{ cle: 'web', propose: 20060, quoi: 'le tableau de surveillance', web: true }],
    premiere: PREMIER_COMPTE,
    composition: `services:
  serveur:
    image: louislam/uptime-kuma:1.23.16
    ports: ["{{port:web}}:3001"]
    volumes: ["donnees:/app/data"]
    restart: unless-stopped
    mem_limit: 512m
volumes:
  donnees: {}
`,
  },
  {
    id: 'pdf', nom: 'Outils PDF', categorie: 'Outils', quoi: 'Assembler, couper, tourner, compresser et convertir des PDF, sans les envoyer sur un site.',
    alternativeA: ['Stirling-PDF', 'iLovePDF', 'Smallpdf'], acces: 'sans-compte',
    ports: [{ cle: 'web', propose: 20120, quoi: 'les outils PDF', web: true }],
    premiere: 'Sans compte : les outils sont ouverts à toute la maison, et rien n\'est gardé après chaque fichier.',
    composition: `services:
  serveur:
    image: stirlingtools/stirling-pdf:0.36.6
    ports: ["{{port:web}}:8080"]
    volumes: ["reglages:/configs"]
    environment:
      DOCKER_ENABLE_SECURITY: "false"
    restart: unless-stopped
    mem_limit: 1g
volumes:
  reglages: {}
`,
  },
  {
    id: 'site', nom: 'Site web simple', categorie: 'Web', quoi: 'Une page ou un petit site, servi depuis la maison.',
    alternativeA: ['GitHub Pages', 'Netlify'], acces: 'sans-compte',
    ports: [{ cle: 'web', propose: 20200, quoi: 'le site', web: true }],
    premiere: 'Le site est vide au départ : ses pages vont dans son volume « pages » (une page « index.html » d\'abord).',
    composition: `services:
  serveur:
    image: nginx:1.27.3-alpine
    ports: ["{{port:web}}:80"]
    volumes: ["pages:/usr/share/nginx/html:ro"]
    restart: unless-stopped
    mem_limit: 128m
volumes:
  pages: {}
`,
  },
];

export const entreeCatalogue = (id: string): EntreeCatalogue | undefined => CATALOGUE.find((e) => e.id === String(id ?? ''));

/** Les marques d'une composition du catalogue (« {{port:web}} », « {{secret:base}} »). */
const MARQUE = /\{\{(port|secret):([a-z][a-z0-9-]{0,20})\}\}/g;
export function marques(e: EntreeCatalogue): { ports: string[]; secrets: string[] } {
  const ports = new Set<string>(), secrets = new Set<string>();
  for (const m of e.composition.matchAll(MARQUE)) (m[1] === 'port' ? ports : secrets).add(m[2]);
  return { ports: [...ports], secrets: [...secrets] };
}
/** Un mot de passe interne neuf (lettres, chiffres, « - » et « _ » : jamais un « $ » que la composition lirait). */
export const secretNeuf = (): string => randomBytes(24).toString('base64url');

/** Remplit les marques ; une marque oubliée ou un port invalide : refusé (jamais deviné). Pur. */
export function remplirComposition(e: EntreeCatalogue, ports: Record<string, number>, secrets: Record<string, string>): string {
  const t = e.composition.replace(MARQUE, (_m, genre: string, cle: string) => {
    if (genre === 'port') {
      const p = ports[cle];
      if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(`port « ${cle} » manquant ou invalide`);
      return String(p);
    }
    const v = secrets[cle];
    if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(v)) throw new Error(`secret « ${cle} » manquant ou invalide`);
    return v;
  });
  if (/\{\{/.test(t)) throw new Error('marque inconnue dans la composition');
  return t;
}

/** Les noms des services d'une appli (lus par le même lecteur strict que les fichiers de composition). */
export function servicesDe(e: EntreeCatalogue): string[] {
  const d = lireYamlStrict(e.composition) as Obj, sv = d.services;
  return sv && typeof sv === 'object' && !Array.isArray(sv) ? Object.keys(sv) : [];
}
/** Les noms des volumes déclarés d'une appli (« bibliotheque », « base »). */
export function volumesDe(e: EntreeCatalogue): string[] {
  const d = lireYamlStrict(e.composition) as Obj, v = d.volumes;
  return v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v) : [];
}
/** Le premier nom de pile libre : « photos », sinon « photos-2 »… (ni une pile, ni un conteneur, ni un réseau, ni un
 *  volume qui porte déjà ce nom : les volumes gardés d'une ancienne copie ne sont jamais repris en silence — sa base
 *  y garde l'ancien mot de passe interne, et la confirmation dirait « créés »). */
export function nomLibre(e: EntreeCatalogue, g: Garde = {}): string {
  const services = servicesDe(e), vols = volumesDe(e);
  const pris = (n: string) => Boolean(g.piles?.includes(n)) || services.some((s) => g.conteneurs?.includes(`${n}-${s}`)) || Boolean(g.reseaux?.includes(`pile-${n}`)) || vols.some((v) => g.volumes?.includes(`${n}_${v}`));
  for (let k = 1; k <= 99; k++) { const n = k === 1 ? e.id : `${e.id}-${k}`; if (NOM_PILE.test(n) && !pris(n)) return n; }
  throw new Error(`plus de nom libre pour ${e.nom}`);
}

/** Les ports : celui proposé s'il est libre, sinon le suivant libre (et ce qui a bougé). Pur. */
export function placerPorts(e: EntreeCatalogue, pris: Map<number, string> | undefined): { ports: Record<string, number>; deplaces: Array<{ cle: string; voulu: number; donne: number; raison: string }> } {
  const ports: Record<string, number> = {}, deplaces: Array<{ cle: string; voulu: number; donne: number; raison: string }> = [], dejaDonnes = new Set<number>();
  for (const p of e.ports) {
    let h = p.propose;
    while (h <= 65535 && (pris?.has(h) || dejaDonnes.has(h))) h++;
    if (h > 65535 || h - p.propose > 200) throw new Error(`aucun port libre après ${p.propose}`);
    if (h !== p.propose) deplaces.push({ cle: p.cle, voulu: p.propose, donne: h, raison: pris?.get(p.propose) ?? 'pris' });
    dejaDonnes.add(h); ports[p.cle] = h;
  }
  return { ports, deplaces };
}

const MEM = /^(\d+(?:\.\d+)?)([kmg])?$/i;
/** « 512m » → octets (0 si illisible). */
export const octetsMemoire = (m: string): number => { const x = MEM.exec(String(m ?? '').trim()); return x ? Math.round(Number(x[1]) * ({ k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[(x[2] ?? '').toLowerCase()] ?? 1)) : 0; };

export interface Preparation {
  entree: EntreeCatalogue; nom: string; texte: string; analyse: Analyse;
  ports: Array<{ cle: string; quoi: string; voulu: number; hote: number; dedans: number; web: boolean }>;
  deplaces: Array<{ cle: string; voulu: number; donne: number; raison: string }>;
  images: string[]; volumes: string[]; memoire: number;
}
/**
 * Prépare le déploiement d'une appli du catalogue : son nom de pile (libre), ses ports (libres, ou ceux confirmés),
 * ses mots de passe internes (neufs), sa composition remplie et L'ANALYSE COMPLÈTE du lot K3 avec la garde de ce PC.
 * Rien n'est lancé ni écrit. Les secrets ne sortent jamais d'ici que dans `texte`.
 */
export function preparer(e: EntreeCatalogue, o: { garde?: Garde; nom?: string; ports?: Record<string, number>; secrets?: Record<string, string> } = {}): Preparation {
  const g = o.garde ?? {}, m = marques(e);
  const nom = o.nom ? String(o.nom).trim() : nomLibre(e, g);
  let ports: Record<string, number>, deplaces: Preparation['deplaces'] = [];
  if (o.ports) { ports = {}; for (const p of e.ports) ports[p.cle] = Number(o.ports[p.cle]); }
  else ({ ports, deplaces } = placerPorts(e, g.portsPris));
  const secrets: Record<string, string> = { ...(o.secrets ?? {}) };
  for (const k of m.secrets) secrets[k] ??= secretNeuf();
  const texte = remplirComposition(e, ports, secrets);
  const analyse = analyserComposition(texte, { nom, garde: g });
  const dedans = new Map<number, number>();
  for (const s of analyse.services) for (const p of s.ports) dedans.set(p.host, p.inner);
  return {
    entree: e, nom, texte, analyse, deplaces,
    ports: e.ports.map((p) => ({ cle: p.cle, quoi: p.quoi, voulu: p.propose, hote: ports[p.cle], dedans: dedans.get(ports[p.cle]) ?? 0, web: Boolean(p.web) })),
    images: [...new Set(analyse.services.map((s) => s.image))],
    volumes: analyse.volumes.map((v) => v.nom),
    memoire: analyse.services.reduce((a, s) => a + octetsMemoire(s.memory), 0),
  };
}
/** « ghcr.io/a/b:1.2 » → { nom: « ghcr.io/a/b », etiquette: « 1.2 » }. */
export function decouperImage(image: string): { nom: string; etiquette: string } {
  const slash = image.lastIndexOf('/'), colon = image.lastIndexOf(':');
  return colon > slash ? { nom: image.slice(0, colon), etiquette: image.slice(colon + 1) } : { nom: image, etiquette: '' };
}
