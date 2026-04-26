import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Registro, TotalesMedioPago, Billete, Gasto, CierreResumen, RegistroPagoDetalle, IngresoCaja, CierreCaja } from '../../shared/models/finance.model';
import { SyncCollectionRepository } from '../repositories/sync-collection.repository';
import { SupabaseService } from './supabase.service';
import { LoggerService } from './logger.service';

@Injectable({ providedIn: 'root' })
export class CajaService {
  private readonly STORAGE_REGISTROS = 'appreg.registros';
  private readonly STORAGE_BILLETES = 'appreg.billetes';
  private readonly STORAGE_GASTOS = 'appreg.gastos';
  private readonly STORAGE_INGRESOS = 'appreg.ingresos';
  private readonly STORAGE_CIERRES = 'appreg.cierres';
  private readonly TABLE_REGISTROS = 'registros';
  private readonly TABLE_BILLETES = 'billetes';
  private readonly TABLE_GASTOS = 'gastos';
  private readonly TABLE_INGRESOS = 'ingresos';
  private readonly TABLE_CIERRES = 'cierres';

  private readonly registrosRepository: SyncCollectionRepository<Registro>;
  private readonly billetesRepository: SyncCollectionRepository<Billete>;
  private readonly gastosRepository: SyncCollectionRepository<Gasto>;
  private readonly ingresosRepository: SyncCollectionRepository<IngresoCaja>;
  private readonly cierresRepository: SyncCollectionRepository<CierreCaja>;

  private registros$ = new BehaviorSubject<Registro[]>([]);
  registros = this.registros$.asObservable();

  private billetes$ = new BehaviorSubject<Billete[]>([]);
  billetes = this.billetes$.asObservable();

  private gastos$ = new BehaviorSubject<Gasto[]>([]);
  gastos = this.gastos$.asObservable();

  private ingresos$ = new BehaviorSubject<IngresoCaja[]>([]);
  ingresos = this.ingresos$.asObservable();

  private cierres$ = new BehaviorSubject<CierreCaja[]>([]);
  cierres = this.cierres$.asObservable();

  constructor(private supabase: SupabaseService, private logger: LoggerService) {
    this.registrosRepository = new SyncCollectionRepository<Registro>({
      storageKey: this.STORAGE_REGISTROS,
      table: this.TABLE_REGISTROS,
      conflictKey: 'id',
      orderBy: 'createdAt',
      normalizeList: list => this.normalizeRegistros(list),
      supabase: this.supabase,
      logger: this.logger
    });
    this.billetesRepository = new SyncCollectionRepository<Billete>({
      storageKey: this.STORAGE_BILLETES,
      table: this.TABLE_BILLETES,
      conflictKey: 'valor',
      orderBy: 'valor',
      normalizeList: list => this.normalizeBilletes(list),
      supabase: this.supabase,
      logger: this.logger
    });
    this.gastosRepository = new SyncCollectionRepository<Gasto>({
      storageKey: this.STORAGE_GASTOS,
      table: this.TABLE_GASTOS,
      conflictKey: 'id',
      orderBy: 'createdAt',
      normalizeList: list => this.normalizeGastos(list),
      supabase: this.supabase,
      logger: this.logger
    });
    this.ingresosRepository = new SyncCollectionRepository<IngresoCaja>({
      storageKey: this.STORAGE_INGRESOS,
      table: this.TABLE_INGRESOS,
      conflictKey: 'id',
      orderBy: 'createdAt',
      normalizeList: list => this.normalizeIngresos(list),
      supabase: this.supabase,
      logger: this.logger
    });
    this.cierresRepository = new SyncCollectionRepository<CierreCaja>({
      storageKey: this.STORAGE_CIERRES,
      table: this.TABLE_CIERRES,
      conflictKey: 'id',
      orderBy: 'createdAt',
      normalizeList: list => this.normalizeCierres(list),
      supabase: this.supabase,
      logger: this.logger
    });

    this.registros$.next(this.registrosRepository.loadLocal());
    this.billetes$.next(this.billetesRepository.loadLocal());
    this.gastos$.next(this.gastosRepository.loadLocal());
    this.ingresos$.next(this.ingresosRepository.loadLocal());
    this.cierres$.next(this.cierresRepository.loadLocal());

    this.hydrateFromSupabase();
  }

  getTodayDateKey(): string {
    return this.todayDateKey();
  }

  getRegistrosSnapshot(): Registro[] {
    return this.registros$.getValue();
  }

  getBilletesSnapshot(): Billete[] {
    return this.billetes$.getValue();
  }

  getGastosSnapshot(): Gasto[] {
    return this.gastos$.getValue();
  }

  getIngresosSnapshot(): IngresoCaja[] {
    return this.ingresos$.getValue();
  }

  getCierresSnapshot(): CierreCaja[] {
    return this.cierres$.getValue();
  }

  existsOperacionTransferencia(nroOperacion: string): boolean {
    const normalized = this.normalizeOperacionTransferencia(nroOperacion);
    if (!normalized) {
      return false;
    }

    return this.getRegistrosSnapshot().some(registro =>
      this.normalizeRegistroPagos(registro).some(pago =>
        this.isTransferenciaMedioKey(pago.medioPago)
        && this.normalizeOperacionTransferencia(pago.nroOperacion) === normalized
      )
    );
  }

  updateRegistros(list: Registro[]) {
    const safe = this.registrosRepository.save(list || []);
    this.registros$.next(safe);
  }

  addRegistro(registro: Omit<Registro, 'id' | 'createdAt' | 'updatedAt'>) {
    const current = this.getRegistrosSnapshot();
    const fechaOperativa = registro.fecha || this.todayDateKey();
    const createdAt = this.buildCreatedAtForOperationalDate(fechaOperativa);
    const next: Registro = {
      ...registro,
      id: crypto.randomUUID(),
      fecha: fechaOperativa,
      createdAt,
      updatedAt: createdAt
    };
    this.updateRegistros([...current, next]);
  }

  removeRegistro(id: string) {
    const next = this.getRegistrosSnapshot().filter(r => r.id !== id);
    this.updateRegistros(next);
  }

  clearRegistrosByDate(fecha: string) {
    const next = this.getRegistrosSnapshot().filter(item => (item.fecha || this.dateKey(item.createdAt)) !== fecha);
    this.updateRegistros(next);
  }

  updateBilletes(list: Billete[]) {
    this.billetes$.next(this.billetesRepository.save(list || []));
  }

  updateGastos(list: Gasto[]) {
    const safe = this.gastosRepository.save(list || []);
    this.gastos$.next(safe);
  }

  addGasto(gasto: Omit<Gasto, 'id' | 'createdAt' | 'updatedAt'>) {
    const current = this.getGastosSnapshot();
    const createdAt = new Date().toISOString();
    const next: Gasto = {
      ...gasto,
      id: crypto.randomUUID(),
      fecha: gasto.fecha || this.todayDateKey(),
      medioPago: (gasto.medioPago || 'EFECTIVO').toUpperCase(),
      createdAt,
      updatedAt: createdAt
    };
    this.updateGastos([...current, next]);
  }

  removeGasto(id: string) {
    const next = this.getGastosSnapshot().filter(item => item.id !== id);
    this.updateGastos(next);
  }

  updateIngresos(list: IngresoCaja[]) {
    const safe = this.ingresosRepository.save(list || []);
    this.ingresos$.next(safe);
  }

  addIngreso(ingreso: Omit<IngresoCaja, 'id' | 'createdAt' | 'updatedAt'>) {
    const current = this.getIngresosSnapshot();
    const createdAt = new Date().toISOString();
    const next: IngresoCaja = {
      ...ingreso,
      id: crypto.randomUUID(),
      fecha: ingreso.fecha || this.todayDateKey(),
      medioPago: (ingreso.medioPago || 'EFECTIVO').toUpperCase(),
      tipoIngreso: (ingreso.tipoIngreso || 'OTROS').toUpperCase(),
      createdAt,
      updatedAt: createdAt
    };
    this.updateIngresos([...current, next]);
  }

  removeIngreso(id: string) {
    const next = this.getIngresosSnapshot().filter(item => item.id !== id);
    this.updateIngresos(next);
  }

  updateCierres(list: CierreCaja[]) {
    const safe = this.cierresRepository.save(list || []);
    this.cierres$.next(safe);
  }

  async clearAllData() {
    await Promise.all([
      this.registrosRepository.clear({ column: 'id', operator: 'neq', value: '' }),
      this.gastosRepository.clear({ column: 'id', operator: 'neq', value: '' }),
      this.ingresosRepository.clear({ column: 'id', operator: 'neq', value: '' }),
      this.cierresRepository.clear({ column: 'id', operator: 'neq', value: '' }),
      this.billetesRepository.clear({ column: 'valor', operator: 'gte', value: 0 })
    ]);

    this.registros$.next([]);
    this.billetes$.next([]);
    this.gastos$.next([]);
    this.ingresos$.next([]);
    this.cierres$.next([]);
  }

  async clearTemporaryScenarioData(prefix: string): Promise<{ registros: number; ingresos: number; gastos: number; cierres: number }> {
    const normalizedPrefix = String(prefix || '').trim().toUpperCase();
    if (!normalizedPrefix) {
      return { registros: 0, ingresos: 0, gastos: 0, cierres: 0 };
    }

    const registrosActuales = this.getRegistrosSnapshot();
    const ingresosActuales = this.getIngresosSnapshot();
    const gastosActuales = this.getGastosSnapshot();
    const cierresActuales = this.getCierresSnapshot();

    const registrosRemovidos = registrosActuales.filter(item => this.matchesScenarioPrefix(item.id, normalizedPrefix));
    const ingresosRemovidos = ingresosActuales.filter(item => this.matchesScenarioPrefix(item.id, normalizedPrefix));
    const gastosRemovidos = gastosActuales.filter(item => this.matchesScenarioPrefix(item.id, normalizedPrefix));
    const cierresRemovidos = cierresActuales.filter(item => this.matchesScenarioPrefix(item.id, normalizedPrefix));

    if (!registrosRemovidos.length && !ingresosRemovidos.length && !gastosRemovidos.length && !cierresRemovidos.length) {
      return { registros: 0, ingresos: 0, gastos: 0, cierres: 0 };
    }

    this.updateCierres(cierresActuales.filter(item => !this.matchesScenarioPrefix(item.id, normalizedPrefix)));
    this.updateRegistros(registrosActuales.filter(item => !this.matchesScenarioPrefix(item.id, normalizedPrefix)));
    this.updateIngresos(ingresosActuales.filter(item => !this.matchesScenarioPrefix(item.id, normalizedPrefix)));
    this.updateGastos(gastosActuales.filter(item => !this.matchesScenarioPrefix(item.id, normalizedPrefix)));

    return {
      registros: registrosRemovidos.length,
      ingresos: ingresosRemovidos.length,
      gastos: gastosRemovidos.length,
      cierres: cierresRemovidos.length
    };
  }

  getCierreByFecha(fecha: string): CierreCaja | null {
    return this.getCierresByDate(fecha)[0] || null;
  }

  getCierresByDate(fecha: string): CierreCaja[] {
    return this.getCierresSnapshot()
      .filter(item => item.fecha === fecha)
      .sort((a, b) => this.compareCierresDesc(a, b));
  }

  getCierresByMonth(yearMonth: string): CierreCaja[] {
    return this.getCierresSnapshot()
      .filter(item => item.fecha.startsWith(yearMonth))
      .sort((a, b) => this.compareCierresDesc(a, b));
  }

  getDisponibleContinuidadPrevio(fecha: string): number {
    const previos = this.getCierresSnapshot()
      .filter(item => item.fecha < fecha)
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
    return previos.length ? Number(previos[0].disponibleContinuidad || 0) : 0;
  }

  getInicioDiaPorMedio(fecha: string): Record<string, number> {
    return this.buildInicioPorMedioFromCierre(this.getUltimoCierreAntesDe(fecha));
  }

  getInicioOperativoPorMedio(fecha: string): Record<string, number> {
    return this.buildInicioPorMedioFromCierre(this.getUltimoCierreHasta(fecha));
  }

  getCierreBaseDia(fecha: string): CierreCaja | null {
    return this.getUltimoCierreAntesDe(fecha);
  }

  getCierreBaseOperativa(fecha: string): CierreCaja | null {
    return this.getUltimoCierreHasta(fecha);
  }

  cerrarCajaDiaria(fecha: string, observacion?: string): CierreCaja {
    const registros = this.getRegistrosPendientesByDate(fecha);
    const ingresos = this.getIngresosPendientesByDate(fecha);
    const egresos = this.getGastosPendientesByDate(fecha);
    const resumen = this.getCajaPendienteParaCierre(fecha);
    const disponibleBase = Number(this.getDisponibleContinuidadParaNuevoCierre(fecha) || 0);
    const disponibleContinuidad = disponibleBase + Number(resumen.saldo.efectivo || 0);

    const createdAt = new Date().toISOString();
    const cierre: CierreCaja = {
      id: crypto.randomUUID(),
      fecha,
      createdAt,
      updatedAt: createdAt,
      totalIngresos: Number(resumen.totalIngresos || 0),
      totalGastos: Number(resumen.totalGastos || 0),
      totalNeto: Number(resumen.totalNeto || 0),
      detalleMedios: this.buildDetalleMediosCierre(resumen.ingresos, resumen.gastos, resumen.saldo),
      saldo: {
        efectivo: Number(resumen.saldo.efectivo || 0),
        cheques: Number(resumen.saldo.cheques || 0),
        posnet: Number(resumen.saldo.posnet || 0),
        deposito: Number(resumen.saldo.deposito || 0)
      },
      disponibleContinuidad,
      observacion: (observacion || '').trim(),
      referencias: {
        registroIds: registros.map(item => item.id).filter(Boolean) as string[],
        ingresoIds: ingresos.map(item => item.id).filter(Boolean) as string[],
        egresoIds: egresos.map(item => item.id).filter(Boolean) as string[]
      },
      resumenMovimientos: {
        registros: registros.length,
        ingresos: ingresos.length,
        egresos: egresos.length
      }
    };

    this.updateCierres([...this.getCierresSnapshot(), cierre]);
    return cierre;
  }

  getRegistrosPendientesByDate(fecha: string): Registro[] {
    const closed = this.buildClosedIds().registroIds;
    const ultimoCierreDia = this.getUltimoCierreDelDia(fecha);
    return this.getRegistrosByDate(fecha).filter(item => {
      if (closed.has(item.id)) {
        return false;
      }

      if (ultimoCierreDia && this.wasCreatedOnOrBeforeCut(item.createdAt, ultimoCierreDia.createdAt)) {
        return false;
      }

      return true;
    });
  }

  getIngresosPendientesByDate(fecha: string): IngresoCaja[] {
    const closed = this.buildClosedIds().ingresoIds;
    const ultimoCierreDia = this.getUltimoCierreDelDia(fecha);
    return this.getIngresosByDate(fecha).filter(item => {
      if (item.id && closed.has(item.id)) {
        return false;
      }

      if (ultimoCierreDia && this.wasCreatedOnOrBeforeCut(item.createdAt, ultimoCierreDia.createdAt)) {
        return false;
      }

      return true;
    });
  }

  getGastosPendientesByDate(fecha: string): Gasto[] {
    const closed = this.buildClosedIds().egresoIds;
    const ultimoCierreDia = this.getUltimoCierreDelDia(fecha);
    return this.getGastosByDate(fecha).filter(item => {
      if (item.id && closed.has(item.id)) {
        return false;
      }

      if (ultimoCierreDia && this.wasCreatedOnOrBeforeCut(item.createdAt, ultimoCierreDia.createdAt)) {
        return false;
      }

      return true;
    });
  }

  getCajaPendienteParaCierre(fecha: string) {
    const registrosPendientes = this.getRegistrosPendientesByDate(fecha);
    const ingresosPendientes = this.getIngresosPendientesByDate(fecha);
    const gastosPendientes = this.getGastosPendientesByDate(fecha);

    const ingresosRegistros = this.computeTotalesMedioPago(registrosPendientes);
    const ingresosManuales = this.computeTotalesIngresosPorMedio(ingresosPendientes);
    const ingresos = this.mergeTotales(ingresosRegistros, ingresosManuales);
    const gastos = this.computeTotalesGastosPorMedio(gastosPendientes);

    const ingresosOtros = Object.values(ingresos.otros || {}).reduce((sum, value) => sum + value, 0);
    const gastosOtros = Object.values(gastos.otros || {}).reduce((sum, value) => sum + value, 0);

    const totalIngresos = ingresos.efectivo + ingresos.cheques + ingresos.posnet + ingresos.deposito + ingresosOtros;
    const totalGastos = gastos.efectivo + gastos.cheques + gastos.posnet + gastos.deposito + gastosOtros;

    return {
      fecha,
      ingresos,
      gastos,
      saldo: {
        efectivo: ingresos.efectivo - gastos.efectivo,
        cheques: ingresos.cheques - gastos.cheques,
        posnet: ingresos.posnet - gastos.posnet,
        deposito: ingresos.deposito - gastos.deposito
      },
      totalIngresos,
      totalGastos,
      totalNeto: totalIngresos - totalGastos
    };
  }

  getDisponibleContinuidadParaNuevoCierre(fecha: string): number {
    return Number(this.getInicioOperativoPorMedio(fecha).EFECTIVO || 0);
  }

  getRegistrosByDate(fecha: string): Registro[] {
    return this.getRegistrosSnapshot().filter(item => (item.fecha || this.dateKey(item.createdAt)) === fecha);
  }

  getGastosByDate(fecha: string): Gasto[] {
    return this.getGastosSnapshot().filter(item => (item.fecha || this.dateKey(item.createdAt)) === fecha);
  }

  getIngresosByDate(fecha: string): IngresoCaja[] {
    return this.getIngresosSnapshot().filter(item => (item.fecha || this.dateKey(item.createdAt)) === fecha);
  }

  getCajaDiaria(fecha: string) {
    const registrosDia = this.getRegistrosByDate(fecha);
    const gastosDia = this.getGastosByDate(fecha);
    const ingresosDia = this.getIngresosByDate(fecha);

    const ingresosRegistros = this.computeTotalesMedioPago(registrosDia);
    const ingresosManuales = this.computeTotalesIngresosPorMedio(ingresosDia);
    const ingresos = this.mergeTotales(ingresosRegistros, ingresosManuales);
    const gastos = this.computeTotalesGastosPorMedio(gastosDia);

    const ingresosOtros = Object.values(ingresos.otros || {}).reduce((sum, value) => sum + value, 0);
    const gastosOtros = Object.values(gastos.otros || {}).reduce((sum, value) => sum + value, 0);

    const totalIngresos = ingresos.efectivo + ingresos.cheques + ingresos.posnet + ingresos.deposito + ingresosOtros;
    const totalGastos = gastos.efectivo + gastos.cheques + gastos.posnet + gastos.deposito + gastosOtros;

    return {
      fecha,
      ingresos,
      gastos,
      saldo: {
        efectivo: ingresos.efectivo - gastos.efectivo,
        cheques: ingresos.cheques - gastos.cheques,
        posnet: ingresos.posnet - gastos.posnet,
        deposito: ingresos.deposito - gastos.deposito
      },
      totalIngresos,
      totalGastos,
      totalNeto: totalIngresos - totalGastos
    };
  }

  computeTotalesMedioPago(regs: Registro[]): TotalesMedioPago {
    const acc: TotalesMedioPago = { efectivo: 0, cheques: 0, posnet: 0, deposito: 0, otros: {} };
    regs.forEach(r => {
      if (r.pagosDetalle?.length) {
        r.pagosDetalle.forEach(pago => this.applyPagoToTotals(acc, pago));
        return;
      }

      const medio = (r.medioPago || '').toString().toUpperCase();
      this.applyPagoToTotals(acc, { medioPago: medio, monto: Number(r.subtotal || 0) });
    });
    return acc;
  }

  private applyPagoToTotals(acc: TotalesMedioPago, pago: RegistroPagoDetalle) {
    const medio = this.normalizeMedioKey(pago.medioPago);
    const monto = Number(pago.monto || 0);
    switch (medio) {
      case 'EFECTIVO':
        acc.efectivo += monto;
        break;
      case 'CHEQUES':
        acc.cheques += monto;
        break;
      case 'POSNET':
        acc.posnet += monto;
        break;
      case 'DEPOSITO':
        acc.deposito += monto;
        break;
      default:
        if (!medio) return;
        acc.otros = acc.otros || {};
        acc.otros[medio] = (acc.otros[medio] || 0) + monto;
        break;
    }
  }

  private computeTotalesGastosPorMedio(gastos: Gasto[]): TotalesMedioPago {
    const acc: TotalesMedioPago = { efectivo: 0, cheques: 0, posnet: 0, deposito: 0, otros: {} };
    gastos.forEach(item => {
      this.applyPagoToTotals(acc, {
        medioPago: (item.medioPago || 'EFECTIVO').toUpperCase(),
        monto: Number(item.monto || 0)
      });
    });
    return acc;
  }

  private computeTotalesIngresosPorMedio(ingresos: IngresoCaja[]): TotalesMedioPago {
    const acc: TotalesMedioPago = { efectivo: 0, cheques: 0, posnet: 0, deposito: 0, otros: {} };
    ingresos.forEach(item => {
      this.applyPagoToTotals(acc, {
        medioPago: (item.medioPago || 'EFECTIVO').toUpperCase(),
        monto: Number(item.monto || 0)
      });
    });
    return acc;
  }

  private mergeTotales(a: TotalesMedioPago, b: TotalesMedioPago): TotalesMedioPago {
    const mergedOtros: Record<string, number> = {};
    const keys = [...new Set([...Object.keys(a.otros || {}), ...Object.keys(b.otros || {})])];
    keys.forEach(key => {
      mergedOtros[key] = Number((a.otros || {})[key] || 0) + Number((b.otros || {})[key] || 0);
    });

    return {
      efectivo: Number(a.efectivo || 0) + Number(b.efectivo || 0),
      cheques: Number(a.cheques || 0) + Number(b.cheques || 0),
      posnet: Number(a.posnet || 0) + Number(b.posnet || 0),
      deposito: Number(a.deposito || 0) + Number(b.deposito || 0),
      otros: mergedOtros
    };
  }

  private matchesScenarioPrefix(id: string | undefined, prefix: string): boolean {
    return String(id || '').trim().toUpperCase().startsWith(prefix);
  }

  private buildDetalleMediosCierre(
    ingresos: TotalesMedioPago,
    egresos: TotalesMedioPago,
    saldo: { efectivo: number; cheques: number; posnet: number; deposito: number }
  ) {
    const mediosBase = ['EFECTIVO', 'CHEQUES', 'POSNET', 'DEPOSITO'];
    const otros = [...new Set([...Object.keys(ingresos.otros || {}), ...Object.keys(egresos.otros || {})])]
      .filter(Boolean)
      .sort();

    const detalleBase = [
      {
        medioPago: 'EFECTIVO',
        ingresos: Number(ingresos.efectivo || 0),
        egresos: Number(egresos.efectivo || 0),
        saldo: Number(saldo.efectivo || 0)
      },
      {
        medioPago: 'CHEQUES',
        ingresos: Number(ingresos.cheques || 0),
        egresos: Number(egresos.cheques || 0),
        saldo: Number(saldo.cheques || 0)
      },
      {
        medioPago: 'POSNET',
        ingresos: Number(ingresos.posnet || 0),
        egresos: Number(egresos.posnet || 0),
        saldo: Number(saldo.posnet || 0)
      },
      {
        medioPago: 'DEPOSITO',
        ingresos: Number(ingresos.deposito || 0),
        egresos: Number(egresos.deposito || 0),
        saldo: Number(saldo.deposito || 0)
      }
    ];

    const detalleOtros = otros
      .filter(key => !mediosBase.includes(key))
      .map(key => {
        const ingresosKey = Number((ingresos.otros || {})[key] || 0);
        const egresosKey = Number((egresos.otros || {})[key] || 0);
        return {
          medioPago: key,
          ingresos: ingresosKey,
          egresos: egresosKey,
          saldo: ingresosKey - egresosKey
        };
      });

    return [...detalleBase, ...detalleOtros].filter(item => item.ingresos !== 0 || item.egresos !== 0 || item.saldo !== 0);
  }

  generarResumen(regs: Registro[], gastos: Gasto[]): CierreResumen {
    const totales = this.computeTotalesMedioPago(regs);
    const totalIngresos = regs.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
    const totalGastos = gastos.reduce((sum, item) => sum + Number(item.monto || 0), 0);

    const resumen: CierreResumen = {
      totalArancelesAuto: totalIngresos,
      totalSelladoAuto: regs.reduce((s, r) => s + (r.sellados || 0), 0),
      totalFormularios: 0,
      totalArancelesMoto: 0,
      totalesMedioPago: totales,
      gastos,
      totalGastos,
      totalIngresos,
      totalFinalNeto: totalIngresos - totalGastos
    };
    return resumen;
  }

  private todayDateKey(): string {
    return this.toDateKeyLocal(new Date());
  }

  private dateKey(input?: string): string {
    if (!input) return this.todayDateKey();
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) {
      return this.todayDateKey();
    }
    return this.toDateKeyLocal(parsed);
  }

  private toDateKeyLocal(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private buildCreatedAtForOperationalDate(fecha: string): string {
    const now = new Date();
    const [year, month, day] = String(fecha || '').split('-').map(value => Number(value));

    if (!year || !month || !day) {
      return now.toISOString();
    }

    const operationalDate = new Date(
      year,
      month - 1,
      day,
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
      now.getMilliseconds()
    );

    return operationalDate.toISOString();
  }

  private getUltimoCierreAntesDe(fecha: string): CierreCaja | null {
    return this.getCierresSnapshot()
      .filter(item => item.fecha < fecha)
      .sort((a, b) => this.compareCierresDesc(a, b))[0] || null;
  }

  private getUltimoCierreHasta(fecha: string): CierreCaja | null {
    return this.getCierresSnapshot()
      .filter(item => item.fecha <= fecha)
      .sort((a, b) => this.compareCierresDesc(a, b))[0] || null;
  }

  private getUltimoCierreDelDia(fecha: string): CierreCaja | null {
    return this.getCierresByDate(fecha)[0] || null;
  }

  private wasCreatedOnOrBeforeCut(createdAt: string | undefined, cutCreatedAt: string | undefined): boolean {
    if (!createdAt || !cutCreatedAt) {
      return false;
    }

    return String(createdAt) <= String(cutCreatedAt);
  }

  private buildInicioPorMedioFromCierre(cierre: CierreCaja | null): Record<string, number> {
    const inicio: Record<string, number> = {
      EFECTIVO: Number(cierre?.disponibleContinuidad || 0),
      CHEQUES: Number(cierre?.saldo.cheques || 0),
      POSNET: Number(cierre?.saldo.posnet || 0),
      DEPOSITO: Number(cierre?.saldo.deposito || 0)
    };

    (cierre?.detalleMedios || []).forEach(item => {
      const key = this.normalizeMedioKey(item.medioPago);
      if (!key || key === 'EFECTIVO') {
        return;
      }

      inicio[key] = Number(item.saldo || 0);
    });

    return inicio;
  }

  private normalizeMedioKey(value?: string): string {
    return (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();
  }

  private buildClosedIds() {
    const refs = this.getCierresSnapshot().reduce(
      (acc, cierre) => {
        (cierre.referencias?.registroIds || []).forEach(id => acc.registroIds.add(id));
        (cierre.referencias?.ingresoIds || []).forEach(id => acc.ingresoIds.add(id));
        (cierre.referencias?.egresoIds || []).forEach(id => acc.egresoIds.add(id));
        return acc;
      },
      {
        registroIds: new Set<string>(),
        ingresoIds: new Set<string>(),
        egresoIds: new Set<string>()
      }
    );

    return refs;
  }

  private compareCierresDesc(a: CierreCaja, b: CierreCaja): number {
    const byFecha = b.fecha.localeCompare(a.fecha);
    if (byFecha !== 0) return byFecha;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  }

  private async hydrateFromSupabase() {
    const [registros, billetes, gastos, ingresos, cierres] = await Promise.all([
      this.registrosRepository.hydrate(),
      this.billetesRepository.hydrate(),
      this.gastosRepository.hydrate(),
      this.ingresosRepository.hydrate(),
      this.cierresRepository.hydrate()
    ]);

    if (registros) {
      this.registros$.next(registros);
    }

    if (billetes) {
      this.billetes$.next(billetes);
    }

    if (gastos) {
      this.gastos$.next(gastos);
    }

    if (ingresos) {
      this.ingresos$.next(ingresos);
    }

    if (cierres) {
      this.cierres$.next(cierres);
    }
  }

  private normalizeBilletes(list: Billete[]): Billete[] {
    return (list || []).map(item => ({
      valor: Number(item.valor || 0),
      cantidad: Number(item.cantidad || 0),
      subtotal: Number(item.subtotal || 0)
    }));
  }

  private normalizeRegistros(list: Registro[]): Registro[] {
    return (list || []).map(item => {
      const pagosDetalle = this.normalizeRegistroPagos(item);
      return {
        ...item,
        id: item.id || crypto.randomUUID(),
        pagosDetalle,
        medioPago: pagosDetalle[0]?.medioPago || (item.medioPago || 'EFECTIVO').toUpperCase(),
        fecha: this.normalizeRegistroFecha(item),
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || item.createdAt || new Date().toISOString()
      };
    });
  }

  private normalizeRegistroPagos(item: Registro): RegistroPagoDetalle[] {
    if (item.pagosDetalle?.length) {
      return item.pagosDetalle
        .map(pago => ({
          medioPago: String(pago.medioPago || '').trim().toUpperCase(),
          monto: Number(pago.monto || 0),
          nroOperacion: this.isTransferenciaMedioKey(pago.medioPago)
            ? this.normalizeOperacionTransferencia(pago.nroOperacion)
            : undefined,
          fechaTransferencia: this.isTransferenciaMedioKey(pago.medioPago)
            ? String(pago.fechaTransferencia || '').trim() || undefined
            : undefined
        }))
        .filter(pago => pago.medioPago && pago.monto > 0);
    }

    const legacyPagos: RegistroPagoDetalle[] = [
      { medioPago: 'EFECTIVO', monto: Number(item.efectivo || 0) },
      { medioPago: 'CHEQUES', monto: Number(item.cheques || 0) },
      { medioPago: 'POSNET', monto: Number(item.posnet || 0) },
      { medioPago: 'VEP', monto: Number(item.vep || 0) },
      { medioPago: 'SITE', monto: Number(item.site || 0) },
      { medioPago: 'DEPOSITO', monto: Number(item.deposito || 0) }
    ].filter(pago => pago.monto > 0);

    if (legacyPagos.length) {
      return legacyPagos;
    }

    const medioPago = String(item.medioPago || '').trim().toUpperCase();
    const subtotal = Number(item.subtotal || 0);
    if (!medioPago || subtotal <= 0) {
      return [];
    }

    return [{ medioPago, monto: subtotal }];
  }

  private isTransferenciaMedioKey(value?: string): boolean {
    return /TRANSFER|CBU|CVU/.test(this.normalizeMedioKey(value));
  }

  private normalizeOperacionTransferencia(value?: string): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '')
      .trim()
      .toUpperCase();
  }

  private normalizeRegistroFecha(item: Registro): string {
    const createdAt = item.createdAt || new Date().toISOString();
    const localDate = this.dateKey(createdAt);
    const utcDate = String(createdAt).slice(0, 10);

    if (!item.fecha) {
      return localDate;
    }

    if (item.fecha === utcDate && utcDate !== localDate) {
      return localDate;
    }

    return item.fecha;
  }

  private normalizeGastos(list: Gasto[]): Gasto[] {
    return (list || []).map(item => ({
      ...item,
      id: item.id || crypto.randomUUID(),
      fecha: item.fecha || this.todayDateKey(),
      medioPago: (item.medioPago || 'EFECTIVO').toUpperCase(),
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString()
    }));
  }

  private normalizeIngresos(list: IngresoCaja[]): IngresoCaja[] {
    return (list || []).map(item => ({
      ...item,
      id: item.id || crypto.randomUUID(),
      fecha: item.fecha || this.todayDateKey(),
      medioPago: (item.medioPago || 'EFECTIVO').toUpperCase(),
      tipoIngreso: (item.tipoIngreso || 'OTROS').toUpperCase(),
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString()
    }));
  }

  private normalizeCierres(list: CierreCaja[]): CierreCaja[] {
    return (list || []).map(item => ({
      ...item,
      id: item.id || crypto.randomUUID(),
      detalleMedios: (item.detalleMedios || []).map(d => ({
        medioPago: d.medioPago,
        ingresos: Number(d.ingresos || 0),
        egresos: Number(d.egresos || 0),
        saldo: Number(d.saldo || 0)
      })),
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
      referencias: {
        registroIds: [...new Set((item.referencias?.registroIds || []).filter(Boolean))],
        ingresoIds: [...new Set((item.referencias?.ingresoIds || []).filter(Boolean))],
        egresoIds: [...new Set((item.referencias?.egresoIds || []).filter(Boolean))]
      }
    }));
  }
}
