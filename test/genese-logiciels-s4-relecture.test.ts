// Genèse · Systèmes, lot S4 — relecture (côté serveur) : les profils de logiciels piégés et abîmés :
//   - un nom invisible (fin de ligne U+2028 / U+2029, remplissage hangul, braille vide, accents seuls) est refusé ;
//   - « enregistrer » sans les logiciels (ou avec un texte illisible) ne vide JAMAIS le profil en silence ;
//   - un fichier des profils abîmé à la main, ou un profil abîmé dedans, n'est jamais écrasé : copié à part d'abord ;
//   - l'écriture est faite d'un coup, dans le dossier de Genèse seulement (aucun fichier temporaire laissé).
// Données fausses, dossiers temporaires neufs, aucun réseau réel, aucun vrai serveur de démarrage.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import * as T from '../src/valhalla/modules/thjalfi.ts';
import type { ModCtx } from '../src/valhalla/types.ts';

const X = T as unknown as Record<string, any>;
const dossiers: string[] = [];
const neuf = (n: string) => { const d = mkdtempSync(join(tmpdir(), `odin-s4r-${n}-`)); dossiers.push(d); return d; };
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const c = (...n: number[]) => String.fromCodePoint(...n);
type R = { ok: boolean; text: string; data?: any };
function actions() {
  const dir = neuf('dir');
  const ctx = { home: dir, dir, settings: {}, now: () => new Date('2026-11-23T10:00:00Z'), run: async () => ({}), call: async () => ({}) } as unknown as ModCtx;
  const [lire, ecrire] = X.profilsLogicielsActions(() => undefined) as Array<{ run: (ctx: ModCtx, i: Record<string, unknown>) => R }>;
  return { dir, ctx, lire: () => lire.run(ctx, {}), ecrire: (i: Record<string, unknown>) => ecrire.run(ctx, i) };
}
const SYS = () => ({ windows: { logiciels: [{ id: 'vlc', fichier: 'vlc-faux.exe', nom: 'VLC' }], scripts: [] } });

test('S4 relecture · noms : U+2028, U+2029 et les noms qui ne se voient pas sont refusés ; espaces spéciaux ramenés', () => {
  const v = X.nomProfilValide as (n: unknown) => string | undefined;
  for (const n of [`Bureau${c(0x2028)}`, `${c(0x2029)}Bureau`, c(0x2028), c(0x3164), c(0x115f, 0x1160), c(0xffa0), c(0x2800), c(0x301, 0x301), `A${c(0x202e)}B`, `A${c(0x200b)}`])
    assert.equal(v(n), undefined, `refusé : ${[...n].map((x) => x.codePointAt(0)!.toString(16)).join(' ')}`);
  assert.equal(v(`Bureau${c(0xa0, 0x2003)}Maison`), 'Bureau Maison', 'insécable et cadratin : un espace simple');
  assert.equal(v('Développeur'), 'Développeur');
  // Les mêmes règles pour les noms de logiciels et de scripts d'un profil ; un « : » (lecteur, flux caché) est refusé.
  const { ecrire } = actions();
  assert.equal(ecrire({ op: 'creer', nom: 'A', systemes: { windows: { logiciels: [{ fichier: `vlc${c(0x2028)}.exe` }] } } }).ok, false);
  assert.equal(ecrire({ op: 'creer', nom: 'B', systemes: { windows: { logiciels: [{ fichier: 'C:vlc-faux.exe' }] } } }).ok, false);
  assert.equal(ecrire({ op: 'creer', nom: 'C', systemes: { windows: { logiciels: [], scripts: [{ nom: 'a:b.cmd', contenu: 'echo' }] } } }).ok, false);
});

test('S4 relecture · « enregistrer » sans logiciels, ou avec un texte illisible, ne vide jamais le profil', () => {
  const { ecrire, lire } = actions();
  const id = ecrire({ op: 'creer', nom: 'Bureau', systemes: SYS() }).data.choisi as string;
  const compte = () => lire().data.profils[0].systemes.windows.logiciels.length;
  let r = ecrire({ op: 'enregistrer', id });
  assert.equal(r.ok, false); assert.match(r.text, /Rien à enregistrer/); assert.equal(compte(), 1);
  r = ecrire({ op: 'enregistrer', id, systemes: 'pas du JSON' });
  assert.equal(r.ok, false); assert.match(r.text, /illisible/); assert.equal(compte(), 1);
  r = ecrire({ op: 'enregistrer', id, systemes: [1, 2] });
  assert.equal(r.ok, false); assert.equal(compte(), 1);
  assert.equal(ecrire({ op: 'creer', nom: 'Autre', systemes: 'x' }).ok, false, 'créer aussi');
  // L'écriture JSON d'un formulaire est comprise.
  r = ecrire({ op: 'enregistrer', id, systemes: JSON.stringify({ windows: { logiciels: [{ id: 'vlc', fichier: 'vlc-faux.exe' }, { id: 'firefox', fichier: 'Firefox-Setup-faux.exe' }] } }) });
  assert.equal(r.ok, true, r.text); assert.equal(compte(), 2);
});

test('S4 relecture · fichier des profils abîmé à la main : jamais écrasé, copié à part avant d\'écrire', () => {
  const { dir, ecrire, lire } = actions();
  ecrire({ op: 'creer', nom: 'Bureau', systemes: SYS() });
  const f = join(dir, 'profils-logiciels.json'), abime = readFileSync(f, 'utf8').slice(0, -3);
  writeFileSync(f, abime);
  const l = lire();
  assert.equal(l.ok, true); assert.match(l.text, /abîmé/); assert.equal(l.data.abimes, -1);
  const r = ecrire({ op: 'creer', nom: 'Neuf' });
  assert.equal(r.ok, true, r.text); assert.match(r.text, /gardé à part : profils-logiciels\.abime-/);
  const copies = readdirSync(dir).filter((x) => x.startsWith('profils-logiciels.abime-'));
  assert.equal(copies.length, 1);
  assert.equal(readFileSync(join(dir, copies[0]), 'utf8'), abime, 'l\'ancien contenu, tel quel');
  assert.equal(lire().data.abimes, 0);
});

test('S4 relecture · un profil abîmé (ou en double) dans un fichier sain : laissé de côté, dit, et copié à part', () => {
  const { dir, ecrire, lire } = actions();
  const id = ecrire({ op: 'creer', nom: 'Bureau', systemes: SYS() }).data.choisi as string;
  const f = join(dir, 'profils-logiciels.json'), j = JSON.parse(readFileSync(f, 'utf8'));
  j.profils.push({ id: 'p-0123456789ab', nom: 'Manuel', systemes: { windows: { logiciels: [{ fichier: 'x.deb' }] } } });
  j.profils.push({ ...j.profils[0], nom: 'Jumeau' });
  j.profils.push({ id: 'p-abcdefabcdef', nom: '__proto__', systemes: JSON.parse('{"__proto__":{"windows":{"logiciels":[{"fichier":"z.exe"}]}}}') });
  writeFileSync(f, JSON.stringify(j));
  const l = lire();
  assert.deepEqual(l.data.profils.map((p: { id: string; nom: string }) => [p.id, p.nom]), [[id, 'Bureau'], ['p-abcdefabcdef', '__proto__']], 'un seul profil par id');
  assert.deepEqual(l.data.profils[1].systemes.windows.logiciels, [], '__proto__ n\'est jamais lu comme un système');
  assert.equal(l.data.abimes, 2); assert.match(l.text, /2 profil\(s\) abîmé\(s\)/);
  const r = ecrire({ op: 'renommer', id, nom: 'Maison' });
  assert.equal(r.ok, true); assert.match(r.text, /gardé à part/);
  const copie = readdirSync(dir).find((x) => x.startsWith('profils-logiciels.abime-'))!;
  assert.match(readFileSync(join(dir, copie), 'utf8'), /Manuel/, 'le profil abîmé n\'est pas perdu');
});

test('S4 relecture · écriture d\'un coup, dans le dossier de Genèse seulement : aucun fichier temporaire laissé', () => {
  const { dir, ecrire } = actions();
  // Un reste d'un ancien arrêt brutal (ancien nom de fichier temporaire) ne gêne pas et n'est pas réutilisé.
  writeFileSync(join(dir, 'profils-logiciels.json.tmp'), 'reste');
  for (let k = 0; k < 5; k++) assert.equal(ecrire({ op: 'creer', nom: `P${k}`, systemes: SYS() }).ok, true);
  assert.deepEqual(readdirSync(dir).sort(), ['profils-logiciels.json', 'profils-logiciels.json.tmp']);
  assert.equal(readFileSync(join(dir, 'profils-logiciels.json.tmp'), 'utf8'), 'reste');
  assert.equal(JSON.parse(readFileSync(join(dir, 'profils-logiciels.json'), 'utf8')).profils.length, 5);
});
// Les ajouts (1) et (2) (menu texte demandé sur l'écran, attente au délai du menu) : essais dans thjalfi.test.ts (son monde HTTP).
