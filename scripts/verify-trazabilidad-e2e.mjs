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

const now = Date.now();
const fecha = new Date().toISOString().slice(0, 10);

const ids = {
  registro: `test-registro-${now}`,
  ingreso: `test-ingreso-${now}`,
  gasto: `test-gasto-${now}`,
  cierre: `test-cierre-${now}`
};

const conceptosDetalle = JSON.stringify([
  { concepto: 'SELLADOS', monto: 60 },
  { concepto: 'MUNI', monto: 40 }
]);

const pagosDetalle = JSON.stringify([
  { medioPago: 'EFECTIVO', monto: 70 },
  { medioPago: 'POSNET', monto: 30 }
]);

try {
  await client.connect();

  await client.query(
    `insert into public.registros (
      id, fecha, "createdAt", "nroRecibo", nombre, subtotal,
      sellados, muni, "sugIT", patente, "antecedentesPenales",
      cheques, posnet, vep, site, deposito, efectivo,
      "pagaCon", cambio, observacion, concepto, "conceptoMonto", "medioPago", "conceptosDetalle", "pagosDetalle"
    ) values (
      $1, $2, now(), $3, $4, $5,
      60,40,0,0,0,
      0,30,0,0,0,70,
      '', 0, 'TEST E2E', 'SELLADOS', 60, 'EFECTIVO', $6::jsonb, $7::jsonb
    )`,
    [ids.registro, fecha, `REC-${now}`, 'CLIENTE TEST', 100, conceptosDetalle, pagosDetalle]
  );

  await client.query(
    `insert into public.ingresos (
      id, fecha, "tipoIngreso", "medioPago", concepto, monto, observacion, comprobante, "createdAt"
    ) values (
      $1, $2, 'VENTA', 'EFECTIVO', 'INGRESO TEST E2E', 50, 'E2E', 'TEST', now()
    )`,
    [ids.ingreso, fecha]
  );

  await client.query(
    `insert into public.gastos (
      id, fecha, "tipoEgreso", "medioPago", descripcion, monto, observacion, comprobante, "createdAt"
    ) values (
      $1, $2, 'GASTOS VARIOS', 'EFECTIVO', 'GASTO TEST E2E', 20, 'E2E', 'TEST', now()
    )`,
    [ids.gasto, fecha]
  );

  await client.query(
    `insert into public.cierres (
      id, fecha, "createdAt", "totalIngresos", "totalGastos", "totalNeto",
      "detalleMedios", saldo, "disponibleContinuidad", observacion,
      referencias, "resumenMovimientos"
    ) values (
      $1, $2, now(), 150, 20, 130,
      '[]'::jsonb,
      '{"efectivo":130,"cheques":0,"posnet":0,"deposito":0}'::jsonb,
      130,
      'CIERRE TEST E2E',
      jsonb_build_object(
        'registroIds', jsonb_build_array($3::text),
        'ingresoIds', jsonb_build_array($4::text),
        'egresoIds', jsonb_build_array($5::text)
      ),
      '{"registros":1,"ingresos":1,"egresos":1}'::jsonb
    )`,
    [ids.cierre, fecha, ids.registro, ids.ingreso, ids.gasto]
  );

  const relCheck = await client.query(
    `select
      (select count(*)::int from public.cierre_registros where cierre_id = $1 and registro_id = $2) as cierre_registros,
      (select count(*)::int from public.cierre_ingresos where cierre_id = $1 and ingreso_id = $3) as cierre_ingresos,
      (select count(*)::int from public.cierre_gastos where cierre_id = $1 and gasto_id = $4) as cierre_gastos`,
    [ids.cierre, ids.registro, ids.ingreso, ids.gasto]
  );

  const fkCheck = await client.query(
    `select
      (select concepto_id is not null from public.registros where id = $1) as registro_concepto_fk,
      (select medio_pago_id is not null from public.registros where id = $1) as registro_medio_fk,
      (select count(*)::int from public.registro_conceptos_detalle where registro_id = $1) as registro_conceptos_detalle,
      (select count(*)::int from public.registro_pagos_detalle where registro_id = $1) as registro_pagos_detalle,
      (select count(*)::int from public.registro_pagos_detalle where registro_id = $1 and medio_pago = 'POSNET') as registro_posnet_detalle,
      (select tipo_ingreso_id is not null from public.ingresos where id = $2) as ingreso_tipo_fk,
      (select medio_pago_id is not null from public.ingresos where id = $2) as ingreso_medio_fk,
      (select tipo_egreso_id is not null from public.gastos where id = $3) as gasto_tipo_fk,
      (select medio_pago_id is not null from public.gastos where id = $3) as gasto_medio_fk`,
    [ids.registro, ids.ingreso, ids.gasto]
  );

  console.log('TRAZABILIDAD_REL_OK', relCheck.rows[0]);
  console.log('TRAZABILIDAD_FK_OK', fkCheck.rows[0]);

  await client.query('delete from public.cierres where id = $1', [ids.cierre]);
  await client.query('delete from public.registros where id = $1', [ids.registro]);
  await client.query('delete from public.ingresos where id = $1', [ids.ingreso]);
  await client.query('delete from public.gastos where id = $1', [ids.gasto]);

  console.log('TRAZABILIDAD_CLEANUP_OK', ids);
} catch (error) {
  console.error('TRAZABILIDAD_E2E_FAIL', error.message || error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
