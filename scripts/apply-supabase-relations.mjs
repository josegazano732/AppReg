import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.SUPABASE_DB_URL;

if (!connectionString) {
  console.error('Missing SUPABASE_DB_URL');
  process.exit(1);
}

const statements = [
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
      (select count(*)::int from public.cierre_registros) as cierre_registros,
      (select count(*)::int from public.cierre_ingresos) as cierre_ingresos,
      (select count(*)::int from public.cierre_gastos) as cierre_gastos;
  `);

  console.log('FKs:', fkCheck.rows.map(r => r.conname).join(', '));
  console.log('BridgeRows:', bridgeCount.rows[0]);
} catch (error) {
  console.error('Relations apply failed:', error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
