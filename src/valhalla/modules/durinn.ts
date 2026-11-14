// Tirésias — la santé et la vitesse des disques (les idées de CrystalDiskInfo et de CrystalDiskMark, code maison).
// Santé : chaque disque (disque dur, SSD, NVMe, USB) est lu par « smartctl » ; Odin en tire un état en clair (Bon,
// Attention, Mauvais) avec la raison, explique chaque valeur SMART, garde un relevé par jour et prévient quand ça se
// dégrade (sauvegarder d'abord, remplacer ensuite). Vitesse : lecture et écriture séquentielles et aléatoires, dans
// un fichier de test seulement, résultats gardés et comparés dans le temps.
// Tirésias ne répare rien et n'écrit jamais sur un disque brut : il lit, il mesure, il prévient.
// Hygie garde le résumé des disques de la machine ; ici, le détail d'un disque et son histoire.
import { hostname } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { findMachine, listMachines, sudoRefused } from '../../machines/access.ts';
import { appeler, cleDisque, genreDit, juger, lireScan, lireSmart, mesures, motEtat, nomCourt, pourquoiInconnu, SEUILS, taille, versionDe, type Disque, type Etat, type Seuils } from '../durinn/smart.ts';
import { alertesDe, courbe, ecrireDernier, ecrireSuivi, jourDit, lireDernier, lireSuivi, listerSuivis, noter, oublierSuivi, tendanceDe, type Conseil } from '../durinn/suivi.ts';
import { ajouterResultat, controler, estimation, lireResultats, menage, mesurerDistant, mesurerIci, moS, precedent, ranger, reservesDuLieu, TAILLE_DEFAUT, TAILLES, tailleFichier, texte as texteVitesse, volumeDe, volumes, type Resultat } from '../durinn/vitesse.ts';
import { choixDePoste, estIci, PARAM_POSTE, posteDe, type Poste } from '../postes.ts';
import type { ModCtx, Module, Section, Tone } from '../types.ts';
import { lireLsblk, type Disque as Bloc } from './fensalir.ts';

const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x)).trim();
const lire = (f: string) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const TON: Record<Etat, Tone> = { bon: 'bon', attention: 'attention', mauvais: 'mauvais', inconnu: 'neutre' };
const PASTILLE: Record<Etat, string> = { bon: '🟢', attention: '🟠', mauvais: '🔴', inconnu: '⚪' };
/** Où chercher smartctl : il est souvent rangé dans un dossier que seul l'administrateur a dans son chemin. */
const OU = ['smartctl', '/usr/sbin/smartctl', '/usr/local/sbin/smartctl', '/sbin/smartctl', '/opt/homebrew/bin/smartctl', '/opt/homebrew/sbin/smartctl', '/usr/local/bin/smartctl'];
const TROUVER = `for p in ${OU.join(' ')}; do if command -v "$p" >/dev/null 2>&1; then echo "$p"; exit 0; fi; done; exit 1`;
const INSTALLER = 'Installe le paquet « smartmontools » : sudo apt install smartmontools (Debian, Ubuntu, Proxmox), sudo dnf install smartmontools (Fedora), brew install smartmontools (Mac).';
/** Les types de boîtier USB que smartctl sait forcer (option -d), pour un boîtier qu'il ne reconnaît pas tout seul. */
const BOITIERS = ['automatique', 'sat', 'usbjmicron', 'usbprolific', 'usbsunplus', 'usbcypress', 'sntasmedia', 'sntjmicron', 'sntrealtek'];
const RELIRE_APRES = 30 * 60_000;

/** Ce qu'on sait des disques d'un poste à un moment. `panne` : ce qui empêche de lire, dit en clair. */
export interface Lecture { quand: string; poste: string; nomPoste: string; version?: string; panne?: { quoi: 'absent' | 'ancien' | 'muet' | 'windows'; texte: string }; disques: Disque[] }
const memo = new Map<string, Lecture>(), enLecture = new Map<string, Promise<Lecture>>(), essais = new Map<string, number>();
interface Test { poste: string; nomPoste: string; dossier: string; octets: number; debut: number; estimeS: number; etape: string; stop: AbortController; fin: Promise<Resultat> }
const tests = new Map<string, Test>();
const cle = (ctx: ModCtx, poste: string) => `${ctx.dir}|${poste}`;
const seuils = (ctx: ModCtx): Seuils => { const x = (ctx.settings.seuils ?? {}) as Partial<Seuils>; return { hdd: { ...SEUILS.hdd, ...x.hdd }, ssd: { ...SEUILS.ssd, ...x.ssd }, nvme: { ...SEUILS.nvme, ...x.nvme } }; };

// ---------------- Les liens avec les autres applis ----------------
/** L'appli de récupération (Hel), si elle est installée : son nom, et l'action qui ouvre un disque chez elle. */
function recuperation(ctx: ModCtx): { nom: string; action?: string } | undefined {
  const m = ctx.modules().find((x) => x.id === 'hel'); if (!m) return undefined;
  const a = m.actions.find((x) => x.id === 'ouvrir') ?? m.actions.find((x) => x.read && !x.grave && (x.params ?? []).some((p) => p.key === 'disque'));
  return { nom: m.name, ...(a ? { action: a.id } : {}) };
}
/** Le premier plan de sauvegarde de Phénix (s'il y en a un) : c'est lui que l'alerte propose de lancer. */
async function planPhenix(ctx: ModCtx): Promise<string | undefined> {
  if (!ctx.modules().some((m) => m.id === 'sindri')) return undefined;
  const r = await ctx.call('sindri', 'plans', {}, 'un disque se dégrade : y a-t-il un plan de sauvegarde à lancer ?').catch(() => undefined);
  return r && r.ok !== false ? /^- (.+?) : /m.exec(r.text)?.[1] : undefined;
}
/** Ce que chaque alerte dit de faire : sauvegarder d'abord, remplacer ensuite ; et le bouton qui lance la sauvegarde. */
async function conseil(ctx: ModCtx, poste: Poste): Promise<Conseil> {
  const plan = poste.local ? await planPhenix(ctx) : undefined, phenix = ctx.modules().find((m) => m.id === 'sindri')?.name ?? 'Phénix', rec = recuperation(ctx);
  return {
    ...(poste.local ? {} : { ou: poste.nom, poste: poste.nom }),
    etapes: [
      poste.local ? (plan ? `Sauvegarde tout de suite ce qui compte sur ce disque (${phenix} : « Sauvegarder maintenant », plan « ${plan} »).` : `Sauvegarde tout de suite ce qui compte sur ce disque, vers un AUTRE disque (${phenix} : crée un plan de sauvegarde).`) : `Sauvegarde tout de suite ce qui compte sur ce disque de ${poste.nom}, vers un autre disque ou une autre machine.`,
      'Commande un disque de remplacement : n\'attends pas la panne.',
      'Remplace le disque, puis remets tes fichiers depuis la sauvegarde.',
      ...(rec ? [`Des fichiers déjà illisibles ? ${rec.nom} peut tenter de les récupérer : fais-le avant de trop solliciter le disque.`] : []),
    ],
    ...(plan ? { fix: { module: 'sindri', action: 'sauvegarder', label: 'Sauvegarder maintenant', input: { plan } } } : {}),
  };
}
/** Le type « disque » dans l'inventaire s'il existe, sinon « autre ». */
function typeInventaire(ctx: ModCtx): string | undefined {
  const a = ctx.modules().find((m) => m.id === 'askr')?.actions.find((x) => x.id === 'ajouter'); if (!a) return undefined;
  return a.params?.find((p) => p.key === 'type')?.options?.includes('disque') ? 'disque' : 'autre';
}
/** La fiche d'un disque dans l'inventaire (Atlas) : modèle, numéro de série, taille, machine. `interne` : c'est toi qui le demandes. */
async function inventorier(ctx: ModCtx, d: Disque, poste: Poste, interne: boolean): Promise<{ ok: boolean; text: string }> {
  const type = typeInventaire(ctx); if (!type) return { ok: false, text: 'L\'inventaire (Atlas) n\'est pas installé.' };
  if (!d.serie) return { ok: false, text: `${appeler(d)} ne donne pas de numéro de série : je ne peux pas le suivre dans l'inventaire.` };
  const ou = poste.local ? hostname() : poste.nom, fabricant = (d.famille ?? d.modele ?? '').split(/\s+/)[0] ?? '';
  const r = await ctx.call('askr', 'ajouter', { nom: `Disque ${d.modele ?? d.nom}${d.taille ? ` ${taille(d.taille)}` : ''}`.slice(0, 80), type, fabricant: /^\d/.test(fabricant) ? '' : fabricant, modele: d.modele ?? '', serie: d.serie, notes: `${genreDit(d)}${d.taille ? ` de ${taille(d.taille)}` : ''}, dans ${ou} (${d.nom}). Santé suivie par Tirésias.` }, `disque vu par Tirésias dans ${ou}`, interne ? { interne: true } : undefined).catch((e) => ({ ok: false, text: (e as Error).message }));
  return { ok: r.ok !== false || /déjà dans l'inventaire/.test(r.text), text: r.ok !== false ? r.text : /déjà dans l'inventaire/.test(r.text) ? `${appeler(d)} est déjà dans l'inventaire.` : r.text };
}

// ---------------- Lire les disques d'un poste ----------------
const blocDe = (nom: string, blocs: Bloc[]) => blocs.find((b) => b.nom === nom) ?? blocs.find((b) => /^nvme\d+$/.test(nom) && b.nom.startsWith(`${nom}n`));
/**
 * Lit tous les disques d'un poste (la machine d'Odin, ou un poste Linux ou Mac par SSH), range chaque lecture dans
 * l'historique et lève les alertes. `veille` : ne pas réveiller un disque qui dort (lecture de surveillance).
 */
async function lirePoste(ctx: ModCtx, poste: Poste, o: { veille?: boolean } = {}): Promise<Lecture> {
  const now = ctx.now(), pk = poste.id || 'ici', l: Lecture = { quand: now.toISOString(), poste: poste.id, nomPoste: poste.local ? 'cette machine' : poste.nom, disques: [] };
  const finir = (x: Lecture) => { memo.set(cle(ctx, poste.id), x); try { ecrireDernier(ctx.dir, pk, x); } catch { /* disque plein : la lecture reste en mémoire */ } return x; };
  const ici = poste.local ? 'sur cette machine' : `sur ${poste.nom}`;
  if (poste.local && process.platform === 'win32') return finir({ ...l, panne: { quoi: 'windows', texte: 'Sur Windows, Odin ne lit pas encore la santé des disques. Sur le PC lui-même, CrystalDiskInfo le fait très bien.' } });
  const t = await poste.run('sh', ['-c', TROUVER], { timeoutMs: 15_000 }), vu = t.out.trim().split('\n')[0]?.trim() ?? '', bin = OU.includes(vu) ? vu : 'smartctl';
  if (t.code !== 0) return finir({ ...l, panne: { quoi: 'absent', texte: `smartctl n'est pas installé ${ici} : c'est lui qui lit la santé que chaque disque tient sur lui-même. ${poste.local ? INSTALLER : `Installe-le sur ${poste.nom} : sudo apt install smartmontools (ou l'équivalent de son système).`}` } });
  // Lire un disque demande les droits d'administrateur ; s'ils sont refusés, on essaie sans (certains comptes y ont droit).
  let sudo = true;
  const lancer = async (args: string[], timeoutMs = 25_000) => { let r = await poste.run(bin, args, { sudo, timeoutMs }); if (sudo && sudoRefused(`${r.err}\n${r.out}`)) { sudo = false; r = await poste.run(bin, args, { timeoutMs }); } return r; };
  const scan = await lancer(['--scan', '--json']), version = versionDe(scan.out);
  if (!version) {
    const v = await lancer(['--version']), m = /smartctl (\d+)\.(\d+)/.exec(v.out);
    if (m && Number(m[1]) < 7) return finir({ ...l, panne: { quoi: 'ancien', texte: `smartctl ${m[1]}.${m[2]} est trop ancien ${ici} : il faut la version 7.0 ou plus (sortie fin 2018). Mets à jour le paquet « smartmontools ».` } });
    const err = `${scan.err} ${v.err}`.trim().split('\n').at(-1)?.slice(0, 160) ?? '';
    return finir({ ...l, panne: { quoi: 'muet', texte: `smartctl n'a pas répondu comme prévu ${ici}${err ? ` (${err})` : ''}. ${!sudo ? 'Odin n\'a pas les droits d\'administrateur : lance-le en administrateur, ou donne-lui le mot de passe (Réglages → Droits et machines).' : 'Vérifie qu\'il se lance bien : « smartctl --scan ».'}` } });
  }
  l.version = version;
  const blocs = (await poste.systeme()) === 'linux' ? lireLsblk((await poste.run('lsblk', ['-J', '-b', '-o', 'NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL,SERIAL,ROTA,TRAN,RM,LABEL'], { timeoutMs: 10_000 }).catch(() => ({ code: 1, out: '', err: '' }))).out) : [];
  const forces = (ctx.settings.boitiers ?? {}) as Record<string, string>, limites = seuils(ctx), avant = memo.get(cle(ctx, poste.id)) ?? lireDernier<Lecture>(ctx.dir, pk);
  // Quoi faire et quel bouton proposer : demandé aux autres applis seulement s'il y a une alerte à lever.
  let dit: Conseil | undefined; const SANS: Conseil = { etapes: [] }, pris = new Set<string>();
  for (const dev of lireScan(scan.out).slice(0, 24)) {
    const nom = nomCourt(dev.chemin, /,/.test(dev.type) ? dev.type : undefined), bloc = blocDe(nomCourt(dev.chemin), blocs), usb = bloc?.transport === 'usb';
    if (bloc) pris.add(bloc.nom);
    const force = forces[bloc?.serie || nom], deScan = /^(scsi|sat|ata|nvme|auto|)$/.test(dev.type) ? undefined : dev.type;
    const essai = async (type: string | undefined) => { const r = await lancer(['--json=c', usb ? '-a' : '-x', ...(o.veille ? ['-n', 'standby'] : []), ...(type ? ['-d', type] : []), dev.chemin]); return { brut: r.out, d: lireSmart(r.out, { chemin: dev.chemin, type, seuils: limites, veille: o.veille }) }; };
    let { brut, d } = await essai(force ?? deScan);
    // Boîtier USB inconnu de smartctl : la plupart parlent quand même le langage « SAT » ; sinon on garde au moins son identité.
    if (!force && d.smart === 'non' && /Unknown USB bridge/i.test(brut)) {
      const sat = await essai('sat');
      if (sat.d.smart !== 'non') d = sat.d; else { const scsi = await essai('scsi'); if (scsi.d.modele) d = { ...scsi.d, type: undefined, messages: d.messages, usb: true, genre: 'inconnu' }; }
    }
    d.nom = nom; if (usb) d.usb = true;
    if (bloc) { d.taille ??= bloc.taille || undefined; d.modele ??= bloc.modele; d.serie ??= bloc.serie; if (d.genre === 'inconnu' && d.smart === 'oui') d.genre = bloc.ssd ? 'SSD' : 'disque dur'; }
    // Un disque qui dort n'a pas été réveillé : on montre sa dernière lecture, en le disant.
    if (d.enVeille) { const vieux = avant?.disques.find((x) => x.chemin === d.chemin && x.smart === 'oui'); l.disques.push(vieux ? { ...vieux, enVeille: true } : { ...d, smart: 'non' }); continue; }
    if (d.smart === 'oui') {
      const k = cleDisque(d), ancien = lireSuivi(ctx.dir, pk, k);
      const tendance = tendanceDe(ancien?.releves ?? [], { r: d.realloues, p: d.attente, i: d.illisibles, c: d.crc, me: d.erreursMedia }, now);
      if (tendance) { const v = juger(d, tendance); d.etat = v.etat; d.raisons = v.raisons; }
      const n = noter(ancien, d, now); let a = alertesDe(d, n.avant, n.suivi, now, SANS);
      if (a.alertes.length) a = alertesDe(d, n.avant, n.suivi, now, dit ??= await conseil(ctx, poste));
      n.suivi.rappels = a.rappels;
      // Un nouveau disque fixe prend sa fiche dans l'inventaire, une seule fois (jamais recréée si tu la supprimes).
      if (!n.suivi.inventorie && d.serie && !d.usb && typeInventaire(ctx)) { n.suivi.inventorie = true; void inventorier(ctx, d, poste, false).catch(() => undefined); }
      try { ecrireSuivi(ctx.dir, pk, n.suivi); } catch { /* disque plein : pas d'historique cette fois */ }
      for (const x of a.alertes) ctx.alert(x);
      if (n.avant && n.avant.e !== d.etat) ctx.emit('etat_disque', { disque: d.nom, modele: d.modele ?? '', etat: d.etat, avant: n.avant.e, poste: poste.local ? '' : poste.nom });
    }
    l.disques.push(d);
  }
  // Les disques que smartctl ne voit pas (virtuels, cartes mémoire) : montrés, sans état de santé.
  for (const b of blocs) {
    if (pris.has(b.nom) || !(b.taille > 0) || l.disques.length >= 32) continue;
    const d = lireSmart('', { chemin: `/dev/${b.nom}` }); d.messages = []; d.taille = b.taille; if (b.modele) d.modele = b.modele; if (b.serie) d.serie = b.serie; d.usb = b.transport === 'usb';
    l.disques.push(d);
  }
  // Un disque fixe suivi jusque-là et qui ne répond plus du tout : débranché, ou en panne.
  // (Pas de conclusion tant qu'un disque dort sans qu'on sache lequel c'est.)
  if (l.disques.some((d) => d.smart === 'oui') && !l.disques.some((d) => d.enVeille && d.smart !== 'oui')) {
    const presents = new Set(l.disques.filter((d) => d.smart === 'oui').map((d) => cleDisque(d)));
    for (const sv of listerSuivis(ctx.dir, pk)) {
      if (presents.has(sv.cle) || sv.usb || !sv.serie || sv.disparu || now.getTime() - Date.parse(sv.vu) > 30 * 86_400_000) continue;
      ctx.alert({ level: 'haute', title: `Disque ${appeler(sv)}${poste.local ? '' : ` sur ${poste.nom}`} : il ne répond plus`, detail: `Il répondait encore le ${jourDit(sv.vu.slice(0, 10), now)}. Si tu l'as retiré exprès, tout va bien (« Oublier un disque » le retire du suivi). Sinon il est débranché ou en panne.`, key: `disparu:${sv.cle}`, steps: ['Vérifie que le disque est bien branché (câble de données et alimentation).', 'S\'il ne revient pas : il est sans doute en panne. Remets tes fichiers depuis la sauvegarde sur un disque neuf.', ...(recuperation(ctx) ? [`Pas de sauvegarde ? ${recuperation(ctx)!.nom} peut tenter une récupération.`] : [])], data: { cle: sv.cle } });
      try { ecrireSuivi(ctx.dir, pk, { ...sv, disparu: now.toISOString() }); } catch { /* disque plein */ }
    }
  }
  return finir(l);
}
/** Une seule lecture à la fois par poste : une deuxième demande attend la première. */
function relire(ctx: ModCtx, poste: Poste, o: { veille?: boolean } = {}): Promise<Lecture> {
  const k = cle(ctx, poste.id), deja = enLecture.get(k); if (deja) return deja;
  const p = lirePoste(ctx, poste, o).finally(() => { enLecture.delete(k); });
  enLecture.set(k, p); return p;
}
/** Ce que la page montre : la dernière lecture si elle a moins d'une demi-heure, sinon une lecture fraîche (attendue un court instant). */
async function connu(ctx: ModCtx, poste: Poste): Promise<{ l?: Lecture; enCours: boolean; erreur?: string }> {
  const k = cle(ctx, poste.id), l = memo.get(k) ?? lireDernier<Lecture>(ctx.dir, poste.id || 'ici');
  if (l && ctx.now().getTime() - Date.parse(l.quand) < RELIRE_APRES && ctx.now().getTime() >= Date.parse(l.quand)) return { l, enCours: enLecture.has(k) };
  let erreur: string | undefined;
  const fraiche = relire(ctx, poste, { veille: true }).catch((e) => { erreur = (e as Error).message; return undefined; });
  const r = await Promise.race([fraiche, new Promise<'tard'>((ok) => setTimeout(() => ok('tard'), poste.local ? 1500 : 6000).unref())]);
  if (r === 'tard') return { ...(l ? { l } : {}), enCours: true };
  return { ...(r ?? l ? { l: r ?? l } : {}), enCours: false, ...(erreur ? { erreur } : {}) };
}
/** Le disque désigné : par son nom (« sda », « /dev/sda »), son numéro de série ou un bout de son modèle. Pur. */
export function trouver(disques: Disque[], quoi: string): Disque | undefined {
  const q = quoi.trim().toLowerCase().replace(/^\/dev\//, ''); if (!q) return undefined;
  // « sda1 » désigne le disque « sda », « nvme0n1 » ou « nvme0n1p2 » le disque « nvme0 ».
  const noms = new Set([q, q.replace(/^(nvme\d+)n\d+(p\d+)?$/, '$1'), /^(sd|hd|vd|xvd)[a-z]+\d+$/.test(q) ? q.replace(/\d+$/, '') : q]);
  return disques.find((d) => noms.has(d.nom.toLowerCase()) || cleDisque(d).toLowerCase() === q || d.serie?.toLowerCase() === q)
    ?? (q.length >= 3 ? disques.find((d) => (d.modele ?? '').toLowerCase().includes(q)) : undefined);
}
/** Le poste demandé ; un PC Windows joint par son partage est refusé avec une explication propre à cette appli. */
function posteVoulu(ctx: ModCtx, qui: unknown): Poste {
  if (!estIci(qui)) { const m = findMachine(ctx.home, s(qui)); if (m?.via === 'smb') throw new Error(`${m.label} est un poste Windows joint par son partage de fichiers : la santé d'un disque ne se lit pas à travers un partage, il faut un programme sur le PC lui-même (CrystalDiskInfo, par exemple). Tirésias lit les postes Linux et Mac, par SSH`); }
  return posteDe(ctx, qui);
}
/** Le disque à montrer en détail : celui qu'on a ouvert, sinon le plus mal en point, sinon le premier. */
function ouvert(ctx: ModCtx, l: Lecture | undefined): Disque | undefined {
  const liste = (l?.disques ?? []).filter((d) => d.smart === 'oui'); if (!liste.length) return undefined;
  const o = ctx.settings.ouvert as { poste?: string; disque?: string } | undefined, voulu = o && (o.poste ?? '') === (l?.poste ?? '') ? liste.find((d) => cleDisque(d) === o.disque || d.nom === o.disque) : undefined;
  const rang: Record<Etat, number> = { mauvais: 0, attention: 1, bon: 2, inconnu: 3 };
  return voulu ?? [...liste].sort((a, b) => rang[a.etat] - rang[b.etat])[0];
}
const quand = (iso: string, now: Date) => { const min = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000)); return min < 2 ? 'à l\'instant' : min < 90 ? `il y a ${min} min` : min < 48 * 60 ? `il y a ${Math.round(min / 60)} h` : `le ${jourDit(iso.slice(0, 10), now)}`; };
/** Une ligne par disque, pour la discussion. Pur. */
function ligneDisque(d: Disque): string[] {
  const tete = `${PASTILLE[d.etat]} ${d.nom}${d.modele ? ` · ${d.modele}` : ''}${d.taille ? ` ${taille(d.taille)}` : ''} (${genreDit(d)})`;
  if (d.smart !== 'oui' && !d.enVeille) return [`${tete} : ${pourquoiInconnu(d)}`];
  return [`${tete} : ${motEtat(d.etat)}${d.enVeille ? ' (il dort : dernière lecture)' : ''}${mesures(d) ? ` · ${mesures(d)}` : ''}`, ...d.raisons.map((r) => `   → ${r.texte}`)];
}
const PRUDENCE = 'Bon veut dire : rien d\'anormal dans ce que le disque déclare. Un disque peut quand même tomber en panne d\'un coup : garde toujours une sauvegarde.';

// ---------------- Le test de vitesse ----------------
function lancerTest(ctx: ModCtx, poste: Poste, o: { dossier: string; octets: number; dureeMs: number }): Test {
  const k = cle(ctx, ''), stop = new AbortController(), debut = Date.now(), nomPoste = poste.local ? 'cette machine' : poste.nom;
  const t: Test = { poste: poste.id, nomPoste, dossier: o.dossier, octets: o.octets, debut, estimeS: poste.local ? estimation(o.octets, o.dureeMs) : Math.round(o.octets / 30e6) + 10, etape: 'préparation', stop, fin: undefined as unknown as Promise<Resultat> };
  const faire = async (): Promise<Resultat> => {
    const base = { id: debut.toString(36), quand: ctx.now().toISOString(), poste: poste.id, nomPoste, octets: o.octets };
    let r: Resultat;
    if (poste.local) {
      const x = await mesurerIci({ dossier: o.dossier, octets: o.octets, dureeMs: o.dureeMs, registre: join(ctx.dir, 'test-en-cours.json'), signal: stop.signal, surEtape: (e) => { t.etape = e.rang ? `mesure ${e.rang} sur ${e.sur} : ${e.texte}` : e.texte; } });
      const v = volumeDe(o.dossier, lire('/proc/mounts')), reserves = reservesDuLieu(o.dossier), mes = ranger(x.lignes);
      if (!x.direct) reserves.unshift('Lecture faussée par le cache : dans ce dossier, le système garde les données en mémoire, et la lecture mesurée est surtout celle de la mémoire. L\'écriture, elle, est réelle (chaque mesure attend que tout soit sur le disque).');
      if ((mes.rnd4k_q32?.lecture?.acces ?? 0) > 80_000 || (mes.rnd4k_q32?.ecriture?.acces ?? 0) > 80_000) reserves.push('Disque très rapide : au-delà d\'environ 100 000 accès par seconde, c\'est Odin qui limite la mesure, pas le disque.');
      r = { ...base, dossier: o.dossier, ...(v ? { volume: `${v.source} monté sur ${v.point}` } : {}), dureeS: x.dureeS, direct: x.direct, reserves, ...(x.remplissage ? { remplissage: x.remplissage } : {}), mesures: mes };
    } else {
      t.etape = 'écriture puis lecture d\'un fichier de test sur le poste';
      const x = await mesurerDistant(poste, { dossier: o.dossier, mo: Math.round(o.octets / (1024 * 1024)) }), e = x.lu.ecriture!, lu = x.lu.lecture!;
      r = { ...base, dossier: x.lu.dossier || o.dossier, dureeS: x.dureeS, direct: e.mode === 'direct' && lu.mode === 'direct', reserves: x.reserves, partiel: true, mesures: { seq1m_q1: { lecture: { moS: lu.moS, acces: lu.moS, latMs: 0 }, ecriture: { moS: e.moS, acces: e.moS, latMs: 0 } } } };
    }
    ajouterResultat(ctx.dir, r);
    return r;
  };
  t.fin = faire().finally(() => { if (tests.get(k) === t) tests.delete(k); });
  tests.set(k, t);
  return t;
}
const texteTest = (ctx: ModCtx, r: Resultat) => texteVitesse(r, precedent(lireResultats(ctx.dir), r));

export const durinn: Module = {
  id: 'durinn', name: 'Tirésias', family: 'Machines',
  what: 'La santé et la vitesse des disques : chaque disque (disque dur, SSD, NVMe, USB) avec son état en clair (Bon, Attention, Mauvais) et la raison, sa température, ses heures, son usure, toutes ses valeurs SMART expliquées, un historique avec alerte quand ça se dégrade, et un test de vitesse dans un fichier de test.',
  does: ['état de chaque disque en clair : Bon, Attention ou Mauvais, avec la raison', 'température, heures de marche, allumages, secteurs réalloués, en attente et illisibles, usure du SSD, quantité écrite', 'toutes les valeurs SMART expliquées en français simple : ce que c\'est, si c\'est grave', 'disques SATA, NVMe, SAS, et disques en USB (boîtiers reconnus ou réglés à la main)', 'un relevé par jour et par disque, plus un à chaque changement ; courbes de température, d\'usure et de secteurs réalloués', 'alerte quand ça se dégrade : secteurs qui montent, test SMART en échec, surchauffe, usure à 80 % puis 90 %, avertissement critique NVMe, disque qui ne répond plus', 'chaque alerte dit quoi faire : sauvegarder d\'abord (Phénix), remplacer ensuite', 'test de vitesse : lecture et écriture séquentielles et aléatoires 4 Ko, avec un ou plusieurs accès en parallèle, dans un fichier de test seulement (jamais sur le disque brut), effacé à la fin', 'résultats de vitesse gardés et comparés dans le temps (tableau et courbes)', 'les disques d\'un autre poste Linux ou Mac, par SSH, et leur surveillance régulière'],
  from: ['CrystalDiskInfo', 'CrystalDiskMark'], upstream: ['hiyohiyo/CrystalDiskInfo', 'hiyohiyo/CrystalDiskMark', 'smartmontools/smartmontools'],
  words: ['santé du disque', 'sante du disque', 'santé des disques', 'sante des disques', 'santé du ssd', 'sante du ssd', 'santé de mon disque', 'sante de mon disque', 'santé de mes disques', 'sante de mes disques', 'valeurs smart', 'attributs smart', 'smartctl', 'secteurs réalloués', 'secteurs realloues', 'secteurs défectueux', 'secteurs defectueux', 'usure du ssd', 'usure du disque', 'température du disque', 'temperature du disque', 'température des disques', 'temperature des disques', 'historique du disque', 'historique des disques', 'vitesse du disque', 'vitesse des disques', 'vitesse du ssd', 'vitesse de mon disque', 'crystaldiskinfo', 'crystaldiskmark', 'arrête le test de vitesse', 'arrete le test de vitesse'],
  actions: [
    { id: 'sante', label: 'Santé des disques', what: 'Relit maintenant chaque disque et dit son état : Bon, Attention ou Mauvais, avec la raison (de cette machine, ou d\'un autre poste Linux ou Mac)', read: true, external: true, params: [{ key: 'disque', label: 'Disque (vide : tous)', kind: 'text', default: '' }, PARAM_POSTE], words: ['santé du disque', 'santé des disques', 'santé du ssd', 'santé de mon disque', 'santé de mes disques', 'température du disque', 'température des disques', 'usure du ssd', 'usure du disque', 'secteurs réalloués', 'secteurs défectueux'], run: async (ctx, i) => {
      const poste = posteVoulu(ctx, i.poste), l = await relire(ctx, poste);
      if (l.panne) return { ok: false, text: l.panne.texte, data: { panne: l.panne.quoi } };
      const un = s(i.disque) ? trouver(l.disques, s(i.disque)) : undefined;
      if (s(i.disque) && !un) return { ok: false, text: `Je ne trouve pas le disque « ${s(i.disque).slice(0, 60)} » ${poste.local ? 'sur cette machine' : `sur ${poste.nom}`}. Disques vus : ${l.disques.map((d) => d.nom).join(', ') || 'aucun'}.` };
      const liste = un ? [un] : l.disques, lus = liste.filter((d) => d.smart === 'oui');
      if (!liste.length) return { text: `Aucun disque trouvé ${poste.local ? 'sur cette machine' : `sur ${poste.nom}`}.`, data: { poste: l.nomPoste, disques: [] } };
      const virtuel = !lus.length && liste.every((d) => /^(vd|xvd)/.test(d.nom));
      return { text: [`Santé des disques · ${l.nomPoste}`, ...liste.flatMap(ligneDisque), virtuel ? 'Cette machine est virtuelle : ses disques n\'ont pas de SMART. Leur santé se lit sur la machine qui l\'héberge (ajoute-la comme poste pour la lire d\'ici).' : lus.length ? PRUDENCE : ''].filter(Boolean).join('\n'),
        data: { poste: l.nomPoste, disques: liste.map((d) => ({ nom: d.nom, modele: d.modele, serie: d.serie, genre: d.genre, taille: d.taille, etat: d.etat, raisons: d.raisons.map((r) => r.texte), temperature: d.temperature, heures: d.heures, allumages: d.allumages, realloues: d.realloues, attente: d.attente, illisibles: d.illisibles, usure: d.usure, ecrit: d.ecrit })) } };
    } },
    { id: 'smart', label: 'Valeurs SMART d\'un disque', what: 'Toutes les valeurs qu\'un disque tient sur lui-même, chacune expliquée : ce que c\'est, si c\'est grave', read: true, external: true, params: [{ key: 'disque', label: 'Disque (vide : celui qui est ouvert)', kind: 'text', default: '' }, PARAM_POSTE], words: ['valeurs smart', 'attributs smart', 'détail du disque'], run: async (ctx, i) => {
      const poste = posteVoulu(ctx, i.poste), c = await connu(ctx, poste), l = c.l && !c.enCours ? c.l : await relire(ctx, poste);
      if (l.panne) return { ok: false, text: l.panne.texte };
      const d = s(i.disque) ? trouver(l.disques, s(i.disque)) : ouvert(ctx, l);
      if (!d) return { ok: false, text: s(i.disque) ? `Je ne trouve pas le disque « ${s(i.disque).slice(0, 60)} ». Disques vus : ${l.disques.map((x) => x.nom).join(', ') || 'aucun'}.` : 'Aucun disque ne donne ses valeurs SMART ici.' };
      if (d.smart !== 'oui') return { text: `${appeler(d)} : ${pourquoiInconnu(d)}` };
      return { text: [`${appeler(d)} · ${genreDit(d)} · état ${motEtat(d.etat)}`, ...d.raisons.map((r) => `→ ${r.texte}`), ...d.valeurs.map((v) => `- ${v.nom} : ${v.valeur}${v.note ? ` (note ${v.note})` : ''}${v.etat === 'attention' || v.etat === 'mauvais' ? ' ⚠' : ''} — ${v.explication}`)].join('\n'), data: { disque: d.nom, etat: d.etat, valeurs: d.valeurs } };
    } },
    { id: 'historique', label: 'Historique des disques', what: 'Les relevés gardés pour chaque disque : comment ont bougé la température, l\'usure et les secteurs réalloués', read: true, external: true, params: [{ key: 'disque', label: 'Disque (vide : tous)', kind: 'text', default: '' }, PARAM_POSTE], words: ['historique du disque', 'historique des disques', 'évolution du disque'], run: (ctx, i) => {
      const poste = posteVoulu(ctx, i.poste), q = s(i.disque).toLowerCase().replace(/^\/dev\//, ''), tous = listerSuivis(ctx.dir, poste.id || 'ici'), l = q ? tous.filter((x) => x.nom.toLowerCase() === q || x.cle.toLowerCase() === q || (x.modele ?? '').toLowerCase().includes(q) || x.serie?.toLowerCase() === q) : tous;
      if (!l.length) return { text: q ? `Pas d'historique pour « ${s(i.disque).slice(0, 60)} ».` : 'Pas encore d\'historique : il se remplit à chaque lecture des disques (au plus un relevé par jour, plus un à chaque changement).' };
      return { text: l.map((x) => { const a = x.releves[0], b = x.releves.at(-1)!, d = (k: 'r' | 'p' | 'i' | 'u') => (a[k] !== undefined && b[k] !== undefined && a[k] !== b[k] ? `${a[k]} → ${b[k]}` : b[k] !== undefined ? `${b[k]}` : undefined);
        return [`${x.nom}${x.modele ? ` · ${x.modele}` : ''} : ${x.releves.length} relevé(s) depuis le ${jourDit(a.j, ctx.now())} · état ${motEtat(b.e)}${x.disparu ? ' · ne répond plus' : ''}`, [b.temp !== undefined ? `température ${b.temp} °C (jusqu'à ${Math.max(...x.releves.map((r) => r.tmax ?? r.temp ?? 0))} °C)` : '', d('r') ? `secteurs réalloués ${d('r')}` : '', d('p') && b.p ? `en attente ${d('p')}` : '', d('i') && b.i ? `illisibles ${d('i')}` : '', d('u') ? `usure ${d('u')} %` : ''].filter(Boolean).join(' · ')].filter(Boolean).join('\n   ');
      }).join('\n'), data: l.map((x) => ({ disque: x.nom, modele: x.modele, releves: x.releves })) };
    } },
    { id: 'resultats', label: 'Vitesses mesurées', what: 'Les derniers tests de vitesse, pour comparer dans le temps', read: true, words: ['vitesse du disque', 'vitesse des disques', 'vitesse du ssd', 'vitesse de mon disque', 'résultats des tests de vitesse'], run: (ctx) => {
      const l = lireResultats(ctx.dir).slice(-12).reverse(), t = tests.get(cle(ctx, ''));
      if (!l.length) return { text: `${t ? `Un test est en cours (${t.etape}). ` : ''}Pas encore de test de vitesse. Dis « teste la vitesse du disque » (compte une vingtaine de secondes).` };
      const avant = l.slice(1).map((r) => `- ${new Date(r.quand).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · ${r.poste ? `${r.nomPoste} · ` : ''}${r.dossier} · lecture ${moS(r.mesures.seq1m_q8?.lecture?.moS ?? r.mesures.seq1m_q1?.lecture?.moS)} · écriture ${moS(r.mesures.seq1m_q8?.ecriture?.moS ?? r.mesures.seq1m_q1?.ecriture?.moS)}`);
      return { text: [...(t ? [`Un test est en cours (${t.etape}).`] : []), texteTest(ctx, l[0]), ...(avant.length ? ['Tests d\'avant :', ...avant] : [])].join('\n'), data: l };
    } },
    { id: 'banc', label: 'Tester la vitesse', what: 'Mesure la lecture et l\'écriture (séquentielles et aléatoires) dans un fichier de test créé dans le dossier choisi, puis effacé ; jamais sur le disque brut. Une vingtaine de secondes avec les réglages de départ',
      params: [{ key: 'dossier', label: 'Dossier où créer le fichier de test', kind: 'text', default: '', help: 'Un dossier du disque à mesurer, par exemple /home ou /mnt/donnees. Vide : le disque où Odin range ses données.' }, { key: 'taille', label: 'Taille du fichier de test', kind: 'select', options: Object.keys(TAILLES), default: TAILLE_DEFAUT, help: 'Petit : rapide. 1 Go ou plus : mesure plus fidèle (surtout pour un disque dur), mais plus longue.' }, { key: 'secondes', label: 'Durée de chaque mesure (secondes)', kind: 'number', default: 2, help: 'Il y a 8 mesures : 2 secondes chacune donnent un test d\'une vingtaine de secondes.' }, PARAM_POSTE],
      grave: (i) => (estIci(i.poste) ? undefined : `écrire un fichier de test de ${TAILLES[s(i.taille)] ? s(i.taille) : TAILLE_DEFAUT} sur ${s(i.poste)} (${s(i.dossier) || 'dans le dossier personnel du compte'}), le relire, puis l'effacer`),
      words: ['teste la vitesse du disque', 'tester la vitesse du disque', 'teste la vitesse des disques', 'teste la vitesse du ssd', 'mesure la vitesse du disque', 'test de vitesse du disque', 'lance un test de vitesse du disque'], run: async (ctx, i) => {
        const poste = posteVoulu(ctx, i.poste), mo = TAILLES[s(i.taille)] ?? TAILLES[TAILLE_DEFAUT], octets = mo * 1024 * 1024, dureeMs = Math.round(Math.max(0.2, Math.min(30, Number(i.secondes) || 2)) * 1000);
        const deja = tests.get(cle(ctx, '')); if (deja) return { ok: false, text: `Un test de vitesse est déjà en cours (${deja.dossier}, ${deja.etape}) : attends sa fin, ou dis « arrête le test de vitesse ».` };
        // Sur la machine d'Odin : dossier et place vérifiés avant de créer quoi que ce soit (sur un autre poste, c'est le poste qui vérifie).
        const dossier = poste.local ? controler(s(i.dossier) || ctx.dir, octets).dossier : s(i.dossier);
        const t = lancerTest(ctx, poste, { dossier, octets, dureeMs });
        // Un test court rend son résultat tout de suite ; un long continue tout seul, la page montre où il en est, et tu es prévenu à la fin.
        let minuterie: ReturnType<typeof setTimeout> | undefined;
        const attente = new Promise<undefined>((ok) => { minuterie = setTimeout(() => ok(undefined), Number(ctx.settings.attenteVitesse ?? 40_000)); });
        const r = await Promise.race([t.fin, attente]).finally(() => clearTimeout(minuterie));
        if (r) return { text: texteTest(ctx, r), data: r };
        void t.fin.then((fin) => ctx.notify(texteTest(ctx, fin)), (e) => { if (!/arrêté à ta demande/.test((e as Error).message)) ctx.alert({ level: 'moyenne', title: 'Tirésias : le test de vitesse ne s\'est pas terminé', detail: `${(e as Error).message}. Le fichier de test a été effacé.`, key: `vitesse:${t.debut}` }); });
        return { text: `⏱ Test de vitesse lancé${poste.local ? '' : ` sur ${poste.nom}`} dans ${dossier || 'le dossier personnel du compte'} (fichier de ${tailleFichier(octets)}) : il dure environ ${t.estimeS} secondes. Il continue tout seul : l'onglet « Vitesse » montre où il en est, et je te préviens à la fin. Dis « arrête le test de vitesse » pour le couper ; le fichier de test est effacé dans tous les cas.`, data: { enCours: true, estimeS: t.estimeS } };
      } },
    { id: 'interrompre', label: 'Arrêter le test de vitesse', what: 'Coupe le test en cours ; son fichier de test est effacé', words: ['arrête le test de vitesse', 'arrete le test de vitesse', 'stoppe le test de vitesse'], quiet: true, run: async (ctx) => {
      const t = tests.get(cle(ctx, '')); if (!t) return { text: 'Aucun test de vitesse en cours.' };
      if (t.poste) return { text: `Le test en cours se fait sur ${t.nomPoste} : il ne se coupe pas d'ici. Il se termine tout seul (environ ${t.estimeS} s en tout) et efface son fichier de test.` };
      t.stop.abort(); await t.fin.catch(() => undefined);
      return { text: `⏹ Test de vitesse arrêté (${t.dossier}). Le fichier de test a été effacé.` };
    } },
    { id: 'ouvrir', label: 'Ouvrir un disque', what: 'Montre un disque en détail dans la page : son état, ses valeurs SMART expliquées, ses relevés', read: true, quiet: true, quick: false, params: [{ key: 'disque', label: 'Disque (sda, nvme0, ou un bout de son modèle)', kind: 'text', required: true }, PARAM_POSTE], run: async (ctx, i) => {
      const poste = posteVoulu(ctx, i.poste), c = await connu(ctx, poste), l = c.l && trouver(c.l.disques, s(i.disque)) ? c.l : await relire(ctx, poste);
      if (l.panne) return { ok: false, text: l.panne.texte };
      const d = trouver(l.disques, s(i.disque)); if (!d) return { ok: false, text: `Je ne trouve pas le disque « ${s(i.disque).slice(0, 60)} ». Disques vus : ${l.disques.map((x) => x.nom).join(', ') || 'aucun'}.` };
      ctx.saveSettings({ ouvert: { poste: poste.id, disque: cleDisque(d) } });
      return { text: `📂 ${ligneDisque(d).join('\n')}`, data: { disque: d.nom, etat: d.etat } };
    } },
    { id: 'surveiller', label: 'Surveiller un autre poste', what: 'Tirésias relit de lui-même les disques de ce poste (toutes les 6 heures, par SSH) et prévient quand ça se dégrade', quick: false, params: [{ ...PARAM_POSTE, label: 'Poste', required: true }, { key: 'actif', label: 'Le surveiller', kind: 'boolean', default: true }], words: ['surveille les disques du poste', 'surveille les disques de'], run: async (ctx, i) => {
      const poste = posteVoulu(ctx, i.poste); if (poste.local) return { text: 'Les disques de cette machine sont déjà surveillés (toutes les 30 minutes).' };
      const liste = ((ctx.settings.surveilles as string[] | undefined) ?? []).filter((x) => x !== poste.id);
      if (i.actif === false) { ctx.saveSettings({ surveilles: liste }); return { text: `Les disques de ${poste.nom} ne sont plus surveillés (leur historique est gardé).` }; }
      const l = await relire(ctx, poste); if (l.panne) return { ok: false, text: l.panne.texte };
      ctx.saveSettings({ surveilles: [...liste, poste.id] });
      return { text: `👁 Les disques de ${poste.nom} sont surveillés : ${l.disques.filter((d) => d.smart === 'oui').length} disque(s) avec leur santé, relus toutes les 6 heures.\n${l.disques.flatMap(ligneDisque).join('\n')}` };
    }, undo: (i) => ({ action: 'surveiller', input: { poste: s(i.poste), actif: false }, label: 'Ne plus surveiller ce poste' }) },
    { id: 'seuils', label: 'Régler les températures d\'alerte', what: 'À partir de quelle température un disque passe en « Attention », puis déclenche une alerte', quick: false, params: [{ key: 'genre', label: 'Genre de disque', kind: 'select', options: ['disque dur', 'SSD', 'NVMe'], required: true }, { key: 'attention', label: 'Attention à partir de (°C)', kind: 'number', required: true }, { key: 'alerte', label: 'Alerte à partir de (°C)', kind: 'number', required: true }], words: ['règle la température d\'alerte des disques'], run: (ctx, i) => {
      const k = ({ 'disque dur': 'hdd', SSD: 'ssd', NVMe: 'nvme' } as const)[s(i.genre) as 'disque dur' | 'SSD' | 'NVMe'], a = Number(i.attention), b = Number(i.alerte);
      if (!k) throw new Error('genre : disque dur, SSD ou NVMe'); if (!(a >= 30 && b <= 100 && a < b)) throw new Error('il faut : 30 °C ou plus pour « attention », moins que la température d\'alerte, elle-même à 100 °C au plus');
      ctx.saveSettings({ seuils: { ...((ctx.settings.seuils as object) ?? {}), [k]: { attention: a, alerte: b } } });
      // Les disques sont relus au prochain passage avec ces limites (la page le fait toute seule).
      for (const x of [...memo.keys()]) if (x.startsWith(`${ctx.dir}|`)) memo.set(x, { ...memo.get(x)!, quand: new Date(0).toISOString() });
      return { text: `🌡 ${s(i.genre)} : « Attention » à partir de ${a} °C, alerte à partir de ${b} °C.` };
    } },
    { id: 'boitier', label: 'Régler un boîtier USB', what: 'Pour un disque en USB dont la santé ne se lit pas : dire à smartctl quel type de boîtier c\'est (« sat » marche pour la plupart)', quick: false, params: [{ key: 'disque', label: 'Disque', kind: 'text', required: true }, { key: 'type', label: 'Type de boîtier', kind: 'select', options: BOITIERS, required: true, help: 'Essaie « sat » d\'abord. « snt… » : boîtiers pour disques NVMe (ASMedia, JMicron, Realtek). Un mauvais type est simplement refusé par le boîtier.' }], words: ['règle le boîtier usb du disque'], run: async (ctx, i) => {
      const type = s(i.type); if (!BOITIERS.includes(type)) throw new Error(`type : ${BOITIERS.join(', ')}`);
      const l = await relire(ctx, posteDe(ctx, '')); if (l.panne) return { ok: false, text: l.panne.texte };
      const d = trouver(l.disques, s(i.disque)); if (!d) return { ok: false, text: `Je ne trouve pas le disque « ${s(i.disque).slice(0, 60)} ». Disques vus : ${l.disques.map((x) => x.nom).join(', ') || 'aucun'}.` };
      const forces = { ...((ctx.settings.boitiers ?? {}) as Record<string, string>) }, k = d.serie || d.nom;
      if (type === 'automatique') delete forces[k]; else forces[k] = type;
      ctx.saveSettings({ boitiers: forces });
      const apres = trouver((await relire(ctx, posteDe(ctx, ''))).disques, d.nom) ?? d;
      return { ok: apres.smart === 'oui' || type === 'automatique', text: apres.smart === 'oui' ? `✅ ${appeler(apres)} : sa santé se lit avec le type « ${type} ».\n${ligneDisque(apres).join('\n')}` : type === 'automatique' ? `${appeler(d)} : retour au choix automatique.` : `Avec le type « ${type} », ${appeler(d)} ne donne toujours pas sa santé (${apres.messages[0] ?? 'pas de réponse'}). Essaie un autre type, ou « automatique » pour revenir en arrière.` };
    } },
    { id: 'inventorier', label: 'Mettre dans l\'inventaire', what: 'Crée la fiche du disque dans Atlas (modèle, numéro de série, taille, machine) : utile pour la garantie', quick: false, params: [{ key: 'disque', label: 'Disque', kind: 'text', required: true }, PARAM_POSTE], words: ['mets le disque dans l\'inventaire'], run: async (ctx, i) => {
      const poste = posteVoulu(ctx, i.poste), c = await connu(ctx, poste), l = c.l ?? await relire(ctx, poste), d = trouver(l.disques, s(i.disque));
      if (!d) return { ok: false, text: `Je ne trouve pas le disque « ${s(i.disque).slice(0, 60)} ». Disques vus : ${l.disques.map((x) => x.nom).join(', ') || 'aucun'}.` };
      return inventorier(ctx, d, poste, true);
    } },
    { id: 'oublier', label: 'Oublier un disque', what: 'Retire du suivi un disque qui n\'est plus là (remplacé, donné) : son historique est effacé', quick: false, params: [{ key: 'disque', label: 'Disque (nom ou modèle)', kind: 'text', required: true }, PARAM_POSTE], grave: (i) => `effacer l'historique du disque ${s(i.disque)}${estIci(i.poste) ? '' : ` de ${s(i.poste)}`} (ses relevés ne pourront pas être retrouvés)`, words: ['oublie le disque'], run: (ctx, i) => {
      const poste = posteVoulu(ctx, i.poste), pk = poste.id || 'ici', q = s(i.disque).toLowerCase().replace(/^\/dev\//, ''), sv = listerSuivis(ctx.dir, pk).find((x) => x.nom.toLowerCase() === q || x.cle.toLowerCase() === q || x.serie?.toLowerCase() === q || (x.modele ?? '').toLowerCase().includes(q));
      if (!sv) return { ok: false, text: `Aucun disque suivi ne correspond à « ${s(i.disque).slice(0, 60)} ».` };
      oublierSuivi(ctx.dir, pk, sv.cle);
      return { text: `🗑 ${appeler(sv)} n'est plus suivi : son historique (${sv.releves.length} relevé(s)) est effacé. S'il est encore branché, il sera suivi de nouveau à la prochaine lecture.` };
    } },
    { id: 'installer', label: 'Installer smartctl', what: 'Installe sur cette machine le programme libre qui lit la santé des disques (paquet « smartmontools »)', quick: false, grave: () => 'installer le paquet « smartmontools » sur cette machine (le programme libre smartctl, qui lit la santé des disques)', words: ['installe smartctl', 'installe smartmontools'], run: async (ctx) => {
      if (process.platform === 'win32') return { ok: false, text: 'Sur Windows, installe smartmontools depuis son site (smartmontools.org), ou utilise CrystalDiskInfo sur le PC.' };
      if ((await ctx.run('sh', ['-c', TROUVER], { timeoutMs: 15_000 })).code === 0) return { text: 'smartctl est déjà installé.' };
      const outils: Array<[string, string[], boolean]> = [['apt-get', ['install', '-y', '--no-install-recommends', 'smartmontools'], true], ['dnf', ['install', '-y', 'smartmontools'], true], ['yum', ['install', '-y', 'smartmontools'], true], ['zypper', ['--non-interactive', 'install', 'smartmontools'], true], ['pacman', ['-S', '--noconfirm', 'smartmontools'], true], ['apk', ['add', 'smartmontools'], true], ['brew', ['install', 'smartmontools'], false]];
      for (const [outil, args, admin] of outils) {
        if (!await ctx.has(outil)) continue;
        const r = outil === 'apt-get' ? await ctx.run('env', ['DEBIAN_FRONTEND=noninteractive', outil, ...args], { sudo: admin, timeoutMs: 300_000 }) : await ctx.run(outil, args, { sudo: admin, timeoutMs: 300_000 });
        if (r.code !== 0) return { ok: false, text: sudoRefused(`${r.err}\n${r.out}`) ? `Odin n'a pas les droits d'administrateur pour installer un paquet. Fais-le toi-même : ${INSTALLER}` : `L'installation a échoué (${(r.err.trim() || r.out.trim()).split('\n').at(-1)?.slice(0, 200) ?? 'sans message'}). Fais-le à la main : ${INSTALLER}` };
        memo.delete(cle(ctx, ''));
        const l = await relire(ctx, posteDe(ctx, ''));
        return { ok: !l.panne, text: l.panne ? `Le paquet est installé, mais ${l.panne.texte}` : `✅ smartctl est installé (version ${l.version ?? '?'}).\n${l.disques.flatMap(ligneDisque).join('\n') || 'Aucun disque trouvé.'}` };
      }
      return { ok: false, text: `Je ne reconnais pas le gestionnaire de paquets de cette machine. ${INSTALLER}` };
    } },
  ],
  async view(ctx, q) {
    const postes = choixDePoste(ctx, q), now = ctx.now(), SANTE = 'Disques', VITESSE = 'Vitesse', HISTO = 'Historique', REGLAGES = 'Réglages';
    let poste: Poste, c: Awaited<ReturnType<typeof connu>>;
    try { poste = posteDe(ctx, postes.actuel); c = await connu(ctx, poste); } catch (e) { poste = posteDe(ctx, ''); c = { enCours: false, erreur: (e as Error).message }; }
    const l = c.l, pk = poste.id || 'ici', disques = l?.disques ?? [], lus = disques.filter((d) => d.smart === 'oui'), compte = (e: Etat) => lus.filter((d) => d.etat === e).length;
    const rec = recuperation(ctx), d = ouvert(ctx, l), suivis = listerSuivis(ctx.dir, pk), chaud = lus.filter((x) => x.temperature !== undefined).sort((a, b) => b.temperature! - a.temperature!)[0];
    const sections: Section[] = [];
    // ---- Santé : l'état de chaque disque d'un coup d'œil, puis le détail du disque ouvert.
    if (c.erreur) sections.push({ kind: 'text', title: 'Ce poste ne répond pas', text: `${c.erreur}.${l ? ` Ce qui suit date de la dernière lecture (${quand(l.quand, now)}).` : ''}`, tone: 'attention', onglet: SANTE });
    if (l?.panne?.quoi === 'absent' && poste.local) sections.push({ kind: 'steps', title: 'Mise en route', onglet: SANTE, items: [{ title: 'Installer smartctl (paquet « smartmontools »)', detail: `C'est le programme libre qui lit la santé que chaque disque tient sur lui-même. Odin peut l'installer (avec ton accord), ou toi : ${INSTALLER}`, done: false, action: 'installer', button: 'Installer' }, { title: 'Lire les disques', detail: 'Dès que smartctl est là, chaque disque apparaît ici avec son état.', done: false }] });
    else if (l?.panne) sections.push({ kind: 'text', title: 'La santé des disques ne se lit pas', text: l.panne.texte, tone: 'attention', onglet: SANTE });
    if (!l?.panne || disques.length) sections.push({ kind: 'cards', title: poste.local ? 'Disques de cette machine' : `Disques de ${poste.nom}`, onglet: SANTE, large: true, empty: c.enCours ? 'Lecture des disques en cours…' : 'Aucun disque trouvé.', items: disques.map((x) => ({
      title: `${x.nom} · ${x.modele ?? 'disque'}${x.taille ? ` ${taille(x.taille)}` : ''}`, badge: x.enVeille ? `${motEtat(x.etat)} (dort)` : motEtat(x.etat), tone: TON[x.etat],
      sub: x.smart === 'oui' ? (x.raisons[0]?.texte ?? 'Rien d\'anormal dans ce que le disque déclare.') : pourquoiInconnu(x),
      meta: [genreDit(x), mesures(x)].filter(Boolean).join(' · '),
      actions: x.smart === 'oui' ? [{ action: 'ouvrir', label: 'Détail', input: { disque: x.nom } }, ...(x.etat === 'mauvais' && rec?.action ? [{ module: 'hel', action: rec.action, label: `Récupérer les fichiers (${rec.nom})`, input: { disque: x.chemin } }] : [])] : [],
    })) });
    if (!lus.length && disques.length && disques.every((x) => /^(vd|xvd)/.test(x.nom))) sections.push({ kind: 'text', title: 'Machine virtuelle', text: 'Les disques de cette machine sont virtuels : ils n\'ont pas de SMART. Leur santé se lit sur la machine qui l\'héberge : ajoute-la comme poste, puis choisis-la en haut de la page. Le test de vitesse, lui, marche ici.', onglet: SANTE });
    if (d) {
      // Une ligne par chose à savoir (une section « text » ne garde pas les retours à la ligne).
      const quoi = d.etat === 'mauvais' ? `Sauvegarde d'abord ce qui compte, remplace le disque ensuite.${rec ? ` Des fichiers déjà illisibles ? ${rec.nom} peut tenter de les récupérer.` : ''}` : d.etat === 'attention' ? 'Garde une sauvegarde à jour et regarde l\'onglet « Historique » dans quelques jours ; si les nombres montent, remplace le disque.' : '';
      sections.push({ kind: 'list', title: `${d.nom} · ${d.modele ?? 'disque'} : ${motEtat(d.etat)}`, onglet: SANTE, large: true, items: [
        { title: genreDit(d), detail: [d.taille ? taille(d.taille) : '', d.serie ? `n° de série ${d.serie}` : '', d.micrologiciel ? `micrologiciel ${d.micrologiciel}` : ''].filter(Boolean).join(' · '), meta: mesures(d) },
        ...(d.raisons.length ? d.raisons.map((r) => ({ title: r.niveau === 'mauvais' ? 'Grave' : 'À surveiller', detail: r.texte, tone: TON[r.niveau] })) : [{ title: 'Bon', detail: 'Rien d\'anormal dans ce que le disque déclare.', tone: 'bon' as Tone }]),
        ...(quoi ? [{ title: 'Que faire', detail: quoi, tone: TON[d.etat] }] : []),
        ...(d.enVeille ? [{ title: 'Il dort', detail: 'Ces valeurs datent de sa dernière lecture : je ne l\'ai pas réveillé.' }] : []),
        ...d.messages.map((m) => ({ title: 'smartctl dit', detail: m })),
      ] });
      sections.push({ kind: 'table', title: `Valeurs SMART de ${d.nom}, expliquées`, onglet: SANTE, columns: ['Valeur', 'Ce que dit le disque', 'Note du disque', 'État', 'Ce que ça veut dire'], empty: 'Ce disque ne détaille pas ses valeurs.', rows: d.valeurs.map((v) => ({ cells: [v.nom, v.valeur, v.note ?? '—', v.etat === 'info' ? '—' : motEtat(v.etat), v.explication], ...(v.etat === 'mauvais' || v.etat === 'attention' ? { tone: TON[v.etat] } : {}) })) });
    }
    const autres = listMachines(ctx.home).filter((m) => m.via !== 'smb'), veilles = (ctx.settings.surveilles as string[] | undefined) ?? [];
    if (autres.length && poste.local) sections.push({ kind: 'table', title: 'Surveillance des autres postes', onglet: REGLAGES, columns: ['Poste', 'Disques', 'Dernière lecture', 'Surveillance'], rows: autres.map((m) => {
      const x = memo.get(cle(ctx, m.id)) ?? lireDernier<Lecture>(ctx.dir, m.id), bons = x?.disques.filter((y) => y.smart === 'oui') ?? [], pire = bons.some((y) => y.etat === 'mauvais') ? 'mauvais' : bons.some((y) => y.etat === 'attention') ? 'attention' : bons.length ? 'bon' : 'inconnu';
      return { cells: [m.label, x ? (x.panne ? 'santé non lue' : `${bons.length} lu(s) · ${motEtat(pire as Etat)}`) : 'jamais lus', x ? quand(x.quand, now) : '—', veilles.includes(m.id) ? 'toutes les 6 h' : 'non'], ...(pire === 'mauvais' || pire === 'attention' ? { tone: TON[pire as Etat] } : {}), actions: [{ action: 'sante', label: 'Lire ses disques', input: { poste: m.label } }, { action: 'surveiller', label: veilles.includes(m.id) ? 'Ne plus surveiller' : 'Surveiller', input: { poste: m.label, actif: !veilles.includes(m.id) } }] };
    }) });
    // ---- Réglages : températures d'alerte, boîtier USB, surveillance des autres postes (plus haut).
    const lim = seuils(ctx);
    sections.push({ kind: 'table', title: 'Températures d\'alerte', onglet: REGLAGES, columns: ['Genre de disque', 'Attention à partir de', 'Alerte à partir de'], rows: ([['disque dur', lim.hdd], ['SSD', lim.ssd], ['NVMe', lim.nvme]] as const).map(([g, x]) => ({ cells: [g, `${x.attention} °C`, `${x.alerte} °C`] })) });
    sections.push({ kind: 'form', title: 'Changer une température d\'alerte', action: 'seuils', submit: 'Enregistrer', onglet: REGLAGES, params: [{ key: 'genre', label: 'Genre de disque', kind: 'select', options: ['disque dur', 'SSD', 'NVMe'], default: 'disque dur' }, { key: 'attention', label: 'Attention à partir de (°C)', kind: 'number', default: lim.hdd.attention }, { key: 'alerte', label: 'Alerte à partir de (°C)', kind: 'number', default: lim.hdd.alerte, help: 'Quand un disque donne sa propre limite (plus basse), c\'est elle qui compte.' }] });
    if (poste.local) sections.push({ kind: 'form', title: 'Un disque USB ne donne pas sa santé ?', action: 'boitier', submit: 'Essayer ce type', onglet: REGLAGES, params: [{ key: 'disque', label: 'Disque (sdb, sdc…)', kind: 'text', default: disques.find((x) => x.usb && x.smart !== 'oui')?.nom ?? '' }, { key: 'type', label: 'Type de boîtier', kind: 'select', options: BOITIERS, default: 'sat', help: 'Essaie « sat » d\'abord. « snt… » : boîtiers pour disques NVMe. Un mauvais type est simplement refusé par le boîtier ; « automatique » revient en arrière.' }] });
    // ---- Vitesse : lancer un test, voir où il en est, comparer les résultats.
    const test = tests.get(cle(ctx, '')), res = lireResultats(ctx.dir), ici = res.filter((r) => r.poste === poste.id), dernier = ici.at(-1);
    if (test) sections.push({ kind: 'list', title: 'Test de vitesse en cours', onglet: VITESSE, items: [{ title: 'Où', detail: `${test.poste ? `sur ${test.nomPoste}, ` : ''}${test.dossier || 'dossier personnel du compte'} · fichier de ${tailleFichier(test.octets)}` }, { title: 'Où il en est', detail: test.etape }, { title: 'Durée', detail: `commencé il y a ${Math.round((Date.now() - test.debut) / 1000)} s · prévu : environ ${test.estimeS} s. Le fichier de test sera effacé à la fin.` }] });
    sections.push({ kind: 'form', title: 'Tester la vitesse', action: 'banc', submit: test ? 'Un test est déjà en cours' : 'Lancer le test (une vingtaine de secondes)', onglet: VITESSE, params: [{ key: 'dossier', label: 'Dossier où créer le fichier de test', kind: 'text', default: '', help: poste.local ? 'Un dossier du disque à mesurer (/home, /mnt/donnees…). Vide : le disque où Odin range ses données. Le fichier est créé là puis effacé ; rien d\'autre n\'est touché.' : `Un dossier de ${poste.nom}. Vide : le dossier personnel du compte. Sur un autre poste, seul le débit séquentiel est mesuré, et le test demande ton accord.` }, { key: 'taille', label: 'Taille du fichier de test', kind: 'select', options: Object.keys(TAILLES), default: TAILLE_DEFAUT, help: 'Petit : rapide. 1 Go ou plus : mesure plus fidèle, mais plus longue. La place libre est vérifiée avant.' }, { key: 'secondes', label: 'Durée de chaque mesure (secondes)', kind: 'number', default: 2 }] });
    if (poste.local) { const vols = volumes(lire('/proc/mounts')); if (vols.length) sections.push({ kind: 'table', title: 'Où tester', onglet: VITESSE, columns: ['Dossier', 'Volume', 'Format'], rows: vols.slice(0, 12).map((v) => ({ cells: [v.point, v.source, v.fs], actions: [{ action: 'banc', label: 'Tester ici', input: { dossier: v.point } }] })) }); }
    if (dernier) {
      const [tete, ...lignes] = texteVitesse(dernier, precedent(res, dernier)).split('\n');
      sections.push({ kind: 'list', title: 'Dernier résultat', onglet: VITESSE, large: true, items: [{ title: tete.replace(/^⏱ /, ''), detail: '' }, ...lignes.map((x) => { const k = x.indexOf(' : '); return k > 0 && k < 60 ? { title: x.slice(0, k).replace(/^⚠ /, ''), detail: x.slice(k + 3), ...(/^⚠/.test(x) ? { tone: 'attention' as Tone } : {}) } : { title: x, detail: '' }; })] });
    }
    sections.push({ kind: 'table', title: 'Résultats gardés', onglet: VITESSE, columns: ['Quand', 'Où', 'Fichier', 'Lecture séq.', 'Écriture séq.', 'Lecture 4 Ko', 'Écriture 4 Ko', 'À savoir'], empty: 'Pas encore de test. Le premier sert de point de comparaison aux suivants.', rows: [...ici].reverse().slice(0, 30).map((r) => ({ cells: [new Date(r.quand).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }), r.dossier, tailleFichier(r.octets), moS(r.mesures.seq1m_q8?.lecture?.moS ?? r.mesures.seq1m_q1?.lecture?.moS), moS(r.mesures.seq1m_q8?.ecriture?.moS ?? r.mesures.seq1m_q1?.ecriture?.moS), moS(r.mesures.rnd4k_q1?.lecture?.moS), moS(r.mesures.rnd4k_q1?.ecriture?.moS), r.partiel ? 'séquentiel seulement' : r.direct ? (r.reserves.length ? 'voir les limites' : '') : 'lecture faussée par le cache'] })) });
    const memeLieu = dernier ? ici.filter((r) => r.dossier === dernier.dossier || (r.volume && r.volume === dernier.volume)).slice(-30) : [];
    if (memeLieu.length >= 2) {
      const dates = memeLieu.map((r) => new Date(r.quand).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })), serie = (name: string, f: (r: Resultat) => number | undefined) => ({ name, points: memeLieu.map((r) => Math.round(f(r) ?? 0)) });
      sections.push({ kind: 'courbe', title: `Débit séquentiel dans le temps (${dernier!.dossier})`, onglet: VITESSE, unit: 'Mo/s', labels: dates, series: [serie('Lecture', (r) => r.mesures.seq1m_q8?.lecture?.moS ?? r.mesures.seq1m_q1?.lecture?.moS), serie('Écriture', (r) => r.mesures.seq1m_q8?.ecriture?.moS ?? r.mesures.seq1m_q1?.ecriture?.moS)] });
      if (memeLieu.some((r) => r.mesures.rnd4k_q1)) sections.push({ kind: 'courbe', title: 'Accès aléatoires 4 Ko dans le temps', onglet: VITESSE, unit: 'Mo/s', labels: dates, series: [serie('Lecture, un accès', (r) => r.mesures.rnd4k_q1?.lecture?.moS), serie('Écriture, un accès', (r) => r.mesures.rnd4k_q1?.ecriture?.moS), serie('Lecture, 32 accès', (r) => r.mesures.rnd4k_q32?.lecture?.moS), serie('Écriture, 32 accès', (r) => r.mesures.rnd4k_q32?.ecriture?.moS)] });
    }
    // ---- Historique : ce qui a bougé, disque par disque.
    const vivants = suivis.filter((x) => !x.disparu), temp = courbe(vivants, 'tmax'), usure = courbe(vivants, 'u'), realloc = courbe(vivants, 'r');
    sections.push({ kind: 'courbe', title: 'Température (la plus haute de chaque jour)', onglet: HISTO, unit: '°C', ...temp, empty: 'Pas encore de relevé : il y en a un par jour et par disque, plus un à chaque changement.' });
    if (usure.series.length) sections.push({ kind: 'courbe', title: 'Usure des SSD', onglet: HISTO, unit: '%', ...usure });
    if (realloc.series.some((x) => x.points.some((p) => p > 0))) sections.push({ kind: 'courbe', title: 'Secteurs réalloués', onglet: HISTO, ...realloc });
    const sv = d ? suivis.find((x) => x.cle === cleDisque(d)) : suivis[0];
    sections.push({ kind: 'table', title: sv ? `Relevés de ${sv.nom}${sv.modele ? ` · ${sv.modele}` : ''}` : 'Relevés', onglet: HISTO, columns: ['Jour', 'État', 'Température', 'Heures', 'Réalloués', 'En attente', 'Illisibles', 'Usure'], empty: 'Pas encore de relevé pour ce disque.', rows: [...(sv?.releves ?? [])].reverse().slice(0, 60).map((r) => ({ cells: [`${jourDit(r.j, now)}${r.ch ? ' (changement)' : ''}`, motEtat(r.e), r.temp !== undefined ? `${r.temp} °C${r.tmax !== undefined && r.tmax > r.temp ? ` (max ${r.tmax})` : ''}` : '—', r.h !== undefined ? r.h.toLocaleString('fr-FR') : '—', r.r !== undefined ? String(r.r) : '—', r.p !== undefined ? String(r.p) : '—', r.i !== undefined ? String(r.i) : '—', r.u !== undefined ? `${r.u} %` : '—'], ...(r.e === 'mauvais' || r.e === 'attention' ? { tone: TON[r.e] } : {}) })) });
    const partis = suivis.filter((x) => x.disparu);
    if (partis.length) sections.push({ kind: 'table', title: 'Disques qui ne répondent plus', onglet: HISTO, columns: ['Disque', 'Vu pour la dernière fois', 'Dernier état'], rows: partis.map((x) => ({ cells: [appeler(x), jourDit(x.vu.slice(0, 10), now), motEtat(x.releves.at(-1)?.e ?? 'inconnu')], tone: 'attention' as const, actions: [{ action: 'oublier', label: 'Oublier', input: { disque: x.cle } }] })) });
    return {
      subtitle: `${poste.local ? 'Cette machine' : poste.nom} · ${l?.panne ? 'santé non lue' : `${disques.length} disque(s)${lus.length ? ` · ${compte('bon')} bon(s)${compte('attention') ? `, ${compte('attention')} à surveiller` : ''}${compte('mauvais') ? `, ${compte('mauvais')} mauvais` : ''}` : ''}`}${l ? ` · lu ${quand(l.quand, now)}` : ''}${c.enCours ? ' · lecture en cours…' : ''}`,
      kpis: [{ label: 'Disques', value: String(disques.length) }, { label: 'Bon', value: String(compte('bon')), tone: 'bon' }, { label: 'Attention', value: String(compte('attention')), tone: compte('attention') ? 'attention' : 'bon' }, { label: 'Mauvais', value: String(compte('mauvais')), tone: compte('mauvais') ? 'mauvais' : 'bon' }, ...(chaud ? [{ label: 'Le plus chaud', value: `${chaud.temperature} °C`, hint: chaud.nom, tone: (chaud.limites && chaud.temperature! >= chaud.limites.attention ? 'attention' : 'bon') as Tone }] : [])],
      onglets: [SANTE, HISTO, VITESSE, REGLAGES], postes, sections,
      side: [
        { kind: 'list', title: 'Comment lire l\'état', onglet: SANTE, items: [{ title: 'Bon', detail: 'Rien d\'anormal dans ce que le disque déclare.', tone: 'bon' }, { title: 'Attention', detail: 'Un signe à surveiller (quelques secteurs remplacés, chaleur, usure avancée). Garde une sauvegarde à jour.', tone: 'attention' }, { title: 'Mauvais', detail: 'Le disque annonce sa panne ou s\'abîme vite. Sauvegarde d\'abord, remplace ensuite.', tone: 'mauvais' }, { title: 'Inconnu', detail: 'Le disque ne donne pas sa santé (clé USB, disque virtuel).' }, { title: 'Toujours', detail: PRUDENCE.replace(/^Bon veut dire[^.]*\. /, '') }] },
        { kind: 'text', title: 'Ce que Tirésias ne fait jamais', onglet: VITESSE, text: 'Il n\'écrit jamais sur un disque brut, ne formate rien, ne répare rien. Le test de vitesse se fait dans un seul fichier, créé pour l\'occasion puis effacé, même si le test est coupé. Chaque test écrit quelques gigaoctets : inutile d\'en faire tous les jours sur un SSD.' },
      ],
      ...(c.enCours || test ? { refreshMs: test ? 2000 : 4000 } : {}),
    };
  },
  /** Au démarrage : le fichier de test qu'un test coupé net aurait laissé est effacé. */
  start(ctx) {
    const reste = menage(join(ctx.dir, 'test-en-cours.json'));
    if (reste) ctx.alert({ level: 'info', title: 'Tirésias : un fichier de test de vitesse a été effacé', detail: `Un test avait été coupé net (Odin arrêté pendant la mesure). Le fichier ${reste} qu'il avait laissé est effacé.`, key: `reste:${reste}` });
  },
  stop() { for (const t of tests.values()) t.stop.abort(); },
  // Toutes les 30 minutes : les disques de la machine (sans réveiller ceux qui dorment) ; toutes les 6 heures : ceux des postes surveillés.
  watch: { every: 1800, async run(ctx) {
    if (process.platform !== 'win32') await relire(ctx, posteDe(ctx, ''), { veille: true });
    const now = ctx.now().getTime();
    for (const id of (ctx.settings.surveilles as string[] | undefined) ?? []) {
      const k = cle(ctx, id), vu = memo.get(k) ?? lireDernier<Lecture>(ctx.dir, id), dernier = Math.max(essais.get(k) ?? 0, vu ? Date.parse(vu.quand) : 0);
      if (now >= dernier && now - dernier < 6 * 3600_000 - 60_000) continue;
      essais.set(k, now);
      // Un poste éteint ou injoignable n'est pas une alerte ici (Satellites s'en charge) : on réessaie au tour suivant.
      try { await relire(ctx, posteDe(ctx, id), { veille: true }); } catch { /* poste éteint, retiré du coffre… */ }
    }
  } },
};
/** Pour les essais : oublie ce qui est gardé en mémoire (lectures, tests en cours). */
export function oublierMemoire(): void { memo.clear(); enLecture.clear(); essais.clear(); for (const t of tests.values()) t.stop.abort(); tests.clear(); }
