// Étape 5 : Pégase avec un VRAI Odin (processus à part, routes /api/pegase/* et SSO d'Odin).
// 1er lancement (Odin trouvé tout seul sur ce PC, connexion, restauration), synchro en temps réel entre deux PC,
// file d'attente hors ligne chiffrée, conflit (le plus récent gagne), compte créé avec l'accord du propriétaire,
// connexion unique du poste (sans mot de passe), IA d'Odin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { lancer, odinReel, relais, attendre, principal } from './banc.mjs';

const MDP_AWA = 'un-cheval-bleu-traverse-mamoudzou'; // le mot de passe du compte d'Odin de l'essai (banc d'Odin)
const etat = (ui) => ui.evaluate(() => window.pegase.etat());
const favoris = async (ui) => (await ui.evaluate(() => window.pegase.faire('favoris'))).filter((f) => f.type === 'favori');

async function connecterPremierLancement(ui) {
  await ui.waitForSelector('#ecran [data-ecran="odin"]', { timeout: 30_000 });
  await ui.waitForSelector('#statut-odin >> text=Odin trouvé sur ce PC', { timeout: 20_000 });
  await ui.fill('#ecran [name=email]', 'awa@exemple.yt');
  await ui.fill('#ecran [name=motdepasse]', MDP_AWA);
  await ui.click('#ecran button[type=submit]');
  await attendre(async () => (await etat(ui)).ecran === 'navigateur', 20_000);
}

test('1er lancement, synchro temps réel, hors ligne, conflit, compte avec accord, connexion unique, IA', { timeout: 420_000 }, async () => {
  const odin = await odinReel();
  const tmp = process.env.PEGASE_TMP || tmpdir();
  const coffre = join(mkdtempSync(join(tmp, 'coffre-')), 'coffre.json'); // le « coffre du système » de l'essai (un PC = un coffre)
  const r = await relais(odin.port); // PC A passe par un relais qu'on peut couper
  const envA = { PEGASE_ODIN_PORTS: String(r.port), PEGASE_ODIN_RESEAU: 'non', PEGASE_COFFRE_ESSAI: coffre, PEGASE_DNS: 'systeme', PEGASE_VERIF_MS: '3000' };
  const envB = { ...envA, PEGASE_ODIN_PORTS: String(odin.port), PEGASE_COFFRE_ESSAI: join(mkdtempSync(join(tmp, 'coffre-')), 'c.json') };
  const A = await lancer({ premier: true, env: envA });
  let B, C, D;
  try {
    // ——— PC A : 1er lancement, Odin trouvé tout seul, connexion avec le mot de passe d'Odin.
    const s0 = await etat(A.ui);
    assert.equal(s0.ecran, 'odin');
    assert.match(s0.premier.trouves[0].adresse, new RegExp(`127\\.0\\.0\\.1:${r.port}`));
    // Un mauvais mot de passe est refusé avec le texte d'Odin, sans rien dire de plus.
    await A.ui.fill('#ecran [name=email]', 'awa@exemple.yt');
    await A.ui.fill('#ecran [name=motdepasse]', 'pas-le-bon-mot-de-passe');
    await A.ui.click('#ecran button[type=submit]');
    await A.ui.waitForSelector('#ecran .erreur >> text=/incorrect/i');
    await A.ui.fill('#ecran [name=motdepasse]', MDP_AWA);
    await A.ui.click('#ecran button[type=submit]');
    await attendre(async () => (await etat(A.ui)).ecran === 'navigateur', 20_000);
    await attendre(async () => (await etat(A.ui)).synchro.etat === 'ok', 20_000);
    assert.equal((await etat(A.ui)).profil.nom, 'Awa Saïd', 'le profil prend le nom de la personne d’Odin');
    await A.ui.waitForSelector('#haut >> text=Odin · synchronisé');
    // Le jeton n'est jamais écrit en clair : ni dans les fichiers du profil, ni le mot de passe.
    const fOdin = join(A.dossier, 'profils', 'toi', 'odin.json.pgs');
    assert.ok(existsSync(fOdin));
    const brut = readFileSync(fOdin);
    assert.ok(!brut.includes('pg1.') && !brut.includes(MDP_AWA) && !brut.includes('awa@exemple.yt'), 'fichier chiffré');

    // Un favori ajouté sur A.
    await A.ui.evaluate(() => window.pegase.faire('basculerFavori', { url: 'https://mayotte.fr/', nom: 'Mayotte' }));

    // ——— PC B : 1er lancement, se connecte, retrouve le favori de A (restauration).
    B = await lancer({ premier: true, env: envB });
    await connecterPremierLancement(B.ui);
    await attendre(async () => (await favoris(B.ui)).some((f) => f.url === 'https://mayotte.fr/'), 20_000);

    // Temps réel : A ajoute, B le voit en moins de 3 s (flux SSE).
    const t0 = Date.now();
    await A.ui.evaluate(() => window.pegase.faire('basculerFavori', { url: 'https://toufatech.com/', nom: 'TOUFATECH' }));
    await attendre(async () => (await favoris(B.ui)).some((f) => f.url === 'https://toufatech.com/'), 10_000, 50);
    const delai = Date.now() - t0;
    assert.ok(delai < 3000, `arrivé en ${delai} ms`);
    // Suppression sur B → disparaît sur A.
    const fB = (await favoris(B.ui)).find((f) => f.url === 'https://mayotte.fr/');
    await B.ui.evaluate((id) => window.pegase.faire('supprFavori', { id }), fB.id);
    await attendre(async () => !(await favoris(A.ui)).some((f) => f.url === 'https://mayotte.fr/'), 10_000);

    // ——— Hors ligne : A perd Odin ; ses changements attendent dans une file chiffrée sur le disque.
    r.couper();
    await A.ui.evaluate(() => window.pegase.faire('basculerFavori', { url: 'https://hors-ligne.exemple/', nom: 'Fait hors ligne' }));
    await attendre(async () => { const s = (await etat(A.ui)).synchro; return s.etat === 'horsligne' && s.attente >= 1; }, 20_000);
    await A.ui.waitForSelector('#haut >> text=/hors ligne \\(\\d+ en attente\\)/');
    const file = readFileSync(join(A.dossier, 'profils', 'toi', 'attente.json.pgs'));
    assert.ok(!file.includes('hors-ligne.exemple'), 'file d’attente chiffrée');
    // Conflit : pendant ce temps, A et B renomment le même favori ; B le fait en dernier → B gagne partout.
    const fA = (await favoris(A.ui)).find((f) => f.url === 'https://toufatech.com/');
    await A.ui.evaluate((id) => window.pegase.faire('majFavori', { id, nom: 'Nom de A (plus ancien)' }), fA.id);
    await new Promise((ok) => setTimeout(ok, 50));
    await B.ui.evaluate((id) => window.pegase.faire('majFavori', { id, nom: 'Nom de B (plus récent)' }), fA.id);
    assert.ok(!(await favoris(B.ui)).some((f) => f.url === 'https://hors-ligne.exemple/'));
    // Retour de la connexion : la file part toute seule, B reçoit, et le conflit est réglé pareil des deux côtés.
    r.rebrancher();
    await attendre(async () => (await favoris(B.ui)).some((f) => f.url === 'https://hors-ligne.exemple/'), 40_000);
    await attendre(async () => (await favoris(A.ui)).find((f) => f.id === fA.id)?.nom === 'Nom de B (plus récent)', 20_000);
    assert.equal((await favoris(B.ui)).find((f) => f.id === fA.id)?.nom, 'Nom de B (plus récent)');
    await attendre(async () => (await etat(A.ui)).synchro.etat === 'ok', 20_000);
    // Les deux PC ont les mêmes empreintes que l'autre (vérification « à l'identique »).
    const emp = (app) => principal(app, () => { const p = [...globalThis.__pegase.profils.values()][0]; return ['favoris', 'agenda', 'reglages'].map((c) => p.base.empreinte(c).hash).join(','); });
    await attendre(async () => (await emp(A.app)) === (await emp(B.app)), 20_000);

    // ——— IA d'Odin depuis Pégase (le faux fournisseur d'IA du banc d'Odin répond « ok »).
    const rep = await A.ui.evaluate(() => window.pegase.faire('odinDemander', { texte: 'Bonjour Odin' }));
    assert.equal(rep.texte, 'ok');
    assert.ok(Array.isArray(await A.ui.evaluate(() => window.pegase.faire('propositions'))));

    // ——— Connexion unique : un autre profil Pégase sur le PC A (même coffre du système) entre sans mot de passe.
    D = await lancer({ premier: true, env: { ...envA } });
    await attendre(async () => (await etat(D.ui)).ecran === 'navigateur', 30_000);
    assert.equal((await etat(D.ui)).profil.nom, 'Awa Saïd');
    await attendre(async () => (await favoris(D.ui)).some((f) => f.url === 'https://hors-ligne.exemple/'), 20_000);
    await D.fermer(); D = null;

    // ——— PC C : « Ignorer » → créer son compte → sauvegarder sur Odin, avec l'accord du propriétaire.
    C = await lancer({ premier: true, env: { ...envB, PEGASE_COFFRE_ESSAI: join(mkdtempSync(join(tmp, 'coffre-')), 'c.json') } });
    await C.ui.waitForSelector('#ecran [data-ecran="odin"]', { timeout: 30_000 });
    await C.ui.click('#ecran [data-ignorer="odin"]');
    await C.ui.waitForSelector('#ecran [data-ecran="compte"]');
    await C.ui.fill('#ecran [name=nom]', 'Nour');
    await C.ui.fill('#ecran [name=email]', 'nour@exemple.yt');
    await C.ui.fill('#ecran [name=motdepasse]', 'la-mangrove-de-dzaoudzi-42');
    await C.ui.fill('#ecran [name=encore]', 'la-mangrove-de-dzaoudzi-42');
    await C.ui.click('#ecran button[type=submit]');
    await C.ui.waitForSelector('#ecran [data-ecran="sauvegarde"]');
    await C.ui.waitForSelector('#statut-odin >> text=Odin trouvé');
    await C.ui.click('#ecran button[type=submit]');
    const code = (await C.ui.waitForSelector('.code-accord', { timeout: 15_000 }).then((e) => e.textContent())).trim();
    assert.match(code, /^\d{6}$/);
    assert.deepEqual(await odin.cmd(`accord ${code} oui`), { ok: true });
    await attendre(async () => (await etat(C.ui)).ecran === 'navigateur', 20_000);
    await attendre(async () => (await etat(C.ui)).synchro.etat === 'ok', 20_000);
    assert.equal((await etat(C.ui)).profil.nom, 'Nour');
    // Nour a ses données à elle : rien de celles d'Awa.
    assert.equal((await favoris(C.ui)).length, 0);
  } finally {
    for (const x of [A, B, C, D]) await x?.fermer().catch(() => 0);
    await r.fermer(); await odin.fermer();
  }
});
