import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { auditTime, merge } from 'rxjs';
import { ConciliacionBancariaService, OpcionConciliacionManual, ResultadoConciliacionBancaria } from '../../core/services/conciliacion-bancaria.service';
import { CajaService } from '../../core/services/caja.service';
import { MovimientoBancario } from '../../shared/models/finance.model';

@Component({
  selector: 'app-conciliacion-bancaria',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './conciliacion-bancaria.component.html',
  styleUrls: ['./conciliacion-bancaria.component.css']
})
export class ConciliacionBancariaComponent implements OnInit {
  importText = '';
  importError = '';
  importMessage = '';
  resultados: ResultadoConciliacionBancaria[] = [];
  resultadosFiltrados: ResultadoConciliacionBancaria[] = [];
  opcionesManuales: Record<string, OpcionConciliacionManual[]> = {};
  seleccionManual: Record<string, string> = {};
  panelManualAbierto: Record<string, boolean> = {};
  filtroEstado: 'TODOS' | 'PENDIENTE' | 'CONCILIADO' | 'REVISAR' = 'TODOS';
  filtroProceso: 'TODOS' | 'ABIERTOS' | 'CERRADOS' = 'TODOS';
  busquedaOperacion = '';

  kpiTotal = 0;
  kpiPendientes = 0;
  kpiConciliados = 0;
  kpiRevisar = 0;
  kpiCerrados = 0;
  kpiProcesosAbiertos = 0;

  constructor(private conciliacion: ConciliacionBancariaService, private caja: CajaService) {}

  ngOnInit() {
    this.refresh();

    merge(this.conciliacion.movimientos, this.caja.registros)
      .pipe(auditTime(40))
      .subscribe(() => {
        this.conciliacion.conciliarAutomaticamente();
        this.refresh();
      });
  }

  importarTexto() {
    this.importError = '';
    this.importMessage = '';

    try {
      const rows = this.parseImportText(this.importText);
      if (!rows.length) {
        this.importError = 'No se detectaron filas validas para importar.';
        return;
      }

      this.conciliacion.importMovimientos(rows);
      this.importMessage = `${rows.length} movimiento(s) importado(s) y conciliados automaticamente.`;
      this.importText = '';
    } catch (error) {
      this.importError = error instanceof Error ? error.message : 'No se pudo importar el texto.';
    }
  }

  reConciliar() {
    this.conciliacion.conciliarAutomaticamente();
    this.importMessage = 'Conciliacion automatica recalculada.';
    this.importError = '';
  }

  eliminarMovimiento(id: string) {
    this.conciliacion.removeMovimiento(id);
  }

  toggleManualPanel(movimientoId: string) {
    this.panelManualAbierto[movimientoId] = !this.panelManualAbierto[movimientoId];
  }

  aplicarConciliacionManual(movimientoId: string) {
    const selected = String(this.seleccionManual[movimientoId] || '');
    if (!selected) {
      this.importError = 'Selecciona un candidato antes de aplicar la conciliacion manual.';
      this.importMessage = '';
      return;
    }

    const [registroId, ordenPagoRaw] = selected.split('|');
    const ordenPago = Number(ordenPagoRaw || 0);
    if (!registroId || !ordenPago) {
      this.importError = 'La seleccion manual es invalida.';
      this.importMessage = '';
      return;
    }

    try {
      this.conciliacion.aplicarConciliacionManual(movimientoId, registroId, ordenPago);
      this.importMessage = 'Conciliacion manual aplicada.';
      this.importError = '';
      this.panelManualAbierto[movimientoId] = false;
      this.refresh();
    } catch (error) {
      this.importError = error instanceof Error ? error.message : 'No se pudo aplicar la conciliacion manual.';
      this.importMessage = '';
    }
  }

  liberarConciliacion(movimientoId: string) {
    this.conciliacion.liberarConciliacion(movimientoId);
    this.importMessage = 'Conciliacion liberada. Se recalculo el estado automatico.';
    this.importError = '';
    this.refresh();
  }

  cerrarProceso(movimientoId: string) {
    try {
      this.conciliacion.cerrarProcesoConciliacion(movimientoId);
      this.importMessage = 'Proceso marcado como conciliado y cerrado.';
      this.importError = '';
      this.refresh();
    } catch (error) {
      this.importError = error instanceof Error ? error.message : 'No se pudo cerrar el proceso.';
      this.importMessage = '';
    }
  }

  reabrirProceso(movimientoId: string) {
    this.conciliacion.reabrirProcesoConciliacion(movimientoId);
    this.importMessage = 'Proceso reabierto para nueva revision.';
    this.importError = '';
    this.refresh();
  }

  buildManualValue(option?: OpcionConciliacionManual): string {
    if (!option) {
      return '';
    }

    return `${option.registroId}|${option.ordenPago}`;
  }

  trackByResultado(_: number, item: ResultadoConciliacionBancaria): string {
    return item.movimiento.id;
  }

  isProcesoCerrado(movimiento: MovimientoBancario): boolean {
    return movimiento.conciliacionProceso === 'CERRADO' && Boolean(movimiento.conciliacionCerradaAt);
  }

  puedeCerrarProceso(movimiento: MovimientoBancario): boolean {
    return movimiento.conciliacionEstado === 'CONCILIADO' && !this.isProcesoCerrado(movimiento);
  }

  onFiltrosChange() {
    this.applyFiltros();
  }

  limpiarFiltros() {
    this.filtroEstado = 'TODOS';
    this.filtroProceso = 'TODOS';
    this.busquedaOperacion = '';
    this.applyFiltros();
  }

  private refresh() {
    this.resultados = this.conciliacion.buildResultados();
    this.opcionesManuales = this.resultados.reduce<Record<string, OpcionConciliacionManual[]>>((acc, item) => {
      acc[item.movimiento.id] = this.conciliacion.buildOpcionesManuales(item.movimiento.id);
      return acc;
    }, {});

    this.resultados.forEach(item => {
      const currentValue = item.movimiento.conciliadoRegistroId && item.movimiento.conciliadoPagoOrden
        ? `${item.movimiento.conciliadoRegistroId}|${item.movimiento.conciliadoPagoOrden}`
        : '';
      const fallbackValue = this.buildManualValue(this.opcionesManuales[item.movimiento.id]?.[0]);
      this.seleccionManual[item.movimiento.id] = currentValue || this.seleccionManual[item.movimiento.id] || fallbackValue;
    });

    this.applyFiltros();

    this.kpiTotal = this.resultados.length;
    this.kpiPendientes = this.resultados.filter(item => item.movimiento.conciliacionEstado === 'PENDIENTE').length;
    this.kpiConciliados = this.resultados.filter(item => item.movimiento.conciliacionEstado === 'CONCILIADO').length;
    this.kpiRevisar = this.resultados.filter(item => item.movimiento.conciliacionEstado === 'REVISAR').length;
    this.kpiCerrados = this.resultados.filter(item => this.isProcesoCerrado(item.movimiento)).length;
    this.kpiProcesosAbiertos = this.resultados.filter(item => !this.isProcesoCerrado(item.movimiento)).length;
  }

  private applyFiltros() {
    const busqueda = this.normalizeOperacion(this.busquedaOperacion);
    this.resultadosFiltrados = this.resultados.filter(item => {
      const estado = item.movimiento.conciliacionEstado || 'PENDIENTE';
      const estadoOk = this.filtroEstado === 'TODOS' || estado === this.filtroEstado;
      const procesoCerrado = this.isProcesoCerrado(item.movimiento);
      const procesoOk = this.filtroProceso === 'TODOS'
        || (this.filtroProceso === 'CERRADOS' && procesoCerrado)
        || (this.filtroProceso === 'ABIERTOS' && !procesoCerrado);
      const operacion = this.normalizeOperacion(item.movimiento.nroOperacion || '');
      const descripcion = this.normalizeOperacion(item.movimiento.descripcion || '');
      const busquedaOk = !busqueda || operacion.includes(busqueda) || descripcion.includes(busqueda);
      return estadoOk && procesoOk && busquedaOk;
    });
  }

  private parseImportText(raw: string): Array<{ fecha: string; descripcion: string; monto: number; tipo: 'CREDITO' | 'DEBITO'; nroOperacion?: string; banco?: string; cuenta?: string; referenciaExterna?: string; origenImportacion?: string }> {
    const text = String(raw || '').trim();
    if (!text) {
      return [];
    }

    const rows = this.parseCsv(text);
    if (rows.length < 2) {
      throw new Error('Incluye cabecera y al menos una fila de datos.');
    }

    const headers = rows[0].map(item => this.normalizeHeader(item));
    const mapped = rows.slice(1)
      .map(row => this.mapRow(headers, row))
      .filter(item => item.fecha && item.descripcion && Number.isFinite(item.monto));

    return mapped.map(item => ({
      fecha: item.fecha,
      descripcion: item.descripcion,
      monto: item.monto,
      tipo: item.tipo,
      nroOperacion: item.nroOperacion,
      banco: item.banco,
      cuenta: item.cuenta,
      referenciaExterna: item.referenciaExterna,
      origenImportacion: 'IMPORTACION_TXT'
    }));
  }

  private mapRow(headers: string[], row: string[]): { fecha: string; descripcion: string; monto: number; tipo: 'CREDITO' | 'DEBITO'; nroOperacion?: string; banco?: string; cuenta?: string; referenciaExterna?: string } {
    const getValue = (...aliases: string[]) => {
      const index = headers.findIndex(item => aliases.includes(item));
      return index >= 0 ? String(row[index] || '').trim() : '';
    };

    const rawFecha = getValue('fecha', 'date', 'fechaoperacion', 'fechacontable');
    const rawDescripcion = getValue('descripcion', 'detalle', 'concepto', 'movimiento', 'description');
    const rawMonto = getValue('monto', 'importe', 'amount');
    const rawOperacion = getValue('nrooperacion', 'nro_operacion', 'operacion', 'transaccion', 'transaction', 'reference');
    const rawBanco = getValue('banco', 'bank');
    const rawCuenta = getValue('cuenta', 'account');
    const rawReferencia = getValue('referenciaexterna', 'referencia', 'idexterno', 'id');
    const rawTipo = getValue('tipo', 'signo', 'debitocredito', 'creditodebito');

    const monto = this.parseAmount(rawMonto);
    const tipo: 'CREDITO' | 'DEBITO' = /DEBIT|EGRESO|-/i.test(rawTipo) || monto < 0 ? 'DEBITO' : 'CREDITO';

    return {
      fecha: this.normalizeFecha(rawFecha),
      descripcion: rawDescripcion || 'SIN DESCRIPCION',
      monto: Math.abs(monto),
      tipo,
      nroOperacion: this.normalizeOperacion(rawOperacion),
      banco: rawBanco,
      cuenta: rawCuenta,
      referenciaExterna: rawReferencia
    };
  }

  private parseCsv(text: string): string[][] {
    const delimiter = this.detectDelimiter(text);
    const rows: string[][] = [];
    let current = '';
    let row: string[] = [];
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (!inQuotes && char === delimiter) {
        row.push(current);
        current = '';
        continue;
      }

      if (!inQuotes && (char === '\n' || char === '\r')) {
        if (char === '\r' && next === '\n') {
          index += 1;
        }
        row.push(current);
        if (row.some(item => String(item || '').trim())) {
          rows.push(row.map(item => String(item || '').trim()));
        }
        row = [];
        current = '';
        continue;
      }

      current += char;
    }

    row.push(current);
    if (row.some(item => String(item || '').trim())) {
      rows.push(row.map(item => String(item || '').trim()));
    }

    return rows;
  }

  private detectDelimiter(text: string): string {
    const sample = text.split(/\r?\n/).find(line => String(line || '').trim()) || '';
    const candidates = [';', ',', '\t', '|'];
    let best = ';';
    let bestCount = -1;

    candidates.forEach(candidate => {
      const count = sample.split(candidate).length;
      if (count > bestCount) {
        best = candidate;
        bestCount = count;
      }
    });

    return best;
  }

  private normalizeHeader(value: string): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/gi, '')
      .trim()
      .toLowerCase();
  }

  private normalizeFecha(value: string): string {
    const clean = String(value || '').trim();
    if (!clean) {
      return '';
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
      return clean;
    }

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(clean)) {
      const [day, month, year] = clean.split('/');
      return `${year}-${month}-${day}`;
    }

    const parsed = new Date(clean);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }

    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private parseAmount(value: string): number {
    const clean = String(value || '')
      .replace(/\s/g, '')
      .replace(/\$/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.');

    const parsed = Number(clean);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  private normalizeOperacion(value: string): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '')
      .replace(/[^A-Z0-9._/-]/gi, '')
      .trim()
      .toUpperCase();
  }
}