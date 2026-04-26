import { createClient } from '@supabase/supabase-js';
import { buildOperationalScenario } from './test-operational-scenario.mjs';

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

const scenarioData = buildOperationalScenario(process.env.SEED_DATE);
const { scenario, fecha, expected } = scenarioData;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function sumConceptos(record) {
  return toMoney((record.conceptosDetalle || []).reduce((acc, item) => acc + Number(item.monto || 0), 0));
}

function sumPagos(record) {
  return toMoney((record.pagosDetalle || []).reduce((acc, item) => acc + Number(item.monto || 0), 0));
}

function aggregateByMedio(registros, ingresos, gastos) {
  const acc = new Map();

  function add(medioPago, ingresosMonto = 0, egresosMonto = 0) {
    const medio = String(medioPago || '').toUpperCase();
    const current = acc.get(medio) || { ingresos: 0, egresos: 0, neto: 0 };
    current.ingresos = toMoney(current.ingresos + Number(ingresosMonto || 0));
    current.egresos = toMoney(current.egresos + Number(egresosMonto || 0));
    current.neto = toMoney(current.ingresos - current.egresos);
    acc.set(medio, current);
  }

  registros.forEach(record => {
    (record.pagosDetalle || []).forEach(item => add(item.medioPago, item.monto, 0));
  });
  ingresos.forEach(item => add(item.medioPago, item.monto, 0));
  gastos.forEach(item => add(item.medioPago, 0, item.monto));

  return Object.fromEntries([...acc.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

try {
  const [registrosRead, ingresosRead, gastosRead] = await Promise.all([
    supabase.from('registros').select('*').ilike('id', `${scenario}-REG-%`).order('createdAt', { ascending: true }),
    supabase.from('ingresos').select('*').ilike('id', `${scenario}-ING-%`).order('createdAt', { ascending: true }),
    supabase.from('gastos').select('*').ilike('id', `${scenario}-GAS-%`).order('createdAt', { ascending: true })
  ]);

  if (registrosRead.error) throw new Error(`registros read: ${registrosRead.error.message}`);
  if (ingresosRead.error) throw new Error(`ingresos read: ${ingresosRead.error.message}`);
  if (gastosRead.error) throw new Error(`gastos read: ${gastosRead.error.message}`);

  const registros = registrosRead.data || [];
  const ingresos = ingresosRead.data || [];
  const gastos = gastosRead.data || [];

  assert(registros.length === 10, `Cantidad de registros invalida: ${registros.length}`);
  assert(ingresos.length === 5, `Cantidad de ingresos invalida: ${ingresos.length}`);
  assert(gastos.length === 5, `Cantidad de gastos invalida: ${gastos.length}`);

  registros.forEach(record => {
    const conceptos = Array.isArray(record.conceptosDetalle) ? record.conceptosDetalle : [];
    const pagos = Array.isArray(record.pagosDetalle) ? record.pagosDetalle : [];
    const subtotal = toMoney(record.subtotal);
    const conceptosTotal = sumConceptos(record);
    const pagosTotal = sumPagos(record);

    assert(String(record.fecha || '') === fecha, `Fecha invalida en ${record.id}: ${record.fecha}`);
    assert(conceptos.length >= 2, `Registro sin multiples conceptos: ${record.id}`);
    assert(pagos.length >= 1, `Registro sin pagos: ${record.id}`);
    assert(subtotal === conceptosTotal, `Subtotal != conceptos en ${record.id}: subtotal=${subtotal}, conceptos=${conceptosTotal}`);
    assert(subtotal === pagosTotal, `Subtotal != pagos en ${record.id}: subtotal=${subtotal}, pagos=${pagosTotal}`);
  });

  const totalRegistros = toMoney(registros.reduce((acc, item) => acc + Number(item.subtotal || 0), 0));
  const totalIngresosManuales = toMoney(ingresos.reduce((acc, item) => acc + Number(item.monto || 0), 0));
  const totalGastos = toMoney(gastos.reduce((acc, item) => acc + Number(item.monto || 0), 0));
  const totalIngresos = toMoney(totalRegistros + totalIngresosManuales);
  const totalNeto = toMoney(totalIngresos - totalGastos);
  const porMedio = aggregateByMedio(registros, ingresos, gastos);
  const registrosConMultiplesConceptos = registros.filter(item => (item.conceptosDetalle || []).length > 1).length;
  const registrosConMultiplesMedios = registros.filter(item => (item.pagosDetalle || []).length > 1).length;
  const registrosStress = registros.filter(item => (item.conceptosDetalle || []).length >= 4 && (item.pagosDetalle || []).length >= 3).length;
  const transferenciasConOperacion = registros
    .flatMap(item => item.pagosDetalle || [])
    .filter(item => String(item.medioPago || '').toUpperCase() === 'TRANSFERENCIA' && item.nroOperacion)
    .length;

  assert(totalRegistros === toMoney(expected.totalRegistros), `Total registros invalido: ${totalRegistros}`);
  assert(totalIngresosManuales === toMoney(expected.totalIngresosManuales), `Total ingresos manuales invalido: ${totalIngresosManuales}`);
  assert(totalGastos === toMoney(expected.totalGastos), `Total gastos invalido: ${totalGastos}`);
  assert(totalIngresos === toMoney(expected.totalIngresos), `Total ingresos invalido: ${totalIngresos}`);
  assert(totalNeto === toMoney(expected.totalNeto), `Total neto invalido: ${totalNeto}`);
  assert(registrosConMultiplesConceptos === expected.cobertura.registrosConMultiplesConceptos, `Cobertura conceptos invalida: ${registrosConMultiplesConceptos}`);
  assert(registrosConMultiplesMedios === expected.cobertura.registrosConMultiplesMedios, `Cobertura medios invalida: ${registrosConMultiplesMedios}`);
  assert(registrosStress === expected.cobertura.registrosStress, `Cobertura stress invalida: ${registrosStress}`);
  assert(transferenciasConOperacion === expected.cobertura.transferenciasConOperacion, `Transferencias con operacion invalidas: ${transferenciasConOperacion}`);

  for (const [medio, esperado] of Object.entries(expected.porMedio)) {
    const actual = porMedio[medio];
    assert(Boolean(actual), `Medio faltante en agregado: ${medio}`);
    assert(toMoney(actual.ingresos) === toMoney(esperado.ingresos), `Ingresos invalidos para ${medio}: ${actual.ingresos}`);
    assert(toMoney(actual.egresos) === toMoney(esperado.egresos), `Egresos invalidos para ${medio}: ${actual.egresos}`);
    assert(toMoney(actual.neto) === toMoney(esperado.neto), `Neto invalido para ${medio}: ${actual.neto}`);
  }

  console.log('VERIFY_TEST_OPERATIONAL_OK');
  console.log(JSON.stringify({
    scenario,
    fecha,
    checked: {
      registros: registros.length,
      ingresos: ingresos.length,
      gastos: gastos.length,
      totalMovimientos: registros.length + ingresos.length + gastos.length
    },
    totals: {
      totalRegistros,
      totalIngresosManuales,
      totalIngresos,
      totalGastos,
      totalNeto
    },
    coverage: {
      registrosConMultiplesConceptos,
      registrosConMultiplesMedios,
      registrosStress,
      transferenciasConOperacion
    },
    porMedio
  }, null, 2));
} catch (error) {
  console.error('VERIFY_TEST_OPERATIONAL_FAIL', error.message || error);
  process.exit(1);
}