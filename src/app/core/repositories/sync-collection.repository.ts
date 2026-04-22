import { LoggerService } from '../services/logger.service';
import { SupabaseService } from '../services/supabase.service';

export interface SyncCollectionRepositoryOptions<T extends object> {
  storageKey: string;
  table: string;
  conflictKey: keyof T & string;
  orderBy: string;
  normalizeList: (list: T[]) => T[];
  supabase: SupabaseService;
  logger: LoggerService;
}

export class SyncCollectionRepository<T extends object> {
  constructor(private readonly options: SyncCollectionRepositoryOptions<T>) {}

  loadLocal(fallback: T[] = []): T[] {
    const safe = this.options.normalizeList(this.readStorage(fallback));
    this.writeStorage(safe);
    return safe;
  }

  save(list: T[]): T[] {
    const safe = this.options.normalizeList(list || []);
    this.writeStorage(safe);
    this.pushRemote(safe);
    return safe;
  }

  async hydrate(): Promise<T[] | null> {
    if (!this.options.supabase.isEnabled()) {
      return null;
    }

    try {
      const rows = await this.options.supabase.fetchRows<T>(this.options.table, this.options.orderBy);
      if (!rows.length) {
        return null;
      }

      const safe = this.options.normalizeList(rows);
      this.writeStorage(safe);
      return safe;
    } catch (error) {
      this.options.logger.warn(`No se pudo hidratar la tabla ${this.options.table} desde Supabase.`, error);
      return null;
    }
  }

  async clear(filter: { column: string; operator: 'neq' | 'gte'; value: string | number }): Promise<void> {
    if (this.options.supabase.isEnabled()) {
      await this.options.supabase.deleteAllRows(this.options.table, filter);
    }

    localStorage.removeItem(this.options.storageKey);
  }

  private readStorage(fallback: T[]): T[] {
    try {
      const value = localStorage.getItem(this.options.storageKey);
      if (!value) {
        return fallback;
      }

      return JSON.parse(value) as T[];
    } catch {
      return fallback;
    }
  }

  private writeStorage(value: T[]) {
    localStorage.setItem(this.options.storageKey, JSON.stringify(value));
  }

  private pushRemote(list: T[]) {
    if (!this.options.supabase.isEnabled()) {
      return;
    }

    this.options.supabase.replaceRows(this.options.table, list, this.options.conflictKey).catch(error => {
      this.options.logger.warn(`No se pudo sincronizar la tabla ${this.options.table} en Supabase.`, error);
    });
  }
}