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

const operations = [
  ['registros', () => supabase.from('registros').delete().neq('id', '')],
  ['gastos', () => supabase.from('gastos').delete().neq('id', '')],
  ['ingresos', () => supabase.from('ingresos').delete().neq('id', '')],
  ['cierres', () => supabase.from('cierres').delete().neq('id', '')],
  ['billetes', () => supabase.from('billetes').delete().gte('valor', 0)]
];

for (const [table, action] of operations) {
  const { error } = await action();
  if (error) {
    console.error(`DELETE_ERROR ${table}: ${error.message}`);
    process.exit(1);
  }
}

for (const table of ['registros', 'gastos', 'ingresos', 'cierres', 'billetes']) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error(`COUNT_ERROR ${table}: ${error.message}`);
    process.exit(1);
  }

  console.log(`${table}:${count ?? 0}`);
}

console.log('RESET_DONE');
