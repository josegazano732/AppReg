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
const id = `test-mov-bank-${now.getTime()}`;
const fecha = now.toISOString().slice(0, 10);
const nroOperacion = `TRX${now.getTime()}`;

const payload = {
  id,
  fecha,
  descripcion: 'TEST IMPORTACION',
  monto: 123.45,
  tipo: 'CREDITO',
  nro_operacion: nroOperacion,
  banco: 'BANCO TEST',
  cuenta: 'CTA-001',
  origen_importacion: 'VERIFY_SCRIPT',
  referencia_externa: `REF-${now.getTime()}`,
  conciliacion_estado: 'PENDIENTE',
  createdAt: now.toISOString(),
  updatedAt: now.toISOString()
};

try {
  const write = await supabase.from('movimientos_bancarios').upsert(payload, { onConflict: 'id' });
  if (write.error) {
    throw new Error(`Write failed: ${write.error.message}`);
  }

  const read = await supabase
    .from('movimientos_bancarios')
    .select('id, fecha, descripcion, monto, tipo, nro_operacion, banco, cuenta, conciliacion_estado')
    .eq('id', id)
    .limit(1);

  if (read.error) {
    throw new Error(`Read failed: ${read.error.message}`);
  }

  if (!read.data?.length) {
    throw new Error('Read failed: inserted movimiento not found');
  }

  const row = read.data[0];
  if (String(row.fecha || '') !== fecha) {
    throw new Error(`Fecha mismatch: expected ${fecha}, got ${row.fecha}`);
  }

  if (Number(row.monto || 0) !== 123.45 || String(row.tipo || '') !== 'CREDITO') {
    throw new Error(`Movimiento mismatch: monto=${row.monto}, tipo=${row.tipo}`);
  }

  if (String(row.nro_operacion || '') !== nroOperacion) {
    throw new Error(`Operacion mismatch: expected ${nroOperacion}, got ${row.nro_operacion}`);
  }

  console.log('MOVIMIENTOS_BANCARIOS_SUPABASE_ROUNDTRIP_OK', {
    id: row.id,
    fecha: row.fecha,
    monto: row.monto,
    tipo: row.tipo,
    nroOperacion: row.nro_operacion,
    estado: row.conciliacion_estado
  });

  const del = await supabase.from('movimientos_bancarios').delete().eq('id', id);
  if (del.error) {
    throw new Error(`Cleanup failed: ${del.error.message}`);
  }

  console.log('MOVIMIENTOS_BANCARIOS_SUPABASE_CLEANUP_OK', id);
} catch (error) {
  console.error('MOVIMIENTOS_BANCARIOS_SUPABASE_ROUNDTRIP_FAIL', error.message || error);
  process.exit(1);
}