import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ConfiguracionCaja } from '../../shared/models/finance.model';
import { ConfigRepository } from '../repositories/config.repository';
import { SupabaseService } from './supabase.service';
import { LoggerService } from './logger.service';

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly STORAGE_KEY = 'appreg.configuracion';
  private readonly defaultConfig: ConfiguracionCaja = {
    conceptos: ['SELLADOS', 'MUNI', 'SUGIT', 'PATENTE', 'ANT. PENALES'],
    mediosPago: ['EFECTIVO', 'CHEQUES', 'POSNET', 'VEP', 'SITE', 'DEPOSITO'],
    tiposSalida: ['RETIRO DE EFECTIVO', 'DEPOSITO BANCARIO', 'GASTOS VARIOS'],
    tiposIngreso: ['VENTA', 'INGRESO EXTRA', 'AJUSTE DE CAJA']
  };

  private conceptos$ = new BehaviorSubject<string[]>([]);
  conceptos = this.conceptos$.asObservable();

  private medios$ = new BehaviorSubject<string[]>([]);
  medios = this.medios$.asObservable();

  private tiposSalida$ = new BehaviorSubject<string[]>([]);
  tiposSalida = this.tiposSalida$.asObservable();

  private tiposIngreso$ = new BehaviorSubject<string[]>([]);
  tiposIngreso = this.tiposIngreso$.asObservable();

  private readonly repository: ConfigRepository;

  constructor(private supabase: SupabaseService, private logger: LoggerService) {
    this.repository = new ConfigRepository({
      storageKey: this.STORAGE_KEY,
      defaultConfig: this.defaultConfig,
      supabase: this.supabase,
      logger: this.logger,
      normalizeList: list => this.normalizeList(list)
    });

    const config = this.repository.loadLocal();
    this.conceptos$.next(config.conceptos);
    this.medios$.next(config.mediosPago);
    this.tiposSalida$.next(config.tiposSalida);
    this.tiposIngreso$.next(config.tiposIngreso);

    this.hydrateFromSupabase();
  }

  getConceptos(): string[] { return this.conceptos$.getValue(); }
  addConcepto(c: string) {
    const value = this.normalize(c);
    if (!value) return;
    const next = this.uniquePush(this.getConceptos(), value);
    this.updateConceptos(next);
  }

  updateConceptos(list: string[]) {
    const next = this.normalizeList(list);
    this.conceptos$.next(next);
    this.persist();
  }

  removeConcepto(index: number) {
    const next = this.getConceptos().filter((_, i) => i !== index);
    this.updateConceptos(next);
  }

  getMedios(): string[] { return this.medios$.getValue(); }
  addMedio(m: string) {
    const value = this.normalize(m);
    if (!value) return;
    const next = this.uniquePush(this.getMedios(), value);
    this.updateMedios(next);
  }

  updateMedios(list: string[]) {
    const next = this.normalizeList(list);
    this.medios$.next(next);
    this.persist();
  }

  removeMedio(index: number) {
    const next = this.getMedios().filter((_, i) => i !== index);
    this.updateMedios(next);
  }

  getTiposSalida(): string[] { return this.tiposSalida$.getValue(); }
  addTipoSalida(value: string) {
    const normalized = this.normalize(value);
    if (!normalized) return;
    const next = this.uniquePush(this.getTiposSalida(), normalized);
    this.updateTiposSalida(next);
  }

  updateTiposSalida(list: string[]) {
    const next = this.normalizeList(list);
    this.tiposSalida$.next(next);
    this.persist();
  }

  removeTipoSalida(index: number) {
    const next = this.getTiposSalida().filter((_, i) => i !== index);
    this.updateTiposSalida(next);
  }

  getTiposIngreso(): string[] { return this.tiposIngreso$.getValue(); }
  addTipoIngreso(value: string) {
    const normalized = this.normalize(value);
    if (!normalized) return;
    const next = this.uniquePush(this.getTiposIngreso(), normalized);
    this.updateTiposIngreso(next);
  }

  updateTiposIngreso(list: string[]) {
    const next = this.normalizeList(list);
    this.tiposIngreso$.next(next);
    this.persist();
  }

  removeTipoIngreso(index: number) {
    const next = this.getTiposIngreso().filter((_, i) => i !== index);
    this.updateTiposIngreso(next);
  }

  async clearAllData() {
    await this.repository.clear();
    this.conceptos$.next([...this.defaultConfig.conceptos]);
    this.medios$.next([...this.defaultConfig.mediosPago]);
    this.tiposSalida$.next([...this.defaultConfig.tiposSalida]);
    this.tiposIngreso$.next([...this.defaultConfig.tiposIngreso]);
  }

  private normalize(value: string): string {
    return (value || '').trim().toUpperCase();
  }

  private normalizeList(list: string[]): string[] {
    return [...new Set((list || []).map(v => this.normalize(v)).filter(Boolean))];
  }

  private uniquePush(list: string[], value: string): string[] {
    const normalized = this.normalizeList(list);
    return normalized.includes(value) ? normalized : [...normalized, value];
  }

  private persist() {
    const payload = this.repository.save({
      conceptos: this.getConceptos(),
      mediosPago: this.getMedios(),
      tiposSalida: this.getTiposSalida(),
      tiposIngreso: this.getTiposIngreso()
    });

    this.conceptos$.next(payload.conceptos);
    this.medios$.next(payload.mediosPago);
    this.tiposSalida$.next(payload.tiposSalida);
    this.tiposIngreso$.next(payload.tiposIngreso);
  }

  private async hydrateFromSupabase() {
    const next = await this.repository.hydrate({
      conceptos: this.getConceptos(),
      mediosPago: this.getMedios(),
      tiposSalida: this.getTiposSalida(),
      tiposIngreso: this.getTiposIngreso()
    });

    if (!next) {
      return;
    }

    this.conceptos$.next(next.conceptos);
    this.medios$.next(next.mediosPago);
    this.tiposSalida$.next(next.tiposSalida);
    this.tiposIngreso$.next(next.tiposIngreso);
  }
}
