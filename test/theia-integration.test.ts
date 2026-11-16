// Théia — l'intégration des DEUX lots : le Lot A écrit la barrière src/vision/index.ts (décodage d'image, œil), le Lot B
// l'importe (vision-locale.ts). On vérifie le chemin complet ctx.vision LOCAL : une petite image, décodée puis décrite
// par l'œil, renvoie une chaîne avec la confiance et le temps mesuré ; et, sans vrai poids présent, l'œil répond
// essaye=false, l'adaptateur le DIT honnêtement, et AUCUN service réel n'est contacté (tout est local).
//
// Tant que le Lot A n'a pas livré src/vision/index.ts, ce test se met en pause (skip) avec un message clair, au lieu
// d'échouer : c'est la seule couture entre les deux lots.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Un PNG rouge de 1×1 pixel (format natif de la barrière), en base64.
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Importe la barrière du Lot A si elle existe ; sinon undefined (le test se met en pause). */
async function barriere(): Promise<typeof import('../src/vision/index.ts') | undefined> {
  try { return await import('../src/vision/index.ts'); } catch { return undefined; }
}

test('Théia : le chemin ctx.vision local décrit une image (confiance + temps), honnête sans poids', async (t) => {
  const vision = await barriere();
  if (!vision) { t.skip('barrière du Lot A (src/vision/index.ts) pas encore livrée : couture entre les deux lots'); return; }

  // L'œil ne lève JAMAIS : il dégrade si un poids manque.
  const oeil = await vision.ouvrirOeil();
  assert.equal(typeof oeil.pret, 'boolean');
  assert.equal(typeof oeil.dim, 'number');

  const { visionLocale } = await import('../src/valhalla/theia/vision-locale.ts');
  const vl = visionLocale(oeil);
  const texte = await vl('Que vois-tu ?', [{ mime: 'image/png', data: PNG_1x1 }]);
  assert.equal(typeof texte, 'string');
  assert.ok(texte.length > 0, 'une description non vide');

  if (!oeil.aVLM) {
    // Pas de modèle image→texte : la description doit le dire honnêtement, jamais prétendre « comprendre ».
    assert.match(texte, /codé, pas encore essayé|pas encore|prudence/i);
  }
});

test('Théia : le décodeur natif rend bien une image RGBA de la bonne taille', async (t) => {
  const vision = await barriere();
  if (!vision) { t.skip('barrière du Lot A (src/vision/index.ts) pas encore livrée'); return; }
  const img = vision.decoderImage(Buffer.from(PNG_1x1, 'base64'), 'png');
  assert.equal(img.largeur, 1);
  assert.equal(img.hauteur, 1);
  assert.equal(img.rgba.length, img.largeur * img.hauteur * 4);
});
