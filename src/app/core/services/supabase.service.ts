import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private readonly url = environment.supabase?.url || '';
  private readonly anonKey = environment.supabase?.anonKey || '';
  private readonly enabled = Boolean(this.url && this.anonKey && !this.anonKey.includes('TU_'));

  private readonly client: SupabaseClient | null = this.enabled
    ? createClient(this.url, this.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })
    : null;

  isEnabled(): boolean {
    return this.enabled;
  }

  async fetchRows<T>(table: string, orderBy = 'createdAt'): Promise<T[]> {
    if (!this.client) return [];

    const { data, error } = await this.client
      .from(table)
      .select('*')
      .order(orderBy, { ascending: true });

    if (error) {
      throw error;
    }

    return (data || []) as T[];
  }

  async upsertRows<T extends object>(table: string, rows: T[], onConflict?: string): Promise<void> {
    if (!this.client) return;

    if (!rows.length) {
      // No hacemos truncado remoto para evitar pérdidas de datos por error de red.
      return;
    }

    const { error } = await this.client.from(table).upsert(rows as any, onConflict ? { onConflict } : undefined);

    if (error) {
      throw error;
    }
  }

  async replaceRows<T extends Record<string, any>>(
    table: string,
    rows: T[],
    keyField: keyof T & string,
    onConflict?: string
  ): Promise<void> {
    if (!this.client) return;

    const { data: existingRows, error: fetchError } = await this.client
      .from(table)
      .select(keyField);

    if (fetchError) {
      throw fetchError;
    }

    const existingKeyMap = new Map<string, unknown>();
    (existingRows || [])
      .map(row => (row as Record<string, unknown> | null | undefined)?.[keyField])
      .filter(value => value !== null && value !== undefined)
      .forEach(value => {
        existingKeyMap.set(String(value), value);
      });

    const nextRows = (rows || []).filter(row => row?.[keyField] !== null && row?.[keyField] !== undefined);
    const nextKeys = new Set(nextRows.map(row => String(row[keyField])));
    const keysToDelete = [...existingKeyMap.entries()]
      .filter(([serializedKey]) => !nextKeys.has(serializedKey))
      .map(([, originalValue]) => originalValue);

    if (nextRows.length) {
      const { error: upsertError } = await this.client
        .from(table)
        .upsert(nextRows as any, onConflict ? { onConflict } : { onConflict: keyField });

      if (upsertError) {
        throw upsertError;
      }
    }

    if (keysToDelete.length) {
      const { error: deleteError } = await this.client
        .from(table)
        .delete()
        .in(keyField, keysToDelete as any);

      if (deleteError) {
        throw deleteError;
      }
    }
  }

  async deleteAllRows(
    table: string,
    filter: { column: string; operator: 'neq' | 'gte'; value: string | number }
  ): Promise<void> {
    if (!this.client) return;

    let query = this.client.from(table).delete();

    if (filter.operator === 'neq') {
      query = query.neq(filter.column, filter.value);
    } else {
      query = query.gte(filter.column, filter.value);
    }

    const { error } = await query;

    if (error) {
      throw error;
    }
  }

  async fetchConfigValues(table: string): Promise<string[]> {
    if (!this.client) return [];

    const { data, error } = await this.client
      .from(table)
      .select('nombre, activo')
      .eq('activo', true)
      .order('nombre', { ascending: true });

    if (error) {
      throw error;
    }

    return (data || [])
      .map(item => String((item as { nombre?: string }).nombre || '').trim().toUpperCase())
      .filter(Boolean);
  }

  async replaceConfigValues(table: string, values: string[]): Promise<void> {
    if (!this.client) return;

    const { error: deleteError } = await this.client.from(table).delete().neq('id', 0);
    if (deleteError) {
      throw deleteError;
    }

    const rows = (values || []).map(nombre => ({ nombre, activo: true }));
    if (!rows.length) {
      return;
    }

    const { error: insertError } = await this.client.from(table).insert(rows as any);
    if (insertError) {
      throw insertError;
    }
  }
}
