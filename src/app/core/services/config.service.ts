import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ConfiguracionCaja } from '../../shared/models/finance.model';
import { SupabaseService } from './supabase.service';
import { LoggerService } from './logger.service';

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly STORAGE_KEY = 'appreg.configuracion';
  private readonly TABLE_CONCEPTOS = 'config_conceptos';
  private readonly TABLE_MEDIOS = 'config_medios_pago';
  private readonly TABLE_TIPOS_SALIDA = 'config_tipos_salida';
  private readonly TABLE_TIPOS_INGRESO = 'config_tipos_ingreso';
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

  constructor(private supabase: SupabaseService, private logger: LoggerService) {
    const config = this.loadConfig();
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
    this.pushRemote(this.TABLE_CONCEPTOS, next);
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
    this.pushRemote(this.TABLE_MEDIOS, next);
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
    this.pushRemote(this.TABLE_TIPOS_SALIDA, next);
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
    this.pushRemote(this.TABLE_TIPOS_INGRESO, next);
  }

  removeTipoIngreso(index: number) {
    const next = this.getTiposIngreso().filter((_, i) => i !== index);
    this.updateTiposIngreso(next);
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

  private loadConfig(): ConfiguracionCaja {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return this.defaultConfig;
      const parsed = JSON.parse(raw) as Partial<ConfiguracionCaja>;
      return {
        conceptos: this.normalizeList(parsed.conceptos || this.defaultConfig.conceptos),
        mediosPago: this.normalizeList(parsed.mediosPago || this.defaultConfig.mediosPago),
        tiposSalida: this.normalizeList(parsed.tiposSalida || this.defaultConfig.tiposSalida),
        tiposIngreso: this.normalizeList(parsed.tiposIngreso || this.defaultConfig.tiposIngreso)
      };
    } catch {
      return this.defaultConfig;
    }
  }

  private persist() {
    const payload: ConfiguracionCaja = {
      conceptos: this.getConceptos(),
      mediosPago: this.getMedios(),
      tiposSalida: this.getTiposSalida(),
      tiposIngreso: this.getTiposIngreso()
    };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(payload));
  }

  private async hydrateFromSupabase() {
    if (!this.supabase.isEnabled()) {
      return;
    }

    try {
      const [conceptos, medios, tiposSalida, tiposIngreso] = await Promise.all([
        this.supabase.fetchConfigValues(this.TABLE_CONCEPTOS),
        this.supabase.fetchConfigValues(this.TABLE_MEDIOS),
        this.supabase.fetchConfigValues(this.TABLE_TIPOS_SALIDA),
        this.supabase.fetchConfigValues(this.TABLE_TIPOS_INGRESO)
      ]);

      const next: ConfiguracionCaja = {
        conceptos: conceptos.length ? this.normalizeList(conceptos) : this.getConceptos(),
        mediosPago: medios.length ? this.normalizeList(medios) : this.getMedios(),
        tiposSalida: tiposSalida.length ? this.normalizeList(tiposSalida) : this.getTiposSalida(),
        tiposIngreso: tiposIngreso.length ? this.normalizeList(tiposIngreso) : this.getTiposIngreso()
      };

      this.conceptos$.next(next.conceptos);
      this.medios$.next(next.mediosPago);
      this.tiposSalida$.next(next.tiposSalida);
      this.tiposIngreso$.next(next.tiposIngreso);
      this.persist();
    } catch (error) {
      this.logger.warn('No se pudo hidratar configuración desde Supabase. Se mantiene modo local.', error);
    }
  }

  private pushRemote(table: string, values: string[]) {
    if (!this.supabase.isEnabled()) {
      return;
    }

    this.supabase.replaceConfigValues(table, values).catch(error => {
      this.logger.warn(`No se pudo sincronizar configuración en ${table}.`, error);
    });
  }
}
