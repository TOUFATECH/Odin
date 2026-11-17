// Banc de rapidité : fabrique un dossier d'Odin JETABLE rempli comme chez quelqu'un qui s'en sert depuis des mois
// (souvenirs, notes du Cerveau reliées par [[…]], liens vivants appris, conversations, vecteurs). Tout est écrit
// directement dans les fichiers que la mémoire relit au démarrage (memoire/*.jsonl, cerveau/*.md) : c'est rapide et
// ça ne passe par aucune logique d'Odin (rien n'est « appris » à tort). Tirage déterministe (graine fixe).

import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Volume { souvenirs: number; notes: number; liens: number; conversations: number; messagesParConv: number; vecteurs: number; dim: number }
export const GROS: Volume = { souvenirs: 5000, notes: 2000, liens: 20000, conversations: 200, messagesParConv: 20, vecteurs: 0, dim: 128 };
export const PETIT: Volume = { souvenirs: 500, notes: 200, liens: 2000, conversations: 20, messagesParConv: 20, vecteurs: 0, dim: 128 };

/** Petit générateur pseudo-aléatoire à graine (mulberry32). */
export function hasard(graine: number): () => number {
  let a = graine >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Un vocabulaire de maison et de bureau : assez de mots pour que les recherches aient des candidats réalistes.
const MOTS = ('sauvegarde serveur imprimante réseau facture électricité banque rendez-vous médecin école enfants vacances voiture garage assurance ' +
  'contrat fournisseur client devis projet boutique site internet routeur wifi caméra alarme chauffage thermostat lampe salon cuisine chambre jardin ' +
  'terrasse piscine courses recette anniversaire cadeau famille mariam said awa madi fatima mamoudzou mayotte comores bateau avion billet passeport ' +
  'impôts déclaration retraite salaire budget épargne crédit maison travaux plombier électricien peinture toiture fenêtre porte serrure clé badge ' +
  'ordinateur portable téléphone tablette disque stockage nuage synchronisation photo vidéo musique film série livre lecture sport course natation ' +
  'football réunion présentation rapport tableau calcul comptabilité stock commande livraison colis retour garantie panne réparation mise-à-jour ' +
  'logiciel licence abonnement mot-de-passe sécurité antivirus pare-feu vpn domaine courriel messagerie agenda tâche rappel note idée').split(/\s+/);
const SUJETS = ['nas', 'proxmox', 'imprimante', 'box', 'proprietaire', 'personne:mariam', 'personne:said', 'voiture', 'maison', 'boutique'];
const DOSSIERS = ['Projets', 'Personnes', 'Idées', 'Réunions', 'Journal', 'Fiches', ''];
const APPS = ['saga', 'frigg', 'vordr', 'runes', 'forseti', 'garmr', 'ullr', 'volva', 'heimdall', 'mimir'];

function phrase(r: () => number, n: number): string {
  const w: string[] = []; for (let i = 0; i < n; i++) w.push(MOTS[Math.floor(r() * MOTS.length)]);
  const s = w.join(' '); return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

export interface OdinRempli { home: string; volume: Volume; titres: string[]; fichiers: { notes: number; memoireOctets: number } }

/** Crée (ou remplit) un dossier d'Odin jetable. */
export function remplir(v: Volume, o: { home?: string; graine?: number; modeleVecteurs?: string } = {}): OdinRempli {
  const home = o.home ?? mkdtempSync(join(tmpdir(), 'odin-rapidite-'));
  const r = hasard(o.graine ?? 0x0d1);
  const mem = join(home, 'memoire'), cerveau = join(home, 'cerveau');
  mkdirSync(mem, { recursive: true }); mkdirSync(cerveau, { recursive: true });
  const now = Date.now(), JOUR = 86_400_000;
  let octets = 0;
  const ecrire = (nom: string, lignes: unknown[]) => { const t = lignes.map((x) => JSON.stringify({ p: x })).join('\n') + (lignes.length ? '\n' : ''); octets += t.length; writeFileSync(join(mem, `${nom}.jsonl`), t); };

  // Souvenirs.
  const souvenirs = [];
  for (let i = 1; i <= v.souvenirs; i++) {
    const created = now - Math.floor(r() * 300) * JOUR;
    souvenirs.push({ id: i, kind: r() < 0.05 ? 'lesson' : ['fact', 'preference', 'environment', 'mission', 'person'][Math.floor(r() * 5)], content: phrase(r, 8 + Math.floor(r() * 14)), origin: r() < 0.1 ? 'owner' : r() < 0.95 ? 'agent' : 'untrusted', trust: 0.7, tags: '', created_at: created, last_used_at: created + Math.floor(r() * 10) * JOUR, uses: Math.floor(r() * 5), pinned: r() < 0.002 ? 1 : 0, subject: SUJETS[Math.floor(r() * SUJETS.length)], topic: `cle${Math.floor(r() * 40)}`, source: 'banc', superseded_by: null });
  }
  ecrire('memories', souvenirs);

  // Vecteurs (facultatif) : un vecteur par souvenir, du modèle donné.
  if (v.vecteurs > 0) {
    const vec = [];
    for (let i = 1; i <= Math.min(v.vecteurs, v.souvenirs); i++) { const f = new Float32Array(v.dim); for (let k = 0; k < v.dim; k++) f[k] = r() * 2 - 1; vec.push({ id: i, model: o.modeleVecteurs ?? 'noos-v1', vec: Buffer.from(f.buffer).toString('base64') }); }
    ecrire('memory_vec', vec);
  }

  // Conversations.
  const sessions = [], messages = []; let mid = 0;
  for (let c = 0; c < v.conversations; c++) {
    const id = `web:conv${c}`, t0 = now - (v.conversations - c) * JOUR / 2;
    sessions.push({ id, channel: 'web', peer: `conv${c}`, title: phrase(r, 5), summary: '', compact_upto: 0, tainted: 0, created_at: t0, updated_at: t0 + 3_600_000, suspicious: 0 });
    for (let k = 0; k < v.messagesParConv; k++) messages.push({ id: ++mid, session_id: id, role: k % 2 ? 'assistant' : 'user', content: phrase(r, k % 2 ? 40 : 12), tool_calls: null, tool_call_id: null, tool_name: null, tainted: 0, created_at: t0 + k * 60_000 });
  }
  ecrire('sessions', sessions); ecrire('messages', messages);

  // Notes du Cerveau, reliées par [[…]].
  const titres: string[] = [];
  for (let i = 0; i < v.notes; i++) titres.push(`${MOTS[Math.floor(r() * MOTS.length)]} ${MOTS[Math.floor(r() * MOTS.length)]} ${i}`);
  const chemins: string[] = [];
  for (let i = 0; i < v.notes; i++) {
    const d = DOSSIERS[i % DOSSIERS.length], rel = d ? `${d}/${titres[i]}.md` : `${titres[i]}.md`;
    chemins.push(rel.replace(/\.md$/, ''));
    const liens = Array.from({ length: 1 + Math.floor(r() * 4) }, () => `[[${titres[Math.floor(r() * v.notes)]}]]`).join(' ');
    const corps = `# ${titres[i]}\n\n${Array.from({ length: 4 + Math.floor(r() * 8) }, () => phrase(r, 12 + Math.floor(r() * 20))).join(' ')}\n\nVoir aussi ${liens}.\n\n#${MOTS[Math.floor(r() * MOTS.length)].replace(/[^a-zà-ÿ]/g, '')}\n`;
    mkdirSync(join(cerveau, d), { recursive: true });
    writeFileSync(join(cerveau, rel), `---\ntype: note\ncréé: 2026-0${1 + (i % 9)}-1${i % 10}\n---\n${corps}`);
  }

  // Liens vivants appris (synapses), entre notes, mots, souvenirs et applis.
  const pts = (): string => {
    const x = r();
    if (x < 0.55) return `n:${chemins[Math.floor(r() * chemins.length)]}.md`;
    if (x < 0.8) return `m:${MOTS[Math.floor(r() * MOTS.length)].normalize('NFD').replace(/[̀-ͯ]/g, '')}`;
    if (x < 0.93) return `s:${1 + Math.floor(r() * Math.max(1, v.souvenirs))}`;
    return `a:${APPS[Math.floor(r() * APPS.length)]}`;
  };
  const liens = new Map<string, unknown>();
  let essais = 0;
  while (liens.size < v.liens && essais++ < v.liens * 5) {
    const x = pts(), y = pts(); if (x === y) continue;
    const [a, b] = x < y ? [x, y] : [y, x], id = `${a}\u0001${b}`;
    if (liens.has(id)) continue;
    const t = now - Math.floor(r() * 60) * JOUR;
    liens.set(id, { id, a, b, w: 0.1 + r() * 0.6, t, j: r() * 2, vu: t, n: 1 + Math.floor(r() * 6), k: Math.floor(r() * 3), cree: t - JOUR });
  }
  ecrire('cerveau-liens', [...liens.values()]);
  return { home, volume: v, titres, fichiers: { notes: v.notes, memoireOctets: octets } };
}
