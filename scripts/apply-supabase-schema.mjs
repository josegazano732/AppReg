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
    fecha date,
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
  `alter table public.registros add column if not exists fecha date;`,
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
  `create table if not exists public.movimientos_bancarios (
    id text primary key,
    fecha date not null,
    "createdAt" timestamptz not null,
    "updatedAt" timestamptz not null default now(),
    banco text,
    cuenta text,
    descripcion text not null,
    monto numeric not null,
    tipo text not null,
    nro_operacion text,
    referencia_externa text,
    origen_importacion text,
    conciliacion_estado text not null default 'PENDIENTE',
    conciliado_registro_id text,
    conciliado_pago_orden integer,
    conciliado_at timestamptz
  );`,
  `alter table public.movimientos_bancarios add column if not exists "updatedAt" timestamptz not null default now();`,
  `create index if not exists idx_movimientos_bancarios_fecha on public.movimientos_bancarios (fecha);`,
  `create index if not exists idx_movimientos_bancarios_nro_operacion on public.movimientos_bancarios (nro_operacion);`,
  `create index if not exists idx_movimientos_bancarios_estado on public.movimientos_bancarios (conciliacion_estado);`,
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
  `create index if not exists idx_registros_fecha on public.registros (fecha);`,
  `create index if not exists idx_registros_created_at on public.registros ("createdAt");`,
  `create index if not exists idx_gastos_fecha on public.gastos (fecha);`,
  `create index if not exists idx_gastos_created_at on public.gastos ("createdAt");`,
  `create index if not exists idx_ingresos_fecha on public.ingresos (fecha);`,
  `create index if not exists idx_ingresos_created_at on public.ingresos ("createdAt");`,
  `create index if not exists idx_cierres_fecha on public.cierres (fecha);`,
  `create index if not exists idx_cierres_created_at on public.cierres ("createdAt");`,
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
        'movimientos_bancarios',
        'config_conceptos',
        'config_medios_pago',
        'config_tipos_salida',
        'config_tipos_ingreso'
      )
    order by table_name;
  `);

  const indexCheck = await client.query(`
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'idx_registros_fecha',
        'idx_registros_created_at',
        'idx_gastos_fecha',
        'idx_gastos_created_at',
        'idx_ingresos_fecha',
        'idx_ingresos_created_at',
        'idx_cierres_fecha',
        'idx_cierres_created_at',
        'idx_movimientos_bancarios_fecha',
        'idx_movimientos_bancarios_nro_operacion',
        'idx_movimientos_bancarios_estado'
      )
    order by indexname;
  `);

  console.log('Tables:', check.rows.map(r => r.table_name).join(', '));
  console.log('Indexes:', indexCheck.rows.map(r => r.indexname).join(', '));
} catch (error) {
  console.error('Schema apply failed:', error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
