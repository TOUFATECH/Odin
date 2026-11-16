// L'écran de télécommande (src/web/pages/venus-telecommande.js), ouvert par /t/<jeton> : il ne montre QUE la
// télécommande d'UN seul écran, tous les boutons demandés sont là, le pilotage est continu (on enchaîne les commandes),
// et depuis la page /t/ (invité) rien d'autre d'Odin n'est joignable — seules les routes du jeton sont appelées.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../src/web/pages/venus-telecommande.js', import.meta.url), 'utf8');

interface Bouton { cle: string; label: string; action: string; valeur?: unknown; bascule?: string; confirme?: boolean; demande?: string }
interface TC {
  boutons: () => Bouton[];
  commande: (cible: { jeton?: string; ecranId?: string }, action: string, valeur?: unknown) => { url: string; body: Record<string, unknown> };
  monter: unknown; afficherQr: unknown;
  logique: { jetonDeChemin: (c: string) => string | null; qrUrl: (id: string, q?: string) => string; resteTexte: (e: number, m?: number) => string; boutons: () => Bouton[] };
}

function charger(): TC {
  const win: { OdinVenusTelecommande?: TC; OdinPages?: unknown } = {};
  vm.runInNewContext(SRC, { window: win }); // ni document ni location : la page ne se monte pas toute seule ici
  assert.ok(win.OdinVenusTelecommande, 'window.OdinVenusTelecommande est posé');
  assert.equal(win.OdinPages, undefined, 'la télécommande ne s\'inscrit pas dans OdinPages');
  return win.OdinVenusTelecommande;
}

// La liste exacte d'actions permises par le contrat du serveur (lot A).
const ENUM = ['lecture', 'pause', 'avancer', 'reculer', 'volume', 'suivant', 'precedent', 'chaine', 'episode', 'couper'];

test('tous les boutons demandés sont là, et chaque action reste dans la liste du contrat', () => {
  const b = charger().boutons();
  const parCle = Object.fromEntries(b.map((x) => [x.cle, x]));
  for (const cle of ['reculer', 'lecture_pause', 'avancer', 'precedent', 'revoir', 'suivant', 'chaine_moins', 'chaine_plus', 'episode', 'volume_moins', 'volume_plus', 'couper']) assert.ok(parCle[cle], `bouton ${cle}`);
  assert.equal(parCle.lecture_pause.action, 'lecture');
  assert.equal(parCle.lecture_pause.bascule, 'pause', 'lecture/pause bascule entre les deux');
  assert.equal(parCle.couper.confirme, true, 'couper demande confirmation');
  assert.equal(parCle.episode.demande, 'episode', 'épisode demande un numéro');
  for (const x of b) assert.ok(ENUM.includes(x.action) || (x.bascule && ENUM.includes(x.bascule)), `action ${x.action} dans le contrat`);
});

test('pilotage par jeton (invité) : la commande vise UNIQUEMENT la route courte du jeton, rien d\'autre d\'Odin', () => {
  const tc = charger();
  const r = tc.commande({ jeton: 'JETONabcd1234' }, 'volume', '+');
  assert.equal(r.url, '/venus/commande/JETONabcd1234');
  assert.deepEqual({ ...r.body }, { action: 'volume', valeur: '+' });
  // Côté propriétaire (page de Vénus, avec l'id de l'écran) : la route /venus/ecran/<id>.
  assert.equal(tc.commande({ ecranId: 'salon' }, 'pause').url, '/venus/ecran/salon/commande');
  assert.deepEqual({ ...tc.commande({ ecranId: 'salon' }, 'pause').body }, { action: 'pause' });
  assert.equal(tc.logique.qrUrl('salon', 'revoquer'), '/venus/ecran/salon/qr/revoquer');
  assert.equal(tc.logique.qrUrl('salon'), '/venus/ecran/salon/qr');
});

test('pilotage continu : la même commande peut s\'enchaîner, toujours vers la même route, sans blocage', () => {
  const tc = charger();
  const cible = { jeton: 'x9y8z7w6v5u4' };
  const envois = [tc.commande(cible, 'avancer', 10), tc.commande(cible, 'avancer', 10), tc.commande(cible, 'lecture'), tc.commande(cible, 'pause')];
  for (const e of envois) assert.match(e.url, /^\/venus\/commande\/x9y8z7w6v5u4$/);
  assert.deepEqual(envois[0], envois[1], 'une commande répétée donne exactement le même appel');
  // Aucun bouton ne se désactive après un appui : le retour visuel est une classe passagère, pas un blocage.
  assert.doesNotMatch(SRC, /\.disabled\s*=\s*true/, 'les touches ne se bloquent jamais');
  assert.match(SRC, /tc-flash/, 'retour visuel passager');
  assert.match(SRC, /pilotage/i, 'le pilotage continu est assumé dans le code');
});

test('QR : temps restant lisible, et révoquer / régénérer s\'appuient sur l\'identifiant du jeton', () => {
  const { resteTexte } = charger().logique;
  assert.equal(resteTexte(1000, 61 * 60 * 1000 + 1000), 'expiré');
  assert.equal(resteTexte(45 * 60 * 1000, 0), '45 min');
  assert.match(resteTexte(90 * 60 * 1000, 0), /^1 h 30$/);
  // La page garde l'identifiant renvoyé à la création et l'envoie pour révoquer / régénérer.
  assert.match(SRC, /idJeton = q\.id \|\| idJeton/);
  assert.match(SRC, /quoi && idJeton \? \{ id: idJeton \} : \{\}/);
});

test('jeton de l\'adresse : seuls des jetons sûrs sont acceptés, sinon rien', () => {
  const { jetonDeChemin } = charger().logique;
  assert.equal(jetonDeChemin('/t/abcd1234efgh'), 'abcd1234efgh');
  assert.equal(jetonDeChemin('/t/abcd1234efgh/'), 'abcd1234efgh');
  assert.equal(jetonDeChemin('/'), null);
  assert.equal(jetonDeChemin('/t/court'), null, 'un jeton trop court est refusé');
  assert.equal(jetonDeChemin('/t/mauvais jeton!'), null, 'des caractères douteux sont refusés');
  assert.equal(jetonDeChemin('/venus/ecrans'), null);
});

test('la page /t/ ne montre que la télécommande : elle n\'ouvre aucune autre partie d\'Odin', () => {
  // Montée autonome dans #odin-tc (ou le corps) avec le seul jeton, jamais l'app complète.
  assert.match(SRC, /getElementById\('odin-tc'\)/);
  assert.match(SRC, /function auto\(\)/);
  // Rien qui ouvre une autre appli, la discussion, ou qui appelle une action de module.
  assert.doesNotMatch(SRC, /OdinShow|openApp|OdinOpenWant|\/api\/valhalla/, 'la télécommande ne touche à rien d\'autre d\'Odin');
  // L'invité (jeton) n'appelle que des routes du jeton ; les routes /venus/ecran ne servent qu'au propriétaire (id d\'écran).
  for (const m of SRC.matchAll(/https?:\/\/[^\s'"`]*/g)) assert.equal(m[0], 'http://www.w3.org/2000/svg', `adresse extérieure ${m[0]}`);
  assert.doesNotMatch(SRC, /localStorage|sessionStorage|indexedDB/i);
});

test('taille au doigt et téléphone : cadre à 390 px, cibles larges, confirmation sans fenêtre native', () => {
  assert.match(SRC, /max-width:390px/, 'colonne à 390 px (téléphone)');
  assert.match(SRC, /min-height:66px/, 'boutons grands au doigt');
  assert.match(SRC, /pointer:coarse/);
  // « Couper » : OdinDialog si présent (page de Vénus), sinon la confirmation intégrée (page /t/ sans OdinDialog).
  assert.match(SRC, /window\.OdinDialog \? window\.OdinDialog\.confirm/);
  assert.match(SRC, /function confirmer\(/);
  assert.doesNotMatch(SRC, /(?<!OdinDialog\.)\b(alert|confirm|prompt)\(/, 'aucune fenêtre native');
});
