import { spawnSync } from 'node:child_process';

const regions = [
  'us-east-1',
  'us-west-1',
  'us-west-2',
  'sa-east-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'eu-north-1',
  'ap-south-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ap-northeast-2',
  'ca-central-1'
];

const password = process.env.SUPABASE_DB_PASSWORD;
const projectRef = process.env.SUPABASE_PROJECT_REF || 'crjtyrzdrkgrcxqpmmou';

if (!password) {
  console.error('Missing SUPABASE_DB_PASSWORD');
  process.exit(1);
}

for (const region of regions) {
  const host = `aws-0-${region}.pooler.supabase.com`;
  const connectionString = `postgresql://postgres.${projectRef}:${password}@${host}:6543/postgres`;
  console.log(`TRY ${host}`);

  const result = spawnSync(process.execPath, ['scripts/apply-supabase-schema.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SUPABASE_DB_URL: connectionString
    },
    encoding: 'utf-8'
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status === 0) {
    console.log(`SUCCESS ${host}`);
    process.exit(0);
  }
}

console.error('No working pooler host found');
process.exit(1);