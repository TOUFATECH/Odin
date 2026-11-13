// Odin OS — installer Odin OS depuis Odin : dans Docker, dans un conteneur LXC (Proxmox ou LXC classique),
// ou simplement l'essayer dans le navigateur. Utilisé par l'appli Valaskjálf et par « odin os … ».

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { APP_ROOT } from '../tools/self.ts';
import { VERSION_OS } from './version.ts';

export type Lanceur = (cmd: string, args: string[], o?: { timeoutMs?: number; sudo?: boolean }) => Promise<{ code: number; out: string; err: string }>;
export interface Outils { run: Lanceur; has(cmd: string): Promise<boolean> }
export interface Resultat { ok: boolean; text: string }

export const DOSSIER_IMAGES = join(APP_ROOT, 'os', 'sortie');
export const IMAGE_DOCKER = `odin-os:${VERSION_OS}`;
const nomSur = (n: string): boolean => /^[a-z0-9][a-z0-9-]{0,40}$/.test(n);
const dernier = (t: string, n = 600): string => t.trim().slice(-n);

export interface ImageConstruite { fichier: string; taille: number; sha256: string }
/** Les images construites sur cette machine (os/sortie), avec la taille et l'empreinte notées à la construction. */
export function imagesConstruites(dossier = DOSSIER_IMAGES): ImageConstruite[] {
  let sommes = ''; try { sommes = readFileSync(join(dossier, 'SHA256SUMS'), 'utf8'); } catch { return []; }
  const liste: ImageConstruite[] = [];
  for (const l of sommes.split('\n')) { const m = /^([0-9a-f]{64})\s+(\S.*)$/.exec(l.trim()); if (!m) continue; try { liste.push({ fichier: m[2], taille: statSync(join(dossier, m[2])).size, sha256: m[1] }); } catch { /* image déplacée */ } }
  return liste;
}
export const empreinte = (fichier: string): Promise<string> => new Promise((ok, ko) => { const h = createHash('sha256'); createReadStream(fichier).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', ko); });
/** L'architecture de cette machine, telle qu'elle est écrite dans le nom des images. */
export const ARCH_IMAGE = process.arch === 'arm64' ? 'arm64' : 'amd64';
/** Cherche une image construite pour cette machine par son suffixe (« -docker.tar.gz », « -lxc.tar.xz »…). */
export function trouverImage(suffixe: string, dossier = DOSSIER_IMAGES, arch = ARCH_IMAGE): string | undefined {
  try { const f = readdirSync(dossier).filter((x) => x.startsWith('odin-os-') && x.includes(`-${arch}`) && x.endsWith(suffixe)).sort().pop(); return f ? join(dossier, f) : undefined; } catch { return undefined; }
}

/** L'adresse du bureau servi par cet Odin (essai dans le navigateur). */
export function adresseEssai(cfg: { web: { port: number; tls?: { enabled?: boolean }; publicUrl?: string; host?: string } }): string {
  if (cfg.web.publicUrl) return `${cfg.web.publicUrl.replace(/\/$/, '')}/os/`;
  return `${cfg.web.tls?.enabled === false ? 'http' : 'https'}://${cfg.web.host && !['0.0.0.0', '::'].includes(cfg.web.host) ? cfg.web.host : 'localhost'}:${cfg.web.port}/os/`;
}

/** Installe et démarre Odin OS dans Docker. L'image vient d'une image construite (os/sortie), sinon elle est construite depuis le dépôt. */
export async function installerDocker(o: Outils, r: { nom?: string; port?: number; lan?: boolean } = {}): Promise<Resultat> {
  const nom = r.nom || 'odin-os', port = Number(r.port) || 7788;
  if (!nomSur(nom) || port < 1 || port > 65535) return { ok: false, text: 'Nom ou port invalide.' };
  if (!await o.has('docker')) return { ok: false, text: 'Docker n\'est pas installé sur cette machine. Installe-le (ou demande-le à Naglfar), puis relance.' };
  const existe = await o.run('docker', ['ps', '-a', '--filter', `name=^${nom}$`, '--format', '{{.Status}}']);
  if (existe.out.trim()) { if (/^Up/.test(existe.out.trim())) return { ok: true, text: `Odin OS tourne déjà dans Docker (conteneur ${nom}) : http://localhost:${port}/os/` }; const s = await o.run('docker', ['start', nom]); return s.code === 0 ? { ok: true, text: `Conteneur ${nom} redémarré : http://localhost:${port}/os/` } : { ok: false, text: `Le conteneur ${nom} existe mais ne démarre pas : ${dernier(s.err || s.out)}` }; }
  if ((await o.run('docker', ['image', 'inspect', IMAGE_DOCKER, '--format', '{{.Id}}'])).code !== 0) {
    const archive = trouverImage('-docker.tar.gz');
    if (archive) { const l = await o.run('docker', ['load', '-i', archive], { timeoutMs: 600_000 }); if (l.code !== 0) return { ok: false, text: `Chargement de l'image impossible : ${dernier(l.err || l.out)}` }; }
    else {
      const recette = join(APP_ROOT, 'os', 'docker', 'Dockerfile');
      if (!existsSync(recette)) return { ok: false, text: 'Image Odin OS introuvable, et ce dépôt n\'a pas la recette (os/docker/Dockerfile). Récupère le dépôt complet d\'Odin, ou construis les images : sudo os/build/images.sh' };
      const b = await o.run('docker', ['build', '-t', IMAGE_DOCKER, '-f', recette, APP_ROOT], { timeoutMs: 1_800_000 });
      if (b.code !== 0) return { ok: false, text: `Construction de l'image impossible : ${dernier(b.err || b.out)}` };
    }
  }
  // Par défaut, le bureau n'est ouvert que sur cette machine (HTTP local) ; --lan l'ouvre au réseau local, en HTTPS.
  const lance = await o.run('docker', ['run', '-d', '--name', nom, '--hostname', 'odin-os', '--restart', 'unless-stopped', ...(r.lan ? ['-e', 'ODIN_OS_HTTPS=1'] : []), '-p', `${r.lan ? '' : '127.0.0.1:'}${port}:7777`, '-v', `${nom}-donnees:/home/odin`, IMAGE_DOCKER], { timeoutMs: 120_000 });
  if (lance.code !== 0) return { ok: false, text: `Démarrage impossible : ${dernier(lance.err || lance.out)}` };
  const ou = r.lan ? `https://ADRESSE-DE-CETTE-MACHINE:${port}/os/ depuis ton réseau (certificat d'Odin : le navigateur demande de l'accepter la première fois)` : `http://localhost:${port}/os/`;
  return { ok: true, text: `✓ Odin OS ${VERSION_OS} tourne dans Docker (conteneur ${nom}).\nOuvre ${ou} : au premier passage, tu crées ton compte.\nArrêter : docker stop ${nom} · Retirer : docker rm -f ${nom} (les données restent dans le volume ${nom}-donnees).` };
}

/** Installe Odin OS dans un conteneur LXC : Proxmox (pct) s'il est là, sinon LXC classique (lxc-create). */
export async function installerLxc(o: Outils, r: { nom?: string; id?: number; stockage?: string; pont?: string } = {}): Promise<Resultat> {
  const nom = r.nom || 'odin-os'; if (!nomSur(nom)) return { ok: false, text: 'Nom invalide.' };
  const modele = trouverImage('-lxc.tar.xz');
  if (!modele) return { ok: false, text: 'Modèle LXC introuvable (os/sortie/odin-os-…-lxc.tar.xz). Construis-le : sudo os/build/lxc.sh (voir docs/odin-os.md).' };
  if (await o.has('pct')) {
    let id = Number(r.id) || 0;
    if (!id) { const n = await o.run('pvesh', ['get', '/cluster/nextid'], { sudo: true }); id = Number(n.out.trim().replace(/"/g, '')); }
    if (!Number.isInteger(id) || id < 100) return { ok: false, text: 'Numéro de conteneur invalide (donne --id=NNN).' };
    const cree = await o.run('pct', ['create', String(id), modele, '--hostname', nom, '--ostype', 'ubuntu', '--arch', ARCH_IMAGE, '--cores', '2', '--memory', '1024', '--swap', '512', '--rootfs', `${r.stockage || 'local-lvm'}:8`, '--net0', `name=eth0,bridge=${r.pont || 'vmbr0'},ip=dhcp`, '--unprivileged', '1', '--features', 'nesting=1', '--onboot', '1'], { sudo: true, timeoutMs: 600_000 });
    if (cree.code !== 0) return { ok: false, text: `Création du conteneur impossible : ${dernier(cree.err || cree.out)}` };
    const demarre = await o.run('pct', ['start', String(id)], { sudo: true, timeoutMs: 120_000 });
    if (demarre.code !== 0) return { ok: false, text: `Conteneur ${id} créé, mais il ne démarre pas : ${dernier(demarre.err || demarre.out)}` };
    return { ok: true, text: `✓ Odin OS ${VERSION_OS} est installé dans le conteneur LXC ${id} (${nom}) de Proxmox.\nSon adresse : pct exec ${id} -- hostname -I · puis ouvre https://ADRESSE:7777/os/ depuis ton réseau (certificat d'Odin : le navigateur demande de l'accepter la première fois).` };
  }
  if (await o.has('lxc-create')) {
    const cree = await o.run('lxc-create', ['-n', nom, '-t', 'local', '--', '--fstree', modele, '--metadata', modele.replace(/-lxc\.tar\.xz$/, '-lxc-meta.tar.xz')], { sudo: true, timeoutMs: 600_000 });
    if (cree.code !== 0) return { ok: false, text: `Création du conteneur impossible : ${dernier(cree.err || cree.out)}` };
    const demarre = await o.run('lxc-start', ['-n', nom], { sudo: true, timeoutMs: 60_000 });
    if (demarre.code !== 0) return { ok: false, text: `Conteneur ${nom} créé, mais il ne démarre pas : ${dernier(demarre.err || demarre.out)}` };
    return { ok: true, text: `✓ Odin OS ${VERSION_OS} est installé dans le conteneur LXC ${nom}.\nSon adresse : sudo lxc-info -n ${nom} -iH · puis ouvre https://ADRESSE:7777/os/ (certificat d'Odin : le navigateur demande de l'accepter la première fois).` };
  }
  return { ok: false, text: `Ni Proxmox (pct) ni LXC (lxc-create) sur cette machine. Copie ${modele} sur ton Proxmox (/var/lib/vz/template/cache/) et crée le conteneur depuis son interface, ou lance « odin os installer --lxc » sur le Proxmox.` };
}
