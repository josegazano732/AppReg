import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfigService } from '../../core/services/config.service';

type CatalogoKey = 'conceptos' | 'medios' | 'tiposSalida' | 'tiposIngreso';

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

  editIndex: Record<CatalogoKey, number | null> = {
    conceptos: null,
    medios: null,
    tiposSalida: null,
    tiposIngreso: null
  };

  editValue: Record<CatalogoKey, string> = {
    conceptos: '',
    medios: '',
    tiposSalida: '',
    tiposIngreso: ''
  };

  editError: Record<CatalogoKey, string> = {
    conceptos: '',
    medios: '',
    tiposSalida: '',
    tiposIngreso: ''
  };

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

  startEdit(section: CatalogoKey, index: number, value: string) {
    this.editIndex[section] = index;
    this.editValue[section] = value;
    this.editError[section] = '';
  }

  cancelEdit(section: CatalogoKey) {
    this.editIndex[section] = null;
    this.editValue[section] = '';
    this.editError[section] = '';
  }

  saveEdit(section: CatalogoKey, index: number) {
    const raw = (this.editValue[section] || '').trim();
    if (!raw) {
      this.editError[section] = 'El nombre no puede estar vacio.';
      return;
    }

    const nextValue = raw.toUpperCase();
    const currentList = this.getList(section);
    const hasDuplicate = currentList.some((item, i) => i !== index && String(item || '').trim().toUpperCase() === nextValue);
    if (hasDuplicate) {
      this.editError[section] = 'Ya existe un valor con ese nombre.';
      return;
    }

    const nextList = [...currentList];
    nextList[index] = nextValue;
    this.updateSection(section, nextList);
    this.cancelEdit(section);
  }

  private getList(section: CatalogoKey): string[] {
    if (section === 'conceptos') return this.conceptos;
    if (section === 'medios') return this.medios;
    if (section === 'tiposSalida') return this.tiposSalida;
    return this.tiposIngreso;
  }

  private updateSection(section: CatalogoKey, list: string[]) {
    if (section === 'conceptos') {
      this.cfg.updateConceptos(list);
      return;
    }
    if (section === 'medios') {
      this.cfg.updateMedios(list);
      return;
    }
    if (section === 'tiposSalida') {
      this.cfg.updateTiposSalida(list);
      return;
    }
    this.cfg.updateTiposIngreso(list);
  }
}
