import { Component, OnDestroy, OnInit } from '@angular/core';
import { CajaService } from '../../core/services/caja.service';
import { ConfigService } from '../../core/services/config.service';
import { CierreCaja, Registro, TotalesMedioPago } from '../../shared/models/finance.model';
import { environment } from '../../../environments/environment';

interface DisponibilidadMedio {
  medio: string;
  inicio: number;
  ingresos: number;
  egresos: number;
  movimientoNeto: number;
  disponible: number;
}

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly DOLAR_API_BNA = 'https://dolarapi.com/v1/dolares/bna';
  private readonly DOLAR_API_OFICIAL = 'https://dolarapi.com/v1/dolares/oficial';
  private readonly OPEN_WEATHER_BASE = 'https://api.openweathermap.org/data/2.5/weather';

  cantidadRegistros = 0;
  totalDia = 0;
  conceptos = 0;
  medios = 0;
  ultimoRegistro: Registro | null = null;
  now = new Date();

  inicioPorMedio: Array<{ medio: string; monto: number }> = [];
  disponibilidadPorMedio: DisponibilidadMedio[] = [];
  inicioTotal = 0;
  netoOperativoTotal = 0;
  disponibleOperativoTotal = 0;
  cierreReferenciaId = '';
  cierreReferenciaFecha = '';
  cierreReferenciaCreadoAt = '';
  cierreReferenciaDisponible = 0;

  dolarBna = {
    compra: null as number | null,
    venta: null as number | null,
    fecha: '',
    fuente: 'Banco Nacion'
  };
  dolarLoading = false;
  dolarError = '';

  climaLoading = false;
  climaError = '';
  clima = {
    ciudad: 'Apostoles, AR',
    descripcion: '',
    icono: '',
    temp: null as number | null,
    sensacion: null as number | null,
    humedad: null as number | null,
    viento: null as number | null,
    actualizado: ''
  };

  private clockTimerId?: number;
  private dolarRefreshTimerId?: number;
  private climaRefreshTimerId?: number;

  constructor(private caja: CajaService, private cfg: ConfigService) {}

  ngOnInit() {
    this.conceptos = this.cfg.getConceptos().length;
    this.medios = this.cfg.getMedios().length;
    this.refreshInicioCaja();
    this.fetchDolarBna();
    this.fetchClimaActual();

    this.clockTimerId = window.setInterval(() => {
      this.now = new Date();
    }, 1000);

    this.dolarRefreshTimerId = window.setInterval(() => {
      this.fetchDolarBna();
    }, 5 * 60 * 1000);

    this.climaRefreshTimerId = window.setInterval(() => {
      this.fetchClimaActual();
    }, 10 * 60 * 1000);

    this.cfg.medios.subscribe(() => this.refreshInicioCaja());
    this.caja.cierres.subscribe(() => this.refreshInicioCaja());
    this.caja.ingresos.subscribe(() => this.refreshInicioCaja());
    this.caja.gastos.subscribe(() => this.refreshInicioCaja());

    this.caja.registros.subscribe(items => {
      this.cantidadRegistros = items.length;
      this.totalDia = items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
      this.ultimoRegistro = items.length ? items[items.length - 1] : null;
      this.refreshInicioCaja();
    });
  }

  ngOnDestroy() {
    if (this.clockTimerId) {
      window.clearInterval(this.clockTimerId);
    }
    if (this.dolarRefreshTimerId) {
      window.clearInterval(this.dolarRefreshTimerId);
    }
    if (this.climaRefreshTimerId) {
      window.clearInterval(this.climaRefreshTimerId);
    }
  }

  async fetchDolarBna() {
    this.dolarLoading = true;
    this.dolarError = '';

    try {
      let payload = await this.fetchDolarFromEndpoint(this.DOLAR_API_BNA);
      let fuente = 'Banco Nacion';

      if (!payload) {
        payload = await this.fetchDolarFromEndpoint(this.DOLAR_API_OFICIAL);
        fuente = 'Oficial';
      }

      if (!payload) {
        throw new Error('Sin datos de dolarapi');
      }

      this.dolarBna = {
        compra: Number(payload.compra || 0),
        venta: Number(payload.venta || 0),
        fecha: payload.fechaActualizacion || new Date().toISOString(),
        fuente
      };
    } catch {
      this.dolarError = 'No se pudo actualizar la cotizacion desde dolarapi.com en este momento.';
    } finally {
      this.dolarLoading = false;
    }
  }

  async fetchClimaActual() {
    this.climaLoading = true;
    this.climaError = '';

    try {
      const apiKey = environment.openWeather?.apiKey || '';
      const city = environment.openWeather?.city || 'Apostoles,AR';
      const units = environment.openWeather?.units || 'metric';
      const lang = environment.openWeather?.lang || 'es';

      if (!apiKey || apiKey === 'TU_API_KEY') {
        throw new Error('api_key_missing');
      }

      const url = `${this.OPEN_WEATHER_BASE}?q=${encodeURIComponent(city)}&appid=${encodeURIComponent(apiKey)}&units=${encodeURIComponent(units)}&lang=${encodeURIComponent(lang)}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`weather_http_${response.status}`);
      }

      const payload = await response.json() as {
        name?: string;
        weather?: Array<{ description?: string; icon?: string }>;
        main?: { temp?: number; feels_like?: number; humidity?: number };
        wind?: { speed?: number };
        dt?: number;
      };

      this.clima = {
        ciudad: `${payload.name || 'Apostoles'}, AR`,
        descripcion: payload.weather?.[0]?.description || '-',
        icono: payload.weather?.[0]?.icon || '',
        temp: Number(payload.main?.temp ?? 0),
        sensacion: Number(payload.main?.feels_like ?? 0),
        humedad: Number(payload.main?.humidity ?? 0),
        viento: Number(payload.wind?.speed ?? 0),
        actualizado: payload.dt ? new Date(payload.dt * 1000).toISOString() : new Date().toISOString()
      };
    } catch (error) {
      if ((error as Error)?.message === 'api_key_missing') {
        this.climaError = 'Configura tu API key de OpenWeather en environments para ver el clima.';
      } else {
        this.climaError = 'No se pudo obtener el clima actual desde OpenWeather.';
      }
    } finally {
      this.climaLoading = false;
    }
  }

  private async fetchDolarFromEndpoint(url: string): Promise<{ compra?: number; venta?: number; fechaActualizacion?: string } | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const payload = await response.json() as { compra?: number; venta?: number; fechaActualizacion?: string };
      return payload;
    } catch {
      return null;
    }
  }

  private refreshInicioCaja() {
    const fechaOperativa = this.caja.getTodayDateKey();
    const inicio = this.caja.getInicioOperativoPorMedio(fechaOperativa);
    const cierreReferencia: CierreCaja | null = this.caja.getCierreBaseOperativa(fechaOperativa);
    const cajaDia = this.caja.getCajaPendienteParaCierre(fechaOperativa);
    const mediosConfig = this.cfg.getMedios();
    const mediosBase = ['EFECTIVO', 'CHEQUES', 'POSNET', 'DEPOSITO'];
    const mediosDetectados = Object.keys(inicio || {}).filter(Boolean);
    const medios = [...new Set([...mediosConfig, ...mediosBase, ...mediosDetectados])]
      .map(m => this.normalizeMedio(m))
      .filter(Boolean);

    const items = medios.map(medio => ({ medio, monto: Number(inicio[medio] || 0) }));

    this.inicioPorMedio = items;
    this.inicioTotal = items.reduce((sum, item) => sum + Number(item.monto || 0), 0);
    this.cierreReferenciaId = cierreReferencia?.id || '';
    this.cierreReferenciaFecha = cierreReferencia?.fecha || '';
    this.cierreReferenciaCreadoAt = cierreReferencia?.createdAt || '';
    this.cierreReferenciaDisponible = Number(cierreReferencia?.disponibleContinuidad || 0);
    this.disponibilidadPorMedio = this.buildDisponibilidadPorMedio(inicio, cajaDia.ingresos, cajaDia.gastos, medios);
    this.netoOperativoTotal = this.disponibilidadPorMedio.reduce((sum, item) => sum + Number(item.movimientoNeto || 0), 0);
    this.disponibleOperativoTotal = this.disponibilidadPorMedio.reduce((sum, item) => sum + Number(item.disponible || 0), 0);
  }

  private buildDisponibilidadPorMedio(
    inicioPorMedio: Record<string, number>,
    ingresos: TotalesMedioPago,
    egresos: TotalesMedioPago,
    medios: string[]
  ): DisponibilidadMedio[] {
    return medios.map(medio => {
      const key = this.normalizeMedio(medio);
      const inicio = Number(inicioPorMedio[key] || 0);
      const ingresosMedio = this.getValueFromTotales(ingresos, key);
      const egresosMedio = this.getValueFromTotales(egresos, key);
      const movimientoNeto = ingresosMedio - egresosMedio;

      return {
        medio: key,
        inicio,
        ingresos: ingresosMedio,
        egresos: egresosMedio,
        movimientoNeto,
        disponible: inicio + movimientoNeto
      };
    });
  }

  private getValueFromTotales(totales: TotalesMedioPago, medio: string): number {
    if (medio === 'EFECTIVO') return Number(totales.efectivo || 0);
    if (medio === 'CHEQUES') return Number(totales.cheques || 0);
    if (medio === 'POSNET') return Number(totales.posnet || 0);
    if (medio === 'DEPOSITO') return Number(totales.deposito || 0);
    return Number((totales.otros || {})[medio] || 0);
  }

  private normalizeMedio(value?: string): string {
    return (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();
  }
}
