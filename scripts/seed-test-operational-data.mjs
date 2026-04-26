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
const { scenario, fecha, registros, ingresos, gastos, expected } = scenarioData;

try {
  const registrosWrite = await supabase.from('registros').upsert(registros, { onConflict: 'id' });
  if (registrosWrite.error) throw new Error(`registros: ${registrosWrite.error.message}`);

  const ingresosWrite = await supabase.from('ingresos').upsert(ingresos, { onConflict: 'id' });
  if (ingresosWrite.error) throw new Error(`ingresos: ${ingresosWrite.error.message}`);

  const gastosWrite = await supabase.from('gastos').upsert(gastos, { onConflict: 'id' });
  if (gastosWrite.error) throw new Error(`gastos: ${gastosWrite.error.message}`);

  const [registrosCount, ingresosCount, gastosCount] = await Promise.all([
    supabase.from('registros').select('*', { count: 'exact', head: true }).ilike('id', `${scenario}-REG-%`),
    supabase.from('ingresos').select('*', { count: 'exact', head: true }).ilike('id', `${scenario}-ING-%`),
    supabase.from('gastos').select('*', { count: 'exact', head: true }).ilike('id', `${scenario}-GAS-%`)
  ]);

  if (registrosCount.error) throw new Error(`count registros: ${registrosCount.error.message}`);
  if (ingresosCount.error) throw new Error(`count ingresos: ${ingresosCount.error.message}`);
  if (gastosCount.error) throw new Error(`count gastos: ${gastosCount.error.message}`);

  console.log('SEED_TEST_OPERATIONAL_OK');
  console.log(JSON.stringify({
    scenario,
    fecha,
    inserted: {
      registros: registrosCount.count ?? 0,
      ingresos: ingresosCount.count ?? 0,
      gastos: gastosCount.count ?? 0,
      totalMovimientos: (registrosCount.count ?? 0) + (ingresosCount.count ?? 0) + (gastosCount.count ?? 0)
    },
    expected
  }, null, 2));
} catch (error) {
  console.error('SEED_TEST_OPERATIONAL_FAIL', error.message || error);
  process.exit(1);
}