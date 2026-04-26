export function buildOperationalScenario(dateKey) {
  const fecha = dateKey || new Date().toISOString().slice(0, 10);
  const scenario = `QA-${fecha.replace(/-/g, '')}`;

  function buildIso(hour, minute) {
    return `${fecha}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
  }

  function conceptosToLegacyFields(conceptos) {
    const base = {
      sellados: 0,
      muni: 0,
      sugIT: 0,
      patente: 0,
      antecedentesPenales: 0
    };

    conceptos.forEach(item => {
      switch (String(item.concepto || '').toUpperCase()) {
        case 'SELLADOS':
          base.sellados += Number(item.monto || 0);
          break;
        case 'MUNI':
          base.muni += Number(item.monto || 0);
          break;
        case 'SUGIT':
          base.sugIT += Number(item.monto || 0);
          break;
        case 'PATENTE':
          base.patente += Number(item.monto || 0);
          break;
        case 'ANT. PENALES':
          base.antecedentesPenales += Number(item.monto || 0);
          break;
        default:
          break;
      }
    });

    return base;
  }

  function pagosToLegacyFields(pagos) {
    const base = {
      cheques: 0,
      posnet: 0,
      vep: 0,
      site: 0,
      deposito: 0,
      efectivo: 0
    };

    pagos.forEach(item => {
      const medio = String(item.medioPago || '').toUpperCase();
      const monto = Number(item.monto || 0);
      if (medio === 'CHEQUES') base.cheques += monto;
      if (medio === 'POSNET') base.posnet += monto;
      if (medio === 'VEP') base.vep += monto;
      if (medio === 'SITE') base.site += monto;
      if (medio === 'DEPOSITO') base.deposito += monto;
      if (medio === 'EFECTIVO') base.efectivo += monto;
    });

    return base;
  }

  function buildRegistro(seed) {
    const conceptosDetalle = seed.conceptosDetalle;
    const pagosDetalle = seed.pagosDetalle;
    const subtotal = conceptosDetalle.reduce((acc, item) => acc + Number(item.monto || 0), 0);
    const legacyConceptos = conceptosToLegacyFields(conceptosDetalle);
    const legacyPagos = pagosToLegacyFields(pagosDetalle);

    return {
      id: `${scenario}-REG-${seed.index}`,
      fecha,
      nroRecibo: `${scenario}-REC-${String(seed.index).padStart(3, '0')}`,
      nombre: seed.nombre,
      subtotal,
      ...legacyConceptos,
      ...legacyPagos,
      pagaCon: '',
      cambio: 0,
      observacion: `${scenario} | ${seed.observacion}`,
      concepto: conceptosDetalle[0]?.concepto || 'SELLADOS',
      conceptoMonto: Number(conceptosDetalle[0]?.monto || 0),
      medioPago: String(pagosDetalle[0]?.medioPago || 'EFECTIVO').toUpperCase(),
      conceptosDetalle,
      pagosDetalle,
      createdAt: buildIso(seed.hour, seed.minute),
      updatedAt: buildIso(seed.hour, seed.minute)
    };
  }

  function buildIngreso(seed) {
    return {
      id: `${scenario}-ING-${seed.index}`,
      fecha,
      tipoIngreso: seed.tipoIngreso,
      medioPago: seed.medioPago,
      concepto: `${scenario} | ${seed.concepto}`,
      monto: Number(seed.monto || 0),
      observacion: seed.observacion,
      comprobante: `${scenario}-COMP-ING-${String(seed.index).padStart(3, '0')}`,
      createdAt: buildIso(seed.hour, seed.minute),
      updatedAt: buildIso(seed.hour, seed.minute)
    };
  }

  function buildGasto(seed) {
    return {
      id: `${scenario}-GAS-${seed.index}`,
      fecha,
      tipoEgreso: seed.tipoEgreso,
      medioPago: seed.medioPago,
      descripcion: `${scenario} | ${seed.descripcion}`,
      monto: Number(seed.monto || 0),
      observacion: seed.observacion,
      comprobante: `${scenario}-COMP-GAS-${String(seed.index).padStart(3, '0')}`,
      createdAt: buildIso(seed.hour, seed.minute),
      updatedAt: buildIso(seed.hour, seed.minute)
    };
  }

  const registros = [
    buildRegistro({ index: 1, hour: 8, minute: 5, nombre: 'ANA PEREZ', observacion: 'registro con 2 conceptos y pago simple en efectivo', conceptosDetalle: [{ concepto: 'SELLADOS', monto: 80 }, { concepto: 'MUNI', monto: 45.5 }], pagosDetalle: [{ medioPago: 'EFECTIVO', monto: 125.5 }] }),
    buildRegistro({ index: 2, hour: 8, minute: 20, nombre: 'BRUNO DIAZ', observacion: 'registro con 3 conceptos y posnet unico', conceptosDetalle: [{ concepto: 'PATENTE', monto: 120 }, { concepto: 'SELLADOS', monto: 90 }, { concepto: 'MUNI', monto: 30 }], pagosDetalle: [{ medioPago: 'POSNET', monto: 240 }] }),
    buildRegistro({ index: 3, hour: 8, minute: 45, nombre: 'CARLA RUIZ', observacion: 'registro combinado efectivo y posnet con 3 conceptos', conceptosDetalle: [{ concepto: 'SUGIT', monto: 110 }, { concepto: 'ANT. PENALES', monto: 70 }, { concepto: 'SELLADOS', monto: 30 }], pagosDetalle: [{ medioPago: 'EFECTIVO', monto: 90 }, { medioPago: 'POSNET', monto: 120 }] }),
    buildRegistro({ index: 4, hour: 9, minute: 10, nombre: 'DIEGO LOPEZ', observacion: 'registro con cheque y efectivo', conceptosDetalle: [{ concepto: 'MUNI', monto: 50 }, { concepto: 'SELLADOS', monto: 45 }, { concepto: 'PATENTE', monto: 55 }], pagosDetalle: [{ medioPago: 'CHEQUES', monto: 100 }, { medioPago: 'EFECTIVO', monto: 50 }] }),
    buildRegistro({ index: 5, hour: 9, minute: 35, nombre: 'ELENA SOSA', observacion: 'registro con 4 conceptos y deposito', conceptosDetalle: [{ concepto: 'PATENTE', monto: 150 }, { concepto: 'MUNI', monto: 60 }, { concepto: 'SELLADOS', monto: 50 }, { concepto: 'SUGIT', monto: 40 }], pagosDetalle: [{ medioPago: 'DEPOSITO', monto: 300 }] }),
    buildRegistro({ index: 6, hour: 10, minute: 0, nombre: 'FABIAN IBARRA', observacion: 'registro con medios alternativos site y vep', conceptosDetalle: [{ concepto: 'SELLADOS', monto: 50 }, { concepto: 'MUNI', monto: 40 }, { concepto: 'SUGIT', monto: 50 }], pagosDetalle: [{ medioPago: 'SITE', monto: 40 }, { medioPago: 'VEP', monto: 100 }] }),
    buildRegistro({ index: 7, hour: 10, minute: 25, nombre: 'GABRIELA ORTIZ', observacion: 'registro con 4 conceptos y 3 medios para validar prorrateo', conceptosDetalle: [{ concepto: 'PATENTE', monto: 200 }, { concepto: 'ANT. PENALES', monto: 120 }, { concepto: 'SELLADOS', monto: 60 }, { concepto: 'MUNI', monto: 20 }], pagosDetalle: [{ medioPago: 'EFECTIVO', monto: 150 }, { medioPago: 'CHEQUES', monto: 120 }, { medioPago: 'POSNET', monto: 130 }] }),
    buildRegistro({ index: 8, hour: 10, minute: 50, nombre: 'HUGO MEDINA', observacion: 'registro por transferencia y efectivo con numero de operacion', conceptosDetalle: [{ concepto: 'SELLADOS', monto: 75 }, { concepto: 'MUNI', monto: 25 }, { concepto: 'PATENTE', monto: 75 }], pagosDetalle: [{ medioPago: 'TRANSFERENCIA', monto: 120, nroOperacion: `${scenario}-TRX-001` }, { medioPago: 'EFECTIVO', monto: 55 }] }),
    buildRegistro({ index: 9, hour: 11, minute: 15, nombre: 'IVANA ACOSTA', observacion: 'registro con deposito, site y vep', conceptosDetalle: [{ concepto: 'PATENTE', monto: 95 }, { concepto: 'SELLADOS', monto: 35 }, { concepto: 'MUNI', monto: 30 }, { concepto: 'ANT. PENALES', monto: 40 }], pagosDetalle: [{ medioPago: 'DEPOSITO', monto: 100 }, { medioPago: 'SITE', monto: 40 }, { medioPago: 'VEP', monto: 60 }] }),
    buildRegistro({ index: 10, hour: 11, minute: 40, nombre: 'JORGE NUÑEZ', observacion: 'registro stress con 4 conceptos y 4 medios', conceptosDetalle: [{ concepto: 'SELLADOS', monto: 65 }, { concepto: 'PATENTE', monto: 85 }, { concepto: 'SUGIT', monto: 55 }, { concepto: 'MUNI', monto: 45 }], pagosDetalle: [{ medioPago: 'EFECTIVO', monto: 70 }, { medioPago: 'POSNET', monto: 80 }, { medioPago: 'TRANSFERENCIA', monto: 50, nroOperacion: `${scenario}-TRX-002` }, { medioPago: 'CHEQUES', monto: 50 }] })
  ];

  const ingresos = [
    buildIngreso({ index: 1, hour: 12, minute: 5, tipoIngreso: 'VENTA', medioPago: 'EFECTIVO', concepto: 'venta mostrador', monto: 90, observacion: 'cubre caso base' }),
    buildIngreso({ index: 2, hour: 12, minute: 25, tipoIngreso: 'INGRESO EXTRA', medioPago: 'POSNET', concepto: 'cobro accesorio', monto: 55, observacion: 'ingreso manual por posnet' }),
    buildIngreso({ index: 3, hour: 12, minute: 45, tipoIngreso: 'AJUSTE DE CAJA', medioPago: 'DEPOSITO', concepto: 'regularizacion deposito', monto: 40, observacion: 'ajuste bancario' }),
    buildIngreso({ index: 4, hour: 13, minute: 5, tipoIngreso: 'VENTA', medioPago: 'CHEQUES', concepto: 'venta convenio', monto: 130, observacion: 'ingreso con cheque' }),
    buildIngreso({ index: 5, hour: 13, minute: 25, tipoIngreso: 'INGRESO EXTRA', medioPago: 'SITE', concepto: 'cobro portal', monto: 35, observacion: 'medio alternativo site' })
  ];

  const gastos = [
    buildGasto({ index: 1, hour: 14, minute: 5, tipoEgreso: 'GASTOS VARIOS', medioPago: 'EFECTIVO', descripcion: 'compra de insumos', monto: 45, observacion: 'egreso chico en efectivo' }),
    buildGasto({ index: 2, hour: 14, minute: 25, tipoEgreso: 'DEPOSITO BANCARIO', medioPago: 'EFECTIVO', descripcion: 'envio de efectivo a banco', monto: 120, observacion: 'egreso grande efectivo' }),
    buildGasto({ index: 3, hour: 14, minute: 45, tipoEgreso: 'RETIRO DE EFECTIVO', medioPago: 'EFECTIVO', descripcion: 'retiro gerencia', monto: 60, observacion: 'prueba continuidad efectivo' }),
    buildGasto({ index: 4, hour: 15, minute: 5, tipoEgreso: 'GASTOS VARIOS', medioPago: 'POSNET', descripcion: 'contracargo operativo', monto: 30, observacion: 'egreso por posnet' }),
    buildGasto({ index: 5, hour: 15, minute: 25, tipoEgreso: 'GASTOS VARIOS', medioPago: 'CHEQUES', descripcion: 'comision cheque', monto: 15, observacion: 'egreso por cheque' })
  ];

  function summarizeByMedio() {
    const acc = new Map();

    function add(medioPago, ingresosMonto = 0, egresosMonto = 0) {
      const medio = String(medioPago || '').toUpperCase();
      const current = acc.get(medio) || { ingresos: 0, egresos: 0, neto: 0 };
      current.ingresos += Number(ingresosMonto || 0);
      current.egresos += Number(egresosMonto || 0);
      current.neto = current.ingresos - current.egresos;
      acc.set(medio, current);
    }

    registros.forEach(registro => {
      (registro.pagosDetalle || []).forEach(pago => add(pago.medioPago, pago.monto, 0));
    });
    ingresos.forEach(ingreso => add(ingreso.medioPago, ingreso.monto, 0));
    gastos.forEach(gasto => add(gasto.medioPago, 0, gasto.monto));

    return Object.fromEntries([...acc.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }

  const totalRegistros = registros.reduce((acc, item) => acc + Number(item.subtotal || 0), 0);
  const totalIngresosManuales = ingresos.reduce((acc, item) => acc + Number(item.monto || 0), 0);
  const totalGastos = gastos.reduce((acc, item) => acc + Number(item.monto || 0), 0);
  const totalIngresos = totalRegistros + totalIngresosManuales;
  const totalNeto = totalIngresos - totalGastos;
  const registrosConMultiplesConceptos = registros.filter(item => (item.conceptosDetalle || []).length > 1).length;
  const registrosConMultiplesMedios = registros.filter(item => (item.pagosDetalle || []).length > 1).length;

  return {
    fecha,
    scenario,
    registros,
    ingresos,
    gastos,
    expected: {
      totalRegistros,
      totalIngresosManuales,
      totalIngresos,
      totalGastos,
      totalNeto,
      porMedio: summarizeByMedio(),
      cobertura: {
        registrosConMultiplesConceptos,
        registrosConMultiplesMedios,
        registrosStress: registros.filter(item => (item.conceptosDetalle || []).length >= 4 && (item.pagosDetalle || []).length >= 3).length,
        transferenciasConOperacion: registros.flatMap(item => item.pagosDetalle || []).filter(item => String(item.medioPago || '').toUpperCase() === 'TRANSFERENCIA' && item.nroOperacion).length
      }
    }
  };
}