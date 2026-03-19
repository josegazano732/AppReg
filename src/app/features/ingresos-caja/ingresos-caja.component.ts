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
  fechaSeleccionada = new Date().toISOString().slice(0, 10);
  tiposIngreso: string[] = [];
  medios: string[] = [];
  ingresosDia: IngresoCaja[] = [];

  cajaDia = {
    totalIngresos: 0,
    totalGastos: 0,
    totalNeto: 0,
    saldo: { efectivo: 0, cheques: 0, posnet: 0, deposito: 0 }
  };

  form = this.fb.group({
    tipoIngreso: ['VENTA', Validators.required],
    concepto: ['', Validators.required],
    monto: [0, [Validators.required, Validators.min(0.01)]],
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
  }

  onFechaChange() {
    this.refresh();
  }

  addIngreso() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    this.caja.addIngreso({
      fecha: this.fechaSeleccionada,
      tipoIngreso: String(value.tipoIngreso || this.tiposIngreso[0] || 'VENTA').toUpperCase(),
      concepto: String(value.concepto || '').trim(),
      monto: Number(value.monto || 0),
      medioPago: String(value.medioPago || 'EFECTIVO').toUpperCase(),
      observacion: String(value.observacion || '').trim(),
      comprobante: String(value.comprobante || '').trim()
    });

    this.form.reset({
      tipoIngreso: this.tiposIngreso[0] || 'VENTA',
      concepto: '',
      monto: 0,
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
    this.ingresosDia = this.caja.getIngresosByDate(this.fechaSeleccionada);
    const resumen = this.caja.getCajaDiaria(this.fechaSeleccionada);
    this.cajaDia = {
      totalIngresos: resumen.totalIngresos,
      totalGastos: resumen.totalGastos,
      totalNeto: resumen.totalNeto,
      saldo: resumen.saldo
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
}
