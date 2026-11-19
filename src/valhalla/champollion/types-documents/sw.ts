// Swahili : indices pour reconnaître un document déposé et en lire les données (voir forme.ts).
import type { DonneesLangue } from './forme.ts';

export const sw: DonneesLangue = {
  mots: ['ya', 'na', 'wa', 'kwa', 'la', 'za', 'katika', 'ni', 'hii', 'hiyo', 'kutoka', 'au', 'tafadhali', 'kama', 'huu', 'yako', 'wako', 'cha', 'vya'],
  types: {
    facture: {
      forts: ['ankara', 'ankara ya kodi', 'namba ya ankara', 'hati ya madai'],
      indices: ['jumla', 'jumla kuu', 'kiasi kinachodaiwa', 'kodi ya ongezeko la thamani', 'tarehe ya mwisho ya kulipa', 'bei ya kimoja', 'idadi', 'maelezo', 'jumla ndogo', 'lipa kabla ya'],
    },
    devis: {
      forts: ['nukuu', 'nukuu ya bei', 'makadirio', 'makadirio ya gharama', 'namba ya nukuu'],
      indices: ['halali hadi', 'inadumu hadi', 'idhini', 'jumla ndogo', 'bei ya kimoja', 'idadi', 'maelezo', 'malipo ya awali'],
    },
    contrat: {
      forts: ['mkataba', 'mkataba wa kazi', 'mkataba wa pango', 'makubaliano'],
      indices: ['pande zote', 'upande wa kwanza', 'upande wa pili', 'kifungu', 'vifungu', 'muda wa mkataba', 'kusitisha', 'mwenye nyumba', 'mpangaji', 'mwajiri', 'mwajiriwa', 'mashahidi'],
    },
    billet: {
      forts: ['tiketi', 'tiketi ya treni', 'tiketi ya basi', 'tiketi ya kielektroniki'],
      indices: ['msafiri', 'abiria', 'kwenda', 'kurudi', 'treni', 'basi', 'kiti', 'kuondoka', 'kuwasili', 'namba ya uhifadhi', 'daraja', 'nauli', 'stendi'],
    },
    "carte d'embarquement": {
      forts: ['pasi ya kupanda', 'kadi ya kupanda ndege', 'kadi ya kupanda'],
      indices: ['lango', 'kupanda', 'muda wa kupanda', 'kiti', 'ndege', 'safari ya ndege', 'abiria', 'kundi', 'eneo', 'terminal'],
    },
    'relevé bancaire': {
      forts: ['taarifa ya benki', 'taarifa ya akaunti', 'taarifa ya akaunti ya benki'],
      indices: ['salio', 'salio la mwanzo', 'salio la mwisho', 'salio la kufunga', 'debiti', 'kredit', 'miamala', 'muamala', 'mwenye akaunti', 'kipindi', 'uhamisho'],
    },
    ordonnance: {
      forts: ['maagizo ya dawa', 'agizo la dawa', 'maagizo ya daktari'],
      indices: ['kipimo', 'vidonge', 'kidonge', 'kapsuli', 'mg', 'mara mbili kwa siku', 'mara tatu kwa siku', 'mara moja kwa siku', 'daktari', 'dkt', 'duka la dawa', 'famasia', 'sharubati'],
    },
    formulaire: {
      forts: ['fomu', 'fomu ya maombi', 'fomu ya usajili'],
      indices: ['jaza', 'tafadhali jaza', 'weka alama', 'jina la kwanza', 'jina la ukoo', 'tarehe ya kuzaliwa', 'mahali pa kuzaliwa', 'anwani', 'kwa herufi kubwa', 'kwa matumizi ya ofisi', 'viambatisho'],
    },
    'courrier administratif': {
      forts: ['kumb:', 'yah:', 'wako mwaminifu', 'wako katika ujenzi wa taifa', 'tunapenda kukujulisha'],
      indices: ['ndugu', 'wizara', 'halmashauri', 'idara', 'mamlaka', 'kumbukumbu', 'barua', 'nakala', 'kiambatisho', 'kwa heshima'],
    },
    CV: {
      forts: ['wasifu', 'wasifu binafsi', 'cv', 'curriculum vitae'],
      indices: ['uzoefu wa kazi', 'elimu', 'ujuzi', 'lugha', 'mambo ninayopenda', 'taarifa binafsi', 'sifa', 'vyeti', 'marejeo'],
    },
  },
  emetteur: ['kutoka:', 'muuzaji', 'msambazaji', 'imetolewa na', 'mtoaji'],
  destinataire: ['kwa:', 'mteja', 'mpokeaji', 'jina la abiria', 'abiria', 'msafiri', 'mwenye akaunti', 'mgonjwa', 'ankara kwa'],
  references: {
    facture: ['namba ya ankara', 'ankara na', 'ankara namba', 'ankara'],
    devis: ['namba ya nukuu', 'nukuu na', 'nukuu'],
    contrat: ['namba ya mkataba', 'mkataba na'],
    réservation: ['namba ya uhifadhi', 'kumbukumbu ya uhifadhi'],
    client: ['namba ya mteja'],
    commande: ['namba ya oda', 'oda na'],
    vol: ['namba ya ndege', 'safari ya ndege', 'ndege'],
    dossier: ['kumbukumbu na', 'kumbukumbu', 'kumb', 'namba ya faili'],
  },
  dates: {
    echeance: ['tarehe ya mwisho ya kulipa', 'lipa kabla ya', 'tarehe ya kulipa', 'mwisho wa kulipa'],
    validite: ['halali hadi', 'inadumu hadi', 'tarehe ya kuisha', 'muda wake unaisha'],
    voyage: ['kuondoka', 'kuwasili', 'tarehe ya safari', 'safari', 'kwenda', 'kurudi', 'kupanda'],
    emission: ['tarehe ya ankara', 'tarehe ya kutolewa', 'tarehe ya nukuu', 'tarehe ya taarifa'],
    generiques: ['tarehe'],
  },
  montants: {
    ttc: ['jumla pamoja na kodi', 'jumla ikijumuisha vat', 'jumla pamoja na vat'],
    ht: ['jumla ndogo', 'kabla ya kodi', 'jumla bila kodi'],
    tva: ['kodi ya ongezeko la thamani', 'vat', '^kodi'],
    total: ['kiasi kinachodaiwa', 'jumla kuu', 'jumla ya kulipa', 'kiasi cha kulipa', 'jumla'],
    horsLignes: ['malipo ya awali', 'kilicholipwa', 'mtaji'],
  },
  mois: [['januari'], ['februari'], ['machi'], ['aprili'], ['mei'], ['juni'], ['julai'], ['agosti'], ['septemba'], ['oktoba'], ['novemba'], ['desemba']],
  regle: ['imelipwa', 'imelipiwa', 'malipo yamepokelewa', 'tumepokea malipo', 'kilicholipwa', 'hati ya mkopo'],
  boutons: {
    'convertir-word': 'Badilisha kuwa Word',
    'convertir-pdf': 'Badilisha kuwa PDF',
    'extraire-tableau': 'Toa kama jedwali',
    'ajouter-echeance': 'Ongeza tarehe ya mwisho kwenye kalenda',
    'preparer-paiement': 'Andaa malipo (yanasubiri idhini)',
  },
};
