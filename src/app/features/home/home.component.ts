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
  private readonly OPEN_METEO_GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';
  private readonly OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast';
  private readonly APOSTOLES_FALLBACK = {
    name: 'Apostoles',
    countryCode: 'AR',
    latitude: -27.91421,
    longitude: -55.75355
  };

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
      const hasOpenWeatherKey = Boolean(apiKey && apiKey !== 'TU_API_KEY');
      let loaded = false;

      if (hasOpenWeatherKey) {
        loaded = await this.fetchClimaFromOpenWeather(city, apiKey, environment.openWeather?.units || 'metric', environment.openWeather?.lang || 'es');
      }

      if (!loaded) {
        loaded = await this.fetchClimaFromOpenMeteo(city);
      }

      if (!loaded) {
        throw new Error('weather_unavailable');
      }
    } catch {
      this.climaError = 'No se pudo obtener el clima actual en este momento.';
    } finally {
      this.climaLoading = false;
    }
  }

  private async fetchClimaFromOpenWeather(city: string, apiKey: string, units: string, lang: string): Promise<boolean> {
    try {
      const url = `${this.OPEN_WEATHER_BASE}?q=${encodeURIComponent(city)}&appid=${encodeURIComponent(apiKey)}&units=${encodeURIComponent(units)}&lang=${encodeURIComponent(lang)}`;
      const response = await fetch(url);
      if (!response.ok) return false;

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

      return true;
    } catch {
      return false;
    }
  }

  private async fetchClimaFromOpenMeteo(city: string): Promise<boolean> {
    try {
      const cityQuery = this.normalizeCityForGeocoding(city);
      const geoUrl = `${this.OPEN_METEO_GEOCODING}?name=${encodeURIComponent(cityQuery)}&count=1&language=es&format=json`;
      const geoResponse = await fetch(geoUrl);
      if (!geoResponse.ok) return false;

      const geoPayload = await geoResponse.json() as {
        results?: Array<{ latitude?: number; longitude?: number; name?: string; country_code?: string }>;
      };

      const result = geoPayload.results?.[0];
      const latitude = result?.latitude ?? this.APOSTOLES_FALLBACK.latitude;
      const longitude = result?.longitude ?? this.APOSTOLES_FALLBACK.longitude;
      const cityName = result?.name || this.APOSTOLES_FALLBACK.name;
      const countryCode = result?.country_code || this.APOSTOLES_FALLBACK.countryCode;

      const forecastUrl = `${this.OPEN_METEO_FORECAST}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code,is_day&timezone=auto`;
      const forecastResponse = await fetch(forecastUrl);
      if (!forecastResponse.ok) return false;

      const forecastPayload = await forecastResponse.json() as {
        current?: {
          time?: string;
          temperature_2m?: number;
          relative_humidity_2m?: number;
          apparent_temperature?: number;
          wind_speed_10m?: number;
          weather_code?: number;
          is_day?: number;
        };
      };

      const current = forecastPayload.current;
      if (!current) return false;

      this.clima = {
        ciudad: `${cityName}, ${countryCode}`,
        descripcion: this.getOpenMeteoDescription(current.weather_code),
        icono: this.getOpenMeteoIcon(current.weather_code, current.is_day),
        temp: Number(current.temperature_2m ?? 0),
        sensacion: Number(current.apparent_temperature ?? 0),
        humedad: Number(current.relative_humidity_2m ?? 0),
        viento: Number(current.wind_speed_10m ?? 0),
        actualizado: current.time ? new Date(current.time).toISOString() : new Date().toISOString()
      };

      return true;
    } catch {
      return false;
    }
  }

  private normalizeCityForGeocoding(city: string): string {
    const firstToken = String(city || 'Apostoles,AR').split(',')[0]?.trim() || 'Apostoles';
    return firstToken.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  private getOpenMeteoDescription(code?: number): string {
    switch (Number(code)) {
      case 0:
        return 'Cielo despejado';
      case 1:
      case 2:
      case 3:
        return 'Parcialmente nublado';
      case 45:
      case 48:
        return 'Niebla';
      case 51:
      case 53:
      case 55:
        return 'Llovizna';
      case 61:
      case 63:
      case 65:
        return 'Lluvia';
      case 71:
      case 73:
      case 75:
        return 'Nieve';
      case 80:
      case 81:
      case 82:
        return 'Chaparrones';
      case 95:
      case 96:
      case 99:
        return 'Tormenta';
      default:
        return 'Condiciones variables';
    }
  }

  private getOpenMeteoIcon(code?: number, isDay?: number): string {
    const day = Number(isDay ?? 1) === 1;
    const dayNight = (d: string, n: string) => (day ? d : n);

    switch (Number(code)) {
      case 0:
        return dayNight('01d', '01n');
      case 1:
        return dayNight('02d', '02n');
      case 2:
      case 3:
        return dayNight('03d', '03n');
      case 45:
      case 48:
        return dayNight('50d', '50n');
      case 51:
      case 53:
      case 55:
      case 56:
      case 57:
      case 61:
      case 63:
      case 65:
      case 66:
      case 67:
      case 80:
      case 81:
      case 82:
        return dayNight('10d', '10n');
      case 71:
      case 73:
      case 75:
      case 77:
      case 85:
      case 86:
        return dayNight('13d', '13n');
      case 95:
      case 96:
      case 99:
        return dayNight('11d', '11n');
      default:
        return dayNight('03d', '03n');
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
