// Hydre · cloner et exporter une machine de ce PC (maquette « Conteneurs et machines » validée, écran 15 ; lot M7).
//   - Cloner : une copie complète (un disque à elle) ou liée (VM : son disque n'écrit que ses changements sur celui de
//     l'original). Une copie liée se fait depuis un MODÈLE seulement : il ne démarre pas, son disque ne change plus ;
//     depuis une machine qui tourne, ses écritures abîmeraient la copie. Tant qu'une copie liée existe, son modèle ne se
//     supprime pas (registre « qui dépend de qui »), ne redevient pas une machine et son disque ne grandit pas.
//     Nouvelle adresse réservée et nouvelle carte réseau ; dans le système de la machine, le nom d'ordinateur (et
//     l'identité de Windows) ne changent pas tout seuls : c'est dit. Une VM passe par les garde-fous de la création
//     (budget d'Hydre avec les chiffres, ton accord au-delà de ton budget sans accord, nom libre, dossier neuf).
//   - Exporter en .ody : éteinte, la machine telle quelle ; allumée ou en pause, Odin prend un instantané, copie le
//     disque de celui-là (la machine continue de tourner), puis le retire ; une copie liée part en entier (son disque et
//     celui de son modèle réunis). Le fichier écrit est relu (contenu, empreinte) avant de prendre son nom.
//     Tout export d'une VM passe par le budget d'Hydre (éteinte aussi) ; une seule fois à la fois pour une même machine.
//     Une copie faite depuis un instantané (machine qui tourne) est relue par « qemu-img check » avant d'être archivée.
//   - Vers une clé ODIN (« Copie de VM ») : Genèse ne sait copier le disque d'une VM que sur sa clé d'essai, pas sur une
//     vraie clé (thjalfi/cle-ecrire.ts, copierDisqueVm) : l'option est fermée, la raison dite. Vers un serveur du réseau :
//     Hydre ne sait pas encore le faire, c'est dit et rien n'est proposé.
//   - Importer : un .ody (un chemin de ce PC, ou un fichier envoyé depuis le navigateur en morceaux) : contenu et
//     empreinte vérifiés, puis l'antivirus d'Odin AVANT tout ; sans son verdict (absent, désactivé, en panne), rien
//     n'est importé.
//   - Au propriétaire seul, noté dans « qui a fait quoi » ; sous Windows, une VM : un état clair, rien n'est tenté.
// Les commandes passent par `systemeCopies` (les essais le remplacent : aucun vrai qemu-img).
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Action, ActionResult, ModCtx, Param } from '../types.ts';
import { avecJournal } from '../vidarr/qui-a-fait.ts';
import { allumee, Local, slug, systemeVm, VM_WINDOWS, type Machine } from './local.ts';
import { avecGardeFousVm, budgetIci, graveVm } from './creation.ts';
import { instantanePourExport } from './instantanes.ts';
import { liensDe, type Lien } from './dependances.ts';
import { dossierMorceaux } from './bibliotheque.ts';

/** Les commandes des copies (qemu-img, tar, ping) : celles d'Odin ; les essais les remplacent. */
export const systemeCopies = {
  run: (ctx: ModCtx, cmd: string, args: string[], o: { timeoutMs?: number; sudo?: boolean; input?: string } = {}) => ctx.run(cmd, args, o),
};
/** Le contexte d'Hydre dont les commandes passent par `systemeCopies` (tout le reste est celui d'Hydre). */
const ici = (ctx: ModCtx): ModCtx => Object.create(ctx, { run: { value: (cmd: string, args: string[], o?: { timeoutMs?: number; sudo?: boolean; input?: string }) => systemeCopies.run(ctx, cmd, args, o) } }) as ModCtx;

/** Sous Windows : la phrase des copies d'une VM (la page dit la même). */
export const COPIES_WINDOWS = 'Sous Windows, les VM de ce PC ne tournent pas encore dans Hydre : les cloner et les exporter non plus. Ça viendra avec le moteur Windows d\'Hydre ; sous Linux, Hydre copie le disque de la VM.';
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const GO = 1024 ** 3;
const go = (n: number) => `${(n / GO).toFixed(2).replace('.', ',')} Go`;
/** Une VM, sous Windows : la raison (rien n'est tenté) ; sinon rien. */
const horsVm = (m: Pick<Machine, 'genre'>): string | undefined => (m.genre === 'vm' && systemeVm.plateforme() === 'win32' ? COPIES_WINDOWS : undefined);
/** Le dossier où un .ody est écrit par défaut. */
const dossierOdy = (ctx: ModCtx) => s(ctx.settings.dossierOdy) || join(ctx.home, 'Machines');
/** Les copies liées d'une machine (leurs noms). */
const copiesLiees = (L: Local, m: Machine) => L.list().filter((x) => x.liee?.de === m.id).map((x) => x.nom);

/** La place que prend le disque d'une VM (et celui de son modèle pour une copie liée), mesurée sur le disque ; 0 : illisible. */
export function tailleACopier(L: Local, m: Machine): number {
  const t = (p: string) => { try { return statSync(p).size; } catch { return 0; } };
  if (m.genre !== 'vm') return 0;
  let n = t(join(L.vmDir(m), 'disque.qcow2'));
  const base = m.liee ? L.list().find((x) => x.id === m.liee!.de) : undefined;
  if (base) n += t(join(L.vmDir(base), 'disque.qcow2'));
  return n;
}
/** Le premier nom libre « nom-copie », « nom-copie-2 »… (63 caractères au plus). */
function nomPropose(L: Local, m: Machine): string {
  const pris = new Set(L.list().map((x) => x.nom)), b = slug(`${m.nom.slice(0, 50)}-copie`);
  for (let k = 1; k < 1000; k++) { const n = k === 1 ? b : `${b}-${k}`; if (!pris.has(n)) return n; }
  return `${b}-${randomBytes(2).toString('hex')}`;
}
/**
 * La place qu'un export prend sur le disque des machines, en Go : l'archive puis le .ody (deux fois le disque) ; une copie
 * préparée à part (machine allumée, copie liée) en plus (trois fois) ; plus une marge. Le .ody peut aller sur un autre
 * disque : il est compté quand même (le plus prudent). Pur.
 */
export function besoinExportGo(octets: number, preparee: boolean): number { return Math.ceil(((preparee ? 3 : 2) * octets) / GO) + 1; }
/** Les machines en cours d'export (deux exports de la même machine se marcheraient dessus). */
const EN_EXPORT = new Set<string>();
/** Une commande qui doit réussir (sinon l'erreur, courte). */
async function commande(C: ModCtx, cmd: string, args: string[], quoi: string, timeoutMs: number): Promise<void> {
  const r = await C.run(cmd, args, { timeoutMs, sudo: true });
  if (r.code !== 0) throw new Error(`${quoi} : ${(r.err || r.out).trim().split('\n').slice(-2).join(' ').slice(0, 240) || `code ${r.code}`}`);
}

/** Ce que dit la phrase d'une copie faite : ce qui change tout seul, et ce qui ne change pas. */
const ceQuiChange = (m: Machine) => `Nouvelle adresse réservée et nouvelle carte réseau ; dans son système, le nom d'ordinateur${m.famille === 'Windows' ? ' et l\'identité de Windows ne changent pas tout seuls' : ' ne change pas tout seul'}.`;

/**
 * Exporte une VM. Éteinte (et pas liée) : son dossier tel quel. Allumée ou en pause : un instantané, dont le disque est
 * copié à part (la machine continue de tourner), puis retiré. Copie liée : son disque remis en entier. La copie préparée
 * passe par le budget d'Hydre (elle et son archive, chiffres à l'appui).
 */
async function exporterVm(C: ModCtx, L: Local, m: Machine, dest: string): Promise<{ fichier: string; taille: number; sha256: string; verifie: true; instantane?: boolean; pasRetire?: string; entiere?: boolean }> {
  const e = await L.etat(m);
  if (e.state === 'inconnue') throw new Error(`l'état de ${m.nom} ne se lit pas : rien n'est exporté`);
  const on = allumee(e), preparee = on || Boolean(m.liee);
  let b: ReturnType<typeof budgetIci> | undefined;
  try { b = budgetIci(C, L); } catch { b = undefined; }
  if (b?.disqueMaxGo === undefined) throw new Error('Odin ne sait pas lire la place libre du disque des machines : rien n\'est exporté');
  const besoin = besoinExportGo(tailleACopier(L, m), preparee);
  if (besoin > b.disqueMaxGo) throw new Error(`pas assez de place pour exporter ${m.nom} : il faut environ ${besoin} Go (${preparee ? 'la copie du disque, son archive et le .ody' : 'son archive et le .ody'}) et le budget d'Hydre en laisse ${b.disqueMaxGo} Go (${b.disqueLibreGo} Go libres, ${b.reserveDisqueGo} Go gardés pour Odin et tes fichiers)`);
  if (!preparee) return L.exporter(m, dest);
  const prep = join(L.dir, `.copie-${m.id}`), d = join(prep, m.nom);
  rmSync(prep, { recursive: true, force: true }); mkdirSync(d, { recursive: true });
  let snap: { tag: string; fini: () => Promise<string | undefined> } | undefined, pasRetire: string | undefined, r: Awaited<ReturnType<Local['exporter']>>;
  try {
    if (on) snap = await instantanePourExport(C, L, m);
    // Allumée : lecture partagée (-U) du disque, à l'instantané pris (il ne change plus). Liée : la chaîne entière.
    await commande(C, 'qemu-img', ['convert', ...(snap ? ['-U', '-l', `snapshot.name=${snap.tag}`] : []), '-O', 'qcow2', join(L.vmDir(m), 'disque.qcow2'), join(d, 'disque.qcow2')], `copie du disque de ${m.nom}`, 3_600_000);
    // Lue pendant que la machine tourne : la copie est relue avant d'être archivée (une table abîmée fait échouer).
    if (snap) await commande(C, 'qemu-img', ['check', join(d, 'disque.qcow2')], `la copie du disque de ${m.nom} ne se relit pas sans erreur (export annulé, rien n'est gardé)`, 1_800_000);
    const fiche: Machine = { ...m, arretVoulu: true }; delete fiche.liee; delete fiche.pause;
    writeFileSync(join(d, 'vm.json'), JSON.stringify(fiche, null, 1));
    if (existsSync(join(L.vmDir(m), 'tpm'))) cpSync(join(L.vmDir(m), 'tpm'), join(d, 'tpm'), { recursive: true });
    r = await L.exporter(m, dest, { base: prep });
  } finally {
    rmSync(prep, { recursive: true, force: true });
    if (snap) pasRetire = await snap.fini();
  }
  return { ...r, ...(on ? { instantane: true } : {}), ...(m.liee ? { entiere: true } : {}), ...(pasRetire ? { pasRetire } : {}) };
}

const machine: Param = { key: 'machine', label: 'Machine (nom ou adresse)', kind: 'text', required: true };
const commun = { proprietaireSeul: true, quick: false } as const;

/** Les actions des copies : lire l'écran, cloner, faire un modèle, exporter, importer. */
export function copiesActions(): Action[] {
  const notees: Action[] = [
    { id: 'cloner_machine', label: 'Cloner', what: 'La même machine, avec un autre nom et une autre adresse (machine éteinte) : copie complète, ou liée à un modèle (VM)', ...commun,
      params: [machine, { key: 'nom', label: 'Nom de la copie', kind: 'text', required: true }, { key: 'sorte', label: 'Sorte de copie', kind: 'select', options: ['complete', 'liee'], default: 'complete' }],
      // Une VM : ton accord au-delà de ton budget sans accord, comme pour en créer une.
      grave: (i, ctx) => { if (!ctx) return undefined; try { const m = new Local(ctx).find(i.machine); return m.genre === 'vm' ? graveVm(ctx, slug(s(i.nom)), { cpu: m.cpu, memoire: Math.ceil(m.ram / 1024), disque: m.disque }) : undefined; } catch { return undefined; } },
      run: async (ctx, i) => {
        const C = ici(ctx), L = new Local(C), src = L.find(i.machine), liee = s(i.sorte) === 'liee', nom = slug(s(i.nom));
        if (!nom) throw new Error('donne un nom à la copie');
        if (src.genre === 'lxc') { const m = await L.cloner(src, nom, { liee }); return { text: `📄 ${m.nom} : copie prête (${m.ip}), éteinte.`, data: m }; }
        const hors = horsVm(src); if (hors) return { ok: false, text: hors };
        if (liee && !src.estModele) return { ok: false, text: `Refusé, rien n'est créé : une copie liée se fait depuis un modèle, et ${src.nom} n'en est pas un (« En faire un modèle » d'abord : son disque ne changera plus).` };
        if (allumee(await L.etat(src))) return { ok: false, text: `Refusé, rien n'est créé : arrête d'abord ${src.nom} (une copie se fait machine éteinte).` };
        return avecGardeFousVm(C, nom, { cpu: src.cpu, memoire: Math.ceil(src.ram / 1024), disque: src.disque }, async (L2): Promise<ActionResult> => {
          const m = await L2.cloner(src, nom, { liee });
          if (liee) { const lien: Lien = { id: randomBytes(6).toString('hex'), de: src.id, genre: 'machine', qui: m.id, liee: true, at: ctx.now().getTime() }; ctx.saveSettings({ dependances: [...liensDe(ctx), lien] }); }
          return { text: `📄 ${m.nom} : copie ${liee ? 'liée' : 'complète'} prête (${m.ip}), éteinte. ${ceQuiChange(m)}${liee ? ` ${src.nom} reste un modèle tant qu'elle existe.` : ''}`, data: m };
        });
      } },
    { id: 'modele_machine', label: 'Faire un modèle', what: 'Range une machine éteinte comme modèle (elle ne démarre plus) : on crée ensuite des machines depuis elle, déjà prêtes', ...commun,
      params: [machine, { key: 'modele', label: 'Modèle', kind: 'boolean', default: true }], run: async (ctx, i) => {
        const L = new Local(ctx), m = L.find(i.machine), on = i.modele !== false && i.modele !== 'false';
        if (on && allumee(await L.etat(m))) throw new Error(`arrête d'abord ${m.nom} : un modèle se fait machine éteinte`);
        const liees = copiesLiees(L, m);
        if (!on && liees.length) throw new Error(`des copies liées (${liees.join(', ')}) utilisent le disque de ${m.nom} : il reste un modèle tant qu'elles existent`);
        if (on) { m.estModele = true; m.arretVoulu = true; } else delete m.estModele; L.update(m);
        return { text: on ? `📐 ${m.nom} est un modèle : « Créer depuis un modèle » en fait des copies prêtes.` : `${m.nom} redevient une machine normale.` };
      } },
    { id: 'exporter_machine', label: 'Exporter en .ody', what: 'Toute la machine dans un seul fichier vérifié (empreinte relue après la copie), par exemple vers ton NAS ; une VM allumée est exportée par un instantané, sans l\'arrêter', ...commun,
      params: [machine, { key: 'dossier', label: 'Dossier de destination', kind: 'text', default: '' }], run: async (ctx, i) => {
        const C = ici(ctx), L = new Local(C), m = L.find(i.machine), d = s(i.dossier).trim() || dossierOdy(ctx);
        const hors = horsVm(m); if (hors) return { ok: false, text: hors };
        if (EN_EXPORT.has(m.id)) return { ok: false, text: `Refusé : un export de ${m.nom} est déjà en cours ; attends sa fin (rien n'est lancé).` };
        EN_EXPORT.add(m.id);
        let r: Awaited<ReturnType<typeof exporterVm>> | Awaited<ReturnType<Local['exporter']>>;
        try { r = m.genre === 'vm' ? await exporterVm(C, L, m, d) : await L.exporter(m, d); } finally { EN_EXPORT.delete(m.id); }
        const x = r as { instantane?: boolean; pasRetire?: string; entiere?: boolean };
        return { text: `📦 ${r.fichier} (${go(r.taille)}) · empreinte ${r.sha256.slice(0, 16)}… vérifiée après la copie${x.instantane ? ` · ${m.nom} a continué de tourner (copiée depuis un instantané${x.pasRetire ? `, resté dans sa liste : ${x.pasRetire}` : ', retiré ensuite'})` : ''}${x.entiere ? ` · copie liée exportée en entier (avec le disque de son modèle)` : ''}`, data: r };
      } },
    { id: 'importer_machine', label: 'Importer un .ody', what: 'Odin vérifie le fichier (contenu, empreinte, puis l\'antivirus avant tout) et crée la machine, éteinte ; sans antivirus, rien n\'est importé', ...commun,
      params: [{ key: 'fichier', label: 'Fichier .ody (sur ce PC)', kind: 'text', default: '' }, { key: 'envoi', label: 'Envoi terminé depuis le navigateur (identifiant)', kind: 'text', default: '' }, { key: 'nom', label: 'Nom (vide : celui du fichier)', kind: 'text', default: '' }],
      run: async (ctx, i) => {
        const C = ici(ctx), L = new Local(C), envoi = s(i.envoi).trim();
        let f: string;
        if (envoi) { if (!/^[a-f0-9]{24}$/.test(envoi)) throw new Error('envoi inconnu'); f = join(dossierMorceaux(ctx), `${envoi}.part`); if (!existsSync(f)) throw new Error('envoi introuvable (recommence l\'envoi)'); }
        else { f = s(i.fichier).trim(); if (!f.endsWith('.ody') || !existsSync(f)) throw new Error('fichier .ody introuvable'); }
        // Un envoi du navigateur dont le contenu est refusé n'est pas gardé.
        const jeter = () => { if (envoi) rmSync(f, { force: true }); };
        let o: Awaited<ReturnType<Local['ouvrirOdy']>>;
        try { o = await L.ouvrirOdy(f); } catch (e) { jeter(); throw e; }
        const fin = (t: string): never => { rmSync(o.tmp, { recursive: true, force: true }); throw new Error(t); };
        const hors = horsVm(o.man); if (hors) fin(hors);
        // L'antivirus avant tout : sans son verdict, rien n'est importé.
        const v = await ctx.call('ullr', 'fichier', { chemin: o.payload }, `vérifier la machine importée ${o.man.nom}`).catch(() => undefined);
        if (!v || v.ok === false || !v.data) fin('l\'antivirus d\'Odin (Asclépios) n\'a pas pu analyser ce .ody (absent, désactivé ou en panne) : import arrêté, rien n\'est créé');
        const lvl = (v!.data as { level?: string }).level;
        if (lvl && ['moyenne', 'haute', 'critique'].includes(lvl)) { jeter(); fin(`l'antivirus juge ce .ody ${lvl} : import refusé`); }
        const m = await L.importer(o, s(i.nom)); jeter();
        return { text: `📥 ${m.nom} importée (${m.genre === 'lxc' ? 'LXC' : 'VM'} ${m.systeme} ${m.version}) · ${m.ip} · empreinte vérifiée, antivirus : rien trouvé. Elle est éteinte : démarre-la quand tu veux.`, data: m };
      } },
  ];
  // Ce que l'écran « Cloner et exporter » montre d'une machine (lecture au propriétaire seul, pas notée : la page la relit).
  const lecture: Action = { id: 'copies_machine', label: 'Cloner et exporter (lire)', what: 'Pour une machine de ce PC : la taille à copier (mesurée), le nom proposé pour une copie, si une copie liée est possible, où va un .ody', ...commun, quiet: true,
    params: [machine], run: async (ctx, i) => {
      const L = new Local(ctx), m = L.find(i.machine), hors = horsVm(m);
      if (hors) return { ok: false, text: hors, data: { etat: 'moteur' } };
      const e = await L.etat(m).catch(() => ({ state: 'inconnue' as const })), liees = copiesLiees(L, m), base = m.liee ? L.list().find((x) => x.id === m.liee!.de) : undefined;
      const servs = ((ctx.settings.servers as unknown[] | undefined) ?? []).length;
      const liee = m.genre !== 'vm' ? { possible: false, raison: 'Pas de copie liée pour un LXC.' }
        : m.estModele ? { possible: true } : { possible: false, raison: `Une copie liée se fait depuis un modèle (il ne démarre plus, son disque ne change plus) : « En faire un modèle » d'abord.` };
      let budget: { disqueMaxGo?: number; disqueLibreGo?: number; reserveDisqueGo?: number } = {};
      try { const b = budgetIci(ctx, L); budget = { disqueMaxGo: b.disqueMaxGo, disqueLibreGo: b.disqueLibreGo, reserveDisqueGo: b.reserveDisqueGo }; } catch { /* place libre illisible */ }
      return { text: `${m.nom} : ${go(tailleACopier(L, m))} à copier.`, data: {
        etat: 'ok', machine: { id: m.id, nom: m.nom, genre: m.genre, etat: e.state, famille: m.famille, estModele: Boolean(m.estModele), ...(base ? { liee: base.nom } : {}), disque: m.disque },
        taille: tailleACopier(L, m), nomPropose: nomPropose(L, m), copiesLiees: liees, liee, budget, dossier: dossierOdy(ctx),
        cle: { possible: false, raison: 'Pas encore possible : Genèse ne sait pas encore copier le disque d\'une machine virtuelle sur une vraie clé (« Copie de VM »). Exporte-la dans un fichier .ody.' },
        serveur: { possible: false, raison: servs ? 'Envoyer une machine de ce PC vers un serveur de virtualisation n\'est pas encore là dans Hydre.' : 'Aucun serveur de virtualisation relié (onglet Serveurs) ; et envoyer une machine de ce PC vers un serveur n\'est pas encore là dans Hydre.' },
      } };
    } };
  return [lecture, ...avecJournal('ymir_actes', notees)];
}
