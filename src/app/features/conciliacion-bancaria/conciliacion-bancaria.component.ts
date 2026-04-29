import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { auditTime, merge } from 'rxjs';
import { ConciliacionBancariaService, OpcionConciliacionManual, ResultadoConciliacionBancaria } from '../../core/services/conciliacion-bancaria.service';
import { CajaService } from '../../core/services/caja.service';
import { MovimientoBancario } from '../../shared/models/finance.model';

type MovimientoImportado = {
  fecha: string;
  descripcion: string;
  monto: number;
  tipo: 'CREDITO' | 'DEBITO';
  nroOperacion?: string;
  banco?: string;
  cuenta?: string;
  referenciaExterna?: string;
  origenImportacion?: string;
};

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
  importFileName = '';
  processingImportFile = false;
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
      this.importFileName = '';
    } catch (error) {
      this.importError = error instanceof Error ? error.message : 'No se pudo importar el texto.';
    }
  }

  async importarArchivo(event: Event) {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      return;
    }

    this.importError = '';
    this.importMessage = '';
    this.importFileName = file.name;
    this.processingImportFile = true;

    try {
      const lowerName = file.name.toLowerCase();

      if (lowerName.endsWith('.pdf')) {
        const extractedText = await this.extractTextFromPdf(file);
        const movimientos = this.parseImportText(extractedText);

        if (!movimientos.length) {
          this.importText = extractedText;
          throw new Error('No pude identificar movimientos confiables dentro del PDF. Te deje el texto extraido en la caja para que lo ajustes o lo pegues en formato tabulado.');
        }

        this.importText = this.buildImportPreview(movimientos);
        this.conciliacion.importMovimientos(movimientos);
        this.refresh();
        this.importMessage = `PDF procesado. Se importaron ${movimientos.length} movimiento(s) y se recalculo la conciliacion automaticamente.`;
      } else {
        const rawText = await file.text();
        this.importText = rawText;
        this.importMessage = 'Archivo cargado. Revisa el contenido y confirma con Importar texto.';
      }
    } catch (error) {
      this.importError = error instanceof Error ? error.message : 'No se pudo procesar el archivo.';
    } finally {
      this.processingImportFile = false;
      if (input) {
        input.value = '';
      }
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

  buildDescripcionMovimiento(item: ResultadoConciliacionBancaria): string {
    const descripcion = this.normalizeDescripcionVisual(item.movimiento.descripcion);
    return descripcion || 'SIN DESCRIPCION';
  }

  getDescripcionCuitLabel(movimiento: MovimientoBancario): string {
    const context = this.normalizeOperacion([
      movimiento.banco || '',
      movimiento.descripcion || '',
      movimiento.referenciaExterna || '',
      movimiento.cuenta || ''
    ].join(' '));

    if (context.includes('ING')) {
      return 'CUIT ING';
    }

    return 'CUIT contraparte';
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

  private parseImportText(raw: string): MovimientoImportado[] {
    const text = String(raw || '').trim();
    if (!text) {
      return [];
    }

    if (this.looksLikeDelimitedImport(text)) {
      return this.parseDelimitedImportText(text);
    }

    return this.parsePdfStatementText(text);
  }

  private parseDelimitedImportText(text: string): MovimientoImportado[] {

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

  private parsePdfStatementText(text: string): MovimientoImportado[] {
    if (this.looksLikeAccountStatement(text)) {
      const accountRows = this.parseAccountStatementText(text);
      if (accountRows.length) {
        return accountRows.map(item => ({
          ...item,
          origenImportacion: 'IMPORTACION_PDF'
        }));
      }
    }

    const blocks = this.buildPdfStatementBlocks(text);
    const parsed = blocks
      .map(block => this.parsePdfStatementBlock(block))
      .filter((item): item is MovimientoImportado => Boolean(item));

    return parsed.map(item => ({
      ...item,
      origenImportacion: 'IMPORTACION_PDF'
    }));
  }

  private looksLikeAccountStatement(text: string): boolean {
    const normalized = this.normalizeOperacion(text);
    return normalized.includes('ULTIMOSMOVIMIENTOSDE')
      && normalized.includes('FECHADESCRIPCIONIMPORTESALDO');
  }

  private parseAccountStatementText(text: string): MovimientoImportado[] {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map(line => this.normalizePdfLine(line))
      .filter(line => line && !this.isAccountStatementNoiseLine(line));

    const dateIndexes = lines
      .map((line, index) => this.startsWithStatementDate(line) ? index : -1)
      .filter(index => index >= 0);

    return dateIndexes
      .map((lineIndex, position) => {
        const previousDateIndex = position > 0 ? dateIndexes[position - 1] : -1;
        const nextDateIndex = position < dateIndexes.length - 1 ? dateIndexes[position + 1] : lines.length;
        const previousLines = lines.slice(previousDateIndex + 1, lineIndex);
        const nextLines = lines.slice(lineIndex + 1, nextDateIndex);
        return this.parseAccountStatementRow(lines[lineIndex], previousLines, nextLines);
      })
      .filter((item): item is MovimientoImportado => Boolean(item));
  }

  private parseAccountStatementRow(currentLine: string, previousLines: string[], nextLines: string[]): MovimientoImportado | null {
    const match = currentLine.match(/^(\d{2}[/-]\d{2}[/-]\d{2,4})\s+(\d+)\s*(.*)$/);
    if (!match) {
      return null;
    }

    const [, rawFecha, transactionId, currentRest] = match;
    const fecha = this.normalizeFecha(rawFecha);
    if (!fecha) {
      return null;
    }

    const previousRelevant = previousLines.filter(line => !this.isAccountStatementIgnorableContext(line)).slice(-2);
    const nextRelevant = nextLines.filter(line => !this.isAccountStatementIgnorableContext(line)).slice(0, 2);
    const amountFromPrevious = [...previousRelevant].reverse().find(line => this.isStandaloneAmountLine(line));
    const currentAmounts = this.extractAmountTokens(currentRest);
    const previousAmountCarrier = [...previousRelevant].reverse().find(line => !this.isStandaloneAmountLine(line) && this.extractAmountTokens(line).length);

    let amountToken = amountFromPrevious;
    if (!amountToken) {
      if (currentAmounts.length >= 1) {
        amountToken = currentAmounts[0];
      } else if (previousAmountCarrier) {
        amountToken = this.extractAmountTokens(previousAmountCarrier)[0];
      } else {
        const nextAmountCarrier = nextRelevant.find(line => this.extractAmountTokens(line).length);
        amountToken = nextAmountCarrier ? this.extractAmountTokens(nextAmountCarrier)[0] : undefined;
      }
    }

    if (!amountToken) {
      return null;
    }

    const monto = this.parseAmount(amountToken);
    if (!Number.isFinite(monto)) {
      return null;
    }

    const rawContextParts = [
      ...previousRelevant.filter(line => !this.isStandaloneAmountLine(line)),
      currentRest,
      ...nextRelevant.filter(line => !this.isStandaloneAmountLine(line))
    ];
    const detectedCuit = this.extractDetectedCuit(rawContextParts.join(' '));
    const descriptionParts = [
      ...previousRelevant.filter(line => !this.isStandaloneAmountLine(line) && !this.isMostlyNumericLine(line)),
      currentRest,
      ...nextRelevant.filter(line => !this.isStandaloneAmountLine(line) && !this.isMostlyNumericLine(line))
    ];
    const descripcion = this.appendDetectedCuit(
      this.cleanAccountStatementDescription(descriptionParts.join(' '), transactionId, amountToken),
      detectedCuit
    );

    return {
      fecha,
      descripcion: descripcion || 'SIN DESCRIPCION',
      monto: Math.abs(monto),
      tipo: this.detectStatementTipo(descriptionParts.join(' '), amountToken),
      nroOperacion: transactionId,
      referenciaExterna: this.extractExternalReference(descriptionParts.join(' ')) || transactionId
    };
  }

  private buildPdfStatementBlocks(text: string): string[] {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map(line => this.normalizePdfLine(line))
      .filter(line => line && !this.isPdfNoiseLine(line));

    const blocks: string[] = [];
    let current = '';

    lines.forEach(line => {
      if (this.startsWithStatementDate(line)) {
        if (current) {
          blocks.push(current);
        }
        current = line;
        return;
      }

      if (current) {
        current = `${current} ${line}`.trim();
      }
    });

    if (current) {
      blocks.push(current);
    }

    return blocks;
  }

  private parsePdfStatementBlock(block: string): MovimientoImportado | null {
    const match = block.match(/^(\d{2}[/-]\d{2}[/-]\d{2,4})(?:\s+\d{2}[/-]\d{2}[/-]\d{2,4})?\s+(.*)$/);
    if (!match) {
      return null;
    }

    const [, rawFecha, rawBody] = match;
    const fecha = this.normalizeFecha(rawFecha);
    const body = String(rawBody || '').trim();
    if (!fecha || !body) {
      return null;
    }

    const amountToken = this.pickStatementAmountToken(body);
    if (!amountToken) {
      return null;
    }

    const amountValue = this.parseAmount(amountToken.value);
    if (!Number.isFinite(amountValue)) {
      return null;
    }

    const bodyWithoutAmount = `${body.slice(0, amountToken.index)} ${body.slice(amountToken.index + amountToken.value.length)}`
      .replace(/\s+/g, ' ')
      .trim();
    const nroOperacion = this.extractOperacionFromStatement(bodyWithoutAmount);
    const descripcion = this.appendDetectedCuit(
      this.cleanStatementDescription(bodyWithoutAmount, nroOperacion),
      this.extractDetectedCuit(bodyWithoutAmount)
    );
    const tipo = this.detectStatementTipo(body, amountToken.value);

    return {
      fecha,
      descripcion: descripcion || 'SIN DESCRIPCION',
      monto: Math.abs(amountValue),
      tipo,
      nroOperacion,
      referenciaExterna: nroOperacion
    };
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

  private looksLikeDelimitedImport(text: string): boolean {
    const firstLine = String(text || '').split(/\r?\n/).find(line => String(line || '').trim()) || '';
    const normalized = this.normalizeHeader(firstLine);
    return /fecha|descripcion|monto|nrooperacion|importe|detalle|concepto|movimiento/.test(normalized)
      && /[;,|\t]/.test(firstLine);
  }

  private normalizePdfLine(value: string): string {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isPdfNoiseLine(line: string): boolean {
    const normalized = this.normalizeOperacion(line);
    return !normalized
      || /^---PAGE\d+---$/i.test(normalized)
      || /^PAGINA\d+/i.test(normalized)
      || /^RESUMEN/i.test(normalized)
      || /^CUENTA/i.test(normalized)
      || /^SALDOANTERIOR/i.test(normalized)
      || /^SALDOACTUAL/i.test(normalized)
      || /^FECHA(?:VALOR|OPERACION)?DESCRIPCION/i.test(normalized)
      || /^MOVIMIENTOS?DELCUENTA/i.test(normalized);
  }

  private isAccountStatementNoiseLine(line: string): boolean {
    const normalized = this.normalizeOperacion(line);
    return !normalized
      || /^---PAGE\d+---$/i.test(normalized)
      || normalized === 'NRO.'
      || normalized === 'TRANSACCION'
      || normalized === 'FECHADESCRIPCIONIMPORTESALDO'
      || normalized.startsWith('ULTIMOSMOVIMIENTOSDE')
      || normalized.startsWith('NUMERODECUENTA');
  }

  private isAccountStatementIgnorableContext(line: string): boolean {
    return this.isAccountStatementNoiseLine(line) || /^\$\s*\d/.test(String(line || '').trim()) && !this.startsWithStatementDate(line);
  }

  private isStandaloneAmountLine(line: string): boolean {
    return /^-?\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})$/.test(String(line || '').trim());
  }

  private isMostlyNumericLine(line: string): boolean {
    return /^\d{8,14}$/.test(String(line || '').trim()) || /^\d{11,14}$/.test(this.normalizeOperacion(line));
  }

  private extractAmountTokens(value: string): string[] {
    return [...String(value || '').matchAll(/-?\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})/g)].map(match => match[0]);
  }

  private cleanAccountStatementDescription(value: string, transactionId: string, amountToken: string): string {
    const cleaned = String(value || '')
      .replace(new RegExp(`\\b${transactionId}\\b`, 'g'), ' ')
      .replace(new RegExp(amountToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ' ')
      .replace(/\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})/g, ' ')
      .replace(/\b\d{11,14}\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned;
  }

  private extractDetectedCuit(value: string): string | undefined {
    const match = String(value || '').match(/\b\d{2}[-\s.]?\d{8}[-\s.]?\d\b|\b\d{11}\b/);
    if (!match?.[0]) {
      return undefined;
    }

    const digits = match[0].replace(/\D/g, '').slice(0, 11);
    return digits || undefined;
  }

  private appendDetectedCuit(descripcion: string, cuit?: string): string {
    const base = String(descripcion || '').trim();
    if (!cuit) {
      return base;
    }

    if (base.includes(cuit) || base.includes(`CUIT ${cuit}`)) {
      return base;
    }

    return base ? `${base} | CUIT ${cuit}` : `CUIT ${cuit}`;
  }

  private extractExternalReference(value: string): string | undefined {
    const explicit = String(value || '').match(/(?:TRANSF|CREDIN|TEF)[:\s]+([A-Z0-9-]{8,})/i);
    return explicit?.[1] ? this.normalizeOperacion(explicit[1]) : undefined;
  }

  private startsWithStatementDate(line: string): boolean {
    return /^(\d{2}[/-]\d{2}[/-]\d{2,4})(?:\s+\d{2}[/-]\d{2}[/-]\d{2,4})?\b/.test(String(line || '').trim());
  }

  private pickStatementAmountToken(value: string): { value: string; index: number } | null {
    const matches = [...String(value || '').matchAll(/[+-]?\$?\d{1,3}(?:\.\d{3})*(?:,\d{2})|[+-]?\$?\d+(?:,\d{2})/g)];
    if (!matches.length) {
      return null;
    }

    const signed = matches.find(match => /^[+-]/.test(match[0] || ''));
    const selected = signed || matches[matches.length - 1];
    return {
      value: selected[0],
      index: selected.index || 0
    };
  }

  private extractOperacionFromStatement(value: string): string | undefined {
    const explicit = String(value || '').match(/(?:NRO(?:\.|\s+DE)?\s*OPERACION|NROOPERACION|OPERACION|OP\.?|TRX|REF(?:ERENCIA)?|COMPROBANTE)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{5,})/i);
    if (explicit?.[1]) {
      return this.normalizeOperacion(explicit[1]);
    }

    const tokens = String(value || '').split(/\s+/);
    const inferred = tokens.find(token => /^(?=.*\d)(?=.*[A-Z])[A-Z0-9._/-]{6,}$/i.test(token));
    return inferred ? this.normalizeOperacion(inferred) : undefined;
  }

  private cleanStatementDescription(value: string, nroOperacion?: string): string {
    let next = String(value || '');

    if (nroOperacion) {
      const escaped = nroOperacion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      next = next.replace(new RegExp(escaped, 'ig'), ' ');
    }

    next = next
      .replace(/(?:NRO(?:\.|\s+DE)?\s*OPERACION|NROOPERACION|OPERACION|OP\.?|TRX|REF(?:ERENCIA)?|COMPROBANTE)\s*[:#-]?/gi, ' ')
      .replace(/\b(?:CREDITO|DEBITO|DB|CR)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return next;
  }

  private detectStatementTipo(body: string, amountToken: string): 'CREDITO' | 'DEBITO' {
    const normalized = this.normalizeOperacion(body);
    if (/^-/.test(amountToken) || /\bDEBITO\b|\bDB\b|\bPAGO\b|\bCOMPRA\b|\bEXTRACCION\b|\bCOMISION\b|\bIMPUESTO\b/.test(normalized)) {
      return 'DEBITO';
    }

    if (/^\+/.test(amountToken) || /\bCREDITO\b|\bCR\b|\bACREDITACION\b|\bDEPOSITO\b|\bTRANSFERENCIARECIBIDA\b|\bHABER\b/.test(normalized)) {
      return 'CREDITO';
    }

    return 'CREDITO';
  }

  private buildImportPreview(rows: MovimientoImportado[]): string {
    const header = 'fecha;descripcion;monto;nroOperacion;banco;cuenta;referenciaExterna;tipo';
    const body = rows.map(item => [
      item.fecha,
      this.escapeDelimitedField(item.descripcion),
      this.formatPreviewAmount(item.monto),
      item.nroOperacion || '',
      item.banco || '',
      item.cuenta || '',
      item.referenciaExterna || '',
      item.tipo
    ].join(';'));

    return [header, ...body].join('\n');
  }

  private escapeDelimitedField(value: string): string {
    const clean = String(value || '').replace(/"/g, '""');
    return /[;\n"]/.test(clean) ? `"${clean}"` : clean;
  }

  private formatPreviewAmount(value: number): string {
    return Number(value || 0).toFixed(2).replace('.', ',');
  }

  private async extractTextFromPdf(file: File): Promise<string> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('assets/pdf.worker.min.mjs', document.baseURI).toString();
    }
    const data = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({
      data,
      useWorkerFetch: false,
      isEvalSupported: false
    } as any);
    const pdf = await loadingTask.promise;
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const items = (textContent.items as Array<any>)
        .filter(item => 'str' in item && Array.isArray(item.transform))
        .map(item => ({
          str: String(item.str || '').trim(),
          x: Number(item.transform[4] || 0),
          y: Number(item.transform[5] || 0)
        }))
        .filter(item => item.str);

      items.sort((a, b) => {
        if (Math.abs(a.y - b.y) <= 2) {
          return a.x - b.x;
        }
        return b.y - a.y;
      });

      const lines: Array<{ y: number; parts: string[] }> = [];
      items.forEach(item => {
        const last = lines[lines.length - 1];
        if (!last || Math.abs(last.y - item.y) > 2) {
          lines.push({ y: item.y, parts: [item.str] });
          return;
        }

        last.parts.push(item.str);
      });

      pages.push(lines.map(line => this.normalizePdfLine(line.parts.join(' '))).filter(Boolean).join('\n'));
    }

    return pages.filter(Boolean).join('\n');
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

    if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(clean)) {
      const [day, month, year] = clean.split(/[/-]/);
      return `${year}-${month}-${day}`;
    }

    if (/^\d{2}[/-]\d{2}[/-]\d{2}$/.test(clean)) {
      const [day, month, shortYear] = clean.split(/[/-]/);
      const year = Number(shortYear) >= 70 ? `19${shortYear}` : `20${shortYear}`;
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

  private normalizeDescripcionVisual(value?: string): string {
    const sinCuit = String(value || '')
      .replace(/\|\s*CUIT\s*\d{11}/gi, ' ')
      .replace(/\bCUIT\s*\d{11}\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const segmentos = sinCuit
      .split('|')
      .map(item => item.trim())
      .filter(Boolean);

    const unicos = segmentos.filter((segmento, index) => segmentos.findIndex(item => this.normalizeOperacion(item) === this.normalizeOperacion(segmento)) === index);
    return unicos.join(' | ').trim();
  }
}