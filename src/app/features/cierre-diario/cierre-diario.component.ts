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
  fechaSeleccionada: string;
  mesSeleccionado: string;

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

  constructor(private caja: CajaService, private config: ConfigService) {
    this.fechaSeleccionada = this.caja.getTodayDateKey();
    this.mesSeleccionado = this.fechaSeleccionada.slice(0, 7);
  }

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
    const totalRegistrosOperativos = this.sumRegistrosOperativos();
    const totalIngresosManuales = this.sumIngresosManuales();
    const totalEgresos = this.sumEgresosDia();
    const detalleMedios = this.detalleMedios.length
      ? this.detalleMedios
      : this.buildDetalleMediosDesdeSnapshot(this.caja.getInicioOperativoPorMedio(this.fechaSeleccionada), cierre.detalleMedios || []);

    const colors = {
      ink: [28, 37, 46] as [number, number, number],
      accent: [109, 134, 148] as [number, number, number],
      soft: [237, 241, 244] as [number, number, number],
      white: [255, 255, 255] as [number, number, number]
    };

    const resumenEjecutivo = [
      ['Inicio de caja del dia', this.formatCurrency(this.saldoInicialDia)],
      ['Registros operativos del dia', this.formatCurrency(totalRegistrosOperativos)],
      ['Ingresos manuales del dia', this.formatCurrency(totalIngresosManuales)],
      ['Total ingresos del dia', this.formatCurrency(cierre.totalIngresos)],
      ['Total egresos del dia', this.formatCurrency(cierre.totalGastos)],
      ['Movimiento neto del dia', this.formatCurrency(cierre.totalNeto)],
      ['Disponible proyectado para continuidad', this.formatCurrency(cierre.disponibleContinuidad)],
      ['Cortes registrados en el dia', String(this.cantidadCierresDia)],
      ['Estado del informe', cierre.id === 'preview' ? 'Previsualizacion' : 'Cierre registrado']
    ];
    const resumenMovimientos = [
      ['Registros operativos', String(this.registrosDia.length), this.formatCurrency(totalRegistrosOperativos)],
      ['Ingresos manuales', String(this.ingresosDia.length), this.formatCurrency(totalIngresosManuales)],
      ['Egresos del dia', String(this.egresosDia.length), this.formatCurrency(totalEgresos)]
    ];

    this.drawPdfHeader(doc, cierre, fechaHora, colors);

    let currentY = 28;

    if (cierre.observacion) {
      currentY = this.addPdfParagraph(
        doc,
        `Observacion del corte: ${this.normalizeText(cierre.observacion)}`,
        currentY,
        colors
      );
    }

    currentY = this.startPdfSection(doc, 'Resumen ejecutivo del cierre', currentY, colors);

    autoTable(doc, {
      startY: currentY,
      head: [['Indicador clave', 'Valor']],
      body: resumenEjecutivo,
      margin: { left: 12, right: 12 },
      styles: { fontSize: 8.4, cellPadding: 1.9, valign: 'middle', lineColor: colors.soft, textColor: colors.ink },
      headStyles: { fillColor: colors.ink, textColor: colors.white, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: colors.soft },
      columnStyles: {
        0: { cellWidth: 110, halign: 'left', fontStyle: 'bold' },
        1: { cellWidth: 70, halign: 'right' }
      }
    });

    currentY = this.getLastAutoTableY(doc, currentY);
    currentY = this.addPdfParagraph(
      doc,
      'Disponible proyectado al cierre = saldo inicial del dia + movimiento neto de cada medio de pago.',
      currentY + 3,
      colors
    );

    currentY = this.startPdfSection(doc, 'Cierre proyectado por medio de pago', currentY, colors);

    autoTable(doc, {
      startY: currentY,
      head: [['Medio de pago', 'Inicio', 'Ingresos', 'Egresos', 'Cierre proyectado']],
      body: detalleMedios.map(item => [
        item.medioPago,
        this.formatCurrency(Number(item.saldoInicial || 0)),
        this.formatCurrency(Number(item.ingresos || 0)),
        this.formatCurrency(Number(item.egresos || 0)),
        this.formatCurrency(Number(item.disponible || 0))
      ]),
      foot: [[
        'TOTAL',
        this.formatCurrency(detalleMedios.reduce((acc, item) => acc + Number(item.saldoInicial || 0), 0)),
        this.formatCurrency(detalleMedios.reduce((acc, item) => acc + Number(item.ingresos || 0), 0)),
        this.formatCurrency(detalleMedios.reduce((acc, item) => acc + Number(item.egresos || 0), 0)),
        this.formatCurrency(detalleMedios.reduce((acc, item) => acc + Number(item.disponible || 0), 0))
      ]],
      margin: { left: 12, right: 12 },
      styles: { fontSize: 8, cellPadding: 1.6, lineColor: colors.soft, textColor: colors.ink },
      headStyles: { fillColor: colors.accent, textColor: colors.white, fontStyle: 'bold', fontSize: 7.8 },
      alternateRowStyles: { fillColor: colors.soft },
      footStyles: { fillColor: colors.ink, textColor: colors.white, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 38, halign: 'left', fontStyle: 'bold' },
        1: { cellWidth: 34, halign: 'right' },
        2: { cellWidth: 34, halign: 'right' },
        3: { cellWidth: 34, halign: 'right' },
        4: { cellWidth: 48, halign: 'right', fontStyle: 'bold' }
      }
    });

    currentY = this.getLastAutoTableY(doc, currentY);
    currentY = this.addPdfParagraph(
      doc,
      `El cierre proyectado por medio ya incluye ingresos y egresos de cada canal. El efectivo proyectado para continuidad queda en ${this.formatCurrency(cierre.disponibleContinuidad)}.`,
      currentY + 3,
      colors
    );

    currentY = this.startPdfSection(doc, 'Resumen del movimiento del dia', currentY, colors);

    autoTable(doc, {
      startY: currentY,
      head: [['Origen', 'Cantidad', 'Monto']],
      body: resumenMovimientos,
      foot: [['TOTAL MOVIMIENTOS', String(this.registrosDia.length + this.ingresosDia.length + this.egresosDia.length), this.formatCurrency(cierre.totalIngresos + totalEgresos)]],
      margin: { left: 12, right: 12 },
      styles: { fontSize: 8.2, cellPadding: 1.5, lineColor: colors.soft, textColor: colors.ink },
      headStyles: { fillColor: colors.accent, textColor: colors.white, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: colors.soft },
      footStyles: { fillColor: colors.ink, textColor: colors.white, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 110, halign: 'left', fontStyle: 'bold' },
        1: { cellWidth: 30, halign: 'center' },
        2: { cellWidth: 40, halign: 'right', fontStyle: 'bold' }
      }
    });

    currentY = this.getLastAutoTableY(doc, currentY);
    currentY = this.addPdfParagraph(
      doc,
      'A continuacion se detalla el movimiento del dia en tres bloques separados para evitar mezclar tipos de operacion.',
      currentY + 3,
      colors
    );

    currentY = this.startPdfSection(doc, 'Detalle del movimiento del dia - Registros operativos', currentY, colors);

    currentY = this.addPdfParagraph(
      doc,
      `Cantidad de registros: ${this.registrosDia.length}. Total operado: ${this.formatCurrency(totalRegistrosOperativos)}.`,
      currentY,
      colors
    );

    autoTable(doc, {
      startY: currentY,
      head: [['Hora', 'Recibo', 'Titular', 'Detalle', 'Importe']],
      body: this.registrosDia.length
        ? this.registrosDia.map(registro => [
            this.formatHour(registro.createdAt),
            this.normalizeText(registro.nroRecibo || '-'),
            this.normalizeText(registro.nombre || '-'),
            this.compactBulletLines(`${this.describeConceptosPdf(registro)}\n${this.describePagosPdf(registro)}`),
            this.formatCurrency(Number(registro.subtotal || 0))
          ])
        : [['-', '-', 'Sin registros operativos en el dia', '-', this.formatCurrency(0)]],
      foot: [['', '', '', 'Total registros operativos', this.formatCurrency(totalRegistrosOperativos)]],
      margin: { left: 12, right: 12 },
      styles: { fontSize: 7.4, cellPadding: 1.3, lineColor: colors.soft, textColor: colors.ink, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: colors.ink, textColor: colors.white, fontStyle: 'bold', fontSize: 7.6 },
      alternateRowStyles: { fillColor: colors.soft },
      footStyles: { fillColor: colors.ink, textColor: colors.white, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 18, halign: 'left' },
        1: { cellWidth: 24, halign: 'left' },
        2: { cellWidth: 36, halign: 'left' },
        3: { cellWidth: 92, halign: 'left' },
        4: { cellWidth: 18, halign: 'right', fontStyle: 'bold' }
      }
    });

    currentY = this.getLastAutoTableY(doc, currentY);
    currentY = this.startPdfSection(doc, 'Detalle del movimiento del dia - Ingresos manuales', currentY, colors);

    currentY = this.addPdfParagraph(
      doc,
      `Cantidad de ingresos manuales: ${this.ingresosDia.length}. Total ingresado: ${this.formatCurrency(totalIngresosManuales)}.`,
      currentY,
      colors
    );

    autoTable(doc, {
      startY: currentY,
      head: [['Hora', 'Tipo', 'Concepto', 'Medio', 'Importe']],
      body: this.ingresosDia.length
        ? this.ingresosDia.map(ingreso => [
            this.formatHour(ingreso.createdAt),
            this.normalizeText(ingreso.tipoIngreso || '-'),
            this.normalizeText(ingreso.concepto || '-'),
            this.normalizeText(this.normalizeMedio(ingreso.medioPago || 'EFECTIVO')),
            this.formatCurrency(Number(ingreso.monto || 0))
          ])
        : [['-', '-', 'Sin ingresos manuales en el dia', '-', this.formatCurrency(0)]],
      foot: [['', '', '', 'Total ingresos manuales', this.formatCurrency(totalIngresosManuales)]],
      margin: { left: 12, right: 12 },
      styles: { fontSize: 7.8, cellPadding: 1.4, lineColor: colors.soft, textColor: colors.ink, overflow: 'linebreak' },
      headStyles: { fillColor: colors.accent, textColor: colors.white, fontStyle: 'bold', fontSize: 7.8 },
      alternateRowStyles: { fillColor: colors.soft },
      footStyles: { fillColor: colors.ink, textColor: colors.white, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 20, halign: 'left' },
        1: { cellWidth: 34, halign: 'left' },
        2: { cellWidth: 82, halign: 'left' },
        3: { cellWidth: 32, halign: 'left' },
        4: { cellWidth: 22, halign: 'right', fontStyle: 'bold' }
      }
    });

    currentY = this.getLastAutoTableY(doc, currentY);
    currentY = this.startPdfSection(doc, 'Detalle del movimiento del dia - Egresos', currentY, colors);

    currentY = this.addPdfParagraph(
      doc,
      `Cantidad de egresos: ${this.egresosDia.length}. Total egresado: ${this.formatCurrency(totalEgresos)}.`,
      currentY,
      colors
    );

    autoTable(doc, {
      startY: currentY,
      head: [['Hora', 'Tipo', 'Descripcion', 'Medio', 'Importe']],
      body: this.egresosDia.length
        ? this.egresosDia.map(egreso => [
            this.formatHour(egreso.createdAt),
            this.normalizeText(egreso.tipoEgreso || '-'),
            this.normalizeText(egreso.descripcion || '-'),
            this.normalizeText(this.normalizeMedio(egreso.medioPago || 'EFECTIVO')),
            this.formatCurrency(Number(egreso.monto || 0))
          ])
        : [['-', '-', 'Sin egresos en el dia', '-', this.formatCurrency(0)]],
      foot: [['', '', '', 'Total egresos', this.formatCurrency(totalEgresos)]],
      margin: { left: 12, right: 12 },
      styles: { fontSize: 7.8, cellPadding: 1.4, lineColor: colors.soft, textColor: colors.ink, overflow: 'linebreak' },
      headStyles: { fillColor: colors.accent, textColor: colors.white, fontStyle: 'bold', fontSize: 7.8 },
      alternateRowStyles: { fillColor: colors.soft },
      footStyles: { fillColor: colors.ink, textColor: colors.white, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 20, halign: 'left' },
        1: { cellWidth: 34, halign: 'left' },
        2: { cellWidth: 82, halign: 'left' },
        3: { cellWidth: 32, halign: 'left' },
        4: { cellWidth: 22, halign: 'right', fontStyle: 'bold' }
      }
    });

    currentY = this.getLastAutoTableY(doc, currentY);
    this.addPdfParagraph(
      doc,
      `Cierre esperado del dia: inicio ${this.formatCurrency(this.saldoInicialDia)} + neto ${this.formatCurrency(cierre.totalNeto)} = continuidad ${this.formatCurrency(cierre.disponibleContinuidad)}.`,
      currentY + 3,
      colors
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

  private getLastAutoTableY(doc: jsPDF, fallback: number): number {
    return (doc as any).lastAutoTable?.finalY || fallback;
  }

  private startPdfSection(
    doc: jsPDF,
    title: string,
    previousY: number,
    colors: Record<string, [number, number, number]>
  ): number {
    const pageHeight = doc.internal.pageSize.getHeight();
    let sectionY = previousY + 8;

    if (sectionY > pageHeight - 18) {
      doc.addPage();
      sectionY = 18;
    }

    this.drawSectionTitle(doc, title, sectionY, colors);
    return sectionY + 4;
  }

  private addPdfParagraph(
    doc: jsPDF,
    text: string,
    y: number,
    colors: Record<string, [number, number, number]>
  ): number {
    const pageHeight = doc.internal.pageSize.getHeight();
    let currentY = y;

    if (currentY > pageHeight - 18) {
      doc.addPage();
      currentY = 18;
    }

    const lines = doc.splitTextToSize(this.normalizeText(text), 182);
    doc.setFontSize(8);
    doc.setTextColor(...colors.ink);
    doc.text(lines, 14, currentY);

    return currentY + (lines.length * 4.2);
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

    doc.setFillColor(...colors.ink);
    doc.roundedRect(10, 8, pageWidth - 20, 16, 2, 2, 'F');

    doc.setTextColor(...colors.white);
    doc.setFontSize(13.5);
    doc.text('Cierre Diario', 16, 16);
    doc.setFontSize(8.2);
    doc.text('Informe de cierre por medio de pago y detalle operativo del dia', 16, 20);

    doc.setFontSize(7.7);
    doc.text(`Fecha operativa: ${cierre.fecha}`, pageWidth - 78, 14);
    doc.text(`Generado: ${fechaHora}`, pageWidth - 78, 18);
    doc.text(`Estado: ${cierre.id === 'preview' ? 'Previsualizacion' : 'Cierre registrado'}`, pageWidth - 78, 22);

    doc.setTextColor(...colors.ink);
  }

  private drawSectionTitle(
    doc: jsPDF,
    title: string,
    y: number,
    colors: Record<string, [number, number, number]>
  ) {
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFillColor(...colors.soft);
    doc.roundedRect(12, y - 3, pageWidth - 24, 5.4, 1.2, 1.2, 'F');
    doc.setDrawColor(...colors.accent);
    doc.line(12, y + 3.1, pageWidth - 12, y + 3.1);
    doc.setFontSize(8.6);
    doc.setTextColor(...colors.ink);
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
      doc.setDrawColor(...colors.soft);
      doc.line(10, pageHeight - 10, pageWidth - 10, pageHeight - 10);
      doc.setFontSize(8);
      doc.setTextColor(...colors.accent);
      doc.text(`Cierre ${cierre.fecha}${cierre.id === 'preview' ? ' | Previsualizacion' : ''}`, 12, pageHeight - 5.5);
      doc.text(`Pagina ${page} de ${pageCount}`, pageWidth - 28, pageHeight - 5.5);
    }
    doc.setTextColor(...colors.ink);
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

  private formatHour(value?: string): string {
    if (!value) {
      return '-';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '-';
    }

    return new Intl.DateTimeFormat('es-AR', {
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(Number(value || 0));
  }

  private sumRegistrosOperativos(): number {
    return this.registrosDia.reduce((acc, item) => acc + Number(item.subtotal || 0), 0);
  }

  private sumIngresosManuales(): number {
    return this.ingresosDia.reduce((acc, item) => acc + Number(item.monto || 0), 0);
  }

  private sumEgresosDia(): number {
    return this.egresosDia.reduce((acc, item) => acc + Number(item.monto || 0), 0);
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
