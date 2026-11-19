// Allemand : indices pour reconnaître un document déposé et en lire les données (voir forme.ts).
import type { DonneesLangue } from './forme.ts';

export const de: DonneesLangue = {
  mots: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'für', 'von', 'zu', 'den', 'dem', 'des', 'ein', 'eine', 'im', 'auf', 'sie', 'ihr', 'ihre', 'wir', 'bei', 'bis'],
  types: {
    facture: {
      forts: ['rechnung', 'rechnungsnummer', 'rechnung nr', 'rechnungs-nr', 'rechnungsdatum', 'rechnungsbetrag'],
      indices: ['gesamtbetrag', 'zwischensumme', 'mwst', 'ust', 'umsatzsteuer', 'mehrwertsteuer', 'nettobetrag', 'bruttobetrag', 'zahlbar bis', 'fällig', 'zahlungsziel', 'einzelpreis', 'menge', 'bezeichnung', 'steuernummer'],
    },
    devis: {
      forts: ['angebot', 'angebotsnummer', 'angebot nr', 'kostenvoranschlag', 'kostenangebot'],
      indices: ['gültig bis', 'angebotsdatum', 'bindefrist', 'auftragsbestätigung', 'zwischensumme', 'mwst', 'einzelpreis', 'menge', 'bezeichnung', 'anzahlung'],
    },
    contrat: {
      forts: ['vertrag', 'mietvertrag', 'arbeitsvertrag', 'kaufvertrag', 'dienstleistungsvertrag', 'vereinbarung'],
      indices: ['vertragsparteien', 'zwischen', 'im folgenden', 'nachfolgend', 'kündigung', 'laufzeit', 'vermieter', 'mieter', 'arbeitgeber', 'arbeitnehmer', 'unterschrift', 'ort, datum', 'gerichtsstand'],
    },
    billet: {
      forts: ['fahrkarte', 'fahrschein', 'ticket', 'online-ticket', 'e-ticket', 'zugticket'],
      indices: ['reisender', 'fahrgast', 'hinfahrt', 'rückfahrt', 'zug', 'wagen', 'platz', 'abfahrt', 'ankunft', 'gleis', 'auftragsnummer', 'buchungsnummer', 'klasse', 'bahncard'],
    },
    "carte d'embarquement": {
      forts: ['bordkarte', 'boarding pass'],
      indices: ['flugsteig', 'gate', 'boarding', 'einsteigezeit', 'sitz', 'sitzplatz', 'flug', 'passagier', 'gruppe', 'terminal'],
    },
    'relevé bancaire': {
      forts: ['kontoauszug', 'kontoauszüge'],
      indices: ['alter kontostand', 'neuer kontostand', 'kontostand', 'saldo', 'soll', 'haben', 'buchungstag', 'wertstellung', 'umsätze', 'kontoinhaber', 'überweisung', 'lastschrift', 'gutschrift'],
    },
    ordonnance: {
      forts: ['ärztliche verordnung', 'kassenrezept', 'privatrezept'],
      indices: ['rezept', 'dosierung', 'tablette', 'tabletten', 'kapsel', 'kapseln', 'mg', 'mal täglich', 'täglich', 'arzt', 'ärztin', 'apotheke', 'einnahme', 'packung'],
    },
    formulaire: {
      forts: ['formular', 'antrag', 'antragsformular', 'anmeldeformular', 'vordruck'],
      indices: ['bitte ausfüllen', 'ausfüllen', 'ankreuzen', 'zutreffendes ankreuzen', 'vorname', 'nachname', 'geburtsdatum', 'geburtsort', 'anschrift', 'in druckbuchstaben', 'vom amt auszufüllen', 'anlagen'],
    },
    'courrier administratif': {
      forts: ['sehr geehrte damen und herren', 'sehr geehrte frau', 'sehr geehrter herr', 'mit freundlichen grüßen', 'betreff:', 'betreff', 'wir teilen ihnen mit'],
      indices: ['ihr zeichen', 'unser zeichen', 'aktenzeichen', 'behörde', 'amt', 'finanzamt', 'stadtverwaltung', 'ministerium', 'bescheid', 'anlage', 'bearbeiter', 'hiermit'],
    },
    CV: {
      forts: ['lebenslauf', 'curriculum vitae', 'cv'],
      indices: ['berufserfahrung', 'beruflicher werdegang', 'ausbildung', 'kenntnisse', 'fähigkeiten', 'sprachkenntnisse', 'sprachen', 'hobbys', 'interessen', 'persönliche daten', 'schulbildung', 'studium'],
    },
  },
  emetteur: ['absender', 'verkäufer', 'lieferant', 'rechnungssteller', 'von:', 'aussteller'],
  destinataire: ['kunde', 'empfänger', 'rechnungsempfänger', 'an:', 'rechnungsadresse', 'fahrgast', 'reisender', 'passagier', 'kontoinhaber', 'patient', 'patientin'],
  references: {
    facture: ['rechnungsnummer', 'rechnung nr', 'rechnungs-nr', 'rechnung'],
    devis: ['angebotsnummer', 'angebot nr', 'angebots-nr', 'angebot'],
    contrat: ['vertragsnummer', 'vertrags-nr', 'vertrag nr'],
    réservation: ['buchungsnummer', 'buchungscode', 'auftragsnummer', 'reservierungsnummer', 'pnr'],
    client: ['kundennummer', 'kunden-nr', 'kunden nr'],
    commande: ['bestellnummer', 'bestell-nr'],
    vol: ['flugnummer', 'flug-nr', 'flug'],
    dossier: ['aktenzeichen', 'ihr zeichen', 'unser zeichen', 'referenz', 'az.'],
  },
  dates: {
    echeance: ['fällig am', 'fälligkeitsdatum', 'fällig', 'zahlbar bis', 'zahlungsziel', 'bitte überweisen sie bis', 'spätestens am'],
    validite: ['gültig bis', 'angebot gültig bis', 'bindefrist', 'ablaufdatum'],
    voyage: ['abfahrt', 'ankunft', 'abflug', 'reisedatum', 'hinfahrt', 'rückfahrt', 'reisetag', 'boarding'],
    emission: ['rechnungsdatum', 'angebotsdatum', 'ausstellungsdatum', 'auszugsdatum'],
    generiques: ['datum'],
  },
  montants: {
    ttc: ['gesamtbetrag brutto', 'bruttobetrag', 'summe brutto', 'gesamt brutto', '^brutto'],
    ht: ['zwischensumme', 'nettobetrag', 'summe netto', 'gesamt netto', '^netto'],
    tva: ['mwst', 'ust', 'umsatzsteuer', 'mehrwertsteuer'],
    total: ['gesamtbetrag', 'gesamtsumme', 'rechnungsbetrag', 'zu zahlen', 'endbetrag', 'zahlbetrag', '^summe', '^gesamt'],
    horsLignes: ['anzahlung', 'bereits bezahlt', 'stammkapital'],
  },
  regle: ['^bezahlt', 'bezahlt am', 'bezahlt per', 'bezahlt mit', 'vollständig bezahlt', 'bereits bezahlt', 'beglichen', 'betrag dankend erhalten', 'dankend erhalten', 'anzahlung erhalten', 'gutschrift', 'quittung'],
  boutons: {
    'convertir-word': 'In Word umwandeln',
    'convertir-pdf': 'In PDF umwandeln',
    'extraire-tableau': 'Als Tabelle extrahieren',
    'ajouter-echeance': 'Fälligkeit in den Kalender eintragen',
    'preparer-paiement': 'Zahlung vorbereiten (zur Freigabe)',
  },
};
