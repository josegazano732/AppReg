import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { CajaService } from '../../core/services/caja.service';
import { ConfigService } from '../../core/services/config.service';
import { IngresoCaja } from '../../shared/models/finance.model';

@Component({
  selector: 'app-ingresos-caja',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './ingresos-caja.component.html',
  styleUrls: ['./ingresos-caja.component.css']
})
export class IngresosCajaComponent implements OnInit {
  fechaSeleccionada = this.caja.getTodayDateKey();
  tiposIngreso: string[] = [];
  medios: string[] = [];
  ingresosDia: IngresoCaja[] = [];
  efectivoEsperadoDia = 0;

  cajaDia = {
    totalIngresos: 0,
    totalGastos: 0,
    totalNeto: 0,
    saldo: { efectivo: 0, cheques: 0, posnet: 0, deposito: 0 }
  };

  form = this.fb.group({
    tipoIngreso: ['VENTA', Validators.required],
    concepto: ['', Validators.required],
    monto: ['', [Validators.required, Validators.pattern(/^(?:\d{1,3}(?:\.\d{3})*|\d+)(?:,\d{0,2})?$/)]],
    medioPago: ['EFECTIVO', Validators.required],
    observacion: [''],
    comprobante: ['']
  });

  constructor(private fb: FormBuilder, private caja: CajaService, private config: ConfigService) {}

  ngOnInit() {
    this.tiposIngreso = this.ensureTiposIngreso(this.config.getTiposIngreso());
    this.medios = this.ensureEfectivoFirst(this.config.getMedios());

    this.form.patchValue({
      tipoIngreso: this.tiposIngreso[0] || 'VENTA',
      medioPago: this.medios[0] || 'EFECTIVO'
    });

    this.config.tiposIngreso.subscribe(values => {
      this.tiposIngreso = this.ensureTiposIngreso(values);
      const selected = String(this.form.get('tipoIngreso')?.value || '').trim().toUpperCase();
      if (!this.tiposIngreso.includes(selected)) {
        this.form.patchValue({ tipoIngreso: this.tiposIngreso[0] || 'VENTA' });
      }
    });

    this.config.medios.subscribe(values => {
      this.medios = this.ensureEfectivoFirst(values);
      const selected = String(this.form.get('medioPago')?.value || '').trim().toUpperCase();
      if (!this.medios.includes(selected)) {
        this.form.patchValue({ medioPago: this.medios[0] || 'EFECTIVO' });
      }
    });

    this.refresh();
    this.caja.ingresos.subscribe(() => this.refresh());
    this.caja.registros.subscribe(() => this.refresh());
    this.caja.gastos.subscribe(() => this.refresh());
    this.caja.cierres.subscribe(() => this.refresh());
  }

  onFechaChange() {
    this.refresh();
  }

  onMontoFocus(event: FocusEvent) {
    const input = event.target as HTMLInputElement | null;
    if (!input) return;
    setTimeout(() => input.select(), 0);
  }

  onMontoKeydown(event: KeyboardEvent) {
    if (event.key !== '.' && event.key !== 'Decimal') return;
    const input = event.target as HTMLInputElement | null;
    if (!input) return;

    event.preventDefault();
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.setRangeText(',', start, end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  onMontoInput() {
    this.normalizeMontoControl();
  }

  addIngreso() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const monto = this.parseImporte(value.monto);
    if (monto <= 0) {
      this.form.get('monto')?.setErrors({ montoInvalido: true });
      this.form.get('monto')?.markAsTouched();
      return;
    }

    this.caja.addIngreso({
      fecha: this.fechaSeleccionada,
      tipoIngreso: String(value.tipoIngreso || this.tiposIngreso[0] || 'VENTA').toUpperCase(),
      concepto: String(value.concepto || '').trim(),
      monto,
      medioPago: String(value.medioPago || 'EFECTIVO').toUpperCase(),
      observacion: String(value.observacion || '').trim(),
      comprobante: String(value.comprobante || '').trim()
    });

    this.form.reset({
      tipoIngreso: this.tiposIngreso[0] || 'VENTA',
      concepto: '',
      monto: '',
      medioPago: this.medios[0] || 'EFECTIVO',
      observacion: '',
      comprobante: ''
    });
  }

  removeIngreso(id?: string) {
    if (!id) return;
    this.caja.removeIngreso(id);
  }

  private refresh() {
    this.ingresosDia = this.caja.getIngresosPendientesByDate(this.fechaSeleccionada);
    const inicio = this.caja.getInicioOperativoPorMedio(this.fechaSeleccionada);
    const pendiente = this.caja.getCajaPendienteParaCierre(this.fechaSeleccionada);

    this.efectivoEsperadoDia = Number(inicio.EFECTIVO || 0) + Number(pendiente.saldo.efectivo || 0);

    this.cajaDia = {
      totalIngresos: pendiente.totalIngresos,
      totalGastos: pendiente.totalGastos,
      totalNeto: pendiente.totalNeto,
      saldo: pendiente.saldo
    };
  }

  private ensureTiposIngreso(list: string[]): string[] {
    const normalized = [...new Set((list || []).map(item => String(item || '').trim().toUpperCase()).filter(Boolean))];
    return normalized.length ? normalized : ['VENTA'];
  }

  private ensureEfectivoFirst(list: string[]): string[] {
    const normalized = [...new Set((list || []).map(item => String(item || '').trim().toUpperCase()).filter(Boolean))];
    if (!normalized.includes('EFECTIVO')) {
      normalized.unshift('EFECTIVO');
      return normalized;
    }
    return ['EFECTIVO', ...normalized.filter(item => item !== 'EFECTIVO')];
  }

  private normalizeMontoControl() {
    const control = this.form.get('monto');
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
