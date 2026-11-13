// Valaskjálf — Odin OS, le système d'exploitation d'Odin : un bureau léger (base Ubuntu LTS) servi par Odin.
// L'essayer dans le navigateur, l'installer dans Docker ou dans un conteneur LXC, retrouver les images
// construites (PC, Windows, téléphone) avec leur taille et leur empreinte.

import { existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { imagesConstruites, installerDocker, installerLxc, DOSSIER_IMAGES, IMAGE_DOCKER } from '../../os/installer.ts';
import { cible, fichierTerminal, surOdinOS, terminalAutorise } from '../../os/systeme.ts';
import { BASE_OS, VERSION_OS } from '../../os/version.ts';
import type { ModCtx, Module } from '../types.ts';

const s = (v: unknown) => String(v ?? '');
const taille = (o: number) => (o >= 2 ** 30 ? `${(o / 2 ** 30).toFixed(2).replace('.', ',')} Go` : o >= 2 ** 20 ? `${Math.round(o / 2 ** 20)} Mo` : o >= 1024 ? `${Math.round(o / 1024)} Ko` : `${o} octets`);
const outils = (ctx: ModCtx) => ({ run: ctx.run, has: ctx.has });
const chemins = (ctx: ModCtx) => ({ home: ctx.home } as Parameters<typeof terminalAutorise>[0]);
/** Les façons d'avoir Odin OS, et ce qu'il faut pour chacune. */
const CIBLES: Array<[string, string, string]> = [
  ['Navigateur', 'Ouvre /os/ sur cet Odin', 'rien à installer : le bureau s\'affiche tout de suite, avec tes vraies applis d\'Odin'],
  ['Docker', 'odin os installer --docker', 'un conteneur Odin OS complet (Ubuntu + Odin), bureau sur http://localhost:7788/os/'],
  ['LXC / Proxmox', 'odin os installer --lxc', 'un conteneur système (modèle .tar.xz), démarré avec systemd'],
  ['PC ou machine virtuelle', 'image ISO', 'démarre sur l\'ISO (essai sans rien installer), puis installe sur le disque depuis Odin Setup'],
  ['Windows', 'paquet WSL + Installer-OdinOS.ps1', 'la même base Ubuntu dans Windows (WSL 2), bureau dans une fenêtre'],
  ['Téléphone Android', 'Odin Launcher (APK) + base Ubuntu arm64', 'l\'écran d\'accueil Odin OS ; la base Ubuntu tourne sur le téléphone (Termux) ou sur ton serveur'],
];

export const valaskjalf: Module = {
  id: 'valaskjalf', name: 'Valaskjálf', family: 'Machines',
  what: 'Odin OS, le système d\'exploitation d\'Odin : l\'essayer dans le navigateur, l\'installer sur Docker ou LXC, retrouver les images pour PC, Windows et téléphone.',
  does: ['bureau Odin OS servi par Odin (/os/) : 5 thèmes, écran téléphone, Fichiers, Terminal, Odin Store, Ullr', 'essai dans le navigateur, sans rien installer', 'installation dans Docker (avec ton accord)', 'installation dans un conteneur LXC, Proxmox ou LXC classique (avec ton accord)', 'liste des images construites : taille et empreinte SHA-256', 'ouvre ou ferme le vrai terminal du bureau sur cette machine'],
  from: ['Ubuntu', 'labwc', 'Wine', 'Waydroid'], upstream: ['labwc/labwc', 'waydroid/waydroid'],
  // Sans IA, on l'appelle par son nom (« état de Valaskjálf ») : le mot « Odin » seul désigne l'assistant, pas le système.
  words: ['valaskjalf', 'valaskjálf', 'systeme d exploitation', 'système d\'exploitation', 'image iso', 'images systeme'],
  actions: [
    { id: 'etat', label: 'État de Valaskjálf', what: 'Odin OS : version, où il tourne, images construites', read: true, words: ['etat', 'état', 'version'], run: async (ctx) => {
      const img = imagesConstruites();
      return { text: [`Odin OS ${VERSION_OS} (base ${BASE_OS.nom}).`, surOdinOS() ? `Cet Odin tourne dans une image Odin OS (${cible()}).` : 'Cet Odin tourne sur sa machine : le bureau s\'ouvre sur /os/ (essai dans le navigateur).', `Docker : ${await ctx.has('docker') ? 'présent' : 'absent'} · LXC : ${await ctx.has('pct') ? 'Proxmox (pct)' : await ctx.has('lxc-create') ? 'lxc-create' : 'absent'}.`, `Terminal du bureau : ${terminalAutorise(chemins(ctx)) ? 'ouvert (vraies commandes)' : 'fermé (commandes d\'Odin seulement)'}.`, img.length ? `Images construites : ${img.map((i) => `${i.fichier} (${taille(i.taille)})`).join(', ')}.` : 'Aucune image construite ici (sudo os/build/images.sh).'].join('\n'), data: { version: VERSION_OS, images: img.length } };
    } },
    { id: 'essayer', label: 'Essayer dans le navigateur', what: 'Donne l\'adresse du bureau Odin OS servi par cet Odin', read: true, words: ['essayer valaskjalf', 'essaie valaskjalf', 'ouvre valaskjalf'], run: () => ({ text: 'Ouvre /os/ sur l\'adresse de cet Odin (par exemple https://localhost:7777/os/). Le bureau s\'affiche avec tes vraies applis d\'Odin. Pour voir l\'écran téléphone : /os/?ecran=mobile. Pour une démonstration sans tes données : /os/?essai.' }) },
    { id: 'docker', label: 'Installer dans Docker', what: 'Crée et démarre un conteneur Odin OS (image construite ou construite depuis le dépôt)', params: [{ key: 'nom', label: 'Nom du conteneur', kind: 'text', default: 'odin-os', required: true }, { key: 'port', label: 'Port du bureau', kind: 'number', default: 7788 }, { key: 'lan', label: 'Ouvrir au réseau local (sinon : cette machine seulement)', kind: 'boolean', default: false }], grave: (i) => `créer et démarrer le conteneur Docker « ${s(i.nom) || 'odin-os'} » (Odin OS)`, words: ['installe valaskjalf sur docker'], undo: (i) => ({ action: 'retirer_docker', input: { nom: s(i.nom) || 'odin-os' }, label: 'Retirer le conteneur' }),
      run: async (ctx, i) => { const r = await installerDocker(outils(ctx), { nom: s(i.nom), port: Number(i.port), lan: i.lan === true || i.lan === 'true' }); return { ok: r.ok, text: r.text }; } },
    { id: 'lxc', label: 'Installer dans LXC', what: 'Crée un conteneur LXC Odin OS (Proxmox ou LXC classique) à partir du modèle construit', params: [{ key: 'nom', label: 'Nom', kind: 'text', default: 'odin-os', required: true }, { key: 'id', label: 'Numéro Proxmox (vide = le prochain libre)', kind: 'number' }, { key: 'stockage', label: 'Stockage Proxmox', kind: 'text', default: 'local-lvm' }, { key: 'pont', label: 'Pont réseau', kind: 'text', default: 'vmbr0' }], grave: (i) => `créer le conteneur LXC « ${s(i.nom) || 'odin-os'} » (Odin OS)`, words: ['installe valaskjalf sur lxc'],
      run: async (ctx, i) => { const r = await installerLxc(outils(ctx), { nom: s(i.nom), id: Number(i.id) || undefined, stockage: s(i.stockage) || undefined, pont: s(i.pont) || undefined }); return { ok: r.ok, text: r.text }; } },
    { id: 'retirer_docker', label: 'Retirer le conteneur Docker', what: 'Arrête et supprime le conteneur (le volume de données est gardé)', quick: false, params: [{ key: 'nom', label: 'Nom du conteneur', kind: 'text', default: 'odin-os', required: true }], grave: (i) => `arrêter et supprimer le conteneur Docker « ${s(i.nom) || 'odin-os'} » (ses données restent dans le volume)`,
      run: async (ctx, i) => { const nom = s(i.nom) || 'odin-os'; if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(nom)) return { ok: false, text: 'Nom invalide.' }; const r = await ctx.run('docker', ['rm', '-f', nom], { timeoutMs: 60_000 }); return r.code === 0 ? { text: `Conteneur ${nom} retiré. Ses données restent dans le volume ${nom}-donnees.` } : { ok: false, text: (r.err || r.out).trim().slice(-300) }; } },
    { id: 'images', label: 'Images construites', what: 'Taille et empreinte SHA-256 de chaque image (os/sortie)', read: true, words: ['images valaskjalf', 'empreintes valaskjalf'], run: () => { const img = imagesConstruites(); return { text: img.length ? img.map((i) => `${i.fichier}\n  ${taille(i.taille)} (${i.taille} octets)\n  SHA-256 : ${i.sha256}`).join('\n') : `Aucune image dans ${DOSSIER_IMAGES}. Pour les construire sur une machine Linux : sudo os/build/images.sh (voir docs/odin-os.md).`, data: { images: img } }; } },
    { id: 'terminal', label: 'Ouvrir ou fermer le terminal', what: 'Autorise (ou non) le Terminal du bureau à lancer de vraies commandes sur cette machine', quick: false, params: [{ key: 'etat', label: 'État', kind: 'select', options: ['fermé', 'ouvert'], default: 'fermé', required: true }], grave: (i) => (s(i.etat) === 'ouvert' ? 'autoriser le Terminal d\'Odin OS à lancer de vraies commandes sur cette machine, avec les droits d\'Odin' : undefined),
      run: (ctx, i) => { const f = fichierTerminal(chemins(ctx)); if (s(i.etat) === 'ouvert') { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, `ouvert le ${new Date().toISOString()}\n`, { mode: 0o600 }); return { text: 'Terminal du bureau ouvert : il lance de vraies commandes sur cette machine.' }; } if (existsSync(f)) rmSync(f); return { text: surOdinOS() ? 'Dans une image Odin OS, le terminal reste ouvert : c\'est le système d\'Odin.' : 'Terminal du bureau fermé : seules les commandes d\'Odin répondent.' }; } },
  ],
  async view(ctx) {
    const img = imagesConstruites(), docker = await ctx.has('docker'), lxc = await ctx.has('pct') || await ctx.has('lxc-create');
    let conteneurs: string[] = [];
    if (docker) { const r = await ctx.run('docker', ['ps', '-a', '--filter', `ancestor=${IMAGE_DOCKER}`, '--format', '{{.Names}}\t{{.Status}}\t{{.Ports}}'], { timeoutMs: 8000 }).catch(() => ({ out: '' })); conteneurs = r.out.split('\n').filter(Boolean); }
    return {
      subtitle: `Odin OS ${VERSION_OS} · base ${BASE_OS.nom} · ${surOdinOS() ? `cet Odin tourne dans une image Odin OS (${cible()})` : 'bureau servi par cet Odin sur /os/'}`,
      kpis: [{ label: 'Version', value: VERSION_OS }, { label: 'Docker', value: docker ? 'présent' : 'absent', tone: docker ? 'bon' : 'neutre' }, { label: 'LXC', value: lxc ? 'présent' : 'absent', tone: lxc ? 'bon' : 'neutre' }, { label: 'Images construites', value: String(img.length) }, { label: 'Terminal du bureau', value: terminalAutorise(chemins(ctx)) ? 'ouvert' : 'fermé' }],
      sections: [
        { kind: 'table', title: 'Où mettre Odin OS', columns: ['Où', 'Comment', 'Ce que tu obtiens'], rows: CIBLES.map((c) => ({ cells: c })) },
        { kind: 'table', title: 'Conteneurs Docker Odin OS', columns: ['Nom', 'État', 'Ports'], empty: docker ? 'Aucun conteneur Odin OS. Bouton « Installer dans Docker ».' : 'Docker n\'est pas installé ici.', rows: conteneurs.map((l) => { const [nom, etat, ports] = l.split('\t'); return { cells: [nom ?? '', etat ?? '', ports ?? ''], tone: /^Up/.test(etat ?? '') ? 'bon' as const : 'neutre' as const, actions: [{ action: 'retirer_docker', label: 'Retirer', input: { nom } }] }; }) },
        { kind: 'table', title: 'Images construites sur cette machine', columns: ['Image', 'Taille', 'SHA-256'], empty: 'Aucune. Sur une machine Linux : sudo os/build/images.sh', rows: img.map((i) => ({ cells: [i.fichier, taille(i.taille), i.sha256] })) },
        { kind: 'text', title: 'Ce qu\'il faut savoir', text: 'Le bureau d\'Odin OS est servi par Odin : c\'est le même partout (navigateur, Docker, LXC, PC, Windows, téléphone). Les applis Linux s\'installent depuis le dépôt Ubuntu. Les applis Windows passent par Wine (pont à installer à la demande), les applis Android par Waydroid (image PC seulement). Les applis iPhone ne sont pas installables. Rien n\'est simulé : ce qui n\'est pas possible à un endroit est dit.' },
      ],
    };
  },
};
