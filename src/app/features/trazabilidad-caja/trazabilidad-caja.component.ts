import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, auditTime, merge, takeUntil } from 'rxjs';
import { CajaService } from '../../core/services/caja.service';
import { ConfigService } from '../../core/services/config.service';
import { CierreCaja, Gasto, IngresoCaja, Registro, TotalesMedioPago } from '../../shared/models/finance.model';

interface DetalleMedioDia {
  medioPago: string;
  ingresos: number;
  egresos: number;
  saldo: number;
}

interface DiaTrazabilidad {
  fecha: string;
  estado: 'CERRADO' | 'ABIERTO';
  cierreId?: string;
  cierreCreadoAt?: string;
  registros: number;
  ingresosCaja: number;
  egresosCaja: number;
  ingresosTotales: number;
  egresosTotales: number;
  neto: number;
  disponibleContinuidad: number | null;
  detalleMedios: DetalleMedioDia[];
  auditoria?: AuditoriaCierre;
}

interface CorrelatividadMedio {
  medioPago: string;
  saldoBaseCierre: number;
  saldoBasePendiente: number;
  saldoInicial: number;
  ingresos: number;
  egresos: number;
  neto: number;
  saldoFinal: number;
}

interface SaldoInicialCorrelatividad {
  saldoBaseCierre: Record<string, number>;
  saldoBasePendiente: Record<string, number>;
  saldoInicial: Record<string, number>;
}

interface AlertaContinuidad {
  fecha: string;
  cierreId: string;
  esperado: number;
  informado: number;
  diferencia: number;
}

interface ResumenFaltantes {
  registros: number;
  ingresos: number;
  egresos: number;
}

interface ResumenMovimientoCierre {
  registros: number;
  ingresos: number;
  egresos: number;
}

interface ResumenTotalesCierre {
  ingresos: number;
  egresos: number;
  neto: number;
}

interface AuditoriaCierre {
  estado: 'OK' | 'REVISAR' | 'FALTAN_REFERENCIAS';
  resumen: string;
  detalle: string[];
  referenciasFaltantes: number;
  snapshotMovimientos: ResumenMovimientoCierre;
  referenciasMovimientos: ResumenMovimientoCierre;
  snapshotTotales: ResumenTotalesCierre;
  referenciasTotales: ResumenTotalesCierre;
}

interface ReferenciasIndex {
  registrosById: Map<string, Registro>;
  ingresosById: Map<string, IngresoCaja>;
  egresosById: Map<string, Gasto>;
}

interface ReferenciasResueltasCierre {
  registros: Registro[];
  ingresos: IngresoCaja[];
  egresos: Gasto[];
  faltantes: ResumenFaltantes;
  movimientos: ResumenMovimientoCierre;
  totales: ResumenTotalesCierre;
  detalleMedios: DetalleMedioDia[];
}

interface MovimientoPeriodo {
  fecha: string;
  tipo: 'CERRADO' | 'ABIERTO';
  creadoAt?: string;
  dia: DiaTrazabilidad;
}

interface DetalleConceptoRegistro {
  concepto: string;
  monto: number;
}

interface DetallePagoRegistro {
  medioPago: string;
  monto: number;
}

@Component({
  selector: 'app-trazabilidad-caja',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './trazabilidad-caja.component.html',
  styleUrls: ['./trazabilidad-caja.component.css']
})
export class TrazabilidadCajaComponent implements OnInit, OnDestroy {
  readonly hoy = this.getTodayDateKey();
  fechaDesde = this.hoy.slice(0, 8) + '01';
  fechaHasta = this.hoy;
  rangoRapidoDias: number | null = null;

  dias: DiaTrazabilidad[] = [];
  detalleConsolidado: DiaTrazabilidad[] = [];
  cierresObservados: DiaTrazabilidad[] = [];
  correlatividad: CorrelatividadMedio[] = [];
  cierreBaseCorrelatividad: CierreCaja | null = null;

  kpiDias = 0;
  kpiCierres = 0;
  kpiMovimientos = 0;
  kpiIngresos = 0;
  kpiEgresos = 0;
  kpiNeto = 0;
  kpiAlertasContinuidad = 0;

  alertasContinuidad: AlertaContinuidad[] = [];
  modalDetalleAbierto = false;
  cierreDetalleSeleccionado: CierreCaja | null = null;
  auditoriaDetalleSeleccionada: AuditoriaCierre | null = null;
  registrosDetalle: Registro[] = [];
  ingresosDetalle: IngresoCaja[] = [];
  egresosDetalle: Gasto[] = [];
  faltantesDetalle: ResumenFaltantes = { registros: 0, ingresos: 0, egresos: 0 };
  private readonly destroy$ = new Subject<void>();

  constructor(private caja: CajaService, private config: ConfigService) {}

  ngOnInit() {
    this.refresh();

    merge(this.config.medios, this.caja.registros, this.caja.ingresos, this.caja.gastos, this.caja.cierres)
      .pipe(auditTime(40), takeUntil(this.destroy$))
      .subscribe(() => this.refresh());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onRangoChange() {
    this.rangoRapidoDias = null;
    if (this.fechaDesde > this.fechaHasta) {
      this.fechaHasta = this.fechaDesde;
    }
    this.refresh();
  }

  usarMesActual() {
    this.rangoRapidoDias = null;
    this.fechaHasta = this.hoy;
    this.fechaDesde = this.hoy.slice(0, 8) + '01';
    this.refresh();
  }

  usarUltimosDias(dias: number) {
    if (dias < 1) {
      return;
    }

    this.rangoRapidoDias = dias;
    const hasta = new Date();
    const desde = new Date(hasta);
    desde.setDate(desde.getDate() - (dias - 1));

    this.fechaHasta = this.toDateKeyLocal(hasta);
    this.fechaDesde = this.toDateKeyLocal(desde);
    this.refresh();
  }

  trackByFecha(_: number, item: DiaTrazabilidad): string {
    return item.fecha;
  }

  trackByCierre(_: number, item: DiaTrazabilidad): string {
    return item.cierreId || `${item.fecha}-${item.cierreCreadoAt || ''}`;
  }

  trackByMedio(_: number, item: CorrelatividadMedio | DetalleMedioDia): string {
    return item.medioPago;
  }

  trackByRegistro(_: number, item: Registro): string {
    return item.id;
  }

  trackByIngreso(_: number, item: IngresoCaja): string {
    return item.id || `${item.createdAt || ''}-${item.concepto || ''}-${item.monto || 0}`;
  }

  trackByEgreso(_: number, item: Gasto): string {
    return item.id || `${item.createdAt || ''}-${item.descripcion || ''}-${item.monto || 0}`;
  }

  get correlatividadVisible(): CorrelatividadMedio[] {
    return this.correlatividad.filter(item =>
      item.saldoBaseCierre !== 0 ||
      item.saldoBasePendiente !== 0 ||
      item.saldoInicial !== 0 ||
      item.ingresos !== 0 ||
      item.egresos !== 0 ||
      item.neto !== 0 ||
      item.saldoFinal !== 0
    );
  }

  getConceptosRegistro(registro: Registro): DetalleConceptoRegistro[] {
    if (registro.conceptosDetalle?.length) {
      return registro.conceptosDetalle.map(item => ({
        concepto: this.normalizeMedio(item.concepto || 'SIN CONCEPTO'),
        monto: Number(item.monto || 0)
      }));
    }

    return [
      {
        concepto: this.normalizeMedio(registro.concepto || 'SIN CONCEPTO'),
        monto: Number(registro.subtotal || 0)
      }
    ];
  }

  getPagosRegistro(registro: Registro): DetallePagoRegistro[] {
    if (registro.pagosDetalle?.length) {
      return registro.pagosDetalle.map(item => ({
        medioPago: this.normalizeMedio(item.medioPago || 'EFECTIVO'),
        monto: Number(item.monto || 0)
      }));
    }

    return [
      {
        medioPago: this.normalizeMedio(registro.medioPago || 'EFECTIVO'),
        monto: Number(registro.subtotal || 0)
      }
    ];
  }

  formatConceptosRegistroPlano(registro: Registro): string {
    return this.getConceptosRegistro(registro)
      .map(item => `${item.concepto}: ${this.formatCurrency(item.monto)}`)
      .join('\n');
  }

  formatPagosRegistroPlano(registro: Registro): string {
    return this.getPagosRegistro(registro)
      .map(item => `${item.medioPago}: ${this.formatCurrency(item.monto)}`)
      .join('\n');
  }

  abrirDetalleCierre(cierreId?: string) {
    if (!cierreId) {
      return;
    }

    const cierre = this.caja.getCierresSnapshot().find(item => item.id === cierreId);
    if (!cierre) {
      return;
    }

    this.cierreDetalleSeleccionado = cierre;
    this.auditoriaDetalleSeleccionada = this.detalleConsolidado.find(item => item.cierreId === cierreId)?.auditoria || null;
    this.hidratarDetallePorReferencias(cierre);
    this.modalDetalleAbierto = true;
  }

  cerrarModalDetalle() {
    this.modalDetalleAbierto = false;
    this.auditoriaDetalleSeleccionada = null;
  }

  imprimirDetalleCierre() {
    if (!this.cierreDetalleSeleccionado) {
      return;
    }

    const cierre = this.cierreDetalleSeleccionado;
    const html = this.renderPrintableHtml(cierre);
    const popup = window.open('', '_blank', 'width=1100,height=900');
    if (!popup) {
      return;
    }

    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    popup.onload = () => {
      popup.print();
    };
  }

  private refresh() {
    const cierres = this.caja.getCierresSnapshot();
    const registros = this.caja.getRegistrosSnapshot();
    const ingresos = this.caja.getIngresosSnapshot();
    const egresos = this.caja.getGastosSnapshot();
    const referenciasIndex = this.buildReferenciasIndex(registros, ingresos, egresos);

    const movimientosPeriodo = this.buildMovimientosPeriodo(cierres, referenciasIndex);

    this.dias = this.buildResumenDiario(movimientosPeriodo);
    this.detalleConsolidado = this.buildDetalleConsolidadoCompleto(movimientosPeriodo);
    this.cierresObservados = this.detalleConsolidado.filter(item => item.auditoria && item.auditoria.estado !== 'OK');
    this.correlatividad = this.buildCorrelatividad(movimientosPeriodo.map(item => item.dia), cierres);
    this.alertasContinuidad = this.buildAlertasContinuidad(cierres);
    this.refreshKpis();

    if (this.modalDetalleAbierto && this.cierreDetalleSeleccionado) {
      const cierreActualizado = cierres.find(item => item.id === this.cierreDetalleSeleccionado!.id);
      if (cierreActualizado) {
        this.cierreDetalleSeleccionado = cierreActualizado;
        this.auditoriaDetalleSeleccionada = this.detalleConsolidado.find(item => item.cierreId === cierreActualizado.id)?.auditoria || null;
        this.hidratarDetallePorReferencias(cierreActualizado);
      } else {
        this.cerrarModalDetalle();
      }
    }
  }

  private buildReferenciasIndex(
    registros: Registro[],
    ingresos: IngresoCaja[],
    egresos: Gasto[]
  ): ReferenciasIndex {
    return {
      registrosById: new Map(registros.map(item => [item.id, item])),
      ingresosById: new Map(ingresos.filter(item => item.id).map(item => [item.id!, item])),
      egresosById: new Map(egresos.filter(item => item.id).map(item => [item.id!, item]))
    };
  }

  private resolveReferenciasCierre(cierre: CierreCaja, index: ReferenciasIndex): ReferenciasResueltasCierre {
    const registroIds = (cierre.referencias?.registroIds || []).filter(Boolean);
    const ingresoIds = (cierre.referencias?.ingresoIds || []).filter(Boolean);
    const egresoIds = (cierre.referencias?.egresoIds || []).filter(Boolean);

    const registros = registroIds
      .map(id => index.registrosById.get(id))
      .filter((item): item is Registro => !!item);
    const ingresos = ingresoIds
      .map(id => index.ingresosById.get(id))
      .filter((item): item is IngresoCaja => !!item);
    const egresos = egresoIds
      .map(id => index.egresosById.get(id))
      .filter((item): item is Gasto => !!item);

    const ingresosRegistros = this.caja.computeTotalesMedioPago(registros);
    const ingresosManuales = this.computeTotalesIngresosPorMedio(ingresos);
    const egresosTotales = this.computeTotalesGastosPorMedio(egresos);
    const ingresosCombinados = this.mergeTotales(ingresosRegistros, ingresosManuales);

    const totalIngresos =
      registros.reduce((sum, item) => sum + Number(item.subtotal || 0), 0) +
      ingresos.reduce((sum, item) => sum + Number(item.monto || 0), 0);
    const totalEgresos = egresos.reduce((sum, item) => sum + Number(item.monto || 0), 0);

    return {
      registros,
      ingresos,
      egresos,
      faltantes: {
        registros: Math.max(0, registroIds.length - registros.length),
        ingresos: Math.max(0, ingresoIds.length - ingresos.length),
        egresos: Math.max(0, egresoIds.length - egresos.length)
      },
      movimientos: {
        registros: registros.length,
        ingresos: ingresos.length,
        egresos: egresos.length
      },
      totales: {
        ingresos: totalIngresos,
        egresos: totalEgresos,
        neto: totalIngresos - totalEgresos
      },
      detalleMedios: this.buildDetalleMedios(
        ingresosCombinados,
        egresosTotales,
        {
          efectivo: Number(ingresosCombinados.efectivo || 0) - Number(egresosTotales.efectivo || 0),
          cheques: Number(ingresosCombinados.cheques || 0) - Number(egresosTotales.cheques || 0),
          posnet: Number(ingresosCombinados.posnet || 0) - Number(egresosTotales.posnet || 0),
          deposito: Number(ingresosCombinados.deposito || 0) - Number(egresosTotales.deposito || 0)
        }
      )
    };
  }

  private buildAuditoriaCierre(cierre: CierreCaja, resueltas: ReferenciasResueltasCierre): AuditoriaCierre {
    const snapshotMovimientos: ResumenMovimientoCierre = {
      registros: Number(cierre.resumenMovimientos?.registros || 0),
      ingresos: Number(cierre.resumenMovimientos?.ingresos || 0),
      egresos: Number(cierre.resumenMovimientos?.egresos || 0)
    };
    const snapshotTotales: ResumenTotalesCierre = {
      ingresos: Number(cierre.totalIngresos || 0),
      egresos: Number(cierre.totalGastos || 0),
      neto: Number(cierre.totalNeto || 0)
    };
    const detalle: string[] = [];
    const referenciasFaltantes = resueltas.faltantes.registros + resueltas.faltantes.ingresos + resueltas.faltantes.egresos;

    if (snapshotMovimientos.registros !== resueltas.movimientos.registros) {
      detalle.push(`Registros cierre ${snapshotMovimientos.registros} vs refs ${resueltas.movimientos.registros}`);
    }
    if (snapshotMovimientos.ingresos !== resueltas.movimientos.ingresos) {
      detalle.push(`Ingresos caja cierre ${snapshotMovimientos.ingresos} vs refs ${resueltas.movimientos.ingresos}`);
    }
    if (snapshotMovimientos.egresos !== resueltas.movimientos.egresos) {
      detalle.push(`Egresos caja cierre ${snapshotMovimientos.egresos} vs refs ${resueltas.movimientos.egresos}`);
    }
    if (Math.abs(snapshotTotales.ingresos - resueltas.totales.ingresos) > 0.009) {
      detalle.push(`Ingresos ${this.formatCurrency(snapshotTotales.ingresos)} vs ${this.formatCurrency(resueltas.totales.ingresos)}`);
    }
    if (Math.abs(snapshotTotales.egresos - resueltas.totales.egresos) > 0.009) {
      detalle.push(`Egresos ${this.formatCurrency(snapshotTotales.egresos)} vs ${this.formatCurrency(resueltas.totales.egresos)}`);
    }
    if (Math.abs(snapshotTotales.neto - resueltas.totales.neto) > 0.009) {
      detalle.push(`Neto ${this.formatCurrency(snapshotTotales.neto)} vs ${this.formatCurrency(resueltas.totales.neto)}`);
    }

    let estado: AuditoriaCierre['estado'] = 'OK';
    let resumen = 'Snapshot y referencias conciliadas';

    if (referenciasFaltantes > 0) {
      estado = 'FALTAN_REFERENCIAS';
      resumen = `Faltan ${referenciasFaltantes} referencia(s) vinculadas al cierre`;
    } else if (detalle.length) {
      estado = 'REVISAR';
      resumen = 'El snapshot del cierre no coincide con las referencias actuales';
    }

    return {
      estado,
      resumen,
      detalle,
      referenciasFaltantes,
      snapshotMovimientos,
      referenciasMovimientos: resueltas.movimientos,
      snapshotTotales,
      referenciasTotales: resueltas.totales
    };
  }

  private hidratarDetallePorReferencias(cierre: CierreCaja) {
    const registroIds = new Set((cierre.referencias?.registroIds || []).filter(Boolean));
    const ingresoIds = new Set((cierre.referencias?.ingresoIds || []).filter(Boolean));
    const egresoIds = new Set((cierre.referencias?.egresoIds || []).filter(Boolean));

    this.registrosDetalle = this.caja
      .getRegistrosSnapshot()
      .filter(item => registroIds.has(item.id));

    this.ingresosDetalle = this.caja
      .getIngresosSnapshot()
      .filter(item => item.id && ingresoIds.has(item.id));

    this.egresosDetalle = this.caja
      .getGastosSnapshot()
      .filter(item => item.id && egresoIds.has(item.id));

    this.faltantesDetalle = {
      registros: Math.max(0, registroIds.size - this.registrosDetalle.length),
      ingresos: Math.max(0, ingresoIds.size - this.ingresosDetalle.length),
      egresos: Math.max(0, egresoIds.size - this.egresosDetalle.length)
    };
  }

  private renderPrintableHtml(cierre: CierreCaja): string {
    const registrosRows = this.registrosDetalle.length
      ? this.registrosDetalle
          .map(item => {
            return `<tr>
              <td>${this.escapeHtml(item.createdAt || '-')}</td>
              <td>${this.escapeHtml(item.nroRecibo || '-')}</td>
              <td>${this.escapeHtml(item.nombre || '-')}</td>
              <td>${this.toMultilineHtml(this.formatConceptosRegistroPlano(item))}</td>
              <td>${this.toMultilineHtml(this.formatPagosRegistroPlano(item))}</td>
              <td class="num">${this.formatCurrency(item.subtotal)}</td>
            </tr>`;
          })
          .join('')
      : '<tr><td colspan="6">Sin registros asociados.</td></tr>';

    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Detalle cierre ${this.escapeHtml(cierre.id)}</title>
  <style>
    body { font-family: Segoe UI, Arial, sans-serif; margin: 18px; color: #0f172a; }
    h1 { font-size: 18px; margin: 0 0 10px; }
    .meta { margin-bottom: 12px; font-size: 12px; color: #334155; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px; font-size: 12px; text-align: left; }
    th { background: #f1f5f9; }
    .num { text-align: right; white-space: nowrap; }
  </style>
</head>
<body>
  <h1>Detalle completo de cierre</h1>
  <div class="meta"><strong>ID:</strong> ${this.escapeHtml(cierre.id)} | <strong>Fecha:</strong> ${this.escapeHtml(cierre.fecha)}</div>

  <table>
    <thead><tr><th>Fecha</th><th>Recibo</th><th>Cliente</th><th>Conceptos</th><th>Pagos combinados</th><th class="num">Subtotal</th></tr></thead>
    <tbody>${registrosRows}</tbody>
  </table>
</body>
</html>`;
  }

  private escapeHtml(value: string): string {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private toMultilineHtml(value: string): string {
    return this.escapeHtml(value || '').replace(/\n/g, '<br/>');
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value || 0));
  }

  private refreshKpis() {
    this.kpiDias = this.dias.length;
    this.kpiCierres = this.dias.filter(item => item.estado === 'CERRADO').length;
    this.kpiMovimientos = this.dias.reduce((sum, item) => sum + item.registros + item.ingresosCaja + item.egresosCaja, 0);
    this.kpiIngresos = this.dias.reduce((sum, item) => sum + Number(item.ingresosTotales || 0), 0);
    this.kpiEgresos = this.dias.reduce((sum, item) => sum + Number(item.egresosTotales || 0), 0);
    this.kpiNeto = this.kpiIngresos - this.kpiEgresos;
    this.kpiAlertasContinuidad = this.alertasContinuidad.length;
  }

  private buildAlertasContinuidad(cierres: CierreCaja[]): AlertaContinuidad[] {
    const cierresOrdenados = [...cierres].sort((a, b) => {
      const byFecha = a.fecha.localeCompare(b.fecha);
      if (byFecha !== 0) return byFecha;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
    const alertas: AlertaContinuidad[] = [];
    let continuidadPrevia = 0;

    cierresOrdenados.forEach(cierre => {
      const saldoEfectivoDia = Number(cierre.saldo?.efectivo || 0);
      const esperado = continuidadPrevia + saldoEfectivoDia;
      const informado = Number(cierre.disponibleContinuidad || 0);
      const diferencia = Number((informado - esperado).toFixed(2));

      if (Math.abs(diferencia) > 0.009 && this.inRange(cierre.fecha)) {
        alertas.push({
          fecha: cierre.fecha,
          cierreId: cierre.id,
          esperado,
          informado,
          diferencia
        });
      }

      continuidadPrevia = informado;
    });

    return alertas.sort((a, b) => b.fecha.localeCompare(a.fecha));
  }

  private collectFechasEnRango(
    cierres: CierreCaja[],
    registros: Registro[],
    ingresos: IngresoCaja[],
    egresos: Gasto[]
  ): string[] {
    const all = new Set<string>();

    cierres
      .map(item => item.fecha)
      .filter(fecha => this.inRange(fecha))
      .forEach(fecha => all.add(fecha));

    registros
      .map(item => this.dateKey(item.createdAt))
      .filter(fecha => this.inRange(fecha))
      .forEach(fecha => all.add(fecha));

    ingresos
      .map(item => item.fecha || this.dateKey(item.createdAt))
      .filter(fecha => this.inRange(fecha))
      .forEach(fecha => all.add(fecha));

    egresos
      .map(item => item.fecha || this.dateKey(item.createdAt))
      .filter(fecha => this.inRange(fecha))
      .forEach(fecha => all.add(fecha));

    return [...all].sort((a, b) => a.localeCompare(b));
  }

  private buildDiaCerrado(cierre: CierreCaja, index: ReferenciasIndex): DiaTrazabilidad {
    const resueltas = this.resolveReferenciasCierre(cierre, index);
    const auditoria = this.buildAuditoriaCierre(cierre, resueltas);
    const usarReferencias = auditoria.estado !== 'FALTAN_REFERENCIAS';
    const detalleSnapshot = (cierre.detalleMedios || []).map(item => ({
      medioPago: this.normalizeMedio(item.medioPago),
      ingresos: Number(item.ingresos || 0),
      egresos: Number(item.egresos || 0),
      saldo: Number(item.saldo || 0)
    }));

    return {
      fecha: cierre.fecha,
      estado: 'CERRADO',
      cierreId: cierre.id,
      cierreCreadoAt: cierre.createdAt,
      registros: usarReferencias ? resueltas.movimientos.registros : Number(cierre.resumenMovimientos?.registros || 0),
      ingresosCaja: usarReferencias ? resueltas.movimientos.ingresos : Number(cierre.resumenMovimientos?.ingresos || 0),
      egresosCaja: usarReferencias ? resueltas.movimientos.egresos : Number(cierre.resumenMovimientos?.egresos || 0),
      ingresosTotales: usarReferencias ? resueltas.totales.ingresos : Number(cierre.totalIngresos || 0),
      egresosTotales: usarReferencias ? resueltas.totales.egresos : Number(cierre.totalGastos || 0),
      neto: usarReferencias ? resueltas.totales.neto : Number(cierre.totalNeto || 0),
      disponibleContinuidad: Number(cierre.disponibleContinuidad || 0),
      detalleMedios: (usarReferencias ? resueltas.detalleMedios : detalleSnapshot).sort((a, b) => a.medioPago.localeCompare(b.medioPago)),
      auditoria
    };
  }

  private buildDiaAbierto(fecha: string): DiaTrazabilidad {
    const registrosDia = this.caja.getRegistrosPendientesByDate(fecha);
    const ingresosDia = this.caja.getIngresosPendientesByDate(fecha);
    const egresosDia = this.caja.getGastosPendientesByDate(fecha);
    const cajaDia = this.caja.getCajaPendienteParaCierre(fecha);

    return {
      fecha,
      estado: 'ABIERTO',
      cierreId: '',
      cierreCreadoAt: '',
      registros: registrosDia.length,
      ingresosCaja: ingresosDia.length,
      egresosCaja: egresosDia.length,
      ingresosTotales: Number(cajaDia.totalIngresos || 0),
      egresosTotales: Number(cajaDia.totalGastos || 0),
      neto: Number(cajaDia.totalNeto || 0),
      disponibleContinuidad: null,
      detalleMedios: this.buildDetalleMedios(cajaDia.ingresos, cajaDia.gastos, cajaDia.saldo)
    };
  }

  private buildMovimientosPeriodo(cierres: CierreCaja[], index: ReferenciasIndex): MovimientoPeriodo[] {
    const cerrados = [...cierres]
      .filter(cierre => this.inRange(cierre.fecha))
      .sort((a, b) => {
        const byFecha = a.fecha.localeCompare(b.fecha);
        if (byFecha !== 0) {
          return byFecha;
        }
        return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      })
      .map(cierre => ({
        fecha: cierre.fecha,
        tipo: 'CERRADO' as const,
        creadoAt: cierre.createdAt,
        dia: this.buildDiaCerrado(cierre, index)
      }));

    const fechasPendientes = this.collectFechasPendientesEnRango();
    const abiertos = fechasPendientes
      .map(fecha => ({
        fecha,
        tipo: 'ABIERTO' as const,
        creadoAt: '9999-12-31T23:59:59.999Z',
        dia: this.buildDiaAbierto(fecha)
      }))
      .filter(item => item.dia.registros > 0 || item.dia.ingresosCaja > 0 || item.dia.egresosCaja > 0 || item.dia.neto !== 0);

    return [...cerrados, ...abiertos].sort((a, b) => {
      const byFecha = a.fecha.localeCompare(b.fecha);
      if (byFecha !== 0) {
        return byFecha;
      }
      return String(a.creadoAt || '').localeCompare(String(b.creadoAt || ''));
    });
  }

  private buildResumenDiario(movimientos: MovimientoPeriodo[]): DiaTrazabilidad[] {
    const grouped = new Map<string, DiaTrazabilidad>();

    movimientos.forEach(item => {
      const current = grouped.get(item.fecha);
      if (!current) {
        grouped.set(item.fecha, {
          ...item.dia,
          estado: item.dia.estado,
          cierreId: item.dia.estado === 'CERRADO' ? item.dia.cierreId : '',
          cierreCreadoAt: item.dia.cierreCreadoAt,
          detalleMedios: [...item.dia.detalleMedios],
          auditoria: item.dia.auditoria
        });
        return;
      }

      current.estado = item.dia.estado === 'ABIERTO' ? 'ABIERTO' : current.estado;
      current.cierreId = item.dia.cierreId || current.cierreId;
      current.cierreCreadoAt = item.dia.cierreCreadoAt || current.cierreCreadoAt;
      current.registros += item.dia.registros;
      current.ingresosCaja += item.dia.ingresosCaja;
      current.egresosCaja += item.dia.egresosCaja;
      current.ingresosTotales += item.dia.ingresosTotales;
      current.egresosTotales += item.dia.egresosTotales;
      current.neto += item.dia.neto;
      current.disponibleContinuidad = item.dia.disponibleContinuidad ?? current.disponibleContinuidad;
      current.detalleMedios = this.mergeDetalleMedios(current.detalleMedios, item.dia.detalleMedios);
      if (item.dia.auditoria && item.dia.auditoria.estado !== 'OK') {
        current.auditoria = item.dia.auditoria;
      }
    });

    return [...grouped.values()].sort((a, b) => b.fecha.localeCompare(a.fecha));
  }

  private buildDetalleConsolidadoCompleto(movimientos: MovimientoPeriodo[]): DiaTrazabilidad[] {
    return movimientos
      .map(item => item.dia)
      .sort((a, b) => {
        const byFecha = b.fecha.localeCompare(a.fecha);
        if (byFecha !== 0) {
          return byFecha;
        }
        return String(b.cierreCreadoAt || '').localeCompare(String(a.cierreCreadoAt || ''));
      });
  }

  private computeTotalesGastosPorMedio(gastos: Gasto[]): TotalesMedioPago {
    const acc: TotalesMedioPago = { efectivo: 0, cheques: 0, posnet: 0, deposito: 0, otros: {} };
    gastos.forEach(item => {
      this.applyPagoToTotales(acc, item.medioPago || 'EFECTIVO', Number(item.monto || 0));
    });
    return acc;
  }

  private computeTotalesIngresosPorMedio(ingresos: IngresoCaja[]): TotalesMedioPago {
    const acc: TotalesMedioPago = { efectivo: 0, cheques: 0, posnet: 0, deposito: 0, otros: {} };
    ingresos.forEach(item => {
      this.applyPagoToTotales(acc, item.medioPago || 'EFECTIVO', Number(item.monto || 0));
    });
    return acc;
  }

  private mergeTotales(a: TotalesMedioPago, b: TotalesMedioPago): TotalesMedioPago {
    const otros: Record<string, number> = {};
    [...new Set([...Object.keys(a.otros || {}), ...Object.keys(b.otros || {})])].forEach(key => {
      otros[key] = Number((a.otros || {})[key] || 0) + Number((b.otros || {})[key] || 0);
    });

    return {
      efectivo: Number(a.efectivo || 0) + Number(b.efectivo || 0),
      cheques: Number(a.cheques || 0) + Number(b.cheques || 0),
      posnet: Number(a.posnet || 0) + Number(b.posnet || 0),
      deposito: Number(a.deposito || 0) + Number(b.deposito || 0),
      otros
    };
  }

  private applyPagoToTotales(acc: TotalesMedioPago, medioPago: string, monto: number) {
    const medio = this.normalizeMedio(medioPago);
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
        if (!medio) {
          return;
        }
        acc.otros = acc.otros || {};
        acc.otros[medio] = Number(acc.otros[medio] || 0) + monto;
        break;
    }
  }

  private buildDetalleMedios(
    ingresos: TotalesMedioPago,
    egresos: TotalesMedioPago,
    saldo: { efectivo: number; cheques: number; posnet: number; deposito: number }
  ): DetalleMedioDia[] {
    const base: DetalleMedioDia[] = [
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

    const otros = [...new Set([...Object.keys(ingresos.otros || {}), ...Object.keys(egresos.otros || {})])]
      .filter(Boolean)
      .map(key => {
        const ingresosMedio = Number((ingresos.otros || {})[key] || 0);
        const egresosMedio = Number((egresos.otros || {})[key] || 0);
        return {
          medioPago: this.normalizeMedio(key),
          ingresos: ingresosMedio,
          egresos: egresosMedio,
          saldo: ingresosMedio - egresosMedio
        };
      });

    return [...base, ...otros]
      .filter(item => item.ingresos !== 0 || item.egresos !== 0 || item.saldo !== 0)
      .sort((a, b) => a.medioPago.localeCompare(b.medioPago));
  }

  private buildCorrelatividad(diasAsc: DiaTrazabilidad[], cierres: CierreCaja[]): CorrelatividadMedio[] {
    const mediosConfig = this.config.getMedios().map(m => this.normalizeMedio(m)).filter(Boolean);
    const mediosData = new Set<string>(mediosConfig);
    diasAsc.forEach(dia => dia.detalleMedios.forEach(item => mediosData.add(this.normalizeMedio(item.medioPago))));

    const saldoInicialMap = this.getSaldoInicialAntesDe([...mediosData], cierres);
    const rows = new Map<string, CorrelatividadMedio>();

    [...mediosData].forEach(medio => {
      rows.set(medio, {
        medioPago: medio,
        saldoBaseCierre: Number(saldoInicialMap.saldoBaseCierre[medio] || 0),
        saldoBasePendiente: Number(saldoInicialMap.saldoBasePendiente[medio] || 0),
        saldoInicial: Number(saldoInicialMap.saldoInicial[medio] || 0),
        ingresos: 0,
        egresos: 0,
        neto: 0,
        saldoFinal: Number(saldoInicialMap.saldoInicial[medio] || 0)
      });
    });

    diasAsc.forEach(dia => {
      dia.detalleMedios.forEach(item => {
        const key = this.normalizeMedio(item.medioPago);
        if (!rows.has(key)) {
          rows.set(key, {
            medioPago: key,
            saldoBaseCierre: 0,
            saldoBasePendiente: 0,
            saldoInicial: 0,
            ingresos: 0,
            egresos: 0,
            neto: 0,
            saldoFinal: 0
          });
        }

        const row = rows.get(key)!;
        row.ingresos += Number(item.ingresos || 0);
        row.egresos += Number(item.egresos || 0);
        row.neto += Number(item.saldo || 0);
        row.saldoFinal = row.saldoInicial + row.neto;
      });
    });

    const orderMap = new Map<string, number>(mediosConfig.map((medio, index) => [medio, index]));

    return [...rows.values()]
      .filter(item => item.saldoInicial !== 0 || item.ingresos !== 0 || item.egresos !== 0 || item.neto !== 0 || item.saldoFinal !== 0)
      .sort((a, b) => {
      const rankA = orderMap.has(a.medioPago) ? orderMap.get(a.medioPago)! : 999;
      const rankB = orderMap.has(b.medioPago) ? orderMap.get(b.medioPago)! : 999;
      if (rankA !== rankB) return rankA - rankB;
      return a.medioPago.localeCompare(b.medioPago);
      });
  }

  private getSaldoInicialAntesDe(medios: string[], cierres: CierreCaja[]): SaldoInicialCorrelatividad {
    const baseCierre: Record<string, number> = {};
    const basePendiente: Record<string, number> = {};
    const saldoInicial: Record<string, number> = {};
    medios.forEach(medio => {
      baseCierre[medio] = 0;
      basePendiente[medio] = 0;
      saldoInicial[medio] = 0;
    });

    const previo = [...cierres]
      .filter(item => item.fecha < this.fechaDesde)
      .sort((a, b) => this.compareCierresDesc(a, b))[0];

    this.cierreBaseCorrelatividad = previo || null;

    if (!previo) {
      const pendientesSinCierre = this.getMovimientosPendientesAntesDe(this.fechaDesde);
      pendientesSinCierre.forEach(item => {
        const key = this.normalizeMedio(item.medioPago);
        if (!key) {
          return;
        }
        basePendiente[key] = Number(basePendiente[key] || 0) + Number(item.saldo || 0);
        saldoInicial[key] = Number(saldoInicial[key] || 0) + Number(item.saldo || 0);
      });

      return {
        saldoBaseCierre: baseCierre,
        saldoBasePendiente: basePendiente,
        saldoInicial
      };
    }

    baseCierre.EFECTIVO = Number(previo.disponibleContinuidad || 0);
    baseCierre.CHEQUES = Number(previo.saldo.cheques || 0);
    baseCierre.POSNET = Number(previo.saldo.posnet || 0);
    baseCierre.DEPOSITO = Number(previo.saldo.deposito || 0);

    (previo.detalleMedios || []).forEach(item => {
      const key = this.normalizeMedio(item.medioPago);
      if (!key || key === 'EFECTIVO') {
        return;
      }
      baseCierre[key] = Number(item.saldo || 0);
    });

    const pendientesPrevios = this.getMovimientosPendientesAntesDe(this.fechaDesde);
    pendientesPrevios.forEach(item => {
      const key = this.normalizeMedio(item.medioPago);
      if (!key) {
        return;
      }
      basePendiente[key] = Number(basePendiente[key] || 0) + Number(item.saldo || 0);
    });

    medios.forEach(medio => {
      saldoInicial[medio] = Number(baseCierre[medio] || 0) + Number(basePendiente[medio] || 0);
    });

    return {
      saldoBaseCierre: baseCierre,
      saldoBasePendiente: basePendiente,
      saldoInicial
    };
  }

  private getMovimientosPendientesAntesDe(fechaCorte: string): DetalleMedioDia[] {
    const fechas = new Set<string>();

    this.caja
      .getRegistrosSnapshot()
      .map(item => this.dateKey(item.createdAt))
      .filter(fecha => fecha < fechaCorte)
      .forEach(fecha => fechas.add(fecha));

    this.caja
      .getIngresosSnapshot()
      .map(item => item.fecha || this.dateKey(item.createdAt))
      .filter(fecha => fecha < fechaCorte)
      .forEach(fecha => fechas.add(fecha));

    this.caja
      .getGastosSnapshot()
      .map(item => item.fecha || this.dateKey(item.createdAt))
      .filter(fecha => fecha < fechaCorte)
      .forEach(fecha => fechas.add(fecha));

    const acumulado = new Map<string, DetalleMedioDia>();

    [...fechas]
      .sort((a, b) => a.localeCompare(b))
      .forEach(fecha => {
        const registrosPendientes = this.caja.getRegistrosPendientesByDate(fecha);
        const ingresosPendientes = this.caja.getIngresosPendientesByDate(fecha);
        const egresosPendientes = this.caja.getGastosPendientesByDate(fecha);

        if (!registrosPendientes.length && !ingresosPendientes.length && !egresosPendientes.length) {
          return;
        }

        const ingresosRegistros = this.caja.computeTotalesMedioPago(registrosPendientes);
        const ingresosManuales = this.computeTotalesIngresosPorMedio(ingresosPendientes);
        const ingresos = this.mergeTotales(ingresosRegistros, ingresosManuales);
        const egresos = this.computeTotalesGastosPorMedio(egresosPendientes);
        const detalle = this.buildDetalleMedios(ingresos, egresos, {
          efectivo: Number(ingresos.efectivo || 0) - Number(egresos.efectivo || 0),
          cheques: Number(ingresos.cheques || 0) - Number(egresos.cheques || 0),
          posnet: Number(ingresos.posnet || 0) - Number(egresos.posnet || 0),
          deposito: Number(ingresos.deposito || 0) - Number(egresos.deposito || 0)
        });

        detalle.forEach(item => {
          const key = this.normalizeMedio(item.medioPago);
          const previo = acumulado.get(key) || { medioPago: key, ingresos: 0, egresos: 0, saldo: 0 };
          previo.ingresos += Number(item.ingresos || 0);
          previo.egresos += Number(item.egresos || 0);
          previo.saldo += Number(item.saldo || 0);
          acumulado.set(key, previo);
        });
      });

    return [...acumulado.values()];
  }

  private collectFechasPendientesEnRango(): string[] {
    const fechas = new Set<string>();

    this.caja
      .getRegistrosSnapshot()
      .map(item => this.dateKey(item.createdAt))
      .filter(fecha => this.inRange(fecha))
      .forEach(fecha => {
        if (this.caja.getRegistrosPendientesByDate(fecha).length) {
          fechas.add(fecha);
        }
      });

    this.caja
      .getIngresosSnapshot()
      .map(item => item.fecha || this.dateKey(item.createdAt))
      .filter(fecha => this.inRange(fecha))
      .forEach(fecha => {
        if (this.caja.getIngresosPendientesByDate(fecha).length) {
          fechas.add(fecha);
        }
      });

    this.caja
      .getGastosSnapshot()
      .map(item => item.fecha || this.dateKey(item.createdAt))
      .filter(fecha => this.inRange(fecha))
      .forEach(fecha => {
        if (this.caja.getGastosPendientesByDate(fecha).length) {
          fechas.add(fecha);
        }
      });

    return [...fechas].sort((a, b) => a.localeCompare(b));
  }

  private mergeDetalleMedios(actual: DetalleMedioDia[], extra: DetalleMedioDia[]): DetalleMedioDia[] {
    const map = new Map<string, DetalleMedioDia>();

    [...actual, ...extra].forEach(item => {
      const key = this.normalizeMedio(item.medioPago);
      const prev = map.get(key) || { medioPago: key, ingresos: 0, egresos: 0, saldo: 0 };
      prev.ingresos += Number(item.ingresos || 0);
      prev.egresos += Number(item.egresos || 0);
      prev.saldo += Number(item.saldo || 0);
      map.set(key, prev);
    });

    return [...map.values()]
      .filter(item => item.ingresos !== 0 || item.egresos !== 0 || item.saldo !== 0)
      .sort((a, b) => a.medioPago.localeCompare(b.medioPago));
  }

  private compareCierresDesc(a: CierreCaja, b: CierreCaja): number {
    const byFecha = b.fecha.localeCompare(a.fecha);
    if (byFecha !== 0) return byFecha;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  }

  private inRange(fecha: string): boolean {
    return fecha >= this.fechaDesde && fecha <= this.fechaHasta;
  }

  private dateKey(input?: string): string {
    if (!input) {
      return this.hoy;
    }
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) {
      return this.hoy;
    }
    return this.toDateKeyLocal(parsed);
  }

  private getTodayDateKey(): string {
    return this.toDateKeyLocal(new Date());
  }

  private toDateKeyLocal(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private normalizeMedio(value?: string): string {
    return (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();
  }
}
