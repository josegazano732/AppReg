import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CajaService } from '../../core/services/caja.service';
import { ConfigService } from '../../core/services/config.service';
import { Registro, RegistroConceptoDetalle, RegistroPagoDetalle, TotalesMedioPago } from '../../shared/models/finance.model';

interface DisponibilidadMedio {
  medio: string;
  inicio: number;
  ingresos: number;
  egresos: number;
  movimientoNeto: number;
  disponible: number;
}

@Component({
  selector: 'app-registro-diario',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './registro-diario.component.html',
  styleUrls: ['./registro-diario.component.css']
})
export class RegistroDiarioComponent implements OnInit {
  fechaOperativa = this.caja.getTodayDateKey();
  expandedRegistroIds = new Set<string>();
  registroForm = this.fb.group({
    nroRecibo: ['', Validators.required],
    nombre: ['', Validators.required],
    subtotal: [{ value: 0, disabled: true }, [Validators.required, Validators.min(0)]],
    observacion: [''],
    conceptosDetalle: this.fb.array([this.buildConceptoItem()]),
    pagosDetalle: this.fb.array([this.buildPagoItem('EFECTIVO')])
  });

  registros: Registro[] = [];
  conceptos: string[] = [];
  mediosDisponibles: string[] = [];
  inicioPorMedio: Record<string, number> = {};
  disponibilidadPorMedio: DisponibilidadMedio[] = [];
  cierreBaseFecha = '';
  cierreBaseId = '';
  cierreBaseCreadoAt = '';
  movimientoEfectivoNetoDia = 0;

  totals: TotalesMedioPago = {
    efectivo: 0,
    cheques: 0,
    posnet: 0,
    deposito: 0,
    otros: {}
  };

  constructor(private fb: FormBuilder, private caja: CajaService, private cfg: ConfigService) {}

  ngOnInit() {
    this.refreshRegistrosPendientes();
    this.refreshInicioPorMedio();
    this.refreshDisponibilidadEfectivo();
    this.refreshDisponibilidadPorMedio();

    this.conceptos = this.cfg.getConceptos();
    this.mediosDisponibles = this.cfg.getMedios();
    this.cfg.conceptos.subscribe(c => (this.conceptos = c));
    this.cfg.medios.subscribe(m => {
      this.mediosDisponibles = m;
      this.refreshInicioPorMedio();
      this.refreshDisponibilidadPorMedio();
      this.pagosDetalle.controls.forEach(control => {
        const selected = (control.get('medioPago')?.value || '').toString();
        if (m.length && !m.includes(selected)) {
          control.patchValue({ medioPago: m[0] }, { emitEvent: false });
        }
      });
      if (!this.pagosDetalle.length && m.length) {
        this.pagosDetalle.push(this.buildPagoItem(m[0]));
      }
    });

    this.conceptosDetalle.valueChanges.subscribe(() => this.syncSubtotal());
    this.syncSubtotal();

    this.caja.registros.subscribe(() => {
      this.refreshRegistrosPendientes();
      this.refreshDisponibilidadEfectivo();
      this.refreshDisponibilidadPorMedio();
    });

    this.caja.ingresos.subscribe(() => {
      this.refreshDisponibilidadEfectivo();
      this.refreshDisponibilidadPorMedio();
    });
    this.caja.gastos.subscribe(() => {
      this.refreshDisponibilidadEfectivo();
      this.refreshDisponibilidadPorMedio();
    });
    this.caja.cierres.subscribe(() => {
      this.refreshRegistrosPendientes();
      this.refreshInicioPorMedio();
      this.refreshDisponibilidadEfectivo();
      this.refreshDisponibilidadPorMedio();
    });
  }

  addRegistro() {
    if (this.registroForm.invalid || !this.canSubmit()) {
      this.registroForm.markAllAsTouched();
      return;
    }

    const value = this.registroForm.getRawValue();
    const conceptosDetalle = this.normalizeConceptos(value.conceptosDetalle || []);
    const pagosDetalle = this.normalizePagos(value.pagosDetalle || []);
    const subtotal = this.sumConceptos(conceptosDetalle);

    this.caja.addRegistro({
      fecha: this.fechaOperativa,
      nroRecibo: value.nroRecibo || '',
      nombre: value.nombre || '',
      subtotal,
      sellados: 0,
      muni: 0,
      sugIT: 0,
      patente: 0,
      antecedentesPenales: 0,
      cheques: 0,
      posnet: 0,
      vep: 0,
      site: 0,
      deposito: 0,
      efectivo: 0,
      pagaCon: '',
      cambio: 0,
      observacion: value.observacion || '',
      concepto: conceptosDetalle[0]?.concepto || '',
      conceptoMonto: Number(conceptosDetalle[0]?.monto || 0),
      medioPago: pagosDetalle[0]?.medioPago || 'EFECTIVO',
      conceptosDetalle,
      pagosDetalle
    });

    this.resetRegistroForm();
  }

  resetRegistroForm() {
    this.registroForm.reset({
      nroRecibo: '',
      nombre: '',
      subtotal: 0,
      observacion: ''
    });
    this.conceptosDetalle.clear();
    this.pagosDetalle.clear();
    this.conceptosDetalle.push(this.buildConceptoItem());
    this.pagosDetalle.push(this.buildPagoItem(this.mediosDisponibles[0] || 'EFECTIVO'));
    this.syncSubtotal();
  }

  removeRegistro(id: string) {
    this.expandedRegistroIds.delete(id);
    this.caja.removeRegistro(id);
  }

  recalculateTotals() {
    this.totals = this.caja.computeTotalesMedioPago(this.registros);
  }

  private refreshRegistrosPendientes() {
    this.registros = this.caja.getRegistrosPendientesByDate(this.fechaOperativa);
    const validIds = new Set(this.registros.map(item => item.id));
    this.expandedRegistroIds.forEach(id => {
      if (!validIds.has(id)) {
        this.expandedRegistroIds.delete(id);
      }
    });
    this.recalculateTotals();
  }

  get conceptosDetalle(): FormArray {
    return this.registroForm.get('conceptosDetalle') as FormArray;
  }

  get pagosDetalle(): FormArray {
    return this.registroForm.get('pagosDetalle') as FormArray;
  }

  get subtotalActual(): number {
    return Number(this.registroForm.get('subtotal')?.value || 0);
  }

  get totalPagosActual(): number {
    return this.sumPagos(this.normalizePagos(this.registroForm.getRawValue().pagosDetalle || []));
  }

  get diferenciaActual(): number {
    return this.subtotalActual - this.totalPagosActual;
  }

  get totalFinalRegistros(): number {
    return this.registros.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  }

  get mediosKpiVisibles(): string[] {
    return this.mediosDisponibles.filter(medio => Number(this.getTotalForMedio(medio) || 0) !== 0);
  }

  toggleRegistroDetalle(id: string) {
    if (this.expandedRegistroIds.has(id)) {
      this.expandedRegistroIds.delete(id);
      return;
    }

    this.expandedRegistroIds.add(id);
  }

  isRegistroDetalleAbierto(id: string): boolean {
    return this.expandedRegistroIds.has(id);
  }

  getCantidadConceptos(registro: Registro): number {
    if (registro.conceptosDetalle?.length) {
      return registro.conceptosDetalle.length;
    }

    return registro.concepto ? 1 : 0;
  }

  getCantidadPagos(registro: Registro): number {
    if (registro.pagosDetalle?.length) {
      return registro.pagosDetalle.length;
    }

    return registro.medioPago ? 1 : 0;
  }

  addConceptoDetalle() {
    this.conceptosDetalle.push(this.buildConceptoItem());
  }

  removeConceptoDetalle(index: number) {
    if (this.conceptosDetalle.length === 1) return;
    this.conceptosDetalle.removeAt(index);
    this.syncSubtotal();
  }

  addPagoDetalle() {
    this.pagosDetalle.push(this.buildPagoItem(this.mediosDisponibles[0] || 'EFECTIVO'));
  }

  removePagoDetalle(index: number) {
    if (this.pagosDetalle.length === 1) return;
    this.pagosDetalle.removeAt(index);
  }

  canSubmit(): boolean {
    return this.subtotalActual > 0 && this.diferenciaActual === 0;
  }

  onImporteFocus(event: FocusEvent) {
    const input = event.target as HTMLInputElement | null;
    if (!input) return;
    setTimeout(() => input.select(), 0);
  }

  onImporteKeydown(event: KeyboardEvent) {
    if (event.key !== '.' && event.key !== 'Decimal') return;
    const input = event.target as HTMLInputElement | null;
    if (!input) return;

    event.preventDefault();
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.setRangeText(',', start, end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  onConceptoImporteInput(index: number) {
    this.normalizeImporteControl(this.conceptosDetalle, index);
    this.syncSubtotal();
  }

  onPagoImporteInput(index: number) {
    this.normalizeImporteControl(this.pagosDetalle, index);
  }

  getTotalForMedio(medio: string) {
    const k = (medio || '').toString().toUpperCase();
    if (k === 'EFECTIVO') return this.totals.efectivo || 0;
    if (k === 'CHEQUES') return this.totals.cheques || 0;
    if (k === 'POSNET') return this.totals.posnet || 0;
    if (k === 'DEPOSITO') return this.totals.deposito || 0;
    return this.totals.otros && this.totals.otros[k] ? this.totals.otros[k] : 0;
  }

  getInicioForMedio(medio: string): number {
    const key = this.normalizeMedio(medio);
    return Number(this.inicioPorMedio[key] || 0);
  }

  get inicioEfectivoDia(): number {
    return this.getInicioForMedio('EFECTIVO');
  }

  get movimientoEfectivoDia(): number {
    return Number(this.movimientoEfectivoNetoDia || 0);
  }

  get disponibleEfectivoEstimado(): number {
    return this.inicioEfectivoDia + this.movimientoEfectivoDia;
  }

  get otrosMediosInicio(): Array<{ medio: string; inicio: number }> {
    return this.mediosDisponibles
      .map(m => ({ medio: m, key: this.normalizeMedio(m) }))
      .filter(item => item.key && item.key !== 'EFECTIVO')
      .map(item => ({ medio: item.medio, inicio: this.getInicioForMedio(item.medio) }));
  }

  formatConceptos(registro: Registro): string {
    if (registro.conceptosDetalle?.length) {
      return registro.conceptosDetalle
        .map(c => `${c.concepto}: ${this.formatCurrency(c.monto)}`)
        .join(' | ');
    }
    return registro.concepto || '-';
  }

  formatPagos(registro: Registro): string {
    if (registro.pagosDetalle?.length) {
      return registro.pagosDetalle
        .map(p => `${p.medioPago}: ${this.formatCurrency(p.monto)}`)
        .join(' | ');
    }
    return registro.medioPago || 'EFECTIVO';
  }

  private buildConceptoItem() {
    return this.fb.group({
      concepto: ['', Validators.required],
      monto: ['', [Validators.required, Validators.pattern(/^(?:\d{1,3}(?:\.\d{3})*|\d+)(?:,\d{0,2})?$/)]]
    });
  }

  private buildPagoItem(defaultMedio: string) {
    return this.fb.group({
      medioPago: [defaultMedio, Validators.required],
      monto: ['', [Validators.required, Validators.pattern(/^(?:\d{1,3}(?:\.\d{3})*|\d+)(?:,\d{0,2})?$/)]]
    });
  }

  syncSubtotal() {
    const conceptos = this.normalizeConceptos(this.registroForm.getRawValue().conceptosDetalle || []);
    const subtotal = this.sumConceptos(conceptos);
    this.registroForm.patchValue({ subtotal }, { emitEvent: false });
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      maximumFractionDigits: 2
    }).format(Number(value || 0));
  }

  private normalizeConceptos(list: Array<{ concepto?: string | null; monto?: number | string | null }>): RegistroConceptoDetalle[] {
    return (list || [])
      .map(item => ({
        concepto: (item.concepto || '').trim().toUpperCase(),
        monto: this.parseImporte(item.monto)
      }))
      .filter(item => item.concepto && item.monto > 0);
  }

  private normalizePagos(list: Array<{ medioPago?: string | null; monto?: number | string | null }>): RegistroPagoDetalle[] {
    return (list || [])
      .map(item => ({
        medioPago: (item.medioPago || '').trim().toUpperCase(),
        monto: this.parseImporte(item.monto)
      }))
      .filter(item => item.medioPago && item.monto > 0);
  }

  private sumConceptos(list: RegistroConceptoDetalle[]): number {
    return list.reduce((sum, item) => sum + Number(item.monto || 0), 0);
  }

  private sumPagos(list: RegistroPagoDetalle[]): number {
    return list.reduce((sum, item) => sum + Number(item.monto || 0), 0);
  }

  private refreshInicioPorMedio() {
    this.inicioPorMedio = this.caja.getInicioOperativoPorMedio(this.fechaOperativa);
    const cierreBase = this.caja.getCierreBaseOperativa(this.fechaOperativa);

    this.cierreBaseFecha = cierreBase?.fecha || '';
    this.cierreBaseId = cierreBase?.id || '';
    this.cierreBaseCreadoAt = cierreBase?.createdAt || '';
  }

  private refreshDisponibilidadEfectivo() {
    const cajaDia = this.caja.getCajaPendienteParaCierre(this.fechaOperativa);
    this.movimientoEfectivoNetoDia = Number(cajaDia.saldo.efectivo || 0);
  }

  private refreshDisponibilidadPorMedio() {
    const cajaDia = this.caja.getCajaPendienteParaCierre(this.fechaOperativa);
    const medios = this.collectMedios(cajaDia.ingresos, cajaDia.gastos);

    this.disponibilidadPorMedio = medios.map(medio => {
      const key = this.normalizeMedio(medio);
      const inicio = Number(this.inicioPorMedio[key] || 0);
      const ingresos = this.getValueFromTotales(cajaDia.ingresos, key);
      const egresos = this.getValueFromTotales(cajaDia.gastos, key);
      const movimientoNeto = ingresos - egresos;
      const disponible = inicio + movimientoNeto;

      return {
        medio: key,
        inicio,
        ingresos,
        egresos,
        movimientoNeto,
        disponible
      };
    });
  }

  private collectMedios(ingresos: TotalesMedioPago, egresos: TotalesMedioPago): string[] {
    const base = ['EFECTIVO', 'CHEQUES', 'POSNET', 'DEPOSITO'];
    const config = (this.mediosDisponibles || []).map(m => this.normalizeMedio(m));
    const inicio = Object.keys(this.inicioPorMedio || {}).map(m => this.normalizeMedio(m));
    const otros = [...new Set([...Object.keys(ingresos.otros || {}), ...Object.keys(egresos.otros || {})])]
      .map(m => this.normalizeMedio(m));

    return [...new Set([...config, ...base, ...inicio, ...otros])].filter(Boolean);
  }

  private getValueFromTotales(totales: TotalesMedioPago, medio: string): number {
    if (medio === 'EFECTIVO') return Number(totales.efectivo || 0);
    if (medio === 'CHEQUES') return Number(totales.cheques || 0);
    if (medio === 'POSNET') return Number(totales.posnet || 0);
    if (medio === 'DEPOSITO') return Number(totales.deposito || 0);
    return Number((totales.otros || {})[medio] || 0);
  }

  private normalizeMedio(value?: string): string {
    return (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();
  }

  private normalizeImporteControl(formArray: FormArray, index: number) {
    const group = formArray.at(index);
    const control = group?.get('monto');
    if (!control) return;

    const raw = String(control.value || '');
    const cleaned = raw.replace(/[\s\$]/g, '').replace(/\./g, '').replace(/[^\d,]/g, '');
    const commaIndex = cleaned.indexOf(',');
    const hasComma = commaIndex >= 0;

    let enteraDigits = (hasComma ? cleaned.slice(0, commaIndex) : cleaned).replace(/,/g, '');
    let decimalDigits = (hasComma ? cleaned.slice(commaIndex + 1) : '').replace(/,/g, '');

    enteraDigits = enteraDigits.slice(0, 15);
    decimalDigits = decimalDigits.slice(0, 2);

    if (hasComma && !enteraDigits) {
      enteraDigits = '0';
    }

    const entera = this.formatEnteraConMiles(enteraDigits);
    const normalized = hasComma ? `${entera},${decimalDigits}` : entera;

    if (normalized !== raw) {
      control.setValue(normalized, { emitEvent: false });
    }
  }

  private parseImporte(value: number | string | null | undefined): number {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }

    const raw = String(value || '').trim();
    if (!raw) return 0;

    const cleaned = raw.replace(/[\s\$]/g, '').replace(/\./g, '').replace(/[^\d,]/g, '');
    const commaIndex = cleaned.indexOf(',');
    const entera = (commaIndex >= 0 ? cleaned.slice(0, commaIndex) : cleaned).replace(/,/g, '');
    const decimal = (commaIndex >= 0 ? cleaned.slice(commaIndex + 1) : '').replace(/,/g, '').slice(0, 2);
    const normalized = decimal.length ? `${entera}.${decimal}` : entera;

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private formatEnteraConMiles(value: string): string {
    if (!value) return '';
    return value.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
}
