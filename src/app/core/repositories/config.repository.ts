import { ConfiguracionCaja } from '../../shared/models/finance.model';
import { LoggerService } from '../services/logger.service';
import { SupabaseService } from '../services/supabase.service';

export interface ConfigRepositoryOptions {
  storageKey: string;
  defaultConfig: ConfiguracionCaja;
  supabase: SupabaseService;
  logger: LoggerService;
  normalizeList: (list: string[]) => string[];
}

export class ConfigRepository {
  private readonly tableMap = {
    conceptos: 'config_conceptos',
    mediosPago: 'config_medios_pago',
    tiposSalida: 'config_tipos_salida',
    tiposIngreso: 'config_tipos_ingreso'
  } as const;

  constructor(private readonly options: ConfigRepositoryOptions) {}

  loadLocal(): ConfiguracionCaja {
    const safe = this.normalizeConfig(this.readStorage());
    this.writeStorage(safe);
    return safe;
  }

  save(config: ConfiguracionCaja): ConfiguracionCaja {
    const safe = this.normalizeConfig(config);
    this.writeStorage(safe);
    this.pushRemote(safe);
    return safe;
  }

  async hydrate(current: ConfiguracionCaja): Promise<ConfiguracionCaja | null> {
    if (!this.options.supabase.isEnabled()) {
      return null;
    }

    try {
      const [conceptos, mediosPago, tiposSalida, tiposIngreso] = await Promise.all([
        this.options.supabase.fetchConfigValues(this.tableMap.conceptos),
        this.options.supabase.fetchConfigValues(this.tableMap.mediosPago),
        this.options.supabase.fetchConfigValues(this.tableMap.tiposSalida),
        this.options.supabase.fetchConfigValues(this.tableMap.tiposIngreso)
      ]);

      const next = this.normalizeConfig({
        conceptos: conceptos.length ? conceptos : current.conceptos,
        mediosPago: mediosPago.length ? mediosPago : current.mediosPago,
        tiposSalida: tiposSalida.length ? tiposSalida : current.tiposSalida,
        tiposIngreso: tiposIngreso.length ? tiposIngreso : current.tiposIngreso
      });

      this.writeStorage(next);
      return next;
    } catch (error) {
      this.options.logger.warn('No se pudo hidratar configuración desde Supabase. Se mantiene modo local.', error);
      return null;
    }
  }

  async clear(): Promise<void> {
    if (this.options.supabase.isEnabled()) {
      await Promise.all([
        this.options.supabase.deleteAllRows(this.tableMap.conceptos, { column: 'id', operator: 'neq', value: 0 }),
        this.options.supabase.deleteAllRows(this.tableMap.mediosPago, { column: 'id', operator: 'neq', value: 0 }),
        this.options.supabase.deleteAllRows(this.tableMap.tiposSalida, { column: 'id', operator: 'neq', value: 0 }),
        this.options.supabase.deleteAllRows(this.tableMap.tiposIngreso, { column: 'id', operator: 'neq', value: 0 })
      ]);
    }

    localStorage.removeItem(this.options.storageKey);
  }

  private readStorage(): ConfiguracionCaja {
    try {
      const raw = localStorage.getItem(this.options.storageKey);
      if (!raw) {
        return this.options.defaultConfig;
      }

      return JSON.parse(raw) as Partial<ConfiguracionCaja> as ConfiguracionCaja;
    } catch {
      return this.options.defaultConfig;
    }
  }

  private writeStorage(value: ConfiguracionCaja) {
    localStorage.setItem(this.options.storageKey, JSON.stringify(value));
  }

  private normalizeConfig(config: Partial<ConfiguracionCaja> | ConfiguracionCaja): ConfiguracionCaja {
    return {
      conceptos: this.options.normalizeList(config.conceptos || this.options.defaultConfig.conceptos),
      mediosPago: this.options.normalizeList(config.mediosPago || this.options.defaultConfig.mediosPago),
      tiposSalida: this.options.normalizeList(config.tiposSalida || this.options.defaultConfig.tiposSalida),
      tiposIngreso: this.options.normalizeList(config.tiposIngreso || this.options.defaultConfig.tiposIngreso)
    };
  }

  private pushRemote(config: ConfiguracionCaja) {
    if (!this.options.supabase.isEnabled()) {
      return;
    }

    Promise.all([
      this.options.supabase.replaceConfigValues(this.tableMap.conceptos, config.conceptos),
      this.options.supabase.replaceConfigValues(this.tableMap.mediosPago, config.mediosPago),
      this.options.supabase.replaceConfigValues(this.tableMap.tiposSalida, config.tiposSalida),
      this.options.supabase.replaceConfigValues(this.tableMap.tiposIngreso, config.tiposIngreso)
    ]).catch(error => {
      this.options.logger.warn('No se pudo sincronizar la configuración en Supabase.', error);
    });
  }
}