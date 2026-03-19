# AppReg

Aplicacion Angular con arquitectura modular y enfoque local-first para operacion diaria de caja.

## Estado actual

- Todo el proyecto usa CSS (sin SCSS).
- UI profesional y responsive para escritorio y movil.
- Estado de negocio centralizado en servicios de `core`.
- Persistencia local por `localStorage` para trabajar sin backend.
- Estructura preparada para migrar a Supabase en una fase futura.

## Estructura

- `src/app/core`: servicios singleton y logica transversal.
- `src/app/shared`: modelos y componentes reutilizables.
- `src/app/features`: modulos por funcionalidad.
- `src/app/layout`: shell principal del dashboard.

## Ejecucion

```bash
npm install
npm start
```

## Escalado a Supabase (futuro)

1. Mantener `ConfigService` y `CajaService` como capa de aplicacion.
2. Reemplazar acceso a `localStorage` por repositorios HTTP/Supabase.
3. Agregar autenticacion y politicas RLS.
4. Mantener los componentes sin dependencia directa de infraestructura.

## Conexion Supabase (actual)

La app ya incluye cliente Supabase y sincronizacion no bloqueante desde `CajaService`.
Si Supabase falla o no existen tablas, la app sigue operando con `localStorage`.

### Variables de entorno

- `supabase.url`
- `supabase.anonKey`

Se configuran en:

- `src/environments/environment.ts`
- `src/environments/environment.prod.ts`

### Crear tablas en Supabase

Ejecutar este script en SQL Editor:

```sql
create table if not exists public.registros (
	id text primary key,
	createdAt timestamptz not null,
	nroRecibo text,
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
);

create table if not exists public.billetes (
	valor numeric primary key,
	cantidad numeric,
	subtotal numeric
);

create table if not exists public.gastos (
	id text primary key,
	fecha date,
	"tipoEgreso" text,
	"medioPago" text,
	descripcion text,
	monto numeric,
	observacion text,
	comprobante text,
	createdAt timestamptz not null
);

create table if not exists public.ingresos (
	id text primary key,
	fecha date,
	"tipoIngreso" text,
	"medioPago" text,
	concepto text,
	monto numeric,
	observacion text,
	comprobante text,
	createdAt timestamptz not null
);

create table if not exists public.cierres (
	id text primary key,
	fecha date not null,
	createdAt timestamptz not null,
	"totalIngresos" numeric,
	"totalGastos" numeric,
	"totalNeto" numeric,
	"detalleMedios" jsonb,
	saldo jsonb,
	"disponibleContinuidad" numeric,
	observacion text,
	referencias jsonb,
	"resumenMovimientos" jsonb
);

create table if not exists public.config_conceptos (
	id bigserial primary key,
	nombre text not null unique,
	activo boolean not null default true,
	"createdAt" timestamptz not null default now()
);

create table if not exists public.config_medios_pago (
	id bigserial primary key,
	nombre text not null unique,
	activo boolean not null default true,
	"createdAt" timestamptz not null default now()
);

create table if not exists public.config_tipos_salida (
	id bigserial primary key,
	nombre text not null unique,
	activo boolean not null default true,
	"createdAt" timestamptz not null default now()
);

create table if not exists public.config_tipos_ingreso (
	id bigserial primary key,
	nombre text not null unique,
	activo boolean not null default true,
	"createdAt" timestamptz not null default now()
);

insert into public.config_conceptos (nombre) values
	('SELLADOS'),
	('MUNI'),
	('SUGIT'),
	('PATENTE'),
	('ANT. PENALES')
	on conflict (nombre) do nothing;

insert into public.config_medios_pago (nombre) values
	('EFECTIVO'),
	('CHEQUES'),
	('POSNET'),
	('VEP'),
	('SITE'),
	('DEPOSITO')
	on conflict (nombre) do nothing;

insert into public.config_tipos_salida (nombre) values
	('RETIRO DE EFECTIVO'),
	('DEPOSITO BANCARIO'),
	('GASTOS VARIOS')
	on conflict (nombre) do nothing;

insert into public.config_tipos_ingreso (nombre) values
	('VENTA'),
	('INGRESO EXTRA'),
	('AJUSTE DE CAJA')
	on conflict (nombre) do nothing;
```

### Politicas RLS sugeridas (entorno interno)

Si no usan login por ahora, pueden dejar RLS deshabilitado temporalmente para pruebas.
Para produccion, habilitar RLS y politicas segun usuarios/sucursal.
