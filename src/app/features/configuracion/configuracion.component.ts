import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfigService } from '../../core/services/config.service';

@Component({
  selector: 'app-configuracion',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './configuracion.component.html',
  styleUrls: ['./configuracion.component.css']
})
export class ConfiguracionComponent implements OnInit {
  conceptos: string[] = [];
  medios: string[] = [];
  tiposSalida: string[] = [];
  tiposIngreso: string[] = [];

  nuevoConcepto = '';
  nuevoMedio = '';
  nuevoTipoSalida = '';
  nuevoTipoIngreso = '';

  constructor(private cfg: ConfigService) {}

  ngOnInit() {
    this.conceptos = this.cfg.getConceptos();
    this.medios = this.cfg.getMedios();
    this.tiposSalida = this.cfg.getTiposSalida();
    this.tiposIngreso = this.cfg.getTiposIngreso();
    this.cfg.conceptos.subscribe(values => (this.conceptos = values));
    this.cfg.medios.subscribe(values => (this.medios = values));
    this.cfg.tiposSalida.subscribe(values => (this.tiposSalida = values));
    this.cfg.tiposIngreso.subscribe(values => (this.tiposIngreso = values));
  }

  addConcepto() {
    const v = (this.nuevoConcepto || '').trim();
    if (!v) return;
    this.cfg.addConcepto(v);
    this.nuevoConcepto = '';
  }

  removeConcepto(i: number) {
    this.cfg.removeConcepto(i);
  }

  addMedio() {
    const v = (this.nuevoMedio || '').trim();
    if (!v) return;
    this.cfg.addMedio(v);
    this.nuevoMedio = '';
  }

  removeMedio(i: number) {
    this.cfg.removeMedio(i);
  }

  addTipoSalida() {
    const v = (this.nuevoTipoSalida || '').trim();
    if (!v) return;
    this.cfg.addTipoSalida(v);
    this.nuevoTipoSalida = '';
  }

  removeTipoSalida(i: number) {
    this.cfg.removeTipoSalida(i);
  }

  addTipoIngreso() {
    const v = (this.nuevoTipoIngreso || '').trim();
    if (!v) return;
    this.cfg.addTipoIngreso(v);
    this.nuevoTipoIngreso = '';
  }

  removeTipoIngreso(i: number) {
    this.cfg.removeTipoIngreso(i);
  }
}
