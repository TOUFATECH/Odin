// Anglais : indices pour reconnaître un document déposé et en lire les données (voir forme.ts).
import type { DonneesLangue } from './forme.ts';

export const en: DonneesLangue = {
  mots: ['the', 'and', 'of', 'to', 'for', 'you', 'your', 'with', 'on', 'in', 'this', 'is', 'are', 'from', 'by', 'at', 'our', 'we', 'please', 'be', 'will'],
  types: {
    facture: {
      forts: ['invoice', 'tax invoice', 'invoice no', 'invoice number', 'invoice #', 'commercial invoice'],
      indices: ['amount due', 'total due', 'balance due', 'due date', 'subtotal', 'vat', 'sales tax', 'unit price', 'qty', 'payment terms', 'bill to', 'net 30'],
    },
    devis: {
      forts: ['quote', 'quotation', 'estimate', 'quote no', 'quote number', 'price quote'],
      indices: ['valid until', 'valid for', 'acceptance', 'accepted by', 'subtotal', 'vat', 'unit price', 'qty', 'deposit'],
    },
    contrat: {
      forts: ['contract', 'agreement', 'lease', 'tenancy agreement', 'employment contract', 'this agreement'],
      indices: ['the parties', 'party', 'hereinafter', 'whereas', 'clause', 'termination', 'governing law', 'effective date', 'landlord', 'tenant', 'employer', 'employee', 'in witness whereof'],
    },
    billet: {
      forts: ['ticket', 'e-ticket', 'train ticket', 'bus ticket', 'travel ticket'],
      indices: ['passenger', 'traveller', 'traveler', 'outbound', 'return', 'train', 'coach', 'platform', 'departure', 'arrival', 'booking reference', 'fare', 'class'],
    },
    "carte d'embarquement": {
      forts: ['boarding pass'],
      indices: ['gate', 'boarding', 'boarding time', 'seat', 'flight', 'passenger', 'zone', 'group', 'terminal', 'gate closes', 'sequence'],
    },
    'relevé bancaire': {
      forts: ['bank statement', 'account statement', 'statement of account'],
      indices: ['opening balance', 'closing balance', 'balance', 'debit', 'credit', 'transactions', 'statement period', 'sort code', 'direct debit', 'paid in', 'paid out', 'account holder'],
    },
    ordonnance: {
      forts: ['prescription', 'medical prescription'],
      indices: ['dosage', 'tablet', 'tablets', 'capsule', 'capsules', 'mg', 'times a day', 'twice daily', 'once daily', 'doctor', 'pharmacy', 'pharmacist', 'refill', 'refills', 'syrup'],
    },
    formulaire: {
      forts: ['application form', 'registration form', 'claim form'],
      indices: ['form', 'please complete', 'fill in', 'tick', 'tick the box', 'block capitals', 'first name', 'surname', 'last name', 'date of birth', 'place of birth', 'for office use only'],
    },
    'courrier administratif': {
      forts: ['dear sir or madam', 'dear sir/madam', 'yours faithfully', 'yours sincerely', 're:', 'subject:', 'we are writing to inform you'],
      indices: ['your reference', 'our reference', 'department', 'council', 'agency', 'ministry', 'administration', 'enclosed', 'sincerely', 'to whom it may concern'],
    },
    CV: {
      forts: ['curriculum vitae', 'cv'],
      indices: ['work experience', 'professional experience', 'education', 'skills', 'languages', 'interests', 'references available', 'qualifications', 'employment history', 'hobbies'],
    },
  },
  emetteur: ['from:', 'issued by', 'seller', 'supplier', 'vendor', 'sender'],
  destinataire: ['to:', 'bill to', 'billed to', 'invoice to', 'customer', 'client', 'recipient', 'attention', 'attn', 'passenger name', 'passenger', 'account holder', 'patient'],
  references: {
    facture: ['invoice no', 'invoice number', 'invoice #', 'invoice'],
    devis: ['quote no', 'quote number', 'quotation no', 'quotation number', 'estimate no', 'quote', 'quotation'],
    contrat: ['contract no', 'contract number', 'agreement no', 'agreement number'],
    réservation: ['booking reference', 'booking ref', 'booking no', 'booking number', 'reservation number', 'reservation no', 'confirmation number', 'pnr'],
    client: ['customer no', 'customer number', 'customer id', 'client no'],
    commande: ['order no', 'order number', 'order #', 'po number', 'purchase order'],
    vol: ['flight no', 'flight number', 'flight'],
    dossier: ['our ref', 'your ref', 'our reference', 'your reference', 'case number', 'file number', 'reference', 'ref'],
  },
  dates: {
    echeance: ['due date', 'payment due', 'due by', 'pay by', 'payable by', 'due on'],
    validite: ['valid until', 'valid till', 'expiry date', 'expires on', 'expiration date', 'offer valid until'],
    voyage: ['departure', 'arrival', 'departs', 'arrives', 'travel date', 'date of travel', 'outbound', 'return', 'flight date', 'boarding'],
    emission: ['invoice date', 'date of issue', 'issue date', 'issued on', 'quote date', 'statement date'],
    generiques: ['date'],
  },
  montants: {
    ttc: ['total incl. vat', 'total including vat', 'total inc vat', 'total incl vat', 'gross total'],
    ht: ['subtotal', 'sub-total', 'net amount', 'total excl. vat', 'total excluding vat', 'total excl vat', 'net total'],
    tva: ['vat', 'sales tax', 'gst', '^tax'],
    total: ['amount due', 'total due', 'balance due', 'grand total', 'total amount', 'amount payable', 'total'],
    horsLignes: ['deposit paid', 'amount paid', 'share capital'],
  },
  regle: ['^paid', 'paid in full', 'paid by', 'paid on', 'paid with', 'status: paid', 'payment received', 'amount paid', 'deposit paid', 'credit note'],
  boutons: {
    'convertir-word': 'Convert to Word',
    'convertir-pdf': 'Convert to PDF',
    'extraire-tableau': 'Extract as a table',
    'ajouter-echeance': 'Add the due date to the calendar',
    'preparer-paiement': 'Prepare the payment (to be approved)',
  },
};
