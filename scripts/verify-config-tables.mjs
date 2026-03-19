import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.SUPABASE_DB_URL;

if (!connectionString) {
  console.error('Missing SUPABASE_DB_URL');
  process.exit(1);
}

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

try {
  await client.connect();

  const rows = await client.query(`
    select 'config_conceptos' as tabla, count(*)::int as cantidad from public.config_conceptos
    union all
    select 'config_medios_pago' as tabla, count(*)::int as cantidad from public.config_medios_pago
    union all
    select 'config_tipos_salida' as tabla, count(*)::int as cantidad from public.config_tipos_salida
    union all
    select 'config_tipos_ingreso' as tabla, count(*)::int as cantidad from public.config_tipos_ingreso
    order by tabla;
  `);

  for (const row of rows.rows) {
    console.log(`${row.tabla}: ${row.cantidad}`);
  }
} catch (error) {
  console.error('VERIFY_FAIL', error.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
