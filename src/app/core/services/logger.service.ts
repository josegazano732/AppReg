import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LoggerService {
  log(...args: any[]) { console.log('[LOG]', ...args); }
  warn(...args: any[]) { console.warn('[WARN]', ...args); }
  error(...args: any[]) { console.error('[ERROR]', ...args); }
}
