import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

const now = new Date();
const id = `test-registro-supa-${now.getTime()}`;
const fecha = now.toISOString().slice(0, 10);

const payload = {
  id,
  fecha,
  nroRecibo: `REC-${now.getTime()}`,
  nombre: 'CLIENTE TEST SUPABASE',
  subtotal: 100,
  sellados: 60,
  muni: 40,
  sugIT: 0,
  patente: 0,
  antecedentesPenales: 0,
  cheques: 0,
  posnet: 30,
  vep: 10,
  site: 0,
  deposito: 0,
  efectivo: 60,
  pagaCon: '',
  cambio: 0,
  observacion: 'Prueba de registro con pagos multiples',
  concepto: 'SELLADOS',
  conceptoMonto: 60,
  medioPago: 'EFECTIVO',
  conceptosDetalle: [
    { concepto: 'SELLADOS', monto: 60 },
    { concepto: 'MUNI', monto: 40 }
  ],
  pagosDetalle: [
    { medioPago: 'EFECTIVO', monto: 60 },
    { medioPago: 'POSNET', monto: 30 },
    { medioPago: 'TRANSFERENCIA', monto: 10, nroOperacion: `TRX${now.getTime()}`, fechaTransferencia: fecha }
  ],
  createdAt: now.toISOString()
};

try {
  const write = await supabase.from('registros').upsert(payload, { onConflict: 'id' });
  if (write.error) {
    throw new Error(`Write failed: ${write.error.message}`);
  }

  const read = await supabase.from('registros').select('*').eq('id', id).limit(1);
  if (read.error) {
    throw new Error(`Read failed: ${read.error.message}`);
  }

  if (!read.data?.length) {
    throw new Error('Read failed: inserted registro not found');
  }

  const row = read.data[0];
  const conceptos = Array.isArray(row.conceptosDetalle) ? row.conceptosDetalle : [];
  const pagos = Array.isArray(row.pagosDetalle) ? row.pagosDetalle : [];
  const posnet = pagos.find(item => item?.medioPago === 'POSNET');
  const transferencia = pagos.find(item => item?.medioPago === 'TRANSFERENCIA');

  if (String(row.fecha || '') !== fecha) {
    throw new Error(`Fecha mismatch: expected ${fecha}, got ${row.fecha}`);
  }

  if (conceptos.length !== 2) {
    throw new Error(`Conceptos detalle mismatch: expected 2, got ${conceptos.length}`);
  }

  if (pagos.length !== 3) {
    throw new Error(`Pagos detalle mismatch: expected 3, got ${pagos.length}`);
  }

  if (Number(posnet?.monto || 0) !== 30 || Number(transferencia?.monto || 0) !== 10) {
    throw new Error(`Pagos por medio mismatch: POSNET=${posnet?.monto}, TRANSFERENCIA=${transferencia?.monto}`);
  }

  if (String(transferencia?.nroOperacion || '') !== `TRX${now.getTime()}`) {
    throw new Error(`Operacion transferencia mismatch: ${transferencia?.nroOperacion}`);
  }

  if (String(transferencia?.fechaTransferencia || '') !== fecha) {
    throw new Error(`Fecha transferencia mismatch: ${transferencia?.fechaTransferencia}`);
  }

  console.log('REGISTRO_SUPABASE_ROUNDTRIP_OK', {
    id: row.id,
    fecha: row.fecha,
    medioPago: row.medioPago,
    conceptosDetalle: conceptos.length,
    pagosDetalle: pagos.length,
    posnetMonto: posnet?.monto || 0,
    transferenciaMonto: transferencia?.monto || 0,
    transferenciaOperacion: transferencia?.nroOperacion || '',
    transferenciaFecha: transferencia?.fechaTransferencia || ''
  });

  const del = await supabase.from('registros').delete().eq('id', id);
  if (del.error) {
    throw new Error(`Cleanup failed: ${del.error.message}`);
  }

  console.log('REGISTRO_SUPABASE_CLEANUP_OK', id);
} catch (error) {
  console.error('REGISTRO_SUPABASE_ROUNDTRIP_FAIL', error.message || error);
  process.exit(1);
}