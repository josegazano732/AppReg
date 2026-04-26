import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CajaService } from '../../core/services/caja.service';
import { ConciliacionBancariaService } from '../../core/services/conciliacion-bancaria.service';
import { ConfigService } from '../../core/services/config.service';
import { MovimientoBancario, Registro, RegistroConceptoDetalle, RegistroPagoDetalle } from '../../shared/models/finance.model';

type CatalogoKey = 'conceptos' | 'medios' | 'tiposSalida' | 'tiposIngreso';

@Component({
  selector: 'app-configuracion',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './configuracion.component.html',
  styleUrls: ['./configuracion.component.css']
})
export class ConfiguracionComponent implements OnInit {
  private readonly DEMO_CONCILIACION_PREFIX = 'DEMO-CONCILIACION';

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

  borrandoDatos = false;
  borradoMensaje = '';
  borradoError = '';
  limpiandoEscenarioTemporal = false;
  limpiezaEscenarioMensaje = '';
  limpiezaEscenarioError = '';
  cargandoDemoConciliacion = false;
  limpiandoDemoConciliacion = false;
  demoConciliacionMensaje = '';
  demoConciliacionError = '';

  constructor(
    private cfg: ConfigService,
    private caja: CajaService,
    private conciliacion: ConciliacionBancariaService,
    private router: Router
  ) {}

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

  async borrarTodo() {
    if (this.borrandoDatos) {
      return;
    }

    const confirmacionInicial = window.confirm('Esto borrara todos los datos operativos remotos y locales de la aplicacion, pero conservara la Configuracion del sistema. Queres continuar?');
    if (!confirmacionInicial) {
      return;
    }

    const confirmacionFinal = window.confirm('Confirmacion final: se eliminaran registros, ingresos, gastos, cierres, billetes y conciliacion bancaria. La Configuracion del sistema se conserva. Esta accion es irreversible.');
    if (!confirmacionFinal) {
      return;
    }

    this.borrandoDatos = true;
    this.borradoMensaje = '';
    this.borradoError = '';

    try {
      await this.caja.clearAllData();
      await this.conciliacion.clearAllData();
      this.borradoMensaje = 'Datos operativos eliminados. La Configuracion del sistema se mantuvo. Se recomienda recargar la app.';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo completar el borrado.';
      this.borradoError = message;
    } finally {
      this.borrandoDatos = false;
    }
  }

  async limpiarEscenarioTemporal() {
    if (this.limpiandoEscenarioTemporal) {
      return;
    }

    const fecha = this.caja.getTodayDateKey();
    const scenarioPrefix = `QA-${fecha.replace(/-/g, '')}`;
    const confirmacion = window.confirm(`Se eliminara el escenario temporal ${scenarioPrefix} de registros, ingresos, gastos y cierres. Queres continuar?`);
    if (!confirmacion) {
      return;
    }

    this.limpiandoEscenarioTemporal = true;
    this.limpiezaEscenarioMensaje = '';
    this.limpiezaEscenarioError = '';

    try {
      const removed = await this.caja.clearTemporaryScenarioData(scenarioPrefix);
      const total = removed.registros + removed.ingresos + removed.gastos + removed.cierres;
      this.limpiezaEscenarioMensaje = total
        ? `Escenario ${scenarioPrefix} eliminado. Registros: ${removed.registros}, ingresos: ${removed.ingresos}, gastos: ${removed.gastos}, cierres: ${removed.cierres}.`
        : `No se encontraron datos del escenario ${scenarioPrefix} para eliminar.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo limpiar el escenario temporal.';
      this.limpiezaEscenarioError = message;
    } finally {
      this.limpiandoEscenarioTemporal = false;
    }
  }

  async cargarDemoConciliacion() {
    if (this.cargandoDemoConciliacion) {
      return;
    }

    const fecha = this.caja.getTodayDateKey();
    const prefix = this.buildDemoConciliacionPrefix(fecha);
    const confirmacion = window.confirm('Se cargara un escenario demo visible de conciliacion bancaria para hoy. Reemplaza la demo anterior del dia y luego abrira la pantalla de conciliacion. Queres continuar?');
    if (!confirmacion) {
      return;
    }

    this.cargandoDemoConciliacion = true;
    this.demoConciliacionMensaje = '';
    this.demoConciliacionError = '';

    try {
      const registrosActuales = this.caja.getRegistrosSnapshot();
      const movimientosActuales = this.conciliacion.getMovimientosSnapshot();
      const registrosSinDemo = registrosActuales.filter(item => !this.matchesScenarioPrefix(item.id, prefix));
      const movimientosSinDemo = movimientosActuales.filter(item => !this.matchesScenarioPrefix(item.id, prefix));

      const demoRegistros = this.buildDemoConciliacionRegistros(fecha, prefix);
      const demoMovimientos = this.buildDemoConciliacionMovimientos(fecha, prefix);

      this.caja.updateRegistros([...registrosSinDemo, ...demoRegistros]);
      this.conciliacion.updateMovimientos([...movimientosSinDemo, ...demoMovimientos]);
      this.conciliacion.conciliarAutomaticamente();

      this.demoConciliacionMensaje = 'Demo de conciliacion cargada. Se generaron 5 registros y 7 movimientos bancarios visibles para revisar en pantalla.';
      await this.router.navigate(['/conciliacion-bancaria']);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo cargar la demo visible de conciliacion.';
      this.demoConciliacionError = message;
    } finally {
      this.cargandoDemoConciliacion = false;
    }
  }

  limpiarDemoConciliacion() {
    if (this.limpiandoDemoConciliacion) {
      return;
    }

    const fecha = this.caja.getTodayDateKey();
    const prefix = this.buildDemoConciliacionPrefix(fecha);
    const confirmacion = window.confirm(`Se eliminara la demo visible ${prefix} de registros y movimientos bancarios. Queres continuar?`);
    if (!confirmacion) {
      return;
    }

    this.limpiandoDemoConciliacion = true;
    this.demoConciliacionMensaje = '';
    this.demoConciliacionError = '';

    try {
      const registrosActuales = this.caja.getRegistrosSnapshot();
      const movimientosActuales = this.conciliacion.getMovimientosSnapshot();
      const registrosSinDemo = registrosActuales.filter(item => !this.matchesScenarioPrefix(item.id, prefix));
      const movimientosSinDemo = movimientosActuales.filter(item => !this.matchesScenarioPrefix(item.id, prefix));
      const registrosRemovidos = registrosActuales.length - registrosSinDemo.length;
      const movimientosRemovidos = movimientosActuales.length - movimientosSinDemo.length;

      this.caja.updateRegistros(registrosSinDemo);
      this.conciliacion.updateMovimientos(movimientosSinDemo);
      this.conciliacion.conciliarAutomaticamente();

      this.demoConciliacionMensaje = registrosRemovidos || movimientosRemovidos
        ? `Demo visible eliminada. Registros: ${registrosRemovidos}, movimientos bancarios: ${movimientosRemovidos}.`
        : `No se encontro una demo visible ${prefix} para eliminar.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo limpiar la demo visible de conciliacion.';
      this.demoConciliacionError = message;
    } finally {
      this.limpiandoDemoConciliacion = false;
    }
  }

  private getList(section: CatalogoKey): string[] {
    if (section === 'conceptos') return this.conceptos;
    if (section === 'medios') return this.medios;
    if (section === 'tiposSalida') return this.tiposSalida;
    return this.tiposIngreso;
  }

  private buildDemoConciliacionPrefix(fecha: string): string {
    return `${this.DEMO_CONCILIACION_PREFIX}-${String(fecha || '').replace(/-/g, '')}`;
  }

  private buildDemoConciliacionRegistros(fecha: string, prefix: string): Registro[] {
    return [
      this.buildDemoRegistro({
        id: `${prefix}-REG-AUTO`,
        fecha,
        nroRecibo: `${prefix}-001`,
        nombre: 'Cliente demo match exacto',
        observacion: 'Demo visible de conciliacion: match exacto',
        conceptosDetalle: [
          { concepto: 'SELLADOS', monto: 18000 },
          { concepto: 'MUNI', monto: 14500 }
        ],
        pagosDetalle: [
          { medioPago: 'EFECTIVO', monto: 7500 },
          { medioPago: 'TRANSFERENCIA', monto: 25000, nroOperacion: `${prefix}-AUTO` }
        ],
        hour: 9,
        minute: 10
      }),
      this.buildDemoRegistro({
        id: `${prefix}-REG-DUP-1`,
        fecha,
        nroRecibo: `${prefix}-002`,
        nombre: 'Cliente demo duplicado A',
        observacion: 'Demo visible de conciliacion: candidato duplicado A',
        conceptosDetalle: [
          { concepto: 'PATENTE', monto: 9000 },
          { concepto: 'SUGIT', monto: 9500 }
        ],
        pagosDetalle: [
          { medioPago: 'TRANSFERENCIA', monto: 18500, nroOperacion: `${prefix}-DUP` }
        ],
        hour: 9,
        minute: 25
      }),
      this.buildDemoRegistro({
        id: `${prefix}-REG-DUP-2`,
        fecha,
        nroRecibo: `${prefix}-003`,
        nombre: 'Cliente demo duplicado B',
        observacion: 'Demo visible de conciliacion: candidato duplicado B',
        conceptosDetalle: [
          { concepto: 'SELLADOS', monto: 8200 },
          { concepto: 'ANT. PENALES', monto: 10300 }
        ],
        pagosDetalle: [
          { medioPago: 'TRANSFERENCIA', monto: 18500, nroOperacion: `${prefix}-DUP` }
        ],
        hour: 9,
        minute: 40
      }),
      this.buildDemoRegistro({
        id: `${prefix}-REG-MISMATCH`,
        fecha,
        nroRecibo: `${prefix}-004`,
        nombre: 'Cliente demo monto distinto',
        observacion: 'Demo visible de conciliacion: misma operacion con monto distinto',
        conceptosDetalle: [
          { concepto: 'MUNI', monto: 9000 },
          { concepto: 'SELLADOS', monto: 4000 }
        ],
        pagosDetalle: [
          { medioPago: 'POSNET', monto: 660 },
          { medioPago: 'TRANSFERENCIA', monto: 12340, nroOperacion: `${prefix}-MISMATCH` }
        ],
        hour: 10,
        minute: 5
      }),
      this.buildDemoRegistro({
        id: `${prefix}-REG-LATE`,
        fecha,
        nroRecibo: `${prefix}-005`,
        nombre: 'Cliente demo fecha fuera de ventana',
        observacion: 'Demo visible de conciliacion: match manual por fecha tardia',
        conceptosDetalle: [
          { concepto: 'PATENTE', monto: 20000 },
          { concepto: 'SELLADOS', monto: 2100 }
        ],
        pagosDetalle: [
          { medioPago: 'TRANSFERENCIA', monto: 22100, nroOperacion: `${prefix}-LATE` }
        ],
        hour: 10,
        minute: 20
      })
    ];
  }

  private buildDemoConciliacionMovimientos(fecha: string, prefix: string): MovimientoBancario[] {
    return [
      this.buildDemoMovimiento({
        id: `${prefix}-MOV-AUTO`,
        fecha,
        descripcion: 'Credito demo match exacto',
        monto: 25000,
        tipo: 'CREDITO',
        nroOperacion: `${prefix}-AUTO`,
        banco: 'BANCO DEMO',
        cuenta: 'CTA-001',
        referenciaExterna: `${prefix}-REF-AUTO`,
        hour: 11,
        minute: 0
      }),
      this.buildDemoMovimiento({
        id: `${prefix}-MOV-DUP`,
        fecha,
        descripcion: 'Credito demo duplicado',
        monto: 18500,
        tipo: 'CREDITO',
        nroOperacion: `${prefix}-DUP`,
        banco: 'BANCO DEMO',
        cuenta: 'CTA-001',
        referenciaExterna: `${prefix}-REF-DUP`,
        hour: 11,
        minute: 5
      }),
      this.buildDemoMovimiento({
        id: `${prefix}-MOV-MISMATCH`,
        fecha,
        descripcion: 'Credito demo monto distinto',
        monto: 12345,
        tipo: 'CREDITO',
        nroOperacion: `${prefix}-MISMATCH`,
        banco: 'BANCO DEMO',
        cuenta: 'CTA-002',
        referenciaExterna: `${prefix}-REF-MISMATCH`,
        hour: 11,
        minute: 10
      }),
      this.buildDemoMovimiento({
        id: `${prefix}-MOV-SIN-OP`,
        fecha,
        descripcion: 'Credito demo sin nro operacion',
        monto: 5000,
        tipo: 'CREDITO',
        banco: 'BANCO DEMO',
        cuenta: 'CTA-002',
        referenciaExterna: `${prefix}-REF-SIN-OP`,
        hour: 11,
        minute: 15
      }),
      this.buildDemoMovimiento({
        id: `${prefix}-MOV-DEBITO`,
        fecha,
        descripcion: 'Debito demo no conciliable automaticamente',
        monto: 25000,
        tipo: 'DEBITO',
        nroOperacion: `${prefix}-AUTO`,
        banco: 'BANCO DEMO',
        cuenta: 'CTA-003',
        referenciaExterna: `${prefix}-REF-DEBITO`,
        hour: 11,
        minute: 20
      }),
      this.buildDemoMovimiento({
        id: `${prefix}-MOV-LATE`,
        fecha: this.shiftDate(fecha, 5),
        descripcion: 'Credito demo fecha fuera de ventana automatica',
        monto: 22100,
        tipo: 'CREDITO',
        nroOperacion: `${prefix}-LATE`,
        banco: 'BANCO DEMO',
        cuenta: 'CTA-004',
        referenciaExterna: `${prefix}-REF-LATE`,
        hour: 11,
        minute: 25
      }),
      this.buildDemoMovimiento({
        id: `${prefix}-MOV-NONE`,
        fecha,
        descripcion: 'Credito demo sin candidato',
        monto: 9900,
        tipo: 'CREDITO',
        nroOperacion: `${prefix}-NONE`,
        banco: 'BANCO DEMO',
        cuenta: 'CTA-004',
        referenciaExterna: `${prefix}-REF-NONE`,
        hour: 11,
        minute: 30
      })
    ];
  }

  private buildDemoRegistro(params: {
    id: string;
    fecha: string;
    nroRecibo: string;
    nombre: string;
    observacion: string;
    conceptosDetalle: RegistroConceptoDetalle[];
    pagosDetalle: RegistroPagoDetalle[];
    hour: number;
    minute: number;
  }): Registro {
    const subtotal = params.conceptosDetalle.reduce((sum, item) => sum + Number(item.monto || 0), 0);
    const pagosNormalizados = params.pagosDetalle.map(item => ({
      medioPago: String(item.medioPago || '').trim().toUpperCase(),
      monto: Number(item.monto || 0),
      nroOperacion: item.nroOperacion
    }));

    return {
      id: params.id,
      fecha: params.fecha,
      nroRecibo: params.nroRecibo,
      nombre: params.nombre,
      subtotal,
      sellados: this.sumConcepto(params.conceptosDetalle, 'SELLADOS'),
      muni: this.sumConcepto(params.conceptosDetalle, 'MUNI'),
      sugIT: this.sumConcepto(params.conceptosDetalle, 'SUGIT'),
      patente: this.sumConcepto(params.conceptosDetalle, 'PATENTE'),
      antecedentesPenales: this.sumConcepto(params.conceptosDetalle, 'ANT. PENALES'),
      cheques: this.sumPagos(pagosNormalizados, 'CHEQUES'),
      posnet: this.sumPagos(pagosNormalizados, 'POSNET'),
      vep: this.sumPagos(pagosNormalizados, 'VEP'),
      site: this.sumPagos(pagosNormalizados, 'SITE'),
      deposito: this.sumPagos(pagosNormalizados, 'DEPOSITO'),
      efectivo: this.sumPagos(pagosNormalizados, 'EFECTIVO'),
      pagaCon: '',
      cambio: 0,
      observacion: params.observacion,
      concepto: params.conceptosDetalle[0]?.concepto || 'SELLADOS',
      conceptoMonto: Number(params.conceptosDetalle[0]?.monto || 0),
      medioPago: pagosNormalizados[0]?.medioPago || 'EFECTIVO',
      conceptosDetalle: params.conceptosDetalle,
      pagosDetalle: pagosNormalizados,
      createdAt: this.buildIso(params.fecha, params.hour, params.minute),
      updatedAt: this.buildIso(params.fecha, params.hour, params.minute)
    };
  }

  private buildDemoMovimiento(params: {
    id: string;
    fecha: string;
    descripcion: string;
    monto: number;
    tipo: 'CREDITO' | 'DEBITO';
    nroOperacion?: string;
    banco: string;
    cuenta: string;
    referenciaExterna: string;
    hour: number;
    minute: number;
  }): MovimientoBancario {
    const createdAt = this.buildIso(params.fecha, params.hour, params.minute);
    return {
      id: params.id,
      fecha: params.fecha,
      createdAt,
      updatedAt: createdAt,
      descripcion: params.descripcion,
      monto: params.monto,
      tipo: params.tipo,
      nroOperacion: params.nroOperacion,
      banco: params.banco,
      cuenta: params.cuenta,
      referenciaExterna: params.referenciaExterna,
      origenImportacion: 'DEMO_CONFIG',
      conciliacionEstado: 'PENDIENTE',
      conciliadoRegistroId: undefined,
      conciliadoPagoOrden: undefined,
      conciliadoAt: undefined,
      conciliacionProceso: 'ABIERTO',
      conciliacionCerradaAt: undefined,
      conciliacionCerradaObservacion: undefined
    };
  }

  private sumConcepto(conceptos: RegistroConceptoDetalle[], concepto: string): number {
    return conceptos
      .filter(item => item.concepto === concepto)
      .reduce((sum, item) => sum + Number(item.monto || 0), 0);
  }

  private sumPagos(pagos: RegistroPagoDetalle[], medioPago: string): number {
    return pagos
      .filter(item => item.medioPago === medioPago)
      .reduce((sum, item) => sum + Number(item.monto || 0), 0);
  }

  private buildIso(fecha: string, hour: number, minute: number): string {
    return `${fecha}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
  }

  private shiftDate(fecha: string, offsetDays: number): string {
    const next = new Date(`${fecha}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + offsetDays);
    return next.toISOString().slice(0, 10);
  }

  private matchesScenarioPrefix(id: string | undefined, prefix: string): boolean {
    return String(id || '').trim().toUpperCase().startsWith(prefix);
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
