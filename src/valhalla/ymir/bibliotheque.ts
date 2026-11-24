// Hydre · les actions de la bibliothèque d'ISO (commune avec Andromède) et des logiciels d'Hermès installés dans
// les machines : espace ISO, importer (envoi en morceaux, lien, dossier, partage du réseau), parcourir le réseau,
// retirer ; installer un logiciel d'Hermès dans une machine, puis ses mises à jour.
// Lot S3 de la maquette « Genèse · Systèmes » : la fiche d'un système (versions gardées), « où il sert » (iso_usages :
// clés ODIN écrites, menu PXE, PC autorisés, déploiements en cours, machines virtuelles) et le retrait avec garde-fou
// (retirer_systeme : refus tant qu'un déploiement ou une VM allumée s'en sert, son nom tapé, jamais un fichier hors de
// la bibliothèque ; le menu PXE et les PC qui le citaient retombent sur un défaut sûr).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { cheminSmb, commandesSmb, dossierSmb, partagesSmb } from '../../machines/smb.ts';
import { listMachines, type Machine as Poste } from '../../machines/access.ts';
import { exigerSain } from '../ullr/garde.ts';
import { lienDeMaison } from '../lien.ts';
import { tacheEnPause } from '../automatismes.ts';
import { texteDesactivee } from '../activation.ts';
import type { Action, ModCtx } from '../types.ts';
import { tailleTexte } from '../forge/bibliotheque.ts';
import { bibliotheque, bibliothequeIso, comptesRendus, dossierArrivees, espaceIso, importerIso, importerLien, isoDeplacee, planVerif, prochaineVerif, sansFiche, trouverIso, verifDue, verifierIsos, type FicheIso, type PlanVerif } from './isos.ts';
import { allumee, Local, type Machine } from './local.ts';

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
    { id: 'bibliotheque_iso', label: 'Bibliothèque d\'ISO', what: 'Toutes les ISO de l\'espace ISO (Andromède et importées) : système, taille, empreinte, antivirus', read: true, words: ['bibliotheque d iso', 'mes iso', 'liste des iso', 'quelles iso'], run: async (ctx) => {
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
      words: ['importe une iso', 'importer une iso', 'ajoute une iso'],
      // Une adresse de la maison : seulement avec ton accord (jamais atteinte par une redirection, voir importerLien).
      grave: (i) => (lienDeMaison(i.lien) ? `télécharger une ISO depuis une adresse de ton réseau (${(() => { try { return new URL(s(i.lien)).host; } catch { return 'adresse locale'; } })()})` : undefined),
      run: async (ctx, i) => {
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
    // Lot S3 : le même garde-fou que « Retirer » de Genèse (refus tant qu'un déploiement ou une VM allumée s'en sert,
    // jamais un fichier hors de la bibliothèque, menu PXE et PC autorisés remis sur un défaut sûr), sans le nom tapé.
    { id: 'retirer_iso', label: 'Retirer une ISO', what: 'Supprime une ISO de la bibliothèque (et son fichier) ; refusé tant qu\'un déploiement ou une machine virtuelle allumée s\'en sert', proprietaireSeul: true, params: [{ key: 'iso', label: 'ISO', kind: 'text', required: true }], grave: (i) => `supprimer l'ISO ${s(i.iso)} de l'espace ISO (Andromède ne l'aura plus non plus)`, run: async (ctx, i) => retirerAvecGarde(ctx, i.iso) },
    { id: 'iso_usages', quick: false, label: 'Où sert une ISO', what: 'Les clés ODIN où elle a été copiée, le menu du démarrage par le réseau, les PC autorisés à la démarrer, les déploiements en cours et les machines virtuelles qui la citent ; ce qui empêche de la retirer', read: true, proprietaireSeul: true, params: [{ key: 'iso', label: 'ISO', kind: 'text', required: true }], run: async (ctx, i) => {
      await synchroEspace(ctx); const f = await trouverSysteme(ctx, i.iso), u = await usagesIso(ctx, f);
      return { text: [`${f.nom} :`, ...(u.usages.length ? u.usages.map((x) => `- ${ligneUsage(x)}`) : ['- rien ne s\'en sert (ni clé, ni menu, ni PC, ni machine virtuelle).']), ...(u.bloquants.length ? [`Retrait impossible pour l'instant : ${u.bloquants.join(' ; ')}`] : [])].join('\n'), data: { chemin: f.chemin, nom: f.nom, taille: f.taille, aTaper: nomATaper(f), ...u } };
    } },
    { id: 'retirer_systeme', quick: false, label: 'Retirer un système', what: 'Efface un système de la bibliothèque après avoir tapé son nom : refusé tant qu\'un déploiement ou une machine virtuelle allumée s\'en sert ; jamais un fichier hors de la bibliothèque ; le menu PXE et les PC qui le citaient retombent sur un défaut sûr', proprietaireSeul: true,
      params: [{ key: 'iso', label: 'ISO (chemin dans la bibliothèque)', kind: 'text', required: true }, { key: 'nom', label: 'Son nom, tapé', kind: 'text', required: true }],
      grave: (i) => `effacer le système ${s(i.iso).replace(/^.*[\\/]/, '')} de la bibliothèque (le fichier est supprimé)`,
      run: async (ctx, i) => retirerAvecGarde(ctx, i.iso, s(i.nom)) },
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
      await synchroEspace(ctx); const f = await trouverSysteme(ctx, i.iso), v = await versionsGardees(ctx, f);
      const vers = v.versions.map((x) => `${x.version ?? x.nom}${x.enService ? ' (en service)' : x.ancienne ? ' (dans « old »)' : ''}`);
      return { text: [`📀 ${f.nom}${f.ancienne ? ' (ancienne version, dans « old »)' : ''}`, `Système : ${f.systeme} · ${f.detail}${f.version ? ` · version ${f.version}` : ''}${f.arch ? ` · ${f.arch}` : ''}${f.edition ? ` · ${f.edition}` : ''}`, `Taille : ${go(f.taille)} · ajoutée le ${new Date(f.ajoute).toLocaleString('fr-FR')}`, `Source : ${f.source ?? f.origine}`, `Empreinte SHA-256 : ${f.sha256 ?? 'pas encore calculée'}${f.editeur === true ? ' · identique à celle publiée par l\'éditeur' : f.editeur === false ? ' · l\'éditeur n\'en publie pas' : ''}`, `Antivirus : ${f.antivirus?.verdict ?? 'non analysé'}${f.antivirus?.at ? ` (${new Date(f.antivirus.at).toLocaleString('fr-FR')})` : ''}`, `Dernière vérification : ${f.verifiee ? `${new Date(f.verifiee.at).toLocaleString('fr-FR')} · ${f.verifiee.texte}` : 'jamais'}`, `Machines qui l'utilisent : ${f.vms?.length ? f.vms.join(', ') : 'aucune'}`, `Versions gardées : ${vers.join(', ')}${v.nouvelle ? ` · ${v.nouvelle.version} disponible chez l'éditeur` : ''}`, ...(v.surveille !== undefined ? [`Gardé à jour : ${v.surveille ? 'oui, Andromède le surveille' : 'non'}`] : [])].join('\n'), data: { ...f, ...v } };
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
  if (verifDue(planVerif(ctx), ctx.now()) && !tacheEnPause('ymir', 'verification_iso')) await verifierIsos(ctx);
}

// ---------------------------------------------------------------- Lot S3 : où sert un système, et le retirer
/** Un usage d'une ISO, tel que la page le montre (les phrases sont faites par la page, dans sa langue). */
export interface UsageIso {
  genre: 'cle' | 'menu' | 'pc' | 'deploiement' | 'vm';
  /** ce qui s'en sert : la clé (son identifiant), le menu, le PC (son nom ou son adresse), le déploiement, la VM */
  nom: string;
  /** vrai : tant que cet usage dure, le système ne peut pas être retiré */
  bloque: boolean;
  /** clé : copiée le ; menu : position (1 = première entrée visible), par défaut, caché ; PC : adresse MAC, installation
   *  automatique ; déploiement : les PC ; VM : allumée, modèle */
  at?: number; position?: number; defaut?: boolean; cache?: boolean; mac?: string; auto?: boolean; pcs?: string[]; allumee?: boolean; modele?: boolean;
}
/** Ce qu'Odin sait déjà, lu dans Genèse (thjalfi), Hydre et le journal des clés ; absent : pas lu. */
export interface SourcesUsages {
  chemin: string; nom: string; sha256?: string;
  /** l'image telle que Genèse la connaissait à la première lecture : pendant le retrait, le fichier mis de côté n'est
   *  plus dans la liste de Genèse, mais ses déploiements et ses PC le citent toujours par cet identifiant et ce nom */
  connu?: { id: string; name: string };
  genese?: Array<{ id: string; name: string; path: string; recipe?: { auto?: boolean; label?: string } }>;
  menu?: { entrees?: Array<{ id: string; nom?: string; cache?: boolean }>; defaut?: string };
  autorises?: Array<{ mac: string; nom?: string; iso?: string; auto?: boolean; fait?: boolean }>;
  lots?: Array<{ iso: string; isoNom?: string; pcs?: Array<{ etat: string; nom?: string; mac?: string }> }>;
  enCours?: Array<{ mac: string; host?: string; iso?: string; step: string }>;
  vms?: Array<{ nom: string; iso?: string; allumee: boolean; modele?: boolean }>;
  cles?: Array<{ at: number; dest: string; sha256?: string; cible: string }>;
}
export interface BilanUsages {
  /** l'image telle que Genèse la connaît (identifiant du menu, s'installe toute seule) */
  genese?: { id: string; name: string; auto: boolean; label?: string };
  usages: UsageIso[];
  /** pourquoi le retrait est refusé maintenant (vide : permis) */
  bloquants: string[];
  /** ce qui a pu être lu */
  lu: { genese: boolean; cles: boolean; vms: boolean };
}
const slash = (p: string) => p.replace(/\\/g, '/');
/** Deux chemins du même fichier (« \ » ou « / », lettre de lecteur en majuscule ou non). Pur. */
const memeFichier = (a: string, b: string) => { const n = (x: string) => { const y = slash(x); return /^[a-z]:\//i.test(y) ? y.toLowerCase() : y; }; return n(a) === n(b); };
/** Le nom d'une ISO une fois copiée sur une clé ODIN (même règle que l'écriture de la clé). Pur. */
export const nomSurCle = (nom: string) => `${nom.replace(/\.iso$/i, '')}.iso`.replace(/[^\w.+-]/g, '_');
/** Un déploiement qui n'est pas fini : le PC attend son tour, s'installe, ou vient d'être relancé. */
const ETATS_VIVANTS = new Set(['attente', 'en cours', 'lancée']);
const ETAPES_FINALES = new Set(['fini', 'sans nouvelles', 'échec']);
/**
 * Où sert une ISO, et ce qui empêche de la retirer. Bloquent : un déploiement par le réseau pas fini (ou Genèse
 * illisible : Odin ne peut pas dire qu'il n'y en a pas), une machine virtuelle allumée qui la cite. Le reste est un
 * avertissement nommé : une clé garde sa copie, le menu perd l'entrée, un PC autorisé retombe sur le menu normal, une
 * VM éteinte garde son disque. Pur.
 */
export function bilanUsages(e: SourcesUsages): BilanUsages {
  const usages: UsageIso[] = [], bloquants: string[] = [];
  const g = e.genese?.find((x) => x && typeof x.path === 'string' && memeFichier(x.path, e.chemin)) ?? (e.genese && e.connu ? { ...e.connu, path: e.chemin } : undefined);
  const id = g?.id, nomG = g?.name;
  const cite = (x: unknown) => Boolean(id && (x === id || (nomG && x === nomG)));
  // Les clés ODIN où elle a été copiée (journal des écritures de clés) : la dernière fois, par clé.
  if (e.cles) {
    const dest = `ISO/${nomSurCle(e.nom)}`, par = new Map<string, number>();
    for (const l of e.cles) if (l && typeof l.cible === 'string' && l.cible && (l.dest === dest || (e.sha256 && l.sha256 === e.sha256))) par.set(l.cible, Math.max(par.get(l.cible) ?? 0, Number(l.at) || 0));
    for (const [cible, at] of [...par].sort((a, b) => b[1] - a[1])) usages.push({ genre: 'cle', nom: cible, bloque: false, ...(at ? { at } : {}) });
  }
  if (e.genese) {
    // Le menu du démarrage par le réseau.
    const l = e.menu?.entrees ?? [], k = id ? l.findIndex((x) => x.id === id) : -1;
    if (k >= 0) { const x = l[k]; usages.push({ genre: 'menu', nom: x.nom || nomG || e.nom, bloque: false, ...(x.cache ? { cache: true } : { position: l.slice(0, k + 1).filter((y) => !y.cache).length }), ...(e.menu?.defaut === id ? { defaut: true } : {}) }); }
    // Les PC autorisés à démarrer ce système (par leur adresse MAC). Non lus : refusé (une installation automatique
    // resterait armée pour un PC, et l'identifiant de ce système peut revenir avec un autre fichier du même nom).
    if (!Array.isArray(e.autorises)) bloquants.push('Genèse ne dit pas quels PC sont autorisés à démarrer ce système : Odin ne pourrait pas couper leur installation automatique');
    for (const r of e.autorises ?? []) if (r && cite(r.iso)) usages.push({ genre: 'pc', nom: r.nom || r.mac, mac: r.mac, bloque: false, ...(r.auto && !r.fait ? { auto: true } : {}) });
    // Les déploiements pas finis (Déployer, lot S6) et les installations en cours (PC autorisé un par un).
    for (const lot of e.lots ?? []) {
      if (!lot || !cite(lot.iso)) continue;
      const pcs = (lot.pcs ?? []).filter((p) => ETATS_VIVANTS.has(p.etat)).map((p) => p.nom || p.mac || '?');
      if (pcs.length) { usages.push({ genre: 'deploiement', nom: lot.isoNom || nomG || e.nom, bloque: true, pcs }); bloquants.push(`un déploiement par le réseau est en cours sur ${pcs.length} PC (${pcs.join(', ')}) : attends la fin ou annule-le dans Suivi`); }
    }
    const vivants = (e.enCours ?? []).filter((m) => m && cite(m.iso) && !ETAPES_FINALES.has(m.step)).map((m) => m.host || m.mac);
    if (vivants.length) { usages.push({ genre: 'deploiement', nom: nomG || e.nom, bloque: true, pcs: vivants }); bloquants.push(`${vivants.length} PC s'installe(nt) en ce moment avec ce système (${vivants.join(', ')}) : attends la fin ou annule dans Suivi`); }
  } else bloquants.push('Genèse ne répond pas : Odin ne peut pas vérifier qu\'aucun déploiement par le réseau ne s\'en sert');
  // Les machines virtuelles de Hydre qui la citent.
  for (const v of e.vms ?? []) {
    if (!v || !v.iso || !memeFichier(v.iso, e.chemin)) continue;
    usages.push({ genre: 'vm', nom: v.nom, bloque: v.allumee, ...(v.allumee ? { allumee: true } : {}), ...(v.modele ? { modele: true } : {}) });
    if (v.allumee) bloquants.push(`la machine virtuelle ${v.nom} est allumée avec cette ISO : arrête-la d'abord`);
  }
  if (!e.vms) bloquants.push('Hydre ne lit pas ses machines virtuelles : Odin ne peut pas vérifier qu\'aucune n\'est allumée avec cette ISO');
  return { ...(g ? { genese: { id: g.id, name: g.name, auto: Boolean(g.recipe?.auto), ...(g.recipe?.label ? { label: g.recipe.label } : {}) } } : {}), usages, bloquants, lu: { genese: Boolean(e.genese), cles: Boolean(e.cles), vms: Boolean(e.vms) } };
}
/** Une ligne en français pour la conversation. Pur. */
export function ligneUsage(u: UsageIso): string {
  const le = (t?: number) => (t ? ` le ${new Date(t).toLocaleDateString('fr-FR')}` : '');
  switch (u.genre) {
    case 'cle': return `Clé ODIN ${u.nom} : copié dessus${le(u.at)} ; la clé garde sa copie.`;
    case 'menu': return `Menu du démarrage par le réseau : ${u.cache ? 'entrée cachée' : `entrée ${u.position}`}${u.defaut ? ', par défaut' : ''} ; l'entrée disparaît${u.defaut ? ', et par défaut ce sera le disque du PC' : ''}.`;
    case 'pc': return `PC ${u.nom}${u.mac && u.mac !== u.nom ? ` (${u.mac})` : ''} : autorisé à démarrer ce système${u.auto ? ' en installation automatique' : ''} ; il retombe sur le menu normal, rien ne s'installe tout seul.`;
    case 'deploiement': return `Déploiement en cours sur ${u.pcs?.length ?? 0} PC (${(u.pcs ?? []).join(', ')}) : retrait impossible tant qu'il n'est pas fini.`;
    case 'vm': return u.allumee ? `Machine virtuelle ${u.nom} : allumée avec cette ISO ; retrait impossible tant qu'elle tourne.` : `Machine virtuelle ${u.nom}${u.modele ? ' (modèle)' : ''} : installée depuis cette ISO ; elle garde son disque.`;
  }
}
/** Le nom à taper pour retirer un système : celui de sa carte (« Ubuntu 24.04.1 »), sinon le nom du fichier sans « .iso ». Pur. */
export function nomATaper(f: Pick<FicheIso, 'nom' | 'detail' | 'version'>): string {
  const n = f.detail && !/^(Système inconnu|Linux|Windows|macOS|Autre)$/.test(f.detail) ? f.detail : f.nom.replace(/\.iso$/i, '');
  return f.version && !n.includes(f.version) ? `${n} ${f.version}` : n;
}
/** Le nom tapé est-il le bon ? Sans accents, majuscules ni espaces en trop. Pur. */
export const nomTapeJuste = (tape: unknown, attendu: string) => { const n = (x: unknown) => s(x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); return n(attendu) !== '' && n(tape) === n(attendu); };

/**
 * Le journal des clés ODIN écrites (lot C5), lu par Genèse elle-même (action en lecture « cle_journal », propriétaire
 * seul) : dans son fichier ou dans la base d'Odin. Genèse absente, désactivée ou muette : `undefined` (la page dit alors
 * seulement qu'une clé où il a été copié garde sa copie).
 */
export async function clesEcrites(ctx: ModCtx): Promise<SourcesUsages['cles']> {
  try {
    const r = await ctx.call('thjalfi', 'cle_journal', {}, 'les clés ODIN où ce système a été copié', { interne: true });
    const l = r.ok === false ? undefined : (r.data as { lignes?: unknown } | undefined)?.lignes;
    if (!Array.isArray(l)) return undefined;
    return l.flatMap((x: { at?: unknown; dest?: unknown; sha256?: unknown; cible?: unknown }) => (x && typeof x.dest === 'string' && typeof x.cible === 'string' ? [{ at: Number(x.at) || 0, dest: x.dest, sha256: s(x.sha256), cible: x.cible }] : []));
  } catch { return undefined; }
}
/** Où sert une ISO : lu dans Genèse (menu PXE, PC autorisés, déploiements), Hydre (VM) et le journal des clés. */
export async function usagesIso(ctx: ModCtx, f: FicheIso, connu?: { id: string; name: string }): Promise<BilanUsages> {
  // Genèse absente ou désactivée (ses serveurs sont alors arrêtés) : aucun déploiement ne peut tourner, rien ne bloque.
  const mod = ctx.modules().find((m) => m.id === 'thjalfi');
  let arretee = !mod;
  const lire = async <T,>(a: string, why: string): Promise<T | undefined> => {
    if (arretee) return undefined;
    try { const r = await ctx.call('thjalfi', a, {}, why, { interne: true }); if (r.ok === false) { if (mod && r.text === texteDesactivee(mod.name)) arretee = true; return undefined; } return r.data as T; } catch { return undefined; }
  };
  const genese = arretee ? [] : await lire<SourcesUsages['genese']>('isos', 'où sert ce système') ?? (arretee ? [] : undefined);
  const [menu, reseau, suivi, machines] = Array.isArray(genese) && !arretee ? await Promise.all([
    lire<SourcesUsages['menu']>('menu_pxe', 'ce système dans le menu PXE'),
    lire<{ autorises?: SourcesUsages['autorises'] }>('reseau', 'les PC autorisés à démarrer ce système'),
    lire<{ lots?: SourcesUsages['lots'] }>('deploiement_suivi', 'les déploiements de ce système'),
    lire<SourcesUsages['enCours']>('machines', 'les installations en cours'),
  ]) : [undefined, undefined, undefined, undefined];
  // Sans l'une des lectures des déploiements, Odin ne sait pas : le retrait est refusé (voir bilanUsages).
  const sur = arretee ? [] : Array.isArray(genese) && suivi && Array.isArray(machines) ? genese : undefined;
  let vms: SourcesUsages['vms'];
  try { const L = new Local(ctx); vms = await Promise.all(L.list().filter((m) => m.iso).map(async (m) => ({ nom: m.nom, iso: m.iso, allumee: m.genre === 'vm' && !m.estModele ? allumee(await L.etat(m)) : false, ...(m.estModele ? { modele: true } : {}) }))); } catch { vms = undefined; }
  const cles = arretee ? undefined : await clesEcrites(ctx);
  // Genèse arrêtée : aucun PC ne démarre par le réseau, rien à couper ; sinon, les PC autorisés DOIVENT être lus.
  const autorises = arretee ? [] : Array.isArray(reseau?.autorises) ? reseau!.autorises : undefined;
  return bilanUsages({ chemin: f.chemin, nom: f.nom, ...(f.sha256 ? { sha256: f.sha256 } : {}), ...(connu ? { connu } : {}), ...(sur ? { genese: sur } : {}), ...(menu ? { menu } : {}), ...(autorises ? { autorises } : {}), lots: suivi?.lots ?? [], enCours: Array.isArray(machines) ? machines : [], ...(vms ? { vms } : {}), ...(cles ? { cles } : {}) });
}
/**
 * Le système désigné par son chemin dans la bibliothèque, tel que la page l'a (la carte de Genèse l'écrit en minuscules,
 * avec « / ») : le chemin exact, sinon le SEUL fichier au même chemin à la casse près (deux fichiers qui ne diffèrent que
 * par la casse : refusé, jamais un au hasard) ; sinon, comme avant, par son nom (conversation).
 */
export async function trouverSysteme(ctx: ModCtx, q: unknown, o: { strict?: boolean } = {}): Promise<FicheIso> {
  const t = slash(s(q).trim());
  if (t.includes('/')) {
    const l = await bibliotheque(ctx), exact = l.filter((x) => slash(x.chemin) === t);
    if (exact.length === 1) return exact[0];
    const casse = l.filter((x) => slash(x.chemin).toLowerCase() === t.toLowerCase());
    if (casse.length === 1) return casse[0];
    if (casse.length > 1) throw new Error('plusieurs fichiers de la bibliothèque ne diffèrent que par les majuscules : rien n\'est choisi au hasard (renomme l\'un d\'eux)');
  }
  if (!o.strict) return trouverIso(ctx, q);
  // Pour effacer : l'identifiant ou le chemin exact, sinon UN SEUL fichier qui porte ce nom (ou le contient) ; plusieurs :
  // refusé, jamais un au hasard (la validation ne montrait que le nom demandé).
  const l = await bibliotheque(ctx), low = t.toLowerCase(), sans = (n: string) => n.toLowerCase().replace(/\.iso$/i, '');
  const un = (x: FicheIso[]) => { if (x.length > 1) throw new Error(`plusieurs ISO répondent à « ${s(q).trim()} » (${x.slice(0, 4).map((y) => y.nom + (y.ancienne ? ' dans « old »' : '')).join(', ')}) : rien n'est effacé, choisis-la dans la liste`); return x[0]; };
  const id = l.filter((x) => x.id === s(q).trim()); if (id.length) return un(id);
  const nom = l.filter((x) => x.nom.toLowerCase() === low || sans(x.nom) === low); if (nom.length) return un(nom);
  const part = low.length >= 3 ? l.filter((x) => x.nom.toLowerCase().includes(low)) : [];
  if (part.length) return un(part);
  return trouverIso(ctx, q);
}
/**
 * Retirer un système avec son garde-fou : refus s'il sert maintenant (déploiement, VM allumée) ; le nom tapé quand il
 * est demandé (Genèse) ; le fichier mis de côté puis effacé, jamais un autre (forge/bibliotheque.ts), les usages relus
 * une fois mis de côté ; ensuite le menu PXE et les PC autorisés qui le citaient retombent sur un défaut sûr.
 */
export async function retirerAvecGarde(ctx: ModCtx, q: unknown, nomTape?: string): Promise<{ ok: boolean; text: string; data?: unknown }> {
  await synchroEspace(ctx);
  const f = await trouverSysteme(ctx, q, { strict: true }), u = await usagesIso(ctx, f);
  if (u.bloquants.length) return { ok: false, text: `Refusé, rien n'est effacé : ${u.bloquants.join(' ; ')}.`, data: { bloquants: u.bloquants } };
  if (nomTape !== undefined && !nomTapeJuste(nomTape, nomATaper(f))) return { ok: false, text: `Refusé, rien n'est effacé : il faut taper exactement « ${nomATaper(f)} ».`, data: { aTaper: nomATaper(f) } };
  const connu = u.genese ? { id: u.genese.id, name: u.genese.name } : undefined, apres: string[] = [];
  // Une fois le fichier mis de côté (il n'est plus dans la liste de Genèse, mais ses déploiements le citent toujours par
  // son identifiant) : tout est relu ; un déploiement lancé entre-temps le remet à sa place. Puis, AVANT d'effacer, chaque
  // PC qui le cite retombe sur le menu normal : si Genèse refuse pour l'un d'eux, le fichier revient, rien n'est effacé.
  const remis = () => (apres.length ? ` (déjà remis sur le menu normal, sans installation automatique : ${apres.map((x) => x.replace(/ : menu normal.*$/, '')).join(', ')})` : '');
  try {
    await bibliothequeIso(ctx).retirer(f.chemin, { garde: async () => {
      const v = await usagesIso(ctx, f, connu);
      if (v.bloquants.length) return `Refusé, rien n'est effacé : ${v.bloquants.join(' ; ')}.`;
      for (const p of v.usages.filter((x) => x.genre === 'pc')) {
        const r = await ctx.call('thjalfi', 'autoriser', { mac: p.mac, nom: p.nom !== p.mac ? p.nom : '', auto: false }, 'le système de ce PC est retiré', { interne: true }).catch((e: Error) => ({ ok: false, text: e.message }));
        if (r.ok === false) return `Refusé, rien n'est effacé : ${p.nom} cite ce système et Genèse ne le remet pas sur le menu normal (${r.text})${remis()}.`;
        apres.push(`${p.nom} : menu normal, rien ne s'installe tout seul.`);
      }
      return undefined;
    } });
  } catch (e) { const m = (e as Error).message; return { ok: false, text: /^Refusé/.test(m) ? m : `Refusé : ${m}${remis()}.` }; }
  // Le menu : lu à la première lecture (une fois le fichier mis de côté, Genèse ne le montre plus).
  const menu = u.usages.find((x) => x.genre === 'menu');
  if (menu?.defaut) {
    const r = await ctx.call('thjalfi', 'menu_pxe_regler', { defaut: 'disque' }, 'le système par défaut a été retiré', { interne: true }).catch((e: Error) => ({ ok: false, text: e.message }));
    apres.unshift(r.ok === false ? `⚠ Le menu PXE le proposait par défaut : remets « le disque du PC » dans Réseau → Menu PXE (${r.text}).` : 'Menu PXE : par défaut, le disque du PC.');
  } else if (menu) apres.unshift('Menu PXE : l\'entrée a disparu.');
  for (const c of u.usages.filter((x) => x.genre === 'cle')) apres.push(`La clé ODIN ${c.nom} garde sa copie.`);
  for (const v of u.usages.filter((x) => x.genre === 'vm')) apres.push(`La machine virtuelle ${v.nom} garde son disque.`);
  ctx.emit('iso_retiree', { nom: f.nom });
  return { ok: true, text: [`🗑 ${f.nom} retirée de la bibliothèque (${tailleTexte(f.taille)} libérés).`, ...apres].join('\n'), data: { retire: f.nom, apres } };
}

type Disponible = { nom: string; chemin: string; taille?: number; ancienne?: boolean; source?: string; versionReconnue?: string; derniere?: string; etat?: string };
/** Les versions d'un système gardées dans la bibliothèque (celle-ci, l'ancienne dans « old »), et la nouvelle chez l'éditeur. */
export interface VersionsGardees {
  versions: Array<{ nom: string; chemin: string; taille: number; version?: string; ancienne: boolean; enService: boolean }>;
  nouvelle?: { version: string; source: string };
  /** Andromède le garde à jour (surveillé) ; absent : Andromède ne répond pas */
  surveille?: boolean;
  source?: string;
}
/** Ce qu'Andromède sait de ce système (sa source au catalogue), sinon la fiche seule. */
export async function versionsGardees(ctx: ModCtx, f: FicheIso): Promise<VersionsGardees> {
  const lire = async <T,>(a: string, why: string): Promise<T | undefined> => { try { const r = await ctx.call('eitri', a, {}, why, { interne: true }); return r.ok === false ? undefined : r.data as T; } catch { return undefined; } };
  const [d, sv] = await Promise.all([lire<{ fichiers?: Disponible[] }>('disponibles', 'les versions gardées de ce système'), lire<{ surveilles?: Array<{ id: string }> }>('surveilles', 'ce système est-il gardé à jour')]);
  return assemblerVersions(f, d?.fichiers, sv?.surveilles);
}
/** Les versions gardées : même source au catalogue d'Andromède ; la nouvelle seulement si l'éditeur en publie une plus récente. Pur. */
export function assemblerVersions(f: Pick<FicheIso, 'nom' | 'chemin' | 'taille' | 'version' | 'ancienne'>, fichiers?: Disponible[], surveilles?: Array<{ id: string }>): VersionsGardees {
  const l = Array.isArray(fichiers) ? fichiers.filter((x) => x && typeof x.chemin === 'string') : [];
  const moi = l.find((x) => memeFichier(x.chemin, f.chemin)), src = moi?.source;
  const autres = src ? l.filter((x) => x.source === src && !memeFichier(x.chemin, f.chemin)) : [];
  const v = (x: { nom: string; chemin: string; taille?: number; ancienne?: boolean }, version?: string) => ({ nom: x.nom, chemin: x.chemin, taille: Number(x.taille) || 0, ...(version ? { version } : {}), ancienne: Boolean(x.ancienne), enService: !x.ancienne });
  const versions = [v(f, moi?.versionReconnue ?? f.version), ...autres.map((x) => v(x, x.versionReconnue))]
    .sort((a, b) => Number(b.enService) - Number(a.enService) || s(b.version).localeCompare(s(a.version), undefined, { numeric: true }));
  const nouvelle = moi && !moi.ancienne && moi.etat === 'nouvelle version' && moi.derniere && src ? { version: moi.derniere, source: src } : undefined;
  return { versions, ...(nouvelle ? { nouvelle } : {}), ...(Array.isArray(surveilles) ? { surveille: Boolean(src && surveilles.some((x) => x && x.id === src)) } : {}), ...(src ? { source: src } : {}) };
}
