import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error('Missing SUPABASE_DB_URL');
  process.exit(1);
}

const migrationPath = path.resolve(process.cwd(), 'scripts', 'supabase-migration-profesional.sql');

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

try {
  const sql = await fs.readFile(migrationPath, 'utf8');
  await client.connect();
  await client.query(sql);

  const verification = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'registros',
        'billetes',
        'gastos',
        'ingresos',
        'cierres',
        'registro_conceptos_detalle',
        'registro_pagos_detalle',
        'cierre_registros',
        'cierre_ingresos',
        'cierre_gastos'
      )
    order by table_name;
  `);

  console.log('Migration applied successfully.');
  console.log('Tables:', verification.rows.map(row => row.table_name).join(', '));
} catch (error) {
  console.error('Migration apply failed:', error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}