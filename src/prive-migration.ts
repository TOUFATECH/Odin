// Migration des données privées encore en clair (Odin d'avant le chiffrement des champs privés), faite au démarrage :
// copies d'annulation (undo/*.bak) de config.json et des réglages des applis, positions de la famille, réglages privés
// de la mémoire d'Odin (réveil). Rien n'est perdu : seules les valeurs privées changent de forme (chiffrées).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { undoList } from './undo.ts';
import { enClair, fermer, fermerKv, lireFichierPrive, ecrireFichierPrive, PRIVES_CONFIG, PRIVES_KV, privesAppli, type Chemin } from './prive.ts';
import { champChiffre } from './vault.ts';

/** Les chemins privés d'une copie, d'après le fichier copié (config.json, valhalla/<appli>/réglages.json). */
function cheminsDe(chemin: string): Chemin[] {
  if (basename(chemin) === 'config.json') return PRIVES_CONFIG;
  if (basename(chemin) === 'réglages.json') return privesAppli(basename(dirname(chemin)));
  return [];
}

/** Les copies d'annulation : chaque valeur privée en clair y est chiffrée (une copie illisible est laissée telle quelle). */
export function chiffrerUndo(home: string): number {
  const dir = join(home, 'undo'); if (!existsSync(dir)) return 0;
  const connues = new Map(undoList(home).filter((e) => e.backup).map((e) => [basename(e.backup!), e.path]));
  let n = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.bak')) continue;
    const p = join(dir, f);
    try {
      const o = JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')) as Record<string, unknown>;
      // Copie d'un fichier inconnu du journal : une config d'Odin se reconnaît à ses messageries.
      const ch = connues.has(f) ? cheminsDe(connues.get(f)!) : ('channels' in o ? PRIVES_CONFIG : []);
      if (ch.length && enClair(o, ch)) { writeFileSync(p, JSON.stringify(fermer(home, o, ch), null, 2), { mode: 0o600 }); n++; }
    } catch { /* pas du JSON : pas une copie de réglages */ }
  }
  return n;
}

type Kv = { getKv(k: string): string | undefined | null; setKv(k: string, v: string): void; kvBrut(k: string): string | undefined; compacterKv(): void };

/**
 * Au démarrage d'Odin : tout ce qui est privé et encore en clair est chiffré. `kv` : la mémoire d'Odin (ses réglages
 * privés, puis le fichier est réécrit pour ne plus garder les anciennes lignes en clair).
 */
export function migrerDonneesPrivees(home: string, kv?: Kv): string[] {
  const fait: string[] = [];
  try { if (chiffrerUndo(home)) fait.push('copies d\'annulation'); } catch (e) { console.error(`[réglages] copies d'annulation : ${(e as Error).message}`); }
  // Positions de la famille (Hestia) : le fichier entier est chiffré.
  const pos = join(home, 'valhalla', 'gladsheim', 'positions.json');
  try {
    if (existsSync(pos) && !champChiffre(readFileSync(pos, 'utf8'))) { const o = lireFichierPrive<unknown>(home, pos); if (o !== undefined) { ecrireFichierPrive(home, pos, o); fait.push('positions de la famille'); } }
  } catch (e) { console.error(`[réglages] positions : ${(e as Error).message}`); }
  if (kv) {
    let change = false;
    for (const k of Object.keys(PRIVES_KV)) {
      // la valeur telle que gardée sur le disque : encore des champs privés en clair ?
      const brut = kv.kvBrut(k); if (!brut || fermerKv(home, k, brut) === brut) continue;
      kv.setKv(k, kv.getKv(k) ?? brut); change = true;
    }
    // le fichier est réécrit : les anciennes lignes en clair disparaissent
    if (change) { kv.compacterKv(); fait.push('réveil'); }
  }
  return fait;
}
