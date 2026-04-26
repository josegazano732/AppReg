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
const id = `test-registro-roundtrip-${now}`;
const fecha = new Date().toISOString().slice(0, 10);
const conceptosDetalle = [
  { concepto: 'SELLADOS', monto: 80 },
  { concepto: 'MUNI', monto: 20 }
];
const pagosDetalle = [
  { medioPago: 'EFECTIVO', monto: 55 },
  { medioPago: 'POSNET', monto: 25 },
  { medioPago: 'TRANSFERENCIA', monto: 20, nroOperacion: `TRX${now}`, fechaTransferencia: fecha }
];

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
      80,20,0,0,0,
      0,25,20,0,0,55,
      '', 0, 'ROUNDTRIP REGISTRO', 'SELLADOS', 80, 'EFECTIVO', $6::jsonb, $7::jsonb
    )`,
    [
      id,
      fecha,
      `REC-${now}`,
      'CLIENTE ROUNDTRIP',
      100,
      JSON.stringify(conceptosDetalle),
      JSON.stringify(pagosDetalle)
    ]
  );

  const read = await client.query(
    `select
      id,
      fecha,
      "medioPago",
      "pagosDetalle",
      "conceptosDetalle",
      (select count(*)::int from public.registro_conceptos_detalle where registro_id = r.id) as conceptos_count,
      (select count(*)::int from public.registro_pagos_detalle where registro_id = r.id) as pagos_count,
      (select coalesce(sum(monto), 0) from public.registro_pagos_detalle where registro_id = r.id and medio_pago = 'POSNET') as posnet_total,
      (select coalesce(sum(monto), 0) from public.registro_pagos_detalle where registro_id = r.id and medio_pago = 'TRANSFERENCIA') as transferencia_total,
      (select max(nro_operacion) from public.registro_pagos_detalle where registro_id = r.id and medio_pago = 'TRANSFERENCIA') as transferencia_operacion,
      (select max(fecha_transferencia)::text from public.registro_pagos_detalle where registro_id = r.id and medio_pago = 'TRANSFERENCIA') as transferencia_fecha
    from public.registros r
    where id = $1
    limit 1`,
    [id]
  );

  if (!read.rows.length) {
    throw new Error('Read failed: inserted registro not found');
  }

  const row = read.rows[0];
  const pagos = Array.isArray(row.pagosDetalle) ? row.pagosDetalle : [];

  if (String(row.fecha) !== fecha) {
    throw new Error(`Fecha mismatch: expected ${fecha}, got ${row.fecha}`);
  }

  if (row.pagos_count !== 3) {
    throw new Error(`Pagos detalle mismatch: expected 3, got ${row.pagos_count}`);
  }

  if (row.conceptos_count !== 2) {
    throw new Error(`Conceptos detalle mismatch: expected 2, got ${row.conceptos_count}`);
  }

  if (Number(row.posnet_total) !== 25 || Number(row.transferencia_total) !== 20) {
    throw new Error(`Detalle por medio mismatch: POSNET=${row.posnet_total}, TRANSFERENCIA=${row.transferencia_total}`);
  }

  if (String(row.transferencia_operacion || '') !== `TRX${now}`) {
    throw new Error(`Operacion transferencia mismatch: expected TRX${now}, got ${row.transferencia_operacion}`);
  }

  if (String(row.transferencia_fecha || '') !== fecha) {
    throw new Error(`Fecha transferencia mismatch: expected ${fecha}, got ${row.transferencia_fecha}`);
  }

  if (pagos.length !== 3) {
    throw new Error(`JSON pagosDetalle mismatch: expected 3, got ${pagos.length}`);
  }

  const transferenciaJson = pagos.find(item => item?.medioPago === 'TRANSFERENCIA');
  if (String(transferenciaJson?.fechaTransferencia || '') !== fecha) {
    throw new Error(`JSON fechaTransferencia mismatch: expected ${fecha}, got ${transferenciaJson?.fechaTransferencia}`);
  }

  console.log('REGISTRO_ROUNDTRIP_OK', {
    id: row.id,
    fecha: row.fecha,
    medioPago: row.medioPago,
    pagosCount: row.pagos_count,
    conceptosCount: row.conceptos_count,
    posnetTotal: row.posnet_total,
    transferenciaTotal: row.transferencia_total,
    transferenciaOperacion: row.transferencia_operacion,
    transferenciaFecha: row.transferencia_fecha
  });

  await client.query('delete from public.registros where id = $1', [id]);
  console.log('REGISTRO_ROUNDTRIP_CLEANUP_OK', id);
} catch (error) {
  console.error('REGISTRO_ROUNDTRIP_FAIL', error.message || error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}