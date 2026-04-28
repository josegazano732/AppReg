import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, auditTime, merge, takeUntil } from 'rxjs';
import { CajaService } from '../../core/services/caja.service';
import { ConfigService } from '../../core/services/config.service';
import { ConciliacionBancariaService, OpcionMovimientoConciliacion } from '../../core/services/conciliacion-bancaria.service';
import { CierreCaja, Gasto, IngresoCaja, Registro } from '../../shared/models/finance.model';

interface ConciliacionPagoContexto {
  registroId: string;
  ordenPago: number;
  nroOperacion?: string;
  fechaTransferencia?: string;
  nroCuit?: string;
}

interface MovimientoLineaBase {
  medioPago: string;
  fecha: string;
  createdAt: string;
  origen: 'REGISTRO' | 'INGRESO' | 'EGRESO';
  referencia: string;
  detalle: string;
  monto: number;
  estadoConciliacionVisual?: 'CONCILIADO' | 'PENDIENTE' | 'REVISAR';
  conciliacionPago?: ConciliacionPagoContexto;
}

interface MovimientoLinea extends MovimientoLineaBase {
  tipo: 'MOVIMIENTO';
  saldoAcumulado: number;
}

interface CierreLinea {
  tipo: 'CIERRE';
  fecha: string;
  createdAt: string;
  referencia: string;
  detalle: string;
  cierre: CierreCaja;
}

type TimelineRow = MovimientoLinea | CierreLinea;
type TimelineSeed = MovimientoLineaBase | CierreLinea;

@Component({
  selector: 'app-movimientos-medios',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './movimientos-medios.component.html',
  styleUrls: ['./movimientos-medios.component.css']
})
export class MovimientosMediosComponent implements OnInit, OnDestroy {
  readonly hoy: string;
  readonly pageSizeOptions = [25, 50, 100, 200];
  fechaDesde = '';
  fechaHasta: string;
  medioSeleccionado = 'TODOS';
  filtroConciliacionTransferencia: 'TODAS' | 'PENDIENTE' | 'REVISAR' = 'TODAS';
  ordenSeleccionado: 'ASC' | 'DESC' = 'DESC';
  pageSize = 50;
  currentPage = 1;

  mediosDisponibles: string[] = [];
  lineas: TimelineRow[] = [];
  pagedLineas: TimelineRow[] = [];
  movimientos: MovimientoLinea[] = [];
  totalLineas = 0;
  totalNeto = 0;
  conciliacionError = '';
  conciliacionMessage = '';
  panelConciliacionAbierto: Record<string, boolean> = {};
  opcionesConciliacionPago: Record<string, OpcionMovimientoConciliacion[]> = {};
  seleccionMovimientoConciliacion: Record<string, string> = {};
  private pagosConciliados = new Set<string>();
  private estadosPorOperacion = new Map<string, 'PENDIENTE' | 'REVISAR'>();

  private readonly destroy$ = new Subject<void>();

  constructor(
    private caja: CajaService,
    private config: ConfigService,
    private conciliacion: ConciliacionBancariaService
  ) {
    this.hoy = this.caja.getTodayDateKey();
    this.fechaHasta = this.hoy;
  }

  ngOnInit() {
    this.refresh();

    merge(this.config.medios, this.caja.registros, this.caja.ingresos, this.caja.gastos, this.caja.cierres, this.conciliacion.movimientos)
      .pipe(auditTime(40), takeUntil(this.destroy$))
      .subscribe(() => this.refresh());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onFiltrosChange() {
    if (this.fechaDesde && this.fechaHasta && this.fechaDesde > this.fechaHasta) {
      this.fechaHasta = this.fechaDesde;
    }

    this.currentPage = 1;
    this.refresh();
  }

  onPageSizeChange() {
    this.currentPage = 1;
    this.refreshPagination();
  }

  goToPage(page: number) {
    const nextPage = Math.min(Math.max(1, Number(page || 1)), this.totalPages);
    if (nextPage === this.currentPage) {
      return;
    }

    this.currentPage = nextPage;
    this.refreshPagination();
  }

  limpiarFiltros() {
    this.fechaDesde = '';
    this.fechaHasta = this.hoy;
    this.medioSeleccionado = 'TODOS';
    this.filtroConciliacionTransferencia = 'TODAS';
    this.ordenSeleccionado = 'DESC';
    this.pageSize = 50;
    this.currentPage = 1;
    this.refresh();
  }

  usarMesActual() {
    this.fechaHasta = this.hoy;
    this.fechaDesde = this.hoy.slice(0, 8) + '01';
    this.refresh();
  }

  trackByLinea(_: number, item: TimelineRow): string {
    return item.tipo === 'CIERRE'
      ? `cierre-${item.referencia}-${item.createdAt}`
      : `${item.medioPago}-${item.origen}-${item.referencia}-${item.createdAt}-${item.monto}`;
  }

  copyReference(value: string) {
    const text = String(value || '').trim();
    if (!text) {
      return;
    }

    navigator.clipboard?.writeText(text).catch(() => {});
  }

  shortReference(value: string): string {
    const text = String(value || '').trim();
    if (text.length <= 10) {
      return text || '-';
    }

    return `${text.slice(0, 4)}...${text.slice(-4)}`;
  }

  toggleConciliacionPanel(item: MovimientoLinea) {
    const key = this.getConciliacionPagoKey(item);
    if (!key) {
      return;
    }

    this.conciliacionError = '';
    this.conciliacionMessage = '';
    const nextState = !this.panelConciliacionAbierto[key];
    this.panelConciliacionAbierto[key] = nextState;

    if (nextState) {
      this.prepararOpcionesConciliacion(item);
    }
  }

  aplicarConciliacionDesdeMovimiento(item: MovimientoLinea) {
    const contexto = item.conciliacionPago;
    const key = this.getConciliacionPagoKey(item);
    const movimientoId = key ? String(this.seleccionMovimientoConciliacion[key] || '') : '';
    if (!contexto || !key) {
      return;
    }

    if (!movimientoId) {
      this.conciliacionError = 'Selecciona un movimiento bancario antes de conciliar.';
      this.conciliacionMessage = '';
      return;
    }

    try {
      this.conciliacion.aplicarConciliacionDesdePago(contexto.registroId, contexto.ordenPago, movimientoId);
      this.conciliacionMessage = `Pago ${contexto.ordenPago} conciliado. Se guardaron la operacion bancaria y la fecha banco.`;
      this.conciliacionError = '';
      this.panelConciliacionAbierto[key] = false;
      this.refresh();
    } catch (error) {
      this.conciliacionError = error instanceof Error ? error.message : 'No se pudo aplicar la conciliacion.';
      this.conciliacionMessage = '';
    }
  }

  puedeConciliarDesdeFila(item: MovimientoLinea): boolean {
    return item.origen === 'REGISTRO'
      && this.isTransferenciaMacro(item.medioPago)
      && Boolean(item.conciliacionPago)
      && item.estadoConciliacionVisual !== 'CONCILIADO';
  }

  getOpcionesConciliacion(item: MovimientoLinea): OpcionMovimientoConciliacion[] {
    const key = this.getConciliacionPagoKey(item);
    return key ? this.opcionesConciliacionPago[key] || [] : [];
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.lineas.length / this.pageSize));
  }

  get pageStart(): number {
    if (!this.lineas.length) {
      return 0;
    }

    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageEnd(): number {
    return Math.min(this.currentPage * this.pageSize, this.lineas.length);
  }

  private refresh() {
    this.pagosConciliados = this.buildPagosConciliadosSet();
    this.estadosPorOperacion = this.buildEstadosPorOperacionMap();

    const movimientosHastaFecha = this.buildMovimientosHastaFecha();
    const movimientosVisibles = movimientosHastaFecha.filter(item => this.isWithinRange(item.fecha));
    const mediosData = [...new Set(movimientosVisibles.map(item => item.medioPago))].sort((a, b) => a.localeCompare(b));
    const mediosConfig = this.config.getMedios().map(item => this.normalizeMedio(item));
    this.mediosDisponibles = ['TODOS', ...new Set([...mediosConfig, ...mediosData].filter(Boolean))];

    if (this.medioSeleccionado !== 'TODOS' && !this.mediosDisponibles.includes(this.medioSeleccionado)) {
      this.medioSeleccionado = 'TODOS';
    }

    const cierres = this.buildLineasDeCierreHastaFecha(this.caja.getCierresSnapshot());

    const timelineAsc = this.mergeLineasAsc(movimientosHastaFecha, cierres);
    const timelineCalculado = this.buildTimelineConSaldos(timelineAsc);
    const lineasVisibles = timelineCalculado.filter(item => this.isVisibleRow(item));

    this.movimientos = lineasVisibles.filter(this.isMovimiento);
    this.lineas = this.ordenSeleccionado === 'DESC' ? [...lineasVisibles].reverse() : lineasVisibles;
    this.totalLineas = this.movimientos.length;
    this.totalNeto = this.movimientos.reduce((sum, item) => sum + item.monto, 0);
    this.refreshPagination();
  }

  private refreshPagination() {
    const totalPages = this.totalPages;
    if (this.currentPage > totalPages) {
      this.currentPage = totalPages;
    }

    const startIndex = (this.currentPage - 1) * this.pageSize;
    this.pagedLineas = this.lineas.slice(startIndex, startIndex + this.pageSize);
  }

  private buildMovimientosHastaFecha(): MovimientoLineaBase[] {
    return [
      ...this.buildMovimientosDesdeRegistros(this.caja.getRegistrosSnapshot()),
      ...this.buildMovimientosDesdeIngresos(this.caja.getIngresosSnapshot()),
      ...this.buildMovimientosDesdeGastos(this.caja.getGastosSnapshot())
    ]
      .filter(item => this.isOnOrBeforeFechaHasta(item.fecha))
      .sort((a, b) => this.compareMovimientosAsc(a, b));
  }

  private buildMovimientosDesdeRegistros(registros: Registro[]): MovimientoLineaBase[] {
    return registros.flatMap(registro => {
      const fecha = registro.fecha || this.dateKey(registro.createdAt);
      const pagos: Array<{
        medioPago: string;
        monto: number;
        estadoConciliacionVisual?: 'CONCILIADO' | 'PENDIENTE' | 'REVISAR';
        nroOperacion?: string;
        fechaTransferencia?: string;
        nroCuit?: string;
        ordenPago: number;
      }> = registro.pagosDetalle?.length
        ? registro.pagosDetalle.map((item, index) => ({
            medioPago: item.medioPago,
            monto: Number(item.monto || 0),
            estadoConciliacionVisual: this.resolveEstadoConciliacionVisual(registro.id, index + 1, item.medioPago, item.nroOperacion),
            nroOperacion: item.nroOperacion,
            fechaTransferencia: item.fechaTransferencia,
            nroCuit: item.nroCuit,
            ordenPago: index + 1
          }))
        : [{ medioPago: registro.medioPago || 'EFECTIVO', monto: Number(registro.subtotal || 0), estadoConciliacionVisual: undefined, ordenPago: 1 }];

      return pagos
        .filter(item => item.medioPago && Number(item.monto || 0) !== 0)
        .map(pago => ({
          medioPago: this.normalizeMedio(pago.medioPago),
          fecha,
          createdAt: registro.createdAt || `${fecha}T00:00:00.000Z`,
          origen: 'REGISTRO' as const,
          referencia: registro.id,
          detalle: this.buildRegistroDetalle(registro, pago.ordenPago),
          monto: Number(pago.monto || 0),
          estadoConciliacionVisual: pago.estadoConciliacionVisual,
          conciliacionPago: this.isTransferenciaMacro(pago.medioPago)
            ? {
                registroId: registro.id,
                ordenPago: pago.ordenPago,
                nroOperacion: pago.nroOperacion,
                fechaTransferencia: pago.fechaTransferencia,
                nroCuit: pago.nroCuit
              }
            : undefined
        }));
    });
  }

  private buildPagosConciliadosSet(): Set<string> {
    return new Set(
      this.conciliacion.getMovimientosSnapshot()
        .filter(item => item.conciliacionEstado === 'CONCILIADO' && item.conciliadoRegistroId && item.conciliadoPagoOrden)
        .map(item => this.buildPagoKey(String(item.conciliadoRegistroId || ''), Number(item.conciliadoPagoOrden || 0)))
    );
  }

  private buildEstadosPorOperacionMap(): Map<string, 'PENDIENTE' | 'REVISAR'> {
    return this.conciliacion.getMovimientosSnapshot().reduce((acc, item) => {
      const operacion = this.normalizeOperacion(item.nroOperacion);
      if (!operacion || item.conciliacionEstado === 'CONCILIADO') {
        return acc;
      }

      const estado = item.conciliacionEstado === 'REVISAR' ? 'REVISAR' : 'PENDIENTE';
      const actual = acc.get(operacion);
      if (!actual || estado === 'REVISAR') {
        acc.set(operacion, estado);
      }

      return acc;
    }, new Map<string, 'PENDIENTE' | 'REVISAR'>());
  }

  private resolveEstadoConciliacionVisual(
    registroId: string,
    ordenPago: number,
    medioPago?: string,
    nroOperacion?: string
  ): 'CONCILIADO' | 'PENDIENTE' | 'REVISAR' | undefined {
    if (!this.isTransferenciaMacro(medioPago)) {
      return undefined;
    }

    if (this.pagosConciliados.has(this.buildPagoKey(registroId, ordenPago))) {
      return 'CONCILIADO';
    }

    const operacion = this.normalizeOperacion(nroOperacion);
    if (!operacion) {
      return 'PENDIENTE';
    }

    return this.estadosPorOperacion.get(operacion) || 'PENDIENTE';
  }

  private buildPagoKey(registroId: string, ordenPago: number): string {
    return `${String(registroId || '').trim()}-${Number(ordenPago || 0)}`;
  }

  getConciliacionPagoKey(item: MovimientoLinea): string {
    if (!item.conciliacionPago) {
      return '';
    }

    return this.buildPagoKey(item.conciliacionPago.registroId, item.conciliacionPago.ordenPago);
  }

  private prepararOpcionesConciliacion(item: MovimientoLinea) {
    const contexto = item.conciliacionPago;
    const key = this.getConciliacionPagoKey(item);
    if (!contexto || !key) {
      return;
    }

    const opciones = this.conciliacion.buildOpcionesMovimientosParaPago(contexto.registroId, contexto.ordenPago);
    this.opcionesConciliacionPago[key] = opciones;
    this.seleccionMovimientoConciliacion[key] = this.seleccionMovimientoConciliacion[key] || opciones[0]?.movimientoId || '';
  }

  private isTransferenciaMacro(value?: string): boolean {
    return this.normalizeMedio(value) === 'TRANSFERENCIA A MACRO';
  }

  private buildMovimientosDesdeIngresos(ingresos: IngresoCaja[]): MovimientoLineaBase[] {
    return ingresos
      .filter(item => item.medioPago && Number(item.monto || 0) !== 0)
      .map(item => {
        const fecha = item.fecha || this.dateKey(item.createdAt);
        return {
          medioPago: this.normalizeMedio(item.medioPago),
          fecha,
          createdAt: item.createdAt || `${fecha}T00:00:00.000Z`,
          origen: 'INGRESO' as const,
          referencia: item.id || `${fecha}-${item.concepto}`,
          detalle: `${this.normalizeText(item.tipoIngreso || 'INGRESO')} | ${this.normalizeText(item.concepto)}`,
          monto: Number(item.monto || 0)
        };
      });
  }

  private buildMovimientosDesdeGastos(gastos: Gasto[]): MovimientoLineaBase[] {
    return gastos
      .filter(item => item.medioPago && Number(item.monto || 0) !== 0)
      .map(item => {
        const fecha = item.fecha || this.dateKey(item.createdAt);
        return {
          medioPago: this.normalizeMedio(item.medioPago),
          fecha,
          createdAt: item.createdAt || `${fecha}T00:00:00.000Z`,
          origen: 'EGRESO' as const,
          referencia: item.id || `${fecha}-${item.descripcion}`,
          detalle: `${this.normalizeText(item.tipoEgreso || 'EGRESO')} | ${this.normalizeText(item.descripcion)}`,
          monto: Number(item.monto || 0) * -1
        };
      });
  }

  private buildLineasDeCierreHastaFecha(cierres: CierreCaja[]): CierreLinea[] {
    return cierres
      .filter(item => this.isOnOrBeforeFechaHasta(item.fecha))
      .map(item => ({
        tipo: 'CIERRE' as const,
        fecha: item.fecha,
        createdAt: item.createdAt || `${item.fecha}T23:59:59.999Z`,
        referencia: item.id,
        detalle: this.buildCierreDetalle(item),
        cierre: item
      }))
      .sort((a, b) => this.compareTimelineAsc(a, b));
  }

  private mergeLineasAsc(movimientos: MovimientoLineaBase[], cierres: CierreLinea[]): TimelineSeed[] {
    return [...movimientos, ...cierres].sort((a, b) => this.compareTimelineAsc(a, b));
  }

  private buildTimelineConSaldos(
    timelineAsc: TimelineSeed[]
  ): TimelineRow[] {
    const saldoPorMedio = new Map<string, number>();
    const resultado: TimelineRow[] = [];

    timelineAsc.forEach(item => {
      if (this.isCierre(item)) {
        resultado.push(item);
        return;
      }

      const medio = this.normalizeMedio(item.medioPago);
      const saldoActual = Number(saldoPorMedio.get(medio) || 0) + Number(item.monto || 0);
      saldoPorMedio.set(medio, saldoActual);

      resultado.push({
        ...item,
        tipo: 'MOVIMIENTO',
        saldoAcumulado: saldoActual
      });
    });

    return resultado;
  }

  private buildRegistroDetalle(registro: Registro, ordenPago: number): string {
    const recibo = this.normalizeText(registro.nroRecibo || 'SIN RECIBO');
    const nombre = this.normalizeText(registro.nombre || 'SIN NOMBRE');
    const pago = registro.pagosDetalle?.[ordenPago - 1];
    const nroOperacion = String(pago?.nroOperacion || '').trim();
    const operacionDetalle = nroOperacion ? ` | Op ${nroOperacion}` : '';
    const cuitDetalle = pago?.nroCuit ? ` | CUIT ${pago.nroCuit}` : '';
    const fechaTransferencia = pago?.fechaTransferencia ? ` | Fecha banco ${pago.fechaTransferencia}` : '';
    return `Recibo ${recibo} | ${nombre} | Pago ${ordenPago}${operacionDetalle}${cuitDetalle}${fechaTransferencia}`;
  }

  private buildCierreDetalle(cierre: CierreCaja): string {
    const observacion = this.normalizeText(cierre.observacion);
    return `Cierre de caja | Neto ${this.formatCurrency(cierre.totalNeto)} | Obs. ${observacion}`;
  }

  private isWithinRange(fecha: string): boolean {
    if (this.fechaDesde && fecha < this.fechaDesde) {
      return false;
    }

    if (this.fechaHasta && fecha > this.fechaHasta) {
      return false;
    }

    return true;
  }

  private isOnOrBeforeFechaHasta(fecha: string): boolean {
    if (this.fechaHasta && fecha > this.fechaHasta) {
      return false;
    }

    return true;
  }

  private isVisibleRow(item: TimelineRow): boolean {
    if (!this.isWithinRange(item.fecha)) {
      return false;
    }

    if (!this.isMovimiento(item)) {
      return this.filtroConciliacionTransferencia === 'TODAS';
    }

    const medioOk = this.medioSeleccionado === 'TODOS' || item.medioPago === this.medioSeleccionado;
    const conciliacionOk = this.matchesFiltroConciliacionTransferencia(item);
    return medioOk && conciliacionOk;
  }

  private matchesFiltroConciliacionTransferencia(item: MovimientoLinea): boolean {
    if (this.filtroConciliacionTransferencia === 'TODAS') {
      return true;
    }

    if (!this.isTransferenciaMacro(item.medioPago)) {
      return false;
    }

    return item.estadoConciliacionVisual === this.filtroConciliacionTransferencia;
  }

  private compareMovimientosAsc(a: MovimientoLineaBase, b: MovimientoLineaBase): number {
    const byCreatedAt = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    if (byCreatedAt !== 0) {
      return byCreatedAt;
    }

    const byFecha = a.fecha.localeCompare(b.fecha);
    if (byFecha !== 0) {
      return byFecha;
    }

    const byOrigen = a.origen.localeCompare(b.origen);
    if (byOrigen !== 0) {
      return byOrigen;
    }

    return a.referencia.localeCompare(b.referencia);
  }

  private compareTimelineAsc(a: Pick<MovimientoLineaBase, 'createdAt' | 'fecha' | 'referencia'> | CierreLinea, b: Pick<MovimientoLineaBase, 'createdAt' | 'fecha' | 'referencia'> | CierreLinea): number {
    const byCreatedAt = this.compareCreatedAt(a.createdAt, b.createdAt);
    if (byCreatedAt !== 0) {
      return byCreatedAt;
    }

    const byFecha = a.fecha.localeCompare(b.fecha);
    if (byFecha !== 0) {
      return byFecha;
    }

    return a.referencia.localeCompare(b.referencia);
  }

  private compareCreatedAt(a?: string, b?: string): number {
    return String(a || '').localeCompare(String(b || ''));
  }

  isMovimiento(item: TimelineRow): item is MovimientoLinea {
    return item.tipo === 'MOVIMIENTO';
  }

  private isCierre(item: TimelineSeed): item is CierreLinea {
    return 'tipo' in item && item.tipo === 'CIERRE';
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value || 0));
  }

  private dateKey(input?: string): string {
    if (!input) {
      return this.hoy;
    }

    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) {
      return this.hoy;
    }

    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private normalizeMedio(value?: string): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();
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

  private normalizeText(value?: string): string {
    return String(value || '').trim() || '-';
  }
}