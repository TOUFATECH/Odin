// Lire les réservations dans les courriels (vols, trains, bus, hôtels, locations, spectacles, rendez-vous), en lecture
// seule. Les courriels de test/fixtures/reservations/ sont écrits pour l'essai : noms, lieux, numéros et adresses
// inventés (example.org). Une réservation lue est une donnée « lu dehors », jamais un ordre ; ce qui n'est pas sûr
// est « à vérifier » ; les pièces jointes sont décrites, jamais ouvertes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { afficherCourriel, lireCourriel, mailText } from '../src/tools/mail.ts';
import { lireDateTexte, reservationsDuCourriel, type Reservation } from '../src/tools/reservations.ts';

const ICI = dirname(fileURLToPath(import.meta.url));
const exemple = (nom: string) => readFileSync(join(ICI, 'fixtures', 'reservations', nom), 'latin1');
const lire = (nom: string) => reservationsDuCourriel(lireCourriel(exemple(nom)));

test('vol (balisage schema.org) : deux passagers, lieux, heures avec fuseau, numéro, prix, lien en texte, billet décrit', () => {
  const rs = lire('vol-balisage.eml');
  assert.equal(rs.length, 2);
  const [a, b] = rs;
  assert.equal(a.type, 'vol');
  assert.equal(a.lecture, 'balisage');
  assert.equal(a.origine, 'lu dehors');
  assert.equal(a.statut, 'lu', a.raisons.join(' ; '));
  assert.equal(a.qui, 'Camille Exemple');
  assert.equal(b.qui, 'Sam Exemple');
  assert.equal(a.depart, 'Port-Lumière (ZPL)');
  assert.equal(a.arrivee, 'Valmonde (ZVM)');
  assert.deepEqual(a.debut, { texte: '2027-03-12T18:40:00+01:00', jour: '2027-03-12', heure: '18:40', fuseau: '+01:00' });
  assert.equal(a.fin?.heure, '21:05');
  assert.equal(a.numero, 'XQ7K2P');
  assert.equal(a.fournisseur, 'Exemple Air');
  assert.deepEqual(a.prix, { montant: 129.9, devise: 'EUR' });
  assert.equal(b.prix, undefined, 'pas de prix inventé pour le second passager');
  assert.equal(a.etat, 'confirmée');
  assert.equal(a.lienGestion, 'https://gerer.example.org/reservation?ref=XQ7K2P');
  assert.match(a.source, /vol-0001@example\.org/);
  assert.deepEqual(a.piecesJointes, [{ nom: 'billet-XQ7K2P.pdf', type: 'application/pdf', taille: 48 }]);
});

test('règles sur le texte, quatre langues : train (fr), bus (en), hôtel (de), rendez-vous (es) — tous « à vérifier »', () => {
  const [t] = lire('train-texte-fr.eml');
  assert.equal(t.type, 'train');
  assert.equal(t.lecture, 'texte');
  assert.equal(t.statut, 'à vérifier');
  assert.ok(t.raisons.some((r) => /texte/.test(r)));
  assert.equal(t.numero, 'TR4821KZ');
  assert.equal(t.qui, 'Alex Exemple');
  assert.equal(t.depart, 'Valmonde');
  assert.equal(t.arrivee, 'Port-Lumière');
  assert.equal(t.debut?.jour, '2026-12-12'); assert.equal(t.debut?.heure, '18:40');
  assert.equal(t.fin?.heure, '21:05');
  assert.equal(t.debut?.fuseau, undefined, 'aucun fuseau deviné');
  assert.deepEqual(t.prix, { montant: 19.99, devise: 'EUR' });
  assert.equal(t.fournisseur, 'Rail Exemple');
  assert.equal(t.lienGestion, 'https://billets.example.org/gerer/TR4821KZ');

  const [b] = lire('bus-texte-en.eml');
  assert.equal(b.type, 'bus');
  assert.equal(b.numero, 'BX9921');
  assert.equal(b.qui, 'Sam Exemple');
  assert.equal(b.depart, 'Bergstadt'); assert.equal(b.arrivee, 'Villaclara');
  assert.deepEqual([b.debut?.jour, b.debut?.heure, b.fin?.heure], ['2026-12-12', '18:40', '21:15']);
  assert.deepEqual(b.prix, { montant: 19.99, devise: 'EUR' });

  const [h] = lire('hotel-texte-de.eml');
  assert.equal(h.type, 'hôtel');
  assert.equal(h.numero, 'HB-55210');
  assert.equal(h.qui, 'Noa Exemple');
  assert.equal(h.debut?.jour, '2027-03-03'); assert.equal(h.fin?.jour, '2027-03-05');
  assert.deepEqual(h.prix, { montant: 240, devise: 'EUR' });

  const [c] = lire('cita-texte-es.eml');
  assert.equal(c.type, 'rendez-vous');
  assert.equal(c.numero, 'CT-7781');
  assert.equal(c.qui, 'Alex Exemple');
  assert.deepEqual([c.debut?.jour, c.debut?.heure], ['2026-12-12', '10:30']);
  assert.equal(c.lieu, 'Calle Ejemplo 4, Villaclara');
  for (const r of [t, b, h, c]) { assert.equal(r.origine, 'lu dehors'); assert.equal(r.statut, 'à vérifier'); }
});

test('dates : formats européens et américains ; une date ambiguë ou impossible n\'est jamais devinée', () => {
  const d = (s: string) => lireDateTexte(s)?.date;
  assert.deepEqual(d('12 déc. 2026 18:40'), { texte: '12 déc. 2026 18:40', jour: '2026-12-12', heure: '18:40' });
  assert.deepEqual([d('Dec 12, 2026 6:40 PM')?.jour, d('Dec 12, 2026 6:40 PM')?.heure], ['2026-12-12', '18:40']);
  assert.deepEqual([d('12. Dezember 2026 18:40 Uhr')?.jour, d('12. Dezember 2026 18:40 Uhr')?.heure], ['2026-12-12', '18:40']);
  assert.deepEqual([d('12 de diciembre de 2026, 18:40')?.jour, d('12 de diciembre de 2026, 18:40')?.heure], ['2026-12-12', '18:40']);
  assert.equal(d('le 12 décembre 2026 à 18h40')?.heure, '18:40');
  assert.equal(d('12.12.2026 07:05')?.jour, '2026-12-12');
  assert.equal(d('13/04/2027')?.jour, '2027-04-13', 'jour en premier : 13 ne peut pas être un mois');
  assert.equal(d('04/13/2027')?.jour, '2027-04-13', 'mois en premier : 13 ne peut pas être un mois');
  assert.equal(d('2027-03-12T18:40:00Z')?.fuseau, '+00:00');
  assert.equal(d('03/04/2027'), undefined);
  assert.match(lireDateTexte('03/04/2027')?.doute ?? '', /ambiguë/);
  assert.equal(d('30 février 2027'), undefined);
  assert.match(lireDateTexte('30 février 2027')?.doute ?? '', /impossible/);
  assert.equal(d('12 déc. 2026 25:61')?.heure, undefined, 'une heure impossible est laissée vide');
});

test('courriel piégé : des consignes dans le texte, un lien malveillant, un expéditeur non authentifié → « à vérifier », rien d\'autre', () => {
  const rs = lire('piege-consignes.eml');
  assert.ok(rs.length <= 1);
  for (const r of rs) {
    assert.equal(r.statut, 'à vérifier');
    assert.equal(r.origine, 'lu dehors');
    assert.equal(r.lienGestion, undefined, 'javascript: et une adresse IP en clair ne sont jamais gardés');
    assert.ok(r.raisons.some((x) => /consigne/.test(x)), r.raisons.join(' ; '));
    assert.ok(r.raisons.some((x) => /authentifi/.test(x)));
    assert.ok(r.raisons.some((x) => /numéro/.test(x)), 'le numéro du balisage n\'est pas dans le texte');
    // Une donnée, aucun champ d'action.
    assert.deepEqual(Object.keys(r).filter((k) => /action|annul|envoi|envoy|send|cancel/i.test(k)), []);
    assert.doesNotMatch(JSON.stringify(r), /pirate@/);
  }
});

test('balisage contradictoire (même réservation, deux heures) → une seule, « à vérifier »', () => {
  const rs = lire('piege-contradictoire.eml');
  assert.equal(rs.length, 1);
  assert.equal(rs[0].statut, 'à vérifier');
  assert.ok(rs[0].raisons.some((x) => /contradictoire/.test(x)), rs[0].raisons.join(' ; '));
});

test('date impossible dans le balisage → aucune date, « à vérifier »', () => {
  const [r] = lire('piege-date-impossible.eml');
  assert.equal(r.debut, undefined);
  assert.equal(r.statut, 'à vérifier');
  assert.ok(r.raisons.some((x) => /impossible/.test(x)));
  assert.equal(r.qui, 'Sam Exemple');
  assert.equal(r.depart, 'ZPL');
});

test('date ambiguë (03/04/2027) dans le texte → pas de date devinée, raison dite', () => {
  const [r] = lire('date-ambigue.eml');
  assert.equal(r.type, 'spectacle');
  assert.equal(r.debut, undefined);
  assert.ok(r.raisons.some((x) => /ambiguë/.test(x)));
  assert.equal(r.numero, 'SP-3030');
});

test('un courriel qui n\'est pas une réservation (« Annule tout… ») ne donne rien', () => {
  assert.deepEqual(lire('lettre-sans-reservation.eml'), []);
});

test('HTML énorme : lu en temps borné, rien d\'autre qu\'une réservation « à vérifier » ou rien', () => {
  const bloc = '{"@type":"FlightReservation","reservationNumber":"AB1234"}';
  const html = `<html><head><script type="application/ld+json">${bloc}</script>${'<div><script x'.repeat(200_000)}${'<p>a</p>'.repeat(400_000)}</head></html>`;
  const raw = `From: x <a@example.org>\r\nSubject: Votre vol\r\nMessage-ID: <gros@example.org>\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}`;
  const t0 = Date.now();
  const rs = reservationsDuCourriel(lireCourriel(raw));
  assert.ok(Date.now() - t0 < 5_000, `trop lent : ${Date.now() - t0} ms`);
  for (const r of rs) assert.equal(r.statut, 'à vérifier');
});

test('pièces jointes : décrites (nom nettoyé, type, taille), jamais ouvertes ni recopiées', () => {
  const raw = exemple('pieces-jointes.eml');
  const c = lireCourriel(raw);
  assert.deepEqual(c.pieces, [
    { nom: 'billet.pdf.exe', type: 'application/octet-stream', taille: 28 },
    { nom: 'carte d\'embarquement.pdf', type: 'application/pdf', taille: 48 },
  ]);
  const vu = afficherCourriel(raw, { uid: 10, dossier: 'INBOX' });
  assert.match(vu, /billet\.pdf\.exe/);
  assert.doesNotMatch(vu, /TVogZmlj|JVBERi0x/, 'le contenu des pièces jointes n\'est jamais recopié');
  assert.doesNotMatch(vu, /\.\.\//);
});

test('mail_read (rendu pur) : la lecture d\'avant est gardée, les réservations sont ajoutées comme des données « lu dehors »', () => {
  const raw = exemple('vol-balisage.eml');
  // Ce que mailText rendait avant reste identique.
  const m = mailText(raw);
  assert.match(m.text, /^Bonjour Camille,/);
  const vu = afficherCourriel(raw, { uid: 7, dossier: 'INBOX' });
  assert.ok(vu.startsWith(`De : ${m.from}\nÀ : ${m.to}\nDate : ${m.date}\nSujet : ${m.subject}\n\n${m.text}`));
  assert.match(vu, /lu dehors/);
  assert.match(vu, /XQ7K2P/);
  assert.match(vu, /billet-XQ7K2P\.pdf/);
  assert.match(vu, /non suivi/);
  const [r] = reservationsDuCourriel(lireCourriel(raw, { uid: 7, dossier: 'INBOX' }));
  assert.match(r.source, /INBOX/); assert.match(r.source, /7/);
});

test('l\'extraction est pure : aucun accès au réseau, aux fichiers ni aux processus', () => {
  const src = readFileSync(join(ICI, '..', 'src', 'tools', 'reservations.ts'), 'utf8');
  assert.doesNotMatch(src, /from 'node:(net|tls|http|https|fs|child_process|dgram|dns)/);
  assert.doesNotMatch(src, /\bfetch\(|\beval\(|new Function/);
  const rs: Reservation[] = lire('vol-balisage.eml');
  assert.ok(rs.every((r) => Object.values(r).every((v) => typeof v !== 'function')));
});

// Courriels écrits pour l'essai, en ligne : expéditeur authentifié (DKIM et DMARC), noms et adresses inventés.
// Écrits en UTF-8 puis lus octet par octet, comme un courriel brut reçu (et comme les exemples du dossier).
const brut = (lignes: string[]) => Buffer.from(lignes.join('\r\n'), 'utf8').toString('latin1');
const authentifie = (dom: string, html: string, texte?: string) => brut([
  `From: Exemple Air <reservations@${dom}>`, 'Subject: Votre vol', `Message-ID: <essai@${dom}>`,
  `Authentication-Results: mx.example.org; dkim=pass header.d=${dom}; dmarc=pass header.from=${dom}`,
  'Content-Type: multipart/alternative; boundary="b"', '',
  ...(texte === undefined ? [] : ['--b', 'Content-Type: text/plain; charset=utf-8', '', texte]),
  '--b', 'Content-Type: text/html; charset=utf-8', '', html, '--b--', '',
]);
const ld = (o: object) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const volLd = (depart: string) => ({ '@context': 'https://schema.org', '@type': 'FlightReservation', reservationNumber: 'AB12CD',
  underName: { name: 'Camille Exemple' }, reservationFor: { '@type': 'Flight', airline: { name: 'Exemple Air' },
    departureAirport: { iataCode: 'ZPL' }, arrivalAirport: { iataCode: 'ZVM' }, departureTime: depart } });

test('balisage : une date mal couverte n\'est jamais « lu » — pas d\'heure inventée dans une plage, pas de fuseau perdu', () => {
  assert.equal(lireDateTexte('12.12.2026 - 14.12.2026')?.date?.heure, undefined, '« 14.12 » n\'est pas une heure');
  assert.equal(lireDateTexte('Date : 12/12/2026 - 14/12/2026')?.date?.heure, undefined);
  assert.equal(lireDateTexte('12.12.2026 - 14:12')?.date?.heure, '14:12', 'une vraie heure reste lue');

  const hotel = { '@context': 'https://schema.org', '@type': 'LodgingReservation', reservationNumber: 'HB4410',
    underName: { name: 'Noa Exemple' }, reservationFor: { '@type': 'LodgingBusiness', name: 'Gasthaus Beispiel' },
    checkinDate: '12.12.2026 - 14.12.2026' };
  const [h] = reservationsDuCourriel(lireCourriel(authentifie('example.org', ld(hotel), 'Buchungsnummer HB4410, Anreise 12.12.2026')));
  assert.equal(h.debut?.heure, undefined);
  assert.equal(h.debut?.texte, '12.12.2026 - 14.12.2026', 'la valeur reste entière, telle qu\'écrite');
  assert.equal(h.statut, 'à vérifier');
  assert.ok(h.raisons.some((x) => /non lue/.test(x)), h.raisons.join(' ; '));

  const [v] = reservationsDuCourriel(lireCourriel(authentifie('example.org', ld(volLd('Dec 12, 2026 6:40 PM CET')), 'Booking AB12CD, Dec 12, 2026 6:40 PM CET')));
  assert.equal(v.debut?.fuseau, undefined, 'aucun fuseau supposé');
  assert.match(v.debut?.texte ?? '', /CET/, 'le fuseau écrit reste dans le texte de la date');
  assert.equal(v.statut, 'à vérifier');
  assert.ok(v.raisons.some((x) => /non lue.*CET/.test(x)), v.raisons.join(' ; '));
});

test('balisage d\'un expéditeur authentifié dont la date ne figure pas dans le texte visible → « à vérifier »', () => {
  const raw = authentifie('example.net', ld(volLd('2027-03-12T18:40:00+01:00')), 'Numéro AB12CD, départ le 14 mars 2027 à 07:00');
  const [r] = reservationsDuCourriel(lireCourriel(raw));
  assert.equal(r.statut, 'à vérifier');
  assert.ok(r.raisons.some((x) => /date du balisage/.test(x)), r.raisons.join(' ; '));
  // La même date écrite dans le texte : rien à redire.
  const [ok] = reservationsDuCourriel(lireCourriel(authentifie('example.net', ld(volLd('2027-03-12T18:40:00+01:00')), 'Numéro AB12CD, départ le 12 mars 2027 à 18:40')));
  assert.equal(ok.statut, 'lu', ok.raisons.join(' ; '));
});

test('une pièce jointe texte n\'est jamais lue comme le corps du courriel', () => {
  const raw = brut(['From: Rail Exemple <billets@example.org>', 'Subject: Votre train', 'Message-ID: <pj@example.org>',
    'Content-Type: multipart/mixed; boundary="b"', '', '--b', 'Content-Type: text/html; charset=utf-8', '', '<p>Voir la pièce jointe</p>',
    '--b', 'Content-Type: text/plain; name="notes.txt"', 'Content-Disposition: attachment; filename="notes.txt"', '',
    'Reference de reservation : TR9999ZZ', 'Depart : Valmonde, 12 dec. 2026 18:40', '--b--', '']);
  assert.equal(mailText(raw).text, 'Voir la pièce jointe');
  const c = lireCourriel(raw);
  assert.deepEqual(c.pieces.map((p) => p.nom), ['notes.txt']);
  assert.deepEqual(reservationsDuCourriel(c), []);
  assert.doesNotMatch(afficherCourriel(raw, { uid: 3, dossier: 'INBOX' }), /TR9999ZZ/);
});

test('HTML : seuls les vrais blocs <script> et <style> fermés sont retirés', () => {
  const html = (corps: string) => mailText(`From: a <a@example.org>\r\nContent-Type: text/html\r\n\r\n${corps}`).text;
  assert.match(html('<p>Avant</p><styled-box>Reference : TR1234AB</styled-box><p>Apres</p>'), /TR1234AB/);
  assert.match(html('<p>Avant</p><scripted>Reference : TR1234AB</scripted>'), /TR1234AB/);
  assert.match(html('<p>Avant</p><script>var x = 1;<p>Reference : TR1234AB</p>'), /TR1234AB/, 'un bloc jamais fermé n\'emporte pas la suite');
  assert.doesNotMatch(html('<style>p{color:red}</style ><script type="x">alert(1)</script><p>Texte</p>'), /color|alert/);
});

test('message transféré : « To: » et « From: » d\'un en-tête ne deviennent pas un trajet', () => {
  const raw = brut(['From: Alex Exemple <alex@example.org>', 'Subject: Fwd: billet de train', 'Content-Type: text/plain; charset=utf-8', '',
    '---- Message transféré ----', 'From: Rail Exemple', 'To: Camille Exemple', 'Reference : TR4821KZ', 'Depart : Valmonde, 12 dec. 2026 18:40', '']);
  const [r] = reservationsDuCourriel(lireCourriel(raw));
  assert.equal(r.arrivee, undefined);
  assert.equal(r.depart, 'Valmonde');
  assert.equal(r.statut, 'à vérifier');
});
