import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.SUPABASE_DB_URL;

if (!connectionString) {
  console.error('Missing SUPABASE_DB_URL');
  process.exit(1);
}

const statements = [
  `alter table public.registros add column if not exists fecha date;`,
  `alter table public.registros add column if not exists concepto_id bigint;`,
  `alter table public.registros add column if not exists medio_pago_id bigint;`,
  `alter table public.gastos add column if not exists tipo_egreso_id bigint;`,
  `alter table public.gastos add column if not exists medio_pago_id bigint;`,
  `alter table public.ingresos add column if not exists tipo_ingreso_id bigint;`,
  `alter table public.ingresos add column if not exists medio_pago_id bigint;`,

  `update public.registros r
   set concepto_id = c.id
   from public.config_conceptos c
   where upper(trim(coalesce(r.concepto, ''))) = c.nombre
     and (r.concepto_id is null or r.concepto_id <> c.id);`,

  `update public.registros r
   set medio_pago_id = m.id
   from public.config_medios_pago m
   where upper(trim(coalesce(r."medioPago", ''))) = m.nombre
     and (r.medio_pago_id is null or r.medio_pago_id <> m.id);`,

  `update public.gastos g
   set tipo_egreso_id = ts.id
   from public.config_tipos_salida ts
   where upper(trim(coalesce(g."tipoEgreso", ''))) = ts.nombre
     and (g.tipo_egreso_id is null or g.tipo_egreso_id <> ts.id);`,

  `update public.gastos g
   set medio_pago_id = m.id
   from public.config_medios_pago m
   where upper(trim(coalesce(g."medioPago", ''))) = m.nombre
     and (g.medio_pago_id is null or g.medio_pago_id <> m.id);`,

  `update public.ingresos i
   set tipo_ingreso_id = ti.id
   from public.config_tipos_ingreso ti
   where upper(trim(coalesce(i."tipoIngreso", ''))) = ti.nombre
     and (i.tipo_ingreso_id is null or i.tipo_ingreso_id <> ti.id);`,

  `update public.ingresos i
   set medio_pago_id = m.id
   from public.config_medios_pago m
   where upper(trim(coalesce(i."medioPago", ''))) = m.nombre
     and (i.medio_pago_id is null or i.medio_pago_id <> m.id);`,

  `do $$
   begin
     if not exists (select 1 from pg_constraint where conname = 'fk_registros_concepto') then
       alter table public.registros
         add constraint fk_registros_concepto
         foreign key (concepto_id) references public.config_conceptos(id) on update cascade on delete set null;
     end if;
   end $$;`,

  `do $$
   begin
     if not exists (select 1 from pg_constraint where conname = 'fk_registros_medio_pago') then
       alter table public.registros
         add constraint fk_registros_medio_pago
         foreign key (medio_pago_id) references public.config_medios_pago(id) on update cascade on delete set null;
     end if;
   end $$;`,

  `do $$
   begin
     if not exists (select 1 from pg_constraint where conname = 'fk_gastos_tipo_egreso') then
       alter table public.gastos
         add constraint fk_gastos_tipo_egreso
         foreign key (tipo_egreso_id) references public.config_tipos_salida(id) on update cascade on delete set null;
     end if;
   end $$;`,

  `do $$
   begin
     if not exists (select 1 from pg_constraint where conname = 'fk_gastos_medio_pago') then
       alter table public.gastos
         add constraint fk_gastos_medio_pago
         foreign key (medio_pago_id) references public.config_medios_pago(id) on update cascade on delete set null;
     end if;
   end $$;`,

  `do $$
   begin
     if not exists (select 1 from pg_constraint where conname = 'fk_ingresos_tipo_ingreso') then
       alter table public.ingresos
         add constraint fk_ingresos_tipo_ingreso
         foreign key (tipo_ingreso_id) references public.config_tipos_ingreso(id) on update cascade on delete set null;
     end if;
   end $$;`,

  `do $$
   begin
     if not exists (select 1 from pg_constraint where conname = 'fk_ingresos_medio_pago') then
       alter table public.ingresos
         add constraint fk_ingresos_medio_pago
         foreign key (medio_pago_id) references public.config_medios_pago(id) on update cascade on delete set null;
     end if;
   end $$;`,

  `create table if not exists public.registro_conceptos_detalle (
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
    );`,

  `create table if not exists public.registro_pagos_detalle (
      registro_id text not null,
      orden integer not null,
      medio_pago text not null,
      monto numeric not null default 0,
      nro_operacion text,
      medio_pago_id bigint,
      "createdAt" timestamptz not null default now(),
      primary key (registro_id, orden),
      constraint fk_registro_pagos_detalle_registro
        foreign key (registro_id) references public.registros(id) on delete cascade,
      constraint fk_registro_pagos_detalle_medio
        foreign key (medio_pago_id) references public.config_medios_pago(id) on update cascade on delete set null
    );`,

  `alter table public.registro_pagos_detalle add column if not exists nro_operacion text;`,

  `create index if not exists idx_registro_conceptos_detalle_concepto_id
    on public.registro_conceptos_detalle (concepto_id);`,

  `create index if not exists idx_registro_pagos_detalle_medio_pago_id
    on public.registro_pagos_detalle (medio_pago_id);`,

  `create index if not exists idx_registro_pagos_detalle_medio_pago
    on public.registro_pagos_detalle (medio_pago);`,

  `create index if not exists idx_registro_pagos_detalle_nro_operacion
    on public.registro_pagos_detalle (nro_operacion);`,

  `insert into public.registro_conceptos_detalle (registro_id, orden, concepto, monto, concepto_id)
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
       concepto_id = excluded.concepto_id;`,

  `insert into public.registro_conceptos_detalle (registro_id, orden, concepto, monto, concepto_id)
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
       concepto_id = excluded.concepto_id;`,

  `alter table public.registro_pagos_detalle add column if not exists fecha_transferencia date;`,

  `insert into public.registro_pagos_detalle (registro_id, orden, medio_pago, monto, nro_operacion, fecha_transferencia, medio_pago_id)
   select
     r.id,
     detalle.ord::int,
     upper(trim(coalesce(detalle.value->>'medioPago', ''))),
     coalesce((detalle.value->>'monto')::numeric, 0),
     nullif(upper(regexp_replace(trim(coalesce(detalle.value->>'nroOperacion', '')), '\\s+', '', 'g')), ''),
     case
       when coalesce(detalle.value->>'fechaTransferencia', '') ~ '^\\d{4}-\\d{2}-\\d{2}$'
         then (detalle.value->>'fechaTransferencia')::date
       else null
     end,
     m.id
   from public.registros r
   join lateral jsonb_array_elements(coalesce(r."pagosDetalle", '[]'::jsonb)) with ordinality detalle(value, ord) on true
   left join public.config_medios_pago m
     on m.nombre = upper(trim(coalesce(detalle.value->>'medioPago', '')))
   where upper(trim(coalesce(detalle.value->>'medioPago', ''))) <> ''
   on conflict (registro_id, orden) do update
   set medio_pago = excluded.medio_pago,
       monto = excluded.monto,
       nro_operacion = excluded.nro_operacion,
       fecha_transferencia = excluded.fecha_transferencia,
       medio_pago_id = excluded.medio_pago_id;`,

  `insert into public.registro_pagos_detalle (registro_id, orden, medio_pago, monto, nro_operacion, fecha_transferencia, medio_pago_id)
   select
     r.id,
     1,
     upper(trim(coalesce(r."medioPago", ''))),
     coalesce(r.subtotal, 0),
     null,
     null,
     m.id
   from public.registros r
   left join public.config_medios_pago m
     on m.nombre = upper(trim(coalesce(r."medioPago", '')))
   where coalesce(jsonb_array_length(coalesce(r."pagosDetalle", '[]'::jsonb)), 0) = 0
     and upper(trim(coalesce(r."medioPago", ''))) <> ''
   on conflict (registro_id, orden) do update
   set medio_pago = excluded.medio_pago,
       monto = excluded.monto,
       nro_operacion = excluded.nro_operacion,
       fecha_transferencia = excluded.fecha_transferencia,
       medio_pago_id = excluded.medio_pago_id;`,

  `create table if not exists public.cierre_registros (
      cierre_id text not null,
      registro_id text not null,
      "createdAt" timestamptz not null default now(),
      primary key (cierre_id, registro_id),
      constraint fk_cierre_registros_cierre
        foreign key (cierre_id) references public.cierres(id) on delete cascade,
      constraint fk_cierre_registros_registro
        foreign key (registro_id) references public.registros(id) on delete cascade
    );`,

  `create table if not exists public.cierre_ingresos (
      cierre_id text not null,
      ingreso_id text not null,
      "createdAt" timestamptz not null default now(),
      primary key (cierre_id, ingreso_id),
      constraint fk_cierre_ingresos_cierre
        foreign key (cierre_id) references public.cierres(id) on delete cascade,
      constraint fk_cierre_ingresos_ingreso
        foreign key (ingreso_id) references public.ingresos(id) on delete cascade
    );`,

  `create table if not exists public.cierre_gastos (
      cierre_id text not null,
      gasto_id text not null,
      "createdAt" timestamptz not null default now(),
      primary key (cierre_id, gasto_id),
      constraint fk_cierre_gastos_cierre
        foreign key (cierre_id) references public.cierres(id) on delete cascade,
      constraint fk_cierre_gastos_gasto
        foreign key (gasto_id) references public.gastos(id) on delete cascade
    );`,

  `create index if not exists idx_cierre_registros_registro_id
    on public.cierre_registros (registro_id);`,

  `create index if not exists idx_cierre_ingresos_ingreso_id
    on public.cierre_ingresos (ingreso_id);`,

  `create index if not exists idx_cierre_gastos_gasto_id
    on public.cierre_gastos (gasto_id);`,

  `insert into public.cierre_registros (cierre_id, registro_id)
   select c.id, r.id
   from public.cierres c
   join lateral jsonb_array_elements_text(coalesce(c.referencias->'registroIds', '[]'::jsonb)) x(value) on true
   join public.registros r on r.id = x.value
   on conflict do nothing;`,

  `insert into public.cierre_ingresos (cierre_id, ingreso_id)
   select c.id, i.id
   from public.cierres c
   join lateral jsonb_array_elements_text(coalesce(c.referencias->'ingresoIds', '[]'::jsonb)) x(value) on true
   join public.ingresos i on i.id = x.value
   on conflict do nothing;`,

  `insert into public.cierre_gastos (cierre_id, gasto_id)
   select c.id, g.id
   from public.cierres c
   join lateral jsonb_array_elements_text(coalesce(c.referencias->'egresoIds', '[]'::jsonb)) x(value) on true
   join public.gastos g on g.id = x.value
   on conflict do nothing;`,

  `create or replace function public.fn_sync_registro_config_ids()
   returns trigger
   language plpgsql
   as $$
   begin
     if new.concepto is not null then
       select c.id into new.concepto_id
       from public.config_conceptos c
       where c.nombre = upper(trim(new.concepto))
       limit 1;
     end if;

     if new."medioPago" is not null then
       select m.id into new.medio_pago_id
       from public.config_medios_pago m
       where m.nombre = upper(trim(new."medioPago"))
       limit 1;
     end if;

     return new;
   end;
   $$;`,

  `drop trigger if exists tr_sync_registro_config_ids on public.registros;`,
  `create trigger tr_sync_registro_config_ids
   before insert or update of concepto, "medioPago"
   on public.registros
   for each row
   execute function public.fn_sync_registro_config_ids();`,

  `create or replace function public.fn_sync_registro_detalles()
   returns trigger
   language plpgsql
   as $$
   begin
     delete from public.registro_conceptos_detalle where registro_id = new.id;
     delete from public.registro_pagos_detalle where registro_id = new.id;

     insert into public.registro_conceptos_detalle (registro_id, orden, concepto, monto, concepto_id)
     select
       new.id,
       detalle.ord::int,
       upper(trim(coalesce(detalle.value->>'concepto', ''))),
       coalesce((detalle.value->>'monto')::numeric, 0),
       c.id
     from jsonb_array_elements(coalesce(new."conceptosDetalle", '[]'::jsonb)) with ordinality detalle(value, ord)
     left join public.config_conceptos c
       on c.nombre = upper(trim(coalesce(detalle.value->>'concepto', '')))
     where upper(trim(coalesce(detalle.value->>'concepto', ''))) <> '';

     if coalesce(jsonb_array_length(coalesce(new."conceptosDetalle", '[]'::jsonb)), 0) = 0
        and upper(trim(coalesce(new.concepto, ''))) <> '' then
       insert into public.registro_conceptos_detalle (registro_id, orden, concepto, monto, concepto_id)
       select
         new.id,
         1,
         upper(trim(coalesce(new.concepto, ''))),
         coalesce(new."conceptoMonto", new.subtotal, 0),
         c.id
       from public.config_conceptos c
       where c.nombre = upper(trim(coalesce(new.concepto, '')))
       union all
       select
         new.id,
         1,
         upper(trim(coalesce(new.concepto, ''))),
         coalesce(new."conceptoMonto", new.subtotal, 0),
         null
       where not exists (
         select 1
         from public.config_conceptos c2
         where c2.nombre = upper(trim(coalesce(new.concepto, '')))
       );
     end if;

     insert into public.registro_pagos_detalle (registro_id, orden, medio_pago, monto, nro_operacion, medio_pago_id)
     select
       new.id,
       detalle.ord::int,
       upper(trim(coalesce(detalle.value->>'medioPago', ''))),
       coalesce((detalle.value->>'monto')::numeric, 0),
       nullif(upper(regexp_replace(trim(coalesce(detalle.value->>'nroOperacion', '')), '\\s+', '', 'g')), ''),
       m.id
     from jsonb_array_elements(coalesce(new."pagosDetalle", '[]'::jsonb)) with ordinality detalle(value, ord)
     left join public.config_medios_pago m
       on m.nombre = upper(trim(coalesce(detalle.value->>'medioPago', '')))
     where upper(trim(coalesce(detalle.value->>'medioPago', ''))) <> '';

     if coalesce(jsonb_array_length(coalesce(new."pagosDetalle", '[]'::jsonb)), 0) = 0
        and upper(trim(coalesce(new."medioPago", ''))) <> '' then
       insert into public.registro_pagos_detalle (registro_id, orden, medio_pago, monto, nro_operacion, medio_pago_id)
       select
         new.id,
         1,
         upper(trim(coalesce(new."medioPago", ''))),
         coalesce(new.subtotal, 0),
         null,
         m.id
       from public.config_medios_pago m
       where m.nombre = upper(trim(coalesce(new."medioPago", '')))
       union all
       select
         new.id,
         1,
         upper(trim(coalesce(new."medioPago", ''))),
         coalesce(new.subtotal, 0),
         null,
         null
       where not exists (
         select 1
         from public.config_medios_pago m2
         where m2.nombre = upper(trim(coalesce(new."medioPago", '')))
       );
     end if;

     return new;
   end;
   $$;`,

  `drop trigger if exists tr_sync_registro_detalles on public.registros;`,
  `create trigger tr_sync_registro_detalles
   after insert or update of concepto, "conceptoMonto", "conceptosDetalle", "medioPago", subtotal, "pagosDetalle"
   on public.registros
   for each row
   execute function public.fn_sync_registro_detalles();`,

  `create or replace function public.fn_sync_gasto_config_ids()
   returns trigger
   language plpgsql
   as $$
   begin
     if new."tipoEgreso" is not null then
       select t.id into new.tipo_egreso_id
       from public.config_tipos_salida t
       where t.nombre = upper(trim(new."tipoEgreso"))
       limit 1;
     end if;

     if new."medioPago" is not null then
       select m.id into new.medio_pago_id
       from public.config_medios_pago m
       where m.nombre = upper(trim(new."medioPago"))
       limit 1;
     end if;

     return new;
   end;
   $$;`,

  `drop trigger if exists tr_sync_gasto_config_ids on public.gastos;`,
  `create trigger tr_sync_gasto_config_ids
   before insert or update of "tipoEgreso", "medioPago"
   on public.gastos
   for each row
   execute function public.fn_sync_gasto_config_ids();`,

  `create or replace function public.fn_sync_ingreso_config_ids()
   returns trigger
   language plpgsql
   as $$
   begin
     if new."tipoIngreso" is not null then
       select t.id into new.tipo_ingreso_id
       from public.config_tipos_ingreso t
       where t.nombre = upper(trim(new."tipoIngreso"))
       limit 1;
     end if;

     if new."medioPago" is not null then
       select m.id into new.medio_pago_id
       from public.config_medios_pago m
       where m.nombre = upper(trim(new."medioPago"))
       limit 1;
     end if;

     return new;
   end;
   $$;`,

  `drop trigger if exists tr_sync_ingreso_config_ids on public.ingresos;`,
  `create trigger tr_sync_ingreso_config_ids
   before insert or update of "tipoIngreso", "medioPago"
   on public.ingresos
   for each row
   execute function public.fn_sync_ingreso_config_ids();`,

  `create or replace function public.fn_sync_cierre_referencias()
   returns trigger
   language plpgsql
   as $$
   begin
     delete from public.cierre_registros where cierre_id = new.id;
     delete from public.cierre_ingresos where cierre_id = new.id;
     delete from public.cierre_gastos where cierre_id = new.id;

     insert into public.cierre_registros (cierre_id, registro_id)
     select new.id, r.id
     from jsonb_array_elements_text(coalesce(new.referencias->'registroIds', '[]'::jsonb)) x(value)
     join public.registros r on r.id = x.value
     on conflict do nothing;

     insert into public.cierre_ingresos (cierre_id, ingreso_id)
     select new.id, i.id
     from jsonb_array_elements_text(coalesce(new.referencias->'ingresoIds', '[]'::jsonb)) x(value)
     join public.ingresos i on i.id = x.value
     on conflict do nothing;

     insert into public.cierre_gastos (cierre_id, gasto_id)
     select new.id, g.id
     from jsonb_array_elements_text(coalesce(new.referencias->'egresoIds', '[]'::jsonb)) x(value)
     join public.gastos g on g.id = x.value
     on conflict do nothing;

     return new;
   end;
   $$;`,

  `drop trigger if exists tr_sync_cierre_referencias on public.cierres;`,
  `create trigger tr_sync_cierre_referencias
   after insert or update of referencias
   on public.cierres
   for each row
   execute function public.fn_sync_cierre_referencias();`
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

  const fkCheck = await client.query(`
    select conname
    from pg_constraint
    where conname in (
      'fk_registros_concepto',
      'fk_registros_medio_pago',
      'fk_registro_conceptos_detalle_registro',
      'fk_registro_conceptos_detalle_concepto',
      'fk_registro_pagos_detalle_registro',
      'fk_registro_pagos_detalle_medio',
      'fk_gastos_tipo_egreso',
      'fk_gastos_medio_pago',
      'fk_ingresos_tipo_ingreso',
      'fk_ingresos_medio_pago',
      'fk_cierre_registros_cierre',
      'fk_cierre_registros_registro',
      'fk_cierre_ingresos_cierre',
      'fk_cierre_ingresos_ingreso',
      'fk_cierre_gastos_cierre',
      'fk_cierre_gastos_gasto'
    )
    order by conname;
  `);

  const bridgeCount = await client.query(`
    select
      (select count(*)::int from public.registro_conceptos_detalle) as registro_conceptos_detalle,
      (select count(*)::int from public.registro_pagos_detalle) as registro_pagos_detalle,
      (select count(*)::int from public.cierre_registros) as cierre_registros,
      (select count(*)::int from public.cierre_ingresos) as cierre_ingresos,
      (select count(*)::int from public.cierre_gastos) as cierre_gastos;
  `);

  const indexCheck = await client.query(`
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'idx_registro_conceptos_detalle_concepto_id',
        'idx_registro_pagos_detalle_medio_pago_id',
        'idx_registro_pagos_detalle_medio_pago',
        'idx_cierre_registros_registro_id',
        'idx_cierre_ingresos_ingreso_id',
        'idx_cierre_gastos_gasto_id'
      )
    order by indexname;
  `);

  console.log('FKs:', fkCheck.rows.map(r => r.conname).join(', '));
  console.log('BridgeRows:', bridgeCount.rows[0]);
  console.log('Indexes:', indexCheck.rows.map(r => r.indexname).join(', '));
} catch (error) {
  console.error('Relations apply failed:', error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
