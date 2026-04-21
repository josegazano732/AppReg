import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { CajaService } from '../../core/services/caja.service';
import { ConfigService } from '../../core/services/config.service';
import { CierreCaja, Gasto, IngresoCaja, Registro, TotalesMedioPago } from '../../shared/models/finance.model';

interface DetalleMedioCierreView {
  medioPago: string;
  saldoInicial: number;
  ingresos: number;
  egresos: number;
  saldo: number;
  disponible: number;
}

@Component({
  selector: 'app-cierre-diario',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cierre-diario.component.html',
  styleUrls: ['./cierre-diario.component.css']
})
export class CierreDiarioComponent implements OnInit {
  fechaSeleccionada = this.caja.getTodayDateKey();
  mesSeleccionado = this.fechaSeleccionada.slice(0, 7);

  registrosDia: Registro[] = [];
  ingresosDia: IngresoCaja[] = [];
  egresosDia: Gasto[] = [];

  resumenCaja = {
    totalIngresos: 0,
    totalGastos: 0,
    totalNeto: 0,
    saldo: { efectivo: 0, cheques: 0, posnet: 0, deposito: 0 }
  };
  detalleMedios: DetalleMedioCierreView[] = [];

  cierreExistente: CierreCaja | null = null;
  cierresMensuales: CierreCaja[] = [];

  disponibleContinuidad = 0;
  saldoInicialDia = 0;
  observacionCierre = '';
  cierreMensaje = '';
  cantidadCierresDia = 0;

  constructor(private caja: CajaService, private config: ConfigService) {}

  ngOnInit() {
    this.syncFechaMesActuales();
    this.refreshDia();
    this.refreshCierresMensuales();

    this.caja.registros.subscribe(() => this.refreshDia());
    this.caja.ingresos.subscribe(() => this.refreshDia());
    this.caja.gastos.subscribe(() => this.refreshDia());
    this.caja.cierres.subscribe(() => {
      this.refreshDia();
      this.refreshCierresMensuales();
    });
  }

  cerrarCaja() {
    this.syncFechaMesActuales();
    const cierre = this.caja.cerrarCajaDiaria(
      this.fechaSeleccionada,
      this.observacionCierre
    );

    this.cierreExistente = cierre;
    this.cantidadCierresDia = this.caja.getCierresByDate(this.fechaSeleccionada).length;
    this.cierreMensaje = `Corte #${this.cantidadCierresDia} registrado correctamente. Puedes seguir operando y volver a cerrar cuando lo necesites.`;
    this.refreshCierresMensuales();
  }

  generarPdfConciliacionPrevia() {
    this.syncFechaMesActuales();
    const snapshotTemporal: CierreCaja = {
      id: 'preview',
      fecha: this.fechaSeleccionada,
      createdAt: new Date().toISOString(),
      totalIngresos: this.resumenCaja.totalIngresos,
      totalGastos: this.resumenCaja.totalGastos,
      totalNeto: this.resumenCaja.totalNeto,
      detalleMedios: this.detalleMedios,
      saldo: this.resumenCaja.saldo,
      disponibleContinuidad: this.disponibleContinuidad,
      observacion: this.observacionCierre,
      referencias: {
        registroIds: this.registrosDia.map(item => item.id).filter(Boolean) as string[],
        ingresoIds: this.ingresosDia.map(item => item.id).filter(Boolean) as string[],
        egresoIds: this.egresosDia.map(item => item.id).filter(Boolean) as string[]
      },
      resumenMovimientos: {
        registros: this.registrosDia.length,
        ingresos: this.ingresosDia.length,
        egresos: this.egresosDia.length
      }
    };

    this.generarPdfCierre(snapshotTemporal, false);
  }

  private refreshDia() {
    this.syncFechaMesActuales();
    this.registrosDia = this.caja.getRegistrosPendientesByDate(this.fechaSeleccionada);
    this.ingresosDia = this.caja.getIngresosPendientesByDate(this.fechaSeleccionada);
    this.egresosDia = this.caja.getGastosPendientesByDate(this.fechaSeleccionada);
    const inicioPorMedio = this.caja.getInicioOperativoPorMedio(this.fechaSeleccionada);

    const cajaDia = this.caja.getCajaPendienteParaCierre(this.fechaSeleccionada);
    this.resumenCaja = {
      totalIngresos: cajaDia.totalIngresos,
      totalGastos: cajaDia.totalGastos,
      totalNeto: cajaDia.totalNeto,
      saldo: cajaDia.saldo
    };
    const detalleCalculado = this.buildDetalleMedios(inicioPorMedio, cajaDia.ingresos, cajaDia.gastos, cajaDia.saldo);

    this.saldoInicialDia = this.caja.getDisponibleContinuidadParaNuevoCierre(this.fechaSeleccionada);
    this.cierreExistente = this.caja.getCierreByFecha(this.fechaSeleccionada);
    this.cantidadCierresDia = this.caja.getCierresByDate(this.fechaSeleccionada).length;
    this.detalleMedios = detalleCalculado;

    this.disponibleContinuidad = Number(this.saldoInicialDia || 0) + Number(this.resumenCaja.saldo.efectivo || 0);
    this.observacionCierre = '';
  }

  private refreshCierresMensuales() {
    this.syncFechaMesActuales();
    this.cierresMensuales = this.caja.getCierresByMonth(this.mesSeleccionado);
  }

  private syncFechaMesActuales() {
    this.fechaSeleccionada = this.caja.getTodayDateKey();
    this.mesSeleccionado = this.fechaSeleccionada.slice(0, 7);
  }

  private generarPdfCierre(cierre: CierreCaja, autoPrint: boolean) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const fechaHora = new Date().toLocaleString('es-AR');
    const movimientosDelDia = [
      ['Registros operativos', String(this.registrosDia.length), this.formatCurrency(cierre.totalIngresos)],
      ['Ingresos manuales', String(this.ingresosDia.length), this.formatCurrency(this.sumIngresosManuales())],
      ['Egresos del dia', String(this.egresosDia.length), this.formatCurrency(cierre.totalGastos)]
    ];
    const detalleMedios = this.detalleMedios.length
      ? this.detalleMedios
      : this.buildDetalleMediosDesdeSnapshot(this.caja.getInicioOperativoPorMedio(this.fechaSeleccionada), cierre.detalleMedios || []);

    const colors = {
      slate900: [15, 23, 42] as [number, number, number],
      slate700: [51, 65, 85] as [number, number, number],
      slate500: [100, 116, 139] as [number, number, number],
      blue800: [30, 64, 175] as [number, number, number],
      cyan800: [21, 94, 117] as [number, number, number],
      gray100: [241, 245, 249] as [number, number, number],
      gray50: [248, 250, 252] as [number, number, number],
      gray200: [226, 232, 240] as [number, number, number],
      white: [255, 255, 255] as [number, number, number]
    };
    this.drawPdfHeader(doc, cierre, fechaHora, colors);

    if (cierre.observacion) {
      doc.setFontSize(8);
      doc.setTextColor(...colors.slate700);
      doc.text(`Observacion: ${this.normalizeText(cierre.observacion)}`, 14, 30);
    }

    this.drawSectionTitle(doc, 'Resumen ejecutivo del cierre', 37, colors);

    autoTable(doc, {
      startY: 40,
      head: [['Indicador clave', 'Valor']],
      body: [
        ['Inicio de caja (continuidad)', this.formatCurrency(this.saldoInicialDia)],
        ['Movimiento neto del dia', this.formatCurrency(cierre.totalNeto)],
        ['Disponible proyectado para cierre', this.formatCurrency(cierre.disponibleContinuidad)],
        ['Cortes registrados en el dia', String(this.cantidadCierresDia)],
        ['Estado del reporte', cierre.id === 'preview' ? 'Previsualizacion' : 'Cierre registrado']
      ],
      margin: { left: 12, right: 12 },
      styles: { fontSize: 8.5, cellPadding: 1.7, valign: 'middle', lineColor: colors.gray200 },
      headStyles: { fillColor: colors.slate900, textColor: colors.white, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: colors.gray50 },
      columnStyles: {
        0: { cellWidth: 110, halign: 'left', fontStyle: 'bold' },
        1: { cellWidth: 70, halign: 'right' }
      }
    });

    let currentY = (doc as any).lastAutoTable.finalY;

    this.drawSectionTitle(doc, 'Movimiento diario consolidado', currentY + 8, colors);

    autoTable(doc, {
      startY: currentY + 11,
      head: [['Tipo de movimiento', 'Cantidad', 'Monto']],
      body: movimientosDelDia,
      margin: { left: 12, right: 12 },
      styles: { fontSize: 8.2, cellPadding: 1.5, lineColor: colors.gray200 },
      headStyles: { fillColor: colors.blue800, textColor: colors.white, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: colors.gray50 },
      columnStyles: {
        0: { cellWidth: 110, halign: 'left' },
        1: { cellWidth: 30, halign: 'center' },
        2: { cellWidth: 40, halign: 'right', fontStyle: 'bold' }
      }
    });

    currentY = (doc as any).lastAutoTable.finalY;

    this.drawSectionTitle(doc, 'Como se va a cerrar por medio de pago', currentY + 8, colors);

    autoTable(doc, {
      startY: currentY + 11,
      head: [['Medio de pago', 'Inicio de caja', 'Movimiento neto', 'Cierre proyectado']],
      body: detalleMedios.map(item => [
        item.medioPago,
        this.formatCurrency(Number(item.saldoInicial || 0)),
        this.formatCurrency(Number(item.saldo || 0)),
        this.formatCurrency(Number(item.disponible || 0))
      ]),
      margin: { left: 12, right: 12 },
      styles: { fontSize: 8.2, cellPadding: 1.5, lineColor: colors.gray200 },
      headStyles: { fillColor: colors.cyan800, textColor: colors.white, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: colors.gray50 },
      columnStyles: {
        0: { cellWidth: 52, halign: 'left', fontStyle: 'bold' },
        1: { cellWidth: 42, halign: 'right' },
        2: { cellWidth: 42, halign: 'right' },
        3: { cellWidth: 52, halign: 'right', fontStyle: 'bold' }
      }
    });

    const cierreBottom = (doc as any).lastAutoTable.finalY;

    doc.setFontSize(8);
    doc.setTextColor(...colors.slate700);
    doc.text(
      `Conclusion: inicio de caja ${this.formatCurrency(this.saldoInicialDia)} + movimiento neto ${this.formatCurrency(cierre.totalNeto)} = cierre proyectado ${this.formatCurrency(cierre.disponibleContinuidad)}.`,
      14,
      cierreBottom + 7
    );

    this.addPdfFooter(doc, cierre, colors);

    const baseName = `cierre-conciliacion-${cierre.fecha}`;
    if (autoPrint) {
      doc.autoPrint();
      const blobUrl = doc.output('bloburl');
      window.open(blobUrl, '_blank');
    }
    doc.save(`${baseName}.pdf`);
  }

  private buildConceptoResumen(registros: Registro[]) {
    const map = new Map<string, { cantidad: number; total: number }>();
    registros.forEach(item => {
      const conceptos = item.conceptosDetalle?.length
        ? item.conceptosDetalle
        : [{ concepto: item.concepto || 'SIN CONCEPTO', monto: Number(item.subtotal || 0) }];
      conceptos.forEach(conceptoItem => {
        const key = (conceptoItem.concepto || 'SIN CONCEPTO').toUpperCase();
        const prev = map.get(key) || { cantidad: 0, total: 0 };
        map.set(key, {
          cantidad: prev.cantidad + 1,
          total: prev.total + Number(conceptoItem.monto || 0)
        });
      });
    });

    return [...map.entries()]
      .map(([concepto, value]) => ({ concepto, cantidad: value.cantidad, total: value.total }))
      .sort((a, b) => b.total - a.total);
  }

  private buildMedioResumen(registros: Registro[]) {
    const map = new Map<string, { cantidad: number; total: number }>();
    registros.forEach(item => {
      const pagos = item.pagosDetalle?.length
        ? item.pagosDetalle
        : [{ medioPago: item.medioPago || 'EFECTIVO', monto: Number(item.subtotal || 0) }];
      pagos.forEach(pagoItem => {
        const key = (pagoItem.medioPago || 'EFECTIVO').toUpperCase();
        const prev = map.get(key) || { cantidad: 0, total: 0 };
        map.set(key, {
          cantidad: prev.cantidad + 1,
          total: prev.total + Number(pagoItem.monto || 0)
        });
      });
    });

    return [...map.entries()]
      .map(([medioPago, value]) => ({ medioPago, cantidad: value.cantidad, total: value.total }))
      .sort((a, b) => b.total - a.total);
  }

  private drawPdfHeader(
    doc: jsPDF,
    cierre: CierreCaja,
    fechaHora: string,
    colors: Record<string, [number, number, number]>
  ) {
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFillColor(...colors.slate900);
    doc.roundedRect(10, 8, pageWidth - 20, 13, 2, 2, 'F');

    doc.setTextColor(...colors.white);
    doc.setFontSize(13);
    doc.text('Cierre Diario', 16, 16);
    doc.setFontSize(8);
    doc.text('Reporte operativo y conciliacion del cierre', 16, 20);

    doc.setFontSize(7.7);
    doc.text(`Fecha operativa: ${cierre.fecha}`, pageWidth - 92, 15);
    doc.text(`Generado: ${fechaHora}`, pageWidth - 92, 19);
    doc.text(`Estado: ${cierre.id === 'preview' ? 'Previsualizacion' : 'Cierre registrado'}`, pageWidth - 92, 23);

    doc.setTextColor(...colors.slate900);
  }

  private drawSectionTitle(
    doc: jsPDF,
    title: string,
    y: number,
    colors: Record<string, [number, number, number]>
  ) {
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFillColor(...colors.gray100);
    doc.roundedRect(12, y - 3, pageWidth - 24, 5.2, 1.2, 1.2, 'F');
    doc.setFontSize(8.6);
    doc.setTextColor(...colors.slate900);
    doc.text(title, 15, y);
  }

  private addPdfFooter(
    doc: jsPDF,
    cierre: CierreCaja,
    colors: Record<string, [number, number, number]>
  ) {
    const pageCount = doc.getNumberOfPages();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    for (let page = 1; page <= pageCount; page++) {
      doc.setPage(page);
      doc.setDrawColor(...colors.gray200);
      doc.line(10, pageHeight - 10, pageWidth - 10, pageHeight - 10);
      doc.setFontSize(8);
      doc.setTextColor(...colors.slate500);
      doc.text(`Cierre ${cierre.fecha}${cierre.id === 'preview' ? ' | Previsualizacion' : ''}`, 12, pageHeight - 5.5);
      doc.text(`Pagina ${page} de ${pageCount}`, pageWidth - 28, pageHeight - 5.5);
    }
    doc.setTextColor(...colors.slate900);
  }

  private describeConceptos(registro: Registro): string {
    if (registro.conceptosDetalle?.length) {
      return ['Conceptos:', ...registro.conceptosDetalle.map(item => `- ${item.concepto}: ${this.formatCurrency(Number(item.monto || 0))}`)]
        .join('\n');
    }
    return `Conceptos:\n- ${registro.concepto || 'SIN CONCEPTO'}: ${this.formatCurrency(Number(registro.subtotal || 0))}`;
  }

  private describePagos(registro: Registro): string {
    if (registro.pagosDetalle?.length) {
      return ['Medios:', ...registro.pagosDetalle.map(item => `- ${item.medioPago}: ${this.formatCurrency(Number(item.monto || 0))}`)]
        .join('\n');
    }
    return `Medios:\n- ${registro.medioPago || 'EFECTIVO'}: ${this.formatCurrency(Number(registro.subtotal || 0))}`;
  }

  private describeConceptosPdf(registro: Registro): string {
    if (registro.conceptosDetalle?.length) {
      return registro.conceptosDetalle
        .map(item => `${item.concepto}: ${this.formatCurrency(Number(item.monto || 0))}`)
        .join('\n');
    }

    return `${registro.concepto || 'SIN CONCEPTO'}: ${this.formatCurrency(Number(registro.subtotal || 0))}`;
  }

  private describePagosPdf(registro: Registro): string {
    if (registro.pagosDetalle?.length) {
      return registro.pagosDetalle
        .map(item => `${item.medioPago}: ${this.formatCurrency(Number(item.monto || 0))}`)
        .join('\n');
    }

    return `${registro.medioPago || 'EFECTIVO'}: ${this.formatCurrency(Number(registro.subtotal || 0))}`;
  }

  private compactBulletLines(content: string): string {
    return (content || '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .join('\n');
  }

  private normalizeText(value: unknown): string {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private formatDateTime(value?: string): string {
    if (!value) {
      return '-';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return this.normalizeText(value);
    }

    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(Number(value || 0));
  }

  private sumIngresosManuales(): number {
    return this.ingresosDia.reduce((acc, item) => acc + Number(item.monto || 0), 0);
  }

  private buildDetalleMedios(
    inicioPorMedio: Record<string, number>,
    ingresos: TotalesMedioPago,
    egresos: TotalesMedioPago,
    saldo: { efectivo: number; cheques: number; posnet: number; deposito: number }
  ): DetalleMedioCierreView[] {
    const medios = this.collectMediosDetalle(inicioPorMedio, ingresos, egresos);

    return medios.map(medioPago => {
      const saldoInicial = Number(inicioPorMedio[medioPago] || 0);
      const ingresosMedio = this.getValueFromTotales(ingresos, medioPago);
      const egresosMedio = this.getValueFromTotales(egresos, medioPago);
      const saldoNeto = ingresosMedio - egresosMedio;

      return {
        medioPago,
        saldoInicial,
        ingresos: ingresosMedio,
        egresos: egresosMedio,
        saldo: saldoNeto,
        disponible: saldoInicial + saldoNeto
      };
    });
  }

  private buildDetalleMediosDesdeSnapshot(
    inicioPorMedio: Record<string, number>,
    detalleSnapshot: Array<{ medioPago: string; ingresos: number; egresos: number; saldo: number }>
  ): DetalleMedioCierreView[] {
    const snapshotMap = new Map(
      (detalleSnapshot || []).map(item => [this.normalizeMedio(item.medioPago), item])
    );

    return this.collectMediosDetalle(inicioPorMedio)
      .map(medioPago => {
        const item = snapshotMap.get(medioPago);
        const saldoInicial = Number(inicioPorMedio[medioPago] || 0);
        const saldoNeto = Number(item?.saldo || 0);

        return {
          medioPago,
          saldoInicial,
          ingresos: Number(item?.ingresos || 0),
          egresos: Number(item?.egresos || 0),
          saldo: saldoNeto,
          disponible: saldoInicial + saldoNeto
        };
      });
  }

  private collectMediosDetalle(
    inicioPorMedio: Record<string, number>,
    ingresos?: TotalesMedioPago,
    egresos?: TotalesMedioPago
  ): string[] {
    const base = ['EFECTIVO', 'CHEQUES', 'POSNET', 'DEPOSITO'];
    const configurados = this.config.getMedios().map(item => this.normalizeMedio(item)).filter(Boolean);
    const inicio = Object.keys(inicioPorMedio || {}).map(item => this.normalizeMedio(item)).filter(Boolean);
    const otros = [
      ...Object.keys(ingresos?.otros || {}),
      ...Object.keys(egresos?.otros || {})
    ].map(item => this.normalizeMedio(item)).filter(Boolean);

    const orden = [...new Set([...base, ...configurados, ...inicio, ...otros])];
    return orden;
  }

  private getValueFromTotales(totales: TotalesMedioPago, medioPago: string): number {
    if (medioPago === 'EFECTIVO') return Number(totales.efectivo || 0);
    if (medioPago === 'CHEQUES') return Number(totales.cheques || 0);
    if (medioPago === 'POSNET') return Number(totales.posnet || 0);
    if (medioPago === 'DEPOSITO') return Number(totales.deposito || 0);
    return Number((totales.otros || {})[medioPago] || 0);
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
