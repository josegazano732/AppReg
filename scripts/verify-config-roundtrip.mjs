import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const nombre = `TEST_CONFIG_${Date.now()}`;

try {
  const write = await supabase.from('config_conceptos').insert({ nombre, activo: true });
  if (write.error) throw new Error(`write: ${write.error.message}`);

  const read = await supabase.from('config_conceptos').select('nombre, activo').eq('nombre', nombre).limit(1);
  if (read.error) throw new Error(`read: ${read.error.message}`);
  if (!read.data?.length) throw new Error('read: row not found');

  console.log('CONFIG_ROUNDTRIP_OK', read.data[0]);

  const cleanup = await supabase.from('config_conceptos').delete().eq('nombre', nombre);
  if (cleanup.error) throw new Error(`cleanup: ${cleanup.error.message}`);

  console.log('CONFIG_CLEANUP_OK', nombre);
} catch (error) {
  console.error('CONFIG_ROUNDTRIP_FAIL', error.message || error);
  process.exit(1);
}
