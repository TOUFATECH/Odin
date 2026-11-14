// Champollion (reconnaissance) : comprendre un texte (pur), puis de vraies lectures : photo, PDF scanné, PDF
// cherchable, document, audio (écoute simulée), antivirus avant lecture, garder dans le Cerveau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { analyse, findDates, report } from '../src/valhalla/champollion/analyse.ts';
import { useHear } from '../src/valhalla/modules/champollion.ts';
import { ocrPdf, understanding } from '../src/valhalla/champollion/ocr.ts';

const NOW = new Date('2026-11-13T09:00:00+03:00');
test('Champollion : comprendre un texte (pur)', () => {
  const t = `FACTURE N° 2026-118\nTOUFATECH, Mamoudzou\nDate : 13/11/2026\nRéparation iPhone 15 : 180,00 €\nProtection écran : 25 €\nTotal TTC : 205,00 €\nÀ régler avant le 30 novembre 2026.\nContact : contact@toufatech.com · 0639 12 34 56\nIBAN FR76 3000 6000 0112 3456 7890 189\nhttps://toufatech.com/facture/118`;
  const a = analyse(t, NOW);
  assert.equal(a.type, 'facture'); assert.equal(a.langue, 'français');
  assert.deepEqual(a.dates.map((d) => d.date), ['2026-11-13', '2026-11-30']);
  assert.equal(a.evenements[0].genre, 'échéance'); assert.equal(a.evenements[0].quand, '2026-11-30');
  assert.deepEqual(a.montants.map((m) => m.valeur), [180, 25, 205]); assert.ok(a.montants[2].total);
  assert.deepEqual(a.emails, ['contact@toufatech.com']); assert.deepEqual(a.telephones, ['0639 12 34 56']); assert.equal(a.iban[0], 'FR7630006000011234567890189');
  const r = report(a, 'facture.pdf');
  assert.match(r, /facture · français/); assert.match(r, /échéance · lundi 30 novembre 2026/); assert.match(r, /total : 205,00 €/); assert.match(r, /FR76 … 0189/); assert.ok(!r.includes('3000 6000'), 'IBAN masqué');
  const c = analyse('Bonjour, vous êtes convoqué à un entretien le lundi 16 novembre à 14h30 à la mairie. Merci de confirmer.', NOW);
  assert.equal(c.type, 'convocation'); assert.deepEqual([c.evenements[0].quand, c.evenements[0].heure, c.evenements[0].genre], ['2026-11-16', '14:30', 'convocation']);
  assert.equal(findDates('rdv demain à 9h', NOW)[0].date, '2026-11-14'); assert.equal(findDates('rdv demain à 9h', NOW)[0].heure, '09:00');
  assert.equal(findDates('le 5 janvier', NOW)[0].date, '2027-01-05', 'sans année : la prochaine');
  assert.equal(analyse('Your flight AF 123 departs on 2026-12-02. Check-in opens online.', NOW).type, 'billet ou réservation');
});

const sh = (cmd: string, args: string[], o: { timeoutMs?: number } = {}) => new Promise<{ code: number; out: string; err: string }>((ok) => execFile(cmd, args, { timeout: o.timeoutMs ?? 180000, maxBuffer: 1 << 25 }, (e, out, err) => ok({ code: e ? (typeof (e as { code?: unknown }).code === 'number' ? (e as { code: number }).code : 1) : 0, out: String(out), err: String(err) })));
const has = async (c: string) => (await sh('sh', ['-c', `command -v ${c}`])).code === 0;

test('Champollion : vraies lectures (photo, PDF scanné, PDF cherchable, document, audio), antivirus, Cerveau', { timeout: 300000 }, async (t) => {
  if (!(await has('tesseract')) || !(await has('convert'))) { t.skip('tesseract ou ImageMagick absent'); return; }
  const home = mkdtempSync(join(tmpdir(), 'champo-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: (c, a, o) => sh(c, a, o), fetch: (async () => new Response('')) as unknown as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  const at = join(v.ctx('champollion').dir, 'atelier'); mkdirSync(at, { recursive: true });
  try {
    // Une « photo » d'un papier : rendez-vous chez le dentiste
    await sh('convert', ['-size', '1400x320', 'xc:white', '-fill', 'black', '-pointsize', '44', '-annotate', '+40+90', 'Rendez-vous dentiste le 20/11/2026 a 10h30', '-annotate', '+40+180', 'Cabinet Kawéni, tel 0639 11 22 33', '-annotate', '+40+270', 'Consultation : 30 euros', join(at, 'photo.png')]);
    let r = await v.act('champollion', 'lire', { fichier: 'photo.png' });
    assert.match(r.text, /texte reconnu sur l'image/, r.text); assert.match(r.text, /rendez-vous · vendredi 20 novembre 2026 à 10 h 30/i, r.text); assert.match(r.text, /0639 11 22 33/); assert.match(r.text, /antivirus/);
    // Le même papier scanné en PDF (aucun texte dedans) : lu page par page
    await sh('convert', [join(at, 'photo.png'), join(at, 'scan.pdf')]);
    assert.equal((await sh('pdftotext', [join(at, 'scan.pdf'), '-'])).out.trim(), '', 'le PDF scanné n\'a pas de texte');
    r = await v.act('champollion', 'lire', { fichier: 'scan.pdf' }); assert.match(r.text, /PDF scanné : texte reconnu sur 1 page/, r.text); assert.match(r.text, /dentiste/i);
    const o = await ocrPdf(join(at, 'scan.pdf')); assert.equal(o.pages, 1); assert.match(understanding(o.text, 'scan.pdf', NOW), /Ce que Champollion y comprend[\s\S]*rendez-vous · vendredi 20 novembre 2026/i, 'une pièce jointe scannée est comprise aussi par Odin (doc_read)');
    r = await v.act('champollion', 'pdf_cherchable', { fichier: 'scan.pdf' }); assert.match(r.text, /scan\.texte\.pdf/, r.text);
    assert.match((await sh('pdftotext', [join(at, 'scan.texte.pdf'), '-'])).out, /dentiste/i, 'le PDF est maintenant cherchable'); assert.ok(existsSync(join(at, 'scan.pdf')), 'l\'original reste');
    // Un document Word
    if (await has('pandoc') && await has('soffice')) {
      writeFileSync(join(at, 'devis.md'), '# Devis n° 42\n\nInstallation Starlink chez M. Ali.\n\nTotal TTC : 650,00 €. Offre valable jusqu\'au 15 décembre 2026.\n');
      await sh('pandoc', [join(at, 'devis.md'), '-o', join(at, 'devis.docx')]);
      r = await v.act('champollion', 'lire', { fichier: 'devis.docx' }); assert.match(r.text, /devis · français/, r.text); assert.match(r.text, /échéance · mardi 15 décembre 2026/);
    }
    // Un audio (écoute simulée : Whisper n'est pas installé ici)
    useHear(async () => ({ text: 'Bonjour, c\'est Fatima, la réunion est déplacée à demain à 15h. Merci.', language: 'fr' }));
    writeFileSync(join(at, 'vocal.ogg'), Buffer.from('OggS'));
    r = await v.act('champollion', 'lire', { fichier: 'vocal.ogg' }); assert.match(r.text, /ce qui est dit \(fr\)/); // « demain » se compte à partir d'aujourd'hui : la date attendue aussi (et pas une date écrite en dur).
    const demain = new Date(Date.now() + 864e5).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    assert.ok(r.text.includes(`réunion · ${demain} à 15 h 00`), r.text);
    useHear(async () => { throw new Error('Whisper local non installé'); });
    assert.match((await v.act('champollion', 'lire', { fichier: 'vocal.ogg' })).text, /installe la voix locale/);
    useHear();
    // Un texte collé, et garder une lecture dans le Cerveau
    r = await v.act('champollion', 'texte', { texte: 'Livraison prévue le 18/11/2026 entre 8h et 12h, commande 7781.' }); assert.match(r.text, /livraison · mercredi 18 novembre 2026 à 08 h 00/, r.text);
    r = await v.act('champollion', 'garder', {}); assert.match(r.text, /📝/, r.text);
    assert.match((await v.act('champollion', 'lectures')).text, /texte collé/);
    // Sécurité : rien hors des dossiers, fichiers protégés refusés
    assert.match((await v.act('champollion', 'lire', { fichier: '../../../etc/shadow' })).text, /interdit/);
  } finally { useHear(); v.stop(); rmSync(home, { recursive: true, force: true }); }
});
