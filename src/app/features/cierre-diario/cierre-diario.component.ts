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
    const colors = {
      slate900: [15, 23, 42] as [number, number, number],
      slate700: [51, 65, 85] as [number, number, number],
      blue800: [30, 64, 175] as [number, number, number],
      cyan800: [21, 94, 117] as [number, number, number],
      gray100: [241, 245, 249] as [number, number, number],
      white: [255, 255, 255] as [number, number, number]
    };

    doc.setFontSize(15);
    doc.text('Cierre Diario - Reporte de Conciliacion', 14, 14);
    doc.setFontSize(10);
    doc.text(`Fecha operativa: ${cierre.fecha}`, 14, 20);
    doc.text(`Generado: ${fechaHora}`, 14, 25);

    autoTable(doc, {
      startY: 30,
      head: [['Indicador', 'Valor']],
      body: [
        ['Saldo inicial continuidad', this.formatCurrency(this.saldoInicialDia)],
        ['Ingresos del dia', this.formatCurrency(cierre.totalIngresos)],
        ['Egresos del dia', this.formatCurrency(cierre.totalGastos)],
        ['Neto del dia', this.formatCurrency(cierre.totalNeto)],
        ['Disponible continuidad', this.formatCurrency(cierre.disponibleContinuidad)],
        ['Cantidad de registros', String(this.registrosDia.length)]
      ],
      margin: { left: 12, right: 12 },
      styles: { fontSize: 9, cellPadding: 2, valign: 'middle' },
      headStyles: { fillColor: colors.slate900, textColor: colors.white, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: colors.gray100 },
      columnStyles: {
        0: { cellWidth: 90, halign: 'left' },
        1: { cellWidth: 70, halign: 'center' }
      },
      didParseCell: data => {
        if (data.section === 'head' && data.column.index === 1) {
          data.cell.styles.halign = 'center';
        }
      }
    });

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 6,
      head: [['Concepto', 'Movimientos', 'Total']],
      body: conceptoResumen.length
        ? conceptoResumen.map(item => [item.concepto, String(item.cantidad), this.formatCurrency(item.total)])
        : [['Sin conceptos', '0', this.formatCurrency(0)]],
      margin: { left: 12, right: 12 },
      styles: { fontSize: 9, cellPadding: 1.8, valign: 'middle' },
      headStyles: { fillColor: colors.blue800, textColor: colors.white, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: colors.gray100 },
      columnStyles: {
        0: { cellWidth: 126, halign: 'left' },
        1: { cellWidth: 34, halign: 'center' },
        2: { cellWidth: 50, halign: 'center' }
      },
      didParseCell: data => {
        if (data.section === 'head' && (data.column.index === 1 || data.column.index === 2)) {
          data.cell.styles.halign = 'center';
        }
      }
    });

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 6,
      head: [['Medio de pago', 'Movimientos', 'Total']],
      body: medioResumen.length
        ? medioResumen.map(item => [item.medioPago, String(item.cantidad), this.formatCurrency(item.total)])
        : [['Sin medios', '0', this.formatCurrency(0)]],
      margin: { left: 12, right: 12 },
      styles: { fontSize: 9, cellPadding: 1.8, valign: 'middle' },
      headStyles: { fillColor: colors.cyan800, textColor: colors.white, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: colors.gray100 },
      columnStyles: {
        0: { cellWidth: 126, halign: 'left' },
        1: { cellWidth: 34, halign: 'center' },
        2: { cellWidth: 50, halign: 'center' }
      },
      didParseCell: data => {
        if (data.section === 'head' && (data.column.index === 1 || data.column.index === 2)) {
          data.cell.styles.halign = 'center';
        }
      }
    });

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 6,
      head: [['Recibo', 'Nombre', 'Conceptos', 'Medios de pago', 'Total']],
      body: this.registrosDia.length
        ? this.registrosDia.map(item => [
            this.normalizeText(item.nroRecibo),
            this.normalizeText(item.nombre),
            this.describeConceptos(item),
            this.describePagos(item),
            this.formatCurrency(Number(item.subtotal || 0))
          ])
        : [['-', '-', 'Sin registros', '-', this.formatCurrency(0)]],
      margin: { left: 8, right: 8 },
      tableWidth: 'auto',
      styles: { fontSize: 7.5, cellPadding: 1.2, overflow: 'linebreak', valign: 'top' },
      columnStyles: {
        0: { cellWidth: 24, halign: 'left' },
        1: { cellWidth: 42, halign: 'left' },
        2: { cellWidth: 86 },
        3: { cellWidth: 86 },
        4: { halign: 'center', cellWidth: 24 }
      },
      headStyles: { fillColor: colors.slate700, textColor: colors.white, fontSize: 8, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: colors.gray100 },
      didParseCell: data => {
        if (data.section === 'head' && data.column.index === 4) {
          data.cell.styles.halign = 'center';
        }
        if (data.section === 'body' && (data.column.index === 2 || data.column.index === 3)) {
          const text = Array.isArray(data.cell.text) ? data.cell.text.join('\n') : String(data.cell.text || '');
          data.cell.text = this.compactBulletLines(text).split('\n');
        }
      }
    });

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
