// Export de la page d'une appli : Markdown, JSON, Word (.docx) et PDF.
// Chaque format est relu pour de vrai : le Markdown est comparé au texte attendu, le JSON est relu, le .docx est
// ouvert (archive, XML, texte, tableaux), le PDF est relu par pdftotext et vérifié par qpdf quand ils sont installés
// (sinon par le lecteur intégré d'Odin). Puis sur un vrai Odin, par l'interface web, sur des applis de genres différents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T, has } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';
import { readDocx } from '../src/files/office.ts';
import { extractPdfText } from '../src/files/pdf.ts';
import { unzip } from '../src/files/zip.ts';
import { isSecretFile } from '../src/heimdall/policy.ts';
import { Redactor } from '../src/heimdall/redact.ts';
import { enDocx } from '../src/valhalla/export/docx.ts';
import { FORMATS, GOOGLE_ABSENT, fichier, nomDuFichier } from '../src/valhalla/export/fichier.ts';
import { enJson, enMarkdown } from '../src/valhalla/export/markdown.ts';
import { MASQUE, creerMasqueur, ressembleASecret } from '../src/valhalla/export/masque.ts';
import { MAX_LIGNES, pageDepuisVue, refusDe, type PageExport } from '../src/valhalla/export/page.ts';
import { enPdf, latin } from '../src/valhalla/export/pdf.ts';
import { publicKey } from '../src/valhalla/modules/frigg.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';
import type { View } from '../src/valhalla/types.ts';

const APPLI = { id: 'essai', name: 'Essai', family: 'Machines' as const, what: 'Une appli d\'essai.' };
const QUAND = new Date(2026, 10, 13, 21, 5);
/** Une page avec tous les genres de sections, des boutons, un formulaire, une icône, des couleurs, et de quoi piéger chaque format. */
const VUE: View = {
  subtitle: '2 machines · tout va bien',
  kpis: [{ label: 'Machines', value: '2', tone: 'bon' }, { label: 'Disque', value: '91 %', pct: 91, tone: 'attention' }, { label: 'Pannes', value: '1', tone: 'mauvais' }],
  sections: [
    { kind: 'table', title: 'Machines', columns: ['Nom', 'État', 'Note'], rows: [{ cells: ['NAS', 'en ligne', 'a|b *gras* <b>x</b>'], actions: [{ action: 'x', label: 'Redémarrer', input: {} }] }, { cells: ['PC de Awa', 'éteint', 'ligne 1\nligne 2'], tone: 'mauvais' }] },
    { kind: 'list', title: 'À savoir', items: [{ title: 'Certificat', detail: 'expire dans 12 jours', meta: 'odin.exemple.fr', tone: 'attention' }, { title: 'Mises à jour' }] },
    { kind: 'cards', title: 'Conteneurs', items: [{ icon: 'data:image/png;base64,AAAA', title: 'web', sub: 'nginx', badge: 'en marche', meta: 'depuis 3 j', progress: 0.42, tone: 'bon', actions: [{ action: 'stop', label: 'Arrêter', input: {} }] }] },
    { kind: 'log', title: 'Journal', lines: ['21:05 ok', '21:06 ``` piège'] },
    { kind: 'text', title: 'Conseil', text: '# pas un titre\nDeuxième ligne.\n\nAutre paragraphe.' },
    { kind: 'bars', title: 'Place', items: [{ label: 'Photos', value: 420, display: '420 Go' }, { label: 'Autres', value: 1.5 }] },
    { kind: 'courbe', title: 'Débit', labels: ['21:00', '21:01'], series: [{ name: 'Reçu', points: [1, 2.5] }, { name: 'Envoyé', points: [0, 4] }], unit: 'Mb/s' },
    { kind: 'steps', title: 'Mise en route', items: [{ title: 'Brancher', detail: 'Port USB.', done: true }, { title: 'Choisir', done: false, action: 'x', button: 'Choisir' }] },
    { kind: 'graph', title: 'Carte', nodes: [{ id: 'o', label: 'Odin', color: '#fff', size: 12 }, { id: 'n', label: 'NAS', sub: '192.168.1.20' }], edges: [{ a: 'o', b: 'n', color: '#000' }], details: { n: { kind: 'Machine', title: 'NAS', rows: [{ k: 'Adresse', v: '192.168.1.20' }], actions: [{ action: 'x', label: 'Voir', input: {} }] } } },
    { kind: 'table', title: 'Vide', columns: ['A'], rows: [], empty: 'Rien encore.' },
    { kind: 'form', title: 'Ajouter', action: 'ajouter', params: [{ key: 'mdp', label: 'Mot de passe', kind: 'password' }], submit: 'Ajouter' },
  ],
  side: [{ kind: 'text', title: 'Page publique', text: 'Réserve sur /r/AbCdEfGhIjKlMnOp sans compte.' }],
};
const page = (vue: View = VUE, o: { onglet?: string; connus?: (t: string) => string } = {}): PageExport => { const p = pageDepuisVue(APPLI, vue, { quand: QUAND, ...o }); if ('erreur' in p) throw new Error(p.erreur); return p; };

const MARKDOWN = `# Essai

Une appli d'essai.

_Page Essai d'Odin, prise le 13/11/2026 à 21:05_

> 2 machines · tout va bien

## Chiffres clés

- **Machines** : 2
- ⚠ **Disque** : 91 %
- ⛔ **Pannes** : 1

## Machines

| Nom | État | Note |
| --- | --- | --- |
| NAS | en ligne | a\\|b \\*gras\\* \\<b\\>x\\</b\\> |
| ⛔ PC de Awa | éteint | ligne 1<br>ligne 2 |

## À savoir

- ⚠ **Certificat** — expire dans 12 jours _(odin.exemple.fr)_
- **Mises à jour**

## Conteneurs

- **web** — nginx — en marche — depuis 3 j — 42 %

## Journal

\`\`\`\`text
21:05 ok
21:06 \`\`\` piège
\`\`\`\`

## Conseil

\\# pas un titre{2}
Deuxième ligne.

Autre paragraphe.

## Place

| Nom | Valeur |
| --- | --- |
| Photos | 420 Go |
| Autres | 1,5 |

## Débit

|  | Reçu (Mb/s) | Envoyé (Mb/s) |
| --- | --- | --- |
| 21:00 | 1 | 0 |
| 21:01 | 2,5 | 4 |

## Mise en route

1. [x] **Brancher** — Port USB.
2. [ ] **Choisir**

## Carte

_2 points, 1 lien_

| Point | Détail | Fiche | Relié à |
| --- | --- | --- | --- |
| Odin |  |  | NAS |
| NAS | 192.168.1.20 | Adresse : 192.168.1.20 | Odin |

## Vide

_Rien encore._

## Page publique

Réserve sur /r/••• sans compte.

---

_1 valeur masquée par sécurité (elle apparaît comme « ••• »)._
`.replace('{2}', '  ');   // deux espaces en fin de ligne : un retour à la ligne en Markdown

/** Un XML bien formé ? (balises qui s'ouvrent et se ferment dans l'ordre ; avec xmllint en plus quand il est installé) */
function xmlBienForme(xml: string): string | undefined {
  if (!xml.startsWith('<?xml')) return 'pas d\'en-tête XML';
  const pile: string[] = [];
  for (const m of xml.replace(/^<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|<|>/g)) {
    if (!m[2]) return `signe « ${m[0]} » non échappé vers ${m.index}`;
    if (m[1]) { if (pile.pop() !== m[2]) return `balise </${m[2]}> mal fermée`; } else if (!m[4]) pile.push(m[2]);
  }
  return pile.length ? `balise <${pile.at(-1)}> jamais fermée` : undefined;
}
const outil = (cmd: string, args: string[], entree?: Buffer) => spawnSync(cmd, args, { input: entree, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });
/** Ouvre un .docx : archive lisible, parties attendues, XML bien formé ; rend son texte et le XML du document. */
async function ouvrirDocx(buf: Buffer, dir: string): Promise<{ texte: string; xml: string; tableaux: number }> {
  assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK', 'un .docx est une archive ZIP');
  const parties = unzip(buf);
  for (const p of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels', 'word/footer1.xml', 'docProps/core.xml']) assert.ok(parties.has(p), `partie ${p} présente`);
  const f = join(dir, `doc-${Math.random().toString(36).slice(2)}.docx`); writeFileSync(f, buf);
  for (const [nom, data] of parties) {
    assert.equal(xmlBienForme(data.toString('utf8')), undefined, `${nom} : XML bien formé`);
    if (await has('xmllint')) { const r = outil('xmllint', ['--noout', '-'], data); assert.equal(r.status, 0, `${nom} : xmllint → ${r.stderr}`); }
  }
  if (await has('unzip')) assert.equal(outil('unzip', ['-tq', f]).status, 0, 'archive vérifiée par unzip');
  const xml = parties.get('word/document.xml')!.toString('utf8');
  return { texte: readDocx(buf), xml, tableaux: (xml.match(/<w:tbl>/g) ?? []).length };
}
/** Relit un PDF : en-tête, fin, structure (qpdf), nombre de pages, texte (pdftotext, sinon le lecteur intégré). */
async function ouvrirPdf(buf: Buffer, dir: string): Promise<{ texte: string; pages: number; via: string }> {
  assert.equal(buf.subarray(0, 8).toString('latin1'), '%PDF-1.4', 'en-tête PDF');
  assert.match(buf.subarray(-32).toString('latin1'), /startxref\n\d+\n%%EOF\n$/, 'fin de fichier PDF');
  const brut = buf.toString('latin1'), xref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(brut)![1]);
  assert.equal(brut.slice(xref, xref + 4), 'xref', 'la table des objets est là où la fin du fichier le dit');
  for (const m of brut.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)) assert.match(brut.slice(Number(m[1]), Number(m[1]) + 12), /^\d+ 0 obj\n/, 'chaque objet est à l\'endroit annoncé');
  const pages = (brut.match(/\/Type \/Page\b(?!s)/g) ?? []).length;
  const f = join(dir, `doc-${Math.random().toString(36).slice(2)}.pdf`); writeFileSync(f, buf);
  if (await has('qpdf')) { const r = outil('qpdf', ['--check', f]); assert.equal(r.status, 0, `qpdf --check : ${r.stdout}${r.stderr}`); assert.match(r.stdout, /No syntax or stream encoding errors found/); }
  if (await has('pdfinfo')) assert.match(outil('pdfinfo', [f]).stdout, new RegExp(`Pages:\\s+${pages}\\b`), 'pdfinfo compte les mêmes pages');
  if (await has('pdftotext')) { const r = outil('pdftotext', ['-layout', '-enc', 'UTF-8', f, '-']); assert.equal(r.status, 0, r.stderr); return { texte: r.stdout, pages, via: 'pdftotext' }; }
  return { texte: extractPdfText(buf), pages, via: 'lecteur intégré' };
}
const sansEspaces = (t: string) => t.replace(/\s+/g, ' ');

test('masquage : les formes connues de secrets sont masquées, le texte ordinaire reste lisible (pur)', () => {
  const coffre = new Redactor(['un-secret-du-coffre-1234']), k = creerMasqueur((t) => coffre.redact(t));
  const cas: Array<[string, string]> = [
    ['Tes clients réservent sur /r/AbCdEfGhIjKlMnOp — sans compte.', 'Tes clients réservent sur /r/••• — sans compte.'],
    ['https://odin.exemple.fr/etat/0123456789abcdef01', 'https://odin.exemple.fr/etat/•••'],
    ['http://192.168.1.2:8787/partage/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'http://192.168.1.2:8787/partage/•••'],
    ['rtsp://admin:S3cret!@192.168.1.50:554/flux', 'rtsp://admin:•••@192.168.1.50:554/flux'],
    ['mysql -uroot -pS3cretPass base', 'mysql -uroot -p••• base'],
    ['/usr/bin/prog --password hunter2 --port 8080', '/usr/bin/prog --password ••• --port 8080'],
    ['sshpass -p hunter22 ssh root@nas', 'sshpass -p ••• ssh root@nas'],
    ['MQTT_PASSWORD=azerty123 lancé', 'MQTT_PASSWORD=••• lancé'],
    ['Mot de passe : Soleil2026! puis le reste', 'Mot de passe : ••• puis le reste'],
    ['PrivateKey = aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gdw==', 'PrivateKey = •••'],
    ['WIFI:T:WPA;S:Maison;P:motdepassewifi;;', 'WIFI:T:WPA;S:Maison;P:•••;;'],
    ['Code PIN : 4821', 'Code PIN : •••'],
    ['Authorization: Basic dXNlcjpwYXNzd29yZA==', 'Authorization: Basic •••'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123', '•••'],
    ['un-secret-du-coffre-1234 est là', '••• est là'],
    ['clé sk-ant-abcdefghijklmnopqrstuvwxyz', 'clé •••'],
    // Ce qui n'est pas un secret reste lisible.
    ['mot de passe : choisis-en un toi-même', 'mot de passe : choisis-en un toi-même'],
    ['Mot de passe : 10 caractères au moins', 'Mot de passe : 10 caractères au moins'],
    ['Mot de passe changé le : 10/11/2026', 'Mot de passe changé le : 10/11/2026'],
    ['Basic authentication requise', 'Basic authentication requise'],
    ['/home/awa/p/abcdefghijklmnop/fichier.txt', '/home/awa/p/abcdefghijklmnop/fichier.txt'],
    ['sshd: Failed password for root from 203.0.113.9 port 22', 'sshd: Failed password for root from 203.0.113.9 port 22'],
    ['empreinte 3f786850e387550fdab836ed7e6dc881de23001b', 'empreinte 3f786850e387550fdab836ed7e6dc881de23001b'],
  ];
  for (const [entree, attendu] of cas) assert.equal(k.texte(entree), attendu, entree);
  assert.equal(k.n(), 16, 'chaque valeur masquée est comptée');
  // Sous un intitulé sensible (colonne « Mot de passe », ligne « Jeton »…) : la valeur est masquée, sauf si elle dit un état.
  const sous: Array<[string, string, string]> = [
    ['Jeton', 'présent', 'présent'], ['Jeton', 'ghp_abc', MASQUE], ['Mot de passe', 'oui', 'oui'], ['Mot de passe', 'soleil', MASQUE], ['Mot de passe', '—', '—'], ['Mot de passe', 'dans le coffre', 'dans le coffre'],
    ['Clé', 'dans le coffre', 'dans le coffre'], ['Clé', 'ABCDE-12345-FGHIJ', MASQUE], ['Clé', 'HKLM\\Software\\Odin', 'HKLM\\Software\\Odin'],
    ['Jetons', '12 345', '12 345'], ['Tokens', '1.2k', '1.2k'], ['Avec 2FA', '4', '4'], ['Code PIN', '4821', MASQUE],
    ['Mot de passe de la box', 'celui que tu donnes, jamais aB3$xyz9', `celui que tu donnes, jamais ${MASQUE}`], ['Nom', 'Soleil2026!', 'Soleil2026!'],
  ];
  for (const [cle, valeur, attendu] of sous) assert.equal(k.sous(cle, valeur), attendu, `${cle} | ${valeur}`);
  assert.deepEqual(['Bonjour', 'choisis-en', 'commandes', '192.168.1.10', '10/11/2026'].filter((x) => ressembleASecret(x)), []);
  assert.deepEqual(['hunter2', 'Soleil2026!', 'aGVsbG8gd29ybGQ='].filter((x) => !ressembleASecret(x)), []);
});

test('la page propre : données gardées, boutons, formulaires, icônes et couleurs retirés, secrets masqués, onglets (pur)', () => {
  const p = page();
  assert.deepEqual(p.app, APPLI); assert.equal(p.at, QUAND.toISOString()); assert.equal(p.subtitle, '2 machines · tout va bien');
  assert.deepEqual(p.kpis, [{ label: 'Machines', value: '2', tone: 'bon' }, { label: 'Disque', value: '91 %', pct: 91, tone: 'attention' }, { label: 'Pannes', value: '1', tone: 'mauvais' }]);
  assert.deepEqual(p.sections.map((s) => s.kind), ['table', 'list', 'cards', 'log', 'text', 'bars', 'courbe', 'steps', 'graph', 'table', 'text'], 'le formulaire n\'est pas une donnée ; la colonne de droite suit');
  // Rien de ce qui sert à agir ou à dessiner : ni bouton, ni action, ni icône, ni couleur, ni taille.
  const cles = new Set<string>(); const voir = (v: unknown): void => { if (Array.isArray(v)) v.forEach(voir); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { cles.add(k); voir(x); } }; voir(p);
  for (const interdit of ['actions', 'action', 'input', 'icon', 'color', 'size', 'button', 'params', 'submit', 'ring', 'square', 'dash']) assert.ok(!cles.has(interdit), `pas de « ${interdit} » dans la page propre`);
  assert.equal(p.masques, 1); assert.equal((p.sections.at(-1) as { text: string }).text, 'Réserve sur /r/••• sans compte.');
  assert.deepEqual(p.retire, []);
  // Les textes sont nettoyés : pas de caractère de commande, fins de ligne simples.
  const sale = page({ sections: [{ kind: 'text', title: 'T\u0000itre', text: 'a\u0007b\r\nc\u001b[0m' }] });
  assert.deepEqual(sale.sections[0], { kind: 'text', title: 'Titre', text: 'ab\nc[0m' });
  // Les secrets connus d'Odin et les intitulés sensibles.
  const coffre = new Redactor(['Mdp-du-coffre-4821!']);
  const s = page({ kpis: [{ label: 'Jeton', value: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' }], sections: [{ kind: 'table', title: 'Comptes', columns: ['Service', 'Mot de passe', 'État'], rows: [{ cells: ['box', 'azerty!42', 'ok'] }, { cells: ['nas', 'Mdp-du-coffre-4821!', 'ok'] }, { cells: ['mail', 'oui', 'Mdp-du-coffre-4821! vu'] }] }, { kind: 'graph', title: 'G', nodes: [{ id: 'a', label: 'A' }], edges: [], details: { a: { kind: 'K', title: 'A', rows: [{ k: 'Mot de passe', v: 'azerty!42' }, { k: 'Adresse', v: '192.168.1.2' }] } } }] }, { connus: (t) => coffre.redact(t) });
  assert.equal(JSON.stringify(s).includes('azerty!42') || JSON.stringify(s).includes('Mdp-du-coffre') || JSON.stringify(s).includes('ghp_'), false, 'aucun secret dans la page propre');
  assert.deepEqual((s.sections[0] as { rows: Array<{ cells: string[] }> }).rows.map((r) => r.cells), [['box', MASQUE, 'ok'], ['nas', MASQUE, 'ok'], ['mail', 'oui', `${MASQUE} vu`]]);
  assert.equal(s.masques, 5);
  // Onglets : une section sans onglet va dans le premier ; un seul onglet peut être gardé ; un onglet inconnu est refusé clairement.
  const og: View = { onglets: ['Suivre', 'Réglages'], kpis: [{ label: 'K', value: '1' }], sections: [{ kind: 'text', title: 'B', text: 'b', onglet: 'Réglages' }, { kind: 'text', title: 'A', text: 'a' }, { kind: 'form', title: 'F', action: 'f', params: [], submit: 'F', onglet: 'Réglages' }], side: [{ kind: 'text', title: 'C', text: 'c', onglet: 'Réglages' }] };
  assert.deepEqual(page(og).sections.map((x) => [x.title, x.onglet]), [['A', 'Suivre'], ['B', 'Réglages'], ['C', 'Réglages']]);
  const un = page(og, { onglet: 'réglages' }); assert.equal(un.onglet, 'Réglages'); assert.deepEqual(un.sections.map((x) => x.title), ['B', 'C']); assert.equal(un.kpis.length, 1, 'les chiffres clés restent');
  assert.deepEqual(pageDepuisVue(APPLI, og, { quand: QUAND, onglet: 'Nimporte' }), { erreur: 'Essai n\'a pas d\'onglet « Nimporte ». Ses onglets : Suivre, Réglages.' });
  assert.deepEqual(pageDepuisVue(APPLI, VUE, { quand: QUAND, onglet: 'Suivre' }), { erreur: 'La page de Essai n\'a pas d\'onglets : prends-la en entier.' });
  assert.match(enMarkdown(page(og)), /\n## Suivre\n\n### A\n\na\n\n## Réglages\n\n### B\n\nb\n\n### C\n\nc\n/);
  assert.equal(nomDuFichier(un, 'pdf'), 'Essai - Réglages - 2026-11-13.pdf'); assert.equal(nomDuFichier(page(), 'docx'), 'Essai - 2026-11-13.docx');
  // Un tableau énorme est coupé, et la copie le dit.
  const gros = page({ sections: [{ kind: 'table', title: 'Gros', columns: ['N'], rows: Array.from({ length: MAX_LIGNES + 5 }, (_v, i) => ({ cells: [String(i)] })) }] });
  assert.equal((gros.sections[0] as { rows: unknown[] }).rows.length, MAX_LIGNES); assert.match(gros.retire[0].why, /coupé à 10[\s\u202f\u00a0]000 lignes/);
});

test('Markdown : le texte attendu, au caractère près ; JSON : relu, fidèle à la page propre (pur)', () => {
  assert.equal(enMarkdown(page()), MARKDOWN);
  const relu = JSON.parse(enJson(page())) as PageExport;
  assert.deepEqual(relu, page()); assert.equal(relu.odin, 1);
  assert.deepEqual(relu.sections[0], { kind: 'table', title: 'Machines', columns: ['Nom', 'État', 'Note'], rows: [{ cells: ['NAS', 'en ligne', 'a|b *gras* <b>x</b>'] }, { cells: ['PC de Awa', 'éteint', 'ligne 1\nligne 2'], tone: 'mauvais' }] });
  assert.deepEqual(relu.sections[2], { kind: 'cards', title: 'Conteneurs', items: [{ title: 'web', sub: 'nginx', badge: 'en marche', meta: 'depuis 3 j', progress: 0.42, tone: 'bon' }] });
  assert.deepEqual(relu.sections[8], { kind: 'graph', title: 'Carte', nodes: [{ id: 'o', label: 'Odin' }, { id: 'n', label: 'NAS', sub: '192.168.1.20' }], edges: [{ a: 'o', b: 'n' }], details: { n: { kind: 'Machine', title: 'NAS', rows: [{ k: 'Adresse', v: '192.168.1.20' }] } } });
});

test('Word (.docx) : archive et XML valides, texte et tableaux retrouvés, lu aussi par pandoc quand il est installé', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'odin-export-'));
  try {
    const buf = enDocx(page()), d = await ouvrirDocx(buf, dir);
    for (const attendu of ['Essai', 'Une appli d\'essai.', 'Page Essai d\'Odin, prise le 13/11/2026 à 21:05', '2 machines · tout va bien', 'Chiffres clés', 'Machines', 'PC de Awa', 'a|b *gras* <b>x</b>', 'Certificat — expire dans 12 jours (odin.exemple.fr)', 'web — nginx — en marche — depuis 3 j — 42 %', '21:06 ``` piège', 'Deuxième ligne.', '420 Go', 'Reçu (Mb/s)', 'Brancher — Port USB.  (fait)', 'Choisir  (à faire)', '2 points, 1 lien', 'Rien encore.', 'Réserve sur /r/••• sans compte.', '1 valeur masquée par sécurité'])
      assert.ok(d.texte.includes(attendu), `texte retrouvé dans le .docx : « ${attendu} »\n${d.texte.slice(0, 400)}`);
    assert.equal(d.tableaux, 5, 'chiffres clés, Machines, Place, Débit et Carte sont de vrais tableaux Word');
    assert.equal((d.xml.match(/<w:tblHeader\/>/g) ?? []).length, 4, 'la ligne d\'en-tête de chaque tableau se répète en haut de chaque page');
    assert.match(d.xml, /<w:color w:val="B42318"\/>[^<]*<w:sz[^>]*\/><w:szCs[^>]*\/><\/w:rPr><w:t xml:space="preserve">PC de Awa/, 'la ligne en panne est écrite en rouge');
    assert.ok(!/Redémarrer|Arrêter|Ajouter|data:image/.test(d.xml), 'ni bouton, ni formulaire, ni icône dans le document');
    if (await has('pandoc')) {
      const f = join(dir, 'essai.docx'); writeFileSync(f, buf);
      const r = outil('pandoc', ['-f', 'docx', '-t', 'json', f]); assert.equal(r.status, 0, r.stderr);
      assert.equal((r.stdout.match(/"t":"Table"/g) ?? []).length, 5, 'pandoc relit cinq vrais tableaux'); assert.equal((r.stdout.match(/"t":"Header"/g) ?? []).length, 12, 'et les titres de section comme des titres');
      const lu = outil('pandoc', ['-f', 'docx', '-t', 'plain', '--wrap=none', f]).stdout; assert.match(lu, /PC de Awa/); assert.match(lu, /Certificat — expire dans 12 jours \(odin\.exemple\.fr\)/);
    }
    // Des données piégées ne cassent pas le XML : signes, demi-caractère, caractères de commande, émojis.
    const piege = page({ sections: [{ kind: 'table', title: 'Piège <&> "\'', columns: ['A & B', '<C>'], rows: [{ cells: ['</w:t><w:t>x', ']]> & \ud83d\ude00 \ud800 fin'] }] }, { kind: 'log', title: 'J', lines: ['a\u0001b', '<script>alert(1)</script>'] }] });
    const d2 = await ouvrirDocx(enDocx(piege), dir);
    assert.ok(d2.texte.includes('</w:t><w:t>x') && d2.texte.includes('<script>alert(1)</script>') && d2.texte.includes('😀'), 'le texte piégé est écrit tel quel, comme du texte');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('PDF : structure valide (qpdf), texte relu (pdftotext), pages, en-tête de tableau répété, accents et signes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'odin-export-'));
  try {
    const d = await ouvrirPdf(enPdf(page()), dir), texte = sansEspaces(d.texte);
    for (const attendu of ['Essai', 'Une appli d\'essai.', 'Page Essai d\'Odin, prise le 13/11/2026 à 21:05', '2 machines · tout va bien', 'Chiffres clés', 'PC de Awa', 'éteint', 'a|b *gras* <b>x</b>', 'Certificat — expire dans 12 jours (odin.exemple.fr)', 'web — nginx — en marche — depuis 3 j — 42 %', '21:06 ``` piège', 'Deuxième ligne.', '420 Go', 'Brancher — Port USB. (fait)', 'Choisir (à faire)', '2 points, 1 lien', 'Rien encore.', 'Réserve sur /r/••• sans compte.', '1 valeur masquée par sécurité'])
      assert.ok(texte.includes(attendu), `texte retrouvé dans le PDF (${d.via}) : « ${attendu} »\n${texte.slice(0, 600)}`);
    assert.equal(d.pages, 2); assert.match(texte, /1 ?\/ ?2/); assert.match(texte, /2 ?\/ ?2/);
    assert.ok(!/Redémarrer|Arrêter|Ajouter/.test(texte), 'ni bouton ni formulaire dans le PDF');
    // Un long tableau passe sur plusieurs pages, avec son en-tête répété et les pages numérotées.
    const long = page({ sections: [{ kind: 'table', title: 'Capteurs', columns: ['Capteur', 'Adresse', 'Remarque'], rows: Array.from({ length: 140 }, (_v, i) => ({ cells: [`Capteur ${i + 1}`, `192.168.1.${i + 1}`, i % 9 ? '' : 'Un texte assez long pour passer à la ligne dans sa colonne, sans déborder sur la voisine ni sortir de la page.'] })) }] });
    const dl = await ouvrirPdf(enPdf(long), dir), tl = sansEspaces(dl.texte);
    assert.ok(dl.pages >= 3, `${dl.pages} pages`);
    assert.equal((tl.match(/Capteur Adresse Remarque/g) ?? []).length, dl.pages, 'l\'en-tête du tableau est répété sur chaque page');
    assert.ok(tl.includes('Capteur 1 192.168.1.1') && tl.includes('Capteur 140 192.168.1.140') && new RegExp(`${dl.pages} ?/ ?${dl.pages}`).test(tl));
    // Accents, guillemets, euro : écrits tels quels. Flèches, coches et ronds de couleur : dessinés (pas de « ? » à leur place).
    const signes = page({ sections: [{ kind: 'text', title: 'Été à Mayotte', text: 'Reçu « ça » : 12 € — l’œuvre… 🟢 en ligne ✅ → fait ↑ 3 Mb/s' }, { kind: 'log', title: 'J', lines: ['cron → ok ✅'] }] });
    const ds = await ouvrirPdf(enPdf(signes), dir), ts = sansEspaces(ds.texte);
    assert.ok(ts.includes('Été à Mayotte') && ts.includes('Reçu « ça » : 12 € — l’œuvre…') && ts.includes('en ligne') && ts.includes('3 Mb/s'), ts);
    assert.ok(!ts.includes('?'), 'aucun caractère remplacé par « ? »'); assert.ok(ts.includes('cron -> ok [ok]'), 'dans un journal, les signes s\'écrivent en lettres');
    assert.equal(latin('日本 Привет'), '?? ??????', 'une écriture que les polices standard n\'ont pas est remplacée, pas perdue en silence');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('les applis sensibles ne sortent pas d\'Odin, avec la raison ; le dossier des partages est interdit aux outils de fichiers (pur)', async () => {
  const { allModules } = await import('../src/valhalla/odin.ts'), { DEFAULT_CONFIG } = await import('../src/config.ts');
  const mods = allModules({ paths: { home: '/x', workspace: '/x/w' }, cfg: DEFAULT_CONFIG } as never);
  const refus = Object.fromEntries(mods.map((m) => [m.id, refusDe(m)]).filter(([, r]) => r)) as Record<string, string>;
  assert.deepEqual(Object.keys(refus).sort(), ['brisingamen', 'gladsheim', 'skidbladnir', 'var']);
  assert.equal(refus.brisingamen, 'Thésauros est ton coffre de mots de passe : sa page ne s\'exporte pas et ne se partage pas.');
  assert.match(refus.var, /^Persona garde les comptes des personnes/); assert.match(refus.skidbladnir, /^Nébuleuse garde tes liens de partage/); assert.match(refus.gladsheim, /^Hestia garde les positions de la famille/);
  // Toute appli dont les réglages sont un fichier secret pour Heimdall est refusée, même hors de la liste.
  for (const m of mods) if (isSecretFile(join('/home/awa/.odin/valhalla', m.id, 'réglages.json'))) assert.ok(refusDe(m), `${m.id} : réglages secrets, donc page refusée`);
  assert.match(refusDe({ id: 'var', name: 'Persona' }) ?? '', /Persona/); assert.equal(refusDe({ id: 'eir', name: 'Hygie' }), undefined);
  for (const f of ['index.json', 'a1b2c3d4e5f6.json']) assert.ok(isSecretFile(join('/home/awa/.odin/valhalla/partages', f)), `partages/${f} est un fichier secret`);
  assert.ok(isSecretFile('C:\\Users\\awa\\.odin\\valhalla\\partages\\index.json')); assert.ok(!isSecretFile('/home/awa/.odin/valhalla/eir/réglages.json'));
  // Une appli qui sort sans une section : la copie dit laquelle manque, et pourquoi.
  const p = pageDepuisVue({ id: 'urdr', name: 'Alexandrie', family: 'Données', what: 'x' }, { sections: [{ kind: 'cards', title: 'Tes bases', items: [] }], side: [{ kind: 'log', title: 'Journal des requêtes', lines: ['SELECT * FROM clients WHERE nom = \'Saïd\''] }] }, { quand: QUAND }) as PageExport;
  assert.deepEqual(p.sections.map((s) => s.title), ['Tes bases']); assert.deepEqual(p.retire, [{ title: 'Journal des requêtes', why: 'les requêtes peuvent contenir le contenu de tes bases' }]);
  assert.ok(!JSON.stringify(p).includes('Saïd')); assert.match(enMarkdown(p), /_« Journal des requêtes » n'est pas dans cette copie : les requêtes peuvent contenir le contenu de tes bases\._/);
  assert.equal(fichier(p, 'json').nom, 'Alexandrie - 2026-11-13.json');
});

test('un vrai Odin : export de quatre applis de genres différents dans les quatre formats, connexion exigée, secrets absents', { timeout: 240_000 }, async () => {
  const tt = new T();
  try {
    const v = await vraiOdin(tt, { compte: true }), va = valhallaOf()!, dir = tt.tmp('odin-export-');
    const S = { cookie: v.session };
    const prendre = (q: Record<string, string>, h: Record<string, string> = S) => fetch(`${v.url}/api/valhalla/export?${new URLSearchParams(q)}`, { headers: h });
    const acte = async (module: string, action: string, input: Record<string, unknown>) => (await v.json('/api/valhalla/act', { module, action, input })).body as { ok?: boolean; text?: string };
    const jour = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // De vraies données : une prestation, des horaires et une réservation prise par la page publique de Chronos ;
    // une alerte qui contient un secret connu d'Odin (elle s'affiche dans la page de Forseti).
    assert.equal((await acte('frigg', 'prestation', { nom: 'Coupe', minutes: 30 })).ok, true);
    await acte('frigg', 'horaires', { horaires: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'].map((j) => `${j} 08:00-18:00`).join('\n') });
    const cle = publicKey(va.ctx('frigg')), apres = jour(new Date(Date.now() + 2 * 86_400_000));
    const reserve = await fetch(`${v.url}/r/${cle}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ service: 'Coupe', jour: apres, heure: '10:00', nom: 'Fatima Abdallah', contact: '0639 00 00 00', note: '' }).toString() });
    assert.equal(reserve.status, 200); await reserve.text();
    const SECRET = 'Mdp-du-coffre-4821!'; v.o.redactor.add(SECRET);
    va.alert('forseti', { level: 'haute', title: `Sauvegarde refusée : mot de passe ${SECRET} rejeté`, detail: `essai avec ${SECRET}`, key: 'essai-export' });

    // Sans connexion : refusé, rien ne sort.
    for (const h of [{}, { cookie: 'odin_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }]) { const r = await prendre({ id: 'eir', format: 'md' }, h); assert.equal(r.status, 401); assert.ok(!(await r.text()).includes('Hygie')); }
    // Demandes mal faites, format inconnu, Google Docs (pas de connexion Google dans Odin : on le dit).
    let r = await prendre({ id: 'nexiste-pas', format: 'md' }); assert.equal(r.status, 404); assert.deepEqual(await r.json(), { ok: false, error: 'Appli inconnue.' });
    r = await prendre({ id: 'eir', format: 'exe' }); assert.equal(r.status, 400); assert.match((await r.json() as { error: string }).error, /^Format inconnu : choisis Word \(docx\), PDF \(pdf\), Markdown \(md\) ou JSON \(json\)\.$/);
    r = await prendre({ id: 'eir' }); assert.equal(r.status, 400); await r.text();
    r = await prendre({ id: 'eir', format: 'gdoc' }); assert.equal(r.status, 409); assert.deepEqual(await r.json(), { ok: false, error: GOOGLE_ABSENT, manque: 'google' });
    r = await prendre({ id: 'eir', format: 'md', onglet: 'Réglages' }); assert.equal(r.status, 400); assert.match((await r.json() as { error: string }).error, /n'a pas d'onglets/);
    r = await fetch(`${v.url}/api/valhalla/export?id=eir&format=md`, { method: 'POST', headers: { ...S, 'x-odin': '1', 'content-type': 'application/json' }, body: '{}' }); assert.equal(r.status, 405); await r.text();
    // Les applis sensibles : refusées, avec la raison.
    for (const id of ['brisingamen', 'var', 'skidbladnir', 'gladsheim']) {
      for (const format of ['md', 'json', 'docx', 'pdf']) { const x = await prendre({ id, format }); assert.equal(x.status, 403, `${id} en ${format}`); const j = await x.json() as { ok: boolean; error: string; refus: boolean }; assert.equal(j.refus, true); assert.equal(j.error, refusDe(va.module(id)!)); }
    }

    // Quatre applis de genres différents (tableaux et barres ; rendez-vous ; étapes et graphe ; cartes), dans les quatre formats.
    const attendu: Record<string, { nom: string; kinds: string[]; textes: string[] }> = {
      eir: { nom: 'Hygie', kinds: ['table', 'bars', 'list'], textes: ['Processus', 'Disques (place)', 'Système'] },
      frigg: { nom: 'Chronos', kinds: ['table', 'text'], textes: ['Fatima Abdallah', '0639 00 00 00', 'Coupe', '30 min'] },
      gjoll: { nom: 'Vortex', kinds: ['steps', 'graph', 'table'], textes: ['Mettre en route le VPN', 'Graphe du VPN', 'Odin · Vortex'] },
      naglfar: { nom: 'Argo', kinds: ['cards', 'table', 'text'], textes: ['Conteneurs', 'Images'] },
    };
    for (const [id, a] of Object.entries(attendu)) {
      const vue = ((await v.json(`/api/valhalla/view?id=${id}`)).body.view) as View;
      const titres = [...vue.sections, ...(vue.side ?? [])].filter((s) => s.kind !== 'form').map((s) => s.title);
      for (const f of FORMATS) {
        const x = await prendre({ id, format: f.id }); assert.equal(x.status, 200, `${id} en ${f.id}`);
        // Les mêmes protections que les fichiers remis par les applis : toujours un téléchargement, jamais affiché par Odin.
        assert.equal(x.headers.get('content-type'), 'application/octet-stream'); assert.equal(x.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(x.headers.get('content-security-policy'), 'sandbox'); assert.equal(x.headers.get('cache-control'), 'no-store');
        assert.equal(x.headers.get('content-disposition'), `attachment; filename="${a.nom} - ${jour()}.${f.ext}"; filename*=UTF-8''${encodeURIComponent(`${a.nom} - ${jour()}.${f.ext}`)}`);
        const buf = Buffer.from(await x.arrayBuffer()); assert.equal(Number(x.headers.get('content-length')), buf.length);
        let texte = '';
        if (f.id === 'md') { texte = buf.toString('utf8'); assert.ok(texte.startsWith(`# ${a.nom}\n\n`)); assert.match(texte, new RegExp(`\n_Page ${a.nom} d'Odin, prise le \\d\\d/\\d\\d/\\d{4} à \\d\\d:\\d\\d_\n`)); for (const t of titres) assert.ok(texte.includes(`\n## ${t.replace(/[\\`*[\]<>]/g, '\\$&')}\n`), `${id} : section « ${t} » dans le Markdown`); }
        else if (f.id === 'json') { const p = JSON.parse(buf.toString('utf8')) as PageExport; texte = JSON.stringify(p); assert.equal(p.app.id, id); assert.equal(p.app.name, a.nom); assert.deepEqual(p.sections.map((s) => s.title), titres); for (const k of a.kinds) assert.ok(p.sections.some((s) => s.kind === k), `${id} : une section « ${k} »`); assert.ok(!/"(actions|icon|color|params|submit)":/.test(texte), 'JSON sans bouton, icône, couleur ni formulaire'); }
        else if (f.id === 'docx') { const d = await ouvrirDocx(buf, dir); texte = d.texte; assert.ok(d.tableaux >= 1); for (const t of titres) assert.ok(texte.includes(t), `${id} : section « ${t} » dans le .docx`); }
        else { const d = await ouvrirPdf(buf, dir); texte = sansEspaces(d.texte); assert.ok(d.pages >= 1); for (const t of titres) assert.ok(texte.includes(sansEspaces(latin(t))), `${id} : section « ${t} » dans le PDF (${d.via})`); }
        assert.ok(texte.includes(a.nom)); for (const t of a.textes) assert.ok(sansEspaces(texte).includes(t), `${id} en ${f.id} : « ${t} » retrouvé`);
        assert.ok(!texte.includes(cle), 'l\'adresse secrète de réservation n\'est dans aucun export');
      }
    }
    // L'adresse secrète de Chronos est masquée, et la copie le dit.
    const chronos = await (await prendre({ id: 'frigg', format: 'md' })).text();
    assert.match(chronos, /Tes clients réservent sur \/r\/••• — sans compte\./); assert.match(chronos, /_1 valeur masquée par sécurité/);
    // Le secret connu d'Odin, affiché par une alerte, ne sort dans aucun format.
    for (const f of FORMATS) {
      const buf = Buffer.from(await (await prendre({ id: 'forseti', format: f.id })).arrayBuffer());
      const texte = f.id === 'docx' ? (await ouvrirDocx(buf, dir)).texte : f.id === 'pdf' ? (await ouvrirPdf(buf, dir)).texte : buf.toString('utf8');
      // (dans le PDF, la case du tableau passe à la ligne : on y cherche les mots, pas la phrase d'un seul tenant)
      if (f.id === 'pdf') assert.ok(['Sauvegarde', 'rejeté', '•••'].every((mot) => texte.includes(mot)), 'l\'alerte est là, secret masqué (pdf)');
      else assert.ok(sansEspaces(texte).includes('Sauvegarde refusée : mot de passe ••• rejeté'), `l'alerte est là, secret masqué (${f.id})`);
      assert.ok(!texte.includes(SECRET) && !buf.includes(SECRET), `le secret n'est pas dans le fichier ${f.id}`);
    }
    // Toutes les applis qui s'exportent : aucun secret d'Odin (coffre, session, clé d'API, adresse de réservation) dans le Markdown ni le JSON.
    const secrets = [SECRET, cle, v.token, v.session.split('=')[1], String(process.env.MQTT_PASSWORD), String(process.env.BRISINGAMEN_KEY)].filter((x) => x && x !== 'undefined');
    assert.equal(secrets.length, 6);
    let exportees = 0;
    for (const m of va.modules()) {
      if (refusDe(m)) continue;
      for (const format of ['md', 'json']) { const x = await prendre({ id: m.id, format }); assert.equal(x.status, 200, `${m.id} en ${format}`); const t = await x.text(); for (const sec of secrets) assert.ok(!t.includes(sec), `${m.id} en ${format} : un secret est sorti`); }
      exportees++;
    }
    assert.ok(exportees >= 50, `${exportees} applis exportées`);
  } finally { await tt.end(); }
});
