import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const need = ['D1_DATABASE_ID', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD'];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing build variables: ${missing.join(', ')}`);
  process.exit(1);
}

const config = '.wrangler-deploy.toml';
const toml = readFileSync('wrangler.toml', 'utf8').replace('REPLACE_WITH_YOUR_D1_DATABASE_ID', process.env.D1_DATABASE_ID);
writeFileSync(config, toml);

const run = (args) => {
  const r = spawnSync('npx', ['wrangler', ...args], { stdio: 'inherit' });
  if (r.status !== 0) {
    rmSync(config, { force: true });
    process.exit(r.status || 1);
  }
};

run(['d1', 'execute', 'DB', '--remote', '--file=schema.sql', '--config', config]);
run([
  'deploy',
  '--config', config,
  '--var', `ACCESS_TEAM_DOMAIN:${process.env.ACCESS_TEAM_DOMAIN}`,
  '--var', `ACCESS_AUD:${process.env.ACCESS_AUD}`,
]);
rmSync(config, { force: true });
