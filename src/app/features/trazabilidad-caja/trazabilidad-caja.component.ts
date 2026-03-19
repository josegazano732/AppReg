import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
}

interface CorrelatividadMedio {
  medioPago: string;
  saldoInicial: number;
  ingresos: number;
  egresos: number;
  neto: number;
  saldoFinal: number;
}

interface AlertaContinuidad {
  fecha: string;
  cierreId: string;
  esperado: number;
  informado: number;
  diferencia: number;
}

@Component({
  selector: 'app-trazabilidad-caja',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './trazabilidad-caja.component.html',
  styleUrls: ['./trazabilidad-caja.component.css']
})
export class TrazabilidadCajaComponent implements OnInit {
  readonly hoy = new Date().toISOString().slice(0, 10);
  fechaDesde = this.hoy.slice(0, 8) + '01';
  fechaHasta = this.hoy;

  dias: DiaTrazabilidad[] = [];
  detalleConsolidado: DiaTrazabilidad[] = [];
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

  constructor(private caja: CajaService, private config: ConfigService) {}

  ngOnInit() {
    this.refresh();

    this.config.medios.subscribe(() => this.refresh());
    this.caja.registros.subscribe(() => this.refresh());
    this.caja.ingresos.subscribe(() => this.refresh());
    this.caja.gastos.subscribe(() => this.refresh());
    this.caja.cierres.subscribe(() => this.refresh());
  }

  onRangoChange() {
    if (this.fechaDesde > this.fechaHasta) {
      this.fechaHasta = this.fechaDesde;
    }
    this.refresh();
  }

  usarMesActual() {
    this.fechaHasta = this.hoy;
    this.fechaDesde = this.hoy.slice(0, 8) + '01';
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

  private refresh() {
    const cierres = this.caja.getCierresSnapshot();
    const registros = this.caja.getRegistrosSnapshot();
    const ingresos = this.caja.getIngresosSnapshot();
    const egresos = this.caja.getGastosSnapshot();

    const fechas = this.collectFechasEnRango(cierres, registros, ingresos, egresos);
    const cierresMap = this.buildLatestCierreMap(cierres);

    const diasAsc = fechas.map(fecha => {
      const cierre = cierresMap.get(fecha);
      if (cierre) {
        return this.buildDiaCerrado(cierre);
      }
      return this.buildDiaAbierto(fecha);
    });

    this.dias = [...diasAsc].sort((a, b) => b.fecha.localeCompare(a.fecha));
    this.detalleConsolidado = this.buildDetalleConsolidadoCompleto(cierres);
    this.correlatividad = this.buildCorrelatividad(diasAsc, cierres);
    this.alertasContinuidad = this.buildAlertasContinuidad(cierres);
    this.refreshKpis();
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

  private buildDiaCerrado(cierre: CierreCaja): DiaTrazabilidad {
    const detalle = (cierre.detalleMedios || []).map(item => ({
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
      registros: Number(cierre.resumenMovimientos?.registros || 0),
      ingresosCaja: Number(cierre.resumenMovimientos?.ingresos || 0),
      egresosCaja: Number(cierre.resumenMovimientos?.egresos || 0),
      ingresosTotales: Number(cierre.totalIngresos || 0),
      egresosTotales: Number(cierre.totalGastos || 0),
      neto: Number(cierre.totalNeto || 0),
      disponibleContinuidad: Number(cierre.disponibleContinuidad || 0),
      detalleMedios: detalle.sort((a, b) => a.medioPago.localeCompare(b.medioPago))
    };
  }

  private buildDiaAbierto(fecha: string): DiaTrazabilidad {
    const registrosDia = this.caja.getRegistrosByDate(fecha);
    const ingresosDia = this.caja.getIngresosByDate(fecha);
    const egresosDia = this.caja.getGastosByDate(fecha);
    const cajaDia = this.caja.getCajaDiaria(fecha);

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

  private buildDetalleConsolidadoCompleto(cierres: CierreCaja[]): DiaTrazabilidad[] {
    return [...cierres]
      .sort((a, b) => this.compareCierresDesc(a, b))
      .map(cierre => this.buildDiaCerrado(cierre));
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
        saldoInicial: Number(saldoInicialMap[medio] || 0),
        ingresos: 0,
        egresos: 0,
        neto: 0,
        saldoFinal: Number(saldoInicialMap[medio] || 0)
      });
    });

    diasAsc.forEach(dia => {
      dia.detalleMedios.forEach(item => {
        const key = this.normalizeMedio(item.medioPago);
        if (!rows.has(key)) {
          rows.set(key, {
            medioPago: key,
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

    return [...rows.values()].sort((a, b) => {
      const rankA = orderMap.has(a.medioPago) ? orderMap.get(a.medioPago)! : 999;
      const rankB = orderMap.has(b.medioPago) ? orderMap.get(b.medioPago)! : 999;
      if (rankA !== rankB) return rankA - rankB;
      return a.medioPago.localeCompare(b.medioPago);
    });
  }

  private getSaldoInicialAntesDe(medios: string[], cierres: CierreCaja[]): Record<string, number> {
    const base: Record<string, number> = {};
    medios.forEach(medio => {
      base[medio] = 0;
    });

    const previo = [...cierres]
      .filter(item => item.fecha < this.fechaDesde)
      .sort((a, b) => this.compareCierresDesc(a, b))[0];

    this.cierreBaseCorrelatividad = previo || null;

    if (!previo) {
      return base;
    }

    base.EFECTIVO = Number(previo.disponibleContinuidad || 0);
    base.CHEQUES = Number(previo.saldo.cheques || 0);
    base.POSNET = Number(previo.saldo.posnet || 0);
    base.DEPOSITO = Number(previo.saldo.deposito || 0);

    (previo.detalleMedios || []).forEach(item => {
      const key = this.normalizeMedio(item.medioPago);
      if (!key || key === 'EFECTIVO') {
        return;
      }
      base[key] = Number(item.saldo || 0);
    });

    return base;
  }

  private buildLatestCierreMap(cierres: CierreCaja[]): Map<string, CierreCaja> {
    const map = new Map<string, CierreCaja>();

    cierres.forEach(cierre => {
      const current = map.get(cierre.fecha);
      if (!current || this.compareCierresDesc(cierre, current) < 0) {
        map.set(cierre.fecha, cierre);
      }
    });

    return map;
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
    return new Date(input).toISOString().slice(0, 10);
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
