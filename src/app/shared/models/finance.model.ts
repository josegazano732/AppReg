export interface RegistroConceptoDetalle {
  concepto: string;
  monto: number;
}

export interface RegistroPagoDetalle {
  medioPago: string;
  monto: number;
  nroOperacion?: string;
  nroCuit?: string;
  fechaTransferencia?: string;
}

export interface Registro {
  id: string;
  createdAt: string;
  updatedAt?: string;
  fecha?: string;
  nroRecibo: string;
  nombre: string;
  subtotal: number;
  sellados: number;
  muni: number;
  sugIT: number;
  patente: number;
  antecedentesPenales: number;
  cheques: number;
  posnet: number;
  vep: number;
  site: number;
  deposito: number;
  efectivo: number;
  pagaCon?: string;
  cambio?: number;
  observacion?: string;
  concepto?: string;
  conceptoMonto?: number;
  medioPago?: string;
  conceptosDetalle?: RegistroConceptoDetalle[];
  pagosDetalle?: RegistroPagoDetalle[];
}

export interface TotalesMedioPago {
  efectivo: number;
  cheques: number;
  posnet: number;
  deposito: number;
  otros?: Record<string, number>;
}

export interface Billete {
  valor: number;
  cantidad: number;
  subtotal: number;
}

export interface Gasto {
  id?: string;
  fecha?: string;
  tipoEgreso?: string;
  medioPago?: string;
  descripcion: string;
  monto: number;
  observacion?: string;
  comprobante?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface IngresoCaja {
  id?: string;
  fecha?: string;
  tipoIngreso?: string;
  medioPago?: string;
  concepto: string;
  monto: number;
  observacion?: string;
  comprobante?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CierreResumen {
  totalArancelesAuto: number;
  totalSelladoAuto: number;
  totalFormularios: number;
  totalArancelesMoto: number;
  totalesMedioPago: TotalesMedioPago;
  gastos: Gasto[];
  totalGastos: number;
  totalIngresos: number;
  totalFinalNeto: number;
}

export interface CierreCaja {
  id: string;
  fecha: string;
  createdAt: string;
  updatedAt?: string;
  totalIngresos: number;
  totalGastos: number;
  totalNeto: number;
  detalleMedios?: {
    medioPago: string;
    ingresos: number;
    egresos: number;
    saldo: number;
  }[];
  saldo: {
    efectivo: number;
    cheques: number;
    posnet: number;
    deposito: number;
  };
  disponibleContinuidad: number;
  observacion?: string;
  referencias: {
    registroIds: string[];
    ingresoIds: string[];
    egresoIds: string[];
  };
  resumenMovimientos: {
    registros: number;
    ingresos: number;
    egresos: number;
  };
}

export interface MovimientoBancario {
  id: string;
  importKey?: string;
  fecha: string;
  createdAt: string;
  updatedAt?: string;
  primeraImportacionAt?: string;
  ultimaImportacionAt?: string;
  importBatchId?: string;
  vecesImportado?: number;
  banco?: string;
  cuenta?: string;
  descripcion: string;
  monto: number;
  tipo: 'CREDITO' | 'DEBITO';
  nroOperacion?: string;
  referenciaExterna?: string;
  origenImportacion?: string;
  conciliacionEstado?: 'PENDIENTE' | 'CONCILIADO' | 'REVISAR';
  conciliadoRegistroId?: string;
  conciliadoPagoOrden?: number;
  conciliadoAt?: string;
  conciliacionProceso?: 'ABIERTO' | 'CERRADO';
  conciliacionCerradaAt?: string;
  conciliacionCerradaObservacion?: string;
}

export interface ConciliacionBancariaHistorial {
  id: string;
  movimientoId: string;
  movimientoImportKey?: string;
  evento:
    | 'IMPORTADO'
    | 'REIMPORTADO'
    | 'CONCILIACION_AUTOMATICA'
    | 'CONCILIACION_MANUAL'
    | 'LIBERACION'
    | 'CIERRE_PROCESO'
    | 'REAPERTURA_PROCESO'
    | 'ELIMINACION';
  createdAt: string;
  registroId?: string;
  ordenPago?: number;
  observacion?: string;
  movimientoFecha: string;
  movimientoDescripcion: string;
  movimientoMonto: number;
  movimientoTipo: 'CREDITO' | 'DEBITO';
  movimientoNroOperacion?: string;
  movimientoCuitDetectado?: string;
  movimientoBanco?: string;
  movimientoCuenta?: string;
  payload?: Record<string, unknown>;
}

export interface ConfiguracionCaja {
  conceptos: string[];
  mediosPago: string[];
  tiposSalida: string[];
  tiposIngreso: string[];
}
