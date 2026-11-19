// Le point d'appel OBLIGATOIRE à Heimdall : aucun outil ne s'exécute sans passer par ici. Sorti de la boucle de
// l'agent (core/agent.ts) pour que le noyau reste petit : la boucle peut être réécrite selon le réglage du code, ce
// fichier non (il est dans le noyau, src/heimdall/noyau.ts).
//
// Il construit la demande faite à Heimdall à partir de l'outil et de son entrée, y ajoute les chemins du CODE D'ODIN
// que l'outil va écrire (self_edit, fs_write, fs_edit dans le dossier d'Odin : une seule règle, celle de la réécriture
// du code), puis rend l'exécution seulement si Heimdall l'a permise.
import { relative } from 'node:path';
import type { Tool, ToolContext } from '../tools/registry.ts';
import type { GateDecision, GateInput, Heimdall } from './policy.ts';
import { toolPath } from './policy.ts';
import { cheminVraiRelatif, commandeSurLeCode, RACINE_APPLI } from './noyau.ts';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** Les fichiers du dernier lot (ou du lot donné) du journal des réécritures (self-backups), sans dépendre de l'outil. */
function fichiersDuLotSync(home: string, id?: string): string[] {
  try { const j = JSON.parse(readFileSync(join(home, 'self-backups', 'journal.json'), 'utf8')) as Array<{ id: string; files: string[] }>; return (id ? j.find((c) => c.id === id) : j.at(-1))?.files ?? []; } catch { return []; }
}

const COMMANDES = new Set(['shell', 'python_run', 'node_run', 'codex_run', 'script_run']);
/** Une commande système qui touche au code d'Odin : « reference » (jamais), « code » (toujours validé), ou rien. */
export function commandeCode(tool: string, input: Record<string, unknown>, ctx: Pick<ToolContext, 'workspace' | 'fullAccess'>): 'reference' | 'code' | undefined {
  if (!COMMANDES.has(tool)) return undefined;
  const texte = ['command', 'code', 'task', 'args', 'name'].map((k) => String(input[k] ?? '')).join('\n');
  const dossiers: string[] = [];
  for (const k of ['cwd', 'dir']) { const v = String(input[k] ?? ''); if (v) { try { dossiers.push(toolPath(ctx, v)); } catch { dossiers.push(v); } } }
  if (tool === 'codex_run' && !String(input.dir ?? '')) dossiers.push(ctx.workspace);
  return commandeSurLeCode(texte, dossiers, undefined, tool === 'codex_run' ? dossiers : []);
}
import { graveArgent, noterPage } from './paiement.ts';
import { destinataireTiers, graveEnvoi } from './envois.ts';
import { masquerCodes } from './redact.ts';
import { graveMaison, type InfoEntite } from './maison.ts';
import { actionEnCours, cleNumeros, empreinteAction, figer, journalDe, numeroCourt, RISQUES_ENGAGEANTS, type IssueReservee, type JournalActions } from './actions-journal.ts';

/** Ce que Home Assistant dit des entités visées (nom, classe, contenu d'une scène) — pour la garde des ouvertures. */
export type LireEntite = (ctx: ToolContext, entity: string) => Promise<InfoEntite | undefined>;
let lireEntite: LireEntite = async (ctx, entity) => {
  const url = (ctx.homeAssistant?.url ?? '').replace(/\/$/, ''), token = process.env.HA_TOKEN ?? '';
  if (!url || !token) return undefined;
  const { haApi } = await import('../tools/homeassistant.ts');
  const st = await Promise.race([haApi(url, token, 'GET', `/states/${encodeURIComponent(entity)}`), new Promise((ok) => setTimeout(() => ok(undefined), 4000))]) as { attributes?: Record<string, unknown> } | undefined;
  const a = st?.attributes ?? {};
  let entites = Array.isArray(a.entity_id) ? (a.entity_id as unknown[]).map(String) : undefined;
  // Un script ou une automatisation : leur état ne dit pas ce qu'ils touchent ; on lit leur CONFIGURATION (API de
  // configuration de Home Assistant). Illisible → undefined → grave par prudence (heimdall/maison.ts).
  const [dom, nom] = entity.split('.');
  if (dom === 'script' || dom === 'automation') {
    const id = dom === 'automation' ? String(a.id ?? '') : nom;
    try {
      const conf = id ? await Promise.race([haApi(url, token, 'GET', `/config/${dom}/config/${encodeURIComponent(id)}`), new Promise((ok) => setTimeout(() => ok(undefined), 4000))]) : undefined;
      entites = conf ? [...new Set((JSON.stringify(conf).match(/\b(lock|alarm_control_panel|cover|switch|button|script|scene)\.[a-z0-9_]+/g) ?? []))] : undefined;
    } catch { entites = undefined; }
  }
  return { nom: String(a.friendly_name ?? ''), classe: String(a.device_class ?? ''), entites };
};
/** (essais) une autre source pour les entités. */
export function lireEntitesAvec(f: LireEntite): void { lireEntite = f; }

async function graveHa(tool: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string | undefined> {
  if (tool !== 'ha_call') return undefined;
  const domain = String(input.domain ?? ''), service = String(input.service ?? ''), entity = String(input.entity_id ?? '');
  const info: Record<string, InfoEntite> = {};
  if (['scene', 'script', 'automation', 'cover', 'switch', 'button', 'homeassistant'].includes(domain)) for (const e of entity.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 10)) { try { const i = await lireEntite(ctx, e); if (i) info[e] = i; } catch { /* inconnue */ } }
  return graveMaison(domain, service, entity, info);
}

/** Une commande qui supprime un dossier entier (ou des fichiers en masse) : pas d'annulation possible. Pur. */
export function graveSuppression(tool: string, input: Record<string, unknown>): string | undefined {
  if (tool !== 'shell' && tool !== 'python_run' && tool !== 'node_run') return undefined;
  const c = String(input.command ?? input.code ?? '');
  const vu = /(?:^|[\s;&|(`])rm\s+(?:-[a-z]*r[a-z]*\b|-[a-z]*R|--recursive\b|[^\n;&|]*\*)|(?:^|[\s;&|(])(?:rmdir|rd)\s+[^\n]*\/s\b|(?:^|[\s;&|(])(?:del|erase)\s+[^\n]*\/s\b|\b(?:Remove-Item|ri|rm|del)\b[^\n]*-Recurse\b|\bshutil\.rmtree\(|\b(?:rmSync|rm|rmdirSync|rmdir)\([^)]*recursive\s*:\s*true|\bfind\b[^\n]*\s-delete\b|\bgit\s+clean\s+-[a-z]*[fdx]/i.test(c);
  return vu ? `GRAVE : supprimer un dossier entier ou des fichiers en masse par une commande (${c.replace(/\s+/g, ' ').slice(0, 160)}) : pas d'annulation possible, je ne le fais jamais sans ton accord` : undefined;
}

/** Un VRAI envoi vers l'extérieur : un destinataire tiers, une requête qui écrit, un formulaire envoyé par le navigateur,
 *  une commande qui poste (curl, wget, Invoke-WebRequest). Pur. */
export function estEnvoi(tool: string, input: Record<string, unknown>): boolean {
  if (destinataireTiers(tool, input)) return true;
  if (tool === 'http_request') return !/^(get|head|options)?$/i.test(String(input.method ?? ''));
  if (tool === 'browser_type') return input.submit === true;
  if (tool === 'browser_key') return /^enter$/i.test(String(input.key ?? ''));
  if (tool === 'shell' || tool === 'python_run' || tool === 'node_run') {
    const c = String(input.command ?? input.code ?? '');
    return /\bcurl\b[^\n|;&]*(\s-X\s*(POST|PUT|PATCH|DELETE)\b|\s(-d|--data[a-z-]*|-F|--form|-T|--upload-file)\b)|\bwget\b[^\n|;&]*--post-|Invoke-(WebRequest|RestMethod)[^\n|;&]*-Method\s+(Post|Put|Patch|Delete)|requests\.(post|put|patch|delete)\(|fetch\([^)]*method\s*:\s*['"](POST|PUT|PATCH|DELETE)/i.test(c);
  }
  return false;
}

/** Les fichiers du code d'Odin (relatifs à sa racine) qu'un appel va écrire. Vide si aucun. */
export function cheminsCodeDe(tool: string, input: Record<string, unknown>, ctx: Pick<ToolContext, 'workspace' | 'fullAccess'> & { home?: string }, racine = RACINE_APPLI): string[] {
  // Un retour arrière réécrit les fichiers de son lot : même règle que leur réécriture (noyau, code sensible).
  if (tool === 'self_rollback') { const h = (ctx as { home?: string }).home; if (!h) return []; try { return fichiersDuLotSync(h, String(input.id ?? '') || undefined).map((f) => cheminVraiRelatif(f, racine)).filter((x): x is string => x !== undefined); } catch { return []; } }
  // media_convert écrit dans « output » : c'est ce chemin-là qui compte.
  const p = String((tool === 'media_convert' ? input.output : input.path) ?? '');
  if (!p) return [];
  if (tool === 'media_convert') { try { const r = cheminVraiRelatif(toolPath(ctx, p), racine); return r === undefined ? [] : [r]; } catch { return []; } }
  try {
    if (tool === 'self_edit') { const r = cheminVraiRelatif(p.replace(/^[\\/]+/, ''), racine); return r === undefined ? [] : [r]; }
    if (tool === 'fs_write' || tool === 'fs_edit' || tool === 'doc_create') {
      const abs = toolPath(ctx, p);
      const r = cheminVraiRelatif(abs, racine);
      return r === undefined ? [] : [r];
    }
  } catch { /* chemin refusé ailleurs */ }
  return [];
}

export type EntreeAppel = Omit<GateInput, 'tool' | 'risk' | 'summary' | 'command' | 'grave' | 'lookup' | 'cheminsCode' | 'destinataire' | 'changement' | 'commandeCode' | 'envoi'>;

/** Ce que la demande de validation montre au plus (une messagerie coupe au-delà de quelques milliers de caractères). */
export const MONTRE_MAX = 6000;
const prefixer = (t: string, p: string) => t.split('\n').map((l) => `${p} ${l}`).join('\n');
/**
 * Le changement d'une réécriture ou d'une commande, lisible et COMPLET quand il tient (`MONTRE_MAX`) : les lignes RETIRÉES
 * (−) sont toujours montrées en entier en premier ; ce qui ne tient pas est rangé en entier dans un fichier, et la demande
 * dit combien n'est pas montré et où le lire. Pur, sauf ce fichier (dans le dossier d'Odin, quand on le connaît).
 */
export function changementDe(tool: string, input: Record<string, unknown>, home?: string): string | undefined {
  const s = (v: unknown) => String(v ?? '');
  let retire = '', ajoute = '', tete = '';
  if ((tool === 'self_edit' || tool === 'fs_edit') && input.old !== undefined) { retire = prefixer(s(input.old), '−'); ajoute = prefixer(s(input.new), '+'); }
  else if (tool === 'self_edit' || tool === 'fs_write') { tete = '(fichier entier)'; ajoute = prefixer(s(input.content), '+'); }
  else if (tool === 'doc_create') { tete = '(document créé)'; ajoute = prefixer(s(input.content), '+'); }
  else if (tool === 'media_convert') return `(fichier converti depuis ${s(input.input)})`;
  else if (tool === 'shell' || tool === 'python_run' || tool === 'node_run' || tool === 'codex_run' || tool === 'script_run') { tete = `(la commande entière, ${tool})`; ajoute = s(input.command ?? input.code ?? input.task ?? `${s(input.name)} ${s(input.args)}`); }
  else return undefined;
  const complet = [tete, retire, ajoute].filter(Boolean).join('\n');
  if (complet.length <= MONTRE_MAX) return complet;
  // Trop long : les lignes retirées d'abord, en entier ; puis le début de l'ajout ; le tout rangé dans un fichier.
  let ou = 'dans la demande d\'outil du journal des Décisions';
  if (home) { try { const d = join(home, 'logs', 'changements'); mkdirSync(d, { recursive: true }); const p = join(d, `${createHash('sha256').update(complet).digest('hex').slice(0, 16)}.txt`); writeFileSync(p, complet, { mode: 0o600 }); ou = `dans ${p}`; } catch { /* rien */ } }
  const place = Math.max(1000, MONTRE_MAX - retire.length);
  const montre = [tete, retire, ajoute.slice(0, place)].filter(Boolean).join('\n');
  return `${montre}\n… ${complet.length - montre.length} caractères non montrés ici — le changement complet est ${ou}`;
}

/** Une heure lisible, sans supposer de langue ni de fuseau (UTC). */
const heure = (t: number): string => `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/**
 * Demande à Heimdall, puis rend de quoi lancer l'outil — SEULEMENT si c'est permis. `lancer` n'existe pas sinon :
 * l'outil ne peut pas être exécuté sans cette décision.
 *
 * Ce qui est demandé, montré et exécuté est une COPIE FIGÉE de l'entrée (profonde et gelée), jamais l'objet que le
 * modèle tient encore et pourrait changer pendant la question. Une action engageante a un numéro (empreinte de l'outil,
 * des paramètres exacts et du tour, src/heimdall/actions-journal.ts) : la demande de validation le porte, il est
 * recalculé juste avant d'agir et doit être le même ; l'action est notée « lancée » avant, « faite » ou « échouée »
 * après. Ta décision du 19/11 (« Me demander ») : la refaire dans la même demande (déjà faite, échouée ou en cours) →
 * la question t'est posée, sans « toujours », et ton oui ne sert qu'une fois ; faite par le processus d'avant un
 * redémarrage → jamais refaite ; coupée en plein milieu par une panne → la question t'est posée ; sans personne pour
 * répondre → refusée. Deux appels identiques en même temps : le second attend l'issue du premier.
 */
export async function deciderPuisLancer(heimdall: Heimdall, tool: Tool, input: Record<string, unknown>, ctx: ToolContext, e: EntreeAppel): Promise<{ decision: GateDecision; summary: string; lancer?: () => ReturnType<Tool['run']> }> {
  const fige = figer(input);
  const tour = e.tour ?? '';
  // Une action engageante d'un tour connu est réservée le temps de sa décision et de son exécution : un appel
  // identique qui arrive pendant ce temps attend son issue (une seule question à la fois pour la même action).
  let liberer: ((issue: IssueReservee) => void) | undefined;
  let refusDeja: string | undefined;
  if (tour && RISQUES_ENGAGEANTS.has(tool.risk) && !(tool.lookup?.(fige) ?? false)) {
    try {
      // Le même numéro que la décision (même clé, même règle d'écriture : voir plus bas).
      const mem = (ctx as { muninn?: { dir?: string | null; privateMode?: boolean } }).muninn, home = (ctx as { home?: string }).home;
      const n = empreinteAction(tool.name, fige, tour, cleNumeros(home, Boolean(mem?.dir) && Boolean(home) && !mem?.privateMode));
      const r = await journalDe(mem?.dir).reserver(tour, n);
      liberer = r.liberer;
      if (r.issue === 'refusée') refusDeja = `la même action, demandée en même temps dans cette demande (n° ${numeroCourt(n)}), vient d'être refusée : je ne la redemande pas`;
    } catch { /* la décision ci-dessous dira ce qui ne va pas (clé ou journal illisible) */ }
  }
  let r: Awaited<ReturnType<typeof decider>> | undefined;
  try {
    if (refusDeja) return { decision: { allowed: false, reason: refusDeja }, summary: tool.summarize?.(fige) ?? `${tool.name} ${JSON.stringify(fige).slice(0, 200)}` };
    r = await decider(heimdall, tool, fige, ctx, e, liberer);
    return r;
  } finally {
    // Refusée (ou erreur) : l'appel identique qui attend est libéré tout de suite ; permise : à la fin de l'exécution.
    if (!r?.lancer) liberer?.('refusée');
  }
}

/** Au plus tard, une action permise dont l'exécution n'est jamais lancée libère sa réservation (10 minutes). */
const RESERVATION_MAX_MS = 10 * 60_000;

async function decider(heimdall: Heimdall, tool: Tool, fige: Record<string, unknown>, ctx: ToolContext, e: EntreeAppel, liberer: ((issue: IssueReservee) => void) | undefined): Promise<{ decision: GateDecision; summary: string; lancer?: () => ReturnType<Tool['run']> }> {
  const tour = e.tour ?? '';
  const summary = tool.summarize?.(fige) ?? `${tool.name} ${JSON.stringify(fige).slice(0, 200)}`;
  const lookup = tool.lookup?.(fige) ?? false;
  // Le journal des actions : seulement les actions engageantes (une consultation, même par un outil qui peut aussi
  // agir, n'en est pas une : Heimdall la laisse passer comme lecture) ; « jamais refaite seule » seulement dans un tour connu.
  const engageant = RISQUES_ENGAGEANTS.has(tool.risk) && !lookup;
  const mem = (ctx as { muninn?: { dir?: string | null; privateMode?: boolean } }).muninn;
  const home = (ctx as { home?: string }).home;
  // Mode privé : rien n'est écrit. Sans dossier d'Odin (où ranger la clé des numéros), rien n'est écrit non plus.
  const ecrire = Boolean(mem?.dir) && Boolean(home) && !mem?.privateMode;
  let journal: JournalActions | undefined;
  // La raison grave ajoutée quand l'action a déjà une histoire dans ce tour (coupée par une panne, ou refaite).
  let coupee: string | undefined;
  let vuDecide: { etat: string; t: number } | undefined;
  // Le numéro : empreinte à clé (un code court ne se retrouve pas à partir du journal). La clé n'est rangée que pour
  // une action notée ; une lecture prend la clé rangée si elle existe, sinon celle de ce processus.
  let cle: Buffer;
  try { cle = cleNumeros(home, ecrire && engageant); } catch (x) { return { decision: { allowed: false, reason: `je ne peux pas lire la clé de mon journal des actions (${(x as Error).message.slice(0, 120)}) : rien n'est parti` }, summary }; }
  const n = empreinteAction(tool.name, fige, tour, cle), numero = numeroCourt(n);
  if (engageant) {
    try { journal = journalDe(mem?.dir); } catch (x) { return { decision: { allowed: false, reason: `je ne peux pas lire mon journal des actions (${(x as Error).message.slice(0, 120)}) : rien n'est parti` }, summary }; }
    const vu = tour ? journal.etat(tour, n) : undefined;
    vuDecide = vu ? { etat: vu.etat, t: vu.t } : undefined;
    // Faite par le processus d'avant un redémarrage : jamais refaite (pas même avec ton oui).
    if (vu?.avant && vu.etat === 'faite') return { decision: { allowed: false, reason: `action déjà faite avant mon redémarrage, dans cette demande (n° ${numero}, ${heure(vu.t)}) : je ne la refais jamais` }, summary };
    if (vu?.etat === 'à confirmer') {
      if (e.unattended) return { decision: { allowed: false, severity: 'grave', reason: `action coupée en plein milieu (n° ${numero}, lancée ${heure(vu.t)}) : je ne sais pas si elle est partie, et personne n'est là pour me le dire : je ne la refais pas` }, summary };
      coupee = `action coupée en plein milieu (n° ${numero}, lancée ${heure(vu.t)}, jamais finie) : je ne sais pas si elle est partie`;
    } else if (vu) {
      // La même action, refaite dans la même demande (faite, échouée ou encore en cours) : ta décision du 19/11,
      // « Me demander ». Une action échouée est peut-être partie quand même (un délai dépassé après l'envoi).
      const quoi = vu.etat === 'faite' ? `faite ${heure(vu.t)}` : vu.etat === 'échouée' ? `échouée ${heure(vu.t)}${vu.avant ? ', avant mon redémarrage' : ''} : elle est peut-être partie quand même` : 'encore en cours';
      if (e.unattended) return { decision: { allowed: false, severity: 'grave', reason: `j'ai déjà fait cette action dans cette demande (n° ${numero}, ${quoi}) et personne n'est là pour me dire de la refaire : je ne la refais pas` }, summary };
      coupee = `j'ai déjà fait cette action dans cette demande (n° ${numero}, ${quoi}) ; la refaire`;
    }
  }
  const autreGrave = tool.grave?.(fige) ?? graveArgent(tool.name, fige, e.sessionId) ?? graveEnvoi(tool.name, fige) ?? graveSuppression(tool.name, fige) ?? await graveHa(tool.name, fige, ctx);
  // La demande porte le numéro de l'action (src/heimdall/approbations.ts le garde avec elle).
  const decision = await actionEnCours.run({ empreinte: n }, () => heimdall.gate({
    ...e,
    tool: tool.name, risk: tool.risk, summary,
    command: tool.command?.(fige),
    // L'argent : la garde en code (page de paiement, adresse de paiement) s'ajoute à ce que l'outil déclare.
    // Et un envoi en ton nom à un tiers : destinataire et texte exact montrés, toujours ta validation.
    // Et ouvrir, déverrouiller ou désarmer la maison (serrures, alarme, portail) : toujours ta validation.
    // Et une action coupée en plein milieu par une panne, ou refaite dans la même demande : jamais refaite sans toi
    // (ajoutée APRÈS les autres raisons, pour que leurs règles, qui lisent le début, restent les mêmes).
    grave: autreGrave && coupee ? `${autreGrave} ; ${coupee}` : autreGrave ?? coupee,
    lookup,
    cheminsCode: cheminsCodeDe(tool.name, fige, ctx),
    commandeCode: commandeCode(tool.name, fige, ctx),
    changement: changementDe(tool.name, fige, (ctx as { home?: string }).home),
    destinataire: destinataireTiers(tool.name, fige),
    envoi: estEnvoi(tool.name, fige),
  }));
  if (!decision.allowed) return { decision, summary };
  // Une exécution jamais lancée ne garde pas la réservation pour toujours.
  const garde = liberer ? setTimeout(() => liberer('finie'), RESERVATION_MAX_MS) : undefined;
  garde?.unref?.();
  let servi = false;
  const lancer = async (): Promise<Awaited<ReturnType<Tool['run']>>> => {
    // Lancée : la garde ne sert plus ; une action longue garde sa réservation jusqu'à sa fin.
    if (garde) clearTimeout(garde);
    try { return await executer(); } finally { liberer?.('finie'); }
  };
  // Ce que le navigateur montre est retenu pour la garde de l'argent (la page suivante d'un clic aussi).
  const executer = async (): Promise<Awaited<ReturnType<Tool['run']>>> => {
    // L'outil reçoit une copie neuve de la copie figée (il peut compléter sa propre entrée, comme avant), et son
    // numéro, recalculé juste avant d'agir, doit être celui de l'action validée.
    const copie = structuredClone(fige) as Record<string, unknown>;
    const maintenant = empreinteAction(tool.name, copie, tour, cle);
    if (maintenant !== n) throw new Error(`l'action a changé depuis ta validation (n° ${numero} validé, n° ${numeroCourt(maintenant)} maintenant) : rien n'est parti`);
    if (journal) {
      // Un oui (ou une permission) ne sert qu'une fois.
      if (servi) throw new Error(`cette validation a déjà servi (n° ${numero}) : elle ne vaut qu'une fois, rien n'est parti`);
      servi = true;
      // Revu au dernier moment (une question peut durer) : si la même action a été lancée, faite ou a échoué depuis
      // la décision, ce qui a été décidé ne vaut plus : rien ne part.
      const vu = tour ? journal.etat(tour, n) : undefined;
      if (vu?.etat !== vuDecide?.etat || vu?.t !== vuDecide?.t) throw new Error(`la même action a été ${vu?.etat === 'en cours' ? 'lancée' : vu?.etat ?? 'changée'} dans cette demande depuis la décision (n° ${numero}) : rien n'est parti, redemande-la si tu la veux encore`);
      // « Lancée » écrite et forcée sur le disque AVANT d'agir ; si elle ne peut pas l'être, rien ne part.
      const resume = (() => { try { return ctx.redactor ? ctx.redactor.redact(summary).replace(/\s+/g, ' ').slice(0, 160) : undefined; } catch { return undefined; } })();
      try { journal.lancer({ n, tour, outil: tool.name, ...(resume ? { resume } : {}) }, ecrire); } catch (x) { throw new Error(`je ne peux pas noter l'action avant de la faire (${(x as Error).message.slice(0, 120)}) : rien n'est parti`); }
    }
    let r: Awaited<ReturnType<Tool['run']>>;
    try { r = await tool.run(copie, ctx); } catch (x) { journal?.finir({ n, tour, outil: tool.name }, 'échouée', ecrire); throw x; }
    journal?.finir({ n, tour, outil: tool.name }, 'faite', ecrire);
    if (tool.name.startsWith('browser_')) { try { noterPage(e.sessionId, typeof r === 'string' ? r : r.output); } catch { /* rien */ } }
    // Un mail lu : les codes à usage unique et les liens de réinitialisation ne vont ni au modèle ni à personne (U6).
    if (tool.name === 'mail_read' || tool.name === 'mail_list') r = typeof r === 'string' ? masquerCodes(r) : { ...r, output: masquerCodes(r.output) };
    return r;
  };
  return { decision, summary, lancer };
}

/** (pour les sauvegardes) un chemin du code relatif à la racine. */
export const relatifCode = (abs: string): string => relative(RACINE_APPLI, abs);
