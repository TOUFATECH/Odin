// Atalante — les téléchargements : file d'attente, plusieurs morceaux en parallèle, reprise après coupure, débit
// maximum, heures creuses (une tâche de Talos ouvre la plage, la fin est un réglage de l'appli), empreinte vérifiée
// quand l'éditeur en publie une, antivirus sur chaque fichier reçu (Asclépios), refus des sites connus comme dangereux,
// et rangement : les ISO chez Hydre, les logiciels chez Hermès, le reste par type.
// Elle s'appuie sur ce qu'Odin a déjà (forge : download, sha256File, parseSums ; Asclépios : quarantaineDabord et
// ullr.adresse ; Hydre et Hermès pour ranger) au lieu de le recopier.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Action, Module, ModCtx, RythmeAppli, Section, Tone } from '../types.ts';
import { journalDe } from '../base/journal.ts';
import { tacheEnPause } from '../automatismes.ts';
import { fuseauOdin, murale, prochaine, type Rythme } from '../../draupnir/rythme.ts';
import { hoteInterdit, lienDeMaison, nomDeLien } from '../lien.ts';
import { isPrivateHost } from '../../heimdall/policy.ts';
import { sizeText } from '../forge/forge.ts';
import { fichiersDeTravail, sonder, telechargerMorceaux } from '../atalante/morceaux.ts';
import { FileAttente, OUVERTS, type Element } from '../atalante/file.ts';
import { apres, avant, avisSite, lienSansParametres, RESOUDRE_SYSTEME, type Resoudre } from '../atalante/rangement.ts';

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
export interface LigneHistorique { at: string; lien: string; nom: string; taille?: number; sha256?: string; empreinte?: 'verifiee' | 'absente'; antivirus?: string; rangement?: string; etat: string; texte?: string }

// ---------------------------------------------------------------- Réseau (injectable pour les essais)
let resoudre: Resoudre = RESOUDRE_SYSTEME;
export function reseauAtalante(o: { resoudre?: Resoudre } = {}): void { resoudre = o.resoudre ?? RESOUDRE_SYSTEME; }

// ---------------------------------------------------------------- Réglages
const maxSimultanes = (ctx: ModCtx) => Math.min(8, Math.max(1, Number(ctx.settings.maxSimultanes) || 3));
const nbMorceaux = (ctx: ModCtx) => Math.min(8, Math.max(1, Number(ctx.settings.morceaux) || 4));
const debitMo = (ctx: ModCtx) => Math.max(0, Number(ctx.settings.debitMo) || 0);
const dossier = (ctx: ModCtx) => s(ctx.settings.dossier) || join(ctx.dir, 'fichiers');
const enCours = (ctx: ModCtx) => join(ctx.dir, 'en-cours');
const finPlage = (ctx: ModCtx) => s(ctx.settings.finCreuses) || '07:00';
const RYTHME_DEFAUT: RythmeAppli = { genre: 'jour', heure: '01:00' };
const rythmeCreuses = (ctx: ModCtx): RythmeAppli => (ctx.settings.rythmeCreuses as RythmeAppli | undefined) ?? RYTHME_DEFAUT;
const debutPlage = (ctx: ModCtx) => { const r = rythmeCreuses(ctx); return r.genre === 'jour' ? r.heure : '01:00'; };
const journal = (ctx: ModCtx) => journalDe<LigneHistorique>(ctx, 'atalante', 'historique.jsonl', { garder: 3000 });
const files = new Map<string, FileAttente>();
const laFile = (ctx: ModCtx) => { let f = files.get(ctx.dir); if (!f) { f = new FileAttente(ctx.dir, ctx.home); files.set(ctx.dir, f); } return f; };
const heureLocale = (d: Date) => { const m = murale(d.getTime(), fuseauOdin()); return `${String(m.h).padStart(2, '0')}:${String(m.mi).padStart(2, '0')}`; };

/** La plage d'heures creuses est-elle ouverte ? (ouverte par la tâche de Talos, jusqu'à la fin réglée ; pause de Talos respectée) */
export function creusesOuvertes(ctx: ModCtx, now = ctx.now()): boolean {
  if (tacheEnPause('atalante', 'heures_creuses')) return false;
  const j = Date.parse(s(ctx.settings.creusesJusqua));
  return Number.isFinite(j) && now.getTime() < j;
}
/** Ouvre la plage d'heures creuses jusqu'à la prochaine fin réglée. */
function ouvrirCreuses(ctx: ModCtx): Date {
  const now = ctx.now(), fin = prochaine({ genre: 'jour', heure: finPlage(ctx) }, now) ?? new Date(now.getTime() + 6 * 3600_000);
  ctx.saveSettings({ creusesJusqua: fin.toISOString(), creusesA: now.toISOString() });
  return fin;
}
function duCreuses(ctx: ModCtx, now: Date): boolean {
  const depuis = Date.parse(s(ctx.settings.creusesA) || s(ctx.settings.cree));
  if (!Number.isFinite(depuis)) { ctx.saveSettings({ cree: now.toISOString() }); return false; }
  const p = prochaine(rythmeCreuses(ctx) as Rythme, new Date(depuis));
  return Boolean(p && p.getTime() <= now.getTime());
}

// ---------------------------------------------------------------- Le moteur
const actifs = new Map<string, { ac: AbortController; pourquoi?: 'pause' | 'arret' | 'plage' }>();
const enVol = new Set<Promise<void>>();
/** Pour les essais : attend la fin des téléchargements lancés. */
export async function attendreAtalante(): Promise<void> { while (enVol.size) await Promise.allSettled([...enVol]); }

async function lancer(ctx: ModCtx, e: Element): Promise<void> {
  const f = laFile(ctx), ac = new AbortController(), slot: { ac: AbortController; pourquoi?: 'pause' | 'arret' | 'plage' } = { ac }; actifs.set(e.id, slot);
  f.maj(e.id, { etat: 'en_cours', texte: 'téléchargement' });
  const fin = (l: Omit<LigneHistorique, 'at' | 'lien' | 'nom'>) => journal(ctx).ajouter({ at: ctx.now().toISOString(), lien: lienSansParametres(e.lien), nom: e.nom, ...l });
  try {
    const u = await avant(ctx, e.lien, { maison: e.maison, resoudre });
    // Chaque redirection est revérifiée comme le premier lien : où le nom mène vraiment, puis l'avis d'Asclépios.
    const sonde = await sonder(ctx.fetch, u.toString(), { signal: ac.signal, garde: async (x) => {
      const adresses = await resoudre(x.hostname.replace(/^\[|\]$/g, '')).catch(() => [] as string[]);
      if (adresses.some(hoteInterdit)) throw new Error(`le lien renvoie vers la machine d'Odin elle-même ou une adresse réservée (${x.hostname}) : refusé`);
      if (!e.maison && (lienDeMaison(x.toString()) || adresses.some((a) => isPrivateHost(a)))) throw new Error('le lien renvoie vers une adresse de ton réseau : refusé');
      await avisSite(ctx, x.toString());
    } });
    const r = await telechargerMorceaux(ctx.fetch, { url: sonde.url, sonde, nom: e.nom, dossier: enCours(ctx), morceaux: nbMorceaux(ctx), ...(debitMo(ctx) ? { debitMo: debitMo(ctx) } : {}), ...(e.empreinte ? { empreinte: e.empreinte } : {}), signal: ac.signal, progression: (fait, total) => { e.fait = fait; if (total) e.total = total; } });
    const a = await apres(ctx, r.chemin, { source: u.host, dossier: dossier(ctx) });
    const etat = a.verdict === 'bloque' ? 'bloque' : 'termine';
    f.maj(e.id, { etat, texte: a.texte, rangement: a.rangement, sha256: r.sha256, fait: r.taille, total: r.taille, fini: ctx.now().toISOString() });
    fin({ taille: r.taille, sha256: r.sha256, empreinte: r.verifie ? 'verifiee' : 'absente', antivirus: a.verdict, rangement: a.rangement, etat });
    if (etat === 'bloque') {
      ctx.emit('bloque', { nom: e.nom, menace: a.passage.menace ?? '' });
      ctx.alert({ level: 'haute', title: `Atalante : ${e.nom.slice(0, 60)} bloqué par Asclépios`, detail: `${a.texte}. Le fichier reste en quarantaine.`, key: `atalante:bloque:${r.sha256}` });
    } else ctx.emit('termine', { nom: e.nom, taille: r.taille, rangement: a.rangement });
  } catch (err) {
    if (slot.pourquoi) {
      // Pause, arrêt ou fin de plage : l'état est posé par celui qui a arrêté.
      if (slot.pourquoi === 'arret') for (const p of fichiersDeTravail(enCours(ctx), e.nom)) rmSync(p, { force: true });
      f.maj(e.id, slot.pourquoi === 'pause' ? { etat: 'pause', texte: 'en pause' } : slot.pourquoi === 'arret' ? { etat: 'arrete', texte: 'arrêté' } : { etat: 'attente', texte: 'en attente des heures creuses' });
      return;
    }
    const m = (err as Error).message.slice(0, 200);
    f.maj(e.id, { etat: 'echec', texte: m });
    fin({ etat: 'echec', texte: m });
    ctx.emit('echec', { nom: e.nom, raison: m });
  } finally { actifs.delete(e.id); }
}
/** Fait avancer la file : lance ce qui peut l'être, remet en attente ce qui sort de la plage d'heures creuses. */
export function pousser(ctx: ModCtx): number {
  const f = laFile(ctx), creuses = creusesOuvertes(ctx);
  if (!creuses) for (const [id, a] of actifs) if (f.get(id)?.creuses && !a.pourquoi) { a.pourquoi = 'plage'; a.ac.abort(); }
  const l = f.suivants({ places: maxSimultanes(ctx) - actifs.size, creusesPermis: creuses });
  for (const e of l) { const p = lancer(ctx, e).finally(() => { enVol.delete(p); pousser(ctx); }); enVol.add(p); }
  return l.length;
}
const arreterActif = (id: string, pourquoi: 'pause' | 'arret') => { const a = actifs.get(id); if (a) { a.pourquoi = pourquoi; a.ac.abort(); return true; } return false; };

// ---------------------------------------------------------------- Actions
const P_ID = { key: 'id', label: 'Téléchargement (identifiant ou nom)', kind: 'text' as const, required: true };
const elementDe = (ctx: ModCtx, x: unknown) => { const e = laFile(ctx).get(s(x)); if (!e) throw new Error(`téléchargement « ${s(x)} » inconnu`); return e; };
const ligneFile = (e: Element) => `${e.nom} · ${e.etat}${e.total ? ` · ${sizeText(e.fait ?? 0)} / ${sizeText(e.total)}` : ''}${e.creuses ? ' · heures creuses' : ''}${e.texte ? ` · ${e.texte}` : ''}`;
const actions: Action[] = [
  { id: 'ajouter', label: 'Ajouter un téléchargement', what: 'Un lien à la file : vérifié par Asclépios avant, analysé après, puis rangé',
    params: [{ key: 'lien', label: 'Lien (https://…)', kind: 'text', required: true }, { key: 'nom', label: 'Nom du fichier (vide : tiré du lien)', kind: 'text', default: '' }, { key: 'empreinte', label: 'Empreinte SHA-256 de l\'éditeur (facultatif)', kind: 'text', default: '' }, { key: 'heures_creuses', label: 'Attendre les heures creuses', kind: 'boolean', default: false }, { key: 'priorite', label: 'Priorité (0 à 9)', kind: 'number', default: 5 }],
    words: ['telecharge ce fichier', 'telecharger ce fichier', 'ajoute au telechargement', 'file des telechargements'],
    grave: (i) => (lienDeMaison(i.lien) ? `télécharger depuis une adresse de ton réseau (${(() => { try { return new URL(s(i.lien)).host; } catch { return 'adresse locale'; } })()})` : undefined),
    run: async (ctx, i) => {
      const maison = lienDeMaison(i.lien), u = await avant(ctx, s(i.lien), { maison, resoudre });
      const nom = (s(i.nom) || nomDeLien(u)).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^[.\s]+/, '').slice(0, 150) || 'fichier';
      const emp = s(i.empreinte).toLowerCase().replace(/^sha256:/, '');
      if (emp && !/^[a-f0-9]{64}$/.test(emp)) return { ok: false, text: 'Empreinte SHA-256 : 64 caractères hexadécimaux.' };
      if (laFile(ctx).elements.some((x) => x.nom === nom && OUVERTS.includes(x.etat))) return { ok: false, text: `« ${nom} » est déjà dans la file.` };
      const creuses = i.heures_creuses === true || s(i.heures_creuses) === 'true';
      const e = laFile(ctx).ajouter({ lien: u.toString(), nom, ...(emp ? { empreinte: emp } : {}), creuses, ...(maison ? { maison } : {}), priorite: Math.min(9, Math.max(0, Number(i.priorite ?? 5) || 0)) }, ctx.now());
      const n = pousser(ctx);
      return { text: `⬇ ${nom} ajouté à la file${creuses ? ` (heures creuses, à partir de ${debutPlage(ctx)})` : n ? ' : il démarre' : ' : il attend sa place'}.`, data: { id: e.id } };
    } },
  { id: 'file', label: 'File des téléchargements', what: 'Ce qui attend, ce qui avance, ce qui est fini', read: true,
    run: (ctx) => { const l = laFile(ctx).elements; return { text: l.length ? l.map(ligneFile).join('\n') : 'La file est vide.', data: l.map(({ lien: _l, ...x }) => ({ ...x, lien: lienSansParametres(_l) })) }; } },
  { id: 'pause', label: 'Mettre en pause', what: 'Le téléchargement s\'arrête et garde ses morceaux', params: [P_ID],
    run: (ctx, i) => { const e = elementDe(ctx, i.id); if (!arreterActif(e.id, 'pause')) laFile(ctx).maj(e.id, { etat: 'pause', texte: 'en pause' }); return { text: `⏸ ${e.nom} en pause.` }; } },
  { id: 'reprendre', label: 'Reprendre', what: 'Le téléchargement reprend où il s\'était arrêté', params: [P_ID],
    run: (ctx, i) => { const e = elementDe(ctx, i.id); if (e.etat === 'en_cours') return { text: `${e.nom} avance déjà.` }; laFile(ctx).maj(e.id, { etat: 'attente', texte: 'reprise demandée' }); pousser(ctx); return { text: `▶ ${e.nom} reprend.` }; } },
  { id: 'arreter', label: 'Arrêter', what: 'Le téléchargement s\'arrête et ses morceaux sont effacés', params: [P_ID],
    run: (ctx, i) => { const e = elementDe(ctx, i.id); if (!arreterActif(e.id, 'arret')) { for (const p of fichiersDeTravail(enCours(ctx), e.nom)) rmSync(p, { force: true }); laFile(ctx).maj(e.id, { etat: 'arrete', texte: 'arrêté' }); } return { text: `⏹ ${e.nom} arrêté.` }; } },
  { id: 'retirer', label: 'Retirer de la liste', what: 'L\'élément quitte la liste (un fichier déjà rangé reste à sa place)', params: [P_ID],
    run: (ctx, i) => { const e = elementDe(ctx, i.id); arreterActif(e.id, 'arret'); for (const p of fichiersDeTravail(enCours(ctx), e.nom)) rmSync(p, { force: true }); laFile(ctx).retirer(e.id); return { text: `🗑 ${e.nom} retiré de la liste.` }; } },
  { id: 'vitesse', label: 'Limiter la vitesse', what: 'Débit maximum commun à tous les téléchargements (Mo/s ; 0 = sans limite)', params: [{ key: 'mo', label: 'Mo/s (0 = sans limite)', kind: 'number', default: 0 }], words: ['limite la vitesse des telechargements'],
    run: (ctx, i) => { const v = Math.max(0, Number(i.mo) || 0); ctx.saveSettings({ debitMo: v }); return { text: v ? `🐢 Débit maximum : ${v} Mo/s (pour les prochains téléchargements).` : '🚀 Plus de limite de vitesse.' }; } },
  { id: 'morceaux', label: 'Nombre de morceaux', what: 'Combien de morceaux en parallèle par fichier (1 à 8)', params: [{ key: 'n', label: 'Morceaux (1 à 8)', kind: 'number', default: 4 }],
    run: (ctx, i) => { const n = Math.min(8, Math.max(1, Math.round(Number(i.n) || 4))); ctx.saveSettings({ morceaux: n }); return { text: `✂ ${n} morceau(x) par fichier.` }; } },
  { id: 'dossier', label: 'Dossier de rangement', what: 'Où ranger les fichiers (un sous-dossier par type)', params: [{ key: 'chemin', label: 'Dossier', kind: 'text', required: true }],
    run: (ctx, i) => { const c = s(i.chemin); if (!/^(\/|[A-Za-z]:[\\/]|~\/)/.test(c)) return { ok: false, text: 'Donne un chemin complet (ex. /srv/telechargements).' }; ctx.saveSettings({ dossier: c.startsWith('~/') ? join(process.env.HOME ?? '', c.slice(2)) : c }); return { text: `📁 Rangement dans ${c}.` }; } },
  { id: 'plage', label: 'Heures creuses', what: 'Début (tâche de Talos) et fin de la plage des heures creuses', params: [{ key: 'debut', label: 'Début (HH:MM)', kind: 'text', default: '01:00' }, { key: 'fin', label: 'Fin (HH:MM)', kind: 'text', default: '07:00' }],
    run: (ctx, i) => {
      const ok = (x: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(x), d = s(i.debut) || debutPlage(ctx), f = s(i.fin) || finPlage(ctx);
      if (!ok(d) || !ok(f)) return { ok: false, text: 'Heures au format HH:MM (ex. 01:00 et 07:00).' };
      ctx.saveSettings({ rythmeCreuses: { genre: 'jour', heure: d }, finCreuses: f });
      return { text: `🌙 Heures creuses : de ${d} à ${f}.` };
    } },
  { id: 'heures_creuses', label: 'Ouvrir les heures creuses', what: 'Lance maintenant ce qui attend les heures creuses (jusqu\'à la fin de la plage)',
    run: (ctx) => { const fin = ouvrirCreuses(ctx), n = pousser(ctx); return { text: `🌙 Heures creuses ouvertes jusqu'à ${heureLocale(fin)} : ${n} téléchargement(s) lancé(s).` }; } },
  { id: 'historique', label: 'Historique', what: 'Les téléchargements finis : taille, empreinte, avis de l\'antivirus, rangement', read: true,
    run: (ctx) => { const l = journal(ctx).tout().slice(-40).reverse(); return { text: l.length ? l.map((x) => `${x.at.slice(0, 16).replace('T', ' ')} · ${x.nom} · ${x.etat}${x.taille ? ` · ${sizeText(x.taille)}` : ''}${x.antivirus ? ` · antivirus : ${x.antivirus}` : ''}${x.rangement ? ` · ${x.rangement}` : ''}${x.texte ? ` · ${x.texte}` : ''}`).join('\n') : 'Aucun téléchargement fini.', data: l }; } },
];

function vue(ctx: ModCtx) {
  const l = laFile(ctx).elements, ouverts = l.filter((e) => OUVERTS.includes(e.etat)), finis = journal(ctx).tout().slice(-30).reverse();
  const ton = (e: Element): Tone => (e.etat === 'termine' ? 'bon' : e.etat === 'echec' || e.etat === 'bloque' ? 'mauvais' : e.etat === 'pause' ? 'attention' : 'neutre');
  const ETAT: Record<string, string> = { attente: 'En attente', en_cours: 'En cours', pause: 'En pause', termine: 'Fini', echec: 'Échec', bloque: 'Bloqué', arrete: 'Arrêté' };
  const sections: Section[] = [
    { kind: 'form', onglet: 'File', title: 'Ajouter un téléchargement', action: 'ajouter', submit: 'Ajouter', params: actions[0].params!, aide: 'Le site est vérifié par Asclépios avant ; le fichier est analysé après, puis rangé.' },
    { kind: 'cards', onglet: 'File', title: 'File', empty: 'Rien en cours.', items: l.slice(-40).reverse().map((e) => ({
      title: e.nom, sub: `${lienSansParametres(e.lien)}${e.creuses ? ' · heures creuses' : ''}`, badge: ETAT[e.etat], tone: ton(e),
      ...(e.total ? { progress: Math.min(100, Math.round((e.fait ?? 0) / e.total * 100)) } : {}),
      meta: [e.total ? `${sizeText(e.fait ?? 0)} / ${sizeText(e.total)}` : '', e.texte ?? ''].filter(Boolean).join(' · '),
      actions: e.etat === 'en_cours' ? [{ action: 'pause', label: 'Pause', input: { id: e.id } }, { action: 'arreter', label: 'Arrêter', input: { id: e.id } }]
        : e.etat === 'attente' || e.etat === 'pause' ? [{ action: 'reprendre', label: 'Reprendre', input: { id: e.id } }, { action: 'arreter', label: 'Arrêter', input: { id: e.id } }]
        : [{ action: 'retirer', label: 'Retirer', input: { id: e.id } }],
    })) },
    { kind: 'table', onglet: 'Historique', title: 'Historique', columns: ['Quand', 'Fichier', 'Taille', 'Empreinte', 'Antivirus', 'Rangé'], empty: 'Aucun téléchargement fini.',
      rows: finis.map((x) => ({ cells: [new Date(x.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }), `${x.nom}${x.lien ? ` (${x.lien.slice(0, 60)})` : ''}`, x.taille ? sizeText(x.taille) : '—', x.empreinte === 'verifiee' ? 'vérifiée' : x.sha256 ? 'calculée' : '—', x.antivirus ?? x.etat, x.rangement ?? x.texte ?? '—'], tone: (x.etat === 'termine' ? 'bon' : 'mauvais') as Tone })) },
    { kind: 'form', onglet: 'Réglages', title: 'Vitesse', action: 'vitesse', submit: 'Enregistrer', params: [{ key: 'mo', label: 'Mo/s (0 = sans limite)', kind: 'number', default: debitMo(ctx) }] },
    { kind: 'form', onglet: 'Réglages', title: 'Morceaux par fichier', action: 'morceaux', submit: 'Enregistrer', params: [{ key: 'n', label: 'Morceaux (1 à 8)', kind: 'number', default: nbMorceaux(ctx) }] },
    { kind: 'form', onglet: 'Réglages', title: 'Heures creuses', action: 'plage', submit: 'Enregistrer', params: [{ key: 'debut', label: 'Début (HH:MM)', kind: 'text', default: debutPlage(ctx) }, { key: 'fin', label: 'Fin (HH:MM)', kind: 'text', default: finPlage(ctx) }], aide: 'Le début est la tâche « Téléchargements aux heures creuses » de Talos (pause possible).' },
    { kind: 'form', onglet: 'Réglages', title: 'Dossier de rangement', action: 'dossier', submit: 'Enregistrer', params: [{ key: 'chemin', label: 'Dossier', kind: 'text', default: dossier(ctx) }], aide: 'Un sous-dossier par type : Documents, Images, Vidéos, Musique, Archives, Autres. Les ISO vont chez Hydre, les logiciels chez Hermès.' },
  ];
  return {
    subtitle: 'Téléchargements', onglets: ['File', 'Historique', 'Réglages'], ...(actifs.size ? { refreshMs: 3000 } : {}),
    kpis: [
      { label: 'En cours', value: String(l.filter((e) => e.etat === 'en_cours').length) },
      { label: 'En attente', value: String(ouverts.filter((e) => e.etat !== 'en_cours').length) },
      { label: 'Vitesse max', value: debitMo(ctx) ? `${debitMo(ctx)} Mo/s` : 'libre' },
      { label: 'Heures creuses', value: creusesOuvertes(ctx) ? 'ouvertes' : `${debutPlage(ctx)}–${finPlage(ctx)}`, tone: (creusesOuvertes(ctx) ? 'bon' : 'neutre') as Tone },
    ],
    sections,
  };
}

export const atalante: Module = {
  id: 'atalante', name: 'Atalante', family: 'Données',
  what: 'Tes téléchargements : une file d\'attente rapide (plusieurs morceaux à la fois), reprise après coupure, vitesse limitée, heures creuses, empreinte vérifiée, antivirus sur chaque fichier, et rangement automatique.',
  does: [
    'file d\'attente avec priorité, 3 fichiers à la fois (réglable), pause, reprise, arrêt',
    'plusieurs morceaux en parallèle (1 à 8) et reprise après coupure ; repart de zéro si le fichier a changé sur le serveur',
    'débit maximum commun, et heures creuses ouvertes par une tâche de Talos',
    'empreinte SHA-256 vérifiée quand l\'éditeur la publie (donnée, .sha256 ou SHA256SUMS voisin) ; fausse, le fichier est supprimé',
    'sites connus comme dangereux refusés (Asclépios) ; chaque fichier reçu passe par la quarantaine d\'abord',
    'rangement : ISO chez Hydre, logiciels chez Hermès, le reste par type (Documents, Images, Vidéos, Musique, Archives)',
    'liens chiffrés dans la file (un lien signé vaut un jeton) ; historique sans paramètres d\'adresse',
  ],
  from: ['Internet Download Manager', 'JDownloader', 'Motrix'], upstream: ['agalwood/Motrix'],
  words: ['atalante', 'telechargements', 'gestionnaire de telechargements', 'file des telechargements', 'reprendre le telechargement', 'telecharger aux heures creuses'],
  actions,
  view: (ctx) => vue(ctx),
  start: (ctx) => { laFile(ctx); },
  stop: () => { for (const a of actifs.values()) { a.pourquoi ??= 'pause'; a.ac.abort(); } files.clear(); },
  watch: { every: 30, run(ctx) {
    const now = ctx.now();
    if (duCreuses(ctx, now) && !tacheEnPause('atalante', 'heures_creuses')) ouvrirCreuses(ctx);
    pousser(ctx);
  } },
  taches: () => [{
    id: 'heures_creuses', nom: 'Téléchargements aux heures creuses', quoi: 'Lance les téléchargements qui attendent les heures creuses, jusqu\'à la fin de la plage réglée dans Atalante.',
    rythme: rythmeCreuses, permis: ['jour'],
    regler: (ctx, r) => { if (r.genre !== 'jour') throw new Error('une heure de début chaque jour (ex. 01:00)'); ctx.saveSettings({ rythmeCreuses: r }); },
    lancer: { action: 'heures_creuses' },
    dernier: (ctx) => (s(ctx.settings.creusesA) ? { at: s(ctx.settings.creusesA) } : undefined),
  }],
};
