// Hydre · les actions de la bibliothèque d'ISO (commune avec Andromède) et des logiciels d'Hermès installés dans
// les machines : espace ISO, importer (envoi en morceaux, lien, dossier, partage du réseau), parcourir le réseau,
// retirer ; installer un logiciel d'Hermès dans une machine, puis ses mises à jour.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { cheminSmb, commandesSmb, dossierSmb, partagesSmb } from '../../machines/smb.ts';
import { listMachines, type Machine as Poste } from '../../machines/access.ts';
import { exigerSain } from '../ullr/garde.ts';
import type { Action, ModCtx } from '../types.ts';
import { bibliotheque, bibliothequeIso, comptesRendus, dossierArrivees, espaceIso, importerIso, importerLien, isoDeplacee, planVerif, prochaineVerif, retirerIso, sansFiche, trouverIso, verifDue, verifierIsos, type FicheIso, type PlanVerif } from './isos.ts';
import { Local, type Machine } from './local.ts';

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const go = (n: number) => `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} Go`;
const ligne = (f: FicheIso) => `- ${f.nom} · ${f.systeme}${f.detail ? ` (${f.detail})` : ''} · ${go(f.taille)} · ${f.origine === 'andromede' ? 'Andromède' : f.origine} · antivirus : ${f.antivirus?.verdict ?? 'non analysé'}${f.sha256 ? ` · ${f.sha256.slice(0, 12)}…` : ''}`;

/** L'espace ISO vient d'Andromède (un seul réglage pour les deux applis) : Hydre le relit chez elle. */
export async function synchroEspace(ctx: ModCtx): Promise<string> {
  try { const r = await ctx.call('eitri', 'etat', {}, 'espace ISO commun', { interne: true }); const d = s((r.data as { dossier?: string } | undefined)?.dossier); if (d && d !== s(ctx.settings.espaceIso)) ctx.saveSettings({ espaceIso: d }); } catch { /* Andromède absent : réglage d'Hydre */ }
  return espaceIso(ctx);
}
/** Identifiant d'un envoi en morceaux : le même pour le même fichier (nom + taille), pour reprendre après une coupure. */
export const idEnvoi = (nom: string, taille: number) => createHash('sha256').update(`${nom}\n${taille}`).digest('hex').slice(0, 24);
export const dossierMorceaux = (ctx: ModCtx) => join(dossierArrivees(ctx), '.morceaux');

/** Les postes du coffre qui ont un partage Windows (SMB) lisible. */
const postesSmb = (ctx: ModCtx): Poste[] => listMachines(ctx.home).filter((m) => m.via === 'smb' || m.smbPort);
/** Les dossiers réseau montés sur ce PC (NFS, SMB montés). */
function montages(): string[] {
  try { return readFileSync('/proc/mounts', 'utf8').split('\n').map((l) => l.split(' ')).filter((c) => c.length > 2 && /^(nfs4?|cifs|smb3|smbfs)$/.test(c[2])).map((c) => c[1].replace(/\\040/g, ' ')); } catch { return []; }
}

export function bibliothequeActions(): Action[] {
  return [
    { id: 'espace_iso', label: 'Espace ISO', what: 'Le dossier de stockage des images ISO (un disque ou un partage monté), commun à Hydre et Andromède', params: [{ key: 'dossier', label: 'Dossier (vide : voir le réglage)', kind: 'text', default: '' }], run: async (ctx, i) => {
      const d = s(i.dossier).trim();
      if (!d) return { text: `Espace ISO : ${await synchroEspace(ctx)} (commun à Hydre et Andromède).`, data: { dossier: espaceIso(ctx) } };
      mkdirSync(d, { recursive: true });
      await ctx.call('eitri', 'dossier', { chemin: d }, 'espace ISO choisi dans Hydre', { interne: true }).catch(() => undefined);
      ctx.saveSettings({ espaceIso: d });
      return { text: `📁 Espace ISO : ${d}. Hydre et Andromède y rangent et y lisent leurs images.`, data: { dossier: d } };
    } },
    { id: 'bibliotheque_iso', label: 'Bibliothèque d\'ISO', what: 'Toutes les ISO de l\'espace ISO (Andromède et importées) : système, taille, empreinte, antivirus', read: true, words: ['bibliotheque d iso', 'mes iso', 'liste des iso'], run: async (ctx) => {
      await synchroEspace(ctx); const l = await bibliotheque(ctx);
      return { text: l.length ? l.map(ligne).join('\n') : `Aucune ISO dans l'espace ISO (${espaceIso(ctx)}).`, data: { dossier: espaceIso(ctx), isos: l } };
    } },
    { id: 'preparer_envoi_iso', quick: false, label: 'Préparer un envoi d\'ISO', what: 'Avant d\'envoyer une ISO depuis le navigateur en morceaux : son identifiant et ce qui est déjà reçu (reprise)', read: true, params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'taille', label: 'Taille (octets)', kind: 'number', required: true }], run: async (ctx, i) => {
      await synchroEspace(ctx);
      const taille = Number(i.taille); if (!Number.isFinite(taille) || taille <= 0) throw new Error('taille invalide');
      const id = idEnvoi(s(i.nom), taille), f = join(dossierMorceaux(ctx), `${id}.part`);
      return { text: `Envoi ${id}`, data: { envoi: id, recu: existsSync(f) ? statSync(f).size : 0, taille } };
    } },
    { id: 'importer_iso', label: 'Importer une ISO', what: 'Depuis un envoi du navigateur, un lien http(s), un dossier ou un partage monté : analysée par l\'antivirus, puis rangée dans la bibliothèque', external: true,
      params: [{ key: 'envoi', label: 'Envoi terminé (identifiant)', kind: 'text', default: '' }, { key: 'nom', label: 'Nom du fichier', kind: 'text', default: '' }, { key: 'lien', label: 'Lien http(s)', kind: 'text', default: '' }, { key: 'chemin', label: 'Fichier sur ce PC ou un partage monté', kind: 'text', default: '' }, { key: 'poste', label: 'Poste du réseau (partage Windows)', kind: 'text', default: '' }, { key: 'partage', label: 'Partage', kind: 'text', default: '' }],
      words: ['importe une iso', 'importer une iso', 'ajoute une iso'], run: async (ctx, i) => {
        await synchroEspace(ctx);
        let r;
        if (s(i.envoi)) {
          const id = s(i.envoi); if (!/^[a-f0-9]{24}$/.test(id)) throw new Error('envoi inconnu');
          const f = join(dossierMorceaux(ctx), `${id}.part`); if (!existsSync(f)) throw new Error('envoi introuvable (recommence l\'envoi)');
          r = await importerIso(ctx, f, { nom: s(i.nom) || `${id}.iso`, origine: 'envoi', deplacer: true });
        } else if (s(i.lien)) r = await importerLien(ctx, s(i.lien), s(i.nom) || undefined);
        else if (s(i.poste) && s(i.partage) && s(i.chemin)) {
          const p = postesSmb(ctx).find((m) => m.id === s(i.poste) || m.label === s(i.poste)); if (!p) throw new Error('poste inconnu (ajoute-le dans Satellites avec son compte)');
          mkdirSync(dossierArrivees(ctx), { recursive: true });
          const local = join(dossierArrivees(ctx), basename(s(i.chemin).replace(/\\/g, '/')).replace(/["\\]/g, '_'));
          await commandesSmb(p, s(i.partage), [`get "${cheminSmb(s(i.chemin))}" "${local}"`], 6 * 3600_000);
          if (!existsSync(local)) throw new Error('le fichier n\'a pas pu être copié depuis le partage');
          r = await importerIso(ctx, local, { origine: 'partage', source: `\\\\${p.host}\\${s(i.partage)}\\${cheminSmb(s(i.chemin))}`, deplacer: true });
        } else if (s(i.chemin)) r = await importerIso(ctx, s(i.chemin), { nom: s(i.nom) || undefined, origine: 'dossier', source: s(i.chemin) });
        else throw new Error('donne un envoi, un lien, un chemin ou un partage');
        return { ok: !r.passage.bloque, text: r.texte, data: r.fiche ?? { bloque: true, quarantaine: r.passage.quarantaine } };
      } },
    { id: 'ajouter_iso', quick: false, label: 'Ajouter une ISO d\'Andromède', what: 'Une ISO déjà dans l\'espace ISO (envoyée par Andromède) : sa fiche est faite sur place, sans copie, après l\'antivirus', params: [{ key: 'chemin', label: 'Chemin', kind: 'text', required: true }, { key: 'source', label: 'Lien d\'origine', kind: 'text', default: '' }, { key: 'editeur', label: 'Empreinte de l\'éditeur vérifiée', kind: 'text', default: '' }], run: async (ctx, i) => {
      await synchroEspace(ctx); const r = await importerIso(ctx, s(i.chemin), { origine: 'andromede', source: s(i.source) || 'Andromède', ...(s(i.editeur) !== '' ? { editeur: i.editeur === true || i.editeur === 'true' } : {}) });
      return { ok: !r.passage.bloque, text: r.texte, data: r.fiche };
    } },
    { id: 'retirer_iso', label: 'Retirer une ISO', what: 'Supprime une ISO de la bibliothèque (et son fichier)', params: [{ key: 'iso', label: 'ISO', kind: 'text', required: true }], grave: (i) => `supprimer l'ISO ${s(i.iso)} de l'espace ISO (Andromède ne l'aura plus non plus)`, run: async (ctx, i) => { const f = await retirerIso(ctx, i.iso); return { text: `🗑 ${f.nom} retirée de la bibliothèque.` }; } },
    { id: 'parcourir', quick: false, label: 'Parcourir le réseau', what: 'Les dossiers de ce PC, les partages montés (NFS, SMB) et les partages Windows des postes connus, pour choisir une ISO à importer', read: true, params: [{ key: 'poste', label: 'Poste (vide : ce PC)', kind: 'text', default: '' }, { key: 'partage', label: 'Partage', kind: 'text', default: '' }, { key: 'dossier', label: 'Dossier', kind: 'text', default: '' }], run: async (ctx, i) => {
      const poste = s(i.poste), dossier = s(i.dossier);
      if (!poste) {
        if (!dossier) {
          const racines = [...montages().map((m) => ({ nom: m, chemin: m, genre: 'montage' })), ...['/mnt', '/media', join(ctx.home, '..', 'Téléchargements'), join(ctx.home, '..', 'Downloads')].filter((d) => existsSync(d)).map((d) => ({ nom: d, chemin: d, genre: 'dossier' }))];
          return { text: `${racines.length} endroit(s), ${postesSmb(ctx).length} poste(s) avec partage`, data: { entrees: racines, postes: postesSmb(ctx).map((m) => ({ id: m.id, nom: m.label, hote: m.host })) } };
        }
        let l: string[] = []; try { l = readdirSync(dossier); } catch (e) { throw new Error(`dossier illisible : ${(e as Error).message}`); }
        const entrees = l.filter((x) => !x.startsWith('.')).map((x) => { try { const st = statSync(join(dossier, x)); return st.isDirectory() ? { nom: x, chemin: join(dossier, x), genre: 'dossier' } : /\.iso$/i.test(x) ? { nom: x, chemin: join(dossier, x), genre: 'iso', taille: st.size } : undefined; } catch { return undefined; } }).filter(Boolean);
        return { text: `${entrees.length} entrée(s)`, data: { entrees } };
      }
      const p = postesSmb(ctx).find((m) => m.id === poste || m.label === poste); if (!p) throw new Error('poste inconnu');
      if (!s(i.partage)) { const l = await partagesSmb(p); return { text: `${l.length} partage(s)`, data: { entrees: l.map((x) => ({ nom: x.nom, partage: x.nom, genre: 'partage' })) } }; }
      const l = await dossierSmb(p, s(i.partage), dossier);
      return { text: `${l.length} entrée(s)`, data: { entrees: l.filter((x) => x.dossier || /\.iso$/i.test(x.nom)).filter((x) => x.nom !== '.' && x.nom !== '..').map((x) => ({ nom: x.nom, chemin: [dossier, x.nom].filter(Boolean).join('/'), genre: x.dossier ? 'dossier' : 'iso', taille: x.octets })) } };
    } },
    { id: 'fiche_iso', quick: false, label: 'Fiche d\'une ISO', what: 'Tout sur une ISO : système, version, architecture, édition, taille, dates, source, empreinte (et celle de l\'éditeur), antivirus, dernière vérification, machines qui l\'utilisent', read: true, params: [{ key: 'iso', label: 'ISO', kind: 'text', required: true }], run: async (ctx, i) => {
      await synchroEspace(ctx); const f = await trouverIso(ctx, i.iso);
      return { text: [`📀 ${f.nom}${f.ancienne ? ' (ancienne version, dans « old »)' : ''}`, `Système : ${f.systeme} · ${f.detail}${f.version ? ` · version ${f.version}` : ''}${f.arch ? ` · ${f.arch}` : ''}${f.edition ? ` · ${f.edition}` : ''}`, `Taille : ${go(f.taille)} · ajoutée le ${new Date(f.ajoute).toLocaleString('fr-FR')}`, `Source : ${f.source ?? f.origine}`, `Empreinte SHA-256 : ${f.sha256 ?? 'pas encore calculée'}${f.editeur === true ? ' · identique à celle publiée par l\'éditeur' : f.editeur === false ? ' · l\'éditeur n\'en publie pas' : ''}`, `Antivirus : ${f.antivirus?.verdict ?? 'non analysé'}${f.antivirus?.at ? ` (${new Date(f.antivirus.at).toLocaleString('fr-FR')})` : ''}`, `Dernière vérification : ${f.verifiee ? `${new Date(f.verifiee.at).toLocaleString('fr-FR')} · ${f.verifiee.texte}` : 'jamais'}`, `Machines qui l'utilisent : ${f.vms?.length ? f.vms.join(', ') : 'aucune'}`].join('\n'), data: f };
    } },
    { id: 'iso_deplacee', quick: false, label: 'ISO déplacée par Andromède', what: 'Une ancienne version rangée dans « old » ou supprimée : les machines qui la citent suivent', params: [{ key: 'liste', label: 'Déplacements (JSON)', kind: 'textarea', required: true }], run: (ctx, i) => {
      const l = JSON.parse(s(i.liste)) as Array<{ de: string; vers: string; nouveau: string }>; const out = isoDeplacee(ctx, l);
      return { text: out.join('\n') || 'Aucune machine ne citait cette ISO.', data: out };
    } },
    { id: 'verification_iso', label: 'Planifier la vérification des ISO', what: 'Quand Odin vérifie toutes les ISO (empreinte, antivirus, nouvelles versions) : chaque jour, semaine ou mois (mensuelle par défaut)', params: [{ key: 'frequence', label: 'Fréquence', kind: 'select', options: ['mois', 'semaine', 'jour'], default: 'mois' }, { key: 'jour', label: 'Jour (1 à 28 pour le mois, 0 = dimanche … 6 pour la semaine)', kind: 'number', default: 1 }, { key: 'heure', label: 'Heure (HH:MM)', kind: 'text', default: '04:00' }], run: (ctx, i) => {
      const f = (['mois', 'semaine', 'jour'].includes(s(i.frequence)) ? s(i.frequence) : 'mois') as PlanVerif['frequence'], h = /^\d{1,2}:\d\d$/.test(s(i.heure)) ? s(i.heure).padStart(5, '0') : '04:00';
      const j = f === 'semaine' ? Math.max(0, Math.min(6, Number(i.jour) || 0)) : Math.max(1, Math.min(28, Number(i.jour) || 1));
      const p: PlanVerif = { ...planVerif(ctx), frequence: f, jour: j, heure: h }; ctx.saveSettings({ verifIso: p });
      return { text: `🗓 Vérification des ISO : chaque ${f}${f === 'mois' ? ` (le ${j})` : f === 'semaine' ? ` (${['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][j]})` : ''} à ${h}. Prochaine : ${prochaineVerif(p, ctx.now()).toLocaleString('fr-FR')}.`, data: { ...p, prochaine: prochaineVerif(p, ctx.now()).toISOString() } };
    } },
    { id: 'plan_verif_iso', quick: false, label: 'Plan de vérification des ISO', what: 'Quand les ISO sont vérifiées, et le prochain passage', read: true, run: (ctx) => { const p = planVerif(ctx), n = prochaineVerif(p, ctx.now()); return { text: `Chaque ${p.frequence}${p.frequence === 'mois' ? ` (le ${p.jour})` : p.frequence === 'semaine' ? ` (jour ${p.jour})` : ''} à ${p.heure} · prochaine : ${n.toLocaleString('fr-FR')}${p.derniere ? ` · dernière : ${new Date(p.derniere).toLocaleString('fr-FR')}` : ''}.`, data: { ...p, prochaine: n.toISOString() } }; } },
    { id: 'verifier_isos', label: 'Vérifier toutes les ISO', what: 'Maintenant : empreinte recalculée, nouvelle analyse antivirus, nouvelles versions ; compte rendu', words: ['verifie les iso', 'vérifie les iso'], run: async (ctx) => { await synchroEspace(ctx); const r = await verifierIsos(ctx); return { text: r.texte, data: r }; } },
    { id: 'comptes_rendus_iso', quick: false, label: 'Comptes rendus des vérifications', what: 'L\'historique des vérifications des ISO', read: true, run: (ctx) => { const l = comptesRendus(ctx); return { text: l.map((x) => `— ${new Date(x.at).toLocaleString('fr-FR')}\n${x.texte}`).join('\n') || 'Aucune vérification faite.', data: l }; } },
    // Pour le démarrage par le réseau (Genèse) : l'état de chaque image de la bibliothèque. Seules les images
    // « prêtes » (complètes ET passées par l'antivirus) sont démarrables ; une image en quarantaine n'est plus dans
    // le dossier : elle n'est donc jamais proposée.
    { id: 'isos_pxe', quick: false, label: 'Images pour le démarrage réseau', what: 'L\'état de chaque ISO de la bibliothèque : prête, scannée (pas encore analysée), ancienne (old), en cours de téléchargement, en quarantaine', read: true, run: async (ctx) => {
      await synchroEspace(ctx); const B = bibliothequeIso(ctx);
      // Une ISO déposée dans le dossier est analysée ici (10 s au plus par appel ; les plus grosses au passage suivant).
      const fin = Date.now() + 10_000; for (const x of B.sansFiche()) { if (Date.now() > fin) break; await B.importer(x.chemin, { origine: 'déposée', source: 'déposée dans l\'espace ISO' }).catch(() => undefined); }
      const l = await bibliotheque(ctx);
      const jobs = ((ctx.modules().find((m) => m.id === 'eitri') as unknown as { _jobs?: () => Array<{ file: string; done: number; total?: number }> } | undefined)?._jobs?.() ?? []);
      const enCours = B.enCours().map((x) => { const j = jobs.find((y) => y.file === x.nom), total = j?.total; return { nom: x.nom, recu: j?.done ?? x.recu, ...(total ? { total, pct: Math.min(99, Math.floor(((j?.done ?? x.recu) / total) * 100)) } : {}) }; });
      const q = await ctx.call('ullr', 'quarantaine', {}, 'images en quarantaine', { interne: true }).catch(() => undefined);
      const quarantaine = ((q?.data as Array<{ id: string; nom?: string; file: string; threat: string }> | undefined) ?? []).filter((x) => /\.iso$/i.test(x.nom ?? x.file)).map((x) => ({ nom: x.nom ?? basename(x.file), menace: x.threat, id: x.id }));
      const images = l.map((f) => ({ chemin: f.chemin, nom: f.nom, systeme: f.systeme, detail: f.detail, etat: f.antivirus?.verdict === 'non analysé' || f.antivirus?.verdict === 'bloqué' ? 'scannée' : f.ancienne ? 'ancienne' : 'prête' }));
      return { text: `${images.filter((x) => x.etat === 'prête').length} image(s) prête(s), ${images.filter((x) => x.etat === 'scannée').length} à analyser, ${images.filter((x) => x.etat === 'ancienne').length} ancienne(s), ${enCours.length} en cours, ${quarantaine.length} en quarantaine`, data: { dossier: espaceIso(ctx), images, enCours, quarantaine } };
    } },
    // ---------------- Logiciels d'Hermès dans les machines ----------------
    { id: 'logiciels_disponibles', quick: false, label: 'Logiciels d\'Hermès', what: 'Les logiciels qu\'Hermès garde à jour, à installer dans une machine', read: true, run: async (ctx) => { const l = await logicielsHermes(ctx); return { text: l.map((x) => `- ${x.nom} ${x.version} (${basename(x.chemin)})`).join('\n') || 'Hermès ne garde encore aucun logiciel.', data: l }; } },
    { id: 'installer_logiciel', label: 'Installer un logiciel', what: 'Installe dans une machine un logiciel venu d\'Hermès (antivirus d\'abord) ; ses mises à jour suivront', params: [{ key: 'machine', label: 'Machine', kind: 'text', required: true }, { key: 'logiciel', label: 'Logiciel (Hermès)', kind: 'text', required: true }],
      grave: (i) => `installer ${s(i.logiciel)} dans la machine ${s(i.machine)}`, run: async (ctx, i) => {
        const L = new Local(ctx), m = L.find(i.machine), l = await logicielsHermes(ctx), q = s(i.logiciel).toLowerCase();
        const x = l.find((y) => y.source === q || y.nom.toLowerCase() === q) ?? l.find((y) => y.nom.toLowerCase().includes(q)); if (!x) throw new Error(`logiciel inconnu d'Hermès : « ${s(i.logiciel)} »`);
        const t = await installer(ctx, L, m, x);
        return { text: t };
      } },
    { id: 'mettre_a_jour_logiciels', label: 'Mettre à jour les logiciels', what: 'Installe dans une machine les nouvelles versions apportées par Hermès', params: [{ key: 'machine', label: 'Machine', kind: 'text', required: true }], grave: (i) => `mettre à jour les logiciels de la machine ${s(i.machine)}`, run: async (ctx, i) => {
      const L = new Local(ctx), m = L.find(i.machine), l = await logicielsHermes(ctx), out: string[] = [];
      for (const a of retards(m, l)) out.push(await installer(ctx, L, m, a.nouveau).catch((e) => `⚠ ${a.nouveau.nom} : ${(e as Error).message}`));
      return { text: out.join('\n') || `${m.nom} : tous ses logiciels sont à jour.` };
    } },
  ];
}

export interface Logiciel { source: string; nom: string; version: string; chemin: string }
export async function logicielsHermes(ctx: ModCtx): Promise<Logiciel[]> {
  // La bibliothèque d'Hermès : tout installateur sain (téléchargé, importé ou déposé), sauf les anciennes versions.
  const r = await ctx.call('fjalar', 'bibliotheque_logiciels', {}, 'logiciels à installer dans une machine', { interne: true }).catch(() => undefined);
  const l = ((r?.data as { fichiers?: Array<{ produit?: string; nom: string; version?: string; chemin: string; ancienne?: boolean; antivirus?: { verdict?: string } }> } | undefined)?.fichiers ?? [])
    .filter((f) => !f.ancienne && f.antivirus?.verdict !== 'bloqué').map((f): Logiciel => ({ source: (f.produit || f.nom).toLowerCase().replace(/[^a-z0-9]+/g, '-'), nom: f.produit || f.nom, version: f.version ?? '', chemin: f.chemin }));
  // La dernière version de chaque logiciel.
  const best = new Map<string, Logiciel>(); for (const x of l) { const b = best.get(x.source); if (!b || x.version.localeCompare(b.version, undefined, { numeric: true }) > 0) best.set(x.source, x); }
  return [...best.values()];
}
/** Les logiciels d'une machine dont Hermès a une version plus récente. Pur. */
export function retards(m: Pick<Machine, 'logiciels'>, l: Logiciel[]): Array<{ installe: string; nouveau: Logiciel }> {
  return (m.logiciels ?? []).flatMap((x) => { const n = l.find((y) => y.source === x.source); return n && n.version.localeCompare(x.version, undefined, { numeric: true }) > 0 ? [{ installe: x.version, nouveau: n }] : []; });
}
/** La commande d'installation silencieuse d'un fichier, selon son type et le système. Pure. */
export function commandeInstall(fichier: string, systeme: 'linux' | 'windows'): string | undefined {
  const f = fichier.toLowerCase();
  if (systeme === 'windows') return f.endsWith('.msi') ? `msiexec /i "${fichier}" /qn /norestart` : f.endsWith('.exe') ? `"${fichier}" /S` : undefined;
  return f.endsWith('.deb') ? `apt-get install -yq "${fichier}"` : f.endsWith('.rpm') ? `dnf -y install "${fichier}"` : f.endsWith('.sh') ? `sh "${fichier}"` : f.endsWith('.appimage') ? `chmod +x "${fichier}"` : undefined;
}
async function installer(ctx: ModCtx, L: Local, m: Machine, x: Logiciel): Promise<string> {
  if (m.quarantaine) throw new Error(`${m.nom} est en quarantaine : rien n'y est installé`);
  // Antivirus d'abord, même pour un fichier déjà vérifié par Hermès (les signatures ont pu changer).
  await exigerSain({ fichier: x.chemin, origine: 'Hermès · logiciel', source: x.nom, usage: `l'installer dans ${m.nom}` }, ctx);
  const nomF = basename(x.chemin);
  let fait = '';
  if (m.genre === 'lxc') {
    const r = await ctx.run('sh', ['-c', `mkdir -p "${join(L.lxcDir, m.nom, 'rootfs', 'root', 'odin-logiciels')}" && cp "${x.chemin}" "${join(L.lxcDir, m.nom, 'rootfs', 'root', 'odin-logiciels', nomF)}"`], { timeoutMs: 600_000, sudo: true });
    if (r.code !== 0) throw new Error(`copie dans ${m.nom} impossible : ${(r.err || r.out).trim().slice(0, 200)}`);
    const cmd = commandeInstall(`/root/odin-logiciels/${nomF}`, 'linux');
    if (cmd) { const z = await ctx.run('lxc-attach', ['-P', L.lxcDir, '-n', m.nom, '--', 'sh', '-c', cmd], { timeoutMs: 1_200_000, sudo: true }); if (z.code !== 0) throw new Error(`installation refusée : ${(z.err || z.out).trim().split('\n').at(-1)?.slice(0, 200)}`); fait = 'installé'; }
    else fait = `copié dans /root/odin-logiciels (${nomF} n'est pas un paquet pour Linux)`;
  } else {
    // Une VM : par le compte rangé dans Satellites (SSH ou PowerShell), comme pour les autres postes.
    const p = listMachines(ctx.home).find((y) => y.host === m.ip); if (!p) throw new Error(`ajoute ${m.nom} (${m.ip}) dans Satellites avec son compte : Odin s'y connecte pour installer`);
    const win = m.famille === 'Windows', dest = win ? `C:\\Windows\\Temp\\${nomF}` : `/tmp/${nomF}`;
    const c = await ctx.run('scp', ['-o', 'BatchMode=yes', '-P', String(p.port || 22), x.chemin, `${p.user}@${p.host}:${win ? `C:/Windows/Temp/${nomF}` : dest}`], { timeoutMs: 1_200_000 });
    if (c.code !== 0) throw new Error(`envoi du fichier vers ${m.nom} impossible (clé SSH d'Odin installée ?) : ${(c.err || c.out).trim().slice(0, 200)}`);
    const cmd = commandeInstall(dest, win ? 'windows' : 'linux'); if (!cmd) throw new Error(`${nomF} : type d'installateur inconnu`);
    const r = await ctx.call('hermod', 'commande', { machine: p.label, commande: win ? cmd : `sudo ${cmd}` }, `installer ${x.nom} dans ${m.nom}`, { interne: true });
    if (r.ok === false) throw new Error(r.text.slice(0, 200));
    fait = 'installé';
  }
  m.logiciels = [...(m.logiciels ?? []).filter((y) => y.source !== x.source), { source: x.source, nom: x.nom, version: x.version, at: Date.now() }]; L.update(m);
  ctx.emit('logiciel_installe', { machine: m.nom, logiciel: x.nom, version: x.version });
  return `📦 ${x.nom} ${x.version} ${fait} dans ${m.nom}. Hermès suivra ses mises à jour.`;
}

/** Surveillance de la bibliothèque : une ISO déposée à la main entre dans la bibliothèque (une par passage, antivirus
 * compris) ; la vérification planifiée (mensuelle par défaut) se fait à son heure. */
export async function surveillerIsos(ctx: ModCtx): Promise<void> {
  await synchroEspace(ctx);
  const f = await bibliothequeIso(ctx).scanner();
  if (f) ctx.emit('iso_reconnue', { nom: f.nom, systeme: f.systeme ?? '' });
  if (verifDue(planVerif(ctx), ctx.now())) await verifierIsos(ctx);
}
