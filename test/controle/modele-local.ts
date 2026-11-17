// Partie « avec le modèle local seulement » : aucun service extérieur.
//  1. Soul (Noûs), le cerveau profond d'Odin, s'il a un point de reprise : il recharge, ses plongements servent, et il
//     PROPOSE l'appli d'une demande (« Demande : …\nRéponse : » → « Vortex (gjoll) »). Dossier : SOUL_HOME (un dossier
//     d'Odin jetable où le point de reprise a été écrit) ; sans lui, ces scénarios sont « ignorés ».
//  2. Métis (modèle de langue ouvert, fichier GGUF, qui tourne DANS Odin) : les questions vrai/faux. Fichier : METIS_GGUF ;
//     sans lui (le cas de ce poste), « ignoré », jamais compté comme réussi.
import { existsSync } from 'node:fs';
import { ok, type Scenario, type Verdict } from './banc.ts';
import { AFFIRMATIONS } from './vrai-faux.ts';

const SOUL_HOME = process.env.SOUL_HOME ?? '';
const METIS = process.env.METIS_GGUF ?? '';
const ignore = (d: string): Verdict => ({ ok: 'ignore', detail: d });

let moteur: Promise<import('../../src/brain/nous/moteur.ts').Moteur | undefined> | undefined;
async function soul() {
  if (!SOUL_HOME || !existsSync(SOUL_HOME)) return undefined;
  moteur ??= (async () => {
    if (SOUL_HOME && !process.env.ODIN_CLE_DIR) process.env.ODIN_CLE_DIR = `${SOUL_HOME}/../cles`;
    const { chargerMoteur } = await import('../../src/brain/nous/moteur.ts');
    return chargerMoteur(SOUL_HOME);
  })();
  return moteur;
}
export async function fermerModeleLocal(): Promise<void> { const m = await moteur; await m?.arreter(); }

const ROUTES: Array<{ id: string; demande: string; ok: string[]; exig: string }> = [
  { id: 'vpn', demande: 'qui est connecté sur le VPN ?', ok: ['gjoll'], exig: 'D-07' },
  { id: 'serie', demande: 'lance-moi la série Lupin, saison 2, épisode 3', ok: ['freyja'], exig: 'D-06' },
  { id: 'cle-usb', demande: 'j\'ai branché une clé USB, démarre dessus', ok: ['thjalfi'], exig: 'D-05' },
  { id: 'appli-tourne', demande: 'quelle application tourne en ce moment ?', ok: ['eir'], exig: 'D-08' },
  { id: 'bloquer-site', demande: 'quelle appli pour bloquer un site ?', ok: ['vidarr', 'heidrun'], exig: 'élément 7 (critère)' },
  { id: 'photos', demande: 'sauvegarde mes photos de vacances', ok: ['sindri', 'sol'], exig: 'D-04' },
];

export const MODELE_LOCAL: Scenario[] = [
  {
    id: 'soul-recharge', domaine: 'soul', partie: 'modele-local', exigence: 'D-04, NEU', titre: 'Soul recharge son point de reprise',
    attendu: 'chargerMoteur rend un moteur prêt',
    async jouer() { const m = await soul(); if (!SOUL_HOME) return ignore('SOUL_HOME non donné'); return ok(!!m?.pret, m ? `${m.modeleEmbedding}, ${m.hyper.poids} poids, prêt : ${m.pret}` : 'aucun point de reprise lisible'); },
  },
  {
    id: 'soul-plongement', domaine: 'soul', partie: 'modele-local', exigence: 'MEM (recherche par le sens)', titre: 'Soul rapproche deux demandes de même sens',
    attendu: '« bloque les pubs » est plus proche de « filtre les publicités » que de « joue du jazz »',
    async jouer() {
      const m = await soul(); if (!m) return ignore('pas de Soul entraîné');
      const [a, b, c] = await Promise.all(['bloque les pubs sur toute la maison', 'filtre les publicités du réseau', 'joue du jazz dans le salon'].map((t) => m.plonger(t)));
      const cos = (x: Float32Array, y: Float32Array) => { let s = 0, nx = 0, ny = 0; for (let i = 0; i < x.length; i++) { s += x[i] * y[i]; nx += x[i] ** 2; ny += y[i] ** 2; } return s / Math.sqrt(nx * ny); };
      const ab = cos(a, b), ac = cos(a, c);
      return ok(ab > ac, `proche : ${ab.toFixed(3)} ; éloigné : ${ac.toFixed(3)}`);
    },
  },
  ...ROUTES.map((r): Scenario => ({
    id: `soul-${r.id}`, domaine: 'soul', partie: 'modele-local', exigence: r.exig, titre: `Soul propose l'appli pour « ${r.demande} »`,
    attendu: `la proposition nomme ${r.ok.join(' ou ')}`,
    async jouer() {
      const m = await soul(); if (!m) return ignore('pas de Soul entraîné');
      const p = await m.proposer({ texte: r.demande, maxMorceaux: 32, graine: 1 }); // forme du produit : [USER] demande [ASSISTANT]
      const id = /\(([a-z0-9_]+)\)/.exec(p.texte)?.[1];
      return ok(!!id && r.ok.includes(id), `« ${p.texte.trim().slice(0, 60)} » (confiance ${p.confiance.toFixed(2)}, ${Math.round(p.tempsMs)} ms)`);
    },
  })),
  ...AFFIRMATIONS.slice(0, 3).map((a): Scenario => ({
    id: `metis-vf-${a.id}`, domaine: 'vrai-faux', partie: 'modele-local', exigence: a.exigence, titre: `(Métis) ${a.phrase}`,
    attendu: a.verite ? 'VRAI' : 'FAUX',
    async jouer() {
      if (!METIS || !existsSync(METIS)) return ignore('aucun modèle de langue local (GGUF) sur ce poste : METIS_GGUF non donné');
      return ignore('brancher Métis : chemin donné, mais ce banc ne lance pas encore le fournisseur Métis (à faire quand un modèle est installé)');
    },
  })),
];
