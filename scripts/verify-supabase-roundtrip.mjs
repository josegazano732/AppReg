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
const id = `test-gasto-${now.getTime()}`;
const payload = {
  id,
  fecha: now.toISOString().slice(0, 10),
  tipoEgreso: 'TEST_AUTOMATICO',
  medioPago: 'EFECTIVO',
  descripcion: 'Prueba roundtrip agente',
  monto: 123.45,
  observacion: 'Insercion y lectura de prueba',
  comprobante: 'AUTO-TEST',
  createdAt: now.toISOString()
};

try {
  const write = await supabase.from('gastos').upsert(payload, { onConflict: 'id' });
  if (write.error) {
    throw new Error(`Write failed: ${write.error.message}`);
  }

  const read = await supabase.from('gastos').select('*').eq('id', id).limit(1);
  if (read.error) {
    throw new Error(`Read failed: ${read.error.message}`);
  }

  if (!read.data || !read.data.length) {
    throw new Error('Read failed: inserted row not found');
  }

  const row = read.data[0];
  console.log('ROUNDTRIP_OK', {
    id: row.id,
    monto: row.monto,
    medioPago: row.medioPago,
    createdAt: row.createdAt
  });

  const del = await supabase.from('gastos').delete().eq('id', id);
  if (del.error) {
    throw new Error(`Cleanup failed: ${del.error.message}`);
  }

  console.log('CLEANUP_OK', id);
} catch (error) {
  console.error('ROUNDTRIP_FAIL', error.message || error);
  process.exit(1);
}
