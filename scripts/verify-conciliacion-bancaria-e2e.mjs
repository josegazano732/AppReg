import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || 'https://crjtyrzdrkgrcxqpmmou.supabase.co';
const key = process.env.SUPABASE_ANON_KEY || 'sb_publishable_VuMRNIgNvGjgRQQq62zYJQ_cHRLSofk';

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

const now = Date.now();
const prefix = `test-conciliacion-${now}`;
const fecha = new Date().toISOString().slice(0, 10);

function dateOffset(baseDate, offsetDays) {
  const date = new Date(`${baseDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function buildIso(dateKey, hour, minute) {
  return `${dateKey}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
}

function normalizeOperacion(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9._/-]/gi, '')
    .trim()
    .toUpperCase();
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function daysDiff(a, b) {
  const timeA = new Date(a).getTime();
  const timeB = new Date(b).getTime();
  if (!Number.isFinite(timeA) || !Number.isFinite(timeB)) {
    return Number.MAX_SAFE_INTEGER;
  }

  return Math.abs(Math.round((timeA - timeB) / 86400000));
}

function isTransferencia(pago) {
  return /TRANSFER|CBU|CVU/.test(normalizeText(pago.medioPago));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildRegistro({ id, fechaRegistro, nroRecibo, nombre, conceptosDetalle, pagosDetalle, observacion, hour, minute }) {
  const subtotal = conceptosDetalle.reduce((sum, item) => sum + Number(item.monto || 0), 0);

  const legacyConceptos = {
    sellados: conceptosDetalle.filter(item => item.concepto === 'SELLADOS').reduce((sum, item) => sum + Number(item.monto || 0), 0),
    muni: conceptosDetalle.filter(item => item.concepto === 'MUNI').reduce((sum, item) => sum + Number(item.monto || 0), 0),
    sugIT: conceptosDetalle.filter(item => item.concepto === 'SUGIT').reduce((sum, item) => sum + Number(item.monto || 0), 0),
    patente: conceptosDetalle.filter(item => item.concepto === 'PATENTE').reduce((sum, item) => sum + Number(item.monto || 0), 0),
    antecedentesPenales: conceptosDetalle.filter(item => item.concepto === 'ANT. PENALES').reduce((sum, item) => sum + Number(item.monto || 0), 0)
  };

  const legacyPagos = {
    cheques: pagosDetalle.filter(item => item.medioPago === 'CHEQUES').reduce((sum, item) => sum + Number(item.monto || 0), 0),
    posnet: pagosDetalle.filter(item => item.medioPago === 'POSNET').reduce((sum, item) => sum + Number(item.monto || 0), 0),
    vep: pagosDetalle.filter(item => item.medioPago === 'VEP').reduce((sum, item) => sum + Number(item.monto || 0), 0),
    site: pagosDetalle.filter(item => item.medioPago === 'SITE').reduce((sum, item) => sum + Number(item.monto || 0), 0),
    deposito: pagosDetalle.filter(item => item.medioPago === 'DEPOSITO').reduce((sum, item) => sum + Number(item.monto || 0), 0),
    efectivo: pagosDetalle.filter(item => item.medioPago === 'EFECTIVO').reduce((sum, item) => sum + Number(item.monto || 0), 0)
  };

  return {
    id,
    fecha: fechaRegistro,
    nroRecibo,
    nombre,
    subtotal,
    ...legacyConceptos,
    ...legacyPagos,
    pagaCon: '',
    cambio: 0,
    observacion,
    concepto: conceptosDetalle[0]?.concepto || 'SELLADOS',
    conceptoMonto: Number(conceptosDetalle[0]?.monto || 0),
    medioPago: String(pagosDetalle[0]?.medioPago || 'EFECTIVO').toUpperCase(),
    conceptosDetalle,
    pagosDetalle,
    createdAt: buildIso(fechaRegistro, hour, minute),
    updatedAt: buildIso(fechaRegistro, hour, minute)
  };
}

function extractCandidatosFromRegistro(registro) {
  return (registro.pagosDetalle || [])
    .map((pago, index) => ({ pago, index }))
    .filter(({ pago }) => isTransferencia(pago) && normalizeOperacion(pago.nroOperacion))
    .map(({ pago, index }) => ({
      registroId: registro.id,
      fecha: registro.fecha,
      nroRecibo: registro.nroRecibo,
      nombre: registro.nombre,
      ordenPago: index + 1,
      medioPago: normalizeText(pago.medioPago),
      monto: Number(pago.monto || 0),
      nroOperacion: normalizeOperacion(pago.nroOperacion)
    }));
}

function candidateKey(item) {
  return `${item.registroId}-${item.ordenPago}`;
}

function buildManualOptions(movimiento, candidatos) {
  return candidatos
    .map(candidato => {
      const reasons = [];
      let priority = 0;
      const movimientoOperacion = normalizeOperacion(movimiento.nro_operacion);
      const exactOperacion = movimientoOperacion && movimientoOperacion === candidato.nroOperacion;
      const exactMonto = Math.abs(Number(candidato.monto || 0) - Number(movimiento.monto || 0)) <= 0.009;
      const diffDias = daysDiff(candidato.fecha, movimiento.fecha);

      if (exactOperacion) {
        priority += 100;
        reasons.push('misma operacion');
      }
      if (exactMonto) {
        priority += 40;
        reasons.push('mismo monto');
      }
      if (diffDias <= 3) {
        priority += 20;
        reasons.push('fecha dentro de 3 dias');
      } else if (diffDias <= 7) {
        priority += 10;
        reasons.push('fecha dentro de 7 dias');
      }

      if (priority === 0) {
        return null;
      }

      return {
        ...candidato,
        motivoManual: reasons.join(', '),
        prioridadManual: priority
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.prioridadManual - a.prioridadManual || a.fecha.localeCompare(b.fecha));
}

function resolveMovement(movimiento, candidatos) {
  const nroOperacion = normalizeOperacion(movimiento.nro_operacion);
  if (movimiento.tipo !== 'CREDITO' || !nroOperacion) {
    return { estado: 'PENDIENTE', candidato: null };
  }

  const opCandidates = candidatos.filter(item => item.nroOperacion === nroOperacion);
  const exactCandidates = opCandidates.filter(item =>
    Math.abs(Number(item.monto || 0) - Number(movimiento.monto || 0)) <= 0.009
    && daysDiff(item.fecha, movimiento.fecha) <= 3
  );

  if (exactCandidates.length === 1) {
    return { estado: 'CONCILIADO', candidato: exactCandidates[0] };
  }

  if (exactCandidates.length > 1 || opCandidates.length > 0) {
    return { estado: 'REVISAR', candidato: null };
  }

  return { estado: 'PENDIENTE', candidato: null };
}

const registros = [
  buildRegistro({
    id: `${prefix}-reg-auto`,
    fechaRegistro: fecha,
    nroRecibo: `${prefix}-rec-001`,
    nombre: 'AUTO MATCH',
    observacion: 'registro exacto para conciliacion automatica',
    hour: 9,
    minute: 0,
    conceptosDetalle: [
      { concepto: 'SELLADOS', monto: 60 },
      { concepto: 'MUNI', monto: 40 },
      { concepto: 'PATENTE', monto: 20 }
    ],
    pagosDetalle: [
      { medioPago: 'EFECTIVO', monto: 20 },
      { medioPago: 'TRANSFERENCIA', monto: 100, nroOperacion: `${prefix}-AUTO-001` }
    ]
  }),
  buildRegistro({
    id: `${prefix}-reg-dup-1`,
    fechaRegistro: fecha,
    nroRecibo: `${prefix}-rec-002`,
    nombre: 'DUPLICADO UNO',
    observacion: 'primer candidato duplicado',
    hour: 9,
    minute: 20,
    conceptosDetalle: [
      { concepto: 'SELLADOS', monto: 80 },
      { concepto: 'ANT. PENALES', monto: 70 },
      { concepto: 'MUNI', monto: 30 }
    ],
    pagosDetalle: [
      { medioPago: 'TRANSFERENCIA', monto: 150, nroOperacion: `${prefix}-DUP-001` },
      { medioPago: 'CHEQUES', monto: 30 }
    ]
  }),
  buildRegistro({
    id: `${prefix}-reg-dup-2`,
    fechaRegistro: fecha,
    nroRecibo: `${prefix}-rec-003`,
    nombre: 'DUPLICADO DOS',
    observacion: 'segundo candidato duplicado',
    hour: 9,
    minute: 35,
    conceptosDetalle: [
      { concepto: 'PATENTE', monto: 90 },
      { concepto: 'SUGIT', monto: 40 },
      { concepto: 'SELLADOS', monto: 50 }
    ],
    pagosDetalle: [
      { medioPago: 'TRANSFERENCIA', monto: 150, nroOperacion: `${prefix}-DUP-001` },
      { medioPago: 'POSNET', monto: 30 }
    ]
  }),
  buildRegistro({
    id: `${prefix}-reg-mismatch`,
    fechaRegistro: fecha,
    nroRecibo: `${prefix}-rec-004`,
    nombre: 'MISMATCH',
    observacion: 'misma operacion pero monto distinto',
    hour: 10,
    minute: 0,
    conceptosDetalle: [
      { concepto: 'SELLADOS', monto: 120 },
      { concepto: 'MUNI', monto: 40 },
      { concepto: 'PATENTE', monto: 40 }
    ],
    pagosDetalle: [
      { medioPago: 'TRANSFERENCIA', monto: 200, nroOperacion: `${prefix}-MISMATCH-001` },
      { medioPago: 'EFECTIVO', monto: 0 }
    ]
  }),
  buildRegistro({
    id: `${prefix}-reg-late`,
    fechaRegistro: dateOffset(fecha, -5),
    nroRecibo: `${prefix}-rec-005`,
    nombre: 'LATE MATCH',
    observacion: 'candidato manual por fecha extendida',
    hour: 10,
    minute: 20,
    conceptosDetalle: [
      { concepto: 'SELLADOS', monto: 30 },
      { concepto: 'MUNI', monto: 25 },
      { concepto: 'ANT. PENALES', monto: 25 }
    ],
    pagosDetalle: [
      { medioPago: 'TRANSFERENCIA', monto: 80, nroOperacion: `${prefix}-LATE-001` }
    ]
  })
];

const movimientos = [
  {
    id: `${prefix}-mov-auto`,
    fecha,
    descripcion: 'credito exacto automatico',
    monto: 100,
    tipo: 'CREDITO',
    nro_operacion: `${prefix}-AUTO-001`,
    banco: 'BANCO TEST',
    cuenta: 'CTA-001',
    referencia_externa: `${prefix}-ref-001`,
    origen_importacion: 'VERIFY_CONCILIACION',
    conciliacion_estado: 'PENDIENTE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: `${prefix}-mov-dup`,
    fecha,
    descripcion: 'credito con candidatos duplicados',
    monto: 150,
    tipo: 'CREDITO',
    nro_operacion: `${prefix}-DUP-001`,
    banco: 'BANCO TEST',
    cuenta: 'CTA-001',
    referencia_externa: `${prefix}-ref-002`,
    origen_importacion: 'VERIFY_CONCILIACION',
    conciliacion_estado: 'PENDIENTE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: `${prefix}-mov-mismatch`,
    fecha,
    descripcion: 'credito con misma operacion y monto distinto',
    monto: 210,
    tipo: 'CREDITO',
    nro_operacion: `${prefix}-MISMATCH-001`,
    banco: 'BANCO TEST',
    cuenta: 'CTA-001',
    referencia_externa: `${prefix}-ref-003`,
    origen_importacion: 'VERIFY_CONCILIACION',
    conciliacion_estado: 'PENDIENTE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: `${prefix}-mov-sin-op`,
    fecha,
    descripcion: 'credito sin numero de operacion',
    monto: 75,
    tipo: 'CREDITO',
    nro_operacion: '',
    banco: 'BANCO TEST',
    cuenta: 'CTA-001',
    referencia_externa: `${prefix}-ref-004`,
    origen_importacion: 'VERIFY_CONCILIACION',
    conciliacion_estado: 'PENDIENTE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: `${prefix}-mov-debito`,
    fecha,
    descripcion: 'debito con operacion coincidente',
    monto: 100,
    tipo: 'DEBITO',
    nro_operacion: `${prefix}-AUTO-001`,
    banco: 'BANCO TEST',
    cuenta: 'CTA-001',
    referencia_externa: `${prefix}-ref-005`,
    origen_importacion: 'VERIFY_CONCILIACION',
    conciliacion_estado: 'PENDIENTE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: `${prefix}-mov-late`,
    fecha,
    descripcion: 'credito con misma operacion pero fecha fuera de rango automatico',
    monto: 80,
    tipo: 'CREDITO',
    nro_operacion: `${prefix}-LATE-001`,
    banco: 'BANCO TEST',
    cuenta: 'CTA-001',
    referencia_externa: `${prefix}-ref-006`,
    origen_importacion: 'VERIFY_CONCILIACION',
    conciliacion_estado: 'PENDIENTE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: `${prefix}-mov-none`,
    fecha,
    descripcion: 'credito sin candidato',
    monto: 66,
    tipo: 'CREDITO',
    nro_operacion: `${prefix}-NONE-001`,
    banco: 'BANCO TEST',
    cuenta: 'CTA-001',
    referencia_externa: `${prefix}-ref-007`,
    origen_importacion: 'VERIFY_CONCILIACION',
    conciliacion_estado: 'PENDIENTE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

async function cleanup() {
  await supabase.from('movimientos_bancarios').delete().ilike('id', `${prefix}-mov-%`);
  await supabase.from('registros').delete().ilike('id', `${prefix}-reg-%`);
}

try {
  const registrosWrite = await supabase.from('registros').upsert(registros, { onConflict: 'id' });
  if (registrosWrite.error) throw new Error(`registros write: ${registrosWrite.error.message}`);

  const movimientosWrite = await supabase.from('movimientos_bancarios').upsert(movimientos, { onConflict: 'id' });
  if (movimientosWrite.error) throw new Error(`movimientos write: ${movimientosWrite.error.message}`);

  const [registrosRead, movimientosRead] = await Promise.all([
    supabase.from('registros').select('*').ilike('id', `${prefix}-reg-%`).order('createdAt', { ascending: true }),
    supabase.from('movimientos_bancarios').select('*').ilike('id', `${prefix}-mov-%`).order('createdAt', { ascending: true })
  ]);

  if (registrosRead.error) throw new Error(`registros read: ${registrosRead.error.message}`);
  if (movimientosRead.error) throw new Error(`movimientos read: ${movimientosRead.error.message}`);

  const registrosActuales = registrosRead.data || [];
  const movimientosActuales = movimientosRead.data || [];
  const candidatos = registrosActuales.flatMap(extractCandidatosFromRegistro);

  assert(registrosActuales.length === 5, `Cantidad de registros invalida: ${registrosActuales.length}`);
  assert(movimientosActuales.length === 7, `Cantidad de movimientos invalida: ${movimientosActuales.length}`);
  assert(registrosActuales.every(item => (item.conceptosDetalle || []).length >= 2), 'Todos los registros deben tener multiples conceptos');
  assert(registrosActuales.filter(item => (item.pagosDetalle || []).length > 1).length >= 4, 'Debe haber varios registros con medios combinados');

  const resultados = Object.fromEntries(movimientosActuales.map(item => [item.id, resolveMovement(item, candidatos)]));

  assert(resultados[`${prefix}-mov-auto`].estado === 'CONCILIADO', 'El movimiento exacto debio conciliar automaticamente');
  assert(resultados[`${prefix}-mov-auto`].candidato?.registroId === `${prefix}-reg-auto`, 'El match exacto debio apuntar al registro correcto');
  assert(resultados[`${prefix}-mov-dup`].estado === 'REVISAR', 'El movimiento con duplicados debio quedar en revisar');
  assert(resultados[`${prefix}-mov-mismatch`].estado === 'REVISAR', 'El movimiento con monto distinto debio quedar en revisar');
  assert(resultados[`${prefix}-mov-sin-op`].estado === 'PENDIENTE', 'El movimiento sin operacion debio quedar pendiente');
  assert(resultados[`${prefix}-mov-debito`].estado === 'PENDIENTE', 'El debito no debe conciliar automaticamente');
  assert(resultados[`${prefix}-mov-late`].estado === 'REVISAR', 'El movimiento fuera de 3 dias debio quedar en revisar');
  assert(resultados[`${prefix}-mov-none`].estado === 'PENDIENTE', 'El movimiento sin candidato debio quedar pendiente');

  const manualLate = buildManualOptions(
    movimientosActuales.find(item => item.id === `${prefix}-mov-late`),
    candidatos
  );
  const manualDup = buildManualOptions(
    movimientosActuales.find(item => item.id === `${prefix}-mov-dup`),
    candidatos
  );
  const manualDupRegistroIds = new Set(manualDup.map(item => item.registroId));

  assert(manualLate.length >= 1, 'El movimiento fuera de rango automatico debio ofrecer opcion manual');
  assert(manualLate[0].registroId === `${prefix}-reg-late`, 'La opcion manual principal debio apuntar al registro tardio');
  assert(manualDupRegistroIds.has(`${prefix}-reg-dup-1`), 'La lista manual debio incluir el primer candidato duplicado');
  assert(manualDupRegistroIds.has(`${prefix}-reg-dup-2`), 'La lista manual debio incluir el segundo candidato duplicado');

  console.log('VERIFY_CONCILIACION_BANCARIA_OK');
  console.log(JSON.stringify({
    prefix,
    fecha,
    checked: {
      registros: registrosActuales.length,
      movimientos: movimientosActuales.length,
      candidatosTransferencia: candidatos.length
    },
    estados: Object.fromEntries(Object.entries(resultados).map(([key, value]) => [key, value.estado])),
    manual: {
      lateOptions: manualLate.length,
      duplicateOptions: manualDup.length,
      duplicateCandidateIds: [...manualDupRegistroIds]
    }
  }, null, 2));
} catch (error) {
  console.error('VERIFY_CONCILIACION_BANCARIA_FAIL', error.message || error);
  process.exitCode = 1;
} finally {
  await cleanup().catch(cleanupError => {
    console.error('VERIFY_CONCILIACION_BANCARIA_CLEANUP_FAIL', cleanupError.message || cleanupError);
    process.exitCode = 1;
  });
}