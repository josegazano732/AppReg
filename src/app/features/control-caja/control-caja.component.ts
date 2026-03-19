import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { CajaService } from '../../core/services/caja.service';

@Component({
  selector: 'app-control-caja',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './control-caja.component.html',
  styleUrls: ['./control-caja.component.css']
})
export class ControlCajaComponent implements OnInit {
  private readonly denominacionesIniciales = [20000, 10000, 2000, 1000, 500, 100, 50, 20, 10, 5];
  billetes = this.denominacionesIniciales.map(v => ({ valor: v, cantidad: 0, subtotal: 0 }));
  total = 0;
  totalEfectivoRegistrado = 0;
  inicioEfectivoDia = 0;
  ingresosEfectivoDia = 0;
  gastosEfectivoDia = 0;
  fechaSeleccionada = new Date().toISOString().slice(0, 10);
  nuevoBilleteValor: number | null = null;

  constructor(private caja: CajaService) {}

  ngOnInit() {
    const saved = this.caja.getBilletesSnapshot();
    this.billetes = this.buildBilletesWithDefaults(saved);

    this.refreshArqueo();
    this.caja.registros.subscribe(() => this.refreshArqueo());
    this.caja.ingresos.subscribe(() => this.refreshArqueo());
    this.caja.gastos.subscribe(() => this.refreshArqueo());
    this.caja.cierres.subscribe(() => this.refreshArqueo());

    this.recalc();
    this.caja.updateBilletes(this.billetes);
  }

  onFechaChange() {
    this.refreshArqueo();
  }

  update(i: number) {
    const b = this.billetes[i];
    b.subtotal = b.valor * (b.cantidad || 0);
    this.recalc();
    this.caja.updateBilletes(this.billetes);
  }

  recalc() {
    this.total = this.billetes.reduce((s, b) => s + b.subtotal, 0);
  }

  addBilleteManual() {
    const valor = Number(this.nuevoBilleteValor || 0);
    if (!Number.isFinite(valor) || valor <= 0) {
      return;
    }

    const existente = this.billetes.find(item => item.valor === valor);
    if (existente) {
      this.nuevoBilleteValor = null;
      return;
    }

    this.billetes.push({ valor, cantidad: 0, subtotal: 0 });
    this.billetes.sort((a, b) => b.valor - a.valor);
    this.caja.updateBilletes(this.billetes);
    this.nuevoBilleteValor = null;
  }

  removeBillete(index: number) {
    this.billetes.splice(index, 1);
    this.recalc();
    this.caja.updateBilletes(this.billetes);
  }

  private refreshArqueo() {
    const inicioPorMedio = this.caja.getInicioDiaPorMedio(this.fechaSeleccionada);
    const cajaPendiente = this.caja.getCajaPendienteParaCierre(this.fechaSeleccionada);

    this.inicioEfectivoDia = Number(inicioPorMedio.EFECTIVO || 0);
    this.ingresosEfectivoDia = Number(cajaPendiente.ingresos.efectivo || 0);
    this.gastosEfectivoDia = Number(cajaPendiente.gastos.efectivo || 0);
    this.totalEfectivoRegistrado = this.inicioEfectivoDia + Number(cajaPendiente.saldo.efectivo || 0);
  }

  private buildBilletesWithDefaults(saved: Array<{ valor: number; cantidad: number; subtotal: number }>) {
    const normalizedSaved = (saved || [])
      .map(item => ({
        valor: Number(item.valor || 0),
        cantidad: Number(item.cantidad || 0),
        subtotal: Number(item.valor || 0) * Number(item.cantidad || 0)
      }))
      .filter(item => item.valor > 0);

    const defaultRows = this.denominacionesIniciales.map(valor => {
      const existing = normalizedSaved.find(item => item.valor === valor);
      return {
        valor,
        cantidad: existing?.cantidad || 0,
        subtotal: valor * Number(existing?.cantidad || 0)
      };
    });

    const extras = normalizedSaved.filter(
      item => !this.denominacionesIniciales.includes(item.valor)
    );

    return [...defaultRows, ...extras].sort((a, b) => b.valor - a.valor);
  }

  get diferenciaArqueo(): number {
    return this.total - Number(this.totalEfectivoRegistrado || 0);
  }
}
