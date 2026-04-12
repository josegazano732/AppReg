-- Migracion consolidada para AppReg en Supabase.
-- Objetivo:
-- 1. Alinear el esquema remoto con el frontend actual.
-- 2. Normalizar detalles de conceptos y medios de pago.
-- 3. Agregar indices basicos para operacion diaria, cierres y trazabilidad.

create table if not exists public.registros (
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
);

alter table public.registros add column if not exists fecha date;
alter table public.registros add column if not exists concepto_id bigint;
alter table public.registros add column if not exists medio_pago_id bigint;

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
	"createdAt" timestamptz not null
);

alter table public.gastos add column if not exists tipo_egreso_id bigint;
alter table public.gastos add column if not exists medio_pago_id bigint;

create table if not exists public.ingresos (
	id text primary key,
	fecha date,
	"tipoIngreso" text,
	"medioPago" text,
	concepto text,
	monto numeric,
	observacion text,
	comprobante text,
	"createdAt" timestamptz not null
);

alter table public.ingresos add column if not exists tipo_ingreso_id bigint;
alter table public.ingresos add column if not exists medio_pago_id bigint;

create table if not exists public.cierres (
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

update public.registros r
set concepto_id = c.id
from public.config_conceptos c
where upper(trim(coalesce(r.concepto, ''))) = c.nombre
	and (r.concepto_id is null or r.concepto_id <> c.id);

update public.registros r
set medio_pago_id = m.id
from public.config_medios_pago m
where upper(trim(coalesce(r."medioPago", ''))) = m.nombre
	and (r.medio_pago_id is null or r.medio_pago_id <> m.id);

update public.gastos g
set tipo_egreso_id = ts.id
from public.config_tipos_salida ts
where upper(trim(coalesce(g."tipoEgreso", ''))) = ts.nombre
	and (g.tipo_egreso_id is null or g.tipo_egreso_id <> ts.id);

update public.gastos g
set medio_pago_id = m.id
from public.config_medios_pago m
where upper(trim(coalesce(g."medioPago", ''))) = m.nombre
	and (g.medio_pago_id is null or g.medio_pago_id <> m.id);

update public.ingresos i
set tipo_ingreso_id = ti.id
from public.config_tipos_ingreso ti
where upper(trim(coalesce(i."tipoIngreso", ''))) = ti.nombre
	and (i.tipo_ingreso_id is null or i.tipo_ingreso_id <> ti.id);

update public.ingresos i
set medio_pago_id = m.id
from public.config_medios_pago m
where upper(trim(coalesce(i."medioPago", ''))) = m.nombre
	and (i.medio_pago_id is null or i.medio_pago_id <> m.id);

do $$
begin
	if not exists (select 1 from pg_constraint where conname = 'fk_registros_concepto') then
		alter table public.registros
			add constraint fk_registros_concepto
			foreign key (concepto_id) references public.config_conceptos(id) on update cascade on delete set null;
	end if;

	if not exists (select 1 from pg_constraint where conname = 'fk_registros_medio_pago') then
		alter table public.registros
			add constraint fk_registros_medio_pago
			foreign key (medio_pago_id) references public.config_medios_pago(id) on update cascade on delete set null;
	end if;

	if not exists (select 1 from pg_constraint where conname = 'fk_gastos_tipo_egreso') then
		alter table public.gastos
			add constraint fk_gastos_tipo_egreso
			foreign key (tipo_egreso_id) references public.config_tipos_salida(id) on update cascade on delete set null;
	end if;

	if not exists (select 1 from pg_constraint where conname = 'fk_gastos_medio_pago') then
		alter table public.gastos
			add constraint fk_gastos_medio_pago
			foreign key (medio_pago_id) references public.config_medios_pago(id) on update cascade on delete set null;
	end if;

	if not exists (select 1 from pg_constraint where conname = 'fk_ingresos_tipo_ingreso') then
		alter table public.ingresos
			add constraint fk_ingresos_tipo_ingreso
			foreign key (tipo_ingreso_id) references public.config_tipos_ingreso(id) on update cascade on delete set null;
	end if;

	if not exists (select 1 from pg_constraint where conname = 'fk_ingresos_medio_pago') then
		alter table public.ingresos
			add constraint fk_ingresos_medio_pago
			foreign key (medio_pago_id) references public.config_medios_pago(id) on update cascade on delete set null;
	end if;
end $$;

create table if not exists public.registro_conceptos_detalle (
	registro_id text not null,
	orden integer not null,
	concepto text not null,
	monto numeric not null default 0,
	concepto_id bigint,
	"createdAt" timestamptz not null default now(),
	primary key (registro_id, orden),
	constraint fk_registro_conceptos_detalle_registro
		foreign key (registro_id) references public.registros(id) on delete cascade,
	constraint fk_registro_conceptos_detalle_concepto
		foreign key (concepto_id) references public.config_conceptos(id) on update cascade on delete set null
);

create table if not exists public.registro_pagos_detalle (
	registro_id text not null,
	orden integer not null,
	medio_pago text not null,
	monto numeric not null default 0,
	medio_pago_id bigint,
	"createdAt" timestamptz not null default now(),
	primary key (registro_id, orden),
	constraint fk_registro_pagos_detalle_registro
		foreign key (registro_id) references public.registros(id) on delete cascade,
	constraint fk_registro_pagos_detalle_medio
		foreign key (medio_pago_id) references public.config_medios_pago(id) on update cascade on delete set null
);

insert into public.registro_conceptos_detalle (registro_id, orden, concepto, monto, concepto_id)
select
	r.id,
	detalle.ord::int,
	upper(trim(coalesce(detalle.value->>'concepto', ''))),
	coalesce((detalle.value->>'monto')::numeric, 0),
	c.id
from public.registros r
join lateral jsonb_array_elements(coalesce(r."conceptosDetalle", '[]'::jsonb)) with ordinality detalle(value, ord) on true
left join public.config_conceptos c
	on c.nombre = upper(trim(coalesce(detalle.value->>'concepto', '')))
where upper(trim(coalesce(detalle.value->>'concepto', ''))) <> ''
on conflict (registro_id, orden) do update
set concepto = excluded.concepto,
	monto = excluded.monto,
	concepto_id = excluded.concepto_id;

insert into public.registro_conceptos_detalle (registro_id, orden, concepto, monto, concepto_id)
select
	r.id,
	1,
	upper(trim(coalesce(r.concepto, ''))),
	coalesce(r."conceptoMonto", r.subtotal, 0),
	c.id
from public.registros r
left join public.config_conceptos c
	on c.nombre = upper(trim(coalesce(r.concepto, '')))
where coalesce(jsonb_array_length(coalesce(r."conceptosDetalle", '[]'::jsonb)), 0) = 0
	and upper(trim(coalesce(r.concepto, ''))) <> ''
on conflict (registro_id, orden) do update
set concepto = excluded.concepto,
	monto = excluded.monto,
	concepto_id = excluded.concepto_id;

insert into public.registro_pagos_detalle (registro_id, orden, medio_pago, monto, medio_pago_id)
select
	r.id,
	detalle.ord::int,
	upper(trim(coalesce(detalle.value->>'medioPago', ''))),
	coalesce((detalle.value->>'monto')::numeric, 0),
	m.id
from public.registros r
join lateral jsonb_array_elements(coalesce(r."pagosDetalle", '[]'::jsonb)) with ordinality detalle(value, ord) on true
left join public.config_medios_pago m
	on m.nombre = upper(trim(coalesce(detalle.value->>'medioPago', '')))
where upper(trim(coalesce(detalle.value->>'medioPago', ''))) <> ''
on conflict (registro_id, orden) do update
set medio_pago = excluded.medio_pago,
	monto = excluded.monto,
	medio_pago_id = excluded.medio_pago_id;

insert into public.registro_pagos_detalle (registro_id, orden, medio_pago, monto, medio_pago_id)
select
	r.id,
	1,
	upper(trim(coalesce(r."medioPago", ''))),
	coalesce(r.subtotal, 0),
	m.id
from public.registros r
left join public.config_medios_pago m
	on m.nombre = upper(trim(coalesce(r."medioPago", '')))
where coalesce(jsonb_array_length(coalesce(r."pagosDetalle", '[]'::jsonb)), 0) = 0
	and upper(trim(coalesce(r."medioPago", ''))) <> ''
on conflict (registro_id, orden) do update
set medio_pago = excluded.medio_pago,
	monto = excluded.monto,
	medio_pago_id = excluded.medio_pago_id;

create table if not exists public.cierre_registros (
	cierre_id text not null,
	registro_id text not null,
	"createdAt" timestamptz not null default now(),
	primary key (cierre_id, registro_id),
	constraint fk_cierre_registros_cierre
		foreign key (cierre_id) references public.cierres(id) on delete cascade,
	constraint fk_cierre_registros_registro
		foreign key (registro_id) references public.registros(id) on delete cascade
);

create table if not exists public.cierre_ingresos (
	cierre_id text not null,
	ingreso_id text not null,
	"createdAt" timestamptz not null default now(),
	primary key (cierre_id, ingreso_id),
	constraint fk_cierre_ingresos_cierre
		foreign key (cierre_id) references public.cierres(id) on delete cascade,
	constraint fk_cierre_ingresos_ingreso
		foreign key (ingreso_id) references public.ingresos(id) on delete cascade
);

create table if not exists public.cierre_gastos (
	cierre_id text not null,
	gasto_id text not null,
	"createdAt" timestamptz not null default now(),
	primary key (cierre_id, gasto_id),
	constraint fk_cierre_gastos_cierre
		foreign key (cierre_id) references public.cierres(id) on delete cascade,
	constraint fk_cierre_gastos_gasto
		foreign key (gasto_id) references public.gastos(id) on delete cascade
);

insert into public.cierre_registros (cierre_id, registro_id)
select c.id, r.id
from public.cierres c
join lateral jsonb_array_elements_text(coalesce(c.referencias->'registroIds', '[]'::jsonb)) x(value) on true
join public.registros r on r.id = x.value
on conflict do nothing;

insert into public.cierre_ingresos (cierre_id, ingreso_id)
select c.id, i.id
from public.cierres c
join lateral jsonb_array_elements_text(coalesce(c.referencias->'ingresoIds', '[]'::jsonb)) x(value) on true
join public.ingresos i on i.id = x.value
on conflict do nothing;

insert into public.cierre_gastos (cierre_id, gasto_id)
select c.id, g.id
from public.cierres c
join lateral jsonb_array_elements_text(coalesce(c.referencias->'egresoIds', '[]'::jsonb)) x(value) on true
join public.gastos g on g.id = x.value
on conflict do nothing;

create index if not exists idx_registros_fecha on public.registros (fecha);
create index if not exists idx_registros_created_at on public.registros ("createdAt");
create index if not exists idx_gastos_fecha on public.gastos (fecha);
create index if not exists idx_gastos_created_at on public.gastos ("createdAt");
create index if not exists idx_ingresos_fecha on public.ingresos (fecha);
create index if not exists idx_ingresos_created_at on public.ingresos ("createdAt");
create index if not exists idx_cierres_fecha on public.cierres (fecha);
create index if not exists idx_cierres_created_at on public.cierres ("createdAt");
create index if not exists idx_registro_conceptos_detalle_concepto_id on public.registro_conceptos_detalle (concepto_id);
create index if not exists idx_registro_pagos_detalle_medio_pago_id on public.registro_pagos_detalle (medio_pago_id);
create index if not exists idx_registro_pagos_detalle_medio_pago on public.registro_pagos_detalle (medio_pago);
create index if not exists idx_cierre_registros_registro_id on public.cierre_registros (registro_id);
create index if not exists idx_cierre_ingresos_ingreso_id on public.cierre_ingresos (ingreso_id);
create index if not exists idx_cierre_gastos_gasto_id on public.cierre_gastos (gasto_id);