import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { CajaService } from '../../core/services/caja.service';
import { CierreCaja, Gasto, IngresoCaja, Registro, TotalesMedioPago } from '../../shared/models/finance.model';

@Component({
  selector: 'app-cierre-diario',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cierre-diario.component.html',
  styleUrls: ['./cierre-diario.component.css']
})
export class CierreDiarioComponent implements OnInit {
  fechaSeleccionada = new Date().toISOString().slice(0, 10);
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
  detalleMedios: Array<{ medioPago: string; ingresos: number; egresos: number; saldo: number }> = [];

  cierreExistente: CierreCaja | null = null;
  cierresMensuales: CierreCaja[] = [];

  disponibleContinuidad = 0;
  saldoInicialDia = 0;
  observacionCierre = '';
  cierreMensaje = '';
  cantidadCierresDia = 0;

  constructor(private caja: CajaService) {}

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

    const cajaDia = this.caja.getCajaPendienteParaCierre(this.fechaSeleccionada);
    this.resumenCaja = {
      totalIngresos: cajaDia.totalIngresos,
      totalGastos: cajaDia.totalGastos,
      totalNeto: cajaDia.totalNeto,
      saldo: cajaDia.saldo
    };
    const detalleCalculado = this.buildDetalleMedios(cajaDia.ingresos, cajaDia.gastos, cajaDia.saldo);

    this.saldoInicialDia = this.caja.getDisponibleContinuidadParaNuevoCierre(this.fechaSeleccionada);
    this.cierreExistente = this.caja.getCierreByFecha(this.fechaSeleccionada);
    this.cantidadCierresDia = this.caja.getCierresByDate(this.fechaSeleccionada).length;
    this.detalleMedios = this.cierreExistente?.detalleMedios?.length
      ? this.cierreExistente.detalleMedios
      : detalleCalculado;

    this.disponibleContinuidad = Number(this.saldoInicialDia || 0) + Number(this.resumenCaja.saldo.efectivo || 0);
    this.observacionCierre = '';
  }

  private refreshCierresMensuales() {
    this.syncFechaMesActuales();
    this.cierresMensuales = this.caja.getCierresByMonth(this.mesSeleccionado);
  }

  private syncFechaMesActuales() {
    this.fechaSeleccionada = new Date().toISOString().slice(0, 10);
    this.mesSeleccionado = this.fechaSeleccionada.slice(0, 7);
  }

  private generarPdfCierre(cierre: CierreCaja, autoPrint: boolean) {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const fechaHora = new Date().toLocaleString('es-AR');
    const conceptoResumen = this.buildConceptoResumen(this.registrosDia);
    const medioResumen = this.buildMedioResumen(this.registrosDia);
    const detalleIngresos = this.ingresosDia.length
      ? this.ingresosDia.map(item => [
          this.normalizeText(item.tipoIngreso || 'INGRESO'),
          this.normalizeText(item.concepto),
          this.normalizeText(item.medioPago || 'EFECTIVO'),
          this.formatCurrency(Number(item.monto || 0))
        ])
      : [['-', 'Sin ingresos manuales registrados', '-', this.formatCurrency(0)]];
    const detalleEgresos = this.egresosDia.length
      ? this.egresosDia.map(item => [
          this.normalizeText(item.tipoEgreso || 'EGRESO'),
          this.normalizeText(item.descripcion),
          this.normalizeText(item.medioPago || 'EFECTIVO'),
          this.formatCurrency(Number(item.monto || 0))
        ])
      : [['-', 'Sin egresos registrados', '-', this.formatCurrency(0)]];
    const tieneMovimientosManual = this.ingresosDia.length > 0 || this.egresosDia.length > 0;
    const tieneDetalleMedios = this.detalleMedios.length > 0;
    const tieneResumenConceptos = conceptoResumen.length > 0;
    const tieneResumenMedios = medioResumen.length > 0;
    const colors = {
      slate900: [15, 23, 42] as [number, number, number],
      slate700: [51, 65, 85] as [number, number, number],
      slate500: [100, 116, 139] as [number, number, number],
      blue800: [30, 64, 175] as [number, number, number],
      cyan800: [21, 94, 117] as [number, number, number],
      emerald700: [4, 120, 87] as [number, number, number],
      amber700: [180, 83, 9] as [number, number, number],
      gray100: [241, 245, 249] as [number, number, number],
      gray50: [248, 250, 252] as [number, number, number],
      gray200: [226, 232, 240] as [number, number, number],
      white: [255, 255, 255] as [number, number, number]
    };
    const pageWidth = doc.internal.pageSize.getWidth();

    this.drawPdfHeader(doc, cierre, fechaHora, colors);

    if (cierre.observacion) {
      doc.setFontSize(8);
      doc.setTextColor(...colors.slate700);
      doc.text(`Observacion: ${this.normalizeText(cierre.observacion)}`, 14, 29);
    }

    this.drawSectionTitle(doc, 'Resumen ejecutivo del cierre', 33, colors);

    autoTable(doc, {
      startY: 36,
      head: [['Indicador', 'Valor', 'Indicador', 'Valor']],
      body: [
        [
          'Saldo inicial continuidad', this.formatCurrency(this.saldoInicialDia),
          'Cortes registrados en el dia', String(this.cantidadCierresDia)
        ],
        [
          'Ingresos operativos del dia', this.formatCurrency(cierre.totalIngresos),
          'Ingresos manuales', String(this.ingresosDia.length)
        ],
        [
          'Egresos operativos del dia', this.formatCurrency(cierre.totalGastos),
          'Egresos registrados', String(this.egresosDia.length)
        ],
        [
          'Resultado neto del dia', this.formatCurrency(cierre.totalNeto),
          'Registros incluidos', String(this.registrosDia.length)
        ],
        [
          'Disponible continuidad proyectado', this.formatCurrency(cierre.disponibleContinuidad),
          'ID del cierre', cierre.id === 'preview' ? 'Previsualizacion' : cierre.id
        ]
      ],
      margin: { left: 10, right: 10 },
      styles: { fontSize: 8, cellPadding: 1.6, valign: 'middle', lineColor: colors.gray200 },
      headStyles: { fillColor: colors.slate900, textColor: colors.white, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: colors.gray50 },
      columnStyles: {
        0: { cellWidth: 67, halign: 'left', fontStyle: 'bold' },
        1: { cellWidth: 39, halign: 'right' },
        2: { cellWidth: 67, halign: 'left', fontStyle: 'bold' },
        3: { cellWidth: 67, halign: 'right' }
      },
      didParseCell: data => {
        if (data.section === 'head' && (data.column.index === 1 || data.column.index === 3)) {
          data.cell.styles.halign = 'right';
        }
      }
    });

    let resumenBottom = (doc as any).lastAutoTable.finalY;

    if (tieneDetalleMedios) {
      this.drawSectionTitle(doc, 'Composicion por medio de pago', resumenBottom + 5, colors);

      autoTable(doc, {
        startY: resumenBottom + 8,
        head: [['Medio de pago', 'Ingresos', 'Egresos', 'Saldo neto']],
        body: this.detalleMedios.map(item => [
          item.medioPago,
          this.formatCurrency(Number(item.ingresos || 0)),
          this.formatCurrency(Number(item.egresos || 0)),
          this.formatCurrency(Number(item.saldo || 0))
        ]),
        margin: { left: 10, right: 10 },
        styles: { fontSize: 7.8, cellPadding: 1.4, lineColor: colors.gray200 },
        headStyles: { fillColor: colors.cyan800, textColor: colors.white, fontStyle: 'bold', fontSize: 7.8 },
        alternateRowStyles: { fillColor: colors.gray50 },
        columnStyles: {
          0: { cellWidth: 84, halign: 'left' },
          1: { cellWidth: 42, halign: 'right' },
          2: { cellWidth: 42, halign: 'right' },
          3: { cellWidth: 42, halign: 'right', fontStyle: 'bold' }
        }
      });

      resumenBottom = (doc as any).lastAutoTable.finalY;
    }

    if (tieneResumenConceptos || tieneResumenMedios) {
      this.drawSectionTitle(doc, 'Distribucion de conceptos y medios cobrados', resumenBottom + 5, colors);

      const distribucionStartY = resumenBottom + 8;
      let conceptosBottom = distribucionStartY;
      let mediosBottom = distribucionStartY;

      if (tieneResumenConceptos) {
        autoTable(doc, {
          startY: distribucionStartY,
          head: [['Concepto', 'Movimientos', 'Total']],
          body: conceptoResumen.map(item => [item.concepto, String(item.cantidad), this.formatCurrency(item.total)]),
          margin: { left: 10, right: pageWidth / 2 + 2 },
          styles: { fontSize: 7.6, cellPadding: 1.2, valign: 'middle', lineColor: colors.gray200 },
          headStyles: { fillColor: colors.blue800, textColor: colors.white, fontStyle: 'bold', fontSize: 7.6 },
          alternateRowStyles: { fillColor: colors.gray50 },
          columnStyles: {
            0: { cellWidth: 72, halign: 'left' },
            1: { cellWidth: 18, halign: 'center' },
            2: { cellWidth: 30, halign: 'right' }
          },
          didParseCell: data => {
            if (data.section === 'head' && (data.column.index === 1 || data.column.index === 2)) {
              data.cell.styles.halign = data.column.index === 1 ? 'center' : 'right';
            }
          }
        });

        conceptosBottom = (doc as any).lastAutoTable.finalY;
      }

      if (tieneResumenMedios) {
        autoTable(doc, {
          startY: distribucionStartY,
          head: [['Medio de pago', 'Movimientos', 'Total']],
          body: medioResumen.map(item => [item.medioPago, String(item.cantidad), this.formatCurrency(item.total)]),
          margin: { left: pageWidth / 2 + 1, right: 10 },
          styles: { fontSize: 7.6, cellPadding: 1.2, valign: 'middle', lineColor: colors.gray200 },
          headStyles: { fillColor: colors.cyan800, textColor: colors.white, fontStyle: 'bold', fontSize: 7.6 },
          alternateRowStyles: { fillColor: colors.gray50 },
          columnStyles: {
            0: { cellWidth: 72, halign: 'left' },
            1: { cellWidth: 18, halign: 'center' },
            2: { cellWidth: 30, halign: 'right' }
          },
          didParseCell: data => {
            if (data.section === 'head' && (data.column.index === 1 || data.column.index === 2)) {
              data.cell.styles.halign = data.column.index === 1 ? 'center' : 'right';
            }
          }
        });

        mediosBottom = (doc as any).lastAutoTable.finalY;
      }

      resumenBottom = Math.max(conceptosBottom, mediosBottom);
    }

    let movimientosBottom = resumenBottom;

    if (tieneMovimientosManual) {
      this.drawSectionTitle(doc, 'Detalle de ingresos y egresos manuales', resumenBottom + 5, colors);

      const movimientosManualStartY = resumenBottom + 8;

      autoTable(doc, {
        startY: movimientosManualStartY,
        head: [['Tipo ingreso', 'Concepto', 'Medio', 'Monto']],
        body: detalleIngresos,
        margin: { left: 10, right: pageWidth / 2 + 2 },
        styles: { fontSize: 7.2, cellPadding: 1.2, valign: 'top', lineColor: colors.gray200 },
        headStyles: { fillColor: colors.emerald700, textColor: colors.white, fontStyle: 'bold', fontSize: 7.2 },
        alternateRowStyles: { fillColor: colors.gray50 },
        columnStyles: {
          0: { cellWidth: 28 },
          1: { cellWidth: 52 },
          2: { cellWidth: 20 },
          3: { cellWidth: 20, halign: 'right' }
        }
      });

      const ingresosTable = (doc as any).lastAutoTable;

      autoTable(doc, {
        startY: movimientosManualStartY,
        head: [['Tipo egreso', 'Descripcion', 'Medio', 'Monto']],
        body: detalleEgresos,
        margin: { left: pageWidth / 2 + 1, right: 10 },
        styles: { fontSize: 7.2, cellPadding: 1.2, valign: 'top', lineColor: colors.gray200 },
        headStyles: { fillColor: colors.amber700, textColor: colors.white, fontStyle: 'bold', fontSize: 7.2 },
        alternateRowStyles: { fillColor: colors.gray50 },
        columnStyles: {
          0: { cellWidth: 28 },
          1: { cellWidth: 52 },
          2: { cellWidth: 20 },
          3: { cellWidth: 20, halign: 'right' }
        }
      });

      const egresosTable = (doc as any).lastAutoTable;
      movimientosBottom = Math.max(ingresosTable.finalY, egresosTable.finalY);
    }

    this.drawSectionTitle(doc, 'Detalle de registros incluidos en el cierre', movimientosBottom + 5, colors);

    autoTable(doc, {
      startY: movimientosBottom + 8,
      head: [['Fecha', 'Recibo', 'Cliente', 'Conceptos', 'Pagos combinados', 'Subtotal']],
      body: this.registrosDia.length
        ? this.registrosDia.map(item => [
            this.formatDateTime(item.createdAt),
            this.normalizeText(item.nroRecibo),
            this.normalizeText(item.nombre),
            this.describeConceptosPdf(item),
            this.describePagosPdf(item),
            this.formatCurrency(Number(item.subtotal || 0))
          ])
        : [['-', '-', 'Sin registros para esta fecha', '-', '-', this.formatCurrency(0)]],
      margin: { left: 7, right: 7 },
      tableWidth: 'auto',
      styles: { fontSize: 6.8, cellPadding: 1, overflow: 'linebreak', valign: 'top', lineColor: colors.gray200 },
      columnStyles: {
        0: { cellWidth: 20, halign: 'left' },
        1: { cellWidth: 18, halign: 'left' },
        2: { cellWidth: 37, halign: 'left' },
        3: { cellWidth: 72 },
        4: { cellWidth: 72 },
        5: { halign: 'right', cellWidth: 22 }
      },
      headStyles: { fillColor: colors.slate700, textColor: colors.white, fontSize: 7, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: colors.gray50 },
      didParseCell: data => {
        if (data.section === 'head' && data.column.index === 5) {
          data.cell.styles.halign = 'right';
        }
        if (data.section === 'body' && (data.column.index === 3 || data.column.index === 4)) {
          const text = Array.isArray(data.cell.text) ? data.cell.text.join('\n') : String(data.cell.text || '');
          data.cell.text = this.compactBulletLines(text).split('\n');
        }
      }
    });

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

  private buildDetalleMedios(
    ingresos: TotalesMedioPago,
    egresos: TotalesMedioPago,
    saldo: { efectivo: number; cheques: number; posnet: number; deposito: number }
  ) {
    const base = [
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
      .sort()
      .map(key => {
        const ingresosMedio = Number((ingresos.otros || {})[key] || 0);
        const egresosMedio = Number((egresos.otros || {})[key] || 0);
        return {
          medioPago: key,
          ingresos: ingresosMedio,
          egresos: egresosMedio,
          saldo: ingresosMedio - egresosMedio
        };
      });

    return [...base, ...otros].filter(item => item.ingresos !== 0 || item.egresos !== 0 || item.saldo !== 0);
  }
}
