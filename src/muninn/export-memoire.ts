// Exporter toute la mémoire d'Odin dans un format ouvert et documenté : une archive .zip (lisible par l'explorateur de
// fichiers de n'importe quel système), faite de fichiers texte (JSON lignes, JSON, Markdown) et d'un LISEZ-MOI.md qui
// décrit chaque fichier et chaque champ, avec la version du format et la date de l'export.
//
// Ce qui part : les souvenirs (avec leur source et leurs dates), les leçons, les personnes (la carte tenue par la mémoire
// d'Odin : nom, rôle, autonomie, identités, note du propriétaire), les tours, les conversations (messages de la personne
// et d'Odin), les notes du Cerveau telles quelles, les compétences (validées et brouillons).
// Ce qui ne part JAMAIS : les secrets reconnus par le masqueur (sa limite est dite dans le LISEZ-MOI). Tout texte (contenus, titres, noms de fichiers) passe par le masqueur d'Odin
// avant d'être écrit ; un champ chiffré avec la clé de la machine (« odc1:… ») est remplacé ; la signature des
// compétences (faite avec la clé de la machine) est retirée ; rien n'est lu du coffre, des comptes de Persona, des
// paroles (journal à part, dont certaines chiffrées), des réglages, des sorties d'outils ni de la corbeille.
//
// L'archive est écrite en flux, un fichier après l'autre (chacun compressé seul) : elle n'est jamais entière en
// mémoire, et rien n'est écrit sur le disque d'Odin. Aucun paquet : la compression et la somme de contrôle viennent de
// node:zlib. Pas de Zip64 : au-delà de 65 535 fichiers ou de 4 Go, l'export s'arrête sur une erreur (jamais une archive
// abîmée rendue comme bonne).

import { readFileSync } from 'node:fs';
import { crc32, deflateRaw } from 'node:zlib';
import type { Mnemosyne, MemoryRow, SessionRow } from './store.ts';
import { lireTours, type Tour } from './tours.ts';
import { cartes } from './personnes.ts';
import { renderSkill, type Skill } from '../yggdrasil/skills.ts';

/** Version du format de l'archive (à augmenter si un fichier ou un champ change de sens). */
export const VERSION_FORMAT = 1;

export interface SourcesMemoire {
  mu: Mnemosyne;
  /** Le Cerveau (coffre Markdown) : la liste des notes et le chemin réel de chacune. */
  cerveau?: { all(force?: boolean): ReadonlyArray<{ path: string }>; abs(path: string): string };
  /** Les compétences (validées et brouillons). */
  competences?: { list(): Skill[]; drafts(): Skill[] };
  /** Le masqueur d'Odin (secrets connus et formes de clés). */
  masquer(t: string): string;
  maintenant?: number;
}

export interface Description { fichier: string; motif: RegExp; quoi: string; champs?: Record<string, string> }

const DATE = 'date et heure en UTC (ISO 8601)';
const CHAMPS_SOUVENIR: Record<string, string> = {
  id: 'numéro du souvenir dans la mémoire d\'Odin',
  kind: 'sorte : « fact » (un fait), « lesson » (une leçon), ou une autre sorte rangée par Odin',
  content: 'le texte du souvenir',
  origin: 'd\'où il vient : « owner » (toi), « agent » (Odin), « untrusted » (un contenu non fiable : jamais rappelé tout seul)',
  trust: 'confiance, de 0 à 1',
  tags: 'étiquettes, séparées par des espaces ou des virgules',
  subject: 'de quoi ou de qui il parle (vide si rien)',
  topic: 'ce qu\'il dit du sujet ; un fait plus récent de même sujet et même clé le remplace',
  source: 'd\'où il a été tiré (conversation, outil, document…)',
  created_at: `créé le : ${DATE}`,
  last_used_at: `dernière utilisation : ${DATE}`,
  uses: 'nombre d\'utilisations',
  pinned: 'true : épinglé (toujours rappelé)',
  superseded_by: 'numéro du souvenir qui l\'a remplacé (null s\'il est toujours valable)',
};

/** Chaque fichier de l'archive et chacun de ses champs : la source du LISEZ-MOI (et de l'essai). */
export const DESCRIPTIONS: Description[] = [
  { fichier: 'LISEZ-MOI.md', motif: /^LISEZ-MOI\.md$/, quoi: 'ce fichier : le contenu de l\'archive, la version du format, la date de l\'export' },
  { fichier: 'souvenirs.jsonl', motif: /^souvenirs\.jsonl$/, quoi: 'les souvenirs (toutes les sortes sauf les leçons), y compris ceux remplacés depuis ; un objet JSON par ligne', champs: CHAMPS_SOUVENIR },
  { fichier: 'lecons.jsonl', motif: /^lecons\.jsonl$/, quoi: 'les leçons apprises (corrections, erreurs vérifiées) ; mêmes champs que les souvenirs ; un objet JSON par ligne', champs: CHAMPS_SOUVENIR },
  { fichier: 'personnes.jsonl', motif: /^personnes\.jsonl$/, quoi: 'les personnes qui parlent à Odin, telles que sa mémoire les tient (pas les comptes de Persona : ni adresse, ni mot de passe, ni code) ; un objet JSON par ligne', champs: {
    id: 'identifiant de la personne dans la mémoire d\'Odin',
    nom: 'son nom',
    role: '« owner » (propriétaire), « member » (membre), « guest » (invité)',
    autonomie: '« prudent », « equilibre » ou « autonome »',
    identites: 'les comptes par lesquels elle parle à Odin',
    'identites[].canal': 'la messagerie ou l\'interface (web, telegram…)',
    'identites[].pair': 'son identifiant sur ce canal',
    'identites[].partage': 'true : appareil partagé (le compte, pas la personne)',
    persona: 'la personne de Persona reliée à la main ({ id }), ou null',
    note: 'la note libre écrite par le propriétaire',
  } },
  { fichier: 'tours.jsonl', motif: /^tours\.jsonl$/, quoi: 'les tours : chaque message arrivé à Odin et ce qu\'il en a fait, dans l\'ordre d\'arrivée ; un objet JSON par ligne', champs: {
    id: 'identifiant du tour',
    qui: 'le compte : « propriétaire », « membre:<id> », « invite:<canal>:<pair> », ou « odin » (relance d\'Odin)',
    role: '« humain » ou « agent » (Odin lui-même)',
    canal: 'par où le message est arrivé',
    fil: 'la conversation',
    tache: 'la tâche, s\'il y en a une',
    parent: 'le tour qui l\'a lancé, s\'il y en a un',
    but: 'la demande (300 caractères au plus)',
    message: 'identifiant de la parole d\'origine (le texte exact n\'est pas exporté ; la conversation le contient)',
    sansParole: 'pourquoi il n\'y a pas de parole (courriel, page d\'Odin, relance…)',
    etat: '« en file », « en cours », « réussi », « échec », « en attente » ou « arrêté »',
    attente: 'ce qu\'il attend, s\'il est en attente',
    agent: 'qui a fait le tour',
    mission: 'la mission liée',
    immediat: 'true : traité tout de suite, sans passer par la file',
    debut: `début : ${DATE}`,
    fin: `fin : ${DATE}`,
    maj: `dernier changement : ${DATE}`,
  } },
  { fichier: 'conversations/<numéro>-<nom>.json', motif: /^conversations\/\d{4,}-[^/]+\.json$/, quoi: 'une conversation, complète (messages de la personne et d\'Odin ; pas les sorties d\'outils)', champs: {
    id: 'identifiant de la conversation (<canal>:<pair>)',
    channel: 'le canal',
    title: 'son titre',
    summary: 'le résumé fait par Odin quand la conversation a été raccourcie (vide sinon) ; les messages, eux, sont tous là',
    created_at: `commencée le : ${DATE}`,
    updated_at: `dernier message : ${DATE}`,
    messages: 'les messages, du plus ancien au plus récent',
    'messages[].id': 'numéro du message',
    'messages[].role': '« user » (la personne) ou « assistant » (Odin)',
    'messages[].content': 'le texte exact',
    'messages[].created_at': DATE,
  } },
  { fichier: 'conversations/<numéro>-<nom>.md', motif: /^conversations\/\d{4,}-[^/]+\.md$/, quoi: 'la même conversation à lire : chaque message dans un bloc de code (le texte reste du texte, jamais interprété)' },
  { fichier: 'cerveau/<chemin de la note>.md', motif: /^cerveau\/.+\.md$/, quoi: 'les notes du Cerveau telles quelles (Markdown, propriétés en tête), rangées comme dans le coffre : le dossier s\'ouvre tel quel dans un éditeur de notes' },
  { fichier: 'competences/<nom>/SKILL.md', motif: /^competences\/(?!_brouillons\/)[^/]+\/SKILL\.md$/, quoi: 'les compétences validées (format SKILL.md ouvert : propriétés en tête, puis le texte), sans leur signature' },
  { fichier: 'competences/_brouillons/<nom>/SKILL.md', motif: /^competences\/_brouillons\/[^/]+\/SKILL\.md$/, quoi: 'les compétences proposées par Odin, pas encore validées' },
];

/** La description d'un fichier de l'archive (undefined : fichier non décrit). */
export function decrire(nom: string): Description | undefined { return DESCRIPTIONS.find((d) => d.motif.test(nom)); }

// ---------------------------------------------------------------- l'écriture de l'archive .zip, en flux

/** Compresse hors du fil principal : Odin reste disponible pendant l'export d'une grosse conversation. */
const comprimer = (b: Buffer) => new Promise<Buffer>((ok, ko) => { deflateRaw(b, (e, r) => (e ? ko(e) : ok(r))); });

const SIG_LOCAL = 0x04034b50, SIG_CENTRAL = 0x02014b50, SIG_FIN = 0x06054b50;
const UTF8 = 0x0800, DEFLATE = 8, VERSION = 20;

class ZipEnFlux {
  private central: Buffer[] = [];
  private offset = 0;
  private readonly heure: number;
  private readonly jour: number;
  private readonly ecrire: (b: Buffer) => void | Promise<void>;
  constructor(ecrire: (b: Buffer) => void | Promise<void>, quand: Date) {
    this.ecrire = ecrire;
    this.heure = (quand.getHours() << 11) | (quand.getMinutes() << 5) | Math.floor(quand.getSeconds() / 2);
    this.jour = ((Math.max(1980, quand.getFullYear()) - 1980) << 9) | ((quand.getMonth() + 1) << 5) | quand.getDate();
  }
  get fichiers(): number { return this.central.length; }
  get octets(): number { return this.offset; }
  async ajouter(nom: string, contenu: string): Promise<void> {
    if (this.central.length >= 0xffff) throw new Error('trop de fichiers pour une archive .zip simple');
    const data = Buffer.from(contenu, 'utf8'), comp = await comprimer(data), crc = crc32(data), n = Buffer.from(nom, 'utf8');
    if (this.offset + 30 + n.length + comp.length > 0xffffffff) throw new Error('archive trop grosse pour une archive .zip simple');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0); local.writeUInt16LE(VERSION, 4); local.writeUInt16LE(UTF8, 6); local.writeUInt16LE(DEFLATE, 8);
    local.writeUInt16LE(this.heure, 10); local.writeUInt16LE(this.jour, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26); local.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(SIG_CENTRAL, 0); c.writeUInt16LE(VERSION, 4); c.writeUInt16LE(VERSION, 6); c.writeUInt16LE(UTF8, 8); c.writeUInt16LE(DEFLATE, 10);
    c.writeUInt16LE(this.heure, 12); c.writeUInt16LE(this.jour, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28); c.writeUInt32LE(this.offset, 42);
    this.central.push(Buffer.concat([c, n]));
    await this.ecrire(Buffer.concat([local, n])); await this.ecrire(comp);
    this.offset += 30 + n.length + comp.length;
  }
  async finir(): Promise<void> {
    const rep = Buffer.concat(this.central), fin = Buffer.alloc(22);
    fin.writeUInt32LE(SIG_FIN, 0); fin.writeUInt16LE(this.central.length, 8); fin.writeUInt16LE(this.central.length, 10);
    fin.writeUInt32LE(rep.length, 12); fin.writeUInt32LE(this.offset, 16);
    await this.ecrire(rep); await this.ecrire(fin);
    this.offset += rep.length + 22;
  }
}

// ---------------------------------------------------------------- le contenu

const iso = (t: unknown): string | null => (typeof t === 'number' && Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null);
/** Un champ chiffré avec la clé de la machine : jamais exporté, même chiffré. */
const CHIFFRE = /odc1:[A-Za-z0-9+/=_-]*/g;

/** Un nom de fichier sûr dans l'archive : ni « .. », ni chemin absolu, ni caractère interdit par les systèmes courants. */
function nomSur(chemin: string): string {
  const parts = chemin.replace(/\\/g, '/').split('/').map((p) => p.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim()).filter((p) => p && p !== '.' && p !== '..');
  return parts.join('/').slice(0, 300) || 'sans-nom';
}
/** Un texte sur une ligne, dont chaque signe de ponctuation est échappé : en Markdown, il s'affiche tel quel. */
const ligneMd = (t: string) => t.replace(/\s+/g, ' ').trim().replace(/[\\`*_{}[\]()#+\-.!|<>&~=:"']/g, '\\$&');
/** Un bloc de code plus long que toute suite d'accents graves du texte : le texte n'est jamais interprété. */
function blocMd(t: string): string {
  const long = Math.max(3, ...[...t.matchAll(/`+/g)].map((m) => m[0].length + 1));
  const f = '`'.repeat(Math.max(4, long));
  return `${f}\n${t}\n${f}`;
}

/** Exporte toute la mémoire : l'archive est remise morceau par morceau à `ecrire` (qui peut attendre). */
export async function exporterMemoire(s: SourcesMemoire, ecrire: (b: Buffer) => void | Promise<void>): Promise<{ fichiers: number; octets: number }> {
  const quand = new Date(s.maintenant ?? Date.now());
  const zip = new ZipEnFlux(ecrire, quand), pris = new Set<string>(), comptes = new Map<string, number>();
  const masquer = (t: string) => s.masquer(String(t ?? '')).replace(CHIFFRE, '[CHIFFRÉ]');
  const tout = <T>(v: T): T => (typeof v === 'string' ? masquer(v) as T : Array.isArray(v) ? v.map(tout) as T : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tout(x)])) as T : v);
  const ajouter = async (nom: string, contenu: string) => {
    let n = nomSur(masquer(nom));
    if (pris.has(n)) { const m = /^(.*?)(\.[^./]+)?$/.exec(n)!; let i = 2; while (pris.has(`${m[1]}-${i}${m[2] ?? ''}`)) i++; n = `${m[1]}-${i}${m[2] ?? ''}`; }
    pris.add(n);
    const d = decrire(n); if (d) comptes.set(d.fichier, (comptes.get(d.fichier) ?? 0) + 1);
    await zip.ajouter(n, contenu);
  };
  const jsonl = (lignes: object[]) => lignes.map((l) => `${JSON.stringify(tout(l))}\n`).join('');

  // Souvenirs et leçons (tous, y compris ceux remplacés : leur champ superseded_by le dit).
  const souvenir = (m: MemoryRow) => ({ id: m.id, kind: m.kind, content: m.content, origin: m.origin, trust: m.trust, tags: m.tags ?? '', subject: m.subject ?? '', topic: m.topic ?? '', source: m.source ?? '', created_at: iso(m.created_at), last_used_at: iso(m.last_used_at), uses: m.uses, pinned: m.pinned === 1, superseded_by: m.superseded_by ?? null });
  const mems = s.mu.listMemories(Number.MAX_SAFE_INTEGER).sort((a, b) => a.id - b.id);
  await ajouter('souvenirs.jsonl', jsonl(mems.filter((m) => m.kind !== 'lesson').map(souvenir)));
  await ajouter('lecons.jsonl', jsonl(mems.filter((m) => m.kind === 'lesson').map(souvenir)));

  // Personnes : la carte de la mémoire d'Odin, sans rien lire de Persona (le lien posé à la main : son identifiant seul).
  await ajouter('personnes.jsonl', jsonl(cartes(s.mu).map((c) => ({ id: c.id, nom: c.nom, role: c.role, autonomie: c.autonomie, identites: c.identites, persona: c.persona ? { id: c.persona.id } : null, note: c.note }))));

  // Tours (journal sur le disque, quand la mémoire en a un).
  const tours: Tour[] = s.mu.dir ? lireTours(s.mu.dir) : [];
  await ajouter('tours.jsonl', jsonl(tours.map((t) => {
    const o: Record<string, unknown> = {};
    for (const k of ['id', 'qui', 'role', 'canal', 'fil', 'tache', 'parent', 'but', 'message', 'sansParole', 'etat', 'attente', 'agent', 'mission', 'immediat'] as const) if (t[k] !== undefined) o[k] = t[k];
    return { ...o, debut: iso(t.debut), fin: iso(t.fin), maj: iso(t.maj) };
  })));

  // Conversations : messages de la personne et d'Odin (pas les sorties d'outils), une conversation à la fois.
  const titres = s.mu.kvPrefix('title:');
  const sessions = s.mu.listSessions(Number.MAX_SAFE_INTEGER).sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
  let num = 0;
  for (const sess of sessions as SessionRow[]) {
    const msgs = s.mu.allMessages(sess.id).filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content);
    if (!msgs.length) continue;
    const titre = (sess.id.startsWith('web:') ? titres[sess.id.slice(4)] : '') || sess.title || '';
    const conv = tout({ id: sess.id, channel: sess.channel, title: titre, summary: sess.summary ?? '', created_at: iso(sess.created_at), updated_at: iso(msgs[msgs.length - 1].created_at), messages: msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, created_at: iso(m.created_at) })) });
    const base = `conversations/${String(++num).padStart(4, '0')}-${masquer(sess.id).replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60)}`;
    await ajouter(`${base}.json`, `${JSON.stringify(conv, null, 2)}\n`);
    await ajouter(`${base}.md`, [`# ${ligneMd(conv.title || conv.id)}`, '', `${ligneMd(conv.id)} · ${conv.created_at ?? ''}`, '',
      ...conv.messages.flatMap((m) => [`## ${m.role === 'user' ? 'Toi' : 'Odin'} · ${m.created_at ?? ''}`, '', blocMd(m.content), ''])].join('\n'));
  }

  // Notes du Cerveau, telles quelles (une à la fois, lues au moment de l'écrire).
  if (s.cerveau) for (const n of s.cerveau.all(true)) {
    let texte: string; try { texte = readFileSync(s.cerveau.abs(n.path), 'utf8'); } catch { continue; } // partie entre-temps
    await ajouter(`cerveau/${n.path}`, masquer(texte));
  }

  // Compétences : sans leur signature (empreinte faite avec la clé de la machine).
  const competence = (k: Skill) => { const { sig: _sig, ...meta } = k.meta; return masquer(renderSkill({ ...k, meta })); };
  if (s.competences) {
    for (const k of s.competences.list()) await ajouter(`competences/${k.name}/SKILL.md`, competence(k));
    for (const k of s.competences.drafts()) await ajouter(`competences/_brouillons/${k.name}/SKILL.md`, competence(k));
  }

  comptes.set('LISEZ-MOI.md', 1);
  await ajouter('LISEZ-MOI.md', lisezMoi(quand, comptes));
  await zip.finir();
  return { fichiers: zip.fichiers, octets: zip.octets };
}

function lisezMoi(quand: Date, comptes: Map<string, number>): string {
  const l: string[] = [
    '# Mémoire d\'Odin', '',
    `Version du format : ${VERSION_FORMAT}`, `Exportée le : ${quand.toISOString()}`, '',
    'Fichiers texte ouverts, en UTF-8 : JSON lignes (un objet JSON par ligne), JSON et Markdown. Les dates sont en UTC (ISO 8601).', '',
    'Les secrets reconnus sont masqués : chaque texte est passé par le masqueur d\'Odin avant d\'être écrit. Un secret reconnu (une valeur du coffre, une clé reconnue à sa forme, un mot de passe annoncé comme tel) est remplacé par « [SECRET] », un champ chiffré par « [CHIFFRÉ] ». Un secret que le masqueur ne reconnaît pas (un code très court, ou écrit sans dire que c\'en est un) peut rester : relis l\'archive avant de la confier à quelqu\'un.', '',
    'Les conversations : toutes celles qu\'Odin garde, celles du propriétaire, des membres et des invités (messageries comprises), et celles du mode privé tant qu\'Odin n\'a pas redémarré.', '',
    'Ne sont pas dans cette archive : le coffre (clés, mots de passe, codes, jetons), la clé de la machine, les comptes de Persona, les paroles (journal à part, dont une partie chiffrée), les réglages, les sorties d\'outils, la corbeille. La sauvegarde chiffrée d\'Odin reste là pour eux.', '',
    '## Fichiers', '',
  ];
  for (const d of DESCRIPTIONS) {
    l.push(`### ${d.fichier}`, '', `${d.quoi}. Fichiers : ${comptes.get(d.fichier) ?? 0}.`, '');
    if (d.champs) { for (const [k, v] of Object.entries(d.champs)) l.push(`- \`${k}\` : ${v}`); l.push(''); }
  }
  return l.join('\n');
}
