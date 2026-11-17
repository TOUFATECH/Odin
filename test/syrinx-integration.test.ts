// Syrinx — l'intégration des DEUX lots : le lot A (src/audio : lire, entendre sans modèle, modèle de sons) et le lot B
// (l'appli). Un mini modèle de sons à poids à graine est écrit, ouvert, puis injecté ; un WAV de 30 s (accord de do et
// clics à 120 BPM) est déposé dans l'atelier. On vérifie : tempo 120 ± 2, « do majeur », des étiquettes du mini modèle,
// un temps mesuré par étape, un rangement chiffré, « déjà entendu » au deuxième appel, et « retrouver » par le même son.
// Aucun outil média, aucune transcription, aucun réseau. À lancer quand les deux lots sont finis.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { syrinx, oreilleEssai } from '../src/valhalla/syrinx/index.ts';
import { oublierMagasin } from '../src/valhalla/syrinx/magasin.ts';
import { ecrireMiniModele, sinus, wavDe, FS } from './syrinx-outils-essai.ts';

const home = mkdtempSync(join(tmpdir(), 'syrinx-integ-'));
after(() => rmSync(home, { recursive: true, force: true }));

/** 30 s : accord de do majeur (do, mi, sol) et un clic toutes les 0,5 s (120 BPM). */
function accordEtClics(sec: number): Uint8Array {
  const n = Math.round(sec * FS), x = new Float32Array(n);
  for (const f of [261.63, 329.63, 392.0, 523.25]) { const s = sinus(f, sec, FS, 0.12); for (let i = 0; i < n; i++) x[i] += s[i]; }
  const pas = Math.round(FS * 0.5), clic = Math.round(FS * 0.01);
  for (let d = 0; d < n; d += pas) for (let i = 0; i < clic && d + i < n; i++) x[d + i] += 0.6 * Math.exp(-i / (clic / 4)) * (i % 2 ? 1 : -1);
  return wavDe([x], FS, 's16');
}

test('Syrinx : de bout en bout avec le vrai calcul et un mini modèle de sons', async () => {
  oreilleEssai(); oublierMagasin();
  const vraiFetch = globalThis.fetch; let reseau = 0;
  globalThis.fetch = (async () => { reseau++; throw new Error('réseau interdit'); }) as typeof fetch;
  try {
    const audio = await import('../src/audio/index.ts');
    const poids = join(home, 'mini'); mkdirSync(poids, { recursive: true });
    const { sha256 } = await ecrireMiniModele(poids);
    const modele = await audio.ouvrirModeleSons({ dossier: poids, attendu: { sha256 } });
    assert.equal(modele.pret, true, modele.raison);

    const v = new Valhalla(home, [syrinx(() => ({ modele: async () => modele, ecouter: null, demander: null }))], { notify: async () => {}, fetch: async () => { throw new Error('réseau interdit'); } });
    const ctx = v.ctx('syrinx');
    mkdirSync(join(ctx.dir, 'atelier'), { recursive: true });
    writeFileSync(join(ctx.dir, 'atelier', 'accord.wav'), accordEtClics(30));

    const r = await v.act('syrinx', 'ecouter', { fichier: 'atelier:accord.wav' });
    assert.equal(r.ok, true, r.text);
    const d = r.data as { id: string; tempo?: number; tonalite?: string; sons: string };
    assert.ok(d.tempo !== undefined && Math.abs(d.tempo - 120) <= 2, `tempo ${d.tempo}\n${r.text}`);
    assert.equal(d.tonalite, 'do majeur', r.text);
    assert.equal(d.sons, 'fait', r.text);
    assert.match(r.text, /seuil \d+ %/, 'des étiquettes du mini modèle avec leur seuil');
    assert.match(r.text, /Temps mesuré : .*lecture du son \d+ ms.*modèle de sons \d+ ms.*total \d+ ms/, r.text);
    assert.match(r.text, /parole : pas prête sur ce poste/);
    // Rangé et chiffré.
    const fichiers = readdirSync(join(ctx.dir, 'analyses'));
    assert.equal(fichiers.length, 1);
    const brut = readFileSync(join(ctx.dir, 'analyses', fichiers[0]), 'utf8');
    assert.match(brut, /"contenu":"odc1:/);
    assert.doesNotMatch(brut, /do majeur|BPM/);

    const r2 = await v.act('syrinx', 'ecouter', { fichier: 'accord.wav' });
    assert.match(r2.text, /déjà entendu le/);

    const t = await v.act('syrinx', 'retrouver', { fichier: 'accord.wav' });
    assert.equal(t.ok, true, t.text);
    assert.ok((t.data as { resultats: Array<{ id: string }> }).resultats.some((x) => x.id === d.id), t.text);
    assert.equal(reseau, 0, 'aucun appel réseau');
    v.stop();
  } finally { globalThis.fetch = vraiFetch; }
});
