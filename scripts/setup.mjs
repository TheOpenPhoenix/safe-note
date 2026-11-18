import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const NAME = 'safenote';
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const email = process.env.ALLOWED_EMAIL;
const missing = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'ALLOWED_EMAIL'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Set these environment variables first: ${missing.join(', ')}`);
  process.exit(1);
}

const api = async (method, path, body) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!j.success) throw new Error(`${method} ${path}: ${JSON.stringify(j.errors)}`);
  return j.result;
};

const wrangler = (args, opts = {}) =>
  spawnSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: opts.input ? ['pipe', 'inherit', 'inherit'] : ['inherit', 'pipe', 'inherit'], ...opts });

const deploy = (env) => {
  const r = spawnSync('node', ['scripts/deploy.mjs'], { stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status || 1);
};

const dbs = await api('GET', `/d1/database?name=${NAME}`);
const db = dbs.find((d) => d.name === NAME) || (await api('POST', '/d1/database', { name: NAME }));
console.log(`D1 database ${NAME}: ${db.uuid}`);

const org = await api('GET', '/access/organizations');
const teamDomain = org.auth_domain;
const sub = (await api('GET', '/workers/subdomain')).subdomain;
const host = `${NAME}.${sub}.workers.dev`;

const base = { D1_DATABASE_ID: db.uuid, ACCESS_TEAM_DOMAIN: teamDomain };

console.log('First deploy');
deploy({ ...base, ACCESS_AUD: 'pending' });

const listed = wrangler(['secret', 'list', '--name', NAME, '--format', 'json']);
const hasSecret = listed.status === 0 && JSON.parse(listed.stdout || '[]').some((s) => s.name === 'OWNER_SECRET');
if (!hasSecret) {
  const secret = randomBytes(32).toString('hex');
  const put = wrangler(['secret', 'put', 'OWNER_SECRET', '--name', NAME], { input: secret });
  if (put.status !== 0) process.exit(put.status || 1);
  console.log('\nOWNER_SECRET (save this in a password manager, it is shown only once):');
  console.log(secret + '\n');
} else {
  console.log('OWNER_SECRET already set, leaving it alone');
}

const apps = await api('GET', '/access/apps');
const existing = apps.find((a) => a.domain === host);
const app =
  existing ||
  (await api('POST', '/access/apps', {
    name: NAME,
    domain: host,
    type: 'self_hosted',
    session_duration: '24h',
    policies: [{ name: 'Allowed', decision: 'allow', include: [{ email: { email } }] }],
  }));
console.log(`Access application: ${app.aud}`);

console.log('Final deploy');
deploy({ ...base, ACCESS_AUD: app.aud });

console.log(`\nSafeNote is live at https://${host}`);
console.log('To deploy from Git later, set these build variables in Cloudflare:');
console.log(`  D1_DATABASE_ID=${db.uuid}`);
console.log(`  ACCESS_TEAM_DOMAIN=${teamDomain}`);
console.log(`  ACCESS_AUD=${app.aud}`);
