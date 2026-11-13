// Odin OS — catalogue des applis d'Odin pour le mode essai.
// Sans Odin joignable (page ouverte seule, téléphone pas encore relié), le bureau montre quand même
// les vraies applis d'Odin : cette liste est écrite à partir du registre de Valhalla, jamais à la main.
// `npm run os:catalogue` la régénère ; un test vérifie qu'elle est à jour.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from '../config.ts';
import { allModules } from '../valhalla/odin.ts';
import type { Module } from '../valhalla/types.ts';

export interface AppliCatalogue { id: string; name: string; family: Module['family']; what: string; does: string[]; actions: Array<{ id: string; label: string; what: string; read: boolean; grave: boolean }> }

/** Les applis d'Odin, telles que le bureau les affiche (mêmes champs que /api/valhalla/catalog). */
export function catalogueOS(modules: Module[]): AppliCatalogue[] {
  return modules.map((m) => ({ id: m.id, name: m.name, family: m.family, what: m.what, does: m.does, actions: m.actions.map((a) => ({ id: a.id, label: a.label, what: a.what, read: Boolean(a.read), grave: Boolean(a.grave) })) }));
}

/** Le registre complet, sans démarrer Odin (aucune appli n'est lancée : on lit seulement leur fiche). */
export function modulesPourCatalogue(): Module[] {
  const home = mkdtempSync(join(tmpdir(), 'odin-os-catalogue-'));
  return allModules({ paths: { home, workspace: join(home, 'ws') }, cfg: DEFAULT_CONFIG } as never);
}

export const FICHIER_CATALOGUE = join(dirname(fileURLToPath(import.meta.url)), 'shell', 'catalogue.js');
export const texteCatalogue = (modules: Module[]): string => `// Odin OS — applis d'Odin (mode essai). Fichier généré par « npm run os:catalogue » : ne pas modifier à la main.\nwindow.OS_CATALOGUE = ${JSON.stringify(catalogueOS(modules), null, 1)};\n`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mods = modulesPourCatalogue();
  writeFileSync(FICHIER_CATALOGUE, texteCatalogue(mods));
  console.log(`${mods.length} applis écrites dans ${FICHIER_CATALOGUE}`);
  process.exit(0); // certaines applis gardent des minuteries : on sort sans attendre
}
