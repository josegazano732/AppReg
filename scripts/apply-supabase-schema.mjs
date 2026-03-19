import pg from 'pg';

const { Client } = pg;

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error('Missing SUPABASE_DB_URL');
  process.exit(1);
}

const statements = [
  `create table if not exists public.registros (
    id text primary key,
    "createdAt" timestamptz not null,
    "nroRecibo" text,
    nombre text,
    subtotal numeric,
    sellados numeric,
    muni numeric,
    "sugIT" numeric,
    patente numeric,
    "antecedentesPenales" numeric,
    cheques numeric,
    posnet numeric,
    vep numeric,
    site numeric,
    deposito numeric,
    efectivo numeric,
    "pagaCon" text,
    cambio numeric,
    observacion text,
    concepto text,
    "conceptoMonto" numeric,
    "medioPago" text,
    "conceptosDetalle" jsonb,
    "pagosDetalle" jsonb
  );`,
  `create table if not exists public.billetes (
    valor numeric primary key,
    cantidad numeric,
    subtotal numeric
  );`,
  `create table if not exists public.gastos (
    id text primary key,
    fecha date,
    "tipoEgreso" text,
    "medioPago" text,
    descripcion text,
    monto numeric,
    observacion text,
    comprobante text,
    "createdAt" timestamptz not null
  );`,
  `create table if not exists public.ingresos (
    id text primary key,
    fecha date,
    "tipoIngreso" text,
    "medioPago" text,
    concepto text,
    monto numeric,
    observacion text,
    comprobante text,
    "createdAt" timestamptz not null
  );`,
  `create table if not exists public.cierres (
    id text primary key,
    fecha date not null,
    "createdAt" timestamptz not null,
    "totalIngresos" numeric,
    "totalGastos" numeric,
    "totalNeto" numeric,
    "detalleMedios" jsonb,
    saldo jsonb,
    "disponibleContinuidad" numeric,
    observacion text,
    referencias jsonb,
    "resumenMovimientos" jsonb
  );`,
  `create table if not exists public.config_conceptos (
    id bigserial primary key,
    nombre text not null unique,
    activo boolean not null default true,
    "createdAt" timestamptz not null default now()
  );`,
  `create table if not exists public.config_medios_pago (
    id bigserial primary key,
    nombre text not null unique,
    activo boolean not null default true,
    "createdAt" timestamptz not null default now()
  );`,
  `create table if not exists public.config_tipos_salida (
    id bigserial primary key,
    nombre text not null unique,
    activo boolean not null default true,
    "createdAt" timestamptz not null default now()
  );`,
  `create table if not exists public.config_tipos_ingreso (
    id bigserial primary key,
    nombre text not null unique,
    activo boolean not null default true,
    "createdAt" timestamptz not null default now()
  );`,
  `insert into public.config_conceptos (nombre) values
    ('SELLADOS'),
    ('MUNI'),
    ('SUGIT'),
    ('PATENTE'),
    ('ANT. PENALES')
    on conflict (nombre) do nothing;`,
  `insert into public.config_medios_pago (nombre) values
    ('EFECTIVO'),
    ('CHEQUES'),
    ('POSNET'),
    ('VEP'),
    ('SITE'),
    ('DEPOSITO')
    on conflict (nombre) do nothing;`,
  `insert into public.config_tipos_salida (nombre) values
    ('RETIRO DE EFECTIVO'),
    ('DEPOSITO BANCARIO'),
    ('GASTOS VARIOS')
    on conflict (nombre) do nothing;`,
  `insert into public.config_tipos_ingreso (nombre) values
    ('VENTA'),
    ('INGRESO EXTRA'),
    ('AJUSTE DE CAJA')
    on conflict (nombre) do nothing;`
];

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

try {
  await client.connect();
  for (const [index, statement] of statements.entries()) {
    await client.query(statement);
    console.log(`OK ${index + 1}/${statements.length}`);
  }

  const check = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'registros',
        'billetes',
        'gastos',
        'ingresos',
        'cierres',
        'config_conceptos',
        'config_medios_pago',
        'config_tipos_salida',
        'config_tipos_ingreso'
      )
    order by table_name;
  `);

  console.log('Tables:', check.rows.map(r => r.table_name).join(', '));
} catch (error) {
  console.error('Schema apply failed:', error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
