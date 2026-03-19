import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Registro, TotalesMedioPago, Billete, Gasto, CierreResumen, RegistroPagoDetalle, IngresoCaja, CierreCaja } from '../../shared/models/finance.model';
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

  private registros$ = new BehaviorSubject<Registro[]>(this.readStorage<Registro[]>(this.STORAGE_REGISTROS, []));
  registros = this.registros$.asObservable();

  private billetes$ = new BehaviorSubject<Billete[]>(this.readStorage<Billete[]>(this.STORAGE_BILLETES, []));
  billetes = this.billetes$.asObservable();

  private gastos$ = new BehaviorSubject<Gasto[]>(this.readStorage<Gasto[]>(this.STORAGE_GASTOS, []));
  gastos = this.gastos$.asObservable();

  private ingresos$ = new BehaviorSubject<IngresoCaja[]>(this.readStorage<IngresoCaja[]>(this.STORAGE_INGRESOS, []));
  ingresos = this.ingresos$.asObservable();

  private cierres$ = new BehaviorSubject<CierreCaja[]>(this.readStorage<CierreCaja[]>(this.STORAGE_CIERRES, []));
  cierres = this.cierres$.asObservable();

  constructor(private supabase: SupabaseService, private logger: LoggerService) {
    this.hydrateFromSupabase();
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

  updateRegistros(list: Registro[]) {
    const safe = (list || []).map(r => ({
      ...r,
      id: r.id || crypto.randomUUID(),
      createdAt: r.createdAt || new Date().toISOString()
    }));
    this.registros$.next(safe);
    this.writeStorage(this.STORAGE_REGISTROS, safe);
    this.pushRemote(this.TABLE_REGISTROS, safe, 'id');
  }

  addRegistro(registro: Omit<Registro, 'id' | 'createdAt'>) {
    const current = this.getRegistrosSnapshot();
    const next: Registro = {
      ...registro,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };
    this.updateRegistros([...current, next]);
  }

  removeRegistro(id: string) {
    const next = this.getRegistrosSnapshot().filter(r => r.id !== id);
    this.updateRegistros(next);
  }

  clearRegistrosByDate(fecha: string) {
    const next = this.getRegistrosSnapshot().filter(item => this.dateKey(item.createdAt) !== fecha);
    this.updateRegistros(next);
  }

  updateBilletes(list: Billete[]) {
    this.billetes$.next(list || []);
    this.writeStorage(this.STORAGE_BILLETES, list || []);
    this.pushRemote(this.TABLE_BILLETES, list || [], 'valor');
  }

  updateGastos(list: Gasto[]) {
    const safe = (list || []).map(item => ({
      ...item,
      id: item.id || crypto.randomUUID(),
      fecha: item.fecha || this.todayDateKey(),
      medioPago: (item.medioPago || 'EFECTIVO').toUpperCase(),
      createdAt: item.createdAt || new Date().toISOString()
    }));
    this.gastos$.next(safe);
    this.writeStorage(this.STORAGE_GASTOS, safe);
    this.pushRemote(this.TABLE_GASTOS, safe, 'id');
  }

  addGasto(gasto: Omit<Gasto, 'id' | 'createdAt'>) {
    const current = this.getGastosSnapshot();
    const next: Gasto = {
      ...gasto,
      id: crypto.randomUUID(),
      fecha: gasto.fecha || this.todayDateKey(),
      medioPago: (gasto.medioPago || 'EFECTIVO').toUpperCase(),
      createdAt: new Date().toISOString()
    };
    this.updateGastos([...current, next]);
  }

  removeGasto(id: string) {
    const next = this.getGastosSnapshot().filter(item => item.id !== id);
    this.updateGastos(next);
  }

  updateIngresos(list: IngresoCaja[]) {
    const safe = (list || []).map(item => ({
      ...item,
      id: item.id || crypto.randomUUID(),
      fecha: item.fecha || this.todayDateKey(),
      medioPago: (item.medioPago || 'EFECTIVO').toUpperCase(),
      tipoIngreso: (item.tipoIngreso || 'OTROS').toUpperCase(),
      createdAt: item.createdAt || new Date().toISOString()
    }));
    this.ingresos$.next(safe);
    this.writeStorage(this.STORAGE_INGRESOS, safe);
    this.pushRemote(this.TABLE_INGRESOS, safe, 'id');
  }

  addIngreso(ingreso: Omit<IngresoCaja, 'id' | 'createdAt'>) {
    const current = this.getIngresosSnapshot();
    const next: IngresoCaja = {
      ...ingreso,
      id: crypto.randomUUID(),
      fecha: ingreso.fecha || this.todayDateKey(),
      medioPago: (ingreso.medioPago || 'EFECTIVO').toUpperCase(),
      tipoIngreso: (ingreso.tipoIngreso || 'OTROS').toUpperCase(),
      createdAt: new Date().toISOString()
    };
    this.updateIngresos([...current, next]);
  }

  removeIngreso(id: string) {
    const next = this.getIngresosSnapshot().filter(item => item.id !== id);
    this.updateIngresos(next);
  }

  updateCierres(list: CierreCaja[]) {
    const safe = (list || []).map(item => ({
      ...item,
      id: item.id || crypto.randomUUID(),
      detalleMedios: (item.detalleMedios || []).map(d => ({
        medioPago: d.medioPago,
        ingresos: Number(d.ingresos || 0),
        egresos: Number(d.egresos || 0),
        saldo: Number(d.saldo || 0)
      })),
      createdAt: item.createdAt || new Date().toISOString()
    }));
    this.cierres$.next(safe);
    this.writeStorage(this.STORAGE_CIERRES, safe);
    this.pushRemote(this.TABLE_CIERRES, safe, 'id');
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
    const previos = this.getCierresSnapshot()
      .filter(item => item.fecha <= fecha)
      .sort((a, b) => this.compareCierresDesc(a, b));

    const ultimo = previos[0];
    if (!ultimo) {
      return {
        EFECTIVO: 0,
        CHEQUES: 0,
        POSNET: 0,
        DEPOSITO: 0
      };
    }

    const inicio: Record<string, number> = {
      EFECTIVO: Number(ultimo.disponibleContinuidad || 0),
      CHEQUES: Number(ultimo.saldo.cheques || 0),
      POSNET: Number(ultimo.saldo.posnet || 0),
      DEPOSITO: Number(ultimo.saldo.deposito || 0)
    };

    (ultimo.detalleMedios || []).forEach(item => {
      const key = this.normalizeMedioKey(item.medioPago);
      if (!key || key === 'EFECTIVO') return;
      inicio[key] = Number(item.saldo || 0);
    });

    return inicio;
  }

  cerrarCajaDiaria(fecha: string, observacion?: string): CierreCaja {
    const registros = this.getRegistrosPendientesByDate(fecha);
    const ingresos = this.getIngresosPendientesByDate(fecha);
    const egresos = this.getGastosPendientesByDate(fecha);
    const resumen = this.getCajaPendienteParaCierre(fecha);
    const disponibleBase = Number(this.getDisponibleContinuidadParaNuevoCierre(fecha) || 0);
    const disponibleContinuidad = disponibleBase + Number(resumen.saldo.efectivo || 0);

    const cierre: CierreCaja = {
      id: crypto.randomUUID(),
      fecha,
      createdAt: new Date().toISOString(),
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
    return this.getRegistrosByDate(fecha).filter(item => !closed.has(item.id));
  }

  getIngresosPendientesByDate(fecha: string): IngresoCaja[] {
    const closed = this.buildClosedIds().ingresoIds;
    return this.getIngresosByDate(fecha).filter(item => !item.id || !closed.has(item.id));
  }

  getGastosPendientesByDate(fecha: string): Gasto[] {
    const closed = this.buildClosedIds().egresoIds;
    return this.getGastosByDate(fecha).filter(item => !item.id || !closed.has(item.id));
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
    const ultimo = this.getCierresSnapshot()
      .filter(item => item.fecha <= fecha)
      .sort((a, b) => this.compareCierresDesc(a, b))[0];
    return Number(ultimo?.disponibleContinuidad || 0);
  }

  getRegistrosByDate(fecha: string): Registro[] {
    return this.getRegistrosSnapshot().filter(item => this.dateKey(item.createdAt) === fecha);
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

  private readStorage<T>(key: string, fallback: T): T {
    try {
      const value = localStorage.getItem(key);
      if (!value) return fallback;
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  private writeStorage<T>(key: string, value: T) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  private todayDateKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private dateKey(input?: string): string {
    if (!input) return new Date().toISOString().slice(0, 10);
    return new Date(input).toISOString().slice(0, 10);
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
    if (!this.supabase.isEnabled()) {
      return;
    }

    try {
      const [registros, billetes, gastos, ingresos, cierres] = await Promise.all([
        this.supabase.fetchRows<Registro>(this.TABLE_REGISTROS),
        this.supabase.fetchRows<Billete>(this.TABLE_BILLETES, 'valor'),
        this.supabase.fetchRows<Gasto>(this.TABLE_GASTOS),
        this.supabase.fetchRows<IngresoCaja>(this.TABLE_INGRESOS),
        this.supabase.fetchRows<CierreCaja>(this.TABLE_CIERRES)
      ]);

      if (registros.length) {
        this.registros$.next(registros);
        this.writeStorage(this.STORAGE_REGISTROS, registros);
      }

      if (billetes.length) {
        this.billetes$.next(billetes);
        this.writeStorage(this.STORAGE_BILLETES, billetes);
      }

      if (gastos.length) {
        this.gastos$.next(gastos);
        this.writeStorage(this.STORAGE_GASTOS, gastos);
      }

      if (ingresos.length) {
        this.ingresos$.next(ingresos);
        this.writeStorage(this.STORAGE_INGRESOS, ingresos);
      }

      if (cierres.length) {
        this.cierres$.next(cierres);
        this.writeStorage(this.STORAGE_CIERRES, cierres);
      }
    } catch (error) {
      this.logger.warn('No se pudo hidratar desde Supabase. Se mantiene modo local.', error);
    }
  }

  private pushRemote<T extends object>(table: string, rows: T[], onConflict?: string) {
    if (!this.supabase.isEnabled()) {
      return;
    }

    this.supabase.upsertRows(table, rows, onConflict).catch(error => {
      this.logger.warn(`No se pudo sincronizar la tabla ${table} en Supabase.`, error);
    });
  }
}
