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

/**
 * Demande à Heimdall, puis rend de quoi lancer l'outil — SEULEMENT si c'est permis. `lancer` n'existe pas sinon :
 * l'outil ne peut pas être exécuté sans cette décision.
 */
export async function deciderPuisLancer(heimdall: Heimdall, tool: Tool, input: Record<string, unknown>, ctx: ToolContext, e: EntreeAppel): Promise<{ decision: GateDecision; summary: string; lancer?: () => ReturnType<Tool['run']> }> {
  const summary = tool.summarize?.(input) ?? `${tool.name} ${JSON.stringify(input).slice(0, 200)}`;
  const decision = await heimdall.gate({
    ...e,
    tool: tool.name, risk: tool.risk, summary,
    command: tool.command?.(input),
    // L'argent : la garde en code (page de paiement, adresse de paiement) s'ajoute à ce que l'outil déclare.
    // Et un envoi en ton nom à un tiers : destinataire et texte exact montrés, toujours ta validation.
    // Et ouvrir, déverrouiller ou désarmer la maison (serrures, alarme, portail) : toujours ta validation.
    grave: tool.grave?.(input) ?? graveArgent(tool.name, input, e.sessionId) ?? graveEnvoi(tool.name, input) ?? graveSuppression(tool.name, input) ?? await graveHa(tool.name, input, ctx),
    lookup: tool.lookup?.(input) ?? false,
    cheminsCode: cheminsCodeDe(tool.name, input, ctx),
    commandeCode: commandeCode(tool.name, input, ctx),
    changement: changementDe(tool.name, input, (ctx as { home?: string }).home),
    destinataire: destinataireTiers(tool.name, input),
    envoi: estEnvoi(tool.name, input),
  });
  if (!decision.allowed) return { decision, summary };
  // Ce que le navigateur montre est retenu pour la garde de l'argent (la page suivante d'un clic aussi).
  const lancer = async (): Promise<Awaited<ReturnType<Tool['run']>>> => {
    let r = await tool.run(input, ctx);
    if (tool.name.startsWith('browser_')) { try { noterPage(e.sessionId, typeof r === 'string' ? r : r.output); } catch { /* rien */ } }
    // Un mail lu : les codes à usage unique et les liens de réinitialisation ne vont ni au modèle ni à personne (U6).
    if (tool.name === 'mail_read' || tool.name === 'mail_list') r = typeof r === 'string' ? masquerCodes(r) : { ...r, output: masquerCodes(r.output) };
    return r;
  };
  return { decision, summary, lancer };
}

/** (pour les sauvegardes) un chemin du code relatif à la racine. */
export const relatifCode = (abs: string): string => relative(RACINE_APPLI, abs);
