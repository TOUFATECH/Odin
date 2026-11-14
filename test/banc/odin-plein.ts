// Un vrai Odin de test avec de quoi remplir l'interface : appareils du réseau, objets de la maison, notes,
// fiches, alertes, une discussion, des rendez-vous, des sondes… Des noms longs, des adresses et des chemins sans
// espace sont glissés exprès : c'est ce qui fait déborder une page. Sert au parcours de qualité (`qualite.ts`)
// et à tout essai qui veut regarder l'interface « comme chez quelqu'un ».
// Chaque remplissage est facultatif : s'il échoue (appli absente, action renommée), il est noté et le reste continue.

import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Found } from '../../src/hlidskjalf/discover.ts';
import { wait, type T } from './lib.ts';
import type { VraiOdin } from './odin-vrai.ts';

/** La copie du projet où est rangé cet outil. */
export const ICI = fileURLToPath(new URL('../..', import.meta.url));
/** Charge un fichier d'une copie d'Odin (la nôtre par défaut) : le parcours peut ainsi regarder l'interface d'une autre copie. */
export const charger = <M>(racine: string, fichier: string): Promise<M> => import(pathToFileURL(join(racine, fichier)).href) as Promise<M>;

export interface OdinPlein extends VraiOdin {
  /** Adresses des pages publiques préparées (vides si la préparation a échoué). */
  publics: { etat: string; reservation: string; formulaire: string };
  /** Ce qui n'a pas pu être préparé, et pourquoi. */
  manques: string[];
}

const LONG = 'Imprimante-laser-couleur-du-bureau-de-la-comptabilite-au-premier-etage';
const CHEMIN = '/home/awa/Documents/Comptabilite/2026/Factures/fournisseurs/electricite-de-mayotte/facture-janvier-2026-definitive.pdf';
const URL_LONGUE = 'https://exemple.yt/boutique/categorie/informatique/ordinateurs-portables/reference-ABCD-1234-EFGH-5678?couleur=gris&stockage=1To&livraison=mamoudzou';

/** Démarre Odin (compte créé, applis démarrées) et le remplit. `racine` : la copie d'Odin à lancer (par défaut celle de cet outil). */
export async function odinPlein(t: T, opts: { reponses?: number; racine?: string } = {}): Promise<OdinPlein> {
  const racine = opts.racine ?? ICI;
  const { vraiOdin } = await charger<typeof import('./odin-vrai.ts')>(racine, 'test/banc/odin-vrai.ts');
  const { valhallaOf } = await charger<typeof import('../../src/valhalla/odin.ts')>(racine, 'src/valhalla/odin.ts');
  const { draupnirOf } = await charger<typeof import('../../src/tools/draupnir.ts')>(racine, 'src/tools/draupnir.ts');
  const { startDraupnir } = await charger<typeof import('../../src/draupnir/odin.ts')>(racine, 'src/draupnir/odin.ts');
  const { publicKey } = await charger<typeof import('../../src/valhalla/modules/frigg.ts')>(racine, 'src/valhalla/modules/frigg.ts');
  const od = await vraiOdin(t, { compte: true, script: Array.from({ length: opts.reponses ?? 80 }, (_, i) => ({ text: i % 3 === 0 ? `Voici ce que j'ai trouvé.\n\n1. Le fichier ${CHEMIN} fait 2,4 Mo.\n2. Il a été modifié hier à 18 h 02.\n\nJe peux te l'envoyer par e-mail ou le ranger ailleurs : dis-moi.` : 'Bien reçu.' })) });
  const v = valhallaOf()!, manques: string[] = [];
  // Les automatisations (Talos) ne sont pas lancées par `vraiOdin` : on les démarre, pour leur écran et le formulaire public.
  try { t.onEnd(startDraupnir(od.o, async () => undefined)); } catch (e) { manques.push(`automatisations : ${(e as Error).message}`); }
  const essai = async (quoi: string, f: () => unknown | Promise<unknown>) => { try { const r = await f(); if (r && typeof r === 'object' && 'ok' in r && (r as { ok?: boolean }).ok === false) manques.push(`${quoi} : ${(r as { text?: string }).text ?? 'refusé'}`); } catch (e) { manques.push(`${quoi} : ${(e as Error).message}`); } };

  // Le réseau : une box, des ordinateurs, un téléphone, une imprimante au nom interminable, un appareil inconnu.
  await essai('appareils du réseau', () => {
    const net = '192.168.1.0/24', d = (ip: string, mac: string, o: Partial<Found> = {}): Found => ({ ip, mac, ports: [], services: [], network: net, ...o });
    od.o.inventory.applyScan([
      d('192.168.1.1', '00:1e:80:aa:00:01', { hostname: 'livebox', name: 'Livebox 6', isGateway: true, ports: [53, 80, 443], services: ['dns', 'http', 'https'], model: 'Sagemcom F5364' }),
      d('192.168.1.10', '3c:2a:f4:11:22:33', { hostname: LONG, ports: [80, 443, 631, 9100], services: ['http', 'ipp'], model: 'Brother MFC-L8690CDW' }),
      d('192.168.1.20', 'a4:83:e7:00:11:22', { hostname: 'macbook-de-awa', ports: [22, 5000], services: ['ssh'], model: 'MacBook Air (M2, 2022)' }),
      d('192.168.1.21', 'f0:18:98:44:55:66', { hostname: 'iphone-de-said', model: 'iPhone 15' }),
      d('192.168.1.30', '00:11:32:aa:bb:cc', { hostname: 'nas-synology-salon', ports: [22, 80, 443, 445, 5000, 5001], services: ['ssh', 'smb', 'http'], model: 'Synology DS923+', netbios: 'NAS-SALON' }),
      d('192.168.1.40', 'b8:27:eb:12:34:56', { hostname: 'raspberrypi', ports: [22, 8123], services: ['ssh', 'http'], model: 'Raspberry Pi 4 Model B' }),
      d('192.168.1.50', '2c:f0:5d:77:88:99', { hostname: 'PC-BUREAU-COMPTA-01', ports: [135, 139, 445, 3389], services: ['smb', 'rdp'], netbios: 'PC-BUREAU-COMPTA-01' }),
      d('192.168.1.60', '18:b4:30:01:02:03', { hostname: 'camera-entree', ports: [80, 554], services: ['http', 'rtsp'], model: 'Reolink RLC-810A' }),
      d('192.168.1.77', 'de:ad:be:ef:00:77', {}),
    ], [net], Date.now(), 7, true);
  });
  // La maison : des objets connectés.
  await essai('objets de la maison', () => v.ctx('appareils').saveSettings({ devices: {
    l1: { id: 'l1', name: 'Lampe du salon', kind: 'light', room: 'Salon', network: 'MQTT', state: 'ON', stateTopic: 'maison/salon/lampe', commandTopic: 'maison/salon/lampe/set' },
    l2: { id: 'l2', name: 'Guirlande de la terrasse côté jardin (prise connectée)', kind: 'switch', room: 'Terrasse', network: 'MQTT', state: 'OFF', stateTopic: 'maison/terrasse/guirlande', commandTopic: 'maison/terrasse/guirlande/set' },
    t1: { id: 't1', name: 'Température chambre', kind: 'sensor', room: 'Chambre des enfants', network: 'Zigbee', state: '27.5', stateTopic: 'maison/chambre/temp' },
  } }));
  // Le Cerveau : des notes, dont une avec un tableau et un bloc de code larges.
  await essai('note du Cerveau', () => v.act('saga', 'noter', { titre: 'Sauvegardes de la maison', texte: `# Sauvegardes\n\nChaque nuit à 2 h, le NAS copie ${CHEMIN}.\n\n| Appareil | Dernière sauvegarde | Taille | Destination | État |\n|---|---|---|---|---|\n| MacBook de Awa | hier, 02 h 14 | 182 Go | NAS du salon | à jour |\n| PC du bureau | il y a 9 jours | 96 Go | NAS du salon | en retard |\n\n\`\`\`\nrsync -a --delete --exclude=.cache /home/awa/ nas-synology-salon:/volume1/sauvegardes/macbook-de-awa/\n\`\`\`\n\n- [ ] Vérifier le PC du bureau\n- [x] Changer le disque 2` }));
  await essai('note du Cerveau (2)', () => v.act('saga', 'noter', { titre: 'Idées pour la boutique en ligne de Mamoudzou (à trier avant la rentrée)', texte: `Lien à garder : ${URL_LONGUE}\n\nÀ faire avant septembre.` }));
  // Papyrus : quelques fiches.
  for (const [nom, contact] of [['Madi Abdou', 'madi.abdou@exemple.yt'], ['Société des Transports Maritimes de Mayotte et des Comores', 'contact-service-informatique@transports-maritimes.exemple.yt'], ['Fatima Saïd', '06 39 00 00 00']]) await essai('fiche Papyrus', () => v.act('runes', 'client', { nom, contact, rendez_vous: '2026-11-10', prestation: 'Dépannage informatique à domicile' }));
  // Des alertes de plusieurs niveaux.
  await essai('alertes', () => {
    v.alert('forseti', { level: 'critique', title: 'Le disque de sauvegarde est presque plein (97 %)', detail: `Il reste 14 Go sur /volume1. Plus gros dossier : ${CHEMIN}`, key: 'q1', steps: ['Ouvre Pyramide pour voir ce qui prend de la place.', 'Supprime les anciennes sauvegardes.'] });
    v.alert('garmr', { level: 'haute', title: '12 essais de connexion refusés depuis 203.0.113.45', detail: 'Adresse bloquée pendant 24 heures.', key: 'q2' });
    v.alert('vordr', { level: 'moyenne', title: 'Le site boutique.exemple.yt répond lentement', detail: '3,8 secondes en moyenne sur la dernière heure.', key: 'q3' });
    v.alert('ullr', { level: 'info', title: 'Signatures mises à jour', detail: '1 284 nouvelles empreintes.', key: 'q4' });
  });
  // Chronos : une prestation, des horaires, un rendez-vous ; la page publique de réservation.
  let reservation = '';
  await essai('prestation Chronos', () => v.act('frigg', 'prestation', { nom: 'Dépannage informatique à domicile (première heure)', minutes: 60 }));
  await essai('horaires Chronos', () => v.act('frigg', 'horaires', { horaires: 'lundi 08:00-18:00\nmardi 08:00-18:00\nmercredi 08:00-18:00\njeudi 08:00-18:00\nvendredi 08:00-18:00\nsamedi 08:00-18:00\ndimanche 08:00-18:00' }));
  await essai('page de réservation', async () => {
    const key = publicKey(v.ctx('frigg')), jour = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await fetch(`${od.url}/r/${key}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ service: 'Dépannage informatique à domicile (première heure)', jour, heure: '10:00', nom: 'Madi Abdou', contact: 'madi.abdou@exemple.yt', note: 'Ordinateur qui ne démarre plus depuis la coupure de courant.' }).toString() });
    reservation = `/r/${key}?service=${encodeURIComponent('Dépannage informatique à domicile (première heure)')}&jour=${jour}`;
  });
  // Pulsar : deux sondes et la page publique d'état.
  let etat = '';
  await essai('sonde Pulsar', () => v.act('vordr', 'ajouter', { nom: 'Site de la boutique', genre: 'http', cible: `${od.url}/health`, public: true }));
  await essai('sonde Pulsar (2)', () => v.act('vordr', 'ajouter', { nom: 'Serveur de fichiers du bureau de Mamoudzou (partage Windows)', genre: 'tcp', cible: '127.0.0.1:9', public: true }));
  await essai('page publique d\'état', async () => { const r = await v.act('vordr', 'page_publique', { titre: 'État des services de la boutique', active: true }); const slug = String(v.ctx('vordr').settings.publicSlug ?? ''); if (slug) etat = `/etat/${slug}`; return r; });
  // Talos : un formulaire public.
  let formulaire = '';
  await essai('formulaire public', () => {
    const d = draupnirOf(); if (!d) throw new Error('automatisations non démarrées');
    d.save({ name: 'Demande de devis', active: true, nodes: [{ name: 'Formulaire', type: 'déclencheur.formulaire', params: { chemin: 'devis-qualite-essai', titre: 'Demander un devis', description: 'Décris ton besoin : on te répond sous 48 heures.', champs: 'Nom *\nAdresse e-mail * (email)\nType de demande (choix: Dépannage | Installation | Conseil avant achat)\nTon message * (long)', merci: 'Merci, ta demande est bien partie.' } }], connections: {} });
    formulaire = '/f/devis-qualite-essai';
  });
  // Une discussion : une question courte, une longue avec un lien sans espace.
  for (const text of ['Bonjour Odin, quoi de neuf à la maison ?', `Peux-tu retrouver la facture d'électricité de janvier ? Elle doit être par là : ${CHEMIN} ou sur ${URL_LONGUE}`]) {
    await essai('message de discussion', async () => { const r = await od.json('/api/message', { text }); if (r.status >= 300) throw new Error(`HTTP ${r.status}`); });
    await wait(700);
  }
  await wait(800);
  return Object.assign(od, { publics: { etat, reservation, formulaire }, manques });
}
