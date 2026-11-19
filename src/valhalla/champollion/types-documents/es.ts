// Espagnol : indices pour reconnaître un document déposé et en lire les données (voir forme.ts).
import type { DonneesLangue } from './forme.ts';

export const es: DonneesLangue = {
  mots: ['el', 'la', 'los', 'las', 'de', 'del', 'y', 'que', 'en', 'un', 'una', 'por', 'para', 'con', 'su', 'sus', 'es', 'se', 'al', 'usted', 'le'],
  types: {
    facture: {
      forts: ['factura', 'factura n.º', 'factura nº', 'factura no', 'número de factura', 'nº de factura', 'factura simplificada'],
      indices: ['total a pagar', 'importe total', 'base imponible', 'iva', 'fecha de vencimiento', 'vencimiento', 'precio unitario', 'cantidad', 'concepto', 'forma de pago', 'nif', 'cif'],
    },
    devis: {
      forts: ['presupuesto', 'presupuesto n.º', 'número de presupuesto', 'cotización'],
      indices: ['válido hasta', 'validez', 'aceptación', 'conforme', 'base imponible', 'iva', 'precio unitario', 'cantidad', 'concepto', 'anticipo'],
    },
    contrat: {
      forts: ['contrato', 'contrato de arrendamiento', 'contrato de trabajo', 'reunidos'],
      indices: ['cláusula', 'cláusulas', 'las partes', 'en adelante', 'arrendador', 'arrendatario', 'empleador', 'trabajador', 'duración', 'rescisión', 'firmado', 'y para que conste'],
    },
    billet: {
      forts: ['billete', 'billete electrónico', 'e-billete'],
      indices: ['viajero', 'pasajero', 'ida', 'vuelta', 'tren', 'coche', 'plaza', 'salida', 'llegada', 'localizador', 'código de reserva', 'tarifa', 'clase', 'andén', 'autobús'],
    },
    "carte d'embarquement": {
      forts: ['tarjeta de embarque', 'pase de abordar', 'pase de abordaje'],
      indices: ['puerta', 'embarque', 'hora de embarque', 'asiento', 'vuelo', 'pasajero', 'zona', 'grupo', 'terminal'],
    },
    'relevé bancaire': {
      forts: ['extracto bancario', 'extracto de cuenta', 'extracto de movimientos', 'estado de cuenta'],
      indices: ['saldo', 'saldo anterior', 'saldo final', 'saldo inicial', 'cargo', 'abono', 'movimientos', 'titular', 'periodo', 'transferencia', 'domiciliación'],
    },
    ordonnance: {
      forts: ['receta médica', 'prescripción médica'],
      indices: ['receta', 'posología', 'comprimido', 'comprimidos', 'cápsula', 'cápsulas', 'mg', 'veces al día', 'médico', 'farmacia', 'jarabe', 'tratamiento'],
    },
    formulaire: {
      forts: ['formulario', 'impreso de solicitud', 'solicitud'],
      indices: ['rellene', 'cumplimente', 'marque', 'marque con una x', 'nombre', 'apellidos', 'fecha de nacimiento', 'lugar de nacimiento', 'domicilio', 'en mayúsculas', 'a rellenar por la administración', 'documentación a aportar'],
    },
    'courrier administratif': {
      forts: ['estimado señor', 'estimada señora', 'estimados señores', 'estimado/a señor/a', 'muy señor mío', 'asunto:', 'atentamente', 'le comunicamos', 'por medio de la presente'],
      indices: ['su referencia', 'nuestra referencia', 'ayuntamiento', 'ministerio', 'agencia tributaria', 'administración', 'delegación', 'expediente', 'saludos cordiales', 'un cordial saludo', 'adjunto'],
    },
    CV: {
      forts: ['curriculum vitae', 'currículum vítae', 'currículum', 'cv'],
      indices: ['experiencia laboral', 'experiencia profesional', 'formación', 'formación académica', 'habilidades', 'competencias', 'idiomas', 'intereses', 'datos personales', 'perfil'],
    },
  },
  emetteur: ['emisor', 'proveedor', 'vendedor', 'de:', 'remitente', 'emitido por'],
  destinataire: ['cliente', 'destinatario', 'para:', 'facturar a', 'a la atención de', 'nombre del pasajero', 'pasajero', 'viajero', 'titular', 'paciente'],
  references: {
    facture: ['factura n.º', 'factura nº', 'factura no', 'número de factura', 'nº de factura', 'n.º de factura', 'factura'],
    devis: ['presupuesto n.º', 'presupuesto nº', 'número de presupuesto', 'presupuesto'],
    contrat: ['contrato n.º', 'contrato nº', 'número de contrato'],
    réservation: ['localizador', 'código de reserva', 'número de reserva', 'referencia de reserva', 'reserva', 'pnr'],
    client: ['número de cliente', 'nº de cliente', 'n.º de cliente', 'cliente nº'],
    commande: ['número de pedido', 'nº de pedido', 'pedido'],
    vol: ['nº de vuelo', 'número de vuelo', 'vuelo'],
    dossier: ['nº de expediente', 'expediente', 'su referencia', 'nuestra referencia', 'referencia', 'ref.'],
  },
  dates: {
    echeance: ['fecha de vencimiento', 'vencimiento', 'pagar antes del', 'fecha límite de pago', 'a pagar el', 'fecha límite'],
    validite: ['válido hasta', 'validez hasta', 'fecha de caducidad', 'caduca el', 'vigencia'],
    voyage: ['salida', 'llegada', 'fecha de viaje', 'ida', 'vuelta', 'embarque', 'fecha del vuelo'],
    emission: ['fecha de emisión', 'fecha de factura', 'fecha del presupuesto', 'fecha de expedición', 'emitido el', 'fecha del extracto'],
    generiques: ['fecha'],
  },
  montants: {
    ttc: ['total iva incluido', 'total con iva', 'importe total iva incluido', 'total (iva incl.)'],
    ht: ['base imponible', 'subtotal', 'importe neto', 'total sin iva'],
    tva: ['iva', 'cuota de iva', '^impuesto'],
    total: ['total a pagar', 'importe total', 'importe a pagar', 'total factura', 'total'],
    horsLignes: ['anticipo', 'entregado a cuenta', 'capital social'],
  },
  regle: ['^pagado', '^pagada', 'factura pagada', 'pagado el', 'pagada el', 'pagado con', 'pagada con', 'cobrado', 'cobrada', 'ya pagado', 'importe pagado', 'entregado a cuenta', 'nota de crédito', 'factura rectificativa'],
  boutons: {
    'convertir-word': 'Convertir a Word',
    'convertir-pdf': 'Convertir a PDF',
    'extraire-tableau': 'Extraer en tabla',
    'ajouter-echeance': 'Añadir el vencimiento al calendario',
    'preparer-paiement': 'Preparar el pago (por validar)',
  },
};
