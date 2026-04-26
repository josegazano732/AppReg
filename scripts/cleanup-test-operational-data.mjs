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

const fecha = process.env.SEED_DATE || new Date().toISOString().slice(0, 10);
const scenario = `QA-${fecha.replace(/-/g, '')}`;

async function countByPrefix(table, prefix) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .ilike('id', `${prefix}%`);

  if (error) {
    throw new Error(`${table} count: ${error.message}`);
  }

  return count ?? 0;
}

async function deleteByPrefix(table, prefix) {
  const { error } = await supabase
    .from(table)
    .delete()
    .ilike('id', `${prefix}%`);

  if (error) {
    throw new Error(`${table} delete: ${error.message}`);
  }
}

try {
  const before = {
    registros: await countByPrefix('registros', `${scenario}-REG-`),
    ingresos: await countByPrefix('ingresos', `${scenario}-ING-`),
    gastos: await countByPrefix('gastos', `${scenario}-GAS-`),
    cierres: await countByPrefix('cierres', `${scenario}-CIE-`)
  };

  await deleteByPrefix('cierres', `${scenario}-CIE-`);
  await deleteByPrefix('registros', `${scenario}-REG-`);
  await deleteByPrefix('ingresos', `${scenario}-ING-`);
  await deleteByPrefix('gastos', `${scenario}-GAS-`);

  const after = {
    registros: await countByPrefix('registros', `${scenario}-REG-`),
    ingresos: await countByPrefix('ingresos', `${scenario}-ING-`),
    gastos: await countByPrefix('gastos', `${scenario}-GAS-`),
    cierres: await countByPrefix('cierres', `${scenario}-CIE-`)
  };

  console.log('CLEANUP_TEST_OPERATIONAL_OK');
  console.log(JSON.stringify({ scenario, fecha, before, after }, null, 2));
} catch (error) {
  console.error('CLEANUP_TEST_OPERATIONAL_FAIL', error.message || error);
  process.exit(1);
}