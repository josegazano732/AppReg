import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { SyncCollectionRepository } from '../repositories/sync-collection.repository';
import { LoggerService } from './logger.service';
import { SupabaseService } from './supabase.service';
import { CajaService } from './caja.service';
import { MovimientoBancario, Registro, RegistroPagoDetalle } from '../../shared/models/finance.model';

interface PagoTransferenciaCandidato {
  registroId: string;
  fecha: string;
  nroRecibo: string;
  nombre: string;
  ordenPago: number;
  medioPago: string;
  monto: number;
  nroOperacion: string;
}

export interface OpcionConciliacionManual extends PagoTransferenciaCandidato {
  motivoManual: string;
  prioridadManual: number;
}

export interface ResultadoConciliacionBancaria {
  movimiento: MovimientoBancario;
  candidato?: PagoTransferenciaCandidato;
  motivo: string;
  origenConciliacion?: 'AUTOMATICA' | 'MANUAL';
}

@Injectable({ providedIn: 'root' })
export class ConciliacionBancariaService {
  private readonly STORAGE_KEY = 'appreg.movimientos-bancarios';
  private readonly TABLE = 'movimientos_bancarios';

  private readonly repository: SyncCollectionRepository<MovimientoBancario>;
  private movimientos$ = new BehaviorSubject<MovimientoBancario[]>([]);
  movimientos = this.movimientos$.asObservable();

  constructor(
    private supabase: SupabaseService,
    private logger: LoggerService,
    private caja: CajaService
  ) {
    this.repository = new SyncCollectionRepository<MovimientoBancario>({
      storageKey: this.STORAGE_KEY,
      table: this.TABLE,
      conflictKey: 'id',
      orderBy: 'fecha',
      normalizeList: list => this.normalizeMovimientos(list),
      supabase: this.supabase,
      logger: this.logger
    });

    this.movimientos$.next(this.repository.loadLocal());
    this.hydrateFromSupabase();
    this.conciliarAutomaticamente();
  }

  getMovimientosSnapshot(): MovimientoBancario[] {
    return this.movimientos$.getValue();
  }

  updateMovimientos(list: MovimientoBancario[]) {
    const safe = this.repository.save(list || []);
    this.movimientos$.next(safe);
  }

  importMovimientos(list: Array<Omit<MovimientoBancario, 'id' | 'createdAt' | 'updatedAt' | 'conciliacionEstado' | 'conciliadoRegistroId' | 'conciliadoPagoOrden' | 'conciliadoAt' | 'conciliacionProceso' | 'conciliacionCerradaAt' | 'conciliacionCerradaObservacion'>>) {
    const current = this.getMovimientosSnapshot();
    const imported = (list || []).map(item => {
      const createdAt = new Date().toISOString();
      return {
        ...item,
        id: crypto.randomUUID(),
        createdAt,
        updatedAt: createdAt,
        conciliacionEstado: 'PENDIENTE' as const,
        conciliadoRegistroId: undefined,
        conciliadoPagoOrden: undefined,
        conciliadoAt: undefined,
        conciliacionProceso: 'ABIERTO' as const,
        conciliacionCerradaAt: undefined,
        conciliacionCerradaObservacion: undefined
      };
    });

    this.updateMovimientos([...current, ...imported]);
    this.conciliarAutomaticamente();
  }

  removeMovimiento(id: string) {
    this.updateMovimientos(this.getMovimientosSnapshot().filter(item => item.id !== id));
  }

  async clearAllData() {
    await this.repository.clear({ column: 'id', operator: 'neq', value: '' });
    this.movimientos$.next([]);
  }

  aplicarConciliacionManual(movimientoId: string, registroId: string, ordenPago: number) {
    const candidatos = this.buildCandidatosTransferencia();
    const candidato = candidatos.find(item => item.registroId === registroId && item.ordenPago === ordenPago);
    if (!candidato) {
      throw new Error('El pago seleccionado ya no existe para conciliacion manual.');
    }

    const now = new Date().toISOString();
    const next = this.getMovimientosSnapshot().map(item => {
      if (item.id !== movimientoId) {
        return item;
      }

      return {
        ...item,
        conciliacionEstado: 'CONCILIADO' as const,
        conciliadoRegistroId: candidato.registroId,
        conciliadoPagoOrden: candidato.ordenPago,
        conciliadoAt: now,
        ...this.buildProcesoAbiertoPatch(),
        updatedAt: now
      };
    });

    this.updateMovimientos(next);
    this.conciliarAutomaticamente();
  }

  liberarConciliacion(movimientoId: string) {
    const now = new Date().toISOString();
    const next = this.getMovimientosSnapshot().map(item => {
      if (item.id !== movimientoId) {
        return item;
      }

      return {
        ...item,
        conciliacionEstado: 'PENDIENTE' as const,
        conciliadoRegistroId: undefined,
        conciliadoPagoOrden: undefined,
        conciliadoAt: undefined,
        ...this.buildProcesoAbiertoPatch(),
        updatedAt: now
      };
    });

    this.updateMovimientos(next);
    this.conciliarAutomaticamente();
  }

  cerrarProcesoConciliacion(movimientoId: string, observacion?: string) {
    const movimiento = this.getMovimientosSnapshot().find(item => item.id === movimientoId);
    if (!movimiento) {
      throw new Error('El movimiento ya no existe.');
    }

    if (movimiento.conciliacionEstado !== 'CONCILIADO' || !movimiento.conciliadoRegistroId || !movimiento.conciliadoPagoOrden) {
      throw new Error('Solo puedes cerrar procesos de movimientos ya conciliados.');
    }

    const now = new Date().toISOString();
    const nota = String(observacion || '').trim() || undefined;
    const next = this.getMovimientosSnapshot().map(item => {
      if (item.id !== movimientoId) {
        return item;
      }

      return {
        ...item,
        conciliacionProceso: 'CERRADO' as const,
        conciliacionCerradaAt: now,
        conciliacionCerradaObservacion: nota,
        updatedAt: now
      };
    });

    this.updateMovimientos(next);
    this.conciliarAutomaticamente();
  }

  reabrirProcesoConciliacion(movimientoId: string) {
    const now = new Date().toISOString();
    const next = this.getMovimientosSnapshot().map(item => {
      if (item.id !== movimientoId) {
        return item;
      }

      return {
        ...item,
        ...this.buildProcesoAbiertoPatch(),
        updatedAt: now
      };
    });

    this.updateMovimientos(next);
    this.conciliarAutomaticamente();
  }

  buildOpcionesManuales(movimientoId: string): OpcionConciliacionManual[] {
    const movimiento = this.getMovimientosSnapshot().find(item => item.id === movimientoId);
    if (!movimiento) {
      return [];
    }

    const assignedKeys = new Set(
      this.getMovimientosSnapshot()
        .filter(item => item.id !== movimientoId && item.conciliacionEstado === 'CONCILIADO' && item.conciliadoRegistroId && item.conciliadoPagoOrden)
        .map(item => `${item.conciliadoRegistroId}-${item.conciliadoPagoOrden}`)
    );

    return this.buildCandidatosTransferencia()
      .filter(item => !assignedKeys.has(this.candidateKey(item)))
      .map(item => this.buildManualOption(movimiento, item))
      .filter((item): item is OpcionConciliacionManual => Boolean(item))
      .sort((a, b) => {
        const byPriority = b.prioridadManual - a.prioridadManual;
        if (byPriority !== 0) {
          return byPriority;
        }

        return a.fecha.localeCompare(b.fecha);
      });
  }

  conciliarAutomaticamente() {
    const movimientos = this.getMovimientosSnapshot();
    const candidatos = this.buildCandidatosTransferencia();
    const candidatosUsados = new Set<string>();
    let changed = false;

    const next = [...movimientos]
      .sort((a, b) => this.compareMovimientosAsc(a, b))
      .map(movimiento => {
        const resultado = this.resolverConciliacionMovimiento(movimiento, candidatos, candidatosUsados);
        const current = {
          estado: movimiento.conciliacionEstado || 'PENDIENTE',
          registroId: movimiento.conciliadoRegistroId || '',
          pagoOrden: Number(movimiento.conciliadoPagoOrden || 0),
          motivo: ''
        };

        const nextEstado = resultado.movimiento.conciliacionEstado || 'PENDIENTE';
        const nextRegistroId = resultado.movimiento.conciliadoRegistroId || '';
        const nextPagoOrden = Number(resultado.movimiento.conciliadoPagoOrden || 0);

        if (current.estado !== nextEstado || current.registroId !== nextRegistroId || current.pagoOrden !== nextPagoOrden) {
          changed = true;
        }

        return resultado.movimiento;
      });

    if (changed) {
      this.updateMovimientos(next);
    } else {
      this.movimientos$.next(this.normalizeMovimientos(next));
    }
  }

  buildResultados(): ResultadoConciliacionBancaria[] {
    const registrosById = new Map(this.caja.getRegistrosSnapshot().map(item => [item.id, item]));
    return this.getMovimientosSnapshot()
      .map(movimiento => {
        const registro = movimiento.conciliadoRegistroId ? registrosById.get(movimiento.conciliadoRegistroId) : undefined;
        const candidato = registro && movimiento.conciliadoPagoOrden
          ? this.buildCandidatosTransferencia().find(item => item.registroId === registro.id && item.ordenPago === movimiento.conciliadoPagoOrden)
          : undefined;

        return {
          movimiento,
          candidato,
          motivo: this.buildMotivoResultado(movimiento, candidato),
          origenConciliacion: this.buildOrigenConciliacion(movimiento, candidato)
        };
      })
      .sort((a, b) => this.compareMovimientosDesc(a.movimiento, b.movimiento));
  }

  private buildOrigenConciliacion(
    movimiento: MovimientoBancario,
    candidato?: PagoTransferenciaCandidato
  ): 'AUTOMATICA' | 'MANUAL' | undefined {
    if (movimiento.conciliacionEstado !== 'CONCILIADO' || !candidato) {
      return undefined;
    }

    return this.isExactMatch(movimiento, candidato) ? 'AUTOMATICA' : 'MANUAL';
  }

  private buildMotivoResultado(movimiento: MovimientoBancario, candidato?: PagoTransferenciaCandidato): string {
    if (movimiento.conciliacionEstado === 'CONCILIADO' && candidato) {
      const exacto = this.isExactMatch(movimiento, candidato);
      return exacto
        ? `Match exacto por operacion, monto y fecha con ${candidato.nroRecibo || candidato.registroId}`
        : `Conciliado manualmente con ${candidato.nroRecibo || candidato.registroId}`;
    }

    const nroOperacion = this.normalizeOperacion(movimiento.nroOperacion);
    if (!nroOperacion) {
      return 'Pendiente: falta nro de operacion bancario para comparar.';
    }

    if (movimiento.conciliacionEstado === 'REVISAR') {
      return 'Revisar: hay mas de un candidato o la operacion coincide pero no valida monto/fecha.';
    }

    return 'Pendiente: sin coincidencia exacta por operacion, monto y fecha.';
  }

  private resolverConciliacionMovimiento(
    movimiento: MovimientoBancario,
    candidatos: PagoTransferenciaCandidato[],
    candidatosUsados: Set<string>
  ): ResultadoConciliacionBancaria {
    const vinculoExistente = this.resolveExistingLink(movimiento, candidatos, candidatosUsados);
    if (vinculoExistente) {
      return vinculoExistente;
    }

    const nroOperacion = this.normalizeOperacion(movimiento.nroOperacion);
    if (movimiento.tipo !== 'CREDITO' || !nroOperacion) {
      return {
        movimiento: {
          ...movimiento,
          conciliacionEstado: 'PENDIENTE',
          conciliadoRegistroId: undefined,
          conciliadoPagoOrden: undefined,
          conciliadoAt: undefined,
          ...this.buildProcesoAbiertoPatch()
        },
        motivo: 'Pendiente'
      };
    }

    const opCandidates = candidatos.filter(item => item.nroOperacion === nroOperacion);
    const exactCandidates = opCandidates.filter(item =>
      Math.abs(Number(item.monto || 0) - Number(movimiento.monto || 0)) <= 0.009
      && this.daysDiff(item.fecha, movimiento.fecha) <= 3
      && !candidatosUsados.has(this.candidateKey(item))
    );

    if (exactCandidates.length === 1) {
      const candidato = exactCandidates[0];
      candidatosUsados.add(this.candidateKey(candidato));
      return {
        movimiento: {
          ...movimiento,
          conciliacionEstado: 'CONCILIADO',
          conciliadoRegistroId: candidato.registroId,
          conciliadoPagoOrden: candidato.ordenPago,
          conciliadoAt: movimiento.conciliadoAt || new Date().toISOString(),
          ...this.buildProcesoPatchForLink(movimiento, candidato.registroId, candidato.ordenPago)
        },
        candidato,
        motivo: 'Conciliado'
      };
    }

    if (exactCandidates.length > 1 || opCandidates.length > 0) {
      return {
        movimiento: {
          ...movimiento,
          conciliacionEstado: 'REVISAR',
          conciliadoRegistroId: undefined,
          conciliadoPagoOrden: undefined,
          conciliadoAt: undefined,
          ...this.buildProcesoAbiertoPatch()
        },
        motivo: 'Revisar'
      };
    }

    return {
      movimiento: {
        ...movimiento,
        conciliacionEstado: 'PENDIENTE',
        conciliadoRegistroId: undefined,
        conciliadoPagoOrden: undefined,
        conciliadoAt: undefined,
        ...this.buildProcesoAbiertoPatch()
      },
      motivo: 'Pendiente'
    };
  }

  private resolveExistingLink(
    movimiento: MovimientoBancario,
    candidatos: PagoTransferenciaCandidato[],
    candidatosUsados: Set<string>
  ): ResultadoConciliacionBancaria | null {
    if (!movimiento.conciliadoRegistroId || !movimiento.conciliadoPagoOrden) {
      return null;
    }

    const candidato = candidatos.find(item =>
      item.registroId === movimiento.conciliadoRegistroId
      && item.ordenPago === movimiento.conciliadoPagoOrden
    );

    if (!candidato) {
      return null;
    }

    if (candidatosUsados.has(this.candidateKey(candidato))) {
      return {
        movimiento: {
          ...movimiento,
          conciliacionEstado: 'REVISAR',
          conciliadoRegistroId: undefined,
          conciliadoPagoOrden: undefined,
          conciliadoAt: undefined,
          ...this.buildProcesoAbiertoPatch()
        },
        motivo: 'Revisar'
      };
    }

    candidatosUsados.add(this.candidateKey(candidato));
    return {
      movimiento: {
        ...movimiento,
        conciliacionEstado: 'CONCILIADO',
        conciliadoRegistroId: candidato.registroId,
        conciliadoPagoOrden: candidato.ordenPago,
        conciliadoAt: movimiento.conciliadoAt || new Date().toISOString(),
        ...this.buildProcesoPatchForLink(movimiento, candidato.registroId, candidato.ordenPago)
      },
      candidato,
      motivo: 'Conciliado'
    };
  }

  private buildProcesoPatchForLink(
    movimiento: MovimientoBancario,
    registroId: string,
    ordenPago: number
  ): Pick<MovimientoBancario, 'conciliacionProceso' | 'conciliacionCerradaAt' | 'conciliacionCerradaObservacion'> {
    const sameLink = movimiento.conciliacionEstado === 'CONCILIADO'
      && movimiento.conciliadoRegistroId === registroId
      && Number(movimiento.conciliadoPagoOrden || 0) === Number(ordenPago || 0);

    if (sameLink && movimiento.conciliacionProceso === 'CERRADO' && movimiento.conciliacionCerradaAt) {
      return {
        conciliacionProceso: 'CERRADO',
        conciliacionCerradaAt: movimiento.conciliacionCerradaAt,
        conciliacionCerradaObservacion: movimiento.conciliacionCerradaObservacion
      };
    }

    return this.buildProcesoAbiertoPatch();
  }

  private buildProcesoAbiertoPatch(): Pick<MovimientoBancario, 'conciliacionProceso' | 'conciliacionCerradaAt' | 'conciliacionCerradaObservacion'> {
    return {
      conciliacionProceso: 'ABIERTO',
      conciliacionCerradaAt: undefined,
      conciliacionCerradaObservacion: undefined
    };
  }

  private buildCandidatosTransferencia(): PagoTransferenciaCandidato[] {
    return this.caja.getRegistrosSnapshot().flatMap(registro => this.extractCandidatosFromRegistro(registro));
  }

  private extractCandidatosFromRegistro(registro: Registro): PagoTransferenciaCandidato[] {
    return (registro.pagosDetalle || [])
      .map((pago, index) => ({ pago, index }))
      .filter(({ pago }) => this.isTransferencia(pago) && this.normalizeOperacion(pago.nroOperacion))
      .map(({ pago, index }) => ({
        registroId: registro.id,
        fecha: registro.fecha || this.toDateKey(registro.createdAt),
        nroRecibo: String(registro.nroRecibo || ''),
        nombre: String(registro.nombre || ''),
        ordenPago: index + 1,
        medioPago: this.normalizeText(pago.medioPago),
        monto: Number(pago.monto || 0),
        nroOperacion: this.normalizeOperacion(pago.nroOperacion)
      }));
  }

  private isTransferencia(pago: RegistroPagoDetalle): boolean {
    return /TRANSFER|CBU|CVU/.test(this.normalizeText(pago.medioPago));
  }

  private candidateKey(item: PagoTransferenciaCandidato): string {
    return `${item.registroId}-${item.ordenPago}`;
  }

  private compareMovimientosAsc(a: MovimientoBancario, b: MovimientoBancario): number {
    const byFecha = String(a.fecha || '').localeCompare(String(b.fecha || ''));
    if (byFecha !== 0) {
      return byFecha;
    }

    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  }

  private compareMovimientosDesc(a: MovimientoBancario, b: MovimientoBancario): number {
    return this.compareMovimientosAsc(b, a);
  }

  private buildManualOption(movimiento: MovimientoBancario, candidato: PagoTransferenciaCandidato): OpcionConciliacionManual | null {
    const reasons: string[] = [];
    let priority = 0;
    const movimientoOperacion = this.normalizeOperacion(movimiento.nroOperacion);
    const exactOperacion = movimientoOperacion && movimientoOperacion === candidato.nroOperacion;
    const exactMonto = Math.abs(Number(candidato.monto || 0) - Number(movimiento.monto || 0)) <= 0.009;
    const diffDias = this.daysDiff(candidato.fecha, movimiento.fecha);

    if (!exactOperacion) {
      return null;
    }

    priority += 100;
    reasons.push('misma operacion');

    if (exactMonto) {
      priority += 40;
      reasons.push('mismo monto');
    }

    if (diffDias <= 3) {
      priority += 20;
      reasons.push('fecha dentro de 3 dias');
    } else if (diffDias <= 7) {
      priority += 10;
      reasons.push('fecha dentro de 7 dias');
    }

    if (priority === 0) {
      return null;
    }

    return {
      ...candidato,
      motivoManual: reasons.join(', '),
      prioridadManual: priority
    };
  }

  private isExactMatch(movimiento: MovimientoBancario, candidato: PagoTransferenciaCandidato): boolean {
    return this.normalizeOperacion(movimiento.nroOperacion) === candidato.nroOperacion
      && Math.abs(Number(candidato.monto || 0) - Number(movimiento.monto || 0)) <= 0.009
      && this.daysDiff(candidato.fecha, movimiento.fecha) <= 3;
  }

  private daysDiff(a: string, b: string): number {
    const timeA = new Date(a).getTime();
    const timeB = new Date(b).getTime();
    if (!Number.isFinite(timeA) || !Number.isFinite(timeB)) {
      return Number.MAX_SAFE_INTEGER;
    }

    return Math.abs(Math.round((timeA - timeB) / 86400000));
  }

  private normalizeMovimientos(list: MovimientoBancario[]): MovimientoBancario[] {
    return (list || []).map(item => {
      const conciliacionEstado = this.normalizeEstado(item.conciliacionEstado);
      const conciliacionCerradaAt = conciliacionEstado === 'CONCILIADO'
        ? item.conciliacionCerradaAt || undefined
        : undefined;
      const conciliacionProceso = conciliacionEstado === 'CONCILIADO'
        ? this.normalizeProceso(item.conciliacionProceso, conciliacionCerradaAt)
        : 'ABIERTO';

      return {
        ...item,
        id: item.id || crypto.randomUUID(),
        fecha: this.normalizeFecha(item.fecha || this.toDateKey(item.createdAt)),
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
        banco: String(item.banco || '').trim(),
        cuenta: String(item.cuenta || '').trim(),
        descripcion: String(item.descripcion || '').trim() || 'SIN DESCRIPCION',
        monto: Number(item.monto || 0),
        tipo: Number(item.monto || 0) < 0 || item.tipo === 'DEBITO' ? 'DEBITO' : 'CREDITO',
        nroOperacion: this.normalizeOperacion(item.nroOperacion),
        referenciaExterna: String(item.referenciaExterna || '').trim(),
        origenImportacion: String(item.origenImportacion || '').trim() || 'MANUAL',
        conciliacionEstado,
        conciliadoRegistroId: String(item.conciliadoRegistroId || '').trim() || undefined,
        conciliadoPagoOrden: Number(item.conciliadoPagoOrden || 0) || undefined,
        conciliadoAt: conciliacionEstado === 'CONCILIADO' ? item.conciliadoAt || undefined : undefined,
        conciliacionProceso,
        conciliacionCerradaAt,
        conciliacionCerradaObservacion: conciliacionProceso === 'CERRADO'
          ? String(item.conciliacionCerradaObservacion || '').trim() || undefined
          : undefined
      };
    });
  }

  private normalizeEstado(value?: string): MovimientoBancario['conciliacionEstado'] {
    if (value === 'CONCILIADO' || value === 'REVISAR') {
      return value;
    }

    return 'PENDIENTE';
  }

  private normalizeProceso(
    value?: string,
    conciliacionCerradaAt?: string
  ): MovimientoBancario['conciliacionProceso'] {
    if (value === 'CERRADO' || conciliacionCerradaAt) {
      return 'CERRADO';
    }

    return 'ABIERTO';
  }

  private normalizeOperacion(value?: string): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '')
      .replace(/[^A-Z0-9._/-]/gi, '')
      .trim()
      .toUpperCase();
  }

  private normalizeFecha(value?: string): string {
    if (!value) {
      return this.toDateKey(new Date().toISOString());
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return this.toDateKey(new Date().toISOString());
    }

    return this.toDateKey(parsed.toISOString());
  }

  private toDateKey(value?: string): string {
    const parsed = new Date(value || new Date().toISOString());
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private normalizeText(value?: string): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();
  }

  private async hydrateFromSupabase() {
    const rows = await this.repository.hydrate();
    if (!rows) {
      return;
    }

    this.movimientos$.next(rows);
  }
}