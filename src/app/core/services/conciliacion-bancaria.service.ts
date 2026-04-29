import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { SyncCollectionRepository } from '../repositories/sync-collection.repository';
import { LoggerService } from './logger.service';
import { SupabaseService } from './supabase.service';
import { CajaService } from './caja.service';
import { ConciliacionBancariaHistorial, MovimientoBancario, Registro, RegistroPagoDetalle } from '../../shared/models/finance.model';

interface PagoTransferenciaCandidato {
  registroId: string;
  fecha: string;
  nroRecibo: string;
  nombre: string;
  ordenPago: number;
  medioPago: string;
  monto: number;
  nroOperacion?: string;
  nroCuit?: string;
}

type MovimientoImportable = Omit<
  MovimientoBancario,
  | 'id'
  | 'importKey'
  | 'createdAt'
  | 'updatedAt'
  | 'primeraImportacionAt'
  | 'ultimaImportacionAt'
  | 'importBatchId'
  | 'vecesImportado'
  | 'conciliacionEstado'
  | 'conciliadoRegistroId'
  | 'conciliadoPagoOrden'
  | 'conciliadoAt'
  | 'conciliacionProceso'
  | 'conciliacionCerradaAt'
  | 'conciliacionCerradaObservacion'
>;

export interface OpcionConciliacionManual extends PagoTransferenciaCandidato {
  motivoManual: string;
  prioridadManual: number;
}

export interface OpcionMovimientoConciliacion {
  movimientoId: string;
  fecha: string;
  createdAt: string;
  descripcion: string;
  monto: number;
  banco?: string;
  cuenta?: string;
  nroOperacion?: string;
  referenciaExterna?: string;
  movimientoCuitDetectado?: string;
  motivoManual: string;
  prioridadManual: number;
}

export interface ResultadoConciliacionBancaria {
  movimiento: MovimientoBancario;
  candidato?: PagoTransferenciaCandidato;
  motivo: string;
  origenConciliacion?: 'AUTOMATICA' | 'MANUAL';
  movimientoCuitDetectado?: string;
  cuitCompatible?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ConciliacionBancariaService {
  private readonly STORAGE_KEY = 'appreg.movimientos-bancarios';
  private readonly STORAGE_HISTORY_KEY = 'appreg.conciliacion-bancaria-historial';
  private readonly TABLE = 'movimientos_bancarios';
  private readonly TABLE_HISTORY = 'conciliacion_bancaria_historial';
  private readonly MATCH_WINDOW_DAYS = 15;

  private readonly repository: SyncCollectionRepository<MovimientoBancario>;
  private readonly historyRepository: SyncCollectionRepository<ConciliacionBancariaHistorial>;
  private movimientos$ = new BehaviorSubject<MovimientoBancario[]>([]);
  movimientos = this.movimientos$.asObservable();
  private historial$ = new BehaviorSubject<ConciliacionBancariaHistorial[]>([]);
  historial = this.historial$.asObservable();

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
    this.historyRepository = new SyncCollectionRepository<ConciliacionBancariaHistorial>({
      storageKey: this.STORAGE_HISTORY_KEY,
      table: this.TABLE_HISTORY,
      conflictKey: 'id',
      orderBy: 'createdAt',
      normalizeList: list => this.normalizeHistorial(list),
      supabase: this.supabase,
      logger: this.logger
    });

    this.movimientos$.next(this.repository.loadLocal());
    this.historial$.next(this.historyRepository.loadLocal());
    this.hydrateFromSupabase();
    this.conciliarAutomaticamente();
  }

  getMovimientosSnapshot(): MovimientoBancario[] {
    return this.movimientos$.getValue();
  }

  getHistorialSnapshot(): ConciliacionBancariaHistorial[] {
    return this.historial$.getValue();
  }

  updateMovimientos(list: MovimientoBancario[]) {
    const safe = this.repository.save(list || []);
    this.movimientos$.next(safe);
  }

  private updateHistorial(list: ConciliacionBancariaHistorial[]) {
    const safe = this.historyRepository.save(list || []);
    this.historial$.next(safe);
  }

  importMovimientos(list: MovimientoImportable[]) {
    const current = this.getMovimientosSnapshot();
    const now = new Date().toISOString();
    const batchId = this.buildImportBatchId(now);
    const currentByImportKey = new Map(current.map(item => [item.importKey || this.buildImportKey(item), item]));
    const eventos: ConciliacionBancariaHistorial[] = [];

    (list || []).forEach(item => {
      const importKey = this.buildImportKey(item);
      const existing = currentByImportKey.get(importKey);
      const nextItem: MovimientoBancario = existing
        ? {
            ...existing,
            fecha: this.normalizeFecha(item.fecha || existing.fecha),
            banco: String(item.banco || '').trim(),
            cuenta: String(item.cuenta || '').trim(),
            descripcion: String(item.descripcion || '').trim() || existing.descripcion,
            monto: Number(item.monto || 0),
            tipo: Number(item.monto || 0) < 0 || item.tipo === 'DEBITO' ? 'DEBITO' : 'CREDITO',
            nroOperacion: this.normalizeOperacion(item.nroOperacion),
            referenciaExterna: String(item.referenciaExterna || '').trim(),
            origenImportacion: String(item.origenImportacion || existing.origenImportacion || '').trim() || 'IMPORTACION_PDF',
            importKey,
            updatedAt: now,
            ultimaImportacionAt: now,
            importBatchId: batchId,
            vecesImportado: Math.max(1, Number(existing.vecesImportado || 1)) + 1
          }
        : {
            ...item,
            id: crypto.randomUUID(),
            importKey,
            createdAt: now,
            updatedAt: now,
            primeraImportacionAt: now,
            ultimaImportacionAt: now,
            importBatchId: batchId,
            vecesImportado: 1,
            conciliacionEstado: 'PENDIENTE' as const,
            conciliadoRegistroId: undefined,
            conciliadoPagoOrden: undefined,
            conciliadoAt: undefined,
            conciliacionProceso: 'ABIERTO' as const,
            conciliacionCerradaAt: undefined,
            conciliacionCerradaObservacion: undefined
          };

      currentByImportKey.set(importKey, nextItem);
      eventos.push(this.buildHistorialEvent(existing ? 'REIMPORTADO' : 'IMPORTADO', nextItem, {
        observacion: existing ? 'El movimiento importado se actualizo por reimportacion.' : 'Alta inicial del movimiento en staging operativo.',
        payload: {
          importBatchId: batchId,
          vecesImportado: nextItem.vecesImportado,
          reemplazoRegistroPrevio: Boolean(existing)
        }
      }));
    });

    this.updateMovimientos([...currentByImportKey.values()]);
    this.appendHistorial(eventos);
    this.conciliarAutomaticamente();
  }

  removeMovimiento(id: string) {
    const movimiento = this.getMovimientosSnapshot().find(item => item.id === id);
    this.updateMovimientos(this.getMovimientosSnapshot().filter(item => item.id !== id));
    if (movimiento) {
      this.appendHistorial([
        this.buildHistorialEvent('ELIMINACION', movimiento, {
          observacion: 'El movimiento fue eliminado del staging operativo.'
        })
      ]);
    }
  }

  async clearAllData() {
    await this.repository.clear({ column: 'id', operator: 'neq', value: '' });
    await this.historyRepository.clear({ column: 'id', operator: 'neq', value: '' });
    this.movimientos$.next([]);
    this.historial$.next([]);
  }

  aplicarConciliacionManual(movimientoId: string, registroId: string, ordenPago: number) {
    const candidatos = this.buildCandidatosTransferencia();
    const candidato = candidatos.find(item => item.registroId === registroId && item.ordenPago === ordenPago);
    if (!candidato) {
      throw new Error('El pago seleccionado ya no existe para conciliacion manual.');
    }

    this.linkMovimientoConPago(movimientoId, candidato, 'CONCILIACION_MANUAL');
  }

  aplicarConciliacionDesdePago(registroId: string, ordenPago: number, movimientoId: string) {
    const pago = this.resolvePagoTransferencia(registroId, ordenPago);
    if (!pago) {
      throw new Error('El pago seleccionado ya no existe para conciliacion.');
    }

    this.linkMovimientoConPago(movimientoId, pago, 'CONCILIACION_MANUAL');
  }

  buildOpcionesMovimientosParaPago(registroId: string, ordenPago: number): OpcionMovimientoConciliacion[] {
    const pago = this.resolvePagoTransferencia(registroId, ordenPago);
    if (!pago) {
      return [];
    }

    return this.getMovimientosSnapshot()
      .filter(movimiento => this.isMovimientoDisponibleParaPago(movimiento, pago.registroId, pago.ordenPago))
      .map(movimiento => this.buildMovimientoOptionForPago(pago, movimiento))
      .filter((item): item is OpcionMovimientoConciliacion => Boolean(item))
      .sort((a, b) => {
        const byPriority = b.prioridadManual - a.prioridadManual;
        if (byPriority !== 0) {
          return byPriority;
        }

        return this.compareMovimientosDesc(
          { id: a.movimientoId, fecha: a.fecha, createdAt: a.createdAt, descripcion: a.descripcion, monto: a.monto, tipo: 'CREDITO' },
          { id: b.movimientoId, fecha: b.fecha, createdAt: b.createdAt, descripcion: b.descripcion, monto: b.monto, tipo: 'CREDITO' }
        );
      });
  }

  private linkMovimientoConPago(
    movimientoId: string,
    candidato: PagoTransferenciaCandidato,
    evento: ConciliacionBancariaHistorial['evento']
  ) {
    const movimiento = this.getMovimientosSnapshot().find(item => item.id === movimientoId);
    if (!movimiento) {
      throw new Error('El movimiento bancario ya no existe.');
    }

    if (!this.isMovimientoDisponibleParaPago(movimiento, candidato.registroId, candidato.ordenPago)) {
      throw new Error('El movimiento bancario ya esta conciliado con otro pago.');
    }

    this.caja.syncRegistroPagoTransferencia(candidato.registroId, candidato.ordenPago, {
      nroOperacion: movimiento.nroOperacion,
      fechaTransferencia: movimiento.fecha,
      nroCuit: this.resolveMovimientoCuit(movimiento)
    });

    const now = new Date().toISOString();
    const next = this.getMovimientosSnapshot().map(item => {
      const samePago = item.conciliadoRegistroId === candidato.registroId
        && Number(item.conciliadoPagoOrden || 0) === Number(candidato.ordenPago || 0);

      if (item.id === movimientoId) {
        return {
          ...item,
          conciliacionEstado: 'CONCILIADO' as const,
          conciliadoRegistroId: candidato.registroId,
          conciliadoPagoOrden: candidato.ordenPago,
          conciliadoAt: now,
          ...this.buildProcesoAbiertoPatch(),
          updatedAt: now
        };
      }

      if (!samePago) {
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
    const movimientoConciliado = next.find(item => item.id === movimientoId);
    if (movimientoConciliado) {
      this.appendHistorial([
        this.buildHistorialEvent(evento, movimientoConciliado, {
          registroId: candidato.registroId,
          ordenPago: candidato.ordenPago,
          observacion: 'El movimiento quedo conciliado y auditado desde el flujo operativo.',
          payload: {
            candidatoFecha: candidato.fecha,
            candidatoMonto: candidato.monto,
            candidatoNroOperacion: candidato.nroOperacion,
            candidatoNroCuit: candidato.nroCuit,
            origen: 'OPERACION'
          }
        })
      ]);
    }
    this.conciliarAutomaticamente();
  }

  liberarConciliacion(movimientoId: string) {
    const movimientoAnterior = this.getMovimientosSnapshot().find(item => item.id === movimientoId);
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
    if (movimientoAnterior) {
      this.appendHistorial([
        this.buildHistorialEvent('LIBERACION', {
          ...movimientoAnterior,
          conciliacionEstado: 'PENDIENTE',
          conciliadoRegistroId: undefined,
          conciliadoPagoOrden: undefined,
          conciliadoAt: undefined,
          updatedAt: now
        }, {
          registroId: movimientoAnterior.conciliadoRegistroId,
          ordenPago: movimientoAnterior.conciliadoPagoOrden,
          observacion: 'Se libero manualmente la conciliacion del movimiento.'
        })
      ]);
    }
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
    const movimientoCerrado = next.find(item => item.id === movimientoId);
    if (movimientoCerrado) {
      this.appendHistorial([
        this.buildHistorialEvent('CIERRE_PROCESO', movimientoCerrado, {
          registroId: movimientoCerrado.conciliadoRegistroId,
          ordenPago: movimientoCerrado.conciliadoPagoOrden,
          observacion: nota || 'Proceso conciliado y cerrado manualmente.'
        })
      ]);
    }
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
    const movimientoReabierto = next.find(item => item.id === movimientoId);
    if (movimientoReabierto) {
      this.appendHistorial([
        this.buildHistorialEvent('REAPERTURA_PROCESO', movimientoReabierto, {
          registroId: movimientoReabierto.conciliadoRegistroId,
          ordenPago: movimientoReabierto.conciliadoPagoOrden,
          observacion: 'Proceso reabierto para nueva revision.'
        })
      ]);
    }
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

    this.syncPagosConciliados(next);
    const eventos = this.buildHistorialEventosAutomaticos(movimientos, next);

    if (changed) {
      this.updateMovimientos(next);
    } else {
      this.movimientos$.next(this.normalizeMovimientos(next));
    }

    if (eventos.length) {
      this.appendHistorial(eventos);
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
        const movimientoCuitDetectado = this.resolveMovimientoCuit(movimiento);

        return {
          movimiento,
          candidato,
          movimientoCuitDetectado,
          cuitCompatible: candidato ? this.isCuitCompatible(movimiento, candidato) : undefined,
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
        ? `Match exacto por operacion, monto, fecha${candidato.nroCuit ? ' y CUIT' : ''} con ${candidato.nroRecibo || candidato.registroId}`
        : `Conciliado manualmente con ${candidato.nroRecibo || candidato.registroId}`;
    }

    const nroOperacion = this.normalizeOperacion(movimiento.nroOperacion);
    if (!nroOperacion) {
      return 'Pendiente: falta nro de operacion bancario para comparar.';
    }

    if (movimiento.conciliacionEstado === 'REVISAR') {
      return 'Revisar: hay mas de un candidato o la operacion coincide pero no valida monto/fecha/CUIT.';
    }

    return 'Pendiente: sin coincidencia exacta por operacion, monto, fecha y CUIT cuando aplica.';
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
      && this.daysDiff(item.fecha, movimiento.fecha) <= this.MATCH_WINDOW_DAYS
      && this.isCuitCompatible(movimiento, item)
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

  private syncPagosConciliados(movimientos: MovimientoBancario[]) {
    movimientos
      .filter(item => item.conciliacionEstado === 'CONCILIADO' && item.conciliadoRegistroId && item.conciliadoPagoOrden)
      .forEach(item => {
        this.caja.syncRegistroPagoTransferencia(String(item.conciliadoRegistroId), Number(item.conciliadoPagoOrden), {
          nroOperacion: item.nroOperacion,
          fechaTransferencia: item.fecha,
          nroCuit: this.resolveMovimientoCuit(item)
        });
      });
  }

  private appendHistorial(eventos: ConciliacionBancariaHistorial[]) {
    if (!eventos.length) {
      return;
    }

    this.updateHistorial([...this.getHistorialSnapshot(), ...eventos]);
  }

  private buildHistorialEventosAutomaticos(
    previos: MovimientoBancario[],
    actuales: MovimientoBancario[]
  ): ConciliacionBancariaHistorial[] {
    const previosPorId = new Map(previos.map(item => [item.id, item]));

    return actuales.flatMap(actual => {
      const previo = previosPorId.get(actual.id);
      if (!previo) {
        return [];
      }

      const previoEstado = previo.conciliacionEstado || 'PENDIENTE';
      const actualEstado = actual.conciliacionEstado || 'PENDIENTE';
      const previoLink = `${previo.conciliadoRegistroId || ''}-${Number(previo.conciliadoPagoOrden || 0)}`;
      const actualLink = `${actual.conciliadoRegistroId || ''}-${Number(actual.conciliadoPagoOrden || 0)}`;

      if (previoEstado === actualEstado && previoLink === actualLink) {
        return [];
      }

      if (actualEstado === 'CONCILIADO' && actual.conciliadoRegistroId && actual.conciliadoPagoOrden) {
        return [
          this.buildHistorialEvent('CONCILIACION_AUTOMATICA', actual, {
            registroId: actual.conciliadoRegistroId,
            ordenPago: actual.conciliadoPagoOrden,
            observacion: 'Conciliacion automatica recalculada y persistida.'
          })
        ];
      }

      if (previoEstado === 'CONCILIADO') {
        return [
          this.buildHistorialEvent('LIBERACION', actual, {
            registroId: previo.conciliadoRegistroId,
            ordenPago: previo.conciliadoPagoOrden,
            observacion: 'El vinculo previo se libero durante el recalculo automatico.'
          })
        ];
      }

      return [];
    });
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
        fecha: this.resolveFechaCandidatoTransferencia(registro, pago),
        nroRecibo: String(registro.nroRecibo || ''),
        nombre: String(registro.nombre || ''),
        ordenPago: index + 1,
        medioPago: this.normalizeText(pago.medioPago),
        monto: Number(pago.monto || 0),
        nroOperacion: this.normalizeOperacion(pago.nroOperacion),
        nroCuit: this.normalizeCuit(pago.nroCuit)
      }));
  }

  private resolvePagoTransferencia(registroId: string, ordenPago: number): PagoTransferenciaCandidato | null {
    const targetRegistro = this.caja.getRegistrosSnapshot().find(item => item.id === registroId);
    if (!targetRegistro) {
      return null;
    }

    const pago = targetRegistro.pagosDetalle?.[Number(ordenPago || 0) - 1];
    if (!pago || !this.isTransferencia(pago)) {
      return null;
    }

    return {
      registroId: targetRegistro.id,
      fecha: this.resolveFechaCandidatoTransferencia(targetRegistro, pago),
      nroRecibo: String(targetRegistro.nroRecibo || ''),
      nombre: String(targetRegistro.nombre || ''),
      ordenPago: Number(ordenPago || 0),
      medioPago: this.normalizeText(pago.medioPago),
      monto: Number(pago.monto || 0),
      nroOperacion: this.normalizeOperacion(pago.nroOperacion) || undefined,
      nroCuit: this.normalizeCuit(pago.nroCuit)
    };
  }

  private resolveFechaCandidatoTransferencia(registro: Registro, pago: RegistroPagoDetalle): string {
    const fechaTransferencia = String(pago.fechaTransferencia || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(fechaTransferencia)) {
      return fechaTransferencia;
    }

    return registro.fecha || this.toDateKey(registro.createdAt);
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
    const cuitMovimiento = this.resolveMovimientoCuit(movimiento);
    const exactCuit = Boolean(candidato.nroCuit && cuitMovimiento && candidato.nroCuit === cuitMovimiento);

    if (!exactOperacion) {
      return null;
    }

    if (!this.isCuitCompatible(movimiento, candidato)) {
      return null;
    }

    priority += 100;
    reasons.push('misma operacion');

    if (exactMonto) {
      priority += 40;
      reasons.push('mismo monto');
    }

    if (diffDias <= this.MATCH_WINDOW_DAYS) {
      priority += 20;
      reasons.push(`fecha dentro de ${this.MATCH_WINDOW_DAYS} dias`);
    } else if (diffDias <= 30) {
      priority += 10;
      reasons.push('fecha dentro de 30 dias');
    }

    if (exactCuit) {
      priority += 30;
      reasons.push('mismo CUIT');
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

  private buildMovimientoOptionForPago(
    pago: PagoTransferenciaCandidato,
    movimiento: MovimientoBancario
  ): OpcionMovimientoConciliacion | null {
    if (movimiento.tipo !== 'CREDITO') {
      return null;
    }

    const reasons: string[] = [];
    let priority = 0;
    const movimientoOperacion = this.normalizeOperacion(movimiento.nroOperacion);
    const exactOperacion = Boolean(pago.nroOperacion && movimientoOperacion && pago.nroOperacion === movimientoOperacion);
    const exactMonto = Math.abs(Number(pago.monto || 0) - Number(movimiento.monto || 0)) <= 0.009;
    const diffDias = this.daysDiff(pago.fecha, movimiento.fecha);
    const movimientoCuitDetectado = this.resolveMovimientoCuit(movimiento);
    const exactCuit = Boolean(pago.nroCuit && movimientoCuitDetectado && pago.nroCuit === movimientoCuitDetectado);
    const cuitCompatible = this.isCuitCompatible(movimiento, pago);

    if (exactOperacion) {
      priority += 100;
      reasons.push('misma operacion');
    } else if (!pago.nroOperacion && movimientoOperacion) {
      priority += 15;
      reasons.push('aporta operacion bancaria');
    }

    if (exactMonto) {
      priority += 40;
      reasons.push('mismo monto');
    }

    if (diffDias <= this.MATCH_WINDOW_DAYS) {
      priority += 20;
      reasons.push(`fecha dentro de ${this.MATCH_WINDOW_DAYS} dias`);
    } else if (diffDias <= 30) {
      priority += 10;
      reasons.push('fecha dentro de 30 dias');
    }

    if (exactCuit) {
      priority += 30;
      reasons.push('mismo CUIT');
    } else if (!cuitCompatible && pago.nroCuit && movimientoCuitDetectado) {
      reasons.push('CUIT distinto');
    }

    const elegible = exactOperacion || (exactMonto && diffDias <= 30) || (exactMonto && exactCuit) || (exactCuit && diffDias <= this.MATCH_WINDOW_DAYS);
    if (!elegible || priority <= 0) {
      return null;
    }

    return {
      movimientoId: movimiento.id,
      fecha: movimiento.fecha,
      createdAt: movimiento.createdAt,
      descripcion: movimiento.descripcion,
      monto: Number(movimiento.monto || 0),
      banco: movimiento.banco,
      cuenta: movimiento.cuenta,
      nroOperacion: movimientoOperacion || undefined,
      referenciaExterna: movimiento.referenciaExterna,
      movimientoCuitDetectado,
      motivoManual: reasons.join(', '),
      prioridadManual: priority
    };
  }

  private isMovimientoDisponibleParaPago(
    movimiento: MovimientoBancario,
    registroId: string,
    ordenPago: number
  ): boolean {
    if (movimiento.tipo !== 'CREDITO') {
      return false;
    }

    if (movimiento.conciliacionEstado !== 'CONCILIADO') {
      return true;
    }

    return movimiento.conciliadoRegistroId === registroId
      && Number(movimiento.conciliadoPagoOrden || 0) === Number(ordenPago || 0);
  }

  private isExactMatch(movimiento: MovimientoBancario, candidato: PagoTransferenciaCandidato): boolean {
    return this.normalizeOperacion(movimiento.nroOperacion) === candidato.nroOperacion
      && Math.abs(Number(candidato.monto || 0) - Number(movimiento.monto || 0)) <= 0.009
      && this.isCuitCompatible(movimiento, candidato)
      && this.daysDiff(candidato.fecha, movimiento.fecha) <= this.MATCH_WINDOW_DAYS;
  }

  private isCuitCompatible(movimiento: MovimientoBancario, candidato: PagoTransferenciaCandidato): boolean {
    const movimientoCuit = this.resolveMovimientoCuit(movimiento);
    if (!candidato.nroCuit || !movimientoCuit) {
      return true;
    }

    return candidato.nroCuit === movimientoCuit;
  }

  private resolveMovimientoCuit(movimiento: MovimientoBancario): string | undefined {
    return this.normalizeCuit(
      `${String(movimiento.descripcion || '')} ${String(movimiento.referenciaExterna || '')} ${String(movimiento.cuenta || '')}`
    );
  }

  private normalizeCuit(value?: string): string | undefined {
    const match = String(value || '').match(/\b\d{2}[-\s.]?\d{8}[-\s.]?\d\b|\b\d{11}\b/);
    if (!match?.[0]) {
      return undefined;
    }

    const digits = match[0].replace(/\D/g, '').slice(0, 11);
    return digits || undefined;
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
      const createdAt = item.createdAt || new Date().toISOString();
      const importKey = String(item.importKey || '').trim() || this.buildImportKey(item);
      const primeraImportacionAt = item.primeraImportacionAt || createdAt;
      const ultimaImportacionAt = item.ultimaImportacionAt || item.updatedAt || createdAt;

      return {
        ...item,
        id: item.id || crypto.randomUUID(),
        importKey,
        fecha: this.normalizeFecha(item.fecha || this.toDateKey(item.createdAt)),
        createdAt,
        updatedAt: item.updatedAt || createdAt,
        primeraImportacionAt,
        ultimaImportacionAt,
        importBatchId: String(item.importBatchId || '').trim() || undefined,
        vecesImportado: Math.max(1, Number(item.vecesImportado || 1)),
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

  private normalizeHistorial(list: ConciliacionBancariaHistorial[]): ConciliacionBancariaHistorial[] {
    return (list || [])
      .map(item => ({
        ...item,
        id: item.id || crypto.randomUUID(),
        movimientoId: String(item.movimientoId || '').trim(),
        movimientoImportKey: String(item.movimientoImportKey || '').trim() || undefined,
        createdAt: item.createdAt || new Date().toISOString(),
        registroId: String(item.registroId || '').trim() || undefined,
        ordenPago: Number(item.ordenPago || 0) || undefined,
        observacion: String(item.observacion || '').trim() || undefined,
        movimientoFecha: this.normalizeFecha(item.movimientoFecha),
        movimientoDescripcion: String(item.movimientoDescripcion || '').trim() || 'SIN DESCRIPCION',
        movimientoMonto: Number(item.movimientoMonto || 0),
        movimientoTipo: item.movimientoTipo === 'DEBITO' ? 'DEBITO' : 'CREDITO',
        movimientoNroOperacion: this.normalizeOperacion(item.movimientoNroOperacion) || undefined,
        movimientoCuitDetectado: this.normalizeCuit(item.movimientoCuitDetectado),
        movimientoBanco: String(item.movimientoBanco || '').trim() || undefined,
        movimientoCuenta: String(item.movimientoCuenta || '').trim() || undefined,
        payload: item.payload || undefined
      }) as ConciliacionBancariaHistorial)
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
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

  private buildImportKey(value: Pick<MovimientoBancario, 'fecha' | 'tipo' | 'nroOperacion' | 'referenciaExterna' | 'descripcion' | 'monto' | 'banco' | 'cuenta'>): string {
    const identity = this.normalizeOperacion(value.nroOperacion)
      || this.normalizeOperacion(value.referenciaExterna)
      || this.normalizeOperacion(String(value.descripcion || '').slice(0, 80));
    const amountCents = Math.round(Math.abs(Number(value.monto || 0)) * 100);
    const base = [
      this.normalizeFecha(value.fecha),
      value.tipo === 'DEBITO' ? 'DEBITO' : 'CREDITO',
      identity || 'SIN_IDENTIDAD',
      String(amountCents),
      this.normalizeText(value.banco),
      this.normalizeText(value.cuenta)
    ].join('|');

    return `MB-${this.hashValue(base)}`;
  }

  private buildImportBatchId(now: string): string {
    return `LOTE-${now.replace(/[^0-9]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }

  private hashValue(value: string): string {
    let hash = 2166136261;
    const input = String(value || '');

    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(16).padStart(8, '0').toUpperCase();
  }

  private buildHistorialEvent(
    evento: ConciliacionBancariaHistorial['evento'],
    movimiento: MovimientoBancario,
    options?: {
      registroId?: string;
      ordenPago?: number;
      observacion?: string;
      payload?: Record<string, unknown>;
    }
  ): ConciliacionBancariaHistorial {
    return {
      id: crypto.randomUUID(),
      movimientoId: movimiento.id,
      movimientoImportKey: movimiento.importKey,
      evento,
      createdAt: new Date().toISOString(),
      registroId: options?.registroId,
      ordenPago: options?.ordenPago,
      observacion: options?.observacion,
      movimientoFecha: movimiento.fecha,
      movimientoDescripcion: movimiento.descripcion,
      movimientoMonto: Number(movimiento.monto || 0),
      movimientoTipo: movimiento.tipo === 'DEBITO' ? 'DEBITO' : 'CREDITO',
      movimientoNroOperacion: movimiento.nroOperacion,
      movimientoCuitDetectado: this.resolveMovimientoCuit(movimiento),
      movimientoBanco: movimiento.banco,
      movimientoCuenta: movimiento.cuenta,
      payload: {
        conciliacionEstado: movimiento.conciliacionEstado,
        conciliacionProceso: movimiento.conciliacionProceso,
        conciliadoRegistroId: movimiento.conciliadoRegistroId,
        conciliadoPagoOrden: movimiento.conciliadoPagoOrden,
        conciliadoAt: movimiento.conciliadoAt,
        origenImportacion: movimiento.origenImportacion,
        primeraImportacionAt: movimiento.primeraImportacionAt,
        ultimaImportacionAt: movimiento.ultimaImportacionAt,
        importBatchId: movimiento.importBatchId,
        vecesImportado: movimiento.vecesImportado,
        ...(options?.payload || {})
      }
    };
  }

  private async hydrateFromSupabase() {
    const rows = await this.repository.hydrate();
    const historial = await this.historyRepository.hydrate();
    if (historial) {
      this.historial$.next(historial);
    }

    if (!rows) {
      return;
    }

    this.movimientos$.next(rows);
  }
}