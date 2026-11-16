// Les réglages de Kéryx, rangés en fichier chiffré sous valhalla/keryx/ (la liste blanche de numéros est privée :
// chaque numéro est chiffré avec la clé de la machine, comme les autres données privées d'Odin). Le mot de passe SIP
// et le code secret ne sont JAMAIS ici : ils vont au coffre.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chiffrerChamp, dechiffrerChamp } from '../../vault.ts';
import { normaliser } from './auth.ts';
import { type Ligne, type NiveauAuto, REGLAGES_DEFAUT, type ReglagesKeryx, type Surveillance } from './types.ts';

const fichier = (home: string): string => join(home, 'valhalla', 'keryx', 'reglages.json');

const LIGNES: Ligne[] = ['aucune', 'modem', 'sip'];
const NIVEAUX: NiveauAuto[] = ['prudent', 'equilibre', 'autonome'];

function nettoyerSurveillances(v: unknown): Surveillance[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 50).map((x) => x as Record<string, unknown>).filter((x) => x && (x.quoi === 'rappel_rdv' || x.quoi === 'mail_important')).map((x) => ({
    id: String(x.id ?? '').slice(0, 40) || Math.random().toString(16).slice(2, 10),
    quoi: x.quoi as Surveillance['quoi'],
    reglage: String(x.reglage ?? '').slice(0, 120),
    actif: x.actif === true,
  }));
}

/** Lit les réglages (numéros déchiffrés). Les valeurs par défaut comblent ce qui manque. */
export function lireReglages(home: string): ReglagesKeryx {
  try {
    const r = JSON.parse(readFileSync(fichier(home), 'utf8')) as Record<string, unknown>;
    const numeros = Array.isArray(r.numeros) ? (r.numeros as string[]).map((n) => { try { return dechiffrerChamp(home, n); } catch { return ''; } }).filter(Boolean) : [];
    return {
      ligne: LIGNES.includes(r.ligne as Ligne) ? r.ligne as Ligne : 'aucune',
      numeros,
      autonomieApresSecret: NIVEAUX.includes(r.autonomieApresSecret as NiveauAuto) ? r.autonomieApresSecret as NiveauAuto : 'prudent',
      actionGraveParAppel: r.actionGraveParAppel === 'second_canal' ? 'second_canal' : 'interdite',
      surveillances: nettoyerSurveillances(r.surveillances),
      ...(r.modem && typeof r.modem === 'object' ? { modem: { port: String((r.modem as Record<string, unknown>).port ?? '').slice(0, 80), debit: Number((r.modem as Record<string, unknown>).debit) || 115200 } } : {}),
      ...(r.sip && typeof r.sip === 'object' ? { sip: { serveur: String((r.sip as Record<string, unknown>).serveur ?? '').slice(0, 120), utilisateur: String((r.sip as Record<string, unknown>).utilisateur ?? '').slice(0, 80) } } : {}),
    };
  } catch { return { ...REGLAGES_DEFAUT }; }
}

/** Écrit (fusionne) des réglages. Les numéros sont chiffrés au repos. Rend les réglages à jour. */
export function ecrireReglages(home: string, partiel: Partial<ReglagesKeryx>): ReglagesKeryx {
  const cur = lireReglages(home);
  const next: ReglagesKeryx = {
    ligne: partiel.ligne && LIGNES.includes(partiel.ligne) ? partiel.ligne : cur.ligne,
    numeros: partiel.numeros ? [...new Set(partiel.numeros.map(normaliser).filter(Boolean))].slice(0, 100) : cur.numeros,
    autonomieApresSecret: partiel.autonomieApresSecret && NIVEAUX.includes(partiel.autonomieApresSecret) ? partiel.autonomieApresSecret : cur.autonomieApresSecret,
    actionGraveParAppel: partiel.actionGraveParAppel ?? cur.actionGraveParAppel,
    surveillances: partiel.surveillances ? nettoyerSurveillances(partiel.surveillances) : cur.surveillances,
    ...(partiel.modem ?? cur.modem ? { modem: partiel.modem ?? cur.modem } : {}),
    ...(partiel.sip ?? cur.sip ? { sip: partiel.sip ?? cur.sip } : {}),
  };
  const d = join(home, 'valhalla', 'keryx');
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  const aEcrire = { ...next, numeros: next.numeros.map((n) => chiffrerChamp(home, n)) };
  writeFileSync(fichier(home), JSON.stringify(aEcrire, null, 2), { mode: 0o600 });
  return next;
}
