// Le dessinateur de QR codes d'Odin (src/valhalla/qr.ts), contre des valeurs connues de la norme (ISO 18004) :
// le code correcteur de l'exemple classique « HELLO WORLD » (version 1, niveau M), les 16 mots de format (niveaux L et M,
// 8 masques), les mots de version (7, 8, 10, 20), les capacités en octets, les motifs fixes. Puis un aller-retour par le
// lecteur d'Odin (src/valhalla/qr-lecture.ts, écrit à part), et le dessin remis à la page : des cases et leur marge
// blanche, rien d'autre. Aucun service extérieur : le QR code est dessiné par Odin. Textes d'essai inventés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dessin, encode, rsEncode, svg, traceSur } from '../src/valhalla/qr.ts';
import { lireMatriceQr } from '../src/valhalla/qr-lecture.ts';
import { dessinSur } from '../src/valhalla/gjoll/ajout.ts';

/** Une configuration d'essai, de la forme de celles du VPN (clés d'essai : des lettres répétées, aucune vraie clé). */
const CONF = `[Interface]\nPrivateKey = ${'A'.repeat(43)}=\nAddress = 10.8.0.2/32\nDNS = 10.0.0.2\n\n[Peer]\n# Maison (Odin)\nPublicKey = ${'B'.repeat(43)}=\nPresharedKey = ${'C'.repeat(43)}=\nEndpoint = 203.0.113.7:51820\nAllowedIPs = 0.0.0.0/0, ::/0\nPersistentKeepalive = 25\n`;

test('QR · code correcteur : l\'exemple connu « HELLO WORLD » (version 1, niveau M)', () => {
  const donnees = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(rsEncode(donnees, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('QR · les 16 mots de format de la norme (niveaux L et M, masques 0 à 7), écrits aux deux endroits', () => {
  const TABLE: Record<'L' | 'M', string[]> = {
    L: ['111011111000100', '111001011110011', '111110110101010', '111100010011101', '110011000101111', '110001100011000', '110110001000001', '110100101110110'],
    M: ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'],
  };
  for (const niveau of ['L', 'M'] as const) for (let masque = 0; masque < 8; masque++) {
    const g = encode('Odin', niveau, masque), n = g.length;
    let a = 0, b = 0;
    for (let i = 0; i < 15; i++) {
      // Copie 1 : autour du repère du haut à gauche ; copie 2 : sous le repère de droite et à côté de celui du bas.
      const un = i < 6 ? g[i][8] : i < 8 ? g[i + 1][8] : i < 9 ? g[8][7] : g[8][14 - i];
      const deux = i < 8 ? g[8][n - 1 - i] : g[n - 15 + i][8];
      if (un) a |= 1 << i; if (deux) b |= 1 << i;
    }
    assert.equal(a.toString(2).padStart(15, '0'), TABLE[niveau][masque], `${niveau}, masque ${masque}`);
    assert.equal(b, a, `${niveau}, masque ${masque} : les deux copies sont les mêmes`);
  }
});

test('QR · les mots de version de la norme (7, 8, 10, 20) et les capacités en octets', () => {
  const VERSION: Record<number, number> = { 7: 0x07c94, 8: 0x085bc, 10: 0x0a4d3, 20: 0x149a6 };
  // Octets au plus par version (mode octet, niveau L) : 7 → 154, 8 → 192, 10 → 271, 20 → 858.
  const PLEIN: Record<number, number> = { 7: 154, 8: 192, 10: 271, 20: 858 };
  for (const [v, attendu] of Object.entries(VERSION)) {
    const g = encode('x'.repeat(PLEIN[Number(v)]), 'L'), n = g.length;
    assert.equal(n, 17 + 4 * Number(v), `version ${v} : ${n} cases de côté`);
    let lu = 0, lu2 = 0;
    for (let i = 0; i < 18; i++) { if (g[Math.floor(i / 3)][n - 11 + (i % 3)]) lu |= 1 << i; if (g[n - 11 + (i % 3)][Math.floor(i / 3)]) lu2 |= 1 << i; }
    assert.equal(lu, attendu, `version ${v}`); assert.equal(lu2, attendu, `version ${v}, seconde copie`);
  }
  // Les seuils : 17 octets tiennent en version 1 (niveau L), 18 non ; 14 en niveau M, 15 non ; 858 octets au plus.
  assert.deepEqual([encode('a'.repeat(17), 'L').length, encode('a'.repeat(18), 'L').length, encode('a'.repeat(14), 'M').length, encode('a'.repeat(15), 'M').length], [21, 25, 21, 25]);
  assert.equal(encode('a'.repeat(858), 'L').length, 97);
  assert.throws(() => encode('a'.repeat(859), 'L'), /trop long/);
});

test('QR · les motifs fixes : trois repères, les lignes de synchronisation, la case sombre', () => {
  for (const texte of ['Odin', CONF]) {
    const g = encode(texte, 'L'), n = g.length;
    const repere = (r: number, c: number) => { for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) assert.equal(g[r + i][c + j], i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4), `repère ${r},${c} : case ${i},${j}`); };
    repere(0, 0); repere(0, n - 7); repere(n - 7, 0);
    // Le tour blanc de chaque repère.
    for (let i = 0; i < 8; i++) for (const [r, c] of [[7, i], [i, 7], [7, n - 1 - i], [i, n - 8], [n - 8, i], [n - 1 - i, 7]]) assert.equal(g[r][c], false);
    for (let i = 8; i < n - 8; i++) { assert.equal(g[6][i], i % 2 === 0); assert.equal(g[i][6], i % 2 === 0); }
    assert.equal(g[n - 8][8], true, 'la case sombre');
  }
});

test('QR · aller-retour par le lecteur d\'Odin : une configuration entière se relit telle quelle (niveaux L et M)', () => {
  for (const [texte, niveau] of [['Odin', 'M'], ['Maison · été 2026 · 日本', 'M'], [CONF, 'L'], [CONF, 'M'], [`${CONF}\n[Peer]\n# Portable (maillage)\nPublicKey = ${'D'.repeat(43)}=\nEndpoint = 198.51.100.23:51820\nAllowedIPs = 10.8.0.3/32\nPersistentKeepalive = 25\n`, 'L']] as Array<[string, 'L' | 'M']>) {
    const lu = lireMatriceQr(encode(texte, niveau));
    assert.equal(lu.lu, true, lu.lu ? '' : lu.raison);
    if (lu.lu) { assert.equal(lu.texte, texte); assert.equal(lu.niveau, niveau); }
  }
});

test('QR · le dessin remis à la page : des cases, une marge blanche de 4 cases, jamais le texte lui-même', () => {
  const g = encode(CONF, 'L'), q = dessin(CONF, { ecc: 'L' });
  assert.equal(q.marge, 4); assert.equal(q.n, g.length + 8);
  assert.equal(traceSur(q.d), true);
  // Chaque case sombre du code est dans le tracé, décalée de la marge, et rien d'autre.
  const cases = [...q.d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => `${m[1]},${m[2]}`), attendu: string[] = [];
  g.forEach((ligne, r) => ligne.forEach((on, c) => { if (on) attendu.push(`${c + 4},${r + 4}`); }));
  assert.deepEqual(cases, attendu);
  for (const c of cases) { const [x, y] = c.split(',').map(Number); assert.ok(x >= 4 && y >= 4 && x < q.n - 4 && y < q.n - 4, 'aucune case dans la marge blanche'); }
  // L'image : noir sur blanc, la marge comprise ; aucune clé ni aucun mot de la configuration n'y est recopié.
  const s = svg(CONF, { ecc: 'L', scale: 5 });
  assert.match(s, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+" width="\d+" height="\d+" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="\d+" height="\d+" fill="#fff"\/><path d="[Mhvz0-9 -]+" fill="#000"\/><\/svg>$/);
  for (const secret of ['A'.repeat(43), 'PrivateKey', 'Interface', '203.0.113.7', '<script', 'onload', 'href']) assert.equal(s.includes(secret), false, secret);
  assert.equal(svg('Odin', { margin: 2 }).includes('viewBox="0 0 25 25"'), true, 'la marge demandée par les autres applis est gardée');
  // Ce que la page refuse : tout tracé qui n'est pas fait que de cases.
  for (const faux of ['M1 1h1v1h-1z<script>', 'M1 1L9 9z', 'M1 1h1v1h-1zM', ' M1 1h1v1h-1z', 'M1111 1h1v1h-1z', 12, null, undefined, { d: 'M1 1h1v1h-1z' }]) assert.equal(traceSur(faux), false, String(faux));
  assert.equal(traceSur(''), true);
  // Une configuration trop longue pour un QR code : pas de dessin (la page propose le fichier).
  assert.equal(dessinSur('x'.repeat(900)), undefined);
  assert.equal(dessinSur(CONF)?.n, q.n);
});
