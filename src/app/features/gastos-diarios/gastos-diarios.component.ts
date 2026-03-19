import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CajaService } from '../../core/services/caja.service';
import { ConfigService } from '../../core/services/config.service';
import { Gasto } from '../../shared/models/finance.model';

@Component({
  selector: 'app-gastos-diarios',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './gastos-diarios.component.html',
  styleUrls: ['./gastos-diarios.component.css']
})
export class GastosDiariosComponent implements OnInit {
  tiposEgreso: string[] = [];

  fechaSeleccionada = new Date().toISOString().slice(0, 10);
  medios: string[] = [];
  gastosDia: Gasto[] = [];

  cajaDia = {
    totalIngresos: 0,
    totalGastos: 0,
    totalNeto: 0,
    saldo: { efectivo: 0, cheques: 0, posnet: 0, deposito: 0 }
  };

  disponiblePorMedio: Record<string, number> = {};

  form = this.fb.group({
    tipoEgreso: ['GASTOS_VARIOS', Validators.required],
    descripcion: ['', Validators.required],
    monto: [0, [Validators.required, Validators.min(0.01)]],
    medioPago: ['EFECTIVO', Validators.required],
    observacion: [''],
    comprobante: ['']
  });

  constructor(private fb: FormBuilder, private caja: CajaService, private config: ConfigService) {}

  ngOnInit() {
    this.tiposEgreso = this.ensureTiposSalida(this.config.getTiposSalida());
    this.form.patchValue({ tipoEgreso: this.tiposEgreso[0] || 'GASTOS VARIOS' });

    this.medios = this.ensureEfectivoFirst(this.config.getMedios());
    this.form.patchValue({ medioPago: this.medios[0] || 'EFECTIVO' });

    this.config.tiposSalida.subscribe(values => {
      this.tiposEgreso = this.ensureTiposSalida(values);
      const selected = String(this.form.get('tipoEgreso')?.value || '').trim().toUpperCase();
      if (!this.tiposEgreso.includes(selected)) {
        this.form.patchValue({ tipoEgreso: this.tiposEgreso[0] || 'GASTOS VARIOS' });
      }
    });

    this.config.medios.subscribe(values => {
      this.medios = this.ensureEfectivoFirst(values);
      const selected = this.form.get('medioPago')?.value || '';
      if (!this.medios.includes(String(selected))) {
        this.form.patchValue({ medioPago: this.medios[0] || 'EFECTIVO' });
      }
    });

    this.refresh();

    this.caja.gastos.subscribe(() => this.refresh());
    this.caja.registros.subscribe(() => this.refresh());
    this.caja.ingresos.subscribe(() => this.refresh());

    this.form.valueChanges.subscribe(() => {
      this.syncMontoErrorByDisponibilidad();
    });
  }

  onFechaChange() {
    this.refresh();
  }

  addGasto() {
    this.syncMontoErrorByDisponibilidad();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    if (!this.tieneDisponibilidadParaEgreso()) {
      this.form.get('monto')?.setErrors({ disponibilidadInsuficiente: true });
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    this.caja.addGasto({
      fecha: this.fechaSeleccionada,
      tipoEgreso: (value.tipoEgreso as Gasto['tipoEgreso']) || 'GASTOS_VARIOS',
      descripcion: String(value.descripcion || '').trim(),
      monto: Number(value.monto || 0),
      medioPago: String(value.medioPago || 'EFECTIVO').toUpperCase(),
      observacion: String(value.observacion || '').trim(),
      comprobante: String(value.comprobante || '').trim()
    });

    this.form.reset({
      tipoEgreso: this.tiposEgreso[0] || 'GASTOS VARIOS',
      descripcion: '',
      monto: 0,
      medioPago: this.medios[0] || 'EFECTIVO',
      observacion: '',
      comprobante: ''
    });
  }

  removeGasto(id?: string) {
    if (!id) return;
    this.caja.removeGasto(id);
  }

  getTipoLabel(tipo?: string): string {
    return (tipo || 'GASTOS VARIOS').toString();
  }

  get medioSeleccionado(): string {
    return this.normalizeMedio(this.form.get('medioPago')?.value || 'EFECTIVO');
  }

  get disponibleMedioSeleccionado(): number {
    return Number(this.disponiblePorMedio[this.medioSeleccionado] || 0);
  }

  get montoSolicitado(): number {
    return Number(this.form.get('monto')?.value || 0);
  }

  get disponibleInsuficiente(): boolean {
    return this.montoSolicitado > 0 && this.montoSolicitado > this.disponibleMedioSeleccionado;
  }

  get faltanteParaEgreso(): number {
    return this.disponibleInsuficiente ? this.montoSolicitado - this.disponibleMedioSeleccionado : 0;
  }

  tieneDisponibilidadParaEgreso(): boolean {
    return this.montoSolicitado > 0 && this.montoSolicitado <= this.disponibleMedioSeleccionado;
  }

  private refresh() {
    this.gastosDia = this.caja.getGastosByDate(this.fechaSeleccionada);
    const resumen = this.caja.getCajaDiaria(this.fechaSeleccionada);
    this.cajaDia = {
      totalIngresos: resumen.totalIngresos,
      totalGastos: resumen.totalGastos,
      totalNeto: resumen.totalNeto,
      saldo: resumen.saldo
    };

    const inicio = this.caja.getInicioDiaPorMedio(this.fechaSeleccionada);
    const medios = this.collectMedios(inicio, resumen.ingresos.otros || {}, resumen.gastos.otros || {});
    const nextDisponibles: Record<string, number> = {};

    medios.forEach(medio => {
      const key = this.normalizeMedio(medio);
      const inicioMedio = Number(inicio[key] || 0);
      const ingresosMedio = this.getValueFromTotales(resumen.ingresos, key);
      const egresosMedio = this.getValueFromTotales(resumen.gastos, key);
      nextDisponibles[key] = inicioMedio + ingresosMedio - egresosMedio;
    });

    this.disponiblePorMedio = nextDisponibles;
    this.syncMontoErrorByDisponibilidad();
  }

  private syncMontoErrorByDisponibilidad() {
    const control = this.form.get('monto');
    if (!control) return;

    const current = control.errors || {};
    if (this.disponibleInsuficiente) {
      control.setErrors({ ...current, disponibilidadInsuficiente: true });
      return;
    }

    if (current['disponibilidadInsuficiente']) {
      const { disponibilidadInsuficiente, ...rest } = current;
      control.setErrors(Object.keys(rest).length ? rest : null);
    }
  }

  private collectMedios(inicio: Record<string, number>, otrosIngresos: Record<string, number>, otrosGastos: Record<string, number>): string[] {
    const base = ['EFECTIVO', 'CHEQUES', 'POSNET', 'DEPOSITO'];
    const config = (this.medios || []).map(item => this.normalizeMedio(item));
    const fromInicio = Object.keys(inicio || {}).map(item => this.normalizeMedio(item));
    const fromOtros = [...new Set([...Object.keys(otrosIngresos || {}), ...Object.keys(otrosGastos || {})])]
      .map(item => this.normalizeMedio(item));

    return [...new Set([...base, ...config, ...fromInicio, ...fromOtros])].filter(Boolean);
  }

  private getValueFromTotales(totales: { efectivo: number; cheques: number; posnet: number; deposito: number; otros?: Record<string, number> }, medio: string): number {
    if (medio === 'EFECTIVO') return Number(totales.efectivo || 0);
    if (medio === 'CHEQUES') return Number(totales.cheques || 0);
    if (medio === 'POSNET') return Number(totales.posnet || 0);
    if (medio === 'DEPOSITO') return Number(totales.deposito || 0);
    return Number((totales.otros || {})[medio] || 0);
  }

  private normalizeMedio(value: unknown): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();
  }

  private ensureEfectivoFirst(list: string[]): string[] {
    const normalized = [...new Set((list || []).map(item => String(item || '').trim().toUpperCase()).filter(Boolean))];
    if (!normalized.includes('EFECTIVO')) {
      normalized.unshift('EFECTIVO');
      return normalized;
    }

    return ['EFECTIVO', ...normalized.filter(item => item !== 'EFECTIVO')];
  }

  private ensureTiposSalida(list: string[]): string[] {
    const normalized = [...new Set((list || []).map(item => String(item || '').trim().toUpperCase()).filter(Boolean))];
    return normalized.length ? normalized : ['GASTOS VARIOS'];
  }
}
