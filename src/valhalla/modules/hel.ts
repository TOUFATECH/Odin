// Perséphone (identifiant « hel ») — retrouver des partitions perdues et des fichiers effacés (les idées de
// TestDisk et de PhotoRec, code maison écrit d'après les formats publics : rien n'est repris de ces logiciels GPL).
// Règles qui ne se discutent pas :
//  - le support fouillé (disque, partition, clé USB, carte SD ou fichier image) est ouvert en LECTURE SEULE ;
//  - les fichiers retrouvés vont sur un AUTRE disque (vérifié pour de vrai : périphérique du dossier de destination) ;
//  - réparer une table de partitions est la seule écriture sur un support : avec ton accord, après une copie de
//    secours des secteurs touchés rangée ailleurs, et avec « Remettre la table d'avant ».
// Le travail (lecture du support, tables, systèmes de fichiers, signatures) est dans `src/valhalla/hel/`.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { taille } from '../hel/octets.ts';
import { FAMILLES, type Famille } from '../hel/signatures.ts';
import { estSysteme, lireLsblk, montesSur, disqueDe, ouvrir, peutRanger, type Peripherique } from '../hel/support.ts';
import { NOM_GENRE } from '../hel/systemes.ts';
import { chercher, ecrireTable, lireTableVue, listerSecours, proposer, recuperer, remettreTable, type Rapport, type ResultatPartitions, type Suivi } from '../hel/travail.ts';
import type { ActionResult, ModCtx, Module, Section, Tone } from '../types.ts';

const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x)).trim();
const LSBLK = ['-J', '-b', '-o', 'NAME,PATH,SIZE,TYPE,MOUNTPOINTS,FSTYPE,MODEL,SERIAL,TRAN,RM,RO,LABEL,PTTYPE'];
const NOMS_FAMILLE: Record<string, string> = { photos: 'Photos', videos: 'Vidéos', documents: 'Documents', archives: 'Archives', son: 'Son', autres: 'Autres' };
const CHOIX_FAMILLES = ['tout', ...FAMILLES];
const ATTENTION = 'N\'écris plus rien sur ce support (pas de copie, pas d\'installation, pas de formatage) : chaque écriture peut effacer pour de bon ce qu\'on cherche à retrouver.';

// ---------------- Le travail en cours (un seul à la fois par Odin) ----------------
interface Travail { genre: 'partitions' | 'récupération'; source: string; debut: number; arret: { stop: boolean }; suivi: Suivi; fin: Promise<void> }
const travaux = new Map<string, Travail>();

const lireJson = <T>(f: string): T | undefined => { try { return JSON.parse(readFileSync(f, 'utf8')) as T; } catch { return undefined; } };
const derniereRecherche = (ctx: ModCtx) => lireJson<ResultatPartitions>(join(ctx.dir, 'partitions.json'));
const dossierRapports = (ctx: ModCtx) => join(ctx.dir, 'rapports');
const dossierSecours = (ctx: ModCtx) => join(ctx.dir, 'secours');
function rapports(ctx: ModCtx): Rapport[] {
  let n: string[] = []; try { n = readdirSync(dossierRapports(ctx)).filter((x) => x.endsWith('.json')); } catch { return []; }
  return n.map((x) => lireJson<Rapport>(join(dossierRapports(ctx), x))).filter((r): r is Rapport => Boolean(r)).sort((a, b) => b.debut.localeCompare(a.debut));
}
const rapport = (ctx: ModCtx, id?: string) => (id ? rapports(ctx).find((r) => r.id === id) : rapports(ctx)[0]);

/** Les supports de la machine (disques, partitions, clés, cartes), d'après lsblk. */
async function supports(ctx: ModCtx): Promise<Peripherique[]> {
  if (process.platform !== 'linux') return [];
  const r = await ctx.run('lsblk', LSBLK, { timeoutMs: 15_000 }).catch(() => ({ code: 1, out: '', err: '' }));
  return r.code === 0 ? lireLsblk(r.out) : [];
}
const ditSupport = (p: Peripherique) => `${p.chemin} · ${taille(p.taille)}${p.modele ? ` · ${p.modele}` : ''}${p.etiquette ? ` « ${p.etiquette} »` : ''}${p.fs ? ` (${p.fs})` : ''}${p.amovible ? ' · amovible' : ''}`;

/** Le support voulu : celui de la demande, sinon celui choisi sur la page. */
const sourceDe = (ctx: ModCtx, i: Record<string, unknown>) => s(i.source) || s(i.disque) || s(ctx.settings.source);
const PAS_DE_SOURCE: ActionResult = { ok: false, text: 'Choisis d\'abord le support à fouiller (étape 1) : un disque, une partition, une clé USB, une carte SD, ou le chemin d\'un fichier image (.img, .dd, .iso).' };

/** Ouvre le support le temps de `f` (lecture seule), avec une phrase claire s'il ne s'ouvre pas. */
async function avecSupport<T>(chemin: string, f: (x: Awaited<ReturnType<typeof ouvrir>>) => Promise<T>): Promise<T | { erreur: string }> {
  let x; try { x = await ouvrir(chemin); } catch (e) { return { erreur: `Je ne peux pas lire ce support : ${(e as Error).message}.` }; }
  try { return await f(x); } finally { await x.fermer(); }
}
const estErreur = (x: unknown): x is { erreur: string } => typeof x === 'object' && x !== null && 'erreur' in x;

/** Ce que dit findmnt du dossier (sa source), pour savoir sur quel disque il est quand le système ne le dit pas. */
async function sourceDuDossier(ctx: ModCtx, dossier: string): Promise<string | undefined> {
  if (!await ctx.has('findmnt')) return undefined;
  const r = await ctx.run('findmnt', ['-n', '-o', 'SOURCE', '-T', dossier], { timeoutMs: 10_000 }).catch(() => undefined);
  return r?.code === 0 ? r.out.trim() : undefined;
}

/** La table actuelle d'un support, en lignes lisibles. */
async function texteTable(chemin: string): Promise<ActionResult> {
  const t = await avecSupport(chemin, async (x) => ({ taille: x.taille, vue: await lireTableVue(x) }));
  if (estErreur(t)) return { ok: false, text: t.erreur };
  const v = t.vue, genre = v.genre === 'aucune' ? 'pas de table de partitions' : `table ${v.genre.toUpperCase()}`;
  return { text: [`💽 ${chemin} · ${taille(t.taille)} · ${genre}${v.partitions.length ? ` · ${v.partitions.length} partition(s)` : ''}`,
    ...v.partitions.map((p) => `- n°${p.numero} : ${taille(p.taille)} à partir de ${taille(p.debut)} · ${p.fs ?? p.type}${p.etiquette ? ` « ${p.etiquette} »` : ''}`),
    ...v.remarques.map((r) => `ℹ ${r}`)].join('\n'), data: v };
}

function lancer(ctx: ModCtx, t: Omit<Travail, 'fin' | 'debut' | 'arret' | 'suivi'>, f: (arret: { stop: boolean }, suivi: Suivi) => Promise<void>): Travail {
  const arret = { stop: false }, suivi: Suivi = { fait: 0, total: 0, trouves: 0, etape: 'Démarrage' };
  const job: Travail = { ...t, debut: Date.now(), arret, suivi, fin: Promise.resolve() };
  job.fin = f(arret, suivi).catch((e) => { ctx.alert({ level: 'moyenne', title: `Perséphone : ${t.genre} interrompue`, detail: `${(e as Error).message}. Rien n'a été écrit sur le support.`, key: `hel:echec:${t.source}` }); })
    .finally(() => { if (travaux.get(ctx.dir) === job) travaux.delete(ctx.dir); });
  travaux.set(ctx.dir, job);
  return job;
}
const occupe = (ctx: ModCtx): ActionResult | undefined => { const j = travaux.get(ctx.dir); return j ? { ok: false, text: `Une ${j.genre} est déjà en cours sur ${j.source} (${pct(j.suivi)}). Attends la fin, ou dis « arrête la récupération ».` } : undefined; };
const pct = (x: Suivi) => `${x.total ? Math.min(100, Math.floor((x.fait / x.total) * 100)) : 0} %`;

/** Le résumé d'une récupération, en clair (sans promettre ce qui n'a pas été retrouvé). */
function resume(r: Rapport): string {
  const n = r.compte.entiers + r.compte.abimes + r.compte.nonVerifiables;
  const fam = Object.entries(r.parFamille).map(([k, x]) => `${NOMS_FAMILLE[k] ?? k} ${x.n}`).join(', ');
  return [`${n ? `🗂 ${n} fichier(s) retrouvé(s)` : 'Aucun fichier retrouvé'} depuis ${r.source}${r.arretee ? ' (arrêtée avant la fin)' : ''}${fam ? ` : ${fam}` : ''}.`,
    `${r.compte.entiers} entier(s) vérifié(s), ${r.compte.abimes} abîmé(s) (rangés à part dans « abîmés »), ${r.compte.nonVerifiables} non vérifiable(s).`,
    ...(r.compte.ecrases ? [`${r.compte.ecrases} fichier(s) vu(s) dans les dossiers mais dont la place a été reprise : ils ne se récupèrent pas.`] : []),
    ...(r.compte.tropGros ? [`${r.compte.tropGros} trop gros pour la limite choisie (non recopiés).`] : []),
    ...(r.illisibles ? [`⚠ ${taille(r.illisibles)} illisibles sur le support (secteurs abîmés) : remplis de zéros.`] : []),
    ...(r.erreur ? [`⚠ ${r.erreur}`] : []),
    `Rangés dans ${r.dossier} (rapport détaillé : rapport-${r.id}.txt). Tout n'est pas forcément retrouvable : ce qui a été écrasé est perdu.`].join('\n');
}

const nomAppli = (ctx: ModCtx, id: string, defaut: string) => ctx.modules().find((m) => m.id === id)?.name ?? defaut;

export const hel: Module & { similaires: string[] } = {
  id: 'hel', name: 'Perséphone', family: 'Données',
  what: 'Retrouve des partitions perdues et des fichiers effacés (photos, vidéos, documents, archives, son) sur un disque, une clé USB, une carte SD ou un fichier image ; le support est seulement lu, et ce qui est retrouvé va sur un autre disque.',
  does: [
    'Voir les supports de la machine et leur table de partitions (MBR, GPT), ou ouvrir un fichier image',
    'Chercher les partitions perdues (ext2/3/4, NTFS, FAT, exFAT, XFS, Btrfs, swap) et la copie de secours GPT, puis proposer une table',
    'Réparer la table de partitions avec ton accord, après une copie de secours, et la remettre comme avant si besoin',
    'Retrouver les fichiers effacés avec leur nom sur FAT et exFAT, et tous les autres par leurs signatures (JPEG, PNG, GIF, MP4/MOV, AVI, MKV, PDF, DOCX/XLSX/ODT, DOC, ZIP, 7z, RAR, gz, MP3, WAV, FLAC…)',
    'Vérifier chaque fichier retrouvé (structure lisible) et ranger à part ceux qui sont abîmés, avec un rapport',
    'Proposer l\'analyse antivirus du dossier retrouvé (Asclépios) et prévenir dans le fil d\'alertes',
  ],
  from: ['TestDisk', 'PhotoRec'], upstream: [],
  similaires: ['TestDisk', 'PhotoRec', 'Recuva', 'R-Studio', 'Disk Drill'],
  words: ['fichiers effacés', 'photos effacées', 'mes photos effacées', 'fichiers retrouvés', 'partitions perdues', 'partition perdue', 'récupération de fichiers', 'récupérer des fichiers', 'table de partitions', 'perséphone'],
  actions: [
    { id: 'supports', label: 'Supports à fouiller', what: 'Les disques, partitions, clés USB et cartes SD de la machine', read: true, words: ['supports a fouiller', 'quels supports'], run: async (ctx) => {
      const l = await supports(ctx);
      if (!l.length) return { text: 'Je ne vois aucun support ici (ou lsblk n\'est pas là). Tu peux me donner le chemin d\'un fichier image (.img, .dd) à la place.' };
      return { text: `💽 ${l.length} support(s) :\n${l.map((p) => `- ${ditSupport(p)}${estSysteme(p, l) ? ' · porte le système' : montesSur(disqueDe(p, l), l).length ? ' · en service (monté)' : ''}`).join('\n')}`, data: l };
    } },
    { id: 'ouvrir', label: 'Choisir le support', what: 'Le disque, la partition, la clé, la carte ou le fichier image à fouiller (rien n\'y est écrit)', read: true, params: [{ key: 'disque', label: 'Support (/dev/sdb, /dev/mmcblk0…) ou fichier image', kind: 'text', required: true }], words: ['ouvre le support', 'fouille le disque', 'fouille la cle'], run: async (ctx, i) => {
      const chemin = s(i.disque); if (!chemin) return PAS_DE_SOURCE;
      const r = await texteTable(chemin); if (r.ok === false) return r;
      ctx.saveSettings({ source: chemin });
      return { ...r, text: `${r.text}\n⚠ ${ATTENTION}\nÉtape suivante : choisis où ranger ce qui sera retrouvé, sur un AUTRE disque.` };
    } },
    { id: 'table', label: 'Table de partitions', what: 'La table de partitions actuelle du support choisi, et ce qu\'il y a dans chaque partition', read: true, params: [{ key: 'source', label: 'Support (vide : celui choisi)', kind: 'text' }], words: ['table de partitions'], run: (ctx, i) => { const c = sourceDe(ctx, i); return c ? texteTable(c) : PAS_DE_SOURCE; } },
    { id: 'chercher', label: 'Chercher les partitions perdues', what: 'Parcourt le support (lecture seule) à la recherche des débuts de systèmes de fichiers et des copies de la table GPT', read: true, params: [{ key: 'source', label: 'Support (vide : celui choisi)', kind: 'text' }, { key: 'profondeur', label: 'Recherche', kind: 'select', options: ['rapide', 'complète'], default: 'rapide', help: 'Rapide : aux endroits habituels (quelques minutes). Complète : chaque secteur (long sur un gros disque).' }], words: ['partitions perdues', 'cherche les partitions', 'retrouve les partitions'], run: async (ctx, i) => {
      const c = sourceDe(ctx, i); if (!c) return PAS_DE_SOURCE;
      const o = occupe(ctx); if (o) return o;
      const profondeur = s(i.profondeur) === 'complète' || s(i.profondeur) === 'complete' ? 'complète' : 'rapide';
      let sup; try { sup = await ouvrir(c); } catch (e) { return { ok: false, text: `Je ne peux pas lire ce support : ${(e as Error).message}.` }; }
      ctx.saveSettings({ source: c });
      const quand = ctx.now().toISOString();
      lancer(ctx, { genre: 'partitions', source: c }, async (arret, suivi) => {
        try {
          const r = await chercher(sup, { profondeur, arret, suivi, quand });
          mkdirSync(ctx.dir, { recursive: true }); writeFileSync(join(ctx.dir, 'partitions.json'), JSON.stringify(r));
          ctx.emit('partitions_cherchees', { source: c, trouvees: r.trouvees.length });
        } finally { await sup.fermer(); }
      });
      return { text: `🔎 Recherche ${profondeur} des partitions lancée sur ${c} (${taille(sup.taille)}), en lecture seule. Suis-la dans l'onglet « Partitions » ; dis « arrête la récupération » pour la couper.` };
    } },
    { id: 'proposer', label: 'Table proposée', what: 'Ce que j\'écrirais pour remettre la table de partitions (rien n\'est écrit)', read: true, params: [{ key: 'source', label: 'Support (vide : celui choisi)', kind: 'text' }, { key: 'genre', label: 'Genre de table', kind: 'select', options: ['automatique', 'gpt', 'mbr'], default: 'automatique' }], words: ['table proposee'], run: async (ctx, i) => {
      const c = sourceDe(ctx, i); if (!c) return PAS_DE_SOURCE;
      const p = await avecSupport(c, (x) => proposer(x, derniereRecherche(ctx), (s(i.genre) || 'automatique') as 'automatique'));
      if (estErreur(p)) return { ok: false, text: p.erreur };
      if ('refus' in p) return { ok: false, text: p.refus };
      return { text: [`📝 Table ${p.genre.toUpperCase()} proposée pour ${c} : ${p.explication}`, ...p.partitions.map((x) => `- n°${x.numero} : ${taille(x.taille)} à partir de ${taille(x.debut)} · ${x.type}${x.etiquette ? ` « ${x.etiquette} »` : ''}`),
        `Secteurs qui seraient écrits : ${p.ecritures.map((e) => `${e.quoi} (${taille(e.data.length)} à ${taille(e.pos)})`).join(', ')}.`, 'Rien n\'est écrit tant que tu n\'as pas dit « Réparer la table » et donné ton accord.'].join('\n'), data: { genre: p.genre, partitions: p.partitions } };
    } },
    { id: 'reparer', label: 'Réparer la table', what: 'Écrit la table proposée, après une copie de secours des secteurs touchés (début et fin du support) rangée ailleurs', quick: false, words: ['repare la table de partitions'], params: [{ key: 'source', label: 'Support (vide : celui choisi)', kind: 'text' }, { key: 'genre', label: 'Genre de table', kind: 'select', options: ['automatique', 'gpt', 'mbr'], default: 'automatique' }],
      grave: (i, ctx) => `écrire une nouvelle table de partitions sur ${sourceDe(ctx!, i) || 'le support choisi'} (seuls les secteurs de la table sont écrits ; une copie de secours est faite avant, et « Remettre la table d'avant » la remet)`,
      undo: (_i, r) => { const id = (r.data as { secours?: string } | undefined)?.secours; return id ? { action: 'remettre', input: { id }, label: 'Remettre la table d\'avant' } : undefined; },
      run: async (ctx, i) => {
        const c = sourceDe(ctx, i); if (!c) return PAS_DE_SOURCE;
        const o = occupe(ctx); if (o) return o;
        const l = await supports(ctx), p = l.find((x) => x.chemin === c || x.chemin === (() => { try { return realpathSync(c); } catch { return c; } })());
        if (p && estSysteme(p, l)) return { ok: false, text: `${c} porte le système en marche : je n'y écris jamais de table. Fais-en une image (sur un autre disque) et répare l'image, ou démarre sur un autre système.` };
        if (p && montesSur(disqueDe(p, l), l).length) return { ok: false, text: `Une partition de ${disqueDe(p, l).chemin} est montée (${montesSur(disqueDe(p, l), l).join(', ')}) : démonte-la d'abord. Écrire une table sous un système en service peut tout abîmer.` };
        if (p?.genre === 'partition') return { ok: false, text: `${c} est une partition : la table de partitions se répare sur le disque entier (${p.parent}).` };
        const prop = await avecSupport(c, (x) => proposer(x, derniereRecherche(ctx), (s(i.genre) || 'automatique') as 'automatique'));
        if (estErreur(prop)) return { ok: false, text: prop.erreur };
        if ('refus' in prop) return { ok: false, text: prop.refus };
        // La copie de secours ne doit pas être sur le support qu'on modifie.
        const rep = dossierSecours(ctx); mkdirSync(rep, { recursive: true });
        const ici = peutRanger({ chemin: c, bloc: Boolean(p) }, rep, { findmnt: await sourceDuDossier(ctx, rep) });
        if (!ici.ok) return { ok: false, text: `Je ne peux pas ranger la copie de secours à côté d'Odin : ${ici.raison}. Je n'écris rien.` };
        let m; try { m = await ecrireTable(c, prop.ecritures, rep, { quand: ctx.now().toISOString(), quoi: `table ${prop.genre.toUpperCase()} (${prop.mode === 'copie' ? 'copie refaite' : 'partitions retrouvées'})` }); }
        catch (e) { return { ok: false, text: `Réparation abandonnée : ${(e as Error).message}.` }; }
        ctx.alert({ level: 'info', title: `Perséphone : table de partitions réparée sur ${c}`, detail: `${prop.explication} Copie de secours ${m.id} gardée ; « Remettre la table d'avant » la remet si besoin.`, key: `hel:table:${m.id}`, fix: { module: 'hel', action: 'remettre', label: 'Remettre la table d\'avant', input: { id: m.id } } });
        return { text: `✅ Table ${prop.genre.toUpperCase()} écrite sur ${c} (${prop.partitions.length} partition(s)). Copie de secours « ${m.id} » (début et fin du support) gardée dans les données de Perséphone.\nDébranche et rebranche le support (ou redémarre) pour que le système relise la table.`, data: { secours: m.id } };
      } },
    { id: 'remettre', label: 'Remettre la table d\'avant', what: 'Remet les secteurs gardés avant une réparation : le support revient octet pour octet comme avant', quick: false, params: [{ key: 'id', label: 'Copie de secours', kind: 'text', required: true }],
      grave: (i) => `réécrire sur le support les secteurs gardés dans la copie de secours ${s(i.id)} (la table d'avant la réparation revient)`,
      run: async (ctx, i) => {
        const id = s(i.id), m = listerSecours(dossierSecours(ctx)).find((x) => x.id === id);
        if (!m) return { ok: false, text: `Je ne trouve pas la copie de secours « ${id.slice(0, 40)} ». Les copies gardées sont dans l'onglet « Partitions ».` };
        const o = occupe(ctx); if (o) return o;
        try { await remettreTable(dossierSecours(ctx), id, m.source); } catch (e) { return { ok: false, text: `Je n'ai rien remis : ${(e as Error).message}.` }; }
        return { text: `↩ ${m.source} est revenu comme avant la réparation du ${new Date(m.quand).toLocaleString('fr-FR')} (zones relues et vérifiées). Débranche et rebranche le support pour que le système relise la table.` };
      } },
    { id: 'recuperer', label: 'Récupérer les fichiers effacés', what: 'Recopie sur un AUTRE disque les fichiers effacés retrouvés (avec leur nom sur FAT et exFAT, sinon par leur signature), vérifiés un par un', params: [
      { key: 'source', label: 'Support (vide : celui choisi)', kind: 'text' },
      { key: 'destination', label: 'Où ranger ce qui est retrouvé (un dossier sur un AUTRE disque ; vide : celui choisi)', kind: 'text' },
      { key: 'familles', label: 'Quoi chercher', kind: 'select', options: CHOIX_FAMILLES, default: 'tout' },
      { key: 'noms', label: 'Retrouver aussi les noms (FAT, exFAT)', kind: 'boolean', default: true },
      { key: 'plafond', label: 'Taille maximale d\'un fichier (Mo, 0 : selon le type)', kind: 'number', default: 0 },
    ], words: ['retrouve mes photos effacees', 'recupere les fichiers effaces', 'recuperer les fichiers effaces', 'fichiers supprimes'], run: async (ctx, i) => {
      const c = sourceDe(ctx, i); if (!c) return PAS_DE_SOURCE;
      const o = occupe(ctx); if (o) return o;
      const dest = s(i.destination) || s(ctx.settings.destination);
      if (!dest) return { ok: false, text: 'Dis-moi où ranger ce qui sera retrouvé : un dossier sur un AUTRE disque que le support (un disque USB, un autre disque interne).' };
      let sup; try { sup = await ouvrir(c); } catch (e) { return { ok: false, text: `Je ne peux pas lire ce support : ${(e as Error).message}.` }; }
      const v = peutRanger(sup, dest, { findmnt: await sourceDuDossier(ctx, dest), sousDossier: 'recuperes' });
      if (!v.ok) { await sup.fermer(); return { ok: false, text: `Je refuse de ranger là : ${v.raison}.` }; }
      const fam = s(i.familles), familles = fam && fam !== 'tout' ? fam.split(/[,\s]+/).filter((x): x is Famille => (FAMILLES as string[]).includes(x)) : undefined;
      if (fam && fam !== 'tout' && !familles?.length) { await sup.fermer(); return { ok: false, text: `« ${fam} » : choisis parmi ${CHOIX_FAMILLES.join(', ')}.` }; }
      const plafond = Math.max(0, Number(i.plafond) || 0) * 1024 * 1024;
      ctx.saveSettings({ source: c, destination: resolve(dest) });
      const quand = ctx.now().toISOString(), id = `${quand.slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-')}-${randomBytes(2).toString('hex')}`;
      lancer(ctx, { genre: 'récupération', source: c }, async (arret, suivi) => {
        let r: Rapport;
        try { r = await recuperer(sup, resolve(dest), { ...(familles ? { familles } : {}), ...(plafond ? { plafond } : {}), noms: i.noms !== false && s(i.noms) !== 'false', arret, suivi, quand, id }); }
        finally { await sup.fermer(); }
        r.fin = ctx.now().toISOString();
        mkdirSync(dossierRapports(ctx), { recursive: true }); writeFileSync(join(dossierRapports(ctx), `${id}.json`), JSON.stringify(r));
        const n = r.compte.entiers + r.compte.abimes + r.compte.nonVerifiables, asc = nomAppli(ctx, 'ullr', 'Asclépios');
        ctx.alert({ level: r.erreur ? 'moyenne' : 'info', title: `Perséphone : ${n} fichier(s) retrouvé(s) depuis ${c}${r.arretee ? ' (arrêtée)' : ''}`, detail: resume(r), key: `hel:recup:${id}`,
          steps: ['Ouvre le dossier retrouvé et garde ce qui compte.', `Fais analyser le dossier par ${asc} avant d'ouvrir les fichiers (ils viennent d'un support dont on ne sait rien).`, 'Les fichiers abîmés sont rangés à part : certains s\'ouvrent quand même en partie.'],
          fix: { module: 'hel', action: 'analyser', label: `Analyser avec ${asc}`, input: { rapport: id } } });
        ctx.emit('recuperation_terminee', { id, source: c, dossier: r.dossier, fichiers: n, abimes: r.compte.abimes });
      });
      return { text: `🗂 Récupération lancée depuis ${c} (${taille(sup.taille)}) vers ${join(resolve(dest), 'recuperes')}${familles ? ` (${familles.map((f) => NOMS_FAMILLE[f]).join(', ')})` : ''}. Le support est seulement lu.\n⚠ ${ATTENTION}\nSuis l'avancement dans l'onglet « Récupérer » ; dis « arrête la récupération » pour la couper (ce qui est déjà retrouvé est gardé).`, data: { id } };
    } },
    { id: 'arreter', label: 'Arrêter la récupération', what: 'Coupe la recherche ou la récupération en cours (ce qui est déjà retrouvé est gardé)', words: ['arrete la recuperation', 'stoppe la recuperation', 'arrete la recherche des partitions'], run: async (ctx) => {
      const j = travaux.get(ctx.dir); if (!j) return { text: 'Rien n\'est en cours.' };
      j.arret.stop = true; await Promise.race([j.fin, new Promise((r) => setTimeout(r, 5000))]);
      return { text: `⏹ ${j.genre === 'partitions' ? 'Recherche des partitions' : 'Récupération'} arrêtée sur ${j.source} à ${pct(j.suivi)} ; ce qui a été trouvé est gardé.` };
    } },
    { id: 'resultats', label: 'Fichiers retrouvés', what: 'Le résumé de la dernière récupération (ou de celle dont tu donnes l\'identifiant)', read: true, params: [{ key: 'rapport', label: 'Récupération (vide : la dernière)', kind: 'text' }], words: ['fichiers retrouves', 'resultat de la recuperation'], run: (ctx, i) => {
      const r = rapport(ctx, s(i.rapport) || undefined); const j = travaux.get(ctx.dir);
      if (!r) return { text: j ? `Une ${j.genre} est en cours (${pct(j.suivi)}, ${j.suivi.trouves} trouvé(s)).` : 'Aucune récupération faite pour l\'instant.' };
      return { text: resume(r), data: { id: r.id, dossier: r.dossier, compte: r.compte } };
    } },
    { id: 'analyser', label: 'Analyser les fichiers retrouvés', what: 'Fait analyser par l\'antivirus (Asclépios) le dossier d\'une récupération', params: [{ key: 'rapport', label: 'Récupération (vide : la dernière)', kind: 'text' }], words: ['analyse les fichiers retrouves'], run: async (ctx, i) => {
      const r = rapport(ctx, s(i.rapport) || undefined); if (!r) return { ok: false, text: 'Aucune récupération à analyser pour l\'instant.' };
      if (!ctx.modules().some((m) => m.id === 'ullr')) return { ok: false, text: 'L\'antivirus d\'Odin n\'est pas là : analyse le dossier avec ton antivirus avant d\'ouvrir les fichiers.' };
      const a = await ctx.call('ullr', 'analyser', { dossier: r.dossier }, 'des fichiers viennent d\'être retrouvés sur un support inconnu : les analyser avant de les ouvrir', { interne: true });
      return { ok: a.ok !== false, text: `${nomAppli(ctx, 'ullr', 'Asclépios')} : ${a.text}` };
    } },
    { id: 'destination', label: 'Choisir où ranger', what: 'Le dossier (sur un AUTRE disque) où ranger ce qui sera retrouvé : vérifié tout de suite', quick: false, params: [{ key: 'destination', label: 'Dossier', kind: 'text', required: true }], run: async (ctx, i) => {
      const d = s(i.destination), c = s(ctx.settings.source);
      if (!d) return { ok: false, text: 'Donne un dossier, sur un autre disque que le support.' };
      if (c) {
        const v = await avecSupport(c, async (x) => peutRanger(x, d, { findmnt: await sourceDuDossier(ctx, d), sousDossier: 'recuperes' }));
        if (estErreur(v)) return { ok: false, text: v.erreur };
        if (!v.ok) return { ok: false, text: `Je refuse ce dossier : ${v.raison}.` };
      } else if (!existsSync(d) || !statSync(d).isDirectory()) return { ok: false, text: `Le dossier « ${d} » n'existe pas : crée-le d'abord, sur un autre disque que le support.` };
      ctx.saveSettings({ destination: resolve(d) });
      return { text: `📁 Les fichiers retrouvés iront dans ${join(resolve(d), 'recuperes')}${c ? ` (vérifié : pas sur le même disque que ${c})` : ''}.` };
    } },
  ],
  async view(ctx) {
    const R = 'Récupérer', P = 'Partitions', Re = 'Résultats', j = travaux.get(ctx.dir), l = await supports(ctx), source = s(ctx.settings.source), dest = s(ctx.settings.destination);
    const sections: Section[] = [], derniere = derniereRecherche(ctx), tous = rapports(ctx), dernier = tous[0], secours = listerSecours(dossierSecours(ctx));
    let vue: Awaited<ReturnType<typeof lireTableVue>> | undefined, tailleSource = 0, erreurSource = '';
    if (source) { const t = await avecSupport(source, async (x) => ({ v: await lireTableVue(x), n: x.taille })); if (estErreur(t)) erreurSource = t.erreur; else { vue = t.v; tailleSource = t.n; } }
    const destOk = Boolean(dest) && existsSync(dest);
    // ---- Récupérer : la marche à suivre, l'avertissement, le travail en cours.
    sections.push({ kind: 'text', title: 'Avant tout', text: ATTENTION, tone: 'attention', onglet: R });
    sections.push({ kind: 'steps', title: 'Marche à suivre', onglet: R, items: [
      { title: '1. Choisir le support', detail: source ? `${source}${tailleSource ? ` · ${taille(tailleSource)}` : ''}${erreurSource ? ` — ${erreurSource}` : ''}` : 'Le disque, la clé USB, la carte SD ou le fichier image où étaient les fichiers. Il est seulement lu.', done: Boolean(source) && !erreurSource },
      { title: '2. Choisir où ranger, sur un AUTRE disque', detail: dest ? `${join(dest, 'recuperes')}${destOk ? '' : ' (dossier introuvable)'}` : 'Jamais sur le support fouillé : je vérifie le disque du dossier et je refuse sinon.', done: destOk },
      { title: '3. Lancer', detail: j ? `${j.genre} en cours (${pct(j.suivi)})` : dernier ? `Dernière récupération : ${dernier.compte.entiers + dernier.compte.abimes + dernier.compte.nonVerifiables} fichier(s)` : 'Retrouve les fichiers effacés : photos, vidéos, documents, archives, son.', done: Boolean(dernier) && !j },
    ] });
    sections.push({ kind: 'actions', title: '1. Le support', onglet: R, boutons: [{ action: 'supports', label: 'Voir les supports' }], liste: { label: 'Support', action: 'ouvrir', champ: 'disque', bouton: 'Choisir', libre: 'Un fichier image (chemin)…', valeurs: l.map((p) => ({ valeur: p.chemin, label: `${ditSupport(p)}${estSysteme(p, l) ? ' · système' : ''}` })) }, aide: 'Disque abîmé ? Fais-en d\'abord une image sur un autre disque (dd, ddrescue) et fouille l\'image : le disque est moins sollicité.' });
    sections.push({ kind: 'form', title: '2 et 3. Où ranger, puis lancer', action: 'recuperer', submit: j ? 'Un travail est déjà en cours' : 'Retrouver les fichiers', onglet: R, params: [
      { key: 'destination', label: 'Dossier sur un AUTRE disque', kind: 'text', default: dest },
      { key: 'familles', label: 'Quoi chercher', kind: 'select', options: CHOIX_FAMILLES, default: 'tout' },
      { key: 'noms', label: 'Retrouver aussi les noms (FAT, exFAT)', kind: 'boolean', default: true },
    ], aide: 'Tout n\'est pas forcément retrouvable : ce qui a été écrasé depuis est perdu. Chaque fichier retrouvé est vérifié ; les abîmés sont rangés à part.' });
    if (j) sections.push({ kind: 'cards', title: 'En cours', onglet: j.genre === 'partitions' ? P : R, items: [{ title: `${j.genre === 'partitions' ? 'Recherche des partitions' : 'Récupération'} · ${j.source}`, sub: j.suivi.etape, badge: pct(j.suivi), progress: j.suivi.total ? j.suivi.fait / j.suivi.total : 0, meta: `${taille(j.suivi.fait)} lus sur ${taille(j.suivi.total)} · ${j.suivi.trouves} trouvé(s) · depuis ${Math.round((Date.now() - j.debut) / 1000)} s`, actions: [{ action: 'arreter', label: 'Arrêter', input: {} }] }] });
    // ---- Partitions : la table actuelle, la recherche, la table proposée, les copies de secours.
    if (vue) sections.push({ kind: 'table', title: `Table actuelle de ${source} : ${vue.genre === 'aucune' ? 'aucune' : vue.genre.toUpperCase()}`, onglet: P, columns: ['N°', 'Début', 'Taille', 'Type', 'Contenu', 'Étiquette'], empty: vue.remarques[0] ?? 'Aucune partition dans la table.', rows: vue.partitions.map((p) => ({ cells: [String(p.numero), taille(p.debut), taille(p.taille), p.type, p.fs ?? '—', p.etiquette ?? ''] })) });
    if (vue?.remarques.length) sections.push({ kind: 'list', title: 'Ce que je remarque', onglet: P, items: vue.remarques.map((r) => ({ title: r, tone: /abîm|fausse|absente|illisible/i.test(r) ? 'attention' as Tone : 'neutre' as Tone })) });
    sections.push({ kind: 'form', title: 'Chercher les partitions perdues', action: 'chercher', submit: 'Chercher', onglet: P, params: [{ key: 'profondeur', label: 'Recherche', kind: 'select', options: ['rapide', 'complète'], default: 'rapide' }], aide: 'Lecture seule. La table proposée apparaît ici ensuite ; rien n\'est écrit sans ton accord.' });
    if (derniere && derniere.source === source) {
      sections.push({ kind: 'table', title: `Partitions retrouvées (recherche ${derniere.profondeur}${derniere.arretee ? ', arrêtée' : ''})`, onglet: P, columns: ['Début', 'Taille', 'Système', 'Étiquette', 'Cohérence', 'Remarques'], empty: 'Aucun système de fichiers retrouvé.', rows: derniere.trouvees.map((t) => ({ cells: [taille(t.debut), taille(t.taille), NOM_GENRE[t.genre], t.etiquette ?? '', t.coherence, t.notes.join(' ; ')], ...(t.coherence === 'douteuse' ? { tone: 'attention' as Tone } : {}) })) });
      const p = await avecSupport(source, (x) => proposer(x, derniere));
      if (!estErreur(p)) sections.push('refus' in p
        ? { kind: 'text', title: 'Table proposée', text: p.refus, onglet: P }
        : { kind: 'table', title: `Table ${p.genre.toUpperCase()} proposée (rien n'est écrit)`, onglet: P, columns: ['N°', 'Début', 'Taille', 'Type', 'Étiquette'], rows: [...p.partitions.map((x) => ({ cells: [String(x.numero), taille(x.debut), taille(x.taille), x.type, x.etiquette ?? ''] })), { cells: ['', '', '', p.explication, ''], actions: [{ action: 'reparer', label: 'Réparer la table', input: { source } }] }] });
    }
    sections.push({ kind: 'table', title: 'Copies de secours des tables', onglet: P, columns: ['Quand', 'Support', 'Ce qui a été écrit'], empty: 'Aucune réparation faite : rien à remettre.', rows: secours.map((m) => ({ cells: [new Date(m.quand).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }), m.source, m.quoi], actions: [{ action: 'remettre', label: 'Remettre la table d\'avant', input: { id: m.id } }] })) });
    // ---- Résultats : la dernière récupération, les fichiers, l'antivirus.
    if (dernier) {
      sections.push({ kind: 'text', title: `Dernière récupération (${new Date(dernier.debut).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })})`, text: resume(dernier), onglet: Re, tone: dernier.compte.abimes || dernier.erreur ? 'attention' : 'bon' });
      sections.push({ kind: 'bars', title: 'Par type', onglet: Re, items: Object.entries(dernier.parFamille).map(([k, x]) => ({ label: NOMS_FAMILLE[k] ?? k, value: x.n, display: `${x.n} · ${taille(x.octets)}` })) });
      sections.push({ kind: 'actions', title: 'Avant d\'ouvrir les fichiers', onglet: Re, boutons: [{ action: 'analyser', label: `Analyser avec ${nomAppli(ctx, 'ullr', 'Asclépios')}`, input: { rapport: dernier.id }, primary: true }], aide: 'Ils viennent d\'un support dont on ne sait rien : une analyse antivirus d\'abord.' });
      sections.push({ kind: 'list', title: 'Fichiers retrouvés', onglet: Re, large: true, empty: 'Aucun fichier.', aide: dernier.fichiers.length > 60 ? `Les 60 premiers ; la liste complète est dans rapport-${dernier.id}.txt.` : undefined, items: dernier.fichiers.slice(0, 60).map((f) => ({ title: f.chemin, detail: `${taille(f.taille)} · ${f.origine === 'nom' ? 'avec son nom' : 'par signature'}${f.note ? ` · ${f.note}` : ''}`, meta: f.etat, tone: f.etat === 'entier' ? 'bon' as Tone : f.etat === 'abîmé' ? 'mauvais' as Tone : 'neutre' as Tone, fichier: { nom: f.chemin.split('/').at(-1)!, ref: `${dernier.id}/${f.chemin}` } })) });
      if (dernier.perdus.length) sections.push({ kind: 'list', title: 'Vus, mais perdus (place reprise)', onglet: Re, items: dernier.perdus.slice(0, 30).map((x) => ({ title: x.chemin, detail: x.note, tone: 'attention' as Tone })) });
    } else sections.push({ kind: 'text', title: 'Pas encore de récupération', text: 'Suis les trois étapes de l\'onglet « Récupérer ».', onglet: Re });
    if (tous.length > 1) sections.push({ kind: 'table', title: 'Récupérations précédentes', onglet: Re, columns: ['Quand', 'Support', 'Entiers', 'Abîmés', 'Dossier'], rows: tous.slice(1, 20).map((r) => ({ cells: [new Date(r.debut).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }), r.source, String(r.compte.entiers), String(r.compte.abimes), r.dossier] })) });
    return {
      subtitle: `${source ? `Support : ${source}` : 'Aucun support choisi'}${j ? ` · ${j.genre} en cours (${pct(j.suivi)})` : ''}`,
      kpis: [{ label: 'Support', value: source ? (tailleSource ? taille(tailleSource) : '?') : '—' }, { label: 'Partitions', value: vue ? String(vue.partitions.length) : '—' }, { label: 'Fichiers retrouvés', value: dernier ? String(dernier.compte.entiers + dernier.compte.abimes + dernier.compte.nonVerifiables) : '—', tone: dernier ? 'bon' : 'neutre' }, { label: 'Abîmés', value: dernier ? String(dernier.compte.abimes) : '—', tone: dernier?.compte.abimes ? 'attention' : 'neutre' }],
      onglets: [R, P, Re], sections,
      side: [{ kind: 'list', title: 'Ce que Perséphone ne fait jamais', onglet: R, items: [{ title: 'Écrire sur le support fouillé', detail: 'Il est ouvert en lecture seule. Seule « Réparer la table », avec ton accord et une copie de secours, écrit les secteurs de la table.' }, { title: 'Ranger sur le même disque', detail: 'Le dossier de destination est vérifié : un autre disque, jamais une autre partition du même.' }, { title: 'Promettre de tout retrouver', detail: 'Ce qui a été écrasé est perdu. Le rapport dit ce qui est entier et ce qui est abîmé.' }] }],
      ...(j ? { refreshMs: 2000 } : {}),
    };
  },
  /** Un fichier retrouvé, remis à l'appareil : seulement s'il est bien dans le dossier d'une récupération. */
  retrait(ctx, ref) {
    const k = ref.indexOf('/'); if (k <= 0) return undefined;
    const r = rapport(ctx, ref.slice(0, k)); if (!r) return undefined;
    const f = resolve(r.dossier, ref.slice(k + 1));
    if (!f.startsWith(resolve(r.dossier) + sep)) return undefined;
    try { const v = realpathSync(f); return v.startsWith(realpathSync(r.dossier) + sep) && statSync(v).isFile() ? v : undefined; } catch { return undefined; }
  },
  stop() { for (const j of travaux.values()) j.arret.stop = true; },
};
/** Pour les essais : attend la fin du travail en cours. */
export async function attendreHel(dir: string): Promise<void> { await travaux.get(dir)?.fin; }
