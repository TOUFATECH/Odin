// Français : indices pour reconnaître un document déposé et en lire les données (voir forme.ts).
import type { DonneesLangue } from './forme.ts';

export const fr: DonneesLangue = {
  mots: ['le', 'la', 'les', 'de', 'des', 'du', 'et', 'est', 'une', 'pour', 'vous', 'nous', 'avec', 'sur', 'dans', 'au', 'aux', 'par', 'votre', 'vos', 'ce', 'cette', 'qui', 'que', 'à'],
  types: {
    facture: {
      forts: ['facture', 'facture n°', 'facture no', 'n° de facture', 'numéro de facture', 'facture acquittée'],
      indices: ['total ttc', 'total ht', 'montant ttc', 'montant ht', 'tva', 'net à payer', "date d'échéance", 'échéance', 'à payer avant', 'conditions de paiement', 'prix unitaire', 'désignation', 'siret'],
    },
    devis: {
      forts: ['devis', 'devis n°', 'numéro de devis', 'offre de prix', 'proposition commerciale'],
      indices: ['bon pour accord', "valable jusqu'au", "validité de l'offre", 'durée de validité', 'total ttc', 'total ht', 'tva', 'prix unitaire', 'désignation', 'acompte'],
    },
    contrat: {
      forts: ['contrat', 'contrat de travail', 'contrat de location', 'bail', 'entre les soussignés', 'le présent contrat'],
      indices: ['article', 'les parties', 'ci-après dénommé', 'ci-après', 'clause', 'résiliation', 'durée du contrat', 'prend effet', 'fait en deux exemplaires', 'lu et approuvé', 'le bailleur', 'le locataire', "l'employeur", 'le salarié'],
    },
    billet: {
      forts: ['billet', 'e-billet', 'billet électronique', 'titre de transport'],
      indices: ['voyageur', 'passager', 'aller', 'retour', 'train', 'voiture', 'place', 'départ', 'arrivée', 'référence de réservation', 'classe', 'tarif', 'quai', 'car'],
    },
    "carte d'embarquement": {
      forts: ["carte d'embarquement", 'boarding pass'],
      indices: ['porte', 'embarquement', "heure d'embarquement", 'siège', 'vol', 'passager', 'zone', 'terminal', "fin d'embarquement"],
    },
    'relevé bancaire': {
      forts: ['relevé de compte', 'relevé bancaire', 'extrait de compte'],
      indices: ['solde', 'solde créditeur', 'solde débiteur', 'ancien solde', 'nouveau solde', 'débit', 'crédit', 'opérations', 'date de valeur', 'titulaire du compte', 'virement', 'prélèvement'],
    },
    ordonnance: {
      forts: ['ordonnance', 'ordonnance médicale'],
      indices: ['posologie', 'comprimé', 'comprimés', 'gélule', 'gélules', 'mg', 'fois par jour', 'docteur', 'médecin', 'à renouveler', 'sirop', 'qsp'],
    },
    formulaire: {
      forts: ['formulaire', 'cerfa'],
      indices: ['à remplir', 'à compléter', 'cochez', 'cochez la case', 'nom :', 'prénom :', 'date de naissance', 'lieu de naissance', 'adresse :', 'en majuscules', "réservé à l'administration", 'pièces à joindre'],
    },
    'courrier administratif': {
      forts: ['madame, monsieur', 'objet :', 'veuillez agréer', 'nous vous informons', "je vous prie d'agréer"],
      indices: ['vos références', 'nos références', 'dossier suivi par', "à l'attention de", 'préfecture', 'mairie', 'caisse', 'ministère', 'administration', 'impôts', 'cordialement', 'pièce jointe'],
    },
    CV: {
      forts: ['curriculum vitae', 'cv'],
      indices: ['expérience professionnelle', 'expériences professionnelles', 'formation', 'compétences', 'langues', "centres d'intérêt", 'diplômes', 'stage', 'loisirs'],
    },
  },
  emetteur: ['émetteur', 'fournisseur', 'vendeur', 'prestataire', 'émis par', 'expéditeur', 'de :'],
  destinataire: ['destinataire', 'client', 'facturé à', 'adressé à', "à l'attention de", 'à :', 'passager', 'nom du passager', 'voyageur', 'titulaire du compte', 'titulaire', 'patient'],
  references: {
    facture: ['facture n°', 'facture no', 'n° de facture', 'numéro de facture', 'facture'],
    devis: ['devis n°', 'devis no', 'n° de devis', 'numéro de devis', 'devis'],
    contrat: ['contrat n°', 'n° de contrat', 'numéro de contrat', 'référence du contrat'],
    réservation: ['référence de réservation', 'réservation n°', 'n° de réservation', 'numéro de réservation', 'code de réservation', 'référence dossier', 'pnr'],
    client: ['n° client', 'numéro client', 'numéro de client', 'référence client', 'réf. client'],
    commande: ['commande n°', 'n° de commande', 'numéro de commande', 'bon de commande'],
    vol: ['n° de vol', 'numéro de vol', 'vol'],
    dossier: ['dossier n°', 'n° de dossier', 'numéro de dossier', 'vos références', 'nos références', 'référence', 'réf.'],
  },
  dates: {
    echeance: ["date d'échéance", 'échéance', 'à payer avant le', 'à régler avant le', 'à payer le', 'date limite de paiement', 'payable le', 'au plus tard le', 'date limite'],
    validite: ["valable jusqu'au", "valable jusqu'à", 'date de validité', 'validité', 'expire le', "date d'expiration"],
    voyage: ['départ', 'arrivée', 'date du voyage', 'date de départ', "date d'arrivée", 'aller', 'retour', 'embarquement', 'vol du'],
    emission: ['date de facture', "date d'émission", 'date de la facture', 'émis le', 'établi le', 'fait le', 'date du devis', 'date du relevé'],
    generiques: ['date'],
  },
  montants: {
    ttc: ['total ttc', 'montant ttc', 'net à payer ttc', 'total t.t.c.', '^ttc'],
    ht: ['total ht', 'montant ht', 'sous-total', 'sous total', 'total h.t.', '^ht'],
    tva: ['tva', 'montant tva', 'total tva'],
    total: ['total à payer', 'net à payer', 'montant dû', 'reste à payer', 'montant total', 'solde dû', 'total'],
    horsLignes: ['acompte', 'déjà réglé', 'déjà payé', 'capital social', 'capital de'],
  },
  regle: ['facture acquittée', 'acquittée', 'acquitté', 'pour acquit', '^payé', '^payée', 'payé le', 'payée le', 'payé par', 'payée par', '^réglé', '^réglée', 'réglé le', 'réglée le', 'réglé par', 'réglée par', 'déjà réglé', 'déjà payé', 'acompte versé', 'acompte reçu', "facture d'avoir", 'avoir n°', 'note de crédit'],
  boutons: {
    'convertir-word': 'Convertir en Word',
    'convertir-pdf': 'Convertir en PDF',
    'extraire-tableau': 'Extraire en tableau',
    'ajouter-echeance': "Ajouter l'échéance au calendrier",
    'preparer-paiement': 'Préparer le paiement (à valider)',
  },
};
