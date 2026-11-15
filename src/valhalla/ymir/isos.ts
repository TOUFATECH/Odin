// Hydre · la bibliothèque d'ISO, commune avec Andromède : un seul « espace ISO » (le dossier d'Andromède, choisi
// dans les réglages), une seule liste vue des deux côtés. Les ISO téléchargées par Andromède y sont déjà ; celles
// que tu importes (envoi depuis le navigateur en morceaux reprenables, lien http(s), dossier ou partage du réseau)
// y sont rangées dans « Importées ». Chaque ISO a sa fiche : système reconnu (Windows, macOS, Linux et sa
// distribution, autre), taille, empreinte SHA-256, date, origine, résultat de l'antivirus. Rien n'entre dans
// l'espace ISO sans être passé par l'antivirus (quarantaine d'abord).
//
// La lecture d'une ISO sans la monter vient de Genèse (thjalfi/iso.ts, thjalfi/recipes.ts) ; les sources
// officielles et le téléchargement reprenable viennent d'Andromède (forge/sources.ts, forge/forge.ts).

import { basename, join, resolve } from 'node:path';
import { Bibliotheque, logoSysteme, prochaineVerif, verifDue, type Fiche, type Genre, type PlanVerif } from '../forge/bibliotheque.ts';
import { ISO as SOURCES_ISO } from '../forge/sources.ts';
import { Iso } from '../thjalfi/iso.ts';
import { detect } from '../thjalfi/recipes.ts';
import type { ModCtx } from '../types.ts';
import { Local } from './local.ts';

export type Systeme = 'Windows' | 'macOS' | 'Linux' | 'Autre';
export interface Reconnu { systeme: Systeme; detail: string; distribution?: string; version?: string; efi?: boolean; pilotes?: boolean }
/** La fiche d'une ISO : la fiche commune de la bibliothèque, avec le système reconnu et les machines qui s'en servent. */
export interface FicheIso extends Fiche { systeme: Systeme | string; detail: string; vms?: string[] }
/** Architecture lue dans le nom. Pur. */
export function archDuNom(nom: string): string | undefined {
  const n = nom.toLowerCase();
  return /aarch64|arm64/.test(n) ? 'arm64' : /amd64|x86_64|x64|64bit|64-bit/.test(n) ? 'x86_64' : /i[3-6]86|x86(?!_64)|32bit/.test(n) ? 'x86 (32 bits)' : undefined;
}
/** Édition lue dans le nom. Pur. */
export function editionDuNom(nom: string): string | undefined {
  const n = nom.toLowerCase();
  const l: Array<[RegExp, string]> = [[/live-server|server/, 'serveur'], [/desktop|workstation|cinnamon|kde|gnome|xfce|mate/, 'bureau'], [/netinst/, 'installation par le réseau'], [/dvd/, 'DVD complet'], [/minimal/, 'minimale'], [/live/, 'live'], [/eval/, 'évaluation'], [/pro\b|professional/, 'Pro'], [/home|famille/, 'Famille'], [/education/, 'Éducation'], [/enterprise|entreprise/, 'Entreprise'], [/standard/, 'standard']];
  return l.find(([re]) => re.test(n))?.[1];
}

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const slash = (p: string) => p.replace(/\\/g, '/');

// ---------------------------------------------------------------- Reconnaître le système d'une ISO
/** D'après le nom du fichier seulement (ISO illisible, ou en complément). Pur. */
export function systemeDuNom(nom: string): Reconnu {
  const n = nom.toLowerCase();
  if (/virtio-?win/.test(n)) return { systeme: 'Autre', detail: 'Pilotes virtio pour Windows', pilotes: true };
  const w = /win(?:dows)?[-_ ]?(1[01]|server[-_ ]?\d{4}|server)/i.exec(nom);
  if (w || /^win|windows/i.test(nom)) return { systeme: 'Windows', detail: w ? `Windows ${w[1].replace(/[-_]/g, ' ').replace(/^server/i, 'Server')}` : 'Windows', version: w?.[1] };
  if (/mac ?os|os ?x|sequoia|sonoma|ventura|monterey|big ?sur|catalina|tahoe/.test(n)) return { systeme: 'macOS', detail: `macOS${/(sequoia|sonoma|ventura|monterey|big ?sur|catalina|tahoe)/.exec(n)?.[1] ? ` ${/(sequoia|sonoma|ventura|monterey|big ?sur|catalina|tahoe)/.exec(n)![1].replace(/^./, (c) => c.toUpperCase())}` : ''}` };
  const src = SOURCES_ISO.find((x) => x.match.test(basename(nom)));
  if (src) { const v = src.match.exec(basename(nom))?.[1]; const sys: Systeme = src.family === 'Windows' ? 'Windows' : src.family === 'Linux' || /proxmox/.test(src.id) ? 'Linux' : 'Autre'; return { systeme: sys, detail: `${src.name.replace(/\s*\(.*\)$/, '')}${v ? ` ${v}` : ''}`, distribution: sys === 'Linux' ? src.name.replace(/\s*\(.*\)$/, '') : undefined, version: v }; }
  const d = /(ubuntu|debian|fedora|linuxmint|mint|archlinux|arch|alpine|rocky|alma(?:linux)?|kali|opensuse|manjaro|centos|nixos|proxmox|pop-os|zorin|elementary)/.exec(n);
  if (d) { const nomD = ({ linuxmint: 'Linux Mint', mint: 'Linux Mint', archlinux: 'Arch Linux', arch: 'Arch Linux', almalinux: 'AlmaLinux', alma: 'AlmaLinux', opensuse: 'openSUSE', 'pop-os': 'Pop!_OS', nixos: 'NixOS', centos: 'CentOS' } as Record<string, string>)[d[1]] ?? d[1].replace(/^./, (c) => c.toUpperCase()); const v = /(\d+(?:\.\d+){0,2})/.exec(n.slice(d.index + d[1].length))?.[1]; return { systeme: 'Linux', detail: `${nomD}${v ? ` ${v}` : ''}`, distribution: nomD, version: v }; }
  if (/linux/.test(n)) return { systeme: 'Linux', detail: 'Linux' };
  return { systeme: 'Autre', detail: 'Système inconnu' };
}

/** Ce que contient une ISO : lue sans la monter (Genèse), puis complétée par son nom. */
export async function systemeIso(chemin: string, nom = basename(chemin)): Promise<Reconnu> {
  const parNom = systemeDuNom(nom);
  let iso: Iso | undefined;
  try {
    iso = await Iso.open(chemin);
    const efi = await iso.exists('efi/boot/bootx64.efi').catch(() => false);
    const label = iso.label;
    if (await iso.exists('sources/install.wim') || await iso.exists('sources/install.esd') || await iso.exists('sources/boot.wim')) {
      return { ...(parNom.systeme === 'Windows' ? parNom : { systeme: 'Windows' as const, detail: /SERVER/i.test(label) ? 'Windows Server' : 'Windows' }), efi };
    }
    if (await iso.exists('System/Library/CoreServices/SystemVersion.plist') || (await iso.list('/').catch(() => [])).some((e) => /^Install (macOS|OS X)/i.test(e.name)) || /mac ?os|os ?x/i.test(label)) {
      return { ...(parNom.systeme === 'macOS' ? parNom : { systeme: 'macOS' as const, detail: 'macOS' }), efi };
    }
    if (/virtio/i.test(label)) return { systeme: 'Autre', detail: 'Pilotes virtio pour Windows', pilotes: true };
    const r = await detect(iso);
    if (r.os === 'linux') {
      if (parNom.systeme === 'Linux') return { ...parNom, efi };
      const dist = r.label.replace(/\s*\(.*\)$/, '').replace(/^Red Hat et compatibles$/, 'Linux');
      return { systeme: 'Linux', detail: `${dist}${r.version ? ` ${r.version}` : ''}`, distribution: dist, version: r.version, efi };
    }
    return { ...(parNom.systeme !== 'Autre' ? parNom : { systeme: 'Autre' as const, detail: r.kind === 'iso' ? (label || 'Système inconnu') : r.label.replace(/\s*\(.*\)$/, '') }), efi };
  } catch { return parNom; } finally { await iso?.close(); }
}

/** Les petits fichiers de démarrage à la racine d'une ISO (autorun, scripts, programmes) : l'antivirus les lit aussi. */
export async function fichiersDeDemarrage(chemin: string): Promise<Array<{ nom: string; donnees: Buffer }>> {
  let iso: Iso | undefined; const out: Array<{ nom: string; donnees: Buffer }> = [];
  try {
    iso = await Iso.open(chemin);
    for (const e of (await iso.list('/')).filter((x) => !x.dir && x.size > 0 && x.size <= 16 * 1024 * 1024 && /\.(inf|exe|com|bat|cmd|ps1|vbs|js|wsf|hta|sh|scr|lnk|msi|dll)$/i.test(x.name)).slice(0, 40)) {
      try { out.push({ nom: e.name, donnees: await iso.file(e.name, 16 * 1024 * 1024) }); } catch { /* fichier illisible : passé */ }
    }
  } catch { /* pas une ISO lisible : l'empreinte et le début du fichier suffisent */ } finally { await iso?.close(); }
  return out;
}

// ---------------------------------------------------------------- Le profil d'une VM selon le système
export interface Hote { ovmf: boolean; swtpm: boolean; kvm: boolean }
export interface Profil { uefi: boolean; tpm: boolean; disque: 'virtio' | 'sata'; reseau: 'virtio' | 'e1000'; pilotes?: string; notes: string[]; avertissement?: string }
/** Ce qu'Hydre règle tout seul selon le système de l'ISO (et ce que ce PC sait faire). Pur. */
export function profilVm(r: { systeme?: string; detail?: string }, h: Hote, pilotes?: string): Profil {
  const notes: string[] = [];
  if (!h.kvm) notes.push('Ce PC n\'a pas KVM : la VM tourne en émulation, beaucoup plus lentement.');
  if (r.systeme === 'Windows') {
    const w11 = /11|server 20(2[2-9])/i.test(r.detail ?? '');
    const p: Profil = { uefi: h.ovmf, tpm: h.swtpm, disque: pilotes ? 'virtio' : 'sata', reseau: pilotes ? 'virtio' : 'e1000', ...(pilotes ? { pilotes } : {}), notes };
    notes.push(h.ovmf ? 'Démarrage UEFI (micrologiciel OVMF).' : 'Pas d\'OVMF sur ce PC : démarrage BIOS ancien (installe le paquet « ovmf » pour l\'UEFI).');
    notes.push(h.swtpm ? 'Puce TPM 2.0 virtuelle (swtpm).' : `Pas de « swtpm » sur ce PC : pas de puce TPM${w11 ? ' — l\'installation de Windows 11 refusera de continuer sans elle' : ''}.`);
    notes.push(pilotes ? `Pilotes virtio (${basename(pilotes)}) ajoutés en second lecteur : disque et réseau rapides (« Charger un pilote » pendant l'installation).` : 'Pas d\'ISO de pilotes virtio dans la bibliothèque : disque SATA et carte réseau e1000, que Windows reconnaît seul (importe « virtio-win.iso » pour aller plus vite).');
    return p;
  }
  if (r.systeme === 'macOS') {
    return { uefi: h.ovmf, tpm: false, disque: 'sata', reseau: 'e1000', notes,
      avertissement: 'macOS dans une machine virtuelle : la licence d\'Apple ne l\'autorise que sur du matériel Apple (un Mac). Sur un autre PC, c\'est contraire à la licence. Techniquement, l\'installation demande aussi un chargeur spécial (OpenCore) qu\'Odin ne fournit pas, et la VM n\'a ni accélération graphique ni iCloud fiable. Hydre crée la machine seulement si tu confirmes que ce PC est un Mac (ou que tu acceptes ces limites).' };
  }
  notes.push(h.ovmf ? 'Démarrage UEFI.' : 'Démarrage BIOS (paquet « ovmf » absent).');
  notes.push('Disque et réseau virtio (pilotes déjà dans Linux).');
  return { uefi: h.ovmf, tpm: false, disque: 'virtio', reseau: 'virtio', notes };
}

// ---------------------------------------------------------------- La bibliothèque (le code commun : forge/bibliotheque.ts)
/** Le genre « ISO » de la bibliothèque commune : reconnaissance par Genèse, fichiers de démarrage lus par l'antivirus. */
export const GENRE_ISO: Genre = {
  id: 'iso', libelle: 'ISO', libelles: 'ISO', motif: /\.iso$/i, importes: 'Importées', journal: 'ymir', fichierJournal: 'isos.jsonl', cleVerif: 'verifIso',
  origine: 'Hydre · ISO', usage: 'créer une machine virtuelle ou installer un PC', appli: 'Hydre',
  reconnaitre: async (chemin, nom) => { const r = await systemeIso(chemin, nom); return { ...r, arch: archDuNom(nom), edition: editionDuNom(nom), icone: logoSysteme(r) }; },
  interieur: (chemin) => fichiersDeDemarrage(chemin),
};
/** L'espace ISO : un seul dossier, celui d'Andromède (réglage partagé, relu par Hydre). */
export const espaceIso = (ctx: ModCtx): string => s(ctx.settings.espaceIso) || join(ctx.home, 'ISO');
export const bibliothequeIso = (ctx: ModCtx) => new Bibliotheque(ctx, GENRE_ISO, espaceIso(ctx));
export const dossierImportees = (ctx: ModCtx) => bibliothequeIso(ctx).importes;
export const dossierArrivees = (ctx: ModCtx) => bibliothequeIso(ctx).arrivees;

/** Toute la bibliothèque d'ISO (Andromède, importées, déposées à la main, anciennes dans « old »), avec les machines qui s'en servent. */
export async function bibliotheque(ctx: ModCtx): Promise<FicheIso[]> {
  const l = (await bibliothequeIso(ctx).liste()) as FicheIso[];
  const machines = (() => { try { return new Local(ctx).list(); } catch { return []; } })();
  for (const f of l) {
    f.systeme ??= 'Autre'; f.detail ??= ''; f.icone ??= logoSysteme(f);
    f.vms = machines.filter((m) => m.iso && slash(resolve(m.iso)) === slash(resolve(f.chemin))).map((m) => m.nom); f.utilisePar = f.vms;
  }
  return l;
}
export const sansFiche = (ctx: ModCtx) => bibliothequeIso(ctx).sansFiche();
export const noterFiche = (ctx: ModCtx, f: FicheIso): FicheIso => bibliothequeIso(ctx).noter(f) as FicheIso;
export async function trouverIso(ctx: ModCtx, q: unknown): Promise<FicheIso> { const f = await bibliothequeIso(ctx).trouver(q); return (await bibliotheque(ctx)).find((x) => x.chemin === f.chemin) ?? (f as FicheIso); }
export const pilotesVirtio = (l: FicheIso[]): string | undefined => l.find((x) => x.pilotes || /virtio-?win/i.test(x.nom))?.chemin;
export const importerIso = (ctx: ModCtx, src: string, o: Parameters<Bibliotheque['importer']>[1]) => bibliothequeIso(ctx).importer(src, o);
export const importerLien = (ctx: ModCtx, lien: string, nom?: string) => bibliothequeIso(ctx).importerLien(lien, nom);
export const retirerIso = (ctx: ModCtx, q: unknown) => bibliothequeIso(ctx).retirer(q);
export const planVerif = (ctx: ModCtx): PlanVerif => bibliothequeIso(ctx).plan();
export const comptesRendus = (ctx: ModCtx, n = 20) => bibliothequeIso(ctx).comptesRendus(n);
export { prochaineVerif, verifDue, type PlanVerif };
/** Vérifie toutes les ISO (empreinte, antivirus) et demande à Andromède s'il y a de nouvelles versions. */
export async function verifierIsos(ctx: ModCtx) {
  return bibliothequeIso(ctx).verifier(async () => { const r = await ctx.call('eitri', 'verifier', {}, 'vérification des ISO : nouvelles versions', { interne: true }); return r.text.split('\n').filter((x) => x.startsWith('🆕')).join('\n'); });
}

/** Andromède a rangé une ancienne version dans « old » (ou l'a supprimée) : les machines qui la citent suivent. */
export function isoDeplacee(ctx: ModCtx, l: Array<{ de: string; vers: string; nouveau: string }>): string[] {
  const L = new Local(ctx), B = bibliothequeIso(ctx), out: string[] = [];
  for (const d of l) {
    for (const m of L.list().filter((x) => x.iso && slash(resolve(x.iso)) === slash(resolve(d.de)))) {
      m.iso = d.vers || d.nouveau; L.update(m);
      out.push(d.vers ? `${m.nom} : son ISO a été rangée dans « old » (${d.vers}) ; la machine la retrouve là. Nouvelle version : ${basename(d.nouveau)}.` : `${m.nom} : l'ancienne ISO a été supprimée ; la machine cite maintenant ${basename(d.nouveau)} (déjà installée, rien ne change pour elle).`);
    }
    B.deplacee(d.de, d.vers);
  }
  if (out.length) ctx.alert({ level: 'info', title: 'Hydre : ISO remplacée par une nouvelle version', detail: out.join('\n'), key: `iso-old-${Date.now()}` });
  return out;
}
